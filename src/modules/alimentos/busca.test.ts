import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { apagarPublicos, inserirPublicos } from '../../../test/alimentos-publicos';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { buscarAlimentos, palavrasDaBusca } from './busca';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
/** Linhas públicas de teste (USDA e uma TBCA), apagadas no afterAll: o banco do Vitest é um só para todos os arquivos. */
let publicos: string[] = [];
let quinoaUsda: string, pinhaoUsda: string, tbca: string;
beforeAll(async () => {
  publicos = await inserirPublicos(owner.pool, [
    { nome: 'Quinoa, cozida', nomeOriginal: 'Quinoa, cooked', kcal: 120, proteinaG: 4.4, carboidratoG: 21.3, lipidioG: 1.9, fibraG: 2.8, micros: { calcio_mg: 17, vitamina_d_mcg: 0 } },
    // mais parecido com "pinhao" e mais curto que o "Pinhão, cozido" da TACO: só a fonte o põe depois
    { nome: 'Pinhão', nomeOriginal: 'Pine nuts', grupo: 'Nozes e sementes', kcal: 673 },
    { fonte: 'tbca', nome: 'Quinoa em grão TBCA', grupo: 'Cereais e derivados', kcal: 360 },
  ]);
  [quinoaUsda, pinhaoUsda, tbca] = publicos;
});
afterAll(async () => {
  await apagarPublicos(owner.pool, publicos);
  await app.pool.end();
  await owner.pool.end();
});

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

  it('RN-230: "quinoa" traz o meu alimento antes da USDA; a USDA vem com selo, nome original e micros; a TBCA nunca aparece', async () => {
    const T = await novoTenant(app.db);
    await withTenant(T.ctx, (tx) => tx.execute(proprio(T.tenantId, 'Quinoa em flocos da casa')), app.db);
    const r = (await buscarAlimentos(T.ctx, 'quinoa', app.db)).filter((a) => a.id === quinoaUsda || a.id === tbca || a.nome === 'Quinoa em flocos da casa');
    expect(r.map((a) => [a.nome, a.fonte, a.origem])).toEqual([
      ['Quinoa em flocos da casa', 'propria', 'Meu alimento'],
      ['Quinoa, cozida', 'usda', 'USDA (EUA)'],
    ]);
    expect(r[1]).toMatchObject({ nomeOriginal: 'Quinoa, cooked', micros: { calcio_mg: 17, vitamina_d_mcg: 0 }, porCem: { kcal: 120, proteinaG: 4.4 } });
    expect(r[0]).toMatchObject({ nomeOriginal: null, micros: {} });
    expect((await buscarAlimentos(T.ctx, 'quinoa', app.db, { fontes: ['tbca'] })).map((a) => a.id)).not.toContain(tbca);
    expect((await buscarAlimentos(T.ctx, 'grao tbca', app.db)).map((a) => a.id)).not.toContain(tbca);
  });

  it('RN-230: a TACO vem antes da USDA mesmo quando a USDA é mais parecida e mais curta', async () => {
    const T = await novoTenant(app.db);
    const ids = (await buscarAlimentos(T.ctx, 'pinhao', app.db)).map((a) => a.id).filter((id) => id === idTaco(595) || id === pinhaoUsda);
    expect(ids).toEqual([idTaco(595), pinhaoUsda]);
  });

  it('RN-230: acha pelo nome original em inglês ("cooked quinoa")', async () => {
    const T = await novoTenant(app.db);
    expect((await buscarAlimentos(T.ctx, 'cooked quinoa', app.db)).map((a) => a.id)).toContain(quinoaUsda);
    expect((await buscarAlimentos(T.ctx, 'pine nuts', app.db)).map((a) => a.id)).toContain(pinhaoUsda);
  });

  it('filtro de fonte e de grupo: só USDA; só TACO e próprios; grupo', async () => {
    const T = await novoTenant(app.db);
    await withTenant(T.ctx, (tx) => tx.execute(proprio(T.tenantId, 'Pinhão da serra')), app.db);
    const usda = await buscarAlimentos(T.ctx, 'pinhao', app.db, { fontes: ['usda'] });
    expect(usda.map((a) => a.id)).toContain(pinhaoUsda);
    expect(usda.every((a) => a.fonte === 'usda')).toBe(true);
    const semUsda = await buscarAlimentos(T.ctx, 'pinhao', app.db, { fontes: ['taco', 'propria'] });
    expect(semUsda.map((a) => a.nome).sort()).toEqual(['Pinhão da serra', 'Pinhão, cozido']);
    expect((await buscarAlimentos(T.ctx, 'pinhao', app.db, { grupo: 'Nozes e sementes' })).map((a) => a.grupo)).not.toContain('Cereais e derivados');
    expect(await buscarAlimentos(T.ctx, 'pinhao', app.db, { fontes: [] })).toEqual([]);
  });

  it('termo curto, vazio, não-texto ou com curingas do LIKE não lista a tabela inteira', async () => {
    const T = await novoTenant(app.db);
    for (const t of ['', ' ', 'a', null, 42, '%%', '__', '\\\\']) expect(await buscarAlimentos(T.ctx, t, app.db), String(t)).toEqual([]);
    expect(palavrasDaBusca('  Feijão,  carioca ')).toEqual(['feijão', 'carioca']);
    expect(palavrasDaBusca('x'.repeat(200))[0]).toHaveLength(60);
  });
});
