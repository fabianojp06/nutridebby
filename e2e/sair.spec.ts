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
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/entrar\?volta=%2Fpainel$/);
  // "Voltar" do navegador não reabre o painel logado
  await page.goBack();
  await expect(page).not.toHaveURL(/\/painel$/);
  await expect(page.getByRole('heading', { name: 'Painel da nutricionista' })).toHaveCount(0);

  // a sessão foi apagada no servidor, não só o cookie no navegador: o cookie copiado antes de sair não abre o painel
  await page.context().addCookies(antes);
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByRole('heading', { name: 'Painel da nutricionista' })).toHaveCount(0);
  await page.context().close();
});

test('"Sair" também em "Segurança da conta", no aceite do DPA e em "Conta temporariamente indisponível"; sem sessão só volta para /entrar', async ({ browser }) => {
  const page = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.7.2');
  await expect(page).toHaveURL(/\/painel$/);
  const sair = page.getByRole('button', { name: 'Sair', exact: true });
  for (const rota of ['/conta/seguranca', '/painel/dpa']) {
    await page.goto(rota);
    await expect(sair, rota).toBeVisible();
  }
  await page.goto('/indisponivel');
  await expect(sair).toBeVisible();
  await sair.click();
  await expect(page).toHaveURL(/\/entrar$/);

  // sem sessão (já saiu): a página de "indisponível" é pública e o botão só leva ao login, sem erro
  await page.goto('/indisponivel');
  await sair.click();
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await page.context().close();
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
