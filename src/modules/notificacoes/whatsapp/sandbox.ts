import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { mailpitTransport } from '@/email/transport';
import type { ProvedorWhatsapp } from './provedor';

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * D1/D26: WhatsApp de mentira para dev, CI e E2E — a mensagem vira e-mail no Mailpit (`<número>@whatsapp.sandbox`).
 * Números terminados em 0000 = "sem WhatsApp"; em 9999 = serviço fora do ar. Nunca em produção (env.ts recusa).
 */
export function sandboxProvedor(o: { mailpitUrl?: string; from?: string; fetchImpl?: typeof fetch }): ProvedorWhatsapp {
  return {
    nome: 'sandbox',
    async enviarTexto(e) {
      if (!o.mailpitUrl || !o.from) throw new Error('sandbox do WhatsApp sem MAILPIT_URL/EMAIL_FROM');
      if (e.numero.endsWith('0000')) return { ok: false, definitivo: true, codigo: 'numero_sem_whatsapp' };
      if (e.numero.endsWith('9999')) return { ok: false, definitivo: false, codigo: 'indisponivel' };
      await mailpitTransport(o.mailpitUrl, o.fetchImpl).send({
        from: o.from,
        to: `${e.numero}@whatsapp.sandbox`,
        subject: `WhatsApp (${e.instancia})`,
        html: `<pre>${escapar(e.texto)}</pre>`,
        text: e.texto,
        idempotencyKey: randomUUID(),
      });
      return { ok: true, id: `sandbox-${randomUUID()}`, jid: `${e.numero}@s.whatsapp.net` };
    },
    async conectar(instancia) {
      return { estado: 'qr', qr: await QRCode.toDataURL(`nutridebby-sandbox:${instancia}`) };
    },
    async estado() {
      return null;
    },
    async desconectar() {},
  };
}
