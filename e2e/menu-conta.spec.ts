import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };

// Revisão da T14 (Plano 08): o layout do painel fica montado na navegação do App Router e o `open` do <details> é estado
// do DOM — sem o DetalhesDaConta, o menu da conta ficava aberto sobre a tela nova. IP 10.9.16.x (bloco só deste spec).
test('menu da conta: fecha ao escolher um item, com Esc (o foco volta ao avatar) e com clique fora', async ({ browser }) => {
  const page = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.16.1');
  await expect(page).toHaveURL(/\/painel$/);
  const avatar = page.getByLabel(/^Conta de /);
  const perfil = page.getByRole('link', { name: 'Perfil e marca', exact: true });

  await avatar.click();
  await expect(perfil).toBeVisible();
  await perfil.click();
  await expect(page).toHaveURL(/\/painel\/configuracoes\/perfil$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Perfil e marca' })).toBeVisible();
  await expect(perfil).toBeHidden();

  await avatar.click();
  await expect(perfil).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(perfil).toBeHidden();
  await expect(avatar).toBeFocused();

  await avatar.click();
  await expect(perfil).toBeVisible();
  await page.getByRole('heading', { level: 1, name: 'Perfil e marca' }).click();
  await expect(perfil).toBeHidden();

  // o "Sair" de dentro do menu continua postando (o menu só fecha sozinho em links)
  await avatar.click();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.context().close();
});
