'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_AGENDA } from '@/modules/agenda/constantes';
import { ConsultaError } from '@/modules/agenda/consultas';
import { aceitarSolicitacao, PedidoMudouError, recusarSolicitacao } from '@/modules/agenda/solicitacoes';
import { ERRO_DO_ACEITE, type ErroDoAceite } from './retornos';

const CAMINHO = '/painel/agenda/solicitacoes';
type Tipo = 'consulta' | 'pessoa_nova';
export type RecusaState = { erro?: string };

/** O tipo vem do `bind` da página; qualquer outro valor (forjado) é tratado como consulta e cai no "já respondido". */
const tipoValido = (t: unknown): Tipo => (t === 'pessoa_nova' ? 'pessoa_nova' : 'consulta');

/** A volta das ações (§7): a fila com `?ok=` ou `?erro=` (lista fechada) e o marcador `envio`, que leva o foco ao h1 de novo. */
const destino = (q: string) => `${CAMINHO}?${q}&envio=${Date.now()}`;

function refazerTelas(): void {
  revalidatePath(CAMINHO);
  revalidatePath('/painel/agenda');
  revalidatePath('/painel');
}

/** A mensagem do aceite (RN-424, §6.2) → a chave da URL; mensagem desconhecida não é engolida. */
function erroDoAceite(e: ConsultaError): ErroDoAceite | null {
  const geral = e.erros.geral;
  return (Object.keys(ERRO_DO_ACEITE) as ErroDoAceite[]).find((k) => ERRO_DO_ACEITE[k] === geral) ?? null;
}

/**
 * US-409 "Aceitar" (funciona sem JavaScript: um `<form>` com o botão). O pedido que já mudou (respondido em outra aba,
 * vencido) → `?ok=mudou`; o e-mail de paciente arquivado ou bloqueado, o horário tomado, o local que não serve mais
 * (/code-review do PR 3, I-2) e o paciente arquivado →
 * `?erro=` com o texto da §6.2 na região de status. Só a sessão `nutri`: o módulo recusa antes de abrir a transação.
 */
export async function aceitarAction(tipo: Tipo, id: string): Promise<void> {
  const { ctx, tenant } = await requireNutri(CAMINHO);
  let volta = 'ok=aceito';
  try {
    await aceitarSolicitacao(ctx, tenant, { tipo: tipoValido(tipo), id });
  } catch (e) {
    if (e instanceof PedidoMudouError) volta = 'ok=mudou';
    else if (e instanceof ConsultaError && erroDoAceite(e)) volta = `erro=${erroDoAceite(e)}`;
    else throw e;
  }
  refazerTelas();
  redirect(destino(volta));
}

/**
 * US-409 "Confirmar recusa" (o diálogo da fila e da tela da consulta). O motivo, só no pedido de paciente, fica com a
 * nutricionista (AG-D23); o da pessoa nova é ignorado pelo módulo. Motivo longo → erro no próprio diálogo.
 */
export async function recusarAction(tipo: Tipo, id: string, _prev: RecusaState, fd: FormData): Promise<RecusaState> {
  const { ctx, tenant } = await requireNutri(CAMINHO);
  let volta = 'ok=recusado';
  try {
    await recusarSolicitacao(ctx, tenant, { tipo: tipoValido(tipo), id, motivo: fd.get('motivo') });
  } catch (e) {
    if (e instanceof PedidoMudouError) volta = 'ok=mudou';
    else if (e instanceof ConsultaError) return { erro: e.erros.motivo ?? e.erros.geral ?? MSG_AGENDA.motivoCancelamentoLongo };
    else throw e;
  }
  refazerTelas();
  redirect(destino(volta));
}

