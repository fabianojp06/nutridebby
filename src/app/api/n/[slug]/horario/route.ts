import { escolherOutroHorario } from '@/modules/agenda/agendamento-publico';
import { responder } from '../resposta';

export const dynamic = 'force-dynamic';

/** Depois de "horário ocupado": outro horário para o pedido já verificado. 200 `ResultadoConfirmacao` · 409 · 410 · 429. */
export async function POST(req: Request, { params }: RouteContext<'/api/n/[slug]/horario'>) {
  const { slug } = await params;
  return responder(req, (corpo, deps) => escolherOutroHorario(slug, corpo, deps));
}
