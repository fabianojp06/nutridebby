import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';
import { avaliar, entradasDoPlano, marcarParaPaciente, pacienteNoPortal, publicarPlanoSimples } from './portal';

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
  // duas avaliações: o axe de /p/evolucao audita também o gráfico (GraficoLinha) e a lista de diferenças
  await avaliar(nutri, paciente.prontuario, '2026-08-01', '80');
  await avaliar(nutri, paciente.prontuario, '2026-09-01', '78');
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

const ROTAS = ['/p/inicio', '/p/plano', '/p/diario', '/p/evolucao', '/p/compras?dias=7', '/p/agenda', '/p/agenda/nova', '/p/perfil'];
for (const url of ROTAS) {
  test(`axe sem violações (WCAG 2.1 AA) em ${url}`, async () => {
    await semViolacoes(paciente.page, url);
  });
}

// Modo escuro do aparelho (prefers-color-scheme: dark): enquanto o tema escuro não chega (Plano 08), o sistema fica
// sempre claro — nada pode escurecer só o fundo ou o texto base e deixar as cores fixas do modo claro ilegíveis.
const PAINEL = ['/painel', '/painel/pacientes', '/painel/agenda', '/painel/alimentos', '/painel/diarios', '/painel/configuracoes'];
test('modo escuro do aparelho: axe sem violações (WCAG 2.1 AA) nas telas do portal e do painel', async () => {
  await paciente.page.emulateMedia({ colorScheme: 'dark' });
  await nutri.emulateMedia({ colorScheme: 'dark' });
  try {
    expect(await paciente.page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    for (const url of ROTAS) await semViolacoes(paciente.page, url);
    for (const url of [...PAINEL, paciente.prontuario]) await semViolacoes(nutri, url);
  } finally {
    await paciente.page.emulateMedia({ colorScheme: 'light' });
    await nutri.emulateMedia({ colorScheme: 'light' });
  }
});

test('celular (RNF-09): a 360 px (o menor Android da R16), nenhuma tela do PWA rola na horizontal e a barra de abas cabe', async () => {
  await paciente.page.setViewportSize({ width: 360, height: 780 });
  try {
    for (const url of ROTAS) {
      await paciente.page.goto(url);
      await paciente.page.waitForLoadState('networkidle');
      expect(await paciente.page.evaluate(() => window.innerWidth), url).toBe(360);
      expect(await paciente.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
    }
    await paciente.page.goto('/p/inicio');
    for (const aba of ['Início', 'Plano', 'Diário', 'Evolução', 'Compras', 'Agenda', 'Perfil']) {
      await expect(paciente.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: aba })).toBeVisible();
    }
  } finally {
    await paciente.page.setViewportSize(devices['Pixel 7'].viewport);
  }
});

test('alvo de toque ≥ 44 px (RNF-10): "Próxima consulta" no Início e as semanas do agendamento', async () => {
  const altura = async (l: ReturnType<Page['getByRole']>) => (await l.boundingBox())?.height ?? 0;
  await paciente.page.goto('/p/inicio');
  expect(await altura(paciente.page.locator('p', { hasText: 'Próxima consulta:' }).getByRole('link'))).toBeGreaterThanOrEqual(44);
  await paciente.page.goto('/p/agenda/nova');
  expect(await altura(paciente.page.getByRole('navigation', { name: 'Semana' }).getByRole('link', { name: 'Próxima semana' }))).toBeGreaterThanOrEqual(44);
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
  expect((await page.getByRole('link', { name: 'Trocar de nutricionista' }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44); // RNF-10
  await page.getByRole('link', { name: 'Trocar de nutricionista' }).click();
  // achado 4 do /code-review: na escolha, a cópia do consultório 1 (ativo, escolhível) fica no aparelho
  await expect(page.getByRole('button', { name: 'Consultório E2E 3', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await entradasDoPlano(page)).toBe(1);
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
  // Pelo proxy, rota a rota (X-3: toda rota nova de /api/painel já é conferida, sem lista, em
  // src/app/api/painel/acesso-negado.test.ts)
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
