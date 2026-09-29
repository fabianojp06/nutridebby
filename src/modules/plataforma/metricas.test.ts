import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { ajustarCotaWhatsapp, CotaWhatsappError, metricasPorTenant } from './metricas';
import { ContaNaoEncontradaError } from './tenant-status';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

async function tenantComArquivos(n: number, bytes: number) {
  const [t] = await app.db.insert(tenants).values({ slug: `met-${randomUUID().slice(0, 8)}`, nomeExibicao: 'M', armazenamentoBytes: bytes }).returning();
  for (let i = 0; i < n; i++) {
    await withTenant({ tenantId: t.id, role: 'nutri' }, (tx) =>
      tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values (${t.id}, 'logo', ${`${t.id}/logo/${randomUUID()}.png`}, 10, 'image/png')`), app.db);
  }
  return t.id;
}

describe('metricasPorTenant (§3: só contagens)', () => {
  it('conta arquivos e armazenamento de cada tenant; pacientes/consultas/mensagens ainda nulos', async () => {
    const a = await tenantComArquivos(3, 30);
    const b = await tenantComArquivos(1, 10);
    const m = await metricasPorTenant(app.db);
    expect(m.get(a)).toEqual({ tenantId: a, arquivos: 3, armazenamentoBytes: 30, pacientesAtivos: null, consultasMes: null, mensagensWhatsappMes: null });
    expect(m.get(b)?.arquivos).toBe(1);
  });

  it('dentro de withTenant é recusada (apagaria o contexto app.* da transação do tenant) (M13)', async () => {
    const t = await tenantComArquivos(0, 0);
    await expect(
      withTenant({ tenantId: t, role: 'nutri' }, (tx) => tx.execute(sql`select * from admin_tenant_metrics()`), app.db),
    ).rejects.toSatisfy((e: unknown) => /withTenant/.test(String((e as { cause?: unknown }).cause ?? e)));
    // e fora dele, na mesma conexão/sessão já usada por um withTenant, segue funcionando
    await expect(metricasPorTenant(app.db)).resolves.toBeInstanceOf(Map);
  });

  it('EXECUTE revogado de PUBLIC; só o role da aplicação executa (M14)', async () => {
    const { rows } = await app.pool.query<{ publico: boolean; app: boolean }>(`
      select exists (
               select 1 from pg_proc p
                 cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.proname = 'admin_tenant_metrics' and a.grantee = 0 and a.privilege_type = 'EXECUTE'
             ) as publico,
             has_function_privilege('nutri_app_role', 'admin_tenant_metrics()', 'EXECUTE') as app`);
    expect(rows[0]).toEqual({ publico: false, app: true });
  });
});

describe('ajustarCotaWhatsapp', () => {
  it('grava inteiro de 0 a 100000 e recusa o resto', async () => {
    const t = await tenantComArquivos(0, 0);
    await ajustarCotaWhatsapp(t, ' 800 ', randomUUID(), app.db);
    expect((await app.db.select().from(tenants).where(eq(tenants.id, t)))[0].waCotaMensal).toBe(800);
    for (const v of ['', '-1', '12.5', 'abc', '100001']) {
      await expect(ajustarCotaWhatsapp(t, v, randomUUID(), app.db)).rejects.toBeInstanceOf(CotaWhatsappError);
    }
    expect((await app.db.select().from(tenants).where(eq(tenants.id, t)))[0].waCotaMensal).toBe(800);
  });

  it('tenant inexistente → ContaNaoEncontradaError (M9)', async () => {
    await expect(ajustarCotaWhatsapp(randomUUID(), '10', randomUUID(), app.db)).rejects.toBeInstanceOf(ContaNaoEncontradaError);
  });
});
