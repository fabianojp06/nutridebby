import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import { patients, tenants, user, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { EMAIL_FINALIDADE } from '@/email/queue';
import type { EmailJobData, EmailMessage } from '@/email/types';
import { getBoss } from '@/jobs/boss';
import { openSecret } from '@/lib/crypto';

export type TenantDeTeste = {
  tenantId: string;
  nutriId: string;
  ctx: TenantContext;
  tenant: { fuso: string; nomeExibicao: string };
};

/** Tenant + usuária nutricionista (o "Histórico de acessos" mostra o nome dela) e o ctx com ator e IP. */
export async function novoTenant(db: Db, nome = 'Debby Silva'): Promise<TenantDeTeste> {
  const [t] = await db.insert(tenants).values({ slug: `pc-${randomUUID().slice(0, 8)}`, nomeExibicao: nome }).returning();
  const nutriId = randomUUID();
  await db.insert(user).values({ id: nutriId, name: nome, email: `nutri-${nutriId.slice(0, 8)}@teste.dev`, appRole: 'nutri', tenantId: t.id });
  return {
    tenantId: t.id,
    nutriId,
    ctx: { tenantId: t.id, role: 'nutri', actorUserId: nutriId, ip: '203.0.113.20' },
    tenant: { fuso: t.fuso, nomeExibicao: t.nomeExibicao },
  };
}

/** Paciente gravado direto (sem convite nem validação), com os campos obrigatórios preenchidos. */
export async function novoPaciente(db: Db, ctx: TenantContext, extra: Partial<typeof patients.$inferInsert> = {}): Promise<PatientRow> {
  const [p] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(patients)
        .values({ tenantId: ctx.tenantId, nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email: `ana-${randomUUID().slice(0, 8)}@ex.com`, ...extra })
        .returning(),
    db,
  );
  return p;
}

/**
 * E-mails na fila (decifrados) de um tipo para um destinatário, na ordem em que foram enfileirados (o `findJobs` do
 * pg-boss não ordena). Quem usa precisa de stopBoss() + closeDb() no afterAll.
 */
export async function emailsNaFila<T extends EmailMessage['tipo']>(tipo: T, para: string): Promise<Extract<EmailMessage, { tipo: T }>[]> {
  const jobs = await (await getBoss()).findJobs<EmailJobData>('email');
  return jobs
    .sort((a, b) => a.createdOn.getTime() - b.createdOn.getTime())
    .map((j) => JSON.parse(openSecret(j.data.selado, EMAIL_FINALIDADE)) as EmailMessage)
    .filter((m): m is Extract<EmailMessage, { tipo: T }> => m.tipo === tipo && m.para === para);
}

/** N7 (Plano 08): sessão de paciente sempre com ator — a conta não precisa existir em `user` (audit_log sem FK). */
export const ctxPaciente = (tenantId: string, patientId: string, actorUserId: string = randomUUID()): TenantContext => ({
  tenantId,
  role: 'paciente',
  patientId,
  actorUserId,
});
