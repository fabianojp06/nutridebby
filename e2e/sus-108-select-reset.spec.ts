import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { criarPacientePeloFormulario } from './pacientes-form';

// SUS-108: o React 19 chama form.reset() depois de toda action do <form action>. Um <select value> controlado voltava à
// primeira opção (ou à do HTML do servidor) e um <input checked> controlado ao estado da montagem — a tela mostrava outra
// coisa que o estado (e que o JSON da receita), e o reenvio mandava o que a tela mostrava. Cada caso confere a tela LOGO
// depois da resposta, antes de qualquer digitação (a próxima renderização do campo ressincronizava e escondia o defeito).
// Bloco de IP deste spec (o limite de login é por IP): 10.9.108.1 a 10.9.108.9 — nutricionista .1.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;
let prontuario: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.108.1', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/); // o login termina antes do goto (sem isso o goto cai em /entrar)
  prontuario = await criarPacientePeloFormulario(nutri, { nome: 'Paciente SUS 108', email: `sus108-${Date.now()}@nutridebby.test`, nascimento: '1990-05-20', sexo: 'Feminino' });
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('antropometria: depois do erro, o protocolo continua o escolhido (não volta a "Nenhum")', async () => {
  await nutri.goto(`${prontuario}/antropometria`);
  await nutri.waitForLoadState('networkidle'); // formulário controlado: o clique antes da hidratação se perde
  await nutri.getByLabel('Data da avaliação').fill('1980-01-01'); // antes do nascimento: erro do servidor
  await nutri.getByLabel('Peso (kg)').fill('70');
  await nutri.getByLabel('Altura (cm)').fill('170');
  await nutri.getByLabel('Protocolo de dobras').selectOption('jp3');
  await nutri.getByRole('button', { name: 'Salvar avaliação' }).click();
  await expect(nutri.getByText('A data não pode ser anterior à data de nascimento')).toBeVisible();
  await expect(nutri.getByLabel('Protocolo de dobras')).toHaveValue('jp3');
  await expect(nutri.locator('input[name^="dobra_"]')).toHaveCount(3); // as dobras do JP 3 (feminino)
  // o que um reenvio mandaria
  expect(await nutri.locator('form').filter({ has: nutri.getByLabel('Protocolo de dobras') }).evaluate((f: HTMLFormElement) => new FormData(f).get('protocolo'))).toBe('jp3');
});

test('receita: depois do erro do "Preparar" e do "Rascunho salvo.", a tela mostra o que o JSON salva', async () => {
  await nutri.goto(`${prontuario}/documentos`);
  await nutri.getByRole('button', { name: 'Nova receita' }).click();
  await expect(nutri).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
  await nutri.waitForLoadState('networkidle');
  await nutri.getByRole('button', { name: 'Adicionar item' }).click();
  await nutri.getByLabel('Categoria').selectOption('enzima');
  await nutri.getByLabel('Componente 1').fill('Lactase');
  await nutri.getByLabel('Quantidade').fill('9000');
  await nutri.getByLabel('Unidade').selectOption('U');
  await nutri.getByLabel('Forma de apresentação').fill('Cápsula');
  await nutri.getByLabel('Posologia').fill('1 cápsula antes do leite');
  await nutri.getByLabel('Via').selectOption('sublingual');
  await nutri.getByLabel('Manipulado').check();
  await nutri.getByLabel('Justificativa de uso').fill('Intolerância à lactose');
  const tela = async () => {
    await expect(nutri.getByLabel('Categoria')).toHaveValue('enzima');
    await expect(nutri.getByLabel('Unidade')).toHaveValue('U');
    await expect(nutri.getByLabel('Via')).toHaveValue('sublingual');
    await expect(nutri.getByLabel('Manipulado')).toBeChecked();
    const json = JSON.parse((await nutri.locator('input[name="conteudo"]').inputValue()) || '{}');
    expect(json.itens[0]).toMatchObject({ categoria: 'enzima', via: 'sublingual', manipulado: true, composicao: [{ unidade: 'U' }] });
  };
  // "Preparar" sem a declaração: erro
  await nutri.getByRole('button', { name: 'Preparar para assinatura' }).click();
  await expect(nutri.getByText('Confirme a declaração para continuar.')).toBeVisible();
  await tela();
  // "Salvar rascunho": sucesso (o reset também rodava)
  await nutri.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();
  await tela();
});

test('lembrete de água: depois do erro, o intervalo e os dias continuam os escolhidos', async () => {
  await nutri.goto(`${prontuario}/plano-alimentar`);
  await nutri.waitForLoadState('networkidle');
  const form = nutri.locator('form').filter({ has: nutri.getByRole('button', { name: 'Salvar lembrete de água' }) });
  await form.getByLabel('Intervalo').selectOption('60'); // a sugestão vem com 2 h
  await form.getByLabel('Fim').fill('07:00'); // antes do início: erro do servidor
  const domingo = form.getByLabel('Domingo');
  const marcado = await domingo.isChecked();
  await domingo.setChecked(!marcado);
  await form.getByRole('button', { name: 'Salvar lembrete de água' }).click();
  await expect(form.getByText('O fim precisa ser depois do início.')).toBeVisible();
  await expect(form.getByLabel('Intervalo')).toHaveValue('60');
  await expect(domingo).toBeChecked({ checked: !marcado });
});

test('gasto energético: depois do erro, a fórmula continua a escolhida (não volta a "Mifflin-St Jeor")', async () => {
  await nutri.goto(`${prontuario}/gasto-energetico`);
  await nutri.waitForLoadState('networkidle');
  await nutri.getByLabel('Peso (kg)').fill('70');
  await nutri.getByLabel('Altura (cm)').fill('170');
  await nutri.getByLabel('Fator de atividade').fill('9'); // fora da faixa: erro do servidor
  await nutri.getByLabel('Harris-Benedict').check();
  await nutri.getByRole('button', { name: 'Salvar cálculo' }).click();
  await expect(nutri.locator('form [role="alert"]').first()).toBeVisible();
  await expect(nutri.getByLabel('Harris-Benedict')).toBeChecked();
  await expect(nutri.getByLabel('Mifflin-St Jeor')).not.toBeChecked();
});
