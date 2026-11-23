import { inspect } from 'node:util';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, localPrincipal, novoLocal, perdeCorridaNoBanco, perdeDeadlockNoBanco, semanaToda, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';
import { MSG_AGENDA } from './constantes';
import { agendarPelaNutri, buscarConsulta, ConsultaError, ehSobreposicao, horariosLivres, linkValido, listarAgenda, moverConsulta } from './consultas';
import { criarBloqueio, criarRegra } from './disponibilidade';
import { partesNoFuso } from './fuso';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // marcar e alterar enfileiram o envio (Tarefa 5)
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const deps = { db: app.db, now: new Date('2026-10-01T12:00:00Z') };
const SP = 'America/Sao_Paulo';

const pools = { app: app.pool, owner: owner.pool };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConsultaError) return e.erros;
    throw e;
  }
  throw new Error('esperava ConsultaError');
};

describe('agendar pela nutricionista (US-031)', () => {
  it('Ana em 15/10/2026 às 09:00, 60 min, online com link → "agendada", origem "nutri"', async () => {
    const T = await novoTenant(app.db);
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: null });
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60', localId: video, linkOnline: 'https://meet.google.com/abc-defg-hij' }, deps);
    const c = await buscarConsulta(T.ctx, id, app.db);
    expect(c).toMatchObject({ paciente: 'Ana Souza', status: 'agendada', origem: 'nutri', modalidade: 'online', linkOnline: 'https://meet.google.com/abc-defg-hij', inicio: em('2026-10-15', '09:00'), fim: em('2026-10-15', '10:00') });
    expect(c).toMatchObject({ localId: video, local: { nome: 'Videoconferência', tipo: 'online' } });
    expect((await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).map((x) => x.id)).toEqual([id]);
  });

  it('sobreposição: "Conflito com a consulta de <nome> às 09:00"; encostar às 10:00 pode', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60', localId: consultorio }, deps);
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: bia.id, data: '2026-10-15', hora: '09:30', duracaoMin: '60', localId: consultorio }, deps))).toEqual({ geral: MSG_AGENDA.conflito('Ana Souza', '09:00') });
    await expect(agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: bia.id, data: '2026-10-15', hora: '10:00', duracaoMin: '60', localId: consultorio }, deps)).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('corrida (Review Focus 1): duas marcações simultâneas no mesmo horário → exatamente uma', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const [a, b] = [await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' }), await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' })];
    const r = await Promise.allSettled([a, b].map((p) => agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: p.id, data: '2026-10-15', hora: '14:00', duracaoMin: '60', localId: consultorio }, deps)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const falha = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(falha.reason, inspect(falha.reason)).toBeInstanceOf(ConsultaError);
    expect((falha.reason as ConsultaError).erros.geral).toMatch(/^Conflito com a consulta de (Ana Souza|Bia Lima) às 14:00$/);
  });

  it('corrida perdida no banco (23P01 depois da checagem) → "Conflito com a consulta de <nome>", não erro de banco', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const err = await perdeCorridaNoBanco(pools, T, ana.id, em('2026-10-15', '14:00'), () =>
      agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: bia.id, data: '2026-10-15', hora: '14:30', duracaoMin: '60', localId: consultorio }, deps),
    );
    expect(err).toBeInstanceOf(ConsultaError);
    expect((err as ConsultaError).erros).toEqual({ geral: MSG_AGENDA.conflito('Ana Souza', '14:00') });
    expect((await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).map((c) => c.paciente)).toEqual(['Ana Souza']);
  });

  it('revisão final: corrida no EXCLUDE que vira 40P01 (duas faixas gravadas ao mesmo tempo) → repete uma vez e devolve o conflito com o nome, não 500', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const err = await perdeDeadlockNoBanco(pools, T, bia.id, [{ inicio: em('2026-10-15', '14:00'), minutos: 30 }, { inicio: em('2026-10-15', '14:30'), minutos: 30 }], () =>
      agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '14:00', duracaoMin: '60', localId: consultorio }, deps),
    );
    expect(err, inspect(err)).toBeInstanceOf(ConsultaError);
    expect((err as ConsultaError).erros).toEqual({ geral: MSG_AGENDA.conflito('Bia Lima', '14:00') });
    expect((await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).map((c) => c.paciente)).toEqual(['Bia Lima', 'Bia Lima']);
  });

  it('fora do horário de atendimento e dentro de bloqueio: marca, com os avisos', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    await criarRegra(T.ctx, { diaSemana: '4', inicio: '08:00', fim: '12:00', duracaoMin: '60', localId: consultorio }, deps); // quinta
    await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-22', motivo: 'Congresso' }, deps);
    const base = { patientId: ana.id, duracaoMin: '60', localId: consultorio };
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2026-10-15', hora: '09:00' }, deps)).avisos).toEqual([]);
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2026-10-15', hora: '13:00' }, deps)).avisos).toEqual(['fora_do_horario']);
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2026-10-22', hora: '09:00' }, deps)).avisos).toEqual(['dentro_de_bloqueio']);
  });

  it('Plano 23: link online — local sem sala e sem link → "Informe o link da chamada (https://…)"; http:// recusado; o link padrão do Perfil não vale mais', async () => {
    const T = await novoTenant(app.db);
    const semSala = await novoLocal(app.db, T.ctx, { nome: 'Sala sem link', tipo: 'online', linkSala: null });
    const ana = await novoPaciente(app.db, T.ctx);
    const base = { patientId: ana.id, data: '2026-10-15', duracaoMin: '60', localId: semSala };
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '09:00' }, deps))).toEqual({ linkOnline: MSG_AGENDA.linkObrigatorio });
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '09:00', linkOnline: 'http://meet.google.com/x' }, deps))).toEqual({ linkOnline: MSG_AGENDA.linkObrigatorio });
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T, { linkOnlinePadrao: 'https://meet.google.com/abc-defg-hij' }), { ...base, hora: '09:00' }, deps))).toEqual({ linkOnline: MSG_AGENDA.linkObrigatorio });
    expect(await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).toEqual([]);
  });

  it('linkValido: só https://, sem espaço, até 500 caracteres (o mesmo limite do CHECK appointments_link_online)', () => {
    expect(linkValido('https://meet.google.com/abc-defg-hij')).toBe(true);
    expect(linkValido('http://meet.google.com/abc')).toBe(false);
    expect(linkValido('https://meet.google.com/a b')).toBe(false);
    expect(linkValido('javascript:alert(1)//https://x')).toBe(false);
    expect(linkValido(`https://x.dev/${'a'.repeat(486)}`)).toBe(true); // 500
    expect(linkValido(`https://x.dev/${'a'.repeat(487)}`)).toBe(false); // 501
  });

  it('validação: paciente, data, hora, duração; hora que não existe no fuso (horário de verão)', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: 'x', data: '2026-02-30', hora: '9h', duracaoMin: '5', localId: 'x' }, deps))).toEqual({
      patientId: MSG_AGENDA.pacienteObrigatorio, data: MSG_AGENDA.dataInvalida, hora: MSG_AGENDA.horaInvalida, duracaoMin: MSG_AGENDA.duracao, localId: MSG_AGENDA.escolhaOLocal,
    });
    const ana = await novoPaciente(app.db, T.ctx);
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T, { fuso: 'America/New_York' }), { patientId: ana.id, data: '2026-03-08', hora: '02:30', duracaoMin: '60', localId: consultorio }, deps))).toEqual({ hora: MSG_AGENDA.horaInexistente });
  });

  it('teto de datas (revisão final): 9999-12-31 23:30 e depois de hoje + 5 anos → "Informe uma data válida" no campo, nunca 500; até hoje + 5 anos e no passado (encaixe, D22) marca', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const base = { patientId: ana.id, hora: '23:30', duracaoMin: '60', localId: consultorio };
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '9999-12-31' }, deps))).toEqual({ data: MSG_AGENDA.dataInvalida });
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2031-10-02' }, deps))).toEqual({ data: MSG_AGENDA.dataInvalida }); // hoje (deps.now) = 01/10/2026
    await expect(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2031-10-01' }, deps)).resolves.toMatchObject({ id: expect.any(String) });
    await expect(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2020-01-01' }, deps)).resolves.toMatchObject({ id: expect.any(String) });
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'));
    expect(await erros(moverConsulta(T.ctx, tenantAgenda(T), id, { data: '9999-12-31', hora: '23:30', duracaoMin: '60', localId: consultorio }, deps))).toEqual({ data: MSG_AGENDA.dataInvalida });
  });

  it('paciente arquivado → "Paciente arquivado: desarquive para agendar."; bloqueado → PacienteBloqueadoError; de outro consultório → não encontrado', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const arq = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const blo = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    const base = { data: '2026-10-15', hora: '09:00', duracaoMin: '60', localId: consultorio };
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, patientId: arq.id }, deps))).toEqual({ patientId: MSG_AGENDA.pacienteArquivado });
    await expect(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, patientId: blo.id }, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    const outro = await novoTenant(app.db);
    const deOutro = await novoPaciente(app.db, outro.ctx);
    await expect(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, patientId: deOutro.id }, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    expect(await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).toEqual([]);
  });

  it('auditoria (D10): criar e alterar viram audit_log "agenda" do paciente, com o ator', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60', localId: consultorio }, deps);
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-16', hora: '10:00', duracaoMin: '45', localId: consultorio }, deps);
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'agenda'), eq(auditLog.entidadeId, id))).orderBy(auditLog.criadoEm), app.db);
    expect(log.map((l) => [l.acao, l.patientId, l.actorUserId])).toEqual([['criar', ana.id, T.nutriId], ['alterar', ana.id, T.nutriId]]);
  });
});

describe('alterar data e hora (US-031, D17)', () => {
  it('muda a hora, volta para "agendada" e limpa confirmação e pedido de remarcação; ignora a própria consulta no conflito', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'), 60, { status: 'confirmada', confirmadaVia: 'whatsapp', pedidoRemarcacaoEm: new Date() });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '09:30', duracaoMin: '60', localId: consultorio }, deps);
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({ inicio: em('2026-10-15', '09:30'), status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
  });

  it('mudar só o local (de presencial para online, mesmo início): continua "confirmada", com a confirmação e o pedido de remarcação (R3, D17)', async () => {
    const T = await novoTenant(app.db);
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: null });
    const ana = await novoPaciente(app.db, T.ctx);
    const pedido = new Date('2026-10-02T15:00:00Z');
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'), 60, { status: 'confirmada', confirmadaVia: 'whatsapp', pedidoRemarcacaoEm: pedido });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '09:00', duracaoMin: '45', localId: video, linkOnline: 'https://meet.google.com/abc-defg-hij' }, deps);
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({
      localId: video,
      inicio: em('2026-10-15', '09:00'),
      fim: em('2026-10-15', '09:45'),
      modalidade: 'online',
      linkOnline: 'https://meet.google.com/abc-defg-hij',
      status: 'confirmada',
      confirmadaVia: 'whatsapp',
      pedidoRemarcacaoEm: pedido,
    });
  });

  it('mudar o início de uma consulta confirmada pelo link: volta a "agendada", sem confirmação nem pedido de remarcação (R3, D17)', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'), 60, { status: 'confirmada', confirmadaVia: 'link', pedidoRemarcacaoEm: new Date('2026-10-02T15:00:00Z') });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-16', hora: '09:00', duracaoMin: '60', localId: consultorio }, deps);
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({ inicio: em('2026-10-16', '09:00'), status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
  });

  it('por cima de outra consulta: "Conflito com a consulta de <nome> às <hora>"; a consulta fica como estava', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-15', '14:00'));
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'));
    expect(await erros(moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '13:30', duracaoMin: '60', localId: consultorio }, deps))).toEqual({ geral: MSG_AGENDA.conflito('Bia Lima', '14:00') });
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({ inicio: em('2026-10-15', '09:00'), fim: em('2026-10-15', '10:00') });
  });

  it('corrida: duas consultas movidas ao mesmo tempo para o mesmo horário → só uma muda', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const [a, b] = [await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' }), await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' })];
    const ids = [await consultaDireta(app.db, T.ctx, a.id, em('2026-10-15', '08:00')), await consultaDireta(app.db, T.ctx, b.id, em('2026-10-15', '10:00'))];
    const r = await Promise.allSettled(ids.map((id) => moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '14:00', duracaoMin: '60', localId: consultorio }, deps)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const falha = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((falha.reason as ConsultaError).erros?.geral, inspect(falha.reason)).toMatch(/^Conflito com a consulta de (Ana Souza|Bia Lima) às 14:00$/);
    const agenda = await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db);
    expect(agenda.filter((c) => c.inicio.getTime() === em('2026-10-15', '14:00').getTime())).toHaveLength(1);
  });

  it('corrida perdida no banco ao alterar (23P01) → conflito com a outra consulta, não com a própria; a consulta fica onde estava', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const id = await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-15', '13:30')); // 13:30–14:30 cruza o horário novo
    const err = await perdeCorridaNoBanco(pools, T, ana.id, em('2026-10-15', '14:30'), () =>
      moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '14:00', duracaoMin: '60', localId: consultorio }, deps),
    );
    expect((err as ConsultaError).erros).toEqual({ geral: MSG_AGENDA.conflito('Ana Souza', '14:30') });
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({ inicio: em('2026-10-15', '13:30') });
  });

  it('revisão final: corrida no EXCLUDE ao alterar que vira 40P01 → repete uma vez e devolve o conflito com o nome; a consulta fica onde estava', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'));
    const err = await perdeDeadlockNoBanco(pools, T, bia.id, [{ inicio: em('2026-10-15', '14:00'), minutos: 30 }, { inicio: em('2026-10-15', '14:30'), minutos: 30 }], () =>
      moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '14:00', duracaoMin: '60', localId: consultorio }, deps),
    );
    expect(err, inspect(err)).toBeInstanceOf(ConsultaError);
    expect((err as ConsultaError).erros).toEqual({ geral: MSG_AGENDA.conflito('Bia Lima', '14:00') });
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({ inicio: em('2026-10-15', '09:00'), status: 'agendada' });
  });

  it('consulta cancelada, realizada ou de outro tenant não se altera', async () => {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: new Date() });
    const realizada = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-14', '09:00'), 60, { status: 'realizada' });
    const entrada = { data: '2026-10-16', hora: '09:00', duracaoMin: '60', localId: consultorio };
    expect(await erros(moverConsulta(T.ctx, tenantAgenda(T), id, entrada, deps))).toEqual({ geral: MSG_AGENDA.naoAlteravel });
    expect(await erros(moverConsulta(T.ctx, tenantAgenda(T), realizada, entrada, deps))).toEqual({ geral: MSG_AGENDA.naoAlteravel });
    const outro = await novoTenant(app.db);
    await expect(moverConsulta(outro.ctx, tenantAgenda(outro), id, entrada, deps)).rejects.toThrow(MSG_AGENDA.naoEncontrada);
    await expect(moverConsulta(T.ctx, tenantAgenda(T), 'nao-e-uuid', entrada, deps)).rejects.toThrow(MSG_AGENDA.naoEncontrada);
  });
});

/** SQLSTATE e constraint do erro de banco (DbError sanitizado pelo withTenant), ou null se gravou. */
const violacao = async (p: Promise<unknown>): Promise<{ code: unknown; constraint: unknown } | null> => {
  try {
    await p;
    return null;
  } catch (e) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown };
    return { code, constraint };
  }
};

describe('restrições do banco da agenda (migration 0066, revisão final)', () => {
  it('CHECK appointments_link_online: online exige link https:// sem espaço (nulo não passa — lógica de 3 valores); presencial, sem link', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    let h = 0;
    const gravar = (extra: Partial<typeof appointments.$inferInsert>) => consultaDireta(app.db, T.ctx, ana.id, em('2026-11-02', `${String(8 + h++).padStart(2, '0')}:00`), 60, extra);
    const recusa = { code: '23514', constraint: 'appointments_link_online' };
    expect(await violacao(gravar({ modalidade: 'online', linkOnline: null }))).toEqual(recusa);
    expect(await violacao(gravar({ modalidade: 'online', linkOnline: 'http://meet.example.test/x' }))).toEqual(recusa);
    expect(await violacao(gravar({ modalidade: 'online', linkOnline: 'https://' }))).toEqual(recusa);
    expect(await violacao(gravar({ modalidade: 'online', linkOnline: 'https://meet.example.test/a b' }))).toEqual(recusa);
    expect(await violacao(gravar({ modalidade: 'online', linkOnline: `https://x.dev/${'a'.repeat(487)}` }))).toEqual(recusa); // 501
    expect(await violacao(gravar({ modalidade: 'presencial', linkOnline: 'https://meet.example.test/x' }))).toEqual(recusa);
    expect(await violacao(gravar({ modalidade: 'online', linkOnline: `https://x.dev/${'a'.repeat(486)}` }))).toBeNull(); // 500
    expect(await violacao(gravar({ modalidade: 'online', linkOnline: 'https://anonimizado.invalid' }))).toBeNull(); // o que a anonimização grava (lgpd.ts)
    expect(await violacao(gravar({ modalidade: 'presencial', linkOnline: null }))).toBeNull();
  });

  it('FK public_booking_requests_consulta_fk: o pedido só aponta para uma consulta do mesmo consultório', async () => {
    const [A, B] = [await novoTenant(app.db), await novoTenant(app.db)];
    const [pa, pb] = [await novoPaciente(app.db, A.ctx), await novoPaciente(app.db, B.ctx)];
    const daA = await consultaDireta(app.db, A.ctx, pa.id, em('2026-11-03', '09:00'));
    const daB = await consultaDireta(app.db, B.ctx, pb.id, em('2026-11-03', '09:00'));
    const pedido = (appointmentId: string) =>
      withTenant(A.ctx, (tx) => tx.execute(sql`insert into public_booking_requests (id, tenant_id, token_hash, codigo_hash, email, nome, inicio, modalidade, termo_versao, expira_em, appointment_id)
        values (gen_random_uuid(), ${A.tenantId}, gen_random_uuid()::text, 'x', ${`fk-${appointmentId}@teste.dev`}, 'Iso', now(), 'presencial', 't', now(), ${appointmentId})`), app.db);
    const recusa = { code: '23503', constraint: 'public_booking_requests_consulta_fk' };
    expect(await violacao(pedido('00000000-0000-4000-8000-0000000000ff'))).toEqual(recusa);
    expect(await violacao(pedido(daB))).toEqual(recusa);
    expect(await violacao(pedido(daA))).toBeNull();
  });
});

describe('agenda da nutricionista (listarAgenda, buscarConsulta)', () => {
  it('só o período pedido (encostar não conta), em ordem, só do próprio consultório; "novo paciente via agendamento online" sem cadastro completo', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const novo = await novoPaciente(app.db, T.ctx, { nome: 'Caio Novo', origem: 'agendamento_publico', dataNascimento: null, sexo: null });
    const tarde = await consultaDireta(app.db, T.ctx, novo.id, em('2026-10-15', '15:00'));
    const manha = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-14', '23:00')); // termina 00:00 do dia 15: encosta
    const outro = await novoTenant(app.db);
    await consultaDireta(app.db, outro.ctx, (await novoPaciente(app.db, outro.ctx)).id, em('2026-10-15', '10:00'));
    const dia = await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db);
    expect(dia.map((c) => [c.id, c.paciente, c.pacienteNovoPublico])).toEqual([[manha, 'Ana Souza', false], [tarde, 'Caio Novo', true]]);
    expect(await buscarConsulta(outro.ctx, manha, app.db)).toBeNull();
    expect(await buscarConsulta(T.ctx, 'nao-e-uuid', app.db)).toBeNull();
  });
});

describe('horários livres (RN-03, D11)', () => {
  it('tira a consulta ocupada, devolve a cancelada e pode ignorar a própria consulta (remarcação)', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const de = em('2026-10-15', '00:00');
    const ate = em('2026-10-16', '00:00');
    const horas = async (o = {}) => (await horariosLivres(tenantAgenda(T), de, ate, { db: app.db, ...o })).map((h) => partesNoFuso(h.inicio, SP).hora);
    expect(await horas()).toHaveLength(12);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '10:00'), 60, { status: 'cancelada', canceladoPor: 'paciente', canceladaEm: new Date() });
    expect(await horas()).not.toContain('09:00');
    expect(await horas()).toContain('10:00');
    expect(await horas({ ignorarConsultaId: id })).toContain('09:00');
  });

  it('só intervalos, nunca quem ocupa; bloqueio e consulta que cruza o fim da janela também tiram o horário; outro consultório não interfere', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-15', horaInicio: '12:00', horaFim: '14:00', motivo: 'Médico' }, deps);
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '19:45'), 15); // começa depois do fim da janela (19:30)
    const outro = await novoTenant(app.db);
    await consultaDireta(app.db, outro.ctx, (await novoPaciente(app.db, outro.ctx)).id, em('2026-10-15', '08:00'));
    const livres = await horariosLivres(tenantAgenda(T), em('2026-10-15', '00:00'), em('2026-10-15', '19:30'), { db: app.db });
    for (const h of livres) expect(Object.keys(h).sort()).toEqual(['fim', 'inicio', 'localId', 'modalidades']);
    expect(livres.map((h) => partesNoFuso(h.inicio, SP).hora)).toEqual(['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
  });

  it('a sessão de paciente não vê a consulta de outro paciente, mas o EXCLUDE a protege mesmo assim (Review Focus 1)', async () => {
    const T = await novoTenant(app.db);
    const [p1, p2] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    await consultaDireta(app.db, T.ctx, p1.id, em('2026-10-15', '09:00'));
    const comoP2 = ctxPaciente(T.tenantId, p2.id);
    expect(await withTenant(comoP2, (tx) => tx.select().from(appointments), app.db)).toEqual([]);
    const err = await withTenant(comoP2, (tx) => tx.insert(appointments).values({ tenantId: T.tenantId, patientId: p2.id, inicio: em('2026-10-15', '09:30'), fim: em('2026-10-15', '10:30'), modalidade: 'presencial', origem: 'paciente' }), app.db).then(
      () => null,
      (e: unknown) => e,
    );
    expect(ehSobreposicao(err)).toBe(true);
    // DbError sem valores (RNF-11): nem o `detail` do Postgres ("Key (tenant_id, tstzrange(...))=(...)") nem o SQL
    for (const texto of [String((err as Error).message), inspect(err, { depth: 10 })]) expect(texto).not.toMatch(/2026-10|09:30|12:30|Key \(|tstzrange\(|insert into/i);
    // R9: a gravação recusada não deixou consulta nenhuma de p2 (a equipe vê todas)
    expect(await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, p2.id)), app.db)).toEqual([]);
  });
});

describe('Plano 23 (T3): local na consulta e nos horários livres', () => {
  /** Consultório com "Clínica Centro" (presencial), "Videoconferência" (online com sala) e um paciente. */
  async function doisLocais() {
    const T = await novoTenant(app.db);
    const consultorio = await localPrincipal(app.db, T.ctx);
    const clinica = await novoLocal(app.db, T.ctx, { nome: 'Clínica Centro' });
    const video = await novoLocal(app.db, T.ctx, { nome: 'Videoconferência', tipo: 'online', linkSala: 'https://sala.exemplo.test/debby' });
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    return { T, consultorio, clinica, video, ana };
  }
  const gravada = (T: { ctx: Parameters<typeof withTenant>[0] }, id: string) =>
    withTenant(T.ctx, async (tx) => (await tx.select().from(appointments).where(eq(appointments.id, id)))[0], app.db);

  it('agendarPelaNutri com local online e sem link usa a sala fixa; com link informado, o informado; com local presencial, o link é ignorado', async () => {
    const { T, clinica, video, ana } = await doisLocais();
    const base = { patientId: ana.id, data: '2026-10-15', duracaoMin: '60' };
    const semLink = await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '09:00', localId: video, linkOnline: '  ' }, deps);
    expect(await gravada(T, semLink.id)).toMatchObject({ modalidade: 'online', localId: video, linkOnline: 'https://sala.exemplo.test/debby' });
    const comLink = await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '10:00', localId: video, linkOnline: 'https://meet.google.com/outra' }, deps);
    expect(await gravada(T, comLink.id)).toMatchObject({ modalidade: 'online', linkOnline: 'https://meet.google.com/outra' });
    const presencial = await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '11:00', localId: clinica, linkOnline: 'https://meet.google.com/ignorado' }, deps);
    expect(await gravada(T, presencial.id)).toMatchObject({ modalidade: 'presencial', localId: clinica, linkOnline: null });
    expect(await buscarConsulta(T.ctx, presencial.id, app.db)).toMatchObject({ localId: clinica, local: { nome: 'Clínica Centro', tipo: 'presencial' } });
    expect((await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).map((c) => c.local?.nome)).toEqual(['Videoconferência', 'Videoconferência', 'Clínica Centro']);
  });

  it('sem local, local de outro consultório ou arquivado → "Escolha o local." no campo; nada é gravado', async () => {
    const { T, ana } = await doisLocais();
    const outro = await novoTenant(app.db);
    const deOutro = await localPrincipal(app.db, outro.ctx);
    const arquivado = await novoLocal(app.db, T.ctx, { nome: 'Sala antiga', arquivado: true });
    const base = { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60' };
    for (const localId of [undefined, '', 'nao-e-uuid', deOutro, arquivado])
      expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, localId }, deps))).toEqual({ localId: MSG_AGENDA.escolhaOLocal });
    expect(await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).toEqual([]);
  });

  it('corrida em dois locais (RN-408, CS-400): o mesmo horário em "Clínica Centro" e em "Videoconferência" ao mesmo tempo → uma fica, a outra recebe o conflito', async () => {
    const { T, clinica, video, ana } = await doisLocais();
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const base = { data: '2026-10-15', hora: '14:00', duracaoMin: '60' };
    const r = await Promise.allSettled([
      agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, patientId: ana.id, localId: clinica }, deps),
      agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, patientId: bia.id, localId: video }, deps),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const falha = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(falha.reason, inspect(falha.reason)).toBeInstanceOf(ConsultaError);
    expect((falha.reason as ConsultaError).erros.geral).toMatch(/^Conflito com a consulta de (Ana Souza|Bia Lima) às 14:00$/);
    // perdida no banco (23P01 depois da checagem): a outra transação grava no Consultório e segura o commit
    const err = await perdeCorridaNoBanco(pools, T, ana.id, em('2026-10-16', '14:00'), () =>
      agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2026-10-16', hora: '14:30', patientId: bia.id, localId: video }, deps),
    );
    expect((err as ConsultaError).erros).toEqual({ geral: MSG_AGENDA.conflito('Ana Souza', '14:00') });
  });

  it('moverConsulta: trocar presencial ↔ online sem trocar o local → "Escolha o local." (nunca o 23503 da FK composta); trocando o local, a modalidade e a sala vêm do novo', async () => {
    const { T, clinica, video, ana } = await doisLocais();
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60', localId: clinica }, deps);
    const entrada = { data: '2026-10-15', hora: '09:00', duracaoMin: '60' };
    expect(await erros(moverConsulta(T.ctx, tenantAgenda(T), id, { ...entrada, localId: clinica, modalidade: 'online', linkOnline: 'https://meet.google.com/x' }, deps))).toEqual({ localId: MSG_AGENDA.escolhaOLocal });
    // o formulário antigo (sem o campo do local) também não chega ao banco
    expect(await erros(moverConsulta(T.ctx, tenantAgenda(T), id, { ...entrada, localId: undefined, modalidade: 'online', linkOnline: 'https://meet.google.com/x' }, deps))).toEqual({ localId: MSG_AGENDA.escolhaOLocal });
    expect(await gravada(T, id)).toMatchObject({ modalidade: 'presencial', localId: clinica, linkOnline: null });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { ...entrada, localId: video }, deps);
    expect(await gravada(T, id)).toMatchObject({ modalidade: 'online', localId: video, linkOnline: 'https://sala.exemplo.test/debby' });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { ...entrada, localId: clinica, linkOnline: 'https://sala.exemplo.test/debby' }, deps);
    expect(await gravada(T, id)).toMatchObject({ modalidade: 'presencial', localId: clinica, linkOnline: null });
    // consulta antiga, sem local: alterar dá a ela o local escolhido
    const antiga = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '09:00'));
    expect(await buscarConsulta(T.ctx, antiga, app.db)).toMatchObject({ localId: null, local: null });
    await moverConsulta(T.ctx, tenantAgenda(T), antiga, { data: '2026-10-16', hora: '09:00', duracaoMin: '60', localId: clinica }, deps);
    expect(await gravada(T, antiga)).toMatchObject({ localId: clinica, modalidade: 'presencial' });
  });

  it('"Fora do seu horário de atendimento" é pelas regras do local da consulta', async () => {
    const { T, consultorio, clinica, ana } = await doisLocais();
    await criarRegra(T.ctx, { diaSemana: '4', inicio: '08:00', fim: '12:00', duracaoMin: '60', localId: clinica }, deps); // quinta, só na Clínica
    const base = { patientId: ana.id, data: '2026-10-15', duracaoMin: '60' };
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '09:00', localId: clinica }, deps)).avisos).toEqual([]);
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '10:00', localId: consultorio }, deps)).avisos).toEqual(['fora_do_horario']);
  });

  it('horariosLivres (CS-401, RN-409): só inicio, fim, modalidades e localId; um horário por local; só locais com agendamento; recorte por localId; a consulta de um local ocupa os dois', async () => {
    const { T, consultorio, clinica, video, ana } = await doisLocais();
    const semAgendamento = await novoLocal(app.db, T.ctx, { nome: 'Sala sem agendamento', agendamentoOnline: false });
    for (const localId of [clinica, video, semAgendamento]) await criarRegra(T.ctx, { diaSemana: '4', inicio: '08:00', fim: '10:00', duracaoMin: '60', localId }, deps);
    const de = em('2026-10-15', '00:00');
    const ate = em('2026-10-16', '00:00');
    const livres = await horariosLivres(tenantAgenda(T), de, ate, { db: app.db });
    for (const h of livres) expect(Object.keys(h).sort()).toEqual(['fim', 'inicio', 'localId', 'modalidades']);
    expect(livres.map((h) => [partesNoFuso(h.inicio, SP).hora, h.localId, h.modalidades])).toEqual([
      ['08:00', clinica, ['presencial']],
      ['08:00', video, ['online']],
      ['09:00', clinica, ['presencial']],
      ['09:00', video, ['online']],
    ]);
    expect((await horariosLivres(tenantAgenda(T), de, ate, { db: app.db, localId: video })).map((h) => h.localId)).toEqual([video, video]);
    expect(await horariosLivres(tenantAgenda(T), de, ate, { db: app.db, localId: consultorio })).toEqual([]);
    await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '08:00', duracaoMin: '60', localId: clinica }, deps);
    expect((await horariosLivres(tenantAgenda(T), de, ate, { db: app.db })).map((h) => partesNoFuso(h.inicio, SP).hora)).toEqual(['09:00', '09:00']);
  });

  it('RN-409: o horário de um pedido de pessoa nova aguardando a nutricionista some dos horários livres', async () => {
    const { T, clinica } = await doisLocais();
    await criarRegra(T.ctx, { diaSemana: '4', inicio: '08:00', fim: '11:00', duracaoMin: '60', localId: clinica }, deps);
    const de = em('2026-10-15', '00:00');
    const ate = em('2026-10-16', '00:00');
    const horas = async () => (await horariosLivres(tenantAgenda(T), de, ate, { db: app.db })).map((h) => partesNoFuso(h.inicio, SP).hora);
    expect(await horas()).toEqual(['08:00', '09:00', '10:00']);
    await withTenant(
      T.ctx,
      (tx) =>
        tx.execute(sql`insert into public_booking_requests (id, tenant_id, token_hash, codigo_hash, email, nome, inicio, fim, modalidade, termo_versao, expira_em, verificado_em, local_id, aguardando_desde)
          values (gen_random_uuid(), ${T.tenantId}, gen_random_uuid()::text, 'x', 'rita@teste.dev', 'Rita Lima', ${em('2026-10-15', '09:30')}, ${em('2026-10-15', '10:00')}, 'presencial', 't', now() + interval '10 minutes', now(), ${clinica}, now())`),
      app.db,
    );
    expect(await horas()).toEqual(['08:00', '10:00']);
  });
});
