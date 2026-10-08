import { getEnv } from '@/env';
import Link from 'next/link';
import { requirePaciente } from '@/lib/paciente-session';
import { formatarQuando, quandoComFuso } from '@/modules/agenda/fuso';
import { novosNoPortal } from '@/modules/documentos/portal';
import { consultasDoPaciente } from '@/modules/portal/agenda';
import { BarraDeAcoes } from '@/components/portal/barra-de-acoes';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { dataDaFaixa } from '@/modules/portal/datas-portal';
import { primeiroNomeDoPaciente } from '@/modules/portal/perfil';
import { Instalar } from '../../instalar';
import { AtivarNotificacoes } from '../../notificacoes';
import { QuandoLocal } from '../../quando-local';
import { molduraDaSecao } from '../../moldura';

export const dynamic = 'force-dynamic';

export default async function MeuAcompanhamento() {
  const acesso = await requirePaciente('/p/inicio');
  const { data, vinculo, ctx, tenant } = acesso;
  const moldura = await molduraDaSecao(acesso);
  const consultas = await consultasDoPaciente(ctx, tenant, new Date());
  const proxima = consultas.proximas[0];
  // US-146: o cartão "Documentos" só com documento assinado ainda não aberto (D20: desligado, nem consulta)
  const novos = tenant.documentosLiberados ? await novosNoPortal(ctx) : 0;
  return (
    <>
      <Faixa {...moldura} atual="/p/inicio" titulo={MSG_G.titulos.hoje(await primeiroNomeDoPaciente(ctx))} subtitulo={dataDaFaixa(hojeNoFuso(tenant.fuso))} />
      <main className="space-y-4 p-6">
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
        <Instalar />
        <AtivarNotificacoes chavePublica={getEnv().VAPID_PUBLIC_KEY ?? null} dono={vinculo.patientId} />
        <p>Conectado como {data.user.email}.</p>
      </main>
      {/* US-160 / PM-10: "Enviar exame" só com o recebimento ligado pela nutricionista (D18 = a, RN-215) */}
      <BarraDeAcoes exames={Boolean(tenant.examesPacienteAtivadoEm)} podeAgendar={consultas.podeAgendar} />
    </>
  );
}
