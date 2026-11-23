import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { CABECALHO_CONSULTA } from '@/lib/consulta-automatica';
import { makeDb } from '../../../../../../test/db';
import { mensagemDoDono, naSessao, pacienteDoChat } from '../../../../../../test/mensagens';
import { nutriComDpa } from '../../../../../../test/nutri';
import type { TenantDeTeste } from '../../../../../../test/pacientes';
import { GET } from './route';

// Plano 25, T6b (RN-452): "há novas?" da conversa no painel — só `{ novas, ultimaLida }`, sem cache, sem auditRead, sem
// mexer no marcador e sem renovar a sessão (consulta automática).
vi.mock('server-only', () => ({}));
const db = getDb();
const auth = getAuth();
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await owner.pool.end();
});
const pedir = (q: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/painel/mensagens/situacao?${q}`, { headers: { ...(cookie ? { cookie } : {}), [CABECALHO_CONSULTA]: '1' } }));

async function consultorio() {
  const A = await nutriComDpa(db, auth);
  await owner.pool.query("update tenants set nome_profissional = 'Débora Nutricionista', crn = 'CRN-4 12345' where id = $1", [A.tenantId]);
  const T: TenantDeTeste = { tenantId: A.tenantId, nutriId: A.ctx.actorUserId, ctx: A.ctx, tenant: { fuso: 'America/Sao_Paulo', nomeExibicao: 'PA' } };
  return { A, T };
}
const contar = async (T: TenantDeTeste, q: ReturnType<typeof sql>) => (await naSessao(db, T.ctx, q))[0].n as number;

describe('GET /api/painel/mensagens/situacao (RN-452)', () => {
  it('só { novas, ultimaLida }: as do paciente depois da última mostrada; sem cache, sem auditRead e sem mexer no marcador', async () => {
    const { A, T } = await consultorio();
    const ana = await pacienteDoChat(db, T);
    const mostrada = await mensagemDoDono(owner.pool, T, ana, { texto: 'primeira' });
    await mensagemDoDono(owner.pool, T, ana, { texto: 'SEGREDO' });
    const lidas = await contar(T, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao = 'ler'`);
    const r = await pedir(`paciente=${ana.p}&depois=${mostrada}`, A.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = await r.text();
    expect(JSON.parse(corpo)).toEqual({ novas: 1, ultimaLida: null });
    expect(corpo).not.toContain('SEGREDO');
    expect(await contar(T, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao = 'ler'`)).toBe(lidas);
    expect(await contar(T, sql`select count(*)::int as n from chat_leituras where tenant_id = ${T.tenantId}`)).toBe(0);
    // tela vazia (depois vazio) → todas as do paciente
    expect(await (await pedir(`paciente=${ana.p}&depois=`, A.cookie)).json()).toEqual({ novas: 2, ultimaLida: null });
  });

  it('ids inválidos ou de outro consultório → zero; sem sessão → 401', async () => {
    const { A } = await consultorio();
    const outro = await consultorio();
    const deOutro = await pacienteDoChat(db, outro.T);
    await mensagemDoDono(owner.pool, outro.T, deOutro);
    expect(await (await pedir(`paciente=${deOutro.p}&depois=`, A.cookie)).json()).toEqual({ novas: 0, ultimaLida: null });
    expect(await (await pedir('paciente=abc&depois=xyz', A.cookie)).json()).toEqual({ novas: 0, ultimaLida: null });
    expect(await (await pedir('', A.cookie)).json()).toEqual({ novas: 0, ultimaLida: null });
    expect((await pedir(`paciente=${deOutro.p}&depois=`)).status).toBe(401);
  });

  it('confere a sessão sem renovar e não chama auditRead', () => {
    const s = readFileSync('src/app/api/painel/mensagens/situacao/route.ts', 'utf8');
    expect(s).toMatch(/requireApiNutri\(req, \{ renovar: false \}\)/);
    expect(s).not.toMatch(/auditRead\(/);
  });
});
