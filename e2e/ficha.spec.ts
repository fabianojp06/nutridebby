import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { escolherTema } from './painel';
import { criarPacientePeloFormulario } from './pacientes-form';
import { avaliar } from './portal';

// Plano 18 (US-262, US-263, CS-260): a aba Início da ficha — o diálogo "Adicionar ao prontuário" (foco no título, Esc e
// "Fechar" devolvem o foco ao botão), os destinos por âncora com o foco no título ou no seletor de modelo, a Receita pela
// Server Action da aba Documentos e seção → item, cada um em até 2 cliques; axe do diálogo aberto, claro e escuro.
// Bloco de IP deste spec (o limite de login é por IP; bloco do Plano 18): 10.9.18.1 a 10.9.18.5 — nutricionista .1.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const UUID = '[0-9a-f-]{36}';
test.describe.configure({ mode: 'serial' });
let nutri: Page;
let prontuario: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(90_000);
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.18.1', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
  const sufixo = Date.now().toString(36);
  prontuario = await criarPacientePeloFormulario(nutri, { nome: `Fabi Ficha ${sufixo}`, email: `fabi-ficha-${sufixo}@nutridebby.test` });
  await avaliar(nutri, prontuario, '2026-10-12', '72');
});

test.afterAll(async () => {
  if (nutri) await escolherTema(nutri, 'Igual ao aparelho'); // o seed e as outras specs esperam o padrão
  await nutri?.context().close();
});

const botao = () => nutri.getByRole('button', { name: 'Adicionar ao prontuário' });
const dialogo = () => nutri.getByRole('dialog', { name: 'Adicionar ao prontuário' });

async function abrirAdicionar() {
  await nutri.goto(prontuario);
  await botao().click();
  await expect(dialogo()).toBeVisible();
}

test('abrir o diálogo põe o foco no título; Esc fecha e devolve o foco ao botão; "Fechar" também', async () => {
  await abrirAdicionar();
  await expect(dialogo().getByRole('heading', { name: 'Adicionar ao prontuário' })).toBeFocused();
  await expect(dialogo().getByText('Antes do plano alimentar, registre a anamnese, a antropometria e o gasto energético.')).toBeVisible();
  await expect(dialogo().getByRole('heading', { level: 3 })).toHaveText(['Avaliações', 'Prescrições', 'Outros']);
  // Plano 20 (US-308): "Nova entrada" abre o formulário do Financeiro com o paciente escolhido
  const id = prontuario.split('/').pop(); // prontuario = /painel/pacientes/{id}
  await expect(dialogo().getByRole('link', { name: 'Nova entrada', exact: true })).toHaveAttribute('href', `/painel/financeiro/lancamentos/novo?tipo=entrada&paciente=${id}`);
  await nutri.keyboard.press('Escape');
  await expect(dialogo()).toBeHidden();
  await expect(botao()).toBeFocused();
  await botao().click();
  await expect(dialogo()).toBeVisible();
  await dialogo().getByRole('button', { name: 'Fechar' }).click();
  await expect(dialogo()).toBeHidden();
  await expect(botao()).toBeFocused();
});

test('Adicionar → Antropometria abre a aba com o foco em "Nova avaliação" (2 cliques)', async () => {
  await abrirAdicionar(); // 1º clique
  await dialogo().getByRole('link', { name: 'Antropometria', exact: true }).click(); // 2º
  await expect(nutri).toHaveURL(new RegExp(`${prontuario}/antropometria#nova-avaliacao$`));
  await expect(nutri.getByRole('heading', { name: 'Nova avaliação', level: 2 })).toBeFocused();
});

test('Adicionar → Anamnese abre a aba com o foco no seletor de modelo (nunca a página sem modelo)', async () => {
  await abrirAdicionar();
  await dialogo().getByRole('link', { name: 'Anamnese', exact: true }).click();
  await expect(nutri).toHaveURL(new RegExp(`${prontuario}/anamnese#modelo$`));
  await expect(nutri.getByRole('heading', { name: 'Anamneses', level: 2 })).toBeVisible();
  await expect(nutri.getByLabel('Modelo', { exact: true })).toBeFocused();
});

test('Adicionar → Receita cria o rascunho, como "Nova receita" da aba Documentos', async () => {
  await abrirAdicionar();
  await dialogo().getByRole('button', { name: 'Receita', exact: true }).click();
  await expect(nutri).toHaveURL(new RegExp(`${prontuario}/documentos/${UUID}$`));
});

test('seção → item (2 cliques): a seção com registro já vem aberta; o item abre a tela dele', async () => {
  await nutri.goto(prontuario);
  const secoes = nutri.locator('[data-guia="secoes-inicio"]');
  await expect(secoes.getByRole('heading', { name: 'Antropometria (1)', level: 3 })).toBeVisible();
  await expect(secoes.getByRole('heading', { name: 'Documentos (1)', level: 3 })).toBeVisible();
  await expect(secoes.getByRole('heading', { name: 'Anamneses (0)', level: 3 })).toBeVisible();
  await expect(secoes.getByRole('heading', { name: 'Financeiro (0)', level: 3 })).toBeVisible(); // Plano 20 (US-308), no fim
  await expect(secoes.getByText('Nenhum registro ainda.').first()).toBeHidden(); // seção vazia vem fechada
  await expect(secoes.getByRole('link', { name: 'Ver todos: Antropometria' })).toHaveAttribute('href', `${prontuario}/antropometria`);
  await secoes.getByRole('link', { name: /^Receita · \d{2}\/\d{2}\/\d{4} · Rascunho$/ }).click();
  await expect(nutri).toHaveURL(new RegExp(`${prontuario}/documentos/${UUID}$`));
  await nutri.goto(prontuario);
  await secoes.getByRole('link', { name: 'Avaliação · 12/10/2026' }).click();
  await expect(nutri).toHaveURL(new RegExp(`${prontuario}/antropometria$`));
});

for (const tema of ['Claro', 'Escuro'] as const) {
  test(`axe do diálogo aberto, tema ${tema}`, async () => {
    await escolherTema(nutri, tema);
    await abrirAdicionar();
    // Como no sessao-equipe.spec (revisão final do Plano 15): o axe 4.13 empilha, sob cada linha de um texto, também o que
    // está atrás do diálogo modal; a dica ocupa duas linhas e a ficha por baixo muda entre elas, o que dá
    // "elmPartiallyObscuring" sem ser problema de contraste (o diálogo é opaco: bg-cartao, text-texto). A página por baixo
    // sai do cálculo (visibility: hidden, que o diálogo desfaz para si); o contraste conferido é o do texto sobre o diálogo.
    await nutri.evaluate(() => {
      for (const e of Array.from(document.body.children)) (e as HTMLElement).style.visibility = 'hidden';
      for (const d of Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))) d.style.visibility = 'visible';
    });
    const r = await new AxeBuilder({ page: nutri }).include('dialog[open]').withTags(TAGS).analyze();
    expect(r.passes.length, 'o axe rodou regras no diálogo').toBeGreaterThan(0);
    const contrasteIncerto = r.incomplete.filter((i) => i.id === 'color-contrast').flatMap((i) => i.nodes.map((n) => `incompleto color-contrast: ${n.target.join(' ')}`));
    expect([...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), ...contrasteIncerto]).toEqual([]);
  });
}
