import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { codigoDoAdmin, entrarComoAdmin, fecharTourDeBoasVindas } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';

const ADMIN = { email: 'admin-plataforma-e2e@nutridebby.test', password: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

const sufixo = Date.now().toString(36);
const NUTRI = { nome: 'Debby Silva', email: `debby-${sufixo}@nutridebby.test`, slug: `debby-${sufixo}`, senha: `Debby${sufixo}2026` };
let admin: Page;

const EIXOS_AXE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
async function semViolacoes(rotulo: string) {
  const r = await new AxeBuilder({ page: admin }).withTags(EIXOS_AXE).analyze();
  expect(r.violations.map((v) => v.id), rotulo).toEqual([]);
}

/** P16-17: as ações de uma conta ficam na página dela — a lista acha pelo endereço e o "Abrir" leva até lá. */
async function abrirConta(slug: string, nome: string) {
  await admin.goto(`/admin?busca=${slug}`);
  await admin.getByRole('link', { name: `Abrir a conta ${nome}`, exact: true }).click();
  await expect(admin).toHaveURL(/\/admin\/contas\/[0-9a-f-]{36}$/);
  await expect(admin.getByRole('heading', { level: 1, name: nome })).toBeVisible();
}

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
  await expect(linha).toContainText('Ativa');
  // P16-17: a lista só tem o "Abrir" (nome acessível com o nome da conta); os botões e o campo de cota estão na página da conta
  await linha.getByRole('link', { name: `Abrir a conta ${NUTRI.nome}`, exact: true }).click();
  await expect(admin.getByRole('heading', { level: 1, name: NUTRI.nome })).toBeVisible();
  await expect(admin.getByText('Convite: Pendente')).toBeVisible();
  // M22: botões e campo de cota com nome acessível próprio (texto visível igual)
  await expect(admin.getByRole('button', { name: `Reenviar convite para ${NUTRI.nome}`, exact: true })).toBeVisible();
  await expect(admin.getByRole('button', { name: `Suspender a conta ${NUTRI.nome}`, exact: true })).toBeVisible();
  await expect(admin.getByLabel(`Cota mensal de WhatsApp de ${NUTRI.nome}`, { exact: true })).toBeVisible();
  await expect(admin.getByRole('button', { name: `Salvar a cota de ${NUTRI.nome}`, exact: true })).toBeVisible();

  await admin.goto('/admin/contas/nova');
  await admin.getByLabel('Nome de exibição').fill('Outra Pessoa');
  await admin.getByLabel('E-mail').fill(`outra-${sufixo}@nutridebby.test`);
  await admin.getByLabel('CRN').fill('CRN-3 12345');
  await admin.getByLabel('Endereço da página', { exact: true }).fill(NUTRI.slug);
  await admin.getByRole('button', { name: 'Criar conta' }).click();
  await expect(admin.getByText('Endereço já em uso')).toBeVisible();
});

test('P09-07: a busca acha o consultório pelo endereço e pelo e-mail; sem resultado, "Nenhuma conta encontrada."; axe da página', async () => {
  await admin.goto('/admin');
  await admin.getByLabel('Buscar por nome, endereço ou e-mail').fill(NUTRI.slug);
  await admin.getByRole('button', { name: 'Buscar' }).click();
  await expect(admin).toHaveURL(new RegExp(`/admin\\?busca=${NUTRI.slug}`));
  await expect(admin.getByRole('row', { name: new RegExp(NUTRI.slug) })).toBeVisible();
  await expect(admin.getByRole('row')).toHaveCount(2); // o cabeçalho e o consultório
  await admin.goto(`/admin?busca=${encodeURIComponent(NUTRI.email)}`);
  await expect(admin.getByRole('row', { name: new RegExp(NUTRI.slug) })).toBeVisible();
  await admin.goto('/admin?busca=%25%25nada-assim%25%25');
  await expect(admin.getByText('Nenhuma conta encontrada.')).toBeVisible();
  await semViolacoes('/admin (busca sem resultado)');
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
  await fecharTourDeBoasVindas(page);
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

  await abrirConta(NUTRI.slug, NUTRI.nome);
  const pagina = admin.url();
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('button', { name: `Suspender a conta ${NUTRI.nome}`, exact: true }).click();
  // P16-17: a ação volta para a página da conta, com o aviso
  await expect(admin.getByRole('status')).toContainText('Conta suspensa.');
  expect(admin.url()).toBe(`${pagina}?aviso=suspensa`);
  await expect(admin.getByText('Suspensa', { exact: true })).toBeVisible();

  await nutri.reload(); // a sessão foi revogada
  await expect(nutri).toHaveURL(/\/entrar\?expirada=1/);
  await login();
  await expect(nutri).toHaveURL(/\/indisponivel$/);
  await expect(nutri.getByRole('heading', { name: 'Conta temporariamente indisponível' })).toBeVisible();

  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('button', { name: `Reativar a conta ${NUTRI.nome}`, exact: true }).click();
  await expect(admin.getByRole('status')).toHaveText('Conta reativada.');
  expect(admin.url()).toBe(`${pagina}?aviso=reativada`);
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
  await abrirConta(slug, nome);
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('button', { name: `Suspender a conta ${nome}`, exact: true }).click();
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
  // D20: "Perfil e marca" é um cartão do hub "Configurações"
  await page.getByRole('navigation', { name: 'Menu do painel' }).getByRole('link', { name: 'Configurações', exact: true }).click();
  await page.getByRole('link', { name: /^Perfil e marca/ }).click();

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
  // D19/D20: o cabeçalho é neutro; a cor do consultório aparece no item ativo do menu (bg-destaque)
  await expect(banner.getByRole('link', { name: 'Configurações', exact: true })).toHaveCSS('background-color', 'rgb(46, 125, 50)');
  // o logo é decorativo (alt=""): o nome do consultório já é o nome do link da marca
  const marcaNoTopo = banner.getByRole('link', { name: NUTRI.nome, exact: true });
  await expect(marcaNoTopo.locator('img')).toHaveAttribute('src', /^\/api\/arquivos\?c=/);
  await expect(marcaNoTopo.locator('img')).toHaveAttribute('alt', '');
  await ctx.close();
});

test('métricas de sucesso: o admin grava a base do CS-03 e o início do uso; valor fora da faixa é recusado (P08-07, D15)', async () => {
  await abrirConta(NUTRI.slug, NUTRI.nome);
  const linha = admin.getByRole('region', { name: 'Métricas de sucesso', exact: true });
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
  // sem paciente com conta nem consulta iniciada no mês: as contagens ficam em "—" (bloco "Uso no mês" da página da conta, P16-17)
  const uso = admin.getByRole('region', { name: 'Uso no mês', exact: true });
  await expect(uso.getByText('App na semana')).toBeVisible();
  await expect(uso.getByText('Faltas no mês')).toBeVisible();
});

test('reiniciar o 2FA de outra conta pede o código da própria admin: errado é recusado; certo segue (code review do PR #22, item 1)', async () => {
  await admin.goto('/admin/seguranca'); // P16-17: a aba "Segurança"
  admin.on('dialog', (d) => void d.accept());
  const email = admin.getByLabel('E-mail da conta');
  const codigo = admin.getByLabel('Seu código da verificação em duas etapas');
  const botao = admin.getByRole('button', { name: 'Reiniciar verificação em duas etapas' });
  await email.fill(NUTRI.email);
  await codigo.fill(codigoDoAdmin(ADMIN.email) === '000000' ? '111111' : '000000');
  await botao.click();
  await expect(admin.getByRole('alert').filter({ hasText: 'Código inválido' })).toHaveText('Código inválido. Confira o horário do celular e tente de novo.');
  await expect(codigo).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveValue(NUTRI.email); // a recusa devolve o e-mail; o código nunca volta
  await expect(codigo).toHaveValue('');
  // o código certo passa; a conta da nutricionista não tem 2FA ativo → a recusa seguinte é a da conta, não a do código
  await codigo.fill(codigoDoAdmin(ADMIN.email));
  await botao.click();
  await expect(admin.getByRole('alert').filter({ hasText: 'duas etapas' })).toHaveText('Esta conta não tem a verificação em duas etapas ativa.');
  await expect(email).toHaveAttribute('aria-invalid', 'true');
});

test('P16-17: abas Contas, Servidor e Segurança; resumo na lista; a página da conta em blocos; axe nas quatro telas (a lista também no celular)', async () => {
  const abas = admin.getByRole('navigation', { name: 'Administração' });
  const aba = (nome: string) => abas.getByRole('link', { name: nome, exact: true });
  await admin.goto('/admin');
  await expect(aba('Contas')).toHaveAttribute('aria-current', 'page');
  // o resumo conta todas as contas e traz o servidor numa linha
  await expect(admin.getByText(/^\d+ ativas? · \d+ suspensas? · \d+ convites? pendentes?$/)).toBeVisible();
  await expect(admin.getByText(/^Backup do banco: /)).toBeVisible();
  await expect(admin.getByRole('link', { name: 'Ver servidor', exact: true })).toBeVisible();
  await semViolacoes('/admin');

  await aba('Servidor').click();
  await expect(admin).toHaveURL(/\/admin\/servidor$/);
  await expect(admin.getByRole('heading', { level: 1, name: 'Servidor' })).toBeVisible();
  await expect(aba('Servidor')).toHaveAttribute('aria-current', 'page');
  await expect(aba('Contas')).not.toHaveAttribute('aria-current', 'page');
  const infra = admin.getByRole('region', { name: 'Backup e disco', exact: true });
  await expect(infra.getByText(/^Backup do banco: /)).toBeVisible();
  await expect(infra.getByText(/^Backup dos arquivos: /)).toBeVisible();
  await expect(infra.getByText(/^Disco/)).toBeVisible();
  await semViolacoes('/admin/servidor');

  await aba('Segurança').click();
  await expect(admin).toHaveURL(/\/admin\/seguranca$/);
  await expect(admin.getByRole('heading', { level: 1, name: 'Segurança' })).toBeVisible();
  await expect(aba('Segurança')).toHaveAttribute('aria-current', 'page');
  await expect(admin.getByRole('region', { name: 'Verificação em duas etapas', exact: true }).getByLabel('E-mail da conta')).toBeVisible();
  await semViolacoes('/admin/seguranca');

  await abrirConta(NUTRI.slug, NUTRI.nome);
  await expect(aba('Contas')).toHaveAttribute('aria-current', 'page'); // a página da conta é da aba "Contas"
  for (const bloco of ['Uso no mês', 'Liberações', 'Limites', 'Métricas de sucesso', 'Conta']) {
    await expect(admin.getByRole('region', { name: bloco, exact: true }), bloco).toBeVisible();
  }
  await expect(admin.getByRole('region', { name: 'Liberações', exact: true })).toContainText('Documentos assinados: Bloqueados');
  await expect(admin.getByRole('region', { name: 'Liberações', exact: true })).toContainText('IA: bloqueada');
  await expect(admin.getByLabel(`Limite de IA (US$/mês) de ${NUTRI.nome}`, { exact: true })).toBeVisible();
  await semViolacoes('/admin/contas/[id]');
  await admin.getByRole('link', { name: 'Voltar para Contas', exact: true }).click();
  await expect(admin).toHaveURL(/\/admin$/);

  // conta que não existe: volta para a lista com o aviso
  await admin.goto('/admin/contas/00000000-0000-4000-8000-000000000000');
  await expect(admin).toHaveURL(/\/admin\?aviso=nao_encontrada$/);
  await expect(admin.locator('main').getByRole('alert')).toHaveText('Conta não encontrada.');

  // celular: a lista vira cartões, sem rolagem horizontal da página
  await admin.setViewportSize({ width: 360, height: 780 });
  try {
    await admin.goto(`/admin?busca=${NUTRI.slug}`);
    await expect(admin.getByRole('table')).toBeHidden();
    const cartoes = admin.getByRole('list', { name: 'Contas de nutricionista' });
    await expect(cartoes.getByRole('listitem')).toHaveCount(1);
    await expect(cartoes).toContainText('Pacientes ativos');
    await expect(cartoes.getByRole('link', { name: `Abrir a conta ${NUTRI.nome}`, exact: true })).toBeVisible();
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await semViolacoes('/admin (360 px)');
    await cartoes.getByRole('link', { name: `Abrir a conta ${NUTRI.nome}`, exact: true }).click();
    await expect(admin.getByRole('heading', { level: 1, name: NUTRI.nome })).toBeVisible();
    expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await admin.setViewportSize({ width: 1280, height: 720 });
  }
});
