import { requireApiNutri } from '@/lib/tenant-session';
import { equivalentes } from '@/modules/alimentos/busca-avancada';
import { ehChaveDoCriterio, lerFiltrosDaBusca } from '@/modules/alimentos/busca-avancada-constantes';
import { idValido } from '@/modules/pacientes/base';
import { lerQuantidade } from '@/modules/plano-alimentar/calculo';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/**
 * RN-242 (US-234): equivalentes de um item do plano (`foodId` e `quantidadeG`, 0,1 a 5000 g, vírgula ou ponto),
 * igualando por energia (padrão) ou por `igualarPor` (macro ou chave do catálogo), com filtro de `fonte` opcional.
 * Alimento que o consultório não vê (RLS) = 404.
 */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const p = new URL(req.url).searchParams;
  const foodId = p.get('foodId');
  const quantidadeG = lerQuantidade(p.get('quantidadeG'));
  const igualarPor = p.get('igualarPor') ?? 'kcal';
  const filtros = lerFiltrosDaBusca(p);
  if (!idValido(foodId) || quantidadeG === null || !ehChaveDoCriterio(igualarPor) || !filtros) {
    return Response.json({ erro: 'Pedido inválido.' }, { status: 400, headers: SEM_CACHE });
  }
  const r = await equivalentes(acesso.ctx, { foodId, quantidadeG, igualarPor, fontes: filtros.fontes });
  if (!r) return Response.json({ erro: MSG_PLANO.alimento }, { status: 404, headers: SEM_CACHE });
  return Response.json(r, { headers: SEM_CACHE });
}
