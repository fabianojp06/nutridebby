import { renderToStaticMarkup } from 'react-dom/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta, em } from '../../../../../test/agenda';
import { makeDb } from '../../../../../test/db';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../../../test/pacientes';

/**
 * Plano 26, T3 (US-487, RN-493, RN-495): a versão para imprimir. O render grava o `exportar` (entidade `relatorios`) na
 * transação da leitura — agregado: uma linha sem paciente; Ranking: uma por paciente — e nunca um `ler`. Cabeçalho e
 * rodapé da §6.2; no Ranking, o nome de registro. Pedido de outro site não grava nada.
 */
const sessao = vi.hoisted(() => ({ atual: null as null | { ctx: unknown; tenant: unknown }, cabecalhos: new Headers({ 'sec-fetch-site': 'same-origin' }) }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao.atual) }));
vi.mock('next/headers', () => ({ headers: async () => sessao.cabecalhos }));
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
  notFound: () => {
    throw new Error('notFound');
  },
}));

const { default: Imprimir, generateMetadata } = await import('./page');
const { closeDb } = await import('@/db/client');
const { auditLog, patientCadastro } = await import('@/db/schema');
const { withTenant } = await import('@/db/tenant');

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await closeDb();
  await app.pool.end();
});
beforeEach(() => {
  sessao.cabecalhos = new Headers({ 'sec-fetch-site': 'same-origin' });
});

async function tenant(): Promise<TenantDeTeste> {
  const T = await novoTenant(app.db, 'Consultório Bem Viver');
  sessao.atual = { ctx: T.ctx, tenant: { id: T.tenantId, ...T.tenant } };
  return T;
}
const props = (sp: Record<string, string>) => ({ searchParams: Promise.resolve(sp), params: Promise.resolve({}) }) as never;
const render = async (sp: Record<string, string>) => renderToStaticMarkup(await Imprimir(props(sp)));
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

/** A trilha do consultório, lida dentro de `withTenant` na sessão da nutricionista (fora, a RLS esconderia tudo). */
const trilha = (T: TenantDeTeste) =>
  withTenant(
    T.ctx,
    (tx) => tx.select({ acao: auditLog.acao, entidade: auditLog.entidade, entidadeId: auditLog.entidadeId, patientId: auditLog.patientId }).from(auditLog).where(eq(auditLog.tenantId, T.tenantId)),
    app.db,
  );
const exportacoes = async (T: TenantDeTeste) => (await trilha(T)).filter((l) => l.entidade === 'relatorios');

describe('Imprimir os Relatórios (RN-495)', () => {
  it('agregado: cabeçalho, período, "Local: Todos", "Gerado em", rodapé, os botões fora da impressão; uma linha "exportar" sem paciente e nenhum "ler"', async () => {
    const T = await tenant();
    const p = (await novoPaciente(app.db, T.ctx)).id;
    await consultaDireta(app.db, T.ctx, p, em('2026-03-02', '10:00'), 60, { status: 'realizada' });
    const antes = await trilha(T);
    expect(antes.filter((l) => l.entidade === 'relatorios')).toEqual([]);
    const html = await render({ secao: 'agenda', de: '2026-01', ate: '2026-06' });
    const t = texto(html);
    expect(t).toContain('Consultório Bem Viver');
    expect(html).toMatch(/<h1[^>]*>Relatório de Agenda<\/h1>/);
    expect(t).toContain('Período: 01/2026 a 06/2026');
    expect(t).toContain('Local: Todos');
    expect(t).toMatch(/Gerado em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
    expect(t).toContain('Documento interno do consultório, com dados de pacientes. Guarde com sigilo.');
    expect(t).toContain('Imprimir ou salvar em PDF');
    expect(html).toMatch(/<a [^>]*href="\/painel\/relatorios\/agenda\?de=2026-01&amp;ate=2026-06"[^>]*>Voltar aos relatórios<\/a>/);
    // os botões e as barras ficam fora do papel; as tabelas, não
    expect(html).toMatch(/<div class="[^"]*print:hidden[^"]*">.*Imprimir ou salvar em PDF.*Voltar aos relatórios.*?<\/div>/);
    expect(html).not.toContain('<svg');
    expect(html).toContain('<th scope="col">Taxa de faltas</th>');
    expect(t).toContain('março de 2026 1 1 0');
    const depois = await trilha(T);
    expect(depois.filter((l) => l.entidade === 'relatorios')).toEqual([{ acao: 'exportar', entidade: 'relatorios', entidadeId: 'agenda|2026-01..2026-06|todos', patientId: null }]);
    expect(depois.filter((l) => l.acao === 'ler')).toEqual([]);
  });

  it('Ranking: o nome de registro na coluna "Paciente (nome de registro)", sem link; uma linha "exportar" por paciente da lista', async () => {
    const T = await tenant();
    const joao = (await novoPaciente(app.db, T.ctx, { nome: 'João Silva' })).id;
    const ana = (await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' })).id;
    await withTenant(T.ctx, (tx) => tx.insert(patientCadastro).values({ tenantId: T.tenantId, patientId: joao, nomeSocial: 'Joana Silva' }), app.db);
    for (const [p, hora] of [[joao, '10:00'], [ana, '14:00']] as const) await consultaDireta(app.db, T.ctx, p, em('2026-03-02', hora), 60, { status: 'realizada' });
    const html = await render({ secao: 'ranking', de: '2026-01', ate: '2026-06', por: 'consultas' });
    const t = texto(html);
    expect(html).toMatch(/<h1[^>]*>Relatório de Ranking de pacientes<\/h1>/);
    expect(html).toContain('<th scope="col">Paciente (nome de registro)</th>');
    expect(t).toContain('João Silva');
    expect(t).not.toContain('Joana Silva');
    expect(html).not.toContain('/painel/pacientes/');
    const ex = await exportacoes(T);
    expect(ex.map((l) => l.patientId).sort()).toEqual([joao, ana].sort());
    expect(ex.every((l) => l.acao === 'exportar' && l.entidadeId === 'ranking|2026-01..2026-06|todos')).toBe(true);
    expect((await trilha(T)).filter((l) => l.acao === 'ler')).toEqual([]);
  });

  it('o título da aba: "Relatório de {seção} — {consultório}", sem dado de paciente', async () => {
    await tenant();
    expect((await generateMetadata(props({ secao: 'financeiro' }))).title).toBe('Relatório de Financeiro — Consultório Bem Viver');
    expect((await generateMetadata(props({ secao: 'ranking' }))).title).toBe('Relatório de Ranking de pacientes — Consultório Bem Viver');
  });

  it('pedido de outro site, período inválido ou seção desconhecida: redirect sem gravar nada', async () => {
    const T = await tenant();
    sessao.cabecalhos = new Headers({ 'sec-fetch-site': 'cross-site' });
    await expect(render({ secao: 'agenda', de: '2026-01', ate: '2026-06' })).rejects.toThrow('redirect /painel/relatorios/agenda');
    sessao.cabecalhos = new Headers();
    await expect(render({ secao: 'agenda', de: '2026-01', ate: '2026-06' })).rejects.toThrow('redirect /painel/relatorios/agenda');
    sessao.cabecalhos = new Headers({ 'sec-fetch-site': 'same-origin' });
    await expect(render({ secao: 'agenda', de: '2026-06', ate: '2026-01' })).rejects.toThrow('redirect /painel/relatorios/agenda?erro=periodo');
    await expect(render({ secao: 'prontuario' })).rejects.toThrow('redirect /painel/relatorios');
    expect(await exportacoes(T)).toEqual([]);
    // controle positivo: o mesmo pedido da própria origem grava, e a mesma leitura enxerga
    await render({ secao: 'agenda', de: '2026-01', ate: '2026-06' });
    expect(await exportacoes(T)).toHaveLength(1);
  });
});
