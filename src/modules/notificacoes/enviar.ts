import { and, asc, eq, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { appointments, notifications, patients, type AppointmentRow, type NotificationRow, type PatientRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { renderEmail } from '@/email/templates';
import type { EmailTransport } from '@/email/transport';
import { logger } from '@/lib/logger';
import { buscarTenant, getTenantStatus, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { adiarLembrete, emHorarioSilencioso, ignorarPendentesDoTenant } from './agendar';
import { emailDaNotificacao } from './mensagens';
import { ehLembrete, type Canal, type MotivoIgnorada, type TipoLembrete } from './tipos';

export type ContextoEnvio = { n: NotificationRow; paciente: PatientRow; consulta: AppointmentRow | null; tenant: TenantRow; agora: Date };
export type Resultado =
  | { status: 'enviada'; providerMsgId?: string; providerJid?: string }
  | { status: 'ignorada'; motivo: MotivoIgnorada }
  | { status: 'repetir'; erro: string }
  | { status: 'falhou'; erro: string };
/** Tarefas 10 e 13 acrescentam `whatsapp` e `push` (e o ajudante `depsDeEnvio` de test/notificacoes.ts, R12). */
export type DepsEnvio = { db: Db; agora: () => Date; appUrl: string; chaveLinks: Buffer; email: { transport: EmailTransport; from: string } };

export const LOTE_POR_EXECUCAO = 40;
/** D6 (rodada 1): parte mínima de cada tenant numa volta do cron; o que sobrar do lote vai para quem encheu a parte. */
export const LOTE_MIN_POR_TENANT = 5;
/** D6: reservada há mais que isto = o worker caiu entre reservar e registrar. */
export const TRAVADA_MS = 15 * 60_000;
/** INT-02: e-mail em 1, 2 e 4 min; INT-01: WhatsApp em 1, 5 e 25 min; push como o WhatsApp. */
export const ESPERAS_S: Record<Canal, readonly number[]> = { email: [60, 120, 240], whatsapp: [60, 300, 1500], push: [60, 300, 1500] };

const ignorar = (motivo: MotivoIgnorada): Resultado => ({ status: 'ignorada', motivo });

/** Condições comuns a todos os canais, conferidas na hora do envio (D6). */
export function motivoParaIgnorar(c: ContextoEnvio): Resultado | null {
  if (!c.paciente || c.paciente.status !== 'ativo' || c.paciente.anonimizadoEm) return ignorar('paciente_inativo'); // RN-08, US-018
  if (!c.consulta || !(ehLembrete(c.n.tipo) || c.n.tipo === 'consulta_marcada')) return null;
  if (c.consulta.status === 'cancelada') return ignorar('consulta_cancelada');
  if (c.consulta.status === 'realizada' || c.consulta.status === 'faltou') return ignorar('consulta_encerrada');
  // D6/D17: linha planejada para outro horário (reservada antes de a nutricionista mudar a hora) não sai
  if (c.n.inicioConsulta && c.n.inicioConsulta.getTime() !== c.consulta.inicio.getTime()) return ignorar('consulta_remarcada');
  if (c.consulta.inicio.getTime() <= c.agora.getTime()) return ignorar('prazo_passado');
  return null;
}

async function enviarEmail(c: ContextoEnvio, deps: DepsEnvio): Promise<Resultado> {
  const msg = emailDaNotificacao(c, deps);
  if (!msg) return { status: 'falhou', erro: 'sem_modelo' };
  const r = renderEmail(msg);
  try {
    // D6: a mesma linha para o mesmo início de consulta tem a mesma chave → o Resend não duplica numa repetição
    const chave = `notificacao:${c.n.id}:${c.consulta?.inicio.toISOString() ?? 'sem-consulta'}`;
    await deps.email.transport.send({ from: deps.email.from, to: msg.para, subject: r.subject, html: r.html, text: r.text, idempotencyKey: chave });
    return { status: 'enviada' };
  } catch {
    return { status: 'repetir', erro: 'email' };
  }
}

/** Um envio por canal. Tarefa 10 troca `whatsapp`; Tarefa 13 troca `push`. */
const CANAIS_ENVIO: Record<Canal, (c: ContextoEnvio, deps: DepsEnvio) => Promise<Resultado>> = {
  email: enviarEmail,
  whatsapp: async () => ignorar('whatsapp_desligado'),
  push: async () => ignorar('push_desligado'),
};

/** As devidas (pendentes, vencidas) de alguns canais — e, se pedido, só de alguns tipos —, mais antigas primeiro, travadas com SKIP LOCKED. */
type Devidas = (canais: readonly Canal[], max: number, tipos?: readonly string[]) => Promise<NotificationRow[]>;

/** WhatsApps devidos desta rodada: quais reservar e quais já ficam sem cota (Tarefa 10: ritmo; Tarefa 11: cota). */
async function escolherWhatsapp(_tx: Tx, _tenant: TenantRow, _agora: Date, max: number, devidas: Devidas): Promise<{ reservar: NotificationRow[]; semCota: string[] }> {
  return { reservar: await devidas(['whatsapp'], max), semCota: [] };
}

/**
 * D7 na reserva (rodada 1 do /code-review): lembrete que venceu e sairia no horário silencioso — worker parado, conta
 * reativada à noite — não sai às 23:30. Na 1ª tentativa, vai para as 08:00 se ainda fizer sentido (`adiarLembrete`);
 * senão, "ignorada"/"horario_silencioso". Vale para os três canais (a RN-05 não distingue); novas tentativas seguem (D7).
 */
async function segurarSilenciosos(tx: Tx, tenant: TenantRow, agora: Date): Promise<void> {
  const ls = await tx
    .select({ id: notifications.id, tipo: notifications.tipo, inicio: appointments.inicio })
    .from(notifications)
    .innerJoin(appointments, eq(appointments.id, notifications.appointmentId))
    .where(and(eq(notifications.status, 'pendente'), lte(notifications.agendadaPara, agora), eq(notifications.tentativas, 0), inArray(notifications.tipo, ['lembrete_24h', 'lembrete_2h'])))
    .for('update', { of: notifications, skipLocked: true });
  for (const l of ls) {
    const para = adiarLembrete(l.tipo as TipoLembrete, l.inicio, tenant.fuso, agora);
    await tx
      .update(notifications)
      .set(para ? { agendadaPara: para, updatedAt: agora } : { status: 'ignorada', motivoIgnorada: 'horario_silencioso', updatedAt: agora })
      .where(eq(notifications.id, l.id));
  }
}

/**
 * D6: reserva o que venceu (pendente → enviando, tentativas + 1) numa transação curta; o envio acontece fora dela.
 * Rodada 1: canal por canal — e-mail e push primeiro, o WhatsApp com o que sobrar (e só com vaga no minuto, D16):
 * um acúmulo de WhatsApp nunca ocupa a vez dos outros canais.
 */
async function reservar(ctx: TenantContext, tenant: TenantRow, deps: DepsEnvio, agora: Date, limite: number): Promise<NotificationRow[]> {
  return withTenant(
    ctx,
    async (tx) => {
      // RN-15: relido sob trava — uma suspensão confirmada depois da leitura do tenant (processarTenant) não deixa nada
      // sair; o que ficou pendente vira "tenant_suspenso" no job "suspenso" ou na próxima volta
      if ((await getTenantStatus(tx, tenant.id, { aguardarSuspensao: true })) !== 'ativa') return [];
      if (emHorarioSilencioso(agora, tenant.fuso)) await segurarSilenciosos(tx, tenant, agora);
      const devidas: Devidas = async (canais, max, tipos) =>
        max <= 0
          ? []
          : tx
              .select()
              .from(notifications)
              .where(and(eq(notifications.status, 'pendente'), lte(notifications.agendadaPara, agora), inArray(notifications.canal, [...canais]), tipos ? inArray(notifications.tipo, [...tipos]) : undefined))
              .orderBy(asc(notifications.agendadaPara))
              .limit(max)
              .for('update', { skipLocked: true });
      const outras = await devidas(['email', 'push'], limite);
      const w = await escolherWhatsapp(tx, tenant, agora, limite - outras.length, devidas);
      if (w.semCota.length) await tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: 'cota_esgotada', updatedAt: agora }).where(inArray(notifications.id, w.semCota));
      const ids = [...outras, ...w.reservar].map((n) => n.id);
      if (!ids.length) return [];
      return tx.update(notifications).set({ status: 'enviando', tentativas: sql`${notifications.tentativas} + 1`, updatedAt: agora }).where(inArray(notifications.id, ids)).returning();
    },
    deps.db,
  );
}

async function carregarContexto(ctx: TenantContext, tenant: TenantRow, n: NotificationRow, deps: DepsEnvio): Promise<ContextoEnvio> {
  return withTenant(
    ctx,
    async (tx) => {
      const [paciente] = await tx.select().from(patients).where(eq(patients.id, n.patientId));
      const [consulta] = n.appointmentId ? await tx.select().from(appointments).where(eq(appointments.id, n.appointmentId)) : [];
      return { n, paciente, consulta: consulta ?? null, tenant, agora: deps.agora() };
    },
    deps.db,
  );
}

/** INT-01: WhatsApp de lembrete que falhou de vez → o e-mail do mesmo lembrete sai de novo, se tinha falhado. */
async function aoFalhar(tx: Tx, n: NotificationRow, agora: Date): Promise<void> {
  if (n.canal !== 'whatsapp' || !ehLembrete(n.tipo) || !n.appointmentId) return;
  await tx
    .update(notifications)
    .set({ status: 'pendente', agendadaPara: agora, tentativas: 0, erro: null, updatedAt: agora })
    // o e-mail do MESMO horário da consulta (CHECK: com consulta, `inicio_consulta` existe)
    .where(and(eq(notifications.appointmentId, n.appointmentId), eq(notifications.inicioConsulta, n.inicioConsulta!), eq(notifications.canal, 'email'), eq(notifications.tipo, n.tipo), eq(notifications.status, 'falhou')));
}

/** Tarefa 11: depois de um envio aceito (aviso de 80% da cota). Por enquanto, nada. */
const aposEnvio: (tx: Tx, tenant: TenantRow, n: NotificationRow, agora: Date) => Promise<void> = async () => {};

async function registrarResultado(ctx: TenantContext, tenant: TenantRow, n: NotificationRow, r: Resultado, deps: DepsEnvio): Promise<void> {
  const agora = deps.agora();
  await withTenant(
    ctx,
    async (tx) => {
      const onde = and(eq(notifications.id, n.id), eq(notifications.status, 'enviando'));
      if (r.status === 'enviada') {
        const [ok] = await tx
          .update(notifications)
          .set({ status: 'enviada', motivoIgnorada: null, enviadaEm: agora, providerMsgId: r.providerMsgId ?? null, providerJid: r.providerJid ?? null, erro: null, conteudoSelado: null, updatedAt: agora })
          .where(onde)
          .returning();
        if (ok) await aposEnvio(tx, tenant, ok, agora);
        return;
      }
      if (r.status === 'ignorada') {
        await tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: r.motivo, conteudoSelado: null, updatedAt: agora }).where(onde);
        return;
      }
      const esperas = ESPERAS_S[n.canal as Canal];
      if (r.status === 'repetir' && n.tentativas <= esperas.length) {
        await tx.update(notifications).set({ status: 'pendente', agendadaPara: new Date(agora.getTime() + esperas[n.tentativas - 1] * 1000), erro: r.erro, updatedAt: agora }).where(onde);
        return;
      }
      const [f] = await tx.update(notifications).set({ status: 'falhou', erro: r.erro, conteudoSelado: null, updatedAt: agora }).where(onde).returning();
      if (f) await aoFalhar(tx, f, agora);
    },
    deps.db,
  );
}

async function enviarUma(ctx: TenantContext, tenant: TenantRow, n: NotificationRow, deps: DepsEnvio): Promise<void> {
  let r: Resultado;
  try {
    const c = await carregarContexto(ctx, tenant, n, deps);
    r = motivoParaIgnorar(c) ?? (await CANAIS_ENVIO[n.canal as Canal](c, deps));
  } catch (err) {
    // RNF-11: só o nome do erro (mensagens de provedor podem trazer número ou e-mail)
    logger.warn({ tenantId: ctx.tenantId, notificacaoId: n.id, canal: n.canal, err: err instanceof Error ? err.name : 'erro' }, 'falha ao enviar notificação');
    r = { status: 'repetir', erro: 'excecao' };
  }
  await registrarResultado(ctx, tenant, n, r, deps);
  logger.info({ tenantId: ctx.tenantId, notificacaoId: n.id, canal: n.canal, tipo: n.tipo, resultado: r.status, motivo: r.status === 'ignorada' ? r.motivo : undefined, erro: 'erro' in r ? r.erro : undefined }, 'notificação processada');
}

/** D6: worker caiu entre reservar e registrar. E-mail tem chave de idempotência → volta; WhatsApp e push não (no máximo 1, US-034). */
async function destravar(ctx: TenantContext, deps: DepsEnvio, agora: Date): Promise<void> {
  const limite = new Date(agora.getTime() - TRAVADA_MS);
  await withTenant(
    ctx,
    async (tx) => {
      await tx.update(notifications).set({ status: 'pendente', updatedAt: agora }).where(and(eq(notifications.status, 'enviando'), eq(notifications.canal, 'email'), lt(notifications.updatedAt, limite)));
      const falhas = await tx
        .update(notifications)
        .set({ status: 'falhou', erro: 'interrompido', conteudoSelado: null, updatedAt: agora })
        .where(and(eq(notifications.status, 'enviando'), ne(notifications.canal, 'email'), lt(notifications.updatedAt, limite)))
        .returning();
      for (const f of falhas) await aoFalhar(tx, f, agora);
    },
    deps.db,
  );
}

async function processarTenant(tenantId: string, deps: DepsEnvio, limite: number): Promise<number> {
  const tenant = await buscarTenant(deps.db, tenantId);
  if (!tenant) return 0;
  const agora = deps.agora();
  if (tenant.status !== 'ativa') {
    await ignorarPendentesDoTenant(deps.db, tenantId, agora); // RN-15 / US-004
    return 0;
  }
  const ctx: TenantContext = { tenantId, role: 'worker' };
  await destravar(ctx, deps, agora);
  const lote = await reservar(ctx, tenant, deps, agora, limite);
  for (const n of lote) await enviarUma(ctx, tenant, n, deps);
  return lote.length;
}

/** D6 (rodada 1): a cada minuto a volta do cron começa num tenant diferente — com mais tenants que lote, ninguém fica sempre por último. */
export function ordemDaRodada<T>(ids: readonly T[], agora: Date): T[] {
  if (!ids.length) return [];
  const k = Math.floor(agora.getTime() / 60_000) % ids.length;
  return [...ids.slice(k), ...ids.slice(0, k)];
}

async function processarComSeguranca(tenantId: string, deps: DepsEnvio, limite: number): Promise<number> {
  try {
    return await processarTenant(tenantId, deps, limite);
  } catch (err) {
    // um tenant com problema não para os outros; o que ficou "enviando" é destravado na próxima volta
    logger.error({ tenantId, err: err instanceof Error ? err.name : 'erro' }, 'falha ao processar as notificações do tenant');
    return 0;
  }
}

/**
 * RN-05: varre os tenants (cron de 1 min) ou só um (envio imediato); no máximo LOTE_POR_EXECUCAO por execução.
 * Rodada 1 (D6): cada tenant tem uma parte do lote (`max(5, 40 ÷ tenants)`) numa volta que começa num tenant diferente
 * a cada minuto; o que sobrar vai, numa segunda passada, para quem encheu a parte.
 */
export async function processarNotificacoes(deps: DepsEnvio, opts: { tenantId?: string } = {}): Promise<{ processadas: number }> {
  // R14: o envio imediato de um tenant não lista os outros. Na volta do cron, ordem estável (por id) antes do rodízio:
  // a ordem física de `tenants` muda com qualquer UPDATE (status, cota)
  const alvos = opts.tenantId ? [opts.tenantId] : ordemDaRodada((await listarTenantsParaVarredura(deps.db)).map((t) => t.id).sort(), deps.agora());
  const parte = Math.max(LOTE_MIN_POR_TENANT, Math.ceil(LOTE_POR_EXECUCAO / Math.max(1, alvos.length)));
  let processadas = 0;
  const cheios: string[] = [];
  for (const tenantId of alvos) {
    if (processadas >= LOTE_POR_EXECUCAO) break;
    const limite = Math.min(parte, LOTE_POR_EXECUCAO - processadas);
    const n = await processarComSeguranca(tenantId, deps, limite);
    processadas += n;
    if (n >= limite) cheios.push(tenantId);
  }
  for (const tenantId of cheios) {
    if (processadas >= LOTE_POR_EXECUCAO) break;
    processadas += await processarComSeguranca(tenantId, deps, LOTE_POR_EXECUCAO - processadas);
  }
  return { processadas };
}
