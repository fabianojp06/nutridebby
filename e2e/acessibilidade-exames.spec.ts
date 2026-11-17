import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { bibliotecasDeExames, escolherTema } from './painel';

// Plano 22 (T3, EP-D54, R22-22): o axe dos estados de /painel/exames que não são rota (diálogos abertos, formulário com
// erro), nos modos claro e escuro, a 1280 e a 360 px; e o contrato do `Dialogo` (src/components/dialogo.tsx) no navegador
// de verdade: Esc fecha e o foco volta a quem abriu; `ocupado` segura o Esc (também o segundo, que o Chromium não deixa
// cancelar) sem chamar `aoFechar`; e o diálogo desmontado aberto (a action voltou à lista) devolve o foco ao botão que o
// abriu. IPs: 10.9.22.10 (nutri). O catálogo volta como estava (o nome adicionado é excluído no fim).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
test.describe.configure({ mode: 'serial', timeout: 180_000 });
let nutri: Page;
let nomeExame: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.22.10');
  await expect(nutri).toHaveURL(/\/painel$/);
  const sufixo = `ax${Date.now().toString(36)}`;
  await bibliotecasDeExames(nutri, sufixo);
  nomeExame = `Ferritina axe ${sufixo}`;
});
test.afterAll(async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  await escolherTema(nutri, 'Igual ao aparelho'); // o seed e as outras specs esperam o padrão
  await nutri?.context().close();
});

/** Só o diálogo aberto quando há um (o fundo inerte fica sob o backdrop e cairia em "incomplete" no contraste). */
async function violacoes(page: Page, incluir?: string): Promise<string[]> {
  const axe = new AxeBuilder({ page }).withTags(TAGS);
  const r = await (incluir ? axe.include(incluir) : axe).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  const incertos = r.incomplete.filter((i) => i.id === 'color-contrast').flatMap((i) => i.nodes.map((n) => `incompleto color-contrast: ${n.target.join(' ')}`));
  return [...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), ...incertos];
}

const botaoComecar = (page: Page) => page.getByRole('button', { name: 'Nomes de exames para começar' });
const dialogoComecar = (page: Page) => page.getByRole('dialog', { name: 'Nomes de exames para começar (você escolhe o que usar)' });
const excluirDoExame = (page: Page) => page.getByRole('button', { name: `Excluir ${nomeExame}`, exact: true });
const confirmarExcluir = (page: Page) => page.getByRole('alertdialog', { name: `Excluir ${nomeExame}` });

/** Segura o POST da action (Server Action) desta tela até `soltar()`: o diálogo fica `ocupado` enquanto isso. */
async function segurarAction(page: Page, caminho: string): Promise<{ soltar: () => void; desfazer: () => Promise<void> }> {
  let soltar = () => undefined as void;
  const solto = new Promise<void>((r) => {
    soltar = r;
  });
  const padrao = `**${caminho}**`;
  await page.route(padrao, async (route) => {
    if (route.request().method() === 'POST') await solto;
    await route.fallback();
  });
  return { soltar, desfazer: () => page.unroute(padrao) };
}

const aberto = async (d: Locator) => expect(d).toHaveAttribute('open', '');

for (const [modo, tema] of [
  ['claro', 'Claro'],
  ['escuro', 'Escuro'],
] as const) {
  for (const largura of [1280, 360]) {
    test(`axe sem violações nos estados do catálogo — modo ${modo}, ${largura} px`, async () => {
      await nutri.setViewportSize({ width: 1280, height: 800 });
      await escolherTema(nutri, tema);
      await nutri.setViewportSize({ width: largura, height: 800 });
      const falhas: string[] = [];

      // "Nomes de exames para começar" aberto (o botão só existe enquanto falta nome da lista no catálogo)
      await nutri.goto('/painel/exames/catalogo');
      if (await botaoComecar(nutri).count()) {
        await botaoComecar(nutri).click();
        await expect(dialogoComecar(nutri)).toBeVisible();
        for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`nomes para começar — ${v}`);
        await nutri.keyboard.press('Escape');
      }

      // DialogoConfirmar do excluir aberto
      await excluirDoExame(nutri).click();
      await expect(confirmarExcluir(nutri)).toBeVisible();
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`confirmar excluir — ${v}`);
      await nutri.keyboard.press('Escape');

      // formulário do exame com erro de faixa (sem fonte) e o diálogo "Buscar no catálogo" do modelo
      await nutri.goto('/painel/exames/catalogo/novo');
      await nutri.getByLabel('Nome', { exact: true }).fill('Exame com erro');
      await nutri.getByLabel('Unidade (opcional)').fill('mg/dL');
      await nutri.getByRole('button', { name: 'Acrescentar faixa' }).click();
      await nutri.getByLabel('Abaixo de').fill('20');
      await nutri.getByLabel('Categoria').selectOption('Baixo');
      await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(nutri.getByRole('alert').filter({ hasText: 'Informe a fonte (de 2 a 300 caracteres).' })).toBeVisible();
      await expect(nutri.getByLabel('Nome', { exact: true })).toHaveValue('Exame com erro'); // nada some
      for (const v of await violacoes(nutri)) falhas.push(`formulário com erro — ${v}`);

      await nutri.goto('/painel/exames/modelos/novo');
      await nutri.getByRole('button', { name: 'Adicionar do catálogo' }).click();
      await expect(nutri.getByRole('dialog', { name: 'Buscar no catálogo' })).toBeVisible();
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`buscar no catálogo — ${v}`);
      await nutri.keyboard.press('Escape');

      expect(falhas).toEqual([]);
    });
  }
}

test('Dialogo (EP-D42): Esc fecha e o foco volta ao botão que abriu — "Nomes de exames para começar" e o "Excluir" do DialogoConfirmar', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  await nutri.goto('/painel/exames/catalogo');
  if (await botaoComecar(nutri).count()) {
    await botaoComecar(nutri).click();
    await expect(dialogoComecar(nutri)).toBeVisible();
    await nutri.keyboard.press('Escape');
    await expect(dialogoComecar(nutri)).toBeHidden();
    await expect(botaoComecar(nutri)).toBeFocused();
  }
  await excluirDoExame(nutri).click();
  await expect(confirmarExcluir(nutri)).toBeVisible();
  await expect(confirmarExcluir(nutri).getByRole('button', { name: 'Cancelar' })).toBeFocused(); // perigo: começa em "Cancelar"
  await nutri.keyboard.press('Escape');
  await expect(confirmarExcluir(nutri)).toBeHidden();
  await expect(excluirDoExame(nutri)).toBeFocused();
  await expect(nutri.getByRole('link', { name: nomeExame, exact: true })).toBeVisible(); // nada excluído
});

test('Dialogo: ocupado segura o Esc duplo (continua aberto, aoFechar não chamado); desmontado aberto, devolve o foco a quem abriu', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  await nutri.goto('/painel/exames/catalogo');
  test.skip((await botaoComecar(nutri).count()) === 0, 'todos os nomes da lista já estão no catálogo deste banco');
  await botaoComecar(nutri).click();
  const dialogo = dialogoComecar(nutri);
  await expect(dialogo).toBeVisible();
  const caixa = dialogo.getByRole('checkbox').first();
  const nome = (await caixa.getAttribute('value'))!;
  const ultimo = (await dialogo.getByRole('checkbox').count()) === 1;
  await caixa.check();

  const action = await segurarAction(nutri, '/painel/exames/catalogo');
  await dialogo.getByRole('button', { name: 'Adicionar ao catálogo' }).click();
  await expect(dialogo).toHaveAttribute('aria-busy', 'true');
  // o primeiro Esc é cancelável (o onCancel segura); o segundo o Chromium não deixa cancelar: o onClose reabre
  await nutri.keyboard.press('Escape');
  await nutri.keyboard.press('Escape');
  await expect(dialogo).toBeVisible();
  await aberto(dialogo);
  await expect(dialogo.getByRole('button', { name: 'Cancelar' })).toHaveAttribute('aria-disabled', 'true');
  await dialogo.getByRole('button', { name: 'Cancelar' }).click(); // ocupado: "Cancelar" também não fecha
  await expect(dialogo).toBeVisible();

  action.soltar();
  await expect(nutri.getByRole('status').filter({ hasText: '1 exame adicionado ao catálogo.' })).toBeVisible();
  await expect(dialogo).toBeHidden();
  await action.desfazer();
  // a action voltou à lista com um marcador novo: o corpo do diálogo foi desmontado aberto e o foco voltou ao botão
  // (ou, se era o último nome e o botão saiu, ao título da tela)
  if (ultimo) await expect(nutri.getByRole('heading', { level: 1, name: 'Catálogo de exames' })).toBeFocused();
  else await expect(botaoComecar(nutri)).toBeFocused();

  // de volta como estava: excluir o nome adicionado, com o DialogoConfirmar ocupado enquanto a action corre
  const excluir = nutri.getByRole('button', { name: `Excluir ${nome}`, exact: true });
  await excluir.click();
  const confirmar = nutri.getByRole('alertdialog', { name: `Excluir ${nome}` });
  await expect(confirmar).toContainText(`Excluir ${nome} do catálogo? Exames, modelos e documentos já gravados não mudam.`);
  const exclusao = await segurarAction(nutri, '/painel/exames/catalogo');
  await confirmar.getByRole('button', { name: 'Excluir', exact: true }).click();
  await nutri.keyboard.press('Escape');
  await nutri.keyboard.press('Escape');
  await expect(confirmar).toBeVisible();
  exclusao.soltar();
  await expect(nutri.getByRole('status').filter({ hasText: 'Exame excluído do catálogo.' })).toBeVisible();
  await exclusao.desfazer();
  await expect(nutri.getByRole('button', { name: `Excluir ${nome}`, exact: true })).toHaveCount(0);
  // a linha (e o botão que abriu) saiu: o foco vai ao título da tela
  await expect(nutri.getByRole('heading', { level: 1, name: 'Catálogo de exames' })).toBeFocused();
});
