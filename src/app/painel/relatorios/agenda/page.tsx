import { requireNutri } from '@/lib/tenant-session';
import { telaDosRelatorios } from '../tela';

export const dynamic = 'force-dynamic';

/** Plano 26 (US-483): Relatórios › Agenda. Só da nutricionista no PR 1 (RE-D51). */
export default async function RelatoriosAgenda({ searchParams }: PageProps<'/painel/relatorios/agenda'>) {
  const sessao = await requireNutri('/painel/relatorios/agenda');
  return telaDosRelatorios('agenda', sessao, await searchParams);
}
