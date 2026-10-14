import { ConfirmarBotao } from '@/components/confirmar-botao';
import { classeDoBotao } from '@/components/ui/botao';
import { MSG_MODELO_IA } from '@/modules/plano-alimentar/constantes';

/** US-123 "Aprovar modelo" (plano e anamnese): pede a confirmação antes de enviar; a ação vem ligada ao id do modelo. */
export function AprovarModelo({ acao }: { acao: () => Promise<void> }) {
  return (
    <form action={acao}>
      <ConfirmarBotao mensagem={MSG_MODELO_IA.confirmarAprovar} className={classeDoBotao()}>{MSG_MODELO_IA.aprovar}</ConfirmarBotao>
    </form>
  );
}
