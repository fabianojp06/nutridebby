import { describe, expect, it } from 'vitest';
import { sandboxProvedor } from './sandbox';

describe('sandbox do WhatsApp (dev, CI, E2E)', () => {
  it('a mensagem vira e-mail no Mailpit para <número>@whatsapp.sandbox; finais 0000 e 9999 simulam falhas', async () => {
    const enviados: { url: string; corpo: { To: { Email: string }[]; Subject: string; Text: string } }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      enviados.push({ url, corpo: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const p = sandboxProvedor({ mailpitUrl: 'http://mailpit:8025', from: 'NutriDebby <x@y.dev>', fetchImpl: f });
    const r = await p.enviarTexto({ instancia: 'nd-t1', numero: '5511912345678', texto: 'Olá <b>Ana</b>' });
    expect(r).toMatchObject({ ok: true, jid: '5511912345678@s.whatsapp.net' });
    expect(enviados[0].corpo.To[0].Email).toBe('5511912345678@whatsapp.sandbox');
    expect(enviados[0].corpo.Subject).toBe('WhatsApp (nd-t1)');
    expect(enviados[0].corpo.Text).toBe('Olá <b>Ana</b>');
    expect(await p.enviarTexto({ instancia: 'nd-t1', numero: '5511900000000', texto: 'x' })).toEqual({ ok: false, definitivo: true, codigo: 'numero_sem_whatsapp' });
    expect(await p.enviarTexto({ instancia: 'nd-t1', numero: '5511999999999', texto: 'x' })).toEqual({ ok: false, definitivo: false, codigo: 'indisponivel' });
  });
  it('conectar devolve um QR de verdade (PNG em data URL); estado não tem informação (quem muda é o webhook assinado)', async () => {
    const p = sandboxProvedor({});
    const c = await p.conectar('nd-t1');
    expect(c.estado === 'qr' && c.qr.startsWith('data:image/png;base64,')).toBe(true);
    expect(await p.estado('nd-t1')).toBeNull();
  });
});
