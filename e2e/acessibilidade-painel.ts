import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { escolherTema as escolherTemaDaConta, contrasteIncerto as incertosDoContraste } from './painel';
import { ROTAS_DO_PAINEL, type IdsDoPainel } from './painel-rotas';

/**
 * RNF-10 (D25): o que as duas partes do axe do painel dividem — `acessibilidade-painel-base.spec.ts` (o começo do antigo
 * arquivo único: os laços de todas as telas nos três modos e os estados abertos) e `acessibilidade-painel.spec.ts` (do
 * Plano 20 em diante, na ordem de sempre; caso novo entra no fim dele). SUS-125: era um arquivo só, em série, com 40% a 50%
 * do tempo do E2E (11 a 15 min); em duas partes, os 2 workers do CI as rodam ao mesmo tempo. Cada parte entra com a sua
 * sessão, prepara as suas linhas (`prepararTelasComId`, com a `parte`) e usa os seus IPs (o limite de login é por IP):
 * - base (`parte` 0): 10.9.13.87 (nutri), 10.9.13.88 (paciente do preparo), 10.9.29.52 (a segunda paciente da IA Nutri);
 * - acessibilidade-painel.spec (`parte` 1): 10.9.13.84 (nutri), 10.9.13.83 (paciente do preparo), 10.9.29.51 (a segunda
 *   paciente da IA Nutri, Plano 15), 10.9.20.2 (a conta E2E_FIN_AXE, Plano 20 e D17), 10.9.13.85 (o "outro aparelho" do
 *   D17) e 10.9.29.31 (o paciente que autoriza a IA, Plano 14B-2).
 */
export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export type TemaDoPainel = 'Claro' | 'Escuro' | 'Igual ao aparelho';
const DATA_TEMA: Record<TemaDoPainel, string> = { Claro: 'claro', Escuro: 'escuro', 'Igual ao aparelho': 'sistema' };
const temaDaPagina = new WeakMap<Page, TemaDoPainel>();

/**
 * O `escolherTema` de e2e/painel.ts (grava o tema da conta), guardando o modo escolhido para a página: o `violacoes` garante
 * esse modo em cada tela (garantirTema) sem o teste repetir o tema a cada chamada.
 */
export async function escolherTema(page: Page, tema: TemaDoPainel): Promise<void> {
  await escolherTemaDaConta(page, tema);
  temaDaPagina.set(page, tema);
}

/** Todas as telas do painel (ROTAS_DO_PAINEL, conferida pela guarda rotas-axe.test.ts) e a Segurança da conta. */
export function rotasDoPainel(ids: IdsDoPainel): string[] {
  // a Segurança da conta fica fora do /painel, mas segue o tema da conta (D17, achado 9 do /code-review do PR #12)
  return [...Object.values(ROTAS_DO_PAINEL).map((f) => f(ids)), '/conta/seguranca'];
}

const temaDaTela = (page: Page) => page.evaluate(() => document.querySelector('[data-tema]')?.getAttribute('data-tema') ?? null);

/**
 * SUS-125: o tema é da conta (D17), e a nutri-e2e é a mesma nas duas partes e nas specs que trocam o tema dela no outro
 * worker (cadastro, ficha, lembretes). Se outra trocou o tema entre o `escolherTema` do teste e a abertura da tela, a
 * página veio com outro `data-tema` e o axe conferiria o modo errado calado. Então o tema do modo do teste é escolhido de
 * novo na conta e a tela é aberta de novo (com `refazer`, o estado aberto dela é refeito), até 3 vezes; a tela nunca é
 * mexida por fora, e um defeito real do tema (a conta gravada, a tela com outro) falha aqui. Cada nova escolha fica
 * anotada no relatório do teste.
 */
export async function garantirTema(page: Page, tema: TemaDoPainel, refazer?: () => Promise<void>): Promise<void> {
  const esperado = DATA_TEMA[tema];
  let atual = await temaDaTela(page);
  for (let vez = 1; vez <= 3 && atual !== null && atual !== esperado; vez++) {
    const url = page.url();
    test.info().annotations.push({
      type: 'tema trocado por outra spec',
      description: `${url}: data-tema="${atual}"; "${tema}" escolhido de novo e a tela aberta de novo (${vez}ª vez)${refazer ? '' : ', sem estado aberto a refazer'}`,
    });
    await escolherTemaDaConta(page, tema);
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    await refazer?.();
    atual = await temaDaTela(page);
  }
  expect(atual === null || atual === esperado, `${page.url()}: data-tema="${atual}" depois de escolher "${tema}" (esperado "${esperado}")`).toBe(true);
}

/**
 * `tema`: o modo do teste, garantido na tela antes do axe (garantirTema); sem ele, o último `escolherTema` da página.
 * `refazer`: o estado aberto da tela (menu, erros de formulário), refeito se o garantirTema precisar abrir a tela de novo.
 */
export async function violacoes(
  page: Page,
  incluir?: string,
  opcoes: { ignorarForaDaTela?: boolean; tema?: TemaDoPainel; refazer?: () => Promise<void> } = {},
): Promise<string[]> {
  const tema = opcoes.tema ?? temaDaPagina.get(page);
  if (tema) await garantirTema(page, tema, opcoes.refazer);
  const axe = new AxeBuilder({ page }).withTags(TAGS);
  const r = await (incluir ? axe.include(incluir) : axe).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  // fundos com transparência caem em "incomplete" no color-contrast: não podem passar calados
  // Três filtros, nesta ordem (rebase do Plano 22 sobre o Plano 20): `contrasteIncerto` tira o texto de diálogo modal e de
  // gráfico (svg role=img), conferidos à parte; a rolagem dos contêineres dá veredito ao que puder; do que continua sem
  // veredito, com `ignorarForaDaTela`, sai só o que não cabe inteiro na tela.
  let incertos = await incertosDoContraste(page, r.incomplete);
  let doContraste: string[] = [];
  if (incertos.length) ({ incertos, violacoes: doContraste } = await contrasteNasTabelasRolaveis(page, incertos, incluir));
  if (opcoes.ignorarForaDaTela) {
    // Plano 18: a 360 px a faixa de abas da ficha e a tabela da lista rolam na horizontal; o axe não calcula o contraste do
    // que não cabe inteiro na largura da tela (fora dela ou cortado na borda do contêiner que rola: "incomplete"). Só esses
    // saem; o que aparece inteiro na tela continua conferido, e a 1280 px (tudo cabe) nada sai.
    const fora = await page.evaluate((alvos) => alvos.map((a) => {
      const el = document.querySelector(a);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.left < 0 || r.right > window.innerWidth;
    }), incertos);
    incertos = incertos.filter((_, i) => !fora[i]);
  }
  return [
    ...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ...doContraste,
    ...incertos.map((t) => `incompleto color-contrast: ${t}`),
  ];
}

/**
 * Tabela larga num contêiner com rolagem própria (`role="region"` focável, padrão do repositório: a página não rola, a
 * tabela rola — o Fluxo de caixa do Plano 20 a 1280 px e as tabelas a 360 px): o axe não calcula o contraste da célula
 * cortada pela borda do contêiner ("partially obscured" → "incomplete"). Rola cada contêiner em passos de meia largura e
 * roda o color-contrast de novo: a célula incerta só sai da lista se, em algum passo, o axe der veredito (passou ou
 * violou — a violação entra nas falhas). O que nunca teve veredito continua "incompleto".
 */
async function contrasteNasTabelasRolaveis(page: Page, incertos: string[], incluir?: string): Promise<{ incertos: string[]; violacoes: string[] }> {
  const passos = await page.evaluate(() => {
    const largas = [...document.querySelectorAll<HTMLElement>('[role="region"][tabindex="0"]')].filter((el) => el.scrollWidth > el.clientWidth);
    return Math.max(0, ...largas.map((el) => Math.ceil((el.scrollWidth - el.clientWidth) / Math.max(1, Math.floor(el.clientWidth / 2)))));
  });
  if (!passos) return { incertos, violacoes: [] };
  const resolvidos = new Set<string>();
  const violacoes = new Set<string>();
  for (let passo = 1; passo <= passos; passo++) {
    await page.evaluate((k) => {
      for (const el of document.querySelectorAll<HTMLElement>('[role="region"][tabindex="0"]')) {
        if (el.scrollWidth > el.clientWidth) el.scrollLeft = Math.min(k * Math.floor(el.clientWidth / 2), el.scrollWidth - el.clientWidth);
      }
    }, passo);
    const so = new AxeBuilder({ page }).withRules(['color-contrast']);
    const r = await (incluir ? so.include(incluir) : so).analyze();
    for (const n of r.passes.flatMap((p) => p.nodes)) resolvidos.add(n.target.join(' '));
    for (const n of r.violations.flatMap((v) => v.nodes)) {
      resolvidos.add(n.target.join(' '));
      violacoes.add(`color-contrast (rolando a tabela): ${n.target.join(' ')}`);
    }
  }
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('[role="region"][tabindex="0"]')) el.scrollLeft = 0;
  });
  return { incertos: incertos.filter((t) => !resolvidos.has(t)), violacoes: [...violacoes] };
}

/**
 * O laço de um modo: todas as `rotas`, com o tema da conta e o esquema do aparelho do modo, e as falhas do axe. O tema é
 * escolhido antes (escolherTema) por quem chama; aqui cada tela é conferida no `tema` (garantirTema).
 */
export async function axeEmTodasAsTelas(page: Page, rotas: string[], tema: TemaDoPainel): Promise<string[]> {
  const falhas: string[] = [];
  for (const url of rotas) {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    for (const v of await violacoes(page, undefined, { tema })) falhas.push(`${url} — ${v}`);
  }
  return falhas;
}
