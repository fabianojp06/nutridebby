import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { consents } from '@/db/schema';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { aceitarTermo, situacaoDoTermo, termoAceito } from './termo';

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
    expect(linhas[0]).toMatchObject({ termoVersao: TERMO_PACIENTE, ip: '203.0.113.7', patientId: null });
    expect(await termoAceito(userId, B.tenantId, app.db)).toBe(false);
  });

  it('P08-06: quem aceitou só a 0.1 provisória fica pendente na 1.0; o novo aceite grava a 1.0 e mantém a 0.1 como prova', async () => {
    const A = await novoTenant(app.db);
    const { userId } = await pacienteComConta(app.db, A, { semTermo: true });
    const antigo = new Date('2026-10-01T12:00:00Z');
    await app.db.insert(consents).values({ userId, tenantId: A.tenantId, termoVersao: 'termo-paciente-0.1-provisorio', aceitoEm: antigo, ip: '203.0.113.6' });
    expect(TERMO_PACIENTE).toBe('termo-paciente-1.0');
    expect(await termoAceito(userId, A.tenantId, app.db)).toBe(false);
    await aceitarTermo({ userId, tenantId: A.tenantId, ip: '203.0.113.7' }, app.db);
    expect(await termoAceito(userId, A.tenantId, app.db)).toBe(true);
    const linhas = await app.db.select().from(consents).where(and(eq(consents.userId, userId), eq(consents.tenantId, A.tenantId)));
    expect(linhas.map((l) => [l.termoVersao, l.ip]).sort()).toEqual([
      ['termo-paciente-0.1-provisorio', '203.0.113.6'],
      ['termo-paciente-1.0', '203.0.113.7'],
    ]);
    expect(linhas.find((l) => l.termoVersao === 'termo-paciente-0.1-provisorio')?.aceitoEm.toISOString()).toBe(antigo.toISOString());
  });

  it('P08-06: "o termo mudou" só para quem aceitou outra versão do termo neste consultório (nem primeiro acesso, nem DPA, nem outro consultório)', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const { userId } = await pacienteComConta(app.db, A, { semTermo: true });
    expect(await situacaoDoTermo(userId, A.tenantId, app.db)).toEqual({ aceito: false, anterior: false });
    await app.db.insert(consents).values({ userId, tenantId: A.tenantId, termoVersao: 'ia-aditivo-1.2', ip: null });
    await aceitarTermo({ userId, tenantId: A.tenantId, ip: null }, app.db);
    expect(await situacaoDoTermo(userId, A.tenantId, app.db)).toEqual({ aceito: true, anterior: false });
    await app.db.insert(consents).values({ userId, tenantId: B.tenantId, termoVersao: 'termo-paciente-0.1-provisorio', ip: null });
    expect(await situacaoDoTermo(userId, A.tenantId, app.db)).toEqual({ aceito: true, anterior: false });
    expect(await situacaoDoTermo(userId, B.tenantId, app.db)).toEqual({ aceito: false, anterior: true });
  });
});
