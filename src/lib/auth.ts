import { and, eq, gt } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { getDb, type Db } from '@/db/client';
import * as authSchema from '@/db/schema/auth';
import { tenants } from '@/db/schema';
import { getEnv } from '@/env';
import { getTenantStatus, statusDe, type TenantStatus } from '@/modules/plataforma/tenant-status';
import { clientIp } from './ip';
import { validatePasswordPolicy } from './password-policy';
import { commonPasswords, hashPassword, verifyPassword } from './password.server';
import { deliverPasswordLink } from './password-links';
import { logger } from './logger';
import { MSG_TURNSTILE_FORA, MSG_TURNSTILE_INVALIDO, verifyTurnstile, type ResultadoTurnstile } from './turnstile';
import {
  capSessionExpiry,
  isRefreshDue,
  PATIENT_SESSION_MS,
  sessionExpiresAt,
  type AppRole,
} from './session-rules';

const QUINZE_MIN = 15 * 60;

/** US-002: o link de redefinição vale 1 h e é de uso único. */
export const RESET_TOKEN_TTL_S = 60 * 60;

export function createAuth(
  db: Db,
  opts: {
    baseURL?: string;
    secret?: string;
    trustedProxies?: string[];
    /** Testes injetam; padrão = siteverify com TURNSTILE_SECRET_KEY. */
    verificarTurnstile?: (token: string | null, ip: string | null) => Promise<ResultadoTurnstile>;
  } = {},
) {
  const baseURL = opts.baseURL ?? getEnv().APP_URL;
  const trustedProxies = opts.trustedProxies ?? getEnv().TRUSTED_PROXIES;
  const verificarTurnstile =
    opts.verificarTurnstile ?? ((token: string | null, ip: string | null) => verifyTurnstile(token, {
        secret: getEnv().TURNSTILE_SECRET_KEY,
        ip,
        // só motivo/status/códigos: nunca token, segredo, IP ou e-mail (CLAUDE.md regra 3)
        onFalha: ({ motivo, status, codigos }) => {
          if (motivo === 'config') logger.error({ motivo, status, codigos }, 'Turnstile indisponível');
          else logger.warn({ motivo, status, codigos }, 'Turnstile indisponível');
        },
      }));
  return betterAuth({
    appName: 'NutriDebby',
    baseURL,
    secret: opts.secret ?? getEnv().AUTH_SECRET,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    // Tokens (redefinição, estado do 2FA) guardados só como SHA-256 em verification.identifier:
    // quem ler o banco não consegue usar um link pendente. Linhas antigas em claro ainda são
    // aceitas pelo Better Auth até expirarem (consumeVerificationValue tenta os dois formatos).
    verification: { storeIdentifier: 'hashed' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_S,
      revokeSessionsOnPasswordReset: true,
      // F2/F3: o tenantId vai junto (RN-15) e a entrega nunca lança nem segura a resposta
      sendResetPassword: async ({ user, url }) => {
        const tenantId = (user as { tenantId?: string | null }).tenantId ?? null;
        await deliverPasswordLink({ email: user.email, url, tenantId });
      },
    },
    session: {
      // RNF-06: 30 dias é o padrão (paciente); para a equipe o hook de criação abaixo
      // grava expiresAt = agora + 12 h.
      expiresIn: PATIENT_SESSION_MS / 1000,
      // O Better Auth nunca desliza a sessão sozinho (nem em /api/auth/*): a renovação é só
      // de requireUser → slideSession, depois de conferir a inatividade. Assim, para a equipe,
      // expiresAt ≤ última atividade avaliada + 12 h, e o Better Auth recusa a sessão ociosa
      // em qualquer rota.
      disableSessionRefresh: true,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (s, ctx) => {
            // Adapter do contexto do endpoint (respeita a transação em curso). Sem contexto ou
            // sem usuário, capSessionExpiry aplica o limite menor (12 h).
            const u = (await ctx?.context.internalAdapter.findUserById(s.userId)) as
              | { appRole?: string; tenantId?: string | null }
              | null
              | undefined;
            // RN-15: conta suspensa não abre sessão nova (login, 2FA, primeiro acesso)
            if (u?.tenantId && (await getTenantStatus(db, u.tenantId)) === 'suspensa') {
              throw new APIError('FORBIDDEN', { code: 'CONTA_SUSPENSA', message: 'Conta temporariamente indisponível' });
            }
            return { data: { ...s, expiresAt: capSessionExpiry(s.expiresAt, u?.appRole, new Date()) } };
          },
          // M8: login correndo com a suspensão. Se o `before` leu 'ativa' enquanto a suspensão
          // ainda não tinha COMMIT, o DELETE das sessões dela não enxerga esta (gravada depois).
          // Aqui, com a sessão já gravada, o FOR SHARE espera a suspensão em curso terminar:
          // suspensa → apaga a sessão e recusa; ainda ativa → uma suspensão que venha depois
          // enxerga esta sessão no próprio DELETE.
          // G7: uma consulta só (usuária → tenant), sem repetir o findUserById do `before`.
          after: async (s) => {
            if ((await statusDoTenantDaUsuaria(db, s.userId)) !== 'suspensa') return;
            await db.delete(authSchema.session).where(eq(authSchema.session.id, s.id));
            throw new APIError('FORBIDDEN', { code: 'CONTA_SUSPENSA', message: 'Conta temporariamente indisponível' });
          },
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: QUINZE_MIN, max: 5 },
        '/two-factor/verify-totp': { window: QUINZE_MIN, max: 5 },
        '/two-factor/verify-backup-code': { window: QUINZE_MIN, max: 5 },
        '/request-password-reset': { window: QUINZE_MIN, max: 5 },
        // endpoints que conferem a senha com a sessão já aberta (cookie roubado não vira força bruta)
        '/two-factor/enable': { window: QUINZE_MIN, max: 5 },
        '/two-factor/disable': { window: QUINZE_MIN, max: 5 },
        '/change-password': { window: QUINZE_MIN, max: 5 },
        '/verify-password': { window: QUINZE_MIN, max: 5 },
        '/two-factor/get-totp-uri': { window: QUINZE_MIN, max: 5 },
        '/two-factor/generate-backup-codes': { window: QUINZE_MIN, max: 5 },
        '/delete-user': { window: QUINZE_MIN, max: 5 }, // desligado hoje; confere senha se for ligado
      },
    },
    user: {
      additionalFields: {
        appRole: { type: 'string', required: true, input: false },
        tenantId: { type: 'string', required: false, input: false },
      },
    },
    advanced: {
      cookiePrefix: 'nd',
      database: { generateId: 'uuid' },
      ipAddress: { trustedProxies },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // INT-06: "Esqueci minha senha" pela web exige Turnstile válido antes de qualquer escrita.
        // Sem ctx.request = chamada interna (auth.api.*, ex.: admin:criar pelo terminal).
        if (ctx.path === '/request-password-reset') {
          if (!ctx.request) return;
          const r = await verificarTurnstile(ctx.request.headers.get('x-turnstile-token'), clientIp(ctx.request.headers, trustedProxies));
          if (r === 'indisponivel') throw new APIError('SERVICE_UNAVAILABLE', { code: 'TURNSTILE_INDISPONIVEL', message: MSG_TURNSTILE_FORA });
          if (r !== 'ok') throw new APIError('FORBIDDEN', { code: 'TURNSTILE_INVALIDO', message: MSG_TURNSTILE_INVALIDO });
          return;
        }
        if (ctx.path !== '/reset-password' && ctx.path !== '/change-password') return;
        const pw = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
        const err = typeof pw === 'string' ? validatePasswordPolicy(pw, commonPasswords()) : 'Informe a nova senha.';
        if (err) throw new APIError('BAD_REQUEST', { message: err });
      }),
    },
    plugins: [twoFactor({ issuer: 'NutriDebby' }), nextCookies()],
  });
}

/**
 * M8/G7: status do tenant da usuária numa consulta só (`user` → `tenants`), com `FOR SHARE` só na
 * linha de `tenants`: espera a suspensão em curso (UPDATE sem COMMIT) e devolve o status já
 * confirmado. `null` para quem não tem tenant (admin). Roda no hook `after`, que o Better Auth
 * chama depois da transação do endpoint — a linha da usuária já existia antes do login.
 */
async function statusDoTenantDaUsuaria(db: Db, userId: string): Promise<TenantStatus | null> {
  const [row] = await db
    .select({ status: tenants.status })
    .from(authSchema.user)
    .innerJoin(tenants, eq(tenants.id, authSchema.user.tenantId))
    .where(eq(authSchema.user.id, userId))
    .for('share', { of: tenants });
  return statusDe(row);
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;
export function getAuth(): Auth {
  return (instance ??= createAuth(getDb()));
}

/**
 * Desliza a sessão ativa (updatedAt = agora, expiresAt pelo papel) se já passou a cadência.
 * Usado por requireUser, que lê a sessão com disableRefresh: grava direto no banco porque
 * em Server Components (inclusive navegação RSC) o cookie não pode ser reescrito — e nem
 * precisa, pois ele só carrega o token. Nunca ressuscita sessão já expirada.
 */
export async function slideSession(
  db: Db,
  session: { id: string; updatedAt: Date },
  role: AppRole,
  now: Date = new Date(),
): Promise<void> {
  if (!isRefreshDue(session.updatedAt, now)) return;
  await db
    .update(authSchema.session)
    .set({ expiresAt: sessionExpiresAt(role, now), updatedAt: now })
    .where(and(eq(authSchema.session.id, session.id), gt(authSchema.session.expiresAt, now)));
}
