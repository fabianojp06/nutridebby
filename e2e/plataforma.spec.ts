import { expect, test, type Page } from '@playwright/test';
import { entrarComoAdmin } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';

const ADMIN = { email: 'admin-plataforma-e2e@nutridebby.test', password: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

const sufixo = Date.now().toString(36);
const NUTRI = { nome: 'Debby Silva', email: `debby-${sufixo}@nutridebby.test`, slug: `debby-${sufixo}`, senha: `Debby${sufixo}2026` };
let admin: Page;

test.beforeAll(async ({ browser }) => {
  admin = await entrarComoAdmin(browser, ADMIN, '10.9.3.1');
});
test.afterAll(async () => {
  await admin?.context().close();
});

test('admin cria a conta; e-mail com maiúsculas e espaços é aceito; endereço repetido é recusado (US-001)', async () => {
  await admin.goto('/admin/contas/nova');
  await admin.getByLabel('Nome de exibição').fill(NUTRI.nome);
  await admin.getByLabel('E-mail').fill(`  ${NUTRI.email.toUpperCase()} `);
  await admin.getByLabel('CRN').fill('CRN-3 12345');
  await admin.getByLabel('Endereço', { exact: true }).fill(NUTRI.slug);
  await admin.getByRole('button', { name: 'Criar conta' }).click();
  await expect(admin.getByRole('status')).toHaveText('Conta criada. O convite foi enviado para o e-mail da nutricionista.');
  await expect(admin.getByRole('row', { name: new RegExp(NUTRI.slug) })).toContainText('Pendente');

  await admin.goto('/admin/contas/nova');
  await admin.getByLabel('Nome de exibição').fill('Outra Pessoa');
  await admin.getByLabel('E-mail').fill(`outra-${sufixo}@nutridebby.test`);
  await admin.getByLabel('CRN').fill('CRN-3 12345');
  await admin.getByLabel('Endereço', { exact: true }).fill(NUTRI.slug);
  await admin.getByRole('button', { name: 'Criar conta' }).click();
  await expect(admin.getByText('Endereço já em uso')).toBeVisible();
});

test('a nutricionista define a senha, aceita o DPA e chega ao painel; o link não vale de novo (US-002)', async ({ browser }) => {
  const email = await esperarEmail(NUTRI.email, { assunto: 'Seu acesso ao NutriDebby' });
  const link = primeiroLink(email.texto, '/convite/');
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.3.2' } });
  const page = await ctx.newPage();
  await page.goto(link);
  await page.getByLabel('Nova senha').fill(NUTRI.senha);
  await page.getByLabel('Repita a senha').fill(NUTRI.senha);
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Para continuar, aceite o contrato de tratamento de dados (DPA).');

  await page.getByLabel('Nova senha').fill(NUTRI.senha);
  await page.getByLabel('Repita a senha').fill(NUTRI.senha);
  await page.getByLabel('Li e aceito o contrato de tratamento de dados (DPA)').check();
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('heading', { name: 'Painel da nutricionista' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText(NUTRI.nome);

  await page.goto(link);
  await expect(page.locator('p[role="alert"]')).toContainText('Convite inválido ou já usado.');
  await ctx.close();
});
