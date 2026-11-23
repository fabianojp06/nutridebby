import { and, count, eq, gt, inArray, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { agendarLembretes, avisarPaciente, dispararEnvio } from '@/modules/notificacoes/agendar';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { dataValida } from '@/modules/pacientes/datas';
import { avisarNutriDaConsulta } from './aviso-nutri';
import { JANELA_PACIENTE_DIAS, JANELA_RESPOSTA_PEDIDO_H, MAX_CONSULTAS_FUTURAS_PUBLICO, MSG_AGENDA } from './constantes';
import { ConsultaError, ehSobreposicao, horariosLivres, repetirSeDeadlock, type TenantAgenda } from './consultas';
import { segundaDaSemana, somarDias } from './fuso';
import type { Horario, LocalVisivel, Modalidade } from './horarios';
import { locaisParaAgendamento, locaisVisiveis } from './locais';
import { STATUS_OCUPA } from './status';

export type HorarioEscolhido = Horario & { modalidade: Modalidade };

/**
 * RN-03: o paciente marca a partir de agora + `antecedencia_min_h` e até 60 dias. Plano 23 (AG-D41): com a chave dos pedidos
 * ligada, mais `JANELA_RESPOSTA_PEDIDO_H` (12 h) — todo pedido dá ao menos 12 h para a resposta. A janela é só a oferta:
 * quem decide o status é o gatilho (vale também para a remarcação, que nasce agendada, AG-D24).
 */
export function janelaDoPaciente(tenant: Pick<TenantAgenda, 'antecedenciaMinH'> & Partial<Pick<TenantAgenda, 'agendaConfirmarPedidos'>>, agora: Date): { de: Date; ate: Date } {
  const horas = tenant.antecedenciaMinH + (tenant.agendaConfirmarPedidos ? JANELA_RESPOSTA_PEDIDO_H : 0);
  return { de: new Date(agora.getTime() + horas * 3_600_000), ate: new Date(agora.getTime() + JANELA_PACIENTE_DIAS * 86_400_000) };
}

/**
 * Plano 23 (RN-425, AG-D65): a trava dos pedidos do consultório (classe própria, a mesma de `app_pedido_aguardar`). Ordem
 * global: e-mail → tenant → paciente → consulta/pedido → notificações. No portal, no começo da transação, antes de
 * `carregarPacienteParaEscrita` — nunca dentro de `gravarConsultaDoPaciente`.
 */
export async function travarPedidosDoTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agenda-pedidos-tenant'), hashtext(${tenantId}))`);
}

/**
 * Plano 23 (RN-425, P23-M7): sob a trava do tenant, o horário não pode cruzar um pedido de pessoa nova aguardando
 * (`app_pedidos_aguardando`: só intervalos, nos papéis `paciente` e `publico`, AG-D58). Cruzou → "acabou de ser ocupado".
 */
async function conferirAguardando(tx: Tx, h: Pick<Horario, 'inicio' | 'fim'>): Promise<void> {
  const r = await tx.execute(sql`select 1 from app_pedidos_aguardando(${h.inicio}, ${h.fim}) as t(r) limit 1`);
  if (r.rows.length) throw new ConsultaError({ inicio: MSG_AGENDA.ocupado });
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
 * ocupação e local). Qualquer outra coisa — inclusive lixo no campo — é "não está mais disponível".
 * Plano 23 (AG-D60): o par início-local escolhido, nunca o primeiro horário do instante (com dois locais no mesmo instante,
 * o outro local daria "não está mais disponível" ou marcaria no lugar errado); a modalidade é o tipo do local.
 * Lê o banco por uma conexão própria: chamar ANTES de abrir a transação da gravação, nunca dentro dela (o EXCLUDE
 * decide a corrida na gravação).
 */
export async function escolherHorario(tenant: TenantAgenda, inicio: unknown, localId: unknown, agora: Date, opts: { db?: Db; ignorarConsultaId?: string } = {}): Promise<HorarioEscolhido> {
  const indisponivel = () => new ConsultaError({ inicio: MSG_AGENDA.indisponivel });
  const t = typeof inicio === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(inicio) ? Date.parse(inicio) : NaN;
  if (!Number.isFinite(t) || typeof localId !== 'string' || !idValido(localId)) throw indisponivel();
  const alvo = new Date(t);
  const hs = await horariosParaPaciente(tenant, agora, { ...opts, de: alvo, ate: new Date(t + 60_000) });
  const h = hs.find((x) => x.inicio.getTime() === t && x.localId === localId);
  if (!h) throw indisponivel();
  return { ...h, modalidade: h.modalidades[0] };
}

/**
 * Plano 23 (US-403, RN-405, AG-D40): os locais da escolha do portal, da página pública e do link — os ativos com "Aceita
 * agendamento pelo paciente", pela projeção (sem a sala), no contexto `publico`. Não olha a chave da página pública: o
 * portal oferece com ela desligada.
 */
export async function locaisDoAgendamento(tenant: Pick<TenantAgenda, 'id'>, opts: { db?: Db } = {}): Promise<LocalVisivel[]> {
  return locaisVisiveis(await withTenant({ tenantId: tenant.id, role: 'publico' }, (tx) => locaisParaAgendamento(tx), opts.db ?? getDb()));
}

/**
 * Plano 23 (RN-406): o gatilho `appointments_link_da_sala` recusa (42501) a consulta do paciente num local arquivado ou sem
 * agendamento pelo paciente — o local mudou entre a tela e o envio. Só esse 42501 (pela mensagem fixa do gatilho, 0127): uma
 * recusa da RLS continua sendo erro.
 */
export function localRecusado(err: unknown): boolean {
  let e: unknown = err;
  let codigo = false;
  let mensagem = false;
  for (let i = 0; e && typeof e === 'object' && i < 5; i++) {
    const pg = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (pg.code === '42501') codigo = true;
    if (typeof pg.message === 'string' && pg.message.includes('o local não aceita agendamento pelo paciente')) mensagem = true;
    e = pg.cause;
  }
  return codigo && mensagem;
}

/**
 * Grava a consulta do paciente e tudo o que vem junto, na transação de quem chama: lembretes (RN-05),
 * "Consulta marcada" ao paciente, aviso à nutricionista (D18) e envio imediato. O 23P01 sobe para quem chama.
 * A consulta é a linha recém-inserida nesta transação: ninguém mais a vê, então `avisarPaciente` já a tem sozinha.
 * Plano 23 (AG-D53): o status é do gatilho (a chave lida no banco), lido do RETURNING: `solicitada` não tem lembrete nem
 * "consulta marcada" — só o aviso "Novo pedido de consulta" à nutricionista (com o link da fila); `agendada`, como sempre.
 */
export async function gravarConsultaDoPaciente(
  tx: Tx,
  tenant: TenantAgenda,
  p: Pick<PatientRow, 'id' | 'nome'>,
  h: HorarioEscolhido,
  o: { agora: Date; appUrl: string; evento: 'marcada' | 'remarcada' | 'novo_paciente_publico'; remarcadaDe?: string },
): Promise<{ id: string; status: 'agendada' | 'solicitada' }> {
  const [c] = await tx
    .insert(appointments)
    .values({
      tenantId: tenant.id,
      patientId: p.id,
      inicio: h.inicio,
      fim: h.fim,
      modalidade: h.modalidade,
      // Plano 23 (RN-406): o local do horário; o link da consulta online é a sala do local, copiada pelo gatilho
      // appointments_link_da_sala (o local com agendamento pelo paciente sempre tem sala: CHECK locais_atendimento_agendamento);
      // local arquivado ou sem agendamento entre a escolha e aqui → 42501 do gatilho (`localRecusado`)
      localId: h.localId,
      linkOnline: null,
      status: 'agendada',
      origem: 'paciente',
      remarcadaDe: o.remarcadaDe ?? null,
      createdAt: o.agora,
      updatedAt: o.agora,
    })
    .returning({ id: appointments.id, status: appointments.status });
  if (c.status === 'solicitada') {
    await avisarNutriDaConsulta(tx, tenant, { id: c.id, inicio: h.inicio, paciente: p.nome }, 'pedido', o.appUrl);
    return { id: c.id, status: 'solicitada' };
  }
  const alvo = { tenantId: tenant.id, patientId: p.id, appointmentId: c.id, inicio: h.inicio };
  await agendarLembretes(tx, alvo, tenant.fuso, o.agora);
  await avisarPaciente(tx, alvo, 'consulta_marcada', o.agora);
  await avisarNutriDaConsulta(tx, tenant, { id: c.id, inicio: h.inicio, paciente: p.nome }, o.evento, o.appUrl);
  await dispararEnvio(tx, tenant.id);
  return { id: c.id, status: 'agendada' };
}

/**
 * US-032 (P05-03): o paciente da sessão marca um horário livre. A RLS por paciente garante que só grava
 * para si; o EXCLUDE decide a corrida com outro paciente (D9). A tela é do Plano 06 (P06-09).
 * Revisão da T12 do Plano 06: o mesmo teto da página pública (RN-16, 3 consultas futuras ativas) vale aqui — sem ele, o
 * "Entrar (já sou paciente)" levava do caminho com teto para um sem teto (e-mails à nutricionista, lembretes na cota do
 * WhatsApp, agenda tomada). Contado sob a trava do paciente (`carregarPacienteParaEscrita`, FOR UPDATE): dois pedidos ao
 * mesmo tempo não passam juntos do teto. Remarcar não passa por aqui (troca uma consulta por outra).
 * Plano 23 (§4.3): o pedido (`solicitada`) conta no teto (`STATUS_OCUPA`).
 */
export async function agendarComoPaciente(
  ctx: TenantContext,
  tenant: TenantAgenda,
  input: { inicio: unknown; localId: unknown },
  deps: { db?: Db; now?: Date; appUrl?: string } = {},
): Promise<{ id: string; status: 'agendada' | 'solicitada' }> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('agendarComoPaciente exige sessão de paciente');
  if (tenant.status !== 'ativa') throw new ConsultaError({ geral: MSG_AGENDA.contaIndisponivel }); // RN-15
  const db = deps.db ?? getDb();
  const agora = deps.now ?? new Date();
  try {
    // 40P01 na corrida do EXCLUDE: a escolha do horário e a gravação de novo, uma vez (repetirSeDeadlock)
    return await repetirSeDeadlock(async () => {
      const h = await escolherHorario(tenant, input.inicio, input.localId, agora, { db });
      return withTenant(
        ctx,
        async (tx) => {
          await travarPedidosDoTenant(tx, tenant.id); // AG-D65: tenant → paciente
          const p = await carregarPacienteParaEscrita(tx, ctx.patientId!);
          if (p.status !== 'ativo') throw new ConsultaError({ geral: MSG_AGENDA.naoAgendavel }); // RN-08
          const [{ n }] = await tx
            .select({ n: count() })
            .from(appointments)
            .where(and(eq(appointments.patientId, p.id), inArray(appointments.status, STATUS_OCUPA), gt(appointments.inicio, agora)));
          if (n >= MAX_CONSULTAS_FUTURAS_PUBLICO) throw new ConsultaError({ geral: MSG_AGENDA.limitePublico }); // RN-16
          await conferirAguardando(tx, h); // RN-425
          return gravarConsultaDoPaciente(tx, tenant, p, h, { agora, appUrl: deps.appUrl ?? getEnv().APP_URL, evento: 'marcada' });
        },
        db,
      );
    });
  } catch (e) {
    if (ehSobreposicao(e)) throw new ConsultaError({ inicio: MSG_AGENDA.ocupado }); // RN-03
    if (localRecusado(e)) throw new ConsultaError({ inicio: MSG_AGENDA.indisponivel }); // Plano 23: local mudou no meio
    throw e;
  }
}
