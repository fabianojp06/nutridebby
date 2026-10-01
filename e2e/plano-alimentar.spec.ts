import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

const sufixo = Date.now().toString(36);
let nutri: Page;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.6.1');
  await expect(nutri).toHaveURL(/\/painel$/); // sem esperar o login, o goto seguinte interrompe a navegação
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('busca tolerante a acento com selo de origem e fonte citada (US-020)', async () => {
  await nutri.goto('/painel/alimentos');
  await expect(nutri.getByText('Fonte: TACO 4ª ed. — NEPA/UNICAMP. Valores por 100 g.')).toBeVisible();
  await nutri.getByLabel('Buscar alimento').fill('feijao carioca');
  const opcao = nutri.getByRole('option', { name: /Feijão, carioca, cozido/ });
  await expect(opcao).toBeVisible();
  await expect(opcao).toContainText('76 kcal/100 g');
  await expect(opcao).toContainText('TACO');
  const posicao = await nutri.getByRole('option').evaluateAll((os) => os.findIndex((o) => o.textContent?.includes('Feijão, carioca, cozido')));
  expect(posicao).toBeLessThan(5);
});

test('busca: "Nenhum alimento encontrado.", Esc fecha a lista e Enter abre o alimento destacado (US-020)', async () => {
  await nutri.goto('/painel/alimentos');
  const busca = nutri.getByLabel('Buscar alimento');
  const semResultado = nutri.getByRole('status');
  await busca.fill('xqzwv');
  await expect(semResultado).toHaveText('Nenhum alimento encontrado.');
  await busca.fill('x'); // menos de 2 caracteres: nada de aviso
  await expect(semResultado).toHaveCount(0);
  await busca.fill('chuchu');
  await expect(nutri.getByRole('option', { name: /Chuchu, cozido/ })).toBeVisible();
  await expect(semResultado).toHaveCount(0);
  await busca.press('Escape');
  await expect(nutri.getByRole('option')).toHaveCount(0);
  await expect(semResultado).toHaveCount(0);
  await busca.fill('chuchu cozido');
  await expect(nutri.getByRole('option')).toHaveCount(1);
  await busca.press('Enter');
  await expect(nutri).toHaveURL(/\/painel\/alimentos\/00000000-0000-4000-8000-000000000112$/);
  await expect(nutri.getByRole('heading', { name: 'Chuchu, cozido' })).toBeVisible();
});

test('meu alimento: cadastro com selo, TACO só com "Duplicar como meu alimento", medida caseira (US-021, US-020)', async () => {
  await nutri.goto('/painel/alimentos/novo');
  await nutri.getByLabel('Nome').fill('x');
  await nutri.getByLabel('Energia (kcal)').fill('901');
  await nutri.getByRole('button', { name: 'Salvar alimento' }).click();
  await expect(nutri.getByText('Informe o nome do alimento (2 a 120 caracteres)')).toBeVisible();
  await expect(nutri.getByText('Escolha o grupo do alimento')).toBeVisible();
  await expect(nutri.getByText('Valores por 100 g: informe números entre 0 e 900').first()).toBeVisible();
  await expect(nutri.getByLabel('Nome')).toHaveValue('x'); // o que foi digitado não se perde
  await expect(nutri.getByLabel('Energia (kcal)')).toHaveValue('901');
  await nutri.getByLabel('Nome').fill(`Pão low carb ${sufixo}`);
  await nutri.getByLabel('Grupo').selectOption('Cereais e derivados');
  await nutri.getByLabel('Energia (kcal)').fill('250');
  await nutri.getByLabel('Proteína (g)').fill('12');
  await nutri.getByLabel('Carboidrato (g)').fill('8');
  await nutri.getByLabel('Lipídio (g)').fill('18');
  await nutri.getByLabel('Fibra (g)').fill('6');
  await nutri.getByRole('button', { name: 'Salvar alimento' }).click();
  await expect(nutri.getByRole('heading', { name: `Pão low carb ${sufixo}` })).toBeVisible();
  await expect(nutri.getByText('Meu alimento', { exact: true })).toBeVisible();

  await nutri.goto('/painel/alimentos/00000000-0000-4000-8000-000000000112'); // Chuchu, cozido (TACO, sem medida)
  await expect(nutri.getByRole('button', { name: 'Duplicar como meu alimento' })).toBeVisible();
  await expect(nutri.getByRole('link', { name: 'Editar' })).toHaveCount(0);
  const excluirMedida = nutri.getByRole('button', { name: 'Excluir a medida pires pequeno' });
  if (await excluirMedida.count()) {
    // sobra de uma execução anterior que parou no meio: limpa para o aviso "Sem medida caseira" valer
    nutri.once('dialog', (d) => void d.accept());
    await excluirMedida.click();
  }
  await expect(nutri.getByText('Sem medida caseira')).toBeVisible();
  await nutri.getByLabel('Medida (singular)').fill('pires pequeno');
  await nutri.getByLabel('Plural').fill('pires pequenos');
  await nutri.getByLabel('Gramas').fill('60');
  await nutri.getByRole('button', { name: 'Cadastrar medida caseira' }).click();
  await expect(nutri.getByRole('status')).toHaveText('Medida "pires pequeno" cadastrada.');
  await expect(nutri.getByText('pires pequeno — 60 g')).toBeVisible();

  // a medida é do tenant: sai pelo botão com confirmação (e deixa o banco do E2E como estava)
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Excluir a medida pires pequeno' }).click();
  await expect(nutri.getByText('Sem medida caseira')).toBeVisible();
});

test('duplicar alimento da TACO sem valor abre a edição com aviso; editar e excluir (US-021)', async () => {
  await nutri.goto('/painel/alimentos/00000000-0000-4000-8000-000000000458'); // Leite, de vaca, integral ("*" na TACO)
  await expect(nutri.getByText('Sem valor na TACO').first()).toBeVisible();
  await nutri.getByRole('button', { name: 'Duplicar como meu alimento' }).click();
  await expect(nutri).toHaveURL(/\/painel\/alimentos\/[0-9a-f-]{36}\/editar\?incompleto=1$/);
  await expect(nutri.getByRole('status')).toHaveText('A TACO não tem todos os valores deste alimento: confira os campos com 0.');
  await nutri.getByLabel('Nome').fill(`Leite da casa ${sufixo}`);
  await nutri.getByLabel('Energia (kcal)').fill('61');
  await nutri.getByLabel('Proteína (g)').fill('3,2'); // vírgula decimal (RNF-12)
  await nutri.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(nutri.getByRole('heading', { name: `Leite da casa ${sufixo}` })).toBeVisible();
  await expect(nutri.getByText('Meu alimento', { exact: true })).toBeVisible();
  await expect(nutri.getByRole('row', { name: /Energia/ })).toContainText('61 kcal');
  await expect(nutri.getByRole('row', { name: /Proteína/ })).toContainText('3,2 g');
  await expect(nutri.getByRole('link', { name: 'Editar' })).toBeVisible();

  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(nutri).toHaveURL(/\/painel\/alimentos$/);
  await nutri.getByLabel('Buscar alimento').fill(`Leite da casa ${sufixo}`);
  await expect(nutri.getByRole('status')).toHaveText('Nenhum alimento encontrado.');
});
