import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { entrarComo, excluirPelaTela } from './helpers';
import { criarPacientePeloFormulario } from './pacientes-form';
import { pacienteNoPortal } from './portal';

// Plano 19 (T11; RNF-234 c, RNF-230): o fluxo principal do plano por dia da semana — a nutricionista monta "Almoço" de
// segunda a sexta e "Almoço" de sábado e domingo, liga a lista de substituição e a orientação (fora da audiência da
// paciente) e publica; a paciente vê, com o relógio do aparelho na virada de domingo para segunda no fuso do consultório,
// o dia certo, a lista inline e a orientação (texto e PDF) só pelo plano. E a digitação num plano de 50 refeições.
// Bloco de IP deste spec (o limite de login é por IP): 10.9.19.100 a 10.9.19.119 — nutri .100, paciente .101; o
// acessibilidade.spec usa a .110 (a paciente do plano por dia do seed). As .6 e .76 a .80 da faixa 10.9.19.x já são de
// outros specs.
// Navegação sempre por URL (nunca pela aba da ficha, que o Plano 18 renomeia) e paciente novo só pelo formulário do Plano 18.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

const sufixo = Date.now().toString(36);
const LISTA = `Trocas do dia a dia ${sufixo}`;
const ORIENTACAO = `Como montar o prato ${sufixo}`;
/**
 * O fuso do consultório do E2E é o padrão de `tenants.fuso` (America/Sao_Paulo, UTC−3 sem horário de verão): domingo,
 * 22/11/2026, 23:59 e segunda, 23/11/2026, 00:00 no consultório. Só o relógio do navegador da paciente (`page.clock`):
 * a página Plano decide "Hoje ({dia})" no aparelho (RN-247 c).
 */
const DOMINGO_23_59 = new Date('2026-11-23T02:59:00Z');
const SEGUNDA_00_00 = new Date('2026-11-23T03:00:00Z');

let nutri: Page;
let paciente: Awaited<ReturnType<typeof pacienteNoPortal>>;
let urlDaOrientacao = ''; // /painel/conteudos/<id>
let kcal = { semana: '', fimDeSemana: '' }; // o total de cada perfil na legenda do editor ("seg a sex: 19 kcal")
// o que o spec cria na biblioteca do consultório do E2E (limites de 100 listas e 200 minhas refeições): apagado no afterAll
let urlDaLista = ''; // /painel/planos/listas/<id>
let nomeDaMinhaRefeicao = '';

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.19.100');
  await expect(nutri).toHaveURL(/\/painel$/); // sem esperar o login, o goto seguinte interrompe a navegação
});
test.afterAll(async () => {
  // a lista (as cópias ligadas aos planos não mudam, RN-252) e a minha refeição saem pela tela, como a nutricionista faria
  if (nutri && urlDaLista) await excluirPelaTela(nutri, urlDaLista, /\/painel\/planos\/listas$/);
  if (nutri && nomeDaMinhaRefeicao) {
    await nutri.goto('/painel/planos/refeicoes');
    const link = nutri.getByRole('link', { name: nomeDaMinhaRefeicao, exact: true });
    if (await link.count()) await excluirPelaTela(nutri, (await link.getAttribute('href'))!, /\/painel\/planos\/refeicoes$/);
  }
  await paciente?.page.context().close();
  await nutri?.context().close();
});

/** Escolhe no `<select>` a opção cujo texto contém `trecho` (o texto da opção leva a contagem ou o tipo depois do nome). */
async function escolherOpcao(select: Locator, trecho: string) {
  const valor = await select.locator('option', { hasText: trecho }).getAttribute('value');
  expect(valor, `opção com "${trecho}"`).not.toBeNull();
  await select.selectOption(valor!);
}

/** O salvamento automático do editor terminou (o "Salvo" da região de status). */
const salvo = (page: Page) => expect(page.getByRole('status').filter({ hasText: /^Salvo/ })).toBeVisible({ timeout: 10_000 });

/** Desmarca, no grupo "Dias de {refeição}", os dias pedidos ("sáb", "dom"…). */
async function desmarcarDias(page: Page, refeicao: string, dias: string[]) {
  const grupo = page.getByRole('group', { name: `Dias de ${refeicao}` });
  for (const d of dias) await grupo.getByRole('checkbox', { name: d, exact: true }).uncheck();
}

test('biblioteca: a lista de substituição e a orientação com PDF, publicada só para outra paciente (US-238, US-052)', async () => {
  await nutri.goto('/painel/planos/listas/novo');
  await nutri.getByLabel('Nome', { exact: true }).fill(LISTA);
  await nutri.getByRole('button', { name: 'Adicionar grupo' }).click();
  await nutri.getByLabel('Nome do grupo 1').fill('Carboidratos — 1 porção');
  await nutri.getByLabel('Adicionar alimento em Carboidratos — 1 porção').fill('chuchu cozido');
  await nutri.getByRole('option', { name: /Chuchu, cozido/ }).click();
  await nutri.getByRole('button', { name: 'Salvar lista' }).click();
  await expect(nutri).toHaveURL(/\/painel\/planos\/listas\/[0-9a-f-]{36}$/);
  urlDaLista = new URL(nutri.url()).pathname;

  await nutri.goto('/painel/conteudos/novo?tipo=orientacao');
  await nutri.getByLabel('Título').fill(ORIENTACAO);
  await nutri.getByLabel('Texto').fill('## Montar o prato\n\nMetade do prato com legumes e verduras.');
  // fora da audiência da paciente deste spec: só a MULTI do seed (scripts/e2e-seed.ts) a vê pelo feed
  await nutri.getByLabel('Pacientes específicos').check();
  await nutri.getByLabel('Multi E2E', { exact: true }).check();
  await nutri.getByRole('button', { name: 'Criar' }).click();
  await expect(nutri).toHaveURL(/\/painel\/conteudos\/[0-9a-f-]{36}$/);
  urlDaOrientacao = new URL(nutri.url()).pathname;
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  await nutri.getByLabel('Material em PDF (até 10 MB)').setInputFiles({ name: 'prato.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(nutri.getByRole('status').filter({ hasText: 'PDF salvo.' })).toBeVisible();
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Conteúdo publicado.' })).toBeVisible();
});

test('editor: "Almoço" de segunda a sexta e "Almoço" de sábado e domingo, a lista e a orientação ligadas; publicar (US-236, US-239)', async ({ browser }) => {
  test.setTimeout(120_000);
  paciente = await pacienteNoPortal(browser, nutri, '10.9.19.101');
  await nutri.goto(`${paciente.prontuario}/plano-alimentar`);
  await nutri.getByRole('button', { name: 'Criar plano' }).click();
  await expect(nutri.getByRole('heading', { name: /Plano alimentar — versão \d+/ })).toBeVisible();
  await nutri.getByLabel('Mostrar calorias ao paciente').check();

  // os dias antes do nome: com o nome repetido, o nome acessível passa a levar os dias (RNF-232)
  await nutri.getByRole('button', { name: 'Adicionar refeição' }).click();
  await desmarcarDias(nutri, 'Refeição 1', ['sáb', 'dom']);
  await nutri.getByLabel('Refeição', { exact: true }).nth(0).fill('Almoço');
  await nutri.getByRole('button', { name: 'Adicionar refeição' }).click();
  await desmarcarDias(nutri, 'Refeição 2', ['seg', 'ter', 'qua', 'qui', 'sex']);
  await nutri.getByLabel('Refeição', { exact: true }).nth(1).fill('Almoço');
  await nutri.getByLabel('Horário de Almoço (seg a sex)').fill('12:00');
  await nutri.getByLabel('Horário de Almoço (sáb e dom)').fill('13:00');
  for (const [refeicao, gramas] of [['Almoço (seg a sex)', '100'], ['Almoço (sáb e dom)', '200']] as const) {
    await nutri.getByLabel(`Adicionar alimento em ${refeicao}`).fill('chuchu cozido');
    await nutri.getByRole('option', { name: /Chuchu, cozido/ }).click();
    await nutri.getByRole('region', { name: refeicao }).getByLabel('Gramas de Chuchu, cozido').fill(gramas);
  }
  await expect(nutri.getByRole('group', { name: 'Dias de Almoço (seg a sex)' })).toBeVisible();
  await salvo(nutri);
  // a legenda com o total de cada perfil de dia (RN-247 a)
  const LEGENDA = /^seg a sex: ([\d.]+) kcal · sáb e dom: ([\d.]+) kcal$/;
  await expect(nutri.locator('#filtro-dias-legenda')).toHaveText(LEGENDA);
  const legenda = ((await nutri.locator('#filtro-dias-legenda').textContent()) ?? '').trim();
  const m = LEGENDA.exec(legenda);
  expect(m, `legenda: ${legenda}`).not.toBeNull();
  kcal = { semana: m![1], fimDeSemana: m![2] };
  expect(kcal.semana).not.toBe(kcal.fimDeSemana);
  // o filtro "sáb" mostra só o almoço de sábado
  await nutri.getByRole('button', { name: 'sáb', exact: true }).click();
  await expect(nutri.getByRole('button', { name: 'sáb', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(nutri.getByRole('region', { name: 'Almoço (sáb e dom)' })).toBeVisible();
  await expect(nutri.getByRole('region', { name: 'Almoço (seg a sex)' })).toHaveCount(0);
  await nutri.getByRole('button', { name: 'Todos', exact: true }).click();
  await salvo(nutri);

  // "Ligado ao plano": a lista entra como cópia; a orientação, com o tipo e a situação
  await nutri.getByRole('button', { name: 'Ligar lista de substituição' }).click();
  await escolherOpcao(nutri.getByLabel('Lista de substituição', { exact: true }), LISTA);
  await nutri.getByRole('button', { name: 'Ligar', exact: true }).click();
  await expect(nutri.getByRole('heading', { level: 3, name: LISTA })).toBeVisible();
  await expect(nutri.getByText(/^Cópia de \d{2}\/\d{2}\/\d{4}\. Mudanças na biblioteca não alteram este plano\.$/)).toBeVisible();
  await nutri.getByRole('button', { name: 'Ligar receita ou material' }).click();
  await escolherOpcao(nutri.getByLabel('Receita ou material', { exact: true }), ORIENTACAO);
  await nutri.getByRole('button', { name: 'Ligar', exact: true }).click();
  await expect(nutri.getByText(ORIENTACAO, { exact: true })).toBeVisible();
  await expect(nutri.getByText('Orientação · Publicado', { exact: true })).toBeVisible();

  // publicar: o "Publicar mesmo assim" só se a publicação devolver aviso (aqui todo dia tem refeição e há meta de cálculo)
  nutri.on('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Publicar', exact: true }).click();
  const publicado = nutri.getByRole('status').filter({ hasText: 'Plano publicado.' });
  const mesmoAssim = nutri.getByRole('button', { name: 'Publicar mesmo assim' });
  await expect(publicado.or(mesmoAssim)).toBeVisible({ timeout: 15_000 });
  if (await mesmoAssim.isVisible()) await mesmoAssim.click();
  await expect(publicado).toBeVisible({ timeout: 15_000 });
  nutri.removeAllListeners('dialog');
});

test('app, domingo 23:59: "Hoje (dom)" com o almoço do fim de semana e o total do dia dele; a lista inline e a orientação só pelo plano (RN-247 c, RN-252, RN-253)', async () => {
  const page = paciente.page;
  await page.clock.setFixedTime(DOMINGO_23_59);
  await page.goto('/p/plano');
  const hoje = page.getByRole('region', { name: 'Hoje (dom)' });
  await expect(hoje).toBeVisible();
  await expect(hoje.getByRole('heading', { name: 'Almoço · 13:00' })).toBeVisible();
  await expect(hoje.getByRole('heading', { name: 'Almoço · 12:00' })).toHaveCount(0);
  // o total do dia é o do perfil de hoje, nunca a soma dos dois "Almoço" (RN-247 c)
  await expect(hoje.getByText(`Total do dia: ${kcal.fimDeSemana} kcal`, { exact: true })).toBeVisible();
  // depois da última refeição de domingo, a próxima é a de segunda, em "Ver outros dias" (aberto junto)
  await expect(page.getByText('Próxima: amanhã às 12:00', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Segunda a sexta' }).getByText(`Total do dia: ${kcal.semana} kcal`, { exact: true })).toBeVisible();

  // a lista de substituição inline (a cópia do plano publicado)
  const ligado = page.getByRole('region', { name: 'Ligado ao seu plano' });
  await ligado.getByText(LISTA, { exact: true }).click(); // abre a sanfona da lista
  await expect(ligado.getByRole('heading', { name: 'Carboidratos — 1 porção' })).toBeVisible();
  await expect(ligado.getByText('Chuchu, cozido', { exact: true })).toBeVisible();

  // a orientação fora da audiência: só pelo plano (?de=plano), com o PDF
  const link = ligado.getByRole('link', { name: new RegExp(ORIENTACAO) });
  const idDaOrientacao = urlDaOrientacao.split('/').pop()!;
  await expect(link).toHaveAttribute('href', `/p/conteudos/${idDaOrientacao}?de=plano`);
  await link.click();
  await expect(page.getByRole('heading', { level: 2, name: 'Montar o prato', exact: true })).toBeVisible();
  const baixar = page.getByRole('link', { name: 'Baixar material (PDF)' });
  await expect(baixar).toHaveAttribute('href', `/api/p/conteudos/${idDaOrientacao}/pdf?de=plano`);
  const r = await page.request.get((await baixar.getAttribute('href'))!);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/^application\/pdf/);
  // sem o caminho do plano, a orientação e o PDF dela não abrem (RN-12)
  expect((await page.goto(`/p/conteudos/${idDaOrientacao}`))?.status()).toBe(404);
  await expect(page.getByText(ORIENTACAO)).toHaveCount(0);
  expect((await page.request.get(`/api/p/conteudos/${idDaOrientacao}/pdf`, { maxRedirects: 0 })).status()).toBe(404);
  // nem no feed de Conteúdos, nem na busca
  // (cada negativa tem antes uma âncora positiva: a página carregou)
  await page.goto('/p/conteudos');
  await expect(page.getByRole('navigation', { name: 'Filtrar conteúdos' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(ORIENTACAO) })).toHaveCount(0);
  await page.getByLabel('Buscar').fill(sufixo);
  await page.getByRole('button', { name: 'Buscar' }).click();
  await expect(page).toHaveURL(new RegExp(`busca=${sufixo}`));
  await expect(page.getByText('Nenhum conteúdo encontrado.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(ORIENTACAO) })).toHaveCount(0);
  // abrir pelo plano não conta em "Quem viu" (D14 do Plano 07)
  await nutri.goto(`${urlDaOrientacao}/visualizacoes`);
  await expect(nutri.getByRole('heading', { level: 1, name: `Quem viu: ${ORIENTACAO}` })).toBeVisible();
  await expect(nutri.getByText(paciente.nome)).toHaveCount(0);
});

test('app, segunda 00:00: a mesma página vira "Hoje (seg)" pelo relógio do aparelho; o almoço do fim de semana fica só para leitura (RN-247 c, e)', async () => {
  const page = paciente.page;
  await page.clock.setFixedTime(SEGUNDA_00_00);
  await page.goto('/p/plano');
  const hoje = page.getByRole('region', { name: 'Hoje (seg)' });
  await expect(hoje).toBeVisible();
  await expect(hoje.getByRole('heading', { name: 'Almoço · 12:00' })).toBeVisible();
  await expect(hoje.getByRole('heading', { name: 'Almoço · 13:00' })).toHaveCount(0);
  await expect(hoje.getByText(`Total do dia: ${kcal.semana} kcal`, { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Hoje (dom)' })).toHaveCount(0);
  // o almoço de sábado e domingo, aberto em "Ver outros dias": sem as ações, com a frase do dia dele
  await page.getByText('Ver outros dias', { exact: true }).click();
  const fimDeSemana = page.getByRole('region', { name: 'Sábado e domingo' });
  await fimDeSemana.getByRole('heading', { name: 'Almoço · 13:00' }).click();
  await expect(fimDeSemana.getByText('Você responde a esta refeição no dia dela.', { exact: true })).toBeVisible();
  await expect(fimDeSemana.getByRole('button', { name: 'Comi assim' })).toHaveCount(0);
});

/**
 * RNF-230 (PM-PA9): o recálculo do editor continua síncrono e não trava a digitação num plano de 50 refeições (o
 * limite, RN-249) com um alimento em cada. Mede, pela Event Timing API do Chrome, a duração de cada evento de teclado
 * na quantidade de um item (do toque até o quadro seguinte) e REGISTRA o número (console e anotação do teste): é
 * medição, sem portão de 200 ms (o "bom" da INP), porque a VPS do E2E é dividida com outras sessões. Só um teto folgado
 * (1000 ms) contra travamento.
 */
test('RNF-230: digitar a quantidade num plano de 50 refeições não trava (Event Timing)', async () => {
  test.setTimeout(240_000);
  const prontuario = await criarPacientePeloFormulario(nutri, { nome: `Paciente Cinquenta ${sufixo}`, email: `cinquenta-${sufixo}@nutridebby.test` });
  await nutri.goto(`${prontuario}/plano-alimentar`);
  await nutri.getByRole('button', { name: 'Criar plano' }).click();
  await expect(nutri.getByRole('heading', { name: /Plano alimentar — versão \d+/ })).toBeVisible();
  await nutri.getByRole('button', { name: 'Adicionar refeição' }).click();
  await nutri.getByLabel('Refeição', { exact: true }).fill('Almoço');
  await nutri.getByLabel('Adicionar alimento em Almoço').fill('chuchu cozido');
  await nutri.getByRole('option', { name: /Chuchu, cozido/ }).click();
  await nutri.getByLabel('Gramas de Chuchu, cozido').fill('100');
  // a mesma refeição carregada 49 vezes pela biblioteca ("Minhas refeições", US-237)
  const minha = `Almoço cinquenta ${sufixo}`;
  nomeDaMinhaRefeicao = minha;
  await nutri.getByRole('button', { name: /^Salvar como minha refeição/ }).click();
  const dialogo = nutri.getByRole('dialog', { name: 'Salvar refeição' });
  await dialogo.getByLabel('Nome').fill(minha);
  await dialogo.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Refeição salva em Minhas refeições.' })).toBeVisible();
  const horarios = nutri.locator('input[type="time"]');
  for (let n = 2; n <= 50; n++) {
    await nutri.getByRole('button', { name: 'Carregar minha refeição' }).click();
    if (n === 2) await escolherOpcao(nutri.getByLabel('Minha refeição', { exact: true }), minha);
    await nutri.getByRole('button', { name: 'Carregar', exact: true }).click();
    await expect(horarios).toHaveCount(n);
  }
  await expect(nutri.getByRole('button', { name: 'Adicionar refeição' })).toBeDisabled(); // o limite de 50
  await salvo(nutri);

  await nutri.evaluate(() => {
    const w = window as unknown as { __teclas: number[] };
    w.__teclas = [];
    // durationThreshold mínimo (16 ms): os eventos mais rápidos nem entram — sem entrada nenhuma, todos abaixo de 16 ms
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (['keydown', 'keypress', 'keyup', 'beforeinput', 'input'].includes(e.name)) w.__teclas.push(e.duration);
    }).observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
  });
  const campo = nutri.getByLabel('Gramas de Chuchu, cozido').first();
  await campo.click();
  let teclas = 0;
  for (let k = 0; k < 5; k++) {
    await campo.press('End');
    for (let b = 0; b < 3; b++) await campo.press('Backspace');
    await campo.pressSequentially('125', { delay: 40 });
    teclas += 6;
  }
  await expect(campo).toHaveValue('125');
  await nutri.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 300)))); // as entradas chegam depois do quadro
  const duracoes = await nutri.evaluate(() => (window as unknown as { __teclas: number[] }).__teclas);
  const maior = Math.max(0, ...duracoes);
  const medicao = `plano de 50 refeições e 50 itens: ${teclas} teclas; ${duracoes.length} eventos de teclado acima de 16 ms; o maior, ${maior} ms`;
  console.log(`RNF-230 (${medicao})`);
  test.info().annotations.push({ type: 'RNF-230', description: medicao });
  expect(maior, 'um evento de teclado passou de 1000 ms (travamento)').toBeLessThanOrEqual(1000);
});
