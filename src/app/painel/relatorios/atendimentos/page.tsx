import { requireNutri } from '@/lib/tenant-session';
import { telaDosRelatorios } from '../tela';

export const dynamic = 'force-dynamic';

/** Plano 26 (US-481): Relatórios › Atendimentos. Só da nutricionista no PR 1 (RE-D51). */
export default async function RelatoriosAtendimentos({ searchParams }: PageProps<'/painel/relatorios/atendimentos'>) {
  const sessao = await requireNutri('/painel/relatorios/atendimentos');
  return telaDosRelatorios('atendimentos', sessao, await searchParams);
}
