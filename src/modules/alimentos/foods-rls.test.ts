import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

const violaRls = (e: unknown) => {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string };
  return c.code === '42501';
};

describe('RLS de foods: TACO compartilhada e somente leitura (D1)', () => {
  it('o seed tem os 597 alimentos com ids determinísticos', async () => {
    const r = await owner.pool.query(`select count(*)::int as n from foods where tenant_id is null`);
    expect(r.rows[0].n).toBe(597);
    const arroz = await owner.pool.query(`select nome, kcal from foods where id = $1`, [idTaco(3)]);
    expect(arroz.rows[0]).toEqual({ nome: 'Arroz, tipo 1, cozido', kcal: '128.00' });
  });

  it('nutricionista e paciente leem a TACO; ninguém altera, apaga ou cria linha da TACO', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    for (const ctx of [T.ctx, ctxPaciente(T.tenantId, p.id)]) {
      const n = await withTenant(ctx, (tx) => tx.execute(sql`select count(*)::int as n from foods where tenant_id is null`), app.db);
      expect(n.rows[0].n).toBe(597);
    }
    await withTenant(
      T.ctx,
      async (tx) => {
        expect((await tx.execute(sql`update foods set nome = 'x' where taco_id = 3`)).rowCount).toBe(0);
        expect((await tx.execute(sql`delete from foods where taco_id = 3`)).rowCount).toBe(0);
      },
      app.db,
    );
    await expect(
      withTenant(T.ctx, (tx) => tx.execute(sql`insert into foods (nome, grupo, taco_id) values ('Falso', 'Miscelâneas', 9999)`), app.db),
    ).rejects.toSatisfy(violaRls);
    const arroz = await owner.pool.query(`select nome from foods where taco_id = 3`);
    expect(arroz.rows[0].nome).toBe('Arroz, tipo 1, cozido');
  });

  it('"Meu alimento" de A não aparece para B', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    await withTenant(
      A.ctx,
      (tx) => tx.execute(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
                             values (${A.tenantId}, 'Pão low carb Marca X', 'Cereais e derivados', 250, 12, 8, 18, 6)`),
      app.db,
    );
    const deB = await withTenant(B.ctx, (tx) => tx.execute(sql`select 1 from foods where nome = 'Pão low carb Marca X'`), app.db);
    expect(deB.rows).toHaveLength(0);
  });
});
