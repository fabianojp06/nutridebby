import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { getDb, type Db, type Queryable } from '@/db/client';
import { account, consents, invites, tenants, user } from '@/db/schema';
import { randomToken, sha256 } from '@/lib/crypto';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { commonPasswords, hashPassword } from '@/lib/password.server';
import { DPA_NAO_ACEITO, registrarAceiteDpa } from './dpa';
import { urlDoApp } from '@/lib/url-do-app';
import { MSG_EQUIPE } from './equipe-textos';
import { SIGILO_EQUIPE_TERMO } from './textos-versionados';

export const CONVITE_NUTRI_VALIDADE_MS = 72 * 60 * 60 * 1000; // US-001: 72 h
export const CONVITE_EXPIRADO = 'Convite expirado. Peça um novo ao suporte.';
export const CONVITE_INVALIDO =
  'Convite inválido ou já usado. Se você já definiu sua senha, entre com seu e-mail e senha.';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Plano 26 (RN-499, RN-500): o convite da nutricionista (US-001) ou o da recepção de um consultório. */
export type TipoDoConvite = 'nutri' | 'recepcao';
const TIPOS_DESTA_PAGINA: TipoDoConvite[] = ['nutri', 'recepcao'];

export type EstadoConvite =
  /** `tipo` decide o formulário (DPA × termo de confidencialidade); `consultorio`: o nome de exibição (o da recepção). */
  | { estado: 'valido'; userId: string; email: string; nome: string; tipo: TipoDoConvite; consultorio: string | null }
  | { estado: 'expirado' }
  | { estado: 'invalido' };

/**
 * Cria um convite e invalida os anteriores ainda não usados do mesmo usuário. Devolve o token em claro (só para o e-mail).
 * Plano 26 (RN-499): `recepcao` leva o consultório (CHECK `invites_alvo`) e vale as mesmas 72 h.
 */
export async function criarConvite(
  q: Queryable,
  userId: string,
  now: Date = new Date(),
  alvo: { tipo: 'nutri' } | { tipo: 'recepcao'; tenantId: string } = { tipo: 'nutri' },
): Promise<{ token: string; expiraEm: Date }> {
  const token = randomToken();
  const expiraEm = new Date(now.getTime() + CONVITE_NUTRI_VALIDADE_MS);
  await q.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.usadoEm)));
  const tenantId = alvo.tipo === 'recepcao' ? alvo.tenantId : undefined;
  await q.insert(invites).values({ userId, tipo: alvo.tipo, tenantId, tokenHash: sha256(token), expiraEm, createdAt: now });
  return { token, expiraEm };
}

export function linkDoConvite(appUrl: string, token: string): string {
  return urlDoApp(appUrl, `/convite/${token}`);
}

export async function inspecionarConvite(q: Queryable, token: string, now: Date = new Date()): Promise<EstadoConvite> {
  if (!TOKEN.test(token)) return { estado: 'invalido' };
  const [c] = await q
    .select({
      userId: user.id, expiraEm: invites.expiraEm, usadoEm: invites.usadoEm, email: user.email, nome: user.name, tipo: invites.tipo,
      conviteTenantId: invites.tenantId, papel: user.appRole, tenantId: user.tenantId, consultorio: tenants.nomeExibicao,
    })
    .from(invites)
    .innerJoin(user, eq(user.id, invites.userId))
    .leftJoin(tenants, eq(tenants.id, user.tenantId))
    .where(and(eq(invites.tokenHash, sha256(token)), inArray(invites.tipo, TIPOS_DESTA_PAGINA)));
  if (!c || c.usadoEm) return { estado: 'invalido' };
  // Plano 26: o convite da recepção só vale para a conta `recepcao` do mesmo consultório do convite
  const tipo = c.tipo as TipoDoConvite;
  if (tipo === 'recepcao' && (c.papel !== 'recepcao' || !c.tenantId || c.conviteTenantId !== c.tenantId)) return { estado: 'invalido' };
  if (c.expiraEm.getTime() <= now.getTime()) return { estado: 'expirado' };
  return { estado: 'valido', userId: c.userId, email: c.email, nome: c.nome, tipo, consultorio: c.consultorio };
}

export class ConviteError extends Error {
  override name = 'ConviteError';
  constructor(
    message: string,
    /** Campo do formulário a marcar como inválido (a11y); ausente para erros gerais do convite. */
    readonly campo?: 'senha' | 'confirmacao' | 'dpa' | 'sigilo',
  ) {
    super(message);
  }
}

/**
 * US-002: consome o convite (uma única vez, mesmo com envios simultâneos), grava a senha,
 * marca o e-mail como verificado e registra o aceite do DPA — tudo numa transação.
 * Plano 26 (RN-500, US-489): o convite da recepção pede o aceite do Termo de confidencialidade da equipe (`aceitouSigilo`)
 * e grava `sigilo-equipe-<versão>` em `consents`, com a conta, o consultório e o IP — nunca o DPA (quem aceita o DPA é a
 * controladora). O tipo vem do convite no banco, nunca do formulário.
 *
 * T6-R1: dentro da transação, trava sempre o usuário (`SELECT … FOR UPDATE`) antes do convite —
 * a mesma ordem de `reenviarConvite` (contas.ts). A ordem invertida (convite → usuário) permitia
 * deadlock (40P01) entre as duas funções quando intercaladas.
 */
export async function aceitarConvite(
  input: { token: string; senha: string; confirmacao: string; aceitouDpa: boolean; aceitouSigilo?: boolean; ip: string | null },
  deps: { db?: Db; now?: Date } = {},
): Promise<{ email: string }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  // T6-R2a: checagem barata (sem lock) antes do argon2 (~19 MB por chamada, VPS compartilhada):
  // um POST anônimo com token bem formado mas inválido/expirado nunca chega a hashear a senha.
  // A garantia final continua sendo o UPDATE atômico dentro da transação, abaixo.
  // Plano 26: lida antes da caixa de aceite — o tipo do convite decide qual aceite é obrigatório.
  // Convite inválido ou vencido responde isso antes de qualquer caixa: o texto a aceitar depende de um convite que vale.
  const antes = TOKEN.test(input.token) ? await inspecionarConvite(db, input.token, now) : ({ estado: 'invalido' } as const);
  if (antes.estado !== 'valido') {
    throw new ConviteError(antes.estado === 'expirado' ? CONVITE_EXPIRADO : CONVITE_INVALIDO);
  }
  if (antes.tipo === 'recepcao' && !input.aceitouSigilo) throw new ConviteError(MSG_EQUIPE.convite.termoNaoAceito, 'sigilo');
  if (antes.tipo !== 'recepcao' && !input.aceitouDpa) throw new ConviteError(DPA_NAO_ACEITO, 'dpa');
  const politica = validatePasswordPolicy(input.senha, commonPasswords());
  if (politica) throw new ConviteError(politica, 'senha');
  if (input.senha !== input.confirmacao) throw new ConviteError('As senhas não conferem.', 'confirmacao');
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
      .where(and(eq(invites.tokenHash, sha256(input.token)), eq(invites.tipo, antes.tipo), isNull(invites.usadoEm), gt(invites.expiraEm, now)))
      .returning({ id: invites.id });
    if (!c) {
      const estado = await inspecionarConvite(tx, input.token, now);
      throw new ConviteError(estado.estado === 'expirado' ? CONVITE_EXPIRADO : CONVITE_INVALIDO);
    }
    await tx.insert(account).values({ id: randomUUID(), userId: antes.userId, accountId: antes.userId, providerId: 'credential', password: hash });
    await tx.update(user).set({ emailVerified: true }).where(eq(user.id, antes.userId));
    if (antes.tipo === 'recepcao') {
      // RN-500: o termo de confidencialidade da equipe, com o consultório e o IP; o DPA do consultório não muda
      await tx.insert(consents).values({ userId: antes.userId, tenantId: u.tenantId, termoVersao: SIGILO_EQUIPE_TERMO, aceitoEm: now, ip: input.ip }).onConflictDoNothing();
    } else {
      await registrarAceiteDpa(tx, { userId: antes.userId, tenantId: u.tenantId, ip: input.ip, now });
    }
    return { email: u.email };
  });
}
