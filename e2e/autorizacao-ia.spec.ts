import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument } from 'pdf-lib';
import { violacoesNoPainel } from './documentos';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';
import { pacienteNoPortal } from './portal';

// Plano 14A (US-105 a US-109): os três canais da autorização de IA com IA_PROVEDOR=sandbox e IA_RETENCAO_ZERO=1 (nenhuma
// chamada à API real). IPs (faixa só deste spec, 10.9.27.51 a .55; o limite de login é por IP): link — nutricionista .51,
// paciente .52, sem login .53; papel — nutricionista .54, paciente .55.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };

test('link por e-mail: pedido → página sem login → autorizo → confirmação → retirar pelo link do e-mail', async ({ browser }) => {
  test.setTimeout(120_000);
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.27.51', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.27.52');
  await nutri.goto(`${paciente.prontuario}/privacidade`);
  const antes = new Date();
  await nutri.getByRole('button', { name: 'Enviar pedido de autorização por e-mail' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Pedido enviado. O link vale por 7 dias.' })).toBeVisible();
  expect(await violacoesNoPainel(nutri), 'aba Privacidade com a seção Uso de IA').toEqual([]);
  const pedido = await esperarEmail(paciente.email, { assunto: 'Consultório E2E: autorização para uso de inteligência artificial', depoisDe: antes });
  expect(pedido.texto).toContain('Esta autorização é pessoal. Se você recebeu este e-mail por engano, não toque em Autorizo.'); // F4

  const anonimo = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.27.53' } })).newPage();
  await anonimo.goto(primeiroLink(pedido.texto, '/autorizacao-ia/'));
  await expect(anonimo.getByRole('heading', { name: 'Autorização para uso de inteligência artificial' })).toBeVisible();
  await expect(anonimo.getByText('Consultório E2E').first()).toBeVisible();
  await expect(anonimo.getByText('Esta autorização é pessoal. Se você recebeu este e-mail por engano, não toque em Autorizo.')).toBeVisible(); // F4
  expect((await new AxeBuilder({ page: anonimo }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await anonimo.getByRole('button', { name: 'Autorizo o envio para fora do Brasil' }).click();
  await expect(anonimo.getByRole('status').filter({ hasText: /^Autorização registrada\. Você pode retirar quando quiser, pelo link do e-mail de confirmação/ })).toBeVisible();

  await nutri.reload();
  await expect(nutri.getByText(/^Autorizou em .* \(link por e-mail, versão 0\.1-provisorio\)\./)).toBeVisible();
  await expect(nutri.getByText(/— Pedido enviado por e-mail$/)).toBeVisible();

  const confirmacao = await esperarEmail(paciente.email, { assunto: 'Você autorizou o uso de inteligência artificial', depoisDe: antes });
  expect(confirmacao.texto).toContain('Se não foi você quem autorizou, toque em Retirar a autorização e avise sua nutricionista.'); // F4
  await anonimo.goto(primeiroLink(confirmacao.texto, '/autorizacao-ia/'));
  anonimo.once('dialog', (d) => void d.accept());
  await anonimo.getByRole('button', { name: 'Retirar autorização' }).click();
  await expect(anonimo.getByRole('status').filter({ hasText: 'Autorização retirada.' })).toBeVisible();
  await nutri.reload();
  await expect(nutri.getByText(/^Retirou em \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible();
  await expect(nutri.getByText(/— Retirou \(link por e-mail\)$/)).toBeVisible();
  await anonimo.context().close();
  await paciente.page.context().close();
  await nutri.context().close();
});

test('termo em papel: imprimir, guardar a foto com o código de referência, "Ver termo assinado" e a retirada a pedido', async ({ browser }) => {
  test.setTimeout(120_000);
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.27.54', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.27.55');

  // US-106 "Agora não" (revisão da T8): nada gravado; de volta a Eu, o retorno fica na vista e com o foco
  await paciente.page.goto('/p/perfil');
  await paciente.page.getByRole('link', { name: 'Ler e decidir' }).click();
  await paciente.page.getByRole('link', { name: 'Agora não' }).click();
  const tudoBem = paciente.page.getByRole('status').filter({ hasText: 'Tudo bem. Nada muda no seu atendimento.' });
  await expect(tudoBem).toBeVisible();
  await expect(tudoBem).toBeInViewport();
  await expect(tudoBem).toBeFocused();
  await expect(paciente.page.getByText('Você ainda não autorizou.')).toBeVisible();

  await nutri.goto(`${paciente.prontuario}/privacidade`);
  await expect(nutri.getByText('Ainda não autorizou.')).toBeVisible();
  await nutri.getByRole('link', { name: 'Registrar termo em papel' }).click();
  await expect(nutri.getByRole('heading', { name: 'Autorização para uso de inteligência artificial' })).toBeVisible();
  await expect(nutri.getByText(`Nome do paciente: ${paciente.nome}`)).toBeVisible();
  await expect(nutri.getByText(/^Código de referência: [0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/).first()).toBeVisible();
  await expect(nutri.getByRole('button', { name: 'Imprimir termo' })).toBeVisible();
  await expect(nutri.getByText('Recebi uma via deste termo.')).toBeVisible(); // F5
  // F5: o rodapé de todas as páginas impressas (caixa de margem do @page) com o código e "Página x de y"
  expect(
    await nutri.evaluate(() =>
      [...document.querySelectorAll('style')].some((st) =>
        /@bottom-center \{ content: "Código de referência: [0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4} — Página " counter\(page\) " de " counter\(pages\)/.test(st.textContent ?? ''),
      ),
    ),
  ).toBe(true);
  await expect(nutri.getByText('Guarde o original em papel na pasta do paciente até a anonimização dele e entregue ao paciente uma via.')).toBeVisible(); // F5
  expect(await violacoesNoPainel(nutri), 'página do termo').toEqual([]);

  // US-108: o "Salvar" vazio chega à rota (noValidate, R5) e volta com o erro por campo
  await nutri.getByRole('button', { name: 'Salvar' }).click();
  await expect(nutri.getByText('Envie a foto ou o PDF do termo assinado.')).toBeVisible();
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await nutri.getByLabel('Data da assinatura').fill(hoje);
  await nutri.getByLabel('Foto ou PDF do termo assinado').setInputFiles({ name: 'termo.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await nutri.getByLabel(/^Confirmo que o paciente assinou este termo, na versão 0\.1-provisorio, e que o arquivo mostra todas as páginas e a assinatura\.$/).check();
  await nutri.getByRole('button', { name: 'Salvar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Termo registrado. Entregue ao paciente uma via do termo assinado.' })).toBeVisible();
  await expect(nutri.getByText(/^Autorizou em .* \(termo em papel, versão 0\.1-provisorio\)\./)).toBeVisible();
  // "Ver termo assinado" abre em outra aba; o Chromium sem tela baixa o PDF em vez de mostrar (a aba nunca termina de
  // carregar): a rota é conferida pela sessão da nutricionista — 303 para a URL assinada (/api/arquivos) e o PDF
  const verTermo = nutri.getByRole('link', { name: 'Ver termo assinado' });
  await expect(verTermo).toHaveAttribute('target', '_blank');
  const rota = await nutri.request.get((await verTermo.getAttribute('href'))!, { maxRedirects: 0 });
  expect(rota.status()).toBe(303);
  const assinada = new URL(rota.headers()['location'], nutri.url());
  expect(assinada.pathname).toBe('/api/arquivos');
  const arquivo = await nutri.request.get(assinada.href);
  expect(arquivo.status()).toBe(200);
  expect(arquivo.headers()['content-type']).toBe('application/pdf');

  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Registrar retirada a pedido do paciente' }).click();
  await expect(nutri.getByText(/^Retirou em \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible();
  await expect(nutri.getByText(/— Retirou \(a pedido, pela nutricionista\)$/)).toBeVisible();
  // a retirada chega ao app do paciente
  await paciente.page.goto('/p/perfil');
  await expect(paciente.page.getByText(/^Você retirou a autorização em \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible();
  await paciente.page.context().close();
  await nutri.context().close();
});
