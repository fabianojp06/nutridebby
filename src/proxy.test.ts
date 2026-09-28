import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { getRedirectUrl } from 'next/experimental/testing/server';
import { proxy } from './proxy';

describe('proxy', () => {
  it('rota protegida sem cookie vai para /entrar preservando caminho e query em ?volta', () => {
    const res = proxy(new NextRequest('http://localhost:3100/painel/pacientes?busca=ana&pagina=2'));
    const url = new URL(getRedirectUrl(res)!);
    expect(url.pathname).toBe('/entrar');
    expect(url.searchParams.get('volta')).toBe('/painel/pacientes?busca=ana&pagina=2');
  });

  it('rota protegida com cookie de sessão segue adiante', () => {
    const req = new NextRequest('http://localhost:3100/painel', { headers: { cookie: 'nd.session_token=abc.def' } });
    expect(getRedirectUrl(proxy(req))).toBeNull();
  });

  it('rota pública segue adiante sem cookie', () => {
    expect(getRedirectUrl(proxy(new NextRequest('http://localhost:3100/entrar')))).toBeNull();
  });
});
