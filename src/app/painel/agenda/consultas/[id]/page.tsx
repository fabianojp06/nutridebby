import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_AGENDA, ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { buscarConsulta, STATUS_ATIVOS } from '@/modules/agenda/consultas';
import { listarBloqueios } from '@/modules/agenda/disponibilidade';
import { formatarQuando, partesNoFuso } from '@/modules/agenda/fuso';
import { sobrepoe } from '@/modules/agenda/horarios';
import { consultaParaIniciarAtendimento, MSG_PRESENCA } from '@/modules/agenda/presenca';
import { listarNotificacoesDaConsulta } from '@/modules/notificacoes/agendar';
import { ROTULO_CANAL, ROTULO_TIPO, situacaoDaNotificacao, type Canal, type TipoNotificacao } from '@/modules/notificacoes/tipos';
import { Cabecalho } from '../../../cabecalho';
import { cancelarAction, moverAction, presencaAction } from '../../actions';
import { ConsultaForm } from '../../consulta-form';
import { AVISO_ROTULO, lerAvisos, selosDaConsulta } from '../../periodo';
import { CancelarForm } from './cancelar-form';
import { PresencaForm } from './presenca';

export const dynamic = 'force-dynamic';

export default async function ConsultaPage({ params, searchParams }: PageProps<'/painel/agenda/consultas/[id]'>) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tenant } = await requireNutri(`/painel/agenda/consultas/${id}`);
  const c = await buscarConsulta(ctx, id);
  if (!c) notFound();
  const emBloqueio = (await listarBloqueios(ctx, c.inicio, c.fim)).some((b) => sobrepoe(b, c));
  const lembretes = await listarNotificacoesDaConsulta(ctx, c.id);
  const p = partesNoFuso(c.inicio, tenant.fuso);
  const ok = sp.ok === 'marcada' ? MSG_AGENDA.marcada : sp.ok === 'alterada' ? MSG_AGENDA.alterada : sp.ok === 'cancelada' ? MSG_AGENDA.cancelada : sp.ok === 'presenca' ? MSG_PRESENCA.registrada : null;
  const ativa = STATUS_ATIVOS.includes(c.status);
  const agora = new Date();
  const comecou = c.status !== 'cancelada' && c.inicio.getTime() <= agora.getTime();
  // rodada 1: já começou, não cancelada e sem atendimento ligado (também "realizada"/"faltou")
  const podeAtender = (await consultaParaIniciarAtendimento(ctx, c.patientId, c.id, agora)) !== null;
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
        {comecou && (
          <section aria-labelledby="presenca" className="space-y-2">
            <h2 id="presenca" className="text-lg font-semibold">Registrar presença</h2>
            <PresencaForm realizada={presencaAction.bind(null, c.id, 'realizada')} faltou={presencaAction.bind(null, c.id, 'faltou')} />
          </section>
        )}
        {podeAtender && (
          <p><Link href={`/painel/pacientes/${c.patientId}/atendimentos?consulta=${c.id}`} className="inline-block rounded bg-emerald-700 px-3 py-1.5 text-white">Iniciar atendimento</Link></p>
        )}
        {ativa && (
          <section aria-labelledby="alterar" className="space-y-2">
            <h2 id="alterar" className="text-lg font-semibold">Alterar data e hora</h2>
            <ConsultaForm acao={moverAction.bind(null, c.id)} linkPadrao={tenant.linkOnlinePadrao} botao="Salvar alteração"
              inicial={{ data: p.data, hora: p.hora, duracaoMin: String(Math.round((c.fim.getTime() - c.inicio.getTime()) / 60_000)), modalidade: c.modalidade, linkOnline: c.linkOnline ?? '' }} />
          </section>
        )}
        {ativa && (
          <section aria-labelledby="cancelar" className="space-y-2">
            <h2 id="cancelar" className="text-lg font-semibold">Cancelar consulta</h2>
            <CancelarForm acao={cancelarAction.bind(null, c.id)} />
          </section>
        )}
        <section aria-labelledby="lembretes" className="space-y-2">
          <h2 id="lembretes" className="text-lg font-semibold">Lembretes</h2>
          {lembretes.length === 0 ? (
            <p>Nenhum lembrete para esta consulta.</p>
          ) : (
            <table className="w-full max-w-3xl text-left text-sm">
              <caption className="sr-only">Lembretes da consulta</caption>
              <thead>
                <tr><th scope="col">Mensagem</th><th scope="col">Canal</th><th scope="col">Situação</th></tr>
              </thead>
              <tbody>
                {lembretes.map((n) => (
                  <tr key={n.id} className="border-t">
                    <td>{ROTULO_TIPO[n.tipo as TipoNotificacao]}</td>
                    <td>{ROTULO_CANAL[n.canal as Canal]}</td>
                    <td>{situacaoDaNotificacao(n, tenant.fuso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
