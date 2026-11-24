import type { Acesso } from '@/modules/relatorios/acesso';
import { RANKING_POR, SECOES, type RankingPor, type Secao } from '@/modules/relatorios/constantes';
import { periodoDaUrl, type ErroDoPeriodo, type Periodo } from '@/modules/relatorios/periodo';

/**
 * Plano 26, T3 (§4.1): as rotas dos Relatórios e o que a URL diz — o período (`de`, `ate`), o critério do Ranking (`por`) e
 * a volta do CSV com `?erro=periodo`. Puro: as páginas, a impressão e a rota do CSV leem daqui.
 */
export const BASE = '/painel/relatorios';
export const ROTA_DA_SECAO: Record<Secao, string> = {
  pacientes: BASE,
  atendimentos: `${BASE}/atendimentos`,
  planos: `${BASE}/planos`,
  agenda: `${BASE}/agenda`,
  financeiro: `${BASE}/financeiro`,
  ranking: `${BASE}/ranking`,
};
export const ROTA_DA_IMPRESSAO = `${BASE}/imprimir`;
export const ROTA_DO_CSV = '/api/painel/relatorios/csv';

/**
 * RE-D51: no PR 1 todas as páginas e a rota chamam `requireNutri`/`requireApiNutri`, e o acesso é o da nutricionista (todas
 * as seções). A T11b troca por `requireEquipe` e pelo acesso da sessão.
 */
export const ACESSO_DA_NUTRI: Acesso = { papel: 'nutri', financeiro: true };

export type ParametrosDaUrl = Record<string, string | string[] | undefined>;

/** Os `searchParams` da página como `URLSearchParams` (só os valores de texto; parâmetro repetido fica de fora). */
export function paraBusca(sp: ParametrosDaUrl): URLSearchParams {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') u.set(k, v);
  return u;
}

/** A seção pelo texto da URL (`?secao=` da impressão e do CSV); fora da lista, null. */
export function secaoDaUrl(v: string | null | undefined): Secao | null {
  return (SECOES as readonly string[]).includes(v ?? '') ? (v as Secao) : null;
}

export type FiltroDaUrl = {
  /** O período dos números (o padrão, se houve erro). */
  periodo: Periodo;
  erro: ErroDoPeriodo | null;
  /** O que veio na URL, para os `<select>` (null quando nem é um mês). */
  escolhido: { de: string | null; ate: string | null };
  /** O período que os links (abas, critério do Ranking) levam: o escolhido e válido; sem filtro ou com erro, nenhum. */
  doLink: { de: string; ate: string } | null;
  /** RN-492: "Mais consultas" sem `por`; `porValido` falso com um valor fora da lista. */
  por: RankingPor;
  porValido: boolean;
};

/**
 * RN-481: o período da URL no fuso do consultório (`periodoDaUrl`). `?erro=periodo` (a volta do CSV que recusou o período)
 * sem outro erro vira "Período inválido. Mostrando os últimos 12 meses." com os números do padrão.
 */
export function filtroDaUrl(sp: URLSearchParams, agora: Date, fuso: string): FiltroDaUrl {
  const lido = periodoDaUrl(sp, agora, fuso);
  const voltaDoCsv = !lido.erro && sp.get('erro') === 'periodo';
  const r = voltaDoCsv ? { ...periodoDaUrl(new URLSearchParams(), agora, fuso), erro: 'invalido' as const, escolhido: { de: null, ate: null } } : lido;
  const comFiltro = !!sp.get('de') || !!sp.get('ate');
  const porBruto = sp.get('por');
  const por = (RANKING_POR as readonly string[]).includes(porBruto ?? '') ? (porBruto as RankingPor) : 'consultas';
  return {
    periodo: r.periodo,
    erro: r.erro,
    escolhido: r.escolhido,
    doLink: !r.erro && comFiltro ? { de: r.periodo.de, ate: r.periodo.ate } : null,
    por,
    porValido: porBruto === null || porBruto === '' || porBruto === por,
  };
}

function comBusca(caminho: string, pares: [string, string | null | undefined][]): string {
  const u = new URLSearchParams();
  for (const [k, v] of pares) if (v) u.set(k, v);
  const q = u.toString();
  return q ? `${caminho}?${q}` : caminho;
}

/** A página de uma seção, com o período (abas, "Voltar aos relatórios") ou o `?erro=periodo` (volta do CSV). */
export function urlDaSecao(secao: Secao, o: { de?: string; ate?: string; por?: RankingPor; erro?: 'periodo' } = {}): string {
  return comBusca(ROTA_DA_SECAO[secao], [
    ['de', o.de],
    ['ate', o.ate],
    ['por', secao === 'ranking' ? o.por : null],
    ['erro', o.erro],
  ]);
}

const daExportacao = (caminho: string, secao: Secao, p: Periodo, por: RankingPor) =>
  comBusca(caminho, [
    ['secao', secao],
    ['de', p.de],
    ['ate', p.ate],
    ['por', secao === 'ranking' ? por : null],
  ]);
/** "Baixar CSV": sempre o período dos números da tela. */
export const urlDoCsv = (secao: Secao, p: Periodo, por: RankingPor) => daExportacao(ROTA_DO_CSV, secao, p, por);
/** "Ver versão para imprimir": sempre o período dos números da tela. */
export const urlDaImpressao = (secao: Secao, p: Periodo, por: RankingPor) => daExportacao(ROTA_DA_IMPRESSAO, secao, p, por);

/** A origem da aplicação é a de `valor`? URL inválida → não. */
function mesmaOrigem(valor: string, appUrl: string): boolean {
  return URL.canParse(valor) && new URL(valor).origin === new URL(appUrl).origin;
}

/**
 * RN-493 (molde de `recusaDeOrigem`, RN-321 do Plano 20): o CSV e a impressão gravam `exportar` em nome da nutricionista, e
 * o cookie da sessão (SameSite=Lax) vai junto numa navegação vinda de outro site. Só vale o pedido da própria origem (o
 * link dos Relatórios: `same-origin`) ou digitado na barra de endereço (`none`). Sem `Sec-Fetch-Site` (navegador antigo),
 * vale só com `Origin` — ou, sem ele, `Referer` — da origem do APP_URL. Fora disso, quem chama volta para a seção sem ler
 * nem gravar nada.
 */
export function navegacaoDaPropriaOrigem(h: Headers, appUrl: string): boolean {
  const site = h.get('sec-fetch-site');
  if (site !== null) return site === 'same-origin' || site === 'none';
  const origin = h.get('origin');
  if (origin !== null) return mesmaOrigem(origin, appUrl);
  const referer = h.get('referer');
  return referer !== null && mesmaOrigem(referer, appUrl);
}
