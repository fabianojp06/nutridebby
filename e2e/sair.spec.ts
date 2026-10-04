import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const COOKIE_SESSAO = 'nd.session_token';

test('nutricionista sai pelo "Sair" do painel: cai em /entrar, /painel deixa de abrir e o cookie antigo não vale mais (US-002 "Sair")', async ({ browser }) => {
  const page = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.7.1');
  await expect(page).toHaveURL(/\/painel$/);
  // "depois de Segurança, no fim do menu"
  const menu = page.getByRole('navigation', { name: 'Menu do painel' });
  await expect(menu.locator('a, button').last()).toHaveText('Sair');
  await expect(menu.locator('a, button').nth(-2)).toHaveText('Segurança');
  const antes = await page.context().cookies();
  expect(antes.map((c) => c.name)).toContain(COOKIE_SESSAO);

  await menu.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  expect((await page.context().cookies()).map((c) => c.name)).not.toContain(COOKIE_SESSAO);
  // "Voltar" do navegador, logo depois de sair, não reabre o painel logado: a página é pedida de novo e o proxy manda para o login
  await page.goBack();
  await expect(page).toHaveURL(/\/entrar\?volta=%2Fpainel$/);
  await expect(page.getByRole('heading', { name: 'Painel da nutricionista' })).toHaveCount(0);
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/entrar\?volta=%2Fpainel$/);

  // a sessão foi apagada no servidor, não só o cookie no navegador: o cookie copiado antes de sair não abre o painel
  await page.context().addCookies(antes);
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByRole('heading', { name: 'Painel da nutricionista' })).toHaveCount(0);
  await page.context().close();
});

test('"Sair" também em "Segurança da conta", no aceite do DPA e em "Conta temporariamente indisponível" (esta só com sessão)', async ({ browser }) => {
  const page = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.7.2');
  await expect(page).toHaveURL(/\/painel$/);
  const sair = page.getByRole('button', { name: 'Sair', exact: true });
  for (const rota of ['/conta/seguranca', '/painel/dpa', '/indisponivel']) {
    await page.goto(rota);
    await expect(sair, rota).toBeVisible();
  }
  await sair.click();
  await expect(page).toHaveURL(/\/entrar$/);

  // sem sessão (já saiu): "Conta temporariamente indisponível" é pública e não oferece "Sair"; fica só o caminho para o login
  await page.goto('/indisponivel');
  await expect(page.getByRole('heading', { name: 'Conta temporariamente indisponível' })).toBeVisible();
  await expect(sair).toHaveCount(0);
  await page.getByRole('link', { name: 'Voltar para o login' }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.context().close();
});

test('duas abas: depois de sair numa, "Sair" na outra (que ainda mostra o painel) vai para /entrar, sem "Application error"', async ({ browser }) => {
  const primeira = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.7.4');
  await expect(primeira).toHaveURL(/\/painel$/);
  const segunda = await primeira.context().newPage();
  await segunda.goto('/painel');
  await expect(segunda.getByRole('heading', { name: 'Painel da nutricionista' })).toBeVisible();

  await primeira.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(primeira).toHaveURL(/\/entrar$/);

  // o cookie já sumiu: a segunda aba, ainda no painel, não pode quebrar ao sair
  await segunda.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(segunda).toHaveURL(/\/entrar$/);
  await expect(segunda.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(segunda.getByText('Application error')).toHaveCount(0);
  await expect(segunda.getByText('Algo deu errado.')).toHaveCount(0); // P08-01: a tela de erro do app (error.tsx)
  await primeira.context().close();
});

test('POST /sair só vale da própria origem: de outro site é 403 e a sessão fica; GET não existe', async ({ browser, baseURL }) => {
  const page = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.7.5');
  await expect(page).toHaveURL(/\/painel$/);
  const pedir = (headers: Record<string, string>) => page.request.post('/sair', { headers, maxRedirects: 0 });
  expect((await pedir({ origin: 'https://evil.example' })).status()).toBe(403);
  expect((await pedir({})).status()).toBe(403); // sem Origin nem Sec-Fetch-Site
  expect((await page.request.get('/sair', { maxRedirects: 0 })).status()).toBe(405);
  await page.goto('/painel'); // nada disso encerrou a sessão
  await expect(page.getByRole('heading', { name: 'Painel da nutricionista' })).toBeVisible();
  const certo = await pedir({ origin: new URL(baseURL!).origin });
  expect(certo.status()).toBe(303);
  expect(certo.headers()['location']).toBe('/entrar');
  await page.goto('/painel'); // este sim: a sessão acabou
  await expect(page).toHaveURL(/\/entrar\?/);
  await page.context().close();
});

test('"/sair/erro" (não foi possível apagar a sessão) é pública e oferece tentar de novo e voltar ao início', async ({ page }) => {
  await page.goto('/sair/erro');
  await expect(page.getByRole('heading', { name: 'Não foi possível sair agora. Tente de novo.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar ao início' }).click();
  await expect(page).toHaveURL(/\/entrar$/); // "/" leva ao login
});

test('as páginas de alimentos também mostram o menu do painel com "Sair" (lista, novo e a página de um alimento)', async ({ browser }) => {
  const page = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.7.3');
  await expect(page).toHaveURL(/\/painel$/);
  const menu = page.getByRole('navigation', { name: 'Menu do painel' });
  const CHUCHU = '/painel/alimentos/00000000-0000-4000-8000-000000000112'; // TACO: "Chuchu, cozido"
  for (const rota of ['/painel/alimentos', '/painel/alimentos/novo', CHUCHU]) {
    await page.goto(rota);
    await expect(menu, rota).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Alimentos', exact: true }), rota).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Sair', exact: true }), rota).toBeVisible();
  }
  await menu.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.context().close();
});

test('páginas públicas não têm o botão "Sair"', async ({ page }) => {
  for (const rota of ['/entrar', '/esqueci-senha', '/definir-senha?token=token-invalido', '/convite/token-invalido']) {
    await page.goto(rota);
    await expect(page.locator('main, form').first(), rota).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sair', exact: true }), rota).toHaveCount(0);
  }
});
