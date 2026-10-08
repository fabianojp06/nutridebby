import { notFound } from 'next/navigation';
import { CabecalhoDetalhe } from '@/components/portal/cabecalho-detalhe';
import { requirePaciente } from '@/lib/paciente-session';
import { idValido } from '@/modules/pacientes/base';
import { respostasDeHoje } from '@/modules/portal/diario';
import { rotuloDaRefeicao } from '@/modules/portal/diario-constantes';
import { resumoDaRefeicao } from '@/modules/portal/mural-regras';
import { planoDoPaciente } from '@/modules/portal/plano';
import { RefeicaoDetalhe } from '../../refeicao-detalhe';

export const dynamic = 'force-dynamic';

/** Plano 16 (US-193, RN-213): a refeição aberta. Fora do plano publicado do paciente (ou id inválido) → 404. */
export default async function Refeicao({ params }: PageProps<'/p/plano/refeicao/[id]'>) {
  const { id } = await params;
  const { ctx, tenant } = await requirePaciente(`/p/plano/refeicao/${id}`);
  if (!idValido(id)) notFound();
  const plano = await planoDoPaciente(ctx, tenant.fuso);
  const refeicao = plano?.refeicoes.find((r) => r.id === id);
  if (!refeicao) notFound();
  const rotulo = rotuloDaRefeicao(refeicao.nome, refeicao.horario);
  const respondida = (await respostasDeHoje(ctx, tenant.fuso)).has(rotulo);
  const resumo = resumoDaRefeicao(refeicao.itens);
  return (
    <>
      <CabecalhoDetalhe titulo={refeicao.nome} voltar={{ href: '/p/plano', secao: 'Plano' }} />
      <main className="space-y-4 p-4">
        <p>
          <span className="inline-flex rounded-full bg-p-marco px-3 py-1 text-sm font-semibold text-p-marco-texto">{rotulo}</span>
        </p>
        {resumo && <h2 className="font-portal-titulo text-xl font-bold">{resumo.charAt(0).toLocaleUpperCase('pt-BR') + resumo.slice(1)}</h2>}
        <RefeicaoDetalhe refeicao={refeicao} respondida={respondida} />
      </main>
    </>
  );
}
