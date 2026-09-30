import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, patients, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { metricasPorTenant } from '@/modules/plataforma/metricas';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from './base';
import { atualizarPaciente, buscarPaciente, criarPaciente, listarPacientes, MSG_PACIENTE, PacienteError } from './pacientes';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now, appUrl: 'http://localhost:3000' };
afterAll(async () => {
  await stopBoss(); // a Tarefa 3 faz criarPaciente enfileirar o convite
  await closeDb();
  await app.pool.end();
});

const s = () => randomUUID().slice(0, 8);
const ana = (extra: Record<string, unknown> = {}) => ({
  nome: '  Ana Souza ',
  dataNascimento: '1991-03-10',
  sexo: 'F',
  email: `Ana-${s()}@Ex.com`,
  telefone: '(11) 91234-5678',
  whatsappAutorizado: false,
  ...extra,
});
const erroDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PacienteError) return e.erros;
    throw e;
  }
  throw new Error('esperava PacienteError');
};
const logDe = (ctx: Parameters<typeof withTenant>[0], id: string) =>
  withTenant(ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, id)).orderBy(auditLog.criadoEm), app.db);

describe('criarPaciente (US-010, RN-17)', () => {
  it('cria ativo, sem usuário, com e-mail em minúsculas, telefone em E.164 e auditoria "criar" com a nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ whatsappAutorizado: true }), deps);
    expect(p).toMatchObject({ status: 'ativo', userId: null, nome: 'Ana Souza', sexo: 'F', telefoneE164: '+5511912345678', origem: 'nutri', whatsappOptinOrigem: 'nutri' });
    expect(p.email).toMatch(/^ana-.+@ex\.com$/);
    expect(p.whatsappOptinEm?.toISOString()).toBe(now.toISOString());
    const log = await logDe(T.ctx, p.id);
    expect(log[0]).toMatchObject({ acao: 'criar', entidade: 'patients', patientId: p.id, actorUserId: T.nutriId, ip: '203.0.113.20' });
  });

  it('mensagens exatas da spec para nome, idade, sexo e telefone; WhatsApp autorizado exige telefone', async () => {
    const T = await novoTenant(app.db);
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ nome: 'A' }), deps))).toEqual({ nome: MSG_PACIENTE.nome });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ dataNascimento: '2010-01-01' }), deps))).toEqual({
      dataNascimento: 'O sistema atende apenas pacientes a partir de 18 anos',
    });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ dataNascimento: '2026-02-30' }), deps))).toEqual({ dataNascimento: MSG_PACIENTE.nascimentoInvalido });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ dataNascimento: '1900-01-01' }), deps))).toEqual({ dataNascimento: MSG_PACIENTE.nascimentoInvalido });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ sexo: '' }), deps))).toEqual({ sexo: 'Selecione o sexo biológico (usado nas fórmulas)' });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ telefone: '1234' }), deps))).toEqual({ telefone: 'Telefone inválido' });
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ telefone: '', whatsappAutorizado: true }), deps))).toEqual({
      whatsappAutorizado: MSG_PACIENTE.whatsappSemTelefone,
    });
  });

  it('18 anos no fuso do tenant: 23h30 em São Paulo do dia anterior ao aniversário ainda recusa (Review Focus 1)', async () => {
    const T = await novoTenant(app.db);
    const nasc = { dataNascimento: '2008-03-10' };
    const vespera = { ...deps, now: new Date('2026-03-10T02:30:00Z') }; // 09/03 23h30 em São Paulo
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana(nasc), vespera))).toEqual({ dataNascimento: MSG_PACIENTE.menorDeIdade });
    const dia = { ...deps, now: new Date('2026-03-10T03:30:00Z') }; // 10/03 00h30 em São Paulo
    await expect(criarPaciente(T.ctx, T.tenant, ana(nasc), dia)).resolves.toMatchObject({ dataNascimento: '2008-03-10' });
  });

  it('e-mail repetido no tenant, sem diferenciar maiúsculas e mesmo em envios simultâneos: um só paciente (Review Focus 5)', async () => {
    const T = await novoTenant(app.db);
    const email = `dup-${s()}@ex.com`;
    const r = await Promise.allSettled([email.toUpperCase(), email, ` ${email} `].map((e) => criarPaciente(T.ctx, T.tenant, ana({ email: e }), deps)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const f of r.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(f.reason).toBeInstanceOf(PacienteError);
      expect((f.reason as PacienteError).erros).toEqual({ email: 'Paciente já cadastrado com este e-mail' });
    }
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.email, email)), app.db);
    expect(linhas).toHaveLength(1);
  });

  it('o mesmo e-mail em outra nutricionista é aceito (cada tenant tem o seu prontuário)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const email = `dois-${s()}@ex.com`;
    await criarPaciente(A.ctx, A.tenant, ana({ email }), deps);
    await expect(criarPaciente(B.ctx, B.tenant, ana({ email }), deps)).resolves.toMatchObject({ tenantId: B.tenantId });
  });
});

describe('atualizarPaciente', () => {
  it('altera o cadastro; desmarcar a autorização apaga o opt-in da nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ whatsappAutorizado: true }), deps);
    const q = await atualizarPaciente(T.ctx, T.tenant, p.id, ana({ nome: 'Ana S. Lima', email: p.email, whatsappAutorizado: false }), deps);
    expect(q).toMatchObject({ nome: 'Ana S. Lima', whatsappOptinEm: null, whatsappOptinOrigem: null });
  });

  it('desmarcar a autorização não apaga o consentimento que o próprio paciente deu (origem paciente) (US-011)', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ whatsappAutorizado: true }), deps);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ whatsappOptinOrigem: 'paciente' }).where(eq(patients.id, p.id)), app.db);
    const q = await atualizarPaciente(T.ctx, T.tenant, p.id, ana({ email: p.email, whatsappAutorizado: false }), deps);
    expect(q).toMatchObject({ whatsappOptinOrigem: 'paciente', whatsappOptoutEm: null });
    expect(q.whatsappOptinEm?.toISOString()).toBe(now.toISOString());
  });

  it('marcar a autorização não desfaz o opt-out do paciente (US-010, US-011)', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ whatsappAutorizado: true }), deps);
    const optout = new Date('2026-10-02T10:00:00Z');
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ whatsappOptoutEm: optout }).where(eq(patients.id, p.id)), app.db);
    const q = await atualizarPaciente(T.ctx, T.tenant, p.id, ana({ email: p.email, whatsappAutorizado: true }), deps);
    expect(q.whatsappOptoutEm?.toISOString()).toBe(optout.toISOString());
    expect(q.whatsappOptinEm?.toISOString()).toBe(now.toISOString());
    // sem opt-in anterior mas com opt-out registrado: também não recria o opt-in
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ whatsappOptinEm: null, whatsappOptinOrigem: null }).where(eq(patients.id, p.id)), app.db);
    const r = await atualizarPaciente(T.ctx, T.tenant, p.id, ana({ email: p.email, whatsappAutorizado: true }), deps);
    expect(r).toMatchObject({ whatsappOptinEm: null, whatsappOptinOrigem: null });
    expect(r.whatsappOptoutEm?.toISOString()).toBe(optout.toISOString());
  });

  it('com acesso ativo o e-mail não muda; bloqueado é só leitura; id de outro tenant ou malformado = não encontrado', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    // Conta de paciente já vinculada (o aceite do convite é da Tarefa 4)
    const uid = randomUUID();
    await app.db.insert(user).values({ id: uid, name: 'Ana Souza', email: `conta-${uid.slice(0, 8)}@ex.com`, appRole: 'paciente' });
    const comConta = await novoPaciente(app.db, A.ctx, { userId: uid });
    expect(await erroDe(atualizarPaciente(A.ctx, A.tenant, comConta.id, ana({ email: `outro-${s()}@ex.com` }), deps))).toEqual({
      email: 'O paciente já ativou o acesso; o e-mail não pode ser alterado.',
    });
    const bloqueado = await novoPaciente(app.db, A.ctx, { status: 'bloqueado' });
    await expect(atualizarPaciente(A.ctx, A.tenant, bloqueado.id, ana({ email: bloqueado.email }), deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    const deB = await novoPaciente(app.db, B.ctx);
    await expect(atualizarPaciente(A.ctx, A.tenant, deB.id, ana({ email: deB.email }), deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    await expect(atualizarPaciente(A.ctx, A.tenant, 'abc', ana(), deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const [intacto] = await withTenant(B.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, deB.id)), app.db);
    expect(intacto.nome).toBe('Ana Souza');
  });
});

describe('buscarPaciente e listarPacientes', () => {
  it('abrir o prontuário grava a leitura (US-007); outro tenant ou id malformado devolve null sem auditar', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const p = await novoPaciente(app.db, A.ctx);
    expect(await buscarPaciente(A.ctx, p.id, app.db)).toMatchObject({ id: p.id });
    const log = await logDe(A.ctx, p.id);
    expect(log.at(-1)).toMatchObject({ acao: 'ler', entidade: 'patients', patientId: p.id, actorUserId: A.nutriId });
    expect(await buscarPaciente(B.ctx, p.id, app.db)).toBeNull();
    expect(await buscarPaciente(A.ctx, 'nao-e-uuid', app.db)).toBeNull();
    expect(await withTenant(B.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, p.id)), app.db)).toEqual([]);
  });

  it('busca sem acento por nome e por e-mail; "%" é literal; por padrão só ativos', async () => {
    const T = await novoTenant(app.db);
    await novoPaciente(app.db, T.ctx, { nome: 'José Araújo', email: `jose-${s()}@ex.com` });
    await novoPaciente(app.db, T.ctx, { nome: 'Maria Lima', email: `maria-${s()}@ex.com` });
    await novoPaciente(app.db, T.ctx, { nome: 'João Arquivado', status: 'arquivado' });
    expect((await listarPacientes(T.ctx, { busca: 'jose araujo' }, app.db)).map((x) => x.nome)).toEqual(['José Araújo']);
    expect((await listarPacientes(T.ctx, { busca: 'MARIA-' }, app.db)).map((x) => x.nome)).toEqual(['Maria Lima']);
    expect(await listarPacientes(T.ctx, { busca: '%' }, app.db)).toEqual([]);
    expect((await listarPacientes(T.ctx, {}, app.db)).map((x) => x.nome)).toEqual(['José Araújo', 'Maria Lima']);
    expect((await listarPacientes(T.ctx, { status: 'arquivado' }, app.db)).map((x) => x.nome)).toEqual(['João Arquivado']);
  });

  it('sessão de paciente só enxerga a própria linha de patients (RLS por paciente)', async () => {
    const T = await novoTenant(app.db);
    const p1 = await novoPaciente(app.db, T.ctx);
    await novoPaciente(app.db, T.ctx);
    const vistos = await withTenant(ctxPaciente(T.tenantId, p1.id), (tx) => tx.select({ id: patients.id }).from(patients), app.db);
    expect(vistos).toEqual([{ id: p1.id }]);
  });

  it('o admin vê só a contagem de pacientes ativos (§3)', async () => {
    const T = await novoTenant(app.db);
    await novoPaciente(app.db, T.ctx);
    await novoPaciente(app.db, T.ctx);
    await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    expect((await metricasPorTenant(app.db)).get(T.tenantId)?.pacientesAtivos).toBe(2);
  });
});

it('a linha criada por paciente de outro tenant nunca aparece na busca do tenant A', async () => {
  const A = await novoTenant(app.db);
  const B = await novoTenant(app.db);
  await novoPaciente(app.db, B.ctx, { nome: 'Somente B' });
  expect(await listarPacientes(A.ctx, { busca: 'Somente' }, app.db)).toEqual([]);
  const [linha] = await withTenant(B.ctx, (tx) => tx.select().from(patients).where(and(eq(patients.tenantId, B.tenantId), eq(patients.nome, 'Somente B'))), app.db);
  expect(linha).toBeDefined();
});
