import { notFound } from 'next/navigation';
import { buscarAnamnese } from '@/modules/pacientes/anamnese';
import { respostaParaCampo } from '@/modules/pacientes/anamnese-tipos';
import { formatarData } from '@/modules/pacientes/datas';
import { carregarProntuario } from '../../prontuario';
import { atualizarAnamneseAction } from '../actions';
import { AnamneseForm } from '../anamnese-form';

export const dynamic = 'force-dynamic';

export default async function AnamnesePage({ params }: PageProps<'/painel/pacientes/[id]/anamnese/[anamneseId]'>) {
  const { id, anamneseId } = await params;
  const { ctx, paciente } = await carregarProntuario(id);
  const a = await buscarAnamnese(ctx, paciente.id, anamneseId);
  if (!a) notFound();
  const inicial = Object.fromEntries(a.templateSnapshot.perguntas.map((p) => [p.id, respostaParaCampo(a.respostas[p.id])]));
  return (
    <section aria-labelledby="anamnese-titulo" className="max-w-3xl space-y-3">
      <h2 id="anamnese-titulo" className="text-lg font-semibold">{`${a.templateSnapshot.nome} · ${formatarData(a.data)}`}</h2>
      <AnamneseForm
        acao={atualizarAnamneseAction.bind(null, paciente.id, a.id)}
        perguntas={a.templateSnapshot.perguntas}
        inicial={inicial}
        botao="Salvar alterações"
        somenteLeitura={paciente.status === 'bloqueado'}
      />
    </section>
  );
}
