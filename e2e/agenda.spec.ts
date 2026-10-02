import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;

/** 'AAAA-MM-DD' da segunda-feira a partir de hoje + `dias` (o teste só compara texto). */
function segundaDepoisDe(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}
const somar = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const br = (iso: string) => iso.split('-').reverse().join('/');
/** Semana bloqueada no E2E ("Congresso"): a segunda-feira daqui a ~30 dias até a sexta. */
const SEMANA_BLOQUEADA = segundaDepoisDe(30);

test.beforeAll(async ({ browser }) => {
  // O limite de login é por IP: cada spec usa o seu bloco (sair.spec = 10.9.7.x, agenda.spec = 10.9.8.x)
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.8.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('horários de atendimento e bloqueio (US-030)', async () => {
  await nutri.goto('/painel/agenda/horarios');
  await nutri.getByLabel('Dia da semana').selectOption({ label: 'Terça-feira' });
  await nutri.getByLabel('Início').fill('12:00');
  await nutri.getByLabel('Fim').fill('08:00');
  await nutri.getByRole('button', { name: 'Adicionar horário' }).click();
  await expect(nutri.getByText('O fim deve ser depois do início')).toBeVisible();
  for (const dia of ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira']) {
    await nutri.getByLabel('Dia da semana').selectOption({ label: dia });
    await nutri.getByLabel('Início').fill('08:00');
    await nutri.getByLabel('Fim').fill('18:00');
    await nutri.getByLabel('Duração').selectOption('60');
    await nutri.getByLabel('Modalidade').selectOption('ambas');
    await nutri.getByRole('button', { name: 'Adicionar horário' }).click();
    await expect(nutri.getByText(`${dia}, 08:00–18:00, 60 min, Presencial ou online`)).toBeVisible();
  }
  await nutri.getByLabel('Data inicial').fill(SEMANA_BLOQUEADA);
  await nutri.getByLabel('Data final').fill(somar(SEMANA_BLOQUEADA, 4));
  await nutri.getByLabel('Motivo (opcional)').fill('Congresso');
  await nutri.getByRole('button', { name: 'Adicionar bloqueio' }).click();
  await expect(nutri.getByText(`seg., ${br(SEMANA_BLOQUEADA)} às 00:00 até sáb., ${br(somar(SEMANA_BLOQUEADA, 5))} às 00:00 — Congresso`)).toBeVisible();
});
