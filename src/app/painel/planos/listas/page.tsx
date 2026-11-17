import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_LISTAS } from '@/modules/plano-alimentar/biblioteca-constantes';
import { listarListas } from '@/modules/plano-alimentar/listas';

export const dynamic = 'force-dynamic';

/** US-238: as listas de substituição do consultório. A plataforma não traz listas prontas (RN-251): começa vazia. */
export default async function ListasPage() {
  const { ctx } = await requireNutri('/painel/planos/listas');
  const listas = await listarListas(ctx);
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">{MSG_LISTAS.titulo}</h1>
      <p className="text-suave">{MSG_LISTAS.descricao}</p>
      <Link href="/painel/planos/listas/novo" className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">
        {MSG_LISTAS.nova}
      </Link>
      {listas.length === 0 ? (
        <p>{MSG_LISTAS.vazio}</p>
      ) : (
        <ul className="divide-y divide-linha rounded-2xl border border-borda bg-cartao">
          {listas.map((l) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-2 p-2">
              <Link href={`/painel/planos/listas/${l.id}`} className="inline-flex min-h-11 items-center text-link underline">{l.nome}</Link>
              <span className="text-sm text-suave">{MSG_LISTAS.contagem(l.grupos, l.itens)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
