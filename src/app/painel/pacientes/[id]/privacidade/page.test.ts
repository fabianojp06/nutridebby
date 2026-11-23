import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';

// Plano 18 (D7, RN-266): na aba Privacidade, com nome social, a instrução do pedido de exclusão pede o NOME DE REGISTRO e o
// mostra (atenderPedidoExclusao compara com patients.nome). Plano 20 (US-307, spec §6.2; LGPD art. 18, § 4º, II): o texto do
// pedido de exclusão diz que os registros de pagamento ficam. Prontuário e exportações simulados; IA ausente.
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const FRASE = 'Os registros de pagamento do Financeiro ficam guardados pelo mesmo prazo do prontuário, e as cobranças em aberto continuam valendo.';
let paciente: Record<string, unknown>;
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useActionState: (_acao: unknown, inicial: unknown) => [inicial, () => {}, false],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getEnv: () => ({}) }));
vi.mock('../prontuario', () => ({
  carregarProntuario: async () => ({
    ctx: {},
    tenant: { fuso: 'America/Sao_Paulo', nomeExibicao: 'Consultório Debby', nomeProfissional: null, crn: null, contatoEmail: null },
    paciente,
  }),
}));
vi.mock('@/modules/pacientes/exportacao', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/pacientes/exportacao')>()),
  exportacoesRecentes: async () => [],
}));
vi.mock('./actions', () => ({
  arquivarAction: vi.fn(),
  atenderExclusaoAction: vi.fn(),
  desarquivarAction: vi.fn(),
  exportarAction: vi.fn(),
}));
const { default: PrivacidadePage } = await import('./page');

async function render(): Promise<string> {
  const el = (await PrivacidadePage({ params: Promise.resolve({ id: PACIENTE }), searchParams: Promise.resolve({}) } as never)) as ReactElement;
  return renderToStaticMarkup(el);
}
const rotulo = (html: string) => html.match(/<label[^>]*for="confirmacao"[^>]*>([^<]*)<\/label>/)?.[1];
const secaoDaExclusao = (html: string) => html.slice(html.indexOf('<section aria-labelledby="exclusao"'));
const FORMULARIO = 'for="confirmacao"';

describe('aba Privacidade — pedido de exclusão (RN-266)', () => {
  beforeEach(() => {
    paciente = {
      id: PACIENTE, nome: 'João Silva', nomeSocial: null, status: 'ativo', anonimizadoEm: null, bloqueadoEm: null, anonimizarApos: null,
    };
  });

  it('com nome social: a instrução pede o nome de registro e o mostra', async () => {
    paciente.nomeSocial = 'Joana Silva';
    const html = await render();
    expect(rotulo(html)).toBe('Digite o nome de registro do paciente (João Silva) exatamente como está no cadastro para confirmar.');
    expect(html).not.toContain('Joana Silva');
  });

  it('sem nome social: a instrução de sempre', async () => {
    const html = await render();
    expect(rotulo(html)).toBe('Digite o nome do paciente para confirmar');
  });
});

describe('aba Privacidade — pedido de exclusão (Plano 20, US-307)', () => {
  beforeEach(() => {
    paciente = {
      id: PACIENTE, nome: 'João Silva', nomeSocial: null, status: 'ativo', anonimizadoEm: null, bloqueadoEm: null, anonimizarApos: null,
    };
  });

  it('a frase do Financeiro (spec §6.2) vem logo depois do texto atual da exclusão, antes do formulário', async () => {
    expect(FRASE).toBe(MSG_FINANCEIRO.lgpd.privacidadePainel);
    const secao = secaoDaExclusao(await render());
    const ordem = ['Pedido de exclusão (LGPD, art. 18)', 'No fim do prazo, os dados de identificação são anonimizados.', FRASE, FORMULARIO];
    const posicoes = ordem.map((t) => secao.indexOf(t));
    expect(posicoes.every((p) => p >= 0), String(posicoes)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(secao).toContain(`<p>${FRASE}</p>`);
  });

  it('paciente já bloqueado: só a situação do pedido, sem o texto de antes', async () => {
    paciente = { ...paciente, status: 'bloqueado', bloqueadoEm: new Date('2026-10-01T15:00:00Z'), anonimizarApos: '2046-10-01' };
    const secao = secaoDaExclusao(await render());
    expect(secao).toContain('Anonimização prevista para 01/10/2046.');
    expect(secao).not.toContain(FRASE);
    expect(secao).not.toContain(FORMULARIO);
  });
});
