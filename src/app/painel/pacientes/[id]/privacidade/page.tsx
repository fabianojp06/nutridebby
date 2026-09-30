import { ConfirmarBotao } from '@/components/confirmar-botao';
import { formatarData } from '@/modules/pacientes/datas';
import { PRAZO_GUARDA_ANOS } from '@/modules/pacientes/lgpd';
import { formatarDataHora } from '@/modules/plataforma/ui/historico-acessos';
import { carregarProntuario } from '../prontuario';
import { arquivarAction, atenderExclusaoAction, desarquivarAction } from './actions';
import { ExclusaoForm } from './exclusao-form';

export const dynamic = 'force-dynamic';

export default async function PrivacidadePage({
  params,
}: PageProps<'/painel/pacientes/[id]/privacidade'>) {
  const { id } = await params;
  const { tenant, paciente } = await carregarProntuario(id);
  return (
    <div className="max-w-3xl space-y-8">
      <section aria-labelledby="arquivamento" className="space-y-2">
        <h2 id="arquivamento" className="text-lg font-semibold">
          Arquivamento
        </h2>
        {paciente.status === 'ativo' && (
          <>
            <p>
              O paciente arquivado perde o acesso ao portal e deixa de receber notificações. O
              prontuário é mantido e continua acessível para você.
            </p>
            <form action={arquivarAction.bind(null, paciente.id)}>
              <ConfirmarBotao mensagem="Arquivar este paciente?">Arquivar paciente</ConfirmarBotao>
            </form>
          </>
        )}
        {paciente.status === 'arquivado' && (
          <form action={desarquivarAction.bind(null, paciente.id)}>
            <button className="rounded border px-4 py-2">Desarquivar paciente</button>
          </form>
        )}
        {paciente.status === 'bloqueado' && (
          <p>Paciente bloqueado por pedido de exclusão: não pode ser desarquivado.</p>
        )}
      </section>

      <section aria-labelledby="exclusao" className="space-y-2">
        <h2 id="exclusao" className="text-lg font-semibold">
          Pedido de exclusão (LGPD, art. 18)
        </h2>
        {paciente.status === 'bloqueado' ? (
          <p role="status">
            {`Pedido atendido em ${paciente.bloqueadoEm ? formatarDataHora(paciente.bloqueadoEm, tenant.fuso) : '—'}. `}
            {paciente.anonimizadoEm
              ? 'Os dados de identificação já foram anonimizados.'
              : `Anonimização prevista para ${paciente.anonimizarApos ? formatarData(paciente.anonimizarApos) : '—'}.`}
          </p>
        ) : (
          <>
            <p>
              {`Durante o prazo de guarda do prontuário (${PRAZO_GUARDA_ANOS} anos após a última consulta), os dados clínicos ficam guardados, identificados e só para sua consulta. Na hora são apagadas as autorizações de WhatsApp e os convites, e o paciente recebe um e-mail explicando. No fim do prazo, os dados de identificação são anonimizados.`}
            </p>
            <ExclusaoForm acao={atenderExclusaoAction.bind(null, paciente.id)} />
          </>
        )}
      </section>
    </div>
  );
}
