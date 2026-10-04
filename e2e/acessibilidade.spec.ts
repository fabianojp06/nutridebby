import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test, type Page } from '@playwright/test';
import { contraste } from '@/lib/tema/contraste';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';
import { avaliar, entradasDoPlano, marcarParaPaciente, pacienteNoPortal, publicarPlanoSimples } from './portal';

// RNF-10 / RNF-09 (P06-10): WCAG 2.1 AA em todas as telas do PWA, no tamanho de um Android (projeto "celular").
// Bloco de IP deste spec (o limite de login é por IP): 10.9.10.21 a 10.9.10.30.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const MULTI = { email: 'multi-e2e@nutridebby.test', senha: 'Multi2026segura' }; // scripts/e2e-seed.ts: 3 consultórios, o "3" sem o termo
test.describe.configure({ mode: 'serial' });
let nutri: Page;
let paciente: Awaited<ReturnType<typeof pacienteNoPortal>>;

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.10.21', devices['Desktop Chrome']); // o painel, em tela de computador
  await expect(nutri).toHaveURL(/\/painel$/);
  paciente = await pacienteNoPortal(browser, nutri, '10.9.10.22');
  await publicarPlanoSimples(nutri, paciente.prontuario);
  await marcarParaPaciente(nutri, paciente.nome, paciente.email, 1); // R11: semana 1 (o portal.spec usa a 0)
  // duas avaliações: o axe de /p/evolucao audita também o gráfico (GraficoLinha) e a lista de diferenças
  await avaliar(nutri, paciente.prontuario, '2026-08-01', '80');
  await avaliar(nutri, paciente.prontuario, '2026-09-01', '78');
  // um registro no diário, para a lista não sair vazia
  await paciente.page.goto('/p/diario');
  await paciente.page.getByLabel('Refeição', { exact: true }).selectOption('Almoço');
  await paciente.page.getByLabel('O que você comeu?').fill('arroz e feijão');
  await paciente.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Registro salvo.' })).toBeVisible();
});
test.afterAll(async () => {
  await paciente?.page.context().close();
  await nutri?.context().close();
});

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function violacoes(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
async function semViolacoes(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  expect(await violacoes(page), url).toEqual([]);
}

const ROTAS = ['/p/inicio', '/p/plano', '/p/diario', '/p/conteudos', '/p/conteudos?favoritos=1', '/p/evolucao', '/p/compras?dias=7', '/p/agenda', '/p/agenda/nova', '/p/perfil'];
for (const url of ROTAS) {
  test(`axe sem violações (WCAG 2.1 AA) em ${url}`, async () => {
    await semViolacoes(paciente.page, url);
  });
}

// Modo escuro do aparelho (prefers-color-scheme: dark). Plano 08: o tema escuro chega ao painel na Tarefa 14 (padrão
// "igual ao aparelho", data-tema=sistema) e ao portal na Tarefa 18; fora de um contêiner com data-tema tudo fica claro
// (globals.css). Nada pode escurecer só o fundo ou o texto base e deixar cores fixas do modo claro ilegíveis.
const PAINEL = ['/painel', '/painel/pacientes', '/painel/agenda', '/painel/alimentos', '/painel/diarios', '/painel/conteudos', '/painel/configuracoes'];
test('modo escuro do aparelho: axe sem violações (WCAG 2.1 AA) nas telas do portal e do painel', async () => {
  await paciente.page.emulateMedia({ colorScheme: 'dark' });
  await nutri.emulateMedia({ colorScheme: 'dark' });
  try {
    expect(await paciente.page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    for (const url of ROTAS) await semViolacoes(paciente.page, url);
    for (const url of [...PAINEL, paciente.prontuario]) await semViolacoes(nutri, url);
  } finally {
    await paciente.page.emulateMedia({ colorScheme: 'light' });
    await nutri.emulateMedia({ colorScheme: 'light' });
  }
});

// WCAG 2.4.7/1.4.11 (Plano 08, T12): o axe não avalia o foco. Sobre a cor do consultório ([data-sobre-marca]: o cartão de
// destaque da T15; o cabeçalho do painel é neutro desde a T14) o foco na cor da marca sumia (1:1). Todo item focável ali tem contorno
// visível e ≥ 3:1 contra o fundo onde ele é desenhado, no claro e com o aparelho escuro.
test('foco visível sobre a cor do consultório: contorno ≥ 3:1 contra o fundo, no claro e com o aparelho escuro', async () => {
  const hex = (cor: string) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cor);
    expect(m, cor).not.toBeNull();
    return `#${m!.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  };
  for (const modo of ['light', 'dark'] as const) {
    await nutri.emulateMedia({ colorScheme: modo });
    try {
      await nutri.goto('/painel');
      const alvos = nutri.locator('[data-sobre-marca] :is(a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]))');
      const n = await alvos.count();
      expect(n, modo).toBeGreaterThan(0);
      await nutri.keyboard.press('Tab'); // modalidade de teclado: o focus() programático acende o :focus-visible
      for (let k = 0; k < n; k++) {
        const alvo = alvos.nth(k);
        await alvo.focus();
        const r = await alvo.evaluate((el) => {
          // o contorno fica do lado de fora (outline-offset): o fundo que conta é o do primeiro ancestral pintado
          let e = el.parentElement;
          while (e && /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(getComputedStyle(e).backgroundColor)) e = e.parentElement;
          const s = getComputedStyle(el);
          return {
            nome: el.textContent?.trim() ?? '',
            focoVisivel: el.matches(':focus-visible'),
            estilo: s.outlineStyle,
            largura: parseFloat(s.outlineWidth),
            cor: s.outlineColor,
            fundo: e ? getComputedStyle(e).backgroundColor : 'rgb(255, 255, 255)',
          };
        });
        const rotulo = `${modo}: ${r.nome}`;
        expect(r.focoVisivel, rotulo).toBe(true);
        expect(r.estilo, rotulo).toBe('solid');
        expect(r.largura, rotulo).toBeGreaterThanOrEqual(2);
        expect(contraste(hex(r.cor), hex(r.fundo)), `${rotulo}: ${r.cor} sobre ${r.fundo}`).toBeGreaterThanOrEqual(3);
      }
    } finally {
      await nutri.emulateMedia({ colorScheme: 'light' });
    }
  }
});

test('axe sem violações no detalhe de uma orientação (markdown e "Baixar material (PDF)")', async () => {
  const titulo = `Como ler rótulos ${Date.now().toString(36)}`;
  await nutri.goto('/painel/conteudos/novo?tipo=orientacao');
  await nutri.getByLabel('Título').fill(titulo);
  await nutri.getByLabel('Texto').fill('## Rótulos\n\nOlhe **sempre** a *porção*.\n\n- açúcar\n- sódio\n\n[Guia da Anvisa](https://www.gov.br/anvisa)');
  await nutri.getByRole('button', { name: 'Criar' }).click();
  await expect(nutri).toHaveURL(/\/painel\/conteudos\/[0-9a-f-]{36}$/);
  // um PDF mínimo: o botão "Baixar material (PDF)" só aparece com ele
  const pdf = { name: 'material.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') };
  const campoPdf = nutri.getByLabel('Material em PDF (até 10 MB)');
  await campoPdf.setInputFiles(pdf);
  await expect(nutri.getByRole('status').filter({ hasText: 'PDF salvo.' })).toBeVisible();
  expect(await campoPdf.inputValue()).toBe(''); // o campo volta vazio: o mesmo arquivo pode ser escolhido de novo
  // "Remover PDF" tira também o "PDF salvo." da tela
  await nutri.getByRole('button', { name: 'Remover PDF' }).click();
  await expect(nutri.getByRole('link', { name: 'Ver PDF' })).toHaveCount(0);
  await expect(nutri.getByText('PDF salvo.')).toHaveCount(0);
  await campoPdf.setInputFiles(pdf);
  await expect(nutri.getByRole('status').filter({ hasText: 'PDF salvo.' })).toBeVisible();
  await expect(nutri.getByRole('link', { name: 'Ver PDF' })).toBeVisible();
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Conteúdo publicado.' })).toBeVisible();
  await paciente.page.goto('/p/conteudos');
  await paciente.page.getByRole('link', { name: new RegExp(titulo) }).click();
  await expect(paciente.page.getByRole('heading', { level: 2, name: 'Rótulos', exact: true })).toBeVisible();
  const baixar = paciente.page.getByRole('link', { name: 'Baixar material (PDF)' });
  await expect(baixar).toBeVisible();
  expect(await violacoes(paciente.page)).toEqual([]);
  // o download pela sessão da paciente: a rota assina na hora (303) e o arquivo vem como PDF
  const r = await paciente.page.request.get((await baixar.getAttribute('href'))!);
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toMatch(/^application\/pdf/);
});

test('celular (RNF-09): a 360 px (o menor Android da R16), nenhuma tela do PWA rola na horizontal e a barra de abas cabe em 7 colunas iguais (também a 320 px, com axe)', async () => {
  await paciente.page.setViewportSize({ width: 360, height: 780 });
  try {
    for (const url of ROTAS) {
      await paciente.page.goto(url);
      await paciente.page.waitForLoadState('networkidle');
      expect(await paciente.page.evaluate(() => window.innerWidth), url).toBe(360);
      expect(await paciente.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
    }
    await paciente.page.goto('/p/inicio');
    for (const aba of ['Início', 'Plano', 'Diário', 'Conteúdos', 'Evolução', 'Agenda', 'Perfil']) {
      await expect(paciente.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: aba })).toBeVisible();
    }
    // D3 (ratificado 04/10): 7 colunas iguais, palavra longa quebra com hífen — nada rola nem invade a vizinha, a 360 e a 320 px
    for (const largura of [360, 320]) {
      await paciente.page.setViewportSize({ width: largura, height: 780 });
      const barra = await paciente.page.getByRole('navigation', { name: 'Portal' }).evaluate((nav) => {
        const ul = nav.querySelector('ul')!;
        const lis = [...ul.querySelectorAll('li')].map((li) => li.getBoundingClientRect());
        const links = [...ul.querySelectorAll('a')];
        return {
          rola: ul.scrollWidth > ul.clientWidth || document.documentElement.scrollWidth > window.innerWidth,
          larguras: lis.map((r) => Math.round(r.width)),
          vazaDaColuna: links.filter((a) => a.scrollWidth > a.clientWidth).map((a) => a.textContent),
          alturaMin: Math.min(...links.map((a) => a.getBoundingClientRect().height)),
        };
      });
      expect(barra.rola, `${largura} px`).toBe(false);
      expect(Math.max(...barra.larguras) - Math.min(...barra.larguras), `${largura} px: ${barra.larguras}`).toBeLessThanOrEqual(1);
      expect(barra.vazaDaColuna, `${largura} px`).toEqual([]);
      expect(barra.alturaMin, `${largura} px`).toBeGreaterThanOrEqual(44);
      expect(await violacoes(paciente.page), `axe a ${largura} px`).toEqual([]);
    }
    // T-4: sem o min-h-dvh aninhado, tela curta do portal não rola na vertical
    await paciente.page.goto('/p/conteudos?favoritos=1');
    await paciente.page.waitForLoadState('networkidle');
    expect(await paciente.page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true);
  } finally {
    await paciente.page.setViewportSize(devices['Pixel 7'].viewport);
  }
});

test('alvo de toque ≥ 44 px (RNF-10): "Próxima consulta" no Início e as semanas do agendamento', async () => {
  const altura = async (l: ReturnType<Page['getByRole']>) => (await l.boundingBox())?.height ?? 0;
  await paciente.page.goto('/p/inicio');
  expect(await altura(paciente.page.locator('p', { hasText: 'Próxima consulta:' }).getByRole('link'))).toBeGreaterThanOrEqual(44);
  await paciente.page.goto('/p/agenda/nova');
  expect(await altura(paciente.page.getByRole('navigation', { name: 'Semana' }).getByRole('link', { name: 'Próxima semana' }))).toBeGreaterThanOrEqual(44);
});

test('axe sem violações na página da consulta', async () => {
  await paciente.page.goto('/p/agenda');
  await paciente.page.getByRole('region', { name: 'Próximas' }).getByRole('link').first().click();
  await expect(paciente.page).toHaveURL(/\/p\/agenda\/[0-9a-f-]{36}$/);
  await paciente.page.waitForLoadState('networkidle');
  expect(await violacoes(paciente.page)).toEqual([]);
});

test('axe sem violações na página do link da exportação (R12a)', async () => {
  await paciente.page.goto('/p/perfil');
  await paciente.page.getByRole('button', { name: 'Baixar meus dados' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Pedimos seus dados.' })).toBeVisible();
  const email = await esperarEmail(paciente.email, { assunto: 'Exportação de dados pronta' });
  await semViolacoes(paciente.page, primeiroLink(email.texto, '/p/meus-dados/exportacoes/'));
  await expect(paciente.page.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
});

test('axe sem violações em "sem acesso" (paciente arquivado)', async ({ browser }) => {
  const outro = await pacienteNoPortal(browser, nutri, '10.9.10.23');
  await nutri.goto(`${outro.prontuario}/privacidade`);
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Arquivar paciente' }).click();
  await expect(nutri.getByRole('button', { name: 'Desarquivar paciente' })).toBeVisible();
  await outro.page.goto('/p/inicio');
  await expect(outro.page).toHaveURL(/\/p\/sem-acesso$/);
  await outro.page.waitForLoadState('networkidle');
  expect(await violacoes(outro.page)).toEqual([]);
  await outro.page.context().close();
});

test('conta com três consultórios: axe em /p/escolher e /p/termo; trocar de nutricionista (sem login) apaga o plano guardado do outro vínculo (R12b, conferirDono)', async ({ browser }) => {
  const page = await entrarComo(browser, MULTI.email, MULTI.senha, '10.9.10.24');
  await expect(page).toHaveURL(/\/p\/escolher/);
  await expect(page.getByRole('heading', { name: 'Com qual nutricionista você quer entrar?' })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await violacoes(page)).toEqual([]);

  // entra no consultório 1 e guarda o plano no aparelho
  await page.getByRole('button', { name: 'Consultório E2E', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await page.goto('/p/inicio'); // o service worker se registra na carga da página (a navegação do login/escolha é do roteador)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Plano' }).click();
  await expect(page).toHaveURL(/\/p\/plano$/);
  await expect.poll(() => entradasDoPlano(page)).toBe(1);

  // troca pelo Perfil, sem sair: o consultório 3 pede o termo (axe)...
  await page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Perfil' }).click();
  expect((await page.getByRole('link', { name: 'Trocar de nutricionista' }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44); // RNF-10
  await page.getByRole('link', { name: 'Trocar de nutricionista' }).click();
  // achado 4 do /code-review: na escolha, a cópia do consultório 1 (ativo, escolhível) fica no aparelho
  await expect(page.getByRole('button', { name: 'Consultório E2E 3', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(await entradasDoPlano(page)).toBe(1);
  await page.getByRole('button', { name: 'Consultório E2E 3', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/termo$/);
  await page.waitForLoadState('networkidle');
  expect(await violacoes(page)).toEqual([]);

  // ...e o 2 (termo aceito) abre o portal: a cópia do plano do consultório 1 sai do aparelho
  await page.goto('/p/escolher');
  await page.getByRole('button', { name: 'Consultório E2E 2', exact: true }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await expect(page.getByText('Acompanhamento com Consultório E2E 2')).toBeVisible();
  await expect.poll(() => entradasDoPlano(page)).toBe(0);
  await page.context().close();
});

test('paciente não alcança o painel nem a API da nutricionista (403 ou volta ao portal, nunca 500 nem dado)', async () => {
  const id = '00000000-0000-4000-8000-000000000000';
  for (const rota of ['/painel', '/painel/pacientes', '/painel/agenda', '/painel/alimentos', '/painel/configuracoes', '/painel/diarios', `/painel/pacientes/${id}`, '/admin']) {
    await paciente.page.goto(rota);
    await expect(paciente.page, rota).toHaveURL(/\/p\/inicio$/);
  }
  // Pelo proxy, rota a rota (X-3: toda rota nova de /api/painel já é conferida, sem lista, em
  // src/app/api/painel/acesso-negado.test.ts)
  const chamadas: [string, string][] = [
    ['GET', '/api/painel/alimentos?q=arroz'],
    ['POST', '/api/painel/marca/logo'],
    ['POST', `/api/painel/pacientes/${id}/exames`],
    ['GET', `/api/painel/pacientes/${id}`],
    ['GET', `/api/painel/planos/${id}`],
    ['PUT', `/api/painel/planos/${id}`],
    ['GET', `/api/painel/planos/${id}/pdf`],
    ['GET', `/api/painel/planos/${id}/revisao`],
    ['GET', '/api/painel/whatsapp/estado'],
  ];
  for (const [metodo, url] of chamadas) {
    const r = await paciente.page.request.fetch(url, { method: metodo, maxRedirects: 0, data: metodo === 'GET' ? undefined : {} });
    expect(r.status(), `${metodo} ${url}`).toBe(403);
    expect(await r.json(), `${metodo} ${url}`).toEqual({ erro: 'Acesso negado' });
  }
});
