import { and, eq, isNotNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db, type Tx } from '@/db/client';
import { fkViolation } from '@/db/errors';
import { foods } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { decimalEntre, lerDecimal } from '@/lib/numero';
import { idValido } from '@/modules/pacientes/base';
import { normalizarTexto } from '@/lib/text';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { GRAMAS_MAX, KCAL_MAX, MSG_ALIMENTO } from './alimentos-constantes';
import type { Nutrientes100 } from './busca';
import { fontesVisiveis, seloDaFonte, type Fonte, type FontePublica, type SeloDaFonte } from './fontes';
import { ehGrupo } from './grupos';
import { medidasDeVarios, type MedidaDisponivel } from './medidas';
import { ehChaveNutriente, microsDoCatalogo, microsValidos, MSG_NUTRIENTES, type ChaveNutriente } from './nutrientes';

export type AlimentoDetalhe = {
  id: string;
  nome: string;
  /** RN-230: nome em inglês da USDA; nulo nas outras fontes. */
  nomeOriginal: string | null;
  grupo: string;
  /** RN-230: de `foods.fonte`, nunca de `tenant_id`. */
  fonte: Fonte;
  origem: SeloDaFonte;
  /** RN-233: tabela pública de onde o "Meu alimento" foi duplicado (`origem_food_id`); nulo se não veio de uma. */
  fonteOrigem: FontePublica | null;
  porCem: Nutrientes100;
  /** RN-235: micros com valor (as chaves sem valor ficam fora). */
  micros: Partial<Record<ChaveNutriente, number>>;
  medidas: MedidaDisponivel[];
  /** Algum dos 5 valores principais está sem número (TACO "NA"/"*", nulo na USDA). */
  incompleto: boolean;
};

export class AlimentoError extends Error {
  override name = 'AlimentoError';
  constructor(readonly erros: Record<string, string>) {
    super('Alimento inválido');
  }
}

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
/**
 * `micros` (US-231): chave do catálogo → texto digitado ("120", "2,5") ou número; vazio/nulo = sem valor. Ausente na
 * edição: os micros gravados ficam.
 */
type EntradaAlimento = Record<keyof z.input<typeof schema>, unknown> & { micros?: unknown };

/** US-231: cada valor de 0 a 100000 por 100 g (`microsValidos`), com o erro ao lado do campo (`micros.<chave>`). */
function validarMicros(m: unknown, erros: Record<string, string>): Partial<Record<ChaveNutriente, number>> {
  const valor: Partial<Record<ChaveNutriente, number>> = {};
  if (typeof m !== 'object' || m === null || Array.isArray(m)) {
    erros.geral ??= MSG_NUTRIENTES.desconhecido;
    return valor;
  }
  for (const [k, bruto] of Object.entries(m)) {
    if (!ehChaveNutriente(k)) {
      erros.geral ??= MSG_NUTRIENTES.desconhecido;
      continue;
    }
    const n = lerDecimal(bruto);
    if (n === null) continue; // vazio: sem valor
    const r = microsValidos({ [k]: n });
    if (r.ok && r.valor[k] !== undefined) valor[k] = r.valor[k];
    else erros[`micros.${k}`] = MSG_NUTRIENTES.faixa;
  }
  return valor;
}

function validar(input: EntradaAlimento) {
  const r = schema.safeParse(input);
  const erros = r.success ? {} : primeiroErroPorCampo(r.error);
  const micros = input.micros === undefined ? undefined : validarMicros(input.micros, erros);
  if (!r.success || Object.keys(erros).length) throw new AlimentoError(erros);
  return { ...r.data, grupo: r.data.grupo as string, ...(micros === undefined ? {} : { micros }) };
}

const porCem = (f: typeof foods.$inferSelect): Nutrientes100 => ({ kcal: f.kcal, proteinaG: f.proteinaG, carboidratoG: f.carboidratoG, lipidioG: f.lipidioG, fibraG: f.fibraG });
const incompleto = (n: Nutrientes100) => Object.values(n).some((v) => v === null);
const comValor = (m: Partial<Record<ChaveNutriente, number | null>>): Partial<Record<ChaveNutriente, number>> =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)) as Partial<Record<ChaveNutriente, number>>;

export async function carregarAlimento(ctx: TenantContext, id: string, db: Db = getDb()): Promise<AlimentoDetalhe | null> {
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [f] = await tx.select().from(foods).where(eq(foods.id, id));
      if (!f) return null;
      const n = porCem(f);
      const [o] = f.origemFoodId ? await tx.select({ fonte: foods.fonte }).from(foods).where(eq(foods.id, f.origemFoodId)) : [];
      return {
        id: f.id,
        nome: f.nome,
        nomeOriginal: f.nomeOriginal,
        grupo: f.grupo,
        fonte: f.fonte,
        origem: seloDaFonte(f.fonte),
        fonteOrigem: o && o.fonte !== 'propria' ? o.fonte : null,
        porCem: n,
        micros: comValor(microsDoCatalogo(f.micros)),
        medidas: (await medidasDeVarios(tx, [f.id])).get(f.id) ?? [],
        incompleto: incompleto(n),
      };
    },
    db,
  );
}

/** RN-233: as tabelas públicas com alimentos no banco, na ordem do catálogo (a tela "Alimentos" cita cada uma); sem a TBCA não autorizada. */
export async function fontesCarregadas(ctx: TenantContext, db: Db = getDb()): Promise<FontePublica[]> {
  const rows = await withTenant(ctx, (tx) => tx.selectDistinct({ fonte: foods.fonte }).from(foods).where(ne(foods.fonte, 'propria')), db);
  return fontesVisiveis(rows.map((r) => r.fonte)).filter((f): f is FontePublica => f !== 'propria');
}

export async function criarAlimento(ctx: TenantContext, input: EntradaAlimento, deps: { db?: Db } = {}): Promise<{ id: string }> {
  const v = validar(input);
  const [f] = await withTenant(ctx, (tx) => tx.insert(foods).values({ tenantId: ctx.tenantId, ...v }).returning({ id: foods.id }), deps.db ?? getDb());
  return f;
}

/** Só o próprio tenant altera (RLS); tabela pública (`tenant_id` nulo ⇔ `fonte <> 'propria'`, CHECK foods_origem_valida) dá "não pode ser alterada" (D1). */
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
    if (fkViolation(e) !== null) throw new AlimentoError({ geral: MSG_ALIMENTO.emUso }); // '' = FK sem nome de constraint: também é FK
    throw e;
  }
}

/** US-021/US-230 "Duplicar como meu alimento": copia nome, grupo, valores (sem valor → 0), micros e medidas do seed; guarda a origem. */
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
