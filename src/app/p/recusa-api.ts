import { withReturnPath } from '@/lib/safe-return';
import { MSG_SESSAO_EXPIRADA } from '@/lib/session-rules';

/** O que a tela mostra quando a API do portal recusa a sessão: a mensagem do servidor e, no 401, o login com volta. */
export type RecusaDoPortal = { mensagem: string; entrar: string | null };

/**
 * As recusas de requireApiPaciente/requireApiUser respondem `{ erro }` (401 sessão expirada; 403 termo pendente, vínculo
 * a escolher, consultório indisponível) — não o `{ erros }` de campo dos formulários. Fora desses casos, null.
 */
export function recusaDoPortal(status: number, corpo: unknown, volta: string): RecusaDoPortal | null {
  if (status !== 401 && status !== 403) return null;
  const erro = corpo && typeof corpo === 'object' ? (corpo as { erro?: unknown }).erro : undefined;
  const mensagem = typeof erro === 'string' && erro.trim() ? erro : status === 401 ? MSG_SESSAO_EXPIRADA : null;
  return mensagem ? { mensagem, entrar: status === 401 ? withReturnPath('/entrar', volta) : null } : null;
}
