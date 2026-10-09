import { openSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { EMAIL_FINALIDADE } from './queue';
import { renderEmail } from './templates';
import type { EmailTransport } from './transport';
import type { EmailJobData, EmailMessage } from './types';

/** RN-128 (Plano 14A): tipos que saíram do código — um job antigo na fila termina sem enviar e sem gravar nada. */
const TIPOS_LEGADOS = new Set(['aviso_ia']);

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
  if (TIPOS_LEGADOS.has((msg as { tipo: string }).tipo)) {
    logger.info({ jobId, tipo: (msg as { tipo: string }).tipo, tenantId: data.tenantId }, 'e-mail de tipo legado descartado (RN-128)');
    return 'ignorado';
  }
  // Erro aqui sobe para o pg-boss, que tenta de novo (retryLimit da fila)
  const r = renderEmail(msg);
  await deps.transport.send({ from: deps.from, to: msg.para, subject: r.subject, html: r.html, text: r.text, idempotencyKey: jobId });
  logger.info({ jobId, tipo: msg.tipo, tenantId: data.tenantId }, 'e-mail enviado'); // sem destinatário nem link
  return 'enviado';
}
