import { expect, test } from '@playwright/test';
import { emitirReceita, entrarComoDocs, violacoesNoPainel } from './documentos';
import { pacienteNoPortal } from './portal';

// Plano 10A (T16, RNF-144): a receita de ponta a ponta pela digitalizada — a única forma de assinar do 10A (no 10B o E2E
// continua por ela: gov.br e ICP no E2E exigiriam âncoras de teste dentro do app). Conta própria com o 2FA já ativo
// (E2E_DOCS do seed), nunca a nutri-e2e compartilhada. IPs (R8): nutricionista 10.9.14.76, paciente .77, sem login .78.
test('receita: rascunho → preparar → digitalizada → portal (abrir e confirmar) → verificação pública', async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await entrarComoDocs(browser, '10.9.14.76');
  const paciente = await pacienteNoPortal(browser, page, '10.9.14.77');
  // RNF-10: o cartão "Aguardando assinatura" com o formulário das fotos aberto (o axe do painel só vê o rascunho, T6)
  const codigo = await emitirReceita(page, paciente.prontuario, { noFormulario: async () => expect(await violacoesNoPainel(page), 'aguardando assinatura').toEqual([]) });
  expect(codigo).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  expect(await violacoesNoPainel(page), 'documento assinado (entrega e cancelar)').toEqual([]);

  // portal: cartão no Início → Documentos → abrir → confirmar
  const p = paciente.page;
  await p.goto('/p/inicio');
  await p.getByRole('link', { name: 'Ver documentos' }).click();
  await expect(p).toHaveURL(/\/p\/documentos$/);
  await expect(p.getByRole('heading', { name: /^Receita · / })).toBeVisible();
  await expect(p.getByText('Assinatura: Digitalizado')).toBeVisible(); // RN-157 no portal
  const download = p.waitForEvent('download');
  await p.getByRole('link', { name: /^Abrir PDF da receita/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  await p.getByRole('button', { name: 'Confirmo que recebi este documento' }).click();
  await expect(p.getByRole('status').filter({ hasText: /^Recebimento confirmado em / })).toBeVisible();

  // painel: situação da entrega
  await page.reload();
  await expect(page.getByText(/^Recebido pelo paciente em /)).toBeVisible();
  // RN-157 também na lista da nutricionista
  await page.goto(`${paciente.prontuario}/documentos`);
  await expect(page.getByText('Assinatura: Digitalizado')).toBeVisible();

  // verificação pública: sem login, sem nada do paciente
  const anonimo = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.14.78' } })).newPage();
  await anonimo.goto(`/v/${codigo.replace(/-/g, '')}`);
  await expect(anonimo.getByRole('heading', { name: 'Documento válido' })).toBeVisible();
  await expect(anonimo.getByText('Digitalizado')).toBeVisible();
  await expect(anonimo.getByText(paciente.nome)).toHaveCount(0);
  await expect(anonimo.getByText('Vitamina D3')).toHaveCount(0);
  await expect(anonimo.getByRole('link', { name: 'Validar a assinatura no validador oficial do ITI' })).toHaveCount(0);

  await anonimo.context().close();
  await p.context().close();
  await page.context().close();
});
