import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { accessEvents, diaryEntries } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { contarDiariosNaoVistos } from '@/modules/portal/diario-nutri';
import { resumoDoDia } from './inicio';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const fuso = 'America/Sao_Paulo';
const agora = new Date('2026-10-20T15:00:00Z'); // 12:00 em São Paulo
const as = (h: number) => new Date(Date.UTC(2026, 9, 20, h + 3, 0)); // hora local → UTC

describe('Início em bento (D22)', () => {
  it('próxima consulta: a primeira de hoje que ainda não terminou; nº da consulta; diário e portal em 7 dias (só contagens)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-20T13:00:00Z'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, bia.id, as(9), 60, { status: 'confirmada' }); // já terminou
    await consultaDireta(app.db, T.ctx, ana.id, as(15), 60, { status: 'confirmada' });
    await consultaDireta(app.db, T.ctx, bia.id, as(17), 60, { pedidoRemarcacaoEm: agora });
    await withTenant(T.ctx, async (tx) => {
      await tx.insert(diaryEntries).values([
        { tenantId: T.tenantId, patientId: ana.id, refeicao: 'Almoço', texto: 'arroz', dataHora: new Date('2026-10-18T15:00:00Z') },
        { tenantId: T.tenantId, patientId: ana.id, refeicao: 'Jantar', texto: 'sopa', dataHora: new Date('2026-10-01T22:00:00Z') }, // fora dos 7 dias
      ]);
      await tx.insert(accessEvents).values([
        { tenantId: T.tenantId, patientId: ana.id, dia: '2026-10-19' },
        { tenantId: T.tenantId, patientId: ana.id, dia: '2026-10-20' },
      ]);
    }, app.db);
    const r = await resumoDoDia(T.ctx, fuso, agora, app.db);
    expect(r.proxima?.consulta.patientId).toBe(ana.id);
    expect(r.proxima).toMatchObject({ numero: 2, diario7d: 1, portal7d: 2 });
    expect(r.hoje).toEqual({ total: 3, confirmadas: 2, pedidosRemarcacao: 1 });
    expect(r.agenda.map((c) => c.inicio.toISOString())).toEqual([as(9), as(15), as(17)].map((d) => d.toISOString()));
    expect(await contarDiariosNaoVistos(T.ctx, app.db)).toBe(2);
  });
  it('cancelada fica fora da agenda, dos totais e do nº da consulta; realizada ou falta de hoje não é a próxima', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-20T13:00:00Z'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora });
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-27T13:00:00Z'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, bia.id, as(13), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora }); // ainda vai começar, mas cancelada
    await consultaDireta(app.db, T.ctx, bia.id, as(11), 120, { status: 'faltou' }); // termina às 13h, mas já tem desfecho
    await consultaDireta(app.db, T.ctx, ana.id, as(14), 60);
    const r = await resumoDoDia(T.ctx, fuso, agora, app.db);
    expect(r.agenda.map((c) => c.inicio.toISOString())).toEqual([as(11), as(14)].map((d) => d.toISOString()));
    expect(r.hoje).toEqual({ total: 2, confirmadas: 0, pedidosRemarcacao: 0 });
    expect(r.proxima).toMatchObject({ consulta: { patientId: ana.id }, numero: 2, diario7d: 0, portal7d: 0 });
  });
  it('sem consulta hoje: proxima null e totais zerados', async () => {
    const T = await novoTenant(app.db);
    expect(await resumoDoDia(T.ctx, fuso, agora, app.db)).toEqual({ proxima: null, hoje: { total: 0, confirmadas: 0, pedidosRemarcacao: 0 }, agenda: [] });
  });
});
