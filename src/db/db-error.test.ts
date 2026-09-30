import { inspect } from 'node:util';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { user } from './schema';
import { DbError, uniqueViolation } from './errors';
import './client'; // instala a sanitização em todas as consultas do Drizzle
import { withTenant } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
});

describe('withTenant: erros de banco sem dados (RNF-11, CLAUDE.md regra 3)', () => {
  it('unique violation vira DbError sem SQL, parâmetros nem valores; uniqueViolation() continua achando a constraint', async () => {
    const T = await novoTenant(app.db);
    const email = `vazamento-XYZ-${Date.now()}@ex.com`;
    await novoPaciente(app.db, T.ctx, { email, nome: 'Nome-Sigiloso-XYZ' });
    const err = await novoPaciente(app.db, T.ctx, { email, nome: 'Nome-Sigiloso-XYZ' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DbError);
    for (const texto of [inspect(err, { depth: 10 }), String(err), JSON.stringify(err), (err as Error).message]) {
      expect(texto).not.toContain('vazamento-XYZ');
      expect(texto).not.toContain('Nome-Sigiloso-XYZ');
      expect(texto).not.toMatch(/insert into|params:|Key \(/i);
    }
    expect(uniqueViolation(err)).toMatch(/patients/);
    expect((err as DbError).code).toBe('23505');
  });

  it('erros que não são de banco passam sem alteração', async () => {
    const T = await novoTenant(app.db);
    const proprio = new RangeError('meu erro');
    await expect(withTenant(T.ctx, async () => { throw proprio; }, app.db)).rejects.toBe(proprio);
  });
});

describe('consulta direta no db, fora do withTenant (Better Auth, convites, contas): também sem dados', () => {
  it('unique violation num insert direto vira DbError sem e-mail, nome nem SQL', async () => {
    const email = `direto-XYZ-${Date.now()}@ex.com`;
    const linha = () => ({ id: crypto.randomUUID(), name: 'Nome-Direto-XYZ', email, appRole: 'paciente' as const });
    await app.db.insert(user).values(linha());
    const err = await app.db.insert(user).values(linha()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(DbError);
    for (const texto of [inspect(err, { depth: 10 }), String(err), (err as Error).message]) {
      expect(texto).not.toContain('direto-XYZ');
      expect(texto).not.toContain('Nome-Direto-XYZ');
      expect(texto).not.toMatch(/insert into|params:/i);
    }
    expect(uniqueViolation(err)).toMatch(/email/);
  });

  it('transação direta: o erro de dentro também chega sanitizado', async () => {
    const err = await app.db
      .transaction(async (tx) => tx.execute(sql`select 1 / ${0}::int as x, ${'segredo-XYZ'}::text as y`))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(DbError);
    expect(inspect(err, { depth: 10 })).not.toContain('segredo-XYZ');
  });
});
