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
const dia = vi.hoisted(() => ({ hoje: 1, dias: [0, 1, 2, 3, 4, 5, 6] }));
vi.mock('@/modules/portal/plano', async (orig) => ({
  ...(await orig<typeof import('@/modules/portal/plano')>()),
  planoDoPaciente: async () => ({
    id: 'p1',
    titulo: 'Plano',
    orientacoes: '',
    mostrarCalorias: true,
    pdf: 'indisponivel',
    hoje: dia.hoje,
    proxima: { id: ID, texto: 'Próxima, daqui a 1 h' },
    perfis: [],
    listas: [],
    conteudos: [],
    refeicoes: [
      {
        id: ID,
        nome: 'Almoço',
        horario: '12:30',
        observacao: 'Comece pela salada.',
        dias: dia.dias,
        descricaoLivre: null,
        kcal: '512 kcal',
        itens: [
          { id: 'i1', nome: 'Arroz integral', quantidade: '4 colheres de sopa', kcal: '160 kcal', substituicoes: [{ id: 's1', nome: 'Batata-doce', quantidade: '1 média', kcal: null }, { id: 's2', nome: 'Mandioca', quantidade: '2 pedaços', kcal: null }] },
          { id: 'i2', nome: 'feijão', quantidade: '1 concha', kcal: null, substituicoes: [] },
        ],
      },
    ],
  }),
}));
const ia = vi.hoisted(() => ({ entrada: 'nenhuma' }));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'sandbox', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
vi.mock('@/modules/ia/nutri-paciente/estado', () => ({ entradaDoPaciente: async () => ia.entrada }));
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
  it('Plano 15 (§7.8): "Perguntar sobre esta refeição" com ?sobre=<id> só com a entrada da IA Nutri', async () => {
    expect(renderToStaticMarkup(await pagina(ID))).not.toContain('Perguntar sobre esta refeição');
    ia.entrada = 'conversa';
    try {
      expect(renderToStaticMarkup(await pagina(ID))).toMatch(new RegExp(`<a[^>]*href="/p/plano/ia\\?sobre=${ID}"[^>]*>Perguntar sobre esta refeição</a>`));
    } finally {
      ia.entrada = 'nenhuma';
    }
  });
  it('Plano 19 (RN-247 e): a refeição de outro dia (link de lembrete ou da IA Nutri) abre só para leitura — sem as três respostas, com "Você responde a esta refeição no dia dela."; a pergunta à IA Nutri continua', async () => {
    dia.dias = [6];
    ia.entrada = 'conversa';
    try {
      const html = renderToStaticMarkup(await pagina(ID));
      expect(html).toContain('Arroz integral');
      expect(html).toContain('Você responde a esta refeição no dia dela.');
      expect(html).not.toMatch(/Comi assim|Mandar foto do prato|Comi outra coisa/);
      expect(html).not.toContain('/p/diario?refeicao=');
      expect(html).toContain('Perguntar sobre esta refeição');
    } finally {
      dia.dias = [0, 1, 2, 3, 4, 5, 6];
      ia.entrada = 'nenhuma';
    }
    expect(renderToStaticMarkup(await pagina(ID))).not.toContain('Você responde a esta refeição no dia dela.');
  });
  it('refeição que não é do plano publicado do paciente → 404 (RN-213)', async () => {
    await expect(pagina('1b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).rejects.toThrow('notFound');
    await expect(pagina('nao-e-uuid')).rejects.toThrow('notFound');
  });
});
