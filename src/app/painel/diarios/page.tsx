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
      <main className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Diários</h1>
        {feed.length === 0 ? (
          <p>{MSG_COMENTARIO.nenhum}</p>
        ) : (
          <ul className="divide-y">
            {feed.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2">
                <span className={f.visto ? 'rounded border px-2 text-sm' : 'rounded bg-amber-200 px-2 text-sm font-semibold'}>{f.visto ? 'Visto' : 'Novo'}</span>
                <Link href={`/painel/diarios/${f.id}`} className="underline">{`${f.paciente} — ${f.refeicao} · ${quandoComFuso(f.dataHora, tenant.fuso)}`}</Link>
                {f.comentario && <span className="text-sm text-gray-600">Comentado</span>}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
