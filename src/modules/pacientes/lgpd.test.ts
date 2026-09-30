import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, exams, invites, patients, privacyRequests, storedFiles, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { entradaDoFormulario, registrarAntropometria } from './antropometria';
import { registrarAtendimento } from './atendimentos';
import { PacienteBloqueadoError } from './base';
import { criarExame } from './exames';
import { anonimizarVencidos, arquivarPaciente, atenderPedidoExclusao, desarquivarPaciente, LgpdError, MSG_LGPD, PRAZO_GUARDA_ANOS } from './lgpd';
import { criarPaciente } from './pacientes';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-lgpd-'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now, appUrl: 'http://localhost:3000', dataDir };
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const ler = async (ctx: Parameters<typeof withTenant>[0], id: string) => (await withTenant(ctx, (tx) => tx.select().from(patients).where(eq(patients.id, id)), app.db))[0];
const cadastro = (email: string) => ({ nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email, telefone: '(11) 91234-5678', whatsappAutorizado: true });

describe('arquivar (US-018 "Arquivar", RN-08)', () => {
  it('arquiva (o prontuário fica), apaga o convite pendente e desarquiva; bloqueado não desarquiva', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(`arq-${randomUUID().slice(0, 8)}@ex.com`), deps);
    await arquivarPaciente(T.ctx, p.id, app.db);
    expect((await ler(T.ctx, p.id)).status).toBe('arquivado');
    expect(await app.db.select().from(invites).where(and(eq(invites.patientId, p.id), isNull(invites.usadoEm)))).toEqual([]);
    await desarquivarPaciente(T.ctx, p.id, app.db);
    expect((await ler(T.ctx, p.id)).status).toBe('ativo');
    const bloqueado = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(desarquivarPaciente(T.ctx, bloqueado.id, app.db)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
});

describe('atender pedido de exclusão durante a guarda (US-018, RNF-08)', () => {
  it('confirmar com outro nome não muda nada; com o nome (sem diferenciar maiúsculas/espaços) bloqueia, apaga opt-ins, conclui o pedido, audita e avisa o paciente', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    const email = `exc-${randomUUID().slice(0, 8)}@ex.com`;
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(email), deps);
    await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-09-15', notasPrivadas: '', orientacoes: '' }, deps);
    await expect(atenderPedidoExclusao(T.ctx, T.tenant, p.id, 'Ana', deps)).rejects.toThrow(MSG_LGPD.confirmarNome);
    expect((await ler(T.ctx, p.id)).status).toBe('ativo');

    const r = await atenderPedidoExclusao(T.ctx, T.tenant, p.id, '  ana   SOUZA ', deps);
    expect(r).toEqual({ anonimizarApos: `${2026 + PRAZO_GUARDA_ANOS}-09-15` }); // última consulta + prazo legal (P-01)
    const b = await ler(T.ctx, p.id);
    expect(b).toMatchObject({ status: 'bloqueado', whatsappOptinEm: null, whatsappOptinOrigem: null, anonimizarApos: '2046-09-15', nome: 'Ana Souza' });
    expect(b.bloqueadoEm?.toISOString()).toBe(now.toISOString());
    expect(b.whatsappOptoutEm?.toISOString()).toBe(now.toISOString());
    const [pedido] = await withTenant(T.ctx, (tx) => tx.select().from(privacyRequests).where(eq(privacyRequests.patientId, p.id)), app.db);
    expect(pedido).toMatchObject({ tipo: 'exclusao', status: 'concluido', prazo: '2026-10-16' });
    expect(await app.db.select().from(invites).where(and(eq(invites.patientId, p.id), isNull(invites.usadoEm)))).toEqual([]);
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'bloquear'))), app.db);
    expect(log[0]).toMatchObject({ entidade: 'patients', actorUserId: T.nutriId });
    const [msg] = await emailsNaFila('exclusao_atendida', email);
    expect(msg).toMatchObject({ nome: 'Ana Souza', nutri: 'Debby Silva', anonimizarApos: '15/09/2046' });
    // prontuário mantido e só para consulta
    await expect(registrarAntropometria(T.ctx, T.tenant, p.id, entradaDoFormulario({ data: '2026-10-01', pesoKg: '60', alturaCm: '165', protocolo: 'nenhum' }), deps)).rejects.toBeInstanceOf(
      PacienteBloqueadoError,
    );
  });

  it('pedido já aberto (registrado pelo portal no Plano 06) é concluído, sem criar outro; sem atendimento, conta da data do bloqueio', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.insert(privacyRequests).values({ tenantId: T.tenantId, patientId: p.id, tipo: 'exclusao', prazo: '2026-10-10' }), app.db);
    const r = await atenderPedidoExclusao(T.ctx, T.tenant, p.id, 'Ana Souza', deps);
    expect(r.anonimizarApos).toBe('2046-10-01');
    const pedidos = await withTenant(T.ctx, (tx) => tx.select().from(privacyRequests).where(eq(privacyRequests.patientId, p.id)), app.db);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]).toMatchObject({ status: 'concluido', prazo: '2026-10-10' });
    await expect(atenderPedidoExclusao(T.ctx, T.tenant, p.id, 'Ana Souza', deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
  it('paciente arquivado também pode ter o pedido atendido e passa a bloqueado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    await atenderPedidoExclusao(T.ctx, T.tenant, p.id, 'Ana Souza', deps);
    expect((await ler(T.ctx, p.id)).status).toBe('bloqueado');
  });
});

describe('fim do prazo de guarda (job diário de retenção)', () => {
  it('anonimiza nome, e-mail, telefone e nascimento, solta a conta, apaga os anexos de /data e audita como Sistema; é idempotente', async () => {
    const T = await novoTenant(app.db);
    const uid = randomUUID();
    await app.db.insert(user).values({ id: uid, name: 'Ana', email: `conta-${uid.slice(0, 8)}@ex.com`, appRole: 'paciente' });
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511912345678', userId: uid });
    const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500)]);
    await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Hemograma', data: '2026-09-01', valores: [], arquivo: PDF }, deps);
    const [exame] = await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.patientId, p.id)), app.db);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizarApos: '2026-09-30' }).where(eq(patients.id, p.id)), app.db);
    const futuro = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2046-09-30' });
    const noDia = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2026-10-01' }); // hoje em São Paulo

    const r = await anonimizarVencidos(app.db, now, { dataDir });
    expect(r.anonimizados).toBeGreaterThanOrEqual(1);
    const a = await ler(T.ctx, p.id);
    expect(a).toMatchObject({ nome: 'Paciente anonimizado', email: `anonimo-${p.id}@anonimizado.invalid`, telefoneE164: null, dataNascimento: null, userId: null, status: 'bloqueado' });
    expect(a.anonimizadoEm?.toISOString()).toBe(now.toISOString());
    expect(existsSync(path.join(dataDir, exame.arquivoPath!))).toBe(false);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
    expect((await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, exame.id)), app.db))[0].arquivoPath).toBeNull(); // o exame (valores) fica
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'anonimizar'))), app.db);
    expect(log).toHaveLength(1);
    expect(log[0].actorUserId).toBeNull();
    expect((await ler(T.ctx, futuro.id)).anonimizadoEm).toBeNull(); // prazo ainda não venceu
    expect((await ler(T.ctx, noDia.id)).anonimizadoEm).toBeNull(); // "guardado até 01/10": no próprio dia, ainda não

    await anonimizarVencidos(app.db, now, { dataDir });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'anonimizar'))), app.db)).toHaveLength(1);
  });

  it('nome digitado errado ou paciente de outro tenant: nada acontece', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pB = await novoPaciente(app.db, B.ctx);
    await expect(atenderPedidoExclusao(A.ctx, A.tenant, pB.id, 'Ana Souza', deps)).rejects.toThrow();
    expect((await ler(B.ctx, pB.id)).status).toBe('ativo');
    await expect(atenderPedidoExclusao(B.ctx, B.tenant, pB.id, '', deps)).rejects.toBeInstanceOf(LgpdError);
  });
});
