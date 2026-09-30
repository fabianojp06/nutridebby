import { notFound } from 'next/navigation';
import { buscarModelo } from '@/modules/pacientes/anamnese';
import { carregarProntuario } from '../../prontuario';
import { preencherAnamneseAction } from '../actions';
import { AnamneseForm } from '../anamnese-form';

export const dynamic = 'force-dynamic';

export default async function NovaAnamnesePage({
  params,
  searchParams,
}: PageProps<'/painel/pacientes/[id]/anamnese/nova'>) {
  const { id } = await params;
  const { modelo: modeloId } = await searchParams;
  const { ctx, paciente } = await carregarProntuario(id);
  const modelo = typeof modeloId === 'string' ? await buscarModelo(ctx, modeloId) : null;
  if (!modelo) notFound();
  return (
    <section aria-labelledby="nova-anamnese" className="max-w-3xl space-y-3">
      <h2 id="nova-anamnese" className="text-lg font-semibold">
        {modelo.nome}
      </h2>
      <AnamneseForm
        acao={preencherAnamneseAction.bind(null, paciente.id, modelo.id)}
        perguntas={modelo.schema.perguntas}
        inicial={{}}
        botao="Salvar anamnese"
        somenteLeitura={paciente.status === 'bloqueado'}
      />
    </section>
  );
}
