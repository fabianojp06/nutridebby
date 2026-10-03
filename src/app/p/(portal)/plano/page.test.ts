import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem da página: sessão e plano simulados.
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' }, vinculo: { patientId: '00000000-0000-4000-8000-0000000000a1' } }),
}));
vi.mock('@/modules/portal/plano', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/portal/plano')>()),
  planoDoPaciente: async () => ({
    id: 'p1',
    titulo: 'Plano de outubro',
    totalKcal: null,
    pdf: 'indisponivel',
    proximaRefeicaoId: null,
    refeicoes: [
      {
        id: 'r1',
        nome: 'Almoço',
        horario: '12:00',
        observacao: null,
        itens: [{ id: 'i1', nome: 'Arroz branco', quantidade: '100 g', kcal: null, substituicoes: [{ id: 's1', nome: 'Batata', quantidade: '150 g', kcal: null }] }],
      },
    ],
  }),
}));
const { default: MeuPlano } = await import('./page');

describe('/p/plano: substituições (WCAG 2.5.3)', () => {
  it('o <summary> não tem aria-label: o nome acessível começa pelo texto visível e o "ver substituições" vai em sr-only', async () => {
    const html = renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve({}) } as never));
    expect(html).toContain('<summary class="min-h-11 cursor-pointer">Arroz branco — 100 g<span class="sr-only"> (ver substituições)</span></summary>');
    expect(html).not.toContain('aria-label="Ver substituições');
  });
});
