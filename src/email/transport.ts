import { Resend } from 'resend';
import type { WorkerEnv } from '@/env';

export type OutgoingEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Id do job: repetição do mesmo job não duplica o e-mail no Resend. */
  idempotencyKey: string;
  /** Plano 23 (RN-434): cabeçalhos extras (List-Unsubscribe e List-Unsubscribe-Post do aniversário); sem eles, nada muda. */
  headers?: Record<string, string>;
};

export interface EmailTransport {
  send(e: OutgoingEmail): Promise<void>;
}

export class EmailSendError extends Error {
  override name = 'EmailSendError';
}

export function parseFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { ...(m[1] ? { name: m[1] } : {}), email: m[2] } : { email: from.trim() };
}

export function resendTransport(apiKey: string, client: Pick<Resend, 'emails'> = new Resend(apiKey)): EmailTransport {
  return {
    async send(e) {
      const { error } = await client.emails.send(
        { from: e.from, to: e.to, subject: e.subject, html: e.html, text: e.text, ...(e.headers ? { headers: e.headers } : {}) },
        { idempotencyKey: e.idempotencyKey },
      );
      if (error) throw new EmailSendError(`Resend recusou o envio: ${error.name} (${error.statusCode ?? 'sem status'})`);
    },
  };
}

export function mailpitTransport(baseUrl: string, fetchImpl: typeof fetch = fetch): EmailTransport {
  return {
    async send(e) {
      const from = parseFrom(e.from);
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/v1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: { Email: from.email, Name: from.name ?? '' },
          To: [{ Email: e.to }],
          Subject: e.subject,
          HTML: e.html,
          Text: e.text,
          ...(e.headers ? { Headers: e.headers } : {}),
        }),
      });
      if (!res.ok) throw new EmailSendError(`Mailpit recusou o envio: HTTP ${res.status}`);
    },
  };
}

export function transportFromEnv(env: WorkerEnv): EmailTransport {
  return env.EMAIL_TRANSPORT === 'resend' ? resendTransport(env.RESEND_API_KEY!) : mailpitTransport(env.MAILPIT_URL!);
}
