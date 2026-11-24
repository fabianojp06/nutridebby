import { expect, test } from '@playwright/test';
import { assinarDigitalizada, entrarComoDocs, violacoesNoPainel } from './documentos';
import { pacienteNoPortal } from './portal';

// Plano 13 (US-141, US-146, US-147, US-148): o parecer de ponta a ponta pela digitalizada (D2 = (a)) e a retificação que
// substitui a versão 1. Conta própria com o 2FA ativo (E2E_DOCS do seed). IPs (faixa só deste spec, 10.9.17.46 a .50):
// nutricionista 10.9.17.46, paciente .47, sem login .48 (zerado no seed, como os da documentos.spec).
test('parecer: exame → rascunho → preparar → digitalizada → portal → verificação; retificar → a versão 2 substitui a 1', async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await entrarComoDocs(browser, '10.9.17.46');
  const paciente = await pacienteNoPortal(browser, page, '10.9.17.47');

  // o exame lançado na aba Exames (US-015)
  await page.goto(`${paciente.prontuario}/exames`);
  await page.getByLabel('Título do exame').fill('Hemograma');
  await page.getByLabel('Data do exame').fill('2026-09-01');
  if ((await page.getByLabel('Marcador 1', { exact: true }).count()) === 0) await page.getByRole('button', { name: 'Adicionar linha' }).click();
  // exact: o rótulo "Valor 1" não pode casar com outros nomes da linha
  await page.getByLabel('Marcador 1', { exact: true }).fill('Hemoglobina');
  await page.getByLabel('Valor 1', { exact: true }).fill('13,5');
  await page.getByLabel('Unidade 1', { exact: true }).fill('g/dL');
  await page.getByRole('button', { name: 'Salvar exame' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Exame salvo.' })).toBeVisible();

  // US-141: o rascunho, o axe do editor e o preparo
  await page.goto(`${paciente.prontuario}/documentos`);
  await page.getByRole('button', { name: 'Novo parecer nutricional' }).click();
  await expect(page).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
  const urlV1 = page.url();
  await page.getByLabel('Hemograma — 01/09/2026').check();
  await page.getByLabel('Avaliação nutricional').fill('Marcadores compatíveis com boa reserva de ferro.');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();
  // US-141 (revisão da T8): o editor mostra os valores do exame marcado
  await expect(page.getByText('Hemoglobina · 13,5 · g/dL · —')).toBeVisible();
  expect(await violacoesNoPainel(page), 'editor do parecer').toEqual([]);
  await page.getByLabel(/Declaro que este parecer não afirma diagnóstico de doença/).check();
  await page.getByRole('button', { name: 'Preparar para assinatura' }).click();
  await expect(page.getByRole('link', { name: 'Baixar PDF para assinar' })).toBeVisible({ timeout: 60_000 });
  const v1 = await assinarDigitalizada(page);
  await expect(page.getByText('Hemoglobina · 13,5 · g/dL · —')).toBeVisible();

  // US-146 v0.5: o portal com o título do parecer e o leitor de tela com o artigo certo
  const p = paciente.page;
  await p.goto('/p/documentos');
  await expect(p.getByRole('heading', { name: /^Parecer nutricional · / })).toBeVisible();
  await expect(p.getByRole('link', { name: /^Abrir PDF do parecer nutricional/ })).toBeVisible();

  // US-147 v0.5: "Tipo: Parecer nutricional", nada do paciente nem dos exames
  const anonimo = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.17.48' } })).newPage();
  await anonimo.goto(`/v/${v1.replace(/-/g, '')}`);
  await expect(anonimo.getByRole('heading', { name: 'Documento válido' })).toBeVisible();
  await expect(anonimo.getByText('Parecer nutricional')).toBeVisible();
  await expect(anonimo.getByText('Hemoglobina')).toHaveCount(0);
  await expect(anonimo.getByText(paciente.nome)).toHaveCount(0);

  // US-148: retificar com o motivo; assinada a 2, a 1 é "Substituído" (portal, verificação e painel)
  await page.getByRole('button', { name: 'Retificar' }).click();
  await expect(page.getByText(`Versão 2 — substitui o documento ${v1}`)).toBeVisible();
  await page.getByLabel('Motivo da retificação').fill('Encaminhamento acrescentado.');
  await page.getByLabel('Encaminhamentos (opcional)').fill('Sugiro avaliação médica.');
  await page.getByLabel(/Declaro que este parecer não afirma diagnóstico de doença/).check();
  await page.getByRole('button', { name: 'Preparar para assinatura' }).click();
  await expect(page.getByRole('link', { name: 'Baixar PDF para assinar' })).toBeVisible({ timeout: 60_000 });
  const v2 = await assinarDigitalizada(page);
  expect(v2).not.toBe(v1);
  await expect(page.getByText('Motivo da retificação (só no prontuário): Encaminhamento acrescentado.')).toBeVisible();

  await anonimo.goto(`/v/${v1.replace(/-/g, '')}`);
  await expect(anonimo.getByRole('heading', { name: /^Documento substituído/ })).toBeVisible();
  await p.goto('/p/documentos');
  await expect(p.getByRole('heading', { name: /· Versão 2$/ })).toBeVisible();
  await expect(p.getByText('Substituído por uma versão mais nova.')).toBeVisible();
  await page.goto(urlV1);
  await expect(page.getByRole('heading', { name: 'Documento substituído' })).toBeVisible();
  expect(await violacoesNoPainel(page), 'documento substituído').toEqual([]);

  await anonimo.context().close();
  await p.context().close();
  await page.context().close();
});
