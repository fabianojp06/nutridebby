import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fichaPelaBusca, SEMENTE_COMPLETA, SEMENTE_INCOMPLETA } from './cadastro';
import { entrarComo } from './helpers';
import { criarPacientePeloFormulario } from './pacientes-form';
import { escolherTema } from './painel';

// Plano 18 (US-260, US-261, US-262, US-264, RNF-261): o cadastro em seções (CPF, estado civil, CEP; CPF repetido com o link
// em nova aba), o Perfil (o estado civil e a Observação não voltam atrás; o foco no primeiro campo com erro), a lista (abas,
// ordem, menu da linha, arquivar com a região de status), o Início (nota "Cadastro incompleto", selo e cartão "No app"), a
// página "No app do paciente", a impressão com o nome civil primeiro e o axe dos estados abertos, claro e escuro.
// Bloco de IP deste spec (o limite de login é por IP; bloco do Plano 18, depois do ficha.spec): 10.9.18.20 a 10.9.18.29 —
// nutricionista .20.
// Repetível no banco de dev reaproveitado: o CPF novo é gerado a cada execução (a linha de patient_cadastro nunca sai do
// banco), os pacientes levam o sufixo da execução e as pacientes da semente nunca são alteradas aqui.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const UUID = '[0-9a-f-]{36}';
const CPF_REPETIDO = 'Já existe um paciente com este CPF neste consultório.';
const ABRIR_EXISTENTE = 'Abrir o cadastro existente (abre em nova aba)';
const REVISE = 'Revise os campos marcados.';
test.describe.configure({ mode: 'serial' });

// a busca da lista é pelo sufixo: o prefixo "c18" o separa do `Date.now().toString(36)` das outras specs em paralelo
const sufixo = `c18${Date.now().toString(36)}`;
const BIA = { nome: `Bia Cadastro ${sufixo}`, email: `bia-cadastro-${sufixo}@nutridebby.test` };
const ALICE = { nome: `Alice Lista ${sufixo}`, email: `alice-lista-${sufixo}@nutridebby.test` };
const ZECA = { nome: `Zeca Lista ${sufixo}`, email: `zeca-lista-${sufixo}@nutridebby.test` };
let nutri: Page;
let completa: string;
let incompleta: string;
let bia: string;

/** Um dígito verificador do CPF (módulo 11). */
function digito(base: string): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
/** CPF válido e novo a cada execução: prefixo aleatório (nunca 9 dígitos iguais) e os dois verificadores. */
function cpfNovo(): { digitos: string; formatado: string } {
  let base = '';
  do base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');
  while (/^(\d)\1{8}$/.test(base));
  const d1 = digito(base);
  const digitos = `${base}${d1}${digito(`${base}${d1}`)}`;
  return { digitos, formatado: digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') };
}
const CPF = cpfNovo();

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.18.20', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
  completa = await fichaPelaBusca(nutri, SEMENTE_COMPLETA.email, SEMENTE_COMPLETA.nomeSocial);
  incompleta = await fichaPelaBusca(nutri, SEMENTE_INCOMPLETA.email, SEMENTE_INCOMPLETA.nome);
});

test.afterAll(async () => {
  if (nutri) await escolherTema(nutri, 'Igual ao aparelho'); // o seed e as outras specs esperam o padrão
  await nutri?.context().close();
});

async function violacoes(page: Page, incluir?: string): Promise<string[]> {
  const axe = new AxeBuilder({ page }).withTags(TAGS);
  const r = await (incluir ? axe.include(incluir) : axe).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  const contrasteIncerto = r.incomplete.filter((i) => i.id === 'color-contrast').flatMap((i) => i.nodes.map((n) => `incompleto color-contrast: ${n.target.join(' ')}`));
  return [...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), ...contrasteIncerto];
}

/** Os campos obrigatórios de "Novo paciente", com os rótulos do cadastro em seções. */
async function preencherObrigatorios(dados: { nome: string; email: string }) {
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome completo', { exact: true }).fill(dados.nome);
  await nutri.getByLabel('Data de nascimento').fill('1988-04-12');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(dados.email);
}

test('cadastro com CPF, estado civil e CEP (US-260): o Perfil mostra o que foi gravado; a lista não mostra o CPF', async () => {
  await preencherObrigatorios(BIA);
  await nutri.getByLabel('CPF (opcional)').fill(CPF.formatado);
  await nutri.getByLabel('Estado civil (opcional)').selectOption({ label: 'Casado(a)' });
  await nutri.getByLabel('CEP', { exact: true }).fill('13015-904');
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri).toHaveURL(new RegExp(`/painel/pacientes/${UUID}$`));
  bia = new URL(nutri.url()).pathname;

  await nutri.goto(`${bia}/perfil`);
  await expect(nutri.getByLabel('CPF (opcional)')).toHaveValue(CPF.formatado);
  await expect(nutri.getByLabel('Estado civil (opcional)')).toHaveValue('casado');
  await expect(nutri.getByLabel('CEP', { exact: true })).toHaveValue('13015-904');

  // D4, RN-262: o CPF só no campo do Perfil — nem na lista, nem no Início
  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(sufixo)}`);
  await expect(nutri.getByRole('table').getByRole('link', { name: BIA.nome, exact: true })).toBeVisible();
  for (const texto of [CPF.digitos, CPF.formatado]) await expect(nutri.locator('main')).not.toContainText(texto);
  await nutri.goto(bia);
  for (const texto of [CPF.digitos, CPF.formatado]) await expect(nutri.locator('body')).not.toContainText(texto);
});

for (const tema of ['Claro', 'Escuro'] as const) {
  test(`CPF repetido (o da paciente da semente): a mensagem, o link em nova aba e o digitado continua; axe, tema ${tema}`, async () => {
    await escolherTema(nutri, tema);
    const rui = { nome: `Rui Repetido ${sufixo}`, email: `rui-repetido-${sufixo}-${tema.toLowerCase()}@nutridebby.test` };
    await preencherObrigatorios(rui);
    await nutri.getByLabel('CPF (opcional)').fill(SEMENTE_COMPLETA.cpf);
    await nutri.getByLabel('Estado civil (opcional)').selectOption({ label: 'Solteiro(a)' });
    await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();

    await expect(nutri.getByText(CPF_REPETIDO)).toBeVisible();
    await expect(nutri.getByLabel('CPF (opcional)')).toHaveAccessibleDescription(new RegExp(CPF_REPETIDO.replace(/\./g, '\\.')));
    await expect(nutri.getByText(REVISE)).toBeVisible();
    // o que foi digitado continua no formulário
    await expect(nutri.getByLabel('Nome completo', { exact: true })).toHaveValue(rui.nome);
    await expect(nutri.getByLabel('CPF (opcional)')).toHaveValue(SEMENTE_COMPLETA.cpf);
    await expect(nutri.getByLabel('Estado civil (opcional)')).toHaveValue('solteiro');
    const link = nutri.getByRole('link', { name: ABRIR_EXISTENTE });
    await expect(link).toHaveAttribute('href', `${completa}/perfil`);
    await expect(link).toHaveAttribute('target', '_blank');

    expect(await violacoes(nutri)).toEqual([]);

    if (tema === 'Claro') {
      const [aba] = await Promise.all([nutri.context().waitForEvent('page'), link.click()]);
      await expect(aba).toHaveURL(new RegExp(`${completa}/perfil$`));
      await expect(aba.getByLabel('Nome completo', { exact: true })).toHaveValue(SEMENTE_COMPLETA.nome);
      await aba.close();
      await expect(nutri.getByLabel('Nome completo', { exact: true })).toHaveValue(rui.nome); // a aba de origem não mudou
    }
    // nada foi gravado
    await nutri.goto(`/painel/pacientes?aba=todos&busca=${encodeURIComponent(rui.email)}`);
    await expect(nutri.getByText('Nenhum paciente encontrado.')).toBeVisible();
  });
}

test('Perfil: o estado civil salvo continua depois de salvar outro campo; a Observação digitada sobrevive a "Salvar etiquetas"; o CEP inválido recebe o foco', async () => {
  await escolherTema(nutri, 'Igual ao aparelho');
  await nutri.goto(`${bia}/perfil`);
  const salvar = nutri.getByRole('button', { name: 'Salvar cadastro' });
  const estadoCivil = nutri.getByLabel('Estado civil (opcional)');
  const resposta = () => nutri.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === `${bia}/perfil`);

  await estadoCivil.selectOption({ label: 'Divorciado(a)' });
  let volta = resposta();
  await salvar.click();
  await volta;
  await expect(nutri.getByText('Cadastro salvo.')).toBeVisible();
  await expect(estadoCivil).toHaveValue('divorciado');
  // sem recarregar: o próximo Salvar não regrava o estado civil da montagem (key do <select>)
  await nutri.getByLabel('Ocupação (opcional)').fill('Engenheira');
  volta = resposta();
  await salvar.click();
  await volta;
  await expect(estadoCivil).toHaveValue('divorciado');
  await nutri.reload();
  await expect(estadoCivil).toHaveValue('divorciado');
  await expect(nutri.getByLabel('Ocupação (opcional)')).toHaveValue('Engenheira');

  // a Observação só volta ao salvo pela resposta do próprio formulário, nunca pela revalidação das etiquetas
  const observacao = nutri.getByLabel('Observação (opcional)', { exact: true });
  await observacao.fill('Texto ainda não salvo');
  volta = resposta();
  await nutri.getByRole('button', { name: 'Salvar etiquetas' }).click();
  await volta;
  await expect(nutri.getByText('Etiquetas salvas.')).toBeVisible();
  await expect(observacao).toHaveValue('Texto ainda não salvo');

  // erro longe do botão: o foco vai ao campo marcado, e o aviso fica junto do botão
  const cep = nutri.getByLabel('CEP', { exact: true });
  await cep.fill('123');
  await salvar.click();
  await expect(nutri.getByText('CEP inválido. Use os 8 números.')).toBeVisible();
  await expect(cep).toBeFocused();
  await expect(nutri.getByText(REVISE)).toBeVisible();
  await expect(cep).toHaveValue('123');
  await expect(observacao).toHaveValue('Texto ainda não salvo');
});

test('lista: abas, "Mais recentes" mantém a busca, link antigo ?status=arquivado abre Inativos (US-261)', async () => {
  // criados depois da Bia: em "Nome (A–Z)", Alice, Bia, Zeca; em "Mais recentes", Zeca, Alice, Bia
  await criarPacientePeloFormulario(nutri, ALICE);
  await criarPacientePeloFormulario(nutri, ZECA);
  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(sufixo)}`);
  const abas = nutri.getByRole('navigation', { name: 'Situação dos pacientes' });
  const nomes = nutri.locator('tbody tr td:first-child a');
  await expect(abas.getByRole('link', { name: 'Ativos', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nutri.getByRole('link', { name: 'Ver bloqueados' })).toBeVisible();
  await expect(nutri.getByRole('columnheader')).toHaveText(['Nome', 'Idade', 'E-mail', 'Acesso ao app', 'Desde', 'Ações']);
  await expect(nomes).toHaveText([ALICE.nome, BIA.nome, ZECA.nome]);

  await nutri.getByLabel('Ordenar por').selectOption({ label: 'Mais recentes' });
  await nutri.getByRole('button', { name: 'Filtrar' }).click();
  await expect(nutri).toHaveURL(/[?&]ordem=recentes(&|$)/);
  expect(new URL(nutri.url()).searchParams.get('busca')).toBe(sufixo);
  expect(new URL(nutri.url()).searchParams.get('aba')).toBe('ativos');
  await expect(nomes).toHaveText([ZECA.nome, ALICE.nome, BIA.nome]);
  await expect(nutri.getByLabel('Buscar por nome ou e-mail')).toHaveValue(sufixo);

  await abas.getByRole('link', { name: 'Inativos', exact: true }).click();
  await expect(abas.getByRole('link', { name: 'Inativos', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(new URL(nutri.url()).searchParams.get('busca')).toBe(sufixo);
  expect(new URL(nutri.url()).searchParams.get('ordem')).toBe('recentes');
  await expect(nutri.getByText('Pacientes arquivados: sem acesso ao app e sem notificações. O prontuário continua guardado.')).toBeVisible();
  await expect(nutri.getByText('Nenhum paciente encontrado.')).toBeVisible();
  await abas.getByRole('link', { name: 'Todos', exact: true }).click();
  await expect(abas.getByRole('link', { name: 'Todos', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nomes).toHaveText([ZECA.nome, ALICE.nome, BIA.nome]);

  await nutri.goto('/painel/pacientes?status=arquivado');
  await expect(abas.getByRole('link', { name: 'Inativos', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('menu da linha (RN-273): abre, Esc fecha e devolve o foco, clique fora fecha, Tab depois do último item segue para a linha seguinte', async () => {
  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(sufixo)}`); // Nome (A–Z): Alice, Bia, Zeca
  const botao = nutri.getByRole('button', { name: `Ações de ${ALICE.nome}`, exact: true });
  const painel = nutri.locator(`[id="${await botao.getAttribute('aria-controls')}"]`);

  await botao.click();
  await expect(botao).toHaveAttribute('aria-expanded', 'true');
  await expect(painel.getByRole('link')).toHaveText(['Abrir ficha', 'Editar cadastro', 'Pedir exclusão (LGPD)']);
  await expect(painel.getByRole('button', { name: 'Arquivar' })).toBeVisible();
  await expect(painel.getByRole('link', { name: 'Pedir exclusão (LGPD)' })).toHaveAttribute('href', /\/privacidade#exclusao$/);
  await nutri.keyboard.press('Escape');
  await expect(botao).toHaveAttribute('aria-expanded', 'false');
  await expect(painel).toBeHidden();
  await expect(botao).toBeFocused();

  // clique fora, num lugar sem foco (o cabeçalho da tabela): fecha e o foco volta ao botão
  await botao.click();
  await expect(painel).toBeVisible();
  await nutri.getByRole('columnheader', { name: 'Idade' }).click();
  await expect(botao).toHaveAttribute('aria-expanded', 'false');
  await expect(botao).toBeFocused();

  // clique fora num controle: fecha e o foco fica nele; Esc depois não puxa o foco de volta ao botão
  await botao.click();
  await expect(painel).toBeVisible();
  const busca = nutri.getByLabel('Buscar por nome ou e-mail');
  await busca.click();
  await expect(painel).toBeHidden();
  await expect(busca).toBeFocused();
  await nutri.keyboard.press('Escape');
  await expect(busca).toBeFocused();
  await expect(botao).not.toBeFocused();

  // teclado: Enter abre; Tab percorre os itens; Tab depois do último fecha o menu e o foco segue para a linha seguinte
  await botao.focus();
  await nutri.keyboard.press('Enter');
  await expect(botao).toHaveAttribute('aria-expanded', 'true');
  for (const item of ['Abrir ficha', 'Editar cadastro', 'Arquivar', 'Pedir exclusão (LGPD)']) {
    await nutri.keyboard.press('Tab');
    await expect(painel.getByRole(item === 'Arquivar' ? 'button' : 'link', { name: item })).toBeFocused();
  }
  await nutri.keyboard.press('Tab');
  await expect(botao).toHaveAttribute('aria-expanded', 'false');
  await expect(painel).toBeHidden();
  await expect(nutri.getByRole('table').getByRole('link', { name: BIA.nome, exact: true })).toBeFocused(); // o 1º foco da linha seguinte
  await nutri.keyboard.press('Tab');
  const proximo = nutri.getByRole('button', { name: `Ações de ${BIA.nome}`, exact: true });
  await expect(proximo).toBeFocused();
  await expect(proximo).toHaveAttribute('aria-expanded', 'false');
  await expect(proximo).toBeInViewport();
  // visível: nenhum painel por cima do botão focado
  expect(
    await proximo.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return topo === b || b.contains(topo);
    }),
  ).toBe(true);
  await expect(botao).not.toBeFocused();
});

test('arquivar pela lista duas vezes seguidas (D26): confirmação, "Paciente arquivado." a cada ação e o foco no título', async () => {
  await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(sufixo)}`);
  const regiao = nutri.locator('main').getByRole('status');
  const titulo = nutri.getByRole('heading', { level: 1, name: 'Pacientes' });
  const mensagens: string[] = [];
  const confirmar = () => nutri.once('dialog', (d) => {
    mensagens.push(d.message());
    void d.accept();
  });

  confirmar();
  await nutri.getByRole('button', { name: `Ações de ${ALICE.nome}`, exact: true }).click();
  await nutri.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect(nutri).toHaveURL(/[?&]ok=arquivado&r=[0-9a-f]{8}$/);
  expect(mensagens).toEqual([
    `Arquivar ${ALICE.nome}? O paciente perde o acesso ao app e deixa de receber notificações. Convites ainda não aceitos são cancelados. O prontuário continua guardado e você pode reativar quando quiser.`,
  ]);
  await expect(regiao).toHaveText('Paciente arquivado.');
  await expect(titulo).toBeFocused();
  await expect(nutri.getByRole('table').getByRole('link', { name: ALICE.nome, exact: true })).toHaveCount(0);
  const primeiro = new URL(nutri.url()).searchParams.get('r');

  // a segunda ação traz o mesmo texto: a região esvazia antes e volta a dizer "Paciente arquivado." (o leitor de tela anuncia de novo)
  await regiao.evaluate((p) => {
    const vistos: string[] = [];
    (window as unknown as { textosDaRegiao: string[] }).textosDaRegiao = vistos;
    new MutationObserver(() => vistos.push(p.textContent ?? '')).observe(p, { childList: true, characterData: true, subtree: true });
  });
  confirmar();
  await nutri.getByRole('button', { name: `Ações de ${ZECA.nome}`, exact: true }).click();
  await nutri.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await expect.poll(() => new URL(nutri.url()).searchParams.get('r')).not.toBe(primeiro);
  await expect(regiao).toHaveText('Paciente arquivado.');
  await expect(titulo).toBeFocused();
  expect(mensagens).toHaveLength(2);
  const vistos = await nutri.evaluate(() => (window as unknown as { textosDaRegiao: string[] }).textosDaRegiao);
  expect(vistos.indexOf(''), `textos da região: ${JSON.stringify(vistos)}`).toBeGreaterThanOrEqual(0);
  expect(vistos.lastIndexOf('Paciente arquivado.')).toBeGreaterThan(vistos.indexOf(''));

  // na aba Inativos, os dois, sem acesso
  await nutri.getByRole('navigation', { name: 'Situação dos pacientes' }).getByRole('link', { name: 'Inativos', exact: true }).click();
  for (const p of [ALICE, ZECA]) {
    await expect(nutri.getByRole('row').filter({ has: nutri.getByRole('link', { name: p.nome, exact: true }) })).toContainText('Sem acesso (arquivado)');
  }
});

test('Início: a nota "Cadastro incompleto" com "Completar no Perfil"; o selo "No app" e o cartão "No app do paciente" (US-262, US-264)', async () => {
  await nutri.goto(incompleta);
  await expect(nutri.getByText('Cadastro incompleto: faltam estado civil e endereço.')).toBeVisible();
  await expect(nutri.getByRole('link', { name: 'Completar no Perfil' })).toHaveAttribute('href', `${incompleta}/perfil`);

  await nutri.goto(completa);
  // o h1 tem os dois nomes, um para a tela e outro para o papel (print:hidden / hidden print:inline): o texto visível
  await expect(nutri.getByRole('heading', { level: 1 })).toHaveText(SEMENTE_COMPLETA.nomeSocial, { useInnerText: true });
  await expect(nutri.getByText(`Nome de registro: ${SEMENTE_COMPLETA.nome}`)).toBeVisible();
  await expect(nutri.getByText(/^Cadastro incompleto/)).toHaveCount(0);
  const secoes = nutri.locator('[data-guia="secoes-inicio"]');
  const avaliacao = secoes.getByRole('listitem').filter({ has: nutri.getByRole('link', { name: 'Avaliação · 12/10/2026' }) });
  await expect(avaliacao).toContainText('No app');
  const cartao = nutri.getByRole('region', { name: 'No app do paciente' });
  await expect(cartao).toContainText('Acesso: ativo · nenhum acesso ainda');
  await expect(cartao).toContainText('Nenhum plano publicado.');
  await expect(cartao).toContainText(/0 documentos · \d+ conteúdos?/);
  await cartao.getByRole('link', { name: 'Ver detalhes' }).click();
  await expect(nutri).toHaveURL(new RegExp(`${completa}/app$`));
});

test('"No app do paciente": as contagens da paciente da semente, contadas como o app (US-264, §8.5)', async () => {
  await nutri.goto(`${completa}/app`);
  await expect(nutri.getByRole('heading', { name: 'No app do paciente' })).toBeVisible();
  await expect(nutri.getByText(`O que ${SEMENTE_COMPLETA.nomeSocial} vê hoje no app do consultório. As contagens seguem as mesmas regras do app.`)).toBeVisible();
  const linha = (rotulo: string) => nutri.locator('dl > div').filter({ has: nutri.locator('dt', { hasText: new RegExp(`^${rotulo}$`) }) }).locator('dd');
  await expect(linha('Acesso')).toHaveText('Ativo: o paciente já criou a senha. · Último acesso: nenhum ainda.');
  await expect(linha('Notificações')).toHaveText('Notificações: desligadas em todos os aparelhos. · WhatsApp não autorizado');
  await expect(linha('Plano')).toHaveText('Nenhum plano publicado.');
  // o % de gordura segue a configuração do consultório (outras specs ligam e desligam): só a forma
  await expect(linha('Evolução')).toHaveText(/^1 avaliação · Peso e IMC: aparecem no app · % de gordura: (aparece|não aparece) no app$/);
  await expect(linha('Jornada')).toHaveText('0 atendimentos');
  await expect(linha('Documentos')).toHaveText('0 documentos');
  await expect(linha('Conteúdos')).toHaveText(/^\d+ conteúdos? na biblioteca$/);
  await expect(linha('Exames')).toHaveText('0 envios de exame');
  await expect(linha('Diário')).toHaveText('0 registros nos últimos 30 dias');
  await expect(linha('IA Nutri')).toHaveText('Desligada');
  // nenhum dado do cadastro na página (D20)
  for (const texto of [SEMENTE_COMPLETA.cpf, '13015-904', 'Rua da Semente']) await expect(nutri.locator('body')).not.toContainText(texto);
});

test('impressão da ficha com nome social: o nome civil primeiro e "Nome social: …" logo depois; sem a linha de medidas (RN-266, RN-275)', async () => {
  await nutri.goto(completa);
  await nutri.emulateMedia({ media: 'print' });
  try {
    const cabecalho = nutri.locator('[data-guia="cabecalho-paciente"]');
    await expect(cabecalho.getByRole('heading', { level: 1 })).toHaveText(SEMENTE_COMPLETA.nome, { useInnerText: true });
    await expect(cabecalho.getByText(`Nome social: ${SEMENTE_COMPLETA.nomeSocial}`)).toBeVisible();
    await expect(cabecalho.getByText(`Nome de registro: ${SEMENTE_COMPLETA.nome}`)).toBeHidden();
    await expect(cabecalho.getByText(/^Última avaliação em /)).toBeHidden();
    const texto = await cabecalho.innerText();
    expect(texto.indexOf(SEMENTE_COMPLETA.nome), texto).toBeGreaterThanOrEqual(0);
    expect(texto.indexOf(`Nome social: ${SEMENTE_COMPLETA.nomeSocial}`)).toBeGreaterThan(texto.indexOf(SEMENTE_COMPLETA.nome));
  } finally {
    await nutri.emulateMedia({ media: 'screen' });
  }
});

test('Privacidade com nome social: o pedido de exclusão pede o nome de registro, mostrado na instrução (RN-266)', async () => {
  await nutri.goto(`${completa}/privacidade`);
  await expect(nutri.getByRole('heading', { name: 'Pedido de exclusão (LGPD, art. 18)' })).toBeVisible();
  // a instrução é o rótulo do campo de confirmação; nada é enviado (a paciente da semente nunca é alterada aqui)
  const campo = nutri.getByLabel(`Digite o nome de registro do paciente (${SEMENTE_COMPLETA.nome}) exatamente como está no cadastro para confirmar.`, { exact: true });
  await expect(campo).toBeVisible();
  await expect(campo).toHaveAttribute('id', 'confirmacao');
  await expect(nutri.getByText('Digite o nome do paciente para confirmar', { exact: true })).toHaveCount(0);
});

for (const tema of ['Claro', 'Escuro'] as const) {
  test(`axe dos estados abertos (RNF-261): o menu da linha e o diálogo Adicionar, tema ${tema}`, async () => {
    await escolherTema(nutri, tema);
    await nutri.goto(`/painel/pacientes?busca=${encodeURIComponent(sufixo)}`);
    const botao = nutri.getByRole('button', { name: `Ações de ${BIA.nome}`, exact: true });
    await botao.click();
    await expect(botao).toHaveAttribute('aria-expanded', 'true');
    // só o painel aberto, como o menu da conta no acessibilidade-painel-base.spec: o texto coberto por ele cai em "incomplete"
    expect(await violacoes(nutri, `[id="${await botao.getAttribute('aria-controls')}"]`)).toEqual([]);
    await nutri.keyboard.press('Escape');

    await nutri.goto(completa);
    await nutri.getByRole('button', { name: 'Adicionar ao prontuário' }).click();
    const dialogo = nutri.getByRole('dialog', { name: 'Adicionar ao prontuário' });
    await expect(dialogo).toBeVisible();
    // como no ficha.spec: a página por baixo sai do cálculo (o diálogo é opaco), o contraste conferido é o do diálogo
    await nutri.evaluate(() => {
      for (const e of Array.from(document.body.children)) (e as HTMLElement).style.visibility = 'hidden';
      for (const d of Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))) d.style.visibility = 'visible';
    });
    expect(await violacoes(nutri, 'dialog[open]')).toEqual([]);
  });
}
