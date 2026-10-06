import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { logger } from '@/lib/logger';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { receberDigitalizada, MAX_FOTOS_BYTES, MSG_DIGITALIZADA } from '@/modules/documentos/digitalizada';
import { DocumentoNaoEncontradoError, RecusaAssinaturaError, TransicaoInvalidaError } from '@/modules/documentos/erros';
import { idValido, PacienteBloqueadoError } from '@/modules/pacientes/base';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';
const LIMITE_CORPO = MAX_FOTOS_BYTES + 64 * 1024;
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
/**
 * RNF-141: no máximo 2 envios processando ao mesmo tempo no processo (sharp lê o cabeçalho de até 5 fotos) e um por
 * usuária. Minor 6 da revisão de segurança: a vaga só é ocupada DEPOIS de ler o corpo (60 s) — dois envios lentos não
 * seguram as vagas de todos os consultórios.
 */
const MAX_PROCESSANDO = 2;
let processando = 0;
const porUsuaria = new Set<string>();

/** RN-157 / US-144: multipart com `fotos` (1 a 5) e `codigo2fa`. */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/documentos/[id]/digitalizada'>) {
  if (!mesmaOrigem(req)) return resposta(403, { erro: 'Acesso negado' });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  if (!acesso.tenant.documentosLiberados) return resposta(404, { erro: 'Documento não encontrado.' });
  const { id } = await params;
  if (!idValido(id)) return resposta(404, { erro: 'Documento não encontrado.' }); // id fora do formato não chega ao banco
  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erro: MSG_DIGITALIZADA.fotos });
  let form: FormData;
  try {
    const corpo = await lerCorpoLimitado(req, LIMITE_CORPO, { prazoMs: 60_000 });
    form = await new Response(new Uint8Array(corpo.buffer as ArrayBuffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch (e) {
    if (e instanceof CorpoGrandeError) return resposta(413, { erro: MSG_DIGITALIZADA.fotos });
    if (e instanceof CorpoLentoError) return resposta(408, { erro: 'O envio demorou demais. Tente de novo.' });
    return resposta(400, { erro: 'Formulário inválido.' });
  }
  const userId = acesso.data.user.id;
  if (processando >= MAX_PROCESSANDO || porUsuaria.has(userId)) return resposta(429, { erro: 'Outro envio está em andamento. Tente de novo em instantes.' });
  processando++;
  porUsuaria.add(userId);
  try {
    const fotos: Buffer[] = [];
    for (const f of form.getAll('fotos')) if (f instanceof Blob && f.size > 0) fotos.push(Buffer.from(await f.arrayBuffer()));
    await receberDigitalizada(
      { ctx: acesso.ctx, tenant: acesso.tenant, user: { id: userId, email: acesso.data.user.email, twoFactorEnabled: acesso.data.user.twoFactorEnabled ?? null } },
      id, fotos, form.get('codigo2fa') ?? undefined, { headers: req.headers },
    );
    return resposta(200, { ok: true });
  } catch (e) {
    if (e instanceof RecusaAssinaturaError) {
      logger.info({ tenantId: acesso.ctx.tenantId, documentoId: id, motivo: e.motivoTecnico }, 'digitalização recusada');
      return resposta(422, { erro: e.mensagem(), codigo: e.codigo });
    }
    if (e instanceof DocumentoNaoEncontradoError) return resposta(404, { erro: e.message });
    if (e instanceof TransicaoInvalidaError || e instanceof PacienteBloqueadoError) return resposta(409, { erro: e.message });
    if (e instanceof CotaEsgotadaError) return resposta(507, { erro: MSG_COTA_ESGOTADA });
    throw e;
  } finally {
    processando--;
    porUsuaria.delete(userId);
  }
}
