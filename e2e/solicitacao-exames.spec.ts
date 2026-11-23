import { expect, test } from '@playwright/test';
import { assinarDigitalizada, entrarComoDocs, violacoesNoPainel } from './documentos';
import { criarPacientePeloFormulario } from './pacientes-form';
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

// Plano 22 (T12, CS-372, US-379, RN-394, R-377): receita de 5 itens a partir de um modelo em 1 clique + revisão. O "Rotina
// E2E" da semente (scripts/e2e-seed.ts: os cinco tipos de item, com o fitoterápico e a fórmula magistral fitoterápica, que
// exigem a habilitação do consultório) entra por "Carregar modelo" → "Acrescentar aos itens": o servidor grava pelo
// caminho do "Salvar rascunho" (Zod, 20 itens, habilitação atual) e devolve o gravado — o item digitado e não salvo fica
// junto, a justificativa também (o modelo não a traz). Um item incompleto na tela recusa tudo (nada muda); "Substituir"
// pede a confirmação com o número de itens. A revisão: cada item com os campos do art. 12 preenchidos; a declaração com a
// frase da fórmula (EP-D56); o preparo confere tudo de novo e gera o PDF-base (fila documento-pdf-2). IP: 10.9.22.43.
test('CS-372: receita de 5 itens a partir de um modelo em 1 clique + revisão, com as conferências de novo', async ({ browser }) => {
  test.setTimeout(240_000);
  const page = await entrarComoDocs(browser, '10.9.22.43');
  try {
    const sufixo = Date.now().toString(36);
    const prontuario = await criarPacientePeloFormulario(page, { nome: `Rita Receita Modelo ${sufixo}`, email: `receita-modelo-${sufixo}@nutridebby.test` });
    await page.goto(`${prontuario}/documentos`);
    await page.getByRole('button', { name: 'Nova receita' }).click();
    await expect(page).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
    await page.waitForLoadState('networkidle'); // o editor é do cliente: o clique antes da hidratação se perde

    // um item digitado e ainda não salvo, e a justificativa (nada disso vem do modelo)
    await page.getByRole('button', { name: 'Adicionar item', exact: true }).click();
    await page.getByLabel('Componente 1').fill('Ômega 3');
    await page.getByLabel('Quantidade').fill('1.000');
    await page.getByLabel('Unidade').selectOption('mg');
    await page.getByLabel('Forma de apresentação').fill('Cápsula');
    await page.getByLabel('Posologia').fill('2 cápsulas ao dia');
    const justificativa = page.getByLabel('Justificativa de uso');
    await justificativa.fill('Sono e intestino; ingestão de peixe baixa');

    // 1 clique: "Acrescentar aos itens" do "Rotina E2E" (5 itens)
    const carregar = page.getByRole('button', { name: 'Carregar modelo', exact: true });
    await carregar.click();
    const dialogo = page.getByRole('dialog', { name: 'Carregar modelo' });
    await expect(dialogo).toContainText('Rotina E2E · 5 itens');
    await dialogo.getByRole('button', { name: 'Acrescentar aos itens: Rotina E2E', exact: true }).click();
    await expect(dialogo).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Itens da receita' })).toBeFocused();

    // a revisão: o item da tela primeiro, depois os cinco do modelo, com os campos de cada tipo (art. 12)
    const itens = page.getByRole('group', { name: /^Item \d+: / });
    await expect(itens).toHaveCount(6);
    const item = (n: number, tipo: string) => page.getByRole('group', { name: `Item ${n}: ${tipo}`, exact: true });
    await expect(item(1, 'Suplemento alimentar').getByLabel('Componente 1')).toHaveValue('Ômega 3');
    await expect(item(2, 'Suplemento alimentar').getByLabel('Componente 1')).toHaveValue('Vitamina D3');
    await expect(item(2, 'Suplemento alimentar').getByLabel('Unidade', { exact: true })).toHaveValue('UI');
    await expect(item(3, 'Suplemento alimentar').getByLabel('Unidade', { exact: true })).toHaveValue('UFC'); // probiótico em UFC
    await expect(item(4, 'Planta medicinal ou droga vegetal (chá)').getByLabel('Nomenclatura botânica')).toHaveValue('Matricaria chamomilla L.');
    await expect(item(4, 'Planta medicinal ou droga vegetal (chá)').getByLabel('Forma de utilização e preparo')).not.toHaveValue('');
    await expect(item(5, 'Fitoterápico (forma farmacêutica ou fórmula magistral)').getByLabel('Forma ou meio de extração')).toHaveValue('Extrato seco');
    await expect(item(5, 'Fitoterápico (forma farmacêutica ou fórmula magistral)').getByLabel('Via', { exact: true })).toHaveValue('oral');
    const formula = item(6, 'Fórmula magistral com vários compostos vegetais');
    await expect(formula.getByRole('group', { name: 'Composto 1' }).getByLabel('Nomenclatura botânica')).toHaveValue('Passiflora incarnata L.');
    await expect(formula.getByRole('group', { name: 'Composto 2' }).getByLabel('Nomenclatura botânica')).toHaveValue('Valeriana officinalis L.');
    await expect(formula.getByLabel('Posologia', { exact: true })).toHaveValue('1 cápsula à noite');
    await expect(justificativa).toHaveValue('Sono e intestino; ingestão de peixe baixa');
    await expect(page.getByLabel('Orientações gerais (opcional)')).toHaveValue('Tome os suplementos **junto das refeições**.');
    expect(await violacoesNoPainel(page), 'receita carregada do modelo').toEqual([]);

    // gravado mesmo: recarregada, a receita tem os 6 itens e a justificativa
    await page.reload();
    await expect(itens).toHaveCount(6);
    await expect(justificativa).toHaveValue('Sono e intestino; ingestão de peixe baixa');
    await page.waitForLoadState('networkidle');

    // tudo ou nada: com um item incompleto na tela, o servidor recusa e nada muda
    await page.getByRole('button', { name: 'Adicionar item', exact: true }).click();
    await expect(itens).toHaveCount(7);
    await carregar.click();
    await dialogo.getByRole('button', { name: 'Acrescentar aos itens: Rotina E2E', exact: true }).click();
    await expect(dialogo.getByRole('alert')).toContainText('Informe a posologia (até 300 caracteres).');
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeHidden();
    await expect(itens).toHaveCount(7);
    await page.getByRole('button', { name: 'Remover item 7' }).click();
    await expect(itens).toHaveCount(6);

    // "Substituir os itens" pede a confirmação com o número de itens; confirmado, ficam só os 5 do modelo
    await carregar.click();
    await dialogo.getByRole('button', { name: 'Substituir os itens: Rotina E2E', exact: true }).click();
    const confirmar = page.getByRole('alertdialog', { name: 'Substituir os itens' });
    await expect(confirmar).toContainText('Substituir os 6 itens da receita pelos do modelo?');
    await expect(confirmar.getByRole('button', { name: 'Cancelar' })).toBeFocused();
    await confirmar.getByRole('button', { name: 'Substituir os itens', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();
    await expect(itens).toHaveCount(5);
    await expect(item(1, 'Suplemento alimentar').getByLabel('Componente 1')).toHaveValue('Vitamina D3');
    await expect(justificativa).toHaveValue('Sono e intestino; ingestão de peixe baixa');

    // o preparo confere tudo de novo (habilitação, Zod, justificativa) com a declaração da fórmula (EP-D56)
    await page.getByLabel(/a fórmula magistral fitoterápica tem só derivados vegetais/).check();
    await page.getByRole('button', { name: 'Preparar para assinatura' }).click();
    await expect(page.getByRole('link', { name: 'Baixar PDF para assinar' })).toBeVisible({ timeout: 60_000 });
  } finally {
    await page.context().close();
  }
});
