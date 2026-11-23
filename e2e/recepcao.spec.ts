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
 * IPs (limite de login por IP): bloco 10.9.36.x (RE-D50) — 10.9.36.10 (recepção) e .12 (nutricionista) aqui; .11 no
 * sessao-equipe.spec; .13 a .19 ficam para a sessão e o convite.
 */
const RECEPCAO = { email: 'recepcao-e2e@nutridebby.test', senha: 'Nutri2026segura', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', nome: 'Recepção E2E' };
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial', retries: 0 });

/** Login da recepção: senha e o desafio do 2FA; devolve a página e os caminhos pedidos como documento no caminho. */
async function entrarComoRecepcao(browser: Browser, ip: string): Promise<{ page: Page; documentos: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  const documentos: string[] = [];
  page.on('request', (r) => {
    if (r.isNavigationRequest()) documentos.push(new URL(r.url()).pathname);
  });
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(RECEPCAO.email);
  await page.getByLabel('Senha').fill(RECEPCAO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/entrar\/2fa/);
  await page.getByLabel('Código do app autenticador').fill(new TOTP({ secret: Secret.fromUTF8(RECEPCAO.totp), digits: 6, period: 30 }).generate());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
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
  await expect(nutri.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(nutri.locator('main')).not.toContainText(RECEPCAO.nome);
  await nutri.context().close();
});
