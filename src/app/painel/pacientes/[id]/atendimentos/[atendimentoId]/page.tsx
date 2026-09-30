import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buscarAtendimento } from '@/modules/pacientes/atendimentos';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../../prontuario';
import { atualizarAtendimentoAction } from '../actions';
import { AtendimentoForm } from '../atendimento-form';

export const dynamic = 'force-dynamic';

export default async function AtendimentoPage({
  params,
}: PageProps<'/painel/pacientes/[id]/atendimentos/[atendimentoId]'>) {
  const { id, atendimentoId } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const a = await buscarAtendimento(ctx, paciente.id, atendimentoId);
  if (!a) notFound();
  const base = `/painel/pacientes/${paciente.id}`;
  return (
    <div className="grid gap-8 md:grid-cols-3">
      <section aria-labelledby="atendimento-titulo" className="space-y-3 md:col-span-2">
        <h2
          id="atendimento-titulo"
          className="text-lg font-semibold"
        >{`Atendimento de ${formatarData(a.data)}`}</h2>
        <AtendimentoForm
          acao={atualizarAtendimentoAction.bind(null, paciente.id, a.id)}
          inicial={{
            data: a.data,
            notasPrivadas: a.notasPrivadas ?? '',
            orientacoes: a.orientacoesPaciente ?? '',
          }}
          hoje={hojeNoFuso(tenant.fuso)}
          botao="Salvar atendimento"
          somenteLeitura={paciente.status === 'bloqueado'}
        />
      </section>
      <nav aria-labelledby="atalhos" className="space-y-2">
        <h2 id="atalhos" className="text-lg font-semibold">
          Neste atendimento
        </h2>
        <ul className="space-y-1">
          <li>
            <Link href={`${base}/anamnese`} className="underline">
              Anamnese
            </Link>
          </li>
          <li>
            <Link href={`${base}/antropometria?atendimento=${a.id}`} className="underline">
              Antropometria
            </Link>
          </li>
          <li>
            <Link href={`${base}/gasto-energetico`} className="underline">
              Gasto energético
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
