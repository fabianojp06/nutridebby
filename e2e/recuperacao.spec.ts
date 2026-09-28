import { expect, test } from '@playwright/test';
import { esperarEmail, primeiroLink } from './mailpit';

const USUARIA = 'recupera-e2e@nutridebby.test';

test('esqueci minha senha: o e-mail chega e o link define a nova senha uma única vez (US-002)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.2.1' } });
  const page = await ctx.newPage();
  const antes = new Date();
  await page.goto('/esqueci-senha');
  await page.getByLabel('E-mail').fill(USUARIA);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page.getByRole('status')).toHaveText('Se o e-mail estiver cadastrado, você receberá um link');

  const email = await esperarEmail(USUARIA, { assunto: 'Redefinição de senha', depoisDe: antes });
  const link = primeiroLink(email.texto, '/api/auth/reset-password/');
  await page.goto(link);
  await expect(page).toHaveURL(/\/definir-senha\?token=/);
  const nova = `Nova${Date.now()}senha`;
  await page.getByLabel('Nova senha').fill(nova);
  await page.getByLabel('Repita a senha').fill(nova);
  await page.getByRole('button', { name: 'Definir senha' }).click();
  await expect(page.getByRole('status')).toContainText('Senha definida.');

  await page.goto(link); // uso único
  await expect(page.locator('p[role="alert"]')).toHaveText('Link inválido ou expirado. Peça um novo.');

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(USUARIA);
  await page.getByLabel('Senha').fill(nova);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await ctx.close();
});
