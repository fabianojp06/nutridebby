import { requireApiNutri } from '@/lib/tenant-session';
import { estadoDaGeracao } from '@/modules/ia/modelos-sugeridos';

export const dynamic = 'force-dynamic';

/**
 * US-123 / RNF-100: o painel (Configurações › Modelos sugeridos pela IA) consulta a situação do pacote. Sem auditoria
 * (só status; a geração não tem paciente), sem conteúdo, sem cache. P12-14: polling não é uso — confere a sessão sem renovar.
 */
export async function GET(req: Request, { params }: RouteContext<'/api/painel/ia/geracoes/[id]'>): Promise<Response> {
  const a = await requireApiNutri(req, { renovar: false });
  if (!a.ok) return a.response;
  const { id } = await params;
  const e = await estadoDaGeracao(a.ctx, id);
  if (!e) return Response.json({ erro: 'Não encontrada' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return Response.json(e, { headers: { 'Cache-Control': 'no-store' } });
}
