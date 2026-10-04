import { and, asc, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { contentAudience, contentFavorites, contents, contentViews } from '@/db/schema';

/**
 * D15 / US-018 ("sai das audiências de conteúdo") / RNF-08 ("sem uso em conteúdo"): na transação do bloqueio e da
 * anonimização, o titular deixa de ser alvo e o uso dele (visualizações, favoritos) some. A saída de content_audience
 * fica no "Histórico de acessos" (gatilho, D6).
 */
export async function apagarUsoDeConteudo(tx: Tx, patientId: string): Promise<void> {
  await tx.delete(contentAudience).where(eq(contentAudience.patientId, patientId));
  await tx.delete(contentFavorites).where(eq(contentFavorites.patientId, patientId));
  await tx.delete(contentViews).where(eq(contentViews.patientId, patientId));
}

export type ConteudosDoTitular = { vistos: { titulo: string; vistoEm: string }[]; favoritos: { titulo: string; favoritadoEm: string }[] };

/** US-018 / US-046 (D15): o que o titular abriu e favoritou, para o dados.json (só o título e a data). */
export async function conteudosDoTitular(tx: Tx, patientId: string): Promise<ConteudosDoTitular> {
  const doConteudo = (t: typeof contentViews | typeof contentFavorites) => and(eq(contents.tenantId, t.tenantId), eq(contents.id, t.contentId));
  const vistos = await tx
    .select({ titulo: contents.titulo, em: contentViews.vistoEm })
    .from(contentViews)
    .innerJoin(contents, doConteudo(contentViews))
    .where(eq(contentViews.patientId, patientId))
    .orderBy(asc(contentViews.vistoEm));
  const favoritos = await tx
    .select({ titulo: contents.titulo, em: contentFavorites.createdAt })
    .from(contentFavorites)
    .innerJoin(contents, doConteudo(contentFavorites))
    .where(eq(contentFavorites.patientId, patientId))
    .orderBy(asc(contentFavorites.createdAt));
  return {
    vistos: vistos.map((v) => ({ titulo: v.titulo, vistoEm: v.em.toISOString() })),
    favoritos: favoritos.map((f) => ({ titulo: f.titulo, favoritadoEm: f.em.toISOString() })),
  };
}
