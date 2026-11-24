import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { exams, examesCatalogo, examesModelosSolicitacao } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { normalizarNome } from '@/modules/ia/correspondencia';
import {
  abrirExameDoCatalogo,
  adicionarNomesParaComecar,
  catalogoParaLancamentoNaTransacao,
  excluirExameDoCatalogo,
  listarCatalogo,
  nomesParaComecarFaltando,
  salvarExameDoCatalogo,
} from './catalogo';
import { CatalogoError } from './catalogo-regras';
import { CATALOGO_MAX, MSG_EXAMES, NOMES_PARA_COMECAR, PAINEIS_PARA_COMECAR } from './constantes';

/** Plano 22 (T3, US-370, RN-370 a RN-375): o catálogo de exames do consultório pelo módulo, no Postgres do Testcontainers. */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
const E = MSG_EXAMES.erros;
const FUSO = { fuso: 'America/Sao_Paulo' };

const erros = async (p: Promise<unknown>): Promise<Record<string, string>> => {
  try {
    await p;
  } catch (e) {
    if (e instanceof CatalogoError) return e.erros;
    throw e;
  }
  throw new Error('esperava CatalogoError');
};
const faixa = (o: Record<string, unknown> = {}) => ({ sexo: 'todos', idadeMin: '18', idadeMax: '120', aPartirDe: '', abaixoDe: '20', categoria: 'Deficiência', fonte: 'Diretriz X, 2024', ...o });
/** Exames gravados direto (sem módulo), para encher o catálogo até o limite. */
async function encher(T: TenantDeTeste, n: number) {
  await withTenant(T.ctx, (tx) => tx.insert(examesCatalogo).values(Array.from({ length: n }, (_, i) => ({ tenantId: T.tenantId, nome: `Exame ${i}` }))), app.db);
}
const contar = async (T: TenantDeTeste) => (await listarCatalogo(T.ctx, deps)).length;

describe('catálogo de exames (US-370)', () => {
  it('cria "Ferritina" (ng/mL, outro nome "ferritina sérica") e lê de volta; outro consultório não vê', async () => {
    const T = await novoTenant(app.db);
    const id = await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: ' Ferritina ', unidade: 'ng/mL', sinonimos: 'ferritina sérica' }, deps);
    expect(await abrirExameDoCatalogo(T.ctx, id, deps)).toMatchObject({ id, nome: 'Ferritina', unidade: 'ng/mL', sinonimos: ['ferritina sérica'], componentes: [], faixas: [], modeloNotaAbaixo: null, modeloNotaAcima: null });
    expect((await listarCatalogo(T.ctx, deps)).map((e) => e.nome)).toEqual(['Ferritina']);
    const B = await novoTenant(app.db);
    expect(await listarCatalogo(B.ctx, deps)).toEqual([]);
    expect(await abrirExameDoCatalogo(B.ctx, id, deps)).toBeNull();
    expect(await excluirExameDoCatalogo(B.ctx, id, deps)).toBe(false);
    expect(await erros(salvarExameDoCatalogo(B.ctx, FUSO, id, { nome: 'Outro' }, deps))).toEqual({ geral: E.naoEncontrado });
    expect(await abrirExameDoCatalogo(T.ctx, id, deps)).toMatchObject({ nome: 'Ferritina' });
  });

  it('nome que colide com o outro nome de outro exame: a mensagem exata com o nome do exame que já existe', async () => {
    const T = await novoTenant(app.db);
    await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Glicemia de jejum', sinonimos: ['glicose de jejum'] }, deps);
    expect(await erros(salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Glicose de Jejum' }, deps))).toEqual({ nome: E.nomeRepetido('Glicemia de jejum') });
    // um outro nome que é o nome de outro exame (sem acento e maiúsculas)
    expect(await erros(salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Glicose', sinonimos: ['GLICÉMIA DE JEJUM'] }, deps))).toEqual({ sinonimos: E.nomeRepetido('Glicemia de jejum') });
    // o próprio exame pode ser salvo de novo com os mesmos nomes
    const [g] = await listarCatalogo(T.ctx, deps);
    await expect(salvarExameDoCatalogo(T.ctx, FUSO, g.id, { nome: 'Glicemia de jejum', sinonimos: ['glicose de jejum', 'glicose em jejum'] }, deps)).resolves.toBe(g.id);
    expect(await contar(T)).toBe(1);
  });

  it('duas gravações concorrentes que colidem só pelos outros nomes: a trava serializa — uma passa, a outra recebe a mensagem', async () => {
    const T = await novoTenant(app.db);
    const r = await Promise.allSettled([
      salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Glicemia de jejum', sinonimos: ['Glicose de jejum'] }, deps),
      salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Glicose em jejum', sinonimos: ['glicose de jejum'] }, deps),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusa = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(recusa.reason).toBeInstanceOf(CatalogoError);
    expect(Object.values((recusa.reason as CatalogoError).erros)[0]).toMatch(/^Já existe um exame com este nome ou com um destes outros nomes: Glic/);
    expect(await contar(T)).toBe(1);
  });

  it('o 501º exame: "O catálogo chegou ao limite de 500 exames." (editar um que já existe continua valendo)', async () => {
    const T = await novoTenant(app.db);
    await encher(T, CATALOGO_MAX);
    expect(await erros(salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Ferritina' }, deps))).toEqual({ geral: E.catalogoCheio });
    const [um] = await listarCatalogo(T.ctx, deps);
    await expect(salvarExameDoCatalogo(T.ctx, FUSO, um.id, { nome: um.nome, unidade: 'mg/dL' }, deps)).resolves.toBe(um.id);
    expect(await contar(T)).toBe(CATALOGO_MAX);
  });

  it('faixas: sobreposição recusada; troca de unidade com faixas recusada e nada muda; atualizadaEm só na faixa alterada', async () => {
    const T = await novoTenant(app.db);
    const sobrepoe = await erros(
      salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: '25-hidroxivitamina D', unidade: 'ng/mL', faixas: [faixa(), faixa({ sexo: 'F', idadeMin: '30', idadeMax: '50', abaixoDe: '25', categoria: 'Insuficiente' })] }, deps),
    );
    expect(sobrepoe).toEqual({ 'faixas.1.abaixoDe': E.sobreposicao });

    const dia1 = new Date('2026-11-10T15:00:00Z');
    const dia2 = new Date('2026-11-17T15:00:00Z');
    const duas = [faixa(), faixa({ aPartirDe: '20', abaixoDe: '30', categoria: 'Insuficiente' })];
    const id = await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: '25-hidroxivitamina D', unidade: 'ng/mL', faixas: duas }, { ...deps, agora: dia1 });
    const antes = await abrirExameDoCatalogo(T.ctx, id, deps);
    expect(antes?.faixas.map((f) => f.atualizadaEm)).toEqual(['2026-11-10', '2026-11-10']);
    expect(antes?.faixas[0]).toEqual({ sexo: null, idadeMin: 18, idadeMax: 120, aPartirDe: null, abaixoDe: 20, categoria: 'Deficiência', fonte: 'Diretriz X, 2024', atualizadaEm: '2026-11-10' });

    for (const unidade of ['nmol/L', '']) {
      expect(await erros(salvarExameDoCatalogo(T.ctx, FUSO, id, { nome: '25-hidroxivitamina D', unidade, faixas: duas }, { ...deps, agora: dia2 }))).toEqual({ unidade: E.trocarUnidade });
    }
    expect(await abrirExameDoCatalogo(T.ctx, id, deps)).toEqual(antes);

    await salvarExameDoCatalogo(T.ctx, FUSO, id, { nome: '25-hidroxivitamina D', unidade: 'ng/mL', faixas: [faixa(), faixa({ aPartirDe: '20', abaixoDe: '30', categoria: 'Insuficiente', fonte: 'Diretriz Y, 2025' })] }, { ...deps, agora: dia2 });
    expect((await abrirExameDoCatalogo(T.ctx, id, deps))?.faixas.map((f) => [f.fonte, f.atualizadaEm])).toEqual([
      ['Diretriz X, 2024', '2026-11-10'],
      ['Diretriz Y, 2025', '2026-11-17'],
    ]);
    // sem faixas na gravação, a unidade pode mudar (as faixas saem junto)
    await salvarExameDoCatalogo(T.ctx, FUSO, id, { nome: '25-hidroxivitamina D', unidade: 'nmol/L' }, deps);
    expect(await abrirExameDoCatalogo(T.ctx, id, deps)).toMatchObject({ unidade: 'nmol/L', faixas: [] });
  });

  it('painel salvo sem unidade, faixas nem modelos de nota; a leitura para o lançamento traz os componentes', async () => {
    const T = await novoTenant(app.db);
    const componentes = PAINEIS_PARA_COMECAR[0].componentes;
    const id = await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Hemograma completo', componentes: componentes.join('\n') }, deps);
    expect(await abrirExameDoCatalogo(T.ctx, id, deps)).toMatchObject({ unidade: null, faixas: [], componentes, modeloNotaAbaixo: null, modeloNotaAcima: null });
    expect(await erros(salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Lipidograma', componentes: 'HDL\nLDL', unidade: 'mg/dL' }, deps))).toEqual({ componentes: E.painelSemFaixa });
    const itens = await withTenant(T.ctx, (tx) => catalogoParaLancamentoNaTransacao(tx), app.db);
    expect(itens).toEqual([{ id, nome: 'Hemograma completo', unidade: null, sinonimos: [], componentes, faixas: [] }]);
  });

  it('nomes para começar: some o que já entrou (nome normalizado); os comuns entram só com nome e outros nomes, o hemograma como painel', async () => {
    const T = await novoTenant(app.db);
    const todos = await nomesParaComecarFaltando(T.ctx, deps);
    expect(todos).toHaveLength(NOMES_PARA_COMECAR.length + PAINEIS_PARA_COMECAR.length);
    await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'GLICEMIA DE JEJUM' }, deps);
    // "Tireotrofina" é outro nome do TSH: o TSH continua faltando, mas entra sem esse outro nome
    await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Tireotrofina' }, deps);
    const faltando = await nomesParaComecarFaltando(T.ctx, deps);
    expect(faltando.map((n) => n.nome)).not.toContain('Glicemia de jejum');
    expect(faltando.map((n) => n.nome)).toContain('TSH');

    expect(await adicionarNomesParaComecar(T.ctx, ['Vitamina D', 'TSH', 'Hemograma completo', 'Glicemia de jejum', 'Mineralograma'], deps)).toBe(3);
    const lista = await listarCatalogo(T.ctx, deps);
    expect(lista.find((e) => e.nome === 'Vitamina D')).toMatchObject({ unidade: null, faixas: [], componentes: [], sinonimos: NOMES_PARA_COMECAR.find((n) => n.nome === 'Vitamina D')!.sinonimos });
    expect(lista.find((e) => e.nome === 'TSH')?.sinonimos).toEqual(['Hormônio tireoestimulante']);
    expect(lista.find((e) => e.nome === 'Hemograma completo')).toMatchObject({ unidade: null, faixas: [], sinonimos: [], componentes: PAINEIS_PARA_COMECAR[0].componentes, modeloNotaAbaixo: null, modeloNotaAcima: null });
    expect(lista).toHaveLength(5);
    const depois = (await nomesParaComecarFaltando(T.ctx, deps)).map((n) => n.nome);
    for (const n of ['Vitamina D', 'TSH', 'Hemograma completo', 'Glicemia de jejum']) expect(depois).not.toContain(n);
    // de novo: nada a acrescentar
    expect(await adicionarNomesParaComecar(T.ctx, ['Vitamina D'], deps)).toBe(0);
  });

  it('nomes para começar com 499 no catálogo: adicionar 2 recusa com a mensagem do limite e nada é gravado', async () => {
    const T = await novoTenant(app.db);
    await encher(T, CATALOGO_MAX - 1);
    expect(await erros(adicionarNomesParaComecar(T.ctx, ['TSH', 'T4 livre'], deps))).toEqual({ geral: E.catalogoCheio });
    expect(await contar(T)).toBe(CATALOGO_MAX - 1);
    expect(await adicionarNomesParaComecar(T.ctx, ['TSH'], deps)).toBe(1);
  });

  it('nomes para começar junto com uma gravação concorrente que colide: a trava serializa — nenhum nome normalizado repetido', async () => {
    const T = await novoTenant(app.db);
    await Promise.allSettled([adicionarNomesParaComecar(T.ctx, ['TSH'], deps), salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Tireotrofina' }, deps)]);
    const nomes = (await listarCatalogo(T.ctx, deps)).flatMap((e) => [e.nome, ...e.sinonimos].map(normalizarNome));
    expect(nomes.filter((n) => n === 'tireotrofina')).toHaveLength(1);
    expect(new Set(nomes).size).toBe(nomes.length);
  });

  it('excluir não muda um exame lançado nem um modelo de solicitação (cópia do nome, sem FK)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = await salvarExameDoCatalogo(T.ctx, FUSO, null, { nome: 'Ferritina', unidade: 'ng/mL' }, deps);
    const valores = [{ nome: 'Ferritina', valor: 18, unidade: 'ng/mL', referencia: '15 a 150' }];
    const [ex] = await withTenant(T.ctx, (tx) => tx.insert(exams).values({ tenantId: T.tenantId, patientId: p.id, data: '2026-11-01', titulo: 'Ferro', valores }).returning(), app.db);
    const [mod] = await withTenant(T.ctx, (tx) => tx.insert(examesModelosSolicitacao).values({ tenantId: T.tenantId, nome: 'Ferro', exames: [{ nome: 'Ferritina' }] }).returning(), app.db);
    expect(await excluirExameDoCatalogo(T.ctx, id, deps)).toBe(true);
    expect(await excluirExameDoCatalogo(T.ctx, id, deps)).toBe(false);
    expect(await abrirExameDoCatalogo(T.ctx, id, deps)).toBeNull();
    const [exDepois] = await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, ex.id)), app.db);
    expect(exDepois).toEqual(ex);
    const [modDepois] = await withTenant(T.ctx, (tx) => tx.select().from(examesModelosSolicitacao).where(eq(examesModelosSolicitacao.id, mod.id)), app.db);
    expect(modDepois).toEqual(mod);
  });

  it('sessão de paciente: erro do assert antes da transação (nunca a lista vazia do staff_only)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const P = ctxPaciente(T.tenantId, p.id);
    const msg = 'exames: só a sessão nutri';
    await expect(listarCatalogo(P, deps)).rejects.toThrow(msg);
    await expect(abrirExameDoCatalogo(P, '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b', deps)).rejects.toThrow(msg);
    await expect(salvarExameDoCatalogo(P, FUSO, null, { nome: 'Ferritina' }, deps)).rejects.toThrow(msg);
    await expect(excluirExameDoCatalogo(P, '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b', deps)).rejects.toThrow(msg);
    await expect(nomesParaComecarFaltando(P, deps)).rejects.toThrow(msg);
    await expect(adicionarNomesParaComecar(P, ['TSH'], deps)).rejects.toThrow(msg);
    await expect(listarCatalogo({ tenantId: T.tenantId, role: 'worker' }, deps)).rejects.toThrow(msg);
    expect(await contar(T)).toBe(0);
  });

  it('id que não é uuid: abrir devolve null e excluir, false (sem consulta)', async () => {
    const T = await novoTenant(app.db);
    expect(await abrirExameDoCatalogo(T.ctx, 'x', deps)).toBeNull();
    expect(await excluirExameDoCatalogo(T.ctx, 'x', deps)).toBe(false);
    expect(await erros(salvarExameDoCatalogo(T.ctx, FUSO, 'x', { nome: 'Ferritina' }, deps))).toEqual({ geral: E.naoEncontrado });
  });
});
