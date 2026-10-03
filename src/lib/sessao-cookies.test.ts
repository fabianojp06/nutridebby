import { afterAll, inject, describe, expect, it } from 'vitest';
import { makeDb } from '../../test/db';
import { criarEEntrar } from '../../test/sessao';
import { createAuth } from './auth';
import { cookieDeSessaoRenovado, cookiesDeSessaoApagados } from './sessao-cookies';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('cookies de sessão apagados (POST /sair)', () => {
  it('em dev (http): os três cookies do Better Auth, vazios, com Max-Age=0 e o mesmo Path/HttpOnly/SameSite', async () => {
    const cookies = await cookiesDeSessaoApagados(createAuth(app.db, { baseURL: 'http://localhost:3100' }));
    expect(cookies.map((c) => c.split(';')[0])).toEqual(['nd.session_token=', 'nd.session_data=', 'nd.dont_remember=']);
    for (const c of cookies) {
      expect(c).toMatch(/; Max-Age=0(;|$)/);
      expect(c).toMatch(/; Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
      expect(c).toMatch(/; Path=\/(;|$)/);
      expect(c).toMatch(/; HttpOnly(;|$)/);
      expect(c).toMatch(/; SameSite=Lax(;|$)/i);
      expect(c).not.toMatch(/Secure/);
    }
  });

  it('em produção (https): prefixo __Secure- e Secure, senão o navegador não apaga o cookie que o login gravou', async () => {
    const cookies = await cookiesDeSessaoApagados(createAuth(app.db, { baseURL: 'https://app.nutridebby.test' }));
    expect(cookies.map((c) => c.split(';')[0])).toEqual(['__Secure-nd.session_token=', '__Secure-nd.session_data=', '__Secure-nd.dont_remember=']);
    for (const c of cookies) expect(c).toMatch(/; Secure(;|$)/);
  });
});

describe('cookieDeSessaoRenovado (P06-11)', () => {
  const escapar = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  it('reemite o cookie de sessão com o mesmo valor e atributos e Max-Age de 30 dias; sem o cookie → null', async () => {
    const auth = createAuth(app.db, { baseURL: 'http://localhost:3100' });
    const u = await criarEEntrar(app.db, auth, { appRole: 'paciente' });
    const c = await cookieDeSessaoRenovado(auth, `outro=1; ${u.cookie}; mais=2`);
    const valor = u.cookie.split('=').slice(1).join('=');
    expect(c).toMatch(new RegExp(`^nd\\.session_token=${escapar(valor)}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax$`));
    expect(await cookieDeSessaoRenovado(auth, 'outro=1')).toBeNull();
    expect(await cookieDeSessaoRenovado(auth, null)).toBeNull();
    expect(await cookieDeSessaoRenovado(auth, 'nd.session_token=')).toBeNull();
  });

  it('em produção (https): o mesmo nome com __Secure- e Secure', async () => {
    const auth = createAuth(app.db, { baseURL: 'https://app.nutridebby.test' });
    const c = await cookieDeSessaoRenovado(auth, '__Secure-nd.session_token=abc.def; nd.session_token=velho');
    expect(c).toBe('__Secure-nd.session_token=abc.def; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax');
  });
});
