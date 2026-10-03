import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem da página: sessão e consulta simuladas.
const estado = vi.hoisted(() => ({ consulta: null as unknown }));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo', linkOnlinePadrao: null } }) }));
vi.mock('@/modules/portal/agenda', () => ({ consultaDoPaciente: async () => estado.consulta, horariosDaSemana: async () => null }));
vi.mock('../actions', () => ({ remarcarAction: async () => ({}), confirmarAction: async () => ({}), cancelarAction: async () => ({}), avisarAction: async () => ({}) }));
const { default: ConsultaDoPortal } = await import('./page');

const ID = '00000000-0000-4000-8000-000000000001';
const pagina = async () => renderToStaticMarkup(await ConsultaDoPortal({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) } as never));
const online = (status: string) => ({ id: ID, status, modalidade: 'online', linkOnline: 'https://meet.example/abc', inicio: new Date('2026-10-20T13:00:00Z'), podeAlterar: false, pedidoRemarcacao: false });

describe('/p/agenda/[id]: link da chamada (US-033)', () => {
  it('consulta ativa mostra o link; cancelada ou encerrada, não', async () => {
    estado.consulta = online('agendada');
    expect(await pagina()).toContain('Link da chamada');
    for (const status of ['cancelada', 'realizada', 'faltou']) {
      estado.consulta = online(status);
      expect(await pagina(), status).not.toContain('Link da chamada');
    }
  });
});
