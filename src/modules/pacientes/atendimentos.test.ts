import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { consultaDireta, pedidoDireto, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, consultationNotes, consultations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { buscarConsulta } from '@/modules/agenda/consultas';
import { AtendimentoError, atualizarAtendimento, buscarAtendimento, listarAtendimentos, MSG_ATENDIMENTO, orientacoesDoPaciente, registrarAtendimento } from './atendimentos';
import { PacienteNaoEncontradoError } from './base';
import { salvarConfiguracoes } from '@/modules/financeiro/configuracoes';
import { jornadaDoPaciente } from '@/modules/portal/jornada';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T15:00:00Z');
const deps = { db: app.db, now };
afterAll(() => app.pool.end());

const NOTA = 'suspeita de compulsão';
const ORIENTACAO = 'beber 2 L de água/dia';

describe('atendimentos (US-016)', () => {
  it('registra notas privadas e orientações; a auditoria vê as duas entidades, com a nutricionista', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-01', notasPrivadas: NOTA, orientacoes: ORIENTACAO }, deps);
    expect(await buscarAtendimento(T.ctx, p.id, id, app.db)).toMatchObject({ id, data: '2026-10-01', notasPrivadas: NOTA, orientacoesPaciente: ORIENTACAO });
    // filtra as duas entidades: o novoPaciente também grava "criar" em patients com o mesmo patient_id
    const log = await withTenant(
      T.ctx,
      (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'criar'), inArray(auditLog.entidade, ['atendimentos', 'notas_privadas']))),
      app.db,
    );
    expect(log.map((l) => l.entidade).sort()).toEqual(['atendimentos', 'notas_privadas']);
    expect(log.every((l) => l.actorUserId === T.nutriId)).toBe(true);
  });

  it('"Privacidade das notas": na sessão do paciente, as orientações aparecem e a nota nunca (nem no JSON)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-01', notasPrivadas: NOTA, orientacoes: ORIENTACAO }, deps);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const doPortal = await orientacoesDoPaciente(ctx, app.db);
    expect(doPortal).toEqual([{ data: '2026-10-01', orientacoes: ORIENTACAO }]);
    expect(JSON.stringify(doPortal)).not.toContain(NOTA);
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.patientId, p.id), eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'atendimentos'))), app.db);
    expect(lidas).toHaveLength(1); // o próprio paciente lendo as orientações também fica no histórico (regra 8)
    await expect(orientacoesDoPaciente(T.ctx, app.db)).rejects.toThrow(/sessão de paciente/); // nunca com o contexto da nutricionista
    expect(await withTenant(ctx, (tx) => tx.select().from(consultationNotes), app.db)).toEqual([]);
    const vistos = await listarAtendimentos(ctx, p.id, app.db);
    expect(JSON.stringify(vistos)).not.toContain(NOTA);
    expect(vistos[0].notasPrivadas).toBeNull();
  });

  it('WITH CHECK de consultation_notes: o tenant B não grava nota no atendimento de A (42501)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pA = await novoPaciente(app.db, A.ctx);
    const { id: idA } = await registrarAtendimento(A.ctx, A.tenant, pA.id, { data: '2026-10-01', notasPrivadas: '', orientacoes: ORIENTACAO }, deps);
    // a matriz de isolamento cria o atendimento na mesma CTE, então lá quem recusa é a RLS de consultations;
    // aqui o atendimento já existe e só a política da própria consultation_notes pode barrar
    const tentativa = withTenant(
      B.ctx,
      (tx) => tx.execute(sql`insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) values (${A.tenantId}, ${pA.id}, ${idA}, 'x')`),
      app.db,
    );
    await expect(tentativa).rejects.toSatisfy((e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code === '42501');
    expect((await buscarAtendimento(A.ctx, pA.id, idA, app.db))?.notasPrivadas).toBeNull();
  });

  it('editar troca as orientações e, com as notas vazias, apaga a nota', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-01', notasPrivadas: NOTA, orientacoes: '' }, deps);
    await atualizarAtendimento(T.ctx, T.tenant, p.id, id, { data: '2026-10-01', notasPrivadas: '  ', orientacoes: ORIENTACAO }, deps);
    expect(await buscarAtendimento(T.ctx, p.id, id, app.db)).toMatchObject({ notasPrivadas: null, orientacoesPaciente: ORIENTACAO });
    await atualizarAtendimento(T.ctx, T.tenant, p.id, id, { data: '2026-09-30', notasPrivadas: 'nova nota', orientacoes: ORIENTACAO }, deps);
    expect(await buscarAtendimento(T.ctx, p.id, id, app.db)).toMatchObject({ data: '2026-09-30', notasPrivadas: 'nova nota' });
  });

  it('data futura ou texto longo demais: recusado sem gravar', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const r = registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-05', notasPrivadas: 'x'.repeat(20001), orientacoes: 'y'.repeat(5001) }, deps);
    await expect(r).rejects.toBeInstanceOf(AtendimentoError);
    await expect(r).rejects.toMatchObject({ erros: { data: MSG_ATENDIMENTO.futuro, notasPrivadas: MSG_ATENDIMENTO.notas, orientacoes: MSG_ATENDIMENTO.orientacoes } });
    expect(await listarAtendimentos(T.ctx, p.id, app.db)).toEqual([]);
  });

  it('SUS-114: os limites contam caracteres (code points, como o CHECK): emojis no limite passam, um a mais não', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const notas = '🙂'.repeat(20000);
    const orientacoes = '🥗'.repeat(5000);
    const { id } = await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-01', notasPrivadas: notas, orientacoes }, deps);
    expect(await buscarAtendimento(T.ctx, p.id, id, app.db)).toMatchObject({ notasPrivadas: notas, orientacoesPaciente: orientacoes });
    const r = atualizarAtendimento(T.ctx, T.tenant, p.id, id, { data: '2026-10-01', notasPrivadas: `${notas}🙂`, orientacoes: `${orientacoes}🥗` }, deps);
    await expect(r).rejects.toMatchObject({ erros: { notasPrivadas: MSG_ATENDIMENTO.notas, orientacoes: MSG_ATENDIMENTO.orientacoes } });
  });

  it('paciente de outro tenant ou atendimento de outro paciente: recusado; e o banco barra nota cruzada (FK tripla)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pB = await novoPaciente(app.db, B.ctx);
    await expect(registrarAtendimento(A.ctx, A.tenant, pB.id, { data: '2026-10-01', notasPrivadas: '', orientacoes: '' }, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const p1 = await novoPaciente(app.db, A.ctx);
    const p2 = await novoPaciente(app.db, A.ctx);
    const { id: de1 } = await registrarAtendimento(A.ctx, A.tenant, p1.id, { data: '2026-10-01', notasPrivadas: '', orientacoes: '' }, deps);
    await expect(atualizarAtendimento(A.ctx, A.tenant, p2.id, de1, { data: '2026-10-01', notasPrivadas: 'x', orientacoes: '' }, deps)).rejects.toMatchObject({
      erros: { geral: MSG_ATENDIMENTO.naoEncontrado },
    });
    expect(await buscarAtendimento(A.ctx, p2.id, de1, app.db)).toBeNull();
    const cruzada = withTenant(A.ctx, (tx) => tx.execute(sql`insert into consultation_notes (tenant_id, patient_id, consultation_id, texto) values (${A.tenantId}, ${p2.id}, ${de1}, 'x')`), app.db);
    await expect(cruzada).rejects.toSatisfy((e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code === '23503');
    expect(await buscarAtendimento(A.ctx, p1.id, randomUUID(), app.db)).toBeNull();
  });

  it('"Iniciar atendimento" da agenda: liga a consulta, marca "realizada"; a mesma consulta não tem dois atendimentos', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const c = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-30T12:00:00Z'));
    const entrada = (appointmentId: string) => ({ data: '2026-09-30', notasPrivadas: '', orientacoes: '', appointmentId });
    const { id } = await registrarAtendimento(T.ctx, T.tenant, p.id, entrada(c), deps);
    const [linha] = await withTenant(T.ctx, (tx) => tx.select().from(consultations).where(eq(consultations.id, id)), app.db);
    expect(linha.appointmentId).toBe(c);
    expect((await buscarConsulta(T.ctx, c, app.db))?.status).toBe('realizada');
    await expect(registrarAtendimento(T.ctx, T.tenant, p.id, entrada(c), deps)).rejects.toMatchObject({ erros: { geral: MSG_ATENDIMENTO.consultaJaAtendida } });
    const outro = await novoPaciente(app.db, T.ctx);
    await expect(registrarAtendimento(T.ctx, T.tenant, outro.id, entrada(c), deps)).rejects.toMatchObject({ erros: { geral: MSG_ATENDIMENTO.consultaInvalida } });
    // id malformado, consulta de outro tenant ou cancelada: recusado sem gravar nada
    const B = await novoTenant(app.db);
    const doB = await consultaDireta(app.db, B.ctx, (await novoPaciente(app.db, B.ctx)).id, new Date('2026-09-30T12:00:00Z'));
    const cancelada = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-29T12:00:00Z'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: now });
    for (const invalida of ['nao-e-uuid', doB, cancelada]) {
      await expect(registrarAtendimento(T.ctx, T.tenant, p.id, entrada(invalida), deps)).rejects.toMatchObject({ erros: { geral: MSG_ATENDIMENTO.consultaInvalida } });
    }
    expect(await withTenant(T.ctx, (tx) => tx.select().from(consultations).where(eq(consultations.patientId, p.id)), app.db)).toHaveLength(1);
    // sem consulta (aba Atendimentos): como antes
    const { id: solto } = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...entrada(''), data: '2026-10-01' }, deps);
    expect((await withTenant(T.ctx, (tx) => tx.select().from(consultations).where(eq(consultations.id, solto)), app.db))[0].appointmentId).toBeNull();
  });

  it('code-review do PR #7: consulta que ainda não começou (movida para o futuro, ou POST montado) não recebe atendimento nem vira "realizada" — a regra da tela, no servidor', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const entrada = (appointmentId: string) => ({ data: '2026-10-01', notasPrivadas: '', orientacoes: '', appointmentId });
    const futura = await consultaDireta(app.db, T.ctx, p.id, new Date(now.getTime() + 2 * 3_600_000)); // começa daqui a 2 h
    await expect(registrarAtendimento(T.ctx, T.tenant, p.id, entrada(futura), deps)).rejects.toMatchObject({ erros: { geral: 'Esta consulta ainda não começou.' } });
    expect((await buscarConsulta(T.ctx, futura, app.db))?.status).toBe('agendada');
    expect(await withTenant(T.ctx, (tx) => tx.select().from(consultations).where(eq(consultations.patientId, p.id)), app.db)).toEqual([]);
    // no início em ponto já pode (consultaParaIniciarAtendimento: inicio <= agora)
    const agoraMesmo = await consultaDireta(app.db, T.ctx, p.id, now);
    await registrarAtendimento(T.ctx, T.tenant, p.id, entrada(agoraMesmo), deps);
    expect((await buscarConsulta(T.ctx, agoraMesmo, app.db))?.status).toBe('realizada');
  });

  it('consulta marcada como "faltou" por engano: o atendimento corrige para "realizada"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const c = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-30T12:00:00Z'), 60, { status: 'faltou' });
    await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-09-30', notasPrivadas: '', orientacoes: '', appointmentId: c }, deps);
    expect((await buscarConsulta(T.ctx, c, app.db))?.status).toBe('realizada');
  });
});

describe('Plano 20 (US-303, F-D13): o atendimento ligado a uma consulta que não era "Realizada" gera a cobrança', () => {
  const owner = makeDb(inject('ownerDatabaseUrl'));
  afterAll(() => owner.pool.end());
  const linhas = async (tenantId: string) =>
    (await owner.pool.query('select to_jsonb(l) as r from fin_lancamentos l where tenant_id = $1', [tenantId])).rows.map((x) => x.r);
  const entrada = (appointmentId: string) => ({ data: '2026-09-30', notasPrivadas: '', orientacoes: '', appointmentId });

  it('consulta "faltou" por engano → "realizada" e a cobrança na mesma transação ({ id, cobranca: criada }); já "realizada" → cobranca null', async () => {
    const T = await novoTenant(app.db);
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-09-01', saldoInicial: '0', valorConsulta: '250,00' }, { db: app.db, agora: now });
    const p = await novoPaciente(app.db, T.ctx);
    const faltou = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-30T12:00:00Z'), 60, { status: 'faltou' });
    const r = await registrarAtendimento(T.ctx, T.tenant, p.id, entrada(faltou), deps);
    expect(r).toEqual({ id: expect.any(String), cobranca: { tipo: 'criada', valorCentavos: 25000 } });
    expect((await buscarConsulta(T.ctx, faltou, app.db))?.status).toBe('realizada');
    expect(await linhas(T.tenantId)).toEqual([expect.objectContaining({ appointment_id: faltou, patient_id: p.id, valor_centavos: 25000, vencimento: '2026-09-30' })]);

    const realizada = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-29T12:00:00Z'), 60, { status: 'realizada' });
    expect(await registrarAtendimento(T.ctx, T.tenant, p.id, entrada(realizada), deps)).toEqual({ id: expect.any(String), cobranca: null });
    // sem consulta: nada do Financeiro
    expect(await registrarAtendimento(T.ctx, T.tenant, p.id, entrada(''), deps)).toEqual({ id: expect.any(String), cobranca: null });
    expect(await linhas(T.tenantId)).toHaveLength(1);
  });

  it('sem o valor da consulta → sem_valor, e o atendimento é gravado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const c = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-30T12:00:00Z'));
    const r = await registrarAtendimento(T.ctx, T.tenant, p.id, entrada(c), deps);
    expect(r.cobranca).toEqual({ tipo: 'sem_valor' });
    expect(await buscarAtendimento(T.ctx, p.id, r.id, app.db)).not.toBeNull();
  });

  it('a recusa do atendimento (consulta já atendida) desfaz a cobrança junto', async () => {
    const T = await novoTenant(app.db);
    await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: '2026-09-01', saldoInicial: '0', valorConsulta: '250,00' }, { db: app.db, agora: now });
    const p = await novoPaciente(app.db, T.ctx);
    const c = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-30T12:00:00Z'));
    // um atendimento já ligado à consulta, gravado direto, com a consulta ainda "agendada"
    await withTenant(T.ctx, (tx) => tx.insert(consultations).values({ tenantId: T.tenantId, patientId: p.id, data: '2026-09-30', appointmentId: c }), app.db);
    await expect(registrarAtendimento(T.ctx, T.tenant, p.id, entrada(c), deps)).rejects.toMatchObject({ erros: { geral: MSG_ATENDIMENTO.consultaJaAtendida } });
    expect((await buscarConsulta(T.ctx, c, app.db))?.status).toBe('agendada');
    expect(await linhas(T.tenantId)).toEqual([]);
  });
});

describe('Plano 23 (T6a, §4.3): o atendimento não nasce de um pedido', () => {
  it('registrar atendimento ligado a um pedido → "Aceite o pedido antes de registrar o atendimento."; nada é gravado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const pedido = await pedidoDireto(app.db, T, p.id, new Date('2026-10-01T12:00:00Z'));
    const e = await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-01', notasPrivadas: '', orientacoes: '', appointmentId: pedido }, deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AtendimentoError);
    expect((e as AtendimentoError).erros).toEqual({ geral: 'Aceite o pedido antes de registrar o atendimento.' });
    expect(MSG_ATENDIMENTO.pedido).toBe('Aceite o pedido antes de registrar o atendimento.');
    expect((await buscarConsulta(T.ctx, pedido, app.db))?.status).toBe('solicitada');
    expect(await listarAtendimentos(T.ctx, p.id, app.db)).toEqual([]);
  });
});

describe('Plano 23 (US-410, RN-430): previsão de retorno no atendimento', () => {
  const FORA_DA_FAIXA = 'A previsão de retorno deve ficar entre a data do atendimento e 2 anos depois.';
  const base = { data: '2026-10-01', notasPrivadas: '', orientacoes: '' };
  const previsao = async (T: Awaited<ReturnType<typeof novoTenant>>, patientId: string, id: string) =>
    (await withTenant(T.ctx, (tx) => tx.select({ r: consultations.retornoPrevistoEm }).from(consultations).where(and(eq(consultations.id, id), eq(consultations.patientId, patientId))), app.db))[0]?.r;

  it('"em 6 semanas" a partir da data do atendimento no fuso: servidor em UTC às 01:30 do dia seguinte (22:30 em São Paulo)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const madrugadaUtc = new Date('2026-10-02T01:30:00Z'); // ainda 01/10 em São Paulo: "hoje" é 01/10 e 02/10 seria futuro
    const r = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...base, retornoPrevistoEm: '', retornoSemanas: '6' }, { db: app.db, now: madrugadaUtc });
    expect(Object.keys(r).sort()).toEqual(['cobranca', 'id']); // o retorno do Plano 20 PR 2 não muda
    expect(await previsao(T, p.id, r.id)).toBe('2026-11-12');
    expect((await buscarAtendimento(T.ctx, p.id, r.id, app.db))?.retornoPrevistoEm).toBe('2026-11-12');
  });

  it('a data informada; "Em {n} semanas" preenchido vence a data; nada informado = sem previsão', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id: comData } = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...base, retornoPrevistoEm: '2026-12-10', retornoSemanas: '' }, deps);
    expect(await previsao(T, p.id, comData)).toBe('2026-12-10');
    const { id: semanas } = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...base, data: '2026-09-30', retornoPrevistoEm: '2026-12-10', retornoSemanas: ' 2 ' }, deps);
    expect(await previsao(T, p.id, semanas)).toBe('2026-10-14');
    const { id: sem } = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...base, data: '2026-09-29' }, deps);
    expect(await previsao(T, p.id, sem)).toBeNull();
  });

  it('limite: a própria data e +730 dias passam; um dia antes, +731 dias, 105 semanas ou texto → a mensagem da RN-430, sem gravar', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id: mesmoDia } = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...base, retornoPrevistoEm: '2026-10-01' }, deps);
    expect(await previsao(T, p.id, mesmoDia)).toBe('2026-10-01');
    const { id: doisAnos } = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...base, data: '2026-09-30', retornoPrevistoEm: '2028-09-29' }, deps); // +730
    expect(await previsao(T, p.id, doisAnos)).toBe('2028-09-29');
    const { id: semanas104 } = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...base, data: '2026-09-29', retornoSemanas: '104' }, deps);
    expect(await previsao(T, p.id, semanas104)).toBe('2028-09-26');
    const outro = await novoPaciente(app.db, T.ctx);
    for (const entrada of [{ retornoPrevistoEm: '2026-09-30' }, { retornoPrevistoEm: '2028-10-01' }, { retornoSemanas: '105' }, { retornoSemanas: '0' }, { retornoSemanas: '-1' }, { retornoSemanas: '2,5' }, { retornoSemanas: 'seis' }, { retornoPrevistoEm: '2026-02-30' }]) {
      const e = await registrarAtendimento(T.ctx, T.tenant, outro.id, { ...base, ...entrada }, deps).catch((x: unknown) => x);
      expect(e, JSON.stringify(entrada)).toBeInstanceOf(AtendimentoError);
      expect((e as AtendimentoError).erros, JSON.stringify(entrada)).toEqual({ retornoPrevistoEm: FORA_DA_FAIXA });
    }
    expect(MSG_ATENDIMENTO.retornoPrevisto).toBe(FORA_DA_FAIXA);
    expect(await listarAtendimentos(T.ctx, outro.id, app.db)).toEqual([]);
  });

  it('editar a data com a previsão fora da faixa → a mensagem da RN-430 (nunca o 23514 do banco), também sem os campos da previsão na entrada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const { id } = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...base, data: '2026-09-01', retornoPrevistoEm: '2026-09-20' }, deps);
    // a data vai para depois da previsão: o formulário manda a previsão de antes
    const e1 = await atualizarAtendimento(T.ctx, T.tenant, p.id, id, { ...base, retornoPrevistoEm: '2026-09-20', retornoSemanas: '' }, deps).catch((x: unknown) => x);
    expect(e1).toBeInstanceOf(AtendimentoError);
    expect((e1 as AtendimentoError).erros).toEqual({ retornoPrevistoEm: FORA_DA_FAIXA });
    // quem chama sem os campos da previsão mantém a gravada — e ela é conferida contra a data nova
    const e2 = await atualizarAtendimento(T.ctx, T.tenant, p.id, id, base, deps).catch((x: unknown) => x);
    expect(e2).toBeInstanceOf(AtendimentoError);
    expect((e2 as AtendimentoError).erros).toEqual({ retornoPrevistoEm: FORA_DA_FAIXA });
    expect(await buscarAtendimento(T.ctx, p.id, id, app.db)).toMatchObject({ data: '2026-09-01', retornoPrevistoEm: '2026-09-20' });
    // sem os campos e com a data dentro da faixa: a previsão fica; com os campos vazios: some
    await atualizarAtendimento(T.ctx, T.tenant, p.id, id, { ...base, data: '2026-09-10' }, deps);
    expect(await buscarAtendimento(T.ctx, p.id, id, app.db)).toMatchObject({ data: '2026-09-10', retornoPrevistoEm: '2026-09-20' });
    await atualizarAtendimento(T.ctx, T.tenant, p.id, id, { ...base, data: '2026-09-10', retornoPrevistoEm: '', retornoSemanas: '' }, deps);
    expect(await buscarAtendimento(T.ctx, p.id, id, app.db)).toMatchObject({ retornoPrevistoEm: null });
  });

  it('data do atendimento inválida: só o erro da data, não o da previsão', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    for (const entrada of [{ retornoSemanas: '6' }, { retornoPrevistoEm: '2026-12-01' }, { retornoSemanas: 'seis' }]) {
      const e = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...base, data: '', ...entrada }, deps).catch((x: unknown) => x);
      expect((e as AtendimentoError).erros, JSON.stringify(entrada)).toEqual({ data: MSG_ATENDIMENTO.data });
    }
  });

  it('a previsão não vai ao portal: a Jornada projeta só id, data e orientação', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await registrarAtendimento(T.ctx, T.tenant, p.id, { ...base, orientacoes: ORIENTACAO, retornoPrevistoEm: '2026-12-17' }, deps);
    const j = await jornadaDoPaciente(ctxPaciente(T.tenantId, p.id), { ...tenantAgenda(T), mostrarPercGorduraPaciente: false }, now, app.db);
    const json = JSON.stringify(j);
    expect(json).toContain(ORIENTACAO.split(' ')[0]); // controle: a orientação saiu
    expect(json).not.toMatch(/2026-12-17|17\/12\/2026|retornoPrevisto/);
    expect(JSON.stringify(await orientacoesDoPaciente(ctxPaciente(T.tenantId, p.id), app.db))).not.toMatch(/2026-12-17|retornoPrevisto/);
  });
});
