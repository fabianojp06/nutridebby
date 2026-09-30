import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { criarEEntrar } from '../../../../../../test/sessao';
import { novoPaciente } from '../../../../../../test/pacientes';
import { GET } from './route';

vi.mock('server-only', () => ({})); // requireApiNutri (src/lib/tenant-session.ts)

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

async function nutriComDpa() {
  const [t] = await db.insert(tenants).values({ slug: `ap-${randomUUID().slice(0, 8)}`, nomeExibicao: 'AP' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  return { tenantId: t.id, cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}
const pedir = (id: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/pacientes/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

describe('GET /api/painel/pacientes/[id] (US-006 "Acesso por ID de outro tenant na API")', () => {
  it('200 com o cadastro para a própria nutricionista; 404 para paciente de outro tenant e para id malformado', async () => {
    const A = await nutriComDpa();
    const B = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx, { telefoneE164: '+5511912345678' });
    const ok = await pedir(p.id, A.cookie);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      id: p.id, nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email: p.email, telefone: '(11) 91234-5678', status: 'ativo', acessoAtivo: false,
    });
    const outro = await pedir(p.id, B.cookie);
    expect(outro.status).toBe(404);
    expect(await outro.json()).toEqual({ erro: 'Paciente não encontrado' });
    expect((await pedir('abc', A.cookie)).status).toBe(404);
  });

  it('sem sessão 401; admin 403', async () => {
    const A = await nutriComDpa();
    const p = await novoPaciente(db, A.ctx);
    expect((await pedir(p.id)).status).toBe(401);
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    expect((await pedir(p.id, admin.cookie)).status).toBe(403);
  });
});
