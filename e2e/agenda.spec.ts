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

const sufixo = Date.now().toString(36);
/** Segunda-feira da semana seguinte à bloqueada: horários livres de 08:00 a 18:00 (Step 7 da Tarefa 2). */
const SEGUNDA_LIVRE = somar(SEMANA_BLOQUEADA, 7);

async function novoPaciente(nome: string, email: string): Promise<void> {
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(nome);
  await nutri.getByLabel('Data de nascimento').fill('1990-05-10');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(email);
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri).toHaveURL(/\/painel\/pacientes\/[0-9a-f-]{36}$/);
}

async function marcar(paciente: string, data: string, hora: string): Promise<void> {
  await nutri.goto(`/painel/agenda/nova?data=${data}`);
  await nutri.getByLabel('Paciente').selectOption({ label: paciente });
  await nutri.getByLabel('Hora').fill(hora);
  await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
}

test('agenda da nutricionista: marcar, conflito, avisos, semana e alterar (US-031)', async () => {
  await novoPaciente(`Carla Agenda ${sufixo}`, `carla-${sufixo}@ex.com`);
  await novoPaciente(`Dora Agenda ${sufixo}`, `dora-${sufixo}@ex.com`);
  const carla = `Carla Agenda ${sufixo} (carla-${sufixo}@ex.com)`;
  const dora = `Dora Agenda ${sufixo} (dora-${sufixo}@ex.com)`;
  await marcar(carla, SEGUNDA_LIVRE, '09:00');
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible();
  await expect(nutri.getByRole('heading', { name: `Consulta de Carla Agenda ${sufixo}` })).toBeVisible();
  await marcar(dora, SEGUNDA_LIVRE, '09:30');
  // o anunciador de rota do Next também tem role="alert" (R5): filtra pelo texto do conflito
  await expect(nutri.getByRole('alert').filter({ hasText: 'Conflito com a consulta de' })).toHaveText(`Conflito com a consulta de Carla Agenda ${sufixo} às 09:00`);
  await nutri.getByLabel('Hora').fill('19:00');
  await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
  await expect(nutri.getByText('Fora do seu horário de atendimento')).toBeVisible();
  await marcar(dora, somar(SEMANA_BLOQUEADA, 1), '10:00');
  await expect(nutri.getByText('Consulta dentro de um bloqueio').first()).toBeVisible();
  await nutri.goto(`/painel/agenda?visao=semana&data=${SEGUNDA_LIVRE}`);
  await expect(nutri.getByRole('link', { name: `Carla Agenda ${sufixo}` })).toBeVisible();
  await nutri.getByRole('link', { name: `Carla Agenda ${sufixo}` }).click();
  // exact: a seção "Alterar data e hora" (aria-labelledby) também casaria com 'Hora' por trecho
  await nutri.getByLabel('Hora', { exact: true }).fill('11:00');
  await nutri.getByRole('button', { name: 'Salvar alteração' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta alterada.' })).toBeVisible();
  await expect(nutri.getByText(/às 11:00–12:00 · Presencial/)).toBeVisible();
});

test('nova consulta: depois de um erro, o formulário mantém paciente, hora, duração, modalidade e link (US-031)', async () => {
  await nutri.goto(`/painel/agenda/nova?data=${SEGUNDA_LIVRE}`);
  const paciente = nutri.getByLabel('Paciente');
  await paciente.selectOption({ index: 1 }); // 0 é "Selecione o paciente"
  const escolhido = await paciente.inputValue();
  await nutri.getByLabel('Hora').fill('16:00');
  await nutri.getByLabel('Duração').selectOption('45');
  await nutri.getByLabel('Online').check();
  await nutri.getByLabel('Link da chamada').fill('http://sem-https.example');
  await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
  await expect(nutri.getByRole('alert').filter({ hasText: 'Informe o link da chamada' })).toBeVisible();
  await expect(paciente).toHaveValue(escolhido);
  await expect(nutri.getByLabel('Hora')).toHaveValue('16:00');
  await expect(nutri.getByLabel('Duração')).toHaveValue('45');
  await expect(nutri.getByLabel('Online')).toBeChecked();
  await expect(nutri.getByLabel('Link da chamada')).toHaveValue('http://sem-https.example');
});
