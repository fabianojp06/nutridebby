'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormaAniversario } from '@/db/schema';
import { requireNutri } from '@/lib/tenant-session';
import { AniversarioError, enviarMensagensDeAniversario, registrarAutorizacao, retirarAutorizacao } from '@/modules/agenda/aniversarios';
import { MSG_ANIVERSARIO } from '@/modules/agenda/constantes';
import { PacienteNaoEncontradoError } from '@/modules/pacientes/base';

const CAMINHO = '/painel/agenda/aniversariantes';
export type AniversarioState = { erro?: string };

/** O mês da tela (vem do `bind` da página); qualquer outro valor volta para o mês corrente. */
const mesDaVolta = (mes: unknown) => (typeof mes === 'string' && /^20\d{2}-(0[1-9]|1[0-2])$/.test(mes) ? `mes=${mes}&` : '');
/** A volta das ações (§7): a lista com `?ok=` (lista fechada) e o marcador `envio`, que leva o foco ao h1 e anuncia de novo. */
const destino = (mes: unknown, q: string) => `${CAMINHO}?${mesDaVolta(mes)}${q ? `${q}&` : ''}envio=${Date.now()}`;

function refazerTelas(): void {
  revalidatePath(CAMINHO);
  revalidatePath('/painel');
}

/**
 * US-413 "Enviar mensagem" (a confirmação do diálogo da prévia): os marcados vão em `ids`; o módulo reconfere a RN-431 e
 * agenda uma por paciente por ano. Volta com "Mensagens agendadas: {n}.". Só a sessão `nutri` (o módulo recusa antes da
 * transação).
 */
export async function enviarAction(mes: string, _prev: AniversarioState, fd: FormData): Promise<AniversarioState> {
  const { ctx, tenant } = await requireNutri(CAMINHO);
  const r = await enviarMensagensDeAniversario(ctx, tenant, fd.getAll('ids'));
  refazerTelas();
  redirect(destino(mes, `ok=agendadas&n=${r.agendadas}`));
}

/**
 * US-414 "Registrar autorização": "Como o paciente autorizou?" e a confirmação "O paciente autorizou receber mensagens de
 * aniversário. Guarde o comprovante." (obrigatória). Erro (forma, menor, paciente inativo) volta ao diálogo.
 */
export async function registrarAction(patientId: string, mes: string, _prev: AniversarioState, fd: FormData): Promise<AniversarioState> {
  const { ctx } = await requireNutri(CAMINHO);
  if (fd.get('confirmo') !== 'on') return { erro: MSG_ANIVERSARIO.confirmeAutorizacao };
  try {
    await registrarAutorizacao(ctx, patientId, fd.get('forma') as FormaAniversario);
  } catch (e) {
    if (e instanceof AniversarioError) return { erro: e.message };
    if (e instanceof PacienteNaoEncontradoError) return { erro: MSG_ANIVERSARIO.naoPodeAutorizar };
    throw e;
  }
  refazerTelas();
  redirect(destino(mes, 'ok=autorizada'));
}

/**
 * US-414 "Retirar autorização" pela nutricionista (sem a forma, AG-D61). Sem autorização a retirar, nada é gravado. O
 * paciente que não existe mais nesta sessão (id forjado, outro consultório) volta à lista sem o "Autorização retirada."
 * (revisão da T10, M5), como as outras ações tratam `PacienteNaoEncontradoError`; outro erro sobe.
 */
export async function retirarAction(patientId: string, mes: string): Promise<void> {
  const { ctx } = await requireNutri(CAMINHO);
  let volta = 'ok=retirada';
  try {
    await retirarAutorizacao(ctx, patientId);
  } catch (e) {
    if (!(e instanceof PacienteNaoEncontradoError)) throw e;
    volta = '';
  }
  refazerTelas();
  redirect(destino(mes, volta));
}
