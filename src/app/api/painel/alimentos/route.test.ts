import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { apagarPublicos, inserirPublicos } from '../../../../../test/alimentos-publicos';
import { makeDb } from '../../../../../test/db';
import { nutriComDpa } from '../../../../../test/nutri';
import { GET } from './route';

vi.mock('server-only', () => ({})); // requireApiNutri (src/lib/tenant-session.ts)

const db = getDb();
const auth = getAuth();
const owner = makeDb(inject('ownerDatabaseUrl'));
let usda: string;
beforeAll(async () => {
  [usda] = await inserirPublicos(owner.pool, [{ nome: 'Lentilha vermelha, cozida', nomeOriginal: 'Lentils, pink or red, cooked', grupo: 'Leguminosas e derivados', kcal: null, micros: { ferro_mg: 2.4 } }]);
});
afterAll(async () => {
  await apagarPublicos(owner.pool, [usda]);
  await owner.pool.end();
  await closeDb();
});

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

  it('RN-230: o resultado leva a fonte, o selo, o nome original e os micros (o editor soma os micros do rascunho)', async () => {
    const A = await nutriComDpa(db, auth);
    const { resultados } = await (await pedir('lentils red cooked', A.cookie)).json();
    expect(resultados.find((x: { id: string }) => x.id === usda)).toMatchObject({
      nome: 'Lentilha vermelha, cozida', nomeOriginal: 'Lentils, pink or red, cooked', fonte: 'usda', origem: 'USDA (EUA)', micros: { ferro_mg: 2.4 }, porCem: { kcal: null },
    });
  });
});
