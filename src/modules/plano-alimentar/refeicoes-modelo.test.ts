import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { estadoInicial, paraEnvio, reduzir } from '@/app/painel/planos/editor/estado';
import { refeicoesModelo, refeicoesModeloItens } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { MSG_ALIMENTO } from '@/modules/alimentos/alimentos-constantes';
import { AlimentoError, criarAlimento, editarAlimento, excluirAlimento } from '@/modules/alimentos/alimentos';
import { idTaco } from '@/modules/alimentos/taco';
import { MAX_ITENS_MINHA_REFEICAO, MAX_MINHAS_REFEICOES, MSG_MINHAS_REFEICOES } from './biblioteca-constantes';
import { itensComoTexto, totalDosItens } from './calculo';
import { carregarPlano, paraCliente } from './carregar';
import { MSG_PLANO } from './constantes';
import { TODOS_OS_DIAS } from './dias';
import { travarConsultorio } from './biblioteca';
import { criarRascunho, salvarRascunho } from './rascunho';
import {
  alterarMinhaRefeicao, carregarMinhaRefeicao, excluirMinhaRefeicao, listarMinhasRefeicoes, RefeicaoModeloError, refeicaoParaPlano, salvarComoMinhaRefeicao,
} from './refeicoes-modelo';

// Plano 19, Tarefa 8 (P19-08, US-237, RN-250/RN-258): minhas refeições — salvar do editor, carregar no plano, limites.
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await app.pool.end();
});
const deps = { db: app.db };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof RefeicaoModeloError) return e.erros;
    throw e;
  }
  throw new Error('esperava RefeicaoModeloError');
};

const COLHER = { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 };
const PAO = { nome: 'Pão de fermentação natural', grupo: 'Cereais e derivados', kcal: '250', proteinaG: '9', carboidratoG: '48', lipidioG: '2', fibraG: '3' };

/** O Almoço da tela do editor: arroz (4 colheres) com o pão como substituição e o feijão em gramas. */
function almoco(o: { observacao?: string; incluirObservacao?: boolean; pao?: string } = {}) {
  const arroz = randomUUID();
  return {
    nome: 'Almoço leve',
    tipo: 'Almoço',
    horario: '12:30',
    observacao: o.observacao ?? 'Ana Souza (11 98888-7777): sem lactose',
    ...(o.incluirObservacao !== undefined ? { incluirObservacao: o.incluirObservacao } : {}),
    modo: 'calculado' as const,
    descricaoLivre: null,
    itens: [
      { id: arroz, foodId: idTaco(3), quantidadeG: '100', medida: COLHER, substituiItemId: null },
      ...(o.pao ? [{ id: randomUUID(), foodId: o.pao, quantidadeG: '50', medida: null, substituiItemId: arroz }] : []),
      { id: randomUUID(), foodId: idTaco(53), quantidadeG: '80', medida: null, substituiItemId: null },
    ],
  };
}

const linhas = (T: TenantDeTeste) => withTenant(T.ctx, (tx) => tx.select().from(refeicoesModelo), app.db);


/**
 * Sem TOCTOU: com o consultório travado por outra transação (como um salvamento em curso), `acao` espera a trava antes
 * de contar — continua pendente até a trava sair. Devolve se terminou antes de soltar e o resultado.
 */
async function esperaATravaDoConsultorio<R>(T: TenantDeTeste, acao: () => Promise<R>): Promise<{ antes: boolean; resultado: R }> {
  let soltar!: () => void;
  const solto = new Promise<void>((r) => (soltar = r));
  let travou!: () => void;
  const travado = new Promise<void>((r) => (travou = r));
  const trava = withTenant(T.ctx, async (tx) => {
    await travarConsultorio(tx, T.tenantId);
    travou();
    await solto;
  }, app.db);
  await travado;
  let terminou = false;
  const p = acao().finally(() => (terminou = true));
  await new Promise((r) => setTimeout(r, 300));
  const antes = terminou;
  soltar();
  await trava;
  return { antes, resultado: await p };
}

describe('salvar como minha refeição (US-237 "Salvar do editor", RN-250)', () => {
  it('sem "Incluir a observação" a observação não vai (LGPD, art. 6º, III); marcada, vai; nome, tipo, horário e itens ficam', async () => {
    const T = await novoTenant(app.db);
    const sem = await salvarComoMinhaRefeicao(T.ctx, almoco(), deps);
    expect(sem).toMatchObject({ nome: 'Almoço leve', tipo: 'Almoço', horario: '12:30', modo: 'calculado' });
    const r = await carregarMinhaRefeicao(T.ctx, sem.id, app.db);
    expect(r).toMatchObject({ nome: 'Almoço leve', tipo: 'Almoço', horario: '12:30', observacao: '' });
    expect(r!.itens.map((i) => [i.foodId, i.quantidadeG, i.medida, i.medidaCaseiraTxt])).toEqual([
      [idTaco(3), 100, COLHER, '4 colheres de sopa cheias'],
      [idTaco(53), 80, null, null],
    ]);
    const texto = await salvarComoMinhaRefeicao(T.ctx, { ...almoco(), incluirObservacao: 'sim' }, deps); // só `true` inclui
    expect((await carregarMinhaRefeicao(T.ctx, texto.id, app.db))!.observacao).toBe('');
    const naoMarcada = await salvarComoMinhaRefeicao(T.ctx, almoco({ incluirObservacao: false }), deps);
    expect((await carregarMinhaRefeicao(T.ctx, naoMarcada.id, app.db))!.observacao).toBe('');
    const com = await salvarComoMinhaRefeicao(T.ctx, almoco({ incluirObservacao: true }), deps);
    expect((await carregarMinhaRefeicao(T.ctx, com.id, app.db))!.observacao).toBe('Ana Souza (11 98888-7777): sem lactose');
    // a kcal da lista é a dos itens principais com os valores de hoje (a substituição não conta, RN-02)
    expect(sem.kcal).toBe(totalDosItens(r!.itens).kcal);
  });

  it('a substituição fica ligada ao principal (ids novos na biblioteca); refeição em texto livre guarda o texto e nenhum item', async () => {
    const T = await novoTenant(app.db);
    const { id: pao } = await criarAlimento(T.ctx, PAO, deps);
    const entrada = almoco({ pao });
    const { id } = await salvarComoMinhaRefeicao(T.ctx, entrada, deps);
    const r = (await carregarMinhaRefeicao(T.ctx, id, app.db))!;
    const [arroz, sub, feijao] = r.itens;
    expect(sub).toMatchObject({ foodId: pao, substituiItemId: arroz.id });
    expect(feijao.substituiItemId).toBeNull();
    expect(r.itens.map((i) => i.id)).not.toContain(entrada.itens[0].id); // a tela não escolhe o id gravado

    const livre = await salvarComoMinhaRefeicao(T.ctx, { nome: 'Jantar', tipo: 'Jantar', horario: '', observacao: '', modo: 'livre', descricaoLivre: '  Sopa de legumes  ', itens: [] }, deps);
    expect(livre.kcal).toBeNull();
    expect(await carregarMinhaRefeicao(T.ctx, livre.id, app.db)).toMatchObject({ modo: 'livre', descricaoLivre: 'Sopa de legumes', horario: '', itens: [] });
  });

  it('erros por campo (nome, tipo, quantidade, substituição, refeição vazia) e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    const e = almoco();
    expect(await erros(salvarComoMinhaRefeicao(T.ctx, { ...e, nome: ' ', tipo: 'Brunch' }, deps))).toEqual({ nome: MSG_MINHAS_REFEICOES.nome, tipo: MSG_MINHAS_REFEICOES.tipo });
    const ruim = { ...e, itens: [{ ...e.itens[0], quantidadeG: '0', medida: null }, { ...e.itens[1], substituiItemId: randomUUID() }] };
    expect(await erros(salvarComoMinhaRefeicao(T.ctx, ruim, deps))).toEqual({
      [`item:${e.itens[0].id}:quantidadeG`]: MSG_PLANO.quantidade,
      [`item:${e.itens[1].id}:substituiItemId`]: MSG_PLANO.substituicao,
    });
    expect(await erros(salvarComoMinhaRefeicao(T.ctx, { ...e, itens: [] }, deps))).toEqual({ geral: MSG_MINHAS_REFEICOES.vazia });
    expect(await erros(salvarComoMinhaRefeicao(T.ctx, { ...e, modo: 'livre', descricaoLivre: '', itens: [] }, deps))).toEqual({ descricaoLivre: MSG_MINHAS_REFEICOES.vazia });
    expect(await linhas(T)).toEqual([]);
  });

  it('41º item recusado ("A refeição pode ter até 40 itens."); 40 passam', async () => {
    const T = await novoTenant(app.db);
    const item = () => ({ id: randomUUID(), foodId: idTaco(3), quantidadeG: '10', medida: null, substituiItemId: null });
    const com = (n: number) => ({ ...almoco(), itens: Array.from({ length: n }, item) });
    expect(MSG_MINHAS_REFEICOES.limiteItens).toBe('A refeição pode ter até 40 itens.');
    expect(await erros(salvarComoMinhaRefeicao(T.ctx, com(MAX_ITENS_MINHA_REFEICAO + 1), deps))).toEqual({ geral: MSG_MINHAS_REFEICOES.limiteItens });
    expect(await linhas(T)).toEqual([]);
    const { id } = await salvarComoMinhaRefeicao(T.ctx, com(MAX_ITENS_MINHA_REFEICAO), deps);
    expect((await carregarMinhaRefeicao(T.ctx, id, app.db))!.itens).toHaveLength(40);
  });

  it('201ª refeição recusada, também com dois salvamentos ao mesmo tempo no limite (tenant travado, sem TOCTOU)', async () => {
    const T = await novoTenant(app.db);
    await withTenant(T.ctx, (tx) => tx.insert(refeicoesModelo).values(Array.from({ length: MAX_MINHAS_REFEICOES - 1 }, (_, k) => ({ tenantId: T.tenantId, nome: `R${k}`, tipo: 'Almoço' }))), app.db);
    const resultados = await Promise.allSettled([salvarComoMinhaRefeicao(T.ctx, almoco(), deps), salvarComoMinhaRefeicao(T.ctx, almoco(), deps)]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const recusada = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(recusada.reason).toBeInstanceOf(RefeicaoModeloError);
    expect(recusada.reason.erros).toEqual({ geral: MSG_MINHAS_REFEICOES.limiteConsultorio });
    expect(await linhas(T)).toHaveLength(MAX_MINHAS_REFEICOES);
    expect(await erros(salvarComoMinhaRefeicao(T.ctx, almoco(), deps))).toEqual({ geral: MSG_MINHAS_REFEICOES.limiteConsultorio });
    // a contagem espera a trava do consultório: com ele travado por outra transação, o salvamento fica pendente
    const B0 = await novoTenant(app.db);
    const { antes, resultado } = await esperaATravaDoConsultorio(B0, () => salvarComoMinhaRefeicao(B0.ctx, almoco(), deps));
    expect(antes).toBe(false);
    expect(resultado.nome).toBe('Almoço leve');
    // o limite é do consultório: outro consultório salva normalmente
    const B = await novoTenant(app.db);
    await salvarComoMinhaRefeicao(B.ctx, almoco(), deps);
  });

  it('RN-258: "Meu alimento" de outro consultório → erro no campo do item e nada gravado (a FK não passa pela RLS)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { id: doB } = await criarAlimento(B.ctx, PAO, deps);
    const e = almoco();
    const intruso = { id: randomUUID(), foodId: doB, quantidadeG: '50', medida: null, substituiItemId: null };
    expect(await erros(salvarComoMinhaRefeicao(A.ctx, { ...e, itens: [...e.itens, intruso] }, deps))).toEqual({ [`item:${intruso.id}:foodId`]: MSG_PLANO.alimento });
    expect(await linhas(A)).toEqual([]);
    expect(await withTenant(B.ctx, (tx) => tx.select().from(refeicoesModeloItens), app.db)).toEqual([]);
    await excluirAlimento(B.ctx, doB, deps); // a exclusão do dono não ficou presa
  });

  it('RN-258: o "Meu alimento" usado numa minha refeição não é excluído, com a mensagem nova; excluída a refeição, sai', async () => {
    const T = await novoTenant(app.db);
    const { id: pao } = await criarAlimento(T.ctx, PAO, deps);
    const { id } = await salvarComoMinhaRefeicao(T.ctx, almoco({ pao }), deps);
    const recusa = await excluirAlimento(T.ctx, pao, deps).then(
      () => null,
      (e: unknown) => e,
    );
    expect(recusa).toBeInstanceOf(AlimentoError);
    expect((recusa as AlimentoError).erros).toEqual({ geral: 'Este alimento está em uso (plano, receita, minha refeição ou lista de substituição) e não pode ser excluído.' });
    expect(MSG_ALIMENTO.emUso).toBe('Este alimento está em uso (plano, receita, minha refeição ou lista de substituição) e não pode ser excluído.');
    await excluirMinhaRefeicao(T.ctx, id, deps);
    await excluirAlimento(T.ctx, pao, deps);
  });
});

describe('carregar minha refeição (US-237 "Carregar" e "Modo do plano")', () => {
  it('ids novos, os 7 dias, o horário e a observação salvos e os valores de hoje dos alimentos (sem cópia congelada)', async () => {
    const T = await novoTenant(app.db);
    const { id: pao } = await criarAlimento(T.ctx, PAO, deps);
    const { id } = await salvarComoMinhaRefeicao(T.ctx, almoco({ pao, incluirObservacao: true }), deps);
    const salva = (await carregarMinhaRefeicao(T.ctx, id, app.db))!;
    await editarAlimento(T.ctx, pao, { ...PAO, kcal: '270' }, deps); // o alimento mudou depois de salvar a refeição
    const r = await refeicaoParaPlano(T.ctx, id, 'calculado', app.db);
    expect(r).toMatchObject({ nome: 'Almoço leve', horario: '12:30', observacao: 'Ana Souza (11 98888-7777): sem lactose', diasSemana: [...TODOS_OS_DIAS], descricaoLivre: null });
    expect(r.id).not.toBe(id);
    const idsSalvos = new Set(salva.itens.map((i) => i.id));
    expect(r.itens.every((i) => !idsSalvos.has(i.id))).toBe(true);
    expect(new Set(r.itens.map((i) => i.id)).size).toBe(3);
    expect(r.itens[1]).toMatchObject({ foodId: pao, substituiItemId: r.itens[0].id, porCem: { kcal: 270 } });
    expect(r.itens[0]).toMatchObject({ medida: COLHER, medidaCaseiraTxt: '4 colheres de sopa cheias', fonte: 'taco', origem: 'TACO' });
    expect(r.itens[0].medidas.length).toBeGreaterThan(0); // para trocar a medida no editor
    // carregar de novo dá outros ids (cada carga é uma refeição nova no plano)
    const outra = await refeicaoParaPlano(T.ctx, id, 'calculado', app.db);
    expect(outra.id).not.toBe(r.id);
    expect(outra.itens[0].id).not.toBe(r.itens[0].id);
  });

  it('num plano em texto livre os alimentos entram como texto (itensComoTexto, RN-245); a refeição de texto livre não entra num plano com alimentos', async () => {
    const T = await novoTenant(app.db);
    const { id: pao } = await criarAlimento(T.ctx, PAO, deps);
    const { id } = await salvarComoMinhaRefeicao(T.ctx, almoco({ pao }), deps);
    const salva = (await carregarMinhaRefeicao(T.ctx, id, app.db))!;
    const r = await refeicaoParaPlano(T.ctx, id, 'livre', app.db);
    expect(r.itens).toEqual([]);
    expect(r.descricaoLivre).toBe(itensComoTexto(salva.itens));
    expect(r.descricaoLivre).toMatch(/— 4 colheres de sopa cheias \(100 g\) \(ou Pão de fermentação natural — 50 g\); .+ — 80 g$/);
    expect(r.diasSemana).toEqual([...TODOS_OS_DIAS]);

    const { id: sopa } = await salvarComoMinhaRefeicao(T.ctx, { nome: 'Jantar', tipo: 'Jantar', horario: '19:00', observacao: '', modo: 'livre', descricaoLivre: 'Sopa de legumes', itens: [] }, deps);
    expect(await refeicaoParaPlano(T.ctx, sopa, 'livre', app.db)).toMatchObject({ descricaoLivre: 'Sopa de legumes', itens: [], horario: '19:00' });
    expect(await erros(refeicaoParaPlano(T.ctx, sopa, 'calculado', app.db))).toEqual({ geral: MSG_MINHAS_REFEICOES.soNoLivre });
  });

  it('pelo editor: a refeição carregada vai no PUT do salvamento automático e o rascunho grava com os ids novos e os 7 dias', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id: planId } = await criarRascunho(T.ctx, p.id, deps);
    const { id } = await salvarComoMinhaRefeicao(T.ctx, almoco(), deps);
    const plano = paraCliente((await carregarPlano(T.ctx, planId, app.db))!);
    const refeicao = await refeicaoParaPlano(T.ctx, id, 'calculado', app.db);
    const estado = reduzir(estadoInicial(plano), { tipo: 'carregarRefeicao', refeicao });
    await salvarRascunho(T.ctx, planId, { ...paraEnvio(estado, plano.revisao), envio: randomUUID() }, deps);
    const gravado = (await carregarPlano(T.ctx, planId, app.db))!;
    expect(gravado.refeicoes).toHaveLength(1);
    expect(gravado.refeicoes[0]).toMatchObject({ id: refeicao.id, nome: 'Almoço leve', horario: '12:30', observacao: '', diasSemana: [...TODOS_OS_DIAS] });
    expect(gravado.refeicoes[0].itens.map((i) => i.id)).toEqual(refeicao.itens.map((i) => i.id));
    // o reducer não carrega duas vezes a mesma refeição nem passa do limite do plano no modo livre
    expect(reduzir(estado, { tipo: 'carregarRefeicao', refeicao })).toBe(estado);
    expect(reduzir({ ...estado, modo: 'livre' }, { tipo: 'carregarRefeicao', refeicao: { ...refeicao, id: randomUUID() } })).toMatchObject({ refeicoes: estado.refeicoes });
  });
});

describe('tela de cadastro (US-237) e isolamento', () => {
  it('lista com nome, tipo e kcal, na ordem do dia e filtrável pelo tipo; alterar e excluir; outro consultório não vê nem altera', async () => {
    const T = await novoTenant(app.db);
    const almocoSalvo = await salvarComoMinhaRefeicao(T.ctx, almoco(), deps);
    const cafe = await salvarComoMinhaRefeicao(T.ctx, { ...almoco(), nome: 'Café reforçado', tipo: 'Café da manhã' }, deps);
    const lista = await listarMinhasRefeicoes(T.ctx, {}, app.db);
    expect(lista.map((r) => r.nome)).toEqual(['Café reforçado', 'Almoço leve']);
    expect(lista[1]).toEqual(almocoSalvo);
    expect(await listarMinhasRefeicoes(T.ctx, { tipo: 'Almoço' }, app.db)).toEqual([almocoSalvo]);
    expect(MSG_MINHAS_REFEICOES.kcal('450')).toBe('Cerca de 450 kcal');

    const B = await novoTenant(app.db);
    expect(await listarMinhasRefeicoes(B.ctx, {}, app.db)).toEqual([]);
    expect(await carregarMinhaRefeicao(B.ctx, cafe.id, app.db)).toBeNull();
    expect(await erros(alterarMinhaRefeicao(B.ctx, cafe.id, almoco(), deps))).toEqual({ geral: MSG_MINHAS_REFEICOES.naoEncontrada });
    expect(await erros(excluirMinhaRefeicao(B.ctx, cafe.id, deps))).toEqual({ geral: MSG_MINHAS_REFEICOES.naoEncontrada });
    expect(await erros(refeicaoParaPlano(B.ctx, cafe.id, 'calculado', app.db))).toEqual({ geral: MSG_MINHAS_REFEICOES.naoEncontrada });

    const atual = (await carregarMinhaRefeicao(T.ctx, cafe.id, app.db))!;
    await alterarMinhaRefeicao(
      T.ctx,
      cafe.id,
      { nome: 'Café leve', tipo: 'Café da manhã', horario: '07:00', observacao: 'Sem açúcar', modo: 'calculado', descricaoLivre: null, itens: [{ id: atual.itens[0].id, foodId: idTaco(3), quantidadeG: '60', medida: null, substituiItemId: null }] },
      deps,
    );
    expect(await carregarMinhaRefeicao(T.ctx, cafe.id, app.db)).toMatchObject({ nome: 'Café leve', horario: '07:00', observacao: 'Sem açúcar', itens: [{ foodId: idTaco(3), quantidadeG: 60 }] });
    await excluirMinhaRefeicao(T.ctx, cafe.id, deps);
    expect((await listarMinhasRefeicoes(T.ctx, {}, app.db)).map((r) => r.id)).toEqual([almocoSalvo.id]);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(refeicoesModeloItens).where(eq(refeicoesModeloItens.refeicaoId, cafe.id)), app.db)).toEqual([]);
  });

  it('staff_only: a sessão do paciente do consultório lê zero linhas das minhas refeições e dos itens (a guarda da Tarefa 1)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await salvarComoMinhaRefeicao(T.ctx, almoco({ incluirObservacao: true }), deps);
    const paciente = ctxPaciente(T.tenantId, p.id);
    for (const t of ['refeicoes_modelo', 'refeicoes_modelo_itens']) {
      expect((await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from ${sql.identifier(t)}`), app.db)).rows.length, t).toBeGreaterThan(0);
      expect((await withTenant(paciente, (tx) => tx.execute(sql`select 1 from ${sql.identifier(t)}`), app.db)).rows, t).toEqual([]);
    }
    expect(await listarMinhasRefeicoes(paciente, {}, app.db)).toEqual([]);
  });
});
