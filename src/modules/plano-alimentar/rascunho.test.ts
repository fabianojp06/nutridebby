import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog, mealItems, mealPlans, meals, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { carregarPlano } from './carregar';
import { MSG_PLANO } from './constantes';
import { ConflitoRevisaoError, PlanoError, PlanoNaoEncontradoError } from './erros';
import { copiarConteudo, criarRascunho, descartarRascunho, proximaVersao, salvarRascunho } from './rascunho';
import type { RascunhoEnviado } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PlanoError) return e.erros;
    throw e;
  }
  throw new Error('esperava PlanoError');
};

const COLHER = { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 };

/** Rascunho com Café (pão francês 50 g + tapioca como substituição) e Almoço (arroz: 4 colheres de sopa cheias). */
function conteudo(revisao: number, ids = { cafe: randomUUID(), almoco: randomUUID(), pao: randomUUID(), sub: randomUUID(), arroz: randomUUID() }): RascunhoEnviado {
  return {
    revisao,
    titulo: 'Plano de Ana',
    metaKcal: '2000',
    mostrarCalorias: false,
    orientacoes: 'Beber 2 litros de água por dia.',
    refeicoes: [
      { id: ids.cafe, nome: 'Café da manhã', horario: '07:30', observacao: '', itens: [
        { id: ids.pao, foodId: idTaco(53), quantidadeG: '50', medida: null, substituiItemId: null },
        { id: ids.sub, foodId: idTaco(533), quantidadeG: '100', medida: null, substituiItemId: ids.pao },
      ] },
      { id: ids.almoco, nome: 'Almoço', horario: '12:00', observacao: 'Prato colorido', itens: [
        { id: ids.arroz, foodId: idTaco(3), quantidadeG: '100', medida: COLHER, substituiItemId: null },
      ] },
    ],
  };
}

async function comRascunho(T: TenantDeTeste) {
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await criarRascunho(T.ctx, p.id, deps);
  return { p, id };
}

const auditDoPlano = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.entidade, 'plano_alimentar'))), app.db);

describe('rascunho do plano (US-022, D7, D11)', () => {
  it('criar: versão 1, título padrão; chamar de novo devolve o mesmo rascunho', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const a = await criarRascunho(T.ctx, p.id, deps);
    expect(a.criado).toBe(true);
    expect(await criarRascunho(T.ctx, p.id, deps)).toEqual({ id: a.id, criado: false });
    expect(await carregarPlano(T.ctx, a.id, app.db)).toMatchObject({ status: 'rascunho', versao: 1, revisao: 0, titulo: 'Plano alimentar', refeicoes: [] });
  });

  it('salvar grava refeições, itens, medida ("4 colheres de sopa cheias" = 100 g) e substituição; revisão sobe', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    expect(await salvarRascunho(T.ctx, id, conteudo(0), deps)).toEqual({ revisao: 1 });
    const pl = await carregarPlano(T.ctx, id, app.db);
    expect(pl).toMatchObject({ titulo: 'Plano de Ana', metaKcal: 2000, orientacoes: 'Beber 2 litros de água por dia.', revisao: 1 });
    expect(pl!.refeicoes.map((r) => [r.nome, r.horario, r.itens.length])).toEqual([['Café da manhã', '07:30', 2], ['Almoço', '12:00', 1]]);
    expect(pl!.refeicoes[1].itens[0]).toMatchObject({ nome: 'Arroz, tipo 1, cozido', origem: 'TACO', quantidadeG: 100, medidaCaseiraTxt: '4 colheres de sopa cheias', porCem: { kcal: 128 } });
    expect(pl!.refeicoes[0].itens[1].substituiItemId).toBe(pl!.refeicoes[0].itens[0].id);
  });

  it('salvar o mesmo conteúdo de novo não gera auditoria nova (só o que mudou vira audit_log)', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    const c = conteudo(0);
    await salvarRascunho(T.ctx, id, c, deps);
    const antes = (await auditDoPlano(T, p.id)).filter((a) => a.acao !== 'ler').length;
    await salvarRascunho(T.ctx, id, { ...c, revisao: 1 }, deps);
    const depois = await auditDoPlano(T, p.id);
    expect(depois.filter((a) => a.acao !== 'ler').length).toBe(antes + 1); // só o UPDATE do meal_plans (revisão)
    const c2 = { ...c, revisao: 2, refeicoes: [c.refeicoes[0], { ...c.refeicoes[1], itens: [{ ...c.refeicoes[1].itens[0], quantidadeG: '150', medida: null }] }] };
    await salvarRascunho(T.ctx, id, c2, deps);
    const novos = (await auditDoPlano(T, p.id)).filter((a) => a.acao === 'alterar').length - depois.filter((a) => a.acao === 'alterar').length;
    expect(novos).toBe(2); // o item do arroz e o meal_plans
  });

  it('quantidade digitada com 3 ou mais casas grava 2 casas, e salvar de novo o mesmo não regrava nem audita o item', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    const c = conteudo(0);
    const c1 = { ...c, refeicoes: [c.refeicoes[0], { ...c.refeicoes[1], itens: [{ ...c.refeicoes[1].itens[0], quantidadeG: '33.333', medida: null }] }] };
    await salvarRascunho(T.ctx, id, c1, deps);
    expect((await carregarPlano(T.ctx, id, app.db))!.refeicoes[1].itens[0].quantidadeG).toBe(33.33);
    const alterar = async () => (await auditDoPlano(T, p.id)).filter((a) => a.acao === 'alterar').length;
    const antes = await alterar();
    await salvarRascunho(T.ctx, id, { ...c1, revisao: 1 }, deps);
    expect(await alterar()).toBe(antes + 1); // só o meal_plans (revisão): o item não é regravado
  });

  it('Review Focus 1: revisão velha (outra aba) recebe conflito e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    await salvarRascunho(T.ctx, id, conteudo(0), deps);
    await expect(salvarRascunho(T.ctx, id, { ...conteudo(0), titulo: 'Outra aba' }, deps)).rejects.toBeInstanceOf(ConflitoRevisaoError);
    expect((await carregarPlano(T.ctx, id, app.db))?.titulo).toBe('Plano de Ana');
  });

  it('Review Focus 2: quantidade, meta, horário, nome e limites viram erro do campo, nunca gravação parcial', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    const c = conteudo(0);
    const arroz = c.refeicoes[1].itens[0];
    for (const q of ['abc', '0', '-10', '99999', '']) {
      const ruim = { ...c, refeicoes: [c.refeicoes[0], { ...c.refeicoes[1], itens: [{ ...arroz, medida: null, quantidadeG: q }] }] };
      expect(await erros(salvarRascunho(T.ctx, id, ruim, deps)), q).toEqual({ [`item:${arroz.id}:quantidadeG`]: MSG_PLANO.quantidade });
    }
    expect(await erros(salvarRascunho(T.ctx, id, { ...c, metaKcal: '100', titulo: ' ', refeicoes: [{ ...c.refeicoes[0], horario: '25:00', nome: '' }] }, deps))).toEqual({
      metaKcal: MSG_PLANO.meta,
      titulo: MSG_PLANO.titulo,
      [`refeicao:${c.refeicoes[0].id}:horario`]: MSG_PLANO.horario,
      [`refeicao:${c.refeicoes[0].id}:nome`]: MSG_PLANO.refeicaoNome,
    });
    const muitas = Array.from({ length: 16 }, () => ({ id: randomUUID(), nome: 'R', horario: '', observacao: '', itens: [] }));
    expect(await erros(salvarRascunho(T.ctx, id, { ...c, refeicoes: muitas }, deps))).toEqual({ geral: MSG_PLANO.limite });
    expect(await erros(salvarRascunho(T.ctx, id, { foo: 1 }, deps))).toHaveProperty('geral');
    expect((await carregarPlano(T.ctx, id, app.db))?.refeicoes).toEqual([]);
  });

  it('substituição só aponta para principal da mesma refeição; apagar o principal leva as substituições', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    const c = conteudo(0);
    const [cafe, almoco] = c.refeicoes;
    const outraRefeicao = { ...c, refeicoes: [cafe, { ...almoco, itens: [...almoco.itens, { ...cafe.itens[1], id: randomUUID(), substituiItemId: cafe.itens[0].id }] }] };
    const idErrado = outraRefeicao.refeicoes[1].itens[1].id;
    expect(await erros(salvarRascunho(T.ctx, id, outraRefeicao, deps))).toEqual({ [`item:${idErrado}:substituiItemId`]: MSG_PLANO.substituicao });
    const deSubstituicao = { ...c, refeicoes: [{ ...cafe, itens: [...cafe.itens, { ...cafe.itens[1], id: randomUUID(), substituiItemId: cafe.itens[1].id }] }, almoco] };
    expect(Object.values(await erros(salvarRascunho(T.ctx, id, deSubstituicao, deps)))).toEqual([MSG_PLANO.substituicao]);
    await salvarRascunho(T.ctx, id, c, deps);
    await salvarRascunho(T.ctx, id, { ...c, revisao: 1, refeicoes: [{ ...cafe, itens: [] }, almoco] }, deps);
    expect((await carregarPlano(T.ctx, id, app.db))!.refeicoes[0].itens).toEqual([]);
  });

  it('principal que sai não leva embora a substituição que o editor manteve (promovida a principal ou ligada a outro)', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    const c = conteudo(0);
    await salvarRascunho(T.ctx, id, c, deps);
    const [cafe, almoco] = c.refeicoes;
    const [pao, tapioca] = cafe.itens;
    // o pão sai e a tapioca vira item principal
    await salvarRascunho(T.ctx, id, { ...c, revisao: 1, refeicoes: [{ ...cafe, itens: [{ ...tapioca, substituiItemId: null }] }, almoco] }, deps);
    let pl = await carregarPlano(T.ctx, id, app.db);
    expect(pl!.refeicoes[0].itens.map((i) => [i.id, i.substituiItemId])).toEqual([[tapioca.id, null]]);
    // o pão volta como principal novo e a tapioca passa a ser a substituição dele; depois outro principal toma o lugar do pão
    const ovo = { id: randomUUID(), foodId: idTaco(3), quantidadeG: '60', medida: null, substituiItemId: null };
    await salvarRascunho(T.ctx, id, { ...c, revisao: 2, refeicoes: [{ ...cafe, itens: [pao, { ...tapioca, substituiItemId: pao.id }] }, almoco] }, deps);
    await salvarRascunho(T.ctx, id, { ...c, revisao: 3, refeicoes: [{ ...cafe, itens: [ovo, { ...tapioca, substituiItemId: ovo.id }] }, almoco] }, deps);
    pl = await carregarPlano(T.ctx, id, app.db);
    expect(pl!.refeicoes[0].itens.map((i) => [i.id, i.substituiItemId])).toEqual([[ovo.id, null], [tapioca.id, ovo.id]]);
  });

  it('D12: a sessão de paciente nunca vê o rascunho (plano, refeições e itens), só o publicado', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    await salvarRascunho(T.ctx, id, conteudo(0), deps);
    const comoPaciente = <R,>(fn: Parameters<typeof withTenant<R>>[1]) => withTenant({ tenantId: T.tenantId, role: 'paciente', patientId: p.id }, fn, app.db);
    const contar = () =>
      comoPaciente(async (tx) => {
        const n = async (t: string) => Number((await tx.execute(sql`select count(*)::int as n from ${sql.identifier(t)}`)).rows[0].n);
        return [await n('meal_plans'), await n('meals'), await n('meal_items')];
      });
    expect(await contar()).toEqual([0, 0, 0]);
    await withTenant(T.ctx, (tx) => tx.update(mealPlans).set({ status: 'publicado', publicadoEm: new Date() }).where(eq(mealPlans.id, id)), app.db);
    expect(await contar()).toEqual([1, 2, 3]);
    await withTenant(T.ctx, (tx) => tx.update(mealPlans).set({ status: 'arquivado' }).where(eq(mealPlans.id, id)), app.db);
    expect(await contar()).toEqual([1, 2, 3]);
  });

  it('copiarConteudo (modelos e "Editar"): ids novos, substituição religada, valores atuais; proximaVersao conta o rascunho', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    const c = conteudo(0);
    await salvarRascunho(T.ctx, id, c, deps);
    const modeloId = await withTenant(
      T.ctx,
      async (tx) => {
        expect(await proximaVersao(tx, p.id)).toBe(2);
        const [m] = await tx.insert(mealPlans).values({ tenantId: T.tenantId, patientId: null, isTemplate: true, titulo: 'Modelo' }).returning({ id: mealPlans.id });
        await copiarConteudo(tx, id, m.id);
        return m.id;
      },
      app.db,
    );
    const modelo = await carregarPlano(T.ctx, modeloId, app.db);
    const origem = await carregarPlano(T.ctx, id, app.db);
    expect(modelo!.refeicoes.map((r) => [r.nome, r.horario, r.observacao, r.itens.length])).toEqual(origem!.refeicoes.map((r) => [r.nome, r.horario, r.observacao, r.itens.length]));
    const ids = (pl: typeof modelo) => pl!.refeicoes.flatMap((r) => [r.id, ...r.itens.map((i) => i.id)]);
    expect(ids(modelo).filter((x) => ids(origem).includes(x))).toEqual([]);
    const [pao, tapioca] = modelo!.refeicoes[0].itens;
    expect(tapioca.substituiItemId).toBe(pao.id);
    expect(modelo!.refeicoes[1].itens[0]).toMatchObject({ quantidadeG: 100, medidaCaseiraTxt: '4 colheres de sopa cheias', medida: COLHER });
  });

  it('copiarConteudo: o paciente das refeições e itens copiados vem do plano de destino no banco', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    await salvarRascunho(T.ctx, id, conteudo(0), deps);
    const outro = await novoPaciente(app.db, T.ctx);
    const pacientes = await withTenant(
      T.ctx,
      async (tx) => {
        const [m] = await tx.insert(mealPlans).values({ tenantId: T.tenantId, isTemplate: true, titulo: 'Modelo' }).returning({ id: mealPlans.id });
        const [d] = await tx.insert(mealPlans).values({ tenantId: T.tenantId, patientId: outro.id, titulo: 'Plano do outro', versao: 1 }).returning({ id: mealPlans.id });
        await copiarConteudo(tx, id, m.id);
        await copiarConteudo(tx, id, d.id);
        const de = async (planId: string) => {
          const rs = await tx.select({ x: meals.patientId }).from(meals).where(eq(meals.planId, planId));
          const its = await tx.select({ x: mealItems.patientId }).from(mealItems).where(eq(mealItems.planId, planId));
          expect(rs.length * its.length).toBeGreaterThan(0);
          return [...new Set([...rs, ...its].map((r) => r.x))];
        };
        return { modelo: await de(m.id), outro: await de(d.id) };
      },
      app.db,
    );
    expect(pacientes).toEqual({ modelo: [null], outro: [outro.id] });
  });

  it('mover item (com a sua substituição) para outra refeição', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    const c = conteudo(0);
    await salvarRascunho(T.ctx, id, c, deps);
    const [cafe, almoco] = c.refeicoes;
    await salvarRascunho(T.ctx, id, { ...c, revisao: 1, refeicoes: [{ ...cafe, itens: [] }, { ...almoco, itens: [...almoco.itens, ...cafe.itens] }] }, deps);
    const pl = await carregarPlano(T.ctx, id, app.db);
    expect(pl!.refeicoes[1].itens.map((i) => i.id)).toEqual([almoco.itens[0].id, cafe.itens[0].id, cafe.itens[1].id]);
    expect(pl!.refeicoes[1].itens[2].substituiItemId).toBe(cafe.itens[0].id);
  });

  it('alimento invisível (de outro tenant) é recusado; id de refeição de outro plano é conflito', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const [deB] = await withTenant(
      B.ctx,
      (tx) => tx.execute(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${B.tenantId}, 'Só de B', 'Miscelâneas', 1, 1, 1, 1, 1) returning id`),
      app.db,
    ).then((r) => r.rows as { id: string }[]);
    const { id } = await comRascunho(A);
    const c = conteudo(0);
    const item = c.refeicoes[1].itens[0];
    expect(await erros(salvarRascunho(A.ctx, id, { ...c, refeicoes: [c.refeicoes[0], { ...c.refeicoes[1], itens: [{ ...item, foodId: deB.id }] }] }, deps))).toEqual({
      [`item:${item.id}:foodId`]: MSG_PLANO.alimento,
    });
    const outro = await comRascunho(A);
    await salvarRascunho(A.ctx, outro.id, c, deps);
    await expect(salvarRascunho(A.ctx, id, c, deps)).rejects.toBeInstanceOf(ConflitoRevisaoError); // mesmos ids de refeição/itens
  });

  it('outro tenant não acha o plano; paciente bloqueado não edita; descartar apaga o rascunho', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { p, id } = await comRascunho(A);
    await expect(salvarRascunho(B.ctx, id, conteudo(0), deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    expect(await carregarPlano(B.ctx, id, app.db)).toBeNull();
    await expect(criarRascunho(B.ctx, p.id, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    await expect(salvarRascunho(A.ctx, id, conteudo(0), deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'ativo' }).where(eq(patients.id, p.id)), app.db);
    await descartarRascunho(A.ctx, p.id, id, deps);
    expect(await carregarPlano(A.ctx, id, app.db)).toBeNull();
  });

  it('descartar confere o paciente da URL: plano de outro paciente não é apagado; paciente bloqueado não descarta', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    const outro = await novoPaciente(app.db, T.ctx);
    await expect(descartarRascunho(T.ctx, outro.id, id, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    expect(await carregarPlano(T.ctx, id, app.db)).not.toBeNull();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    await expect(descartarRascunho(T.ctx, p.id, id, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await carregarPlano(T.ctx, id, app.db)).not.toBeNull();
  });

  it('carregar plano de paciente registra leitura auditada (RNF-08)', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    await carregarPlano(T.ctx, id, app.db);
    expect((await auditDoPlano(T, p.id)).some((a) => a.acao === 'ler' && a.entidadeId === id)).toBe(true);
  });
});
