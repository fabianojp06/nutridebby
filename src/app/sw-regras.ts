/**
 * D6: o que o service worker guarda. Sem DOM nem Node: o mesmo arquivo vai para o service worker (esbuild do Serwist)
 * e para o cliente (o "Sair" apaga o cache pelo nome).
 */
export const CACHE_PLANO = 'nd-plano-v1';
export const URL_PLANO = '/p/plano';

/** R7: `URL.canParse` só existe a partir do Safari 17; o RNF-09 pede Safari iOS 16.4+. */
const urlOuNull = (s: string): URL | null => {
  try {
    return new URL(s);
  } catch {
    return null;
  }
};

export function ehPaginaDoPlano(url: URL, modo: RequestMode, origem: string): boolean {
  return modo === 'navigate' && url.origin === origem && url.pathname === URL_PLANO && url.search === '';
}

/** Plano 25 (RN-473, CH-D46): a conversa do portal — nunca guardada no aparelho e, sem rede, nunca o plano no lugar dela. */
export const URL_CONVERSA = '/p/mensagens';
const ehDaConversa = (pathname: string) => pathname === URL_CONVERSA || pathname.startsWith(`${URL_CONVERSA}/`);

export function ehNavegacaoDoPortal(url: URL, modo: RequestMode, origem: string): boolean {
  return modo === 'navigate' && url.origin === origem && url.pathname.startsWith('/p/') && !ehDaConversa(url.pathname);
}

/** A navegação para a conversa (/p/mensagens): só rede; sem rede, a página do aviso (paginaSemConexao), sem cache. */
export function ehConversaDoPortal(url: URL, modo: RequestMode, origem: string): boolean {
  return modo === 'navigate' && url.origin === origem && ehDaConversa(url.pathname);
}

/** §6.2 "Portal: conversa" (sem internet): o mesmo texto de MSG_PORTAL_MENSAGENS.erros.semInternet (teste de igualdade). */
export const TEXTO_SEM_CONEXAO = 'Sem conexão. Escreva quando voltar.';
/** RN-450: o aviso de urgência da conversa — o mesmo texto de MSG_PORTAL_MENSAGENS.avisoUrgencia (teste de igualdade). */
export const TEXTO_URGENCIA = 'Este canal não é para urgências. Em caso de urgência, ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo.';

/** Alvo de toque de 44 px sem CSS do app (a página é montada no service worker; sem Content-Security-Policy própria). */
const ALVO_44 = 'display:inline-block;min-height:44px;line-height:44px';

/**
 * RN-473 e US-443 ("Sem internet"): o que a navegação para /p/mensagens recebe sem rede — uma página mínima, montada aqui
 * (nada vem do cache), com o aviso na região de status, o aviso de urgência da RN-450 (o 192 discável; rodada da T7, CFN
 * M3) e o "Voltar" para Hoje. Sem script e sem nenhum dado do paciente.
 */
export function paginaSemConexao(): Response {
  // o 192 em linha: padding vertical (44 px de toque) sem mudar a altura da linha nem quebrar a frase (molde ComTelefones)
  const urgencia = TEXTO_URGENCIA.replace(/\b192\b/, '<a href="tel:192" style="display:inline-block;padding:12px 0">192</a>');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Mensagens</title></head><body><main><h1>Mensagens</h1><p role="status">${TEXTO_SEM_CONEXAO}</p><p>${urgencia}</p><p><a href="/p/inicio" style="${ALVO_44}">Voltar para Hoje</a></p></main></body></html>`;
  return new Response(html, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/** O documento na tela é a cópia offline de "Meu plano"? Pela marca que só o HTML guardado leva (MARCA_DA_COPIA). */
export function ehCopiaOffline(documento: { querySelector: (seletor: string) => unknown }): boolean {
  return documento.querySelector(`[${MARCA_DA_COPIA}]`) != null;
}

/**
 * SUS-112: quando a rede volta, o portal recarrega SÓ a cópia offline (lista de permissão, nunca de rotas excluídas): é o
 * único documento que precisa virar a página de verdade. Uma página viva (diário, questionário, envio de exame, Hoje…)
 * nunca recarrega — o que o paciente digitava se perdia (o `reloadOnOnline` padrão do Serwist recarregava qualquer página).
 * E só com a rede de fato de volta (`navigator.onLine`) e a página ficando: no Chrome sem rede o `online` chega entre o
 * `beforeunload` e a troca de documento, e o reload passava por cima da navegação em curso (o "navega sozinha" do P09-04).
 */
export function deveRecarregarAoVoltar(o: { copia: boolean; saindo: boolean; online: boolean }): boolean {
  return o.copia && o.online && !o.saindo;
}

/**
 * Quanto o `beforeunload` vale como "saindo" sem a página descarregar. Um `beforeunload` que não descarrega (download,
 * `tel:`, `mailto:`) deixaria `saindo` verdadeiro para sempre, e a cópia nunca mais recarregaria ao voltar a rede. A troca
 * de documento que a marca protege leva bem menos que isto (sem rede, o service worker responde).
 */
export const SAINDO_SEM_DESCARREGAR_MS = 5_000;

type Relogio = { setTimeout: (f: () => void, ms: number) => unknown; clearTimeout: (t: never) => void };
type Documento = EventTarget & { visibilityState?: string; querySelector: (seletor: string) => unknown };

/**
 * A página está saindo? `beforeunload` marca e, se a página não descarregar em `SAINDO_SEM_DESCARREGAR_MS`, desmarca;
 * `pagehide` marca sem prazo. Desmarcam: QUALQUER `pageshow` (a volta do bfcache e o `pagehide` que não descarregou) e o
 * `visibilitychange` para `visible` (no iOS/PWA o `pagehide` vem ao trocar de app sem a página sair — sem isto, "saindo"
 * ficaria preso para sempre). `aoFicar` avisa cada vez que "saindo" volta a falso. Sem DOM: os eventos chegam por `janela`
 * (a `window`) e `documento` (o `document`), injetáveis nos testes. Devolve a leitura e o "parar".
 */
export function vigiarSaida(
  janela: EventTarget,
  o: { documento?: Documento; relogio?: Relogio; aoFicar?: () => void } = {},
): { saindo: () => boolean; parar: () => void } {
  const relogio = o.relogio ?? (globalThis as unknown as Relogio);
  let saindo = false;
  let timer: unknown;
  const limpar = () => {
    if (timer !== undefined) relogio.clearTimeout(timer as never);
    timer = undefined;
  };
  const ficar = () => {
    limpar();
    if (!saindo) return;
    saindo = false;
    o.aoFicar?.();
  };
  const aoAvisarSaida = () => {
    saindo = true;
    limpar();
    timer = relogio.setTimeout(() => {
      timer = undefined;
      ficar(); // o `tel:`/download não descarregou: a página ficou
    }, SAINDO_SEM_DESCARREGAR_MS);
  };
  const aoEsconder = () => {
    limpar();
    saindo = true;
  };
  const aoVer = () => {
    if (o.documento?.visibilityState === 'visible') ficar();
  };
  janela.addEventListener('beforeunload', aoAvisarSaida);
  janela.addEventListener('pagehide', aoEsconder);
  janela.addEventListener('pageshow', ficar);
  o.documento?.addEventListener('visibilitychange', aoVer);
  return {
    saindo: () => saindo,
    parar: () => {
      limpar();
      janela.removeEventListener('beforeunload', aoAvisarSaida);
      janela.removeEventListener('pagehide', aoEsconder);
      janela.removeEventListener('pageshow', ficar);
      o.documento?.removeEventListener('visibilitychange', aoVer);
    },
  };
}

/**
 * SUS-112: evento da `window` que o selo offline dispara quando o ping (`/api/p/ping`) volta a responder depois de falhar.
 * Cobre a cópia servida pelo NetworkFirst com `navigator.onLine` verdadeiro o tempo todo (rede lenta), sem evento `online`.
 */
export const EVENTO_REDE_VOLTOU = 'nd:rede-voltou';

/**
 * SUS-112: o recarregamento da cópia quando a rede volta. Na página viva devolve `null` sem instalar nenhum ouvinte (sem
 * `beforeunload`, o Firefox continua usando o bfcache). Na cópia, um caminho só (`tentar`), chamado pelo `online` e pelo
 * EVENTO_REDE_VOLTOU, decide por `deveRecarregarAoVoltar` e recarrega no máximo uma vez; pulado porque a página estava
 * saindo, fica pendente e tenta de novo quando "saindo" volta a falso (prazo de 5 s, `pageshow`, `visibilitychange`).
 */
export function recarregarCopiaAoVoltar(o: {
  janela: EventTarget;
  documento: Documento;
  online: () => boolean;
  recarregar: () => void;
  relogio?: Relogio;
}): { parar: () => void } | null {
  if (!ehCopiaOffline(o.documento)) return null;
  let pendente = false;
  let recarregou = false;
  const tentar = () => {
    if (recarregou) return;
    const decisao = { copia: ehCopiaOffline(o.documento), online: o.online(), saindo: saida.saindo() };
    pendente = decisao.copia && decisao.online && decisao.saindo;
    if (!deveRecarregarAoVoltar(decisao)) return;
    recarregou = true;
    o.recarregar();
  };
  const saida = vigiarSaida(o.janela, { documento: o.documento, relogio: o.relogio, aoFicar: () => pendente && tentar() });
  o.janela.addEventListener('online', tentar);
  o.janela.addEventListener(EVENTO_REDE_VOLTOU, tentar);
  return {
    parar: () => {
      saida.parar();
      o.janela.removeEventListener('online', tentar);
      o.janela.removeEventListener(EVENTO_REDE_VOLTOU, tentar);
    },
  };
}

export function podeGuardarPlano(r: { status: number; type: ResponseType; redirected: boolean; url: string; headers: Headers }, origem: string): boolean {
  if (r.status !== 200 || r.type !== 'basic' || r.redirected) return false;
  const u = urlOuNull(r.url);
  return !!u && u.origin === origem && u.pathname === URL_PLANO && (r.headers.get('content-type') ?? '').startsWith('text/html');
}

/**
 * Telas que dizem que não há mais plano a mostrar: sem sessão (/entrar), sem vínculo ativo (/p/sem-acesso — exclusão
 * atendida, arquivado, anonimizado) e consultório suspenso (/indisponivel, o SUSPENDED_PATH).
 */
export const PAGINAS_SEM_PLANO: readonly string[] = ['/entrar', '/p/sem-acesso', '/indisponivel'];

/**
 * A busca de "Meu plano" não terminou nele: o servidor mandou para outra tela (login, sem acesso, indisponível, termo,
 * escolha do consultório…) — a cópia guardada sai. Nada de manter o plano de quem perdeu o acesso por até 30 dias
 * (LGPD: minimização). Endereço que não se lê depois de um redirect também conta como fora do plano.
 */
export function saiuDoPlano(r: { redirected: boolean; url: string }, origem: string): boolean {
  const u = urlOuNull(r.url);
  if (u && u.origin === origem && PAGINAS_SEM_PLANO.includes(u.pathname)) return true;
  if (!r.redirected) return false;
  return !u || u.origin !== origem || u.pathname !== URL_PLANO;
}

/**
 * Review Focus 4 (aparelho compartilhado): o HTML guardado leva de quem é (`dono` = o paciente da sessão, isto é, conta +
 * vínculo) e de qual versão do plano, nestes cabeçalhos da cópia em Cache Storage (nunca vão para a rede).
 */
export const CABECALHO_DONO = 'x-nd-dono';
export const CABECALHO_VERSAO = 'x-nd-versao';
export const CABECALHO_GUARDADO_EM = 'x-nd-guardado-em';
/**
 * O build dos estáticos (precache) com que a cópia foi gravada. O HTML guardado aponta para os JS/CSS daquele build; um
 * deploy troca o service worker, que apaga do precache os estáticos antigos — a cópia de outro build não abre offline.
 */
export const CABECALHO_BUILD = 'x-nd-build';
/**
 * Vai NA BUSCA que guardarPlano faz de /p/plano (nunca na navegação do paciente). Com ele, o servidor desenha a marca da
 * cópia (MARCA_DA_COPIA) no HTML que fica guardado no aparelho e (Plano 25, RN-473) o link "Mensagens" da faixa sem o
 * "({n})": a cópia guardada fica dias no aparelho e o número dela seria velho.
 */
export const CABECALHO_PEDIDO_DA_COPIA = 'x-nd-copia';
/**
 * SUS-112: atributo do elemento que só existe no HTML da cópia offline de "Meu plano" (desenhado quando a busca leva
 * CABECALHO_PEDIDO_DA_COPIA). A página aberta da rede nunca o tem; a cópia, servida em qualquer endereço do portal sem
 * rede, sempre.
 */
export const MARCA_DA_COPIA = 'data-nd-copia-offline';
/** O mesmo prazo da sessão (que desliza, P06-11): uma cópia mais velha que isto não tem sessão viva por trás. */
export const VALIDADE_PLANO_MS = 30 * 24 * 60 * 60 * 1000;
/** Cópia com mais de 1 dia é buscada de novo na visita a "Meu plano" (mesmo dono e versão): a validade anda junto com a sessão. */
export const RENOVAR_PLANO_MS = 24 * 60 * 60 * 1000;

export type MensagemAoSw = { tipo: 'dono'; dono: string } | { tipo: 'plano'; dono: string; versao: string };

const textoCurto = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 100;

/** O que a página pode pedir ao service worker: só estes dois formatos. */
export function lerMensagem(data: unknown): MensagemAoSw | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as { tipo?: unknown; dono?: unknown; versao?: unknown };
  if (d.tipo === 'dono' && textoCurto(d.dono)) return { tipo: 'dono', dono: d.dono };
  if (d.tipo === 'plano' && textoCurto(d.dono) && textoCurto(d.versao)) return { tipo: 'plano', dono: d.dono, versao: d.versao };
  return null;
}

/**
 * Identificador do build: um hash (FNV-1a, 32 bits) das URLs e revisões do manifesto do precache — muda a cada deploy que
 * muda os estáticos (os nomes de `.next/static` levam hash do conteúdo).
 */
export function idDoBuild(entradas: readonly (string | { url: string; revision?: string | null })[] | undefined): string {
  let h = 0x811c9dc5;
  for (const e of entradas ?? []) {
    const texto = typeof e === 'string' ? e : `${e.url}#${e.revision ?? ''}`;
    for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0x0a, 0x01000193); // separador entre entradas
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Buscar de novo se não há cópia, se ela é de outro dono, de outra versão do plano ou de outro build dos estáticos, ou se
 * tem mais de 1 dia (no máximo uma renderização extra por dia; sem isso o `guardado-em` nunca andaria e a cópia venceria
 * em 30 dias para quem usa todo dia).
 */
export function precisaBuscarPlano(
  guardado: { dono: string | null; versao: string | null; guardadoEm: string | null; build?: string | null } | null,
  pedido: { dono: string; versao: string; build?: string },
  agoraMs: number,
): boolean {
  if (!guardado || guardado.dono !== pedido.dono || guardado.versao !== pedido.versao) return true;
  if (pedido.build !== undefined && guardado.build !== pedido.build) return true;
  const idade = idadeDaCopia(guardado.guardadoEm, agoraMs);
  return idade === null || idade > RENOVAR_PLANO_MS;
}

export function planoValido(guardadoEm: string | null, agoraMs: number): boolean {
  const idade = idadeDaCopia(guardadoEm, agoraMs);
  return idade !== null && idade <= VALIDADE_PLANO_MS;
}

/**
 * Idade da cópia em ms, ou null se a data não vale. Relógio do aparelho adiantado quando a cópia foi gravada (idade
 * negativa) também é null: senão a cópia nunca venceria nem seria renovada.
 */
function idadeDaCopia(guardadoEm: string | null, agoraMs: number): number | null {
  const t = guardadoEm ? Date.parse(guardadoEm) : Number.NaN;
  return Number.isFinite(t) && agoraMs >= t ? agoraMs - t : null;
}

/** INT-03: o toque na notificação só abre endereço da própria origem (o payload poderia trazer outro). R7: sem `URL.canParse`. */
export function urlDaNotificacao(url: unknown, origem: string): string {
  const u = typeof url === 'string' ? urlOuNull(url) : null;
  return u && u.origin === origem ? u.href : '/p/inicio';
}

/**
 * Quem pode mandar mensagem ao service worker: a própria origem. O Safari do iOS 16.4–16.7 pode entregar o
 * `ExtendableMessageEvent.origin` vazio; aí vale só se o remetente é uma página (`Client`) da própria origem.
 */
export function mensagemDaPropriaOrigem(origemDoEvento: string, urlDoCliente: string | null, origem: string): boolean {
  if (origemDoEvento === origem) return true;
  if (origemDoEvento !== '' || !urlDoCliente) return false;
  return urlOuNull(urlDoCliente)?.origin === origem;
}

/**
 * Cabeçalhos da cópia guardada: os da resposta (o Content-Security-Policy continua com o nonce do HTML) mais dono,
 * versão, data e build. Sem `content-length` nem `content-encoding`: o corpo guardado já vem descomprimido.
 */
export function cabecalhosDaCopia(resposta: Headers, o: { dono: string; versao: string; guardadoEm: string; build?: string }): Headers {
  const h = new Headers(resposta);
  h.delete('content-length');
  h.delete('content-encoding');
  h.set(CABECALHO_DONO, o.dono);
  h.set(CABECALHO_VERSAO, o.versao);
  h.set(CABECALHO_GUARDADO_EM, o.guardadoEm);
  if (o.build !== undefined) h.set(CABECALHO_BUILD, o.build);
  return h;
}

/**
 * Página de login e "Sair": o plano guardado sai do aparelho (window e service worker têm `caches`). R14 (d): é a única
 * forma de apagar esse cache — o service worker, o "Sair" e o login chamam esta função.
 */
export function esquecerPlanoGuardado(): Promise<boolean> {
  return 'caches' in globalThis ? caches.delete(CACHE_PLANO).catch(() => false) : Promise.resolve(false);
}

/**
 * /p/escolher (achado 4 do /code-review): a cópia guardada sai só se o dono dela NÃO for um dos vínculos que a conta
 * ainda pode escolher (consultório suspenso, vínculo sem acesso, outra conta) — a do consultório ativo fica, como no
 * conferirDono do service worker. Cópia sem dono também sai.
 */
export async function esquecerPlanoGuardadoForaDe(manter: readonly string[]): Promise<boolean> {
  if (!('caches' in globalThis)) return false;
  try {
    if (!(await caches.has(CACHE_PLANO))) return false;
    const dono = (await (await caches.open(CACHE_PLANO)).match(URL_PLANO, { ignoreVary: true }))?.headers.get(CABECALHO_DONO);
    if (dono && manter.includes(dono)) return false;
    return await esquecerPlanoGuardado();
  } catch {
    return false;
  }
}
