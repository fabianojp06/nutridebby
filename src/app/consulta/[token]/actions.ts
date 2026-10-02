'use server';

import { refresh } from 'next/cache';
import { getEnv } from '@/env';
import { requestIp } from '@/lib/request-ip';
import { avisarRemarcacaoPeloLink, cancelarPeloLink, confirmarPeloLink, LinkError, remarcarPeloLink } from '@/modules/agenda/acoes-link';
import { MSG_AGENDA } from '@/modules/agenda/constantes';
import { ConsultaError } from '@/modules/agenda/consultas';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';

export type AcaoLinkState = { ok?: string; erro?: string; erroHorario?: string };

/**
 * D20: o token (argumento ligado pelo cliente) é conferido em acoes-link a cada ação. Depois de qualquer resposta tratada,
 * `refresh()` refaz a página: ela mostra a situação atual (confirmada, cancelada, link indisponível, horários de novo).
 */
async function executar(f: () => Promise<AcaoLinkState>): Promise<AcaoLinkState> {
  let r: AcaoLinkState;
  try {
    r = await f();
  } catch (e) {
    if (e instanceof LinkError) r = { erro: e.message };
    // rodada 1 (US-018): o acoes-link já converte; aqui é a última rede — paciente bloqueado nunca vira 500
    else if (e instanceof PacienteBloqueadoError) r = { erro: MSG_AGENDA.contaIndisponivel };
    else if (e instanceof ConsultaError) r = e.erros.inicio ? { erroHorario: e.erros.inicio } : { erro: e.erros.geral ?? Object.values(e.erros)[0] };
    else throw e;
  }
  refresh();
  return r;
}
const deps = async () => ({ ip: await requestIp(), appUrl: getEnv().APP_URL });

export async function confirmarAction(token: string): Promise<AcaoLinkState> {
  return executar(async () => ((await confirmarPeloLink(token, await deps())) === 'nao_confirmavel' ? { erro: MSG_AGENDA.naoAlteravel } : { ok: MSG_AGENDA.presencaConfirmada }));
}

export async function cancelarAction(token: string): Promise<AcaoLinkState> {
  return executar(async () => {
    await cancelarPeloLink(token, await deps());
    return { ok: MSG_AGENDA.cancelada };
  });
}

export async function remarcarAction(token: string, _prev: AcaoLinkState, fd: FormData): Promise<AcaoLinkState> {
  return executar(async () => ({ ok: MSG_AGENDA.remarcada((await remarcarPeloLink(token, { inicio: fd.get('inicio'), modalidade: fd.get('modalidade') }, await deps())).quando) }));
}

/** US-035: false = o pedido já tinha sido feito ou não cabe mais (consulta cancelada ou começando) — a página se refaz. */
export async function avisarAction(token: string): Promise<AcaoLinkState> {
  return executar(async () => ((await avisarRemarcacaoPeloLink(token, await deps())) ? { ok: MSG_AGENDA.avisoDeRemarcacao } : { erro: MSG_AGENDA.foraDoPrazo }));
}
