import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';

const segredos = new Map<string, string>();

/** `opcoes`: o contexto herda o dispositivo do projeto (celular); o painel da nutricionista pede o desktop. */
export async function entrarComo(browser: Browser, email: string, senha: string, ip: string, opcoes: BrowserContextOptions = {}): Promise<Page> {
  const ctx = await browser.newContext({ ...opcoes, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  return page;
}

/** Admin da execução: no primeiro login ativa o 2FA obrigatório (US-003) e guarda o segredo. */
export async function entrarComoAdmin(browser: Browser, cred: { email: string; password: string }, ip: string): Promise<Page> {
  const page = await entrarComo(browser, cred.email, cred.password, ip);
  const segredo = segredos.get(cred.email);
  if (segredo) {
    await expect(page).toHaveURL(/\/entrar\/2fa/);
    await page.getByLabel('Código do app autenticador').fill(new TOTP({ secret: segredo }).generate());
    await page.getByRole('button', { name: 'Verificar' }).click();
  } else {
    await expect(page).toHaveURL(/\/conta\/seguranca/);
    await page.getByLabel('Confirme sua senha').fill(cred.password);
    await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
    const novo = (await page.getByTestId('totp-secret').textContent())!.trim();
    segredos.set(cred.email, novo);
    await page.getByLabel('Código de 6 dígitos').fill(new TOTP({ secret: novo }).generate());
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await page.getByRole('link', { name: 'Continuar' }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Contas' })).toBeVisible();
  return page;
}

/** Código atual do 2FA do admin da execução (o segredo guardado no primeiro login de entrarComoAdmin). */
export function codigoDoAdmin(email: string): string {
  const segredo = segredos.get(email);
  if (!segredo) throw new Error('entrarComoAdmin antes de pedir o código');
  return new TOTP({ secret: segredo }).generate();
}

/**
 * P08-10: conta nova criada pelo fluxo do admin (plataforma.spec) vê o tour de boas-vindas no 1º acesso ao painel.
 * Espera o tour abrir (o `showModal` vem num `useLayoutEffect`, depois da hidratação) e fecha com Esc.
 * Não usar `isVisible({ timeout })`: o Playwright ignora o timeout e responde na hora, e o tour abriria depois.
 */
export async function fecharTourDeBoasVindas(page: Page): Promise<void> {
  const tour = page.getByRole('dialog', { name: 'Boas-vindas ao NutriDebby' });
  await expect(tour).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour).toBeHidden();
}
