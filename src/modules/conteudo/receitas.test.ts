import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { excluirAlimento } from '@/modules/alimentos/alimentos';
import { MSG_ALIMENTO } from '@/modules/alimentos/alimentos-constantes';
import { MSG_PLANO } from '@/modules/plano-alimentar/constantes';
import { MSG_CONTEUDO, MSG_RECEITA } from './constantes';
import { ConteudoError } from './erros';
import { nutrientesPorPorcao } from './receita-calculo';
import { carregarReceitaDoPainel, listarReceitasPublicadas, salvarReceita } from './receitas';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

/** "Meu alimento" com valores redondos (por 100 g). */
async function meuAlimento(T: TenantDeTeste, kcal = 400): Promise<string> {
  const r = await withTenant(
    T.ctx,
    (tx) => tx.execute(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${T.tenantId}, 'Mistura de aveia', 'Miscelâneas', ${kcal}, 10, 50, 15, 5) returning id`),
    app.db,
  );
  return (r.rows[0] as { id: string }).id;
}
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConteudoError) return e.erros;
    throw e;
  }
  throw new Error('não falhou');
};

describe('receita (US-051, RN-11)', () => {
  it('2000 kcal de ingredientes, rendimento 1000 g, porção 250 g → 500 kcal por porção; regravar substitui os ingredientes', async () => {
    const T = await novoTenant(app.db);
    const food = await meuAlimento(T);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca de aveia', status: 'rascunho' });
    await salvarReceita(T.ctx, r.id, { rendimento: '1000', porcao: '250', tempo: '20', modo: 'Misture e asse.', ingredientes: [{ foodId: food, quantidadeG: '500', medida: '5 xícaras' }] }, { db: app.db });
    const lida = (await carregarReceitaDoPainel(T.ctx, r.id, app.db))!;
    expect(lida).toMatchObject({ rendimentoG: 1000, porcaoG: 250, tempoMin: 20, modoPreparo: 'Misture e asse.' });
    expect(lida.ingredientes).toEqual([{ foodId: food, nome: 'Mistura de aveia', origem: 'Meu alimento', porCem: { kcal: 400, proteinaG: 10, carboidratoG: 50, lipidioG: 15, fibraG: 5 }, quantidadeG: 500, medidaCaseiraTxt: '5 xícaras' }]);
    expect(nutrientesPorPorcao(lida.ingredientes, lida.rendimentoG, lida.porcaoG)!.kcal).toBe(500);
    await salvarReceita(T.ctx, r.id, { rendimento: '1000', porcao: '250,5', tempo: '', modo: '', ingredientes: [{ foodId: food, quantidadeG: '100' }] }, { db: app.db });
    expect(await carregarReceitaDoPainel(T.ctx, r.id, app.db)).toMatchObject({ porcaoG: 250.5, tempoMin: null, ingredientes: [{ quantidadeG: 100, medidaCaseiraTxt: null }] });
  });

  it('"Porção maior que rendimento": 1200 g de 1000 g → "A porção não pode ser maior que o rendimento"; e as outras validações', async () => {
    const T = await novoTenant(app.db);
    const food = await meuAlimento(T);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R', status: 'rascunho' });
    const um = [{ foodId: food, quantidadeG: '100' }];
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '1000', porcao: '1200', ingredientes: um }, { db: app.db }))).toEqual({ porcao: 'A porção não pode ser maior que o rendimento' });
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '0', porcao: '', tempo: '0', ingredientes: [] }, { db: app.db }))).toEqual({
      rendimento: MSG_RECEITA.rendimento,
      porcao: MSG_RECEITA.porcao,
      tempo: MSG_RECEITA.tempo,
      ingredientes: MSG_RECEITA.ingredientes,
    });
    // "0,04" arredonda para 0,0: mensagem do campo, nunca o CHECK do banco (500)
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '0,04', porcao: '0,04', ingredientes: um }, { db: app.db }))).toEqual({
      rendimento: MSG_RECEITA.rendimento,
      porcao: MSG_RECEITA.porcao,
    });
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '100', porcao: '50', ingredientes: [{ foodId: food, quantidadeG: '0' }, { foodId: 'x', quantidadeG: '10' }] }, { db: app.db }))).toEqual({
      'ingrediente:0:quantidade': MSG_PLANO.quantidade,
      'ingrediente:1:alimento': MSG_PLANO.alimento,
    });
    const muitos = Array.from({ length: 51 }, () => ({ foodId: food, quantidadeG: '10' }));
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '100', porcao: '50', ingredientes: muitos }, { db: app.db }))).toEqual({ ingredientes: MSG_RECEITA.ingredientesMax });
  });

  it('R6: NUL (\\0) no modo de preparo ou na medida caseira → "Formulário inválido.", nunca o 500 do Postgres', async () => {
    const T = await novoTenant(app.db);
    const food = await meuAlimento(T);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R', status: 'rascunho' });
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '100', porcao: '50', modo: 'Misture\0 e asse.', ingredientes: [{ foodId: food, quantidadeG: '10' }] }, { db: app.db }))).toEqual({ geral: MSG_CONTEUDO.formulario });
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '100', porcao: '50', ingredientes: [{ foodId: food, quantidadeG: '10', medida: '1\0 colher' }] }, { db: app.db }))).toEqual({ geral: MSG_CONTEUDO.formulario });
    expect(await carregarReceitaDoPainel(T.ctx, r.id, app.db)).toBeNull();
  });

  it('alimento de outro consultório (a RLS esconde) → "Alimento não encontrado."; conteúdo que não é receita → não encontrado', async () => {
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    const deU = await meuAlimento(U);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R', status: 'rascunho' });
    expect(await erros(salvarReceita(T.ctx, r.id, { rendimento: '100', porcao: '50', ingredientes: [{ foodId: deU, quantidadeG: '10' }] }, { db: app.db }))).toEqual({ 'ingrediente:0:alimento': MSG_PLANO.alimento });
    const o = await novoConteudo(app.db, T);
    // entrada VÁLIDA (com ingrediente do próprio consultório): `validarReceita` roda antes de conferir o tipo; com
    // `ingredientes: []` o erro seria "Conteúdo inválido" e o caso "não é receita" nunca seria exercitado
    const doT = await meuAlimento(T);
    await expect(salvarReceita(T.ctx, o.id, { rendimento: '100', porcao: '50', ingredientes: [{ foodId: doT, quantidadeG: '10' }] }, { db: app.db })).rejects.toThrow('Conteúdo não encontrado.');
  });

  it('D12: "Meu alimento" usado em receita não é excluído, com a mensagem nova', async () => {
    const T = await novoTenant(app.db);
    const food = await meuAlimento(T);
    const r = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'R', status: 'rascunho' });
    await salvarReceita(T.ctx, r.id, { rendimento: '100', porcao: '50', ingredientes: [{ foodId: food, quantidadeG: '10' }] }, { db: app.db });
    await expect(excluirAlimento(T.ctx, food, { db: app.db })).rejects.toMatchObject({ erros: { geral: MSG_ALIMENTO.emUso } });
    expect(MSG_ALIMENTO.emUso).toBe('Este alimento está em um plano ou receita e não pode ser excluído.');
  });

  it('listarReceitasPublicadas: só receitas publicadas, por título (o seletor do plano, US-054)', async () => {
    const T = await novoTenant(app.db);
    const b = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Bolo de banana' });
    const a = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Aveia overnight' });
    await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Rascunho', status: 'rascunho' });
    await novoConteudo(app.db, T, { titulo: 'Orientação' });
    expect(await listarReceitasPublicadas(T.ctx, app.db)).toEqual([{ id: a.id, titulo: 'Aveia overnight' }, { id: b.id, titulo: 'Bolo de banana' }]);
  });
});
