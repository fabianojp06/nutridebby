import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem da página: sessão e plano simulados.
vi.mock('next/navigation', async (orig) => ({ ...(await orig<typeof import('next/navigation')>()), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo' }, vinculo: { patientId: '00000000-0000-4000-8000-0000000000a1' } }),
}));
vi.mock('@/app/p/moldura', () => ({
  molduraDaSecao: async () => ({ marca: { nome: 'Consultório', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }),
}));
const LINK = vi.hoisted(() => 'https://exemplo.com.br/receitas/lanche-integral-com-frutas-vermelhas-e-aveia-em-flocos-finos');
const respostas = vi.hoisted(() => vi.fn(async () => new Set<string>()));
const selo = vi.hoisted(() => ({ ia: false }));
vi.mock('@/modules/portal/diario', () => ({ respostasDeHoje: respostas }));
vi.mock('@/modules/portal/plano', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/portal/plano')>()),
  planoDoPaciente: async () => ({
    id: 'p1',
    titulo: 'Plano de outubro',
    seloIa: selo.ia,
    orientacoes: `Leia ${LINK}`,
    totalKcal: null,
    mostrarCalorias: false,
    pdf: 'indisponivel',
    proximaRefeicaoId: null,
    refeicoes: [
      {
        id: 'r1',
        nome: 'Almoço',
        horario: '12:00',
        observacao: `Veja ${LINK}`,
        kcal: null,
        itens: [{ id: 'i1', nome: 'Arroz branco', quantidade: '100 g', kcal: null, substituicoes: [{ id: 's1', nome: 'Batata', quantidade: '150 g', kcal: null }] }],
      },
    ],
  }),
}));
const { default: MeuPlano } = await import('./page');

describe('/p/plano em sanfona (US-196, F-Plano)', () => {
  it('cada refeição é um <details> com o h3 "{nome} · {HH:MM}" e o summary sem flex/grid (marcador visível); as trocas escritas; nada do diário na cópia offline', async () => {
    const html = renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve({}) } as never));
    expect(html).toMatch(/<details id="ref-r1"[^>]*><summary[^>]*><h3[^>]*>Almoço · 12:00<\/h3>/);
    expect(html).not.toMatch(/<summary[^>]*class="[^"]*\b(flex|grid|inline-flex)\b/);
    expect(html).toContain('ou batata, 150 g');
    expect(html).not.toContain('No diário'); // §4.8/§10: a cópia offline não guarda o que o paciente comeu hoje
    expect(respostas).not.toHaveBeenCalled();
    expect(html).toMatch(/<button[^>]*>Comi assim<\/button>/);
    expect(html).toContain('href="/p/conteudos"'); // G-D8 ★ = a: Conteúdos dentro de Plano
    expect(html).toContain('href="/p/compras"');
  });

  it('o texto livre da nutricionista (observação da refeição e orientações do plano) quebra: um link longo não faz a página rolar na horizontal a 320 px', async () => {
    const html = renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve({}) } as never));
    for (const texto of [`Veja ${LINK}`, `Leia ${LINK}`]) {
      const classe = new RegExp(`<p class="([^"]*)">${texto.replaceAll('.', '\\.')}</p>`).exec(html)?.[1].split(' ');
      expect(classe, texto).toContain('wrap-break-word');
    }
  });

  it('selo (RN-117, A-D13): com seloIa, "Elaborado com apoio de IA e revisado pela nutricionista" logo depois do título; sem, nada', async () => {
    selo.ia = true;
    try {
      const html = renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve({}) } as never));
      expect(html).toMatch(/<h2[^>]*>Plano de outubro<\/h2><p class="[^"]*">Elaborado com apoio de IA e revisado pela nutricionista<\/p>/);
    } finally {
      selo.ia = false;
    }
    const sem = renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve({}) } as never));
    expect(sem).not.toContain('Elaborado com apoio de IA');
  });
});
