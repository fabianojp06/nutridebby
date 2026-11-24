/// <reference lib="webworker" />
import { NetworkFirst, NetworkOnly, Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';
import {
  CABECALHO_BUILD,
  CABECALHO_DONO,
  CABECALHO_GUARDADO_EM,
  CABECALHO_PEDIDO_DA_COPIA,
  CABECALHO_VERSAO,
  CACHE_PLANO,
  URL_PLANO,
  cabecalhosDaCopia,
  ehConversaDoPortal,
  ehNavegacaoDoPortal,
  ehPaginaDoPlano,
  esquecerPlanoGuardado,
  idDoBuild,
  lerMensagem,
  mensagemDaPropriaOrigem,
  paginaSemConexao,
  planoValido,
  podeGuardarPlano,
  precisaBuscarPlano,
  saiuDoPlano,
  urlDaNotificacao,
} from './sw-regras';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

const origem = self.location.origin;
/** O build deste service worker (cabeçalho da cópia): o HTML guardado só abre offline com os estáticos do mesmo build. */
const BUILD = idDoBuild(self.__SW_MANIFEST);
const copia = async (): Promise<Response | undefined> => (await caches.open(CACHE_PLANO)).match(URL_PLANO, { ignoreVary: true });
/** A cópia guardada, se ainda vale (mais velha que a sessão máxima sai). */
const planoGuardado = async (): Promise<Response | undefined> => {
  const r = await copia();
  if (r && !planoValido(r.headers.get(CABECALHO_GUARDADO_EM), Date.now())) {
    await esquecerPlanoGuardado();
    return undefined;
  }
  return r;
};

/**
 * D6 + Review Focus 4: o plano só entra no cache a pedido da própria página "Meu plano" (mensagem `plano`), que diz de
 * quem é (conta + vínculo) e qual versão — a navegação pelo menu do portal é `fetch` do roteador (RSC), não 'navigate',
 * então guardar só na navegação deixaria o cache vazio no uso normal. O service worker busca o HTML com a sessão do
 * aparelho; se ela não terminar em "Meu plano" (login, sem acesso, indisponível…), a cópia sai; cópia de outro dono sai
 * antes de buscar (mesmo se a busca falhar).
 */
async function guardarPlano(dono: string, versao: string, o: { prazoMs?: number } = {}): Promise<void> {
  const atual = await copia();
  const guardado = atual
    ? {
        dono: atual.headers.get(CABECALHO_DONO),
        versao: atual.headers.get(CABECALHO_VERSAO),
        guardadoEm: atual.headers.get(CABECALHO_GUARDADO_EM),
        build: atual.headers.get(CABECALHO_BUILD),
      }
    : null;
  if (!precisaBuscarPlano(guardado, { dono, versao, build: BUILD }, Date.now())) return;
  if (guardado && guardado.dono !== dono) await esquecerPlanoGuardado();
  // SUS-112: o cabeçalho faz o servidor desenhar a marca da cópia (MARCA_DA_COPIA) — só a cópia recarrega quando a rede volta.
  // Plano 25 (RN-473): e o link "Mensagens" da faixa sai sem contador
  const r = await fetch(URL_PLANO, { credentials: 'same-origin', cache: 'no-store', headers: { [CABECALHO_PEDIDO_DA_COPIA]: '1' }, signal: o.prazoMs ? AbortSignal.timeout(o.prazoMs) : undefined });
  if (saiuDoPlano(r, origem)) {
    await esquecerPlanoGuardado();
    return;
  }
  if (!podeGuardarPlano(r, origem)) return;
  const h = cabecalhosDaCopia(r.headers, { dono, versao, guardadoEm: new Date().toISOString(), build: BUILD });
  // put na mesma chave substitui: o cache continua com 1 entrada
  await (await caches.open(CACHE_PLANO)).put(URL_PLANO, new Response(await r.blob(), { status: 200, headers: h }));
}

/** Layout do portal (toda abertura): cópia de outra conta ou de outro vínculo sai na hora (login de outra pessoa, troca de nutricionista). */
async function conferirDono(dono: string): Promise<void> {
  const atual = await copia();
  if (atual && atual.headers.get(CABECALHO_DONO) !== dono) await esquecerPlanoGuardado();
}

/**
 * Deploy novo (este service worker ativando): o Serwist apaga do precache os JS/CSS do build anterior, e a cópia guardada
 * aponta para eles — offline, abriria sem estilo, sem hidratar e sem o selo "Offline". A ativação acontece com rede (o
 * navegador acabou de baixar o sw.js): busca a cópia de novo com as regras de guardarPlano (não terminou no plano → sai).
 * Cópia sem dono ou versão sai. Prazo de 10 s: o waitUntil do activate segura as requisições das páginas.
 */
async function renovarCopia(): Promise<void> {
  const atual = await copia();
  if (!atual || atual.headers.get(CABECALHO_BUILD) === BUILD) return;
  const dono = atual.headers.get(CABECALHO_DONO);
  const versao = atual.headers.get(CABECALHO_VERSAO);
  if (!dono || !versao) {
    await esquecerPlanoGuardado();
    return;
  }
  await guardarPlano(dono, versao, { prazoMs: 10_000 });
}

self.addEventListener('activate', (e) => {
  e.waitUntil(renovarCopia().catch(() => undefined));
});

self.addEventListener('message', (e) => {
  if (!mensagemDaPropriaOrigem(e.origin, e.source instanceof Client ? e.source.url : null, origem)) return;
  const m = lerMensagem(e.data);
  if (!m) return;
  e.waitUntil((m.tipo === 'plano' ? guardarPlano(m.dono, m.versao) : conferirDono(m.dono)).catch(() => undefined));
});

// INT-03: o payload do worker é { titulo, corpo, url } (Plano 05, D19), cifrado até o aparelho
self.addEventListener('push', (e) => {
  let d: { titulo?: unknown; corpo?: unknown; url?: unknown } | null = null;
  try {
    d = e.data?.json() ?? null;
  } catch {
    d = null;
  }
  if (!d || typeof d.titulo !== 'string') return;
  e.waitUntil(
    self.registration.showNotification(d.titulo, {
      body: typeof d.corpo === 'string' ? d.corpo : '',
      icon: '/icones/icone-192.png',
      data: { url: d.url ?? null },
    }),
  );
});

// O toque abre a tela do aviso — só da própria origem (urlDaNotificacao)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(urlDaNotificacao((e.notification.data as { url?: unknown } | null)?.url, origem)));
});

// D6: os estáticos do build (precache) + só o HTML de "Meu plano" (1 entrada, gravada por guardarPlano). Nada de /api,
// foto, PDF ou outra página (nem a conversa, /p/mensagens: Plano 25, RN-473).
new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    {
      // "Meu plano" aberto direto (atalho, recarga): rede primeiro (4 s), senão a cópia. Esta rota NÃO grava — quem grava
      // é guardarPlano, que sabe o dono (a resposta de uma navegação não diz de quem é)
      matcher: ({ request, url }) => ehPaginaDoPlano(url, request.mode, origem),
      handler: new NetworkFirst({
        cacheName: CACHE_PLANO,
        networkTimeoutSeconds: 4,
        matchOptions: { ignoreVary: true },
        plugins: [
          { cacheWillUpdate: async () => null },
          {
            // cópia vencida (mais velha que a sessão máxima) não é servida e sai do aparelho (LGPD: minimização)
            cachedResponseWillBeUsed: async ({ cachedResponse }) => {
              if (!cachedResponse) return null;
              if (planoValido(cachedResponse.headers.get(CABECALHO_GUARDADO_EM), Date.now())) return cachedResponse;
              await esquecerPlanoGuardado();
              return null;
            },
          },
        ],
      }),
    },
    {
      // Plano 25 (RN-473, CH-D46): a conversa só com rede e nunca no cache; sem rede, a página do aviso (nunca o plano no
      // lugar da conversa). Antes da regra seguinte, que não casa com /p/mensagens (ehNavegacaoDoPortal) — defesa dupla
      matcher: ({ request, url }) => ehConversaDoPortal(url, request.mode, origem),
      handler: new NetworkOnly({ plugins: [{ handlerDidError: async () => paginaSemConexao() }] }),
    },
    {
      // Sem rede, qualquer página do portal mostra o último plano guardado (com o selo offline), menos a conversa
      matcher: ({ request, url }) => ehNavegacaoDoPortal(url, request.mode, origem),
      handler: new NetworkOnly({ plugins: [{ handlerDidError: async () => planoGuardado() }] }),
    },
  ],
}).addEventListeners();
