import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { entrarComo } from './helpers';
import { pacienteNoPortal } from './portal';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;

// O limite de login é por IP: este spec usa 10.9.16.61 a 10.9.16.65 (nutri em .61; cada paciente com o seu)
test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.16.61');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

async function laudo(paginas: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < paginas; i++) doc.addPage([595, 842]).drawText(`Glicose de jejum 92 mg/dL (página ${i + 1})`, { x: 50, y: 780, size: 12, font: fonte });
  return Buffer.from(await doc.save());
}
async function enviar(p: Page, nome: string, pdf: Buffer) {
  await p.goto('/p/exames');
  await p.getByLabel('Data da coleta').fill('2026-09-28');
  await p.getByLabel('Nome do exame (opcional)').fill(nome);
  await p.getByLabel('PDF ou fotos do exame').setInputFiles({ name: 'laudo.pdf', mimeType: 'application/pdf', buffer: pdf });
  await p.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(p.getByRole('status').filter({ hasText: 'Exame enviado. Sua nutricionista vai revisar.' })).toBeVisible();
}
const situacao = async (p: Page, texto: string) =>
  expect.poll(async () => {
    await p.reload();
    return p.getByText(texto).count();
  }, { timeout: 60_000 }).toBeGreaterThan(0);

test('US-160 a US-163: o paciente envia um PDF, o worker processa, a nutricionista vê as páginas e aceita; o paciente vê "Recebido no seu prontuário"', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.16.62');
  await p.page.goto('/p/inicio');
  await p.page.getByRole('link', { name: 'Enviar exame' }).click();
  await expect(p.page).toHaveURL(/\/p\/exames(#enviar)?$/);
  await expect(p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Exames' })).toHaveAttribute('aria-current', 'page');
  await enviar(p.page, 'Hemograma E2E', await laudo(2));
  await situacao(p.page, 'Aguardando sua nutricionista');
  await expect(p.page.getByRole('link', { name: /Baixar PDF/ })).toBeVisible();

  await nutri.goto('/painel/exames-recebidos');
  await nutri.getByRole('link', { name: new RegExp(p.nome) }).first().click();
  await expect(nutri.getByRole('img', { name: 'Página 1 de 2 do exame enviado' })).toBeVisible();
  await expect(nutri.getByRole('img', { name: 'Página 2 de 2 do exame enviado' })).toBeVisible();
  await nutri.getByText('Aceitar', { exact: true }).click();
  await expect(nutri.getByLabel('Título')).toHaveValue('Hemograma E2E');
  await expect(nutri.getByLabel('Data')).toHaveValue('2026-09-28');
  await nutri.getByRole('button', { name: 'Salvar no prontuário' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Exame salvo no prontuário.' })).toBeVisible();
  await expect(nutri.getByText('Enviado pelo paciente')).toBeVisible();

  await situacao(p.page, 'Recebido no seu prontuário');
  await expect(p.page.getByRole('link', { name: /Baixar PDF/ })).toHaveCount(0);
  await p.page.context().close();
});

test('US-161 e US-164: o paciente cancela um envio; a nutricionista recusa outro com "Outro motivo" e o paciente vê o motivo', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.16.63');
  await enviar(p.page, 'Para cancelar', await laudo(1));
  await situacao(p.page, 'Aguardando sua nutricionista');
  p.page.once('dialog', (d) => d.accept()); // "Cancelar este envio? O arquivo será apagado."
  await p.page.getByRole('button', { name: /Cancelar envio/ }).click();
  await expect(p.page.getByText('Para cancelar')).toHaveCount(0);

  await enviar(p.page, 'Para recusar', await laudo(1));
  await situacao(p.page, 'Aguardando sua nutricionista');
  await nutri.goto('/painel/exames-recebidos');
  await nutri.getByRole('link', { name: new RegExp(p.nome) }).first().click();
  await nutri.getByText('Recusar', { exact: true }).click();
  await nutri.getByLabel('Outro motivo').check();
  await nutri.getByRole('button', { name: 'Confirmar recusa' }).click();
  await expect(nutri.getByRole('alert').filter({ hasText: 'Escreva o motivo para o paciente' })).toBeVisible();
  await nutri.getByLabel('Escreva o motivo').fill('Faltou a página com os resultados');
  await nutri.getByRole('button', { name: 'Confirmar recusa' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Envio recusado.' })).toBeVisible();
  await situacao(p.page, 'Não aceito: Faltou a página com os resultados');
  await p.page.context().close();
});

test('US-160 "PDF longo": 11 páginas → o paciente vê a mensagem do limite de páginas', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.16.64');
  await enviar(p.page, 'Longo', await laudo(11));
  await expect(p.page.getByRole('heading', { level: 3, name: 'Longo' })).toBeVisible();
  const viuProcessando = await p.page.getByRole('listitem').getByText('Processando…', { exact: true }).isVisible();
  // hotfix 09/10/2026: sem recarregar — enquanto o envio processa, a lista se atualiza sozinha (5 s) até o worker terminar
  const falhou = 'O PDF tem mais de 10 páginas. Envie só as páginas com os resultados.';
  await expect(p.page.getByRole('listitem').getByText(falhou, { exact: true })).toBeVisible({ timeout: 60_000 });
  // e a troca é anunciada na região viva única da lista (se o worker terminou antes do 1º refresh, não houve troca a anunciar)
  if (viuProcessando) await expect(p.page.locator('section[aria-labelledby="enviados"] > p[role="status"]')).toHaveText(`Longo: ${falhou}`);
  await p.page.context().close();
});

test('celular a 360 px (RNF-09): /p/exames não rola na horizontal e "Data da coleta" fica dentro do cartão', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.16.65');
  await p.page.setViewportSize({ width: 360, height: 780 });
  await p.page.goto('/p/exames');
  await p.page.getByLabel('Data da coleta').fill('2026-09-28');
  expect(await p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const dentro = await p.page.getByLabel('Data da coleta').evaluate((el) => {
    const campo = el.getBoundingClientRect();
    const cartao = el.closest('section')!.getBoundingClientRect();
    return campo.left >= cartao.left && campo.right <= cartao.right;
  });
  expect(dentro).toBe(true);
  await p.page.context().close();
});
