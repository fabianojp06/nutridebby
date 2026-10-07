import type { EstadoDaSessao, MotivoDoFim } from './session-rules';
import { ehMotivoDoFim } from './session-rules';

/**
 * P12-14 (RNF-06): o relógio da tela da equipe, em horas do próprio aparelho (as abas do mesmo navegador dividem o
 * relógio). O servidor é a autoridade: a tela só antecipa o aviso e, antes de avisar ou de sair, pergunta de novo.
 */
export type Relogio = {
  /** Quando a sessão acaba por inatividade (última atividade registrada no servidor + 30 min). */
  prazo: number;
  /** Quando a sessão chega ao limite de 8 h desde o login. */
  limite: number;
  avisoMs: number;
  cadenciaMs: number;
};

export function relogioDe(e: EstadoDaSessao, agora: number): Relogio {
  return { prazo: agora + e.inatividadeMs, limite: agora + e.limiteMs, avisoMs: e.avisoMs, cadenciaMs: e.cadenciaMs };
}

export type Passo = { tipo: 'esperar'; ate: number } | { tipo: 'avisar'; ate: number } | { tipo: 'encerrar'; motivo: MotivoDoFim };

/**
 * O próximo passo da tela: esperar até a hora do aviso (ou do limite), mostrar o aviso até o fim, ou encerrar. O aviso
 * de 2 min é só da inatividade — o limite de 8 h não se renova com "Continuar conectada", então não há aviso para ele.
 */
export function proximoPasso(r: Relogio, agora: number): Passo {
  const porLimite = r.limite <= r.prazo;
  const fim = porLimite ? r.limite : r.prazo;
  if (agora >= fim) return { tipo: 'encerrar', motivo: porLimite ? 'limite' : 'inatividade' };
  if (porLimite) return { tipo: 'esperar', ate: fim };
  const aviso = r.prazo - r.avisoMs;
  return agora >= aviso ? { tipo: 'avisar', ate: fim } : { tipo: 'esperar', ate: aviso };
}

/** O motivo quando o servidor já recusou a sessão (401): o limite, se a hora dele chegou; senão, a inatividade. */
export function motivoLocal(r: Relogio | null, agora: number): MotivoDoFim {
  return r && agora >= r.limite - 1000 ? 'limite' : 'inatividade';
}

/** A resposta de `/api/sessao/ativa`, conferida (corpo que não seja o esperado é ignorado). */
export function lerEstado(v: unknown): EstadoDaSessao | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const campos = ['inatividadeMs', 'limiteMs', 'avisoMs', 'cadenciaMs'] as const;
  if (!campos.every((c) => typeof o[c] === 'number' && Number.isFinite(o[c]) && (o[c] as number) >= 0)) return null;
  return { inatividadeMs: o.inatividadeMs as number, limiteMs: o.limiteMs as number, avisoMs: o.avisoMs as number, cadenciaMs: o.cadenciaMs as number };
}

/**
 * Mensagens entre as abas do painel e do admin (BroadcastChannel, ou o evento `storage` como alternativa): só horários e
 * o motivo — nada de dado pessoal.
 */
export type MensagemSessao = { tipo: 'renovada'; prazo: number; limite: number; ping: number } | { tipo: 'encerrar'; motivo: MotivoDoFim };
export const CANAL_SESSAO = 'nd-sessao';

export function lerMensagem(v: unknown): MensagemSessao | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  if (o.tipo === 'renovada' && num(o.prazo) && num(o.limite) && num(o.ping)) return { tipo: 'renovada', prazo: o.prazo, limite: o.limite, ping: o.ping };
  if (o.tipo === 'encerrar' && ehMotivoDoFim(o.motivo)) return { tipo: 'encerrar', motivo: o.motivo };
  return null;
}
