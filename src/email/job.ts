import { openSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { EMAIL_FINALIDADE } from './queue';
import { renderEmail } from './templates';
import type { EmailTransport } from './transport';
import type { EmailJobData, EmailMessage } from './types';

export async function processEmailJob(
  data: EmailJobData,
  jobId: string,
  deps: { transport: EmailTransport; from: string; tenantAtivo: (tenantId: string) => Promise<boolean>; key?: Buffer },
): Promise<'enviado' | 'ignorado'> {
  if (data.tenantId && !(await deps.tenantAtivo(data.tenantId))) {
    logger.info({ jobId, tenantId: data.tenantId }, 'e-mail ignorado: conta suspensa (RN-15)');
    return 'ignorado';
  }
  const msg = JSON.parse(openSecret(data.selado, EMAIL_FINALIDADE, deps.key)) as EmailMessage;
  const r = renderEmail(msg);
  // Erro aqui sobe para o pg-boss, que tenta de novo (retryLimit da fila)
  await deps.transport.send({ from: deps.from, to: msg.para, subject: r.subject, html: r.html, text: r.text, idempotencyKey: jobId });
  logger.info({ jobId, tipo: msg.tipo, tenantId: data.tenantId }, 'e-mail enviado'); // sem destinatário nem link
  return 'enviado';
}
