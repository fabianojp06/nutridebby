import { requireNutri } from '@/lib/tenant-session';
import { Cabecalho } from './cabecalho';

export const dynamic = 'force-dynamic';

export default async function PainelHome() {
  const { data, tenant } = await requireNutri('/painel');
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Painel da nutricionista</h1>
        <p>Conectado como {data.user.email}.</p>
      </main>
    </>
  );
}
