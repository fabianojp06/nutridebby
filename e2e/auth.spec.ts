import { expect, test } from '@playwright/test';
import { TOTP } from 'otpauth';

const ADMIN = { email: 'admin-e2e@nutridebby.test', password: 'Nutri2026segura' };
const NUTRI = { email: 'nutri-e2e@nutridebby.test', password: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

let adminTotpSecret = ''; // definido ao ativar o 2FA; reusado no login com 2FA

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
  // obrigado a ativar o 2FA: precisa poder sair sem configurar (US-002 "Sair")
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
  await page.getByLabel('Confirme sua senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  adminTotpSecret = secret;
  await page.getByLabel('Código de 6 dígitos').fill(new TOTP({ secret }).generate());
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByTestId('backup-codes').locator('li')).toHaveCount(10);
  await page.getByRole('link', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible();
  await ctx.close();
});

test('login com 2FA preserva caminho e query do ?volta até o destino', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.0.5' } });
  const page = await ctx.newPage();
  await page.goto('/conta/seguranca?aba=2fa');
  await expect(page).toHaveURL(/\/entrar\?volta=%2Fconta%2Fseguranca%3Faba%3D2fa$/);
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/entrar\/2fa\?volta=%2Fconta%2Fseguranca%3Faba%3D2fa$/);
  await page.getByLabel('Código do app autenticador').fill(new TOTP({ secret: adminTotpSecret }).generate());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(/\/conta\/seguranca\?aba=2fa$/);
  await expect(page.getByText('A verificação em duas etapas está ativa.')).toBeVisible();
  await ctx.close();
});

test('admin sai pelo "Sair" do topo da administração; /admin deixa de abrir (US-002 "Sair")', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.0.7' } });
  const page = await ctx.newPage();
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/entrar\/2fa/);
  await page.getByLabel('Código do app autenticador').fill(new TOTP({ secret: adminTotpSecret }).generate());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible();
  // no topo de todas as páginas do admin (layout comum), não só na lista de contas
  const sair = page.getByRole('banner').getByRole('button', { name: 'Sair', exact: true });
  await expect(sair).toBeVisible();
  await page.goto('/admin/contas/nova');
  await expect(sair).toBeVisible();
  await sair.click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/entrar\?volta=%2Fadmin$/);
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
  await page.getByLabel('E-mail').fill(NUTRI.email);
  await page.getByLabel('Senha').fill(NUTRI.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/); // nunca sai do domínio, mesmo com ?volta=//evil.com
  await expect(page.getByRole('heading', { name: /^Seu dia, / })).toBeVisible();
  await ctx.close();
});

test('?volta que a normalização vira //host (/.//evil.com) também não sai do domínio (S1)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.0.6' } });
  const page = await ctx.newPage();
  await page.goto('/entrar?volta=%2F.%2F%2Fevil.com');
  await page.getByLabel('E-mail').fill(NUTRI.email);
  await page.getByLabel('Senha').fill(NUTRI.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/painel$/);
  await ctx.close();
});

test('token de redefinição inválido mostra mensagem em pt-BR (fix round 1)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.0.4' } });
  const page = await ctx.newPage();
  await page.goto('/definir-senha?token=token-invalido');
  await page.getByLabel('Nova senha').fill('SenhaValida123');
  await page.getByLabel('Repita a senha').fill('SenhaValida123');
  await page.getByRole('button', { name: 'Definir senha' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Link inválido ou expirado. Peça um novo.');
  await ctx.close();
});
