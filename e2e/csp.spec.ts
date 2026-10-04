import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { pacienteNoPortal, publicarPlanoSimples } from './portal';

// P08-05 / RNF-06 (D7, D8). IPs deste spec: 10.9.13.16 a .20 — nutri .16 e .19, paciente .17 e .20, visitante .18
// (o limite de login é por IP; o 10.9.12.x é do sessao-portal.spec).
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

function vigiarCsp(page: Page): string[] {
  const erros: string[] = [];
  page.on('console', (m) => {
    if (/Content[- ]Security[- ]Policy/i.test(m.text())) erros.push(`${page.url()}: ${m.text()}`);
  });
  return erros;
}

test('cabeçalhos de segurança e nonce novo a cada requisição', async ({ request }) => {
  const [a, b] = [await request.get('/entrar'), await request.get('/entrar')];
  const h = a.headers();
  expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(b.headers()['content-security-policy']).not.toBe(h['content-security-policy']);
  expect(h['strict-transport-security']).toBe('max-age=63072000');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['x-powered-by']).toBeUndefined();
  expect((await request.get('/convite/token-invalido')).headers()['referrer-policy']).toBe('no-referrer');
  expect((await request.get('/api/health')).headers()['x-content-type-options']).toBe('nosniff');
});

test('login, painel, agenda, prontuário, plano, portal e página pública (Turnstile) sem violação de CSP', async ({ browser }) => {
  test.setTimeout(150_000); // cadastro + convite pelo Mailpit + plano + 12 telas + vídeo (D12)
  const visitante = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.13.18' } })).newPage();
  const erros = vigiarCsp(visitante);
  await visitante.goto('/entrar');
  await visitante.waitForLoadState('networkidle');
  for (const url of ['/esqueci-senha', '/n/e2e-consultorio']) {
    await visitante.goto(url);
    // Turnstile (INT-06): o token de teste no campo escondido prova que o api.js carregou ('strict-dynamic') e que o
    // iframe respondeu (frame-src). O iframe fica numa shadow root fechada (o seletor não o acha; page.frames() sim) e
    // mantém uma requisição blob: aberta: sem networkidle nestas páginas.
    await expect(visitante.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 15_000 });
    expect(visitante.frames().some((f) => f.url().startsWith('https://challenges.cloudflare.com/')), url).toBe(true);
  }

  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.16');
  await expect(nutri).toHaveURL(/\/painel$/);
  const errosNutri = vigiarCsp(nutri);
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.13.17');
  const errosPaciente = vigiarCsp(paciente.page);
  await publicarPlanoSimples(nutri, paciente.prontuario);
  for (const url of ['/painel', '/painel/agenda', '/painel/pacientes', paciente.prontuario, '/painel/configuracoes']) {
    await nutri.goto(url);
    await nutri.waitForLoadState('networkidle');
  }
  for (const url of ['/p/inicio', '/p/plano', '/p/diario', '/p/agenda', '/p/perfil', '/p/conteudos']) {
    await paciente.page.goto(url);
    await paciente.page.waitForLoadState('networkidle');
  }
  // D12 (Plano 08) + frame-src: vídeo do Plano 07 só para este paciente; o iframe do youtube-nocookie entra com o clique
  const video = `Vídeo CSP ${Date.now().toString(36)}`;
  await nutri.goto('/painel/conteudos');
  await nutri.getByRole('link', { name: 'Novo vídeo' }).click();
  await nutri.getByLabel('Título').fill(video);
  await nutri.getByLabel('Link do vídeo').fill('https://youtu.be/dQw4w9WgXcQ');
  await nutri.getByLabel('Pacientes específicos').check();
  await nutri.getByLabel(paciente.nome).check();
  await nutri.getByRole('button', { name: 'Criar' }).click();
  await expect(nutri).toHaveURL(/\/painel\/conteudos\/[0-9a-f-]{36}$/);
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Conteúdo publicado.' })).toBeVisible();
  await paciente.page.goto('/p/conteudos');
  await paciente.page.getByRole('link', { name: new RegExp(video) }).click();
  await expect(paciente.page).toHaveURL(/\/p\/conteudos\/[0-9a-f-]{36}$/);
  await expect(paciente.page.locator('iframe')).toHaveCount(0);
  await paciente.page.getByRole('button', { name: 'Carregar o vídeo' }).click();
  await expect(paciente.page.locator(`iframe[title="Vídeo: ${video}"]`)).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  await paciente.page.waitForLoadState('networkidle');
  expect([...erros, ...errosNutri, ...errosPaciente]).toEqual([]);
  await visitante.context().close();
  await paciente.page.context().close();
  await nutri.context().close();
});

// D2: /api/* fora do matcher do proxy. Se alguém incluir /api, o Next corta o corpo em 10 MB (proxyClientMaxBodySize)
// sem erro para o cliente e este exame de 15 MB falha. Conferir que a cota do tenant de E2E comporta 15 MB.
test('exame de 15 MB passa pelo servidor inteiro (US-015, até 20 MB)', async ({ browser }) => {
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.19');
  await expect(nutri).toHaveURL(/\/painel$/);
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.13.20');
  const id = paciente.prontuario.split('/').pop()!;
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(15 * 1024 * 1024, 0x20), Buffer.from('\n%%EOF\n')]);
  const r = await nutri.request.post(`/api/painel/pacientes/${id}/exames`, {
    headers: { origin: new URL(nutri.url()).origin },
    multipart: { titulo: 'Exame grande', data: '2026-10-01', valores: '[]', arquivo: { name: 'grande.pdf', mimeType: 'application/pdf', buffer: pdf } },
  });
  expect(r.status()).toBe(200);
  expect(await r.json()).toMatchObject({ ok: true });
  await paciente.page.context().close();
  await nutri.context().close();
});
