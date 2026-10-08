import Link from 'next/link';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { requirePaciente } from '@/lib/paciente-session';
import { molduraDaSecao } from '../../moldura';

export const dynamic = 'force-dynamic';

/** Plano 16 (RN-190): a seção Jornada. Esqueleto da T4 — a T12 traz o gráfico e a linha do tempo. */
export default async function Jornada() {
  const acesso = await requirePaciente('/p/jornada');
  const moldura = await molduraDaSecao(acesso);
  return (
    <>
      <Faixa {...moldura} atual="/p/jornada" titulo={MSG_G.titulos.jornada} />
      <main className="space-y-4 p-6">
        <p><Link href="/p/evolucao" className="inline-flex min-h-11 items-center underline">Todas as medidas</Link></p>
        <p><Link href="/p/agenda" className="inline-flex min-h-11 items-center underline">Minhas consultas</Link></p>
      </main>
    </>
  );
}
