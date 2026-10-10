import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { geracaoNoBanco } from '../../../../../../../test/ia';
import { nutriComDpa } from '../../../../../../../test/nutri';
import { GET } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const get = (id: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/ia/geracoes/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

describe('GET /api/painel/ia/geracoes/[id] — só a situação do pacote, sem auditoria (US-123, RNF-100)', () => {
  it('200 com { status, erro } e no-store; outro tenant ou id inválido → 404; sem sessão → 401; nenhuma leitura auditada', async () => {
    const A = await nutriComDpa(db, auth);
    const B = await nutriComDpa(db, auth);
    const id = await geracaoNoBanco(db, A.ctx, { status: 'falhou', erro: 'interrompida', itensDescartados: 4 });
    const ok = await get(id, A.cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toEqual({ status: 'falhou', erro: 'interrompida' }); // nada além da situação
    const naFila = await geracaoNoBanco(db, B.ctx);
    expect(await (await get(naFila, B.cookie)).json()).toEqual({ status: 'na_fila', erro: null });
    expect((await get(id, B.cookie)).status).toBe(404);
    expect((await get('abc', A.cookie)).status).toBe(404);
    expect((await get(id)).status).toBe(401);
    const leituras = await withTenant(A.ctx, (tx) => tx.select().from(auditLog).where(eq(auditLog.acao, 'ler')), db);
    expect(leituras).toEqual([]);
  });
});
