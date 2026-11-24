import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo, ESPERA_DO_SERVIDOR } from './helpers';
import { criarPacientePeloFormulario } from './pacientes-form';
import { escolherTema, irPeloMenu } from './painel';

/**
 * Plano 20 — Financeiro do consultório (CS-300; US-300, US-303 a US-306). Conta `E2E_FIN_NOVO` da semente: um consultório
 * NOVO a cada `pnpm e2e:seed`, sem Financeiro (a linha de fin_configuracoes não se apaga), então o primeiro acesso é
 * repetível e as asserções valem só para o que esta execução cria — nunca para os totais do consultório do E2E. O tema é
 * da conta (D17): esta spec só troca o da E2E_FIN_NOVO, nunca o da nutricionista compartilhada.
 * IPs (limite de login por IP): bloco 10.9.20.x (sufixo = número do plano, decisão da orquestradora) — 10.9.20.1 aqui;
 * 10.9.20.2 é a E2E_FIN_AXE do acessibilidade-painel.spec.
 */
const FIN_NOVO = { email: 'fin-novo-e2e@nutridebby.test', senha: 'Nutri2026segura' }; // copiada: importar o seed roda o seed
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FUSO = 'America/Sao_Paulo'; // o fuso padrão do consultório (tenants.fuso)
// Serial e sem nova tentativa: o primeiro acesso só acontece uma vez por semente, e cada teste usa o que o anterior criou
test.describe.configure({ mode: 'serial', retries: 0 });

let nutri: Page;
const sufixo = Date.now().toString(36);
const paciente = { nome: `Bia Financeiro ${sufixo}`, email: `bia-fin-${sufixo}@nutridebby.test` };

/** Data ('AAAA-MM-DD') e hora ('HH:MM') de um instante no fuso do consultório. */
function noFuso(instante: Date): { data: string; hora: string } {
  return {
    data: new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(instante),
    hora: new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instante),
  };
}
const br = (iso: string) => iso.split('-').reverse().join('/');
const somarDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

async function violacoes(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  const contrasteIncerto = r.incomplete.filter((i) => i.id === 'color-contrast').flatMap((i) => i.nodes.map((n) => `incompleto color-contrast: ${n.target.join(' ')}`));
  return [...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), ...contrasteIncerto];
}

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, FIN_NOVO.email, FIN_NOVO.senha, '10.9.20.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  if (nutri) await escolherTema(nutri, 'Igual ao aparelho'); // a semente e as outras specs esperam o padrão
  await nutri?.context().close();
});

test('primeiro acesso: "Comece por aqui" → Configurações → Resumo com o saldo do caixa (US-300)', async () => {
  await irPeloMenu(nutri, 'Financeiro'); // RN-327: o item existe antes de configurar
  await expect(nutri.getByRole('heading', { level: 1, name: 'Financeiro' })).toBeVisible();
  await expect(nutri.getByRole('heading', { name: 'Comece por aqui' })).toBeVisible();
  await expect(
    nutri.getByText('Informe quanto há no caixa do consultório numa data e o valor da sua consulta. Depois disso, cada consulta marcada como Realizada gera a cobrança sozinha.'),
  ).toBeVisible();
  await expect(nutri.getByRole('link', { name: 'Nova entrada' })).toHaveCount(0);
  await expect(nutri.getByRole('link', { name: 'Nova saída' })).toHaveCount(0);

  await nutri.getByRole('link', { name: 'Configurar o Financeiro' }).click();
  await expect(nutri.getByRole('heading', { level: 1, name: 'Configurações do Financeiro' })).toBeVisible();
  const hoje = noFuso(new Date()).data;
  await expect(nutri.getByLabel('Data do saldo')).toHaveValue(hoje); // sugerida: hoje no fuso do consultório
  await nutri.getByLabel('Valor do saldo').fill('1.500,00');
  // a seção também se chama "Valor da consulta" (aria-labelledby): o campo pelo papel
  await nutri.getByRole('textbox', { name: 'Valor da consulta' }).fill('250,00');
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Configurações salvas.' })).toBeVisible();
  // RN-302: as categorias iniciais nascem na primeira gravação, com "Consultas" entre as de entrada
  await expect(nutri.getByRole('heading', { name: 'Categorias' })).toBeVisible();
  await expect(nutri.getByText('Consultas', { exact: true }).first()).toBeVisible();

  await nutri.getByRole('navigation', { name: 'Seções do Financeiro' }).getByRole('link', { name: 'Resumo' }).click();
  const saldo = nutri.getByRole('region', { name: 'Saldo atual' });
  await expect(saldo).toContainText('R$ 1.500,00');
  await expect(saldo).toContainText(`Desde o saldo de ${br(hoje)}`);
  await expect(nutri.getByRole('link', { name: 'Nova entrada' })).toBeVisible();
  await expect(nutri.getByText('O valor da consulta não está configurado', { exact: false })).toHaveCount(0);
});

test('da consulta realizada ao recebido na mesma tela, sem digitar o valor; sai das pendências e entra no Resumo (CS-300, US-303 a US-305)', async () => {
  test.setTimeout(180_000);
  const prontuario = await criarPacientePeloFormulario(nutri, paciente);
  const patientId = prontuario.split('/').pop()!;
  // uma consulta que já começou (60 min, começou há 90 min): só ela neste consultório novo, sem colisão com outras specs
  const inicio = noFuso(new Date(Math.floor(Date.now() / 60_000) * 60_000 - 90 * 60_000));
  await nutri.goto(`/painel/agenda/nova?data=${inicio.data}`);
  await nutri.getByLabel('Paciente').selectOption({ label: `${paciente.nome} (${paciente.email})` });
  await nutri.getByLabel('Hora').fill(inicio.hora);
  await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible({ timeout: ESPERA_DO_SERVIDOR });
  const consulta = new URL(nutri.url()).pathname;

  await nutri.getByRole('button', { name: 'Realizada' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Presença registrada. Cobrança de R$ 250,00 criada no Financeiro.' })).toBeVisible();
  const cobranca = nutri.getByRole('region', { name: 'Cobrança' });
  // vencimento = a data da consulta: "Previsto" no mesmo dia, "Em atraso" se a consulta começou ontem (perto da meia-noite)
  await expect(cobranca.getByText(/^R\$\s250,00 · (Previsto|Em atraso)$/)).toBeVisible();
  await expect(cobranca.getByLabel('Valor', { exact: true })).toHaveValue('250,00'); // o valor da consulta configurado, sem digitar

  // US-304: antes de receber, o paciente está em "Pagamentos pendentes"
  await nutri.goto('/painel/financeiro/pendencias');
  await expect(nutri.getByText('Cobranças de pacientes ainda não recebidas. Esta lista é só sua: nada é enviado ao paciente.')).toBeVisible();
  await expect(nutri.getByRole('row').filter({ hasText: paciente.nome })).toContainText('R$ 250,00');

  // US-303 "Receber na hora": na própria tela da consulta, a data de hoje e "Pix"
  await nutri.goto(consulta);
  await cobranca.getByRole('button', { name: 'Marcar como recebido' }).click();
  const hoje = noFuso(new Date()).data;
  await expect(cobranca.getByLabel('Data do recebimento')).toHaveValue(hoje);
  await cobranca.getByLabel('Forma de pagamento').selectOption({ label: 'Pix' });
  await cobranca.getByRole('button', { name: 'Confirmar o recebimento' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Recebimento registrado.' })).toBeVisible();
  await expect(cobranca.getByText(`R$ 250,00 · Recebido em ${br(hoje)} · Pix`)).toBeVisible();

  // RNF-302: a seção "Cobrança" com a cobrança em aberto e o painel de receber aberto não é tela de ROTAS_DO_PAINEL —
  // o axe dela vai aqui, nos dois temas, a 1280 e a 360 px, numa segunda consulta (a primeira já foi recebida)
  const segunda = noFuso(new Date(Math.floor(Date.now() / 60_000) * 60_000 - 4 * 3_600_000));
  await nutri.goto(`/painel/agenda/nova?data=${segunda.data}`);
  await nutri.getByLabel('Paciente').selectOption({ label: `${paciente.nome} (${paciente.email})` });
  await nutri.getByLabel('Hora').fill(segunda.hora);
  await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible({ timeout: ESPERA_DO_SERVIDOR });
  const consultaAberta = new URL(nutri.url()).pathname;
  await nutri.getByRole('button', { name: 'Realizada' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Presença registrada. Cobrança de R$ 250,00 criada no Financeiro.' })).toBeVisible();
  const falhas: string[] = [];
  for (const tema of ['Claro', 'Escuro'] as const) {
    await escolherTema(nutri, tema);
    for (const largura of [1280, 360]) {
      await nutri.setViewportSize({ width: largura, height: largura === 360 ? 780 : 720 });
      await nutri.goto(consultaAberta);
      await cobranca.getByRole('button', { name: 'Marcar como recebido' }).click();
      await expect(cobranca.getByLabel('Forma de pagamento')).toBeVisible();
      await nutri.waitForLoadState('networkidle');
      for (const v of await violacoes(nutri)) falhas.push(`${tema} ${largura} px — ${v}`);
      if (largura === 360) {
        // só a seção do Financeiro (o resto da tela da consulta é da agenda): nada dela passa da largura da tela. Não compara
        // com a largura da própria seção: a faixa de ações usa `-mx-2` (o texto do link alinhado à margem, como nas outras
        // telas do Financeiro) e passa 8 px da seção de propósito, dentro do respiro da página
        const cabe = await cobranca.evaluate((el) =>
          [el, ...el.querySelectorAll('*')].every((n) => n.getBoundingClientRect().right <= window.innerWidth && n.getBoundingClientRect().left >= 0),
        );
        expect(cabe, `${tema}: a seção "Cobrança" passa da largura a 360 px`).toBe(true);
      }
    }
    await nutri.setViewportSize({ width: 1280, height: 720 });
  }
  expect(falhas).toEqual([]); // o tema volta a "Igual ao aparelho" no afterAll
  // a segunda cobrança sai do caminho: cancelada, para o paciente sair das pendências só pelo recebimento acima
  await nutri.goto(consultaAberta);
  await cobranca.getByRole('button', { name: 'Cancelar lançamento' }).click();
  await cobranca.getByLabel('Motivo do cancelamento').fill('Consulta de teste do E2E');
  await cobranca.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Lançamento cancelado.' })).toBeVisible();

  // US-304: recebida (e a outra cancelada), o paciente sai de "Pagamentos pendentes"; o detalhe dele fica vazio
  await nutri.goto('/painel/financeiro/pendencias');
  await expect(nutri.getByRole('heading', { level: 1, name: 'Pagamentos pendentes' })).toBeVisible();
  await expect(nutri.getByRole('row').filter({ hasText: paciente.nome })).toHaveCount(0);
  await nutri.goto(`/painel/financeiro/pendencias/${patientId}`);
  await expect(nutri.getByText(`Nenhum pagamento pendente de ${paciente.nome}.`)).toBeVisible();
  await expect(nutri.getByRole('link', { name: 'Voltar aos pagamentos pendentes' })).toBeVisible();

  // US-305: o Resumo mostra o lançamento recebido em "Últimos lançamentos"
  await nutri.goto('/painel/financeiro');
  const ultimos = nutri.getByRole('region', { name: 'Últimos lançamentos' });
  await expect(ultimos.getByRole('listitem').filter({ hasText: paciente.nome }).filter({ hasText: 'Recebido' })).toContainText('R$ 250,00 · Recebido');
});

test('CSV dos lançamentos: 13 meses mostram o alerta sem baixar; 1 mês baixa o arquivo sem a coluna Paciente (US-306)', async () => {
  await nutri.goto('/painel/financeiro/relatorios');
  const de = nutri.getByLabel('De', { exact: true });
  const ate = nutri.getByLabel('Até', { exact: true });
  const fimDoMes = await ate.inputValue();
  let baixou = false;
  const marcarDownload = () => {
    baixou = true;
  };
  nutri.on('download', marcarDownload);
  await de.fill(somarDias(fimDoMes, -395)); // ~13 meses: passa dos 366 dias
  await nutri.getByRole('button', { name: 'Baixar CSV' }).click();
  // o anunciador de rota do Next também tem role="alert": filtra pelo texto
  await expect(nutri.getByRole('alert').filter({ hasText: 'Escolha um período de até 12 meses.' })).toBeVisible();
  await expect(ate).toBeFocused();
  await expect(nutri).toHaveURL(/\/painel\/financeiro\/relatorios$/);
  nutri.off('download', marcarDownload);
  expect(baixou, 'nenhum download começa com o período longo').toBe(false);

  await nutri.reload(); // de volta ao mês atual (o padrão: 1 mês)
  const periodo = { de: await de.inputValue(), ate: await ate.inputValue() };
  const [download] = await Promise.all([nutri.waitForEvent('download'), nutri.getByRole('button', { name: 'Baixar CSV' }).click()]);
  expect(download.suggestedFilename()).toBe(`lancamentos-${periodo.de}-a-${periodo.ate}.csv`);
  const csv = await readFile((await download.path())!, 'utf8');
  // RN-321: BOM, ";" e CRLF; sem "Incluir o nome dos pacientes", sem a coluna Paciente e sem o nome em lugar nenhum
  expect(csv.startsWith('﻿Vencimento;Pagamento;Tipo;Categoria;Descrição;Forma de pagamento;Valor;Situação\r\n')).toBe(true);
  expect(csv).toContain(`;${br(noFuso(new Date()).data)};Entrada;Consultas;;Pix;250,00;Recebido\r\n`);
  expect(csv).not.toContain(paciente.nome);
});
