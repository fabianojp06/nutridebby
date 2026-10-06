import { and, eq, isNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { notifications, patients, signedDocuments, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { urlDoApp } from '@/lib/url-do-app';
import { dispararEnvio } from '@/modules/notificacoes/agendar';
import { primeiroNome } from '@/modules/notificacoes/mensagens';
import { carregarPacienteParaEscrita } from '@/modules/pacientes/base';
import { telaDoPortal } from '@/modules/portal/link-portal';
import { dataHora, type ItemLista } from './documentos';
import { DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';
import { assinarLinkDocumento, urlDoLinkDocumento } from './link-documento';

/** US-145 (textos propostos, para a Debby revisar). */
export const MSG_ENTREGA = {
  semPortal: 'Este paciente ainda não tem acesso ao app. Enviamos um link por e-mail para ele abrir o documento com um código. Se a entrega for no consultório, marque "Entregue pessoalmente".',
  arquivado: 'Paciente arquivado: entregue o documento pessoalmente e marque "Entregue pessoalmente".',
  linkReenviado: 'Link reenviado.',
} as const;

/**
 * RN-152 / RN-153, na transação da assinatura: ativo com conta → portal + push + e-mail neutro; ativo sem conta e com
 * e-mail → e-mail com o link de uso único (D3 b); arquivado → nada (só "Entregue pessoalmente"). Nenhum texto diz o tipo
 * do documento, itens ou produtos. Tenant suspenso: a nutricionista nem entra (RN-15) e o job de e-mail descarta. R13: com
 * o interruptor D20 desligado (o admin desligou durante um job da digitalizada), nada sai — o portal e o link responderiam
 * "indisponível"; a assinatura continua e `entregue_em` fica nulo.
 */
export async function entregarDocumento(tx: Tx, e: { tenantId: string; patientId: string; documentoId: string; agora: Date; appUrl: string }): Promise<'portal' | 'link' | 'nenhuma'> {
  const [p] = await tx.select({ nome: patients.nome, email: patients.email, userId: patients.userId, status: patients.status }).from(patients).where(eq(patients.id, e.patientId));
  const [t] = await tx.select({ nome: tenants.nomeExibicao, liberado: tenants.documentosLiberados }).from(tenants).where(eq(tenants.id, e.tenantId));
  if (!p || !t || !t.liberado || p.status !== 'ativo') return 'nenhuma';
  const base = { para: p.email, nome: primeiroNome(p.nome), consultorio: t.nome };
  if (p.userId) {
    await tx.insert(notifications).values({ tenantId: e.tenantId, patientId: e.patientId, canal: 'push', tipo: 'documento_novo', agendadaPara: e.agora });
    await enqueueEmail({ tipo: 'documento_novo', ...base, link: urlDoApp(e.appUrl, telaDoPortal('/p/documentos', e.tenantId)) }, { tenantId: e.tenantId, tx });
    await dispararEnvio(tx, e.tenantId);
    return 'portal';
  }
  const token = assinarLinkDocumento({ tenantId: e.tenantId, patientId: e.patientId, documentoId: e.documentoId, emitidoEm: e.agora, email: p.email });
  await enqueueEmail({ tipo: 'documento_link', ...base, link: urlDoLinkDocumento(e.appUrl, token) }, { tenantId: e.tenantId, tx });
  return 'link';
}

/**
 * D6 ★: "Reenviar link por e-mail" — token novo (30 dias a partir de agora), só para assinado de paciente ativo sem conta.
 * Se a assinatura não entregou (paciente arquivado na hora, depois reativado), este é o primeiro envio: `entregue_em` sai
 * de nulo aqui (o gatilho aceita uma vez) e a lista passa a "Enviado em … · ainda não aberto".
 */
export async function reenviarLink(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db; appUrl?: string; agora?: Date } = {}): Promise<void> {
  const agora = deps.agora ?? new Date();
  await withTenant(ctx, async (tx) => {
    const p = await carregarPacienteParaEscrita(tx, patientId);
    const [d] = await tx.select({ status: signedDocuments.status }).from(signedDocuments).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId)));
    if (!d) throw new DocumentoNaoEncontradoError();
    if (d.status !== 'assinado' || p.userId || p.status !== 'ativo') throw new TransicaoInvalidaError();
    const via = await entregarDocumento(tx, { tenantId: ctx.tenantId, patientId, documentoId: docId, agora, appUrl: deps.appUrl ?? getEnv().APP_URL });
    if (via !== 'nenhuma') await tx.update(signedDocuments).set({ entregueEm: agora }).where(and(eq(signedDocuments.id, docId), isNull(signedDocuments.entregueEm)));
  }, deps.db ?? getDb());
}

/** D4 da spec: a linha de situação da entrega (painel). */
export function situacaoDaEntrega(d: ItemLista, fuso: string): string {
  const recebido = d.recibos.find((r) => r.evento === 'recebido');
  const aberto = d.recibos.find((r) => r.evento === 'aberto');
  if (recebido?.via === 'pessoalmente') return `Entregue pessoalmente em ${dataHora(recebido.em, fuso).split(' às ')[0]}`;
  if (recebido) return `Recebido pelo paciente em ${dataHora(recebido.em, fuso)}`;
  if (aberto) return `Aberto em ${dataHora(aberto.em, fuso).split(' às ')[0]} · recebimento não confirmado`;
  return d.entregueEm ? `Enviado em ${dataHora(d.entregueEm, fuso).split(' às ')[0]} · ainda não aberto` : '';
}
