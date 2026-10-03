import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { account, consents, invites, notifications, patients, user, type NotificationRow, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { randomToken, sha256 } from '@/lib/crypto';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { commonPasswords, hashPassword } from '@/lib/password.server';
import { normalizeEmail } from '@/lib/text';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { carregarPacienteParaEscrita, idValido } from './base';
import { MSG_TERMO_NAO_ACEITO, TERMO_PACIENTE } from './termo-paciente';
import { urlDoApp } from '@/lib/url-do-app';

export const CONVITE_PACIENTE_VALIDADE_MS = 7 * 24 * 60 * 60 * 1000; // US-010: 7 dias

export const MSG_CONVITE_PACIENTE = {
  expirado: 'Convite expirado. Peça um novo à sua nutricionista.',
  invalido: 'Convite inválido ou já usado. Se você já criou sua senha, entre com seu e-mail e senha.',
  jaAtivo: 'O paciente já ativou o acesso ao portal.',
  inativo: 'Paciente arquivado ou bloqueado não recebe convite.',
  outraConta: 'Este convite foi enviado para outro e-mail. Saia desta conta e abra o link de novo.',
  contaDeEquipe: 'Este e-mail já é usado por outra conta. Peça à sua nutricionista para cadastrar outro e-mail.',
  indisponivel: 'Conta temporariamente indisponível',
} as const;

export class ConvitePacienteError extends Error {
  override name = 'ConvitePacienteError';
  constructor(
    message: string,
    /** Campo do formulário a marcar como inválido (a11y); ausente para erros do próprio convite. */
    readonly campo?: 'senha' | 'confirmacao' | 'termo',
  ) {
    super(message);
  }
}

export function linkDoConvitePaciente(appUrl: string, token: string): string {
  return urlDoApp(appUrl, `/convite/paciente/${token}`);
}

/**
 * Convite novo de 7 dias + e-mail na mesma transação. O pendente anterior do paciente some antes
 * (um por paciente: `invites_paciente_pendente_idx`). Quem já tem conta de paciente (outro tenant)
 * recebe o texto de "entre com sua conta existente". Chamar dentro de withTenant, com o paciente lido
 * (e travado, quando não é recém-criado). O link (credencial) vai só no e-mail: o convite por WhatsApp
 * é um aviso sem link (US-010, decisão do dono na rodada 1 da T14).
 */
export async function enviarConvitePaciente(
  tx: Tx,
  p: Pick<PatientRow, 'id' | 'tenantId' | 'nome' | 'email'>,
  deps: { appUrl: string; nutri: string; now: Date },
): Promise<{ expiraEm: Date }> {
  const token = randomToken();
  const expiraEm = new Date(deps.now.getTime() + CONVITE_PACIENTE_VALIDADE_MS);
  await apagarConvitesPendentes(tx, p.tenantId, p.id); // CLAUDE.md regra 1: filtra tipo e tenant
  await tx.insert(invites).values({ tipo: 'paciente', tenantId: p.tenantId, patientId: p.id, tokenHash: sha256(token), expiraEm, createdAt: deps.now });
  const [conta] = await tx.select({ papel: user.appRole }).from(user).where(eq(user.email, p.email));
  await enqueueEmail(
    {
      tipo: 'convite_paciente',
      para: p.email,
      nome: p.nome,
      nutri: deps.nutri,
      link: linkDoConvitePaciente(deps.appUrl, token),
      contaExistente: conta?.papel === 'paciente',
    },
    { tenantId: p.tenantId, tx },
  );
  return { expiraEm };
}

/** RN-08 / US-018: arquivar ou bloquear o paciente invalida o convite ainda não usado. */
export async function apagarConvitesPendentes(tx: Tx, tenantId: string, patientId: string): Promise<void> {
  await tx.delete(invites).where(and(eq(invites.tipo, 'paciente'), eq(invites.tenantId, tenantId), eq(invites.patientId, patientId), isNull(invites.usadoEm)));
}

export type SituacaoAcesso = { estado: 'ativo' } | { estado: 'pendente'; expiraEm: Date } | { estado: 'expirado' } | { estado: 'sem_convite' };

/** Situação do acesso ao portal para o prontuário. `invites` não tem RLS: o filtro por tenant é explícito. */
export async function situacaoDoAcesso(
  ctx: TenantContext,
  p: Pick<PatientRow, 'id' | 'userId'>,
  db: Db = getDb(),
  now: Date = new Date(),
): Promise<SituacaoAcesso> {
  if (p.userId) return { estado: 'ativo' };
  const [c] = await db
    .select({ expiraEm: invites.expiraEm })
    .from(invites)
    .where(and(eq(invites.tenantId, ctx.tenantId), eq(invites.patientId, p.id), eq(invites.tipo, 'paciente'), isNull(invites.usadoEm)))
    .orderBy(desc(invites.createdAt))
    .limit(1);
  if (!c) return { estado: 'sem_convite' };
  return c.expiraEm.getTime() <= now.getTime() ? { estado: 'expirado' } : { estado: 'pendente', expiraEm: c.expiraEm };
}

/** "Reenviar convite": o paciente fica travado (FOR UPDATE), então dois cliques seguidos não deixam dois convites. */
export async function reenviarConvitePaciente(
  ctx: TenantContext,
  tenant: { nomeExibicao: string },
  patientId: string,
  deps: { db?: Db; now?: Date; appUrl?: string } = {},
): Promise<{ expiraEm: Date }> {
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (p.userId) throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.jaAtivo);
      if (p.status !== 'ativo') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.inativo);
      return enviarConvitePaciente(tx, p, { appUrl: deps.appUrl ?? getEnv().APP_URL, nutri: tenant.nomeExibicao, now: deps.now ?? new Date() });
    },
    deps.db ?? getDb(),
  );
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type EstadoConvitePaciente =
  | {
      estado: 'valido';
      tenantId: string;
      patientId: string;
      nome: string;
      email: string;
      nutri: string;
      tenantSuspenso: boolean;
      temTelefone: boolean;
      /** Opt-in vigente (da nutricionista ou do paciente): a caixa do WhatsApp vem marcada. */
      whatsappMarcado: boolean;
      /** Conta com o e-mail do convite: nenhuma, de paciente (outro tenant) ou da equipe (nutri/admin). */
      conta: 'nenhuma' | 'paciente' | 'equipe';
    }
  | { estado: 'expirado' }
  | { estado: 'invalido' };

/** Lê o convite pelo token (sem sessão). O prontuário é lido no contexto do próprio paciente (RLS). */
export async function inspecionarConvitePaciente(db: Db, token: string, now: Date = new Date()): Promise<EstadoConvitePaciente> {
  if (!TOKEN.test(token)) return { estado: 'invalido' };
  const [c] = await db
    .select({ tenantId: invites.tenantId, patientId: invites.patientId, expiraEm: invites.expiraEm, usadoEm: invites.usadoEm })
    .from(invites)
    .where(and(eq(invites.tokenHash, sha256(token)), eq(invites.tipo, 'paciente')));
  if (!c?.tenantId || !c.patientId || c.usadoEm) return { estado: 'invalido' };
  if (c.expiraEm.getTime() <= now.getTime()) return { estado: 'expirado' };
  const { tenantId, patientId } = c;
  const tenant = await buscarTenant(db, tenantId);
  const [p] = await withTenant({ tenantId, role: 'paciente', patientId }, (tx) => tx.select().from(patients).where(eq(patients.id, patientId)), db);
  if (!tenant || !p || p.status !== 'ativo' || p.userId) return { estado: 'invalido' };
  const [u] = await db.select({ papel: user.appRole }).from(user).where(eq(user.email, p.email));
  return {
    estado: 'valido',
    tenantId,
    patientId,
    nome: p.nome,
    email: p.email,
    nutri: tenant.nomeExibicao,
    tenantSuspenso: tenant.status === 'suspensa',
    temTelefone: !!p.telefoneE164,
    whatsappMarcado: !!p.whatsappOptinEm && !p.whatsappOptoutEm,
    conta: !u ? 'nenhuma' : u.papel === 'paciente' ? 'paciente' : 'equipe',
  };
}

type Valido = Extract<EstadoConvitePaciente, { estado: 'valido' }>;

async function prepararAceite(db: Db, token: string, aceitouTermo: boolean, now: Date): Promise<Valido> {
  if (!aceitouTermo) throw new ConvitePacienteError(MSG_TERMO_NAO_ACEITO, 'termo');
  const e = await inspecionarConvitePaciente(db, token, now);
  if (e.estado === 'expirado') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.expirado);
  if (e.estado !== 'valido') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.invalido);
  if (e.tenantSuspenso) throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.indisponivel); // RN-15
  if (e.conta === 'equipe') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.contaDeEquipe); // §3: um papel por login
  return e;
}

/** UPDATE … WHERE usado_em IS NULL trava a linha: o segundo envio simultâneo vê 0 linhas. */
async function consumirConvite(tx: Tx, tenantId: string, token: string, now: Date): Promise<void> {
  const [c] = await tx
    .update(invites)
    .set({ usadoEm: now })
    .where(and(eq(invites.tokenHash, sha256(token)), eq(invites.tenantId, tenantId), eq(invites.tipo, 'paciente'), isNull(invites.usadoEm), gt(invites.expiraEm, now)))
    .returning({ id: invites.id });
  if (!c) throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.invalido);
}

async function travarPacienteDoConvite(tx: Tx, patientId: string): Promise<PatientRow> {
  const [p] = await tx.select().from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p || p.status !== 'ativo' || p.userId) throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.invalido);
  return p;
}

/** US-011: marcar = opt-in do próprio paciente; desmarcar o que estava autorizado = opt-out (INT-01). Também em "Perfil" (portal). */
export function escolhaWhatsapp(quer: boolean, p: PatientRow, now: Date) {
  if (!p.telefoneE164) return {};
  if (quer) return { whatsappOptinEm: now, whatsappOptinOrigem: 'paciente', whatsappOptoutEm: null };
  return p.whatsappOptinEm && !p.whatsappOptoutEm ? { whatsappOptoutEm: now } : {};
}

/** Uma prova de aceite por nutricionista (cada uma é controladora dos dados, RNF-08): (usuário, versão, tenant). */
async function registrarAceiteTermo(tx: Tx, userId: string, tenantId: string, ip: string | null, now: Date): Promise<void> {
  await tx.insert(consents).values({ userId, tenantId, termoVersao: TERMO_PACIENTE, aceitoEm: now, ip }).onConflictDoNothing();
}

/**
 * Conta nova (US-011 "Aceite do convite"): consome o convite, cria o login de paciente (sem tenant:
 * o vínculo é o prontuário), grava a senha, o termo e a escolha do WhatsApp — numa transação com o
 * ator = o próprio paciente (auditoria da alteração em `patients`).
 */
export async function aceitarConvitePaciente(
  input: { token: string; senha: string; confirmacao: string; aceitouTermo: boolean; whatsapp: boolean; ip: string | null },
  deps: { db?: Db; now?: Date } = {},
): Promise<{ email: string }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!input.aceitouTermo) throw new ConvitePacienteError(MSG_TERMO_NAO_ACEITO, 'termo');
  const politica = validatePasswordPolicy(input.senha, commonPasswords());
  if (politica) throw new ConvitePacienteError(politica, 'senha');
  if (input.senha !== input.confirmacao) throw new ConvitePacienteError('As senhas não conferem.', 'confirmacao');
  // T6-R2a do Plano 02: checagem barata antes do argon2 (~19 MB por chamada, VPS compartilhada)
  const e = await prepararAceite(db, input.token, true, now);
  if (e.conta !== 'nenhuma') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.invalido); // conta existente: vincularContaExistente
  const hash = await hashPassword(input.senha);
  const userId = randomUUID();
  try {
    return await withTenant(
      { tenantId: e.tenantId, role: 'paciente', patientId: e.patientId, actorUserId: userId, ip: input.ip },
      async (tx) => {
        // T6-R1 do Plano 02: sempre paciente → convite, a mesma ordem de reenviarConvitePaciente e de
        // atualizarPaciente (troca de e-mail). A ordem invertida permitia deadlock (40P01) entre elas.
        const p = await travarPacienteDoConvite(tx, e.patientId);
        await consumirConvite(tx, e.tenantId, input.token, now);
        await tx.insert(user).values({ id: userId, name: p.nome, email: p.email, emailVerified: true, appRole: 'paciente', createdAt: now, updatedAt: now });
        await tx.insert(account).values({ id: randomUUID(), userId, accountId: userId, providerId: 'credential', password: hash });
        await registrarAceiteTermo(tx, userId, e.tenantId, input.ip, now);
        await tx.update(patients).set({ userId, ...escolhaWhatsapp(input.whatsapp, p, now), updatedAt: now }).where(eq(patients.id, p.id));
        return { email: p.email };
      },
      db,
    );
  } catch (err) {
    // Conta criada com o mesmo e-mail entre a checagem e o INSERT (outra aba, outro convite)
    if (uniqueViolation(err) === 'user_email_unique') throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.invalido);
    throw err;
  }
}

/**
 * Quem já é paciente de outra nutricionista (US-010): entra com a conta existente e só confirma o termo
 * e o WhatsApp. O e-mail da conta precisa ser o do convite — outro login não "adota" o prontuário.
 */
export async function vincularContaExistente(
  input: { token: string; userId: string; aceitouTermo: boolean; whatsapp: boolean; ip: string | null },
  deps: { db?: Db; now?: Date } = {},
): Promise<void> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const e = await prepararAceite(db, input.token, input.aceitouTermo, now);
  const [u] = await db.select({ email: user.email, papel: user.appRole }).from(user).where(eq(user.id, input.userId));
  if (!u || u.papel !== 'paciente' || normalizeEmail(u.email) !== normalizeEmail(e.email)) {
    throw new ConvitePacienteError(MSG_CONVITE_PACIENTE.outraConta);
  }
  await withTenant(
    { tenantId: e.tenantId, role: 'paciente', patientId: e.patientId, actorUserId: input.userId, ip: input.ip },
    async (tx) => {
      const p = await travarPacienteDoConvite(tx, e.patientId); // paciente → convite (T6-R1)
      await consumirConvite(tx, e.tenantId, input.token, now);
      await registrarAceiteTermo(tx, input.userId, e.tenantId, input.ip, now);
      await tx.update(patients).set({ userId: input.userId, ...escolhaWhatsapp(input.whatsapp, p, now), updatedAt: now }).where(eq(patients.id, p.id));
    },
    db,
  );
}

export type SituacaoConviteWhatsapp = Pick<NotificationRow, 'status' | 'motivoIgnorada' | 'agendadaPara' | 'enviadaEm'>;

/**
 * Situação do último convite por WhatsApp, para a tela do paciente (US-010). Sem dado de saúde nem conteúdo: só
 * situação e horários (registro técnico de entrega, sem `auditRead`, como os lembretes da consulta — D10).
 */
export async function situacaoDoConviteWhatsapp(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<SituacaoConviteWhatsapp | null> {
  if (!idValido(patientId)) return null;
  const [n] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ status: notifications.status, motivoIgnorada: notifications.motivoIgnorada, agendadaPara: notifications.agendadaPara, enviadaEm: notifications.enviadaEm })
        .from(notifications)
        .where(and(eq(notifications.patientId, patientId), eq(notifications.tipo, 'convite_paciente'), eq(notifications.canal, 'whatsapp')))
        .orderBy(desc(notifications.createdAt))
        .limit(1),
    db,
  );
  return n ?? null;
}
