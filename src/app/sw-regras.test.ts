import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CABECALHO_BUILD,
  CABECALHO_DONO,
  CABECALHO_GUARDADO_EM,
  CABECALHO_VERSAO,
  cabecalhosDaCopia,
  CACHE_PLANO,
  ehNavegacaoDoPortal,
  ehPaginaDoPlano,
  esquecerPlanoGuardadoForaDe,
  idDoBuild,
  lerMensagem,
  mensagemDaPropriaOrigem,
  planoValido,
  podeGuardarPlano,
  precisaBuscarPlano,
  RENOVAR_PLANO_MS,
  saiuDoPlano,
  URL_PLANO,
  urlDaNotificacao,
  VALIDADE_PLANO_MS,
} from './sw-regras';

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
  it('US-146 (Plano 10A): /p/documentos nunca é a página guardada nem é gravada no cache do plano', () => {
    expect(ehPaginaDoPlano(new URL(`${O}/p/documentos`), 'navigate', O)).toBe(false);
    expect(podeGuardarPlano(resposta({ url: `${O}/p/documentos` }), O)).toBe(false);
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
  it('deploy: cópia gravada por outro build dos estáticos é buscada de novo (os JS/CSS dela saíram do precache); cópia sem build também', () => {
    const agora = Date.parse('2026-10-05T12:00:00Z');
    const recente = new Date(agora - 60_000).toISOString();
    const b1 = idDoBuild([{ url: '/_next/static/chunks/a.js', revision: null }, '/icones/icone-192.png']);
    const b2 = idDoBuild([{ url: '/_next/static/chunks/b.js', revision: null }, '/icones/icone-192.png']);
    expect(b1).toMatch(/^[0-9a-f]{8}$/);
    expect(b1).toBe(idDoBuild([{ url: '/_next/static/chunks/a.js', revision: null }, '/icones/icone-192.png'])); // determinístico
    expect(b2).not.toBe(b1);
    expect(idDoBuild([{ url: '/manifest.webmanifest', revision: '1' }])).not.toBe(idDoBuild([{ url: '/manifest.webmanifest', revision: '2' }]));
    expect(idDoBuild(undefined)).toBe(idDoBuild([]));
    expect(precisaBuscarPlano({ dono: 'd', versao: 'v', guardadoEm: recente, build: b1 }, { dono: 'd', versao: 'v', build: b1 }, agora)).toBe(false);
    expect(precisaBuscarPlano({ dono: 'd', versao: 'v', guardadoEm: recente, build: b1 }, { dono: 'd', versao: 'v', build: b2 }, agora)).toBe(true);
    expect(precisaBuscarPlano({ dono: 'd', versao: 'v', guardadoEm: recente, build: null }, { dono: 'd', versao: 'v', build: b2 }, agora)).toBe(true); // gravada antes deste cabeçalho
    expect(cabecalhosDaCopia(new Headers(), { dono: 'd', versao: 'v', guardadoEm: recente, build: b1 }).get(CABECALHO_BUILD)).toBe(b1);
  });

  it('mensagens ao service worker: só os dois formatos, com textos curtos (nada de objeto arbitrário vindo da página)', () => {
    expect(lerMensagem({ tipo: 'plano', dono: 'd', versao: 'v' })).toEqual({ tipo: 'plano', dono: 'd', versao: 'v' });
    expect(lerMensagem({ tipo: 'dono', dono: 'd' })).toEqual({ tipo: 'dono', dono: 'd' });
    expect(lerMensagem({ tipo: 'plano', dono: 'd' })).toBeNull();
    expect(lerMensagem({ tipo: 'dono', dono: 'x'.repeat(101) })).toBeNull();
    expect(lerMensagem({ tipo: 'apagar-tudo' })).toBeNull();
    expect(lerMensagem('dono')).toBeNull();
  });
  it('a busca do plano terminou fora dele (login, sem acesso, indisponível, termo, escolha) → o plano guardado sai; guardado há mais de 30 dias não é servido', () => {
    expect(saiuDoPlano({ redirected: true, url: `${O}/entrar?volta=%2Fp%2Fplano` }, O)).toBe(true);
    // exclusão atendida / arquivado / anonimizado (RN-08) e consultório suspenso (RN-15): a sessão segue válida
    expect(saiuDoPlano({ redirected: true, url: `${O}/p/sem-acesso` }, O)).toBe(true);
    expect(saiuDoPlano({ redirected: true, url: `${O}/indisponivel` }, O)).toBe(true);
    expect(saiuDoPlano({ redirected: true, url: `${O}/p/termo` }, O)).toBe(true);
    expect(saiuDoPlano({ redirected: true, url: `${O}/p/escolher?volta=%2Fp%2Fplano` }, O)).toBe(true);
    expect(saiuDoPlano({ redirected: true, url: 'https://outro.exemplo.com/p/plano' }, O)).toBe(true);
    // as telas sem plano contam mesmo sem a marca de redirect
    expect(saiuDoPlano({ redirected: false, url: `${O}/p/sem-acesso` }, O)).toBe(true);
    // o próprio plano (direto, ou depois de um redirect que voltou a ele) fica
    expect(saiuDoPlano({ redirected: false, url: `${O}/p/plano` }, O)).toBe(false);
    expect(saiuDoPlano({ redirected: true, url: `${O}/p/plano` }, O)).toBe(false);
    const agora = Date.parse('2026-10-05T12:00:00Z');
    expect(planoValido(new Date(agora - VALIDADE_PLANO_MS + 60_000).toISOString(), agora)).toBe(true);
    expect(planoValido(new Date(agora - VALIDADE_PLANO_MS - 60_000).toISOString(), agora)).toBe(false);
    expect(planoValido(null, agora)).toBe(false);
    expect(planoValido('lixo', agora)).toBe(false);
  });
  it('R7 (Safari iOS 16.4, sem URL.canParse): URL inválida não lança; depois de um redirect conta como fora do plano', () => {
    expect(saiuDoPlano({ redirected: true, url: 'não é uma url' }, O)).toBe(true);
    expect(saiuDoPlano({ redirected: true, url: '' }, O)).toBe(true);
    expect(saiuDoPlano({ redirected: false, url: '' }, O)).toBe(false);
  });
  it('relógio adiantado: cópia com guardado-em no futuro (idade negativa) está vencida e é buscada de novo', () => {
    const agora = Date.parse('2026-10-05T12:00:00Z');
    const futuro = new Date(agora + 60_000).toISOString();
    expect(planoValido(futuro, agora)).toBe(false);
    expect(precisaBuscarPlano({ dono: 'd', versao: 'v', guardadoEm: futuro }, { dono: 'd', versao: 'v' }, agora)).toBe(true);
    // gravada agora mesmo (idade 0): vale e não busca de novo
    const agoraIso = new Date(agora).toISOString();
    expect(planoValido(agoraIso, agora)).toBe(true);
    expect(precisaBuscarPlano({ dono: 'd', versao: 'v', guardadoEm: agoraIso }, { dono: 'd', versao: 'v' }, agora)).toBe(false);
  });
  it('origem da mensagem: a própria origem; vazia (iOS 16.4–16.7) só se o remetente é uma página da própria origem', () => {
    expect(mensagemDaPropriaOrigem(O, null, O)).toBe(true);
    expect(mensagemDaPropriaOrigem(O, `${O}/p/plano`, O)).toBe(true);
    expect(mensagemDaPropriaOrigem('https://outro.com', `${O}/p/plano`, O)).toBe(false);
    expect(mensagemDaPropriaOrigem('', `${O}/p/plano`, O)).toBe(true);
    expect(mensagemDaPropriaOrigem('', 'https://outro.com/p/plano', O)).toBe(false);
    expect(mensagemDaPropriaOrigem('', null, O)).toBe(false); // remetente que não é página (outro worker, porta)
    expect(mensagemDaPropriaOrigem('', 'não é url', O)).toBe(false);
    expect(mensagemDaPropriaOrigem('', '', O)).toBe(false);
  });
  it('cabeçalhos da cópia: os da resposta + dono, versão e data; sem content-length nem content-encoding (o corpo guardado já vem descomprimido)', () => {
    const resposta = new Headers({
      'content-type': 'text/html; charset=utf-8',
      'content-length': '1234',
      'content-encoding': 'br',
      'content-security-policy': "script-src 'nonce-abc'",
    });
    const h = cabecalhosDaCopia(resposta, { dono: 'd', versao: 'v', guardadoEm: '2026-10-05T12:00:00.000Z' });
    expect(h.get('content-type')).toBe('text/html; charset=utf-8');
    expect(h.get('content-security-policy')).toBe("script-src 'nonce-abc'"); // o nonce continua batendo com o HTML
    expect(h.has('content-length')).toBe(false);
    expect(h.has('content-encoding')).toBe(false);
    expect(h.get(CABECALHO_DONO)).toBe('d');
    expect(h.get(CABECALHO_VERSAO)).toBe('v');
    expect(h.get(CABECALHO_GUARDADO_EM)).toBe('2026-10-05T12:00:00.000Z');
    expect(resposta.get('content-length')).toBe('1234'); // não mexe nos cabeçalhos da resposta
  });

  it('urlDaNotificacao: só abre endereço da própria origem (o push poderia trazer outro); senão o início do portal', () => {
    expect(urlDaNotificacao('https://nutri.exemplo.com/p/diario', O)).toBe('https://nutri.exemplo.com/p/diario');
    // o consultório do aviso (?v=, link-portal.ts) chega intacto ao portal
    expect(urlDaNotificacao('https://nutri.exemplo.com/p/plano?v=0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f', O)).toBe('https://nutri.exemplo.com/p/plano?v=0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f');
    expect(urlDaNotificacao('https://evil.example/x', O)).toBe('/p/inicio');
    expect(urlDaNotificacao('https://nutri.exemplo.com.evil.example/p/diario', O)).toBe('/p/inicio');
    expect(urlDaNotificacao(null, O)).toBe('/p/inicio');
    expect(urlDaNotificacao(42, O)).toBe('/p/inicio');
    expect(urlDaNotificacao('javascript:alert(1)', O)).toBe('/p/inicio');
    expect(urlDaNotificacao('/p/plano', O)).toBe('/p/inicio'); // R7: URL relativa não lança (sem URL.canParse), só não vale
  });
});

/** Cache Storage de mentira (o teste roda em Node): um cache com no máximo a cópia de "Meu plano". */
function cacheStorage(copia: { dono?: string } | null) {
  const caches = new Map<string, Map<string, Response>>();
  if (copia) {
    const h = new Headers({ 'content-type': 'text/html' });
    if (copia.dono) h.set(CABECALHO_DONO, copia.dono);
    caches.set(CACHE_PLANO, new Map([[URL_PLANO, new Response('<html>plano</html>', { headers: h })]]));
  }
  return {
    has: async (nome: string) => caches.has(nome),
    open: async (nome: string) => {
      const c = caches.get(nome) ?? new Map<string, Response>();
      caches.set(nome, c);
      return { match: async (url: string) => c.get(url) };
    },
    delete: async (nome: string) => caches.delete(nome),
    existe: () => caches.has(CACHE_PLANO),
  };
}

describe('/p/escolher: a cópia offline sai só se for de quem não está entre os escolhíveis (achado 4 do /code-review)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('do consultório ativo fica; do suspenso (ou de outra conta) e sem dono sai; sem cópia, nada é criado', async () => {
    for (const [copia, manter, fica] of [
      [{ dono: 'paciente-ativo' }, ['paciente-ativo', 'outro-ativo'], true],
      [{ dono: 'paciente-suspenso' }, ['paciente-ativo'], false],
      [{}, ['paciente-ativo'], false],
      [null, ['paciente-ativo'], false],
    ] as const) {
      const c = cacheStorage(copia);
      vi.stubGlobal('caches', c);
      await esquecerPlanoGuardadoForaDe(manter);
      expect(c.existe()).toBe(fica);
    }
  });
});

describe('P09-05 (D8): as regras do service worker nunca tratam o painel', () => {
  it('navegação e "Meu plano" só em /p/: /painel, /painel/pacientes/… e /conta ficam de fora', () => {
    for (const p of ['/painel', '/painel/', '/painel/pacientes/123', '/painel.webmanifest', '/conta/seguranca', '/p']) {
      expect(ehNavegacaoDoPortal(new URL(`${O}${p}`), 'navigate', O), p).toBe(false);
      expect(ehPaginaDoPlano(new URL(`${O}${p}`), 'navigate', O), p).toBe(false);
    }
  });
});
