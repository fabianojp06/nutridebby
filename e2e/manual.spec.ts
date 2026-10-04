import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { escolherTema, irPeloMenu } from './painel';

// P08-10 (D26, D27). Conta própria, com o progresso zerado pelo seed a cada execução. IPs 10.9.13.96 e .97 (faixa do despacho).
const MANUAL = { email: 'manual-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
test.describe.configure({ mode: 'serial' });
let page: Page;
const tour = () => page.getByRole('dialog', { name: /Boas-vindas ao NutriDebby|Menu do painel|Próxima consulta|Atalhos|Claro ou escuro|Ajuda em cada tela|Sua conta/ });
const semViolacoes = async () => expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);

test.beforeAll(async ({ browser }) => {
  page = await entrarComo(browser, MANUAL.email, MANUAL.senha, '10.9.13.96');
});
test.afterAll(async () => {
  await page?.context().close();
});

test('primeiro acesso: o tour abre sozinho no Início; Esc pula e grava (não volta ao recarregar)', async () => {
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('dialog', { name: 'Boas-vindas ao NutriDebby' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour()).toBeHidden();
  await page.reload();
  await expect(tour()).toBeHidden();
});

test('rever pelo menu da conta: foco preso no diálogo, Próximo até Concluir; outro aparelho não vê de novo', async ({ browser }) => {
  await page.getByLabel(/^Conta de /).click();
  await page.getByRole('link', { name: 'Rever o tour de boas-vindas' }).click();
  await expect(page.getByRole('dialog', { name: 'Boas-vindas ao NutriDebby' })).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    // o fundo fica inerte: o foco está no diálogo (ou saiu para a interface do navegador), nunca na página por trás
    expect(await page.evaluate(() => { const a = document.activeElement; return !a || a === document.body || !!a.closest('dialog'); })).toBe(true);
  }
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Próximo' }).click();
  await expect(page.getByText('7 de 7')).toBeVisible();
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(tour()).toBeHidden();
  await expect(page).toHaveURL(/\/painel$/); // o ?tour= sai da URL
  const outro = await entrarComo(browser, MANUAL.email, MANUAL.senha, '10.9.13.97');
  await expect(outro).toHaveURL(/\/painel$/);
  await expect(outro.getByRole('dialog', { name: 'Boas-vindas ao NutriDebby' })).toBeHidden();
  await outro.context().close();
});

// O progresso vem do layout, que NÃO é renderizado de novo na navegação pelo cliente: este caso não pode recarregar
test('navegação pelo cliente: depois de concluir, ir a Pacientes e voltar ao Início pelo menu não reabre o tour', async () => {
  await page.goto('/painel?tour=boas-vindas');
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Próximo' }).click();
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(tour()).toBeHidden();
  await irPeloMenu(page, 'Pacientes');
  await expect(page).toHaveURL(/\/painel\/pacientes$/);
  await irPeloMenu(page, 'Início');
  await expect(page).toHaveURL(/\/painel$/);
  await page.waitForLoadState('networkidle');
  await expect(tour()).toBeHidden();
});

test('axe com o tour aberto, em cada passo, nos modos claro e escuro', async () => {
  for (const tema of ['Claro', 'Escuro'] as const) {
    await escolherTema(page, tema);
    await page.goto('/painel?tour=boas-vindas');
    for (let i = 0; i < 7; i++) {
      await expect(page.getByText(`${i + 1} de 7`)).toBeVisible();
      await semViolacoes();
      if (i < 6) await page.getByRole('button', { name: 'Próximo' }).click();
    }
    await page.getByRole('button', { name: 'Pular o tour' }).click();
  }
  await escolherTema(page, 'Igual ao aparelho');
});

test('Ajuda na Agenda: a gaveta mostra o texto da tela; o tour da tela marca o alvo certo', async () => {
  await page.goto('/painel/agenda');
  await page.getByRole('complementary', { name: 'Dica' }).getByRole('button', { name: 'Dispensar' }).click(); // D27: aviso da primeira visita
  await page.getByRole('button', { name: 'Ajuda desta tela' }).click();
  const gaveta = page.getByRole('dialog', { name: 'Ajuda: Agenda' });
  await expect(gaveta).toBeVisible();
  await semViolacoes();
  await gaveta.getByRole('button', { name: 'Ver o tour desta tela' }).click();
  await expect(page.getByRole('dialog', { name: 'Dia ou semana' })).toBeVisible();
  const alvo = (await page.locator('[data-guia="periodo-agenda"]').boundingBox())!;
  const luz = (await page.locator('[data-holofote]').boundingBox())!;
  expect(Math.abs(luz.x - (alvo.x - 6))).toBeLessThanOrEqual(2);
  expect(Math.abs(luz.width - (alvo.width + 12))).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Pular o tour' }).click();
});

test('"Primeira vez aqui?" aparece uma vez por tela, também na navegação pelo menu; dispensar numa tela não esconde o das outras', async () => {
  const dica = page.getByRole('complementary', { name: 'Dica' });
  await page.goto('/painel/diarios');
  await expect(dica).toContainText('Primeira vez aqui?');
  await dica.getByRole('button', { name: 'Dispensar' }).click();
  await irPeloMenu(page, 'Conteúdos');
  await expect(dica).toContainText('Primeira vez aqui?'); // outra tela, outro aviso (dispensados por id)
  await irPeloMenu(page, 'Diários');
  await page.waitForLoadState('networkidle');
  await expect(dica).toBeHidden(); // sem recarregar: o "visto" já está no progresso local
  await page.reload();
  await expect(dica).toBeHidden();
});

test('o manual completo funciona sem JavaScript', async ({ browser }) => {
  const semJs = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), extraHTTPHeaders: { 'x-forwarded-for': '10.9.13.96' } });
  const p = await semJs.newPage();
  await p.goto('/painel/ajuda');
  await expect(p.getByRole('heading', { name: 'Manual do NutriDebby', level: 1 })).toBeVisible();
  for (const t of ['Início', 'Pacientes', 'Prontuário', 'Plano alimentar', 'Agenda', 'Conteúdos', 'WhatsApp']) {
    await expect(p.getByRole('heading', { name: t, level: 2 })).toBeVisible();
  }
  await semJs.close();
});
