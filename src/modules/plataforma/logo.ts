import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { getDb, type Db } from '@/db/client';
import { tenants } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { detectarTipo } from '@/lib/file-type';
import { apagarArquivo, salvarArquivo, TipoNaoPermitidoError } from './armazenamento';
import { LOGO_LADO_MAX, LOGO_MAX_BYTES, MSG_LOGO_GRANDE } from './marca-constantes';

export { LOGO_LADO_MAX, LOGO_MAX_BYTES, MSG_LOGO_GRANDE };

/**
 * Sempre devolve PNG de no máximo 512 px, sem metadados (EXIF). O SVG é rasterizado por
 * libvips/librsvg a partir de um buffer sem base URI (sem caminho de arquivo, sem density
 * de rede): não há como resolver `xlink:href` externo. `detectarTipo` já recusou `<!ENTITY>`
 * (XXE/"billion laughs") antes de chegar aqui — nunca guardamos SVG (RNF-06).
 */
export async function processarLogo(conteudo: Buffer): Promise<Buffer> {
  const tipo = detectarTipo(conteudo);
  if (!tipo || !['png', 'jpg', 'svg'].includes(tipo.ext)) throw new TipoNaoPermitidoError();
  try {
    return await sharp(conteudo, { density: tipo.ext === 'svg' ? 300 : 72, limitInputPixels: 40_000_000, failOn: 'error' })
      .rotate()
      .resize(LOGO_LADO_MAX, LOGO_LADO_MAX, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw new TipoNaoPermitidoError(); // imagem corrompida ou que o decodificador recusa
  }
}

export async function trocarLogo(ctx: TenantContext, conteudo: Buffer, deps: { db?: Db; dataDir?: string } = {}): Promise<string> {
  const db = deps.db ?? getDb();
  const png = await processarLogo(conteudo);
  const salvo = await salvarArquivo(ctx, { tipo: 'logo', conteudo: png, permitidos: ['png'] }, deps);
  const [antes] = await db.select({ logoPath: tenants.logoPath }).from(tenants).where(eq(tenants.id, ctx.tenantId));
  await db.update(tenants).set({ logoPath: salvo.caminho, updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId));
  if (antes?.logoPath && antes.logoPath !== salvo.caminho) await apagarArquivo(ctx, { caminho: antes.logoPath }, deps);
  return salvo.caminho;
}
