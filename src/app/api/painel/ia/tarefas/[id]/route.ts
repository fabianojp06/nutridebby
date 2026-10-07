import { requireApiNutri } from '@/lib/tenant-session';
import { estadoDaTarefa } from '@/modules/ia/tarefas';

export const dynamic = 'force-dynamic';

/**
 * RNF-100: o painel consulta a situação a cada 3 s. Sem auditoria (só status), sem conteúdo, sem cache. P12-14: polling
 * não é uso — confere a sessão sem renovar.
 */
export async function GET(req: Request, { params }: RouteContext<'/api/painel/ia/tarefas/[id]'>): Promise<Response> {
  const a = await requireApiNutri(req, { renovar: false });
  if (!a.ok) return a.response;
  const { id } = await params;
  const e = await estadoDaTarefa(a.ctx, id);
  if (!e) return Response.json({ erro: 'Não encontrada' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return Response.json(e, { headers: { 'Cache-Control': 'no-store' } });
}
