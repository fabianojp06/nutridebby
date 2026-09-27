import { expect, test } from '@playwright/test';
import { TOTP } from 'otpauth';

const ADMIN = { email: 'admin-e2e@nutridebby.test', password: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

test('rota protegida sem sessão vai para /entrar', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/entrar\?volta=%2Fadmin/);
});

test('admin sem 2FA é obrigado a ativar e depois chega à administração', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.0.1' } });
  const page = await ctx.newPage();
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/conta\/seguranca/);
  await page.getByLabel('Confirme sua senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Código de 6 dígitos').fill(new TOTP({ secret }).generate());
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByTestId('backup-codes').locator('li')).toHaveCount(10);
  await page.getByRole('link', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible();
  await ctx.close();
});

test('senha errada 5 vezes bloqueia com a mensagem da spec', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.0.2' } });
  const page = await ctx.newPage();
  await page.goto('/entrar');
  for (let i = 0; i < 6; i++) {
    await page.getByLabel('E-mail').fill(ADMIN.email);
    await page.getByLabel('Senha').fill(`errada-${i}-123456`);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('p[role="alert"]')).toBeVisible();
  }
  await expect(page.locator('p[role="alert"]')).toHaveText('Muitas tentativas. Tente novamente em 15 minutos.');
  await ctx.close();
});

test('?volta externo não redireciona para fora (Review Focus 3)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.0.3' } });
  const page = await ctx.newPage();
  await page.goto('/entrar?volta=//evil.com');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/entrar\/2fa/); // admin já tem 2FA: nunca sai do domínio
  await ctx.close();
});
