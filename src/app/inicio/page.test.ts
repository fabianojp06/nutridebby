import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { recepcaoComLogin } from '../../../test/equipe';
import { criarEEntrar } from '../../../test/sessao';

/**
 * Plano 26 (RE-D67): /inicio é o destino do login, do 2FA e do "Continuar" da Segurança. Com a recepção, vai ao painel —
 * sem laço e sem o aviso de outro papel. Caminho real da sessão; só o runtime do Next é simulado.
 */
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
const { default: Inicio } = await import('./page');

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

async function comRecepcao(o: Parameters<typeof recepcaoComLogin>[3] = {}) {
  const [t] = await db.insert(tenants).values({ slug: `in-${randomUUID().slice(0, 8)}`, nomeExibicao: 'IN' }).returning();
  const r = await recepcaoComLogin(db, auth, t.id, o);
  req.headers = new Headers({ cookie: r.cookie });
  return { tenantId: t.id, ...r };
}

describe('/inicio (RE-D67)', () => {
  it('recepção com 2FA → /painel', async () => {
    await comRecepcao();
    await expect(Inicio()).rejects.toMatchObject({ url: '/painel' });
  });
  it('recepção sem 2FA → Segurança da conta; desativada → Acesso desativado', async () => {
    await comRecepcao({ twoFactorEnabled: false });
    await expect(Inicio()).rejects.toMatchObject({ url: '/conta/seguranca' });
    await comRecepcao({ desativada: true });
    await expect(Inicio()).rejects.toMatchObject({ url: '/conta/acesso-desativado' });
  });
  it('a nutricionista e o paciente seguem para a própria home', async () => {
    const { tenantId } = await comRecepcao();
    req.headers = new Headers({ cookie: (await criarEEntrar(db, auth, { appRole: 'nutri', tenantId })).cookie });
    await expect(Inicio()).rejects.toMatchObject({ url: '/painel' });
    req.headers = new Headers({ cookie: (await criarEEntrar(db, auth, { appRole: 'paciente', tenantId })).cookie });
    await expect(Inicio()).rejects.toMatchObject({ url: '/p/inicio' });
  });
});
