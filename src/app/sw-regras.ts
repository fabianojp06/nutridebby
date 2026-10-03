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

export function ehNavegacaoDoPortal(url: URL, modo: RequestMode, origem: string): boolean {
  return modo === 'navigate' && url.origin === origem && url.pathname.startsWith('/p/');
}

export function podeGuardarPlano(r: { status: number; type: ResponseType; redirected: boolean; url: string; headers: Headers }, origem: string): boolean {
  if (r.status !== 200 || r.type !== 'basic' || r.redirected) return false;
  const u = urlOuNull(r.url);
  return !!u && u.origin === origem && u.pathname === URL_PLANO && (r.headers.get('content-type') ?? '').startsWith('text/html');
}

/** A busca do plano terminou no login: não há sessão (vencida, ou outra pessoa no aparelho) — o guardado sai. */
export function ehSemSessao(r: { redirected: boolean; url: string }, origem: string): boolean {
  if (!r.redirected) return false;
  const u = urlOuNull(r.url);
  return !!u && u.origin === origem && u.pathname === '/entrar';
}

/**
 * Review Focus 4 (aparelho compartilhado): o HTML guardado leva de quem é (`dono` = o paciente da sessão, isto é, conta +
 * vínculo) e de qual versão do plano, nestes cabeçalhos da cópia em Cache Storage (nunca vão para a rede).
 */
export const CABECALHO_DONO = 'x-nd-dono';
export const CABECALHO_VERSAO = 'x-nd-versao';
export const CABECALHO_GUARDADO_EM = 'x-nd-guardado-em';
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
 * Buscar de novo se não há cópia, se ela é de outro dono ou de outra versão do plano, ou se tem mais de 1 dia (no máximo uma
 * renderização extra por dia; sem isso o `guardado-em` nunca andaria e a cópia venceria em 30 dias para quem usa todo dia).
 */
export function precisaBuscarPlano(
  guardado: { dono: string | null; versao: string | null; guardadoEm: string | null } | null,
  pedido: { dono: string; versao: string },
  agoraMs: number,
): boolean {
  if (!guardado || guardado.dono !== pedido.dono || guardado.versao !== pedido.versao) return true;
  const t = guardado.guardadoEm ? Date.parse(guardado.guardadoEm) : Number.NaN;
  return !Number.isFinite(t) || agoraMs - t > RENOVAR_PLANO_MS;
}

export function planoValido(guardadoEm: string | null, agoraMs: number): boolean {
  const t = guardadoEm ? Date.parse(guardadoEm) : Number.NaN;
  return Number.isFinite(t) && agoraMs - t <= VALIDADE_PLANO_MS;
}

/**
 * Página de login e "Sair": o plano guardado sai do aparelho (window e service worker têm `caches`). R14 (d): é a única
 * forma de apagar esse cache — o service worker, o "Sair" e o login chamam esta função.
 */
export function esquecerPlanoGuardado(): Promise<boolean> {
  return 'caches' in globalThis ? caches.delete(CACHE_PLANO).catch(() => false) : Promise.resolve(false);
}
