import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { violacoesNoPainel } from './documentos';
import { entrarComo } from './helpers';
import { pacienteNoPortal } from './portal';

// Plano 11 (US-110, US-111) e Plano 14A (US-106: a autorização do paciente no app, no lugar do aviso da US-104): com
// IA_PROVEDOR=sandbox e IA_RETENCAO_ZERO=1 (nenhuma chamada à API real). IPs: nutricionista 10.9.15.81, paciente .82 (bloco .81–.85 desta spec).
// Credenciais copiadas (importar o seed roda o seed), como nas outras specs.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };

test('IA: autorização no app → laudo → "Ler valores com IA" → conferir → salvar só o marcado', async ({ browser }) => {
  test.setTimeout(120_000);
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.15.81', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.15.82');
  const p = paciente.prontuario;

  // US-105/US-106 (Plano 14A): sem autorização, a seção explica; o paciente autoriza no app (Eu › Privacidade)
  await nutri.goto(`${p}/privacidade`);
  await expect(nutri.getByText('Ainda não autorizou.')).toBeVisible();
  await expect(nutri.getByText('O paciente também pode autorizar no app, em Eu › Privacidade.')).toBeVisible();
  await paciente.page.goto('/p/perfil');
  await expect(paciente.page.getByText('Você ainda não autorizou.')).toBeVisible();
  await paciente.page.getByRole('link', { name: 'Ler e decidir' }).click();
  await expect(paciente.page.getByRole('heading', { name: 'Autorização para uso de inteligência artificial' })).toBeVisible();
  // Plano 14B-2 (F2): a versão 1.1 traz os três usos no "Para que serve"
  await expect(
    paciente.page.getByText(
      'A IA ajuda a sua nutricionista a: (1) ler os laudos dos seus exames e sugerir os valores para o seu prontuário; (2) resumir o seu histórico antes da consulta; (3) montar um primeiro rascunho do seu plano alimentar, que ela revisa.',
    ),
  ).toBeVisible();
  await paciente.page.getByRole('button', { name: 'Autorizo o envio para fora do Brasil' }).click();
  const registrada = paciente.page.getByRole('status').filter({ hasText: 'Autorização registrada. Você pode retirar quando quiser.' });
  await expect(registrada).toBeVisible();
  // revisão da T8: de volta a Eu, o retorno fica na vista e com o foco (o leitor de tela o anuncia)
  await expect(registrada).toBeInViewport();
  await expect(registrada).toBeFocused();
  await nutri.reload();
  await expect(nutri.getByText(/^Autorizou em \d{2}\/\d{2}\/\d{4} \(app, versão 1\.1\)\./)).toBeVisible();

  // exame com laudo (PDF de uma página em branco, gerado na hora: nenhum dado real; abre no pdf-lib do worker)
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  await nutri.goto(`${p}/exames`);
  await nutri.getByLabel('Título do exame').fill('Bioquímica');
  await nutri.getByLabel('Laudo (opcional)').setInputFiles({ name: 'laudo.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await nutri.getByRole('button', { name: 'Salvar exame' }).click();
  await expect(nutri.getByRole('heading', { name: /^Bioquímica · / })).toBeVisible();

  // US-110: pedir; o sandbox responde na hora; o painel consulta o estado a cada 3 s
  await nutri.getByRole('button', { name: /^Ler valores com IA/ }).click();
  await expect(nutri.getByRole('link', { name: /^Ver valores encontrados/ })).toBeVisible({ timeout: 60_000 });
  await nutri.getByRole('link', { name: /^Ver valores encontrados/ }).click();

  // US-111: faixa, caixas desmarcadas, ambíguo e não numérico bloqueados
  await expect(nutri.getByText(/^Sugestão gerada por inteligência artificial\. Ela pode errar/)).toBeVisible();
  await expect(nutri.getByRole('checkbox', { name: 'Selecionar Glicose de jejum' })).not.toBeChecked();
  await expect(nutri.getByRole('checkbox', { name: 'Selecionar Plaquetas' })).toBeDisabled();
  await expect(nutri.getByRole('checkbox', { name: 'Selecionar HBsAg' })).toBeDisabled();
  expect(await violacoesNoPainel(nutri), 'tabela de conferência').toEqual([]);
  await nutri.getByLabel('Valor de Plaquetas').fill('250000');
  await nutri.getByRole('checkbox', { name: 'Selecionar Plaquetas' }).check();
  await nutri.getByRole('checkbox', { name: 'Selecionar Glicose de jejum' }).check();
  await nutri.getByRole('button', { name: 'Salvar valores selecionados' }).click();

  await expect(nutri.getByRole('status').filter({ hasText: 'Valores salvos.' })).toBeVisible();
  await expect(nutri.getByText(/^IA · conferido em /).first()).toBeVisible();
  // a linha não marcada não entrou (Plano 22, T5b: o marcador da tabela de valores é o cabeçalho da linha)
  await expect(nutri.getByRole('rowheader', { name: 'HBsAg' })).toHaveCount(0);

  // US-007: o envio aparece no histórico
  await nutri.goto(`${p}/historico`);
  await expect(nutri.getByRole('cell', { name: 'Pediu leitura à IA' })).toBeVisible();
  await expect(nutri.getByRole('cell', { name: 'Laudo enviado à IA' })).toBeVisible();

  await paciente.page.context().close();
  await nutri.context().close();
});
