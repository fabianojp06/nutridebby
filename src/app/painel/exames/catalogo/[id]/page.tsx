import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { abrirExameDoCatalogo } from '@/modules/exames/catalogo';
import { salvarExameDoCatalogoAction } from '../actions';
import { ExameCatalogoForm } from '../exame-catalogo-form';
import { ExcluirDoCatalogo } from '../excluir-do-catalogo';
import { exameParaFormulario } from '../../valores';

export const dynamic = 'force-dynamic';

const ID_DO_TITULO = 'titulo-exame-catalogo';

/** Plano 22 (T3, US-370): o exame do catálogo — h1 com o nome, o formulário e "Excluir" (com a confirmação). */
export default async function ExameDoCatalogoPage({ params }: PageProps<'/painel/exames/catalogo/[id]'>) {
  const { id } = await params;
  const { ctx } = await requireNutri(`/painel/exames/catalogo/${id}`);
  const exame = await abrirExameDoCatalogo(ctx, id);
  if (!exame) notFound();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={ID_DO_TITULO} tabIndex={-1} className="font-titulo text-2xl font-semibold">
          {exame.nome}
        </h1>
        <ExcluirDoCatalogo id={exame.id} nome={exame.nome} idTitulo={ID_DO_TITULO} />
      </div>
      <ExameCatalogoForm acao={salvarExameDoCatalogoAction.bind(null, exame.id)} inicial={exameParaFormulario(exame)} />
    </>
  );
}
