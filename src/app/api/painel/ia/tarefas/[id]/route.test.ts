import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { tarefaNoBanco } from '../../../../../../../test/ia';
import { nutriComDpa } from '../../../../../../../test/nutri';
import { novoPaciente } from '../../../../../../../test/pacientes';
import { GET } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const get = (id: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/ia/tarefas/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

describe('GET /api/painel/ia/tarefas/[id] — só a situação, sem auditoria (RNF-100)', () => {
  it('200 com { status, erro } e no-store; outro tenant ou id inválido → 404; sem sessão → 401; nenhuma leitura auditada', async () => {
    const A = await nutriComDpa(db, auth);
    const B = await nutriComDpa(db, auth);
    const p = await novoPaciente(db, A.ctx);
    const id = await tarefaNoBanco(db, A.ctx, p.id, null, { status: 'falhou', erro: 'cota' });
    const ok = await get(id, A.cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toEqual({ status: 'falhou', erro: 'cota' });
    expect((await get(id, B.cookie)).status).toBe(404);
    expect((await get('abc', A.cookie)).status).toBe(404);
    expect((await get(id)).status).toBe(401);
    const leituras = await withTenant(A.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'ia'), eq(auditLog.acao, 'ler'))), db);
    expect(leituras).toEqual([]);
  });
});
