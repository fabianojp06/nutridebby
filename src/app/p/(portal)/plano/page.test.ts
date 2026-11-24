import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CABECALHO_PEDIDO_DA_COPIA, MARCA_DA_COPIA } from '@/app/sw-regras';

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
const ia = vi.hoisted(() => ({ entrada: 'nenhuma' }));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'sandbox', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
vi.mock('@/modules/ia/nutri-paciente/estado', () => ({ entradaDoPaciente: async () => ia.entrada }));
// SUS-112: a busca da cópia offline (guardarPlano, no service worker) leva o cabeçalho x-nd-copia; a navegação do paciente não
const pedido = vi.hoisted(() => ({ cabecalhos: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => pedido.cabecalhos }));
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


describe('SUS-112: a marca da cópia offline', () => {
  afterEach(() => {
    pedido.cabecalhos = new Headers();
  });
  it('a busca da cópia (cabeçalho x-nd-copia) leva a marca escondida; a página aberta pelo paciente, não — só a cópia recarrega quando a rede volta', async () => {
    const viva = renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve({}) } as never));
    expect(viva).not.toContain(MARCA_DA_COPIA);
    pedido.cabecalhos = new Headers({ [CABECALHO_PEDIDO_DA_COPIA]: '1' });
    const copia = renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve({}) } as never));
    expect(copia).toMatch(new RegExp(`<span hidden="" ${MARCA_DA_COPIA}=""></span>`));
    pedido.cabecalhos = new Headers({ [CABECALHO_PEDIDO_DA_COPIA]: 'outro' });
    expect(renderToStaticMarkup(await MeuPlano({ searchParams: Promise.resolve({}) } as never))).not.toContain(MARCA_DA_COPIA);
  });
});
