import { and, desc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { patients, signedDocumentReceipts, signedDocuments, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import { TIPO_DOCUMENTO_ROTULO, type TipoAssinatura, type TipoDocumento } from './constantes';
import { registrarRecibo } from './recebimento';

/** US-146 (texto exato da spec v0.3). */
export const MSG_PORTAL_DOC = {
  vazio: 'Você ainda não tem documentos.',
  substituido: 'Substituído por uma versão mais nova.',
  cancelado: 'Cancelado pela nutricionista. Não use este documento.',
  confirmar: 'Confirmo que recebi este documento',
} as const;

/** US-146 v0.5: título pelo tipo e a versão (Q13-5 ★); nunca exames, valores, avaliação, itens ou orientações (D17 do 10A). */
export type DocumentoNoPortal = {
  id: string;
  tipo: TipoDocumento;
  titulo: string;
  versao: number;
  data: Date;
  status: 'assinado' | 'substituido' | 'cancelado';
  assinaturaTipo: TipoAssinatura;
  aberto: boolean;
  recebidoEm: Date | null;
};

/**
 * RN-153: bloqueado ou anonimizado não vê mais nada (o prontuário fica só para a nutricionista). D20: com o interruptor
 * do admin desligado (`documentos_liberados`), o portal também não mostra nem entrega documento — a regra vale dos dois
 * lados, não só na aba da nutricionista (correção do /code-review high do PR #18).
 */
async function ativo(tx: Tx, ctx: TenantContext): Promise<boolean> {
  const [t] = await tx.select({ liberado: tenants.documentosLiberados }).from(tenants).where(eq(tenants.id, ctx.tenantId));
  if (!t?.liberado) return false;
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, ctx.patientId!));
  return !!p && p.status !== 'bloqueado' && !p.anonimizadoEm;
}

/**
 * A lista (título, data, situação) não chama auditRead, como a agenda (D17; exceção na regra 8 do CLAUDE.md): só as chaves
 * de DocumentoNoPortal, nunca itens ou orientações (teste das chaves em portal.test.ts). A RLS (paciente_so_emitidos) já
 * filtra os emitidos do próprio paciente; o filtro por `patient_id` aqui é só defesa em profundidade.
 */
export async function documentosDoPaciente(ctx: TenantContext, db: Db = getDb()): Promise<DocumentoNoPortal[]> {
  return withTenant(
    ctx,
    async (tx) => {
      if (!(await ativo(tx, ctx))) return [];
      const ds = await tx
        .select({
          id: signedDocuments.id, tipo: signedDocuments.tipo, versao: signedDocuments.versao, status: signedDocuments.status,
          assinadoEm: signedDocuments.assinadoEm, assinaturaTipo: signedDocuments.assinaturaTipo,
        })
        .from(signedDocuments)
        .where(and(eq(signedDocuments.patientId, ctx.patientId!), isNull(signedDocuments.anonimizadoEm)))
        .orderBy(desc(signedDocuments.assinadoEm));
      const rs = ds.length
        ? await tx
            .select({ documentoId: signedDocumentReceipts.documentoId, evento: signedDocumentReceipts.evento, em: signedDocumentReceipts.em })
            .from(signedDocumentReceipts)
            .where(inArray(signedDocumentReceipts.documentoId, ds.map((d) => d.id)))
        : [];
      return ds.map((d) => ({
        id: d.id,
        tipo: d.tipo as TipoDocumento,
        titulo: TIPO_DOCUMENTO_ROTULO[d.tipo as TipoDocumento],
        versao: d.versao,
        data: d.assinadoEm!,
        status: d.status as DocumentoNoPortal['status'],
        assinaturaTipo: d.assinaturaTipo as TipoAssinatura,
        aberto: rs.some((r) => r.documentoId === d.id && r.evento === 'aberto'),
        recebidoEm: rs.find((r) => r.documentoId === d.id && r.evento === 'recebido')?.em ?? null,
      }));
    },
    db,
  );
}

/** O número do cartão do Início (e do item do mural): assinados ainda não abertos. Sem auditRead (10A D17: contagem). */
export async function novosNoPortal(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  return withTenant(ctx, (tx) => novosNoPortalNaTransacao(tx, ctx), db);
}

/** Plano 16: o mesmo, dentro da transação do mural (muralDoPaciente). Só numa sessão de paciente. */
export async function novosNoPortalNaTransacao(tx: Tx, ctx: TenantContext): Promise<number> {
  if (!(await ativo(tx, ctx))) return 0;
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(signedDocuments)
    .where(
      and(
        eq(signedDocuments.patientId, ctx.patientId!),
        eq(signedDocuments.status, 'assinado'),
        isNull(signedDocuments.anonimizadoEm),
        notExists(
          tx
            .select({ x: sql`1` })
            .from(signedDocumentReceipts)
            .where(and(eq(signedDocumentReceipts.documentoId, signedDocuments.id), eq(signedDocumentReceipts.evento, 'aberto'))),
        ),
      ),
    );
  return r?.n ?? 0;
}

/** "Abrir PDF": dado de saúde → auditRead; grava o evento "aberto" (uma vez, só no assinado). A URL assinada nasce na rota (303). */
export async function caminhoDoPdfNoPortal(ctx: TenantContext, docId: string, db: Db = getDb()): Promise<string | null> {
  if (!idValido(docId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      if (!(await ativo(tx, ctx))) return null;
      const [d] = await tx
        .select({ pdf: signedDocuments.pdfPath, status: signedDocuments.status })
        .from(signedDocuments)
        .where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, ctx.patientId!), isNull(signedDocuments.anonimizadoEm)));
      if (!d?.pdf) return null;
      await auditRead(tx, { entidade: 'documentos', entidadeId: docId, patientId: ctx.patientId! });
      if (d.status === 'assinado') await registrarRecibo(tx, { tenantId: ctx.tenantId, patientId: ctx.patientId!, documentoId: docId, evento: 'aberto', via: 'portal' });
      return d.pdf;
    },
    db,
  );
}

/** D4: o botão. Só documento assinado (a política paciente_recibo_proprio confere no banco); devolve a data do recebimento. */
export async function confirmarRecebimentoNoPortal(ctx: TenantContext, docId: string, db: Db = getDb()): Promise<Date | null> {
  if (!idValido(docId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      if (!(await ativo(tx, ctx))) return null;
      const [d] = await tx.select({ status: signedDocuments.status }).from(signedDocuments).where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, ctx.patientId!)));
      if (d?.status !== 'assinado') return null;
      await registrarRecibo(tx, { tenantId: ctx.tenantId, patientId: ctx.patientId!, documentoId: docId, evento: 'recebido', via: 'portal' });
      const [r] = await tx
        .select({ em: signedDocumentReceipts.em })
        .from(signedDocumentReceipts)
        .where(and(eq(signedDocumentReceipts.documentoId, docId), eq(signedDocumentReceipts.evento, 'recebido')));
      return r?.em ?? null;
    },
    db,
  );
}
