import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { anthropometry, auditLog } from '@/db/schema';
import { TenantContextError, withTenant } from '@/db/tenant';
import { lerCabecalho, linhaDoCabecalho } from './cabecalho';

// Plano 18 (D13, RN-275): o cabeçalho da ficha com a última antropometria, formatada, e UMA leitura de `antropometria`.
const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

type Medidas = { data: string; pesoKg: number; alturaCm: number; percGordura?: number | null; createdAt?: Date };

async function avaliacao(T: TenantDeTeste, patientId: string, m: Medidas): Promise<string> {
  const [a] = await withTenant(
    T.ctx,
    (tx) =>
      tx
        .insert(anthropometry)
        .values({ tenantId: T.tenantId, patientId, data: m.data, pesoKg: m.pesoKg, alturaCm: m.alturaCm, percGordura: m.percGordura ?? null, ...(m.createdAt ? { createdAt: m.createdAt } : {}) })
        .returning({ id: anthropometry.id }),
    app.db,
  );
  return a.id;
}

const leituras = (T: TenantDeTeste, patientId: string) =>
  withTenant(
    T.ctx,
    (tx) =>
      tx
        .select({ entidade: auditLog.entidade, entidadeId: auditLog.entidadeId })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, T.tenantId), eq(auditLog.patientId, patientId), eq(auditLog.acao, 'ler'))),
    app.db,
  );

describe('lerCabecalho e linhaDoCabecalho (RN-275)', () => {
  it('formato: altura em metros com duas casas, peso, IMC e gordura com uma, data dd/mm/aaaa', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await avaliacao(T, p.id, { data: '2026-10-12', pesoKg: 72.4, alturaCm: 165, percGordura: 28.1 });
    const c = await lerCabecalho(T.ctx, p.id, { db: app.db });
    expect(c).toEqual({ data: '12/10/2026', alturaM: '1,65', pesoKg: '72,4', imc: '26,6', gordura: '28,1' });
    expect(linhaDoCabecalho(c)).toBe('Última avaliação em 12/10/2026: altura 1,65 m · peso 72,4 kg · IMC 26,6 · gordura 28,1%');
  });

  it('a última pela data e, no empate, pela criação', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await avaliacao(T, p.id, { data: '2026-10-01', pesoKg: 80, alturaCm: 170 });
    await avaliacao(T, p.id, { data: '2026-10-12', pesoKg: 75, alturaCm: 170, createdAt: new Date('2026-10-12T12:00:00Z') });
    await avaliacao(T, p.id, { data: '2026-10-12', pesoKg: 74, alturaCm: 170, createdAt: new Date('2026-10-12T15:00:00Z') });
    await avaliacao(T, p.id, { data: '2026-09-30', pesoKg: 90, alturaCm: 170, createdAt: new Date('2026-11-01T12:00:00Z') });
    expect((await lerCabecalho(T.ctx, p.id, { db: app.db }))?.pesoKg).toBe('74,0');
  });

  it('empate de data e de criação: desempata pelo id (o maior), sempre a mesma', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const quando = new Date('2026-10-12T12:00:00Z');
    const ids = [
      { id: await avaliacao(T, p.id, { data: '2026-10-12', pesoKg: 70, alturaCm: 170, createdAt: quando }), peso: '70,0' },
      { id: await avaliacao(T, p.id, { data: '2026-10-12', pesoKg: 71, alturaCm: 170, createdAt: quando }), peso: '71,0' },
      { id: await avaliacao(T, p.id, { data: '2026-10-12', pesoKg: 72, alturaCm: 170, createdAt: quando }), peso: '72,0' },
    ];
    const maior = ids.reduce((a, b) => (b.id > a.id ? b : a));
    expect((await lerCabecalho(T.ctx, p.id, { db: app.db }))?.pesoKg).toBe(maior.peso);
    expect(await leituras(T, p.id)).toEqual([{ entidade: 'antropometria', entidadeId: maior.id }]);
  });

  it('sem gordura: a linha não tem o trecho "gordura"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await avaliacao(T, p.id, { data: '2026-10-12', pesoKg: 72.4, alturaCm: 165 });
    const c = await lerCabecalho(T.ctx, p.id, { db: app.db });
    expect(c?.gordura).toBeNull();
    const linha = linhaDoCabecalho(c);
    expect(linha).toBe('Última avaliação em 12/10/2026: altura 1,65 m · peso 72,4 kg · IMC 26,6');
    expect(linha).not.toContain('gordura');
  });

  it('sem avaliação: null, "Sem avaliação antropométrica." e nenhuma leitura gravada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const c = await lerCabecalho(T.ctx, p.id, { db: app.db });
    expect(c).toBeNull();
    expect(linhaDoCabecalho(c)).toBe('Sem avaliação antropométrica.');
    expect(await leituras(T, p.id)).toEqual([]);
  });

  it('uma leitura: com avaliação, exatamente uma linha "ler" de antropometria, com o id da avaliação', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await avaliacao(T, p.id, { data: '2026-10-01', pesoKg: 80, alturaCm: 170 });
    const ultima = await avaliacao(T, p.id, { data: '2026-10-12', pesoKg: 72.4, alturaCm: 165 });
    await lerCabecalho(T.ctx, p.id, { db: app.db });
    expect(await leituras(T, p.id)).toEqual([{ entidade: 'antropometria', entidadeId: ultima }]);
  });

  it('outro tenant: null e nenhuma leitura', async () => {
    const A = await novoTenant(app.db);
    const B = await novoTenant(app.db);
    const pb = await novoPaciente(app.db, B.ctx);
    await avaliacao(B, pb.id, { data: '2026-10-12', pesoKg: 72.4, alturaCm: 165 });
    expect(await lerCabecalho(A.ctx, pb.id, { db: app.db })).toBeNull();
    expect(await leituras(A, pb.id)).toEqual([]);
    expect(await leituras(B, pb.id)).toEqual([]);
  });

  it('papel: só a sessão da nutricionista (paciente e worker recusados, sem leitura gravada)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await avaliacao(T, p.id, { data: '2026-10-12', pesoKg: 72.4, alturaCm: 165 });
    const SO_DA_NUTRI = 'o cabeçalho da ficha é só da sessão da nutricionista';
    await expect(lerCabecalho(ctxPaciente(T.tenantId, p.id), p.id, { db: app.db })).rejects.toThrow(TenantContextError);
    await expect(lerCabecalho(ctxPaciente(T.tenantId, p.id), p.id, { db: app.db })).rejects.toThrow(SO_DA_NUTRI);
    await expect(lerCabecalho({ tenantId: T.tenantId, role: 'worker' }, p.id, { db: app.db })).rejects.toThrow(TenantContextError);
    expect(await leituras(T, p.id)).toEqual([]);
  });

  it('id malformado: null, sem consultar', async () => {
    const T = await novoTenant(app.db);
    expect(await lerCabecalho(T.ctx, 'nao-e-uuid', { db: app.db })).toBeNull();
  });
});
