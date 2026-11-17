import { MSG_BLOQUEADO } from '@/modules/pacientes/base';
import { etiquetasDoPaciente, listarEtiquetas } from '@/modules/pacientes/etiquetas';
import { situacaoDoAcesso, situacaoDoConviteWhatsapp } from '@/modules/pacientes/convite-paciente';
import { atualizarPacienteAction, reenviarConviteAction, salvarEtiquetasAction } from '../../actions';
import { PacienteForm } from '../../paciente-form';
import { textoDoAcesso, textoDoConviteWhatsapp, valoresDoPaciente } from '../../valores';
import { EtiquetasForm } from '../etiquetas-form';
import { carregarProntuario } from '../prontuario';

export const dynamic = 'force-dynamic';

/** Plano 18 (D12, US-262 "Abas"): o cadastro, o acesso ao app e as etiquetas, que ficavam no Resumo. */
export default async function PerfilPage({ params }: PageProps<'/painel/pacientes/[id]/perfil'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const [acesso, conviteWa, todas, doPaciente] = await Promise.all([
    situacaoDoAcesso(ctx, paciente),
    situacaoDoConviteWhatsapp(ctx, paciente.id),
    listarEtiquetas(ctx),
    etiquetasDoPaciente(ctx, paciente.id),
  ]);
  const conviteWhatsapp = textoDoConviteWhatsapp(conviteWa, tenant.fuso); // US-010
  const bloqueado = paciente.status === 'bloqueado';
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section aria-labelledby="cadastro-titulo" className="max-w-xl space-y-3">
        <h2 id="cadastro-titulo" className="text-lg font-semibold">Cadastro</h2>
        {bloqueado && <p role="status">{MSG_BLOQUEADO}</p>}
        <PacienteForm
          acao={atualizarPacienteAction.bind(null, paciente.id)}
          inicial={valoresDoPaciente(paciente)}
          botao="Salvar cadastro"
          emailBloqueado={!!paciente.userId}
          somenteLeitura={bloqueado}
        />
      </section>
      <section aria-labelledby="acesso-titulo" className="space-y-2">
        <h2 id="acesso-titulo" className="text-lg font-semibold">Acesso ao app</h2>
        <p>{textoDoAcesso(acesso, tenant.fuso)}</p>
        {conviteWhatsapp && <p className="text-sm">{conviteWhatsapp}</p>}
        {acesso.estado !== 'ativo' && paciente.status === 'ativo' && (
          <form action={reenviarConviteAction.bind(null, paciente.id)}>
            <button className="inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha">Reenviar convite</button>
          </form>
        )}
      </section>
      <section aria-labelledby="etiquetas-titulo" className="space-y-2">
        <h2 id="etiquetas-titulo" className="text-lg font-semibold">Etiquetas</h2>
        <p className="text-sm text-suave">Só você vê as etiquetas. Use para filtrar a lista e direcionar conteúdos.</p>
        <EtiquetasForm acao={salvarEtiquetasAction.bind(null, paciente.id)} todas={todas} doPaciente={doPaciente.map((e) => e.id)} somenteLeitura={bloqueado} />
      </section>
    </div>
  );
}
