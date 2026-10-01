import type { Auth } from './auth';

type CookieDoAuth = { name: string; attributes: { path?: string; domain?: string; httpOnly?: boolean; secure?: boolean; sameSite?: string } };

function apagado({ name, attributes: a }: CookieDoAuth): string {
  return [
    `${name}=`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    `Path=${a.path ?? '/'}`,
    a.domain ? `Domain=${a.domain}` : '',
    a.httpOnly ? 'HttpOnly' : '',
    a.secure ? 'Secure' : '',
    a.sameSite ? `SameSite=${a.sameSite}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Os `Set-Cookie` que apagam os cookies de sessão do Better Auth (token, dados em cache e "não lembrar de mim"), com o
 * nome e os atributos que o login gravou: em produção o nome leva `__Secure-` e o cookie é `Secure`, e só um
 * `Set-Cookie` igual o apaga. Montados à mão porque, num Route Handler, o `cookies().set` do `nextCookies` (que o
 * `signOut` aciona) passa pelo `Set-Cookie` do Next, que descarta o `Max-Age=0` e deixaria um cookie vazio em vez de
 * apagado.
 */
export async function cookiesDeSessaoApagados(auth: Auth): Promise<string[]> {
  const { authCookies } = await auth.$context;
  return [authCookies.sessionToken, authCookies.sessionData, authCookies.dontRememberToken].map((c) => apagado(c as CookieDoAuth));
}
