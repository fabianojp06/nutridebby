import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { trocarCapa } from '@/modules/conteudo/arquivos';
import { CAPA_MAX_BYTES, MSG_CONTEUDO } from '@/modules/conteudo/constantes';
import { ConteudoNaoEncontradoError } from '@/modules/conteudo/erros';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';

const json = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
// Cada envio segura até ~2 cópias de 5 MB e o sharp; a VPS é dividida com o CRM de produção (como o logo e o exame)
const MAX_ENVIOS = 2;
let emAndamento = 0;

/** US-051/US-052 (D8): corpo = a imagem crua (fetch com body: File). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/conteudos/[id]/capa'>): Promise<Response> {
  if (!mesmaOrigem(req)) return json(403, { erro: 'Acesso negado' });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  if (Number(req.headers.get('content-length') ?? 0) > CAPA_MAX_BYTES) return json(413, { erro: MSG_CONTEUDO.capa });
  if (emAndamento >= MAX_ENVIOS) return json(429, { erro: MSG_CONTEUDO.ocupado });
  emAndamento++;
  try {
    const conteudo = await lerCorpoLimitado(req, CAPA_MAX_BYTES, { prazoMs: 60_000 });
    await trocarCapa(acesso.ctx, id, conteudo, { aceitos: ['jpg', 'png'], tipos: ['receita', 'orientacao'] });
    return json(200, { ok: true });
  } catch (e) {
    if (e instanceof CorpoGrandeError) return json(413, { erro: MSG_CONTEUDO.capa });
    if (e instanceof CorpoLentoError) return json(408, { erro: MSG_CONTEUDO.falhou });
    if (e instanceof TipoNaoPermitidoError) return json(415, { erro: MSG_CONTEUDO.capa });
    if (e instanceof ConteudoNaoEncontradoError) return json(404, { erro: MSG_CONTEUDO.naoEncontrado });
    if (e instanceof CotaEsgotadaError) return json(507, { erro: MSG_COTA_ESGOTADA });
    throw e;
  } finally {
    emAndamento--;
  }
}
