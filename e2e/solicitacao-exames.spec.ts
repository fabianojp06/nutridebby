import { expect, test } from '@playwright/test';
import { assinarDigitalizada, entrarComoDocs, violacoesNoPainel } from './documentos';
import { pacienteNoPortal } from './portal';

// Plano 22 (T8, CS-370, US-377, RN-388 a RN-390): a solicitação de exames laboratoriais de ponta a ponta — ficha →
// "Adicionar" → "Solicitação de exames" → "Carregar modelo" (o "Check-up E2E" da semente: o painel "Hemograma completo" e
// a Ferritina) → exame fora do catálogo → preparar com a declaração → assinar pela digitalizada (como e2e/documentos.ts)
// → o paciente vê o documento no app (sem os exames na tela, só o PDF) → a verificação pública só com o rótulo →
// "Lançar resultados" abre o "Novo exame" com o título e as linhas, sem digitar nome de exame. Conta própria com o 2FA
// (E2E_DOCS do seed). IPs (faixa do Plano 22, EP-D58): nutricionista 10.9.22.40, paciente .41, sem login .42.
test('solicitação de exames: Adicionar → Carregar modelo → preparar → digitalizada → portal → verificação → Lançar resultados', async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await entrarComoDocs(browser, '10.9.22.40');
  const paciente = await pacienteNoPortal(browser, page, '10.9.22.41');

  // US-377: "Adicionar" → "Solicitação de exames" no Início da ficha abre o rascunho (a mesma ação da aba Documentos)
  await page.goto(paciente.prontuario);
  await page.getByRole('button', { name: 'Adicionar ao prontuário' }).click();
  await page.getByRole('dialog', { name: 'Adicionar ao prontuário' }).getByRole('button', { name: 'Solicitação de exames', exact: true }).click();
  await expect(page).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Solicitação de exames laboratoriais' })).toBeVisible();
  await expect(page.getByText('Planos de saúde podem recusar pedido de exame feito por nutricionista.')).toBeVisible();
  await expect(page.getByText('Só exames laboratoriais (Lei nº 8.234/1991, art. 4º, VIII).')).toBeVisible();
  await expect(page.getByText('Descreva a finalidade nutricional; não afirme doença.')).toBeVisible();
  // EP-D2: nenhum campo de laboratório (a declaração do preparo é uma caixa de seleção, não um campo de texto)
  await expect(page.getByRole('textbox', { name: /laborat/i })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: /laborat/i })).toHaveCount(0);

  // "Carregar modelo" → "Acrescentar": os exames do modelo e as orientações dele (a tela estava sem orientações)
  const carregar = page.getByRole('button', { name: 'Carregar modelo', exact: true });
  await carregar.click();
  const dialogo = page.getByRole('dialog', { name: 'Carregar modelo' });
  expect(await violacoesNoPainel(page), 'diálogo Carregar modelo').toEqual([]);
  await dialogo.getByRole('button', { name: 'Acrescentar Check-up E2E' }).click();
  await expect(dialogo).toBeHidden();
  await expect(carregar).toBeFocused();
  await expect(page.getByRole('button', { name: 'Remover Hemograma completo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remover Ferritina' })).toBeVisible();
  await expect(page.getByLabel('Orientações ao paciente (opcional)')).toHaveValue('Jejum de 8 horas.');

  // "Substituir" pede a confirmação com o número de exames; "Cancelar" não muda nada e o foco volta
  await carregar.click();
  await dialogo.getByRole('button', { name: 'Substituir por Check-up E2E' }).click();
  const confirmar = page.getByRole('alertdialog', { name: 'Substituir' });
  await expect(confirmar.getByText('Substituir os 2 exames da solicitação pelos do modelo?')).toBeVisible();
  await expect(confirmar.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmar).toBeHidden();
  await expect(page.getByRole('button', { name: 'Remover Ferritina' })).toBeVisible();

  // fora do catálogo (Enter acrescenta, não envia o formulário) e a indicação clínica
  await page.getByLabel('Adicionar exame fora do catálogo').fill('Vitamina B12');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Remover Vitamina B12' })).toBeVisible();
  await page.getByLabel('Indicação clínica (opcional)').fill('Acompanhar a resposta à dieta.');
  expect(await violacoesNoPainel(page), 'editor da solicitação').toEqual([]);
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();

  // RN-389: a declaração da solicitação, o PDF-base na fila documento-pdf-2 e a digitalizada com o código do 2FA
  await page.getByLabel(/Declaro que os exames solicitados são laboratoriais/).check();
  await page.getByRole('button', { name: 'Preparar para assinatura' }).click();
  await expect(page.getByRole('link', { name: 'Baixar PDF para assinar' })).toBeVisible({ timeout: 60_000 });
  const codigo = await assinarDigitalizada(page);
  await expect(page.getByRole('heading', { name: 'Exames solicitados' })).toBeVisible();
  await expect(page.getByText('Acompanhar a resposta à dieta.')).toBeVisible();
  expect(await violacoesNoPainel(page), 'solicitação assinada').toEqual([]);

  // o portal: o título do tipo e o PDF (D17 do 10A: nada dos exames nem das orientações na tela)
  const p = paciente.page;
  await p.goto('/p/documentos');
  await expect(p.getByRole('heading', { name: /^Solicitação de exames laboratoriais · / })).toBeVisible();
  await expect(p.getByRole('link', { name: /^Abrir PDF da solicitação de exames laboratoriais/ })).toBeVisible();
  await expect(p.getByText('Hemograma completo')).toHaveCount(0);
  await expect(p.getByText('Jejum de 8 horas.')).toHaveCount(0);

  // D8: a verificação mostra o rótulo do tipo, nada do paciente nem dos exames
  const anonimo = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.22.42' } })).newPage();
  await anonimo.goto(`/v/${codigo.replace(/-/g, '')}`);
  await expect(anonimo.getByRole('heading', { name: 'Documento válido' })).toBeVisible();
  await expect(anonimo.getByText('Solicitação de exames laboratoriais')).toBeVisible();
  await expect(anonimo.getByText('Hemograma')).toHaveCount(0);
  await expect(anonimo.getByText(paciente.nome)).toHaveCount(0);

  // RN-390: "Lançar resultados" → "Novo exame" com o título e uma linha por exame (o painel expandido em 20 componentes
  // com a unidade do catálogo, a Ferritina e o exame fora do catálogo), sem digitar nenhum nome
  await page.getByRole('link', { name: 'Lançar resultados' }).click();
  await expect(page).toHaveURL(/\/exames\?solicitacao=[0-9a-f-]{36}#novo-exame$/);
  await expect(page.getByLabel('Título do exame')).toHaveValue(/^Exames solicitados em \d{2}\/\d{2}\/\d{4}$/);
  await expect(page.getByLabel('Marcador 1', { exact: true })).toHaveValue('Hemácias');
  await expect(page.getByLabel('Unidade 1', { exact: true })).toHaveValue('milhões/µL');
  await expect(page.getByLabel('Marcador 21', { exact: true })).toHaveValue('Ferritina');
  await expect(page.getByLabel('Unidade 21', { exact: true })).toHaveValue('ng/mL');
  await expect(page.getByLabel('Marcador 22', { exact: true })).toHaveValue('Vitamina B12');
  await expect(page.getByLabel('Marcador 23', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Valor 1', { exact: true })).toHaveValue('');
  expect(await violacoesNoPainel(page), 'Novo exame pela solicitação').toEqual([]);

  await anonimo.context().close();
  await p.context().close();
  await page.context().close();
});
