import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { buscarModelo } from '@/modules/pacientes/anamnese';
import { salvarModeloAction } from '../actions';
import { ModeloEditor } from '../modelo-editor';

export const dynamic = 'force-dynamic';

export default async function EditarModeloPage({ params }: PageProps<'/painel/anamnese/modelos/[modeloId]'>) {
  const { modeloId } = await params;
  const { ctx } = await requireNutri(`/painel/anamnese/modelos/${modeloId}`);
  const modelo = await buscarModelo(ctx, modeloId);
  if (!modelo) notFound();
  return (
    <>
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Editar modelo de anamnese</h1>
        <p className="text-sm text-zinc-700">As anamneses já preenchidas continuam com as perguntas de quando foram respondidas.</p>
        <ModeloEditor acao={salvarModeloAction.bind(null, modelo.id)} inicial={{ nome: modelo.nome, perguntas: modelo.schema.perguntas }} />
      </main>
    </>
  );
}
