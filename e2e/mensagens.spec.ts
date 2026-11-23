import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { escolherTema } from './painel';

// Plano 25 (PD-90): Mensagens no painel, no consultório próprio do E2E do chat (scripts/e2e-seed.ts, CH-D67: novo a cada
// `pnpm e2e:seed`, com a conversa liberada e a mensagem do paciente com sinal de risco). T6a: o menu "Mensagens", a caixa
// (o selo "Sinal de risco" no topo), a "Nova conversa" (busca e abrir a conversa), o axe da caixa com o selo de alerta nos
// três modos (o laço de acessibilidade-painel.spec.ts vê a caixa vazia do consultório principal) e o menu que quebra linha
// sem cobrir o conteúdo. Bloco de IP deste spec (o limite de login é por IP; bloco do Plano 25, CH-D50): 10.9.25.1 a
// 10.9.25.5 na T6a — nutricionista .1. A T6b e a T6c usam .6 em diante. Credenciais copiadas (importar o seed roda o seed).
const CHAT_NUTRI = { email: 'chat-nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const CHAT_PACIENTE = { nome: 'Paciente Chat E2E' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const UUID = '[0-9a-f-]{36}';
test.describe.configure({ mode: 'serial' });
let nutri: Page;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, CHAT_NUTRI.email, CHAT_NUTRI.senha, '10.9.25.1', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  if (nutri) await escolherTema(nutri, 'Igual ao aparelho'); // o seed e as outras specs esperam o padrão
  await nutri?.context().close();
});

async function violacoes(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  // fundos com transparência caem em "incomplete" no color-contrast: não podem passar calados (como no acessibilidade-painel)
  const contrasteIncerto = r.incomplete.filter((i) => i.id === 'color-contrast').flatMap((i) => i.nodes.map((n) => `incompleto color-contrast: ${n.target.join(' ')}`));
  return [...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), ...contrasteIncerto];
}

// antes de abrir a conversa: abrir tira o selo "Sinal de risco" da caixa (RN-449)
test('T6a: axe da caixa com o selo "Sinal de risco" e da nova conversa, nos três modos', async () => {
  const falhas: string[] = [];
  for (const [tema, aparelho] of [['Claro', 'light'], ['Escuro', 'light'], ['Igual ao aparelho', 'dark']] as const) {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: aparelho });
    await nutri.goto('/painel/mensagens');
    await expect(nutri.getByText('Sinal de risco').first()).toBeVisible();
    for (const v of await violacoes(nutri)) falhas.push(`${tema} /painel/mensagens — ${v}`);
    await nutri.goto('/painel/mensagens/nova');
    await expect(nutri.getByRole('heading', { level: 1, name: 'Nova conversa' })).toBeVisible();
    for (const v of await violacoes(nutri)) falhas.push(`${tema} /painel/mensagens/nova — ${v}`);
  }
  await nutri.emulateMedia({ colorScheme: 'light' });
  expect(falhas).toEqual([]);
});

test('T6a: menu "Mensagens" → caixa (risco no topo, sem o texto) → "Nova conversa" → busca → abre a conversa', async () => {
  const menu = nutri.getByRole('navigation', { name: 'Menu do painel' });
  // com número, o nome acessível é "Mensagens, {n} não lidas" (RN-459): a semente deixa a mensagem de risco não lida
  await menu.getByRole('link', { name: /^Mensagens, \d+ não lidas?$/ }).click();
  await expect(nutri).toHaveURL(/\/painel\/mensagens$/);
  await expect(nutri).toHaveTitle('Mensagens');
  await expect(nutri.getByRole('heading', { level: 1, name: 'Mensagens' })).toBeVisible();
  await expect(menu.getByRole('link', { name: /^Mensagens/ })).toHaveAttribute('aria-current', 'page');
  await expect(menu.getByRole('link', { name: /Dúvidas dos pacientes/ })).toHaveCount(0);
  // as abas e o filtro, cada <nav> com o seu nome
  const abas = nutri.getByRole('navigation', { name: 'Seções de Mensagens' });
  await expect(abas.getByRole('link', { name: /^Conversas \(\d+\)$/ })).toHaveAttribute('aria-current', 'page');
  const filtro = nutri.getByRole('navigation', { name: 'Filtro das conversas' });
  await expect(filtro.getByRole('link', { name: 'Todas', exact: true })).toHaveAttribute('aria-current', 'page');
  // a conversa do paciente no topo, com "Sinal de risco" e "1 não lida", sem o texto da mensagem
  const conversa = nutri.getByRole('listitem').filter({ hasText: CHAT_PACIENTE.nome }).first();
  await expect(conversa).toContainText('Sinal de risco');
  await expect(conversa).toContainText(/\d+ não lidas?/);
  await expect(conversa).toContainText('Mensagem do paciente');
  await expect(nutri.locator('main')).not.toContainText('A partir de hoje você pode falar comigo por aqui');
  await filtro.getByRole('link', { name: 'Não lidas', exact: true }).click();
  await expect(nutri).toHaveURL(/\/painel\/mensagens\?filtro=nao-lidas$/);
  await expect(filtro.getByRole('link', { name: 'Não lidas', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nutri.getByRole('link', { name: new RegExp(`^${CHAT_PACIENTE.nome}`) })).toBeVisible();

  await nutri.getByRole('link', { name: 'Nova conversa', exact: true }).click();
  await expect(nutri).toHaveURL(/\/painel\/mensagens\/nova$/);
  await expect(nutri.getByRole('heading', { level: 1, name: 'Nova conversa' })).toBeVisible();
  await expect(menu.getByRole('link', { name: /^Mensagens/ })).toHaveAttribute('aria-current', 'page');
  // a busca é um formulário GET (funciona sem JS); o paciente do chat tem conta (sem "Sem acesso ao app")
  await nutri.getByLabel('Buscar paciente').fill('Chat E2E');
  await nutri.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(nutri).toHaveURL(/\/painel\/mensagens\/nova\?busca=Chat\+E2E$/);
  const linha = nutri.getByRole('link', { name: new RegExp(`^${CHAT_PACIENTE.nome}`) });
  await expect(linha).toHaveCount(1);
  await expect(linha).not.toContainText('Sem acesso ao app');
  await nutri.getByLabel('Buscar paciente').fill('zzz-ninguem');
  await nutri.getByRole('button', { name: 'Buscar', exact: true }).click();
  await expect(nutri.getByText('Nenhum paciente encontrado.')).toBeVisible();
  await nutri.goBack();
  await nutri.getByRole('link', { name: new RegExp(`^${CHAT_PACIENTE.nome}`) }).click();
  await expect(nutri).toHaveURL(new RegExp(`/painel/mensagens/${UUID}$`)); // a conversa (T6b)
});

test('T6a: o menu com "Mensagens" quebra linha sem cobrir o conteúdo (1280 px e 360 px), sem rolagem lateral', async () => {
  for (const width of [1280, 360]) {
    await nutri.setViewportSize({ width, height: 800 });
    await nutri.goto('/painel/mensagens');
    const cabecalho = await nutri.locator('header').first().boundingBox();
    const conteudo = await nutri.locator('main').first().boundingBox();
    expect(cabecalho, `${width}px: cabeçalho`).not.toBeNull();
    expect(conteudo, `${width}px: conteúdo`).not.toBeNull();
    expect(cabecalho!.y + cabecalho!.height, `${width}px: o menu não cobre o conteúdo`).toBeLessThanOrEqual(conteudo!.y + 0.5);
    expect(await nutri.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px: sem rolagem lateral`).toBe(true);
  }
  await nutri.setViewportSize({ width: 1280, height: 900 });
});
