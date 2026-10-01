import { requireApiNutri } from '@/lib/tenant-session';
import { buscarAlimentos } from '@/modules/alimentos/busca';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/** US-020: busca do editor e da tela "Alimentos" (TACO + alimentos do tenant). */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const q = new URL(req.url).searchParams.get('q');
  const resultados = await buscarAlimentos(acesso.ctx, q ?? '');
  return Response.json({ resultados }, { headers: SEM_CACHE });
}
