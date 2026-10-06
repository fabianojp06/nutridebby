import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';

// P09-05. IP 10.9.17.10 (bloco do Plano 09).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };

test('painel instalável: manifest próprio no <head>, nenhum service worker e HTML sem cache (P09-05)', async ({ browser }) => {
  const page = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.17.10');
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/painel.webmanifest');
  const m = await (await page.request.get('/painel.webmanifest')).json();
  expect(m).toMatchObject({ id: '/painel', start_url: '/painel', scope: '/', display: 'standalone' });
  expect((await page.request.get('/painel')).headers()['cache-control']).toContain('no-store');
  await page.goto('/painel/pacientes');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  // o login continua com o manifest do portal (o do painel só vale nas telas do painel)
  await page.goto('/entrar');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await page.context().close();
});
