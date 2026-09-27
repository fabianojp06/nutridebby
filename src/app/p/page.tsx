import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MeuAcompanhamento() {
  const { user } = await requireUser(['paciente'], '/p');
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Meu acompanhamento</h1>
      <p>Conectado como {user.email}.</p>
    </main>
  );
}
