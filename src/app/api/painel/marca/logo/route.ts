import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getEnv } from '@/env';
import { requireApiUser } from '@/lib/api-auth';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { clientIp } from '@/lib/ip';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { LOGO_MAX_BYTES, LogoOcupadoError, MSG_LOGO_GRANDE, SvgFiltroError, SvgPesadoError, trocarLogo } from '@/modules/plataforma/logo';

export const dynamic = 'force-dynamic';

const json = (status: number, erro: string) => Response.json({ erro }, { status, headers: { 'cache-control': 'no-store' } });

/** Corpo = o arquivo cru (fetch com body: File). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request) {
  const env = getEnv();
  const origem = req.headers.get('origin');
  if (origem && origem !== new URL(env.APP_URL).origin) return json(403, 'Acesso negado');
  const auth = await requireApiUser(req, ['nutri']);
  if (!auth.ok) return auth.response;
  const tenantId = (auth.data.user as { tenantId?: string | null }).tenantId;
  if (!tenantId) return json(403, 'Acesso negado');
  const [t] = await getDb().select({ dpaVersao: tenants.dpaVersao }).from(tenants).where(eq(tenants.id, tenantId));
  if (t?.dpaVersao !== DPA_VERSAO) return json(403, 'Aceite o contrato de tratamento de dados para continuar.');

  if (Number(req.headers.get('content-length') ?? 0) > LOGO_MAX_BYTES) return json(413, MSG_LOGO_GRANDE);
  let conteudo: Buffer;
  try {
    conteudo = await lerCorpoLimitado(req, LOGO_MAX_BYTES);
  } catch (e) {
    if (e instanceof CorpoGrandeError) return json(413, MSG_LOGO_GRANDE);
    throw e;
  }
  try {
    await trocarLogo({ tenantId, role: 'nutri', actorUserId: auth.data.user.id, ip: clientIp(req.headers, env.TRUSTED_PROXIES) }, conteudo);
  } catch (e) {
    // T10-R1: filtro SVG (CPU) e "já tem outro logo em processamento" (429) antes do 415 genérico.
    if (e instanceof SvgFiltroError || e instanceof SvgPesadoError) return json(415, e.message);
    if (e instanceof LogoOcupadoError) return json(429, e.message);
    if (e instanceof TipoNaoPermitidoError) return json(415, 'Envie o logo em PNG, JPEG ou SVG.');
    if (e instanceof CotaEsgotadaError) return json(507, MSG_COTA_ESGOTADA);
    throw e;
  }
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
