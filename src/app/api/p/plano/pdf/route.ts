import { requireApiPaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { caminhoDoPdf } from '@/modules/portal/plano';

export const dynamic = 'force-dynamic';

const para = (location: string) => new Response(null, { status: 303, headers: { location, 'cache-control': 'no-store' } });

/** US-041 "Baixar PDF": a URL assinada (5 min) nasce aqui, na hora do clique — nunca fica no HTML guardado offline (D6). */
export async function GET(req: Request): Promise<Response> {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  const r = await caminhoDoPdf(acesso.ctx);
  return r.estado === 'pronto' ? para(signFileUrl(r.caminho)) : para('/p/plano?pdf=preparando');
}
