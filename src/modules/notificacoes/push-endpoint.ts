import { parse as parseLegado } from 'node:url';

/*
 * O endereço de push que o navegador do paciente entrega (P06-02) é conferido aqui, sem o `web-push`: a rota do portal
 * que grava a inscrição (src/app/api/p/push) usa a mesma regra que o worker (push.ts) usa para enviar.
 */

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
