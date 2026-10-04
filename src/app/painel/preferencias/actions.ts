'use server';

import { revalidatePath } from 'next/cache';
import { requireNutri } from '@/lib/tenant-session';
import { ehTema, gravarTema, marcarGuia, PreferenciaError, proximoTema, type EstadoGuia } from '@/modules/plataforma/preferencias';

export type TemaState = { ok?: boolean; erro?: string };

/** Botão do cabeçalho (funciona sem JavaScript: o formulário posta e a página volta com o tema novo). */
export async function alternarTemaAction(formData: FormData): Promise<void> {
  const { data } = await requireNutri('/painel', { permitirDpaPendente: true });
  const atual = ehTema(data.user.tema) ? data.user.tema : 'sistema';
  await gravarTema(data.user.id, proximoTema(atual, formData.get('aparelhoEscuro') === '1'));
  revalidatePath('/painel', 'layout');
}

/** Configurações → Tema (três opções). */
export async function escolherTemaAction(_prev: TemaState, formData: FormData): Promise<TemaState> {
  const { data } = await requireNutri('/painel/configuracoes');
  try {
    await gravarTema(data.user.id, formData.get('tema'));
  } catch (e) {
    if (e instanceof PreferenciaError) return { erro: 'Escolha uma das opções.' };
    throw e;
  }
  revalidatePath('/painel', 'layout');
  return { ok: true };
}

/**
 * Manual guiado (D27): concluído, dispensado ou visto, por tour e versão. Sem revalidatePath de propósito: o "visto" é
 * gravado ao montar o aviso e revalidar o layout a cada marcação refaria o render do painel inteiro; o GuiaDoPainel
 * (T19) mantém o progresso em estado local, atualizado de forma otimista.
 */
export async function marcarGuiaAction(id: string, versao: number, estado: EstadoGuia): Promise<void> {
  const { data } = await requireNutri('/painel', { permitirDpaPendente: true });
  await marcarGuia(data.user.id, id, versao, estado);
}
