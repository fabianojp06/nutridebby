import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { Instalar } from '../../instalar';
import { AtivarNotificacoes } from '../../notificacoes';

export const dynamic = 'force-dynamic';

export default async function MeuAcompanhamento() {
  const { data, vinculo } = await requirePaciente('/p/inicio');
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Meu acompanhamento</h1>
      <Instalar />
      <AtivarNotificacoes chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} dono={vinculo.patientId} />
      <p>Conectado como {data.user.email}.</p>
    </main>
  );
}
