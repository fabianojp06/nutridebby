import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { foodMeasures, foods, type MedidaCaseira } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { decimalEntre } from '@/lib/numero';
import { idValido } from '@/modules/pacientes/base';
import { normalizarTexto } from '@/lib/text';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { MSG_MEDIDA } from './medidas-constantes';

export type MedidaDisponivel = MedidaCaseira & { id: string | null; origem: 'IBGE' | 'Minha medida' };

export const MEDIDAS_FONTE = {
  zip: 'seeds/fontes/ibge-tabelamedidas_bd.zip',
  sha256: '3d0ff06acf0b55c22a621f57e6fb218d4505af204ed2be1571bfbe02fbab17c9',
  xls: 'tabelamedidas_bd.xls',
  aba: 'Tab_Medidas Caseiras',
  csv: 'seeds/medidas-ibge.csv',
  migration: 'drizzle/0042_seed_medidas_ibge.sql',
} as const;

export class MedidaError extends Error {
  override name = 'MedidaError';
  constructor(readonly erros: Record<string, string>) {
    super('Medida inválida');
  }
}

type LinhaMedida = { taco_id: string; nome: string; plural: string; gramas: string; referencia_ibge: string };

/**
 * Migration de dados (D3): substitui medidas_caseiras de cada alimento do CSV. Roda com a RLS de foods
 * desligada para o dono (com FORCE, tenant_id nulo não passa em app_current_tenant()); foods não é auditada.
 */
export function sqlSeedMedidas(linhas: LinhaMedida[]): string {
  const porAlimento = new Map<number, MedidaCaseira[]>();
  for (const l of linhas) {
    const id = Number(l.taco_id);
    if (!Number.isInteger(id) || id < 1 || id > 597) throw new Error(`taco_id inválido: ${l.taco_id}`);
    const gramas = Number(l.gramas);
    if (!(gramas > 0)) throw new Error(`gramas inválido: ${l.gramas}`);
    porAlimento.set(id, [...(porAlimento.get(id) ?? []), { nome: l.nome, plural: l.plural, gramas }]);
  }
  const updates = [...porAlimento].map(
    ([id, ms]) => `UPDATE "foods" SET "medidas_caseiras" = '${JSON.stringify(ms).replace(/'/g, "''")}'::jsonb WHERE "taco_id" = ${id};`,
  );
  return [
    '-- Gerado por `pnpm seed:medidas` a partir de seeds/medidas-ibge.csv (IBGE, POF 2008–2009). Não editar.',
    'ALTER TABLE "foods" NO FORCE ROW LEVEL SECURITY;',
    '--> statement-breakpoint',
    updates.join('\n'),
    '--> statement-breakpoint',
    'ALTER TABLE "foods" FORCE ROW LEVEL SECURITY;',
    '',
  ].join('\n');
}

const deTenant = (r: typeof foodMeasures.$inferSelect): MedidaDisponivel => ({ id: r.id, origem: 'Minha medida', nome: r.nome, plural: r.plural, gramas: r.gramas });

/** Medidas de vários alimentos de uma vez (editor e busca): seed do IBGE primeiro, depois as do tenant. */
export async function medidasDeVarios(tx: Tx, foodIds: string[]): Promise<Map<string, MedidaDisponivel[]>> {
  const ids = [...new Set(foodIds.filter(idValido))];
  const out = new Map<string, MedidaDisponivel[]>();
  if (!ids.length) return out;
  const fs = await tx.select({ id: foods.id, medidas: foods.medidasCaseiras }).from(foods).where(inArray(foods.id, ids));
  for (const f of fs) out.set(f.id, f.medidas.map((m) => ({ ...m, id: null, origem: 'IBGE' as const })));
  const proprias = await tx.select().from(foodMeasures).where(inArray(foodMeasures.foodId, ids)).orderBy(foodMeasures.createdAt);
  for (const m of proprias) out.set(m.foodId, [...(out.get(m.foodId) ?? []), deTenant(m)]);
  return out;
}

export async function medidasDoAlimento(ctx: TenantContext, foodId: string, db: Db = getDb()): Promise<MedidaDisponivel[]> {
  if (!idValido(foodId)) return [];
  return withTenant(ctx, async (tx) => (await medidasDeVarios(tx, [foodId])).get(foodId) ?? [], db);
}

const schemaMedida = z.object({
  nome: z.unknown().transform(normalizarTexto).pipe(z.string().min(2, MSG_MEDIDA.nome).max(60, MSG_MEDIDA.nome)),
  plural: z.unknown().transform(normalizarTexto).pipe(z.string().min(2, MSG_MEDIDA.nome).max(60, MSG_MEDIDA.nome)),
  gramas: decimalEntre(MSG_MEDIDA.gramas, 0.1, 5000),
});

export async function cadastrarMedida(
  ctx: TenantContext,
  foodId: string,
  input: { nome: unknown; plural: unknown; gramas: unknown },
  deps: { db?: Db } = {},
): Promise<MedidaDisponivel> {
  const r = schemaMedida.safeParse(input);
  if (!r.success) {
    const e = primeiroErroPorCampo(r.error);
    if (e.plural && !e.nome) e.nome = e.plural; // uma mensagem só para nome e plural
    delete e.plural;
    throw new MedidaError(e);
  }
  if (!idValido(foodId)) throw new MedidaError({ geral: MSG_MEDIDA.alimento });
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const [f] = await tx.select({ id: foods.id, medidas: foods.medidasCaseiras }).from(foods).where(eq(foods.id, foodId)); // RLS: TACO ou do próprio tenant
        if (!f) throw new MedidaError({ geral: MSG_MEDIDA.alimento });
        // homônima de uma do IBGE do mesmo alimento: no editor as duas teriam o mesmo nome
        if (f.medidas.some((m) => normalizarTexto(m.nome) === r.data.nome)) throw new MedidaError({ nome: MSG_MEDIDA.duplicada });
        const [m] = await tx
          .insert(foodMeasures)
          .values({ tenantId: ctx.tenantId, foodId, nome: r.data.nome, plural: r.data.plural, gramas: r.data.gramas })
          .returning();
        return deTenant(m);
      },
      deps.db ?? getDb(),
    );
  } catch (e) {
    if (uniqueViolation(e) === 'food_measures_nome_unique') throw new MedidaError({ nome: MSG_MEDIDA.duplicada });
    throw e;
  }
}

export async function excluirMedida(ctx: TenantContext, id: string, db: Db = getDb()): Promise<boolean> {
  if (!idValido(id)) return false;
  const r = await withTenant(ctx, (tx) => tx.delete(foodMeasures).where(eq(foodMeasures.id, id)).returning({ id: foodMeasures.id }), db);
  return r.length > 0;
}
