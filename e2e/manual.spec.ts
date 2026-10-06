import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { escolherTema, irPeloMenu } from './painel';

// P08-10 (D26, D27). Conta própria, com o progresso zerado pelo seed a cada execução. IPs 10.9.13.96 e .97 (faixa do despacho).
const MANUAL = { email: 'manual-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
// P09-04: o estado do primeiro acesso é gasto na 1ª tentativa (o progresso fica gravado): uma nova tentativa no mesmo
// banco sempre falharia com outro erro (run 37325291299). Falha de verdade aparece uma vez, com a causa certa.
test.describe.configure({ mode: 'serial', retries: 0 });
let page: Page;
const tour = () => page.getByRole('dialog', { name: /Boas-vindas ao NutriDebby|Menu do painel|Próxima consulta|Atalhos|Claro ou escuro|Ajuda em cada tela|Sua conta/ });
const semViolacoes = async () => expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);
/**
 * A gravação do progresso terminou: marcarGuiaAction é chamada sem await no cliente (otimista, guia-do-painel.tsx). O corpo
 * do POST da Server Action é o JSON dos argumentos (`["diarios",1,"visto"]`): o id do guia evita casar com a gravação de
 * outra tela que ainda estivesse em andamento.
 */
const gravou = (id: string, estado: 'dispensado' | 'concluido' | 'visto') =>
  page.waitForResponse((r) => {
    const corpo = r.request().postData() ?? '';
    return r.request().method() === 'POST' && r.request().headers()['next-action'] !== undefined && corpo.includes(`"${id}"`) && corpo.includes(`"${estado}"`);
  });

test.beforeAll(async ({ browser }) => {
  page = await entrarComo(browser, MANUAL.email, MANUAL.senha, '10.9.13.96');
});
test.afterAll(async () => {
  await page?.context().close();
});

test('primeiro acesso: o tour abre sozinho no Início; Esc pula e grava (não volta ao recarregar)', async () => {
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('dialog', { name: 'Boas-vindas ao NutriDebby' })).toBeVisible();
  // P09-04: rede lenta de propósito na gravação do progresso (sem a espera abaixo, o reload cortava o POST: CI 05/10)
  await page.route('**/painel', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => undefined); // o reload pode ter cancelado o pedido
  });
  const salvo = gravou('boas-vindas', 'dispensado');
  await page.keyboard.press('Escape');
  await expect(tour()).toBeHidden();
  expect((await salvo).ok()).toBe(true); // só recarrega depois de o servidor gravar
  await page.unroute('**/painel');
  await page.reload();
  await page.waitForLoadState('networkidle'); // o <dialog> só abre depois da hidratação (useLayoutEffect)
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
  // o link do menu da conta estava no <details> fechado: o foco não cai no <body>, vai para o "Ajuda" (risco 5)
  await expect(page.locator('[data-guia="ajuda"]')).toBeFocused();
  await expect(page).toHaveURL(/\/painel$/); // o ?tour= sai da URL
  const outro = await entrarComo(browser, MANUAL.email, MANUAL.senha, '10.9.13.97');
  await expect(outro).toHaveURL(/\/painel$/);
  await outro.waitForLoadState('networkidle'); // o <dialog> só abre depois da hidratação (useLayoutEffect)
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
      await expect(page.getByText(`${i + 1} de 7`, { exact: true })).toBeVisible(); // não o "N de M pacientes abriram o app" do Início
      await semViolacoes();
      if (i < 6) await page.getByRole('button', { name: 'Próximo' }).click();
    }
    // P09-04: o escolherTema a seguir navega; sem esperar a gravação e o router.replace que tira o ?tour= da URL, o goto
    // cortava as respostas em andamento ("The destination stream closed early." no servidor)
    const pulou = gravou('boas-vindas', 'dispensado');
    await page.getByRole('button', { name: 'Pular o tour' }).click();
    expect((await pulou).ok()).toBe(true);
    await expect(page).toHaveURL(/\/painel$/);
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
  await expect(page.getByRole('dialog', { name: 'Dia, semana ou lista' })).toBeVisible();
  const alvo = (await page.locator('[data-guia="periodo-agenda"]').boundingBox())!;
  const luz = (await page.locator('[data-holofote]').boundingBox())!;
  expect(Math.abs(luz.x - (alvo.x - 6))).toBeLessThanOrEqual(2);
  expect(Math.abs(luz.width - (alvo.width + 12))).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Pular o tour' }).click();
});

test('a gaveta aberta não volta sozinha: sair pelo voltar do navegador e voltar à tela pelo menu (D27)', async () => {
  await page.goto('/painel/pacientes');
  await page.waitForLoadState('networkidle');
  await irPeloMenu(page, 'Agenda');
  await expect(page).toHaveURL(/\/painel\/agenda$/);
  await page.getByRole('button', { name: 'Ajuda desta tela' }).click();
  const gaveta = page.getByRole('dialog', { name: 'Ajuda: Agenda' });
  await expect(gaveta).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/painel\/pacientes$/);
  await expect(gaveta).toBeHidden();
  await irPeloMenu(page, 'Agenda');
  await expect(page).toHaveURL(/\/painel\/agenda$/);
  await page.waitForLoadState('networkidle');
  await expect(gaveta).toBeHidden();
});

test('"Ver como funciona": ao fechar o tour, o foco vai para o "Ajuda" (o botão do aviso saiu da tela)', async () => {
  await page.goto('/painel/alimentos'); // tela ainda não visitada neste spec: o aviso aparece
  await page.getByRole('complementary', { name: 'Dica' }).getByRole('button', { name: 'Ver como funciona' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('[data-guia="ajuda"]')).toBeFocused();
});

test('impressão do manual no modo escuro: texto escuro no papel e sem o cabeçalho do painel (D26)', async () => {
  await escolherTema(page, 'Escuro');
  await page.goto('/painel/ajuda');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('heading', { name: 'Manual do NutriDebby', level: 1 })).toHaveCSS('color', 'rgb(20, 33, 29)');
  await expect(page.getByRole('banner')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await escolherTema(page, 'Igual ao aparelho');
});

test('"Primeira vez aqui?" aparece uma vez por tela, também na navegação pelo menu; dispensar numa tela não esconde o das outras', async () => {
  const dica = page.getByRole('complementary', { name: 'Dica' });
  const vistoDiarios = gravou('diarios', 'visto');
  await page.goto('/painel/diarios');
  await expect(dica).toContainText('Primeira vez aqui?');
  await dica.getByRole('button', { name: 'Dispensar' }).click();
  await irPeloMenu(page, 'Conteúdos');
  await expect(dica).toContainText('Primeira vez aqui?'); // outra tela, outro aviso (dispensados por id)
  await irPeloMenu(page, 'Diários');
  await page.waitForLoadState('networkidle');
  await expect(dica).toBeHidden(); // sem recarregar: o "visto" já está no progresso local
  expect((await vistoDiarios).ok()).toBe(true);
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
