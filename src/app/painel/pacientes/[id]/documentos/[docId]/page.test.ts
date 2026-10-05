import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem da página: prontuário, documento e ações simulados (como /p/plano/page.test.ts).
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const DOC = '00000000-0000-4000-8000-0000000000d1';
// T9: cada caso pode trocar o paciente e o documento (o padrão é o emitido anonimizado da T6)
const caso = vi.hoisted(() => ({ paciente: null as Record<string, unknown> | null, doc: null as Record<string, unknown> | null }));
vi.mock('../../prontuario', () => ({
  carregarProntuario: async () => ({
    ctx: {},
    tenant: { fuso: 'America/Sao_Paulo', documentosLiberados: true, fitoterapiaRegistro: null },
    paciente: caso.paciente ?? { id: PACIENTE, status: 'bloqueado', anonimizadoEm: new Date('2026-10-01T12:00:00Z'), userId: null, email: 'ana@ex.com' },
    data: { user: { twoFactorEnabled: true } },
  }),
}));
// os componentes 'use client' (EnviarDigitalizada, EstadoPdf) usam o roteador, que não existe no renderToStaticMarkup
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => ({ refresh: () => undefined }) }));
// a T10 acrescenta entreguePessoalmenteAction e reenviarLinkAction; a T15, cancelarAction
vi.mock('../actions', () => ({ apagarRascunhoAction: vi.fn(), pedirNovoPdfAction: vi.fn(), voltarAEditarAction: vi.fn() }));
vi.mock('@/modules/documentos/documentos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/documentos/documentos')>()),
  // RN-140 (c): emitido anonimizado — conteudo '{}', sem PDF
  lerDocumento: async () => caso.doc ?? ({
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

describe('página do documento: digitalizada em "Aguardando assinatura" (RN-157, D24)', () => {
  const pagina = async (digitalizacaoStatus: string | null) => {
    caso.paciente = { id: PACIENTE, status: 'ativo', anonimizadoEm: null, userId: null, email: 'ana@ex.com' };
    caso.doc = {
      id: DOC, tipo: 'receita', status: 'aguardando_assinatura', codigo: 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'), assinadoEm: null,
      assinaturaTipo: null, pdfStatus: 'pronto', entregueEm: null, recibos: [], conteudo: { versao: 1, tipo: 'receita', itens: [], orientacoes: '' }, justificativa: null,
      motivoCancelamento: null, assinanteNome: null, basePdfPath: 'x', pdfPath: null, pdfSha256: null, digitalizacaoStatus, anonimizadoEm: null,
    };
    return renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve({}) } as never));
  };

  it('sem envio: o botão "Enviar documento digitalizado (assinado à mão)"', async () => {
    const html = await pagina(null);
    expect(html).toContain('Enviar documento digitalizado (assinado à mão)');
    expect(html).not.toContain('Montando o PDF digitalizado…');
  });

  it.each(['recebendo', 'pendente'])('"%s": "Montando o PDF digitalizado…" e nada de formulário (um envio por vez)', async (st) => {
    const html = await pagina(st);
    expect(html).toContain('Montando o PDF digitalizado…');
    expect(html).not.toContain('Enviar documento digitalizado');
  });

  it('"falhou": o aviso "Não foi possível montar o PDF. Envie as fotos de novo." e o botão de novo', async () => {
    const html = await pagina('falhou');
    expect(html).toContain('Não foi possível montar o PDF. Envie as fotos de novo.');
    expect(html).toContain('Enviar documento digitalizado (assinado à mão)');
  });
});
