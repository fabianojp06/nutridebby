import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const { user } = await requireUser(['admin'], '/admin');
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Administração</h1>
      <p>Conectado como {user.email}.</p>
    </main>
  );
}
