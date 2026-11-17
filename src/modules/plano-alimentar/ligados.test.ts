import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConteudo } from '../../../test/conteudos';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { contents, listasSubstituicao, patients, planoConteudos, planoListasSubstituicao } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { criarAlimento, duplicarComoMeu } from '@/modules/alimentos/alimentos';
import { FONTES } from '@/modules/alimentos/fontes';
import { idTaco } from '@/modules/alimentos/taco';
import { trocarPdf } from '@/modules/conteudo/arquivos';
import { MSG_CONTEUDO } from '@/modules/conteudo/constantes';
import { despublicarConteudo, excluirConteudo } from '@/modules/conteudo/conteudos';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { caminhoDoPdfDoConteudo, conteudoDoPaciente, conteudosNovosNaTransacao, feedDeConteudos, marcarFavorito, registrarVisualizacao } from '@/modules/portal/conteudos';
import { MAX_CONTEUDOS_PLANO, MAX_GRUPOS_LISTA, MAX_ITENS_GRUPO, MAX_LISTAS_PLANO, MSG_LIGADOS, MSG_LISTAS } from './biblioteca-constantes';
import { carregarPlano, lerPlanoNaTransacao } from './carregar';
import { PlanoNaoEditavelError, PlanoNaoEncontradoError } from './erros';
import { atualizarDaBiblioteca, conteudosParaLigar, desligarConteudo, ligarConteudo, ligarLista, LigadoError, removerLista, type DonoDoPlano } from './ligados';
import { excluirLista, salvarLista } from './listas';
import { criarModelo } from './modelos';
import { editarPublicado, publicarPlano } from './publicacao';
import { criarRascunho, salvarRascunho } from './rascunho';

// Plano 19, Tarefa 9 (P19-09, US-239, RN-252/RN-253): lista, receitas e materiais ligados ao plano.
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const deps = { db: app.db, appUrl: 'https://nutri.exemplo.com' };

const COLHER = { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 };
type Medida = { nome: string; plural: string; gramas: number; qtd: number };
const item = (foodId: string, quantidadeG = '100', medida: Medida | null = null) => ({ id: randomUUID(), foodId, quantidadeG, medida });
const grupo = (nome: string, itens: ReturnType<typeof item>[]) => ({ id: randomUUID(), nome, itens });
const lista = (nome: string, itens = [item(idTaco(3), '100', COLHER), item(idTaco(53), '50')]) => ({
  nome,
  orientacao: 'Troque um item do grupo por outro do mesmo grupo.',
  grupos: [grupo('Carboidratos — 1 porção', itens)],
});

const mensagem = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof LigadoError) return e.message;
    throw e;
  }
  throw new Error('esperava LigadoError');
};

/** Rascunho da Ana com "Almoço 12:00 · arroz 100 g" (publicável). */
async function cenario() {
  const T: TenantDeTeste = await novoTenant(app.db);
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana' });
  const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia' });
  const { id: planId } = await criarRascunho(T.ctx, ana.id, deps);
  await salvarRascunho(
    T.ctx,
    planId,
    {
      revisao: 0, envio: randomUUID(), titulo: 'Plano da Ana', metaKcal: '', mostrarCalorias: true, orientacoes: '',
      refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] }],
    },
    deps,
  );
  const dono: DonoDoPlano = { planId, patientId: ana.id };
  return { T, ana, bia, planId, dono, ctxAna: ctxPaciente(T.tenantId, ana.id) };
}
const publicar = async (T: TenantDeTeste, patientId: string, planId: string) => expect(await publicarPlano(T.ctx, patientId, planId, deps)).toMatchObject({ versao: expect.any(Number) });
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100)]);

describe('"Ligado ao plano" — lista de substituição (US-239, RN-252)', () => {
  it('"Ligar lista": a cópia leva nome, gramas, medida, fonte, versão, fonteOrigem e valores por 100 g; editar ou excluir a lista na biblioteca não muda a cópia', async () => {
    const { T, ana, planId, dono } = await cenario();
    const meu = await duplicarComoMeu(T.ctx, idTaco(3), deps); // "Meu alimento" duplicado da TACO (rodapé da RN-233)
    const { id: listaId } = await salvarLista(T.ctx, null, lista('Trocas do dia a dia', [item(idTaco(3), '100', COLHER), item(meu.id, '50')]), deps);
    const agora = new Date('2026-11-16T15:00:00Z');
    const l = await ligarLista(T.ctx, dono, listaId, { ...deps, now: agora });
    expect(l).toMatchObject({ listaOrigemId: listaId, nome: 'Trocas do dia a dia', orientacao: 'Troque um item do grupo por outro do mesmo grupo.', copiadaEm: agora.toISOString() });
    expect(l.grupos.map((g) => g.nome)).toEqual(['Carboidratos — 1 porção']);
    const [arroz, copia] = l.grupos[0].itens;
    expect(arroz).toMatchObject({ quantidadeG: 100, medidaCaseiraTxt: '4 colheres de sopa cheias', fonte: 'taco', fonteVersao: FONTES.taco.versao, fonteOrigem: null });
    expect(arroz.porCem.kcal).toEqual(expect.any(Number));
    expect(copia).toMatchObject({ quantidadeG: 50, medidaCaseiraTxt: null, fonte: 'propria', fonteVersao: null, fonteOrigem: 'taco' });
    expect(Object.keys(arroz).sort()).toEqual(['fonte', 'fonteOrigem', 'fonteVersao', 'medidaCaseiraTxt', 'nome', 'porCem', 'quantidadeG']); // sem ids nem micros
    expect((await carregarPlano(T.ctx, planId, app.db))!.listas).toEqual([l]);
    // ligar de novo a mesma lista (clique duplo, outra aba): a mesma cópia, sem repetir
    expect(await ligarLista(T.ctx, dono, listaId, deps)).toEqual(l);
    // a biblioteca muda: a cópia do rascunho fica como estava
    await salvarLista(T.ctx, listaId, { ...lista('Trocas novas', [item(idTaco(53), '80')]), orientacao: 'Outra' }, deps);
    expect((await carregarPlano(T.ctx, planId, app.db))!.listas).toEqual([l]);
    // publicado: o paciente vê a cópia que recebeu (paciente_sem_rascunho), também depois de a lista sair da biblioteca
    await publicar(T, ana.id, planId);
    await excluirLista(T.ctx, listaId, deps);
    const doPaciente = await withTenant(ctxPaciente(T.tenantId, ana.id), (tx) => lerPlanoNaTransacao(tx, planId, { comMedidas: false }), app.db);
    expect(doPaciente!.listas).toEqual([l]);
  });

  it('"Atualizar da biblioteca" troca a cópia só no rascunho; com a lista de origem excluída → "A lista de origem foi excluída." e a cópia fica', async () => {
    const { T, ana, planId, dono } = await cenario();
    const { id: listaId } = await salvarLista(T.ctx, null, lista('Trocas do dia a dia'), deps);
    const l = await ligarLista(T.ctx, dono, listaId, { ...deps, now: new Date('2026-11-16T15:00:00Z') });
    await salvarLista(T.ctx, listaId, lista('Trocas da semana', [item(idTaco(53), '80')]), deps);
    const depois = new Date('2026-11-17T15:00:00Z');
    const nova = await atualizarDaBiblioteca(T.ctx, dono, l.id, { ...deps, now: depois });
    expect(nova).toMatchObject({ id: l.id, nome: 'Trocas da semana', copiadaEm: depois.toISOString() });
    expect(nova.grupos[0].itens.map((i) => i.quantidadeG)).toEqual([80]);

    // publicado: nada muda nas ligações
    await publicar(T, ana.id, planId);
    const material = await novoConteudo(app.db, T);
    for (const acao of [
      () => atualizarDaBiblioteca(T.ctx, dono, l.id, deps),
      () => removerLista(T.ctx, dono, l.id, deps),
      () => ligarLista(T.ctx, dono, listaId, deps),
      () => ligarConteudo(T.ctx, dono, material.id, deps),
      () => desligarConteudo(T.ctx, dono, randomUUID(), deps),
    ])
      await expect(acao()).rejects.toBeInstanceOf(PlanoNaoEditavelError);
    expect((await carregarPlano(T.ctx, planId, app.db))!.listas).toEqual([nova]);

    // "Editar": o rascunho novo leva a cópia (sem reler a biblioteca); a lista some da biblioteca e a cópia fica
    const { id: rascunho } = await editarPublicado(T.ctx, ana.id, planId, deps);
    const doRascunho = { planId: rascunho, patientId: ana.id };
    const [copia] = (await carregarPlano(T.ctx, rascunho, app.db))!.listas;
    expect(copia).toMatchObject({ nome: 'Trocas da semana', listaOrigemId: listaId, copiadaEm: depois.toISOString() });
    await excluirLista(T.ctx, listaId, deps);
    expect(await mensagem(atualizarDaBiblioteca(T.ctx, doRascunho, copia.id, deps))).toBe(MSG_LIGADOS.origemExcluida);
    expect(MSG_LIGADOS.origemExcluida).toBe('A lista de origem foi excluída.');
    expect((await carregarPlano(T.ctx, rascunho, app.db))!.listas).toEqual([copia]);
    // "Remover" tira só do rascunho; o publicado continua com a dele
    await removerLista(T.ctx, doRascunho, copia.id, deps);
    await removerLista(T.ctx, doRascunho, copia.id, deps); // de novo (outra aba): nada a fazer
    expect((await carregarPlano(T.ctx, rascunho, app.db))!.listas).toEqual([]);
    expect((await carregarPlano(T.ctx, planId, app.db))!.listas).toEqual([nova]);
  });

  it('um salvamento da lista em curso termina antes do "Ligar" (FOR SHARE): a cópia sai inteira da versão nova', async () => {
    const { T, dono } = await cenario();
    const { id: listaId } = await salvarLista(T.ctx, null, lista('Trocas'), deps);
    let soltar!: () => void;
    const solto = new Promise<void>((r) => (soltar = r));
    let travou!: () => void;
    const travado = new Promise<void>((r) => (travou = r));
    const salvamento = withTenant(
      T.ctx,
      async (tx) => {
        await tx.update(listasSubstituicao).set({ nome: 'Trocas novas' }).where(eq(listasSubstituicao.id, listaId));
        travou();
        await solto;
      },
      app.db,
    );
    await travado;
    let terminou = false;
    const ligar = ligarLista(T.ctx, dono, listaId, deps).finally(() => (terminou = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(terminou).toBe(false); // espera o salvamento
    soltar();
    await salvamento;
    expect((await ligar).nome).toBe('Trocas novas');
  });

  it('a lista cheia (20 grupos × 30 itens, nomes, medidas e orientação no limite) liga e atualiza sem erro', async () => {
    const { T, dono } = await cenario();
    const nomeLongo = 'Ç'.repeat(120);
    const { id: foodId } = await criarAlimento(T.ctx, { nome: nomeLongo, grupo: 'Cereais e derivados', kcal: '350', proteinaG: '10', carboidratoG: '70', lipidioG: '2', fibraG: '5' }, deps);
    const medida = { nome: 'á'.repeat(60), plural: 'é'.repeat(60), gramas: 4999.9, qtd: 1 };
    const cheia = {
      nome: 'ã'.repeat(80),
      orientacao: 'õ'.repeat(1000),
      grupos: Array.from({ length: MAX_GRUPOS_LISTA }, (_, k) => grupo(`${k}`.padEnd(60, 'í'), Array.from({ length: MAX_ITENS_GRUPO }, () => item(foodId, '4999,9', medida)))),
    };
    const { id: listaId } = await salvarLista(T.ctx, null, cheia, deps);
    const l = await ligarLista(T.ctx, dono, listaId, deps);
    expect(l.grupos).toHaveLength(MAX_GRUPOS_LISTA);
    expect(l.grupos.every((g) => g.itens.length === MAX_ITENS_GRUPO && g.itens.every((i) => i.nome === nomeLongo))).toBe(true);
    await expect(atualizarDaBiblioteca(T.ctx, dono, l.id, deps)).resolves.toMatchObject({ id: l.id, nome: cheia.nome });
    const [{ bytes }] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select octet_length(conteudo::text)::int as bytes from plano_listas_substituicao where id = ${l.id}`), app.db)).rows as { bytes: number }[];
    expect(bytes).toBeGreaterThan(200_000); // o pior caso de verdade, dentro do teto de 512 KB do CHECK
    expect(bytes).toBeLessThanOrEqual(524_288);
  });

  it('até 5 listas e 10 receitas ou materiais por plano ("O plano pode ter até 5 listas e 10 receitas ou materiais.")', async () => {
    const { T, planId, dono } = await cenario();
    expect(MSG_LIGADOS.limite).toBe('O plano pode ter até 5 listas e 10 receitas ou materiais.');
    const listas = [];
    for (let k = 0; k <= MAX_LISTAS_PLANO; k++) listas.push((await salvarLista(T.ctx, null, lista(`Lista ${k}`), deps)).id);
    for (const id of listas.slice(0, MAX_LISTAS_PLANO)) await ligarLista(T.ctx, dono, id, deps);
    expect(await mensagem(ligarLista(T.ctx, dono, listas[MAX_LISTAS_PLANO], deps))).toBe(MSG_LIGADOS.limite);
    const conteudos = [];
    for (let k = 0; k <= MAX_CONTEUDOS_PLANO; k++) conteudos.push((await novoConteudo(app.db, T, { titulo: `Material ${k}` })).id);
    for (const id of conteudos.slice(0, MAX_CONTEUDOS_PLANO)) await ligarConteudo(T.ctx, dono, id, deps);
    expect(await mensagem(ligarConteudo(T.ctx, dono, conteudos[MAX_CONTEUDOS_PLANO], deps))).toBe(MSG_LIGADOS.limite);
    const p = (await carregarPlano(T.ctx, planId, app.db))!;
    expect([p.listas.length, p.conteudos.length]).toEqual([MAX_LISTAS_PLANO, MAX_CONTEUDOS_PLANO]);
    expect(p.listas.map((l) => l.nome)).toEqual(['Lista 0', 'Lista 1', 'Lista 2', 'Lista 3', 'Lista 4']); // na ordem em que foram ligadas
  });

  it('isolamento: plano de outro paciente, modelo pedido como plano de paciente (e o contrário), lista de outro consultório, paciente bloqueado', async () => {
    const { T, bia, planId, dono } = await cenario();
    const { id: listaId } = await salvarLista(T.ctx, null, lista('Trocas'), deps);
    await expect(ligarLista(T.ctx, { planId, patientId: bia.id }, listaId, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    await expect(ligarLista(T.ctx, { planId, patientId: null }, listaId, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    await expect(ligarLista(T.ctx, { planId: 'nao-e-id', patientId: null }, listaId, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    const { id: modelo } = await criarModelo(T.ctx, 'Modelo base', deps);
    await expect(ligarLista(T.ctx, { planId: modelo, patientId: bia.id }, listaId, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    // o modelo liga (patient_id nulo nas linhas)
    await ligarLista(T.ctx, { planId: modelo, patientId: null }, listaId, deps);
    expect((await carregarPlano(T.ctx, modelo, app.db))!.listas.map((l) => l.nome)).toEqual(['Trocas']);
    // lista e plano de outro consultório (RLS)
    const U = await novoTenant(app.db);
    const { id: deFora } = await salvarLista(U.ctx, null, lista('De fora'), deps);
    expect(await mensagem(ligarLista(T.ctx, dono, deFora, deps))).toBe(MSG_LISTAS.naoEncontrada);
    expect(await mensagem(ligarLista(T.ctx, dono, 'nao-e-id', deps))).toBe(MSG_LISTAS.naoEncontrada);
    await expect(ligarLista(U.ctx, dono, deFora, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    // paciente bloqueado: o prontuário é só para consulta
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, dono.patientId!)), app.db);
    await expect(ligarLista(T.ctx, dono, listaId, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(planoListasSubstituicao).where(eq(planoListasSubstituicao.planId, planId)), app.db)).toEqual([]);
  });
});

describe('"Ligado ao plano" — receitas e materiais (US-239, RN-253)', () => {
  it('"Ligar receita ou material": tipo e situação; repetir não duplica; despublicado → "Não publicado — o paciente não vê"; excluído → content_id nulo com o título copiado', async () => {
    const { T, planId, dono } = await cenario();
    const prato = await novoConteudo(app.db, T, { titulo: 'Como montar o prato' });
    const emPreparo = await novoConteudo(app.db, T, { tipo: 'receita', titulo: 'Panqueca em preparo', status: 'rascunho' });
    expect(await ligarConteudo(T.ctx, dono, prato.id, deps)).toMatchObject({ contentId: prato.id, titulo: 'Como montar o prato', tipo: 'orientacao', situacao: 'publicado' });
    expect(await ligarConteudo(T.ctx, dono, emPreparo.id, deps)).toMatchObject({ tipo: 'receita', situacao: 'nao_publicado' });
    const repetido = await ligarConteudo(T.ctx, dono, prato.id, deps);
    expect((await carregarPlano(T.ctx, planId, app.db))!.conteudos.map((c) => c.id)).toEqual([repetido.id, expect.any(String)]);

    await despublicarConteudo(T.ctx, prato.id, deps);
    expect((await carregarPlano(T.ctx, planId, app.db))!.conteudos[0]).toMatchObject({ contentId: prato.id, situacao: 'nao_publicado', tipo: 'orientacao' });
    await withTenant(T.ctx, (tx) => tx.update(contents).set({ titulo: 'Como montar o prato (revisto)' }).where(eq(contents.id, prato.id)), app.db);
    await excluirConteudo(T.ctx, prato.id, deps);
    expect((await carregarPlano(T.ctx, planId, app.db))!.conteudos[0]).toEqual({ id: repetido.id, contentId: null, titulo: 'Como montar o prato', tipo: null, situacao: 'excluido' });
    expect(MSG_LIGADOS.excluido('Como montar o prato')).toBe('Como montar o prato (excluído)');
    expect(MSG_LIGADOS.naoPublicado).toBe('Não publicado — o paciente não vê');

    // conteúdo de outro consultório ou id inventado: "Conteúdo não encontrado."
    const deFora = await novoConteudo(app.db, await novoTenant(app.db));
    for (const id of [deFora.id, randomUUID(), 'nao-e-id']) expect(await mensagem(ligarConteudo(T.ctx, dono, id, deps)), id).toBe(MSG_CONTEUDO.naoEncontrado);
    await desligarConteudo(T.ctx, dono, repetido.id, deps);
    expect((await carregarPlano(T.ctx, planId, app.db))!.conteudos.map((c) => c.tipo)).toEqual(['receita']);
    // a lista do "Ligar receita ou material": todo conteúdo do consultório, com a situação
    expect(await conteudosParaLigar(T.ctx, app.db)).toEqual([{ id: emPreparo.id, titulo: 'Panqueca em preparo', tipo: 'receita', publicado: false }]);
  });

  it('a exclusão do conteúdo em curso termina antes do "Ligar" (FOR SHARE): "Conteúdo não encontrado.", sem 23503', async () => {
    const { T, planId, dono } = await cenario();
    const c = await novoConteudo(app.db, T, { titulo: 'Como montar o prato' });
    let soltar!: () => void;
    const solto = new Promise<void>((r) => (soltar = r));
    let travou!: () => void;
    const travado = new Promise<void>((r) => (travou = r));
    const exclusao = withTenant(
      T.ctx,
      async (tx) => {
        await tx.select({ id: contents.id }).from(contents).where(eq(contents.id, c.id)).for('update');
        travou();
        await solto;
        await tx.delete(contents).where(eq(contents.id, c.id));
      },
      app.db,
    );
    await travado;
    let terminou = false;
    const ligar = mensagem(ligarConteudo(T.ctx, dono, c.id, deps)).finally(() => (terminou = true));
    await new Promise((r) => setTimeout(r, 300));
    expect(terminou).toBe(false); // espera a exclusão
    soltar();
    await exclusao;
    expect(await ligar).toBe(MSG_CONTEUDO.naoEncontrado);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(planoConteudos).where(eq(planoConteudos.planId, planId)), app.db)).toEqual([]);
  });

  it('Review Focus 2: orientação fora da audiência ligada ao plano PUBLICADO abre pelo plano (texto e PDF) e não pelo feed, busca, favoritos nem "Novo conteúdo"; abrir não conta em "Quem viu"', async () => {
    const { T, ana, bia, planId, dono, ctxAna } = await cenario();
    const prato = await novoConteudo(app.db, T, { titulo: 'Como montar o prato', visibilidade: 'pacientes', pacientes: [bia.id] });
    await trocarPdf(T.ctx, prato.id, PDF, { db: app.db });
    const { id: listaId } = await salvarLista(T.ctx, null, lista('Trocas do dia a dia'), deps);
    await ligarLista(T.ctx, dono, listaId, deps);
    await ligarConteudo(T.ctx, dono, prato.id, deps);

    // só no rascunho: nada vaza, nem com ?de=plano
    expect(await conteudoDoPaciente(ctxAna, prato.id, app.db, { doPlano: true })).toBeNull();
    expect(await caminhoDoPdfDoConteudo(ctxAna, prato.id, app.db, { doPlano: true })).toBeNull();
    const ligacoesDoPaciente = () =>
      withTenant(ctxAna, async (tx) => [(await tx.select().from(planoListasSubstituicao)).length, (await tx.select().from(planoConteudos)).length], app.db);
    expect(await ligacoesDoPaciente()).toEqual([0, 0]);

    await publicar(T, ana.id, planId);
    expect(await ligacoesDoPaciente()).toEqual([1, 1]);
    // pelo plano: o texto e o PDF
    expect(await conteudoDoPaciente(ctxAna, prato.id, app.db, { doPlano: true })).toMatchObject({ id: prato.id, tipo: 'orientacao', soPeloPlano: true, temPdf: true, favorito: false });
    expect(await caminhoDoPdfDoConteudo(ctxAna, prato.id, app.db, { doPlano: true })).toEqual(expect.any(String));
    // fora do caminho do plano: 404, feed, busca, favoritos, visualização e o "Novo conteúdo" do Hoje
    expect(await conteudoDoPaciente(ctxAna, prato.id, app.db)).toBeNull();
    expect(await caminhoDoPdfDoConteudo(ctxAna, prato.id, app.db)).toBeNull();
    expect((await feedDeConteudos(ctxAna, {}, app.db)).itens).toEqual([]);
    expect((await feedDeConteudos(ctxAna, { busca: 'montar prato' }, app.db)).itens).toEqual([]);
    expect(await marcarFavorito(ctxAna, prato.id, true, app.db)).toBe(false);
    expect((await feedDeConteudos(ctxAna, { favoritos: true }, app.db)).itens).toEqual([]);
    expect(await registrarVisualizacao(ctxAna, prato.id, app.db)).toBe(false);
    expect(await withTenant(ctxAna, (tx) => conteudosNovosNaTransacao(tx, ana.id, new Date(0), 10), app.db)).toEqual([]);
    const vistas = await withTenant(T.ctx, (tx) => tx.execute(sql`select count(*)::int as n from content_views where content_id = ${prato.id}`), app.db);
    expect(vistas.rows[0]).toEqual({ n: 0 }); // D14: abrir pelo plano não conta em "Quem viu"
    // o plano publicado de OUTRO paciente não libera: a Cia não abre nem com ?de=plano
    const cia = await novoPaciente(app.db, T.ctx, { nome: 'Cia' });
    expect(await conteudoDoPaciente(ctxPaciente(T.tenantId, cia.id), prato.id, app.db, { doPlano: true })).toBeNull();
    expect(await caminhoDoPdfDoConteudo(ctxPaciente(T.tenantId, cia.id), prato.id, app.db, { doPlano: true })).toBeNull();

    // despublicado: não abre com ?de=plano, e o editor diz "Não publicado — o paciente não vê"
    await despublicarConteudo(T.ctx, prato.id, deps);
    expect(await conteudoDoPaciente(ctxAna, prato.id, app.db, { doPlano: true })).toBeNull();
    expect(await caminhoDoPdfDoConteudo(ctxAna, prato.id, app.db, { doPlano: true })).toBeNull();
    expect((await carregarPlano(T.ctx, planId, app.db))!.conteudos).toMatchObject([{ contentId: prato.id, situacao: 'nao_publicado' }]);
  });
});
