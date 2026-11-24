import { eq, sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { espiarErrosDoBanco } from '../../test/erros-do-banco';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { buscarAnamnese, atualizarAnamnese, buscarModelo, preencherAnamnese, salvarModelo } from '@/modules/pacientes/anamnese';
import { paraJsonbSeguro } from './jsonb-seguro';
import { anamneses } from './schema';
import { withTenant } from './tenant';

/**
 * SUS-121 (regra 3): o NUL e o surrogate sem par num texto de uma coluna jsonb de saúde (anamnese) não chegam ao
 * Postgres — sem o `jsonbSeguro`, o surrogate dá 22P02 com o trecho do JSON no CONTEXT (log do banco e erro do app) e o
 * NUL dá 22P05. Dois espiões no pool: o SQLSTATE de todo erro (`espiarErrosDoBanco`) e todo parâmetro enviado (nenhum
 * com o caractere, nem como escape no texto JSON).
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
const parametros: unknown[] = [];
app.pool.on('connect', (client: PoolClient) => {
  const original = client.query.bind(client) as (...a: unknown[]) => unknown;
  (client as unknown as { query: (...a: unknown[]) => unknown }).query = (...a: unknown[]) => {
    const cfg = a[0] as { values?: unknown[] } | string;
    if (Array.isArray(a[1])) parametros.push(...(a[1] as unknown[]));
    if (typeof cfg === 'object' && Array.isArray(cfg?.values)) parametros.push(...cfg.values);
    return original(...a);
  };
});
afterAll(() => app.pool.end());
const now = new Date('2026-11-24T12:00:00Z');

const INVALIDOS = [
  ['NUL', '\u0000'],
  ['surrogate alto sem par', '\ud800'],
  ['surrogate baixo sem par', '\udc00'],
] as const;
const sujo = (t: string, c: string) => `${t}${c} baixa 🙂`;
const limpo = (t: string) => `${t} baixa 🙂`;
const comInvalido = (v: unknown) => typeof v === 'string' && (v.includes('\u0000') || !v.isWellFormed() || /\\u(?:0000|d[89a-f])/i.test(v));

async function semErroDoBanco<T>(f: () => Promise<T>): Promise<T> {
  errosDoBanco.length = 0;
  parametros.length = 0;
  const r = await f().then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  expect(errosDoBanco).toEqual([]);
  if (!r.ok) throw r.e;
  expect(parametros.length).toBeGreaterThan(0);
  expect(parametros.filter(comInvalido)).toEqual([]);
  return r.v;
}

async function anamneseDeTeste() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const modeloId = await salvarModelo(T.ctx, null, { nome: 'Consulta', perguntas: [{ tipo: 'texto_longo', rotulo: 'Queixa principal', obrigatoria: true }] }, app.db);
  const [pergunta] = (await buscarModelo(T.ctx, modeloId, app.db))!.schema.perguntas;
  return { T, p, modeloId, q: pergunta.id };
}

describe('SUS-121: jsonbSeguro na anamnese (dado de saúde em jsonb)', () => {
  it.each([
    ['NUL', '22P05', '\u0000'],
    ['surrogate alto sem par', '22P02', '\ud800'],
  ] as const)('controle: o JSON.stringify cru com %s num ::jsonb é recusado (%s); pelo paraJsonbSeguro, não', async (_nome, codigo, ch) => {
    errosDoBanco.length = 0;
    await expect(app.db.execute(sql`select ${JSON.stringify({ t: `x${ch}` })}::jsonb as v`)).rejects.toMatchObject({ code: codigo });
    expect(errosDoBanco).toEqual([codigo]);
    const r = await semErroDoBanco(() => app.db.execute<{ v: unknown }>(sql`select ${paraJsonbSeguro({ t: `x${ch}` })}::jsonb as v`));
    expect(r.rows[0].v).toEqual({ t: 'x' });
  });

  it.each(INVALIDOS)('preencher e corrigir a anamnese com %s: sem erro do banco, valor limpo', async (_nome, ch) => {
    const { T, p, modeloId, q } = await anamneseDeTeste();
    const id = await semErroDoBanco(() => preencherAnamnese(T.ctx, T.tenant, p.id, modeloId, { [q]: sujo('Ferritina', ch) }, { db: app.db, now }));
    expect((await buscarAnamnese(T.ctx, p.id, id, app.db))?.respostas).toEqual({ [q]: limpo('Ferritina') });
    await semErroDoBanco(() => atualizarAnamnese(T.ctx, p.id, id, { [q]: sujo('Hemoglobina', ch) }, app.db));
    expect((await buscarAnamnese(T.ctx, p.id, id, app.db))?.respostas).toEqual({ [q]: limpo('Hemoglobina') });
  });

  it.each(INVALIDOS)('gravação direta pelo Drizzle tipado com %s na chave, no valor e no snapshot', async (_nome, ch) => {
    const { T, p } = await anamneseDeTeste();
    const [a] = await semErroDoBanco(() =>
      withTenant(
        T.ctx,
        (tx) =>
          tx
            .insert(anamneses)
            .values({
              tenantId: T.ctx.tenantId,
              patientId: p.id,
              templateSnapshot: { nome: sujo('Consulta', ch), perguntas: [{ id: `q${ch}1`, tipo: 'texto_curto', rotulo: sujo('Alergias', ch), obrigatoria: false }] },
              respostas: { [`q${ch}1`]: sujo('Lactose', ch) },
              data: '2026-11-24',
            })
            .returning({ id: anamneses.id }),
        app.db,
      ),
    );
    const [gravada] = await withTenant(
      T.ctx,
      (tx) =>
        tx
          .select({ respostas: sql<string>`${anamneses.respostas}::text`, snapshot: sql<string>`${anamneses.templateSnapshot}::text` })
          .from(anamneses)
          .where(eq(anamneses.id, a.id)),
      app.db,
    );
    expect(JSON.parse(gravada.respostas)).toEqual({ q1: limpo('Lactose') });
    expect(JSON.parse(gravada.snapshot)).toMatchObject({ nome: limpo('Consulta'), perguntas: [{ id: 'q1', rotulo: limpo('Alergias') }] });
  });
});
