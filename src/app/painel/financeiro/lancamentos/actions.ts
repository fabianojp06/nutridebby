'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import {
  FinanceiroError,
  FinanceiroNaoConfiguradoError,
  LancamentoNaoEncontradoError,
} from '@/modules/financeiro/erros';
import {
  cancelarLancamento,
  criarLancamento,
  desfazerRecebimento,
  editarLancamento,
  marcarRecebido,
} from '@/modules/financeiro/lancamentos';
import { PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { LISTA, PARAMETROS_DA_LISTA } from './url';

const CAMPOS = [
  'valor',
  'categoriaId',
  'vencimento',
  'pacienteId',
  'descricao',
  'jaFoi',
  'pagoEm',
  'forma',
] as const;
export type CampoDoLancamento = (typeof CAMPOS)[number];

/**
 * Erro: os erros por campo (textos da spec, nunca o digitado — RN-322) e o que foi digitado (`valores`, só para a tela);
 * `envio` muda a cada resposta e remonta o formulário (`key`), como nas Configurações.
 */
export type LancamentoState = {
  erros?: Record<string, string>;
  valores?: Record<string, string>;
  envio?: number;
};

const texto = (fd: FormData, campo: string) => {
  const v = fd.get(campo);
  return typeof v === 'string' ? v : '';
};
/** Sempre diferente do envio anterior, mesmo duas respostas no mesmo milissegundo. */
const proximoEnvio = (prev: { envio?: number }) => Math.max(Date.now(), (prev.envio ?? 0) + 1);
/** Lançamentos mudam o Resumo, a lista, as pendências e os relatórios. */
const revalidar = () => revalidatePath('/painel/financeiro', 'layout');
const falhou = (
  e: FinanceiroError,
  valores: Record<string, string>,
  prev: LancamentoState,
): LancamentoState => ({ erros: e.erros, valores, envio: proximoEnvio(prev) });

/** O formulário do lançamento: sem "Já foi recebido/pago" marcado, a data e a forma enviadas não valem (US-301). */
function camposDoFormulario(fd: FormData) {
  const valores = Object.fromEntries(CAMPOS.map((c) => [c, texto(fd, c)])) as Record<
    CampoDoLancamento,
    string
  >;
  const jaFoi = valores.jaFoi === 'on';
  return {
    valores,
    input: { ...valores, pagoEm: jaFoi ? valores.pagoEm : '', forma: jaFoi ? valores.forma : '' },
  };
}

/** Depois de salvar: a lista no mês de referência do lançamento (US-301), com o aviso de antes do saldo quando for o caso. */
function voltarALista(r: { mes: string; antesDoSaldo: boolean }, prev: LancamentoState): never {
  revalidar();
  redirect(
    `${LISTA}?mes=${r.mes}&ok=salvo${r.antesDoSaldo ? '&aviso=antes_do_saldo' : ''}&envio=${proximoEnvio(prev)}`,
  );
}

const ORIGEM = 'http://financeiro.invalid';
const CAMINHO_DE_VOLTA =
  /^\/painel\/financeiro\/lancamentos(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/;

/**
 * Receber, desfazer e cancelar voltam à tela de onde vieram (a lista com os filtros, ou a edição), com o `ok=` e um envio
 * novo (§7: foco no h1 e a mensagem na região fixa, mesmo que a linha saia da lista). O `volta` do formulário só vale
 * se for a lista ou a edição de um lançamento, no mesmo site; da lista só ficam os filtros conhecidos. Senão, a lista.
 */
function destino(volta: string, ok: string, prev: LancamentoState): string {
  let u: URL | null = null;
  try {
    u = new URL(volta, ORIGEM);
  } catch {
    u = null;
  }
  const caminho =
    u && u.origin === ORIGEM && CAMINHO_DE_VOLTA.test(u.pathname) ? u.pathname : LISTA;
  const q = new URLSearchParams();
  if (u && caminho === LISTA)
    for (const k of PARAMETROS_DA_LISTA)
      if (u.searchParams.has(k)) q.set(k, u.searchParams.get(k)!);
  q.set('ok', ok);
  q.set('envio', String(proximoEnvio(prev)));
  return `${caminho}?${q}`;
}

/** US-301. Sem configuração (RN-301) → Configurações com o aviso; paciente que não é do consultório (RLS) → 404. */
export async function criarLancamentoAction(
  prev: LancamentoState,
  fd: FormData,
): Promise<LancamentoState> {
  const { ctx, tenant } = await requireNutri(LISTA);
  const { valores, input } = camposDoFormulario(fd);
  let r: { mes: string; antesDoSaldo: boolean };
  try {
    r = await criarLancamento(ctx, tenant, { ...input, tipo: texto(fd, 'tipo') });
  } catch (e) {
    if (e instanceof FinanceiroError) return falhou(e, valores, prev);
    if (e instanceof FinanceiroNaoConfiguradoError)
      redirect('/painel/financeiro/configuracoes?aviso=informeSaldo');
    if (e instanceof PacienteNaoEncontradoError) notFound();
    throw e;
  }
  voltarALista(r, prev);
}

/** US-302 / RN-308: tipo e paciente são fixos (o módulo ignora o que vier); lançamento de outro consultório → 404. */
export async function editarLancamentoAction(
  prev: LancamentoState,
  fd: FormData,
): Promise<LancamentoState> {
  const { ctx, tenant } = await requireNutri(LISTA);
  const { valores, input } = camposDoFormulario(fd);
  let r: { mes: string; antesDoSaldo: boolean };
  try {
    r = await editarLancamento(ctx, tenant, texto(fd, 'id'), input);
  } catch (e) {
    if (e instanceof FinanceiroError) return falhou(e, valores, prev);
    if (e instanceof LancamentoNaoEncontradoError) notFound();
    throw e;
  }
  voltarALista(r, prev);
}

/** As ações da linha e da edição: recusa do módulo → erro junto do campo; lançamento de outro consultório → 404. */
async function naLinha(
  prev: LancamentoState,
  fd: FormData,
  valores: Record<string, string>,
  fazer: () => Promise<string>,
): Promise<LancamentoState> {
  let ok: string;
  try {
    ok = await fazer();
  } catch (e) {
    if (e instanceof FinanceiroError) return falhou(e, valores, prev);
    if (e instanceof LancamentoNaoEncontradoError) notFound();
    throw e;
  }
  revalidar();
  redirect(destino(texto(fd, 'volta'), ok, prev));
}

/** "Marcar como recebido/pago" (US-302): data e forma; a mensagem segue o tipo gravado, não o formulário. */
export async function receberLancamentoAction(
  prev: LancamentoState,
  fd: FormData,
): Promise<LancamentoState> {
  const { ctx, tenant } = await requireNutri(LISTA);
  const valores = { pagoEm: texto(fd, 'pagoEm'), forma: texto(fd, 'forma') };
  return naLinha(prev, fd, valores, async () => {
    const { tipo } = await marcarRecebido(ctx, tenant, texto(fd, 'id'), valores);
    return tipo === 'entrada' ? 'recebido' : 'pago';
  });
}

/** "Desfazer recebimento/pagamento" (US-302). A §6.2 não tem mensagem própria: "Lançamento salvo.". */
export async function desfazerRecebimentoAction(
  prev: LancamentoState,
  fd: FormData,
): Promise<LancamentoState> {
  const { ctx } = await requireNutri(LISTA);
  return naLinha(prev, fd, {}, async () => {
    await desfazerRecebimento(ctx, texto(fd, 'id'));
    return 'salvo';
  });
}

/** "Confirmar cancelamento" (RN-309): motivo de 1 a 200 caracteres. */
export async function cancelarLancamentoAction(
  prev: LancamentoState,
  fd: FormData,
): Promise<LancamentoState> {
  const { ctx } = await requireNutri(LISTA);
  const valores = { motivo: texto(fd, 'motivo') };
  return naLinha(prev, fd, valores, async () => {
    await cancelarLancamento(ctx, texto(fd, 'id'), valores.motivo);
    return 'cancelado';
  });
}
