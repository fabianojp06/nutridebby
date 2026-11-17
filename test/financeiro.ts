import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { listarCategorias, salvarConfiguracoes } from '@/modules/financeiro/configuracoes';
import { hojeNoFuso } from '@/modules/pacientes/datas';
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
