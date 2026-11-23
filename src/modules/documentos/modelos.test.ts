import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConsultorio } from '../../../test/documentos';
import { ctxPaciente, novoPaciente } from '../../../test/pacientes';
import { tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { criarReceita, lerDocumento, salvarRascunhoReceita } from './documentos';
import { DocumentoError } from './erros';
import {
  abrirItemSalvo,
  abrirModeloPrescricao,
  carregarModeloNaReceita,
  excluirItemSalvo,
  excluirModeloPrescricao,
  listarItensSalvos,
  listarModelosPrescricao,
  MSG_MODELOS,
  salvarItemSalvo,
  salvarModeloPrescricao,
} from './modelos';
import { ITENS_SALVOS_MAX, MODELOS_PRESCRICAO_MAX } from './modelos-textos';
import { TERMO_FITOTERAPIA } from './perfil-profissional';
import { MSG_PRESCRICAO, type ConteudoReceita } from './prescricao';

/**
 * Plano 22 (T10a, US-379, RN-393, RN-394, EP-D29, EP-D30, R-377): itens salvos e modelos de prescrição pelo módulo, no
 * Postgres do Testcontainers — o "Carregar modelo" pelo mesmo caminho do salvar (conteúdo da tela, tudo ou nada), os
 * tetos e a unicidade sob a trava do consultório e o assert da sessão `nutri`.
 */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
const E = MSG_MODELOS.erros;

const VITD = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: '2000', unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 ao dia' };
const MAGNESIO = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Magnésio dimalato', quantidade: '300', unidade: 'mg' }], forma: 'Cápsula', via: 'oral', posologia: '1 à noite' };
const OMEGA = { tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Ômega 3', quantidade: '1', unidade: 'g' }], forma: 'Cápsula', via: 'oral', posologia: '2 ao dia' };
const MATE = {
  tipo: 'derivado_vegetal', nomenclatura: 'Ilex paraguariensis A.St.-Hil.', parte: 'Folhas', formaFarmaceutica: 'Pó', dose: '2 g', via: 'oral', posologia: '1 vez ao dia',
};
const VALERIANA = {
  tipo: 'fitoterapico', nomenclatura: 'Valeriana officinalis L.', parte: 'Raiz', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 à noite',
};

/** O consultório com (ou sem) a habilitação em Fitoterapia, como em formula-fitoterapica.test.ts. */
async function consultorio(habilitada: boolean) {
  const c = await novoConsultorio(app.db);
  if (habilitada) await app.db.update(tenants).set({ fitoterapiaRegistro: 'CRN-3 nº 1234/2024', fitoterapiaDeclaradaEm: new Date(), fitoterapiaTermoVersao: TERMO_FITOTERAPIA.versao }).where(eq(tenants.id, c.T.tenantId));
  const [t] = await app.db.select().from(tenants).where(eq(tenants.id, c.T.tenantId));
  return { ...c, tenant: t as TenantRow };
}
const semHabilitacao = (t: TenantRow): TenantRow => ({ ...t, fitoterapiaRegistro: null });

const erros = async (p: Promise<unknown>): Promise<Record<string, string>> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DocumentoError) return e.erros;
    throw e;
  }
  throw new Error('esperava DocumentoError');
};
const conteudoDe = async (c: Awaited<ReturnType<typeof consultorio>>, patientId: string, docId: string) => {
  const d = (await lerDocumento(c.T.ctx, patientId, docId, app.db))!;
  return { conteudo: d.conteudo as ConteudoReceita, justificativa: d.justificativa };
};
const posologias = (c: ConteudoReceita) => c.itens.map((i) => i.posologia);

/** Enche a tabela direto no banco (o teto é do módulo; o banco não conta). */
async function encher(c: Awaited<ReturnType<typeof consultorio>>, tabela: 'prescricao_itens_salvos' | 'prescricao_modelos', n: number) {
  const item = JSON.stringify({ ...VITD, composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], duracao: '', manipulado: false });
  await withTenant(
    c.T.ctx,
    (tx) =>
      tabela === 'prescricao_itens_salvos'
        ? tx.execute(sql`insert into prescricao_itens_salvos (tenant_id, nome, tipo, item) select ${c.T.tenantId}, 'Item ' || g, 'suplemento', ${item}::jsonb from generate_series(1, ${n}) g`)
        : tx.execute(sql`insert into prescricao_modelos (tenant_id, nome, itens) select ${c.T.tenantId}, 'Modelo ' || g, jsonb_build_array(${item}::jsonb) from generate_series(1, ${n}) g`),
    app.db,
  );
}
const contar = async (c: Awaited<ReturnType<typeof consultorio>>, tabela: 'prescricao_itens_salvos' | 'prescricao_modelos') =>
  ((await withTenant(c.T.ctx, (tx) => tx.execute(sql`select count(*)::int as n from ${sql.identifier(tabela)}`), app.db)).rows[0] as { n: number }).n;

describe('Carregar modelo (US-379, RN-394, EP-D30)', () => {
  it('acrescentar: o item digitado e não salvo fica junto com os 3 do modelo; a justificativa digitada é gravada; substituir troca os itens', async () => {
    const c = await consultorio(false);
    const p = await novoPaciente(app.db, c.T.ctx);
    const doc = await criarReceita(c.T.ctx, p.id, deps);
    // a justificativa a mais (vinda de um formulário) é ignorada: o modelo não a guarda (RN-394)
    const doFormulario = { nome: 'Rotina de inverno', itens: [MAGNESIO, OMEGA, MATE], orientacoes: 'Tomar **junto** das refeições.', justificativa: 'não entra' };
    const modelo = await salvarModeloPrescricao(c.T.ctx, c.tenant, null, doFormulario, deps);
    // a tela: um item digitado (ainda não salvo) e a justificativa digitada
    const gravado = await carregarModeloNaReceita(
      c.T.ctx, c.tenant, p.id, doc,
      { conteudo: { itens: [VITD], orientacoes: '' }, justificativa: 'Deficiência de vitamina D', modeloId: modelo, modo: 'acrescentar' },
      deps,
    );
    expect(posologias(gravado)).toEqual(['1 ao dia', '1 à noite', '2 ao dia', '1 vez ao dia']);
    expect(gravado).toMatchObject({ tipo: 'receita', orientacoes: 'Tomar **junto** das refeições.', orientacoesFormato: 'marcacao' });
    const lido = await conteudoDe(c, p.id, doc);
    expect(lido.conteudo).toEqual(gravado);
    expect(lido.justificativa).toBe('Deficiência de vitamina D');

    // substituir: só os do modelo; as orientações da tela (não vazias) ficam; a justificativa digitada vai junto
    const trocado = await carregarModeloNaReceita(
      c.T.ctx, c.tenant, p.id, doc,
      { conteudo: { itens: [VITD], orientacoes: 'Beber água.' }, justificativa: 'Fadiga', modeloId: modelo, modo: 'substituir' },
      deps,
    );
    expect(posologias(trocado)).toEqual(['1 à noite', '2 ao dia', '1 vez ao dia']);
    expect(trocado.orientacoes).toBe('Beber água.');
    expect(await conteudoDe(c, p.id, doc)).toEqual({ conteudo: trocado, justificativa: 'Fadiga' });
  });

  it('19 + 3 em acrescentar: a mensagem dos 20 itens e nada muda; substituir com os mesmos 19 passa', async () => {
    const c = await consultorio(false);
    const p = await novoPaciente(app.db, c.T.ctx);
    const doc = await criarReceita(c.T.ctx, p.id, deps);
    await salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, doc, { conteudo: { itens: [VITD] }, justificativa: 'Antiga' }, deps);
    const modelo = await salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Três', itens: [MAGNESIO, OMEGA, MATE], orientacoes: '' }, deps);
    const tela = { itens: Array.from({ length: 19 }, () => VITD), orientacoes: '' };
    expect(await erros(carregarModeloNaReceita(c.T.ctx, c.tenant, p.id, doc, { conteudo: tela, justificativa: 'Nova', modeloId: modelo, modo: 'acrescentar' }, deps))).toEqual({ itens: MSG_MODELOS.passaDe20 });
    const lido = await conteudoDe(c, p.id, doc);
    expect(lido.conteudo.itens).toHaveLength(1);
    expect(lido.justificativa).toBe('Antiga');
    await expect(carregarModeloNaReceita(c.T.ctx, c.tenant, p.id, doc, { conteudo: tela, justificativa: 'Nova', modeloId: modelo, modo: 'substituir' }, deps)).resolves.toMatchObject({ itens: expect.any(Array) });
    expect((await conteudoDe(c, p.id, doc)).conteudo.itens).toHaveLength(3);
  });

  it('R-377: a habilitação retirada depois de salvar o modelo com fitoterápico → semHabilitacao e nada muda', async () => {
    const c = await consultorio(true);
    const p = await novoPaciente(app.db, c.T.ctx);
    const doc = await criarReceita(c.T.ctx, p.id, deps);
    const modelo = await salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Sono', itens: [VALERIANA], orientacoes: 'Evitar telas à noite.' }, deps);
    const sem = semHabilitacao(c.tenant);
    expect(await erros(carregarModeloNaReceita(c.T.ctx, sem, p.id, doc, { conteudo: { itens: [VITD] }, justificativa: 'Insônia', modeloId: modelo, modo: 'acrescentar' }, deps))).toEqual({
      'itens.1.tipo': MSG_PRESCRICAO.semHabilitacao,
    });
    expect(await conteudoDe(c, p.id, doc)).toMatchObject({ conteudo: { itens: [] }, justificativa: null });
    // com a habilitação, o mesmo modelo entra
    await expect(carregarModeloNaReceita(c.T.ctx, c.tenant, p.id, doc, { conteudo: { itens: [VITD] }, justificativa: 'Insônia', modeloId: modelo, modo: 'acrescentar' }, deps)).resolves.toMatchObject({
      orientacoes: 'Evitar telas à noite.',
    });
  });

  it('o conteúdo da tela passa pelas conferências do salvar (um item inválido digitado recusa tudo); modelo de outro consultório ou modo inválido → recusa', async () => {
    const c = await consultorio(false);
    const p = await novoPaciente(app.db, c.T.ctx);
    const doc = await criarReceita(c.T.ctx, p.id, deps);
    const modelo = await salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Um', itens: [MAGNESIO] }, deps);
    const invalido = { ...VITD, posologia: '' };
    expect(Object.keys(await erros(carregarModeloNaReceita(c.T.ctx, c.tenant, p.id, doc, { conteudo: { itens: [invalido] }, justificativa: '', modeloId: modelo, modo: 'acrescentar' }, deps)))).toEqual(['itens.0.posologia']);
    expect((await conteudoDe(c, p.id, doc)).conteudo.itens).toEqual([]);

    const outro = await consultorio(false);
    const doOutro = await salvarModeloPrescricao(outro.T.ctx, outro.tenant, null, { nome: 'Alheio', itens: [OMEGA] }, deps);
    expect(await erros(carregarModeloNaReceita(c.T.ctx, c.tenant, p.id, doc, { conteudo: { itens: [] }, justificativa: '', modeloId: doOutro, modo: 'acrescentar' }, deps))).toEqual({ geral: E.modeloNaoEncontrado });
    expect(await erros(carregarModeloNaReceita(c.T.ctx, c.tenant, p.id, doc, { conteudo: { itens: [] }, justificativa: '', modeloId: 'x', modo: 'acrescentar' }, deps))).toEqual({ geral: E.modeloNaoEncontrado });
    expect(
      await erros(carregarModeloNaReceita(c.T.ctx, c.tenant, p.id, doc, { conteudo: { itens: [] }, justificativa: '', modeloId: modelo, modo: 'misturar' as 'acrescentar' }, deps)),
    ).toEqual({ modo: MSG_PRESCRICAO.opcao });
    expect((await conteudoDe(c, p.id, doc)).conteudo.itens).toEqual([]);
  });
});

describe('itens salvos (US-379, RN-393, EP-D29)', () => {
  it('salva pelo mesmo Zod do item, lista por grupo, abre, edita (a receita que copiou não muda) e exclui; outro consultório não vê', async () => {
    const c = await consultorio(true);
    const vitd = await salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: ' Vitamina D ', item: VITD }, deps);
    const valeriana = await salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'Valeriana', item: VALERIANA }, deps);
    await salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'Mate', item: MATE }, deps);
    expect((await listarItensSalvos(c.T.ctx, 'suplementos', deps)).map((i) => [i.nome, i.tipo])).toEqual([['Vitamina D', 'suplemento']]);
    expect((await listarItensSalvos(c.T.ctx, 'fitoterapicos', deps)).map((i) => [i.nome, i.tipo])).toEqual([['Mate', 'derivado_vegetal'], ['Valeriana', 'fitoterapico']]);
    const aberto = await abrirItemSalvo(c.T.ctx, vitd, deps);
    expect(aberto).toMatchObject({ id: vitd, nome: 'Vitamina D', tipo: 'suplemento', item: { composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }] } });

    // "Adicionar item salvo" copia (no cliente) para a receita; editar o item salvo depois não muda a receita
    const p = await novoPaciente(app.db, c.T.ctx);
    const doc = await criarReceita(c.T.ctx, p.id, deps);
    await salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, doc, { conteudo: { itens: [aberto!.item] }, justificativa: '' }, deps);
    await expect(salvarItemSalvo(c.T.ctx, c.tenant, vitd, { nome: 'Vitamina D', item: { ...VITD, posologia: '2 ao dia' } }, deps)).resolves.toBe(vitd);
    expect((await abrirItemSalvo(c.T.ctx, vitd, deps))?.item.posologia).toBe('2 ao dia');
    expect(posologias((await conteudoDe(c, p.id, doc)).conteudo)).toEqual(['1 ao dia']);

    const B = await consultorio(true);
    expect(await listarItensSalvos(B.T.ctx, 'suplementos', deps)).toEqual([]);
    expect(await abrirItemSalvo(B.T.ctx, vitd, deps)).toBeNull();
    expect(await excluirItemSalvo(B.T.ctx, vitd, deps)).toBe(false);
    expect(await erros(salvarItemSalvo(B.T.ctx, B.tenant, vitd, { nome: 'X', item: VITD }, deps))).toEqual({ geral: E.itemNaoEncontrado });

    expect(await excluirItemSalvo(c.T.ctx, valeriana, deps)).toBe(true);
    expect(await excluirItemSalvo(c.T.ctx, valeriana, deps)).toBe(false);
    expect(await abrirItemSalvo(c.T.ctx, 'nao-e-uuid', deps)).toBeNull();
  });

  it('erros: nome vazio ou longo, nome repetido sem diferença de maiúsculas, item inválido (chaves com o prefixo item.), fitoterápico sem habilitação; o derivado vegetal não exige', async () => {
    const c = await consultorio(false);
    expect(await erros(salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: '  ', item: VITD }, deps))).toEqual({ nome: E.nome });
    expect(await erros(salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'x'.repeat(81), item: VITD }, deps))).toEqual({ nome: E.nome });
    expect(await erros(salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'Sem posologia', item: { ...VITD, posologia: '' } }, deps))).toEqual({ 'item.posologia': expect.any(String) });
    expect(await erros(salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'Valeriana', item: VALERIANA }, deps))).toEqual({ 'item.tipo': MSG_PRESCRICAO.semHabilitacao });
    expect(await erros(salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'Marca', item: { ...VITD, tipo: 'marca' } }, deps))).toEqual({ 'item.tipo': MSG_PRESCRICAO.opcao });
    await salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'Mate', item: MATE }, deps);
    await salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'Vitamina D', item: VITD }, deps);
    expect(await erros(salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'VITAMINA D', item: VITD }, deps))).toEqual({ nome: E.itemRepetido });
    // o próprio item pode ser salvo de novo com o mesmo nome; renomear para o de outro → repetido
    const [mate] = await listarItensSalvos(c.T.ctx, 'fitoterapicos', deps);
    await expect(salvarItemSalvo(c.T.ctx, c.tenant, mate.id, { nome: 'mate', item: MATE }, deps)).resolves.toBe(mate.id);
    expect(await erros(salvarItemSalvo(c.T.ctx, c.tenant, mate.id, { nome: 'vitamina d', item: MATE }, deps))).toEqual({ nome: E.itemRepetido });
    // trocar o tipo ao editar muda o grupo (a coluna acompanha o item, tipo_coerente)
    await salvarItemSalvo(c.T.ctx, c.tenant, mate.id, { nome: 'mate', item: OMEGA }, deps);
    expect((await listarItensSalvos(c.T.ctx, 'fitoterapicos', deps))).toEqual([]);
    expect(await contar(c, 'prescricao_itens_salvos')).toBe(2);
  });

  it('NUL num campo de texto do item (POST à mão, texto colado) sai antes de gravar — item salvo, modelo e "Carregar modelo" (sem 22P05, que levaria o item ao log)', async () => {
    const c = await consultorio(false);
    const comNul = { ...VITD, composicao: [{ nome: 'Vitamina\u0000 D3', quantidade: '2000', unidade: 'UI' }], forma: 'Cáp\u0000sula', posologia: 'a\u0000b' };
    const id = await salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'Com NUL', item: comNul }, deps);
    const salvo = await abrirItemSalvo(c.T.ctx, id, deps);
    expect(salvo?.item).toMatchObject({ posologia: 'ab', forma: 'Cápsula', composicao: [{ nome: 'Vitamina D3' }] });
    expect(JSON.stringify(salvo)).not.toContain('\u0000');

    const modelo = await salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Modelo NUL', itens: [comNul], orientacoes: '' }, deps);
    expect((await abrirModeloPrescricao(c.T.ctx, modelo, deps))?.itens[0]).toMatchObject({ posologia: 'ab', forma: 'Cápsula' });

    const p = await novoPaciente(app.db, c.T.ctx);
    const doc = await criarReceita(c.T.ctx, p.id, deps);
    // a tela (a receita do paciente) também: o item digitado com NUL fica junto com o do modelo, sem o NUL
    const tela = { ...MAGNESIO, posologia: 'c\u0000d', composicao: [{ nome: 'Magnésio\u0000 dimalato', quantidade: '300', unidade: 'mg' }] };
    await carregarModeloNaReceita(c.T.ctx, c.tenant, p.id, doc, { modeloId: modelo, modo: 'acrescentar', conteudo: { itens: [tela], orientacoes: '' }, justificativa: '' }, deps);
    const lido = (await conteudoDe(c, p.id, doc)).conteudo;
    expect(posologias(lido)).toEqual(['cd', 'ab']);
    expect(JSON.stringify(lido)).not.toContain('\u0000');
  });

  it('o 301º item: recusa com o limite (editar um que já existe continua valendo); duas gravações concorrentes no teto (299 + 2) — a trava serializa, uma passa', async () => {
    const c = await consultorio(false);
    await encher(c, 'prescricao_itens_salvos', ITENS_SALVOS_MAX);
    expect(await erros(salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'Novo', item: VITD }, deps))).toEqual({ geral: E.itensCheio });
    const [um] = await listarItensSalvos(c.T.ctx, 'suplementos', deps);
    await expect(salvarItemSalvo(c.T.ctx, c.tenant, um.id, { nome: um.nome, item: MAGNESIO }, deps)).resolves.toBe(um.id);
    expect(await contar(c, 'prescricao_itens_salvos')).toBe(ITENS_SALVOS_MAX);

    const d = await consultorio(false);
    await encher(d, 'prescricao_itens_salvos', ITENS_SALVOS_MAX - 1);
    const r = await Promise.allSettled([
      salvarItemSalvo(d.T.ctx, d.tenant, null, { nome: 'Corrida A', item: VITD }, deps),
      salvarItemSalvo(d.T.ctx, d.tenant, null, { nome: 'Corrida B', item: VITD }, deps),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusa = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((recusa.reason as DocumentoError).erros).toEqual({ geral: E.itensCheio });
    expect(await contar(d, 'prescricao_itens_salvos')).toBe(ITENS_SALVOS_MAX);
  });
});

describe('modelos de prescrição (US-379, RN-394, EP-D30)', () => {
  it('salva sem justificativa, lista com a contagem de itens, abre, edita e exclui; outro consultório não vê', async () => {
    const c = await consultorio(false);
    const doFormulario = { nome: ' Rotina ', itens: [VITD, MAGNESIO], orientacoes: '- Com água\r\n- Depois do almoço', justificativa: 'Fadiga' };
    const id = await salvarModeloPrescricao(c.T.ctx, c.tenant, null, doFormulario, deps);
    expect(await listarModelosPrescricao(c.T.ctx, deps)).toEqual([{ id, nome: 'Rotina', itens: 2 }]);
    const m = await abrirModeloPrescricao(c.T.ctx, id, deps);
    expect(m).toMatchObject({ id, nome: 'Rotina', orientacoes: '- Com água\n- Depois do almoço' });
    expect(m?.itens).toHaveLength(2);
    expect(JSON.stringify(m)).not.toContain('Fadiga');
    await expect(salvarModeloPrescricao(c.T.ctx, c.tenant, id, { nome: 'Rotina', itens: [OMEGA], orientacoes: '' }, deps)).resolves.toBe(id);
    expect(await listarModelosPrescricao(c.T.ctx, deps)).toEqual([{ id, nome: 'Rotina', itens: 1 }]);

    const B = await consultorio(false);
    expect(await listarModelosPrescricao(B.T.ctx, deps)).toEqual([]);
    expect(await abrirModeloPrescricao(B.T.ctx, id, deps)).toBeNull();
    expect(await excluirModeloPrescricao(B.T.ctx, id, deps)).toBe(false);
    expect(await erros(salvarModeloPrescricao(B.T.ctx, B.tenant, id, { nome: 'X', itens: [VITD] }, deps))).toEqual({ geral: E.modeloNaoEncontrado });

    expect(await excluirModeloPrescricao(c.T.ctx, id, deps)).toBe(true);
    expect(await excluirModeloPrescricao(c.T.ctx, id, deps)).toBe(false);
  });

  it('erros: 0 itens (semItens), 21 itens, orientações longas, fitoterápico sem habilitação, nome vazio e repetido', async () => {
    const c = await consultorio(false);
    expect(await erros(salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Vazio', itens: [], orientacoes: '' }, deps))).toEqual({ itens: MSG_PRESCRICAO.semItens });
    expect(await erros(salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Muitos', itens: Array.from({ length: 21 }, () => VITD) }, deps))).toEqual({ itens: MSG_PRESCRICAO.itensDemais });
    expect(await erros(salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Longo', itens: [VITD], orientacoes: 'a'.repeat(2001) }, deps))).toEqual({ orientacoes: MSG_PRESCRICAO.orientacoes });
    expect(await erros(salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Sono', itens: [VITD, VALERIANA] }, deps))).toEqual({ 'itens.1.tipo': MSG_PRESCRICAO.semHabilitacao });
    expect(await erros(salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: '', itens: [VITD] }, deps))).toEqual({ nome: E.nome });
    await salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Rotina', itens: Array.from({ length: 20 }, () => VITD) }, deps);
    expect(await erros(salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'ROTINA', itens: [VITD] }, deps))).toEqual({ nome: E.modeloRepetido });
    expect(await contar(c, 'prescricao_modelos')).toBe(1);
  });

  it('o 101º modelo: recusa com o limite (editar continua valendo); duas gravações concorrentes no teto — uma passa', async () => {
    const c = await consultorio(false);
    await encher(c, 'prescricao_modelos', MODELOS_PRESCRICAO_MAX);
    expect(await erros(salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Novo', itens: [VITD] }, deps))).toEqual({ geral: E.modelosCheio });
    const [um] = await listarModelosPrescricao(c.T.ctx, deps);
    await expect(salvarModeloPrescricao(c.T.ctx, c.tenant, um.id, { nome: um.nome, itens: [OMEGA] }, deps)).resolves.toBe(um.id);

    const d = await consultorio(false);
    await encher(d, 'prescricao_modelos', MODELOS_PRESCRICAO_MAX - 1);
    const r = await Promise.allSettled([
      salvarModeloPrescricao(d.T.ctx, d.tenant, null, { nome: 'Corrida A', itens: [VITD] }, deps),
      salvarModeloPrescricao(d.T.ctx, d.tenant, null, { nome: 'Corrida B', itens: [VITD] }, deps),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason as DocumentoError).erros).toEqual({ geral: E.modelosCheio });
    expect(await contar(d, 'prescricao_modelos')).toBe(MODELOS_PRESCRICAO_MAX);
  });
});

describe('só a sessão nutri', () => {
  it('sessão de paciente e worker: erro do assert antes da transação (nunca a lista vazia do staff_only)', async () => {
    const c = await consultorio(false);
    const p = await novoPaciente(app.db, c.T.ctx);
    const doc = await criarReceita(c.T.ctx, p.id, deps);
    const id = await salvarItemSalvo(c.T.ctx, c.tenant, null, { nome: 'Vitamina D', item: VITD }, deps);
    const modelo = await salvarModeloPrescricao(c.T.ctx, c.tenant, null, { nome: 'Um', itens: [VITD] }, deps);
    const msg = 'prescricao: só a sessão nutri';
    for (const ctx of [ctxPaciente(c.T.tenantId, p.id), { tenantId: c.T.tenantId, role: 'worker' as const }]) {
      await expect(listarItensSalvos(ctx, 'suplementos', deps)).rejects.toThrow(msg);
      await expect(abrirItemSalvo(ctx, id, deps)).rejects.toThrow(msg);
      await expect(salvarItemSalvo(ctx, c.tenant, null, { nome: 'Outro', item: VITD }, deps)).rejects.toThrow(msg);
      await expect(excluirItemSalvo(ctx, id, deps)).rejects.toThrow(msg);
      await expect(listarModelosPrescricao(ctx, deps)).rejects.toThrow(msg);
      await expect(abrirModeloPrescricao(ctx, modelo, deps)).rejects.toThrow(msg);
      await expect(salvarModeloPrescricao(ctx, c.tenant, null, { nome: 'Outro', itens: [VITD] }, deps)).rejects.toThrow(msg);
      await expect(excluirModeloPrescricao(ctx, modelo, deps)).rejects.toThrow(msg);
      await expect(carregarModeloNaReceita(ctx, c.tenant, p.id, doc, { conteudo: { itens: [] }, justificativa: '', modeloId: modelo, modo: 'acrescentar' }, deps)).rejects.toThrow(msg);
    }
    expect(await contar(c, 'prescricao_itens_salvos')).toBe(1);
    expect(await contar(c, 'prescricao_modelos')).toBe(1);
  });
});
