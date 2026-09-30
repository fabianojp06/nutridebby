import { inspect } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { DbError, uniqueViolation } from './errors';
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
