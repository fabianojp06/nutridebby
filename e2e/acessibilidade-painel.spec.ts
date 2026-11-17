import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fichaPelaBusca, SEMENTE_COMPLETA, SEMENTE_INCOMPLETA } from './cadastro';
import { vigiarCsp } from './csp';
import { entrarComo } from './helpers';
import { escolherTema, prepararTelasComId } from './painel';
import { ROTAS_DO_PAINEL, type IdsDoPainel } from './painel-rotas';
import { avaliar, pacienteNoPortal } from './portal';

// RNF-10 (D25): o painel com zero violação WCAG 2.1 AA (+ alvo de toque da 2.2) nos três modos, em TODAS as telas
// (ROTAS_DO_PAINEL, conferida pela guarda rotas-axe.test.ts). IPs: 10.9.13.84 (nutri), .85 (outro aparelho), .83 (paciente);
// 10.9.29.31 (o paciente que autoriza a IA, Plano 14B-2); 10.9.29.51 (a segunda paciente da IA Nutri, que envia a dúvida
// direta para a fila, Plano 15).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
test.describe.configure({ mode: 'serial', timeout: 240_000 }); // cada teste visita as ~44 telas do painel
let nutri: Page;
let rotas: string[] = [];
let ids: IdsDoPainel;
let errosCsp: string[] = []; // D7: a CSP vale direto porque o E2E abre todas as telas sem violação — a prova é este laço

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // o preparo cria uma linha de cada tela com id
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.84');
  await expect(nutri).toHaveURL(/\/painel$/);
  errosCsp = vigiarCsp(nutri);
  ids = await prepararTelasComId(browser, nutri, '10.9.13.83', '10.9.29.51');
  // a Segurança da conta fica fora do /painel, mas segue o tema da conta (D17, achado 9 do /code-review do PR #12)
  rotas = [...Object.values(ROTAS_DO_PAINEL).map((f) => f(ids)), '/conta/seguranca'];
});
test.afterAll(async () => {
  await escolherTema(nutri, 'Igual ao aparelho'); // o seed e as outras specs esperam o padrão
  await nutri?.context().close();
});

async function violacoes(page: Page, incluir?: string, opcoes: { ignorarForaDaTela?: boolean } = {}): Promise<string[]> {
  const axe = new AxeBuilder({ page }).withTags(TAGS);
  const r = await (incluir ? axe.include(incluir) : axe).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  // fundos com transparência caem em "incomplete" no color-contrast: não podem passar calados
  let incertos = r.incomplete.filter((i) => i.id === 'color-contrast').flatMap((i) => i.nodes.map((n) => n.target.join(' ')));
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
  const contrasteIncerto = incertos.map((alvo) => `incompleto color-contrast: ${alvo}`);
  return [...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), ...contrasteIncerto];
}

for (const [modo, tema, aparelho] of [
  ['claro', 'Claro', 'light'],
  ['escuro', 'Escuro', 'light'],
  ['igual ao aparelho (aparelho escuro)', 'Igual ao aparelho', 'dark'],
] as const) {
  test(`axe sem violações em todas as telas do painel — modo ${modo}`, async () => {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: aparelho });
    const falhas: string[] = [];
    for (const url of rotas) {
      await nutri.goto(url);
      await nutri.waitForLoadState('networkidle');
      for (const v of await violacoes(nutri)) falhas.push(`${url} — ${v}`);
    }
    await nutri.emulateMedia({ colorScheme: 'light' });
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
  const doMenu = (await violacoes(nutri, '[data-guia="conta"]')).filter((v) => v !== 'incompleto color-contrast: .py-2');
  expect(doMenu).toEqual([]);
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click(); // vazio: erros por campo (role="alert")
  expect(await violacoes(nutri)).toEqual([]);
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
 * Plano 18 (RNF-261): o Início (com o cartão e o selo "No app"; com a nota "Cadastro incompleto"), o Perfil com o cadastro
 * inteiro, a lista e a página "No app do paciente", a 1280 e a 360 px, claro e escuro. As pacientes do cadastro do seed
 * (e2e/cadastro.ts): a completa tem conta, nome social, CPF e uma avaliação; a incompleta mostra a nota. Os estados abertos
 * (menu da linha, diálogo Adicionar, CPF repetido) ficam no cadastro.spec e no ficha.spec.
 */
test('Plano 18: Início, Perfil, lista e "No app do paciente" a 1280 e 360 px, claro e escuro', async () => {
  test.setTimeout(240_000);
  const completa = await fichaPelaBusca(nutri, SEMENTE_COMPLETA.email, SEMENTE_COMPLETA.nomeSocial);
  const incompleta = await fichaPelaBusca(nutri, SEMENTE_INCOMPLETA.email, SEMENTE_INCOMPLETA.nome);
  const telas = [
    { url: '/painel/pacientes', pronta: () => expect(nutri.getByRole('heading', { level: 1, name: 'Pacientes' })).toBeVisible() },
    { url: completa, pronta: () => expect(nutri.getByRole('region', { name: 'No app do paciente' })).toBeVisible() },
    { url: incompleta, pronta: () => expect(nutri.getByText('Cadastro incompleto: faltam estado civil e endereço.')).toBeVisible() },
    { url: `${completa}/perfil`, pronta: () => expect(nutri.getByLabel('CPF (opcional)')).toHaveValue(SEMENTE_COMPLETA.cpf) },
    { url: `${completa}/app`, pronta: () => expect(nutri.getByRole('heading', { name: 'No app do paciente' })).toBeVisible() },
  ];
  const falhas: string[] = [];
  try {
    for (const [largura, altura] of [[1280, 720], [360, 800]] as const) {
      await nutri.setViewportSize({ width: largura, height: altura });
      for (const tema of ['Claro', 'Escuro'] as const) {
        await escolherTema(nutri, tema);
        for (const t of telas) {
          await nutri.goto(t.url);
          await t.pronta();
          await nutri.waitForLoadState('networkidle');
          for (const v of await violacoes(nutri, undefined, { ignorarForaDaTela: largura < 1280 })) falhas.push(`${largura} px ${tema} ${t.url} — ${v}`);
        }
      }
    }
  } finally {
    await nutri.setViewportSize({ width: 1280, height: 720 });
    await escolherTema(nutri, 'Igual ao aparelho');
  }
  expect(falhas).toEqual([]);
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
    for (const v of await violacoes(nutri)) falhas.push(`${tema} /painel/configuracoes — ${v}`);
    await nutri.goto('/painel/planos/modelos');
    await expect(nutri.getByText('Sugestão da IA — revise', { exact: true }).first()).toBeVisible();
    for (const v of await violacoes(nutri)) falhas.push(`${tema} /painel/planos/modelos — ${v}`);
    await nutri.goto(`/painel/planos/modelos/${id}`);
    await expect(nutri.getByText('Modelo sugerido por inteligência artificial. Revise alimentos, quantidades e textos antes de aprovar. Depois de aprovado, o modelo é seu.')).toBeVisible();
    await expect(nutri.getByRole('button', { name: 'Aprovar modelo' })).toBeVisible();
    await nutri.waitForLoadState('networkidle');
    for (const v of await violacoes(nutri)) falhas.push(`${tema} /painel/planos/modelos/[id] — ${v}`);
  }
  await nutri.emulateMedia({ colorScheme: 'light' });
  expect(falhas).toEqual([]);
});

/**
 * Plano 14B-2 (US-120, US-121): as telas do resumo e do rascunho com a tarefa PRONTA (no laço de cima, o paciente não
 * autorizou a IA e elas mostram só o aviso). Um paciente que autoriza a versão 1.1 no app, duas antropometrias (a tabela
 * "Dados usados" aparece) e as duas tarefas pelo sandbox (nenhuma chamada à API real).
 */
test('Plano 14B-2: o resumo do histórico e o rascunho de plano com a tarefa pronta, nos três modos e em 768 px', async ({ browser }) => {
  test.setTimeout(240_000);
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.29.31');
  await paciente.page.goto('/p/perfil/ia');
  await paciente.page.getByRole('button', { name: 'Autorizo o envio para fora do Brasil' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Autorização registrada. Você pode retirar quando quiser.' })).toBeVisible();
  await paciente.page.context().close();
  const p = paciente.prontuario;
  await avaliar(nutri, p, '2026-08-01', '80');
  await avaliar(nutri, p, '2026-09-01', '78,5');
  await nutri.goto(`${p}/resumo-ia`);
  await nutri.getByRole('button', { name: 'Gerar resumo' }).click();
  await expect(nutri.getByText(/^Resumo gerado por IA em /)).toBeVisible({ timeout: 90_000 });
  await nutri.goto(`${p}/plano-alimentar/rascunho-ia`);
  await nutri.getByLabel('Meta de energia (kcal/dia)').fill('1800');
  await nutri.getByLabel('Proteína (% da energia)').fill('20');
  await nutri.getByLabel('Carboidrato (%)').fill('50');
  await nutri.getByLabel('Lipídio (%)').fill('30');
  await nutri.getByRole('button', { name: 'Gerar rascunho' }).click();
  await expect(nutri.getByRole('heading', { name: 'Rascunho sugerido pela IA' })).toBeVisible({ timeout: 120_000 });

  const telas = [
    { url: `${p}/resumo-ia`, pronta: () => expect(nutri.getByRole('table', { name: 'Dados usados' })).toBeVisible() },
    { url: `${p}/plano-alimentar/rascunho-ia`, pronta: () => expect(nutri.getByRole('button', { name: 'Usar como rascunho' })).toBeVisible() },
  ];
  const falhas: string[] = [];
  for (const [tema, aparelho] of [['Claro', 'light'], ['Escuro', 'light'], ['Igual ao aparelho', 'dark']] as const) {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: aparelho });
    for (const t of telas) {
      await nutri.goto(t.url);
      await t.pronta();
      await nutri.waitForLoadState('networkidle');
      for (const v of await violacoes(nutri)) falhas.push(`${tema} ${t.url} — ${v}`);
    }
  }
  await nutri.emulateMedia({ colorScheme: 'light' });
  expect(falhas).toEqual([]);
  await nutri.setViewportSize({ width: 768, height: 1000 });
  try {
    for (const t of telas) {
      await nutri.goto(t.url);
      await t.pronta();
      expect(await nutri.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), t.url).toBe(true);
    }
  } finally {
    await nutri.setViewportSize({ width: 1280, height: 720 });
  }
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

test('D17: o botão de tema alterna, persiste depois de recarregar e em outro aparelho (está na conta, não no navegador)', async ({ browser }) => {
  await escolherTema(nutri, 'Claro');
  await nutri.goto('/painel');
  const botao = nutri.getByRole('button', { name: 'Modo escuro' });
  await expect(botao).toHaveAttribute('aria-pressed', 'false');
  await botao.focus();
  await nutri.keyboard.press('Enter');
  await expect(nutri.locator('[data-tema="escuro"]')).toBeAttached();
  await nutri.reload();
  await expect(nutri.getByRole('button', { name: 'Modo escuro' })).toHaveAttribute('aria-pressed', 'true');
  await nutri.goto('/conta/seguranca'); // fora do /painel, o mesmo tema da conta (D17)
  await expect(nutri.locator('[data-tema="escuro"]')).toBeAttached();
  const outro = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.85');
  await expect(outro.locator('[data-tema="escuro"]')).toBeAttached();
  await outro.context().close();
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
  // depende de configuração), e o menu chega a 9 itens (R-310)
  for (let i = 0; i < 9; i++) {
    rotulos.push((await nutri.evaluate(() => document.activeElement?.textContent ?? '')).trim().replace(/ \(\d+\)$/, ''));
    await nutri.keyboard.press('Tab');
  }
  expect(rotulos).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Exames recebidos', 'Dúvidas dos pacientes', 'Conteúdos', 'Financeiro', 'Configurações']);
});
