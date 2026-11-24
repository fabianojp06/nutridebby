import type AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import type { IdsDoPainel } from './painel-rotas';
import { entrarComo, ESPERA_DO_SERVIDOR } from './helpers';
import { avaliar, marcarParaPaciente, pacienteNoPortal, publicarPlanoSimples } from './portal';

type IncompletoDoAxe = Awaited<ReturnType<AxeBuilder['analyze']>>['incomplete'][number];

/**
 * Plano 22: os "incomplete" do color-contrast que continuam valendo como falha (alvo do axe de cada um). Saem só dois
 * casos que o axe não sabe resolver e que aqui são conferidos de outro jeito:
 * - `elmPartiallyObscuring` dentro de `dialog[open]`: o axe não entende a camada de cima (top layer) do diálogo modal e
 *   acha que a página por baixo encobre o texto. Sai só se `elementsFromPoint` achar o próprio elemento (ou um filho)
 *   por cima perto dos quatro cantos e no centro.
 * - `imgNode` em `text` de `svg[role="img"]` (gráfico da evolução, que aparece com os exames lançados na preparação):
 *   o axe não mede texto dentro de imagem. Sai só se o texto pinta com a cor do texto em volta do gráfico (`fill`
 *   calculado igual ao `color` do pai do svg, texto que o axe confere no mesmo fundo) e o svg não tem fundo próprio.
 * Com `ignorarForaDaTela` (telas a menos de 1280 px, como no axe do painel do Plano 18): sai também o que não cabe inteiro
 * na largura da tela (abas da ficha e tabelas que rolam na horizontal); o que aparece inteiro continua conferido.
 */
export async function contrasteIncerto(page: Page, incompletos: IncompletoDoAxe[], opcoes: { ignorarForaDaTela?: boolean } = {}): Promise<string[]> {
  const nos = incompletos
    .filter((i) => i.id === 'color-contrast')
    .flatMap((i) => i.nodes.map((n) => ({ alvo: n.target.join(' '), motivo: String((n.any[0]?.data as { messageKey?: string } | undefined)?.messageKey ?? '') })));
  const conferidos = await page.evaluate(({ lista, foraDaTela }) => lista.map(({ alvo, motivo }) => {
    const el = document.querySelector(alvo);
    if (!el) return false;
    if (foraDaTela) {
      const r = el.getBoundingClientRect();
      if (r.left < 0 || r.right > window.innerWidth) return true;
    }
    if (motivo === 'elmPartiallyObscuring' && el.closest('dialog[open]')) {
      const r = el.getBoundingClientRect();
      // 8 px para dentro (ou até o meio): o canto exato de um aviso `rounded-2xl` fica fora da borda arredondada
      const dx = Math.min(8, r.width / 2);
      const dy = Math.min(8, r.height / 2);
      const pontos = [[r.left + dx, r.top + dy], [r.right - dx, r.top + dy], [r.left + dx, r.bottom - dy], [r.right - dx, r.bottom - dy], [r.left + r.width / 2, r.top + r.height / 2]];
      return r.width > 0 && pontos.every(([x, y]) => { const topo = document.elementFromPoint(x, y); return !!topo && (topo === el || el.contains(topo)); });
    }
    const svg = el.closest('svg[role="img"]');
    if (motivo === 'imgNode' && el.tagName.toLowerCase() === 'text' && svg?.parentElement) {
      const fundo = getComputedStyle(svg).backgroundColor;
      return getComputedStyle(el).fill === getComputedStyle(svg.parentElement).color && (fundo === 'rgba(0, 0, 0, 0)' || fundo === 'transparent');
    }
    return false;
  }), { lista: nos, foraDaTela: !!opcoes.ignorarForaDaTela });
  return nos.filter((_, i) => !conferidos[i]).map((n) => n.alvo);
}

/** D17: grava o tema pela tela de Configurações (o caminho real da usuária). */
export async function escolherTema(page: Page, rotulo: 'Claro' | 'Escuro' | 'Igual ao aparelho'): Promise<void> {
  await page.goto('/painel/configuracoes');
  await page.getByRole('radio', { name: rotulo }).check();
  await page.getByRole('button', { name: 'Salvar tema' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tema salvo.' })).toBeVisible();
}

/** D20: os itens fixos do topo (Plano 20: com "Financeiro"; Plano 26: com "Relatórios"). */
export async function irPeloMenu(page: Page, item: 'Início' | 'Pacientes' | 'Agenda' | 'Diários' | 'Conteúdos' | 'Financeiro' | 'Relatórios' | 'Configurações'): Promise<void> {
  await page.getByRole('navigation', { name: 'Menu do painel' }).getByRole('link', { name: item, exact: true }).click();
}

const UUID = '[0-9a-f-]{36}';

/** O último segmento do primeiro link da página `lista` que casa com `padrao` (falha com a lista no texto). */
async function idDoLink(page: Page, lista: string, padrao: RegExp): Promise<string> {
  await page.goto(lista);
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  const href = hrefs.find((h) => padrao.test(h.split('?')[0]));
  expect(href, `${lista}: nenhum link casa com ${padrao}`).toBeDefined();
  return padrao.exec(href!.split('?')[0])![1];
}

/** O id no fim da URL atual (a tela acabou de criar a linha e redirecionou para ela). */
function idDaUrl(page: Page, padrao: RegExp): string {
  const m = padrao.exec(new URL(page.url()).pathname);
  expect(m, `a URL ${page.url()} não casa com ${padrao}`).not.toBeNull();
  return m![1];
}

/**
 * Plano 15: a SEGUNDA paciente da IA Nutri do seed (scripts/e2e-seed.ts, T13): com conta, liberada, com o consentimento e
 * 10 perguntas de hoje (o seed apaga as mensagens dela a cada execução). A primeira autoriza pela UI no ia-nutri-paciente.spec.
 */
export const IA_NUTRI_2 = { email: 'ia-nutri-2-e2e@nutridebby.test', senha: 'Nutri2026segura', nome: 'Paciente IA Nutri Dois' };

/**
 * Plano 15 (US-175, DP-16): uma dúvida direta da segunda paciente — no portal, a pergunta e "Enviar direto para minha
 * nutricionista" (sem o worker) — e o id dela na fila do painel. A linha é localizada pelo NOME da paciente, nunca "a
 * primeira": a fila põe o risco no topo e o ia-nutri-paciente.spec deixa mensagens de risco da primeira paciente. Abrir essa
 * dúvida no axe grava `aberta_pela_nutri_em` e não apaga nada (dúvida direta, sem risco).
 * SUS-125: se a fila já tem uma dúvida dela (a outra parte do acessibilidade-painel, a tentativa anterior do CI ou o
 * ia-nutri-paciente.spec, que também só envia direto), usa essa: a paciente tem no máximo 3 dúvidas abertas
 * (`LIMITE_DUVIDAS_ABERTAS`), e cada envio a mais gastaria uma.
 */
async function duvidaDiretaDaSegunda(browser: Browser, nutri: Page, ip: string): Promise<string> {
  const abrir = nutri.getByRole('row').filter({ hasText: IA_NUTRI_2.nome }).getByRole('link', { name: /^Abrir dúvida/ }).first();
  await nutri.goto('/painel/duvidas');
  if (!(await abrir.count())) {
    const p = await entrarComo(browser, IA_NUTRI_2.email, IA_NUTRI_2.senha, ip);
    await expect(p).toHaveURL(/\/p\//, { timeout: ESPERA_DO_SERVIDOR });
    await p.goto('/p/plano/ia');
    await p.getByLabel('Sua dúvida').fill(`Posso trocar a banana do lanche? ${Date.now().toString(36)}`);
    await p.getByRole('button', { name: 'Enviar direto para minha nutricionista' }).click();
    await expect(p.getByRole('status').filter({ hasText: 'Pronto! Sua pergunta foi enviada ao consultório.' })).toBeVisible({ timeout: ESPERA_DO_SERVIDOR });
    await p.context().close();
    await nutri.goto('/painel/duvidas');
  }
  const href = await abrir.getAttribute('href');
  const m = new RegExp(`^/painel/duvidas/(${UUID})$`).exec(href ?? '');
  expect(m, `link "Abrir dúvida" da ${IA_NUTRI_2.nome}: ${href}`).not.toBeNull();
  return m![1];
}

/**
 * D25: cria um paciente e uma linha de cada tela com parâmetro — plano (publicarPlanoSimples), consulta
 * (marcarParaPaciente), avaliação, anamnese, atendimento, alimento próprio, modelo de anamnese, modelo de plano
 * ("Salvar como modelo" do editor), registro no diário (pelo portal, com o paciente), exportação ("Exportar dados" em
 * Privacidade; a tela abre "em preparo" sem o worker), conteúdo (Plano 07), receita (Plano 10A, rascunho), lançamento do
 * paciente (Plano 20, "Nova entrada"), exame enviado pelo paciente (Plano 12, na fila depois do worker) e dúvida da IA Nutri
 * (Plano 15, a segunda paciente do seed) — e devolve os ids.
 * `ip`: o IP só do paciente (o limite de login é por IP); `ipIaNutri`: o da segunda paciente da IA Nutri; `parte`: a parte
 * do acessibilidade-painel que prepara (SUS-125: as duas preparam ao mesmo tempo, cada uma com as suas linhas).
 */
export async function prepararTelasComId(browser: Browser, nutri: Page, ip: string, ipIaNutri: string, parte: 0 | 1): Promise<IdsDoPainel> {
  const sufixo = `${Date.now().toString(36)}p${parte}`; // SUS-125: as duas partes preparam ao mesmo tempo (nomes únicos no consultório)
  const paciente = await pacienteNoPortal(browser, nutri, ip);
  const p = paciente.prontuario;

  await publicarPlanoSimples(nutri, p);
  const plano = idDaUrl(nutri, new RegExp(`/plano-alimentar/(${UUID})$`));
  // modelo de plano: o plano publicado é só de leitura; "Editar" abre a versão 2 (rascunho), de onde sai o modelo
  await nutri.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(nutri.getByRole('heading', { name: /Plano alimentar — versão 2/ })).toBeVisible();
  await nutri.getByLabel('Nome do modelo').fill(`Modelo axe ${sufixo}`);
  await nutri.getByRole('button', { name: 'Salvar como modelo' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Modelo salvo.' })).toBeVisible();

  // semana ≥ 2 (portal.spec usa 0, acessibilidade.spec 1) e variável por execução: o seed não apaga consultas, e repetir o
  // mesmo dia e hora da execução anterior dá "Conflito com a consulta de …". SUS-125: cada parte do acessibilidade-painel
  // no seu bloco de 50 semanas (parte 0: 2 a 51; parte 1: 52 a 101; a mesma semana só se repete depois de 50 min) — as duas
  // começam no mesmo minuto, e a hora sai de um contador do módulo, que recomeça em cada worker
  await marcarParaPaciente(nutri, paciente.nome, paciente.email, 2 + 50 * parte + (Math.floor(Date.now() / 60_000) % 50));
  const consulta = idDaUrl(nutri, new RegExp(`/painel/agenda/consultas/(${UUID})$`));
  await avaliar(nutri, p, '2026-08-01', '80');

  // modelo de anamnese (uma pergunta opcional) e a anamnese preenchida com ele
  const nomeModelo = `Triagem axe ${sufixo}`;
  await nutri.goto('/painel/anamnese/modelos/novo');
  await nutri.getByLabel('Nome do modelo').fill(nomeModelo);
  await nutri.getByLabel('Texto da pergunta 1').fill('Alergias');
  await nutri.getByRole('button', { name: 'Salvar modelo' }).click();
  await expect(nutri).toHaveURL(/\/painel\/anamnese\/modelos$/);
  await nutri.goto(`${p}/anamnese`);
  await nutri.getByLabel('Modelo').selectOption({ label: nomeModelo });
  await nutri.getByRole('button', { name: 'Preencher anamnese' }).click();
  await nutri.getByLabel('Alergias').fill('Lactose');
  await nutri.getByRole('button', { name: 'Salvar anamnese' }).click();
  await expect(nutri.getByRole('heading', { name: new RegExp(`^${nomeModelo} · `) })).toBeVisible();

  // atendimento (a data inicial é hoje)
  await nutri.goto(`${p}/atendimentos`);
  await nutri.getByRole('button', { name: 'Registrar atendimento' }).click();
  await expect(nutri).toHaveURL(/\/atendimentos\/[0-9a-f-]{36}(\?.*)?$/);

  // alimento próprio
  await nutri.goto('/painel/alimentos/novo');
  await nutri.getByLabel('Nome').fill(`Pão axe ${sufixo}`);
  await nutri.getByLabel('Grupo').selectOption('Cereais e derivados');
  await nutri.getByLabel('Energia (kcal)').fill('250');
  await nutri.getByLabel('Proteína (g)').fill('12');
  await nutri.getByLabel('Carboidrato (g)').fill('8');
  await nutri.getByLabel('Lipídio (g)').fill('18');
  await nutri.getByLabel('Fibra (g)').fill('6');
  await nutri.getByRole('button', { name: 'Salvar alimento' }).click();
  await expect(nutri.getByRole('heading', { name: `Pão axe ${sufixo}` })).toBeVisible();
  const alimento = idDaUrl(nutri, new RegExp(`/painel/alimentos/(${UUID})$`));

  // registro no diário, pelo portal, com o paciente
  await paciente.page.goto('/p/diario');
  await paciente.page.getByLabel('Refeição', { exact: true }).selectOption('Almoço');
  await paciente.page.getByLabel('O que você comeu?').fill(`arroz e feijão ${sufixo}`);
  await paciente.page.getByRole('button', { name: 'Registrar' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Registro salvo.' })).toBeVisible();
  // exame enviado pelo paciente (Plano 12): o consultório do E2E recebe exames (seed); o worker processa e o envio entra na fila
  const laudo = await PDFDocument.create();
  laudo.addPage([595, 842]);
  await paciente.page.goto('/p/exames');
  await paciente.page.getByLabel('Data da coleta').fill('2026-09-28');
  await paciente.page.getByLabel('PDF ou fotos do exame').setInputFiles({ name: 'laudo.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await laudo.save()) });
  await paciente.page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Exame enviado. Sua nutricionista vai revisar.' })).toBeVisible();
  await paciente.page.context().close();

  // exportação (a tela abre "em preparo" ou pronta, conforme o worker)
  await nutri.goto(`${p}/privacidade`);
  await nutri.getByRole('button', { name: 'Exportar dados' }).click();
  await expect(nutri).toHaveURL(/\/exportacoes\/[0-9a-f-]{36}$/);
  const exportacao = idDaUrl(nutri, new RegExp(`/exportacoes/(${UUID})$`));

  // conteúdo (vídeo para todos, como no conteudos.spec)
  await nutri.goto('/painel/conteudos/novo?tipo=video');
  await nutri.getByLabel('Título').fill(`Vídeo axe ${sufixo}`);
  await nutri.getByLabel('Link do vídeo').fill('https://youtu.be/dQw4w9WgXcQ');
  await nutri.getByRole('button', { name: 'Criar' }).click();
  await expect(nutri).toHaveURL(/\/painel\/conteudos\/[0-9a-f-]{36}$/);
  const conteudo = idDaUrl(nutri, new RegExp(`/painel/conteudos/(${UUID})$`));

  // receita (Plano 10A): o consultório do E2E tem os documentos liberados no seed (D20)
  await nutri.goto(`${p}/documentos`);
  await nutri.getByRole('button', { name: 'Nova receita' }).click();
  await expect(nutri).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
  const documento = idDaUrl(nutri, new RegExp(`/documentos/(${UUID})$`));

  // lançamento (Plano 20, US-301): a entrada do paciente pela tela "Nova entrada" (o seed deixa o Financeiro configurado);
  // o vencimento sugerido é hoje, e a lista volta no mês atual, com o "Editar" da linha
  await nutri.goto('/painel/financeiro/lancamentos/novo?tipo=entrada');
  await nutri.getByLabel('Paciente (opcional)').selectOption({ label: paciente.nome });
  await nutri.getByLabel('Valor', { exact: true }).fill('250,00');
  await nutri.getByLabel('Categoria', { exact: true }).selectOption({ label: 'Consultas' });
  await nutri.getByLabel('Descrição (opcional)').fill(`Retorno axe ${sufixo}`);
  await nutri.getByRole('button', { name: 'Salvar entrada' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Lançamento salvo.' })).toBeVisible();
  const hrefLancamento = await nutri.getByRole('link', { name: new RegExp(`^Editar Entrada, ${paciente.nome}, `) }).first().getAttribute('href');
  const lancamento = new RegExp(`^/painel/financeiro/lancamentos/(${UUID})$`).exec(hrefLancamento ?? '');
  expect(lancamento, `link "Editar" do lançamento de ${paciente.nome}: ${hrefLancamento}`).not.toBeNull();
  // Plano 22 (T3): um exame do catálogo e um modelo de solicitação, pelo caminho real da UI
  const { exameCatalogo, modeloSolicitacao } = await bibliotecasDeExames(nutri, sufixo);
  // Plano 22 (T4): um exame lançado e editado pela aba Exames (a tela "Versões anteriores" com uma versão)
  const exame = await exameEditado(nutri, p, sufixo);
  // Plano 22 (T5b): um segundo exame, para o comparativo
  const exameComparar = await exameLancado(nutri, p, `Retorno axe ${sufixo}`);

  return {
    paciente: p.split('/').pop()!,
    plano,
    consulta,
    anamnese: await idDoLink(nutri, `${p}/anamnese`, new RegExp(`/anamnese/(${UUID})$`)),
    atendimento: await idDoLink(nutri, `${p}/atendimentos`, new RegExp(`/atendimentos/(${UUID})$`)),
    exportacao,
    alimento,
    modeloAnamnese: await idDoLink(nutri, '/painel/anamnese/modelos', new RegExp(`/anamnese/modelos/(${UUID})$`)),
    modeloPlano: await idDoLink(nutri, '/painel/planos/modelos', new RegExp(`/planos/modelos/(${UUID})$`)),
    diario: await idDoLink(nutri, '/painel/diarios', new RegExp(`/painel/diarios/(${UUID})$`)),
    conteudo,
    documento,
    lancamento: lancamento![1],
    duvida: await duvidaDiretaDaSegunda(browser, nutri, ipIaNutri),
    envio: await (async () => {
      await expect
        .poll(async () => {
          await nutri.goto('/painel/exames-recebidos');
          return nutri.locator('a[href^="/painel/exames-recebidos/"]').count();
        }, { timeout: 60_000 })
        .toBeGreaterThan(0);
      return idDoLink(nutri, '/painel/exames-recebidos', new RegExp(`/painel/exames-recebidos/(${UUID})$`));
    })(),
    exameCatalogo,
    modeloSolicitacao,
    exame,
    exameComparar,
  };
}

/** O id do link com este nome na tela atual (a lista que acabou de abrir). */
async function idPeloNome(page: Page, nome: string, padrao: RegExp): Promise<string> {
  const href = (await page.getByRole('link', { name: nome, exact: true }).getAttribute('href')) ?? '';
  const m = padrao.exec(href.split('?')[0]);
  expect(m, `o link "${nome}" (${href}) não casa com ${padrao}`).not.toBeNull();
  return m![1];
}

/**
 * Plano 22 (T3): um exame do catálogo (com uma faixa) e um modelo de solicitação com ele, pelas telas de
 * /painel/exames. Nomes com o sufixo da execução: o seed não apaga o catálogo, e o nome é único no consultório.
 */
export async function bibliotecasDeExames(nutri: Page, sufixo: string): Promise<{ exameCatalogo: string; modeloSolicitacao: string }> {
  const nomeExame = `Ferritina axe ${sufixo}`;
  await nutri.goto('/painel/exames/catalogo/novo');
  await nutri.getByLabel('Nome', { exact: true }).fill(nomeExame);
  await nutri.getByLabel('Unidade (opcional)').fill('ng/mL');
  await nutri.getByRole('button', { name: 'Acrescentar faixa' }).click();
  await nutri.getByLabel('Abaixo de').fill('15');
  await nutri.getByLabel('Categoria').selectOption('Baixo');
  await nutri.getByLabel('Fonte').fill('Laboratório X, 2026');
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(nutri).toHaveURL(/\/painel\/exames\/catalogo\?ok=salvo/);
  await expect(nutri.getByRole('status').filter({ hasText: 'Exame salvo.' })).toBeVisible();
  const exameCatalogo = await idPeloNome(nutri, nomeExame, new RegExp(`/painel/exames/catalogo/(${UUID})$`));

  await nutri.goto('/painel/exames/modelos/novo');
  await nutri.getByLabel('Nome do modelo').fill(`Check-up axe ${sufixo}`);
  await nutri.getByRole('button', { name: 'Adicionar do catálogo' }).click();
  const dialogo = nutri.getByRole('dialog', { name: 'Buscar no catálogo' });
  await dialogo.getByRole('searchbox', { name: 'Buscar no catálogo' }).fill(nomeExame);
  await dialogo.getByLabel(nomeExame).check();
  await dialogo.getByRole('button', { name: 'Adicionar 1 exame' }).click();
  await expect(dialogo).toBeHidden();
  await nutri.getByLabel('Adicionar exame fora do catálogo').fill('Ferro sérico');
  await nutri.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(nutri).toHaveURL(/\/painel\/exames\/modelos\?ok=salvo/);
  await expect(nutri.getByRole('status').filter({ hasText: 'Modelo salvo.' })).toBeVisible();
  const modeloSolicitacao = await idPeloNome(nutri, `Check-up axe ${sufixo}`, new RegExp(`/painel/exames/modelos/(${UUID})$`));
  return { exameCatalogo, modeloSolicitacao };
}

/**
 * Plano 22 (T4, US-371): lança um exame com uma linha (com a faixa do laudo) na aba Exames e o edita pela tela "Editar
 * exame" (o valor muda, com a justificativa), pelo caminho real da UI; devolve o id do exame.
 */
export async function exameEditado(nutri: Page, prontuario: string, sufixo: string): Promise<string> {
  const titulo = `Rotina axe ${sufixo}`;
  await nutri.goto(`${prontuario}/exames`);
  await nutri.getByLabel('Título do exame').fill(titulo);
  await nutri.getByLabel('Marcador 1', { exact: true }).fill('Glicemia de jejum');
  await nutri.getByLabel('Valor 1', { exact: true }).fill('105');
  await nutri.getByLabel('Unidade 1', { exact: true }).fill('mg/dL');
  await nutri.getByLabel('Faixa do laudo: de 1', { exact: true }).fill('70');
  await nutri.getByLabel('até 1', { exact: true }).fill('99');
  await expect(nutri.getByRole('group', { name: 'Linha 1: Glicemia de jejum' })).toContainText('Acima da referência');
  await nutri.getByRole('button', { name: 'Salvar exame' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Exame salvo.' })).toBeVisible();
  const exame = await idDoLink(nutri, `${prontuario}/exames`, new RegExp(`/exames/(${UUID})/editar$`));

  await nutri.goto(`${prontuario}/exames/${exame}/editar`);
  await nutri.getByLabel('Valor 1', { exact: true }).fill('98');
  await nutri.getByLabel('Justificativa da alteração').fill('Valor digitado errado');
  await nutri.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(nutri).toHaveURL(new RegExp(`/exames\\?editado=${exame}#exame-salvo$`));
  // a confirmação fica no exame editado, recebe o foco (a âncora) e está à vista (revisão da T4)
  const salvo = nutri.getByRole('article', { name: new RegExp(`^${titulo}`) }).getByRole('status').filter({ hasText: 'Exame salvo.' });
  await expect(salvo).toBeFocused();
  await expect(salvo).toBeInViewport();
  return exame;
}

/**
 * Plano 22 (T5b, US-374): lança um exame com uma linha de glicemia (com a faixa do laudo) na aba Exames, pelo caminho real
 * da UI; devolve o id pelo link "Abrir {título} de {data}".
 */
export async function exameLancado(nutri: Page, prontuario: string, titulo: string): Promise<string> {
  await nutri.goto(`${prontuario}/exames`);
  await nutri.getByLabel('Título do exame').fill(titulo);
  await nutri.getByLabel('Marcador 1', { exact: true }).fill('Glicemia de jejum');
  await nutri.getByLabel('Valor 1', { exact: true }).fill('92');
  await nutri.getByLabel('Unidade 1', { exact: true }).fill('mg/dL');
  await nutri.getByLabel('Faixa do laudo: de 1', { exact: true }).fill('70');
  await nutri.getByLabel('até 1', { exact: true }).fill('99');
  await nutri.getByRole('button', { name: 'Salvar exame' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Exame salvo.' })).toBeVisible();
  const href = (await nutri.getByRole('link', { name: new RegExp(`^Abrir ${titulo} de `) }).getAttribute('href')) ?? '';
  const m = new RegExp(`/exames/(${UUID})$`).exec(href.split('?')[0]);
  expect(m, `o link "Abrir ${titulo}" (${href})`).not.toBeNull();
  return m![1];
}
