import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { accessEvents, consultations, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { metricasDeSucesso, MSG_METRICAS, salvarMetricasBase } from './metricas-sucesso';
import { metricasDeSucessoPorTenant } from './metricas';
import { ContaNaoEncontradaError } from './tenant-status';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const agora = new Date('2026-10-20T15:00:00Z'); // 12:00 em São Paulo

describe('CS-02 (D15): ativos com conta que abriram o app nos últimos 7 dias', () => {
  it('denominador só com conta e ativo; numerador pelos 7 dias no fuso; barras dos 7 dias', async () => {
    const T = await novoTenant(app.db);
    const a = (await pacienteComConta(app.db, T)).paciente;
    const b = (await pacienteComConta(app.db, T)).paciente;
    await pacienteComConta(app.db, T, { status: 'arquivado' }); // fora
    const semConta = await novoPaciente(app.db, T.ctx); // sem conta: fora (também das barras)
    await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values([
      { tenantId: T.tenantId, patientId: a.id, dia: '2026-10-20' },
      { tenantId: T.tenantId, patientId: semConta.id, dia: '2026-10-20' }, // fora do denominador → fora da barra
      { tenantId: T.tenantId, patientId: a.id, dia: '2026-10-14' },
      { tenantId: T.tenantId, patientId: b.id, dia: '2026-10-13' }, // 8 dias atrás: fora
    ]), app.db);
    const m = await metricasDeSucesso(T.ctx, { fuso: 'America/Sao_Paulo', goLiveEm: null, taxaFaltasBase: null }, agora, app.db);
    expect(m.cs02).toMatchObject({ comConta: 2, abriram: 1 });
    expect(m.cs02.porDia.map((d) => d.dia)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
    expect(m.cs02.porDia[0].n).toBe(1);
    expect(m.cs02.porDia[6].n).toBe(1);
  });
});

describe('CS-01 (D15): consultas realizadas com atendimento registrado desde o go-live', () => {
  it('conta só realizadas desde go_live_em; dias desde o início', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-30T13:00:00Z'), 60, { status: 'realizada' }); // antes do go-live: fora
    const com = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-10-05T13:00:00Z'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, p.id, new Date('2026-10-06T13:00:00Z'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, p.id, new Date('2026-10-07T13:00:00Z'), 60, { status: 'faltou' });
    await withTenant(T.ctx, (tx) => tx.insert(consultations).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: com, data: '2026-10-05' }), app.db);
    const m = await metricasDeSucesso(T.ctx, { fuso: 'America/Sao_Paulo', goLiveEm: '2026-10-01', taxaFaltasBase: 18.5 }, agora, app.db);
    expect(m.cs01).toEqual({ desde: '2026-10-01', dias: 20, realizadas: 2, comAtendimento: 1 });
    expect(m.cs03.base).toBe(18.5);
  });
  it('sem go_live_em: zeros e dias 0', async () => {
    const T = await novoTenant(app.db);
    const m = await metricasDeSucesso(T.ctx, { fuso: 'America/Sao_Paulo', goLiveEm: null, taxaFaltasBase: null }, agora, app.db);
    expect(m.cs01).toEqual({ desde: null, dias: 0, realizadas: 0, comAtendimento: 0 });
  });
});

describe('admin (D15): só contagens pela função SECURITY DEFINER', () => {
  it('admin_metricas_sucesso devolve o CS-02 e as faltas do mês por tenant, fora do withTenant', async () => {
    const T = await novoTenant(app.db);
    const a = (await pacienteComConta(app.db, T)).paciente;
    await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: a.id, dia: new Date().toISOString().slice(0, 10) }), app.db);
    const m = (await metricasDeSucessoPorTenant(app.db)).get(T.tenantId)!;
    expect(m).toMatchObject({ comConta: 1, abriram: 1 });
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`select * from admin_metricas_sucesso()`), app.db)).rejects.toThrow();
  });
  it('salvarMetricasBase: valida a taxa (0 a 100, vírgula) e a data', async () => {
    const T = await novoTenant(app.db);
    await salvarMetricasBase(T.tenantId, { taxaBase: '18,5', goLiveEm: '2026-10-01' }, app.db);
    const [t] = await app.db.select({ base: tenants.taxaFaltasBase, desde: tenants.goLiveEm }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t).toEqual({ base: 18.5, desde: '2026-10-01' });
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '120', goLiveEm: '' }, app.db)).rejects.toThrow(MSG_METRICAS.taxa);
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '', goLiveEm: '31/02/2026' }, app.db)).rejects.toThrow(MSG_METRICAS.data);
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '', goLiveEm: '2026-02-31' }, app.db)).rejects.toThrow(MSG_METRICAS.data);
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '-1', goLiveEm: '' }, app.db)).rejects.toThrow(MSG_METRICAS.taxa);
    for (const taxaBase of ['abc', '1e2', '0x10', '18,555', '100,01']) {
      await expect(salvarMetricasBase(T.tenantId, { taxaBase, goLiveEm: '' }, app.db), taxaBase).rejects.toThrow(MSG_METRICAS.taxa);
    }
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '', goLiveEm: '2026-13-01' }, app.db)).rejects.toThrow(MSG_METRICAS.data);
    // recusas não gravam nada; vazio apaga os dois
    expect((await app.db.select({ base: tenants.taxaFaltasBase }).from(tenants).where(eq(tenants.id, T.tenantId)))[0].base).toBe(18.5);
    await salvarMetricasBase(T.tenantId, { taxaBase: ' ', goLiveEm: '' }, app.db);
    const [vazio] = await app.db.select({ base: tenants.taxaFaltasBase, desde: tenants.goLiveEm }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(vazio).toEqual({ base: null, desde: null });
  });
  it('salvarMetricasBase: tenant inexistente → ContaNaoEncontradaError (M9)', async () => {
    await expect(salvarMetricasBase(randomUUID(), { taxaBase: '10', goLiveEm: '' }, app.db)).rejects.toBeInstanceOf(ContaNaoEncontradaError);
  });
});
