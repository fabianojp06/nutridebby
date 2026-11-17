import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Db } from '@/db/client';
import { foods } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { apagarPublicos, inserirPublicos } from '../../../test/alimentos-publicos';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { KCAL_MAX, MSG_ALIMENTO } from './alimentos-constantes';
import { AlimentoError, carregarAlimento, criarAlimento, duplicarComoMeu, editarAlimento, excluirAlimento, fontesCarregadas } from './alimentos';
import { buscarAlimentos } from './busca';
import { MSG_NUTRIENTES } from './nutrientes';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
let usda: string;
beforeAll(async () => {
  [usda] = await inserirPublicos(owner.pool, [
    { nome: 'Amaranto, cozido', nomeOriginal: 'Amaranth grain, cooked', kcal: 102, proteinaG: 3.8, carboidratoG: 18.7, lipidioG: 1.6, fibraG: null, micros: { calcio_mg: 47, vitamina_b12_mcg: 0, ferro_mg: null } },
  ]);
});
afterAll(async () => {
  await apagarPublicos(owner.pool, [usda]);
  await app.pool.end();
  await owner.pool.end();
});
const deps = { db: app.db };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof AlimentoError) return e.erros;
    throw e;
  }
  throw new Error('esperava AlimentoError');
};

const PAO = { nome: 'Pão low carb Marca X', grupo: 'Cereais e derivados', kcal: '250', proteinaG: '12', carboidratoG: '8', lipidioG: '18', fibraG: '6' };

describe('alimentos próprios (US-021)', () => {
  it('"Cadastro": aparece nas minhas buscas com o selo "Meu alimento" e não aparece para nenhuma outra nutricionista', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { id } = await criarAlimento(A.ctx, PAO, deps);
    expect(await carregarAlimento(A.ctx, id, app.db)).toMatchObject({
      nome: 'Pão low carb Marca X', origem: 'Meu alimento', grupo: 'Cereais e derivados', incompleto: false,
      porCem: { kcal: 250, proteinaG: 12, carboidratoG: 8, lipidioG: 18, fibraG: 6 },
    });
    expect((await buscarAlimentos(A.ctx, 'pao low carb', app.db)).map((a) => [a.nome, a.origem])).toEqual([['Pão low carb Marca X', 'Meu alimento']]);
    expect(await buscarAlimentos(B.ctx, 'pao low carb', app.db)).toEqual([]);
    expect(await carregarAlimento(B.ctx, id, app.db)).toBeNull();
    await expect(editarAlimento(B.ctx, id, PAO, deps)).rejects.toMatchObject({ erros: { geral: MSG_ALIMENTO.naoEncontrado } });
    await expect(excluirAlimento(B.ctx, id, deps)).rejects.toMatchObject({ erros: { geral: MSG_ALIMENTO.naoEncontrado } });
  });

  it('validação: nome, grupo e valores por 100 g (vírgula aceita; lixo, negativo e acima do teto recusados)', async () => {
    const A = await novoTenant(app.db);
    expect(await erros(criarAlimento(A.ctx, { ...PAO, nome: ' x ', grupo: 'Doces', kcal: '1001', proteinaG: '-1', carboidratoG: 'abc', lipidioG: '', fibraG: '100,5' }, deps))).toEqual({
      nome: MSG_ALIMENTO.nome,
      grupo: MSG_ALIMENTO.grupo,
      kcal: MSG_ALIMENTO.valores,
      proteinaG: MSG_ALIMENTO.valores,
      carboidratoG: MSG_ALIMENTO.valores,
      lipidioG: MSG_ALIMENTO.valores,
      fibraG: MSG_ALIMENTO.valores,
    });
    const { id } = await criarAlimento(A.ctx, { ...PAO, kcal: '250,5', fibraG: '0' }, deps);
    expect((await carregarAlimento(A.ctx, id, app.db))?.porCem).toMatchObject({ kcal: 250.5, fibraG: 0 });
  });

  it('"TACO não editável": editar ou excluir a TACO é recusado; "Duplicar como meu alimento" copia valores e medidas', async () => {
    const A = await novoTenant(app.db);
    expect(await erros(editarAlimento(A.ctx, idTaco(3), PAO, deps))).toEqual({ geral: MSG_ALIMENTO.taco });
    expect(await erros(excluirAlimento(A.ctx, idTaco(3), deps))).toEqual({ geral: MSG_ALIMENTO.taco });
    const copia = await duplicarComoMeu(A.ctx, idTaco(3), deps);
    expect(copia.incompleto).toBe(false);
    const d = await carregarAlimento(A.ctx, copia.id, app.db);
    expect(d).toMatchObject({ nome: 'Arroz, tipo 1, cozido', origem: 'Meu alimento', porCem: { kcal: 128, proteinaG: 2.5 } });
    expect(d?.medidas).toContainEqual({ id: null, origem: 'IBGE', nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25 });
    await editarAlimento(A.ctx, copia.id, { ...PAO, nome: 'Arroz da casa' }, deps);
    expect((await carregarAlimento(A.ctx, copia.id, app.db))?.nome).toBe('Arroz da casa');
    expect((await carregarAlimento(A.ctx, idTaco(3), app.db))?.nome).toBe('Arroz, tipo 1, cozido'); // a TACO não mudou
  });

  it('duplicar alimento da TACO sem valor (leite integral, "*") deixa 0 e marca como incompleto', async () => {
    const A = await novoTenant(app.db);
    const copia = await duplicarComoMeu(A.ctx, idTaco(458), deps);
    expect(copia.incompleto).toBe(true);
    expect((await carregarAlimento(A.ctx, copia.id, app.db))?.porCem).toEqual({ kcal: 0, proteinaG: 0, carboidratoG: 0, lipidioG: 0, fibraG: 0 });
    expect((await carregarAlimento(A.ctx, idTaco(458), app.db))?.incompleto).toBe(true);
  });

  it('excluir alimento próprio que não está em plano; id inválido é "não encontrado"', async () => {
    const A = await novoTenant(app.db);
    const { id } = await criarAlimento(A.ctx, PAO, deps);
    await excluirAlimento(A.ctx, id, deps);
    expect(await carregarAlimento(A.ctx, id, app.db)).toBeNull();
    expect(await carregarAlimento(A.ctx, 'abc', app.db)).toBeNull();
    expect(await erros(excluirAlimento(A.ctx, 'abc', deps))).toEqual({ geral: MSG_ALIMENTO.naoEncontrado });
  });
});

describe('Plano 19: fonte, micros e textos por fonte (RN-230, RN-235, US-231)', () => {
  it('textos da RN-230: tabelas públicas não editáveis, incompleto pela sigla, energia até 1000 kcal', () => {
    expect(KCAL_MAX).toBe(1000);
    expect(MSG_ALIMENTO.valores).toBe('Valores por 100 g: energia entre 0 e 1000 kcal; os demais entre 0 e 100 g');
    expect(MSG_ALIMENTO.taco).toBe('Alimentos de tabelas públicas (TACO, USDA) não podem ser alterados. Use "Duplicar como meu alimento".');
    expect(MSG_ALIMENTO.incompleto('usda')).toBe('A USDA não tem todos os valores deste alimento: confira os campos com 0.');
    expect(MSG_ALIMENTO.incompleto('taco')).toBe('A TACO não tem todos os valores deste alimento: confira os campos com 0.');
  });

  it('RN-233: a tela de alimentos cita as tabelas públicas carregadas (com a USDA de teste: TACO e USDA; nunca a TBCA)', async () => {
    const A = await novoTenant(app.db);
    expect(await fontesCarregadas(A.ctx, app.db)).toEqual(['taco', 'usda']);
  });

  it('"Meu alimento com micros": cálcio 120 salva e o resto fica sem valor; kcal 950 passa (KCAL_MAX 1000); editar troca os micros', async () => {
    const A = await novoTenant(app.db);
    const { id } = await criarAlimento(A.ctx, { ...PAO, kcal: '950', micros: { calcio_mg: '120', sodio_mg: '', ferro_mg: null } }, deps);
    const d = await carregarAlimento(A.ctx, id, app.db);
    expect(d).toMatchObject({ fonte: 'propria', origem: 'Meu alimento', nomeOriginal: null, fonteOrigem: null, micros: { calcio_mg: 120 }, porCem: { kcal: 950 } });
    expect(Object.keys(d!.micros)).toEqual(['calcio_mg']);
    await editarAlimento(A.ctx, id, { ...PAO, micros: { calcio_mg: '', vitamina_d_mcg: '2,5' } }, deps);
    expect((await carregarAlimento(A.ctx, id, app.db))?.micros).toEqual({ vitamina_d_mcg: 2.5 });
    await editarAlimento(A.ctx, id, PAO, deps); // sem `micros` na entrada: os micros ficam
    expect((await carregarAlimento(A.ctx, id, app.db))?.micros).toEqual({ vitamina_d_mcg: 2.5 });
  });

  it('"Valor inválido": sódio -3 → "Use um número de 0 a 100000." no campo; texto e acima de 100000 também; chave fora do catálogo recusada', async () => {
    const A = await novoTenant(app.db);
    expect(MSG_NUTRIENTES.faixa).toBe('Use um número de 0 a 100000.');
    expect(await erros(criarAlimento(A.ctx, { ...PAO, micros: { sodio_mg: '-3' } }, deps))).toEqual({ 'micros.sodio_mg': 'Use um número de 0 a 100000.' });
    expect(await erros(criarAlimento(A.ctx, { ...PAO, kcal: '1001', micros: { sodio_mg: 'abc', calcio_mg: '100001', ferro_mg: '2' } }, deps))).toEqual({
      kcal: MSG_ALIMENTO.valores,
      'micros.sodio_mg': MSG_NUTRIENTES.faixa,
      'micros.calcio_mg': MSG_NUTRIENTES.faixa,
    });
    expect(await erros(criarAlimento(A.ctx, { ...PAO, micros: { cafeina_mg: '10' } }, deps))).toEqual({ geral: MSG_NUTRIENTES.desconhecido });
    expect(await erros(criarAlimento(A.ctx, { ...PAO, micros: 'calcio=1' }, deps))).toEqual({ geral: MSG_NUTRIENTES.desconhecido });
    const { id } = await criarAlimento(A.ctx, { ...PAO, nome: 'Pão com micros' }, deps);
    expect(await erros(editarAlimento(A.ctx, id, { ...PAO, micros: { sodio_mg: '-3' } }, deps))).toEqual({ 'micros.sodio_mg': MSG_NUTRIENTES.faixa });
  });

  it('alimento da USDA: fonte, selo, nome original; não editável; "Duplicar" copia micros e origem_food_id e avisa pela sigla', async () => {
    const A = await novoTenant(app.db);
    expect(await carregarAlimento(A.ctx, usda, app.db)).toMatchObject({
      fonte: 'usda', origem: 'USDA (EUA)', nomeOriginal: 'Amaranth grain, cooked', incompleto: true, micros: { calcio_mg: 47, vitamina_b12_mcg: 0 }, fonteOrigem: null,
    });
    expect(await erros(editarAlimento(A.ctx, usda, PAO, deps))).toEqual({ geral: MSG_ALIMENTO.taco });
    expect(await erros(excluirAlimento(A.ctx, usda, deps))).toEqual({ geral: MSG_ALIMENTO.taco });
    const copia = await duplicarComoMeu(A.ctx, usda, deps);
    expect(copia.incompleto).toBe(true);
    const d = await carregarAlimento(A.ctx, copia.id, app.db);
    expect(d).toMatchObject({ nome: 'Amaranto, cozido', fonte: 'propria', origem: 'Meu alimento', nomeOriginal: null, fonteOrigem: 'usda', porCem: { kcal: 102, fibraG: 0 } });
    expect(d?.micros).toEqual({ calcio_mg: 47, vitamina_b12_mcg: 0 });
    expect(MSG_ALIMENTO.incompleto(d!.fonteOrigem!)).toContain('A USDA não tem todos os valores');
    const [linha] = await withTenant(A.ctx, (tx) => tx.select({ origemFoodId: foods.origemFoodId, micros: foods.micros }).from(foods).where(eq(foods.id, copia.id)), app.db);
    expect(linha).toEqual({ origemFoodId: usda, micros: { calcio_mg: 47, vitamina_b12_mcg: 0, ferro_mg: null } });
    // a cópia da TACO também sabe a fonte de origem
    expect((await carregarAlimento(A.ctx, (await duplicarComoMeu(A.ctx, idTaco(3), deps)).id, app.db))?.fonteOrigem).toBe('taco');
  });
});

describe('alimento em uso (Review Focus 4)', () => {
  it('violação de FK sem nome de constraint (pg com constraint vazia) também vira "alimento em uso", não 500', async () => {
    const T = await novoTenant(app.db);
    const semNome = Object.assign(new Error('violação de FK'), { code: '23503', severity: 'ERROR' }); // pg sem `constraint`
    const db = { transaction: async () => Promise.reject(semNome) } as unknown as Db;
    expect(await erros(excluirAlimento(T.ctx, '00000000-0000-4000-8000-000000000001', { db }))).toEqual({ geral: MSG_ALIMENTO.emUso });
  });
});
