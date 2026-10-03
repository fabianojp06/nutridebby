import { describe, expect, it } from 'vitest';
import { ehNavegacaoDoPortal, ehPaginaDoPlano, ehSemSessao, lerMensagem, planoValido, podeGuardarPlano, precisaBuscarPlano, RENOVAR_PLANO_MS, VALIDADE_PLANO_MS } from './sw-regras';

const O = 'https://nutri.exemplo.com';
const resposta = (o: Partial<{ status: number; type: ResponseType; redirected: boolean; url: string; tipo: string }> = {}) => ({
  status: o.status ?? 200,
  type: o.type ?? ('basic' as ResponseType),
  redirected: o.redirected ?? false,
  url: o.url ?? `${O}/p/plano`,
  headers: new Headers({ 'content-type': o.tipo ?? 'text/html; charset=utf-8' }),
});

describe('regras do cache do PWA (D6, Review Focus 4)', () => {
  it('só a navegação para /p/plano, sem query, da própria origem, é a página guardada', () => {
    expect(ehPaginaDoPlano(new URL(`${O}/p/plano`), 'navigate', O)).toBe(true);
    expect(ehPaginaDoPlano(new URL(`${O}/p/plano?pdf=preparando`), 'navigate', O)).toBe(false);
    expect(ehPaginaDoPlano(new URL(`${O}/p/plano`), 'cors', O)).toBe(false); // RSC/fetch do roteador
    expect(ehPaginaDoPlano(new URL('https://outro.com/p/plano'), 'navigate', O)).toBe(false);
  });
  it('qualquer navegação em /p/ cai no plano guardado sem rede; /api, /painel e /entrar não', () => {
    expect(ehNavegacaoDoPortal(new URL(`${O}/p/diario`), 'navigate', O)).toBe(true);
    expect(ehNavegacaoDoPortal(new URL(`${O}/api/p/acesso`), 'navigate', O)).toBe(false);
    expect(ehNavegacaoDoPortal(new URL(`${O}/painel`), 'navigate', O)).toBe(false);
    expect(ehNavegacaoDoPortal(new URL(`${O}/p/diario`), 'no-cors', O)).toBe(false);
  });
  it('guarda só 200 HTML de /p/plano, não redirecionado (nunca o /entrar de uma sessão vencida, nem redirecionamento opaco)', () => {
    expect(podeGuardarPlano(resposta(), O)).toBe(true);
    expect(podeGuardarPlano(resposta({ redirected: true, url: `${O}/entrar?volta=%2Fp%2Fplano` }), O)).toBe(false);
    expect(podeGuardarPlano(resposta({ status: 0, type: 'opaqueredirect' }), O)).toBe(false);
    expect(podeGuardarPlano(resposta({ status: 500 }), O)).toBe(false);
    expect(podeGuardarPlano(resposta({ url: `${O}/p/escolher` }), O)).toBe(false);
    expect(podeGuardarPlano(resposta({ tipo: 'application/json' }), O)).toBe(false);
    expect(podeGuardarPlano(resposta({ url: '' }), O)).toBe(false); // R7: sem URL válida não lança
  });
  it('Review Focus 4: o plano guardado é de uma conta + vínculo (dono) e de uma versão; outro dono → buscar de novo (e o velho sai)', () => {
    const DONO = '0b6f8f1e-3c1a-4f7e-9d2a-1a2b3c4d5e6f';
    const agora = Date.parse('2026-10-05T12:00:00Z');
    const ha = (ms: number) => new Date(agora - ms).toISOString();
    const pedido = { dono: DONO, versao: 'p1' };
    expect(precisaBuscarPlano(null, pedido, agora)).toBe(true);
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: ha(60_000) }, pedido, agora)).toBe(false); // nada mudou: sem segunda busca
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: ha(60_000) }, { dono: DONO, versao: 'p2' }, agora)).toBe(true); // plano novo publicado
    expect(precisaBuscarPlano({ dono: 'outro', versao: 'p1', guardadoEm: ha(60_000) }, pedido, agora)).toBe(true); // outra conta ou outro vínculo
    expect(precisaBuscarPlano({ dono: null, versao: null, guardadoEm: null }, pedido, agora)).toBe(true);
    // mesmo dono e mesma versão, mas cópia com mais de 1 dia: busca de novo para a validade de 30 dias andar junto com a sessão
    // (paciente que abre o portal todo dia com o mesmo plano por mais de 30 dias continua com o plano offline)
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: ha(RENOVAR_PLANO_MS + 60_000) }, pedido, agora)).toBe(true);
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: ha(29 * 24 * 60 * 60 * 1000) }, pedido, agora)).toBe(true);
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: 'lixo' }, pedido, agora)).toBe(true);
    expect(precisaBuscarPlano({ dono: DONO, versao: 'p1', guardadoEm: null }, pedido, agora)).toBe(true);
  });
  it('mensagens ao service worker: só os dois formatos, com textos curtos (nada de objeto arbitrário vindo da página)', () => {
    expect(lerMensagem({ tipo: 'plano', dono: 'd', versao: 'v' })).toEqual({ tipo: 'plano', dono: 'd', versao: 'v' });
    expect(lerMensagem({ tipo: 'dono', dono: 'd' })).toEqual({ tipo: 'dono', dono: 'd' });
    expect(lerMensagem({ tipo: 'plano', dono: 'd' })).toBeNull();
    expect(lerMensagem({ tipo: 'dono', dono: 'x'.repeat(101) })).toBeNull();
    expect(lerMensagem({ tipo: 'apagar-tudo' })).toBeNull();
    expect(lerMensagem('dono')).toBeNull();
  });
  it('sem sessão (a busca terminou no /entrar) → o plano guardado sai; guardado há mais de 30 dias (sessão máxima) não é servido', () => {
    expect(ehSemSessao({ redirected: true, url: `${O}/entrar?volta=%2Fp%2Fplano` }, O)).toBe(true);
    expect(ehSemSessao({ redirected: true, url: `${O}/p/escolher` }, O)).toBe(false);
    expect(ehSemSessao({ redirected: false, url: `${O}/p/plano` }, O)).toBe(false);
    const agora = Date.parse('2026-10-05T12:00:00Z');
    expect(planoValido(new Date(agora - VALIDADE_PLANO_MS + 60_000).toISOString(), agora)).toBe(true);
    expect(planoValido(new Date(agora - VALIDADE_PLANO_MS - 60_000).toISOString(), agora)).toBe(false);
    expect(planoValido(null, agora)).toBe(false);
    expect(planoValido('lixo', agora)).toBe(false);
  });
  it('R7 (Safari iOS 16.4, sem URL.canParse): URL inválida não lança, só não conta como login', () => {
    expect(ehSemSessao({ redirected: true, url: 'não é uma url' }, O)).toBe(false);
    expect(ehSemSessao({ redirected: true, url: '' }, O)).toBe(false);
  });
});
