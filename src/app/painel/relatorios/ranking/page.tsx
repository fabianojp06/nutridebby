import { requireNutri } from '@/lib/tenant-session';
import { telaDosRelatorios } from '../tela';

export const dynamic = 'force-dynamic';

/** Plano 26 (US-485): Relatórios › Ranking. Só da nutricionista no PR 1 (RE-D51). */
export default async function RelatoriosRanking({ searchParams }: PageProps<'/painel/relatorios/ranking'>) {
  const sessao = await requireNutri('/painel/relatorios/ranking');
  return telaDosRelatorios('ranking', sessao, await searchParams);
}
