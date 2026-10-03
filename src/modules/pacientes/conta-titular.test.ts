import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { entrar } from '../../../test/sessao';
import { closeDb } from '@/db/client';
import { account, patients, session, twoFactor, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { anonimizarContaSemVinculo, contaSemOutroVinculo } from './conta-titular';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
});
const now = new Date('2026-10-05T12:00:00Z');
const recusada = (e: unknown) => ((e as { cause?: unknown }).cause ?? e as { code?: string }) as { code?: string };

describe('conta do titular na anonimização (P06-08, D18)', () => {
  it('sem sessões, senha nem 2FA; nome e e-mail anônimos; o login com a senha antiga é recusado', async () => {
    const T = await novoTenant(app.db);
    const { userId, email } = await pacienteComConta(app.db, T);
    await entrar(getAuth(), email);
    await entrar(getAuth(), email);
    expect(await app.db.select().from(session).where(eq(session.userId, userId))).toHaveLength(2);
    await app.db.insert(twoFactor).values({ secret: 'segredo', backupCodes: 'codigos', userId });
    await app.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, userId));

    await app.db.transaction((tx) => anonimizarContaSemVinculo(tx, userId, now));

    expect(await app.db.select().from(session).where(eq(session.userId, userId))).toEqual([]);
    expect(await app.db.select().from(account).where(eq(account.userId, userId))).toEqual([]);
    expect(await app.db.select().from(twoFactor).where(eq(twoFactor.userId, userId))).toEqual([]);
    const [u] = await app.db.select().from(user).where(eq(user.id, userId));
    expect(u).toMatchObject({ name: 'Paciente anonimizado', email: `anonimo-${userId}@anonimizado.invalid`, emailVerified: false, twoFactorEnabled: false });
    await expect(entrar(getAuth(), email)).rejects.toThrow('login falhou');
    await expect(entrar(getAuth(), u.email)).rejects.toThrow('login falhou');
  });

  it('contaSemOutroVinculo: só no contexto worker; conta com outro prontuário não anonimizado (qualquer status, outro tenant) não está sozinha', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const a = await pacienteComConta(app.db, A);
    const worker = { tenantId: A.tenantId, role: 'worker' as const };
    // o prontuário de A já soltou a conta (como o UPDATE da anonimização): sem outro vínculo
    await withTenant(A.ctx, (tx) => tx.update(patients).set({ userId: null }).where(eq(patients.id, a.paciente.id)), app.db);
    expect(await withTenant(worker, (tx) => contaSemOutroVinculo(tx, a.userId), app.db)).toBe(true);
    const b = await pacienteComConta(app.db, B, { userId: a.userId });
    await withTenant(B.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, b.paciente.id)), app.db);
    expect(await withTenant(worker, (tx) => contaSemOutroVinculo(tx, a.userId), app.db)).toBe(false);
    // o contexto do chamador volta depois da conferência (a auditoria e a RLS seguem do worker de A)
    const ctxDepois = await withTenant(worker, async (tx) => {
      await contaSemOutroVinculo(tx, a.userId);
      return (await tx.execute<{ t: string | null; r: string | null }>(sql`select app_current_tenant()::text as t, app_current_role() as r`)).rows[0];
    }, app.db);
    expect(ctxDepois).toEqual({ t: A.tenantId, r: 'worker' });
    for (const ctx of [A.ctx, { tenantId: A.tenantId, role: 'paciente' as const, patientId: a.paciente.id }]) {
      await expect(withTenant(ctx, (tx) => contaSemOutroVinculo(tx, randomUUID()), app.db)).rejects.toSatisfy((e) => recusada(e).code === '42501');
    }
  });
});
