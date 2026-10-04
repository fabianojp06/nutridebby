import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { listarModelos } from '@/modules/plano-alimentar/modelos';
import { NovoModelo } from './novo-modelo';

export const dynamic = 'force-dynamic';

export default async function ModelosPage() {
  const { ctx, tenant } = await requireNutri('/painel/planos/modelos');
  const modelos = await listarModelos(ctx);
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
        <h1 className="font-titulo text-2xl font-semibold">Modelos de plano</h1>
        <NovoModelo />
        {modelos.length === 0 ? (
          <p>Nenhum modelo ainda. Crie um aqui ou use &quot;Salvar como modelo&quot; em um plano.</p>
        ) : (
          <ul className="divide-y divide-linha rounded-2xl border border-borda bg-cartao">
            {modelos.map((m) => (
              <li key={m.id} className="flex justify-between p-2">
                <Link href={`/painel/planos/modelos/${m.id}`} className="text-link underline">{m.titulo}</Link>
                <span className="text-sm text-suave">{m.refeicoes} {m.refeicoes === 1 ? 'refeição' : 'refeições'} · alterado em {formatarDataNoFuso(m.atualizadoEm, tenant.fuso)}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
