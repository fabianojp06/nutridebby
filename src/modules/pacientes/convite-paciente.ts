import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { invites, user, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { randomToken, sha256 } from '@/lib/crypto';
import { carregarPacienteParaEscrita } from './base';

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
  return `${appUrl.replace(/\/$/, '')}/convite/paciente/${token}`;
}

/**
 * Convite novo de 7 dias + e-mail na mesma transação. O pendente anterior do paciente some antes
 * (um por paciente: `invites_paciente_pendente_idx`). Quem já tem conta de paciente (outro tenant)
 * recebe o texto de "entre com sua conta existente". Chamar dentro de withTenant, com o paciente lido
 * (e travado, quando não é recém-criado).
 */
export async function enviarConvitePaciente(
  tx: Tx,
  p: Pick<PatientRow, 'id' | 'tenantId' | 'nome' | 'email'>,
  deps: { appUrl: string; nutri: string; now: Date },
): Promise<{ expiraEm: Date }> {
  const token = randomToken();
  const expiraEm = new Date(deps.now.getTime() + CONVITE_PACIENTE_VALIDADE_MS);
  await tx.delete(invites).where(and(eq(invites.patientId, p.id), isNull(invites.usadoEm)));
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
