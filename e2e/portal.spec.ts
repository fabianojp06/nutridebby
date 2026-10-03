import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { pacienteNoPortal, publicarPlanoSimples } from './portal';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;

test.beforeAll(async ({ browser }) => {
  // O limite de login é por IP: cada spec usa o seu bloco (R6: portal.spec = 10.9.10.x — nutri em 10.9.10.1 e cada
  // pacienteNoPortal com um IP só seu, de 10.9.10.2 a 10.9.10.20)
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.10.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('portal: o paciente entra no consultório, vê a navegação; arquivado perde o acesso e desarquivado volta (RN-08)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.2');
  await expect(p.page.getByText('Acompanhamento com Consultório E2E')).toBeVisible();
  await expect(p.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');
  await nutri.goto(`${p.prontuario}/privacidade`);
  nutri.once('dialog', (d) => d.accept()); // ConfirmarBotao usa window.confirm
  await nutri.getByRole('button', { name: 'Arquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Desarquivar paciente' })).toBeVisible();
  await p.page.goto('/p/inicio');
  await expect(p.page).toHaveURL(/\/p\/sem-acesso$/);
  await expect(p.page.getByRole('status')).toHaveText('Seu acesso ao portal não está ativo. Fale com sua nutricionista.');
  await nutri.getByRole('button', { name: 'Desarquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Arquivar paciente' })).toBeVisible();
  await p.page.goto('/p/inicio');
  await expect(p.page.getByRole('heading', { name: 'Meu acompanhamento' })).toBeVisible();
  await p.page.context().close();
});

test('nutricionista em /p/inicio volta ao painel', async () => {
  await nutri.goto('/p/inicio');
  await expect(nutri).toHaveURL(/\/painel$/);
});

test('Meu plano: sem plano → "Sua nutricionista ainda está preparando seu plano"; publicado → refeições e PDF (US-041)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.3');
  await p.page.goto('/p/plano');
  await expect(p.page.getByRole('status')).toHaveText('Sua nutricionista ainda está preparando seu plano');
  await publicarPlanoSimples(nutri, p.prontuario); // e2e/portal.ts
  await p.page.reload();
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect(p.page.getByText('Chuchu, cozido — 100 g')).toBeVisible();
  await expect(p.page.getByRole('link', { name: 'Baixar PDF' })).toBeVisible();
  await p.page.context().close();
});
