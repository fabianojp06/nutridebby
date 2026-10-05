import { Aviso } from '@/components/ui/aviso';
import type { DocumentoLido } from '@/modules/documentos/documentos';
import { MSG_ENTREGA, situacaoDaEntrega } from '@/modules/documentos/entrega';
import { entreguePessoalmenteAction, reenviarLinkAction } from '../actions';
import { AcaoDocumento } from './acao-documento';

/**
 * US-145 / D3: a entrega do documento assinado (dentro do cartão "Documento assinado", só com o documento não anonimizado).
 * A situação da D4, o aviso do paciente sem portal ou arquivado, "Entregue pessoalmente" e "Reenviar link por e-mail".
 * R3: dentro do Aviso (um <p>), só texto; os botões (formulários) ficam fora dele.
 */
export function Entrega({
  d,
  paciente,
  fuso,
  linkReenviado,
}: {
  d: DocumentoLido;
  paciente: { id: string; userId: string | null; status: string; email: string | null };
  fuso: string;
  linkReenviado: boolean;
}) {
  const recebido = d.recibos.some((r) => r.evento === 'recebido');
  const situacao = situacaoDaEntrega(d, fuso);
  return (
    <section aria-labelledby="entrega" className="mt-4 space-y-2" data-guia="entrega-documento">
      <h3 id="entrega" className="font-semibold">Entrega</h3>
      {situacao && <p>{situacao}</p>}
      {paciente.status === 'arquivado' && <Aviso tipo="aviso">{MSG_ENTREGA.arquivado}</Aviso>}
      {paciente.status === 'ativo' && !paciente.userId && <Aviso tipo="aviso">{MSG_ENTREGA.semPortal}</Aviso>}
      {linkReenviado && <Aviso tipo="ok" papel="status">{MSG_ENTREGA.linkReenviado}</Aviso>}
      {d.status === 'assinado' && !recebido && paciente.status !== 'bloqueado' && (
        <AcaoDocumento acao={entreguePessoalmenteAction.bind(null, paciente.id, d.id)} rotulo="Entregue pessoalmente" confirmar="Marcar como entregue pessoalmente?" />
      )}
      {d.status === 'assinado' && paciente.status === 'ativo' && !paciente.userId && paciente.email && (
        <AcaoDocumento acao={reenviarLinkAction.bind(null, paciente.id, d.id)} rotulo="Reenviar link por e-mail" confirmar="Reenviar o link do documento para o e-mail do paciente?" />
      )}
    </section>
  );
}
