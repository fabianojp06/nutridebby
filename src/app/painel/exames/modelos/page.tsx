import Link from 'next/link';
import { BotaoLink } from '@/components/ui/botao';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { listarModelosSolicitacao } from '@/modules/exames/modelos-solicitacao';
import { RetornoDaTela } from '../retorno';
import { marcadorDaUrl } from '../valores';
import { ExcluirModelo } from './excluir-modelo';

export const dynamic = 'force-dynamic';

const M = MSG_EXAMES.modelosSolicitacao;
const ID_DO_TITULO = 'titulo-modelos-solicitacao';

/**
 * Plano 22 (T3, US-376, RN-391): os modelos de solicitação do consultório. Não dependem de `documentos_liberados` (servem
 * também para lançar exames). A região `role="status"` fica sempre montada acima da lista.
 */
export default async function ModelosSolicitacaoPage({ searchParams }: PageProps<'/painel/exames/modelos'>) {
  const { ctx } = await requireNutri('/painel/exames/modelos');
  const sp = await searchParams;
  const modelos = await listarModelosSolicitacao(ctx);
  const texto = sp.ok === 'salvo' ? M.salvo : sp.ok === 'excluido' ? M.excluido : '';
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={ID_DO_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">
          {M.titulo}
        </h1>
        <BotaoLink href="/painel/exames/modelos/novo" data-guia="novo-modelo-solicitacao">
          {M.novo}
        </BotaoLink>
      </div>
      <RetornoDaTela texto={texto} marcador={marcadorDaUrl(sp.r)} focarTitulo={texto ? ID_DO_TITULO : undefined} />
      {modelos.length === 0 ? (
        <p>{M.vazio}</p>
      ) : (
        <ul className="divide-y divide-linha">
          {modelos.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span>
                <Link href={`/painel/exames/modelos/${m.id}`} className="text-link underline">
                  {m.nome}
                </Link>
                <span className="text-suave"> · {M.examesN(m.exames.length)}</span>
              </span>
              <ExcluirModelo id={m.id} nome={m.nome} idTitulo={ID_DO_TITULO} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
