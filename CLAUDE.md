@AGENTS.md

# NutriDebby

SaaS multi-tenant de gestão de consultório de nutrição (spec: `docs/superpowers/specs/`, planos: `docs/superpowers/plans/`, backlog: https://claude.ai/artifact/DeHjnCr4xFDn7xE8DDuvM2).

## Stack

Node 24 · pnpm · Next.js 16 (App Router, `src/proxy.ts`) · PostgreSQL 16 · Drizzle · Better Auth · pg-boss · Vitest + Testcontainers · Playwright.

## Comandos

- `docker compose -f docker-compose.dev.yml up -d` — Postgres (127.0.0.1:54329) + Mailpit (:8025)
- `pnpm db:migrate` — migrations + role da aplicação
- `pnpm dev` (porta 3100 — a 3000 é o painel do Easypanel) / `pnpm worker`
- `pnpm test` (sobe Postgres via Testcontainers) · `pnpm test:e2e` · `pnpm lint` · `pnpm typecheck`
- `pnpm admin:criar <email>`

## Regras obrigatórias

1. Toda consulta a tabela com `tenant_id` passa por `withTenant(ctx, fn)` (`src/db/tenant.ts`). O admin nunca consulta essas tabelas. Exceção única: a tabela `user` do Better Auth (listada em `RLS_EXCEPTIONS`, `src/db/rls-guard.ts`) é acessada fora de `withTenant` só pelos internos do Better Auth (`src/lib/auth.ts`), pelo bootstrap de admin (`src/modules/plataforma/admin-bootstrap.ts`), pelo seed do E2E (`scripts/e2e-seed.ts`), por `src/modules/plataforma/audit.ts` (nome de quem acessou no "Histórico de acessos") e por `src/modules/plataforma/contas.ts`/`convites.ts` (criação da conta de nutricionista e convite de primeiro acesso, US-001). As tabelas sem `tenant_id` do M1 (`tenants`, `invites`, `consents`, `backup_runs`) seguem a mesma regra.
2. Toda tabela nova com `tenant_id`: depois de `pnpm db:generate`, criar migration custom (`pnpm drizzle-kit generate --custom --name rls_<tabela>`) com `SELECT app_enable_tenant_rls('<tabela>');` e, se tiver `patient_id`, `SELECT app_enable_patient_rls('<tabela>');`. A guarda `src/db/rls-guard.test.ts` quebra o CI se esquecer.
3. Senhas, tokens, cookies e dados de saúde nunca vão para log, Sentry ou mensagens.
4. Textos de interface em pt-BR, com o texto exato da spec quando existir.
5. MCP de banco (`postgres-dev`) só aponta para o banco de **dev**. Proibido usar em produção.
6. Configuração de serviços só pelo Easypanel; confirmar com o dono antes de reiniciar serviço, mexer em banco de produção ou dar merge na `main` (merge = deploy).
7. Migrations sempre rodam com `DATABASE_URL_MIGRATOR` (o role que emitiu `ALTER DEFAULT PRIVILEGES`); rodar com outro role deixa tabelas novas sem permissão para `nutri_app`.
8. Dado de saúde (tabela com `patient_id`, e a própria `patients`): na migration de RLS, também `SELECT app_enable_audit('<tabela>', '<entidade>');` (para `patients`: `app_enable_audit('patients', 'patients', 'id')`). Escritas viram `audit_log` sozinhas; ao **devolver** dado de saúde, chamar `auditRead(tx, …)` na mesma transação (`src/modules/plataforma/audit.ts`). O `withTenant` de sessão de usuário leva `actorUserId` e `ip`. Migration de **dados** numa tabela auditada: `set_config('app.tenant_id', …)` por tenant, ou `DISABLE TRIGGER audit_row_change` só dentro da própria migration. A guarda `src/db/audit-guard.test.ts` quebra o CI se faltar o gatilho.

## Revisão a cada entrega

Revisor por tarefa → `/code-review high` no PR → correções → `/code-review high` de novo (precisa sair limpo) → `/security-review`. Se sobrar problema confirmado após a 3ª rodada, parar e avisar o dono. Detalhes no índice dos planos.
