import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { criarPacientePeloFormulario } from './pacientes-form';
import { irPeloMenu } from './painel';

/**
 * Plano 26, PR 1 — Relatórios (US-480 a US-487): o item do menu, o período (filtro e troca de aba mantendo o filtro), o
 * CSV baixado e lido, a versão para imprimir e o Ranking com o link para a ficha. Na nutricionista compartilhada do E2E:
 * as asserções valem só para o que esta execução cria (nunca para os totais do consultório). O tema não muda aqui.
 * IPs (limite de login por IP): bloco 10.9.36.x (RE-D50) — 10.9.36.1 aqui; .2 a .9 ficam para os Relatórios.
 */
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' }; // copiada: importar o seed roda o seed
const FUSO = 'America/Sao_Paulo'; // o fuso padrão do consultório (tenants.fuso)
test.describe.configure({ mode: 'serial', retries: 0 });

let nutri: Page;
const sufixo = Date.now().toString(36);
const paciente = { nome: `Aaa Relatórios ${sufixo}`, email: `rel-${sufixo}@nutridebby.test` };

/** O dia ('AAAA-MM-DD') de um instante no fuso do consultório. */
const diaNoFuso = (instante: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(instante);
/** O mês 'AAAA-MM' `n` meses antes do mês de hoje no fuso. */
function mesAntes(n: number): string {
  const [a, m] = diaNoFuso(new Date()).split('-').map(Number);
  const i = a * 12 + (m - 1) - n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
const ATUAL = mesAntes(0);
const DE = mesAntes(2);

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.36.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('menu "Relatórios" → Pacientes; o período escolhido continua ao trocar de aba (US-486)', async () => {
  await irPeloMenu(nutri, 'Relatórios');
  await expect(nutri.getByRole('heading', { level: 1, name: 'Relatórios' })).toBeVisible();
  const abas = nutri.getByRole('navigation', { name: 'Seções dos relatórios' });
  await expect(abas.getByRole('link')).toHaveText(['Pacientes', 'Atendimentos', 'Planos alimentares', 'Agenda', 'Financeiro', 'Ranking']);
  await expect(abas.getByRole('link', { name: 'Pacientes' })).toHaveAttribute('aria-current', 'page');
  await expect(nutri.getByRole('heading', { level: 2, name: 'Pacientes' })).toBeVisible();

  await nutri.getByLabel('De', { exact: true }).selectOption(DE);
  await nutri.getByLabel('Até', { exact: true }).selectOption(ATUAL);
  await nutri.getByRole('button', { name: 'Aplicar' }).click();
  await expect(nutri).toHaveURL(new RegExp(`/painel/relatorios\\?de=${DE}&ate=${ATUAL}$`));

  await abas.getByRole('link', { name: 'Agenda' }).click();
  await expect(nutri).toHaveURL(new RegExp(`/painel/relatorios/agenda\\?de=${DE}&ate=${ATUAL}$`));
  await expect(abas.getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page');
  await expect(nutri.getByLabel('De', { exact: true })).toHaveValue(DE);
  await expect(nutri.getByLabel('Até', { exact: true })).toHaveValue(ATUAL);
  await expect(nutri.getByRole('columnheader', { name: 'Taxa de faltas' })).toBeVisible();
});

test('período inválido: o erro junto do "De", com o foco no aviso, e os números do padrão (RN-481)', async () => {
  await nutri.goto(`/painel/relatorios/agenda?de=${ATUAL}&ate=${DE}`);
  await expect(nutri.getByLabel('De', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(nutri.getByText('O mês inicial não pode ser depois do final.')).toBeFocused();
  await expect(nutri.getByText(/^Mostrando .+ de \d{4} a .+ de \d{4}\.$/)).toBeVisible();
  await expect(nutri.getByLabel('De', { exact: true })).toHaveValue(ATUAL);
});

test('"Baixar CSV" da Agenda: o arquivo da RN-494 (BOM, ";", CRLF) com o período escolhido (US-487)', async () => {
  await nutri.goto(`/painel/relatorios/agenda?de=${DE}&ate=${ATUAL}`);
  const [download] = await Promise.all([nutri.waitForEvent('download'), nutri.getByRole('link', { name: 'Baixar CSV' }).click()]);
  expect(download.suggestedFilename()).toBe(`relatorio-agenda-${DE}-a-${ATUAL}.csv`);
  const bytes = await readFile((await download.path())!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const texto = bytes.subarray(3).toString('utf8');
  expect(texto.endsWith('\r\n')).toBe(true);
  const linhas = texto.split('\r\n').slice(0, -1);
  expect(linhas[0]).toBe('Mês;Marcadas;Realizadas;Faltas;Taxa de faltas;Canceladas pelo paciente;Canceladas pelo consultório;Marcadas pelo paciente;Retornos');
  expect(linhas.slice(1).map((l) => l.split(';')[0])).toEqual([DE, mesAntes(1), ATUAL].map((m) => `${m.slice(5)}/${m.slice(0, 4)}`));
  await expect(nutri).toHaveURL(/\/painel\/relatorios\/agenda/); // a página fica
});

test('"Ver versão para imprimir": cabeçalho, título da aba, rodapé e "Voltar aos relatórios" (RN-495)', async () => {
  await nutri.goto(`/painel/relatorios/agenda?de=${DE}&ate=${ATUAL}`);
  await nutri.getByRole('link', { name: 'Ver versão para imprimir' }).click();
  await expect(nutri.getByRole('heading', { level: 1, name: 'Relatório de Agenda' })).toBeVisible();
  await expect(nutri).toHaveTitle(/^Relatório de Agenda — .+/);
  await expect(nutri.getByText(`Período: ${DE.slice(5)}/${DE.slice(0, 4)} a ${ATUAL.slice(5)}/${ATUAL.slice(0, 4)}`)).toBeVisible();
  await expect(nutri.getByText('Local: Todos')).toBeVisible();
  await expect(nutri.getByText(/^Gerado em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}$/)).toBeVisible();
  await expect(nutri.getByText('Documento interno do consultório, com dados de pacientes. Guarde com sigilo.')).toBeVisible();
  await expect(nutri.getByRole('button', { name: 'Imprimir ou salvar em PDF' })).toBeVisible();
  // na impressão, os botões e o menu somem; as tabelas ficam
  await nutri.emulateMedia({ media: 'print' });
  await expect(nutri.getByRole('button', { name: 'Imprimir ou salvar em PDF' })).toBeHidden();
  await expect(nutri.getByRole('navigation', { name: 'Menu do painel' })).toBeHidden();
  await expect(nutri.getByRole('columnheader', { name: 'Taxa de faltas' })).toBeVisible();
  await nutri.emulateMedia({ media: 'screen' });
  await nutri.getByRole('link', { name: 'Voltar aos relatórios' }).click();
  await expect(nutri).toHaveURL(new RegExp(`/painel/relatorios/agenda\\?de=${DE}&ate=${ATUAL}$`));
});

test('Ranking: o aviso, "Maior receita" e cada nome com link para a ficha (US-485)', async () => {
  test.setTimeout(120_000);
  // uma consulta realizada ontem, num horário sorteado de madrugada (o consultório é compartilhado: sem colisão com as
  // outras specs, e um novo sorteio se a agenda recusar)
  await criarPacientePeloFormulario(nutri, paciente);
  const ontem = diaNoFuso(new Date(Date.now() - 86_400_000));
  let marcada = false;
  for (let tentativa = 0; tentativa < 5 && !marcada; tentativa++) {
    const minutos = 60 + Math.floor(Math.random() * 240);
    await nutri.goto(`/painel/agenda/nova?data=${ontem}`);
    await nutri.getByLabel('Paciente').selectOption({ label: `${paciente.nome} (${paciente.email})` });
    await nutri.getByLabel('Hora').fill(`${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`);
    await nutri.getByLabel('Duração').selectOption('15');
    await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
    marcada = await nutri
      .getByRole('status')
      .filter({ hasText: 'Consulta marcada.' })
      .waitFor({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
  }
  expect(marcada, 'a consulta de ontem foi marcada').toBe(true);
  await nutri.getByRole('button', { name: 'Realizada' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Presença registrada.' })).toBeVisible();

  await nutri.goto('/painel/relatorios/ranking');
  await expect(nutri.getByRole('heading', { level: 2, name: 'Ranking de pacientes' })).toBeVisible();
  await expect(nutri.getByText("Lista com nomes de pacientes. Ao exportar, cada paciente da lista registra 'Exportou — Relatórios' no Histórico de acessos.")).toBeVisible();
  const criterio = nutri.getByRole('navigation', { name: 'Ranking de pacientes' });
  await expect(criterio.getByRole('link', { name: 'Mais consultas' })).toHaveAttribute('aria-current', 'page');
  const tabela = nutri.getByRole('table', { name: 'Pacientes com mais consultas realizadas' });
  const nomes = tabela.getByRole('rowheader').getByRole('link');
  expect(await nomes.count()).toBeGreaterThan(0);
  for (const href of await nomes.evaluateAll((as) => as.map((a) => a.getAttribute('href')))) expect(href).toMatch(/^\/painel\/pacientes\/[0-9a-f-]{36}$/);
  await nomes.first().click();
  await expect(nutri).toHaveURL(/\/painel\/pacientes\/[0-9a-f-]{36}$/);

  await nutri.goto('/painel/relatorios/ranking');
  await criterio.getByRole('link', { name: 'Maior receita' }).click();
  await expect(nutri).toHaveURL(/\/painel\/relatorios\/ranking\?por=receita$/);
  await expect(nutri.getByRole('heading', { level: 3, name: 'Pacientes com maior receita recebida' })).toBeVisible();
  await expect(criterio.getByRole('link', { name: 'Maior receita' })).toHaveAttribute('aria-current', 'page');
});
