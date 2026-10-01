import { MSG_SESSAO_EXPIRADA } from '@/lib/session-rules';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';

/** O que o salvamento automático faz com a resposta do PUT (D7). */
export type RespostaSalvamento =
  | { tipo: 'salvo'; revisao: number }
  /** 422: erro de campo; a próxima edição tenta de novo. */
  | { tipo: 'campos'; erros: Record<string, string> }
  /** Repetir não adianta: o editor para e mostra o motivo no lugar do status (como o conflito entre abas). */
  | { tipo: 'parar'; mensagem: string }
  /** Sem resposta confiável (rede, 5xx, corpo perdido): "Alterações não salvas" e nova tentativa. */
  | { tipo: 'incerto' };

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** `corpo`: o JSON da resposta, ou null se não veio (ou não era JSON). */
export function interpretarResposta(status: number, corpo: unknown): RespostaSalvamento {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as { revisao?: unknown; erros?: unknown; erro?: unknown; codigo?: unknown };
  const erro = texto(c.erro);
  if (status >= 200 && status < 300) return Number.isInteger(c.revisao) ? { tipo: 'salvo', revisao: c.revisao as number } : { tipo: 'incerto' };
  if (status === 422) return { tipo: 'campos', erros: c.erros && typeof c.erros === 'object' ? (c.erros as Record<string, string>) : { geral: MSG_PLANO.invalido } };
  // 409: conflito entre abas, paciente bloqueado ou versão já publicada; só o primeiro é "alterado em outra aba"
  if (status === 409) return { tipo: 'parar', mensagem: c.codigo !== 'conflito' && erro ? erro : MSG_PLANO.conflito };
  if (status === 401 || status === 403) return { tipo: 'parar', mensagem: erro ?? MSG_SESSAO_EXPIRADA };
  if (status === 404) return { tipo: 'parar', mensagem: MSG_PLANO.naoEncontrado };
  if (status === 413) return { tipo: 'parar', mensagem: erro ?? MSG_PLANO.grande };
  if (status >= 500 || status === 408 || status === 429) return { tipo: 'incerto' };
  return { tipo: 'parar', mensagem: MSG_PLANO.invalido };
}
