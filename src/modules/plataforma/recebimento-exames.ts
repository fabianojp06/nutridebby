import { eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';

/**
 * D18 = (a) (Plano 12): a nutricionista liga ou desliga o recebimento de exames enviados pelos pacientes pelo app. Nasce
 * desligado (como a página pública de agendamento). Ligar guarda a PRIMEIRA data; desligar só esconde o "Enviar exame" do
 * portal — os envios já recebidos continuam na fila. `tenants` não é auditada: a mudança fica no log (só ids), como a
 * ativação da IA (D21 do Plano 11).
 */
export async function definirRecebimentoDeExames(ctx: TenantContext, ligar: boolean, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  if (ctx.role !== 'nutri') throw new Error('definirRecebimentoDeExames: só a nutricionista');
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    (tx) =>
      tx
        .update(tenants)
        .set({ examesPacienteAtivadoEm: ligar ? sql`coalesce(${tenants.examesPacienteAtivadoEm}, ${agora.toISOString()}::timestamptz)` : null, updatedAt: agora })
        .where(eq(tenants.id, ctx.tenantId)),
    deps.db ?? getDb(),
  );
  logger.info({ tenantId: ctx.tenantId, actorUserId: ctx.actorUserId ?? null, ligado: ligar }, 'recebimento de exames pelo app');
}
