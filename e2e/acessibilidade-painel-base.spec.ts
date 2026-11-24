import { expect, test, type Page } from '@playwright/test';
import { axeEmTodasAsTelas, escolherTema, rotasDoPainel, violacoes } from './acessibilidade-painel';
import { vigiarCsp } from './csp';
import { entrarComo, ESPERA_DO_SERVIDOR } from './helpers';
import { prepararTelasComId } from './painel';

// RNF-10 (D25): o painel com zero violação WCAG 2.1 AA (+ alvo de toque da 2.2) nos três modos, em TODAS as telas
// (ROTAS_DO_PAINEL, conferida pela guarda rotas-axe.test.ts). SUS-125: o começo do antigo arquivo único — os laços de todas
// as telas nos três modos e os estados abertos —, que o outro worker roda ao mesmo tempo que o acessibilidade-painel.spec
// (do Plano 20 em diante; caso novo entra no fim dele). O que os dois dividem (o axe, o tema garantido em cada tela e os IPs
// de cada parte) está em e2e/acessibilidade-painel.ts. IPs desta parte: 10.9.13.87 (nutri), 10.9.13.88 (paciente do
// preparo), 10.9.29.52 (a segunda paciente da IA Nutri).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial', timeout: 360_000 }); // cada laço visita todas as telas do painel (mais de 60 desde o Plano 22, que acrescentou o catálogo, os exames e a prescrição)
let nutri: Page;
let rotas: string[] = [];
let errosCsp: string[] = []; // D7: a CSP vale direto porque o E2E abre todas as telas sem violação — a prova é este laço

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // o preparo cria uma linha de cada tela com id
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.87');
  await expect(nutri).toHaveURL(/\/painel$/, { timeout: ESPERA_DO_SERVIDOR });
  errosCsp = vigiarCsp(nutri);
  rotas = rotasDoPainel(await prepararTelasComId(browser, nutri, '10.9.13.88', '10.9.29.52', 0));
});
test.afterAll(async () => {
  try {
    if (nutri) await escolherTema(nutri, 'Igual ao aparelho'); // o seed e as outras specs esperam o padrão
  } finally {
    await nutri?.context().close();
  }
});

for (const [modo, tema, aparelho] of [
  ['claro', 'Claro', 'light'],
  ['escuro', 'Escuro', 'light'],
  ['igual ao aparelho (aparelho escuro)', 'Igual ao aparelho', 'dark'],
] as const) {
  test(`axe sem violações em todas as telas do painel — modo ${modo}`, async () => {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: aparelho });
    const falhas = await axeEmTodasAsTelas(nutri, rotas, tema);
    await nutri.emulateMedia({ colorScheme: 'light' });
    expect(falhas).toEqual([]);
    expect(errosCsp, 'violação de CSP em alguma tela do painel (D7)').toEqual([]);
  });
}

test('estados abertos também passam: menu da conta, aviso de erro de formulário', async () => {
  await escolherTema(nutri, 'Escuro');
  await nutri.goto('/painel');
  const abrirMenu = () => nutri.getByLabel(/^Conta de /).click();
  await abrirMenu();
  // só o menu aberto: o resto da tela fica sob ele, e o axe não calcula contraste de texto coberto ("incomplete" por
  // sobreposição parcial). A linha "Conectado como …" (text-suave sobre bg-cartao, os mesmos tokens que o axe confere
  // em todas as telas acima) cai nesse caso: é a única tolerância.
  const doMenu = (await violacoes(nutri, '[data-guia="conta"]', { refazer: abrirMenu })).filter((v) => v !== 'incompleto color-contrast: .py-2');
  expect(doMenu).toEqual([]);
  await nutri.goto('/painel/pacientes/novo');
  const comErros = () => nutri.getByRole('button', { name: 'Cadastrar paciente' }).click(); // vazio: erros por campo (role="alert")
  await comErros();
  expect(await violacoes(nutri, undefined, { refazer: comErros })).toEqual([]);
});
