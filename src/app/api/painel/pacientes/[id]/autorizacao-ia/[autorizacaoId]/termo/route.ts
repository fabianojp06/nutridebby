import { signFileUrl } from '@/lib/signed-url';
import { requireApiNutri } from '@/lib/tenant-session';
import { caminhoDoTermo } from '@/modules/ia/autorizacao';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/**
 * US-108 "Ver termo assinado": `caminhoDoTermo` grava o auditRead (entidade ia_autorizacao) e a rota responde 303 para a
 * URL assinada de 5 min (signFileUrl, regra 9). Id inválido, de outro paciente ou de outro consultório → 404.
 */
export async function GET(req: Request, { params }: RouteContext<'/api/painel/pacientes/[id]/autorizacao-ia/[autorizacaoId]/termo'>) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id, autorizacaoId } = await params;
  const caminho = await caminhoDoTermo(acesso.ctx, id, autorizacaoId);
  if (!caminho) return new Response(null, { status: 404, headers: SEM_CACHE });
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), ...SEM_CACHE } });
}
