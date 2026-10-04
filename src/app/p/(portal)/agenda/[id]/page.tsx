import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePaciente } from '@/lib/paciente-session';
import { MSG_AGENDA, ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
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
  const sp = await searchParams;
  const ativa = c.status === 'agendada' || c.status === 'confirmada';
  const s = ativa && c.podeAlterar ? await horariosDaSemana(tenant, agora, sp.semana, c.id) : null;
  // US-033: a remarcação traz para a consulta nova (`remarcarAction`); a confirmação vem pela URL, como no painel
  const remarcada = sp.ok === 'remarcada' && ativa ? MSG_AGENDA.remarcada(quandoComFuso(c.inicio, tenant.fuso)) : null;
  return (
    <main className="space-y-4 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Sua consulta</h1>
      {remarcada && <p role="status" className="rounded bg-ok-fundo p-3">{remarcada}</p>}
      <p>
        <QuandoLocal semFuso={formatarQuando(c.inicio, tenant.fuso)} comFuso={quandoComFuso(c.inicio, tenant.fuso)} fuso={tenant.fuso} />
        {` · ${ROTULO_MODALIDADE[c.modalidade]}`}
      </p>
      {ativa && c.modalidade === 'online' && c.linkOnline && (
        <p>
          <a href={c.linkOnline} className="inline-flex min-h-11 items-center underline" rel="noreferrer">Link da chamada</a>
        </p>
      )}
      {ativa ? <AcoesConsulta id={c.id} confirmada={c.status === 'confirmada'} podeAlterar={c.podeAlterar} pedidoRemarcacao={c.pedidoRemarcacao} /> : <p>{c.status === 'cancelada' ? 'Esta consulta foi cancelada.' : 'Consulta encerrada'}</p>}
      {s && (
        <section aria-labelledby="remarcar" className="space-y-3">
          <h2 id="remarcar" className="text-lg font-semibold">Remarcar</h2>
          <nav aria-label="Semana" className="flex items-center gap-3 text-sm">
            {s.semana > s.primeira && <Link href={`/p/agenda/${c.id}?semana=${somarDias(s.semana, -7)}`} className="inline-flex min-h-11 items-center underline">Semana anterior</Link>}
            <span>{`${formatarData(s.semana)} a ${formatarData(somarDias(s.semana, 6))}`}</span>
            {s.semana < s.ultima && <Link href={`/p/agenda/${c.id}?semana=${somarDias(s.semana, 7)}`} className="inline-flex min-h-11 items-center underline">Próxima semana</Link>}
          </nav>
          <AgendarForm acao={remarcarAction.bind(null, c.id)} horarios={s.horarios} temOnline={Boolean(tenant.linkOnlinePadrao)} rotulo="Remarcar para este horário" />
        </section>
      )}
    </main>
  );
}
