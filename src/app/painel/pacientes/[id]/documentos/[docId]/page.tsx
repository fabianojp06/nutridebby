import { notFound } from 'next/navigation';
import { Aviso } from '@/components/ui/aviso';
import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { Selo } from '@/components/ui/selo';
import { idValido } from '@/modules/pacientes/base';
import { formatarCodigo } from '@/modules/documentos/codigo';
import { DECLARACAO_RECEITA, ROTULO_ASSINATURA, ROTULO_STATUS } from '@/modules/documentos/constantes';
import { MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import { dataHora, lerDocumento } from '@/modules/documentos/documentos';
import { descreverItem } from '@/modules/documentos/prescricao';
import { carregarProntuario } from '../../prontuario';
import { apagarRascunhoAction, pedirNovoPdfAction, voltarAEditarAction } from '../actions';
import { AcaoDocumento } from './acao-documento';
import { EstadoPdf } from './estado-pdf';
import { Preparar } from './preparar';
import { ReceitaForm } from './receita-form';

export const dynamic = 'force-dynamic';

export default async function DocumentoPage({ params }: PageProps<'/painel/pacientes/[id]/documentos/[docId]'>) {
  const { id, docId } = await params;
  if (!idValido(docId)) notFound();
  const { ctx, tenant, paciente, data } = await carregarProntuario(id);
  if (!tenant.documentosLiberados) notFound();
  const d = await lerDocumento(ctx, paciente.id, docId);
  if (!d) notFound();
  const bloqueado = paciente.status === 'bloqueado' || !!paciente.anonimizadoEm;
  const habilitada = !!tenant.fitoterapiaRegistro;
  // RN-140 (c): o emitido anonimizado tem conteudo '{}' e nenhum PDF — a página mostra só a situação (correção do /code-review high do PR #18)
  const anonimizado = !!d.anonimizadoEm;
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
          <ReceitaForm patientId={paciente.id} docId={d.id} conteudo={d.conteudo} justificativa={d.justificativa ?? ''} habilitada={habilitada} />
          <Preparar patientId={paciente.id} docId={d.id} declaracao={DECLARACAO_RECEITA} />
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
          {!bloqueado && (
            <AcaoDocumento acao={voltarAEditarAction.bind(null, paciente.id, d.id)} rotulo="Voltar a editar" confirmar="O PDF preparado será descartado. Continuar?" />
          )}
        </Cartao>
      )}

      {d.status === 'assinado' && (
        <Cartao id="documento-assinado" titulo="Documento assinado">
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
        </Cartao>
      )}
    </section>
  );
}
