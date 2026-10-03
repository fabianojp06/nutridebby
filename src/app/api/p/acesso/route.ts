import { getEnv } from '@/env';
import { getAuth } from '@/lib/auth';
import { requireApiPaciente } from '@/lib/paciente-session';
import { cookieDeSessaoRenovado } from '@/lib/sessao-cookies';
import { registrarAcesso } from '@/modules/portal/acesso';

export const dynamic = 'force-dynamic';

/** D9: chamado uma vez quando o portal abre — o acesso do dia (CS-02) e o cookie de sessão que desliza (P06-11). */
export async function POST(req: Request): Promise<Response> {
  const origem = req.headers.get('origin');
  if (origem !== null && origem !== new URL(getEnv().APP_URL).origin) return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  await registrarAcesso(acesso.ctx, acesso.tenant.fuso);
  const h = new Headers({ 'cache-control': 'no-store' });
  const cookie = await cookieDeSessaoRenovado(getAuth(), req.headers.get('cookie'));
  if (cookie) h.append('set-cookie', cookie);
  return new Response(null, { status: 204, headers: h });
}
