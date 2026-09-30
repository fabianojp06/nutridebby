import { requireNutri } from '@/lib/tenant-session';
import { Cabecalho } from '../../../cabecalho';
import { salvarModeloAction } from '../actions';
import { ModeloEditor } from '../modelo-editor';

export const dynamic = 'force-dynamic';

export default async function NovoModeloPage() {
  const { tenant } = await requireNutri('/painel/anamnese/modelos/novo');
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Novo modelo de anamnese</h1>
        <ModeloEditor acao={salvarModeloAction.bind(null, null)} inicial={{ nome: '', perguntas: [] }} />
      </main>
    </>
  );
}
