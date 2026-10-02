import { parse as parseLegado } from 'node:url';
import webpush from 'web-push';
import { pedidoNaoSaiu } from '@/lib/rede';

/*
 * INT-03 / D19: envio de push com `web-push` + VAPID — SÓ no worker (R1): nenhuma rota do Next importa este arquivo
 * (guarda em push.test.ts). O payload chega cifrado ao dispositivo (aes128gcm); nada daqui vai para log (endpoint,
 * chaves e payload).
 */

export type InscricaoPush = { endpoint: string; p256dh: string; auth: string };
/**
 * `remover`: inscrição morta ou inválida (404/410, endereço fora dos serviços de push, chaves que não cifram) — apagar.
 * `definitivo`: não adianta tentar de novo. `incerto`: o pedido pode ter sido aceito (timeout, conexão caída depois de
 * enviar, exceção do provedor) — nunca repete, nem por causa de outro dispositivo do mesmo paciente (D6).
 */
export type ResultadoPush = { ok: true } | { ok: false; remover: boolean; definitivo: boolean; codigo: string; incerto?: boolean };
export interface ProvedorPush {
  enviar(i: InscricaoPush, payload: string, ttlS: number): Promise<ResultadoPush>;
}

/**
 * Rodada 1 da revisão: os serviços de push dos navegadores — Chrome/Edge/Android (FCM), Firefox (Mozilla), Safari
 * (Apple) e Windows (WNS). O endpoint vem do navegador do paciente (P06-02): o worker só faz POST para estes hosts.
 * `*.` = só subdomínios (`web.push.apple.com`), nunca o domínio sozinho nem algo que só termine com o texto.
 */
export const SERVICOS_DE_PUSH = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', '*.push.apple.com', '*.notify.windows.com'] as const;

/** Rodada 2: host só de rótulos LDH (letras, dígitos, hífen) separados por ponto — nada que um leitor de URL corte. */
const HOST_LDH = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * O endpoint é de um serviço de push conhecido? Só `https:`, porta padrão, sem usuário/senha, forma canônica e host
 * só com rótulos LDH. Rodada 2: o `web-push` relê o endereço com o `url.parse` antigo (para o `aud` do VAPID e para o
 * `https.request`), que corta o host em caracteres que o WHATWG aceita (`;` `'` `"` `` ` `` `{` `}`):
 * `https://127.0.0.1;.push.apple.com/x` termina com `.push.apple.com` para o `new URL`, mas seria discado em
 * 127.0.0.1. Por isso, além do LDH, os dois leitores precisam concordar no host. Senão (IP, nome interno da rede do
 * Easypanel, `localhost`, parecido como `fcm.googleapis.com.evil.tld`): não envia.
 */
export function endpointDePush(endpoint: string): boolean {
  if (!URL.canParse(endpoint)) return false;
  const u = new URL(endpoint);
  if (u.protocol !== 'https:' || u.username || u.password || u.port !== '' || u.href !== endpoint || !HOST_LDH.test(u.hostname)) return false;
  const legado = parseLegado(endpoint); // o mesmo leitor do web-push
  if (legado.host !== u.host || legado.hostname !== u.hostname) return false;
  return SERVICOS_DE_PUSH.some((s) => (s.startsWith('*.') ? u.hostname.endsWith(s.slice(1)) && u.hostname.length > s.length - 1 : u.hostname === s));
}

/** INT-03: o serviço de push tem 10 s para aceitar (como o WhatsApp, INT-01). */
const TIMEOUT_MS = 10_000;

type Vapid = { publicKey: string; privateKey: string; subject: string };

/** As opções do pedido — as mesmas para montar (conferência local) e para enviar. */
export function opcoesDeEnvio(o: Vapid, ttlS: number) {
  return {
    vapidDetails: { subject: o.subject, publicKey: o.publicKey, privateKey: o.privateKey },
    TTL: ttlS,
    timeout: TIMEOUT_MS,
    urgency: 'normal' as const,
  };
}

const assinatura = (i: InscricaoPush) => ({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } });

/**
 * INT-03: `web-push` com VAPID. Antes da rede: endpoint fora de SERVICOS_DE_PUSH ou pedido que não se monta com as
 * chaves da inscrição (p256dh fora da curva, auth curta — a configuração do VAPID já foi conferida na criação) →
 * inscrição inválida, apagar, nada sai. Na rede: 404/410 = inscrição morta (apagar); outro 4xx = definitivo; 429 e
 * 5xx = o serviço respondeu que não aceitou, tentar de novo. Sem resposta HTTP, D6 (no máximo uma vez, como o
 * WhatsApp): só repete se o pedido nem saiu (conexão recusada, DNS, rota); timeout e conexão caída depois de enviar
 * podem ter entregado (`incerto`).
 */
export function webPushProvedor(o: Vapid & { enviar?: typeof webpush.sendNotification }): ProvedorPush {
  // a configuração do VAPID inválida derruba aqui (subida do worker), não apaga inscrições depois (src/env.ts já confere)
  webpush.getVapidHeaders('https://fcm.googleapis.com', o.subject, o.publicKey, o.privateKey, 'aes128gcm');
  const enviar = o.enviar ?? webpush.sendNotification;
  return {
    async enviar(i, payload, ttlS) {
      if (!endpointDePush(i.endpoint)) return { ok: false, remover: true, definitivo: true, codigo: 'endpoint_recusado' };
      const opcoes = opcoesDeEnvio(o, ttlS);
      try {
        webpush.generateRequestDetails(assinatura(i), payload, opcoes); // só monta e cifra, sem rede
      } catch {
        return { ok: false, remover: true, definitivo: true, codigo: 'inscricao_invalida' };
      }
      try {
        await enviar(assinatura(i), payload, opcoes);
        return { ok: true };
      } catch (e) {
        const status = (e as { statusCode?: unknown } | null)?.statusCode;
        if (typeof status !== 'number') {
          return pedidoNaoSaiu(e) ? { ok: false, remover: false, definitivo: false, codigo: 'rede' } : { ok: false, remover: false, definitivo: true, incerto: true, codigo: 'sem_resposta' };
        }
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
