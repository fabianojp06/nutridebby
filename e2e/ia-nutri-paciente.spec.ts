import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';

// Plano 15 (US-170 a US-177, RN-172 a RN-178, DP-16, Review Focus 5): a IA Nutri do paciente de ponta a ponta, com
// IA_PROVEDOR=sandbox (nenhuma chamada à API real; o sandbox responde por marcador, DP-12) e o worker do E2E processando a
// fila `ia-paciente`. As duas pacientes vêm do seed (scripts/e2e-seed.ts), que zera o estado delas a cada execução: a
// primeira liberada, com o plano "Lanche da tarde (16:00): Banana prata" e a substituição "Maçã" e SEM consentimento; a
// segunda com o consentimento e 10 perguntas de hoje (o limite do dia). Credenciais copiadas (importar o seed roda o seed).
// IPs (bloco do Plano 15; o limite de login é por IP e o seed o zera): 10.9.29.61 (nutricionista), .62 (a primeira
// paciente) e .63 (a segunda).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const UM = { email: 'ia-nutri-1-e2e@nutridebby.test', senha: 'Nutri2026segura', nome: 'Paciente IA Nutri Um' };
const DOIS = { email: 'ia-nutri-2-e2e@nutridebby.test', senha: 'Nutri2026segura', nome: 'Paciente IA Nutri Dois' };
const PRONTO = 'Pronto! Sua pergunta foi enviada ao consultório. Quando houver novidade, ela aparece aqui.';
const ATE_A_RESPOSTA = { timeout: 60_000 }; // o worker pega a pergunta e a tela consulta a situação a cada 5 s

test.describe.configure({ mode: 'serial' });
let nutri: Page;
let paciente: Page;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.29.61', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
  paciente = await entrarComo(browser, UM.email, UM.senha, '10.9.29.62');
  await expect(paciente).toHaveURL(/\/p\/inicio$/);
});
test.afterAll(async () => {
  await paciente?.context().close();
  await nutri?.context().close();
});

const conversa = (page: Page) => page.getByRole('list', { name: 'Conversa' });
const statusDaConversa = (page: Page) => page.getByRole('main').getByRole('status');
/** A conversa hidratada: o campo é controlado pelo React (preenchido antes da hidratação, voltaria vazio). */
async function abrirConversa(page: Page) {
  await page.goto('/p/plano/ia');
  await page.waitForLoadState('networkidle');
}
async function perguntar(page: Page, texto: string) {
  const campo = page.getByLabel('Sua dúvida');
  await campo.fill(texto);
  await expect(campo).toHaveValue(texto);
  await page.getByRole('button', { name: 'Perguntar', exact: true }).click();
  return campo;
}

test('1. Plano → "Tirar dúvida sobre o plano" → "Antes de usar a IA Nutri" → autoriza → a conversa vazia com a abertura e "Como a IA Nutri funciona" aberto', async () => {
  await paciente.goto('/p/plano');
  await paciente.getByRole('link', { name: 'Tirar dúvida sobre o plano' }).click();
  await expect(paciente).toHaveURL(/\/p\/plano\/ia\/autorizar\?de=plano$/);
  await expect(paciente.getByRole('heading', { level: 1, name: 'Antes de usar a IA Nutri' })).toBeVisible();
  await expect(paciente.getByText('Versão 1.0, de 14/10/2026.')).toBeVisible();
  await paciente.getByRole('button', { name: 'Autorizo o uso da IA Nutri' }).click();
  await expect(paciente).toHaveURL(/\/p\/plano\/ia$/);
  // RN-173: a abertura ANTES de qualquer pergunta (a conversa só tem ela)
  await expect(conversa(paciente).getByRole('listitem')).toHaveCount(1);
  await expect(conversa(paciente).getByRole('listitem')).toHaveText(/^Olá! Eu sou a IA Nutri, uma inteligência artificial — não sou a sua nutricionista\./);
  await expect(paciente.locator('details').filter({ hasText: 'Como a IA Nutri funciona' })).toHaveAttribute('open', '');
});

test('2. a substituição: o campo esvazia, "Pensando…" com o foco, a resposta montada com a fonte e o rodapé, "A resposta chegou."; "Ajudou" → "Obrigado pela avaliação."', async () => {
  const campo = await perguntar(paciente, 'o que posso comer no lugar da banana à tarde?');
  await expect(campo).toHaveValue('');
  const status = statusDaConversa(paciente);
  await expect(status).toBeFocused();
  await expect(status).toHaveText('Pensando…');
  await expect(status).toHaveText('A resposta chegou.', ATE_A_RESPOSTA);
  const resposta = conversa(paciente).getByRole('listitem').last();
  await expect(resposta).toContainText('No seu plano, as opções de substituição são:');
  await expect(resposta).toContainText('Maçã, Fuji, com casca, crua — 130 g');
  await expect(resposta).toContainText('Fonte: Lanche da tarde — substituições');
  await expect(resposta).toContainText('Resposta da IA com base no seu plano. Na dúvida, fale com sua nutricionista.');
  // US-172: abaixo da resposta montada, a avaliação e o encaminhamento
  await expect(resposta.getByRole('button', { name: 'Ajudou', exact: true })).toBeVisible();
  await expect(resposta.getByRole('button', { name: 'Não ajudou', exact: true })).toBeVisible();
  await expect(resposta.getByRole('button', { name: 'Enviar para minha nutricionista', exact: true })).toBeVisible();
  await resposta.getByRole('button', { name: 'Ajudou', exact: true }).click();
  await expect(resposta.getByText('Obrigado pela avaliação.')).toBeFocused();
  await expect(resposta.getByRole('button', { name: /^(Não )?[Aa]judou$/ })).toHaveCount(0);
});

test('3. "Não encontrei isso no seu plano." (fonte que não existe) → "Enviar para minha nutricionista" → "Pronto! Sua pergunta foi enviada ao consultório…"', async () => {
  await perguntar(paciente, 'SANDBOX-FONTE-INEXISTENTE');
  await expect(statusDaConversa(paciente)).toHaveText('A resposta chegou.', ATE_A_RESPOSTA);
  const resposta = conversa(paciente).getByRole('listitem').last();
  await expect(resposta).toContainText('Não encontrei isso no seu plano. Quer enviar essa pergunta para sua nutricionista?');
  await resposta.getByRole('button', { name: 'Enviar para minha nutricionista', exact: true }).click();
  await expect(conversa(paciente).getByText(PRONTO)).toBeFocused();
});

test('4. sinal de transtorno alimentar: o texto fixo na hora (sem esperar o worker), com o 188 e o 192 de tocar', async () => {
  await perguntar(paciente, 'depois do jantar eu vomito pra não engordar');
  const fixo = paciente.getByText(/^Que bom que você contou\. Esse assunto é importante/).first();
  await expect(fixo).toBeVisible();
  await expect(paciente.locator('a[href="tel:188"]').first()).toBeVisible();
  await expect(paciente.locator('a[href="tel:192"]').first()).toBeVisible();
});

test('7. sem rede, com a conversa aberta: "Perguntar" desabilitado e "Sem conexão. Pergunte quando voltar."', async () => {
  await abrirConversa(paciente);
  await paciente.getByLabel('Sua dúvida').fill('quanto de banana no lanche?');
  await expect(paciente.getByRole('button', { name: 'Perguntar', exact: true })).toBeEnabled();
  await paciente.context().setOffline(true);
  try {
    await expect(statusDaConversa(paciente)).toHaveText('Sem conexão. Pergunte quando voltar.');
    await expect(paciente.getByRole('button', { name: 'Perguntar', exact: true })).toBeDisabled();
    await expect(paciente.getByRole('button', { name: 'Enviar direto para minha nutricionista' })).toBeDisabled();
  } finally {
    await paciente.context().setOffline(false);
  }
  // SUS-112: de volta à rede, a página viva NÃO recarrega (só a cópia offline do plano): o aviso sai pelo useOnline e o
  // texto digitado continua no campo
  await expect(statusDaConversa(paciente)).not.toHaveText('Sem conexão. Pergunte quando voltar.');
  await expect(paciente.getByLabel('Sua dúvida')).toHaveValue('quanto de banana no lanche?');
});

test('5. painel: "Mensagens" › "Dúvidas da IA Nutri (n)", o risco no topo com "Sinal de risco" → abrir → "Marcar como vista" → no portal, "Sua dúvida foi vista no consultório."', async () => {
  await nutri.goto('/painel');
  // Plano 25 (CH-D14, CH-D45): a fila é a aba "Dúvidas da IA Nutri" de Mensagens; o item do menu soma as conversas não lidas
  // e as dúvidas abertas ("Mensagens, {n} não lidas"). R11 (pre-flight): o contador é do consultório inteiro (o preparo do
  // axe do painel soma dúvidas da segunda paciente)
  await nutri.getByRole('navigation', { name: 'Menu do painel' }).getByRole('link', { name: /^Mensagens, \d+ não lidas?$/ }).click();
  await expect(nutri).toHaveURL(/\/painel\/mensagens$/);
  await nutri.getByRole('navigation', { name: 'Seções de Mensagens' }).getByRole('link', { name: /^Dúvidas da IA Nutri \(\d+\)$/ }).click();
  await expect(nutri).toHaveURL(/\/painel\/duvidas$/);
  await expect(nutri.getByRole('heading', { level: 1, name: 'Dúvidas da IA Nutri' })).toBeVisible();
  const linhas = nutri.getByRole('row').filter({ hasText: UM.nome });
  await expect(linhas).toHaveCount(2); // a de risco (passo 4) e a encaminhada (passo 3)
  await expect(linhas.first()).toContainText('Sinal de risco');
  await expect(linhas.nth(1)).not.toContainText('Sinal de risco');
  await linhas.first().getByRole('link', { name: `Abrir dúvida de ${UM.nome}` }).click();
  await expect(nutri).toHaveURL(/\/painel\/duvidas\/[0-9a-f-]{36}$/);
  await nutri.getByRole('button', { name: 'Marcar como vista' }).click();
  await expect(nutri).toHaveURL(/\/painel\/duvidas\?vista=1$/);
  await paciente.goto('/p/plano/ia');
  await expect(conversa(paciente).getByText('Sua dúvida foi vista no consultório.')).toBeVisible();
});

test('6. Eu › Privacidade: desativar apaga as conversas ("IA Nutri desativada."); a autorização de IA dos exames não muda. Variante: bloqueada pela nutricionista, o botão continua e "Você desativou em {data}."', async () => {
  await paciente.goto('/p/perfil');
  const blocoIa = paciente.locator('section[aria-labelledby="eu-ia"]');
  const iaAntes = (await blocoIa.count()) ? await blocoIa.textContent() : null;
  const bloco = paciente.locator('section[aria-labelledby="eu-ia-nutri"]');
  await expect(bloco.getByRole('link', { name: 'Ler as conversas' })).toBeVisible(); // a conversa guardada
  paciente.once('dialog', (d) => void d.accept());
  await bloco.getByRole('button', { name: 'Desativar a IA Nutri e apagar as conversas' }).click();
  await expect(paciente.getByText('IA Nutri desativada.', { exact: true })).toBeVisible();
  await expect(bloco).toContainText(/Você desativou em \d{2}\/\d{2}\/\d{4}\./);
  // a conversa some: nada para ler, e a entrada volta à decisão (nenhuma conversa é mostrada)
  await expect(bloco.getByRole('link', { name: 'Ler as conversas' })).toHaveCount(0);
  await paciente.goto('/p/plano/ia');
  await expect(paciente).toHaveURL(/\/p\/plano\/ia\/autorizar\?de=plano$/);
  await expect(paciente.getByText('o que posso comer no lugar da banana à tarde?')).toHaveCount(0);
  await paciente.goto('/p/perfil');
  if (iaAntes !== null) await expect(blocoIa).toHaveText(iaAntes);
  else await expect(blocoIa).toHaveCount(0);

  // Review Focus 5: autoriza de novo; a nutricionista bloqueia na ficha; o bloco de Eu continua com o botão
  await paciente.goto('/p/plano/ia/autorizar?de=eu');
  await paciente.getByRole('button', { name: 'Autorizo o uso da IA Nutri' }).click();
  await expect(paciente).toHaveURL(/\/p\/plano\/ia$/);
  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(UM.email)}`);
  await nutri.getByRole('link', { name: UM.nome, exact: true }).click();
  await expect(nutri).toHaveURL(/\/painel\/pacientes\/[0-9a-f-]{36}$/);
  await nutri.goto(`${new URL(nutri.url()).pathname}/ia-nutri`);
  await nutri.getByLabel('Liberar a IA Nutri para este paciente').uncheck();
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'IA Nutri: bloqueada' })).toBeVisible();
  await paciente.goto('/p/perfil');
  await expect(bloco).toContainText(/Você autorizou em \d{2}\/\d{2}\/\d{4}\./);
  paciente.once('dialog', (d) => void d.accept());
  await bloco.getByRole('button', { name: 'Desativar a IA Nutri e apagar as conversas' }).click();
  await expect(paciente.getByText('IA Nutri desativada.', { exact: true })).toBeVisible();
  await expect(bloco).toContainText(/Você desativou em \d{2}\/\d{2}\/\d{4}\./);
});

test('6b. envio direto (DP-16): no limite do dia, "Perguntar" avisa; "Enviar direto para minha nutricionista" põe a dúvida na fila do painel', async ({ browser }) => {
  const dois = await entrarComo(browser, DOIS.email, DOIS.senha, '10.9.29.63');
  try {
    await expect(dois).toHaveURL(/\/p\/inicio$/);
    await abrirConversa(dois);
    const texto = `posso trocar a banana do lanche por pera? ${Date.now().toString(36)}`;
    await perguntar(dois, texto);
    await expect(statusDaConversa(dois)).toHaveText('Você chegou ao limite de 10 perguntas por hoje. Amanhã você pode perguntar de novo, ou envie sua dúvida para sua nutricionista.');
    await expect(dois.getByLabel('Sua dúvida')).toHaveValue(texto);
    await dois.getByRole('button', { name: 'Enviar direto para minha nutricionista' }).click();
    await expect(statusDaConversa(dois)).toHaveText(PRONTO);
    await nutri.goto('/painel/duvidas');
    await expect(nutri.getByRole('row').filter({ hasText: DOIS.nome }).first()).toBeVisible();
  } finally {
    await dois.context().close();
  }
});
