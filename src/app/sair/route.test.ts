import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { session } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { criarEEntrar, entrar } from '../../../test/sessao';

// POST /sair pelo caminho real: o handler lê a sessão do Better Auth e apaga a linha no Postgres (Testcontainers).
// Só `server-only` é simulado; o handler recebe um `Request` de verdade (APP_URL dos testes: http://localhost:3000).
vi.mock('server-only', () => ({}));
const { POST } = await import('./route');

const ORIGEM = 'http://localhost:3000';
const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

const sessoesDe = (userId: string) => db.select({ id: session.id, token: session.token }).from(session).where(eq(session.userId, userId));
const pedido = (cabecalhos: Record<string, string> = {}) =>
  new Request(`${ORIGEM}/sair`, { method: 'POST', headers: { origin: ORIGEM, ...cabecalhos } });
/** Cookie de sessão que a resposta apaga (`Max-Age=0`), em dev (`nd.`) ou em produção (`__Secure-nd.`). */
const cookiesApagados = (r: Response) =>
  r.headers.getSetCookie().filter((c) => /session_token=;/.test(c) && /Max-Age=0/i.test(c));

describe('POST /sair (botão "Sair")', () => {
  it('com sessão: apaga a linha no banco, apaga o cookie e responde 303 para /entrar', async () => {
    const u = await criarEEntrar(db, auth, { appRole: 'paciente' });
    expect(await sessoesDe(u.id)).toHaveLength(1);

    const r = await POST(pedido({ cookie: u.cookie }));

    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/entrar');
    expect(await sessoesDe(u.id)).toHaveLength(0);
    expect(cookiesApagados(r)).toHaveLength(1);
    // o cookie antigo não vale mais em lugar nenhum (nem em outra aba que ainda o tenha)
    expect(await auth.api.getSession({ headers: new Headers({ cookie: u.cookie }) })).toBeNull();
  });

  it('só encerra a sessão deste navegador: a de outro aparelho continua', async () => {
    const u = await criarEEntrar(db, auth, { appRole: 'paciente' });
    const outro = await entrar(auth, u.email);
    expect(await sessoesDe(u.id)).toHaveLength(2);

    const r = await POST(pedido({ cookie: u.cookie }));

    expect(r.status).toBe(303);
    expect(await sessoesDe(u.id)).toHaveLength(1);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: outro }) })).not.toBeNull();
  });

  it('sem sessão (sem cookie): só 303 para /entrar, sem erro', async () => {
    const r = await POST(pedido());
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/entrar');
  });

  it('outra aba já saiu (cookie de sessão que já não existe): 303 para /entrar, sem erro, e limpa o cookie velho', async () => {
    const u = await criarEEntrar(db, auth, { appRole: 'paciente' });
    expect((await POST(pedido({ cookie: u.cookie }))).status).toBe(303);

    const r = await POST(pedido({ cookie: u.cookie })); // a segunda aba, com o mesmo cookie

    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/entrar');
    expect(cookiesApagados(r)).toHaveLength(1);
  });

  it('cookie de sessão inválido (assinatura errada): 303 para /entrar, sem erro', async () => {
    const r = await POST(pedido({ cookie: 'nd.session_token=lixo.lixo' }));
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('/entrar');
  });

  describe('CSRF: só vale para a origem do APP_URL', () => {
    it('Origin igual à origem do APP_URL: aceita', async () => {
      const u = await criarEEntrar(db, auth, { appRole: 'paciente' });
      const r = await POST(pedido({ cookie: u.cookie, origin: ORIGEM }));
      expect(r.status).toBe(303);
      expect(await sessoesDe(u.id)).toHaveLength(0);
    });

    it('sem Origin, com Sec-Fetch-Site: same-origin: aceita', async () => {
      const u = await criarEEntrar(db, auth, { appRole: 'paciente' });
      const r = await POST(new Request(`${ORIGEM}/sair`, { method: 'POST', headers: { cookie: u.cookie, 'sec-fetch-site': 'same-origin' } }));
      expect(r.status).toBe(303);
      expect(await sessoesDe(u.id)).toHaveLength(0);
    });

    it.each([
      ['Origin de outro site', { origin: 'https://evil.example' }],
      ['Origin "null" (contexto opaco)', { origin: 'null' }],
      ['Origin de outra porta do mesmo host', { origin: 'http://localhost:3100' }],
      ['Origin de outro site mesmo com Sec-Fetch-Site: same-origin', { origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }],
      ['sem Origin e sem Sec-Fetch-Site', {}],
      ['sem Origin, Sec-Fetch-Site: cross-site', { 'sec-fetch-site': 'cross-site' }],
      ['sem Origin, Sec-Fetch-Site: same-site', { 'sec-fetch-site': 'same-site' }],
      ['sem Origin, Sec-Fetch-Site: none', { 'sec-fetch-site': 'none' }],
    ])('%s: 403, sem efeito (a sessão fica e o cookie não é tocado)', async (_nome, cabecalhos) => {
      const u = await criarEEntrar(db, auth, { appRole: 'paciente' });
      const r = await POST(new Request(`${ORIGEM}/sair`, { method: 'POST', headers: { cookie: u.cookie, ...cabecalhos } }));
      expect(r.status).toBe(403);
      expect(r.headers.getSetCookie()).toHaveLength(0);
      expect(await sessoesDe(u.id)).toHaveLength(1);
    });
  });

  describe('falha ao apagar a sessão no banco', () => {
    it('não engole o erro: 303 para /sair/erro, sem apagar o cookie, a sessão fica, e o log só leva o motivo (sem token nem SQL)', async () => {
      const u = await criarEEntrar(db, auth, { appRole: 'paciente' });
      const [{ token }] = await sessoesDe(u.id);
      // DrizzleQueryError de verdade carrega o SQL e os parâmetros (o token da sessão) na message
      const falha = Object.assign(new Error(`Failed query: delete from "session" where "session"."token" = $1\nparams: ${token}`), {
        name: 'DrizzleQueryError',
        params: [token],
        cause: Object.assign(new Error(`connection terminated (token ${token})`), { code: '57P01', severity: 'FATAL' }),
      });
      const erros = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      const apagar = vi.spyOn(db, 'delete').mockImplementation(() => {
        throw falha;
      });
      let r: Response;
      try {
        r = await POST(pedido({ cookie: u.cookie }));
      } finally {
        apagar.mockRestore();
      }
      const chamadas = [...erros.mock.calls];
      erros.mockRestore();

      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe('/sair/erro');
      expect(r.headers.getSetCookie()).toHaveLength(0);
      expect(await sessoesDe(u.id)).toHaveLength(1);
      expect(chamadas).toHaveLength(1);
      const [objeto, mensagem] = chamadas[0] as unknown as [Record<string, unknown>, string];
      expect(Object.keys(objeto)).toEqual(['motivo']);
      const tudo = JSON.stringify([objeto, mensagem]);
      expect(tudo).not.toContain(token);
      expect(tudo).not.toMatch(/delete from|params|Failed query/i);
    });
  });
});
