import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { entrarComo } from './helpers';
import { bibliotecasDeExames, contrasteIncerto, escolherTema } from './painel';
import { criarPacientePeloFormulario } from './pacientes-form';

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
  // a 360 px as abas da ficha e a tabela de valores rolam na horizontal: o que fica fora da tela sai (o resto é conferido)
  const ignorarForaDaTela = (page.viewportSize()?.width ?? 1280) < 1280;
  const incertos = (await contrasteIncerto(page, r.incomplete, { ignorarForaDaTela })).map((alvo) => `incompleto color-contrast: ${alvo}`);
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
    // duas vezes no mesmo <Dialogo> (montado entre as aberturas): cada abertura devolve o foco (`devolvido` volta a falso)
    for (let vez = 1; vez <= 2; vez++) {
      await botaoComecar(nutri).click();
      await expect(dialogoComecar(nutri)).toBeVisible();
      await nutri.keyboard.press('Escape');
      await expect(dialogoComecar(nutri)).toBeHidden();
      await expect(botaoComecar(nutri), `abertura ${vez}`).toBeFocused();
    }
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
  // ocupado: "Cancelar" também não fecha. O force aqui é para provar que o botão desativado NÃO faz nada (o Playwright
  // não clica em aria-disabled sem ele): a linha seguinte confere o diálogo aberto; o fluxo só segue depois do soltar.
  await dialogo.getByRole('button', { name: 'Cancelar' }).click({ force: true });
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

test('Buscar no catálogo (revisão da T3): Enter na busca não envia o modelo; o erro do modelo recebe o foco; o foco volta ao botão', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  await nutri.goto('/painel/exames/modelos/novo');
  await nutri.getByLabel('Nome do modelo').fill(`Modelo Enter ${Date.now().toString(36)}`);
  // sem exame: o erro da lista (longe do "Salvar") recebe o foco
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  const semExames = nutri.getByRole('alert').filter({ hasText: 'Inclua ao menos um exame.' });
  await expect(semExames).toBeFocused();

  // com um exame, o modelo já seria salvo: o Enter na busca do diálogo não pode enviar o formulário da tela
  await nutri.getByLabel('Adicionar exame fora do catálogo').fill('Ferro sérico');
  await nutri.getByRole('button', { name: 'Adicionar', exact: true }).click();
  const envios: string[] = [];
  // só a Server Action (cabeçalho Next-Action): o vigia da sessão também faz POST ao registrar o uso
  const ouvir = (r: Request) => {
    if (r.method() === 'POST' && r.headers()['next-action']) envios.push(r.url());
  };
  nutri.on('request', ouvir);
  const abrir = nutri.getByRole('button', { name: 'Adicionar do catálogo' });
  await abrir.click();
  const dialogo = nutri.getByRole('dialog', { name: 'Buscar no catálogo' });
  const busca = dialogo.getByRole('searchbox', { name: 'Buscar no catálogo' });
  await expect(busca).toBeFocused();
  await busca.fill(nomeExame);
  await busca.press('Enter');
  await aberto(dialogo);
  await expect(busca).toHaveValue(nomeExame); // nada remontou: a busca continua
  await dialogo.getByLabel(nomeExame).check();
  await dialogo.getByRole('button', { name: 'Adicionar 1 exame' }).click();
  await expect(dialogo).toBeHidden();
  await expect(abrir).toBeFocused();
  await expect(nutri.getByRole('heading', { level: 2, name: /Exames \(2 exames\)/ })).toBeVisible();
  nutri.off('request', ouvir);
  expect(envios, 'nenhuma Server Action: o Enter não enviou o modelo').toEqual([]);
  await expect(nutri).toHaveURL(/\/painel\/exames\/modelos\/novo$/);
});

test('Dialogo (correção f57e2d6): fechado pelo navegador e desmontado em seguida, o foco fica em quem abriu (uma devolução só)', async () => {
  // "Buscar no catálogo" só existe enquanto aberto: o `close` do navegador devolve o foco ao botão e chama `aoFechar`, que
  // desmonta o <Dialogo> ainda com `aberto`. Sem a guarda `devolvido`, a limpeza devolveria de novo — o botão já foi usado
  // (`anterior` nulo), então o foco iria ao `focoAoFechar` (o título "Exames") e sairia do botão.
  await nutri.setViewportSize({ width: 1280, height: 800 });
  await nutri.goto('/painel/exames/modelos/novo');
  const abrir = nutri.getByRole('button', { name: 'Adicionar do catálogo' });
  await abrir.click();
  const dialogo = nutri.getByRole('dialog', { name: 'Buscar no catálogo' });
  await aberto(dialogo);
  await nutri.evaluate(() => document.querySelector<HTMLDialogElement>('dialog[open]')?.close()); // como o form method="dialog"
  await expect(dialogo).toHaveCount(0);
  await expect(abrir).toBeFocused();
  await expect(nutri.getByRole('heading', { level: 2, name: /^Exames/ })).not.toBeFocused();
});

test('Exame do catálogo (revisão da T3): o foco acompanha "Acrescentar faixa", "Remover faixa" e o primeiro erro', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  await nutri.goto('/painel/exames/catalogo/novo');
  await nutri.getByLabel('Nome', { exact: true }).fill('Exame com erro');
  await nutri.getByLabel('Unidade (opcional)').fill('mg/dL');
  const acrescentar = nutri.getByRole('button', { name: 'Acrescentar faixa' });
  await acrescentar.click();
  await expect(nutri.getByRole('group', { name: 'Faixa 1' }).getByLabel('Sexo do cadastro')).toBeFocused();
  await acrescentar.click();
  await expect(nutri.getByRole('group', { name: 'Faixa 2' }).getByLabel('Sexo do cadastro')).toBeFocused();
  await nutri.getByRole('button', { name: 'Remover faixa 2' }).click();
  await expect(nutri.getByRole('group', { name: 'Faixa 2' })).toHaveCount(0);
  await expect(nutri.getByRole('heading', { level: 2, name: 'Faixas do consultório' })).toBeFocused(); // nunca o body

  // erro no meio do formulário (a fonte da faixa 1): o foco vai ao campo, não fica no "Salvar"
  await nutri.getByLabel('Abaixo de').fill('20');
  await nutri.getByLabel('Categoria').selectOption('Baixo');
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(nutri.getByRole('alert').filter({ hasText: 'Informe a fonte (de 2 a 300 caracteres).' })).toBeVisible();
  await expect(nutri.getByLabel('Fonte')).toBeFocused();
  await expect(nutri.getByLabel('Fonte')).toBeInViewport();
});

test('Linhas do exame (revisão da T4): o foco nunca cai no body — "Usar {a} a {b}", "Remover" da linha e "Remover todos"', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  const sufixo = `lf${Date.now().toString(36)}`;
  const prontuario = await criarPacientePeloFormulario(nutri, { nome: `Paciente Linhas ${sufixo}`, email: `linhas-${sufixo}@nutridebby.test` });
  await nutri.goto(`${prontuario}/exames`);

  // "Usar 70 a 99": o botão some (a faixa deixou de estar vazia) e o foco vai ao "de" já preenchido
  await nutri.getByLabel('Marcador 1', { exact: true }).fill('Glicemia de jejum');
  await nutri.getByLabel('Referência do laudo 1', { exact: true }).fill('70 a 99 mg/dL');
  await nutri.getByRole('button', { name: 'Usar 70 a 99 (linha 1)' }).click();
  const de1 = nutri.getByLabel('Faixa do laudo: de 1', { exact: true });
  await expect(de1).toBeFocused();
  await expect(de1).toHaveValue('70');
  await expect(nutri.getByLabel('até 1', { exact: true })).toHaveValue('99');

  // "Remover" da linha: o foco vai ao marcador da linha que tomou o lugar (ou da anterior); sem linhas, a "Adicionar linha"
  const adicionarLinha = nutri.getByRole('button', { name: 'Adicionar linha' });
  await adicionarLinha.click();
  await adicionarLinha.click();
  await nutri.getByLabel('Marcador 2', { exact: true }).fill('Ferritina');
  await nutri.getByLabel('Marcador 3', { exact: true }).fill('Vitamina D');
  await nutri.getByRole('button', { name: 'Remover a linha 2' }).click();
  await expect(nutri.getByRole('group', { name: 'Linha 2: Vitamina D' }).getByLabel('Marcador 2', { exact: true })).toBeFocused();
  await nutri.getByRole('button', { name: 'Remover a linha 2' }).click();
  await expect(nutri.getByRole('group', { name: 'Linha 1: Glicemia de jejum' }).getByLabel('Marcador 1', { exact: true })).toBeFocused();
  await nutri.getByRole('button', { name: 'Remover a linha 1' }).click();
  await expect(nutri.getByRole('group', { name: /^Linha 1/ })).toHaveCount(0);
  await expect(adicionarLinha).toBeFocused();

  // "Remover todos" confirmado: o gatilho some junto com o diálogo; o foco vai a "Adicionar linha"
  await adicionarLinha.click();
  await nutri.getByRole('button', { name: 'Remover todos' }).click();
  const confirmar = nutri.getByRole('alertdialog', { name: 'Remover todos' });
  await expect(confirmar).toBeVisible();
  await confirmar.getByRole('button', { name: 'Remover', exact: true }).click();
  await expect(confirmar).toHaveCount(0);
  await expect(nutri.getByRole('button', { name: 'Remover todos' })).toHaveCount(0);
  await expect(adicionarLinha).toBeFocused();
});

test('Linhas do exame (revisão da T4): o erro do servidor fica na linha que errou depois de remover a de cima', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  const sufixo = `le${Date.now().toString(36)}`;
  const prontuario = await criarPacientePeloFormulario(nutri, { nome: `Paciente Erro Linha ${sufixo}`, email: `erro-linha-${sufixo}@nutridebby.test` });
  await nutri.goto(`${prontuario}/exames`);
  await nutri.getByLabel('Título do exame').fill(`Rotina ${sufixo}`);
  await nutri.getByLabel('Marcador 1', { exact: true }).fill('Glicemia de jejum');
  await nutri.getByLabel('Valor 1', { exact: true }).fill('105');
  await nutri.getByRole('button', { name: 'Adicionar linha' }).click();
  await nutri.getByLabel('Marcador 2', { exact: true }).fill('Ferritina');
  await nutri.getByLabel('Valor 2', { exact: true }).fill('abc');
  await nutri.getByRole('button', { name: 'Salvar exame' }).click();
  await expect(nutri.getByLabel('Valor 2', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(nutri.getByLabel('Valor 1', { exact: true })).not.toHaveAttribute('aria-invalid', 'true');

  // a linha de cima sai: "Ferritina" passa a ser a linha 1 e leva o erro junto; nenhuma linha certa é acusada
  await nutri.getByRole('button', { name: 'Remover a linha 1' }).click();
  const ferritina = nutri.getByRole('group', { name: 'Linha 1: Ferritina' });
  await expect(ferritina.getByLabel('Valor 1', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(ferritina.getByRole('alert')).toHaveCount(1);
  // uma linha nova entra sem erro (não estava no envio)
  await nutri.getByRole('button', { name: 'Adicionar linha' }).click();
  await expect(nutri.getByLabel('Valor 2', { exact: true })).not.toHaveAttribute('aria-invalid', 'true');
});

// Plano 22 (T5a, RN-382, RN-383, RNF-372): o detalhe do exame — "Ver referência" aberto no detalhe e no "Novo exame" e o
// diálogo "Inserir modelo", nos modos claro e escuro, a 1280 e a 360 px; a nota salva com o retorno na região de status e o
// foco no título. O exame tem uma linha que casa com o exame do catálogo da semente desta spec (faixa "abaixo de 15").
let detalheDoExame: string;
let prontuarioDoDetalhe: string;

test('detalhe do exame (T5a): lança um exame que casa com o catálogo e abre pelo "Abrir {título} de {data}"', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  const sufixo = `dt${Date.now().toString(36)}`;
  prontuarioDoDetalhe = await criarPacientePeloFormulario(nutri, { nome: `Paciente Detalhe ${sufixo}`, email: `detalhe-${sufixo}@nutridebby.test` });
  await nutri.goto(`${prontuarioDoDetalhe}/exames`);
  const titulo = `Ferro ${sufixo}`;
  await nutri.getByLabel('Título do exame').fill(titulo);
  await nutri.getByLabel('Marcador 1', { exact: true }).fill(nomeExame);
  await nutri.getByLabel('Valor 1', { exact: true }).fill('10');
  await nutri.getByLabel('Unidade 1', { exact: true }).fill('ng/mL');
  await nutri.getByLabel('Faixa do laudo: de 1', { exact: true }).fill('15');
  await nutri.getByLabel('até 1', { exact: true }).fill('150');
  await nutri.getByRole('button', { name: 'Salvar exame' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Exame salvo.' })).toBeVisible();
  await nutri.getByRole('link', { name: new RegExp(`^Abrir ${titulo} de `) }).click();
  await expect(nutri.getByRole('heading', { level: 2, name: new RegExp(`^${titulo} — `) })).toBeVisible();
  detalheDoExame = nutri.url();
  // a neutra e a categoria do consultório, com o aviso fixo e o de gestação antes da tabela
  const linha = nutri.getByRole('row', { name: new RegExp(nomeExame) });
  await expect(linha).toContainText('Abaixo da referência');
  await expect(linha).toContainText('Baixo (faixa do consultório)');
  await expect(nutri.getByText('Classificação automática pela faixa de referência informada. Não é diagnóstico.')).toBeVisible();
  await expect(nutri.getByText('As faixas do consultório não consideram gestação.')).toBeVisible();
});

for (const [modo, tema] of [
  ['claro', 'Claro'],
  ['escuro', 'Escuro'],
] as const) {
  for (const largura of [1280, 360]) {
    test(`axe sem violações no detalhe do exame, "Ver referência" e "Inserir modelo" — modo ${modo}, ${largura} px`, async () => {
      await nutri.setViewportSize({ width: 1280, height: 800 });
      await escolherTema(nutri, tema);
      await nutri.setViewportSize({ width: largura, height: 800 });
      const falhas: string[] = [];

      await nutri.goto(detalheDoExame);
      for (const v of await violacoes(nutri)) falhas.push(`detalhe — ${v}`);
      await nutri.getByRole('button', { name: `Referência de ${nomeExame}` }).click();
      const ref = nutri.getByRole('dialog', { name: `Referência de ${nomeExame}` });
      await expect(ref).toContainText('Faixas do consultório');
      await expect(ref).toContainText('Fonte: Laboratório X, 2026');
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`ver referência (detalhe) — ${v}`);
      await nutri.keyboard.press('Escape');

      await nutri.getByRole('button', { name: 'Inserir modelo' }).click();
      const modelo = nutri.getByRole('dialog', { name: 'Inserir modelo' });
      await expect(modelo).toBeVisible();
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`inserir modelo — ${v}`);
      await nutri.keyboard.press('Escape');

      await nutri.goto(`${prontuarioDoDetalhe}/exames`);
      await nutri.getByLabel('Marcador 1', { exact: true }).fill(nomeExame);
      // a linha do formulário (o exame já salvo deste marcador, na lista abaixo, tem o mesmo botão)
      await nutri.getByRole('group', { name: /^Linha 1:/ }).getByRole('button', { name: `Referência de ${nomeExame}` }).click();
      await expect(nutri.getByRole('dialog', { name: `Referência de ${nomeExame}` })).toContainText('Faixas do consultório');
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`ver referência (novo exame) — ${v}`);
      await nutri.keyboard.press('Escape');

      expect(falhas).toEqual([]);
    });
  }
}

test('Nota de interpretação (T5a): Esc do "Ver referência" devolve o foco; salvar anuncia "Nota salva." e leva o foco ao título; apagar', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  await nutri.goto(detalheDoExame);
  const verRef = nutri.getByRole('button', { name: `Referência de ${nomeExame}` });
  await verRef.click();
  await nutri.keyboard.press('Escape');
  await expect(verRef).toBeFocused();

  const campo = nutri.getByRole('textbox', { name: 'Nota de interpretação' });
  await expect(nutri.getByText('Escreva fatores a investigar e encaminhamentos; não afirme doença.')).toBeVisible();
  await expect(nutri.getByText('Não aparece no app; entra na cópia dos dados que o paciente pedir.')).toBeVisible();
  // o limite: a mensagem e o texto digitado continuam no campo
  await campo.fill('x'.repeat(2001));
  await nutri.getByRole('button', { name: 'Salvar nota' }).click();
  await expect(nutri.getByRole('alert').filter({ hasText: 'A nota tem no máximo 2000 caracteres.' })).toBeVisible();
  await expect(campo).toHaveValue('x'.repeat(2001));

  await campo.fill('Investigar a ingestão de ferro.');
  await nutri.getByRole('button', { name: 'Salvar nota' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Nota salva.' })).toBeVisible();
  await expect(nutri.getByRole('heading', { level: 2, name: /^Ferro / })).toBeFocused();
  await expect(campo).toHaveValue('Investigar a ingestão de ferro.');

  await nutri.getByRole('button', { name: 'Apagar nota' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Nota apagada.' })).toBeVisible();
  await expect(campo).toHaveValue('');
  await expect(nutri.getByRole('button', { name: 'Apagar nota' })).toHaveCount(0);
});
