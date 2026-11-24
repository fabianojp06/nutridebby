import { getEnv } from '@/env';
import { urlDoApp } from '@/lib/url-do-app';
import { formatoDoLinkDeSaida } from '@/modules/agenda/aniversario-link';
import { retirarPeloLink } from '@/modules/agenda/aniversarios';

export const dynamic = 'force-dynamic';

const SEM_CACHE = { 'cache-control': 'no-store' } as const;
const vazio = (status: number) => new Response(null, { status, headers: SEM_CACHE });

/** O corpo do POST: o formulário da página (`origem=pagina`) ou o do RFC 8058 (`List-Unsubscribe=One-Click`); outro → nada. */
async function origemDoCorpo(req: Request): Promise<'pagina' | 'um_clique' | null> {
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return null;
  }
  if (fd.get('origem') === 'pagina') return 'pagina';
  return fd.get('List-Unsubscribe') === 'One-Click' ? 'um_clique' : null;
}

/**
 * Plano 23 (RN-434, AG-D51, AG-D71): a retirada da autorização de aniversário pelo link do e-mail. É a URL do
 * `List-Unsubscribe` (o provedor de e-mail faz o POST de um clique, RFC 8058, sem cookie e de outra origem: a pasta
 * `aniversario` fica fora da guarda de mesma origem; vale o token HMAC) e o destino do "Confirmar" da página (formulário
 * sem JavaScript, `origem=pagina`). Um clique → 200 sem corpo (também com o token que não confere: nada é revelado);
 * página → 303 para ela, com `?ok=1` ou `?erro=limite`. Limite por token, nunca por IP. Nada de nome, e-mail ou token
 * em log; o token só vai ao Location depois de conferido o formato.
 */
export async function POST(req: Request, { params }: RouteContext<'/api/aniversario/sair/[token]'>) {
  const { token } = await params;
  const origem = await origemDoCorpo(req);
  if (!origem) return vazio(400);
  if (!formatoDoLinkDeSaida(token)) return origem === 'pagina' ? vazio(404) : vazio(200);
  const r = await retirarPeloLink(token);
  if (origem === 'um_clique') return vazio(r === 'limite' ? 429 : 200);
  const volta = r === 'limite' ? '?erro=limite' : '?ok=1';
  return new Response(null, { status: 303, headers: { location: urlDoApp(getEnv().APP_URL, `/aniversario/sair/${token}${volta}`), ...SEM_CACHE } });
}
