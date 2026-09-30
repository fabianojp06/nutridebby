import { formatarDecimal } from '@/lib/numero';
import { formatarData } from '@/modules/pacientes/datas';
import { casasDoMarcador, evolucaoDoPaciente, MSG_POUCOS_DADOS } from '@/modules/pacientes/evolucao';
import { GraficoLinha } from '@/modules/pacientes/ui/grafico-linha';
import { carregarProntuario } from '../prontuario';

export const dynamic = 'force-dynamic';

export default async function EvolucaoPage({ params }: PageProps<'/painel/pacientes/[id]/evolucao'>) {
  const { id } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const e = await evolucaoDoPaciente(ctx, paciente.id);
  return (
    <div className="space-y-10">
      <section aria-labelledby="evolucao-medidas" className="space-y-4">
        <h2 id="evolucao-medidas" className="text-lg font-semibold">Medidas</h2>
        {e.avaliacoes < 2 ? (
          <p>{MSG_POUCOS_DADOS}</p>
        ) : (
          <>
            <table className="w-full max-w-2xl text-left text-sm">
              <caption className="text-left font-medium">Diferença entre o primeiro e o último registro</caption>
              <thead>
                <tr>
                  <th scope="col">Medida</th>
                  <th scope="col">Primeiro</th>
                  <th scope="col">Último</th>
                  <th scope="col">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {e.diferencas.map((d) => {
                  const { casas } = d;
                  return (
                    <tr key={d.rotulo} className="border-t">
                      <th scope="row" className="font-normal">{d.rotulo}</th>
                      <td>{`${formatarDecimal(d.primeiro.valor, casas)} (${formatarData(d.primeiro.data)})`}</td>
                      <td>{`${formatarDecimal(d.ultimo.valor, casas)} (${formatarData(d.ultimo.data)})`}</td>
                      <td>{d.texto}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="grid gap-6 lg:grid-cols-2">
              {e.series.filter((s) => s.pontos.length >= 2).map((s) => (
                <GraficoLinha key={s.id} id={`serie-${s.id}`} titulo={s.rotulo} unidade={s.unidade} casas={s.casas} pontos={s.pontos} />
              ))}
            </div>
          </>
        )}
      </section>
      <section aria-labelledby="evolucao-exames" className="space-y-4">
        <h2 id="evolucao-exames" className="text-lg font-semibold">Exames</h2>
        {e.marcadores.length === 0 ? (
          <p>Nenhum valor de exame lançado.</p>
        ) : (
          <>
            <nav aria-label="Marcadores de exame">
              <ul className="flex flex-wrap gap-3 text-sm">
                {e.marcadores.map((m, i) => <li key={`${m.nome}-${m.unidade ?? ''}`}><a href={`#marcador-${i}`} className="underline">{m.unidade ? `${m.nome} (${m.unidade})` : m.nome}</a></li>)}
              </ul>
            </nav>
            {e.marcadores.map((m, i) => (
              <div key={`${m.nome}-${m.unidade ?? ''}`} id={`marcador-${i}`} className="space-y-2">
                <h3 className="font-semibold">{m.unidade ? `${m.nome} (${m.unidade})` : m.nome}</h3>
                {m.pontos.length >= 2 ? (
                  <GraficoLinha id={`marcador-grafico-${i}`} titulo={m.nome} unidade={m.unidade ?? ''} casas={casasDoMarcador(m.pontos)} pontos={m.pontos} />
                ) : (
                  <p>{`${formatarData(m.pontos[0].data)}: ${formatarDecimal(m.pontos[0].valor, casasDoMarcador(m.pontos))}${m.unidade ? ` ${m.unidade}` : ''}`}</p>
                )}
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
