import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiPaciente, type ApiPaciente } from '@/lib/paciente-session';
import { ENVIO_TOTAL_MAX_BYTES, MSG_ENVIO } from '@/modules/pacientes/exames-enviados-constantes';
import { enviarExame, EnvioError } from '@/modules/portal/exames-enviados';

export const dynamic = 'force-dynamic';

const LIMITE_CORPO = ENVIO_TOTAL_MAX_BYTES + 256 * 1024; // os 30 MB + os campos e as bordas do multipart
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
/**
 * R-173 / RNF-162 (molde de /api/p/diario): cada envio segura ≈ 3 cópias do corpo (≈ 90 MB com 30 MB) numa VPS dividida com o
 * CRM de produção — no máximo 2 envios por processo e 1 por conta; e um prazo para o corpo chegar (RNF-161: 30 MB a
 * ≈ 1,4 Mbit/s levam ≈ 180 s), para um envio lento não segurar a vaga pelos 300 s do `requestTimeout` do Node.
 */
const MAX_ENVIOS = 2;
let emAndamento = 0;
const enviosPorConta = new Set<string>();
const PRAZO_CORPO_MS = 180_000;

/** US-160: multipart (dataColeta, nome, observacao, arquivos…). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request): Promise<Response> {
  if (!mesmaOrigem(req)) return resposta(403, { erros: { geral: 'Acesso negado' } });
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  // D18 = a: com o recebimento desligado, a opção nem aparece; um envio direto à API é recusado
  if (!acesso.tenant.examesPacienteAtivadoEm) return resposta(404, { erros: {} });
  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erros: { arquivos: MSG_ENVIO.arquivos } });
  const conta = acesso.data.user.id;
  if (emAndamento >= MAX_ENVIOS || enviosPorConta.has(conta)) return resposta(429, { erros: { geral: MSG_ENVIO.ocupado } });
  emAndamento++;
  enviosPorConta.add(conta);
  try {
    return await receber(req, acesso);
  } finally {
    emAndamento--;
    enviosPorConta.delete(conta);
  }
}

async function receber(req: Request, acesso: Extract<ApiPaciente, { ok: true }>): Promise<Response> {
  let form: FormData;
  try {
    const corpo = await lerCorpoLimitado(req, LIMITE_CORPO, { prazoMs: PRAZO_CORPO_MS });
    form = await new Response(new Uint8Array(corpo.buffer as ArrayBuffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch (e) {
    if (e instanceof CorpoGrandeError) return resposta(413, { erros: { arquivos: MSG_ENVIO.arquivos } });
    if (e instanceof CorpoLentoError) return resposta(408, { erros: { geral: MSG_ENVIO.ocupado } });
    return resposta(400, { erros: { geral: MSG_ENVIO.formulario } });
  }
  const arquivos: Buffer[] = [];
  for (const a of form.getAll('arquivos')) {
    // Review Focus 3 (revisão do plano): um arquivo vazio no meio é recusado com a mensagem única, nunca descartado em silêncio
    // (sem arquivo escolhido, o navegador manda uma parte vazia: a mesma recusa)
    if (!(a instanceof Blob) || a.size === 0) return resposta(400, { erros: { arquivos: MSG_ENVIO.arquivos } });
    arquivos.push(Buffer.from(await a.arrayBuffer()));
  }
  try {
    const { id } = await enviarExame(acesso.ctx, acesso.tenant, { dataColeta: form.get('dataColeta'), nome: form.get('nome'), observacao: form.get('observacao'), arquivos });
    return resposta(200, { ok: true, id, mensagem: MSG_ENVIO.enviado });
  } catch (e) {
    if (e instanceof EnvioError) return resposta(e.status, { erros: e.erros });
    throw e;
  }
}
