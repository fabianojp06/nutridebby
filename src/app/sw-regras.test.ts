import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MSG_PORTAL_MENSAGENS } from '@/modules/mensagens/constantes';
import {
  CABECALHO_BUILD,
  CABECALHO_DONO,
  CABECALHO_GUARDADO_EM,
  CABECALHO_PEDIDO_DA_COPIA,
  CABECALHO_VERSAO,
  cabecalhosDaCopia,
  CACHE_PLANO,
  deveRecarregarAoVoltar,
  EVENTO_REDE_VOLTOU,
  ehConversaDoPortal,
  ehCopiaOffline,
  ehNavegacaoDoPortal,
  ehPaginaDoPlano,
  esquecerPlanoGuardadoForaDe,
  idDoBuild,
  lerMensagem,
  MARCA_DA_COPIA,
  mensagemDaPropriaOrigem,
  paginaSemConexao,
  planoValido,
  podeGuardarPlano,
  precisaBuscarPlano,
  recarregarCopiaAoVoltar,
  RENOVAR_PLANO_MS,
  SAINDO_SEM_DESCARREGAR_MS,
  saiuDoPlano,
  TEXTO_SEM_CONEXAO,
  TEXTO_URGENCIA,
  URL_PLANO,
  urlDaNotificacao,
  VALIDADE_PLANO_MS,
  vigiarSaida,
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

// Plano 25, T7 (RN-473, CH-D46): a conversa nunca fica no aparelho e, sem rede, nunca mostra o plano no lugar dela
describe('Plano 25 (T7): /p/mensagens fora do cache e do plano guardado', () => {
  it('/p/mensagens (com ou sem query, e as subpáginas) não casa com a navegação do portal nem com "Meu plano"; casa só com a regra da conversa', () => {
    for (const p of ['/p/mensagens', '/p/mensagens?v=00000000-0000-4000-8000-000000000001', '/p/mensagens?antes=x', '/p/mensagens/']) {
      const u = new URL(`${O}${p}`);
      expect(ehNavegacaoDoPortal(u, 'navigate', O), p).toBe(false);
      expect(ehPaginaDoPlano(u, 'navigate', O), p).toBe(false);
      expect(ehConversaDoPortal(u, 'navigate', O), p).toBe(true);
    }
    expect(ehConversaDoPortal(new URL(`${O}/p/mensagens`), 'cors', O)).toBe(false); // RSC do roteador: rede, sem regra
    expect(ehConversaDoPortal(new URL('https://outro.com/p/mensagens'), 'navigate', O)).toBe(false);
    expect(ehConversaDoPortal(new URL(`${O}/p/mensagens-antigas`), 'navigate', O)).toBe(false);
    expect(ehNavegacaoDoPortal(new URL(`${O}/p/mensagens-antigas`), 'navigate', O)).toBe(true);
    expect(ehNavegacaoDoPortal(new URL(`${O}/p/inicio`), 'navigate', O)).toBe(true);
    expect(podeGuardarPlano(resposta({ url: `${O}/p/mensagens` }), O)).toBe(false);
  });

  it('sem rede: a página do aviso — "Sem conexão. Escreva quando voltar." na região de status, nada guardado, nenhum dado do paciente', async () => {
    const r = paginaSemConexao();
    expect(r.status).toBe(503);
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const html = await r.text();
    expect(TEXTO_SEM_CONEXAO).toBe(MSG_PORTAL_MENSAGENS.erros.semInternet);
    expect(html).toMatch(/<html lang="pt-BR">/);
    expect(html).toMatch(/<title>Mensagens<\/title>/);
    expect(html).toMatch(/<h1>Mensagens<\/h1>/);
    expect(html).toContain(`<p role="status">${MSG_PORTAL_MENSAGENS.erros.semInternet}</p>`);
    expect(html).toMatch(/<a href="\/p\/inicio"[^>]*>Voltar para Hoje<\/a>/);
    expect(html).not.toMatch(/<script/);
  });

  it('rodada da T7 (CFN M3, minor): a página sem rede tem o aviso de urgência (RN-450) com o 192 discável; "Voltar para Hoje" com 44 px', async () => {
    expect(TEXTO_URGENCIA).toBe(MSG_PORTAL_MENSAGENS.avisoUrgencia);
    const html = await paginaSemConexao().text();
    expect(html.replace(/<[^>]+>/g, '')).toContain(MSG_PORTAL_MENSAGENS.avisoUrgencia);
    expect(html).toMatch(/<a href="tel:192" style="display:inline-block;padding:12px 0">192<\/a>/);
    expect(html).not.toMatch(/tel:192"[^>]*line-height/);
    expect(html).toMatch(/<a href="\/p\/inicio" style="[^"]*min-height:44px[^"]*">Voltar para Hoje<\/a>/);
  });

  it('sw.ts: a regra da conversa vem antes da navegação do portal e responde a página do aviso; só /p/plano vai para o cache; a busca da cópia avisa o servidor (o link "Mensagens" sai sem contador)', () => {
    const sw = readFileSync('src/app/sw.ts', 'utf8');
    const conversa = sw.indexOf('ehConversaDoPortal(url, request.mode, origem)');
    const navegacao = sw.indexOf('ehNavegacaoDoPortal(url, request.mode, origem)');
    expect(conversa).toBeGreaterThan(0);
    expect(conversa).toBeLessThan(navegacao);
    expect(sw.slice(conversa, navegacao)).toMatch(/new NetworkOnly\(\{ plugins: \[\{ handlerDidError: async \(\) => paginaSemConexao\(\) \}\] \}\)/);
    expect(sw.slice(conversa, navegacao)).not.toMatch(/planoGuardado|cacheName/);
    const puts = [...sw.matchAll(/\.put\(([^,]+),/g)].map((m) => m[1].trim());
    expect(puts).toEqual(['URL_PLANO']);
    expect(sw).toMatch(/fetch\(URL_PLANO, \{[^}]*headers: \{ \[CABECALHO_PEDIDO_DA_COPIA\]: '1' \}/);
    expect(CABECALHO_PEDIDO_DA_COPIA).toBe('x-nd-copia');
  });
});

// SUS-112: o `reloadOnOnline` padrão do Serwist recarregava qualquer página do portal quando a rede voltava e apagava o que o
// paciente digitava. A regra é por PERMISSÃO: só o documento que é a cópia offline de "Meu plano" recarrega — nunca uma lista
// de rotas excluídas (a do Plano 25 só excluía /p/mensagens, e o questionário do Plano 27 continuava perdendo as respostas).
const COPIA = `<main><span hidden="" ${MARCA_DA_COPIA}=""></span><h2>Plano de outubro</h2><button disabled>Comi assim</button></main>`;
/** Um `document` mínimo sobre o HTML: `querySelector('[atributo]')` acha o elemento se o atributo está numa tag. */
const temAtributo = (html: string, seletor: string) => {
  const atributo = /^\[([a-z-]+)\]$/.exec(seletor)?.[1];
  if (!atributo) throw new Error(`seletor inesperado: ${seletor}`);
  return new RegExp(`<[a-z]+[^>]*\\s${atributo}(=|\\s|>|/)`).test(html) ? {} : null;
};
const documentoDe = (html: string) => ({ querySelector: (seletor: string) => temAtributo(html, seletor) });

describe('SUS-112: ao voltar a rede, recarrega só a cópia offline (lista de permissão)', () => {
  const voltou = (html: string, o: { saindo?: boolean; online?: boolean } = {}) =>
    deveRecarregarAoVoltar({ copia: ehCopiaOffline(documentoDe(html)), saindo: o.saindo ?? false, online: o.online ?? true });

  it('a cópia do plano recarrega quando a rede volta (a mesma marca em /p/plano do NetworkFirst ou em /p/inicio do handlerDidError)', () => {
    expect(ehCopiaOffline(documentoDe(COPIA))).toBe(true);
    expect(voltou(COPIA)).toBe(true);
  });

  it.each([
    ['/p/diario', '<form><label for="texto">O que você comeu?</label><textarea id="texto" name="texto">Arroz e feijão</textarea><button>Registrar</button></form>'],
    ['/p/questionarios/x', '<form><fieldset><legend>Como foi a semana?</legend><input type="radio" name="q1" checked><textarea name="q2">Dormi mal</textarea></fieldset></form>'],
    ['/p/exames (envio de exame)', '<form><input type="file" name="arquivos"><input type="text" name="descricao" value="Hemograma"><button>Enviar</button></form>'],
    ['/p/inicio', '<main><h1>Olá, Paula</h1><a href="/p/diario">Registrar refeição</a></main>'],
    ['/p/plano aberto da rede', '<main><h2>Plano de outubro</h2><button>Comi assim</button></main>'],
    ['/p/mensagens', '<form><textarea name="texto">Oi</textarea></form>'],
  ])('%s, página viva (não é a cópia): nunca recarrega — com ou sem formulário, com rede e ficando', (_rota, html) => {
    expect(ehCopiaOffline(documentoDe(html))).toBe(false);
    expect(voltou(html)).toBe(false);
  });

  it('a cópia que está saindo (beforeunload/pagehide) não recarrega: o reload atropelaria a navegação em curso (P09-04)', () => {
    expect(voltou(COPIA, { saindo: true })).toBe(false);
  });

  it('sem rede de fato não recarrega — defensivo: o `online` chega com navigator.onLine verdadeiro, mas a decisão não confia no evento', () => {
    expect(voltou(COPIA, { online: false })).toBe(false);
  });

  it('a regra não olha o endereço: nenhum pathname entra na decisão (permissão pela marca, não exclusão por rota)', () => {
    const provider = readFileSync('src/app/p/sw-provider.tsx', 'utf8');
    expect(provider).toMatch(/reloadOnOnline=\{false\}/);
    expect(provider).toMatch(/recarregarCopiaAoVoltar\(\{ janela: window, documento: document, online: \(\) => navigator\.onLine, recarregar: \(\) => window\.location\.reload\(\) \}\)/);
    expect(provider).not.toMatch(/location\.pathname/);
    expect(provider.match(/location\.reload\(\)/g)).toHaveLength(1); // um caminho só de recarregar
    expect(readFileSync('src/app/sw-regras.ts', 'utf8')).not.toMatch(/export function deveRecarregarAoVoltar\(o: \{[^}]*pathname/);
  });

  it('só a busca da cópia (guardarPlano, no service worker) leva o cabeçalho que faz o servidor desenhar a marca', () => {
    expect(CABECALHO_PEDIDO_DA_COPIA).toBe('x-nd-copia');
    expect(MARCA_DA_COPIA).toBe('data-nd-copia-offline');
    const sw = readFileSync('src/app/sw.ts', 'utf8');
    expect(sw).toMatch(/fetch\(URL_PLANO, \{[^}]*headers: \{ \[CABECALHO_PEDIDO_DA_COPIA\]: '1' \}/);
    expect(sw.match(/CABECALHO_PEDIDO_DA_COPIA\]/g)).toHaveLength(1);
  });
});

/** `window` e `document` de mentira: EventTargets com o HTML da página, o `visibilityState` e os ouvintes contados. */
const pagina = (html: string) => {
  const contar = (t: EventTarget) => {
    const ouvintes = new Map<string, number>();
    const add = t.addEventListener.bind(t);
    const rem = t.removeEventListener.bind(t);
    t.addEventListener = (tipo: string, f: EventListenerOrEventListenerObject | null, op?: boolean | AddEventListenerOptions) => {
      ouvintes.set(tipo, (ouvintes.get(tipo) ?? 0) + 1);
      add(tipo, f, op);
    };
    t.removeEventListener = (tipo: string, f: EventListenerOrEventListenerObject | null, op?: boolean | EventListenerOptions) => {
      ouvintes.set(tipo, (ouvintes.get(tipo) ?? 0) - 1);
      rem(tipo, f, op);
    };
    return ouvintes;
  };
  const janela = new EventTarget();
  const documento = Object.assign(new EventTarget(), { visibilityState: 'visible', querySelector: (s: string) => temAtributo(html, s) });
  const ouvintes = { janela: contar(janela), documento: contar(documento) };
  const evento = (alvo: EventTarget, tipo: string, persisted?: boolean) => alvo.dispatchEvent(Object.assign(new Event(tipo), persisted === undefined ? {} : { persisted }));
  const ativos = () => [...ouvintes.janela.values(), ...ouvintes.documento.values()].reduce((a, b) => a + b, 0);
  return { janela, documento, evento, ativos, ouvintes };
};

describe('SUS-112: recarregarCopiaAoVoltar (ouvintes só na cópia, um caminho de recarregar, pendência)', () => {
  afterEach(() => vi.useRealTimers());
  const montar = (html: string, rede = { online: true }) => {
    const p = pagina(html);
    const recarregar = vi.fn();
    const vigia = recarregarCopiaAoVoltar({ janela: p.janela, documento: p.documento, online: () => rede.online, recarregar, relogio: globalThis });
    return { ...p, recarregar, vigia, rede };
  };

  it('página viva: nenhum ouvinte (nem beforeunload: o Firefox continua usando o bfcache) e nunca recarrega', () => {
    const v = montar('<form><textarea name="texto">Arroz</textarea></form>');
    expect(v.vigia).toBeNull();
    expect(v.ativos()).toBe(0);
    v.evento(v.janela, 'online');
    v.evento(v.janela, EVENTO_REDE_VOLTOU);
    expect(v.recarregar).not.toHaveBeenCalled();
  });

  it('cópia: o `online` recarrega uma vez só, mesmo com o ping recuperado logo depois (um caminho)', () => {
    const v = montar(COPIA);
    expect(v.ouvintes.janela.get('beforeunload')).toBe(1);
    v.evento(v.janela, 'online');
    v.evento(v.janela, EVENTO_REDE_VOLTOU);
    v.evento(v.janela, 'online');
    expect(v.recarregar).toHaveBeenCalledTimes(1);
    v.vigia!.parar();
    expect(v.ativos()).toBe(0);
  });

  it('cópia servida pelo NetworkFirst com navigator.onLine verdadeiro: o ping recuperado (EVENTO_REDE_VOLTOU) recarrega', () => {
    const v = montar(COPIA);
    v.evento(v.janela, EVENTO_REDE_VOLTOU);
    expect(v.recarregar).toHaveBeenCalledTimes(1);
  });

  it('sem rede de fato o evento não recarrega nem deixa pendência; o próximo `online` com rede recarrega', () => {
    vi.useFakeTimers();
    const v = montar(COPIA, { online: false });
    v.evento(v.janela, 'online');
    vi.advanceTimersByTime(60_000);
    expect(v.recarregar).not.toHaveBeenCalled();
    v.rede.online = true;
    v.evento(v.janela, 'online');
    expect(v.recarregar).toHaveBeenCalledTimes(1);
  });

  it('pulado porque estava saindo (beforeunload sem descarregar): tenta de novo quando o prazo de 5 s zera o "saindo"', () => {
    vi.useFakeTimers();
    const v = montar(COPIA);
    v.evento(v.janela, 'beforeunload');
    v.evento(v.janela, 'online');
    expect(v.recarregar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SAINDO_SEM_DESCARREGAR_MS - 1);
    expect(v.recarregar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(v.recarregar).toHaveBeenCalledTimes(1);
  });

  it('pagehide sem descarregar (iOS/PWA ao trocar de app): o pageshow SEM persisted zera o "saindo" e a pendência recarrega', () => {
    const v = montar(COPIA);
    v.evento(v.janela, 'pagehide');
    v.evento(v.janela, 'online');
    expect(v.recarregar).not.toHaveBeenCalled();
    v.evento(v.janela, 'pageshow', false);
    expect(v.recarregar).toHaveBeenCalledTimes(1);
  });

  it('pagehide sem descarregar: o visibilitychange para visible zera o "saindo" e a pendência recarrega (hidden não)', () => {
    const v = montar(COPIA);
    v.evento(v.janela, 'pagehide');
    v.evento(v.janela, EVENTO_REDE_VOLTOU);
    v.documento.visibilityState = 'hidden';
    v.evento(v.documento, 'visibilitychange');
    expect(v.recarregar).not.toHaveBeenCalled();
    v.documento.visibilityState = 'visible';
    v.evento(v.documento, 'visibilitychange');
    expect(v.recarregar).toHaveBeenCalledTimes(1);
  });

  it('sem pendência, "saindo" que zera não recarrega sozinho (só a rede de volta decide)', () => {
    vi.useFakeTimers();
    const v = montar(COPIA);
    v.evento(v.janela, 'beforeunload');
    vi.advanceTimersByTime(SAINDO_SEM_DESCARREGAR_MS);
    v.evento(v.janela, 'pageshow', true);
    expect(v.recarregar).not.toHaveBeenCalled();
  });
});

// Um `beforeunload` que não descarrega a página (download, `tel:`, `mailto:`) deixaria `saindo` verdadeiro para sempre — a
// cópia nunca mais recarregaria ao voltar a rede. Molde: Plano 25 (04afaea), com o pageshow e o visibilitychange do SUS-112.
describe('SUS-112: vigiarSaida (o "saindo" do reload ao reconectar)', () => {
  afterEach(() => vi.useRealTimers());

  it('beforeunload sem descarregar: "saindo" zera sozinho em 5 s e avisa (aoFicar)', () => {
    vi.useFakeTimers();
    const p = pagina(COPIA);
    const aoFicar = vi.fn();
    const s = vigiarSaida(p.janela, { documento: p.documento, relogio: globalThis, aoFicar });
    expect(s.saindo()).toBe(false);
    p.evento(p.janela, 'beforeunload');
    expect(s.saindo()).toBe(true);
    vi.advanceTimersByTime(SAINDO_SEM_DESCARREGAR_MS - 1);
    expect(s.saindo()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(s.saindo()).toBe(false);
    expect(aoFicar).toHaveBeenCalledTimes(1);
    expect(SAINDO_SEM_DESCARREGAR_MS).toBe(5_000);
    s.parar();
  });

  it('pagehide marca sem prazo; qualquer pageshow (com ou sem persisted) desmarca; parar tira os ouvintes e o temporizador', () => {
    vi.useFakeTimers();
    const p = pagina(COPIA);
    const s = vigiarSaida(p.janela, { documento: p.documento, relogio: globalThis });
    p.evento(p.janela, 'beforeunload');
    p.evento(p.janela, 'pagehide');
    vi.advanceTimersByTime(60_000);
    expect(s.saindo()).toBe(true);
    p.evento(p.janela, 'pageshow', false);
    expect(s.saindo()).toBe(false);
    p.evento(p.janela, 'pagehide');
    p.evento(p.janela, 'pageshow', true); // de volta do bfcache
    expect(s.saindo()).toBe(false);
    p.evento(p.janela, 'beforeunload');
    s.parar();
    expect(vi.getTimerCount()).toBe(0);
    expect(p.ativos()).toBe(0);
    p.evento(p.janela, 'pageshow', true);
    expect(s.saindo()).toBe(true); // sem ouvintes: nada mais o muda
  });
});

// Plano 25 (RN-473, US-443 "Sem internet"; E2E "rodada T6b (I4)"): a rede que volta não recarrega a conversa — o rascunho
// escrito sem rede fica. Desde o SUS-112 vale pela regra de permissão: a conversa é página viva, nunca a cópia (sem a marca).
describe('Plano 25: a rede que volta não recarrega a conversa (o rascunho fica), pela regra do SUS-112', () => {
  it('a conversa com rascunho não é a cópia e não recarrega — com rede de volta e a página ficando', () => {
    const conversa = '<main><h1>Mensagens</h1><form><label for="texto">Mensagem</label><textarea id="texto" name="texto">Oi, posso trocar o lanche?</textarea><button>Enviar</button></form></main>';
    expect(ehCopiaOffline(documentoDe(conversa))).toBe(false);
    expect(deveRecarregarAoVoltar({ copia: ehCopiaOffline(documentoDe(conversa)), saindo: false, online: true })).toBe(false);
  });

  it('a tela da conversa nunca desenha a marca da cópia nem lê o cabeçalho da busca da cópia; e sem o selo offline', () => {
    const dir = 'src/app/p/(portal)/mensagens';
    for (const f of ['page.tsx', 'conversa-portal.tsx', 'lista.tsx', 'socorro.tsx']) {
      const src = readFileSync(`${dir}/${f}`, 'utf8');
      expect(src, f).not.toMatch(/MARCA_DA_COPIA|data-nd-copia-offline|CABECALHO_PEDIDO_DA_COPIA/);
    }
    expect(readFileSync(`${dir}/page.tsx`, 'utf8')).toMatch(/seloOffline=\{false\}/);
  });
});
