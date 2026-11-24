import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarcacaoBlocos } from '@/components/marcacao-blocos';
import { Aviso } from '@/components/ui/aviso';
import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { Selo } from '@/components/ui/selo';
import { idValido } from '@/modules/pacientes/base';
import { formatarCodigo } from '@/modules/documentos/codigo';
import { declaracaoDoDocumento, envioEmCurso, linhaDaVersao, podeVoltarAEditar, ROTULO_ASSINATURA, ROTULO_STATUS, TIPO_DOCUMENTO_ROTULO } from '@/modules/documentos/constantes';
import { MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { MSG_CANCELAMENTO } from '@/modules/documentos/cancelamento';
import { MSG_DIGITALIZADA } from '@/modules/documentos/digitalizada';
import { dataHora, lerDocumento } from '@/modules/documentos/documentos';
import { situacaoDaEntrega } from '@/modules/documentos/entrega';
import { linhaDoValor, MSG_PARECER, rotuloDoExame } from '@/modules/documentos/parecer';
import { situacaoDosExames } from '@/modules/documentos/parecer-exames';
import type { ConteudoParecer } from '@/modules/documentos/parecer';
import { descreverItem, type ConteudoReceita } from '@/modules/documentos/prescricao';
import { MSG_SOLICITACAO, type ConteudoSolicitacao } from '@/modules/documentos/solicitacao';
import { assertNever, type ConteudoAnonimizado } from '@/modules/documentos/tipos-de-documento';
import { bibliotecasParaExames } from '@/modules/exames/modelos-solicitacao';
import { listarItensSalvos, listarModelosPrescricao } from '@/modules/documentos/modelos';
import { listarExames } from '@/modules/pacientes/exames';
import { carregarProntuario } from '../../prontuario';
import { apagarRascunhoAction, pedirNovoPdfAction, retificarAction, voltarAEditarAction } from '../actions';
import { AcaoDocumento } from './acao-documento';
import { AvisoDoExame } from './aviso-exame';
import { Cancelar } from './cancelar';
import { Entrega } from './entrega';
import { EnviarDigitalizada } from './enviar-digitalizada';
import { EstadoPdf } from './estado-pdf';
import { ParecerForm } from './parecer-form';
import { ReceitaForm } from './receita-form';
import { SolicitacaoForm } from './solicitacao-form';
import { SolicitacaoVisao } from './solicitacao-visao';

export const dynamic = 'force-dynamic';

export default async function DocumentoPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/documentos/[docId]'>) {
  const { id, docId } = await params;
  const busca = await searchParams;
  if (!idValido(docId)) notFound();
  const { ctx, tenant, paciente, data } = await carregarProntuario(id);
  if (!tenant.documentosLiberados) notFound();
  const d = await lerDocumento(ctx, paciente.id, docId);
  if (!d) notFound();
  const bloqueado = paciente.status === 'bloqueado' || !!paciente.anonimizadoEm;
  const habilitada = !!tenant.fitoterapiaRegistro;
  // RN-140 (c): o emitido anonimizado tem conteudo '{}' e nenhum PDF — a página mostra só a situação (correção do /code-review high do PR #18)
  const anonimizado = !!d.anonimizadoEm;
  // Plano 13: o conteúdo é da receita ou do parecer; o anonimizado tem conteudo '{}' (sem tipo). Plano 22 (DEP-E7): por
  // `switch`; a solicitação (T8) tem o editor e a visão dela — todo tipo lido é mostrado, então o `auditRead` de
  // `lerDocumento` só é gravado quando a página de fato mostra o documento (revisão da T7, a: antes, 404 depois da leitura)
  let receita: ConteudoReceita | null = null;
  let parecer: ConteudoParecer | null = null;
  let solicitacao: ConteudoSolicitacao | null = null;
  const conteudo: typeof d.conteudo | ConteudoAnonimizado = d.conteudo;
  switch (conteudo.tipo) {
    case 'receita':
      receita = conteudo;
      break;
    case 'parecer':
      parecer = conteudo;
      break;
    case 'solicitacao_exames':
      solicitacao = conteudo;
      break;
    case undefined: // anonimizado
      break;
    default:
      assertNever(conteudo);
  }
  // US-141: a seleção do editor pela lista do prontuário (listarExames grava "Visualizou · Exames", regra 8)
  const examesParaEscolher = parecer && d.status === 'rascunho' && !bloqueado
    ? (await listarExames(ctx, paciente.id)).map((x) => ({ id: x.id, rotulo: rotuloDoExame(x), semValores: x.valores.length === 0, linhas: x.valores.map(linhaDoValor) }))
    : [];
  // Plano 22 (T8, R22-08): o editor da solicitação recebe o catálogo e os modelos de solicitação (uma transação só)
  const bibliotecas = solicitacao && d.status === 'rascunho' && !bloqueado ? await bibliotecasParaExames(ctx) : null;
  // Plano 22 (T10b, US-379): o editor da receita recebe os itens salvos ("Adicionar item salvo") e os modelos ("Carregar modelo")
  const daReceita = receita && d.status === 'rascunho' && !bloqueado
    ? { itensSalvos: [...(await listarItensSalvos(ctx, 'suplementos')), ...(await listarItensSalvos(ctx, 'fitoterapicos'))], modelos: await listarModelosPrescricao(ctx) }
    : null;
  // RN-148 v0.5: o aviso de exame mudado/excluído só onde a nutricionista ainda age (aguardando → voltar a editar; assinado → retificar)
  const situacao = parecer && !anonimizado && (d.status === 'aguardando_assinatura' || d.status === 'assinado') ? await situacaoDosExames(ctx, paciente.id, parecer.exames) : {};
  // D24: um envio digitalizado recebendo as fotos ou na fila do worker ("Montando o PDF digitalizado…"), com o mesmo prazo
  // de 1 h do servidor; esquecido além dele, a página já pede as fotos de novo (Minor 7 da Etapa 3)
  const agora = new Date();
  const emCurso = envioEmCurso(d, agora);
  // RN-141 (code review do PR #19, item 9): também no PDF falho ou sem cota (senão o documento fica preso em "Preparando o
  // PDF"); nunca com um envio digitalizado em curso (o módulo também recusa)
  const voltarAEditar = !bloqueado && podeVoltarAEditar(d, agora) && (
    <AcaoDocumento acao={voltarAEditarAction.bind(null, paciente.id, d.id)} rotulo="Voltar a editar" confirmar="O PDF preparado será descartado. Continuar?" />
  );
  const envioFalhou = d.digitalizacaoStatus === 'falhou' || (!emCurso && (d.digitalizacaoStatus === 'recebendo' || d.digitalizacaoStatus === 'pendente'));
  // spec §4: o emitido (assinado ou cancelado) mostra à nutricionista como foi assinado e o PDF; o paciente baixa o cancelado pelo portal
  const emitido = (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt>Assinado em</dt>
        <dd>{d.assinadoEm ? dataHora(d.assinadoEm, tenant.fuso) : '—'}</dd>
        <dt>Assinatura</dt>
        <dd>{d.assinaturaTipo ? ROTULO_ASSINATURA[d.assinaturaTipo] : '—'}</dd>
        {d.assinanteNome && (
          <>
            <dt>Assinado por</dt>
            <dd>{d.assinanteNome}</dd>
          </>
        )}
      </dl>
      {!anonimizado && <BotaoLink href={`/api/painel/documentos/${d.id}/pdf`} prefetch={false} variante="secundario">Baixar PDF assinado</BotaoLink>}
    </>
  );
  const entregaAntes = d.status === 'cancelado' && !anonimizado ? situacaoDaEntrega(d, tenant.fuso) : '';
  // Q13-1 ★: o campo do motivo só numa retificação (null = versão 1, sem o campo)
  const motivo = d.retificaId ? (d.motivoRetificacao ?? '') : null;
  return (
    <section aria-labelledby="documento" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="documento" className="text-lg font-semibold">{TIPO_DOCUMENTO_ROTULO[d.tipo]}</h2>
        <Selo>{ROTULO_STATUS[d.status]}</Selo>
        {d.codigo && d.status !== 'rascunho' && <span className="text-sm text-suave">{`Código de verificação: ${formatarCodigo(d.codigo)}`}</span>}
      </div>
      {/* Q13-5 ★ / NGS1.01.01: a versão nova diz qual ela substitui; o motivo (Q13-1 ★) fica só no prontuário */}
      {d.versoes.anterior?.codigo && <p className="text-sm text-suave">{linhaDaVersao(d.versao, formatarCodigo(d.versoes.anterior.codigo))}</p>}
      {d.status !== 'rascunho' && d.motivoRetificacao && <p className="text-sm text-suave">{`Motivo da retificação (só no prontuário): ${d.motivoRetificacao}`}</p>}

      {anonimizado && <Aviso tipo="aviso">Documento anonimizado.</Aviso>}

      {d.status === 'rascunho' && !bloqueado && receita && (
        <>
          {/* o preparo é um botão do mesmo formulário: envia o que está na tela (revisão da T6) */}
          {/* Plano 22 (EP-D56): a declaração vem do conteúdo da tela (declaracaoDoDocumento, no próprio formulário) */}
          <ReceitaForm patientId={paciente.id} docId={d.id} conteudo={receita} justificativa={d.justificativa ?? ''} habilitada={habilitada} motivo={motivo} itensSalvos={daReceita?.itensSalvos} modelos={daReceita?.modelos} />
          <AcaoDocumento acao={apagarRascunhoAction.bind(null, paciente.id, d.id)} rotulo="Apagar rascunho" confirmar="Apagar este rascunho?" />
        </>
      )}

      {d.status === 'rascunho' && !bloqueado && parecer && (
        <>
          <ParecerForm patientId={paciente.id} docId={d.id} conteudo={parecer} exames={examesParaEscolher} declaracao={declaracaoDoDocumento(parecer)} motivo={motivo} />
          <AcaoDocumento acao={apagarRascunhoAction.bind(null, paciente.id, d.id)} rotulo="Apagar rascunho" confirmar="Apagar este rascunho?" />
        </>
      )}

      {d.status === 'rascunho' && !bloqueado && solicitacao && bibliotecas && (
        <>
          <SolicitacaoForm
            patientId={paciente.id}
            docId={d.id}
            conteudo={solicitacao}
            catalogo={bibliotecas.catalogo.map(({ nome, unidade, sinonimos, componentes }) => ({ nome, unidade, sinonimos, componentes }))}
            modelos={bibliotecas.modelos}
            declaracao={declaracaoDoDocumento(solicitacao)}
            motivo={motivo}
          />
          <AcaoDocumento acao={apagarRascunhoAction.bind(null, paciente.id, d.id)} rotulo="Apagar rascunho" confirmar="Apagar este rascunho?" />
        </>
      )}

      {d.status !== 'rascunho' && !anonimizado && solicitacao && <SolicitacaoVisao conteudo={solicitacao} />}

      {d.status !== 'rascunho' && !anonimizado && receita && (
        <Cartao id="itens-receita" titulo="Itens da receita">
          <ol className="list-decimal space-y-2 pl-5">
            {receita.itens.map((it, i) => {
              const x = descreverItem(it);
              return (
                <li key={i}>
                  <p className="font-semibold">{x.titulo}</p>
                  {x.linhas.map((l) => <p key={l} className="text-sm">{l}</p>)}
                </li>
              );
            })}
          </ol>
          {/* Plano 22 (RN-395): a marcação em componentes (nunca HTML); a receita antiga, em texto puro */}
          {receita.orientacoes && (
            <div className="mt-3">
              <MarcacaoBlocos texto={receita.orientacoes} formato={receita.orientacoesFormato} />
            </div>
          )}
          {d.justificativa && <p className="mt-3 text-sm text-suave">{`Justificativa de uso (fica no prontuário, não vai na receita): ${d.justificativa}`}</p>}
        </Cartao>
      )}

      {d.status !== 'rascunho' && !anonimizado && parecer && (
        <>
          <Cartao id="exames-parecer" titulo="Exames considerados">
            <ul className="space-y-3">
              {parecer.exames.map((x) => (
                <li key={x.id} className="space-y-1">
                  <p className="font-semibold">{rotuloDoExame(x)}</p>
                  {x.valores.length === 0 ? (
                    <p className="text-sm">{`(${MSG_PARECER.semValores})`}</p>
                  ) : (
                    <ul className="text-sm">{x.valores.map((v, i) => <li key={i}>{linhaDoValor(v)}</li>)}</ul>
                  )}
                  <AvisoDoExame situacao={situacao[x.id]} exame={x} />
                </li>
              ))}
            </ul>
          </Cartao>
          <Cartao id="avaliacao-parecer" titulo="Avaliação nutricional">
            <p className="whitespace-pre-line">{parecer.avaliacao}</p>
            {parecer.conduta && (
              <>
                <h3 className="mt-3 font-semibold">Conduta e orientações</h3>
                <p className="whitespace-pre-line">{parecer.conduta}</p>
              </>
            )}
            {parecer.encaminhamentos && (
              <>
                <h3 className="mt-3 font-semibold">Encaminhamentos</h3>
                <p className="whitespace-pre-line">{parecer.encaminhamentos}</p>
              </>
            )}
          </Cartao>
        </>
      )}

      {d.status === 'preparando' && (
        d.pdfStatus === 'falhou' || d.pdfStatus === 'sem_cota' ? (
          <>
            {/* RNF-143 (Minor da revisão de cobertura): cota esgotada tem a mensagem dela, não a de falha genérica */}
            <Aviso tipo="erro" papel="alert">{d.pdfStatus === 'sem_cota' ? MSG_COTA_ESGOTADA : 'Não foi possível gerar o PDF. Tente de novo.'}</Aviso>
            {/* R3: o botão (um <form>) fica fora do Aviso, que é um <p> */}
            <AcaoDocumento acao={pedirNovoPdfAction.bind(null, paciente.id, d.id)} rotulo="Gerar o PDF de novo" secundario />
            {voltarAEditar}
          </>
        ) : (
          <EstadoPdf docId={d.id} />
        )
      )}

      {d.status === 'aguardando_assinatura' && (
        <Cartao id="aguardando-assinatura" titulo="Aguardando assinatura" data-guia="assinar-documento">
          {/* Plano 10A: só a digitalizada. O Plano 10B (T5) troca este parágrafo pelo texto do gov.br e do certificado e põe a dica do quadro. */}
          <p>Baixe o PDF, imprima, assine à mão e envie fotos das páginas aqui.</p>
          <BotaoLink href={`/api/painel/documentos/${d.id}/pdf?base=1`} prefetch={false}>Baixar PDF para assinar</BotaoLink>
          {!data.user.twoFactorEnabled && (
            <Aviso tipo="aviso">
              Ative a verificação em duas etapas em Segurança para assinar documentos. <a href="/conta/seguranca" className="underline">Ativar agora</a>
            </Aviso>
          )}
          {/* RN-157 / D4: as fotos assinadas e o código do 2FA; o worker monta o PDF novo (D24: um envio por vez) */}
          {emCurso ? (
            <EstadoPdf docId={d.id} esperando="digitalizacao" />
          ) : (
            <>
              {/* R3: só texto dentro do Aviso (um <p>); o formulário fica fora dele */}
              {envioFalhou && <Aviso tipo="erro" papel="alert">{MSG_DIGITALIZADA.falhou}</Aviso>}
              {data.user.twoFactorEnabled && !bloqueado && <EnviarDigitalizada docId={d.id} aviso={MSG_DIGITALIZADA.aviso} dica={MSG_DIGITALIZADA.fotos} />}
            </>
          )}
          {voltarAEditar}
        </Cartao>
      )}

      {d.status === 'assinado' && (
        <Cartao id="documento-assinado" titulo="Documento assinado">
          {emitido}
          {/* US-145 / D3: a entrega ("?link=1" = "Link reenviado.", D6 ★) */}
          {!anonimizado && <Entrega d={d} paciente={paciente} fuso={tenant.fuso} linkReenviado={busca.link === '1'} />}
          {/* Plano 22 (T8, RN-390, EP-D50): "Lançar resultados" abre o "Novo exame" com o título e as linhas da solicitação
              (a página de exames lê o conteúdo com auditRead; sem pré-carregar o link) */}
          {solicitacao && !bloqueado && !anonimizado && (
            <div className="mt-4">
              <BotaoLink href={`/painel/pacientes/${paciente.id}/exames?solicitacao=${d.id}#novo-exame`} prefetch={false}>
                {MSG_SOLICITACAO.lancarResultados}
              </BotaoLink>
            </div>
          )}
          {/* US-148: só a versão em vigor; com uma retificação em andamento, o botão abre a mesma (uma por vez) */}
          {!bloqueado && (
            <div className="mt-4" data-guia="retificar-documento">
              <AcaoDocumento acao={retificarAction.bind(null, paciente.id, d.id)} rotulo="Retificar" secundario />
            </div>
          )}
          {/* US-149 / RN-147: só de "assinado", com o paciente não bloqueado (o bloqueado é só leitura) */}
          {!bloqueado && <Cancelar patientId={paciente.id} docId={d.id} confirmacao={MSG_CANCELAMENTO.confirmacao} />}
        </Cartao>
      )}

      {d.status === 'cancelado' && (
        <Cartao id="documento-cancelado" titulo="Documento cancelado">
          {d.canceladoEm && <p>{`Cancelado em ${dataHora(d.canceladoEm, tenant.fuso).split(' às ')[0]}`}</p>}
          {/* D15 da spec: o motivo é só da equipe (STAFF_ONLY), nunca vai ao paciente nem às exportações */}
          {d.motivoCancelamento && <p className="text-sm text-suave">{`Motivo (só no prontuário): ${d.motivoCancelamento}`}</p>}
          {emitido}
          {/* a entrega e o recebimento de antes do cancelamento, só para leitura (sem "Entregue pessoalmente" nem "Reenviar link") */}
          {entregaAntes && (
            <section aria-labelledby="entrega" className="mt-4 space-y-2">
              <h3 id="entrega" className="font-semibold">Entrega</h3>
              <p>{entregaAntes}</p>
            </section>
          )}
        </Cartao>
      )}

      {d.status === 'substituido' && (
        <Cartao id="documento-substituido" titulo="Documento substituído">
          {d.substituidoEm && d.versoes.seguinte && <p>{`Substituído em ${dataHora(d.substituidoEm, tenant.fuso).split(' às ')[0]} pela versão ${d.versoes.seguinte.versao}.`}</p>}
          {d.versoes.seguinte && (
            <Link href={`/painel/pacientes/${paciente.id}/documentos/${d.versoes.seguinte.id}`} className="inline-flex min-h-11 items-center text-link underline">
              {`Abrir a versão ${d.versoes.seguinte.versao}`}
            </Link>
          )}
          {emitido}
        </Cartao>
      )}
    </section>
  );
}
