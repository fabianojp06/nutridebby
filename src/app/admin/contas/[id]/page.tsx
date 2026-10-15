import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { Aviso } from '@/components/ui/aviso';
import { Botao, classeDoBotao } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { Selo } from '@/components/ui/selo';
import { formatarBytes } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { textoTaxa } from '@/modules/agenda/presenca';
import { COTA_BYTES } from '@/modules/plataforma/armazenamento';
import { contaPorId, MSG } from '@/modules/plataforma/contas';
import { metricasDeExamesEnviadosPorTenant, metricasDeIaPorEscopo, metricasDeSucessoPorTenant, metricasPorTenant } from '@/modules/plataforma/metricas';
import { definirDocumentosAction, definirIaAction, reativarAction, reenviarConviteAction, suspenderAction } from '../../actions';
import { Convite } from '../../convite';
import { CotaForm } from '../../cota-form';
import { IaCotaForm } from '../../ia-cota-form';
import { IaNutriCotaForm } from '../../ia-nutri-cota-form';
import { MetricasForm } from '../../metricas-form';

export const dynamic = 'force-dynamic';

/** P16-17: os avisos das ações de uma conta (os textos de antes, da lista). */
const AVISOS: Record<string, { texto: string; erro?: boolean }> = {
  reenviado: { texto: 'Convite reenviado.' },
  ja_tem_senha: { texto: MSG.jaTemSenha, erro: true },
  sem_nutri: { texto: MSG.semNutri, erro: true },
  conta_suspensa: { texto: MSG.contaSuspensa, erro: true },
  suspensa: { texto: 'Conta suspensa. A nutricionista e os pacientes veem "Conta temporariamente indisponível".' },
  reativada: { texto: 'Conta reativada.' },
  ia_provisoria: { texto: 'Os textos legais da IA ainda são provisórios. Publique a autorização do paciente e o aditivo finais antes de liberar.', erro: true },
};

const BOTAO = classeDoBotao('secundario');
const dinheiro = (v: number) => `US$ ${v.toFixed(2).replace('.', ',')}`;

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3 border-t border-borda py-2 first:border-t-0">
      <dt className="text-suave">{rotulo}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

/**
 * P16-17: a página de uma conta — o que a lista de 17 colunas mostrava numa linha, em blocos. Só contagens e os dados da
 * conta (`contaPorId`, `metricas*PorTenant`): o admin nunca vê paciente, envio ou arquivo (§4.1). Conta que não existe
 * (ou id que não é uuid) volta para a lista com o aviso, como as ações (M9).
 */
export default async function ContaPage({ params, searchParams }: PageProps<'/admin/contas/[id]'>) {
  await requireUser(['admin'], '/admin');
  const { id } = await params;
  const { aviso } = await searchParams;
  const c = await contaPorId(id);
  if (!c) redirect('/admin?aviso=nao_encontrada');
  const a = typeof aviso === 'string' ? AVISOS[aviso] : undefined;
  // DP-11: os dois escopos da IA (nutricionista e IA Nutri) de UMA leitura (admin_metricas_ia_nutri), nunca a diferença de duas
  const [metricas, sucesso, iaMetricas, exames] = await Promise.all([metricasPorTenant(), metricasDeSucessoPorTenant(), metricasDeIaPorEscopo(), metricasDeExamesEnviadosPorTenant()]);
  const m = metricas.get(c.tenantId);
  const s = sucesso.get(c.tenantId);
  const ia = iaMetricas.get(c.tenantId)?.nutri;
  const iaNutri = iaMetricas.get(c.tenantId)?.paciente;
  const pctIaNutri = c.iaNutriCotaMensalUsd > 0 ? Math.round(((iaNutri?.custoMesMicroUsd ?? 0) / 1_000_000 / c.iaNutriCotaMensalUsd) * 100) : 0;
  const ex = exames.get(c.tenantId);
  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:px-6">
      <Link href="/admin" className="inline-flex min-h-11 items-center text-link underline">Voltar para Contas</Link>
      <header className="space-y-2">
        <h1 className="font-titulo text-2xl font-semibold">{c.nomeExibicao}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-suave">
          <span>{c.slug}</span>
          <span className="break-all">{c.email ?? '—'}</span>
          <span>{`CRN: ${c.crn ?? '—'}`}</span>
        </p>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <Selo>{c.status === 'ativa' ? 'Ativa' : 'Suspensa'}</Selo>
          <span>Convite: <Convite c={c} /></span>
        </p>
      </header>
      {a && <Aviso tipo={a.erro ? 'erro' : 'ok'}>{a.texto}</Aviso>}
      <div className="grid gap-4 md:grid-cols-2">
        <Cartao id="uso-no-mes" titulo="Uso no mês">
          <dl className="text-sm">
            <Item rotulo="Consultas no mês">{m?.consultasMes ?? '—'}</Item>
            {/* D15: CS-02 (ativos com conta que abriram o app em 7 dias) e faltas do mês (CS-03), só contagens */}
            <Item rotulo="App na semana">{s && s.comConta ? `${s.abriram} de ${s.comConta} (${Math.round((s.abriram / s.comConta) * 100)}%)` : '—'}</Item>
            <Item rotulo="Faltas no mês">{s && s.iniciadasMes ? textoTaxa(s.faltasMes / s.iniciadasMes, s.faltasMes, s.iniciadasMes) : '—'}</Item>
            <Item rotulo="WhatsApp no mês">{m?.mensagensWhatsappMes ?? '—'}</Item>
            <Item rotulo="Armazenamento">{m ? `${formatarBytes(m.armazenamentoBytes)} de ${formatarBytes(COTA_BYTES)} (${m.arquivos} arquivos)` : '—'}</Item>
            {/* Plano 12 (§3): só contagens — o admin nunca vê envio, arquivo ou paciente */}
            <Item rotulo="Exames do app">
              <span className="block">{`Enviados no mês: ${ex?.enviadosMes ?? 0}`}</span>
              <span className="block">{`Aguardando revisão: ${ex?.pendentes ?? 0}`}</span>
            </Item>
            {/* US-100 (A-06): só contagens e valores */}
            <Item rotulo="Uso de IA da nutricionista no mês">{`${dinheiro((ia?.custoMesMicroUsd ?? 0) / 1_000_000)} de ${dinheiro(c.iaCotaMensalUsd)}`}</Item>
            <Item rotulo="Tarefas de IA da nutricionista no mês">{ia?.tarefasMes ?? 0}</Item>
            {/* Plano 15 (DP-11, desvio 7): a IA Nutri numa linha própria, contra a cota dela — só contagens e valores */}
            <Item rotulo="IA Nutri (pacientes)">{`${iaNutri?.perguntasMes ?? 0} perguntas no mês · ${pctIaNutri}% do limite de ${dinheiro(c.iaNutriCotaMensalUsd)}`}</Item>
          </dl>
        </Cartao>
        <Cartao id="liberacoes" titulo="Liberações">
          <div className="space-y-4 text-sm">
            {/* D20 (Plano 10A): a liberação dos documentos assinados, conta a conta */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p>Documentos assinados: <strong>{c.documentosLiberados ? 'Liberados' : 'Bloqueados'}</strong></p>
              <form action={definirDocumentosAction.bind(null, c.tenantId, !c.documentosLiberados)}>
                <ConfirmarBotao
                  className={BOTAO}
                  mensagem={
                    c.documentosLiberados
                      ? `Bloquear os documentos assinados de ${c.nomeExibicao}? Só antes do uso real. Bloqueado: o consultório perde a aba Documentos (inclusive Cancelar documento e Entregue pessoalmente), os pacientes deixam de ver e abrir os documentos no app e pelo link do e-mail (nenhum código é enviado), e a verificação pública pelo código continua funcionando.`
                      : `Liberar os documentos assinados para ${c.nomeExibicao}? Confira antes a resposta do CRN-3, o termo e o backup.`
                  }
                >
                  {c.documentosLiberados ? 'Bloquear' : 'Liberar'}<span className="sr-only">{` os documentos de ${c.nomeExibicao}`}</span>
                </ConfirmarBotao>
              </form>
            </div>
            {/* US-100 (A-06; A-D27, 09/10/2026): liberar só com a retenção aceita, os textos 1.0, a avaliação e o backup */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borda pt-4">
              <p>{`IA: ${c.iaLiberada ? 'liberada' : 'bloqueada'}${c.iaAtivada ? ' · ativada pela nutricionista' : ''}`}</p>
              <form action={definirIaAction.bind(null, c.tenantId, !c.iaLiberada)}>
                <ConfirmarBotao
                  className={BOTAO}
                  mensagem={
                    c.iaLiberada
                      ? `Bloquear a IA de ${c.nomeExibicao}? Novas leituras deixam de ser aceitas; o que está na fila falha sem envio.`
                      : `Liberar a IA para ${c.nomeExibicao}? Só com a retenção configurada (zero, ou a de até 30 dias aceita na Anthropic direta), os textos 1.0 publicados, a avaliação aprovada e o backup no host (runbook da IA).`
                  }
                >
                  {c.iaLiberada ? 'Bloquear' : 'Liberar'}<span className="sr-only">{` a IA de ${c.nomeExibicao}`}</span>
                </ConfirmarBotao>
              </form>
            </div>
          </div>
        </Cartao>
        <Cartao id="limites" titulo="Limites">
          <div className="space-y-4">
            <CotaForm tenantId={c.tenantId} cota={c.waCotaMensal} conta={c.nomeExibicao} />
            <IaCotaForm tenantId={c.tenantId} cota={c.iaCotaMensalUsd} conta={c.nomeExibicao} />
            <IaNutriCotaForm tenantId={c.tenantId} cota={c.iaNutriCotaMensalUsd} conta={c.nomeExibicao} />
          </div>
        </Cartao>
        {/* D15: base do CS-03 (P-15) e início do uso (CS-01) */}
        <Cartao id="metricas-de-sucesso" titulo="Métricas de sucesso">
          <MetricasForm tenantId={c.tenantId} conta={c.nomeExibicao} taxaBase={c.taxaFaltasBase} goLiveEm={c.goLiveEm} />
        </Cartao>
        <Cartao id="conta" titulo="Conta">
          <div className="flex flex-wrap gap-3">
            {c.convite !== 'aceito' && c.email && (
              <form action={reenviarConviteAction.bind(null, c.tenantId)}>
                {/* M22: nome acessível com o nome da conta (o texto visível continua o mesmo) */}
                <Botao variante="secundario">Reenviar convite<span className="sr-only">{` para ${c.nomeExibicao}`}</span></Botao>
              </form>
            )}
            {c.status === 'ativa' ? (
              <form action={suspenderAction.bind(null, c.tenantId)}>
                <ConfirmarBotao className={BOTAO} mensagem={`Suspender a conta ${c.nomeExibicao}? A nutricionista e os pacientes perdem o acesso até a reativação. Nenhum dado é apagado.`}>
                  Suspender<span className="sr-only">{` a conta ${c.nomeExibicao}`}</span>
                </ConfirmarBotao>
              </form>
            ) : (
              <form action={reativarAction.bind(null, c.tenantId)}>
                <ConfirmarBotao className={BOTAO} mensagem={`Reativar a conta ${c.nomeExibicao}?`}>
                  Reativar<span className="sr-only">{` a conta ${c.nomeExibicao}`}</span>
                </ConfirmarBotao>
              </form>
            )}
          </div>
        </Cartao>
      </div>
    </main>
  );
}
