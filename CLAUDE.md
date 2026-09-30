@AGENTS.md

# NutriDebby

SaaS multi-tenant de gestão de consultório de nutrição (spec: `docs/superpowers/specs/`, planos: `docs/superpowers/plans/`, backlog: https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT).

## Stack

Node 24 · pnpm · Next.js 16 (App Router, `src/proxy.ts`) · PostgreSQL 16 · Drizzle · Better Auth · pg-boss · Vitest + Testcontainers · Playwright.

## Comandos

- `docker compose -f docker-compose.dev.yml up -d` — Postgres (127.0.0.1:54329) + Mailpit (:8025)
- `pnpm db:migrate` — migrations + role da aplicação
- `pnpm dev` (porta 3100 — a 3000 é o painel do Easypanel) / `pnpm worker`
- `pnpm test` (sobe Postgres via Testcontainers) · `pnpm test:e2e` · `pnpm lint` · `pnpm typecheck`
- `pnpm admin:criar <email>`

## Regras obrigatórias

1. Toda consulta a tabela com `tenant_id` passa por `withTenant(ctx, fn)` (`src/db/tenant.ts`). O admin nunca consulta essas tabelas. Exceção única: a tabela `user` do Better Auth (listada em `RLS_EXCEPTIONS`, `src/db/rls-guard.ts`) é acessada fora de `withTenant` só pelos internos do Better Auth (`src/lib/auth.ts`), pelo bootstrap de admin (`src/modules/plataforma/admin-bootstrap.ts`), pelo seed do E2E (`scripts/e2e-seed.ts`), por `src/modules/plataforma/audit.ts` (nome de quem acessou no "Histórico de acessos"), por `src/modules/plataforma/contas.ts`/`convites.ts` (criação da conta de nutricionista e convite de primeiro acesso, US-001), por `src/modules/plataforma/dpa.ts` (registro do aceite do DPA, Tarefa 6), por `src/modules/plataforma/suspensao.ts` (revogação das sessões das usuárias do tenant suspenso, US-004), por `src/modules/plataforma/monitoramento.ts` (e-mails dos admins para os alertas de backup e de disco, RNF-05/RNF-13), por `src/modules/pacientes/convite-paciente.ts` (convite e aceite do paciente, US-010/US-011: lê o papel da conta pelo e-mail, cria a conta do paciente e o aceite do termo), por `test/sessao.ts` (helper de testes que cria usuário e credencial) e por `test/pacientes.ts` (helper de testes que cria a usuária nutricionista do tenant de teste). As tabelas do M1 fora da RLS (`tenants`, `backup_runs` e, com `tenant_id` mas em `RLS_EXCEPTIONS`, `invites` e `consents`) seguem a mesma regra. A tabela `invites` (convites de nutricionista e de paciente) é exceção de RLS: só `src/modules/plataforma/convites.ts`, `src/modules/pacientes/convite-paciente.ts` e `src/modules/plataforma/contas.ts` (validade do convite da nutricionista na lista do admin) a acessam, sempre filtrando por tipo ou por `user_id` (e por tenant, no de paciente).
2. Toda tabela nova com `tenant_id`: depois de `pnpm db:generate`, criar migration custom (`pnpm drizzle-kit generate --custom --name rls_<tabela>`) com `SELECT app_enable_tenant_rls('<tabela>');` e, se tiver `patient_id`, `SELECT app_enable_patient_rls('<tabela>');`. A guarda `src/db/rls-guard.test.ts` quebra o CI se esquecer. Tabela que o paciente nunca pode ver, nem as próprias linhas (notas privadas, etiquetas): também `SELECT app_enable_staff_only('<tabela>');` e a entrada em `STAFF_ONLY` (`src/db/rls-guard.ts`).
3. Senhas, tokens, cookies e dados de saúde nunca vão para log, Sentry ou mensagens.
4. Textos de interface em pt-BR, com o texto exato da spec quando existir.
5. MCP de banco (`postgres-dev`) só aponta para o banco de **dev**. Proibido usar em produção.
6. Configuração de serviços só pelo Easypanel; confirmar com o dono antes de reiniciar serviço, mexer em banco de produção ou dar merge na `main` (merge = deploy).
7. Migrations sempre rodam com `DATABASE_URL_MIGRATOR` (o role que emitiu `ALTER DEFAULT PRIVILEGES`); rodar com outro role deixa tabelas novas sem permissão para `nutri_app`.
8. Dado de saúde (tabela com `patient_id`, e a própria `patients`): na migration de RLS, também `SELECT app_enable_audit('<tabela>', '<entidade>');` (para `patients`: `app_enable_audit('patients', 'patients', 'id')`). Escritas viram `audit_log` sozinhas; ao **devolver** dado de saúde, chamar `auditRead(tx, …)` na mesma transação (`src/modules/plataforma/audit.ts`). O `withTenant` de sessão de usuário leva `actorUserId` e `ip`. Migration de **dados** numa tabela auditada: `set_config('app.tenant_id', …)` por tenant, ou `DISABLE TRIGGER audit_row_change` só dentro da própria migration. A guarda `src/db/audit-guard.test.ts` quebra o CI se faltar o gatilho.
9. Arquivos: gravar e apagar só por `salvarArquivo`/`apagarArquivo` (`src/modules/plataforma/armazenamento.ts`): tipo pelo conteúdo, cota reservada na transação. Servir só por `signFileUrl` (5 min, rota `/api/arquivos`). Nunca montar caminho de arquivo com texto do usuário. Tabela nova com `tenant_id` também entra em `FABRICAS` de `test/isolamento.test.ts` (fábrica que precisa de linha-mãe cria a mãe no mesmo comando; tabela-mãe com FK `NO ACTION` entra em `ULTIMAS`).
10. O backup (RNF-05) roda **no host** (`scripts/backup/nutri-backup.sh`, systemd às 03h), não no worker: `pg_dump` dentro do container `nutri_db` + `rclone crypt` para o R2. Mudou o script → o dono reinstala no host (Plano 02, Tarefa 14). A tabela `backup_runs` é escrita só pelo script; o worker só confere e alerta. Nunca rodar o script fora de `test/backup.test.ts` (há bancos de produção no host).

## Revisão a cada entrega

Revisor por tarefa → `/code-review high` no PR → correções → `/code-review high` de novo (precisa sair limpo) → `/security-review`. Se sobrar problema confirmado após a 3ª rodada, parar e avisar o dono. Detalhes no índice dos planos.
