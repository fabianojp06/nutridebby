import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { agendarLembretes, avisarPaciente, dispararEnvio } from '@/modules/notificacoes/agendar';
import { carregarPacienteParaEscrita } from '@/modules/pacientes/base';
import { dataValida } from '@/modules/pacientes/datas';
import { avisarNutriDaConsulta } from './aviso-nutri';
import { JANELA_PACIENTE_DIAS, MSG_AGENDA } from './constantes';
import { ConsultaError, ehSobreposicao, horariosLivres, repetirSeDeadlock, type TenantAgenda } from './consultas';
import { segundaDaSemana, somarDias } from './fuso';
import type { Horario, Modalidade } from './horarios';

export type HorarioEscolhido = Horario & { modalidade: Modalidade };

/** RN-03: o paciente marca a partir de agora + `antecedencia_min_h` e até 60 dias. */
export function janelaDoPaciente(tenant: Pick<TenantAgenda, 'antecedenciaMinH'>, agora: Date): { de: Date; ate: Date } {
  return { de: new Date(agora.getTime() + tenant.antecedenciaMinH * 3_600_000), ate: new Date(agora.getTime() + JANELA_PACIENTE_DIAS * 86_400_000) };
}

/**
 * Semana pedida (`?semana=AAAA-MM-DD`, começando na segunda), presa às semanas da janela do paciente (RN-03: até 60
 * dias). Data inválida ou fora da janela — inclusive 9999-12-31 — vira a primeira ou a última semana: nenhuma data do
 * visitante chega ao cálculo de horários sem teto. `hoje` é a data no fuso do tenant.
 */
export function semanaDaJanela(pedida: unknown, hoje: string): { semana: string; primeira: string; ultima: string } {
  const primeira = segundaDaSemana(hoje);
  const ultima = segundaDaSemana(somarDias(hoje, JANELA_PACIENTE_DIAS));
  const s = typeof pedida === 'string' && dataValida(pedida) ? segundaDaSemana(pedida) : primeira;
  return { semana: s < primeira ? primeira : s > ultima ? ultima : s, primeira, ultima };
}

/** Horários livres para o paciente, opcionalmente recortados (uma semana da página pública). */
export async function horariosParaPaciente(tenant: TenantAgenda, agora: Date, opts: { db?: Db; de?: Date; ate?: Date; ignorarConsultaId?: string } = {}): Promise<Horario[]> {
  const j = janelaDoPaciente(tenant, agora);
  const de = opts.de && opts.de.getTime() > j.de.getTime() ? opts.de : j.de;
  const ate = opts.ate && opts.ate.getTime() < j.ate.getTime() ? opts.ate : j.ate;
  return horariosLivres(tenant, de, ate, { db: opts.db, ignorarConsultaId: opts.ignorarConsultaId });
}

/**
 * O horário que o paciente escolheu precisa ser, agora, um horário livre oferecido (janela, regras, bloqueios,
 * ocupação e modalidade). Qualquer outra coisa — inclusive lixo no campo — é "não está mais disponível".
 * Lê o banco por uma conexão própria: chamar ANTES de abrir a transação da gravação, nunca dentro dela (o EXCLUDE
 * decide a corrida na gravação).
 */
export async function escolherHorario(tenant: TenantAgenda, inicio: unknown, modalidade: unknown, agora: Date, opts: { db?: Db; ignorarConsultaId?: string } = {}): Promise<HorarioEscolhido> {
  const indisponivel = () => new ConsultaError({ inicio: MSG_AGENDA.indisponivel });
  const t = typeof inicio === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(inicio) ? Date.parse(inicio) : NaN;
  if (!Number.isFinite(t) || (modalidade !== 'presencial' && modalidade !== 'online')) throw indisponivel();
  const alvo = new Date(t);
  const [h] = await horariosParaPaciente(tenant, agora, { ...opts, de: alvo, ate: new Date(t + 60_000) });
  if (!h || h.inicio.getTime() !== t || !h.modalidades.includes(modalidade)) throw indisponivel();
  return { ...h, modalidade };
}

/**
 * Grava a consulta do paciente e tudo o que vem junto, na transação de quem chama: lembretes (RN-05),
 * "Consulta marcada" ao paciente, aviso à nutricionista (D18) e envio imediato. O 23P01 sobe para quem chama.
 * A consulta é a linha recém-inserida nesta transação: ninguém mais a vê, então `avisarPaciente` já a tem sozinha.
 */
export async function gravarConsultaDoPaciente(
  tx: Tx,
  tenant: TenantAgenda,
  p: Pick<PatientRow, 'id' | 'nome'>,
  h: HorarioEscolhido,
  o: { agora: Date; appUrl: string; evento: 'marcada' | 'remarcada' | 'novo_paciente_publico'; remarcadaDe?: string },
): Promise<string> {
  const [c] = await tx
    .insert(appointments)
    .values({
      tenantId: tenant.id,
      patientId: p.id,
      inicio: h.inicio,
      fim: h.fim,
      modalidade: h.modalidade,
      linkOnline: h.modalidade === 'online' ? tenant.linkOnlinePadrao : null,
      status: 'agendada',
      origem: 'paciente',
      remarcadaDe: o.remarcadaDe ?? null,
      createdAt: o.agora,
      updatedAt: o.agora,
    })
    .returning({ id: appointments.id });
  const alvo = { tenantId: tenant.id, patientId: p.id, appointmentId: c.id, inicio: h.inicio };
  await agendarLembretes(tx, alvo, tenant.fuso, o.agora);
  await avisarPaciente(tx, alvo, 'consulta_marcada', o.agora);
  await avisarNutriDaConsulta(tx, tenant, { id: c.id, inicio: h.inicio, paciente: p.nome }, o.evento, o.appUrl);
  await dispararEnvio(tx, tenant.id);
  return c.id;
}

/**
 * US-032 (P05-03): o paciente da sessão marca um horário livre. A RLS por paciente garante que só grava
 * para si; o EXCLUDE decide a corrida com outro paciente (D9). A tela é do Plano 06 (P06-09).
 */
export async function agendarComoPaciente(
  ctx: TenantContext,
  tenant: TenantAgenda,
  input: { inicio: unknown; modalidade: unknown },
  deps: { db?: Db; now?: Date; appUrl?: string } = {},
): Promise<{ id: string }> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('agendarComoPaciente exige sessão de paciente');
  if (tenant.status !== 'ativa') throw new ConsultaError({ geral: MSG_AGENDA.contaIndisponivel }); // RN-15
  const db = deps.db ?? getDb();
  const agora = deps.now ?? new Date();
  try {
    // 40P01 na corrida do EXCLUDE: a escolha do horário e a gravação de novo, uma vez (repetirSeDeadlock)
    return await repetirSeDeadlock(async () => {
      const h = await escolherHorario(tenant, input.inicio, input.modalidade, agora, { db });
      return withTenant(
        ctx,
        async (tx) => {
          const p = await carregarPacienteParaEscrita(tx, ctx.patientId!);
          if (p.status !== 'ativo') throw new ConsultaError({ geral: MSG_AGENDA.naoAgendavel }); // RN-08
          return { id: await gravarConsultaDoPaciente(tx, tenant, p, h, { agora, appUrl: deps.appUrl ?? getEnv().APP_URL, evento: 'marcada' }) };
        },
        db,
      );
    });
  } catch (e) {
    if (ehSobreposicao(e)) throw new ConsultaError({ inicio: MSG_AGENDA.ocupado }); // RN-03
    throw e;
  }
}
