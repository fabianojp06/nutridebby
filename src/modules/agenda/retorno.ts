import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lte, notExists, sql } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { appointments, consultations, patients } from '@/db/schema';
import { somarDias } from '@/modules/pacientes/datas';
import { STATUS_OCUPA } from './status';

/**
 * Plano 23 (US-410, RN-430): previsão de retorno. A data fica em `consultations.retorno_previsto_em` (entre a data do
 * atendimento e + 730 dias, CHECK `consultations_retorno_previsto_faixa`); não vai ao portal nem à IA (RN-439: este módulo
 * não pode ser alcançado a partir de `src/modules/ia`, guarda em `ia/guardas-agenda.test.ts`).
 */

/** Teto da previsão (RN-430): 2 anos depois da data do atendimento, como o CHECK do banco. */
export const DIAS_MAX_RETORNO = 730;

/**
 * "Em {n} semanas" a partir da data do atendimento (AAAA-MM-DD, já no fuso do consultório): aritmética de datas pura, sem
 * relógio nem fuso do servidor no meio.
 */
export function retornoEmSemanas(dataAtendimento: string, semanas: number): string {
  return somarDias(dataAtendimento, semanas * 7);
}

/** A previsão está na faixa da RN-430 (a própria data do atendimento até + 730 dias). Datas AAAA-MM-DD. */
export const previsaoNaFaixa = (dataAtendimento: string, previsao: string): boolean =>
  previsao >= dataAtendimento && previsao <= somarDias(dataAtendimento, DIAS_MAX_RETORNO);

/**
 * O marcador "Retorno previsto" da agenda (RN-430), de `de` a `ate` (AAAA-MM-DD, fechado): para cada paciente `ativo` e não
 * anonimizado, a previsão do ÚLTIMO atendimento com previsão (data, depois criação), só quando ele não tem consulta futura
 * em `STATUS_OCUPA` (agendada, confirmada ou o pedido que ainda não terminou em `agora`). Uma consulta só; só id, nome de
 * registro e data. Leitura da agenda: sem `auditRead` (RN-414, AG-D30). Roda na transação da sessão `nutri` de quem chama.
 */
export async function previsoesDeRetorno(tx: Tx, de: string, ate: string, filtro: { patientId?: string }, agora: Date = new Date()): Promise<{ patientId: string; nome: string; data: string }[]> {
  const ultima = tx
    .selectDistinctOn([consultations.patientId], { patientId: consultations.patientId, data: consultations.retornoPrevistoEm })
    .from(consultations)
    .where(and(isNotNull(consultations.retornoPrevistoEm), filtro.patientId ? eq(consultations.patientId, filtro.patientId) : undefined))
    .orderBy(consultations.patientId, sql`${consultations.data} desc`, sql`${consultations.createdAt} desc`, sql`${consultations.id} desc`)
    .as('ultima');
  // §4.3: o pedido (`solicitada`) também é consulta futura — com ele, o marcador some
  const futura = tx
    .select({ um: sql`1` })
    .from(appointments)
    .where(and(eq(appointments.tenantId, patients.tenantId), eq(appointments.patientId, patients.id), inArray(appointments.status, [...STATUS_OCUPA]), gt(appointments.fim, agora)));
  const rs = await tx
    .select({ patientId: patients.id, nome: patients.nome, data: sql<string>`${ultima.data}::text` })
    .from(ultima)
    .innerJoin(patients, eq(patients.id, ultima.patientId))
    .where(and(eq(patients.status, 'ativo'), isNull(patients.anonimizadoEm), gte(ultima.data, de), lte(ultima.data, ate), notExists(futura)))
    .orderBy(asc(ultima.data), asc(patients.nome), asc(patients.id));
  return rs.map((r) => ({ patientId: r.patientId, nome: r.nome, data: r.data }));
}
