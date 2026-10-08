import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MSG_MURAL } from '@/modules/portal/mural-regras';

vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/env', () => ({ getEnv: () => ({ VAPID_PUBLIC_KEY: undefined }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, data: { user: { id: 'u1', email: 'marina@ex.com' } }, vinculo: { patientId: 'p1' }, tenant: { fuso: 'America/Sao_Paulo', examesPacienteAtivadoEm: null } }),
}));
vi.mock('@/app/p/moldura', () => ({ molduraDaSecao: async () => ({ marca: { nome: 'Consultório Debby', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }) }));
vi.mock('@/modules/portal/mural', () => ({ muralDoPaciente: async () => ({ primeiroNome: 'Marina', vazio: true, semPlano: true, hoje: [], anteriores: [] }) }));
vi.mock('@/modules/portal/jornada', () => ({
  miniJornadaDoPaciente: async () => ({
    linha1: '−4,2 kg desde março',
    linha2: { semFuso: 'Próximo marco: consulta amanhã, 14:00', comFuso: 'Próximo marco: consulta amanhã, 14:00 (horário de Brasília)' },
    complemento: '78,6 kg na última consulta',
    pontos: [82.8, 78.6],
    podeAgendar: true,
  }),
}));
vi.mock('../agenda/actions', () => ({ confirmarAction: async () => ({}) }));
const { default: Hoje } = await import('./page');

describe('/p/inicio — Hoje (US-191, RN-193, RN-202)', () => {
  it('faixa com "Olá, Marina", a mini-jornada (link para Jornada, nome acessível que contém o texto visível), o rodapé fixo, "Ver todo o diário" e a barra de ações', async () => {
    const html = renderToStaticMarkup(await Hoje());
    expect(html).toMatch(/<h1[^>]*>Olá, Marina<\/h1>/);
    // WCAG 2.5.3 (Rótulo no nome): sem aria-label no link — o texto visível faz parte do nome; o resto vai em sr-only
    expect(html).not.toMatch(/<a[^>]*href="\/p\/jornada"[^>]*aria-label/);
    expect(html).toContain('<span class="sr-only">Sua jornada: </span>−4,2 kg desde março<span class="sr-only"> (78,6 kg na última consulta)</span>');
    // no servidor (e sem JavaScript) o fuso do aparelho é desconhecido: a versão com a sigla (nunca ambígua, como QuandoLocal)
    expect(html).toContain('Próximo marco: consulta amanhã, 14:00 (horário de Brasília)');
    expect(html).toContain(MSG_MURAL.rodape);
    expect(html).toContain('href="/p/diario"');
    expect(html).toContain('<nav aria-label="Ações"');
    expect(html).not.toContain('Enviar exame'); // recebimento desligado (RN-215)
    expect(html).not.toMatch(/<textarea|Meu acompanhamento/);
  });
});
