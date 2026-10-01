import { inject, describe, expect, it } from 'vitest';
import { makeDb } from '../../test/db';
import { createAuth } from './auth';
import { cookiesDeSessaoApagados } from './sessao-cookies';

const app = makeDb(inject('appDatabaseUrl'));

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
