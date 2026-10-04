import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { dataExports, patients, privacyRequests } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { estadoDosMeusDados, pedirExclusao, pedirMeusDados } from './meus-dados';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

async function titular() {
  const T = await novoTenant(app.db, 'Debby Silva');
  const { paciente, userId, email } = await pacienteComConta(app.db, T);
  return { T, paciente, email, ctx: { ...ctxPaciente(T.tenantId, paciente.id), actorUserId: userId } };
}

const SP = { fuso: 'America/Sao_Paulo', nomeExibicao: 'Debby Silva' };

describe('Meus dados (US-046, D16, D17)', () => {
  it('"Baixar meus dados": pedido do titular; de novo em menos de 24 h → já pedido; depois de 24 h, outro', async () => {
    const { T, paciente, ctx } = await titular();
    const agora = new Date('2026-10-05T15:00:00Z');
    expect(await pedirMeusDados(ctx, { db: app.db, agora })).toBe('pedido');
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(dataExports).where(eq(dataExports.patientId, paciente.id)), app.db);
    expect(e).toMatchObject({ escopo: 'titular', status: 'pendente', solicitadoPor: ctx.actorUserId });
    await withTenant(T.ctx, (tx) => tx.update(dataExports).set({ status: 'pronta' }).where(eq(dataExports.id, e.id)), app.db);
    expect(await pedirMeusDados(ctx, { db: app.db, agora: new Date('2026-10-06T14:00:00Z') })).toBe('ja_pedido');
    expect(await pedirMeusDados(ctx, { db: app.db, agora: new Date('2026-10-06T15:01:00Z') })).toBe('pedido');
  });

  it('pendente do titular há mais de 30 min (job perdido) não prende por 24 h; o pendente da equipe não conta para o titular', async () => {
    const { T, paciente, ctx } = await titular();
    const agora = new Date('2026-10-05T15:00:00Z');
    await withTenant(T.ctx, (tx) => tx.insert(dataExports).values({ tenantId: T.tenantId, patientId: paciente.id, escopo: 'equipe', createdAt: agora, updatedAt: agora }), app.db);
    expect(await pedirMeusDados(ctx, { db: app.db, agora })).toBe('pedido'); // o da equipe, pendente, não é "já pedido"
    expect(await pedirMeusDados(ctx, { db: app.db, agora: new Date('2026-10-05T15:20:00Z') })).toBe('ja_pedido');
    expect(await pedirMeusDados(ctx, { db: app.db, agora: new Date('2026-10-05T15:31:00Z') })).toBe('pedido');
    const pedidos = await withTenant(T.ctx, (tx) => tx.select().from(dataExports).where(eq(dataExports.patientId, paciente.id)), app.db);
    expect(pedidos.map((e) => `${e.escopo}:${e.status}`).sort()).toEqual(['equipe:pendente', 'titular:falhou', 'titular:pendente']);
  });

  it('o titular vê só os próprios pedidos do escopo titular (o da equipe, com rascunho, não abre pelo portal)', async () => {
    const { T, paciente, ctx } = await titular();
    const [daEquipe] = await withTenant(T.ctx, (tx) => tx.insert(dataExports).values({ tenantId: T.tenantId, patientId: paciente.id, escopo: 'equipe' }).returning(), app.db);
    expect(await estadoDosMeusDados(ctx, daEquipe.id, { db: app.db })).toEqual({ estado: 'inexistente' });
    const [doTitular] = await withTenant(T.ctx, (tx) => tx.insert(dataExports).values({ tenantId: T.tenantId, patientId: paciente.id, escopo: 'titular' }).returning(), app.db);
    expect(await estadoDosMeusDados(ctx, doTitular.id, { db: app.db })).toEqual({ estado: 'pendente' });
    // de outro paciente do mesmo consultório: não existe para este titular
    const outro = await titular();
    expect(await estadoDosMeusDados(outro.ctx, doTitular.id, { db: app.db })).toEqual({ estado: 'inexistente' });
  });

  it('"Pedir exclusão": privacy_requests aberto com prazo de 15 dias no fuso; e-mail "Seu pedido foi registrado"; de novo → a data do primeiro', async () => {
    const { T, paciente, email, ctx } = await titular();
    const r = await pedirExclusao(ctx, SP, { db: app.db, agora: new Date('2026-10-06T02:00:00Z') }); // 05/10 23:00 em SP
    expect(r).toEqual({ registrado: true });
    const [pr] = await withTenant(T.ctx, (tx) => tx.select().from(privacyRequests).where(and(eq(privacyRequests.patientId, paciente.id), eq(privacyRequests.status, 'aberto'))), app.db);
    expect(pr).toMatchObject({ tipo: 'exclusao', prazo: '2026-10-20' });
    const [msg] = await emailsNaFila('pedido_exclusao_registrado', email);
    expect(msg).toMatchObject({ nutri: 'Debby Silva', prazo: '20/10/2026' });
    expect(await pedirExclusao(ctx, SP, { db: app.db })).toEqual({ jaPedidoEm: '05/10/2026' });
  });

  it('dois cliques ao mesmo tempo: um pedido aberto só (paciente travado + índice único) e um e-mail', async () => {
    const { T, paciente, email, ctx } = await titular();
    const rs = await Promise.all([1, 2, 3].map(() => pedirExclusao(ctx, SP, { db: app.db, agora: new Date('2026-10-05T15:00:00Z') })));
    expect(rs.filter((r) => 'registrado' in r)).toHaveLength(1);
    const abertos = await withTenant(T.ctx, (tx) => tx.select().from(privacyRequests).where(eq(privacyRequests.patientId, paciente.id)), app.db);
    expect(abertos).toHaveLength(1);
    expect(await emailsNaFila('pedido_exclusao_registrado', email)).toHaveLength(1);
  });

  it('L-1: paciente que deixou de ser ativo (bloqueado, arquivado ou anonimizado) não registra pedido de exclusão nem recebe e-mail', async () => {
    for (const fora of [{ status: 'bloqueado' as const }, { status: 'arquivado' as const }, { status: 'bloqueado' as const, anonimizadoEm: new Date() }]) {
      const { T, paciente, email, ctx } = await titular();
      await withTenant(T.ctx, (tx) => tx.update(patients).set(fora).where(eq(patients.id, paciente.id)), app.db);
      expect(await pedirExclusao(ctx, SP, { db: app.db })).toEqual({ semAcesso: true });
      expect(await withTenant(T.ctx, (tx) => tx.select().from(privacyRequests).where(eq(privacyRequests.patientId, paciente.id)), app.db)).toEqual([]);
      expect(await emailsNaFila('pedido_exclusao_registrado', email)).toEqual([]);
    }
  });

  it('L-1: corrida com o atendimento — o pedido esperando a trava do paciente vê o bloqueio e não deixa pedido aberto de bloqueado', async () => {
    const { T, paciente, ctx } = await titular();
    let pedido!: ReturnType<typeof pedirExclusao>;
    await withTenant(
      T.ctx,
      async (tx) => {
        // como atenderPedidoExclusao: trava o paciente e o bloqueia; o pedido do portal espera a trava
        await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, paciente.id)).for('update');
        pedido = pedirExclusao(ctx, SP, { db: app.db });
        await new Promise((r) => setTimeout(r, 300));
        await tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date() }).where(eq(patients.id, paciente.id));
      },
      app.db,
    );
    expect(await pedido).toEqual({ semAcesso: true });
    const abertos = await withTenant(T.ctx, (tx) => tx.select().from(privacyRequests).where(and(eq(privacyRequests.patientId, paciente.id), eq(privacyRequests.status, 'aberto'))), app.db);
    expect(abertos).toEqual([]);
  });

  it('L-3: o link de um pendente perdido (> 30 min, job que não volta) diz que falhou, não "volte em alguns minutos"', async () => {
    const { T, paciente, ctx } = await titular();
    const criado = new Date('2026-10-05T15:00:00Z');
    const [e] = await withTenant(T.ctx, (tx) => tx.insert(dataExports).values({ tenantId: T.tenantId, patientId: paciente.id, escopo: 'titular', createdAt: criado, updatedAt: criado }).returning(), app.db);
    expect(await estadoDosMeusDados(ctx, e.id, { db: app.db, agora: new Date('2026-10-05T15:30:00Z') })).toEqual({ estado: 'pendente' });
    expect(await estadoDosMeusDados(ctx, e.id, { db: app.db, agora: new Date('2026-10-05T15:31:00Z') })).toEqual({ estado: 'falhou' });
  });

  it('L-3: "falhou" em sequência tem limite — no máximo 3 pedidos do titular em 24 h, mesmo que todos falhem', async () => {
    const { T, paciente, ctx } = await titular();
    const t0 = new Date('2026-10-05T15:00:00Z');
    const em = (min: number) => new Date(t0.getTime() + min * 60_000);
    const falharTodos = () => withTenant(T.ctx, (tx) => tx.update(dataExports).set({ status: 'falhou' }).where(eq(dataExports.patientId, paciente.id)), app.db);
    for (const min of [0, 10, 20]) {
      expect(await pedirMeusDados(ctx, { db: app.db, agora: em(min) })).toBe('pedido');
      await falharTodos();
    }
    // achado 1 do /code-review: o teto atingido só por falhas não diz "o link chega por e-mail" (nenhum vai chegar)
    expect(await pedirMeusDados(ctx, { db: app.db, agora: em(30) })).toBe('limite_falhas');
    expect(await withTenant(T.ctx, (tx) => tx.select().from(dataExports).where(eq(dataExports.patientId, paciente.id)), app.db)).toHaveLength(3);
    // 24 h depois do primeiro, abre uma vaga
    expect(await pedirMeusDados(ctx, { db: app.db, agora: em(24 * 60 + 1) })).toBe('pedido');
  });

  it('achado 1 do /code-review: no teto, com um pedido que ainda vale (pronto ou pendente recente), segue "já pedido"; pendente perdido conta como falha', async () => {
    const { T, paciente, ctx } = await titular();
    const t0 = new Date('2026-10-05T15:00:00Z');
    const em = (min: number) => new Date(t0.getTime() + min * 60_000);
    const linha = (status: 'pendente' | 'pronta' | 'falhou', criado: Date) =>
      withTenant(T.ctx, (tx) => tx.insert(dataExports).values({ tenantId: T.tenantId, patientId: paciente.id, escopo: 'titular', status, createdAt: criado, updatedAt: criado }), app.db);
    await linha('falhou', em(0));
    await linha('falhou', em(10));
    await linha('pendente', em(20)); // perdido aos 51 min
    expect(await pedirMeusDados(ctx, { db: app.db, agora: em(40) })).toBe('ja_pedido'); // ainda pode chegar
    expect(await pedirMeusDados(ctx, { db: app.db, agora: em(51) })).toBe('limite_falhas');
    await withTenant(T.ctx, (tx) => tx.update(dataExports).set({ status: 'pronta' }).where(eq(dataExports.status, 'pendente')), app.db);
    expect(await pedirMeusDados(ctx, { db: app.db, agora: em(51) })).toBe('ja_pedido');
  });

  it('fora de sessão de paciente, nada é pedido', async () => {
    const { T } = await titular();
    await expect(pedirMeusDados(T.ctx, { db: app.db })).rejects.toThrow('só roda em sessão de paciente');
    await expect(pedirExclusao(T.ctx, SP, { db: app.db })).rejects.toThrow('só roda em sessão de paciente');
  });
});
