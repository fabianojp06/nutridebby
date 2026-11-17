import { sql } from 'drizzle-orm';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import type { ItemDaSecao } from '../tipos';

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
