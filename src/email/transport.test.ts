import { describe, expect, it, vi } from 'vitest';
import type { Resend } from 'resend';
import { EmailSendError, mailpitTransport, parseFrom, resendTransport, type OutgoingEmail } from './transport';

const email: OutgoingEmail = {
  from: 'NutriDebby <nao-responda@exemplo.com>',
  to: 'debby@exemplo.com',
  subject: 'Assunto',
  html: '<p>oi</p>',
  text: 'oi',
  idempotencyKey: 'job-1',
};

describe('parseFrom', () => {
  it('separa nome e endereço', () => {
    expect(parseFrom('NutriDebby <nao-responda@exemplo.com>')).toEqual({ name: 'NutriDebby', email: 'nao-responda@exemplo.com' });
    expect(parseFrom('nao-responda@exemplo.com')).toEqual({ email: 'nao-responda@exemplo.com' });
  });
});

describe('mailpitTransport (dev/CI)', () => {
  it('usa a API de envio do Mailpit', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ID":"x"}', { status: 200 }));
    await mailpitTransport('http://localhost:8025', fetchImpl).send(email);
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8025/api/v1/send', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      From: { Email: 'nao-responda@exemplo.com', Name: 'NutriDebby' },
      To: [{ Email: 'debby@exemplo.com' }],
      Subject: 'Assunto',
      HTML: '<p>oi</p>',
      Text: 'oi',
    });
  });
  it('resposta de erro vira EmailSendError (o pg-boss tenta de novo)', async () => {
    const fetchImpl = vi.fn(async () => new Response('falhou', { status: 500 }));
    await expect(mailpitTransport('http://localhost:8025', fetchImpl).send(email)).rejects.toBeInstanceOf(EmailSendError);
  });
});

describe('resendTransport (produção)', () => {
  it('envia com Idempotency-Key = id do job', async () => {
    const send = vi.fn(async () => ({ data: { id: 'r1' }, error: null, headers: null }));
    const client = { emails: { send } } as unknown as Pick<Resend, 'emails'>;
    await resendTransport('re_x', client).send(email);
    expect(send).toHaveBeenCalledWith(
      { from: email.from, to: 'debby@exemplo.com', subject: 'Assunto', html: '<p>oi</p>', text: 'oi' },
      { idempotencyKey: 'job-1' },
    );
  });
  it('erro do Resend vira EmailSendError sem repetir o destinatário na mensagem', async () => {
    const send = vi.fn(async () => ({ data: null, error: { name: 'rate_limit_exceeded', message: 'x', statusCode: 429 }, headers: null }));
    const client = { emails: { send } } as unknown as Pick<Resend, 'emails'>;
    const err = (await resendTransport('re_x', client)
      .send(email)
      .catch((e: unknown) => e as Error)) as Error;
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.message).toContain('rate_limit_exceeded');
    expect(err.message).not.toContain('debby@exemplo.com');
  });
});

describe('Plano 23 (RN-434): cabeçalhos do e-mail (List-Unsubscribe)', () => {
  const headers = { 'List-Unsubscribe': '<https://app.exemplo.com/api/aniversario/sair/abc>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  it('chegam ao Resend (`headers`) e ao Mailpit (`Headers`)', async () => {
    const send = vi.fn(async () => ({ data: { id: 'r1' }, error: null, headers: null }));
    await resendTransport('re_x', { emails: { send } } as unknown as Pick<Resend, 'emails'>).send({ ...email, headers });
    expect(send).toHaveBeenCalledWith({ from: email.from, to: 'debby@exemplo.com', subject: 'Assunto', html: '<p>oi</p>', text: 'oi', headers }, { idempotencyKey: 'job-1' });
    const fetchImpl = vi.fn(async () => new Response('{"ID":"x"}', { status: 200 }));
    await mailpitTransport('http://localhost:8025', fetchImpl).send({ ...email, headers });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.Headers).toEqual(headers);
  });
  it('sem `headers`, nada muda para os chamadores de hoje (nem a chave aparece)', async () => {
    const send = vi.fn(async () => ({ data: { id: 'r1' }, error: null, headers: null }));
    await resendTransport('re_x', { emails: { send } } as unknown as Pick<Resend, 'emails'>).send(email);
    expect(Object.keys((send.mock.calls[0] as unknown as [Record<string, unknown>])[0])).not.toContain('headers');
    const fetchImpl = vi.fn(async () => new Response('{"ID":"x"}', { status: 200 }));
    await mailpitTransport('http://localhost:8025', fetchImpl).send(email);
    expect(Object.keys(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string))).not.toContain('Headers');
  });
});
