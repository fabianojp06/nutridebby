import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { foods, mealItems, mealPlans, notifications, patients, referenciasNutrientes } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { criarAlimento, duplicarComoMeu, editarAlimento, excluirAlimento } from '@/modules/alimentos/alimentos';
import { MSG_ALIMENTO } from '@/modules/alimentos/alimentos-constantes';
import { FONTES } from '@/modules/alimentos/fontes';
import { idTaco } from '@/modules/alimentos/taco';
import { carregarPacienteParaEscrita, PacienteBloqueadoError } from '@/modules/pacientes/base';
import { carregarPlano } from './carregar';
import { lerCongelados } from './congelados';
import { MSG_PLANO, MSG_TEXTO_LIVRE } from './constantes';
import { PlanoError, PlanoNaoEditavelError, PlanoNaoEncontradoError } from './erros';
import { criarDeModelo, criarModelo, salvarComoModelo } from './modelos';
import { editarPublicado, pedirNovoPdf, publicarPlano } from './publicacao';
import { criarRascunho, criarRascunhoTx, descartarRascunho, salvarRascunho } from './rascunho';
import type { CorpoSalvamento } from './tipos';

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

/** R-244: o app novo enfileira o PDF só na fila nova (`plano-pdf-2`), que o worker antigo não conhece. */
const jobsNaFila = async (fila: string, planId: string) =>
  Number((await owner.pool.query(`select count(*)::int as n from pgboss.job where name = $1 and data->>'planId' = $2`, [fila, planId])).rows[0].n);
const jobsDoPlano = (planId: string) => jobsNaFila('plano-pdf-2', planId);

describe('publicação e versionamento (US-025, RN-01)', () => {
  it('"Primeira publicação": status publicado, versão 1, PDF pendente e job na fila na mesma transação', async () => {
    const T = await novoTenant(app.db);
    const { id } = await publicado(T);
    expect(await carregarPlano(T.ctx, id, app.db)).toMatchObject({ status: 'publicado', versao: 1, publicadoEm: '2026-10-01T15:00:00.000Z', pdfStatus: 'pendente', pdfPath: null });
    expect(await jobsDoPlano(id)).toBe(1);
  });

  it('R-244: publicarPlano e "Gerar o PDF de novo" (pedirNovoPdf) enfileiram em `plano-pdf-2`, nunca na fila que o worker antigo consome', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await publicado(T);
    expect(await jobsNaFila('plano-pdf-2', id)).toBe(1);
    expect(await jobsNaFila('plano-pdf', id)).toBe(0);
    await owner.pool.query(`update meal_plans set pdf_status = 'falhou' where id = $1`, [id]);
    await pedirNovoPdf(T.ctx, p.id, id, deps);
    expect(await jobsNaFila('plano-pdf-2', id)).toBe(2);
    expect(await jobsNaFila('plano-pdf', id)).toBe(0);
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

  it('RN-117 (Plano 14B, D16): "Editar" copia a marca da IA (ia_origem_em); salvar como modelo e criar de modelo não a levam', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const marca = new Date('2026-10-14T12:00:00Z');
    const v1 = await withTenant(
      T.ctx,
      async (tx) => {
        await carregarPacienteParaEscrita(tx, p.id);
        return criarRascunhoTx(tx, T.tenantId, p.id, { titulo: 'Plano de Ana', iaOrigemEm: marca });
      },
      app.db,
    );
    await salvarRascunho(T.ctx, v1, corpo(0), deps);
    await publicarPlano(T.ctx, p.id, v1, deps);
    const { id: v2 } = await editarPublicado(T.ctx, p.id, v1, deps);
    expect(await carregarPlano(T.ctx, v2, app.db)).toMatchObject({ status: 'rascunho', versao: 2, iaOrigemEm: marca.toISOString() });
    const { id: modelo } = await salvarComoModelo(T.ctx, v1, 'Modelo da IA', deps);
    expect(await carregarPlano(T.ctx, modelo, app.db)).toMatchObject({ isTemplate: true, iaOrigemEm: null });
    const outro = await novoPaciente(app.db, T.ctx);
    const { id: doModelo } = await criarDeModelo(T.ctx, modelo, outro.id, deps);
    expect(await carregarPlano(T.ctx, doModelo, app.db)).toMatchObject({ status: 'rascunho', iaOrigemEm: null });
    // sem a marca, "Editar" continua sem ela
    const { p: semIa, id: manual } = await publicado(T);
    const { id: manual2 } = await editarPublicado(T.ctx, semIa.id, manual, deps);
    expect((await carregarPlano(T.ctx, manual2, app.db))?.iaOrigemEm).toBeNull();
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

describe('Plano 19 — publicação: congelação, perfil e avisos em dois passos (RN-237, RN-238, RN-244, RN-246, D31)', () => {
  const VET = 'Registre o VET, a distribuição de macro e micronutrientes e as quantidades da prescrição no plano ou no atendimento.';
  const refeicao = (o: Partial<CorpoSalvamento['refeicoes'][number]> = {}): CorpoSalvamento['refeicoes'][number] => ({
    id: randomUUID(), nome: 'Almoço', horario: '12:00', observacao: '', itens: [], ...o,
  });
  const livre = (revisao: number, refeicoes: CorpoSalvamento['refeicoes'], extra: Partial<CorpoSalvamento> = {}): CorpoSalvamento => ({
    revisao, envio: randomUUID(), titulo: 'Plano em texto', metaKcal: '1800', mostrarCalorias: false, orientacoes: '', modo: 'livre', refeicoes, ...extra,
  });
  const novoPerfil = (T: TenantDeTeste, nome = 'Mulher 19 a 50 anos') =>
    withTenant(
      T.ctx,
      async (tx) =>
        (await tx.insert(referenciasNutrientes).values({ tenantId: T.tenantId, nome, fonte: 'DRI/IOM 2006 — conferida pela nutricionista', valores: { ferro_mg: { meta: 18, maximo: 45 } } }).returning())[0],
      app.db,
    );
  const usarPerfil = (T: TenantDeTeste, planId: string, referenciaId: string, extra: Partial<typeof mealPlans.$inferInsert> = {}) =>
    withTenant(T.ctx, (tx) => tx.update(mealPlans).set({ referenciaId, ...extra }).where(eq(mealPlans.id, planId)), app.db);
  const linhaDoPlano = async (T: TenantDeTeste, planId: string) => (await withTenant(T.ctx, (tx) => tx.select().from(mealPlans).where(eq(mealPlans.id, planId)), app.db))[0];
  const rascunhoCom = async (T: TenantDeTeste, c: (revisao: number) => CorpoSalvamento) => {
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, p.id, deps);
    await salvarRascunho(T.ctx, id, c(0), deps);
    return { p, id };
  };

  it('congela fonte, versão, fonte de origem e micros de cada item; o perfil vai para referencia_congelada e referencia_id fica nulo; editar o perfil depois não muda o publicado', async () => {
    const T = await novoTenant(app.db);
    const { id: meuArroz } = await duplicarComoMeu(T.ctx, idTaco(3), deps);
    const perfil = await novoPerfil(T);
    const { p, id } = await rascunhoCom(T, (r) => corpo(r, [item(idTaco(3)), item(meuArroz)]));
    await usarPerfil(T, id, perfil.id);
    expect(await publicarPlano(T.ctx, p.id, id, deps)).toEqual({ versao: 1 });

    const [taco] = await withTenant(T.ctx, (tx) => tx.select({ micros: foods.micros }).from(foods).where(eq(foods.id, idTaco(3))), app.db);
    const itens = await withTenant(T.ctx, (tx) => tx.select({ foodId: mealItems.foodId, n: mealItems.nutrientes }).from(mealItems).where(eq(mealItems.planId, id)), app.db);
    const doAlimento = (f: string) => itens.find((i) => i.foodId === f)!.n;
    expect(doAlimento(idTaco(3))).toMatchObject({ origem: 'TACO', fonte: 'taco', fonteVersao: FONTES.taco.versao, fonteOrigem: null, micros: taco.micros });
    expect(Object.keys(taco.micros).length).toBeGreaterThan(0);
    expect(doAlimento(meuArroz)).toMatchObject({ origem: 'Meu alimento', fonte: 'propria', fonteVersao: null, fonteOrigem: 'taco', micros: taco.micros });
    expect(lerCongelados(doAlimento(meuArroz))).toMatchObject({ fonte: 'propria', fonteOrigem: 'taco' });

    const pub = await linhaDoPlano(T, id);
    expect(pub).toMatchObject({ referenciaId: null, referenciaCongelada: { id: perfil.id, nome: 'Mulher 19 a 50 anos', fonte: 'DRI/IOM 2006 — conferida pela nutricionista', valores: { ferro_mg: { meta: 18, maximo: 45 } } } });
    await withTenant(T.ctx, (tx) => tx.update(referenciasNutrientes).set({ nome: 'Outro nome', valores: { ferro_mg: { meta: 8 } } }).where(eq(referenciasNutrientes.id, perfil.id)), app.db);
    expect((await linhaDoPlano(T, id)).referenciaCongelada).toEqual(pub.referenciaCongelada);
  });

  it('"Editar" um publicado em texto livre: rascunho livre com os textos, os dias, a distribuição e os nutrientes; o perfil volta se ainda existe, excluído fica "Sem perfil"', async () => {
    const T = await novoTenant(app.db);
    const perfil = await novoPerfil(T);
    const semana = refeicao({ descricaoLivre: 'Arroz, feijão e salada.', diasSemana: [1, 2, 3, 4, 5] });
    const fds = refeicao({ horario: '13:00', descricaoLivre: 'Livre, com salada.', diasSemana: [0, 6] });
    const { p, id: v1 } = await rascunhoCom(T, (r) => livre(r, [semana, fds], { macrosPrescritos: { proteina: 20, carboidrato: 50, lipidio: 30 } }));
    await usarPerfil(T, v1, perfil.id, { nutrientesExibidos: ['ferro_mg', 'calcio_mg'], mostrarMicrosPdf: true });
    expect(await publicarPlano(T.ctx, p.id, v1, deps)).toEqual({ versao: 1 });

    const { id: v2 } = await editarPublicado(T.ctx, p.id, v1, deps);
    expect(await carregarPlano(T.ctx, v2, app.db)).toMatchObject({
      status: 'rascunho', modo: 'livre', metaKcal: 1800, macrosPrescritos: { proteina: 20, carboidrato: 50, lipidio: 30 },
      refeicoes: [
        { descricaoLivre: 'Arroz, feijão e salada.', diasSemana: [1, 2, 3, 4, 5], itens: [] },
        { descricaoLivre: 'Livre, com salada.', diasSemana: [0, 6], itens: [] },
      ],
    });
    expect(await linhaDoPlano(T, v2)).toMatchObject({ referenciaId: perfil.id, referenciaCongelada: null, nutrientesExibidos: ['ferro_mg', 'calcio_mg'], mostrarMicrosPdf: true });

    await descartarRascunho(T.ctx, p.id, v2, deps);
    await withTenant(T.ctx, (tx) => tx.delete(referenciasNutrientes).where(eq(referenciasNutrientes.id, perfil.id)), app.db);
    expect((await linhaDoPlano(T, v1)).referenciaCongelada).toMatchObject({ id: perfil.id }); // o publicado mantém a cópia
    const { id: v3 } = await editarPublicado(T.ctx, p.id, v1, deps);
    expect(await linhaDoPlano(T, v3)).toMatchObject({ referenciaId: null, modo: 'livre' });
  });

  it('D31: modo livre sem "Meta (kcal)" → o aviso do VET e nada publicado; com o aviso confirmado, publica', async () => {
    const T = await novoTenant(app.db);
    const { p, id } = await rascunhoCom(T, (r) => livre(r, [refeicao({ descricaoLivre: 'Prato feito' })], { metaKcal: '' }));
    expect(await publicarPlano(T.ctx, p.id, id, deps)).toEqual({ avisos: [VET] });
    expect(MSG_TEXTO_LIVRE.semVet).toBe(VET);
    expect(await linhaDoPlano(T, id)).toMatchObject({ status: 'rascunho', publicadoEm: null, pdfStatus: null });
    expect(await jobsDoPlano(id)).toBe(0);
    expect(await publicarPlano(T.ctx, p.id, id, deps, { confirmarAvisos: ['outro aviso'] })).toEqual({ avisos: [VET] });
    expect(await publicarPlano(T.ctx, p.id, id, deps, { confirmarAvisos: [VET] })).toEqual({ versao: 1 });
    expect(await linhaDoPlano(T, id)).toMatchObject({ status: 'publicado' });
    expect(await jobsDoPlano(id)).toBe(1);
  });

  it('D31 (RN-246): dia sem refeição é aviso, na ordem seg…dom; o calculado sem meta não avisa; um aviso novo depois da confirmação volta a aparecer', async () => {
    const T = await novoTenant(app.db);
    const semDomingo = (r: number) => ({ ...corpo(r), metaKcal: '', refeicoes: [{ ...corpo(r).refeicoes[0], diasSemana: [1, 2, 3, 4, 5, 6] }] });
    const a = await rascunhoCom(T, semDomingo);
    expect(await publicarPlano(T.ctx, a.p.id, a.id, deps)).toEqual({ avisos: ['Domingo não tem refeições.'] });

    const semFds = (r: number) => ({ ...corpo(r), refeicoes: [{ ...corpo(r).refeicoes[0], diasSemana: [1, 2, 3, 4, 5] }] });
    const b = await rascunhoCom(T, semFds);
    expect(await publicarPlano(T.ctx, b.p.id, b.id, deps)).toEqual({ avisos: ['Sábado e domingo não têm refeições.'] });
    // confirmou "Domingo…" numa tela velha, mas agora faltam sábado e domingo: volta o aviso novo, nada publicado
    expect(await publicarPlano(T.ctx, b.p.id, b.id, deps, { confirmarAvisos: ['Domingo não tem refeições.'] })).toEqual({ avisos: ['Sábado e domingo não têm refeições.'] });
    expect(await publicarPlano(T.ctx, b.p.id, b.id, deps, { confirmarAvisos: ['Sábado e domingo não têm refeições.'] })).toEqual({ versao: 1 });

    // os dois avisos juntos: o do VET primeiro
    const c = await rascunhoCom(T, (r) => livre(r, [refeicao({ descricaoLivre: 'Prato feito', diasSemana: [1, 2, 3, 4, 5, 6] })], { metaKcal: '' }));
    expect(await publicarPlano(T.ctx, c.p.id, c.id, deps)).toEqual({ avisos: [VET, 'Domingo não tem refeições.'] });
  });

  it('RN-244: no modo livre, refeição sem texto é erro no campo ("A refeição "Almoço" está sem texto."), sem refeição e sem horário também', async () => {
    const T = await novoTenant(app.db);
    const almoco = refeicao({ nome: 'Almoço' });
    const { p, id } = await rascunhoCom(T, (r) => livre(r, [refeicao({ nome: 'Café', horario: '07:00', descricaoLivre: 'Pão e café' }), almoco]));
    await expect(publicarPlano(T.ctx, p.id, id, deps)).rejects.toEqual(new PlanoError({ [`refeicao:${almoco.id}:descricaoLivre`]: 'A refeição "Almoço" está sem texto.' }));
    await salvarRascunho(T.ctx, id, livre(1, [{ ...almoco, horario: '', descricaoLivre: 'Prato feito' }]), deps);
    await expect(publicarPlano(T.ctx, p.id, id, deps)).rejects.toEqual(new PlanoError({ geral: MSG_PLANO.publicarHorario }));
    await salvarRascunho(T.ctx, id, livre(2, []), deps);
    await expect(publicarPlano(T.ctx, p.id, id, deps)).rejects.toEqual(new PlanoError({ geral: MSG_TEXTO_LIVRE.publicarVazio }));
    expect((await linhaDoPlano(T, id)).status).toBe('rascunho');
  });
});
