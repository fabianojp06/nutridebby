import Link from 'next/link';
import { FocoNaAncora } from '@/components/foco-na-ancora';
import { formatarQuando, partesNoFuso } from '@/modules/agenda/fuso';
import { consultaParaIniciarAtendimento } from '@/modules/agenda/presenca';
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
  // Plano 05: "Iniciar atendimento" na agenda (?consulta=<id>) — a mesma regra do link (deste paciente, já começada, não
  // cancelada, sem atendimento ligado); outra coisa é ignorada (sem aviso nem campo oculto)
  const daConsulta = typeof sp.consulta === 'string' ? await consultaParaIniciarAtendimento(ctx, paciente.id, sp.consulta, new Date()) : null;
  const diaDaConsulta = daConsulta ? partesNoFuso(daConsulta.inicio, tenant.fuso).data : null;
  const dataInicial = diaDaConsulta && diaDaConsulta < hoje ? diaDaConsulta : hoje;
  return (
    <div className="space-y-8">
      <FocoNaAncora />
      {paciente.status !== 'bloqueado' && (
        <section aria-labelledby="novo-atendimento" className="max-w-3xl space-y-3">
          <h2 id="novo-atendimento" tabIndex={-1} className="text-lg font-semibold">Novo atendimento</h2>
          {daConsulta && <p className="text-sm">{`Atendimento da consulta de ${formatarQuando(daConsulta.inicio, tenant.fuso)}.`}</p>}
          <AtendimentoForm acao={registrarAtendimentoAction.bind(null, paciente.id)} inicial={{ data: dataInicial, notasPrivadas: '', orientacoes: '' }} hoje={hoje} botao="Registrar atendimento" somenteLeitura={false} consultaId={daConsulta?.id} />
        </section>
      )}
      <section aria-labelledby="atendimentos" className="space-y-2">
        <h2 id="atendimentos" className="text-lg font-semibold">Atendimentos</h2>
        {lista.length === 0 ? (
          <p>Nenhum atendimento registrado.</p>
        ) : (
          <ul className="divide-y divide-linha">
            {lista.map((a) => (
              <li key={a.id} className="py-2">
                <Link href={`/painel/pacientes/${paciente.id}/atendimentos/${a.id}`} className="text-link underline">{formatarData(a.data)}</Link>
                {a.orientacoesPaciente && <p className="line-clamp-2 text-sm text-suave">{a.orientacoesPaciente}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
