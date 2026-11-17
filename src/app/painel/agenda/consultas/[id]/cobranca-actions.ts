'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { ConsultaNaoEncontradaError } from '@/modules/agenda/consultas';
import { ConsultaNaoRealizadaError, registrarCobrancaManual } from '@/modules/financeiro/cobranca';
import { FinanceiroError, FinanceiroNaoConfiguradoError, LancamentoNaoEncontradoError } from '@/modules/financeiro/erros';
import { ajustarValor, cancelarLancamento, marcarRecebido } from '@/modules/financeiro/lancamentos';
import { idValido } from '@/modules/pacientes/base';
import type { LancamentoState } from '../../../financeiro/lancamentos/actions';

/**
 * US-303 / RN-314: as ações da seção "Cobrança" da tela da consulta. A consulta vem ligada no servidor (`bind`); a sessão,
 * de `requireNutri`. Deu certo → a mesma consulta com `?ok=cobranca_…` (a mensagem da §6.2) e um envio novo (as peças da
 * seção remontam com o que está gravado); recusado → o erro junto do campo, com o digitado (`valores`, nunca no erro —
 * RN-322).
 */
const texto = (fd: FormData, campo: string) => {
  const v = fd.get(campo);
  return typeof v === 'string' ? v : '';
};
const proximoEnvio = (prev: { envio?: number }) => Math.max(Date.now(), (prev.envio ?? 0) + 1);

/** O que a página da consulta mostra para cada `ok=` destas actions. */
export type OkDaCobranca = 'cobranca_registrada' | 'cobranca_salva' | 'cobranca_recebida' | 'cobranca_cancelada';

async function naConsulta(
  consultaId: string,
  prev: LancamentoState,
  valores: Record<string, string>,
  fazer: (s: Awaited<ReturnType<typeof requireNutri>>) => Promise<OkDaCobranca>,
): Promise<LancamentoState> {
  if (!idValido(consultaId)) notFound();
  const url = `/painel/agenda/consultas/${consultaId}`;
  const sessao = await requireNutri(url);
  let ok: OkDaCobranca;
  try {
    ok = await fazer(sessao);
  } catch (e) {
    if (e instanceof FinanceiroError) return { erros: e.erros, valores, envio: proximoEnvio(prev) };
    if (e instanceof ConsultaNaoEncontradaError || e instanceof LancamentoNaoEncontradoError) notFound();
    // a consulta deixou de ser "Realizada" com a tela aberta: a tela volta ao estado atual (sem o formulário)
    if (e instanceof ConsultaNaoRealizadaError) redirect(url);
    if (e instanceof FinanceiroNaoConfiguradoError) redirect('/painel/financeiro/configuracoes?aviso=informeSaldo');
    throw e;
  }
  revalidatePath('/painel/financeiro', 'layout');
  revalidatePath('/painel/agenda');
  redirect(`${url}?ok=${ok}&envio=${proximoEnvio(prev)}`);
}

/** "Registrar cobrança" (RN-314): o valor sugerido vem preenchido e é obrigatório. */
export async function registrarCobrancaAction(consultaId: string, prev: LancamentoState, fd: FormData): Promise<LancamentoState> {
  const valores = { valor: texto(fd, 'valor') };
  return naConsulta(consultaId, prev, valores, async ({ ctx, tenant }) => {
    await registrarCobrancaManual(ctx, tenant, consultaId, valores.valor);
    return 'cobranca_registrada';
  });
}

/** "Salvar valor": só o valor da cobrança (paciente bloqueado: só para menor, RN-315). */
export async function salvarValorCobrancaAction(consultaId: string, prev: LancamentoState, fd: FormData): Promise<LancamentoState> {
  const valores = { valor: texto(fd, 'valor') };
  return naConsulta(consultaId, prev, valores, async ({ ctx }) => {
    await ajustarValor(ctx, texto(fd, 'id'), valores.valor);
    return 'cobranca_salva';
  });
}

/** "Marcar como recebido" pela seção: data (até hoje) e forma. */
export async function receberCobrancaAction(consultaId: string, prev: LancamentoState, fd: FormData): Promise<LancamentoState> {
  const valores = { pagoEm: texto(fd, 'pagoEm'), forma: texto(fd, 'forma') };
  return naConsulta(consultaId, prev, valores, async ({ ctx, tenant }) => {
    await marcarRecebido(ctx, tenant, texto(fd, 'id'), valores);
    return 'cobranca_recebida';
  });
}

/** "Cancelar lançamento" pela seção (RN-309): motivo de 1 a 200 caracteres. */
export async function cancelarCobrancaAction(consultaId: string, prev: LancamentoState, fd: FormData): Promise<LancamentoState> {
  const valores = { motivo: texto(fd, 'motivo') };
  return naConsulta(consultaId, prev, valores, async ({ ctx }) => {
    await cancelarLancamento(ctx, texto(fd, 'id'), valores.motivo);
    return 'cobranca_cancelada';
  });
}
