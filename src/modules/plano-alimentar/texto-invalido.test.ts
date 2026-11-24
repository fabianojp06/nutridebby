import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { espiarErrosDoBanco, INVALIDOS, limpo, semErroDoBanco, sujo } from '../../../test/erros-do-banco';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { mealItems, mealPlans, meals } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { MSG_PLANO } from './constantes';
import { PlanoError } from './erros';
import { criarRascunho, salvarRascunho } from './rascunho';

/**
 * SUS-110 (regra 3): o NUL e o surrogate UTF-16 sem par no rascunho do plano alimentar (título, orientações, nome e
 * observação da refeição, nome e plural da medida caseira) não chegam ao banco — o Postgres recusaria (22021 no text,
 * 22P05/22P02 no jsonb `meal_items.medida`) com um trecho do plano no log e no erro do app. O espião anota o SQLSTATE de
 * todo erro do banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const errosDoBanco = espiarErrosDoBanco(app.pool);
afterAll(() => app.pool.end());
const deps = { db: app.db };

async function rascunho() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await criarRascunho(T.ctx, p.id, deps);
  return { T, id };
}
const corpo = (ch: string, horario = '12:00') => ({
  revisao: 0,
  envio: randomUUID(),
  titulo: sujo('Plano', ch),
  metaKcal: '',
  mostrarCalorias: false,
  orientacoes: sujo('Beber água', ch),
  refeicoes: [
    {
      id: randomUUID(),
      nome: sujo('Almoço', ch),
      horario,
      observacao: sujo('Prato colorido', ch),
      itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: { nome: sujo('colher', ch), plural: sujo('colheres', ch), gramas: 25, qtd: 4 }, substituiItemId: null }],
    },
  ],
});

describe('SUS-110: texto com NUL ou surrogate sem par no plano alimentar', () => {
  it.each(INVALIDOS)('rascunho: título, orientações, refeição (nome, observação) e medida caseira com %s vão limpos', async (_nome, ch) => {
    const { T, id } = await rascunho();
    await semErroDoBanco(errosDoBanco, () => salvarRascunho(T.ctx, id, corpo(ch), deps));
    const [pl] = await withTenant(T.ctx, (tx) => tx.select({ titulo: mealPlans.titulo, orientacoes: mealPlans.orientacoes }).from(mealPlans).where(eq(mealPlans.id, id)), app.db);
    expect(pl).toEqual({ titulo: limpo('Plano'), orientacoes: limpo('Beber água') });
    const [m] = await withTenant(T.ctx, (tx) => tx.select({ nome: meals.nome, observacao: meals.observacao }).from(meals).where(eq(meals.planId, id)), app.db);
    expect(m).toEqual({ nome: limpo('Almoço'), observacao: limpo('Prato colorido') });
    const [i] = await withTenant(T.ctx, (tx) => tx.select({ medida: mealItems.medida, txt: mealItems.medidaCaseiraTxt }).from(mealItems).where(eq(mealItems.planId, id)), app.db);
    expect(i.medida).toMatchObject({ nome: limpo('colher'), plural: limpo('colheres') });
    expect(i.txt).toContain(limpo('colheres'));
  });

  it('o horário continua conferido pelo padrão HH:MM: com NUL, a mensagem do campo e nenhum erro do banco', async () => {
    const { T, id } = await rascunho();
    errosDoBanco.length = 0;
    const e = await salvarRascunho(T.ctx, id, corpo('', '12:00\u0000'), deps).catch((x: unknown) => x);
    expect(errosDoBanco).toEqual([]);
    expect(e instanceof PlanoError && Object.values(e.erros)).toEqual([MSG_PLANO.horario]);
  });
});
