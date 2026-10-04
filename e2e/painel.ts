import { expect, type Browser, type Page } from '@playwright/test';
import type { IdsDoPainel } from './painel-rotas';
import { avaliar, marcarParaPaciente, pacienteNoPortal, publicarPlanoSimples } from './portal';

/** D17: grava o tema pela tela de Configurações (o caminho real da usuária). */
export async function escolherTema(page: Page, rotulo: 'Claro' | 'Escuro' | 'Igual ao aparelho'): Promise<void> {
  await page.goto('/painel/configuracoes');
  await page.getByRole('radio', { name: rotulo }).check();
  await page.getByRole('button', { name: 'Salvar tema' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tema salvo.' })).toBeVisible();
}

/** D20: os seis itens do topo. */
export async function irPeloMenu(page: Page, item: 'Início' | 'Pacientes' | 'Agenda' | 'Diários' | 'Conteúdos' | 'Configurações'): Promise<void> {
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
 * D25: cria um paciente e uma linha de cada tela com parâmetro — plano (publicarPlanoSimples), consulta
 * (marcarParaPaciente), avaliação, anamnese, atendimento, alimento próprio, modelo de anamnese, modelo de plano
 * ("Salvar como modelo" do editor), registro no diário (pelo portal, com o paciente), exportação ("Exportar dados" em
 * Privacidade; a tela abre "em preparo" sem o worker) e conteúdo (Plano 07) — e devolve os ids.
 * `ip`: o IP só do paciente (o limite de login é por IP).
 */
export async function prepararTelasComId(browser: Browser, nutri: Page, ip: string): Promise<IdsDoPainel> {
  const sufixo = Date.now().toString(36);
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
  // mesmo dia e hora da execução anterior dá "Conflito com a consulta de …"
  await marcarParaPaciente(nutri, paciente.nome, paciente.email, 2 + (Math.floor(Date.now() / 60_000) % 50));
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
  await expect(nutri).toHaveURL(/\/atendimentos\/[0-9a-f-]{36}$/);

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
  };
}
