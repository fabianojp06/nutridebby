import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { escolherTema } from './painel';

// Plano 25 (PD-90): Mensagens no painel, no consultório próprio do E2E do chat (scripts/e2e-seed.ts, CH-D67: novo a cada
// `pnpm e2e:seed`, com a conversa liberada e a mensagem do paciente com sinal de risco). T6a: o menu "Mensagens", a caixa
// (o selo "Sinal de risco" no topo), a "Nova conversa" (busca e abrir a conversa), o axe da caixa com o selo de alerta nos
// três modos (o laço de acessibilidade-painel.spec.ts vê a caixa vazia do consultório principal) e o menu que quebra linha
// sem cobrir o conteúdo. Bloco de IP deste spec (o limite de login é por IP; bloco do Plano 25, CH-D50): 10.9.25.1 a
// 10.9.25.5 na T6a — nutricionista .1; T6b: .6 a .15 — a segunda paciente do chat .6, o painel sem JS .7. A T6c usa .16
// em diante. Credenciais copiadas (importar o seed roda o seed).
const CHAT_NUTRI = { email: 'chat-nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const CHAT_PACIENTE = { nome: 'Paciente Chat E2E' };
// T6b: a segunda paciente do chat, com conta e sem a conversa liberada (scripts/e2e-seed.ts)
const CHAT_PACIENTE_2 = { email: 'chat-paciente-2-e2e@nutridebby.test', senha: 'Nutri2026segura', nome: 'Paciente Chat Dois E2E' };
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

// ——— T6b: a conversa no painel ———

/** Abre a conversa pela "Nova conversa" (busca pelo nome) e devolve a URL dela. */
async function abrirConversa(page: Page, nome: string): Promise<string> {
  await page.goto(`/painel/mensagens/nova?busca=${encodeURIComponent(nome)}`);
  await page.getByRole('link', { name: new RegExp(`^${nome}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/painel/mensagens/${UUID}$`));
  await expect(page.getByRole('heading', { level: 1, name: nome })).toBeVisible();
  return new URL(page.url()).pathname;
}
const regiaoViva = (page: Page) => page.locator('main p[role="status"]');
const listaDeMensagens = (page: Page) => page.getByRole('list', { name: 'Mensagens' });

async function pacienteNoApp(browser: Browser, ip: string): Promise<Page> {
  const p = await entrarComo(browser, CHAT_PACIENTE_2.email, CHAT_PACIENTE_2.senha, ip);
  await expect(p).toHaveURL(/\/p\//);
  return p;
}

test('T6b: axe da conversa com o "Sinal de risco" e a cópia do recado (o rótulo e o carimbo), nos três modos', async () => {
  const url = await abrirConversa(nutri, CHAT_PACIENTE.nome);
  const falhas: string[] = [];
  for (const [tema, aparelho] of [['Claro', 'light'], ['Escuro', 'light'], ['Igual ao aparelho', 'dark']] as const) {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: aparelho });
    await nutri.goto(url);
    const lista = listaDeMensagens(nutri);
    await expect(lista.getByText('Sinal de risco')).toBeVisible();
    await expect(lista.locator('li[data-recado]').getByText('Recado', { exact: true })).toBeVisible();
    // o carimbo da linha, com o CRN da semente sem "CRN" repetido (RN-471 v0.4)
    await expect(lista.getByText('Nutri Chat E2E da Silva · Nutricionista · CRN-3 25025').first()).toBeVisible();
    await expect(lista).not.toContainText('CRN CRN');
    await nutri.waitForLoadState('networkidle');
    for (const v of await violacoes(nutri)) falhas.push(`${tema} conversa — ${v}`);
  }
  await nutri.emulateMedia({ colorScheme: 'light' });
  await escolherTema(nutri, 'Igual ao aparelho');
  expect(falhas).toEqual([]);
});

test('T6b: liberar (erro junto ao campo, depois a forma e a confirmação) → enviar → a paciente abre o app → no painel, "Lida"', async ({ browser }) => {
  test.setTimeout(120_000);
  const url = await abrirConversa(nutri, CHAT_PACIENTE_2.nome);
  await expect(nutri.getByText(`A conversa com ${CHAT_PACIENTE_2.nome} ainda não foi liberada.`)).toBeVisible();
  await expect(nutri.getByLabel('Mensagem')).toHaveCount(0);
  await nutri.waitForLoadState('networkidle'); // o botão é do cliente: o clique antes da hidratação se perde
  const liberar = nutri.getByRole('button', { name: 'Liberar conversa' });
  await liberar.click();
  const dialogo = nutri.getByRole('dialog', { name: `Liberar a conversa com ${CHAT_PACIENTE_2.nome}?` });
  await expect(dialogo).toBeVisible();
  // Esc fecha e o foco volta ao botão
  await nutri.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  await expect(liberar).toBeFocused();
  await liberar.click();
  await expect(dialogo.getByText('Antes do primeiro atendimento online, faça o cadastro no e-Nutricionista')).toBeVisible();
  // "Liberar" habilitado: sem a forma e a confirmação, o erro junto aos campos, com o diálogo aberto
  await dialogo.getByRole('button', { name: 'Liberar', exact: true }).click();
  await expect(dialogo.getByRole('alert')).toHaveText('Escolha como o paciente concordou e marque a confirmação.');
  await expect(dialogo.getByLabel('Como o paciente (ou o responsável legal) concordou?')).toHaveAttribute('aria-invalid', 'true');
  await dialogo.getByLabel('Como o paciente (ou o responsável legal) concordou?').selectOption({ label: 'Aceite por escrito (mensagem ou e-mail)' });
  await dialogo.getByLabel(/deu ciência e concordou com o TCLE de telenutrição/).check();
  await dialogo.getByRole('button', { name: 'Liberar', exact: true }).click();
  await expect(nutri).toHaveURL(new RegExp(`${url}\\?ok=liberada$`));
  await expect(regiaoViva(nutri)).toHaveText('Conversa liberada.');
  await expect(regiaoViva(nutri)).toBeFocused();
  await expect(nutri.getByText(/^Liberada em \d{2}\/\d{2}\/\d{4} \(aceite por escrito\)$/)).toBeVisible();

  // enviar: a mensagem entra na lista com "Enviada", o campo fica vazio e com o foco
  const texto = `Olá! Pode me escrever por aqui. ${Date.now()}`;
  await nutri.getByLabel('Mensagem').fill(texto);
  await nutri.getByRole('button', { name: 'Enviar', exact: true }).click();
  const minha = listaDeMensagens(nutri).locator('li[data-mensagem]').filter({ hasText: texto });
  await expect(minha).toBeVisible();
  await expect(minha).toContainText('Enviada');
  await expect(nutri.getByLabel('Mensagem')).toHaveValue('');
  await expect(nutri.getByLabel('Mensagem')).toBeFocused();

  // a paciente abre o app (/p/mensagens, T7) e lê
  const paciente = await pacienteNoApp(browser, '10.9.25.6');
  await paciente.goto('/p/mensagens');
  await expect(paciente.getByText(texto)).toBeVisible();
  await paciente.context().close();
  await nutri.goto(url);
  await expect(listaDeMensagens(nutri).locator('li[data-mensagem]').filter({ hasText: texto })).toContainText('Lida');
});

test('T6b: mensagem nova com a tela aberta — em 15 s a região viva anuncia; "Mostrar novas mensagens" leva o foco à primeira nova', async ({ browser }) => {
  test.setTimeout(120_000);
  await nutri.clock.install();
  const url = await abrirConversa(nutri, CHAT_PACIENTE_2.nome);
  await nutri.waitForLoadState('networkidle');
  await expect(regiaoViva(nutri)).toHaveText('');
  const paciente = await pacienteNoApp(browser, '10.9.25.6');
  await paciente.goto('/p/mensagens');
  const texto = `Obrigada! Tenho uma dúvida. ${Date.now()}`;
  await paciente.getByLabel('Escreva sua mensagem').fill(texto);
  await paciente.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(paciente.getByText(texto)).toBeVisible();
  await paciente.context().close();
  // nada do texto chega ao painel antes do toque
  await nutri.clock.runFor(15_000);
  await expect(regiaoViva(nutri)).toHaveText('Nova mensagem de Paciente.');
  await expect(nutri.getByText(texto)).toHaveCount(0);
  await expect(nutri).toHaveURL(new RegExp(`${url}$`));
  await nutri.getByRole('button', { name: 'Mostrar novas mensagens' }).click();
  const nova = listaDeMensagens(nutri).locator('li[data-mensagem]').filter({ hasText: texto });
  await expect(nova).toBeVisible();
  await expect(nova).toBeFocused();
});

test('T6b: sem JavaScript, a conversa abre, mostra as mensagens e envia texto (RNF-443)', async ({ browser }) => {
  const url = await abrirConversa(nutri, CHAT_PACIENTE_2.nome);
  const semJs = await browser.newContext({
    storageState: await nutri.context().storageState(),
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'x-forwarded-for': '10.9.25.7' },
  });
  const page = await semJs.newPage();
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1, name: CHAT_PACIENTE_2.nome })).toBeVisible();
  await expect(listaDeMensagens(page).locator('li[data-mensagem]').first()).toBeVisible();
  const texto = `Enviada sem JavaScript ${Date.now()}`;
  await page.getByLabel('Mensagem').fill(texto);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  await expect(listaDeMensagens(page).getByText(texto)).toBeVisible();
  await semJs.close();
});
