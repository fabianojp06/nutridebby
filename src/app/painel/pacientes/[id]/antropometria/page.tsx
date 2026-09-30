import { ConfirmarBotao } from '@/components/confirmar-botao';
import { formatarDecimal } from '@/lib/numero';
import { listarAntropometrias } from '@/modules/pacientes/antropometria';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import type { Sexo } from '@/modules/pacientes/formulas';
import { carregarProntuario } from '../prontuario';
import { excluirAntropometriaAction, registrarAntropometriaAction } from './actions';
import { AntropometriaForm } from './antropometria-form';

export const dynamic = 'force-dynamic';

const PROTOCOLO: Record<string, string> = { nenhum: '—', jp3: 'JP 3 dobras', jp7: 'JP 7 dobras' };

export default async function AntropometriaPage({ params }: PageProps<'/painel/pacientes/[id]/antropometria'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const lista = await listarAntropometrias(ctx, paciente.id);
  const bloqueado = paciente.status === 'bloqueado';
  return (
    <div className="space-y-8">
      <section aria-labelledby="nova-avaliacao" className="max-w-3xl space-y-3">
        <h2 id="nova-avaliacao" className="text-lg font-semibold">Nova avaliação</h2>
        <AntropometriaForm
          acao={registrarAntropometriaAction.bind(null, paciente.id)}
          hoje={hojeNoFuso(tenant.fuso)}
          sexo={(paciente.sexo as Sexo | null) ?? null}
          dataNascimento={paciente.dataNascimento}
          somenteLeitura={bloqueado}
        />
      </section>
      <section aria-labelledby="avaliacoes" className="space-y-3">
        <h2 id="avaliacoes" className="text-lg font-semibold">Avaliações</h2>
        {lista.length === 0 ? (
          <p>Nenhuma avaliação registrada.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Avaliações antropométricas, da mais recente para a mais antiga</caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Peso (kg)</th>
                <th scope="col">Altura (cm)</th>
                <th scope="col">IMC</th>
                <th scope="col">% de gordura</th>
                <th scope="col">Protocolo</th>
                {!bloqueado && <th scope="col"><span className="sr-only">Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id} className="border-t">
                  <td>{formatarData(a.data)}</td>
                  <td>{formatarDecimal(a.pesoKg, 2)}</td>
                  <td>{formatarDecimal(a.alturaCm, 1)}</td>
                  <td>{a.imc === null ? '—' : formatarDecimal(a.imc, 2)}</td>
                  <td>{a.percGordura === null ? '—' : formatarDecimal(a.percGordura, 2)}</td>
                  <td>{PROTOCOLO[a.protocolo]}</td>
                  {!bloqueado && (
                    <td>
                      <form action={excluirAntropometriaAction.bind(null, paciente.id, a.id)}>
                        <ConfirmarBotao mensagem="Excluir esta avaliação?" rotulo={`Excluir a avaliação de ${formatarData(a.data)}`}>Excluir</ConfirmarBotao>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
