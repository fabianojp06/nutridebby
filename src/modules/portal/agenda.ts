import { and, gt, inArray, lte, notInArray, or } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { horariosParaPaciente, locaisDoAgendamento, semanaDaJanela } from '@/modules/agenda/agendamento-paciente';
import { MAX_CONSULTAS_FUTURAS_PUBLICO } from '@/modules/agenda/constantes';
import { podeAlterarPeloPaciente } from '@/modules/agenda/cancelamento';
import { buscarConsulta, listarConsultas, STATUS_ATIVOS, type Consulta, type StatusConsulta, type TenantAgenda } from '@/modules/agenda/consultas';
import { inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { horariosVisiveis, type HorarioVisivel, type LocalVisivel } from '@/modules/agenda/horarios';
import { localDaConsulta, type LocalDaConsulta } from '@/modules/agenda/locais';
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
  /** Plano 23: o local da consulta (nulo na antiga) e, só em "Sua consulta", o nome e o endereço dele pela projeção. */
  localId: string | null;
  local: { nome: string | null; endereco: string | null } | null;
};

const paraPaciente = (c: Consulta, tenant: TenantAgenda, agora: Date, local: LocalDaConsulta | null = null): ConsultaDoPaciente => ({
  id: c.id,
  inicio: c.inicio,
  fim: c.fim,
  modalidade: c.modalidade,
  linkOnline: c.linkOnline,
  status: c.status,
  pedidoRemarcacao: c.pedidoRemarcacaoEm !== null,
  podeAlterar: (STATUS_ATIVOS as readonly string[]).includes(c.status) && podeAlterarPeloPaciente(c.inicio, tenant.cancelamentoMinH, agora),
  localId: c.localId,
  local: local ? { nome: local.nome, endereco: local.tipo === 'presencial' ? local.endereco : null } : null,
});

/** P06-09: "Minhas consultas" — a RLS por paciente entrega só as do paciente da sessão. Leitura da agenda sem auditRead (D10 do Plano 05). */
export async function consultasDoPaciente(ctx: TenantContext, tenant: TenantAgenda, agora: Date, db: Db = getDb()) {
  pacienteDaSessao(ctx, 'consultasDoPaciente');
  const ativas = inArray(appointments.status, [...STATUS_ATIVOS]);
  const proximas = await listarConsultas(ctx, and(ativas, gt(appointments.fim, agora)), { ordem: 'asc', limite: 20 }, db);
  const anteriores = await listarConsultas(ctx, or(lte(appointments.fim, agora), notInArray(appointments.status, [...STATUS_ATIVOS])), { ordem: 'desc', limite: 10 }, db);
  // T-1: o mesmo teto do servidor (RN-16, `agendarComoPaciente`): ativas que ainda vão começar; em andamento não conta
  const podeAgendar = proximas.filter((c) => c.inicio > agora).length < MAX_CONSULTAS_FUTURAS_PUBLICO;
  return { podeAgendar, proximas: proximas.map((c) => paraPaciente(c, tenant, agora)), anteriores: anteriores.map((c) => paraPaciente(c, tenant, agora)) };
}

/**
 * "Sua consulta". Plano 23 (US-402, RN-406): o local pela projeção `app_local_da_consulta` (a consulta do próprio paciente,
 * sem a sala), na sessão dele; `locais_atendimento` nunca é lida pela tabela fora da equipe.
 */
export async function consultaDoPaciente(ctx: TenantContext, tenant: TenantAgenda, id: string, agora: Date, db: Db = getDb()): Promise<ConsultaDoPaciente | null> {
  pacienteDaSessao(ctx, 'consultaDoPaciente');
  const c = await buscarConsulta(ctx, id, db);
  if (!c) return null;
  const local = c.localId ? await withTenant(ctx, (tx) => localDaConsulta(tx, c.id), db) : null;
  return paraPaciente(c, tenant, agora, local);
}

/**
 * Horários livres de uma semana da janela do paciente (RN-03), como no link da consulta. Plano 23 (I-13): com os locais com
 * agendamento pelo paciente (sem a sala); a tela filtra os horários pelo local escolhido.
 */
export async function horariosDaSemana(
  tenant: TenantAgenda,
  agora: Date,
  semana: unknown,
  ignorarConsultaId?: string,
): Promise<{ semana: string; primeira: string; ultima: string; horarios: HorarioVisivel[]; locais: LocalVisivel[] }> {
  const s = semanaDaJanela(semana, partesNoFuso(agora, tenant.fuso).data);
  const de = inicioDoDia(s.semana, tenant.fuso);
  const ate = inicioDoDia(somarDias(s.semana, 7), tenant.fuso);
  const horarios = horariosVisiveis(await horariosParaPaciente(tenant, agora, { de, ate, ignorarConsultaId }), tenant.fuso);
  return { ...s, horarios, locais: await locaisDoAgendamento(tenant) };
}
