import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq, ne, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { estadoInicial, resumoDeNutrientes } from '@/app/painel/planos/editor/estado';
import { carregarPlano, paraCliente } from '@/modules/plano-alimentar/carregar';
import { PlanoError } from '@/modules/plano-alimentar/erros';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import type { CorpoSalvamento } from '@/modules/plano-alimentar/tipos';
import { MSG_NUTRIENTES, NUTRIENTES } from './nutrientes';
import { carregarReferencia, excluirReferencia, listarReferencias, ReferenciaError, referenciasParaPlano, salvarReferencia } from './referencias';
import { MSG_REFERENCIAS } from './referencias-constantes';
import { idTaco } from './taco';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const deps = { db: app.db };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ReferenciaError || e instanceof PlanoError) return e.erros;
    throw e;
  }
  throw new Error('esperava ReferenciaError ou PlanoError');
};

const FONTE = 'DRI/IOM 2006 — conferida pela nutricionista';
const MULHER = { nome: 'Mulher 19 a 50 anos', fonte: FONTE, valores: { ferro_mg: { meta: '18', maximo: '45' } } };
const fonteDoArquivo = (f: string) => readFileSync(path.resolve(f), 'utf8');

describe('perfis de referência (US-232, RN-238)', () => {
  it('"Cadastrar perfil": aparece na lista com "1 nutriente" e a fonte; os valores voltam como números', async () => {
    const T = await novoTenant(app.db);
    const { id } = await salvarReferencia(T.ctx, null, MULHER, deps);
    expect(await listarReferencias(T.ctx, app.db)).toEqual([{ id, nome: 'Mulher 19 a 50 anos', fonte: FONTE, nutrientes: 1 }]);
    expect(MSG_REFERENCIAS.contagem(1)).toBe('1 nutriente');
    expect(MSG_REFERENCIAS.contagem(3)).toBe('3 nutrientes');
    expect(await carregarReferencia(T.ctx, id, app.db)).toEqual({ id, nome: 'Mulher 19 a 50 anos', fonte: FONTE, valores: { ferro_mg: { meta: 18, maximo: 45 } } });
  });

  it('"Fonte obrigatória": sem fonte (ou com 1 letra) o erro exato da US-232; mais de 300 caracteres também é recusado', async () => {
    const T = await novoTenant(app.db);
    expect(MSG_REFERENCIAS.fonte).toBe('Informe a fonte dos valores (ex.: DRI/IOM 2006, IN 75/2020 da ANVISA).');
    expect(await erros(salvarReferencia(T.ctx, null, { ...MULHER, fonte: '' }, deps))).toEqual({ fonte: 'Informe a fonte dos valores (ex.: DRI/IOM 2006, IN 75/2020 da ANVISA).' });
    expect(await erros(salvarReferencia(T.ctx, null, { ...MULHER, fonte: '   D  ' }, deps))).toEqual({ fonte: MSG_REFERENCIAS.fonte });
    expect(await erros(salvarReferencia(T.ctx, null, { ...MULHER, fonte: 'x'.repeat(301) }, deps))).toEqual({ fonte: MSG_REFERENCIAS.fonteLonga });
    expect(await listarReferencias(T.ctx, app.db)).toEqual([]);
  });

  it('"Pelo menos um nutriente": todos vazios → o erro exato da US-232; meta acima do máximo, negativo ou texto → erro na linha do nutriente', async () => {
    const T = await novoTenant(app.db);
    const vazios = Object.fromEntries(NUTRIENTES.map((n) => [n.chave, { meta: '', maximo: '' }]));
    expect(await erros(salvarReferencia(T.ctx, null, { ...MULHER, valores: vazios }, deps))).toEqual({ valores: 'Informe a meta ou o máximo de pelo menos um nutriente.' });
    expect(await erros(salvarReferencia(T.ctx, null, { ...MULHER, valores: {} }, deps))).toEqual({ valores: MSG_REFERENCIAS.semValor });
    expect(await erros(salvarReferencia(T.ctx, null, { ...MULHER, valores: { ...vazios, sodio_mg: { meta: '2400', maximo: '2300' } } }, deps))).toEqual({ 'valores.sodio_mg': MSG_REFERENCIAS.metaAcimaDoMaximo });
    expect(await erros(salvarReferencia(T.ctx, null, { ...MULHER, valores: { ferro_mg: { meta: '-3' }, calcio_mg: { maximo: 'muito' } } }, deps))).toEqual({
      'valores.ferro_mg': MSG_REFERENCIAS.valor,
      'valores.calcio_mg': MSG_REFERENCIAS.valor,
    });
    // só a meta, só o máximo, vírgula decimal e meta igual ao máximo
    const { id } = await salvarReferencia(T.ctx, null, { ...MULHER, valores: { ...vazios, ferro_mg: { meta: '18' }, sodio_mg: { maximo: '2300' }, zinco_mg: { meta: '8,5', maximo: '8,5' } } }, deps);
    expect((await carregarReferencia(T.ctx, id, app.db))!.valores).toEqual({ ferro_mg: { meta: 18 }, sodio_mg: { maximo: 2300 }, zinco_mg: { meta: 8.5, maximo: 8.5 } });
    // chave fora do catálogo só vem de entrada adulterada
    expect(await erros(salvarReferencia(T.ctx, null, { ...MULHER, valores: { arsenico_mg: { meta: '1' } } }, deps))).toEqual({ geral: MSG_REFERENCIAS.valor });
  });

  it('nome repetido no consultório é recusado (também ao alterar); em outro consultório, pode', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    await salvarReferencia(A.ctx, null, MULHER, deps);
    expect(await erros(salvarReferencia(A.ctx, null, { ...MULHER, nome: '  Mulher 19 a 50 anos ' }, deps))).toEqual({ nome: MSG_REFERENCIAS.nomeRepetido });
    const { id: outro } = await salvarReferencia(A.ctx, null, { ...MULHER, nome: 'Homem 19 a 50 anos' }, deps);
    expect(await erros(salvarReferencia(A.ctx, outro, MULHER, deps))).toEqual({ nome: MSG_REFERENCIAS.nomeRepetido });
    await expect(salvarReferencia(B.ctx, null, MULHER, deps)).resolves.toMatchObject({ id: expect.any(String) });
    expect(await erros(salvarReferencia(A.ctx, null, { ...MULHER, nome: '' }, deps))).toEqual({ nome: MSG_REFERENCIAS.nome });
    expect(await erros(salvarReferencia(A.ctx, null, { ...MULHER, nome: 'x'.repeat(81) }, deps))).toEqual({ nome: MSG_REFERENCIAS.nome });
  });

  it('RLS: outro consultório não vê, não altera e não exclui o perfil', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { id } = await salvarReferencia(A.ctx, null, MULHER, deps);
    expect(await listarReferencias(B.ctx, app.db)).toEqual([]);
    expect(await referenciasParaPlano(B.ctx, app.db)).toEqual([]);
    expect(await carregarReferencia(B.ctx, id, app.db)).toBeNull();
    expect(await erros(salvarReferencia(B.ctx, id, { ...MULHER, nome: 'Tomado' }, deps))).toEqual({ geral: MSG_REFERENCIAS.naoEncontrado });
    expect(await erros(excluirReferencia(B.ctx, id, deps))).toEqual({ geral: MSG_REFERENCIAS.naoEncontrado });
    expect(await carregarReferencia(A.ctx, id, app.db)).toMatchObject({ nome: 'Mulher 19 a 50 anos' });
  });

  it('"Lista vazia": consultório sem perfis → a lista é vazia e a tela mostra o texto exato da US-232 (nada pré-carregado, D11)', async () => {
    const T = await novoTenant(app.db);
    expect(await listarReferencias(T.ctx, app.db)).toEqual([]);
    expect(MSG_REFERENCIAS.vazio).toBe('Nenhum perfil cadastrado. A plataforma não traz valores de referência prontos: cadastre os que você usa, com a fonte.');
    const pagina = fonteDoArquivo('src/app/painel/planos/referencias/page.tsx');
    expect(pagina).toContain('perfis.length === 0 ? (\n        <p>{MSG_REFERENCIAS.vazio}</p>');
    expect(pagina).toContain('href="/painel/planos/referencias/novo"');
  });
});

describe('perfil e nutrientes no plano (US-233, RN-238, RN-239, D30)', () => {
  const corpo = (revisao: number, extra: Partial<CorpoSalvamento> = {}): CorpoSalvamento => ({
    revisao, envio: randomUUID(), titulo: 'Plano', metaKcal: '', mostrarCalorias: true, orientacoes: '',
    refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [{ id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: null, substituiItemId: null }] }],
    ...extra,
  });
  const linha = async (T: TenantDeTeste, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(mealPlans).where(eq(mealPlans.id, id)), app.db))[0];
  async function rascunho(T: TenantDeTeste, extra: Partial<CorpoSalvamento> = {}) {
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    await salvarRascunho(T.ctx, id, corpo(0, extra), deps);
    return { p, id };
  }

  it('o salvamento grava o perfil, os nutrientes e a caixa do PDF; ausentes ficam como estão; o 13º nutriente → "Escolha até 12 nutrientes."', async () => {
    const T = await novoTenant(app.db);
    const { id: perfil } = await salvarReferencia(T.ctx, null, MULHER, deps);
    const { id } = await rascunho(T, { referenciaId: perfil, nutrientesExibidos: ['ferro_mg', 'calcio_mg', 'sodio_mg'], mostrarMicrosPdf: true });
    expect(await linha(T, id)).toMatchObject({ referenciaId: perfil, nutrientesExibidos: ['ferro_mg', 'calcio_mg', 'sodio_mg'], mostrarMicrosPdf: true });
    expect(await carregarPlano(T.ctx, id, app.db)).toMatchObject({ referenciaId: perfil, referenciaCongelada: null, nutrientesExibidos: ['ferro_mg', 'calcio_mg', 'sodio_mg'], mostrarMicrosPdf: true });

    // o editor de antes (sem os campos) não apaga o que está gravado
    await salvarRascunho(T.ctx, id, corpo(1), deps);
    expect(await linha(T, id)).toMatchObject({ referenciaId: perfil, nutrientesExibidos: ['ferro_mg', 'calcio_mg', 'sodio_mg'], mostrarMicrosPdf: true });

    expect(MSG_NUTRIENTES.limite).toBe('Escolha até 12 nutrientes.');
    const treze = NUTRIENTES.slice(0, 13).map((n) => n.chave);
    expect(await erros(salvarRascunho(T.ctx, id, corpo(2, { nutrientesExibidos: treze }), deps))).toEqual({ nutrientesExibidos: 'Escolha até 12 nutrientes.' });
    await salvarRascunho(T.ctx, id, corpo(2, { nutrientesExibidos: treze.slice(0, 12), referenciaId: null, mostrarMicrosPdf: false }), deps);
    expect(await linha(T, id)).toMatchObject({ referenciaId: null, nutrientesExibidos: treze.slice(0, 12), mostrarMicrosPdf: false });
    // chave fora do catálogo ou repetida e id fora do formato: entrada adulterada
    for (const extra of [{ nutrientesExibidos: ['ferro_mg', 'ferro_mg'] }, { nutrientesExibidos: ['arsenico_mg'] }, { referenciaId: 'perfil' }, { mostrarMicrosPdf: 'sim' as unknown as boolean }])
      expect(await erros(salvarRascunho(T.ctx, id, corpo(3, extra), deps))).toHaveProperty('geral');
  });

  it('perfil de outro consultório (ou já excluído) vira "Sem perfil" no salvamento', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { id: deB } = await salvarReferencia(B.ctx, null, MULHER, deps);
    const { id } = await rascunho(A, { referenciaId: deB });
    expect((await linha(A, id)).referenciaId).toBeNull();
    const { id: excluido } = await salvarReferencia(A.ctx, null, MULHER, deps);
    await excluirReferencia(A.ctx, excluido, deps);
    await salvarRascunho(A.ctx, id, corpo(1, { referenciaId: excluido }), deps);
    expect((await linha(A, id)).referenciaId).toBeNull();
  });

  it('"Excluir perfil em uso": a confirmação tem o texto exato; o rascunho fica "Sem perfil" e o publicado mantém a cópia, sem nenhuma linha nova no audit_log dele', async () => {
    expect(MSG_REFERENCIAS.excluir).toBe('Excluir este perfil? Os rascunhos e modelos que o usam ficam sem perfil; os planos publicados mantêm a cópia.');
    expect(fonteDoArquivo('src/app/painel/planos/referencias/referencia-form.tsx')).toContain('window.confirm(MSG_REFERENCIAS.excluir)');
    expect(MSG_NUTRIENTES.semPerfil).toBe('Sem perfil');

    const T = await novoTenant(app.db);
    const { id: perfil } = await salvarReferencia(T.ctx, null, MULHER, deps);
    const pub = await rascunho(T, { referenciaId: perfil, nutrientesExibidos: ['ferro_mg'] });
    expect(await publicarPlano(T.ctx, pub.p.id, pub.id, deps)).toEqual({ versao: 1 });
    const copia = (await linha(T, pub.id)).referenciaCongelada;
    expect(copia).toEqual({ id: perfil, nome: 'Mulher 19 a 50 anos', fonte: FONTE, valores: { ferro_mg: { meta: 18, maximo: 45 } } });
    const { id: emRascunho } = await rascunho(T, { referenciaId: perfil });
    const escritasNoPublicado = async () =>
      (await withTenant(T.ctx, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(and(eq(auditLog.entidadeId, pub.id), ne(auditLog.acao, 'ler'))), app.db))[0].n;
    const antes = await escritasNoPublicado();

    await excluirReferencia(T.ctx, perfil, deps);
    expect((await linha(T, emRascunho)).referenciaId).toBeNull();
    const plano = await carregarPlano(T.ctx, emRascunho, app.db);
    expect(estadoInicial(paraCliente(plano!)).referenciaId).toBeNull(); // o editor mostra "Sem perfil"
    expect(await linha(T, pub.id)).toMatchObject({ status: 'publicado', referenciaId: null, referenciaCongelada: copia });
    expect(await escritasNoPublicado()).toBe(antes);
    expect(await listarReferencias(T.ctx, app.db)).toEqual([]);
  });

  it('o rascunho traz os micros atuais de cada alimento; o publicado em formato antigo (sem micros) mostra "Micronutrientes não registrados nesta versão do plano."', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await rascunho(T, { nutrientesExibidos: ['ferro_mg'] });
    const doRascunho = await carregarPlano(T.ctx, id, app.db);
    expect(doRascunho!.refeicoes[0].itens[0].micros).toMatchObject({ ferro_mg: expect.any(Number) });
    const r = resumoDeNutrientes(estadoInicial(paraCliente(doRascunho!)), 'todos', ['ferro_mg'], null);
    expect(r).toMatchObject({ tipo: 'linhas', linhas: [{ chave: 'ferro_mg', nome: 'Ferro', meta: null }] });

    await publicarPlano(T.ctx, p.id, id, deps);
    // o jsonb que o publicarPlano de antes do Plano 19 gravava: sem fonte, versão nem micros (molde de carregar.test.ts)
    await withTenant(
      T.ctx,
      (tx) =>
        tx.execute(sql`update meal_items mi set nutrientes = jsonb_build_object('nome', f.nome, 'origem', 'TACO', 'kcal', f.kcal, 'proteinaG', f.proteina_g,
            'carboidratoG', f.carboidrato_g, 'lipidioG', f.lipidio_g, 'fibraG', f.fibra_g) from foods f where f.id = mi.food_id and mi.plan_id = ${id}`),
      app.db,
    );
    const antigo = await carregarPlano(T.ctx, id, app.db);
    expect(antigo!.refeicoes[0].itens[0].micros).toBeNull();
    expect(resumoDeNutrientes(estadoInicial(paraCliente(antigo!)), 'todos', ['ferro_mg'], antigo!.referenciaCongelada)).toEqual({ tipo: 'naoRegistrados' });
    expect(MSG_NUTRIENTES.naoRegistrados).toBe('Micronutrientes não registrados nesta versão do plano.');
  });
});
