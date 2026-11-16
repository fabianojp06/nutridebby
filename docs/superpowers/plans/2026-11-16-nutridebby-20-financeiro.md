# Plano 20 — Financeiro do consultório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a nutricionista controla o caixa do consultório no NutriDebby: lança entradas e saídas, a consulta marcada como Realizada vira cobrança sozinha, vê os pagamentos pendentes por paciente, o resumo do mês, o fluxo de caixa do ano e baixa o CSV para o contador — sem nada ir ao paciente.

**Architecture:** três tabelas `staff_only` (`fin_configuracoes`, `fin_categorias`, `fin_lancamentos`) com RLS de tenant (e de paciente em `fin_lancamentos`), gatilho de regras (colunas fixas, bloqueio, anonimização, autoria pelo banco) e sem DELETE. Um módulo `src/modules/financeiro/` com funções puras (dinheiro, situação, CSV) e funções de banco por `withTenant`. A cobrança nasce numa função só (`cobrarConsultaRealizada`) chamada na transação de `registrarPresenca` e de `registrarAtendimento`. Telas em `/painel/financeiro/…`; a seção da ficha entra no registro de seções do Plano 18.

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas, layouts, actions e Route Handlers) · Drizzle · PostgreSQL 16 (RLS) · Better Auth · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-nutridebby-20-financeiro-design.md` **v0.2** (aprovada pelo dono em 16/11/2026: "aprovo todas as recomendações, pode seguir"; revisão 0.2 na §17 da spec). Backlog Paridade Dietbox, onda 1: PD-30, PD-31, PD-32, PD-33.

## Ambiente da sessão (Sessão C)

| Item | Valor |
|---|---|
| Worktree | `/home/deploy/servidor/projetos/nutridebby-c` (`../nutridebby-c`) |
| Branch | `plano-20-financeiro` (PR 1 de fundação sai de um branch próprio, `plano-20-fundacao`, a partir dele; ver "Ordem de entrega") |
| Porta | **3103** (`pnpm exec next dev -p 3103`; nunca `pnpm dev`, que fixa a 3100 do principal) |
| Banco | **`nutri_dev_c`** no Postgres de dev (`127.0.0.1:54329`) |
| Preparar | do worktree principal: `scripts/sessao-paralela.sh c plano-20-financeiro` (cria/reaproveita o worktree, o `.env.local` com porta e banco, o banco, `pnpm install --frozen-lockfile` e `pnpm db:migrate`). O script vem do PR #50 (`docs/sessoes-paralelas`); se ainda não estiver na `main`, a orquestradora prepara a sessão |
| Variáveis | nenhuma `DATABASE_URL`, `DATABASE_URL_MIGRATOR`, `APP_URL` ou `DATA_DIR` exportada no shell (venceriam o `.env.local`); conferir só os nomes: `env \| cut -d= -f1 \| grep -E '^(DATABASE_URL\|APP_URL\|DATA_DIR)'` |
| Olhar o banco | `docker compose -f ../nutridebby/docker-compose.dev.yml exec db psql -U nutri_owner -d nutri_dev_c` (o MCP `postgres-dev` aponta para o banco do principal; **nunca** produção, regra 5) |
| E2E | `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3103 pnpm test:e2e <spec>` (a `APP_URL` só nesse comando); parar o `pnpm worker` da sessão antes; **um E2E de cada vez entre as sessões** (Mailpit único) |
| Vitest | `pnpm vitest run <arquivos>` sobe o próprio Postgres (Testcontainers); três suítes ao mesmo tempo pesam na CPU: escalone com as outras sessões |

Proibido nesta sessão: tocar produção (nem leitura), `docker service update`, push, merge, editar outros worktrees, `nutri-backup.sh`.

## Global Constraints

- Regras 1, 2, 3, 7, 8 e 9 do `CLAUDE.md`: toda consulta a `fin_*` por `withTenant(ctx, fn)`; o admin nunca consulta; as três tabelas em `STAFF_ONLY`; `app_enable_audit('fin_lancamentos', 'financeiro')`; migrations com `DATABASE_URL_MIGRATOR`; `FABRICAS` de `test/isolamento.test.ts`.
- **Migrations:** número = o que `pnpm db:generate` der em cima da `main` do momento; **nada reservado**. Antes de abrir o PR 1 (e de novo se outro PR com migration entrar antes), seguir `docs/operacao/sessoes-paralelas.md` §5, passos 1 a 8 (ler com `git show origin/docs/sessoes-paralelas:docs/operacao/sessoes-paralelas.md` enquanto o PR #50 não entrar): guardar as migrations do branch, rebase em `origin/main`, apagar as do branch e voltar o journal ao da `main`, `pnpm db:generate` de novo, recriar a custom `rls_financeiro` colando o SQL guardado, conferir encadeamento (`idx` seguidos, `prevId`, `pnpm drizzle-kit check`, `grep -rn "<número antigo>" src test docs CLAUDE.md`), recriar o banco `nutri_dev_c` (com OK do dono: é apagar, mesmo em dev) e rodar `pnpm test src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/migrate.test.ts src/modules/financeiro/banco.test.ts`. O `when` de cada migration nova tem de ser maior que o último da `main` (a guarda da Tarefa 1 quebra o CI se não for).
- Dinheiro em **centavos inteiros** do formulário ao banco; nunca `parseFloat`/`Number("1.250,50")`; somas em `bigint` no SQL, convertidas para `number` abaixo de `Number.MAX_SAFE_INTEGER`.
- Datas de calendário (`date`) no fuso do consultório: "hoje" = `hojeNoFuso(tenant.fuso, agora)` (`src/modules/pacientes/datas.ts:23`); helpers de mês novos ficam em `src/modules/financeiro/meses.ts` — **não editar** `src/modules/agenda/fuso.ts` (disputado com o Plano 17).
- Situação calculada (sem coluna): Cancelado > Recebido/Pago > Em atraso (vencimento < hoje) > Previsto.
- Valor, descrição, motivo, categoria e nome de paciente **nunca** em log, Sentry ou mensagem de erro (regra 3; RN-322). Erros logam só código e motivo técnico.
- Nada do Financeiro no portal (`/p`), na página pública, em push, e-mail ou WhatsApp ao paciente (C-302), nem em contexto de IA (RN-323).
- Sem dependência nova; sem PDF; sem arquivo novo em `stored_files` (C-303, C-304).
- Funções do módulo conferem `ctx.role === 'nutri'` antes de abrir a transação (exceto `titular.ts`, do worker).
- Textos de interface em pt-BR, **exatos** da spec §6.2, em `MSG_FINANCEIRO` (`src/modules/financeiro/constantes.ts`). Rótulos de botão e campo podem morar nos `.tsx`; os que um guia cita entre aspas e moram no módulo exigem `'src/modules/financeiro'` em `TSX_FORA` (`src/modules/ajuda/conteudo.test.ts:13`).
- Correção para "Faltou" **não** cancela cobrança (F-D19 v0.2, como a F-D7 aprovada); se o dono escolher a opção (a) da F-P5 antes da Tarefa 7, ela muda (meia tarefa).
- Arquivos disputados (`sessoes-paralelas.md` §6): `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md`, `navegacao.ts`, `docs/manual-tecnico/`, índice dos planos e backlog — **só acrescentar**, no fim da lista ou do bloco, sem reordenar nem reformatar.

## Review Focus

1. **Migrations e merge** — o `when` das migrations do Plano 20 maior que o último da `main` no momento do merge; guarda de `_journal.json` em `src/db/migrate.test.ts` (Tarefa 1). Nenhum arquivo de `drizzle/` do Plano 17 tocado.
2. **Integridade no banco** — colunas fixas, autoria (`criado_por`, `cancelado_por`, `cancelado_em`) gravada pelo gatilho, cancelado e anonimizado imutáveis, paciente bloqueado só com receber/desfazer/reduzir/cancelar, DELETE revogado em `fin_lancamentos` e `fin_configuracoes`, "Consultas" nunca arquivada nem apagada. Testes em `banco.test.ts` (Tarefa 1).
3. **Concorrência** — duas abas cobrando a mesma consulta (índice único parcial + `ON CONFLICT DO NOTHING`); bloqueio do paciente confirmado no meio de `criarLancamento` (trava `FOR KEY SHARE` + conferência sob a trava, e o gatilho com `FOR KEY SHARE`). Testes em `lancamentos.test.ts` (Tarefa 3) e `cobranca.test.ts` (Tarefa 7).
4. **Fuso e virada do mês** — tenant em `America/Sao_Paulo` com o servidor em UTC: 30/11 22:30 local ainda é novembro; totais do Resumo, do fluxo e do CSV batem centavo a centavo (CS-301, teste de propriedade). Testes em `meses.test.ts` (Tarefa 2) e `resumo.test.ts` (Tarefa 4).
5. **LGPD** — `dados.json` com a seção `financeiro` integral (sem autor), anonimização só pela função, textos da exclusão ao paciente, CSV sem nomes sem descrição de entradas de pacientes, `auditRead`/`exportar` nos pontos da RN-318/RN-321. Testes nas Tarefas 8 e 9.
6. **Sem efeito escondido** — "Faltou" não mexe no Financeiro; as duas portas para "Realizada" dizem o que aconteceu com a cobrança. Testes na Tarefa 7.

## Ordem de entrega

| PR | Tarefas | Quando | Por quê |
|---|---|---|---|
| **PR 1 — fundação** | T1 | Primeiro, sozinho, assim que a T1 passar na revisão; entra na fila de migrations (uma por vez) | É o que as outras sessões encontram na `main` ao fazer rebase (tabelas, guardas, listas de isolamento, semente do E2E, guarda do journal); pequeno, revisão rápida |
| **PR 2 — Financeiro** | T2 a T11 | Depois do merge do PR 1 e do Plano 17 (a T9 mexe em `lgpd.ts`/`exportacao-job.ts`; rebasear também sobre os Planos 18 e 19 se entrarem antes) | **Sem migration** (não espera a fila de migrations). A LGPD (T9) vai no mesmo deploy da primeira escrita de lançamento com paciente (R-313): o PR 2 não vai a merge sem a T9 |
| **PR 3 — ficha** | T12 | Depois do merge do Plano 18 (registro de seções do Início) | PD-33 depende do PD-12 |

Merge sempre com OK do dono (merge = deploy); nunca das 03h às 07h30 BRT; sem snapshot da Hostinger (congela a VPS): migration só aditiva e o backup restic diário.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/db/schema/financeiro.ts` (+ export em `src/db/schema/index.ts`) | `finConfiguracoes`, `finCategorias`, `finLancamentos` |
| `drizzle/<NNNN>_financeiro.sql` (gerada) + `drizzle/<NNNN+1>_rls_financeiro.sql` (custom) | Tabelas; RLS, `staff_only`, auditoria, `REVOKE`, gatilhos, `app_anonimizar_financeiro` |
| `src/modules/financeiro/constantes.ts` | `MSG_FINANCEIRO`, formas, categorias iniciais, limites |
| `src/modules/financeiro/dinheiro.ts` | `paraCentavos`, `formatarReais` |
| `src/modules/financeiro/situacao.ts` | `situacaoDoLancamento`, `dataDeReferencia` |
| `src/modules/financeiro/meses.ts` | Mês de referência, intervalos de mês e de ano em `date`, lista de meses do filtro |
| `src/modules/financeiro/csv.ts` | CSV dos lançamentos e do fluxo (puro) |
| `src/modules/financeiro/configuracoes.ts` | Configuração e categorias |
| `src/modules/financeiro/lancamentos.ts` | Criar, editar, receber, desfazer, cancelar, listar, abrir |
| `src/modules/financeiro/resumo.ts` | Saldo, mês, fluxo do ano, 12 meses, pendências |
| `src/modules/financeiro/cobranca.ts` | Cobrança da consulta |
| `src/modules/financeiro/titular.ts` | Seção da exportação |
| `src/app/painel/financeiro/**` | Telas, actions e rotas CSV (`src/app/api/painel/financeiro/*.csv/route.ts`) |
| `src/modules/agenda/presenca.ts`, `src/modules/pacientes/atendimentos.ts` (modificar) | Só a chamada a `cobranca.ts` e o retorno |
| `src/app/painel/agenda/consultas/[id]/*`, `src/app/painel/pacientes/[id]/atendimentos/*` (modificar) | Seção "Cobrança" e mensagens |
| `src/modules/pacientes/exportacao-job.ts`, `src/modules/pacientes/lgpd.ts`, `src/email/templates.tsx`, `src/app/p/(portal)/perfil/privacidade.tsx`, `src/app/painel/pacientes/[id]/privacidade/page.tsx` (modificar) | LGPD |
| `src/modules/plataforma/dpa.ts`, `src/modules/plataforma/textos-legais.ts`, `src/app/painel/dpa/page.tsx` (modificar) | DPA 1.1 |
| `src/modules/ficha/secoes/financeiro.ts` (PR 3) | Seção do Início |
| `e2e/financeiro.spec.ts` | E2E |
| `docs/operacao/financeiro.md` | Runbook (começo a partir do Dietbox, aviso do DPA, nota da Res. 856) |

---

### Task 1: Fundação — tabelas, RLS, gatilhos, guardas e semente do E2E (PR 1)

**Files:**
- Create: `src/db/schema/financeiro.ts`; export em `src/db/schema/index.ts` (uma linha no fim)
- Create: `drizzle/<NNNN>_financeiro.sql` (`pnpm db:generate`), `drizzle/<NNNN+1>_rls_financeiro.sql` (`pnpm drizzle-kit generate --custom --name rls_financeiro`)
- Modify: `src/db/rls-guard.ts` (`STAFF_ONLY`: as três, com o motivo da spec §9.5), `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO.financeiro = 'Financeiro'`; `financeiro_configuracoes` sem rótulo no Histórico do paciente, porque não tem paciente)
- Modify: `test/isolamento.test.ts` — `FABRICAS` das três (`fin_configuracoes` com `ON CONFLICT DO NOTHING`; `fin_categorias` com nome único por chamada; `fin_lancamentos` como entrada com paciente, sem consulta, criando a categoria no mesmo comando por CTE); `COM_MAE`: `fin_lancamentos` (comentário: escolha registrada na spec §9.5, prova própria em `banco.test.ts`); `ULTIMAS`: `fin_categorias` antes de `patients`; `SEM_DELETE` e `DELETE_REVOGADO`: `fin_lancamentos`, `fin_configuracoes`; `IMUTAVEIS`: `fin_lancamentos` (comentário: `Plano 20: fin_lancamentos_regras recusa mudar tenant_id/patient_id com 42501 antes da RLS`); `SO_APAGA`: filtro de `patients` (`and not exists (select 1 from fin_lancamentos f where f.tenant_id = patients.tenant_id and f.patient_id = patients.id)`) e de `fin_categorias` (sem lançamento e `chave is null`)
- Modify: `src/db/migrate.test.ts` — guarda do journal
- Modify: `scripts/e2e-seed.ts` — limpeza da agenda com lançamentos (spec §9.5); o consultório do E2E sai **configurado** (linha de `fin_configuracoes` com saldo de R$ 1.000,00 no dia 1º do mês corrente e valor da consulta R$ 250,00, e as categorias iniciais com `ON CONFLICT DO NOTHING`, no contexto `worker`)
- Modify: `CLAUDE.md` — regra 1 (frase nova: `fin_*` são `staff_only`, só a sessão `nutri`; `titular.ts` e `app_anonimizar_financeiro` no `worker`), regra 2 (Plano 20: as três em `STAFF_ONLY`; `fin_lancamentos` e `fin_configuracoes` em `SEM_DELETE`/`DELETE_REVOGADO`; `fin_lancamentos` em `IMUTAVEIS` e `COM_MAE`; gatilhos `fin_lancamentos_regras` e `fin_categorias_fixas`; marcador `app.fin_anonimizando` só por `app_anonimizar_financeiro`), regra 8 (entidade `financeiro`, "Financeiro"; `auditRead` só nas telas de um paciente; `exportar` no CSV; `financeiro_configuracoes` com `recordAudit` sem paciente) — frases novas no fim de cada regra
- Test: `src/modules/financeiro/banco.test.ts`, `src/db/migrate.test.ts`, `src/modules/plataforma/audit.test.ts`

**Interfaces:**
- Produces: `finConfiguracoes`, `finCategorias`, `finLancamentos`, tipos `FinLancamentoRow`, `FinCategoriaRow`, `TipoLancamento = 'entrada' | 'saida'`, `FormaPagamento`.

Colunas, CHECKs, FKs e índices exatamente como a spec §9.1 a §9.3 (inclusive `fin_lancamentos_consulta_ativa_unique` com predicado em literais, como `tipoUmPorHorario`). Migration custom (molde da 0116/0117), na ordem: `app_enable_tenant_rls` + `app_enable_staff_only` nas três; `app_enable_patient_rls('fin_lancamentos')`; `app_enable_audit('fin_lancamentos', 'financeiro')`; `REVOKE DELETE, TRUNCATE` em `fin_lancamentos` e `fin_configuracoes`; gatilho `fin_categorias_fixas` (BEFORE UPDATE OR DELETE); gatilho `fin_lancamentos_regras` (BEFORE INSERT OR UPDATE, regras da spec §9.4, comparações com `IS DISTINCT FROM`, `ERRCODE = '42501'`); função `app_anonimizar_financeiro(p_patient uuid)` (`SECURITY INVOKER`, `SET search_path = public, pg_temp`, nomes com `public.`, paciente `FOR UPDATE`, marcador ligado e desligado, `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO nutri_app_role`).

- [ ] **Step 1: Testes que falham** em `banco.test.ts` (sessões por `withTenant` e o helper de `test/sessao.ts`/`test/pacientes.ts`):
  - `nutri cria e lê; paciente, publico e conta não leem nenhuma linha` (`staff_only`, `publico_negado`).
  - `INSERT pela sessão de paciente, publico e conta em fin_lancamentos com categoria já existente → erro de RLS da própria tabela`; `pela worker → 42501 do gatilho` (prova que `COM_MAE` não esconde a política, spec §9.5).
  - `criado_por é o da sessão` — INSERT com `criado_por` de outro usuário grava `app_current_user()`.
  - `colunas fixas` — UPDATE de `tipo`, `patient_id`, `appointment_id`, `criado_por`, `created_at` → 42501; UPDATE sem mudança passa.
  - `cancelamento` — sem motivo → violação de CHECK; com motivo, `cancelado_por` = usuária da sessão e `cancelado_em` do banco (mesmo se o módulo mandar outro); depois de cancelado, UPDATE de `valor_centavos` → 42501.
  - `saída com paciente`, `consulta sem paciente`, `categoria de outro tipo` (FK composta), `pago sem forma`, `valor 0` → violação de CHECK/FK.
  - `paciente bloqueado` — INSERT → 42501; UPDATE de `pago_em`/`forma_pagamento` passa; `valor_centavos` menor passa, maior → 42501; `vencimento`, `categoria_id`, `descricao` → 42501; cancelar passa.
  - `bloqueio concorrente` — transação A `FOR UPDATE` no paciente e o leva a `bloqueado`; transação B insere lançamento dele (o gatilho espera no `FOR KEY SHARE`); A confirma → B recebe 42501.
  - `anonimização` — `app_anonimizar_financeiro` fora do `worker` → recusa; paciente não bloqueado → recusa; no `worker` com paciente bloqueado: textos nulos, `anonimizado_em` preenchido, em aberto vira cancelado com `cancelado_por` nulo, valor/datas/categoria/forma iguais; depois, `current_setting('app.fin_anonimizando', true)` vazio na mesma transação; qualquer UPDATE depois → 42501; UPDATE com o marcador ligado à mão pela sessão `nutri` → 42501.
  - `uma cobrança ativa por consulta` — segunda com a mesma `appointment_id` e `cancelado_em` nulo → violação do índice; depois de cancelar a primeira, a segunda entra.
  - `Consultas` — arquivar → CHECK; DELETE → 42501; mudar `chave`/`tipo` → 42501; renomear passa.
  - `DELETE e TRUNCATE revogados` em `fin_lancamentos` e `fin_configuracoes` (42501 de permissão).
  - `escrita vira audit_log` — INSERT e UPDATE pela `nutri` gravam `audit_log` com entidade `financeiro` e o `patient_id`; lançamento sem paciente grava sem paciente.
  - Em `migrate.test.ts`: `journal: when estritamente crescente e idx sem buraco` (lê `drizzle/meta/_journal.json`; `entries[i].idx === i` e `entries[i].when > entries[i-1].when`).
  - Em `audit.test.ts`: `ENTIDADE_ROTULO.financeiro` é `Financeiro`.
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/banco.test.ts src/db/migrate.test.ts src/modules/plataforma/audit.test.ts` → FAIL (tabelas não existem; a guarda do journal já deve passar na `main` — se falhar, parar e avisar a orquestradora: é um problema da `main`).
- [ ] **Step 3:** schema, `pnpm db:generate`, migration custom, `pnpm db:migrate` (com o `DATABASE_URL_MIGRATOR` do `.env.local`, regra 7); listas das guardas; `audit.ts`; semente; `CLAUDE.md`.
- [ ] **Step 4:** `pnpm vitest run src/modules/financeiro/banco.test.ts src/db/migrate.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/modules/plataforma/audit.test.ts test/isolamento.test.ts` → PASS; `pnpm e2e:seed` **duas vezes seguidas** no `nutri_dev_c` sem erro; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(financeiro): tabelas, RLS, gatilhos e guardas do Financeiro (P20-01)`.

**Pronto quando:** testes acima verdes; `pnpm e2e:seed` idempotente; revisão do `revisor-rls` sem Critical/Important; procedimento do §5 do `sessoes-paralelas.md` feito em cima da `main` atual; PR 1 aberto (sem push sem o OK; a orquestradora conduz).

---

### Task 2: Regras puras — dinheiro, situação, meses e CSV

**Files:**
- Create: `src/modules/financeiro/constantes.ts`, `dinheiro.ts`, `situacao.ts`, `meses.ts`, `csv.ts`
- Test: `src/modules/financeiro/dinheiro.test.ts`, `situacao.test.ts`, `meses.test.ts`, `csv.test.ts`, `constantes.test.ts`

**Interfaces:**
- Produces:
```ts
// constantes.ts
export const VALOR_MAX_CENTAVOS = 100_000_000; export const SALDO_MAX_CENTAVOS = 1_000_000_000;
export const DESCRICAO_MAX = 200; export const MOTIVO_MAX = 200; export const NOME_CATEGORIA_MAX = 60;
export const FORMAS_DE_PAGAMENTO = ['pix','dinheiro','cartao_credito','cartao_debito','transferencia','boleto','outra'] as const;
export type FormaPagamento = typeof FORMAS_DE_PAGAMENTO[number];
export const ROTULO_FORMA: Record<FormaPagamento, string>; // "Pix" … "Outra"
export const CATEGORIAS_INICIAIS: { tipo: 'entrada' | 'saida'; nome: string; chave: 'consultas' | null }[];
export const MSG_FINANCEIRO: { … }; // todos os textos da spec §6.2, chave por chave
// dinheiro.ts
export function paraCentavos(texto: string): { ok: true; centavos: number } | { ok: false; erro: 'vazio' | 'invalido' };
export function formatarReais(centavos: number): string; // "R$ 1.250,00"; negativo "−R$ 320,00"
// situacao.ts
export type Situacao = 'cancelado' | 'recebido' | 'pago' | 'em_atraso' | 'previsto';
export function situacaoDoLancamento(l: { tipo: 'entrada' | 'saida'; vencimento: string; pagoEm: string | null; canceladoEm: Date | null }, hoje: string): Situacao;
export function dataDeReferencia(l: { vencimento: string; pagoEm: string | null }): string;
export const ROTULO_SITUACAO: Record<Situacao, string>;
// meses.ts (datas 'AAAA-MM-DD' e meses 'AAAA-MM'; sem Date local)
export function mesDe(dia: string): string;
export function intervaloDoMes(mes: string): { de: string; ate: string }; // ate = último dia
export function mesesDoAno(ano: number): string[];
export function ultimos12Meses(hoje: string): string[];
export function nomeDoMes(mes: string): string; // "novembro"
export function diasEntre(de: string, ate: string): number;
// csv.ts
export function celulaTexto(v: string | null): string; // neutraliza = + - @ \t \r com '
export function csvLancamentos(linhas: LinhaCsv[], o: { comPacientes: boolean }): string; // BOM, ';', CRLF
export function csvFluxo(f: FluxoDoAno): string;
```
- `paraCentavos` aceita "1250", "1250,5", "1.250,50", "R$ 1.250,50", "-320,00" e "−320,00"; recusa "1,2,3", "abc", "1.25" (ponto como decimal), mais de 2 casas. `formatarReais` usa `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` (o teste compara com o espaço não separável).
- `csvLancamentos` sem `comPacientes`: sem a coluna "Paciente" **e** "Descrição" vazia nas linhas com paciente (RN-321); números gerados pelo sistema sem `'`.

- [ ] **Step 1: Testes que falham** com os exemplos acima e: `situacaoDoLancamento` com vencimento hoje → previsto; ontem → em atraso; cancelado vence tudo; saída paga → `pago`; `dataDeReferencia` pela data de pagamento quando há; `meses.test.ts`: fevereiro de 2028 (bissexto), `ultimos12Meses('2026-11-16')` começa em `2025-12`; `csv.test.ts`: BOM no início, CRLF, `;`, "=HIPERLINK(…)" → "'=HIPERLINK(…)", tabulação e CR neutralizados, descrição vazia na linha com paciente sem a opção, presente com a opção; `constantes.test.ts`: `CATEGORIAS_INICIAIS` com "Consultas" (chave `consultas`) e as 12 da RN-302; os textos de `MSG_FINANCEIRO` iguais à §6.2 (amostra das mensagens de erro e das quatro mensagens da consulta).
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/dinheiro.test.ts src/modules/financeiro/situacao.test.ts src/modules/financeiro/meses.test.ts src/modules/financeiro/csv.test.ts src/modules/financeiro/constantes.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(financeiro): dinheiro, situação, meses e CSV (P20-02)`.

**Pronto quando:** testes verdes; nenhum `parseFloat`/`Number(` sobre texto do usuário em `src/modules/financeiro` (grep no review).

---

### Task 3: Configurações e lançamentos (módulo)

**Files:**
- Create: `src/modules/financeiro/configuracoes.ts`, `src/modules/financeiro/lancamentos.ts`, `src/modules/financeiro/erros.ts`
- Test: `src/modules/financeiro/configuracoes.test.ts`, `lancamentos.test.ts`, `guardas.test.ts`, `log.test.ts`

**Interfaces:**
- Consumes: Tarefa 1 (tabelas), Tarefa 2 (todas).
- Produces:
```ts
export class FinanceiroError extends Error { constructor(public erros: Record<string, string>) } // mensagens de MSG_FINANCEIRO
export type Configuracao = { saldoInicialCentavos: number; saldoInicialEm: string; valorConsultaCentavos: number | null };
export async function lerConfiguracoes(ctx: TenantContext, deps?: { db?: Db }): Promise<Configuracao | null>;
export async function salvarConfiguracoes(ctx: TenantContext, tenant: { fuso: string }, input: unknown, deps?: { db?: Db; agora?: Date }): Promise<void>;
export async function listarCategorias(ctx: TenantContext, deps?): Promise<FinCategoriaRow[]>;
export async function criarCategoria / renomearCategoria / arquivarCategoria / reativarCategoria / excluirCategoria(ctx, …): Promise<void>;
export type LancamentoNaTela = { id; tipo; categoria: { id; nome }; valorCentavos; vencimento; pagoEm; forma; descricao; paciente: { id; nome; bloqueado: boolean } | null; consulta: { id; inicio: Date } | null; situacao: Situacao; canceladoEm; motivoCancelamento; anonimizado: boolean };
export async function criarLancamento(ctx, tenant, input: unknown, deps?): Promise<{ id: string; antesDoSaldo: boolean; mes: string }>;
export async function editarLancamento(ctx, tenant, id: string, input: unknown, deps?): Promise<{ antesDoSaldo: boolean; mes: string }>;
export async function marcarRecebido(ctx, tenant, id: string, input: { pagoEm: string; forma: string }, deps?): Promise<{ mes: string }>;
export async function desfazerRecebimento(ctx, id: string, deps?): Promise<void>;
export async function cancelarLancamento(ctx, id: string, motivo: string, deps?): Promise<void>;
export async function listarLancamentos(ctx, tenant, filtros: FiltrosLista, deps?): Promise<{ linhas: LancamentoNaTela[]; totais: TotaisDaLista; maisDe200: boolean }>;
export async function abrirLancamento(ctx, tenant, id: string, deps?): Promise<LancamentoNaTela | null>;
export async function pacientesParaLancamento(ctx, deps?): Promise<{ id; nome; arquivado: boolean }[]>; // ativos e arquivados, não bloqueados nem anonimizados
```
- `salvarConfiguracoes`: trava `fin_configuracoes` `FOR UPDATE`; `INSERT … ON CONFLICT DO NOTHING RETURNING` e só quem inseriu semeia as categorias (também com `ON CONFLICT DO NOTHING`); `recordAudit({ acao: 'alterar', entidade: 'financeiro_configuracoes', entidadeId: tenantId, patientId: null })` em toda gravação; erros da spec §6.2 ("Configurações: erros").
- `criarLancamento`: paciente `FOR KEY SHARE` e conferência de `status`/`anonimizado_em` sob a trava antes do INSERT (RN-317); categoria ativa do mesmo tipo; RN-304; `antesDoSaldo` quando `pagoEm < saldoInicialEm`.
- `editarLancamento`/`marcarRecebido`/`desfazerRecebimento`/`cancelarLancamento`: paciente (se houver) `FOR KEY SHARE` → lançamento `FOR UPDATE`; nunca `carregarPacienteParaEscrita`; bloqueado → só o permitido pela RN-315, com a mensagem da spec; anonimizado → "Este lançamento foi anonimizado e não pode mais ser alterado."; cancelado → a mensagem de cancelado. O 42501 do gatilho que escapar vira `FinanceiroError` com a mensagem certa (corrida com a anonimização), sem logar o valor.
- `listarLancamentos`: filtros da RN-306 (sem `mes` → mês atual; com `paciente` e sem `mes` → todos, limite 200 + `maisDe200`); `auditRead` (entidade `financeiro`) só com o filtro de paciente e quando devolve linha; `abrirLancamento` chama `auditRead` quando o lançamento tem paciente.
- Todas conferem `ctx.role === 'nutri'` e lançam `Error('financeiro: só a sessão nutri')` antes de abrir a transação.

- [ ] **Step 1: Testes que falham:**
  - `configuracoes.test.ts`: primeira gravação semeia as categorias uma vez (duas gravações concorrentes → um conjunto só); leitura não grava; saldo fora do intervalo, data no futuro (no fuso), valor "abc" → `FinanceiroError` com os textos exatos; `recordAudit` gravado sem paciente; "Consultas" não arquiva nem exclui (mensagem exata); categoria com lançamento não exclui (mensagem exata); nome repetido sem diferença de maiúsculas → "Já existe uma categoria com este nome.".
  - `lancamentos.test.ts`: cria entrada com paciente e saída sem; saída com paciente recusada; recebimento no futuro (fuso, servidor às 01:30 UTC do dia seguinte) recusado; forma obrigatória; `antesDoSaldo`; paciente bloqueado recusa criação com a mensagem exata; **Review Focus 3** bloqueio concorrente durante `criarLancamento` → `FinanceiroError` do bloqueado; bloqueado: recebe, desfaz, reduz, cancela; aumentar valor → mensagem exata; cancelado e anonimizado não mudam (mensagens); lista com `paciente` sem `mes` traz todos os meses e grava `ler` no `audit_log`; lista sem paciente não grava; `abrirLancamento` com paciente grava; sessão de paciente → erro do assert (não lista vazia); outro tenant não vê.
  - `guardas.test.ts` (RN-323, no estilo de `exportacao.test.ts`): nenhum arquivo de `src/modules/ia/**` importa `@/modules/financeiro` ou `@/db/schema/financeiro` nem contém o texto `fin_`.
  - `log.test.ts` (RNF-300, CS-302): força erros em `criarLancamento`, `editarLancamento` e `salvarConfiguracoes` com valor, descrição, motivo, categoria e nome conhecidos; o logger capturado e o `beforeSend` do Sentry (`src/lib/sentry-filtro.ts`) não recebem nenhum desses textos; conferir que os formulários do Financeiro ficam fora dos breadcrumbs de entrada (ajustar o filtro se preciso, com teste).
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/configuracoes.test.ts src/modules/financeiro/lancamentos.test.ts src/modules/financeiro/guardas.test.ts src/modules/financeiro/log.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(financeiro): configurações e lançamentos (P20-03)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` (travas, assert, `auditRead`) sem Critical/Important.

---

### Task 4: Agregados — Resumo, fluxo de caixa, 12 meses e pendências

**Files:**
- Create: `src/modules/financeiro/resumo.ts`
- Test: `src/modules/financeiro/resumo.test.ts`, `src/modules/financeiro/resumo-propriedade.test.ts`

**Interfaces:**
- Consumes: Tarefas 1–3.
- Produces:
```ts
export type ResumoDoMes = { configurado: boolean; saldoAtual: number | null; saldoDesde: string | null; semValorConsulta: boolean;
  entradas: { recebido: number; aReceber: number; atrasoAnterior: number }; saidas: { pago: number; aPagar: number; atrasoAnterior: number };
  pendentes: { pacientes: number; total: number }; ultimos: LancamentoNaTela[] /* 10 */ };
export async function resumoDoMes(ctx, tenant: { fuso: string }, deps?: { db?: Db; agora?: Date }): Promise<ResumoDoMes>;
export type FluxoDoAno = { ano: number; meses: string[]; categoriasEntrada: LinhaFluxo[]; categoriasSaida: LinhaFluxo[];
  totalEntradas: number[]; totalSaidas: number[]; resultado: number[]; saldoInicio: (number | null)[]; saldoFim: (number | null)[]; saldoDesde: string | null };
export async function fluxoDeCaixaDoAno(ctx, tenant, ano: number, deps?): Promise<FluxoDoAno>;
export async function entradasESaidas12Meses(ctx, tenant, deps?): Promise<{ mes: string; entradas: number; saidas: number; resultado: number }[]>;
export async function pagamentosPendentes(ctx, tenant, deps?): Promise<{ paciente: { id; nome }; total: number; quantidade: number; maisAntiga: string; emAtraso: boolean }[]>;
export async function pendenciasDoPaciente(ctx, tenant, patientId: string, deps?): Promise<{ paciente: { id; nome; bloqueado: boolean }; linhas: LancamentoNaTela[] } | null>;
```
- Uma transação por função; agregação no SQL (`sum(valor_centavos) filter (where …)`, `bigint` → texto → `number`); sem N+1. Saldo (RN-307): pagos com `pago_em >= saldo_inicial_em`, não cancelados. Fluxo (US-306): meses antes do saldo com `null` nas linhas de saldo; **no mês do saldo**, `saldoInicio` `null` e `saldoFim` = saldo + movimentos com `pago_em >= saldo_inicial_em` daquele mês; depois, início = fim anterior e fim = início + resultado. `atrasoAnterior`: em aberto com vencimento antes do dia 1º do mês corrente (RN-307).
- `pendenciasDoPaciente` chama `auditRead` (entidade `financeiro`) quando devolve linha; `resumoDoMes`, `pagamentosPendentes`, `fluxoDeCaixaDoAno` e `entradasESaidas12Meses` não chamam (RN-318).

- [ ] **Step 1: Testes que falham:** o cenário exato da US-305 (saldo R$ 1.500,00 em 01/11/2026 … → "Saldo atual" R$ 1.050,00) e o do atraso de meses anteriores; **Review Focus 4** virada do mês: entrada recebida em 2026-12-01 com `agora` = 2026-12-01T01:30:00Z (30/11 22:30 em `America/Sao_Paulo`) não conta em novembro como recebida e o "hoje" é 2026-11-30; fluxo do mês do saldo (início "—", fim = saldo + movimentos desde a data); pendências agrupadas e ordenadas pela mais antiga, selo de atraso; `pendenciasDoPaciente` grava `ler`, `pagamentosPendentes` não; RNF-301: 5.000 lançamentos no ano → cada função em uma transação (contar as consultas pelo log do `pg` no teste) e `resumoDoMes` < 800 ms no Testcontainers (só aviso, não gate, se a máquina estiver carregada).
- `resumo-propriedade.test.ts` (CS-301): 200 rodadas com lançamentos aleatórios (datas nas bordas: dia 1º, último dia, 00h00 e 23h59 locais, cancelados, antes do saldo); a soma do Resumo, das linhas do fluxo, dos 12 meses e das linhas do `csvLancamentos` do mês bate com a soma feita em memória, centavo a centavo; nos meses depois do saldo, `saldoFim = saldoInicio + resultado`.
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/resumo.test.ts src/modules/financeiro/resumo-propriedade.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(financeiro): resumo, fluxo de caixa e pendências (P20-04)`.

**Pronto quando:** testes verdes, inclusive a propriedade com semente fixa registrada no teste.

---

### Task 5: Menu, navegação interna, Configurações (primeiro acesso) e Resumo

**Files:**
- Create: `src/app/painel/financeiro/layout.tsx` (h1 por página; `nav aria-label="Seções do Financeiro"` com `aria-current`), `src/app/painel/financeiro/page.tsx` (Resumo ou "Comece por aqui"), `src/app/painel/financeiro/mensagens.tsx` (região `role="status"` sempre montada + foco no h1 quando `ok=`), `src/app/painel/financeiro/configuracoes/page.tsx`, `.../configuracoes/actions.ts`, `.../configuracoes/form-saldo.tsx`, `.../configuracoes/categorias.tsx`
- Modify: `src/app/painel/navegacao.ts` (item "Financeiro" entre "Conteúdos" e "Configurações"; `itemAtual` em `/painel/financeiro/…`; comentário "os seis itens" → "os itens do topo"), `src/app/painel/navegacao.test.ts` (ordem nova em todos os casos de `itensDoMenu`)
- Modify: `src/modules/ajuda/conteudo.ts` — guia novo `financeiro` (`versao: 1`, `padrao: /^\/painel\/financeiro(\/.*)?$/`, passos com `alvo` nos `data-guia` desta tarefa: `financeiro-secoes`, `financeiro-saldo`, `financeiro-valor-consulta`, `financeiro-categorias`, `financeiro-cartoes`), texto em rascunho; guia `boas-vindas` `versao` 3 → 4 (comentário `Plano 20: o passo do menu cita "Financeiro"`) com o passo do menu citando "Financeiro"
- Modify: `src/modules/ajuda/conteudo.test.ts` — `'src/modules/financeiro'` em `TSX_FORA`; expectativa do `boas-vindas` (≥ 4) e um teste do guia `financeiro`
- Modify: `e2e/painel-rotas.ts` — `'/painel/financeiro'` e `'/painel/financeiro/configuracoes'` em `ROTAS_DO_PAINEL` (a semente da T1 já deixa o Financeiro configurado)
- Test: `.../configuracoes/actions.test.ts`, `src/app/painel/financeiro/page.test.ts`, `src/app/painel/navegacao.test.ts`, `src/modules/ajuda/conteudo.test.ts`, `src/app/painel/rotas-axe.test.ts` (sem mudança: precisa continuar verde)

Páginas com `export const dynamic = 'force-dynamic'`, `requireNutri`, componentes de `src/components/ui`, tokens de `globals.css`, alvos `min-h-11`. Primeiro acesso: "Comece por aqui" + `comeceTexto` + botão "Configurar o Financeiro" (sem "Nova entrada"/"Nova saída"). Formulário de saldo e valor da consulta com `<form noValidate>`, estado `{ erros?, valores?, ok?, envio? }` e `key={state.envio}` (padrão de `consulta-form.tsx`); erros `role="alert"` ligados por `aria-describedby`; rótulos "Data do saldo", "Valor do saldo", "Valor da consulta" e as ajudas exatas. Categorias: listas "Entradas" e "Saídas", "Nova categoria", "Renomear", "Arquivar", "Reativar", "Excluir", selo "Arquivada"; nome acessível de cada botão começa pelo texto visível e cita a categoria (`Arquivar categoria Divulgação`). Resumo: os quatro cartões (com "Em atraso de meses anteriores" só quando > 0), aviso `semValorConsulta` com o link `informarValor`, "Últimos lançamentos" e "Ver todos os lançamentos" (o link aponta para a lista, criada na Tarefa 6).

- [ ] **Step 1: Testes que falham:** `actions.test.ts` — salva e redireciona com `?ok=config`; devolve `erros` e `valores` (o que foi digitado volta); sessão de outra usuária/tenant não salva; `page.test.ts` — sem configuração mostra "Comece por aqui" e não mostra "Nova entrada"; com configuração e sem valor da consulta mostra o aviso exato; `navegacao.test.ts` — "Financeiro" entre "Conteúdos" e "Configurações" em todas as combinações; `conteudo.test.ts` — guia `financeiro` v1, `boas-vindas` ≥ 4, `TSX_FORA` com o módulo.
- [ ] **Step 2:** `pnpm vitest run src/app/painel/financeiro src/app/painel/navegacao.test.ts src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar (ler `node_modules/next/dist/docs/` sobre layouts e Server Actions antes).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS. Medir o menu a 1280 px e 1024 px (R-310) no `next dev -p 3103`; registrar no commit.
- [ ] **Step 5:** commit `feat(painel): Financeiro — menu, configurações e resumo (P20-05)`.

**Pronto quando:** testes verdes; `revisor-interface` sem Critical/Important; CI (`pnpm test`) não quebra em `rotas-axe.test.ts` nem em `conteudo.test.ts`.

---

### Task 6: Lançamentos — lista, formulários, receber e cancelar

**Files:**
- Create: `src/app/painel/financeiro/lancamentos/page.tsx` (filtros, totais, lista), `.../lancamentos/filtros.tsx`, `.../lancamentos/novo/page.tsx`, `.../lancamentos/[id]/page.tsx`, `.../lancamentos/form-lancamento.tsx` (client), `.../lancamentos/receber.tsx`, `.../lancamentos/cancelar.tsx`, `.../lancamentos/actions.ts`
- Modify: `src/modules/ajuda/conteudo.ts` (passos do guia `financeiro` para a lista e o formulário: `financeiro-filtros`, `financeiro-novo`, `financeiro-receber`, `financeiro-cancelar`; a versão continua 1, o guia ainda não foi ao ar), `e2e/painel-rotas.ts` (`'/painel/financeiro/lancamentos'`, `'/painel/financeiro/lancamentos/novo'` com `?tipo=entrada`, `'/painel/financeiro/lancamentos/[id]'`), `e2e/painel.ts` (`prepararTelasComId` cria um lançamento com paciente pela UI e devolve `lancamento` em `IdsDoPainel`)
- Test: `.../lancamentos/actions.test.ts`, `.../lancamentos/page.test.ts`

Comportamento (spec US-301, US-302, RN-306, §6.2, §7):
- Filtro "Mês" em `<select>` (meses desde o lançamento mais antigo, mais recentes primeiro; "Todos os meses" só com `paciente`) + links "Mês anterior"/"Próximo mês"; chip "Paciente: {nome}" com "Limpar"; `totaisDaLista` em duas linhas; aviso dos 200.
- Formulário: "Paciente (opcional)" só na entrada, com ativos e arquivados ("(arquivado)"), sem bloqueados; ajudas da descrição por tipo; "Já foi recebido"/"Já foi pago" mostra data e forma; `noValidate`, `valores` + `key` como na Tarefa 5. Depois de salvar → `redirect('/painel/financeiro/lancamentos?mes=<mes>&ok=salvo[&aviso=antes_do_saldo]')`.
- Edição: h1 "Entrada — {categoria}"/"Saída — {categoria}"; tipo e paciente como texto; consulta ligada como link ("Cobrança da consulta de {dd/mm/aaaa}, {hh:mm}"); paciente bloqueado: aviso `bloqueado`, só valor (menor), receber/desfazer e cancelar; cancelado/anonimizado: só leitura com a mensagem.
- Receber/desfazer/cancelar na linha e na edição; cancelar com `avisoCancelar`, "Motivo do cancelamento" e "Confirmar cancelamento". Mensagens na região fixa de `mensagens.tsx`; foco no h1.

- [ ] **Step 1: Testes que falham:** `actions.test.ts` — criar devolve o redirect com `mes` e `aviso=antes_do_saldo` quando é o caso; erro devolve `valores`; paciente bloqueado recusa com o texto exato; aumentar valor de bloqueado recusa com o texto exato; cancelar sem motivo → "Informe o motivo do cancelamento."; outra sessão/tenant não grava. `page.test.ts` — sem `mes` lista o mês atual no fuso; `paciente` sem `mes` lista todos os meses; a saída não tem o campo "Paciente"; "Todos os meses" só com paciente.
- [ ] **Step 2:** `pnpm vitest run src/app/painel/financeiro/lancamentos src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(painel): Financeiro — lançamentos (P20-06)`.

**Pronto quando:** testes verdes; `revisor-interface` sem Critical/Important (região viva, foco, erro sem perder o digitado, `<select>` de mês).

---

### Task 7: Cobrança da consulta — os dois caminhos e a tela da consulta

**Files:**
- Create: `src/modules/financeiro/cobranca.ts`, `src/app/painel/agenda/consultas/[id]/cobranca.tsx`, `src/app/painel/agenda/consultas/[id]/cobranca-actions.ts`
- Modify: `src/modules/agenda/presenca.ts` (`registrarPresenca` passa a ler `tenants.fuso` na transação e devolve `{ cobranca: ResultadoCobranca | null }`; na passagem para `realizada` chama `cobrarConsultaRealizada(tx, …)`; na correção para `faltou` chama `aoCorrigirParaFaltou(tx, …)`; o `return` antecipado de "mesma situação" devolve `{ cobranca: null }`), `src/modules/pacientes/atendimentos.ts` (`registrarAtendimento` devolve `{ id, cobranca }`; chama `cobrarConsultaRealizada` depois de gravar `realizada`, linha ~83), `src/app/painel/agenda/actions.ts` (`presencaAction`: `?ok=presenca&cobranca=<resultado>[&valor=<centavos>]`), `src/app/painel/pacientes/[id]/atendimentos/actions.ts` (`?ok=atendimento&cobranca=…`), `src/app/painel/agenda/consultas/[id]/page.tsx` (seção "Cobrança" abaixo de "Registrar presença" e as mensagens), `src/app/painel/pacientes/[id]/atendimentos/[atendimentoId]/page.tsx` (mensagem no `Aviso`), chamadores de `registrarAtendimento` e `registrarPresenca` que dependiam do retorno antigo
- Modify: `src/modules/ajuda/conteudo.ts` — guia `agenda` `versao` 1 → 2 (comentário `Plano 20: Realizada gera a cobrança`), texto do passo a passo citando a cobrança; `src/modules/ajuda/conteudo.test.ts`
- Test: `src/modules/financeiro/cobranca.test.ts`, `src/modules/agenda/presenca.test.ts`, `src/modules/pacientes/atendimentos.test.ts`, `src/app/painel/agenda/actions.test.ts` (casos novos), `src/app/painel/agenda/consultas/[id]/cobranca-actions.test.ts`

**Interfaces:**
- Consumes: Tarefas 1–3.
- Produces:
```ts
export type ResultadoCobranca =
  | { tipo: 'criada'; valorCentavos: number } | { tipo: 'sem_valor' } | { tipo: 'bloqueado' } | { tipo: 'ja_existia' } // passagem a Realizada
  | { tipo: 'aberta' } | { tipo: 'recebida' } | { tipo: 'nenhuma' };                                                  // correção para Faltou (só leitura)
export async function cobrarConsultaRealizada(tx: Tx, a: { tenantId: string; fuso: string; consulta: { id: string; patientId: string; inicio: Date }; pacienteStatus: string; pacienteAnonimizado: boolean }): Promise<ResultadoCobranca>;
export async function aoCorrigirParaFaltou(tx: Tx, a: { consultaId: string }): Promise<ResultadoCobranca>;
export async function cobrancaDaConsulta(ctx, tenant, consultaId: string, deps?): Promise<{ cobranca: LancamentoNaTela | null; podeRegistrar: boolean; motivo: 'nao_configurado' | 'bloqueado' | 'nao_realizada' | null; valorSugerido: number | null }>;
export async function registrarCobrancaManual(ctx, tenant, consultaId: string, valor: string, deps?): Promise<{ id: string }>;
```
- `cobrarConsultaRealizada` roda **depois** das travas do caminho (paciente → consulta); sem configuração ou sem valor → `sem_valor`; bloqueado/anonimizado → `bloqueado`; `INSERT … ON CONFLICT (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL AND cancelado_em IS NULL DO NOTHING RETURNING id` (sem retorno → `ja_existia`); vencimento = data do início no fuso; categoria pela `chave = 'consultas'`.
- `aoCorrigirParaFaltou` **não grava** (F-D19 v0.2).
- `cobrancaDaConsulta` chama `auditRead` quando há cobrança (RN-318). `registrarCobrancaManual`: paciente `FOR KEY SHARE` → consulta → INSERT; RN-314; concorrência → "Esta consulta já tem uma cobrança.".

- [ ] **Step 1: Testes que falham:**
  - `cobranca.test.ts`: cria com o valor da configuração, vencimento no fuso (consulta às 22:30 locais de 30/11 vence em 30/11), categoria "Consultas", paciente e consulta ligados, autor = quem marcou; `sem_valor`; `bloqueado`; **Review Focus 3** duas transações cobrando a mesma consulta → uma linha só; `aoCorrigirParaFaltou` com aberta e recebida → resultado certo e **nenhuma** linha alterada; manual recusa consulta não realizada, Financeiro não configurado, bloqueado; seção da consulta grava `ler` só com cobrança.
  - `presenca.test.ts`: `realizada` devolve `{ cobranca: { tipo: 'criada', … } }`; mesma situação devolve `{ cobranca: null }` sem tocar no Financeiro; `faltou` com cobrança aberta devolve `aberta`; voltar a `realizada` com cobrança ativa → `ja_existia`, valor ajustado mantido.
  - `atendimentos.test.ts`: atendimento ligado a consulta `faltou` → consulta `realizada` + cobrança na mesma transação, retorno `{ id, cobranca: { tipo: 'criada' } }`; consulta já `realizada` → `cobranca: null`.
  - `actions.test.ts`: os quatro textos exatos da consulta e os dois do atendimento a partir da URL; os links para `/painel/financeiro/configuracoes`.
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/cobranca.test.ts src/modules/agenda/presenca.test.ts src/modules/pacientes/atendimentos.test.ts src/app/painel/agenda src/app/painel/pacientes/\[id\]/atendimentos src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar (nos arquivos da agenda, só a chamada e o retorno; a lógica fica em `cobranca.ts`).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(financeiro): cobrança da consulta realizada (P20-07)`.

**Pronto quando:** testes verdes; `revisor-rls` (travas e transação) e `revisor-interface` (mensagens, links, seção) sem Critical/Important; se o dono tiver respondido a F-P5 com (a) antes desta tarefa, ajustar `aoCorrigirParaFaltou` e a mensagem e registrar.

---

### Task 8: Pagamentos pendentes, Relatórios e CSV

**Files:**
- Create: `src/app/painel/financeiro/pendencias/page.tsx`, `.../pendencias/[patientId]/page.tsx`, `src/app/painel/financeiro/relatorios/page.tsx`, `.../relatorios/fluxo.tsx` (tabela no contêiner focável), `.../relatorios/barras.tsx` (SVG `aria-hidden`, classes com token, legenda em texto), `.../relatorios/baixar-csv.tsx` (client: valida o período e navega), `src/app/api/painel/financeiro/lancamentos.csv/route.ts`, `src/app/api/painel/financeiro/fluxo-de-caixa.csv/route.ts`
- Modify: `e2e/painel-rotas.ts` (`'/painel/financeiro/pendencias'`, `'/painel/financeiro/pendencias/[patientId]'`, `'/painel/financeiro/relatorios'`), `src/modules/ajuda/conteudo.ts` (passos `financeiro-pendentes`, `financeiro-relatorios`, `financeiro-csv`; versão 1)
- Test: `src/app/api/painel/financeiro/csv.test.ts`, `src/app/painel/financeiro/pendencias/page.test.ts`, `src/app/painel/financeiro/relatorios/page.test.ts`

Comportamento: lista de pendentes com `caption` "Pacientes com pagamento pendente", colunas da spec, `pendentesIntro`; detalhe com "Marcar como recebido" em cada linha, a região fixa e o estado vazio ("Nenhum pagamento pendente de {nome}." + "Voltar aos pagamentos pendentes"), link "Ver todos os lançamentos de {nome}" (`lancamentos?paciente=<id>`). Relatórios com "Ano" (`<select>`), as duas tabelas e a nota do saldo. Rotas CSV: `requireApiNutri`; em navegação, **nunca JSON** — 401 → redirect ao login com volta para Relatórios; 403 (DPA) → `/painel/dpa`; período inválido → 303 para `/painel/financeiro/relatorios?erro=periodo`; `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="lancamentos-AAAA-MM-DD-a-AAAA-MM-DD.csv"`, `Cache-Control: no-store`; `recordAudit` `exportar` (entidade `financeiro`): uma linha por paciente presente com `pacientes=1`, uma sem paciente com `pacientes=0` e no fluxo. Ler `node_modules/next/dist/docs/` sobre Route Handlers antes.

- [ ] **Step 1: Testes que falham:** `csv.test.ts` — BOM, `;`, CRLF; sem `pacientes` não há coluna "Paciente" e a descrição das entradas de pacientes sai vazia; com `pacientes=1` há coluna e um `exportar` por paciente; 367 dias → 303 para `?erro=periodo`; sem sessão → redirect ao login (não JSON); DPA pendente → `/painel/dpa`; sessão de paciente → recusa; cabeçalhos exatos. `pendencias/page.test.ts` — a lista não grava `ler`; o detalhe grava; estado vazio do detalhe com o texto exato. `relatorios/page.test.ts` — o contêiner tem `role="region"`, `tabIndex={0}` e `focus-visible:outline-offset-[-3px]`; `?erro=periodo` mostra o alerta junto do campo.
- [ ] **Step 2:** `pnpm vitest run src/app/api/painel/financeiro src/app/painel/financeiro/pendencias src/app/painel/financeiro/relatorios src/app/painel/cores.test.ts src/app/painel/rotas-axe.test.ts src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(painel): Financeiro — pendências, relatórios e CSV (P20-08)`.

**Pronto quando:** testes verdes; `cores.test.ts` verde sem exceção nova; `revisor-interface` sem Critical/Important.

---

### Task 9: LGPD — exportação, anonimização e textos da exclusão

**Antes:** `git fetch origin && git rebase origin/main` depois do merge do Plano 17 (e dos Planos 18/19, se entrarem antes); resolver conflitos em `lgpd.ts`, `exportacao-job.ts` e testes mantendo as duas contribuições.

**Files:**
- Create: `src/modules/financeiro/titular.ts`
- Modify: `src/modules/pacientes/exportacao-job.ts` (`montarDados`: chave `financeiro` por inclusão explícita, nos dois escopos, com os campos da spec §10; o comentário "todas as tabelas do paciente, menos as staff_only" passa a citar `ia_tarefas` e `fin_lancamentos`; tipo `DadosExportacao`), `src/modules/pacientes/exportacao.test.ts` (literais de `DadosExportacao`), `src/modules/pacientes/lgpd.ts` (`anonimizarVencidos`: `select app_anonimizar_financeiro(<paciente>)` antes do UPDATE de `patients`, ao lado de `app_anonimizar_aceites`), `src/modules/pacientes/lgpd.test.ts`, `src/email/templates.tsx` (`pedido_exclusao_registrado`, `exclusao_atendida`), `src/email/templates.test.ts` (ou o teste existente dos textos), `src/app/p/(portal)/perfil/privacidade.tsx` (`CONFIRMAR_EXCLUSAO`) e o teste dela, `src/app/painel/pacientes/[id]/privacidade/page.tsx` (frase da §6.2) e o teste dela
- Test: `src/modules/financeiro/titular.test.ts` + os acima

**Interfaces:**
- Produces: `financeiroParaExportacao(tx: Tx, patientId: string, hoje: string): Promise<FinanceiroExportado[]>` com `{ vencimento, pagoEm, valorCentavos, valor, formaDePagamento, formaDePagamentoRotulo, situacao, situacaoRotulo, categoria, descricao, consultaInicio, canceladoEm, motivoCancelamento }` — **sem** `criadoPor`/`canceladoPor`. Roda no `worker` (sem o assert de `nutri`).

- [ ] **Step 1: Testes que falham:** `titular.test.ts` — campos exatos (teste das chaves), situação no dia da exportação no fuso, sem autor; `exportacao.test.ts` — `dados.json` com `financeiro` nos dois escopos, `prontuario.pdf` sem mudança, nenhum arquivo novo no ZIP; `lgpd.test.ts` — anonimização limpa os textos, cancela os em aberto (`cancelado_por` nulo), mantém valor/datas/categoria/forma, marca `anonimizado_em`, e o resto da anonimização continua igual; atender o pedido de exclusão não mexe nos lançamentos; textos exatos dos dois e-mails, do `CONFIRMAR_EXCLUSAO` e da aba Privacidade (spec §6.2).
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/titular.test.ts src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts src/email "src/app/p/(portal)/perfil" "src/app/painel/pacientes/[id]/privacidade"` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm test test/isolamento.test.ts src/db` → PASS.
- [ ] **Step 5:** commit `feat(lgpd): Financeiro na exportação, na anonimização e nos textos da exclusão (P20-09)`.

**Pronto quando:** testes verdes; `normas-cfn-lgpd` e `revisor-rls` sem Critical/Important; textos ao paciente marcados para o pacote do advogado (E-09) no fechamento.

---

### Task 10: DPA 1.1

**Files:**
- Modify: `src/modules/plataforma/dpa.ts` (`DPA_VERSAO = '1.1'`, `DPA_VERSAO_DATA` fixa no PR), `src/modules/plataforma/textos-legais.ts` (texto 1.1 com as cláusulas 2 e 5 da spec §10, **sem mudar a numeração**; a 1.0 fica em `DPA_TEXTOS` fora do objeto literal, como a 1.0 hoje; `DPA_O_QUE_MUDOU`), `src/app/painel/dpa/page.tsx` (mostra `DPA_O_QUE_MUDOU`), `src/modules/ia/textos-legais.ts:331` (comentário "DPA (1.0, cláusula 8)" → citar que a cláusula 8 não mudou na 1.1)
- Modify (testes que fixam '1.0'): `src/app/painel/actions.test.ts:106`, `src/lib/tenant-session.test.ts:73`, `src/modules/plataforma/textos-legais.test.ts` (linhas ~75-82 e ~117: `DPA_VERSAO`, `DPA_TERMO`, `DPA_MUDOU`, chaves `['0.1-provisorio','1.0','1.1']`), `src/modules/plataforma/dpa.test.ts` (linhas ~61-78), `src/app/painel/dpa/page.test.ts:27` (regex `versão 1\.1`)
- Test: os acima + `src/modules/ia/textos-legais.test.ts` (o aditivo continua citando as mesmas cláusulas)

- [ ] **Step 1: Testes que falham:** `DPA_VERSAO` '1.1' e termo `dpa-1.1`; texto 1.1 com as frases exatas das cláusulas 2 e 5 e a mesma numeração de cláusulas da 1.0 (contar os títulos); `DPA_TEXTOS['1.0']` igual ao de hoje; quem aceitou a 1.0 é levada a `/painel/dpa` e as APIs do painel dão 403 até aceitar; aceitar grava `consents` `dpa-1.1`; a página mostra `DPA_MUDOU` com 1.1 e `DPA_O_QUE_MUDOU`.
- [ ] **Step 2:** `pnpm vitest run src/modules/plataforma src/app/painel/dpa src/app/painel/actions.test.ts src/lib/tenant-session.test.ts src/modules/ia/textos-legais.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm e2e:seed` (usa a constante) sem erro.
- [ ] **Step 5:** commit `feat(dpa): DPA 1.1 com o Financeiro (P20-10)`.

**Pronto quando:** testes verdes; `normas-cfn-lgpd` sem Critical/Important; `DPA_VERSAO_DATA` marcada no PR para conferir antes do merge (R-309).

---

### Task 11: Fechamento do PR 2 — E2E, acessibilidade, manuais, ajuda e runbook

**Files:**
- Create: `e2e/financeiro.spec.ts` (bloco de IP novo no cabeçalho, sem colidir com os existentes), `docs/operacao/financeiro.md`
- Modify: `e2e/acessibilidade-painel.spec.ts` (estados fora de `ROTAS_DO_PAINEL`: Financeiro **não configurado** em outro consultório de teste, formulário de lançamento com erro, detalhe de pendências vazio, nos modos claro e escuro com `escolherTema`, voltando a "Igual ao aparelho" no `afterAll`)
- Modify: `docs/manual-tecnico/` (capítulo novo do Financeiro com o próximo número livre, ou seção no `04`/`05` se o `guardiao-manual` preferir; `02-banco-de-dados.md` com as três tabelas, gatilhos e função; `README.md`: índice, glossário — "lançamento", "cobrança da consulta", "pagamentos pendentes", "saldo do caixa" — e divergências spec × código), manual do usuário (Docs) e Central de Ajuda (preparados pelo `guardiao-manual` para o dono aplicar), `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md` (só acrescentar: item do termo do paciente 1.1 com prazo, F-D17; "antes/depois" da edição, R-311; F-P1 a F-P5)
- Test: o próprio E2E

`docs/operacao/financeiro.md`: começo a partir do Dietbox (F-D28: saldo do caixa na data da virada e as pendências abertas como entradas previstas por paciente, inclusive de arquivados); aviso à Debby antes do deploy do DPA 1.1 (R-309) e conferência de `DPA_VERSAO_DATA`; conferência do primeiro mês (CS-303); nota da Res. CFN 856/2026, art. 68, II (informar o valor dos honorários antes; vigência a conferir no DOU) e o lembrete de sigilo do CSV com nomes.

- [ ] **Step 1: E2E que falha** (CS-300): a nutricionista cria um paciente novo e uma consulta já começada para ele → abre a consulta → "Realizada" → vê "Presença registrada. Cobrança de R$ 250,00 criada no Financeiro." → "Marcar como recebido" com "Pix" → "Recebimento registrado." → o paciente sai de "Pagamentos pendentes" → o Resumo mostra o lançamento em "Últimos lançamentos" (asserções sobre o paciente desta execução, nunca sobre os totais do consultório: a semente mantém lançamentos antigos). Primeiro acesso em outro consultório de teste: "Comece por aqui" → salva → Resumo. CSV: "Baixar CSV" com período de 13 meses mostra o alerta; com 1 mês baixa o arquivo (`page.waitForEvent('download')`). Axe nos estados acima, nos dois temas, a 1280 px e 360 px; seletores pelos nomes acessíveis.
- [ ] **Step 2:** `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3103 pnpm test:e2e e2e/financeiro.spec.ts e2e/acessibilidade-painel.spec.ts` → FAIL (um E2E de cada vez entre as sessões).
- [ ] **Step 3:** ajustes que o E2E pedir; manuais e ajuda pelo `guardiao-manual`; runbook; backlog.
- [ ] **Step 4:** `APP_URL=http://localhost:3103 pnpm test:e2e e2e/financeiro.spec.ts e2e/acessibilidade-painel.spec.ts e2e/agenda.spec.ts && pnpm test && pnpm lint && pnpm typecheck` → PASS. Rodar `pnpm e2e:seed` de novo e repetir o `financeiro.spec.ts` (banco reaproveitado, R-312).
- [ ] **Step 5:** commit `test(e2e)+docs: fechamento do Plano 20 — Financeiro (P20-11)`.

**Pronto quando:** E2E e suíte verdes duas vezes seguidas no banco reaproveitado; manual técnico conferido pelo `guardiao-manual`; textos para o dono (Docs, Central de Ajuda, pacote do advogado) prontos.

---

### Task 12: Seção "Financeiro" no Início da ficha (PR 3, depois do Plano 18)

**Antes:** merge do Plano 18 na `main`; `git rebase origin/main`; ler o registro de seções como mergeado (`src/modules/ficha/secoes/index.ts`, tipo `SecaoDaFicha`, teste de chaves de `ItemDaSecao`) — se divergir da spec do Plano 18 (RN-277), seguir o código e registrar a diferença.

**Files:**
- Create: `src/modules/ficha/secoes/financeiro.ts` (só chama o módulo do Financeiro); função `resumoFinanceiroDoPaciente(tx, patientId)` em `src/modules/financeiro/resumo.ts`
- Modify: `src/modules/ficha/secoes/index.ts` (uma linha no **fim** de `SECOES_DA_FICHA`), o teste de chaves das seções, `src/modules/ajuda/conteudo.ts` (guia do Início/prontuário, subir a `versao` se o texto mudar, com comentário `Plano 20`), `docs/manual-tecnico/` e a ajuda (o que a Tarefa 11 escreveu sobre a ficha)
- Test: `src/modules/ficha/secoes/financeiro.test.ts` e o teste de paridade/chaves do registro

Comportamento (US-308, RN-329): `disponivel` = Financeiro configurado; `resumo` = contador e os 3 mais recentes como `ItemDaSecao` (rótulo "Entrada — {categoria}", data de referência, situação; sem valor e sem descrição); "Ver todos" → `/painel/financeiro/lancamentos?paciente=<id>`; "Nova entrada" (pelo `adicionar` ou botão da seção, conforme o registro) só sem bloqueio; `auditRead` (entidade `financeiro`) uma vez por abertura do Início, só quando devolve lançamento; nada no "No app" (o paciente não vê o Financeiro).

- [ ] **Step 1: Testes que falham:** chaves exatas do `ItemDaSecao`; sem lançamento → contador 0 e nenhum `ler`; com lançamento → um `ler` por abertura; bloqueado sem "Nova entrada"; a seção roda na transação única do Início (RNF-260 do Plano 18).
- [ ] **Step 2:** `pnpm vitest run src/modules/ficha src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint`; E2E da ficha do Plano 18 e `e2e/acessibilidade-painel.spec.ts` com `APP_URL=http://localhost:3103` → PASS.
- [ ] **Step 5:** commit `feat(ficha): seção Financeiro no Início (P20-12)`.

**Pronto quando:** testes verdes; `revisor-interface` e `guardiao-manual` sem Critical/Important; PR 3 com o mesmo fluxo de revisão abaixo.

---

## Depois das tarefas (fluxo do CLAUDE.md)

Para cada PR (1, 2 e 3): revisão final do branch (workflow, com `revisor-rls` — gatilhos, travas, `staff_only`, `auditRead`/`exportar`, guarda do journal —, `normas-cfn-lgpd` — exportação integral (F-D22 v0.2), textos da exclusão ao paciente, CSV sem nomes, DPA 1.1, bloqueado só com receber/desfazer/reduzir/cancelar —, `revisor-interface` — mensagens, foco, região viva, contêiner rolável, menu com 9 itens, primeiro acesso nos dois temas — e `guardiao-manual` — manual técnico e ajuda) → uma onda de correções → `/code-review high` no PR **uma vez** → correções Critical/Important (Minor para o backlog) → re-revisão **só do diff das correções** → `/security-review` (CSV: injeção de fórmula, cabeçalhos, sessão; RLS e isolamento) → merge **só com o OK do dono** (merge = deploy; a migration do PR 1 roda no boot; sem merge das 03h às 07h30 BRT; sem snapshot da Hostinger). Se sobrar Critical/Important confirmado depois da re-revisão, parar e avisar o dono.

A sessão avisa a orquestradora a cada etapa (início, PR aberto, CI verde, revisão, pronto para merge) para o painel do backlog Paridade Dietbox. Antes do merge do PR 2: conferir `DPA_VERSAO_DATA`, avisar a Debby do novo aceite (R-309) e, se o Plano 17, 18 ou 19 tiver entrado depois do último rebase, refazer o rebase (o PR 2 não tem migration; o PR 1 refaz o §5 do `sessoes-paralelas.md`).
