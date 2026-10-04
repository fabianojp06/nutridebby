import { sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { contentAudience, contents, patientTagLinks, patientTags, recipeIngredients, recipes, type ContentRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { ctxPaciente, type TenantDeTeste } from './pacientes';

type Extra = Partial<typeof contents.$inferInsert> & {
  /** visibilidade "pacientes": os alvos. */
  pacientes?: string[];
  /** visibilidade "etiquetas": ids de patient_tags. */
  tags?: string[];
  /** tipo "receita": rendimento, porção e ingredientes (gramas). */
  receita?: { rendimento: number; porcao: number; ingredientes?: { foodId: string; g: number }[] };
};

/** Conteúdo gravado direto como a nutricionista (sem validação): publicado, orientação, para todos — salvo o `extra`. */
export async function novoConteudo(db: Db, T: TenantDeTeste, extra: Extra = {}): Promise<ContentRow> {
  const { pacientes = [], tags = [], receita, ...colunas } = extra;
  const status = colunas.status ?? 'publicado';
  return withTenant(
    T.ctx,
    async (tx) => {
      const [c] = await tx
        .insert(contents)
        .values({ tenantId: T.tenantId, tipo: 'orientacao', titulo: 'Como ler rótulos', status, publicadoEm: status === 'publicado' ? new Date() : null, ...colunas })
        .returning();
      for (const patientId of pacientes) await tx.insert(contentAudience).values({ tenantId: T.tenantId, contentId: c.id, patientId });
      for (const tagId of tags) await tx.insert(contentAudience).values({ tenantId: T.tenantId, contentId: c.id, tagId });
      if (receita) {
        await tx.insert(recipes).values({ tenantId: T.tenantId, contentId: c.id, rendimentoTotalG: receita.rendimento, porcaoG: receita.porcao });
        for (const [ordem, i] of (receita.ingredientes ?? []).entries())
          await tx.insert(recipeIngredients).values({ tenantId: T.tenantId, contentId: c.id, foodId: i.foodId, quantidadeG: i.g, ordem });
      }
      return c;
    },
    db,
  );
}

/** Etiqueta de paciente (US-019) já aplicada a `pacientes`. */
export async function novaEtiqueta(db: Db, T: TenantDeTeste, nome: string, pacientes: string[] = []): Promise<string> {
  return withTenant(
    T.ctx,
    async (tx) => {
      const [e] = await tx.insert(patientTags).values({ tenantId: T.tenantId, nome: `${nome}-${crypto.randomUUID().slice(0, 6)}` }).returning({ id: patientTags.id });
      for (const patientId of pacientes) await tx.insert(patientTagLinks).values({ tenantId: T.tenantId, patientId, tagId: e.id });
      return e.id;
    },
    db,
  );
}

/** Roda `fn` na sessão de um paciente (RLS dele). */
export const comoPaciente =
  (db: Db, tenantId: string, patientId: string) =>
  <R>(fn: (tx: Tx) => Promise<R>): Promise<R> =>
    withTenant(ctxPaciente(tenantId, patientId), fn, db);

/** Os ids de conteúdo que a sessão vê (para conferir a audiência). */
export const idsVisiveis = (tx: Tx) => tx.execute(sql`select id from contents order by created_at`).then((r) => r.rows.map((x) => x.id as string));
