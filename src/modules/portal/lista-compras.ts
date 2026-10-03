import { and, eq, isNull } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { foods, mealItems, mealPlans } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { GRUPOS_TACO } from '@/modules/alimentos/grupos';
import { auditRead } from '@/modules/plataforma/audit';
import { pacienteDaSessao } from './sessao';

export const DIAS_PADRAO = 7;
export const MSG_COMPRAS = { dias: 'Escolha de 1 a 14 dias.', semPlano: 'Sem plano publicado, não há lista de compras.' } as const;

export type ItemCompra = { nome: string; gramas: number; texto: string };
export type GrupoCompra = { grupo: string; itens: ItemCompra[] };

export function lerDias(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return DIAS_PADRAO;
  if (typeof v !== 'string' || !/^\d{1,2}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 14 ? n : null;
}

/**
 * RN-13: g abaixo de 1 kg; a partir de 1000 g, kg com 1 casa. Não reaproveita `gramasDaMedidaTexto` (R14a): a lista usa
 * no máximo 1 casa, e aquele helper mostra até 2 (as casas da medida caseira).
 */
export function quantidadeTexto(gramas: number): string {
  if (gramas >= 1000) return `${formatarDecimal(gramas / 1000, 1)} kg`;
  return `${formatarDecimal(gramas, Math.min(1, casasDecimais(gramas)))} g`;
}

const ordemDoGrupo = (g: string) => {
  const i = (GRUPOS_TACO as readonly string[]).indexOf(g);
  return i === -1 ? GRUPOS_TACO.length : i;
};

/** RN-13: soma dos itens principais × dias, agrupada pelo grupo do alimento. */
export function listaDeCompras(itens: { nome: string; grupo: string; quantidadeG: number }[], dias: number): GrupoCompra[] {
  const porGrupo = new Map<string, Map<string, number>>();
  for (const i of itens) {
    const g = porGrupo.get(i.grupo) ?? new Map<string, number>();
    g.set(i.nome, (g.get(i.nome) ?? 0) + i.quantidadeG * dias);
    porGrupo.set(i.grupo, g);
  }
  return [...porGrupo.entries()]
    .sort(([a], [b]) => ordemDoGrupo(a) - ordemDoGrupo(b) || a.localeCompare(b, 'pt-BR'))
    .map(([grupo, m]) => ({
      grupo,
      itens: [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([nome, gramas]) => ({ nome, gramas, texto: quantidadeTexto(gramas) })),
    }));
}

/** US-045: a lista do plano publicado do paciente da sessão (nunca do rascunho — RLS). Leitura auditada (D22). */
export async function listaDoPlano(ctx: TenantContext, dias: number, db: Db = getDb()): Promise<{ planoId: string; grupos: GrupoCompra[] } | null> {
  const patientId = pacienteDaSessao(ctx, 'listaDoPlano');
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
      if (!p) return null;
      const linhas = await tx
        .select({ nomeCongelado: mealItems.nutrientes, nomeAtual: foods.nome, grupo: foods.grupo, quantidadeG: mealItems.quantidadeG })
        .from(mealItems)
        .innerJoin(foods, eq(foods.id, mealItems.foodId))
        .where(and(eq(mealItems.planId, p.id), isNull(mealItems.substituiItemId)));
      await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: p.id, patientId: patientId });
      const itens = linhas.map((l) => ({ nome: l.nomeCongelado?.nome ?? l.nomeAtual, grupo: l.grupo, quantidadeG: Number(l.quantidadeG) }));
      return { planoId: p.id, grupos: listaDeCompras(itens, dias) };
    },
    db,
  );
}
