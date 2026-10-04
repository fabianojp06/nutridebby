import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { pacienteNoPortal, publicarPlanoSimples } from './portal';

// §9.7 / US-050 a US-056. Bloco de IP deste spec (o limite de login é por IP): 10.9.11.19 a .21 — nutri .19, Ana .20, Bia .21.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;
let ana: Awaited<ReturnType<typeof pacienteNoPortal>>;
let bia: Awaited<ReturnType<typeof pacienteNoPortal>>;
const sufixo = Date.now().toString(36);
const VIDEO = `Como montar o prato ${sufixo}`;
const RECEITA = `Panqueca de aveia ${sufixo}`;
let urlDoVideo = '';
let urlDaReceita = '';

/** RNF-10: WCAG 2.1 AA nas telas novas do PWA (como e2e/acessibilidade.spec.ts). */
async function semViolacoes(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.11.19');
  await expect(nutri).toHaveURL(/\/painel$/);
  ana = await pacienteNoPortal(browser, nutri, '10.9.11.20');
  bia = await pacienteNoPortal(browser, nutri, '10.9.11.21');
});
test.afterAll(async () => {
  await ana?.page.context().close();
  await bia?.page.context().close();
  await nutri?.context().close();
});

test('vídeo só para a Ana (US-050, US-053): a Ana vê no feed com "Novo" e o player sem cookies; a Bia recebe 404 pela URL', async () => {
  await nutri.goto('/painel/conteudos');
  await nutri.getByRole('link', { name: 'Novo vídeo' }).click();
  await nutri.getByLabel('Título').fill(VIDEO);
  await nutri.getByLabel('Link do vídeo').fill('https://youtu.be/dQw4w9WgXcQ');
  await expect(nutri.getByText('Vídeos não listados podem ser vistos por quem tiver o link.')).toBeVisible();
  await nutri.getByLabel('Pacientes específicos').check();
  await nutri.getByLabel(ana.nome).check();
  await nutri.getByRole('button', { name: 'Criar' }).click();
  await expect(nutri).toHaveURL(/\/painel\/conteudos\/[0-9a-f-]{36}$/);
  await nutri.getByLabel('Avisar pacientes').check();
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Conteúdo publicado. Aviso enviado para 1 paciente.' })).toBeVisible();

  await ana.page.goto('/p/conteudos');
  const cartao = ana.page.getByRole('link', { name: new RegExp(VIDEO) });
  await expect(cartao).toContainText('Novo');
  await cartao.click();
  await expect(ana.page).toHaveURL(/\/p\/conteudos\/[0-9a-f-]{36}$/); // a navegação é do roteador: espera a URL do detalhe
  urlDoVideo = new URL(ana.page.url()).pathname;
  await expect(ana.page.locator(`iframe[title="Vídeo: ${VIDEO}"]`)).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  await expect
    .poll(async () => {
      await ana.page.goto('/p/conteudos');
      return ana.page.getByRole('link', { name: new RegExp(VIDEO) }).getByText('Novo').count();
    })
    .toBe(0); // US-055: visualização registrada ao abrir

  const resposta = await bia.page.goto(urlDoVideo);
  expect(resposta?.status()).toBe(404);
  await expect(bia.page.getByText(VIDEO)).toHaveCount(0); // nem o título na página do 404
  // a liberação do cartão do plano vale só para receita do plano dela: o vídeo continua 404
  expect((await bia.page.goto(`${urlDoVideo}?de=plano`))?.status()).toBe(404);
  await expect(bia.page.getByText(VIDEO)).toHaveCount(0);
  await bia.page.goto('/p/conteudos');
  await expect(bia.page.getByRole('link', { name: new RegExp(VIDEO) })).toHaveCount(0);
});

test('receita (US-051, US-055): valor por porção, busca + etiqueta e favoritos', async () => {
  await nutri.goto('/painel/conteudos/novo?tipo=receita');
  await nutri.getByLabel('Título').fill(RECEITA);
  await nutri.getByLabel('Etiquetas do conteúdo').fill('sem lactose');
  await nutri.getByRole('button', { name: 'Criar' }).click();
  await expect(nutri).toHaveURL(/\/painel\/conteudos\/[0-9a-f-]{36}$/);
  urlDaReceita = new URL(nutri.url()).pathname;
  await nutri.getByLabel('Rendimento total (g)').fill('1000');
  await nutri.getByLabel('Porção (g)').fill('1200');
  await nutri.getByLabel('Adicionar ingrediente').fill('aveia flocos');
  await nutri.getByRole('option', { name: /Aveia, flocos/ }).first().click();
  await nutri.getByLabel(/^Gramas de Aveia, flocos/).fill('500');
  await nutri.getByRole('button', { name: 'Salvar receita' }).click();
  await expect(nutri.getByRole('alert').filter({ hasText: 'A porção não pode ser maior que o rendimento' })).toBeVisible();
  await nutri.getByLabel('Porção (g)').fill('250');
  await expect(nutri.getByText(/^Por porção: \d+ kcal · proteína/)).toBeVisible();
  await nutri.getByRole('button', { name: 'Salvar receita' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Receita salva.' })).toBeVisible();
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Conteúdo publicado.' })).toBeVisible();

  await ana.page.goto('/p/conteudos');
  await ana.page.getByLabel('Buscar').fill('aveia');
  await ana.page.getByLabel('Etiqueta').selectOption('sem lactose');
  await ana.page.getByRole('button', { name: 'Buscar' }).click();
  await ana.page.getByRole('link', { name: new RegExp(RECEITA) }).click();
  await expect(ana.page.getByText(/^Por porção: \d+ kcal/)).toBeVisible();
  await semViolacoes(ana.page);
  await ana.page.getByRole('button', { name: 'Favoritar' }).click();
  await expect(ana.page.getByRole('button', { name: 'Remover dos favoritos' })).toBeVisible();
  await ana.page.goto('/p/conteudos?favoritos=1');
  await expect(ana.page.getByRole('link', { name: new RegExp(RECEITA) })).toBeVisible();
});

test('receita na refeição (US-054): a Bia vê a "Sugestão de receita" no plano; despublicada, o cartão some', async () => {
  // a receita é "todos"; o caso "fora da audiência" (só pelo cartão, fora do feed) é coberto nos testes das Tarefas 2, 7 e 9
  await publicarPlanoSimples(nutri, bia.prontuario);
  await nutri.getByRole('button', { name: 'Editar' }).click();
  await expect(nutri.getByRole('heading', { name: /Plano alimentar — versão \d+/ })).toBeVisible();
  await nutri.getByLabel('Sugestão de receita em Almoço').selectOption({ label: RECEITA });
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 10_000 });
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Plano publicado.' })).toBeVisible();

  await bia.page.goto('/p/plano');
  await expect(bia.page.getByText('Sugestão de receita:')).toBeVisible();
  const doCartao = `${urlDaReceita.replace('/painel/conteudos/', '/p/conteudos/')}?de=plano`;
  await expect(bia.page.getByRole('link', { name: RECEITA })).toHaveAttribute('href', doCartao);
  await semViolacoes(bia.page);

  await nutri.goto(urlDaReceita);
  await nutri.getByRole('button', { name: 'Despublicar' }).click();
  // exact: sem ele, 'Publicar' casa com 'Despublicar' (substring, sem caixa) e a espera passa antes de a action gravar
  await expect(nutri.getByRole('button', { name: 'Publicar', exact: true })).toBeVisible();
  await bia.page.goto('/p/plano');
  await expect(bia.page.getByText('Sugestão de receita:')).toHaveCount(0);
  // D2: despublicada, nem o caminho do cartão abre a receita
  expect((await bia.page.goto(doCartao))?.status()).toBe(404);
  await expect(bia.page.getByText(RECEITA)).toHaveCount(0);
});
