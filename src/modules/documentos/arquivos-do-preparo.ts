import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { getDb, type Db, type Tx } from '@/db/client';
import { patients, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import type { StatusDocumento } from './constantes';

/**
 * Ordem única de travas dos documentos (code review do PR #19, I2; Plano 13, D-P1; code review do PR #27, P13-16 a):
 * PACIENTE → ORIGINAL → VERSÃO NOVA → TENANT (a cota do salvarArquivo) → registro. Todo salvarArquivo que grava em
 * `signed_documents` no `registrar` chama isto no `antesDaReserva`:
 * - o paciente primeiro: o INSERT em stored_files pede FOR KEY SHARE nele (FK) e o cancelamento e a retificação da
 *   original (carregarPacienteParaEscrita → original) o travam antes da original — travado depois, fecha ciclo (40P01);
 *   reconferido aqui (bloqueado ou anonimizado → `recusa()`, o erro de quem chama);
 * - a ORIGINAL só onde ela muda (`original: true`: a assinatura da versão nova a leva a "substituido") — no PDF base e nas
 *   fotos da digitalizada ela não muda, e travá-la serializaria sem necessidade com o cancelamento e a retificação;
 * - o documento antes do tenant: sem isso, o salvarArquivo travaria tenant → documento e o soltarArquivosDoPreparo
 *   (abaixo), documento → tenant (deadlock no mesmo documento).
 * FOR NO KEY UPDATE basta (nenhum dos três muda chave): ainda espera o FOR UPDATE do cancelamento e da retificação, mas não
 * barra os INSERTs que só apontam para o paciente ou o documento (FOR KEY SHARE da FK). `patient_id` e `retifica_id` são
 * colunas fixas (gatilho), então lê-las sem trava é seguro.
 */
export async function travarDocumentoAntesDaCota(tx: Tx, doc: { id: string; patientId: string }, o: { original: boolean; recusa: () => Error }): Promise<void> {
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, doc.patientId)).for('no key update');
  if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw o.recusa();
  if (o.original) {
    const [d] = await tx.select({ retificaId: signedDocuments.retificaId }).from(signedDocuments).where(eq(signedDocuments.id, doc.id));
    if (d?.retificaId) await tx.select({ id: signedDocuments.id }).from(signedDocuments).where(eq(signedDocuments.id, d.retificaId)).for('no key update');
  }
  await tx.select({ id: signedDocuments.id }).from(signedDocuments).where(eq(signedDocuments.id, doc.id)).for('no key update');
}

/**
 * Regra 9 do CLAUDE.md (correção do /code-review high do PR #18): cada arquivo do preparo — as fotos da digitalizada e o
 * PDF base — sai do disco e da cota no SEU apagarArquivo, e o ponteiro sai no naMesmaTransacao desse apagar, só se o
 * documento ainda está num dos `estados` e ainda aponta para o arquivo (como o original da foto do diário). Depois da
 * assinatura (EMITIDOS) é o que solta o base e as fotos — a assinatura os mantém e o gatilho só deixa esses ponteiros
 * encolherem (T2); no "Voltar a editar" (`soFotos`), as fotos saem antes do base. Um arquivo que falha não para os outros:
 * a varredura da T7 tenta de novo. Devolve quantos arquivos saíram.
 */
export async function soltarArquivosDoPreparo(
  ctx: TenantContext, documentoId: string, estados: readonly StatusDocumento[], deps: { db?: Db; dataDir?: string; soFotos?: boolean } = {},
): Promise<number> {
  const db = deps.db ?? getDb();
  const noEstado = and(eq(signedDocuments.id, documentoId), inArray(signedDocuments.status, [...estados]));
  const [d] = await withTenant(ctx, (tx) => tx.select({ base: signedDocuments.basePdfPath, fotos: signedDocuments.digitalizacao }).from(signedDocuments).where(noEstado), db);
  if (!d) return 0;
  const soltar = (caminho: string, set: PgUpdateSetSource<typeof signedDocuments>, aponta: SQL) =>
    apagarArquivo(ctx, { caminho }, {
      db,
      dataDir: deps.dataDir,
      naMesmaTransacao: async (tx) =>
        (await tx.update(signedDocuments).set({ ...set, updatedAt: new Date() }).where(and(noEstado, aponta)).returning({ id: signedDocuments.id })).length > 0,
    }).catch(() => false);
  let n = 0;
  for (const c of d.fotos ?? [])
    if (await soltar(c, { digitalizacao: sql`nullif(${signedDocuments.digitalizacao} - ${c}::text, '[]'::jsonb)` }, sql`${signedDocuments.digitalizacao} ? ${c}`)) n++;
  const comBase = !!d.base && !deps.soFotos;
  if (comBase && (await soltar(d.base!, { basePdfPath: null }, eq(signedDocuments.basePdfPath, d.base!)))) n++;
  if (n < (d.fotos?.length ?? 0) + (comBase ? 1 : 0))
    logger.warn({ tenantId: ctx.tenantId, documentoId, motivo: 'arquivo_do_preparo' }, 'arquivo do preparo não apagado (a varredura tenta de novo)');
  return n;
}
