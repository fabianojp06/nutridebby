import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { mealItems, mealPlans, notifications, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { criarAlimento, editarAlimento, excluirAlimento } from '@/modules/alimentos/alimentos';
import { MSG_ALIMENTO } from '@/modules/alimentos/alimentos-constantes';
import { idTaco } from '@/modules/alimentos/taco';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { carregarPlano } from './carregar';
import { MSG_PLANO } from './constantes';
import { PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from './erros';
import { criarModelo } from './modelos';
import { editarPublicado, publicarPlano } from './publicacao';
import { criarRascunho, salvarRascunho } from './rascunho';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const deps = { db: app.db, now: new Date('2026-10-01T15:00:00Z') };

const item = (foodId: string, quantidadeG = '100', substituiItemId: string | null = null) => ({ id: randomUUID(), foodId, quantidadeG, medida: null, substituiItemId });
const corpo = (revisao: number, itens = [item(idTaco(3))], horario = '12:00') => ({
  revisao, envio: randomUUID(), titulo: 'Plano de Ana', metaKcal: '2000', mostrarCalorias: false, orientacoes: '',
  refeicoes: [{ id: randomUUID(), nome: 'Almoço', horario, observacao: '', itens }],
});

async function publicado(T: TenantDeTeste, itens = [item(idTaco(3))]) {
  const p = await novoPaciente(app.db, T.ctx);
  const { id } = await criarRascunho(T.ctx, p.id, deps);
  await salvarRascunho(T.ctx, id, corpo(0, itens), deps);
  await publicarPlano(T.ctx, p.id, id, deps);
  return { p, id };
}

const jobsDoPlano = async (planId: string) =>
  Number((await owner.pool.query(`select count(*)::int as n from pgboss.job where name = 'plano-pdf' and data->>'planId' = $1`, [planId])).rows[0].n);

describe('publicação e versionamento (US-025, RN-01)', () => {
  it('"Primeira publicação": status publicado, versão 1, PDF pendente e job na fila na mesma transação', async () => {
    const T = await novoTenant(app.db);
    const { id } = await publicado(T);
    expect(await carregarPlano(T.ctx, id, app.db)).toMatchObject({ status: 'publicado', versao: 1, publicadoEm: '2026-10-01T15:00:00.000Z', pdfStatus: 'pendente', pdfPath: null });
    expect(await jobsDoPlano(id)).toBe(1);
  });

  it('"Nova versão arquiva a anterior": Editar cria o rascunho v2, a v1 segue publicada; publicar a v2 arquiva a v1', async () => {
    const T = await novoTenant(app.db);
    const { p, id: v1 } = await publicado(T);
    const { id: v2, criado } = await editarPublicado(T.ctx, p.id, v1, deps);
    expect(criado).toBe(true);
    expect(await editarPublicado(T.ctx, p.id, v1, deps)).toEqual({ id: v2, criado: false });
    const rasc = await carregarPlano(T.ctx, v2, app.db);
    expect(rasc).toMatchObject({ status: 'rascunho', versao: 2, titulo: 'Plano de Ana' });
    expect(rasc!.refeicoes[0].itens).toHaveLength(1);
    expect((await carregarPlano(T.ctx, v1, app.db))?.status).toBe('publicado');
    await publicarPlano(T.ctx, p.id, v2, deps);
    expect((await carregarPlano(T.ctx, v1, app.db))?.status).toBe('arquivado');
    expect((await carregarPlano(T.ctx, v2, app.db))?.status).toBe('publicado');
    const publicados = await withTenant(T.ctx, (tx) => tx.select().from(mealPlans).where(and(eq(mealPlans.patientId, p.id), eq(mealPlans.status, 'publicado'))), app.db);
    expect(publicados).toHaveLength(1);
  });

  it('"o banco nunca tem 2 planos publicados para P": o índice único parcial recusa', async () => {
    const T = await novoTenant(app.db);
    const { p } = await publicado(T);
    await expect(
      withTenant(T.ctx, (tx) => tx.insert(mealPlans).values({ tenantId: T.tenantId, patientId: p.id, titulo: 'Duplo', status: 'publicado', versao: 9 }), app.db),
    ).rejects.toSatisfy((e: unknown) => uniqueViolation(e) === 'meal_plans_um_publicado_idx');
  });

  it('só publica plano com refeição, horário e alimento em toda refeição', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    await expect(publicarPlano(T.ctx, p.id, id, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.publicarVazio }));
    await salvarRascunho(T.ctx, id, corpo(0, [item(idTaco(3))], ''), deps);
    await expect(publicarPlano(T.ctx, p.id, id, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.publicarHorario }));
    const c = corpo(1);
    await salvarRascunho(T.ctx, id, { ...c, refeicoes: [...c.refeicoes, { id: randomUUID(), nome: 'Ceia', horario: '21:00', observacao: '', itens: [] }] }, deps);
    await expect(publicarPlano(T.ctx, p.id, id, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.publicarRefeicaoVazia('Ceia') }));
    expect((await carregarPlano(T.ctx, id, app.db))?.status).toBe('rascunho');
  });

  it('Review Focus 4 (D10): corrigir "Meu alimento" depois não muda o plano publicado; o rascunho novo usa o valor novo; excluir é recusado', async () => {
    const T = await novoTenant(app.db);
    const { id: foodId } = await criarAlimento(T.ctx, { nome: 'Pão low carb Marca X', grupo: 'Cereais e derivados', kcal: '250', proteinaG: '12', carboidratoG: '8', lipidioG: '18', fibraG: '6' }, deps);
    const { p, id: v1 } = await publicado(T, [item(foodId)]);
    await editarAlimento(T.ctx, foodId, { nome: 'Pão low carb (nova receita)', grupo: 'Cereais e derivados', kcal: '300', proteinaG: '12', carboidratoG: '8', lipidioG: '18', fibraG: '6' }, deps);
    expect((await carregarPlano(T.ctx, v1, app.db))!.refeicoes[0].itens[0]).toMatchObject({ nome: 'Pão low carb Marca X', porCem: { kcal: 250 } });
    const { id: v2 } = await editarPublicado(T.ctx, p.id, v1, deps);
    expect((await carregarPlano(T.ctx, v2, app.db))!.refeicoes[0].itens[0]).toMatchObject({ nome: 'Pão low carb (nova receita)', porCem: { kcal: 300 } });
    await expect(excluirAlimento(T.ctx, foodId, deps)).rejects.toMatchObject({ erros: { geral: MSG_ALIMENTO.emUso } });
  });

  it('Review Focus 5 (D12, US-025 "Rascunho invisível"): a sessão do paciente lê só os próprios planos publicados/arquivados', async () => {
    const T = await novoTenant(app.db);
    const { p, id: v1 } = await publicado(T);
    const { id: v2 } = await editarPublicado(T.ctx, p.id, v1, deps); // rascunho v2
    await criarModelo(T.ctx, 'Modelo', deps);
    const outra = await publicado(T);
    const ler = (q: ReturnType<typeof sql>) => withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(q), app.db).then((r) => r.rows);
    expect((await ler(sql`select id, status from meal_plans`)).map((r) => r.id)).toEqual([v1]);
    expect(await ler(sql`select 1 from meals where plan_id = ${v2}`)).toEqual([]);
    expect(await ler(sql`select 1 from meal_items where plan_id = ${v2}`)).toEqual([]);
    expect(await ler(sql`select 1 from meals where plan_id = ${outra.id}`)).toEqual([]);
    expect((await ler(sql`select 1 from meal_items where plan_id = ${v1}`)).length).toBe(1);
  });

  it('publicado não é salvo nem publicado de novo; modelo não é publicado; paciente bloqueado não publica', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await publicado(T);
    await expect(salvarRascunho(T.ctx, id, corpo(99), deps)).rejects.toBeInstanceOf(PlanoNaoEditavelError);
    await expect(publicarPlano(T.ctx, p.id, id, deps)).rejects.toBeInstanceOf(PlanoNaoEditavelError);
    const { id: modelo } = await criarModelo(T.ctx, 'Modelo', deps);
    await expect(publicarPlano(T.ctx, p.id, modelo, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError); // modelo não é plano do paciente
    const { id: v2 } = await editarPublicado(T.ctx, p.id, id, deps);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    await expect(publicarPlano(T.ctx, p.id, v2, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('congela os nutrientes de todos os itens (principais e substituições) só do plano que foi publicado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    const principal = item(idTaco(3));
    const c = corpo(0, [principal, item(idTaco(4), '100', principal.id)]);
    await salvarRascunho(T.ctx, id, c, deps);
    const antes = await withTenant(T.ctx, (tx) => tx.select({ n: mealItems.nutrientes }).from(mealItems).where(eq(mealItems.planId, id)), app.db);
    expect(antes.map((r) => r.n)).toEqual([null, null]); // rascunho usa os valores atuais
    await publicarPlano(T.ctx, p.id, id, deps);
    const depois = await withTenant(T.ctx, (tx) => tx.select({ n: mealItems.nutrientes }).from(mealItems).where(eq(mealItems.planId, id)), app.db);
    expect(depois).toHaveLength(2);
    for (const r of depois) expect(r.n).toMatchObject({ origem: 'TACO', nome: expect.any(String), kcal: expect.anything() });
    const { id: v2 } = await editarPublicado(T.ctx, p.id, id, deps);
    const copia = await withTenant(T.ctx, (tx) => tx.select({ n: mealItems.nutrientes }).from(mealItems).where(eq(mealItems.planId, v2)), app.db);
    expect(copia.map((r) => r.n)).toEqual([null, null]); // D10: a cópia volta a usar os valores atuais
  });

  it('a fila recusar o PDF desfaz a publicação inteira: o rascunho continua rascunho e o publicado anterior continua publicado', async () => {
    const T = await novoTenant(app.db);
    const { p, id: v1 } = await publicado(T);
    const { id: v2 } = await editarPublicado(T.ctx, p.id, v1, deps);
    const recusa = { send: async () => null } as unknown as PgBoss;
    await expect(publicarPlano(T.ctx, p.id, v2, { ...deps, boss: recusa })).rejects.toThrow('A fila recusou o PDF do plano');
    expect((await carregarPlano(T.ctx, v2, app.db))?.status).toBe('rascunho');
    expect((await carregarPlano(T.ctx, v1, app.db))?.status).toBe('publicado');
    expect(await jobsDoPlano(v2)).toBe(0);
  });

  it('US-025: publicar avisa o paciente com acesso ao portal (push plano_novo + e-mail com o link de "Meu plano"); sem conta, nada', async () => {
    const T = await novoTenant(app.db);
    const { paciente: comConta, email } = await pacienteComConta(app.db, T);
    const { id } = await criarRascunho(T.ctx, comConta.id, deps);
    await salvarRascunho(T.ctx, id, corpo(0), deps);
    await publicarPlano(T.ctx, comConta.id, id, { ...deps, appUrl: 'https://nutri.exemplo.com' });
    const { p: semConta } = await publicado(T);
    const avisos = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.tipo, 'plano_novo')), app.db);
    expect(avisos.map((n) => [n.patientId, n.canal])).toEqual([[comConta.id, 'push']]);
    expect(await emailsNaFila('plano_novo', email)).toEqual([{ tipo: 'plano_novo', para: email, link: `https://nutri.exemplo.com/p/plano?v=${T.tenantId}` }]);
    expect(await emailsNaFila('plano_novo', semConta.email)).toEqual([]);
  });

  it('"Editar" só vale para a versão publicada; de uma versão arquivada, de rascunho ou de modelo não nasce rascunho', async () => {
    const T = await novoTenant(app.db);
    const { p, id: v1 } = await publicado(T);
    const { id: v2 } = await editarPublicado(T.ctx, p.id, v1, deps);
    await expect(editarPublicado(T.ctx, p.id, v2, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.naoPublicado }));
    await publicarPlano(T.ctx, p.id, v2, deps); // v1 arquivada
    await expect(editarPublicado(T.ctx, p.id, v1, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.naoPublicado }));
    const { id: modelo } = await criarModelo(T.ctx, 'Modelo', deps);
    await expect(editarPublicado(T.ctx, p.id, modelo, deps)).rejects.toThrow('Plano não encontrado.');
    const planos = await withTenant(T.ctx, (tx) => tx.select({ id: mealPlans.id }).from(mealPlans).where(eq(mealPlans.patientId, p.id)), app.db);
    expect(planos).toHaveLength(2); // nenhum rascunho foi criado
  });

  it('publicar plano de outro paciente (o da URL é outro): "Plano não encontrado." e nada muda', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, ana.id, deps);
    await salvarRascunho(T.ctx, id, corpo(0), deps);
    await expect(publicarPlano(T.ctx, bia.id, id, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    await expect(publicarPlano(T.ctx, 'nao-e-um-id', id, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    // o paciente do plano nem é consultado: com Ana bloqueada, continua "não encontrado" (e não o motivo do bloqueio de Ana)
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, ana.id)), app.db);
    await expect(publicarPlano(T.ctx, bia.id, id, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    expect(await carregarPlano(T.ctx, id, app.db)).toMatchObject({ status: 'rascunho', publicadoEm: null, pdfStatus: null });
    expect(await jobsDoPlano(id)).toBe(0);
  });

  it('"Editar" plano de outro paciente (o da URL é outro): "Plano não encontrado." e nenhum rascunho é criado', async () => {
    const T = await novoTenant(app.db);
    const { p: ana, id: v1 } = await publicado(T);
    const bia = await novoPaciente(app.db, T.ctx);
    await expect(editarPublicado(T.ctx, bia.id, v1, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    await expect(editarPublicado(T.ctx, 'nao-e-um-id', v1, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    const planos = await withTenant(T.ctx, (tx) => tx.select({ patientId: mealPlans.patientId, status: mealPlans.status }).from(mealPlans), app.db);
    expect(planos).toEqual([{ patientId: ana.id, status: 'publicado' }]);
  });

  it('dois "Editar" ao mesmo tempo (duas abas) acabam com um só rascunho', async () => {
    const T = await novoTenant(app.db);
    const { p, id: v1 } = await publicado(T);
    const r = await Promise.all([editarPublicado(T.ctx, p.id, v1, deps), editarPublicado(T.ctx, p.id, v1, deps)]);
    expect(r[0].id).toBe(r[1].id);
    expect(r.filter((x) => x.criado)).toHaveLength(1);
  });
});
