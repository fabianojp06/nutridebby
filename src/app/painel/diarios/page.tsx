import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { quandoComFuso } from '@/modules/agenda/fuso';
import { feedDeDiarios, MSG_COMENTARIO } from '@/modules/portal/diario-nutri';

export const dynamic = 'force-dynamic';

export default async function Diarios() {
  const { ctx, tenant } = await requireNutri('/painel/diarios');
  const feed = await feedDeDiarios(ctx);
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <h1 className="font-titulo text-2xl font-semibold">Diários</h1>
        {feed.length === 0 ? (
          <p>{MSG_COMENTARIO.nenhum}</p>
        ) : (
          <ul className="divide-y divide-linha">
            {feed.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2">
                <span className={f.visto ? 'rounded border border-borda px-2 text-sm' : 'rounded bg-aviso-fundo px-2 text-sm font-semibold text-aviso'}>{f.visto ? 'Visto' : 'Novo'}</span>
                <Link href={`/painel/diarios/${f.id}`} className="text-link underline">{`${f.paciente} — ${f.refeicao} · ${quandoComFuso(f.dataHora, tenant.fuso)}`}</Link>
                {f.comentario && <span className="text-sm text-suave">Comentado</span>}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
