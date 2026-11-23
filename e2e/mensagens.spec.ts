import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { entradasDoPlano, pacienteNoPortal, publicarPlanoSimples } from './portal';
import { escolherTema } from './painel';

// Plano 25 (PD-90): Mensagens no painel, no consultório próprio do E2E do chat (scripts/e2e-seed.ts, CH-D67: novo a cada
// `pnpm e2e:seed`, com a conversa liberada e a mensagem do paciente com sinal de risco). T6a: o menu "Mensagens", a caixa
// (o selo "Sinal de risco" no topo), a "Nova conversa" (busca e abrir a conversa), o axe da caixa com o selo de alerta nos
// três modos (o laço de acessibilidade-painel.spec.ts vê a caixa vazia do consultório principal) e o menu que quebra linha
// sem cobrir o conteúdo. Bloco de IP deste spec (o limite de login é por IP; bloco do Plano 25, CH-D50): 10.9.25.1 a
// 10.9.25.5 na T6a — nutricionista .1; T6b: .6 a .15 — a segunda paciente do chat .6, o painel sem JS .7, a segunda
// paciente na rodada da T6b .8. A T6c usa .16
// em diante (T6c: .16 a .19 — a primeira paciente do chat no app .16). Credenciais copiadas (importar o seed roda o seed).
const CHAT_NUTRI = { email: 'chat-nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const CHAT_PACIENTE = { nome: 'Paciente Chat E2E', email: 'chat-paciente-e2e@nutridebby.test', senha: 'Nutri2026segura' };
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
  // a última da conversa da semente é a cópia do recado (CH-D68): o tipo "Recado"
  await expect(conversa).toContainText('Recado');
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

// ——— Rodada da T6b (revisão de interface: C1, I1, I4) ———

test('rodada T6b (C1): o rascunho fica no campo quando chega mensagem nova e a tela refaz; o foco vai à primeira nova e, depois de enviar, volta ao campo', async ({ browser }) => {
  test.setTimeout(120_000);
  await nutri.clock.install().catch(() => undefined); // já instalado pelo teste da mensagem nova com a tela aberta
  await abrirConversa(nutri, CHAT_PACIENTE_2.nome);
  await nutri.waitForLoadState('networkidle');
  const campo = nutri.getByLabel('Mensagem');
  const rascunho = `Rascunho que não pode sumir ${Date.now()}`;
  await campo.fill(rascunho);
  const paciente = await pacienteNoApp(browser, '10.9.25.8');
  await paciente.goto('/p/mensagens');
  const texto = `Mais uma dúvida ${Date.now()}`;
  await paciente.getByLabel('Escreva sua mensagem').fill(texto);
  await paciente.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(paciente.getByText(texto)).toBeVisible();
  await paciente.context().close();
  await nutri.clock.runFor(15_000);
  await expect(regiaoViva(nutri)).toHaveText('Nova mensagem de Paciente.');
  await nutri.getByRole('button', { name: 'Mostrar novas mensagens' }).click();
  const nova = listaDeMensagens(nutri).locator('li[data-mensagem]').filter({ hasText: texto });
  await expect(nova).toBeFocused();
  // a primeira nova não fica sob o rodapé sticky (WCAG 2.4.11)
  const caixaNova = (await nova.boundingBox())!;
  const rodape = (await nutri.locator('#rodape-da-conversa').boundingBox())!;
  expect(caixaNova.y + caixaNova.height).toBeLessThanOrEqual(rodape.y + 1);
  await expect(campo).toHaveValue(rascunho); // a tela refez e o rascunho ficou
  await expect(regiaoViva(nutri)).toHaveText('');
  // enviar: o campo esvazia e recebe o foco de volta
  await nutri.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(listaDeMensagens(nutri).getByText(rascunho)).toBeVisible();
  await expect(campo).toHaveValue('');
  await expect(campo).toBeFocused();
});

test('rodada T6c (minor 4 da T6b): a 400 px, a última mensagem fica acima do rodapé sticky ao abrir a conversa', async () => {
  await nutri.setViewportSize({ width: 400, height: 800 });
  try {
    await abrirConversa(nutri, CHAT_PACIENTE.nome);
    await nutri.waitForLoadState('networkidle');
    const ultima = (await listaDeMensagens(nutri).locator('li[data-mensagem]').last().boundingBox())!;
    const rodape = (await nutri.locator('#rodape-da-conversa').boundingBox())!;
    expect(ultima.y + ultima.height, 'a última mensagem não fica sob o rodapé').toBeLessThanOrEqual(rodape.y + 1);
  } finally {
    await nutri.setViewportSize({ width: 1280, height: 900 });
  }
});

test('rodada T6b (I4): rede caída no envio — "Não foi possível enviar. Tente de novo." junto ao campo e o rascunho continua', async () => {
  await abrirConversa(nutri, CHAT_PACIENTE_2.nome);
  await nutri.waitForLoadState('networkidle');
  const campo = nutri.getByLabel('Mensagem');
  const rascunho = `Escrito sem rede ${Date.now()}`;
  await campo.fill(rascunho);
  await nutri.context().setOffline(true);
  try {
    await nutri.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(nutri.locator('#erro-mensagem')).toHaveText('Não foi possível enviar. Tente de novo.');
    await expect(campo).toHaveValue(rascunho);
    await expect(nutri.getByRole('heading', { level: 1, name: CHAT_PACIENTE_2.nome })).toBeVisible(); // nada de error boundary
  } finally {
    await nutri.context().setOffline(false);
  }
  await nutri.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(listaDeMensagens(nutri).getByText(rascunho)).toBeVisible();
  await expect(campo).toHaveValue('');
});

test('rodada T6b (I1): pausar → retomar — cada retorno é anunciado na região viva, que recebe o foco sem rolar a tela', async () => {
  const url = await abrirConversa(nutri, CHAT_PACIENTE_2.nome);
  await nutri.waitForLoadState('networkidle');
  await nutri.getByRole('button', { name: 'Pausar conversa' }).click();
  const pausar = nutri.getByRole('dialog', { name: 'Pausar conversa' });
  await expect(pausar).toContainText('Combine com o paciente como o acompanhamento continua.');
  await expect(pausar.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await pausar.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(nutri).toHaveURL(new RegExp(`${url}\\?ok=pausada$`));
  await expect(regiaoViva(nutri)).toHaveText('Conversa pausada.');
  await expect(regiaoViva(nutri)).toBeFocused();
  await expect(nutri.getByText('Conversa pausada', { exact: true })).toBeVisible();
  await expect(nutri.getByLabel('Mensagem')).toHaveCount(0);
  const rolagemAntes = await nutri.evaluate(() => window.scrollY);
  await nutri.getByRole('button', { name: 'Retomar conversa' }).click();
  await expect(nutri).toHaveURL(new RegExp(`${url}\\?ok=retomada$`));
  await expect(regiaoViva(nutri)).toHaveText('Conversa retomada.');
  await expect(regiaoViva(nutri)).toBeFocused();
  expect(Math.abs((await nutri.evaluate(() => window.scrollY)) - rolagemAntes)).toBeLessThan(400);
  await expect(nutri.getByLabel('Mensagem')).toBeVisible();
});

// ——— T6c: configuração e ficha ———

test('T6c: "Atendimento por mensagens" pelo hub — erro de sobreposição junto à faixa, salvar e ver o resumo no app (T7)', async ({ browser }) => {
  test.setTimeout(120_000);
  await nutri.goto('/painel/configuracoes');
  await nutri.getByRole('link', { name: /^Atendimento por mensagens/ }).click();
  await expect(nutri).toHaveURL(/\/painel\/configuracoes\/mensagens$/);
  await expect(nutri.getByRole('heading', { level: 1, name: 'Atendimento por mensagens' })).toBeVisible();
  await nutri.waitForLoadState('networkidle'); // "Acrescentar faixa" é do cliente
  await nutri.getByLabel('Mostrar horário de atendimento aos pacientes').check();
  const segunda = nutri.getByRole('group', { name: 'Segunda' });
  // o próprio estado: tira as faixas da segunda que outra execução deixou
  while ((await segunda.getByRole('button', { name: /^Remover faixa 1 de Segunda$/ }).count()) > 0) await segunda.getByRole('button', { name: 'Remover faixa 1 de Segunda' }).click();
  await expect(segunda.getByRole('button', { name: 'Acrescentar faixa' })).toBeFocused(); // rodada da T6c (I2): sem faixa, o foco no botão
  await segunda.getByRole('button', { name: 'Acrescentar faixa' }).click();
  await expect(segunda.getByLabel('Segunda, faixa 1, das')).toBeFocused(); // I2: o "Das" da faixa nova
  await segunda.getByLabel('Segunda, faixa 1, das').selectOption({ label: '09:00' });
  await segunda.getByLabel('Segunda, faixa 1, às').selectOption({ label: '18:00' });
  await segunda.getByRole('button', { name: 'Acrescentar faixa' }).click();
  await segunda.getByLabel('Segunda, faixa 2, das').selectOption({ label: '17:00' });
  await segunda.getByLabel('Segunda, faixa 2, às').selectOption({ label: '24:00' });
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(segunda.getByRole('alert')).toHaveText('As faixas do mesmo dia não podem se sobrepor.');
  // rodada da T6c (I1): o foco vai à faixa com erro, rolada para a tela
  await expect(segunda.getByLabel('Segunda, faixa 2, das')).toBeFocused();
  await expect(segunda.getByLabel('Segunda, faixa 2, das')).toBeInViewport();
  await expect(segunda.getByLabel('Segunda, faixa 2, das')).toHaveAttribute('aria-invalid', 'true');
  // o que foi escolhido continua na tela; remove a faixa que sobrepõe e salva
  await expect(segunda.getByLabel('Segunda, faixa 1, das')).toHaveValue('540');
  await segunda.getByRole('button', { name: 'Remover faixa 2 de Segunda' }).click();
  await expect(segunda.getByLabel('Segunda, faixa 1, das')).toBeFocused(); // I2: a vizinha
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(nutri).toHaveURL(/\?ok=salva&r=[0-9a-f]{8}$/);
  await expect(nutri.locator('main p[role="status"]')).toHaveText('Configuração salva.');
  await expect(nutri.locator('main p[role="status"]')).toBeFocused(); // I3: a região sempre montada recebe o foco
  await expect(nutri.getByLabel('Segunda, faixa 1, às')).toHaveValue('1080');
  // a paciente vê o resumo no app (/p/mensagens, T7)
  const paciente = await entrarComo(browser, CHAT_PACIENTE.email, CHAT_PACIENTE.senha, '10.9.25.16');
  await paciente.goto('/p/mensagens');
  await expect(paciente.getByText(/^Horário de atendimento por mensagens: .*9h às 18h\.$/)).toBeVisible();
  await paciente.context().close();
});

test('rodada T6c (I4): rede caída ao salvar — "Não foi possível salvar. Tente de novo." e as faixas escolhidas continuam na tela', async () => {
  await nutri.goto('/painel/configuracoes/mensagens');
  await nutri.waitForLoadState('networkidle');
  const sabado = nutri.getByRole('group', { name: 'Sábado' });
  await sabado.getByRole('button', { name: 'Acrescentar faixa' }).click();
  const n = await sabado.locator('select[name="inicio-6"]').count();
  await sabado.getByLabel(`Sábado, faixa ${n}, das`).selectOption({ label: '07:15' });
  await nutri.context().setOffline(true);
  try {
    await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(nutri.getByRole('alert').filter({ hasText: 'Não foi possível salvar. Tente de novo.' })).toBeVisible();
    await expect(sabado.getByLabel(`Sábado, faixa ${n}, das`)).toHaveValue('435');
  } finally {
    await nutri.context().setOffline(false);
  }
});

test('T6c: axe de "Atendimento por mensagens" com faixas e o erro na tela, nos três modos', async () => {
  const falhas: string[] = [];
  for (const [tema, aparelho] of [['Claro', 'light'], ['Escuro', 'light'], ['Igual ao aparelho', 'dark']] as const) {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: aparelho });
    await nutri.goto('/painel/configuracoes/mensagens');
    await nutri.waitForLoadState('networkidle');
    // rodada da T6c (minor 3): o Domingo, que nenhum outro teste usa — uma faixa com o fim antes do início, sem salvar nada
    const domingo = nutri.getByRole('group', { name: 'Domingo' });
    await domingo.getByRole('button', { name: 'Acrescentar faixa' }).click();
    const n = await domingo.locator('select[name="inicio-0"]').count();
    await domingo.getByLabel(`Domingo, faixa ${n}, das`).selectOption({ label: '10:00' });
    await domingo.getByLabel(`Domingo, faixa ${n}, às`).selectOption({ label: '09:00' });
    await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(domingo.getByRole('alert')).toBeVisible();
    for (const v of await violacoes(nutri)) falhas.push(`${tema} /painel/configuracoes/mensagens — ${v}`);
  }
  await nutri.emulateMedia({ colorScheme: 'light' });
  await escolherTema(nutri, 'Igual ao aparelho');
  expect(falhas).toEqual([]);
});

test('T6c: a seção "Mensagens" no Início da ficha — "{n} não lidas", os itens sem o texto, "Ver todos" e "Enviar mensagem" em Outros', async () => {
  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(CHAT_PACIENTE_2.nome)}`);
  await nutri.getByRole('link', { name: CHAT_PACIENTE_2.nome, exact: true }).click();
  await expect(nutri).toHaveURL(new RegExp(`/painel/pacientes/${UUID}$`));
  const id = /\/painel\/pacientes\/([0-9a-f-]{36})$/.exec(new URL(nutri.url()).pathname)![1];
  const secao = nutri.locator('details').filter({ has: nutri.getByRole('heading', { name: /^Mensagens \(\d+ não lidas?\)$/ }) });
  await expect(secao).toBeVisible();
  await expect(secao.getByRole('link', { name: /^Mensagem (do paciente|enviada)/ }).first()).toBeVisible();
  await expect(secao).not.toContainText('Pode me escrever por aqui');
  await expect(secao.getByRole('link', { name: 'Ver todos: Mensagens' })).toHaveAttribute('href', `/painel/mensagens/${id}`);
  await nutri.getByRole('button', { name: 'Adicionar ao prontuário' }).click();
  const dialogo = nutri.getByRole('dialog', { name: 'Adicionar ao prontuário' });
  await expect(dialogo.getByRole('heading', { name: 'Outros' })).toBeVisible();
  await expect(dialogo.getByRole('link', { name: 'Enviar mensagem' })).toHaveAttribute('href', `/painel/mensagens/${id}`);
  await nutri.keyboard.press('Escape');
});

// ——— T7: a conversa no app (/p/mensagens). Bloco de IP: 10.9.25.20 a 10.9.25.39 — a primeira paciente do chat .20 (a
// faixa, o envio e o "Lida"), .21 (sinal de risco), .22 (400 px e axe), .23 (sem rede), .24 (sem JavaScript), .25 (mensagem
// nova com a tela aberta); rodada da T7: .26 (a nutricionista do consultório principal) e .27 (a paciente com plano
// guardado) ———

const NO_APP = { campo: 'Escreva sua mensagem', urgencia: 'Este canal não é para urgências. Em caso de urgência, ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo.' };
const listaDoApp = (page: Page) => page.getByRole('list', { name: 'Mensagens' });
const regiaoDoApp = (page: Page) => page.locator('#regiao-da-conversa');

async function primeiraPacienteNoApp(browser: Browser, ip: string, opcoes: Parameters<Browser['newContext']>[0] = {}): Promise<Page> {
  const p = await entrarComo(browser, CHAT_PACIENTE.email, CHAT_PACIENTE.senha, ip, opcoes);
  await expect(p).toHaveURL(/\/p\//);
  return p;
}
/** A nutricionista do chat escreve à primeira paciente pela conversa do painel (a T6b já cobre a tela). */
async function nutriEscreve(texto: string): Promise<string> {
  const url = await abrirConversa(nutri, CHAT_PACIENTE.nome);
  await nutri.waitForLoadState('networkidle');
  await nutri.getByLabel('Mensagem').fill(texto);
  await nutri.getByRole('button', { name: 'Enviar', exact: true }).click();
  const enviada = listaDeMensagens(nutri).locator('li[data-mensagem]').filter({ hasText: texto });
  await expect(enviada).toBeVisible();
  await expect(enviada).toBeInViewport(); // rodada da T7 (I3): depois de enviar, a tela rola até a nova (painel)
  return url;
}

test('T7: a paciente abre pela faixa ("Mensagens (1)"), vê o cabeçalho e o aviso, envia ("Você", "Enviada"); a faixa volta a "Mensagens"; no painel, aberta → no app, "Lida"', async ({ browser }) => {
  test.setTimeout(120_000);
  // rodada da T7 (I4): sem depender da ordem — a paciente lê tudo antes, e só a mensagem deste teste fica não lida
  const paciente = await primeiraPacienteNoApp(browser, '10.9.25.20');
  await paciente.goto('/p/mensagens');
  await expect(paciente.getByRole('heading', { level: 1, name: 'Mensagens' })).toBeVisible();
  const daNutri = `Bom dia! Como foi a semana? ${Date.now()}`;
  const url = await nutriEscreve(daNutri);
  await paciente.goto('/p/inicio');
  const link = paciente.getByRole('link', { name: 'Mensagens, 1 não lida' });
  await expect(link).toHaveText('Mensagens (1)');
  await link.click();
  await expect(paciente).toHaveURL(/\/p\/mensagens$/);
  await expect(paciente.getByRole('heading', { level: 1, name: 'Mensagens' })).toBeVisible();
  await expect(paciente.getByText('Conversa com Nutri Chat E2E da Silva, nutricionista, CRN-3 25025', { exact: true })).toBeVisible();
  await expect(paciente.getByText(NO_APP.urgencia)).toBeVisible();
  await expect(paciente.getByRole('link', { name: 'Voltar para Hoje' })).toHaveAttribute('href', '/p/inicio');
  const dela = listaDoApp(paciente).locator('li[data-mensagem]').filter({ hasText: daNutri });
  await expect(dela).toContainText('Nutri Chat E2E da Silva · Nutricionista · CRN-3 25025');
  await expect(listaDoApp(paciente).locator('li[data-mensagem]').last()).toBeInViewport(); // abre no fim (I3)
  await expect(listaDoApp(paciente)).not.toContainText('CRN CRN');
  // o recado da semente, com o rótulo do consultório
  await expect(listaDoApp(paciente).locator('li[data-recado]').first()).toContainText('Recado do consultório · Nutri Chat E2E da Silva · CRN-3 25025');
  // enviar: "Você" e "Enviada"; o campo esvazia e fica com o foco
  await paciente.waitForLoadState('networkidle');
  const texto = `Foi boa, obrigada! ${Date.now()}`;
  const campo = paciente.getByLabel(NO_APP.campo);
  await campo.fill(texto);
  await paciente.getByRole('button', { name: 'Enviar', exact: true }).click();
  const minha = listaDoApp(paciente).locator('li[data-mensagem]').filter({ hasText: texto });
  await expect(minha).toContainText('Enviada');
  await expect(minha).toContainText('Você');
  await expect(minha).toBeInViewport(); // depois de enviar, a nova à vista acima do rodapé (I3)
  await expect(campo).toHaveValue('');
  await expect(campo).toBeFocused();
  // de volta a Hoje: o link sem número (a conversa já foi lida)
  await paciente.getByRole('link', { name: 'Voltar para Hoje' }).click();
  await expect(paciente.getByRole('link', { name: 'Mensagens', exact: true })).toBeVisible();
  // a nutricionista abre a conversa; no app, "Lida"
  await nutri.goto(url);
  await expect(listaDeMensagens(nutri).getByText(texto)).toBeVisible();
  await expect(listaDeMensagens(nutri).locator('li[data-mensagem]').last()).toBeInViewport(); // o painel abre no fim (I3)
  await paciente.goto('/p/mensagens');
  await expect(listaDoApp(paciente).locator('li[data-mensagem]').filter({ hasText: texto })).toContainText('Lida');
  await paciente.context().close();
});

test('T7: sinal de risco — o socorro de sintoma agudo logo abaixo da mensagem (com o foco), o de emergência com o CVV; a mensagem chega ao painel com o selo', async ({ browser }) => {
  test.setTimeout(120_000);
  const paciente = await primeiraPacienteNoApp(browser, '10.9.25.21');
  await paciente.goto('/p/mensagens');
  await paciente.waitForLoadState('networkidle');
  const sufixo = Date.now();
  await paciente.getByLabel(NO_APP.campo).fill(`estou com dor no peito e falta de ar ${sufixo}`);
  await paciente.getByRole('button', { name: 'Enviar', exact: true }).click();
  const agudo = listaDoApp(paciente).locator('li[data-mensagem]').filter({ hasText: `falta de ar ${sufixo}` });
  const socorro = agudo.locator('[data-socorro]');
  await expect(socorro).toContainText('Esses sinais precisam de atendimento médico agora.');
  await expect(socorro).not.toContainText('CVV');
  await expect(socorro).toBeFocused();
  await expect(socorro.getByRole('link', { name: '192' })).toHaveAttribute('href', 'tel:192');
  await paciente.getByLabel(NO_APP.campo).fill(`não aguento mais, quero sumir ${sufixo}`);
  await paciente.getByRole('button', { name: 'Enviar', exact: true }).click();
  const emergencia = listaDoApp(paciente).locator('li[data-mensagem]').filter({ hasText: `quero sumir ${sufixo}` }).locator('[data-socorro]');
  await expect(emergencia).toContainText('ligue para o CVV no 188');
  await paciente.context().close();
  await abrirConversa(nutri, CHAT_PACIENTE.nome);
  await expect(listaDeMensagens(nutri).locator('li[data-mensagem]').filter({ hasText: `falta de ar ${sufixo}` })).toContainText('Sinal de risco');
});

test('T7: 400 px sem rolagem lateral, alvos de 44 px no rodapé; axe de /p/mensagens (risco, socorro e recado na tela) no claro e no escuro', async ({ browser }) => {
  const paciente = await primeiraPacienteNoApp(browser, '10.9.25.22', { viewport: { width: 400, height: 800 } });
  const falhas: string[] = [];
  for (const esquema of ['light', 'dark'] as const) {
    await paciente.emulateMedia({ colorScheme: esquema });
    await paciente.goto('/p/mensagens');
    await expect(listaDoApp(paciente).locator('[data-socorro]').first()).toBeVisible();
    await expect(listaDoApp(paciente).locator('li[data-recado]').first()).toBeVisible();
    await paciente.waitForLoadState('networkidle');
    expect(await paciente.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), esquema).toBe(true);
    for (const v of await violacoes(paciente)) falhas.push(`${esquema} /p/mensagens — ${v}`);
  }
  const enviar = (await paciente.getByRole('button', { name: 'Enviar', exact: true }).boundingBox())!;
  expect(enviar.height).toBeGreaterThanOrEqual(44);
  const voltar = (await paciente.getByRole('link', { name: 'Voltar para Hoje' }).boundingBox())!;
  expect(voltar.height).toBeGreaterThanOrEqual(44);
  await paciente.goto('/p/inicio');
  const link = (await paciente.getByRole('link', { name: /^Mensagens/ }).boundingBox())!;
  expect(link.height).toBeGreaterThanOrEqual(44);
  expect(await paciente.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await paciente.context().close();
  expect(falhas).toEqual([]);
});

test('T7: sem rede — "Sem conexão. Escreva quando voltar." na região, campo e botão desabilitados com o texto preservado; recarregar sem rede mostra o aviso, nunca o plano', async ({ browser }) => {
  const paciente = await primeiraPacienteNoApp(browser, '10.9.25.23');
  await paciente.goto('/p/mensagens');
  await paciente.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await paciente.waitForLoadState('networkidle');
  const campo = paciente.getByLabel(NO_APP.campo);
  const rascunho = `Escrevendo no metrô ${Date.now()}`;
  await campo.fill(rascunho);
  await expect(regiaoDoApp(paciente)).toHaveText('');
  await paciente.context().setOffline(true);
  try {
    await expect(regiaoDoApp(paciente)).toHaveText('Sem conexão. Escreva quando voltar.');
    await expect(campo).toBeDisabled();
    await expect(campo).toHaveValue(rascunho);
    await expect(paciente.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
    // a navegação sem rede: o service worker responde a página do aviso (nada guardado, nunca o plano)
    await paciente.goto('/p/mensagens');
    await expect(paciente.getByRole('status').filter({ hasText: 'Sem conexão. Escreva quando voltar.' })).toBeVisible();
    await expect(paciente.getByText('Offline — exibindo última versão')).toHaveCount(0);
    await expect(paciente.getByRole('heading', { name: 'Plano de hoje' })).toHaveCount(0);
    expect(await paciente.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat().filter((u) => u.includes('/p/mensagens')))).toEqual([]);
  } finally {
    await paciente.goto('about:blank');
    await paciente.context().setOffline(false);
  }
  // a rede voltou: a conversa abre de novo
  await paciente.goto('/p/mensagens');
  await expect(paciente.getByLabel(NO_APP.campo)).toBeEnabled();
  await paciente.context().close();
});

test('T7: sem JavaScript, a conversa abre, mostra as mensagens e envia texto (RNF-443)', async ({ browser }) => {
  const comJs = await primeiraPacienteNoApp(browser, '10.9.25.24');
  await comJs.goto('/p/mensagens');
  const semJs = await browser.newContext({ storageState: await comJs.context().storageState(), javaScriptEnabled: false, extraHTTPHeaders: { 'x-forwarded-for': '10.9.25.24' } });
  await comJs.context().close();
  const page = await semJs.newPage();
  await page.goto('/p/mensagens');
  await expect(page.getByRole('heading', { level: 1, name: 'Mensagens' })).toBeVisible();
  await expect(listaDoApp(page).locator('li[data-mensagem]').first()).toBeVisible();
  const texto = `Enviada do app sem JavaScript ${Date.now()}`;
  await page.getByLabel(NO_APP.campo).fill(texto);
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/mensagens$/);
  await expect(listaDoApp(page).getByText(texto)).toBeVisible();
  await semJs.close();
});

test('T7: mensagem nova com a tela aberta — em 15 s "Nova mensagem da sua nutricionista." sem o texto; "Mostrar novas mensagens" leva o foco à nova e o rascunho fica', async ({ browser }) => {
  test.setTimeout(120_000);
  const paciente = await primeiraPacienteNoApp(browser, '10.9.25.25');
  await paciente.clock.install();
  await paciente.goto('/p/mensagens');
  await paciente.waitForLoadState('networkidle');
  const rascunho = `Rascunho do app ${Date.now()}`;
  await paciente.getByLabel(NO_APP.campo).fill(rascunho);
  const daNutri = `Lembrete: traga os exames ${Date.now()}`;
  await nutriEscreve(daNutri);
  await paciente.clock.runFor(15_000);
  await expect(regiaoDoApp(paciente)).toHaveText('Nova mensagem da sua nutricionista.');
  await expect(paciente.getByText(daNutri)).toHaveCount(0);
  await paciente.getByRole('button', { name: 'Mostrar novas mensagens' }).click();
  const nova = listaDoApp(paciente).locator('li[data-mensagem]').filter({ hasText: daNutri });
  await expect(nova).toBeFocused();
  await expect(paciente.getByLabel(NO_APP.campo)).toHaveValue(rascunho);
  await expect(regiaoDoApp(paciente)).toHaveText('');
  await paciente.context().close();
});

test('rodada T7 (I4): paciente com o plano guardado no aparelho — sem rede, /p/mensagens mostra o aviso e nunca o plano', async ({ browser }) => {
  test.setTimeout(180_000);
  // o consultório principal do E2E: a paciente nova tem plano publicado e a cópia guardada (o chat não importa aqui)
  const principal = await entrarComo(browser, 'nutri-e2e@nutridebby.test', 'Nutri2026segura', '10.9.25.26');
  await expect(principal).toHaveURL(/\/painel$/);
  const p = await pacienteNoPortal(browser, principal, '10.9.25.27');
  await publicarPlanoSimples(principal, p.prontuario);
  await principal.context().close();
  await p.page.goto('/p/inicio');
  await p.page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Plano' }).click();
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect.poll(() => entradasDoPlano(p.page)).toBe(1);
  await p.page.context().setOffline(true);
  try {
    // a cópia existe: outra rota do portal cai nela…
    await p.page.goto('/p/inicio');
    await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
    // …mas a conversa nunca: o aviso, sem o plano e sem o selo da cópia
    await p.page.goto('/p/mensagens');
    await expect(p.page.getByRole('status').filter({ hasText: 'Sem conexão. Escreva quando voltar.' })).toBeVisible();
    await expect(p.page.getByText('Este canal não é para urgências.', { exact: false })).toBeVisible();
    await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toHaveCount(0);
    await expect(p.page.getByText('Offline — exibindo última versão')).toHaveCount(0);
  } finally {
    await p.page.goto('about:blank');
    await p.page.context().setOffline(false);
  }
  await p.page.context().close();
});
