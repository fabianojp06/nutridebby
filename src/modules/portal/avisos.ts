import type { Tx } from '@/db/client';
import { notifications, type PatientRow } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import { urlDoApp } from '@/lib/url-do-app';
import { dispararEnvio } from '@/modules/notificacoes/agendar';

/**
 * US-025 (adiado do Plano 04): ao publicar, o paciente com acesso ao portal recebe o push e o e-mail "Seu novo plano
 * alimentar está disponível" — na mesma transação da publicação. Sem conta (convite não aceito) ou fora de "ativo": nada.
 * Nenhum dado de saúde no texto (RNF-11).
 */
export async function avisarPlanoNovo(tx: Tx, p: Pick<PatientRow, 'id' | 'tenantId' | 'email' | 'userId' | 'status'>, agora: Date, appUrl: string): Promise<void> {
  if (!p.userId || p.status !== 'ativo') return;
  await tx.insert(notifications).values({ tenantId: p.tenantId, patientId: p.id, canal: 'push', tipo: 'plano_novo', agendadaPara: agora });
  await enqueueEmail({ tipo: 'plano_novo', para: p.email, link: urlDoApp(appUrl, '/p/plano') }, { tenantId: p.tenantId, tx });
  await dispararEnvio(tx, p.tenantId);
}

/** US-043 / D13: o primeiro comentário da nutricionista vira o push "Sua nutricionista comentou seu diário". */
export async function avisarComentario(tx: Tx, o: { tenantId: string; patientId: string }, agora: Date): Promise<void> {
  await tx.insert(notifications).values({ tenantId: o.tenantId, patientId: o.patientId, canal: 'push', tipo: 'comentario_diario', agendadaPara: agora });
  await dispararEnvio(tx, o.tenantId);
}
