import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { idTaco } from '@/modules/alimentos/taco';
import { nutriComDpa } from '../../../../../../test/nutri';
import { GET } from './route';

vi.mock('server-only', () => ({})); // requireApiNutri (src/lib/tenant-session.ts)

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const ARROZ = idTaco(3);
const pedir = (params: Record<string, string>, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/alimentos/equivalentes?${new URLSearchParams(params)}`, { headers: cookie ? { cookie } : {} }));

describe('GET /api/painel/alimentos/equivalentes (RN-242, US-234)', () => {
  it('200 sem cache: por energia (padrão), com o critério, o aviso, a referência e a quantidade sugerida; sem sessão = 401', async () => {
    const A = await nutriComDpa(db, auth);
    const r = await pedir({ foodId: ARROZ, quantidadeG: '120' }, A.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = await r.json();
    expect(corpo).toMatchObject({
      criterio: 'Mesmo grupo (Cereais e derivados) · mesma energia · ordenados pela proximidade de proteína, carboidrato e lipídio.',
      aviso: 'Sugestão: confira antes de usar.',
      referencia: { nome: 'Arroz, tipo 1, cozido', quantidadeG: 120 },
    });
    expect(corpo.resultados.length).toBeGreaterThan(0);
    expect(corpo.resultados.every((x: { grupo: string; quantidadeG: number }) => x.grupo === 'Cereais e derivados' && Number.isInteger(x.quantidadeG))).toBe(true);
    expect((await pedir({ foodId: ARROZ, quantidadeG: '120' })).status).toBe(401);
  });

  it('`igualarPor` e `fonte`: carboidrato só da TACO', async () => {
    const A = await nutriComDpa(db, auth);
    const corpo = await (await GET(new Request(`http://localhost:3000/api/painel/alimentos/equivalentes?foodId=${ARROZ}&quantidadeG=120,5&igualarPor=carboidratoG&fonte=taco`, { headers: { cookie: A.cookie } }))).json();
    expect(corpo.criterio).toBe('Mesmo grupo (Cereais e derivados) · mesmo carboidrato · energia até ±10%.');
    expect(corpo.referencia.quantidadeG).toBe(120.5); // vírgula decimal (RNF-12)
    expect(corpo.resultados.every((x: { fonte: string }) => x.fonte === 'taco')).toBe(true);
  });

  it('400 com quantidade fora de 0,1 a 5000 g, critério ou fonte desconhecidos ou id malformado; 404 com alimento de outro consultório', async () => {
    const A = await nutriComDpa(db, auth);
    const B = await nutriComDpa(db, auth);
    for (const p of [
      { foodId: ARROZ, quantidadeG: '0' },
      { foodId: ARROZ, quantidadeG: '5001' },
      { foodId: ARROZ, quantidadeG: 'abc' },
      { foodId: ARROZ },
      { foodId: ARROZ, quantidadeG: '120', igualarPor: 'plutonio_mg' },
      { foodId: ARROZ, quantidadeG: '120', fonte: 'ibge' },
      { foodId: 'nao-e-uuid', quantidadeG: '120' },
    ] as Record<string, string>[]) {
      expect((await pedir(p, A.cookie)).status, JSON.stringify(p)).toBe(400);
    }
    const [deB] = await withTenant(
      B.ctx,
      (tx) => tx.execute<{ id: string }>(sql`insert into foods (tenant_id, nome, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g) values (${B.tenantId}, 'Macarrão de B', 'Cereais e derivados', 148, 3, 32, 0, 0) returning id`),
      db,
    ).then((x) => x.rows);
    expect((await pedir({ foodId: deB.id, quantidadeG: '100' }, A.cookie)).status).toBe(404);
    expect((await pedir({ foodId: randomUUID(), quantidadeG: '100' }, A.cookie)).status).toBe(404);
    expect((await pedir({ foodId: deB.id, quantidadeG: '100' }, B.cookie)).status).toBe(200);
  });
});
