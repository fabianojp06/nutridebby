/**
 * Plano 25 (US-445; RN-456, RN-457, RN-458; CS-440; CH-D61, CH-D62, CH-D70): os avisos de mensagem nova, na transação do
 * envio. Corpos fixos (o motor monta o push e o e-mail a partir do tipo, em src/modules/notificacoes/mensagens.ts): nenhuma
 * linha de `notifications` nem e-mail leva texto, nome de anexo, recado ou — no e-mail à nutricionista — nome de paciente.
 * Sem helper novo de horário (CH-D61): o silêncio das 21h às 8h é o de src/modules/notificacoes/agendar.ts.
 */
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { notifications, patients } from '@/db/schema';
import { urlDoApp } from '@/lib/url-do-app';
import { avisarNutri } from '@/modules/agenda/aviso-nutri';
import { dispararEnvio, emHorarioSilencioso, fimDoSilencio } from '@/modules/notificacoes/agendar';
import { ATRASO_EMAIL_PACIENTE_MS } from './constantes';

export type TipoAvisoDoChat = 'chat_mensagem' | 'recado';

/** O instante, ou as 8h seguintes se ele cair entre 21h e 8h no fuso do consultório. */
const foraDoSilencio = (instante: Date, fuso: string) => (emHorarioSilencioso(instante, fuso) ? fimDoSilencio(instante, fuso) : instante);

/**
 * RN-456, puro: o push sai agora (ou às 8h seguintes, no silêncio); o e-mail — só de `chat_mensagem` (o recado nunca tem
 * e-mail, CH-D16) — sai 30 min depois do push e, se esse instante cair no silêncio, às 8h seguintes a ele (CH-D61: mensagem
 * às 20h45 → push às 20h45 e e-mail às 8h do dia seguinte, não às 21h15).
 */
export function quandoAvisar(tipo: TipoAvisoDoChat, agora: Date, fuso: string): { push: Date; email: Date | null } {
  const push = foraDoSilencio(agora, fuso);
  return { push, email: tipo === 'chat_mensagem' ? foraDoSilencio(new Date(push.getTime() + ATRASO_EMAIL_PACIENTE_MS), fuso) : null };
}

/**
 * RN-456: na transação do envio da nutricionista (e, na T10, do recado), depois das travas do paciente e da conversa. Só o
 * paciente com conta (sem conta, nenhuma linha). Agrupado por tipo (CH-D61): com uma `notifications` `pendente` do mesmo tipo
 * do paciente — o push ou o e-mail ainda não saiu —, nada nasce; o e-mail agrupado confere as não lidas no envio
 * (`mensagem_lida`, CH-D62), e a mensagem que chegou depois da leitura não fica sem aviso. As condições de entrega (titular
 * ativo, inscrição de push, consultório ativo) são do motor, no envio. O envio imediato é disparado só quando o push sai já.
 */
export async function avisarPaciente(tx: Tx, a: { tenant: { id: string; fuso: string }; patientId: string; tipo: TipoAvisoDoChat; agora: Date }): Promise<void> {
  const [p] = await tx.select({ userId: patients.userId }).from(patients).where(and(eq(patients.tenantId, a.tenant.id), eq(patients.id, a.patientId)));
  if (!p?.userId) return;
  const [pendente] = await tx
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.tenantId, a.tenant.id), eq(notifications.patientId, a.patientId), eq(notifications.tipo, a.tipo), eq(notifications.status, 'pendente')))
    .limit(1)
    // revisão da T4 (M1): o motor pode estar levando esse aviso a "enviando" sem ter commitado (`reservar`); com o FOR UPDATE a
    // consulta espera, reavalia a linha (já não está pendente) e o aviso da mensagem nova nasce. Última trava da ordem global
    // (paciente → conversa → mensagem → notifications); o motor não trava paciente nem conversa
    .for('update');
  if (pendente) return;
  const q = quandoAvisar(a.tipo, a.agora, a.tenant.fuso);
  const linha = (canal: 'push' | 'email', agendadaPara: Date) => ({ tenantId: a.tenant.id, patientId: a.patientId, canal, tipo: a.tipo, agendadaPara, createdAt: a.agora, updatedAt: a.agora });
  await tx.insert(notifications).values(q.email ? [linha('push', q.push), linha('email', q.email)] : [linha('push', q.push)]);
  if (q.push.getTime() === a.agora.getTime()) await dispararEnvio(tx, a.tenant.id);
}

/**
 * RN-458 (CH-D70): o e-mail "Mensagens novas de pacientes" às nutricionistas do consultório, na transação do envio do
 * paciente. `devido` é o retorno de app_chat_aviso_nutri_devido, que o envio já chamou antes do INSERT (CH-D72: lá ela
 * ordena os envios e marca a janela de 2 h) — aqui ela não é chamada de novo. Corpo fixo: sem nome de paciente nem texto.
 */
export async function avisarNutriDeMensagem(tx: Tx, a: { tenant: { id: string }; devido: boolean; appUrl: string }): Promise<void> {
  if (!a.devido) return;
  const link = urlDoApp(a.appUrl, '/painel/mensagens?filtro=nao-lidas');
  await avisarNutri(tx, a.tenant.id, (para) => ({ tipo: 'aviso_mensagens_nutri', para, link }));
}
