import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Minimização (revisão final do PR 2, Plano 18): o ConsultaForm ('use client') recebe só { id, nome, email } de cada
// paciente — nunca o resto da linha da lista (nome social, nascimento, situação do acesso, origem).
const recebido = vi.hoisted(() => ({ pacientes: null as unknown, locais: null as unknown, inicial: null as unknown }));
const locais = vi.hoisted(() => ({ lista: [{ id: '00000000-0000-4000-8000-0000000000c0', nome: 'Consultório', tipo: 'presencial', linkSala: null, principal: true }] as unknown[] }));
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
vi.mock('@/modules/agenda/locais', () => ({ locaisDoPainel: async () => locais.lista }));
vi.mock('../actions', () => ({ agendarAction: vi.fn() }));
vi.mock('../consulta-form', () => ({
  ConsultaForm: (props: { pacientes: unknown; locais: unknown; inicial: unknown }) => {
    recebido.pacientes = props.pacientes;
    recebido.locais = props.locais;
    recebido.inicial = props.inicial;
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

  it('Plano 23 (US-402, RN-407): "Local" vem com o principal; do local, só id, nome, tipo e sala', async () => {
    locais.lista = [
      { id: '00000000-0000-4000-8000-0000000000c2', nome: 'Clínica Centro', tipo: 'presencial', linkSala: null, principal: false },
      { id: '00000000-0000-4000-8000-0000000000c1', nome: 'Videoconferência', tipo: 'online', linkSala: 'https://sala.exemplo.test/x', principal: true },
    ];
    renderToStaticMarkup((await NovaConsultaPage({ searchParams: Promise.resolve({}) } as never)) as ReactElement);
    expect(recebido.locais).toEqual([
      { id: '00000000-0000-4000-8000-0000000000c2', nome: 'Clínica Centro', tipo: 'presencial', linkSala: null },
      { id: '00000000-0000-4000-8000-0000000000c1', nome: 'Videoconferência', tipo: 'online', linkSala: 'https://sala.exemplo.test/x' },
    ]);
    expect(recebido.inicial).toMatchObject({ localId: '00000000-0000-4000-8000-0000000000c1' });
  });

  it('Plano 23 (§6.2): sem nenhum local ativo, o estado vazio com o link para Locais, sem o formulário', async () => {
    locais.lista = [];
    recebido.locais = null;
    const html = renderToStaticMarkup((await NovaConsultaPage({ searchParams: Promise.resolve({}) } as never)) as ReactElement);
    expect(html).toContain('Cadastre um local de atendimento para marcar consultas e definir horários.');
    expect(html).toContain('href="/painel/agenda/locais"');
    expect(recebido.locais).toBeNull();
  });
});
