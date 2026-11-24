import { expect, test, type Page } from '@playwright/test';
import { axeEmTodasAsTelas, FIN_AXE, NUTRI, rotasDoPainel, violacoes } from './acessibilidade-painel';
import { fichaPelaBusca, SEMENTE_COMPLETA, SEMENTE_INCOMPLETA } from './cadastro';
import { vigiarCsp } from './csp';
import { entrarComo, ESPERA_DO_SERVIDOR } from './helpers';
import { criarPacientePeloFormulario } from './pacientes-form';
import { escolherTema, prepararTelasComId } from './painel';
import { avaliar, pacienteNoPortal } from './portal';

// RNF-10 (D25): SUS-125, parte 1 de 2 do axe do painel (a parte 0, com os modos claro e escuro, é o
// acessibilidade-painel.spec; o que as duas dividem está em e2e/acessibilidade-painel.ts). Aqui: todas as telas no modo
// "igual ao aparelho" (aparelho escuro), o Financeiro não configurado, Início/Perfil/lista/"No app" da ficha, o resumo e o
// rascunho da IA com a tarefa pronta, o D17 (com a conta E2E_FIN_AXE) e os Relatórios a 360 px. Esta parte prepara as
// próprias linhas (`prepararTelasComId`, parte 1: outro paciente, outra semana da consulta) e usa os próprios IPs:
// 10.9.13.87 (nutri), 10.9.13.88 (paciente do preparo), 10.9.29.52 (a segunda paciente da IA Nutri), 10.9.20.2 (a conta
// E2E_FIN_AXE do Financeiro não configurado, Plano 20 — bloco 10.9.20.x), 10.9.13.85 (o "outro aparelho" do D17) e
// 10.9.29.31 (o paciente que autoriza a IA, Plano 14B-2).
test.describe.configure({ mode: 'serial', timeout: 360_000 }); // o laço visita todas as telas do painel (mais de 60 desde o Plano 22)
let nutri: Page;
let finAxe: Page;
let rotas: string[] = [];
let errosCsp: string[] = []; // D7: a CSP vale direto porque o E2E abre todas as telas sem violação — a prova é este laço

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // o preparo cria uma linha de cada tela com id
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.87');
  await expect(nutri).toHaveURL(/\/painel$/, { timeout: ESPERA_DO_SERVIDOR });
  errosCsp = vigiarCsp(nutri);
  rotas = rotasDoPainel(await prepararTelasComId(browser, nutri, '10.9.13.88', '10.9.29.52', 1));
  finAxe = await entrarComo(browser, FIN_AXE.email, FIN_AXE.senha, '10.9.20.2');
  await expect(finAxe).toHaveURL(/\/painel$/, { timeout: ESPERA_DO_SERVIDOR });
});
test.afterAll(async () => {
  await escolherTema(nutri, 'Igual ao aparelho'); // o seed e as outras specs esperam o padrão
  await nutri?.context().close();
  if (finAxe) await escolherTema(finAxe, 'Igual ao aparelho');
  await finAxe?.context().close();
});

test('axe sem violações em todas as telas do painel — modo igual ao aparelho (aparelho escuro)', async () => {
  await escolherTema(nutri, 'Igual ao aparelho');
  await nutri.emulateMedia({ colorScheme: 'dark' });
  const falhas = await axeEmTodasAsTelas(nutri, rotas, 'Igual ao aparelho');
  await nutri.emulateMedia({ colorScheme: 'light' });
  expect(falhas).toEqual([]);
  expect(errosCsp, 'violação de CSP em alguma tela do painel (D7)').toEqual([]);
});

/**
 * Plano 20 (RNF-302): os estados do Financeiro fora de ROTAS_DO_PAINEL — o primeiro acesso ("Comece por aqui": Resumo,
 * Pagamentos pendentes e Configurações sem categorias) com a conta E2E_FIN_AXE, o detalhe de pagamentos pendentes vazio (um
 * paciente sem cobrança no mesmo consultório) e o formulário de lançamento com erro (a nutricionista do E2E, que tem o
 * Financeiro configurado pela semente: valor vazio e "Já foi recebido" sem a forma) — nos modos claro e escuro, a 1280 e
 * a 360 px (a 360 px, sem rolagem lateral). As telas do Financeiro de ROTAS_DO_PAINEL entram também a 360 px (a 1280 px
 * já estão nos laços de todas as telas).
 */
test('Plano 20: Financeiro não configurado, pagamentos pendentes vazios e lançamento com erro, claro e escuro, 1280 e 360 px', async () => {
  test.setTimeout(240_000);
  const fa = finAxe;
  const sufixo = Date.now().toString(36);
  const nome = `Paciente Fin Axe ${sufixo}`;
  const semCobranca = (await criarPacientePeloFormulario(fa, { nome, email: `fin-axe-${sufixo}@nutridebby.test` })).split('/').pop()!;
  const comece = (page: Page) => expect(page.getByRole('heading', { name: 'Comece por aqui' })).toBeVisible();
  const estados: { page: Page; url: string; pronta: (page: Page) => Promise<void> }[] = [
    { page: fa, url: '/painel/financeiro', pronta: comece },
    { page: fa, url: '/painel/financeiro/pendencias', pronta: comece },
    { page: fa, url: '/painel/financeiro/configuracoes', pronta: (p) => expect(p.getByLabel('Valor do saldo')).toBeVisible() },
    { page: fa, url: `/painel/financeiro/pendencias/${semCobranca}`, pronta: (p) => expect(p.getByText(`Nenhum pagamento pendente de ${nome}.`)).toBeVisible() },
    {
      page: nutri,
      url: '/painel/financeiro/lancamentos/novo?tipo=entrada',
      pronta: async (p) => {
        // A categoria já vem escolhida (a primeira ativa) e o vencimento vem com hoje: os erros que o formulário dá de fato
        // são o valor vazio e, com "Já foi recebido" marcado, a forma em "Selecione" (role="alert", junto dos campos).
        await p.getByLabel('Já foi recebido').check();
        await p.getByRole('button', { name: 'Salvar entrada' }).click();
        await expect(p.getByRole('alert').filter({ hasText: 'Informe o valor.' })).toBeVisible();
        await expect(p.getByRole('alert').filter({ hasText: 'Escolha a forma de pagamento.' })).toBeVisible();
      },
    },
  ];
  const doFinanceiro = rotas.filter((u) => u.startsWith('/painel/financeiro'));
  expect(doFinanceiro.length, 'as telas do Financeiro em ROTAS_DO_PAINEL').toBeGreaterThan(0);
  const falhas: string[] = [];
  for (const tema of ['Claro', 'Escuro'] as const) {
    await escolherTema(fa, tema);
    await escolherTema(nutri, tema);
    for (const largura of [1280, 360]) {
      const telas = largura === 360 ? [...estados, ...doFinanceiro.map((url) => ({ page: nutri, url, pronta: async () => {} }))] : estados;
      for (const t of telas) {
        await t.page.setViewportSize({ width: largura, height: largura === 360 ? 780 : 720 });
        await t.page.goto(t.url);
        await t.pronta(t.page);
        await t.page.waitForLoadState('networkidle');
        for (const v of await violacoes(t.page, undefined, { tema })) falhas.push(`${tema} ${largura} px ${t.url} — ${v}`);
        if (largura === 360 && !(await t.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) {
          falhas.push(`${tema} 360 px ${t.url} — rola na horizontal`);
        }
      }
    }
    for (const p of [fa, nutri]) await p.setViewportSize({ width: 1280, height: 720 });
  }
  expect(falhas).toEqual([]);
});

/**
 * Plano 18 (RNF-261): o Início (com o cartão e o selo "No app"; com a nota "Cadastro incompleto"), o Perfil com o cadastro
 * inteiro, a lista e a página "No app do paciente", a 1280 e a 360 px, claro e escuro. As pacientes do cadastro do seed
 * (e2e/cadastro.ts): a completa tem conta, nome social, CPF e uma avaliação; a incompleta mostra a nota. Os estados abertos
 * (menu da linha, diálogo Adicionar, CPF repetido) ficam no cadastro.spec e no ficha.spec.
 */
test('Plano 18: Início, Perfil, lista e "No app do paciente" a 1280 e 360 px, claro e escuro', async () => {
  test.setTimeout(240_000);
  const completa = await fichaPelaBusca(nutri, SEMENTE_COMPLETA.email, SEMENTE_COMPLETA.nomeSocial);
  const incompleta = await fichaPelaBusca(nutri, SEMENTE_INCOMPLETA.email, SEMENTE_INCOMPLETA.nome);
  const telas = [
    { url: '/painel/pacientes', pronta: () => expect(nutri.getByRole('heading', { level: 1, name: 'Pacientes' })).toBeVisible() },
    { url: completa, pronta: () => expect(nutri.getByRole('region', { name: 'No app do paciente' })).toBeVisible() },
    { url: incompleta, pronta: () => expect(nutri.getByText('Cadastro incompleto: faltam estado civil e endereço.')).toBeVisible() },
    { url: `${completa}/perfil`, pronta: () => expect(nutri.getByLabel('CPF (opcional)')).toHaveValue(SEMENTE_COMPLETA.cpf) },
    { url: `${completa}/app`, pronta: () => expect(nutri.getByRole('heading', { name: 'No app do paciente' })).toBeVisible() },
  ];
  const falhas: string[] = [];
  try {
    for (const [largura, altura] of [[1280, 720], [360, 800]] as const) {
      await nutri.setViewportSize({ width: largura, height: altura });
      for (const tema of ['Claro', 'Escuro'] as const) {
        await escolherTema(nutri, tema);
        for (const t of telas) {
          await nutri.goto(t.url);
          await t.pronta();
          await nutri.waitForLoadState('networkidle');
          for (const v of await violacoes(nutri, undefined, { ignorarForaDaTela: largura < 1280, tema })) falhas.push(`${largura} px ${tema} ${t.url} — ${v}`);
        }
      }
    }
  } finally {
    await nutri.setViewportSize({ width: 1280, height: 720 });
    await escolherTema(nutri, 'Igual ao aparelho');
  }
  expect(falhas).toEqual([]);
});

/**
 * Plano 14B-2 (US-120, US-121): as telas do resumo e do rascunho com a tarefa PRONTA (nos laços de todas as telas, o
 * paciente não autorizou a IA e elas mostram só o aviso). Um paciente que autoriza a versão 1.1 no app, duas
 * antropometrias (a tabela "Dados usados" aparece) e as duas tarefas pelo sandbox (nenhuma chamada à API real).
 */
test('Plano 14B-2: o resumo do histórico e o rascunho de plano com a tarefa pronta, nos três modos e em 768 px', async ({ browser }) => {
  test.setTimeout(240_000);
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.29.31');
  await paciente.page.goto('/p/perfil/ia');
  await paciente.page.getByRole('button', { name: 'Autorizo o envio para fora do Brasil' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Autorização registrada. Você pode retirar quando quiser.' })).toBeVisible();
  await paciente.page.context().close();
  const p = paciente.prontuario;
  await avaliar(nutri, p, '2026-08-01', '80');
  await avaliar(nutri, p, '2026-09-01', '78,5');
  await nutri.goto(`${p}/resumo-ia`);
  await nutri.getByRole('button', { name: 'Gerar resumo' }).click();
  await expect(nutri.getByText(/^Resumo gerado por IA em /)).toBeVisible({ timeout: 90_000 });
  await nutri.goto(`${p}/plano-alimentar/rascunho-ia`);
  await nutri.getByLabel('Meta de energia (kcal/dia)').fill('1800');
  await nutri.getByLabel('Proteína (% da energia)').fill('20');
  await nutri.getByLabel('Carboidrato (%)').fill('50');
  await nutri.getByLabel('Lipídio (%)').fill('30');
  await nutri.getByRole('button', { name: 'Gerar rascunho' }).click();
  await expect(nutri.getByRole('heading', { name: 'Rascunho sugerido pela IA' })).toBeVisible({ timeout: 120_000 });

  const telas = [
    { url: `${p}/resumo-ia`, pronta: () => expect(nutri.getByRole('table', { name: 'Dados usados' })).toBeVisible() },
    { url: `${p}/plano-alimentar/rascunho-ia`, pronta: () => expect(nutri.getByRole('button', { name: 'Usar como rascunho' })).toBeVisible() },
  ];
  const falhas: string[] = [];
  for (const [tema, aparelho] of [['Claro', 'light'], ['Escuro', 'light'], ['Igual ao aparelho', 'dark']] as const) {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: aparelho });
    for (const t of telas) {
      await nutri.goto(t.url);
      await t.pronta();
      await nutri.waitForLoadState('networkidle');
      for (const v of await violacoes(nutri, undefined, { tema })) falhas.push(`${tema} ${t.url} — ${v}`);
    }
  }
  await nutri.emulateMedia({ colorScheme: 'light' });
  expect(falhas).toEqual([]);
  await nutri.setViewportSize({ width: 768, height: 1000 });
  try {
    for (const t of telas) {
      await nutri.goto(t.url);
      await t.pronta();
      expect(await nutri.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), t.url).toBe(true);
    }
  } finally {
    await nutri.setViewportSize({ width: 1280, height: 720 });
  }
});

// SUS-125: com a conta E2E_FIN_AXE, que só esta parte usa (o Plano 20, acima, também troca o tema dela, mas em série com
// este teste). Com a nutri-e2e, o tema é trocado ao mesmo tempo pela parte 0 e pelas specs do outro worker (cadastro,
// ficha, lembretes), e o recarregar daria o tema de outra spec.
test('D17: o botão de tema alterna, persiste depois de recarregar e em outro aparelho (está na conta, não no navegador)', async ({ browser }) => {
  await escolherTema(finAxe, 'Claro');
  await finAxe.goto('/painel');
  const botao = finAxe.getByRole('button', { name: 'Modo escuro' });
  await expect(botao).toHaveAttribute('aria-pressed', 'false');
  await botao.focus();
  await finAxe.keyboard.press('Enter');
  await expect(finAxe.locator('[data-tema="escuro"]')).toBeAttached();
  await finAxe.reload();
  await expect(finAxe.getByRole('button', { name: 'Modo escuro' })).toHaveAttribute('aria-pressed', 'true');
  await finAxe.goto('/conta/seguranca'); // fora do /painel, o mesmo tema da conta (D17)
  await expect(finAxe.locator('[data-tema="escuro"]')).toBeAttached();
  const outro = await entrarComo(browser, FIN_AXE.email, FIN_AXE.senha, '10.9.13.85');
  await expect(outro.locator('[data-tema="escuro"]')).toBeAttached();
  await outro.context().close();
});

/**
 * Plano 26 (RNF-481): as sete telas dos Relatórios (as seis seções e a impressão) a 1280 e a 360 px, claro e escuro — a
 * 1280 px elas já passam nos laços de ROTAS_DO_PAINEL nos três modos; aqui, também a 360 px (sem rolagem lateral: a tabela
 * por mês rola dentro da própria região) e o erro do período aberto (`aria-invalid` e o aviso com o foco). A impressão
 * grava um `exportar` sem paciente a cada visita (agregado da Agenda), como nos laços de todas as telas.
 */
test('Plano 26: Relatórios (seções, erro do período e impressão) a 1280 e 360 px, claro e escuro', async () => {
  test.setTimeout(240_000);
  const doRelatorio = rotas.filter((u) => u.startsWith('/painel/relatorios'));
  expect(doRelatorio, 'as telas dos Relatórios em ROTAS_DO_PAINEL').toHaveLength(7);
  const telas = [...doRelatorio, '/painel/relatorios/agenda?de=2026-06&ate=2026-01'];
  const falhas: string[] = [];
  try {
    for (const [largura, altura] of [[1280, 720], [360, 800]] as const) {
      await nutri.setViewportSize({ width: largura, height: altura });
      for (const tema of ['Claro', 'Escuro'] as const) {
        await escolherTema(nutri, tema);
        for (const url of telas) {
          await nutri.goto(url);
          await expect(nutri.getByRole('heading', { level: 1 })).toBeVisible();
          await nutri.waitForLoadState('networkidle');
          for (const v of await violacoes(nutri, undefined, { ignorarForaDaTela: largura < 1280, tema })) falhas.push(`${largura} px ${tema} ${url} — ${v}`);
          if (largura === 360 && !(await nutri.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) falhas.push(`${tema} 360 px ${url} — rola na horizontal`);
        }
      }
    }
    // o erro do período: o "De" inválido e descrito pelo aviso, que recebe o foco no carregamento
    await nutri.goto('/painel/relatorios/agenda?de=2026-06&ate=2026-01');
    await expect(nutri.getByLabel('De', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(nutri.getByText('O mês inicial não pode ser depois do final.')).toBeFocused();
  } finally {
    await nutri.setViewportSize({ width: 1280, height: 720 });
    await escolherTema(nutri, 'Igual ao aparelho');
  }
  expect(falhas).toEqual([]);
});
