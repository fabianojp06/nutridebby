# Plano 01 — Fundação: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a base do NutriDebby: repositório Next.js 16 com banco multi-tenant isolado por RLS (tenant e paciente), autenticação com argon2id e 2FA, worker com heartbeat, CI com teste de isolamento e deploy automático GHCR → Easypanel, terminando com um admin logado com 2FA em produção.

**Architecture:** Monólito modular Next.js (App Router) + worker pg-boss na mesma imagem Docker. PostgreSQL 16 com dois roles: o *migrator* (dono do schema, roda migrations) e o *app* (sem `SUPERUSER`/`BYPASSRLS`, membro de `nutri_app_role`). Toda consulta a tabela com `tenant_id` passa por `withTenant()`, que define `app.tenant_id`, `app.role` e `app.patient_id` na transação; políticas RLS criadas por funções SQL reutilizáveis (`app_enable_tenant_rls`, `app_enable_patient_rls`). Better Auth cuida de sessão, senha e 2FA; as regras de papel e inatividade ficam em `evaluateSession()`.

**Tech Stack:** Node 24 · pnpm · TypeScript strict · Next.js 16.3 · React 19 · PostgreSQL 16 · Drizzle ORM 0.45 / drizzle-kit 0.31 · Better Auth 1.7 · @node-rs/argon2 · pg-boss 12 · Zod 4 · pino · Vitest 5 + @testcontainers/postgresql 12 · Playwright · @serwist/turbopack 9.5 · GitHub Actions · GHCR · Easypanel.

**Spec:** [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.2) e [`../specs/2026-09-27-nutridebby-mvp-historias.md`](../specs/2026-09-27-nutridebby-mvp-historias.md). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md).

## Global Constraints

- Runtime: Node 24 LTS; TypeScript `strict`; pnpm (lockfile obrigatório, `--frozen-lockfile` no CI).
- Next.js 16 App Router; o arquivo de interceptação é `src/proxy.ts` (não `middleware.ts`), runtime Node, sem opção `runtime`.
- PostgreSQL 16 com extensões `citext`, `pg_trgm`, `unaccent`, `btree_gist`.
- RNF-07: RLS habilitada **e forçada** em toda tabela com `tenant_id`; a aplicação conecta com role sem `BYPASSRLS` e sem `SUPERUSER`; CI falha se uma tabela com `tenant_id` não tiver RLS forçada.
- §4.1: sessões de paciente têm política adicional por `patient_id`; o admin **nunca** consulta tabelas 🔒 (`withTenant` não aceita papel `admin`).
- RNF-06: senhas em argon2id; sessão expira após **12 h de inatividade** (nutricionista/admin) ou **30 dias** (paciente); **5 tentativas de login a cada 15 min**; 2FA **obrigatório para admin**; segredos só em variáveis de ambiente.
- US-002: senha com **mínimo de 10 caracteres, pelo menos 1 letra e 1 número**, recusada se estiver entre as 10 mil mais comuns; link de recuperação vale **1 h** e é de uso único; mensagem de recuperação sempre *"Se o e-mail estiver cadastrado, você receberá um link"*; bloqueio: HTTP 429 e *"Muitas tentativas. Tente novamente em 15 minutos."*
- RNF-11: logs JSON (pino) sem senha, token, cookie ou dado de saúde.
- RNF-03: limites no Easypanel — `nutri_app` 1 GB / 1 vCPU; `nutri_db` 1 GB; `nutri_worker` 512 MB. Build da imagem **fora da VPS** (GitHub Actions).
- Textos de interface e erros em pt-BR, com o texto exato da spec quando ela define um.
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): configuração de serviço só pelo painel do Easypanel; **confirmar com o dono antes** de reiniciar serviço, mexer em banco de produção ou firewall; nunca reiniciar o Easypanel; nunca exibir segredos.
- Política de revisão por entrega (índice): revisor por tarefa + `/code-review high` 2× + `/security-review`, tudo dentro da assinatura (sem `/code-review ultra`); merge só com confirmação do dono.

### Desvios conscientes da spec (registrados aqui; atualizar a spec no fim do plano)

| Spec | Neste plano | Motivo |
|---|---|---|
| Tabela `users` | Tabelas do Better Auth: `user`, `session`, `account`, `verification`, `two_factor`, `rate_limit` | Geradas pelo CLI do Better Auth; `user` cumpre o papel de `users` |
| `totp_secret` cifrado com AES-256-GCM e `ENCRYPTION_KEY` | Cifrado pelo Better Auth com XChaCha20-Poly1305 usando `AUTH_SECRET` | Proteção equivalente, sem código próprio de criptografia; `ENCRYPTION_KEY` fica para dados de planos futuros |
| Limite por IP + e-mail | Limite por IP + rota (Better Auth) | Atende ao cenário da US-002 (mesmo e-mail e IP); o risco de falsificar IP via `X-Forwarded-For` é verificado na Tarefa 13 |
| PK uuid v7 | uuid v4 (`gen_random_uuid()`) | Postgres 16 não tem `uuidv7()` nativo |
| Link de convite 72 h (nutri) / 7 dias (paciente) | Neste plano só existe o link de definição de senha do admin (1 h) | Convites entram no Plano 02 com token próprio |
| E-mail de recuperação | Até o Plano 02, o link só é entregue pelo CLI `admin:criar`; "Esqueci minha senha" registra aviso no log | Envio de e-mail é o P02-01 |

## Review Focus

1. **Conexão reaproveitada do pool depois de `withTenant`** — uma consulta fora de `withTenant` na mesma conexão precisa ver **0 linhas**, não os dados do último tenant (`set_config(..., true)` + `nullif(...,'')`). Teste na Tarefa 4.
2. **Superusuário mascarando a RLS nos testes** — o usuário padrão do Testcontainers é superusuário e ignora RLS; os testes precisam conectar com o role da aplicação e provar que ele não tem `rolsuper`/`rolbypassrls`. Teste na Tarefa 3.
3. **Parâmetro `volta` (redirecionamento após login) como open redirect** — `?volta=//evil.com` ou `?volta=https://evil.com` deve cair em `/inicio`. Teste na Tarefa 8.
4. **E-mail com maiúsculas/espaços no CLI** — `" Admin@Exemplo.com "` precisa virar `admin@exemplo.com` e continuar logando. Teste na Tarefa 9.
5. **Worker parado sem alarme** — heartbeat com mais de 10 min precisa fazer `/api/health` responder 503. Teste na Tarefa 10.

---

## Estrutura de arquivos

```
.
├── .github/workflows/ci.yml            # Tarefa 12
├── .github/workflows/deploy.yml        # Tarefa 12
├── .claude/settings.json               # Tarefa 14 (desativa plugins Vercel/Supabase)
├── .mcp.json                           # Tarefa 14
├── CLAUDE.md                           # Tarefa 14
├── Dockerfile · .dockerignore · docker-entrypoint.sh   # Tarefa 11
├── docker-compose.dev.yml              # Tarefa 2
├── drizzle.config.ts                   # Tarefa 3
├── drizzle/                            # migrations (geradas + custom)
├── e2e/auth.spec.ts                    # Tarefa 8
├── playwright.config.ts                # Tarefa 8
├── scripts/
│   ├── migrate.ts                      # Tarefa 3
│   ├── admin-criar.ts                  # Tarefa 9
│   └── e2e-seed.ts                     # Tarefa 8
├── src/
│   ├── env.ts                          # Tarefa 2 — variáveis validadas (Zod)
│   ├── proxy.ts                        # Tarefa 8
│   ├── db/
│   │   ├── client.ts                   # Tarefa 3 — Pool + Drizzle
│   │   ├── migrate.ts                  # Tarefa 3 — migrations + role da aplicação
│   │   ├── tenant.ts                   # Tarefa 4 — withTenant
│   │   ├── rls-guard.ts                # Tarefa 5 — consulta de conformidade RLS
│   │   └── schema/{index,platform,auth}.ts
│   ├── lib/
│   │   ├── text.ts                     # Tarefa 1 — normalizeEmail
│   │   ├── logger.ts                   # Tarefa 10
│   │   ├── password-policy.ts          # Tarefa 6 — regras puras (cliente e servidor)
│   │   ├── password.server.ts          # Tarefa 6 — argon2 + lista de senhas comuns
│   │   ├── common-passwords.txt        # Tarefa 6
│   │   ├── password-links.ts           # Tarefa 6 — entrega de links (stub até P02)
│   │   ├── auth.ts                     # Tarefa 6 — createAuth/getAuth
│   │   ├── auth.cli.ts                 # Tarefa 6 — instância só para o CLI do Better Auth
│   │   ├── auth-client.ts              # Tarefa 7
│   │   ├── session-rules.ts            # Tarefa 6 — evaluateSession (puro)
│   │   ├── session.ts                  # Tarefa 6 — requireUser (server-only)
│   │   └── safe-return.ts              # Tarefa 8
│   ├── modules/plataforma/admin-bootstrap.ts   # Tarefa 9
│   ├── worker/{index,heartbeat}.ts     # Tarefa 10
│   └── app/
│       ├── layout.tsx · page.tsx
│       ├── inicio/page.tsx             # redireciona por papel
│       ├── entrar/page.tsx · entrar/2fa/page.tsx
│       ├── esqueci-senha/page.tsx · definir-senha/page.tsx
│       ├── conta/seguranca/{page,enable-2fa}.tsx
│       ├── admin/page.tsx · painel/page.tsx · p/{layout,page}.tsx
│       ├── api/auth/[...all]/route.ts
│       ├── api/health/route.ts
│       ├── manifest.ts · sw.ts · serwist/[path]/route.ts   # Tarefa 15
└── test/
    ├── global-setup.ts · setup.ts · db.ts
    └── (testes *.test.ts ficam ao lado do código em src/)
```

---

### Task 1: Scaffold do projeto (P01-01)

**Files:**
- Create: projeto Next.js na raiz (via `create-next-app`), `.nvmrc`, `.prettierrc`, `vitest.config.ts`, `src/lib/text.ts`, `src/lib/text.test.ts`
- Modify: `.gitignore` (mesclar), `package.json` (scripts, engines)

**Interfaces:**
- Produces: `normalizeEmail(email: string): string` em `@/lib/text`; scripts `pnpm lint | typecheck | test | build`.

- [ ] **Step 1: Criar o branch e gerar o scaffold em pasta temporária** (a raiz já tem `docs/` e `.gitignore`, e o `create-next-app` recusa diretório com conflitos)

```bash
cd /home/deploy/servidor/projetos/nutridebby
git checkout -b plano-01-fundacao
pnpm dlx create-next-app@16.3.6 /tmp/nd-scaffold --ts --app --src-dir --eslint --tailwind \
  --import-alias "@/*" --use-pnpm --yes --skip-install
rsync -a --exclude .git --exclude .gitignore /tmp/nd-scaffold/ ./
cat /tmp/nd-scaffold/.gitignore >> .gitignore && sort -u .gitignore -o .gitignore
rm -rf /tmp/nd-scaffold
echo "24" > .nvmrc
```

- [ ] **Step 2: Instalar dependências de base e de teste**

```bash
pnpm install
pnpm add zod@4.6.5 pg@8.23.0 drizzle-orm@0.45.3 better-auth@1.7.6 @node-rs/argon2@2.2.1 pg-boss@12.35.0 pino@10.3.1 tsx@4.23.15 qrcode server-only
pnpm add -D drizzle-kit@0.31.11 vitest@5.0.2 @testcontainers/postgresql@12.1.0 @playwright/test@1.63.0 @types/pg @types/qrcode prettier otpauth vite-tsconfig-paths
```

`tsx` fica em `dependencies` porque o container de produção roda o worker e os scripts com ele.

- [ ] **Step 3: Ajustar `package.json`** (scripts e engines; manter o resto gerado)

```json
{
  "engines": { "node": ">=24" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx --env-file-if-exists=.env.local scripts/migrate.ts",
    "worker": "tsx --env-file-if-exists=.env.local src/worker/index.ts",
    "admin:criar": "tsx --env-file-if-exists=.env.local scripts/admin-criar.ts",
    "e2e:seed": "tsx --env-file-if-exists=.env.local scripts/e2e-seed.ts"
  }
}
```

`.prettierrc`:

```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

- [ ] **Step 4: Configurar Vitest** — `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
```

Até a Tarefa 3 existir, crie `test/global-setup.ts` e `test/setup.ts` vazios (`export async function setup() {}` / arquivo vazio) para o Vitest rodar.

- [ ] **Step 5: Escrever o teste que falha** — `src/lib/text.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './text';

describe('normalizeEmail', () => {
  it('remove espaços e converte para minúsculas', () => {
    expect(normalizeEmail('  Admin@Exemplo.COM ')).toBe('admin@exemplo.com');
  });
  it('mantém e-mail já normalizado', () => {
    expect(normalizeEmail('debby@exemplo.com')).toBe('debby@exemplo.com');
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `pnpm test src/lib/text.test.ts`
Expected: FAIL — `Cannot find module './text'`

- [ ] **Step 7: Implementar** — `src/lib/text.ts`

```ts
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
```

- [ ] **Step 8: Rodar tudo**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: testes PASS; lint, tipos e build sem erro.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 com TypeScript strict, Vitest e Prettier"
```

---

### Task 2: Ambiente de desenvolvimento e variáveis validadas (P01-02)

**Files:**
- Create: `docker-compose.dev.yml`, `.env.example`, `src/env.ts`, `src/env.test.ts`
- Modify: `.gitignore` (garantir `.env*` exceto `.env.example`)

**Interfaces:**
- Produces: `parseEnv(source: Record<string, string | undefined>): Env` e `getEnv(): Env` (memoizado) em `@/env`. `Env = { NODE_ENV; APP_URL; DATABASE_URL; DATABASE_URL_MIGRATOR; AUTH_SECRET; LOG_LEVEL }`.

- [ ] **Step 1: Escrever o teste que falha** — `src/env.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';

const base = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://nutri_app:app@localhost:54329/nutri',
  DATABASE_URL_MIGRATOR: 'postgres://nutri_owner:owner@localhost:54329/nutri',
  AUTH_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('aceita configuração válida e aplica padrão de LOG_LEVEL', () => {
    expect(parseEnv(base).LOG_LEVEL).toBe('info');
  });
  it('recusa DATABASE_URL ausente com mensagem clara', () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
  it('recusa AUTH_SECRET com menos de 32 caracteres', () => {
    expect(() => parseEnv({ ...base, AUTH_SECRET: 'curto' })).toThrow(/AUTH_SECRET/);
  });
  it('recusa APP_URL que não é URL', () => {
    expect(() => parseEnv({ ...base, APP_URL: 'app' })).toThrow(/APP_URL/);
  });
  it('recusa app e migrator com o mesmo usuário do banco', () => {
    expect(() =>
      parseEnv({ ...base, DATABASE_URL_MIGRATOR: 'postgres://nutri_app:x@localhost:54329/nutri' }),
    ).toThrow(/roles diferentes/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/env.test.ts`
Expected: FAIL — `Cannot find module './env'`

- [ ] **Step 3: Implementar** — `src/env.ts`

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test src/env.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Criar `docker-compose.dev.yml`**

```yaml
name: nutridebby-dev
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: nutri_owner
      POSTGRES_PASSWORD: dev-owner
      POSTGRES_DB: nutri
    ports: ['127.0.0.1:54329:5432']
    volumes: ['nd-dev-db:/var/lib/postgresql/data']
    mem_limit: 512m
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U nutri_owner -d nutri']
      interval: 5s
      retries: 10
  mailpit:
    image: axllent/mailpit:v1.27
    ports: ['127.0.0.1:8025:8025', '127.0.0.1:1025:1025']
    mem_limit: 128m
volumes:
  nd-dev-db:
```

Portas presas em `127.0.0.1` para o banco de dev não ficar exposto na internet da VPS.

- [ ] **Step 6: Criar `.env.example`** (só nomes; valores de dev comentados onde não são segredo)

```dotenv
# --- Plano 01 ---
NODE_ENV=development
APP_URL=http://localhost:3000
# role da aplicação (sem SUPERUSER/BYPASSRLS) — criado pelo `pnpm db:migrate`
DATABASE_URL=postgres://nutri_app:dev-app@localhost:54329/nutri
# role dono do schema (roda migrations)
DATABASE_URL_MIGRATOR=postgres://nutri_owner:dev-owner@localhost:54329/nutri
AUTH_SECRET=
LOG_LEVEL=info
# --- Planos seguintes (spec §9.6) ---
ENCRYPTION_KEY=
WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_API_VERSION=
RESEND_API_KEY=
EMAIL_FROM=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
SENTRY_DSN=
SENTRY_AUTH_TOKEN=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
BACKUP_PASSPHRASE=
TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
FILE_URL_SECRET=
DATA_DIR=
```

Garanta no `.gitignore`: `.env`, `.env.local`, `.env.*.local` e a exceção `!.env.example`.

- [ ] **Step 7: Subir o ambiente e criar `.env.local`**

```bash
docker compose -f docker-compose.dev.yml up -d
cp .env.example .env.local
# gerar AUTH_SECRET sem exibir na tela:
sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env.local
docker compose -f docker-compose.dev.yml ps
```

Expected: `db` com status `healthy` e `mailpit` `running`.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.dev.yml .env.example .gitignore src/env.ts src/env.test.ts
git commit -m "feat: ambiente de dev (Postgres 16 + Mailpit) e validação de variáveis com Zod"
```

---

### Task 3: Banco — cliente, migrations de base e role da aplicação (P01-03)

**Files:**
- Create: `drizzle.config.ts`, `drizzle/0000_*.sql` (custom), `src/db/client.ts`, `src/db/migrate.ts`, `src/db/schema/index.ts`, `scripts/migrate.ts`, `test/global-setup.ts`, `test/setup.ts`, `test/db.ts`, `src/db/migrate.test.ts`

**Interfaces:**
- Consumes: `getEnv()` (Tarefa 2).
- Produces:
  - `getPool(): Pool`, `getDb(): Db`, `closeDb(): Promise<void>`, tipos `Db` e `Tx` em `@/db/client`.
  - `runMigrations({ migratorUrl, appUrl }): Promise<void>` e `ensureAppLogin(pool, appUrl)` em `@/db/migrate`.
  - Role de grupo `nutri_app_role` e funções SQL `app_current_tenant()`, `app_current_patient()`, `app_current_role()`, `app_enable_tenant_rls(regclass)`, `app_enable_patient_rls(regclass, text)`.
  - Nos testes: `inject('appDatabaseUrl')`, `inject('ownerDatabaseUrl')`; helper `makeDb(url)` em `test/db.ts`.

- [ ] **Step 1: `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATOR ?? '' },
});
```

- [ ] **Step 2: Schema inicial vazio** — `src/db/schema/index.ts`

```ts
export {};
```

- [ ] **Step 3: Gerar a migration custom de base**

Run: `pnpm drizzle-kit generate --custom --name base_roles_e_rls`
Expected: cria `drizzle/0000_base_roles_e_rls.sql` vazio.

Conteúdo de `drizzle/0000_base_roles_e_rls.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nutri_app_role') THEN
    CREATE ROLE nutri_app_role NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO nutri_app_role;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nutri_app_role;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO nutri_app_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_patient() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.patient_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.role', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL '
    'USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', tbl);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_enable_patient_rls(tbl regclass, col text DEFAULT 'patient_id') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS patient_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY patient_isolation ON %s AS RESTRICTIVE FOR ALL '
    'USING (app_current_role() IS DISTINCT FROM %L OR %I = app_current_patient()) '
    'WITH CHECK (app_current_role() IS DISTINCT FROM %L OR %I = app_current_patient())',
    tbl, 'paciente', col, 'paciente', col);
END $$;
```

A política de paciente é **RESTRICTIVE**: combina com `AND` à política de tenant. Para `nutri` e `worker` ela não restringe; para `paciente` exige `patient_id = app.patient_id`.

- [ ] **Step 4: Cliente do banco** — `src/db/client.ts`

```ts
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { getEnv } from '@/env';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let pool: Pool | undefined;
let db: Db | undefined;

export function getPool(): Pool {
  return (pool ??= new Pool({ connectionString: getEnv().DATABASE_URL, max: 10 }));
}

export function getDb(): Db {
  return (db ??= drizzle({ client: getPool(), schema }));
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}
```

- [ ] **Step 5: Migrations + role da aplicação** — `src/db/migrate.ts`

```ts
import path from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const ROLE_NAME = /^[a-z_][a-z0-9_]{2,62}$/;

export async function runMigrations(opts: { migratorUrl: string; appUrl: string }): Promise<void> {
  const pool = new Pool({ connectionString: opts.migratorUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: path.join(process.cwd(), 'drizzle'),
    });
    await ensureAppLogin(pool, opts.appUrl);
  } finally {
    await pool.end();
  }
}

/** Cria (ou atualiza) o role de login da aplicação a partir das credenciais de DATABASE_URL. */
export async function ensureAppLogin(pool: Pool, appUrl: string): Promise<void> {
  const url = new URL(appUrl);
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  if (!ROLE_NAME.test(user)) throw new Error(`Nome de role inválido em DATABASE_URL: ${user}`);
  if (!pass) throw new Error('DATABASE_URL precisa de senha para o role da aplicação');

  const client = await pool.connect();
  try {
    const ident = `"${user}"`;
    const pw = client.escapeLiteral(pass);
    const exists = await client.query('select 1 from pg_roles where rolname = $1', [user]);
    if (exists.rowCount === 0) {
      await client.query(
        `CREATE ROLE ${ident} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD ${pw}`,
      );
    } else {
      await client.query(`ALTER ROLE ${ident} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD ${pw}`);
    }
    await client.query(`GRANT nutri_app_role TO ${ident}`);
    const { rows } = await client.query<{ d: string }>('select current_database() as d');
    await client.query(`GRANT CONNECT ON DATABASE "${rows[0].d}" TO ${ident}`);
    // pg-boss cria as próprias tabelas neste schema (Tarefa 10)
    await client.query(`CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ${ident}`);
  } finally {
    client.release();
  }
}
```

`scripts/migrate.ts`:

```ts
import { runMigrations } from '@/db/migrate';
import { getEnv } from '@/env';

const env = getEnv();
await runMigrations({ migratorUrl: env.DATABASE_URL_MIGRATOR, appUrl: env.DATABASE_URL });
console.log('Migrations aplicadas e role da aplicação conferido.');
```

Os scripts `tsx` carregam `.env.local` via `--env-file-if-exists` (definido na Tarefa 1); no CI e no container o arquivo não existe e as variáveis vêm do ambiente.

- [ ] **Step 6: Infra de testes com Testcontainers** — `test/global-setup.ts`

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrate';

let container: StartedPostgreSqlContainer;

export async function setup(project: TestProject) {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  const ownerUrl = container.getConnectionUri(); // superusuário: só para migrations e fixtures
  const app = new URL(ownerUrl);
  app.username = 'nutri_app';
  app.password = 'test-app-pw';
  const appUrl = app.toString();

  await runMigrations({ migratorUrl: ownerUrl, appUrl });

  // Tabela-fixture com tenant_id + patient_id para testar as duas políticas (Tarefas 4 e 5)
  const owner = new Pool({ connectionString: ownerUrl, max: 1 });
  await owner.query(`
    CREATE TABLE IF NOT EXISTS rls_fixture_patient_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      patient_id uuid NOT NULL,
      texto text NOT NULL
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON rls_fixture_patient_items TO nutri_app_role;
    SELECT app_enable_tenant_rls('rls_fixture_patient_items');
    SELECT app_enable_patient_rls('rls_fixture_patient_items');
  `);
  await owner.end();

  project.provide('ownerDatabaseUrl', ownerUrl);
  project.provide('appDatabaseUrl', appUrl);
}

export async function teardown() {
  await container?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    ownerDatabaseUrl: string;
    appDatabaseUrl: string;
  }
}
```

`test/setup.ts` (roda em cada arquivo de teste, antes dos imports do teste):

```ts
import { inject } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';
process.env.DATABASE_URL = inject('appDatabaseUrl');
process.env.DATABASE_URL_MIGRATOR = inject('ownerDatabaseUrl');
process.env.AUTH_SECRET = 'test-secret-with-at-least-32-characters!!';
process.env.LOG_LEVEL = 'error';
```

`test/db.ts`:

```ts
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/db/schema';

export function makeDb(url: string) {
  const pool = new Pool({ connectionString: url, max: 4 });
  return { pool, db: drizzle({ client: pool, schema }) };
}
```

- [ ] **Step 7: Escrever o teste que falha** — `src/db/migrate.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';

const owner = makeDb(inject('ownerDatabaseUrl'));
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});

describe('migrations de base', () => {
  it('o role da aplicação não é superusuário nem ignora RLS', async () => {
    const { rows } = await owner.pool.query(
      `select rolsuper, rolbypassrls from pg_roles where rolname = 'nutri_app'`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('a conexão da aplicação usa o role nutri_app, membro de nutri_app_role', async () => {
    const { rows } = await app.pool.query(
      `select current_user as u, pg_has_role(current_user, 'nutri_app_role', 'member') as m`,
    );
    expect(rows[0]).toEqual({ u: 'nutri_app', m: true });
  });

  it('instala as extensões exigidas pela spec', async () => {
    const { rows } = await owner.pool.query(
      `select extname from pg_extension where extname in ('citext','pg_trgm','unaccent','btree_gist') order by 1`,
    );
    expect(rows.map((r) => r.extname)).toEqual(['btree_gist', 'citext', 'pg_trgm', 'unaccent']);
  });

  it('rodar as migrations de novo é seguro (idempotente)', async () => {
    const { runMigrations } = await import('./migrate');
    await expect(
      runMigrations({ migratorUrl: inject('ownerDatabaseUrl'), appUrl: inject('appDatabaseUrl') }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 8: Rodar e ver falhar** (antes do Step 3–6 estarem completos) e depois passar

Run: `pnpm test src/db/migrate.test.ts`
Expected: PASS (4 testes). Se falhar em "idempotente", revisar os `IF NOT EXISTS` / `DO $$` do Step 3.

- [ ] **Step 9: Aplicar no banco de dev**

Run: `pnpm db:migrate`
Expected: `Migrations aplicadas e role da aplicação conferido.`

- [ ] **Step 10: Commit**

```bash
git add drizzle.config.ts drizzle src/db scripts/migrate.ts test package.json
git commit -m "feat(db): migrations de base, role da aplicação sem BYPASSRLS e funções de RLS"
```

---

### Task 4: Núcleo multi-tenant — `withTenant`, `tenants` e `audit_log` (P01-04)

**Files:**
- Create: `src/db/schema/platform.ts`, `src/db/tenant.ts`, `src/db/tenant.test.ts`, `drizzle/0001_*.sql` (gerada), `drizzle/0002_*.sql` (custom)
- Modify: `src/db/schema/index.ts`

**Interfaces:**
- Consumes: `getDb()`, `Db`, `Tx` (Tarefa 3); funções SQL da Tarefa 3.
- Produces:
  - Tabelas Drizzle `tenants`, `auditLog`, `systemHeartbeat` em `@/db/schema`.
  - `withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>, db?: Db): Promise<T>`
  - `type TenantContext = { tenantId: string; role: 'nutri' | 'paciente' | 'worker'; patientId?: string }`
  - `class TenantContextError extends Error`

- [ ] **Step 1: Schema** — `src/db/schema/platform.ts`

```ts
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    nomeExibicao: text('nome_exibicao').notNull(),
    status: text('status').notNull().default('ativa'),
    fuso: text('fuso').notNull().default('America/Sao_Paulo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenants_slug_formato', sql`${t.slug} ~ '^[a-z0-9-]{3,40}$'`),
    check('tenants_status_valido', sql`${t.status} in ('ativa', 'suspensa')`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    actorUserId: uuid('actor_user_id'),
    acao: text('acao').notNull(),
    entidade: text('entidade').notNull(),
    entidadeId: text('entidade_id'),
    ip: text('ip'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'audit_log_acao_valida',
      sql`${t.acao} in ('ler','criar','alterar','excluir','exportar','bloquear','anonimizar')`,
    ),
    index('audit_log_busca_idx').on(t.tenantId, t.entidade, t.entidadeId, t.criadoEm),
  ],
);

export const systemHeartbeat = pgTable('system_heartbeat', {
  name: text('name').primaryKey(),
  beatAt: timestamp('beat_at', { withTimezone: true }).notNull(),
});
```

`src/db/schema/index.ts`:

```ts
export * from './platform';
```

- [ ] **Step 2: Gerar a migration e a migration custom de RLS**

```bash
pnpm db:generate --name plataforma
pnpm drizzle-kit generate --custom --name rls_plataforma
```

Conteúdo de `drizzle/0002_rls_plataforma.sql`:

```sql
SELECT app_enable_tenant_rls('audit_log');
--> statement-breakpoint
REVOKE UPDATE, DELETE ON audit_log FROM nutri_app_role;
```

- [ ] **Step 3: Escrever os testes que falham** — `src/db/tenant.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { auditLog, tenants } from './schema';
import { TenantContextError, withTenant } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
let A: string;
let B: string;

beforeAll(async () => {
  const [a, b] = await app.db
    .insert(tenants)
    .values([
      { slug: `a-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Tenant A' },
      { slug: `b-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Tenant B' },
    ])
    .returning({ id: tenants.id });
  A = a.id;
  B = b.id;
  for (const t of [A, B]) {
    await withTenant({ tenantId: t, role: 'nutri' }, (tx) =>
      tx.insert(auditLog).values({ tenantId: t, acao: 'criar', entidade: 'teste' }),
      app.db,
    );
  }
});
afterAll(() => app.pool.end());

describe('withTenant', () => {
  it('só enxerga registros do próprio tenant', async () => {
    const rows = await withTenant({ tenantId: A, role: 'nutri' }, (tx) =>
      tx.select().from(auditLog), app.db);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.tenantId === A)).toBe(true);
  });

  it('recusa inserir registro com tenant_id de outro tenant', async () => {
    await expect(
      withTenant({ tenantId: A, role: 'nutri' }, (tx) =>
        tx.insert(auditLog).values({ tenantId: B, acao: 'criar', entidade: 'teste' }), app.db),
    ).rejects.toThrow(/row-level security/);
  });

  it('fora de withTenant, a mesma conexão do pool não vê nada (Review Focus 1)', async () => {
    const client = await app.pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.tenant_id', $1, true)`, [A]);
      await client.query('commit');
      const { rows } = await client.query('select count(*)::int as n from audit_log');
      expect(rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it('audit_log não aceita UPDATE nem DELETE pelo role da aplicação', async () => {
    await expect(
      withTenant({ tenantId: A, role: 'nutri' }, (tx) =>
        tx.execute(sql`update audit_log set acao = 'ler'`), app.db),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant({ tenantId: A, role: 'nutri' }, (tx) => tx.execute(sql`delete from audit_log`), app.db),
    ).rejects.toThrow(/permission denied/);
  });

  it('valida o contexto antes de tocar no banco', async () => {
    await expect(withTenant({ tenantId: 'x', role: 'nutri' }, async () => 1, app.db)).rejects.toBeInstanceOf(TenantContextError);
    await expect(withTenant({ tenantId: A, role: 'paciente' }, async () => 1, app.db)).rejects.toThrow(/patientId/);
    await expect(
      withTenant({ tenantId: A, role: 'nutri', patientId: randomUUID() }, async () => 1, app.db),
    ).rejects.toThrow(/patientId/);
  });

  it('sessão de paciente só vê as próprias linhas (política RESTRICTIVE)', async () => {
    const P1 = randomUUID();
    const P2 = randomUUID();
    await withTenant({ tenantId: A, role: 'nutri' }, (tx) =>
      tx.execute(sql`insert into rls_fixture_patient_items (tenant_id, patient_id, texto)
        values (${A}, ${P1}, 'p1'), (${A}, ${P2}, 'p2')`), app.db);
    const seen = await withTenant({ tenantId: A, role: 'paciente', patientId: P1 }, (tx) =>
      tx.execute<{ patient_id: string }>(sql`select patient_id from rls_fixture_patient_items`), app.db);
    expect(seen.rows.map((r) => r.patient_id)).toEqual([P1]);
    const nutriSees = await withTenant({ tenantId: A, role: 'nutri' }, (tx) =>
      tx.execute(sql`select 1 from rls_fixture_patient_items where patient_id in (${P1}, ${P2})`), app.db);
    expect(nutriSees.rows.length).toBe(2);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm test src/db/tenant.test.ts`
Expected: FAIL — `Cannot find module './tenant'`

- [ ] **Step 5: Implementar** — `src/db/tenant.ts`

```ts
import { sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from './client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantRole = 'nutri' | 'paciente' | 'worker';
export type TenantContext = { tenantId: string; role: TenantRole; patientId?: string };

export class TenantContextError extends Error {
  override name = 'TenantContextError';
}

function assertContext(ctx: TenantContext): void {
  if (!UUID.test(ctx.tenantId)) throw new TenantContextError('tenantId inválido');
  if (ctx.role === 'paciente') {
    if (!ctx.patientId || !UUID.test(ctx.patientId)) {
      throw new TenantContextError('patientId obrigatório para sessão de paciente');
    }
  } else if (ctx.patientId !== undefined) {
    throw new TenantContextError('patientId só é permitido para sessão de paciente');
  }
}

/**
 * Executa `fn` numa transação com o contexto do tenant aplicado à RLS.
 * Toda consulta a tabela com tenant_id DEVE passar por aqui.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  db: Db = getDb(),
): Promise<T> {
  assertContext(ctx);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${ctx.tenantId}, true),
      set_config('app.role', ${ctx.role}, true),
      set_config('app.patient_id', ${ctx.patientId ?? ''}, true)`);
    return fn(tx);
  });
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm test src/db/tenant.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 7: Aplicar no dev e commit**

```bash
pnpm db:migrate
git add src/db drizzle
git commit -m "feat(db): withTenant com RLS por tenant e por paciente; tabelas tenants e audit_log"
```

---

### Task 5: Guarda de conformidade RLS no CI (P01-05)

**Files:**
- Create: `src/db/rls-guard.ts`, `src/db/rls-guard.test.ts`

**Interfaces:**
- Consumes: pool do migrator/owner (só leitura de catálogo).
- Produces: `findRlsViolations(pool: Pool): Promise<RlsViolation[]>` e `RLS_EXCEPTIONS: Record<string, string>` (tabela → justificativa) em `@/db/rls-guard`. `type RlsViolation = { table: string; problem: string }`.

- [ ] **Step 1: Escrever o teste que falha** — `src/db/rls-guard.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';
import { findRlsViolations } from './rls-guard';

const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(() => owner.pool.end());

describe('guarda de RLS (US-006: "Nova tabela sem RLS quebra o CI")', () => {
  it('nenhuma tabela com tenant_id está fora da regra', async () => {
    const violations = await findRlsViolations(owner.pool);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it('detecta uma tabela nova com tenant_id sem RLS (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_sem_rls (id int primary key, tenant_id uuid not null)');
      await client.query('create table tmp_sem_paciente (id int primary key, tenant_id uuid not null, patient_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_sem_paciente')`);
      const v = await findRlsViolations(client);
      expect(v).toContainEqual({ table: 'tmp_sem_rls', problem: 'RLS não habilitada' });
      expect(v).toContainEqual({ table: 'tmp_sem_paciente', problem: 'sem política patient_isolation' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/db/rls-guard.test.ts`
Expected: FAIL — `Cannot find module './rls-guard'`

- [ ] **Step 3: Implementar** — `src/db/rls-guard.ts`

```ts
import type { Pool, PoolClient } from 'pg';

export type RlsViolation = { table: string; problem: string };

/**
 * Tabelas com tenant_id que seguem outra regra, com a justificativa.
 * Ex. futuro (Plano 04): foods: 'tenant_id nulo = TACO; política própria de leitura'.
 */
export const RLS_EXCEPTIONS: Record<string, string> = {};

/** Tabelas com patient_id que não precisam da política de paciente, com a justificativa. */
export const PATIENT_POLICY_EXCEPTIONS: Record<string, string> = {};

export async function findRlsViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{
    table: string;
    rls: boolean;
    forced: boolean;
    has_tenant_policy: boolean;
    has_patient_col: boolean;
    has_patient_policy: boolean;
  }>(`
    select c.relname as table,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as forced,
           exists (select 1 from pg_policies p where p.schemaname = 'public'
                   and p.tablename = c.relname and p.policyname = 'tenant_isolation') as has_tenant_policy,
           exists (select 1 from information_schema.columns k where k.table_schema = 'public'
                   and k.table_name = c.relname and k.column_name = 'patient_id') as has_patient_col,
           exists (select 1 from pg_policies p where p.schemaname = 'public'
                   and p.tablename = c.relname and p.policyname = 'patient_isolation') as has_patient_policy
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from information_schema.columns k where k.table_schema = 'public'
                   and k.table_name = c.relname and k.column_name = 'tenant_id')
     order by 1`);

  const out: RlsViolation[] = [];
  for (const r of rows) {
    if (RLS_EXCEPTIONS[r.table]) continue;
    if (!r.rls) out.push({ table: r.table, problem: 'RLS não habilitada' });
    else if (!r.forced) out.push({ table: r.table, problem: 'RLS não forçada' });
    else if (!r.has_tenant_policy) out.push({ table: r.table, problem: 'sem política tenant_isolation' });
    if (r.has_patient_col && !r.has_patient_policy && !PATIENT_POLICY_EXCEPTIONS[r.table]) {
      out.push({ table: r.table, problem: 'sem política patient_isolation' });
    }
  }
  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test src/db/rls-guard.test.ts`
Expected: PASS (2 testes). O primeiro teste lista `audit_log` e `rls_fixture_patient_items` como conformes.

- [ ] **Step 5: Commit**

```bash
git add src/db/rls-guard.ts src/db/rls-guard.test.ts
git commit -m "test(db): guarda de conformidade RLS que quebra o CI em tabela nova sem política"
```

---

### Task 6: Autenticação — Better Auth, argon2id, política de senha e regras de sessão (P01-06)

**Files:**
- Create: `src/lib/password-policy.ts`, `src/lib/password-policy.test.ts`, `src/lib/password.server.ts`, `src/lib/common-passwords.txt`, `src/lib/password-links.ts`, `src/lib/auth.ts`, `src/lib/auth.cli.ts`, `src/db/schema/auth.ts` (gerado), `src/lib/session-rules.ts`, `src/lib/session-rules.test.ts`, `src/lib/session.ts`, `src/lib/auth.test.ts`, `src/app/api/auth/[...all]/route.ts`, `drizzle/0003_*.sql` (gerada)
- Modify: `src/db/schema/index.ts`

**Interfaces:**
- Consumes: `getEnv()`, `getDb()`, `Db`, `tenants`.
- Produces:
  - `validatePasswordPolicy(pw: string, common?: ReadonlySet<string>): string | null` (mensagem de erro ou `null`) em `@/lib/password-policy`.
  - `hashPassword(pw): Promise<string>`, `verifyPassword(hash, pw): Promise<boolean>`, `isCommonPassword(pw): boolean` em `@/lib/password.server`.
  - `setPasswordLinkSink(fn: PasswordLinkSink): () => void` e `deliverPasswordLink({ email, url }): Promise<void>` em `@/lib/password-links`.
  - `createAuth(db: Db, opts?: { baseURL?: string; secret?: string })`, `getAuth()`, `type Auth` em `@/lib/auth`.
  - `evaluateSession(input): SessionDecision`, `homeFor(role: AppRole): string`, `STAFF_IDLE_MS`, `type AppRole = 'admin' | 'nutri' | 'paciente'` em `@/lib/session-rules`.
  - `requireUser(allowed: AppRole[], path: string): Promise<{ user; session }>` em `@/lib/session`.
  - Campos adicionais do usuário: `appRole` (`'admin' | 'nutri' | 'paciente'`) e `tenantId` (uuid, nulo para admin).

- [ ] **Step 1: Baixar a lista de senhas comuns**

```bash
curl -fsSL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/10k-most-common.txt \
  -o src/lib/common-passwords.txt
wc -l src/lib/common-passwords.txt   # esperado: ~10000
```

- [ ] **Step 2: Escrever o teste da política (falha)** — `src/lib/password-policy.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { validatePasswordPolicy } from './password-policy';

const common = new Set(['password123', 'qwerty12345']);

describe('validatePasswordPolicy (US-002)', () => {
  it.each([
    ['Nutri2026segura', null],
    ['curta1', 'A senha precisa ter pelo menos 10 caracteres.'],
    ['somenteletras', 'A senha precisa ter pelo menos 1 letra e 1 número.'],
    ['1234567890', 'A senha precisa ter pelo menos 1 letra e 1 número.'],
    ['Password123', 'Essa senha é muito comum. Escolha outra.'],
  ])('%s → %s', (pw, expected) => {
    expect(validatePasswordPolicy(pw, common)).toBe(expected);
  });
  it('recusa senha acima de 128 caracteres', () => {
    expect(validatePasswordPolicy('a1'.repeat(65), common)).toBe('A senha pode ter no máximo 128 caracteres.');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test src/lib/password-policy.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 4: Implementar a política** — `src/lib/password-policy.ts` (sem `server-only`: também roda no navegador, sem a lista)

```ts
export function validatePasswordPolicy(pw: string, common?: ReadonlySet<string>): string | null {
  if (pw.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (pw.length > 128) return 'A senha pode ter no máximo 128 caracteres.';
  if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/[0-9]/.test(pw)) {
    return 'A senha precisa ter pelo menos 1 letra e 1 número.';
  }
  if (common?.has(pw.toLowerCase())) return 'Essa senha é muito comum. Escolha outra.';
  return null;
}
```

`src/lib/password.server.ts` (sem `import 'server-only'`, porque também roda no Vitest e nos scripts `tsx`; o sufixo `.server` sinaliza o uso; só `session.ts` e as páginas importam `server-only`):

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hash, verify } from '@node-rs/argon2';

// algorithm: 2 = Argon2id (o enum `Algorithm` é const enum e não funciona com isolatedModules)
const ARGON2 = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => hash(pw, ARGON2);
export const verifyPassword = (h: string, pw: string) => verify(h, pw);

let common: Set<string> | undefined;
export function commonPasswords(): ReadonlySet<string> {
  if (!common) {
    const file = readFileSync(path.join(process.cwd(), 'src/lib/common-passwords.txt'), 'utf8');
    common = new Set(file.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean));
  }
  return common;
}
```

Rodar de novo: `pnpm test src/lib/password-policy.test.ts` → PASS.

- [ ] **Step 5: Entrega de links de senha (stub até o Plano 02)** — `src/lib/password-links.ts`

```ts
export type PasswordLink = { email: string; url: string };
export type PasswordLinkSink = (link: PasswordLink) => Promise<void> | void;

const maskEmail = (e: string) => e.replace(/^(.).*(@.*)$/, '$1***$2');

const defaultSink: PasswordLinkSink = ({ email }) => {
  // Plano 02 (P02-01) troca por envio de e-mail. Nunca registrar a URL (contém token).
  console.warn(`[password-links] envio de e-mail ainda não configurado; link não enviado para ${maskEmail(email)}`);
};

let sink: PasswordLinkSink = defaultSink;

/** Troca o destino dos links (CLI e testes). Retorna função que restaura o anterior. */
export function setPasswordLinkSink(fn: PasswordLinkSink): () => void {
  const prev = sink;
  sink = fn;
  return () => {
    sink = prev;
  };
}

export async function deliverPasswordLink(link: PasswordLink): Promise<void> {
  await sink(link);
}
```

- [ ] **Step 6: Configuração do Better Auth** — `src/lib/auth.ts`

```ts
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
```

`src/lib/auth.cli.ts` (usado só para gerar o schema; não abre conexão):

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { createAuth } from './auth';

export const auth = createAuth(drizzle('postgres://cli:cli@127.0.0.1:1/cli'), {
  baseURL: 'http://localhost:3000',
  secret: 'cli-only-secret-cli-only-secret-000',
});
```

`session.ts` importa `server-only`; os testes não o importam. Se algum teste precisar, adicione em `vitest.config.ts` → `test.alias: { 'server-only': new URL('./test/server-only-stub.ts', import.meta.url).pathname }` com `test/server-only-stub.ts` contendo `export {};`.

- [ ] **Step 7: Gerar o schema do Better Auth e ajustar**

```bash
pnpm dlx auth@1.7.6 generate --config ./src/lib/auth.cli.ts --output ./src/db/schema/auth.ts --yes
```

Abra `src/db/schema/auth.ts` e ajuste **somente**:
1. `tenantId`: trocar `text('tenant_id')` por `uuid('tenant_id').references(() => tenants.id)` (importe `uuid` de `drizzle-orm/pg-core` e `tenants` de `./platform`).
2. Na tabela `user`, adicionar ao terceiro argumento de `pgTable` o check `check('user_app_role_valido', sql\`${t.appRole} in ('admin','nutri','paciente')\`)`.
3. Na tabela `user`, trocar o tipo do `email` para `citext` se o gerador usou `text`: declare `const citext = customType<{ data: string }>({ dataType: () => 'citext' });` e use `citext('email').notNull().unique()`.

`src/db/schema/index.ts`:

```ts
export * from './platform';
export * from './auth';
```

Gerar a migration: `pnpm db:generate --name auth` e aplicar `pnpm db:migrate`.

- [ ] **Step 8: Regras de sessão — teste que falha** — `src/lib/session-rules.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { evaluateSession, homeFor, STAFF_IDLE_MS } from './session-rules';

const now = new Date('2026-10-01T12:00:00Z');
const recent = new Date(now.getTime() - 60_000);
const idle = new Date(now.getTime() - STAFF_IDLE_MS - 1);
const base = { now, path: '/admin', allowed: ['admin'] as const };

describe('evaluateSession (RNF-06, US-002, US-003)', () => {
  it('sem sessão → login', () => {
    expect(evaluateSession({ ...base, session: null, user: null })).toBe('login');
  });
  it('papel fora da lista → forbidden', () => {
    expect(evaluateSession({ ...base, session: { updatedAt: recent }, user: { appRole: 'nutri', twoFactorEnabled: true } })).toBe('forbidden');
  });
  it('nutri inativa há mais de 12 h → expired', () => {
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: { updatedAt: idle }, user: { appRole: 'nutri', twoFactorEnabled: false } })).toBe('expired');
  });
  it('paciente inativo há mais de 12 h continua ok (limite é 30 dias, do Better Auth)', () => {
    expect(evaluateSession({ now, path: '/p', allowed: ['paciente'], session: { updatedAt: idle }, user: { appRole: 'paciente', twoFactorEnabled: false } })).toBe('ok');
  });
  it('admin sem 2FA → setup-2fa, exceto na própria tela de segurança', () => {
    const user = { appRole: 'admin', twoFactorEnabled: false };
    expect(evaluateSession({ ...base, session: { updatedAt: recent }, user })).toBe('setup-2fa');
    expect(evaluateSession({ now, path: '/conta/seguranca', allowed: ['admin', 'nutri'], session: { updatedAt: recent }, user })).toBe('ok');
  });
  it('admin com 2FA → ok', () => {
    expect(evaluateSession({ ...base, session: { updatedAt: recent }, user: { appRole: 'admin', twoFactorEnabled: true } })).toBe('ok');
  });
  it('homeFor', () => {
    expect([homeFor('admin'), homeFor('nutri'), homeFor('paciente')]).toEqual(['/admin', '/painel', '/p']);
  });
});
```

- [ ] **Step 9: Implementar** — `src/lib/session-rules.ts`

```ts
export type AppRole = 'admin' | 'nutri' | 'paciente';
export type SessionDecision = 'ok' | 'login' | 'expired' | 'setup-2fa' | 'forbidden';

export const STAFF_IDLE_MS = 12 * 60 * 60 * 1000;
export const SECURITY_PATH = '/conta/seguranca';

export function homeFor(role: AppRole): string {
  return role === 'admin' ? '/admin' : role === 'nutri' ? '/painel' : '/p';
}

export function evaluateSession(input: {
  session: { updatedAt: Date } | null;
  user: { appRole: string; twoFactorEnabled?: boolean | null } | null;
  allowed: readonly AppRole[];
  now: Date;
  path: string;
}): SessionDecision {
  const { session, user, allowed, now, path } = input;
  if (!session || !user) return 'login';
  const role = user.appRole as AppRole;
  if (!allowed.includes(role)) return 'forbidden';
  const staff = role === 'admin' || role === 'nutri';
  if (staff && now.getTime() - new Date(session.updatedAt).getTime() > STAFF_IDLE_MS) return 'expired';
  if (role === 'admin' && !user.twoFactorEnabled && path !== SECURITY_PATH) return 'setup-2fa';
  return 'ok';
}
```

Run: `pnpm test src/lib/session-rules.test.ts` → PASS (7 testes).

- [ ] **Step 10: `requireUser` e rota do Better Auth**

`src/lib/session.ts`:

```ts
import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from './auth';
import { evaluateSession, homeFor, SECURITY_PATH, type AppRole } from './session-rules';

export async function requireUser(allowed: readonly AppRole[], path: string) {
  const h = await headers();
  const auth = getAuth();
  const data = await auth.api.getSession({ headers: h });
  const decision = evaluateSession({
    session: data?.session ?? null,
    user: data?.user ?? null,
    allowed,
    now: new Date(),
    path,
  });
  switch (decision) {
    case 'ok':
      return data!;
    case 'login':
      redirect(`/entrar?volta=${encodeURIComponent(path)}`);
    case 'expired':
      await auth.api.signOut({ headers: h });
      redirect('/entrar?expirada=1');
    case 'setup-2fa':
      redirect(SECURITY_PATH);
    case 'forbidden':
      redirect(homeFor(data!.user.appRole as AppRole));
  }
}
```

`src/app/api/auth/[...all]/route.ts`:

```ts
import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const GET = (req: Request) => toNextJsHandler(getAuth()).GET(req);
export const POST = (req: Request) => toNextJsHandler(getAuth()).POST(req);
```

- [ ] **Step 11: Testes de integração da autenticação** — `src/lib/auth.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { account, user } from '@/db/schema';
import { createAuth } from './auth';
import { hashPassword } from './password.server';
import { setPasswordLinkSink } from './password-links';

const app = makeDb(inject('appDatabaseUrl'));
const auth = createAuth(app.db);
const email = `admin-${randomUUID().slice(0, 8)}@teste.dev`;
const senha = 'Nutri2026segura';

const post = (path: string, body: unknown, ip: string) =>
  auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    }),
  );

beforeAll(async () => {
  const id = randomUUID();
  await app.db.insert(user).values({ id, name: 'Admin', email, emailVerified: true, appRole: 'admin' });
  await app.db.insert(account).values({
    id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha),
  });
});
afterAll(() => app.pool.end());

describe('Better Auth (US-002, RNF-06)', () => {
  it('guarda a senha em argon2id', async () => {
    const [row] = await app.db.select({ p: account.password }).from(account).innerJoin(user, eq(user.id, account.userId)).where(eq(user.email, email));
    expect(row.p).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('login com senha correta devolve sessão', async () => {
    const res = await post('/sign-in/email', { email, password: senha }, '10.0.0.1');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/nd\.session_token=/);
  });

  it('cadastro público está desativado', async () => {
    const res = await post('/sign-up/email', { email: 'x@y.dev', password: senha, name: 'X' }, '10.0.0.2');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('bloqueia a 6ª tentativa em 15 min no mesmo IP com HTTP 429', async () => {
    const ip = '10.0.0.3';
    for (let i = 0; i < 5; i++) await post('/sign-in/email', { email, password: 'errada-123456' }, ip);
    const sexta = await post('/sign-in/email', { email, password: senha }, ip);
    expect(sexta.status).toBe(429);
  });

  it('recuperação de senha responde igual para e-mail inexistente e não vaza o link no log', async () => {
    const links: string[] = [];
    const restore = setPasswordLinkSink(({ url }) => { links.push(url); });
    try {
      const a = await post('/request-password-reset', { email, redirectTo: '/definir-senha' }, '10.0.0.4');
      const b = await post('/request-password-reset', { email: 'ninguem@teste.dev', redirectTo: '/definir-senha' }, '10.0.0.4');
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(links).toHaveLength(1);
    } finally {
      restore();
    }
  });

  it('recusa nova senha fora da política na redefinição', async () => {
    let url = '';
    const restore = setPasswordLinkSink((l) => { url = l.url; });
    await post('/request-password-reset', { email, redirectTo: '/definir-senha' }, '10.0.0.5');
    restore();
    const token = new URL(url).pathname.split('/').pop()!;
    const res = await post('/reset-password', { newPassword: 'curta1', token }, '10.0.0.5');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ message: 'A senha precisa ter pelo menos 10 caracteres.' });
  });
});
```

O formato do link de reset do Better Auth é `${APP_URL}/api/auth/reset-password/<token>?callbackURL=...`; o `pop()` do pathname pega o token.

- [ ] **Step 12: Rodar e ver passar**

Run: `pnpm test src/lib`
Expected: PASS em `password-policy`, `session-rules` e `auth` (6 testes de integração). Se `sign-up` retornar 404 em vez de 400, o teste já cobre com `>= 400`.

- [ ] **Step 13: Commit**

```bash
git add src/lib src/db drizzle src/app/api/auth vitest.config.ts test
git commit -m "feat(auth): Better Auth com argon2id, política de senha, limite de tentativas e regras de sessão"
```

---

### Task 7: Verificação em duas etapas (P01-07)

**Files:**
- Create: `src/lib/auth-client.ts`, `src/app/conta/seguranca/page.tsx`, `src/app/conta/seguranca/enable-2fa.tsx`, `src/lib/two-factor.test.ts`

**Interfaces:**
- Consumes: `createAuth`, `requireUser`, `SECURITY_PATH`.
- Produces: `authClient` em `@/lib/auth-client` (com `twoFactorClient` e `inferAdditionalFields<Auth>`); página `/conta/seguranca`.

- [ ] **Step 1: Teste de integração que falha** — `src/lib/two-factor.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { TOTP } from 'otpauth';
import { makeDb } from '../../test/db';
import { account, twoFactor, user } from '@/db/schema';
import { createAuth } from './auth';
import { hashPassword } from './password.server';

const app = makeDb(inject('appDatabaseUrl'));
const auth = createAuth(app.db);
const email = `twofa-${randomUUID().slice(0, 8)}@teste.dev`;
const senha = 'Nutri2026segura';
let cookie = '';

const call = (path: string, body: unknown, ip = '10.1.0.1') =>
  auth.handler(new Request(`http://localhost:3000/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, origin: 'http://localhost:3000', cookie },
    body: JSON.stringify(body),
  }));
const cookiesOf = (res: Response) =>
  res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

beforeAll(async () => {
  const id = randomUUID();
  await app.db.insert(user).values({ id, name: 'Admin', email, emailVerified: true, appRole: 'admin' });
  await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
  cookie = cookiesOf(await call('/sign-in/email', { email, password: senha }));
});
afterAll(() => app.pool.end());

describe('2FA TOTP (US-003)', () => {
  let secret = '';
  it('ativar gera URI TOTP e 10 códigos de recuperação', async () => {
    const res = await call('/two-factor/enable', { password: senha });
    const body = await res.json();
    expect(body.backupCodes).toHaveLength(10);
    secret = new URL(body.totpURI).searchParams.get('secret')!;
    expect(secret).toBeTruthy();
  });

  it('confirmar com código correto ativa o 2FA', async () => {
    const code = new TOTP({ secret, digits: 6, period: 30 }).generate();
    const res = await call('/two-factor/verify-totp', { code });
    expect(res.status).toBe(200);
    const [u] = await app.db.select({ on: user.twoFactorEnabled }).from(user).where(eq(user.email, email));
    expect(u.on).toBe(true);
  });

  it('o segredo não fica em texto puro no banco', async () => {
    const [row] = await app.db.select({ s: twoFactor.secret }).from(twoFactor).innerJoin(user, eq(user.id, twoFactor.userId)).where(eq(user.email, email));
    expect(row.s).not.toBe(secret);
  });

  it('login com 2FA ativo pede o código antes de criar a sessão', async () => {
    cookie = '';
    const res = await call('/sign-in/email', { email, password: senha }, '10.1.0.2');
    expect(await res.json()).toMatchObject({ twoFactorRedirect: true });
  });
});
```

- [ ] **Step 2: Rodar e ver o resultado**

Run: `pnpm test src/lib/two-factor.test.ts`
Expected: PASS se o plugin `twoFactor` da Tarefa 6 estiver ativo (as tabelas já existem). Se algum nome de coluna do schema gerado divergir (`twoFactor.secret`, `user.twoFactorEnabled`), ajuste o teste ao nome gerado — não o schema.

- [ ] **Step 3: Cliente de autenticação** — `src/lib/auth-client.ts`

```ts
'use client';
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields, twoFactorClient } from 'better-auth/client/plugins';
import type { Auth } from './auth';

export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields<Auth>(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = '/entrar/2fa';
      },
    }),
  ],
});
```

- [ ] **Step 4: Tela de segurança** — `src/app/conta/seguranca/page.tsx`

```tsx
import { requireUser } from '@/lib/session';
import { SECURITY_PATH } from '@/lib/session-rules';
import { Enable2fa } from './enable-2fa';

export const dynamic = 'force-dynamic';

export default async function SegurancaPage() {
  const { user } = await requireUser(['admin', 'nutri'], SECURITY_PATH);
  return (
    <main className="mx-auto max-w-lg p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Segurança da conta</h1>
      {user.twoFactorEnabled ? (
        <p>A verificação em duas etapas está ativa.</p>
      ) : (
        <>
          {user.appRole === 'admin' && (
            <p role="alert" className="rounded bg-amber-100 p-3 text-amber-900">
              Para usar a administração, ative a verificação em duas etapas.
            </p>
          )}
          <Enable2fa />
        </>
      )}
    </main>
  );
}
```

`src/app/conta/seguranca/enable-2fa.tsx`:

```tsx
'use client';
import { useState } from 'react';
import QRCode from 'qrcode';
import { authClient } from '@/lib/auth-client';

export function Enable2fa() {
  const [step, setStep] = useState<'senha' | 'codigo' | 'codigos'>('senha');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [backup, setBackup] = useState<string[]>([]);
  const [erro, setErro] = useState('');

  async function iniciar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    const { data, error } = await authClient.twoFactor.enable({ password });
    if (error || !data) return setErro('Senha incorreta.');
    setSecret(new URL(data.totpURI).searchParams.get('secret') ?? '');
    setQr(await QRCode.toDataURL(data.totpURI));
    setBackup(data.backupCodes);
    setStep('codigo');
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    if (error) return setErro('Código inválido. Confira o horário do celular e tente de novo.');
    setStep('codigos');
  }

  if (step === 'senha')
    return (
      <form onSubmit={iniciar} className="space-y-3">
        <label htmlFor="senha" className="block">Confirme sua senha</label>
        <input id="senha" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border p-2" />
        {erro && <p role="alert" className="text-red-700">{erro}</p>}
        <button className="rounded bg-emerald-700 px-4 py-2 text-white">Ativar verificação em duas etapas</button>
      </form>
    );

  if (step === 'codigo')
    return (
      <form onSubmit={confirmar} className="space-y-3">
        <p>Leia o QR Code no app autenticador (Google Authenticator, Authy, 1Password…).</p>
        {qr && <img src={qr} alt="QR Code para o app autenticador" width={200} height={200} />}
        <p className="text-sm">Ou digite a chave: <code data-testid="totp-secret">{secret}</code></p>
        <label htmlFor="codigo" className="block">Código de 6 dígitos</label>
        <input id="codigo" inputMode="numeric" pattern="[0-9]{6}" required value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded border p-2" />
        {erro && <p role="alert" className="text-red-700">{erro}</p>}
        <button className="rounded bg-emerald-700 px-4 py-2 text-white">Confirmar</button>
      </form>
    );

  return (
    <div className="space-y-3">
      <p role="status">Verificação em duas etapas ativada.</p>
      <p>Guarde estes códigos de recuperação. Cada um funciona uma vez, e eles não serão mostrados de novo.</p>
      <ul data-testid="backup-codes" className="grid grid-cols-2 gap-1 font-mono">
        {backup.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <a href="/inicio" className="inline-block rounded bg-emerald-700 px-4 py-2 text-white">Continuar</a>
    </div>
  );
}
```

- [ ] **Step 5: Verificação de tipos e commit**

Run: `pnpm typecheck && pnpm test src/lib/two-factor.test.ts`
Expected: sem erros de tipo; PASS (4 testes).

```bash
git add src/lib/auth-client.ts src/lib/two-factor.test.ts src/app/conta
git commit -m "feat(auth): ativação de 2FA TOTP com códigos de recuperação; obrigatório para admin"
```

---

### Task 8: Telas de acesso, proxy e testes E2E (P01-08)

**Files:**
- Create: `src/lib/safe-return.ts`, `src/lib/safe-return.test.ts`, `src/proxy.ts`, `src/app/page.tsx` (substitui o gerado), `src/app/inicio/page.tsx`, `src/app/entrar/page.tsx`, `src/app/entrar/2fa/page.tsx`, `src/app/esqueci-senha/page.tsx`, `src/app/definir-senha/page.tsx`, `src/app/admin/page.tsx`, `src/app/painel/page.tsx`, `src/app/p/page.tsx`, `playwright.config.ts`, `scripts/e2e-seed.ts`, `e2e/auth.spec.ts`
- Modify: `src/app/layout.tsx` (`lang="pt-BR"`, título "NutriDebby")

**Interfaces:**
- Consumes: `authClient`, `requireUser`, `homeFor`, `validatePasswordPolicy`, `hashPassword`, `getDb`, schema `user`/`account`.
- Produces: `safeReturnPath(v: string | null | undefined): string | null` em `@/lib/safe-return`; rotas públicas `/entrar`, `/entrar/2fa`, `/esqueci-senha`, `/definir-senha`; rotas protegidas `/inicio`, `/admin`, `/painel`, `/p`.

- [ ] **Step 1: Teste que falha (Review Focus 3)** — `src/lib/safe-return.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { safeReturnPath } from './safe-return';

describe('safeReturnPath', () => {
  it.each([
    ['/admin', '/admin'],
    ['/painel?x=1', '/painel?x=1'],
    ['//evil.com', null],
    ['https://evil.com', null],
    ['/\\evil.com', null],
    ['javascript:alert(1)', null],
    ['', null],
    [null, null],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });
});
```

Run: `pnpm test src/lib/safe-return.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 2: Implementar** — `src/lib/safe-return.ts`

```ts
export function safeReturnPath(v: string | null | undefined): string | null {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return null;
  try {
    const u = new URL(v, 'http://interno.invalid');
    return u.origin === 'http://interno.invalid' ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}
```

Run de novo → PASS (8 casos).

- [ ] **Step 3: Proxy** — `src/proxy.ts`

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

const PROTECTED = ['/admin', '/painel', '/p', '/conta', '/inicio'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !getSessionCookie(req, { cookiePrefix: 'nd' })) {
    const url = new URL('/entrar', req.url);
    url.searchParams.set('volta', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/|serwist/|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)'],
};
```

O proxy é só a primeira barreira (cookie presente). A autorização real é o `requireUser` em cada página protegida.

- [ ] **Step 4: Páginas protegidas**

`src/app/inicio/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { homeFor, type AppRole } from '@/lib/session-rules';

export const dynamic = 'force-dynamic';

export default async function Inicio() {
  const { user } = await requireUser(['admin', 'nutri', 'paciente'], '/inicio');
  redirect(homeFor(user.appRole as AppRole));
}
```

`src/app/admin/page.tsx` (e análogos `painel/page.tsx` com `['nutri']`/`'/painel'`/"Painel da nutricionista" e `p/page.tsx` com `['paciente']`/`'/p'`/"Meu acompanhamento"):

```tsx
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const { user } = await requireUser(['admin'], '/admin');
  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Administração</h1>
      <p>Conectado como {user.email}.</p>
    </main>
  );
}
```

`src/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation';
export default function Home() {
  redirect('/entrar');
}
```

- [ ] **Step 5: Páginas públicas de acesso**

`src/app/entrar/page.tsx`:

```tsx
'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { safeReturnPath } from '@/lib/safe-return';

function Form() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [erro, setErro] = useState(params.get('expirada') ? 'Sua sessão expirou. Entre de novo.' : '');
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    const { data, error } = await authClient.signIn.email({ email, password });
    setEnviando(false);
    if (error) {
      return setErro(error.status === 429 ? 'Muitas tentativas. Tente novamente em 15 minutos.' : 'E-mail ou senha incorretos.');
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) return; // onTwoFactorRedirect cuida
    router.push(safeReturnPath(params.get('volta')) ?? '/inicio');
  }

  return (
    <form onSubmit={entrar} className="space-y-3">
      <label htmlFor="email" className="block">E-mail</label>
      <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border p-2" />
      <label htmlFor="password" className="block">Senha</label>
      <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded border p-2" />
      {erro && <p role="alert" className="text-red-700">{erro}</p>}
      <button disabled={enviando} className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Entrar</button>
      <a href="/esqueci-senha" className="block text-sm underline">Esqueci minha senha</a>
    </form>
  );
}

export default function EntrarPage() {
  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Entrar</h1>
      <Suspense><Form /></Suspense>
    </main>
  );
}
```

`src/app/entrar/2fa/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export default function DoisFatoresPage() {
  const [code, setCode] = useState('');
  const [usarRecuperacao, setUsarRecuperacao] = useState(false);
  const [erro, setErro] = useState('');

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    const { error } = usarRecuperacao
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice: false });
    if (error) {
      return setErro(error.status === 429 ? 'Muitas tentativas. Tente novamente em 15 minutos.' : 'Código inválido.');
    }
    window.location.href = '/inicio';
  }

  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Verificação em duas etapas</h1>
      <form onSubmit={verificar} className="space-y-3">
        <label htmlFor="code" className="block">{usarRecuperacao ? 'Código de recuperação' : 'Código do app autenticador'}</label>
        <input id="code" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded border p-2" />
        {erro && <p role="alert" className="text-red-700">{erro}</p>}
        <button className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Verificar</button>
      </form>
      <button type="button" onClick={() => setUsarRecuperacao(!usarRecuperacao)} className="text-sm underline">
        {usarRecuperacao ? 'Usar o app autenticador' : 'Usar um código de recuperação'}
      </button>
    </main>
  );
}
```

`src/app/esqueci-senha/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    await authClient.requestPasswordReset({ email, redirectTo: '/definir-senha' });
    setEnviado(true); // mesma resposta para qualquer e-mail (US-002)
  }

  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Recuperar senha</h1>
      {enviado ? (
        <p role="status">Se o e-mail estiver cadastrado, você receberá um link</p>
      ) : (
        <form onSubmit={enviar} className="space-y-3">
          <label htmlFor="email" className="block">E-mail</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border p-2" />
          <button className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Enviar link</button>
        </form>
      )}
    </main>
  );
}
```

`src/app/definir-senha/page.tsx`:

```tsx
'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { validatePasswordPolicy } from '@/lib/password-policy';

function Form() {
  const params = useSearchParams();
  const token = params.get('token');
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState(params.get('error') ? 'Link inválido ou expirado. Peça um novo.' : '');
  const [ok, setOk] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const local = validatePasswordPolicy(senha);
    if (local) return setErro(local);
    if (senha !== confirma) return setErro('As senhas não conferem.');
    const { error } = await authClient.resetPassword({ newPassword: senha, token: token ?? '' });
    if (error) return setErro(error.message ?? 'Link inválido ou expirado. Peça um novo.');
    setOk(true);
  }

  if (ok) return <p role="status">Senha definida. <a href="/entrar" className="underline">Entrar</a></p>;
  if (!token) return <p role="alert">Link inválido ou expirado. Peça um novo.</p>;
  return (
    <form onSubmit={salvar} className="space-y-3">
      <p className="text-sm">Mínimo de 10 caracteres, com pelo menos 1 letra e 1 número.</p>
      <label htmlFor="senha" className="block">Nova senha</label>
      <input id="senha" type="password" autoComplete="new-password" required value={senha} onChange={(e) => setSenha(e.target.value)} className="w-full rounded border p-2" />
      <label htmlFor="confirma" className="block">Repita a senha</label>
      <input id="confirma" type="password" autoComplete="new-password" required value={confirma} onChange={(e) => setConfirma(e.target.value)} className="w-full rounded border p-2" />
      {erro && <p role="alert" className="text-red-700">{erro}</p>}
      <button className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Definir senha</button>
    </form>
  );
}

export default function DefinirSenhaPage() {
  return (
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Definir senha</h1>
      <Suspense><Form /></Suspense>
    </main>
  );
}
```

- [ ] **Step 6: Seed e configuração do E2E**

`scripts/e2e-seed.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { account, user } from '@/db/schema';
import { hashPassword } from '@/lib/password.server';

export const E2E_ADMIN = { email: 'admin-e2e@nutridebby.test', password: 'Nutri2026segura' };

const db = getDb();
await db.delete(user).where(eq(user.email, E2E_ADMIN.email));
const id = randomUUID();
await db.insert(user).values({ id, name: 'Admin E2E', email: E2E_ADMIN.email, emailVerified: true, appRole: 'admin' });
await db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(E2E_ADMIN.password) });
await closeDb();
console.log('Seed E2E pronto.');
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:3000/entrar',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
```

- [ ] **Step 7: Testes E2E** — `e2e/auth.spec.ts`

```ts
import { expect, test } from '@playwright/test';
import { TOTP } from 'otpauth';

const ADMIN = { email: 'admin-e2e@nutridebby.test', password: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

test('rota protegida sem sessão vai para /entrar', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/entrar\?volta=%2Fadmin/);
});

test('admin sem 2FA é obrigado a ativar e depois chega à administração', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.0.1' } });
  const page = await ctx.newPage();
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/conta\/seguranca/);
  await page.getByLabel('Confirme sua senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Código de 6 dígitos').fill(new TOTP({ secret }).generate());
  await page.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByTestId('backup-codes').locator('li')).toHaveCount(10);
  await page.getByRole('link', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible();
  await ctx.close();
});

test('senha errada 5 vezes bloqueia com a mensagem da spec', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.0.2' } });
  const page = await ctx.newPage();
  await page.goto('/entrar');
  for (let i = 0; i < 6; i++) {
    await page.getByLabel('E-mail').fill(ADMIN.email);
    await page.getByLabel('Senha').fill(`errada-${i}-123456`);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  }
  await expect(page.getByRole('alert')).toHaveText('Muitas tentativas. Tente novamente em 15 minutos.');
  await ctx.close();
});

test('?volta externo não redireciona para fora (Review Focus 3)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.0.3' } });
  const page = await ctx.newPage();
  await page.goto('/entrar?volta=//evil.com');
  await page.getByLabel('E-mail').fill(ADMIN.email);
  await page.getByLabel('Senha').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/entrar\/2fa/); // admin já tem 2FA: nunca sai do domínio
  await ctx.close();
});
```

- [ ] **Step 8: Rodar E2E localmente**

```bash
pnpm exec playwright install chromium
pnpm e2e:seed && pnpm build && pnpm test:e2e
```

Expected: 4 testes PASS. (Rodar `pnpm e2e:seed` antes de cada execução: o teste de 2FA ativa o 2FA do admin de teste.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/safe-return* src/proxy.ts src/app playwright.config.ts scripts/e2e-seed.ts e2e
git commit -m "feat(auth): telas de login, 2FA e senha; proxy; E2E do fluxo de acesso"
```

---

### Task 9: CLI `pnpm admin:criar` (P01-09)

**Files:**
- Create: `src/modules/plataforma/admin-bootstrap.ts`, `src/modules/plataforma/admin-bootstrap.test.ts`, `scripts/admin-criar.ts`

**Interfaces:**
- Consumes: `normalizeEmail`, `createAuth`/`getAuth`, `setPasswordLinkSink`, schema `user`.
- Produces: `createAdmin(email: string, deps?: { db: Db; auth: Auth }): Promise<{ userId: string; link: string }>` e `class AdminBootstrapError extends Error`.

- [ ] **Step 1: Teste que falha** — `src/modules/plataforma/admin-bootstrap.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { user } from '@/db/schema';
import { createAuth } from '@/lib/auth';
import { AdminBootstrapError, createAdmin } from './admin-bootstrap';

const app = makeDb(inject('appDatabaseUrl'));
const deps = { db: app.db, auth: createAuth(app.db) };
afterAll(() => app.pool.end());

describe('createAdmin (US-001, cenário "Primeiro admin")', () => {
  it('normaliza o e-mail, cria admin sem senha e devolve link de definição (Review Focus 4)', async () => {
    const r = await createAdmin('  Primeiro.Admin@Exemplo.COM ', deps);
    const [u] = await app.db.select().from(user).where(eq(user.id, r.userId));
    expect(u.email).toBe('primeiro.admin@exemplo.com');
    expect(u.appRole).toBe('admin');
    expect(u.tenantId).toBeNull();
    expect(r.link).toMatch(/^http:\/\/localhost:3000\/api\/auth\/reset-password\/.+callbackURL=%2Fdefinir-senha/);
  });

  it('recusa e-mail já cadastrado', async () => {
    await expect(createAdmin('primeiro.admin@exemplo.com', deps)).rejects.toThrow('Já existe um usuário com este e-mail');
  });

  it('recusa e-mail inválido', async () => {
    await expect(createAdmin('nao-e-email', deps)).rejects.toBeInstanceOf(AdminBootstrapError);
  });
});
```

Run: `pnpm test src/modules` → FAIL (módulo inexistente).

- [ ] **Step 2: Implementar** — `src/modules/plataforma/admin-bootstrap.ts`

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { user } from '@/db/schema';
import { getAuth, type Auth } from '@/lib/auth';
import { setPasswordLinkSink } from '@/lib/password-links';
import { normalizeEmail } from '@/lib/text';

export class AdminBootstrapError extends Error {
  override name = 'AdminBootstrapError';
}

export async function createAdmin(
  rawEmail: string,
  deps: { db: Db; auth: Auth } = { db: getDb(), auth: getAuth() },
): Promise<{ userId: string; link: string }> {
  const email = normalizeEmail(rawEmail);
  if (!z.email().safeParse(email).success) throw new AdminBootstrapError('E-mail inválido');

  const existing = await deps.db.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing.length) throw new AdminBootstrapError('Já existe um usuário com este e-mail');

  const userId = randomUUID();
  await deps.db.insert(user).values({ id: userId, name: 'Administrador', email, emailVerified: true, appRole: 'admin' });

  let link = '';
  const restore = setPasswordLinkSink(({ url }) => {
    link = url;
  });
  try {
    await deps.auth.api.requestPasswordReset({ body: { email, redirectTo: '/definir-senha' } });
  } finally {
    restore();
  }
  if (!link) throw new AdminBootstrapError('Não foi possível gerar o link de definição de senha');
  return { userId, link };
}
```

`scripts/admin-criar.ts`:

```ts
import { closeDb } from '@/db/client';
import { AdminBootstrapError, createAdmin } from '@/modules/plataforma/admin-bootstrap';

const email = process.argv[2];
if (!email) {
  console.error('Uso: pnpm admin:criar <email>');
  process.exit(1);
}
try {
  const { link } = await createAdmin(email);
  console.log('Admin criado. Abra o link abaixo para definir a senha (válido por 1 hora, uso único):');
  console.log(link);
  console.log('No primeiro acesso, a verificação em duas etapas será obrigatória.');
} catch (e) {
  console.error(e instanceof AdminBootstrapError ? e.message : 'Erro inesperado ao criar admin');
  process.exitCode = 1;
} finally {
  await closeDb();
}
```

- [ ] **Step 3: Rodar e ver passar**

Run: `pnpm test src/modules`
Expected: PASS (3 testes).

- [ ] **Step 4: Testar o CLI no dev**

Run: `pnpm admin:criar voce@exemplo.com`
Expected: imprime o link; abrir no navegador leva a `/definir-senha?token=…`.

- [ ] **Step 5: Commit**

```bash
git add src/modules scripts/admin-criar.ts
git commit -m "feat(plataforma): CLI admin:criar com link de definição de senha"
```

---

### Task 10: Logger, worker com heartbeat e `/api/health` (P01-10)

**Files:**
- Create: `src/lib/logger.ts`, `src/worker/heartbeat.ts`, `src/worker/heartbeat.test.ts`, `src/worker/index.ts`, `src/app/api/health/route.ts`

**Interfaces:**
- Consumes: `getDb()`, `systemHeartbeat`, `getEnv()`.
- Produces:
  - `logger` (pino) em `@/lib/logger`.
  - `recordHeartbeat(db: Db, now?: Date): Promise<void>`, `evaluateHealth({ dbOk, lastBeat, now }): { status: 'ok' | 'degradado'; reason?: string }`, `HEARTBEAT_MAX_AGE_MS = 10 * 60 * 1000` em `@/worker/heartbeat`.
  - `startWorker(connectionString: string): Promise<() => Promise<void>>` em `@/worker/index` (retorna função de parada).

- [ ] **Step 1: Teste que falha (Review Focus 5)** — `src/worker/heartbeat.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { systemHeartbeat } from '@/db/schema';
import { evaluateHealth, HEARTBEAT_MAX_AGE_MS, recordHeartbeat } from './heartbeat';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const now = new Date('2026-10-01T12:00:00Z');

describe('heartbeat e health (RNF-04)', () => {
  it('ok com banco no ar e heartbeat recente', () => {
    expect(evaluateHealth({ dbOk: true, lastBeat: new Date(now.getTime() - 60_000), now })).toEqual({ status: 'ok' });
  });
  it('degradado com heartbeat mais velho que 10 min', () => {
    expect(evaluateHealth({ dbOk: true, lastBeat: new Date(now.getTime() - HEARTBEAT_MAX_AGE_MS - 1), now })).toEqual({ status: 'degradado', reason: 'worker sem heartbeat há mais de 10 min' });
  });
  it('degradado sem nenhum heartbeat', () => {
    expect(evaluateHealth({ dbOk: true, lastBeat: null, now })).toEqual({ status: 'degradado', reason: 'worker sem heartbeat' });
  });
  it('degradado com banco fora do ar', () => {
    expect(evaluateHealth({ dbOk: false, lastBeat: now, now })).toEqual({ status: 'degradado', reason: 'banco indisponível' });
  });
  it('recordHeartbeat grava e atualiza a linha do worker', async () => {
    await recordHeartbeat(app.db, now);
    await recordHeartbeat(app.db, new Date(now.getTime() + 60_000));
    const [row] = await app.db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, 'worker'));
    expect(row.beatAt.toISOString()).toBe('2026-10-01T12:01:00.000Z');
  });
});
```

Run: `pnpm test src/worker` → FAIL.

- [ ] **Step 2: Implementar** — `src/worker/heartbeat.ts`

```ts
import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { systemHeartbeat } from '@/db/schema';

export const HEARTBEAT_MAX_AGE_MS = 10 * 60 * 1000;

export async function recordHeartbeat(db: Db, now: Date = new Date()): Promise<void> {
  await db
    .insert(systemHeartbeat)
    .values({ name: 'worker', beatAt: now })
    .onConflictDoUpdate({ target: systemHeartbeat.name, set: { beatAt: sql`excluded.beat_at` } });
}

export function evaluateHealth(i: { dbOk: boolean; lastBeat: Date | null; now: Date }):
  { status: 'ok' | 'degradado'; reason?: string } {
  if (!i.dbOk) return { status: 'degradado', reason: 'banco indisponível' };
  if (!i.lastBeat) return { status: 'degradado', reason: 'worker sem heartbeat' };
  if (i.now.getTime() - i.lastBeat.getTime() > HEARTBEAT_MAX_AGE_MS) {
    return { status: 'degradado', reason: 'worker sem heartbeat há mais de 10 min' };
  }
  return { status: 'ok' };
}
```

Run: `pnpm test src/worker` → PASS (5 testes).

- [ ] **Step 3: Logger** — `src/lib/logger.ts`

```ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'nutridebby' },
  redact: {
    paths: ['password', 'newPassword', 'token', 'url', '*.password', '*.newPassword', '*.token', 'req.headers.cookie', 'req.headers.authorization'],
    censor: '[removido]',
  },
});
```

- [ ] **Step 4: Worker** — `src/worker/index.ts`

```ts
import { PgBoss } from 'pg-boss';
import { closeDb, getDb } from '@/db/client';
import { getEnv } from '@/env';
import { logger } from '@/lib/logger';
import { recordHeartbeat } from './heartbeat';

export async function startWorker(connectionString: string): Promise<() => Promise<void>> {
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss erro'));
  await boss.start();

  await boss.createQueue('heartbeat', { retryLimit: 0, expireInSeconds: 60 });
  await boss.schedule('heartbeat', '* * * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('heartbeat', async () => {
    await recordHeartbeat(getDb());
  });

  await recordHeartbeat(getDb()); // batida imediata ao subir
  logger.info('worker iniciado');
  return async () => {
    await boss.stop({ graceful: true, timeout: 30_000 });
    await closeDb();
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stop = await startWorker(getEnv().DATABASE_URL);
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'encerrando worker');
    await stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
```

- [ ] **Step 5: Health** — `src/app/api/health/route.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { systemHeartbeat } from '@/db/schema';
import { evaluateHealth } from '@/worker/heartbeat';

export const dynamic = 'force-dynamic';

export async function GET() {
  let dbOk = false;
  let lastBeat: Date | null = null;
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    dbOk = true;
    const [row] = await db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, 'worker'));
    lastBeat = row?.beatAt ?? null;
  } catch {
    dbOk = false;
  }
  const result = evaluateHealth({ dbOk, lastBeat, now: new Date() });
  return Response.json(result, { status: result.status === 'ok' ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
```

- [ ] **Step 6: Verificar no dev**

```bash
pnpm dev &          # terminal 1
pnpm worker &       # terminal 2
sleep 5 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/health
```

Expected: `200`. Pare o worker e ajuste manualmente `beat_at` para 11 min atrás no banco de dev (`update system_heartbeat set beat_at = now() - interval '11 minutes'` via `psql` ou Postgres MCP em modo dev) → `503`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/logger.ts src/worker src/app/api/health
git commit -m "feat(worker): pg-boss com heartbeat e /api/health que detecta worker parado"
```

---

### Task 11: Imagem Docker (P01-11)

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-entrypoint.sh`

**Interfaces:**
- Produces: imagem com modos `app` (migra e sobe o Next na porta 3000), `worker` e `admin:criar <email>`, selecionados pelo primeiro argumento **ou** pela variável `APP_ROLE`.

- [ ] **Step 1: `.dockerignore`**

```
.git
node_modules
.next
.env*
!.env.example
e2e
test-results
playwright-report
coverage
docs
```

- [ ] **Step 2: `docker-entrypoint.sh`**

```sh
#!/bin/sh
set -eu
MODE="${1:-${APP_ROLE:-app}}"
[ "$#" -gt 0 ] && shift
case "$MODE" in
  app)
    node --import tsx scripts/migrate.ts
    exec node_modules/.bin/next start -p "${PORT:-3000}"
    ;;
  worker)
    exec node --import tsx src/worker/index.ts
    ;;
  admin:criar)
    exec node --import tsx scripts/admin-criar.ts "$@"
    ;;
  *)
    exec "$MODE" "$@"
    ;;
esac
```

`chmod +x docker-entrypoint.sh`

- [ ] **Step 3: `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Valores só para o build (nenhuma conexão é aberta no build); não vão para a imagem final
ENV APP_URL=http://build.invalid \
    DATABASE_URL=postgres://build_app:x@127.0.0.1:1/build \
    DATABASE_URL_MIGRATOR=postgres://build_owner:x@127.0.0.1:1/build \
    AUTH_SECRET=build-only-secret-build-only-secret-00
RUN pnpm build && pnpm prune --prod

FROM base AS runner
ENV NODE_ENV=production PORT=3000
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
```

- [ ] **Step 4: Verificar a imagem** (build pesado: rodar fora do horário de pico ou deixar para o CI — ver Tarefa 12)

```bash
docker build -t nutridebby:local .
docker run --rm --network host --env-file .env.local nutridebby:local worker &
docker run --rm --network host --env-file .env.local -e PORT=3001 nutridebby:local app &
sleep 20 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health
docker ps --filter ancestor=nutridebby:local -q | xargs -r docker stop
```

Expected: `200`.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-entrypoint.sh
git commit -m "build: imagem Docker única com modos app, worker e admin:criar"
```

---

### Task 12: CI e deploy (P01-12)

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: scripts `lint`, `typecheck`, `test`, `db:migrate`, `e2e:seed`, `build`, `test:e2e`; `Dockerfile`.
- Produces: imagem `ghcr.io/<owner>/<repo>:<sha>` e `:latest`; chamada aos webhooks `EASYPANEL_DEPLOY_HOOK_APP` e `EASYPANEL_DEPLOY_HOOK_WORKER` (secrets do repositório).

- [ ] **Step 1: `.github/workflows/ci.yml`**

```yaml
name: ci
on:
  pull_request:
  workflow_call:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm test   # inclui a guarda de RLS (Testcontainers usa o Docker do runner)

  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: owner, POSTGRES_PASSWORD: owner, POSTGRES_DB: nutri }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U owner -d nutri" --health-interval 5s --health-timeout 5s --health-retries 20
    env:
      NODE_ENV: production
      APP_URL: http://localhost:3000
      DATABASE_URL: postgres://nutri_app:ci-app@localhost:5432/nutri
      DATABASE_URL_MIGRATOR: postgres://owner:owner@localhost:5432/nutri
      AUTH_SECRET: ci-secret-with-at-least-32-characters-long
      CI: 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm db:migrate
      - run: pnpm e2e:seed
      - run: pnpm build
      - run: pnpm test:e2e
      - if: failure()
        uses: actions/upload-artifact@v4
        with: { name: playwright-report, path: playwright-report }

  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: `.github/workflows/deploy.yml`**

```yaml
name: deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  packages: write
concurrency:
  group: deploy-main
  cancel-in-progress: false

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  publish:
    needs: ci
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Nome da imagem em minúsculas
        run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ${{ env.IMAGE }}:${{ github.sha }}
            ${{ env.IMAGE }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Disparar deploy no Easypanel
        env:
          HOOK_APP: ${{ secrets.EASYPANEL_DEPLOY_HOOK_APP }}
          HOOK_WORKER: ${{ secrets.EASYPANEL_DEPLOY_HOOK_WORKER }}
        run: |
          test -n "$HOOK_APP" && test -n "$HOOK_WORKER" || { echo "Webhooks do Easypanel não configurados"; exit 1; }
          curl -fsS -X POST "$HOOK_APP" > /dev/null
          curl -fsS -X POST "$HOOK_WORKER" > /dev/null
```

- [ ] **Step 3: Publicar o branch e abrir o PR**

Pré-requisito: E-01 (repositório no GitHub). Adicione o remoto e publique:

```bash
git remote add origin git@github.com:<owner>/nutridebby.git   # URL fornecida pelo dono
git push -u origin plano-01-fundacao
gh pr create --title "Plano 01 — Fundação" --body "Implementa P01-01 a P01-15. Ver docs/superpowers/plans/2026-09-27-nutridebby-01-fundacao.md"
```

Expected: jobs `quality`, `test`, `e2e` e `image` verdes no PR.

- [ ] **Step 4: Commit**

```bash
git add .github
git commit -m "ci: lint, tipos, testes com RLS, E2E, build da imagem e deploy GHCR → Easypanel"
git push
```

---

### Task 13: Configuração no Easypanel e primeiro deploy (P01-13)

Esta tarefa é feita **pelo dono no painel do Easypanel** (regra do servidor), com o desenvolvedor guiando e verificando. **Antes de começar: tirar snapshot da VPS no hPanel** (regra 5 do servidor).

**Files:** nenhum no repositório (só a nota de verificação no PR).

- [ ] **Step 1: Criar os serviços no projeto `nutri`** (E-03)

| Serviço | Tipo | Configuração |
|---|---|---|
| `db` → `nutri_db` | Postgres 16 | Banco `nutri`; anotar a senha do usuário `postgres` (não colar em chat). Recursos: memória limite **1024 MB** |
| `app` → `nutri_app` | App, origem **Docker Image** `ghcr.io/<owner>/nutridebby:latest` | Credencial do GHCR (token GitHub com escopo `read:packages`). Variáveis: `NODE_ENV=production`, `APP_URL=https://app.<dominio>`, `DATABASE_URL=postgres://nutri_app:<senha-forte-nova>@nutri_db:5432/nutri`, `DATABASE_URL_MIGRATOR=postgres://nutri_owner:<senha-do-nutri_owner>@nutri_db:5432/nutri` (role dono criado no Step 1b — **nunca** o superusuário `postgres`), `AUTH_SECRET=<openssl rand -base64 48>`, `LOG_LEVEL=info`, `APP_ROLE=app`, `TRUSTED_PROXIES=<CIDR da rede overlay do Swarm/Traefik; conferir com `docker network inspect easypanel` — só leitura>`. `DATABASE_URL_MIGRATOR` só é lida pelas migrations no start; o `docker-entrypoint.sh` sobe o Next com `env -u DATABASE_URL_MIGRATOR` (Ruling R37). Domínio `app.<dominio>` → porta **3000**, HTTPS. Recursos: memória **1024 MB**, CPU **1** |
| `worker` → `nutri_worker` | App, mesma imagem | Só o que o worker usa: `NODE_ENV=production`, `DATABASE_URL` (mesmo valor do app), `LOG_LEVEL=info`, `APP_ROLE=worker`. **Não** cadastrar `DATABASE_URL_MIGRATOR` (role dono do schema, capaz de desligar RLS), nem `AUTH_SECRET`/`APP_URL` (Ruling R37). Sem domínio. Recursos: memória **512 MB** |

- [ ] **Step 1b: Role dono do banco para as migrations (Ruling R49)** — **mexe no banco de produção: pedir confirmação ao dono antes.** Fazer logo depois de criar o `nutri_db` e antes do primeiro start do `nutri_app` (o start roda as migrations). Uma única vez, como `postgres`, numa sessão interativa (a senha é digitada no prompt do `\password`, sem ir para histórico nem log):

```bash
docker exec -it $(docker ps -q -f name=nutri_db | head -1) psql -U postgres -d nutri
```

```sql
CREATE ROLE nutri_owner LOGIN NOSUPERUSER CREATEROLE NOCREATEDB NOBYPASSRLS;
\password nutri_owner
ALTER DATABASE nutri OWNER TO nutri_owner;
```

> **Atenção:** o `CREATEROLE` acima só é seguro assim no PostgreSQL **≥ 16** — a partir dessa versão, quem tem `CREATEROLE` só gerencia as roles que criou (ou para as quais recebeu `ADMIN OPTION` explícita), sem poder alterar/apagar roles preexistentes arbitrárias. Em versões anteriores ao 16, `CREATEROLE` permite alterar senha, membership e até apagar **qualquer** role não-superusuário (inclusive `postgres`), o que equivale a quase-superusuário — não replicar este passo assim num Postgres < 16.

Por que basta: as extensões da migration 0000 (`citext`, `pg_trgm`, `unaccent`, `btree_gist`) são *trusted* no PG 16 e o dono do banco pode criá-las; `CREATEROLE` cobre criar `nutri_app_role`/`nutri_app` e sincronizar a senha a cada deploy; o dono do banco é dono do schema `public` (`pg_database_owner`). Coberto por `src/db/migrate-owner.test.ts` (cluster próprio montado com estes comandos). `DATABASE_URL_MIGRATOR` do `nutri_app` usa este role; o `nutri_worker` continua **sem** `DATABASE_URL_MIGRATOR`.

- [ ] **Step 2: Webhooks de deploy** — em cada serviço (`app`, `worker`), copiar a URL de "Deploy Webhook" e cadastrar no GitHub como secrets `EASYPANEL_DEPLOY_HOOK_APP` e `EASYPANEL_DEPLOY_HOOK_WORKER` (`gh secret set EASYPANEL_DEPLOY_HOOK_APP` — o valor é colado no prompt, sem aparecer no histórico).

- [ ] **Step 3: Merge do PR (com confirmação explícita do dono)** — o merge dispara o `deploy.yml`, que publica a imagem e reinicia `nutri_app` e `nutri_worker`.

- [ ] **Step 4: Verificar o deploy** (comandos de leitura, permitidos pela regra 2)

```bash
docker service ls --filter name=nutri_
docker service logs --tail 50 nutri_app
curl -s -o /dev/null -w "%{http_code}\n" https://app.<dominio>/api/health
```

Expected: 3 serviços `1/1`; log com `Migrations aplicadas…`; health `200`.

Conferir que a credencial do migrator não está no ambiente dos processos (imprime só a contagem, nunca o valor):

```bash
docker exec $(docker ps -q -f name=nutri_app | head -1) sh -c "tr '\\0' '\\n' < /proc/1/environ | grep -c '^DATABASE_URL_MIGRATOR=' || true"
docker exec $(docker ps -q -f name=nutri_worker | head -1) sh -c "tr '\\0' '\\n' < /proc/1/environ | grep -c '^DATABASE_URL_MIGRATOR=' || true"
```

Expected: `0` nos dois.

- [ ] **Step 5: Criar o primeiro admin em produção** — **mexe no banco de produção: pedir confirmação ao dono antes.**

```bash
docker exec -it $(docker ps -q -f name=nutri_app | head -1) /app/docker-entrypoint.sh admin:criar <email-do-dono>
```

O dono abre o link, define a senha, ativa o 2FA e chega à tela "Administração".

> **Só assim (achado 9 da rodada 3, aceito pelo dono):** `admin:criar` roda apenas via `docker exec -it` interativo, com o link aparecendo só no terminal de quem executa. **Nunca** como comando avulso de serviço/one-off do Easypanel ou `docker run` sem TTY: a saída iria para os logs do container, e o link (token de definição de senha, válido por 1 h) ficaria gravado neles.

- [ ] **Step 6: Verificar que o IP não pode ser falsificado** (Desvio "limite por IP" / RNF-06)

```bash
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code} " -X POST https://app.<dominio>/api/auth/sign-in/email \
    -H 'content-type: application/json' -H "origin: https://app.<dominio>" \
    -H "x-forwarded-for: 203.0.113.$RANDOM" \
    -d '{"email":"naoexiste@teste.dev","password":"errada-123456"}'
done; echo
```

Expected: a 6ª resposta é `429`, mesmo trocando o `X-Forwarded-For` a cada chamada (o Traefik substitui o cabeçalho enviado pelo cliente). Além disso (Ruling R17): as chaves gravadas na tabela `rate_limit` precisam ser o IP real de quem chamou — **nunca** `no-trusted-ip|…` — e o log do `nutri_app` não pode conter o aviso *"could not determine a client IP"*. Se aparecer `no-trusted-ip`, o limite virou um balde global (qualquer pessoa bloquearia o login de todos): ajustar `TRUSTED_PROXIES` antes de seguir. **Se todas voltarem `401`, o limite está sendo burlado:** parar e corrigir antes do go-live (configurar `forwardedHeaders` no Traefik ou ler o IP de `x-real-ip`), registrando no PR.

- [ ] **Step 7: Registrar no PR** o resultado dos Steps 4–6 (sem segredos).

---

### Task 14: CLAUDE.md do projeto, MCPs e plugins (P01-14)

**Files:**
- Create: `CLAUDE.md`, `.mcp.json`, `.claude/settings.json`

- [ ] **Step 1: `CLAUDE.md`**

```markdown
# NutriDebby

SaaS multi-tenant de gestão de consultório de nutrição (spec: `docs/superpowers/specs/`, planos: `docs/superpowers/plans/`, backlog: https://claude.ai/artifact/DeHjnCr4xFDn7xE8DDuvM2).

## Stack
Node 24 · pnpm · Next.js 16 (App Router, `src/proxy.ts`) · PostgreSQL 16 · Drizzle · Better Auth · pg-boss · Vitest + Testcontainers · Playwright.

## Comandos
- `docker compose -f docker-compose.dev.yml up -d` — Postgres (127.0.0.1:54329) + Mailpit (:8025)
- `pnpm db:migrate` — migrations + role da aplicação
- `pnpm dev` / `pnpm worker`
- `pnpm test` (sobe Postgres via Testcontainers) · `pnpm test:e2e` · `pnpm lint` · `pnpm typecheck`
- `pnpm admin:criar <email>`

## Regras obrigatórias
1. Toda consulta a tabela com `tenant_id` passa por `withTenant(ctx, fn)` (`src/db/tenant.ts`). O admin nunca consulta essas tabelas.
2. Toda tabela nova com `tenant_id`: depois de `pnpm db:generate`, criar migration custom (`pnpm drizzle-kit generate --custom --name rls_<tabela>`) com `SELECT app_enable_tenant_rls('<tabela>');` e, se tiver `patient_id`, `SELECT app_enable_patient_rls('<tabela>');`. A guarda `src/db/rls-guard.test.ts` quebra o CI se esquecer.
3. Senhas, tokens, cookies e dados de saúde nunca vão para log, Sentry ou mensagens.
4. Textos de interface em pt-BR, com o texto exato da spec quando existir.
5. MCP de banco (`postgres-dev`) só aponta para o banco de **dev**. Proibido usar em produção.
6. Configuração de serviços só pelo Easypanel; confirmar com o dono antes de reiniciar serviço, mexer em banco de produção ou dar merge na `main` (merge = deploy).

## Revisão a cada entrega
Revisor por tarefa → `/code-review high` no PR → correções → `/code-review high` de novo (precisa sair limpo) → `/security-review`. Se sobrar problema confirmado após a 3ª rodada, parar e avisar o dono. Detalhes no índice dos planos.
```

- [ ] **Step 2: `.mcp.json`** (sem segredos; valores vêm do ambiente)

```json
{
  "mcpServers": {
    "postgres-dev": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "--network", "host", "-e", "DATABASE_URI", "crystaldba/postgres-mcp", "--access-mode=restricted"],
      "env": { "DATABASE_URI": "${NUTRI_DEV_DATABASE_URL}" }
    },
    "shadcn": { "command": "npx", "args": ["shadcn@latest", "mcp"] },
    "next-devtools": { "command": "npx", "args": ["-y", "next-devtools-mcp@latest"] }
  }
}
```

`NUTRI_DEV_DATABASE_URL` = `postgres://nutri_app:dev-app@localhost:54329/nutri` (exportado no shell de dev; é o role sem privilégios).

- [ ] **Step 3: `.claude/settings.json`**

```json
{
  "enabledPlugins": {
    "vercel@claude-plugins-official": false,
    "supabase@claude-plugins-official": false
  }
}
```

- [ ] **Step 4: Verificar** — abrir uma sessão nova do Claude Code na pasta e rodar `/mcp`: `postgres-dev`, `shadcn` e `next-devtools` conectados; plugins Vercel e Supabase ausentes.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md .mcp.json .claude/settings.json
git commit -m "docs: CLAUDE.md do projeto, MCPs de desenvolvimento e plugins fora da stack desativados"
```

---

### Task 15: Spike PWA — Serwist com Turbopack (P01-15, resolve P-14)

**Files:**
- Create: `src/app/sw.ts`, `src/app/serwist/[path]/route.ts`, `src/app/manifest.ts`, `src/app/p/layout.tsx`, `src/app/p/sw-provider.tsx`
- Modify: `next.config.ts`, `tsconfig.json` (lib `webworker` só no `sw.ts` via diretiva)

**Interfaces:**
- Produces: service worker em `/serwist/sw.js` registrado só nas páginas do paciente (`/p`), **sem cache de dados** (cache offline do plano é decisão do Plano 06).

- [ ] **Step 1: Dependências**

```bash
pnpm add -D @serwist/turbopack@9.5.12 serwist@9.5.12 esbuild
```

- [ ] **Step 2: `next.config.ts`**

```ts
import { withSerwist } from '@serwist/turbopack';

export default withSerwist({});
```

- [ ] **Step 3: Service worker mínimo** — `src/app/sw.ts`

```ts
/// <reference lib="webworker" />
import { Serwist, type PrecacheEntry, type SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// Spike: só estáticos do build; NENHUM cache de página ou dado de paciente (Plano 06 decide).
new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [],
}).addEventListeners();
```

`src/app/serwist/[path]/route.ts`:

```ts
import { createSerwistRoute } from '@serwist/turbopack';

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: 'src/app/sw.ts',
  useNativeEsbuild: true,
});
```

- [ ] **Step 4: Manifest e registro só no `/p`**

`src/app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NutriDebby',
    short_name: 'NutriDebby',
    start_url: '/p',
    scope: '/p/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#1d6b5a',
    icons: [],
  };
}
```

`src/app/p/sw-provider.tsx`:

```tsx
'use client';
import { SerwistProvider } from '@serwist/turbopack/react';

export function SwProvider({ children }: { children: React.ReactNode }) {
  return <SerwistProvider swUrl="/serwist/sw.js">{children}</SerwistProvider>;
}
```

`src/app/p/layout.tsx`:

```tsx
import { SwProvider } from './sw-provider';

export default function PacienteLayout({ children }: { children: React.ReactNode }) {
  return <SwProvider>{children}</SwProvider>;
}
```

- [ ] **Step 5: Verificar com build de produção**

```bash
pnpm build && pnpm start &
sleep 5 && curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:3000/serwist/sw.js
```

Expected: `200 application/javascript` (ou `text/javascript`). Depois, com o Playwright MCP, logar como paciente de teste (ou abrir `/p` com sessão) e checar em `navigator.serviceWorker.getRegistrations()` que existe 1 registro.

- [ ] **Step 6: Registrar o resultado** — acrescentar ao PR e ao spec (P-14) uma das duas conclusões:
  - **Funciona com Turbopack:** P-14 resolvida; Plano 06 usa `@serwist/turbopack`.
  - **Não funciona:** registrar o erro exato; Plano 06 usa `next build --webpack` com `@serwist/next`.

- [ ] **Step 7: Commit**

```bash
git add next.config.ts src/app/sw.ts src/app/serwist src/app/manifest.ts src/app/p package.json pnpm-lock.yaml
git commit -m "spike(pwa): service worker via @serwist/turbopack registrado só em /p, sem cache de dados"
```

---

## Fechamento do plano (após a Tarefa 15)

- [x] Rodar a revisão da entrega conforme o índice: `/code-review high` → corrigir → `/code-review high` (limpo) → `/security-review`; registrar os resumos no PR.
- [x] Atualizar o status das tarefas P01-01 a P01-15 no backlog (https://claude.ai/artifact/DeHjnCr4xFDn7xE8DDuvM2).
- [x] Atualizar a spec (Apêndice C) com os "Desvios conscientes" desta página e o resultado da P-14.
- [ ] Pedir ao dono o merge (= deploy).
