import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { apagarPublicos, inserirPublicos } from '../../../test/alimentos-publicos';
import { novoConteudo } from '../../../test/conteudos';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog, contents, mealItems, mealPlans, meals, patients, planoConteudos, planoListasSubstituicao } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { carregarPacienteParaEscrita, PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { carregarPlano } from './carregar';
import { MAX_ITENS, MAX_REFEICOES, MSG_DIAS, MSG_PLANO, MSG_TEXTO_LIVRE } from './constantes';
import { ConflitoRevisaoError, PlanoError, PlanoNaoEncontradoError } from './erros';
import { copiarConteudo, criarRascunho, criarRascunhoTx, descartarRascunho, gravarConteudoRascunhoTx, proximaVersao, salvarRascunho } from './rascunho';
import type { CorpoSalvamento } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
let usda: string;
beforeAll(async () => {
  [usda] = await inserirPublicos(owner.pool, [{ nome: 'Couve-de-bruxelas, cozida', nomeOriginal: 'Brussels sprouts, cooked, boiled', grupo: 'Verduras, hortaliças e derivados', kcal: 36, proteinaG: 2.6, carboidratoG: 7.1, lipidioG: 0.5, fibraG: 2.6 }]);
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
    if (e instanceof PlanoError) return e.erros;
    throw e;
  }
  throw new Error('esperava PlanoError');
};

const COLHER = { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 };

/** Rascunho com Café (pão francês 50 g + tapioca como substituição) e Almoço (arroz: 4 colheres de sopa cheias). */
function conteudo(revisao: number, ids = { cafe: randomUUID(), almoco: randomUUID(), pao: randomUUID(), sub: randomUUID(), arroz: randomUUID() }): CorpoSalvamento {
  return {
    revisao,
    envio: randomUUID(),
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
    expect(await carregarPlano(T.ctx, a.id, app.db)).toMatchObject({ status: 'rascunho', versao: 1, revisao: 0, titulo: 'Plano alimentar', refeicoes: [], iaOrigemEm: null });
  });

  it('criarRascunhoTx (Plano 14B, RN-122): rascunho com a versão seguinte e a marca da IA; criarRascunho continua devolvendo o existente (D11)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const agora = new Date('2026-10-14T12:00:00Z');
    const id = await withTenant(
      T.ctx,
      async (tx) => {
        await carregarPacienteParaEscrita(tx, p.id);
        return criarRascunhoTx(tx, T.tenantId, p.id, { titulo: 'Plano', metaKcal: 1800, orientacoes: 'x', iaOrigemEm: agora });
      },
      app.db,
    );
    expect(await carregarPlano(T.ctx, id, app.db)).toMatchObject({ status: 'rascunho', versao: 1, titulo: 'Plano', metaKcal: 1800, orientacoes: 'x', iaOrigemEm: agora.toISOString() });
    expect(await criarRascunho(T.ctx, p.id, deps)).toEqual({ id, criado: false });
    // sem opções: os padrões de criarRascunho, sem a marca
    const outro = await novoPaciente(app.db, T.ctx);
    const semMarca = await withTenant(T.ctx, (tx) => criarRascunhoTx(tx, T.tenantId, outro.id), app.db);
    expect(await carregarPlano(T.ctx, semMarca, app.db)).toMatchObject({ titulo: 'Plano alimentar', metaKcal: null, orientacoes: '', iaOrigemEm: null });
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

  it('RN-230: no rascunho, a fonte e o selo do item saem de foods.fonte (USDA, TACO), nunca de tenant_id', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    const c = conteudo(0);
    c.refeicoes[1].itens.push({ id: randomUUID(), foodId: usda, quantidadeG: '80', medida: null, substituiItemId: null });
    await salvarRascunho(T.ctx, id, c, deps);
    try {
      const itens = (await carregarPlano(T.ctx, id, app.db))!.refeicoes[1].itens;
      expect(itens.map((i) => [i.nome, i.fonte, i.origem])).toEqual([
        ['Arroz, tipo 1, cozido', 'taco', 'TACO'],
        ['Couve-de-bruxelas, cozida', 'usda', 'USDA (EUA)'],
      ]);
    } finally {
      await descartarRascunho(T.ctx, p.id, id, deps); // a FK RESTRICT de meal_items prenderia a linha pública de teste
    }
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

  describe('envios sem resposta confirmada (D7, chaves de idempotência em enviosIncertos)', () => {
    // a tela está na revisão 0 o tempo todo: nenhuma resposta chegou
    const plano = async (T: TenantDeTeste, id: string) => (await carregarPlano(T.ctx, id, app.db))!;

    it('A grava e perde a resposta, B grava e perde, C (com A e B na lista) é aceito', async () => {
      const T = await novoTenant(app.db);
      const { id } = await comRascunho(T);
      const [a, b] = [randomUUID(), randomUUID()];
      expect(await salvarRascunho(T.ctx, id, { ...conteudo(0), envio: a }, deps)).toEqual({ revisao: 1 });
      expect(await salvarRascunho(T.ctx, id, { ...conteudo(0), envio: b, enviosIncertos: [a] }, deps)).toEqual({ revisao: 2 });
      expect(await salvarRascunho(T.ctx, id, { ...conteudo(0), enviosIncertos: [a, b], titulo: 'C' }, deps)).toEqual({ revisao: 3 });
      expect(await plano(T, id)).toMatchObject({ titulo: 'C', revisao: 3 });
    });

    it('A não grava, B grava e perde a resposta, C (com A e B na lista) é aceito', async () => {
      const T = await novoTenant(app.db);
      const { id } = await comRascunho(T);
      const [a, b] = [randomUUID(), randomUUID()]; // A nem chegou ao servidor
      expect(await salvarRascunho(T.ctx, id, { ...conteudo(0), envio: b, enviosIncertos: [a] }, deps)).toEqual({ revisao: 1 });
      expect(await salvarRascunho(T.ctx, id, { ...conteudo(0), enviosIncertos: [a, b], titulo: 'C' }, deps)).toEqual({ revisao: 2 });
      expect(await plano(T, id)).toMatchObject({ titulo: 'C', revisao: 2 });
    });

    it('A grava e perde a resposta, B nem chega, C (com A e B na lista) é aceito', async () => {
      const T = await novoTenant(app.db);
      const { id } = await comRascunho(T);
      const [a, b] = [randomUUID(), randomUUID()];
      await salvarRascunho(T.ctx, id, { ...conteudo(0), envio: a }, deps);
      expect(await salvarRascunho(T.ctx, id, { ...conteudo(0), enviosIncertos: [a, b], titulo: 'C' }, deps)).toEqual({ revisao: 2 });
      expect(await plano(T, id)).toMatchObject({ titulo: 'C', revisao: 2 });
    });

    it('um 422 no meio não resolve a incerteza: A grava e perde a resposta, B é recusado (422), C só passa com A na lista', async () => {
      const T = await novoTenant(app.db);
      const { id } = await comRascunho(T);
      const a = randomUUID();
      await salvarRascunho(T.ctx, id, { ...conteudo(0), envio: a }, deps);
      expect(await erros(salvarRascunho(T.ctx, id, { ...conteudo(0), enviosIncertos: [a], titulo: '' }, deps))).toEqual({ titulo: MSG_PLANO.titulo }); // recusado antes de ler o banco
      await expect(salvarRascunho(T.ctx, id, { ...conteudo(0), titulo: 'C' }, deps)).rejects.toBeInstanceOf(ConflitoRevisaoError); // lista zerada no 422: falso conflito
      expect(await salvarRascunho(T.ctx, id, { ...conteudo(0), enviosIncertos: [a], titulo: 'C' }, deps)).toEqual({ revisao: 2 });
    });

    it('outra aba grava no meio: conflito, mesmo com o nosso envio gravado antes na lista', async () => {
      const T = await novoTenant(app.db);
      const { id } = await comRascunho(T);
      const a = randomUUID();
      await salvarRascunho(T.ctx, id, { ...conteudo(0), envio: a }, deps); // nosso, resposta perdida
      await salvarRascunho(T.ctx, id, { ...conteudo(1), titulo: 'Outra aba' }, deps); // outra aba, já na revisão 1
      await expect(salvarRascunho(T.ctx, id, { ...conteudo(0), enviosIncertos: [a], titulo: 'C' }, deps)).rejects.toBeInstanceOf(ConflitoRevisaoError);
      expect(await plano(T, id)).toMatchObject({ titulo: 'Outra aba', revisao: 2 });
    });

    it('lista sem o último envio gravado (ou sem lista): conflito, nada gravado', async () => {
      const T = await novoTenant(app.db);
      const { id } = await comRascunho(T);
      await salvarRascunho(T.ctx, id, conteudo(0), deps);
      for (const enviosIncertos of [[randomUUID(), randomUUID()], [], undefined])
        await expect(salvarRascunho(T.ctx, id, { ...conteudo(0), enviosIncertos, titulo: 'Aba velha' }, deps), String(enviosIncertos)).rejects.toBeInstanceOf(ConflitoRevisaoError);
      expect(await plano(T, id)).toMatchObject({ titulo: 'Plano de Ana', revisao: 1 });
    });

    it('envio é obrigatório; as chaves são uuid e a lista tem no máximo 20', async () => {
      const T = await novoTenant(app.db);
      const { id } = await comRascunho(T);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { envio, ...semEnvio } = conteudo(0);
      for (const ruim of [semEnvio, { ...conteudo(0), envio: 'abc' }, { ...conteudo(0), enviosIncertos: ['abc'] }, { ...conteudo(0), enviosIncertos: Array.from({ length: 21 }, () => randomUUID()) }])
        expect(await erros(salvarRascunho(T.ctx, id, ruim, deps))).toEqual({ geral: MSG_PLANO.invalido });
      expect(await salvarRascunho(T.ctx, id, { ...conteudo(0), enviosIncertos: Array.from({ length: 20 }, () => randomUUID()) }, deps)).toEqual({ revisao: 1 });
    });
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
    const muitas = Array.from({ length: 51 }, () => ({ id: randomUUID(), nome: 'R', horario: '', observacao: '', itens: [] }));
    expect(await erros(salvarRascunho(T.ctx, id, { ...c, refeicoes: muitas }, deps))).toEqual({ geral: MSG_PLANO.limite });
    expect(MSG_PLANO.limite).toBe('O plano pode ter até 50 refeições e 400 itens.');
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
    const comoPaciente = <R,>(fn: Parameters<typeof withTenant<R>>[1]) => withTenant({ tenantId: T.tenantId, role: 'paciente', patientId: p.id, actorUserId: randomUUID() }, fn, app.db);
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

  it('gravarConteudoRascunhoTx (Plano 14B): refeições e itens sugeridos num modelo novo; alimento que sumiu sai e é contado', async () => {
    const T = await novoTenant(app.db);
    const sumiu = randomUUID(); // id que não existe (ou de outro consultório): invisível ao tenant
    const r = await withTenant(
      T.ctx,
      async (tx) => {
        const [m] = await tx.insert(mealPlans).values({ tenantId: T.tenantId, isTemplate: true, titulo: 'Modelo' }).returning({ id: mealPlans.id });
        const g = await gravarConteudoRascunhoTx(tx, T.tenantId, null, m.id, [
          { nome: 'Café da manhã', horario: '07:30', itens: [
            { foodId: idTaco(53), quantidadeG: 50, medida: null, substitui: null },
            { foodId: sumiu, quantidadeG: 30, medida: null, substitui: null },
            { foodId: idTaco(533), quantidadeG: 100, medida: null, substitui: 0 },
            { foodId: idTaco(3), quantidadeG: 40, medida: null, substitui: 1 }, // a substituição do que sumiu também sai
          ] },
          { nome: 'Lanche', horario: '15:00', itens: [{ foodId: sumiu, quantidadeG: 30, medida: null, substitui: null }] },
          { nome: 'Almoço', horario: '12:00', itens: [{ foodId: idTaco(3), quantidadeG: 100, medida: COLHER, substitui: null }] },
        ]);
        return { ...g, id: m.id };
      },
      app.db,
    );
    expect(r).toMatchObject({ itens: 3, foraDoCatalogo: 3 });
    const modelo = await carregarPlano(T.ctx, r.id, app.db);
    expect(modelo!.refeicoes.map((x) => x.nome)).toEqual(['Café da manhã', 'Almoço']); // a refeição só com o que sumiu não é criada
    const [pao, tapioca] = modelo!.refeicoes[0].itens;
    expect(pao).toMatchObject({ foodId: idTaco(53), substituiItemId: null });
    expect(tapioca).toMatchObject({ foodId: idTaco(533), substituiItemId: pao.id });
    expect(modelo!.refeicoes[1].itens[0]).toMatchObject({ quantidadeG: 100, medidaCaseiraTxt: '4 colheres de sopa cheias', medida: COLHER });
    const linhas = await withTenant(T.ctx, (tx) => tx.select({ x: mealItems.patientId }).from(mealItems).where(eq(mealItems.planId, r.id)), app.db);
    expect(linhas.every((l) => l.x === null)).toBe(true);
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

describe('Plano 19 — salvamento com modo, dias, texto livre e limites (RN-243, RN-244, RN-246, RN-249)', () => {
  const refeicao = (o: Partial<CorpoSalvamento['refeicoes'][number]> = {}): CorpoSalvamento['refeicoes'][number] => ({
    id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [], ...o,
  });
  const livre = (revisao: number, refeicoes: CorpoSalvamento['refeicoes'], extra: Partial<CorpoSalvamento> = {}): CorpoSalvamento => ({
    revisao, envio: randomUUID(), titulo: 'Plano em texto', metaKcal: '', mostrarCalorias: false, orientacoes: '', modo: 'livre', refeicoes, ...extra,
  });
  const linhasDasRefeicoes = (T: TenantDeTeste, planId: string) =>
    withTenant(T.ctx, (tx) => tx.select({ id: meals.id, dias: meals.diasSemana, texto: meals.descricaoLivre }).from(meals).where(eq(meals.planId, planId)).orderBy(meals.ordem), app.db);
  const cabecalho = async (T: TenantDeTeste, planId: string) =>
    (await withTenant(T.ctx, (tx) => tx.select({ modo: mealPlans.modo, macros: mealPlans.macrosPrescritos }).from(mealPlans).where(eq(mealPlans.id, planId)), app.db))[0];

  it('RN-249: 50 refeições e 400 itens salvam; 51 refeições ou 401 itens são recusados com "O plano pode ter até 50 refeições e 400 itens."', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    expect([MAX_REFEICOES, MAX_ITENS]).toEqual([50, 400]);
    // 50 refeições com 8 itens cada = 400 itens
    const cheio = Array.from({ length: 50 }, (_, k) =>
      refeicao({ nome: `R${k}`, itens: Array.from({ length: 8 }, () => ({ id: randomUUID(), foodId: idTaco(3), quantidadeG: '10', medida: null, substituiItemId: null })) }),
    );
    const c = { ...conteudo(0), refeicoes: cheio };
    expect(await salvarRascunho(T.ctx, id, c, deps)).toEqual({ revisao: 1 });
    expect((await carregarPlano(T.ctx, id, app.db))!.refeicoes).toHaveLength(50);
    const umItemAMais = { ...c, revisao: 1, refeicoes: [...cheio.slice(0, 49), { ...cheio[49], itens: [...cheio[49].itens, { id: randomUUID(), foodId: idTaco(3), quantidadeG: '10', medida: null, substituiItemId: null }] }] };
    expect(await erros(salvarRascunho(T.ctx, id, umItemAMais, deps))).toEqual({ geral: 'O plano pode ter até 50 refeições e 400 itens.' });
    expect(await erros(salvarRascunho(T.ctx, id, { ...c, revisao: 1, refeicoes: [...cheio, refeicao()] }, deps))).toEqual({ geral: 'O plano pode ter até 50 refeições e 400 itens.' });
  });

  it('modo livre: grava o texto de cada refeição, os dias em ordem e a distribuição; o calculado nunca grava texto nem distribuição (RN-243)', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    const semana = refeicao({ nome: 'Almoço', descricaoLivre: '  Arroz, feijão e salada.  ', diasSemana: [5, 1, 2, 3, 4] });
    const fds = refeicao({ nome: 'Almoço', horario: '13:00', descricaoLivre: '', diasSemana: [6, 0] });
    await salvarRascunho(T.ctx, id, livre(0, [semana, fds], { macrosPrescritos: { proteina: '20', carboidrato: 50, lipidio: '30' } }), deps);
    expect(await cabecalho(T, id)).toEqual({ modo: 'livre', macros: { proteina: 20, carboidrato: 50, lipidio: 30 } });
    expect(await linhasDasRefeicoes(T, id)).toEqual([
      { id: semana.id, dias: [1, 2, 3, 4, 5], texto: 'Arroz, feijão e salada.' },
      { id: fds.id, dias: [0, 6], texto: null }, // o rascunho aceita a refeição sem texto (a publicação, não)
    ]);
    expect(await carregarPlano(T.ctx, id, app.db)).toMatchObject({
      modo: 'livre', macrosPrescritos: { proteina: 20, carboidrato: 50, lipidio: 30 },
      refeicoes: [{ diasSemana: [1, 2, 3, 4, 5], descricaoLivre: 'Arroz, feijão e salada.' }, { diasSemana: [0, 6], descricaoLivre: null }],
    });
    // livre → calculado: o texto e a distribuição saem, mesmo se o corpo ainda os mandar
    await salvarRascunho(T.ctx, id, livre(1, [semana, fds], { modo: 'calculado', macrosPrescritos: { proteina: 20, carboidrato: 50, lipidio: 30 } }), deps);
    expect(await cabecalho(T, id)).toEqual({ modo: 'calculado', macros: null });
    expect((await linhasDasRefeicoes(T, id)).map((r) => r.texto)).toEqual([null, null]);
  });

  it('o editor de antes do Plano 19 (sem modo, dias e texto no corpo) não apaga o que está gravado; refeição nova nasce com os 7 dias', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    const almoco = refeicao({ descricaoLivre: 'Prato feito', diasSemana: [1, 2, 3, 4, 5] });
    await salvarRascunho(T.ctx, id, livre(0, [almoco], { macrosPrescritos: { proteina: 25, carboidrato: 45, lipidio: 30 } }), deps);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { descricaoLivre, diasSemana, ...antigo } = almoco;
    const nova = refeicao({ nome: 'Ceia', horario: '21:00' });
    await salvarRascunho(T.ctx, id, { revisao: 1, envio: randomUUID(), titulo: 'Plano em texto', metaKcal: '', mostrarCalorias: false, orientacoes: '', refeicoes: [antigo, nova] }, deps);
    expect(await cabecalho(T, id)).toEqual({ modo: 'livre', macros: { proteina: 25, carboidrato: 45, lipidio: 30 } });
    expect(await linhasDasRefeicoes(T, id)).toEqual([
      { id: almoco.id, dias: [1, 2, 3, 4, 5], texto: 'Prato feito' },
      { id: nova.id, dias: [0, 1, 2, 3, 4, 5, 6], texto: null },
    ]);
  });

  it('erros no campo, antes do banco: distribuição que não soma 100%, dias vazios, texto longo; modo livre com alimentos e dias fora do formato são recusados', async () => {
    const T = await novoTenant(app.db);
    const { id } = await comRascunho(T);
    const r = refeicao({ descricaoLivre: 'x' });
    for (const macros of [{ proteina: 20, carboidrato: 50, lipidio: 20 }, { proteina: '20,5', carboidrato: '49,5', lipidio: 30 }, { proteina: 120, carboidrato: -20, lipidio: 0 }, { proteina: '', carboidrato: 50, lipidio: 50 }])
      expect(await erros(salvarRascunho(T.ctx, id, livre(0, [r], { macrosPrescritos: macros }), deps)), JSON.stringify(macros)).toEqual({
        macrosPrescritos: 'A soma de proteína, carboidrato e lipídio precisa dar 100%.',
      });
    expect(MSG_TEXTO_LIVRE.macros).toBe('A soma de proteína, carboidrato e lipídio precisa dar 100%.');
    expect(await erros(salvarRascunho(T.ctx, id, livre(0, [{ ...r, diasSemana: [] }]), deps))).toEqual({ [`refeicao:${r.id}:dias`]: 'Escolha ao menos um dia da semana.' });
    expect(MSG_DIAS.nenhum).toBe('Escolha ao menos um dia da semana.');
    expect(await erros(salvarRascunho(T.ctx, id, livre(0, [{ ...r, descricaoLivre: 'x'.repeat(2001) }]), deps))).toEqual({ [`refeicao:${r.id}:descricaoLivre`]: MSG_PLANO.texto });
    for (const dias of [[7], [1, 1], ['seg'], 'todos'])
      expect(await erros(salvarRascunho(T.ctx, id, livre(0, [{ ...r, diasSemana: dias as number[] }]), deps)), JSON.stringify(dias)).toEqual({ geral: MSG_PLANO.invalido });
    expect(await erros(salvarRascunho(T.ctx, id, livre(0, [r], { modo: 'outro' as 'livre' }), deps))).toEqual({ geral: MSG_PLANO.invalido });
    const comItem = { ...r, itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] };
    expect(await erros(salvarRascunho(T.ctx, id, livre(0, [comItem]), deps))).toEqual({ geral: MSG_PLANO.invalido });
    expect(await linhasDasRefeicoes(T, id)).toEqual([]); // nada gravado
  });

  it('copiarConteudo (RN-256): dias, texto livre, listas ligadas (a mesma cópia, sem reler a biblioteca) e conteúdos ligados', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    const almoco = refeicao({ descricaoLivre: 'Prato feito', diasSemana: [1, 2, 3, 4, 5] });
    await salvarRascunho(T.ctx, id, livre(0, [almoco]), deps);
    const material = await novoConteudo(app.db, T, { titulo: 'Como montar o prato' });
    const copiada = new Date('2026-11-16T12:00:00Z');
    const conteudoDaLista = { grupos: [{ nome: 'Carboidratos', itens: [{ nome: 'Arroz, tipo 1, cozido', gramas: 100, fonte: 'taco' }] }] };
    await withTenant(
      T.ctx,
      async (tx) => {
        await tx.insert(planoListasSubstituicao).values({ tenantId: T.tenantId, patientId: p.id, planId: id, listaOrigemId: randomUUID(), nome: 'Trocas do dia a dia', orientacao: 'Troque dentro do grupo.', conteudo: conteudoDaLista, copiadaEm: copiada, ordem: 0 });
        await tx.insert(planoConteudos).values([
          { tenantId: T.tenantId, patientId: p.id, planId: id, contentId: material.id, titulo: 'Como montar o prato', ordem: 0 },
          { tenantId: T.tenantId, patientId: p.id, planId: id, contentId: null, titulo: 'Material excluído', ordem: 1 },
        ]);
      },
      app.db,
    );
    const modeloId = await withTenant(
      T.ctx,
      async (tx) => {
        const [m] = await tx.insert(mealPlans).values({ tenantId: T.tenantId, isTemplate: true, titulo: 'Modelo', modo: 'livre' }).returning({ id: mealPlans.id });
        await copiarConteudo(tx, id, m.id);
        return m.id;
      },
      app.db,
    );
    expect((await linhasDasRefeicoes(T, modeloId)).map(({ dias, texto }) => ({ dias, texto }))).toEqual([{ dias: [1, 2, 3, 4, 5], texto: 'Prato feito' }]);
    const [lista] = await withTenant(T.ctx, (tx) => tx.select().from(planoListasSubstituicao).where(eq(planoListasSubstituicao.planId, modeloId)), app.db);
    expect(lista).toMatchObject({ patientId: null, nome: 'Trocas do dia a dia', orientacao: 'Troque dentro do grupo.', conteudo: conteudoDaLista, copiadaEm: copiada, ordem: 0 });
    const ligados = await withTenant(T.ctx, (tx) => tx.select().from(planoConteudos).where(eq(planoConteudos.planId, modeloId)).orderBy(planoConteudos.ordem), app.db);
    expect(ligados.map((c) => [c.patientId, c.contentId, c.titulo, c.ordem])).toEqual([
      [null, material.id, 'Como montar o prato', 0],
      [null, null, 'Material excluído', 1],
    ]);
  });

  it('copiarConteudo: exclusão do conteúdo ligado ao mesmo tempo que a cópia → a ligação copiada fica sem o conteúdo, com o título (nunca 23503)', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await comRascunho(T);
    await salvarRascunho(T.ctx, id, livre(0, [refeicao({ descricaoLivre: 'Prato feito' })]), deps);
    const material = await novoConteudo(app.db, T, { titulo: 'Como montar o prato' });
    await withTenant(T.ctx, (tx) => tx.insert(planoConteudos).values({ tenantId: T.tenantId, patientId: p.id, planId: id, contentId: material.id, titulo: 'Como montar o prato', ordem: 0 }), app.db);
    const [m] = await withTenant(T.ctx, (tx) => tx.insert(mealPlans).values({ tenantId: T.tenantId, isTemplate: true, titulo: 'Modelo', modo: 'livre' }).returning({ id: mealPlans.id }), app.db);
    let soltar!: () => void;
    const segura = new Promise<void>((r) => (soltar = r));
    let feito!: () => void;
    const excluiu = new Promise<void>((r) => (feito = r));
    const outra = withTenant(T.ctx, async (tx) => {
      await tx.delete(contents).where(eq(contents.id, material.id));
      feito();
      await segura; // a exclusão fica aberta, sem COMMIT, enquanto a cópia roda
    }, app.db);
    await excluiu;
    let terminou = false;
    const copiando = withTenant(T.ctx, (tx) => copiarConteudo(tx, id, m.id), app.db)
      .catch((e: unknown) => e) // sem a trava, o 23503 chega ao expect, sem rejeição solta
      .finally(() => (terminou = true));
    for (let i = 0; i < 60 && !terminou; i++) {
      const r = await app.db.execute(sql`select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and pid <> pg_backend_pid()`);
      if ((r.rows[0] as { n: number }).n > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    soltar();
    await outra;
    expect(await copiando).toBeUndefined();
    const ligados = await withTenant(T.ctx, (tx) => tx.select({ contentId: planoConteudos.contentId, titulo: planoConteudos.titulo }).from(planoConteudos).where(eq(planoConteudos.planId, m.id)), app.db);
    expect(ligados).toEqual([{ contentId: null, titulo: 'Como montar o prato' }]);
  });

  it('"Usar como rascunho" e modelos sugeridos (gravarConteudoRascunhoTx, criarRascunhoTx): modo calculado e refeições nos 7 dias', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const planId = await withTenant(
      T.ctx,
      async (tx) => {
        await carregarPacienteParaEscrita(tx, p.id);
        const id = await criarRascunhoTx(tx, T.tenantId, p.id, { titulo: 'Da IA' });
        await gravarConteudoRascunhoTx(tx, T.tenantId, p.id, id, [{ nome: 'Almoço', horario: '12:00', itens: [{ foodId: idTaco(3), quantidadeG: 100, medida: null, substitui: null }] }]);
        return id;
      },
      app.db,
    );
    expect(await carregarPlano(T.ctx, planId, app.db)).toMatchObject({ modo: 'calculado', macrosPrescritos: null, refeicoes: [{ diasSemana: [0, 1, 2, 3, 4, 5, 6], descricaoLivre: null }] });
  });
});
