import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { session } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { criarEEntrar, entrar } from '../../../test/sessao';

// Botão "Sair" pelo caminho real: a Server Action chama o signOut do Better Auth (Postgres via
// Testcontainers). Só o runtime do Next é simulado: headers da requisição e redirect. O cookie
// apagado na resposta (`nextCookies`) fica para o E2E: o Better Auth importa `next/headers` por
// fora do vitest, e aqui não há escopo de requisição para gravar cookie.
const req = vi.hoisted(() => ({ headers: new Headers() }));
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { sairAction } = await import('./actions');

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
});

const sessoesDe = (userId: string) => db.select({ id: session.id }).from(session).where(eq(session.userId, userId));

describe('sairAction (botão "Sair")', () => {
  it('com sessão: apaga a sessão no banco e redireciona para /entrar', async () => {
    const u = await criarEEntrar(db, auth, { appRole: 'paciente' });
    req.headers = new Headers({ cookie: u.cookie });
    expect(await sessoesDe(u.id)).toHaveLength(1);

    await expect(sairAction()).rejects.toMatchObject({ url: '/entrar' });

    expect(await sessoesDe(u.id)).toHaveLength(0);
    // o cookie antigo não vale mais em lugar nenhum (nem em outra aba que ainda o tenha)
    expect(await auth.api.getSession({ headers: new Headers({ cookie: u.cookie }) })).toBeNull();
  });

  it('só encerra a sessão deste navegador: a de outro aparelho continua', async () => {
    const u = await criarEEntrar(db, auth, { appRole: 'paciente' });
    const outro = await entrar(auth, u.email);
    expect(await sessoesDe(u.id)).toHaveLength(2);
    req.headers = new Headers({ cookie: u.cookie });

    await expect(sairAction()).rejects.toMatchObject({ url: '/entrar' });

    expect(await sessoesDe(u.id)).toHaveLength(1);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: outro }) })).not.toBeNull();
  });

  it('sem sessão (sem cookie): só redireciona para /entrar, sem erro', async () => {
    await expect(sairAction()).rejects.toMatchObject({ url: '/entrar' });
  });

  it('com cookie de sessão que já não existe (expirada ou já encerrada em outra aba): redireciona, sem erro', async () => {
    const u = await criarEEntrar(db, auth, { appRole: 'paciente' });
    await db.delete(session).where(eq(session.userId, u.id));
    req.headers = new Headers({ cookie: u.cookie });

    await expect(sairAction()).rejects.toMatchObject({ url: '/entrar' });
  });
});
