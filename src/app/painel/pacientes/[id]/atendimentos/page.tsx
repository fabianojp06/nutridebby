import Link from 'next/link';
import { listarAtendimentos } from '@/modules/pacientes/atendimentos';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../prontuario';
import { registrarAtendimentoAction } from './actions';
import { AtendimentoForm } from './atendimento-form';

export const dynamic = 'force-dynamic';

export default async function AtendimentosPage({
  params,
}: PageProps<'/painel/pacientes/[id]/atendimentos'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const lista = await listarAtendimentos(ctx, paciente.id);
  const hoje = hojeNoFuso(tenant.fuso);
  return (
    <div className="space-y-8">
      {paciente.status !== 'bloqueado' && (
        <section aria-labelledby="novo-atendimento" className="max-w-3xl space-y-3">
          <h2 id="novo-atendimento" className="text-lg font-semibold">
            Novo atendimento
          </h2>
          <AtendimentoForm
            acao={registrarAtendimentoAction.bind(null, paciente.id)}
            inicial={{ data: hoje, notasPrivadas: '', orientacoes: '' }}
            hoje={hoje}
            botao="Registrar atendimento"
            somenteLeitura={false}
          />
        </section>
      )}
      <section aria-labelledby="atendimentos" className="space-y-2">
        <h2 id="atendimentos" className="text-lg font-semibold">
          Atendimentos
        </h2>
        {lista.length === 0 ? (
          <p>Nenhum atendimento registrado.</p>
        ) : (
          <ul className="divide-y">
            {lista.map((a) => (
              <li key={a.id} className="py-2">
                <Link
                  href={`/painel/pacientes/${paciente.id}/atendimentos/${a.id}`}
                  className="underline"
                >
                  {formatarData(a.data)}
                </Link>
                {a.orientacoesPaciente && (
                  <p className="line-clamp-2 text-sm text-zinc-700">{a.orientacoesPaciente}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
