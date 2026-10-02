import { inspect } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, semanaToda, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
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

/**
 * Corrida perdida no banco, sem depender do relógio: outra transação grava a consulta e segura o `commit`;
 * `acao` checa (não vê a linha ainda não confirmada), grava e fica presa no EXCLUDE; só então a outra confirma.
 */
async function perdeCorridaNoBanco(T: TenantDeTeste, patientId: string, inicio: Date, acao: () => Promise<unknown>): Promise<unknown> {
  const outra = await app.pool.connect();
  let confirmada = false;
  try {
    await outra.query('begin');
    await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
    await outra.query(`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values ($1, $2, $3, $4, 'presencial', 'nutri')`, [
      T.tenantId, patientId, inicio, new Date(inicio.getTime() + 3_600_000),
    ]);
    const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
    const resultado = acao().then(
      () => null,
      (e: unknown) => e,
    );
    for (let i = 0; ; i++) {
      const presa = await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid]);
      if (presa.rowCount) break;
      if (i > 200) throw new Error('a gravação não ficou presa no EXCLUDE');
      await new Promise((r) => setTimeout(r, 10));
    }
    await outra.query('commit');
    confirmada = true;
    return await resultado;
  } finally {
    if (!confirmada) await outra.query('rollback').catch(() => undefined); // não devolve ao pool com transação aberta
    outra.release();
  }
}

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
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60', modalidade: 'online', linkOnline: 'https://meet.google.com/abc-defg-hij' }, deps);
    const c = await buscarConsulta(T.ctx, id, app.db);
    expect(c).toMatchObject({ paciente: 'Ana Souza', status: 'agendada', origem: 'nutri', modalidade: 'online', linkOnline: 'https://meet.google.com/abc-defg-hij', inicio: em('2026-10-15', '09:00'), fim: em('2026-10-15', '10:00') });
    expect((await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).map((x) => x.id)).toEqual([id]);
  });

  it('sobreposição: "Conflito com a consulta de <nome> às 09:00"; encostar às 10:00 pode', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60', modalidade: 'presencial' }, deps);
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: bia.id, data: '2026-10-15', hora: '09:30', duracaoMin: '60', modalidade: 'presencial' }, deps))).toEqual({ geral: MSG_AGENDA.conflito('Ana Souza', '09:00') });
    await expect(agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: bia.id, data: '2026-10-15', hora: '10:00', duracaoMin: '60', modalidade: 'presencial' }, deps)).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('corrida (Review Focus 1): duas marcações simultâneas no mesmo horário → exatamente uma', async () => {
    const T = await novoTenant(app.db);
    const [a, b] = [await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' }), await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' })];
    const r = await Promise.allSettled([a, b].map((p) => agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: p.id, data: '2026-10-15', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, deps)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const falha = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(falha.reason).toBeInstanceOf(ConsultaError);
    expect((falha.reason as ConsultaError).erros.geral).toMatch(/^Conflito com a consulta de (Ana Souza|Bia Lima) às 14:00$/);
  });

  it('corrida perdida no banco (23P01 depois da checagem) → "Conflito com a consulta de <nome>", não erro de banco', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const err = await perdeCorridaNoBanco(T, ana.id, em('2026-10-15', '14:00'), () =>
      agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: bia.id, data: '2026-10-15', hora: '14:30', duracaoMin: '60', modalidade: 'presencial' }, deps),
    );
    expect(err).toBeInstanceOf(ConsultaError);
    expect((err as ConsultaError).erros).toEqual({ geral: MSG_AGENDA.conflito('Ana Souza', '14:00') });
    expect((await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).map((c) => c.paciente)).toEqual(['Ana Souza']);
  });

  it('fora do horário de atendimento e dentro de bloqueio: marca, com os avisos', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    await criarRegra(T.ctx, { diaSemana: '4', inicio: '08:00', fim: '12:00', duracaoMin: '60', modalidade: 'presencial' }, deps); // quinta
    await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-22', motivo: 'Congresso' }, deps);
    const base = { patientId: ana.id, duracaoMin: '60', modalidade: 'presencial' };
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2026-10-15', hora: '09:00' }, deps)).avisos).toEqual([]);
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2026-10-15', hora: '13:00' }, deps)).avisos).toEqual(['fora_do_horario']);
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2026-10-22', hora: '09:00' }, deps)).avisos).toEqual(['dentro_de_bloqueio']);
  });

  it('link online: sem link e sem padrão → "Informe o link da chamada (https://…)"; usa o link padrão; http:// recusado', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const base = { patientId: ana.id, data: '2026-10-15', duracaoMin: '60', modalidade: 'online' };
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '09:00' }, deps))).toEqual({ linkOnline: MSG_AGENDA.linkObrigatorio });
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '09:00', linkOnline: 'http://meet.google.com/x' }, deps))).toEqual({ linkOnline: MSG_AGENDA.linkObrigatorio });
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T, { linkOnlinePadrao: 'https://meet.google.com/abc-defg-hij' }), { ...base, hora: '09:00' }, deps);
    expect((await buscarConsulta(T.ctx, id, app.db))?.linkOnline).toBe('https://meet.google.com/abc-defg-hij');
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
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: 'x', data: '2026-02-30', hora: '9h', duracaoMin: '5', modalidade: 'x' }, deps))).toEqual({
      patientId: MSG_AGENDA.pacienteObrigatorio, data: MSG_AGENDA.dataInvalida, hora: MSG_AGENDA.horaInvalida, duracaoMin: MSG_AGENDA.duracao, modalidade: MSG_AGENDA.modalidade,
    });
    const ana = await novoPaciente(app.db, T.ctx);
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T, { fuso: 'America/New_York' }), { patientId: ana.id, data: '2026-03-08', hora: '02:30', duracaoMin: '60', modalidade: 'presencial' }, deps))).toEqual({ hora: MSG_AGENDA.horaInexistente });
  });

  it('paciente arquivado → "Paciente arquivado: desarquive para agendar."; bloqueado → PacienteBloqueadoError; de outro consultório → não encontrado', async () => {
    const T = await novoTenant(app.db);
    const arq = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const blo = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    const base = { data: '2026-10-15', hora: '09:00', duracaoMin: '60', modalidade: 'presencial' };
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, patientId: arq.id }, deps))).toEqual({ patientId: MSG_AGENDA.pacienteArquivado });
    await expect(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, patientId: blo.id }, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    const outro = await novoTenant(app.db);
    const deOutro = await novoPaciente(app.db, outro.ctx);
    await expect(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, patientId: deOutro.id }, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    expect(await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).toEqual([]);
  });

  it('auditoria (D10): criar e alterar viram audit_log "agenda" do paciente, com o ator', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60', modalidade: 'presencial' }, deps);
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-16', hora: '10:00', duracaoMin: '45', modalidade: 'presencial' }, deps);
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'agenda'), eq(auditLog.entidadeId, id))).orderBy(auditLog.criadoEm), app.db);
    expect(log.map((l) => [l.acao, l.patientId, l.actorUserId])).toEqual([['criar', ana.id, T.nutriId], ['alterar', ana.id, T.nutriId]]);
  });
});

describe('alterar data e hora (US-031, D17)', () => {
  it('muda a hora, volta para "agendada" e limpa confirmação e pedido de remarcação; ignora a própria consulta no conflito', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'), 60, { status: 'confirmada', confirmadaVia: 'whatsapp', pedidoRemarcacaoEm: new Date() });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '09:30', duracaoMin: '60', modalidade: 'presencial' }, deps);
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({ inicio: em('2026-10-15', '09:30'), status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
  });

  it('mudar só a modalidade (mesmo início): continua "confirmada", com a confirmação e o pedido de remarcação (R3, D17)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const pedido = new Date('2026-10-02T15:00:00Z');
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'), 60, { status: 'confirmada', confirmadaVia: 'whatsapp', pedidoRemarcacaoEm: pedido });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '09:00', duracaoMin: '45', modalidade: 'online', linkOnline: 'https://meet.google.com/abc-defg-hij' }, deps);
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({
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
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'), 60, { status: 'confirmada', confirmadaVia: 'link', pedidoRemarcacaoEm: new Date('2026-10-02T15:00:00Z') });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-16', hora: '09:00', duracaoMin: '60', modalidade: 'presencial' }, deps);
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({ inicio: em('2026-10-16', '09:00'), status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
  });

  it('por cima de outra consulta: "Conflito com a consulta de <nome> às <hora>"; a consulta fica como estava', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-15', '14:00'));
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'));
    expect(await erros(moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '13:30', duracaoMin: '60', modalidade: 'presencial' }, deps))).toEqual({ geral: MSG_AGENDA.conflito('Bia Lima', '14:00') });
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({ inicio: em('2026-10-15', '09:00'), fim: em('2026-10-15', '10:00') });
  });

  it('corrida: duas consultas movidas ao mesmo tempo para o mesmo horário → só uma muda', async () => {
    const T = await novoTenant(app.db);
    const [a, b] = [await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' }), await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' })];
    const ids = [await consultaDireta(app.db, T.ctx, a.id, em('2026-10-15', '08:00')), await consultaDireta(app.db, T.ctx, b.id, em('2026-10-15', '10:00'))];
    const r = await Promise.allSettled(ids.map((id) => moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, deps)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const falha = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((falha.reason as ConsultaError).erros.geral).toMatch(/^Conflito com a consulta de (Ana Souza|Bia Lima) às 14:00$/);
    const agenda = await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db);
    expect(agenda.filter((c) => c.inicio.getTime() === em('2026-10-15', '14:00').getTime())).toHaveLength(1);
  });

  it('corrida perdida no banco ao alterar (23P01) → conflito com a outra consulta, não com a própria; a consulta fica onde estava', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const id = await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-15', '13:30')); // 13:30–14:30 cruza o horário novo
    const err = await perdeCorridaNoBanco(T, ana.id, em('2026-10-15', '14:30'), () =>
      moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, deps),
    );
    expect((err as ConsultaError).erros).toEqual({ geral: MSG_AGENDA.conflito('Ana Souza', '14:30') });
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({ inicio: em('2026-10-15', '13:30') });
  });

  it('consulta cancelada, realizada ou de outro tenant não se altera', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: new Date() });
    const realizada = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-14', '09:00'), 60, { status: 'realizada' });
    const entrada = { data: '2026-10-16', hora: '09:00', duracaoMin: '60', modalidade: 'presencial' };
    expect(await erros(moverConsulta(T.ctx, tenantAgenda(T), id, entrada, deps))).toEqual({ geral: MSG_AGENDA.naoAlteravel });
    expect(await erros(moverConsulta(T.ctx, tenantAgenda(T), realizada, entrada, deps))).toEqual({ geral: MSG_AGENDA.naoAlteravel });
    const outro = await novoTenant(app.db);
    await expect(moverConsulta(outro.ctx, tenantAgenda(outro), id, entrada, deps)).rejects.toThrow(MSG_AGENDA.naoEncontrada);
    await expect(moverConsulta(T.ctx, tenantAgenda(T), 'nao-e-uuid', entrada, deps)).rejects.toThrow(MSG_AGENDA.naoEncontrada);
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
    for (const h of livres) expect(Object.keys(h).sort()).toEqual(['fim', 'inicio', 'modalidades']);
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
