import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { definirRecebimentoDeExames } from './recebimento-exames';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const ligadoEm = async (tenantId: string) => (await app.db.select({ em: tenants.examesPacienteAtivadoEm }).from(tenants).where(eq(tenants.id, tenantId)))[0].em;

describe('D18 = a: recebimento de exames pelo app (Configurações)', () => {
  it('a nutricionista liga (guarda a primeira data), liga de novo sem mudar a data e desliga', async () => {
    const T = await novoTenant(app.db);
    await definirRecebimentoDeExames(T.ctx, true, { db: app.db, agora: new Date('2026-10-07T12:00:00Z') });
    await definirRecebimentoDeExames(T.ctx, true, { db: app.db, agora: new Date('2026-10-08T12:00:00Z') });
    expect(await ligadoEm(T.tenantId)).toEqual(new Date('2026-10-07T12:00:00Z'));
    await definirRecebimentoDeExames(T.ctx, false, { db: app.db });
    expect(await ligadoEm(T.tenantId)).toBeNull();
  });

  it('só a nutricionista muda (a sessão de paciente e o worker não)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await expect(definirRecebimentoDeExames(ctxPaciente(T.tenantId, p.id, randomUUID()), true, { db: app.db })).rejects.toThrow();
    await expect(definirRecebimentoDeExames({ tenantId: T.tenantId, role: 'worker' }, true, { db: app.db })).rejects.toThrow();
    expect(await ligadoEm(T.tenantId)).toBeNull();
  });
});
