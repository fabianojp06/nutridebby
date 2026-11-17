import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { bibliotecasParaExames } from '@/modules/exames/modelos-solicitacao';
import { salvarModeloSolicitacaoAction } from '../actions';
import { ExcluirModelo } from '../excluir-modelo';
import { ModeloForm } from '../modelo-form';
import { paraEscolher } from '../../valores';

export const dynamic = 'force-dynamic';

const ID_DO_TITULO = 'titulo-modelo-solicitacao';

/** Plano 22 (T3, US-376): o modelo de solicitação — h1 com o nome, o formulário e "Excluir". Catálogo e modelo numa transação. */
export default async function ModeloSolicitacaoPage({ params }: PageProps<'/painel/exames/modelos/[id]'>) {
  const { id } = await params;
  const { ctx } = await requireNutri(`/painel/exames/modelos/${id}`);
  const { catalogo, modelos } = await bibliotecasParaExames(ctx);
  const modelo = modelos.find((m) => m.id === id);
  if (!modelo) notFound();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={ID_DO_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">
          {modelo.nome}
        </h1>
        <ExcluirModelo id={modelo.id} nome={modelo.nome} idTitulo={ID_DO_TITULO} />
      </div>
      <ModeloForm acao={salvarModeloSolicitacaoAction.bind(null, modelo.id)} inicial={{ nome: modelo.nome, exames: modelo.exames, orientacoes: modelo.orientacoes }} catalogo={paraEscolher(catalogo)} />
    </>
  );
}
