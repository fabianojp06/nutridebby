import { requireApiUser } from '@/lib/api-auth';
import { cookieDoVinculo, cookieVinculoSeguro, voltaDoPortal } from '@/lib/paciente-session';
import { PARAM_VINCULO } from '@/modules/portal/link-portal';
import { vinculosDaConta } from '@/modules/portal/vinculos';

export const dynamic = 'force-dynamic';

/**
 * Link com o consultório (`?v=`, e-mail e push): requirePaciente manda para cá quando o vínculo pedido é da conta e não é
 * o do cookie (Server Component não grava cookie). Confere DE NOVO — vínculo ativo da conta, consultório não suspenso,
 * como a escolha (escolherAction) — e só então grava o `nd_vinculo`; pedido que não vale é ignorado. Sempre volta para a
 * página do portal (voltaDoPortal: local, em /p/, sem o `?v=`), que segue o fluxo normal. Sem sessão de paciente, só volta
 * (a página manda ao login).
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const h = new Headers({ location: voltaDoPortal(url.searchParams.get('volta')), 'cache-control': 'no-store' });
  const auth = await requireApiUser(req, ['paciente']);
  if (auth.ok) {
    const pedido = url.searchParams.get(PARAM_VINCULO);
    const v = pedido ? (await vinculosDaConta(auth.data.user.id)).find((x) => x.tenantId === pedido && x.tenantStatus === 'ativa') : undefined;
    if (v) h.append('set-cookie', cookieDoVinculo(v.tenantId, cookieVinculoSeguro()));
  }
  return new Response(null, { status: 303, headers: h });
}
