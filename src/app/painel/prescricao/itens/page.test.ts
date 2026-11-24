import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MSG_MODELOS } from '@/modules/documentos/modelos-textos';

// Plano 22 (T10b, spec §4.1, RN-398, R22-11): as páginas de /painel/prescricao — a sessão e o módulo simulados; a guarda
// `acessoComDocumentos` é a real (a página, e não só o layout, responde notFound sem documentos_liberados).
const caso = vi.hoisted(() => ({ liberado: true, grupos: [] as string[] }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({
  requireNutri: async () => ({ ctx: { tenantId: 't', role: 'nutri', actorUserId: 'u' }, tenant: { documentosLiberados: caso.liberado, fitoterapiaRegistro: null } }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: () => {
    throw new Error('notFound');
  },
  useRouter: () => ({ refresh: () => undefined }),
}));
vi.mock('@/modules/documentos/modelos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/documentos/modelos')>()),
  listarItensSalvos: async (_ctx: unknown, grupo: string) => {
    caso.grupos.push(grupo);
    return [];
  },
  listarModelosPrescricao: async () => [],
  abrirItemSalvo: async () => null,
  abrirModeloPrescricao: async () => null,
}));
vi.mock('./actions', () => ({ salvarItemSalvoAction: vi.fn(), excluirItemSalvoAction: vi.fn() }));
vi.mock('../modelos/actions', () => ({ salvarModeloPrescricaoAction: vi.fn(), excluirModeloPrescricaoAction: vi.fn() }));

const { default: ItensPage } = await import('./page');
const { default: NovoItemPage } = await import('./novo/page');
const { default: ItemPage } = await import('./[id]/page');
const { default: ModelosPage } = await import('../modelos/page');
const { default: ModeloPage } = await import('../modelos/[id]/page');

const ID = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
const props = (sp: Record<string, unknown> = {}, params: Record<string, string> = {}) => ({ params: Promise.resolve(params), searchParams: Promise.resolve(sp) }) as never;
beforeEach(() => {
  caso.liberado = true;
  caso.grupos = [];
});

describe('Itens salvos: /painel/prescricao/itens?tipo= (spec §4.1)', () => {
  it('tipo ausente, inválido ou repetido → "Suplementos"; "fitoterapicos" → "Fitoterápicos"', async () => {
    for (const tipo of [undefined, 'remedios', ['fitoterapicos', 'x']]) await ItensPage(props(tipo === undefined ? {} : { tipo }));
    await ItensPage(props({ tipo: 'fitoterapicos' }));
    expect(caso.grupos).toEqual(['suplementos', 'suplementos', 'suplementos', 'fitoterapicos']);
  });

  it('h1 "Itens salvos", a navegação das seções com a atual marcada, "Novo item salvo" do grupo, a região de status e a lista vazia', async () => {
    const html = renderToStaticMarkup(await ItensPage(props({ tipo: 'fitoterapicos' })));
    expect(html).toMatch(/<h1[^>]*tabindex="-1"[^>]*>Itens salvos<\/h1>/);
    expect(html).toContain('<nav aria-label="Seções de prescrição"');
    expect(html).toMatch(/<a(?=[^>]*href="\/painel\/prescricao\/itens\?tipo=fitoterapicos")(?=[^>]*aria-current="page")[^>]*>Fitoterápicos<\/a>/);
    expect(html).not.toMatch(/aria-current="page"[^>]*>Suplementos</);
    expect(html).toMatch(/href="\/painel\/prescricao\/itens\/novo\?tipo=fitoterapicos"[^>]*>Novo item salvo</);
    expect(html).toContain('role="status"');
    expect(html).toContain(MSG_MODELOS.vazioItens);
  });

  it('Modelos de prescrição: lista vazia explica que o modelo nasce da receita (sem tela de criação)', async () => {
    const html = renderToStaticMarkup(await ModelosPage(props()));
    expect(html).toMatch(/<h1[^>]*>Modelos de prescrição<\/h1>/);
    expect(html).toContain(MSG_MODELOS.vazioModelos);
    expect(html).toMatch(/aria-current="page"[^>]*>Modelos de prescrição</);
    expect(html).not.toContain('/painel/prescricao/modelos/novo');
  });

  it('item ou modelo que não existe (ou de outro consultório) → notFound', async () => {
    await expect(ItemPage(props({}, { id: ID }))).rejects.toThrow('notFound');
    await expect(ModeloPage(props({}, { id: ID }))).rejects.toThrow('notFound');
  });

  it('sem documentos_liberados: cada página responde notFound (não só o layout), sem ler a biblioteca', async () => {
    caso.liberado = false;
    await expect(ItensPage(props())).rejects.toThrow('notFound');
    await expect(NovoItemPage(props({ tipo: 'suplementos' }))).rejects.toThrow('notFound');
    await expect(ItemPage(props({}, { id: ID }))).rejects.toThrow('notFound');
    await expect(ModelosPage(props())).rejects.toThrow('notFound');
    await expect(ModeloPage(props({}, { id: ID }))).rejects.toThrow('notFound');
    expect(caso.grupos).toEqual([]);
  });
});

describe('guarda de fonte: toda página e toda action de /painel/prescricao passa por acessoComDocumentos (R22-11)', () => {
  const raiz = path.resolve('src/app/painel/prescricao');
  const arquivos = readdirSync(raiz, { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && (d.name === 'page.tsx' || d.name === 'actions.ts')).map((d) => path.join(d.parentPath, d.name));
  it('há as cinco páginas e os dois actions.ts', () => {
    expect(arquivos.filter((f) => f.endsWith('page.tsx'))).toHaveLength(5);
    expect(arquivos.filter((f) => f.endsWith('actions.ts'))).toHaveLength(2);
  });
  it.each(arquivos.map((f) => [path.relative(raiz, f), f]))('%s: um `await acessoComDocumentos(` por função exportada; nenhum requireNutri direto', (_r, f) => {
    const fonte = readFileSync(f, 'utf8');
    const funcoes = fonte.match(/export (?:default )?async function /g) ?? [];
    expect(funcoes.length).toBeGreaterThan(0);
    expect(fonte.match(/await acessoComDocumentos\(/g) ?? []).toHaveLength(funcoes.length);
    expect(fonte).not.toContain('requireNutri');
  });
});
