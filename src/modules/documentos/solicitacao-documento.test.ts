import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { novoConsultorio } from '../../../test/documentos';
import { novoPaciente } from '../../../test/pacientes';
import { signedDocuments } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { FILA_DO_PDF_DO_DOCUMENTO } from '@/jobs/queues';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { cancelarDocumento } from './cancelamento';
import { DECLARACAO_SOLICITACAO } from './constantes';
import { receberDigitalizada } from './digitalizada';
import { montarPdfDigitalizado } from './digitalizada-job';
import { gerarPdfDoDocumento } from './documento-pdf-job';
import { criarParecer, criarReceita, criarSolicitacao, lerDocumento, listarDocumentos, prepararParaAssinatura, salvarRascunhoParecer, salvarRascunhoReceita, salvarRascunhoSolicitacao } from './documentos';
import { DocumentoError, TransicaoInvalidaError } from './erros';
import { marcarEntreguePessoalmente } from './recebimento';
import { MSG_SOLICITACAO, type ConteudoSolicitacao } from './solicitacao';
import { conteudoVazio } from './tipos-de-documento';
import { consultarVerificacao } from './verificacao';

// Plano 22 (T8, US-377, RN-388, RN-389): a solicitação de exames laboratoriais pelo módulo de documentos — o rascunho, o
// preparo com a declaração dela e a fila "-2", e o ciclo de hoje (digitalizada, entrega, recebimento, verificação, cancelamento).
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // o preparo enfileira o PDF; a assinatura, o e-mail da entrega
  await app.pool.end();
});
const erroEm = (campo: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[campo] === msg;
const EXAMES = [{ nome: 'Hemograma completo', painel: true }, { nome: 'Glicemia de jejum' }, { nome: 'Vitamina D (25-OH)' }];
const ler = async (c: Awaited<ReturnType<typeof novoConsultorio>>, patientId: string, id: string) => (await lerDocumento(c.T.ctx, patientId, id, app.db))!;

describe('solicitação de exames — rascunho (US-377, RN-388)', () => {
  it('"Nova solicitação de exames": rascunho solicitacao_exames com o conteúdo vazio do tipo; a lista só com as chaves de ItemLista', async () => {
    const c = await novoConsultorio(app.db);
    const p = await novoPaciente(app.db, c.T.ctx);
    const id = await criarSolicitacao(c.T.ctx, p.id, { db: app.db });
    const lista = await listarDocumentos(c.T.ctx, p.id, app.db);
    expect(lista).toMatchObject([{ id, tipo: 'solicitacao_exames', versao: 1, status: 'rascunho' }]);
    expect(Object.keys(lista[0]).sort()).toEqual(['assinadoEm', 'assinaturaTipo', 'codigo', 'createdAt', 'entregueEm', 'id', 'pdfStatus', 'recibos', 'status', 'tipo', 'versao']);
    expect((await ler(c, p.id, id)).conteudo).toEqual(conteudoVazio('solicitacao_exames'));
  });

  it('salvar grava os exames do catálogo, o painel e o livre, a indicação e as orientações em marcação; laboratório e chaves a mais somem', async () => {
    const c = await novoConsultorio(app.db);
    const p = await novoPaciente(app.db, c.T.ctx);
    const id = await criarSolicitacao(c.T.ctx, p.id, { db: app.db });
    await salvarRascunhoSolicitacao(c.T.ctx, p.id, id, {
      conteudo: { exames: [...EXAMES, { nome: '  Ferritina   sérica ', extra: 1 }], indicacaoClinica: ' Acompanhar a resposta à dieta. ', orientacoes: 'Jejum de 8 horas.\r\n- Leve este pedido.', laboratorio: 'Lab X', orientacoesFormato: 'html' },
    }, { db: app.db });
    expect((await ler(c, p.id, id)).conteudo).toEqual({
      versao: 1, tipo: 'solicitacao_exames',
      exames: [...EXAMES, { nome: 'Ferritina sérica' }],
      indicacaoClinica: 'Acompanhar a resposta à dieta.', orientacoes: 'Jejum de 8 horas.\n- Leve este pedido.', orientacoesFormato: 'marcacao',
    });
    expect(JSON.stringify((await ler(c, p.id, id)).conteudo)).not.toContain('Lab X');
  });

  it('erros do rascunho com os textos da spec (§6.2) e nada gravado', async () => {
    const c = await novoConsultorio(app.db);
    const p = await novoPaciente(app.db, c.T.ctx);
    const id = await criarSolicitacao(c.T.ctx, p.id, { db: app.db });
    const salvar = (conteudo: unknown) => salvarRascunhoSolicitacao(c.T.ctx, p.id, id, { conteudo }, { db: app.db });
    await expect(salvar({ exames: [{ nome: 'Glicose' }, { nome: 'GLICOSE' }] })).rejects.toSatisfy(erroEm('exames.1.nome', MSG_SOLICITACAO.erros.repetido));
    await expect(salvar({ exames: Array.from({ length: 41 }, (_, i) => ({ nome: `Exame ${i}` })) })).rejects.toSatisfy(erroEm('exames', MSG_SOLICITACAO.erros.max));
    await expect(salvar({ exames: [{ nome: 'x'.repeat(81) }] })).rejects.toSatisfy(erroEm('exames.0.nome', MSG_SOLICITACAO.erros.nome));
    await expect(salvar({ exames: [], indicacaoClinica: 'x'.repeat(501) })).rejects.toSatisfy(erroEm('indicacaoClinica', MSG_SOLICITACAO.erros.indicacao));
    await expect(salvar({ exames: [], orientacoes: 'x'.repeat(1001) })).rejects.toSatisfy(erroEm('orientacoes', MSG_SOLICITACAO.erros.orientacoes));
    expect((await ler(c, p.id, id)).conteudo).toEqual(conteudoVazio('solicitacao_exames'));
  });

  it('os editores não se misturam (EP-D57): receita e parecer não gravam numa solicitação, nem a solicitação neles', async () => {
    const c = await novoConsultorio(app.db);
    const p = await novoPaciente(app.db, c.T.ctx);
    const sol = await criarSolicitacao(c.T.ctx, p.id, { db: app.db });
    const receita = await criarReceita(c.T.ctx, p.id, { db: app.db });
    const parecer = await criarParecer(c.T.ctx, p.id, { db: app.db });
    await expect(salvarRascunhoReceita(c.T.ctx, c.acesso.tenant, p.id, sol, { conteudo: { itens: [] }, justificativa: '' }, { db: app.db })).rejects.toThrow(TransicaoInvalidaError);
    await expect(salvarRascunhoParecer(c.T.ctx, p.id, sol, { conteudo: { exameIds: [], avaliacao: 'x' } }, { db: app.db })).rejects.toThrow(TransicaoInvalidaError);
    for (const outro of [receita, parecer]) await expect(salvarRascunhoSolicitacao(c.T.ctx, p.id, outro, { conteudo: { exames: EXAMES } }, { db: app.db })).rejects.toThrow(TransicaoInvalidaError);
    expect((await ler(c, p.id, sol)).conteudo).toEqual(conteudoVazio('solicitacao_exames'));
  });

  it('depois de preparar, salvar é recusado (RN-140); paciente bloqueado: nada é criado; de outro paciente: não encontrado', async () => {
    const c = await novoConsultorio(app.db);
    const p = await novoPaciente(app.db, c.T.ctx);
    const outro = await novoPaciente(app.db, c.T.ctx);
    const id = await criarSolicitacao(c.T.ctx, p.id, { db: app.db });
    await salvarRascunhoSolicitacao(c.T.ctx, p.id, id, { conteudo: { exames: EXAMES } }, { db: app.db });
    await expect(salvarRascunhoSolicitacao(c.T.ctx, outro.id, id, { conteudo: { exames: EXAMES } }, { db: app.db })).rejects.toThrow('Documento não encontrado.');
    await prepararParaAssinatura(c.T.ctx, c.acesso.tenant, p.id, id, { declaracao: 'on' }, { db: app.db });
    await expect(salvarRascunhoSolicitacao(c.T.ctx, p.id, id, { conteudo: { exames: EXAMES } }, { db: app.db })).rejects.toThrow(TransicaoInvalidaError);
    const b = await novoPaciente(app.db, c.T.ctx, { status: 'bloqueado' });
    await expect(criarSolicitacao(c.T.ctx, b.id, { db: app.db })).rejects.toThrow(PacienteBloqueadoError);
  });
});

describe('solicitação de exames — preparar e o ciclo de hoje (RN-389)', () => {
  it('preparar sem exames: "Inclua ao menos um exame."; sem a declaração, o texto de hoje; tudo continua rascunho', async () => {
    const c = await novoConsultorio(app.db);
    const p = await novoPaciente(app.db, c.T.ctx);
    const id = await criarSolicitacao(c.T.ctx, p.id, { db: app.db });
    await expect(prepararParaAssinatura(c.T.ctx, c.acesso.tenant, p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy(erroEm('exames', MSG_SOLICITACAO.erros.semExames));
    await salvarRascunhoSolicitacao(c.T.ctx, p.id, id, { conteudo: { exames: EXAMES } }, { db: app.db });
    await expect(prepararParaAssinatura(c.T.ctx, c.acesso.tenant, p.id, id, { declaracao: undefined }, { db: app.db })).rejects.toSatisfy(erroEm('declaracao', 'Confirme a declaração para continuar.'));
    expect((await ler(c, p.id, id)).status).toBe('rascunho');
  });

  it('com a declaração: congela a cópia do profissional e do paciente, grava DECLARACAO_SOLICITACAO, gera o código e enfileira SÓ na documento-pdf-2; sem justificativa de uso', async () => {
    const c = await novoConsultorio(app.db);
    const p = await novoPaciente(app.db, c.T.ctx, { nome: 'Ana Souza' });
    const id = await criarSolicitacao(c.T.ctx, p.id, { db: app.db });
    await salvarRascunhoSolicitacao(c.T.ctx, p.id, id, { conteudo: { exames: EXAMES, indicacaoClinica: 'Acompanhar a resposta à dieta.' } }, { db: app.db });
    await prepararParaAssinatura(c.T.ctx, c.acesso.tenant, p.id, id, { declaracao: 'on' }, { db: app.db, agora: new Date('2026-11-20T13:00:00Z') });
    const d = await ler(c, p.id, id);
    expect(d).toMatchObject({
      status: 'preparando', pdfStatus: 'pendente', justificativa: null,
      conteudo: { tipo: 'solicitacao_exames', exames: EXAMES, declaracao: DECLARACAO_SOLICITACAO, copia: { paciente: { nome: 'Ana Souza' }, profissional: { nomeCompleto: 'Débora Silva Santos' } } },
    });
    expect(d.codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    const boss = await getBoss();
    expect((await boss.findJobs<{ documentoId: string }>(FILA_DO_PDF_DO_DOCUMENTO)).some((j) => j.data.documentoId === id)).toBe(true);
    expect((await boss.findJobs<{ documentoId: string }>('documento-pdf')).some((j) => j.data.documentoId === id)).toBe(false);
  });

  it('revisão da T7 (b): conteúdo de um tipo na linha de outro nunca prepara — recusado antes de validar (sem o erro do conteúdo)', async () => {
    const c = await novoConsultorio(app.db);
    const p = await novoPaciente(app.db, c.T.ctx);
    const id = await criarSolicitacao(c.T.ctx, p.id, { db: app.db });
    // o conteúdo de um parecer sem exames na linha da solicitação: o switch daria "Selecione ao menos um exame." e copiaria os exames
    await withTenant(c.T.ctx, (tx) => tx.update(signedDocuments).set({ conteudo: { versao: 1, tipo: 'parecer', exames: [], avaliacao: '', conduta: '', encaminhamentos: '' } }).where(eq(signedDocuments.id, id)), app.db);
    await expect(prepararParaAssinatura(c.T.ctx, c.acesso.tenant, p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toThrow(TransicaoInvalidaError);
    expect((await ler(c, p.id, id)).status).toBe('rascunho');
  });

  it('de ponta a ponta: PDF-base pelo worker → digitalizada com o código do 2FA → assinada → entregue pessoalmente → verificação só com o rótulo → cancelada', async () => {
    const c = await novoConsultorio(app.db);
    const p = await novoPaciente(app.db, c.T.ctx, { nome: 'Ana Souza' });
    const id = await criarSolicitacao(c.T.ctx, p.id, { db: app.db });
    await salvarRascunhoSolicitacao(c.T.ctx, p.id, id, { conteudo: { exames: EXAMES, indicacaoClinica: 'Acompanhar a resposta à dieta.', orientacoes: 'Jejum de 8 horas.' } }, { db: app.db });
    await prepararParaAssinatura(c.T.ctx, c.acesso.tenant, p.id, id, { declaracao: 'on' }, { db: app.db });
    expect(await gerarPdfDoDocumento({ tenantId: c.T.tenantId, documentoId: id }, { db: app.db, dataDir: c.dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('pronto');
    expect((await ler(c, p.id, id)).status).toBe('aguardando_assinatura');

    const foto = await sharp({ create: { width: 80, height: 110, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    await receberDigitalizada(c.acesso, id, [foto], '123456', { db: app.db, dataDir: c.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    expect(await montarPdfDigitalizado({ tenantId: c.T.tenantId, documentoId: id, userId: c.T.nutriId }, { db: app.db, dataDir: c.dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('pronto');
    const assinado = await ler(c, p.id, id);
    expect(assinado).toMatchObject({ status: 'assinado', assinaturaTipo: 'digitalizada', tipo: 'solicitacao_exames' });

    expect(await marcarEntreguePessoalmente(c.T.ctx, p.id, id, { db: app.db })).toBe(true);
    expect((await ler(c, p.id, id)).recibos).toEqual([expect.objectContaining({ evento: 'recebido', via: 'pessoalmente' })]);

    const v = await consultarVerificacao(assinado.codigo, { db: app.db, ipDoLimite: null });
    expect(v.tipo).toBe('ok');
    if (v.tipo !== 'ok') return;
    expect(v.v).toMatchObject({ tipo: 'Solicitação de exames laboratoriais', situacao: 'valido' });
    // D8: as chaves de hoje, nada dos exames nem do paciente
    expect(Object.keys(v.v).sort()).toEqual(['assinadoEm', 'assinanteNome', 'assinatura', 'codigo', 'emissorCrn', 'emissorNome', 'sha256', 'situacao', 'situacaoEm', 'tipo']);
    for (const fora of ['Hemograma', 'Glicemia', 'Ana Souza', 'Acompanhar', 'Jejum']) expect(JSON.stringify(v.v)).not.toContain(fora);

    await cancelarDocumento(c.T.ctx, p.id, id, 'Pedido duplicado', { db: app.db, appUrl: 'https://x' });
    expect((await ler(c, p.id, id)).status).toBe('cancelado');
    const depois = await consultarVerificacao(assinado.codigo, { db: app.db, ipDoLimite: null });
    expect(depois.tipo === 'ok' && depois.v.situacao).toBe('cancelado');
    // a cópia congelada continua a do preparo (o painel mostra o cancelado com o que foi assinado)
    expect(((await ler(c, p.id, id)).conteudo as ConteudoSolicitacao).exames).toEqual(EXAMES);
    expect((await withTenant(c.T.ctx, (tx) => tx.execute(sql`select tipo from document_verifications where codigo = ${assinado.codigo}`), app.db)).rows).toEqual([{ tipo: 'solicitacao_exames' }]);
  });
});
