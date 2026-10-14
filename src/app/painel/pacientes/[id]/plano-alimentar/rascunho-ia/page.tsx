import Link from 'next/link';
import { EstadoTarefa } from '@/app/painel/ia/estado-tarefa';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Aviso } from '@/components/ui/aviso';
import { classeDoBotao } from '@/components/ui/botao';
import { getEnv } from '@/env';
import { MSG_FALHA, MSG_IA, MSG_RASCUNHO_IA } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { abrirRascunhoIa, metasPadrao } from '@/modules/ia/rascunho-ia';
import { ultimaTarefaDoTipo } from '@/modules/ia/resumo';
import { carregarPlano, listarPlanosDoPaciente } from '@/modules/plano-alimentar/carregar';
import { contextoDoPaciente } from '@/modules/plano-alimentar/meta';
import { iaDoAssistente, textoDaFalha } from '../../ia-assistente';
import { carregarProntuario } from '../../prontuario';
import { descartarRascunhoIaAction, pedirRascunhoIaAction, usarComoRascunhoAction } from './actions';
import { MetasForm } from './metas-form';
import { Previa } from './previa';
import { UsarForm } from './usar-form';

export const dynamic = 'force-dynamic';

/**
 * US-121 / US-122: o rascunho de plano com IA. Em andamento: "Gerando o rascunho…" e o acompanhamento só da situação
 * (sem auditoria). Pronto: a prévia (leitura auditada, `abrirRascunhoIa`; RN-108) com "Usar como rascunho". Falhou: o
 * texto da US-122 (limite de voltas ou de custo à parte). Senão, as metas — só quando dá para pedir.
 */
export default async function RascunhoIaPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/plano-alimentar/rascunho-ia'>) {
  const { id } = await params;
  const { tarefa } = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const ia = configIA(getEnv());
  const [ultima, pedir] = await Promise.all([ultimaTarefaDoTipo(ctx, paciente.id, 'rascunho_plano'), iaDoAssistente(ctx, tenant, paciente, 'rascunho_plano')]);
  const pedida = typeof tarefa === 'string' ? tarefa : null;
  const abrir = pedida ?? (ultima?.status === 'pronta' ? ultima.id : null);
  const previa = abrir ? await abrirRascunhoIa(ctx, paciente.id, abrir, { destino: ia.destino }) : null;
  const andamento = ultima && (ultima.status === 'na_fila' || ultima.status === 'processando') ? ultima : null;
  const falhou = !andamento && ultima?.status === 'falhou' ? ultima : null;
  // a tarefa da URL não abre (descartada, aplicada, vencida, autorização retirada) e não está em andamento nem falhou
  const indisponivel = pedida !== null && !previa && !andamento && falhou?.id !== pedida;
  const aviso = pedir ? pedir.aviso : paciente.status !== 'ativo' ? MSG_FALHA.paciente_indisponivel : MSG_IA.indisponivel;
  const formulario = !previa && !andamento && !aviso;
  let inicial: ReturnType<typeof metasPadrao> | null = null;
  if (formulario) {
    // US-121: a meta do último cálculo de GET e as refeições do plano de versão mais alta (leituras já auditadas)
    const [contexto, planos] = await Promise.all([contextoDoPaciente(ctx, paciente.id, tenant.fuso), listarPlanosDoPaciente(ctx, paciente.id)]);
    const ultimoPlano = planos[0] ? await carregarPlano(ctx, planos[0].id) : null;
    inicial = metasPadrao(contexto.calculos, ultimoPlano);
  }
  return (
    <section aria-labelledby="rascunho-ia" className="max-w-5xl space-y-4">
      <Link href={`/painel/pacientes/${paciente.id}/plano-alimentar`} className="inline-flex min-h-11 items-center text-sm underline">Voltar às versões</Link>
      <h2 id="rascunho-ia" className="text-xl font-semibold">{MSG_RASCUNHO_IA.botao}</h2>
      {andamento && (
        <p role="status">
          {MSG_RASCUNHO_IA.gerando}
          <EstadoTarefa url={`/api/painel/ia/tarefas/${andamento.id}`} />
        </p>
      )}
      {indisponivel && <Aviso tipo="aviso">{MSG_IA.indisponivelSugestao}</Aviso>}
      {falhou && <Aviso tipo="aviso">{textoDaFalha(falhou.erro, { padrao: MSG_RASCUNHO_IA.falha, limite: MSG_RASCUNHO_IA.limite })}</Aviso>}
      {previa ? (
        <>
          <Previa previa={previa} />
          <div className="flex flex-wrap items-start gap-3">
            <UsarForm acao={usarComoRascunhoAction.bind(null, paciente.id, previa.tarefaId)} />
            <form action={descartarRascunhoIaAction.bind(null, paciente.id, previa.tarefaId)}>
              <ConfirmarBotao mensagem="Descartar a sugestão da IA? O plano do paciente não muda." className={classeDoBotao('secundario')}>Descartar sugestão</ConfirmarBotao>
            </form>
          </div>
        </>
      ) : (
        !andamento && (inicial ? <MetasForm acao={pedirRascunhoIaAction.bind(null, paciente.id)} inicial={inicial} /> : aviso && <p className="text-suave">{aviso}</p>)
      )}
    </section>
  );
}
