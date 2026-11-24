import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { geracaoNoBanco } from '../../../test/ia';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { auditLog, mealItems, mealPlans, meals, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { idTaco } from '@/modules/alimentos/taco';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { carregarPlano } from './carregar';
import { MSG_MODELO_IA, MSG_PLANO } from './constantes';
import { PlanoError, PlanoNaoEncontradoError } from './erros';
import { aprovarModeloPlano, criarDeModelo, criarModelo, excluirModelo, listarModelos, listarModelosUsaveis, salvarComoModelo } from './modelos';
import { criarRascunho, salvarRascunho } from './rascunho';
import type { CorpoSalvamento } from './tipos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
const conteudo = (revisao: number, titulo = 'Emagrecimento 1600 kcal'): CorpoSalvamento => ({
  revisao, envio: randomUUID(), titulo, metaKcal: '1600', mostrarCalorias: false, orientacoes: 'Evitar frituras.',
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

  it('salvar como modelo espera o salvamento automático em curso (FOR SHARE na origem): cabeçalho, refeições e itens da mesma versão', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await criarRascunho(T.ctx, ana.id, deps);
    await salvarRascunho(T.ctx, id, conteudo(0, 'Plano de Ana'), deps);
    let travou!: () => void;
    let soltar!: () => void;
    const travado = new Promise<void>((r) => (travou = r));
    const solto = new Promise<void>((r) => (soltar = r));
    // um "salvamento automático" que trava o plano (FOR UPDATE, como salvarRascunho) e só grava e confirma depois
    const salvamento = withTenant(
      T.ctx,
      async (tx) => {
        await tx.select({ id: mealPlans.id }).from(mealPlans).where(eq(mealPlans.id, id)).for('update');
        travou();
        await solto;
        const jantar = randomUUID();
        await tx.insert(meals).values({ id: jantar, tenantId: T.tenantId, patientId: ana.id, planId: id, nome: 'Jantar', ordem: 1 });
        await tx.insert(mealItems).values({ id: randomUUID(), tenantId: T.tenantId, patientId: ana.id, planId: id, mealId: jantar, foodId: idTaco(3), quantidadeG: 80, ordem: 0 });
        await tx.update(mealPlans).set({ orientacoes: 'Versão nova.' }).where(eq(mealPlans.id, id));
      },
      app.db,
    );
    await travado;
    let terminou = false;
    const copia = salvarComoModelo(T.ctx, id, 'Modelo durante o salvamento', deps).finally(() => (terminou = true));
    try {
      await new Promise((r) => setTimeout(r, 300));
      expect(terminou).toBe(false); // a cópia espera a trava do salvamento
    } finally {
      soltar();
      await salvamento;
    }
    const m = (await carregarPlano(T.ctx, (await copia).id, app.db))!;
    expect(m.orientacoes).toBe('Versão nova.');
    expect(m.refeicoes.map((r) => [r.nome, r.itens.length])).toEqual([['Almoço', 2], ['Jantar', 1]]);
  });

  it('paciente bloqueado ou anonimizado (US-018, só consulta): o plano dele não vira modelo; um modelo continua sendo copiado', async () => {
    const T = await novoTenant(app.db);
    const modelos = async () => (await listarModelos(T.ctx, app.db)).length;
    const planoDe = async (estado: Partial<typeof patients.$inferInsert>) => {
      const p = await novoPaciente(app.db, T.ctx);
      const { id } = await criarRascunho(T.ctx, p.id, deps);
      await salvarRascunho(T.ctx, id, conteudo(0, 'Plano do paciente'), deps);
      await withTenant(T.ctx, (tx) => tx.update(patients).set(estado).where(eq(patients.id, p.id)), app.db);
      return id;
    };
    const bloqueado = await planoDe({ status: 'bloqueado' });
    await expect(salvarComoModelo(T.ctx, bloqueado, 'Do bloqueado', deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    // como a anonimização (lgpd.ts) deixa o paciente: bloqueado, sem nome e com a data da anonimização
    const anonimizado = await planoDe({ status: 'bloqueado', nome: 'Paciente anonimizado', anonimizadoEm: new Date() });
    await expect(salvarComoModelo(T.ctx, anonimizado, 'Do anonimizado', deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await modelos()).toBe(0); // nenhum modelo criado

    const { id: modelo } = await criarModelo(T.ctx, 'Base', deps);
    await salvarRascunho(T.ctx, modelo, conteudo(0), deps);
    const { id: copia } = await salvarComoModelo(T.ctx, modelo, 'Cópia da base', deps);
    expect((await carregarPlano(T.ctx, copia, app.db))!.refeicoes[0].itens).toHaveLength(2);
    expect(await modelos()).toBe(2);
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
    // SUS-114: por caractere (code point), como o CHECK e o rascunho
    await expect(criarModelo(A.ctx, '🙂'.repeat(121), deps)).rejects.toEqual(new PlanoError({ titulo: MSG_PLANO.titulo }));
    expect(await criarModelo(A.ctx, '🙂'.repeat(120), deps)).toHaveProperty('id');
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

async function modeloSugerido(T: TenantDeTeste) {
  const g = await geracaoNoBanco(app.db, T.ctx, { status: 'pronta', itensDescartados: 3 });
  const [m] = await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => tx.insert(mealPlans).values({ tenantId: T.tenantId, isTemplate: true, titulo: 'Diabetes: Plano A', iaGeracaoId: g }).returning({ id: mealPlans.id }), app.db);
  return m.id;
}

describe('modelos sugeridos pela IA (US-123, RN-125, RN-126)', () => {
  it('não aprovado: fica fora das escolhas e criarDeModelo recusa com o texto da spec', async () => {
    const T = await novoTenant(app.db);
    const id = await modeloSugerido(T);
    const p = await novoPaciente(app.db, T.ctx);
    expect((await listarModelos(T.ctx, app.db)).find((m) => m.id === id)).toMatchObject({ sugestaoIa: true, aprovadoEm: null });
    expect((await listarModelosUsaveis(T.ctx, app.db)).map((m) => m.id)).not.toContain(id);
    await expect(criarDeModelo(T.ctx, id, p.id, { db: app.db })).rejects.toMatchObject({ erros: { geral: 'Aprove o modelo antes de usá-lo com pacientes.' } });
    const planos = await withTenant(T.ctx, (tx) => tx.select({ id: mealPlans.id }).from(mealPlans).where(eq(mealPlans.patientId, p.id)), app.db);
    expect(planos).toEqual([]); // nada criado
  });

  it('aprovar grava quem e quando; depois o modelo é usável e o plano criado não leva origem nem selo', async () => {
    const T = await novoTenant(app.db);
    const id = await modeloSugerido(T);
    await aprovarModeloPlano(T.ctx, id, { db: app.db, agora: new Date('2026-10-10T13:00:00Z') });
    const [m] = await withTenant(T.ctx, (tx) => tx.select().from(mealPlans).where(eq(mealPlans.id, id)), app.db);
    expect(m).toMatchObject({ aprovadoPor: T.nutriId, aprovadoEm: new Date('2026-10-10T13:00:00Z') });
    expect((await listarModelosUsaveis(T.ctx, app.db)).map((x) => x.id)).toContain(id);
    expect((await listarModelos(T.ctx, app.db)).find((x) => x.id === id)).toMatchObject({ sugestaoIa: false, aprovadoEm: '2026-10-10T13:00:00.000Z' });
    const p = await novoPaciente(app.db, T.ctx);
    const { id: planId } = await criarDeModelo(T.ctx, id, p.id, { db: app.db });
    const [plano] = await withTenant(T.ctx, (tx) => tx.select().from(mealPlans).where(eq(mealPlans.id, planId)), app.db);
    expect(plano).toMatchObject({ iaGeracaoId: null, aprovadoEm: null }); // a origem fica só no modelo (US-123 (f))
    await aprovarModeloPlano(T.ctx, id, { db: app.db }); // aprovar de novo: nada muda, sem erro (idempotente)
    const [depois] = await withTenant(T.ctx, (tx) => tx.select().from(mealPlans).where(eq(mealPlans.id, id)), app.db);
    expect(depois).toMatchObject({ aprovadoPor: T.nutriId, aprovadoEm: new Date('2026-10-10T13:00:00Z') });
  });

  it('salvarComoModelo: sugestão não aprovada recusada (RN-125); a cópia não leva origem nem aprovação; modelo feito à mão segue usável', async () => {
    const T = await novoTenant(app.db);
    const { id } = await criarModelo(T.ctx, 'Meu modelo', { db: app.db });
    expect((await listarModelosUsaveis(T.ctx, app.db)).map((m) => m.id)).toContain(id);
    expect((await listarModelos(T.ctx, app.db)).find((m) => m.id === id)).toMatchObject({ sugestaoIa: false, aprovadoEm: null });
    const sugerido = await modeloSugerido(T);
    await expect(salvarComoModelo(T.ctx, sugerido, 'Cópia', { db: app.db })).rejects.toEqual(new PlanoError({ geral: MSG_MODELO_IA.aprove })); // RN-125
    await aprovarModeloPlano(T.ctx, sugerido, { db: app.db });
    const { id: copia } = await salvarComoModelo(T.ctx, sugerido, 'Cópia do sugerido', { db: app.db });
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(mealPlans).where(eq(mealPlans.id, copia)), app.db);
    expect(c).toMatchObject({ iaGeracaoId: null, aprovadoEm: null, aprovadoPor: null });
  });

  it('aprovar: só modelo de origem IA do próprio consultório; id inválido, plano de paciente, modelo à mão ou de outro tenant → não encontrado', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const sugerido = await modeloSugerido(A);
    const { id: aMao } = await criarModelo(A.ctx, 'À mão', { db: app.db });
    const ana = await novoPaciente(app.db, A.ctx);
    const { id: planoAna } = await criarRascunho(A.ctx, ana.id, deps);
    for (const id of ['nao-e-uuid', aMao, planoAna]) await expect(aprovarModeloPlano(A.ctx, id, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    await expect(aprovarModeloPlano(B.ctx, sugerido, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError);
    await expect(aprovarModeloPlano({ tenantId: A.tenantId, role: 'nutri' }, sugerido, deps)).rejects.toBeInstanceOf(PlanoNaoEncontradoError); // sem usuária na sessão
    expect((await listarModelos(A.ctx, app.db)).find((m) => m.id === sugerido)).toMatchObject({ sugestaoIa: true, aprovadoEm: null });
  });

  it('carregarPlano: origemIa com a marca, a data da aprovação e os itens descartados do pacote; modelo à mão sem origem', async () => {
    const T = await novoTenant(app.db);
    const id = await modeloSugerido(T);
    expect((await carregarPlano(T.ctx, id, app.db))!.origemIa).toEqual({ sugestao: true, aprovadoEm: null, descartados: 3 });
    await aprovarModeloPlano(T.ctx, id, { db: app.db, agora: new Date('2026-10-10T13:00:00Z') });
    expect((await carregarPlano(T.ctx, id, app.db))!.origemIa).toEqual({ sugestao: false, aprovadoEm: '2026-10-10T13:00:00.000Z', descartados: 3 });
    const { id: aMao } = await criarModelo(T.ctx, 'À mão', deps);
    expect((await carregarPlano(T.ctx, aMao, app.db))!.origemIa).toBeNull();
  });

  it('os textos repetidos no módulo do plano são os mesmos de MSG_MODELOS_IA', async () => {
    const { MSG_MODELOS_IA } = await import('@/modules/ia/constantes');
    expect([MSG_MODELO_IA.aprove, MSG_MODELO_IA.marca, MSG_MODELO_IA.faixa, MSG_MODELO_IA.aprovar, MSG_MODELO_IA.confirmarAprovar]).toEqual([
      MSG_MODELOS_IA.aprove, MSG_MODELOS_IA.marca, MSG_MODELOS_IA.faixa, MSG_MODELOS_IA.aprovar, MSG_MODELOS_IA.confirmarAprovar,
    ]);
    expect(MSG_MODELO_IA.aprovadoEm('10/10/2026')).toBe(MSG_MODELOS_IA.aprovadoEm('10/10/2026'));
    expect(MSG_MODELO_IA.descartados(3)).toBe(MSG_MODELOS_IA.descartados(3));
  });
});
