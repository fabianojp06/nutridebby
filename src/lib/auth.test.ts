import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { closeDb } from '@/db/client';
import { account, tenants, user, verification } from '@/db/schema';
import { EMAIL_FINALIDADE } from '@/email/queue';
import type { EmailJobData, EmailMessage } from '@/email/types';
import { getBoss, stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { openSecret, sha256 } from './crypto';
import { createAuth } from './auth';
import { hashPassword } from './password.server';
import { setPasswordLinkSink } from './password-links';

const app = makeDb(inject('appDatabaseUrl'));
const auth = createAuth(app.db);
const email = `admin-${randomUUID().slice(0, 8)}@teste.dev`;
const senha = 'Nutri2026segura';

const post = (path: string, body: unknown, ip: string, cookie?: string) =>
  auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        origin: 'http://localhost:3000',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }),
  );

/** Cookie de sessão (`nd.session_token=...`) devolvido por um login bem-sucedido. */
const sessionCookie = (res: Response) => res.headers.get('set-cookie')!.match(/nd\.session_token=[^;]+/)![0];

beforeAll(async () => {
  const id = randomUUID();
  await app.db.insert(user).values({ id, name: 'Admin', email, emailVerified: true, appRole: 'admin' });
  await app.db.insert(account).values({
    id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha),
  });
});
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});

/** Usuária própria para cada teste de e-mail (o job é encontrado pelo destinatário). */
async function novaUsuaria(prefixo: string): Promise<string> {
  const id = randomUUID();
  const e = `${prefixo}-${id.slice(0, 8)}@teste.dev`;
  await app.db.insert(user).values({ id, name: 'Nutri', email: e, emailVerified: true, appRole: 'nutri' });
  await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
  return e;
}

async function linksEnviadosPara(destino: string): Promise<string[]> {
  const jobs = await (await getBoss()).findJobs<EmailJobData>('email');
  return jobs
    .map((j) => JSON.parse(openSecret(j.data.selado, EMAIL_FINALIDADE)) as EmailMessage)
    .filter((m): m is Extract<EmailMessage, { tipo: 'redefinir_senha' }> => m.tipo === 'redefinir_senha' && m.para === destino)
    .map((m) => m.link);
}

describe('Better Auth (US-002, RNF-06)', () => {
  it('guarda a senha em argon2id', async () => {
    const [row] = await app.db.select({ p: account.password }).from(account).innerJoin(user, eq(user.id, account.userId)).where(eq(user.email, email));
    expect(row.p).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('login com senha correta devolve sessão', async () => {
    const res = await post('/sign-in/email', { email, password: senha }, '10.0.0.1');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/nd\.session_token=/);
  });

  it('conta suspensa não abre sessão: HTTP 403 com CONTA_SUSPENSA (US-004, RN-15)', async () => {
    const [t] = await app.db.insert(tenants).values({ slug: `bloq-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Bloq', status: 'suspensa' }).returning();
    const id = randomUUID();
    const e = `bloq-${id.slice(0, 8)}@teste.dev`;
    await app.db.insert(user).values({ id, name: 'Nutri', email: e, emailVerified: true, appRole: 'nutri', tenantId: t.id });
    await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
    const res = await post('/sign-in/email', { email: e, password: senha }, '10.0.0.10');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'CONTA_SUSPENSA', message: 'Conta temporariamente indisponível' });
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/nd\.session_token=[^;]+;/);
  });

  it('cadastro público está desativado', async () => {
    const res = await post('/sign-up/email', { email: 'x@y.dev', password: senha, name: 'X' }, '10.0.0.2');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
  });

  it('bloqueia a 6ª tentativa em 15 min no mesmo IP com HTTP 429', async () => {
    const ip = '10.0.0.3';
    for (let i = 0; i < 5; i++) {
      const res = await post('/sign-in/email', { email, password: 'errada-123456' }, ip);
      expect(res.status).toBe(401);
    }
    const sexta = await post('/sign-in/email', { email, password: senha }, ip);
    expect(sexta.status).toBe(429);
  });

  it('com sessão aberta, a 6ª senha errada em 15 min ao ativar 2FA recebe HTTP 429', async () => {
    const ip = '10.0.0.6';
    const cookie = sessionCookie(await post('/sign-in/email', { email, password: senha }, ip));
    for (let i = 0; i < 5; i++) {
      const res = await post('/two-factor/enable', { password: 'errada-123456' }, ip, cookie);
      expect(res.status).toBe(400);
    }
    const sexta = await post('/two-factor/enable', { password: senha }, ip, cookie);
    expect(sexta.status).toBe(429);
  });

  it.each([
    ['/two-factor/get-totp-uri', '10.0.0.8'],
    ['/two-factor/generate-backup-codes', '10.0.0.9'],
  ])('com 2FA configurado, a 6ª senha errada em 15 min em %s recebe HTTP 429', async (path, ip) => {
    // usuário próprio com 2FA ativo, para que o endpoint chegue de fato a conferir a senha
    const id = randomUUID();
    const outro = `nutri-${id.slice(0, 8)}@teste.dev`;
    await app.db.insert(user).values({ id, name: 'Nutri', email: outro, emailVerified: true, appRole: 'nutri' });
    await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
    const cookie = sessionCookie(await post('/sign-in/email', { email: outro, password: senha }, ip));
    expect((await post('/two-factor/enable', { password: senha }, ip, cookie)).status).toBe(200);
    await app.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, id));
    for (let i = 0; i < 5; i++) {
      const res = await post(path, { password: 'errada-123456' }, ip, cookie);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_PASSWORD' });
    }
    const sexta = await post(path, { password: senha }, ip, cookie);
    expect(sexta.status).toBe(429);
  });

  it('recuperação de senha enfileira o e-mail; token e link não vão para o log (P02-01, PF-F4)', async () => {
    const destino = await novaUsuaria('rec');
    const saida: string[] = [];
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { saida.push(args.map(String).join(' ')); }),
    );
    // PF-F4: também captura o que o logger (pino) do app/worker registraria.
    // LOG_LEVEL='error' em teste (test/setup.ts) faria o pino descartar info/debug antes de
    // chegar a qualquer destino — por isso o nível sobe para 'trace' na janela da captura.
    // E, como o destino padrão do pino (sonic-boom) escreve direto no fd, sem passar por
    // `process.stdout.write`, espiar esse método não pega nada: em vez disso, os métodos do
    // logger são substituídos diretamente (mesma técnica do espião do console acima).
    const nivelAnterior = logger.level;
    logger.level = 'trace';
    const espioesLogger = (['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const).map((m) =>
      vi.spyOn(logger, m).mockImplementation((...args: unknown[]) => {
        saida.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }),
    );
    try {
      logger.info('sonda'); // prova que a captura de fato funciona (não é vácua)
      expect((await post('/request-password-reset', { email: destino, redirectTo: '/definir-senha' }, '10.0.0.7')).status).toBe(200);
      expect((await post('/request-password-reset', { email: 'ninguem@teste.dev', redirectTo: '/definir-senha' }, '10.0.0.7')).status).toBe(200);
    } finally {
      espioesLogger.forEach((e) => e.mockRestore());
      logger.level = nivelAnterior;
      espioes.forEach((e) => e.mockRestore());
    }
    const links = await linksEnviadosPara(destino);
    expect(links).toHaveLength(1);
    expect(await linksEnviadosPara('ninguem@teste.dev')).toEqual([]);
    const token = new URL(links[0]).pathname.split('/').pop()!;
    const log = saida.join('\n');
    expect(log).toContain('sonda');
    expect(log).not.toContain(token);
    expect(log).not.toContain(links[0]);
    expect(log).not.toContain(destino);
  });

  it('o token de redefinição fica só em hash na tabela verification (item adiado do Plano 01)', async () => {
    const destino = await novaUsuaria('hash');
    await post('/request-password-reset', { email: destino, redirectTo: '/definir-senha' }, '10.0.0.8');
    const [link] = await linksEnviadosPara(destino);
    const token = new URL(link).pathname.split('/').pop()!;
    const ids = (await app.db.select({ i: verification.identifier }).from(verification)).map((r) => r.i);
    expect(ids.some((i) => i.includes(token))).toBe(false);
    expect(ids).toContain(sha256(`reset-password:${token}`));
  });

  it('o link do e-mail redefine a senha uma única vez', async () => {
    const destino = await novaUsuaria('uso');
    await post('/request-password-reset', { email: destino, redirectTo: '/definir-senha' }, '10.0.0.9');
    const [link] = await linksEnviadosPara(destino);
    const token = new URL(link).pathname.split('/').pop()!;
    expect((await post('/reset-password', { newPassword: 'OutraSenha2026x', token }, '10.0.0.9')).status).toBe(200);
    const segunda = await post('/reset-password', { newPassword: 'MaisOutra2026y', token }, '10.0.0.9');
    expect(segunda.status).toBe(400);
    expect(await segunda.json()).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('recuperação de senha responde igual para e-mail inexistente', async () => {
    const links: string[] = [];
    const restore = setPasswordLinkSink(({ url }) => { links.push(url); });
    try {
      const a = await post('/request-password-reset', { email, redirectTo: '/definir-senha' }, '10.0.0.4');
      const b = await post('/request-password-reset', { email: 'ninguem@teste.dev', redirectTo: '/definir-senha' }, '10.0.0.4');
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(links).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('recusa nova senha fora da política na redefinição', async () => {
    let url = '';
    const restore = setPasswordLinkSink((l) => { url = l.url; });
    await post('/request-password-reset', { email, redirectTo: '/definir-senha' }, '10.0.0.5');
    restore();
    const token = new URL(url).pathname.split('/').pop()!;
    const res = await post('/reset-password', { newPassword: 'curta1', token }, '10.0.0.5');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: 'A senha precisa ter pelo menos 10 caracteres.' });
  });
});
