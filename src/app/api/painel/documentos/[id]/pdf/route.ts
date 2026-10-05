import { requireApiNutri } from '@/lib/tenant-session';
import { signFileUrl } from '@/lib/signed-url';
import { caminhoDoPdfNoPainel, estadoDoDocumento } from '@/modules/documentos/documentos';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/** US-143/144: `?estado=1` → JSON para o "Preparando o PDF…" (sem auditoria); `?base=1` → o PDF preparado; sem nada → o assinado. A URL assinada nasce no clique (303). */
export async function GET(req: Request, { params }: RouteContext<'/api/painel/documentos/[id]/pdf'>) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  if (!acesso.tenant.documentosLiberados) return new Response(null, { status: 404, headers: SEM_CACHE });
  const { id } = await params;
  const url = new URL(req.url);
  if (url.searchParams.get('estado') === '1') {
    const e = await estadoDoDocumento(acesso.ctx, id);
    return e ? Response.json(e, { headers: SEM_CACHE }) : new Response(null, { status: 404, headers: SEM_CACHE });
  }
  const caminho = await caminhoDoPdfNoPainel(acesso.ctx, id, url.searchParams.get('base') === '1' ? 'base' : 'assinado');
  if (!caminho) return new Response(null, { status: 404, headers: SEM_CACHE });
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), ...SEM_CACHE } });
}
