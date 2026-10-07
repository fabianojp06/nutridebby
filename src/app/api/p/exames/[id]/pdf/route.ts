import { requireApiPaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { pdfDoMeuEnvio } from '@/modules/portal/exames-enviados';

export const dynamic = 'force-dynamic';

const naoEncontrado = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

/**
 * US-161 / D17 = a: o próprio PDF limpo enquanto o envio aguarda a revisão. A leitura é auditada no módulo (D22) e a URL
 * assinada (5 min) nasce no clique, nunca no HTML guardado (como /api/p/documentos/[id]/pdf).
 */
export async function GET(req: Request, { params }: RouteContext<'/api/p/exames/[id]/pdf'>): Promise<Response> {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  const caminho = await pdfDoMeuEnvio(acesso.ctx, id);
  if (!caminho) return naoEncontrado();
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), 'cache-control': 'no-store' } });
}
