import { Aviso } from '@/components/ui/aviso';
import { Selo } from '@/components/ui/selo';
import { requirePaciente } from '@/lib/paciente-session';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { formatarData, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { MSG_ENVIO, nomeDoEnvio } from '@/modules/pacientes/exames-enviados-constantes';
import { meusEnvios } from '@/modules/portal/exames-enviados';
import { examesLiberadosDoPaciente } from '@/modules/portal/exames-liberados';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { AnunciarSituacoes } from './anunciar-situacoes';
import { AtualizarEnquantoProcessa } from './atualizar-enquanto-processa';
import { CancelarEnvio } from './cancelar-envio';
import { EnvioForm } from './envio-form';
import { molduraDaSecao } from '../../moldura';

export const dynamic = 'force-dynamic';

const R = MSG_EXAMES.portal;

/**
 * US-160 / US-161 (PM-10 = molde de "Documentos"): "Meus exames" — seção do Plano 16 (G-D9); a âncora `#enviar` da
 * barra "Ações" cai no h2 de "Enviar exame". O formulário só com o recebimento ligado (D18 = a); a lista continua (os
 * envios antigos). Fora da cópia offline (o service worker só guarda /p/plano). A lista é auditada no módulo (D22).
 * Hotfix 09/10/2026: com algum envio "Processando…", AtualizarEnquantoProcessa acompanha só a situação (rota leve, sem
 * auditoria) e refaz a página uma vez quando o worker termina; a troca é anunciada numa região viva única
 * (AnunciarSituacoes), não em cada linha.
 * Plano 22 (T6, US-375, RN-386, spec §7 "Portal"): "Resultados liberados" acima do envio, com os exames que a nutricionista
 * marcou "Mostrar no app" — um cartão por exame (título e data no cabeçalho) e uma lista de definição por marcador (nome,
 * "Resultado: …", "Referência: …" e "Fora da referência" no `Selo`, junto do valor), sem tabela (nada de rolagem lateral a
 * 360 px), com o aviso fixo no topo da seção. A lista só sai de `examesLiberadosDoPaciente` (projeção fechada; auditada
 * com itens). "Meus exames enviados" some com o recebimento desligado e sem envio.
 */
export default async function MeusExames() {
  const acesso = await requirePaciente('/p/exames');
  const { ctx, tenant } = acesso;
  const moldura = await molduraDaSecao(acesso);
  const [lista, liberados] = await Promise.all([meusEnvios(ctx), examesLiberadosDoPaciente(ctx)]);
  const data = (d: Date) => formatarDataNoFuso(d, tenant.fuso);
  const processando = lista.filter((e) => e.status === 'processando').map((e) => e.id);
  const envios = lista.map((e) => ({ ...e, rotulo: nomeDoEnvio(e.nome, data(e.enviadoEm)) }));
  return (
    <>
      <Faixa {...moldura} atual="/p/exames" titulo={MSG_G.titulos.exames} />
      <main className="space-y-6 p-6">
        {liberados.length > 0 && (
          <section aria-labelledby="liberados" className="space-y-3">
            <h2 id="liberados" className="font-portal-titulo text-lg font-bold">{R.titulo}</h2>
            <p>{R.texto}</p>
            <Aviso tipo="aviso" papel="nenhum">{R.aviso}</Aviso>
            <ul className="space-y-4">
              {liberados.map((e) => (
                <li key={e.id} className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
                  <div>
                    <h3 className="wrap-break-word font-semibold">{e.titulo}</h3>
                    <p className="text-sm text-suave">{formatarData(e.data)}</p>
                  </div>
                  <dl className="space-y-3">
                    {e.linhas.map((l, i) => (
                      <div key={i}>
                        <dt className="wrap-break-word font-semibold">{l.nome}</dt>
                        <dd className="flex flex-wrap items-center gap-2">
                          <span>{R.resultado(formatarDecimal(l.valor, casasDecimais(l.valor)), l.unidade ?? '')}</span>
                          {l.fora && <Selo>{R.fora}</Selo>}
                        </dd>
                        {l.referencia && <dd className="wrap-break-word text-suave">{R.referencia(l.referencia)}</dd>}
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        )}
        {tenant.examesPacienteAtivadoEm && (
          <section aria-labelledby="enviar" className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
            <h2 id="enviar" className="font-portal-titulo text-lg font-bold">Enviar exame</h2>
            <EnvioForm hoje={hojeNoFuso(tenant.fuso)} />
          </section>
        )}
        {/* Plano 22 (RN-386): some com o recebimento desligado e sem envio, em vez de "Nenhum exame enviado ainda." */}
        {(tenant.examesPacienteAtivadoEm || lista.length > 0) && (
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
            {processando.length > 0 && <AtualizarEnquantoProcessa processando={processando} />}
          </section>
        )}
      </main>
    </>
  );
}
