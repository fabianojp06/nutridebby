import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { conexaoDeTeste } from '../../../../../../test/whatsapp';
import { nutriComDpa } from '../../../../../../test/nutri';
import { GET } from './route';

vi.mock('server-only', () => ({})); // requireApiNutri (src/lib/tenant-session.ts)
const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());
const pedir = (cookie?: string) => GET(new Request('http://localhost:3000/api/painel/whatsapp/estado', { headers: cookie ? { cookie } : {} }));

describe('GET /api/painel/whatsapp/estado', () => {
  it('estado e número da conexão do próprio tenant, sem cache; sem sessão = 401', async () => {
    const A = await nutriComDpa(db, auth);
    expect(await (await pedir(A.cookie)).json()).toEqual({ estado: 'desconectada', numero: null });
    await conexaoDeTeste(db, A.ctx, 'conectada');
    const r = await pedir(A.cookie);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ estado: 'conectada', numero: '+5511900001111' });
    expect((await pedir()).status).toBe(401);
  });
});
