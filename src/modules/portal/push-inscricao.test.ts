import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { notifications, pushSubscriptions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { vinculosDaConta } from './vinculos';
import { cancelarAparelho, InscricaoInvalidaError, inscreverAparelho } from './push-inscricao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

const sub = (endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) => ({ endpoint, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });

async function comDoisVinculos() {
  const A = await novoTenant(app.db);
  const B = await novoTenant(app.db);
  const { userId, paciente: pa } = await pacienteComConta(app.db, A);
  const { paciente: pb } = await pacienteComConta(app.db, B, { userId });
  const vinculos = await vinculosDaConta(userId, { db: app.db });
  const acesso = { data: { user: { id: userId } }, vinculos, ctx: { tenantId: A.tenantId, role: 'paciente' as const, patientId: pa.id, actorUserId: userId } };
  return { A, B, pa, pb, acesso };
}

describe('inscrição de push (US-040, contrato D14 do Plano 05)', () => {
  it('uma linha por vínculo ativo do aparelho; push de teste só no vínculo atual; repetir não duplica', async () => {
    const { A, B, pa, pb, acesso } = await comDoisVinculos();
    const s = sub();
    expect(await inscreverAparelho(acesso as never, s, 'Chrome Android', { db: app.db })).toBe('inscrito');
    expect(await inscreverAparelho(acesso as never, s, 'Chrome Android', { db: app.db })).toBe('inscrito');
    const emA = await withTenant(A.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, pa.id)), app.db);
    const emB = await withTenant(B.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, pb.id)), app.db);
    expect([emA.length, emB.length]).toEqual([1, 1]);
    expect(emA[0]).toMatchObject({ endpoint: s.endpoint, userAgent: 'Chrome Android' });
    const testes = await withTenant(A.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.patientId, pa.id), eq(notifications.tipo, 'push_teste'))), app.db);
    expect(testes).toHaveLength(2); // cada clique em "Ativar" pede um teste (o motor envia no máximo uma vez cada)
    expect(testes[0]).toMatchObject({ canal: 'push', status: 'pendente', appointmentId: null });
    const testesEmB = await withTenant(B.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.patientId, pb.id)), app.db);
    expect(testesEmB).toEqual([]);
  });

  it('endpoint fora dos serviços de push, http, chaves inválidas → InscricaoInvalidaError, nada gravado', async () => {
    const { A, pa, acesso } = await comDoisVinculos();
    for (const ruim of [sub('https://127.0.0.1/x'), sub('http://fcm.googleapis.com/x'), { endpoint: sub().endpoint, keys: { p256dh: 'x', auth: 'y' } }, 'lixo', null]) {
      await expect(inscreverAparelho(acesso as never, ruim, null, { db: app.db })).rejects.toThrow(InscricaoInvalidaError);
    }
    expect(await withTenant(A.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, pa.id)), app.db)).toEqual([]);
  });

  it('aparelho compartilhado (Review Focus 4): o endpoint de A sai de A quando B abre o portal; B só ganha linha ao ativar', async () => {
    const { A, B, pa, pb, acesso: deA } = await comDoisVinculos();
    const C = await novoTenant(app.db);
    const { userId: uB, paciente: pB } = await pacienteComConta(app.db, C);
    const deB = { data: { user: { id: uB } }, vinculos: await vinculosDaConta(uB, { db: app.db }), ctx: { tenantId: C.tenantId, role: 'paciente' as const, patientId: pB.id, actorUserId: uB } };
    const s = sub();
    expect(await inscreverAparelho(deA as never, s, null, { db: app.db })).toBe('inscrito');
    // B abre o portal no mesmo navegador, que ainda tem a inscrição de A
    expect(await inscreverAparelho(deB as never, s, null, { db: app.db, sincronizar: true })).toBe('de_outra_conta');
    const deAgora = async (T: typeof A, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, id)), app.db)).map((x) => x.endpoint);
    expect(await deAgora(A, pa.id)).toEqual([]);
    expect(await deAgora(B, pb.id)).toEqual([]); // e no outro vínculo da conta de A também
    expect(await deAgora(C, pB.id)).toEqual([]); // B não recebe push sem ter pedido
    // B toca em "Ativar notificações" (o cliente descartou a inscrição velha; aqui o mesmo endpoint basta para o teste)
    expect(await inscreverAparelho(deB as never, s, null, { db: app.db })).toBe('inscrito');
    expect(await deAgora(C, pB.id)).toEqual([s.endpoint]);
    // A volta a entrar e ativa: o endpoint sai de B
    await inscreverAparelho(deA as never, s, null, { db: app.db });
    expect(await deAgora(C, pB.id)).toEqual([]);
    expect(await deAgora(A, pa.id)).toEqual([s.endpoint]);
  });

  it('sincronizar: vínculo novo depois da ativação ganha a linha, sem push de teste; endpoint desconhecido → de_outra_conta', async () => {
    const A = await novoTenant(app.db);
    const { userId, paciente: pa } = await pacienteComConta(app.db, A);
    const acesso1 = { data: { user: { id: userId } }, vinculos: await vinculosDaConta(userId, { db: app.db }), ctx: { tenantId: A.tenantId, role: 'paciente' as const, patientId: pa.id, actorUserId: userId } };
    const s = sub();
    await inscreverAparelho(acesso1 as never, s, null, { db: app.db });
    const B = await novoTenant(app.db);
    const { paciente: pb } = await pacienteComConta(app.db, B, { userId }); // a conta vira paciente de outra nutricionista
    const acesso2 = { ...acesso1, vinculos: await vinculosDaConta(userId, { db: app.db }) };
    expect(await inscreverAparelho(acesso2 as never, s, null, { db: app.db, sincronizar: true })).toBe('inscrito');
    const emB = await withTenant(B.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, pb.id)), app.db);
    expect(emB.map((x) => x.endpoint)).toEqual([s.endpoint]);
    const testes = await withTenant(A.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.patientId, pa.id), eq(notifications.tipo, 'push_teste'))), app.db);
    expect(testes).toHaveLength(1); // só o da ativação
    expect(await inscreverAparelho(acesso2 as never, sub(), null, { db: app.db, sincronizar: true })).toBe('de_outra_conta');
  });

  it('app_soltar_endpoint_push só roda na sessão de paciente (nutricionista e worker → 42501)', async () => {
    const A = await novoTenant(app.db);
    // o erro do pg vem embrulhado (DrizzleQueryError → cause); o mesmo laço do violaRls de agendamento-publico.test.ts
    const codigo = (e: unknown) => {
      let c = e as { code?: string; cause?: unknown } | undefined;
      for (let i = 0; c && i < 5; i++, c = c.cause as typeof c) if (c.code) return c.code;
      return undefined;
    };
    const soltar = (ctx: Parameters<typeof withTenant>[0]) => withTenant(ctx, (tx) => tx.execute(sql`select app_soltar_endpoint_push(${sub().endpoint})`), app.db);
    await expect(soltar(A.ctx).catch(codigo)).resolves.toBe('42501');
    await expect(soltar({ tenantId: A.tenantId, role: 'worker' }).catch(codigo)).resolves.toBe('42501');
  });

  it('cancelar apaga o endpoint em todos os vínculos (Sair, Review Focus 4); outro aparelho fica', async () => {
    const { A, B, pa, pb, acesso } = await comDoisVinculos();
    const este = sub();
    const outro = sub();
    await inscreverAparelho(acesso as never, este, null, { db: app.db });
    await inscreverAparelho(acesso as never, outro, null, { db: app.db });
    await cancelarAparelho(acesso as never, este.endpoint, { db: app.db });
    await cancelarAparelho(acesso as never, 42, { db: app.db }); // lixo: nada
    const restantes = async (T: typeof A, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, id)), app.db)).map((x) => x.endpoint);
    expect(await restantes(A, pa.id)).toEqual([outro.endpoint]);
    expect(await restantes(B, pb.id)).toEqual([outro.endpoint]);
  });
});
