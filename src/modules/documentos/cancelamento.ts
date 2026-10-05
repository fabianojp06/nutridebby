import { and, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { notifications, signedDocumentNotes, signedDocuments, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { urlDoApp } from '@/lib/url-do-app';
import { dispararEnvio } from '@/modules/notificacoes/agendar';
import { primeiroNome } from '@/modules/notificacoes/mensagens';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { telaDoPortal } from '@/modules/portal/link-portal';
import { DocumentoError, DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';
import { assinarLinkDocumento, urlDoLinkDocumento } from './link-documento';
import { mudarSituacao } from './verificacao';

/** US-149 (texto exato da spec v0.3). */
export const MSG_CANCELAMENTO = {
  motivo: 'Escreva o motivo do cancelamento (até 500 caracteres).',
  confirmacao: 'O documento deixa de valer para o paciente e na verificação pública. Esta ação não pode ser desfeita.',
} as const;

/**
 * RN-147: só de "assinado"; motivo 1–500 em signed_document_notes (STAFF_ONLY, nunca nas exportações); a verificação passa
 * a "cancelado" na mesma transação; e-mail neutro (D11 da spec) — com conta, o link do portal; sem conta, o link de uso
 * único (que mostra "não está mais disponível"). A retificação em andamento (Plano 13) entra aqui quando existir.
 */
export async function cancelarDocumento(ctx: TenantContext, patientId: string, docId: string, motivo: unknown, deps: { db?: Db; appUrl?: string; agora?: Date } = {}): Promise<void> {
  const m = typeof motivo === 'string' ? motivo.trim() : '';
  if (!m || m.length > 500) throw new DocumentoError({ motivo: MSG_CANCELAMENTO.motivo });
  const agora = deps.agora ?? new Date();
  const appUrl = deps.appUrl ?? getEnv().APP_URL;
  await withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (!idValido(docId)) throw new DocumentoNaoEncontradoError(); // como travarDocumento (documentos.ts)
      const [d] = await tx
        .select({ status: signedDocuments.status })
        .from(signedDocuments)
        .where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId)))
        .for('update');
      if (!d) throw new DocumentoNaoEncontradoError();
      if (d.status !== 'assinado') throw new TransicaoInvalidaError();
      await tx.update(signedDocuments).set({ status: 'cancelado', canceladoEm: agora, updatedAt: agora }).where(eq(signedDocuments.id, docId));
      await tx
        .insert(signedDocumentNotes)
        .values({ tenantId: ctx.tenantId, patientId, documentoId: docId, motivoCancelamento: m })
        .onConflictDoUpdate({ target: signedDocumentNotes.documentoId, set: { motivoCancelamento: m, updatedAt: agora } });
      await mudarSituacao(tx, docId, 'cancelado', agora);
      if (p.status !== 'ativo') return; // arquivado: ninguém é avisado (patients.email é NOT NULL)
      const [t] = await tx.select({ nome: tenants.nomeExibicao }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      const link = p.userId
        ? urlDoApp(appUrl, telaDoPortal('/p/documentos', ctx.tenantId))
        : urlDoLinkDocumento(appUrl, assinarLinkDocumento({ tenantId: ctx.tenantId, patientId, documentoId: docId, emitidoEm: agora, email: p.email }));
      await enqueueEmail({ tipo: 'documento_atualizado', para: p.email, nome: primeiroNome(p.nome), consultorio: t?.nome ?? '', link }, { tenantId: ctx.tenantId, tx });
      if (p.userId) {
        await tx.insert(notifications).values({ tenantId: ctx.tenantId, patientId, canal: 'push', tipo: 'documento_atualizado', agendadaPara: agora });
        await dispararEnvio(tx, ctx.tenantId);
      }
    },
    deps.db ?? getDb(),
  );
}
