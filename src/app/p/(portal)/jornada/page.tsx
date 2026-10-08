import Link from 'next/link';
import { Faixa } from '@/components/portal/faixa';
import { requirePaciente } from '@/lib/paciente-session';
import { GraficoLinha } from '@/modules/pacientes/ui/grafico-linha';
import { jornadaDoPaciente } from '@/modules/portal/jornada';
import { MSG_JORNADA } from '@/modules/portal/jornada-regras';
import { molduraDaSecao } from '../../moldura';
import { LinhaDoTempo } from './linha-do-tempo';

export const dynamic = 'force-dynamic';

const BOTAO = 'inline-flex min-h-11 items-center rounded-full border border-borda bg-cartao px-4 font-semibold';

/**
 * Plano 16 (US-194, RN-190): a seção Jornada — o gráfico de peso nas consultas (ou de cintura, com o peso visível e menos
 * de 2 pesos; com o peso oculto, sem gráfico — G-D16 a; nenhuma mensagem sobre o peso faltar) e a linha do tempo. "Todas
 * as medidas" e "Minhas consultas" ficam a um toque (§4.10).
 */
export default async function Jornada() {
  const acesso = await requirePaciente('/p/jornada');
  const { ctx, tenant } = acesso;
  const [moldura, j] = await Promise.all([molduraDaSecao(acesso), jornadaDoPaciente(ctx, tenant, new Date())]);
  return (
    <>
      <Faixa {...moldura} atual="/p/jornada" titulo={j.titulo} />
      <main className="space-y-6 p-4">
        {/* título visível (§4.5, GV-Jornada): o <title> do SVG não aparece no celular, e o gráfico pode ser de cintura (G-D16 a) */}
        {j.grafico && (
          <section aria-labelledby="grafico-jornada-h" className="space-y-2">
            <h2 id="grafico-jornada-h" className="font-portal-titulo text-lg font-bold">{j.grafico.rotulo}</h2>
            <GraficoLinha id="grafico-jornada" titulo={j.grafico.rotulo} unidade={j.grafico.unidade} casas={j.grafico.casas} pontos={j.grafico.pontos} />
          </section>
        )}
        <p className="flex flex-wrap gap-2">
          <Link href="/p/evolucao" className={BOTAO}>{MSG_JORNADA.todasAsMedidas}</Link>
          <Link href="/p/agenda" className={BOTAO}>{MSG_JORNADA.minhasConsultas}</Link>
          {j.podeAgendar && <Link href="/p/agenda/nova" className={BOTAO}>{MSG_JORNADA.agendar}</Link>}
        </p>
        {j.vazia ? <p>{MSG_JORNADA.comeca}</p> : <LinhaDoTempo marcos={j.marcos} fuso={tenant.fuso} />}
      </main>
    </>
  );
}
