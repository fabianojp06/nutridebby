import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { patients, signedDocumentNotes, signedDocumentReceipts, signedDocuments, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { FILA_DO_PDF_DO_DOCUMENTO } from '@/jobs/queues';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { formatarData } from '@/modules/pacientes/datas';
import { apagarArquivo, MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { soltarArquivosDoPreparo } from './arquivos-do-preparo';
import { gerarCodigo } from './codigo';
import { DECLARACAO_POR_TIPO, DIGITALIZACAO_MAX_MS, envioEmCurso, MSG_DECLARACAO, MSG_RETIFICACAO, type EventoRecibo, type StatusDocumento, type TipoAssinatura, type TipoDocumento, type ViaRecibo } from './constantes';
import { DocumentoError, DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';
import { validarParecerParaPreparar, validarRascunhoParecer, type ConteudoDocumento, type ConteudoParecer } from './parecer';
import { copiarExames } from './parecer-exames';
import { copiaDoPerfil, type CopiaDoDocumento } from './perfil-profissional';
import { validarParaPreparar, validarRascunho } from './prescricao';
import { lerMotivoRetificacao } from './retificacao';
import { validarSolicitacaoParaPreparar } from './solicitacao';
import { assertNever, conteudoVazio } from './tipos-de-documento';

export type Recibo = { evento: EventoRecibo; via: ViaRecibo; em: Date };
export type ItemLista = {
  id: string; tipo: TipoDocumento; versao: number; status: StatusDocumento; codigo: string | null; createdAt: Date; assinadoEm: Date | null;
  assinaturaTipo: TipoAssinatura | null; pdfStatus: string | null; entregueEm: Date | null; recibos: Recibo[];
};
export type VersaoVizinha = { id: string; versao: number };
export type DocumentoLido = ItemLista & {
  conteudo: ConteudoDocumento; justificativa: string | null; motivoCancelamento: string | null; assinanteNome: string | null;
  basePdfPath: string | null; pdfPath: string | null; pdfSha256: string | null; digitalizacaoStatus: string | null; digitalizacaoEm: Date | null;
  anonimizadoEm: Date | null; canceladoEm: Date | null;
  /** Plano 13 (US-148): a versão anterior (desta retificação) e a seguinte (a retificação desta, em andamento ou assinada). */
  retificaId: string | null; motivoRetificacao: string | null; substituidoEm: Date | null;
  versoes: { anterior: (VersaoVizinha & { codigo: string | null }) | null; seguinte: (VersaoVizinha & { status: StatusDocumento }) | null };
};

/** Trava o documento do paciente (FOR UPDATE) num dos estados pedidos; outro estado → TransicaoInvalidaError. */
async function travarDocumento(tx: Tx, patientId: string, docId: string, estados: readonly StatusDocumento[]) {
  if (!idValido(docId)) throw new DocumentoNaoEncontradoError();
  const [d] = await tx.select().from(signedDocuments).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId))).for('update');
  if (!d) throw new DocumentoNaoEncontradoError();
  if (!estados.includes(d.status as StatusDocumento)) throw new TransicaoInvalidaError();
  return d;
}

/** US-142 / US-141: o rascunho vazio e a nota (justificativa, motivos: fora do conteúdo, D15 da spec). */
async function criarDocumento(ctx: TenantContext, patientId: string, conteudo: ConteudoDocumento, db: Db): Promise<string> {
  return withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const [d] = await tx.insert(signedDocuments).values({ tenantId: ctx.tenantId, patientId, tipo: conteudo.tipo, conteudo }).returning({ id: signedDocuments.id });
    await tx.insert(signedDocumentNotes).values({ tenantId: ctx.tenantId, patientId, documentoId: d.id });
    return d.id;
  }, db);
}

/** US-142: "Nova receita". */
export const criarReceita = (ctx: TenantContext, patientId: string, deps: { db?: Db } = {}): Promise<string> => criarDocumento(ctx, patientId, conteudoVazio('receita'), deps.db ?? getDb());
/** US-141: "Novo parecer nutricional". */
export const criarParecer = (ctx: TenantContext, patientId: string, deps: { db?: Db } = {}): Promise<string> => criarDocumento(ctx, patientId, conteudoVazio('parecer'), deps.db ?? getDb());

/** "Rascunho salvo." — valida os itens (habilitação no servidor, RN-150) e grava conteúdo e justificativa. */
export async function salvarRascunhoReceita(
  ctx: TenantContext, tenant: TenantRow, patientId: string, docId: string, input: { conteudo: unknown; justificativa: unknown; motivoRetificacao?: unknown }, deps: { db?: Db } = {},
): Promise<void> {
  const conteudo = validarRascunho(input.conteudo, { habilitada: !!tenant.fitoterapiaRegistro });
  // SUS-109: um NUL na coluna text daria 22021 com o texto no log
  const j = typeof input.justificativa === 'string' ? semInvalidosNoBanco(input.justificativa).trim() : '';
  if (j.length > 2000) throw new DocumentoError({ justificativa: 'Use no máximo 2000 caracteres.' });
  const motivo = input.motivoRetificacao === undefined ? undefined : lerMotivoRetificacao(input.motivoRetificacao);
  await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['rascunho']);
    // EP-D57 (Plano 22): a guarda do editor fica — recusa qualquer outro tipo (parecer, solicitação), não cai em nenhum
    if (d.tipo !== 'receita') throw new TransicaoInvalidaError(); // o editor da receita não grava num parecer
    await tx.update(signedDocuments).set({ conteudo, updatedAt: new Date() }).where(eq(signedDocuments.id, docId));
    await tx
      .update(signedDocumentNotes)
      .set({ justificativaUso: j || null, ...(d.retificaId && motivo !== undefined ? { motivoRetificacao: motivo } : {}), updatedAt: new Date() })
      .where(eq(signedDocumentNotes.documentoId, docId));
  }, deps.db ?? getDb());
}

/**
 * US-141 "Rascunho salvo." — valida (D-P4: incompleto vale no rascunho) e REFAZ a cópia dos exames escolhidos (RN-148):
 * linhas acrescentadas pela IA ou data trocada entram a cada salvamento. Ordem de travas: paciente → documento.
 */
export async function salvarRascunhoParecer(
  ctx: TenantContext, patientId: string, docId: string, input: { conteudo: unknown; motivoRetificacao?: unknown }, deps: { db?: Db } = {},
): Promise<void> {
  const r = validarRascunhoParecer(input.conteudo);
  const motivo = input.motivoRetificacao === undefined ? undefined : lerMotivoRetificacao(input.motivoRetificacao);
  await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['rascunho']);
    if (d.tipo !== 'parecer') throw new TransicaoInvalidaError(); // EP-D57: idem, o editor do parecer só grava num parecer
    const exames = await copiarExames(tx, patientId, r.exameIds);
    const conteudo: ConteudoParecer = { versao: 1, tipo: 'parecer', exames, avaliacao: r.avaliacao, conduta: r.conduta, encaminhamentos: r.encaminhamentos };
    await tx.update(signedDocuments).set({ conteudo, updatedAt: new Date() }).where(eq(signedDocuments.id, docId));
    if (d.retificaId && motivo !== undefined)
      await tx.update(signedDocumentNotes).set({ motivoRetificacao: motivo, updatedAt: new Date() }).where(eq(signedDocumentNotes.documentoId, docId));
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
 * US-143 / US-141: declaração do tipo (D5) + perfil completo + (receita) justificativa ou (parecer) exames e avaliação →
 * congela a cópia (RN-154; no parecer, a última cópia dos exames, RN-148), gera o código (RN-142) e enfileira o PDF na mesma
 * transação (o job só existe se a transação confirmar).
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
    const [nota] = await tx
      .select({ j: signedDocumentNotes.justificativaUso, m: signedDocumentNotes.motivoRetificacao })
      .from(signedDocumentNotes)
      .where(eq(signedDocumentNotes.documentoId, docId));
    // US-148 / Q13-1 ★ (NGS1.12.01): a retificação vai ao preparo com o motivo; a cópia leva a versão e o código da anterior (RN-154)
    let retificacao: CopiaDoDocumento['retificacao'];
    if (d.retificaId) {
      if (!nota?.m?.trim()) throw new DocumentoError({ motivoRetificacao: MSG_RETIFICACAO.motivo });
      const [anterior] = await tx.select({ codigo: signedDocuments.codigo }).from(signedDocuments).where(eq(signedDocuments.id, d.retificaId));
      retificacao = { versao: d.versao, substitui: anterior!.codigo! };
    }
    const tipo = d.tipo as TipoDocumento;
    // Plano 22 (DEP-E7): o conteúdo gravado é o do tipo da coluna (o editor de cada tipo só grava o seu, :75 e :96)
    let conteudo: ConteudoDocumento = d.conteudo as ConteudoDocumento;
    switch (conteudo.tipo) {
      case 'parecer':
        validarParecerParaPreparar(conteudo);
        // RN-148: a cópia "por último, ao preparar" — o que a IA acrescentou depois do último salvar entra; excluído → erro
        conteudo = { ...conteudo, exames: await copiarExames(tx, patientId, conteudo.exames.map((e) => e.id)) };
        break;
      case 'receita':
        validarParaPreparar(conteudo, nota?.j ?? null, { habilitada: !!tenant.fitoterapiaRegistro });
        break;
      case 'solicitacao_exames':
        // RN-389: ao menos um exame; sem justificativa de uso (é da receita)
        validarSolicitacaoParaPreparar(conteudo);
        break;
      default:
        assertNever(conteudo);
    }
    if (conteudo.tipo !== tipo) throw new TransicaoInvalidaError(); // conteúdo de um tipo na linha de outro: nunca prepara
    await tx
      .update(signedDocuments)
      .set({
        status: 'preparando',
        codigo: gerarCodigo(),
        declaracaoEm: agora,
        conteudo: { ...conteudo, copia: { profissional, paciente: { nome: paciente.nome }, ...(retificacao ? { retificacao } : {}) }, declaracao: DECLARACAO_POR_TIPO[tipo] },
        pdfStatus: 'pendente',
        pdfPedidoEm: agora,
        updatedAt: agora,
      })
      .where(eq(signedDocuments.id, docId));
    await boss.send(FILA_DO_PDF_DO_DOCUMENTO, { tenantId: ctx.tenantId, documentoId: docId }, { db: fromDrizzle(tx, sql) });
  }, deps.db ?? getDb());
}

/**
 * RN-140 (a): tudo do preparo volta a nulo — a lista ÚNICA do "Voltar a editar" e da anonimização do não emitido
 * (lgpd-documentos.ts; code review do PR #19, item 8). Quem usa acrescenta o `updatedAt`.
 */
export const RESET_PREPARO = {
  status: 'rascunho', codigo: null, declaracaoEm: null, basePdfPath: null, basePdfSha256: null, basePdfBytes: null, areaAssinatura: null,
  pdfStatus: null, pdfPedidoEm: null, digitalizacao: null, digitalizacaoStatus: null, digitalizacaoEm: null,
} as const;

/**
 * RN-140 (a): volta a rascunho (código e base nulos) no naMesmaTransacao do DELETE do PDF base. Regra 9: as fotos de um
 * envio digitalizado que falhou saem ANTES, cada uma no seu apagarArquivo (soltarArquivosDoPreparo com `soFotos`); o
 * `digitalizacao: null` do RESET_PREPARO só cobre uma foto gravada no meio (corrida), que a varredura da T7 apaga sem referência.
 * Code review do PR #19: com um envio digitalizado em curso (D24), recusado (item 9) — nem na trava nem no apagar do base;
 * e a volta gravada sem a linha do base em stored_files é sucesso (item 4: a varredura da T7 cuida do que sobrar).
 */
export async function voltarAEditar(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db; dataDir?: string; agora?: Date } = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const limpar = { ...RESET_PREPARO, updatedAt: agora };
  const base = await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['preparando', 'aguardando_assinatura']);
    if (d.status === 'aguardando_assinatura' && envioEmCurso(d, agora)) throw new TransicaoInvalidaError();
    if (!d.basePdfPath) await tx.update(signedDocuments).set(limpar).where(eq(signedDocuments.id, docId));
    return d.basePdfPath;
  }, db);
  if (!base) return;
  await soltarArquivosDoPreparo(ctx, docId, ['aguardando_assinatura'], { db, dataDir: deps.dataDir, soFotos: true });
  // um envio que começou depois da trava acima (D24) não perde o base: a mesma regra do envioEmCurso, no banco
  const semEnvioEmCurso = sql`not coalesce(${signedDocuments.digitalizacaoStatus} in ('recebendo', 'pendente') and ${signedDocuments.digitalizacaoEm} > ${new Date(agora.getTime() - DIGITALIZACAO_MAX_MS)}, false)`;
  let voltou = false;
  const ok = await apagarArquivo(ctx, { caminho: base }, {
    db,
    dataDir: deps.dataDir,
    naMesmaTransacao: async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      const r = await tx
        .update(signedDocuments)
        .set(limpar)
        .where(and(eq(signedDocuments.id, docId), eq(signedDocuments.basePdfPath, base), inArray(signedDocuments.status, ['preparando', 'aguardando_assinatura']), semEnvioEmCurso))
        .returning({ id: signedDocuments.id });
      voltou = r.length > 0;
      return voltou;
    },
  });
  if (!ok && !voltou) throw new TransicaoInvalidaError();
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
    await boss.send(FILA_DO_PDF_DO_DOCUMENTO, { tenantId: ctx.tenantId, documentoId: docId }, { db: fromDrizzle(tx, sql) });
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
  id: d.id, tipo: d.tipo as TipoDocumento, versao: d.versao, status: d.status as StatusDocumento, codigo: d.codigo, createdAt: d.createdAt, assinadoEm: d.assinadoEm,
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
  const [anterior] = d.retificaId
    ? await tx.select({ id: signedDocuments.id, versao: signedDocuments.versao, codigo: signedDocuments.codigo }).from(signedDocuments).where(eq(signedDocuments.id, d.retificaId))
    : [];
  const [seguinte] = await tx
    .select({ id: signedDocuments.id, versao: signedDocuments.versao, status: signedDocuments.status })
    .from(signedDocuments)
    .where(eq(signedDocuments.retificaId, id))
    .orderBy(desc(signedDocuments.createdAt))
    .limit(1);
  return {
    ...comoItem(d, rs.get(id) ?? []),
    conteudo: d.conteudo as ConteudoDocumento, justificativa: n?.justificativaUso ?? null, motivoCancelamento: n?.motivoCancelamento ?? null,
    assinanteNome: d.assinanteNome, basePdfPath: d.basePdfPath, pdfPath: d.pdfPath, pdfSha256: d.pdfSha256, digitalizacaoStatus: d.digitalizacaoStatus, digitalizacaoEm: d.digitalizacaoEm,
    anonimizadoEm: d.anonimizadoEm, canceladoEm: d.canceladoEm,
    retificaId: d.retificaId, motivoRetificacao: n?.motivoRetificacao ?? null, substituidoEm: d.substituidoEm,
    versoes: { anterior: anterior ?? null, seguinte: seguinte ? { ...seguinte, status: seguinte.status as StatusDocumento } : null },
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
