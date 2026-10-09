import { and, eq, lt } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { accessEvents } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { pacienteDaSessao } from './sessao';

/** D13: 13 meses de série do CS-02 + folga. */
export const RETENCAO_ACESSOS_DIAS = 400;

/** CS-02: 1 linha por paciente por dia (fuso do tenant). Devolve se foi a primeira do dia. */
export async function registrarAcesso(ctx: TenantContext, fuso: string, o: { db?: Db; agora?: Date } = {}): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'registrarAcesso');
  const dia = partesNoFuso(o.agora ?? new Date(), fuso).data;
  const r = await withTenant(
    ctx,
    (tx) => tx.insert(accessEvents).values({ tenantId: ctx.tenantId, patientId, dia }).onConflictDoNothing().returning({ id: accessEvents.id }),
    o.db ?? getDb(),
  );
  return r.length > 0;
}

/**
 * Plano 16 (G-D17 = a, R7): o paciente já abria o app antes de hoje? Decide só o texto do aviso de Hoje (boas-vindas ou
 * "O app mudou…"). Pela RLS do paciente (só as próprias linhas); `access_events` é registro de uso, sem `auditRead`
 * (AUDIT_EXCEPTIONS). `hoje` no fuso do tenant, como o `dia` gravado por `registrarAcesso`.
 */
export async function jaUsavaOApp(ctx: TenantContext, hoje: string, db: Db = getDb()): Promise<boolean> {
  const patientId = pacienteDaSessao(ctx, 'jaUsavaOApp');
  const r = await withTenant(
    ctx,
    (tx) => tx.select({ id: accessEvents.id }).from(accessEvents).where(and(eq(accessEvents.patientId, patientId), lt(accessEvents.dia, hoje))).limit(1),
    db,
  );
  return r.length > 0;
}

/** RNF-08 / D13: dado de uso, não obrigatório — sai na exclusão (pedido atendido) e na anonimização. */
export async function apagarAcessosDoTitular(tx: Tx, patientId: string): Promise<void> {
  await tx.delete(accessEvents).where(eq(accessEvents.patientId, patientId));
}

/** Job `agenda-limpeza`: tenant a tenant (RLS forçada), no fuso de cada um; fica o dia de 400 dias atrás. */
export async function limparAcessosAntigos(db: Db, agora: Date): Promise<number> {
  let n = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const corte = somarDias(hojeNoFuso(t.fuso, agora), -RETENCAO_ACESSOS_DIAS);
    const r = await withTenant(
      { tenantId: t.id, role: 'worker' },
      (tx) => tx.delete(accessEvents).where(lt(accessEvents.dia, corte)).returning({ id: accessEvents.id }),
      db,
    );
    n += r.length;
  }
  return n;
}
