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

const TRINTA_DIAS_S = 30 * 24 * 60 * 60;

/** "lax" → "Lax": a mesma grafia do `Set-Cookie` do login. */
const capitalizado = (v: string) => `${v[0].toUpperCase()}${v.slice(1).toLowerCase()}`;

/**
 * P06-11 (adiado do Plano 01, rodada 3): o banco já desliza a sessão do paciente em requireUser, mas o cookie tinha
 * `Max-Age` fixo desde o login. Reemite o MESMO valor (token assinado) com o nome e os atributos do login e 30 dias
 * a partir de agora. Só chamar com a sessão já validada (requireApiPaciente).
 */
export async function cookieDeSessaoRenovado(auth: Auth, cabecalhoCookie: string | null): Promise<string | null> {
  const { authCookies } = await auth.$context;
  const { name, attributes: a } = authCookies.sessionToken as CookieDoAuth;
  const valor = (cabecalhoCookie ?? '')
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  if (!valor) return null;
  return [
    `${name}=${valor}`,
    `Max-Age=${TRINTA_DIAS_S}`,
    `Path=${a.path ?? '/'}`,
    a.domain ? `Domain=${a.domain}` : '',
    a.httpOnly ? 'HttpOnly' : '',
    a.secure ? 'Secure' : '',
    a.sameSite ? `SameSite=${capitalizado(a.sameSite)}` : '',
  ]
    .filter(Boolean)
    .join('; ');
}
