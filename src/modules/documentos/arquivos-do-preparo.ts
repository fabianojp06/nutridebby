import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { getDb, type Db } from '@/db/client';
import { signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import type { StatusDocumento } from './constantes';

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
