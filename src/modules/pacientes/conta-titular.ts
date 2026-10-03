import { eq, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { account, session, twoFactor, user } from '@/db/schema';

/**
 * P06-08 (D18): a conta de login do titular não tem outro vínculo não anonimizado, em nenhum tenant? Conferido DENTRO
 * da transação da anonimização (contexto `worker`), depois do UPDATE de `patients` que solta a conta: a função
 * `app_conta_sem_outro_vinculo` (migration 0079) trava a conta e lê os prontuários dela no contexto `conta`.
 */
export async function contaSemOutroVinculo(tx: Tx, userId: string): Promise<boolean> {
  const r = await tx.execute<{ sozinha: boolean }>(sql`select app_conta_sem_outro_vinculo(${userId}::uuid) as sozinha`);
  return r.rows[0]?.sozinha === true;
}

/**
 * P06-08 (D18, desvio decidido pelo dono em 30/09/2026): o titular anonimizado que não tem outro vínculo perde a
 * identificação também na conta de login. A tabela `user` fica fora da RLS (CLAUDE.md regra 1): só pelo id da conta.
 * A linha não é apagada (patients.user_id e consents apontam para ela; apagar dispararia a auditoria fora do tenant).
 */
export async function anonimizarContaSemVinculo(tx: Tx, userId: string, now: Date): Promise<void> {
  await tx.delete(session).where(eq(session.userId, userId));
  await tx.delete(account).where(eq(account.userId, userId));
  await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
  await tx
    .update(user)
    .set({ name: 'Paciente anonimizado', email: `anonimo-${userId}@anonimizado.invalid`, emailVerified: false, twoFactorEnabled: false, updatedAt: now })
    .where(eq(user.id, userId));
}
