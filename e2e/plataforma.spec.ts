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
  // O campo é o link da página pública, não o endereço da rua: o rótulo e a dica deixam isso claro
  const endereco = admin.getByLabel('Endereço da página', { exact: true });
  // a dica vem do APP_URL do servidor, que pode diferir do endereço do navegador (localhost × 127.0.0.1)
  await expect(endereco).toHaveAccessibleDescription(/quando ela estiver disponível: https?:\/\/\S+\/n\/seu-endereco\. Não é o endereço do consultório\./);
  await endereco.fill(NUTRI.slug);
  await admin.getByRole('button', { name: 'Criar conta' }).click();
  await expect(admin.getByRole('status')).toHaveText('Conta criada. O convite foi enviado para o e-mail da nutricionista.');
  const linha = admin.getByRole('row', { name: new RegExp(NUTRI.slug) });
  await expect(linha).toContainText('Pendente');
  // M22: botões e campo de cota de cada linha com nome acessível próprio (texto visível igual)
  await expect(linha.getByRole('button', { name: `Reenviar convite para ${NUTRI.nome}`, exact: true })).toBeVisible();
  await expect(linha.getByRole('button', { name: `Suspender a conta ${NUTRI.nome}`, exact: true })).toBeVisible();
  await expect(linha.getByLabel(`Cota mensal de WhatsApp de ${NUTRI.nome}`, { exact: true })).toBeVisible();
  await expect(linha.getByRole('button', { name: `Salvar a cota de ${NUTRI.nome}`, exact: true })).toBeVisible();

  await admin.goto('/admin/contas/nova');
  await admin.getByLabel('Nome de exibição').fill('Outra Pessoa');
  await admin.getByLabel('E-mail').fill(`outra-${sufixo}@nutridebby.test`);
  await admin.getByLabel('CRN').fill('CRN-3 12345');
  await admin.getByLabel('Endereço da página', { exact: true }).fill(NUTRI.slug);
  await admin.getByRole('button', { name: 'Criar conta' }).click();
  await expect(admin.getByText('Endereço já em uso')).toBeVisible();
});

test('a nutricionista define a senha, aceita o DPA e chega ao painel; o link não vale de novo (US-002)', async ({ browser }) => {
  const email = await esperarEmail(NUTRI.email, { assunto: 'Seu acesso ao NutriDebby' });
  const link = primeiroLink(email.texto, '/convite/');
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.3.2' } });
  const page = await ctx.newPage();
  const resposta = await page.goto(link);
  // M7: o token do convite está na URL — Referrer-Policy também por cabeçalho, além da <meta>
  expect(resposta?.headers()['referrer-policy']).toBe('no-referrer');
  await page.getByLabel('Nova senha').fill(NUTRI.senha);
  await page.getByLabel('Repita a senha').fill(NUTRI.senha);
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Para continuar, aceite o contrato de tratamento de dados (DPA).');

  await page.getByLabel('Nova senha').fill(NUTRI.senha);
  await page.getByLabel('Repita a senha').fill(NUTRI.senha);
  await page.getByLabel('Li e aceito o contrato de tratamento de dados (DPA)').check();
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('heading', { name: /^Seu dia, / })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText(NUTRI.nome);

  await page.goto(link);
  await expect(page.locator('p[role="alert"]')).toContainText('Convite inválido ou já usado.');
  await ctx.close();
});

test('suspender derruba a sessão aberta e bloqueia o login; reativar devolve o acesso (US-004)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.3.4' } });
  const nutri = await ctx.newPage();
  const login = async () => {
    await nutri.goto('/entrar');
    await nutri.getByLabel('E-mail').fill(NUTRI.email);
    await nutri.getByLabel('Senha').fill(NUTRI.senha);
    await nutri.getByRole('button', { name: 'Entrar' }).click();
  };
  await login();
  await expect(nutri).toHaveURL(/\/painel$/);

  await admin.goto('/admin');
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('row', { name: new RegExp(NUTRI.slug) }).getByRole('button', { name: 'Suspender' }).click();
  await expect(admin.getByRole('status')).toContainText('Conta suspensa.');

  await nutri.reload(); // a sessão foi revogada
  await expect(nutri).toHaveURL(/\/entrar\?expirada=1/);
  await login();
  await expect(nutri).toHaveURL(/\/indisponivel$/);
  await expect(nutri.getByRole('heading', { name: 'Conta temporariamente indisponível' })).toBeVisible();

  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('row', { name: new RegExp(NUTRI.slug) }).getByRole('button', { name: 'Reativar' }).click();
  await expect(admin.getByRole('status')).toHaveText('Conta reativada.');
  await login();
  await expect(nutri).toHaveURL(/\/painel$/);
  await ctx.close();
});

test('conta suspensa entre o aceite do convite e o login automático leva a /indisponivel, não a /entrar (T7-R2a)', async ({ browser }) => {
  const nome = 'Debby Corrida';
  const email = `debby-corrida-${sufixo}@nutridebby.test`;
  const slug = `debby-corrida-${sufixo}`;
  const senha = `Debby${sufixo}Corrida2026`;

  await admin.goto('/admin/contas/nova');
  await admin.getByLabel('Nome de exibição').fill(nome);
  await admin.getByLabel('E-mail').fill(email);
  await admin.getByLabel('CRN').fill('CRN-3 12345');
  await admin.getByLabel('Endereço da página', { exact: true }).fill(slug);
  await admin.getByRole('button', { name: 'Criar conta' }).click();
  await expect(admin.getByRole('status')).toHaveText('Conta criada. O convite foi enviado para o e-mail da nutricionista.');

  const msg = await esperarEmail(email, { assunto: 'Seu acesso ao NutriDebby' });
  const link = primeiroLink(msg.texto, '/convite/');

  // Corrida: o admin suspende a conta depois do convite enviado, mas antes do primeiro acesso.
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('row', { name: new RegExp(slug) }).getByRole('button', { name: 'Suspender' }).click();
  await expect(admin.getByRole('status')).toContainText('Conta suspensa.');

  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.3.5' } });
  const page = await ctx.newPage();
  await page.goto(link);
  await page.getByLabel('Nova senha').fill(senha);
  await page.getByLabel('Repita a senha').fill(senha);
  await page.getByLabel('Li e aceito o contrato de tratamento de dados (DPA)').check();
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  // aceitarConvite grava a senha (o convite já foi consumido); o login automático seguinte
  // é recusado pelo tenant suspenso — a nutricionista cai em /indisponivel, não em /entrar.
  await expect(page).toHaveURL(/\/indisponivel$/);
  await expect(page.getByRole('heading', { name: 'Conta temporariamente indisponível' })).toBeVisible();
  await ctx.close();
});

// PNG 1×1 válido

test('perfil e marca: contraste recusado, cor e logo aplicados ao painel (US-005)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.3.5' } });
  const page = await ctx.newPage();
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(NUTRI.email);
  await page.getByLabel('Senha').fill(NUTRI.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await page.getByRole('link', { name: 'Perfil e marca' }).click();

  await page.getByLabel('Cor principal').fill('#FFEB3B');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText('Cor muito clara para texto branco')).toBeVisible();
  await page.getByLabel('Cor principal').fill('#2E7D32');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByRole('status')).toHaveText('Perfil salvo.');

  await page.getByLabel('Logo').setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    // SVG: exercita o processo filho de rasterização (scripts/svg-raster.mjs) sob `next start` (T10-R4)
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#2E7D32"/></svg>'),
  });
  await page.getByRole('button', { name: 'Enviar logo' }).click();
  await expect(page.getByText('Logo atualizado.')).toBeVisible();
  const banner = page.getByRole('banner');
  await expect(banner).toHaveCSS('background-color', 'rgb(46, 125, 50)');
  await expect(banner.getByRole('img', { name: `Logo de ${NUTRI.nome}` })).toHaveAttribute('src', /^\/api\/arquivos\?c=/);
  await ctx.close();
});

test('métricas de sucesso: o admin grava a base do CS-03 e o início do uso; valor fora da faixa é recusado (P08-07, D15)', async () => {
  await admin.goto('/admin');
  const linha = admin.getByRole('row', { name: new RegExp(NUTRI.slug) });
  const taxa = linha.getByLabel('Taxa de faltas antes do sistema (%)');
  await taxa.fill('120');
  await linha.getByRole('button', { name: `Salvar as métricas de ${NUTRI.nome}` }).click();
  await expect(linha.getByRole('alert')).toHaveText('Informe um percentual de 0 a 100');
  await expect(taxa).toHaveAttribute('aria-invalid', 'true');
  await taxa.fill('18,5');
  await linha.getByLabel('Início do uso').fill('2026-10-01');
  await linha.getByRole('button', { name: `Salvar as métricas de ${NUTRI.nome}` }).click();
  await expect(linha.getByRole('status')).toHaveText('Métricas salvas.');
  await admin.reload();
  await expect(taxa).toHaveValue('18,5');
  await expect(linha.getByLabel('Início do uso')).toHaveValue('2026-10-01');
  // sem paciente com conta nem consulta iniciada no mês: as contagens ficam em "—"
  await expect(admin.getByRole('columnheader', { name: 'App na semana' })).toBeVisible();
  await expect(admin.getByRole('columnheader', { name: 'Faltas no mês' })).toBeVisible();
});
