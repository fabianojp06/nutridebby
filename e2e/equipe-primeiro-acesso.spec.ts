import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { TOTP } from 'otpauth';
import { destinatarioDoUltimo, esperarEmail, primeiroLink } from './mailpit';

/**
 * Plano 26, PR 2 (T7) — o primeiro acesso da recepção (US-489, RN-500): o link do e-mail, "Criar sua senha" com o termo de
 * confidencialidade da equipe na página, a caixa obrigatória, a senha, o 2FA obrigatório na Segurança e o Início dela. O
 * convite vem da semente (scripts/e2e-seed.ts, `E2E_EQUIPE_NOVA`): um consultório NOVO por execução e um e-mail novo por
 * execução, criados pelo módulo da Equipe (RE-D69) — a tela Equipe nasce desligada no PR 2 (RE-D52). Copiados aqui:
 * importar o seed roda o seed. Axe de /convite/[token] (recepção), claro e escuro (o de /termos/sigilo-equipe está no
 * acessibilidade.spec). IPs (limite de login por IP): bloco 10.9.36.40 a .59 (RE-D50) — .40 aqui; o resto fica para o
 * equipe.spec da T11b.
 */
const CONSULTORIO = 'Consultório Equipe Nova E2E';
const ASSUNTO = `Convite para a equipe de ${CONSULTORIO} no NutriDebby`;
const SENHA = 'Recepcao2026segura';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
test.describe.configure({ mode: 'serial', retries: 0 });

async function semViolacoes(page: import('@playwright/test').Page, rotulo: string) {
  for (const modo of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: modo });
    const r = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(r.passes.length, `${rotulo}: o axe rodou regras`).toBeGreaterThan(0);
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `${modo}: ${rotulo}`).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('a pessoa da recepção abre o convite, aceita o termo, cria a senha, configura o 2FA e chega ao Início dela (US-489)', async ({ browser }) => {
  const para = await destinatarioDoUltimo(ASSUNTO);
  const email = await esperarEmail(para, { assunto: ASSUNTO });
  expect(email.texto).toContain(`convidou você para a equipe de recepção de ${CONSULTORIO} no NutriDebby. Crie sua senha pelo link abaixo em até 72 horas.`);
  const link = new URL(primeiroLink(email.texto, '/convite/'));

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '10.9.36.40' } });
  const page = await ctx.newPage();
  await page.goto(link.pathname);
  await expect(page.getByRole('heading', { level: 1, name: 'Criar sua senha' })).toBeVisible();
  await expect(page.getByText(`Você recebeu um convite para a equipe de ${CONSULTORIO}.`)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Termo de confidencialidade da equipe' })).toBeVisible();
  await expect(page.getByText('inclusive o simples fato de uma pessoa ser paciente do consultório')).toBeVisible();
  await semViolacoes(page, '/convite/[token] (recepção)');

  // sem a caixa do termo: a mensagem junto da caixa, e nada é gravado
  await page.getByLabel('Nova senha').fill(SENHA);
  await page.getByLabel('Repita a senha').fill(SENHA);
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  const erro = page.getByRole('alert').filter({ hasText: 'Para entrar na equipe, aceite o termo de confidencialidade.' });
  await expect(erro).toBeVisible();
  const caixa = page.getByLabel('Li e aceito o Termo de confidencialidade da equipe');
  await expect(erro).toHaveAttribute('id', 'erro-convite');
  await expect(caixa).toHaveAttribute('aria-describedby', 'erro-convite');
  await semViolacoes(page, '/convite/[token] (recepção, com o erro)');

  // com a caixa: entra e vai à Segurança, com o 2FA obrigatório (nenhuma tela do painel antes)
  await page.getByLabel('Nova senha').fill(SENHA);
  await page.getByLabel('Repita a senha').fill(SENHA);
  await caixa.check();
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(page).toHaveURL(/\/conta\/seguranca/);
  await expect(page.getByText('A recepção precisa da verificação em duas etapas. Configure agora para continuar.')).toBeVisible();
  await page.goto('/painel');
  await expect(page).toHaveURL(/\/conta\/seguranca/);
  await page.getByLabel('Confirme sua senha').fill(SENHA);
  await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
  const segredo = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Código de 6 dígitos').fill(new TOTP({ secret: segredo }).generate());
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await page.getByRole('link', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('heading', { level: 1, name: /^Seu dia, / })).toBeVisible();

  // o link do convite não vale de novo
  await page.goto(link.pathname);
  await expect(page.getByRole('alert')).toContainText('Convite inválido ou já usado.');
  await ctx.close();
});
