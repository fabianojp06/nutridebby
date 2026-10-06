import { manifestoDoPainel } from '../manifesto-painel';

/**
 * P09-05: fora de /painel de propósito — o navegador busca o manifest sem cookie, e /painel é protegido no proxy
 * (sem cookie, redirect para /entrar). Conteúdo fixo, sem dado de ninguém.
 */
export function GET(): Response {
  return new Response(JSON.stringify(manifestoDoPainel()), {
    headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=3600' },
  });
}
