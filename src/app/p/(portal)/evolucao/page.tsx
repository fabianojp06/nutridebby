import { requirePaciente } from '@/lib/paciente-session';
import { formatarDecimal } from '@/lib/numero';
import { formatarData } from '@/modules/pacientes/datas';
import { MSG_POUCOS_DADOS } from '@/modules/pacientes/evolucao';
import { GraficoLinha } from '@/modules/pacientes/ui/grafico-linha';
import { evolucaoParaPaciente } from '@/modules/portal/evolucao';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';

export const dynamic = 'force-dynamic';

export default async function MinhaEvolucao() {
  const { ctx, tenant } = await requirePaciente('/p/evolucao');
  const e = await evolucaoParaPaciente(ctx, tenant);
  return (
    <>
      <CabecalhoDetalhe titulo="Todas as medidas" voltar={{ href: '/p/jornada', secao: 'Jornada' }} />
      <main className="space-y-8 p-6">
        <section aria-labelledby="medidas" className="space-y-4">
          <h2 id="medidas" className="text-lg font-semibold">Medidas</h2>
          {/* menos de 2 avaliações, ou 2+ sem nenhuma medida repetida (ex.: peso numa, cintura noutra): nada a comparar */}
          {e.diferencas.length === 0 ? (
            <p>{MSG_POUCOS_DADOS}</p>
          ) : (
            <>
              <ul className="space-y-1">
                {e.diferencas.map((d) => (
                  <li key={d.rotulo}>{`${d.rotulo}: ${formatarDecimal(d.primeiro.valor, d.casas)} (${formatarData(d.primeiro.data)}) → ${formatarDecimal(d.ultimo.valor, d.casas)} (${formatarData(d.ultimo.data)}) · ${d.texto}`}</li>
                ))}
              </ul>
              {e.series.filter((s) => s.pontos.length >= 2).map((s) => (
                <GraficoLinha key={s.id} id={`serie-${s.id}`} titulo={s.rotulo} unidade={s.unidade} casas={s.casas} pontos={s.pontos} />
              ))}
            </>
          )}
        </section>
        <section aria-labelledby="orientacoes" className="space-y-2">
          <h2 id="orientacoes" className="text-lg font-semibold">Orientações recebidas</h2>
          {e.orientacoes.length === 0 ? (
            <p>Nenhuma orientação registrada ainda.</p>
          ) : (
            <ol className="space-y-3">
              {e.orientacoes.map((o) => (
                <li key={`${o.data}-${o.orientacoes.slice(0, 20)}`}>
                  <p className="font-medium">{formatarData(o.data)}</p>
                  <p className="whitespace-pre-line">{o.orientacoes}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
    </>
  );
}
