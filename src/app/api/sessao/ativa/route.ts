import { lerSessaoApi, requireApiUser, type ApiAuth } from '@/lib/api-auth';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { prazosDaRequisicao } from '@/lib/sessao-prazos';
import { estadoDaSessao, type AppRole } from '@/lib/session-rules';

export const dynamic = 'force-dynamic';

/**
 * Só a equipe: o paciente (30 dias, PWA) não tem aviso de inatividade e recebe 403. Plano 26 (RE-D67, RN-501): a recepção
 * tem os prazos da equipe, o aviso e a renovação pelo uso (a desativada recebe 403).
 */
const EQUIPE: readonly AppRole[] = ['admin', 'nutri', 'recepcao'];

/** Quanto falta (ms relativos) e os prazos — nada de dado pessoal, sem cache. */
function estado(req: Request, a: ApiAuth & { ok: true }): Response {
  return Response.json(estadoDaSessao(a.data.session, new Date(), prazosDaRequisicao(req.headers)), { headers: { 'cache-control': 'no-store' } });
}

/**
 * P12-14 (RNF-06): o relógio do aviso de inatividade pergunta quanto falta, sem renovar a sessão — perguntar não é uso.
 * Sessão ociosa (> 30 min), acima de 8 h ou de outro papel: a mesma recusa de toda rota (401/403).
 */
export async function GET(req: Request): Promise<Response> {
  const a = await lerSessaoApi(req, EQUIPE);
  return a.ok ? estado(req, a) : a.response;
}

/**
 * P12-14: uso real na tela (tecla, clique, rolagem, toque) em qualquer aba do painel ou do admin, e o botão "Continuar
 * conectada" do aviso. A tela chama no máximo 1 vez a cada 5 min (sincronizada entre as abas); aqui a renovação segue a
 * mesma cadência de requireUser. Sessão já expirada nunca é renovada (401).
 */
export async function POST(req: Request): Promise<Response> {
  if (!mesmaOrigem(req)) return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  const a = await requireApiUser(req, EQUIPE);
  return a.ok ? estado(req, a) : a.response;
}
