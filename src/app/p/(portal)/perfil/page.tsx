import Link from 'next/link';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { situacaoDoWhatsapp } from '@/modules/portal/perfil';
import { AtivarNotificacoes } from '../../notificacoes';
import { Privacidade } from './privacidade';
import { WhatsappForm } from './whatsapp-form';

export const dynamic = 'force-dynamic';

/** D20: "Perfil" — "Meus documentos" (US-146, só com o D20 do Plano 10A ligado), "Meus exames" (Plano 12, PM-10: só com o recebimento ligado, D18), Notificações (push e WhatsApp), Privacidade (US-046) e "Trocar de nutricionista" (2+ vínculos). */
export default async function Perfil() {
  const { ctx, data, tenant, vinculo, vinculos } = await requirePaciente('/p/perfil');
  const whatsapp = await situacaoDoWhatsapp(ctx);
  return (
    <main className="space-y-8 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Perfil</h1>
      <p>{`Conectado como ${data.user.email}.`}</p>
      {tenant.documentosLiberados && (
        <p>
          <Link href="/p/documentos" className="inline-flex min-h-11 items-center underline">
            Meus documentos
          </Link>
        </p>
      )}
      {tenant.examesPacienteAtivadoEm && (
        <p>
          <Link href="/p/exames" className="inline-flex min-h-11 items-center underline">
            Meus exames
          </Link>
        </p>
      )}
      <section aria-labelledby="notificacoes" className="space-y-3">
        <h2 id="notificacoes" className="text-lg font-semibold">
          Notificações
        </h2>
        <AtivarNotificacoes chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} dono={vinculo.patientId} />
        <WhatsappForm ativo={whatsapp.ativo} />
      </section>
      <section aria-labelledby="privacidade" className="space-y-3">
        <h2 id="privacidade" className="text-lg font-semibold">
          Privacidade
        </h2>
        <Privacidade />
      </section>
      {vinculos.length > 1 && (
        <p>
          <Link href="/p/escolher?volta=%2Fp%2Finicio" className="inline-flex min-h-11 items-center underline">
            Trocar de nutricionista
          </Link>
        </p>
      )}
    </main>
  );
}
