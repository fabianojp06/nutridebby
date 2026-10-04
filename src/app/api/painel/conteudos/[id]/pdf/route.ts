import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { trocarPdf } from '@/modules/conteudo/arquivos';
import { MSG_CONTEUDO, PDF_MAX_BYTES } from '@/modules/conteudo/constantes';
import { ConteudoNaoEncontradoError } from '@/modules/conteudo/erros';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';

const json = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
const MAX_ENVIOS = 2;
let emAndamento = 0;

/** US-052 (D20): corpo = o PDF cru (fetch com body: File), só na orientação. Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/conteudos/[id]/pdf'>): Promise<Response> {
  if (!mesmaOrigem(req)) return json(403, { erro: 'Acesso negado' });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  if (Number(req.headers.get('content-length') ?? 0) > PDF_MAX_BYTES) return json(413, { erro: MSG_CONTEUDO.pdf });
  if (emAndamento >= MAX_ENVIOS) return json(429, { erro: MSG_CONTEUDO.ocupado });
  emAndamento++;
  try {
    const conteudo = await lerCorpoLimitado(req, PDF_MAX_BYTES, { prazoMs: 120_000 });
    await trocarPdf(acesso.ctx, id, conteudo);
    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof CorpoGrandeError) return json(413, { erro: MSG_CONTEUDO.pdf });
    if (e instanceof CorpoLentoError) return json(408, { erro: MSG_CONTEUDO.ocupado });
    if (e instanceof TipoNaoPermitidoError) return json(415, { erro: MSG_CONTEUDO.pdf });
    if (e instanceof ConteudoNaoEncontradoError) return json(404, { erro: MSG_CONTEUDO.naoEncontrado });
    if (e instanceof CotaEsgotadaError) return json(507, { erro: MSG_COTA_ESGOTADA });
    throw e;
  } finally {
    emAndamento--;
  }
}
