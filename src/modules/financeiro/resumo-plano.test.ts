import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { listarCategorias, salvarConfiguracoes } from './configuracoes';
import { criarLancamento } from './lancamentos';
import { entradasESaidas12Meses, fluxoDeCaixaDoAno, pagamentosPendentes, pendenciasDoPaciente, resumoDoMes } from './resumo';

/**
 * RNF-301 ("índices da §9"): toda consulta dos agregados a `fin_lancamentos` tem de chegar às linhas do consultório por um
 * índice com `tenant_id` na condição — nunca varrer a tabela de todos os consultórios. O custo de um Seq Scan depende do
 * tamanho da plataforma, não do consultório, e o banco de teste (poucos consultórios) não mostraria a regressão no tempo.
 *
 * Como confere: um `Db` cujo cliente da transação, antes de cada SELECT que lê `fin_lancamentos`, roda o `EXPLAIN` da
 * mesma consulta (mesmos parâmetros, mesma transação e mesmo contexto de RLS) com `enable_seqscan` desligado só para o
 * EXPLAIN. Desligado, o planejador só escolhe Seq Scan quando nenhum índice serve; e um índice usado sem `tenant_id` na
 * condição (varredura do índice inteiro) também reprova.
 */
type Plano = { 'Node Type': string; 'Relation Name'?: string; 'Index Name'?: string; 'Index Cond'?: string; Plans?: Plano[] };
type Explicado = { consulta: string; plano: Plano };

function dbQueExplica(): { db: Db; pool: Pool; explicados: Explicado[] } {
  const pool = new Pool({ connectionString: inject('appDatabaseUrl'), max: 2 });
  const explicados: Explicado[] = [];
  const conectar = pool.connect.bind(pool) as () => Promise<PoolClient>;
  const embrulhados = new WeakSet<PoolClient>();
  pool.connect = (async () => {
    const c = await conectar();
    if (!embrulhados.has(c)) {
      embrulhados.add(c);
      const consultar = c.query.bind(c) as (cfg: unknown, valores?: unknown) => Promise<{ rows: Record<string, unknown>[] }>;
      c.query = (async (cfg: unknown, valores?: unknown) => {
        const texto = typeof cfg === 'string' ? cfg : ((cfg as { text?: string } | null)?.text ?? '');
        // o Drizzle manda os parâmetros no segundo argumento (`query({ text, … }, params)`)
        const params = valores ?? (typeof cfg === 'string' ? undefined : (cfg as { values?: unknown[] }).values);
        if (/^\s*select\b/i.test(texto) && texto.includes('"fin_lancamentos"')) {
          await consultar(`select set_config('enable_seqscan', 'off', true)`);
          const r = await consultar({ text: `explain (format json) ${texto}`, values: params ?? [] });
          await consultar(`select set_config('enable_seqscan', 'on', true)`);
          explicados.push({ consulta: texto, plano: (r.rows[0]['QUERY PLAN'] as { Plan: Plano }[])[0].Plan });
        }
        return consultar(cfg, valores);
      }) as unknown as PoolClient['query'];
    }
    return c;
  }) as unknown as Pool['connect'];
  return { db: drizzle({ client: pool, schema }) as unknown as Db, pool, explicados };
}

const app = makeDb(inject('appDatabaseUrl'));
const explica = dbQueExplica();
afterAll(async () => {
  await app.pool.end();
  await explica.pool.end();
});

function nos(p: Plano): Plano[] {
  return [p, ...(p.Plans ?? []).flatMap(nos)];
}
/** As varreduras de `fin_lancamentos` que não vão pelo índice com `tenant_id` (vazio = aprovado). */
function varredurasSemTenant(e: Explicado): string[] {
  return nos(e.plano)
    .filter((n) => n['Relation Name'] === 'fin_lancamentos' || n['Index Name']?.startsWith('fin_lancamentos_'))
    .filter((n) => n['Node Type'] === 'Seq Scan' || (n['Index Name'] !== undefined && !n['Index Cond']?.includes('tenant_id')))
    .map((n) => `${n['Node Type']}${n['Index Name'] ? ` ${n['Index Name']}` : ''}${n['Index Cond'] ? ` (${n['Index Cond']})` : ''}`);
}

/** 16/11/2026, 12:00 em São Paulo. */
const agora = new Date('2026-11-16T15:00:00Z');
let T: TenantDeTeste;
let paciente: string;

beforeAll(async () => {
  T = await novoTenant(app.db);
  const d = { db: app.db, agora };
  await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-01-01', saldoInicial: '1.500,00', valorConsulta: '250,00' }, d);
  const cats = await listarCategorias(T.ctx, d);
  const consultas = cats.find((c) => c.nome === 'Consultas')!.id;
  const aluguel = cats.find((c) => c.nome === 'Aluguel e condomínio')!.id;
  paciente = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  await criarLancamento(T.ctx, T.tenant, { tipo: 'entrada', valor: '250,00', categoriaId: consultas, vencimento: '2026-11-10', pacienteId: paciente }, d);
  await criarLancamento(T.ctx, T.tenant, { tipo: 'entrada', valor: '250,00', categoriaId: consultas, vencimento: '2026-10-10', pacienteId: paciente, pagoEm: '2026-10-10', forma: 'pix' }, d);
  await criarLancamento(T.ctx, T.tenant, { tipo: 'saida', valor: '100,00', categoriaId: aluguel, vencimento: '2026-11-05' }, d);
});

async function explicar(fn: (deps: { db: Db; agora: Date }) => Promise<unknown>): Promise<Explicado[]> {
  explica.explicados.length = 0;
  await fn({ db: explica.db, agora });
  return [...explica.explicados];
}
function semVarreduraSemTenant(explicados: Explicado[], quantas: number) {
  expect(explicados).toHaveLength(quantas);
  for (const e of explicados) expect(varredurasSemTenant(e), e.consulta).toEqual([]);
}

describe('agregados do Financeiro — plano das consultas (RNF-301, índices da §9)', () => {
  it('Resumo sem configuração: agregado e últimos lançamentos pelo índice do consultório', async () => {
    const U = await novoTenant(app.db);
    semVarreduraSemTenant(await explicar((d) => resumoDoMes(U.ctx, U.tenant, d)), 2);
  });

  it('Resumo com saldo antes do mês e no mês: agregado e últimos lançamentos pelo índice do consultório', async () => {
    for (const saldoInicialEm of ['2026-01-01', '2026-11-03']) {
      await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm, saldoInicial: '1.500,00', valorConsulta: '250,00' }, { db: app.db, agora });
      semVarreduraSemTenant(await explicar((d) => resumoDoMes(T.ctx, T.tenant, d)), 2);
    }
  });

  it('fluxo de caixa: saldo de um ano anterior e saldo no ano (células e saldo pelo índice)', async () => {
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2025-06-01', saldoInicial: '1.500,00', valorConsulta: '250,00' }, { db: app.db, agora });
    semVarreduraSemTenant(await explicar((d) => fluxoDeCaixaDoAno(T.ctx, T.tenant, 2026, d)), 2);
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-03-15', saldoInicial: '1.500,00', valorConsulta: '250,00' }, { db: app.db, agora });
    semVarreduraSemTenant(await explicar((d) => fluxoDeCaixaDoAno(T.ctx, T.tenant, 2026, d)), 2);
  });

  it('12 meses, pagamentos pendentes e pendências do paciente pelo índice do consultório', async () => {
    semVarreduraSemTenant(await explicar((d) => entradasESaidas12Meses(T.ctx, T.tenant, d)), 1);
    semVarreduraSemTenant(await explicar((d) => pagamentosPendentes(T.ctx, T.tenant, d)), 1);
    semVarreduraSemTenant(await explicar((d) => pendenciasDoPaciente(T.ctx, T.tenant, paciente, d)), 1);
  });
});
