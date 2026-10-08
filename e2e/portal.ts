import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
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
  aoAbrir?: (page: Page) => void,
  opcoes: BrowserContextOptions = {}, // ex.: { hasTouch: true } para o toque do Chrome no celular (revisão da T11 do Plano 16)
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
  const ctx = await browser.newContext({ ...opcoes, extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  aoAbrir?.(page); // antes da primeira navegação (ex.: o vigia de CSP do csp.spec cobre o aceite do convite)
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
  await nutri.goto('/painel/configuracoes/perfil');
  await nutri.getByLabel('Mostrar % de gordura ao paciente').setChecked(ligar);
  await nutri.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Perfil salvo.' })).toBeVisible();
}

let seqHora = 0;
/**
 * A nutricionista marca uma consulta para o paciente numa quarta-feira a ~7 semanas daqui, num horário que não repete na
 * mesma execução. R11 (rodada 1 da revisão da T12): cada spec usa uma `semana` só sua — portal.spec 0, acessibilidade.spec
 * 1 — e a quarta é a primeira depois de hoje + 49 dias, mais 7 dias por `semana`: dois specs nunca caem no mesmo dia,
 * qualquer que seja o dia da execução (com "dias à frente" 50 e 54, o arredondamento para a quarta juntava os dois em
 * 3 de cada 7 dias). Dentro de um spec, a hora sai de um contador do módulo.
 */
export async function marcarParaPaciente(nutri: Page, nome: string, email: string, semana: number): Promise<void> {
  const d = new Date(Date.now() + 49 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((10 - d.getUTCDay()) % 7 || 7) + 7 * semana); // a quarta-feira seguinte, + `semana` semanas
  const hora = `${String(8 + (++seqHora % 9)).padStart(2, '0')}:00`;
  await nutri.goto(`/painel/agenda/nova?data=${d.toISOString().slice(0, 10)}`);
  await nutri.getByLabel('Paciente').selectOption({ label: `${nome} (${email})` });
  await nutri.getByLabel('Hora').fill(hora);
  await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible();
}

/** Quantas páginas há no cache do "Meu plano" no aparelho (0 se o cache nem existe). */
export const entradasDoPlano = (page: Page) =>
  page.evaluate(async () => ((await caches.keys()).includes('nd-plano-v1') ? (await (await caches.open('nd-plano-v1')).keys()).length : 0));
