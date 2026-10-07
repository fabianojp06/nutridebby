import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { violacoesNoPainel } from './documentos';
import { entrarComo } from './helpers';
import { pacienteNoPortal } from './portal';

// Plano 11 (US-104, US-110, US-111): com IA_PROVEDOR=sandbox (nenhuma chamada à API real). IPs: nutricionista 10.9.15.81, paciente .82 (bloco .81–.85 desta spec).
// Credenciais copiadas (importar o seed roda o seed), como nas outras specs.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };

test('IA: aviso em mãos → laudo → "Ler valores com IA" → conferir → salvar só o marcado', async ({ browser }) => {
  test.setTimeout(120_000);
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.15.81', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.15.82');
  const p = paciente.prontuario;

  // US-104: sem ciência, o botão não aparece; registrar em mãos
  await nutri.goto(`${p}/privacidade`);
  await expect(nutri.getByText('Este paciente ainda não foi informado sobre o uso de IA.')).toBeVisible();
  await nutri.getByText('Registrar entrega em mãos').click();
  await nutri.getByRole('button', { name: 'Entreguei o aviso ao paciente' }).click();
  await expect(nutri.getByText(/^Informado em .*\(em mãos, versão /)).toBeVisible();

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
  await expect(nutri.getByRole('cell', { name: 'HBsAg' })).toHaveCount(0); // a linha não marcada não entrou

  // US-007: o envio aparece no histórico
  await nutri.goto(`${p}/historico`);
  await expect(nutri.getByRole('cell', { name: 'Pediu leitura à IA' })).toBeVisible();
  await expect(nutri.getByRole('cell', { name: 'Laudo enviado à IA' })).toBeVisible();

  await paciente.page.context().close();
  await nutri.context().close();
});
