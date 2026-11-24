import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_AGENDA, ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { buscarConsulta, motivoDoCancelamentoDaNutri, STATUS_ATIVOS } from '@/modules/agenda/consultas';
import { listarBloqueios } from '@/modules/agenda/disponibilidade';
import { formatarQuando, partesNoFuso } from '@/modules/agenda/fuso';
import { sobrepoe } from '@/modules/agenda/horarios';
import { locaisDoPainel } from '@/modules/agenda/locais';
import { consultaParaIniciarAtendimento, MSG_PRESENCA } from '@/modules/agenda/presenca';
import { cobrancaDaConsulta, type TipoDeResultado } from '@/modules/financeiro/cobranca';
import { MSG_FINANCEIRO } from '@/modules/financeiro/constantes';
import { formatarReais } from '@/modules/financeiro/dinheiro';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { listarNotificacoesDaConsulta } from '@/modules/notificacoes/agendar';
import { ROTULO_CANAL, ROTULO_TIPO, situacaoDaNotificacao, type Canal, type TipoNotificacao } from '@/modules/notificacoes/tipos';
import { cancelarAction, moverAction, presencaAction } from '../../actions';
import { ConsultaForm } from '../../consulta-form';
import { AVISO_ROTULO, lerAvisos, selosDaConsulta } from '../../periodo';
import { Mensagens } from '../../../financeiro/mensagens';
import { marcadorDoEnvio } from '../../../financeiro/topo';
import { CancelarForm } from './cancelar-form';
import { SecaoCobranca } from './cobranca';
import { ALVOS_DA_COBRANCA, ID_TITULO_CONSULTA } from './ids';
import { PresencaForm } from './presenca';
import { Aviso } from '@/components/ui/aviso';

export const dynamic = 'force-dynamic';

const F = MSG_FINANCEIRO;
const CONFIGURACOES = '/painel/financeiro/configuracoes';
/**
 * `?ok=` das ações da seção "Cobrança" (cobranca-actions.ts) → os textos de sucesso do Financeiro (§6.2), na região fixa
 * logo acima da seção (§7), não no `Aviso` do topo: o botão tocado some quando a seção remonta, e o foco vai para o h2
 * "Cobrança".
 */
const OK_DA_COBRANCA: Record<string, string> = {
  cobranca_registrada: F.ok.salvo,
  cobranca_salva: F.ok.salvo,
  cobranca_recebida: F.ok.recebido,
  cobranca_cancelada: F.ok.cancelado,
};

/**
 * Plano 20 (US-303, RN-310, RN-312): a mensagem depois de "Realizada"/"Faltou" pelo `&cobranca=` da URL — só as chaves
 * conhecidas; o valor da cobrança criada vem da própria cobrança (nunca da URL). Bloqueado, já existia ou nenhuma: só
 * "Presença registrada.".
 */
function mensagemDaPresenca(cobranca: unknown, valorCentavos: number | null): { tipo: 'ok' | 'aviso'; texto: ReactNode } {
  const r = typeof cobranca === 'string' ? (cobranca as TipoDeResultado) : null;
  if (r === 'criada' && valorCentavos !== null) return { tipo: 'ok', texto: F.presenca.criada(formatarReais(valorCentavos)) };
  if (r === 'sem_valor') {
    const t = F.presenca.semValor;
    return { tipo: 'aviso', texto: <>{t.antes}<Link href={CONFIGURACOES} className="underline">{t.link}</Link>{t.depois}</> };
  }
  if (r === 'aberta') return { tipo: 'aviso', texto: F.presenca.aberta };
  if (r === 'recebida') return { tipo: 'aviso', texto: F.presenca.recebida };
  return { tipo: 'ok', texto: MSG_PRESENCA.registrada };
}

export default async function ConsultaPage({ params, searchParams }: PageProps<'/painel/agenda/consultas/[id]'>) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tenant } = await requireNutri(`/painel/agenda/consultas/${id}`);
  const c = await buscarConsulta(ctx, id);
  if (!c) notFound();
  const emBloqueio = (await listarBloqueios(ctx, c.inicio, c.fim)).some((b) => sobrepoe(b, c));
  const lembretes = await listarNotificacoesDaConsulta(ctx, c.id);
  const p = partesNoFuso(c.inicio, tenant.fuso);
  // Plano 20: a seção "Cobrança" (com o `ler` da RN-318 só quando há cobrança)
  const secao = await cobrancaDaConsulta(ctx, tenant, c.id);
  const presenca = sp.ok === 'presenca' ? mensagemDaPresenca(sp.cobranca, secao.cobranca?.valorCentavos ?? null) : null;
  const okDaCobranca = typeof sp.ok === 'string' && Object.hasOwn(OK_DA_COBRANCA, sp.ok) ? OK_DA_COBRANCA[sp.ok] : null;
  const ok = sp.ok === 'marcada' ? MSG_AGENDA.marcada : sp.ok === 'alterada' ? MSG_AGENDA.alterada : sp.ok === 'cancelada' ? MSG_AGENDA.cancelada : null;
  const mostrarCobranca = c.status === 'realizada' || secao.cobranca !== null;
  const ativa = STATUS_ATIVOS.includes(c.status);
  const agora = new Date();
  const comecou = c.status !== 'cancelada' && c.inicio.getTime() <= agora.getTime();
  // rodada 1: já começou, não cancelada e sem atendimento ligado (também "realizada"/"faltou")
  const podeAtender = (await consultaParaIniciarAtendimento(ctx, c.patientId, c.id, agora)) !== null;
  // revisão final: o motivo que ela escreveu ao cancelar ("Só você vê.") — só nesta página do painel
  const motivo = c.status === 'cancelada' && c.canceladoPor === 'nutri' ? await motivoDoCancelamentoDaNutri(ctx, c.id) : null;
  // Plano 23 (US-402, RN-407): o local no detalhe; a consulta anterior ao Plano 23 mostra o endereço do Perfil, como antes
  const nomeDoLocal = c.local?.nome ?? 'Consultório (endereço do perfil)';
  const locais = ativa ? await locaisDoPainel(ctx) : [];
  // a consulta sem local (anterior ao Plano 23) abre "Alterar" no primeiro local do tipo dela (o principal, se for desse tipo)
  // revisão (I-1): o local arquivado não está entre as opções; sem isto o navegador marcaria a primeira e o "Salvar alteração"
  // trocaria o local (e a modalidade) sem a nutricionista escolher. Fica o "Escolha o local" e o servidor pede o local.
  const localArquivado = c.localId !== null && !locais.some((l) => l.id === c.localId);
  const localInicial = c.localId
    ? (localArquivado ? '' : c.localId)
    : ((locais.find((l) => l.tipo === c.modalidade && l.principal) ?? locais.find((l) => l.tipo === c.modalidade))?.id ?? '');
  return (
    <>
      <main className="mx-auto w-full max-w-[1360px] space-y-6 p-4 md:p-6">
        <p className="text-sm"><Link href={`/painel/agenda?data=${p.data}`} className="text-link underline">Agenda</Link></p>
        <header className="space-y-1">
          <h1 id={ID_TITULO_CONSULTA} tabIndex={-1} className="font-titulo text-2xl font-semibold">{`Consulta de ${c.paciente}`}</h1>
          <p>{`${formatarQuando(c.inicio, tenant.fuso)}–${partesNoFuso(c.fim, tenant.fuso).hora} · ${ROTULO_MODALIDADE[c.modalidade]} · ${nomeDoLocal}`}</p>
          {c.linkOnline && <p className="text-sm">Link da chamada: <a href={c.linkOnline} className="text-link underline" rel="noreferrer" target="_blank">{c.linkOnline}</a></p>}
          <ul className="flex flex-wrap gap-1 text-sm" aria-label="Situação">
            {selosDaConsulta(c, emBloqueio).map((s) => <li key={s} className="rounded bg-linha px-1.5">{s}</li>)}
          </ul>
          {motivo && <p className="text-sm"><span className="font-medium">Motivo do cancelamento (só você vê):</span> {motivo}</p>}
          <p className="text-sm"><Link href={`/painel/pacientes/${c.patientId}`} className="text-link underline">Abrir prontuário</Link></p>
        </header>
        {ok && <Aviso tipo="ok">{ok}</Aviso>}
        {presenca && <Aviso tipo={presenca.tipo}>{presenca.texto}</Aviso>}
        {lerAvisos(sp.avisos).map((a) => <Aviso key={a} tipo="aviso">{AVISO_ROTULO[a]}</Aviso>)}
        {comecou && (
          <section aria-labelledby="presenca" className="space-y-2">
            <h2 id="presenca" className="text-lg font-semibold">Registrar presença</h2>
            <PresencaForm realizada={presencaAction.bind(null, c.id, 'realizada')} faltou={presencaAction.bind(null, c.id, 'faltou')} />
          </section>
        )}
        {/* §7: a região fica montada enquanto a seção existe (e depois de cancelar a cobrança de uma "Faltou", que tira a
            seção), fora do `key` da seção, para o texto do `ok=` ser anunciado; o foco vai ao h2 (ou ao h1, sem a seção) */}
        {(mostrarCobranca || okDaCobranca) && (
          <div className="space-y-2">
            <Mensagens texto={okDaCobranca ?? ''} tipo="ok" focar={okDaCobranca !== null} marcador={marcadorDoEnvio(sp.envio)} alvos={ALVOS_DA_COBRANCA} />
            {mostrarCobranca && (
              <SecaoCobranca key={[sp.envio, secao.cobranca?.valorCentavos, secao.cobranca?.pagoEm].join('|')} consultaId={c.id} cobranca={secao.cobranca} motivo={secao.motivo} valorSugerido={secao.valorSugerido} hoje={hojeNoFuso(tenant.fuso, agora)} />
            )}
          </div>
        )}
        {podeAtender && (
          <p><Link href={`/painel/pacientes/${c.patientId}/atendimentos?consulta=${c.id}`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-destaque px-5 font-semibold text-white hover:brightness-95">Iniciar atendimento</Link></p>
        )}
        {ativa && (
          <section aria-labelledby="alterar" className="space-y-2">
            <h2 id="alterar" className="text-lg font-semibold">Alterar data e hora</h2>
            <ConsultaForm acao={moverAction.bind(null, c.id)} avisoDoLocal={localArquivado ? 'O local desta consulta foi arquivado.' : undefined} locais={locais.map(({ id, nome, tipo, linkSala }) => ({ id, nome, tipo, linkSala }))} doPaciente={c.origem === 'paciente'} botao="Salvar alteração"
              inicial={{ data: p.data, hora: p.hora, duracaoMin: String(Math.round((c.fim.getTime() - c.inicio.getTime()) / 60_000)), localId: localInicial, linkOnline: c.linkOnline ?? '' }} />
          </section>
        )}
        {ativa && (
          <section aria-labelledby="cancelar" className="space-y-2">
            <h2 id="cancelar" className="text-lg font-semibold">Cancelar consulta</h2>
            <CancelarForm acao={cancelarAction.bind(null, c.id)} />
          </section>
        )}
        <section aria-labelledby="lembretes" className="space-y-2">
          <h2 id="lembretes" className="text-lg font-semibold">Lembretes</h2>
          {lembretes.length === 0 ? (
            <p>Nenhum lembrete para esta consulta.</p>
          ) : (
            <table className="w-full max-w-3xl text-left">
              <caption className="sr-only">Lembretes da consulta</caption>
              <thead className="text-sm text-suave">
                <tr><th scope="col">Mensagem</th><th scope="col">Canal</th><th scope="col">Situação</th></tr>
              </thead>
              <tbody>
                {lembretes.map((n) => (
                  <tr key={n.id} className="border-t border-linha">
                    <td>{ROTULO_TIPO[n.tipo as TipoNotificacao]}</td>
                    <td>{ROTULO_CANAL[n.canal as Canal]}</td>
                    <td>{situacaoDaNotificacao(n, tenant.fuso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
