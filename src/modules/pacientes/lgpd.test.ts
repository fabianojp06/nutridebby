import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { documentoNoBanco, pdfDeTeste } from '../../../test/documentos';
import { novoConteudo } from '../../../test/conteudos';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { closeDb } from '@/db/client';
import { logger } from '@/lib/logger';
import { accessEvents, account, appointments, auditLog, consents, diaryEntries, exams, invites, notifications, patients, privacyRequests, pushSubscriptions, session, storedFiles, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { sealSecret } from '@/lib/crypto';
import { FINALIDADE_CONTEUDO } from '@/modules/notificacoes/mensagens';
import { getBoss, stopBoss } from '@/jobs/boss';
import { apagarArquivo, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { registrarVerificacao, consultarVerificacao } from '@/modules/documentos/verificacao';
import { anonimizarDocumentosDoPaciente } from '@/modules/documentos/lgpd-documentos';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { entradaDoFormulario, registrarAntropometria } from './antropometria';
import { registrarAtendimento } from './atendimentos';
import { PacienteBloqueadoError } from './base';
import { criarExame } from './exames';
import { anexosDoPaciente, anonimizarVencidos, apagarFotosDoDiario, arquivarPaciente, atenderPedidoExclusao, concluirExclusaoAtendida, desarquivarPaciente, LgpdError, MSG_LGPD, pedidosDoTitularAbertos, PRAZO_GUARDA_ANOS } from './lgpd';
import { criarPaciente } from './pacientes';

// Rodada 2 da T13: a varredura da anonimização (listarTenantsParaVarredura) só passa pelos tenants deste arquivo — os
// arquivos de teste rodam em paralelo no mesmo banco, cada um com o seu dataDir (implementação real por baixo)
vi.mock('@/modules/plataforma/tenant-status', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/plataforma/tenant-status')>();
  return { ...real, listarTenantsParaVarredura: vi.fn(real.listarTenantsParaVarredura) };
});
// Plano 10A (T14): a ordem dos apagarArquivo (documentos antes dos anexos) e a falha simulada da etapa dos documentos
vi.mock('@/modules/plataforma/armazenamento', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/plataforma/armazenamento')>();
  return { ...real, apagarArquivo: vi.fn(real.apagarArquivo) };
});
vi.mock('@/modules/documentos/lgpd-documentos', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/documentos/lgpd-documentos')>();
  return { ...real, anonimizarDocumentosDoPaciente: vi.fn(real.anonimizarDocumentosDoPaciente) };
});

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

/** Anonimização (job retencao-lgpd) só destes tenants. */
const anonimizarSo = (...ts: TenantDeTeste[]) => {
  vi.mocked(listarTenantsParaVarredura).mockResolvedValueOnce(ts.map((t) => ({ id: t.tenantId, fuso: t.tenant.fuso })));
  return anonimizarVencidos(app.db, now, { dataDir });
};
/** F-13: os jobs `exclusao-atendida` (aviso ao paciente depois das fotos) deste paciente. */
const jobsDaExclusao = async (patientId: string) =>
  (await (await getBoss()).findJobs<{ tenantId: string; patientId: string }>('exclusao-atendida')).map((j) => j.data).filter((d) => d.patientId === patientId);
const ler = async (ctx: Parameters<typeof withTenant>[0], id: string) => (await withTenant(ctx, (tx) => tx.select().from(patients).where(eq(patients.id, id)), app.db))[0];
const cadastro = (email: string) => ({ nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email, telefone: '(11) 91234-5678', whatsappAutorizado: true });
/** D15: o titular como alvo de um conteúdo, com uma visualização e um favorito dele (gravados como a nutricionista). */
const usoDeConteudo = async (T: TenantDeTeste, patientId: string) => {
  const c = await novoConteudo(app.db, T, { visibilidade: 'pacientes', pacientes: [patientId] });
  await withTenant(
    T.ctx,
    async (tx) => {
      await tx.execute(sql`insert into content_views (tenant_id, content_id, patient_id, visto_em) values (${T.tenantId}, ${c.id}, ${patientId}, '2026-10-20T12:00:00Z')`);
      await tx.execute(sql`insert into content_favorites (tenant_id, content_id, patient_id, created_at) values (${T.tenantId}, ${c.id}, ${patientId}, '2026-10-20T12:05:00Z')`);
    },
    app.db,
  );
};
/** D15: visualizações, favoritos e alvos de conteúdo do titular. */
const contagemDeConteudo = async (T: TenantDeTeste, patientId: string) =>
  (
    await withTenant(
      T.ctx,
      (tx) =>
        tx.execute(sql`select (select count(*) from content_views where patient_id = ${patientId})::int as v, (select count(*) from content_favorites where patient_id = ${patientId})::int as f,
          (select count(*) from content_audience where patient_id = ${patientId})::int as a`),
      app.db,
    )
  ).rows[0];

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
  it('apaga as inscrições de push do paciente (só as dele, D14); com o nome errado, nada é apagado', async () => {
    const T = await novoTenant(app.db);
    const [ana, bia] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' })];
    for (const p of [ana, ana, bia]) {
      await withTenant(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId: p.id, endpoint: `https://push.example.test/${randomUUID()}`, p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }), app.db);
    }
    await expect(atenderPedidoExclusao(T.ctx, T.tenant, ana.id, 'Outro nome', deps)).rejects.toThrow(MSG_LGPD.confirmarNome);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(pushSubscriptions), app.db)).toHaveLength(3); // recusado: nada apagado
    await usoDeConteudo(T, ana.id);
    await usoDeConteudo(T, bia.id);
    await atenderPedidoExclusao(T.ctx, T.tenant, ana.id, ana.nome, deps);
    const restam = await withTenant(T.ctx, (tx) => tx.select().from(pushSubscriptions), app.db);
    expect(restam.map((s) => s.patientId)).toEqual([bia.id]);
    // D15: sai das audiências de conteúdo (US-018), sem uso em conteúdo (RNF-08) — só ela
    expect(await contagemDeConteudo(T, ana.id)).toEqual({ v: 0, f: 0, a: 0 });
    expect(await contagemDeConteudo(T, bia.id)).toEqual({ v: 1, f: 1, a: 1 });
  });

  it('D13: o pedido atendido apaga os acessos do titular ao portal (access_events) — só os dele', async () => {
    const T = await novoTenant(app.db);
    const [ana, bia] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' })];
    for (const p of [ana, bia]) await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: p.id, dia: '2026-09-10' }), app.db);
    await atenderPedidoExclusao(T.ctx, T.tenant, ana.id, ana.nome, deps);
    const restam = await withTenant(T.ctx, (tx) => tx.select({ patientId: accessEvents.patientId }).from(accessEvents), app.db);
    expect(restam.map((r) => r.patientId)).toEqual([bia.id]);
  });

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
    // F-13: o aviso ao paciente sai pelo job exclusao-atendida, depois de apagar as fotos do diário
    expect(await emailsNaFila('exclusao_atendida', email)).toEqual([]);
    expect(await jobsDaExclusao(p.id)).toEqual([{ tenantId: T.tenantId, patientId: p.id }]);
    expect(await concluirExclusaoAtendida({ tenantId: T.tenantId, patientId: p.id }, { db: app.db, dataDir, ultimaTentativa: false })).toBe('avisado');
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
  it('decisão do dono (fechamento): as consultas FUTURAS do paciente são canceladas na mesma transação, pelo "sistema", sem aviso ao paciente; as pendências delas viram "ignorada" (sem texto cifrado); a nutricionista recebe UM aviso', async () => {
    const T = await novoTenant(app.db);
    const nutriEmail = (await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId)))[0].email;
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza Lima' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const h = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`);
    const futura = await consultaDireta(app.db, T.ctx, ana.id, h('2026-10-20', '14:00'));
    const confirmada = await consultaDireta(app.db, T.ctx, ana.id, h('2026-11-03', '09:00'), 60, { status: 'confirmada', confirmadaVia: 'link' });
    const passada = await consultaDireta(app.db, T.ctx, ana.id, h('2026-09-20', '14:00'));
    const jaCancelada = await consultaDireta(app.db, T.ctx, ana.id, h('2026-10-22', '14:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: h('2026-09-25', '10:00') });
    const daBia = await consultaDireta(app.db, T.ctx, bia.id, h('2026-10-21', '14:00'));
    const notif = (appointmentId: string, patientId: string, inicio: Date, extra: Partial<typeof notifications.$inferInsert>) => ({
      tenantId: T.tenantId, patientId, appointmentId, inicioConsulta: inicio, canal: 'email', tipo: 'lembrete_24h', agendadaPara: new Date(inicio.getTime() - 86_400_000), ...extra,
    });
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values([
      notif(futura, ana.id, h('2026-10-20', '14:00'), {}),
      notif(futura, ana.id, h('2026-10-20', '14:00'), { canal: 'whatsapp', conteudoSelado: sealSecret('texto pronto', FINALIDADE_CONTEUDO) }),
      notif(futura, ana.id, h('2026-10-20', '14:00'), { tipo: 'consulta_marcada', status: 'enviada', enviadaEm: h('2026-09-30', '10:00'), agendadaPara: h('2026-09-30', '10:00') }),
      notif(confirmada, ana.id, h('2026-11-03', '09:00'), { tipo: 'lembrete_2h', canal: 'push' }),
      notif(daBia, bia.id, h('2026-10-21', '14:00'), {}),
    ]), app.db);

    await atenderPedidoExclusao(T.ctx, T.tenant, ana.id, 'Ana Souza Lima', deps);

    const consultas = await withTenant(T.ctx, (tx) => tx.select().from(appointments), app.db);
    const de = (id: string) => consultas.find((c) => c.id === id)!;
    for (const id of [futura, confirmada]) expect(de(id)).toMatchObject({ status: 'cancelada', canceladoPor: 'sistema', canceladaEm: now, motivoCancelamento: null, pedidoRemarcacaoEm: null });
    expect(de(passada)).toMatchObject({ status: 'agendada', canceladoPor: null });
    expect(de(jaCancelada)).toMatchObject({ canceladoPor: 'nutri', canceladaEm: h('2026-09-25', '10:00') });
    expect(de(daBia)).toMatchObject({ status: 'agendada' });

    const ns = await withTenant(T.ctx, (tx) => tx.select().from(notifications), app.db);
    const daAna = ns.filter((n) => n.patientId === ana.id);
    // nada pendente da Ana; nenhum "Consulta cancelada" para ela; o que já saiu fica como está
    expect(daAna.filter((n) => n.status === 'pendente')).toEqual([]);
    expect(daAna.filter((n) => n.tipo === 'consulta_cancelada')).toEqual([]);
    expect(daAna.filter((n) => n.status === 'ignorada').map((n) => [n.tipo, n.canal, n.motivoIgnorada, n.conteudoSelado]).sort()).toEqual(
      [['lembrete_24h', 'email', 'consulta_cancelada', null], ['lembrete_24h', 'whatsapp', 'consulta_cancelada', null], ['lembrete_2h', 'push', 'consulta_cancelada', null]].sort(),
    );
    expect(daAna.find((n) => n.tipo === 'consulta_marcada')).toMatchObject({ status: 'enviada' });
    expect(ns.filter((n) => n.patientId === bia.id).map((n) => n.status)).toEqual(['pendente']);

    // para a paciente, só o e-mail de sempre do pedido atendido (F-13: pelo job, depois das fotos); para a nutricionista, UM aviso, sem dado de saúde
    await concluirExclusaoAtendida({ tenantId: T.tenantId, patientId: ana.id }, { db: app.db, dataDir, ultimaTentativa: false });
    expect((await emailsNaFila('exclusao_atendida', ana.email))).toHaveLength(1);
    expect(await emailsNaFila('exclusao_consultas_canceladas', nutriEmail)).toEqual([{ tipo: 'exclusao_consultas_canceladas', para: nutriEmail, paciente: 'Ana', quantidade: 2 }]);

    // o gatilho de auditoria registra o cancelamento como a nutricionista que atendeu o pedido (entidade "agenda")
    const logs = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'agenda'), eq(auditLog.acao, 'alterar'))), app.db);
    expect(logs.map((l) => l.entidadeId).sort()).toEqual([futura, confirmada].sort());
    for (const l of logs) expect(l).toMatchObject({ patientId: ana.id, actorUserId: T.nutriId });

    // Bia: 1 consulta futura → um aviso só dela; Cris (só consulta passada) → nenhum aviso
    await atenderPedidoExclusao(T.ctx, T.tenant, bia.id, 'Bia Lima', deps);
    expect((await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, daBia)), app.db))[0]).toMatchObject({ status: 'cancelada', canceladoPor: 'sistema' });
    const cris = await novoPaciente(app.db, T.ctx, { nome: 'Cris Dias' });
    await consultaDireta(app.db, T.ctx, cris.id, h('2026-09-10', '10:00'));
    await atenderPedidoExclusao(T.ctx, T.tenant, cris.id, 'Cris Dias', deps);
    expect((await emailsNaFila('exclusao_consultas_canceladas', nutriEmail)).map((m) => [m.paciente, m.quantidade])).toEqual([['Ana', 2], ['Bia', 1]]);
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
    // rodada 2 da T13: um tenant que não é desta varredura (outro arquivo de teste, rodando ao mesmo tempo, com outro dataDir)
    const alheio = await novoTenant(app.db);
    const deOutroArquivo = await novoPaciente(app.db, alheio.ctx, { status: 'bloqueado', anonimizarApos: '2026-09-30' });

    const r = await anonimizarSo(T);
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
    expect((await ler(alheio.ctx, deOutroArquivo.id)).anonimizadoEm, 'a varredura do teste só passa pelos próprios tenants').toBeNull();

    await anonimizarSo(T);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'anonimizar'))), app.db)).toHaveLength(1);
  });

  it('rodada 1: a anonimização apaga também as inscrições de push gravadas depois do pedido (só as do vínculo)', async () => {
    const T = await novoTenant(app.db);
    const vencido = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2026-09-01' });
    const outro = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    for (const p of [vencido, vencido, outro]) {
      await withTenant(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId: p.id, endpoint: `https://push.example.test/${randomUUID()}`, p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }), app.db);
    }
    // R9 (D15): alvo, visualização e favorito de conteúdo gravados depois do bloqueio também saem
    await usoDeConteudo(T, vencido.id);
    await usoDeConteudo(T, outro.id);
    await anonimizarSo(T);
    expect((await ler(T.ctx, vencido.id)).anonimizadoEm?.toISOString()).toBe(now.toISOString());
    const restam = await withTenant(T.ctx, (tx) => tx.select().from(pushSubscriptions), app.db);
    expect(restam.map((s) => s.patientId)).toEqual([outro.id]);
    expect(await contagemDeConteudo(T, vencido.id)).toEqual({ v: 0, f: 0, a: 0 });
    expect(await contagemDeConteudo(T, outro.id)).toEqual({ v: 1, f: 1, a: 1 });
  });

  it('D13: a anonimização apaga os acessos ao portal gravados depois do bloqueio (só os do titular anonimizado)', async () => {
    const T = await novoTenant(app.db);
    const vencido = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2026-09-01' });
    const outro = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    for (const p of [vencido, outro]) await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: p.id, dia: '2026-09-20' }), app.db);
    await anonimizarSo(T);
    expect((await ler(T.ctx, vencido.id)).anonimizadoEm?.toISOString()).toBe(now.toISOString());
    const restam = await withTenant(T.ctx, (tx) => tx.select({ patientId: accessEvents.patientId }).from(accessEvents), app.db);
    expect(restam.map((r) => r.patientId)).toEqual([outro.id]);
  });

  it('Tarefa 15 (D10, D13): apaga o motivo do cancelamento, o link online e o destino do WhatsApp; os aceites do termo ficam sem IP e sem a conta', async () => {
    const T = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const uid = randomUUID();
    await app.db.insert(user).values({ id: uid, name: 'Ana', email: `conta-${uid.slice(0, 8)}@ex.com`, appRole: 'paciente' });
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2026-09-30', userId: uid });
    const outro = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const cancelada = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-10T12:00:00Z'), 60, {
      modalidade: 'online', linkOnline: 'https://meet.example/ana-souza', status: 'cancelada', canceladoPor: 'nutri', canceladaEm: now, motivoCancelamento: 'Viagem com a Ana',
    });
    const presencial = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-11T12:00:00Z'), 60, { status: 'realizada' });
    const daBia = await consultaDireta(app.db, T.ctx, outro.id, new Date('2026-09-12T12:00:00Z'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: now, motivoCancelamento: 'Viagem da Bia' });
    const inicio = new Date('2026-09-10T12:00:00Z');
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values([
      { tenantId: T.tenantId, patientId: p.id, appointmentId: cancelada, inicioConsulta: inicio, canal: 'whatsapp', tipo: 'lembrete_24h', status: 'enviada', agendadaPara: new Date('2026-09-09T12:00:00Z'), enviadaEm: new Date('2026-09-09T12:00:00Z'), providerJid: '5511912345678@s.whatsapp.net', providerMsgId: `msg-${randomUUID()}` },
      { tenantId: T.tenantId, patientId: p.id, canal: 'whatsapp', tipo: 'convite_paciente', status: 'pendente', agendadaPara: now, conteudoSelado: 'selado-de-teste' },
    ]), app.db);
    await app.db.insert(consents).values([
      { userId: uid, tenantId: T.tenantId, termoVersao: 'termo-v1', aceitoEm: new Date('2026-01-01T12:00:00Z'), ip: '198.51.100.7' }, // pela conta (convite)
      { tenantId: T.tenantId, patientId: p.id, termoVersao: 'termo-v1', aceitoEm: new Date('2026-02-01T12:00:00Z'), ip: '198.51.100.8' }, // página pública, mesma versão
      { tenantId: T.tenantId, patientId: p.id, termoVersao: 'termo-v2', aceitoEm: new Date('2026-03-01T12:00:00Z'), ip: '198.51.100.9' },
      { userId: uid, tenantId: B.tenantId, termoVersao: 'termo-v1', aceitoEm: new Date('2026-04-01T12:00:00Z'), ip: '198.51.100.10' }, // a mesma conta em outro consultório
      { tenantId: T.tenantId, patientId: outro.id, termoVersao: 'termo-v1', aceitoEm: new Date('2026-05-01T12:00:00Z'), ip: '198.51.100.11' },
    ]);

    await anonimizarSo(T);
    expect((await ler(T.ctx, p.id)).anonimizadoEm?.toISOString()).toBe(now.toISOString());
    const cs = await withTenant(T.ctx, (tx) => tx.select().from(appointments), app.db);
    const de = (id: string) => cs.find((c) => c.id === id)!;
    expect(de(cancelada)).toMatchObject({ motivoCancelamento: null, linkOnline: 'https://anonimizado.invalid', status: 'cancelada', modalidade: 'online' });
    expect(de(presencial)).toMatchObject({ linkOnline: null, status: 'realizada' });
    expect(de(daBia).motivoCancelamento).toBe('Viagem da Bia'); // só o titular
    const ns = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.patientId, p.id)), app.db);
    expect(ns.map((n) => [n.tipo, n.status, n.motivoIgnorada, n.providerJid, n.conteudoSelado]).sort()).toEqual([
      ['convite_paciente', 'ignorada', 'paciente_inativo', null, null],
      ['lembrete_24h', 'enviada', null, null, null],
    ]);
    const aceites = await app.db.select().from(consents).where(eq(consents.tenantId, T.tenantId));
    const resumo = aceites.map((c) => [c.patientId, c.userId, c.termoVersao, c.aceitoEm.toISOString(), c.ip]).sort((a, b) => `${a[0]}${a[2]}`.localeCompare(`${b[0]}${b[2]}`));
    expect(resumo).toEqual(
      [
        [p.id, null, 'termo-v1', '2026-01-01T12:00:00.000Z', null], // fica um por versão, com a data mais antiga
        [p.id, null, 'termo-v2', '2026-03-01T12:00:00.000Z', null],
        [outro.id, null, 'termo-v1', '2026-05-01T12:00:00.000Z', '198.51.100.11'],
      ].sort((a, b) => `${a[0]}${a[2]}`.localeCompare(`${b[0]}${b[2]}`)),
    );
    expect((await app.db.select().from(consents).where(eq(consents.tenantId, B.tenantId))).map((c) => [c.userId, c.ip])).toEqual([[uid, '198.51.100.10']]);
  });

  it('app_anonimizar_aceites: só no contexto worker e só para paciente bloqueado ainda não anonimizado (42501)', async () => {
    const T = await novoTenant(app.db);
    const ativo = await novoPaciente(app.db, T.ctx);
    const bloqueado = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2046-01-01' });
    const codigo = (e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;
    const chamar = (ctx: Parameters<typeof withTenant>[0], id: string) => withTenant(ctx, (tx) => tx.execute(sql`select app_anonimizar_aceites(${id})`), app.db);
    await expect(chamar(T.ctx, bloqueado.id)).rejects.toSatisfy((e) => codigo(e) === '42501'); // nutri
    await expect(chamar({ tenantId: T.tenantId, role: 'worker' }, ativo.id)).rejects.toSatisfy((e) => codigo(e) === '42501');
    await expect(chamar({ tenantId: randomUUID(), role: 'worker' }, bloqueado.id)).rejects.toSatisfy((e) => codigo(e) === '42501'); // outro tenant
    await expect(app.db.execute(sql`update consents set ip = null where false`)).rejects.toSatisfy((e) => codigo(e) === '42501'); // append-only para a aplicação
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

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]);
/** Registro do diário com a foto convertida (e, se `original`, também o original ainda não convertido). */
async function registroComFoto(T: TenantDeTeste, patientId: string, o: { original?: boolean } = {}) {
  const foto = await salvarArquivo(T.ctx, { tipo: 'diario_foto', conteudo: JPEG, permitidos: ['jpg'], patientId }, { db: app.db, dataDir });
  const original = o.original ? await salvarArquivo(T.ctx, { tipo: 'diario_foto_original', conteudo: JPEG, permitidos: ['jpg'], patientId }, { db: app.db, dataDir }) : null;
  const [e] = await withTenant(T.ctx, (tx) => tx.insert(diaryEntries).values({ tenantId: T.tenantId, patientId, refeicao: 'Almoço', fotoPath: foto.caminho, fotoOriginalPath: original?.caminho ?? null, fotoStatus: 'pronta' }).returning(), app.db);
  return { entrada: e, caminhos: [foto.caminho, ...(original ? [original.caminho] : [])] };
}

describe('Plano 06: diário, pedidos do titular e conta na LGPD', () => {
  it('apagarFotosDoDiario depois do atendimento: as fotos (e o original) saem do disco e da cota; o registro fica, com a foto "removida"; idempotente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { entrada, caminhos } = await registroComFoto(T, p.id, { original: true });
    expect((await withTenant(T.ctx, (tx) => anexosDoPaciente(tx, p.id), app.db)).sort()).toEqual([...caminhos].sort()); // a anonimização também as apaga
    await atenderPedidoExclusao(T.ctx, T.tenant, p.id, p.nome, { db: app.db });
    expect(await apagarFotosDoDiario(T.ctx, p.id, { db: app.db, dataDir })).toBe(2);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, entrada.id)), app.db);
    expect(e).toMatchObject({ fotoPath: null, fotoOriginalPath: null, fotoStatus: 'removida', refeicao: 'Almoço' });
    for (const c of caminhos) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
    expect(await apagarFotosDoDiario(T.ctx, p.id, { db: app.db, dataDir })).toBe(0);
  });

  it('F-13: o e-mail "pedido atendido" ("Foram apagados agora: as fotos do diário…") só sai depois que as fotos saíram do disco', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    const email = `f13-${randomUUID().slice(0, 8)}@ex.com`;
    const p = await novoPaciente(app.db, T.ctx, { email });
    const { entrada, caminhos } = await registroComFoto(T, p.id, { original: true });
    await atenderPedidoExclusao(T.ctx, T.tenant, p.id, p.nome, { db: app.db });
    expect(await emailsNaFila('exclusao_atendida', email)).toEqual([]); // nada na transação do atendimento: vai o job
    const dados = { tenantId: T.tenantId, patientId: p.id };
    expect(await jobsDaExclusao(p.id)).toEqual([dados]);

    // disco com erro: o e-mail não sai e o job tenta de novo — o erro que volta ao pg-boss não leva caminho nem ids (F-1)
    const naoPasta = path.join(dataDir, `arquivo-${randomUUID()}`);
    writeFileSync(naoPasta, 'x'); // o "dataDir" é um arquivo: o rm da foto falha com ENOTDIR
    const err = await concluirExclusaoAtendida(dados, { db: app.db, dataDir: naoPasta, ultimaTentativa: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    const serializado = JSON.stringify(err, Object.getOwnPropertyNames(err));
    for (const segredo of [naoPasta, T.tenantId, p.id]) expect(serializado).not.toContain(segredo);
    expect((err as Error).message).toContain('ENOTDIR');
    expect(await emailsNaFila('exclusao_atendida', email)).toEqual([]);
    for (const c of caminhos) expect(existsSync(resolverCaminho(dataDir, c))).toBe(true);

    // a tentativa seguinte apaga as fotos e só então avisa
    expect(await concluirExclusaoAtendida(dados, { db: app.db, dataDir, ultimaTentativa: false })).toBe('avisado');
    for (const c of caminhos) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, entrada.id)), app.db);
    expect(e).toMatchObject({ fotoPath: null, fotoOriginalPath: null, fotoStatus: 'removida' });
    expect(await emailsNaFila('exclusao_atendida', email)).toEqual([expect.objectContaining({ nome: 'Ana Souza', nutri: 'Debby Silva' })]);
  });

  it('F-13: na última tentativa com o disco ainda falhando, o aviso sai assim mesmo (o titular não fica sem resposta; a varredura diária apaga as fotos)', async () => {
    const T = await novoTenant(app.db);
    const email = `f13-${randomUUID().slice(0, 8)}@ex.com`;
    const p = await novoPaciente(app.db, T.ctx, { email });
    await registroComFoto(T, p.id);
    await atenderPedidoExclusao(T.ctx, T.tenant, p.id, p.nome, { db: app.db });
    const naoPasta = path.join(dataDir, `arquivo-${randomUUID()}`);
    writeFileSync(naoPasta, 'x');
    expect(await concluirExclusaoAtendida({ tenantId: T.tenantId, patientId: p.id }, { db: app.db, dataDir: naoPasta, ultimaTentativa: true })).toBe('avisado');
    expect(await emailsNaFila('exclusao_atendida', email)).toHaveLength(1);
  });

  it('F-13: o job só age sobre quem está bloqueado e não anonimizado (o ativo não perde fotos nem recebe o aviso)', async () => {
    const T = await novoTenant(app.db);
    for (const extra of [{}, { status: 'arquivado' as const }, { status: 'bloqueado' as const, anonimizarApos: '2046-09-30', anonimizadoEm: new Date() }]) {
      const email = `f13-${randomUUID().slice(0, 8)}@ex.com`;
      const p = await novoPaciente(app.db, T.ctx, { email, ...extra });
      const { caminhos } = await registroComFoto(T, p.id);
      expect(await concluirExclusaoAtendida({ tenantId: T.tenantId, patientId: p.id }, { db: app.db, dataDir, ultimaTentativa: false })).toBe('ignorado');
      expect(await emailsNaFila('exclusao_atendida', email)).toEqual([]);
      expect(existsSync(resolverCaminho(dataDir, caminhos[0]))).toBe(true);
    }
  });

  it('rede de segurança da varredura diária: bloqueado (guarda ainda não vencida) perde as fotos e NÃO é anonimizado; o ativo fica com as dele', async () => {
    const T = await novoTenant(app.db);
    const bloqueado = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2046-09-30' });
    const ativo = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const doBloqueado = await registroComFoto(T, bloqueado.id);
    const doAtivo = await registroComFoto(T, ativo.id);
    await anonimizarSo(T);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, doBloqueado.entrada.id)), app.db);
    expect(e).toMatchObject({ fotoPath: null, fotoStatus: 'removida' });
    expect(existsSync(resolverCaminho(dataDir, doBloqueado.caminhos[0]))).toBe(false);
    expect(await ler(T.ctx, bloqueado.id)).toMatchObject({ nome: 'Ana Souza', anonimizadoEm: null });
    const [f] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, doAtivo.entrada.id)), app.db);
    expect(f).toMatchObject({ fotoPath: doAtivo.caminhos[0], fotoStatus: 'pronta' });
    expect(existsSync(resolverCaminho(dataDir, doAtivo.caminhos[0]))).toBe(true);
  });

  it('RNF-11: erro de disco na anonimização vai para o log só com o código (a mensagem de um ENOTDIR/EACCES leva o caminho da foto)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2026-09-01' });
    await registroComFoto(T, p.id);
    const naoPasta = path.join(dataDir, `arquivo-${randomUUID()}`);
    writeFileSync(naoPasta, 'x'); // o "dataDir" é um arquivo: o rm da foto falha com ENOTDIR
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    try {
      vi.mocked(listarTenantsParaVarredura).mockResolvedValueOnce([{ id: T.tenantId, fuso: T.tenant.fuso }]);
      expect(await anonimizarVencidos(app.db, now, { dataDir: naoPasta })).toEqual({ anonimizados: 0 });
      expect(erro).toHaveBeenCalledWith({ motivo: 'ENOTDIR', tenantId: T.tenantId }, 'falha ao anonimizar paciente');
      expect(JSON.stringify(erro.mock.calls)).not.toContain(naoPasta);
    } finally {
      erro.mockRestore();
    }
    expect((await ler(T.ctx, p.id)).anonimizadoEm).toBeNull(); // o dia seguinte tenta de novo
  });

  it('Plano 10A (RN-140 c): anonimizarVencidos trata os documentos antes dos anexos, e a verificação pública fica "eliminado"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(500)]);
    await criarExame(T.ctx, T.tenant, p.id, { titulo: 'Hemograma', data: '2026-09-01', valores: [], arquivo: PDF }, deps);
    const [exame] = await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.patientId, p.id)), app.db);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizarApos: '2026-09-01' }).where(eq(patients.id, p.id)), app.db);
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', conteudo: { versao: 1, tipo: 'receita', itens: [], orientacoes: 'Tomar com água.' } });
    mkdirSync(path.dirname(resolverCaminho(dataDir, d.pdfPath!)), { recursive: true });
    writeFileSync(resolverCaminho(dataDir, d.pdfPath!), pdfDeTeste());
    const rascunho = await documentoNoBanco(app.db, T.ctx, p.id);
    await withTenant(T.ctx, (tx) => registrarVerificacao(tx, { codigo: d.codigo!, tenantId: T.tenantId, documentoId: d.id, tipo: 'receita', assinadoEm: now, emissorNome: 'Debby Silva', emissorCrn: 'CRN-3 12345', assinanteNome: null, assinaturaTipo: 'digitalizada', pdfSha256: 'a'.repeat(64) }), app.db);
    vi.mocked(apagarArquivo).mockClear();

    await anonimizarSo(T);
    expect((await ler(T.ctx, p.id)).anonimizadoEm?.toISOString()).toBe(now.toISOString());
    const caminhos = vi.mocked(apagarArquivo).mock.calls.map(([, f]) => ('caminho' in f ? f.caminho : f.id));
    expect(caminhos.indexOf(d.pdfPath!), 'o PDF do documento sai').toBeGreaterThanOrEqual(0);
    expect(caminhos.indexOf(d.pdfPath!), 'documentos antes dos anexos').toBeLessThan(caminhos.indexOf(exame.arquivoPath!));
    const docs = await withTenant(T.ctx, (tx) => tx.execute(sql`select id, status, conteudo, pdf_path, anonimizado_em is not null as anonimizado from signed_documents where patient_id = ${p.id}`), app.db);
    expect(docs.rows).toEqual([{ id: d.id, status: 'assinado', conteudo: {}, pdf_path: null, anonimizado: true }]); // o rascunho foi apagado
    expect(docs.rows.map((r) => r.id)).not.toContain(rascunho.id);
    expect(existsSync(resolverCaminho(dataDir, d.pdfPath!))).toBe(false);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
    const v = await consultarVerificacao(d.codigo, { db: app.db, ipDoLimite: `203.0.113.${Math.floor(Math.random() * 250)}` });
    expect(v).toMatchObject({ tipo: 'ok', v: { situacao: 'eliminado' } });
  });

  it('Plano 10A: PDF de documento que sobrou depois da etapa dos documentos desfaz a anonimização; no dia seguinte, ela sai', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2026-09-01' });
    const d = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    // como um documento gravado entre a etapa dos documentos e a transação final
    vi.mocked(anonimizarDocumentosDoPaciente).mockResolvedValueOnce(0);
    try {
      expect(await anonimizarSo(T)).toEqual({ anonimizados: 0 });
      expect((await ler(T.ctx, p.id)).anonimizadoEm).toBeNull();
      expect(JSON.stringify(erro.mock.calls)).not.toContain(d.pdfPath!); // RNF-11: só o código do erro
    } finally {
      erro.mockRestore();
    }
    expect(await anonimizarSo(T)).toEqual({ anonimizados: 1 });
    const [doc] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select pdf_path, anonimizado_em is not null as anonimizado from signed_documents where id = ${d.id}`), app.db)).rows;
    expect(doc).toEqual({ pdf_path: null, anonimizado: true });
  });

  it('anonimização de quem tem foto no diário: a foto sai antes, o registro fica com a foto "removida"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado', anonimizarApos: '2026-09-01' });
    const { entrada, caminhos } = await registroComFoto(T, p.id);
    await anonimizarSo(T);
    expect((await ler(T.ctx, p.id)).anonimizadoEm?.toISOString()).toBe(now.toISOString());
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(diaryEntries).where(eq(diaryEntries.id, entrada.id)), app.db);
    expect(e).toMatchObject({ fotoPath: null, fotoStatus: 'removida' });
    expect(existsSync(resolverCaminho(dataDir, caminhos[0]))).toBe(false);
  });

  it('pedidos do titular abertos para o quadro do painel, com nome e prazo (só os abertos, prazo mais curto primeiro)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Carla Dias' });
    const q = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await withTenant(T.ctx, (tx) => tx.insert(privacyRequests).values([
      { tenantId: T.tenantId, patientId: p.id, tipo: 'exclusao', status: 'aberto', prazo: '2026-10-20' },
      { tenantId: T.tenantId, patientId: q.id, tipo: 'exclusao', status: 'aberto', prazo: '2026-10-18' },
      { tenantId: T.tenantId, patientId: q.id, tipo: 'exclusao', status: 'concluido', prazo: '2026-09-18' },
    ]), app.db);
    expect(await pedidosDoTitularAbertos(T.ctx, app.db)).toEqual([
      { patientId: q.id, nome: 'Bia Lima', tipo: 'exclusao', prazo: '2026-10-18' },
      { patientId: p.id, nome: 'Carla Dias', tipo: 'exclusao', prazo: '2026-10-20' },
    ]);
    expect(await pedidosDoTitularAbertos((await novoTenant(app.db)).ctx, app.db)).toEqual([]); // de outro consultório: nada
    // US-046 / D17: um aberto por paciente e tipo (índice único parcial)
    await expect(withTenant(T.ctx, (tx) => tx.insert(privacyRequests).values({ tenantId: T.tenantId, patientId: p.id, tipo: 'exclusao', status: 'aberto', prazo: '2026-10-21' }), app.db)).rejects.toThrow();
  });

  it('P06-08 (D18): anonimizar sem outro vínculo anonimiza a conta (nome, e-mail, sessões, senha); com outro vínculo, a conta fica', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const sozinha = await pacienteComConta(app.db, A);
    const dupla = await pacienteComConta(app.db, A);
    await pacienteComConta(app.db, B, { userId: dupla.userId, status: 'arquivado' }); // arquivado ainda é vínculo (não anonimizado)
    await app.db.insert(session).values({ id: randomUUID(), token: randomUUID(), userId: sozinha.userId, expiresAt: new Date('2027-01-01T00:00:00Z'), updatedAt: now });
    for (const x of [sozinha, dupla]) {
      await withTenant(A.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizarApos: '2000-01-01' }).where(eq(patients.id, x.paciente.id)), app.db);
    }
    await anonimizarSo(A);
    const [u1] = await app.db.select().from(user).where(eq(user.id, sozinha.userId));
    expect(u1).toMatchObject({ name: 'Paciente anonimizado', email: `anonimo-${sozinha.userId}@anonimizado.invalid` });
    expect(await app.db.select().from(account).where(eq(account.userId, sozinha.userId))).toEqual([]);
    expect(await app.db.select().from(session).where(eq(session.userId, sozinha.userId))).toEqual([]);
    const [u2] = await app.db.select().from(user).where(eq(user.id, dupla.userId));
    expect(u2.email).toBe(dupla.email);
    expect(await app.db.select().from(account).where(eq(account.userId, dupla.userId))).toHaveLength(1);
    expect((await ler(A.ctx, dupla.paciente.id)).anonimizadoEm).not.toBeNull(); // o prontuário de A foi anonimizado do mesmo jeito
  });

  it('B-1: prontuário ligado (por bug) a uma conta da equipe é anonimizado, mas a conta fica intacta, com um aviso no log sem dado dela', async () => {
    const T = await novoTenant(app.db);
    const nutriId = randomUUID();
    const emailNutri = `nutri-${nutriId.slice(0, 8)}@teste.dev`;
    await app.db.insert(user).values({ id: nutriId, name: 'Debby Silva', email: emailNutri, emailVerified: true, appRole: 'nutri', tenantId: T.tenantId });
    await app.db.insert(account).values({ id: randomUUID(), userId: nutriId, accountId: nutriId, providerId: 'credential', password: 'hash' });
    const x = await pacienteComConta(app.db, T, { userId: nutriId, status: 'bloqueado', anonimizarApos: '2000-01-01' });
    const aviso = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      expect(await anonimizarSo(T)).toEqual({ anonimizados: 1 });
      expect(aviso).toHaveBeenCalledWith({ tenantId: T.tenantId }, 'conta do titular anonimizado não é de paciente: conta de login não anonimizada');
      expect(JSON.stringify(aviso.mock.calls)).not.toContain(nutriId);
    } finally {
      aviso.mockRestore();
    }
    expect((await ler(T.ctx, x.paciente.id)).anonimizadoEm).not.toBeNull();
    const [u] = await app.db.select().from(user).where(eq(user.id, nutriId));
    expect(u).toMatchObject({ name: 'Debby Silva', email: emailNutri });
    expect(await app.db.select().from(account).where(eq(account.userId, nutriId))).toHaveLength(1);
  });
});
