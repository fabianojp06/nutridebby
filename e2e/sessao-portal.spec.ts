import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';

// Débitos pré-go-live, grupo "Sessão e Sair" (S-1, S-2, S-4). Bloco de IP deste spec (o limite de login é por IP):
// 10.9.12.x. A conta MULTI (scripts/e2e-seed.ts) tem 3 consultórios; o "3" fica sem o aceite do termo (o E2E nunca o
// aceita: `consents` é append-only e o acessibilidade.spec depende dele pendente).
const MULTI = { email: 'multi-e2e@nutridebby.test', senha: 'Multi2026segura' };

test('termo pendente: /p/termo guarda o destino (?volta=) e o "Sair" de lá cancela o push do aparelho (S-1, S-2)', async ({ browser }) => {
  const page = await entrarComo(browser, MULTI.email, MULTI.senha, '10.9.12.1');
  await expect(page).toHaveURL(/\/p\/escolher/);
  // um link para o Perfil, com o consultório 3 escolhido: o termo leva o destino adiante
  await page.goto(`/p/escolher?volta=${encodeURIComponent('/p/perfil')}`);
  await page.getByRole('button', { name: 'Consultório E2E 3', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/termo\?volta=%2Fp%2Fperfil$/);
  await expect(page.locator('input[type="hidden"][name="volta"]')).toHaveValue('/p/perfil');
  // o DELETE do "Sair" basta com a sessão de paciente (antes: 403 pelo termo pendente, e o endpoint ficava no servidor)
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/p/push', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-sair-no-termo' }),
    });
    return r.status;
  });
  expect(status).toBe(204);
  await page.context().close();
});

test('diário com o vínculo a escolher (cookie apagado em outra aba): "Acesso negado" com o link "Escolher nutricionista", que volta ao diário (S-4)', async ({ browser }) => {
  const page = await entrarComo(browser, MULTI.email, MULTI.senha, '10.9.12.2');
  await expect(page).toHaveURL(/\/p\/escolher/);
  await page.getByRole('button', { name: 'Consultório E2E', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await page.goto('/p/diario');
  await page.waitForLoadState('networkidle'); // o POST /api/p/acesso da abertura regrava o nd_vinculo: esperar por ele
  await page.context().clearCookies({ name: 'nd_vinculo' });
  expect((await page.context().cookies()).some((c) => c.name === 'nd_vinculo')).toBe(false);
  await page.getByLabel('Refeição', { exact: true }).selectOption('Almoço');
  await page.getByLabel('O que você comeu?').fill('arroz, feijão e salada');
  await page.getByRole('button', { name: 'Registrar' }).click();
  const alerta = page.getByRole('alert').filter({ hasText: 'Acesso negado' });
  await expect(alerta).toBeVisible();
  await expect(page.getByLabel('O que você comeu?')).toHaveValue('arroz, feijão e salada'); // o texto não se perde
  const link = alerta.getByRole('link', { name: 'Escolher nutricionista' });
  await expect(link).toHaveAttribute('href', '/p/escolher?volta=%2Fp%2Fdiario');
  expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44); // RNF-10
  await link.click();
  await page.getByRole('button', { name: 'Consultório E2E', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/diario$/);
  await page.context().close();
});
