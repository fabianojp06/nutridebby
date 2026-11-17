import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, lembretesRotina, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { ligarLembrete, salvarLembrete } from './equipe';
import { desligarMeuLembrete, LembreteDoPacienteError, meusLembretes, pausarMeusLembretes, temLembretes, temLembretesNaTela } from './paciente';

/** Plano 17 (§5.3, Tarefa 6): o que o portal (Eu › Lembretes) lê e muda, sempre pela sessão do próprio paciente. */
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const db = { db: app.db };
const SP = { fuso: 'America/Sao_Paulo' };
const TODOS = [0, 1, 2, 3, 4, 5, 6];
const AGUA = { tipo: 'agua', config: { inicio: '08:00', fim: '20:00', intervaloMin: 120, dias: TODOS } };
const REFEICOES = { tipo: 'refeicoes', config: { antecedenciaMin: 0, diarioDepoisMin: null } };
const SUPLEMENTO = { tipo: 'suplemento', texto: 'Vitamina D', config: { horarios: ['20:00', '08:00'], dias: [1, 2, 3, 4, 5] } };
const LIVRE = { tipo: 'livre', texto: 'Caminhar 20 minutos depois do almoço', config: { horarios: ['08:00'], dias: TODOS } };

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const outro = await novoPaciente(app.db, T.ctx); // outro paciente do MESMO consultório
  const ctx = ctxPaciente(T.tenantId, p.id);
  const salvar = (input: unknown, patientId = p.id) => salvarLembrete(T.ctx, patientId, input, SP, db).then((r) => r.id);
  const linha = (id: string) => withTenant(T.ctx, (tx) => tx.select().from(lembretesRotina).where(eq(lembretesRotina.id, id)), app.db).then((r) => r[0]);
  const pausa = (patientId = p.id) =>
    withTenant(T.ctx, (tx) => tx.select({ em: patients.lembretesPausadosEm }).from(patients).where(eq(patients.id, patientId)), app.db).then((r) => r[0].em);
  return { T, p, outro, ctx, salvar, linha, pausa };
}

const leituras = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, patientId), eq(auditLog.entidade, 'lembretes'), eq(auditLog.acao, 'ler'))), app.db);

describe('meusLembretes (Eu › Lembretes, §5.3)', () => {
  it('os lembretes ligados pela equipe, com os resumos da tela (mesmos formatadores do painel) e o texto da nutricionista só no suplemento e no livre', async () => {
    const { ctx, salvar } = await cenario();
    // a ordem de criação não importa: água, refeições, suplementos e livres
    const livre = await salvar(LIVRE);
    const suplemento = await salvar(SUPLEMENTO);
    const agua = await salvar(AGUA);
    const refeicoes = await salvar(REFEICOES);
    expect(await meusLembretes(ctx, db)).toEqual({
      pausadoEm: null,
      lembretes: [
        { id: agua, tipo: 'agua', resumo: 'Água: das 08:00 às 20:00, a cada 2 h · todos os dias', textoDaNutri: null, desligado: false },
        { id: refeicoes, tipo: 'refeicoes', resumo: 'Refeições: aviso na hora, nas refeições do seu plano', textoDaNutri: null, desligado: false },
        { id: suplemento, tipo: 'suplemento', resumo: 'Suplemento: 08:00 e 20:00 · seg a sex', textoDaNutri: 'Vitamina D', desligado: false },
        { id: livre, tipo: 'livre', resumo: 'Lembrete: 08:00 · todos os dias', textoDaNutri: 'Caminhar 20 minutos depois do almoço', desligado: false },
      ],
    });
  });

  it('Refeições com o pedido de registro no diário: o resumo diz que ele está ligado (mesmo interruptor)', async () => {
    const { ctx, salvar } = await cenario();
    await salvar({ tipo: 'refeicoes', config: { antecedenciaMin: 15, diarioDepoisMin: 30 } });
    expect((await meusLembretes(ctx, db)).lembretes.map((l) => l.resumo)).toEqual([
      'Refeições: aviso 15 min antes e pedido de registro no diário 30 min depois, nas refeições do seu plano',
    ]);
  });

  it('RLS: só os do próprio paciente — o lembrete de outro paciente do mesmo consultório não aparece', async () => {
    const { ctx, outro, salvar } = await cenario();
    const meu = await salvar(AGUA);
    await salvar(SUPLEMENTO, outro.id);
    expect((await meusLembretes(ctx, db)).lembretes.map((l) => l.id)).toEqual([meu]);
  });

  it('o desligado pela equipe (ligado = false) não aparece; o desligado pelo paciente aparece como "desligado"', async () => {
    const { T, p, ctx, salvar } = await cenario();
    const agua = await salvar(AGUA);
    const suplemento = await salvar(SUPLEMENTO);
    await ligarLembrete(T.ctx, p.id, suplemento, false, db);
    await desligarMeuLembrete(ctx, agua, true, db);
    expect((await meusLembretes(ctx, db)).lembretes).toEqual([expect.objectContaining({ id: agua, desligado: true })]);
  });

  it('config malformada (gravada fora do módulo) é pulada, sem derrubar a tela', async () => {
    const { T, p, ctx, salvar } = await cenario();
    const agua = await salvar(AGUA);
    await withTenant(T.ctx, (tx) => tx.insert(lembretesRotina).values({ tenantId: T.tenantId, patientId: p.id, tipo: 'livre', texto: 'x', config: { horarios: [] }, criadoPor: T.nutriId }), app.db);
    expect((await meusLembretes(ctx, db)).lembretes.map((l) => l.id)).toEqual([agua]);
  });

  it('CLAUDE.md regra 8: com lembretes, grava a leitura (`ler` de `lembretes`) na sessão do paciente; sem lembretes, não grava', async () => {
    const { T, p, ctx, salvar } = await cenario();
    expect((await meusLembretes(ctx, db)).lembretes).toEqual([]);
    expect(await leituras(T, p.id)).toEqual([]);
    await salvar(AGUA);
    await meusLembretes(ctx, db);
    expect(await leituras(T, p.id)).toEqual([expect.objectContaining({ actorUserId: ctx.actorUserId, entidadeId: null })]);
  });

  it('só roda em sessão de paciente', async () => {
    const { T } = await cenario();
    await expect(meusLembretes(T.ctx, db)).rejects.toThrow(/sessão de paciente/);
  });
});

describe('desligarMeuLembrete e pausarMeusLembretes (§5.3)', () => {
  it('desligar grava a data (o relógio do banco) e religar a limpa; desligar de novo não muda a data', async () => {
    const { ctx, salvar, linha } = await cenario();
    const id = await salvar(AGUA);
    await desligarMeuLembrete(ctx, id, true, db);
    const desligado = (await linha(id)).desligadoPeloPacienteEm;
    expect(desligado).toBeInstanceOf(Date);
    await desligarMeuLembrete(ctx, id, true, db);
    expect((await linha(id)).desligadoPeloPacienteEm).toEqual(desligado);
    await desligarMeuLembrete(ctx, id, false, db);
    expect(await linha(id)).toMatchObject({ desligadoPeloPacienteEm: null, ligado: true });
    await desligarMeuLembrete(ctx, id, false, db); // religar o que já está ligado: nada muda, sem erro
  });

  it('religar renova updated_at (o worker não manda um slot de antes do religamento)', async () => {
    const { ctx, salvar, linha } = await cenario();
    const id = await salvar(AGUA);
    const antes = (await linha(id)).updatedAt;
    await desligarMeuLembrete(ctx, id, true, db);
    await desligarMeuLembrete(ctx, id, false, db);
    expect((await linha(id)).updatedAt.getTime()).toBeGreaterThan(antes.getTime());
  });

  it('o lembrete de outro paciente (ou um id qualquer) é recusado como "não encontrado", e o do outro fica como estava', async () => {
    const { ctx, outro, salvar, linha } = await cenario();
    const dele = await salvar(AGUA, outro.id);
    await expect(desligarMeuLembrete(ctx, dele, true, db)).rejects.toBeInstanceOf(LembreteDoPacienteError);
    await expect(desligarMeuLembrete(ctx, 'nao-e-uuid', true, db)).rejects.toBeInstanceOf(LembreteDoPacienteError);
    await expect(desligarMeuLembrete(ctx, crypto.randomUUID(), false, db)).rejects.toBeInstanceOf(LembreteDoPacienteError);
    expect((await linha(dele)).desligadoPeloPacienteEm).toBeNull();
  });

  it('pausar grava `lembretes_pausados_em` (e meusLembretes a devolve); retomar a limpa; os lembretes continuam como estavam', async () => {
    const { ctx, outro, salvar, pausa } = await cenario();
    const id = await salvar(AGUA);
    await pausarMeusLembretes(ctx, true, db);
    const em = await pausa();
    expect(em).toBeInstanceOf(Date);
    expect((await meusLembretes(ctx, db)).pausadoEm).toEqual(em);
    await pausarMeusLembretes(ctx, true, db); // pausar de novo não muda a data
    expect(await pausa()).toEqual(em);
    expect(await pausa(outro.id)).toBeNull(); // só o próprio
    await pausarMeusLembretes(ctx, false, db);
    expect(await pausa()).toBeNull();
    expect((await meusLembretes(ctx, db)).lembretes).toEqual([expect.objectContaining({ id, desligado: false })]);
  });
});

describe('temLembretes (Eu e Hoje)', () => {
  it('sim com um lembrete ligado pelas duas partes (a pausa geral não conta); não quando o único foi desligado pelo paciente ou pela equipe; sem auditRead', async () => {
    const { T, p, ctx, salvar } = await cenario();
    expect(await temLembretes(ctx, db)).toBe(false);
    const id = await salvar(AGUA);
    expect(await temLembretes(ctx, db)).toBe(true);
    await pausarMeusLembretes(ctx, true, db);
    expect(await temLembretes(ctx, db)).toBe(true);
    await desligarMeuLembrete(ctx, id, true, db);
    expect(await temLembretes(ctx, db)).toBe(false);
    await desligarMeuLembrete(ctx, id, false, db);
    await ligarLembrete(T.ctx, p.id, id, false, db);
    expect(await temLembretes(ctx, db)).toBe(false);
    expect(await leituras(T, p.id)).toEqual([]);
  });

  it('o lembrete de outro paciente do mesmo consultório não conta', async () => {
    const { ctx, outro, salvar } = await cenario();
    await salvar(AGUA, outro.id);
    expect(await temLembretes(ctx, db)).toBe(false);
  });

  it('T6-01: único lembrete desligado pelo paciente → temLembretesNaTela verdadeiro (Eu leva a religar), temLembretes falso; desligado pela equipe (ligado = false) → ambos falsos; a pausa não conta; sem auditRead', async () => {
    const { T, p, ctx, salvar } = await cenario();
    expect(await temLembretesNaTela(ctx, db)).toBe(false);
    const id = await salvar(AGUA);
    await desligarMeuLembrete(ctx, id, true, db);
    await pausarMeusLembretes(ctx, true, db);
    expect(await temLembretesNaTela(ctx, db)).toBe(true);
    expect(await temLembretes(ctx, db)).toBe(false);
    await ligarLembrete(T.ctx, p.id, id, false, db);
    expect(await temLembretesNaTela(ctx, db)).toBe(false);
    expect(await temLembretes(ctx, db)).toBe(false);
    expect(await leituras(T, p.id)).toEqual([]);
  });

  it('T6-01: o lembrete de outro paciente do mesmo consultório não conta para temLembretesNaTela', async () => {
    const { ctx, outro, salvar } = await cenario();
    await salvar(AGUA, outro.id);
    expect(await temLembretesNaTela(ctx, db)).toBe(false);
  });
});
