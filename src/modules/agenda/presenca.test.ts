import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { eq } from 'drizzle-orm';
import { closeDb } from '@/db/client';
import { patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { MSG_AGENDA } from './constantes';
import { buscarConsulta, ConsultaError } from './consultas';
import { consultaParaIniciarAtendimento, contarPendenciasDePresenca, indicadoresDaAgenda, MSG_PRESENCA, novidadesDaAgenda, pendenciasDePresenca, registrarPresenca, textoTaxa } from './presenca';
import { registrarAtendimento } from '@/modules/pacientes/atendimentos';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = 'America/Sao_Paulo';
const agora = em('2026-10-20', '12:00');
const erro = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof ConsultaError ? e.erros : Promise.reject(e)));

describe('presença e falta (US-037, CS-03)', () => {
  it('consulta passada "agendada" ou "confirmada" → "faltou"/"realizada" (pode corrigir); futura não; cancelada não', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const passada = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-19', '09:00'), 60, { status: 'confirmada', confirmadaVia: 'whatsapp' });
    await registrarPresenca(T.ctx, passada, 'faltou', { db: app.db, now: agora });
    expect(await buscarConsulta(T.ctx, passada, app.db)).toMatchObject({ status: 'faltou' });
    await registrarPresenca(T.ctx, passada, 'realizada', { db: app.db, now: agora });
    expect((await buscarConsulta(T.ctx, passada, app.db))?.status).toBe('realizada');
    const futura = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-21', '09:00'));
    expect(await erro(registrarPresenca(T.ctx, futura, 'faltou', { db: app.db, now: agora }))).toEqual({ geral: MSG_PRESENCA.antesDoInicio });
    const cancelada = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-18', '09:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora });
    expect(await erro(registrarPresenca(T.ctx, cancelada, 'faltou', { db: app.db, now: agora }))).toEqual({ geral: MSG_AGENDA.naoAlteravel });
  });

  it('consulta de outro tenant ou id inválido → "Consulta não encontrada" (nunca 500)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const doB = await consultaDireta(app.db, B.ctx, (await novoPaciente(app.db, B.ctx)).id, em('2026-10-19', '09:00'));
    await expect(registrarPresenca(A.ctx, doB, 'faltou', { db: app.db, now: agora })).rejects.toThrow(MSG_AGENDA.naoEncontrada);
    await expect(registrarPresenca(A.ctx, 'nao-e-uuid', 'faltou', { db: app.db, now: agora })).rejects.toThrow(MSG_AGENDA.naoEncontrada);
    expect((await buscarConsulta(B.ctx, doB, app.db))?.status).toBe('agendada');
  });

  it('pendências: passadas há mais de 24 h sem registro ("3 consultas sem registro de presença")', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    for (const d of ['2026-10-15', '2026-10-16', '2026-10-17']) await consultaDireta(app.db, T.ctx, ana.id, em(d, '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-19', '15:00')); // terminou há menos de 24 h
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-14', '09:00'), 60, { status: 'realizada' });
    expect(await pendenciasDePresenca(T.ctx, agora, app.db)).toHaveLength(3);
    expect(await contarPendenciasDePresenca(T.ctx, agora, app.db)).toBe(3);
    expect(MSG_PRESENCA.pendencias(3)).toBe('3 consultas sem registro de presença');
    expect(MSG_PRESENCA.pendencias(1)).toBe('1 consulta sem registro de presença');
  });

  it('indicadores: consultas do mês, taxa de faltas do mês (só as já iniciadas) e a do mês anterior, no fuso do tenant', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const c = (data: string, extra = {}) => consultaDireta(app.db, T.ctx, ana.id, em(data, '09:00'), 60, extra);
    await c('2026-09-10', { status: 'faltou' });
    await c('2026-09-11', { status: 'realizada' });
    await c('2026-09-12', { status: 'realizada' });
    await c('2026-09-13', { status: 'realizada' });
    await c('2026-10-01', { status: 'faltou' });
    await c('2026-10-02', { status: 'realizada' });
    await c('2026-10-03', { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora });
    await c('2026-10-25'); // futura: conta no mês, não na taxa
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-09-30', '23:30'), 30, { status: 'faltou' }); // 30/09 23:30 de Brasília é setembro
    expect(await indicadoresDaAgenda(T.ctx, SP, agora, app.db)).toEqual({ consultasMes: 3, faltasMes: 1, iniciadasMes: 2, taxaMes: 0.5, taxaMesAnterior: 0.4 });
    expect(textoTaxa(0.125, 2, 16)).toBe('12,5% (2 de 16)');
    expect(textoTaxa(0.4)).toBe('40,0%');
    expect(textoTaxa(null)).toBe('Sem dados');
    const vazio = await novoTenant(app.db);
    expect(await indicadoresDaAgenda(vazio.ctx, SP, agora, app.db)).toEqual({ consultasMes: 0, faltasMes: 0, iniciadasMes: 0, taxaMes: null, taxaMesAnterior: null });
  });

  it('novidades para o painel: pedidos de remarcação, marcadas e canceladas pelo paciente nos últimos 7 dias', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-22', '09:00'), 60, { pedidoRemarcacaoEm: em('2026-10-20', '08:00') });
    // R4: createdAt fixo — o teste não depende do relógio real
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-23', '09:00'), 60, { origem: 'paciente', createdAt: em('2026-10-19', '10:00') });
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-26', '09:00'), 60, { origem: 'paciente', createdAt: em('2026-10-10', '10:00') }); // há mais de 7 dias
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-24', '09:00'), 60, { origem: 'paciente', status: 'cancelada', canceladoPor: 'paciente', canceladaEm: em('2026-10-19', '10:00') });
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-27', '09:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: em('2026-10-19', '10:00') }); // pela nutricionista
    const n = await novidadesDaAgenda(T.ctx, agora, app.db);
    expect([n.pedidosRemarcacao.length, n.marcadasPeloPaciente.length, n.canceladasPeloPaciente.length]).toEqual([1, 1, 1]);
    expect(n.marcadasPeloPaciente[0]).toMatchObject({ paciente: ana.nome, origem: 'paciente' });
  });

  it('rodada 1: paciente bloqueado ou anonimizado — a pendência de presença pode ser resolvida e sai da contagem', async () => {
    const T = await novoTenant(app.db);
    const bloqueada = await novoPaciente(app.db, T.ctx);
    const anonimizada = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const c1 = await consultaDireta(app.db, T.ctx, bloqueada.id, em('2026-10-10', '09:00'));
    const c2 = await consultaDireta(app.db, T.ctx, anonimizada.id, em('2026-10-11', '09:00'));
    // pedido de exclusão depois da consulta (US-018): bloqueado; e o outro já anonimizado
    await withTenant(T.ctx, async (tx) => {
      await tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: agora, anonimizarApos: '2046-10-12' }).where(eq(patients.id, bloqueada.id));
      await tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: agora, anonimizarApos: '2026-10-12', anonimizadoEm: agora }).where(eq(patients.id, anonimizada.id));
    }, app.db);
    expect(await contarPendenciasDePresenca(T.ctx, agora, app.db)).toBe(2);
    await registrarPresenca(T.ctx, c1, 'realizada', { db: app.db, now: agora });
    await registrarPresenca(T.ctx, c2, 'faltou', { db: app.db, now: agora });
    expect((await buscarConsulta(T.ctx, c1, app.db))?.status).toBe('realizada');
    expect((await buscarConsulta(T.ctx, c2, app.db))?.status).toBe('faltou');
    expect(await contarPendenciasDePresenca(T.ctx, agora, app.db)).toBe(0);
    expect(await pendenciasDePresenca(T.ctx, agora, app.db)).toEqual([]);
  });

  it('rodada 1: "Faltou" é recusado quando a consulta tem atendimento registrado; "Realizada" continua valendo', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const c = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-19', '09:00'));
    await registrarAtendimento(T.ctx, T.tenant, ana.id, { data: '2026-10-19', notasPrivadas: '', orientacoes: '', appointmentId: c }, { db: app.db, now: agora });
    expect(await erro(registrarPresenca(T.ctx, c, 'faltou', { db: app.db, now: agora }))).toEqual({ geral: MSG_PRESENCA.temAtendimento });
    expect(MSG_PRESENCA.temAtendimento).toBe('Esta consulta tem um atendimento registrado.');
    expect((await buscarConsulta(T.ctx, c, app.db))?.status).toBe('realizada');
    await registrarPresenca(T.ctx, c, 'realizada', { db: app.db, now: agora });
  });

  it('rodada 1: "Iniciar atendimento" — consulta deste paciente, já começada, não cancelada e sem atendimento (inclusive "realizada"/"faltou")', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const pode = async (patientId: string, id: string) => (await consultaParaIniciarAtendimento(T.ctx, patientId, id, agora, app.db))?.id ?? null;
    const agendada = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-20', '11:30')); // começou há 30 min
    const faltou = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-19', '09:00'), 60, { status: 'faltou' });
    const realizada = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-18', '09:00'), 60, { status: 'realizada' });
    const futura = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-20', '13:00')); // hoje, mais tarde
    const cancelada = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-17', '09:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora });
    const atendida = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '09:00'));
    await registrarAtendimento(T.ctx, T.tenant, ana.id, { data: '2026-10-16', notasPrivadas: '', orientacoes: '', appointmentId: atendida }, { db: app.db, now: agora });
    expect(await pode(ana.id, agendada)).toBe(agendada);
    expect(await pode(ana.id, faltou)).toBe(faltou);
    expect(await pode(ana.id, realizada)).toBe(realizada);
    for (const nao of [futura, cancelada, atendida]) expect(await pode(ana.id, nao)).toBeNull();
    expect(await pode(bia.id, agendada)).toBeNull(); // consulta de outro paciente
    expect(await pode(ana.id, 'nao-e-uuid')).toBeNull();
  });
});
