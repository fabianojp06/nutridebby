import { randomUUID } from 'node:crypto';
import { TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { criarEEntrar } from '../../test/sessao';
import { createAuth } from './auth';
import { confirmarCodigo2fa, MAX_TENTATIVAS_2FA } from './confirmar-2fa';

const app = makeDb(inject('appDatabaseUrl'));
const auth = createAuth(app.db);
afterAll(() => app.pool.end());

let cookie = '';
let userId = '';
let totp: TOTP;
const headers = () => new Headers({ cookie, origin: 'http://localhost:3000' });
const verificar = (codigo: string, h: Headers) => auth.api.verifyTOTP({ body: { code: codigo }, headers: h }).then(() => true, () => false);

beforeAll(async () => {
  const n = await criarEEntrar(app.db, auth, { appRole: 'nutri' });
  cookie = n.cookie;
  userId = n.id;
  const r = await auth.api.enableTwoFactor({ body: { password: 'Nutri2026segura' }, headers: headers() });
  if (r.method !== 'totp') throw new Error('o 2FA do app é TOTP'); // o tipo de enableTwoFactor também prevê o método 'otp'
  totp = new TOTP({ secret: new URL(r.totpURI).searchParams.get('secret')!, digits: 6, period: 30 });
  // better-auth 1.7.6 (plugins/two-factor/totp): o verifyTOTP que ATIVA o 2FA cria uma sessão nova e apaga a antiga —
  // o cookie de antes morre aqui. Guardar o cookie novo (como src/lib/two-factor.test.ts faz com getSetCookie); sem
  // isso, o 1º caso chamaria o Better Auth com sessão morta e receberia 'invalido' (revisão do rascunho).
  const ativado = await auth.api.verifyTOTP({ body: { code: totp.generate() }, headers: headers(), returnHeaders: true });
  const novos = new Map(cookie.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c] as const));
  for (const c of ativado.headers.getSetCookie()) novos.set(c.split('=')[0], c.split(';')[0]);
  cookie = [...novos.values()].join('; ');
  expect(await auth.api.getSession({ headers: headers() })).not.toBeNull(); // a sessão do cookie guardado está viva
});

describe('confirmarCodigo2fa (RN-145, D13)', () => {
  it('código certo → ok; o MESMO código de novo em seguida → invalido (anti-repetição)', async () => {
    const codigo = totp.generate();
    expect(await confirmarCodigo2fa({ userId, codigo, headers: headers() }, { db: app.db, verificar })).toBe('ok'); // Better Auth de verdade
    expect(await confirmarCodigo2fa({ userId, codigo, headers: headers() }, { db: app.db, verificar })).toBe('invalido');
  });

  it('aceita espaço no meio ("123 456"); recusa formato errado sem chamar o Better Auth', async () => {
    const u = randomUUID();
    let chamou = 0;
    const deps = { db: app.db, verificar: async (c: string) => (chamou++, c === '123456') };
    expect(await confirmarCodigo2fa({ userId: u, codigo: '123 456', headers: headers() }, deps)).toBe('ok');
    expect(await confirmarCodigo2fa({ userId: u, codigo: '12a456', headers: headers() }, deps)).toBe('invalido');
    expect(await confirmarCodigo2fa({ userId: u, codigo: undefined, headers: headers() }, deps)).toBe('invalido');
    expect(chamou).toBe(1);
  });

  it(`${MAX_TENTATIVAS_2FA} erros em 15 min → bloqueado, mesmo com o código certo; o acerto zera o contador`, async () => {
    const u = randomUUID();
    const errado = { db: app.db, verificar: () => Promise.resolve(false) };
    for (let i = 0; i < MAX_TENTATIVAS_2FA; i++) expect(await confirmarCodigo2fa({ userId: u, codigo: '000000', headers: headers() }, errado)).toBe('invalido');
    expect(await confirmarCodigo2fa({ userId: u, codigo: '111111', headers: headers() }, { db: app.db, verificar: () => Promise.resolve(true) })).toBe('bloqueado');
    const depois = new Date(Date.now() + 16 * 60_000);
    expect(await confirmarCodigo2fa({ userId: u, codigo: '222222', headers: headers() }, { db: app.db, agora: depois, verificar: () => Promise.resolve(true) })).toBe('ok');
    expect(await confirmarCodigo2fa({ userId: u, codigo: '000000', headers: headers() }, { ...errado, agora: depois })).toBe('invalido'); // contador zerado no acerto
  });
});
