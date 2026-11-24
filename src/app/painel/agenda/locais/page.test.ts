import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalNaTela } from '@/modules/agenda/locais';

const dados = vi.hoisted(() => ({ locais: [] as unknown[], avisoLinkDivergente: false }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({ requireNutri: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } }) }));
vi.mock('@/modules/agenda/locais', async (original) => ({
  ...(await original<typeof import('@/modules/agenda/locais')>()),
  listarLocais: async () => ({ locais: dados.locais, avisoLinkDivergente: dados.avisoLinkDivergente }),
}));
// Plano 23 (T8): a aba "Solicitações" tem teste próprio (solicitacoes/page.test.ts); aqui, sem a aba
vi.mock('@/modules/agenda/solicitacoes', () => ({ abaDeSolicitacoes: async () => null }));
vi.mock('./actions', () => ({
  salvarLocalAction: vi.fn(),
  definirPrincipalAction: vi.fn(),
  arquivarLocalAction: vi.fn(),
  reativarLocalAction: vi.fn(),
  excluirLocalAction: vi.fn(),
}));
const { default: LocaisPage } = await import('./page');
const { FocoNoTitulo, StatusDosLocais } = await import('./foco');

/** Os elementos de um tipo na árvore devolvida pela página (os componentes de cliente não são expandidos por ela). */
function elementosDe(no: ReactNode, tipo: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(no)) return no.flatMap((n) => elementosDe(n, tipo));
  if (!isValidElement<{ children?: ReactNode }>(no)) return [];
  return [...(no.type === tipo ? [no as ReactElement<Record<string, unknown>>] : []), ...elementosDe(no.props.children, tipo)];
}
const arvore = async (sp: Record<string, string> = {}) => (await LocaisPage({ searchParams: Promise.resolve(sp) } as never)) as ReactElement;

const local = (extra: Partial<LocalNaTela>): LocalNaTela => ({
  id: '00000000-0000-4000-8000-000000000001', nome: 'Consultório', tipo: 'presencial', endereco: 'Rua A, 10', cidade: 'Recife', mostrarEndereco: false,
  linkSala: null, agendamentoOnline: true, principal: false, arquivadoEm: null, emUso: false, ...extra,
});
const CONSULTORIO = local({ principal: true, emUso: true });
const CLINICA = local({ id: '00000000-0000-4000-8000-000000000002', nome: 'Clínica Centro', emUso: false });
const VIDEO = local({ id: '00000000-0000-4000-8000-000000000003', nome: 'Videoconferência', tipo: 'online', endereco: null, cidade: null, linkSala: null, agendamentoOnline: false, emUso: true });

async function html(sp: Record<string, string> = {}) {
  const el = (await LocaisPage({ searchParams: Promise.resolve(sp) } as never)) as ReactElement;
  return renderToStaticMarkup(el);
}
const TELENUTRICAO = 'Antes do primeiro atendimento online, faça o cadastro no e-Nutricionista e colha o TCLE de telenutrição, guardando o comprovante. Não grave as consultas.';
const SALA_DE_ESPERA = 'Use sala de espera ou senha e admita um paciente por vez.';
const textoDe = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const rotulos = (h: string) => [...h.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);

beforeEach(() => {
  dados.locais = [CONSULTORIO, CLINICA, VIDEO];
  dados.avisoLinkDivergente = false;
});

describe('Locais de atendimento (US-400)', () => {
  it('local em uso mostra "Em uso: arquive" no lugar de "Excluir"; o principal tem o selo e não se exclui', async () => {
    const h = await html();
    expect(h).toContain('<h1');
    expect(textoDe(h)).toContain('Locais de atendimento');
    expect(textoDe(h)).toContain('Em uso: arquive');
    const r = rotulos(h);
    expect(r).toContain('Excluir Clínica Centro');
    expect(r).not.toContain('Excluir Videoconferência');
    expect(r).not.toContain('Excluir Consultório');
    expect(r).toContain('Definir como principal: Clínica Centro');
    expect(r).not.toContain('Definir como principal: Consultório');
    expect(textoDe(h)).toContain('Principal');
  });

  it('botões repetidos com o nome no aria-label: "Editar {nome}" e "Arquivar {nome}" (com mais de um local)', async () => {
    const r = rotulos(await html());
    for (const nome of ['Consultório', 'Clínica Centro', 'Videoconferência']) {
      expect(r).toContain(`Editar ${nome}`);
      expect(r).toContain(`Arquivar ${nome}`);
    }
  });

  it('vazio: o texto da §6.2 com o link para cadastrar', async () => {
    dados.locais = [];
    const h = await html();
    expect(textoDe(h)).toContain('Cadastre um local de atendimento para marcar consultas e definir horários.');
    expect(h).toMatch(/<a[^>]*href="\/painel\/agenda\/locais\?novo=1"[^>]*>Novo local<\/a>/);
  });

  it('aviso de telenutrição só no formulário do local de videoconferência; com sala fixa, também o da sala de espera', async () => {
    expect(textoDe(await html({ novo: '1' }))).not.toContain(TELENUTRICAO);
    expect(textoDe(await html({ editar: CLINICA.id }))).not.toContain(TELENUTRICAO);
    const semSala = textoDe(await html({ editar: VIDEO.id }));
    expect(semSala).toContain(TELENUTRICAO);
    expect(semSala).not.toContain(SALA_DE_ESPERA);
    dados.locais = [CONSULTORIO, { ...VIDEO, linkSala: 'https://sala.exemplo.test/x' }];
    const comSala = textoDe(await html({ editar: VIDEO.id }));
    expect(comSala).toContain(TELENUTRICAO);
    expect(comSala).toContain(SALA_DE_ESPERA);
    // a lista não repete o aviso fora do formulário
    expect(textoDe(await html())).not.toContain(TELENUTRICAO);
  });

  it('formulário: no presencial, "Mostrar o endereço" vem desmarcado e o nome leva a ajuda; em uso, o tipo vira texto', async () => {
    const novo = await html({ novo: '1' });
    expect(textoDe(novo)).toContain('Não use nome nem endereço de paciente.');
    expect(novo).toMatch(/<input[^>]*name="mostrarEndereco"(?![^>]*checked)[^>]*>/);
    expect(novo).toMatch(/<input[^>]*type="radio"[^>]*name="tipo"/);
    const emUso = await html({ editar: CONSULTORIO.id });
    expect(emUso).not.toMatch(/name="tipo"/);
    expect(textoDe(emUso)).toContain('Tipo: Presencial');
  });

  it('mensagens da volta das ações em role="status" ou role="alert"; valor fora da lista fechada não mostra nada', async () => {
    expect(await html({ ok: 'salvo' })).toMatch(/<p[^>]*role="status"[^>]*>Local salvo\.<\/p>/);
    expect(await html({ ok: 'arquivado' })).toContain('Local arquivado.');
    expect(await html({ erro: 'principalNaoArquiva' })).toMatch(/role="alert"[^>]*>Defina outro local como principal antes de arquivar este\.</);
    const estranho = await html({ ok: 'constructor', erro: 'toString' });
    expect(estranho).not.toContain('role="alert"');
    expect(estranho).toMatch(/<p[^>]*role="status"[^>]*><\/p>/);
  });

  it('aviso do link do Perfil (P23-I1) na linha do local "Videoconferência"', async () => {
    expect(textoDe(await html())).not.toContain('O link do Perfil mudou depois da atualização: confira a sala deste local.');
    dados.avisoLinkDivergente = true;
    expect(textoDe(await html())).toContain('O link do Perfil mudou depois da atualização: confira a sala deste local.');
  });

  it('abas: Agenda · Aniversariantes (T10) · Pendências · Horários · Locais, sem link para página que não existe (AG-D72; Solicitações só com a chave ou pedido)', async () => {
    const h = await html();
    const nav = h.match(/<nav[^>]*aria-label="Seções da agenda"[^>]*>([\s\S]*?)<\/nav>/)![1];
    const links = [...nav.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([
      ['/painel/agenda', 'Agenda'],
      ['/painel/agenda/aniversariantes', 'Aniversariantes'],
      ['/painel/agenda/pendencias', 'Pendências'],
      ['/painel/agenda/horarios', 'Horários'],
      ['/painel/agenda/locais', 'Locais'],
    ]);
    expect([...nav.matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map((m) => m[1])).toEqual(['Locais']);
    expect(nav).not.toMatch(/Solicitações/);
  });

  it('foco (RNF-401): o h1 recebe o foco depois das ações — FocoNoTitulo só com ok/erro, com key pelo marcador `r`', async () => {
    expect(await html()).toMatch(/<h1[^>]*id="titulo-locais"[^>]*tabindex="-1"/i);
    expect(elementosDe(await arvore(), FocoNoTitulo)).toEqual([]);
    expect(elementosDe(await arvore({ r: 'abcd1234' }), FocoNoTitulo)).toEqual([]); // marcador sem ação: nada
    const [foco] = elementosDe(await arvore({ ok: 'arquivado', r: 'abcd1234' }), FocoNoTitulo);
    expect(foco.key).toBe('arquivado-abcd1234');
    expect(elementosDe(await arvore({ erro: 'emUso', r: '0f0f0f0f' }), FocoNoTitulo).map((e) => e.key)).toEqual(['emUso-0f0f0f0f']);
    expect(elementosDe(await arvore({ ok: 'constructor', r: 'abcd1234' }), FocoNoTitulo)).toEqual([]);
    // a região de status recebe o marcador (fora do formato, vazio) e o texto da lista fechada
    expect(elementosDe(await arvore({ ok: 'salvo', r: 'abcd1234' }), StatusDosLocais).map((e) => e.props)).toEqual([{ texto: 'Local salvo.', marcador: 'abcd1234' }]);
    expect(elementosDe(await arvore({ ok: 'salvo', r: '<script>' }), StatusDosLocais).map((e) => e.props)).toEqual([{ texto: 'Local salvo.', marcador: '' }]);
  });

  it('"Editar" e "Novo local" levam o foco ao formulário: autofocus no "Nome do local"; a lista sozinha, não', async () => {
    for (const sp of [{ novo: '1' }, { editar: CLINICA.id }] as Record<string, string>[]) expect(await html(sp)).toMatch(/<input[^>]*autofocus=""[^>]*name="nome"|<input[^>]*name="nome"[^>]*autofocus=""/);
    expect(await html()).not.toContain('autofocus');
  });

  it('o principal de um consultório com um local só não mostra "Arquivar"; com mais de um, mostra', async () => {
    dados.locais = [CONSULTORIO];
    expect(rotulos(await html())).not.toContain('Arquivar Consultório');
    dados.locais = [CONSULTORIO, CLINICA];
    expect(rotulos(await html())).toEqual(expect.arrayContaining(['Arquivar Consultório', 'Arquivar Clínica Centro']));
  });
});
