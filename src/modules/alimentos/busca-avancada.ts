import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { foods } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { QUANTIDADE_MAX, QUANTIDADE_MIN } from '@/modules/plano-alimentar/constantes';
import { BUSCA_LIMITE, COLUNAS_DO_ALIMENTO, comoEncontrado, fontesPermitidas, type AlimentoEncontrado } from './busca';
import {
  criterioDoNutriente, criterioDosEquivalentes, ehMacroDoCriterio, MSG_BUSCA, TOLERANCIA_ENERGIA, valorPorCem, type ChaveDoCriterio, type Direcao, type MacroDoCriterio,
} from './busca-avancada-constantes';
import type { Fonte } from './fontes';
import { medidasDeVarios } from './medidas';
import { microsDoCatalogo } from './nutrientes';

/** O critério e o aviso escritos na tela: "Sugestão: confira antes de usar." com resultado; sem, "Nenhum alimento…". */
export type RespostaDaBusca<T> = { criterio: string; aviso: string; resultados: T[] };
export type PorNutriente = AlimentoEncontrado & { /** O valor em 100 g no critério. */ valor: number };
export type Equivalente = AlimentoEncontrado & { /** RN-242: gramas que dão o mesmo valor do critério, arredondados a 1 g. */ quantidadeG: number };
export type Equivalentes = RespostaDaBusca<Equivalente> & { referencia: { nome: string; grupo: string; quantidadeG: number; kcal: number | null } };

const COLUNA_MACRO: Record<MacroDoCriterio, SQL> = {
  kcal: sql`${foods.kcal}`,
  proteinaG: sql`${foods.proteinaG}`,
  carboidratoG: sql`${foods.carboidratoG}`,
  lipidioG: sql`${foods.lipidioG}`,
  fibraG: sql`${foods.fibraG}`,
};

/** Valor por 100 g no critério, em float8; nulo = sem valor na fonte (micro ausente, `null` ou não numérico). */
function valorSql(k: ChaveDoCriterio): SQL<number | null> {
  if (ehMacroDoCriterio(k)) return sql<number | null>`(${COLUNA_MACRO[k]})::float8`;
  return sql<number | null>`(case when jsonb_typeof(${foods.micros} -> ${k}::text) = 'number' then (${foods.micros} ->> ${k}::text)::float8 end)`;
}

const resposta = <T>(criterio: string, resultados: T[]): RespostaDaBusca<T> => ({ criterio, aviso: resultados.length ? MSG_BUSCA.sugestao : MSG_BUSCA.nenhum, resultados });

/**
 * RN-241 (US-234): alimentos ricos ou pobres num nutriente do catálogo ou num macro, pelo valor em 100 g. Só quem tem o
 * valor; até 20; desempate por nome. Tabelas públicas + alimentos do tenant (RLS); a TBCA só com autorização (RN-232).
 * A IA não usa esta busca.
 */
export async function buscarPorNutriente(
  ctx: TenantContext,
  o: { chave: ChaveDoCriterio; direcao: Direcao; grupo?: string; fontes?: readonly Fonte[] },
  db: Db = getDb(),
): Promise<RespostaDaBusca<PorNutriente>> {
  const criterio = criterioDoNutriente(o.chave, o.direcao);
  const fontes = fontesPermitidas(o.fontes);
  if (!fontes.length) return resposta(criterio, []);
  const resultados = await withTenant(
    ctx,
    async (tx) => {
      const v = valorSql(o.chave);
      const rows = await tx
        .select({ ...COLUNAS_DO_ALIMENTO, valor: v })
        .from(foods)
        .where(and(sql`${v} is not null`, inArray(foods.fonte, fontes), o.grupo === undefined ? undefined : eq(foods.grupo, o.grupo)))
        .orderBy(o.direcao === 'rico' ? sql`${v} desc` : sql`${v} asc`, foods.nome, foods.id)
        .limit(BUSCA_LIMITE);
      const medidas = await medidasDeVarios(tx, rows.map((r) => r.id));
      return rows.map((r) => ({ ...comoEncontrado(r, medidas), valor: Number(r.valor) }));
    },
    db,
  );
  return resposta(criterio, resultados);
}

/**
 * RN-242 (D14, US-234): equivalentes de um item (alimento e quantidade). Candidatos do mesmo grupo, outro alimento, com
 * o valor do critério > 0; quantidade sugerida = `quantidade_ref × valor_ref ÷ valor_cand`, arredondada a 1 g, só entre
 * 0,1 e 5000 g. Por energia: ordem pela soma das diferenças absolutas de proteína, carboidrato e lipídio na quantidade
 * sugerida (quem não tem um dos três vai para o fim). Por um nutriente: só quem fica com a energia a ±10% da referência,
 * ordem pela menor diferença de energia. Até 20; desempate por nome. `null`: o alimento de referência não existe ou o
 * tenant não o vê (RLS).
 */
export async function equivalentes(
  ctx: TenantContext,
  o: { foodId: string; quantidadeG: number; igualarPor: ChaveDoCriterio; fontes?: readonly Fonte[] },
  db: Db = getDb(),
): Promise<Equivalentes | null> {
  const fontes = fontesPermitidas(o.fontes);
  return withTenant(
    ctx,
    async (tx) => {
      const [ref] = await tx.select(COLUNAS_DO_ALIMENTO).from(foods).where(eq(foods.id, o.foodId)).limit(1);
      if (!ref) return null;
      const q = o.quantidadeG;
      const porCem = { kcal: ref.kcal, proteinaG: ref.proteinaG, carboidratoG: ref.carboidratoG, lipidioG: ref.lipidioG, fibraG: ref.fibraG };
      const energiaRef = ref.kcal === null ? null : (ref.kcal * q) / 100;
      const base = { criterio: criterioDosEquivalentes(ref.grupo, o.igualarPor), referencia: { nome: ref.nome, grupo: ref.grupo, quantidadeG: q, kcal: energiaRef } };
      const vRef = valorPorCem({ porCem, micros: microsDoCatalogo(ref.micros) }, o.igualarPor);
      const porEnergia = o.igualarPor === 'kcal';
      // sem o valor na referência (ou, por nutriente, sem a energia para o ±10%) não há o que igualar
      if (vRef === null || vRef <= 0 || energiaRef === null || !fontes.length) return { ...base, ...resposta(base.criterio, []) };

      const v = valorSql(o.igualarPor);
      const qtd = sql<number>`(round((${q * vRef}::float8 / nullif(${v}, 0))::numeric)::float8)`;
      const naQtd = (coluna: SQL) => sql`((${coluna})::float8 * ${qtd} / 100)`;
      const dif = (coluna: SQL, alvo: number | null) => (alvo === null ? sql`null` : sql`abs(${naQtd(coluna)} - ${alvo}::float8)`);
      const difEnergia = dif(COLUNA_MACRO.kcal, energiaRef);
      const doRef = (c: number | null) => (c === null ? null : (c * q) / 100);
      const rows = await tx
        .select({ ...COLUNAS_DO_ALIMENTO, quantidadeG: qtd })
        .from(foods)
        .where(
          and(
            eq(foods.grupo, ref.grupo),
            ne(foods.id, ref.id),
            inArray(foods.fonte, fontes),
            sql`${v} > 0`,
            sql`${qtd} between ${QUANTIDADE_MIN}::float8 and ${QUANTIDADE_MAX}::float8`,
            porEnergia ? undefined : sql`${difEnergia} <= ${TOLERANCIA_ENERGIA * energiaRef}::float8`,
          ),
        )
        .orderBy(
          porEnergia
            ? sql`(${dif(COLUNA_MACRO.proteinaG, doRef(ref.proteinaG))} + ${dif(COLUNA_MACRO.carboidratoG, doRef(ref.carboidratoG))} + ${dif(COLUNA_MACRO.lipidioG, doRef(ref.lipidioG))}) asc nulls last`
            : sql`${difEnergia} asc`,
          foods.nome,
          foods.id,
        )
        .limit(BUSCA_LIMITE);
      const medidas = await medidasDeVarios(tx, rows.map((r) => r.id));
      return { ...base, ...resposta(base.criterio, rows.map((r) => ({ ...comoEncontrado(r, medidas), quantidadeG: Number(r.quantidadeG) }))) };
    },
    db,
  );
}
