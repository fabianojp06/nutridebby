import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { MSG_ALIMENTO } from './alimentos-constantes';
import { AlimentoError, carregarAlimento, criarAlimento, duplicarComoMeu, editarAlimento, excluirAlimento } from './alimentos';
import { buscarAlimentos } from './busca';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
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
    expect(await erros(criarAlimento(A.ctx, { ...PAO, nome: ' x ', grupo: 'Doces', kcal: '901', proteinaG: '-1', carboidratoG: 'abc', lipidioG: '', fibraG: '100,5' }, deps))).toEqual({
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
