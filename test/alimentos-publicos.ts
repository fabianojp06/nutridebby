import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/**
 * Plano 19 (Tarefa 3): linhas de tabela pública (USDA, TBCA) só para os testes, no banco do Testcontainers. `foods` tem
 * FORCE RLS e nenhuma política de escrita em `tenant_id` nulo: a escrita segue o molde da `drizzle/0042_seed_medidas_ibge.sql`
 * (NO FORCE … FORCE na mesma transação). O banco do Vitest é um só para todos os arquivos: quem insere apaga no `afterAll`
 * (`apagarPublicos`), e os testes que contam a tabela pública excluem as linhas com `fonte_ref` começando por `REF_DE_TESTE`.
 * Nunca usar fora dos testes (não há linha da USDA no PR do código, D29; nem TBCA sem autorização, RN-232).
 */
export const REF_DE_TESTE = 'teste-';

export type AlimentoPublicoDeTeste = {
  fonte?: 'usda' | 'tbca';
  nome: string;
  /** Só na USDA (CHECK `foods_nome_original_valido`). */
  nomeOriginal?: string | null;
  grupo?: string;
  kcal?: number | null;
  proteinaG?: number | null;
  carboidratoG?: number | null;
  lipidioG?: number | null;
  fibraG?: number | null;
  micros?: Record<string, number | null>;
};

async function semForcarRls<T>(owner: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await owner.connect();
  try {
    await c.query('begin');
    await c.query('ALTER TABLE "foods" NO FORCE ROW LEVEL SECURITY');
    const r = await fn(c);
    await c.query('ALTER TABLE "foods" FORCE ROW LEVEL SECURITY');
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

/** Insere as linhas públicas e devolve os ids, na ordem. Valores ausentes = sem valor na fonte (nulo). */
export function inserirPublicos(owner: Pool, linhas: AlimentoPublicoDeTeste[]): Promise<string[]> {
  return semForcarRls(owner, async (c) => {
    const ids: string[] = [];
    for (const l of linhas) {
      const fonte = l.fonte ?? 'usda';
      const r = await c.query<{ id: string }>(
        `insert into foods (tenant_id, fonte, fonte_ref, nome, nome_original, grupo, kcal, proteina_g, carboidrato_g, lipidio_g, fibra_g, micros)
         values (null, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [
          fonte,
          `${REF_DE_TESTE}${randomUUID().slice(0, 13)}`,
          l.nome,
          fonte === 'usda' ? (l.nomeOriginal ?? null) : null,
          l.grupo ?? 'Cereais e derivados',
          l.kcal ?? null,
          l.proteinaG ?? null,
          l.carboidratoG ?? null,
          l.lipidioG ?? null,
          l.fibraG ?? null,
          JSON.stringify(l.micros ?? {}),
        ],
      );
      ids.push(r.rows[0].id);
    }
    return ids;
  });
}

/**
 * Apaga as linhas públicas de teste (só as com `fonte_ref` de teste). Quem as usou em plano, receita ou outra tabela com
 * FK RESTRICT para `foods` apaga essas linhas antes, pela sessão do próprio tenant.
 */
export async function apagarPublicos(owner: Pool, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await semForcarRls(owner, (c) => c.query(`delete from foods where id = any($1::uuid[]) and tenant_id is null and fonte_ref like $2`, [ids, `${REF_DE_TESTE}%`]));
}
