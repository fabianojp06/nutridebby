import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { carregarPlano } from './carregar';
import { MSG_PLANO } from './constantes';
import { PlanoError, PlanoNaoEncontradoError } from './erros';
import { criarDeModelo, criarModelo, excluirModelo, listarModelos, salvarComoModelo } from './modelos';
import { criarRascunho, salvarRascunho } from './rascunho';
import type { RascunhoEnviado } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
const conteudo = (revisao: number, titulo = 'Emagrecimento 1600 kcal'): RascunhoEnviado => ({
  revisao, titulo, metaKcal: '1600', mostrarCalorias: false, orientacoes: 'Evitar frituras.',
  refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [
    { id: randomUUID(), foodId: idTaco(3), quantidadeG: '100', medida: { nome: 'colher de sopa cheia', plural: 'colheres de sopa cheias', gramas: 25, qtd: 4 }, substituiItemId: null },
    { id: randomUUID(), foodId: idTaco(561), quantidadeG: '140', medida: null, substituiItemId: null },
  ] }],
});

describe('modelos de plano (US-024)', () => {
  it('"Criar a partir de modelo": rascunho de Ana com as mesmas refeições e itens; alterar o de Ana não altera o modelo', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id: modelo } = await criarModelo(T.ctx, 'Emagrecimento 1600 kcal', deps);
    await salvarRascunho(T.ctx, modelo, conteudo(0), deps);
    expect(await listarModelos(T.ctx, app.db)).toMatchObject([{ id: modelo, titulo: 'Emagrecimento 1600 kcal', refeicoes: 1 }]);

    const { id } = await criarDeModelo(T.ctx, modelo, ana.id, deps);
    const deAna = await carregarPlano(T.ctx, id, app.db);
    expect(deAna).toMatchObject({ patientId: ana.id, status: 'rascunho', versao: 1, titulo: 'Emagrecimento 1600 kcal', metaKcal: 1600, orientacoes: 'Evitar frituras.' });
    expect(deAna!.refeicoes[0].itens.map((i) => [i.nome, i.quantidadeG, i.medidaCaseiraTxt])).toEqual([
      ['Arroz, tipo 1, cozido', 100, '4 colheres de sopa cheias'],
      ['Feijão, carioca, cozido', 140, null],
    ]);
    await salvarRascunho(T.ctx, id, { ...conteudo(deAna!.revisao, 'Plano de Ana'), refeicoes: [] }, deps);
    const m = await carregarPlano(T.ctx, modelo, app.db);
    expect(m).toMatchObject({ titulo: 'Emagrecimento 1600 kcal', isTemplate: true, patientId: null });
    expect(m!.refeicoes[0].itens).toHaveLength(2);
  });

  it('"Salvar plano como modelo": cópia com is_template e patient_id nulo', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, ana.id, deps);
    await salvarRascunho(T.ctx, id, conteudo(0, 'Plano de Ana'), deps);
    const { id: modelo } = await salvarComoModelo(T.ctx, id, '  Hipertrofia  ', deps);
    expect(await carregarPlano(T.ctx, modelo, app.db)).toMatchObject({ isTemplate: true, patientId: null, status: 'rascunho', titulo: 'Hipertrofia', mostrarCalorias: false });
    expect((await carregarPlano(T.ctx, modelo, app.db))!.refeicoes[0].itens).toHaveLength(2);
    await expect(salvarComoModelo(T.ctx, id, ' ', deps)).rejects.toEqual(new PlanoError({ titulo: MSG_PLANO.titulo }));
  });

  it('paciente com rascunho não recebe outro a partir de modelo; modelo é invisível para outro tenant e para a sessão do paciente', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, A.ctx);
    const { id: modelo } = await criarModelo(A.ctx, 'Base', deps);
    await criarRascunho(A.ctx, ana.id, deps);
    await expect(criarDeModelo(A.ctx, modelo, ana.id, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.rascunhoExiste }));
    expect(await listarModelos(B.ctx, app.db)).toEqual([]);
    expect(await carregarPlano(B.ctx, modelo, app.db)).toBeNull();
    const comoAna = await withTenant(ctxPaciente(A.tenantId, ana.id), (tx) => tx.execute(sql`select id from meal_plans where is_template`), app.db);
    expect(comoAna.rows).toHaveLength(0);
    await excluirModelo(A.ctx, modelo, deps);
    expect(await listarModelos(A.ctx, app.db)).toEqual([]);
  });
});

describe('modelos de plano: limites e isolamento', () => {
  it('copiar mantém a substituição ligada ao novo principal (ids novos); salvar como modelo audita a leitura do plano do paciente', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, ana.id, deps);
    const principal = randomUUID();
    const c = conteudo(0, 'Plano de Ana');
    c.refeicoes[0].itens = [
      { ...c.refeicoes[0].itens[0], id: principal },
      { ...c.refeicoes[0].itens[1], substituiItemId: principal },
    ];
    await salvarRascunho(T.ctx, id, c, deps);
    const { id: modelo } = await salvarComoModelo(T.ctx, id, 'Com substituição', deps);
    const m = (await carregarPlano(T.ctx, modelo, app.db))!;
    const [p, s] = m.refeicoes[0].itens;
    expect(p.id).not.toBe(principal);
    expect(s.substituiItemId).toBe(p.id);
    const leituras = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, ana.id), eq(auditLog.entidade, 'plano_alimentar'), eq(auditLog.entidadeId, id), eq(auditLog.acao, 'ler'))), app.db);
    expect(leituras.length).toBeGreaterThan(0);
  });

  it('plano de outro tenant não vira modelo; plano de paciente não é aceito como modelo nem pode ser excluído como modelo', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, A.ctx);
    const bia = await novoPaciente(app.db, A.ctx);
    const { id: planoAna } = await criarRascunho(A.ctx, ana.id, deps);
    await expect(salvarComoModelo(B.ctx, planoAna, 'Roubado', deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    await expect(salvarComoModelo(A.ctx, 'nao-e-uuid', 'X', deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    expect(await listarModelos(B.ctx, app.db)).toEqual([]);
    await expect(criarDeModelo(A.ctx, planoAna, bia.id, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError); // plano de paciente não é modelo
    await expect(excluirModelo(A.ctx, planoAna, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    expect(await carregarPlano(A.ctx, planoAna, app.db)).not.toBeNull();
    const { id: modelo } = await criarModelo(A.ctx, 'Base', deps);
    await expect(criarDeModelo(B.ctx, modelo, bia.id, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError); // paciente e modelo de outro tenant
    await expect(excluirModelo(B.ctx, modelo, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    await expect(criarModelo(A.ctx, ' ', deps)).rejects.toEqual(new PlanoError({ titulo: MSG_PLANO.titulo }));
    await expect(criarModelo(A.ctx, 'x'.repeat(121), deps)).rejects.toEqual(new PlanoError({ titulo: MSG_PLANO.titulo }));
  });

  it('excluir o modelo apaga suas refeições e não mexe nos planos criados a partir dele; paciente com plano arquivado recebe a próxima versão', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.insert(mealPlans).values({ tenantId: T.tenantId, patientId: ana.id, titulo: 'Antigo', status: 'arquivado', versao: 1 }), app.db);
    const { id: modelo } = await criarModelo(T.ctx, 'Base', deps);
    await salvarRascunho(T.ctx, modelo, conteudo(0), deps);
    const { id } = await criarDeModelo(T.ctx, modelo, ana.id, deps);
    expect(await carregarPlano(T.ctx, id, app.db)).toMatchObject({ versao: 2, status: 'rascunho' });
    await excluirModelo(T.ctx, modelo, deps);
    expect(await carregarPlano(T.ctx, modelo, app.db)).toBeNull();
    const orfas = await withTenant(T.ctx, (tx) => tx.execute(sql`select id from meals where plan_id = ${modelo}`), app.db);
    expect(orfas.rows).toHaveLength(0);
    expect((await carregarPlano(T.ctx, id, app.db))!.refeicoes[0].itens).toHaveLength(2);
    await expect(excluirModelo(T.ctx, modelo, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
  });
});
