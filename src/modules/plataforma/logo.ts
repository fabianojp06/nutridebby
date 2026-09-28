import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { getDb, type Db } from '@/db/client';
import { tenants } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { detectarTipo } from '@/lib/file-type';
import { apagarArquivo, salvarArquivo, TipoNaoPermitidoError } from './armazenamento';
import { LOGO_LADO_MAX, LOGO_MAX_BYTES, MSG_LOGO_GRANDE } from './marca-constantes';

export { LOGO_LADO_MAX, LOGO_MAX_BYTES, MSG_LOGO_GRANDE };

export const MSG_SVG_FILTRO = 'SVG com filtros não é aceito. Envie o logo em PNG.';
export const MSG_LOGO_OCUPADO = 'Tente novamente em alguns instantes.';

export class SvgFiltroError extends Error {
  override name = 'SvgFiltroError';
  constructor() {
    super(MSG_SVG_FILTRO);
  }
}

/** T10-R1c: só um logo é processado por vez no processo (rasterização é CPU-bound). */
export class LogoOcupadoError extends Error {
  override name = 'LogoOcupadoError';
  constructor() {
    super(MSG_LOGO_OCUPADO);
  }
}

// T10-R1a: filtros SVG (blur, etc.) custam CPU proporcional à ÁREA renderizada, não ao tamanho
// do arquivo — um <rect> de 1500×1500 com <feGaussianBlur stdDeviation="500"> repetido poucas
// vezes já soma minutos de CPU, bem antes de `resize` reduzir a imagem. Recusa pelo conteúdo,
// sem nunca chamar o sharp; cobre `<filter`, `<fe...` e variantes com prefixo de namespace
// (`<svg:filter`), sem diferenciar maiúsculas.
const SVG_FILTRO = /<(?:[\w-]+:)?(?:filter|fe[a-z]+)(?=[\s/>])/i;

function contemFiltroSvg(conteudo: Buffer): boolean {
  return SVG_FILTRO.test(new TextDecoder('utf-8').decode(conteudo));
}

// Só um sharp por vez no processo: a checagem e a troca do flag são síncronas (sem `await` entre
// elas), então duas chamadas concorrentes nunca correm o risco de ambas passarem.
let processando = false;

/**
 * Sempre devolve PNG de no máximo 512 px, sem metadados (EXIF). O SVG é rasterizado por
 * libvips/librsvg a partir de um buffer sem base URI (sem caminho de arquivo, sem density
 * de rede): não há como resolver `xlink:href`/`href` externo (confirmado: uma imagem local via
 * `file://` não aparece no resultado). `detectarTipo` já recusou `<!ENTITY>` (XXE/"billion
 * laughs") antes de chegar aqui — nunca guardamos SVG (RNF-06).
 */
export async function processarLogo(conteudo: Buffer): Promise<Buffer> {
  const tipo = detectarTipo(conteudo);
  if (!tipo || !['png', 'jpg', 'svg'].includes(tipo.ext)) throw new TipoNaoPermitidoError();
  if (tipo.ext === 'svg' && contemFiltroSvg(conteudo)) throw new SvgFiltroError();
  if (processando) throw new LogoOcupadoError();
  processando = true;
  try {
    return await sharp(conteudo, { density: tipo.ext === 'svg' ? 300 : 72, limitInputPixels: 40_000_000, failOn: 'error' })
      .timeout({ seconds: 5 }) // T10-R1b: rede de segurança para o que o filtro de <filter>/<fe…> não pegar
      .rotate()
      .resize(LOGO_LADO_MAX, LOGO_LADO_MAX, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw new TipoNaoPermitidoError(); // imagem corrompida, decodificador recusou, ou estourou o timeout
  } finally {
    processando = false;
  }
}

/**
 * T10-R3b: troca atômica do `logo_path` — `SELECT ... FOR UPDATE` trava a linha do tenant até o
 * commit, então duas trocas concorrentes do mesmo tenant serializam aqui: a segunda só lê depois
 * que a primeira confirma, e enxerga o caminho que a primeira de fato gravou (nunca o valor
 * antigo, como no `SELECT` solto + `UPDATE` separado de antes). Devolve o caminho anterior (ou
 * `null`). Exportada também para o teste de concorrência (T10-R3b), que a chama diretamente para
 * não depender do tempo real do sharp/semáforo.
 */
export async function apontarLogo(ctx: TenantContext, novoCaminho: string, db: Db): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ logoPath: tenants.logoPath }).from(tenants).where(eq(tenants.id, ctx.tenantId)).for('update');
    await tx.update(tenants).set({ logoPath: novoCaminho, updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId));
    return row?.logoPath ?? null;
  });
}

export async function trocarLogo(ctx: TenantContext, conteudo: Buffer, deps: { db?: Db; dataDir?: string } = {}): Promise<string> {
  const db = deps.db ?? getDb();
  const png = await processarLogo(conteudo);
  const salvo = await salvarArquivo(ctx, { tipo: 'logo', conteudo: png, permitidos: ['png'] }, deps);
  let antigo: string | null;
  try {
    antigo = await apontarLogo(ctx, salvo.caminho, db);
  } catch (err) {
    // T10-R3b: o arquivo novo já foi gravado e a cota reservada (salvarArquivo) — se o ponteiro
    // não pôde ser trocado, devolve os dois (apagarArquivo tolera o registro/arquivo já sumido).
    await apagarArquivo(ctx, { caminho: salvo.caminho }, deps).catch(() => undefined);
    throw err;
  }
  // apagarArquivo tolera o arquivo/registro já não existir (ENOENT no disco é ignorado por `rm`
  // com `force: true`; a ausência da linha em `stored_files` só faz `apagarArquivo` devolver false).
  if (antigo && antigo !== salvo.caminho) await apagarArquivo(ctx, { caminho: antigo }, deps);
  return salvo.caminho;
}
