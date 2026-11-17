'use server';
import { revalidatePath } from 'next/cache';
import { requirePaciente } from '@/lib/paciente-session';
import { desligarMeuLembrete, LembreteDoPacienteError, pausarMeusLembretes } from '@/modules/lembretes/paciente';

/** `ok`: a frase da região de status da tela; `erro`: o lembrete não é mais do paciente (apagado pela equipe, id de outro). */
export type LembreteDoPacienteState = { ok?: string; erro?: string };

const TELA = '/p/perfil/lembretes';

/**
 * Plano 17 (Tarefa 6): o interruptor de cada lembrete em Eu › Lembretes. O paciente vem da sessão (requirePaciente), nunca
 * do cliente; o `id` de outro paciente não passa da RLS (LembreteDoPacienteError). Outro erro sobe: o interruptor volta ao
 * valor salvo e mostra o alerta.
 */
export async function desligarLembreteAction(id: string, desligar: boolean): Promise<LembreteDoPacienteState> {
  const { ctx } = await requirePaciente(TELA);
  const desliga = desligar === true; // vindo do cliente: só o booleano verdadeiro desliga
  try {
    await desligarMeuLembrete(ctx, id, desliga);
  } catch (e) {
    if (e instanceof LembreteDoPacienteError) return { erro: e.message };
    throw e;
  }
  revalidatePath(TELA);
  return { ok: desliga ? 'Lembrete desligado.' : 'Lembrete ligado.' };
}

/** "Pausar todos os lembretes" / "Retomar os lembretes". */
export async function pausarLembretesAction(pausar: boolean): Promise<LembreteDoPacienteState> {
  const { ctx } = await requirePaciente(TELA);
  const pausa = pausar === true;
  await pausarMeusLembretes(ctx, pausa);
  revalidatePath(TELA);
  return { ok: pausa ? 'Lembretes pausados.' : 'Lembretes retomados.' };
}
