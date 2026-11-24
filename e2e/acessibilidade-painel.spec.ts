import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { axeEmTodasAsTelas, garantirTema, NUTRI, rotasDoPainel, TAGS, violacoes } from './acessibilidade-painel';
import { vigiarCsp } from './csp';
import { entrarComo, ESPERA_DO_SERVIDOR } from './helpers';
import { escolherTema, prepararTelasComId } from './painel';
import { type IdsDoPainel } from './painel-rotas';

// RNF-10 (D25): o painel com zero violação WCAG 2.1 AA (+ alvo de toque da 2.2) nos três modos, em TODAS as telas
// (ROTAS_DO_PAINEL, conferida pela guarda rotas-axe.test.ts). SUS-125: parte 0 de 2 — os modos claro e escuro, os estados
// abertos, a faixa de abas da ficha, os modelos sugeridos pela IA, os 768 px e o teclado; o modo "igual ao aparelho" e os
// laços do Financeiro, da ficha, do resumo e rascunho da IA, do D17 e dos Relatórios ficam no acessibilidade-painel-2.spec.
// O que as duas dividem (o axe, o tema garantido em cada tela e os IPs de cada parte) está em e2e/acessibilidade-painel.ts.
// IPs desta parte: 10.9.13.84 (nutri), 10.9.13.83 (paciente do preparo), 10.9.29.51 (a segunda paciente da IA Nutri).
test.describe.configure({ mode: 'serial', timeout: 360_000 }); // cada laço visita todas as telas do painel (mais de 60 desde o Plano 22, que acrescentou o catálogo, os exames e a prescrição)
let nutri: Page;
let rotas: string[] = [];
let ids: IdsDoPainel;
let errosCsp: string[] = []; // D7: a CSP vale direto porque o E2E abre todas as telas sem violação — a prova é este laço

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // o preparo cria uma linha de cada tela com id
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.84');
  await expect(nutri).toHaveURL(/\/painel$/, { timeout: ESPERA_DO_SERVIDOR });
  errosCsp = vigiarCsp(nutri);
  ids = await prepararTelasComId(browser, nutri, '10.9.13.83', '10.9.29.51', 0);
  rotas = rotasDoPainel(ids);
});
test.afterAll(async () => {
  await escolherTema(nutri, 'Igual ao aparelho'); // o seed e as outras specs esperam o padrão
  await nutri?.context().close();
});

for (const [modo, tema] of [
  ['claro', 'Claro'],
  ['escuro', 'Escuro'],
] as const) {
  test(`axe sem violações em todas as telas do painel — modo ${modo}`, async () => {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: 'light' });
    const falhas = await axeEmTodasAsTelas(nutri, rotas, tema);
    expect(falhas).toEqual([]);
    expect(errosCsp, 'violação de CSP em alguma tela do painel (D7)').toEqual([]);
  });
}

test('estados abertos também passam: menu da conta, aviso de erro de formulário', async () => {
  await escolherTema(nutri, 'Escuro');
  await nutri.goto('/painel');
  await nutri.getByLabel(/^Conta de /).click();
  // só o menu aberto: o resto da tela fica sob ele, e o axe não calcula contraste de texto coberto ("incomplete" por
  // sobreposição parcial). A linha "Conectado como …" (text-suave sobre bg-cartao, os mesmos tokens que o axe confere
  // em todas as telas acima) cai nesse caso: é a única tolerância.
  const doMenu = (await violacoes(nutri, '[data-guia="conta"]', { tema: 'Escuro' })).filter((v) => v !== 'incompleto color-contrast: .py-2');
  expect(doMenu).toEqual([]);
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click(); // vazio: erros por campo (role="alert")
  expect(await violacoes(nutri, undefined, { tema: 'Escuro' })).toEqual([]);
});

/**
 * Plano 18 (D12, US-262 "Abas"): com Documentos e IA Nutri ligados (seed), as 13 abas da ficha — Início e Perfil na frente,
 * "Histórico" por último — cabem inteiras a 1280 px (a faixa não rola e o axe não deixa nada em "incomplete"); o cadastro,
 * o "Acesso ao app" e as "Etiquetas" ficam no Perfil, e o Início não tem mais o formulário.
 */
test('Plano 18: a faixa de abas da ficha cabe a 1280 px sem "incomplete"; o cadastro fica no Perfil', async () => {
  await escolherTema(nutri, 'Claro');
  try {
    await nutri.setViewportSize({ width: 1280, height: 720 });
    await nutri.goto(`/painel/pacientes/${ids.paciente}/perfil`);
    const faixa = nutri.getByRole('navigation', { name: 'Seções do prontuário' });
    await expect(faixa.getByRole('link')).toHaveCount(13);
    await expect(faixa.getByRole('link').first()).toHaveText('Início');
    await expect(faixa.getByRole('link', { name: 'Perfil', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(faixa.getByRole('link').last()).toHaveText('Histórico');
    await expect(faixa.getByRole('link').last()).toHaveAccessibleName('Histórico de acessos');
    expect(await faixa.locator('ul').evaluate((ul) => ul.scrollWidth <= ul.clientWidth), 'a faixa de abas rola a 1280 px').toBe(true);
    await garantirTema(nutri, 'Claro');
    const r = await new AxeBuilder({ page: nutri }).withTags(TAGS).include('nav[aria-label="Seções do prontuário"]').analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
    expect(r.incomplete.map((i) => `${i.id}: ${i.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    // Plano 18 (§8.4, T7a): o cadastro em seções — os títulos são as legendas dos fieldsets
    for (const secao of ['Dados gerais', 'Contato e endereço', 'Observação']) await expect(nutri.getByRole('heading', { level: 2, name: secao })).toBeVisible();
    await expect(nutri.getByRole('button', { name: 'Salvar cadastro' })).toBeVisible();
    await expect(nutri.getByRole('heading', { level: 2, name: 'Acesso ao app' })).toBeVisible();
    await expect(nutri.getByRole('heading', { level: 2, name: 'Etiquetas' })).toBeVisible();
    await nutri.goto(`/painel/pacientes/${ids.paciente}`);
    await expect(faixa.getByRole('link', { name: 'Início', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nutri.getByRole('button', { name: 'Salvar cadastro' })).toHaveCount(0);
  } finally {
    await escolherTema(nutri, 'Igual ao aparelho');
  }
});

/**
 * Plano 14B-1 (US-123): o id de um modelo de plano sugerido pela IA ainda sem aprovação. O banco do E2E é reaproveitado
 * (o ia-modelos.spec deixa o "Plano sugerido 2" sem aprovar); no banco novo (CI), pede um pacote (sandbox: nenhuma
 * chamada à API real). Um pacote por consultório (RN-103): se outro estiver em preparo, espera a lista ganhar o modelo.
 */
async function modeloSugeridoSemAprovacao(page: Page): Promise<string> {
  const achar = async (): Promise<string | null> => {
    await page.goto('/painel/planos/modelos');
    const item = page.getByRole('listitem').filter({ has: page.getByText('Sugestão da IA — revise', { exact: true }) }).first();
    if (!(await item.count())) return null;
    return (await item.getByRole('link').getAttribute('href'))?.split('/').pop() ?? null;
  };
  const id = await achar();
  if (id) return id;
  await page.goto('/painel/configuracoes');
  const area = page.getByLabel('Área');
  if (await area.isVisible()) {
    await area.selectOption('idosos');
    await page.getByRole('button', { name: 'Gerar modelos' }).click();
  }
  let achado: string | null = null;
  await expect.poll(async () => (achado = await achar()), { timeout: 120_000, intervals: [3_000] }).not.toBeNull();
  return achado!;
}

test('Plano 14B-1: Configurações com os modelos sugeridos pela IA, a marca na lista e um modelo sugerido (faixa e "Aprovar modelo"), nos três modos', async () => {
  test.setTimeout(240_000);
  const id = await modeloSugeridoSemAprovacao(nutri);
  const falhas: string[] = [];
  for (const [tema, aparelho] of [['Claro', 'light'], ['Escuro', 'light'], ['Igual ao aparelho', 'dark']] as const) {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: aparelho });
    await nutri.goto('/painel/configuracoes');
    await expect(nutri.getByRole('heading', { name: 'Modelos sugeridos pela IA' })).toBeVisible();
    await nutri.waitForLoadState('networkidle');
    for (const v of await violacoes(nutri, undefined, { tema })) falhas.push(`${tema} /painel/configuracoes — ${v}`);
    await nutri.goto('/painel/planos/modelos');
    await expect(nutri.getByText('Sugestão da IA — revise', { exact: true }).first()).toBeVisible();
    for (const v of await violacoes(nutri, undefined, { tema })) falhas.push(`${tema} /painel/planos/modelos — ${v}`);
    await nutri.goto(`/painel/planos/modelos/${id}`);
    await expect(nutri.getByText('Modelo sugerido por inteligência artificial. Revise alimentos, quantidades e textos antes de aprovar. Depois de aprovado, o modelo é seu.')).toBeVisible();
    await expect(nutri.getByRole('button', { name: 'Aprovar modelo' })).toBeVisible();
    await nutri.waitForLoadState('networkidle');
    for (const v of await violacoes(nutri, undefined, { tema })) falhas.push(`${tema} /painel/planos/modelos/[id] — ${v}`);
  }
  await nutri.emulateMedia({ colorScheme: 'light' });
  expect(falhas).toEqual([]);
});

test('768 px: nenhuma tela do painel rola na horizontal', async () => {
  await nutri.setViewportSize({ width: 768, height: 1000 });
  try {
    for (const url of rotas) {
      await nutri.goto(url);
      await nutri.waitForLoadState('networkidle');
      expect(await nutri.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
    }
  } finally {
    await nutri.setViewportSize({ width: 1280, height: 720 });
  }
});

test('teclado: Tab chega aos itens do menu na ordem da tela, e o item atual é anunciado', async () => {
  await nutri.goto('/painel/agenda');
  const menu = nutri.getByRole('navigation', { name: 'Menu do painel' });
  await expect(menu.getByRole('link', { name: 'Agenda', exact: true })).toHaveAttribute('aria-current', 'page');
  const rotulos: string[] = [];
  await menu.getByRole('link', { name: 'Início' }).focus();
  // Plano 12 (D11): o seed liga o recebimento de exames, então "Exames recebidos" é o 5º item; Plano 15 (US-175): e ativa a
  // IA Nutri, então "Dúvidas dos pacientes" vem antes de "Conteúdos". Os contadores " (n)" dependem do que as outras specs
  // deixaram no banco de dev e saem da comparação. Plano 20 (RN-327): "Financeiro" antes de "Configurações", sempre (não
  // depende de configuração), e o menu chega a 9 itens (R-310); Plano 26: "Relatórios" entre "Financeiro" e "Configurações" (10)
  for (let i = 0; i < 10; i++) {
    rotulos.push((await nutri.evaluate(() => document.activeElement?.textContent ?? '')).trim().replace(/ \(\d+\)$/, ''));
    await nutri.keyboard.press('Tab');
  }
  expect(rotulos).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Exames recebidos', 'Dúvidas dos pacientes', 'Conteúdos', 'Financeiro', 'Relatórios', 'Configurações']);
});
