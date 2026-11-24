import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { signedDocumentNotes, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { MSG_RETIFICACAO, type StatusDocumento, type TipoDocumento } from './constantes';
import { DocumentoError, DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';
import type { ConteudoDocumento } from './parecer';
import { assertNever, semCopia } from './tipos-de-documento';

const EM_ANDAMENTO: StatusDocumento[] = ['rascunho', 'preparando', 'aguardando_assinatura'];

/** RN-146: a retificação aberta (rascunho, preparando ou aguardando assinatura) de um documento, se houver — no máximo uma (índice da 0089). */
export async function retificacaoEmAndamento(tx: Tx, documentoId: string): Promise<{ id: string; versao: number } | null> {
  const [r] = await tx
    .select({ id: signedDocuments.id, versao: signedDocuments.versao })
    .from(signedDocuments)
    .where(and(eq(signedDocuments.retificaId, documentoId), inArray(signedDocuments.status, EM_ANDAMENTO)))
    .limit(1);
  return r ?? null;
}

/** Q13-1 ★: o motivo da retificação (até 500; vazio = null — o preparo é que o exige). Sem NUL nem surrogate sem par (SUS-109). */
export function lerMotivoRetificacao(v: unknown): string | null {
  const m = typeof v === 'string' ? semInvalidosNoBanco(v).replace(/\r\n?/g, '\n').trim() : '';
  if (m.length > 500) throw new DocumentoError({ motivoRetificacao: MSG_RETIFICACAO.motivo });
  return m || null;
}

/** Plano 22 (DEP-E7): a justificativa de uso é só da receita; os outros tipos, por caso explícito, nascem sem. */
function justificativaDaVersaoNova(tipo: TipoDocumento, daVigente: string | null): string | null {
  switch (tipo) {
    case 'receita':
      return daVigente;
    case 'parecer':
    case 'solicitacao_exames':
      return null;
    default:
      return assertNever(tipo);
  }
}

/**
 * US-148: "Retificar" um documento "assinado" (a versão em vigor) abre o rascunho da versão seguinte com o conteúdo dela;
 * havendo uma retificação em andamento, abre a mesma (uma por vez). Ordem de travas (D-P1): paciente → ORIGINAL (FOR
 * UPDATE) — a do cancelamento e da assinatura da versão nova —, então dois cliques simultâneos se enfileiram e o segundo
 * acha a primeira (o índice único da 0089 continua como barreira do banco). O conteúdo vai inteiro, menos a cópia e a
 * declaração (`semCopia`, Plano 22). Na receita, a justificativa de uso vai para a nota da versão nova (a habilitação é conferida de novo ao salvar, preparar e assinar); o motivo nasce vazio (Q13-1 ★).
 */
export async function retificarDocumento(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db } = {}): Promise<string> {
  return withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      if (!idValido(docId)) throw new DocumentoNaoEncontradoError();
      const [o] = await tx
        .select()
        .from(signedDocuments)
        .where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId)))
        .for('update');
      if (!o) throw new DocumentoNaoEncontradoError();
      if (o.status !== 'assinado' || o.anonimizadoEm) throw new TransicaoInvalidaError();
      const aberta = await retificacaoEmAndamento(tx, docId);
      if (aberta) return aberta.id;
      const [n] = await tx
        .insert(signedDocuments)
        .values({ tenantId: ctx.tenantId, patientId, tipo: o.tipo, versao: o.versao + 1, retificaId: o.id, conteudo: semCopia(o.conteudo as ConteudoDocumento) })
        .returning({ id: signedDocuments.id });
      const [nota] = await tx.select({ j: signedDocumentNotes.justificativaUso }).from(signedDocumentNotes).where(eq(signedDocumentNotes.documentoId, docId));
      await tx.insert(signedDocumentNotes).values({ tenantId: ctx.tenantId, patientId, documentoId: n.id, justificativaUso: justificativaDaVersaoNova(o.tipo as TipoDocumento, nota?.j ?? null) });
      return n.id;
    },
    deps.db ?? getDb(),
  );
}
