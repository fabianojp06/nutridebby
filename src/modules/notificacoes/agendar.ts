import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, notifications, tipoUmPorHorario, TIPOS_UM_POR_HORARIO, type NotificationRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { paraInstante, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { buscarTenant, getTenantStatus } from '@/modules/plataforma/tenant-status';
import { CANAIS, ehLembrete, type TipoLembrete } from './tipos';

export const ANTECEDENCIA_MS: Record<TipoLembrete, number> = { lembrete_24h: 24 * 3_600_000, lembrete_2h: 2 * 3_600_000 };

/** RN-05 / D7: [21:00, 08:00) no fuso do tenant; 08:00 em ponto vale. */
export function emHorarioSilencioso(instante: Date, fuso: string): boolean {
  const { minutos } = partesNoFuso(instante, fuso);
  return minutos >= 21 * 60 || minutos < 8 * 60;
}

/** As próximas 08:00 no fuso do tenant (o fim do horário silencioso em que `agora` está). 08:00 sempre existe (DST não mexe nessa hora). */
export function fimDoSilencio(agora: Date, fuso: string): Date {
  const { data, minutos } = partesNoFuso(agora, fuso);
  return paraInstante(minutos >= 21 * 60 ? somarDias(data, 1) : data, '08:00', fuso)!;
}

/**
 * D7: o lembrete ainda faz sentido se sair em `quando` — o de 24 h só até o lembrete de 2 h (que cobre a reta final), ou
 * até 30 min antes do início quando o de 2 h caiu no silêncio; o de 2 h, até 30 min antes. Vale para o adiamento às
 * 08:00 e para o atrasado fora do silêncio (revisão da T5: o de 24 h não sai junto do de 2 h).
 */
export function lembreteFazSentido(tipo: TipoLembrete, inicio: Date, fuso: string, quando: Date): boolean {
  const de2h = new Date(inicio.getTime() - ANTECEDENCIA_MS.lembrete_2h);
  if (tipo === 'lembrete_24h' && !emHorarioSilencioso(de2h, fuso)) return quando.getTime() < de2h.getTime();
  return quando.getTime() <= inicio.getTime() - 30 * 60_000;
}

/**
 * D7 na reserva (rodada 1 do /code-review): lembrete que venceu e sairia no horário silencioso (worker parado,
 * reativação à noite) vai para as 08:00 se ainda fizer sentido (`lembreteFazSentido`). Senão, null (ignorar).
 */
export function adiarLembrete(tipo: TipoLembrete, inicio: Date, fuso: string, agora: Date): Date | null {
  const as8 = fimDoSilencio(agora, fuso);
  return lembreteFazSentido(tipo, inicio, fuso, as8) ? as8 : null;
}

export type PlanoLembrete = { tipo: TipoLembrete; agendadaPara: Date } & ({ status: 'pendente' } | { status: 'ignorada'; motivo: 'prazo_passado' | 'horario_silencioso' });

/** RN-05: 24 h e 2 h antes; horário já passado ou silencioso → "ignorada" com o motivo (não é adiado). */
export function planejarLembretes(inicio: Date, fuso: string, agora: Date): PlanoLembrete[] {
  return (Object.keys(ANTECEDENCIA_MS) as TipoLembrete[]).map((tipo) => {
    const agendadaPara = new Date(inicio.getTime() - ANTECEDENCIA_MS[tipo]);
    if (agendadaPara.getTime() <= agora.getTime()) return { tipo, agendadaPara, status: 'ignorada', motivo: 'prazo_passado' };
    if (emHorarioSilencioso(agendadaPara, fuso)) return { tipo, agendadaPara, status: 'ignorada', motivo: 'horario_silencioso' };
    return { tipo, agendadaPara, status: 'pendente' };
  });
}

export type ConsultaParaLembrete = { tenantId: string; patientId: string; appointmentId: string; inicio: Date };
type Linha = Pick<typeof notifications.$inferInsert, 'tenantId' | 'patientId' | 'appointmentId' | 'inicioConsulta' | 'canal' | 'tipo' | 'status' | 'motivoIgnorada' | 'agendadaPara'>;

/**
 * D6 (rodada 1 do /code-review): para os tipos de TIPOS_UM_POR_HORARIO, (consulta, canal, tipo, início da consulta) é
 * único (índice parcial `notifications_versao_unique`). Marcar de novo no mesmo horário ou reativar reescreve só a linha
 * que NÃO saiu (`pendente`, `ignorada`, `falhou`); a enviada (e a que está saindo) é imutável — não volta a "pendente"
 * nem perde `enviada_em`/`provider_msg_id` (cota, métricas, histórico). Só para esses tipos: aviso de evento não passa aqui.
 */
async function gravar(tx: Tx, linhas: Linha[], agora: Date): Promise<void> {
  if (!linhas.length) return;
  if (linhas.some((l) => !(TIPOS_UM_POR_HORARIO as readonly string[]).includes(l.tipo))) throw new Error('gravar: tipo fora da chave única (aviso de evento usa avisarPaciente)');
  await tx
    .insert(notifications)
    .values(linhas.map((l) => ({ ...l, tentativas: 0, createdAt: agora, updatedAt: agora })))
    .onConflictDoUpdate({
      target: [notifications.appointmentId, notifications.canal, notifications.tipo, notifications.inicioConsulta],
      targetWhere: tipoUmPorHorario(notifications.tipo),
      set: { status: sql`excluded.status`, motivoIgnorada: sql`excluded.motivo_ignorada`, agendadaPara: sql`excluded.agendada_para`, tentativas: 0, erro: null, updatedAt: agora },
      setWhere: inArray(notifications.status, ['pendente', 'ignorada', 'falhou']),
    });
}

/** D17 (rodada 1): o horário da consulta mudou — o que ainda não saiu para o horário antigo vira "consulta_remarcada". */
async function descartarHorarioAntigo(tx: Tx, c: ConsultaParaLembrete, agora: Date): Promise<void> {
  await tx
    .update(notifications)
    .set({ status: 'ignorada', motivoIgnorada: 'consulta_remarcada', updatedAt: agora })
    .where(and(eq(notifications.appointmentId, c.appointmentId), eq(notifications.status, 'pendente'), ne(notifications.inicioConsulta, c.inicio)));
}

/** RN-05 / D6: 24 h e 2 h antes, nos três canais; as condições de cada canal são conferidas no envio. */
export async function agendarLembretes(tx: Tx, c: ConsultaParaLembrete, fuso: string, agora: Date): Promise<void> {
  await descartarHorarioAntigo(tx, c, agora);
  await gravar(
    tx,
    planejarLembretes(c.inicio, fuso, agora).flatMap((p) =>
      CANAIS.map((canal) => ({
        tenantId: c.tenantId,
        patientId: c.patientId,
        appointmentId: c.appointmentId,
        inicioConsulta: c.inicio,
        canal,
        tipo: p.tipo,
        status: p.status,
        motivoIgnorada: p.status === 'ignorada' ? p.motivo : null,
        agendadaPara: p.agendadaPara,
      })),
    ),
    agora,
  );
}

/**
 * US-031 / US-033: "Consulta marcada" (também a cada mudança do início) e "Consulta cancelada", por e-mail e push, já.
 * Aviso de evento, fora da chave única: cada evento ganha linhas próprias — voltar a um início que já teve aviso enviado
 * avisa de novo (14:00 → 15:00 → 14:00 = 3 avisos). O aviso do mesmo tipo ainda pendente para outro início vira
 * "consulta_remarcada"; o que já saiu (ou está saindo) fica como está. Idempotente: o mesmo evento (mesmo tipo e início,
 * aviso ainda pendente ou saindo — `enviando`, revisão da T5) não gera um segundo: 14:00 (saindo) → 15:00 → 14:00 não manda
 * dois "14:00". Quem chama segura a trava da consulta (`lerConsultaParaEscrita`, ou a linha recém-criada na mesma
 * transação): duas chamadas para a mesma consulta não correm juntas.
 * Plano 23 (RN-428): `pedido_nao_confirmado` (recusa e vencimento do pedido), também por e-mail e push — nada por WhatsApp —,
 * inclusive de horário que já passou. `quando` (AG-D75): o "não confirmado" fora do horário silencioso sai às 08:00
 * (`agendada_para`); sem ele, já.
 */
export async function avisarPaciente(
  tx: Tx,
  c: ConsultaParaLembrete,
  tipo: 'consulta_marcada' | 'consulta_cancelada' | 'pedido_nao_confirmado',
  agora: Date,
  quando: Date = agora,
): Promise<void> {
  // D22: consulta que já começou — encaixe registrado depois, ou cancelamento que só acerta a agenda — não gera aviso.
  // Plano 23 (RN-428): o "não confirmado" sai mesmo assim (o pedido vencido com antecedência 0 ou depois de o worker parar)
  if (tipo !== 'pedido_nao_confirmado' && c.inicio.getTime() <= agora.getTime()) return;
  const naFila = await tx
    .select({ id: notifications.id, canal: notifications.canal, status: notifications.status, inicioConsulta: notifications.inicioConsulta })
    .from(notifications)
    .where(and(eq(notifications.appointmentId, c.appointmentId), eq(notifications.tipo, tipo), inArray(notifications.status, ['pendente', 'enviando'])))
    .for('update');
  const doMesmoInicio = (p: (typeof naFila)[number]) => p.inicioConsulta?.getTime() === c.inicio.getTime();
  // só o pendente é descartado; o que está saindo é do worker (D6) — se for de outro início, o envio o ignora
  const deOutroInicio = naFila.filter((p) => p.status === 'pendente' && !doMesmoInicio(p)).map((p) => p.id);
  if (deOutroInicio.length) {
    await tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: 'consulta_remarcada', updatedAt: agora }).where(inArray(notifications.id, deOutroInicio));
  }
  const jaAvisados = new Set(naFila.filter(doMesmoInicio).map((p) => p.canal));
  const canais = (['email', 'push'] as const).filter((canal) => !jaAvisados.has(canal));
  if (!canais.length) return;
  await tx.insert(notifications).values(
    canais.map((canal) => ({ tenantId: c.tenantId, patientId: c.patientId, appointmentId: c.appointmentId, inicioConsulta: c.inicio, canal, tipo, status: 'pendente', agendadaPara: quando, createdAt: agora, updatedAt: agora })),
  );
}

/**
 * US-033: o que ainda não saiu da(s) consulta(s) cancelada(s) vira "ignorada". O texto cifrado (`conteudo_selado`) é
 * apagado como em toda saída final (o banco exige; fechamento do Plano 05).
 */
export async function cancelarLembretes(tx: Tx, appointmentId: string | readonly string[], agora: Date): Promise<void> {
  const ids = typeof appointmentId === 'string' ? [appointmentId] : [...appointmentId];
  if (!ids.length) return;
  await tx
    .update(notifications)
    .set({ status: 'ignorada', motivoIgnorada: 'consulta_cancelada', conteudoSelado: null, updatedAt: agora })
    .where(and(inArray(notifications.appointmentId, ids), eq(notifications.status, 'pendente'), inArray(notifications.tipo, ['lembrete_24h', 'lembrete_2h', 'consulta_marcada'])));
}

/**
 * INT-01: WhatsApp de lembrete que falhou de vez (no envio, preso em "enviando" ou ERROR no webhook) → o e-mail do mesmo
 * lembrete sai de novo, se tinha falhado. R1: mora aqui (e não em enviar.ts) para a rota do webhook não importar o
 * motor de envio (push/web-push só no worker).
 * Travas (revisão da T5): quem chama já segura a linha do WhatsApp, e `gravar` trava o e-mail antes do WhatsApp — esperar
 * o e-mail aqui inverteria a ordem (deadlock). Por isso SKIP LOCKED: se o e-mail está travado, quem o trava é `gravar`
 * (a consulta voltou a este horário), que reescreve a linha que não saiu — o mesmo resultado de rodar depois dele.
 */
export async function fallbackPorEmail(tx: Tx, n: NotificationRow, agora: Date): Promise<void> {
  if (n.canal !== 'whatsapp' || !ehLembrete(n.tipo) || !n.appointmentId || !n.inicioConsulta) return;
  const emails = await tx
    .select({ id: notifications.id })
    .from(notifications)
    // o e-mail do MESMO horário da consulta (CHECK: com consulta, `inicio_consulta` existe)
    .where(and(eq(notifications.appointmentId, n.appointmentId), eq(notifications.inicioConsulta, n.inicioConsulta), eq(notifications.canal, 'email'), eq(notifications.tipo, n.tipo), eq(notifications.status, 'falhou')))
    .for('update', { skipLocked: true });
  if (!emails.length) return;
  await tx
    .update(notifications)
    .set({ status: 'pendente', agendadaPara: agora, tentativas: 0, erro: null, updatedAt: agora })
    .where(inArray(notifications.id, emails.map((e) => e.id)));
}

/**
 * US-010 "Convite também por WhatsApp" (decisão do dono, rodada 1 da T14): só um aviso, sem o link — o texto é montado
 * no envio (`textoConviteWhatsapp`, com o e-mail atual do paciente) e a linha não guarda conteúdo. Sai já (D7: responde a
 * uma ação de agora, fora do horário silencioso) e conta na cota (D15). Sem consulta: fora da chave única por horário.
 * As condições (opt-in, telefone, conexão, cota, convite ainda não aceito) são conferidas no envio (D6).
 */
export async function agendarConviteWhatsapp(tx: Tx, o: { tenantId: string; patientId: string }, agora: Date): Promise<void> {
  await tx.insert(notifications).values({
    tenantId: o.tenantId,
    patientId: o.patientId,
    appointmentId: null,
    canal: 'whatsapp',
    tipo: 'convite_paciente',
    agendadaPara: agora,
    createdAt: agora,
    updatedAt: agora,
  });
  await dispararEnvio(tx, o.tenantId);
}

/** Envio já (sem esperar a varredura do minuto): enfileira a varredura só deste tenant, na mesma transação. */
export async function dispararEnvio(tx: Tx, tenantId: string): Promise<void> {
  const id = await (await getBoss()).send('notificacoes', { tenantId }, { db: fromDrizzle(tx, sql) });
  if (!id) throw new Error('A fila de notificações recusou o envio');
}

/**
 * US-004 / RN-15: tenant suspenso — nada pendente sai. Roda no worker (o admin nunca toca tabela 🔒). Rodada 1: o
 * status é relido sob trava (`FOR SHARE` em `tenants`, na mesma transação). Um job "suspenso" atrasado, que roda
 * depois da reativação, não ignora nada; uma reativação concorrente espera esta transação e o job "reativado" dela
 * reagenda o que foi ignorado aqui. O texto cifrado (`conteudo_selado`) é apagado como em toda saída final (revisão da
 * T11; o banco exige). O convite por WhatsApp não tem consulta e não volta na reativação — o e-mail do convite vale.
 */
export async function ignorarPendentesDoTenant(db: Db, tenantId: string, agora: Date): Promise<void> {
  await withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      if ((await getTenantStatus(tx, tenantId, { aguardarSuspensao: true })) !== 'suspensa') return;
      await tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: 'tenant_suspenso', conteudoSelado: null, updatedAt: agora }).where(eq(notifications.status, 'pendente'));
    },
    db,
  );
}

/** US-004 "Reativar": os lembretes ignorados pela suspensão, de consultas futuras ativas, voltam a valer (RN-05). */
export async function reagendarTenantReativado(db: Db, tenantId: string, agora: Date): Promise<void> {
  const tenant = await buscarTenant(db, tenantId); // o fuso; lido antes da transação (uma conexão por vez)
  if (!tenant) return;
  await withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      // rodada 1: relido sob trava — um "reativado" atrasado, que roda depois de uma nova suspensão, não reabre nada
      if ((await getTenantStatus(tx, tenantId, { aguardarSuspensao: true })) !== 'ativa') return;
      const alvo = await tx
        .selectDistinct({ id: appointments.id, inicio: appointments.inicio })
        .from(notifications)
        .innerJoin(appointments, eq(appointments.id, notifications.appointmentId))
        .where(and(eq(notifications.motivoIgnorada, 'tenant_suspenso'), inArray(appointments.status, ['agendada', 'confirmada']), gt(appointments.inicio, agora)));
      for (const c of alvo) {
        for (const p of planejarLembretes(c.inicio, tenant.fuso, agora)) {
          await tx
            .update(notifications)
            .set({ status: p.status, motivoIgnorada: p.status === 'ignorada' ? p.motivo : null, agendadaPara: p.agendadaPara, tentativas: 0, erro: null, updatedAt: agora })
            .where(and(eq(notifications.appointmentId, c.id), eq(notifications.inicioConsulta, c.inicio), eq(notifications.tipo, p.tipo), eq(notifications.motivoIgnorada, 'tenant_suspenso')));
        }
      }
    },
    db,
  );
}

/** Lembretes da consulta para a tela da nutricionista (US-034). */
export async function listarNotificacoesDaConsulta(ctx: TenantContext, appointmentId: string, db: Db = getDb()): Promise<NotificationRow[]> {
  return withTenant(ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, appointmentId)).orderBy(asc(notifications.agendadaPara), asc(notifications.tipo), asc(notifications.canal)), db);
}
