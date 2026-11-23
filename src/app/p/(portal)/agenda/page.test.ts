import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Plano 23 (US-408): "Minhas consultas" com a volta da desistência — só a montagem da página (sessão e lista simuladas).
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } }) }));
vi.mock('@/modules/portal/agenda', () => ({ consultasDoPaciente: async () => ({ proximas: [], anteriores: [], podeAgendar: true }) }));
const { default: Agenda } = await import('./page');

const pagina = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await Agenda({ searchParams: Promise.resolve(sp) } as never));

describe('/p/agenda: ?ok=pedido-cancelado (US-408)', () => {
  it('"Pedido cancelado." numa região role="status" fixa, que recebe o foco (tabIndex -1), antes da lista', async () => {
    const html = await pagina({ ok: 'pedido-cancelado' });
    expect(html).toMatch(/<p role="status" tabindex="-1"[^>]*>Pedido cancelado\.<\/p>/);
    expect(html.indexOf('Pedido cancelado.')).toBeLessThan(html.indexOf('Próximas'));
  });

  it('sem o parâmetro (ou com outro valor), a região fica montada e vazia', async () => {
    for (const sp of [{}, { ok: 'outra-coisa' }] as Record<string, string>[]) expect(await pagina(sp)).toMatch(/<p role="status" tabindex="-1"><\/p>/);
  });
});
