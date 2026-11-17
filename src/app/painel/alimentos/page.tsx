import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { fontesCarregadas } from '@/modules/alimentos/alimentos';
import { textoDaCitacao } from '@/modules/alimentos/fontes';
import { BuscaAlimento } from './busca-alimento';

export const dynamic = 'force-dynamic';

export default async function AlimentosPage() {
  const { ctx } = await requireNutri('/painel/alimentos');
  const fontes = await fontesCarregadas(ctx);
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-titulo text-2xl font-semibold">Alimentos</h1>
          <Link href="/painel/alimentos/novo" className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Cadastrar meu alimento</Link>
        </div>
        <div data-guia="busca-alimentos"><BuscaAlimento /></div>
        {/* RN-233: a tela de alimentos cita cada tabela pública carregada, uma por linha */}
        <div className="space-y-1 text-sm text-suave">
          {fontes.map((f) => <p key={f}>{textoDaCitacao(f)}</p>)}
          <p>Valores por 100 g.</p>
        </div>
      </main>
    </>
  );
}
