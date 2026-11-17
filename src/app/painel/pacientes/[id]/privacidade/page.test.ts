import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plano 18 (D7, RN-266): na aba Privacidade, com nome social, a instrução do pedido de exclusão pede o NOME DE REGISTRO e o
// mostra (atenderPedidoExclusao compara com patients.nome). Prontuário e exportações simulados; IA ausente.
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
let paciente: Record<string, unknown>;
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useActionState: (_acao: unknown, inicial: unknown) => [inicial, () => {}, false],
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getEnv: () => ({}) }));
vi.mock('../prontuario', () => ({
  carregarProntuario: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' }, paciente }),
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
