import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

const sufixo = Date.now().toString(36);
const VALORES = 'Valores por 100 g: energia entre 0 e 900 kcal; os demais entre 0 e 100 g';
const BLOQUEADO = 'Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.';
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
  await expect(nutri.getByText(VALORES).first()).toBeVisible();
  await expect(nutri.getByLabel('Nome')).toHaveValue('x'); // o que foi digitado não se perde
  await expect(nutri.getByLabel('Energia (kcal)')).toHaveValue('901');
  // o grupo escolhido também sobrevive ao erro de outro campo (o <select> não volta para "Escolha…")
  await nutri.getByLabel('Grupo').selectOption('Frutas e derivados');
  await nutri.getByRole('button', { name: 'Salvar alimento' }).click();
  await expect(nutri.getByText(VALORES).first()).toBeVisible();
  await expect(nutri.getByText('Escolha o grupo do alimento')).toHaveCount(0);
  await expect(nutri.getByLabel('Grupo')).toHaveValue('Frutas e derivados');
  await nutri.getByLabel('Grupo').selectOption('Produtos açucarados'); // trocar de novo depois de um erro também vale
  await nutri.getByRole('button', { name: 'Salvar alimento' }).click();
  await expect(nutri.getByText(VALORES).first()).toBeVisible();
  await expect(nutri.getByLabel('Grupo')).toHaveValue('Produtos açucarados');
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
  await expect(nutri.getByLabel('Grupo')).toHaveValue('Leite e derivados'); // veio da cópia
  await nutri.getByLabel('Nome').fill(`Leite da casa ${sufixo}`);
  await nutri.getByLabel('Grupo').selectOption('Bebidas (alcoólicas e não alcoólicas)');
  await nutri.getByLabel('Energia (kcal)').fill('901'); // erro em outro campo: o grupo trocado não pode voltar ao antigo
  await nutri.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(nutri.getByText(VALORES).first()).toBeVisible();
  await expect(nutri.getByLabel('Grupo')).toHaveValue('Bebidas (alcoólicas e não alcoólicas)');
  await expect(nutri.getByLabel('Nome')).toHaveValue(`Leite da casa ${sufixo}`);
  await nutri.getByLabel('Energia (kcal)').fill('61');
  await nutri.getByLabel('Proteína (g)').fill('3,2'); // vírgula decimal (RNF-12)
  await nutri.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(nutri.getByRole('heading', { name: `Leite da casa ${sufixo}` })).toBeVisible();
  await expect(nutri.getByText('Bebidas (alcoólicas e não alcoólicas)', { exact: true })).toBeVisible(); // o grupo novo foi salvo, não o antigo
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

let prontuario = '';
let editor = '';
const ALIMENTO_130 = `Alimento 130 ${sufixo}`;

test('editor: cálculo ao vivo, medida caseira, meta por faixa e salvamento automático com aviso offline (US-022, US-020)', async () => {
  // Alimento de 130 kcal/100 g (cenário "Cálculo do item")
  await nutri.goto('/painel/alimentos/novo');
  await nutri.getByLabel('Nome').fill(ALIMENTO_130);
  await nutri.getByLabel('Grupo').selectOption('Miscelâneas');
  for (const [rotulo, v] of [['Energia (kcal)', '130'], ['Proteína (g)', '10'], ['Carboidrato (g)', '15'], ['Lipídio (g)', '3'], ['Fibra (g)', '1']] as const) await nutri.getByLabel(rotulo).fill(v);
  await nutri.getByRole('button', { name: 'Salvar alimento' }).click();
  await expect(nutri.getByRole('heading', { name: ALIMENTO_130 })).toBeVisible();

  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(`Paciente Plano ${sufixo}`);
  await nutri.getByLabel('Data de nascimento').fill('1991-03-10');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(`plano-${sufixo}@nutridebby.test`);
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.getByRole('heading', { level: 1, name: `Paciente Plano ${sufixo}` })).toBeVisible();
  prontuario = new URL(nutri.url()).pathname;

  await nutri.goto(`${prontuario}/plano-alimentar`);
  await nutri.getByRole('button', { name: 'Criar plano' }).click();
  await expect(nutri.getByRole('heading', { name: 'Plano alimentar — versão 1' })).toBeVisible();
  editor = new URL(nutri.url()).pathname;

  await nutri.getByLabel('Meta (kcal)').fill('500'); // o servidor aceita meta de 500 a 10000 kcal
  await nutri.getByRole('button', { name: 'Adicionar refeição' }).click();
  await nutri.getByLabel('Refeição', { exact: true }).fill('Almoço');
  await nutri.getByLabel('Horário de Almoço').fill('12:00');
  await nutri.getByLabel('Adicionar alimento em Almoço').fill(ALIMENTO_130);
  await nutri.getByRole('option', { name: new RegExp(ALIMENTO_130) }).click();
  await nutri.getByLabel(`Gramas de ${ALIMENTO_130}`).fill('150');
  await expect(nutri.getByText('Total do dia: 195 kcal')).toBeVisible(); // 130 × 150 / 100
  await expect(nutri.getByTestId('indicador-meta')).toHaveText('Fora da meta (−61%)'); // (195 − 500) / 500

  // Medida caseira do seed IBGE: arroz, 4 colheres de sopa cheias = 100 g = 128 kcal
  await nutri.getByLabel('Adicionar alimento em Almoço').fill('arroz tipo 1 cozido');
  await nutri.getByRole('option', { name: /Arroz, tipo 1, cozido/ }).click();
  await nutri.getByLabel('Quantidade de Arroz, tipo 1, cozido').fill('4');
  await expect(nutri.getByText('4 colheres de sopa cheias · 100 g · 128 kcal')).toBeVisible();
  await expect(nutri.getByText('Total do dia: 323 kcal')).toBeVisible(); // 195 + 128
  await expect(nutri.getByTestId('indicador-meta')).toHaveText('Fora da meta (−35,4%)'); // (323 − 500) / 500

  // Meta por faixa (RN-02), sempre com texto: até 5% verde, até 10% amarelo, acima vermelho
  const gramas = nutri.getByLabel(`Gramas de ${ALIMENTO_130}`);
  await gramas.fill('300'); // 390 + 128 = 518
  await expect(nutri.getByTestId('indicador-meta')).toHaveText('Dentro da meta (+3,6%)');
  await gramas.fill('320'); // 416 + 128 = 544
  await expect(nutri.getByTestId('indicador-meta')).toHaveText('Atenção (+8,8%)');
  await gramas.fill('330'); // 429 + 128 = 557
  await expect(nutri.getByTestId('indicador-meta')).toHaveText('Fora da meta (+11,4%)');
  await gramas.fill('150');
  await expect(nutri.getByText('Total do dia: 323 kcal')).toBeVisible();
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 5000 });

  await nutri.reload();
  await expect(nutri).toHaveURL(editor);
  await expect(nutri.getByLabel(`Gramas de ${ALIMENTO_130}`)).toHaveValue('150');
  await expect(nutri.getByText('Total do dia: 323 kcal')).toBeVisible();

  // "se a conexão cair, vejo 'Alterações não salvas' e o salvamento é repetido quando a conexão voltar"
  await nutri.context().setOffline(true);
  await nutri.getByLabel(`Gramas de ${ALIMENTO_130}`).fill('100');
  await expect(nutri.getByRole('status').filter({ hasText: 'Alterações não salvas' })).toBeVisible({ timeout: 5000 });
  await nutri.context().setOffline(false);
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 10000 });
  await nutri.reload();
  await expect(nutri.getByLabel(`Gramas de ${ALIMENTO_130}`)).toHaveValue('100');
});

test('editor: edição em outra aba mostra o aviso de conflito e o salvamento não insiste (D7)', async () => {
  const outra = await nutri.context().newPage();
  await outra.goto(editor);
  await nutri.goto(editor);
  await outra.getByLabel('Orientações gerais').fill('Beber água ao longo do dia.');
  await expect(outra.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 5000 });
  await outra.close();

  await nutri.getByLabel('Orientações gerais').fill('Outra orientação.'); // revisão velha: 409
  await expect(nutri.getByRole('status').filter({ hasText: 'Este plano foi alterado em outra aba. Recarregue a página para continuar.' })).toBeVisible({ timeout: 5000 });
  await nutri.getByLabel('Orientações gerais').fill('Mais uma edição.'); // o aviso fica, não vira "Salvando…"
  await expect(nutri.getByRole('status').filter({ hasText: 'Este plano foi alterado em outra aba' })).toBeVisible();

  await nutri.getByRole('button', { name: 'Recarregar' }).click();
  await expect(nutri.getByLabel('Orientações gerais')).toHaveValue('Beber água ao longo do dia.'); // o que a outra aba salvou
  await nutri.getByLabel('Orientações gerais').fill(''); // deixa o rascunho como estava para as próximas tarefas
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 5000 });
});

test('editor: limites de 15 refeições e 200 itens bloqueiam "Adicionar" com o motivo; erro geral do servidor aparece na tela (US-022)', async () => {
  const LIMITE = 'O plano pode ter até 15 refeições e 200 itens.';
  // Paciente próprio: o plano do teste anterior segue como as próximas tarefas esperam
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(`Paciente Limites ${sufixo}`);
  await nutri.getByLabel('Data de nascimento').fill('1991-03-10');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(`limites-${sufixo}@nutridebby.test`);
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.getByRole('heading', { level: 1, name: `Paciente Limites ${sufixo}` })).toBeVisible();
  const pront = new URL(nutri.url()).pathname;
  await nutri.goto(`${pront}/plano-alimentar`);
  await nutri.getByRole('button', { name: 'Criar plano' }).click();
  await expect(nutri.getByRole('heading', { name: 'Plano alimentar — versão 1' })).toBeVisible();
  const planoUrl = new URL(nutri.url()).pathname;
  const api = `/api/painel/planos/${planoUrl.split('/').pop()}`;

  // 15 refeições e 200 itens chegam ao servidor pela própria API (a tela não deixa passar disso)
  const atual = (await (await nutri.request.get(api)).json()) as { revisao: number; titulo: string };
  const chuchu = '00000000-0000-4000-8000-000000000112';
  const refeicoes = Array.from({ length: 15 }, (_, k) => ({
    id: randomUUID(),
    nome: `Refeição ${k + 1}`,
    horario: '',
    observacao: '',
    itens: k === 0 ? Array.from({ length: 200 }, () => ({ id: randomUUID(), foodId: chuchu, quantidadeG: '10', medida: null, substituiItemId: null })) : [],
  }));
  const r = await nutri.request.put(api, { data: { revisao: atual.revisao, envio: randomUUID(), titulo: atual.titulo, metaKcal: '', energyCalcId: null, mostrarCalorias: false, orientacoes: '', refeicoes } });
  expect(r.status()).toBe(200);

  await nutri.reload();
  await expect(nutri.getByRole('button', { name: 'Adicionar refeição' })).toBeDisabled();
  await expect(nutri.locator('#limite-refeicoes')).toHaveText(LIMITE);
  await expect(nutri.getByLabel(/^Adicionar alimento em/)).toHaveCount(0); // 200 itens: sem busca, com o motivo
  const substituir = nutri.getByRole('button', { name: /^Adicionar substituição para/ }).first();
  await expect(substituir).toBeDisabled(); // a substituição também é item: no limite não abre a busca e aponta o motivo
  await expect(substituir).toHaveAccessibleDescription(LIMITE);
  await expect(nutri.getByText(LIMITE)).toHaveCount(16); // 1 do botão + 1 em cada refeição

  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Remover refeição' }).last().click(); // 14 refeições: volta a poder adicionar
  await expect(nutri.getByRole('button', { name: 'Adicionar refeição' })).toBeEnabled();
  await expect(nutri.locator('#limite-refeicoes')).toHaveCount(0);
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 5000 });

  // Erro `geral` do servidor (422 sem campo): aparece como alerta, e o salvamento volta quando o servidor volta
  await nutri.route('**/api/painel/planos/*', (rota) =>
    rota.request().method() === 'PUT' ? rota.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ erros: { geral: LIMITE } }) }) : rota.continue(),
  );
  await nutri.getByLabel('Título').fill('Plano com limites');
  await expect(nutri.getByRole('alert').filter({ hasText: LIMITE })).toBeVisible({ timeout: 5000 });
  await expect(nutri.getByRole('status').filter({ hasText: 'Corrija os campos destacados para salvar.' })).toBeVisible();
  await nutri.unroute('**/api/painel/planos/*');
  await nutri.getByLabel('Título').fill('Plano com limites e salvo');
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 5000 });
  await expect(nutri.getByRole('alert').filter({ hasText: LIMITE })).toHaveCount(0);

  // Resposta perdida depois de gravar (D7): o servidor gravou e a tela não soube; a nova tentativa leva a chave do
  // envio incerto e é aceita, em vez de virar um falso "alterado em outra aba"
  let perdida = false;
  await nutri.route('**/api/painel/planos/*', async (rota) => {
    if (rota.request().method() !== 'PUT' || perdida) return rota.continue();
    perdida = true;
    const gravou = await rota.fetch(); // chega ao servidor e grava
    expect(gravou.status()).toBe(200);
    await rota.abort('connectionreset'); // a resposta não chega à tela
  });
  await nutri.getByLabel('Título').fill('Plano com resposta perdida');
  await expect(nutri.getByRole('status').filter({ hasText: 'Alterações não salvas' })).toBeVisible({ timeout: 5000 });
  await nutri.unroute('**/api/painel/planos/*');
  await nutri.getByLabel('Orientações gerais').fill('Depois da resposta perdida.');
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 10000 });
  await nutri.reload();
  await expect(nutri.getByLabel('Título')).toHaveValue('Plano com resposta perdida');
  await expect(nutri.getByLabel('Orientações gerais')).toHaveValue('Depois da resposta perdida.');

  // Sessão expirada (401): o editor para e diz o motivo, em vez de repetir para sempre como "sem rede"
  await nutri.route('**/api/painel/planos/*', (rota) =>
    rota.request().method() === 'PUT' ? rota.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ erro: 'Sessão expirada. Entre de novo.' }) }) : rota.continue(),
  );
  await nutri.getByLabel('Título').fill('Plano sem sessão');
  await expect(nutri.getByRole('status').filter({ hasText: 'Sessão expirada. Entre de novo.' })).toBeVisible({ timeout: 5000 });
  await nutri.unroute('**/api/painel/planos/*');
  await nutri.getByRole('button', { name: 'Recarregar' }).click();
  await expect(nutri.getByLabel('Título')).toHaveValue('Plano com resposta perdida'); // nada foi gravado sem sessão

  // O texto de observação tem teto de 2000 caracteres na própria caixa (o servidor recusaria acima disso)
  await expect(nutri.getByLabel('Observação').first()).toHaveAttribute('maxlength', '2000');
  await expect(nutri.getByLabel('Orientações gerais')).toHaveAttribute('maxlength', '2000');
});

test('substituições: ligadas ao principal, fora do total, com kcal própria e diferença (US-023)', async () => {
  await nutri.goto(editor);
  const totalAntes = await nutri.getByText(/^Total do dia: \d+ kcal/).textContent();
  await nutri.getByRole('button', { name: 'Adicionar refeição' }).click();
  await nutri.getByLabel('Refeição', { exact: true }).last().fill('Café da manhã');
  await nutri.getByLabel('Horário de Café da manhã').fill('07:30');
  await nutri.getByLabel('Adicionar alimento em Café da manhã').fill('pao trigo frances');
  await nutri.getByRole('option', { name: /^Pão, trigo, francês/ }).click();
  await expect(nutri.getByText('1 unidade · 50 g · 150 kcal')).toBeVisible(); // seed IBGE: pão francês, unidade = 50 g
  const totalComPao = await nutri.getByText(/^Total do dia: \d+ kcal/).textContent();
  expect(totalComPao).not.toBe(totalAntes);

  await nutri.getByRole('button', { name: 'Adicionar substituição para Pão, trigo, francês' }).click();
  await nutri.getByLabel('Substituição para Pão, trigo, francês').fill('tapioca com manteiga');
  await nutri.getByRole('option', { name: /Tapioca, com manteiga/ }).click();
  await nutri.getByLabel('Gramas de Tapioca, com manteiga').fill('40');
  await expect(nutri.getByText('139 kcal (−11 kcal)')).toBeVisible(); // 348 × 0,4 = 139; 139 − 150
  await expect(nutri.getByText(/^Total do dia: \d+ kcal/)).toHaveText(totalComPao!); // a substituição não soma (RN-02)
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 5000 });
});

test('substituições: o principal anda com as suas substituições, que só se reordenam entre si (US-023)', async () => {
  await nutri.goto(editor);
  const cafe = nutri.getByRole('region', { name: 'Café da manhã' });
  const linhas = cafe.getByRole('list').first().getByRole('listitem');
  await expect(linhas).toHaveCount(2); // pão e a tapioca do teste anterior

  // segundo principal (alimento próprio) no fim da refeição; segunda substituição do pão
  await cafe.getByLabel('Adicionar alimento em Café da manhã').fill(ALIMENTO_130);
  await nutri.getByRole('option', { name: new RegExp(ALIMENTO_130) }).click();
  await cafe.getByRole('button', { name: 'Adicionar substituição para Pão, trigo, francês' }).click();
  await nutri.getByLabel('Substituição para Pão, trigo, francês').fill('cuscuz de milho');
  await nutri.getByRole('option', { name: /^Cuscuz, de milho, cozido/ }).first().click();
  await expect(linhas).toHaveCount(4);
  await expect(linhas.nth(0)).toContainText('Pão, trigo, francês');
  await expect(linhas.nth(1)).toContainText('Tapioca, com manteiga');
  await expect(linhas.nth(2)).toContainText('Cuscuz, de milho, cozido'); // entra logo depois das substituições que o pão já tinha
  await expect(linhas.nth(3)).toContainText(ALIMENTO_130);

  // subir o segundo principal troca com o bloco inteiro do pão (pão + 2 substituições)
  await cafe.getByRole('button', { name: `Subir ${ALIMENTO_130}` }).click();
  await expect(linhas.nth(0)).toContainText(ALIMENTO_130);
  await expect(linhas.nth(1)).toContainText('Pão, trigo, francês');
  await expect(linhas.nth(2)).toContainText('Tapioca, com manteiga');
  await expect(linhas.nth(3)).toContainText('Cuscuz, de milho, cozido');

  // a substituição só troca com outra substituição do mesmo principal; na ponta do grupo não faz nada
  await cafe.getByRole('button', { name: 'Subir Tapioca, com manteiga' }).click();
  await expect(linhas.nth(2)).toContainText('Tapioca, com manteiga');
  await cafe.getByRole('button', { name: 'Descer Tapioca, com manteiga' }).click();
  await expect(linhas.nth(2)).toContainText('Cuscuz, de milho, cozido');
  await expect(linhas.nth(3)).toContainText('Tapioca, com manteiga');
  await cafe.getByRole('button', { name: 'Descer Tapioca, com manteiga' }).click(); // última do grupo
  await expect(linhas.nth(3)).toContainText('Tapioca, com manteiga');
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 5000 });

  // a ordem foi salva e o principal continua à frente das suas substituições
  await nutri.reload();
  const depois = nutri.getByRole('region', { name: 'Café da manhã' }).getByRole('list').first().getByRole('listitem');
  await expect(depois.nth(0)).toContainText(ALIMENTO_130);
  await expect(depois.nth(1)).toContainText('Pão, trigo, francês');
  await expect(depois.nth(2)).toContainText('Cuscuz, de milho, cozido');
  await expect(depois.nth(3)).toContainText('Tapioca, com manteiga');
});

test('editor: sair por um link interno logo depois de editar não perde a edição; com o salvamento falhando, pede confirmação (US-022)', async () => {
  await nutri.goto(editor);
  const gramasAlmoco = nutri.getByRole('region', { name: 'Almoço' }).getByLabel(`Gramas de ${ALIMENTO_130}`);
  const voltar = nutri.getByRole('link', { name: 'Voltar às versões' });
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible();
  const antes = await gramasAlmoco.inputValue();

  // clique "na hora", antes dos 800 ms do salvamento automático: a edição vai ao servidor quando a página desmonta
  const put = nutri.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/painel/planos/'), { timeout: 10_000 });
  await gramasAlmoco.fill('135');
  await voltar.click();
  await expect(nutri).toHaveURL(`${prontuario}/plano-alimentar`);
  expect((await put).status()).toBe(200);
  await nutri.goto(editor);
  await expect(gramasAlmoco).toHaveValue('135');

  // sem rede a edição não salva: o link interno pede confirmação, e cancelar mantém a nutricionista no editor
  await nutri.context().setOffline(true);
  await gramasAlmoco.fill(antes);
  await expect(nutri.getByRole('status').filter({ hasText: 'Alterações não salvas' })).toBeVisible({ timeout: 5000 });
  let aviso = '';
  nutri.once('dialog', (d) => {
    aviso = d.message();
    void d.dismiss();
  });
  await voltar.click();
  await expect.poll(() => aviso).toBe('Há alterações que ainda não foram salvas. Sair mesmo assim?');
  await expect(nutri.getByRole('status').filter({ hasText: 'Alterações não salvas' })).toBeVisible();
  await nutri.context().setOffline(false);
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 10000 }); // continuou no editor e salvou
  await expect(nutri).toHaveURL(editor);
  await nutri.reload();
  await expect(gramasAlmoco).toHaveValue(antes);
});

test('salvar como modelo e abrir o modelo (US-024)', async () => {
  await nutri.goto(editor);
  await nutri.getByLabel('Nome do modelo').fill(`Modelo ${sufixo}`);
  await nutri.getByRole('button', { name: 'Salvar como modelo' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Modelo salvo.' })).toBeVisible();
  await nutri.goto('/painel/planos/modelos');
  await nutri.getByRole('link', { name: `Modelo ${sufixo}` }).click();
  await expect(nutri.getByRole('heading', { name: `Modelo: Modelo ${sufixo}` })).toBeVisible();
  await expect(nutri.getByLabel('Refeição', { exact: true }).first()).toHaveValue('Almoço');
  await expect(nutri.getByText('Mostrar calorias ao paciente')).toHaveCount(0); // modelo não tem paciente
});

test('criar a partir de modelo: rascunho do paciente com as refeições do modelo; excluir o modelo não muda o plano (US-024)', async () => {
  // Paciente próprio: o rascunho compartilhado das próximas tarefas não pode ser tocado
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(`Paciente Modelo ${sufixo}`);
  await nutri.getByLabel('Data de nascimento').fill('1991-03-10');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(`modelo-${sufixo}@nutridebby.test`);
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.getByRole('heading', { level: 1, name: `Paciente Modelo ${sufixo}` })).toBeVisible();
  const pront = new URL(nutri.url()).pathname;

  await nutri.goto(`${pront}/plano-alimentar`);
  await nutri.getByLabel('Modelo', { exact: true }).selectOption({ label: `Modelo ${sufixo}` });
  await nutri.getByRole('button', { name: 'Criar a partir de modelo' }).click();
  await expect(nutri.getByRole('heading', { name: 'Plano alimentar — versão 1' })).toBeVisible();
  const planoUrl = new URL(nutri.url()).pathname;
  await expect(nutri.getByLabel('Título')).toHaveValue('Modelo ' + sufixo);
  await expect(nutri.getByLabel('Meta (kcal)')).toHaveValue('500');
  await expect(nutri.getByLabel('Refeição', { exact: true }).first()).toHaveValue('Almoço');
  await expect(nutri.getByLabel('Mostrar calorias ao paciente')).toBeVisible(); // plano de paciente tem os controles de paciente

  // com rascunho, só "Continuar o rascunho": não há como criar outro a partir de modelo
  await nutri.goto(`${pront}/plano-alimentar`);
  await expect(nutri.getByRole('link', { name: 'Continuar o rascunho (versão 1)' })).toBeVisible();
  await expect(nutri.getByRole('button', { name: 'Criar a partir de modelo' })).toHaveCount(0);

  // excluir o modelo (com confirmação) não altera o plano criado a partir dele
  await nutri.goto('/painel/planos/modelos');
  await nutri.getByRole('link', { name: `Modelo ${sufixo}` }).click();
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Excluir modelo' }).click();
  await expect(nutri).toHaveURL(/\/painel\/planos\/modelos$/);
  await expect(nutri.getByRole('link', { name: `Modelo ${sufixo}` })).toHaveCount(0);
  await nutri.goto(planoUrl);
  await expect(nutri.getByLabel('Refeição', { exact: true }).first()).toHaveValue('Almoço');
});

test('paciente bloqueado com o editor aberto: salvar e descartar mostram o motivo; o plano abre só para consulta (US-018, US-022)', async () => {
  const nome = `Paciente Bloqueio ${sufixo}`;
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(nome);
  await nutri.getByLabel('Data de nascimento').fill('1991-03-10');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(`bloqueio-${sufixo}@nutridebby.test`);
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri.getByRole('heading', { level: 1, name: nome })).toBeVisible();
  const pront = new URL(nutri.url()).pathname;
  await nutri.goto(`${pront}/plano-alimentar`);
  await nutri.getByRole('button', { name: 'Criar plano' }).click();
  await expect(nutri.getByRole('heading', { name: 'Plano alimentar — versão 1' })).toBeVisible();
  const planoUrl = new URL(nutri.url()).pathname;

  // outra aba atende o pedido de exclusão (US-018) enquanto o editor continua aberto
  const outra = await nutri.context().newPage();
  await outra.goto(`${pront}/privacidade`);
  await outra.getByLabel('Digite o nome do paciente para confirmar').fill(nome);
  await outra.getByRole('button', { name: 'Atender pedido de exclusão' }).click();
  await expect(outra.getByText(/^Pedido atendido em/)).toBeVisible();
  await outra.close();

  await nutri.getByLabel('Título').fill('Plano depois do bloqueio');
  await expect(nutri.getByRole('status').filter({ hasText: BLOQUEADO })).toBeVisible({ timeout: 5000 }); // não "alterado em outra aba"
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Descartar rascunho' }).click();
  await expect(nutri.getByRole('alert').filter({ hasText: BLOQUEADO })).toBeVisible();
  await expect(nutri).toHaveURL(planoUrl);

  // aberto de novo: só consulta, sem ações de escrita
  await nutri.goto(planoUrl);
  await expect(nutri.getByText(BLOQUEADO)).toBeVisible();
  await expect(nutri.getByText('Versão 1 · Rascunho')).toBeVisible();
  await expect(nutri.getByLabel('Título')).toBeDisabled();
  await expect(nutri.getByLabel('Título')).toHaveValue('Plano alimentar'); // o rascunho não foi alterado nem descartado
  for (const botao of ['Publicar', 'Descartar rascunho', 'Salvar como modelo', 'Adicionar refeição'])
    await expect(nutri.getByRole('button', { name: botao })).toHaveCount(0);
  await nutri.goto(`${pront}/plano-alimentar`);
  await expect(nutri.getByRole('link', { name: 'Versão 1' })).toBeVisible();
  await expect(nutri.getByRole('link', { name: /^Continuar o rascunho/ })).toHaveCount(0);
  await expect(nutri.getByRole('button', { name: 'Criar plano' })).toHaveCount(0);
});

test('publicar v1, editar cria v2 com a v1 ainda publicada, publicar v2 arquiva a v1 (US-025, RN-01)', async () => {
  await nutri.goto(editor);
  const publicar = nutri.getByRole('button', { name: 'Publicar' });
  const gramasAlmoco = nutri.getByRole('region', { name: 'Almoço' }).getByLabel(`Gramas de ${ALIMENTO_130}`); // o alimento também está no café da manhã
  await expect(publicar).toBeEnabled();

  // Só se publica (ou se salva como modelo) o que está salvo: sem rede, os dois botões ficam desabilitados até o salvamento voltar
  const salvarModelo = nutri.getByRole('button', { name: 'Salvar como modelo' });
  await nutri.context().setOffline(true);
  await gramasAlmoco.fill('120');
  await expect(nutri.getByRole('status').filter({ hasText: 'Alterações não salvas' })).toBeVisible({ timeout: 5000 });
  await expect(publicar).toBeDisabled();
  await expect(salvarModelo).toBeDisabled();
  await nutri.context().setOffline(false);
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 10000 });
  await expect(publicar).toBeEnabled();
  await expect(salvarModelo).toBeEnabled();

  nutri.once('dialog', (d) => void d.accept());
  await publicar.click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Plano publicado.' })).toBeVisible();
  await expect(nutri.getByText('Versão 1 · Publicado')).toBeVisible();
  await expect(gramasAlmoco).toBeDisabled();
  await expect(gramasAlmoco).toHaveValue('120'); // o que estava salvo é o que foi publicado

  await nutri.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(nutri.getByRole('heading', { name: 'Plano alimentar — versão 2' })).toBeVisible();
  await nutri.goto(`${prontuario}/plano-alimentar`);
  await expect(nutri.getByRole('row', { name: /Versão 1/ })).toContainText('Publicado');
  await expect(nutri.getByRole('row', { name: /Versão 2/ })).toContainText('Rascunho');
  await expect(nutri.getByRole('button', { name: 'Editar o plano publicado' })).toHaveCount(0); // já há rascunho

  await nutri.getByRole('link', { name: 'Continuar o rascunho (versão 2)' }).click();
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Plano publicado.' })).toBeVisible();
  // US-026: o "Baixar PDF" é liberado na mesma tela (o painel consulta só o estado do PDF, sem recarregar a cada 3 s)
  await expect(nutri.getByRole('link', { name: 'Baixar PDF' })).toBeVisible({ timeout: 30_000 });
  await nutri.goto(`${prontuario}/plano-alimentar`);
  await expect(nutri.getByRole('row', { name: /Versão 1/ })).toContainText('Arquivado');
  await expect(nutri.getByRole('row', { name: /Versão 2/ })).toContainText('Publicado');
  await expect(nutri.getByRole('button', { name: 'Editar o plano publicado' })).toBeVisible();
  await expect(nutri.getByRole('button', { name: 'Criar plano' })).toHaveCount(0);
  editor = (await nutri.getByRole('link', { name: 'Versão 2' }).getAttribute('href'))!; // a v2 publicada (a Tarefa 11 usa)
});

test('PDF gerado pelo worker na publicação e baixado pelo painel (US-026)', async () => {
  await nutri.goto(editor); // v2 publicada na Tarefa 10
  await expect(nutri.getByRole('link', { name: 'Baixar PDF' })).toBeVisible({ timeout: 30_000 }); // ≤ 30 s
  const href = await nutri.getByRole('link', { name: 'Baixar PDF' }).getAttribute('href');
  const r = await nutri.request.get(href!);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toBe('application/pdf');
  expect((await r.body()).subarray(0, 5).toString()).toBe('%PDF-');
});
