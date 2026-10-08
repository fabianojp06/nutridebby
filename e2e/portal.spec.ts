import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { corDaFaixa } from '@/lib/tema/marca-tema';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';
import { avaliar, entradasDoPlano, marcarParaPaciente, mostrarPercGordura, pacienteNoPortal, publicarPlanoSimples } from './portal';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const MULTI = { email: 'multi-e2e@nutridebby.test', senha: 'Multi2026segura' }; // scripts/e2e-seed.ts: 3 consultórios
test.describe.configure({ mode: 'serial' });
let nutri: Page;

test.beforeAll(async ({ browser }) => {
  // O limite de login é por IP: cada spec usa o seu bloco (R6: portal.spec = 10.9.10.x — nutri em 10.9.10.1 e cada
  // pacienteNoPortal com um IP só seu, de 10.9.10.2 a 10.9.10.20)
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.10.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('portal: o paciente entra no consultório, vê a navegação; arquivado perde o acesso e desarquivado volta (RN-08)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.2');
  await expect(p.page.getByText('Acompanhamento com Consultório E2E')).toBeVisible();
  await expect(p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Hoje' })).toHaveAttribute('aria-current', 'page');
  await nutri.goto(`${p.prontuario}/privacidade`);
  nutri.once('dialog', (d) => d.accept()); // ConfirmarBotao usa window.confirm
  await nutri.getByRole('button', { name: 'Arquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Desarquivar paciente' })).toBeVisible();
  await p.page.goto('/p/inicio');
  await expect(p.page).toHaveURL(/\/p\/sem-acesso$/);
  await expect(p.page.getByRole('status')).toHaveText('Seu acesso ao portal não está ativo. Fale com sua nutricionista.');
  await nutri.getByRole('button', { name: 'Desarquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Arquivar paciente' })).toBeVisible();
  await p.page.goto('/p/inicio');
  await expect(p.page.getByRole('heading', { level: 1, name: /^Olá, / })).toBeVisible();
  await p.page.context().close();
});

test('aparelho com outro papel: a tela diz qual conta está conectada e oferece "Sair" — portal, admin e painel (P09-03)', async ({ browser }) => {
  const aviso = (page: Page) => page.getByRole('status').filter({ hasText: 'Este aparelho está conectado como' });
  await nutri.goto('/p/inicio');
  await expect(nutri).toHaveURL(/\/conta\/outro-papel\?esperado=paciente$/);
  await expect(aviso(nutri)).toHaveText('Este aparelho está conectado como nutricionista. Saia e entre com a conta de paciente.');
  await expect(nutri.getByRole('button', { name: 'Sair' })).toBeVisible();
  await expect(nutri.getByRole('link', { name: 'Ir para o painel' })).toHaveAttribute('href', '/painel');
  expect((await new AxeBuilder({ page: nutri }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.map((v) => v.id)).toEqual([]);
  await nutri.goto('/admin');
  await expect(aviso(nutri)).toHaveText('Este aparelho está conectado como nutricionista. Saia e entre com a conta de administrador.');
  // IP 10.9.17.1 (bloco do Plano 09)
  const p = await pacienteNoPortal(browser, nutri, '10.9.17.1');
  await p.page.goto('/painel/pacientes');
  await expect(p.page).toHaveURL(/\/conta\/outro-papel\?esperado=nutri$/);
  await expect(aviso(p.page)).toHaveText('Este aparelho está conectado como paciente. Saia e entre com a conta de nutricionista.');
  await expect(p.page.getByText(p.email)).toHaveCount(0); // Review Focus 4: nada da conta na tela
  await expect(p.page.getByText(p.nome)).toHaveCount(0);
  await p.page.context().close();
});

test('Meu plano: sem plano → "Sua nutricionista ainda está preparando seu plano"; publicado → refeições e PDF (US-041)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.3');
  await p.page.goto('/p/plano');
  await expect(p.page.getByRole('status').filter({ hasText: 'Sua nutricionista' })).toHaveText('Sua nutricionista ainda está preparando seu plano');
  await publicarPlanoSimples(nutri, p.prontuario); // e2e/portal.ts
  await p.page.reload();
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  // Plano 16: o item em colunas (nome à esquerda, quantidade à direita), dentro da sanfona; o Almoço é a única refeição com
  // horário, logo sempre a "próxima" e já aberta (clicar no título fecharia a sanfona)
  await expect(p.page.getByText('Chuchu, cozido', { exact: true })).toBeVisible();
  await expect(p.page.getByText('100 g', { exact: true })).toBeVisible();
  await expect(p.page.getByRole('link', { name: 'Baixar PDF' })).toBeVisible();
  await p.page.context().close();
});

// Revisão da T11 do Plano 16: no Chrome o botão ganha o foco no pointerdown, e o "Desfazer" pegava o foco (e pausava o prazo)
// em todo toque — o registro não saía. IP 10.9.26.40 (bloco do Plano 16, livre depois dos da T16).
test('"Comi assim" (US-192, RN-198, WCAG 2.2.1): no toque o prazo de 10 s corre sozinho; pelo teclado o foco vai ao "Desfazer" e pausa; a página escondida envia', async ({ browser }) => {
  test.setTimeout(120_000);
  const p = await pacienteNoPortal(browser, nutri, '10.9.26.40', undefined, { hasTouch: true, isMobile: true, viewport: { width: 412, height: 839 } });
  await publicarPlanoSimples(nutri, p.prontuario);
  const posts: number[] = [];
  p.page.on('request', (r) => {
    if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/p/diario') posts.push(Date.now());
  });
  const comiAssim = p.page.getByRole('button', { name: 'Comi assim' });
  const desfazer = p.page.getByRole('button', { name: 'Desfazer' });
  const registrado = p.page.getByRole('status').filter({ hasText: 'Registrado no diário.' });

  // 1. Toque: o foco não vai ao "Desfazer" e o POST sai em cerca de 10 s, sem outra interação
  await p.page.goto('/p/plano');
  const tocouEm = Date.now();
  await comiAssim.tap();
  await expect(registrado).toBeVisible();
  await expect(desfazer).toBeVisible();
  await expect(desfazer).not.toBeFocused();
  await expect.poll(() => posts.length, { timeout: 15_000 }).toBe(1);
  expect(posts[0] - tocouEm).toBeGreaterThanOrEqual(9_000);
  await expect(desfazer).toHaveCount(0);
  await expect(registrado).toBeVisible();

  // 2. Teclado (Enter): o foco vai ao "Desfazer", o prazo pausa (nada sai em 12 s) e "Desfazer" devolve o foco ao botão
  await p.page.goto('/p/plano');
  await comiAssim.focus();
  await p.page.keyboard.press('Enter');
  await expect(desfazer).toBeFocused();
  await p.page.waitForTimeout(12_000); // passa dos 10 s do prazo: com o foco no "Desfazer", o prazo está pausado
  expect(posts).toHaveLength(1);
  await p.page.keyboard.press('Enter');
  await expect(p.page.getByRole('status').filter({ hasText: 'Registro desfeito.' })).toBeVisible();
  await expect(comiAssim).toBeFocused();
  expect(posts).toHaveLength(1);

  // 3. A página escondida (tela inicial, outro app: só visibilitychange, sem pagehide) envia na hora o que está pendente
  await p.page.goto('/p/plano');
  await comiAssim.tap();
  await expect(desfazer).toBeVisible();
  const escondeuEm = Date.now();
  await p.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => posts.length, { timeout: 5_000 }).toBe(2);
  expect(posts[1] - escondeuEm).toBeLessThan(5_000); // antes do fim do prazo de 10 s
  await p.page.context().close();
});

test('offline: "Plano" aberto pelo menu fica guardado; sem rede aparece com o selo; outra página do portal cai no plano; "Sair" apaga o cache (US-040, D6)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.4');
  await publicarPlanoSimples(nutri, p.prontuario);
  await p.page.goto('/p/inicio');
  await p.page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Uso normal: o menu é next/link (fetch RSC do roteador, não navegação 'navigate') — a página pede ao service worker
  await p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Plano' }).click();
  await expect(p.page).toHaveURL(/\/p\/plano$/);
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect.poll(() => entradasDoPlano(p.page)).toBe(1);
  await p.page.context().setOffline(true);
  await p.page.goto('/p/plano');
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect(p.page.getByRole('status').filter({ hasText: 'Offline — exibindo última versão' })).toBeVisible();
  await p.page.goto('/p/inicio');
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  // P09-04: a cópia de "Meu plano" servida offline em /p/inicio navega sozinha para /p/plano quando a rede volta e
  // atropelava o goto (run 37304638500). Sair dela antes de religar a rede.
  await p.page.goto('about:blank');
  await p.page.context().setOffline(false);
  await p.page.goto('/p/inicio');
  await p.page.goto('/p/perfil'); // Plano 16 (RN-211): o "Sair" do portal fica no fim de "Eu"
  await p.page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(p.page).toHaveURL(/\/entrar$/);
  expect(await p.page.evaluate(() => caches.keys())).not.toContain('nd-plano-v1');
  expect((await p.page.context().cookies()).map((c) => c.name)).not.toContain('nd_vinculo');
  await p.page.context().close();
});

test('selo offline com "lie-fi" (rede que não responde): o ping estoura em 5 s e o selo aparece na região viva que já estava na página (US-040, RNF-10)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.19');
  await p.page.goto('/p/inicio');
  const selo = p.page.getByRole('status').filter({ hasText: 'Offline — exibindo última versão' });
  await expect(selo).toHaveCount(0);
  expect(await p.page.locator('[role="status"]:empty').count()).toBeGreaterThan(0); // montada, sem texto
  await p.page.context().route('**/api/p/ping', () => undefined); // nunca responde
  await p.page.evaluate(() => window.dispatchEvent(new Event('online'))); // o selo confere de novo
  await expect(selo).toBeVisible({ timeout: 10_000 });
  await p.page.context().close();
});

test('plano guardado é da conta: sessão vencida (sem "Sair") leva ao /entrar, que apaga a cópia antes de outra pessoa entrar (Review Focus 4)', async ({ browser }) => {
  const a = await pacienteNoPortal(browser, nutri, '10.9.10.5');
  await publicarPlanoSimples(nutri, a.prontuario);
  await a.page.goto('/p/plano');
  await expect.poll(() => entradasDoPlano(a.page)).toBe(1);
  await a.page.context().clearCookies(); // a sessão de A "vence" no aparelho
  await a.page.goto('/p/inicio');
  await expect(a.page).toHaveURL(/\/entrar/);
  await expect.poll(() => entradasDoPlano(a.page)).toBe(0);
  await a.page.context().close();
});

test('acesso acaba com a sessão ainda válida (arquivado → /p/sem-acesso): o plano guardado sai do aparelho (RN-08, LGPD)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.10');
  await publicarPlanoSimples(nutri, p.prontuario);
  await p.page.goto('/p/plano');
  await expect.poll(() => entradasDoPlano(p.page)).toBe(1);
  await nutri.goto(`${p.prontuario}/privacidade`);
  nutri.once('dialog', (d) => d.accept());
  await nutri.getByRole('button', { name: 'Arquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Desarquivar paciente' })).toBeVisible();
  await p.page.goto('/p/plano');
  await expect(p.page).toHaveURL(/\/p\/sem-acesso$/);
  await expect.poll(() => entradasDoPlano(p.page)).toBe(0);
  await p.page.context().close();
});

test('acesso do dia: abrir o portal registra o dia e renova o cookie de sessão (CS-02, P06-11)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.6');
  const renovou = p.page.waitForResponse((r) => r.url().endsWith('/api/p/acesso') && r.status() === 204);
  await p.page.goto('/p/inicio');
  const r = await renovou;
  // R8: o headers() do Playwright não traz o Set-Cookie; headerValue traz
  expect(await r.headerValue('set-cookie')).toMatch(/session_token=.*Max-Age=2592000/);
  await p.page.context().close();
});

test('sem as chaves do VAPID no app, "Ativar notificações" não aparece e a tela explica', async ({ browser }) => {
  test.skip(!!process.env.VAPID_PUBLIC_KEY, 'o E2E com push de verdade precisa de um serviço de push real');
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.7');
  await expect(p.page.getByRole('status').filter({ hasText: 'Notificações no app ainda não estão disponíveis.' })).toBeVisible();
  await expect(p.page.getByRole('button', { name: 'Ativar notificações' })).toHaveCount(0);
  await p.page.context().close();
});

test('diário: registro com texto e foto aparece na hora; o worker converte a foto; arquivo grande é recusado (US-042)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.9');
  await p.page.goto('/p/diario');
  await p.page.getByLabel('Refeição', { exact: true }).selectOption('Almoço');
  await p.page.getByLabel('O que você comeu?').fill('arroz, feijão, frango');
  await p.page.getByLabel('Foto (opcional)').setInputFiles('e2e/fixtures/prato.jpg');
  await expect(p.page.getByAltText('Miniatura da foto escolhida')).toBeVisible();
  await p.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Registro salvo.' })).toBeVisible();
  await expect(p.page.getByText('arroz, feijão, frango')).toBeVisible();
  await expect(p.page.getByRole('listitem').getByRole('status')).toHaveCount(0); // "Foto sendo preparada…" não é região viva
  await expect
    .poll(
      async () => {
        await p.page.reload();
        return p.page.getByAltText('Foto do registro de Almoço').count();
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  await p.page.getByLabel('Refeição', { exact: true }).selectOption('Jantar');
  await p.page.getByLabel('O que você comeu?').fill('sopa de legumes');
  await p.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Registro salvo.' })).toBeVisible();
  await p.page.getByLabel('Refeição', { exact: true }).selectOption('Jantar');
  await p.page.getByLabel('Foto (opcional)').setInputFiles({ name: 'grande.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(11 * 1024 * 1024, 0xff) });
  await p.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(p.page.locator('#foto-erro')).toHaveText('Envie uma foto JPEG, PNG ou HEIC de até 10 MB');
  await expect(p.page.getByText('Registro salvo.')).toHaveCount(0); // a recusa local tira a mensagem do envio anterior
  await p.page.context().close();
});

test('diário com a sessão vencida: a tela diz "Sessão expirada. Entre de novo.", oferece o login e não apaga o que foi escrito', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.8');
  // P09-04: o POST /api/p/acesso da abertura devolve Set-Cookie com a sessão renovada (P06-11). Se a resposta chegasse
  // depois do clearCookies, a sessão "voltava" e o registro era salvo (run 37304638500): esperar por ela antes. O atraso
  // de 1,5 s fica de propósito: rede lenta não pode mudar o resultado.
  await p.page.route('**/api/p/acesso', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue().catch(() => undefined);
  });
  const acesso = p.page.waitForResponse((r) => new URL(r.url()).pathname === '/api/p/acesso');
  await p.page.goto('/p/diario');
  await acesso;
  await p.page.getByLabel('Refeição', { exact: true }).selectOption('Almoço');
  await p.page.getByLabel('O que você comeu?').fill('iogurte com granola');
  await p.page.context().clearCookies(); // a sessão "vence" com a página aberta
  await p.page.getByRole('button', { name: 'Registrar' }).click(); // o clique espera o botão habilitar (hidratação)
  const alerta = p.page.getByRole('alert').filter({ hasText: 'Sessão expirada. Entre de novo.' });
  await expect(alerta).toBeVisible();
  await expect(alerta.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/entrar?volta=%2Fp%2Fdiario');
  await expect(p.page.getByLabel('O que você comeu?')).toHaveValue('iogurte com granola');
  await p.page.context().close();
});

test('link com o consultório (?v=, e-mail e push): com 2+ vínculos abre o consultório do link e o menu continua nele; ?v= forjado é ignorado', async ({ browser }) => {
  const page = await entrarComo(browser, MULTI.email, MULTI.senha, '10.9.10.11');
  await expect(page).toHaveURL(/\/p\/escolher/);
  const vinculo = async () => (await page.context().cookies()).find((c) => c.name === 'nd_vinculo')?.value;
  await page.getByRole('button', { name: 'Consultório E2E', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  const consultorio1 = await vinculo();
  expect(consultorio1).toMatch(/^[0-9a-f-]{36}$/);
  await page.goto('/p/escolher');
  await page.getByRole('button', { name: 'Consultório E2E 2', exact: true }).click();
  await expect(page.getByText('Acompanhamento com Consultório E2E 2', { exact: true })).toBeVisible();
  // o link do e-mail/push do consultório 1, com o cookie no 2
  await page.goto(`/p/perfil?v=${consultorio1}`);
  await expect(page).toHaveURL(/\/p\/perfil$/); // o nd_vinculo foi regravado e o ?v= saiu
  await expect(page.getByText('Acompanhamento com Consultório E2E', { exact: true })).toBeVisible();
  expect(await vinculo()).toBe(consultorio1);
  await page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Hoje' }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await expect(page.getByText('Acompanhamento com Consultório E2E', { exact: true })).toBeVisible();
  // forjado (não é vínculo da conta): ignorado, fica o consultório do cookie
  await page.goto('/p/inicio?v=00000000-0000-4000-8000-000000000000');
  await expect(page.getByText('Acompanhamento com Consultório E2E', { exact: true })).toBeVisible();
  expect(await vinculo()).toBe(consultorio1);
  await page.context().close();
});

test('Perfil > Privacidade: baixar meus dados chega por e-mail e abre no portal; pedir exclusão aparece no painel (US-046)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.16');
  await p.page.goto('/p/perfil');
  await expect(p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Eu' })).toHaveAttribute('aria-current', 'page');
  // RNF-10 (achado 2 do /code-review): a região viva já existe, vazia, antes do clique — e é ela que recebe o texto
  const privacidade = p.page.getByRole('region', { name: 'Privacidade' });
  const regiao = privacidade.getByRole('status').first();
  await expect(regiao).toBeEmpty();
  await regiao.evaluate((el) => el.setAttribute('data-e2e-montada', ''));
  await p.page.getByRole('button', { name: 'Baixar meus dados' }).click();
  await expect(privacidade.locator('[role="status"][data-e2e-montada]')).toHaveText('Pedimos seus dados. O link chega por e-mail e vale por 24 horas.');
  const email = await esperarEmail(p.email, { assunto: 'Exportação de dados pronta' });
  expect(email.texto).toContain('pede que você entre no portal');
  await p.page.goto(primeiroLink(email.texto, '/p/meus-dados/exportacoes/'));
  await expect(p.page.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
  await expect(p.page.getByRole('link', { name: 'Baixar arquivo' })).toBeVisible();
  await p.page.goto('/p/perfil');
  await p.page.getByRole('button', { name: 'Baixar meus dados' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Você já pediu seus dados nas últimas 24 horas.' })).toBeVisible();
  p.page.once('dialog', (d) => d.accept());
  await p.page.getByRole('button', { name: 'Pedir exclusão dos meus dados' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Pedido de exclusão registrado.' })).toBeVisible();
  await esperarEmail(p.email, { assunto: 'Seu pedido foi registrado' });
  await nutri.goto('/painel');
  await expect(nutri.getByRole('link', { name: `Pedido de exclusão de ${p.nome}` })).toBeVisible();
  await p.page.context().close();
});

test('Perfil > Notificações: sem telefone, ligar o WhatsApp explica o que fazer (US-011)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.17');
  await p.page.goto('/p/perfil');
  await p.page.getByLabel('Receber lembretes por WhatsApp').check();
  await p.page.getByRole('button', { name: 'Salvar' }).click();
  await expect(p.page.getByRole('alert').filter({ hasText: 'Para receber por WhatsApp' })).toHaveText('Para receber por WhatsApp, peça à sua nutricionista para cadastrar seu telefone.');
  await expect(p.page.getByLabel('Receber lembretes por WhatsApp')).not.toBeChecked(); // T-6: volta ao salvo
  // RNF-10 (achado 2 do /code-review): a região de "Preferência salva." fica montada (vazia) e só o texto muda
  const form = p.page.locator('form').filter({ has: p.page.getByLabel('Receber lembretes por WhatsApp') });
  const regiao = form.getByRole('status');
  await expect(regiao).toBeEmpty();
  await regiao.evaluate((el) => el.setAttribute('data-e2e-montada', ''));
  await p.page.getByRole('button', { name: 'Salvar' }).click(); // desmarcada: opt-out, que não pede telefone
  await expect(form.locator('[role="status"][data-e2e-montada]')).toHaveText('Preferência salva.');
  await p.page.context().close();
});

test('Diários: a nutricionista vê o registro novo, abre, comenta; o paciente vê o comentário (US-043)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.12');
  await p.page.goto('/p/diario');
  await p.page.getByLabel('Refeição', { exact: true }).selectOption('Almoço');
  await p.page.getByLabel('O que você comeu?').fill(`frango grelhado ${p.nome}`);
  await p.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Registro salvo.' })).toBeVisible();
  await nutri.goto('/painel/diarios');
  const item = nutri.getByRole('listitem').filter({ hasText: p.nome });
  await expect(item.getByText('Novo')).toBeVisible();
  await item.getByRole('link').click();
  await nutri.getByLabel('Comentar').fill('Ótima escolha de proteína!');
  await nutri.getByRole('button', { name: 'Salvar comentário' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Comentário salvo.' })).toBeVisible();
  await nutri.goto('/painel/diarios');
  await expect(nutri.getByRole('listitem').filter({ hasText: p.nome }).getByText('Visto')).toBeVisible();
  await p.page.reload();
  await expect(p.page.getByText('Ótima escolha de proteína!')).toBeVisible();
  await p.page.context().close();
});

test('Minha evolução: peso sem % de gordura; com a opção ligada, o % aparece; orientações sem exames (US-044)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.14');
  await avaliar(nutri, p.prontuario, '2026-08-01', '80');
  await avaliar(nutri, p.prontuario, '2026-09-01', '77');
  await p.page.goto('/p/evolucao');
  await expect(p.page.getByRole('heading', { level: 1, name: 'Todas as medidas' })).toBeVisible();
  await expect(p.page.getByText(/^Peso: 80,0/)).toBeVisible();
  await expect(p.page.getByText('% de gordura')).toHaveCount(0);
  try {
    await mostrarPercGordura(nutri, true);
    await p.page.reload();
    await expect(p.page.getByText(/^% de gordura:/)).toBeVisible();
  } finally {
    await mostrarPercGordura(nutri, false);
  }
  await expect(p.page.getByText('Nenhuma orientação registrada ainda.')).toBeVisible();
  await p.page.context().close();
});

test('lista de compras: 7 dias do chuchu de 100 g = 700 g em "Verduras…"; "comprado" continua marcado ao reabrir (US-045)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.15');
  await p.page.goto('/p/compras');
  await expect(p.page.getByRole('status').filter({ hasText: 'Sem plano publicado, não há lista de compras.' })).toBeVisible();
  await publicarPlanoSimples(nutri, p.prontuario);
  await p.page.goto('/p/compras?dias=7');
  const grupo = p.page.getByRole('group', { name: 'Verduras, hortaliças e derivados' });
  await grupo.getByLabel('Chuchu, cozido — 700 g').check();
  await p.page.reload();
  await expect(p.page.getByRole('group', { name: 'Verduras, hortaliças e derivados' }).getByLabel('Chuchu, cozido — 700 g')).toBeChecked();
  await p.page.goto('/p/compras?dias=15');
  // R10: o anunciador de rota do Next também tem role="alert"
  await expect(p.page.getByRole('alert').filter({ hasText: 'Escolha de 1 a 14 dias.' })).toBeVisible();
  await p.page.context().close();
});

test('agenda no PWA: a consulta marcada pela nutricionista aparece; confirmar presença; a página de agendar abre (P06-09)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.18');
  await marcarParaPaciente(nutri, p.nome, p.email, 0);
  await p.page.goto('/p/agenda');
  const proxima = p.page.getByRole('region', { name: 'Próximas' }).getByRole('link').first();
  await expect(proxima).toContainText('Agendada');
  await proxima.click();
  await p.page.getByRole('button', { name: 'Confirmar presença' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Presença confirmada. Até lá!' })).toBeVisible();
  // rodada 1 da revisão: a remarcação leva à consulta nova com ?ok=remarcada (actions.test.ts) e a página mostra a confirmação
  await p.page.goto(`${new URL(p.page.url()).pathname}?ok=remarcada`);
  await expect(p.page.getByRole('status').filter({ hasText: /^Consulta remarcada para .+\.$/ })).toBeVisible();
  await p.page.goto('/p/agenda/nova');
  await expect(p.page.getByRole('heading', { name: 'Agendar consulta' })).toBeVisible();
  await p.page.goto('/p/agenda/00000000-0000-4000-8000-000000000000');
  await expect(p.page.getByText('404')).toBeVisible();
  await p.page.context().close();
});

// Plano 08, T18 (D18) e Plano 16 (RN-207): o portal usa a cor do consultório na faixa (`bg-faixa` = corDaFaixa, posta pelo
// (portal)/layout em --nd-faixa) e na pílula da seção atual (`text-faixa` sobre branco), iguais no claro e com o aparelho
// escuro (G-D7: só a faixa escurece a cor). Sem o --nd-faixa do layout, os dois dariam o verde padrão. IP deste teste: 10.9.13.86.
test('cor do consultório no portal: a faixa e a seção atual, no claro e com o aparelho escuro (D18, RN-207)', async ({ browser }) => {
  const COR = '#2E7D32';
  const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
  await nutri.goto('/painel/configuracoes/perfil');
  const campo = nutri.getByLabel('Cor principal');
  const original = await campo.inputValue();
  const salvar = async (cor: string) => {
    await nutri.goto('/painel/configuracoes/perfil');
    await nutri.getByLabel('Cor principal').fill(cor);
    await nutri.getByRole('button', { name: 'Salvar perfil' }).click();
    await expect(nutri.getByRole('status')).toHaveText('Perfil salvo.');
  };
  await salvar(COR);
  try {
    const p = await pacienteNoPortal(browser, nutri, '10.9.13.86');
    try {
      const item = p.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Hoje' });
      await expect(item).toHaveAttribute('aria-current', 'page');
      const cor = () => item.evaluate((el) => getComputedStyle(el).color);
      const fundoDaFaixa = () => p.page.getByRole('banner').evaluate((el) => getComputedStyle(el).backgroundColor);
      for (const colorScheme of ['light', 'dark'] as const) {
        await p.page.emulateMedia({ colorScheme });
        expect(await cor(), colorScheme).toBe(rgb(corDaFaixa(COR)));
        expect(await fundoDaFaixa(), colorScheme).toBe(rgb(corDaFaixa(COR)));
      }
    } finally {
      await p.page.context().close();
    }
  } finally {
    await salvar(original);
  }
});
