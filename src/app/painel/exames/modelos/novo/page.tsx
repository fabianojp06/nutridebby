import { requireNutri } from '@/lib/tenant-session';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { bibliotecasParaExames } from '@/modules/exames/modelos-solicitacao';
import { salvarModeloSolicitacaoAction } from '../actions';
import { ModeloForm } from '../modelo-form';
import { paraEscolher } from '../../valores';

export const dynamic = 'force-dynamic';

/** Plano 22 (T3, US-376): "Novo modelo de solicitação". */
export default async function NovoModeloSolicitacaoPage() {
  const { ctx } = await requireNutri('/painel/exames/modelos/novo');
  const { catalogo } = await bibliotecasParaExames(ctx);
  return (
    <>
      <h1 className="font-titulo text-2xl font-semibold">{MSG_EXAMES.modelosSolicitacao.tituloNovo}</h1>
      <ModeloForm acao={salvarModeloSolicitacaoAction.bind(null, null)} inicial={{ nome: '', exames: [], orientacoes: '' }} catalogo={paraEscolher(catalogo)} />
    </>
  );
}
