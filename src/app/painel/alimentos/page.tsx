import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { FONTE_TACO_TEXTO } from '@/modules/alimentos/taco';
import { Cabecalho } from '../cabecalho';
import { BuscaAlimento } from './busca-alimento';

export const dynamic = 'force-dynamic';

export default async function AlimentosPage() {
  const { tenant } = await requireNutri('/painel/alimentos');
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold">Alimentos</h1>
          <Link href="/painel/alimentos/novo" className="rounded bg-emerald-700 px-4 py-2 text-white">Cadastrar meu alimento</Link>
        </div>
        <BuscaAlimento />
        <p className="text-sm text-zinc-600">Fonte: {FONTE_TACO_TEXTO}. Valores por 100 g.</p>
      </main>
    </>
  );
}
