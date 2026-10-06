import { mesmaOrigem } from '@/lib/mesma-origem';
import { pedirCodigoDocumento } from '@/modules/documentos/link-documento';
import { lerJson, SEM_CACHE } from '../../../n/[slug]/resposta';
import { comoRespostaDoLink, depsDoLink, recusaOrigem } from '../link';

export const dynamic = 'force-dynamic';

/** RN-158 passo 1: Turnstile → código de 6 dígitos no e-mail do paciente. 200 · 403/503 (Turnstile) · 410 · 429 · 400 · 413. */
export async function POST(req: Request, { params }: RouteContext<'/api/documento/[token]/codigo'>) {
  if (!mesmaOrigem(req)) return recusaOrigem();
  const { token } = await params;
  try {
    const corpo = await lerJson(req);
    await pedirCodigoDocumento(token, { turnstile: corpo.turnstile }, depsDoLink(req));
    return Response.json({ ok: true }, { headers: SEM_CACHE });
  } catch (e) {
    return comoRespostaDoLink(e);
  }
}
