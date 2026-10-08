import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { avaliar, entradasDoPlano, pacienteNoPortal, publicarPlanoDoDia } from './portal';

// Plano 16 (US-191 a US-195). IPs (bloco da execução do Plano 16, 10.9.19.76 a 10.9.19.80; o limite de login é por IP):
// 10.9.19.76 (nutricionista) e 10.9.19.77 a 10.9.19.80 (pacientes, um por teste).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;
test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.19.76');
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
  await expect(p.page.getByText('Este app não é um canal de conversa', { exact: false })).toBeVisible();
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
