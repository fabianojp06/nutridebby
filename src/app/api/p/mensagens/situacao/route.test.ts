import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { CABECALHO_CONSULTA } from '@/lib/consulta-automatica';
import { liberarConversa } from '@/modules/mensagens/conversa';
import { makeDb } from '../../../../../../test/db';
import { consultorioDoChat, mensagemDoDono, naSessao, type PacienteDoChat } from '../../../../../../test/mensagens';
import { ctxPaciente, type TenantDeTeste } from '../../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../../test/portal';
import { entrar } from '../../../../../../test/sessao';
import { GET } from './route';

// Plano 25, T7 (RN-452, US-443): "há novas?" da conversa no app — só `{ novas, ultimaLida }`, do paciente da sessão, sem
// cache, sem auditRead, sem mexer no marcador; a consulta automática não renova a sessão.
vi.mock('server-only', () => ({}));
const db = getDb();
const auth = getAuth();
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await owner.pool.end();
});
const pedir = (q: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/p/mensagens/situacao?${q}`, { headers: { ...(cookie ? { cookie } : {}), [CABECALHO_CONSULTA]: '1' } }));

async function pacienteNoApp(T: TenantDeTeste): Promise<PacienteDoChat & { cookie: string }> {
  const { paciente, userId, email } = await pacienteComConta(db, T);
  if ((await liberarConversa(T.ctx, paciente.id, { forma: 'aceite_escrito', confirmou: true }, db)) !== 'ok') throw new Error('liberar');
  return { p: paciente.id, u: userId, P: ctxPaciente(T.tenantId, paciente.id, userId), cookie: await entrar(auth, email) };
}
const contar = async (T: TenantDeTeste, q: ReturnType<typeof sql>) => (await naSessao(db, T.ctx, q))[0].n as number;

describe('GET /api/p/mensagens/situacao (RN-452)', () => {
  it('só { novas, ultimaLida }: as da nutricionista depois da última mostrada; sem cache, sem auditRead e sem mexer no marcador', async () => {
    const T = await consultorioDoChat(db, owner.pool);
    const ana = await pacienteNoApp(T);
    const mostrada = await mensagemDoDono(owner.pool, T, ana, { autor: 'nutri', texto: 'primeira' });
    await mensagemDoDono(owner.pool, T, ana, { autor: 'nutri', texto: 'SEGREDO' });
    await mensagemDoDono(owner.pool, T, ana, { texto: 'do próprio paciente' }); // a própria não conta
    const lidas = await contar(T, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao = 'ler'`);
    const r = await pedir(`depois=${mostrada}`, ana.cookie);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = await r.text();
    expect(JSON.parse(corpo)).toEqual({ novas: 1, ultimaLida: null });
    expect(corpo).not.toContain('SEGREDO');
    expect(await contar(T, sql`select count(*)::int as n from audit_log where tenant_id = ${T.tenantId} and acao = 'ler'`)).toBe(lidas);
    expect(await contar(T, sql`select count(*)::int as n from chat_leituras where tenant_id = ${T.tenantId}`)).toBe(0);
    // tela vazia (depois vazio) → todas as da nutricionista
    expect(await (await pedir('depois=', ana.cookie)).json()).toEqual({ novas: 2, ultimaLida: null });
  });

  it('o paciente vem da sessão: `paciente=` de outro é ignorado; id de outra conversa ou inválido → zero; sem sessão → 401', async () => {
    const T = await consultorioDoChat(db, owner.pool);
    const ana = await pacienteNoApp(T);
    const bia = await pacienteNoApp(T);
    const daBia = await mensagemDoDono(owner.pool, T, bia, { autor: 'nutri', texto: 'para a Bia' });
    await mensagemDoDono(owner.pool, T, bia, { autor: 'nutri', texto: 'outra para a Bia' });
    expect(await (await pedir(`paciente=${bia.p}&depois=`, ana.cookie)).json()).toEqual({ novas: 0, ultimaLida: null });
    expect(await (await pedir(`depois=${daBia}`, ana.cookie)).json()).toEqual({ novas: 0, ultimaLida: null });
    expect(await (await pedir('depois=xyz', ana.cookie)).json()).toEqual({ novas: 0, ultimaLida: null });
    expect((await pedir('depois=')).status).toBe(401);
  });

  it('não chama auditRead; a resposta tem só as duas chaves (montada à mão, nunca o objeto do módulo)', () => {
    const s = readFileSync('src/app/api/p/mensagens/situacao/route.ts', 'utf8');
    expect(s).toMatch(/requireApiPaciente\(req\)/);
    expect(s).not.toMatch(/auditRead\(/);
    expect(s).toMatch(/Response\.json\(\{ novas, ultimaLida \}/);
  });
});
