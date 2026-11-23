import { notFound } from 'next/navigation';
import { acessoComDocumentos } from '@/app/painel/documentos-liberados';
import { abrirModeloPrescricao } from '@/modules/documentos/modelos';
import { ExcluirDaBiblioteca } from '../../excluir';
import { SecoesDePrescricao } from '../../secoes';
import { LISTA_DE_MODELOS } from '../../valores';
import { excluirModeloPrescricaoAction, salvarModeloPrescricaoAction } from '../actions';
import { ModeloPrescricaoForm } from '../modelo-prescricao-form';

export const dynamic = 'force-dynamic';

const ID_DO_TITULO = 'titulo-modelo-prescricao';

/**
 * Plano 22 (T10b, US-379, RN-394): o modelo de prescrição — h1 com o nome, o formulário (nome, itens e orientações, sem
 * justificativa de uso) e "Excluir". Mudar o modelo não muda nenhuma receita (cópia). Inexistente ou de outro consultório → 404.
 */
export default async function ModeloPrescricaoPage({ params }: PageProps<'/painel/prescricao/modelos/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await acessoComDocumentos(`${LISTA_DE_MODELOS}/${id}`);
  const modelo = await abrirModeloPrescricao(ctx, id);
  if (!modelo) notFound();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={ID_DO_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">
          {modelo.nome}
        </h1>
        <ExcluirDaBiblioteca nome={modelo.nome} excluir={excluirModeloPrescricaoAction.bind(null, modelo.id)} idTitulo={ID_DO_TITULO} />
      </div>
      <SecoesDePrescricao atual="modelos" />
      <ModeloPrescricaoForm acao={salvarModeloPrescricaoAction.bind(null, modelo.id)} nome={modelo.nome} itens={modelo.itens} orientacoes={modelo.orientacoes} habilitada={!!tenant.fitoterapiaRegistro} />
    </>
  );
}
