import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { signedDocumentNotes, signedDocumentReceipts, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { EscopoExportacao } from '@/modules/pacientes/exportacao-job';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { soltarArquivosDoPreparo } from './arquivos-do-preparo';
import { formatarCodigo } from './codigo';
import { RESET_PREPARO } from './documentos';
import { EMITIDOS, ROTULO_ASSINATURA, ROTULO_STATUS, TIPO_DOCUMENTO_ROTULO, type StatusDocumento, type TipoAssinatura, type TipoDocumento } from './constantes';
import type { ConteudoParecer } from './parecer';
import { descreverItem, type ConteudoReceita } from './prescricao';
import type { ConteudoSolicitacao } from './solicitacao';
import { assertNever } from './tipos-de-documento';

type BaseExportada = {
  tipo: string;
  /** NGS1.01.01: a versão do documento e, numa retificação, o código (formatado) da versão que ela substitui. */
  versao: number;
  retificaCodigo: string | null;
  situacao: string;
  criadoEm: string;
  assinadoEm: string | null;
  codigo: string | null;
  sha256: string | null;
  assinatura: string | null;
  recebimento: { evento: string; via: string; em: string }[];
  /** Caminho do PDF assinado dentro do ZIP (`documentos/…`); null se não há PDF ou se ele ficou de fora. */
  pdf: string | null;
  /** Q13-1 ★: só na exportação da EQUIPE (a chave nem existe na do titular, como o motivo de cancelamento, que nunca sai). */
  motivoDaRetificacao?: string | null;
};
type ReceitaExportada = { itens: { titulo: string; linhas: string[] }[]; orientacoes: string; justificativaDeUso: string | null };
/** Q13-2 ★: a origem dos valores (IA conferida, envio do paciente) sai aqui, nunca no PDF. Nada do laudo. */
type ParecerExportado = {
  exames: { titulo: string; data: string; enviadoPeloPaciente: boolean; valores: { nome: string; valor: number; unidade: string | null; referencia: string | null; lidoComIa: boolean }[] }[];
  avaliacao: string;
  conduta: string;
  encaminhamentos: string;
};
/** Plano 22 (R22-13): a solicitação de exames — os exames (com a marca do painel), a indicação e as orientações. */
type SolicitacaoExportada = { exames: { nome: string; painel: boolean }[]; indicacaoClinica: string | null; orientacoes: string };
export type DocumentoExportado = BaseExportada & (ReceitaExportada | ParecerExportado | SolicitacaoExportada);

const emitido = (s: string) => EMITIDOS.includes(s as StatusDocumento);

/**
 * US-150 base (D1 ★) + Plano 13: equipe = todos, com a justificativa e o motivo da retificação; titular = só os emitidos,
 * com a justificativa (D15 = (b)) e o recebimento, sem motivo de retificação (Q13-1 ★); o motivo de cancelamento nunca
 * sai. O worker roda como `worker` (a RLS do paciente não filtra): o filtro do titular é explícito aqui. Cada versão é um
 * documento (v1 substituída e v2 vigente vão as duas). O PDF preparado nunca vai; o assinado vai em documentos/.
 */
export async function documentosParaExportacao(
  tx: Tx,
  patientId: string,
  escopo: EscopoExportacao,
): Promise<{ documentos: DocumentoExportado[]; anexos: { indice: number; caminho: string; nome: string }[] }> {
  const ds = await tx
    .select()
    .from(signedDocuments)
    .where(and(eq(signedDocuments.patientId, patientId), escopo === 'titular' ? inArray(signedDocuments.status, [...EMITIDOS]) : undefined))
    .orderBy(asc(signedDocuments.createdAt), asc(signedDocuments.id));
  const ids = ds.map((d) => d.id);
  const notas = ids.length
    ? await tx
        .select({ d: signedDocumentNotes.documentoId, j: signedDocumentNotes.justificativaUso, m: signedDocumentNotes.motivoRetificacao })
        .from(signedDocumentNotes)
        .where(inArray(signedDocumentNotes.documentoId, ids))
    : [];
  const recibos = ids.length
    ? await tx.select().from(signedDocumentReceipts).where(inArray(signedDocumentReceipts.documentoId, ids)).orderBy(asc(signedDocumentReceipts.em))
    : [];
  // a versão anterior é do mesmo paciente (FK composta de retifica_id) e sempre emitida (só se retifica a "assinado"): o
  // código dela está na própria lista, também na do titular
  const codigoDe = new Map(ds.map((d) => [d.id, d.codigo && d.status !== 'rascunho' ? formatarCodigo(d.codigo) : null]));
  const anexos: { indice: number; caminho: string; nome: string }[] = [];
  const documentos: DocumentoExportado[] = ds.map((d, i) => {
    // nome sem texto do usuário (data + posição), como os laudos
    if (d.pdfPath && !d.anonimizadoEm)
      anexos.push({ indice: i, caminho: d.pdfPath, nome: `documentos/${(d.assinadoEm ?? d.createdAt).toISOString().slice(0, 10)}-${String(i + 1).padStart(2, '0')}.pdf` });
    const nota = notas.find((n) => n.d === d.id);
    const tipo = d.tipo as TipoDocumento;
    const base: BaseExportada = {
      tipo: TIPO_DOCUMENTO_ROTULO[tipo],
      versao: d.versao,
      retificaCodigo: d.retificaId ? (codigoDe.get(d.retificaId) ?? null) : null,
      situacao: ROTULO_STATUS[d.status as StatusDocumento],
      criadoEm: d.createdAt.toISOString(),
      assinadoEm: d.assinadoEm?.toISOString() ?? null,
      codigo: codigoDe.get(d.id) ?? null,
      sha256: d.pdfSha256,
      assinatura: d.assinaturaTipo ? ROTULO_ASSINATURA[d.assinaturaTipo as TipoAssinatura] : null,
      recebimento: recibos.filter((r) => r.documentoId === d.id).map((r) => ({ evento: r.evento, via: r.via, em: r.em.toISOString() })),
      pdf: null,
      ...(escopo === 'equipe' ? { motivoDaRetificacao: nota?.m ?? null } : {}),
    };
    // DEP-E7 (Plano 22): por `switch` no tipo da coluna (o conteúdo do anonimizado é '{}', sem tipo)
    switch (tipo) {
      case 'parecer': {
        const c = d.conteudo as Partial<ConteudoParecer>; // anonimizado: '{}'
        return {
          ...base,
          exames: (c.exames ?? []).map((e) => ({
            titulo: e.titulo,
            data: e.data,
            enviadoPeloPaciente: !!e.enviadoPeloPaciente,
            valores: e.valores.map((v) => ({ nome: v.nome, valor: v.valor, unidade: v.unidade, referencia: v.referencia, lidoComIa: !!v.iaTarefaId })),
          })),
          avaliacao: c.avaliacao ?? '',
          conduta: c.conduta ?? '',
          encaminhamentos: c.encaminhamentos ?? '',
        };
      }
      case 'receita': {
        const c = d.conteudo as Partial<ConteudoReceita>;
        return { ...base, itens: (c.itens ?? []).map((item) => descreverItem(item)), orientacoes: c.orientacoes ?? '', justificativaDeUso: nota?.j ?? null };
      }
      case 'solicitacao_exames': {
        // R22-13: sem justificativa de uso (é da receita); o titular só recebe os emitidos (filtro acima, como a receita)
        const c = d.conteudo as Partial<ConteudoSolicitacao>; // anonimizado: '{}'
        return {
          ...base,
          exames: (c.exames ?? []).map((e) => ({ nome: e.nome, painel: e.painel === true })),
          indicacaoClinica: c.indicacaoClinica ?? null,
          orientacoes: c.orientacoes ?? '',
        };
      }
      default:
        return assertNever(tipo);
    }
  });
  return { documentos, anexos };
}

/**
 * RN-140 (c), ANTES do laço de anexos de anonimizarVencidos: emitido → apagarArquivo do PDF com a função no
 * naMesmaTransacao (marca, limpa conteúdo e notas, elimina a verificação, solta o caminho); não emitido → volta a rascunho
 * (soltando o base no mesmo apagar) e é apagado. Um documento por transação. Devolve quantos documentos tratou.
 * As fotos da digitalizada e o base que sobrou de um emitido saem antes, cada um no seu apagarArquivo
 * (soltarArquivosDoPreparo, regra 9); o que o soltar não conseguir apagar fica sem referência e a varredura da T7
 * (limparArquivosOrfaosDeDocumentos) o apaga.
 */
export async function anonimizarDocumentosDoPaciente(ctx: TenantContext, patientId: string, deps: { db: Db; dataDir?: string }): Promise<number> {
  const ds = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: signedDocuments.id, status: signedDocuments.status, pdf: signedDocuments.pdfPath, base: signedDocuments.basePdfPath })
        .from(signedDocuments)
        .where(and(eq(signedDocuments.patientId, patientId), isNull(signedDocuments.anonimizadoEm))),
    deps.db,
  );
  let n = 0;
  for (const d of ds) {
    if (emitido(d.status)) {
      await soltarArquivosDoPreparo(ctx, d.id, EMITIDOS, { db: deps.db, dataDir: deps.dataDir });
      const anonimizar = async (tx: Tx) => {
        const r = await tx.execute<{ caminho: string | null }>(sql`select app_anonimizar_documentos(${d.id}) as caminho`);
        return r.rows[0]?.caminho === d.pdf;
      };
      if (d.pdf) await apagarArquivo(ctx, { caminho: d.pdf }, { db: deps.db, dataDir: deps.dataDir, removerAntesDoCommit: true, naMesmaTransacao: anonimizar });
      else await withTenant(ctx, anonimizar, deps.db);
    } else {
      // "Voltar a editar" solta as fotos antes do base; o base sai no apagar que apaga o documento
      await soltarArquivosDoPreparo(ctx, d.id, ['preparando', 'aguardando_assinatura'], { db: deps.db, dataDir: deps.dataDir, soFotos: true });
      const apagarDoc = async (tx: Tx) => {
        if (d.status !== 'rascunho')
          await tx
            .update(signedDocuments)
            .set({ ...RESET_PREPARO, updatedAt: new Date() })
            .where(eq(signedDocuments.id, d.id));
        await tx.delete(signedDocuments).where(eq(signedDocuments.id, d.id));
        return true;
      };
      if (d.base) await apagarArquivo(ctx, { caminho: d.base }, { db: deps.db, dataDir: deps.dataDir, removerAntesDoCommit: true, naMesmaTransacao: apagarDoc });
      else await withTenant(ctx, apagarDoc, deps.db);
    }
    n++;
  }
  return n;
}

/** A conferência final da anonimização (paciente já travado): nenhum PDF de documento pode ter sobrado. */
export async function pdfsDeDocumentosRestantes(tx: Tx, patientId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(signedDocuments)
    .where(and(eq(signedDocuments.patientId, patientId), or(isNotNull(signedDocuments.pdfPath), isNotNull(signedDocuments.basePdfPath))));
  return r?.n ?? 0;
}
