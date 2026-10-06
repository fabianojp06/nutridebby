import { mesmaOrigem } from '@/lib/mesma-origem';
import { confirmarRecebimentoPeloLink, MSG_LINK } from '@/modules/documentos/link-documento';
import { SEM_CACHE } from '../../../n/[slug]/resposta';
import { depsDoLink, recusaOrigem, sessaoDoCookie } from '../link';

export const dynamic = 'force-dynamic';

/** D4 da spec: "Confirmo que recebi este documento" pela sessão do link. 200 `{ em }` · 410 (sem sessão ou indisponível). */
export async function POST(req: Request, { params }: RouteContext<'/api/documento/[token]/recebido'>) {
  if (!mesmaOrigem(req)) return recusaOrigem();
  const { token } = await params;
  const em = await confirmarRecebimentoPeloLink(token, sessaoDoCookie(req), depsDoLink(req));
  if (!em) return Response.json({ erro: MSG_LINK.invalido }, { status: 410, headers: SEM_CACHE });
  return Response.json({ em }, { headers: SEM_CACHE });
}
