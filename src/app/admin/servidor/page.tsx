import { requireUser } from '@/lib/session';
import { PainelInfra } from '../painel-infra';

export const dynamic = 'force-dynamic';

/** P16-17: a aba "Servidor" — o último backup de cada tipo (RNF-05) e o uso do disco (RNF-13). */
export default async function ServidorPage() {
  await requireUser(['admin'], '/admin/servidor');
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
      <h1 className="font-titulo text-2xl font-semibold">Servidor</h1>
      <div className="max-w-2xl">
        <PainelInfra />
      </div>
    </main>
  );
}
