'use server';

import { requireNutri } from '@/lib/tenant-session';
import { PacienteBloqueadoError, PacienteNaoEncontradoError, idValido } from '@/modules/pacientes/base';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { PlanoNaoEditavelError, PlanoNaoEncontradoError } from '@/modules/plano-alimentar/erros';
import { atualizarDaBiblioteca, desligarConteudo, ligarConteudo, ligarLista, LigadoError, removerLista, type DonoDoPlano } from '@/modules/plano-alimentar/ligados';
import type { ConteudoLigado, ListaLigada } from '@/modules/plano-alimentar/tipos';
import type { TenantContext } from '@/db/tenant';

/**
 * US-239 (RN-252, RN-253): as ações da seção "Ligado ao plano" do editor. Cada uma grava na hora (fora do salvamento
 * automático, que não leva as ligações) e devolve o que mudou para a tela, ou o erro para mostrar ao lado do botão.
 * `patientId` nulo = modelo. O módulo confere o dono do plano, o rascunho e o paciente bloqueado.
 */

export type ResultadoLigado<T = void> = { erro?: string; valor?: T };

/** A tela para onde o login volta; id forjado na chamada não entra no caminho. */
const tela = (d: DonoDoPlano) =>
  !idValido(d.planId) ? '/painel/planos/modelos' : d.patientId === null ? `/painel/planos/modelos/${d.planId}` : idValido(d.patientId) ? `/painel/pacientes/${d.patientId}/plano-alimentar/${d.planId}` : '/painel/pacientes';

/** O dono como veio da chamada (entrada do cliente): fora do formato, um dono que o módulo não acha. */
const lerDono = (d: unknown): DonoDoPlano => {
  const o = (typeof d === 'object' && d !== null ? d : {}) as Record<string, unknown>;
  return { planId: typeof o.planId === 'string' ? o.planId : '', patientId: typeof o.patientId === 'string' ? o.patientId : null };
};

async function executar<T>(entrada: DonoDoPlano, acao: (ctx: TenantContext, d: DonoDoPlano) => Promise<T>): Promise<ResultadoLigado<T>> {
  const d = lerDono(entrada);
  const { ctx } = await requireNutri(tela(d));
  try {
    return { valor: await acao(ctx, d) };
  } catch (e) {
    if (e instanceof LigadoError || e instanceof PlanoNaoEditavelError || e instanceof PacienteBloqueadoError) return { erro: e.message };
    if (e instanceof PlanoNaoEncontradoError || e instanceof PacienteNaoEncontradoError) return { erro: MSG_PLANO.naoEncontrado };
    throw e;
  }
}

export async function ligarListaAction(d: DonoDoPlano, listaId: string): Promise<ResultadoLigado<ListaLigada>> {
  return executar(d, (ctx, dono) => ligarLista(ctx, dono, listaId));
}

export async function atualizarDaBibliotecaAction(d: DonoDoPlano, ligacaoId: string): Promise<ResultadoLigado<ListaLigada>> {
  return executar(d, (ctx, dono) => atualizarDaBiblioteca(ctx, dono, ligacaoId));
}

export async function removerListaAction(d: DonoDoPlano, ligacaoId: string): Promise<ResultadoLigado> {
  return executar(d, (ctx, dono) => removerLista(ctx, dono, ligacaoId));
}

export async function ligarConteudoAction(d: DonoDoPlano, contentId: string): Promise<ResultadoLigado<ConteudoLigado>> {
  return executar(d, (ctx, dono) => ligarConteudo(ctx, dono, contentId));
}

export async function desligarConteudoAction(d: DonoDoPlano, ligacaoId: string): Promise<ResultadoLigado> {
  return executar(d, (ctx, dono) => desligarConteudo(ctx, dono, ligacaoId));
}
