import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ESCOLHER_PATH, SEM_ACESSO_PATH } from '@/lib/paciente-session';
import { requireUser } from '@/lib/session';
import { vinculosDaConta } from '@/modules/portal/vinculos';
import { escolherAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Escolher nutricionista' };

/** D3: conta com mais de um vínculo ativo escolhe com qual nutricionista entrar (fica num cookie por 30 dias). */
export default async function EscolherNutri({ searchParams }: PageProps<'/p/escolher'>) {
  const { user } = await requireUser(['paciente'], ESCOLHER_PATH);
  const vinculos = await vinculosDaConta(user.id);
  if (!vinculos.length) redirect(SEM_ACESSO_PATH);
  const { volta } = await searchParams;
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Com qual nutricionista você quer entrar?</h1>
      <ul className="space-y-3">
        {vinculos.map((v) => (
          <li key={v.tenantId}>
            <form action={escolherAction.bind(null, v.tenantId, typeof volta === 'string' ? volta : '/p/inicio')}>
              <button className="min-h-11 w-full rounded border border-gray-400 px-4 py-3 text-left">{v.nomeNutri}</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
