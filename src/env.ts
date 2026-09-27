import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url({ message: 'APP_URL deve ser uma URL (ex.: https://app.exemplo.com)' }),
    DATABASE_URL: z
      .string({ message: 'DATABASE_URL é obrigatória' })
      .regex(/^postgres(ql)?:\/\//, {
        message: 'DATABASE_URL deve ser uma URL postgres:// válida',
      }),
    DATABASE_URL_MIGRATOR: z
      .string({ message: 'DATABASE_URL_MIGRATOR é obrigatória' })
      .regex(/^postgres(ql)?:\/\//, {
        message: 'DATABASE_URL_MIGRATOR deve ser uma URL postgres:// válida',
      }),
    AUTH_SECRET: z.string({ message: 'AUTH_SECRET é obrigatória' }).min(32, {
      message: 'AUTH_SECRET precisa de pelo menos 32 caracteres',
    }),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
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
  })
  .refine(
    (e) => {
      try {
        return (
          new URL(e.DATABASE_URL).username !== new URL(e.DATABASE_URL_MIGRATOR).username
        );
      } catch {
        return true;
      }
    },
    {
      message: 'DATABASE_URL e DATABASE_URL_MIGRATOR devem usar roles diferentes',
      path: ['DATABASE_URL_MIGRATOR'],
    },
  );

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida — ${msg}`);
  }
  return r.data;
}

let cached: Env | undefined;
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}
