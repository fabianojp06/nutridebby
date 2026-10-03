import { expect, type Browser, type Page } from '@playwright/test';
import { esperarEmail, primeiroLink } from './mailpit';

let seq = 0;
/**
 * Cadastra pelo painel, aceita o convite pelo Mailpit e devolve o paciente logado no portal. R6: `ip` só deste paciente
 * (bloco 10.9.10.x do portal.spec; o limite de login é por IP).
 */
export async function pacienteNoPortal(
  browser: Browser,
  nutri: Page,
  ip: string,
): Promise<{ page: Page; nome: string; email: string; senha: string; prontuario: string }> {
  const sufixo = `${Date.now().toString(36)}${++seq}`;
  const nome = `Paula Portal ${sufixo}`;
  const email = `paula-${sufixo}@nutridebby.test`;
  const senha = `Paula${sufixo}2026`;
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(nome);
  await nutri.getByLabel('Data de nascimento').fill('1990-05-20');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(email);
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri).toHaveURL(/\/painel\/pacientes\/[0-9a-f-]{36}$/);
  const prontuario = new URL(nutri.url()).pathname;
  const convite = await esperarEmail(email, { assunto: 'Convite de Consultório E2E no NutriDebby' });
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  await page.goto(primeiroLink(convite.texto, '/convite/paciente/'));
  await page.getByLabel('Nova senha').fill(senha);
  await page.getByLabel('Repita a senha').fill(senha);
  await page.getByLabel(/^Li e aceito o Termo de Uso e Privacidade \(versão /).check();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/p\/inicio$/);
  return { page, nome, email, senha, prontuario };
}

/** Rascunho com "Almoço 12:00 · Chuchu, cozido 100 g" publicado pela nutricionista (US-022, US-025). */
export async function publicarPlanoSimples(nutri: Page, prontuario: string) {
  await nutri.goto(`${prontuario}/plano-alimentar`);
  await nutri.getByRole('button', { name: 'Criar plano' }).click();
  await expect(nutri.getByRole('heading', { name: /Plano alimentar — versão \d+/ })).toBeVisible();
  await nutri.getByRole('button', { name: 'Adicionar refeição' }).click();
  await nutri.getByLabel('Refeição', { exact: true }).fill('Almoço');
  await nutri.getByLabel('Horário de Almoço').fill('12:00');
  await nutri.getByLabel('Adicionar alimento em Almoço').fill('chuchu cozido');
  await nutri.getByRole('option', { name: /Chuchu, cozido/ }).click();
  await nutri.getByLabel('Gramas de Chuchu, cozido').fill('100');
  await expect(nutri.getByRole('status').filter({ hasText: 'Salvo' })).toBeVisible({ timeout: 10_000 });
  nutri.once('dialog', (d) => void d.accept());
  await nutri.getByRole('button', { name: 'Publicar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Plano publicado.' })).toBeVisible();
}
/** Avaliação pela aba Antropometria (mesmos passos de e2e/pacientes.spec.ts), com JP3 para gerar o % de gordura. */
export async function avaliar(nutri: Page, prontuario: string, data: string, peso: string) {
  await nutri.goto(`${prontuario}/antropometria`);
  await nutri.getByLabel('Data da avaliação').fill(data);
  await nutri.getByLabel('Peso (kg)').fill(peso);
  await nutri.getByLabel('Altura (cm)').fill('170');
  await nutri.getByLabel('Protocolo de dobras').selectOption('jp3');
  await nutri.getByLabel('Tríceps').fill('20');
  await nutri.getByLabel('Supra-ilíaca').fill('20');
  await nutri.getByLabel('Coxa', { exact: true }).last().fill('20');
  await nutri.getByRole('button', { name: 'Salvar avaliação' }).click();
  await expect(nutri.getByRole('status')).toHaveText('Avaliação salva.');
}

/** Liga ou desliga "Mostrar % de gordura ao paciente" em Perfil e marca (o tenant do E2E é compartilhado: sempre voltar a desligar). */
export async function mostrarPercGordura(nutri: Page, ligar: boolean) {
  await nutri.goto('/painel/configuracoes');
  await nutri.getByLabel('Mostrar % de gordura ao paciente').setChecked(ligar);
  await nutri.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Perfil salvo.' })).toBeVisible();
}
