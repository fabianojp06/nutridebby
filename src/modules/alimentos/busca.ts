import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { foods } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { FONTES_DE_ALIMENTO, seloDaFonte, TBCA_AUTORIZADA, type Fonte, type SeloDaFonte } from './fontes';
import { medidasDeVarios, type MedidaDisponivel } from './medidas';
import { microsDoCatalogo, type ChaveNutriente } from './nutrientes';

export type Nutrientes100 = { kcal: number | null; proteinaG: number | null; carboidratoG: number | null; lipidioG: number | null; fibraG: number | null };
export type AlimentoEncontrado = {
  id: string;
  nome: string;
  /** RN-230: o nome em inglês da USDA (nulo nas outras fontes). */
  nomeOriginal: string | null;
  grupo: string;
  /** RN-230: de `foods.fonte`, nunca de `tenant_id`. */
  fonte: Fonte;
  /** O selo da fonte (`seloDaFonte`). */
  origem: SeloDaFonte;
  porCem: Nutrientes100;
  /** RN-235: micros por 100 g (só chaves do catálogo; ausente ou nulo = sem valor na fonte). Só no painel, nunca no portal. */
  micros: Partial<Record<ChaveNutriente, number | null>>;
  medidas: MedidaDisponivel[];
};

export type OpcoesDaBusca = {
  /** Fontes aceitas (padrão: todas). A TBCA só entra com `TBCA_AUTORIZADA` (RN-232). */
  fontes?: readonly Fonte[];
  /** Um dos 15 grupos da TACO (filtro do diálogo de busca). */
  grupo?: string;
};

export const BUSCA_LIMITE = 20;

/** Palavras da busca: minúsculas, até 6 palavras e 60 caracteres (o resto não muda o resultado). */
export function palavrasDaBusca(termo: unknown): string[] {
  if (typeof termo !== 'string') return [];
  return termo
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((w) => w.trim().slice(0, 60))
    .filter(Boolean)
    .slice(0, 6);
}

/** Curingas do LIKE viram texto literal ("%" não lista a tabela inteira). */
const literal = (w: string) => w.replace(/[\\%_]/g, (c) => `\\${c}`);

/** RN-232: a TBCA fica fora de toda busca enquanto a carga não for autorizada (mesmo pedida no filtro). */
const fontesPermitidas = (pedidas: readonly Fonte[] = FONTES_DE_ALIMENTO): Fonte[] => FONTES_DE_ALIMENTO.filter((f) => pedidas.includes(f) && (f !== 'tbca' || TBCA_AUTORIZADA));

/**
 * US-020 (D6), RN-230: cada palavra precisa aparecer no nome — ou, na USDA, cada uma no nome original em inglês (sem
 * acento, sem maiúsculas; índices GIN de trigramas em app_unaccent(lower(…))). Ordem: começa com a 1ª palavra → fonte
 * brasileira ou própria antes da USDA → mais parecido com o termo → nome mais curto. Tabelas públicas + alimentos do
 * tenant (RLS: tenant_isolation + taco_leitura).
 */
export async function buscarAlimentos(ctx: TenantContext, termo: unknown, db: Db = getDb(), o: OpcoesDaBusca = {}): Promise<AlimentoEncontrado[]> {
  const palavras = palavrasDaBusca(termo);
  if (palavras.join('').replace(/[\\%_]/g, '').length < 2) return [];
  const fontes = fontesPermitidas(o.fontes);
  if (!fontes.length) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const nome = sql`app_unaccent(lower(${foods.nome}))`;
      const original = sql`app_unaccent(lower(${foods.nomeOriginal}))`;
      const todas = (coluna: SQL) => sql`(${sql.join(palavras.map((w) => sql`${coluna} like '%' || app_unaccent(${literal(w)}) || '%'`), sql` and `)})`;
      const comeca = (coluna: SQL) => sql`${coluna} like app_unaccent(${literal(palavras[0])}) || '%'`;
      const termoTodo = sql`app_unaccent(${palavras.join(' ')})`;
      const rows = await tx
        .select({
          id: foods.id,
          nome: foods.nome,
          nomeOriginal: foods.nomeOriginal,
          grupo: foods.grupo,
          fonte: foods.fonte,
          kcal: foods.kcal,
          proteinaG: foods.proteinaG,
          carboidratoG: foods.carboidratoG,
          lipidioG: foods.lipidioG,
          fibraG: foods.fibraG,
          micros: foods.micros,
        })
        .from(foods)
        // nome_original nulo (fora da USDA): o `like` dá nulo e o `or` fica só com o nome
        .where(and(sql`(${todas(nome)} or ${todas(original)})`, inArray(foods.fonte, fontes), o.grupo === undefined ? undefined : eq(foods.grupo, o.grupo)))
        .orderBy(
          sql`(${comeca(nome)} or coalesce(${comeca(original)}, false)) desc`,
          sql`(${foods.fonte} = 'usda')`,
          sql`greatest(similarity(${nome}, ${termoTodo}), coalesce(similarity(${original}, ${termoTodo}), 0)) desc`,
          sql`char_length(${foods.nome})`,
          foods.nome,
        )
        .limit(BUSCA_LIMITE);
      const medidas = await medidasDeVarios(tx, rows.map((r) => r.id));
      return rows.map((r) => ({
        id: r.id,
        nome: r.nome,
        nomeOriginal: r.nomeOriginal,
        grupo: r.grupo,
        fonte: r.fonte,
        origem: seloDaFonte(r.fonte),
        porCem: { kcal: r.kcal, proteinaG: r.proteinaG, carboidratoG: r.carboidratoG, lipidioG: r.lipidioG, fibraG: r.fibraG },
        micros: microsDoCatalogo(r.micros),
        medidas: medidas.get(r.id) ?? [],
      }));
    },
    db,
  );
}
