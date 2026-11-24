import { expect, test, type Page } from '@playwright/test';
import { MARCA_DA_COPIA } from '@/app/sw-regras';
import { entrarComo, painelNoComputador } from './helpers';
import { entradasDoPlano, pacienteNoPortal, publicarPlanoSimples } from './portal';

/**
 * SUS-112: o `reloadOnOnline` padrão do Serwist recarregava qualquer página do portal quando a rede voltava, e o que o
 * paciente digitava se perdia. Agora só a cópia offline de "Meu plano" recarrega (lista de permissão, pela marca
 * `data-nd-copia-offline` que só o HTML guardado leva). Bloco de IPs do SUS-112: 10.9.112.x (nutri em 10.9.112.1).
 */
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.112.1', painelNoComputador(browser));
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

/** Carga completa da página com o service worker já controlando (o SerwistProvider registra na carga do portal). */
async function abrirControlada(page: Page, url: string) {
  await page.goto(url);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

/** A rede cai e volta, com os eventos `offline` e `online` chegando à página. */
async function quedaDeRede(page: Page) {
  await page.context().setOffline(true);
  await page.waitForFunction(() => !navigator.onLine);
  await page.context().setOffline(false);
  await page.waitForFunction(() => navigator.onLine);
}

test('diário: o paciente digita, a rede cai e volta, e o texto continua no campo — a página não recarrega', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.112.2');
  await abrirControlada(p.page, '/p/diario');
  const campo = p.page.getByLabel('O que você comeu?', { exact: true });
  await campo.fill('Arroz, feijão e salada');
  await expect(p.page.locator(`[${MARCA_DA_COPIA}]`)).toHaveCount(0); // página viva, não a cópia
  let navegacoes = 0;
  p.page.on('framenavigated', (f) => {
    if (f === p.page.mainFrame()) navegacoes++;
  });
  await p.page.evaluate(() => {
    (window as unknown as { sus112?: string }).sus112 = 'mesmo-documento';
  });
  await quedaDeRede(p.page);
  await p.page.waitForTimeout(3_000); // o reload antigo vinha logo depois do `online`
  expect(navegacoes).toBe(0);
  expect(await p.page.evaluate(() => (window as unknown as { sus112?: string }).sus112)).toBe('mesmo-documento');
  await expect(campo).toHaveValue('Arroz, feijão e salada');
  await p.page.context().close();
});

test('cópia do plano: servida sem rede em /p/inicio (com a marca e o selo) e recarregada quando a rede volta', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.112.3');
  await publicarPlanoSimples(nutri, p.prontuario);
  await abrirControlada(p.page, '/p/inicio');
  // o menu é next/link (RSC): a página pede ao service worker que guarde a cópia, buscada com o cabeçalho x-nd-copia
  await p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Plano' }).click();
  await expect(p.page).toHaveURL(/\/p\/plano$/);
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect(p.page.locator(`[${MARCA_DA_COPIA}]`)).toHaveCount(0); // "Meu plano" aberto da rede não é a cópia
  await expect.poll(() => entradasDoPlano(p.page)).toBe(1);

  await p.page.context().setOffline(true);
  await p.page.goto('/p/inicio');
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect(p.page.getByRole('status').filter({ hasText: 'Offline — exibindo última versão' })).toBeVisible();
  await expect(p.page.locator(`[${MARCA_DA_COPIA}]`)).toHaveCount(1);
  await p.page.evaluate(() => {
    (window as unknown as { sus112?: string }).sus112 = 'copia';
  });

  // o reload destrói o contexto da página: espera o `load` do documento novo (armado antes de religar a rede)
  const recarregou = p.page.waitForEvent('load', { timeout: 15_000 });
  await p.page.context().setOffline(false);
  await recarregou;
  expect(await p.page.evaluate(() => (window as unknown as { sus112?: string }).sus112)).toBeUndefined();
  await expect(p.page.locator(`[${MARCA_DA_COPIA}]`)).toHaveCount(0); // a página de verdade no lugar da cópia
  await expect(p.page.getByRole('heading', { level: 1, name: /^Olá, / })).toBeVisible();
  await p.page.context().close();
});
