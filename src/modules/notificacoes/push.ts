import webpush from 'web-push';
import { pedidoNaoSaiu } from '@/lib/rede';

/*
 * INT-03 / D19: envio de push com `web-push` + VAPID — SÓ no worker (R1): nenhuma rota do Next importa este arquivo
 * (guarda em push.test.ts). O payload chega cifrado ao dispositivo (aes128gcm); nada daqui vai para log (endpoint,
 * chaves e payload).
 */

export type InscricaoPush = { endpoint: string; p256dh: string; auth: string };
/** `remover`: inscrição morta (404/410), apagar. `definitivo`: não adianta tentar de novo — ou não se sabe se saiu (D6). */
export type ResultadoPush = { ok: true } | { ok: false; remover: boolean; definitivo: boolean; codigo: string };
export interface ProvedorPush {
  enviar(i: InscricaoPush, payload: string, ttlS: number): Promise<ResultadoPush>;
}

/** INT-03: o serviço de push tem 10 s para aceitar (como o WhatsApp, INT-01). */
const TIMEOUT_MS = 10_000;

/**
 * INT-03: `web-push` com VAPID. 404/410 = inscrição morta (apagar); outro 4xx = definitivo; 429 e 5xx = o serviço
 * respondeu que não aceitou, tentar de novo. Sem resposta HTTP, D6 (no máximo uma vez, como o WhatsApp): só repete se o
 * pedido nem saiu (conexão recusada, DNS, rota); timeout e conexão caída depois de enviar podem ter entregado.
 */
export function webPushProvedor(o: { publicKey: string; privateKey: string; subject: string; enviar?: typeof webpush.sendNotification }): ProvedorPush {
  const enviar = o.enviar ?? webpush.sendNotification;
  return {
    async enviar(i, payload, ttlS) {
      try {
        await enviar({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, payload, {
          vapidDetails: { subject: o.subject, publicKey: o.publicKey, privateKey: o.privateKey },
          TTL: ttlS,
          timeout: TIMEOUT_MS,
          urgency: 'normal',
        });
        return { ok: true };
      } catch (e) {
        const status = (e as { statusCode?: unknown } | null)?.statusCode;
        if (typeof status !== 'number') return pedidoNaoSaiu(e) ? { ok: false, remover: false, definitivo: false, codigo: 'rede' } : { ok: false, remover: false, definitivo: true, codigo: 'sem_resposta' };
        if (status === 404 || status === 410) return { ok: false, remover: true, definitivo: true, codigo: `http_${status}` };
        if (status >= 400 && status < 500 && status !== 429) return { ok: false, remover: false, definitivo: true, codigo: `http_${status}` };
        return { ok: false, remover: false, definitivo: false, codigo: `http_${status}` };
      }
    },
  };
}

/** Sem as três variáveis do VAPID (validadas juntas em src/env.ts), o push fica desligado: lembretes por e-mail e WhatsApp. */
export function pushDoAmbiente(e: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string }): ProvedorPush | null {
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY || !e.VAPID_SUBJECT) return null;
  return webPushProvedor({ publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT });
}
