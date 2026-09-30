import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';

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
