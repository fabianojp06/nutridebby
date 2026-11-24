import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { makeDb } from '../../../../../test/db';
import { novoLocal } from '../../../../../test/agenda';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../../test/pacientes';

/** US-306 (Plano 20, T8): "Relatórios" — fluxo de caixa do ano, 12 meses e o formulário do CSV, com o banco de verdade. */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  usePathname: () => '/painel/financeiro/relatorios',
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

const { default: Relatorios } = await import('./page');
const { closeDb } = await import('@/db/client');
const { listarCategorias, salvarConfiguracoes } = await import('@/modules/financeiro/configuracoes');
const { criarLancamento } = await import('@/modules/financeiro/lancamentos');
const { MSG_FINANCEIRO: M } = await import('@/modules/financeiro/constantes');
const { formatarData, hojeNoFuso } = await import('@/modules/pacientes/datas');

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});

async function tenant(): Promise<TenantDeTeste> {
  const T = await novoTenant(app.db);
  sessao.atual = { ctx: T.ctx, tenant: { id: T.tenantId, ...T.tenant } };
  return T;
}
/** Saldo do caixa em 01/01 do ano atual, uma entrada recebida nesse dia e uma de um ano antes (vale em qualquer dia do ano). */
async function cenario() {
  const T = await tenant();
  const hoje = hojeNoFuso(T.tenant.fuso);
  const ano = Number(hoje.slice(0, 4));
  await salvarConfiguracoes(T.ctx, T.tenant, { saldoInicialEm: `${ano}-01-01`, saldoInicial: '1.000,00', valorConsulta: '250,00' }, { db: app.db });
  const cats = await listarCategorias(T.ctx, { db: app.db });
  const consultas = cats.find((c) => c.nome === 'Consultas')!.id;
  const p = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
  const recebida = (dia: string) =>
    criarLancamento(T.ctx, T.tenant, { tipo: 'entrada', valor: '250,00', categoriaId: consultas, vencimento: dia, pacienteId: p, pagoEm: dia, forma: 'pix' }, { db: app.db });
  await recebida(`${ano}-01-01`);
  await recebida(`${ano - 1}-06-10`);
  return { ...T, ano };
}
const render = async (sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await Relatorios({ searchParams: Promise.resolve(sp), params: Promise.resolve({}) } as never));
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Relatórios (US-306)', () => {
  it('o fluxo de caixa no contêiner rolável e focável, com caption, linhas, "Total" e as notas; não grava "Visualizou"', async () => {
    const C = await cenario();
    const html = await render();
    const t = texto(html);
    expect(html).toMatch(/<h1 id="titulo-financeiro" tabindex="-1"[^>]*>Relatórios<\/h1>/);
    const regiao = html.match(/<div role="region" aria-labelledby="([^"]+)" tabindex="0" class="([^"]*)"/);
    expect(regiao).not.toBeNull();
    expect(regiao![2]).toContain('overflow-x-auto');
    expect(regiao![2]).toContain('focus-visible:outline-offset-[-3px]');
    expect(html).toContain(`<caption id="${regiao![1]}"`);
    expect(html).toMatch(new RegExp(`<caption id="${regiao![1]}"[^>]*>Fluxo de caixa de ${C.ano}</caption>`));
    for (const col of ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez', 'Total']) expect(html).toContain(`<th scope="col">${col}</th>`);
    for (const linha of ['Saldo no início do mês', 'Consultas', 'Total de entradas', 'Total de saídas', 'Resultado do mês', 'Saldo no fim do mês'])
      expect(html).toContain(`<th scope="row">${linha}</th>`);
    expect(t).toContain(M.relatorios.notaSaldo(formatarData(`${C.ano}-01-01`)));
    expect(t).toContain('Só entram os lançamentos recebidos ou pagos.');
    // janeiro, o mês do saldo: início "—" e fim = saldo + o recebido desde a data do saldo; fevereiro começa com esse fim
    expect(t).toContain('Saldo no início do mês — R$ 1.250,00');
    expect(t).toContain('Saldo no fim do mês R$ 1.250,00 R$ 1.250,00');
    expect(html).toContain(`href="/api/painel/financeiro/fluxo-de-caixa.csv?ano=${C.ano}"`);
    const leituras = await owner.pool.query(`select 1 from audit_log where tenant_id = $1 and acao = 'ler'`, [C.tenantId]);
    expect(leituras.rowCount).toBe(0);
  });

  it('"Ano" é um <select> do ano do primeiro lançamento até o atual; ?ano= escolhe, ano fora da lista volta ao atual', async () => {
    const C = await cenario();
    const html = await render({ ano: String(C.ano - 1) });
    expect(html).toMatch(/<label for="ano"[^>]*>Ano<\/label>/);
    expect(html).toContain(`<option value="${C.ano - 1}" selected="">${C.ano - 1}</option>`);
    expect(html).toContain(`<option value="${C.ano}">${C.ano}</option>`);
    expect(html).not.toContain(`<option value="${C.ano - 2}"`);
    expect(texto(html)).toContain(`Fluxo de caixa de ${C.ano - 1}`);
    expect(texto(await render({ ano: '1990' }))).toContain(`Fluxo de caixa de ${C.ano}`);
  });

  it('entradas e saídas em 12 meses: barras aria-hidden com cor por token e legenda em texto, e a tabela como alternativa', async () => {
    await cenario();
    const html = await render();
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/fill="#/);
    expect(html).toContain('fill-ok');
    expect(html).toContain('fill-erro');
    const t = texto(html);
    expect(t).toContain('Entradas e saídas nos últimos 12 meses');
    for (const col of ['Mês', 'Entradas', 'Saídas', 'Resultado']) expect(html).toContain(`<th scope="col">${col}</th>`);
  });

  it('o formulário do CSV: "De", "Até", "Incluir o nome dos pacientes" com a ajuda e "Baixar CSV"; ?erro=periodo mostra o alerta junto do "Até"', async () => {
    await cenario();
    const sem = await render();
    expect(sem).toContain('action="/api/painel/financeiro/lancamentos.csv"');
    expect(sem).toMatch(/<label for="csv-de"[^>]*>De<\/label>/);
    expect(sem).toMatch(/<label for="csv-ate"[^>]*>Até<\/label>/);
    expect(sem).toMatch(/<input[^>]*type="checkbox"[^>]*name="pacientes"[^>]*value="1"/);
    expect(texto(sem)).toContain('Incluir o nome dos pacientes');
    expect(texto(sem)).toContain(M.csv.ajuda);
    expect(texto(sem)).toContain('Baixar CSV');
    expect(sem).not.toContain('role="alert"');
    const com = await render({ erro: 'periodo' });
    expect(com).toMatch(/<input[^>]*id="csv-ate"[^>]*aria-invalid="true"[^>]*aria-describedby="csv-ate-erro"/);
    expect(com).toMatch(/<p id="csv-ate-erro" role="alert"[^>]*>Escolha um período de até 12 meses.<\/p>/);
  });

  it('?erro=origem (a rota não confirmou a origem do CSV dos lançamentos): o alerta junto do "Baixar CSV", ligado a ele, sem marcar o período', async () => {
    await cenario();
    const html = await render({ erro: 'origem' });
    expect(html).toContain(
      `<div id="csv-erro-origem" class="max-w-2xl"><p role="alert" class="rounded-2xl border border-erro bg-erro-fundo p-3 text-erro">${M.csv.erroOrigem}</p></div>`,
    );
    expect(html).toMatch(/<button[^>]*id="csv-baixar"[^>]*aria-describedby="csv-erro-origem"[^>]*>Baixar CSV<\/button>/);
    // no cartão do CSV dos lançamentos (depois do fluxo), antes do botão; o link do fluxo sem descrição
    expect(html.indexOf(M.csv.erroOrigem)).toBeGreaterThan(html.indexOf('id="csv-titulo"'));
    expect(html.indexOf(M.csv.erroOrigem)).toBeLessThan(html.indexOf('Baixar CSV</button>'));
    expect(html.split(M.csv.erroOrigem)).toHaveLength(2);
    expect(html).toMatch(/<a id="fluxo-csv" href="[^"]*" class=/);
    expect(html).not.toContain('aria-invalid="true"');
    const sem = await render();
    expect(sem).not.toContain(M.csv.erroOrigem);
    expect(sem).toMatch(/<button[^>]*id="csv-baixar"[^>]*>Baixar CSV<\/button>/);
    expect(sem).not.toContain('aria-describedby="csv-erro-origem"');
  });

  it('?erro=origem&csv=fluxo (o do link do fluxo de caixa): o alerta no cartão do fluxo, ligado ao link; o formulário sem alerta', async () => {
    const C = await cenario();
    const html = await render({ erro: 'origem', csv: 'fluxo' });
    expect(html).toContain(
      `<div id="fluxo-csv-erro-origem" class="max-w-2xl"><p role="alert" class="rounded-2xl border border-erro bg-erro-fundo p-3 text-erro">${M.csv.erroOrigem}</p></div>`,
    );
    expect(html).toContain(`<a id="fluxo-csv" href="/api/painel/financeiro/fluxo-de-caixa.csv?ano=${C.ano}" aria-describedby="fluxo-csv-erro-origem"`);
    // dentro do cartão do fluxo (antes da tabela dele), uma vez só; o botão do formulário sem descrição
    expect(html.indexOf(M.csv.erroOrigem)).toBeGreaterThan(html.indexOf('id="fluxo-titulo"'));
    expect(html.indexOf(M.csv.erroOrigem)).toBeLessThan(html.indexOf('id="fluxo-caption"'));
    expect(html.split(M.csv.erroOrigem)).toHaveLength(2);
    expect(html).not.toContain('id="csv-erro-origem"');
    expect(html).not.toContain('aria-describedby="csv-erro-origem"');
    // csv= sem erro=origem não mostra nada
    expect(await render({ csv: 'fluxo' })).not.toContain(M.csv.erroOrigem);
  });

  it('sem configuração: o primeiro acesso (RN-301), sem tabelas', async () => {
    await tenant();
    const t = texto(await render());
    expect(t).toContain(M.comecePorAqui);
    expect(t).not.toContain('Fluxo de caixa de');
  });
});

describe('Plano 23 (US-416, RN-437): "Local" em Relatórios', () => {
  it('"Local" com "Todos os locais", os locais e "Sem local"; ?local= escolhe aqui e no CSV; o fluxo diz "Todos os locais"', async () => {
    const C = await cenario();
    const centro = await novoLocal(app.db, C.ctx, { nome: 'Clínica Centro' });
    const opcoes = (html: string, id: string) =>
      [...html.match(new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?</select>`))![0].matchAll(/<option value="([^"]*)"( selected="")?>([^<]*)<\/option>/g)].map((m) => [m[1], m[3], !!m[2]]);
    const sem = await render();
    expect(sem).toMatch(/<label for="local"[^>]*>Local<\/label>/);
    expect(opcoes(sem, 'local')).toEqual([['', 'Todos os locais', true], [centro, 'Clínica Centro', false], ['sem_local', 'Sem local', false]]);
    expect(opcoes(sem, 'csv-local')).toEqual([['', 'Todos os locais', true], [centro, 'Clínica Centro', false], ['sem_local', 'Sem local', false]]);
    const fluxo = sem.match(/<section[^>]*aria-labelledby="fluxo-titulo"[\s\S]*?<\/section>/)![0];
    expect(texto(fluxo)).toContain('Todos os locais');
    const com = await render({ local: centro });
    expect(opcoes(com, 'local').find((o) => o[2])?.[1]).toBe('Clínica Centro');
    expect(opcoes(com, 'csv-local').find((o) => o[2])?.[1]).toBe('Clínica Centro');
    // as entradas do cenário não têm consulta: com o local, os 12 meses ficam zerados; com "Sem local", elas voltam
    const doze = (html: string) => texto(html.match(/<section[^>]*aria-labelledby="doze-titulo"[\s\S]*?<\/section>/)![0]);
    expect(doze(sem)).toMatch(/R\$\s250,00/);
    expect(doze(com)).not.toMatch(/R\$\s250,00/);
    expect(doze(await render({ local: 'sem_local' }))).toMatch(/R\$\s250,00/);
    // o fluxo de caixa não se divide: com o local, o mesmo de sem
    expect(texto(com.match(/<section[^>]*aria-labelledby="fluxo-titulo"[\s\S]*?<\/section>/)![0])).toBe(texto(fluxo));
    // valor inválido: sem filtro
    expect(opcoes(await render({ local: 'x' }), 'local').find((o) => o[2])?.[1]).toBe('Todos os locais');
  });
});

