import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatarDecimal } from '@/lib/numero';
import { requireNutri } from '@/lib/tenant-session';
import { carregarAlimento } from '@/modules/alimentos/alimentos';
import { MSG_ALIMENTO } from '@/modules/alimentos/alimentos-constantes';
import { editarAlimentoAction } from '../../actions';
import { AlimentoForm } from '../../alimento-form';

export const dynamic = 'force-dynamic';

const txt = (v: number | null) => (v === null ? '' : formatarDecimal(v, v % 1 ? 2 : 0));

export default async function EditarAlimentoPage({ params, searchParams }: PageProps<'/painel/alimentos/[id]/editar'>) {
  const { id } = await params;
  const { incompleto } = await searchParams;
  const { ctx } = await requireNutri(`/painel/alimentos/${id}/editar`);
  const a = await carregarAlimento(ctx, id);
  if (!a || a.origem === 'TACO') notFound();
  return (
    <>
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <Link href={`/painel/alimentos/${a.id}`} className="text-sm underline">Voltar</Link>
        <h1 className="text-2xl font-semibold">Editar meu alimento</h1>
        {incompleto === '1' && <p role="status" className="rounded bg-amber-50 p-3">{MSG_ALIMENTO.incompleto}</p>}
        <AlimentoForm
          acao={editarAlimentoAction.bind(null, a.id)}
          inicial={{ nome: a.nome, grupo: a.grupo, kcal: txt(a.porCem.kcal), proteinaG: txt(a.porCem.proteinaG), carboidratoG: txt(a.porCem.carboidratoG), lipidioG: txt(a.porCem.lipidioG), fibraG: txt(a.porCem.fibraG) }}
          rotuloBotao="Salvar alterações"
        />
      </main>
    </>
  );
}
