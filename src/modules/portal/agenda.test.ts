import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { consultaDireta, em, semanaToda, tenantAgenda } from '../../../test/agenda';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { consultaDoPaciente, consultasDoPaciente, horariosDaSemana } from './agenda';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

describe('agenda do paciente no PWA (P06-09)', () => {
  it('próximas (ativas, em ordem) e anteriores (as 10 últimas); só as do próprio paciente; prazo do RN-04', async () => {
    const T = await novoTenant(app.db);
    const [ana, bia] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const agora = em('2026-10-05', '10:00');
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-05', '20:00')); // hoje, a menos de 24 h: não altera
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-09', '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-09-30', '09:00'));
    await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-08', '09:00'));
    const r = await consultasDoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), agora, app.db);
    expect(r.proximas.map((c) => [c.inicio.toISOString(), c.podeAlterar])).toEqual([
      [em('2026-10-05', '20:00').toISOString(), false],
      [em('2026-10-09', '09:00').toISOString(), true],
    ]);
    expect(r.anteriores.map((c) => c.inicio.toISOString())).toEqual([em('2026-09-30', '09:00').toISOString()]);
  });

  it('podeAgendar: some com 3 consultas futuras ativas (teto RN-16), volta com cancelada ou passada (T-1)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, ana.id);
    const agora = em('2026-10-05', '10:00');
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-09', '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-10', '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-09-30', '09:00')); // passada: não conta
    expect((await consultasDoPaciente(ctx, tenantAgenda(T), agora, app.db)).podeAgendar).toBe(true);
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-11', '09:00'));
    expect((await consultasDoPaciente(ctx, tenantAgenda(T), agora, app.db)).podeAgendar).toBe(false);
    // a consulta em andamento (inicio < agora < fim) não é "futura" para o teto
    const T2 = await novoTenant(app.db);
    const bia = await novoPaciente(app.db, T2.ctx);
    await consultaDireta(app.db, T2.ctx, bia.id, em('2026-10-05', '09:50'));
    await consultaDireta(app.db, T2.ctx, bia.id, em('2026-10-09', '09:00'));
    await consultaDireta(app.db, T2.ctx, bia.id, em('2026-10-10', '09:00'));
    expect((await consultasDoPaciente(ctxPaciente(T2.tenantId, bia.id), tenantAgenda(T2), agora, app.db)).podeAgendar).toBe(true);
  });

  it('consulta de outro paciente pelo id → null (RLS)', async () => {
    const T = await novoTenant(app.db);
    const [ana, bia] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const id = await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-09', '09:00'));
    expect(await consultaDoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), id, em('2026-10-05', '10:00'), app.db)).toBeNull();
  });

  it('horários da semana pedida, presos à janela de 12 h a 60 dias (RN-03)', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const r = await horariosDaSemana({ ...tenantAgenda(T) }, em('2026-10-05', '10:00'), '9999-12-31');
    expect(r.semana <= r.ultima).toBe(true);
    expect(r.horarios.length).toBeGreaterThan(0);
    expect(r.horarios.every((h) => Date.parse(h.inicio) >= em('2026-10-05', '22:00').getTime())).toBe(true);
  });
});
