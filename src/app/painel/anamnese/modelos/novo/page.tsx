import { requireNutri } from '@/lib/tenant-session';
import { salvarModeloAction } from '../actions';
import { ModeloEditor } from '../modelo-editor';

export const dynamic = 'force-dynamic';

export default async function NovoModeloPage() {
  await requireNutri('/painel/anamnese/modelos/novo');
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <h1 className="font-titulo text-2xl font-semibold">Novo modelo de anamnese</h1>
        <ModeloEditor acao={salvarModeloAction.bind(null, null)} inicial={{ nome: '', perguntas: [] }} />
      </main>
    </>
  );
}
