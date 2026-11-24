import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { FocoNaAncora } from '@/components/foco-na-ancora';
import { Aviso } from '@/components/ui/aviso';
import { Selo } from '@/components/ui/selo';
import { getEnv } from '@/env';
import { signFileUrl } from '@/lib/signed-url';
import { casasDecimais, formatarDecimal } from '@/lib/numero';
import { expandirParaAnalise } from '@/modules/exames/catalogo-regras';
import { classificarLinha, indiceDoCatalogo } from '@/modules/exames/classificacao';
import { MSG_EXAMES } from '@/modules/exames/constantes';
import { examesParaLancar } from '@/modules/documentos/lancar-resultados';
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
import { ExcluirExame } from './[exameId]/excluir-exame';
import { ConferenciaIa } from './conferencia-ia';
import { ExameForm } from './exame-form';
import { IaDoExame, iaNoExame } from './ia-exame';
import { linhasParaLancar } from './lancar';
import { BotaoComparar, CaixaComparar, SelecaoParaComparar } from './comparar-exames';
import { AvisosDaClassificacao, TabelaClassificada, type LinhaClassificada } from './tabela-classificada';

export const dynamic = 'force-dynamic';

export default async function ExamesPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/exames'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const lista = await listarExames(ctx, paciente.id);
  const bloqueado = paciente.status === 'bloqueado';
  // Plano 22 (T4, RNF-371): catálogo e modelos de solicitação numa transação só, lidos uma vez; as faixas do consultório
  // vão ao formulário só para o "Ver referência" das linhas (T5a, RN-382). T5b: o catálogo também classifica a lista
  // (neutra, categoria e "Ver referência", em memória), por isso é lido mesmo com o paciente bloqueado (só leitura)
  const bibliotecas = await bibliotecasParaExames(ctx);
  const indice = indiceDoCatalogo(bibliotecas.catalogo);
  const catalogo = bloqueado ? [] : bibliotecas.catalogo.map(({ nome, unidade, sinonimos, componentes, faixas }) => ({ nome, unidade, sinonimos, componentes, faixas }));
  const modelos = bloqueado ? [] : bibliotecas.modelos.map((m) => ({ id: m.id, nome: m.nome, linhas: expandirParaAnalise(m.exames, indice) }));
  const doPacienteParaCategoria = { sexo: paciente.sexo, dataNascimento: paciente.dataNascimento };
  const busca = await searchParams;
  // Plano 22 (T8, RN-390, RN-398, EP-D50): "Lançar resultados" da solicitação assinada abre o "Novo exame" com o título e
  // as linhas; só com os documentos liberados (desligado, o parâmetro é ignorado: sem linhas e sem auditRead)
  const solicitacao = bloqueado ? null : linhasParaLancar(tenant, busca);
  const lancar = solicitacao ? await examesParaLancar(ctx, paciente.id, solicitacao) : null;
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
  // T5b (RN-379, RN-380, RN-382): a classificação de cada linha da lista, calculada na leitura (nada gravado, EP-D11)
  const marcaDaIa = (iaTarefaId: string | undefined) =>
    iaTarefaId ? (marcas.get(iaTarefaId) ? `IA · conferido em ${formatarDataNoFuso(marcas.get(iaTarefaId)!, tenant.fuso)}` : 'IA · conferido') : undefined;
  const classificadas = new Map(
    lista.map((e) => [
      e.id,
      e.valores.map((v): LinhaClassificada => {
        const c = classificarLinha(v, indice, doPacienteParaCategoria, e.data);
        return {
          nome: v.nome,
          valor: v.valor,
          unidade: v.unidade,
          referencia: v.referencia,
          neutra: c.neutra,
          categoria: c.categoria?.nome ?? null,
          ref: { referencia: v.referencia, refMin: v.refMin, refMax: v.refMax, faixas: c.casado?.faixas ?? [], unidadeDoCatalogo: c.casado?.unidade ?? null },
          marca: marcaDaIa(v.iaTarefaId),
        };
      }),
    ]),
  );
  const todas = [...classificadas.values()].flat();
  const comClassificacao = todas.some((l) => l.neutra || l.categoria);
  const AVISOS = { classificacao: 'exames-aviso-classificacao', gestacao: 'exames-aviso-gestacao' };
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
          <ExameForm key={lancar ? solicitacao : 'novo'} patientId={paciente.id} hoje={hojeNoFuso(tenant.fuso)} catalogo={catalogo} modelos={modelos} inicial={lancar ?? undefined} />
        </section>
      )}
      <section aria-labelledby="exames" className="space-y-4">
        <h2 id="exames" className="text-lg font-semibold">Exames</h2>
        {lista.length === 0 && <p>Nenhum exame registrado.</p>}
        {comClassificacao && <AvisosDaClassificacao ids={AVISOS} comCategoria={todas.some((l) => l.categoria)} />}
        <SelecaoParaComparar>
          {lista.map((e) => (
            <article key={e.id} aria-labelledby={`exame-${e.id}`} className="space-y-2 rounded-2xl border border-borda bg-cartao p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id={`exame-${e.id}`} className="font-semibold">{`${e.titulo} · ${formatarData(e.data)}`}</h3>
                  {doPaciente.has(e.id) && <Selo>{MSG_REVISAO.selo}</Selo>}
                  {e.mostrarNoAppEm && <Selo>{MSG_EXAMES.app.selo}</Selo>}
                </div>
                <div className="flex flex-wrap gap-4">
                  {lista.length >= 2 && <CaixaComparar exameId={e.id} rotulo={MSG_EXAMES.exame.compararRotulo(e.titulo, formatarData(e.data))} />}
                  <Link href={`/painel/pacientes/${paciente.id}/exames/${e.id}`} aria-label={MSG_EXAMES.exame.abrirRotulo(e.titulo, formatarData(e.data))} className="inline-flex min-h-11 items-center text-link underline">
                    {MSG_EXAMES.exame.abrir}
                  </Link>
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
                  {/* Plano 22 (T6): o exame no app pede a confirmação com o aviso no DialogoConfirmar; os outros seguem com a
                      confirmação de hoje (os E2E da conferência dependem dela) */}
                  {!bloqueado && e.mostrarNoAppEm && <ExcluirExame patientId={paciente.id} exameId={e.id} rotulo={`Excluir o exame ${e.titulo} de ${formatarData(e.data)}`} noApp />}
                  {!bloqueado && !e.mostrarNoAppEm && (
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
                <TabelaClassificada id={`exame-${e.id}-valores`} legenda={MSG_EXAMES.exame.valoresDoExame(e.titulo)} linhas={classificadas.get(e.id) ?? []} avisosDeFora={AVISOS} />
              )}
            </article>
          ))}
          {lista.length >= 2 && <BotaoComparar acao={`/painel/pacientes/${paciente.id}/exames/comparativo`} />}
        </SelecaoParaComparar>
      </section>
    </div>
  );
}
