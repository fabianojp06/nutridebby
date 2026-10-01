import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { auditLog, mealPlans } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { criarRascunho } from '@/modules/plano-alimentar/rascunho';
import { novoPaciente } from '../../../../../../../test/pacientes';
import { nutriComDpa } from '../../../../../../../test/nutri';
import { GET } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const get = (id: string, paciente: string | null, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/planos/${id}/pdf${paciente === null ? '' : `?paciente=${paciente}`}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ id }),
  });

describe('GET /api/painel/planos/[id]/pdf (US-026: "Seu PDF está sendo preparado")', () => {
  it('devolve só o pdfStatus e não grava audit_log (não é dado de saúde); 404 para outro tenant, outro paciente e id inválido; 401 sem sessão', async () => {
    const A = await nutriComDpa(db, auth);
    const B = await nutriComDpa(db, auth);
    const p = await novoPaciente(db, A.ctx);
    const outro = await novoPaciente(db, A.ctx);
    const { id } = await criarRascunho(A.ctx, p.id, { db });
    await withTenant(A.ctx, (tx) => tx.update(mealPlans).set({ pdfStatus: 'pendente' }).where(eq(mealPlans.id, id)), db);
    const auditoria = () => withTenant(A.ctx, async (tx) => (await tx.select({ id: auditLog.id }).from(auditLog).where(eq(auditLog.tenantId, A.tenantId))).length, db);
    const antes = await auditoria();

    const ok = await get(id, p.id, A.cookie);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toEqual({ pdfStatus: 'pendente' });
    expect(await auditoria()).toBe(antes); // o polling de 3 s não enche o "Histórico de acessos"

    expect((await get(id, p.id, B.cookie)).status).toBe(404); // outro tenant (RLS)
    expect((await get(id, outro.id, A.cookie)).status).toBe(404); // plano de outro paciente
    expect((await get(id, 'abc', A.cookie)).status).toBe(404);
    expect((await get(id, null, A.cookie)).status).toBe(404);
    expect((await get('abc', p.id, A.cookie)).status).toBe(404);
    expect((await get(id, p.id)).status).toBe(401);
    expect(await auditoria()).toBe(antes);
  });
});
