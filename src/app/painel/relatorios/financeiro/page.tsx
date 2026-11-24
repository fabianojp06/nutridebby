import { requireNutri } from '@/lib/tenant-session';
import { telaDosRelatorios } from '../tela';

export const dynamic = 'force-dynamic';

/** Plano 26 (US-484): Relatórios › Financeiro. Só da nutricionista no PR 1 (RE-D51). */
export default async function RelatoriosFinanceiro({ searchParams }: PageProps<'/painel/relatorios/financeiro'>) {
  const sessao = await requireNutri('/painel/relatorios/financeiro');
  return telaDosRelatorios('financeiro', sessao, await searchParams);
}
