import { notFound } from 'next/navigation';
import { acessoComDocumentos } from '@/app/painel/documentos-liberados';
import { abrirItemSalvo } from '@/modules/documentos/modelos';
import { ExcluirDaBiblioteca } from '../../excluir';
import { SecoesDePrescricao } from '../../secoes';
import { grupoDoTipo, LISTA_DE_ITENS } from '../../valores';
import { excluirItemSalvoAction, salvarItemSalvoAction } from '../actions';
import { ItemSalvoForm } from '../item-salvo-form';

export const dynamic = 'force-dynamic';

const ID_DO_TITULO = 'titulo-item-salvo';

/**
 * Plano 22 (T10b, US-379): o item salvo — h1 com o nome, o formulário e "Excluir". Editar o item não muda nenhuma receita
 * (a receita guarda a cópia, RN-393). A seção marcada é a do tipo do item. Inexistente ou de outro consultório → 404.
 */
export default async function ItemSalvoPage({ params }: PageProps<'/painel/prescricao/itens/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await acessoComDocumentos(`${LISTA_DE_ITENS}/${id}`);
  const item = await abrirItemSalvo(ctx, id);
  if (!item) notFound();
  const grupo = grupoDoTipo(item.tipo);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={ID_DO_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">
          {item.nome}
        </h1>
        <ExcluirDaBiblioteca nome={item.nome} excluir={excluirItemSalvoAction.bind(null, item.id, grupo)} idTitulo={ID_DO_TITULO} />
      </div>
      <SecoesDePrescricao atual={grupo} />
      <ItemSalvoForm acao={salvarItemSalvoAction.bind(null, item.id)} nome={item.nome} item={item.item} habilitada={!!tenant.fitoterapiaRegistro} />
    </>
  );
}
