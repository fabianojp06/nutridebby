import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { listarCategorias, salvarConfiguracoes } from '@/modules/financeiro/configuracoes';
import { cancelarLancamento, criarLancamento } from '@/modules/financeiro/lancamentos';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { consultaDireta } from './agenda';
import { novoPaciente, type TenantDeTeste } from './pacientes';

/**
 * RNF-301 (Plano 20): o consultório "cheio" — 5.000 lançamentos no ano `ano`, num INSERT … SELECT generate_series só
 * (pela sessão da nutricionista: o gatilho e a auditoria de sempre), com 20 pacientes, as 12 categorias iniciais, 70% pagos
 * (nunca depois de hoje), 1 em 4 entradas com paciente e 5% cancelados. Saldo do caixa em 01/01 do ano.
 */
export async function cincoMilLancamentos(db: Db, T: TenantDeTeste, agora: Date, ano = 2026): Promise<{ pacientes: string[] }> {
  await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: `${ano}-01-01`, saldoInicial: '10.000,00', valorConsulta: '250,00' }, { db, agora });
  const cats = await listarCategorias(T.ctx, { db });
  const entradas = cats.filter((c) => c.tipo === 'entrada').map((c) => c.id);
  const saidas = cats.filter((c) => c.tipo === 'saida').map((c) => c.id);
  const pacientes: string[] = [];
  for (let i = 0; i < 20; i++) pacientes.push((await novoPaciente(db, T.ctx, { nome: `Paciente ${String(i + 1).padStart(2, '0')}` })).id);
  const hoje = hojeNoFuso(T.tenant.fuso, agora);
  const lista = (ids: string[]) => sql`string_to_array(${ids.join(',')}, ',')::uuid[]`;
  await withTenant(
    T.ctx,
    async (tx) => {
      await tx.execute(sql`
        insert into fin_lancamentos (tenant_id, tipo, categoria_id, valor_centavos, vencimento, pago_em, forma_pagamento, patient_id, criado_por)
        select ${T.tenantId}, x.tipo,
               case when x.tipo = 'entrada' then (${lista(entradas)})[1 + g % ${entradas.length}] else (${lista(saidas)})[1 + g % ${saidas.length}] end,
               1 + (g * 7919) % 500000, x.vencimento,
               case when g % 10 < 7 then least(x.vencimento, ${hoje}::date) end,
               case when g % 10 < 7 then 'pix' end,
               case when x.tipo = 'entrada' and g % 4 = 0 then (${lista(pacientes)})[1 + (g / 4) % ${pacientes.length}] end,
               ${T.nutriId}
        from generate_series(1, 5000) g,
             lateral (select case when g % 2 = 0 then 'entrada' else 'saida' end as tipo, make_date(${ano}, 1, 1) + (g % 365) as vencimento) x`);
      await tx.execute(sql`
        update fin_lancamentos set cancelado_em = now(), motivo_cancelamento = 'Teste de carga'
        where id in (select id from fin_lancamentos where tenant_id = ${T.tenantId} order by id limit 250)`);
    },
    db,
  );
  return { pacientes };
}

/**
 * US-307 (Plano 20, T9): as cobranças de um paciente ativo para a exportação e a LGPD, pela sessão da nutricionista (o
 * gatilho e a auditoria de sempre) — a da consulta (padrão: 10/09/2026, 10h em São Paulo; outro horário para um segundo
 * paciente do mesmo consultório, que a agenda não aceita consultas sobrepostas), recebida por Pix em 10/09; uma
 * cancelada; e uma em aberto, vencida em 20/09. Configura o Financeiro do consultório (saldo em 01/01/2026). `agora` é o
 * relógio do módulo (as datas do recebimento não podem passar de hoje).
 */
export async function cobrancasDoPaciente(
  db: Db,
  T: TenantDeTeste,
  patientId: string,
  agora: Date,
  consultaInicio = new Date('2026-09-10T13:00:00Z'),
): Promise<{ recebida: string; cancelada: string; aberta: string; consultaInicio: Date }> {
  const deps = { db, agora };
  await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-01-01', saldoInicial: '0,00', valorConsulta: '250,00' }, deps);
  const consultas = (await listarCategorias(T.ctx, deps)).find((c) => c.chave === 'consultas')!.id;
  const consulta = await consultaDireta(db, T.ctx, patientId, consultaInicio);
  const [recebida] = await withTenant(
    T.ctx,
    (tx) =>
      tx
        .insert(schema.finLancamentos)
        .values({
          tenantId: T.tenantId, tipo: 'entrada', categoriaId: consultas, valorCentavos: 25_000, vencimento: '2026-09-10', pagoEm: '2026-09-10',
          formaPagamento: 'pix', descricao: 'Consulta de retorno', patientId, appointmentId: consulta, criadoPor: T.nutriId,
        })
        .returning({ id: schema.finLancamentos.id }),
    db,
  );
  const lancar = (vencimento: string, descricao: string) =>
    criarLancamento(T.ctx, T.tenant, { tipo: 'entrada', valor: '180,00', categoriaId: consultas, vencimento, pacienteId: patientId, descricao }, deps);
  const cancelada = await lancar('2026-09-15', 'Cobrança em dobro');
  await cancelarLancamento(T.ctx, cancelada.id, 'Lançada duas vezes', deps);
  const aberta = await lancar('2026-09-20', 'Pacote mensal');
  return { recebida: recebida.id, cancelada: cancelada.id, aberta: aberta.id, consultaInicio };
}

/**
 * RNF-301: um `Db` cujo `pg.Pool` conta as consultas. O Drizzle abre a transação num cliente do `connect()` (BEGIN, …,
 * COMMIT) e manda o resto pelo `query` do pool: os dois caminhos são embrulhados.
 */
export function dbQueContaConsultas(connectionString: string): { db: Db; pool: Pool; consultas: string[] } {
  const pool = new Pool({ connectionString, max: 2 });
  const consultas: string[] = [];
  const texto = (cfg: unknown) => (typeof cfg === 'string' ? cfg : ((cfg as { text?: string } | null)?.text ?? ''));
  const consultarNoPool = pool.query.bind(pool) as (cfg: unknown, valores?: unknown) => Promise<unknown>;
  pool.query = ((cfg: unknown, valores?: unknown) => {
    consultas.push(texto(cfg));
    return consultarNoPool(cfg, valores);
  }) as unknown as Pool['query'];
  const conectar = pool.connect.bind(pool) as () => Promise<PoolClient>;
  const embrulhados = new WeakSet<PoolClient>();
  pool.connect = (async () => {
    const c = await conectar();
    if (!embrulhados.has(c)) {
      embrulhados.add(c);
      const consultar = c.query.bind(c) as (cfg: unknown, valores?: unknown) => Promise<unknown>;
      c.query = ((cfg: unknown, valores?: unknown) => {
        consultas.push(texto(cfg));
        return consultar(cfg, valores);
      }) as unknown as PoolClient['query'];
    }
    return c;
  }) as unknown as Pool['connect'];
  return { db: drizzle({ client: pool, schema }) as unknown as Db, pool, consultas };
}
