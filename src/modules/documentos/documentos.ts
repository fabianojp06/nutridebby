import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { patients, signedDocumentNotes, signedDocumentReceipts, signedDocuments, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { formatarData } from '@/modules/pacientes/datas';
import { apagarArquivo, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { soltarArquivosDoPreparo } from './arquivos-do-preparo';
import { gerarCodigo } from './codigo';
import { DECLARACAO_RECEITA, MSG_DECLARACAO, type EventoRecibo, type StatusDocumento, type TipoAssinatura, type ViaRecibo } from './constantes';
import { DocumentoError, DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';
import { copiaDoPerfil } from './perfil-profissional';
import { validarParaPreparar, validarRascunho, type ConteudoReceita } from './prescricao';

export type Recibo = { evento: EventoRecibo; via: ViaRecibo; em: Date };
export type ItemLista = {
  id: string; tipo: 'receita'; status: StatusDocumento; codigo: string | null; createdAt: Date; assinadoEm: Date | null;
  assinaturaTipo: TipoAssinatura | null; pdfStatus: string | null; entregueEm: Date | null; recibos: Recibo[];
};
export type DocumentoLido = ItemLista & {
  conteudo: ConteudoReceita; justificativa: string | null; motivoCancelamento: string | null; assinanteNome: string | null;
  basePdfPath: string | null; pdfPath: string | null; pdfSha256: string | null; digitalizacaoStatus: string | null; anonimizadoEm: Date | null;
};

const CONTEUDO_VAZIO: ConteudoReceita = { versao: 1, tipo: 'receita', itens: [], orientacoes: '' };

/** Trava o documento do paciente (FOR UPDATE) num dos estados pedidos; outro estado → TransicaoInvalidaError. */
async function travarDocumento(tx: Tx, patientId: string, docId: string, estados: readonly StatusDocumento[]) {
  if (!idValido(docId)) throw new DocumentoNaoEncontradoError();
  const [d] = await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId))).for('update');
  if (!d) throw new DocumentoNaoEncontradoError();
  if (!estados.includes(d.status as StatusDocumento)) throw new TransicaoInvalidaError();
  return d;
}

/** US-142: "Nova receita" — o rascunho vazio e a nota (a justificativa fica fora do conteúdo, D15 da spec). */
export async function criarReceita(ctx: TenantContext, patientId: string, deps: { db?: Db } = {}): Promise<string> {
  return withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const [d] = await tx.insert(signedDocuments).values({ tenantId: ctx.tenantId, patientId, tipo: 'receita', conteudo: CONTEUDO_VAZIO }).returning({ id: signedDocuments.id });
    await tx.insert(signedDocumentNotes).values({ tenantId: ctx.tenantId, patientId, documentoId: d.id });
    return d.id;
  }, deps.db ?? getDb());
}

/** "Rascunho salvo." — valida os itens (habilitação no servidor, RN-150) e grava conteúdo e justificativa. */
export async function salvarRascunhoReceita(
  ctx: TenantContext, tenant: TenantRow, patientId: string, docId: string, input: { conteudo: unknown; justificativa: unknown }, deps: { db?: Db } = {},
): Promise<void> {
  const conteudo = validarRascunho(input.conteudo, { habilitada: !!tenant.fitoterapiaRegistro });
  const j = typeof input.justificativa === 'string' ? input.justificativa.trim() : '';
  if (j.length > 2000) throw new DocumentoError({ justificativa: 'Use no máximo 2000 caracteres.' });
  await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    await travarDocumento(tx, patientId, docId, ['rascunho']);
    await tx.update(signedDocuments).set({ conteudo, updatedAt: new Date() }).where(eq(signedDocuments.id, docId));
    await tx.update(signedDocumentNotes).set({ justificativaUso: j || null, updatedAt: new Date() }).where(eq(signedDocumentNotes.documentoId, docId));
  }, deps.db ?? getDb());
}

export async function apagarRascunho(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db } = {}): Promise<void> {
  await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    await travarDocumento(tx, patientId, docId, ['rascunho']);
    await tx.delete(signedDocuments).where(eq(signedDocuments.id, docId)); // a nota sai em cascata
  }, deps.db ?? getDb());
}

/**
 * US-143: declaração (D5) + perfil completo + justificativa → congela a cópia (RN-154), gera o código (RN-142) e enfileira o
 * PDF na mesma transação (o job só existe se a transação confirmar).
 */
export async function prepararParaAssinatura(
  ctx: TenantContext, tenant: TenantRow, patientId: string, docId: string, input: { declaracao: unknown }, deps: { db?: Db; boss?: PgBoss; agora?: Date } = {},
): Promise<void> {
  if (input.declaracao !== 'on') throw new DocumentoError({ declaracao: MSG_DECLARACAO });
  const profissional = copiaDoPerfil(tenant); // PerfilIncompletoError
  const agora = deps.agora ?? new Date();
  const boss = deps.boss ?? (await getBoss());
  await withTenant(ctx, async (tx) => {
    const paciente = await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['rascunho']);
    const [nota] = await tx.select({ j: signedDocumentNotes.justificativaUso }).from(signedDocumentNotes).where(eq(signedDocumentNotes.documentoId, docId));
    const conteudo = d.conteudo as ConteudoReceita;
    validarParaPreparar(conteudo, nota?.j ?? null, { habilitada: !!tenant.fitoterapiaRegistro });
    await tx
      .update(signedDocuments)
      .set({
        status: 'preparando',
        codigo: gerarCodigo(),
        declaracaoEm: agora,
        conteudo: { ...conteudo, copia: { profissional, paciente: { nome: paciente.nome } }, declaracao: DECLARACAO_RECEITA },
        pdfStatus: 'pendente',
        pdfPedidoEm: agora,
        updatedAt: agora,
      })
      .where(eq(signedDocuments.id, docId));
    await boss.send('documento-pdf', { tenantId: ctx.tenantId, documentoId: docId }, { db: fromDrizzle(tx, sql) });
  }, deps.db ?? getDb());
}

/**
 * RN-140 (a): volta a rascunho (código e base nulos) no naMesmaTransacao do DELETE do PDF base. Regra 9: as fotos de um
 * envio digitalizado que falhou saem ANTES, cada uma no seu apagarArquivo (soltarArquivosDoPreparo com `soFotos`); o
 * `digitalizacao: null` do `limpar` só cobre uma foto gravada no meio (corrida), que a varredura da T7 apaga sem referência.
 */
export async function voltarAEditar(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db; dataDir?: string } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const limpar = {
    status: 'rascunho', codigo: null, declaracaoEm: null, basePdfPath: null, basePdfSha256: null, basePdfBytes: null, areaAssinatura: null,
    pdfStatus: null, pdfPedidoEm: null, digitalizacao: null, digitalizacaoStatus: null, digitalizacaoEm: null, updatedAt: new Date(),
  } as const;
  const base = await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['preparando', 'aguardando_assinatura']);
    if (!d.basePdfPath) await tx.update(signedDocuments).set(limpar).where(eq(signedDocuments.id, docId));
    return d.basePdfPath;
  }, db);
  if (!base) return;
  await soltarArquivosDoPreparo(ctx, docId, ['aguardando_assinatura'], { db, dataDir: deps.dataDir, soFotos: true });
  const ok = await apagarArquivo(ctx, { caminho: base }, {
    db,
    dataDir: deps.dataDir,
    naMesmaTransacao: async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const r = await tx
        .update(signedDocuments)
        .set(limpar)
        .where(and(eq(signedDocuments.id, docId), eq(signedDocuments.basePdfPath, base), inArray(signedDocuments.status, ['preparando', 'aguardando_assinatura'])))
        .returning({ id: signedDocuments.id });
      return r.length > 0;
    },
  });
  if (!ok) throw new TransicaoInvalidaError();
}

/** US-143 "Gerar o PDF de novo": só com o PDF falho (ou sem cota, RNF-143) e ainda em preparo. */
export async function pedirNovoPdfDocumento(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db; boss?: PgBoss; agora?: Date } = {}): Promise<void> {
  const boss = deps.boss ?? (await getBoss());
  const agora = deps.agora ?? new Date();
  await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['preparando']);
    if (d.pdfStatus !== 'falhou' && d.pdfStatus !== 'sem_cota') throw new TransicaoInvalidaError();
    await tx.update(signedDocuments).set({ pdfStatus: 'pendente', pdfPedidoEm: agora, updatedAt: agora }).where(eq(signedDocuments.id, docId));
    await boss.send('documento-pdf', { tenantId: ctx.tenantId, documentoId: docId }, { db: fromDrizzle(tx, sql) });
  }, deps.db ?? getDb());
}

async function recibosDe(tx: Tx, ids: string[]): Promise<Map<string, Recibo[]>> {
  const m = new Map<string, Recibo[]>();
  if (!ids.length) return m;
  const rs = await tx.select().from(signedDocumentReceipts).where(inArray(signedDocumentReceipts.documentoId, ids)).orderBy(asc(signedDocumentReceipts.em));
  for (const r of rs) m.set(r.documentoId, [...(m.get(r.documentoId) ?? []), { evento: r.evento as EventoRecibo, via: r.via as ViaRecibo, em: r.em }]);
  return m;
}

const comoItem = (d: typeof signedDocuments.$inferSelect, recibos: Recibo[]): ItemLista => ({
  id: d.id, tipo: 'receita', status: d.status as StatusDocumento, codigo: d.codigo, createdAt: d.createdAt, assinadoEm: d.assinadoEm,
  assinaturaTipo: d.assinaturaTipo as TipoAssinatura | null, pdfStatus: d.pdfStatus, entregueEm: d.entregueEm, recibos,
});

/**
 * Lista do prontuário (título, data, situação): sem auditRead, como a agenda (D17; exceção na regra 8 do CLAUDE.md). Só
 * devolve as chaves de ItemLista — nunca itens, orientações ou justificativa (teste das chaves em documentos.test.ts).
 */
export async function listarDocumentos(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<ItemLista[]> {
  if (!idValido(patientId)) return [];
  return withTenant(ctx, async (tx) => {
    const ds = await tx.select().from(signedDocuments).where(eq(signedDocuments.patientId, patientId)).orderBy(desc(signedDocuments.createdAt));
    const rs = await recibosDe(tx, ds.map((d) => d.id));
    return ds.map((d) => comoItem(d, rs.get(d.id) ?? []));
  }, db);
}

/**
 * Leitura completa na transação de quem chama; `auditar` = false no worker (como lerPlanoNaTransacao). Com `patientId`, o
 * filtro do paciente vai na PRÓPRIA leitura do documento: de outro paciente → null antes de ler notas e recibos (uma consulta só).
 */
export async function lerDocumentoNaTransacao(tx: Tx, id: string, o: { auditar: boolean; patientId?: string }): Promise<DocumentoLido | null> {
  if (!idValido(id)) return null;
  const [d] = await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, id), o.patientId ? eq(signedDocuments.patientId, o.patientId) : undefined));
  if (!d) return null;
  const [n] = await tx.select().from(signedDocumentNotes).where(eq(signedDocumentNotes.documentoId, id));
  const rs = await recibosDe(tx, [id]);
  if (o.auditar) await auditRead(tx, { entidade: 'documentos', entidadeId: id, patientId: d.patientId });
  return {
    ...comoItem(d, rs.get(id) ?? []),
    conteudo: d.conteudo as ConteudoReceita, justificativa: n?.justificativaUso ?? null, motivoCancelamento: n?.motivoCancelamento ?? null,
    assinanteNome: d.assinanteNome, basePdfPath: d.basePdfPath, pdfPath: d.pdfPath, pdfSha256: d.pdfSha256, digitalizacaoStatus: d.digitalizacaoStatus, anonimizadoEm: d.anonimizadoEm,
  };
}

/** Página do documento no painel (conteúdo + justificativa): dado de saúde, com auditRead (RNF-142), só do paciente da rota. */
export async function lerDocumento(ctx: TenantContext, patientId: string, docId: string, db: Db = getDb()): Promise<DocumentoLido | null> {
  if (!idValido(patientId)) return null;
  return withTenant(ctx, (tx) => lerDocumentoNaTransacao(tx, docId, { auditar: true, patientId }), db);
}

/** Acompanhamento sem recarregar a página (sem auditoria, como statusDoPdf do plano). */
export async function estadoDoDocumento(ctx: TenantContext, docId: string, db: Db = getDb()): Promise<{ status: StatusDocumento; pdfStatus: string | null; digitalizacaoStatus: string | null } | null> {
  if (!idValido(docId)) return null;
  return withTenant(ctx, async (tx) => {
    const [d] = await tx.select({ status: signedDocuments.status, pdfStatus: signedDocuments.pdfStatus, digitalizacaoStatus: signedDocuments.digitalizacaoStatus }).from(signedDocuments).where(eq(signedDocuments.id, docId));
    return d ? { status: d.status as StatusDocumento, pdfStatus: d.pdfStatus, digitalizacaoStatus: d.digitalizacaoStatus } : null;
  }, db);
}

/**
 * RNF-142: devolver o PDF de um documento é leitura de dado de saúde — auditRead na transação que lê o caminho. O base
 * (`?base=1`) só enquanto "Aguardando assinatura" (é o que a nutricionista baixa para assinar); o assinado, sempre que houver.
 */
export async function caminhoDoPdfNoPainel(ctx: TenantContext, docId: string, qual: 'base' | 'assinado', db: Db = getDb()): Promise<string | null> {
  if (!idValido(docId)) return null;
  return withTenant(ctx, async (tx) => {
    const [d] = await tx.select({ patientId: signedDocuments.patientId, status: signedDocuments.status, base: signedDocuments.basePdfPath, pdf: signedDocuments.pdfPath }).from(signedDocuments).where(eq(signedDocuments.id, docId));
    const caminho = !d ? null : qual === 'base' ? (d.status === 'aguardando_assinatura' ? d.base : null) : d.pdf;
    if (!caminho || !d) return null;
    await auditRead(tx, { entidade: 'documentos', entidadeId: docId, patientId: d.patientId });
    return caminho;
  }, db);
}

/** "dd/mm/aaaa às hh:mm" no fuso do consultório (o formatarQuando da agenda põe o dia da semana na frente). */
export function dataHora(d: Date, fuso: string): string {
  const p = partesNoFuso(d, fuso);
  return `${formatarData(p.data)} às ${p.hora}`;
}

/** Linha da situação na lista; no assinado, a lista usa a situação da entrega (`situacaoDaEntrega`, entrega.ts, T10). */
export function situacaoNoPainel(d: ItemLista, fuso: string): string {
  if (d.status === 'preparando') return d.pdfStatus === 'falhou' ? 'Não foi possível gerar o PDF. Tente de novo.' : d.pdfStatus === 'sem_cota' ? MSG_COTA_ESGOTADA : '';
  if (d.status === 'assinado' && d.assinadoEm) return `Assinado em ${dataHora(d.assinadoEm, fuso)}`;
  return '';
}

/**
 * P-B8: o cartão do Início — só o que a nutricionista consegue resolver. Paciente bloqueado (ou anonimizado) tem o
 * prontuário só para consulta: não assina, não volta a editar, e a anonimização apaga o não emitido (T14) — não conta.
 * O arquivado conta: pode redigir, preparar e assinar (D14). Correção do /code-review high do PR #18.
 */
export async function contarAguardandoAssinatura(tx: Tx): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(signedDocuments)
    .innerJoin(patients, and(eq(patients.tenantId, signedDocuments.tenantId), eq(patients.id, signedDocuments.patientId)))
    .where(and(eq(signedDocuments.status, 'aguardando_assinatura'), ne(patients.status, 'bloqueado'), isNull(patients.anonimizadoEm)));
  return r?.n ?? 0;
}
