import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { LOGO_MAX_BYTES, LogoOcupadoError, MSG_LOGO_GRANDE, SvgFiltroError, SvgPesadoError, trocarLogo } from '@/modules/plataforma/logo';

export const dynamic = 'force-dynamic';

const json = (status: number, erro: string) => Response.json({ erro }, { status, headers: { 'cache-control': 'no-store' } });

/** Corpo = o arquivo cru (fetch com body: File). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request) {
  if (!mesmaOrigem(req)) return json(403, 'Acesso negado');
  const acesso = await requireApiNutri(req); // sessão, papel, RN-15 e DPA (F7)
  if (!acesso.ok) return acesso.response;

  if (Number(req.headers.get('content-length') ?? 0) > LOGO_MAX_BYTES) return json(413, MSG_LOGO_GRANDE);
  let conteudo: Buffer;
  try {
    conteudo = await lerCorpoLimitado(req, LOGO_MAX_BYTES);
  } catch (e) {
    if (e instanceof CorpoGrandeError) return json(413, MSG_LOGO_GRANDE);
    throw e;
  }
  try {
    await trocarLogo(acesso.ctx, conteudo);
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
