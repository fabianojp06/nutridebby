import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { auditLog, consultationNotes, consultations } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { buscarConsulta } from '@/modules/agenda/consultas';
import { AtendimentoError, atualizarAtendimento, buscarAtendimento, listarAtendimentos, MSG_ATENDIMENTO, orientacoesDoPaciente, registrarAtendimento } from './atendimentos';
import { PacienteNaoEncontradoError } from './base';

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
    const id = await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-01', notasPrivadas: NOTA, orientacoes: ORIENTACAO }, deps);
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
    const idA = await registrarAtendimento(A.ctx, A.tenant, pA.id, { data: '2026-10-01', notasPrivadas: '', orientacoes: ORIENTACAO }, deps);
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
    const id = await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-10-01', notasPrivadas: NOTA, orientacoes: '' }, deps);
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

  it('paciente de outro tenant ou atendimento de outro paciente: recusado; e o banco barra nota cruzada (FK tripla)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pB = await novoPaciente(app.db, B.ctx);
    await expect(registrarAtendimento(A.ctx, A.tenant, pB.id, { data: '2026-10-01', notasPrivadas: '', orientacoes: '' }, deps)).rejects.toBeInstanceOf(PacienteNaoEncontradoError);
    const p1 = await novoPaciente(app.db, A.ctx);
    const p2 = await novoPaciente(app.db, A.ctx);
    const de1 = await registrarAtendimento(A.ctx, A.tenant, p1.id, { data: '2026-10-01', notasPrivadas: '', orientacoes: '' }, deps);
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
    const id = await registrarAtendimento(T.ctx, T.tenant, p.id, entrada(c), deps);
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
    const solto = await registrarAtendimento(T.ctx, T.tenant, p.id, { ...entrada(''), data: '2026-10-01' }, deps);
    expect((await withTenant(T.ctx, (tx) => tx.select().from(consultations).where(eq(consultations.id, solto)), app.db))[0].appointmentId).toBeNull();
  });

  it('consulta marcada como "faltou" por engano: o atendimento corrige para "realizada"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const c = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-30T12:00:00Z'), 60, { status: 'faltou' });
    await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-09-30', notasPrivadas: '', orientacoes: '', appointmentId: c }, deps);
    expect((await buscarConsulta(T.ctx, c, app.db))?.status).toBe('realizada');
  });
});
