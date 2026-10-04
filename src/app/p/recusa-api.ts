import { withReturnPath } from '@/lib/safe-return';
import { MSG_SESSAO_EXPIRADA } from '@/lib/session-rules';

/**
 * O que a tela mostra quando a API do portal recusa a sessão: a mensagem do servidor e, no 401, o login com volta; no 403
 * de vínculo a escolher (`motivo: 'escolher'`, S-4), a escolha do consultório com volta.
 */
export type RecusaDoPortal = { mensagem: string; entrar: string | null; escolher: string | null };

/** ESCOLHER_PATH de paciente-session.ts (módulo só do servidor). */
const ESCOLHER = '/p/escolher';

/**
 * As recusas de requireApiPaciente/requireApiUser respondem `{ erro }` (401 sessão expirada; 403 termo pendente, vínculo
 * a escolher, consultório indisponível) — não o `{ erros }` de campo dos formulários. Fora desses casos, null.
 */
export function recusaDoPortal(status: number, corpo: unknown, volta: string): RecusaDoPortal | null {
  if (status !== 401 && status !== 403) return null;
  const { erro, motivo } = corpo && typeof corpo === 'object' ? (corpo as { erro?: unknown; motivo?: unknown }) : {};
  const mensagem = typeof erro === 'string' && erro.trim() ? erro : status === 401 ? MSG_SESSAO_EXPIRADA : null;
  if (!mensagem) return null;
  return {
    mensagem,
    entrar: status === 401 ? withReturnPath('/entrar', volta) : null,
    escolher: status === 403 && motivo === 'escolher' ? withReturnPath(ESCOLHER, volta) : null,
  };
}

/** O link que acompanha a mensagem da recusa: "Entrar" (401) ou "Escolher nutricionista" (403 de vínculo a escolher, S-4). */
export function linkDaRecusa(r: RecusaDoPortal | null): { href: string; texto: string } | null {
  if (r?.entrar) return { href: r.entrar, texto: 'Entrar' };
  if (r?.escolher) return { href: r.escolher, texto: 'Escolher nutricionista' };
  return null;
}
