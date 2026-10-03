import { urlDoApp } from '@/lib/url-do-app';
import { evolutionProvedor } from './evolution';
import type { ProvedorWhatsapp } from './provedor';
import { sandboxProvedor } from './sandbox';

export type ModoWhatsapp = 'evolution' | 'sandbox' | 'desligado';
type Ambiente = {
  APP_URL: string;
  EVOLUTION_API_URL?: string;
  EVOLUTION_API_KEY?: string;
  EVOLUTION_WEBHOOK_SECRET?: string;
  EVOLUTION_WEBHOOK_URL?: string;
  WHATSAPP_SANDBOX?: string;
  MAILPIT_URL?: string;
  EMAIL_FROM?: string;
};

export function modoWhatsapp(e: Ambiente): ModoWhatsapp {
  if (e.EVOLUTION_API_URL && e.EVOLUTION_API_KEY) return 'evolution';
  return e.WHATSAPP_SANDBOX === '1' ? 'sandbox' : 'desligado';
}

/** D1: o WhatsApp só liga com as variáveis da Evolution (ou o sandbox fora de produção); senão, null. */
export function provedorDoAmbiente(e: Ambiente, fetchImpl?: typeof fetch): ProvedorWhatsapp | null {
  switch (modoWhatsapp(e)) {
    case 'evolution':
      return evolutionProvedor({
        url: e.EVOLUTION_API_URL!,
        apiKey: e.EVOLUTION_API_KEY!,
        webhookUrl: e.EVOLUTION_WEBHOOK_URL ?? urlDoApp(e.APP_URL, '/api/webhooks/whatsapp'),
        webhookSecret: e.EVOLUTION_WEBHOOK_SECRET,
        fetchImpl,
      });
    case 'sandbox':
      return sandboxProvedor({ mailpitUrl: e.MAILPIT_URL, from: e.EMAIL_FROM, fetchImpl });
    default:
      return null;
  }
}
