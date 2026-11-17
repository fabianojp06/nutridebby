import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { escolherTema } from './painel';
import { pacienteNoPortal, publicarPlanoDoDia } from './portal';

// Plano 17 (P17-08): lembretes de rotina por push — a nutricionista salva a sugestão na aba Plano alimentar ("Lembretes no
// app"), o paciente desliga a água em Eu › Lembretes e a nutricionista vê "Desligado pelo paciente em …"; axe da seção nos
// três modos do painel (D25) nos estados que ROTAS_DO_PAINEL não alcança. O envio do push (worker) fica nos testes de
// src/modules/lembretes (o E2E não tem aparelho inscrito). Bloco de IP deste spec (o limite de login é por IP; bloco do
// Plano 17): 10.9.31.71 a 10.9.31.75 — nutricionista .71, paciente .72.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const INTRODUCAO =
  'Sua nutricionista configurou estes lembretes. Você pode desligar qualquer um ou pausar todos; ela vê o que você desligou ou pausou e se as notificações estão ativas.';
test.describe.configure({ mode: 'serial' });
let nutri: Page;
let paciente: Awaited<ReturnType<typeof pacienteNoPortal>>;

/** Hoje em São Paulo (o fuso do consultório do E2E), como a seção formata a data (dd/mm/aaaa). */
const hojeNoConsultorio = () => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.31.71', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
  paciente = await pacienteNoPortal(browser, nutri, '10.9.31.72');
  // o "Almoço" daqui a 30 min: o lembrete de refeições tem uma refeição com horário no plano publicado
  await publicarPlanoDoDia(nutri, paciente.prontuario);
});
test.afterAll(async () => {
  if (nutri) await escolherTema(nutri, 'Igual ao aparelho'); // o seed e as outras specs esperam o padrão
  await paciente?.page.context().close();
  await nutri?.context().close();
});

const secao = (page: Page) => page.locator('[data-guia="lembretes-app"]');

async function violacoes(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  // fundos com transparência caem em "incomplete" no color-contrast: não podem passar calados (como no acessibilidade-painel)
  const contrasteIncerto = r.incomplete.filter((i) => i.id === 'color-contrast').flatMap((i) => i.nodes.map((n) => `incompleto color-contrast: ${n.target.join(' ')}`));
  return [...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), ...contrasteIncerto];
}

test('a nutricionista salva a sugestão; o paciente desliga a água em Eu › Lembretes; a nutricionista vê "Desligado pelo paciente em …"', async () => {
  await nutri.goto(`${paciente.prontuario}/plano-alimentar`);
  const s = secao(nutri);
  await expect(s.getByRole('heading', { name: 'Lembretes no app' })).toBeVisible();
  await expect(s.getByRole('heading', { name: 'Sugestão — confira e salve' })).toBeVisible();
  await nutri.waitForLoadState('networkidle'); // formulários controlados pelo React: o clique antes da hidratação se perde

  // a água da sugestão (08:00–20:00 a cada 2 h): salva, o foco vai ao "Editar" do lembrete salvo
  await s.getByRole('button', { name: 'Salvar lembrete de água' }).click();
  await expect(s.getByRole('status')).toHaveText('Lembrete salvo.');
  await expect(s.getByRole('button', { name: 'Editar lembrete de água' })).toBeFocused();
  // o cartão de Refeições da sugestão continua na tela (a sugestão fica guardada no cliente; revisão final, F-01) e não há
  // "Adicionar refeições" ao lado dele; salvo também, a sugestão sai da tela
  const salvarRefeicoes = s.getByRole('button', { name: 'Salvar lembrete de refeições' });
  await expect(salvarRefeicoes).toBeVisible();
  await expect(s.getByRole('button', { name: 'Adicionar refeições' })).toHaveCount(0);
  await salvarRefeicoes.click();
  await expect(s.getByRole('button', { name: 'Editar lembrete de refeições' })).toBeFocused();
  await expect(s.getByRole('heading', { name: 'Sugestão — confira e salve' })).toHaveCount(0);
  await expect(s.getByRole('switch', { name: 'Água' })).toHaveAttribute('aria-checked', 'true');
  await expect(s.getByRole('switch', { name: 'Refeições' })).toHaveAttribute('aria-checked', 'true');
  await expect(s.getByText(/^Previsto para hoje: \d+ lembretes?$/)).toBeVisible();
  await expect(s.getByText('Este paciente ainda não ativou as notificações no app. Os lembretes começam quando ele ativar.')).toBeVisible();

  // o paciente: Eu › Lembretes (a seção de Eu só aparece com lembrete ligado pela equipe)
  const p = paciente.page;
  await p.goto('/p/perfil');
  await p.getByRole('link', { name: 'Ver meus lembretes' }).click();
  await expect(p).toHaveURL(/\/p\/perfil\/lembretes(\?|$)/);
  await expect(p.getByText(INTRODUCAO, { exact: true })).toBeVisible();
  await expect(p.getByText(/^Refeições: aviso na hora, nas refeições do seu plano$/)).toBeVisible();
  await p.waitForLoadState('networkidle');
  const agua = p.getByRole('switch', { name: /^Água: das 08:00 às 20:00, a cada 2 h · todos os dias$/ });
  await expect(agua).toHaveAttribute('aria-checked', 'true');
  // otimista: com a ação ainda presa na rede, o interruptor já mudou (e fica aria-disabled, sem perder o foco); a região de
  // status só anuncia quando a ação volta (o cartão "Ative as notificações" tem a sua própria região de status)
  let soltar = () => {};
  const presa = new Promise<void>((r) => (soltar = r));
  await p.route(/\/p\/perfil\/lembretes/, async (route) => {
    if (route.request().method() === 'POST') await presa;
    await route.continue();
  });
  const anuncio = p.getByRole('main').getByRole('status').filter({ hasText: 'Lembrete desligado.' });
  await agua.click();
  await expect(agua).toHaveAttribute('aria-checked', 'false');
  await expect(agua).toHaveAttribute('aria-disabled', 'true');
  await expect(anuncio).toHaveCount(0);
  soltar();
  await expect(anuncio).toHaveText('Lembrete desligado.');
  await expect(agua).not.toHaveAttribute('aria-disabled', 'true');
  await expect(agua).toHaveAttribute('aria-checked', 'false');
  await expect(agua).toBeFocused();
  await p.unroute(/\/p\/perfil\/lembretes/);
  await p.reload();
  await expect(p.getByRole('switch', { name: /^Água:/ })).toHaveAttribute('aria-checked', 'false');
  await expect(p.getByRole('switch', { name: /^Refeições:/ })).toHaveAttribute('aria-checked', 'true');

  // a nutricionista vê a marca do paciente; não apaga o que ele desligou (só o interruptor do lado dela)
  await nutri.reload();
  await expect(s.getByText(`Desligado pelo paciente em ${hojeNoConsultorio()}`, { exact: true })).toBeVisible();
  await expect(s.getByRole('button', { name: 'Apagar lembrete de água' })).toHaveCount(0);
  await expect(s.getByRole('button', { name: 'Apagar lembrete de refeições' })).toBeVisible();
  await expect(s.getByRole('switch', { name: 'Água' })).toHaveAttribute('aria-checked', 'true'); // o "ligado" da equipe não muda
});

for (const [modo, tema, aparelho] of [
  ['claro', 'Claro', 'light'],
  ['escuro', 'Escuro', 'light'],
  ['igual ao aparelho (aparelho escuro)', 'Igual ao aparelho', 'dark'],
] as const) {
  test(`axe na seção "Lembretes no app" com lembretes salvos ("Desligado pelo paciente em …") e com o suplemento aberto com erro — modo ${modo}`, async () => {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: aparelho });
    try {
      await nutri.goto(`${paciente.prontuario}/plano-alimentar`);
      const s = secao(nutri);
      await expect(s.getByText(/^Desligado pelo paciente em /)).toBeVisible();
      await nutri.waitForLoadState('networkidle');
      expect(await violacoes(nutri), `${modo}: lembretes salvos`).toEqual([]);

      await s.getByRole('button', { name: 'Adicionar suplemento' }).click();
      await expect(s.getByLabel('Nome do suplemento')).toBeFocused();
      await s.getByRole('button', { name: 'Salvar suplemento' }).click(); // vazio: o erro do servidor ao lado do campo
      await expect(s.getByRole('alert').filter({ hasText: 'Escreva o nome do suplemento.' })).toBeVisible();
      await expect(s.getByLabel('Nome do suplemento')).toHaveAttribute('aria-invalid', 'true');
      expect(await violacoes(nutri), `${modo}: suplemento com erro`).toEqual([]);
    } finally {
      await nutri.emulateMedia({ colorScheme: 'light' });
    }
  });
}
