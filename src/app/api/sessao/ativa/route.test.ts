import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { session, tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { PRAZOS_DA_EQUIPE } from '@/lib/session-rules';
import { recepcaoComLogin } from '../../../../../test/equipe';
import { criarEEntrar } from '../../../../../test/sessao';

// P12-14 (RNF-06): a rota do relógio da tela da equipe pelo caminho real (Better Auth + Postgres do Testcontainers).
vi.mock('server-only', () => ({}));
const { GET, POST } = await import('./route');

const ORIGEM = 'http://localhost:3000';
const MIN = 60_000;
const H = 60 * MIN;
const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const pedido = (metodo: 'GET' | 'POST', cookie?: string, origem: string | null = ORIGEM) =>
  new Request(`${ORIGEM}/api/sessao/ativa`, { method: metodo, headers: { ...(cookie ? { cookie } : {}), ...(origem ? { origin: origem } : {}) } });

async function envelhecer(userId: string, updatedAgoMs: number, expiresInMs: number, createdAtAgoMs = updatedAgoMs) {
  const now = Date.now();
  await db
    .update(session)
    .set({ updatedAt: new Date(now - updatedAgoMs), expiresAt: new Date(now + expiresInMs), createdAt: new Date(now - createdAtAgoMs) })
    .where(eq(session.userId, userId));
}
const lerSessao = async (userId: string) =>
  (await db.select({ updatedAt: session.updatedAt, expiresAt: session.expiresAt }).from(session).where(eq(session.userId, userId)))[0];
const perto = (valor: number, alvo: number) => expect(Math.abs(valor - alvo)).toBeLessThan(MIN);

describe('POST /api/sessao/ativa — o uso na tela renova a sessão da equipe', () => {
  it('nutricionista: renova (passada a cadência de 5 min) e devolve quanto falta e os prazos, sem cache e sem dado pessoal', async () => {
    const n = await criarEEntrar(db, auth, { appRole: 'nutri' });
    await envelhecer(n.id, 6 * MIN, 24 * MIN, 2 * H);
    const r = await POST(pedido('POST', n.cookie));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = (await r.json()) as Record<string, number>;
    expect(Object.keys(corpo).sort()).toEqual(['avisoMs', 'cadenciaMs', 'inatividadeMs', 'limiteMs']);
    perto(corpo.inatividadeMs, 30 * MIN);
    perto(corpo.limiteMs, 6 * H);
    expect([corpo.avisoMs, corpo.cadenciaMs]).toEqual([PRAZOS_DA_EQUIPE.avisoMs, PRAZOS_DA_EQUIPE.cadenciaMs]);
    const s = await lerSessao(n.id);
    perto(new Date(s.updatedAt).getTime(), Date.now());
    perto(new Date(s.expiresAt).getTime(), Date.now() + 30 * MIN);
  });

  it('dentro da cadência não grava de novo, e a resposta diz o que vale no banco', async () => {
    const n = await criarEEntrar(db, auth, { appRole: 'nutri' });
    await envelhecer(n.id, 2 * MIN, 28 * MIN);
    const antes = await lerSessao(n.id);
    const r = await POST(pedido('POST', n.cookie));
    expect(r.status).toBe(200);
    perto(((await r.json()) as { inatividadeMs: number }).inatividadeMs, 28 * MIN);
    expect(await lerSessao(n.id)).toEqual(antes);
  });

  it('admin com 2FA também (equipe); sem Origin (mesmo site) passa', async () => {
    const a = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    expect((await POST(pedido('POST', a.cookie, null))).status).toBe(200);
  });

  it('outra origem → 403 antes da sessão, sem renovar', async () => {
    const n = await criarEEntrar(db, auth, { appRole: 'nutri' });
    await envelhecer(n.id, 6 * MIN, 24 * MIN);
    const antes = await lerSessao(n.id);
    expect((await POST(pedido('POST', n.cookie, 'https://evil.example'))).status).toBe(403);
    expect(await lerSessao(n.id)).toEqual(antes);
  });

  it('paciente → 403 e a sessão dele não muda (o portal não tem aviso de inatividade)', async () => {
    const p = await criarEEntrar(db, auth, { appRole: 'paciente' });
    await envelhecer(p.id, 20 * MIN, 29 * 24 * H);
    const antes = await lerSessao(p.id);
    const r = await POST(pedido('POST', p.cookie));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: 'Acesso negado' });
    expect(await lerSessao(p.id)).toEqual(antes);
  });

  it('sem sessão → 401', async () => {
    expect((await POST(pedido('POST'))).status).toBe(401);
  });

  it('sessão expirada não renova: ociosa há 31 min (expiresAt antigo de 12 h), acima de 8 h, ou com o expiresAt vencido → 401', async () => {
    for (const [ociosa, expira, login] of [
      [31 * MIN, 11 * H, 1 * H],
      [1 * MIN, 29 * MIN, 8 * H + MIN],
      [29 * MIN, -1 * MIN, 1 * H],
    ]) {
      const n = await criarEEntrar(db, auth, { appRole: 'nutri' });
      await envelhecer(n.id, ociosa, expira, login);
      const antes = await lerSessao(n.id);
      const r = await POST(pedido('POST', n.cookie));
      expect(r.status).toBe(401);
      const depois = await lerSessao(n.id);
      if (depois) expect(depois).toEqual(antes); // continua como estava (ou o Better Auth já a apagou)
    }
  });
});

describe('GET /api/sessao/ativa — a tela pergunta quanto falta, sem renovar', () => {
  it('devolve o estado e não mexe na sessão (perguntar não é uso)', async () => {
    const n = await criarEEntrar(db, auth, { appRole: 'nutri' });
    await envelhecer(n.id, 10 * MIN, 20 * MIN, 7 * H);
    const antes = await lerSessao(n.id);
    const r = await GET(pedido('GET', n.cookie, null));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { inatividadeMs: number; limiteMs: number };
    perto(corpo.inatividadeMs, 20 * MIN);
    perto(corpo.limiteMs, 1 * H);
    expect(await lerSessao(n.id)).toEqual(antes);
  });

  it('ociosa → 401; paciente → 403', async () => {
    const n = await criarEEntrar(db, auth, { appRole: 'nutri' });
    await envelhecer(n.id, 31 * MIN, 11 * H);
    expect((await GET(pedido('GET', n.cookie, null))).status).toBe(401);
    const p = await criarEEntrar(db, auth, { appRole: 'paciente' });
    expect((await GET(pedido('GET', p.cookie, null))).status).toBe(403);
  });
});

describe('Plano 26 (RE-D67, RN-501): a recepção tem o aviso de inatividade e a renovação pelo uso, como a nutricionista', () => {
  async function recepcao(o: Parameters<typeof recepcaoComLogin>[3] = {}) {
    const [t] = await db.insert(tenants).values({ slug: `sa-${Math.random().toString(36).slice(2, 10)}`, nomeExibicao: 'SA' }).returning();
    return recepcaoComLogin(db, auth, t.id, o);
  }

  it('GET: 200 com os prazos, sem renovar', async () => {
    const r = await recepcao();
    await envelhecer(r.id, 6 * MIN, 24 * MIN, 2 * H);
    const antes = await lerSessao(r.id);
    const res = await GET(pedido('GET', r.cookie));
    expect(res.status).toBe(200);
    const corpo = (await res.json()) as Record<string, number>;
    expect(Object.keys(corpo).sort()).toEqual(['avisoMs', 'cadenciaMs', 'inatividadeMs', 'limiteMs']);
    perto(corpo.inatividadeMs, 24 * MIN);
    expect(await lerSessao(r.id)).toEqual(antes);
  });

  it('POST: renova como para a nutricionista (passada a cadência de 5 min)', async () => {
    const r = await recepcao();
    await envelhecer(r.id, 6 * MIN, 24 * MIN, 2 * H);
    const res = await POST(pedido('POST', r.cookie));
    expect(res.status).toBe(200);
    perto(((await res.json()) as { inatividadeMs: number }).inatividadeMs, 30 * MIN);
    perto(new Date((await lerSessao(r.id)).expiresAt).getTime(), Date.now() + 30 * MIN);
  });

  it('desativada → 403 nos dois, sem renovar', async () => {
    const r = await recepcao({ desativada: true });
    await envelhecer(r.id, 6 * MIN, 24 * MIN, 2 * H);
    const antes = await lerSessao(r.id);
    expect((await GET(pedido('GET', r.cookie))).status).toBe(403);
    expect((await POST(pedido('POST', r.cookie))).status).toBe(403);
    expect(await lerSessao(r.id)).toEqual(antes);
  });
});
