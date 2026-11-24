import Link from 'next/link';
import { acessoComDocumentos } from '@/app/painel/documentos-liberados';
import { RetornoDaTela } from '@/app/painel/exames/retorno';
import { marcadorDaUrl } from '@/app/painel/exames/valores';
import { BotaoLink } from '@/components/ui/botao';
import { listarItensSalvos, MSG_MODELOS } from '@/modules/documentos/modelos';
import { TIPOS_ITEM } from '@/modules/documentos/prescricao';
import { ExcluirDaBiblioteca } from '../excluir';
import { SecoesDePrescricao } from '../secoes';
import { grupoDaUrl, LISTA_DE_ITENS } from '../valores';
import { excluirItemSalvoAction } from './actions';

export const dynamic = 'force-dynamic';

const M = MSG_MODELOS;
const ID_DO_TITULO = 'titulo-itens-salvos';

/**
 * Plano 22 (T10b, US-379, RN-393, spec §4.1): os itens salvos do consultório, por grupo (`?tipo=suplementos|fitoterapicos`;
 * ausente ou inválido vale `suplementos`). Só com `documentos_liberados` (RN-398). A região `role="status"` fica sempre
 * montada acima da lista ("Item salvo.", "Item excluído."), e o foco vai ao h1 depois de salvar ou excluir.
 */
export default async function ItensSalvosPage({ searchParams }: PageProps<'/painel/prescricao/itens'>) {
  const { ctx } = await acessoComDocumentos(LISTA_DE_ITENS);
  const sp = await searchParams;
  const grupo = grupoDaUrl(sp.tipo);
  const itens = await listarItensSalvos(ctx, grupo);
  const texto = sp.ok === 'salvo' ? M.itemSalvo : sp.ok === 'excluido' ? M.itemExcluido : '';
  return (
    <>
      <h1 id={ID_DO_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">
        {M.titulo}
      </h1>
      <SecoesDePrescricao atual={grupo} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-titulo text-xl font-semibold">{M.secoes[grupo]}</h2>
        <BotaoLink href={`${LISTA_DE_ITENS}/novo?tipo=${grupo}`} data-guia="novo-item-salvo">
          {M.novoItem}
        </BotaoLink>
      </div>
      <RetornoDaTela texto={texto} marcador={marcadorDaUrl(sp.r)} focarTitulo={texto ? ID_DO_TITULO : undefined} />
      {itens.length === 0 ? (
        <p>{M.vazioItens}</p>
      ) : (
        <ul className="divide-y divide-linha">
          {itens.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span>
                <Link href={`${LISTA_DE_ITENS}/${i.id}`} className="text-link underline">
                  {i.nome}
                </Link>
                <span className="text-suave"> · {TIPOS_ITEM[i.tipo as keyof typeof TIPOS_ITEM] ?? i.tipo}</span>
              </span>
              <ExcluirDaBiblioteca nome={i.nome} excluir={excluirItemSalvoAction.bind(null, i.id, grupo)} idTitulo={ID_DO_TITULO} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
