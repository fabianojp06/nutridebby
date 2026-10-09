import { mesmaOrigem } from '@/lib/mesma-origem';
import { autorizarPeloLink } from '@/modules/ia/autorizacao-link';
import { lerJson, SEM_CACHE } from '../../../n/[slug]/resposta';
import { comoRespostaDoLinkIa, depsDoLinkIa, recusaOrigem } from '../link';

export const dynamic = 'force-dynamic';

/** US-107: Turnstile → limite por IP → autorização pelo link. 200 · 403/503 (Turnstile) · 409 (o texto mudou) · 410 · 429 · 400 · 413. */
export async function POST(req: Request, { params }: RouteContext<'/api/autorizacao-ia/[token]/autorizar'>) {
  if (!mesmaOrigem(req)) return recusaOrigem();
  const { token } = await params;
  try {
    const corpo = await lerJson(req);
    await autorizarPeloLink(token, { turnstile: corpo.turnstile, exibido: corpo.exibido }, depsDoLinkIa(req));
    return Response.json({ ok: true }, { headers: SEM_CACHE });
  } catch (e) {
    return comoRespostaDoLinkIa(e);
  }
}
