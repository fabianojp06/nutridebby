import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { closeDb } from '@/db/client';
import { account, session, tenants, user, verification } from '@/db/schema';
import { EMAIL_FINALIDADE } from '@/email/queue';
import type { EmailJobData, EmailMessage } from '@/email/types';
import { getBoss, stopBoss } from '@/jobs/boss';
import { logger } from '@/lib/logger';
import { openSecret, sha256 } from './crypto';
import { createAuth, type Auth } from './auth';
import { hashPassword } from './password.server';
import { setPasswordLinkSink } from './password-links';
import type { ResultadoTurnstile } from './turnstile';

const app = makeDb(inject('appDatabaseUrl'));
const auth = createAuth(app.db, { verificarTurnstile: async () => 'ok' });
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

/** F3: o enfileiramento sai do caminho da resposta — espera o job aparecer. */
const linkPara = (destino: string) =>
  vi.waitFor(async () => {
    const links = await linksEnviadosPara(destino);
    expect(links).toHaveLength(1);
    return links[0];
  });

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

  it('login correndo com a suspensão não deixa sessão viva (M8, US-004)', async () => {
    const [t] = await app.db.insert(tenants).values({ slug: `corr-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Corrida' }).returning();
    const id = randomUUID();
    const e = `corr-${id.slice(0, 8)}@teste.dev`;
    await app.db.insert(user).values({ id, name: 'Nutri', email: e, emailVerified: true, appRole: 'nutri', tenantId: t.id });
    await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
    // Mesma ordem de suspenderConta: marca 'suspensa' e revoga as sessões — mas ainda sem COMMIT.
    const suspensao = await app.pool.connect();
    try {
      await suspensao.query('begin');
      await suspensao.query(`update tenants set status = 'suspensa' where id = $1`, [t.id]);
      await suspensao.query(`delete from session where user_id = $1`, [id]);
      // O login lê 'ativa' (a suspensão não foi confirmada) e grava a sessão depois do DELETE acima
      const login = post('/sign-in/email', { email: e, password: senha }, '10.0.0.12');
      await new Promise((ok) => setTimeout(ok, 1000));
      await suspensao.query('commit');
      const res = await login;
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'CONTA_SUSPENSA' });
    } finally {
      suspensao.release();
    }
    expect(await app.db.select({ id: session.id }).from(session).where(eq(session.userId, id))).toEqual([]);
  });

  it('login de nutri lê a usuária uma vez só: o hook `after` não repete o findUserById do `before` (G7)', async () => {
    const [t] = await app.db.insert(tenants).values({ slug: `g7-${randomUUID().slice(0, 8)}`, nomeExibicao: 'G7' }).returning();
    const id = randomUUID();
    const e = `g7-${id.slice(0, 8)}@teste.dev`;
    await app.db.insert(user).values({ id, name: 'Nutri', email: e, emailVerified: true, appRole: 'nutri', tenantId: t.id });
    await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
    const { internalAdapter } = await auth.$context;
    const porId = vi.spyOn(internalAdapter, 'findUserById');
    try {
      const res = await post('/sign-in/email', { email: e, password: senha }, '10.0.0.13');
      expect(res.status).toBe(200);
      expect(porId.mock.calls.filter(([u]) => u === id)).toHaveLength(1);
    } finally {
      porId.mockRestore();
    }
    expect(await app.db.select({ id: session.id }).from(session).where(eq(session.userId, id))).toHaveLength(1);
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
    const link = await linkPara(destino);
    expect(await linksEnviadosPara('ninguem@teste.dev')).toEqual([]);
    const token = new URL(link).pathname.split('/').pop()!;
    const log = saida.join('\n');
    expect(log).toContain('sonda');
    expect(log).not.toContain(token);
    expect(log).not.toContain(link);
    expect(log).not.toContain(destino);
  });

  it('o token de redefinição fica só em hash na tabela verification (item adiado do Plano 01)', async () => {
    const destino = await novaUsuaria('hash');
    await post('/request-password-reset', { email: destino, redirectTo: '/definir-senha' }, '10.0.0.8');
    const link = await linkPara(destino);
    const token = new URL(link).pathname.split('/').pop()!;
    const ids = (await app.db.select({ i: verification.identifier }).from(verification)).map((r) => r.i);
    expect(ids.some((i) => i.includes(token))).toBe(false);
    expect(ids).toContain(sha256(`reset-password:${token}`));
  });

  it('o link do e-mail redefine a senha uma única vez', async () => {
    const destino = await novaUsuaria('uso');
    await post('/request-password-reset', { email: destino, redirectTo: '/definir-senha' }, '10.0.0.9');
    const link = await linkPara(destino);
    const token = new URL(link).pathname.split('/').pop()!;
    expect((await post('/reset-password', { newPassword: 'OutraSenha2026x', token }, '10.0.0.9')).status).toBe(200);
    const segunda = await post('/reset-password', { newPassword: 'MaisOutra2026y', token }, '10.0.0.9');
    expect(segunda.status).toBe(400);
    expect(await segunda.json()).toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('o link de redefinição vale 1 h: nasce com validade de 1 h e, vencido, é recusado (US-002, M3)', async () => {
    let url = '';
    const restore = setPasswordLinkSink((l) => { url = l.url; });
    const antes = Date.now();
    try {
      expect((await post('/request-password-reset', { email, redirectTo: '/definir-senha' }, '10.0.0.11')).status).toBe(200);
    } finally {
      restore();
    }
    const token = new URL(url).pathname.split('/').pop()!;
    const identificador = sha256(`reset-password:${token}`);
    const [v] = await app.db.select({ expiresAt: verification.expiresAt }).from(verification).where(eq(verification.identifier, identificador));
    expect(Math.abs(v.expiresAt.getTime() - (antes + 60 * 60 * 1000))).toBeLessThan(60_000);
    // 1 h e 1 s depois do pedido: o mesmo registro, agora vencido
    await app.db.update(verification).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(verification.identifier, identificador));
    const res = await post('/reset-password', { newPassword: 'OutraSenha2026z', token }, '10.0.0.11');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_TOKEN' });
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

describe('Turnstile na recuperação de senha (INT-06)', () => {
  const pedir = (a: Auth, ip: string, token?: string) =>
    a.handler(
      new Request('http://localhost:3000/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': ip, ...(token ? { 'x-turnstile-token': token } : {}) },
        body: JSON.stringify({ email, redirectTo: '/definir-senha' }),
      }),
    );
  // INT-06 "antes de qualquer escrita": nem link entregue nem linha em verification
  const links: string[] = [];
  let antes = 0;
  let restore = () => {};
  beforeEach(async () => {
    links.length = 0;
    antes = (await app.db.select({ i: verification.id }).from(verification)).length;
    restore = setPasswordLinkSink(({ url }) => { links.push(url); });
  });
  afterEach(() => restore());
  const semEscrita = async (n: number, l: string[]) => {
    expect(l).toHaveLength(0);
    expect(await app.db.select({ i: verification.id }).from(verification)).toHaveLength(n);
  };
  const com = (r: ResultadoTurnstile) => createAuth(app.db, { verificarTurnstile: vi.fn(async () => r) });

  it('token recusado → 403 TURNSTILE_INVALIDO', async () => {
    const res = await pedir(com('invalido'), '10.4.0.1', 'tok');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'TURNSTILE_INVALIDO', message: 'Confirme que você não é um robô.' });
    await semEscrita(antes, links);
  });

  it('sem o cabeçalho x-turnstile-token → verificador chamado com (null, ip) e 403', async () => {
    const verificar = vi.fn<(t: string | null, ip: string | null) => Promise<ResultadoTurnstile>>(async (t) => (t ? 'ok' : 'invalido'));
    const res = await pedir(createAuth(app.db, { verificarTurnstile: verificar }), '10.4.0.4');
    expect(res.status).toBe(403);
    expect(verificar).toHaveBeenCalledWith(null, '10.4.0.4');
    await semEscrita(antes, links);
  });

  it('Turnstile fora do ar → 503 "Tente novamente em alguns minutos", sem seguir', async () => {
    const res = await pedir(com('indisponivel'), '10.4.0.2', 'tok');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'TURNSTILE_INDISPONIVEL', message: 'Tente novamente em alguns minutos' });
    await semEscrita(antes, links);
  });

  it('o verificador recebe o token do cabeçalho e o IP do cliente', async () => {
    const verificar = vi.fn<(t: string | null, ip: string | null) => Promise<ResultadoTurnstile>>(async () => 'ok');
    const res = await pedir(createAuth(app.db, { verificarTurnstile: verificar }), '10.4.0.3', 'tok-123');
    expect(res.status).toBe(200);
    expect(verificar).toHaveBeenCalledWith('tok-123', '10.4.0.3');
  });

  it('chamada interna (auth.api, sem requisição HTTP) não passa pelo Turnstile — admin:criar', async () => {
    await expect(com('invalido').api.requestPasswordReset({ body: { email, redirectTo: '/definir-senha' } })).resolves.toMatchObject({ status: true });
  });
});

describe('logger do Better Auth (RNF-11, CLAUDE.md regra 3)', () => {
  // O logger padrão faz console.error(mensagem, ...args), e o erro do Drizzle que o Better Auth passa como arg carrega
  // o SQL e os `params` (o token da sessão). Só o nível e a mensagem fixa podem sair, e pelo pino.
  it.each(['error', 'warn'] as const)('%s: manda ao pino só a mensagem, sem os args (nem o token dentro deles)', async (nivel) => {
    const token = `tok-${randomUUID()}`;
    const pino = vi.spyOn(logger, nivel).mockImplementation(() => undefined);
    const consoles = [vi.spyOn(console, 'error').mockImplementation(() => undefined), vi.spyOn(console, 'warn').mockImplementation(() => undefined), vi.spyOn(console, 'log').mockImplementation(() => undefined)];
    try {
      const contexto = await createAuth(app.db).$context;
      const falha = Object.assign(new Error(`Failed query: delete from "session" where "token" = $1\nparams: ${token}`), { name: 'DrizzleQueryError', params: [token] });
      contexto.logger[nivel]('Failed to delete session from database', falha, { params: [token] });

      expect(pino.mock.calls).toEqual([['Failed to delete session from database']]);
      for (const c of consoles) expect(JSON.stringify(c.mock.calls)).not.toContain(token);
    } finally {
      pino.mockRestore();
      for (const c of consoles) c.mockRestore();
    }
  });
});

describe('cookie de sessão: a equipe sai ao fechar o navegador; o paciente fica 30 dias (P12-14, RNF-06)', () => {
  /** O `Set-Cookie` de um cookie pelo nome (sem o prefixo `__Secure-` dos testes em http). */
  const setCookie = (res: Response, nome: string) => res.headers.getSetCookie().find((c) => c.startsWith(`${nome}=`));
  async function contaCom(appRole: 'admin' | 'nutri' | 'paciente') {
    const id = randomUUID();
    const e = `${appRole}-ck-${id.slice(0, 8)}@teste.dev`;
    await app.db.insert(user).values({ id, name: 'X', email: e, emailVerified: true, appRole });
    await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
    return e;
  }

  it.each(['nutri', 'admin'] as const)('%s: cookie de sessão sem Max-Age nem Expires, com o dont_remember (mesmo pedindo "lembrar")', async (papel) => {
    const e = await contaCom(papel);
    for (const [i, extra] of [{}, { rememberMe: true }].entries()) {
      const res = await post('/sign-in/email', { email: e, password: senha, ...extra }, `10.6.${papel === 'nutri' ? 1 : 2}.${i}`);
      expect(res.status).toBe(200);
      const sessao = setCookie(res, 'nd.session_token')!;
      expect(sessao).toBeDefined();
      expect(sessao).not.toMatch(/Max-Age|Expires/i);
      expect(setCookie(res, 'nd.dont_remember')).not.toMatch(/Max-Age|Expires/i);
      expect(setCookie(res, 'nd.dont_remember')).toBeDefined();
    }
  });

  it('paciente: o login continua com Max-Age de 30 dias e sem dont_remember', async () => {
    const e = await contaCom('paciente');
    const res = await post('/sign-in/email', { email: e, password: senha }, '10.6.3.1');
    expect(res.status).toBe(200);
    expect(setCookie(res, 'nd.session_token')).toMatch(/Max-Age=2592000/);
    expect(setCookie(res, 'nd.dont_remember')).toBeUndefined();
  });

  it('a sessão da equipe nasce com expiresAt = agora + 30 min, a do paciente com 30 dias', async () => {
    const n = await contaCom('nutri');
    const p = await contaCom('paciente');
    await post('/sign-in/email', { email: n, password: senha }, '10.6.4.1');
    await post('/sign-in/email', { email: p, password: senha }, '10.6.4.2');
    const expira = async (mail: string) => {
      const [s] = await app.db.select({ e: session.expiresAt }).from(session).innerJoin(user, eq(user.id, session.userId)).where(eq(user.email, mail));
      return new Date(s.e).getTime() - Date.now();
    };
    expect(Math.abs((await expira(n)) - 30 * 60_000)).toBeLessThan(60_000);
    expect(Math.abs((await expira(p)) - 30 * 24 * 60 * 60_000)).toBeLessThan(60_000);
  });
});

describe('Plano 26: último acesso da recepção (RN-516, RE-D43)', () => {
  const t = { id: '' };
  beforeAll(async () => {
    const [novo] = await app.db.insert(tenants).values({ slug: `rec-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Recepção' }).returning();
    t.id = novo.id;
  });
  async function conta(appRole: 'nutri' | 'recepcao', twoFactorEnabled = false) {
    const id = randomUUID();
    const e = `${appRole}-ua-${id.slice(0, 8)}@teste.dev`;
    await app.db.insert(user).values({ id, name: 'Conta', email: e, emailVerified: true, appRole, tenantId: t.id, twoFactorEnabled });
    await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
    return { id, e };
  }
  const ultimoAcesso = async (id: string) => (await app.db.select({ u: user.ultimoAcessoEm }).from(user).where(eq(user.id, id)))[0].u;

  it('o login da recepção grava ultimo_acesso_em; o da nutricionista não muda nada', async () => {
    const r = await conta('recepcao');
    const n = await conta('nutri');
    const antes = Date.now();
    expect((await post('/sign-in/email', { email: r.e, password: senha }, '10.7.1.1')).status).toBe(200);
    expect((await post('/sign-in/email', { email: n.e, password: senha }, '10.7.1.2')).status).toBe(200);
    const gravado = await ultimoAcesso(r.id);
    expect(gravado).not.toBeNull();
    expect(Math.abs(new Date(gravado!).getTime() - antes)).toBeLessThan(60_000);
    expect(await ultimoAcesso(n.id)).toBeNull();
  });

  it('com o 2FA ativo, a senha sozinha não conta como acesso (a sessão provisória do desafio é apagada pelo Better Auth)', async () => {
    const r = await conta('recepcao', true);
    const res = await post('/sign-in/email', { email: r.e, password: senha }, '10.7.1.3');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ twoFactorRedirect: true });
    expect(await ultimoAcesso(r.id)).toBeNull();
  });
});
