import { requirePaciente } from '@/lib/paciente-session';

export const dynamic = 'force-dynamic';

export default async function MeuAcompanhamento() {
  const { data } = await requirePaciente('/p/inicio');
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Meu acompanhamento</h1>
      <p>Conectado como {data.user.email}.</p>
    </main>
  );
}
