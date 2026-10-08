'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { requireNutri } from '@/lib/tenant-session';
import { configIA } from '@/modules/ia/modo';
import { pedirLeituraExame, PedidoIaError } from '@/modules/ia/tarefas';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { aceitarEnvio, recusarEnvio, RevisaoError } from '@/modules/pacientes/exames-enviados';
import { chaveDaMensagemIa } from '@/modules/pacientes/exames-enviados-ia';

export type RevisaoState = {
  erros?: Partial<Record<'titulo' | 'data' | 'motivo' | 'texto' | 'geral', string>>;
  /**
   * Revisão do plano: o que foi digitado volta com o erro — o React 19 chama form.reset() no fim de toda action, mesmo quando
   * ela devolve { erros } (molde de agenda/consultas/[id]/cancelar-form.tsx e agenda/consulta-form.tsx).
   */
  valores?: { titulo?: string; data?: string; motivo?: string; texto?: string };
};
const campo = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

/**
 * US-163: "Salvar no prontuário" e "Aceitar e ler valores com IA" (o mesmo formulário: título e data valem para os dois). O
 * aceite é uma transação; a leitura por IA vem DEPOIS (`pedirLeituraExame`, transação própria do Plano 11) e a recusa dela
 * não desfaz o aceite. O consultório, a usuária e o paciente vêm da sessão e do envio, nunca do formulário.
 */
export async function aceitarEnvioAction(id: string, _prev: RevisaoState, fd: FormData): Promise<RevisaoState> {
  const { ctx, tenant } = await requireNutri('/painel/exames-recebidos');
  let aceito: { examId: string; patientId: string };
  try {
    aceito = await aceitarEnvio(ctx, tenant, id, { titulo: fd.get('titulo'), data: fd.get('data') });
  } catch (e) {
    const valores = { titulo: campo(fd, 'titulo'), data: campo(fd, 'data') };
    if (e instanceof RevisaoError) return { erros: e.erros, valores };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores };
    throw e;
  }
  let iaMsg: string | null = null;
  if (fd.get('ler') === '1') {
    try {
      await pedirLeituraExame(ctx, tenant, aceito.patientId, aceito.examId, { ia: configIA(getEnv()) });
    } catch (e) {
      if (!(e instanceof PedidoIaError)) throw e;
      iaMsg = chaveDaMensagemIa(e.mensagem);
    }
  }
  revalidatePath('/painel', 'layout'); // o contador do menu
  redirect(`/painel/pacientes/${aceito.patientId}/exames?envio=salvo${iaMsg ? `&iaMsg=${encodeURIComponent(iaMsg)}` : ''}`);
}

/** US-164 / RN-165: "Confirmar recusa" com o motivo da lista (e o texto, em "Outro motivo"). */
export async function recusarEnvioAction(id: string, _prev: RevisaoState, fd: FormData): Promise<RevisaoState> {
  const { ctx } = await requireNutri('/painel/exames-recebidos');
  try {
    await recusarEnvio(ctx, id, { motivo: fd.get('motivo'), texto: fd.get('texto') });
  } catch (e) {
    const valores = { motivo: campo(fd, 'motivo'), texto: campo(fd, 'texto') };
    if (e instanceof RevisaoError) return { erros: e.erros, valores };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message }, valores };
    throw e;
  }
  revalidatePath('/painel', 'layout');
  redirect('/painel/exames-recebidos?recusado=1');
}
