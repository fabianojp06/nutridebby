import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { cincoMilLancamentos } from '../../../test/financeiro';
import { novoTenant } from '../../../test/pacientes';
import { resumoDoMes } from './resumo';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

// Teste de tempo: no CI roda à parte, depois da suíte e sozinho (pnpm test:tempo, test/arquivos-de-tempo.ts)
describe('resumoDoMes (US-305) — tempo', () => {
  it('p95 < 800 ms com 5.000 lançamentos no ano (RNF-301)', { timeout: 180_000 }, async () => {
    const agora = new Date('2026-11-16T15:00:00Z');
    const T = await novoTenant(app.db);
    await cincoMilLancamentos(app.db, T, agora);
    const deps = { db: app.db, agora };
    await resumoDoMes(T.ctx, T.tenant, deps); // aquece a conexão e o plano
    const tempos: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = await resumoDoMes(T.ctx, T.tenant, deps);
      tempos.push(performance.now() - t0);
      expect(r.ultimos).toHaveLength(10);
    }
    tempos.sort((a, b) => a - b);
    expect(tempos[Math.ceil(0.95 * tempos.length) - 1]).toBeLessThan(800);
  });
});
