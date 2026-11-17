import { and, count, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { idValido } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import type { ItemDaSecao, SecaoDaFicha } from '../tipos';

/** RN-277: no máximo 3 itens por seção. */
export const LIMITE_DA_SECAO = 3;

/** O total junto com os 3 últimos, numa consulta só (a janela é calculada antes do LIMIT). */
export const totalJunto = () => sql<number>`count(*) over ()`.mapWith(Number);

/** Instante como 'AAAA-MM-DD' do dia no fuso do tenant (RN-06), nunca o dia UTC. */
export const diaNoFuso = (instante: Date, fuso: string): string => hojeNoFuso(fuso, instante);

/** Resumo a partir das linhas com `total` (0 sem linhas). */
export function resumoDasLinhas<L extends { total: number }>(linhas: L[], item: (l: L) => Omit<ItemDaSecao, 'noApp'>) {
  return { total: linhas[0]?.total ?? 0, ultimos: linhas.map(item) };
}

/**
 * Plano 18 (RN-279, RN-281): o `noApp` de uma seção — a contagem e os ids visíveis, com a MESMA condição, na transação do
 * contexto de paciente que `no-app.ts` abre (a RLS do paciente aplica as políticas; `onde` repete só o filtro em TypeScript
 * da função do portal). Só `count(*)` e o id: nenhuma coluna de conteúdo, sem limite de lista (a página diz o total).
 */
export function noAppPor(tabela: PgTable, id: PgColumn, onde: (patientId: string) => SQL | undefined): NonNullable<SecaoDaFicha['noApp']> {
  return {
    async contar(tx, patientId) {
      const [r] = await tx.select({ n: count() }).from(tabela).where(onde(patientId));
      return r?.n ?? 0;
    },
    async visiveis(tx, patientId, ids) {
      const pedidos = [...new Set(ids.filter(idValido))];
      if (!pedidos.length) return [];
      const achados = await tx.select({ id }).from(tabela).where(and(onde(patientId), inArray(id, pedidos)));
      const vistos = new Set(achados.map((a) => String(a.id)));
      return pedidos.filter((i) => vistos.has(i));
    },
  };
}
