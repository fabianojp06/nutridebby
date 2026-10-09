import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { auditLog, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { registrarTermoEmPapel } from '@/modules/ia/autorizacao';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { IA_TESTE, iaPronta, PDF_MINIMO } from '../../../../../../../../../test/ia';
import { novoPaciente } from '../../../../../../../../../test/pacientes';
import { criarEEntrar } from '../../../../../../../../../test/sessao';
import { GET } from './route';

vi.mock('server-only', () => ({}));
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
async function nutri() {
  const [t] = await db.insert(tenants).values({ slug: `tv-${randomUUID().slice(0, 8)}`, nomeExibicao: 'TV', nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' }).returning();
  const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  await iaPronta(db, t.id);
  return { tenantId: t.id, cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}
const get = (id: string, autorizacaoId: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/pacientes/${id}/autorizacao-ia/${autorizacaoId}/termo`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ id, autorizacaoId }),
  });

describe('GET "Ver termo assinado" (US-108)', () => {
  it('303 para a URL assinada e um "ler" de ia_autorizacao no audit_log; outro paciente ou consultório → 404; sem sessão → 401', async () => {
    const N = await nutri();
    const B = await nutri();
    const p = await novoPaciente(db, N.ctx);
    const outro = await novoPaciente(db, N.ctx);
    const id = await registrarTermoEmPapel(N.ctx, p.id, { data: hojeNoFuso('America/Sao_Paulo'), confirmacao: true, arquivo: PDF_MINIMO }, { ia: IA_TESTE, appUrl: 'http://localhost:3000', db });
    const leituras = () =>
      withTenant(N.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'ia_autorizacao'), eq(auditLog.acao, 'ler'), eq(auditLog.entidadeId, id))), db);

    const ok = await get(p.id, id, N.cookie);
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toMatch(/^\/api\/arquivos\?/);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    const lidas = await leituras();
    expect(lidas).toHaveLength(1);
    expect(lidas[0]).toMatchObject({ patientId: p.id, actorUserId: N.ctx.actorUserId });

    expect((await get(outro.id, id, N.cookie)).status).toBe(404); // a autorização é de outro paciente
    expect((await get(p.id, id, B.cookie)).status).toBe(404); // outro consultório (RLS)
    expect((await get(p.id, 'nao-e-uuid', N.cookie)).status).toBe(404);
    expect((await get(p.id, id)).status).toBe(401);
    expect(await leituras()).toHaveLength(1);
  });
});
