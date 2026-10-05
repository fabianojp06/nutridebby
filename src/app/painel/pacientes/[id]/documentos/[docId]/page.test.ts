import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem da página: prontuário, documento e ações simulados (como /p/plano/page.test.ts).
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const DOC = '00000000-0000-4000-8000-0000000000d1';
// T9: cada caso pode trocar o paciente e o documento (o padrão é o emitido anonimizado da T6)
const caso = vi.hoisted(() => ({ paciente: null as Record<string, unknown> | null, doc: null as Record<string, unknown> | null, twoFactorEnabled: true as boolean | null }));
vi.mock('../../prontuario', () => ({
  carregarProntuario: async () => ({
    ctx: {},
    tenant: { fuso: 'America/Sao_Paulo', documentosLiberados: true, fitoterapiaRegistro: null },
    paciente: caso.paciente ?? { id: PACIENTE, status: 'bloqueado', anonimizadoEm: new Date('2026-10-01T12:00:00Z'), userId: null, email: 'ana@ex.com' },
    data: { user: { twoFactorEnabled: caso.twoFactorEnabled } },
  }),
}));
// os componentes 'use client' (EnviarDigitalizada, EstadoPdf) usam o roteador, que não existe no renderToStaticMarkup
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('../actions', () => ({ apagarRascunhoAction: vi.fn(), pedirNovoPdfAction: vi.fn(), voltarAEditarAction: vi.fn(), entreguePessoalmenteAction: vi.fn(), reenviarLinkAction: vi.fn(), cancelarAction: vi.fn() }));
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
    expect(html).not.toContain('Entregue pessoalmente'); // T10: sem a entrega no anonimizado
  });
});

describe('página do documento: a entrega do assinado (US-145, D3, D4, D6)', () => {
  const assinado = (recibos: unknown[] = []) => ({
    id: DOC, tipo: 'receita', status: 'assinado', codigo: 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'), assinadoEm: new Date('2026-09-02T12:00:00Z'),
    assinaturaTipo: 'digitalizada', pdfStatus: null, entregueEm: new Date('2026-09-02T12:00:00Z'), recibos, conteudo: { versao: 1, tipo: 'receita', itens: [], orientacoes: '' },
    justificativa: null, motivoCancelamento: null, assinanteNome: null, basePdfPath: null, pdfPath: 'x', pdfSha256: 'a'.repeat(64), digitalizacaoStatus: null, anonimizadoEm: null,
  });
  const pagina = async (paciente: Record<string, unknown>, doc: Record<string, unknown>, busca: Record<string, string> = {}) => {
    caso.paciente = { id: PACIENTE, anonimizadoEm: null, email: 'ana@ex.com', ...paciente };
    caso.doc = doc;
    return renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve(busca) } as never));
  };

  it('ativo sem conta: "Enviado em …", o aviso do link, "Entregue pessoalmente" e "Reenviar link por e-mail"; ?link=1 → "Link reenviado."', async () => {
    const html = await pagina({ status: 'ativo', userId: null }, assinado());
    expect(html).toContain('Enviado em 02/09/2026 · ainda não aberto');
    expect(html).toContain('Este paciente ainda não tem acesso ao app.');
    expect(html).toContain('Entregue pessoalmente');
    expect(html).toContain('Reenviar link por e-mail');
    expect(html).not.toContain('Link reenviado.');
    expect(await pagina({ status: 'ativo', userId: null }, assinado(), { link: '1' })).toContain('Link reenviado.');
  });

  it('com conta: sem "Reenviar link"; recebido: sem "Entregue pessoalmente"; arquivado: o aviso dele e sem reenviar', async () => {
    const comConta = await pagina({ status: 'ativo', userId: 'u1' }, assinado());
    expect(comConta).toContain('Entregue pessoalmente');
    expect(comConta).not.toContain('Reenviar link por e-mail');
    expect(comConta).not.toContain('Este paciente ainda não tem acesso ao app.');
    const recebido = await pagina({ status: 'ativo', userId: 'u1' }, assinado([{ evento: 'recebido', via: 'portal', em: new Date('2026-09-03T13:00:00Z') }]));
    expect(recebido).toContain('Recebido pelo paciente em 03/09/2026 às 10:00');
    expect(recebido).not.toContain('>Entregue pessoalmente<');
    const arquivado = await pagina({ status: 'arquivado', userId: null }, assinado());
    expect(arquivado).toContain('Paciente arquivado: entregue o documento pessoalmente');
    expect(arquivado).not.toContain('Reenviar link por e-mail');
  });
});

describe('página do documento: cancelar (US-149, RN-147)', () => {
  const doc = (status: string, extra: Record<string, unknown> = {}) => ({
    id: DOC, tipo: 'receita', status, codigo: 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'), assinadoEm: new Date('2026-09-02T12:00:00Z'),
    assinaturaTipo: 'digitalizada', pdfStatus: null, entregueEm: null, recibos: [], conteudo: { versao: 1, tipo: 'receita', itens: [], orientacoes: '' },
    justificativa: null, motivoCancelamento: null, assinanteNome: null, basePdfPath: null, pdfPath: 'x', pdfSha256: 'a'.repeat(64), digitalizacaoStatus: null,
    anonimizadoEm: null, canceladoEm: null, ...extra,
  });
  const pagina = async (paciente: Record<string, unknown>, d: Record<string, unknown>) => {
    caso.paciente = { id: PACIENTE, anonimizadoEm: null, email: 'ana@ex.com', userId: null, ...paciente };
    caso.doc = d;
    return renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve({}) } as never));
  };

  it('assinado: o motivo ("Fica só no prontuário.") e o botão "Cancelar documento"; arquivado também; bloqueado não', async () => {
    const html = await pagina({ status: 'ativo' }, doc('assinado'));
    expect(html).toContain('data-guia="cancelar-documento"');
    expect(html).toContain('Motivo do cancelamento');
    expect(html).toContain('Fica só no prontuário.');
    expect(html).toContain('Cancelar documento');
    expect(await pagina({ status: 'arquivado' }, doc('assinado'))).toContain('Cancelar documento');
    expect(await pagina({ status: 'bloqueado' }, doc('assinado'))).not.toContain('Cancelar documento');
  });

  it('o motivo vazio chega ao servidor: o formulário tem novalidate (o texto da US-149, não o balão do navegador)', async () => {
    const html = await pagina({ status: 'ativo' }, doc('assinado'));
    expect(html).toMatch(/<form[^>]*novalidate=""[^>]*data-guia="cancelar-documento"/i);
  });

  it('cancelado: "Cancelado em dd/mm/aaaa" e o motivo só no prontuário; sem entrega nem botão de cancelar', async () => {
    const html = await pagina({ status: 'ativo' }, doc('cancelado', { canceladoEm: new Date('2026-09-05T12:00:00Z'), motivoCancelamento: 'Dose digitada errada' }));
    expect(html).toContain('Cancelado em 05/09/2026');
    expect(html).toContain('Motivo (só no prontuário): Dose digitada errada');
    expect(html).not.toContain('Cancelar documento');
    expect(html).not.toContain('Entregue pessoalmente');
    // spec §4: a nutricionista continua vendo o emitido (o paciente ainda baixa o PDF pelo portal)
    expect(html).toContain('Assinado em');
    expect(html).toContain('02/09/2026 às 09:00');
    expect(html).toContain('Assinatura');
    expect(html).toContain('Baixar PDF assinado');
    expect(html).toContain(`/api/painel/documentos/${DOC}/pdf`);
  });

  it('cancelado: a entrega e o recebimento de antes do cancelamento só para leitura, sem "Entregue pessoalmente" nem "Reenviar link"', async () => {
    const recebido = [{ evento: 'recebido', via: 'portal', em: new Date('2026-09-03T13:00:00Z') }];
    const html = await pagina({ status: 'ativo' }, doc('cancelado', { canceladoEm: new Date('2026-09-05T12:00:00Z'), entregueEm: new Date('2026-09-02T12:00:00Z'), recibos: recebido }));
    expect(html).toContain('Recebido pelo paciente em 03/09/2026 às 10:00');
    expect(html).not.toContain('>Entregue pessoalmente<');
    expect(html).not.toContain('Reenviar link por e-mail');
    expect(html).not.toContain('Este paciente ainda não tem acesso ao app.');
    // anonimizado (RN-140 c): sem PDF e sem a entrega, como no assinado
    const anon = await pagina({ status: 'ativo' }, doc('cancelado', { canceladoEm: new Date('2026-09-05T12:00:00Z'), recibos: recebido, anonimizadoEm: new Date('2026-10-01T12:00:00Z') }));
    expect(anon).not.toContain('Baixar PDF assinado');
    expect(anon).not.toContain('Recebido pelo paciente');
  });
});

describe('página do documento: digitalizada em "Aguardando assinatura" (RN-157, D24)', () => {
  const pagina = async (digitalizacaoStatus: string | null, twoFactorEnabled: boolean | null = true, digitalizacaoEm: Date | null = digitalizacaoStatus ? new Date() : null) => {
    caso.twoFactorEnabled = twoFactorEnabled;
    caso.paciente = { id: PACIENTE, status: 'ativo', anonimizadoEm: null, userId: null, email: 'ana@ex.com' };
    caso.doc = {
      id: DOC, tipo: 'receita', status: 'aguardando_assinatura', codigo: 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'), assinadoEm: null,
      assinaturaTipo: null, pdfStatus: 'pronto', entregueEm: null, recibos: [], conteudo: { versao: 1, tipo: 'receita', itens: [], orientacoes: '' }, justificativa: null,
      motivoCancelamento: null, assinanteNome: null, basePdfPath: 'x', pdfPath: null, pdfSha256: null, digitalizacaoStatus, digitalizacaoEm, anonimizadoEm: null,
    };
    return renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve({}) } as never));
  };

  it('sem envio: o botão "Enviar documento digitalizado (assinado à mão)"', async () => {
    const html = await pagina(null);
    expect(html).toContain('Enviar documento digitalizado (assinado à mão)');
    expect(html).not.toContain('Montando o PDF digitalizado…');
  });

  it.each([false, null])('RN-145: 2FA %s → o aviso "Ative a verificação em duas etapas…" e nada de formulário', async (dois) => {
    const html = await pagina(null, dois);
    expect(html).toContain('Ative a verificação em duas etapas em Segurança para assinar documentos.');
    expect(html).toContain('href="/conta/seguranca"');
    expect(html).not.toContain('Enviar documento digitalizado (assinado à mão)');
    expect(await pagina(null)).not.toContain('Ative a verificação em duas etapas'); // com o 2FA, sem o aviso
  });

  it.each(['recebendo', 'pendente'])('"%s": "Montando o PDF digitalizado…" e nada de formulário (um envio por vez)', async (st) => {
    const html = await pagina(st);
    expect(html).toContain('Montando o PDF digitalizado…');
    expect(html).not.toContain('Enviar documento digitalizado');
  });

  it.each(['recebendo', 'pendente'])('"%s" esquecido há mais de 1 h (D24): o aviso de falha e o formulário de novo, sem esperar a varredura', async (st) => {
    const html = await pagina(st, true, new Date(Date.now() - 61 * 60_000));
    expect(html).not.toContain('Montando o PDF digitalizado…');
    expect(html).toContain('Não foi possível montar o PDF. Envie as fotos de novo.');
    expect(html).toContain('Enviar documento digitalizado (assinado à mão)');
  });

  it('"falhou": o aviso "Não foi possível montar o PDF. Envie as fotos de novo." e o botão de novo', async () => {
    const html = await pagina('falhou');
    expect(html).toContain('Não foi possível montar o PDF. Envie as fotos de novo.');
    expect(html).toContain('Enviar documento digitalizado (assinado à mão)');
  });
});
