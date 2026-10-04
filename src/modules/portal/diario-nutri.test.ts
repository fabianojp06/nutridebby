import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, diaryEntries, notifications, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { registrarNoDiario } from './diario';
import { abrirRegistro, ComentarioError, comentarRegistro, contarDiariosNaoVistos, feedDeDiarios, MSG_COMENTARIO } from './diario-nutri';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = { fuso: 'America/Sao_Paulo' };

async function cenario() {
  const T = await novoTenant(app.db);
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
  const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
  const reg = (p: typeof ana, texto: string, quando: string) =>
    registrarNoDiario(ctxPaciente(T.tenantId, p.id), SP, { refeicao: 'Almoço', texto, foto: null }, { db: app.db, agora: new Date(quando) });
  const a1 = await reg(ana, 'arroz', '2026-10-05T15:00:00Z');
  const b1 = await reg(bia, 'salada', '2026-10-05T16:00:00Z');
  const a2 = await reg(ana, 'peixe', '2026-10-05T17:00:00Z');
  return { T, ana, bia, a1, b1, a2 };
}

describe('Diários da nutricionista (US-043)', () => {
  it('feed: todos os pacientes, não vistos primeiro (mais recentes antes); abrir marca visto uma vez', async () => {
    const { T, a1, b1, a2 } = await cenario();
    await abrirRegistro(T.ctx, b1.id, { db: app.db, agora: new Date('2026-10-05T18:00:00Z') });
    const feed = await feedDeDiarios(T.ctx, { db: app.db });
    expect(feed.map((f) => [f.id, f.visto])).toEqual([[a2.id, false], [a1.id, false], [b1.id, true]]);
    expect(feed[0].paciente).toBe('Ana Souza');
    const segunda = await abrirRegistro(T.ctx, b1.id, { db: app.db, agora: new Date('2026-10-06T10:00:00Z') });
    expect(segunda?.visto).toBe(true);
    // a data do "visto" não muda na segunda abertura (R13)
    const [linha] = await withTenant(T.ctx, (tx) => tx.select({ v: diaryEntries.vistoPelaNutriEm }).from(diaryEntries).where(eq(diaryEntries.id, b1.id)), app.db);
    expect(linha.v?.toISOString()).toBe('2026-10-05T18:00:00.000Z');
  });

  it('comentar: o paciente vê; push só no primeiro comentário (D13); vazio e longo recusados', async () => {
    const { T, ana, a1 } = await cenario();
    expect(await comentarRegistro(T.ctx, a1.id, 'Ótima escolha de proteína!', { db: app.db })).toEqual({ primeiro: true });
    expect(await comentarRegistro(T.ctx, a1.id, 'Ótima escolha de proteína! Capriche na salada.', { db: app.db })).toEqual({ primeiro: false });
    const pushes = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.patientId, ana.id), eq(notifications.tipo, 'comentario_diario'))), app.db);
    expect(pushes).toHaveLength(1);
    const visto = (await import('./diario')).diarioDoPaciente;
    expect((await visto(ctxPaciente(T.tenantId, ana.id), { db: app.db })).find((r) => r.id === a1.id)?.comentario).toBe('Ótima escolha de proteína! Capriche na salada.');
    await expect(comentarRegistro(T.ctx, a1.id, '  ', { db: app.db })).rejects.toEqual(new ComentarioError({ comentario: MSG_COMENTARIO.vazio }));
    await expect(comentarRegistro(T.ctx, a1.id, 'x'.repeat(1001), { db: app.db })).rejects.toEqual(new ComentarioError({ comentario: MSG_COMENTARIO.tamanho }));
  });

  it('id de outro tenant ou inválido → null / erro de não encontrado; o paciente não comenta (sem update)', async () => {
    const { T, ana, a1 } = await cenario();
    const outro = await novoTenant(app.db);
    expect(await abrirRegistro(outro.ctx, a1.id, { db: app.db })).toBeNull();
    expect(await abrirRegistro(T.ctx, 'abc', { db: app.db })).toBeNull();
    await expect(comentarRegistro(outro.ctx, a1.id, 'oi', { db: app.db })).rejects.toThrow(MSG_COMENTARIO.naoEncontrado);
    await expect(comentarRegistro(ctxPaciente(T.tenantId, ana.id), a1.id, 'eu mesmo', { db: app.db })).rejects.toThrow(/sessão da nutricionista/);
  });

  it('paciente bloqueado (pedido de exclusão) ou anonimizado: o prontuário é só leitura — comentar recusa e não manda push', async () => {
    const { T, ana, bia, a1, b1 } = await cenario();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, ana.id)), app.db);
    expect((await abrirRegistro(T.ctx, a1.id, { db: app.db }))?.somenteLeitura).toBe(true); // a tela esconde o "Comentar"
    await expect(comentarRegistro(T.ctx, a1.id, 'Ótimo!', { db: app.db })).rejects.toThrow(PacienteBloqueadoError);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ anonimizadoEm: new Date() }).where(eq(patients.id, bia.id)), app.db);
    await expect(comentarRegistro(T.ctx, b1.id, 'Ótimo!', { db: app.db })).rejects.toThrow(PacienteBloqueadoError);
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(inArray(diaryEntries.id, [a1.id, b1.id])), app.db);
    expect(linhas.map((l) => l.comentarioNutri)).toEqual([null, null]);
    const pushes = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.tipo, 'comentario_diario')), app.db);
    expect(pushes).toEqual([]);
  });

  it('leitura do feed auditada por paciente; o texto do diário não vai para o audit_log', async () => {
    const { T, ana } = await cenario();
    await feedDeDiarios(T.ctx, { db: app.db });
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, ana.id), eq(auditLog.entidade, 'diario'), eq(auditLog.acao, 'ler'))), app.db);
    expect(lidas.length).toBeGreaterThan(0);
  });

  it('Início: conta só os não vistos do próprio consultório, sem ler registro (sem auditRead); o paciente não conta', async () => {
    const { T, ana, b1 } = await cenario();
    const outro = await cenario(); // outro consultório com 3 não vistos: não entra na conta
    await abrirRegistro(T.ctx, b1.id, { db: app.db });
    const leiturasAntes = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.acao, 'ler')), app.db);
    expect(await contarDiariosNaoVistos(T.ctx, app.db)).toBe(2);
    expect(await contarDiariosNaoVistos(outro.T.ctx, app.db)).toBe(3);
    const leiturasDepois = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.acao, 'ler')), app.db);
    expect(leiturasDepois).toHaveLength(leiturasAntes.length);
    await expect(contarDiariosNaoVistos(ctxPaciente(T.tenantId, ana.id), app.db)).rejects.toThrow(/sessão da nutricionista/);
  });
});
