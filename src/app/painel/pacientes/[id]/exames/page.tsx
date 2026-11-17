import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { FocoNaAncora } from '@/components/foco-na-ancora';
import { Aviso } from '@/components/ui/aviso';
import { Selo } from '@/components/ui/selo';
import { getEnv } from '@/env';
import { signFileUrl } from '@/lib/signed-url';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { expandirParaAnalise } from '@/modules/exames/catalogo-regras';
import { indiceDoCatalogo } from '@/modules/exames/classificacao';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { bibliotecasParaExames } from '@/modules/exames/modelos-solicitacao';
import { motivoDoPaciente, situacaoIaDoPaciente } from '@/modules/ia/autorizacao';
import { abrirSugestao } from '@/modules/ia/conferencia';
import { MSG_IA } from '@/modules/ia/constantes';
import { situacaoDaCotaIa } from '@/modules/ia/cota';
import { configIA, estadoIaComPaciente } from '@/modules/ia/modo';
import { marcasDeIa, tarefasDosExames } from '@/modules/ia/tarefas';
import { formatarData, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { listarExames } from '@/modules/pacientes/exames';
import { contarEnviosDoPaciente, examesEnviadosPeloPaciente } from '@/modules/pacientes/exames-enviados';
import { MSG_REVISAO } from '@/modules/pacientes/exames-enviados-constantes';
import { mensagemIaDaChave } from '@/modules/pacientes/exames-enviados-ia';
import { carregarProntuario } from '../prontuario';
import { descartarSugestaoAction, excluirExameAction } from './actions';
import { ConferenciaIa } from './conferencia-ia';
import { ExameForm } from './exame-form';
import { IaDoExame, iaNoExame } from './ia-exame';

export const dynamic = 'force-dynamic';

export default async function ExamesPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/exames'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const lista = await listarExames(ctx, paciente.id);
  const bloqueado = paciente.status === 'bloqueado';
  // Plano 22 (T4, RNF-371): catálogo e modelos de solicitação numa transação só; as faixas do consultório ficam no servidor
  const bibliotecas = bloqueado ? null : await bibliotecasParaExames(ctx);
  const indice = indiceDoCatalogo(bibliotecas?.catalogo ?? []);
  const catalogo = (bibliotecas?.catalogo ?? []).map(({ nome, unidade, sinonimos, componentes }) => ({ nome, unidade, sinonimos, componentes }));
  const modelos = (bibliotecas?.modelos ?? []).map((m) => ({ id: m.id, nome: m.nome, linhas: expandirParaAnalise(m.exames, indice) }));
  const busca = await searchParams;
  const ia = configIA(getEnv());
  const estadoIa = estadoIaComPaciente(tenant, ia);
  const agora = new Date();
  // R7/D19: a sugestão já pronta segue visível e aplicável até vencer mesmo com a IA bloqueada depois; o pedido novo não.
  const mostrarIa = !bloqueado && estadoIa !== 'ausente' && estadoIa !== 'suspensa';
  // D8: a marca "IA · conferido em {data}" vale mesmo com a IA desligada depois (a origem fica na linha do exame)
  const temOrigemIa = lista.some((e) => e.valores.some((v) => v.iaTarefaId));
  const [situacoes, marcas, cota, enviados, doPaciente] = await Promise.all([
    mostrarIa ? tarefasDosExames(ctx, paciente.id) : new Map(),
    temOrigemIa ? marcasDeIa(ctx, paciente.id) : new Map<string, Date>(),
    mostrarIa && estadoIa === 'ativa' ? situacaoDaCotaIa(ctx, tenant, agora) : null,
    contarEnviosDoPaciente(ctx, paciente.id),
    examesEnviadosPeloPaciente(ctx, paciente.id),
  ]);
  const iaRecusou = mensagemIaDaChave(busca.iaMsg);
  // Plano 14A (D8): a autorização do paciente (sem auditoria: não é dado de saúde)
  const situacaoIa = mostrarIa ? await situacaoIaDoPaciente(ctx, paciente.id, ia.destino) : ({ tipo: 'nunca' } as const);
  const iaExame = iaNoExame({ estadoIa, motivo: motivoDoPaciente(paciente, situacaoIa, 'leitura_laudos'), situacao: situacaoIa, cota });
  const conferir = typeof busca.conferir === 'string' && mostrarIa ? await abrirSugestao(ctx, paciente.id, busca.conferir) : null;
  const pediuConferir = typeof busca.conferir === 'string';
  return (
    <div className="space-y-8">
      <FocoNaAncora />
      {busca.envio === 'salvo' && <Aviso tipo="ok">{MSG_REVISAO.salvo}</Aviso>}
      {iaRecusou && <Aviso tipo="aviso">{iaRecusou}</Aviso>}
      {enviados > 0 && (
        <p>
          <Link href="/painel/exames-recebidos" className="inline-flex min-h-11 items-center text-link underline">{MSG_REVISAO.noProntuario(enviados)}</Link>
        </p>
      )}
      {busca.ia === 'salvo' && <Aviso tipo="ok">{MSG_IA.valoresSalvos}</Aviso>}
      {cota?.nivel === 'aviso' && <Aviso tipo="aviso">{MSG_IA.aviso80}</Aviso>}
      {pediuConferir && !conferir && <Aviso tipo="aviso">{MSG_IA.indisponivelSugestao}</Aviso>}
      {conferir && (
        <section id="conferencia" aria-labelledby="conferencia-titulo" className="space-y-3 rounded-2xl border border-borda bg-cartao p-3">
          <h2 id="conferencia-titulo" className="text-lg font-semibold">{`Valores encontrados · ${conferir.exame.titulo} · ${formatarData(conferir.exame.data)}`}</h2>
          <Aviso tipo="aviso" papel="status">{MSG_IA.faixaLeitura}</Aviso>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <ConferenciaIa
              key={conferir.tarefaId}
              patientId={paciente.id}
              tarefaId={conferir.tarefaId}
              descartadas={conferir.descartadas}
              dataColeta={conferir.dataColeta && conferir.dataColeta !== conferir.exame.data ? { iso: conferir.dataColeta, texto: formatarData(conferir.dataColeta) } : null}
              linhas={conferir.linhas.map((l) => ({
                indice: l.indice, nomeSugerido: l.nomeSugerido, nomeAjustado: l.nomeAjustado, valorTexto: l.valorTexto,
                valorInicial: l.valor.tipo === 'numero' ? formatarDecimal(l.valor.valor, casasDecimais(l.valor.valor)) : l.valorTexto,
                unidade: l.unidade ?? '', referencia: l.referencia ?? '', pagina: l.pagina, jaLancado: l.jaLancado,
              }))}
            />
            {conferir.exame.arquivoPath && (
              <div className="space-y-2">
                {conferir.exame.mime?.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min (signFileUrl), não passa pelo otimizador
                  <img src={signFileUrl(conferir.exame.arquivoPath)} alt={`Laudo do exame ${conferir.exame.titulo}`} className="max-h-[80vh] w-full rounded border border-borda object-contain" />
                ) : (
                  <a href={signFileUrl(conferir.exame.arquivoPath)} target="_blank" rel="noreferrer" className="text-link underline">Abrir o laudo</a>
                )}
              </div>
            )}
          </div>
          <form action={descartarSugestaoAction.bind(null, paciente.id, conferir.tarefaId)}>
            <ConfirmarBotao mensagem="Descartar a sugestão da IA? O exame não muda.">Descartar sugestão</ConfirmarBotao>
          </form>
        </section>
      )}
      {!bloqueado && (
        <section aria-labelledby="novo-exame" className="max-w-6xl space-y-3">
          <h2 id="novo-exame" tabIndex={-1} className="text-lg font-semibold">Novo exame</h2>
          <ExameForm patientId={paciente.id} hoje={hojeNoFuso(tenant.fuso)} catalogo={catalogo} modelos={modelos} />
        </section>
      )}
      <section aria-labelledby="exames" className="space-y-4">
        <h2 id="exames" className="text-lg font-semibold">Exames</h2>
        {lista.length === 0 && <p>Nenhum exame registrado.</p>}
        {lista.map((e) => (
          <article key={e.id} aria-labelledby={`exame-${e.id}`} className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id={`exame-${e.id}`} className="font-semibold">{`${e.titulo} · ${formatarData(e.data)}`}</h3>
                {doPaciente.has(e.id) && <Selo>{MSG_REVISAO.selo}</Selo>}
              </div>
              <div className="flex gap-4">
                {e.arquivoPath && (
                  <a href={signFileUrl(e.arquivoPath)} rel="noreferrer" className="text-link underline">Baixar laudo</a>
                )}
                {e.arquivoPath && mostrarIa && (
                  <IaDoExame patientId={paciente.id} exame={{ id: e.id, titulo: e.titulo }} situacao={situacoes.get(e.id)} ia={iaExame} agora={agora} />
                )}
                {!bloqueado && (
                  <Link href={`/painel/pacientes/${paciente.id}/exames/${e.id}/editar`} aria-label={MSG_EXAMES.exame.editarRotulo(e.titulo, formatarData(e.data))} className="inline-flex min-h-11 items-center text-link underline">
                    {MSG_EXAMES.exame.editar}
                  </Link>
                )}
                {!bloqueado && (
                  <form action={excluirExameAction.bind(null, paciente.id, e.id)}>
                    <ConfirmarBotao mensagem="Excluir este exame e o laudo?" rotulo={`Excluir o exame ${e.titulo} de ${formatarData(e.data)}`}>Excluir</ConfirmarBotao>
                  </form>
                )}
              </div>
            </div>
            {/* "Editar exame" volta com ?editado={id}#exame-salvo: a confirmação fica no exame editado e recebe o foco
                (FocoNaAncora), à vista e lida pelo leitor de tela — não no topo da página, acima do "Novo exame" */}
            {busca.editado === e.id && (
              <Aviso tipo="ok" id="exame-salvo" focavel>
                {MSG_EXAMES.exame.salvo}
              </Aviso>
            )}
            {e.valores.length > 0 && (
              <table className="w-full text-left">
                <caption className="sr-only">{`Valores do exame ${e.titulo}`}</caption>
                <thead className="text-sm text-suave">
                  <tr>
                    <th scope="col">Marcador</th>
                    <th scope="col">Valor</th>
                    <th scope="col">Referência</th>
                  </tr>
                </thead>
                <tbody>
                  {e.valores.map((v, i) => (
                    <tr key={`${i}-${v.nome}`} className="border-t border-linha">
                      <td>{v.nome}</td>
                      <td>
                        {`${formatarDecimal(v.valor, casasDecimais(v.valor))}${v.unidade ? ` ${v.unidade}` : ''}`}
                        {v.iaTarefaId && (
                          <span className="ml-2 text-sm text-suave">{marcas.get(v.iaTarefaId) ? `IA · conferido em ${formatarDataNoFuso(marcas.get(v.iaTarefaId)!, tenant.fuso)}` : 'IA · conferido'}</span>
                        )}
                      </td>
                      <td>{v.referencia ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
