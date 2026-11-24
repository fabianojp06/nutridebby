import { expect, test, type Page } from '@playwright/test';
import { entrarComo, painelNoComputador } from './helpers';
import { marcarParaPaciente, pacienteNoPortal, publicarPlanoDoDia } from './portal';

// Plano 16 (CS-190): toda função do portal de antes do layout G é alcançável a partir de Hoje no número de toques da
// tabela "nada some" da §4.10 da spec (o dado deste teste; ≤ 2, e 3 só nas linhas do Desvio 16). O consultório do E2E tem
// documentos liberados e o recebimento de exames ligado (scripts/e2e-seed.ts). IPs (bloco da execução do Plano 16, o mesmo
// do app-paciente.spec; o limite de login é por IP e o seed o zera): 10.9.19.76 (nutricionista), 10.9.19.77 (paciente, sem
// login: entra pelo convite) e 10.9.19.78 (conta MULTI). O conteúdo de dentro das telas que dependem de dado que o E2E não cria
// (a "Sugestão de receita" na refeição aberta, a "Orientação da sua nutricionista" na Jornada) é coberto pelos testes de
// componente (T11 `RefeicaoDetalhe`, T12 `jornada/page.test.ts`); aqui o teste mede o caminho até a tela que os mostra.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const MULTI = { email: 'multi-e2e@nutridebby.test', senha: 'Multi2026segura' }; // scripts/e2e-seed.ts: 3 consultórios
type Toque = { nome: string; em?: 'Seções' | 'Ações'; papel?: 'link' | 'button' };
type Caminho = { funcao: string; toques: [Toque] | [Toque, Toque] | [Toque, Toque, Toque]; destino?: RegExp; ve?: { papel: 'link' | 'button' | 'heading'; nome: string } };

const CAMINHOS: Caminho[] = [
  { funcao: 'Diário completo (histórico, foto, comentário)', toques: [{ nome: 'Ver todo o diário' }], destino: /\/p\/diario$/ },
  { funcao: 'Registrar refeição com foto', toques: [{ nome: 'Foto da refeição', em: 'Ações' }], destino: /\/p\/diario\?foto=1/ },
  { funcao: 'Refeição aberta (e a sugestão de receita dela)', toques: [{ nome: 'Ver a refeição' }], destino: /\/p\/plano\/refeicao\/[0-9a-f-]{36}$/ },
  { funcao: 'Enviar exame', toques: [{ nome: 'Enviar exame', em: 'Ações' }], destino: /\/p\/exames(#enviar)?$/ },
  { funcao: 'Agendar consulta', toques: [{ nome: 'Agendar', em: 'Ações' }], destino: /\/p\/agenda(\/nova)?$/ },
  { funcao: 'Jornada (medidas por consulta, orientações recebidas)', toques: [{ nome: 'Jornada', em: 'Seções' }], destino: /\/p\/jornada$/ },
  { funcao: 'Confirmar presença, cancelar, remarcar (próxima consulta)', toques: [{ nome: 'Jornada', em: 'Seções' }, { nome: 'Ver a consulta' }], destino: /\/p\/agenda\/[0-9a-f-]{36}$/, ve: { papel: 'button', nome: 'Confirmar presença' } },
  { funcao: 'Todas as medidas', toques: [{ nome: 'Jornada', em: 'Seções' }, { nome: 'Todas as medidas' }], destino: /\/p\/evolucao$/ },
  { funcao: 'Minhas consultas', toques: [{ nome: 'Jornada', em: 'Seções' }, { nome: 'Minhas consultas' }], destino: /\/p\/agenda$/ },
  { funcao: 'Plano do dia e orientações', toques: [{ nome: 'Plano', em: 'Seções' }], destino: /\/p\/plano$/ },
  { funcao: 'Baixar PDF do plano', toques: [{ nome: 'Plano', em: 'Seções' }], ve: { papel: 'link', nome: 'Baixar PDF' } },
  { funcao: 'Lista de compras', toques: [{ nome: 'Plano', em: 'Seções' }, { nome: 'Lista de compras' }], destino: /\/p\/compras/ },
  { funcao: 'Conteúdos', toques: [{ nome: 'Plano', em: 'Seções' }, { nome: 'Conteúdos' }], destino: /\/p\/conteudos$/ },
  // Plano 15 (§4.2, D29): a conversa com a IA Nutri mora em Plano (a paciente deste spec foi liberada e autorizou no beforeAll)
  { funcao: 'IA Nutri (tirar dúvida sobre o plano)', toques: [{ nome: 'Plano', em: 'Seções' }, { nome: 'Tirar dúvida sobre o plano' }], destino: /\/p\/plano\/ia$/, ve: { papel: 'heading', nome: 'IA Nutri' } },
  { funcao: 'Meus exames', toques: [{ nome: 'Exames', em: 'Seções' }], destino: /\/p\/exames$/ },
  { funcao: 'Conectado como', toques: [{ nome: 'Eu', em: 'Seções' }], ve: { papel: 'heading', nome: 'Conta' } }, // e o e-mail: teste próprio abaixo
  { funcao: 'Meus documentos', toques: [{ nome: 'Eu', em: 'Seções' }, { nome: 'Ver meus documentos' }], destino: /\/p\/documentos$/ },
  { funcao: 'Notificações e WhatsApp', toques: [{ nome: 'Eu', em: 'Seções' }], ve: { papel: 'heading', nome: 'Notificações' } },
  { funcao: 'Privacidade (baixar, pedir exclusão)', toques: [{ nome: 'Eu', em: 'Seções' }], ve: { papel: 'button', nome: 'Baixar meus dados' } },
  { funcao: 'Como usar o app', toques: [{ nome: 'Eu', em: 'Seções' }, { nome: 'Como usar o app' }], destino: /\/p\/ajuda$/ },
  { funcao: 'Sair', toques: [{ nome: 'Eu', em: 'Seções' }], ve: { papel: 'button', nome: 'Sair' } },
];

let nutri: Page;
let paciente: Awaited<ReturnType<typeof pacienteNoPortal>>;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.19.76', painelNoComputador(browser));
  await expect(nutri).toHaveURL(/\/painel$/);
  paciente = await pacienteNoPortal(browser, nutri, '10.9.19.77');
  await publicarPlanoDoDia(nutri, paciente.prontuario);
  await marcarParaPaciente(nutri, paciente.nome, paciente.email, -1); // a próxima consulta (Jornada › "Ver a consulta"); semana −1: só deste spec (R16)
  // Plano 15: a IA Nutri (ativada no consultório do E2E pelo seed) liberada na ficha e autorizada pela paciente
  await nutri.goto(`${paciente.prontuario}/ia-nutri`);
  await nutri.getByLabel('Liberar a IA Nutri para este paciente').check();
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'IA Nutri: liberada' })).toBeVisible();
  await paciente.page.goto('/p/plano/ia/autorizar?de=plano');
  await paciente.page.getByRole('button', { name: 'Autorizo o uso da IA Nutri' }).click();
  await expect(paciente.page).toHaveURL(/\/p\/plano\/ia$/);
});
test.afterAll(async () => {
  await paciente?.page.context().close();
  await nutri?.context().close();
});

for (const c of CAMINHOS) {
  test(`nada some: ${c.funcao} em ${c.toques.length} toque(s) a partir de Hoje`, async () => {
    const page = paciente.page;
    await page.goto('/p/inicio');
    for (const t of c.toques) {
      const raiz = t.em ? page.getByRole('navigation', { name: t.em }) : page.getByRole('main');
      await raiz.getByRole(t.papel ?? 'link', { name: t.nome, exact: true }).first().click();
    }
    if (c.destino) await expect(page).toHaveURL(c.destino);
    if (c.ve) await expect(page.getByRole(c.ve.papel, { name: c.ve.nome, exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '404' })).toHaveCount(0);
  });
}

test('"Conectado como {e-mail}" em Eu (§4.10)', async () => {
  await paciente.page.goto('/p/inicio');
  await paciente.page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Eu', exact: true }).click();
  await expect(paciente.page.getByText(paciente.email)).toBeVisible();
});

test('"Trocar de nutricionista" (2+ vínculos) em Eu, a 1 toque de Hoje (§4.10)', async ({ browser }) => {
  const page = await entrarComo(browser, MULTI.email, MULTI.senha, '10.9.19.78');
  await expect(page).toHaveURL(/\/p\/escolher/);
  await page.getByRole('main').getByRole('button').first().click(); // o primeiro consultório da lista (o "Sair" fica no cabeçalho, fora do main)
  await expect(page).toHaveURL(/\/p\/inicio$/);
  await page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: 'Eu', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Trocar de nutricionista' })).toBeVisible();
  await page.context().close();
});

test('as rotas antigas continuam (C-195): os destinos do push e do e-mail abrem; seção marcada nas seções e "Voltar para {seção}" nos detalhes (Desvio 14)', async () => {
  const page = paciente.page;
  // [rota, seção da nav marcada | null, nome do "Voltar" nas telas de detalhe]
  const secoes: [string, string | null, string | null][] = [
    ['/p/diario', null, 'Voltar para Hoje'],
    ['/p/plano', 'Plano', null],
    ['/p/plano/ia', null, 'Voltar para Plano'], // Plano 15: a conversa é tela de detalhe de Plano (a seção fica marcada para quem volta)
    ['/p/conteudos', null, 'Voltar para Plano'],
    ['/p/compras', null, 'Voltar para Plano'],
    ['/p/documentos', null, 'Voltar para Eu'],
    ['/p/exames', 'Exames', null],
    ['/p/evolucao', null, 'Voltar para Jornada'],
    ['/p/agenda', null, 'Voltar para Jornada'],
    ['/p/perfil', 'Eu', null],
  ];
  for (const [rota, secao, voltar] of secoes) {
    await page.goto(rota);
    await expect(page, rota).toHaveURL(new RegExp(`${rota.replace(/\//g, '\\/')}$`));
    await expect(page.getByRole('heading', { level: 1 }), rota).toBeVisible();
    if (secao) await expect(page.getByRole('navigation', { name: 'Seções' }).getByRole('link', { name: secao }), rota).toHaveAttribute('aria-current', 'page');
    if (voltar) await expect(page.getByRole('banner').getByRole('link', { name: voltar, exact: true }), rota).toBeVisible();
  }
});
