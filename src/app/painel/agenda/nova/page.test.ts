import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Minimização (revisão final do PR 2, Plano 18): o ConsultaForm ('use client') recebe só { id, nome, email } de cada
// paciente — nunca o resto da linha da lista (nome social, nascimento, situação do acesso, origem).
const recebido = vi.hoisted(() => ({ pacientes: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/tenant-session', () => ({
  requireNutri: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo', linkOnlinePadrao: null } }),
}));
vi.mock('@/modules/pacientes/pacientes', () => ({
  listarPacientes: async () => [
    {
      id: '00000000-0000-4000-8000-0000000000a1', nome: 'Ana Teste', email: 'ana@ex.com', nomeSocial: 'Joana', status: 'ativo',
      dataNascimento: '1990-05-20', userId: 'u1', origem: 'nutri', createdAt: new Date('2026-11-01T12:00:00Z'),
    },
  ],
}));
vi.mock('../actions', () => ({ agendarAction: vi.fn() }));
vi.mock('../consulta-form', () => ({
  ConsultaForm: (props: { pacientes: unknown }) => {
    recebido.pacientes = props.pacientes;
    return null;
  },
}));
const { default: NovaConsultaPage } = await import('./page');

describe('Nova consulta', () => {
  it('passa ao formulário de cliente só id, nome e e-mail de cada paciente', async () => {
    const el = (await NovaConsultaPage({ searchParams: Promise.resolve({}) } as never)) as ReactElement;
    renderToStaticMarkup(el);
    expect(recebido.pacientes).toEqual([{ id: '00000000-0000-4000-8000-0000000000a1', nome: 'Ana Teste', email: 'ana@ex.com' }]);
  });
});
