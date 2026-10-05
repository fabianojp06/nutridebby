import { signFileUrl } from '@/lib/signed-url';
import { pdfDoLink } from '@/modules/documentos/link-documento';
import { SEM_CACHE } from '../../../n/[slug]/resposta';
import { depsDoLink, sessaoDoCookie } from '../link';

export const dynamic = 'force-dynamic';

/** "Abrir PDF" pela página do link: com a sessão do próprio token, a URL assinada nasce no clique (303); senão, 404. */
export async function GET(req: Request, { params }: RouteContext<'/api/documento/[token]/pdf'>) {
  const { token } = await params;
  const caminho = await pdfDoLink(token, sessaoDoCookie(req), depsDoLink(req));
  if (!caminho) return new Response(null, { status: 404, headers: SEM_CACHE });
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), ...SEM_CACHE } });
}
