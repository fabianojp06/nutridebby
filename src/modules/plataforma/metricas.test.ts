import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { ajustarCotaWhatsapp, CotaWhatsappError, metricasPorTenant } from './metricas';

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
});
