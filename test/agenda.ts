import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
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

/**
 * Corrida perdida no banco, sem depender do relógio: outra transação grava a consulta e segura o `commit`;
 * `acao` checa (não vê a linha ainda não confirmada), grava e fica presa no EXCLUDE; só então a outra confirma.
 * Devolve o erro de `acao` (ou null). `pools.owner` só lê `pg_stat_activity` para saber que a gravação ficou presa.
 */
export async function perdeCorridaNoBanco(pools: { app: Pool; owner: Pool }, T: TenantDeTeste, patientId: string, inicio: Date, acao: () => Promise<unknown>): Promise<unknown> {
  const outra = await pools.app.connect();
  let confirmada = false;
  try {
    await outra.query('begin');
    await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
    await outra.query(`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values ($1, $2, $3, $4, 'presencial', 'nutri')`, [
      T.tenantId, patientId, inicio, new Date(inicio.getTime() + 3_600_000),
    ]);
    const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
    const resultado = acao().then(
      () => null,
      (e: unknown) => e,
    );
    for (let i = 0; ; i++) {
      const presa = await pools.owner.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid]);
      if (presa.rowCount) break;
      if (i > 200) throw new Error('a gravação não ficou presa no EXCLUDE');
      await new Promise((r) => setTimeout(r, 10));
    }
    await outra.query('commit');
    confirmada = true;
    return await resultado;
  } finally {
    if (!confirmada) await outra.query('rollback').catch(() => undefined); // não devolve ao pool com transação aberta
    outra.release();
  }
}
