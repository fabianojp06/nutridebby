import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente } from '../../../test/pacientes';
import { auditLog, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { auditRead, HISTORICO_POR_PAGINA, listAccessHistory, recordAudit } from './audit';

const app = makeDb(inject('appDatabaseUrl'));
let A: string;
let B: string;
let nutriId: string;
const P1 = randomUUID();
const P3 = randomUUID();

beforeAll(async () => {
  const [a, b] = await app.db
    .insert(tenants)
    .values([
      { slug: `aud-a-${randomUUID().slice(0, 8)}`, nomeExibicao: 'A' },
      { slug: `aud-b-${randomUUID().slice(0, 8)}`, nomeExibicao: 'B' },
    ])
    .returning({ id: tenants.id });
  A = a.id;
  B = b.id;
  nutriId = randomUUID();
  await app.db.insert(user).values({ id: nutriId, name: 'Debby Silva', email: `aud-${nutriId.slice(0, 8)}@teste.dev`, appRole: 'nutri', tenantId: A });
});
afterAll(() => app.pool.end());

const ctxA = (): TenantContext => ({ tenantId: A, role: 'nutri', actorUserId: nutriId, ip: '203.0.113.10' });
const logDe = (entidadeId: string) =>
  withTenant(ctxA(), (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, entidadeId)).orderBy(auditLog.criadoEm), app.db);

describe('auditoria automática (RNF-08, US-007)', () => {
  it('criar, alterar e excluir numa tabela de saúde viram linhas com ator, IP, paciente — sem o conteúdo', async () => {
    const id = await withTenant(ctxA(), async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${A}, ${P1}, 'peso 70 kg') returning id`);
      const novo = r.rows[0].id;
      await tx.execute(sql`update audit_fixture_registros set texto = 'peso 71 kg' where id = ${novo}`);
      await tx.execute(sql`delete from audit_fixture_registros where id = ${novo}`);
      return novo;
    }, app.db);
    const log = await logDe(id);
    expect(log.map((l) => l.acao)).toEqual(['criar', 'alterar', 'excluir']);
    for (const l of log) {
      expect(l).toMatchObject({ tenantId: A, actorUserId: nutriId, ip: '203.0.113.10', patientId: P1, entidade: 'registros_teste' });
    }
    expect(JSON.stringify(log)).not.toContain('peso');
  });

  it('auditRead grava a leitura na mesma transação', async () => {
    await withTenant(ctxA(), (tx) => auditRead(tx, { entidade: 'patients', entidadeId: P1, patientId: P1 }), app.db);
    const log = await logDe(P1);
    expect(log.at(-1)).toMatchObject({ acao: 'ler', entidade: 'patients', patientId: P1, actorUserId: nutriId });
  });

  it('escrita feita por job do worker fica sem ator (Sistema)', async () => {
    const id = await withTenant({ tenantId: A, role: 'worker' }, async (tx) =>
      (await tx.execute<{ id: string }>(sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${A}, ${P1}, 'x') returning id`)).rows[0].id, app.db);
    expect((await logDe(id))[0]).toMatchObject({ acao: 'criar', actorUserId: null, ip: null });
  });

  it('sem contexto de tenant não há como auditar (e a escrita auditada falha junto)', async () => {
    await expect(app.db.transaction((tx) => recordAudit(tx, { acao: 'ler', entidade: 'patients', entidadeId: P1, patientId: P1 }))).rejects.toThrow();
  });

  it('paciente grava o próprio registro e não lê o audit_log (B-6, 0085)', async () => {
    const P2 = randomUUID();
    await withTenant(ctxA(), (tx) => recordAudit(tx, { acao: 'ler', entidade: 'patients', entidadeId: P2, patientId: P2 }), app.db);

    // D1 (Plano 06): a sessão de paciente só grava o que PACIENTE_ESCREVE libera — aqui o próprio cadastro (patients,
    // update, auditado), não a tabela de exemplo (paciente_sem_insert). O gatilho roda com o papel do paciente.
    const pac = await novoPaciente(app.db, ctxA());
    const ctxP = { tenantId: A, role: 'paciente' as const, patientId: pac.id, actorUserId: randomUUID() };
    await withTenant(ctxP, (tx) => tx.execute(sql`update patients set nome = nome where id = ${pac.id}`), app.db);
    const gravado = await withTenant(ctxA(), (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, pac.id)), app.db);
    expect(gravado.some((l) => l.acao === 'alterar' && l.patientId === pac.id && l.actorUserId === ctxP.actorUserId)).toBe(true);
    // B-6: paciente_sem_leitura (RESTRICTIVE FOR SELECT) — nem as próprias linhas (IP e ator da equipe), nem as de P2
    expect(await withTenant(ctxP, (tx) => tx.select().from(auditLog), app.db)).toEqual([]);

    // WITH CHECK: a sessão do paciente não consegue gravar uma linha de auditoria em nome de P2.
    await expect(
      withTenant(ctxP, (tx) => recordAudit(tx, { acao: 'ler', entidade: 'patients', entidadeId: P2, patientId: P2 }), app.db),
    ).rejects.toThrow();
  });
});

describe('listAccessHistory ("Histórico de acessos", 50 por página, mais recente primeiro)', () => {
  beforeAll(async () => {
    await withTenant(ctxA(), (tx) =>
      recordAudit(tx, Array.from({ length: 120 }, () => ({ acao: 'ler' as const, entidade: 'patients', entidadeId: P3, patientId: P3 }))), app.db);
  });

  it('pagina em 50, em ordem decrescente, com o nome de quem acessou', async () => {
    const p1 = await listAccessHistory(ctxA(), P3, 1, app.db);
    expect(p1).toMatchObject({ pagina: 1, totalPaginas: 3, total: 120 });
    expect(p1.itens).toHaveLength(HISTORICO_POR_PAGINA);
    for (let i = 1; i < p1.itens.length; i++) {
      expect(p1.itens[i - 1].criadoEm.getTime()).toBeGreaterThanOrEqual(p1.itens[i].criadoEm.getTime());
    }
    expect(p1.itens[0].ator).toEqual({ nome: 'Debby Silva', papel: 'nutri' });
    expect((await listAccessHistory(ctxA(), P3, 3, app.db)).itens).toHaveLength(20);
  });

  it('página fora da faixa é ajustada', async () => {
    expect((await listAccessHistory(ctxA(), P3, 99, app.db)).pagina).toBe(3);
    expect((await listAccessHistory(ctxA(), P3, 0, app.db)).pagina).toBe(1);
  });

  it('patientId que não é UUID (vindo da URL) devolve histórico vazio, não erro 500 (M6)', async () => {
    for (const id of ['abc', '', "1' or '1'='1", `${P3}x`]) {
      await expect(listAccessHistory(ctxA(), id, 1, app.db)).resolves.toEqual({ itens: [], pagina: 1, totalPaginas: 1, total: 0 });
    }
  });

  it('id válido no Postgres mas sem versão RFC (00000000-…-0001) lista o histórico normalmente (G5)', async () => {
    const semVersao = '00000000-0000-0000-0000-000000000001';
    await withTenant(ctxA(), (tx) => recordAudit(tx, { acao: 'ler', entidade: 'patients', entidadeId: semVersao, patientId: semVersao }), app.db);
    const h = await listAccessHistory(ctxA(), semVersao, 1, app.db);
    expect(h.total).toBe(1);
    expect(h.itens[0]).toMatchObject({ acao: 'ler', entidadeId: semVersao });
  });

  it('outro tenant não vê o histórico', async () => {
    expect((await listAccessHistory({ tenantId: B, role: 'nutri', actorUserId: randomUUID() }, P3, 1, app.db)).total).toBe(0);
  });
});
