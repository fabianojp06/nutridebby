import { requireNutri } from '@/lib/tenant-session';
import { salvarModeloAction } from '../actions';
import { ModeloEditor } from '../modelo-editor';

export const dynamic = 'force-dynamic';

export default async function NovoModeloPage() {
  await requireNutri('/painel/anamnese/modelos/novo');
  return (
    <>
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Novo modelo de anamnese</h1>
        <ModeloEditor acao={salvarModeloAction.bind(null, null)} inicial={{ nome: '', perguntas: [] }} />
      </main>
    </>
  );
}
