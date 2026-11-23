import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { account, consents, invites, tenants, user } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { aceitarConvite, ConviteError, criarConvite, inspecionarConvite } from './convites';
import { DPA_TERMO } from './dpa';
import { convidarRecepcao } from './equipe';
import { SIGILO_EQUIPE_TERMO } from './textos-versionados';

/**
 * Plano 26 (RN-500, US-489): o convite da recepção pela página `/convite/[token]` — o mesmo `aceitarConvite` da
 * nutricionista, com o termo de confidencialidade da equipe no lugar do DPA. O tipo vem do convite no banco.
 */
const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-11-17T12:00:00Z');
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

/** Um convite da recepção criado pelo módulo da Equipe; o token sai do e-mail na fila. */
async function conviteDaRecepcao() {
  const t = await novoTenant(app.db, 'Consultório Debby');
  const email = `rec-${randomUUID().slice(0, 8)}@ex.com`;
  await convidarRecepcao(t.ctx, { nome: 'Carla Lima', email, financeiro: false }, { db: app.db, appUrl: 'http://localhost:3106', now });
  const [msg] = await emailsNaFila('convite_recepcao', email);
  const [u] = await app.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  return { ...t, email, userId: u.id, token: msg.link.split('/convite/')[1] };
}
const aceite = (token: string, extra: Partial<Parameters<typeof aceitarConvite>[0]> = {}) =>
  aceitarConvite({ token, senha: 'Nutri2026segura', confirmacao: 'Nutri2026segura', aceitouDpa: false, aceitouSigilo: true, ip: '203.0.113.36', ...extra }, { db: app.db, now });

describe('convite da recepção (RN-500, US-489)', () => {
  it('inspecionarConvite devolve o tipo e o nome do consultório (a página escolhe o formulário)', async () => {
    const c = await conviteDaRecepcao();
    expect(await inspecionarConvite(app.db, c.token, now)).toEqual({ estado: 'valido', userId: c.userId, email: c.email, nome: 'Carla Lima', tipo: 'recepcao', consultorio: 'Consultório Debby' });
  });

  it('sem a caixa do termo: "Para entrar na equipe, aceite o termo de confidencialidade." e nada é gravado (nem com o DPA marcado)', async () => {
    const c = await conviteDaRecepcao();
    for (const extra of [{ aceitouSigilo: false }, { aceitouSigilo: false, aceitouDpa: true }, { aceitouSigilo: undefined, aceitouDpa: true }]) {
      const e = await aceite(c.token, extra).then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(ConviteError);
      expect(e).toMatchObject({ message: 'Para entrar na equipe, aceite o termo de confidencialidade.', campo: 'sigilo' });
    }
    expect(await app.db.select().from(account).where(eq(account.userId, c.userId))).toEqual([]);
    expect(await app.db.select().from(consents).where(eq(consents.userId, c.userId))).toEqual([]);
  });

  it('com a caixa: a senha, o e-mail verificado e o aceite `sigilo-equipe-1.0` com o consultório e o IP — sem DPA e sem mexer no DPA do consultório', async () => {
    const c = await conviteDaRecepcao();
    const [antes] = await app.db.select({ dpaVersao: tenants.dpaVersao, dpaAceitoEm: tenants.dpaAceitoEm }).from(tenants).where(eq(tenants.id, c.tenantId));
    expect(await aceite(c.token)).toEqual({ email: c.email });
    expect(SIGILO_EQUIPE_TERMO).toBe('sigilo-equipe-1.0');
    const aceites = await app.db.select().from(consents).where(eq(consents.userId, c.userId));
    expect(aceites).toHaveLength(1);
    expect(aceites[0]).toMatchObject({ termoVersao: 'sigilo-equipe-1.0', tenantId: c.tenantId, patientId: null, ip: '203.0.113.36', aceitoEm: now });
    expect(aceites.some((a) => a.termoVersao === DPA_TERMO)).toBe(false);
    const [depois] = await app.db.select({ dpaVersao: tenants.dpaVersao, dpaAceitoEm: tenants.dpaAceitoEm }).from(tenants).where(eq(tenants.id, c.tenantId));
    expect(depois).toEqual(antes);
    const [u] = await app.db.select({ emailVerified: user.emailVerified }).from(user).where(eq(user.id, c.userId));
    expect(u.emailVerified).toBe(true);
    expect(await app.db.select().from(account).where(eq(account.userId, c.userId))).toHaveLength(1);
    // usado: não vale de novo
    await expect(aceite(c.token)).rejects.toThrow(/^Convite inválido ou já usado/);
  });

  it('convite da recepção para uma conta que não é `recepcao` do consultório do convite: inválido', async () => {
    const t = await novoTenant(app.db);
    const outro = await novoTenant(app.db);
    // a conta da nutricionista de `t` com um convite `recepcao` de outro consultório (CHECK invites_alvo aceita: tem tenant)
    const { token } = await criarConvite(app.db, t.nutriId, now, { tipo: 'recepcao', tenantId: outro.tenantId });
    expect(await inspecionarConvite(app.db, token, now)).toEqual({ estado: 'invalido' });
    await expect(aceite(token)).rejects.toThrow(/^Convite inválido ou já usado/);
  });

  it('o convite da nutricionista continua como hoje: pede o DPA (a caixa do termo não serve) e grava o DPA', async () => {
    const t = await novoTenant(app.db);
    const { token } = await criarConvite(app.db, t.nutriId, now);
    const [c] = await app.db.select({ tipo: invites.tipo, tenantId: invites.tenantId }).from(invites).where(eq(invites.userId, t.nutriId));
    expect(c).toEqual({ tipo: 'nutri', tenantId: null });
    expect(await inspecionarConvite(app.db, token, now)).toMatchObject({ estado: 'valido', tipo: 'nutri' });
    await expect(aceite(token, { aceitouDpa: false, aceitouSigilo: true })).rejects.toMatchObject({ message: 'Para continuar, aceite o contrato de tratamento de dados (DPA).', campo: 'dpa' });
    expect(await aceite(token, { aceitouDpa: true, aceitouSigilo: false })).toMatchObject({ email: expect.any(String) });
    const aceites = await app.db.select({ termo: consents.termoVersao }).from(consents).where(eq(consents.userId, t.nutriId));
    expect(aceites).toEqual([{ termo: DPA_TERMO }]);
  });
});
