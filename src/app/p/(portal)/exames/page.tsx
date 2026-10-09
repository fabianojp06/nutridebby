import { requirePaciente } from '@/lib/paciente-session';
import { formatarData, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { MSG_ENVIO, nomeDoEnvio } from '@/modules/pacientes/exames-enviados-constantes';
import { meusEnvios } from '@/modules/portal/exames-enviados';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { AnunciarSituacoes } from './anunciar-situacoes';
import { AtualizarEnquantoProcessa } from './atualizar-enquanto-processa';
import { CancelarEnvio } from './cancelar-envio';
import { EnvioForm } from './envio-form';
import { molduraDaSecao } from '../../moldura';

export const dynamic = 'force-dynamic';

/**
 * US-160 / US-161 (PM-10 = molde de "Documentos"): "Meus exames" — seção do Plano 16 (G-D9); a âncora `#enviar` da
 * barra "Ações" cai no h2 de "Enviar exame". O formulário só com o recebimento ligado (D18 = a); a lista continua (os
 * envios antigos). Fora da cópia offline (o service worker só guarda /p/plano). A lista é auditada no módulo (D22).
 * Hotfix 09/10/2026: com algum envio "Processando…", AtualizarEnquantoProcessa refaz a página a cada 5 s (até 3 min) até
 * o worker terminar; a troca de situação é anunciada numa região viva única (AnunciarSituacoes), não em cada linha.
 */
export default async function MeusExames() {
  const acesso = await requirePaciente('/p/exames');
  const { ctx, tenant } = acesso;
  const moldura = await molduraDaSecao(acesso);
  const lista = await meusEnvios(ctx);
  const data = (d: Date) => formatarDataNoFuso(d, tenant.fuso);
  const envios = lista.map((e) => ({ ...e, rotulo: nomeDoEnvio(e.nome, data(e.enviadoEm)) }));
  return (
    <>
      <Faixa {...moldura} atual="/p/exames" titulo={MSG_G.titulos.exames} />
      <main className="space-y-6 p-6">
        {tenant.examesPacienteAtivadoEm && (
          <section aria-labelledby="enviar" className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
            <h2 id="enviar" className="font-portal-titulo text-lg font-bold">Enviar exame</h2>
            <EnvioForm hoje={hojeNoFuso(tenant.fuso)} />
          </section>
        )}
        <section aria-labelledby="enviados" className="space-y-3">
          <h2 id="enviados" className="font-portal-titulo text-lg font-bold">Meus exames enviados</h2>
          {lista.length === 0 && <p>{MSG_ENVIO.nenhum}</p>}
          <ul className="space-y-4">
            {envios.map((e) => {
              const nome = e.rotulo;
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
          <AnunciarSituacoes envios={envios.map((e) => ({ id: e.id, nome: e.rotulo, situacao: e.situacao }))} />
          {lista.some((e) => e.status === 'processando') && <AtualizarEnquantoProcessa />}
        </section>
      </main>
    </>
  );
}
