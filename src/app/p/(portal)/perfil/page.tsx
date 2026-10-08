import Link from 'next/link';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { situacaoDoWhatsapp } from '@/modules/portal/perfil';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { AtivarNotificacoes } from '../../notificacoes';
import { Privacidade } from './privacidade';
import { WhatsappForm } from './whatsapp-form';
import { molduraDaSecao } from '../../moldura';
import { SairPortal } from '../../sair-portal';

export const dynamic = 'force-dynamic';

/** D20: "Eu" (antes "Perfil"; Plano 16, RN-190) — "Meus documentos" (US-146, só com o D20 do Plano 10A ligado), "Meus exames" (Plano 12, PM-10: só com o recebimento ligado, D18), Notificações (push e WhatsApp), Privacidade (US-046), "Trocar de nutricionista" (2+ vínculos) e, por último, o "Sair" (RN-211). */
export default async function Perfil() {
  const acesso = await requirePaciente('/p/perfil');
  const { ctx, data, tenant, vinculo, vinculos } = acesso;
  const moldura = await molduraDaSecao(acesso);
  const whatsapp = await situacaoDoWhatsapp(ctx);
  return (
    <>
      <Faixa {...moldura} atual="/p/perfil" titulo={MSG_G.titulos.eu} />
      <main className="space-y-8 p-6">
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
        {/* RN-211: o "Sair" do portal fica no fim de "Eu" */}
        <p>
          <SairPortal />
        </p>
      </main>
    </>
  );
}
