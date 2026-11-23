import { and, count, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, consultations, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { formatarDecimal } from '@/lib/numero';
import { aoCorrigirParaFaltou, cobrarConsultaRealizada, type ResultadoCobranca } from '@/modules/financeiro/cobranca';
import { idValido } from '@/modules/pacientes/base';
import { travarPacienteDaConsulta } from './cancelamento';
import { MSG_AGENDA } from './constantes';
import { ConsultaError, lerConsultaParaEscrita, listarConsultas, listarConsultasNaTransacao, STATUS_ATIVOS, type Consulta } from './consultas';
import { inicioDoMes, inicioDoMesSeguinte } from './fuso';

export const MSG_PRESENCA = {
  antesDoInicio: 'A presença só pode ser registrada depois do início da consulta.',
  registrada: 'Presença registrada.',
  /** Rodada 1: houve atendimento ligado à consulta — "Faltou" contaria uma falta com atendimento (CS-03). */
  temAtendimento: 'Esta consulta tem um atendimento registrado.',
  pendencias: (n: number) => `${n} ${n === 1 ? 'consulta' : 'consultas'} sem registro de presença`,
} as const;

export type SituacaoPresenca = 'realizada' | 'faltou';
const DIA_MS = 86_400_000;

/** Já existe atendimento ligado à consulta ("Iniciar atendimento", Plano 05). */
const temAtendimento = sql`exists (select 1 from ${consultations} where ${consultations.appointmentId} = ${appointments.id})`;

/**
 * US-037: depois do início, "realizada" ou "faltou" (pode corrigir). Cancelada não; "faltou" com atendimento ligado não.
 * Rodada 1: vale também para paciente bloqueado ou anonimizado — é o histórico da agenda, não edição do prontuário
 * (senão a pendência nunca sairia). Trava como o cancelamento da nutricionista: paciente (`FOR KEY SHARE`) → consulta.
 * Plano 20 (RN-310, RN-312): a passagem a "realizada" cobra (`cobrarConsultaRealizada`) e a correção de "realizada" para
 * "faltou" só lê a cobrança (`aoCorrigirParaFaltou`), na mesma transação; `cobranca` é nulo quando a situação não mudou
 * ou quando "faltou" não corrige uma "realizada".
 */
export async function registrarPresenca(
  ctx: TenantContext,
  id: string,
  situacao: SituacaoPresenca,
  deps: { db?: Db; now?: Date } = {},
): Promise<{ cobranca: ResultadoCobranca | null }> {
  const agora = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      await travarPacienteDaConsulta(tx, id); // id inválido ou de outro tenant → ConsultaNaoEncontradaError
      const c = await lerConsultaParaEscrita(tx, id);
      // Plano 23 (§4.3): o pedido não tem presença (aceitar ou recusar antes; a cobrança do Plano 20 só nasce em realizada)
      if (c.status === 'cancelada' || c.status === 'solicitada') throw new ConsultaError({ geral: MSG_AGENDA.naoAlteravel });
      if (c.inicio.getTime() > agora.getTime()) throw new ConsultaError({ geral: MSG_PRESENCA.antesDoInicio });
      if (c.status === situacao) return { cobranca: null };
      if (situacao === 'faltou') {
        const [a] = await tx.select({ id: consultations.id }).from(consultations).where(eq(consultations.appointmentId, id)).limit(1);
        if (a) throw new ConsultaError({ geral: MSG_PRESENCA.temAtendimento });
      }
      await tx.update(appointments).set({ status: situacao, presencaEm: agora, updatedAt: agora }).where(eq(appointments.id, id));
      if (situacao === 'faltou') return { cobranca: c.status === 'realizada' ? await aoCorrigirParaFaltou(tx, { consultaId: id }) : null };
      const [t] = await tx.select({ fuso: tenants.fuso }).from(tenants).where(eq(tenants.id, ctx.tenantId));
      return { cobranca: await cobrarConsultaRealizada(tx, { tenantId: ctx.tenantId, fuso: t.fuso, consulta: { id, patientId: c.patientId, inicio: c.inicio } }) };
    },
    deps.db ?? getDb(),
  );
}

/** D21 "sem registro de presença": não cancelada, terminou há mais de 24 h e continua "agendada"/"confirmada". */
const semRegistro = (agora: Date) => and(inArray(appointments.status, [...STATUS_ATIVOS]), lt(appointments.fim, new Date(agora.getTime() - DIA_MS)));

/** US-037 "Pendências": as 100 mais antigas (a contagem do título vem de `contarPendenciasDePresenca`). */
export function pendenciasDePresenca(ctx: TenantContext, agora: Date, db: Db = getDb()): Promise<Consulta[]> {
  return listarConsultas(ctx, semRegistro(agora), { ordem: 'asc', limite: 100 }, db);
}

export async function contarPendenciasDePresenca(ctx: TenantContext, agora: Date, db: Db = getDb()): Promise<number> {
  return withTenant(ctx, (tx) => contarPendenciasDePresencaNaTransacao(tx, agora), db);
}

export async function contarPendenciasDePresencaNaTransacao(tx: Tx, agora: Date): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(appointments).where(semRegistro(agora));
  return r.n;
}

export type Indicadores = { consultasMes: number; faltasMes: number; iniciadasMes: number; taxaMes: number | null; taxaMesAnterior: number | null };

/**
 * CS-03 / D21: mês civil no fuso do tenant; taxa = faltas ÷ consultas não canceladas já iniciadas. Uma transação.
 * Plano 23 (§4.3, critério do /code-review do #59): o pedido (`solicitada`) não é consulta — fora de total, iniciadas e
 * iniciadasAnt, o mesmo recorte das métricas do admin (R-410).
 */
export async function indicadoresDaAgenda(ctx: TenantContext, fuso: string, agora: Date, db: Db = getDb()): Promise<Indicadores> {
  return withTenant(ctx, (tx) => indicadoresDaAgendaNaTransacao(tx, fuso, agora), db);
}

export async function indicadoresDaAgendaNaTransacao(tx: Tx, fuso: string, agora: Date): Promise<Indicadores> {
  const ini = inicioDoMes(agora, fuso);
  const anterior = inicioDoMes(new Date(ini.getTime() - 1), fuso);
  const fim = inicioDoMesSeguinte(agora, fuso);
  const doMes = sql`${appointments.inicio} >= ${ini}`;
  const consulta = sql`${appointments.status} not in ('cancelada', 'solicitada')`;
  const [r] = await tx
    .select({
      total: sql<number>`count(*) filter (where ${doMes} and ${consulta})`.mapWith(Number),
      iniciadas: sql<number>`count(*) filter (where ${doMes} and ${consulta} and ${appointments.inicio} <= ${agora})`.mapWith(Number),
      faltas: sql<number>`count(*) filter (where ${doMes} and ${appointments.status} = 'faltou')`.mapWith(Number),
      iniciadasAnt: sql<number>`count(*) filter (where ${appointments.inicio} < ${ini} and ${consulta} and ${appointments.inicio} <= ${agora})`.mapWith(Number),
      faltasAnt: sql<number>`count(*) filter (where ${appointments.inicio} < ${ini} and ${appointments.status} = 'faltou')`.mapWith(Number),
    })
    .from(appointments)
    .where(and(gte(appointments.inicio, anterior), lt(appointments.inicio, fim)));
  return {
    consultasMes: r.total,
    faltasMes: r.faltas,
    iniciadasMes: r.iniciadas,
    taxaMes: r.iniciadas ? r.faltas / r.iniciadas : null,
    taxaMesAnterior: r.iniciadasAnt ? r.faltasAnt / r.iniciadasAnt : null,
  };
}

/** "12,5% (2 de 16)" ou "Sem dados" (RNF-12: vírgula decimal). */
export function textoTaxa(taxa: number | null, faltas?: number, total?: number): string {
  if (taxa === null) return 'Sem dados';
  const pct = `${formatarDecimal(taxa * 100, 1)}%`;
  return faltas === undefined ? pct : `${pct} (${faltas} de ${total})`;
}

export type Novidades = { pedidosRemarcacao: Consulta[]; marcadasPeloPaciente: Consulta[]; canceladasPeloPaciente: Consulta[] };

/**
 * US-032/033/035 no painel: o que o paciente fez na agenda nos últimos 7 dias (e os pedidos de remarcação em aberto).
 * Plano 23 (§4.3): o pedido de consulta não conta (as marcadas são `STATUS_ATIVOS`; a retirada é `pedido_desistido`, não
 * `paciente`) — ele tem a fila própria (Solicitações).
 */
export async function novidadesDaAgenda(ctx: TenantContext, agora: Date, db: Db = getDb()): Promise<Novidades> {
  return withTenant(ctx, (tx) => novidadesDaAgendaNaTransacao(tx, agora), db);
}

/** As três listas numa transação (uma conexão), em sequência. */
export async function novidadesDaAgendaNaTransacao(tx: Tx, agora: Date): Promise<Novidades> {
  const semana = new Date(agora.getTime() - 7 * DIA_MS);
  const ativas = inArray(appointments.status, [...STATUS_ATIVOS]);
  const pedidosRemarcacao = await listarConsultasNaTransacao(tx, and(isNotNull(appointments.pedidoRemarcacaoEm), ativas, gte(appointments.inicio, agora)), { ordem: 'asc', limite: 20 });
  const marcadasPeloPaciente = await listarConsultasNaTransacao(tx, and(eq(appointments.origem, 'paciente'), gte(appointments.createdAt, semana), ativas), { ordem: 'asc', limite: 20 });
  const canceladasPeloPaciente = await listarConsultasNaTransacao(tx, and(eq(appointments.canceladoPor, 'paciente'), gte(appointments.canceladaEm, semana)), { ordem: 'desc', limite: 20 });
  return { pedidosRemarcacao, marcadasPeloPaciente, canceladasPeloPaciente };
}

/**
 * A regra de "Iniciar atendimento" (R11: uma regra num lugar só — a tela, via `consultaParaIniciarAtendimento`, e o
 * registro, via `registrarAtendimento`, sob a trava da consulta): não cancelada e já começada (no início em ponto, já
 * pode). "realizada"/"faltou" podem: registrar o atendimento corrige a falta. null = pode.
 * Plano 23 (§4.3): o pedido (`solicitada`) não recebe atendimento — `'pedido'`, antes de `'nao_comecou'` (aceitar antes).
 */
export function motivoParaNaoIniciarAtendimento(c: { status: string; inicio: Date }, agora: Date): 'cancelada' | 'pedido' | 'nao_comecou' | null {
  if (c.status === 'cancelada') return 'cancelada';
  if (c.status === 'solicitada') return 'pedido';
  if (c.inicio.getTime() > agora.getTime()) return 'nao_comecou';
  return null;
}

/**
 * Rodada 1: "Iniciar atendimento" — consulta deste paciente, que pode receber atendimento (`motivoParaNaoIniciarAtendimento`)
 * e ainda sem atendimento ligado. A página da consulta (link) e a de atendimentos (`?consulta=`: aviso e campo oculto)
 * usam esta função. Id inválido ou de outro paciente → null.
 */
export async function consultaParaIniciarAtendimento(ctx: TenantContext, patientId: string, id: string, agora: Date, db: Db = getDb()): Promise<Consulta | null> {
  if (!idValido(id) || !idValido(patientId)) return null;
  const onde = and(eq(appointments.id, id), eq(appointments.patientId, patientId), sql`not ${temAtendimento}`);
  const [c] = await listarConsultas(ctx, onde, { ordem: 'asc', limite: 1 }, db);
  return c && motivoParaNaoIniciarAtendimento(c, agora) === null ? c : null;
}
