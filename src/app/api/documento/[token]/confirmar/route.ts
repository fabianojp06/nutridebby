import { mesmaOrigem } from '@/lib/mesma-origem';
import { confirmarCodigoDocumento } from '@/modules/documentos/link-documento';
import { lerJson, SEM_CACHE } from '../../../n/[slug]/resposta';
import { comoRespostaDoLink, cookiesDaSessao, depsDoLink, recusaOrigem } from '../link';

export const dynamic = 'force-dynamic';

/** RN-158 passo 2: o código certo abre a sessão de 15 min (cookie `nd_doc`). 200 · 400 · 410 · 429 · 413. */
export async function POST(req: Request, { params }: RouteContext<'/api/documento/[token]/confirmar'>) {
  if (!mesmaOrigem(req)) return recusaOrigem();
  const { token } = await params;
  try {
    const corpo = await lerJson(req);
    const { sessao } = await confirmarCodigoDocumento(token, { codigo: corpo.codigo }, depsDoLink(req));
    const h = new Headers(SEM_CACHE);
    for (const c of cookiesDaSessao(token, sessao)) h.append('set-cookie', c);
    return Response.json({ ok: true }, { headers: h });
  } catch (e) {
    return comoRespostaDoLink(e);
  }
}
