import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem da página: sessão e consulta simuladas.
const estado = vi.hoisted(() => ({ consulta: null as unknown, semana: null as unknown }));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo', enderecoConsultorio: 'Rua do Perfil, 1' } }) }));
vi.mock('@/modules/portal/agenda', () => ({ consultaDoPaciente: async () => estado.consulta, horariosDaSemana: async () => estado.semana }));
vi.mock('../actions', () => ({ remarcarAction: async () => ({}), confirmarAction: async () => ({}), cancelarAction: async () => ({}), avisarAction: async () => ({}) }));
const { default: ConsultaDoPortal } = await import('./page');

const ID = '00000000-0000-4000-8000-000000000001';
const pagina = async () => renderToStaticMarkup(await ConsultaDoPortal({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) } as never));
const online = (status: string) => ({ id: ID, status, modalidade: 'online', linkOnline: 'https://meet.example/abc', inicio: new Date('2026-10-20T13:00:00Z'), podeAlterar: false, pedidoRemarcacao: false, localId: null, local: null });

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

describe('/p/agenda/[id]: Plano 23 (US-402, US-403)', () => {
  const CONSULTORIO = '11111111-1111-4111-8111-111111111111';
  const CENTRO = '22222222-2222-4222-8222-222222222222';
  const presencial = (extra: Record<string, unknown> = {}) => ({ ...online('agendada'), modalidade: 'presencial', linkOnline: null, podeAlterar: true, ...extra });
  const horario = (hora: string, localId: string) => ({ inicio: `2026-10-22T${hora}:00.000Z`, dia: 'qui., 22/10', data: '2026-10-22', hora, modalidades: ['presencial'], localId });
  const radio = (html: string, valor: string) => new RegExp(`<input[^>]*value="${valor}"[^>]*>`).exec(html)?.[0] ?? '';

  it('"Sua consulta" mostra o local e o endereço dele; a consulta antiga, o endereço do Perfil', async () => {
    estado.semana = null;
    estado.consulta = presencial({ podeAlterar: false, localId: CENTRO, local: { nome: 'Clínica Centro', endereco: 'Av. Central, 500' } });
    const html = await pagina();
    expect(html).toContain('Clínica Centro');
    expect(html).toContain('Endereço: Av. Central, 500');
    expect(html).not.toContain('Rua do Perfil');
    estado.consulta = presencial({ podeAlterar: false });
    expect(await pagina()).toContain('Endereço: Rua do Perfil, 1');
  });

  it('remarcar: "Onde você quer ser atendido?" com o local da consulta marcado; o endereço só quando a projeção o traz', async () => {
    estado.consulta = presencial({ localId: CENTRO, local: { nome: 'Clínica Centro', endereco: 'Av. Central, 500' } });
    estado.semana = {
      semana: '2026-10-19', primeira: '2026-10-19', ultima: '2026-12-14',
      horarios: [horario('15:00', CONSULTORIO), horario('16:00', CENTRO)],
      locais: [
        { id: CONSULTORIO, nome: 'Consultório', tipo: 'presencial', cidade: null, endereco: null },
        { id: CENTRO, nome: 'Clínica Centro', tipo: 'presencial', cidade: 'Campinas', endereco: 'Av. Central, 500' },
      ],
    };
    const html = await pagina();
    expect(html).toContain('Onde você quer ser atendido?');
    expect(radio(html, CENTRO)).toContain('checked');
    expect(radio(html, CONSULTORIO)).not.toContain('checked');
    expect(html).toContain('16:00');
    expect(html).not.toContain('15:00');
    expect(html).toContain('Clínica Centro · Campinas');
  });
});
