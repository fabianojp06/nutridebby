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

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const deps = { db: app.db, agora: new Date('2026-10-14T12:00:00Z'), appUrl: 'http://localhost:3000' };

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
