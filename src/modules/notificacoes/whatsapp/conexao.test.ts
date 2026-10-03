import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant } from '../../../../test/pacientes';
import { whatsappFalso } from '../../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { user, whatsappConexoes } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { atualizarEstadoConexao, conectarWhatsapp, desconectarWhatsapp, instanciaDoTenant, situacaoDoWhatsapp, sincronizarEstado, tenantDaInstancia } from './conexao';
import { WhatsappIndisponivelError, type ProvedorWhatsapp } from './provedor';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const deps = { db: app.db, agora: new Date('2026-10-14T12:00:00Z'), appUrl: 'http://localhost:3000' };
const emailDaNutri = async (nutriId: string) => (await app.db.select({ email: user.email }).from(user).where(eq(user.id, nutriId)))[0].email;
const linha = async (ctx: Parameters<typeof situacaoDoWhatsapp>[0]) => (await withTenant(ctx, (tx) => tx.select().from(whatsappConexoes), app.db))[0];
const fora = (): ProvedorWhatsapp => ({
  ...whatsappFalso(),
  conectar: async () => {
    throw new WhatsappIndisponivelError('Evolution respondeu HTTP 502');
  },
  desconectar: async () => {
    throw new WhatsappIndisponivelError('Evolution respondeu HTTP 502');
  },
});

describe('conexão do WhatsApp por tenant (D2)', () => {
  it('instância nd-<tenantId>, e de volta; nada fora do formato', () => {
    const id = randomUUID();
    expect(tenantDaInstancia(instanciaDoTenant(id))).toBe(id);
    expect([tenantDaInstancia('nd-x'), tenantDaInstancia('outra'), tenantDaInstancia(42)]).toEqual([null, null, null]);
  });

  it('conectar: grava "conectando" e devolve o QR; o webhook "open" vira "conectada" com o número; polling também', async () => {
    const T = await novoTenant(app.db);
    const w = whatsappFalso();
    expect(await conectarWhatsapp(T.ctx, w, deps)).toEqual({ estado: 'qr', qr: 'data:image/png;base64,AAAA' });
    expect(w.conectadas).toEqual([`nd-${T.tenantId}`]);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ ligado: true, estado: 'conectando', numero: null });
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ estado: 'conectada', numero: '+5511912345678', conectadaAntes: true });
    const U = await novoTenant(app.db);
    await conectarWhatsapp(U.ctx, w, deps);
    expect(await sincronizarEstado(U.ctx, whatsappFalso({ estado: 'conectada' }), deps)).toMatchObject({ estado: 'conectada', numero: '+5511900001111' });
  });

  it('o celular desconecta: "desconectada" e um e-mail à nutricionista (uma vez por desconexão); desconectar pelo painel não manda e-mail', async () => {
    const T = await novoTenant(app.db);
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    await conectarWhatsapp(T.ctx, whatsappFalso(), deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, deps);
    expect(await emailsNaFila('whatsapp_desconectado', nutri.email)).toHaveLength(1);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ estado: 'desconectada', conectadaAntes: true });
    const U = await novoTenant(app.db);
    const [nu] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, U.nutriId));
    const w = whatsappFalso();
    await conectarWhatsapp(U.ctx, w, deps);
    await atualizarEstadoConexao(U.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    await desconectarWhatsapp(U.ctx, w, deps);
    expect(w.desconectadas).toEqual([`nd-${U.tenantId}`]);
    await atualizarEstadoConexao(U.tenantId, { estado: 'desconectada' }, deps); // o webhook chega depois
    expect(await emailsNaFila('whatsapp_desconectado', nu.email)).toEqual([]);
  });

  it('tenant sem conexão: o webhook não cria linha; WhatsApp desligado na plataforma; paciente não vê a conexão (staff_only)', async () => {
    const T = await novoTenant(app.db);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(whatsappConexoes), app.db)).toEqual([]);
    expect(await situacaoDoWhatsapp(T.ctx, false, app.db)).toMatchObject({ ligado: false, estado: 'desconectada' });
    await conectarWhatsapp(T.ctx, whatsappFalso(), deps);
    const p = await novoPaciente(app.db, T.ctx);
    expect(await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.select().from(whatsappConexoes), app.db)).toEqual([]);
  });
});

describe('conexão do WhatsApp: itens da revisão da T9', () => {
  const depois = (min: number) => ({ ...deps, agora: new Date(deps.agora.getTime() + min * 60_000) });

  it('(a) reconexão da mesma sessão ("connecting" depois de "open") não pisca nem avisa; a queda ("close") avisa uma vez; QR que expira sem nunca conectar não avisa', async () => {
    const T = await novoTenant(app.db);
    const email = await emailDaNutri(T.nutriId);
    await conectarWhatsapp(T.ctx, whatsappFalso(), deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectando' }, deps); // QR na tela
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, deps); // QR expirou ("refused"): nunca conectou
    expect(await emailsNaFila('whatsapp_desconectado', email)).toEqual([]);
    expect(await linha(T.ctx)).toMatchObject({ estado: 'desconectada', desconectadaEm: null });
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, depois(1));
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectando' }, depois(2)); // o Baileys reconecta a mesma sessão…
    expect(await linha(T.ctx)).toMatchObject({ estado: 'conectada', conectadaEm: depois(1).agora }); // … sem piscar (os lembretes seguem saindo)
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectando' }, depois(3));
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, depois(4)); // … e a sessão cai ("close")
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, depois(5));
    expect(await emailsNaFila('whatsapp_desconectado', email)).toHaveLength(1);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ estado: 'desconectada', desconectadaEm: depois(4).agora, conectadaAntes: true });
    // reconectou pelo QR; a queda seguinte, passadas 6 h do e-mail, avisa de novo (revisão 1, item 6)
    await conectarWhatsapp(T.ctx, whatsappFalso(), depois(9));
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, depois(10));
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, depois(4 + 6 * 60));
    expect(await emailsNaFila('whatsapp_desconectado', email)).toHaveLength(2);
  });

  it('(a) estava conectada desde a última desconexão e caiu passando por "conectando" (gravado pelo "Conectar" de novo): avisa e marca a desconexão', async () => {
    const T = await novoTenant(app.db);
    const email = await emailDaNutri(T.nutriId);
    await conectarWhatsapp(T.ctx, whatsappFalso(), deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    await conectarWhatsapp(T.ctx, whatsappFalso(), depois(1)); // a sessão se perdeu sem aviso; o "Conectar" pede outro QR
    expect(await linha(T.ctx)).toMatchObject({ estado: 'conectando', desconectadaEm: null });
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, depois(4)); // o QR expirou
    expect(await emailsNaFila('whatsapp_desconectado', email)).toHaveLength(1);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ estado: 'desconectada', desconectadaEm: depois(4).agora, conectadaAntes: true });
  });

  it('revisão 1 (item 6): no máximo um e-mail de desconexão a cada 6 h por consultório — "open"/"close" alternados (JWT capturado) não disparam e-mails; a queda dentro da janela atualiza o estado e o painel', async () => {
    const T = await novoTenant(app.db);
    const email = await emailDaNutri(T.nutriId);
    const h = (x: number) => ({ ...deps, agora: new Date(deps.agora.getTime() + x * 3_600_000) });
    await conectarWhatsapp(T.ctx, whatsappFalso(), deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, h(0));
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, h(0.5)); // e-mail
    for (const x of [1, 1.25, 1.5]) {
      await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, h(x));
      await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, h(x + 0.1)); // 1 h depois: sem e-mail
    }
    expect(await emailsNaFila('whatsapp_desconectado', email)).toHaveLength(1);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ estado: 'desconectada', desconectadaEm: h(1.6).agora });
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, h(7));
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, h(7.5)); // 7 h depois do e-mail
    expect(await emailsNaFila('whatsapp_desconectado', email)).toHaveLength(2);
  });

  it('(b) serviço fora do ar ao conectar: não cria a linha nem deixa a conexão presa em "conectando" (o aviso de desconectado continua)', async () => {
    const T = await novoTenant(app.db);
    await expect(conectarWhatsapp(T.ctx, fora(), deps)).rejects.toThrow(WhatsappIndisponivelError);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(whatsappConexoes), app.db)).toEqual([]);
    await conectarWhatsapp(T.ctx, whatsappFalso(), deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, depois(1));
    await expect(conectarWhatsapp(T.ctx, fora(), depois(2))).rejects.toThrow(WhatsappIndisponivelError);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ estado: 'desconectada', desconectadaEm: depois(1).agora, conectadaAntes: true });
  });

  it('(c) "Desconectar": o "close" da Evolution que chega antes de a chamada terminar não manda e-mail; serviço fora do ar → erro, nada muda e a queda seguinte ainda avisa', async () => {
    const T = await novoTenant(app.db);
    await conectarWhatsapp(T.ctx, whatsappFalso(), deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    const w = whatsappFalso();
    // o webhook do logout é processado enquanto o DELETE /instance/logout ainda não voltou
    const comWebhook: ProvedorWhatsapp = { ...w, desconectar: async () => atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, depois(1)) };
    await desconectarWhatsapp(T.ctx, comWebhook, depois(1));
    expect(await emailsNaFila('whatsapp_desconectado', await emailDaNutri(T.nutriId))).toEqual([]);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ estado: 'desconectada' });

    const U = await novoTenant(app.db);
    await conectarWhatsapp(U.ctx, whatsappFalso(), deps);
    await atualizarEstadoConexao(U.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    await expect(desconectarWhatsapp(U.ctx, fora(), depois(1))).rejects.toThrow(WhatsappIndisponivelError);
    expect(await linha(U.ctx)).toMatchObject({ estado: 'conectada', avisoDesconexaoEm: null, desconectadaEm: null });
    await atualizarEstadoConexao(U.tenantId, { estado: 'desconectada' }, depois(2));
    expect(await emailsNaFila('whatsapp_desconectado', await emailDaNutri(U.nutriId))).toHaveLength(1);
  });

  it('(d) polling que não informa o número (null): não reescreve "conectada em" nem apaga o número', async () => {
    const T = await novoTenant(app.db);
    await conectarWhatsapp(T.ctx, whatsappFalso(), deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: null }, depois(1));
    expect(await linha(T.ctx)).toMatchObject({ estado: 'conectada', numeroE164: '+5511912345678', conectadaEm: deps.agora, updatedAt: deps.agora });
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511900002222' }, depois(2)); // outro número: muda
    expect(await linha(T.ctx)).toMatchObject({ numeroE164: '+5511900002222' });
  });
});
