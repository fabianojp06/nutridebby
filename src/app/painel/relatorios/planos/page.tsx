import { requireNutri } from '@/lib/tenant-session';
import { telaDosRelatorios } from '../tela';

export const dynamic = 'force-dynamic';

/** Plano 26 (US-482): Relatórios › Planos alimentares. Só da nutricionista no PR 1 (RE-D51). */
export default async function RelatoriosPlanos({ searchParams }: PageProps<'/painel/relatorios/planos'>) {
  const sessao = await requireNutri('/painel/relatorios/planos');
  return telaDosRelatorios('planos', sessao, await searchParams);
}
