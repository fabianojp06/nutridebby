import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Só a montagem da página: prontuário, documento e ações simulados (como /p/plano/page.test.ts).
const PACIENTE = '00000000-0000-4000-8000-0000000000a1';
const DOC = '00000000-0000-4000-8000-0000000000d1';
// T9: cada caso pode trocar o paciente e o documento (o padrão é o emitido anonimizado da T6)
const caso = vi.hoisted(() => ({ paciente: null as Record<string, unknown> | null, doc: null as Record<string, unknown> | null, twoFactorEnabled: true as boolean | null, exames: [] as Record<string, unknown>[], situacao: {} as Record<string, string> }));
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
vi.mock('../actions', () => ({ apagarRascunhoAction: vi.fn(), pedirNovoPdfAction: vi.fn(), voltarAEditarAction: vi.fn(), entreguePessoalmenteAction: vi.fn(), reenviarLinkAction: vi.fn(), cancelarAction: vi.fn(), salvarParecerAction: vi.fn(), prepararParecerAction: vi.fn(), retificarAction: vi.fn(), salvarSolicitacaoAction: vi.fn(), prepararSolicitacaoAction: vi.fn(), salvarItemAction: vi.fn(), salvarComoModeloAction: vi.fn(), carregarModeloAction: vi.fn() }));
vi.mock('@/modules/documentos/documentos', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/documentos/documentos')>()),
  // RN-140 (c): emitido anonimizado — conteudo '{}', sem PDF
  // Plano 13 (T9): os campos da retificação (T7) que os casos do 10A e da T8 não têm — a página lê `d.versoes`
  lerDocumento: async () => ({
    retificaId: null, motivoRetificacao: null, substituidoEm: null, versoes: { anterior: null, seguinte: null },
    ...(caso.doc ?? {
      id: DOC, tipo: 'receita', status: 'assinado', codigo: 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'), assinadoEm: new Date('2026-09-02T12:00:00Z'),
      assinaturaTipo: 'digitalizada', pdfStatus: 'pronto', entregueEm: null, recibos: [], conteudo: {}, justificativa: null, motivoCancelamento: null,
      assinanteNome: null, basePdfPath: null, pdfPath: null, pdfSha256: 'a'.repeat(64), digitalizacaoStatus: null, anonimizadoEm: new Date('2026-10-01T12:00:00Z'),
    }),
  }),
}));
vi.mock('@/modules/pacientes/exames', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/modules/pacientes/exames')>()), listarExames: async () => caso.exames }));
vi.mock('@/modules/documentos/parecer-exames', () => ({ situacaoDosExames: async () => caso.situacao }));
// Plano 22 (T8): o editor da solicitação recebe o catálogo e os modelos (uma transação, R22-08); `lidas` conta as leituras
const bibliotecas = vi.hoisted(() => ({ lidas: 0 }));
vi.mock('@/modules/exames/modelos-solicitacao', () => ({
  bibliotecasParaExames: async () => {
    bibliotecas.lidas++;
    return { catalogo: [{ id: 'c1', nome: 'Hemograma completo', unidade: null, sinonimos: [], componentes: ['Hemoglobina', 'Hematócrito'], faixas: [] }], modelos: [{ id: 'm1', nome: 'Check-up anual', exames: [{ nome: 'Glicemia de jejum' }], orientacoes: '' }] };
  },
}));
// Plano 22 (T10b): o editor da receita recebe os itens salvos e os modelos de prescrição (vazios aqui)
vi.mock('@/modules/documentos/modelos', () => ({ listarItensSalvos: async () => [], listarModelosPrescricao: async () => [] }));
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

describe('página do documento: parecer nutricional (US-141, RN-148)', () => {
  const HEMOGRAMA = { id: '00000000-0000-4000-8000-0000000000e1', data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16' }] };
  const LIPIDICO = { id: '00000000-0000-4000-8000-0000000000e2', data: '2026-08-20', titulo: 'Perfil lipídico', valores: [] };
  const parecer = (status: string, extra: Record<string, unknown> = {}) => ({
    id: DOC, tipo: 'parecer', versao: 1, status, codigo: status === 'rascunho' ? null : 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'),
    assinadoEm: status === 'assinado' ? new Date('2026-09-02T12:00:00Z') : null, assinaturaTipo: status === 'assinado' ? 'digitalizada' : null, pdfStatus: 'pronto',
    entregueEm: null, recibos: [], conteudo: { versao: 1, tipo: 'parecer', exames: [HEMOGRAMA], avaliacao: 'Baixa reserva de ferro.', conduta: '', encaminhamentos: 'Sugiro avaliação médica.' },
    justificativa: null, motivoCancelamento: null, assinanteNome: null, basePdfPath: 'x', pdfPath: status === 'assinado' ? 'y' : null, pdfSha256: null,
    digitalizacaoStatus: null, digitalizacaoEm: null, anonimizadoEm: null, canceladoEm: null, ...extra,
  });
  const pagina = async (d: Record<string, unknown>, o: { exames?: Record<string, unknown>[]; situacao?: Record<string, string> } = {}) => {
    caso.twoFactorEnabled = true;
    caso.paciente = { id: PACIENTE, status: 'ativo', anonimizadoEm: null, userId: null, email: 'ana@ex.com' };
    caso.doc = d;
    caso.exames = o.exames ?? [];
    caso.situacao = o.situacao ?? {};
    return renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve({}) } as never));
  };

  it('rascunho: o editor com os exames do prontuário (o só com laudo marcado), a avaliação e a declaração do parecer; nada da receita', async () => {
    const html = await pagina(parecer('rascunho'), { exames: [HEMOGRAMA, LIPIDICO] });
    expect(html).toContain('<h2 id="documento" class="text-lg font-semibold">Parecer nutricional</h2>');
    expect(html).toContain('data-guia="editor-parecer"');
    expect(html).toContain('Exames considerados');
    expect(html).toContain('Hemograma — 01/09/2026');
    expect(html).toContain('Perfil lipídico — 20/08/2026 (laudo no prontuário, sem valores lançados)');
    expect(html).toContain('Avaliação nutricional');
    expect(html).toContain('Conduta e orientações (opcional)');
    expect(html).toContain('Encaminhamentos (opcional)');
    expect(html).toContain('Declaro que este parecer não afirma diagnóstico de doença nem prescreve medicamento.');
    expect(html).not.toContain('Itens da receita');
    expect(html).not.toContain('Justificativa de uso');
  });

  it('rascunho: os valores de cada exame marcado aparecem no editor, pela lista do prontuário (US-141, "Valores atualizados no rascunho")', async () => {
    const ferritina = { id: '00000000-0000-4000-8000-0000000000e3', data: '2026-08-10', titulo: 'Ferritina', valores: [{ nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null }] };
    // o Hemograma (marcado pela cópia) com o valor já atualizado no prontuário; a Ferritina não está marcada
    const atual = { ...HEMOGRAMA, valores: [{ nome: 'Hemoglobina', valor: 11.2, unidade: 'g/dL', referencia: '12 a 16' }] };
    const html = await pagina(parecer('rascunho'), { exames: [atual, ferritina, LIPIDICO] });
    expect(html).toContain('Hemoglobina · 11,2 · g/dL · 12 a 16');
    expect(html).not.toContain('Hemoglobina · 13,5');
    expect(html).toContain(`aria-describedby="exame-${HEMOGRAMA.id}-valores"`);
    expect(html).toContain('Ferritina — 10/08/2026');
    expect(html).not.toContain('Ferritina · 12');
  });

  it('rascunho com um exame da cópia que foi excluído: o aviso proposto, e o exame fora da seleção', async () => {
    const html = await pagina(parecer('rascunho'), { exames: [LIPIDICO] });
    expect(html).toContain('Um dos exames selecionados foi excluído. Revise a seleção.');
    expect(html).not.toContain('Hemograma — 01/09/2026');
  });

  it('aguardando assinatura com o exame mudado: a cópia, "Os valores deste exame mudaram depois do parecer." e o "Voltar a editar"', async () => {
    const html = await pagina(parecer('aguardando_assinatura'), { situacao: { [HEMOGRAMA.id]: 'mudou' } });
    expect(html).toContain('Hemoglobina · 13,5 · g/dL · 12 a 16');
    expect(html).toContain('Os valores deste exame mudaram depois do parecer.');
    expect(html).toContain('Voltar a editar');
  });

  it('assinado com o exame excluído: "O exame Hemograma — 01/09/2026 foi excluído depois do parecer."; encaminhamentos sim, conduta vazia não', async () => {
    const html = await pagina(parecer('assinado'), { situacao: { [HEMOGRAMA.id]: 'excluido' } });
    expect(html).toContain('O exame Hemograma — 01/09/2026 foi excluído depois do parecer.');
    expect(html).toContain('Baixa reserva de ferro.');
    expect(html).toContain('Sugiro avaliação médica.');
    expect(html).not.toContain('Conduta e orientações');
    expect(html).not.toContain('Os valores deste exame mudaram');
  });
});

describe('página do documento: retificação (US-148, Q13-1 ★, Q13-5 ★)', () => {
  const base = (status: string, extra: Record<string, unknown> = {}) => ({
    id: DOC, tipo: 'receita', versao: 1, status, codigo: status === 'rascunho' ? null : 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'),
    assinadoEm: ['assinado', 'substituido'].includes(status) ? new Date('2026-09-02T12:00:00Z') : null, assinaturaTipo: ['assinado', 'substituido'].includes(status) ? 'digitalizada' : null,
    pdfStatus: null, entregueEm: null, recibos: [], conteudo: { versao: 1, tipo: 'receita', itens: [], orientacoes: '' }, justificativa: null, motivoCancelamento: null,
    assinanteNome: null, basePdfPath: null, pdfPath: 'x', pdfSha256: 'a'.repeat(64), digitalizacaoStatus: null, digitalizacaoEm: null, anonimizadoEm: null, canceladoEm: null,
    retificaId: null, motivoRetificacao: null, substituidoEm: null, versoes: { anterior: null, seguinte: null }, ...extra,
  });
  const pagina = async (d: Record<string, unknown>, paciente: Record<string, unknown> = { status: 'ativo' }) => {
    caso.twoFactorEnabled = true;
    caso.paciente = { id: PACIENTE, anonimizadoEm: null, userId: null, email: 'ana@ex.com', ...paciente };
    caso.doc = d;
    return renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve({}) } as never));
  };

  it('assinado: o botão "Retificar" (não com o paciente bloqueado)', async () => {
    const html = await pagina(base('assinado'));
    expect(html).toContain('data-guia="retificar-documento"');
    expect(html).toContain('>Retificar<');
    expect(await pagina(base('assinado'), { status: 'bloqueado' })).not.toContain('>Retificar<');
  });

  it('rascunho da versão 2: "Versão 2 — substitui o documento ABCD-EFGH-JKMN" e o campo "Motivo da retificação" ("Fica só no prontuário.")', async () => {
    const html = await pagina(base('rascunho', { versao: 2, retificaId: '00000000-0000-4000-8000-0000000000d0', versoes: { anterior: { id: '00000000-0000-4000-8000-0000000000d0', versao: 1, codigo: 'ABCDEFGHJKMN' }, seguinte: null } }));
    expect(html).toContain('Versão 2 — substitui o documento ABCD-EFGH-JKMN');
    expect(html).toContain('Motivo da retificação');
    expect(html).toContain('name="motivoRetificacao"');
    expect(await pagina(base('rascunho'))).not.toContain('Motivo da retificação'); // a versão 1 não tem o campo
  });

  it('versão 2 preparada: o motivo só no prontuário; substituído: o cartão, a data, o link para a versão 2 e sem "Retificar" nem "Cancelar documento"', async () => {
    const preparada = await pagina(base('aguardando_assinatura', { versao: 2, retificaId: 'x', motivoRetificacao: 'Dose corrigida', pdfStatus: 'pronto', basePdfPath: 'b', pdfPath: null, versoes: { anterior: { id: 'x', versao: 1, codigo: 'ABCDEFGHJKMN' }, seguinte: null } }));
    expect(preparada).toContain('Motivo da retificação (só no prontuário): Dose corrigida');
    const V2 = '00000000-0000-4000-8000-0000000000d2';
    const html = await pagina(base('substituido', { substituidoEm: new Date('2026-09-10T12:00:00Z'), versoes: { anterior: null, seguinte: { id: V2, versao: 2, status: 'assinado' } } }));
    expect(html).toContain('Documento substituído');
    expect(html).toContain('Substituído em 10/09/2026 pela versão 2.');
    expect(html).toContain(`href="/painel/pacientes/${PACIENTE}/documentos/${V2}"`);
    expect(html).toContain('Abrir a versão 2');
    expect(html).toContain('Baixar PDF assinado');
    expect(html).not.toContain('>Retificar<');
    expect(html).not.toContain('Cancelar documento');
  });
});

describe('página do documento: solicitação de exames (Plano 22, T8, US-377)', () => {
  const CONTEUDO = { versao: 1, tipo: 'solicitacao_exames', exames: [{ nome: 'Hemograma completo', painel: true }, { nome: 'Glicemia de jejum' }], indicacaoClinica: 'Acompanhar a dieta.', orientacoes: '', orientacoesFormato: 'marcacao' };
  const solicitacao = (status: string) => ({
    id: DOC, tipo: 'solicitacao_exames', status, codigo: status === 'rascunho' ? null : 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'), assinadoEm: status === 'assinado' ? new Date('2026-09-02T12:00:00Z') : null,
    assinaturaTipo: status === 'assinado' ? 'digitalizada' : null, pdfStatus: null, entregueEm: null, recibos: [], conteudo: CONTEUDO,
    justificativa: null, motivoCancelamento: null, assinanteNome: null, basePdfPath: null, pdfPath: status === 'assinado' ? 'x' : null, pdfSha256: null, digitalizacaoStatus: null, anonimizadoEm: null,
  });
  const pagina = async (doc: Record<string, unknown>, paciente: Record<string, unknown> = { status: 'ativo', userId: 'u1' }) => {
    caso.paciente = { id: PACIENTE, anonimizadoEm: null, email: 'ana@ex.com', ...paciente };
    caso.doc = doc;
    return renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve({}) } as never));
  };

  it('revisão da T7 (a): a página lida (com o auditRead) mostra a solicitação — nunca o 404 depois da leitura', async () => {
    const html = await pagina(solicitacao('assinado'));
    expect(html).toContain('<h2 id="documento" class="text-lg font-semibold">Solicitação de exames laboratoriais</h2>');
  });

  it('assinada: os cartões somente leitura e "Lançar resultados" para o "Novo exame" (EP-D50); sem campo de laboratório', async () => {
    const html = await pagina(solicitacao('assinado'));
    expect(html).toContain('Exames solicitados');
    expect(html).toMatch(/<li[^>]*>Glicemia de jejum<\/li>/);
    expect(html).toContain('Acompanhar a dieta.');
    expect(html).toContain(`href="/painel/pacientes/${PACIENTE}/exames?solicitacao=${DOC}#novo-exame"`);
    expect(html).toContain('>Lançar resultados</a>');
    expect(html).not.toMatch(/[Ll]aboratório/);
  });

  it('"Lançar resultados" só na assinada em vigor e com o paciente não bloqueado', async () => {
    for (const status of ['preparando', 'cancelado', 'substituido']) expect(await pagina(solicitacao(status)), status).not.toContain('Lançar resultados');
    expect(await pagina(solicitacao('assinado'), { status: 'bloqueado', userId: null })).not.toContain('Lançar resultados');
  });

  it('rascunho: o editor com o catálogo e os modelos lidos uma vez, o aviso dos planos de saúde e "Apagar rascunho"; sem o editor, nada é lido', async () => {
    bibliotecas.lidas = 0;
    const html = await pagina(solicitacao('rascunho'));
    expect(bibliotecas.lidas).toBe(1);
    expect(html).toContain('Planos de saúde podem recusar pedido de exame feito por nutricionista.');
    expect(html).toContain('Adicionar do catálogo');
    expect(html).toContain('Apagar rascunho');
    expect(html).not.toContain('Exames solicitados');
    bibliotecas.lidas = 0;
    await pagina(solicitacao('assinado'));
    await pagina(solicitacao('rascunho'), { status: 'bloqueado', userId: null });
    expect(bibliotecas.lidas).toBe(0);
  });
});

describe('página do documento: fórmula e orientações formatadas (Plano 22, T9, US-378, RN-395)', () => {
  const FORMULA = {
    tipo: 'formula_fitoterapica', formaFarmaceutica: 'Cápsula', via: 'oral', posologia: '1 cápsula à noite', duracao: '',
    compostos: [{ nomenclatura: 'Passiflora incarnata L.', parte: 'Folhas', extracao: 'Extrato seco', padronizacao: '', quantidade: 200, unidade: 'mg' }, { nomenclatura: 'Melissa officinalis L.', parte: 'Folhas', extracao: 'Extrato seco', padronizacao: '', quantidade: 150.5, unidade: 'mg' }],
  };
  const receita = (status: string, conteudo: Record<string, unknown>) => ({
    id: DOC, tipo: 'receita', status, codigo: status === 'rascunho' ? null : 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'), assinadoEm: status === 'assinado' ? new Date('2026-09-02T12:00:00Z') : null,
    assinaturaTipo: status === 'assinado' ? 'digitalizada' : null, pdfStatus: null, entregueEm: null, recibos: [], conteudo: { versao: 1, tipo: 'receita', ...conteudo },
    justificativa: 'Insônia leve', motivoCancelamento: null, assinanteNome: null, basePdfPath: null, pdfPath: status === 'assinado' ? 'x' : null, pdfSha256: null, digitalizacaoStatus: null, anonimizadoEm: null,
  });
  const pagina = async (doc: Record<string, unknown>) => {
    caso.paciente = { id: PACIENTE, status: 'ativo', anonimizadoEm: null, userId: 'u1', email: 'ana@ex.com' };
    caso.doc = doc;
    return renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve({}) } as never));
  };

  it('assinada: a fórmula descrita (um composto por linha) e as orientações em componentes; "<script>" e tags como texto', async () => {
    const html = await pagina(receita('assinado', { itens: [FORMULA], orientacoes: 'Tome **à noite**.\n\n- <script>alert(1)</script>\n- <b>x</b> & y', orientacoesFormato: 'marcacao' }));
    expect(html).toContain('<p class="font-semibold">Fórmula magistral fitoterápica</p>');
    expect(html).toContain('Melissa officinalis L. · Folhas · Extrato seco · 150,5 mg');
    expect(html).toContain('Tome <strong>à noite</strong>.');
    expect(html).toMatch(/<ul[^>]*><li[^>]*>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/li><li[^>]*>&lt;b&gt;x&lt;\/b&gt; &amp; y<\/li><\/ul>/);
    expect(html).not.toContain('<script>alert(1)'); // (o único <script> da página é o do React para as actions dos formulários)
  });

  it('receita antiga (sem orientacoesFormato): as orientações em texto puro, os "**" como foram escritos', async () => {
    const html = await pagina(receita('assinado', { itens: [], orientacoes: 'Tome **à noite**.' }));
    expect(html).toContain('<p class="whitespace-pre-line">Tome **à noite**.</p>');
    expect(html).not.toContain('<strong>');
  });

  it('rascunho com a fórmula: o editor mostra a declaração da receita com a frase do art. 9º, II (EP-D56)', async () => {
    const html = await pagina(receita('rascunho', { itens: [FORMULA], orientacoes: '' }));
    expect(html).toContain('a fórmula magistral fitoterápica tem só derivados vegetais');
    expect(html).toContain('Compostos');
  });
});
