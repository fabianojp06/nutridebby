import { confirmarCodigo } from '@/modules/agenda/agendamento-publico';
import { responder } from '../resposta';

export const dynamic = 'force-dynamic';

/** RN-16 passo 2: o código de 6 dígitos. 200 `ResultadoConfirmacao` · 422 · 409 · 410 · 429. */
export async function POST(req: Request, { params }: RouteContext<'/api/n/[slug]/confirmar'>) {
  const { slug } = await params;
  return responder(req, (corpo, deps) => confirmarCodigo(slug, corpo, deps));
}
