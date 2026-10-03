import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';
import { conexaoDoConsultorio, idDoTenant, lembreteDeWhatsappAgora, webhookAssinado } from './whatsapp';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
// Serial: cada teste usa o que o anterior criou. Sem nova tentativa (o CI tem retries: 1): o seed roda uma vez só, e a
// segunda tentativa do arquivo colidiria com os dados da primeira (horários repetidos, bloqueio já gravado).
test.describe.configure({ mode: 'serial', retries: 0 });
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
  // teto de datas da agenda (revisão final): data absurda na URL volta para hoje, nunca 500
  for (const url of ['/painel/agenda?data=9999-12-31', '/painel/agenda?visao=semana&data=9999-12-31', '/painel/agenda/nova?data=9999-12-31']) {
    expect((await nutri.goto(url))?.status()).toBe(200);
  }
  await expect(nutri.getByRole('heading', { name: 'Nova consulta' })).toBeVisible();
});

const sufixo = Date.now().toString(36);
/** Segunda-feira da semana seguinte à bloqueada: horários livres de 08:00 a 18:00 (Step 7 da Tarefa 2). */
const SEGUNDA_LIVRE = somar(SEMANA_BLOQUEADA, 7);

/** `whatsapp`: telefone ('(11) 9xxxx-xxxx') e a autorização de WhatsApp marcada. */
async function novoPaciente(nome: string, email: string, whatsapp?: string): Promise<void> {
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(nome);
  await nutri.getByLabel('Data de nascimento').fill('1990-05-10');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(email);
  if (whatsapp) {
    await nutri.getByLabel('Telefone (opcional)').fill(whatsapp);
    await nutri.getByLabel('Paciente autorizou receber mensagens por WhatsApp').check();
  }
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

test('e-mail "Consulta marcada" e lembretes agendados (US-031, US-034)', async () => {
  // a consulta da Carla foi alterada para as 11:00 no teste "agenda da nutricionista": a confirmação nova diz 11:00
  const email = await esperarEmail(`carla-${sufixo}@ex.com`, { assunto: `Consulta marcada: seg., ${br(SEGUNDA_LIVRE)} às 11:00 (horário de Brasília)` });
  expect(email.texto).toMatch(/\/consulta\/[A-Za-z0-9_-]{71}/);
  await nutri.goto(`/painel/agenda?visao=dia&data=${SEGUNDA_LIVRE}`);
  await nutri.getByRole('link', { name: `Carla Agenda ${sufixo}` }).click();
  const tabela = nutri.getByRole('table', { name: 'Lembretes da consulta' });
  await expect(tabela.getByRole('row', { name: /Lembrete de 24 h E-mail Agendado para dom\., .* às 11:00/ })).toBeVisible();
  await expect(tabela.getByRole('row', { name: /Lembrete de 2 h WhatsApp Agendado para seg\., .* às 09:00/ })).toBeVisible();
  // o horário antigo (09:00) continua na tela, como histórico (D6/D17)
  await expect(tabela.getByRole('row', { name: /Lembrete de 24 h E-mail Não enviado: consulta remarcada/ })).toBeVisible();
});

test('link da consulta: confirmar, remarcar (US-033, US-035) e cancelamento pela nutricionista', async ({ browser }) => {
  const email = await esperarEmail(`carla-${sufixo}@ex.com`, { assunto: `Consulta marcada: seg., ${br(SEGUNDA_LIVRE)} às 11:00 (horário de Brasília)` });
  const link = primeiroLink(email.texto, '/consulta/');
  const paciente = await (await browser.newContext()).newPage();
  const resposta = await paciente.goto(link);
  // D20: o token está na URL — Referrer-Policy também por cabeçalho, além da <meta>
  expect(resposta?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(paciente.getByText(`Com Consultório E2E · seg., ${br(SEGUNDA_LIVRE)} às 11:00 (horário de Brasília) · Presencial`)).toBeVisible();
  await paciente.getByRole('button', { name: 'Confirmar presença' }).click();
  await expect(paciente.getByRole('status').filter({ hasText: 'Presença confirmada. Até lá!' })).toBeVisible();
  await nutri.goto(`/painel/agenda?visao=dia&data=${SEGUNDA_LIVRE}`);
  await expect(nutri.getByText('Confirmada pelo link')).toBeVisible();

  await paciente.goto(`${link}?semana=${SEGUNDA_LIVRE}`);
  await paciente.getByRole('group', { name: `ter., ${br(somar(SEGUNDA_LIVRE, 1)).slice(0, 5)}` }).getByRole('radio', { name: '14:00' }).check();
  await paciente.getByRole('button', { name: 'Remarcar para este horário' }).click();
  await expect(paciente.getByText(`Consulta remarcada para ter., ${br(somar(SEGUNDA_LIVRE, 1))} às 14:00 (horário de Brasília).`)).toBeVisible();
  // a página se refaz: o link é da consulta antiga, agora cancelada (remarcar = cancelar + marcar outra, D17)
  await expect(paciente.getByRole('status').filter({ hasText: 'Esta consulta foi cancelada.' })).toBeVisible();
  await nutri.goto(`/painel/agenda?visao=semana&data=${SEGUNDA_LIVRE}`);
  await expect(nutri.getByText('Cancelada pelo paciente')).toBeVisible();

  // a nutricionista cancela a nova; a paciente recebe o aviso
  await nutri.getByRole('link', { name: `Carla Agenda ${sufixo}` }).last().click();
  nutri.once('dialog', (d) => d.accept());
  await nutri.getByLabel('Motivo do cancelamento (opcional)').fill('Imprevisto');
  await nutri.getByRole('button', { name: 'Cancelar consulta' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta cancelada.' })).toBeVisible();
  // revisão final: o motivo ("Só você vê.") aparece para ela na página da consulta, e não no aviso à paciente
  await expect(nutri.getByText('Motivo do cancelamento (só você vê): Imprevisto')).toBeVisible();
  const aviso = await esperarEmail(`carla-${sufixo}@ex.com`, { assunto: `Consulta cancelada: ter., ${br(somar(SEGUNDA_LIVRE, 1))} às 14:00 (horário de Brasília)` });
  expect(aviso.texto + aviso.html).not.toContain('Imprevisto');
  await paciente.context().close();
});

test('link da consulta fora do prazo (RN-04): só "Avisar que preciso remarcar"; a nutricionista vê o pedido (US-035)', async ({ browser }) => {
  // daqui a ~3 h no fuso do consultório: dentro das 24 h em que o paciente não cancela nem remarca
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(Date.now() + 3 * 3_600_000))
      .map((x) => [x.type, x.value]),
  );
  await novoPaciente(`Eva Agenda ${sufixo}`, `eva-${sufixo}@ex.com`);
  await marcar(`Eva Agenda ${sufixo} (eva-${sufixo}@ex.com)`, `${p.year}-${p.month}-${p.day}`, `${p.hour}:00`);
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible();
  const consultaNoPainel = nutri.url();
  const paciente = await (await browser.newContext()).newPage();
  // o convite (cadastro) e a "Consulta marcada" vão para o mesmo endereço, em ordem que varia: espera a da consulta pelo assunto
  await paciente.goto(primeiroLink((await esperarEmail(`eva-${sufixo}@ex.com`, { assuntoComeca: 'Consulta marcada: ' })).texto, '/consulta/'));
  await expect(paciente.getByRole('status').filter({ hasText: 'Para alterar, fale com sua nutricionista.' })).toBeVisible();
  await expect(paciente.getByRole('button', { name: 'Remarcar para este horário' })).toHaveCount(0);
  await expect(paciente.getByRole('button', { name: 'Cancelar consulta' })).toHaveCount(0);
  await paciente.getByRole('button', { name: 'Avisar que preciso remarcar' }).click();
  await expect(paciente.getByRole('status').filter({ hasText: 'Avisamos sua nutricionista. Ela vai entrar em contato.' })).toBeVisible();
  await expect(paciente.getByRole('button', { name: 'Avisar que preciso remarcar' })).toHaveCount(0); // uma vez só
  await nutri.goto(consultaNoPainel);
  await expect(nutri.getByText('Paciente pediu para remarcar')).toBeVisible();

  // a nutricionista cancela com a página do paciente aberta: "Confirmar presença" não confirma mais (texto do paciente)
  nutri.once('dialog', (d) => d.accept());
  await nutri.getByRole('button', { name: 'Cancelar consulta' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta cancelada.' })).toBeVisible();
  await paciente.getByRole('button', { name: 'Confirmar presença' }).click();
  await expect(paciente.getByRole('alert').filter({ hasText: 'Esta consulta não pode mais ser confirmada.' })).toBeVisible();
  await expect(paciente.getByRole('status').filter({ hasText: 'Esta consulta foi cancelada.' })).toBeVisible();
  await paciente.context().close();
});

test('página pública: horário, Turnstile, código por e-mail e "Novo paciente via agendamento online" (US-032, RN-16)', async ({ browser }) => {
  // R6: o bloco 10.9.8.x é do agenda.spec (o limite da página pública é por IP; o e2e:seed zera o do 10.9.8.50)
  const visitante = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.8.50' } })).newPage();
  const email = `pub-${sufixo}@ex.com`;
  const quarta = somar(SEGUNDA_LIVRE, 2);
  await visitante.goto(`/n/e2e-consultorio?semana=${quarta}`);
  await expect(visitante.getByRole('heading', { name: 'Agendar consulta com Consultório E2E' })).toBeVisible();
  // quem já tem sessão vai direto à agenda do portal (sem pedir a senha nem apagar o plano offline); sem sessão, o proxy leva ao login
  await expect(visitante.getByRole('link', { name: 'Entrar (já sou paciente)' })).toHaveAttribute('href', '/p/agenda');
  await expect(visitante.getByRole('group', { name: 'Escolha a modalidade' }).getByLabel('Presencial')).toBeChecked();
  await visitante.getByRole('group', { name: `qua., ${br(quarta).slice(0, 5)}` }).getByRole('radio', { name: '16:00' }).check();
  await visitante.getByLabel('Nome').fill(`Eva Publica ${sufixo}`);
  await visitante.getByLabel('E-mail').fill(email);
  // Turnstile com a site key de teste da Cloudflare (sempre passa): espera o token chegar
  await expect(visitante.getByRole('button', { name: 'Enviar código' })).toBeEnabled({ timeout: 20_000 });
  await visitante.getByRole('button', { name: 'Enviar código' }).click();
  await expect(visitante.getByText('Confirme que você tem 18 anos ou mais')).toBeVisible();
  await expect(visitante.getByLabel('Nome')).toHaveValue(`Eva Publica ${sufixo}`); // o 422 não apaga o que foi digitado
  await visitante.getByLabel('Tenho 18 anos ou mais').check();
  await visitante.getByLabel(/^Li e aceito o Termo de Uso e Privacidade/).check();
  // depois do 422 o botão fica na borda de baixo da tela, logo abaixo do iframe (de outra origem) do Turnstile: rolar antes,
  // senão o clique sai nas coordenadas de antes da rolagem e cai no iframe (nenhum evento chega à página)
  await visitante.getByRole('button', { name: 'Enviar código' }).scrollIntoViewIfNeeded();
  await visitante.getByRole('button', { name: 'Enviar código' }).click();
  await expect(visitante.getByText(`Enviamos um código de 6 dígitos para ${email}. Ele vale por 10 minutos.`)).toBeVisible();
  const m = await esperarEmail(email);
  const codigo = /\b(\d{6})\b/.exec(m.assunto)![1];
  expect(m.assunto).toBe(`Seu código para agendar com Consultório E2E: ${codigo}`);
  await visitante.getByLabel('Código').fill(codigo);
  await visitante.getByRole('button', { name: 'Confirmar agendamento' }).click();
  await expect(visitante.getByText(`Consulta marcada para qua., ${br(quarta)} às 16:00 (horário de Brasília). Enviamos a confirmação para o seu e-mail.`)).toBeVisible();
  await esperarEmail(email, { assunto: `Consulta marcada: qua., ${br(quarta)} às 16:00 (horário de Brasília)` });
  await nutri.goto(`/painel/agenda?visao=dia&data=${quarta}`);
  await expect(nutri.getByText('Novo paciente via agendamento online')).toBeVisible();
  await expect(nutri.getByText('Completar cadastro')).toBeVisible();
  await visitante.context().close();
});

test('WhatsApp: tela de conexão mostra o QR (D2)', async () => {
  await nutri.goto('/painel/whatsapp');
  await expect(nutri.getByText('Use, de preferência, um número só do consultório. Os lembretes saem do número conectado.')).toBeVisible();
  // RN-09 / US-036: uso do mês (o número depende do que os outros testes já enviaram)
  await expect(nutri.getByRole('heading', { name: 'Uso do mês' })).toBeVisible();
  await expect(nutri.getByText(/^WhatsApps do mês: \d+ de \d+$/)).toBeVisible();
  await nutri.getByRole('button', { name: 'Conectar WhatsApp' }).click();
  await expect(nutri.getByRole('img', { name: 'QR code para conectar o WhatsApp' })).toBeVisible();
  await expect(nutri.getByRole('button', { name: 'Gerar novo QR code' })).toBeVisible();
});

test('webhook do WhatsApp: sem JWT → 401; conexão "open" pela Evolution → "Conectado ao número" (D4)', async ({ request }) => {
  expect((await request.post('/api/webhooks/whatsapp', { data: { event: 'connection.update' } })).status()).toBe(401);
  const instancia = `nd-${await idDoTenant('e2e-consultorio')}`;
  const r = await webhookAssinado(request, { event: 'connection.update', instance: instancia, data: { instance: instancia, state: 'open', wuid: '5511900001111@s.whatsapp.net' } });
  expect(r.status()).toBe(200);
  await expect(async () => {
    await nutri.goto('/painel/whatsapp');
    await expect(nutri.getByText('Conectado ao número (11) 90000-1111.')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
});

test('lembrete por WhatsApp no sandbox e resposta "1" pelo webhook: "Confirmada via WhatsApp" na agenda (R7, US-035)', async ({ request }) => {
  test.setTimeout(90_000);
  // celular com 9 + 8 dígitos desta execução (finais 0000/9999 são os casos de erro do sandbox)
  const oito = String(Date.now() % 1e8).padStart(8, '0').replace(/(0000|9999)$/, '1234');
  const numero = `55119${oito}`;
  const quinta = somar(SEGUNDA_LIVRE, 3);
  await novoPaciente(`Fabi Zap ${sufixo}`, `fabi-${sufixo}@ex.com`, `(11) 9${oito.slice(0, 4)}-${oito.slice(4)}`);
  await marcar(`Fabi Zap ${sufixo} (fabi-${sufixo}@ex.com)`, quinta, '10:00');
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible();
  const consultaId = /\/painel\/agenda\/consultas\/([0-9a-f-]{36})/.exec(nutri.url())![1];
  const tenantId = await idDoTenant('e2e-consultorio');

  // o lembrete sai pelo sandbox (Mailpit, <número>@whatsapp.sandbox), com o pedido de resposta e SEM link (decisão do
  // dono no fechamento: o número nunca foi verificado — o link assinado da consulta vai só no e-mail)
  await lembreteDeWhatsappAgora(tenantId, consultaId);
  const lembrete = await esperarEmail(`${numero}@whatsapp.sandbox`, { timeoutMs: 45_000 });
  expect(lembrete.texto).toContain(`Olá, Fabi! Lembrete da sua consulta com Consultório E2E: qui., ${br(quinta)} às 10:00 (horário de Brasília), presencial.`);
  expect(lembrete.texto).toContain('Responda 1 para confirmar ou 2 se precisar remarcar.');
  expect(lembrete.texto).not.toMatch(/https?:|\/consulta\//);

  // a paciente responde "1": a Evolution chama o webhook (JWT da instância do consultório)
  const respondidoEm = new Date();
  const r = await webhookAssinado(request, {
    event: 'messages.upsert',
    instance: `nd-${tenantId}`,
    data: { key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: `E2E-${sufixo}` }, pushName: 'Fabi', message: { conversation: '1' }, messageType: 'conversation' },
  });
  expect(r.status()).toBe(200);
  await expect(async () => {
    await nutri.goto(`/painel/agenda?visao=dia&data=${quinta}`);
    await expect(nutri.getByText('Confirmada via WhatsApp')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  // e recebe a resposta automática (uma só)
  await expect.poll(async () => (await esperarEmail(`${numero}@whatsapp.sandbox`, { depoisDe: respondidoEm })).texto, { timeout: 30_000 }).toContain('Presença confirmada. Até lá!');
});

test('convite por WhatsApp no cadastro: aviso sem link, com o e-mail mascarado; o link vai só no e-mail (US-010)', async () => {
  // independente dos outros testes: o estado da conexão é gravado aqui e o celular é desta execução
  const tenantId = await idDoTenant('e2e-consultorio');
  const oito = String(Math.floor(Math.random() * 1e8)).padStart(8, '0').replace(/(0000|9999)$/, '4321'); // 0000/9999 = erros do sandbox
  const email = `gabi-${sufixo}@ex.com`;
  const opcao = () => nutri.getByLabel('Enviar convite por WhatsApp');
  // consultório desconectado: a opção continua (spec), com o aviso de que o convite iria só por e-mail
  await conexaoDoConsultorio(tenantId, 'desconectada');
  await nutri.goto('/painel/pacientes/novo');
  await expect(opcao()).toHaveAccessibleDescription(/O WhatsApp do consultório não está conectado; o convite vai só por e-mail\./);
  await conexaoDoConsultorio(tenantId, 'conectada');
  await nutri.reload();
  await expect(nutri.getByText('O WhatsApp do consultório não está conectado; o convite vai só por e-mail.')).toHaveCount(0);
  await nutri.getByLabel('Nome').fill(`Gabi Whats ${sufixo}`);
  await nutri.getByLabel('Data de nascimento').fill('1990-05-10');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(email);
  await nutri.getByLabel('Telefone (opcional)').fill(`(11) 9${oito.slice(0, 4)}-${oito.slice(4)}`);
  // US-010 "WhatsApp sem autorização": a opção fica desabilitada, e diz por quê
  await expect(opcao()).toBeDisabled();
  await expect(opcao()).toHaveAccessibleDescription('Para enviar o convite por WhatsApp, informe o telefone e marque a autorização.');
  await nutri.getByLabel('Paciente autorizou receber mensagens por WhatsApp').check();
  await opcao().check();
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri).toHaveURL(/\/painel\/pacientes\/[0-9a-f-]{36}$/);
  // o WhatsApp (sandbox → Mailpit) só avisa, com o e-mail mascarado e sem link; o link vai no e-mail
  const msg = await esperarEmail(`55119${oito}@whatsapp.sandbox`);
  expect(msg.texto.trim()).toBe('Olá, Gabi! Consultório E2E convidou você para o NutriDebby. Enviamos o convite para o seu e-mail g***@ex.com (vale por 7 dias).');
  expect(msg.texto).not.toMatch(/https?:|\/convite\//);
  const convite = await esperarEmail(email);
  expect(primeiroLink(convite.texto, '/convite/paciente/')).toMatch(/\/convite\/paciente\/[A-Za-z0-9_-]{43}$/);
  // o worker grava "enviada" logo depois de o sandbox aceitar a mensagem
  await expect(async () => {
    await nutri.reload();
    await expect(nutri.getByText(/^Convite por WhatsApp: enviado em /)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
});

/** Data ('AAAA-MM-DD') e hora ('HH:MM') de um instante no fuso do consultório do E2E. */
function noFusoDoConsultorio(instante: Date): { data: string; hora: string } {
  const fuso = 'America/Sao_Paulo';
  return {
    data: new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(instante),
    hora: new Intl.DateTimeFormat('en-GB', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instante),
  };
}

test('presença: consulta que já começou → "Faltou"; "Iniciar atendimento" → "Realizada"; indicadores no painel (US-037)', async () => {
  // rodada 1: independente dos outros testes — pacientes próprios e horários relativos a agora (no passado, onde
  // nenhum outro teste marca: os outros usam a semana livre/bloqueada daqui a ~30 dias e a quinta seguinte)
  const hana = `Hana Presenca ${sufixo}`;
  const iara = `Iara Presenca ${sufixo}`;
  await novoPaciente(hana, `hana-${sufixo}@ex.com`);
  await novoPaciente(iara, `iara-${sufixo}@ex.com`);
  const minuto = Math.floor(Date.now() / 60_000) * 60_000;
  const faltou = noFusoDoConsultorio(new Date(minuto - 2 * 3_600_000)); // 60 min, terminou há 1 h
  const atendida = noFusoDoConsultorio(new Date(minuto - 4 * 3_600_000)); // 60 min, terminou há 3 h
  await marcar(`${hana} (hana-${sufixo}@ex.com)`, faltou.data, faltou.hora);
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible();
  await nutri.getByRole('button', { name: 'Faltou' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Presença registrada.' })).toBeVisible();
  await expect(nutri.getByRole('list', { name: 'Situação' }).getByText('Faltou')).toBeVisible();
  await marcar(`${iara} (iara-${sufixo}@ex.com)`, atendida.data, atendida.hora);
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible();
  const urlDaConsulta = nutri.url().split('?')[0];
  await nutri.getByRole('link', { name: 'Iniciar atendimento' }).click();
  await expect(nutri.getByText(/^Atendimento da consulta de /)).toBeVisible();
  await expect(nutri.getByLabel('Data do atendimento')).toHaveValue(atendida.data);
  await nutri.getByRole('button', { name: 'Registrar atendimento' }).click();
  await expect(nutri).toHaveURL(/\/atendimentos\/[0-9a-f-]{36}$/);
  await nutri.goto(urlDaConsulta);
  await expect(nutri.getByRole('list', { name: 'Situação' }).getByText('Realizada')).toBeVisible();
  await expect(nutri.getByRole('link', { name: 'Iniciar atendimento' })).toHaveCount(0); // já tem atendimento
  // "Faltou" com atendimento registrado é recusado (rodada 1)
  await nutri.getByRole('button', { name: 'Faltou' }).click();
  await expect(nutri.getByRole('alert').filter({ hasText: 'Esta consulta tem um atendimento registrado.' })).toBeVisible();
  await nutri.goto('/painel');
  await expect(nutri.getByRole('heading', { name: 'Agenda' })).toBeVisible();
  await expect(nutri.getByText(/^Consultas do mês: \d+$/)).toBeVisible();
  await expect(nutri.getByText(/^Taxa de faltas do mês: (\d+,\d% \(\d+ de \d+\)|Sem dados)$/)).toBeVisible();
  await expect(nutri.getByText(/^Mês anterior: (\d+,\d%|Sem dados)$/)).toBeVisible();
});
