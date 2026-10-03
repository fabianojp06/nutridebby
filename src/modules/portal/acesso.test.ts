import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { accessEvents } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { registrarAcesso } from './acesso';

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
