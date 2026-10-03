import { getEnv } from '@/env';
import Link from 'next/link';
import { requirePaciente } from '@/lib/paciente-session';
import { formatarQuando, quandoComFuso } from '@/modules/agenda/fuso';
import { consultasDoPaciente } from '@/modules/portal/agenda';
import { Instalar } from '../../instalar';
import { AtivarNotificacoes } from '../../notificacoes';
import { QuandoLocal } from '../../quando-local';

export const dynamic = 'force-dynamic';

export default async function MeuAcompanhamento() {
  const { data, vinculo, ctx, tenant } = await requirePaciente('/p/inicio');
  const proxima = (await consultasDoPaciente(ctx, tenant, new Date())).proximas[0];
  return (
    <main className="space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Meu acompanhamento</h1>
      {proxima && (
        <p>
          Próxima consulta:{' '}
          <Link href={`/p/agenda/${proxima.id}`} className="underline">
            <QuandoLocal semFuso={formatarQuando(proxima.inicio, tenant.fuso)} comFuso={quandoComFuso(proxima.inicio, tenant.fuso)} fuso={tenant.fuso} />
          </Link>
        </p>
      )}
      <Instalar />
      <AtivarNotificacoes chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} dono={vinculo.patientId} />
      <p>Conectado como {data.user.email}.</p>
    </main>
  );
}
