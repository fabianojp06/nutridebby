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
          <Link href="/painel/alimentos/novo" className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Cadastrar meu alimento</Link>
        </div>
        <div data-guia="busca-alimentos"><BuscaAlimento /></div>
        <p className="text-sm text-suave">Fonte: {FONTE_TACO_TEXTO}. Valores por 100 g.</p>
      </main>
    </>
  );
}
