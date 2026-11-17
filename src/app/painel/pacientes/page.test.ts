import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plano 18 (US-261, §8.1, RN-270 a RN-273, D26): a lista com abas, "Ordenar por", as colunas novas, o menu por linha e a
// região de status fixa. Sessão, pacientes, etiquetas e convites simulados; `filtroDaUrl` de verdade (estrutura, sem DOM).
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
type Linha = Record<string, unknown>;
let lista: Linha[];
const pedidos: unknown[] = [];
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({
  requireNutri: async () => ({ ctx: { tenantId: 't' }, tenant: { fuso: 'America/Sao_Paulo' } }),
}));
vi.mock('@/modules/pacientes/etiquetas', () => ({ listarEtiquetas: async () => [{ id: 'e1', nome: 'Gestante', pacientes: 1 }] }));
vi.mock('@/modules/pacientes/pacientes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/pacientes/pacientes')>()),
  listarPacientes: async (_ctx: unknown, filtro: unknown) => {
    pedidos.push(filtro);
    return lista;
  },
}));
vi.mock('@/modules/pacientes/convite-paciente', () => ({
  situacoesDoAcesso: async (_ctx: unknown, ps: { id: string; userId: string | null }[]) =>
    new Map(ps.map((p) => [p.id, p.userId ? { estado: 'ativo' } : { estado: 'pendente', expiraEm: new Date('2026-11-20T15:00:00Z') }])),
}));
vi.mock('./actions', () => ({ arquivarDaListaAction: vi.fn(), reativarDaListaAction: vi.fn() }));
const { default: PacientesPage } = await import('./page');

async function render(sp: Record<string, string> = {}): Promise<string> {
  const el = (await PacientesPage({ searchParams: Promise.resolve(sp) } as never)) as ReactElement;
  return renderToStaticMarkup(el);
}
const linha = (extra: Linha = {}): Linha => ({
  id: A, nome: 'Ana Souza', nomeSocial: null, email: 'ana@ex.com', status: 'ativo', dataNascimento: '1991-03-10', userId: null,
  origem: 'nutri', createdAt: new Date('2025-02-03T15:00:00Z'), ...extra,
});
const abaMarcada = (html: string) => [...html.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
const hrefDaAba = (html: string, rotulo: string) => html.match(new RegExp(`<a [^>]*href="([^"]*)"[^>]*>${rotulo}</a>`))?.[1]?.replaceAll('&amp;', '&');
const regiao = (html: string) => html.match(/<p [^>]*role="status"[^>]*>([^<]*)<\/p>/);

describe('lista de pacientes (Plano 18, §8.1)', () => {
  beforeEach(() => {
    lista = [linha()];
    pedidos.length = 0;
  });

  it('abas Ativos, Inativos e Todos, com "Ativos" marcada por padrão, e "Ver bloqueados" fora das abas', async () => {
    const html = await render();
    expect(abaMarcada(html)).toEqual(['Ativos']);
    for (const r of ['Ativos', 'Inativos', 'Todos']) expect(hrefDaAba(html, r)).toBeDefined();
    expect(hrefDaAba(html, 'Ver bloqueados')).toBe('/painel/pacientes?situacao=bloqueados');
    expect(html).not.toContain('>Situação<'); // o seletor "Situação" saiu
    expect(pedidos).toEqual([{ aba: 'ativos', ordem: 'nome' }]);
  });

  it('a aba vem da URL; o link antigo ?status=arquivado marca Inativos (com a dica)', async () => {
    expect(abaMarcada(await render({ aba: 'todos' }))).toEqual(['Todos']);
    const html = await render({ status: 'arquivado' });
    expect(abaMarcada(html)).toEqual(['Inativos']);
    expect(html).toContain('Pacientes arquivados: sem acesso ao app e sem notificações. O prontuário continua guardado.');
    expect(pedidos.at(-1)).toEqual({ aba: 'inativos', ordem: 'nome' });
  });

  it('formulário GET leva a aba em campo oculto; os links das abas levam a busca, a etiqueta e a ordem', async () => {
    const html = await render({ aba: 'inativos', busca: 'ana', etiqueta: 'e1', ordem: 'recentes' });
    const form = html.match(/<form [^>]*method="get"[\s\S]*?<\/form>/)![0];
    expect(form).toContain('<input type="hidden" name="aba" value="inativos"/>');
    expect(form).not.toContain('name="situacao"');
    expect(form).toMatch(/<select[^>]*name="ordem"/);
    for (const r of ['Nome (A–Z)', 'Nome (Z–A)', 'Mais recentes', 'Mais antigos']) expect(form).toContain(`>${r}</option>`);
    expect(form).toContain('Ordenar por');
    expect(hrefDaAba(html, 'Todos')).toBe('/painel/pacientes?aba=todos&busca=ana&etiqueta=e1&ordem=recentes');
    expect(hrefDaAba(html, 'Ativos')).toBe('/painel/pacientes?aba=ativos&busca=ana&etiqueta=e1&ordem=recentes');
  });

  it('bloqueados: o título e "Voltar para a lista", nenhuma aba marcada e a situação em campo oculto', async () => {
    lista = [linha({ status: 'bloqueado' })];
    const html = await render({ situacao: 'bloqueados' });
    expect(abaMarcada(html)).toEqual([]);
    expect(html).toContain('Bloqueados por pedido de exclusão (LGPD): só para consulta.');
    expect(hrefDaAba(html, 'Voltar para a lista')).toBe('/painel/pacientes?aba=ativos');
    const form = html.match(/<form [^>]*method="get"[\s\S]*?<\/form>/)![0];
    expect(form).toContain('<input type="hidden" name="situacao" value="bloqueados"/>');
    expect(form).not.toContain('name="aba"');
    expect(html).toContain('Sem acesso (bloqueado)');
    expect(pedidos.at(-1)).toEqual({ aba: 'bloqueados', ordem: 'nome' });
  });

  it('colunas da §8.1; "Desde" no fuso do consultório; "Acesso ao app" curto', async () => {
    lista = [linha(), linha({ id: B, nome: 'Bia Lima', email: 'bia@ex.com', userId: 'u1', createdAt: new Date('2026-11-12T02:00:00Z') })];
    const html = await render();
    expect([...html.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1])).toEqual(['Nome', 'Idade', 'E-mail', 'Acesso ao app', 'Desde', 'Ações']);
    expect(html).not.toContain('Acesso ao portal');
    expect(html).toContain('03/02/2025');
    expect(html).toContain('11/11/2026'); // 02h UTC = 23h do dia 11 em São Paulo
    expect(html).toContain('>Pendente<');
    expect(html).toContain('>Ativo<');
  });

  it('só o nome social na linha (o de registro fica na ficha); o arquivado de "Todos" leva o selo e "Sem acesso (arquivado)"', async () => {
    lista = [linha({ nome: 'João Silva', nomeSocial: 'Joana Silva' }), linha({ id: B, nome: 'Bia Lima', status: 'arquivado', userId: 'u1' })];
    const html = await render({ aba: 'todos' });
    expect(html).toMatch(new RegExp(`<a [^>]*href="/painel/pacientes/${A}"[^>]*>Joana Silva</a>`));
    expect(html).toContain('Joana Silva');
    expect(html).not.toContain('João Silva');
    expect(html).toContain('Ações de Joana Silva');
    expect(html).toContain('>Arquivado<');
    expect(html).toContain('Sem acesso (arquivado)');
  });

  it('região role="status" fixa acima da tabela: vazia sem ok, com o texto do servidor com ok', async () => {
    let html = await render();
    expect(regiao(html)?.[1]).toBe('');
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('<table'));
    html = await render({ ok: 'arquivado' });
    expect(regiao(html)?.[1]).toBe('Paciente arquivado.');
    expect(regiao(await render({ ok: 'reativado' }))?.[1]).toBe('Paciente reativado.');
    expect(regiao(await render({ ok: '<b>x</b>' }))?.[1]).toBe('');
    // o marcador da ação (r) não muda o texto, nem o malformado; e não entra nos links da lista
    const comR = await render({ ok: 'arquivado', r: '0a1b2c3d' });
    expect(regiao(comR)?.[1]).toBe('Paciente arquivado.');
    expect(comR).not.toContain('0a1b2c3d');
    expect(regiao(await render({ ok: 'arquivado', r: '<b>' }))?.[1]).toBe('Paciente arquivado.');
    // título focável (o foco vai a ele depois de arquivar)
    expect(html).toMatch(/<h1 [^>]*id="titulo-pacientes"[^>]*tabindex="-1"[^>]*>Pacientes<\/h1>/);
  });

  it('vazio: "Nenhum paciente encontrado."; Inativos sem busca: "Nenhum paciente arquivado."; a região continua montada', async () => {
    lista = [];
    let html = await render();
    expect(html).toContain('Nenhum paciente encontrado.');
    expect(regiao(html)).not.toBeNull();
    html = await render({ aba: 'inativos', ok: 'reativado' });
    expect(html).toContain('Nenhum paciente arquivado.');
    expect(regiao(html)?.[1]).toBe('Paciente reativado.');
    expect(await render({ aba: 'inativos', busca: 'x' })).toContain('Nenhum paciente encontrado.');
  });
});
