import { requireApiPaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { caminhoDoPdfNoPortal } from '@/modules/documentos/portal';

export const dynamic = 'force-dynamic';

const naoEncontrado = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

/**
 * US-146 "Abrir PDF": registra a abertura (uma vez) e redireciona para a URL assinada (5 min), que nasce no clique, nunca
 * no HTML guardado (como /api/p/plano/pdf). D20: com o interruptor do admin desligado, 404 (o módulo confere de novo).
 */
export async function GET(req: Request, { params }: RouteContext<'/api/p/documentos/[id]/pdf'>): Promise<Response> {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  if (!acesso.tenant.documentosLiberados) return naoEncontrado();
  const { id } = await params;
  const caminho = await caminhoDoPdfNoPortal(acesso.ctx, id);
  if (!caminho) return naoEncontrado();
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), 'cache-control': 'no-store' } });
}
