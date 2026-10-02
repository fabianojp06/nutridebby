import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_AGENDA, ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { buscarConsulta, STATUS_ATIVOS } from '@/modules/agenda/consultas';
import { listarBloqueios } from '@/modules/agenda/disponibilidade';
import { formatarQuando, partesNoFuso } from '@/modules/agenda/fuso';
import { sobrepoe } from '@/modules/agenda/horarios';
import { Cabecalho } from '../../../cabecalho';
import { moverAction } from '../../actions';
import { ConsultaForm } from '../../consulta-form';
import { AVISO_ROTULO, lerAvisos, selosDaConsulta } from '../../periodo';

export const dynamic = 'force-dynamic';

export default async function ConsultaPage({ params, searchParams }: PageProps<'/painel/agenda/consultas/[id]'>) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tenant } = await requireNutri(`/painel/agenda/consultas/${id}`);
  const c = await buscarConsulta(ctx, id);
  if (!c) notFound();
  const emBloqueio = (await listarBloqueios(ctx, c.inicio, c.fim)).some((b) => sobrepoe(b, c));
  const p = partesNoFuso(c.inicio, tenant.fuso);
  const ok = sp.ok === 'marcada' ? MSG_AGENDA.marcada : sp.ok === 'alterada' ? MSG_AGENDA.alterada : null;
  const ativa = STATUS_ATIVOS.includes(c.status);
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="space-y-6 p-6">
        <p className="text-sm"><Link href={`/painel/agenda?data=${p.data}`} className="underline">Agenda</Link></p>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{`Consulta de ${c.paciente}`}</h1>
          <p>{`${formatarQuando(c.inicio, tenant.fuso)}–${partesNoFuso(c.fim, tenant.fuso).hora} · ${ROTULO_MODALIDADE[c.modalidade]}`}</p>
          {c.linkOnline && <p className="text-sm">Link da chamada: <a href={c.linkOnline} className="underline" rel="noreferrer" target="_blank">{c.linkOnline}</a></p>}
          <ul className="flex flex-wrap gap-1 text-sm" aria-label="Situação">
            {selosDaConsulta(c, emBloqueio).map((s) => <li key={s} className="rounded bg-zinc-100 px-1.5">{s}</li>)}
          </ul>
          <p className="text-sm"><Link href={`/painel/pacientes/${c.patientId}`} className="underline">Abrir prontuário</Link></p>
        </header>
        {ok && <p role="status" className="rounded bg-emerald-50 p-3">{ok}</p>}
        {lerAvisos(sp.avisos).map((a) => <p key={a} role="status" className="rounded bg-amber-50 p-3 text-amber-900">{AVISO_ROTULO[a]}</p>)}
        {/* Tarefa 15: Registrar presença e Iniciar atendimento */}
        {ativa && (
          <section aria-labelledby="alterar" className="space-y-2">
            <h2 id="alterar" className="text-lg font-semibold">Alterar data e hora</h2>
            <ConsultaForm acao={moverAction.bind(null, c.id)} linkPadrao={tenant.linkOnlinePadrao} botao="Salvar alteração"
              inicial={{ data: p.data, hora: p.hora, duracaoMin: String(Math.round((c.fim.getTime() - c.inicio.getTime()) / 60_000)), modalidade: c.modalidade, linkOnline: c.linkOnline ?? '' }} />
          </section>
        )}
        {/* Tarefa 7: Cancelar consulta */}
        {/* Tarefa 5: Lembretes */}
      </main>
    </>
  );
}
