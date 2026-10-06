import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { adminActions, session, twoFactor, user } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import type { EmailMessage } from '@/email/types';
import { logger } from '@/lib/logger';
import type { AppRole } from '@/lib/session-rules';

export const MSG_2FA = {
  email: 'Informe o e-mail da conta.',
  naoEncontrada: 'Nenhuma conta com este e-mail.',
  propria: 'Não é possível reiniciar a verificação em duas etapas da sua própria conta por aqui.',
  semDoisFatores: 'Esta conta não tem a verificação em duas etapas ativa.',
  ok: 'Verificação em duas etapas reiniciada. As sessões da conta foram encerradas e ela recebeu um e-mail. A pessoa pode ativar de novo em Conta > Segurança.',
  okAdmin: 'Verificação em duas etapas reiniciada. As sessões da conta foram encerradas e ela recebeu um e-mail. No próximo login, a configuração será obrigatória.',
} as const;

export type Codigo2fa = 'email' | 'nao_encontrada' | 'propria' | 'sem_2fa';
const MENSAGEM: Record<Codigo2fa, string> = {
  email: MSG_2FA.email,
  nao_encontrada: MSG_2FA.naoEncontrada,
  propria: MSG_2FA.propria,
  sem_2fa: MSG_2FA.semDoisFatores,
};

export class Reiniciar2faError extends Error {
  override name = 'Reiniciar2faError';
  constructor(readonly codigo: Codigo2fa) {
    super(MENSAGEM[codigo]);
  }
}

export type Autor = { origem: 'admin'; adminId: string } | { origem: 'cli'; adminId: null };
type Avisar = (msg: EmailMessage, tx: Tx) => Promise<unknown>;
/** tenantId nulo: o aviso de segurança sai mesmo com o consultório suspenso (o job ignora e-mail de tenant suspenso). */
const avisarPorEmail: Avisar = (msg, tx) => enqueueEmail(msg, { tx });

/**
 * P09-02 (b) / manual técnico §6.9.1: trocar o AUTH_SECRET deixa quem tem 2FA sem entrar (o segredo do TOTP e os códigos
 * de recuperação são cifrados com ele). Numa transação: trava a conta, apaga a linha de `two_factor`, desliga
 * `two_factor_enabled`, revoga as sessões, registra em `admin_actions` e enfileira o aviso à própria conta. A tabela
 * `user` é exceção de RLS (CLAUDE.md regra 1: este arquivo está na lista).
 */
export async function reiniciarDoisFatores(
  emailInformado: string,
  autor: Autor,
  deps: { db?: Db; avisar?: Avisar } = {},
): Promise<{ userId: string; papel: AppRole; sessoesRevogadas: number }> {
  const email = emailInformado.trim();
  if (!email || email.length > 254) throw new Reiniciar2faError('email');
  const db = deps.db ?? getDb();
  const avisar = deps.avisar ?? avisarPorEmail;
  const r = await db.transaction(async (tx) => {
    // `email` é citext: a busca não depende de maiúsculas
    const [alvo] = await tx
      .select({ id: user.id, email: user.email, papel: user.appRole, ativo: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.email, email))
      .for('update');
    if (!alvo) throw new Reiniciar2faError('nao_encontrada');
    if (autor.origem === 'admin' && alvo.id === autor.adminId) throw new Reiniciar2faError('propria');
    const apagados = await tx.delete(twoFactor).where(eq(twoFactor.userId, alvo.id)).returning({ id: twoFactor.id });
    if (!alvo.ativo && apagados.length === 0) throw new Reiniciar2faError('sem_2fa');
    await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, alvo.id));
    const sessoes = await tx.delete(session).where(eq(session.userId, alvo.id)).returning({ id: session.id });
    await tx.insert(adminActions).values({ adminUserId: autor.adminId, acao: 'reiniciar_2fa', alvoUserId: alvo.id, alvoPapel: alvo.papel, origem: autor.origem });
    await avisar({ tipo: 'aviso_2fa_reiniciado', para: alvo.email }, tx);
    return { userId: alvo.id, papel: alvo.papel as AppRole, sessoesRevogadas: sessoes.length };
  });
  // regra 3: só ids e o papel; nunca o e-mail
  logger.info({ adminId: autor.adminId, origem: autor.origem, alvoUserId: r.userId, papel: r.papel, sessoesRevogadas: r.sessoesRevogadas }, 'verificação em duas etapas reiniciada');
  return r;
}
