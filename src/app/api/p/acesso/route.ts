import { getAuth } from '@/lib/auth';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { cookieDoVinculo, cookieVinculoSeguro, requireApiPaciente } from '@/lib/paciente-session';
import { cookieDeSessaoRenovado } from '@/lib/sessao-cookies';
import { registrarAcesso } from '@/modules/portal/acesso';

export const dynamic = 'force-dynamic';

/**
 * D9: chamado uma vez quando o portal abre — o acesso do dia (CS-02) e o cookie de sessão que desliza (P06-11). Com 2+
 * vínculos, o `nd_vinculo` desliza junto (D3): sem isso a escolha vence a cada 30 dias, mesmo com uso diário.
 */
export async function POST(req: Request): Promise<Response> {
  if (!mesmaOrigem(req)) return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } });
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  await registrarAcesso(acesso.ctx, acesso.tenant.fuso);
  const h = new Headers({ 'cache-control': 'no-store' });
  const cookie = await cookieDeSessaoRenovado(getAuth(), req.headers.get('cookie'));
  if (cookie) h.append('set-cookie', cookie);
  if (acesso.vinculos.length > 1) h.append('set-cookie', cookieDoVinculo(acesso.tenant.id, cookieVinculoSeguro()));
  return new Response(null, { status: 204, headers: h });
}
