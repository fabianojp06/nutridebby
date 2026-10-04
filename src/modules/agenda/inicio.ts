import { sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { accessEvents, appointments, auditLog, diaryEntries, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { situacaoDoWhatsappNaTransacao, type SituacaoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { situacaoDaCotaNaTransacao, type SituacaoCota } from '@/modules/notificacoes/whatsapp/cota';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { pedidosDoTitularAbertosNaTransacao, type PedidoDoTitularAberto } from '@/modules/pacientes/lgpd';
import { auditRead } from '@/modules/plataforma/audit';
import { metricasDeSucessoNaTransacao, type MetricasSucesso } from '@/modules/plataforma/metricas-sucesso';
import { contarDiariosNaoVistosNaTransacao } from '@/modules/portal/diario-nutri';
import { listarAgendaNaTransacao, STATUS_ATIVOS, type Consulta } from './consultas';
import { inicioDoDia } from './fuso';
import { contarPendenciasDePresencaNaTransacao, indicadoresDaAgendaNaTransacao, novidadesDaAgendaNaTransacao, type Indicadores, type Novidades } from './presenca';

export type ResumoDoDia = {
  proxima: { consulta: Consulta; numero: number; diario7d: number; portal7d: number } | null;
  hoje: { total: number; confirmadas: number; pedidosRemarcacao: number };
  agenda: Consulta[];
};

export const MSG_INICIO = {
  semConsultaHoje: 'Nenhuma consulta hoje.',
  semProximaHoje: 'Nenhuma consulta pela frente hoje.',
} as const;

/** Cartão "Próxima consulta" vazio: se já houve consulta hoje (todas passaram), "Nenhuma consulta hoje." seria falso. */
export const textoSemProxima = (hoje: ResumoDoDia['hoje']): string => (hoje.total > 0 ? MSG_INICIO.semProximaHoje : MSG_INICIO.semConsultaHoje);

/**
 * Início (D22): a agenda de hoje (como a leitura da agenda, sem auditRead — D10 do Plano 05) e, da próxima consulta, só
 * contagens (registros no diário e dias no portal em 7 dias). Nada de peso nem de outro dado clínico.
 */
export async function resumoDoDia(ctx: TenantContext, fuso: string, agora: Date, db: Db = getDb()): Promise<ResumoDoDia> {
  return withTenant(ctx, (tx) => resumoDoDiaNaTransacao(tx, fuso, agora), db);
}

/**
 * O nº da consulta conta as que aconteceram ou vão acontecer (agendada, confirmada, realizada) até esta: falta e
 * cancelada não são consulta (achado 6 do /code-review do PR #12). A contagem do diário é de um paciente nomeado, em
 * tabela de dado de saúde: leitura auditada na mesma transação (regra 8; entidade `diario`, como o feed dos diários),
 * no máximo uma vez por paciente por dia (decisão do dono, 04/10/2026; ver `auditarDiarioUmaVezNoDia`).
 */
export async function resumoDoDiaNaTransacao(tx: Tx, fuso: string, agora: Date): Promise<ResumoDoDia> {
  const hoje = hojeNoFuso(fuso, agora);
  const agenda = (await listarAgendaNaTransacao(tx, inicioDoDia(hoje, fuso), inicioDoDia(somarDias(hoje, 1), fuso))).filter((c) => c.status !== 'cancelada');
  const resumo = {
    total: agenda.length,
    confirmadas: agenda.filter((c) => c.status === 'confirmada').length,
    pedidosRemarcacao: agenda.filter((c) => c.pedidoRemarcacaoEm !== null).length,
  };
  const consulta = agenda.find((c) => c.fim.getTime() > agora.getTime() && STATUS_ATIVOS.includes(c.status)) ?? null;
  if (!consulta) return { proxima: null, hoje: resumo, agenda };
  const desde = somarDias(hoje, -6);
  const r = await tx.execute<{ numero: string; diario: string; portal: string }>(sql`select
    (select count(*) from ${appointments} where ${appointments.patientId} = ${consulta.patientId} and ${appointments.status} in ('agendada', 'confirmada', 'realizada') and ${appointments.inicio} <= ${consulta.inicio}) as numero,
    (select count(*) from ${diaryEntries} where ${diaryEntries.patientId} = ${consulta.patientId} and ${diaryEntries.dataHora} >= ${inicioDoDia(desde, fuso)}) as diario,
    (select count(*) from ${accessEvents} where ${accessEvents.patientId} = ${consulta.patientId} and ${accessEvents.dia} >= ${desde}) as portal`);
  await auditarDiarioUmaVezNoDia(tx, consulta.patientId, fuso);
  const [x] = r.rows;
  return { proxima: { consulta, numero: Number(x.numero), diario7d: Number(x.diario), portal7d: Number(x.portal) }, hoje: resumo, agenda };
}

/**
 * Decisão do dono (04/10/2026): o Início aberto várias vezes no dia não enche o "Histórico de acessos" do paciente —
 * a leitura `diario` entra no máximo uma vez por paciente por dia no fuso do tenant. Se a mesma conta já tem leitura
 * `diario` dele hoje (do Início ou do feed dos diários), não grava outra; a do próprio paciente no portal (outro ator)
 * não conta, senão o acesso da nutricionista sumiria do histórico. A sessão da nutricionista lê o `audit_log` do tenant
 * pela RLS (como o "Histórico de acessos"); o dia sai do mesmo relógio do `criado_em` (`clock_timestamp()`). A trava
 * por paciente (até o fim da transação) impede que duas aberturas ao mesmo tempo gravem duas linhas.
 */
async function auditarDiarioUmaVezNoDia(tx: Tx, patientId: string, fuso: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('inicio-diario'), hashtext(${patientId}))`);
  const r = await tx.execute<{ ja: boolean }>(sql`select exists (
    select 1 from ${auditLog} where ${auditLog.patientId} = ${patientId} and ${auditLog.entidade} = 'diario' and ${auditLog.acao} = 'ler'
       and ${auditLog.actorUserId} = app_current_user()
       and ${auditLog.criadoEm} >= (date_trunc('day', clock_timestamp() at time zone ${fuso}) at time zone ${fuso})) as ja`);
  if (!r.rows[0].ja) await auditRead(tx, { entidade: 'diario', entidadeId: null, patientId });
}

export type Inicio = {
  whatsapp: SituacaoWhatsapp;
  /** RN-09: só com o WhatsApp ligado. */
  cota: SituacaoCota | null;
  indicadores: Indicadores;
  pendentes: number;
  novidades: Novidades;
  pedidos: PedidoDoTitularAberto[];
  dia: ResumoDoDia;
  naoVistos: number;
  metricas: MetricasSucesso;
};

/**
 * Tudo o que o Início do painel lê, numa transação só (achado 3 do /code-review do PR #12): cada leitura em paralelo
 * abria uma transação, e o Início de duas nutricionistas ao mesmo tempo ocupava o pool de 10 conexões. Em sequência,
 * uma conexão por abertura do Início. Só sessão de nutricionista (os diários, como o soNutri).
 */
export async function lerInicio(
  ctx: TenantContext,
  tenant: Pick<TenantRow, 'fuso' | 'goLiveEm' | 'taxaFaltasBase' | 'waCotaMensal'>,
  agora: Date,
  o: { whatsappLigado: boolean },
  db: Db = getDb(),
): Promise<Inicio> {
  if (ctx.role !== 'nutri') throw new Error('o Início do painel é só da sessão da nutricionista');
  return withTenant(
    ctx,
    async (tx) => {
      const whatsapp = await situacaoDoWhatsappNaTransacao(tx, o.whatsappLigado);
      return {
        whatsapp,
        cota: whatsapp.ligado ? await situacaoDaCotaNaTransacao(tx, tenant, agora) : null,
        indicadores: await indicadoresDaAgendaNaTransacao(tx, tenant.fuso, agora), // US-037 / CS-03 / D18: cartão "Agenda"
        pendentes: await contarPendenciasDePresencaNaTransacao(tx, agora),
        novidades: await novidadesDaAgendaNaTransacao(tx, agora),
        pedidos: await pedidosDoTitularAbertosNaTransacao(tx), // US-046 / D17: cartão "Pedidos do titular"
        dia: await resumoDoDiaNaTransacao(tx, tenant.fuso, agora), // D22: próxima consulta, hoje e agenda do dia
        naoVistos: await contarDiariosNaoVistosNaTransacao(tx),
        metricas: await metricasDeSucessoNaTransacao(tx, tenant, agora), // P08-07 / D15
      };
    },
    db,
  );
}
