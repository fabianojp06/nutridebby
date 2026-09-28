import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb, type Db, type Queryable } from '@/db/client';
import { account, invites, user } from '@/db/schema';
import { randomToken, sha256 } from '@/lib/crypto';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { commonPasswords, hashPassword } from '@/lib/password.server';
import { registrarAceiteDpa } from './dpa';

export const CONVITE_NUTRI_VALIDADE_MS = 72 * 60 * 60 * 1000; // US-001: 72 h
export const CONVITE_EXPIRADO = 'Convite expirado. Peça um novo ao suporte.';
export const CONVITE_INVALIDO =
  'Convite inválido ou já usado. Se você já definiu sua senha, entre com seu e-mail e senha.';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type EstadoConvite =
  | { estado: 'valido'; userId: string; email: string; nome: string }
  | { estado: 'expirado' }
  | { estado: 'invalido' };

/** Cria um convite e invalida os anteriores ainda não usados do mesmo usuário. Devolve o token em claro (só para o e-mail). */
export async function criarConvite(q: Queryable, userId: string, now: Date = new Date()): Promise<{ token: string; expiraEm: Date }> {
  const token = randomToken();
  const expiraEm = new Date(now.getTime() + CONVITE_NUTRI_VALIDADE_MS);
  await q.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.usadoEm)));
  await q.insert(invites).values({ userId, tipo: 'nutri', tokenHash: sha256(token), expiraEm, createdAt: now });
  return { token, expiraEm };
}

export function linkDoConvite(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/convite/${token}`;
}

export async function inspecionarConvite(q: Queryable, token: string, now: Date = new Date()): Promise<EstadoConvite> {
  if (!TOKEN.test(token)) return { estado: 'invalido' };
  const [c] = await q
    .select({ userId: invites.userId, expiraEm: invites.expiraEm, usadoEm: invites.usadoEm, email: user.email, nome: user.name })
    .from(invites)
    .innerJoin(user, eq(user.id, invites.userId))
    .where(eq(invites.tokenHash, sha256(token)));
  if (!c || c.usadoEm) return { estado: 'invalido' };
  if (c.expiraEm.getTime() <= now.getTime()) return { estado: 'expirado' };
  return { estado: 'valido', userId: c.userId, email: c.email, nome: c.nome };
}

export class ConviteError extends Error {
  override name = 'ConviteError';
}

/**
 * US-002: consome o convite (uma única vez, mesmo com envios simultâneos), grava a senha,
 * marca o e-mail como verificado e registra o aceite do DPA — tudo numa transação.
 */
export async function aceitarConvite(
  input: { token: string; senha: string; confirmacao: string; aceitouDpa: boolean; ip: string | null },
  deps: { db?: Db; now?: Date } = {},
): Promise<{ email: string }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!input.aceitouDpa) throw new ConviteError('Para continuar, aceite o contrato de tratamento de dados (DPA).');
  const politica = validatePasswordPolicy(input.senha, commonPasswords());
  if (politica) throw new ConviteError(politica);
  if (input.senha !== input.confirmacao) throw new ConviteError('As senhas não conferem.');
  if (!TOKEN.test(input.token)) throw new ConviteError(CONVITE_INVALIDO);
  const hash = await hashPassword(input.senha);

  return db.transaction(async (tx) => {
    // UPDATE … WHERE usado_em IS NULL trava a linha: o segundo envio simultâneo vê 0 linhas
    const [c] = await tx
      .update(invites)
      .set({ usadoEm: now })
      .where(and(eq(invites.tokenHash, sha256(input.token)), isNull(invites.usadoEm), gt(invites.expiraEm, now)))
      .returning({ userId: invites.userId });
    if (!c) {
      const estado = await inspecionarConvite(tx, input.token, now);
      throw new ConviteError(estado.estado === 'expirado' ? CONVITE_EXPIRADO : CONVITE_INVALIDO);
    }
    const [u] = await tx.select({ email: user.email, tenantId: user.tenantId }).from(user).where(eq(user.id, c.userId));
    const jaTemSenha = await tx
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, c.userId), eq(account.providerId, 'credential')));
    if (!u?.tenantId || jaTemSenha.length) throw new ConviteError(CONVITE_INVALIDO);
    await tx.insert(account).values({ id: randomUUID(), userId: c.userId, accountId: c.userId, providerId: 'credential', password: hash });
    await tx.update(user).set({ emailVerified: true }).where(eq(user.id, c.userId));
    await registrarAceiteDpa(tx, { userId: c.userId, tenantId: u.tenantId, ip: input.ip, now });
    return { email: u.email };
  });
}
