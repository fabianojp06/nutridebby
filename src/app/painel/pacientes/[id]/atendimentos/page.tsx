import Link from 'next/link';
import { buscarConsulta } from '@/modules/agenda/consultas';
import { formatarQuando, partesNoFuso } from '@/modules/agenda/fuso';
import { listarAtendimentos } from '@/modules/pacientes/atendimentos';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../prontuario';
import { registrarAtendimentoAction } from './actions';
import { AtendimentoForm } from './atendimento-form';

export const dynamic = 'force-dynamic';

export default async function AtendimentosPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/atendimentos'>) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const lista = await listarAtendimentos(ctx, paciente.id);
  const hoje = hojeNoFuso(tenant.fuso);
  // Plano 05: "Iniciar atendimento" na agenda (?consulta=<id>) — só consulta deste paciente; outra coisa é ignorada
  const consulta = typeof sp.consulta === 'string' ? await buscarConsulta(ctx, sp.consulta) : null;
  const daConsulta = consulta && consulta.patientId === paciente.id && consulta.status !== 'cancelada' ? consulta : null;
  const diaDaConsulta = daConsulta ? partesNoFuso(daConsulta.inicio, tenant.fuso).data : null;
  const dataInicial = diaDaConsulta && diaDaConsulta < hoje ? diaDaConsulta : hoje;
  return (
    <div className="space-y-8">
      {paciente.status !== 'bloqueado' && (
        <section aria-labelledby="novo-atendimento" className="max-w-3xl space-y-3">
          <h2 id="novo-atendimento" className="text-lg font-semibold">Novo atendimento</h2>
          {daConsulta && <p className="text-sm">{`Atendimento da consulta de ${formatarQuando(daConsulta.inicio, tenant.fuso)}.`}</p>}
          <AtendimentoForm acao={registrarAtendimentoAction.bind(null, paciente.id)} inicial={{ data: dataInicial, notasPrivadas: '', orientacoes: '' }} hoje={hoje} botao="Registrar atendimento" somenteLeitura={false} consultaId={daConsulta?.id} />
        </section>
      )}
      <section aria-labelledby="atendimentos" className="space-y-2">
        <h2 id="atendimentos" className="text-lg font-semibold">Atendimentos</h2>
        {lista.length === 0 ? (
          <p>Nenhum atendimento registrado.</p>
        ) : (
          <ul className="divide-y">
            {lista.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/painel/pacientes/${paciente.id}/atendimentos/${a.id}`} className="underline">{formatarData(a.data)}</Link>
                {a.orientacoesPaciente && <p className="line-clamp-2 text-sm text-zinc-700">{a.orientacoesPaciente}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
