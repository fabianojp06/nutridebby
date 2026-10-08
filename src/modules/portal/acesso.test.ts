import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { accessEvents } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { jaUsavaOApp, limparAcessosAntigos, registrarAcesso } from './acesso';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('acesso diário (CS-02, D9)', () => {
  it('no máximo uma linha por dia no fuso do tenant: 23:30 de Brasília ainda é o mesmo dia; 00:10 é o seguinte', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, p.id);
    const sp = 'America/Sao_Paulo';
    expect(await registrarAcesso(ctx, sp, { db: app.db, agora: new Date('2026-10-05T12:00:00Z') })).toBe(true);
    expect(await registrarAcesso(ctx, sp, { db: app.db, agora: new Date('2026-10-06T02:30:00Z') })).toBe(false); // 23:30 do dia 5
    expect(await registrarAcesso(ctx, sp, { db: app.db, agora: new Date('2026-10-06T03:10:00Z') })).toBe(true); // 00:10 do dia 6
    const dias = await withTenant(T.ctx, (tx) => tx.select({ dia: accessEvents.dia }).from(accessEvents).where(eq(accessEvents.patientId, p.id)), app.db);
    expect(dias.map((d) => d.dia).sort()).toEqual(['2026-10-05', '2026-10-06']);
  });

  it('só em sessão de paciente (a nutricionista não registra acesso)', async () => {
    const T = await novoTenant(app.db);
    await expect(registrarAcesso(T.ctx, 'America/Sao_Paulo', { db: app.db })).rejects.toThrow(/sessão de paciente/);
  });
});

describe('retenção de access_events (D13)', () => {
  it('apaga só o que tem mais de 400 dias no fuso do tenant (o dia 400 fica)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const agora = new Date('2026-10-20T15:00:00Z');
    const hoje = hojeNoFuso(T.tenant.fuso, agora);
    await withTenant(
      T.ctx,
      (tx) =>
        tx.insert(accessEvents).values([
          { tenantId: T.tenantId, patientId: p.id, dia: somarDias(hoje, -401) },
          { tenantId: T.tenantId, patientId: p.id, dia: somarDias(hoje, -400) },
          { tenantId: T.tenantId, patientId: p.id, dia: somarDias(hoje, -399) },
        ]),
      app.db,
    );
    expect(await limparAcessosAntigos(app.db, agora)).toBeGreaterThanOrEqual(1);
    const dias = await withTenant(T.ctx, (tx) => tx.select({ dia: accessEvents.dia }).from(accessEvents).where(eq(accessEvents.patientId, p.id)), app.db);
    expect(dias.map((d) => d.dia).sort()).toEqual([somarDias(hoje, -400), somarDias(hoje, -399)]);
  });
});

describe('jaUsavaOApp (Plano 16, G-D17 = a: boas-vindas ou "O app mudou")', () => {
  it('acesso antes de hoje: true; só hoje: false; acesso de outro paciente não conta (RLS do paciente)', async () => {
    const T = await novoTenant(app.db);
    const [a, b] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const hoje = '2026-10-08';
    const ctxA = ctxPaciente(T.tenantId, a.id);
    expect(await jaUsavaOApp(ctxA, hoje, app.db)).toBe(false); // nenhum acesso
    await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: a.id, dia: hoje }), app.db);
    expect(await jaUsavaOApp(ctxA, hoje, app.db)).toBe(false); // só hoje: primeira vez no app
    await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: b.id, dia: somarDias(hoje, -1) }), app.db);
    expect(await jaUsavaOApp(ctxA, hoje, app.db)).toBe(false); // o acesso de ontem é do outro paciente
    expect(await jaUsavaOApp(ctxPaciente(T.tenantId, b.id), hoje, app.db)).toBe(true);
    await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: a.id, dia: somarDias(hoje, -1) }), app.db);
    expect(await jaUsavaOApp(ctxA, hoje, app.db)).toBe(true); // ontem
  });

  it('só em sessão de paciente', async () => {
    const T = await novoTenant(app.db);
    await expect(jaUsavaOApp(T.ctx, '2026-10-08', app.db)).rejects.toThrow(/sessão de paciente/);
  });
});
