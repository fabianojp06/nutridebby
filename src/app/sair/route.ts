import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { sanitizarErroDeBanco } from '@/db/errors';
import { session } from '@/db/schema';
import { getEnv } from '@/env';
import { getAuth } from '@/lib/auth';
import { logger, nomeDoErro } from '@/lib/logger';
import { cookieDoVinculoApagado, cookieVinculoSeguro } from '@/lib/paciente-session';
import { cookiesDeSessaoApagados } from '@/lib/sessao-cookies';

// Aonde o formulário do botão "Sair" leva: o login, ou a página de falha (sessão não apagada, cookie mantido).
// Sem `export`: num Route Handler o Next só aceita como export os verbos e as opções de rota.
const SAIR_DESTINO = '/entrar';
const SAIR_ERRO_PATH = '/sair/erro';

const redirecionar = (para: string, cookies: string[] = [], limparAparelho = false): Response => {
  const h = new Headers({ location: para, 'cache-control': 'no-store' });
  for (const c of cookies) h.append('set-cookie', c);
  // D6 (Plano 06): o plano guardado offline, o service worker e a inscrição de push do aparelho saem junto com a sessão
  if (limparAparelho) h.set('clear-site-data', '"cache", "storage"');
  return new Response(null, { status: 303, headers: h });
};

/**
 * CSRF: sair é um POST que muda estado e o cookie de sessão vai sozinho. Vale só o `Origin` igual à origem do
 * APP_URL; sem `Origin` (alguns navegadores omitem em POST do mesmo site), só com `Sec-Fetch-Site: same-origin`.
 */
function origemPermitida(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (origin !== null) return origin === new URL(getEnv().APP_URL).origin;
  return req.headers.get('sec-fetch-site') === 'same-origin';
}

/**
 * Botão "Sair" (todas as áreas logadas): `<form method="post" action="/sair">`, que recarrega a página inteira — também
 * quando outra aba já saiu e o cookie sumiu (um Server Action receberia o 307 do proxy e mostraria "Application error").
 *
 * Com sessão: apaga a linha de `session` AQUI, sem engolir o erro (o signOut do Better Auth engole falha de banco e
 * ainda apaga o cookie: o cookie sumiria com a sessão viva no servidor), e só depois apaga o cookie (`Set-Cookie` com
 * o nome e os atributos do login, em dev e em produção). Falhou: mantém o cookie e vai para /sair/erro. Sem sessão
 * (cookie ausente, inválido ou de sessão que já foi): só limpa o cookie e vai para o login. A tabela `session` não tem
 * `tenant_id` (fora da RLS).
 */
export async function POST(req: Request): Promise<Response> {
  if (!origemPermitida(req)) return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  const auth = getAuth();
  try {
    const atual = await auth.api.getSession({ headers: req.headers, query: { disableRefresh: true } });
    if (atual) await getDb().delete(session).where(eq(session.token, atual.session.token));
    // sem `auth.api.signOut`: ele engole falha de banco e o `nextCookies` dele reescreve o `Set-Cookie` sem o `Max-Age=0`
    return redirecionar(SAIR_DESTINO, [...(await cookiesDeSessaoApagados(auth)), cookieDoVinculoApagado(cookieVinculoSeguro())], true);
  } catch (err) {
    // RNF-11: o DrizzleQueryError leva o SQL e os parâmetros (o token da sessão); só o motivo sanitizado vai para o log
    const limpo = sanitizarErroDeBanco(err);
    logger.error({ motivo: limpo ? limpo.message : nomeDoErro(err) }, 'não foi possível encerrar a sessão');
    return redirecionar(SAIR_ERRO_PATH);
  }
}
