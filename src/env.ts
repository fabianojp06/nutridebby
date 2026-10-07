import { createECDH } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { z } from 'zod';
import { GEOS_IA, MODELOS_IA } from '@/modules/ia/constantes';

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
  // P08-01 (D1): app e worker. Sem DSN, o Sentry fica desligado (como o WhatsApp). Só https.
  SENTRY_DSN: opcional(z.url({ message: 'SENTRY_DSN deve ser uma URL' }).refine((v) => v.startsWith('https://'), { message: 'SENTRY_DSN deve começar com https://' }).optional()),
  SENTRY_ENVIRONMENT: opcional(z.string().regex(/^[a-z0-9-]{1,30}$/, { message: 'SENTRY_ENVIRONMENT: letras minúsculas, números e hífen' }).optional()),
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

/** D1: WhatsApp pela Evolution API — opcional; sem as variáveis, o WhatsApp fica desligado (lembretes por e-mail e push). */
const evolutionUrl = opcional(z.url({ message: 'EVOLUTION_API_URL deve ser uma URL (ex.: http://nutri_evolution:8080)' }).optional());
const evolutionKey = opcional(z.string().min(16, { message: 'EVOLUTION_API_KEY precisa de pelo menos 16 caracteres' }).optional());
const whatsappSandbox = opcional(z.enum(['0', '1'], { message: 'WHATSAPP_SANDBOX deve ser 0 ou 1' }).optional());
/** Plano 11 (spec §12): ausente = IA desligada; fake/sandbox só fora de produção (RNF-107). App e worker. */
const iaProvedor = opcional(z.enum(['anthropic', 'sandbox', 'fake'], { message: 'IA_PROVEDOR deve ser anthropic, sandbox ou fake' }).optional());
const iaDesligada = opcional(z.enum(['0', '1'], { message: 'IA_DESLIGADA deve ser 0 ou 1' }).optional());
const iaModelo = opcional(z.enum(MODELOS_IA, { message: `IA_MODELO_LEITURA deve ser um destes: ${MODELOS_IA.join(', ')}` }).default('claude-opus-5-5'));
const iaGeo = opcional(z.enum(GEOS_IA, { message: 'IA_INFERENCE_GEO deve ser us ou global' }).default('us'));
const iaTeto = opcional(
  z.coerce.number({ message: 'IA_TETO_GLOBAL_MENSAL_USD deve ser um número' }).min(0, { message: 'IA_TETO_GLOBAL_MENSAL_USD deve ser de 0 a 10000' }).max(10_000, { message: 'IA_TETO_GLOBAL_MENSAL_USD deve ser de 0 a 10000' }).default(50),
);
/** A conferência da IA em produção, igual no app e no worker. A mensagem nunca repete valor. */
function conferirIaEmProducao(e: { NODE_ENV: string; APP_URL: string; IA_PROVEDOR?: string; IA_INFERENCE_GEO: string }, ctx: z.RefinementCtx): void {
  if (!emProducao(e)) return;
  if (e.IA_PROVEDOR === 'fake' || e.IA_PROVEDOR === 'sandbox') ctx.addIssue({ code: 'custom', path: ['IA_PROVEDOR'], message: 'IA_PROVEDOR sandbox ou fake só fora de produção' });
  if (e.IA_INFERENCE_GEO !== 'us') ctx.addIssue({ code: 'custom', path: ['IA_INFERENCE_GEO'], message: 'IA_INFERENCE_GEO deve ser us em produção (A-D5)' });
}
const ehLocal = (appUrl: string) => URL.canParse(appUrl) && ['localhost', '127.0.0.1'].includes(new URL(appUrl).hostname);
/**
 * Produção de verdade: NODE_ENV=production fora de localhost (o E2E com `next start` roda como produção em localhost).
 * M18: APP_URL inválida já tem o próprio erro (z.url); aqui não pode virar TypeError cru.
 */
export const emProducao = (e: { NODE_ENV: string; APP_URL: string }) => e.NODE_ENV === 'production' && URL.canParse(e.APP_URL) && !ehLocal(e.APP_URL);
/**
 * O valor que o `.env.example` traz para o dev com WHATSAPP_SANDBOX=1: é público, então é recusado em produção (como as
 * chaves de teste do Turnstile) — senão o `jwt_key` de toda instância sairia de um texto conhecido (D4 a).
 */
export const EVOLUTION_WEBHOOK_SECRET_EXEMPLO = 'dev-webhook-secret-com-pelo-menos-32-caracteres';
/**
 * D4 (c): endereço da rede interna do Docker/Easypanel — nome de serviço (sem ponto) ou IPv4 privado. O IPv4 é
 * conferido como IP (um nome como `10.exemplo.com` não passa) e o nome só com letras, dígitos, `_` e `-` (um IPv6
 * literal, que também não tem ponto, não passa).
 */
const ehHostInterno = (url: string) => {
  if (!URL.canParse(url)) return false;
  const h = new URL(url).hostname;
  return /^[a-z0-9_-]+$/i.test(h) || (isIP(h) === 4 && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h));
};

/** INT-03 (D19): chaves do VAPID em base64url sem `=` — pública P-256 não comprimida (65 bytes) e privada (32 bytes). */
const VAPID_PUBLICA = /^[A-Za-z0-9_-]{87}$/;
const VAPID_PRIVADA = /^[A-Za-z0-9_-]{43}$/;

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
    EVOLUTION_API_URL: evolutionUrl,
    EVOLUTION_API_KEY: evolutionKey,
    EVOLUTION_WEBHOOK_SECRET: opcional(z.string().min(32, { message: 'EVOLUTION_WEBHOOK_SECRET precisa de pelo menos 32 caracteres' }).optional()),
    EVOLUTION_WEBHOOK_URL: opcional(z.url({ message: 'EVOLUTION_WEBHOOK_URL deve ser uma URL' }).optional()),
    EVOLUTION_WEBHOOK_URL_PUBLICA: opcional(z.enum(['0', '1'], { message: 'EVOLUTION_WEBHOOK_URL_PUBLICA deve ser 0 ou 1' }).optional()),
    WHATSAPP_SANDBOX: whatsappSandbox,
    // D7 (Plano 06): a chave PÚBLICA do VAPID vai para o navegador (inscrição de push). A privada fica só no worker.
    VAPID_PUBLIC_KEY: opcional(z.string().regex(VAPID_PUBLICA, { message: 'VAPID_PUBLIC_KEY deve ser a chave pública em base64url (87 caracteres)' }).optional()),
    // P08-05 (D7): vazio = CSP valendo; "relatorio" = só Report-Only (emergência). O proxy lê process.env direto.
    CSP_MODO: opcional(z.enum(['valendo', 'relatorio'], { message: 'CSP_MODO deve ser valendo ou relatorio' }).optional()),
    IA_PROVEDOR: iaProvedor, IA_DESLIGADA: iaDesligada, IA_MODELO_LEITURA: iaModelo, IA_INFERENCE_GEO: iaGeo, IA_TETO_GLOBAL_MENSAL_USD: iaTeto,
    // P12-14: só teste — encurta os prazos da sessão da equipe (inatividade em ms) para quem traz o cookie nd_sessao_teste
    // (E2E do aviso de inatividade). Recusada em produção (abaixo), como o IA_PROVEDOR sandbox/fake.
    SESSAO_TESTE_MS: opcional(
      z.coerce
        .number({ message: 'SESSAO_TESTE_MS deve ser um número (ms)' })
        .int({ message: 'SESSAO_TESTE_MS deve ser um número inteiro (ms)' })
        .min(6_000, { message: 'SESSAO_TESTE_MS deve ser de 6000 a 1800000 ms' })
        .max(1_800_000, { message: 'SESSAO_TESTE_MS deve ser de 6000 a 1800000 ms' })
        .optional(),
    ),
  })
  .superRefine((e, ctx) => {
    conferirIaEmProducao(e, ctx);
    if (e.SESSAO_TESTE_MS !== undefined && emProducao(e)) {
      ctx.addIssue({ code: 'custom', path: ['SESSAO_TESTE_MS'], message: 'SESSAO_TESTE_MS só fora de produção (encurta a sessão; é só do E2E)' });
    }
    // Chaves de teste da Cloudflare aprovam qualquer token: só em localhost (dev, CI, E2E com `next start`)
    if (emProducao(e)) {
      if (/^[123]x00000000/.test(e.TURNSTILE_SITE_KEY)) {
        ctx.addIssue({ code: 'custom', path: ['TURNSTILE_SITE_KEY'], message: 'TURNSTILE_* de teste não pode ser usada em produção' });
      }
      if (/^[123]x0000000000/.test(e.TURNSTILE_SECRET_KEY)) {
        ctx.addIssue({ code: 'custom', path: ['TURNSTILE_SECRET_KEY'], message: 'TURNSTILE_* de teste não pode ser usada em produção' });
      }
      // D4 (a): o segredo do .env.example é público (a mensagem não repete o valor)
      if (e.EVOLUTION_WEBHOOK_SECRET === EVOLUTION_WEBHOOK_SECRET_EXEMPLO) {
        ctx.addIssue({ code: 'custom', path: ['EVOLUTION_WEBHOOK_SECRET'], message: 'EVOLUTION_WEBHOOK_SECRET de exemplo não pode ser usada em produção (gere com: openssl rand -base64 48)' });
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
    const evo = [e.EVOLUTION_API_URL, e.EVOLUTION_API_KEY, e.EVOLUTION_WEBHOOK_SECRET];
    // rodada 1: o sandbox (dev/CI/E2E) usa só o segredo (o E2E assina os webhooks) — sem URL e chave não é configuração pela metade
    const soSandbox = e.WHATSAPP_SANDBOX === '1' && !e.EVOLUTION_API_URL && !e.EVOLUTION_API_KEY;
    if (evo.some(Boolean) && !evo.every(Boolean) && !soSandbox) {
      ctx.addIssue({ code: 'custom', path: ['EVOLUTION_API_URL'], message: 'Configure EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_WEBHOOK_SECRET juntas (ou nenhuma)' });
    }
    // D4 (c): em produção, a Evolution chama o app pela rede interna; a URL pública só como opção explícita
    if (emProducao(e) && e.EVOLUTION_API_URL) {
      if (!e.EVOLUTION_WEBHOOK_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['EVOLUTION_WEBHOOK_URL'],
          message: 'EVOLUTION_WEBHOOK_URL é obrigatória em produção (endereço interno do app, ex.: http://nutridebby_app:3000/api/webhooks/whatsapp)',
        });
      } else if (!ehHostInterno(e.EVOLUTION_WEBHOOK_URL) && e.EVOLUTION_WEBHOOK_URL_PUBLICA !== '1') {
        ctx.addIssue({
          code: 'custom',
          path: ['EVOLUTION_WEBHOOK_URL'],
          message: 'EVOLUTION_WEBHOOK_URL precisa ser um endereço interno (nome do serviço ou IP privado); URL pública só com EVOLUTION_WEBHOOK_URL_PUBLICA=1',
        });
      }
    }
    if (e.WHATSAPP_SANDBOX === '1') {
      if (emProducao(e)) ctx.addIssue({ code: 'custom', path: ['WHATSAPP_SANDBOX'], message: 'WHATSAPP_SANDBOX só fora de produção' });
      if (!e.EVOLUTION_WEBHOOK_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['EVOLUTION_WEBHOOK_SECRET'], message: 'EVOLUTION_WEBHOOK_SECRET é obrigatória com WHATSAPP_SANDBOX=1 (o E2E assina os webhooks)' });
      }
    }
  });

const EMAIL_FROM = /^([^<>]*<[^@<>\s]+@[^@<>\s]+>|[^@<>\s]+@[^@<>\s]+)$/;

/**
 * A privada gera a pública? Uma das duas trocada (colada errado, rotação pela metade) faria todo push voltar 403 do
 * serviço de push, em silêncio: o worker não sobe. Nunca lança nem devolve as chaves.
 */
function vapidDoMesmoPar(publica: string, privada: string): boolean {
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(Buffer.from(privada, 'base64url'));
    return ecdh.getPublicKey().equals(Buffer.from(publica, 'base64url'));
  } catch {
    return false;
  }
}

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
    EVOLUTION_API_URL: evolutionUrl,
    EVOLUTION_API_KEY: evolutionKey,
    WHATSAPP_SANDBOX: whatsappSandbox,
    IA_PROVEDOR: iaProvedor, IA_DESLIGADA: iaDesligada, IA_MODELO_LEITURA: iaModelo, IA_INFERENCE_GEO: iaGeo, IA_TETO_GLOBAL_MENSAL_USD: iaTeto,
    // Plano 11 (RNF-103): a chave do provedor só existe no worker; o app nunca a declara (o schema dele a descarta)
    ANTHROPIC_API_KEY: opcional(z.string().regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/, { message: 'ANTHROPIC_API_KEY em formato inválido (confira se foi colada inteira)' }).optional()),
    // INT-03: chaves do push (gere com: npx web-push generate-vapid-keys). Sem elas, o push fica desligado
    VAPID_PUBLIC_KEY: opcional(z.string().regex(VAPID_PUBLICA, { message: 'VAPID_PUBLIC_KEY deve ser a chave pública em base64url (87 caracteres)' }).optional()),
    VAPID_PRIVATE_KEY: opcional(z.string().regex(VAPID_PRIVADA, { message: 'VAPID_PRIVATE_KEY deve ser a chave privada em base64url (43 caracteres)' }).optional()),
    VAPID_SUBJECT: opcional(
      z
        .string()
        .refine((v) => /^(mailto:|https:\/\/)/.test(v) && URL.canParse(v), { message: 'VAPID_SUBJECT deve começar com mailto: ou https://' })
        .optional(),
    ),
  })
  .transform((e) => ({
    ...e,
    // Produção envia pelo Resend; dev e testes pelo Mailpit. O E2E do CI força mailpit.
    EMAIL_TRANSPORT: e.EMAIL_TRANSPORT ?? (e.NODE_ENV === 'production' ? 'resend' : 'mailpit'),
  }))
  .superRefine((e, ctx) => {
    conferirIaEmProducao(e, ctx);
    if (e.EMAIL_TRANSPORT === 'resend' && !e.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY é obrigatória para enviar pelo Resend' });
    }
    if (e.EMAIL_TRANSPORT === 'mailpit' && !e.MAILPIT_URL) {
      ctx.addIssue({ code: 'custom', path: ['MAILPIT_URL'], message: 'MAILPIT_URL é obrigatória para enviar pelo Mailpit' });
    }
    if (Boolean(e.EVOLUTION_API_URL) !== Boolean(e.EVOLUTION_API_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['EVOLUTION_API_URL'], message: 'Configure EVOLUTION_API_URL e EVOLUTION_API_KEY juntas (ou nenhuma)' });
    }
    if (e.WHATSAPP_SANDBOX === '1' && emProducao(e)) {
      ctx.addIssue({ code: 'custom', path: ['WHATSAPP_SANDBOX'], message: 'WHATSAPP_SANDBOX só fora de produção' });
    }
    if (e.WHATSAPP_SANDBOX === '1' && !e.MAILPIT_URL) ctx.addIssue({ code: 'custom', path: ['MAILPIT_URL'], message: 'MAILPIT_URL é obrigatória com WHATSAPP_SANDBOX=1' });
    const vapid = [e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY, e.VAPID_SUBJECT];
    if (vapid.some(Boolean) && !vapid.every(Boolean)) {
      ctx.addIssue({ code: 'custom', path: ['VAPID_PUBLIC_KEY'], message: 'Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT juntas (ou nenhuma)' });
    }
    if (e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY && VAPID_PUBLICA.test(e.VAPID_PUBLIC_KEY) && VAPID_PRIVADA.test(e.VAPID_PRIVATE_KEY) && !vapidDoMesmoPar(e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['VAPID_PRIVATE_KEY'], message: 'VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY não são do mesmo par (gere as duas juntas com: npx web-push generate-vapid-keys)' });
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
