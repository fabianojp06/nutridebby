import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { contraste } from '@/lib/tema/contraste';

// P12-14 (RNF-06, decisão do dono 07/10/2026): sessão da equipe — aviso 2 min antes do fim por falta de uso, "Continuar
// conectada", saída automática para /entrar?motivo=inatividade. Com os prazos encurtados do servidor do E2E
// (SESSAO_TESTE_MS=30000, playwright.config.ts) e só neste contexto, pelo cookie nd_sessao_teste: inatividade de 30 s,
// aviso aos 15 s, renovação no máximo a cada 5 s. IPs deste spec: 10.9.16.66 a 10.9.16.70.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const AVISO = 'Sua sessão vai encerrar em 2 minutos por falta de uso.';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function entrarComPrazosCurtos(browser: Browser, ip: string, baseURL: string): Promise<Page> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip } });
  await ctx.addCookies([{ name: 'nd_sessao_teste', value: '1', url: baseURL }]);
  const page = await ctx.newPage();
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(NUTRI.email);
  await page.getByLabel('Senha').fill(NUTRI.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  // o servidor do E2E está com os prazos curtos? (o GET só pergunta: não conta como uso)
  const estado = await page.evaluate(async () => (await (await fetch('/api/sessao/ativa')).json()) as { inatividadeMs: number });
  expect(estado.inatividadeMs, 'suba o servidor do E2E com SESSAO_TESTE_MS=30000 (playwright.config.ts)').toBeLessThanOrEqual(30_000);
  return page;
}

const avisoDe = (page: Page) => page.getByRole('alertdialog', { name: AVISO });

test('o cookie da equipe é de sessão do navegador: fechar o navegador encerra o login (sem Expires)', async ({ browser, baseURL }) => {
  const page = await entrarComPrazosCurtos(browser, '10.9.16.66', baseURL!);
  const sessao = (await page.context().cookies()).find((c) => c.name.endsWith('nd.session_token'));
  expect(sessao?.expires).toBe(-1); // -1 = cookie de sessão (sem Max-Age/Expires)
  await page.context().close();
});

test('sem ação: o aviso aparece (foco no botão, Esc não fecha) e no fim vai a /entrar?motivo=inatividade', async ({ browser, baseURL }) => {
  const page = await entrarComPrazosCurtos(browser, '10.9.16.66', baseURL!);
  const aviso = avisoDe(page);
  await expect(aviso).toBeVisible({ timeout: 25_000 });
  const continuar = aviso.getByRole('button', { name: 'Continuar conectada' });
  await expect(continuar).toBeFocused();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(aviso).toBeVisible();
  await expect(page).toHaveURL(/\/entrar\?motivo=inatividade$/, { timeout: 30_000 });
  await expect(page.getByRole('alert').filter({ hasText: 'Sua sessão foi encerrada por falta de uso. Entre de novo.' })).toBeVisible();
  expect((await page.context().cookies()).map((c) => c.name)).not.toContain('nd.session_token');
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/entrar\?volta=%2Fpainel$/);
  await page.context().close();
});

test('"Continuar conectada" renova: o prazo antigo passa e a sessão continua', async ({ browser, baseURL }) => {
  const page = await entrarComPrazosCurtos(browser, '10.9.16.67', baseURL!);
  const aviso = avisoDe(page);
  await expect(aviso).toBeVisible({ timeout: 25_000 });
  await aviso.getByRole('button', { name: 'Continuar conectada' }).click();
  await expect(aviso).toBeHidden();
  await page.waitForTimeout(17_000); // passa do fim que valia antes do clique (30 s depois do login)
  await expect(page).toHaveURL(/\/painel$/);
  await page.reload();
  await expect(page).toHaveURL(/\/painel$/);
  await page.context().close();
});

test('duas abas: "Continuar conectada" numa fecha o aviso na outra (sincronizadas)', async ({ browser, baseURL }) => {
  const primeira = await entrarComPrazosCurtos(browser, '10.9.16.68', baseURL!);
  const segunda = await primeira.context().newPage();
  await segunda.goto('/painel');
  await expect(avisoDe(primeira)).toBeVisible({ timeout: 25_000 });
  await expect(avisoDe(segunda)).toBeVisible({ timeout: 10_000 });
  await avisoDe(primeira).getByRole('button', { name: 'Continuar conectada' }).click();
  await expect(avisoDe(primeira)).toBeHidden();
  await expect(avisoDe(segunda)).toBeHidden();
  await primeira.context().close();
});

test('uso real na tela (tecla e rolagem) renova sem o aviso aparecer', async ({ browser, baseURL }) => {
  const page = await entrarComPrazosCurtos(browser, '10.9.16.69', baseURL!);
  const aviso = avisoDe(page);
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(5_000);
    if (i % 2) await page.mouse.wheel(0, 40);
    else await page.keyboard.press('Shift');
    await expect(aviso).toBeHidden();
  }
  await expect(page).toHaveURL(/\/painel$/); // 40 s depois do login, mais que os 30 s de inatividade
  await page.context().close();
});

const hex = (cor: string) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cor);
  expect(m, cor).not.toBeNull();
  return `#${m!.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
};

test('axe sem violações no aviso e foco visível no "Continuar conectada" (≥ 3:1 contra o diálogo), no modo claro e no escuro', async ({ browser, baseURL }) => {
  const page = await entrarComPrazosCurtos(browser, '10.9.16.70', baseURL!);
  for (const esquema of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: esquema }); // a conta do E2E fica em "Igual ao aparelho" (padrão do seed)
    await page.reload();
    const aviso = avisoDe(page);
    await expect(aviso).toBeVisible({ timeout: 25_000 });
    // Revisão final do Plano 15: o axe 4.13 empilha, sob cada linha do título, também o que está atrás do diálogo modal
    // (camada do topo); se a página por baixo muda entre as duas linhas (aqui, a borda entre dois cartões do Início, que
    // desceu quando o item das dúvidas — hoje "Mensagens", Plano 25 — levou o menu a uma segunda linha), dá "elmPartiallyObscuring", sem ser problema
    // de contraste: o diálogo é opaco. A página por baixo sai do cálculo; o contraste conferido é o do texto sobre o diálogo.
    await page.locator('main').evaluate((m) => void (m.style.visibility = 'hidden'));
    const r = await new AxeBuilder({ page }).withTags(TAGS).include('dialog[role="alertdialog"]').analyze();
    expect(r.passes.length, 'o axe rodou regras no aviso').toBeGreaterThan(0);
    const contrasteIncerto = r.incomplete.filter((i) => i.id === 'color-contrast').flatMap((i) => i.nodes.map((n) => n.target.join(' ')));
    expect([...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), ...contrasteIncerto], esquema).toEqual([]);
    // WCAG 2.4.7/1.4.11 (o axe não confere foco): o contorno fica do lado de fora do botão (outline-offset), sobre o
    // cartão do diálogo — o fundo que conta é o do primeiro ancestral pintado
    const continuar = aviso.getByRole('button', { name: 'Continuar conectada' });
    await page.keyboard.press('Tab'); // modalidade de teclado: o focus() programático acende o :focus-visible
    await continuar.focus();
    const f = await continuar.evaluate((el) => {
      let e = el.parentElement;
      while (e && /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(getComputedStyle(e).backgroundColor)) e = e.parentElement;
      const s = getComputedStyle(el);
      return {
        focoVisivel: el.matches(':focus-visible'),
        estilo: s.outlineStyle,
        largura: parseFloat(s.outlineWidth),
        cor: s.outlineColor,
        fundo: e ? getComputedStyle(e).backgroundColor : 'rgb(255, 255, 255)',
      };
    });
    expect(f.focoVisivel, esquema).toBe(true);
    expect(f.estilo, esquema).toBe('solid');
    expect(f.largura, esquema).toBeGreaterThanOrEqual(2);
    expect(contraste(hex(f.cor), hex(f.fundo)), `${esquema}: ${f.cor} sobre ${f.fundo}`).toBeGreaterThanOrEqual(3);
    await continuar.click();
    await expect(aviso).toBeHidden();
  }
  await page.context().close();
});
