import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { account, session, twoFactor, user, verification } from '@/db/schema';

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
 * B-1: só conta de paciente (uma conta da equipe ligada a um prontuário seria bug a montante: nada é tocado e a
 * função devolve false); sai também a foto (`image`) e o que o Better Auth guarda em `verification` com o id da conta
 * (link de redefinição pendente) ou do 2FA dela (estado do segundo fator).
 */
export async function anonimizarContaSemVinculo(tx: Tx, userId: string, now: Date): Promise<boolean> {
  const anonimizada = await tx
    .update(user)
    .set({ name: 'Paciente anonimizado', email: `anonimo-${userId}@anonimizado.invalid`, emailVerified: false, image: null, twoFactorEnabled: false, updatedAt: now })
    .where(and(eq(user.id, userId), eq(user.appRole, 'paciente')))
    .returning({ id: user.id });
  if (!anonimizada.length) return false;
  const doisFatores = tx.select({ id: sql<string>`${twoFactor.id}::text` }).from(twoFactor).where(eq(twoFactor.userId, userId));
  await tx.delete(verification).where(or(eq(verification.value, userId), inArray(verification.value, doisFatores)));
  await tx.delete(session).where(eq(session.userId, userId));
  await tx.delete(account).where(eq(account.userId, userId));
  await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
  return true;
}
