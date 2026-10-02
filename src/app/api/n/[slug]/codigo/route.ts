import { solicitarCodigo } from '@/modules/agenda/agendamento-publico';
import { responder } from '../resposta';

export const dynamic = 'force-dynamic';

/** RN-16 passo 1 (página pública, sem sessão): 200 `{ pedido }` · 422 · 403/503 (Turnstile) · 409 · 404 · 429 · 400 · 413. */
export async function POST(req: Request, { params }: RouteContext<'/api/n/[slug]/codigo'>) {
  const { slug } = await params;
  return responder(req, (corpo, deps) => solicitarCodigo(slug, corpo, deps));
}
