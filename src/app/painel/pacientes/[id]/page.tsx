import { situacaoDoAcesso } from '@/modules/pacientes/convite-paciente';
import { atualizarPacienteAction, reenviarConviteAction } from '../actions';
import { PacienteForm } from '../paciente-form';
import { textoDoAcesso, valoresDoPaciente } from '../valores';
import { carregarProntuario } from './prontuario';

export const dynamic = 'force-dynamic';

export default async function ResumoPage({ params }: PageProps<'/painel/pacientes/[id]'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const acesso = await situacaoDoAcesso(ctx, paciente);
  const bloqueado = paciente.status === 'bloqueado';
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section aria-labelledby="cadastro-titulo" className="max-w-xl space-y-3">
        <h2 id="cadastro-titulo" className="text-lg font-semibold">Cadastro</h2>
        {bloqueado && <p role="status">Paciente bloqueado por pedido de exclusão: o prontuário é só para consulta.</p>}
        <PacienteForm
          acao={atualizarPacienteAction.bind(null, paciente.id)}
          inicial={valoresDoPaciente(paciente)}
          botao="Salvar cadastro"
          emailBloqueado={!!paciente.userId}
          somenteLeitura={bloqueado}
        />
      </section>
      <section aria-labelledby="acesso-titulo" className="space-y-2">
        <h2 id="acesso-titulo" className="text-lg font-semibold">Acesso ao portal</h2>
        <p>{textoDoAcesso(acesso, tenant.fuso)}</p>
        {acesso.estado !== 'ativo' && paciente.status === 'ativo' && (
          <form action={reenviarConviteAction.bind(null, paciente.id)}>
            <button className="rounded border px-4 py-2">Reenviar convite</button>
          </form>
        )}
      </section>
    </div>
  );
}
