import { requireApiPaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { caminhoDoPdfDoConteudo } from '@/modules/portal/conteudos';

export const dynamic = 'force-dynamic';

/** US-052 "Baixar material (PDF)": a URL assinada (5 min) nasce no clique; fora da audiência → 404 (D20). */
export async function GET(req: Request, { params }: RouteContext<'/api/p/conteudos/[id]/pdf'>): Promise<Response> {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  const caminho = await caminhoDoPdfDoConteudo(acesso.ctx, id);
  if (!caminho) return Response.json({ erro: 'Não encontrado' }, { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), 'cache-control': 'no-store' } });
}
