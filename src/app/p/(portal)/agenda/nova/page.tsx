import Link from 'next/link';
import { requirePaciente } from '@/lib/paciente-session';
import { somarDias } from '@/modules/agenda/fuso';
import { formatarData } from '@/modules/pacientes/datas';
import { horariosDaSemana } from '@/modules/portal/agenda';
import { agendarAction } from '../actions';
import { AgendarForm } from '../agendar-form';

export const dynamic = 'force-dynamic';

export default async function NovaConsulta({ searchParams }: PageProps<'/p/agenda/nova'>) {
  const { tenant } = await requirePaciente('/p/agenda/nova');
  const s = await horariosDaSemana(tenant, new Date(), (await searchParams).semana);
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Agendar consulta</h1>
      <nav aria-label="Semana" className="flex items-center gap-3 text-sm">
        {s.semana > s.primeira && <Link href={`/p/agenda/nova?semana=${somarDias(s.semana, -7)}`} className="inline-flex min-h-11 items-center underline">Semana anterior</Link>}
        <span>{`${formatarData(s.semana)} a ${formatarData(somarDias(s.semana, 6))}`}</span>
        {s.semana < s.ultima && <Link href={`/p/agenda/nova?semana=${somarDias(s.semana, 7)}`} className="inline-flex min-h-11 items-center underline">Próxima semana</Link>}
      </nav>
      <AgendarForm acao={agendarAction} horarios={s.horarios} temOnline={Boolean(tenant.linkOnlinePadrao)} rotulo="Agendar consulta" />
    </main>
  );
}
