import { and, count, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments, consultations } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { formatarDecimal } from '@/lib/numero';
import { idValido } from '@/modules/pacientes/base';
import { travarPacienteDaConsulta } from './cancelamento';
import { MSG_AGENDA } from './constantes';
import { ConsultaError, lerConsultaParaEscrita, listarConsultas, STATUS_ATIVOS, type Consulta } from './consultas';
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
 */
export async function registrarPresenca(ctx: TenantContext, id: string, situacao: SituacaoPresenca, deps: { db?: Db; now?: Date } = {}): Promise<void> {
  const agora = deps.now ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      await travarPacienteDaConsulta(tx, id); // id inválido ou de outro tenant → ConsultaNaoEncontradaError
      const c = await lerConsultaParaEscrita(tx, id);
      if (c.status === 'cancelada') throw new ConsultaError({ geral: MSG_AGENDA.naoAlteravel });
      if (c.inicio.getTime() > agora.getTime()) throw new ConsultaError({ geral: MSG_PRESENCA.antesDoInicio });
      if (c.status === situacao) return;
      if (situacao === 'faltou') {
        const [a] = await tx.select({ id: consultations.id }).from(consultations).where(eq(consultations.appointmentId, id)).limit(1);
        if (a) throw new ConsultaError({ geral: MSG_PRESENCA.temAtendimento });
      }
      await tx.update(appointments).set({ status: situacao, presencaEm: agora, updatedAt: agora }).where(eq(appointments.id, id));
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
  const [r] = await withTenant(ctx, (tx) => tx.select({ n: count() }).from(appointments).where(semRegistro(agora)), db);
  return r.n;
}

export type Indicadores = { consultasMes: number; faltasMes: number; iniciadasMes: number; taxaMes: number | null; taxaMesAnterior: number | null };

/** CS-03 / D21: mês civil no fuso do tenant; taxa = faltas ÷ consultas não canceladas já iniciadas. Uma transação. */
export async function indicadoresDaAgenda(ctx: TenantContext, fuso: string, agora: Date, db: Db = getDb()): Promise<Indicadores> {
  const ini = inicioDoMes(agora, fuso);
  const anterior = inicioDoMes(new Date(ini.getTime() - 1), fuso);
  const fim = inicioDoMesSeguinte(agora, fuso);
  const doMes = sql`${appointments.inicio} >= ${ini}`;
  const [r] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({
          total: sql<number>`count(*) filter (where ${doMes} and ${appointments.status} <> 'cancelada')`.mapWith(Number),
          iniciadas: sql<number>`count(*) filter (where ${doMes} and ${appointments.status} <> 'cancelada' and ${appointments.inicio} <= ${agora})`.mapWith(Number),
          faltas: sql<number>`count(*) filter (where ${doMes} and ${appointments.status} = 'faltou')`.mapWith(Number),
          iniciadasAnt: sql<number>`count(*) filter (where ${appointments.inicio} < ${ini} and ${appointments.status} <> 'cancelada' and ${appointments.inicio} <= ${agora})`.mapWith(Number),
          faltasAnt: sql<number>`count(*) filter (where ${appointments.inicio} < ${ini} and ${appointments.status} = 'faltou')`.mapWith(Number),
        })
        .from(appointments)
        .where(and(gte(appointments.inicio, anterior), lt(appointments.inicio, fim))),
    db,
  );
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

/** US-032/033/035 no painel: o que o paciente fez na agenda nos últimos 7 dias (e os pedidos de remarcação em aberto). */
export async function novidadesDaAgenda(ctx: TenantContext, agora: Date, db: Db = getDb()): Promise<Novidades> {
  const semana = new Date(agora.getTime() - 7 * DIA_MS);
  const ativas = inArray(appointments.status, [...STATUS_ATIVOS]);
  // em sequência: cada lista é uma transação (uma conexão por vez)
  const pedidosRemarcacao = await listarConsultas(ctx, and(isNotNull(appointments.pedidoRemarcacaoEm), ativas, gte(appointments.inicio, agora)), { ordem: 'asc', limite: 20 }, db);
  const marcadasPeloPaciente = await listarConsultas(ctx, and(eq(appointments.origem, 'paciente'), gte(appointments.createdAt, semana), ativas), { ordem: 'asc', limite: 20 }, db);
  const canceladasPeloPaciente = await listarConsultas(ctx, and(eq(appointments.canceladoPor, 'paciente'), gte(appointments.canceladaEm, semana)), { ordem: 'desc', limite: 20 }, db);
  return { pedidosRemarcacao, marcadasPeloPaciente, canceladasPeloPaciente };
}

/**
 * Rodada 1: "Iniciar atendimento" — consulta deste paciente, já começada, não cancelada e ainda sem atendimento ligado
 * (inclusive "realizada"/"faltou": registrar o atendimento corrige a falta). A página da consulta (link) e a de
 * atendimentos (`?consulta=`: aviso e campo oculto) usam a mesma regra. Id inválido ou de outro paciente → null.
 */
export async function consultaParaIniciarAtendimento(ctx: TenantContext, patientId: string, id: string, agora: Date, db: Db = getDb()): Promise<Consulta | null> {
  if (!idValido(id) || !idValido(patientId)) return null;
  const onde = and(eq(appointments.id, id), eq(appointments.patientId, patientId), ne(appointments.status, 'cancelada'), lte(appointments.inicio, agora), sql`not ${temAtendimento}`);
  return (await listarConsultas(ctx, onde, { ordem: 'asc', limite: 1 }, db))[0] ?? null;
}
