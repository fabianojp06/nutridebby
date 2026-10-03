import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { formatarQuando, quandoComFuso, somarDias } from '@/modules/agenda/fuso';
import { idValido } from '@/modules/pacientes/base';
import { formatarData } from '@/modules/pacientes/datas';
import { consultaDoPaciente, horariosDaSemana } from '@/modules/portal/agenda';
import { QuandoLocal } from '../../../quando-local';
import { AcoesConsulta } from '../acoes-consulta';
import { remarcarAction } from '../actions';
import { AgendarForm } from '../agendar-form';

export const dynamic = 'force-dynamic';

export default async function ConsultaDoPortal({ params, searchParams }: PageProps<'/p/agenda/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await requirePaciente(`/p/agenda/${id}`);
  if (!idValido(id)) notFound();
  const agora = new Date();
  const c = await consultaDoPaciente(ctx, tenant, id, agora);
  if (!c) notFound();
  const ativa = c.status === 'agendada' || c.status === 'confirmada';
  const s = ativa && c.podeAlterar ? await horariosDaSemana(tenant, agora, (await searchParams).semana, c.id) : null;
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Sua consulta</h1>
      <p>
        <QuandoLocal semFuso={formatarQuando(c.inicio, tenant.fuso)} comFuso={quandoComFuso(c.inicio, tenant.fuso)} fuso={tenant.fuso} />
        {` · ${ROTULO_MODALIDADE[c.modalidade]}`}
      </p>
      {c.modalidade === 'online' && c.linkOnline && <p><a href={c.linkOnline} className="underline" rel="noreferrer">Link da chamada</a></p>}
      {ativa ? <AcoesConsulta id={c.id} confirmada={c.status === 'confirmada'} podeAlterar={c.podeAlterar} pedidoRemarcacao={c.pedidoRemarcacao} /> : <p>{c.status === 'cancelada' ? 'Esta consulta foi cancelada.' : 'Consulta encerrada'}</p>}
      {s && (
        <section aria-labelledby="remarcar" className="space-y-3">
          <h2 id="remarcar" className="text-lg font-semibold">Remarcar</h2>
          <nav aria-label="Semana" className="flex gap-3 text-sm">
            {s.semana > s.primeira && <Link href={`/p/agenda/${c.id}?semana=${somarDias(s.semana, -7)}`} className="underline">Semana anterior</Link>}
            <span>{`${formatarData(s.semana)} a ${formatarData(somarDias(s.semana, 6))}`}</span>
            {s.semana < s.ultima && <Link href={`/p/agenda/${c.id}?semana=${somarDias(s.semana, 7)}`} className="underline">Próxima semana</Link>}
          </nav>
          <AgendarForm acao={remarcarAction.bind(null, c.id)} horarios={s.horarios} temOnline={Boolean(tenant.linkOnlinePadrao)} rotulo="Remarcar para este horário" />
        </section>
      )}
    </main>
  );
}
