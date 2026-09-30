import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb, type Db, type Queryable } from '@/db/client';
import { account, invites, user } from '@/db/schema';
import { randomToken, sha256 } from '@/lib/crypto';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { commonPasswords, hashPassword } from '@/lib/password.server';
import { DPA_NAO_ACEITO, registrarAceiteDpa } from './dpa';

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
    .select({ userId: user.id, expiraEm: invites.expiraEm, usadoEm: invites.usadoEm, email: user.email, nome: user.name })
    .from(invites)
    .innerJoin(user, eq(user.id, invites.userId))
    .where(and(eq(invites.tokenHash, sha256(token)), eq(invites.tipo, 'nutri')));
  if (!c || c.usadoEm) return { estado: 'invalido' };
  if (c.expiraEm.getTime() <= now.getTime()) return { estado: 'expirado' };
  return { estado: 'valido', userId: c.userId, email: c.email, nome: c.nome };
}

export class ConviteError extends Error {
  override name = 'ConviteError';
  constructor(
    message: string,
    /** Campo do formulário a marcar como inválido (a11y); ausente para erros gerais do convite. */
    readonly campo?: 'senha' | 'confirmacao' | 'dpa',
  ) {
    super(message);
  }
}

/**
 * US-002: consome o convite (uma única vez, mesmo com envios simultâneos), grava a senha,
 * marca o e-mail como verificado e registra o aceite do DPA — tudo numa transação.
 *
 * T6-R1: dentro da transação, trava sempre o usuário (`SELECT … FOR UPDATE`) antes do convite —
 * a mesma ordem de `reenviarConvite` (contas.ts). A ordem invertida (convite → usuário) permitia
 * deadlock (40P01) entre as duas funções quando intercaladas.
 */
export async function aceitarConvite(
  input: { token: string; senha: string; confirmacao: string; aceitouDpa: boolean; ip: string | null },
  deps: { db?: Db; now?: Date } = {},
): Promise<{ email: string }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!input.aceitouDpa) throw new ConviteError(DPA_NAO_ACEITO, 'dpa');
  const politica = validatePasswordPolicy(input.senha, commonPasswords());
  if (politica) throw new ConviteError(politica, 'senha');
  if (input.senha !== input.confirmacao) throw new ConviteError('As senhas não conferem.', 'confirmacao');
  if (!TOKEN.test(input.token)) throw new ConviteError(CONVITE_INVALIDO);

  // T6-R2a: checagem barata (sem lock) antes do argon2 (~19 MB por chamada, VPS compartilhada):
  // um POST anônimo com token bem formado mas inválido/expirado nunca chega a hashear a senha.
  // A garantia final continua sendo o UPDATE atômico dentro da transação, abaixo.
  const antes = await inspecionarConvite(db, input.token, now);
  if (antes.estado !== 'valido') {
    throw new ConviteError(antes.estado === 'expirado' ? CONVITE_EXPIRADO : CONVITE_INVALIDO);
  }
  const hash = await hashPassword(input.senha);

  return db.transaction(async (tx) => {
    const [u] = await tx
      .select({ email: user.email, tenantId: user.tenantId })
      .from(user)
      .where(eq(user.id, antes.userId))
      .for('update');
    if (!u?.tenantId) throw new ConviteError(CONVITE_INVALIDO);
    const jaTemSenha = await tx
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, antes.userId), eq(account.providerId, 'credential')));
    if (jaTemSenha.length) throw new ConviteError(CONVITE_INVALIDO);
    // UPDATE … WHERE usado_em IS NULL trava a linha: o segundo envio simultâneo vê 0 linhas
    const [c] = await tx
      .update(invites)
      .set({ usadoEm: now })
      .where(and(eq(invites.tokenHash, sha256(input.token)), eq(invites.tipo, 'nutri'), isNull(invites.usadoEm), gt(invites.expiraEm, now)))
      .returning({ id: invites.id });
    if (!c) {
      const estado = await inspecionarConvite(tx, input.token, now);
      throw new ConviteError(estado.estado === 'expirado' ? CONVITE_EXPIRADO : CONVITE_INVALIDO);
    }
    await tx.insert(account).values({ id: randomUUID(), userId: antes.userId, accountId: antes.userId, providerId: 'credential', password: hash });
    await tx.update(user).set({ emailVerified: true }).where(eq(user.id, antes.userId));
    await registrarAceiteDpa(tx, { userId: antes.userId, tenantId: u.tenantId, ip: input.ip, now });
    return { email: u.email };
  });
}
