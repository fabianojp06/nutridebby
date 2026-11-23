import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { criarPacientePeloFormulario } from './pacientes-form';

/**
 * Plano 23 (US-400, US-404 a US-406): a agenda em Semana (grade de horas, filtro de local, "Mostrar 24 horas", "Ir para
 * data", aniversário), em Mês (contagem, "mais {n}", dia → visão Dia, lista a 360 px), a impressão e os locais (criar e
 * arquivar). Bloco de IP do Plano 23: 10.9.23.1–.9 (AG-D56). Os locais são os da semente (AG-D59: "Consultório E2E"
 * principal, "Clínica Centro E2E" e "Videoconferência E2E"). Nenhuma regra de horário é criada aqui (o agenda.spec cria as
 * dele e conferiria uma sobreposição): as consultas são marcadas pela Nova consulta, daqui a ~120 dias e antes das 09h, longe
 * das datas e horas do agenda.spec (o EXCLUDE vale para o consultório inteiro, e os dois arquivos podem rodar juntos).
 */
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
// Serial: cada teste usa o que o anterior criou; sem nova tentativa (a segunda colidiria com as consultas da primeira)
test.describe.configure({ mode: 'serial', retries: 0 });
let nutri: Page;

/** 'AAAA-MM-DD' da segunda-feira a partir de hoje + `dias` (como no agenda.spec). */
function segundaDepoisDe(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}
const somar = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const br = (iso: string) => iso.split('-').reverse().join('/');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const SEGUNDA = segundaDepoisDe(120);
const TERCA = somar(SEGUNDA, 1);
const QUARTA = somar(SEGUNDA, 2);
const sufixo = Date.now().toString(36);
const LIA = { nome: `Lia Visoes ${sufixo}`, email: `lia-visoes-${sufixo}@ex.com` };
const RUI = { nome: `Rui Visoes ${sufixo}`, email: `rui-visoes-${sufixo}@ex.com` };
/** Lia faz aniversário na quarta da semana (RN-414; 29/02 cai num ano bissexto, para a data existir). */
const NASCIMENTO_LIA = `${QUARTA.slice(5) === '02-29' ? '1992' : '1990'}-${QUARTA.slice(5)}`;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.23.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

async function marcar(p: { nome: string; email: string }, data: string, hora: string, duracao: string, local: string): Promise<void> {
  await nutri.goto(`/painel/agenda/nova?data=${data}`);
  await nutri.getByLabel('Paciente').selectOption({ label: `${p.nome} (${p.email})` });
  await nutri.getByLabel('Hora').fill(hora);
  await nutri.getByLabel('Duração').selectOption(duracao);
  await nutri.getByLabel('Local', { exact: true }).selectOption({ label: local });
  await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible();
}

test('Semana em grade: filtro de local, "Próximo" mantém o filtro, 24 horas, "Ir para data", aniversário e legenda (US-404, US-405)', async () => {
  test.setTimeout(120_000);
  await criarPacientePeloFormulario(nutri, { ...LIA, nascimento: NASCIMENTO_LIA });
  await criarPacientePeloFormulario(nutri, RUI);
  await marcar(LIA, SEGUNDA, '07:40', '45', 'Clínica Centro E2E (Presencial)');
  await marcar(RUI, TERCA, '07:00', '90', 'Consultório E2E (Presencial)');

  await nutri.goto(`/painel/agenda?visao=semana&data=${SEGUNDA}`);
  await expect(nutri.getByRole('navigation', { name: 'Seções da agenda' }).getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page');
  const grade = nutri.getByTestId('agenda-grade');
  await expect(grade).toBeVisible();
  await expect(nutri.getByTestId('agenda-lista-dias')).toBeHidden();
  // cada consulta uma vez, na linha da hora em que começa; o link é nomeado pelo conteúdo visível (US-404)
  await expect(grade.getByRole('link', { name: new RegExp(`07:40–08:25 ${LIA.nome} Primeira consulta · Clínica Centro E2E`) })).toBeVisible();
  await expect(grade.getByRole('link', { name: new RegExp(`07:00 \\(até 08:30\\) ${RUI.nome}`) })).toHaveCount(1);
  await expect(grade.getByRole('row', { name: /^07h/ }).getByRole('link', { name: new RegExp(LIA.nome) })).toBeVisible();

  // filtro de local (formulário GET): só a consulta da Clínica; "Próximo" e "Anterior" mantêm o filtro
  await nutri.getByLabel('Local', { exact: true }).selectOption({ label: 'Clínica Centro E2E' });
  await nutri.getByRole('button', { name: 'Filtrar' }).click();
  await expect(nutri).toHaveURL(/[?&]local=[0-9a-f-]{36}/);
  const local = new URL(nutri.url()).searchParams.get('local')!;
  await expect(grade.getByRole('link', { name: new RegExp(LIA.nome) })).toBeVisible();
  await expect(grade.getByRole('link', { name: new RegExp(RUI.nome) })).toHaveCount(0);
  await nutri.getByRole('navigation', { name: 'Período da agenda' }).getByRole('link', { name: 'Próximo' }).click();
  await expect(nutri).toHaveURL(new RegExp(`data=${somar(SEGUNDA, 7)}&local=${local}`));
  await nutri.getByRole('navigation', { name: 'Período da agenda' }).getByRole('link', { name: 'Anterior' }).click();
  await expect(nutri).toHaveURL(new RegExp(`data=${SEGUNDA}&local=${local}`));

  // "Mostrar 24 horas" e "Aniversários": a grade vai de 00h a 23h; "Aniversário: {nome}" na quarta, sem idade
  await nutri.getByLabel('Mostrar 24 horas').check();
  await nutri.getByLabel('Aniversários').check();
  await nutri.getByRole('button', { name: 'Filtrar' }).click();
  await expect(nutri).toHaveURL(/horas=24/);
  await expect(nutri).toHaveURL(/aniversario=1/);
  await expect(grade.getByRole('rowheader', { name: '00h', exact: true })).toBeVisible();
  await expect(grade.getByRole('rowheader', { name: '23h', exact: true })).toBeVisible();
  await expect(grade.getByText(`Aniversário: ${LIA.nome}`, { exact: true })).toBeVisible();

  // "Ir para data" sem JavaScript: a visão e os filtros de antes continuam
  await nutri.getByLabel('Ir para data').fill(TERCA);
  await nutri.getByRole('button', { name: 'Ir para a data' }).click();
  await expect(nutri).toHaveURL(new RegExp(`data=${TERCA}`));
  expect(Object.fromEntries(new URL(nutri.url()).searchParams)).toEqual({ visao: 'semana', data: TERCA, local, horas: '24', aniversario: '1' });

  // filtro por paciente: só as consultas dele (sem "Visualizou" no Histórico: provado no visoes.test.ts, AG-D30)
  await nutri.getByLabel('Local', { exact: true }).selectOption({ label: 'Todos os locais' });
  await nutri.getByLabel('Paciente', { exact: true }).selectOption({ label: RUI.nome });
  await nutri.getByRole('button', { name: 'Filtrar' }).click();
  await expect(grade.getByRole('link', { name: new RegExp(RUI.nome) })).toBeVisible();
  await expect(grade.getByRole('link', { name: new RegExp(LIA.nome) })).toHaveCount(0);

  // legenda em texto; sem o marcador de previsão de retorno no PR 2 (AG-D73)
  const legenda = nutri.getByRole('region', { name: 'Legenda' });
  for (const r of ['Primeira consulta', 'Retorno', 'Pedido a responder', 'Presença a registrar', 'Bloqueio', 'Aniversário']) {
    await expect(legenda.getByText(r, { exact: true })).toBeVisible();
  }
  await expect(nutri.getByText('Previsões de retorno')).toHaveCount(0);
  await nutri.getByRole('link', { name: 'Limpar filtros' }).click();
  await expect(nutri).toHaveURL(new RegExp(`/painel/agenda\\?visao=semana&data=${TERCA}$`));
});

test('Mês: contagem, até 3 nomes e "mais {n}"; o dia abre a visão Dia; a 360 px, lista por dia sem rolagem lateral (US-404)', async () => {
  test.setTimeout(120_000);
  for (const hora of ['06:00', '06:15', '06:30', '06:45']) await marcar(LIA, QUARTA, hora, '15', 'Consultório E2E (Presencial)');
  await nutri.goto(`/painel/agenda?visao=mes&data=${QUARTA}`);
  const mes = nutri.getByTestId('agenda-mes');
  await expect(nutri.getByRole('table', { name: `${MESES[Number(QUARTA.slice(5, 7)) - 1]} de ${QUARTA.slice(0, 4)}` })).toBeVisible();
  const celula = mes.getByRole('cell').filter({ has: nutri.getByRole('link', { name: new RegExp(`^${Number(QUARTA.slice(8))} `) }) });
  await expect(celula.getByText('4 consultas')).toBeVisible();
  await expect(celula.getByText('mais 1')).toBeVisible();
  await celula.getByRole('link', { name: new RegExp(`^${Number(QUARTA.slice(8))} `) }).click();
  await expect(nutri).toHaveURL(new RegExp(`visao=dia&data=${QUARTA}`));
  await expect(nutri.getByTestId('agenda-grade').getByRole('link', { name: new RegExp(`06:45–07:00 ${LIA.nome}`) })).toBeVisible();

  await nutri.setViewportSize({ width: 360, height: 780 });
  try {
    await nutri.goto(`/painel/agenda?visao=mes&data=${QUARTA}`);
    await expect(nutri.getByTestId('agenda-mes')).toBeHidden();
    const lista = nutri.getByTestId('agenda-mes-lista');
    await expect(lista.getByRole('heading', { name: new RegExp(`${br(QUARTA).slice(0, 5)}$`) })).toBeVisible();
    expect(await nutri.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await nutri.goto(`/painel/agenda?visao=semana&data=${SEGUNDA}`);
    await expect(nutri.getByTestId('agenda-grade')).toBeHidden();
    await expect(nutri.getByTestId('agenda-lista-dias').getByRole('heading', { name: new RegExp(`${br(SEGUNDA).slice(0, 5)}$`) })).toBeVisible();
    expect(await nutri.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await nutri.setViewportSize({ width: 1280, height: 720 });
  }
});

test('impressão: mesmos filtros, só os campos da RN-418, rodapé e Cache-Control: no-store; no papel, sem os botões (US-406)', async () => {
  await nutri.goto(`/painel/agenda?visao=semana&data=${SEGUNDA}&aniversario=1`);
  await nutri.getByLabel('Local', { exact: true }).selectOption({ label: 'Clínica Centro E2E' });
  await nutri.getByRole('button', { name: 'Filtrar' }).click();
  await nutri.getByRole('link', { name: 'Imprimir ou salvar em PDF' }).click();
  await expect(nutri).toHaveURL(/\/painel\/agenda\/imprimir\?visao=semana&data=.+&local=[0-9a-f-]{36}&aniversario=1$/);
  // a navegação pelo link é do roteador do cliente; a carga do documento mostra o cabeçalho da regra do next.config (AG-D71)
  const resposta = await nutri.goto(nutri.url());
  expect(resposta?.headers()['cache-control']).toContain('no-store');
  await expect(nutri.getByRole('heading', { level: 1, name: `Agenda de ${br(SEGUNDA)} a ${br(somar(SEGUNDA, 6))}` })).toBeVisible();
  await expect(nutri.getByText('Local: Clínica Centro E2E', { exact: true })).toBeVisible();
  const linha = nutri.getByRole('row', { name: new RegExp(LIA.nome) });
  await expect(linha).toHaveText(new RegExp(`07:40–08:25.*${LIA.nome}.*Primeira consulta.*Clínica Centro E2E.*Presencial.*Agendada`));
  await expect(nutri.getByText(RUI.nome)).toHaveCount(0); // outro local
  await expect(nutri.getByText('Contém dados pessoais de pacientes. Uso restrito do consultório.')).toBeVisible();
  // nada de contato, link nem aniversário (RN-418), mesmo com aniversario=1 na URL
  await expect(nutri.getByText(LIA.email)).toHaveCount(0);
  await expect(nutri.getByText(/Aniversário/)).toHaveCount(0);
  await expect(nutri.getByRole('button', { name: 'Imprimir ou salvar em PDF' })).toBeVisible();
  await nutri.emulateMedia({ media: 'print' });
  try {
    await expect(nutri.getByRole('button', { name: 'Imprimir ou salvar em PDF' })).toBeHidden();
    await expect(nutri.getByRole('link', { name: 'Voltar à agenda' })).toBeHidden();
    await expect(nutri.getByRole('heading', { level: 1 })).toBeVisible();
  } finally {
    await nutri.emulateMedia({ media: 'screen' });
  }
  await nutri.getByRole('link', { name: 'Voltar à agenda' }).click();
  await expect(nutri).toHaveURL(new RegExp(`/painel/agenda\\?visao=semana&data=${SEGUNDA}&local=`));
});

test('locais: criar, arquivar e reativar (US-400)', async () => {
  const nome = `Sala E2E ${sufixo}`;
  await nutri.goto('/painel/agenda/locais');
  await nutri.getByRole('link', { name: 'Novo local' }).click();
  await nutri.getByRole('group', { name: 'Tipo' }).getByLabel('Presencial').check();
  await nutri.getByLabel('Nome do local').fill(nome);
  await nutri.getByLabel('Endereço', { exact: true }).fill('Rua da Sala E2E, 1');
  await nutri.getByLabel('Cidade').fill('Recife');
  await nutri.getByRole('button', { name: 'Salvar local' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Local salvo.' })).toBeVisible();
  await nutri.getByRole('button', { name: `Arquivar ${nome}` }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Local arquivado.' })).toBeVisible();
  await expect(nutri.getByRole('button', { name: `Arquivar ${nome}` })).toHaveCount(0);
  await nutri.getByRole('link', { name: 'Ver arquivados' }).click();
  await nutri.getByRole('button', { name: `Reativar ${nome}` }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Local reativado.' })).toBeVisible();
  // o local ativo aparece no filtro da agenda (a semente o arquiva na próxima execução, AG-D59)
  await nutri.goto('/painel/agenda');
  await expect(nutri.getByLabel('Local', { exact: true }).locator('option', { hasText: nome })).toHaveCount(1);
});
