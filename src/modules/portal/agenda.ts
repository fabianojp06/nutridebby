import { and, gt, inArray, lte, notInArray, or } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { horariosParaPaciente, semanaDaJanela } from '@/modules/agenda/agendamento-paciente';
import { podeAlterarPeloPaciente } from '@/modules/agenda/cancelamento';
import { buscarConsulta, listarConsultas, STATUS_ATIVOS, type Consulta, type StatusConsulta, type TenantAgenda } from '@/modules/agenda/consultas';
import { inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { horariosVisiveis, type HorarioVisivel } from '@/modules/agenda/horarios';
import { pacienteDaSessao } from './sessao';

export type ConsultaDoPaciente = {
  id: string;
  inicio: Date;
  fim: Date;
  modalidade: 'presencial' | 'online';
  linkOnline: string | null;
  status: StatusConsulta;
  pedidoRemarcacao: boolean;
  podeAlterar: boolean;
};

const paraPaciente = (c: Consulta, tenant: TenantAgenda, agora: Date): ConsultaDoPaciente => ({
  id: c.id,
  inicio: c.inicio,
  fim: c.fim,
  modalidade: c.modalidade,
  linkOnline: c.linkOnline,
  status: c.status,
  pedidoRemarcacao: c.pedidoRemarcacaoEm !== null,
  podeAlterar: (STATUS_ATIVOS as readonly string[]).includes(c.status) && podeAlterarPeloPaciente(c.inicio, tenant.cancelamentoMinH, agora),
});

/** P06-09: "Minhas consultas" — a RLS por paciente entrega só as do paciente da sessão. Leitura da agenda sem auditRead (D10 do Plano 05). */
export async function consultasDoPaciente(ctx: TenantContext, tenant: TenantAgenda, agora: Date, db: Db = getDb()) {
  pacienteDaSessao(ctx, 'consultasDoPaciente');
  const ativas = inArray(appointments.status, [...STATUS_ATIVOS]);
  const proximas = await listarConsultas(ctx, and(ativas, gt(appointments.fim, agora)), { ordem: 'asc', limite: 20 }, db);
  const anteriores = await listarConsultas(ctx, or(lte(appointments.fim, agora), notInArray(appointments.status, [...STATUS_ATIVOS])), { ordem: 'desc', limite: 10 }, db);
  return { proximas: proximas.map((c) => paraPaciente(c, tenant, agora)), anteriores: anteriores.map((c) => paraPaciente(c, tenant, agora)) };
}

export async function consultaDoPaciente(ctx: TenantContext, tenant: TenantAgenda, id: string, agora: Date, db: Db = getDb()): Promise<ConsultaDoPaciente | null> {
  pacienteDaSessao(ctx, 'consultaDoPaciente');
  const c = await buscarConsulta(ctx, id, db);
  return c ? paraPaciente(c, tenant, agora) : null;
}

/** Horários livres de uma semana da janela do paciente (RN-03), como no link da consulta. */
export async function horariosDaSemana(tenant: TenantAgenda, agora: Date, semana: unknown, ignorarConsultaId?: string): Promise<{ semana: string; primeira: string; ultima: string; horarios: HorarioVisivel[] }> {
  const s = semanaDaJanela(semana, partesNoFuso(agora, tenant.fuso).data);
  const de = inicioDoDia(s.semana, tenant.fuso);
  const ate = inicioDoDia(somarDias(s.semana, 7), tenant.fuso);
  const horarios = horariosVisiveis(await horariosParaPaciente(tenant, agora, { de, ate, ignorarConsultaId }), tenant.fuso);
  return { ...s, horarios };
}
