import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_URL: z.url({ message: 'APP_URL deve ser uma URL (ex.: https://app.exemplo.com)' }),
    DATABASE_URL: z.string({ message: 'DATABASE_URL é obrigatória' }).startsWith('postgres'),
    DATABASE_URL_MIGRATOR: z
      .string({ message: 'DATABASE_URL_MIGRATOR é obrigatória' })
      .startsWith('postgres'),
    AUTH_SECRET: z.string({ message: 'AUTH_SECRET é obrigatória' }).min(32, {
      message: 'AUTH_SECRET precisa de pelo menos 32 caracteres',
    }),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .refine(
    (e) => new URL(e.DATABASE_URL).username !== new URL(e.DATABASE_URL_MIGRATOR).username,
    { message: 'DATABASE_URL e DATABASE_URL_MIGRATOR devem usar roles diferentes' },
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
