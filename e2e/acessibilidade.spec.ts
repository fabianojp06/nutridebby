import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';
import { entradasDoPlano, marcarParaPaciente, pacienteNoPortal, publicarPlanoSimples } from './portal';

// RNF-10 / RNF-09 (P06-10): WCAG 2.1 AA em todas as telas do PWA, no tamanho de um Android (projeto "celular").
// Bloco de IP deste spec (o limite de login é por IP): 10.9.10.21 a 10.9.10.30.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const MULTI = { email: 'multi-e2e@nutridebby.test', senha: 'Multi2026segura' }; // scripts/e2e-seed.ts: 3 consultórios, o "3" sem o termo
test.describe.configure({ mode: 'serial' });
let nutri: Page;
let paciente: Awaited<ReturnType<typeof pacienteNoPortal>>;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.10.21', devices['Desktop Chrome']); // o painel, em tela de computador
  await expect(nutri).toHaveURL(/\/painel$/);
  paciente = await pacienteNoPortal(browser, nutri, '10.9.10.22');
  await publicarPlanoSimples(nutri, paciente.prontuario);
  await marcarParaPaciente(nutri, paciente.nome, paciente.email, 1); // R11: semana 1 (o portal.spec usa a 0)
  // um registro no diário, para a lista não sair vazia
  await paciente.page.goto('/p/diario');
  await paciente.page.getByLabel('Refeição', { exact: true }).selectOption('Almoço');
  await paciente.page.getByLabel('O que você comeu?').fill('arroz e feijão');
  await paciente.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Registro salvo.' })).toBeVisible();
});
test.afterAll(async () => {
  await paciente?.page.context().close();
  await nutri?.context().close();
});

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function violacoes(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
async function semViolacoes(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  expect(await violacoes(page), url).toEqual([]);
}

for (const url of ['/p/inicio', '/p/plano', '/p/diario', '/p/evolucao', '/p/compras?dias=7', '/p/agenda', '/p/agenda/nova', '/p/perfil']) {
  test(`axe sem violações (WCAG 2.1 AA) em ${url}`, async () => {
    await semViolacoes(paciente.page, url);
  });
}

test('celular (RNF-09): a barra de abas cabe na tela, sem rolagem horizontal, e o viewport é o de um Android', async () => {
  await paciente.page.goto('/p/inicio');
  expect(await paciente.page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(430);
  expect(await paciente.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const aba of ['Início', 'Plano', 'Diário', 'Evolução', 'Compras', 'Agenda', 'Perfil']) {
    await expect(paciente.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: aba })).toBeVisible();
  }
});

test('axe sem violações na página da consulta', async () => {
  await paciente.page.goto('/p/agenda');
  await paciente.page.getByRole('region', { name: 'Próximas' }).getByRole('link').first().click();
  await expect(paciente.page).toHaveURL(/\/p\/agenda\/[0-9a-f-]{36}$/);
  await paciente.page.waitForLoadState('networkidle');
  expect(await violacoes(paciente.page)).toEqual([]);
});

test('axe sem violações na página do link da exportação (R12a)', async () => {
  await paciente.page.goto('/p/perfil');
  await paciente.page.getByRole('button', { name: 'Baixar meus dados' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Pedimos seus dados.' })).toBeVisible();
  const email = await esperarEmail(paciente.email, { assunto: 'Exportação de dados pronta' });
  await semViolacoes(paciente.page, primeiroLink(email.texto, '/p/meus-dados/exportacoes/'));
  await expect(paciente.page.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
});

test('axe sem violações em "sem acesso" (paciente arquivado)', async ({ browser }) => {
  const outro = await pacienteNoPortal(browser, nutri, '10.9.10.23');
  await nutri.goto(`${outro.prontuario}/privacidade`);
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Arquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Desarquivar paciente' })).toBeVisible();
  await outro.page.goto('/p/inicio');
  await expect(outro.page).toHaveURL(/\/p\/sem-acesso$/);
  await outro.page.waitForLoadState('networkidle');
  expect(await violacoes(outro.page)).toEqual([]);
  await outro.page.context().close();
});

test('conta com três consultórios: axe em /p/escolher e /p/termo; trocar de nutricionista (sem login) apaga o plano guardado do outro vínculo (R12b, conferirDono)', async ({ browser }) => {
  const page = await entrarComo(browser, MULTI.email, MULTI.senha, '10.9.10.24');
  await expect(page).toHaveURL(/\/p\/escolher/);
  await expect(page.getByRole('heading', { name: 'Com qual nutricionista você quer entrar?' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await violacoes(page)).toEqual([]);

  // entra no consultório 1 e guarda o plano no aparelho
  await page.getByRole('button', { name: 'Consultório E2E', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await page.goto('/p/inicio'); // o service worker se registra na carga da página (a navegação do login/escolha é do roteador)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Plano' }).click();
  await expect(page).toHaveURL(/\/p\/plano$/);
  await expect.poll(() => entradasDoPlano(page)).toBe(1);

  // troca pelo Perfil, sem sair: o consultório 3 pede o termo (axe)...
  await page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Perfil' }).click();
  await page.getByRole('link', { name: 'Trocar de nutricionista' }).click();
  await page.getByRole('button', { name: 'Consultório E2E 3', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/termo$/);
  await page.waitForLoadState('networkidle');
  expect(await violacoes(page)).toEqual([]);

  // ...e o 2 (termo aceito) abre o portal: a cópia do plano do consultório 1 sai do aparelho
  await page.goto('/p/escolher');
  await page.getByRole('button', { name: 'Consultório E2E 2', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await expect(page.getByText('Acompanhamento com Consultório E2E 2')).toBeVisible();
  await expect.poll(() => entradasDoPlano(page)).toBe(0);
  await page.context().close();
});

test('paciente não alcança o painel nem a API da nutricionista (403 ou volta ao portal, nunca 500 nem dado)', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  for (const rota of ['/painel', '/painel/pacientes', '/painel/agenda', '/painel/alimentos', '/painel/configuracoes', '/painel/diarios', `/painel/pacientes/${id}`, '/admin']) {
    await paciente.page.goto(rota);
    await expect(paciente.page, rota).toHaveURL(/\/p\/inicio$/);
  }
  const chamadas: [string, string][] = [
    ['GET', '/api/painel/alimentos?q=arroz'],
    ['POST', '/api/painel/marca/logo'],
    ['POST', `/api/painel/pacientes/${id}/exames`],
    ['GET', `/api/painel/pacientes/${id}`],
    ['GET', `/api/painel/planos/${id}`],
    ['PUT', `/api/painel/planos/${id}`],
    ['GET', `/api/painel/planos/${id}/pdf`],
    ['GET', `/api/painel/planos/${id}/revisao`],
    ['GET', '/api/painel/whatsapp/estado'],
  ];
  for (const [metodo, url] of chamadas) {
    const r = await paciente.page.request.fetch(url, { method: metodo, maxRedirects: 0, data: metodo === 'GET' ? undefined : {} });
    expect(r.status(), `${metodo} ${url}`).toBe(403);
    expect(await r.json(), `${metodo} ${url}`).toEqual({ erro: 'Acesso negado' });
  }
});
