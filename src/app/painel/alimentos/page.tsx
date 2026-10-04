import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { FONTE_TACO_TEXTO } from '@/modules/alimentos/taco';
import { BuscaAlimento } from './busca-alimento';

export const dynamic = 'force-dynamic';

export default async function AlimentosPage() {
  await requireNutri('/painel/alimentos');
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-titulo text-2xl font-semibold">Alimentos</h1>
          <Link href="/painel/alimentos/novo" className="rounded-full bg-destaque font-semibold px-4 py-2 text-white">Cadastrar meu alimento</Link>
        </div>
        <BuscaAlimento />
        <p className="text-sm text-suave">Fonte: {FONTE_TACO_TEXTO}. Valores por 100 g.</p>
      </main>
    </>
  );
}
