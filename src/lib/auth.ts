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

const QUINZE_MIN = 15 * 60;

export function createAuth(db: Db, opts: { baseURL?: string; secret?: string } = {}) {
  const baseURL = opts.baseURL ?? getEnv().APP_URL;
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
      expiresIn: 60 * 60 * 24 * 30, // paciente: 30 dias; equipe: 12 h de inatividade em evaluateSession
      updateAge: 60 * 60, // renova updatedAt no máximo 1×/hora com uso
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
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
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
