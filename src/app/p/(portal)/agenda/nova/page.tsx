import { requirePaciente } from '@/lib/paciente-session';
import { somarDias } from '@/modules/agenda/fuso';
import { localInicial } from '@/modules/agenda/horarios';
import { formatarData } from '@/modules/pacientes/datas';
import { horariosDaSemana } from '@/modules/portal/agenda';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { agendarAction } from '../actions';
import { AgendarForm } from '../agendar-form';

export const dynamic = 'force-dynamic';

/** P06-09 / US-032. Plano 23 (US-403, AG-D40): os locais com agendamento pelo paciente, com a página pública ligada ou não. */
export default async function NovaConsulta({ searchParams }: PageProps<'/p/agenda/nova'>) {
  const { tenant } = await requirePaciente('/p/agenda/nova');
  const sp = await searchParams;
  const s = await horariosDaSemana(tenant, new Date(), sp.semana);
  return (
    <>
      <CabecalhoDetalhe titulo="Agendar consulta" voltar={{ href: '/p/agenda', secao: 'Minhas consultas' }} />
      <main className="space-y-4 p-6">
        <AgendarForm
          acao={agendarAction}
          horarios={s.horarios}
          locais={s.locais}
          localInicial={localInicial(s.locais, s.horarios, sp.local)}
          rotulo="Agendar consulta"
          semana={{
            base: '/p/agenda/nova',
            rotulo: `${formatarData(s.semana)} a ${formatarData(somarDias(s.semana, 6))}`,
            anterior: s.semana > s.primeira ? somarDias(s.semana, -7) : null,
            proxima: s.semana < s.ultima ? somarDias(s.semana, 7) : null,
          }}
        />
      </main>
    </>
  );
}
