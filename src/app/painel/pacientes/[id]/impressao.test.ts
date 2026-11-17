import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Revisão da T7 (Plano 14A): só o termo da IA impresso sai sem o cabeçalho do paciente e sem as abas (US-108); as outras
// abas do prontuário (Anamnese, Atendimentos, Antropometria…) continuam saindo no papel com o nome do paciente.
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const MEDIDAS = { data: '12/10/2026', alturaM: '1,65', pesoKg: '72,4', imc: '26,6', gordura: '28,1' };
// Plano 18 (revisão da P18-03): o peso oculto no app e a ausência de avaliação mudam por caso
const estado = vi.hoisted(() => ({ pesoOcultoNoAppEm: null as Date | null, cabecalho: null as unknown }));
vi.mock('server-only', () => ({}));
vi.mock('./prontuario', () => ({
  carregarProntuario: async () => ({
    ctx: {},
    tenant: {
      fuso: 'America/Sao_Paulo', documentosLiberados: false, status: 'ativa', iaLiberada: true, iaAtivadaEm: new Date('2026-10-01T12:00:00Z'), iaAditivoVersao: '9.9',
      nomeExibicao: 'Consultório', nomeProfissional: 'Débora', crn: 'CRN-3 1', contatoEmail: 'c@ex.com',
    },
    paciente: { id: PACIENTE, nome: 'Ana Teste', status: 'ativo', anonimizadoEm: null, email: 'ana@ex.com', dataNascimento: null, sexo: 'F', pesoOcultoNoAppEm: estado.pesoOcultoNoAppEm },
  }),
  // Plano 18 (D13, RN-275): a linha de medidas da última avaliação, que não sai no papel
  carregarCabecalho: async () => estado.cabecalho,
}));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'sandbox' }) }));
vi.mock('@/modules/ia/autorizacao', () => ({ painelDaAutorizacao: async () => ({ codigoDeReferencia: 'ABCD-EFGH-JKMN' }) }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => `/painel/pacientes/${PACIENTE}/anamnese`,
  useRouter: () => ({ push: () => undefined }),
}));
const { default: ProntuarioLayout } = await import('./layout');
const { default: TermoIaPage } = await import('./privacidade/termo-ia/page');

/**
 * O elemento cuja abertura contém `marca` está dentro de algum ancestral com `print:hidden`? Percorre as tags abertas antes
 * dele (HTML do `renderToStaticMarkup`: sem tags opcionais omitidas; as void não fecham).
 */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function dentroDePrintHidden(html: string, marca: string): boolean {
  const fim = html.indexOf(marca);
  if (fim < 0) throw new Error(`não achei ${marca}`);
  const pilha: boolean[] = [];
  for (const m of html.slice(0, fim).matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g)) {
    const [, fecha, tag, attrs] = m;
    if (fecha) pilha.pop();
    else if (!VOID.has(tag.toLowerCase()) && !attrs.endsWith('/')) pilha.push(/class="[^"]*\bprint:hidden\b/.test(attrs));
  }
  return pilha.some(Boolean);
}

const renderizarLayout = async () => renderToStaticMarkup(await ProntuarioLayout({ children: null, params: Promise.resolve({ id: PACIENTE }) } as never));

describe('impressão do prontuário', () => {
  beforeEach(() => {
    estado.pesoOcultoNoAppEm = null;
    estado.cabecalho = MEDIDAS;
  });

  it('o layout não esconde o cabeçalho do paciente nem as abas na impressão (Ctrl+P da Anamnese sai com o nome), só as medidas', async () => {
    const html = await renderizarLayout();
    expect(html).toContain('data-guia="cabecalho-paciente"');
    expect(html).toContain('Ana Teste');
    expect(html).toContain('data-guia="abas-prontuario"');
    // Plano 18 (RN-275): o `h1` não fica dentro de elemento `print:hidden`; só a linha de medidas tem `print:hidden`
    expect(dentroDePrintHidden(html, '<h1')).toBe(false);
    expect(dentroDePrintHidden(html, 'data-guia="abas-prontuario"')).toBe(false);
    const medidas = html.match(/<p[^>]*>Última avaliação em [^<]*<\/p>/)?.[0] ?? '';
    expect(medidas).toContain('Última avaliação em 12/10/2026: altura 1,65 m · peso 72,4 kg · IMC 26,6 · gordura 28,1%');
    expect(medidas).toMatch(/class="[^"]*\bprint:hidden\b/);
    expect(html.match(/\bprint:hidden\b/g)).toHaveLength(1);
  });

  it('selo "Peso oculto no app": aparece com pesoOcultoNoAppEm preenchido e some com nulo', async () => {
    expect(await renderizarLayout()).not.toContain('Peso oculto no app');
    estado.pesoOcultoNoAppEm = new Date('2026-10-01T12:00:00Z');
    const html = await renderizarLayout();
    expect(html).toContain('Peso oculto no app');
    expect(dentroDePrintHidden(html, 'Peso oculto no app')).toBe(false);
  });

  it('sem avaliação: "Sem avaliação antropométrica." dentro do elemento print:hidden', async () => {
    estado.cabecalho = null;
    const html = await renderizarLayout();
    expect(html).toContain('Sem avaliação antropométrica.');
    expect(html).not.toContain('Última avaliação em');
    expect(dentroDePrintHidden(html, 'Sem avaliação antropométrica.')).toBe(true);
    expect(html.match(/\bprint:hidden\b/g)).toHaveLength(1);
  });

  it('a página do termo da IA esconde, só na impressão dela, o cabeçalho do paciente e as abas', async () => {
    const html = renderToStaticMarkup(await TermoIaPage({ params: Promise.resolve({ id: PACIENTE }) } as never));
    expect(html).toContain('id="termo-ia"');
    const css = html.match(/<style>([\s\S]*?)<\/style>/g)?.join('') ?? '';
    expect(css).toMatch(/@media print\s*\{\s*\[data-guia="cabecalho-paciente"\],\s*\[data-guia="abas-prontuario"\]\s*\{\s*display:\s*none/);
  });
});
