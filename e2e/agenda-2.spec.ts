import { PDFiumLibrary } from '@hyzyla/pdfium';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';
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
const QUINTA = somar(SEGUNDA, 3);
/** Bloqueio desta semana (o axe do acessibilidade-painel mede a semana com consulta, bloqueio e marcador; M1 da revisão). */
const SEXTA = somar(SEGUNDA, 4);
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
  // um bloqueio de um dia (não é regra: não cruza as do agenda.spec)
  await nutri.goto('/painel/agenda/horarios');
  await nutri.getByLabel('Data inicial').fill(SEXTA);
  await nutri.getByLabel('Data final').fill(SEXTA);
  await nutri.getByLabel('Motivo (opcional)').fill(`Feriado E2E ${sufixo}`);
  await nutri.getByRole('button', { name: 'Adicionar bloqueio' }).click();
  await expect(nutri.getByText(`Feriado E2E ${sufixo}`)).toBeVisible();

  await nutri.goto(`/painel/agenda?visao=semana&data=${SEGUNDA}`);
  await expect(nutri.getByRole('navigation', { name: 'Seções da agenda' }).getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page');
  const grade = nutri.getByTestId('agenda-grade');
  await expect(grade).toBeVisible();
  await expect(nutri.getByTestId('agenda-lista-dias')).toBeHidden();
  // cada consulta uma vez, na linha da hora em que começa; o link é nomeado pelo conteúdo visível (US-404)
  await expect(grade.getByRole('link', { name: new RegExp(`07:40–08:25 ${LIA.nome} Primeira consulta · Clínica Centro E2E`) })).toBeVisible();
  await expect(grade.getByRole('link', { name: new RegExp(`07:00 \\(até 08:30\\) ${RUI.nome}`) })).toHaveCount(1);
  await expect(grade.getByRole('row', { name: /^07h/ }).getByRole('link', { name: new RegExp(LIA.nome) })).toBeVisible();
  await expect(grade.getByText(`Bloqueado: Feriado E2E ${sufixo}`)).toBeVisible();

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

  // legenda em texto; o filtro e o item da previsão de retorno ligados na T9 (AG-D73)
  const legenda = nutri.getByRole('region', { name: 'Legenda' });
  for (const r of ['Primeira consulta', 'Retorno', 'Presença a registrar', 'Bloqueio', 'Aniversário']) {
    await expect(legenda.getByText(r, { exact: true })).toBeVisible();
  }
  await expect(legenda.getByText('Pedido a responder')).toBeVisible(); // AG-D72: ligado na T8 (PEDIDOS_NA_AGENDA)
  await expect(legenda.getByText('Retorno previsto', { exact: true })).toBeVisible();
  await expect(nutri.getByRole('checkbox', { name: 'Previsões de retorno' })).toBeVisible();
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

/** Texto de cada página de um PDF (PDFium do próprio projeto, sem dependência nova), com os traços normalizados. */
async function paginasDoPdf(pdf: Buffer): Promise<string[]> {
  const biblioteca = await PDFiumLibrary.init();
  try {
    const doc = await biblioteca.loadDocument(new Uint8Array(pdf));
    try {
      return [...doc.pages()].map((p) => p.getText().replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' '));
    } finally {
      doc.destroy();
    }
  } finally {
    biblioteca.destroy();
  }
}

test('impressão em PDF A4 com várias páginas: nenhuma linha some, e o rodapé sai em toda página (revisão da T5, I-1)', async () => {
  test.setTimeout(300_000);
  // 50 consultas de 15 min na quinta, de 00:00 a 12:15: mais de uma página A4
  const horas: string[] = [];
  for (let i = 0; i < 50; i++) {
    const ini = `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`;
    const fim = `${String(Math.floor((i + 1) / 4)).padStart(2, '0')}:${String(((i + 1) % 4) * 15).padStart(2, '0')}`;
    await marcar(LIA, QUINTA, ini, '15', 'Consultório E2E (Presencial)');
    horas.push(`${ini}-${fim}`);
  }
  await nutri.goto(`/painel/agenda/imprimir?visao=dia&data=${QUINTA}`);
  await expect(nutri.getByRole('row', { name: new RegExp(`^12:15`) })).toBeVisible();
  // o teste anterior volta a mídia a "screen": o PDF tem de sair com o CSS de impressão (print:hidden, rolagem visível)
  await nutri.emulateMedia({ media: 'print' });
  let pdf: Buffer;
  try {
    pdf = await nutri.pdf({ format: 'A4' });
  } finally {
    await nutri.emulateMedia({ media: 'screen' });
  }
  const paginas = await paginasDoPdf(pdf);
  expect(paginas.length, 'o dia ocupa mais de uma página').toBeGreaterThan(1);
  const tudo = paginas.join(' ');
  // a última linha de cada página (e todas as outras) está no PDF: nenhuma ficou sob o rodapé
  for (const h of horas) expect(tudo, h).toContain(h);
  for (const [i, p] of paginas.entries()) {
    expect(p, `página ${i + 1}`).toContain('Contém dados pessoais de pacientes. Uso restrito do consultório.');
    const ultima = [...p.matchAll(/\d{2}:\d{2}-\d{2}:\d{2}/g)].at(-1)?.[0];
    expect(ultima, `página ${i + 1} tem linhas`).toBeDefined();
    expect(horas, `a última linha da página ${i + 1}`).toContain(ultima);
  }
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

/**
 * Plano 23 (T8, US-407 a US-409, AG-D42, AG-D24): as solicitações de ponta a ponta, num consultório PRÓPRIO
 * (`e2e-pedidos`, da semente: a chave vale para o consultório inteiro e não pode mudar o que as outras specs marcam ao mesmo
 * tempo). A semente o entrega com a chave desligada, sem pedido nem consulta, horários de domingo a sábado (07:00–19:00) e
 * a paciente com conta "Paula Pedidos Semente". Bloco de IP: 10.9.23.10 (nutricionista), .11 (paciente), .12 e .13
 * (pessoas novas na página pública). Pedidos daqui a 10 dias (D1) e a remarcação para D2 = D1 + 1.
 */
test.describe('Plano 23 (T8): Solicitações — chave, portal, fila, pessoa nova e desistência', () => {
  // copiados da semente (importar scripts/e2e-seed.ts roda o seed)
  const PEDIDOS = { email: 'pedidos-e2e@nutridebby.test', senha: 'Nutri2026segura', slug: 'e2e-pedidos', nome: 'Consultório Pedidos E2E' };
  const PAULA = { email: 'pedidos-paciente-e2e@nutridebby.test', senha: 'Paciente2026segura', nome: 'Paula Pedidos Semente' };
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const D1 = somar(hojeSP, 10);
  const D2 = somar(D1, 1);
  /** O nome do grupo de horários de um dia no seletor ("ter., 24/11"). */
  const grupo = (iso: string) => `${DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]}., ${br(iso).slice(0, 5)}`;
  const quando = (iso: string, hora: string) => `${DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]}., ${br(iso)} às ${hora}`;
  /** AG-D75: o "não confirmado" que cairia entre 21h e 8h (São Paulo) sai às 08:00 — nessa janela o e-mail não é esperado. */
  const silencio = () => {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    return h >= 21 || h < 8;
  };
  let painel: Page;
  let paula: Page;

  test.beforeAll(async ({ browser }) => {
    painel = await entrarComo(browser, PEDIDOS.email, PEDIDOS.senha, '10.9.23.10');
    await expect(painel).toHaveURL(/\/painel$/);
    paula = await entrarComo(browser, PAULA.email, PAULA.senha, '10.9.23.11');
    await expect(paula).toHaveURL(/\/p\/inicio$/);
  });
  test.afterAll(async () => {
    // a semente desliga de novo; aqui, para a próxima spec que use este consultório na mesma execução
    if (painel) {
      await painel.goto('/painel/agenda/horarios');
      const caixa = painel.getByLabel('Confirmar os pedidos antes de marcar');
      if (await caixa.isChecked()) {
        await caixa.uncheck();
        await painel.getByRole('button', { name: 'Salvar configuração' }).click();
        await expect(painel.getByRole('status').filter({ hasText: 'Configuração salva.' })).toBeVisible();
      }
    }
    await painel?.context().close();
    await paula?.context().close();
  });

  /** A paciente pede pelo portal: "Pedido enviado. Sua nutricionista vai confirmar…" (US-408). */
  async function pedirPeloPortal(data: string, hora: string): Promise<void> {
    await paula.goto(`/p/agenda/nova?semana=${data}`);
    await paula.getByRole('group', { name: grupo(data) }).getByRole('radio', { name: hora }).check();
    await paula.getByRole('button', { name: 'Agendar consulta' }).click();
    await expect(paula.getByRole('status').filter({ hasText: 'Pedido enviado. Sua nutricionista vai confirmar o horário e você recebe um e-mail.' })).toBeVisible();
  }

  /** Uma pessoa nova pela página pública (código pelo Mailpit); devolve o e-mail. "Pedido enviado. {nome} vai confirmar…" (RN-426). */
  async function pedirPelaPagina(browser: Browser, ip: string, nome: string, hora: string): Promise<string> {
    const email = `${nome.split(' ')[0].toLowerCase()}-${sufixo}@ex.com`;
    const visitante = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip } })).newPage();
    try {
      await visitante.goto(`/n/${PEDIDOS.slug}?semana=${D1}`);
      await visitante.getByRole('group', { name: grupo(D1) }).getByRole('radio', { name: hora }).check();
      await visitante.getByLabel('Nome').fill(nome);
      await visitante.getByLabel('E-mail').fill(email);
      await visitante.getByLabel('Tenho 18 anos ou mais').check();
      await visitante.getByLabel(/^Li e aceito o Termo de Uso e Privacidade/).check();
      // RN-429: com a chave ligada, o ponto de coleta antes de enviar e de novo na etapa do código
      const pontoDeColeta = visitante.getByText(/^Até a resposta, guardamos seu nome, e-mail, telefone e o número de rede \(IP\)/);
      await expect(pontoDeColeta).toBeVisible();
      await expect(visitante.getByRole('button', { name: 'Enviar código' })).toBeEnabled({ timeout: 20_000 }); // Turnstile de teste
      await visitante.getByRole('button', { name: 'Enviar código' }).scrollIntoViewIfNeeded();
      await visitante.getByRole('button', { name: 'Enviar código' }).click();
      await expect(visitante.getByText(`Enviamos um código de 6 dígitos para ${email}. Ele vale por 10 minutos.`)).toBeVisible();
      await expect(pontoDeColeta).toBeVisible();
      const m = await esperarEmail(email, { assuntoComeca: 'Seu código para agendar', timeoutMs: 75_000 });
      await visitante.getByLabel('Código').fill(/\b(\d{6})\b/.exec(m.assunto)![1]);
      await visitante.getByRole('button', { name: 'Confirmar agendamento' }).click();
      await expect(visitante.getByRole('status').filter({ hasText: `Pedido enviado. ${PEDIDOS.nome} vai confirmar o horário e você recebe um e-mail.` })).toBeVisible();
    } finally {
      await visitante.context().close();
    }
    return email;
  }

  test('a chave em Horários: "Configuração salva." e a aba "Solicitações (0)" aparece (US-407)', async () => {
    await painel.goto('/painel/agenda/horarios');
    const abas = painel.getByRole('navigation', { name: 'Seções da agenda' });
    await expect(abas.getByRole('link', { name: /^Solicitações/ })).toHaveCount(0); // a semente começa com a chave desligada
    await expect(painel.getByRole('heading', { name: 'Pedidos de consulta' })).toBeVisible();
    await expect(painel.getByText('Os pedidos feitos pelo app e pela página de agendamento esperam a sua resposta em Solicitações.')).toBeVisible();
    await painel.getByLabel('Confirmar os pedidos antes de marcar').check();
    await painel.getByRole('button', { name: 'Salvar configuração' }).click();
    await expect(painel.getByRole('status').filter({ hasText: 'Configuração salva.' })).toBeVisible();
    await expect(abas.getByRole('link', { name: 'Solicitações (0)' })).toBeVisible();
    await expect(painel.getByLabel('Confirmar os pedidos antes de marcar')).toBeChecked();
  });

  test('portal: pedido "Aguardando confirmação da nutricionista"; a nutricionista aceita e a paciente recebe "consulta marcada" (US-408, US-409)', async () => {
    test.setTimeout(120_000); // o e-mail chega em até ~75 s com o servidor carregado
    await pedirPeloPortal(D1, '09:00');
    await paula.goto('/p/agenda');
    await expect(paula.getByRole('region', { name: 'Próximas' }).getByRole('link', { name: /Aguardando confirmação da nutricionista/ })).toHaveCount(1);
    // o Início do painel e a fila
    await painel.goto('/painel');
    await expect(painel.getByRole('heading', { name: 'Solicitações (1)' })).toBeVisible();
    await painel.getByRole('link', { name: 'Responder em Solicitações' }).click();
    await expect(painel.getByRole('heading', { level: 1, name: 'Solicitações' })).toBeVisible();
    const cartao = painel.getByRole('article', { name: PAULA.nome });
    await expect(cartao.getByText(`${quando(D1, '09:00')}–10:00`)).toBeVisible();
    await expect(cartao.getByText('Consultório · App')).toBeVisible();
    await expect(cartao.getByText(`Responda até ${br(somar(D1, -1))} às 21:00`)).toBeVisible(); // início − 12 h de antecedência
    const depois = new Date();
    await cartao.getByRole('button', { name: `Aceitar o pedido de ${PAULA.nome}` }).click();
    await expect(painel.getByRole('status').filter({ hasText: 'Pedido aceito. Consulta marcada.' })).toBeVisible();
    await expect(painel.getByRole('heading', { level: 1, name: 'Solicitações' })).toBeFocused(); // §7: o foco no h1
    await expect(painel.getByText('Nenhum pedido aguardando resposta.')).toBeVisible();
    await esperarEmail(PAULA.email, { assuntoComeca: `Consulta marcada: ${quando(D1, '09:00')}`, depoisDe: depois, timeoutMs: 75_000 });
    await paula.goto('/p/agenda');
    await expect(paula.getByRole('region', { name: 'Próximas' }).getByRole('link', { name: /Agendada/ })).toHaveCount(1);
  });

  test('portal: outro pedido recusado com motivo — a confirmação, "Pedido recusado.", "Não confirmado" no portal e o e-mail sem o motivo (US-409, AG-D23)', async () => {
    test.setTimeout(120_000); // o e-mail chega em até ~75 s com o servidor carregado
    await pedirPeloPortal(D1, '11:00');
    await painel.goto('/painel/agenda/solicitacoes');
    const cartao = painel.getByRole('article', { name: PAULA.nome });
    await cartao.getByRole('button', { name: `Recusar o pedido de ${PAULA.nome}` }).click();
    const dialogo = painel.getByRole('dialog', { name: `Recusar o pedido de ${PAULA.nome}?` });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByText('A pessoa recebe um e-mail avisando.')).toBeVisible();
    await expect(dialogo.getByLabel('Motivo (só você vê)')).toBeFocused();
    await dialogo.getByLabel('Motivo (só você vê)').fill(`Motivo E2E ${sufixo}`);
    const depois = new Date();
    await dialogo.getByRole('button', { name: 'Confirmar recusa' }).click();
    await expect(painel.getByRole('status').filter({ hasText: 'Pedido recusado.' })).toBeVisible();
    await expect(painel.getByRole('article', { name: PAULA.nome })).toHaveCount(0);
    await paula.goto('/p/agenda');
    await expect(paula.getByRole('region', { name: 'Anteriores' }).getByRole('link', { name: /Não confirmado/ })).toHaveCount(1);
    if (!silencio()) {
      const m = await esperarEmail(PAULA.email, { assunto: 'Seu pedido de consulta não foi confirmado', depoisDe: depois, timeoutMs: 75_000 });
      expect(m.texto).toContain(`O horário de ${quando(D1, '11:00')}`);
      expect(m.texto).not.toContain(`Motivo E2E ${sufixo}`);
    }
  });

  test('portal: "Desistir do pedido" com a confirmação "Desistir deste pedido?" → "Pedido cancelado." na região fixa, com o foco (US-408, AG-D42)', async () => {
    await pedirPeloPortal(D1, '12:00');
    await paula.goto('/p/agenda');
    await paula.getByRole('region', { name: 'Próximas' }).getByRole('link', { name: /Aguardando confirmação da nutricionista/ }).click();
    await expect(paula.getByRole('button', { name: 'Remarcar para este horário' })).toHaveCount(0);
    await paula.getByRole('button', { name: 'Desistir do pedido' }).click();
    const dialogo = paula.getByRole('dialog', { name: 'Desistir deste pedido?' });
    await dialogo.getByRole('button', { name: 'Desistir do pedido' }).click();
    await expect(paula).toHaveURL(/\/p\/agenda\?ok=pedido-cancelado$/);
    const aviso = paula.getByRole('status').filter({ hasText: 'Pedido cancelado.' });
    await expect(aviso).toBeVisible();
    await expect(aviso).toBeFocused();
    await expect(paula.getByRole('region', { name: 'Anteriores' }).getByRole('link', { name: /Pedido cancelado/ })).toHaveCount(1);
  });

  test('pessoa nova pela página pública (código pelo Mailpit) → "Nova pessoa: …" na fila → aceitar cria o cadastro e a consulta (RN-424, RN-426)', async ({ browser }) => {
    test.setTimeout(120_000); // o e-mail chega em até ~75 s com o servidor carregado
    const nome = `Nina Nova ${sufixo}`;
    const email = await pedirPelaPagina(browser, '10.9.23.12', nome, '13:00');
    await esperarEmail(email, { assunto: 'Recebemos seu pedido de consulta', timeoutMs: 75_000 });
    await painel.goto('/painel/agenda/solicitacoes');
    const cartao = painel.getByRole('article', { name: `Nova pessoa: ${nome}` });
    await expect(cartao.getByText('Consultório · Página de agendamento')).toBeVisible();
    await cartao.getByRole('button', { name: `Aceitar o pedido de ${nome}` }).click();
    await expect(painel.getByRole('status').filter({ hasText: 'Pedido aceito. Consulta marcada.' })).toBeVisible();
    await painel.goto(`/painel/agenda?visao=dia&data=${D1}`);
    const grade = painel.getByTestId('agenda-grade');
    await expect(grade.getByRole('link', { name: new RegExp(`13:00–14:00 ${nome}`) })).toBeVisible();
    await expect(grade.getByText('Novo paciente via agendamento online')).toBeVisible();
    await esperarEmail(email, { assuntoComeca: `Consulta marcada: ${quando(D1, '13:00')}`, timeoutMs: 75_000 });
  });

  test('pessoa nova desiste pelo link do e-mail: a página não grava até "Desistir do pedido"; "Pedido cancelado." e o pedido sai da fila (AG-D42, AG-D48)', async ({ browser }) => {
    test.setTimeout(120_000); // o e-mail chega em até ~75 s com o servidor carregado
    const nome = `Otto Novo ${sufixo}`;
    const email = await pedirPelaPagina(browser, '10.9.23.13', nome, '15:00');
    const recebido = await esperarEmail(email, { assunto: 'Recebemos seu pedido de consulta', timeoutMs: 75_000 });
    const link = primeiroLink(recebido.texto, `/n/${PEDIDOS.slug}/pedido/`);
    await painel.goto('/painel/agenda/solicitacoes');
    await expect(painel.getByRole('article', { name: `Nova pessoa: ${nome}` })).toBeVisible();
    const visitante = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.23.13' } })).newPage();
    try {
      const resposta = await visitante.goto(link);
      expect(resposta?.headers()['referrer-policy']).toBe('no-referrer'); // AG-D71
      await expect(visitante.getByRole('heading', { level: 1, name: 'Seu pedido de consulta' })).toBeVisible();
      await expect(visitante.getByText(`Desistir do pedido de ${quando(D1, '15:00')}`, { exact: false })).toBeVisible();
      // abrir não grava: o pedido continua na fila
      await painel.reload();
      await expect(painel.getByRole('article', { name: `Nova pessoa: ${nome}` })).toBeVisible();
      await visitante.getByRole('button', { name: 'Desistir do pedido' }).click();
      await expect(visitante.getByRole('status').filter({ hasText: 'Pedido cancelado.' })).toBeVisible();
    } finally {
      await visitante.context().close();
    }
    await painel.reload();
    await expect(painel.getByRole('article', { name: `Nova pessoa: ${nome}` })).toHaveCount(0);
  });

  test('remarcar a consulta já marcada com a chave ligada → a nova nasce "Agendada", sem passar pela fila (AG-D24)', async () => {
    await paula.goto('/p/agenda');
    await paula.getByRole('region', { name: 'Próximas' }).getByRole('link', { name: /Agendada/ }).click();
    // espera a navegação: sem isto, `paula.url()` ainda é a lista (/p/agenda) e a semana abre no lugar errado
    await expect(paula).toHaveURL(/\/p\/agenda\/[0-9a-f-]{36}$/);
    await paula.goto(`${new URL(paula.url()).pathname}?semana=${D2}`);
    await paula.getByRole('group', { name: grupo(D2) }).getByRole('radio', { name: '10:00' }).check();
    await paula.getByRole('button', { name: 'Remarcar para este horário' }).click();
    await expect(paula.getByText(`Consulta remarcada para ${quando(D2, '10:00')} (horário de Brasília).`)).toBeVisible();
    await paula.goto('/p/agenda');
    await expect(paula.getByRole('region', { name: 'Próximas' }).getByRole('link', { name: /Agendada/ })).toHaveCount(1);
    await expect(paula.getByRole('region', { name: 'Próximas' }).getByRole('link', { name: /Aguardando confirmação/ })).toHaveCount(0);
    await painel.goto('/painel/agenda/solicitacoes');
    await expect(painel.getByText('Nenhum pedido aguardando resposta.')).toBeVisible();
  });
});

/**
 * Plano 23 (T10, US-412 a US-414, RN-432, RN-434): os aniversariantes de ponta a ponta, num consultório PRÓPRIO da semente
 * (`e2e-aniversario`: a lista e o Início contam o consultório inteiro). "Ana Aniversário Semente", com conta, faz aniversário
 * hoje (São Paulo) e começa sem a mensagem do ano; a autorização fica como a execução anterior deixou (só de inclusão). A
 * paciente autoriza no portal; a nutricionista marca e manda ("{n} de hoje saem agora", só entre 9h e 21h — fora disso, o
 * envio e a saída ficam para a próxima execução); o worker manda o e-mail (Mailpit) com List-Unsubscribe e
 * List-Unsubscribe-Post; a paciente sai pelo link (a página não grava no GET) e o POST de um clique responde 200 sem corpo.
 * Bloco de IP: 10.9.23.30 (nutricionista), .31 (paciente), .32 (o link, sem login).
 */
test.describe('Plano 23 (T10): Aniversariantes — autorização no portal, envio, e-mail e saída pelo link', () => {
  // copiados da semente (importar scripts/e2e-seed.ts roda o seed)
  const ANIV = { email: 'aniversario-e2e@nutridebby.test', senha: 'Nutri2026segura', nutri: 'Débora Aniversário E2E' };
  const ANA = { email: 'aniversario-paciente-e2e@nutridebby.test', senha: 'Paciente2026segura', nome: 'Ana Aniversário Semente' };
  const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
  const hojeSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const mesDoAno = `${MESES[Number(hojeSP.slice(5, 7)) - 1]} de ${hojeSP.slice(0, 4)}`;
  /** RN-432: o aniversariante de hoje sai "agora" só entre 9h e 21h (São Paulo). */
  const noHorario = () => {
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    return h >= 9 && h < 21;
  };
  let painel: Page;
  let ana: Page;
  let linkDeSaida = '';
  let umClique = '';

  test.beforeAll(async ({ browser }) => {
    painel = await entrarComo(browser, ANIV.email, ANIV.senha, '10.9.23.30');
    await expect(painel).toHaveURL(/\/painel$/);
    ana = await entrarComo(browser, ANA.email, ANA.senha, '10.9.23.31');
    await expect(ana).toHaveURL(/\/p\/inicio$/);
  });
  test.afterAll(async () => {
    await painel?.context().close();
    await ana?.context().close();
  });

  /** O bloco do aniversário em Eu (US-414). */
  const bloco = () => ana.getByRole('region', { name: 'Receber mensagem de aniversário da sua nutricionista' });

  test('portal: o bloco com a ajuda fixa e o botão explícito; "Autorizar" → "Autorizado em {hoje}" e "Retirar autorização" (US-414)', async () => {
    await ana.goto('/p/perfil');
    await expect(bloco()).toBeVisible();
    await expect(bloco().getByText('Uma mensagem por ano, por e-mail (e, se a sua nutricionista quiser, pelo WhatsApp dela), no dia do seu aniversário. Usamos seu nome, sua data de nascimento, seu e-mail e seu telefone. Você pode desligar quando quiser, aqui ou pelo link no próprio e-mail.')).toBeVisible();
    // a execução anterior pode ter deixado autorizado: a retirada no app primeiro (a tabela é só de inclusão)
    if (await bloco().getByRole('button', { name: 'Retirar autorização' }).isVisible()) {
      await bloco().getByRole('button', { name: 'Retirar autorização' }).click();
      await expect(bloco().getByText('Não autorizado')).toBeVisible();
    }
    await expect(bloco().getByText('Não autorizado')).toBeVisible();
    await bloco().getByRole('button', { name: 'Autorizar' }).click();
    await expect(bloco().getByText(`Autorizado em ${br(hojeSP)}`)).toBeVisible();
    await expect(bloco().getByRole('button', { name: 'Retirar autorização' })).toBeVisible();
  });

  test('painel: "Aniversariantes de hoje (1)" no Início; a lista do mês sem trilha; "Selecionar todos", a prévia e "Mensagens agendadas: 1." (US-412, US-413)', async () => {
    test.skip(!noHorario(), 'o aniversariante de hoje só sai "agora" entre 9h e 21h (RN-432)');
    await painel.goto('/painel');
    await expect(painel.getByRole('heading', { name: 'Aniversariantes de hoje (1)' })).toBeVisible();
    await painel.goto('/painel/agenda/aniversariantes');
    await expect(painel.getByRole('heading', { level: 1, name: `Aniversariantes de ${mesDoAno}` })).toBeVisible();
    await expect(painel.getByRole('link', { name: 'Aniversariantes', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(painel.getByText('Pacientes sem data de nascimento não aparecem nesta lista.')).toBeVisible();
    const linha = painel.getByRole('row', { name: new RegExp(ANA.nome) });
    await expect(linha.getByRole('cell', { name: 'Pode receber' })).toBeVisible();
    await painel.getByRole('button', { name: 'Selecionar todos' }).click();
    await expect(painel.getByRole('status').filter({ hasText: '1 marcado' })).toBeVisible();
    await expect(painel.getByRole('button', { name: 'Limpar seleção' })).toBeVisible();
    await painel.getByRole('button', { name: 'Enviar mensagem' }).click();
    const previa = painel.getByRole('dialog', { name: 'Enviar mensagem' });
    await expect(previa).toBeVisible();
    await expect(previa.getByText('Texto padrão do NutriDebby, enviado em seu nome')).toBeVisible();
    await expect(previa.getByText(`Feliz aniversário, {primeiro nome}! ${ANIV.nutri} deseja a você um novo ano com muita saúde.`)).toBeVisible();
    await expect(previa.getByText('Vai para 1 paciente por e-mail, às 9h do dia do aniversário.')).toBeVisible();
    await expect(previa.getByText('1 de hoje saem agora.')).toBeVisible();
    const depoisDe = new Date();
    await previa.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(painel.getByRole('status').filter({ hasText: 'Mensagens agendadas: 1.' })).toBeVisible();
    await expect(painel.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(painel.getByRole('row', { name: new RegExp(ANA.nome) }).getByRole('cell', { name: 'Já enviada este ano' })).toBeVisible();
    // o worker manda na próxima volta (cron de 1 min): o e-mail com o texto fixo, o rodapé e o link de saída
    const m = await esperarEmail(ANA.email, { assunto: 'Uma mensagem da sua nutricionista', depoisDe, timeoutMs: 150_000 });
    expect(m.texto).toContain(`Feliz aniversário, Ana! ${ANIV.nutri} deseja a você um novo ano com muita saúde.`);
    expect(m.texto).toContain(`Mensagem enviada pelo NutriDebby a pedido de ${ANIV.nutri}.`);
    linkDeSaida = primeiroLink(m.texto, '/aniversario/sair/');
    // RFC 8058: os cabeçalhos do e-mail (a API do Mailpit, pelo id da mensagem mais recente)
    const busca = (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${ANA.email}" subject:"Uma mensagem da sua nutricionista"`)}&limit=1`)).json()) as { messages: { ID: string }[] };
    const cab = (await (await fetch(`${MAILPIT}/api/v1/message/${busca.messages[0].ID}/headers`)).json()) as Record<string, string[]>;
    expect(cab['List-Unsubscribe-Post']).toEqual(['List-Unsubscribe=One-Click']);
    umClique = /^<(.+)>$/.exec(cab['List-Unsubscribe'][0])![1];
    expect(new URL(umClique).pathname).toBe(new URL(linkDeSaida).pathname.replace('/aniversario/', '/api/aniversario/'));
  });

  test('saída pelo link do e-mail: o GET não grava; "Confirmar" → "Pronto."; o portal volta a "Não autorizado"; o POST de um clique → 200 sem corpo (RN-434)', async ({ browser }) => {
    test.skip(!linkDeSaida, 'sem o e-mail desta execução (fora do horário do envio)');
    const visitante = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.23.32' } })).newPage();
    try {
      await visitante.goto(linkDeSaida);
      await expect(visitante.getByRole('heading', { level: 1, name: 'Mensagens de aniversário' })).toBeVisible();
      await expect(visitante.getByText(`Você não quer mais receber mensagens de aniversário de ${ANIV.nutri}?`)).toBeVisible();
      // leitores de link abrem a URL: abrir de novo continua sem gravar
      await visitante.reload();
      await ana.goto('/p/perfil');
      await expect(bloco().getByText(`Autorizado em ${br(hojeSP)}`)).toBeVisible();
      await visitante.getByRole('button', { name: 'Confirmar' }).click();
      await expect(visitante.getByRole('status').filter({ hasText: 'Pronto. Você não vai mais receber mensagens de aniversário.' })).toBeVisible();
      await ana.goto('/p/perfil');
      await expect(bloco().getByText('Não autorizado')).toBeVisible();
      // o provedor de e-mail: POST de um clique, sem cookie, de outra origem — 200 sem corpo, também na repetição
      const r = await visitante.request.post(umClique, { form: { 'List-Unsubscribe': 'One-Click' }, headers: { origin: 'https://mail.provedor.example' }, maxRedirects: 0 });
      expect(r.status()).toBe(200);
      expect(await r.text()).toBe('');
    } finally {
      await visitante.context().close();
    }
  });
});
