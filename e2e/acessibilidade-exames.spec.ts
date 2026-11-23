import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { emitirReceita, entrarComoDocs } from './documentos';
import { entrarComo } from './helpers';
import { bibliotecasDeExames, contrasteIncerto, escolherTema } from './painel';
import { criarPacientePeloFormulario } from './pacientes-form';
import { pacienteNoPortal } from './portal';

// Plano 22 (T3, EP-D54, R22-22): o axe dos estados de /painel/exames que não são rota (diálogos abertos, formulário com
// erro), nos modos claro e escuro, a 1280 e a 360 px; e o contrato do `Dialogo` (src/components/dialogo.tsx) no navegador
// de verdade: Esc fecha e o foco volta a quem abriu; `ocupado` segura o Esc (também o segundo, que o Chromium não deixa
// cancelar) sem chamar `aoFechar`; e o diálogo desmontado aberto (a action voltou à lista) devolve o foco ao botão que o
// abriu. IPs: 10.9.22.10 (nutri); T12: 10.9.22.11 e .12 (o "Compartilhar" do portal). O catálogo volta como estava (o nome adicionado é excluído no fim).
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

// Plano 22 (T6, US-375, RN-385; revisão da P22-06): "Mostrar no app do paciente" no detalhe do exame — a confirmação
// (`DialogoConfirmar`) aberta, o detalhe liberado (selo "No app", "Retirar do app" e a mensagem na região de status) e a lista
// da aba com o selo, nos modos claro e escuro, a 1280 e a 360 px. O axe do detalhe ainda não liberado já roda no laço da T5a.
// Cada volta libera e retira: o exame termina como estava (fora do app). A paciente do detalhe não tem o app: a mensagem leva
// também a frase de quem ainda não entrou. O cartão do portal com o exame liberado: acessibilidade.spec.ts (conta MULTI).
for (const [modo, tema] of [
  ['claro', 'Claro'],
  ['escuro', 'Escuro'],
] as const) {
  for (const largura of [1280, 360]) {
    test(`axe sem violações em "Mostrar no app do paciente" (confirmação aberta e exame liberado) — modo ${modo}, ${largura} px`, async () => {
      await nutri.setViewportSize({ width: 1280, height: 800 });
      await escolherTema(nutri, tema);
      await nutri.setViewportSize({ width: largura, height: 800 });
      const falhas: string[] = [];

      await nutri.goto(detalheDoExame);
      await nutri.waitForLoadState('networkidle'); // o botão é de um componente do cliente: o clique antes da hidratação se perde
      const mostrar = nutri.getByRole('button', { name: 'Mostrar no app do paciente', exact: true });
      await mostrar.click();
      const confirmar = nutri.getByRole('dialog', { name: 'Mostrar no app do paciente' });
      await expect(confirmar).toContainText('A nota de interpretação, as categorias do consultório e o laudo não aparecem.');
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`confirmação "Mostrar no app" — ${v}`);
      await confirmar.getByRole('button', { name: 'Mostrar no app', exact: true }).click();
      await expect(confirmar).toBeHidden();
      await expect(nutri.getByRole('status').filter({ hasText: 'O exame aparece no app do paciente.' })).toBeVisible();
      await expect(nutri.getByText('No app', { exact: true })).toBeVisible();
      const retirar = nutri.getByRole('button', { name: 'Retirar do app', exact: true });
      await expect(retirar).toBeVisible();
      for (const v of await violacoes(nutri)) falhas.push(`detalhe liberado — ${v}`);

      await nutri.goto(`${prontuarioDoDetalhe}/exames`);
      await expect(nutri.getByText('No app', { exact: true }).first()).toBeVisible(); // o selo na lista da aba
      for (const v of await violacoes(nutri)) falhas.push(`lista da aba com o selo — ${v}`);
      // o "Excluir" do exame no app: o DialogoConfirmar com o aviso (fecha no Esc; nada é excluído)
      await nutri.waitForLoadState('networkidle');
      await nutri.getByRole('button', { name: /^Excluir o exame Ferro / }).click();
      const excluir = nutri.getByRole('alertdialog', { name: /^Excluir o exame Ferro / });
      await expect(excluir).toContainText('Este exame está no app do paciente. Ao excluir, ele some de lá.');
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`excluir exame no app — ${v}`);
      await nutri.keyboard.press('Escape');
      await expect(excluir).toBeHidden();

      // de volta como estava: "Retirar do app" (imediato, sem confirmação)
      await nutri.goto(detalheDoExame);
      await nutri.waitForLoadState('networkidle');
      await retirar.click();
      await expect(nutri.getByRole('status').filter({ hasText: 'O exame saiu do app do paciente.' })).toBeVisible();
      await expect(mostrar).toBeVisible();

      expect(falhas).toEqual([]);
    });
  }
}

// Plano 22 (T12, EP-D54, US-379): o axe dos diálogos da receita, que não são rota — "Carregar modelo" (com a confirmação
// "Substituir os itens" por cima), "Salvar item", "Salvar como modelo" e "Adicionar item salvo" —, nos modos claro e escuro,
// a 1280 e a 360 px. O modelo "Rotina E2E" e os itens salvos "Magnésio E2E" e "Fórmula calmante E2E" vêm da semente; a
// receita é um rascunho com um item, numa paciente nova. Cada diálogo fecha no Esc sem gravar nada.
let receitaDosDialogos: string;

test('receita (T12): rascunho com um item para os diálogos da receita', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  const sufixo = `rc${Date.now().toString(36)}`;
  const prontuario = await criarPacientePeloFormulario(nutri, { nome: `Paciente Receita Dialogos ${sufixo}`, email: `receita-dialogos-${sufixo}@nutridebby.test` });
  await nutri.goto(`${prontuario}/documentos`);
  await nutri.getByRole('button', { name: 'Nova receita' }).click();
  await expect(nutri).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
  receitaDosDialogos = nutri.url();
  await nutri.waitForLoadState('networkidle');
  await nutri.getByRole('button', { name: 'Adicionar item', exact: true }).click();
  await nutri.getByLabel('Componente 1').fill('Vitamina D3');
  await nutri.getByLabel('Quantidade').fill('2000');
  await nutri.getByLabel('Unidade').selectOption('UI');
  await nutri.getByLabel('Forma de apresentação').fill('Cápsula');
  await nutri.getByLabel('Posologia').fill('1 cápsula ao dia');
  await nutri.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();
});

for (const [modo, tema] of [
  ['claro', 'Claro'],
  ['escuro', 'Escuro'],
] as const) {
  for (const largura of [1280, 360]) {
    test(`axe sem violações nos diálogos da receita (Carregar modelo, Salvar item, Salvar como modelo, Adicionar item salvo) — modo ${modo}, ${largura} px`, async () => {
      await nutri.setViewportSize({ width: 1280, height: 800 });
      await escolherTema(nutri, tema);
      await nutri.setViewportSize({ width: largura, height: 800 });
      const falhas: string[] = [];
      await nutri.goto(receitaDosDialogos);
      await nutri.waitForLoadState('networkidle'); // os botões são de componentes do cliente

      const carregar = nutri.getByRole('button', { name: 'Carregar modelo', exact: true });
      await carregar.click();
      const dialogo = nutri.getByRole('dialog', { name: 'Carregar modelo' });
      await expect(dialogo).toContainText('Rotina E2E · 5 itens');
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`carregar modelo — ${v}`);
      await dialogo.getByRole('button', { name: 'Substituir os itens: Rotina E2E', exact: true }).click();
      const confirmar = nutri.getByRole('alertdialog', { name: 'Substituir os itens' });
      await expect(confirmar).toBeVisible(); // o texto com o número de itens: e2e/solicitacao-exames.spec.ts (CS-372)
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`confirmar substituir — ${v}`);
      await nutri.keyboard.press('Escape');
      await expect(confirmar).toBeHidden();
      await nutri.keyboard.press('Escape');
      await expect(dialogo).toBeHidden();
      await expect(carregar).toBeFocused();

      const salvarItem = nutri.getByRole('button', { name: 'Salvar item 1', exact: true });
      await salvarItem.click();
      const nomeDoItem = nutri.getByRole('dialog', { name: 'Salvar item' });
      await expect(nomeDoItem).toContainText('Retire dados do paciente antes de salvar.');
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`salvar item — ${v}`);
      await nutri.keyboard.press('Escape');
      await expect(nomeDoItem).toBeHidden();
      await expect(salvarItem).toBeFocused();

      const salvarModelo = nutri.getByRole('button', { name: 'Salvar como modelo', exact: true });
      await salvarModelo.click();
      const nomeDoModelo = nutri.getByRole('dialog', { name: 'Salvar como modelo' });
      await expect(nomeDoModelo).toContainText('Retire dados do paciente antes de salvar. A justificativa de uso não vai para o modelo.');
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`salvar como modelo — ${v}`);
      await nutri.keyboard.press('Escape');
      await expect(nomeDoModelo).toBeHidden();
      await expect(salvarModelo).toBeFocused();

      const adicionar = nutri.getByRole('button', { name: 'Adicionar item salvo', exact: true });
      await adicionar.click();
      const itensSalvos = nutri.getByRole('dialog', { name: 'Adicionar item salvo' });
      await expect(itensSalvos.getByRole('heading', { name: 'Suplementos' })).toBeVisible();
      await expect(itensSalvos.getByRole('heading', { name: 'Fitoterápicos' })).toBeVisible();
      await expect(itensSalvos.getByRole('button', { name: 'Adicionar Fórmula calmante E2E', exact: true })).toBeVisible();
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`adicionar item salvo — ${v}`);
      await nutri.keyboard.press('Escape');
      await expect(itensSalvos).toBeHidden();
      await expect(adicionar).toBeFocused();

      // nada mudou: o rascunho continua com o item dele
      await expect(nutri.getByRole('group', { name: /^Item \d+: / })).toHaveCount(1);
      expect(falhas).toEqual([]);
    });
  }
}

// Plano 22 (T12, Minor da T8): o axe do editor da solicitação de exames nos modos claro e escuro, a 1280 e a 360 px, com
// exames do modelo "Check-up E2E" da semente, um nome longo sem espaço fora do catálogo (a quebra de palavra) e a
// confirmação "Substituir" aberta. A página da solicitação assinada passa pelo axe no e2e/solicitacao-exames.spec.ts.
let solicitacaoDoAxe: string;

test('solicitação (T12): rascunho com exames do modelo e um nome longo, para o axe do editor', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  const sufixo = `sl${Date.now().toString(36)}`;
  const prontuario = await criarPacientePeloFormulario(nutri, { nome: `Paciente Solicitacao Axe ${sufixo}`, email: `solicitacao-axe-${sufixo}@nutridebby.test` });
  await nutri.goto(`${prontuario}/documentos`);
  await nutri.getByRole('button', { name: 'Nova solicitação de exames' }).click();
  await expect(nutri).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
  solicitacaoDoAxe = nutri.url();
  await nutri.waitForLoadState('networkidle');
  await nutri.getByRole('button', { name: 'Carregar modelo', exact: true }).click();
  await nutri.getByRole('dialog', { name: 'Carregar modelo' }).getByRole('button', { name: 'Acrescentar Check-up E2E' }).click();
  await nutri.getByLabel('Adicionar exame fora do catálogo').fill('Pesquisadeanticorposantitransglutaminaseiga');
  await nutri.keyboard.press('Enter');
  await nutri.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();
});

for (const [modo, tema] of [
  ['claro', 'Claro'],
  ['escuro', 'Escuro'],
] as const) {
  for (const largura of [1280, 360]) {
    test(`axe sem violações no editor da solicitação e na confirmação "Substituir" — modo ${modo}, ${largura} px`, async () => {
      await nutri.setViewportSize({ width: 1280, height: 800 });
      await escolherTema(nutri, tema);
      await nutri.setViewportSize({ width: largura, height: 800 });
      const falhas: string[] = [];
      await nutri.goto(solicitacaoDoAxe);
      await nutri.waitForLoadState('networkidle');
      await expect(nutri.getByRole('button', { name: 'Remover Pesquisadeanticorposantitransglutaminaseiga' })).toBeVisible();
      for (const v of await violacoes(nutri)) falhas.push(`editor da solicitação — ${v}`);
      expect(await nutri.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `sem rolagem lateral: ${modo}, ${largura} px`).toBe(true);

      const carregar = nutri.getByRole('button', { name: 'Carregar modelo', exact: true });
      await carregar.click();
      const dialogo = nutri.getByRole('dialog', { name: 'Carregar modelo' });
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`carregar modelo (solicitação) — ${v}`);
      await dialogo.getByRole('button', { name: 'Substituir por Check-up E2E' }).click();
      const confirmar = nutri.getByRole('alertdialog', { name: 'Substituir' });
      await expect(confirmar).toBeVisible();
      for (const v of await violacoes(nutri, 'dialog[open]')) falhas.push(`confirmar substituir (solicitação) — ${v}`);
      await nutri.keyboard.press('Escape');
      await expect(confirmar).toBeHidden();
      await nutri.keyboard.press('Escape');
      await expect(dialogo).toBeHidden();
      expect(falhas).toEqual([]);
    });
  }
}

// Plano 22 (T12, EP-D54, US-380): o "Compartilhar" pronto no portal (depois de "Preparar para compartilhar"), estado que
// não é rota: aparelho claro e escuro, a 1280 e a 360 px. A receita é assinada pela E2E_DOCS (o 2FA); o portal segue o
// aparelho (data-tema="sistema"). IPs: nutricionista 10.9.22.11, paciente 10.9.22.12.
test('axe sem violações no "Compartilhar" pronto do portal, aparelho claro e escuro, 1280 e 360 px', async ({ browser }) => {
  test.setTimeout(300_000);
  const docs = await entrarComoDocs(browser, '10.9.22.11');
  const p = await pacienteNoPortal(browser, docs, '10.9.22.12');
  try {
    await emitirReceita(docs, p.prontuario);
    const page = p.page;
    const falhas: string[] = [];
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const largura of [1280, 360]) {
        await page.emulateMedia({ colorScheme });
        await page.setViewportSize({ width: largura, height: 800 });
        await page.goto('/p/documentos');
        await page.waitForLoadState('networkidle');
        await page.getByRole('button', { name: /^Preparar para compartilhar a receita de \d{2}\/\d{2}\/\d{4}$/ }).click();
        await expect(page.getByRole('button', { name: /^Compartilhar a receita de \d{2}\/\d{2}\/\d{4}$/ })).toBeFocused();
        await expect(page.getByRole('status').filter({ hasText: 'PDF pronto. Toque em Compartilhar.' })).toBeVisible();
        for (const v of await violacoes(page)) falhas.push(`compartilhar pronto (${colorScheme}, ${largura} px) — ${v}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${colorScheme}, ${largura} px`).toBe(true);
      }
    }
    expect(falhas).toEqual([]);
  } finally {
    await p.page.context().close();
    await docs.context().close();
  }
});
