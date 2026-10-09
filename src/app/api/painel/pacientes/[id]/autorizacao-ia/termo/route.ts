import { getEnv } from '@/env';
import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { AutorizacaoError, registrarTermoEmPapel } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO, TERMO_MAX_BYTES } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { idValido, PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { MSG_EXAME } from '@/modules/pacientes/exames-constantes';

export const dynamic = 'force-dynamic';

// O multipart leva, além do arquivo, a data, a confirmação e as fronteiras
const LIMITE_CORPO = TERMO_MAX_BYTES + 64 * 1024;
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
const NAO_ENCONTRADO = { erros: { geral: 'Paciente não encontrado.' } };
// Como o envio de laudo (e o mesmo texto de "ocupado", MSG_EXAME.ocupado): cada envio segura ~3 cópias de até 20 MB numa VPS dividida — no máximo 2 por processo
const MAX_ENVIOS = 2;
let enviosEmAndamento = 0;

/**
 * US-108 "Guardar o termo assinado": multipart (data, confirmacao, arquivo). A regra é a do `registrarTermoEmPapel` (T5);
 * aqui só o transporte. 200 · 400 (erros por campo) · 401 · 403 (outra origem) · 404 · 408 · 409 (bloqueado) · 413 · 429.
 */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/pacientes/[id]/autorizacao-ia/termo'>) {
  if (!mesmaOrigem(req)) return resposta(403, { erros: { geral: 'Acesso negado' } });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  if (!idValido(id)) return resposta(404, NAO_ENCONTRADO); // id fora do formato não chega ao banco
  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erros: { arquivo: MSG_AUTORIZACAO.arquivoInvalido } });
  if (enviosEmAndamento >= MAX_ENVIOS) return resposta(429, { erros: { geral: MSG_EXAME.ocupado } });
  enviosEmAndamento++;
  try {
    let form: FormData;
    try {
      const corpo = await lerCorpoLimitado(req, LIMITE_CORPO, { prazoMs: 60_000 });
      // sem cópia: a visão aponta para o mesmo buffer do corpo
      form = await new Response(new Uint8Array(corpo.buffer as ArrayBuffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
    } catch (e) {
      if (e instanceof CorpoGrandeError) return resposta(413, { erros: { arquivo: MSG_AUTORIZACAO.arquivoInvalido } });
      if (e instanceof CorpoLentoError) return resposta(408, { erros: { geral: 'O envio demorou demais. Tente de novo.' } });
      return resposta(400, { erros: { geral: 'Formulário inválido.' } });
    }
    const arquivo = form.get('arquivo');
    const buf = arquivo instanceof Blob && arquivo.size > 0 ? Buffer.from(await arquivo.arrayBuffer()) : null;
    const env = getEnv();
    await registrarTermoEmPapel(acesso.ctx, id, { data: form.get('data'), confirmacao: form.get('confirmacao') === 'on', arquivo: buf }, { ia: configIA(env), appUrl: env.APP_URL });
    return resposta(200, { ok: true });
  } catch (e) {
    if (e instanceof AutorizacaoError) return resposta(400, { erros: e.erros });
    if (e instanceof PacienteNaoEncontradoError) return resposta(404, NAO_ENCONTRADO);
    if (e instanceof PacienteBloqueadoError) return resposta(409, { erros: { geral: e.message } });
    throw e;
  } finally {
    enviosEmAndamento--;
  }
}
