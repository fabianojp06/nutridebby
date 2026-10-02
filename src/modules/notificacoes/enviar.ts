import { and, asc, count, eq, gt, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { appointments, notifications, patients, pushSubscriptions, type AppointmentRow, type NotificationRow, type PatientRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { renderEmail } from '@/email/templates';
import type { EmailTransport } from '@/email/transport';
import { logger, nomeDoErro } from '@/lib/logger';
import { buscarTenant, getTenantStatus, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { adiarLembrete, ANTECEDENCIA_MS, emHorarioSilencioso, fallbackPorEmail, ignorarPendentesDoTenant, lembreteFazSentido } from './agendar';
import { emailDaNotificacao, pushDaNotificacao, textoWhatsapp } from './mensagens';
import type { InscricaoPush, ProvedorPush, ResultadoPush } from './push';
import { ehLembrete, type Canal, type MotivoIgnorada, type TipoLembrete } from './tipos';
import { lerConexao } from './whatsapp/conexao';
import { avisarSeChegou80, CONTA_COTA, contaCota, FORA_DA_COTA, usoDoMes } from './whatsapp/cota';
import { digitosDoE164, type ProvedorWhatsapp, type ResultadoEnvio } from './whatsapp/provedor';

export type ContextoEnvio = { n: NotificationRow; paciente: PatientRow; consulta: AppointmentRow | null; tenant: TenantRow; agora: Date };
export type Resultado =
  | { status: 'enviada'; providerMsgId?: string; providerJid?: string }
  | { status: 'ignorada'; motivo: MotivoIgnorada }
  | { status: 'repetir'; erro: string }
  | { status: 'falhou'; erro: string };
/** Padrões dos testes no ajudante `depsDeEnvio` (test/notificacoes.ts, R12). */
export type DepsEnvio = {
  db: Db;
  agora: () => Date;
  appUrl: string;
  chaveLinks: Buffer;
  email: { transport: EmailTransport; from: string };
  /** null = WhatsApp desligado na plataforma (sem as variáveis da Evolution). */
  whatsapp: ProvedorWhatsapp | null;
  /** null = push desligado na plataforma (sem as variáveis do VAPID, D19). */
  push: ProvedorPush | null;
};

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
  // US-010 (rodada 1 da T14): o convite por WhatsApp que ainda estava na fila quando o paciente aceitou pelo e-mail não sai
  if (c.n.tipo === 'convite_paciente' && c.paciente.userId) return ignorar('convite_aceito');
  // lembretes, "Consulta marcada" e a resposta a "1"/"2" (T12) falam de uma consulta num horário: conferidos aqui
  if (!c.consulta || !(ehLembrete(c.n.tipo) || c.n.tipo === 'consulta_marcada' || c.n.tipo === 'resposta_confirmacao' || c.n.tipo === 'resposta_remarcar')) return null;
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
  } catch (err) {
    // RNF-11: só o nome do erro — a mensagem do provedor pode trazer o destinatário
    logger.warn({ tenantId: c.tenant.id, notificacaoId: c.n.id, canal: 'email', err: nomeDoErro(err) }, 'falha no transporte de e-mail');
    return { status: 'repetir', erro: 'email' };
  }
}

/**
 * INT-01 (Evolution): pré-condições na hora do envio (D6). A conexão é lida numa transação própria, já fechada quando o
 * provedor é chamado (uma conexão por transação). Só a falha passageira repete; a definitiva — e o timeout, em que não se
 * sabe se a mensagem saiu — não (no máximo uma vez, D6).
 */
async function enviarWhatsapp(c: ContextoEnvio, deps: DepsEnvio): Promise<Resultado> {
  if (!deps.whatsapp) return ignorar('whatsapp_desligado');
  const conexao = await withTenant({ tenantId: c.tenant.id, role: 'worker' }, lerConexao, deps.db);
  if (!conexao || conexao.estado !== 'conectada') return ignorar('whatsapp_desconectado');
  if (!c.paciente.whatsappOptinEm || c.paciente.whatsappOptoutEm) return ignorar('sem_optin'); // INT-01: opt-in antes de qualquer mensagem
  if (!c.paciente.telefoneE164) return ignorar('sem_telefone');
  const texto = textoWhatsapp(c, deps);
  if (!texto) return { status: 'falhou', erro: 'sem_modelo' };
  let r: ResultadoEnvio;
  try {
    r = await deps.whatsapp.enviarTexto({ instancia: conexao.instancia, numero: digitosDoE164(c.paciente.telefoneE164), texto });
  } catch (err) {
    // o provedor devolve as falhas como resultado; se lançar, não se sabe se a mensagem saiu: não repete (D6)
    logger.warn({ tenantId: c.tenant.id, notificacaoId: c.n.id, canal: 'whatsapp', err: nomeDoErro(err) }, 'falha no provedor de WhatsApp');
    return { status: 'falhou', erro: 'sem_resposta' };
  }
  if (r.ok) return { status: 'enviada', providerMsgId: r.id, providerJid: r.jid };
  return r.definitivo ? { status: 'falhou', erro: r.codigo } : { status: 'repetir', erro: r.codigo };
}

/** D19: o push vale até o início da consulta (no máximo 24 h; o serviço descarta depois disso o que não entregou). */
const TTL_PUSH_MAX_S = 86_400;

/**
 * INT-03 (D14, D19): todos os dispositivos do vínculo. As inscrições são lidas numa transação já fechada quando o
 * serviço de push é chamado (uma conexão por transação); as mortas ou inválidas (404/410, endereço recusado, chaves
 * que não cifram) são apagadas numa transação própria, depois. D6 (no máximo uma vez): algum dispositivo recebeu →
 * "enviada", os outros não recebem de novo; algum pode ter recebido (resultado incerto: timeout, conexão caída depois
 * de enviar, exceção do provedor) → "falhou"/"sem_resposta", sem nova tentativa — nem pela falha passageira de outro
 * dispositivo, que reenviaria a todos (rodada 1). Só repete se nenhum recebeu, nenhum ficou incerto e alguma falha foi
 * passageira. Todas mortas = "sem_inscricao".
 */
async function enviarPush(c: ContextoEnvio, deps: DepsEnvio): Promise<Resultado> {
  if (!deps.push) return ignorar('push_desligado');
  const ctx: TenantContext = { tenantId: c.tenant.id, role: 'worker' };
  const inscricoes = await withTenant(
    ctx,
    (tx) => tx.select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth }).from(pushSubscriptions).where(eq(pushSubscriptions.patientId, c.paciente.id)),
    deps.db,
  );
  if (!inscricoes.length) return ignorar('sem_inscricao');
  const p = pushDaNotificacao(c, deps);
  if (!p) return { status: 'falhou', erro: 'sem_modelo' };
  const ate = c.consulta ? Math.round((c.consulta.inicio.getTime() - c.agora.getTime()) / 1000) : TTL_PUSH_MAX_S;
  const ttl = Math.min(TTL_PUSH_MAX_S, Math.max(60, ate));
  const payload = JSON.stringify(p);
  let entregues = 0;
  let incerta: string | null = null;
  let passageira: string | null = null;
  let definitiva: string | null = null;
  const mortas: string[] = [];
  for (const i of inscricoes) {
    const r = await enviarAoDispositivo(c, deps.push, i, payload, ttl);
    if (r.ok) entregues++;
    else if (r.remover) mortas.push(i.id);
    else if (r.incerto) incerta ??= r.codigo;
    else if (r.definitivo) definitiva ??= r.codigo;
    else passageira ??= r.codigo;
  }
  if (mortas.length) {
    try {
      await withTenant(ctx, (tx) => tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, mortas)), deps.db);
    } catch (err) {
      // a mensagem já pode ter saído para outro dispositivo: a falha da limpeza não vira nova tentativa (D6); a próxima limpa
      logger.warn({ tenantId: c.tenant.id, notificacaoId: c.n.id, canal: 'push', err: nomeDoErro(err) }, 'falha ao apagar inscrições de push');
    }
  }
  if (entregues) return { status: 'enviada' };
  if (incerta) return { status: 'falhou', erro: incerta };
  if (passageira) return { status: 'repetir', erro: passageira };
  if (definitiva) return { status: 'falhou', erro: definitiva };
  return ignorar('sem_inscricao'); // todas mortas (404/410)
}

/** O provedor devolve as falhas como resultado; se lançar, não se sabe se saiu: não repete (D6), como o WhatsApp. */
async function enviarAoDispositivo(c: ContextoEnvio, push: ProvedorPush, i: InscricaoPush, payload: string, ttl: number): Promise<ResultadoPush> {
  try {
    return await push.enviar(i, payload, ttl);
  } catch (err) {
    // RNF-11: só o nome do erro — a mensagem pode trazer o endpoint do dispositivo
    logger.warn({ tenantId: c.tenant.id, notificacaoId: c.n.id, canal: 'push', err: nomeDoErro(err) }, 'falha no provedor de push');
    return { ok: false, remover: false, definitivo: true, incerto: true, codigo: 'sem_resposta' };
  }
}

/** Um envio por canal. */
const CANAIS_ENVIO: Record<Canal, (c: ContextoEnvio, deps: DepsEnvio) => Promise<Resultado>> = {
  email: enviarEmail,
  whatsapp: enviarWhatsapp,
  push: enviarPush,
};

/** As devidas (pendentes, vencidas) de alguns canais — e, se pedido, só de alguns tipos —, mais antigas primeiro, travadas com SKIP LOCKED. */
type Devidas = (canais: readonly Canal[], max: number, tipos?: readonly string[]) => Promise<NotificationRow[]>;

/** D16: no máximo 8 WhatsApps por minuto por tenant (anti-bloqueio). O que passar fica "pendente" para a próxima volta. */
export const WHATSAPP_POR_MINUTO = 8;

/**
 * D16: vagas do minuto deste tenant — as que saíram no último minuto e as que estão saindo ocupam vaga. A trava (até o
 * fim da transação da reserva) faz um worker por vez decidir o ritmo do tenant, mesmo que um dia haja mais de um.
 */
async function vagasDoMinuto(tx: Tx, tenant: TenantRow, agora: Date): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('whatsapp-envio'), hashtext(${tenant.id}))`);
  const [{ n }] = await tx
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.canal, 'whatsapp'), or(eq(notifications.status, 'enviando'), gt(notifications.enviadaEm, new Date(agora.getTime() - 60_000)))));
  return Math.max(0, WHATSAPP_POR_MINUTO - n);
}

/**
 * D15 + D16: cota do mês (RN-09) e ritmo de 8/min. Cota esgotada (o uso do mês, contado no início da volta, já chegou
 * à cota) → os que contam viram "cota_esgotada" já, sem gastar vaga; sem vaga no minuto → nem busca (fica para a
 * próxima volta). Com saldo, a volta reserva no máximo o saldo; o que passar dele fica "pendente", como no ritmo: a
 * próxima volta reconta pelo uso real — uma reservada que o envio ignora (sem opt-in, desconectado…) não gasta a cota
 * das outras (rodada 1 da revisão). E-mail e push já foram reservados antes (D6). Sem provedor (`ligado` falso), nada
 * sai: nem trava do ritmo nem cota — as linhas viram "whatsapp_desligado" no envio.
 */
async function escolherWhatsapp(tx: Tx, tenant: TenantRow, agora: Date, max: number, devidas: Devidas, ligado: boolean): Promise<{ reservar: NotificationRow[]; semCota: string[] }> {
  if (max <= 0) return { reservar: [], semCota: [] };
  if (!ligado) return { reservar: await devidas(['whatsapp'], max), semCota: [] };
  const livres = Math.min(max, await vagasDoMinuto(tx, tenant, agora));
  // a cota vem do tenant lido nesta volta e o uso é contado agora, sob a trava do ritmo: o admin ampliar vale na hora
  let saldo = tenant.waCotaMensal - (await usoDoMes(tx, tenant.fuso, agora, { comEnviando: true }));
  if (saldo <= 0) {
    const semCota = (await devidas(['whatsapp'], max, CONTA_COTA)).map((n) => n.id);
    return { reservar: livres > 0 ? await devidas(['whatsapp'], livres, FORA_DA_COTA) : [], semCota };
  }
  const reservar: NotificationRow[] = [];
  for (const n of livres > 0 ? await devidas(['whatsapp'], livres) : []) {
    if (contaCota(n.tipo)) {
      if (saldo <= 0) continue; // sem saldo nesta volta: fica "pendente" (a trava do SKIP LOCKED sai com a transação)
      saldo--;
    }
    reservar.push(n);
  }
  return { reservar, semCota: [] };
}

/**
 * D7 na reserva (rodada 1 do /code-review): lembrete que venceu e sairia no horário silencioso — worker parado, conta
 * reativada à noite — não sai às 23:30. Na 1ª tentativa, vai para as 08:00 se ainda fizer sentido (`adiarLembrete`);
 * senão, "ignorada"/"horario_silencioso". Fora do silêncio (revisão da T5), o de 24 h atrasado que perdeu o sentido — o
 * de 2 h já venceu e cobre a reta final — não sai junto dele: "ignorada"/"prazo_passado". Vale para os três canais (a
 * RN-05 não distingue); novas tentativas seguem (D7).
 */
async function segurarAtrasados(tx: Tx, tenant: TenantRow, agora: Date): Promise<void> {
  const silencio = emHorarioSilencioso(agora, tenant.fuso);
  const ls = await tx
    .select({ id: notifications.id, tipo: notifications.tipo, inicio: appointments.inicio })
    .from(notifications)
    .innerJoin(appointments, eq(appointments.id, notifications.appointmentId))
    .where(
      and(
        eq(notifications.status, 'pendente'),
        lte(notifications.agendadaPara, agora),
        eq(notifications.tentativas, 0),
        silencio
          ? inArray(notifications.tipo, ['lembrete_24h', 'lembrete_2h'])
          : // fora do silêncio, só o de 24 h que pode ter perdido o sentido: a consulta começa em até 2 h
            and(eq(notifications.tipo, 'lembrete_24h'), lte(appointments.inicio, new Date(agora.getTime() + ANTECEDENCIA_MS.lembrete_2h))),
      ),
    )
    .for('update', { of: notifications, skipLocked: true });
  for (const l of ls) {
    const tipo = l.tipo as TipoLembrete;
    if (silencio) {
      const para = adiarLembrete(tipo, l.inicio, tenant.fuso, agora);
      await tx
        .update(notifications)
        .set(para ? { agendadaPara: para, updatedAt: agora } : { status: 'ignorada', motivoIgnorada: 'horario_silencioso', updatedAt: agora })
        .where(eq(notifications.id, l.id));
    } else if (!lembreteFazSentido(tipo, l.inicio, tenant.fuso, agora)) {
      await tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: 'prazo_passado', updatedAt: agora }).where(eq(notifications.id, l.id));
    }
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
      await segurarAtrasados(tx, tenant, agora);
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
      const w = await escolherWhatsapp(tx, tenant, agora, limite - outras.length, devidas, deps.whatsapp !== null);
      if (w.semCota.length) await tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: 'cota_esgotada', conteudoSelado: null, updatedAt: agora }).where(inArray(notifications.id, w.semCota));
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

/**
 * Depois de um envio aceito: o aviso de 80% da cota (US-036). Revisão da T7: nada aqui trava `appointments` nem
 * `patients` (avisarPaciente espera as linhas "enviando" que esta transação trava) — só a conexão do tenant. Num
 * savepoint: a falha do aviso não desfaz o registro do envio (a mensagem já saiu, D6) nem para o lote; o próximo
 * envio que conta tenta avisar de novo (a marca do mês também volta).
 */
async function aposEnvio(tx: Tx, tenant: TenantRow, n: NotificationRow, agora: Date, appUrl: string): Promise<void> {
  if (n.canal !== 'whatsapp' || !contaCota(n.tipo)) return;
  try {
    await tx.transaction((sp) => avisarSeChegou80(sp, tenant, agora, appUrl));
  } catch (err) {
    logger.warn({ tenantId: tenant.id, notificacaoId: n.id, err: nomeDoErro(err) }, 'falha no aviso de 80% da cota de WhatsApp');
  }
}

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
        if (ok) await aposEnvio(tx, tenant, ok, agora, deps.appUrl);
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
      if (f) await fallbackPorEmail(tx, f, agora);
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
    logger.warn({ tenantId: ctx.tenantId, notificacaoId: n.id, canal: n.canal, err: nomeDoErro(err) }, 'falha ao enviar notificação');
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
      for (const f of falhas) await fallbackPorEmail(tx, f, agora);
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
    logger.error({ tenantId, err: nomeDoErro(err) }, 'falha ao processar as notificações do tenant');
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
