import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const ID = '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';
vi.mock('next/navigation', async (orig) => ({
  ...(await orig<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('@/lib/paciente-session', () => ({ requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' } }) }));
vi.mock('@/modules/portal/diario', () => ({ respostasDeHoje: async () => new Set<string>() }));
vi.mock('@/modules/portal/plano', async (orig) => ({
  ...(await orig<typeof import('@/modules/portal/plano')>()),
  planoDoPaciente: async () => ({
    id: 'p1',
    titulo: 'Plano',
    orientacoes: '',
    totalKcal: null,
    mostrarCalorias: true,
    pdf: 'indisponivel',
    proximaRefeicaoId: ID,
    refeicoes: [
      {
        id: ID,
        nome: 'Almoço',
        horario: '12:30',
        observacao: 'Comece pela salada.',
        kcal: '512 kcal',
        itens: [
          { id: 'i1', nome: 'Arroz integral', quantidade: '4 colheres de sopa', kcal: '160 kcal', substituicoes: [{ id: 's1', nome: 'Batata-doce', quantidade: '1 média', kcal: null }, { id: 's2', nome: 'Mandioca', quantidade: '2 pedaços', kcal: null }] },
          { id: 'i2', nome: 'feijão', quantidade: '1 concha', kcal: null, substituicoes: [] },
        ],
      },
    ],
  }),
}));
const { default: Refeicao } = await import('./page');
const pagina = (id: string) => Refeicao({ params: Promise.resolve({ id }) } as never);

describe('/p/plano/refeicao/[id] (US-193, RN-213)', () => {
  it('chip, título com os itens principais, quantidades, trocas, observação dela, kcal e as três respostas', async () => {
    const html = renderToStaticMarkup(await pagina(ID));
    expect(html).toContain('Almoço · 12:30');
    expect(html).toMatch(/<h2[^>]*>Arroz integral e feijão<\/h2>/);
    expect(html).toContain('4 colheres de sopa');
    expect(html).toContain('ou batata-doce, 1 média · ou mandioca, 2 pedaços');
    expect(html).toContain('Observação da sua nutricionista');
    expect(html).toContain('Comece pela salada.');
    expect(html).toContain('Cerca de 512 kcal');
    expect(html).toContain(`href="/p/diario?refeicao=${ID}&amp;foto=1#registrar"`);
    expect(html).toContain(`href="/p/diario?refeicao=${ID}&amp;resposta=outra_coisa#registrar"`);
    expect(html).toMatch(/<button[^>]*>Comi assim<\/button>/);
    expect(html).toContain('aria-label="Voltar para Plano"');
  });
  it('refeição que não é do plano publicado do paciente → 404 (RN-213)', async () => {
    await expect(pagina('1b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).rejects.toThrow('notFound');
    await expect(pagina('nao-e-uuid')).rejects.toThrow('notFound');
  });
});
