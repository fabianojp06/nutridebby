import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { makeDb } from '../../../test/db';
import { novoPostgres, uriDoPostgres } from '../../../test/postgres-teste';
import { runMigrations } from '@/db/migrate';
import { adminActions, iaNutriPausa } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { lerPausa, pausarIaNutri, retomarIaNutri } from './ia-nutri-pausa';

/**
 * Plano 15 (RN-185, DP-1, ★ DO-1 = não, ★ DO-5): a pausa é UMA linha para o banco inteiro, e os outros arquivos rodam em
 * paralelo no banco comum, que nunca é pausado (T1). Por isso este arquivo sobe um cluster próprio, montado como em
 * src/db/migrate-owner.test.ts (migrator dono do banco, sem superusuário; a aplicação com o nutri_app).
 */
let container: StartedPostgreSqlContainer;
let owner: Pool;
let app: ReturnType<typeof makeDb>;

beforeAll(async () => {
  container = await novoPostgres().start();
  const su = new Pool({ connectionString: uriDoPostgres(container), max: 1 });
  await su.query(`CREATE ROLE nutri_owner LOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOBYPASSRLS PASSWORD 'a'`);
  await su.query('CREATE DATABASE nutri OWNER nutri_owner');
  await su.end();
  const url = (usuario: string, senha: string) => {
    const u = new URL(uriDoPostgres(container));
    u.username = usuario;
    u.password = senha;
    u.pathname = '/nutri';
    return u.toString();
  };
  await runMigrations({ migratorUrl: url('nutri_owner', 'a'), appUrl: url('nutri_app', 'b') });
  owner = new Pool({ connectionString: url('nutri_owner', 'a'), max: 1 });
  app = makeDb(url('nutri_app', 'b'));
});

afterAll(async () => {
  await app?.pool.end();
  await owner?.end();
  await container?.stop();
});

const tenantId = randomUUID();
const CONTEXTOS: TenantContext[] = [
  { tenantId, role: 'nutri', actorUserId: randomUUID() },
  { tenantId, role: 'paciente', patientId: randomUUID(), actorUserId: randomUUID() },
  { tenantId, role: 'worker' },
];
const linha = async () => (await app.db.select().from(iaNutriPausa))[0];
const acoes = (admin: string) =>
  app.db
    .select({ acao: adminActions.acao, alvoTenantId: adminActions.alvoTenantId, origem: adminActions.origem })
    .from(adminActions)
    .where(eq(adminActions.adminUserId, admin));

describe('Plano 15 — pausa de emergência da IA Nutri na plataforma (RN-185)', () => {
  it('a linha nasce NÃO pausada (★ DO-1 = não): lerPausa → { pausadaEm: null }, fora e dentro de cada contexto', async () => {
    expect(await linha()).toMatchObject({ id: true, pausadaEm: null, pausadaPor: null });
    expect(await lerPausa(app.db)).toEqual({ pausadaEm: null });
    for (const ctx of CONTEXTOS) expect(await withTenant(ctx, (tx) => lerPausa(tx), app.db), ctx.role).toEqual({ pausadaEm: null });
  });

  it('pausar grava pausada_em e pausada_por; retomar volta os dois a nulo; cada um com a sua linha em admin_actions, sem alvo', async () => {
    const admin = randomUUID();
    const info = vi.spyOn(logger, 'info');
    const antes = Date.now();
    await pausarIaNutri(admin, app.db);
    const pausada = await linha();
    expect(pausada.pausadaPor).toBe(admin);
    expect(pausada.pausadaEm!.getTime()).toBeGreaterThanOrEqual(antes - 1_000);
    expect(await lerPausa(app.db)).toEqual({ pausadaEm: pausada.pausadaEm });
    for (const ctx of CONTEXTOS) expect(await withTenant(ctx, (tx) => lerPausa(tx), app.db), ctx.role).toEqual({ pausadaEm: pausada.pausadaEm });
    expect(await acoes(admin)).toEqual([{ acao: 'pausar_ia_nutri', alvoTenantId: null, origem: 'admin' }]);

    await retomarIaNutri(admin, app.db);
    expect(await linha()).toMatchObject({ pausadaEm: null, pausadaPor: null });
    expect(await lerPausa(app.db)).toEqual({ pausadaEm: null });
    expect((await acoes(admin)).map((a) => a.acao).sort()).toEqual(['pausar_ia_nutri', 'retomar_ia_nutri']);
    // log só com o id do admin (regra 3)
    const chamadas = info.mock.calls.filter(([, msg]) => typeof msg === 'string' && /IA Nutri/.test(msg));
    info.mockRestore();
    expect(chamadas.map(([dados]) => dados)).toEqual([{ adminId: admin }, { adminId: admin }]);
  });

  it('dentro de qualquer contexto de tenant o UPDATE da pausa é recusado (42501) e nada muda', async () => {
    for (const ctx of CONTEXTOS) {
      await expect(
        withTenant(ctx, (tx) => tx.update(iaNutriPausa).set({ pausadaEm: new Date() }).where(eq(iaNutriPausa.id, true)), app.db),
        ctx.role,
      ).rejects.toMatchObject({ code: '42501' });
    }
    expect(await lerPausa(app.db)).toEqual({ pausadaEm: null });
  });

  it('a aplicação não insere nem apaga a linha (só UPDATE pelo admin)', async () => {
    const negado = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === '42501';
    await expect(app.db.delete(iaNutriPausa)).rejects.toSatisfy(negado);
    await expect(app.db.insert(iaNutriPausa).values({ id: true }).onConflictDoNothing()).rejects.toSatisfy(negado);
    expect(await app.db.select().from(iaNutriPausa)).toHaveLength(1);
  });

  it('sem a linha (apagada pelo dono), lerPausa falha fechada: pausada', async () => {
    await owner.query('DELETE FROM ia_nutri_pausa');
    try {
      expect((await lerPausa(app.db)).pausadaEm).toBeInstanceOf(Date);
      expect((await withTenant(CONTEXTOS[1], (tx) => lerPausa(tx), app.db)).pausadaEm).toBeInstanceOf(Date);
    } finally {
      await owner.query('INSERT INTO ia_nutri_pausa (id, pausada_em, pausada_por) VALUES (true, NULL, NULL)');
    }
    expect(await lerPausa(app.db)).toEqual({ pausadaEm: null });
    // a linha volta a ser a única (CHECK da linha única)
    await expect(owner.query('INSERT INTO ia_nutri_pausa (id) VALUES (false)')).rejects.toMatchObject({ code: '23514' });
  });
});
