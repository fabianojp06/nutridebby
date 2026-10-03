import { getEnv } from '@/env';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { requireApiPaciente, type ApiPaciente } from '@/lib/paciente-session';
import { MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { DiarioError, registrarNoDiario } from '@/modules/portal/diario';
import { FOTO_DIARIO_MAX_BYTES, MSG_DIARIO } from '@/modules/portal/diario-constantes';

export const dynamic = 'force-dynamic';

const LIMITE_CORPO = FOTO_DIARIO_MAX_BYTES + 64 * 1024;
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
// Cada envio segura até ~3 cópias de 10 MB; a VPS é dividida com o CRM de produção (mesmo cuidado do upload de exame)
const MAX_ENVIOS = 2;
let emAndamento = 0;

/** US-042: multipart (refeicao, texto, foto opcional). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request): Promise<Response> {
  const origem = req.headers.get('origin');
  if (origem !== null && origem !== new URL(getEnv().APP_URL).origin) return resposta(403, { erros: { geral: 'Acesso negado' } });
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erros: { foto: MSG_DIARIO.foto } });
  if (emAndamento >= MAX_ENVIOS) return resposta(429, { erros: { geral: MSG_DIARIO.ocupado } });
  emAndamento++;
  try {
    return await receber(req, acesso);
  } finally {
    emAndamento--;
  }
}

async function receber(req: Request, acesso: Extract<ApiPaciente, { ok: true }>): Promise<Response> {
  let form: FormData;
  try {
    const corpo = await lerCorpoLimitado(req, LIMITE_CORPO);
    form = await new Response(new Uint8Array(corpo.buffer as ArrayBuffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch (e) {
    if (e instanceof CorpoGrandeError) return resposta(413, { erros: { foto: MSG_DIARIO.foto } });
    return resposta(400, { erros: { geral: 'Formulário inválido.' } });
  }
  const arquivo = form.get('foto');
  const foto = arquivo instanceof Blob && arquivo.size > 0 ? Buffer.from(await arquivo.arrayBuffer()) : null;
  try {
    const r = await registrarNoDiario(acesso.ctx, acesso.tenant, { refeicao: form.get('refeicao'), texto: form.get('texto'), foto });
    // R9: com a cota esgotada o texto entra sem a foto, e a pessoa vê o texto da spec (US-042 "Cota de armazenamento")
    return resposta(200, { ok: true, id: r.id, mensagem: r.semFoto ? `${MSG_DIARIO.salvoSemFoto} ${MSG_COTA_ESGOTADA}` : MSG_DIARIO.salvo, semFoto: r.semFoto });
  } catch (e) {
    if (e instanceof DiarioError) {
      const status = e.erros.foto ? (foto && foto.length > FOTO_DIARIO_MAX_BYTES ? 413 : e.erros.foto === MSG_DIARIO.foto ? 415 : 507) : e.erros.geral === MSG_DIARIO.limite ? 409 : 400;
      return resposta(status, { erros: e.erros });
    }
    throw e;
  }
}
