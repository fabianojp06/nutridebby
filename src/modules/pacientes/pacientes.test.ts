import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, patientCadastro, patients, patientTagLinks, patientTags, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { metricasPorTenant } from '@/modules/plataforma/metricas';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from './base';
import { CAMPOS_DO_CADASTRO } from './cadastro';
import { atualizarPaciente, buscarPaciente, criarPaciente, filtroDaUrl, listarPacientes, MSG_PACIENTE, PacienteError } from './pacientes';

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

describe('cadastro complementar junto do paciente (Plano 18, RN-260)', () => {
  const cadastroDe = (ctx: Parameters<typeof withTenant>[0], patientId: string) =>
    withTenant(ctx, (tx) => tx.select().from(patientCadastro).where(eq(patientCadastro.patientId, patientId)), app.db);

  it('quem não manda os campos novos (chamadores de antes) não mexe no cadastro', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ cpf: '529.982.247-25', ocupacao: 'Professora' }), deps);
    await atualizarPaciente(T.ctx, T.tenant, p.id, ana({ nome: 'Ana S. Lima', email: p.email }), deps);
    expect(await cadastroDe(T.ctx, p.id)).toEqual([expect.objectContaining({ cpf: '52998224725', ocupacao: 'Professora' })]);
  });

  it('esvaziar todos os campos grava a linha com tudo nulo (não apaga)', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, ana({ cpf: '529.982.247-25', ocupacao: 'Professora', uf: 'SP' }), deps);
    const vazio = Object.fromEntries(CAMPOS_DO_CADASTRO.map((c) => [c, '']));
    await atualizarPaciente(T.ctx, T.tenant, p.id, ana({ ...vazio, email: p.email }), deps);
    const [c] = await cadastroDe(T.ctx, p.id);
    for (const campo of ['cpf', 'ocupacao', 'uf', 'nomeSocial', 'observacao', 'telefoneFixoE164'] as const) expect(c[campo], campo).toBeNull();
    // e o primeiro preenchimento de um paciente antigo cria a linha
    const antigo = await novoPaciente(app.db, T.ctx);
    await atualizarPaciente(T.ctx, T.tenant, antigo.id, ana({ ...vazio, email: antigo.email, estadoCivil: 'viuvo' }), deps);
    expect(await cadastroDe(T.ctx, antigo.id)).toEqual([expect.objectContaining({ estadoCivil: 'viuvo', cpf: null })]);
  });

  it('erros do cadastro saem junto com os do paciente, um por campo', async () => {
    const T = await novoTenant(app.db);
    expect(await erroDe(criarPaciente(T.ctx, T.tenant, ana({ nome: 'A', cpf: '111.111.111-11', telefoneFixo: '12', estadoCivil: 'noivo' }), deps))).toEqual({
      nome: MSG_PACIENTE.nome,
      cpf: 'CPF inválido. Confira os números.',
      telefoneFixo: 'Telefone fixo inválido',
      estadoCivil: 'Escolha uma opção da lista',
    });
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
    expect((await listarPacientes(T.ctx, { aba: 'inativos' }, app.db)).map((x) => x.nome)).toEqual(['João Arquivado']);
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

describe('listarPacientes (Plano 18, US-261, RN-270 a RN-272)', () => {
  const nomes = (r: { nome: string; nomeSocial: string | null }[]) => r.map((x) => x.nomeSocial ?? x.nome);
  const comNomeSocial = async (T: Awaited<ReturnType<typeof novoTenant>>, patientId: string, nomeSocial: string) =>
    withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId, nomeSocial, cpf: null }), app.db);

  it('abas: Ativos (padrão), Inativos, Todos (sem bloqueado) e Bloqueados', async () => {
    const T = await novoTenant(app.db);
    await novoPaciente(app.db, T.ctx, { nome: 'Ana Ativa' });
    await novoPaciente(app.db, T.ctx, { nome: 'Bia Arquivada', status: 'arquivado' });
    await novoPaciente(app.db, T.ctx, { nome: 'Cris Bloqueada', status: 'bloqueado', bloqueadoEm: new Date() });
    expect(nomes(await listarPacientes(T.ctx, {}, app.db))).toEqual(['Ana Ativa']);
    expect(nomes(await listarPacientes(T.ctx, { aba: 'ativos' }, app.db))).toEqual(['Ana Ativa']);
    expect(nomes(await listarPacientes(T.ctx, { aba: 'inativos' }, app.db))).toEqual(['Bia Arquivada']);
    expect(nomes(await listarPacientes(T.ctx, { aba: 'todos' }, app.db))).toEqual(['Ana Ativa', 'Bia Arquivada']);
    expect(nomes(await listarPacientes(T.ctx, { aba: 'bloqueados' }, app.db))).toEqual(['Cris Bloqueada']);
  });

  it('ordens: nome (A–Z, sem acento nem maiúscula), nome_desc, recentes e antigos; empate pelo id', async () => {
    const T = await novoTenant(app.db);
    const b = await novoPaciente(app.db, T.ctx, { nome: 'bruno', createdAt: new Date('2026-01-02T12:00:00Z') });
    const a = await novoPaciente(app.db, T.ctx, { nome: 'Álvaro', createdAt: new Date('2026-01-03T12:00:00Z') });
    const c = await novoPaciente(app.db, T.ctx, { nome: 'Carla', createdAt: new Date('2026-01-01T12:00:00Z') });
    expect(nomes(await listarPacientes(T.ctx, { ordem: 'nome' }, app.db))).toEqual(['Álvaro', 'bruno', 'Carla']);
    expect(nomes(await listarPacientes(T.ctx, { ordem: 'nome_desc' }, app.db))).toEqual(['Carla', 'bruno', 'Álvaro']);
    expect((await listarPacientes(T.ctx, { ordem: 'recentes' }, app.db)).map((x) => x.id)).toEqual([a.id, b.id, c.id]);
    expect((await listarPacientes(T.ctx, { ordem: 'antigos' }, app.db)).map((x) => x.id)).toEqual([c.id, b.id, a.id]);
    // empate: mesmo nome exibido e mesma data → pelo id, nas duas direções do nome
    const T2 = await novoTenant(app.db);
    const quando = new Date('2026-02-01T12:00:00Z');
    const iguais = await Promise.all([1, 2, 3].map(() => novoPaciente(app.db, T2.ctx, { nome: 'Dora Lima', createdAt: quando })));
    const ids = iguais.map((p) => p.id).sort();
    for (const ordem of ['nome', 'nome_desc', 'recentes', 'antigos'] as const) {
      expect((await listarPacientes(T2.ctx, { ordem }, app.db)).map((x) => x.id), ordem).toEqual(ids);
    }
  });

  it('nome social: a busca acha pelos dois nomes; a ordem é pelo nome exibido; "registro" ordena pelo nome de registro', async () => {
    const T = await novoTenant(app.db);
    const joao = await novoPaciente(app.db, T.ctx, { nome: 'João Silva' });
    await comNomeSocial(T, joao.id, 'Zélia Silva');
    await novoPaciente(app.db, T.ctx, { nome: 'Marta Reis' });
    expect((await listarPacientes(T.ctx, { busca: 'zelia' }, app.db)).map((x) => x.id)).toEqual([joao.id]);
    expect((await listarPacientes(T.ctx, { busca: 'Joao' }, app.db)).map((x) => x.id)).toEqual([joao.id]);
    const [item] = await listarPacientes(T.ctx, { busca: 'Silva' }, app.db);
    expect(item).toMatchObject({ nome: 'João Silva', nomeSocial: 'Zélia Silva' });
    // exibido: "Zélia Silva" depois de "Marta Reis"; de registro: "João Silva" antes
    expect(nomes(await listarPacientes(T.ctx, {}, app.db))).toEqual(['Marta Reis', 'Zélia Silva']);
    expect((await listarPacientes(T.ctx, { ordem: 'registro' }, app.db)).map((x) => x.nome)).toEqual(['João Silva', 'Marta Reis']);
    expect((await listarPacientes(T.ctx, { aba: 'ativos', ordem: 'registro' }, app.db)).map((x) => x.nome)).toEqual(['João Silva', 'Marta Reis']);
  });

  it('chaves exatas do item (RN-272): nada do cadastro além do nome social', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await withTenant(
      T.ctx,
      (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: p.id, cpf: '52998224725', nomeSocial: 'Ana S.', ocupacao: 'Professora', observacao: 'nota' }),
      app.db,
    );
    const [item] = await listarPacientes(T.ctx, {}, app.db);
    expect(Object.keys(item).sort()).toEqual(['createdAt', 'dataNascimento', 'email', 'id', 'nome', 'nomeSocial', 'origem', 'status', 'userId']);
    expect(JSON.stringify(item)).not.toMatch(/52998224725|Professora|nota/);
  });

  it('filtro de etiqueta grava uma leitura de "Etiquetas" por paciente devolvido; sem etiqueta, nenhuma', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const [tag] = await withTenant(T.ctx, (tx) => tx.insert(patientTags).values({ tenantId: T.tenantId, nome: `gestante-${s()}` }).returning(), app.db);
    await withTenant(T.ctx, (tx) => tx.insert(patientTagLinks).values({ tenantId: T.tenantId, patientId: p.id, tagId: tag.id }), app.db);
    const leituras = () =>
      withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.entidade, 'etiquetas'), eq(auditLog.acao, 'ler'))), app.db);
    for (const aba of ['ativos', 'todos'] as const) expect(await listarPacientes(T.ctx, { aba, ordem: 'recentes' }, app.db)).toHaveLength(1);
    expect(await leituras()).toEqual([]);
    // controle positivo: com a etiqueta, a leitura aparece (na mesma visão do nutri_app, dentro do withTenant)
    expect(await listarPacientes(T.ctx, { aba: 'todos', etiquetaId: tag.id }, app.db)).toHaveLength(1);
    expect(await leituras()).toEqual([expect.objectContaining({ actorUserId: T.nutriId, entidadeId: null })]);
  });
});

describe('filtroDaUrl (RN-270, RN-271)', () => {
  it('sem aba nem ordem: ativos por nome; aba, busca, etiqueta e ordem conhecidas passam', () => {
    expect(filtroDaUrl({})).toEqual({ aba: 'ativos', ordem: 'nome' });
    expect(filtroDaUrl({ aba: 'todos', busca: ' ana ', etiqueta: 'e1', ordem: 'recentes' })).toEqual({ aba: 'todos', busca: ' ana ', etiquetaId: 'e1', ordem: 'recentes' });
    expect(filtroDaUrl({ aba: 'inativos', ordem: 'antigos' })).toEqual({ aba: 'inativos', ordem: 'antigos' });
    expect(filtroDaUrl({ ordem: 'nome_desc', busca: '', etiqueta: '' })).toEqual({ aba: 'ativos', ordem: 'nome_desc' });
  });
  it('link antigo: status=arquivado → inativos, status=bloqueado → bloqueados; situacao=bloqueados → bloqueados', () => {
    expect(filtroDaUrl({ status: 'arquivado' }).aba).toBe('inativos');
    expect(filtroDaUrl({ status: 'bloqueado' }).aba).toBe('bloqueados');
    expect(filtroDaUrl({ situacao: 'bloqueados', aba: 'todos' }).aba).toBe('bloqueados');
    expect(filtroDaUrl({ status: 'ativo' }).aba).toBe('ativos');
  });
  it('valor desconhecido cai no padrão; ordem=registro na URL também (é só da agenda); listas repetidas ficam de fora', () => {
    expect(filtroDaUrl({ aba: 'lixeira', status: 'xyz', ordem: 'idade' })).toEqual({ aba: 'ativos', ordem: 'nome' });
    expect(filtroDaUrl({ aba: 'bloqueados' }).aba).toBe('ativos');
    expect(filtroDaUrl({ ordem: 'registro' }).ordem).toBe('nome');
    expect(filtroDaUrl({ aba: ['todos', 'inativos'], busca: ['a', 'b'] })).toEqual({ aba: 'ativos', ordem: 'nome' });
  });
});
