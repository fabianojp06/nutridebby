import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import { contraste } from '@/lib/tema/contraste';
import { emitirReceita, entrarComoDocs } from './documentos';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';
import { criarPacientePeloFormulario } from './pacientes-form';
import { avaliar, entradasDoPlano, marcarParaPaciente, pacienteNoPortal, publicarPlanoDoDia } from './portal';

// RNF-10 / RNF-09 (P06-10): WCAG 2.1 AA em todas as telas do PWA, no tamanho de um Android (projeto "celular").
// Bloco de IP deste spec (o limite de login é por IP): 10.9.10.21 a 10.9.10.30; Plano 10A (T16): 10.9.14.79 (a nutricionista
// dos documentos, E2E_DOCS, com 2FA) e 10.9.14.80 (as páginas sem login do documento); Plano 15 (T13): 10.9.29.64 (a paciente
// liberada para a IA Nutri e sem o consentimento, da tela "Antes de usar a IA Nutri"); Plano 17 (P17-08): 10.9.10.25 (a
// paciente sem lembretes, de Eu › Lembretes vazia).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const MULTI = { email: 'multi-e2e@nutridebby.test', senha: 'Multi2026segura' }; // scripts/e2e-seed.ts: 3 consultórios, o "3" sem o termo
test.describe.configure({ mode: 'serial' });
let nutri: Page;
let paciente: Awaited<ReturnType<typeof pacienteNoPortal>>;
let docs: Page; // Plano 10A: a nutricionista dos documentos (E2E_DOCS, 2FA), um login só (o limite de login é por IP)
let codigoDaReceita = ''; // Plano 10A: a receita assinada da paciente (XXXX-XXXX-XXXX)
let refeicaoId = ''; // Plano 16: a refeição do plano, para o axe da refeição aberta
// Plano 16 (revisão final): um link longo sem espaço, maior que 320 px, no texto livre das telas de detalhe
const LINK_LONGO = 'https://exemplo.com.br/receitas/lanche-integral-com-frutas-vermelhas-e-aveia-em-flocos-finos';

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000); // a receita passa pelo worker duas vezes (o PDF preparado e o PDF digitalizado); a IA Nutri, uma
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.10.21', devices['Desktop Chrome']); // o painel, em tela de computador
  await expect(nutri).toHaveURL(/\/painel$/);
  paciente = await pacienteNoPortal(browser, nutri, '10.9.10.22');
  // Plano 16 (revisão do plano, achado 21): o "Almoço" daqui a 30 min — o mural de Hoje tem a refeição (e o "Comi assim")
  // qualquer que seja a hora do CI (com 12:00, só entre 10:30 e 23:59)
  // texto livre com um link longo (observação, orientações, diário e comentário): a tela de 320 px não pode rolar na horizontal
  await publicarPlanoDoDia(nutri, paciente.prontuario, undefined, { observacao: `Veja ${LINK_LONGO}`, orientacoes: `Leia ${LINK_LONGO}` });
  await lembreteLivreComLink(paciente.prontuario);
  await paciente.page.goto('/p/plano');
  refeicaoId = (await paciente.page.locator('details[id^="ref-"]').first().getAttribute('id'))!.slice(4);
  await marcarParaPaciente(nutri, paciente.nome, paciente.email, 1); // R11: semana 1 (o portal.spec usa a 0)
  // duas avaliações: o axe de /p/evolucao audita também o gráfico (GraficoLinha) e a lista de diferenças
  await avaliar(nutri, paciente.prontuario, '2026-08-01', '80');
  await avaliar(nutri, paciente.prontuario, '2026-09-01', '78');
  // um registro no diário, para a lista não sair vazia
  await paciente.page.goto('/p/diario');
  await paciente.page.getByLabel('Refeição', { exact: true }).selectOption('Almoço');
  await paciente.page.getByLabel('O que você comeu?').fill(`arroz e feijão ${LINK_LONGO}`);
  await paciente.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Registro salvo.' })).toBeVisible();
  // e o comentário da nutricionista nele (o mesmo caminho do portal.spec, US-043)
  await nutri.goto('/painel/diarios');
  await nutri.getByRole('listitem').filter({ hasText: paciente.nome }).getByRole('link').first().click();
  await nutri.getByLabel('Comentar').fill(`Veja ${LINK_LONGO}`);
  await nutri.getByRole('button', { name: 'Salvar comentário' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Comentário salvo.' })).toBeVisible();
  // Plano 10A (T16, RNF-144): uma receita emitida, para /p/documentos não sair vazia (assinar exige 2FA: a conta E2E_DOCS)
  docs = await entrarComoDocs(browser, '10.9.14.79', devices['Desktop Chrome']);
  codigoDaReceita = await emitirReceita(docs, paciente.prontuario);
  await conversaComMensagensReais();
});

/**
 * Plano 15 (T13, RNF-167): /p/plano/ia com mensagens reais — a nutricionista libera a paciente na aba "IA Nutri" da ficha (o
 * consultório do E2E tem a IA Nutri ativada no seed), a paciente autoriza, pergunta o horário do almoço (resposta montada
 * pelo sandbox e o worker: IA_PROVEDOR=sandbox), manda um sinal de risco (texto fixo na hora) e uma dúvida direto à
 * nutricionista; a nutricionista abre as duas na fila e marca como vistas ("Sua dúvida foi vista no consultório.").
 */
async function conversaComMensagensReais() {
  await liberarIaNutri(paciente.prontuario);
  const page = paciente.page;
  await page.goto('/p/plano/ia/autorizar?de=plano');
  await page.getByRole('button', { name: 'Autorizo o uso da IA Nutri' }).click();
  await expect(page).toHaveURL(/\/p\/plano\/ia$/);
  await page.waitForLoadState('networkidle'); // o campo é controlado pelo React (hidratado antes de preencher)
  const status = page.getByRole('main').getByRole('status');
  const enviar = async (texto: string, botao: string) => {
    await page.getByLabel('Sua dúvida').fill(texto);
    await page.getByRole('button', { name: botao, exact: true }).click();
  };
  await enviar('a que horas é o almoço?', 'Perguntar');
  await expect(status).toHaveText('A resposta chegou.', { timeout: 60_000 });
  await expect(page.getByRole('list', { name: 'Conversa' })).toContainText('No seu plano, o horário é:');
  await enviar('depois do jantar eu vomito pra não engordar', 'Perguntar');
  await expect(page.getByText(/^Que bom que você contou\./).first()).toBeVisible();
  await enviar('posso trocar o almoço por uma salada?', 'Enviar direto para minha nutricionista');
  await expect(status).toHaveText('Pronto! Sua pergunta foi enviada ao consultório. Quando houver novidade, ela aparece aqui.');
  for (let i = 0; i < 2; i++) {
    await nutri.goto('/painel/duvidas');
    await nutri.getByRole('row').filter({ hasText: paciente.nome }).first().getByRole('link', { name: `Abrir dúvida de ${paciente.nome}` }).click();
    await nutri.getByRole('button', { name: 'Marcar como vista' }).click();
    await expect(nutri).toHaveURL(/\/painel\/duvidas\?vista=1$/);
  }
  await page.goto('/p/plano/ia');
  await expect(page.getByText('Sua dúvida foi vista no consultório.')).toHaveCount(2);
}

/**
 * Plano 17 (P17-08): um lembrete livre com o link longo (97 caracteres, ≤ 120), pela seção "Lembretes no app" da aba Plano
 * alimentar — Eu › Lembretes mostra "Sua nutricionista: Leia …" e não pode rolar na horizontal a 320 px.
 */
async function lembreteLivreComLink(prontuario: string) {
  await nutri.goto(`${prontuario}/plano-alimentar`);
  const secao = nutri.locator('[data-guia="lembretes-app"]');
  await nutri.waitForLoadState('networkidle'); // formulário controlado pelo React: o clique antes da hidratação se perde
  await secao.getByRole('button', { name: 'Adicionar lembrete livre' }).click();
  await secao.getByLabel('Texto do lembrete').fill(`Leia ${LINK_LONGO}`);
  await secao.getByRole('button', { name: 'Salvar lembrete livre' }).click();
  await expect(secao.getByRole('status')).toHaveText('Lembrete salvo.');
}

/** A aba "IA Nutri" da ficha: "Liberar a IA Nutri para este paciente" (US-170). */
async function liberarIaNutri(prontuario: string) {
  await nutri.goto(`${prontuario}/ia-nutri`);
  await nutri.getByLabel('Liberar a IA Nutri para este paciente').check();
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'IA Nutri: liberada' })).toBeVisible();
}
test.afterAll(async () => {
  await docs?.context().close();
  await paciente?.page.context().close();
  await nutri?.context().close();
});

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function violacoes(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
async function semViolacoes(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  expect(await violacoes(page), url).toEqual([]);
}

// Plano 15: /p/plano/ia com a conversa (resposta montada, texto fixo de risco e dúvidas vistas); "Antes de usar a IA Nutri"
// (/p/plano/ia/autorizar) só abre sem o consentimento — teste próprio, com outra paciente, abaixo
// Plano 25 (T7): /p/mensagens entra no laço (sem conversa: o texto de "só recados", sem campo); o axe com mensagens, risco
// e recado na tela fica em e2e/mensagens.spec.ts
const ROTAS = ['/p/inicio', '/p/jornada', '/p/plano', '/p/plano/ia', '/p/diario', '/p/conteudos', '/p/conteudos?favoritos=1', '/p/evolucao', '/p/compras?dias=7', '/p/agenda', '/p/agenda/nova', '/p/perfil', '/p/perfil/ia', '/p/perfil/lembretes', '/p/documentos', '/p/exames', '/p/ajuda', '/p/mensagens'];
for (const url of ROTAS) {
  test(`axe sem violações (WCAG 2.1 AA) em ${url}`, async () => {
    await semViolacoes(paciente.page, url);
  });
}

// Modo escuro do aparelho (prefers-color-scheme: dark). Plano 08: o painel (T14) e o portal (T18) escurecem com o aparelho
// (data-tema=sistema); fora de um contêiner com data-tema tudo fica claro (globals.css). Nada pode escurecer só o fundo ou o
// texto base e deixar cores fixas do modo claro ilegíveis.
const PAINEL = ['/painel', '/painel/pacientes', '/painel/agenda', '/painel/alimentos', '/painel/diarios', '/painel/conteudos', '/painel/configuracoes'];
test('modo escuro do aparelho: axe sem violações (WCAG 2.1 AA) nas telas do portal e do painel', async () => {
  test.setTimeout(90_000); // ~20 telas com o axe: passava perto dos 30 s padrão (e estourou na suíte inteira, já antes da T16)
  await paciente.page.emulateMedia({ colorScheme: 'dark' });
  await nutri.emulateMedia({ colorScheme: 'dark' });
  try {
    expect(await paciente.page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    for (const url of ROTAS) await semViolacoes(paciente.page, url);
    for (const url of [...PAINEL, paciente.prontuario]) await semViolacoes(nutri, url);
  } finally {
    await paciente.page.emulateMedia({ colorScheme: 'light' });
    await nutri.emulateMedia({ colorScheme: 'light' });
  }
});

// WCAG 2.4.7/1.4.11 (Plano 08, T12): o axe não avalia o foco. Sobre a cor do consultório ([data-sobre-marca]: o cartão de
// destaque da T15; o cabeçalho do painel é neutro desde a T14) o foco na cor da marca sumia (1:1). Todo item focável ali tem contorno
// visível e ≥ 3:1 contra o fundo onde ele é desenhado, no claro e com o aparelho escuro.
test('foco visível sobre a cor do consultório: contorno ≥ 3:1 contra o fundo, no claro e com o aparelho escuro', async () => {
  const hex = (cor: string) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cor);
    expect(m, cor).not.toBeNull();
    return `#${m!.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  };
  for (const modo of ['light', 'dark'] as const) {
    await nutri.emulateMedia({ colorScheme: modo });
    try {
      await nutri.goto('/painel');
      const alvos = nutri.locator('[data-sobre-marca] :is(a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]))');
      const n = await alvos.count();
      expect(n, modo).toBeGreaterThan(0);
      await nutri.keyboard.press('Tab'); // modalidade de teclado: o focus() programático acende o :focus-visible
      for (let k = 0; k < n; k++) {
        const alvo = alvos.nth(k);
        await alvo.focus();
        const r = await alvo.evaluate((el) => {
          // o contorno fica do lado de fora (outline-offset): o fundo que conta é o do primeiro ancestral pintado
          let e = el.parentElement;
          while (e && /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(getComputedStyle(e).backgroundColor)) e = e.parentElement;
          const s = getComputedStyle(el);
          return {
            nome: el.textContent?.trim() ?? '',
            focoVisivel: el.matches(':focus-visible'),
            estilo: s.outlineStyle,
            largura: parseFloat(s.outlineWidth),
            cor: s.outlineColor,
            fundo: e ? getComputedStyle(e).backgroundColor : 'rgb(255, 255, 255)',
          };
        });
        const rotulo = `${modo}: ${r.nome}`;
        expect(r.focoVisivel, rotulo).toBe(true);
        expect(r.estilo, rotulo).toBe('solid');
        expect(r.largura, rotulo).toBeGreaterThanOrEqual(2);
        expect(contraste(hex(r.cor), hex(r.fundo)), `${rotulo}: ${r.cor} sobre ${r.fundo}`).toBeGreaterThanOrEqual(3);
      }
    } finally {
      await nutri.emulateMedia({ colorScheme: 'light' });
    }
  }
});

// Plano 16 (T16): as telas e os estados novos do layout G que o laço das ROTAS não alcança
test('axe na refeição aberta (claro e escuro) e no tour do portal (passo a passo, só teclado)', async () => {
  await semViolacoes(paciente.page, `/p/plano/refeicao/${refeicaoId}`);
  await paciente.page.emulateMedia({ colorScheme: 'dark' });
  try {
    expect(await violacoes(paciente.page), 'refeição aberta, aparelho escuro').toEqual([]);
  } finally {
    await paciente.page.emulateMedia({ colorScheme: 'light' });
  }
  await paciente.page.goto('/p/inicio?tour=portal-novidades');
  const dialogo = paciente.page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByText('1 de 5')).toBeVisible();
  expect(await violacoes(paciente.page)).toEqual([]);
  for (let i = 2; i <= 5; i++) {
    await dialogo.getByRole('button', { name: 'Próximo' }).focus();
    await paciente.page.keyboard.press('Enter');
    await expect(dialogo.getByText(`${i} de 5`)).toBeVisible();
    if (i === 4) {
      // "Atalhos" (alvo: a barra de ações, sticky no rodapé): a folha do tour não pode cobrir o alvo (folhaEvitaAlvo, T14)
      const alvo = (await paciente.page.locator('[data-guia="acoes"]').boundingBox())!;
      const folha = (await dialogo.locator('#tour-titulo').locator('xpath=..').boundingBox())!;
      expect(folha.y + folha.height <= alvo.y || alvo.y + alvo.height <= folha.y, 'folha do tour sobre a barra de ações').toBe(true);
    }
  }
  await dialogo.getByRole('button', { name: 'Concluir' }).focus();
  await paciente.page.keyboard.press('Enter');
  await expect(dialogo).toBeHidden();
});

test('foco visível sobre a faixa do portal: contorno branco ≥ 3:1 contra a cor da faixa, no claro e no escuro (RN-207)', async () => {
  const hex = (cor: string) => `#${/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cor)!.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  for (const modo of ['light', 'dark'] as const) {
    await paciente.page.emulateMedia({ colorScheme: modo });
    try {
      await paciente.page.goto('/p/inicio');
      const alvos = paciente.page.locator('header[data-sobre-marca] a[href]');
      expect(await alvos.count()).toBeGreaterThan(4);
      await paciente.page.keyboard.press('Tab'); // modalidade de teclado: o focus() programático acende o :focus-visible
      for (let k = 0; k < (await alvos.count()); k++) {
        const r = await alvos.nth(k).evaluate((el) => {
          (el as HTMLElement).focus();
          const s = getComputedStyle(el);
          return { visivel: el.matches(':focus-visible'), cor: s.outlineColor, largura: parseFloat(s.outlineWidth), faixa: getComputedStyle(el.closest('header')!).backgroundColor };
        });
        expect(r.visivel, `${modo} ${k}`).toBe(true);
        expect(r.largura).toBeGreaterThanOrEqual(2);
        expect(contraste(hex(r.cor), hex(r.faixa)), `${modo} ${k}`).toBeGreaterThanOrEqual(3);
      }
    } finally {
      await paciente.page.emulateMedia({ colorScheme: 'light' });
    }
  }
});

test('320 px com o texto em 200% (WCAG 1.4.4/1.4.10): nenhuma tela do layout G rola na horizontal; axe a 320 px em todas', async () => {
  test.setTimeout(120_000);
  await paciente.page.setViewportSize({ width: 320, height: 780 });
  try {
    // todas as telas do portal que esta paciente abre (termo, escolher e sem-acesso: testes próprios do arquivo)
    for (const url of ['/p/inicio', '/p/jornada', '/p/plano', `/p/plano/refeicao/${refeicaoId}`, '/p/plano/ia', '/p/evolucao', '/p/exames', '/p/perfil', '/p/perfil/lembretes', '/p/ajuda', '/p/diario', '/p/conteudos', '/p/agenda', '/p/compras', '/p/documentos']) {
      await paciente.page.goto(url);
      await paciente.page.waitForLoadState('networkidle');
      expect(await violacoes(paciente.page), `axe a 320 px: ${url}`).toEqual([]);
      // o link longo do texto livre está mesmo na página (diário: registro e comentário; plano: orientações e a observação na sanfona; refeição: observação;
      // Plano 17: o lembrete livre em Eu › Lembretes)
      const comLink = { '/p/diario': 2, '/p/plano': 2, [`/p/plano/refeicao/${refeicaoId}`]: 1, '/p/perfil/lembretes': 1 }[url] ?? 0;
      if (comLink) await expect(paciente.page.getByRole('main').getByText(LINK_LONGO, { exact: false })).toHaveCount(comLink);
      await paciente.page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      expect(await paciente.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
    }
  } finally {
    await paciente.page.setViewportSize(devices['Pixel 7'].viewport);
  }
});

test('"Comi assim" só com o teclado (WCAG 2.1.1, 2.2.1, 2.4.3): o foco vai ao "Desfazer" (o prazo pausa) e, ao desfazer, volta ao botão; axe com o aviso aberto, claro e escuro', async () => {
  test.setTimeout(60_000);
  for (const modo of ['light', 'dark'] as const) {
    await paciente.page.emulateMedia({ colorScheme: modo });
    try {
      await paciente.page.goto('/p/inicio');
      const comi = paciente.page.getByRole('main').getByRole('button', { name: 'Comi assim' }).first();
      await comi.focus();
      await paciente.page.keyboard.press('Enter');
      const desfazer = paciente.page.getByRole('button', { name: 'Desfazer' });
      await expect(desfazer).toBeFocused();
      expect(await violacoes(paciente.page), `Hoje com o "Desfazer" aberto (${modo})`).toEqual([]);
      await paciente.page.waitForTimeout(11_000); // com o foco no aviso, o prazo de 10 s não corre (nada é enviado)
      await expect(desfazer).toBeVisible();
      await paciente.page.keyboard.press('Enter');
      await expect(paciente.page.getByRole('main').getByRole('button', { name: 'Comi assim' }).first()).toBeFocused();
    } finally {
      await paciente.page.emulateMedia({ colorScheme: 'light' });
    }
  }
});

test('axe sem violações no detalhe de uma orientação (markdown e "Baixar material (PDF)")', async () => {
  const titulo = `Como ler rótulos ${Date.now().toString(36)}`;
  await nutri.goto('/painel/conteudos/novo?tipo=orientacao');
  await nutri.getByLabel('Título').fill(titulo);
  await nutri.getByLabel('Texto').fill('## Rótulos\n\nOlhe **sempre** a *porção*.\n\n- açúcar\n- sódio\n\n[Guia da Anvisa](https://www.gov.br/anvisa)');
  await nutri.getByRole('button', { name: 'Criar' }).click();
  await expect(nutri).toHaveURL(/\/painel\/conteudos\/[0-9a-f-]{36}$/);
  // um PDF mínimo: o botão "Baixar material (PDF)" só aparece com ele
  const pdf = { name: 'material.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') };
  const campoPdf = nutri.getByLabel('Material em PDF (até 10 MB)');
  await campoPdf.setInputFiles(pdf);
  await expect(nutri.getByRole('status').filter({ hasText: 'PDF salvo.' })).toBeVisible();
  expect(await campoPdf.inputValue()).toBe(''); // o campo volta vazio: o mesmo arquivo pode ser escolhido de novo
  // "Remover PDF" tira também o "PDF salvo." da tela
  await nutri.getByRole('button', { name: 'Remover PDF' }).click();
  await expect(nutri.getByRole('link', { name: 'Ver PDF' })).toHaveCount(0);
  await expect(nutri.getByText('PDF salvo.')).toHaveCount(0);
  await campoPdf.setInputFiles(pdf);
  await expect(nutri.getByRole('status').filter({ hasText: 'PDF salvo.' })).toBeVisible();
  await expect(nutri.getByRole('link', { name: 'Ver PDF' })).toBeVisible();
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Conteúdo publicado.' })).toBeVisible();
  await paciente.page.goto('/p/conteudos');
  await paciente.page.getByRole('link', { name: new RegExp(titulo) }).click();
  await expect(paciente.page.getByRole('heading', { level: 2, name: 'Rótulos', exact: true })).toBeVisible();
  const baixar = paciente.page.getByRole('link', { name: 'Baixar material (PDF)' });
  await expect(baixar).toBeVisible();
  expect(await violacoes(paciente.page)).toEqual([]);
  // R11: o mesmo detalhe (markdown, botão do PDF) com o aparelho escuro
  await paciente.page.emulateMedia({ colorScheme: 'dark' });
  try {
    expect(await violacoes(paciente.page), 'aparelho escuro').toEqual([]);
  } finally {
    await paciente.page.emulateMedia({ colorScheme: 'light' });
  }
  // o download pela sessão da paciente: a rota assina na hora (303) e o arquivo vem como PDF
  const r = await paciente.page.request.get((await baixar.getAttribute('href'))!);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/^application\/pdf/);
});

test('celular (RNF-09): a 360 px (o menor Android da R16), nenhuma tela do PWA rola na horizontal e as seções da faixa cabem em 5 colunas iguais (também a 320 px, com axe)', async () => {
  await paciente.page.setViewportSize({ width: 360, height: 780 });
  try {
    for (const url of ROTAS) {
      await paciente.page.goto(url);
      await paciente.page.waitForLoadState('networkidle');
      expect(await paciente.page.evaluate(() => window.innerWidth), url).toBe(360);
      expect(await paciente.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
    }
    await paciente.page.goto('/p/inicio');
    const secoes = paciente.page.getByRole('navigation', { name: 'Seções' });
    for (const s of ['Hoje', 'Jornada', 'Plano', 'Exames', 'Eu']) await expect(secoes.getByRole('link', { name: s, exact: true })).toBeVisible();
    // Plano 16 (§4.2): 5 colunas iguais (o consultório do E2E recebe exames), palavra longa quebra com hífen — nada rola nem invade a vizinha
    for (const largura of [360, 320]) {
      await paciente.page.setViewportSize({ width: largura, height: 780 });
      const barra = await secoes.evaluate((nav) => {
        const ul = nav.querySelector('ul')!;
        const lis = [...ul.querySelectorAll('li')].map((li) => li.getBoundingClientRect());
        const links = [...ul.querySelectorAll('a')];
        return {
          rola: ul.scrollWidth > ul.clientWidth || document.documentElement.scrollWidth > window.innerWidth,
          colunas: lis.length,
          larguras: lis.map((r) => Math.round(r.width)),
          vazaDaColuna: links.filter((a) => a.scrollWidth > a.clientWidth).map((a) => a.textContent),
          alturaMin: Math.min(...links.map((a) => a.getBoundingClientRect().height)),
        };
      });
      expect(barra.colunas, `${largura} px`).toBe(5);
      expect(barra.rola, `${largura} px`).toBe(false);
      expect(Math.max(...barra.larguras) - Math.min(...barra.larguras), `${largura} px: ${barra.larguras}`).toBeLessThanOrEqual(1);
      expect(barra.vazaDaColuna, `${largura} px`).toEqual([]);
      expect(barra.alturaMin, `${largura} px`).toBeGreaterThanOrEqual(44);
      expect(await violacoes(paciente.page), `axe a ${largura} px`).toEqual([]);
    }
    // T-4: sem o min-h-dvh aninhado, tela curta do portal não rola na vertical
    await paciente.page.goto('/p/conteudos?favoritos=1');
    await paciente.page.waitForLoadState('networkidle');
    expect(await paciente.page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  } finally {
    await paciente.page.setViewportSize(devices['Pixel 7'].viewport);
  }
});

// Plano 16 (§4.2, revisão da T4): a barra "Ações" de Hoje fica fixa embaixo também com Hoje curta (mt-auto no flex-col do
// (portal)/layout; o sticky bottom-0 só prende quando a página passa da tela). A 360 × 780 e numa janela alta, em que Hoje
// sempre sobra, o fim da barra é o fim da janela.
test('Hoje: a barra "Ações" fica fixa embaixo, com a página curta ou comprida (§4.2)', async () => {
  try {
    for (const altura of [780, 1600]) {
      await paciente.page.setViewportSize({ width: 360, height: altura });
      await paciente.page.goto('/p/inicio');
      await paciente.page.waitForLoadState('networkidle');
      const acoes = paciente.page.getByRole('navigation', { name: 'Ações' });
      await expect(acoes).toBeVisible();
      expect(await acoes.evaluate((nav) => Math.round(nav.getBoundingClientRect().bottom)), `360 × ${altura}`).toBe(altura);
    }
  } finally {
    await paciente.page.setViewportSize(devices['Pixel 7'].viewport);
  }
});

// Revisão da T4: <form> dentro de <p> não existe no HTML — o parser fecha o <p> antes do <form>, o DOM fica diferente da
// árvore do React e a hidratação falha (era o "Sair" no fim de Eu). Confere o HTML do servidor de todas as telas do portal.
test('nenhuma tela do portal põe <form> dentro de <p> no HTML do servidor (hidratação)', async () => {
  for (const url of ROTAS) {
    const r = await paciente.page.request.get(url);
    expect(r.status(), url).toBe(200);
    const html = await r.text();
    expect(html.match(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?<form\b/)?.[0] ?? null, url).toBeNull();
  }
});

test('alvo de toque ≥ 44 px (RNF-10): a barra de ações e "Ver todo o diário" em Hoje, as semanas do agendamento, os botões da conversa da IA Nutri e o "Desativar…" de Eu', async () => {
  const altura = async (l: ReturnType<Page['getByRole']>) => (await l.boundingBox())?.height ?? 0;
  await paciente.page.goto('/p/inicio');
  for (const link of [paciente.page.getByRole('navigation', { name: 'Ações' }).getByRole('link').first(), paciente.page.getByRole('link', { name: 'Ver todo o diário' })])
    expect(await altura(link)).toBeGreaterThanOrEqual(44);
  await paciente.page.goto('/p/agenda/nova');
  expect(await altura(paciente.page.getByRole('navigation', { name: 'Semana' }).getByRole('link', { name: 'Próxima semana' }))).toBeGreaterThanOrEqual(44);
  // Plano 15 (RNF-167): a conversa (a resposta montada do preparo ainda tem a avaliação e o encaminhamento) e Eu
  await paciente.page.goto('/p/plano/ia');
  await paciente.page.waitForLoadState('networkidle'); // o campo é controlado pelo React: preenchido antes da hidratação, voltaria vazio
  await paciente.page.getByLabel('Sua dúvida').fill('quanto de chuchu no almoço?'); // os botões do formulário só se habilitam com texto
  for (const nome of ['Perguntar', 'Enviar direto para minha nutricionista', 'Ajudou', 'Não ajudou', 'Enviar para minha nutricionista']) {
    expect(await altura(paciente.page.getByRole('button', { name: nome, exact: true }).first()), nome).toBeGreaterThanOrEqual(44);
  }
  expect(await altura(paciente.page.getByRole('link', { name: 'Voltar para Plano' })), 'Voltar para Plano').toBeGreaterThanOrEqual(44);
  await paciente.page.goto('/p/perfil');
  expect(await altura(paciente.page.getByRole('button', { name: 'Desativar a IA Nutri e apagar as conversas' }))).toBeGreaterThanOrEqual(44);
  expect(await altura(paciente.page.getByRole('link', { name: 'Ler as conversas' }))).toBeGreaterThanOrEqual(44);
});

// Plano 15 (US-171, RNF-167): "Antes de usar a IA Nutri" só abre para quem foi liberada e ainda não decidiu — outra paciente,
// liberada e sem o consentimento. Claro, aparelho escuro, 360 px e 320 px com o texto a 200%.
test('IA Nutri: axe em "Antes de usar a IA Nutri" (/p/plano/ia/autorizar), claro e escuro, a 360 px e a 320 px com o texto a 200%', async ({ browser }) => {
  test.setTimeout(90_000);
  const semAceite = await pacienteNoPortal(browser, nutri, '10.9.29.64');
  try {
    await liberarIaNutri(semAceite.prontuario);
    const page = semAceite.page;
    const url = '/p/plano/ia/autorizar?de=plano';
    const tela = page.getByRole('heading', { level: 1, name: 'Antes de usar a IA Nutri' });
    for (const modo of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: modo });
      await page.goto(url);
      await expect(tela, modo).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await violacoes(page), modo).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    for (const largura of [360, 320]) {
      await page.setViewportSize({ width: largura, height: 780 });
      await page.goto(url);
      await expect(tela).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await violacoes(page), `${largura} px`).toEqual([]);
      if (largura === 320) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${largura} px`).toBe(true);
    }
    for (const nome of ['Autorizo o uso da IA Nutri', 'Agora não']) {
      expect((await page.getByRole(nome === 'Agora não' ? 'link' : 'button', { name: nome }).boundingBox())?.height ?? 0, nome).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await semAceite.page.context().close();
  }
});

// Plano 17 (P17-08): Eu › Lembretes sem nenhum lembrete (o push antigo ainda abre a tela: frase com sentido, sem redirecionar)
// — outra paciente, recém-cadastrada; Eu não mostra a seção "Lembretes". Claro, aparelho escuro e 320 px com o texto a 200%.
test('Lembretes: axe em Eu › Lembretes vazia (/p/perfil/lembretes), claro e escuro, e a 320 px com o texto a 200%', async ({ browser }) => {
  test.setTimeout(60_000);
  const semLembretes = await pacienteNoPortal(browser, nutri, '10.9.10.25');
  try {
    const page = semLembretes.page;
    await page.goto('/p/perfil');
    await expect(page.getByRole('heading', { level: 2, name: 'Lembretes', exact: true })).toHaveCount(0);
    const vazia = page.getByText('Sua nutricionista ainda não configurou lembretes para você.', { exact: true });
    for (const modo of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: modo });
      await page.goto('/p/perfil/lembretes');
      await expect(vazia, modo).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await violacoes(page), modo).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto('/p/perfil/lembretes');
    await expect(vazia).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await violacoes(page), '320 px').toEqual([]);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '320 px a 200%').toBe(true);
  } finally {
    await semLembretes.page.context().close();
  }
});

test('axe sem violações na página da consulta', async () => {
  await paciente.page.goto('/p/agenda');
  await paciente.page.getByRole('region', { name: 'Próximas' }).getByRole('link').first().click();
  await expect(paciente.page).toHaveURL(/\/p\/agenda\/[0-9a-f-]{36}$/);
  await paciente.page.waitForLoadState('networkidle');
  expect(await violacoes(paciente.page)).toEqual([]);
});

test('axe sem violações na página do link da exportação (R12a)', async () => {
  await paciente.page.goto('/p/perfil');
  await paciente.page.getByRole('button', { name: 'Baixar meus dados' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Pedimos seus dados.' })).toBeVisible();
  const email = await esperarEmail(paciente.email, { assunto: 'Exportação de dados pronta' });
  await semViolacoes(paciente.page, primeiroLink(email.texto, '/p/meus-dados/exportacoes/'));
  await expect(paciente.page.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
});

test('axe sem violações em "sem acesso" (paciente arquivado)', async ({ browser }) => {
  const outro = await pacienteNoPortal(browser, nutri, '10.9.10.23');
  await nutri.goto(`${outro.prontuario}/privacidade`);
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Arquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Desarquivar paciente' })).toBeVisible();
  await outro.page.goto('/p/inicio');
  await expect(outro.page).toHaveURL(/\/p\/sem-acesso$/);
  await outro.page.waitForLoadState('networkidle');
  expect(await violacoes(outro.page)).toEqual([]);
  await outro.page.context().close();
});

test('conta com três consultórios: axe em /p/escolher e /p/termo; trocar de nutricionista (sem login) apaga o plano guardado do outro vínculo (R12b, conferirDono)', async ({ browser }) => {
  const page = await entrarComo(browser, MULTI.email, MULTI.senha, '10.9.10.24');
  await expect(page).toHaveURL(/\/p\/escolher/);
  await expect(page.getByRole('heading', { name: 'Com qual nutricionista você quer entrar?' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await violacoes(page)).toEqual([]);

  // entra no consultório 1 e guarda o plano no aparelho
  await page.getByRole('button', { name: 'Consultório E2E', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await page.goto('/p/inicio'); // o service worker se registra na carga da página (a navegação do login/escolha é do roteador)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Plano' }).click();
  await expect(page).toHaveURL(/\/p\/plano$/);
  await expect.poll(() => entradasDoPlano(page)).toBe(1);

  // troca pelo Perfil, sem sair: o consultório 3 pede o termo (axe)...
  await page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Eu' }).click();
  expect((await page.getByRole('link', { name: 'Trocar de nutricionista' }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44); // RNF-10
  await page.getByRole('link', { name: 'Trocar de nutricionista' }).click();
  // achado 4 do /code-review: na escolha, a cópia do consultório 1 (ativo, escolhível) fica no aparelho
  await expect(page.getByRole('button', { name: 'Consultório E2E 3', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await entradasDoPlano(page)).toBe(1);
  await page.getByRole('button', { name: 'Consultório E2E 3', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/termo$/);
  await page.waitForLoadState('networkidle');
  expect(await violacoes(page)).toEqual([]);

  // ...e o 2 (termo aceito) abre o portal: a cópia do plano do consultório 1 sai do aparelho
  await page.goto('/p/escolher');
  await page.getByRole('button', { name: 'Consultório E2E 2', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await expect(page.getByText('Acompanhamento com Consultório E2E 2')).toBeVisible();
  await expect.poll(() => entradasDoPlano(page)).toBe(0);
  await page.context().close();
});

// Plano 10A (T16, RNF-144): as telas novas fora do painel (o painel entra pelo ROTAS_DO_PAINEL, e /p/documentos, com a
// receita emitida no beforeAll, pelas listas acima). O portal segue o aparelho (data-tema="sistema") e as páginas sem login
// ficam no claro: os "três modos" aqui são o aparelho claro e o escuro, e a 360 px.
test('documentos (Plano 10A): axe em /p/documentos, /v/<código> (válido e não encontrado) e /documento/<token> (pedir código), com o aparelho claro e escuro e a 360 px', async ({ browser }) => {
  test.setTimeout(180_000);
  // paciente sem o app (o convite não foi aceito): a receita assinada chega por um link no e-mail (RN-158)
  const email = `sem-app-${Date.now().toString(36)}@nutridebby.test`;
  // Plano 18 (RNF-263 g): pelo helper único do formulário (rótulos do cadastro em seções)
  await emitirReceita(docs, await criarPacientePeloFormulario(docs, { nome: 'Sara Sem App', email, nascimento: '1988-03-10' }));
  const aviso = await esperarEmail(email, { assunto: 'Você tem um novo documento' });
  const token = /\/documento\/([\w-]{92})/.exec(aviso.html)?.[1];
  expect(token, 'link do documento no e-mail').toBeTruthy();

  const anonimo = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.14.80' } })).newPage();
  const ociosa = (page: Page) => () => page.waitForLoadState('networkidle');
  const telas = [
    { page: paciente.page, url: '/p/documentos', espera: ociosa(paciente.page), estado: paciente.page.getByRole('heading', { name: /^Receita · / }) },
    { page: anonimo, url: `/v/${codigoDaReceita.replace(/-/g, '')}`, espera: ociosa(anonimo), estado: anonimo.getByRole('heading', { name: 'Documento válido' }) },
    { page: anonimo, url: '/v/000000000000', espera: ociosa(anonimo), estado: anonimo.getByText('Código não encontrado. Confira os 12 caracteres.') },
    // o Turnstile (site key de teste da Cloudflare, sempre passa) não deixa a rede ociosa: espera o token chegar, que
    // habilita o "Enviar código" (formulário hidratado e widget no lugar), como o agenda.spec e o recuperacao.spec
    { page: anonimo, url: `/documento/${token}`, espera: () => expect(anonimo.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 15_000 }), estado: anonimo.getByRole('button', { name: 'Enviar código' }) },
  ];
  try {
    for (const modo of ['light', 'dark'] as const) {
      for (const t of telas) {
        await t.page.emulateMedia({ colorScheme: modo });
        await t.page.goto(t.url);
        await t.espera();
        await expect(t.estado, `${modo}: ${t.url}`).toBeVisible();
        expect(await violacoes(t.page), `${modo}: ${t.url}`).toEqual([]);
      }
    }
    for (const t of telas) {
      await t.page.emulateMedia({ colorScheme: 'light' });
      await t.page.setViewportSize({ width: 360, height: 780 });
      await t.page.goto(t.url);
      await t.espera();
      await expect(t.estado, `360 px: ${t.url}`).toBeVisible();
      expect(await t.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `360 px: ${t.url}`).toBe(true);
      expect(await violacoes(t.page), `360 px: ${t.url}`).toEqual([]);
    }
  } finally {
    await paciente.page.emulateMedia({ colorScheme: 'light' });
    await paciente.page.setViewportSize(devices['Pixel 7'].viewport);
    await anonimo.context().close();
  }
});

test('paciente não alcança o painel nem a API da nutricionista (403 ou vai ao aviso de outro papel, nunca 500 nem dado)', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  const aviso = paciente.page.getByRole('status').filter({ hasText: 'Este aparelho está conectado como paciente.' });
  for (const rota of ['/painel', '/painel/pacientes', '/painel/agenda', '/painel/alimentos', '/painel/configuracoes', '/painel/diarios', `/painel/pacientes/${id}`, '/admin']) {
    await paciente.page.goto(rota);
    // P09-03: o papel errado não cai calado no portal — vai à tela que diz com qual conta o aparelho está
    await expect(paciente.page, rota).toHaveURL(rota === '/admin' ? /\/conta\/outro-papel\?esperado=admin$/ : /\/conta\/outro-papel\?esperado=nutri$/);
    await expect(aviso, rota).toHaveText(`Este aparelho está conectado como paciente. Saia e entre com a conta de ${rota === '/admin' ? 'administrador' : 'nutricionista'}.`);
  }
  // Pelo proxy, rota a rota (X-3: toda rota nova de /api/painel já é conferida, sem lista, em
  // src/app/api/painel/acesso-negado.test.ts)
  const chamadas: [string, string][] = [
    ['GET', '/api/painel/alimentos?q=arroz'],
    ['POST', '/api/painel/marca/logo'],
    ['POST', `/api/painel/pacientes/${id}/exames`],
    ['GET', `/api/painel/pacientes/${id}`],
    ['GET', `/api/painel/planos/${id}`],
    ['PUT', `/api/painel/planos/${id}`],
    ['GET', `/api/painel/planos/${id}/pdf`],
    ['GET', `/api/painel/planos/${id}/revisao`],
    ['GET', '/api/painel/whatsapp/estado'],
  ];
  for (const [metodo, url] of chamadas) {
    const r = await paciente.page.request.fetch(url, { method: metodo, maxRedirects: 0, data: metodo === 'GET' ? undefined : {} });
    expect(r.status(), `${metodo} ${url}`).toBe(403);
    expect(await r.json(), `${metodo} ${url}`).toEqual({ erro: 'Acesso negado' });
  }
});
