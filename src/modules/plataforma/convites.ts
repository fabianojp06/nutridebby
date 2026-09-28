import { and, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '@/db/client';
import { invites, user } from '@/db/schema';
import { randomToken, sha256 } from '@/lib/crypto';

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
