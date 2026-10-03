import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { MSG_PERFIL, PerfilPacienteError, preferenciaWhatsapp, situacaoDoWhatsapp } from './perfil';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('Perfil > Notificações: WhatsApp (US-011)', () => {
  it('desmarcar grava o opt-out; marcar de novo grava o opt-in de origem paciente', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511912345678', whatsappOptinEm: new Date(), whatsappOptinOrigem: 'nutri' });
    const ctx = ctxPaciente(T.tenantId, p.id);
    expect(await situacaoDoWhatsapp(ctx, app.db)).toEqual({ ativo: true, temTelefone: true });
    await preferenciaWhatsapp(ctx, false, { db: app.db });
    const ler = async () => (await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, p.id)), app.db))[0];
    expect((await ler()).whatsappOptoutEm).not.toBeNull();
    expect(await situacaoDoWhatsapp(ctx, app.db)).toEqual({ ativo: false, temTelefone: true });
    await preferenciaWhatsapp(ctx, true, { db: app.db });
    expect(await ler()).toMatchObject({ whatsappOptinOrigem: 'paciente', whatsappOptoutEm: null });
    expect(await situacaoDoWhatsapp(ctx, app.db)).toEqual({ ativo: true, temTelefone: true });
  });

  it('"Salvar" com o WhatsApp já autorizado não muda nada: a data e a origem do opt-in ("nutri") ficam como estavam', async () => {
    const T = await novoTenant(app.db);
    const quando = new Date('2026-09-01T12:00:00Z');
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511912345678', whatsappOptinEm: quando, whatsappOptinOrigem: 'nutri' });
    await preferenciaWhatsapp(ctxPaciente(T.tenantId, p.id), true, { db: app.db, agora: new Date('2026-10-03T12:00:00Z') });
    const [q] = await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, p.id)), app.db);
    expect(q).toMatchObject({ whatsappOptinEm: quando, whatsappOptinOrigem: 'nutri', whatsappOptoutEm: null });
  });

  it('sem telefone, marcar é recusado com a orientação; desmarcar não muda nada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: null });
    await expect(preferenciaWhatsapp(ctxPaciente(T.tenantId, p.id), true, { db: app.db })).rejects.toEqual(new PerfilPacienteError(MSG_PERFIL.semTelefone));
    await preferenciaWhatsapp(ctxPaciente(T.tenantId, p.id), false, { db: app.db });
    expect(await situacaoDoWhatsapp(ctxPaciente(T.tenantId, p.id), app.db)).toEqual({ ativo: false, temTelefone: false });
  });

  it('só a linha do próprio paciente: a sessão de outro não altera este', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511912345678', whatsappOptinEm: new Date(), whatsappOptinOrigem: 'nutri' });
    const outro = await novoPaciente(app.db, T.ctx, { telefoneE164: '+5511987654321' });
    await preferenciaWhatsapp(ctxPaciente(T.tenantId, outro.id), false, { db: app.db });
    expect(await situacaoDoWhatsapp(ctxPaciente(T.tenantId, p.id), app.db)).toEqual({ ativo: true, temTelefone: true });
    await expect(preferenciaWhatsapp(T.ctx, false, { db: app.db })).rejects.toThrow('só roda em sessão de paciente');
  });
});
