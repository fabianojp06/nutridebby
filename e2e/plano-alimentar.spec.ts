import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

const sufixo = Date.now().toString(36);
let nutri: Page;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.6.1');
  await expect(nutri).toHaveURL(/\/painel$/); // sem esperar o login, o goto seguinte interrompe a navegação
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('busca tolerante a acento com selo de origem e fonte citada (US-020)', async () => {
  await nutri.goto('/painel/alimentos');
  await expect(nutri.getByText('Fonte: TACO 4ª ed. — NEPA/UNICAMP. Valores por 100 g.')).toBeVisible();
  await nutri.getByLabel('Buscar alimento').fill('feijao carioca');
  const opcao = nutri.getByRole('option', { name: /Feijão, carioca, cozido/ });
  await expect(opcao).toBeVisible();
  await expect(opcao).toContainText('76 kcal/100 g');
  await expect(opcao).toContainText('TACO');
  const posicao = await nutri.getByRole('option').evaluateAll((os) => os.findIndex((o) => o.textContent?.includes('Feijão, carioca, cozido')));
  expect(posicao).toBeLessThan(5);
});
