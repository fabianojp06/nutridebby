import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

const sufixo = Date.now().toString(36);
// o seed do E2E não apaga pacientes: o sufixo no nome evita várias "Ana Souza" (strict mode) nas execuções locais seguintes
const ANA = { nome: `Ana Souza ${sufixo}`, email: `ana-${sufixo}@nutridebby.test`, senha: `Ana${sufixo}2026` };
let nutri: Page;
let prontuario = '';

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.5.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

async function preencherCadastro(page: Page, dados: { nome: string; email: string; nascimento: string }) {
  await page.getByLabel('Nome').fill(dados.nome);
  await page.getByLabel('Data de nascimento').fill(dados.nascimento);
  await page.getByLabel('Feminino').check();
  await page.getByLabel('E-mail').fill(dados.email);
  await page.getByLabel('Telefone (opcional)').fill('(11) 91234-5678');
  await page.getByLabel('Paciente autorizou receber mensagens por WhatsApp').check();
}

test('cadastra paciente adulto; menor de 18 e e-mail repetido são recusados (US-010, RN-17)', async () => {
  await nutri.goto('/painel/pacientes/novo');
  await preencherCadastro(nutri, { nome: ANA.nome, email: ANA.email, nascimento: '2010-01-01' });
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.locator('p[role="alert"]')).toHaveText('O sistema atende apenas pacientes a partir de 18 anos');
  await expect(nutri.getByLabel('Nome')).toHaveValue(ANA.nome); // PF-N9: nada do que foi digitado se perde

  await nutri.getByLabel('Data de nascimento').fill('1991-03-10');
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.getByRole('heading', { level: 1, name: ANA.nome })).toBeVisible();
  prontuario = new URL(nutri.url()).pathname;

  await nutri.goto('/painel/pacientes/novo');
  await preencherCadastro(nutri, { nome: 'Outra Ana', email: ANA.email.toUpperCase(), nascimento: '1990-01-01' });
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.getByText('Paciente já cadastrado com este e-mail')).toBeVisible();

  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(`ana souza ${sufixo}`)}`);
  await expect(nutri.getByRole('link', { name: ANA.nome })).toBeVisible();
});

test('o paciente recebe o convite, cria a senha, aceita o termo e chega ao portal; o link não vale de novo (US-010, US-011)', async ({ browser }) => {
  const email = await esperarEmail(ANA.email, { assunto: 'Convite de Consultório E2E no NutriDebby' });
  const link = primeiroLink(email.texto, '/convite/paciente/');
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.5.2' } });
  const page = await ctx.newPage();
  const resposta = await page.goto(link);
  expect(resposta?.headers()['referrer-policy']).toBe('no-referrer');
  await page.getByLabel('Nova senha').fill(ANA.senha);
  await page.getByLabel('Repita a senha').fill(ANA.senha);
  const continuar = page.getByRole('button', { name: 'Continuar' });
  await expect(continuar).toBeDisabled(); // US-011 "Consentimento obrigatório"
  await page.getByLabel(/^Li e aceito o Termo de Uso e Privacidade \(versão /).check();
  await expect(page.getByLabel('Quero receber lembretes por WhatsApp')).toBeChecked(); // a nutricionista autorizou
  await continuar.click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await expect(page.getByRole('heading', { name: 'Meu acompanhamento' })).toBeVisible();
  await page.goto(link);
  await expect(page.locator('p[role="alert"]')).toContainText('Convite inválido ou já usado.');
  await ctx.close();

  await nutri.goto(prontuario);
  await expect(nutri.getByText('Ativo: o paciente já criou a senha.')).toBeVisible();
});

test('o paciente sai pelo "Sair" do portal: cai em /entrar e /p/inicio deixa de abrir (US-002 "Sair")', async ({ browser }) => {
  const page = await entrarComo(browser, ANA.email, ANA.senha, '10.9.5.8');
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await expect(page.getByRole('heading', { name: 'Meu acompanhamento' })).toBeVisible();
  const antes = await page.context().cookies();
  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.goto('/p/inicio');
  await expect(page).toHaveURL(/\/entrar\?volta=%2Fp%2Finicio$/);
  await page.context().addCookies(antes); // sessão apagada no servidor: o cookie antigo não abre o portal
  await page.goto('/p/inicio');
  await expect(page).toHaveURL(/\/entrar/);
  await expect(page.getByRole('heading', { name: 'Meu acompanhamento' })).toHaveCount(0);
  await page.context().close();
});

test('abrir o prontuário fica registrado no "Histórico de acessos" (US-007)', async () => {
  await nutri.goto(prontuario);
  await nutri.getByRole('link', { name: 'Histórico de acessos' }).click();
  const primeira = nutri.getByRole('row').nth(1);
  await expect(primeira).toContainText('Visualizou');
  await expect(primeira).toContainText('Cadastro do paciente');
  await expect(primeira).toContainText('(nutricionista)');
});

test('paciente de outro tenant ou id inválido → 404', async () => {
  const r = await nutri.goto('/painel/pacientes/00000000-0000-4000-8000-000000000000');
  expect(r?.status()).toBe(404);
  expect((await nutri.request.get('/api/painel/pacientes/abc')).status()).toBe(404);
});

test('antropometria: IMC e % de gordura aparecem ao digitar; JP 3 dobras da mulher de 35 anos = 24,44 (US-013)', async () => {
  await nutri.goto(`${prontuario}/antropometria`);
  await nutri.getByLabel('Data da avaliação').fill('2026-09-01');
  await nutri.getByLabel('Peso (kg)').fill('70');
  await nutri.getByLabel('Altura (cm)').fill('175');
  await expect(nutri.getByText('IMC: 22,86')).toBeVisible();
  await nutri.getByLabel('Protocolo de dobras').selectOption('jp3');
  await nutri.getByLabel('Tríceps').fill('20');
  await nutri.getByLabel('Supra-ilíaca').fill('20');
  await expect(nutri.getByText('Preencha as 3 dobras para calcular o % de gordura')).toBeVisible();
  await nutri.getByLabel('Coxa', { exact: true }).last().fill('20');
  await expect(nutri.getByText('% de gordura: 24,44')).toBeVisible();
  await nutri.getByRole('button', { name: 'Salvar avaliação' }).click();
  await expect(nutri.getByRole('status')).toHaveText('Avaliação salva.');
  const linha = nutri.getByRole('row', { name: /01\/09\/2026/ });
  await expect(linha).toContainText('22,86');
  await expect(linha).toContainText('24,44');
});

test('anamnese: modelo com "Alergias" obrigatória recusa salvar vazia e depois salva (US-012)', async () => {
  await nutri.goto('/painel/anamnese/modelos');
  await expect(nutri.getByText(/^Anamnese geral \(padrão\)/)).toBeVisible(); // "Modelo padrão"
  await nutri.getByRole('link', { name: 'Novo modelo' }).click();
  const nomeModelo = `Triagem ${sufixo}`;
  await nutri.getByLabel('Nome do modelo').fill(nomeModelo);
  await nutri.getByLabel('Texto da pergunta 1').fill('Alergias');
  await nutri.getByLabel('Pergunta 1 obrigatória').check();
  await nutri.getByRole('button', { name: 'Adicionar pergunta' }).click();
  await nutri.getByLabel('Texto da pergunta 2').fill('Refeições por dia');
  await nutri.getByLabel('Tipo da pergunta 2').selectOption('numero');
  await nutri.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(nutri).toHaveURL(/\/painel\/anamnese\/modelos$/);

  await nutri.goto(`${prontuario}/anamnese`);
  await nutri.getByLabel('Modelo').selectOption({ label: nomeModelo });
  await nutri.getByRole('button', { name: 'Preencher anamnese' }).click();
  await nutri.getByLabel('Refeições por dia').fill('4');
  await nutri.getByRole('button', { name: 'Salvar anamnese' }).click();
  await expect(nutri.locator('p[role="alert"]')).toHaveText('Responda: Alergias');
  await expect(nutri.getByLabel('Refeições por dia')).toHaveValue('4');
  await nutri.getByLabel('Alergias (obrigatória)').fill('Lactose');
  await nutri.getByRole('button', { name: 'Salvar anamnese' }).click();
  await expect(nutri.getByRole('heading', { name: new RegExp(`^${nomeModelo} · `) })).toBeVisible();
  await expect(nutri.getByLabel('Alergias (obrigatória)')).toHaveValue('Lactose');
});

test('exportar dados: o worker gera o ZIP, o link chega por e-mail e baixa o arquivo (US-018 "Exportar")', async () => {
  const pedido = new Date();
  await nutri.goto(`${prontuario}/privacidade`);
  await nutri.getByRole('button', { name: 'Exportar dados' }).click();
  await expect(nutri).toHaveURL(/\/exportacoes\/[0-9a-f-]{36}$/);
  const exportId = new URL(nutri.url()).pathname.split('/').pop()!;
  const email = await esperarEmail(NUTRI.email, { assunto: 'Exportação de dados pronta', depoisDe: pedido });
  const link = primeiroLink(email.texto, `/exportacoes/${exportId}`);
  expect(email.texto).not.toContain(ANA.nome); // e-mail sem dado do paciente
  await nutri.goto(link);
  const baixando = nutri.waitForEvent('download');
  await nutri.getByRole('link', { name: 'Baixar ZIP' }).click();
  const download = await baixando;
  expect(download.suggestedFilename()).toBe('exportacao.zip');
  const conteudo = await download.createReadStream();
  const [primeiro] = await conteudo.toArray();
  expect(Buffer.from(primeiro).subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
});

test('arquivar tira da lista de ativos e mostra o selo; desarquivar devolve (US-018 "Arquivar")', async () => {
  await nutri.goto(`${prontuario}/privacidade`);
  // antes de atender a exclusão, a nutricionista lê o que sai na hora (Plano 06: fotos do diário, notificações, portal)
  await expect(nutri.getByText(/Na hora são apagadas as fotos do diário, os exames enviados pelo app que ainda não foram aceitos, as autorizações de WhatsApp, as notificações no app e os convites/)).toBeVisible();
  nutri.once('dialog', (d) => d.accept());
  await nutri.getByRole('button', { name: 'Arquivar paciente' }).click();
  await expect(nutri.locator('header', { hasText: ANA.nome }).getByText('Arquivado', { exact: true })).toBeVisible(); // selo do prontuário
  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(ANA.email)}`);
  await expect(nutri.getByText('Nenhum paciente encontrado.')).toBeVisible();
  await nutri.goto(`/painel/pacientes?status=arquivado&busca=${encodeURIComponent(ANA.email)}`);
  await expect(nutri.getByRole('link', { name: ANA.nome })).toBeVisible();
  await nutri.goto(`${prontuario}/privacidade`);
  await nutri.getByRole('button', { name: 'Desarquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Arquivar paciente' })).toBeVisible();
});
