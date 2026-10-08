import { getEnv } from '@/env';
import Link from 'next/link';
import { BotaoLink } from '@/components/ui/botao';
import { requirePaciente } from '@/lib/paciente-session';
import { formatarQuando, quandoComFuso } from '@/modules/agenda/fuso';
import { novosNoPortal } from '@/modules/documentos/portal';
import { consultasDoPaciente } from '@/modules/portal/agenda';
import { Instalar } from '../../instalar';
import { AtivarNotificacoes } from '../../notificacoes';
import { QuandoLocal } from '../../quando-local';

export const dynamic = 'force-dynamic';

export default async function MeuAcompanhamento() {
  const { data, vinculo, ctx, tenant } = await requirePaciente('/p/inicio');
  const proxima = (await consultasDoPaciente(ctx, tenant, new Date())).proximas[0];
  // US-146: o cartão "Documentos" só com documento assinado ainda não aberto (D20: desligado, nem consulta)
  const novos = tenant.documentosLiberados ? await novosNoPortal(ctx) : 0;
  return (
    <main className="space-y-4 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Meu acompanhamento</h1>
      {proxima && (
        <p>
          Próxima consulta:{' '}
          <Link href={`/p/agenda/${proxima.id}`} className="inline-flex min-h-11 items-center underline">
            <QuandoLocal semFuso={formatarQuando(proxima.inicio, tenant.fuso)} comFuso={quandoComFuso(proxima.inicio, tenant.fuso)} fuso={tenant.fuso} />
          </Link>
        </p>
      )}
      {novos > 0 && (
        <section aria-labelledby="documentos" className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
          <h2 id="documentos" className="font-semibold">
            Documentos
          </h2>
          <p>{novos === 1 ? '1 documento novo' : `${novos} documentos novos`}</p>
          <Link href="/p/documentos" className="inline-flex min-h-11 items-center underline">
            Ver documentos
          </Link>
        </section>
      )}
      {/* US-160 / PM-10: só com o recebimento ligado pela nutricionista (D18 = a) */}
      {tenant.examesPacienteAtivadoEm && (
        <p>
          <BotaoLink href="/p/exames" variante="secundario">Enviar exame</BotaoLink>
        </p>
      )}
      <Instalar />
      <AtivarNotificacoes chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} dono={vinculo.patientId} />
      <p>Conectado como {data.user.email}.</p>
    </main>
  );
}
