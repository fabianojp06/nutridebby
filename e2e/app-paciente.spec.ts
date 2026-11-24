import { expect, test, type Page } from '@playwright/test';
import { entrarComo, painelNoComputador } from './helpers';
import { avaliar, entradasDoPlano, pacienteNoPortal, publicarPlanoDoDia } from './portal';

// Plano 16 (US-191 a US-195). IPs (bloco da execução do Plano 16, 10.9.19.76 a 10.9.19.80; o limite de login é por IP):
// 10.9.19.76 (nutricionista) e 10.9.19.77 a 10.9.19.80 (pacientes, um por teste). Plano 22 (T6, US-375): 10.9.22.30
// (paciente nova do "Mostrar no app") e 10.9.22.31 (conta MULTI no "Consultório E2E 2", sem o recebimento de exames).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;
test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.19.76', painelNoComputador(browser));
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('Hoje: a refeição que vem aí; "Comi assim" com "Desfazer"; depois do prazo vai ao diário e a nutricionista vê "Comeu como no plano"', async ({ browser }) => {
  test.setTimeout(90_000);
  const p = await pacienteNoPortal(browser, nutri, '10.9.19.77');
  const horario = await publicarPlanoDoDia(nutri, p.prontuario);
  await p.page.goto('/p/inicio');
  await expect(p.page.getByRole('heading', { level: 1, name: /^Olá, Paula$/ })).toBeVisible();
  const item = p.page.getByRole('listitem').filter({ hasText: 'Almoço' }).filter({ hasText: horario });
  await expect(item).toBeVisible();
  await expect(item).not.toContainText('Sua nutricionista'); // RN-194: o lembrete é do app do consultório
  await expect(item).toContainText('Aviso do app'); // autor visível no texto (§11.1)
  await expect(p.page.getByText('O mural não é uma conversa com a sua nutricionista', { exact: false })).toBeVisible();
  await expect(p.page.locator('main textarea, main input[type="text"]')).toHaveCount(0); // C-191

  await item.getByRole('button', { name: 'Comi assim' }).click();
  await expect(item.getByRole('status')).toContainText('Registrado no diário.'); // + o sr-only "Para desfazer…"
  await item.getByRole('button', { name: 'Desfazer' }).click();
  await expect(item.getByRole('status')).toHaveText('Registro desfeito.');
  await p.page.goto('/p/diario');
  await expect(p.page.getByText('Nenhum registro ainda.')).toBeVisible(); // nada foi gravado

  await p.page.goto('/p/inicio');
  await item.getByRole('button', { name: 'Comi assim' }).click();
  await p.page.mouse.move(0, 0); // o ponteiro sobre o aviso pausa o prazo (WCAG 2.2.1): sai de cima dele
  await expect(item.getByRole('button', { name: 'Desfazer' })).toBeHidden({ timeout: 15_000 }); // 10 s e envia
  await expect(p.page.getByRole('listitem').filter({ hasText: 'Comi assim' }).filter({ hasText: `Almoço · ${horario}` })).toBeVisible();
  await expect(item.getByRole('button', { name: 'Comi assim' })).toHaveCount(0); // RN-197: some depois da resposta

  await nutri.goto('/painel/diarios');
  await expect(nutri.getByRole('listitem').filter({ hasText: p.nome }).filter({ hasText: 'Comeu como no plano' })).toBeVisible();
  await p.page.context().close();
});

test('RN-198: sair da tela dentro do prazo envia (o paciente já disse que comeu)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.19.78');
  const horario = await publicarPlanoDoDia(nutri, p.prontuario);
  await p.page.goto('/p/inicio');
  await p.page.getByRole('listitem').filter({ hasText: horario }).getByRole('button', { name: 'Comi assim' }).click();
  await p.page.goto('/p/diario'); // navegação inteira: pagehide → fetch com keepalive
  await expect
    .poll(
      async () => {
        await p.page.reload();
        return p.page.getByText('Comi assim', { exact: true }).count();
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
  await p.page.context().close();
});

test('"Não mostrar peso no app" (US-195, CS-194): nenhuma resposta do servidor ao aparelho traz o peso ou o IMC; desligar devolve', async ({ browser }) => {
  test.setTimeout(120_000);
  const p = await pacienteNoPortal(browser, nutri, '10.9.19.79');
  await publicarPlanoDoDia(nutri, p.prontuario);
  await avaliar(nutri, p.prontuario, '2026-03-18', '81.4');
  await avaliar(nutri, p.prontuario, '2026-09-22', '78.6');
  await nutri.goto(`${p.prontuario}/evolucao`);
  await nutri.getByLabel('Não mostrar peso no app').check();
  await nutri.getByRole('button', { name: 'Salvar' }).click();
  await expect(nutri.getByText(/^Peso oculto no app desde \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();

  const corpos: string[] = [];
  p.page.on('response', async (r) => {
    const tipo = r.request().resourceType();
    if (new URL(r.url()).pathname.startsWith('/p/') && (tipo === 'document' || tipo === 'fetch')) corpos.push(await r.text().catch(() => ''));
  });
  await p.page.goto('/p/inicio');
  await p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Jornada' }).click(); // RSC do roteador
  await expect(p.page).toHaveURL(/\/p\/jornada$/);
  await p.page.getByRole('link', { name: 'Todas as medidas' }).click();
  await expect(p.page).toHaveURL(/\/p\/evolucao$/);
  await p.page.goto('/p/jornada');
  await p.page.goto('/p/evolucao');
  await p.page.goto('/p/plano'); // a cópia offline
  await p.page.waitForLoadState('networkidle');
  expect(corpos.length).toBeGreaterThan(4);
  for (const c of corpos) expect(c).not.toMatch(/81[.,]4|78[.,]6|\d kg\b|IMC/);
  await expect(p.page.getByText('peso', { exact: false })).toHaveCount(0); // o app não diz que o peso está oculto

  await nutri.getByLabel('Não mostrar peso no app').uncheck();
  await nutri.getByRole('button', { name: 'Salvar' }).click();
  await expect(nutri.getByText(/^Peso oculto no app desde/)).toHaveCount(0);
  await p.page.goto('/p/jornada');
  // US-195 "Desligar": a medida volta na linha do tempo (o primeiro texto com o número é o <title> do ponto do gráfico, oculto)
  await expect(p.page.getByRole('paragraph').filter({ hasText: /78,6 kg/ }).first()).toBeVisible();
  await p.page.context().close();
});

test('offline (US-193, RN-208): o endereço de uma refeição cai na cópia do plano com a refeição aberta; os botões que gravam ficam desabilitados', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.19.80');
  const horario = await publicarPlanoDoDia(nutri, p.prontuario);
  await p.page.goto('/p/inicio');
  await p.page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Plano' }).click();
  await expect(p.page).toHaveURL(/\/p\/plano$/);
  await expect.poll(() => entradasDoPlano(p.page)).toBe(1);
  const id = (await p.page.locator('details[id^="ref-"]').first().getAttribute('id'))!.slice(4);
  await p.page.context().setOffline(true);
  await p.page.goto(`/p/plano/refeicao/${id}`);
  await expect(p.page.getByRole('status').filter({ hasText: 'Offline — exibindo última versão' })).toBeVisible();
  await expect(p.page.locator(`details#ref-${id}`)).toHaveAttribute('open', '');
  await expect(p.page.getByRole('heading', { name: `Almoço · ${horario}` })).toBeVisible();
  await expect(p.page.getByRole('button', { name: 'Comi assim' }).first()).toBeDisabled();
  await expect(p.page.getByText('Sem conexão. Registre quando voltar.').first()).toBeVisible();
  // P09-04: a cópia do plano servida offline navega sozinha quando a rede volta; sair dela antes de religar
  await p.page.goto('about:blank');
  await p.page.context().setOffline(false);
  await p.page.context().close();
});

/** A página não rola para o lado (o conteúdo cabe na largura da janela). */
const semRolagemLateral = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('Plano 22 (US-375): "Mostrar no app" no detalhe do exame; a paciente vê "Resultados liberados" a 360 px, com o aviso; "Retirar do app" tira', async ({ browser }) => {
  test.setTimeout(120_000);
  const p = await pacienteNoPortal(browser, nutri, '10.9.22.30');
  const titulo = `Rotina ${Date.now().toString(36)}`;
  await nutri.setViewportSize({ width: 1280, height: 800 });
  await nutri.goto(`${p.prontuario}/exames`);
  await nutri.getByLabel('Título do exame').fill(titulo);
  await nutri.getByLabel('Marcador 1', { exact: true }).fill('Glicemia de jejum');
  await nutri.getByLabel('Valor 1', { exact: true }).fill('105');
  await nutri.getByLabel('Unidade 1', { exact: true }).fill('mg/dL');
  await nutri.getByLabel('Faixa do laudo: de 1', { exact: true }).fill('70');
  await nutri.getByLabel('até 1', { exact: true }).fill('99');
  await nutri.getByRole('button', { name: 'Salvar exame' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Exame salvo.' })).toBeVisible();

  // antes de liberar: a paciente não vê o exame
  await p.page.setViewportSize({ width: 360, height: 800 });
  await p.page.goto('/p/exames');
  await expect(p.page.getByRole('heading', { name: 'Resultados liberados' })).toHaveCount(0);

  await nutri.getByRole('link', { name: new RegExp(`^Abrir ${titulo} de `) }).click();
  const mostrar = nutri.getByRole('button', { name: 'Mostrar no app do paciente' });
  await mostrar.click();
  const dialogo = nutri.getByRole('dialog', { name: 'Mostrar no app do paciente' });
  await expect(dialogo).toContainText('A nota de interpretação, as categorias do consultório e o laudo não aparecem.');
  await dialogo.getByRole('button', { name: 'Mostrar no app', exact: true }).click();
  await expect(dialogo).toBeHidden();
  await expect(nutri.getByRole('status').filter({ hasText: 'O exame aparece no app do paciente.' })).toBeVisible();
  await expect(nutri.getByText('No app', { exact: true })).toBeVisible();
  const retirar = nutri.getByRole('button', { name: 'Retirar do app' });
  await expect(retirar).toBeFocused(); // o mesmo botão, com o texto trocado: o foco não sai dele

  await p.page.reload();
  await expect(p.page.getByRole('heading', { level: 2, name: 'Resultados liberados' })).toBeVisible();
  await expect(p.page.getByText('Não é diagnóstico. Converse com sua nutricionista.')).toBeVisible();
  const cartao = p.page.getByRole('listitem').filter({ has: p.page.getByRole('heading', { level: 3, name: titulo }) });
  await expect(cartao).toContainText('Glicemia de jejum');
  await expect(cartao).toContainText('Resultado: 105 mg/dL');
  await expect(cartao).toContainText('Referência: 70 a 99');
  await expect(cartao).toContainText('Fora da referência');
  expect(await semRolagemLateral(p.page)).toBe(true);

  await retirar.click();
  await expect(nutri.getByRole('status').filter({ hasText: 'O exame saiu do app do paciente.' })).toBeVisible();
  await expect(nutri.getByRole('button', { name: 'Mostrar no app do paciente' })).toBeVisible();
  await p.page.reload();
  await expect(p.page.getByRole('heading', { name: 'Resultados liberados' })).toHaveCount(0);

  // o Histórico de acessos: "Liberou exame no app" e "Retirou exame do app", além do "Alterou" do gatilho
  await nutri.goto(`${p.prontuario}/historico`);
  await expect(nutri.getByRole('cell', { name: 'Liberou exame no app' }).first()).toBeVisible();
  await expect(nutri.getByRole('cell', { name: 'Retirou exame do app' }).first()).toBeVisible();
  await p.page.context().close();
});

test('Plano 22 (RN-386): com o recebimento desligado e sem envio, o exame liberado põe "Exames" no menu; sem "Enviar exame" nem "Meus exames enviados"', async ({ browser }) => {
  // scripts/e2e-seed.ts: o exame "Exames de rotina da semente", liberado, da MULTI no "Consultório E2E 2"
  const page = await entrarComo(browser, 'multi-e2e@nutridebby.test', 'Multi2026segura', '10.9.22.31', { viewport: { width: 360, height: 800 } });
  await expect(page).toHaveURL(/\/p\/escolher/);
  await page.getByRole('button', { name: 'Consultório E2E 2', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  const secoes = page.getByRole('navigation', { name: 'Seções' });
  await expect(secoes.getByRole('link', { name: 'Exames', exact: true })).toBeVisible();
  await secoes.getByRole('link', { name: 'Exames', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/exames$/);
  await expect(page.getByRole('heading', { level: 2, name: 'Resultados liberados' })).toBeVisible();
  const cartao = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: 'Exames de rotina da semente' }) });
  await expect(cartao).toContainText('Fora da referência');
  await expect(cartao).toContainText('Referência: Mulheres adultas: de 15 a 150 ng/mL, conforme o método do laboratório');
  await expect(page.getByRole('heading', { name: 'Enviar exame' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Meus exames enviados' })).toHaveCount(0);
  expect(await semRolagemLateral(page)).toBe(true); // a referência longa quebra a linha
  await page.context().close();
});
