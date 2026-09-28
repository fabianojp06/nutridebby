import { and, eq, gt } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { getDb, type Db } from '@/db/client';
import * as authSchema from '@/db/schema/auth';
import { getEnv } from '@/env';
import { validatePasswordPolicy } from './password-policy';
import { commonPasswords, hashPassword, verifyPassword } from './password.server';
import { deliverPasswordLink } from './password-links';
import {
  capSessionExpiry,
  isRefreshDue,
  PATIENT_SESSION_MS,
  SESSION_REFRESH_MS,
  sessionExpiresAt,
  type AppRole,
} from './session-rules';

const QUINZE_MIN = 15 * 60;

export function createAuth(
  db: Db,
  opts: { baseURL?: string; secret?: string; trustedProxies?: string[] } = {},
) {
  const baseURL = opts.baseURL ?? getEnv().APP_URL;
  const trustedProxies = opts.trustedProxies ?? getEnv().TRUSTED_PROXIES;
  return betterAuth({
    appName: 'NutriDebby',
    baseURL,
    secret: opts.secret ?? getEnv().AUTH_SECRET,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
      resetPasswordTokenExpiresIn: 60 * 60, // US-002: 1 h, uso único
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await deliverPasswordLink({ email: user.email, url });
      },
    },
    session: {
      // RNF-06: 30 dias é o padrão (paciente); para a equipe os databaseHooks abaixo
      // limitam expiresAt a agora + 12 h a cada criação e renovação da sessão.
      expiresIn: PATIENT_SESSION_MS / 1000,
      updateAge: SESSION_REFRESH_MS / 1000,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (s) => {
            const [u] = await db
              .select({ appRole: authSchema.user.appRole })
              .from(authSchema.user)
              .where(eq(authSchema.user.id, s.userId));
            return { data: { ...s, expiresAt: capSessionExpiry(s.expiresAt, u?.appRole, new Date()) } };
          },
        },
        update: {
          // Renovação do próprio Better Auth (get-session em /api/auth/*): ele grava agora + 30 dias.
          // A sessão em uso está em ctx.context.session (lida por findSession antes do update).
          before: async (data, ctx) => {
            if (!(data.expiresAt instanceof Date)) return;
            const role = (ctx?.context.session?.user as { appRole?: string } | undefined)?.appRole;
            return { data: { ...data, expiresAt: capSessionExpiry(data.expiresAt, role, new Date()) } };
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
        if (ctx.path !== '/reset-password' && ctx.path !== '/change-password') return;
        const pw = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
        const err = typeof pw === 'string' ? validatePasswordPolicy(pw, commonPasswords()) : 'Informe a nova senha.';
        if (err) throw new APIError('BAD_REQUEST', { message: err });
      }),
    },
    plugins: [twoFactor({ issuer: 'NutriDebby' }), nextCookies()],
  });
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
