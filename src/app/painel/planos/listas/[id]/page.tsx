import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { idValido } from '@/modules/pacientes/base';
import { MSG_LISTAS } from '@/modules/plano-alimentar/biblioteca-constantes';
import { carregarLista } from '@/modules/plano-alimentar/listas';
import { excluirListaAction, salvarListaAction } from '../actions';
import { ExcluirLista, ListaForm } from '../lista-form';

export const dynamic = 'force-dynamic';

/**
 * US-238: `novo` abre o formulário vazio ("Nova lista"; salvar cria e vai para o id da lista); um id do consultório
 * abre a lista para alterar ou excluir. Outro texto, id de outro consultório (RLS) ou lista excluída → 404.
 */
export default async function ListaPage({ params }: PageProps<'/painel/planos/listas/[id]'>) {
  const { id } = await params;
  const { ctx } = await requireNutri(`/painel/planos/listas/${id}`);
  const nova = id === 'novo';
  if (!nova && !idValido(id)) notFound();
  const lista = nova ? null : await carregarLista(ctx, id);
  if (!nova && !lista) notFound();
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <Link href="/painel/planos/listas" className="text-sm underline">Voltar às listas</Link>
      <h1 className="font-titulo text-2xl font-semibold">{lista ? lista.nome : MSG_LISTAS.nova}</h1>
      <ListaForm acao={salvarListaAction.bind(null, lista ? lista.id : null)} lista={lista} rotuloBotao="Salvar lista" />
      {lista && <ExcluirLista acao={excluirListaAction.bind(null, lista.id)} />}
    </main>
  );
}
