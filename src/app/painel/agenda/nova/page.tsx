import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { dataDaAgendaOuHoje } from '@/modules/agenda/fuso';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { listarPacientes } from '@/modules/pacientes/pacientes';
import { agendarAction } from '../actions';
import { ConsultaForm } from '../consulta-form';

export const dynamic = 'force-dynamic';

export default async function NovaConsultaPage({ searchParams }: PageProps<'/painel/agenda/nova'>) {
  const { ctx, tenant } = await requireNutri('/painel/agenda/nova');
  const sp = await searchParams;
  const pacientes = await listarPacientes(ctx, { status: 'ativo' });
  const data = dataDaAgendaOuHoje(sp.data, hojeNoFuso(tenant.fuso));
  // `?paciente=` que não é de um paciente ativo da lista fica sem seleção (o <select> sem opção igual escolheria o primeiro paciente)
  const patientId = typeof sp.paciente === 'string' && pacientes.some((p) => p.id === sp.paciente) ? sp.paciente : '';
  return (
    <>
      <main className="space-y-4 p-6">
        <p className="text-sm"><Link href={`/painel/agenda?data=${data}`} className="underline">Agenda</Link></p>
        <h1 className="text-2xl font-semibold">Nova consulta</h1>
        <ConsultaForm acao={agendarAction} pacientes={pacientes} linkPadrao={tenant.linkOnlinePadrao} botao="Marcar consulta"
          inicial={{ patientId, data, hora: '', duracaoMin: '60', modalidade: 'presencial', linkOnline: '' }} />
      </main>
    </>
  );
}
