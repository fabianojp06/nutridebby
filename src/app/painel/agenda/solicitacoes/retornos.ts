import { MSG_AGENDA, MSG_SOLICITACOES } from '@/modules/agenda/constantes';

/**
 * Plano 23 (§7, US-409): a volta das ações da fila "Solicitações" pela URL — listas fechadas (um valor fora delas não
 * mostra nada; a URL nunca vira texto na tela). Módulo puro: a página e as actions usam.
 */
export const OK_DA_FILA = {
  aceito: { texto: MSG_SOLICITACOES.aceito, tipo: 'ok' },
  recusado: { texto: MSG_SOLICITACOES.recusado, tipo: 'ok' },
  mudou: { texto: MSG_SOLICITACOES.mudou, tipo: 'aviso' },
} as const;

/** O aceite que não deu certo (RN-424): o texto exato da §6.2, na mesma região de status. */
export const ERRO_DO_ACEITE = {
  inativo: MSG_SOLICITACOES.emailInativo,
  ocupado: MSG_SOLICITACOES.horarioOcupado,
  arquivado: MSG_AGENDA.pacienteArquivado,
} as const;
export type ErroDoAceite = keyof typeof ERRO_DO_ACEITE;

const de = <T extends object>(mapa: T, v: unknown): keyof T | null => (typeof v === 'string' && Object.hasOwn(mapa, v) ? (v as keyof T) : null);

/** O texto e o tipo da região de status para os parâmetros da URL (ou nada). */
export function retornoDaFila(sp: { ok?: unknown; erro?: unknown }): { texto: string; tipo: 'ok' | 'aviso' } | null {
  const ok = de(OK_DA_FILA, sp.ok);
  if (ok) return OK_DA_FILA[ok];
  const erro = de(ERRO_DO_ACEITE, sp.erro);
  return erro ? { texto: ERRO_DO_ACEITE[erro], tipo: 'aviso' } : null;
}
