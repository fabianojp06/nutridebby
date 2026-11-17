'use server';

import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { apagarLembrete, LembreteError, ligarLembrete, salvarLembrete } from '@/modules/lembretes/equipe';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

/**
 * Plano 17 (Tarefa 5): as actions da seção "Lembretes no app" da aba Plano alimentar. Erros por campo de
 * `validarLembrete`/`salvarLembrete` (chaves `inicio`, `fim`, `intervaloMin`, `dias`, `horarios`, `texto`,
 * `antecedenciaMin`, `diarioDepoisMin` e `geral`); `id` = o lembrete salvo (o foco vai ao "Editar" dele).
 */
export type FormLembreteState = { erros?: Record<string, string>; valores?: Record<string, unknown>; ok?: string; envio?: number; id?: string };
export type AcaoLembreteState = { erro?: string; ok?: string };

const aba = (patientId: string) => `/painel/pacientes/${patientId}/plano-alimentar`;
const texto = (fd: FormData, campo: string) => String(fd.get(campo) ?? '');
const lista = (fd: FormData, campo: string) => fd.getAll(campo).map(String);

/** O formulário como o lembrete de `validarLembrete` (só os campos do tipo) e como os valores devolvidos com o erro. */
function lerFormulario(fd: FormData): { input: Record<string, unknown>; valores: Record<string, unknown> } {
  const tipo = texto(fd, 'tipo');
  const id = texto(fd, 'id');
  switch (tipo) {
    case 'agua': {
      const config = { inicio: texto(fd, 'inicio'), fim: texto(fd, 'fim'), intervaloMin: texto(fd, 'intervaloMin'), dias: lista(fd, 'dias') };
      return { input: { id, tipo, config }, valores: { id, tipo, ...config } };
    }
    case 'refeicoes': {
      // "Não pedir" chega vazio: validarLembrete lê '' como desligado
      const config = { antecedenciaMin: texto(fd, 'antecedenciaMin'), diarioDepoisMin: texto(fd, 'diarioDepoisMin') };
      return { input: { id, tipo, config }, valores: { id, tipo, ...config } };
    }
    case 'suplemento':
    case 'livre': {
      const config = { horarios: lista(fd, 'horarios'), dias: lista(fd, 'dias') };
      const t = texto(fd, 'texto');
      return { input: { id, tipo, texto: t, config }, valores: { id, tipo, texto: t, ...config } };
    }
    default:
      return { input: { id, tipo, config: null }, valores: { id, tipo } };
  }
}

export async function salvarLembreteAction(patientId: string, _prev: FormLembreteState, formData: FormData): Promise<FormLembreteState> {
  const { ctx, tenant } = await requireNutri(aba(patientId));
  const { input, valores } = lerFormulario(formData);
  let id: string;
  try {
    ({ id } = await salvarLembrete(ctx, patientId, input, tenant));
  } catch (e) {
    if (e instanceof LembreteError) return { erros: e.erros, valores };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(aba(patientId));
  return { ok: 'Lembrete salvo.', envio: Date.now(), id };
}

/** Erros de `ligarLembrete`/`apagarLembrete` como a mensagem ao lado do botão; o resto sobe (ou 404). */
async function acao(patientId: string, fn: (ctx: Awaited<ReturnType<typeof requireNutri>>['ctx']) => Promise<void>, ok: string): Promise<AcaoLembreteState> {
  const { ctx } = await requireNutri(aba(patientId));
  try {
    await fn(ctx);
  } catch (e) {
    if (e instanceof LembreteError) return { erro: Object.values(e.erros)[0] };
    if (e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  revalidatePath(aba(patientId));
  return { ok };
}

/** Interruptor da equipe: muda só `ligado`; a escolha do paciente (`desligado_pelo_paciente_em`) fica como está. */
export async function ligarLembreteAction(patientId: string, id: string, ligado: boolean): Promise<AcaoLembreteState> {
  const liga = ligado === true; // vindo do cliente: só o booleano verdadeiro liga
  return acao(patientId, (ctx) => ligarLembrete(ctx, patientId, id, liga), liga ? 'Lembrete ligado.' : 'Lembrete desligado.');
}

/** "Apagar" (com `BotaoAcao`, que passa o estado anterior como último argumento, ignorado). */
export async function apagarLembreteAction(patientId: string, id: string): Promise<AcaoLembreteState> {
  return acao(patientId, (ctx) => apagarLembrete(ctx, patientId, id), 'Lembrete apagado.');
}
