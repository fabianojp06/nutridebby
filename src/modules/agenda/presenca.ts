import { and, count, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { formatarDecimal } from '@/lib/numero';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { MSG_AGENDA } from './constantes';
import { ConsultaError, ConsultaNaoEncontradaError, lerConsultaParaEscrita, listarConsultas, STATUS_ATIVOS, type Consulta } from './consultas';
import { inicioDoMes, inicioDoMesSeguinte } from './fuso';

export const MSG_PRESENCA = {
  antesDoInicio: 'A presença só pode ser registrada depois do início da consulta.',
  registrada: 'Presença registrada.',
  pendencias: (n: number) => `${n} ${n === 1 ? 'consulta' : 'consultas'} sem registro de presença`,
} as const;

export type SituacaoPresenca = 'realizada' | 'faltou';
const DIA_MS = 86_400_000;

/**
 * US-037: depois do início, "realizada" ou "faltou" (pode corrigir). Cancelada não. Paciente bloqueado (pedido de
 * exclusão) → PacienteBloqueadoError, como em moverConsulta. Ordem das travas: paciente → consulta.
 */
export async function registrarPresenca(ctx: TenantContext, id: string, situacao: SituacaoPresenca, deps: { db?: Db; now?: Date } = {}): Promise<void> {
  const agora = deps.now ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      if (!idValido(id)) throw new ConsultaNaoEncontradaError();
      const [antes] = await tx.select({ patientId: appointments.patientId }).from(appointments).where(eq(appointments.id, id));
      if (!antes) throw new ConsultaNaoEncontradaError();
      await carregarPacienteParaEscrita(tx, antes.patientId);
      const c = await lerConsultaParaEscrita(tx, id);
      if (c.status === 'cancelada') throw new ConsultaError({ geral: MSG_AGENDA.naoAlteravel });
      if (c.inicio.getTime() > agora.getTime()) throw new ConsultaError({ geral: MSG_PRESENCA.antesDoInicio });
      if (c.status === situacao) return;
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
