import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { nutriComDpa } from '../../../../../test/nutri';
import { GET } from './route';

vi.mock('server-only', () => ({})); // requireApiNutri (src/lib/tenant-session.ts)

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const pedir = (q: string | null, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/alimentos${q === null ? '' : `?q=${encodeURIComponent(q)}`}`, { headers: cookie ? { cookie } : {} }));

describe('GET /api/painel/alimentos (US-020)', () => {
  it('200 com resultados e sem cache; sem termo = lista vazia; sem sessão = 401', async () => {
    const A = await nutriComDpa(db, auth);
    const r = await pedir('feijao carioca', A.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const { resultados } = await r.json();
    expect(resultados.map((x: { nome: string }) => x.nome)).toContain('Feijão, carioca, cozido');
    expect(await (await pedir(null, A.cookie)).json()).toEqual({ resultados: [] });
    expect((await pedir('feijao')).status).toBe(401);
  });
});
