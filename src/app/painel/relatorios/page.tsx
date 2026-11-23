import { requireNutri } from '@/lib/tenant-session';
import { telaDosRelatorios } from './tela';

export const dynamic = 'force-dynamic';

/** Plano 26 (US-480): Relatórios › Pacientes. Só da nutricionista no PR 1 (RE-D51). */
export default async function RelatoriosPacientes({ searchParams }: PageProps<'/painel/relatorios'>) {
  const sessao = await requireNutri('/painel/relatorios');
  return telaDosRelatorios('pacientes', sessao, await searchParams);
}
