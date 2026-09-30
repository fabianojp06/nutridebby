import { expect, test } from '@playwright/test';
import { esperarEmail, primeiroLink } from './mailpit';

const USUARIA = 'recupera-e2e@nutridebby.test';

test('esqueci minha senha: o e-mail chega e o link define a nova senha uma única vez (US-002)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.2.1' } });
  const page = await ctx.newPage();
  const antes = new Date();
  await page.goto('/esqueci-senha');
  await page.getByLabel('E-mail').fill(USUARIA);
  // Turnstile com a site key de teste da Cloudflare (sempre passa): espera o token chegar
  await expect(page.getByRole('button', { name: 'Enviar link' })).toBeEnabled({ timeout: 20_000 });
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

test('erro do servidor continua na tela depois que o widget recriado traz token novo (M19)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.2.2' } });
  const page = await ctx.newPage();
  // o servidor responde 503 (Turnstile fora do ar do lado dele); o widget de teste da Cloudflare sempre passa
  await page.route('**/api/auth/request-password-reset', (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'TURNSTILE_INDISPONIVEL', message: 'Tente novamente em alguns minutos' }) }),
  );
  await page.goto('/esqueci-senha');
  await page.getByLabel('E-mail').fill('ninguem-e2e@nutridebby.test');
  const enviar = page.getByRole('button', { name: 'Enviar link' });
  await expect(enviar).toBeEnabled({ timeout: 20_000 });
  await enviar.click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Tente novamente em alguns minutos');
  await expect(enviar).toBeEnabled({ timeout: 20_000 }); // widget recriado: token novo chegou
  await expect(page.locator('p[role="alert"]')).toHaveText('Tente novamente em alguns minutos');
  await ctx.close();
});
