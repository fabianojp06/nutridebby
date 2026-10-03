import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { consents } from '@/db/schema';
import { aceitarTermo, termoAceito } from './termo';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('termo do paciente por consultório', () => {
  it('sem aceite da versão atual → pendente; aceitar grava uma vez (repetir não duplica) e só vale para aquele consultório', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { userId } = await pacienteComConta(app.db, A, { semTermo: true });
    expect(await termoAceito(userId, A.tenantId, app.db)).toBe(false);
    await aceitarTermo({ userId, tenantId: A.tenantId, ip: '203.0.113.7' }, app.db);
    await aceitarTermo({ userId, tenantId: A.tenantId, ip: '203.0.113.7' }, app.db);
    expect(await termoAceito(userId, A.tenantId, app.db)).toBe(true);
    const linhas = await app.db.select().from(consents).where(and(eq(consents.userId, userId), eq(consents.tenantId, A.tenantId)));
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ termoVersao: 'termo-paciente-0.1-provisorio', ip: '203.0.113.7', patientId: null });
    expect(await termoAceito(userId, B.tenantId, app.db)).toBe(false);
  });
});
