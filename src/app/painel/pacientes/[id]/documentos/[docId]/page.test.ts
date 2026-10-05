import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem da página: prontuário, documento e ações simulados (como /p/plano/page.test.ts).
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const DOC = '00000000-0000-4000-8000-0000000000d1';
vi.mock('../../prontuario', () => ({
  carregarProntuario: async () => ({
    ctx: {},
    tenant: { fuso: 'America/Sao_Paulo', documentosLiberados: true, fitoterapiaRegistro: null },
    paciente: { id: PACIENTE, status: 'bloqueado', anonimizadoEm: new Date('2026-10-01T12:00:00Z'), userId: null, email: 'ana@ex.com' },
    data: { user: { twoFactorEnabled: true } },
  }),
}));
// a T10 acrescenta entreguePessoalmenteAction e reenviarLinkAction; a T15, cancelarAction
vi.mock('../actions', () => ({ apagarRascunhoAction: vi.fn(), pedirNovoPdfAction: vi.fn(), voltarAEditarAction: vi.fn() }));
vi.mock('@/modules/documentos/documentos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/documentos/documentos')>()),
  // RN-140 (c): emitido anonimizado — conteudo '{}', sem PDF
  lerDocumento: async () => ({
    id: DOC, tipo: 'receita', status: 'assinado', codigo: 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'), assinadoEm: new Date('2026-09-02T12:00:00Z'),
    assinaturaTipo: 'digitalizada', pdfStatus: 'pronto', entregueEm: null, recibos: [], conteudo: {}, justificativa: null, motivoCancelamento: null,
    assinanteNome: null, basePdfPath: null, pdfPath: null, pdfSha256: 'a'.repeat(64), digitalizacaoStatus: null, anonimizadoEm: new Date('2026-10-01T12:00:00Z'),
  }),
}));
const { default: DocumentoPage } = await import('./page');

describe('página do documento: documento anonimizado (RN-140 c)', () => {
  it('não quebra com o conteúdo vazio: mostra "Documento anonimizado." e nada de itens nem de PDF', async () => {
    const html = renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve({}) } as never));
    expect(html).toContain('Documento anonimizado.');
    expect(html).not.toContain('Itens da receita');
    expect(html).not.toContain('Baixar PDF assinado');
  });
});
