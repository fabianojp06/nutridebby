import { createHash } from 'node:crypto';
import { and, desc, eq, gt, gte, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, notifications, type AppointmentRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { getBoss } from '@/jobs/boss';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { sealSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { confirmarPresenca, ConsultaMudouError, pedirRemarcacao } from '@/modules/agenda/cancelamento';
import { chaveDoLimite, consumirLimite, liberarLimite } from '@/modules/agenda/limite-ip';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { dispararEnvio, fallbackPorEmail } from '../agendar';
import { atualizarEstadoConexao, tenantDaInstancia } from './conexao';
import { chaveDoWebhook, verificarJwtWebhook } from './jwt';
import { digitosDoJid, e164DoJid, type EstadoConexao } from './provedor';
import { interpretarResposta, type Intencao } from './respostas';

/** Finalidade do `sealSecret` do evento na fila `whatsapp-evento` (D5). */
export const FINALIDADE_EVENTO = 'whatsapp-evento';
const LIMITE_CORPO = 256 * 1024;
/** D4 (b): a marca anti-repetição vale o tempo de vida do JWT (exp 600 s) + a folga de relógio (60 s). */
export const REPETICAO_S = 660;
/** Uma resposta "1"/"2" vale para o lembrete enviado àquele número nas últimas 26 h (24 h + folga). */
const JANELA_RESPOSTA_MS = 26 * 3_600_000;

/** D5: o mínimo que sai da rota — nunca o texto que o paciente digitou. */
export type EventoWhatsapp =
  | { tipo: 'resposta'; instancia: string; de: string; id: string; citado: string | null; intencao: Intencao }
  | { tipo: 'status'; instancia: string; id: string; status: 'entregue' | 'lida' | 'falhou' }
  | { tipo: 'conexao'; instancia: string; estado: EstadoConexao; numero: string | null };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const texto = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * `connection.update` da Evolution (Baileys) → estado (revisão da T9 a): `open` = conectada; `connecting` = conectando
 * (QR na tela; com a sessão já conectada é a reconexão do Baileys e `atualizarEstadoConexao` mantém "conectada");
 * `close` (aparelho desconectado, sessão encerrada) e `refused` (QR esgotado) = desconectada. O e-mail de desconexão é
 * decidido em `atualizarEstadoConexao`.
 */
const ESTADOS: Record<string, EstadoConexao> = { open: 'conectada', connecting: 'conectando', close: 'desconectada', refused: 'desconectada' };

/**
 * Eventos `messages.upsert`, `messages.update` e `connection.update` da Evolution v2 (corpo `{ event, instance, data }`).
 * A resposta do paciente vem em `message.conversation` ou, quando ele responde citando o lembrete, em
 * `message.extendedTextMessage.text` (o id citado em `contextInfo.stanzaId`). Só o número (`@s.whatsapp.net`): grupos,
 * status e `@lid` (sem número para casar com o destino do lembrete) são descartados.
 */
export function classificarEvento(corpo: unknown): EventoWhatsapp | null {
  const c = obj(corpo);
  const d = obj(c?.data);
  const instancia = c?.instance;
  if (!c || !d || typeof instancia !== 'string' || !tenantDaInstancia(instancia)) return null;
  if (c.event === 'messages.upsert') {
    const key = obj(d.key);
    if (!key || key.fromMe !== false || typeof key.id !== 'string' || typeof key.remoteJid !== 'string' || !key.remoteJid.endsWith('@s.whatsapp.net')) return null;
    const m = obj(d.message);
    const ext = obj(m?.extendedTextMessage);
    const t = texto(m?.conversation) ?? texto(ext?.text);
    const intencao = t === null ? null : interpretarResposta(t);
    if (!intencao) return null;
    const citado = texto(obj(d.contextInfo)?.stanzaId) ?? texto(obj(ext?.contextInfo)?.stanzaId);
    return { tipo: 'resposta', instancia, de: digitosDoJid(key.remoteJid), id: key.id, citado, intencao };
  }
  if (c.event === 'messages.update') {
    if (d.fromMe !== true || typeof d.keyId !== 'string') return null;
    const status = d.status === 'DELIVERY_ACK' ? 'entregue' : d.status === 'READ' || d.status === 'PLAYED' ? 'lida' : d.status === 'ERROR' ? 'falhou' : null;
    return status ? { tipo: 'status', instancia, id: d.keyId, status } : null;
  }
  if (c.event === 'connection.update') {
    // D4 (a): o número só vale para a própria instância (a do corpo, já amarrada ao JWT); `data.instance` de outra → descarta
    if (d.instance !== undefined && d.instance !== instancia) return null;
    const estado = typeof d.state === 'string' ? ESTADOS[d.state] : undefined;
    if (!estado) return null;
    return { tipo: 'conexao', instancia, estado, numero: estado === 'conectada' && typeof d.wuid === 'string' ? e164DoJid(d.wuid) : null };
  }
  return null;
}

/** D5: o evento reduzido vai cifrado para a fila (traz o número do paciente). */
export async function enfileirarEventoWhatsapp(ev: EventoWhatsapp): Promise<void> {
  const id = await (await getBoss()).send('whatsapp-evento', { selado: sealSecret(JSON.stringify(ev), FINALIDADE_EVENTO) });
  if (!id) throw new Error('A fila de eventos do WhatsApp recusou o evento');
}

const recusar = (motivo: string) => {
  logger.warn({ motivo }, 'webhook do WhatsApp recusado'); // só o motivo: nunca JWT, corpo, número ou instância
  return Response.json({ erro: 'Não autorizado.' }, { status: 401 });
};
const OK = () => Response.json({ ok: true });

/**
 * INT-01/D4/D5: exige o `Bearer`, lê no máximo 256 KB, confere o JWT com a chave da instância do corpo (a), descarta a
 * repetição do mesmo pedido (b: 200 sem efeito, R2/US-035), reduz e enfileira (cifrado); responde em ≤ 2 s. 401 só para
 * autenticação inválida (a Evolution não repete 401). Nada do corpo vai para log (traz número, texto e o campo `apikey`).
 */
export async function receberWebhook(req: Request, o: { segredo: string | undefined; agora?: Date; db?: Db; enfileirar: (ev: EventoWhatsapp) => Promise<void> }): Promise<Response> {
  if (!o.segredo) return new Response(null, { status: 404 });
  const agora = o.agora ?? new Date();
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m) return recusar('formato');
  let bruto: Buffer;
  let corpo: unknown;
  try {
    bruto = await lerCorpoLimitado(req, LIMITE_CORPO);
    corpo = JSON.parse(bruto.toString('utf8'));
  } catch (e) {
    if (e instanceof CorpoGrandeError) return Response.json({ erro: 'Grande demais.' }, { status: 413 });
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }
  // D4 (a): o JWT tem de ser o da instância que o corpo diz ser — um consultório não fala por outro
  const instancia = obj(corpo)?.instance;
  if (typeof instancia !== 'string' || !tenantDaInstancia(instancia)) return recusar('instancia');
  const v = verificarJwtWebhook(m[1], chaveDoWebhook(o.segredo, instancia), agora);
  if (!v.ok) return recusar(v.motivo);
  const ev = classificarEvento(corpo);
  if (!ev) return OK(); // grupos, mensagens próprias, mídia, texto que não é "1"/"2": descartados sem gravar nada
  // D4 (b): o mesmo pedido só vale uma vez. O JWT da Evolution não tem jti e é igual no mesmo segundo: a marca é JWT + corpo
  const db = o.db ?? getDb();
  const marca = chaveDoLimite('webhook', `${m[1]}.${createHash('sha256').update(bruto).digest('base64url')}`);
  if (!(await consumirLimite(db, marca, 1, REPETICAO_S, agora))) return OK(); // R2: repetido → 200, sem enfileirar
  try {
    await o.enfileirar(ev);
  } catch (e) {
    await liberarLimite(db, marca); // a Evolution repete o pedido (5xx) e ele precisa passar
    throw e;
  }
  return OK();
}

const RANK: Record<string, number> = { enviada: 1, entregue: 2, lida: 3 };

/**
 * D6: status só avança (enviada → entregue → lida); ERROR de uma enviada vira "falhou" e, se for lembrete, o e-mail que
 * tinha falhado volta. Travas: a linha do WhatsApp, depois (sem esperar, SKIP LOCKED) a do e-mail — nunca consultas
 * nem pacientes.
 */
async function atualizarStatus(tenantId: string, ev: Extract<EventoWhatsapp, { tipo: 'status' }>, db: Db, agora: Date): Promise<void> {
  await withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      const [n] = await tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.canal, 'whatsapp'), eq(notifications.providerMsgId, ev.id)))
        .for('update');
      if (!n) return; // mensagem que o NutriDebby não mandou (a nutricionista usa o mesmo número), ou de outro consultório (RLS)
      if (ev.status === 'falhou') {
        if (n.status !== 'enviada') return; // entregue/lida não "desfalham"; repetido não faz nada
        const [f] = await tx.update(notifications).set({ status: 'falhou', erro: 'erro_entrega', updatedAt: agora }).where(eq(notifications.id, n.id)).returning();
        await fallbackPorEmail(tx, f, agora);
        return;
      }
      // eventos fora de ordem e repetidos não voltam o estado
      if ((RANK[ev.status] ?? 0) > (RANK[n.status] ?? 99)) await tx.update(notifications).set({ status: ev.status, updatedAt: agora }).where(eq(notifications.id, n.id));
    },
    db,
  );
}

/**
 * US-035: "1"/"2" vale para o lembrete de WhatsApp enviado àquele número (o `jid` que a Evolution devolveu no envio)
 * nas últimas 26 h, de consulta futura e ativa, no horário do lembrete (D17) — o citado, se houver; senão o mais
 * recente. A ação roda como o próprio paciente (RLS por paciente) e confere de novo, sob a trava, que a consulta ainda
 * está no horário do lembrete (`inicioDoLink`). A resposta ao paciente é gravada na mesma transação, só se a ação valeu
 * (`naMesmaTransacao`), e é uma linha única por consulta e horário: repetir não responde de novo.
 * Travas: paciente → consulta → notificações (a ordem de moverConsulta/cancelarConsulta/avisarPaciente).
 */
async function tratarResposta(tenantId: string, ev: Extract<EventoWhatsapp, { tipo: 'resposta' }>, db: Db, agora: Date, appUrl: string): Promise<void> {
  const tenant = await buscarTenant(db, tenantId); // antes de abrir transação (uma conexão por vez)
  if (!tenant || tenant.status !== 'ativa') return; // RN-15
  const candidatos = await withTenant(
    { tenantId, role: 'worker' },
    (tx) =>
      tx
        .select({ msgId: notifications.providerMsgId, jid: notifications.providerJid, appointmentId: notifications.appointmentId, patientId: notifications.patientId, inicio: notifications.inicioConsulta })
        .from(notifications)
        .innerJoin(appointments, eq(appointments.id, notifications.appointmentId))
        .where(
          and(
            eq(notifications.canal, 'whatsapp'),
            inArray(notifications.tipo, ['lembrete_24h', 'lembrete_2h']),
            inArray(notifications.status, ['enviada', 'entregue', 'lida']),
            gte(notifications.enviadaEm, new Date(agora.getTime() - JANELA_RESPOSTA_MS)),
            inArray(appointments.status, ['agendada', 'confirmada']),
            gt(appointments.inicio, agora),
            // D17: o lembrete enviado é imutável — depois de "Alterar data e hora", responder ao lembrete do horário
            // antigo não pode confirmar/remarcar o horário novo (o paciente não recebeu o horário novo pelo WhatsApp)
            eq(notifications.inicioConsulta, appointments.inicio),
          ),
        )
        .orderBy(desc(notifications.enviadaEm)),
    db,
  );
  const doNumero = candidatos.filter((x) => x.jid && digitosDoJid(x.jid) === ev.de);
  const alvo = (ev.citado ? doNumero.find((x) => x.msgId === ev.citado) : undefined) ?? doNumero[0];
  if (!alvo?.appointmentId || !alvo.inicio) return;
  const comoPaciente: TenantContext = { tenantId, role: 'paciente', patientId: alvo.patientId };
  const tipo = ev.intencao === 'confirmar' ? 'resposta_confirmacao' : 'resposta_remarcar';
  const responder = async (tx: Tx, c: AppointmentRow) => {
    const novas = await tx
      .insert(notifications)
      .values({ tenantId, patientId: c.patientId, appointmentId: c.id, inicioConsulta: c.inicio, canal: 'whatsapp', tipo, agendadaPara: agora, createdAt: agora, updatedAt: agora })
      .onConflictDoNothing() // uma resposta por consulta e horário (índice único parcial, D6)
      .returning({ id: notifications.id });
    if (novas.length) await dispararEnvio(tx, tenantId);
  };
  const d = { db, now: agora, appUrl, inicioDoLink: alvo.inicio, naMesmaTransacao: responder };
  try {
    if (ev.intencao === 'confirmar') await confirmarPresenca(comoPaciente, alvo.appointmentId, 'whatsapp', d);
    else await pedirRemarcacao(comoPaciente, tenant, alvo.appointmentId, d);
  } catch (e) {
    if (e instanceof ConsultaMudouError) return; // mudou de horário depois da busca: a resposta era ao horário antigo (D17)
    throw e;
  }
}

/** Worker (fila whatsapp-evento): conexão, status e respostas, todos idempotentes (a Evolution repete eventos). */
export async function processarEventoWhatsapp(ev: EventoWhatsapp, deps: { db?: Db; agora?: Date; appUrl?: string } = {}): Promise<void> {
  const tenantId = tenantDaInstancia(ev.instancia);
  if (!tenantId) return;
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  if (ev.tipo === 'conexao') await atualizarEstadoConexao(tenantId, { estado: ev.estado, numero: ev.numero }, { db, agora, appUrl: deps.appUrl });
  else if (ev.tipo === 'status') await atualizarStatus(tenantId, ev, db, agora);
  else await tratarResposta(tenantId, ev, db, agora, deps.appUrl ?? getEnv().APP_URL);
}
