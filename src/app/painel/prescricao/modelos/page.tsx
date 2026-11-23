import Link from 'next/link';
import { acessoComDocumentos } from '@/app/painel/documentos-liberados';
import { RetornoDaTela } from '@/app/painel/exames/retorno';
import { marcadorDaUrl } from '@/app/painel/exames/valores';
import { listarModelosPrescricao, MSG_MODELOS } from '@/modules/documentos/modelos';
import { ExcluirDaBiblioteca } from '../excluir';
import { SecoesDePrescricao } from '../secoes';
import { LISTA_DE_MODELOS } from '../valores';
import { excluirModeloPrescricaoAction } from './actions';

export const dynamic = 'force-dynamic';

const M = MSG_MODELOS;
const ID_DO_TITULO = 'titulo-modelos-prescricao';

/**
 * Plano 22 (T10b, US-379, RN-394, spec §4.1): os modelos de prescrição do consultório. Não há tela de criação — o modelo
 * nasce da receita ("Salvar como modelo"), e a lista vazia diz isso. Só com `documentos_liberados` (RN-398). A região
 * `role="status"` fica sempre montada acima da lista ("Modelo salvo.", "Modelo excluído.").
 */
export default async function ModelosPrescricaoPage({ searchParams }: PageProps<'/painel/prescricao/modelos'>) {
  const { ctx } = await acessoComDocumentos(LISTA_DE_MODELOS);
  const sp = await searchParams;
  const modelos = await listarModelosPrescricao(ctx);
  const texto = sp.ok === 'salvo' ? M.modeloSalvo : sp.ok === 'excluido' ? M.modeloExcluido : '';
  return (
    <>
      <h1 id={ID_DO_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">
        {M.secoes.modelos}
      </h1>
      <SecoesDePrescricao atual="modelos" />
      <RetornoDaTela texto={texto} marcador={marcadorDaUrl(sp.r)} focarTitulo={texto ? ID_DO_TITULO : undefined} />
      {modelos.length === 0 ? (
        <p>{M.vazioModelos}</p>
      ) : (
        <ul className="divide-y divide-linha">
          {modelos.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span>
                <Link href={`${LISTA_DE_MODELOS}/${m.id}`} className="text-link underline">
                  {m.nome}
                </Link>
                <span className="text-suave"> · {M.itensN(m.itens)}</span>
              </span>
              <ExcluirDaBiblioteca nome={m.nome} excluir={excluirModeloPrescricaoAction.bind(null, m.id)} idTitulo={ID_DO_TITULO} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
