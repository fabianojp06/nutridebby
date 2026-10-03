import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { dataExports, privacyRequests } from '@/db/schema';
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

  it('fora de sessão de paciente, nada é pedido', async () => {
    const { T } = await titular();
    await expect(pedirMeusDados(T.ctx, { db: app.db })).rejects.toThrow('só roda em sessão de paciente');
    await expect(pedirExclusao(T.ctx, SP, { db: app.db })).rejects.toThrow('só roda em sessão de paciente');
  });
});
