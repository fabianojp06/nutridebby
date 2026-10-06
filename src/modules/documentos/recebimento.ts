import { and, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { signedDocumentReceipts, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { carregarPacienteParaEscrita } from '@/modules/pacientes/base';
import type { EventoRecibo, ViaRecibo } from './constantes';
import { DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';

/** D11: o recibo é só INSERT, uma linha por evento (ON CONFLICT DO NOTHING). true = gravou agora. Usado pelo portal e pelo link. */
export async function registrarRecibo(
  tx: Tx,
  r: { tenantId: string; patientId: string; documentoId: string; evento: EventoRecibo; via: ViaRecibo; registradoPor?: string | null },
): Promise<boolean> {
  const g = await tx
    .insert(signedDocumentReceipts)
    .values({ tenantId: r.tenantId, patientId: r.patientId, documentoId: r.documentoId, evento: r.evento, via: r.via, registradoPor: r.registradoPor ?? null })
    .onConflictDoNothing({ target: [signedDocumentReceipts.documentoId, signedDocumentReceipts.evento] })
    .returning({ id: signedDocumentReceipts.id });
  return g.length > 0;
}

/** D3 a da spec: "Entregue pessoalmente" — recebimento registrado pela nutricionista (auditado pelo gatilho). */
export async function marcarEntreguePessoalmente(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db } = {}): Promise<boolean> {
  return withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const [d] = await tx.select({ status: signedDocuments.status }).from(signedDocuments).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId)));
    if (!d) throw new DocumentoNaoEncontradoError();
    if (d.status !== 'assinado') throw new TransicaoInvalidaError();
    return registrarRecibo(tx, { tenantId: ctx.tenantId, patientId, documentoId: docId, evento: 'recebido', via: 'pessoalmente', registradoPor: ctx.actorUserId ?? null });
  }, deps.db ?? getDb());
}
