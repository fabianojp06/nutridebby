import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { quemViu } from '@/modules/conteudo/metricas';

export const dynamic = 'force-dynamic';

/** US-056: a lista de nomes de quem viu (da audiência atual). */
export default async function QuemViu({ params }: PageProps<'/painel/conteudos/[id]/visualizacoes'>) {
  const { id } = await params;
  const { ctx, tenant } = await requireNutri(`/painel/conteudos/${id}/visualizacoes`);
  const r = await quemViu(ctx, id);
  if (!r) notFound();
  return (
    <>
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <Link href={`/painel/conteudos/${id}`} className="text-sm underline">Voltar ao conteúdo</Link>
        <h1 className="text-2xl font-semibold">{`Quem viu: ${r.titulo}`}</h1>
        {r.pessoas.length === 0 ? (
          <p>Ninguém abriu este conteúdo ainda.</p>
        ) : (
          <ul className="divide-y">
            {r.pessoas.map((p, k) => <li key={k} className="py-2">{`${p.nome} — ${quandoComFuso(p.vistoEm, tenant.fuso)}`}</li>)}
          </ul>
        )}
      </main>
    </>
  );
}
