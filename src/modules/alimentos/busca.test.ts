import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { BUSCA_LIMITE, buscarAlimentos, palavrasDaBusca } from './busca';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const proprio = (tenantId: string, nome: string) =>
  sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
      values (${tenantId}, ${nome}, 'Cereais e derivados', 250, 12, 8, 18, 6)`;

describe('busca de alimentos (US-020, D6)', () => {
  it('"Busca tolerante a acento": "feijao carioca" traz "Feijão, carioca, cozido" entre os 5 primeiros, com selo TACO', async () => {
    const T = await novoTenant(app.db);
    const r = await buscarAlimentos(T.ctx, 'feijao carioca', app.db);
    const i = r.findIndex((a) => a.nome === 'Feijão, carioca, cozido');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(5);
    expect(r[i]).toMatchObject({ id: idTaco(561), origem: 'TACO', grupo: 'Leguminosas e derivados', porCem: { kcal: 76, proteinaG: 4.8, carboidratoG: 13.6, lipidioG: 0.5, fibraG: 8.5 } });
  });

  it('maiúsculas, acento invertido e ordem: quem começa com a 1ª palavra vem antes', async () => {
    const T = await novoTenant(app.db);
    expect((await buscarAlimentos(T.ctx, 'PÃO FRANCES', app.db))[0].nome).toBe('Pão, trigo, francês');
    const arroz = await buscarAlimentos(T.ctx, 'arroz', app.db);
    // 7 nomes começam com "Arroz" (6 da TACO + "Arroz carreteiro"); depois vêm "Creme de arroz, pó", "Bolinho de arroz"…
    expect(arroz.slice(0, 7).every((a) => a.nome.startsWith('Arroz'))).toBe(true);
    expect(arroz.slice(7).some((a) => a.nome.startsWith('Arroz'))).toBe(false);
    expect(arroz.map((a) => a.nome)).toContain('Creme de arroz, pó');
    expect(arroz.find((a) => a.id === idTaco(3))?.medidas).toContainEqual({ id: null, origem: 'IBGE', nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 });
  });

  it('"Origem visível": "Meu alimento" de A aparece para A e nunca para B', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    await withTenant(A.ctx, (tx) => tx.execute(proprio(A.tenantId, 'Pão low carb Marca X')), app.db);
    expect((await buscarAlimentos(A.ctx, 'pao low carb', app.db))[0]).toMatchObject({ nome: 'Pão low carb Marca X', origem: 'Meu alimento' });
    expect(await buscarAlimentos(B.ctx, 'pao low carb', app.db)).toEqual([]);
  });

  it('termo curto, vazio, não-texto ou com curingas do LIKE não lista a tabela inteira', async () => {
    const T = await novoTenant(app.db);
    for (const t of ['', ' ', 'a', null, 42, '%%', '__', '\\\\']) expect(await buscarAlimentos(T.ctx, t, app.db), String(t)).toEqual([]);
    expect(palavrasDaBusca('  Feijão,  carioca ')).toEqual(['feijão', 'carioca']);
    expect(palavrasDaBusca('x'.repeat(200))[0]).toHaveLength(60);
  });

  it(`no máximo ${BUSCA_LIMITE} resultados e p95 ≤ 300 ms com 3000 alimentos próprios no tenant (RNF-01)`, async () => {
    const T = await novoTenant(app.db);
    await withTenant(
      T.ctx,
      (tx) =>
        tx.execute(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
                       select ${T.tenantId}, 'Produto ' || g || ' integral', 'Cereais e derivados', 100, 1, 1, 1, 1
                       from generate_series(1, 3000) g`),
      app.db,
    );
    const tempos: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = await buscarAlimentos(T.ctx, i % 2 ? 'integral' : 'feijao carioca', app.db);
      tempos.push(performance.now() - t0);
      expect(r.length).toBeLessThanOrEqual(BUSCA_LIMITE);
    }
    tempos.sort((a, b) => a - b);
    expect(tempos[Math.ceil(0.95 * tempos.length) - 1]).toBeLessThanOrEqual(300);
  });
});
