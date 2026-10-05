import { randomUUID } from 'node:crypto';
import { TOTP } from 'otpauth';
import { APIError } from 'better-auth/api';
import { TWO_FACTOR_ERROR_CODES } from 'better-auth/plugins';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { criarEEntrar } from '../../test/sessao';
import { createAuth } from './auth';
import { confirmarCodigo2fa, liberarCodigo2fa, MAX_TENTATIVAS_2FA } from './confirmar-2fa';

const app = makeDb(inject('appDatabaseUrl'));
const auth = createAuth(app.db);
afterAll(() => app.pool.end());

let cookie = '';
let userId = '';
let totp: TOTP;
const headers = () => new Headers({ cookie, origin: 'http://localhost:3000' });
// Como o padrão (verificarPeloBetterAuth): o erro do Better Auth sobe e quem o classifica é confirmarCodigo2fa.
const verificar = (codigo: string, h: Headers) => auth.api.verifyTOTP({ body: { code: codigo }, headers: h }).then(() => true);

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

  it('I3 do PR #19: liberarCodigo2fa devolve a marca da ação que falhou — o mesmo código passa de novo; sem devolver, não', async () => {
    const u = randomUUID();
    const certo = { db: app.db, verificar: () => Promise.resolve(true) };
    expect(await confirmarCodigo2fa({ userId: u, codigo: '135 790', headers: headers() }, certo)).toBe('ok');
    await liberarCodigo2fa({ userId: u, codigo: '135790' }, { db: app.db }); // a ação falhou (409/507)
    expect(await confirmarCodigo2fa({ userId: u, codigo: '135790', headers: headers() }, certo)).toBe('ok');
    expect(await confirmarCodigo2fa({ userId: u, codigo: '135790', headers: headers() }, certo)).toBe('invalido'); // a ação confirmou: a marca fica
    await liberarCodigo2fa({ userId: randomUUID(), codigo: '135790' }, { db: app.db }); // de outra usuária: não mexe nesta
    expect(await confirmarCodigo2fa({ userId: u, codigo: '135790', headers: headers() }, certo)).toBe('invalido');
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

  it(`${MAX_TENTATIVAS_2FA} erros em 15 min → bloqueado, mesmo com o código certo; passada a janela, volta a aceitar`, async () => {
    const u = randomUUID();
    const errado = { db: app.db, verificar: () => Promise.resolve(false) };
    for (let i = 0; i < MAX_TENTATIVAS_2FA; i++) expect(await confirmarCodigo2fa({ userId: u, codigo: '000000', headers: headers() }, errado)).toBe('invalido');
    expect(await confirmarCodigo2fa({ userId: u, codigo: '111111', headers: headers() }, { db: app.db, verificar: () => Promise.resolve(true) })).toBe('bloqueado');
    const depois = new Date(Date.now() + 16 * 60_000);
    expect(await confirmarCodigo2fa({ userId: u, codigo: '222222', headers: headers() }, { db: app.db, agora: depois, verificar: () => Promise.resolve(true) })).toBe('ok');
  });

  // Revisão da T4: dentro da mesma janela. Sem o zeramento, 4 erros + 1 acerto + 1 erro = 6 tentativas → 'bloqueado'.
  it('o acerto zera o contador na mesma janela', async () => {
    const u = randomUUID();
    const errado = { db: app.db, verificar: () => Promise.resolve(false) };
    for (let i = 0; i < MAX_TENTATIVAS_2FA - 1; i++) expect(await confirmarCodigo2fa({ userId: u, codigo: '000000', headers: headers() }, errado)).toBe('invalido');
    expect(await confirmarCodigo2fa({ userId: u, codigo: '333333', headers: headers() }, { db: app.db, verificar: () => Promise.resolve(true) })).toBe('ok');
    for (let i = 0; i < MAX_TENTATIVAS_2FA; i++) expect(await confirmarCodigo2fa({ userId: u, codigo: '000000', headers: headers() }, errado)).toBe('invalido');
    expect(await confirmarCodigo2fa({ userId: u, codigo: '000000', headers: headers() }, errado)).toBe('bloqueado'); // o 6º depois do acerto
  });

  it('código errado no Better Auth de verdade → invalido', async () => {
    const errado = String((Number(totp.generate()) + 500_000) % 1_000_000).padStart(6, '0'); // longe da janela ±1
    expect(await confirmarCodigo2fa({ userId, codigo: errado, headers: headers() }, { db: app.db, verificar })).toBe('invalido');
  });

  // Revisão da T4: só o "código errado" (UNAUTHORIZED + INVALID_CODE) vira 'invalido'; banco fora, sessão revogada etc.
  // sobem — não viram "código recusado" no Histórico de acessos de quem chama.
  it('erro que não é "código errado" sobe; INVALID_CODE vira invalido', async () => {
    const com = (erro: unknown) => ({ db: app.db, verificar: () => Promise.reject(erro) });
    const e = () => ({ userId: randomUUID(), codigo: '123456', headers: headers() });
    expect(await confirmarCodigo2fa(e(), com(APIError.from('UNAUTHORIZED', TWO_FACTOR_ERROR_CODES.INVALID_CODE)))).toBe('invalido');
    const fora = new Error('connect ECONNREFUSED');
    await expect(confirmarCodigo2fa(e(), com(fora))).rejects.toBe(fora);
    await expect(confirmarCodigo2fa(e(), com(APIError.from('UNAUTHORIZED', TWO_FACTOR_ERROR_CODES.INVALID_TWO_FACTOR_COOKIE)))).rejects.toBeInstanceOf(APIError);
    await expect(confirmarCodigo2fa(e(), com(APIError.from('BAD_REQUEST', TWO_FACTOR_ERROR_CODES.TOTP_NOT_ENABLED)))).rejects.toBeInstanceOf(APIError);
  });

  it('sessão que não existe mais (Better Auth de verdade) → lança, não vira invalido', async () => {
    await expect(
      confirmarCodigo2fa({ userId: randomUUID(), codigo: totp.generate(), headers: new Headers({ origin: 'http://localhost:3000' }) }, { db: app.db, verificar }),
    ).rejects.toBeInstanceOf(APIError);
  });
});
