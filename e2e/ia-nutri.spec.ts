import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';
import { pacienteNoPortal } from './portal';

// Plano 14B-2 (US-106 na versão 1.1, US-120, US-121, RN-117): o resumo do histórico e o rascunho de plano com IA, com
// IA_PROVEDOR=sandbox e IA_RETENCAO_ZERO=1 (nenhuma chamada à API real). IPs: nutricionista 10.9.15.88, paciente .89 (o
// .86 é da ia-modelos). Credenciais copiadas (importar o seed roda o seed), como nas outras specs.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };

test('IA Nutri: resumo e rascunho com a autorização 1.1 → publicar com o selo', async ({ browser }) => {
  test.setTimeout(240_000);
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.15.88', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/); // o login termina antes do goto (sem isso o goto cai em /entrar)

  // US-106 com a versão 1.1: o paciente autoriza no app, e a autorização inclui o resumo e o rascunho
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.15.89');
  const p = paciente.prontuario;
  await paciente.page.goto('/p/perfil/ia');
  await expect(paciente.page.getByText('(2) resumir o seu histórico antes da consulta')).toBeVisible();
  await paciente.page.getByRole('button', { name: 'Autorizo o envio para fora do Brasil' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Autorização registrada. Você pode retirar quando quiser.' })).toBeVisible();
  await nutri.goto(`${p}/privacidade`);
  await expect(nutri.getByText(/^Autorizou em \d{2}\/\d{2}\/\d{4} \(app, versão 1\.1\)\./)).toBeVisible();

  // US-120: o resumo (sandbox cita #1 e uma frase sem fonte, que o worker retira); "Pediu resumo à IA" no histórico
  // uma antropometria, para o prontuário não estar vazio (os mesmos rótulos do pacientes.spec)
  await nutri.goto(`${p}/antropometria`);
  await nutri.getByLabel('Data da avaliação').fill('2026-09-01');
  await nutri.getByLabel('Peso (kg)').fill('70');
  await nutri.getByLabel('Altura (cm)').fill('175');
  await nutri.getByRole('button', { name: 'Salvar avaliação' }).click();
  await expect(nutri.getByRole('status')).toHaveText('Avaliação salva.');
  await nutri.goto(p);
  await nutri.getByRole('link', { name: 'Resumo do histórico (IA)' }).click();
  await expect(nutri.getByLabel('Incluir notas privadas')).not.toBeChecked();
  await nutri.getByRole('button', { name: 'Gerar resumo' }).click();
  await expect(nutri).toHaveURL(/\/resumo-ia\?tarefa=[0-9a-f-]{36}$/);
  // revisão da T11: a região viva da espera é o MESMO elemento antes e depois do fim da tarefa (o router.refresh troca só
  // o texto de dentro, e o leitor de tela anuncia "Resumo pronto.")
  const esperaDoResumo = await nutri.locator('section[aria-labelledby="resumo-ia"] > [aria-live="polite"]').elementHandle();
  await expect(nutri.getByText(/^Resumo gerado por IA em .* — não substitui a leitura do prontuário$/)).toBeVisible({ timeout: 90_000 });
  expect(await esperaDoResumo!.evaluate((e) => e.isConnected && e.textContent)).toBe('Resumo pronto.');
  await expect(nutri.getByText('1 frases sem fonte foram retiradas.')).toBeVisible();
  await expect(nutri.getByText(/\(antropometria de \d{2}\/\d{2}\/\d{4}\)/)).toBeVisible();
  await nutri.goto(`${p}/historico`);
  await expect(nutri.getByRole('cell', { name: 'Pediu resumo à IA' })).toBeVisible();
  await expect(nutri.getByRole('cell', { name: 'Dados enviados à IA' })).toBeVisible();

  // US-121: o rascunho → usar → editor com a marca → publicar → o app mostra o selo
  await nutri.goto(`${p}/plano-alimentar`);
  await nutri.getByRole('link', { name: 'Gerar rascunho com IA' }).click();
  await nutri.getByLabel('Meta de energia (kcal/dia)').fill('1800');
  // R10 (pre-flight da 14B-2): as porcentagens não têm padrão (a spec não define). Revisão final: sem elas, o erro sai no
  // topo do formulário (fora da tela) — perto do botão aparece o aviso e o foco vai ao primeiro campo com erro
  await nutri.getByRole('button', { name: 'Gerar rascunho' }).click();
  await expect(nutri.locator('#rascunho-campos')).toHaveText('Corrija os campos destacados para gerar o rascunho.');
  await expect(nutri.locator('#rascunho-campos')).toHaveAttribute('role', 'alert');
  await expect(nutri.getByLabel('Proteína (% da energia)')).toBeFocused();
  await expect(nutri.getByText('Soma diferente de 100%')).toBeVisible();
  await expect(nutri).toHaveURL(/\/rascunho-ia$/);
  await nutri.getByLabel('Proteína (% da energia)').fill('20');
  await nutri.getByLabel('Carboidrato (%)').fill('50');
  await nutri.getByLabel('Lipídio (%)').fill('30');
  await nutri.getByRole('button', { name: 'Gerar rascunho' }).click();
  await expect(nutri).toHaveURL(/\/rascunho-ia\?tarefa=[0-9a-f-]{36}$/);
  const esperaDoRascunho = await nutri.locator('section[aria-labelledby="rascunho-ia"] > [aria-live="polite"]').elementHandle();
  await expect(nutri.getByRole('heading', { name: 'Rascunho sugerido pela IA' })).toBeVisible({ timeout: 120_000 });
  expect(await esperaDoRascunho!.evaluate((e) => e.isConnected && e.textContent)).toBe('Rascunho pronto.');
  await expect(nutri.getByText(/Dentro da meta|Atenção|Fora da meta/).first()).toBeVisible();
  await nutri.getByRole('button', { name: 'Usar como rascunho' }).click();
  await expect(nutri.getByText('Rascunho criado. Revise antes de publicar.')).toBeVisible();
  await expect(nutri.getByText('Criado com apoio de IA')).toBeVisible();
  nutri.once('dialog', (d) => d.accept());
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Plano publicado.' })).toBeVisible();
  await paciente.page.goto('/p/plano');
  await expect(paciente.page.getByText('Elaborado com apoio de IA e revisado pela nutricionista')).toBeVisible();

  await paciente.page.context().close();
  await nutri.context().close();
});
