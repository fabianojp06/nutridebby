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

const entradasDoPlano = (page: Page) => page.evaluate(async () => ((await caches.keys()).includes('nd-plano-v1') ? (await (await caches.open('nd-plano-v1')).keys()).length : 0));

test('offline: "Plano" aberto pelo menu fica guardado; sem rede aparece com o selo; outra página do portal cai no plano; "Sair" apaga o cache (US-040, D6)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.4');
  await publicarPlanoSimples(nutri, p.prontuario);
  await p.page.goto('/p/inicio');
  await p.page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Uso normal: o menu é next/link (fetch RSC do roteador, não navegação 'navigate') — a página pede ao service worker
  await p.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Plano' }).click();
  await expect(p.page).toHaveURL(/\/p\/plano$/);
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect.poll(() => entradasDoPlano(p.page)).toBe(1);
  await p.page.context().setOffline(true);
  await p.page.goto('/p/plano');
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect(p.page.getByRole('status').filter({ hasText: 'Offline — exibindo última versão' })).toBeVisible();
  await p.page.goto('/p/inicio');
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await p.page.context().setOffline(false);
  await p.page.goto('/p/inicio');
  await p.page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(p.page).toHaveURL(/\/entrar$/);
  expect(await p.page.evaluate(() => caches.keys())).not.toContain('nd-plano-v1');
  expect((await p.page.context().cookies()).map((c) => c.name)).not.toContain('nd_vinculo');
  await p.page.context().close();
});

test('plano guardado é da conta: sessão vencida (sem "Sair") leva ao /entrar, que apaga a cópia antes de outra pessoa entrar (Review Focus 4)', async ({ browser }) => {
  const a = await pacienteNoPortal(browser, nutri, '10.9.10.5');
  await publicarPlanoSimples(nutri, a.prontuario);
  await a.page.goto('/p/plano');
  await expect.poll(() => entradasDoPlano(a.page)).toBe(1);
  await a.page.context().clearCookies(); // a sessão de A "vence" no aparelho
  await a.page.goto('/p/inicio');
  await expect(a.page).toHaveURL(/\/entrar/);
  await expect.poll(() => entradasDoPlano(a.page)).toBe(0);
  await a.page.context().close();
});
