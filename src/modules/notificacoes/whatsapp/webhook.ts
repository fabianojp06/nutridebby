import { createHash } from 'node:crypto';
import { and, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, notifications, type AppointmentRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { getBoss } from '@/jobs/boss';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { sealSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { confirmarPresenca, ConsultaMudouError, pedirRemarcacao } from '@/modules/agenda/cancelamento';
import { chaveDoLimite, consumirLimite } from '@/modules/agenda/limite-ip';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { dispararEnvio, fallbackPorEmail } from '../agendar';
import { atualizarEstadoConexao, tenantDaInstancia } from './conexao';
import { chaveDoWebhook, verificarJwtWebhook } from './jwt';
import { digitosDoJid, e164DoJid, type EstadoConexao } from './provedor';
import { interpretarResposta, type Intencao } from './respostas';

/** Finalidade do `sealSecret` do evento na fila `whatsapp-evento` (D5). */
export const FINALIDADE_EVENTO = 'whatsapp-evento';
const LIMITE_CORPO = 256 * 1024;
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
const ESTADOS = new Map<string, EstadoConexao>([
  ['open', 'conectada'],
  ['connecting', 'conectando'],
  ['close', 'desconectada'],
  ['refused', 'desconectada'],
]); // Map, não objeto: "__proto__"/"constructor" não viram estado (revisão 1, item 5)

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
    const estado = typeof d.state === 'string' ? ESTADOS.get(d.state) : undefined;
    if (!estado) return null;
    return { tipo: 'conexao', instancia, estado, numero: estado === 'conectada' && typeof d.wuid === 'string' ? e164DoJid(d.wuid) : null };
  }
  return null;
}

/**
 * D5: o evento reduzido vai cifrado para a fila (traz o número do paciente) — na transação `tx` da marca anti-repetição
 * (revisão 1, item 4: o `send` do pg-boss com `fromDrizzle(tx, sql)`, a exceção conhecida de "uma conexão por transação").
 */
export async function enfileirarEventoWhatsapp(ev: EventoWhatsapp, tx: Tx): Promise<void> {
  const id = await (await getBoss()).send('whatsapp-evento', { selado: sealSecret(JSON.stringify(ev), FINALIDADE_EVENTO) }, { db: fromDrizzle(tx, sql) });
  if (!id) throw new Error('A fila de eventos do WhatsApp recusou o evento');
}

/** D4 (b): a marca anti-repetição de um pedido — HMAC (em `chaveDoLimite`) do JWT + SHA-256 do corpo. */
export const marcaDoPedido = (token: string, bruto: Buffer): string => chaveDoLimite('webhook', `${token}.${createHash('sha256').update(bruto).digest('base64url')}`);

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
export async function receberWebhook(req: Request, o: { segredo: string | undefined; agora?: Date; db?: Db; enfileirar: (ev: EventoWhatsapp, tx: Tx) => Promise<void> }): Promise<Response> {
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
  // D4 (b): o mesmo pedido só vale uma vez. O JWT da Evolution não tem jti e é igual no mesmo segundo: a marca é JWT + corpo.
  // Revisão 1: a marca dura enquanto este JWT pode ser aceito (item 3) e é gravada na MESMA transação do evento na fila
  // (item 4) — se enfileirar falhar ou o processo cair no meio, não fica marca e a repetição da Evolution (5xx) passa.
  // `public_rate_limits` e a fila não têm tenant_id: transação simples, sem withTenant.
  const db = o.db ?? getDb();
  const marca = marcaDoPedido(m[1], bruto);
  await getBoss(); // revisão 2: o produtor sobe (se ainda não subiu) ANTES de a transação segurar uma conexão do app
  await db.transaction(async (tx) => {
    if (!(await consumirLimite(tx, marca, 1, v.aceitoPorS, agora))) return; // R2: repetido → 200, sem enfileirar
    await o.enfileirar(ev, tx);
  });
  return OK();
}

const RANK: Record<string, number> = { enviada: 1, entregue: 2, lida: 3 };

/**
 * D6: status só avança (enviada → entregue → lida); ERROR de uma enviada vira "falhou" e, se for lembrete, o e-mail que
 * tinha falhado volta. Travas: a linha do WhatsApp, depois (sem esperar, SKIP LOCKED) a do e-mail — nunca consultas
 * nem pacientes.
 */
async function atualizarStatus(tenantId: string, ev: Extract<EventoWhatsapp, { tipo: 'status' }>, db: Db, agora: Date): Promise<boolean> {
  return withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      const [n] = await tx
        .select()
        .from(notifications)
        .where(and(eq(notifications.canal, 'whatsapp'), eq(notifications.providerMsgId, ev.id)))
        .for('update');
      // mensagem que o NutriDebby não mandou (a nutricionista usa o mesmo número), de outro consultório (RLS) — ou que o
      // worker ainda não registrou (o id é gravado depois da resposta da Evolution)
      if (!n) return false;
      if (ev.status === 'falhou') {
        if (n.status !== 'enviada') return true; // entregue/lida não "desfalham"; repetido não faz nada
        const [f] = await tx.update(notifications).set({ status: 'falhou', erro: 'erro_entrega', updatedAt: agora }).where(eq(notifications.id, n.id)).returning();
        await fallbackPorEmail(tx, f, agora);
        return true;
      }
      // eventos fora de ordem e repetidos não voltam o estado
      if ((RANK[ev.status] ?? 0) > (RANK[n.status] ?? 99)) await tx.update(notifications).set({ status: ev.status, updatedAt: agora }).where(eq(notifications.id, n.id));
      return true;
    },
    db,
  );
}

/**
 * US-035: "1"/"2" vale para o lembrete de WhatsApp enviado àquele número (o `jid` que a Evolution devolveu no envio)
 * nas últimas 26 h, de consulta futura e ativa, no horário do lembrete (D17) — o citado, se a resposta cita um deles
 * (citou outra mensagem: nada); sem citação, o mais recente. A ação roda como o próprio paciente (RLS por paciente) e confere de novo, sob a trava, que a consulta ainda
 * está no horário do lembrete (`inicioDoLink`). A resposta ao paciente é gravada na mesma transação, só se a ação valeu
 * (`naMesmaTransacao`). Code-review do PR #7: a AÇÃO vale sempre (a consulta acompanha cada "1"/"2"), mas as MENSAGENS
 * têm teto — `respostasDevidas`. Sem chave única no banco para as respostas (migration 0068): quem grava segura a trava
 * da consulta, então a conferência e a gravação não correm com outra resposta.
 * Travas: paciente → consulta → notificações (a ordem de moverConsulta/cancelarConsulta/avisarPaciente).
 */
/** Intervalo mínimo entre dois e-mails "Remarcar sua consulta" do mesmo horário da consulta (rodada 2 do code-review do PR #7). */
export const INTERVALO_EMAIL_REMARCAR_MS = 60 * 60_000;

/**
 * Code-review do PR #7, rodada 2 (D16 ★ anti-bloqueio: "1 resposta por consulta"): o que sai em resposta a um "1"/"2",
 * por (consulta, início da consulta). Regra única (R11), usada só por `tratarResposta`, sob a trava da consulta:
 * - WhatsApp: no máximo UMA resposta de cada tipo por horário da consulta — mudando a consulta ou não (2,1,2,1… não vira
 *   uma rajada de mensagens automáticas do número do consultório). A primeira sai também quando a ação já tinha sido
 *   feita pelo link (`mudou` = false).
 * - E-mail com o link (só no "2"): o primeiro sempre; outro só quando o "2" abre um pedido NOVO (`mudou`: o "1" tinha
 *   desfeito o anterior) e o último e-mail deste horário foi gravado há 60 min ou mais.
 * Os instantes comparados são os gravados pelas respostas (nunca `pedido_remarcacao_em`, que o link grava): a corrida
 * "2" no WhatsApp × "Preciso remarcar" no link não duplica nada.
 */
export function respostasDevidas(o: {
  tipo: 'resposta_confirmacao' | 'resposta_remarcar';
  mudou: boolean;
  whatsappJaRespondido: boolean;
  ultimoEmailRemarcar: Date | null;
  agora: Date;
}): { whatsapp: boolean; email: boolean } {
  const whatsapp = !o.whatsappJaRespondido;
  if (o.tipo !== 'resposta_remarcar') return { whatsapp, email: false };
  const email = o.ultimoEmailRemarcar === null || (o.mudou && o.agora.getTime() - o.ultimoEmailRemarcar.getTime() >= INTERVALO_EMAIL_REMARCAR_MS);
  return { whatsapp, email };
}

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
  // revisão 1 (item 1): citou uma mensagem? Só vale se for um destes lembretes. Citar a mensagem que a nutricionista digitou
  // no mesmo número (D2), um lembrete de horário antigo (D17), de consulta cancelada ou o convite não age sobre outra
  // consulta nem responde. Sem citação: o lembrete mais recente (D3)
  const alvo = ev.citado ? doNumero.find((x) => x.msgId === ev.citado) : doNumero[0];
  if (!alvo?.appointmentId || !alvo.inicio) return;
  const comoPaciente: TenantContext = { tenantId, role: 'paciente', patientId: alvo.patientId, semConta: true };
  const tipo = ev.intencao === 'confirmar' ? 'resposta_confirmacao' : 'resposta_remarcar';
  const responder = async (tx: Tx, c: AppointmentRow, mudou: boolean) => {
    // as respostas já gravadas para este horário da consulta (a trava da consulta está com esta transação)
    const anteriores = await tx
      .select({ canal: notifications.canal, tipo: notifications.tipo, createdAt: notifications.createdAt })
      .from(notifications)
      .where(and(eq(notifications.appointmentId, c.id), eq(notifications.inicioConsulta, c.inicio), inArray(notifications.tipo, ['resposta_confirmacao', 'resposta_remarcar'])));
    const emails = anteriores.filter((a) => a.canal === 'email' && a.tipo === 'resposta_remarcar').map((a) => a.createdAt.getTime());
    const devidas = respostasDevidas({
      tipo,
      mudou,
      whatsappJaRespondido: anteriores.some((a) => a.canal === 'whatsapp' && a.tipo === tipo),
      ultimoEmailRemarcar: emails.length ? new Date(Math.max(...emails)) : null,
      agora,
    });
    const linha = (canal: 'whatsapp' | 'email') => ({ tenantId, patientId: c.patientId, appointmentId: c.id, inicioConsulta: c.inicio, canal, tipo, agendadaPara: agora, createdAt: agora, updatedAt: agora });
    // fechamento: o "2" também grava um e-mail novo com o link para remarcar (o WhatsApp não leva link, D3), montado no
    // envio com o e-mail ATUAL do paciente — o do lembrete pode não ter saído ou ter caído com a correção do e-mail (D20)
    const linhas = [...(devidas.whatsapp ? [linha('whatsapp')] : []), ...(devidas.email ? [linha('email')] : [])];
    if (!linhas.length) return; // repetido, ou acima do teto: a ação valeu, mas não responde de novo
    await tx.insert(notifications).values(linhas);
    await dispararEnvio(tx, tenantId);
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

/** O ERROR chegou antes de o worker registrar o id da mensagem: a fila repete o job (sem o id na mensagem: RNF-11). */
export class MensagemSemRegistroError extends Error {
  override name = 'MensagemSemRegistroError';
  constructor() {
    super('ERROR de uma mensagem ainda sem registro: a fila tenta de novo');
  }
}

/**
 * Worker (fila whatsapp-evento): conexão, status e respostas, todos idempotentes (a Evolution repete eventos).
 * `ultimaTentativa`: a última vez que a fila entrega este job (revisão 1, item 7).
 */
export async function processarEventoWhatsapp(ev: EventoWhatsapp, deps: { db?: Db; agora?: Date; appUrl?: string; ultimaTentativa?: boolean } = {}): Promise<void> {
  const tenantId = tenantDaInstancia(ev.instancia);
  if (!tenantId) return;
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  if (ev.tipo === 'conexao') await atualizarEstadoConexao(tenantId, { estado: ev.estado, numero: ev.numero }, { db, agora, appUrl: deps.appUrl });
  else if (ev.tipo === 'status') {
    // revisão 1 (item 7): o ERROR pode chegar antes de o envio gravar o id (registrarResultado) — a fila repete com espera
    // (whatsapp-evento: 3 vezes, de 3,5 a 7 min ao todo) e, na última, desiste em silêncio; entregue/lida de id
    // desconhecido: descartados
    if (!(await atualizarStatus(tenantId, ev, db, agora)) && ev.status === 'falhou' && !deps.ultimaTentativa) throw new MensagemSemRegistroError();
  }
  else await tratarResposta(tenantId, ev, db, agora, deps.appUrl ?? getEnv().APP_URL);
}
