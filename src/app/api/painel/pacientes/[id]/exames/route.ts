import { getEnv } from '@/env';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { requireApiNutri, type ApiNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { criarExame, EXAME_MAX_BYTES, ExameError, MSG_EXAME } from '@/modules/pacientes/exames';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';

// O multipart leva, além do arquivo, título, data, valores e as fronteiras
const LIMITE_CORPO = EXAME_MAX_BYTES + 256 * 1024;
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });

// Cada envio segura ~3 cópias de até 20 MB (corpo, FormData, Buffer do arquivo) numa VPS dividida com o CRM
// de produção: no máximo 2 por processo, como o "um logo por vez" do Plano 02 (T10-R1c)
const MAX_ENVIOS = 2;
let enviosEmAndamento = 0;

/** US-015: multipart (titulo, data, valores em JSON, arquivo opcional). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/pacientes/[id]/exames'>) {
  const origem = req.headers.get('origin');
  if (origem && origem !== new URL(getEnv().APP_URL).origin) return resposta(403, { erros: { geral: 'Acesso negado' } });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;

  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erros: { arquivo: MSG_EXAME.arquivo } });
  if (enviosEmAndamento >= MAX_ENVIOS) return resposta(429, { erros: { geral: MSG_EXAME.ocupado } });
  enviosEmAndamento++;
  try {
    return await receber(req, acesso, id);
  } finally {
    enviosEmAndamento--;
  }
}

async function receber(req: Request, acesso: Extract<ApiNutri, { ok: true }>, id: string): Promise<Response> {
  let form: FormData;
  try {
    const corpo = await lerCorpoLimitado(req, LIMITE_CORPO);
    // sem cópia: a visão aponta para o mesmo buffer do corpo
    form = await new Response(new Uint8Array(corpo.buffer as ArrayBuffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch (e) {
    if (e instanceof CorpoGrandeError) return resposta(413, { erros: { arquivo: MSG_EXAME.arquivo } });
    return resposta(400, { erros: { geral: 'Formulário inválido.' } });
  }
  const arquivo = form.get('arquivo');
  const buf = arquivo instanceof Blob && arquivo.size > 0 ? Buffer.from(await arquivo.arrayBuffer()) : null;
  let valores: unknown = null;
  try {
    valores = JSON.parse(String(form.get('valores') ?? '[]'));
  } catch {
    valores = null; // vira o erro de "valores" na validação
  }
  try {
    const exameId = await criarExame(acesso.ctx, acesso.tenant, id, { titulo: form.get('titulo'), data: form.get('data'), valores, arquivo: buf });
    return resposta(200, { ok: true, id: exameId });
  } catch (e) {
    if (e instanceof ExameError) {
      const status = e.erros.arquivo ? (buf && buf.length > EXAME_MAX_BYTES ? 413 : 415) : 400;
      return resposta(status, { erros: e.erros });
    }
    if (e instanceof PacienteNaoEncontradoError) return resposta(404, { erros: { geral: 'Paciente não encontrado' } });
    if (e instanceof PacienteBloqueadoError) return resposta(409, { erros: { geral: e.message } });
    if (e instanceof CotaEsgotadaError) return resposta(507, { erros: { arquivo: MSG_COTA_ESGOTADA } });
    throw e;
  }
}
