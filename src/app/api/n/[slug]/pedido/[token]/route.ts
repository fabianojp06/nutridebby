import { getEnv } from '@/env';
import { clientIpDoLimite } from '@/lib/ip';
import { urlDoApp } from '@/lib/url-do-app';
import { desistirDoPedidoPublico } from '@/modules/agenda/agendamento-publico';

export const dynamic = 'force-dynamic';

const SLUG = /^[a-z0-9-]{1,80}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Plano 23 (AG-D42, AG-D48, AG-D49): o botão "Desistir do pedido" da página do link (formulário POST, sem JavaScript).
 * Sem cookie nem sessão (pasta `n` fora da guarda de mesma origem): vale o token do próprio pedido (só o hash no banco) e
 * o limite por IP da página pública. Grava pela função do banco (o aviso à nutricionista sai uma vez só) e volta à página
 * (303), que mostra "Pedido cancelado." ou "Este link não é válido.". Slug ou token fora do formato → 404 (nada do
 * visitante vai ao Location). Nada de nome, e-mail, IP ou token em log.
 */
export async function POST(req: Request, { params }: RouteContext<'/api/n/[slug]/pedido/[token]'>) {
  const { slug, token } = await params;
  if (!SLUG.test(slug) || !TOKEN.test(token)) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  const env = getEnv();
  const r = await desistirDoPedidoPublico(slug, token, { confirmar: true, ip: clientIpDoLimite(req.headers, env.TRUSTED_PROXIES) });
  const volta = r.estado === 'limite' ? '?erro=limite' : '?ok=1';
  return new Response(null, { status: 303, headers: { location: urlDoApp(env.APP_URL, `/n/${slug}/pedido/${token}${volta}`), 'cache-control': 'no-store' } });
}
