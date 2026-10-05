import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { StatusDocumento, TipoAssinatura } from '@/modules/documentos/constantes';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const codigoAleatorio = () => Array.from({ length: 12 }, () => CROCKFORD[Math.floor(Math.random() * 32)]).join('');

/**
 * Documento gravado direto no banco (sem o fluxo), no estado pedido. Emitido = com o stored_files do PDF assinado (FK NO
 * ACTION), SHA-256 e assinatura digitalizada (a única do 10A; o 10B passa `assinaturaTipo: 'govbr'` nos testes dele).
 * O gatilho de imutabilidade (0091) não olha INSERT.
 */
export async function documentoNoBanco(
  db: Db,
  ctx: TenantContext,
  patientId: string,
  o: { status?: StatusDocumento; conteudo?: Record<string, unknown>; assinaturaTipo?: TipoAssinatura } = {},
): Promise<{ id: string; codigo: string | null; pdfPath: string | null }> {
  const status = o.status ?? 'rascunho';
  const emitido = ['assinado', 'substituido', 'cancelado'].includes(status);
  const codigo = status === 'rascunho' ? null : codigoAleatorio();
  const pdfPath = emitido ? `${ctx.tenantId}/documento_assinado/${randomUUID()}.pdf` : null;
  const id = randomUUID();
  await withTenant(ctx, async (tx) => {
    if (pdfPath)
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${ctx.tenantId}, 'documento_assinado', ${pdfPath}, 100, 'application/pdf', ${patientId})`);
    await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, status, codigo, conteudo, pdf_path, pdf_sha256, assinado_em, assinatura_tipo, assinante_nome, entregue_em)
      values (${id}, ${ctx.tenantId}, ${patientId}, ${status}, ${codigo}, ${JSON.stringify(o.conteudo ?? { versao: 1, tipo: 'receita', itens: [], orientacoes: '' })}::jsonb,
              ${pdfPath}, ${emitido ? 'a'.repeat(64) : null}, ${emitido ? new Date() : null}, ${emitido ? (o.assinaturaTipo ?? 'digitalizada') : null}, ${emitido && (o.assinaturaTipo ?? 'digitalizada') !== 'digitalizada' ? 'DEBBY SILVA' : null}, ${emitido ? new Date() : null})`);
  }, db);
  return { id, codigo, pdfPath };
}
