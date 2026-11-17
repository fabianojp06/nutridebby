import { afterAll, afterEach, describe, expect, inject, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import type { Db } from '@/db/client';
import * as schema from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { filtrarBreadcrumb, filtrarEvento } from '@/lib/sentry-filtro';
import { sql } from 'drizzle-orm';
import { listarCategorias, renomearCategoria, salvarConfiguracoes } from './configuracoes';
import { cancelarLancamento, criarLancamento, editarLancamento } from './lancamentos';

/**
 * RNF-300 / CS-302 / RN-322: valor, descrição, motivo, categoria e nome do paciente nunca vão para log, Sentry ou mensagem
 * de erro. Erros forçados de dois jeitos: a validação do módulo (FinanceiroError) e o banco (a escrita recusada no meio da
 * transação: o DrizzleQueryError traria o SQL e os parâmetros na mensagem, e o withTenant precisa limpar).
 */
const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
/**
 * Banco que deixa ler e travar, mas recusa a escrita: antes de cada INSERT/UPDATE/DELETE, a transação vira só de leitura
 * (permitido no meio dela). A falha (25006) é no próprio comando que leva os valores — o DrizzleQueryError traria o SQL e
 * os parâmetros (valor, descrição, motivo, nome da categoria) na mensagem, e o withTenant tem de limpar.
 */
const soLeitura = new Pool({ connectionString: inject('appDatabaseUrl'), max: 2 });
const conectar = soLeitura.connect.bind(soLeitura) as () => Promise<PoolClient>;
const marcados = new WeakSet<PoolClient>();
soLeitura.connect = (async () => {
  const c = await conectar();
  if (!marcados.has(c)) {
    marcados.add(c);
    const consultar = c.query.bind(c) as (cfg: unknown, valores?: unknown) => Promise<unknown>;
    c.query = (async (cfg: unknown, valores?: unknown) => {
      const texto = typeof cfg === 'string' ? cfg : (cfg as { text?: string } | null)?.text ?? '';
      if (/^\s*(insert|update|delete)\b/i.test(texto)) await consultar('set local transaction_read_only = on');
      return consultar(cfg, valores);
    }) as unknown as PoolClient['query'];
  }
  return c;
}) as unknown as Pool['connect'];
const dbSoLeitura = drizzle({ client: soLeitura, schema }) as unknown as Db;
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
  await soLeitura.end();
});
afterEach(() => vi.restoreAllMocks());

const agora = new Date('2026-11-18T01:30:00Z');
const MARCAS = {
  valor: '987.654,32',
  valorCentavos: '98765432',
  descricao: 'MARCA-DESCRICAO-7Q',
  motivo: 'MARCA-MOTIVO-3W',
  categoria: 'MARCA-CATEGORIA-5Z',
  nome: 'MARCA-NOME-PACIENTE-9K',
};
const textos = Object.values(MARCAS);

/** Tudo o que um log ou o Sentry poderia levar do erro: nome, mensagem, causa, erros por campo, pilha. */
function tudoDoErro(e: unknown): string {
  const partes: unknown[] = [];
  for (let x: unknown = e, i = 0; x && i < 6; x = (x as { cause?: unknown }).cause, i++) {
    const o = x as { name?: unknown; message?: unknown; stack?: unknown; erros?: unknown; code?: unknown };
    partes.push(o.name, o.message, o.stack, o.erros, o.code);
  }
  return JSON.stringify(partes);
}

const pegar = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('devia falhar');
    },
    (e: unknown) => e,
  );

describe('RNF-300: nada do Financeiro no log, no Sentry nem na mensagem de erro', () => {
  it('erros de validação e do banco em criarLancamento, editarLancamento, cancelarLancamento, salvarConfiguracoes e renomearCategoria', async () => {
    const espioes = (['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).map((n) => vi.spyOn(logger, n));
    const T = await novoTenant(app.db);
    const deps = { db: app.db, agora };
    const ruim = { db: dbSoLeitura, agora };
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: '100', valorConsulta: '' }, deps);
    const cats = await listarCategorias(T.ctx, deps);
    const consultas = cats.find((c) => c.chave === 'consultas')!;
    await renomearCategoria(T.ctx, consultas.id, MARCAS.categoria, deps);
    const p = await novoPaciente(app.db, T.ctx, { nome: MARCAS.nome });
    const base = { tipo: 'entrada', valor: MARCAS.valor, categoriaId: consultas.id, vencimento: '2026-11-20', pacienteId: p.id, descricao: MARCAS.descricao };
    const { id } = await criarLancamento(T.ctx, T.tenant, base, deps);

    const erros = [
      // validação
      await pegar(criarLancamento(T.ctx, T.tenant, { ...base, valor: `${MARCAS.valor}x`, descricao: MARCAS.descricao.repeat(20) }, deps)),
      await pegar(editarLancamento(T.ctx, T.tenant, id, { ...base, valor: MARCAS.descricao, pagoEm: '2026-11-18', forma: MARCAS.motivo }, deps)),
      await pegar(cancelarLancamento(T.ctx, id, MARCAS.motivo.repeat(20), deps)),
      await pegar(salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: MARCAS.descricao, saldoInicial: MARCAS.valor.repeat(3), valorConsulta: MARCAS.nome }, deps)),
      await pegar(renomearCategoria(T.ctx, consultas.id, MARCAS.categoria.repeat(5), deps)),
      // banco (a escrita é recusada)
      await pegar(criarLancamento(T.ctx, T.tenant, base, ruim)),
      await pegar(editarLancamento(T.ctx, T.tenant, id, base, ruim)),
      await pegar(cancelarLancamento(T.ctx, id, MARCAS.motivo, ruim)),
      await pegar(salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-11-01', saldoInicial: MARCAS.valor, valorConsulta: '' }, ruim)),
      await pegar(renomearCategoria(T.ctx, consultas.id, `${MARCAS.categoria}-2`, ruim)),
    ];
    // o banco falhou de verdade, no comando de escrita (25006), e o erro saiu limpo
    expect(erros.slice(5).map((e) => [(e as { name?: string }).name, (e as { code?: string }).code])).toEqual(Array(5).fill(['DbError', '25006']));
    for (const e of erros) {
      const t = tudoDoErro(e);
      for (const m of textos) expect(t, `erro ${(e as Error).name}`).not.toContain(m);
      const evento = filtrarEvento({
        message: (e as Error).message,
        exception: { values: [{ type: (e as Error).name, value: (e as Error).message }] },
        extra: { erro: t },
        tags: { motivo: (e as Error).message },
      });
      for (const m of textos) expect(JSON.stringify(evento)).not.toContain(m);
    }
    const logs = JSON.stringify(espioes.map((s) => s.mock.calls));
    for (const m of textos) expect(logs).not.toContain(m);
    // e nada foi gravado pelas tentativas recusadas
    const { rows } = await owner.pool.query('select count(*)::int as n from fin_lancamentos where tenant_id = $1', [T.tenantId]);
    expect(rows[0].n).toBe(1);
    expect(await withTenant(T.ctx, (tx) => tx.execute(sql`select valor_centavos from fin_lancamentos where id = ${id}`), app.db).then((r) => r.rows)).toEqual([
      { valor_centavos: 98765432 },
    ]);
  });

  it('os formulários do Financeiro ficam fora dos breadcrumbs: cliques e digitação somem; a navegação leva só a origem', () => {
    const url = `https://app.exemplo/painel/financeiro/lancamentos?paciente=0b5f2b8e-1c1d-4a3e-9a51-2a8f1f0e9c11&descricao=${MARCAS.descricao}`;
    expect(filtrarBreadcrumb({ category: 'ui.input', message: `form#lancamento > input[name="descricao"] ${MARCAS.descricao}` })).toBeNull();
    expect(filtrarBreadcrumb({ category: 'ui.click', message: `button "Salvar entrada" ${MARCAS.valor}` })).toBeNull();
    expect(filtrarBreadcrumb({ category: 'navigation', data: { from: '/painel/financeiro', to: url } })).toBeNull();
    expect(filtrarBreadcrumb({ category: 'console', message: MARCAS.nome })).toBeNull();
    const fetch = filtrarBreadcrumb({ category: 'fetch', message: MARCAS.motivo, data: { method: 'POST', url, status_code: 303, body: MARCAS.valor } });
    expect(fetch).toEqual({ category: 'fetch', data: { method: 'POST', status_code: 303, url: 'https://app.exemplo' } });
  });
});
