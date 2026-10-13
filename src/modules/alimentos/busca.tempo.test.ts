import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoTenant } from '../../../test/pacientes';
import { withTenant } from '@/db/tenant';
import { BUSCA_LIMITE, buscarAlimentos } from './busca';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

// Teste de tempo: no CI roda à parte, depois da suíte e sozinho (pnpm test:tempo, test/arquivos-de-tempo.ts)
describe('busca de alimentos (US-020, D6) — tempo', () => {
  it(`no máximo ${BUSCA_LIMITE} resultados e p95 ≤ 300 ms com 3000 alimentos próprios no tenant (RNF-01)`, async () => {
    const T = await novoTenant(app.db);
    await withTenant(
      T.ctx,
      (tx) =>
        tx.execute(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g)
                       select ${T.tenantId}, 'Produto ' || g || ' integral', 'Cereais e derivados', 100, 1, 1, 1, 1
                       from generate_series(1, 3000) g`),
      app.db,
    );
    const tempos: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = await buscarAlimentos(T.ctx, i % 2 ? 'integral' : 'feijao carioca', app.db);
      tempos.push(performance.now() - t0);
      expect(r.length).toBeLessThanOrEqual(BUSCA_LIMITE);
    }
    tempos.sort((a, b) => a - b);
    expect(tempos[Math.ceil(0.95 * tempos.length) - 1]).toBeLessThanOrEqual(300);
  });
});
