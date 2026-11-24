import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it, vi } from 'vitest';
import { consultaDireta, em, localPrincipal, tenantAgenda } from '../../../../test/agenda';
import { makeDb } from '../../../../test/db';
import { depsDeEnvio } from '../../../../test/notificacoes';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';
import { conexaoDeTeste, whatsappFalso } from '../../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { appointments, notifications, patients, publicRateLimits, tenants, user, whatsappConexoes } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { confirmarPresenca, pedirRemarcacao } from '@/modules/agenda/cancelamento';
import { moverConsulta } from '@/modules/agenda/consultas';
import { lerLinkConsulta } from '@/modules/agenda/link-consulta';
import { processarNotificacoes } from '../enviar';
import { situacaoDaCota } from './cota';
import { assinarJwtWebhook, chaveDoWebhook } from './jwt';
import { classificarEvento, marcaDoPedido, processarEventoWhatsapp, receberWebhook, respostasDevidas, type EventoWhatsapp } from './webhook';

// a corrida "a nutricionista muda o horário entre a busca do lembrete e a confirmação" (implementação real por baixo)
vi.mock('@/modules/agenda/cancelamento', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/modules/agenda/cancelamento')>();
  return { ...real, confirmarPresenca: vi.fn(real.confirmarPresenca), pedirRemarcacao: vi.fn(real.pedirRemarcacao) };
});

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // só lê pg_stat_activity (quem está preso em qual trava)
/** Tenants conectados deste arquivo: as respostas pendentes (vencidas) são apagadas no fim — os outros arquivos varrem o mesmo banco. */
const criados: TenantDeTeste[] = [];
afterAll(async () => {
  for (const T of criados) await withTenant(T.ctx, (tx) => tx.delete(notifications).where(inArray(notifications.status, ['pendente', 'enviando'])), app.db);
  await stopBoss();
  await closeDb();
  await app.pool.end();
  await owner.pool.end();
});
const JID = '5511912345678@s.whatsapp.net';
const agora = em('2026-10-15', '15:00');
const deps = { db: app.db, agora, appUrl: 'http://localhost:3000' };
const upsert = (instance: string, texto: string, extra: Record<string, unknown> = {}, de = JID) => ({
  event: 'messages.upsert',
  instance,
  apikey: null,
  data: { key: { remoteJid: de, fromMe: false, id: `IN-${randomUUID()}` }, pushName: 'Ana', message: { conversation: texto }, messageType: 'conversation', ...extra },
});
async function tenant(): Promise<TenantDeTeste> {
  const T = await novoTenant(app.db);
  criados.push(T);
  return T;
}

type Lembrete = { inicio?: Date; msgId?: string; jid?: string; telefone?: string };
/** Consulta futura com o lembrete de 24 h já enviado por WhatsApp para `jid`. */
async function lembreteEnviado(T: TenantDeTeste, { inicio = em('2026-10-16', '14:00'), msgId = `WA-${randomUUID()}`, jid = JID, telefone = '+5511912345678' }: Lembrete = {}) {
  await conexaoDeTeste(app.db, T.ctx, 'conectada');
  const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza', telefoneE164: telefone, whatsappOptinEm: agora, whatsappOptinOrigem: 'nutri' });
  const c = await consultaDireta(app.db, T.ctx, p.id, inicio);
  await withTenant(
    T.ctx,
    (tx) =>
      tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: inicio, canal: 'whatsapp', tipo: 'lembrete_24h', status: 'enviada', providerMsgId: msgId, providerJid: jid, agendadaPara: em('2026-10-15', '14:00'), enviadaEm: em('2026-10-15', '14:00') }),
    app.db,
  );
  return { p, c, msgId };
}
const consulta = async (T: TenantDeTeste, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db))[0];
const respostas = (T: TenantDeTeste, id: string) => withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.canal, 'whatsapp'))), app.db);
const processar = async (corpo: unknown, d: Parameters<typeof processarEventoWhatsapp>[1] = deps) => {
  const ev = classificarEvento(corpo);
  if (ev) await processarEventoWhatsapp(ev, d);
  return ev;
};

describe('classificarEvento (D5: o texto nunca sai da rota)', () => {
  const inst = 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';
  it('resposta "1" vira intenção, sem o texto; o resto é descartado', () => {
    const ev = classificarEvento(upsert(inst, ' 1 ', { contextInfo: { stanzaId: 'WA9' } }))!;
    expect(ev).toMatchObject({ tipo: 'resposta', instancia: inst, de: '5511912345678', citado: 'WA9', intencao: 'confirmar' });
    expect(JSON.stringify(ev)).not.toContain('conversation');
    expect(classificarEvento(upsert(inst, 'Oi, tudo bem?'))).toBeNull();
    expect(classificarEvento(upsert(inst, '1', {}, '1203@g.us'))).toBeNull(); // grupo
    expect(classificarEvento({ ...upsert(inst, '1'), data: { ...upsert(inst, '1').data, key: { remoteJid: JID, fromMe: true, id: 'm' } } })).toBeNull();
    expect(classificarEvento(upsert(inst, '1', {}, '123456789012345@lid'))).toBeNull(); // @lid: sem número para casar com o lembrete
    expect(classificarEvento(upsert('outra-instancia', '1'))).toBeNull();
    expect(classificarEvento({ event: 'chats.update', instance: inst, data: {} })).toBeNull();
    expect(classificarEvento('lixo')).toBeNull();
  });
  it('resposta citando o lembrete (extendedTextMessage, como o WhatsApp manda quem responde à mensagem): intenção e id citado, sem o texto', () => {
    const corpo = upsert(inst, 'x', { message: { extendedTextMessage: { text: 'Sim!', contextInfo: { stanzaId: 'WA7', quotedMessage: { conversation: 'Olá, Ana! Lembrete…' } } } }, messageType: 'extendedTextMessage' });
    const ev = classificarEvento(corpo)!;
    expect(ev).toEqual({ tipo: 'resposta', instancia: inst, de: '5511912345678', id: corpo.data.key.id, citado: 'WA7', intencao: 'confirmar' });
    expect(JSON.stringify(ev)).not.toMatch(/Sim|Lembrete|Ana/);
  });
  it('status de entrega/leitura/erro das mensagens enviadas; conexão com o número', () => {
    expect(classificarEvento({ event: 'messages.update', instance: inst, data: { keyId: 'WA1', remoteJid: JID, fromMe: true, status: 'DELIVERY_ACK' } })).toEqual({ tipo: 'status', instancia: inst, id: 'WA1', status: 'entregue' });
    expect(classificarEvento({ event: 'messages.update', instance: inst, data: { keyId: 'WA1', fromMe: true, status: 'READ' } })).toMatchObject({ status: 'lida' });
    expect(classificarEvento({ event: 'messages.update', instance: inst, data: { keyId: 'WA1', fromMe: true, status: 'SERVER_ACK' } })).toBeNull();
    expect(classificarEvento({ event: 'messages.update', instance: inst, data: { keyId: 'WA1', fromMe: false, status: 'READ' } })).toBeNull();
    expect(classificarEvento({ event: 'connection.update', instance: inst, data: { instance: inst, state: 'open', wuid: JID } })).toEqual({ tipo: 'conexao', instancia: inst, estado: 'conectada', numero: '+5511912345678' });
    expect(classificarEvento({ event: 'connection.update', instance: inst, data: { state: 'close', statusReason: 401 } })).toMatchObject({ estado: 'desconectada', numero: null });
    expect(classificarEvento({ event: 'connection.update', instance: inst, data: { state: 'refused' } })).toMatchObject({ estado: 'desconectada' });
    expect(classificarEvento({ event: 'connection.update', instance: inst, data: { state: 'connecting' } })).toMatchObject({ estado: 'conectando', numero: null });
    // D4 (a): número só para a própria instância — `data.instance` de outra instância é descartado
    expect(classificarEvento({ event: 'connection.update', instance: inst, data: { instance: 'nd-1c7e4d2f-9b8e-4d3c-8a21-2b3c4d5e6f70', state: 'open', wuid: JID } })).toBeNull();
  });
});

describe('classificarEvento: revisão 1', () => {
  it('(item 5) estado de conexão desconhecido — inclusive "__proto__", "constructor" e outros nomes do Object — é descartado', () => {
    const inst = 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';
    for (const state of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'qualquer']) {
      const corpo = JSON.parse(`{"event":"connection.update","instance":"${inst}","data":{"state":"${state}"}}`) as unknown;
      expect(classificarEvento(corpo), state).toBeNull();
    }
  });
});

describe('respostasDevidas (code-review do PR #7, rodada 2: D16 ★ — a regra das respostas num lugar só)', () => {
  const agora_ = em('2026-10-15', '15:00');
  const min = (m: number) => new Date(agora_.getTime() - m * 60_000);
  const r = (o: Partial<Parameters<typeof respostasDevidas>[0]>) =>
    respostasDevidas({ tipo: 'resposta_remarcar', mudou: true, whatsappJaRespondido: false, ultimoEmailRemarcar: null, agora: agora_, ...o });
  it('WhatsApp: no máximo 1 por tipo e horário da consulta, mudando ou não', () => {
    expect(r({}).whatsapp).toBe(true);
    expect(r({ whatsappJaRespondido: true }).whatsapp).toBe(false);
    expect(r({ tipo: 'resposta_confirmacao', mudou: true, whatsappJaRespondido: true })).toEqual({ whatsapp: false, email: false });
    expect(r({ tipo: 'resposta_confirmacao', mudou: false })).toEqual({ whatsapp: true, email: false }); // já confirmada pelo link
  });
  it('e-mail com o link (só no "2"): o primeiro sempre; outro só num pedido NOVO, 60 min ou mais depois do último', () => {
    expect(r({ mudou: false }).email).toBe(true); // pedido feito pelo link: o "2" ainda não teve e-mail
    expect(r({ ultimoEmailRemarcar: min(59), whatsappJaRespondido: true }).email).toBe(false);
    expect(r({ ultimoEmailRemarcar: min(60), whatsappJaRespondido: true })).toEqual({ whatsapp: false, email: true });
    expect(r({ ultimoEmailRemarcar: min(120), mudou: false }).email).toBe(false); // repetido: o mesmo pedido
  });
});

describe('processarEventoWhatsapp (US-035)', () => {
  it('"1": consulta "confirmada" via WhatsApp e uma resposta "Presença confirmada"; repetido não muda nada nem responde de novo', async () => {
    const T = await tenant();
    const { c } = await lembreteEnviado(T);
    const corpo = upsert(`nd-${T.tenantId}`, '1');
    await processar(corpo);
    await processar(corpo); // a Evolution reenviou
    await processar(upsert(`nd-${T.tenantId}`, 'Confirmo')); // e o paciente respondeu de novo
    expect(await consulta(T, c)).toMatchObject({ status: 'confirmada', confirmadaVia: 'whatsapp' });
    expect((await respostas(T, c)).filter((n) => n.tipo === 'resposta_confirmacao')).toMatchObject([{ status: 'pendente', inicioConsulta: em('2026-10-16', '14:00'), agendadaPara: agora }]);
  });

  it('N7 (Plano 08): "1" e "2" agem como o próprio paciente, sem conta (semConta) — a consulta de outro paciente do mesmo consultório segue invisível', async () => {
    const T = await tenant();
    const { p, c } = await lembreteEnviado(T);
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const daBia = await consultaDireta(app.db, T.ctx, bia.id, em('2026-10-16', '16:00'));
    await processar(upsert(`nd-${T.tenantId}`, '1'));
    await processar(upsert(`nd-${T.tenantId}`, '2'));
    const ctxs = [vi.mocked(confirmarPresenca).mock.calls.at(-1)![0], vi.mocked(pedirRemarcacao).mock.calls.at(-1)![0]];
    for (const ctx of ctxs) {
      expect(ctx).toEqual<TenantContext>({ tenantId: T.tenantId, role: 'paciente', patientId: p.id, semConta: true });
      const vistas = await withTenant(ctx, (tx) => tx.select({ id: appointments.id }).from(appointments).where(inArray(appointments.id, [c, daBia])), app.db);
      expect(vistas).toEqual([{ id: c }]);
    }
  });

  it('"2": pedido de remarcação, aviso à nutricionista (uma vez) e resposta com o link', async () => {
    const T = await tenant();
    const { c } = await lembreteEnviado(T);
    await processar(upsert(`nd-${T.tenantId}`, 'Preciso remarcar'));
    await processar(upsert(`nd-${T.tenantId}`, '2'));
    expect((await consulta(T, c)).pedidoRemarcacaoEm).toEqual(agora);
    expect((await respostas(T, c)).filter((n) => n.tipo === 'resposta_remarcar')).toHaveLength(1);
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect((await emailsNaFila('aviso_agenda', nutri.email)).filter((m) => m.evento === 'pedido_remarcacao')).toHaveLength(1);
  });

  it('"2" (fechamento): um e-mail NOVO, ao e-mail ATUAL do paciente, com o link assinado atual — uma vez por resposta; o WhatsApp diz para qual e-mail', async () => {
    const T = await tenant();
    const { p, c } = await lembreteEnviado(T);
    // o e-mail foi corrigido depois do lembrete (o link do lembrete, amarrado ao e-mail antigo, não vale mais)
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ email: 'bia.nova@ex.com' }).where(eq(patients.id, p.id)), app.db);
    const corpo = upsert(`nd-${T.tenantId}`, '2');
    await processar(corpo);
    await processar(corpo); // a Evolution reenviou
    await processar(upsert(`nd-${T.tenantId}`, 'remarcar')); // e o paciente respondeu de novo
    const doEmail = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, c), eq(notifications.canal, 'email'), eq(notifications.tipo, 'resposta_remarcar'))), app.db);
    expect(doEmail).toMatchObject([{ status: 'pendente', inicioConsulta: em('2026-10-16', '14:00'), agendadaPara: agora }]);
    const w = whatsappFalso();
    const d = depsDeEnvio(agora, { db: app.db, whatsapp: w });
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect(w.enviados.map((e) => e.texto)).toEqual([`Tudo bem! Enviamos o link para remarcar para o seu e-mail b***@ex.com.\nSe faltarem menos de 24 h para a consulta, fale direto com ${T.tenant.nomeExibicao}.`]);
    expect(d.transport.enviados.map((e) => e.to)).toEqual(['bia.nova@ex.com']);
    const [e] = d.transport.enviados;
    expect(e.subject).toMatch(/^Remarcar sua consulta: /);
    const token = /\/consulta\/([A-Za-z0-9_-]{71})/.exec(e.text)![1];
    expect(await lerLinkConsulta(token, d.chaveLinks, agora, async () => ({ email: 'bia.nova@ex.com' }))).not.toBeNull();
    // nada sai de novo numa segunda volta
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect(d.transport.enviados).toHaveLength(1);
  });

  it('já confirmada pelo link ou com o pedido já feito pelo link: "1"/"2" respondem ao paciente, sem mudar a via nem avisar a nutricionista de novo', async () => {
    const T = await tenant();
    const a = await lembreteEnviado(T, { inicio: em('2026-10-16', '09:00') });
    await withTenant(T.ctx, (tx) => tx.update(appointments).set({ status: 'confirmada', confirmadaVia: 'link' }).where(eq(appointments.id, a.c)), app.db);
    await processar(upsert(`nd-${T.tenantId}`, '1', { contextInfo: { stanzaId: a.msgId } }));
    expect(await consulta(T, a.c)).toMatchObject({ status: 'confirmada', confirmadaVia: 'link' });
    expect((await respostas(T, a.c)).filter((n) => n.tipo === 'resposta_confirmacao')).toHaveLength(1);
    const b = await lembreteEnviado(T, { inicio: em('2026-10-16', '11:00') });
    const pedido = em('2026-10-15', '10:00');
    await withTenant(T.ctx, (tx) => tx.update(appointments).set({ pedidoRemarcacaoEm: pedido }).where(eq(appointments.id, b.c)), app.db);
    await processar(upsert(`nd-${T.tenantId}`, '2', { contextInfo: { stanzaId: b.msgId } }));
    expect((await consulta(T, b.c)).pedidoRemarcacaoEm).toEqual(pedido);
    expect((await respostas(T, b.c)).filter((n) => n.tipo === 'resposta_remarcar')).toHaveLength(1);
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect((await emailsNaFila('aviso_agenda', nutri.email)).filter((m) => m.evento === 'pedido_remarcacao')).toEqual([]);
  });

  /** Responde `texto` `min` minutos depois de `agora` e roda o worker (como na vida real); devolve o que saiu. */
  function conversa(T: TenantDeTeste) {
    const w = whatsappFalso();
    const emails: string[] = [];
    const remarcar = 'Tudo bem! Enviamos o link para remarcar para o seu e-mail';
    return {
      whatsapps: () => w.enviados.map((e) => (e.texto.startsWith(remarcar) ? 'remarcar' : e.texto)),
      emails: () => emails.filter((s) => s.startsWith('Remarcar sua consulta: ')),
      async responder(texto: string, min: number) {
        const quando = new Date(agora.getTime() + min * 60_000);
        await processar(upsert(`nd-${T.tenantId}`, texto), { ...deps, agora: quando });
        const d = depsDeEnvio(quando, { db: app.db, whatsapp: w });
        await processarNotificacoes(d, { tenantId: T.tenantId });
        emails.push(...d.transport.enviados.map((e) => e.subject));
      },
    };
  }

  it('code-review do PR #7 (rodada 2, D16 ★): 2,1,2,1,2 em minutos — a consulta acompanha cada resposta, mas sai só 1 resposta de cada tipo no WhatsApp e 1 e-mail com o link; um pedido novo 61 min depois do último e-mail ganha mais 1 e-mail, sem WhatsApp', async () => {
    const T = await tenant();
    const { c } = await lembreteEnviado(T);
    const k = conversa(T);
    const t = (min: number) => new Date(agora.getTime() + min * 60_000);
    const passos: [string, number, { status: string; pedidoRemarcacaoEm: Date | null }][] = [
      ['2', 0, { status: 'agendada', pedidoRemarcacaoEm: t(0) }],
      ['1', 2, { status: 'confirmada', pedidoRemarcacaoEm: null }],
      ['2', 4, { status: 'confirmada', pedidoRemarcacaoEm: t(4) }],
      ['1', 6, { status: 'confirmada', pedidoRemarcacaoEm: null }],
      ['2', 8, { status: 'confirmada', pedidoRemarcacaoEm: t(8) }],
    ];
    for (const [texto, min, esperado] of passos) {
      await k.responder(texto, min);
      expect(await consulta(T, c), `"${texto}" aos ${min} min`).toMatchObject(esperado);
    }
    expect(k.whatsapps()).toEqual(['remarcar', 'Presença confirmada. Até lá!']);
    expect(k.emails()).toHaveLength(1);
    // o "1" desfaz o pedido; 61 min depois do último e-mail com o link, um pedido novo: mais 1 e-mail, nenhum WhatsApp
    await k.responder('1', 30);
    expect(await consulta(T, c)).toMatchObject({ status: 'confirmada', pedidoRemarcacaoEm: null });
    await k.responder('2', 61);
    expect(await consulta(T, c)).toMatchObject({ status: 'confirmada', pedidoRemarcacaoEm: t(61) });
    expect(k.whatsapps()).toEqual(['remarcar', 'Presença confirmada. Até lá!']);
    expect(k.emails()).toHaveLength(2);
    // repetido: o mesmo pedido, nada novo
    await k.responder('2', 125);
    expect(k.emails()).toHaveLength(2);
    // a nutricionista é avisada a cada pedido novo (e-mail da plataforma, fora do número do consultório)
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect((await emailsNaFila('aviso_agenda', nutri.email)).filter((m) => m.evento === 'pedido_remarcacao')).toHaveLength(4);
  });

  it('code-review do PR #7: "1" → "2" → "1" — o segundo "1" desfaz o pedido de remarcação; a "Presença confirmada" já saiu para este horário e não sai de novo (D16 ★)', async () => {
    const T = await tenant();
    const { c } = await lembreteEnviado(T);
    const k = conversa(T);
    await k.responder('1', 0);
    await k.responder('2', 2);
    await k.responder('1', 4);
    expect(await consulta(T, c)).toMatchObject({ status: 'confirmada', confirmadaVia: 'whatsapp', pedidoRemarcacaoEm: null });
    expect(k.whatsapps()).toEqual(['Presença confirmada. Até lá!', 'remarcar']);
  });

  it('code-review do PR #7 (rodada 2): corrida "2" no WhatsApp × "Preciso remarcar" no link — o job do "2" começou antes do pedido do link; o "2" repetido depois não responde de novo', async () => {
    const T = await tenant();
    const { c, p } = await lembreteEnviado(T);
    // o link grava o pedido às 15:05; o job do "2" tinha começado às 15:00 (o `agora` dele é anterior ao pedido)
    await pedirRemarcacao(ctxPaciente(T.tenantId, p.id), tenantAgenda(T), c, { db: app.db, now: new Date(agora.getTime() + 5 * 60_000), appUrl: 'http://localhost:3000' });
    await processar(upsert(`nd-${T.tenantId}`, '2'));
    await processar(upsert(`nd-${T.tenantId}`, '2'), { ...deps, agora: new Date(agora.getTime() + 10 * 60_000) });
    const todas = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, c), eq(notifications.tipo, 'resposta_remarcar'))), app.db);
    expect(todas.map((n) => n.canal).sort()).toEqual(['email', 'whatsapp']);
  });

  it('resposta citando a mensagem escolhe aquela consulta; sem citação, a do lembrete mais recente', async () => {
    const T = await tenant();
    const a = await lembreteEnviado(T, { inicio: em('2026-10-16', '09:00') });
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ enviadaEm: em('2026-10-15', '09:00') }).where(eq(notifications.providerMsgId, a.msgId)), app.db);
    const c2 = await consultaDireta(app.db, T.ctx, a.p.id, em('2026-10-16', '16:00'));
    await withTenant(
      T.ctx,
      (tx) =>
        tx.insert(notifications).values({ tenantId: T.tenantId, patientId: a.p.id, appointmentId: c2, inicioConsulta: em('2026-10-16', '16:00'), canal: 'whatsapp', tipo: 'lembrete_24h', status: 'lida', providerMsgId: `WA-${randomUUID()}`, providerJid: JID, agendadaPara: em('2026-10-15', '14:00'), enviadaEm: em('2026-10-15', '14:00') }),
      app.db,
    );
    await processar(upsert(`nd-${T.tenantId}`, '1', { contextInfo: { stanzaId: a.msgId } }));
    expect((await consulta(T, a.c)).status).toBe('confirmada');
    expect((await consulta(T, c2)).status).toBe('agendada');
    await processar(upsert(`nd-${T.tenantId}`, '1'));
    expect((await consulta(T, c2)).status).toBe('confirmada');
  });

  it('dois pacientes com o mesmo telefone: só a consulta do lembrete mais recente àquele número muda', async () => {
    const T = await tenant();
    const velho = await lembreteEnviado(T, { inicio: em('2026-10-16', '09:00') });
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ enviadaEm: em('2026-10-15', '09:00') }).where(eq(notifications.providerMsgId, velho.msgId)), app.db);
    const novo = await lembreteEnviado(T, { inicio: em('2026-10-16', '11:00') }); // outro paciente (a mãe), mesmo número
    expect(novo.p.id).not.toBe(velho.p.id);
    await processar(upsert(`nd-${T.tenantId}`, '1'));
    expect((await consulta(T, novo.c)).status).toBe('confirmada');
    expect((await consulta(T, velho.c)).status).toBe('agendada');
  });

  it('número que o WhatsApp devolve sem o 9º dígito: casa pelo destino real do envio (provider_jid), não pelo telefone cadastrado', async () => {
    const T = await tenant();
    const sem9 = '551112345678@s.whatsapp.net';
    const { c } = await lembreteEnviado(T, { jid: sem9 });
    await processar(upsert(`nd-${T.tenantId}`, '1')); // do número cadastrado (com o 9): não foi para ele que o lembrete saiu
    expect((await consulta(T, c)).status).toBe('agendada');
    await processar(upsert(`nd-${T.tenantId}`, '1', {}, sem9));
    expect((await consulta(T, c)).status).toBe('confirmada');
  });

  it('depois de "Alterar data e hora", "1" ou "2" ao lembrete do horário antigo não muda a consulta nem responde (D17)', async () => {
    const T = await tenant();
    const { c, msgId } = await lembreteEnviado(T);
    // a nutricionista moveu a consulta depois do envio: a linha enviada continua com inicio_consulta = 16/10 14:00
    await withTenant(T.ctx, (tx) => tx.update(appointments).set({ inicio: em('2026-10-18', '10:00'), fim: em('2026-10-18', '10:50') }).where(eq(appointments.id, c)), app.db);
    await processar(upsert(`nd-${T.tenantId}`, '1'));
    await processar(upsert(`nd-${T.tenantId}`, '2', { contextInfo: { stanzaId: msgId } }));
    expect(await consulta(T, c)).toMatchObject({ status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
    expect((await respostas(T, c)).filter((n) => n.tipo !== 'lembrete_24h')).toHaveLength(0);
  });

  it('D17 sob a trava: a nutricionista muda o horário entre a busca do lembrete e a confirmação — nada muda, nada responde', async () => {
    const T = await tenant();
    const { c } = await lembreteEnviado(T);
    const real = (await vi.importActual<typeof import('@/modules/agenda/cancelamento')>('@/modules/agenda/cancelamento')).confirmarPresenca;
    vi.mocked(confirmarPresenca).mockImplementationOnce(async (...args) => {
      await withTenant(T.ctx, (tx) => tx.update(appointments).set({ inicio: em('2026-10-18', '10:00'), fim: em('2026-10-18', '11:00') }).where(eq(appointments.id, c)), app.db);
      return real(...args);
    });
    await processar(upsert(`nd-${T.tenantId}`, '1'));
    expect(vi.mocked(confirmarPresenca)).toHaveBeenCalled();
    expect(await consulta(T, c)).toMatchObject({ status: 'agendada', confirmadaVia: null, inicio: em('2026-10-18', '10:00') });
    expect((await respostas(T, c)).filter((n) => n.tipo !== 'lembrete_24h')).toHaveLength(0);
  });

  it('nada muda: outro número, lembrete de mais de 26 h, consulta já começada, tenant sem a consulta', async () => {
    const T = await tenant();
    const { c } = await lembreteEnviado(T);
    const inst = `nd-${T.tenantId}`;
    await processar(upsert(inst, '1', {}, '5511988887777@s.whatsapp.net'));
    expect((await consulta(T, c)).status).toBe('agendada');
    await processarEventoWhatsapp(classificarEvento(upsert(inst, '1'))!, { ...deps, agora: em('2026-10-16', '17:00') }); // > 26 h e depois do início
    expect((await consulta(T, c)).status).toBe('agendada');
    const U = await tenant();
    await processar(upsert(`nd-${U.tenantId}`, '1'));
    expect((await consulta(T, c)).status).toBe('agendada');
    expect((await respostas(T, c)).filter((n) => n.tipo !== 'lembrete_24h')).toHaveLength(0);
  });

  it('paciente arquivado ou consultório suspenso (RN-08, RN-15): "1" não confirma nem responde', async () => {
    const T = await tenant();
    const arq = await lembreteEnviado(T);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, arq.p.id)), app.db);
    await processar(upsert(`nd-${T.tenantId}`, '1'));
    expect((await consulta(T, arq.c)).status).toBe('agendada');
    expect((await respostas(T, arq.c)).filter((n) => n.tipo !== 'lembrete_24h')).toHaveLength(0);
    const U = await tenant();
    const sus = await lembreteEnviado(U);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, U.tenantId));
    await processar(upsert(`nd-${U.tenantId}`, '2'));
    expect(await consulta(U, sus.c)).toMatchObject({ status: 'agendada', pedidoRemarcacaoEm: null });
    expect((await respostas(U, sus.c)).filter((n) => n.tipo !== 'lembrete_24h')).toHaveLength(0);
  });

  it('T5: a resposta ainda não enviada é do horário antigo — "Alterar data e hora" a marca como "consulta remarcada"; consulta cancelada não recebe a resposta', async () => {
    const T = await tenant();
    const { c } = await lembreteEnviado(T);
    await processar(upsert(`nd-${T.tenantId}`, '1'));
    await moverConsulta(T.ctx, tenantAgenda(T), c, { data: '2026-10-17', hora: '10:00', duracaoMin: '60', localId: await localPrincipal(app.db, T.ctx) }, { db: app.db, now: agora });
    expect((await respostas(T, c)).find((n) => n.tipo === 'resposta_confirmacao')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'consulta_remarcada' });
    // a resposta já reservada ("enviando") quando a consulta é cancelada: o envio confere a consulta (como nos lembretes)
    const U = await tenant();
    const o = await lembreteEnviado(U);
    await processar(upsert(`nd-${U.tenantId}`, '2'));
    await withTenant(U.ctx, (tx) => tx.update(appointments).set({ status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora }).where(eq(appointments.id, o.c)), app.db);
    const w = whatsappFalso();
    await processarNotificacoes(depsDeEnvio(agora, { db: app.db, whatsapp: w }), { tenantId: U.tenantId });
    expect(w.enviados.filter((e) => e.texto.startsWith('Tudo bem!'))).toEqual([]);
    expect((await respostas(U, o.c)).find((n) => n.tipo === 'resposta_remarcar')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'consulta_cancelada' });
  });

  it('a resposta sai pelo motor: "Presença confirmada. Até lá!" ao número do paciente, sem contar na cota', async () => {
    const T = await tenant();
    const { c } = await lembreteEnviado(T);
    await processar(upsert(`nd-${T.tenantId}`, 'sim'));
    const w = whatsappFalso();
    await processarNotificacoes(depsDeEnvio(agora, { db: app.db, whatsapp: w }), { tenantId: T.tenantId });
    expect(w.enviados.map((e) => [e.numero, e.texto])).toEqual([['5511912345678', 'Presença confirmada. Até lá!']]);
    expect((await respostas(T, c)).find((n) => n.tipo === 'resposta_confirmacao')).toMatchObject({ status: 'enviada' });
    // T11: só o lembrete conta (FORA_DA_COTA)
    expect((await situacaoDaCota(T.ctx, { fuso: T.tenant.fuso, waCotaMensal: 500 }, agora, app.db)).usadas).toBe(1);
  });

  it('status: só avança (enviada → entregue → lida); ERROR de lembrete enviado vira "falhou" e o e-mail que tinha falhado volta', async () => {
    const T = await tenant();
    const { c, msgId } = await lembreteEnviado(T);
    const inst = `nd-${T.tenantId}`;
    const st = (status: string, id = msgId, instancia = inst) => processar({ event: 'messages.update', instance: instancia, data: { keyId: id, fromMe: true, status } }, { ...deps, ultimaTentativa: true });
    await st('DELIVERY_ACK');
    await st('READ');
    await st('DELIVERY_ACK'); // fora de ordem
    await st('ERROR'); // lida não "desfalha"
    expect((await respostas(T, c)).find((n) => n.tipo === 'lembrete_24h')?.status).toBe('lida');
    const errId = `WA-ERR-${randomUUID()}`;
    const o = await lembreteEnviado(T, { inicio: em('2026-10-17', '14:00'), msgId: errId });
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: o.p.id, appointmentId: o.c, inicioConsulta: em('2026-10-17', '14:00'), canal: 'email', tipo: 'lembrete_24h', status: 'falhou', erro: 'email', agendadaPara: agora }), app.db);
    const U = await tenant();
    await st('ERROR', errId, `nd-${U.tenantId}`); // outra instância não alcança a mensagem deste consultório (RLS)
    expect((await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.providerMsgId, errId)), app.db))[0].status).toBe('enviada');
    await st('ERROR', errId);
    await st('ERROR', errId); // repetido
    const ns = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, o.c)), app.db);
    expect(ns.find((n) => n.canal === 'whatsapp')).toMatchObject({ status: 'falhou', erro: 'erro_entrega' });
    expect(ns.find((n) => n.canal === 'email')).toMatchObject({ status: 'pendente', tentativas: 0, agendadaPara: agora });
  });

  it('T5: ERROR do WhatsApp (trava o WhatsApp e depois o e-mail) ao mesmo tempo que o gravar de agendarLembretes (e-mail e depois WhatsApp) — sem deadlock', async () => {
    const T = await tenant();
    const msgId = `WA-${randomUUID()}`;
    const { p, c } = await lembreteEnviado(T, { msgId });
    const [email] = await withTenant(
      T.ctx,
      (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: em('2026-10-16', '14:00'), canal: 'email', tipo: 'lembrete_24h', status: 'falhou', erro: 'email', agendadaPara: agora }).returning(),
      app.db,
    );
    const [whats] = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.providerMsgId, msgId)), app.db);
    const outra = await app.pool.connect();
    let aberta = true;
    try {
      // como o INSERT … ON CONFLICT de gravar (a consulta voltou a este horário): trava o e-mail antes do WhatsApp
      await outra.query('begin');
      await outra.query(`select set_config('app.tenant_id', $1, true), set_config('app.role', 'nutri', true)`, [T.tenantId]);
      await outra.query('select 1 from notifications where id = $1 for update', [email.id]);
      const pid = (await outra.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0].pid;
      let terminou = false;
      const erro = processar({ event: 'messages.update', instance: `nd-${T.tenantId}`, data: { keyId: msgId, fromMe: true, status: 'ERROR' } }).then(
        () => null,
        (e: unknown) => e,
      );
      void erro.finally(() => (terminou = true));
      // o ERROR termina sem esperar o e-mail travado — ou (sem SKIP LOCKED) fica preso nele segurando o WhatsApp
      for (let i = 0; !terminou; i++) {
        if ((await owner.pool.query('select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))', [pid])).rowCount) break;
        if (i > 300) throw new Error('o ERROR nem terminou nem ficou preso');
        await new Promise((r) => setTimeout(r, 10));
      }
      // o gravar segue para a linha do WhatsApp
      const doGravar = await outra.query('select 1 from notifications where id = $1 for update', [whats.id]).then(
        () => null,
        (e: unknown) => e,
      );
      await outra.query(doGravar ? 'rollback' : 'commit');
      aberta = false;
      expect(doGravar).toBeNull();
      expect(await erro).toBeNull();
    } finally {
      if (aberta) await outra.query('rollback').catch(() => undefined);
      outra.release();
    }
    // o e-mail estava com o gravar: ele decide (reescreve a linha que não saiu); o fallback não espera nem duplica
    expect((await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.id, whats.id)), app.db))[0]).toMatchObject({ status: 'falhou', erro: 'erro_entrega' });
  });

  it('revisão 1 (item 1): citando uma mensagem que não é um lembrete válido (mensagem que a nutricionista digitou, lembrete de horário antigo), nada muda e nada responde; citando o outro lembrete válido, só ele', async () => {
    const T = await tenant();
    const inst = `nd-${T.tenantId}`;
    // mãe e filha no mesmo número: dois lembretes válidos; o da filha (b) é o mais recente
    const a = await lembreteEnviado(T, { inicio: em('2026-10-16', '09:00') });
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ enviadaEm: em('2026-10-15', '09:00') }).where(eq(notifications.providerMsgId, a.msgId)), app.db);
    const b = await lembreteEnviado(T, { inicio: em('2026-10-16', '16:00') });
    // um terceiro lembrete, de consulta que a nutricionista mudou de horário depois do envio (fora pelo D17)
    const velho = await lembreteEnviado(T, { inicio: em('2026-10-17', '10:00') });
    await withTenant(T.ctx, (tx) => tx.update(appointments).set({ inicio: em('2026-10-19', '10:00'), fim: em('2026-10-19', '11:00') }).where(eq(appointments.id, velho.c)), app.db);
    await processar(upsert(inst, 'Não posso', { contextInfo: { stanzaId: `MANUAL-${randomUUID()}` } })); // responde à mensagem manual "Consegue vir às 13:30?"
    await processar(upsert(inst, 'Ok', { contextInfo: { stanzaId: `MANUAL-${randomUUID()}` } }));
    await processar(upsert(inst, '2', { contextInfo: { stanzaId: velho.msgId } }));
    for (const x of [a, b, velho]) {
      expect(await consulta(T, x.c)).toMatchObject({ status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
      expect((await respostas(T, x.c)).filter((n) => n.tipo !== 'lembrete_24h')).toEqual([]);
    }
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect(await emailsNaFila('aviso_agenda', nutri.email)).toEqual([]);
    await processar(upsert(inst, '1', { contextInfo: { stanzaId: a.msgId } })); // cita o lembrete mais antigo, ainda válido
    expect((await consulta(T, a.c)).status).toBe('confirmada');
    expect((await consulta(T, b.c)).status).toBe('agendada');
  });

  it('revisão 1 (item 7): ERROR que chega antes de o envio gravar o id da mensagem volta para a fila e vale quando o id aparece; entregue/lida de id desconhecido são descartados; na última tentativa, desiste em silêncio', async () => {
    const T = await tenant();
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511912345678', whatsappOptinEm: agora, whatsappOptinOrigem: 'nutri' });
    const inicio = em('2026-10-16', '14:00');
    const c = await consultaDireta(app.db, T.ctx, p.id, inicio);
    const base = { tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: inicio, tipo: 'lembrete_24h', agendadaPara: em('2026-10-15', '14:00') };
    // o worker chamou a Evolution e ainda não gravou o resultado: "enviando", sem o id
    const [w] = await withTenant(T.ctx, (tx) => tx.insert(notifications).values([{ ...base, canal: 'whatsapp', status: 'enviando', tentativas: 1 }, { ...base, canal: 'email', status: 'falhou', erro: 'email' }]).returning(), app.db);
    const id = `WA-${randomUUID()}`;
    const inst = `nd-${T.tenantId}`;
    const erro = classificarEvento({ event: 'messages.update', instance: inst, data: { keyId: id, fromMe: true, status: 'ERROR' } })!;
    const falha = await processarEventoWhatsapp(erro, deps).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(falha).toBeInstanceOf(Error); // a fila repete (com espera)
    expect(falha!.message).not.toContain(id);
    expect(await processarEventoWhatsapp(classificarEvento({ event: 'messages.update', instance: inst, data: { keyId: id, fromMe: true, status: 'DELIVERY_ACK' } })!, deps)).toBeUndefined();
    await expect(processarEventoWhatsapp(erro, { ...deps, ultimaTentativa: true })).resolves.toBeUndefined();
    // o registrarResultado grava o id; a repetição do ERROR vale
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'enviada', providerMsgId: id, providerJid: JID, enviadaEm: agora }).where(eq(notifications.id, w.id)), app.db);
    await processarEventoWhatsapp(erro, deps);
    const ns = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, c)), app.db);
    expect(ns.find((n) => n.canal === 'whatsapp')).toMatchObject({ status: 'falhou', erro: 'erro_entrega' });
    expect(ns.find((n) => n.canal === 'email')).toMatchObject({ status: 'pendente' });
  });

  it('conexão: "open" grava "conectada" e o número', async () => {
    const T = await tenant();
    await conexaoDeTeste(app.db, T.ctx, 'conectando');
    await processar({ event: 'connection.update', instance: `nd-${T.tenantId}`, data: { state: 'open', wuid: JID } });
    const [cx] = await withTenant(T.ctx, (tx) => tx.select().from(whatsappConexoes), app.db);
    expect(cx).toMatchObject({ estado: 'conectada', numeroE164: '+5511912345678' });
  });
});

describe('receberWebhook (D4, D5)', () => {
  const S = 's'.repeat(40);
  const A = 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';
  const B = 'nd-1c7e4d2f-9b8e-4d3c-8a21-2b3c4d5e6f70';
  const jwtDe = (instancia: string) => assinarJwtWebhook(chaveDoWebhook(S, instancia), new Date());
  const req = (corpo: string, token?: string) => new Request('http://localhost/api/webhooks/whatsapp', { method: 'POST', body: corpo, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const fila: EventoWhatsapp[] = [];
  const o = { segredo: S, db: app.db, enfileirar: async (ev: EventoWhatsapp) => void fila.push(ev) };

  it('sem segredo: 404; sem JWT: 401 sem enfileirar; > 256 KB: 413; JSON inválido: 400; válido: 200 e enfileira só o evento reduzido', async () => {
    fila.length = 0;
    const corpo = JSON.stringify(upsert(A, '1'));
    expect((await receberWebhook(req(corpo), { ...o, segredo: undefined })).status).toBe(404);
    expect((await receberWebhook(req(corpo), o)).status).toBe(401);
    expect((await receberWebhook(req(corpo, 'nao.e.jwt valido'), o)).status).toBe(401);
    expect(fila).toEqual([]);
    expect((await receberWebhook(req(JSON.stringify({ x: 'y'.repeat(300 * 1024) }), jwtDe(A)), o)).status).toBe(413);
    expect((await receberWebhook(req('{x', jwtDe(A)), o)).status).toBe(400);
    const ok = await receberWebhook(req(corpo, jwtDe(A)), o);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(fila).toEqual([expect.objectContaining({ tipo: 'resposta', intencao: 'confirmar', de: '5511912345678' })]);
    expect(JSON.stringify(fila)).not.toMatch(/conversation|Ana|apikey/);
    expect(await (await receberWebhook(req(JSON.stringify({ event: 'chats.update', instance: A, data: {} }), jwtDe(A)), o)).json()).toEqual({ ok: true });
    expect(fila).toHaveLength(1);
  });

  it('D4 (a): JWT da instância de outro consultório, do segredo-mestre (sem a chave da instância) ou corpo sem instância válida → 401 sem enfileirar; o log só leva o motivo', async () => {
    fila.length = 0;
    const aviso = vi.spyOn(logger, 'warn');
    const deA = jwtDe(A);
    expect((await receberWebhook(req(JSON.stringify(upsert(B, '1')), deA), o)).status).toBe(401); // corpo de B com o JWT de A
    expect((await receberWebhook(req(JSON.stringify(upsert(A, '1')), assinarJwtWebhook(S, new Date())), o)).status).toBe(401);
    expect((await receberWebhook(req(JSON.stringify(upsert('outra-instancia', '1')), jwtDe('outra-instancia')), o)).status).toBe(401);
    expect(fila).toEqual([]);
    const logado = JSON.stringify(aviso.mock.calls);
    aviso.mockRestore();
    expect(logado).toContain('assinatura');
    for (const segredo of [deA, A.slice(3), B.slice(3), '5511912345678', 'outra-instancia']) expect(logado).not.toContain(segredo);
  });

  it('D4 (b) / R2: o mesmo pedido (JWT + corpo) repetido → 200 sem enfileirar; outro evento no mesmo segundo, com o mesmo JWT, passa; se enfileirar falhar, a repetição da Evolution passa', async () => {
    fila.length = 0;
    const t = jwtDe(A);
    const um = JSON.stringify(upsert(A, '1'));
    expect((await receberWebhook(req(um, t), o)).status).toBe(200);
    const repetido = await receberWebhook(req(um, t), o);
    expect(repetido.status).toBe(200); // US-035: "Evento repetido → HTTP 200" — sem efeito
    expect(await repetido.json()).toEqual({ ok: true });
    expect(fila).toHaveLength(1);
    expect((await receberWebhook(req(JSON.stringify(upsert(A, '2')), t), o)).status).toBe(200); // o JWT da Evolution é o mesmo no mesmo segundo
    expect(fila).toHaveLength(2);
    const outro = JSON.stringify(upsert(A, 'sim'));
    await expect(receberWebhook(req(outro, t), { ...o, enfileirar: async () => { throw new Error('fila fora do ar'); } })).rejects.toThrow('fila fora do ar');
    expect((await receberWebhook(req(outro, t), o)).status).toBe(200);
    expect(fila).toHaveLength(3);
  });
  it('revisão 1 (item 3): a marca dura enquanto o JWT é aceito (do 1º ao último segundo, até exp + 60 s), não 660 s desde a chegada', async () => {
    fila.length = 0;
    const t0 = new Date('2026-10-16T12:00:00Z');
    const iat = Math.floor(t0.getTime() / 1000);
    // validade máxima aceita (exp = iat + 900): chega no 1º segundo aceito (iat − 60) e volta no último (exp + 60)
    const longo = assinarJwtWebhook(chaveDoWebhook(S, A), t0, { exp: iat + 900 });
    const um = JSON.stringify(upsert(A, '1'));
    expect((await receberWebhook(req(um, longo), { ...o, agora: new Date(t0.getTime() - 60_000) })).status).toBe(200);
    expect((await receberWebhook(req(um, longo), { ...o, agora: new Date(t0.getTime() + 960_999) })).status).toBe(200);
    expect(fila).toHaveLength(1);
    // o JWT padrão da Evolution (exp = iat + 600), repetido em exp + 60 s
    const padrao = assinarJwtWebhook(chaveDoWebhook(S, A), t0);
    const dois = JSON.stringify(upsert(A, '2'));
    await receberWebhook(req(dois, padrao), { ...o, agora: t0 });
    expect((await receberWebhook(req(dois, padrao), { ...o, agora: new Date(t0.getTime() + 660_000) })).status).toBe(200);
    expect(fila).toHaveLength(2);
  });

  it('revisão 1 (item 4): a marca e o evento na fila são uma escrita só — enquanto o evento entra na fila a marca ainda não vale para ninguém (uma queda aqui não perde o evento); se enfileirar falhar, nada fica e a repetição passa', async () => {
    fila.length = 0;
    const marcas = async (chave: string) => (await app.db.select().from(publicRateLimits).where(eq(publicRateLimits.chave, chave))).length;
    const t = jwtDe(A);
    const corpo = JSON.stringify(upsert(A, 'sim'));
    const marca = marcaDoPedido(t, Buffer.from(corpo));
    let vistaDurante = -1;
    const espiando = { ...o, enfileirar: async (ev: EventoWhatsapp) => { vistaDurante = await marcas(marca); fila.push(ev); } };
    expect((await receberWebhook(req(corpo, t), espiando)).status).toBe(200);
    expect(vistaDurante).toBe(0);
    expect(await marcas(marca)).toBe(1);
    expect(fila).toHaveLength(1);
    const outro = JSON.stringify(upsert(A, 'confirmo'));
    await expect(receberWebhook(req(outro, t), { ...o, enfileirar: async () => { throw new Error('fila fora do ar'); } })).rejects.toThrow('fila fora do ar');
    expect(await marcas(marcaDoPedido(t, Buffer.from(outro)))).toBe(0);
    expect((await receberWebhook(req(outro, t), o)).status).toBe(200);
    expect(fila).toHaveLength(2);
  });
});
