import { and, eq, gt } from 'drizzle-orm';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { getDb, type Db } from '@/db/client';
import * as authSchema from '@/db/schema/auth';
import { tenants } from '@/db/schema';
import { getEnv } from '@/env';
import { lerMembroDaEquipe } from '@/modules/plataforma/membro-da-equipe';
import { getTenantStatus, statusDe, type TenantStatus } from '@/modules/plataforma/tenant-status';
import { clientIp } from './ip';
import { validatePasswordPolicy } from './password-policy';
import { commonPasswords, hashPassword, verifyPassword } from './password.server';
import { deliverPasswordLink } from './password-links';
import { logger, nomeDoErro } from './logger';
import { MSG_TURNSTILE_FORA, MSG_TURNSTILE_INVALIDO, verifyTurnstile, type ResultadoTurnstile } from './turnstile';
import { registrarFalhaTurnstile } from './turnstile-log';
import {
  capSessionExpiry,
  isRefreshDue,
  PATIENT_SESSION_MS,
  PRAZOS_DA_EQUIPE,
  sessionExpiresAt,
  type AppRole,
  type PrazosDaEquipe,
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
        hostname: new URL(baseURL).hostname,
        onFalha: registrarFalhaTurnstile,
      }));
  return betterAuth({
    appName: 'NutriDebby',
    baseURL,
    secret: opts.secret ?? getEnv().AUTH_SECRET,
    trustedOrigins: [baseURL],
    // RNF-11 / CLAUDE.md regra 3: o logger padrão faz console.error(mensagem, ...args), e o erro do Drizzle que o Better
    // Auth passa como arg carrega o SQL e os `params` (o token da sessão, a senha). Só o nível e a mensagem fixa saem,
    // pelo pino; os args ficam de fora.
    logger: { log: (nivel, mensagem) => logger[nivel](mensagem) },
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
      // grava expiresAt = agora + 30 min (sem passar de 8 h do login, P12-14).
      expiresIn: PATIENT_SESSION_MS / 1000,
      // O Better Auth nunca desliza a sessão sozinho (nem em /api/auth/*): a renovação é só
      // de requireUser → slideSession, depois de conferir a inatividade. Assim, para a equipe,
      // expiresAt ≤ última atividade avaliada + 30 min (e ≤ createdAt + 8 h), e o Better Auth recusa
      // a sessão ociosa ou vencida em qualquer rota.
      disableSessionRefresh: true,
    },
    databaseHooks: {
      session: {
        create: {
          before: async (s, ctx) => {
            // Adapter do contexto do endpoint (respeita a transação em curso). Sem contexto ou
            // sem usuário, capSessionExpiry aplica o limite menor (30 min).
            const u = (await ctx?.context.internalAdapter.findUserById(s.userId)) as
              | { appRole?: string; tenantId?: string | null }
              | null
              | undefined;
            // RN-15: conta suspensa não abre sessão nova (login, 2FA, primeiro acesso)
            if (u?.tenantId && (await getTenantStatus(db, u.tenantId)) === 'suspensa') {
              throw new APIError('FORBIDDEN', { code: 'CONTA_SUSPENSA', message: 'Conta temporariamente indisponível' });
            }
            // P12-14: a sessão que SUBSTITUI a atual da mesma usuária (ativar ou desligar o 2FA, troca de senha com
            // revogação) herda o createdAt dela — o limite de 8 h conta do login, não da troca
            const atual = ctx?.context.session;
            const createdAt =
              atual && atual.user.id === s.userId && new Date(atual.session.createdAt) < s.createdAt ? new Date(atual.session.createdAt) : s.createdAt;
            return { data: { ...s, createdAt, expiresAt: capSessionExpiry(s.expiresAt, u?.appRole, new Date(), createdAt) } };
          },
          // M8: login correndo com a suspensão. Se o `before` leu 'ativa' enquanto a suspensão
          // ainda não tinha COMMIT, o DELETE das sessões dela não enxerga esta (gravada depois).
          // Aqui, com a sessão já gravada, o FOR SHARE espera a suspensão em curso terminar:
          // suspensa → apaga a sessão e recusa; ainda ativa → uma suspensão que venha depois
          // enxerga esta sessão no próprio DELETE.
          // G7: uma consulta só (usuária → tenant), sem repetir o findUserById do `before`.
          after: async (s, ctx) => {
            const u = await statusDoTenantDaUsuaria(db, s.userId);
            if (u?.status === 'suspensa') {
              await db.delete(authSchema.session).where(eq(authSchema.session.id, s.id));
              throw new APIError('FORBIDDEN', { code: 'CONTA_SUSPENSA', message: 'Conta temporariamente indisponível' });
            }
            // Plano 26 (RN-516, RE-D43): o "Último acesso" da tela Equipe. A sessão some no logout, na expiração e na
            // desativação; por isso a data fica na conta. Só o acesso que abre o painel conta: com o 2FA ativo (sem ele,
            // a conta só configura o 2FA — primeiro acesso ou depois do reinício) e a linha ativa em equipe_membros (a
            // desativada não entra). A sessão da senha com o 2FA ativo é provisória (o plugin do 2FA a apaga e pede o
            // código): o acesso conta no verify-totp, não aqui.
            if (u?.appRole === 'recepcao' && u.tenantId && u.twoFactorEnabled && ctx?.path !== '/sign-in/email') {
              try {
                if ((await lerMembroDaEquipe(db, u.tenantId, s.userId))?.ativo)
                  await db.update(authSchema.user).set({ ultimoAcessoEm: new Date() }).where(eq(authSchema.user.id, s.userId));
              } catch (err) {
                // a data é só informativa: falhar aqui não pode derrubar o login. Só o nome do erro e o id (regra 3)
                logger.warn({ erro: nomeDoErro(err), userId: s.userId }, 'falha ao gravar o último acesso');
              }
            }
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
        // D17: tema do painel na sessão; com input: false, o /api/auth/update-user não grava o campo (só preferencias.ts)
        tema: { type: 'string', required: false, input: false, defaultValue: 'sistema' },
      },
    },
    advanced: {
      cookiePrefix: 'nd',
      database: { generateId: 'uuid' },
      ipAddress: { trustedProxies },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // P12-14 (RNF-06): o login da equipe vale só até fechar o navegador — cookie de sessão sem Max-Age/Expires e o
        // `dont_remember` do Better Auth, que o 2FA (verify-totp/backup-code), a ativação do 2FA e a troca de senha
        // respeitam ao regravar o cookie. Decidido aqui pelo papel guardado, nunca pelo que o navegador manda; o paciente
        // (30 dias, PWA) segue com o padrão. E-mail desconhecido também vai sem "lembrar" (o login falha de qualquer jeito).
        if (ctx.path === '/sign-in/email') {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          const encontrado = typeof email === 'string' ? await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase()) : null;
          if ((encontrado?.user as { appRole?: string } | undefined)?.appRole === 'paciente') return;
          return { context: { body: { ...(ctx.body as Record<string, unknown>), rememberMe: false } } };
        }
        // INT-06: "Esqueci minha senha" pela web exige Turnstile válido antes de qualquer escrita.
        // Sem ctx.request = chamada interna (auth.api.*, ex.: admin:criar pelo terminal).
        if (ctx.path === '/request-password-reset') {
          if (!ctx.request) return;
          const r = await verificarTurnstile(ctx.request.headers.get('x-turnstile-token'), clientIp(ctx.request.headers, trustedProxies));
          if (r === 'indisponivel') throw new APIError('SERVICE_UNAVAILABLE', { code: 'TURNSTILE_INDISPONIVEL', message: MSG_TURNSTILE_FORA });
          if (r !== 'ok') throw new APIError('FORBIDDEN', { code: 'TURNSTILE_INVALIDO', message: MSG_TURNSTILE_INVALIDO });
          return;
        }
        // RN-145 / D13 (Plano 10A, revisão da T4): com sessão aberta e 2FA já ativo, o verify-totp pela web só confere o
        // código — better-auth 1.7.6 não conta falhas fora do login, e o rate limit HTTP é por IP+caminho. Seria um
        // oráculo do código fora do limite por usuária de confirmarCodigo2fa (cookie roubado + vários IPs). Seguem: o
        // login (sem sessão, com o bloqueio do Better Auth), a ativação (sessão com 2FA ainda desligado) e a chamada
        // interna (auth.api.verifyTOTP, sem ctx.request) que confirmarCodigo2fa faz.
        if (ctx.path === '/two-factor/verify-totp') {
          if (!ctx.request) return;
          const sessao = await getSessionFromCtx(ctx);
          if ((sessao?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled === true) {
            throw new APIError('FORBIDDEN', { code: 'TWO_FACTOR_JA_ATIVO', message: 'A verificação em duas etapas já está ativa.' });
          }
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
 * Plano 26 (RN-516): na mesma consulta, o papel e o 2FA (o último acesso da recepção).
 */
async function statusDoTenantDaUsuaria(
  db: Db,
  userId: string,
): Promise<{ status: TenantStatus | null; appRole: string; tenantId: string; twoFactorEnabled: boolean } | null> {
  const [row] = await db
    .select({ status: tenants.status, appRole: authSchema.user.appRole, tenantId: tenants.id, twoFactorEnabled: authSchema.user.twoFactorEnabled })
    .from(authSchema.user)
    .innerJoin(tenants, eq(tenants.id, authSchema.user.tenantId))
    .where(eq(authSchema.user.id, userId))
    .for('share', { of: tenants });
  return row ? { status: statusDe(row), appRole: row.appRole, tenantId: row.tenantId, twoFactorEnabled: row.twoFactorEnabled === true } : null;
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;
export function getAuth(): Auth {
  return (instance ??= createAuth(getDb()));
}

/**
 * Desliza a sessão ativa (updatedAt = agora, expiresAt pelo papel; na equipe, sem passar de createdAt + 8 h) se já passou
 * a cadência (5 min na equipe, 15 no paciente). Usado por requireUser e requireApiUser, que leem a sessão com
 * disableRefresh: grava direto no banco porque em Server Components (inclusive navegação RSC) o cookie não pode ser
 * reescrito — e nem precisa, pois ele só carrega o token. Nunca ressuscita sessão já expirada. Devolve os valores
 * gravados, ou `null` quando nada mudou.
 */
export async function slideSession(
  db: Db,
  session: { id: string; updatedAt: Date; createdAt: Date },
  role: AppRole,
  now: Date = new Date(),
  prazos: PrazosDaEquipe = PRAZOS_DA_EQUIPE,
): Promise<{ updatedAt: Date; expiresAt: Date } | null> {
  if (!isRefreshDue(session.updatedAt, now, role, prazos)) return null;
  const expiresAt = sessionExpiresAt(role, now, { createdAt: session.createdAt, prazos });
  const gravadas = await db
    .update(authSchema.session)
    .set({ expiresAt, updatedAt: now })
    .where(and(eq(authSchema.session.id, session.id), gt(authSchema.session.expiresAt, now)))
    .returning({ id: authSchema.session.id });
  return gravadas.length > 0 ? { updatedAt: now, expiresAt } : null;
}
