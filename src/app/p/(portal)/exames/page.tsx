import { requirePaciente } from '@/lib/paciente-session';
import { formatarData, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { MSG_ENVIO, nomeDoEnvio } from '@/modules/pacientes/exames-enviados-constantes';
import { meusEnvios } from '@/modules/portal/exames-enviados';
import { CancelarEnvio } from './cancelar-envio';
import { EnvioForm } from './envio-form';

export const dynamic = 'force-dynamic';

/**
 * US-160 / US-161 (PM-10 = molde de "Documentos"): "Meus exames" — não é aba; marca "Perfil" (`tambem`). O formulário só
 * com o recebimento ligado (D18 = a); a lista continua (os envios antigos). Fora da cópia offline (o service worker só
 * guarda /p/plano). A lista é auditada no módulo (D22).
 */
export default async function MeusExames() {
  const { ctx, tenant } = await requirePaciente('/p/exames');
  const lista = await meusEnvios(ctx);
  const data = (d: Date) => formatarDataNoFuso(d, tenant.fuso);
  return (
    <main className="space-y-6 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Meus exames</h1>
      {tenant.examesPacienteAtivadoEm && (
        <section aria-labelledby="enviar" className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
          <h2 id="enviar" className="text-lg font-semibold">Enviar exame</h2>
          <EnvioForm hoje={hojeNoFuso(tenant.fuso)} />
        </section>
      )}
      <section aria-labelledby="enviados" className="space-y-3">
        <h2 id="enviados" className="text-lg font-semibold">Meus exames enviados</h2>
        {lista.length === 0 && <p>{MSG_ENVIO.nenhum}</p>}
        <ul className="space-y-4">
          {lista.map((e) => {
            const nome = nomeDoEnvio(e.nome, data(e.enviadoEm));
            return (
              <li key={e.id} className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
                <h3 className="font-semibold">{nome}</h3>
                <p className="text-sm text-suave">{`Enviado em ${data(e.enviadoEm)} · Coleta em ${formatarData(e.dataColeta)}`}</p>
                <p>{e.situacao}</p>
                {e.podeBaixar && (
                  <a href={`/api/p/exames/${e.id}/pdf`} className="inline-flex min-h-11 items-center underline">
                    Baixar PDF<span className="sr-only">{` do ${nome}`}</span>
                  </a>
                )}
                {e.mostraCancelar && <CancelarEnvio id={e.id} processando={e.status === 'processando'} rotulo={`do ${nome}`} />}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
