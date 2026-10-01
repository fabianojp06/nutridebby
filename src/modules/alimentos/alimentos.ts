import { and, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { fkViolation } from '@/db/errors';
import { foods } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { decimalEntre } from '@/lib/numero';
import { normalizarTexto } from '@/lib/text';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { GRAMAS_MAX, KCAL_MAX, MSG_ALIMENTO } from './alimentos-constantes';
import type { Nutrientes100 } from './busca';
import { ehGrupo } from './grupos';
import { medidasDeVarios, type MedidaDisponivel } from './medidas';

export type AlimentoDetalhe = {
  id: string;
  nome: string;
  grupo: string;
  origem: 'TACO' | 'Meu alimento';
  porCem: Nutrientes100;
  medidas: MedidaDisponivel[];
  /** Algum dos 5 valores principais está sem número (TACO "NA"/"*"). */
  incompleto: boolean;
};

export class AlimentoError extends Error {
  override name = 'AlimentoError';
  constructor(readonly erros: Record<string, string>) {
    super('Alimento inválido');
  }
}

const idValido = (id: unknown): id is string => typeof id === 'string' && z.guid().safeParse(id).success;
const gramas = decimalEntre(MSG_ALIMENTO.valores, 0, GRAMAS_MAX);
const schema = z.object({
  nome: z.unknown().transform(normalizarTexto).pipe(z.string().min(2, MSG_ALIMENTO.nome).max(120, MSG_ALIMENTO.nome)),
  grupo: z.unknown().refine(ehGrupo, MSG_ALIMENTO.grupo),
  kcal: decimalEntre(MSG_ALIMENTO.valores, 0, KCAL_MAX),
  proteinaG: gramas,
  carboidratoG: gramas,
  lipidioG: gramas,
  fibraG: gramas,
});
type EntradaAlimento = Record<keyof z.input<typeof schema>, unknown>;

function validar(input: EntradaAlimento) {
  const r = schema.safeParse(input);
  if (!r.success) throw new AlimentoError(primeiroErroPorCampo(r.error));
  return { ...r.data, grupo: r.data.grupo as string };
}

const porCem = (f: typeof foods.$inferSelect): Nutrientes100 => ({ kcal: f.kcal, proteinaG: f.proteinaG, carboidratoG: f.carboidratoG, lipidioG: f.lipidioG, fibraG: f.fibraG });
const incompleto = (n: Nutrientes100) => Object.values(n).some((v) => v === null);

export async function carregarAlimento(ctx: TenantContext, id: string, db: Db = getDb()): Promise<AlimentoDetalhe | null> {
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [f] = await tx.select().from(foods).where(eq(foods.id, id));
      if (!f) return null;
      const n = porCem(f);
      return { id: f.id, nome: f.nome, grupo: f.grupo, origem: f.tenantId === null ? 'TACO' : 'Meu alimento', porCem: n, medidas: (await medidasDeVarios(tx, [f.id])).get(f.id) ?? [], incompleto: incompleto(n) };
    },
    db,
  );
}

export async function criarAlimento(ctx: TenantContext, input: EntradaAlimento, deps: { db?: Db } = {}): Promise<{ id: string }> {
  const v = validar(input);
  const [f] = await withTenant(ctx, (tx) => tx.insert(foods).values({ tenantId: ctx.tenantId, ...v }).returning({ id: foods.id }), deps.db ?? getDb());
  return f;
}

/** Só o próprio tenant altera (RLS); a TACO dá "não pode ser alterada" (D1). */
async function exigirProprio(tx: Tx, id: string) {
  const [f] = await tx.select({ tenantId: foods.tenantId }).from(foods).where(eq(foods.id, id));
  if (!f) throw new AlimentoError({ geral: MSG_ALIMENTO.naoEncontrado });
  if (f.tenantId === null) throw new AlimentoError({ geral: MSG_ALIMENTO.taco });
}

export async function editarAlimento(ctx: TenantContext, id: string, input: EntradaAlimento, deps: { db?: Db } = {}): Promise<void> {
  if (!idValido(id)) throw new AlimentoError({ geral: MSG_ALIMENTO.naoEncontrado });
  const v = validar(input);
  await withTenant(
    ctx,
    async (tx) => {
      await exigirProprio(tx, id);
      await tx.update(foods).set({ ...v, updatedAt: new Date() }).where(and(eq(foods.id, id), isNotNull(foods.tenantId)));
    },
    deps.db ?? getDb(),
  );
}

/** Review Focus 4: alimento usado em item de plano (FK RESTRICT de meal_items, Tarefa 6) não sai. */
export async function excluirAlimento(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<void> {
  if (!idValido(id)) throw new AlimentoError({ geral: MSG_ALIMENTO.naoEncontrado });
  try {
    await withTenant(
      ctx,
      async (tx) => {
        await exigirProprio(tx, id);
        await tx.delete(foods).where(and(eq(foods.id, id), isNotNull(foods.tenantId)));
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (fkViolation(e)) throw new AlimentoError({ geral: MSG_ALIMENTO.emUso });
    throw e;
  }
}

/** US-021 "Duplicar como meu alimento": copia nome, grupo, valores (sem valor → 0) e medidas do seed. */
export async function duplicarComoMeu(ctx: TenantContext, id: string, deps: { db?: Db } = {}): Promise<{ id: string; incompleto: boolean }> {
  if (!idValido(id)) throw new AlimentoError({ geral: MSG_ALIMENTO.naoEncontrado });
  return withTenant(
    ctx,
    async (tx) => {
      const [f] = await tx.select().from(foods).where(eq(foods.id, id));
      if (!f) throw new AlimentoError({ geral: MSG_ALIMENTO.naoEncontrado });
      const n = porCem(f);
      const [novo] = await tx
        .insert(foods)
        .values({
          tenantId: ctx.tenantId,
          nome: f.nome,
          grupo: f.grupo,
          kcal: n.kcal ?? 0,
          proteinaG: n.proteinaG ?? 0,
          carboidratoG: n.carboidratoG ?? 0,
          lipidioG: n.lipidioG ?? 0,
          fibraG: n.fibraG ?? 0,
          micros: f.micros,
          medidasCaseiras: f.medidasCaseiras,
          origemFoodId: f.id,
        })
        .returning({ id: foods.id });
      return { id: novo.id, incompleto: incompleto(n) };
    },
    deps.db ?? getDb(),
  );
}
