import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { gramasDaMedida, MSG_MEDIDA, textoMedida } from './medidas-constantes';
import { cadastrarMedida, excluirMedida, MedidaError, medidasDoAlimento } from './medidas';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof MedidaError) return e.erros;
    throw e;
  }
  throw new Error('esperava MedidaError');
};

describe('texto e gramas da medida (US-020, D5)', () => {
  const colher = { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias' };
  it('"Medidas caseiras": 4 colheres de sopa cheias de 25 g = 100 g', () => {
    expect(gramasDaMedida(4, 25)).toBe(100);
    expect(textoMedida(4, colher)).toBe('4 colheres de sopa cheias');
  });
  it('singular abaixo de 2, vírgula decimal, sem zeros à direita', () => {
    expect(textoMedida(1, colher)).toBe('1 colher de sopa cheia');
    expect(textoMedida(0.5, colher)).toBe('0,5 colher de sopa cheia');
    expect(textoMedida(1.5, colher)).toBe('1,5 colher de sopa cheia');
    expect(textoMedida(2.25, colher)).toBe('2,25 colheres de sopa cheias');
    expect(gramasDaMedida(1.5, 17)).toBe(25.5);
    expect(gramasDaMedida(1 / 3, 50)).toBe(16.67);
  });
});

describe('medidas do alimento', () => {
  it('seed do IBGE no arroz tipo 1 cozido: "colher de sopa cheia" (25 g) — cenário da spec', async () => {
    const T = await novoTenant(app.db);
    const ms = await medidasDoAlimento(T.ctx, idTaco(3), app.db);
    expect(ms).toContainEqual({ id: null, origem: 'IBGE', nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 });
  });

  it('"Alimento sem medida caseira": lista vazia; a medida cadastrada vale só para o tenant que cadastrou', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const chuchu = idTaco(112); // Chuchu, cozido — sem medida no seed
    expect(await medidasDoAlimento(A.ctx, chuchu, app.db)).toEqual([]);
    const m = await cadastrarMedida(A.ctx, chuchu, { nome: ' pires  pequeno ', plural: 'pires pequenos', gramas: '60' }, { db: app.db });
    expect(m).toMatchObject({ origem: 'Minha medida', nome: 'pires pequeno', plural: 'pires pequenos', gramas: 60 });
    expect(await medidasDoAlimento(A.ctx, chuchu, app.db)).toEqual([m]);
    expect(await medidasDoAlimento(B.ctx, chuchu, app.db)).toEqual([]);
    expect(await excluirMedida(B.ctx, m.id!, app.db)).toBe(false);
    expect(await excluirMedida(A.ctx, m.id!, app.db)).toBe(true);
  });

  it('validação: nome/plural, gramas com vírgula, faixa, duplicada (também com o IBGE) e alimento invisível', async () => {
    const A = await novoTenant(app.db);
    const arroz = idTaco(3);
    expect(await erros(cadastrarMedida(A.ctx, arroz, { nome: 'x', plural: '', gramas: '0' }, { db: app.db }))).toEqual({
      nome: MSG_MEDIDA.nome,
      gramas: MSG_MEDIDA.gramas,
    });
    for (const gramas of ['abc', '-1', '5000,5', '']) {
      expect(await erros(cadastrarMedida(A.ctx, arroz, { nome: 'xícara', plural: 'xícaras', gramas }, { db: app.db })), gramas).toEqual({ gramas: MSG_MEDIDA.gramas });
    }
    await cadastrarMedida(A.ctx, arroz, { nome: 'xícara', plural: 'xícaras', gramas: '160,5' }, { db: app.db });
    expect(await erros(cadastrarMedida(A.ctx, arroz, { nome: 'xícara', plural: 'xícaras', gramas: '150' }, { db: app.db }))).toEqual({ nome: MSG_MEDIDA.duplicada });
    // homônima de uma medida do IBGE do mesmo alimento: o editor não teria como distinguir as duas
    for (const nome of ['colher de sopa cheia', ' colher  de sopa cheia '])
      expect(await erros(cadastrarMedida(A.ctx, arroz, { nome, plural: 'colheres de sopa cheias', gramas: '30' }, { db: app.db })), nome).toEqual({ nome: MSG_MEDIDA.duplicada });
    expect(await cadastrarMedida(A.ctx, arroz, { nome: 'colher de sopa bem cheia', plural: 'colheres de sopa bem cheias', gramas: '30' }, { db: app.db })).toMatchObject({ origem: 'Minha medida', gramas: 30 });
    expect(await cadastrarMedida(A.ctx, idTaco(112), { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: '30' }, { db: app.db })).toMatchObject({ origem: 'Minha medida' }); // o chuchu não tem essa medida do IBGE
    expect(await erros(cadastrarMedida(A.ctx, '00000000-0000-4000-8000-999999999999', { nome: 'xícara', plural: 'xícaras', gramas: '1' }, { db: app.db }))).toEqual({
      geral: MSG_MEDIDA.alimento,
    });
    expect(await erros(cadastrarMedida(A.ctx, 'abc', { nome: 'xícara', plural: 'xícaras', gramas: '1' }, { db: app.db }))).toEqual({ geral: MSG_MEDIDA.alimento });
  });
});
