import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { idValido } from '@/modules/pacientes/base';
import { carregarMinhaRefeicao } from '@/modules/plano-alimentar/refeicoes-modelo';
import { alterarMinhaRefeicaoAction, excluirMinhaRefeicaoAction } from '../actions';
import { ExcluirRefeicao, RefeicaoForm } from '../refeicao-form';

export const dynamic = 'force-dynamic';

/**
 * US-237: a minha refeição do consultório para alterar ou excluir. Não há `novo` (nasce só pelo editor do plano); id
 * inválido, de outro consultório (RLS) ou refeição excluída → 404.
 */
export default async function MinhaRefeicaoPage({ params }: PageProps<'/painel/planos/refeicoes/[id]'>) {
  const { id } = await params;
  const { ctx } = await requireNutri(`/painel/planos/refeicoes/${id}`);
  if (!idValido(id)) notFound();
  const refeicao = await carregarMinhaRefeicao(ctx, id);
  if (!refeicao) notFound();
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <Link href="/painel/planos/refeicoes" className="text-sm underline">Voltar às minhas refeições</Link>
      <h1 className="font-titulo text-2xl font-semibold">{refeicao.nome}</h1>
      <RefeicaoForm acao={alterarMinhaRefeicaoAction.bind(null, refeicao.id)} refeicao={refeicao} />
      <ExcluirRefeicao acao={excluirMinhaRefeicaoAction.bind(null, refeicao.id)} />
    </main>
  );
}
