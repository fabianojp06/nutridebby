import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { closeDb } from '@/db/client';
import { account, consents, tenants, user } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { verifyPassword } from '@/lib/password.server';
import { ContaError, criarContaNutri } from './contas';
import { aceitarConvite, ConviteError, criarConvite } from './convites';
import { DPA_TERMO, DPA_VERSAO } from './dpa';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T12:00:00Z');
afterAll(async () => {
  // criarContaNutri → enqueueEmail → getBoss()/getPool() (o pool compartilhado de src/db/client,
  // distinto do `app.pool` deste arquivo, criado à parte por makeDb).
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

/** Conta nova + token em claro (gera um convite próprio, sem depender do e-mail). */
async function contaComConvite() {
  const x = randomUUID().slice(0, 8);
  const r = await criarContaNutri({ nomeExibicao: 'Debby Silva', email: `pa-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `pa-${x}` }, { db: app.db, appUrl: 'http://localhost:3000', now });
  const { token } = await criarConvite(app.db, r.userId, now);
  return { ...r, token, email: `pa-${x}@exemplo.com` };
}
const aceite = (token: string, extra: Partial<Parameters<typeof aceitarConvite>[0]> = {}) =>
  aceitarConvite({ token, senha: 'Nutri2026segura', confirmacao: 'Nutri2026segura', aceitouDpa: true, ip: '203.0.113.7', ...extra }, { db: app.db, now });

describe('aceitarConvite (US-002 "Primeiro acesso da nutricionista pelo convite")', () => {
  it('define a senha em argon2id, registra o DPA (versão, data e IP) e preenche tenants.dpa_aceito_em', async () => {
    const c = await contaComConvite();
    expect(await aceite(c.token)).toEqual({ email: c.email });
    const [acc] = await app.db.select().from(account).where(and(eq(account.userId, c.userId), eq(account.providerId, 'credential')));
    expect(await verifyPassword(acc.password!, 'Nutri2026segura')).toBe(true);
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, c.tenantId));
    expect(t.dpaAceitoEm?.toISOString()).toBe(now.toISOString());
    expect(t.dpaVersao).toBe(DPA_VERSAO);
    const [cons] = await app.db.select().from(consents).where(eq(consents.userId, c.userId));
    expect(cons).toMatchObject({ termoVersao: DPA_TERMO, ip: '203.0.113.7' });
    const [u] = await app.db.select().from(user).where(eq(user.id, c.userId));
    expect(u.emailVerified).toBe(true);
  });

  it('sem aceitar o DPA, com senha fraca ou senhas diferentes: nada é gravado e o convite continua valendo', async () => {
    const c = await contaComConvite();
    await expect(aceite(c.token, { aceitouDpa: false })).rejects.toThrow('Para continuar, aceite o contrato de tratamento de dados (DPA).');
    await expect(aceite(c.token, { senha: 'curta1', confirmacao: 'curta1' })).rejects.toThrow('A senha precisa ter pelo menos 10 caracteres.');
    await expect(aceite(c.token, { confirmacao: 'Outra2026senha' })).rejects.toThrow('As senhas não conferem.');
    expect(await app.db.select().from(account).where(eq(account.userId, c.userId))).toEqual([]);
    await expect(aceite(c.token)).resolves.toEqual({ email: c.email });
  });

  it('convite expirado: "Convite expirado. Peça um novo ao suporte."', async () => {
    const c = await contaComConvite();
    await expect(
      aceitarConvite({ token: c.token, senha: 'Nutri2026segura', confirmacao: 'Nutri2026segura', aceitouDpa: true, ip: null }, { db: app.db, now: new Date('2026-10-04T12:00:01Z') }),
    ).rejects.toThrow('Convite expirado. Peça um novo ao suporte.');
  });

  it('o mesmo convite enviado duas vezes ao mesmo tempo grava uma única senha (Review Focus 2)', async () => {
    const c = await contaComConvite();
    const r = await Promise.allSettled([aceite(c.token), aceite(c.token), aceite(c.token)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const f of r.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(f.reason).toBeInstanceOf(ConviteError);
      expect((f.reason as Error).message).toMatch(/^Convite inválido ou já usado/);
    }
    expect(await app.db.select().from(account).where(eq(account.userId, c.userId))).toHaveLength(1);
  });

  it('depois de aceito, reenviar o convite é recusado (ContaError)', async () => {
    const { reenviarConvite } = await import('./contas');
    const c = await contaComConvite();
    await aceite(c.token);
    await expect(reenviarConvite(c.tenantId, { db: app.db, appUrl: 'http://localhost:3000', now })).rejects.toBeInstanceOf(ContaError);
  });

  it('recusa senha das 10 mil mais comuns também pelo convite (T6-R2d, US-002)', async () => {
    const c = await contaComConvite();
    // "primetime21" está no dicionário de src/lib/common-passwords.txt (comprimento e formato válidos)
    const r = aceite(c.token, { senha: 'primetime21', confirmacao: 'primetime21' });
    await expect(r).rejects.toThrow('Essa senha é muito comum. Escolha outra.');
    await expect(r).rejects.toMatchObject({ campo: 'senha' });
    expect(await app.db.select().from(account).where(eq(account.userId, c.userId))).toEqual([]);
  });

  it('trava o usuário antes do convite: não há deadlock com reenviarConvite (T6-R1)', async () => {
    // Uma conexão à parte segura o lock do usuário (o mesmo que reenviarConvite trava primeiro,
    // contas.ts ~96-104) antes de `aceitarConvite` começar — prova a ordem de locks.
    const c = await contaComConvite();
    const trava = await app.pool.connect();
    await trava.query('begin');
    await trava.query('select id from "user" where id = $1 for update', [c.userId]);
    try {
      const promessa = aceite(c.token);

      // Espera `aceitarConvite` ficar bloqueado tentando travar o mesmo usuário (não o convite:
      // é exatamente essa a inversão de ordem que causava 40P01 com reenviarConvite).
      const fim = Date.now() + 5000;
      let bloqueado = false;
      while (Date.now() < fim && !bloqueado) {
        const { rows } = await app.pool.query(
          `select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%"user"%for update%'`,
        );
        bloqueado = rows.length > 0;
        if (!bloqueado) await new Promise((res) => setTimeout(res, 20));
      }
      expect(bloqueado).toBe(true);

      // Com a ordem certa (usuário primeiro), o convite continua livre: uma terceira conexão
      // consegue travá-lo NOWAIT sem esperar nem estourar lock_not_available.
      const check = await app.pool.connect();
      try {
        await check.query('begin');
        await expect(check.query('select id from invites where user_id = $1 for update nowait', [c.userId])).resolves.toBeTruthy();
        await check.query('rollback');
      } finally {
        check.release();
      }

      await trava.query('commit');
      await expect(promessa).resolves.toEqual({ email: c.email });
    } finally {
      trava.release();
    }
  });
});
