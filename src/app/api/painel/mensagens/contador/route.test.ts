import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { CABECALHO_CONSULTA } from '@/lib/consulta-automatica';
import { mensagemNoBanco } from '../../../../../../test/ia-nutri';
import { makeDb } from '../../../../../../test/db';
import { mensagemDoDono, naSessao, pacienteDoChat } from '../../../../../../test/mensagens';
import { nutriComDpa } from '../../../../../../test/nutri';
import type { TenantDeTeste } from '../../../../../../test/pacientes';
import { GET } from './route';

// Plano 25 (RN-459, CH-D43): a consulta leve do contador do menu — só `{ n }` (conversas com mensagem do paciente não lida
// + dúvidas abertas da IA Nutri), sem cache, sem auditRead e sem renovar a sessão (é consulta automática).
vi.mock('server-only', () => ({})); // requireApiNutri (src/lib/tenant-session.ts)
const db = getDb();
const auth = getAuth();
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await owner.pool.end();
});
const pedir = (cookie?: string) =>
  GET(new Request('http://localhost:3000/api/painel/mensagens/contador', { headers: { ...(cookie ? { cookie } : {}), [CABECALHO_CONSULTA]: '1' } }));

/** O consultório da rota (nutricionista com cookie) com o carimbo profissional (RN-475), como os testes do chat esperam. */
async function consultorio() {
  const A = await nutriComDpa(db, auth);
  await owner.pool.query("update tenants set nome_profissional = 'Débora Nutricionista', crn = 'CRN-4 12345' where id = $1", [A.tenantId]);
  const T: TenantDeTeste = { tenantId: A.tenantId, nutriId: A.ctx.actorUserId, ctx: A.ctx, tenant: { fuso: 'America/Sao_Paulo', nomeExibicao: 'PA' } };
  return { A, T };
}
const leituras = async (T: TenantDeTeste) => (await naSessao(db, T.ctx, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao = 'ler'`))[0].n;

describe('GET /api/painel/mensagens/contador (RN-459)', () => {
  it('só { n }: conversas com mensagem do paciente não lida + dúvidas abertas; sem cache e sem auditRead', async () => {
    const { A, T } = await consultorio();
    const r0 = await pedir(A.cookie);
    expect(r0.status).toBe(200);
    expect(r0.headers.get('cache-control')).toBe('no-store');
    expect(await r0.json()).toEqual({ n: 0 });

    const ana = await pacienteDoChat(db, T, { nome: 'Ana Souza' });
    await mensagemDoDono(owner.pool, T, ana, { texto: 'TEXTO-SECRETO' });
    await mensagemDoDono(owner.pool, T, ana, { texto: 'outra' }); // a mesma conversa conta uma vez
    const bia = await pacienteDoChat(db, T, { nome: 'Bia Lima' });
    await mensagemNoBanco(db, T.tenantId, bia.p, { status: 'respondida', encaminhadaEm: new Date() });
    const antes = await leituras(T);
    const r = await pedir(A.cookie);
    const corpo = await r.text();
    expect(JSON.parse(corpo)).toEqual({ n: 2 });
    expect(Object.keys(JSON.parse(corpo))).toEqual(['n']);
    expect(corpo).not.toMatch(/TEXTO-SECRETO|Ana|Bia/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await leituras(T)).toBe(antes);
  });

  it('sem sessão = 401; o contador é só do próprio consultório', async () => {
    expect((await pedir()).status).toBe(401);
    const { T } = await consultorio();
    const ana = await pacienteDoChat(db, T);
    await mensagemDoDono(owner.pool, T, ana);
    const outro = await nutriComDpa(db, auth);
    expect(await (await pedir(outro.cookie)).json()).toEqual({ n: 0 });
  });

  it('consulta automática: confere a sessão sem renovar (renovar: false) e chama requireApiNutri', () => {
    const s = readFileSync('src/app/api/painel/mensagens/contador/route.ts', 'utf8');
    expect(s).toMatch(/requireApiNutri\(req, \{ renovar: false \}\)/);
    expect(s).not.toMatch(/auditRead\(/);
  });
});
