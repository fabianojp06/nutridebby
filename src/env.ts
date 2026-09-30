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

/** Worker, seed do E2E e qualquer processo que só abre o banco com o role da aplicação. */
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: postgresUrl('DATABASE_URL'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

/** App Next.js e admin:criar (Better Auth). */
const appSchema = serverSchema.extend({
  APP_URL: z.url({ message: 'APP_URL deve ser uma URL (ex.: https://app.exemplo.com)' }),
  AUTH_SECRET: z.string({ message: 'AUTH_SECRET é obrigatória' }).min(32, {
    message: 'AUTH_SECRET precisa de pelo menos 32 caracteres',
  }),
  // CIDRs dos proxies confiáveis (rede do Traefik/Swarm em produção); vazio em dev/test
  TRUSTED_PROXIES: z
    .string()
    .optional()
    .transform((v) =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
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
