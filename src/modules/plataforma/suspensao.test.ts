import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { session, tenants, user } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { criarEEntrar, entrar } from '../../../test/sessao';
import { reativarConta, suspenderConta } from './suspensao';
import { ContaNaoEncontradaError } from './tenant-status';

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss(); // suspender e reativar enfileiram o job da agenda (P05-06)
  await closeDb();
});

async function contaComNutri() {
  const [t] = await db.insert(tenants).values({ slug: `sus-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Sus' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  return { t, n };
}

describe('suspenderConta / reativarConta (US-004)', () => {
  it('suspende sem apagar dados e revoga na hora só as sessões daquele tenant', async () => {
    const a = await contaComNutri();
    const b = await contaComNutri();
    const r = await suspenderConta(a.t.id, randomUUID());
    expect(r.sessoesRevogadas).toBe(1);
    expect((await db.select().from(tenants).where(eq(tenants.id, a.t.id)))[0].status).toBe('suspensa');
    expect(await db.select().from(session).where(eq(session.userId, a.n.id))).toEqual([]);
    expect(await db.select().from(session).where(eq(session.userId, b.n.id))).toHaveLength(1);
    expect(await db.select().from(user).where(eq(user.id, a.n.id))).toHaveLength(1); // dados intactos
    expect(await auth.api.getSession({ headers: new Headers({ cookie: a.n.cookie }) })).toBeNull();
  });

  it('com a conta suspensa o login é recusado; reativada, volta ao normal', async () => {
    const { t, n } = await contaComNutri();
    await suspenderConta(t.id, randomUUID());
    await expect(entrar(auth, n.email)).rejects.toMatchObject({ status: 403 });
    await reativarConta(t.id, randomUUID());
    await expect(entrar(auth, n.email)).resolves.toMatch(/^nd\.session_token=/);
  });

  it('conta inexistente é erro', async () => {
    // M9: erro próprio (a action mostra "Conta não encontrada." em vez da página de erro)
    await expect(suspenderConta(randomUUID(), randomUUID())).rejects.toBeInstanceOf(ContaNaoEncontradaError);
    await expect(reativarConta(randomUUID(), randomUUID())).rejects.toThrow('Conta não encontrada.');
  });
});
