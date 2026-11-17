import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { listarReferencias } from '@/modules/alimentos/referencias';
import { MSG_REFERENCIAS } from '@/modules/alimentos/referencias-constantes';

export const dynamic = 'force-dynamic';

/** US-232: os perfis de referência do consultório. A plataforma não traz perfil pronto (D11): a lista começa vazia. */
export default async function ReferenciasPage() {
  const { ctx } = await requireNutri('/painel/planos/referencias');
  const perfis = await listarReferencias(ctx);
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">{MSG_REFERENCIAS.titulo}</h1>
      <p className="text-suave">{MSG_REFERENCIAS.descricao}</p>
      <Link href="/painel/planos/referencias/novo" className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">
        {MSG_REFERENCIAS.novo}
      </Link>
      {perfis.length === 0 ? (
        <p>{MSG_REFERENCIAS.vazio}</p>
      ) : (
        <ul className="divide-y divide-linha rounded-2xl border border-borda bg-cartao">
          {perfis.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2 p-2">
              <Link href={`/painel/planos/referencias/${p.id}`} className="inline-flex min-h-11 items-center text-link underline">{p.nome}</Link>
              {/* R-242: a fonte sempre junto, para o perfil não passar por dado "oficial" da plataforma */}
              <span className="text-sm text-suave">{MSG_REFERENCIAS.contagem(p.nutrientes)} · {p.fonte}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
