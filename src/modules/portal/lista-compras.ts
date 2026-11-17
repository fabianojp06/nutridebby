import { and, asc, eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { foods, mealItems, mealPlans, meals } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { GRUPOS_TACO } from '@/modules/alimentos/grupos';
import { lerCongelados } from '@/modules/plano-alimentar/congelados';
import { diaDaSemanaNoFuso, type DiaDaSemana } from '@/modules/plano-alimentar/dias';
import { auditRead } from '@/modules/plataforma/audit';
import { pacienteDaSessao } from './sessao';

export const DIAS_PADRAO = 7;
export const MSG_COMPRAS = {
  dias: 'Escolha de 1 a 14 dias.',
  semPlano: 'Sem plano publicado, não há lista de compras.',
  /** Plano 19 (RN-248): nenhuma refeição com alimento (o plano em texto livre). */
  semAlimentos: 'Este plano não tem alimentos com quantidade, então não há lista de compras.',
  /** RN-248: a janela pedida não pega nenhuma refeição com alimento (ex.: 1 dia num domingo, plano só de seg a sex). Texto fora da spec, para aprovação. */
  semRefeicaoNosDias: 'Nenhuma refeição com alimentos do seu plano cai nesses dias. Aumente o número de dias.',
} as const;

export type ItemCompra = { nome: string; gramas: number; texto: string };
export type GrupoCompra = { grupo: string; itens: ItemCompra[] };
/** RN-240: a projeção fechada da lista de compras. */
export type ListaDoPlano = { planoId: string; grupos: GrupoCompra[]; semAlimentos: boolean };

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
  const g = Math.round(gramas * 10) / 10; // arredonda antes de comparar: 999,99 g é "1,0 kg", não "1000,0 g"
  if (g >= 1000) return `${formatarDecimal(g / 1000, 1)} kg`;
  return `${formatarDecimal(g, Math.min(1, casasDecimais(g)))} g`;
}

const ordemDoGrupo = (g: string) => {
  const i = (GRUPOS_TACO as readonly string[]).indexOf(g);
  return i === -1 ? GRUPOS_TACO.length : i;
};

/** RN-248: quantos dos `dias` dias a partir de `hoje` (inclusive) caem nos dias da refeição. */
export function vezesNaJanela(diasSemana: readonly number[], hoje: DiaDaSemana, dias: number): number {
  let n = 0;
  for (let k = 0; k < dias; k++) if (diasSemana.includes((hoje + k) % 7)) n++;
  return n;
}

/**
 * RN-13 / RN-248 (Plano 19): cada item principal soma uma vez por dia da janela em que a refeição vale (`quantidade ×
 * número de dias da janela que estão em dias_semana`), agrupado pelo grupo do alimento.
 */
export function listaDeCompras(itens: { nome: string; grupo: string; quantidadeG: number; diasSemana: readonly number[] }[], dias: number, hoje: DiaDaSemana): GrupoCompra[] {
  const porGrupo = new Map<string, Map<string, number>>();
  for (const i of itens) {
    const vezes = vezesNaJanela(i.diasSemana, hoje, dias);
    if (!vezes) continue;
    const g = porGrupo.get(i.grupo) ?? new Map<string, number>();
    g.set(i.nome, (g.get(i.nome) ?? 0) + i.quantidadeG * vezes);
    porGrupo.set(i.grupo, g);
  }
  return [...porGrupo.entries()]
    .sort(([a], [b]) => ordemDoGrupo(a) - ordemDoGrupo(b) || a.localeCompare(b, 'pt-BR'))
    .map(([grupo, m]) => ({
      grupo,
      itens: [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')).map(([nome, gramas]) => ({ nome, gramas, texto: quantidadeTexto(gramas) })),
    }));
}

/** RN-237: o nome congelado na publicação (só por `lerCongelados`); congelado fora do formato → o nome atual do alimento. */
function nomeCongelado(nutrientes: unknown, nomeAtual: string): string {
  try {
    return lerCongelados(nutrientes).nome || nomeAtual;
  } catch {
    return nomeAtual;
  }
}

/**
 * US-045: a lista do plano publicado do paciente da sessão (nunca do rascunho — RLS), para `dias` dias a partir de hoje no
 * fuso do consultório (RN-248). Refeição em texto livre não entra: sem nenhuma refeição com alimento, `semAlimentos`. O
 * modo é do plano inteiro (RN-243: no calculado, `descricao_livre` é nulo), então o caso "só algumas em texto livre" da
 * RN-248 não acontece e não há aviso para ele (code review do PR #57). Leitura auditada (D22).
 */
export async function listaDoPlano(ctx: TenantContext, fuso: string, dias: number, o: { db?: Db; agora?: Date } = {}): Promise<ListaDoPlano | null> {
  const patientId = pacienteDaSessao(ctx, 'listaDoPlano');
  const hoje = diaDaSemanaNoFuso(o.agora ?? new Date(), fuso);
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: mealPlans.id }).from(mealPlans).where(and(eq(mealPlans.patientId, patientId), eq(mealPlans.status, 'publicado')));
      if (!p) return null;
      const refeicoes = await tx.select({ id: meals.id, diasSemana: meals.diasSemana }).from(meals).where(eq(meals.planId, p.id)).orderBy(asc(meals.ordem));
      const linhas = await tx
        .select({ mealId: mealItems.mealId, nutrientes: mealItems.nutrientes, nomeAtual: foods.nome, grupo: foods.grupo, quantidadeG: mealItems.quantidadeG, substituiItemId: mealItems.substituiItemId })
        .from(mealItems)
        .innerJoin(foods, eq(foods.id, mealItems.foodId))
        .where(eq(mealItems.planId, p.id));
      await auditRead(tx, { entidade: 'plano_alimentar', entidadeId: p.id, patientId: patientId });
      const principais = linhas.filter((l) => l.substituiItemId === null);
      const diasDe = new Map(refeicoes.map((r) => [r.id, r.diasSemana]));
      const comAlimento = new Set(principais.map((l) => l.mealId));
      const itens = principais.map((l) => ({ nome: nomeCongelado(l.nutrientes, l.nomeAtual), grupo: l.grupo, quantidadeG: Number(l.quantidadeG), diasSemana: diasDe.get(l.mealId) ?? [] }));
      return {
        planoId: p.id,
        grupos: listaDeCompras(itens, dias, hoje),
        semAlimentos: comAlimento.size === 0,
      };
    },
    o.db ?? getDb(),
  );
}
