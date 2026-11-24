import { renderToStaticMarkup } from 'react-dom/server';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta, em } from '../../../../test/agenda';
import { makeDb } from '../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';

/**
 * Plano 26, T3 (US-480 a US-487, RN-480/RN-481/RN-493): as telas dos Relatórios com o banco de verdade — abas, filtros,
 * erro do período, estados vazios, o Ranking e nenhuma linha no audit_log (a tela é agregado ou lista nominal sem
 * `auditRead`; só o CSV e a impressão gravam). O relógio é 17/11/2026, 10:00 em São Paulo.
 */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { default: PaginaPacientes } = await import('./page');
const { default: PaginaAtendimentos } = await import('./atendimentos/page');
const { default: PaginaPlanos } = await import('./planos/page');
const { default: PaginaAgenda } = await import('./agenda/page');
const { default: PaginaFinanceiro } = await import('./financeiro/page');
const { default: PaginaRanking } = await import('./ranking/page');
const { closeDb } = await import('@/db/client');
const { auditLog, patientCadastro } = await import('@/db/schema');
const { withTenant } = await import('@/db/tenant');
const { registrarExportacao } = await import('@/modules/relatorios/registro');

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T13:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const PAGINAS = [
  ['pacientes', PaginaPacientes, '/painel/relatorios', 'Pacientes'],
  ['atendimentos', PaginaAtendimentos, '/painel/relatorios/atendimentos', 'Atendimentos'],
  ['planos', PaginaPlanos, '/painel/relatorios/planos', 'Planos alimentares'],
  ['agenda', PaginaAgenda, '/painel/relatorios/agenda', 'Agenda'],
  ['financeiro', PaginaFinanceiro, '/painel/relatorios/financeiro', 'Financeiro'],
  ['ranking', PaginaRanking, '/painel/relatorios/ranking', 'Ranking'],
] as const;
type Pagina = (typeof PAGINAS)[number][1];

/** Consultório novo na sessão da nutricionista; `criadoEm` = o primeiro cadastro (as opções de mês, RE-D48). */
async function tenant(criadoEm?: Date): Promise<TenantDeTeste> {
  const T = await novoTenant(app.db, 'Consultório Teste');
  sessao.atual = { ctx: T.ctx, tenant: { id: T.tenantId, ...T.tenant, ...(criadoEm ? { createdAt: criadoEm } : {}) } };
  return T;
}
const render = async (Pagina: Pagina, sp: Record<string, string> = {}) =>
  renderToStaticMarkup(await Pagina({ searchParams: Promise.resolve(sp), params: Promise.resolve({}) } as never));
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
/** O bloco `<nav aria-label="…">…</nav>`. */
const nav = (html: string, rotulo: string) => html.match(new RegExp(`<nav aria-label="${rotulo}"[^>]*>(.*?)</nav>`))?.[1] ?? '';
const links = (bloco: string) => [...bloco.matchAll(/<a ([^>]*)>(.*?)<\/a>/g)].map((m) => ({ attrs: m[1], rotulo: texto(m[2]).trim() }));

/** As linhas do audit_log do consultório, lidas dentro de `withTenant` na sessão da nutricionista (fora, a RLS esconde). */
const trilha = (T: TenantDeTeste) => withTenant(T.ctx, (tx) => tx.select({ acao: auditLog.acao, entidade: auditLog.entidade }).from(auditLog).where(eq(auditLog.tenantId, T.tenantId)), app.db);

describe('Relatórios — abas e filtros (§4.1, RN-480, RN-481)', () => {
  it('seis abas na ordem, a atual com aria-current; h1 "Relatórios" e o h2 da seção', async () => {
    await tenant();
    for (const [, Pagina, rota, aba] of PAGINAS) {
      const html = await render(Pagina);
      expect(html).toMatch(/<h1[^>]*>Relatórios<\/h1>/);
      const abas = links(nav(html, 'Seções dos relatórios'));
      expect(abas.map((l) => l.rotulo), rota).toEqual(['Pacientes', 'Atendimentos', 'Planos alimentares', 'Agenda', 'Financeiro', 'Ranking']);
      expect(abas.filter((l) => l.attrs.includes('aria-current="page"')).map((l) => l.rotulo), rota).toEqual([aba]);
      expect(abas.find((l) => l.rotulo === aba)?.attrs, rota).toContain(`href="${rota}"`);
      expect(html, rota).toContain('data-guia="abas-relatorios"');
    }
    expect(await render(PaginaRanking)).toMatch(/<h2[^>]*>Ranking de pacientes<\/h2>/);
    expect(await render(PaginaPlanos)).toMatch(/<h2[^>]*>Planos alimentares<\/h2>/);
  });

  it('o período escolhido vai nos links das abas, no "Baixar CSV" e no "Ver versão para imprimir"; sem filtro, as abas vão sem parâmetro', async () => {
    await tenant();
    const html = await render(PaginaAgenda, { de: '2026-03', ate: '2026-05' });
    for (const l of links(nav(html, 'Seções dos relatórios'))) expect(l.attrs, l.rotulo).toMatch(/href="\/painel\/relatorios(\/\w+)?\?de=2026-03&amp;ate=2026-05"/);
    expect(html).toContain('href="/api/painel/relatorios/csv?secao=agenda&amp;de=2026-03&amp;ate=2026-05"');
    expect(html).toContain('href="/painel/relatorios/imprimir?secao=agenda&amp;de=2026-03&amp;ate=2026-05"');
    expect(texto(html)).toContain('Baixar CSV');
    expect(texto(html)).toContain('Ver versão para imprimir');
    expect(html).toMatch(/<option value="2026-03" selected="">março de 2026<\/option>/);
    expect(html).toMatch(/<option value="2026-05" selected="">maio de 2026<\/option>/);
    // o formulário GET volta para a própria seção; sem filtro, as abas não levam parâmetro e o CSV leva o padrão
    expect(html).toMatch(/<form[^>]*method="get"[^>]*action="\/painel\/relatorios\/agenda"|<form[^>]*action="\/painel\/relatorios\/agenda"[^>]*method="get"/);
    const padrao = await render(PaginaAgenda);
    expect(links(nav(padrao, 'Seções dos relatórios')).map((l) => l.attrs.match(/href="([^"]+)"/)?.[1])).toEqual(PAGINAS.map((p) => p[2]));
    expect(padrao).toContain('href="/api/painel/relatorios/csv?secao=agenda&amp;de=2025-12&amp;ate=2026-11"');
    expect(padrao).not.toContain('aria-invalid');
  });

  it('"De" e "Até": meses do mais antigo entre o primeiro cadastro e o atual − 11 até o atual (RE-D48), por extenso', async () => {
    await tenant(new Date('2026-09-10T12:00:00Z'));
    const recente = await render(PaginaPacientes);
    const meses = (html: string, id: string) => [...(html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>(.*?)</select>`))?.[1] ?? '').matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
    expect(meses(recente, 'de')[0]).toBe('2025-12');
    expect(meses(recente, 'de').at(-1)).toBe('2026-11');
    expect(meses(recente, 'ate')).toHaveLength(12);
    expect(recente).toMatch(/<label for="de"[^>]*>De<\/label>/);
    expect(recente).toMatch(/<label for="ate"[^>]*>Até<\/label>/);
    expect(recente).toMatch(/<option value="2025-12" selected="">dezembro de 2025<\/option>/);
    await tenant(new Date('2023-05-02T12:00:00Z'));
    expect(meses(await render(PaginaPacientes), 'de')[0]).toBe('2023-05');
  });

  it('período inválido: o erro junto do campo (aria-invalid + aria-describedby), "Mostrando …", os selects com o escolhido, os números e o CSV do padrão; sem role="alert"', async () => {
    await tenant();
    const html = await render(PaginaAgenda, { de: '2026-06', ate: '2026-03' });
    const de = html.match(/<select[^>]*id="de"[^>]*>/)?.[0] ?? '';
    expect(de).toContain('aria-invalid="true"');
    const descritores = de.match(/aria-describedby="([^"]+)"/)?.[1].split(' ') ?? [];
    expect(descritores.length).toBeGreaterThan(0);
    for (const id of descritores) expect(html).toMatch(new RegExp(`id="${id}"`));
    const t = texto(html);
    expect(t).toContain('O mês inicial não pode ser depois do final.');
    expect(t).toContain('Mostrando dezembro de 2025 a novembro de 2026.');
    expect(html).toMatch(/<option value="2026-06" selected="">junho de 2026<\/option>/);
    expect(html).toMatch(/<option value="2026-03" selected="">março de 2026<\/option>/);
    expect(html).toContain('href="/api/painel/relatorios/csv?secao=agenda&amp;de=2025-12&amp;ate=2026-11"');
    expect(html).not.toContain('role="alert"');
    // a página leva o foco ao aviso (componente cliente montado só com erro): o aviso é focável por script
    const aviso = descritores[0];
    expect(html).toMatch(new RegExp(`id="${aviso}"[^>]*tabindex="-1"|tabindex="-1"[^>]*id="${aviso}"`));
    expect(texto(await render(PaginaAgenda, { de: '2025-11', ate: '2026-11' }))).toContain('Escolha um período de até 12 meses.');
    // ?erro=periodo (a volta do CSV) e mês ilegível
    for (const sp of [{ erro: 'periodo' }, { de: 'abc', ate: '2026-11' }] as Record<string, string>[]) {
      const x = texto(await render(PaginaAgenda, sp));
      expect(x, JSON.stringify(sp)).toContain('Período inválido. Mostrando os últimos 12 meses.');
      expect(x, JSON.stringify(sp)).toContain('Mostrando dezembro de 2025 a novembro de 2026.');
    }
    // o mesmo mês vale
    expect(await render(PaginaAgenda, { de: '2026-03', ate: '2026-03' })).not.toContain('aria-invalid');
  });
});

describe('Relatórios — o conteúdo das seções (US-480 a US-485)', () => {
  it('consultório novo: cada seção diz "Ainda não há dados neste período."; o Financeiro não configurado, "Configurar o Financeiro"', async () => {
    await tenant();
    for (const [secao, Pagina] of PAGINAS) {
      const t = texto(await render(Pagina));
      if (secao === 'financeiro') {
        expect(t).toContain('O Financeiro ainda não foi configurado.');
        continue;
      }
      expect(t, secao).toContain('Ainda não há dados neste período.');
    }
    const fin = await render(PaginaFinanceiro);
    expect(fin).toMatch(/<a [^>]*href="\/painel\/financeiro\/configuracoes"[^>]*>Configurar o Financeiro<\/a>/);
    expect(texto(fin)).not.toContain('Peça à nutricionista');
  });

  it('Pacientes: situação com "Total", sexo e fase da vida com o percentual de uma casa, as notas, os novos por mês numa tabela rolável e focável', async () => {
    const T = await tenant();
    for (const extra of [{ sexo: 'F' }, { sexo: 'F' }, { sexo: 'M', dataNascimento: '1950-01-01' }, { status: 'arquivado' }] as const) await novoPaciente(app.db, T.ctx, extra);
    const html = await render(PaginaPacientes);
    const t = texto(html);
    for (const titulo of ['Pacientes por situação', 'Pacientes ativos por sexo', 'Pacientes ativos por fase da vida', 'Novos pacientes por mês']) expect(t).toContain(titulo);
    expect(html).toMatch(/<th scope="row"[^>]*>Ativos<\/th><td[^>]*>3<\/td>/);
    expect(html).toMatch(/<th scope="row"[^>]*>Inativos \(arquivados\)<\/th><td[^>]*>1<\/td>/);
    expect(html).toMatch(/<th scope="row"[^>]*>Total<\/th><td[^>]*>4<\/td>/);
    expect(html).toMatch(/<th scope="row"[^>]*>Feminino<\/th><td[^>]*>2<\/td><td[^>]*>66,7%<\/td>/);
    expect(html).toMatch(/<th scope="row"[^>]*>Pessoas idosas \(60 anos ou mais\)<\/th><td[^>]*>1<\/td><td[^>]*>33,3%<\/td>/);
    expect(t).toContain('Pacientes anonimizados não entram nestes números.');
    expect(t).toContain('Os percentuais são arredondados.');
    expect(t).not.toContain('Ainda não há dados neste período.');
    expect(html).toMatch(/<caption[^>]*>Novos pacientes por mês<\/caption>/);
    const regiao = html.match(/<div role="region" aria-labelledby="([^"]+)" tabindex="0" class="([^"]*)"/);
    expect(regiao).not.toBeNull();
    expect(regiao![2]).toContain('focus-visible:outline-offset-[-3px]');
    expect(html).toContain(`<caption id="${regiao![1]}"`);
    // novos por mês: os 4 cadastros caem no mês de hoje do banco (o relógio real), fora ou dentro do período padrão
    expect(t).toMatch(/Total \d+/);
  });

  it('Agenda: a taxa de faltas no formato do Início, as barras só de desenho (aria-hidden, cor por token) e a nota da taxa', async () => {
    const T = await tenant();
    const p = (await novoPaciente(app.db, T.ctx)).id;
    await consultaDireta(app.db, T.ctx, p, em('2026-10-05', '10:00'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, p, em('2026-10-12', '10:00'), 60, { status: 'faltou' });
    const html = await render(PaginaAgenda, { de: '2026-10', ate: '2026-11' });
    for (const col of ['Mês', 'Marcadas', 'Realizadas', 'Faltas', 'Taxa de faltas', 'Canceladas pelo paciente', 'Canceladas pelo consultório', 'Marcadas pelo paciente', 'Retornos'])
      expect(html).toContain(`<th scope="col">${col}</th>`);
    expect(texto(html)).toContain('outubro de 2026 2 1 1 50,0% (1 de 2)');
    expect(texto(html)).toContain('Taxa de faltas: faltas sobre as consultas não canceladas que já começaram, como no Início.');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/fill="#/);
    expect(html).toMatch(/class="[^"]*print:hidden[^"]*"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*class="[^"]*print:hidden/);
  });

  it('Ranking: o aviso, "Mais consultas"/"Maior receita" com aria-current, o nome exibido com link para a ficha e nenhum nome de registro na tela', async () => {
    const T = await tenant();
    const joao = (await novoPaciente(app.db, T.ctx, { nome: 'João Silva' })).id;
    await withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: joao, nomeSocial: 'Joana Silva' }), app.db);
    await consultaDireta(app.db, T.ctx, joao, em('2026-10-05', '10:00'), 60, { status: 'realizada' });
    const html = await render(PaginaRanking);
    const t = texto(html);
    expect(t).toContain("Lista com nomes de pacientes. Ao exportar, cada paciente da lista registra 'Exportou — Relatórios' no Histórico de acessos.");
    expect(t).toContain('Pacientes com mais consultas realizadas');
    const criterio = links(nav(html, 'Ranking de pacientes'));
    expect(criterio.map((l) => l.rotulo)).toEqual(['Mais consultas', 'Maior receita']);
    expect(criterio[0].attrs).toContain('aria-current="page"');
    expect(criterio[1].attrs).toContain('href="/painel/relatorios/ranking?por=receita"');
    expect(html).toMatch(new RegExp(`<a [^>]*href="/painel/pacientes/${joao}"[^>]*>Joana Silva</a>`));
    expect(t).not.toContain('João Silva');
    for (const col of ['Posição', 'Paciente', 'Consultas']) expect(html).toContain(`<th scope="col">${col}</th>`);
    expect(html).toContain('href="/api/painel/relatorios/csv?secao=ranking&amp;de=2025-12&amp;ate=2026-11&amp;por=consultas"');
    const receita = await render(PaginaRanking, { por: 'receita' });
    expect(texto(receita)).toContain('Pacientes com maior receita recebida');
    expect(links(nav(receita, 'Ranking de pacientes'))[1].attrs).toContain('aria-current="page"');
    expect(receita).toMatch(/<input type="hidden" name="por" value="receita"\/>/);
  });

  it('a tela não grava nada no audit_log (agregado e lista nominal sem auditRead, RN-493) — controle positivo com a mesma leitura', async () => {
    const T = await tenant();
    const p = (await novoPaciente(app.db, T.ctx)).id;
    await consultaDireta(app.db, T.ctx, p, em('2026-10-05', '10:00'), 60, { status: 'realizada' });
    const antes = (await trilha(T)).length; // as escritas da semente (gatilhos de auditoria de patients e appointments)
    for (const [, Pagina] of PAGINAS) await render(Pagina);
    await render(PaginaRanking, { por: 'receita' });
    expect(await trilha(T)).toHaveLength(antes);
    // controle positivo: a mesma leitura enxerga uma exportação gravada na sessão
    await withTenant(T.ctx, (tx) => registrarExportacao(tx, { secao: 'agenda', periodo: { de: '2026-01', ate: '2026-01', meses: ['2026-01'] }, localId: null }), app.db);
    const depois = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.tenantId, T.tenantId), eq(auditLog.entidade, 'relatorios'))), app.db);
    expect(depois).toHaveLength(1);
    expect((await trilha(T)).filter((l) => l.acao === 'ler')).toEqual([]);
  });
});
