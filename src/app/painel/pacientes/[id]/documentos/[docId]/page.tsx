import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { Selo } from '@/components/ui/selo';
import { idValido } from '@/modules/pacientes/base';
import { formatarCodigo } from '@/modules/documentos/codigo';
import { DECLARACAO_RECEITA, ROTULO_ASSINATURA, ROTULO_STATUS } from '@/modules/documentos/constantes';
import { MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { MSG_CANCELAMENTO } from '@/modules/documentos/cancelamento';
import { envioEmCurso, MSG_DIGITALIZADA } from '@/modules/documentos/digitalizada';
import { dataHora, lerDocumento } from '@/modules/documentos/documentos';
import { situacaoDaEntrega } from '@/modules/documentos/entrega';
import { descreverItem } from '@/modules/documentos/prescricao';
import { carregarProntuario } from '../../prontuario';
import { apagarRascunhoAction, pedirNovoPdfAction, voltarAEditarAction } from '../actions';
import { AcaoDocumento } from './acao-documento';
import { Cancelar } from './cancelar';
import { Entrega } from './entrega';
import { EnviarDigitalizada } from './enviar-digitalizada';
import { EstadoPdf } from './estado-pdf';
import { ReceitaForm } from './receita-form';

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
  // D24: um envio digitalizado recebendo as fotos ou na fila do worker ("Montando o PDF digitalizado…"), com o mesmo prazo
  // de 1 h do servidor; esquecido além dele, a página já pede as fotos de novo (Minor 7 da Etapa 3)
  const emCurso = envioEmCurso(d, new Date());
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
  return (
    <section aria-labelledby="documento" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="documento" className="text-lg font-semibold">Receita</h2>
        <Selo>{ROTULO_STATUS[d.status]}</Selo>
        {d.codigo && d.status !== 'rascunho' && <span className="text-sm text-suave">{`Código de verificação: ${formatarCodigo(d.codigo)}`}</span>}
      </div>

      {anonimizado && <Aviso tipo="aviso">Documento anonimizado.</Aviso>}

      {d.status === 'rascunho' && !bloqueado && (
        <>
          {/* o preparo é um botão do mesmo formulário: envia o que está na tela (revisão da T6) */}
          <ReceitaForm patientId={paciente.id} docId={d.id} conteudo={d.conteudo} justificativa={d.justificativa ?? ''} habilitada={habilitada} declaracao={DECLARACAO_RECEITA} />
          <AcaoDocumento acao={apagarRascunhoAction.bind(null, paciente.id, d.id)} rotulo="Apagar rascunho" confirmar="Apagar este rascunho?" />
        </>
      )}

      {d.status !== 'rascunho' && !anonimizado && (
        <Cartao id="itens-receita" titulo="Itens da receita">
          <ol className="list-decimal space-y-2 pl-5">
            {(d.conteudo.itens ?? []).map((it, i) => {
              const x = descreverItem(it);
              return (
                <li key={i}>
                  <p className="font-semibold">{x.titulo}</p>
                  {x.linhas.map((l) => <p key={l} className="text-sm">{l}</p>)}
                </li>
              );
            })}
          </ol>
          {d.conteudo.orientacoes && <p className="mt-3">{d.conteudo.orientacoes}</p>}
          {d.justificativa && <p className="mt-3 text-sm text-suave">{`Justificativa de uso (fica no prontuário, não vai na receita): ${d.justificativa}`}</p>}
        </Cartao>
      )}

      {d.status === 'preparando' && (
        d.pdfStatus === 'falhou' || d.pdfStatus === 'sem_cota' ? (
          <>
            {/* RNF-143 (Minor da revisão de cobertura): cota esgotada tem a mensagem dela, não a de falha genérica */}
            <Aviso tipo="erro" papel="alert">{d.pdfStatus === 'sem_cota' ? MSG_COTA_ESGOTADA : 'Não foi possível gerar o PDF. Tente de novo.'}</Aviso>
            {/* R3: o botão (um <form>) fica fora do Aviso, que é um <p> */}
            <AcaoDocumento acao={pedirNovoPdfAction.bind(null, paciente.id, d.id)} rotulo="Gerar o PDF de novo" secundario />
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
          {!bloqueado && (
            <AcaoDocumento acao={voltarAEditarAction.bind(null, paciente.id, d.id)} rotulo="Voltar a editar" confirmar="O PDF preparado será descartado. Continuar?" />
          )}
        </Cartao>
      )}

      {d.status === 'assinado' && (
        <Cartao id="documento-assinado" titulo="Documento assinado">
          {emitido}
          {/* US-145 / D3: a entrega ("?link=1" = "Link reenviado.", D6 ★) */}
          {!anonimizado && <Entrega d={d} paciente={paciente} fuso={tenant.fuso} linkReenviado={busca.link === '1'} />}
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
    </section>
  );
}
