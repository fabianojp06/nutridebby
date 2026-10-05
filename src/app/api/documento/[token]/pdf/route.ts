import { signFileUrl } from '@/lib/signed-url';
import { pdfDoLink } from '@/modules/documentos/link-documento';
import { SEM_CACHE } from '../../../n/[slug]/resposta';
import { depsDoLink, sessaoDoCookie } from '../link';

export const dynamic = 'force-dynamic';

/**
 * "Abrir PDF" pela página do link: com a sessão do próprio token, a URL assinada nasce no clique (303). Sem sessão válida
 * (os 15 min venceram com a página aberta) ou com o link indisponível, 303 de volta à página do link, que pede o código
 * de novo ou mostra o aviso (revisão da T12: nunca um 404 vazio). O token vai codificado no Location.
 */
export async function GET(req: Request, { params }: RouteContext<'/api/documento/[token]/pdf'>) {
  const { token } = await params;
  const caminho = await pdfDoLink(token, sessaoDoCookie(req), depsDoLink(req));
  if (!caminho) return new Response(null, { status: 303, headers: { location: `/documento/${encodeURIComponent(token)}`, ...SEM_CACHE } });
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), ...SEM_CACHE } });
}
