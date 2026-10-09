import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Revisão da T7 (Plano 14A): só o termo da IA impresso sai sem o cabeçalho do paciente e sem as abas (US-108); as outras
// abas do prontuário (Anamnese, Atendimentos, Antropometria…) continuam saindo no papel com o nome do paciente.
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
vi.mock('server-only', () => ({}));
vi.mock('./prontuario', () => ({
  carregarProntuario: async () => ({
    ctx: {},
    tenant: {
      fuso: 'America/Sao_Paulo', documentosLiberados: false, status: 'ativa', iaLiberada: true, iaAtivadaEm: new Date('2026-10-01T12:00:00Z'), iaAditivoVersao: '9.9',
      nomeExibicao: 'Consultório', nomeProfissional: 'Débora', crn: 'CRN-3 1', contatoEmail: 'c@ex.com',
    },
    paciente: { id: PACIENTE, nome: 'Ana Teste', status: 'ativo', anonimizadoEm: null, email: 'ana@ex.com', dataNascimento: null, sexo: 'F' },
  }),
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

describe('impressão do prontuário', () => {
  it('o layout não esconde o cabeçalho do paciente nem as abas na impressão (Ctrl+P da Anamnese sai com o nome)', async () => {
    const html = renderToStaticMarkup(await ProntuarioLayout({ children: null, params: Promise.resolve({ id: PACIENTE }) } as never));
    expect(html).toContain('data-guia="cabecalho-paciente"');
    expect(html).toContain('Ana Teste');
    expect(html).toContain('data-guia="abas-prontuario"');
    expect(html).not.toContain('print:hidden');
  });

  it('a página do termo da IA esconde, só na impressão dela, o cabeçalho do paciente e as abas', async () => {
    const html = renderToStaticMarkup(await TermoIaPage({ params: Promise.resolve({ id: PACIENTE }) } as never));
    expect(html).toContain('id="termo-ia"');
    const css = html.match(/<style>([\s\S]*?)<\/style>/g)?.join('') ?? '';
    expect(css).toMatch(/@media print\s*\{\s*\[data-guia="cabecalho-paciente"\],\s*\[data-guia="abas-prontuario"\]\s*\{\s*display:\s*none/);
  });
});
