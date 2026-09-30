import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';
import { account, tenants, user } from '@/db/schema';
import { closeDb } from '@/db/client';
import { createAuth } from './auth';
import { logger } from './logger';
import { hashPassword } from './password.server';
import { enfileirarLinkDeSenha } from './password-links';

// A fila "fora do ar" (F3) e o espião do tenantId (F2): o resto do caminho é o real.
const fila = vi.hoisted(() => ({ enqueueEmail: vi.fn() }));
vi.mock('@/email/queue', () => ({ enqueueEmail: fila.enqueueEmail, EMAIL_FINALIDADE: 'email-job' }));

const app = makeDb(inject('appDatabaseUrl'));
const auth = createAuth(app.db, { verificarTurnstile: async () => 'ok' });
afterAll(async () => {
  await closeDb();
  await app.pool.end();
});
afterEach(() => {
  fila.enqueueEmail.mockReset();
  vi.restoreAllMocks();
});

const pedir = (email: string, ip: string) =>
  auth.handler(
    new Request('http://localhost:3000/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, redirectTo: '/definir-senha' }),
    }),
  );

async function nutriNoTenant(status: 'ativa' | 'suspensa') {
  const [t] = await app.db.insert(tenants).values({ slug: `pl-${randomUUID().slice(0, 8)}`, nomeExibicao: 'PL', status }).returning();
  const id = randomUUID();
  const email = `pl-${id.slice(0, 8)}@teste.dev`;
  await app.db.insert(user).values({ id, name: 'Nutri', email, emailVerified: true, appRole: 'nutri', tenantId: t.id });
  await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword('Nutri2026segura') });
  return { email, tenantId: t.id };
}

describe('enfileirarLinkDeSenha (F2, F3)', () => {
  const link = { email: 'debby@teste.dev', url: 'https://app/reset/tok-secreto', tenantId: randomUUID() };

  it('tenant suspenso não enfileira nada (RN-15)', async () => {
    const enfileirar = vi.fn();
    await enfileirarLinkDeSenha(link, { enfileirar, tenantAtivo: async () => false });
    expect(enfileirar).not.toHaveBeenCalled();
  });

  it('tenant ativo enfileira com o tenantId; admin (sem tenant) enfileira com null sem consultar status', async () => {
    const enfileirar = vi.fn(async () => 'job');
    const tenantAtivo = vi.fn(async () => true);
    await enfileirarLinkDeSenha(link, { enfileirar, tenantAtivo });
    expect(enfileirar).toHaveBeenCalledWith({ tipo: 'redefinir_senha', para: link.email, link: link.url }, { tenantId: link.tenantId });
    await enfileirarLinkDeSenha({ ...link, tenantId: null }, { enfileirar, tenantAtivo });
    expect(enfileirar).toHaveBeenLastCalledWith(expect.anything(), { tenantId: null });
    expect(tenantAtivo).toHaveBeenCalledTimes(1);
  });

  it('fila fora do ar: não lança e loga só o nome do erro (sem e-mail nem link)', async () => {
    const erro = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const enfileirar = vi.fn(async () => {
      throw new Error(`conexão recusada ao enviar para ${link.email} ${link.url}`);
    });
    await expect(enfileirarLinkDeSenha(link, { enfileirar, tenantAtivo: async () => true })).resolves.toBeUndefined();
    expect(erro).toHaveBeenCalledTimes(1);
    const registrado = JSON.stringify(erro.mock.calls);
    expect(registrado).toContain('"err":"Error"');
    expect(registrado).not.toContain(link.email);
    expect(registrado).not.toContain('tok-secreto');
  });
});

describe('recuperação de senha pelo endpoint (US-002 "mesma resposta")', () => {
  it('fila fora do ar: e-mail cadastrado recebe a mesma resposta 200 que um inexistente (F3)', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    fila.enqueueEmail.mockRejectedValue(new Error('fila fora do ar'));
    const { email } = await nutriNoTenant('ativa');
    const cadastrado = await pedir(email, '10.5.0.1');
    const inexistente = await pedir(`ninguem-${randomUUID().slice(0, 8)}@teste.dev`, '10.5.0.1');
    expect(cadastrado.status).toBe(200);
    expect(inexistente.status).toBe(200);
    expect(await cadastrado.json()).toEqual(await inexistente.json());
    await vi.waitFor(() => expect(fila.enqueueEmail).toHaveBeenCalledTimes(1));
  });

  it('a resposta não espera a fila (enfileiramento fora do caminho da resposta, F3)', async () => {
    let liberar = () => {};
    fila.enqueueEmail.mockImplementation(() => new Promise<string>((ok) => { liberar = () => ok('job'); }));
    const { email } = await nutriNoTenant('ativa');
    const res = await pedir(email, '10.5.0.2'); // resolveria só depois de liberar() se a fila fosse aguardada
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(fila.enqueueEmail).toHaveBeenCalledTimes(1));
    liberar();
  });

  it('o job leva o tenantId da usuária; tenant suspenso não enfileira e responde igual (F2)', async () => {
    fila.enqueueEmail.mockResolvedValue('job');
    const suspensa = await nutriNoTenant('suspensa');
    const ativa = await nutriNoTenant('ativa');
    expect((await pedir(suspensa.email, '10.5.0.3')).status).toBe(200);
    expect((await pedir(ativa.email, '10.5.0.3')).status).toBe(200);
    await vi.waitFor(() => expect(fila.enqueueEmail).toHaveBeenCalledTimes(1));
    await new Promise((ok) => setTimeout(ok, 200)); // folga para um enfileiramento indevido do tenant suspenso aparecer
    expect(fila.enqueueEmail).toHaveBeenCalledTimes(1);
    expect(fila.enqueueEmail).toHaveBeenCalledWith(expect.objectContaining({ para: ativa.email }), { tenantId: ativa.tenantId });
  });
});
