import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { criarPacientePeloFormulario } from './pacientes-form';

// Plano 22 (T5b, CS-371, US-371, US-372, US-373, US-374): o caminho da nutricionista na aba Exames — "Adicionar do
// catálogo" com o painel "Hemograma completo" da semente (20 componentes, cada um com a unidade do catálogo) monta as 20
// linhas com nome e unidade; a faixa copiada do laudo mostra a classificação neutra **antes de salvar**; salvar, abrir o
// detalhe (a classificação na tabela), escrever e salvar a nota de interpretação; lançar um segundo exame, marcar os dois
// e abrir o comparativo (a mais antiga à esquerda, a neutra por célula, a leitura registrada no Histórico de acessos).
// IPs: 10.9.22.20 (nutri). Um paciente novo por execução (nada da semente muda).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial', timeout: 180_000 });
let nutri: Page;
let prontuario: string;
let sufixo: string;

/** Os 20 componentes do painel da semente, na ordem do catálogo (`scripts/e2e-seed.ts`). */
const COMPONENTES: [string, string][] = [
  ['Hemácias', 'milhões/µL'],
  ['Hemoglobina', 'g/dL'],
  ['Hematócrito', '%'],
  ['VCM', 'fL'],
  ['HCM', 'pg'],
  ['CHCM', 'g/dL'],
  ['RDW', '%'],
  ['Leucócitos', '/µL'],
  ['Promielócitos', '/µL'],
  ['Mielócitos', '/µL'],
  ['Metamielócitos', '/µL'],
  ['Bastonetes', '/µL'],
  ['Segmentados', '/µL'],
  ['Neutrófilos', '/µL'],
  ['Eosinófilos', '/µL'],
  ['Basófilos', '/µL'],
  ['Linfócitos', '/µL'],
  ['Monócitos', '/µL'],
  ['Plaquetas', '/µL'],
  ['VPM', 'fL'],
];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.22.20');
  await expect(nutri).toHaveURL(/\/painel$/);
  sufixo = `ex${Date.now().toString(36)}`;
  prontuario = await criarPacientePeloFormulario(nutri, { nome: `Paciente Exames ${sufixo}`, email: `exames-${sufixo}@nutridebby.test` });
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('CS-371: hemograma de 20 linhas pelo painel do catálogo, classificação antes de salvar, detalhe e nota', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  await nutri.goto(`${prontuario}/exames`);
  await nutri.getByLabel('Título do exame').fill(`Hemograma ${sufixo}`);
  await nutri.getByRole('button', { name: 'Adicionar do catálogo' }).click();
  const dialogo = nutri.getByRole('dialog', { name: 'Buscar no catálogo' });
  await dialogo.getByRole('searchbox', { name: 'Buscar no catálogo' }).fill('Hemograma completo');
  await dialogo.getByLabel('Hemograma completo').check();
  await dialogo.getByRole('button', { name: 'Adicionar 1 exame' }).click();
  await expect(dialogo).toBeHidden();

  // as 20 linhas, cada uma com o nome e a unidade do catálogo (a linha vazia do começo sai)
  await expect(nutri.getByRole('group', { name: /^Linha \d+:/ })).toHaveCount(20);
  for (const [i, [nome, unidade]] of COMPONENTES.entries()) {
    await expect(nutri.getByLabel(`Marcador ${i + 1}`, { exact: true })).toHaveValue(nome);
    await expect(nutri.getByLabel(`Unidade ${i + 1}`, { exact: true })).toHaveValue(unidade);
    await nutri.getByLabel(`Valor ${i + 1}`, { exact: true }).fill(String(i + 1));
  }

  // a faixa do laudo numa linha: a classificação neutra aparece antes de salvar
  await nutri.getByLabel('Valor 2', { exact: true }).fill('17,2');
  await nutri.getByLabel('Faixa do laudo: de 2', { exact: true }).fill('12');
  await nutri.getByLabel('até 2', { exact: true }).fill('16');
  await expect(nutri.getByRole('group', { name: 'Linha 2: Hemoglobina' })).toContainText('Acima da referência');
  await expect(nutri.getByText('Classificação automática pela faixa de referência informada. Não é diagnóstico.').first()).toBeVisible();

  await nutri.getByRole('button', { name: 'Salvar exame' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Exame salvo.' })).toBeVisible();

  // a lista classifica a linha (texto, não só cor) e abre o detalhe
  const cartao = nutri.getByRole('article', { name: new RegExp(`^Hemograma ${sufixo}`) });
  await expect(cartao.getByRole('row', { name: /^Hemoglobina/ })).toContainText('Acima da referência');
  await cartao.getByRole('link', { name: new RegExp(`^Abrir Hemograma ${sufixo} de `) }).click();
  await expect(nutri.getByRole('heading', { level: 2, name: new RegExp(`^Hemograma ${sufixo} — `) })).toBeVisible();
  await expect(nutri.getByRole('row', { name: /^Hemoglobina/ })).toContainText('Acima da referência');
  await expect(nutri.getByRole('rowheader')).toHaveCount(20);

  // a nota de interpretação
  const campo = nutri.getByLabel('Nota de interpretação', { exact: true });
  await campo.fill('Investigar hidratação e repetir o hemograma no retorno.');
  await nutri.getByRole('button', { name: 'Salvar nota' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Nota salva.' })).toBeVisible();
  await expect(campo).toHaveValue('Investigar hidratação e repetir o hemograma no retorno.');
});

test('US-374: marcar 2 exames e abrir o comparativo; fora de 2 a 6 o botão fica desabilitado', async () => {
  await nutri.setViewportSize({ width: 1280, height: 800 });
  // um segundo exame, mais antigo, com a mesma hemoglobina dentro da faixa
  await nutri.goto(`${prontuario}/exames`);
  await nutri.getByLabel('Título do exame').fill(`Anterior ${sufixo}`);
  await nutri.getByLabel('Data do exame').fill('2026-01-15');
  await nutri.getByLabel('Marcador 1', { exact: true }).fill('Hemoglobina');
  await nutri.getByLabel('Valor 1', { exact: true }).fill('13,5');
  await nutri.getByLabel('Unidade 1', { exact: true }).fill('g/dL');
  await nutri.getByLabel('Faixa do laudo: de 1', { exact: true }).fill('12');
  await nutri.getByLabel('até 1', { exact: true }).fill('16');
  await nutri.getByRole('button', { name: 'Salvar exame' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Exame salvo.' })).toBeVisible();

  const botao = nutri.getByRole('button', { name: /^Comparar \d+ exames$/ });
  await expect(botao).toHaveText('Comparar 0 exames');
  await expect(botao).toHaveAttribute('aria-disabled', 'true');
  await expect(botao).toHaveAccessibleDescription('Escolha de 2 a 6 exames para comparar.');

  await nutri.getByRole('checkbox', { name: new RegExp(`^Comparar Hemograma ${sufixo} de `) }).check();
  await expect(botao).toHaveText('Comparar 1 exames');
  await expect(botao).toHaveAttribute('aria-disabled', 'true');
  await botao.click(); // desabilitado: não sai da aba
  await expect(nutri).toHaveURL(new RegExp(`${prontuario}/exames$`));

  await nutri.getByRole('checkbox', { name: new RegExp(`^Comparar Anterior ${sufixo} de 15/01/2026$`) }).check();
  await expect(botao).toHaveText('Comparar 2 exames');
  await expect(botao).not.toHaveAttribute('aria-disabled', 'true');
  await botao.click();

  await expect(nutri).toHaveURL(/\/exames\/comparativo\?/);
  await expect(nutri.getByRole('heading', { level: 2, name: 'Comparativo de exames' })).toBeVisible();
  const tabela = nutri.getByRole('table', { name: 'Resultados por data' });
  const colunas = tabela.getByRole('columnheader');
  await expect(colunas).toHaveCount(3);
  await expect(colunas.nth(0)).toHaveText('Marcador');
  await expect(colunas.nth(1)).toContainText('15/01/2026'); // a mais antiga à esquerda
  await expect(colunas.nth(2)).toContainText(`Hemograma ${sufixo}`);
  const hemoglobina = tabela.getByRole('row', { name: /^Hemoglobina \(g\/dL\)/ });
  await expect(hemoglobina).toContainText('13,5 g/dL');
  await expect(hemoglobina).toContainText('Dentro da referência');
  await expect(hemoglobina).toContainText('17,2 g/dL');
  await expect(hemoglobina).toContainText('Acima da referência');
  // "—" onde o exame anterior não tem o marcador
  await expect(tabela.getByRole('row', { name: /^Plaquetas/ }).getByRole('cell').first()).toHaveText('—');
  // sem nota e sem categoria do consultório (RN-384)
  await expect(nutri.getByText('Investigar hidratação')).toHaveCount(0);
  await expect(nutri.getByText('(faixa do consultório)')).toHaveCount(0);

  // a leitura registrada no Histórico de acessos (Exames)
  await nutri.goto(`${prontuario}/historico`);
  await expect(nutri.getByRole('cell', { name: 'Exames' }).first()).toBeVisible();

  // a URL com 1 id mostra a frase de apoio, sem tabela
  await nutri.goto(`${prontuario}/exames/comparativo?ids=00000000-0000-4000-8000-000000000000`);
  await expect(nutri.getByText('Escolha de 2 a 6 exames para comparar.')).toBeVisible();
  await expect(nutri.getByRole('table')).toHaveCount(0);
  await nutri.getByRole('link', { name: 'Voltar aos exames' }).click();
  await expect(nutri).toHaveURL(new RegExp(`${prontuario}/exames$`));
});
