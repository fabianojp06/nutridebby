import { sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { foods } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { semInvalidosNoBanco } from '@/lib/texto-seguro';
import { medidasDeVarios, type MedidaDisponivel } from './medidas';

export type Nutrientes100 = { kcal: number | null; proteinaG: number | null; carboidratoG: number | null; lipidioG: number | null; fibraG: number | null };
export type AlimentoEncontrado = { id: string; nome: string; grupo: string; origem: 'TACO' | 'Meu alimento'; porCem: Nutrientes100; medidas: MedidaDisponivel[] };

export const BUSCA_LIMITE = 20;

/**
 * Palavras da busca: minúsculas, até 6 palavras e 60 caracteres (o resto não muda o resultado). Sem NUL nem surrogate
 * sem par (SUS-121, regra 3): o termo também vem do modelo, pela ferramenta `buscar_alimentos` da IA
 * (`src/modules/ia/ferramentas-alimentos.ts`), não só da rota; limpa de novo depois do corte, que pode partir um emoji.
 */
export function palavrasDaBusca(termo: unknown): string[] {
  if (typeof termo !== 'string') return [];
  return semInvalidosNoBanco(termo)
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((w) => semInvalidosNoBanco(w.trim().slice(0, 60)))
    .filter(Boolean)
    .slice(0, 6);
}

/** Curingas do LIKE viram texto literal ("%" não lista a tabela inteira). */
const literal = (w: string) => w.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * US-020 (D6): cada palavra precisa aparecer no nome (sem acento, sem maiúsculas — índice GIN de trigramas
 * em app_unaccent(lower(nome))). Ordem: começa com a 1ª palavra, mais parecido com o termo, nome mais curto.
 * TACO + alimentos do tenant (RLS: tenant_isolation + taco_leitura).
 */
export async function buscarAlimentos(ctx: TenantContext, termo: unknown, db: Db = getDb()): Promise<AlimentoEncontrado[]> {
  const palavras = palavrasDaBusca(termo);
  if (palavras.join('').replace(/[\\%_]/g, '').length < 2) return [];
  return withTenant(
    ctx,
    async (tx) => {
      const nome = sql`app_unaccent(lower(${foods.nome}))`;
      const filtros = palavras.map((w) => sql`${nome} like '%' || app_unaccent(${literal(w)}) || '%'`);
      const rows = await tx
        .select({
          id: foods.id,
          nome: foods.nome,
          grupo: foods.grupo,
          tenantId: foods.tenantId,
          kcal: foods.kcal,
          proteinaG: foods.proteinaG,
          carboidratoG: foods.carboidratoG,
          lipidioG: foods.lipidioG,
          fibraG: foods.fibraG,
        })
        .from(foods)
        .where(sql.join(filtros, sql` and `))
        .orderBy(
          sql`(${nome} like app_unaccent(${literal(palavras[0])}) || '%') desc`,
          sql`similarity(${nome}, app_unaccent(${palavras.join(' ')})) desc`,
          sql`char_length(${foods.nome})`,
          foods.nome,
        )
        .limit(BUSCA_LIMITE);
      const medidas = await medidasDeVarios(tx, rows.map((r) => r.id));
      return rows.map((r) => ({
        id: r.id,
        nome: r.nome,
        grupo: r.grupo,
        origem: r.tenantId === null ? ('TACO' as const) : ('Meu alimento' as const),
        porCem: { kcal: r.kcal, proteinaG: r.proteinaG, carboidratoG: r.carboidratoG, lipidioG: r.lipidioG, fibraG: r.fibraG },
        medidas: medidas.get(r.id) ?? [],
      }));
    },
    db,
  );
}
