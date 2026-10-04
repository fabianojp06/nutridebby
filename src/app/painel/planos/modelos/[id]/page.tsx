import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { requireNutri } from '@/lib/tenant-session';
import { listarReceitasPublicadas } from '@/modules/conteudo/receitas';
import { carregarPlano, paraCliente } from '@/modules/plano-alimentar/carregar';
import { EditorPlano } from '../../editor/editor-plano';
import { excluirModeloAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function ModeloPage({ params }: PageProps<'/painel/planos/modelos/[id]'>) {
  const { id } = await params;
  const { ctx } = await requireNutri(`/painel/planos/modelos/${id}`);
  const modelo = await carregarPlano(ctx, id);
  if (!modelo || !modelo.isTemplate) notFound();
  return (
    <>
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <Link href="/painel/planos/modelos" className="text-sm underline">Voltar aos modelos</Link>
        <h1 className="text-2xl font-semibold">Modelo: {modelo.titulo}</h1>
        <EditorPlano
          plano={paraCliente(modelo)}
          contexto={null}
          receitas={await listarReceitasPublicadas(ctx)}
          acoes={
            <form action={excluirModeloAction.bind(null, modelo.id)}>
              <ConfirmarBotao mensagem="Excluir este modelo? Os planos criados a partir dele não mudam.">Excluir modelo</ConfirmarBotao>
            </form>
          }
        />
      </main>
    </>
  );
}
