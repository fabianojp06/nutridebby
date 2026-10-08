import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { requirePaciente } from '@/lib/paciente-session';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { MSG_POUCOS_DADOS } from '@/modules/pacientes/evolucao';
import { GraficoLinha } from '@/modules/pacientes/ui/grafico-linha';
import { mesPorExtenso } from '@/modules/portal/datas-portal';
import { evolucaoParaPaciente } from '@/modules/portal/evolucao';
import { TabelaMedidas } from './tabela-medidas';

export const dynamic = 'force-dynamic';

/**
 * Plano 16 (US-194, molde F-Medidas): "Todas as medidas", a um toque da Jornada — a tabela por avaliação e os gráficos de
 * cada medida repetida. As orientações moram na Jornada.
 */
export default async function TodasAsMedidas() {
  const { ctx, tenant } = await requirePaciente('/p/evolucao');
  const e = await evolucaoParaPaciente(ctx, tenant);
  const primeira = e.series.flatMap((s) => s.pontos.map((p) => p.data)).sort()[0];
  return (
    <>
      <CabecalhoDetalhe titulo="Todas as medidas" voltar={{ href: '/p/jornada', secao: 'Jornada' }} />
      <main className="space-y-8 p-4">
        {/* menos de 2 avaliações, ou 2+ sem nenhuma medida repetida: nada a comparar */}
        {e.diferencas.length === 0 ? (
          <p>{MSG_POUCOS_DADOS}</p>
        ) : (
          <>
            <TabelaMedidas series={e.series} diferencas={e.diferencas} desde={mesPorExtenso(primeira, hojeNoFuso(tenant.fuso))} />
            {/* cada gráfico com o título visível (o <title> do SVG não aparece no celular) */}
            {e.series.filter((s) => s.pontos.length >= 2).map((s) => (
              <section key={s.id} aria-labelledby={`serie-${s.id}-h`} className="space-y-2">
                <h2 id={`serie-${s.id}-h`} className="font-portal-titulo text-lg font-bold">{s.unidade ? `${s.rotulo} (${s.unidade})` : s.rotulo}</h2>
                <GraficoLinha id={`serie-${s.id}`} titulo={s.rotulo} unidade={s.unidade} casas={s.casas} pontos={s.pontos} />
              </section>
            ))}
          </>
        )}
      </main>
    </>
  );
}
