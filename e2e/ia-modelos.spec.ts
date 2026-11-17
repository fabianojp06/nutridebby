import { expect, test } from '@playwright/test';
import { entrarComo } from './helpers';
import { criarPacientePeloFormulario } from './pacientes-form';

// Plano 14B-1 (US-123): modelos sugeridos pela IA, com IA_PROVEDOR=sandbox (nenhuma chamada à API real). IP: 10.9.28.26
// (bloco .26–.30 desta spec). Credenciais copiadas (importar o seed roda o seed), como nas outras specs.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };

test('US-123: pacote de Diabetes → marca → aprovar → aparece em "Criar a partir de modelo"', async ({ browser }) => {
  test.setTimeout(180_000);
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.28.26', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/); // o login termina antes do goto (sem isso o goto cai em /entrar)
  await nutri.goto('/painel/configuracoes');
  // o título da seção (o guia de Configurações, desenhado na página, também cita "Modelos sugeridos pela IA")
  await expect(nutri.getByRole('heading', { name: 'Modelos sugeridos pela IA' })).toBeVisible();
  // um pacote por consultório (RN-103): se outro (o axe do painel, outra execução) estiver em preparo, o formulário volta
  // sozinho quando ele terminar (EstadoTarefa)
  await expect(nutri.getByLabel('Área')).toBeVisible({ timeout: 90_000 });
  await nutri.getByLabel('Área').selectOption('diabetes');
  await nutri.getByRole('button', { name: 'Gerar modelos' }).click();
  // correção da revisão da T5 (Important): a seção é a última da página; a âncora e o foco levam a confirmação à tela.
  // Checar logo depois do clique: o sandbox termina em segundos e a primeira consulta da situação é em 3 s.
  await expect(nutri).toHaveURL(/\/painel\/configuracoes\?modelos=pedido#modelos-ia$/);
  const gerando = nutri.getByRole('status').filter({ hasText: 'Gerando os modelos de Diabetes… isso leva alguns minutos.' });
  await expect(gerando).toBeInViewport();
  await expect(gerando).toBeFocused();
  // o andamento acompanha sozinho (EstadoTarefa) e a página recarrega quando o pacote fica pronto. O banco do E2E é
  // reaproveitado: a linha "Diabetes — Gerado em" pode vir de uma execução anterior, então espera o fim DESTE pacote
  await expect(gerando).toBeHidden({ timeout: 90_000 });
  await expect(nutri.getByText(/Diabetes — Gerado em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
  await nutri.goto('/painel/planos/modelos');
  // exato: o guia de Modelos, desenhado na página (escondido), cita a marca no meio de uma frase
  await expect(nutri.getByText('Sugestão da IA — revise', { exact: true }).first()).toBeVisible();
  // R10: a lista é por "alterado em" (o mais novo primeiro): com o banco reaproveitado, o primeiro é o deste pacote
  await nutri.getByRole('link', { name: /^Diabetes: Plano sugerido$/ }).first().click();
  await expect(nutri.getByText('Modelo sugerido por inteligência artificial. Revise alimentos, quantidades e textos antes de aprovar. Depois de aprovado, o modelo é seu.')).toBeVisible();
  const aprovado = /\/painel\/planos\/modelos\/([0-9a-f-]{36})$/.exec(new URL(nutri.url()).pathname)![1];
  nutri.once('dialog', (d) => d.accept());
  await nutri.getByRole('button', { name: 'Aprovar modelo' }).click();
  await expect(nutri.getByText(/^Aprovado em \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
  await nutri.goto('/painel/anamnese/modelos');
  await expect(nutri.getByText('Sugestão da IA — revise', { exact: true }).first()).toBeVisible(); // a anamnese do pacote, ainda não aprovada (R10)

  // RN-125: em "Criar a partir de modelo", o aprovado aparece; o outro plano do pacote, sem aprovação, não
  const sufixo = Date.now().toString(36);
  // Plano 18 (RNF-263 g): pelo helper único do formulário (rótulos do cadastro em seções)
  const prontuario = await criarPacientePeloFormulario(nutri, { nome: `Paciente Modelos IA ${sufixo}`, email: `modelos-ia-${sufixo}@nutridebby.test`, nascimento: '1991-03-10' });
  await expect(nutri.getByRole('heading', { level: 1, name: `Paciente Modelos IA ${sufixo}` })).toBeVisible();
  await nutri.goto(`${prontuario}/plano-alimentar`);
  const escolha = nutri.getByLabel('Modelo');
  await expect(escolha.locator(`option[value="${aprovado}"]`)).toHaveCount(1);
  await expect(escolha.locator('option', { hasText: 'Diabetes: Plano sugerido 2' })).toHaveCount(0);
  await escolha.selectOption(aprovado);
  await nutri.getByRole('button', { name: 'Criar a partir de modelo' }).click();
  await expect(nutri).toHaveURL(new RegExp(`${prontuario}/plano-alimentar/[0-9a-f-]{36}$`));
  await nutri.context().close();
});
