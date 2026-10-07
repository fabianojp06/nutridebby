import { openSecret } from '@/lib/crypto';
import { logger, nomeDoErro } from '@/lib/logger';
import { EMAIL_FINALIDADE } from './queue';
import { renderEmail } from './templates';
import type { EmailTransport } from './transport';
import type { EmailJobData, EmailMessage } from './types';

export async function processEmailJob(
  data: EmailJobData,
  jobId: string,
  deps: {
    transport: EmailTransport;
    from: string;
    tenantAtivo: (tenantId: string) => Promise<boolean>;
    key?: Buffer;
    aposEnviar?: (msg: EmailMessage, tenantId: string | null) => Promise<void>;
    /** O pg-boss não tenta de novo depois desta execução (retryCount >= retryLimit). */
    ultimaTentativa?: boolean;
    /**
     * Code review do PR #23: o job termina SEM o passo pós-envio — conta suspensa (ignorado) ou última tentativa com falha
     * no envio ou no pós-envio. Hoje só o aviso de IA usa: desfaz o "aguardando" para a tela não esperar para sempre.
     */
    aoDesistir?: (msg: EmailMessage, tenantId: string | null) => Promise<void>;
  },
): Promise<'enviado' | 'ignorado'> {
  const abrir = () => JSON.parse(openSecret(data.selado, EMAIL_FINALIDADE, deps.key)) as EmailMessage;
  if (data.tenantId && !(await deps.tenantAtivo(data.tenantId))) {
    logger.info({ jobId, tenantId: data.tenantId }, 'e-mail ignorado: conta suspensa (RN-15)');
    // o job termina aqui (sem nova tentativa): uma falha ao desistir sobe para o pg-boss, que tenta de novo
    if (deps.aoDesistir) await deps.aoDesistir(abrir(), data.tenantId);
    return 'ignorado';
  }
  const msg = abrir();
  try {
    const r = renderEmail(msg);
    // Erro aqui sobe para o pg-boss, que tenta de novo (retryLimit da fila)
    await deps.transport.send({ from: deps.from, to: msg.para, subject: r.subject, html: r.html, text: r.text, idempotencyKey: jobId });
    logger.info({ jobId, tipo: msg.tipo, tenantId: data.tenantId }, 'e-mail enviado'); // sem destinatário nem link
    // D5 (Plano 11): passo de domínio depois do envio aceito — hoje só o aviso de IA; uma falha aqui relança e o pg-boss
    // tenta de novo; o Resend não duplica o e-mail pela idempotencyKey = jobId
    if (deps.aposEnviar) await deps.aposEnviar(msg, data.tenantId);
    return 'enviado';
  } catch (err) {
    if (deps.ultimaTentativa && deps.aoDesistir) {
      // sem nova tentativa: desfaz o estado pendente; o erro original é o que sobe (só o nome vai ao log, RNF-11)
      await deps.aoDesistir(msg, data.tenantId).catch((e: unknown) => logger.error({ jobId, tipo: msg.tipo, tenantId: data.tenantId, err: nomeDoErro(e) }, 'falha ao desistir do e-mail'));
    }
    throw err;
  }
}
