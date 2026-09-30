import { atualizarPacienteAction } from '../actions';
import { PacienteForm } from '../paciente-form';
import { valoresDoPaciente } from '../valores';
import { carregarProntuario } from './prontuario';

export const dynamic = 'force-dynamic';

export default async function ResumoPage({ params }: PageProps<'/painel/pacientes/[id]'>) {
  const { id } = await params;
  const { paciente } = await carregarProntuario(id);
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
    </div>
  );
}
