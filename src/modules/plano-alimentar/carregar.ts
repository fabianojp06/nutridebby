import { and, asc, eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { foods, mealItems, mealPlans, meals } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { medidasDeVarios } from '@/modules/alimentos/medidas';
import { idValido } from '@/modules/pacientes/base';
import { auditRead } from '@/modules/plataforma/audit';
import type { PlanoCompleto, StatusPlano } from './tipos';

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

/**
 * Plano inteiro na transação. Rascunho/modelo: valores atuais dos alimentos + medidas para trocar.
 * Publicado/arquivado: a cópia congelada na publicação (D10), sem medidas para trocar.
 */
export async function lerPlanoNaTransacao(tx: Tx, planId: string, opts: { auditar?: boolean } = {}): Promise<PlanoCompleto | null> {
  if (!idValido(planId)) return null;
  const [p] = await tx.select().from(mealPlans).where(eq(mealPlans.id, planId));
  if (!p) return null;
  const rs = await tx.select().from(meals).where(eq(meals.planId, p.id)).orderBy(asc(meals.ordem));
  const its = await tx
    .select({ i: mealItems, f: { nome: foods.nome, tenantId: foods.tenantId, kcal: foods.kcal, proteinaG: foods.proteinaG, carboidratoG: foods.carboidratoG, lipidioG: foods.lipidioG, fibraG: foods.fibraG } })
    .from(mealItems)
    .innerJoin(foods, eq(foods.id, mealItems.foodId))
    .where(and(eq(mealItems.planId, p.id)))
    .orderBy(asc(mealItems.ordem));
  const editavel = p.status === 'rascunho';
  const medidas = editavel ? await medidasDeVarios(tx, its.map((x) => x.i.foodId)) : new Map();
  if (opts.auditar !== false && p.patientId) await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: p.id, patientId: p.patientId });
  return {
    id: p.id,
    patientId: p.patientId,
    isTemplate: p.isTemplate,
    titulo: p.titulo,
    metaKcal: p.metaKcal,
    energyCalcId: p.energyCalcId,
    status: p.status as StatusPlano,
    versao: p.versao,
    revisao: p.revisao,
    publicadoEm: p.publicadoEm?.toISOString() ?? null,
    mostrarCalorias: p.mostrarCalorias,
    orientacoes: p.orientacoes,
    pdfStatus: p.pdfStatus as PlanoCompleto['pdfStatus'],
    pdfPath: p.pdfPath,
    refeicoes: rs.map((r) => ({
      id: r.id,
      nome: r.nome,
      horario: hhmm(r.horario),
      observacao: r.observacao,
      itens: its
        .filter((x) => x.i.mealId === r.id)
        .map(({ i, f }) => {
          const congelado = !editavel && i.nutrientes;
          const v = congelado ? i.nutrientes! : { ...f, origem: f.tenantId === null ? ('TACO' as const) : ('Meu alimento' as const) };
          return {
            id: i.id,
            foodId: i.foodId,
            nome: v.nome,
            origem: v.origem,
            porCem: { kcal: v.kcal, proteinaG: v.proteinaG, carboidratoG: v.carboidratoG, lipidioG: v.lipidioG, fibraG: v.fibraG },
            medidas: medidas.get(i.foodId) ?? [],
            quantidadeG: i.quantidadeG,
            medida: i.medida ?? null,
            medidaCaseiraTxt: i.medidaCaseiraTxt,
            substituiItemId: i.substituiItemId,
          };
        }),
    })),
  };
}

/** Leitura auditada (RNF-08) de um plano do tenant; modelo não tem paciente e não gera leitura auditada. */
export async function carregarPlano(ctx: TenantContext, planId: string, db: Db = getDb()): Promise<PlanoCompleto | null> {
  if (!idValido(planId)) return null;
  return withTenant(ctx, (tx) => lerPlanoNaTransacao(tx, planId), db);
}
