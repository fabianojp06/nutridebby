import { expect, test, type Browser, type Page } from '@playwright/test';
import { Secret, TOTP } from 'otpauth';
import { entrarComo } from './helpers';
import { criarPacientePeloFormulario } from './pacientes-form';

/**
 * Plano 26, PR 2 — a recepção (US-489, US-490, RE-D67). Primeiro bloco (T6): a entrada pelo login e pelo 2FA chega ao Início
 * dela passando por /inicio (sem laço e sem o aviso de outro papel), e uma tela do prontuário leva a "Sem permissão" sem
 * nenhuma leitura registrada no Histórico de acessos do paciente. As contas vêm da semente (scripts/e2e-seed.ts, criadas
 * uma vez e reaproveitadas — RE-D46, RE-D69), copiadas aqui: importar o seed roda o seed. O 2FA de teste é o mesmo segredo
 * da E2E_DOCS (o Better Auth usa os bytes UTF-8 dele: `Secret.fromUTF8`).
 * IPs (limite de login por IP): bloco 10.9.36.x (RE-D50) — 10.9.36.10 (recepção), .12 (nutricionista), .13 (a recepção
 * do consultório com o contrato pendente) e .14 (a recepção com o Financeiro, no tour do primeiro acesso, T8) aqui; .11 no
 * sessao-equipe.spec; .15 e .16 no acessibilidade-painel.spec (axe da recepção, T8); .17 a .19 ficam para a sessão e o convite;
 * .20 aqui (o aceite da versão nova do termo, code review do PR 2).
 */
const RECEPCAO = { email: 'recepcao-e2e@nutridebby.test', senha: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', nome: 'Recepção E2E' };
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
// T8 (RE-D42, RE-D46): a recepção com a permissão do Financeiro, com o manual guiado zerado pela semente a cada execução
const RECEPCAO_FIN = { email: 'recepcao-fin-e2e@nutridebby.test', senha: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', nome: 'Recepção Financeiro E2E' };
// RN-501: a recepção de um consultório com o DPA numa versão antiga (a semente o põe assim a cada execução)
const RECEPCAO_CONTRATO = { email: 'recepcao-contrato-e2e@nutridebby.test', senha: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
// Code review do PR 2 (RN-500): a recepção que só aceitou uma versão antiga do termo de confidencialidade — conta nova a cada
// execução, com o mesmo e-mail (a semente arquiva a anterior: o aceite em `consents` não se apaga)
const RECEPCAO_TERMO_NOVO = { email: 'recepcao-termo-novo-e2e@nutridebby.test', senha: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
test.describe.configure({ mode: 'serial', retries: 0 });

/** Login da recepção: senha e o desafio do 2FA; devolve a página e os caminhos pedidos como documento no caminho. */
async function entrarComoRecepcao(browser: Browser, ip: string, cred: { email: string; senha: string; totp: string } = RECEPCAO, destino = /\/painel$/): Promise<{ page: Page; documentos: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  const documentos: string[] = [];
  page.on('request', (r) => {
    if (r.isNavigationRequest()) documentos.push(new URL(r.url()).pathname);
  });
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(cred.email);
  await page.getByLabel('Senha').fill(cred.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/entrar\/2fa/);
  await page.getByLabel('Código do app autenticador').fill(new TOTP({ secret: Secret.fromUTF8(cred.totp), digits: 6, period: 30 }).generate());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(destino);
  return { page, documentos };
}

let recepcao: Page;
let pacientePath = '';
const sufixo = Date.now().toString(36);

test.beforeAll(async ({ browser }) => {
  // a nutricionista cadastra um paciente desta execução (o Histórico de acessos dele começa só com ela)
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.36.12', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
  pacientePath = await criarPacientePeloFormulario(nutri, { nome: `Aaa Recepção ${sufixo}`, email: `rec-${sufixo}@nutridebby.test` });
  await nutri.context().close();
});
test.afterAll(async () => {
  await recepcao?.context().close();
});

test('a recepção entra pelo login e pelo 2FA e chega ao Início dela, passando por /inicio, sem laço nem aviso de outro papel (RE-D67)', async ({ browser }) => {
  const { page, documentos } = await entrarComoRecepcao(browser, '10.9.36.10');
  recepcao = page;
  await expect(page.getByRole('heading', { level: 1, name: 'Seu dia, Recepção' })).toBeVisible();
  expect(documentos).toContain('/inicio');
  expect(documentos.filter((d) => d.startsWith('/conta/'))).toEqual([]);
  expect(documentos.filter((d) => d === '/painel').length, 'sem laço de redirect').toBeLessThanOrEqual(2);
});

test('uma tela do prontuário leva a "Sem permissão" e nada é lido nem registrado no Histórico de acessos (US-490)', async ({ browser }) => {
  await recepcao.goto(`${pacientePath}/antropometria`);
  await expect(recepcao).toHaveURL(/\/painel\/sem-permissao\?motivo=nutri$/);
  await expect(recepcao.getByRole('heading', { level: 1, name: 'Sem permissão' })).toBeVisible();
  await expect(recepcao.getByText('Esta página é só da nutricionista.')).toBeVisible();
  await recepcao.getByRole('link', { name: 'Voltar ao início' }).click();
  await expect(recepcao).toHaveURL(/\/painel$/);
  // o Histórico de acessos do paciente, pela nutricionista: nenhuma linha com a recepção
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.36.12', { viewport: { width: 1280, height: 900 } });
  await expect(nutri).toHaveURL(/\/painel$/);
  await nutri.goto(`${pacientePath}/historico`);
  await expect(nutri.getByRole('heading', { level: 2, name: 'Histórico de acessos' })).toBeVisible();
  // o prontuário não tem <main> próprio: a página inteira não pode citar a recepção
  await expect(nutri.locator('body')).not.toContainText(RECEPCAO.nome);
  await nutri.context().close();
});

test('DPA do consultório pendente: toda tela leva a "Contrato do consultório pendente", com o "Sair" do cabeçalho (RN-501)', async ({ browser }) => {
  const { page } = await entrarComoRecepcao(browser, '10.9.36.13', RECEPCAO_CONTRATO, /\/painel\/contrato-pendente$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Contrato do consultório pendente' })).toBeVisible();
  await expect(page.getByText('O contrato de tratamento de dados do consultório precisa ser aceito pela nutricionista. Peça para ela entrar no NutriDebby.')).toBeVisible();
  for (const tela of ['/painel/ajuda', '/painel/sem-permissao?motivo=nutri']) {
    await page.goto(tela);
    await expect(page, tela).toHaveURL(/\/painel\/contrato-pendente$/);
  }
  const sair = page.getByRole('button', { name: 'Sair' });
  await expect(sair).toHaveCount(1);
  expect((await sair.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await sair.click();
  await expect(page).toHaveURL(/\/entrar/);
  await page.context().close();
});

test('primeiro acesso da recepção: o tour é o dela (nunca o boas-vindas), o menu e o menu da conta são os dela e o tema muda pelo cabeçalho (RE-D42, US-490)', async ({ browser }) => {
  const { page } = await entrarComoRecepcao(browser, '10.9.36.14', RECEPCAO_FIN);
  await page.waitForLoadState('networkidle'); // o <dialog> só abre depois da hidratação (useLayoutEffect)
  const tour = page.getByRole('dialog', { name: 'Boas-vindas à recepção' });
  await expect(tour).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Boas-vindas ao NutriDebby' })).toHaveCount(0);
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Próximo' }).click();
  await expect(page.getByText('7 de 7')).toBeVisible();
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(page.getByRole('dialog', { name: /Boas-vindas à recepção|Menu do painel|Agenda de hoje|Presença a registrar|Claro ou escuro|Ajuda em cada tela|Sua conta/ })).toBeHidden();
  // o menu dela, com o Financeiro (a permissão), e o menu da conta dela
  await expect(page.getByRole('navigation', { name: 'Menu do painel' }).getByRole('link')).toHaveText(['Início', 'Pacientes', 'Agenda', 'Financeiro', 'Relatórios']);
  await page.getByLabel(/^Conta de /).click();
  await expect(page.getByText(`${RECEPCAO_FIN.nome} · Recepção`)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Rever o tour', exact: true })).toHaveAttribute('href', '/painel?tour=recepcao-inicio');
  await expect(page.getByRole('link', { name: 'Perfil e marca' })).toHaveCount(0);
  // "Rever o tour" reabre o dela; Esc fecha e o ?tour= sai da URL (revisão da P26-08)
  await page.getByRole('link', { name: 'Rever o tour', exact: true }).click();
  await expect(tour).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour).toBeHidden();
  await expect(page).toHaveURL(/\/painel$/);
  // concluído: recarregar não reabre o tour
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(tour).toBeHidden();
  // o tema pelo botão do cabeçalho (alternarTemaAction com requireEquipe): grava na conta e vale ao recarregar
  const botao = page.getByRole('button', { name: 'Modo escuro' });
  const escuro = (await botao.getAttribute('aria-pressed')) !== 'true';
  await botao.click();
  await expect(botao).toHaveAttribute('aria-pressed', String(escuro));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Modo escuro' })).toHaveAttribute('aria-pressed', String(escuro));
  // de volta ao claro (as outras specs esperam o painel claro)
  if (escuro) {
    await page.getByRole('button', { name: 'Modo escuro' }).click();
    await expect(page.getByRole('button', { name: 'Modo escuro' })).toHaveAttribute('aria-pressed', 'false');
  }
  await page.context().close();
});

test('termo de confidencialidade numa versão nova: a recepção lê, aceita pelo formulário do aviso e chega ao Início (RN-500)', async ({ browser }) => {
  const { page } = await entrarComoRecepcao(browser, '10.9.36.20', RECEPCAO_TERMO_NOVO, /\/conta\/acesso-desativado$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Aceite o termo para continuar' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Termo de confidencialidade da equipe' })).toBeVisible();
  await expect(page.getByText('2. O que é confidencial.', { exact: false })).toBeVisible();
  // sem a caixa: a mensagem do convite, e nada muda (o anunciador de rotas também é alert: filtrado pelo texto)
  await page.getByRole('button', { name: 'Aceitar e continuar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Para entrar na equipe, aceite o termo de confidencialidade.' })).toBeVisible();
  await expect(page).toHaveURL(/\/conta\/acesso-desativado$/);
  await page.getByLabel('Li e aceito o Termo de confidencialidade da equipe').check();
  await page.getByRole('button', { name: 'Aceitar e continuar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Seu dia, Recepção' })).toBeVisible();
  // aceito: a página do aviso não abre mais
  await page.goto('/conta/acesso-desativado');
  await expect(page).toHaveURL(/\/painel$/);
  await page.context().close();
});
