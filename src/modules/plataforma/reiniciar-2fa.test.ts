import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { adminActions, session, twoFactor, user } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { criarEEntrar, entrar } from '../../../test/sessao';
import { MSG_2FA, Reiniciar2faError, reiniciarDoisFatores, type Codigo2fa } from './reiniciar-2fa';

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

/** Conta com 2FA "ativo" no banco (a linha de two_factor com segredo qualquer: o que importa aqui é ela sumir). */
async function comDoisFatores(appRole: 'admin' | 'nutri') {
  const c = await criarEEntrar(db, auth, { appRole });
  await entrar(auth, c.email); // segunda sessão
  await db.insert(twoFactor).values({ userId: c.id, secret: 'cifrado-qualquer', backupCodes: 'cifrado-qualquer' });
  await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, c.id));
  return c;
}
const avisos = () => vi.fn(async () => 'job');

describe('reiniciarDoisFatores (P09-02 b, manual técnico §6.9.1)', () => {
  it('apaga o two_factor, desliga o 2FA, revoga as sessões, registra em admin_actions e avisa a conta — e o login volta a funcionar sem código', async () => {
    const admin = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const alvo = await comDoisFatores('nutri');
    const avisar = avisos();
    const r = await reiniciarDoisFatores(`  ${alvo.email.toUpperCase()} `, { origem: 'admin', adminId: admin.id }, { db, avisar });
    expect(r).toEqual({ userId: alvo.id, papel: 'nutri', sessoesRevogadas: 2 });
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, alvo.id))).toEqual([]);
    expect((await db.select({ v: user.twoFactorEnabled }).from(user).where(eq(user.id, alvo.id)))[0].v).toBe(false);
    expect(await db.select().from(session).where(eq(session.userId, alvo.id))).toEqual([]);
    const [reg] = await db.select().from(adminActions).where(eq(adminActions.alvoUserId, alvo.id));
    expect(reg).toMatchObject({ adminUserId: admin.id, acao: 'reiniciar_2fa', alvoPapel: 'nutri', origem: 'admin' });
    expect(avisar).toHaveBeenCalledWith({ tipo: 'aviso_2fa_reiniciado', para: alvo.email }, expect.anything());
    await expect(entrar(auth, alvo.email)).resolves.toMatch(/^nd\.session_token=/); // sem twoFactorRedirect
  });

  it('Review Focus 3: conta inexistente, a própria conta, conta sem 2FA e e-mail vazio → erro com a mensagem e nada muda', async () => {
    const admin = await comDoisFatores('admin');
    const sem = await criarEEntrar(db, auth, { appRole: 'nutri' });
    const autor = { origem: 'admin' as const, adminId: admin.id };
    const avisar = avisos();
    const casos: [string, Codigo2fa, string][] = [
      [`ninguem-${randomUUID()}@teste.dev`, 'nao_encontrada', MSG_2FA.naoEncontrada],
      [admin.email, 'propria', MSG_2FA.propria],
      [sem.email, 'sem_2fa', MSG_2FA.semDoisFatores],
      ['   ', 'email', MSG_2FA.email],
    ];
    for (const [email, codigo, mensagem] of casos) {
      const erro = await reiniciarDoisFatores(email, autor, { db, avisar }).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(Reiniciar2faError);
      expect(erro).toMatchObject({ codigo, message: mensagem });
    }
    expect(avisar).not.toHaveBeenCalled();
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, admin.id))).toHaveLength(1);
    expect(await db.select().from(adminActions).where(eq(adminActions.alvoUserId, admin.id))).toEqual([]);
  });

  it('o e-mail não entra na fila → nada muda (mesma transação)', async () => {
    const alvo = await comDoisFatores('nutri');
    const falha = vi.fn(async () => { throw new Error('A fila de e-mail recusou o envio'); });
    await expect(reiniciarDoisFatores(alvo.email, { origem: 'cli', adminId: null }, { db, avisar: falha })).rejects.toThrow('recusou');
    expect(await db.select().from(twoFactor).where(eq(twoFactor.userId, alvo.id))).toHaveLength(1);
    expect(await db.select().from(session).where(eq(session.userId, alvo.id))).toHaveLength(2);
  });

  it('pelo comando no servidor (último admin travado): origem cli, sem admin, e o admin alvo é reiniciado', async () => {
    const alvo = await comDoisFatores('admin');
    const r = await reiniciarDoisFatores(alvo.email, { origem: 'cli', adminId: null }, { db, avisar: avisos() });
    expect(r.papel).toBe('admin');
    const [reg] = await db.select().from(adminActions).where(eq(adminActions.alvoUserId, alvo.id));
    expect(reg).toMatchObject({ adminUserId: null, origem: 'cli' });
  });
});
