import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';
import { avaliar, marcarParaPaciente, mostrarPercGordura, pacienteNoPortal, publicarPlanoSimples } from './portal';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
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
  await expect(p.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Início' })).toHaveAttribute('aria-current', 'page');
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
  await expect(p.page.getByRole('heading', { name: 'Meu acompanhamento' })).toBeVisible();
  await p.page.context().close();
});

test('nutricionista em /p/inicio volta ao painel', async () => {
  await nutri.goto('/p/inicio');
  await expect(nutri).toHaveURL(/\/painel$/);
});

test('Meu plano: sem plano → "Sua nutricionista ainda está preparando seu plano"; publicado → refeições e PDF (US-041)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.3');
  await p.page.goto('/p/plano');
  await expect(p.page.getByRole('status')).toHaveText('Sua nutricionista ainda está preparando seu plano');
  await publicarPlanoSimples(nutri, p.prontuario); // e2e/portal.ts
  await p.page.reload();
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect(p.page.getByText('Chuchu, cozido — 100 g')).toBeVisible();
  await expect(p.page.getByRole('link', { name: 'Baixar PDF' })).toBeVisible();
  await p.page.context().close();
});

const entradasDoPlano = (page: Page) => page.evaluate(async () => ((await caches.keys()).includes('nd-plano-v1') ? (await (await caches.open('nd-plano-v1')).keys()).length : 0));

test('offline: "Plano" aberto pelo menu fica guardado; sem rede aparece com o selo; outra página do portal cai no plano; "Sair" apaga o cache (US-040, D6)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.4');
  await publicarPlanoSimples(nutri, p.prontuario);
  await p.page.goto('/p/inicio');
  await p.page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // Uso normal: o menu é next/link (fetch RSC do roteador, não navegação 'navigate') — a página pede ao service worker
  await p.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Plano' }).click();
  await expect(p.page).toHaveURL(/\/p\/plano$/);
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect.poll(() => entradasDoPlano(p.page)).toBe(1);
  await p.page.context().setOffline(true);
  await p.page.goto('/p/plano');
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await expect(p.page.getByRole('status').filter({ hasText: 'Offline — exibindo última versão' })).toBeVisible();
  await p.page.goto('/p/inicio');
  await expect(p.page.getByRole('heading', { name: /Almoço · 12:00/ })).toBeVisible();
  await p.page.context().setOffline(false);
  await p.page.goto('/p/inicio');
  await p.page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(p.page).toHaveURL(/\/entrar$/);
  expect(await p.page.evaluate(() => caches.keys())).not.toContain('nd-plano-v1');
  expect((await p.page.context().cookies()).map((c) => c.name)).not.toContain('nd_vinculo');
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
  await p.page.getByLabel('Foto (opcional)').setInputFiles({ name: 'grande.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(11 * 1024 * 1024, 0xff) });
  await p.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(p.page.locator('#foto-erro')).toHaveText('Envie uma foto JPEG, PNG ou HEIC de até 10 MB');
  await p.page.context().close();
});

test('Perfil > Privacidade: baixar meus dados chega por e-mail e abre no portal; pedir exclusão aparece no painel (US-046)', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.10.16');
  await p.page.goto('/p/perfil');
  await expect(p.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');
  await p.page.getByRole('button', { name: 'Baixar meus dados' }).click();
  await expect(p.page.getByRole('status').filter({ hasText: 'Pedimos seus dados. O link chega por e-mail e vale por 24 horas.' })).toBeVisible();
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
  await expect(p.page.getByRole('heading', { name: 'Minha evolução' })).toBeVisible();
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
