import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
const TODOS = [0, 1, 2, 3, 4, 5, 6];
const refeicao = (o: Record<string, unknown> = {}) => ({
  id: 'r1',
  nome: 'Almoço',
  horario: '12:00',
  observacao: `Veja ${LINK}`,
  dias: TODOS,
  descricaoLivre: null,
  kcal: null,
  itens: [{ id: 'i1', nome: 'Arroz branco', quantidade: '100 g', kcal: null, substituicoes: [{ id: 's1', nome: 'Batata', quantidade: '150 g', kcal: null }] }],
  ...o,
});
const PLANO = {
  id: 'p1',
  titulo: 'Plano de outubro',
  orientacoes: `Leia ${LINK}`,
  mostrarCalorias: false,
  pdf: 'indisponivel',
  hoje: 1,
  proxima: null,
  refeicoes: [refeicao()],
  perfis: [{ dias: TODOS, titulo: 'Todos os dias', totalKcal: null, refeicaoIds: ['r1'] }],
  listas: [] as unknown[],
  conteudos: [] as unknown[],
};
const plano = vi.hoisted(() => ({ atual: null as Record<string, unknown> | null }));
vi.mock('@/modules/portal/plano', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/portal/plano')>()),
  planoDoPaciente: async () => ({ ...(plano.atual ?? PLANO), seloIa: selo.ia }),
}));
const ia = vi.hoisted(() => ({ entrada: 'nenhuma' }));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'sandbox', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
vi.mock('@/modules/ia/nutri-paciente/estado', () => ({ entradaDoPaciente: async () => ia.entrada }));
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

  describe('Plano 15 (US-170, §4.2, §7.8): as entradas da IA Nutri', () => {
    const pagina = async (busca: Record<string, string> = {}) => renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve(busca) } as never));
    it('"Tirar dúvida sobre o plano" ao lado de "Lista de compras" e "Conteúdos" (mesma classe) e "Perguntar sobre esta refeição" com ?sobre=<id> — com a entrada conversa, decidir, texto_mudou ou indisponível', async () => {
      for (const e of ['conversa', 'decidir', 'texto_mudou', 'indisponivel']) {
        ia.entrada = e;
        const html = await pagina();
        const conteudos = /<a class="([^"]*)" href="\/p\/conteudos">Conteúdos<\/a>/.exec(html)?.[1];
        expect(html, e).toMatch(new RegExp(`<a class="${conteudos}" href="/p/plano/ia">Tirar dúvida sobre o plano</a>`));
        expect(html, e).toMatch(/<a[^>]*href="\/p\/plano\/ia\?sobre=r1"[^>]*>Perguntar sobre esta refeição<\/a>/);
      }
    });
    it('sem entrada (nenhuma, sem plano): nada da IA Nutri', async () => {
      for (const e of ['nenhuma', 'sem_plano']) {
        ia.entrada = e;
        const html = await pagina();
        expect(html, e).not.toContain('/p/plano/ia');
        expect(html, e).not.toContain('IA Nutri');
      }
    });
    it('?ia-nutri=indisponivel (o aceite recusado pelo bloqueio, o consultório desligado ou a pausa) → "A IA Nutri não está disponível no momento." numa região de status focável; outro valor → nada', async () => {
      ia.entrada = 'nenhuma';
      expect(await pagina({ 'ia-nutri': 'indisponivel' })).toMatch(/<p tabindex="-1" role="status"[^>]*>A IA Nutri não está disponível no momento\.<\/p>/);
      const outro = await pagina({ 'ia-nutri': '<b>x</b>' });
      expect(outro).not.toContain('não está disponível');
      expect(outro).not.toContain('&lt;b&gt;');
    });
  });
});

describe('Plano 19: os dias e "Ligado ao seu plano" (RN-247 c, RN-252, RN-253, US-236, US-239)', () => {
  const pagina = async () => renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve({}) } as never));
  afterEach(() => {
    plano.atual = null;
    vi.useRealTimers();
  });
  const SEG_A_SEX = [1, 2, 3, 4, 5];
  const comDoisPerfis = {
    ...PLANO,
    mostrarCalorias: true,
    refeicoes: [
      refeicao({ id: 'r-semana', nome: 'Almoço', horario: '12:00', dias: SEG_A_SEX, kcal: '600 kcal', observacao: '' }),
      refeicao({ id: 'r-fds', nome: 'Almoço', horario: '12:30', dias: [6, 0], kcal: '800 kcal', observacao: '' }),
    ],
    perfis: [
      { dias: SEG_A_SEX, titulo: 'Segunda a sexta', totalKcal: '600 kcal', refeicaoIds: ['r-semana'] },
      { dias: [6, 0], titulo: 'Sábado e domingo', totalKcal: '800 kcal', refeicaoIds: ['r-fds'] },
    ],
  };
  /** O relógio do servidor no fuso do consultório (São Paulo, UTC−3). */
  const em = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  };

  it('num sábado: "Hoje (sáb)" com o total do sábado (800, nunca 600 + 800) e os outros dias em "Ver outros dias" (alvo de 44 px), com o título por extenso e o total de cada um', async () => {
    plano.atual = comDoisPerfis;
    em('2026-11-14T15:00:00Z'); // sábado, 12:00 em São Paulo
    const html = await pagina();
    expect(html).toMatch(/<h2 id="[^"]+"[^>]*>Hoje \(sáb\)<\/h2><p>Total do dia: 800 kcal<\/p>/);
    expect(html).not.toContain('1400 kcal');
    expect(html).not.toContain('1.400 kcal');
    expect(html).toMatch(/<details[^>]*><summary class="min-h-11[^"]*">Ver outros dias<\/summary>/);
    expect(html.indexOf('Hoje (sáb)')).toBeLessThan(html.indexOf('Ver outros dias'));
    expect(html.slice(html.indexOf('Ver outros dias'))).toMatch(/<h2[^>]*>Segunda a sexta<\/h2><p>Total do dia: 600 kcal<\/p>/);
    // a âncora (AbrirRefeicaoDaUrl) existe nas duas refeições
    expect(html).toContain('id="ref-r-fds"');
    expect(html).toContain('id="ref-r-semana"');
  });

  it('RN-247 (e): a refeição de outro dia (em "Ver outros dias") abre só para leitura — sem as três respostas, com "Você responde a esta refeição no dia dela."', async () => {
    plano.atual = comDoisPerfis;
    em('2026-11-14T15:00:00Z');
    const html = await pagina();
    const hoje = html.slice(0, html.indexOf('Ver outros dias'));
    const outros = html.slice(html.indexOf('Ver outros dias'));
    expect(hoje).toMatch(/<button[^>]*>Comi assim<\/button>/);
    expect(hoje).toContain('Mandar foto do prato');
    expect(hoje).not.toContain('Você responde a esta refeição no dia dela.');
    expect(outros).not.toMatch(/Comi assim|Mandar foto do prato|Comi outra coisa/);
    expect(outros).toContain('Você responde a esta refeição no dia dela.');
  });

  it('dia sem refeição: "Seu plano não tem refeições para hoje." e os dias com refeição em "Ver outros dias"', async () => {
    plano.atual = { ...comDoisPerfis, perfis: [comDoisPerfis.perfis[0]], refeicoes: [comDoisPerfis.refeicoes[0]] };
    em('2026-11-14T15:00:00Z');
    const html = await pagina();
    expect(html).toMatch(/>Hoje \(sáb\)<\/h2><p>Seu plano não tem refeições para hoje\.<\/p>/);
    expect(html).toContain('Ver outros dias');
  });

  it('com um perfil só (todas as refeições nos 7 dias), nada muda: sem "Hoje (…)" nem "Ver outros dias"', async () => {
    const html = await pagina();
    expect(html).not.toContain('Hoje (');
    expect(html).not.toContain('Ver outros dias');
  });

  it('texto livre (RN-243, RN-254): "Sua nutricionista:" com o texto que quebra (whitespace-pre-line, wrap-break-word), sem kcal', async () => {
    plano.atual = { ...PLANO, refeicoes: [refeicao({ itens: [], descricaoLivre: `Arroz e feijão.\n${LINK}` })] };
    const html = await pagina();
    expect(html).toMatch(/<p class="text-sm font-semibold">Sua nutricionista:<\/p><p class="whitespace-pre-line wrap-break-word">Arroz e feijão\./);
    expect(html).not.toContain('Cerca de');
    expect(html).not.toContain('divide-y'); // sem lista de itens vazia
  });

  it('"Ligado ao seu plano": a lista inline (orientação com a voz dela) e as receitas e materiais com "Abrir precisa de internet." e ?de=plano', async () => {
    plano.atual = {
      ...PLANO,
      listas: [{ nome: 'Trocas do dia a dia', orientacao: `Troque ${LINK}`, grupos: [{ nome: 'Carboidratos — 1 porção', itens: [{ nome: 'Batata-doce', quantidade: '150 g', kcal: '130 kcal' }] }] }],
      conteudos: [{ id: 'c1', titulo: 'Como montar o prato', tipo: 'orientacao' }],
    };
    const html = await pagina();
    expect(html).toMatch(/<h2 id="ligado-ao-plano"[^>]*>Ligado ao seu plano<\/h2>/);
    expect(html).toMatch(/<h3[^>]*>Lista de substituição<\/h3>/);
    expect(html).toContain('Trocas do dia a dia');
    expect(html).toMatch(/<p class="text-sm font-semibold">Sua nutricionista:<\/p><p class="whitespace-pre-line wrap-break-word">Troque /);
    expect(html).toContain('Carboidratos — 1 porção');
    expect(html).toContain('150 g · 130 kcal');
    expect(html).toMatch(/<h3[^>]*>Receitas e materiais do seu plano<\/h3><p[^>]*>Abrir precisa de internet\.<\/p>/);
    expect(html).toMatch(/<a class="inline-flex min-h-11[^"]*" href="\/p\/conteudos\/c1\?de=plano">/);
    expect(html).toContain('Como montar o prato');
    expect(html).toContain('(Orientação)');
  });

  it('sem lista nem conteúdo ligados, a seção não aparece', async () => {
    expect(await pagina()).not.toContain('Ligado ao seu plano');
  });
});
