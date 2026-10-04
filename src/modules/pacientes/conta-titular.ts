import { and, eq, sql } from 'drizzle-orm';
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
 * função devolve false); sai também a foto (`image`) e o que o Better Auth guarda em `verification` ligado à conta.
 * Better Auth 1.7.6 com `verification.storeIdentifier: 'hashed'` (src/lib/auth.ts): `identifier` é gravado como
 * base64url(SHA-256(identifier)) (db/verification-token-storage.mjs), então só `value` pode ligar uma linha à conta.
 * O link de redefinição, o desafio de 2FA (`2fa-<aleatório>`) e o aparelho confiável (`trust-device-…`) gravam o id
 * da conta em `value` e saem aqui. O contador de tentativas (`2fa-attempts-<desafio>`, value = número) e o código por
 * e-mail (`2fa-otp-…`, value = hash do código) não podem ser ligados à conta: o identifier tem hash e não há PII em
 * nenhuma das colunas; expiram sozinhos em minutos (twoFactorCookieMaxAge, 600 s por padrão; período do OTP, 3 min) e,
 * sem a linha do desafio, não servem para nada. Conferir ao atualizar o Better Auth.
 */
export async function anonimizarContaSemVinculo(tx: Tx, userId: string, now: Date): Promise<boolean> {
  const anonimizada = await tx
    .update(user)
    .set({ name: 'Paciente anonimizado', email: `anonimo-${userId}@anonimizado.invalid`, emailVerified: false, image: null, twoFactorEnabled: false, updatedAt: now })
    .where(and(eq(user.id, userId), eq(user.appRole, 'paciente')))
    .returning({ id: user.id });
  if (!anonimizada.length) return false;
  await tx.delete(verification).where(eq(verification.value, userId));
  await tx.delete(session).where(eq(session.userId, userId));
  await tx.delete(account).where(eq(account.userId, userId));
  await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
  return true;
}
