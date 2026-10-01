import { isIP } from 'node:net';
import path from 'node:path';
import { z } from 'zod';

/*
 * Cada processo valida só o que usa (RNF-07): a credencial do role dono do schema
 * (DATABASE_URL_MIGRATOR) fica restrita ao script de migrations — app, worker e
 * admin:criar nunca a exigem, e o docker-entrypoint a remove do ambiente deles.
 */

const postgresUrl = (name: string) =>
  z
    .string({ message: `${name} é obrigatória` })
    .regex(/^postgres(ql)?:\/\//, { message: `${name} deve ser uma URL postgres:// válida` });

/**
 * `.env` costuma ter `CHAVE=` em branco para variáveis opcionais sem padrão ainda não
 * configuradas (ex.: RESEND_API_KEY antes do E-05). Só nesses campos "" deve contar
 * como ausente — nunca em campo com `.default(...)` (NODE_ENV, LOG_LEVEL: "" viraria o
 * padrão em silêncio, mascarando configuração inválida) nem em campo obrigatório (deve
 * seguir falhando com a mensagem de negócio certa). Por isso o tratamento é por campo,
 * não global em `parseWith`.
 */
const opcional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema);

/** Worker, seed do E2E e qualquer processo que só abre o banco com o role da aplicação. */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: postgresUrl('DATABASE_URL'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/**
 * 32 bytes em base64 (gere com `openssl rand -base64 32`): chave AES-256 dos segredos guardados na fila.
 * M2: só a forma canônica (44 caracteres, `=` no fim, ida e volta idêntica). O `Buffer.from` aceita
 * espaços, quebras de linha, alfabeto URL e bits de sobra — uma chave colada errado passaria aqui
 * e só falharia ao decifrar.
 */
export const encryptionKeySchema = z
  .string({ message: 'ENCRYPTION_KEY é obrigatória' })
  .refine((v) => /^[A-Za-z0-9+/]{43}=$/.test(v) && Buffer.from(v, 'base64').toString('base64') === v, {
    message: 'ENCRYPTION_KEY deve ter 32 bytes em base64 (gere com: openssl rand -base64 32)',
  });

/**
 * Um IP ou CIDR válido (PF-F6): a versão vem de `isIP` (node:net) — 0 quando o
 * endereço é inválido — e o prefixo, se houver, precisa estar dentro da faixa
 * da família (0–32 para IPv4, 0–128 para IPv6). Recusa `999.1.1.1/99` e `::::`.
 */
function isIpOrCidr(value: string): boolean {
  const slash = value.lastIndexOf('/');
  const address = slash === -1 ? value : value.slice(0, slash);
  const version = isIP(address);
  if (version === 0) return false;
  if (slash === -1) return true;
  const prefix = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const max = version === 4 ? 32 : 128;
  return Number(prefix) <= max;
}

/** Pasta dos arquivos (produção: /data, volume montado no app e no worker); sempre resolvida para absoluta. */
const dataDir = z
  .string({ message: 'DATA_DIR é obrigatória' })
  .min(1, { message: 'DATA_DIR é obrigatória' })
  .transform((p) => path.resolve(p));

/** APP_URL sem query, hash nem barras finais: `urlDoApp` só concatena o caminho (PR #4, item adiado). */
const appUrl = z.url({ message: 'APP_URL deve ser uma URL (ex.: https://app.exemplo.com)' }).transform((v) => {
  const u = new URL(v);
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
});

/** App Next.js e admin:criar (Better Auth). */
const appSchema = serverSchema
  .extend({
    APP_URL: appUrl,
    AUTH_SECRET: z.string({ message: 'AUTH_SECRET é obrigatória' }).min(32, {
      message: 'AUTH_SECRET precisa de pelo menos 32 caracteres',
    }),
    ENCRYPTION_KEY: encryptionKeySchema,
    FILE_URL_SECRET: z.string({ message: 'FILE_URL_SECRET é obrigatória' }).min(32, {
      message: 'FILE_URL_SECRET precisa de pelo menos 32 caracteres',
    }),
    DATA_DIR: dataDir,
    TURNSTILE_SITE_KEY: z.string({ message: 'TURNSTILE_SITE_KEY é obrigatória' }).min(1, { message: 'TURNSTILE_SITE_KEY é obrigatória' }),
    TURNSTILE_SECRET_KEY: z.string({ message: 'TURNSTILE_SECRET_KEY é obrigatória' }).min(1, { message: 'TURNSTILE_SECRET_KEY é obrigatória' }),
    // CIDRs dos proxies confiáveis (rede do Traefik/Swarm em produção); vazio em dev/test
    TRUSTED_PROXIES: opcional(
      z
        .string()
        .optional()
        .transform((v) =>
          (v ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
        .refine((l) => l.every((c) => isIpOrCidr(c)), {
          message: 'TRUSTED_PROXIES deve ser uma lista de IPs/CIDRs separados por vírgula',
        }),
    ),
  })
  .superRefine((e, ctx) => {
    // Chaves de teste da Cloudflare aprovam qualquer token: só em localhost (dev, CI, E2E com `next start`)
    // M18: APP_URL inválida já tem o próprio erro (z.url); aqui não pode virar TypeError cru
    if (e.NODE_ENV === 'production' && URL.canParse(e.APP_URL) && !['localhost', '127.0.0.1'].includes(new URL(e.APP_URL).hostname)) {
      if (/^[123]x00000000/.test(e.TURNSTILE_SITE_KEY)) {
        ctx.addIssue({ code: 'custom', path: ['TURNSTILE_SITE_KEY'], message: 'TURNSTILE_* de teste não pode ser usada em produção' });
      }
      if (/^[123]x0000000000/.test(e.TURNSTILE_SECRET_KEY)) {
        ctx.addIssue({ code: 'custom', path: ['TURNSTILE_SECRET_KEY'], message: 'TURNSTILE_* de teste não pode ser usada em produção' });
      }
    }
    if (e.NODE_ENV === 'production' && e.TRUSTED_PROXIES.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUSTED_PROXIES'],
        message:
          'TRUSTED_PROXIES é obrigatória em produção (CIDR da rede do Traefik/Swarm); sem ela o limite de tentativas vira um balde global',
      });
    }
  });

const EMAIL_FROM = /^([^<>]*<[^@<>\s]+@[^@<>\s]+>|[^@<>\s]+@[^@<>\s]+)$/;

/** Worker: banco com o role da aplicação + o que os jobs usam (e-mail, links, segredos da fila). */
const workerSchema = serverSchema
  .extend({
    APP_URL: appUrl,
    ENCRYPTION_KEY: encryptionKeySchema,
    DATA_DIR: dataDir,
    EMAIL_FROM: z
      .string({ message: 'EMAIL_FROM é obrigatória' })
      .regex(EMAIL_FROM, { message: 'EMAIL_FROM deve ser "Nome <email@dominio>" ou só o e-mail' }),
    EMAIL_TRANSPORT: opcional(z.enum(['resend', 'mailpit']).optional()),
    RESEND_API_KEY: opcional(z.string().min(1).optional()),
    MAILPIT_URL: opcional(z.url({ message: 'MAILPIT_URL deve ser uma URL (ex.: http://localhost:8025)' }).optional()),
  })
  .transform((e) => ({
    ...e,
    // Produção envia pelo Resend; dev e testes pelo Mailpit. O E2E do CI força mailpit.
    EMAIL_TRANSPORT: e.EMAIL_TRANSPORT ?? (e.NODE_ENV === 'production' ? 'resend' : 'mailpit'),
  }))
  .superRefine((e, ctx) => {
    if (e.EMAIL_TRANSPORT === 'resend' && !e.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY é obrigatória para enviar pelo Resend' });
    }
    if (e.EMAIL_TRANSPORT === 'mailpit' && !e.MAILPIT_URL) {
      ctx.addIssue({ code: 'custom', path: ['MAILPIT_URL'], message: 'MAILPIT_URL é obrigatória para enviar pelo Mailpit' });
    }
  });

/** Só scripts/migrate.ts: DATABASE_URL entra para criar/conferir o role de login da aplicação. */
const migratorSchema = z
  .object({
    DATABASE_URL: postgresUrl('DATABASE_URL'),
    DATABASE_URL_MIGRATOR: postgresUrl('DATABASE_URL_MIGRATOR'),
  })
  .refine(
    (e) => {
      try {
        return new URL(e.DATABASE_URL).username !== new URL(e.DATABASE_URL_MIGRATOR).username;
      } catch {
        return true;
      }
    },
    {
      message: 'DATABASE_URL e DATABASE_URL_MIGRATOR devem usar roles diferentes',
      path: ['DATABASE_URL_MIGRATOR'],
    },
  );

export type ServerEnv = z.infer<typeof serverSchema>;
export type Env = z.infer<typeof appSchema>;
export type MigratorEnv = z.infer<typeof migratorSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

type Source = Record<string, string | undefined>;

function parseWith<S extends z.ZodType>(schema: S, source: Source): z.infer<S> {
  const r = schema.safeParse(source);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida — ${msg}`);
  }
  return r.data;
}

export const parseServerEnv = (source: Source): ServerEnv => parseWith(serverSchema, source);
export const parseEnv = (source: Source): Env => parseWith(appSchema, source);
export const parseMigratorEnv = (source: Source): MigratorEnv => parseWith(migratorSchema, source);
export const parseWorkerEnv = (source: Source): WorkerEnv => parseWith(workerSchema, source);

let cachedServer: ServerEnv | undefined;
/** Ambiente mínimo (banco com o role da aplicação): worker, cliente do banco, seed. */
export function getServerEnv(): ServerEnv {
  return (cachedServer ??= parseServerEnv(process.env));
}

let cached: Env | undefined;
/** Ambiente da aplicação (Next.js, Better Auth, admin:criar). */
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}

/** Ambiente das migrations — único consumidor de DATABASE_URL_MIGRATOR. */
export function getMigratorEnv(): MigratorEnv {
  return parseMigratorEnv(process.env);
}

let cachedWorker: WorkerEnv | undefined;
/** Ambiente do worker (falha rápido na subida se faltar algo). */
export function getWorkerEnv(): WorkerEnv {
  return (cachedWorker ??= parseWorkerEnv(process.env));
}
