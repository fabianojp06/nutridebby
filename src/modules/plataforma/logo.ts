import { spawn } from 'node:child_process';
import path from 'node:path';
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

export const MSG_SVG_PESADO = 'Não foi possível processar este SVG. Envie o logo em PNG.';

/** T10-R4: a rasterização do SVG estourou o tempo (processo filho morto com SIGKILL). */
export class SvgPesadoError extends Error {
  override name = 'SvgPesadoError';
  constructor() {
    super(MSG_SVG_PESADO);
  }
}

/** T10-R1c: só um logo é processado por vez no processo (rasterização é CPU-bound). */
export class LogoOcupadoError extends Error {
  override name = 'LogoOcupadoError';
  constructor() {
    super(MSG_LOGO_OCUPADO);
  }
}

// T10-R1a/R4b: filtros (blur, etc.) custam CPU proporcional à ÁREA renderizada, não ao tamanho do
// arquivo. O librsvg aceita `<filter>`/`<fe…>`, o atributo `filter="blur(…)"` e a propriedade CSS
// `filter:` (atributo `style` ou `<style>`), inclusive com a palavra escondida por referência
// numérica XML (`fil&#116;er`) ou escape CSS (`fil\74 er`). Então: decodifica as duas formas e
// recusa `filter` em qualquer lugar do texto (o falso positivo — um texto "filter" num <title> —
// é aceitável; o usuário reexporta em PNG). Nunca chama o sharp.
// Primitivas <fe…> soltas são inertes, mas seguem recusadas (comportamento da rodada 1).
const PRIMITIVA_FE = /<(?:[\w-]+:)?fe[a-z]+(?=[\s/>])/i;
const REF_NUMERICA = /&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/gi;
const ESCAPE_CSS = /\\(?:([0-9a-f]{1,6})[ \t\r\n\f]?|([^\r\n\f0-9a-f]))/gi;

function pontoParaTexto(n: number): string {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

function decodificar(texto: string): string {
  return texto
    .replace(REF_NUMERICA, (_m, hex?: string, dec?: string) => pontoParaTexto(hex ? parseInt(hex, 16) : parseInt(dec ?? '0', 10)))
    .replace(ESCAPE_CSS, (_m, hex?: string, literal?: string) => (hex ? pontoParaTexto(parseInt(hex, 16)) : (literal ?? '')));
}

function contemFiltroSvg(conteudo: Buffer): boolean {
  let texto = new TextDecoder('utf-8').decode(conteudo);
  // Até 3 passadas: cobre `&#38;#116;` e escapes dentro de referências. Só aumenta a recusa.
  for (let i = 0; i < 3; i++) {
    if (/filter/i.test(texto) || PRIMITIVA_FE.test(texto)) return true;
    const proximo = decodificar(texto);
    if (proximo === texto) return false;
    texto = proximo;
  }
  return /filter/i.test(texto) || PRIMITIVA_FE.test(texto);
}

// T10-R4c: um SVG morto por tempo bloqueia novos SVGs do mesmo tenant por 10 min (só em memória).
const RESFRIAMENTO_MS = 10 * 60_000;
const resfriamento = new Map<string, number>();

/** Só para testes. */
export function limparResfriamentoSvg(): void {
  resfriamento.clear();
}

function emResfriamento(tenantId: string | undefined): boolean {
  if (!tenantId) return false;
  const ate = resfriamento.get(tenantId);
  if (ate === undefined) return false;
  if (Date.now() >= ate) {
    resfriamento.delete(tenantId);
    return false;
  }
  return true;
}

const SVG_TIMEOUT_MS = 5000;
const SVG_SAIDA_MAX_BYTES = 2 * 1024 * 1024; // um PNG de 512 px cabe folgado; mais que isso é anomalia
// Resolvido pelo diretório de trabalho: `next start`/worker rodam em /app (Dockerfile copia
// /app/scripts e /app/node_modules), e o script importa o mesmo `sharp` pelo node_modules do pai.
const SVG_SCRIPT = path.join(process.cwd(), 'scripts', 'svg-raster.mjs');

/**
 * T10-R4a: rasteriza o SVG num processo filho (stdin → PNG em stdout) que morre com SIGKILL
 * após `timeoutMs` de relógio ou se a saída passar do limite. O conteúdo do arquivo nunca é logado.
 */
function rasterizarSvg(conteudo: Buffer, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, [SVG_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '', NODE_ENV: 'production' } });
    filho.stderr.resume(); // descarta stderr (nunca logado)
    const saida: Buffer[] = [];
    let tamanho = 0;
    let fim = false;
    const terminar = (fn: () => void) => {
      if (fim) return;
      fim = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      filho.kill('SIGKILL');
      terminar(() => reject(new SvgPesadoError()));
    }, timeoutMs);
    filho.stdout.on('data', (parte: Buffer) => {
      tamanho += parte.length;
      if (tamanho > SVG_SAIDA_MAX_BYTES) {
        filho.kill('SIGKILL');
        terminar(() => reject(new SvgPesadoError()));
        return;
      }
      saida.push(parte);
    });
    filho.stdin.on('error', () => undefined); // EPIPE se o filho morrer antes de ler tudo
    filho.on('error', () => terminar(() => reject(new TipoNaoPermitidoError())));
    filho.on('close', (codigo) =>
      terminar(() => (codigo === 0 && tamanho > 0 ? resolve(Buffer.concat(saida)) : reject(new TipoNaoPermitidoError()))),
    );
    filho.stdin.end(conteudo);
  });
}

// Só um logo por vez no processo: a checagem e a troca do flag são síncronas (sem `await` entre
// elas), então duas chamadas concorrentes nunca correm o risco de ambas passarem.
let processando = false;

export interface OpcoesProcessarLogo {
  tenantId?: string;
  /** Só para testes; padrão 5 s. */
  svgTimeoutMs?: number;
}

/**
 * Sempre devolve PNG de no máximo 512 px, sem metadados (EXIF). O SVG é rasterizado por
 * libvips/librsvg a partir de um buffer sem base URI (sem caminho de arquivo, sem density
 * de rede): não há como resolver `xlink:href`/`href` externo (confirmado: uma imagem local via
 * `file://` não aparece no resultado). `detectarTipo` já recusou `<!ENTITY>` (XXE/"billion
 * laughs") antes de chegar aqui — nunca guardamos SVG (RNF-06). PNG/JPEG rodam neste processo;
 * SVG roda no filho descartável (T10-R4).
 */
export async function processarLogo(conteudo: Buffer, opcoes: OpcoesProcessarLogo = {}): Promise<Buffer> {
  const tipo = detectarTipo(conteudo);
  if (!tipo || !['png', 'jpg', 'svg'].includes(tipo.ext)) throw new TipoNaoPermitidoError();
  const ehSvg = tipo.ext === 'svg';
  if (ehSvg && contemFiltroSvg(conteudo)) throw new SvgFiltroError();
  if (ehSvg && emResfriamento(opcoes.tenantId)) throw new LogoOcupadoError();
  if (processando) throw new LogoOcupadoError();
  processando = true;
  try {
    if (ehSvg) return await rasterizarSvg(conteudo, opcoes.svgTimeoutMs ?? SVG_TIMEOUT_MS);
    return await sharp(conteudo, { density: 72, limitInputPixels: 40_000_000, failOn: 'error' })
      .rotate()
      .resize(LOGO_LADO_MAX, LOGO_LADO_MAX, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch (err) {
    if (err instanceof SvgPesadoError) {
      if (opcoes.tenantId) resfriamento.set(opcoes.tenantId, Date.now() + RESFRIAMENTO_MS);
      throw err;
    }
    throw new TipoNaoPermitidoError(); // imagem corrompida ou decodificador recusou
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

export async function trocarLogo(ctx: TenantContext, conteudo: Buffer, deps: { db?: Db; dataDir?: string; apontar?: typeof apontarLogo } = {}): Promise<string> {
  const db = deps.db ?? getDb();
  const png = await processarLogo(conteudo, { tenantId: ctx.tenantId });
  const salvo = await salvarArquivo(ctx, { tipo: 'logo', conteudo: png, permitidos: ['png'] }, deps);
  let antigo: string | null;
  try {
    antigo = await (deps.apontar ?? apontarLogo)(ctx, salvo.caminho, db);
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
