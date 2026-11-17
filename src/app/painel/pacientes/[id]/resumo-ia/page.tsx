import { EsperaDaIa } from '@/app/painel/ia/espera-da-ia';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Aviso } from '@/components/ui/aviso';
import { classeDoBotao } from '@/components/ui/botao';
import { getEnv } from '@/env';
import { MSG_FALHA, MSG_IA, MSG_RESUMO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { abrirResumo, ultimaTarefaDoTipo, type ResumoAberto } from '@/modules/ia/resumo';
import { SECOES_RESUMO } from '@/modules/ia/tipos';
import { formatarDataHora } from '@/modules/pacientes/datas';
import { iaDoAssistente, textoDaFalha } from '../ia-assistente';
import { carregarProntuario } from '../prontuario';
import { descartarResumoAction, pedirResumoAction } from './actions';
import { Copiar } from './copiar';
import { ResumoForm } from './resumo-form';

export const dynamic = 'force-dynamic';

/**
 * US-120 / US-122: o resumo do histórico. Em andamento: "Preparando o resumo…" e o acompanhamento só da situação (sem
 * auditoria), na região viva que fica na tela (`EsperaDaIa`: o fim da espera é anunciado). Pronto: abrir é leitura auditada (`abrirResumo`, RN-108: sem a autorização vigente, não abre). Falhou: o
 * texto da US-122. Senão, o formulário — só quando dá para pedir (mesmas regras e textos da aba Exames).
 */
export default async function ResumoIaPage({ params, searchParams }: PageProps<'/painel/pacientes/[id]/resumo-ia'>) {
  const { id } = await params;
  const { tarefa } = await searchParams;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const ia = configIA(getEnv());
  const [ultima, pedir] = await Promise.all([ultimaTarefaDoTipo(ctx, paciente.id, 'resumo_historico'), iaDoAssistente(ctx, tenant, paciente, 'resumo_historico')]);
  const pedida = typeof tarefa === 'string' ? tarefa : null;
  const abrir = pedida ?? (ultima?.status === 'pronta' ? ultima.id : null);
  const resumo = abrir ? await abrirResumo(ctx, paciente.id, abrir, { destino: ia.destino }) : null;
  const andamento = ultima && (ultima.status === 'na_fila' || ultima.status === 'processando') ? ultima : null;
  const falhou = !andamento && ultima?.status === 'falhou' ? ultima : null;
  // a tarefa da URL não abre (descartada, vencida, autorização retirada) e não é a que está em andamento nem a que falhou
  const indisponivel = pedida !== null && !resumo && !andamento && falhou?.id !== pedida;
  const aviso = pedir ? pedir.aviso : paciente.status !== 'ativo' ? MSG_FALHA.paciente_indisponivel : MSG_IA.indisponivel;
  return (
    <section aria-labelledby="resumo-ia" className="max-w-5xl space-y-4">
      <h2 id="resumo-ia" className="text-xl font-semibold">{MSG_RESUMO.botao}</h2>
      <EsperaDaIa
        andamento={andamento}
        textos={{ andamento: MSG_RESUMO.preparando, pronto: MSG_RESUMO.pronto }}
        pronto={!!resumo}
        falha={falhou ? textoDaFalha(falhou.erro, { padrao: MSG_RESUMO.falha }) : null}
        indisponivel={indisponivel ? MSG_IA.indisponivelSugestao : null}
      />
      {resumo ? (
        <ResumoAbertoView resumo={resumo} fuso={tenant.fuso} patientId={paciente.id} podeGerarDeNovo={!!pedir?.podePedir && !andamento} />
      ) : (
        !andamento && (aviso ? <p className="text-suave">{aviso}</p> : <ResumoForm acao={pedirResumoAction.bind(null, paciente.id)} />)
      )}
    </section>
  );
}

/** O texto que "Copiar" leva: cada seção com as frases e os rótulos das fontes, como na tela. */
function textoParaCopiar(secoes: ResumoAberto['secoes'], comFontes: (fontes: string[]) => string): string {
  return secoes.map((s) => [MSG_RESUMO.secoes[s.secao], ...s.frases.map((f) => `${f.texto}${comFontes(f.fontes)}`)].join('\n')).join('\n\n');
}

/** RN-102: o texto da IA é texto puro (o React escapa; sem Markdown e sem link); as fontes viram rótulos ("antropometria de 01/09/2026"). */
function ResumoAbertoView({ resumo, fuso, patientId, podeGerarDeNovo }: { resumo: ResumoAberto; fuso: string; patientId: string; podeGerarDeNovo: boolean }) {
  const rotuloDe = new Map(resumo.fontes.map((f) => [f.indice, f.rotulo]));
  const comFontes = (fontes: string[]) => {
    const rotulos = fontes.map((x) => rotuloDe.get(x)).filter((x): x is string => !!x);
    return rotulos.length ? ` (${rotulos.join('; ')})` : '';
  };
  const secoes = SECOES_RESUMO.flatMap((s) => resumo.secoes.filter((x) => x.secao === s));
  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold">{MSG_RESUMO.titulo(formatarDataHora(resumo.geradoEm, fuso))}</p>
      <Aviso tipo="aviso">{MSG_RESUMO.faixa}</Aviso>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {secoes.map((s) => (
            <section key={s.secao} aria-labelledby={`secao-${s.secao}`} className="space-y-2">
              <h3 id={`secao-${s.secao}`} className="font-semibold">{MSG_RESUMO.secoes[s.secao]}</h3>
              {s.frases.map((f, i) => (
                <p key={i} className="wrap-break-word">
                  {f.texto}
                  <span className="text-suave">{comFontes(f.fontes)}</span>
                </p>
              ))}
            </section>
          ))}
          {resumo.retiradas > 0 && <p className="text-sm text-suave">{MSG_RESUMO.retiradas(resumo.retiradas)}</p>}
        </div>
        {resumo.tabela.length > 0 && (
          <table className="h-fit w-full rounded-2xl border border-borda bg-cartao text-left text-sm">
            <caption className="pb-2 text-left font-semibold">{MSG_RESUMO.dadosUsados}</caption>
            <thead className="text-suave">
              <tr>
                <th scope="col" className="p-2">Dado</th>
                <th scope="col" className="p-2">Variação</th>
              </tr>
            </thead>
            <tbody>
              {resumo.tabela.map((l, i) => (
                <tr key={`${i}-${l.rotulo}`} className="border-t border-linha">
                  <th scope="row" className="p-2 font-normal">{l.rotulo}</th>
                  <td className="p-2">{l.texto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <Copiar texto={textoParaCopiar(secoes, comFontes)} />
        {podeGerarDeNovo && <ResumoForm acao={pedirResumoAction.bind(null, patientId)} deNovo={{ notas: resumo.notasPrivadas }} />}
        <form action={descartarResumoAction.bind(null, patientId, resumo.tarefaId)}>
          <ConfirmarBotao mensagem="Descartar o resumo? O prontuário não muda." className={classeDoBotao('secundario')}>{MSG_RESUMO.descartar}</ConfirmarBotao>
        </form>
      </div>
    </div>
  );
}
