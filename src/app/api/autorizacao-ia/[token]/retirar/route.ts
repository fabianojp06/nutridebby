import { mesmaOrigem } from '@/lib/mesma-origem';
import { retirarPeloLink } from '@/modules/ia/autorizacao-link';
import { lerJson, SEM_CACHE } from '../../../n/[slug]/resposta';
import { comoRespostaDoLinkIa, depsDoLinkIa, recusaOrigem } from '../link';

export const dynamic = 'force-dynamic';

/** US-109: Turnstile → limite por IP → retirada pelo link. 200 · 403/503 (Turnstile) · 410 · 429 · 400 · 413. */
export async function POST(req: Request, { params }: RouteContext<'/api/autorizacao-ia/[token]/retirar'>) {
  if (!mesmaOrigem(req)) return recusaOrigem();
  const { token } = await params;
  try {
    const corpo = await lerJson(req);
    await retirarPeloLink(token, { turnstile: corpo.turnstile }, depsDoLinkIa(req));
    return Response.json({ ok: true }, { headers: SEM_CACHE });
  } catch (e) {
    return comoRespostaDoLinkIa(e);
  }
}
