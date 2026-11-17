import { requireApiNutri } from '@/lib/tenant-session';
import { buscarAlimentos } from '@/modules/alimentos/busca';
import { buscarPorNutriente } from '@/modules/alimentos/busca-avancada';
import { ehChaveDoCriterio, ehDirecao, lerFiltrosDaBusca } from '@/modules/alimentos/busca-avancada-constantes';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/**
 * US-020: busca do editor e da tela "Alimentos" (tabelas públicas + alimentos do tenant). Plano 19 (diálogo "Buscar
 * alimento", US-234): `fonte` (pode repetir) e `grupo` filtram; com `nutriente` e `direcao` (`rico`/`pobre`) a busca é
 * por nutriente (RN-241) e a resposta traz o critério e o aviso. Parâmetro desconhecido = 400.
 */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const p = new URL(req.url).searchParams;
  const filtros = lerFiltrosDaBusca(p);
  const nutriente = p.get('nutriente');
  const direcao = p.get('direcao');
  if (!filtros || (nutriente !== null && (!ehChaveDoCriterio(nutriente) || !ehDirecao(direcao)))) {
    return Response.json({ erro: 'Pedido inválido.' }, { status: 400, headers: SEM_CACHE });
  }
  if (nutriente !== null && ehChaveDoCriterio(nutriente) && ehDirecao(direcao)) {
    return Response.json(await buscarPorNutriente(acesso.ctx, { chave: nutriente, direcao, ...filtros }), { headers: SEM_CACHE });
  }
  const resultados = await buscarAlimentos(acesso.ctx, p.get('q') ?? '', undefined, filtros);
  return Response.json({ resultados }, { headers: SEM_CACHE });
}
