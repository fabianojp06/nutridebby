import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { appointments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { TenantAgenda } from '@/modules/agenda/consultas';
import { paraInstante } from '@/modules/agenda/fuso';
import type { TenantDeTeste } from './pacientes';

export const SP = 'America/Sao_Paulo';
export const em = (data: string, hora: string, fuso = SP) => paraInstante(data, hora, fuso)!;

/** Dados do tenant que a agenda lê (os mesmos padrões da tabela `tenants`). */
export const tenantAgenda = (T: TenantDeTeste, extra: Partial<TenantAgenda> = {}): TenantAgenda => ({
  id: T.tenantId,
  fuso: SP,
  nomeExibicao: T.tenant.nomeExibicao,
  linkOnlinePadrao: null,
  enderecoConsultorio: 'Rua das Flores, 10',
  antecedenciaMinH: 12,
  cancelamentoMinH: 24,
  status: 'ativa',
  agendamentoPublicoAtivo: true,
  ...extra,
});

/** Atende todos os dias, 08:00–20:00, consultas de 60 min, presencial ou online. */
export async function semanaToda(db: Db, ctx: TenantContext, extra: { duracaoMin?: number; modalidade?: string } = {}) {
  await withTenant(ctx, (tx) =>
    tx.execute(sql`insert into availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade)
      select ${ctx.tenantId}, d, '08:00', '20:00', ${extra.duracaoMin ?? 60}, ${extra.modalidade ?? 'ambas'} from generate_series(0, 6) d`), db);
}

/** Consulta gravada direto (sem regra, sem lembrete): para preparar cenários. */
export async function consultaDireta(db: Db, ctx: TenantContext, patientId: string, inicio: Date, minutos = 60, extra: Partial<typeof appointments.$inferInsert> = {}): Promise<string> {
  const [c] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(appointments)
        .values({ tenantId: ctx.tenantId, patientId, inicio, fim: new Date(inicio.getTime() + minutos * 60_000), modalidade: 'presencial', origem: 'nutri', ...extra })
        .returning({ id: appointments.id }),
    db,
  );
  return c.id;
}
