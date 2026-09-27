import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function PainelHome() {
  const { user } = await requireUser(['nutri'], '/painel');
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Painel da nutricionista</h1>
      <p>Conectado como {user.email}.</p>
    </main>
  );
}
