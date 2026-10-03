import { getDb, type Db } from '@/db/client';
import { accessEvents } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { pacienteDaSessao } from './sessao';

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
