# Plano 20 — Financeiro do consultório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a nutricionista controla o caixa do consultório no NutriDebby: lança entradas e saídas, a consulta marcada como Realizada vira cobrança sozinha, vê os pagamentos pendentes por paciente, o resumo do mês, o fluxo de caixa do ano e baixa o CSV para o contador — sem nada ir ao paciente.

**Architecture:** três tabelas `staff_only` (`fin_configuracoes`, `fin_categorias`, `fin_lancamentos`) com RLS de tenant (e de paciente em `fin_lancamentos`), gatilho de regras (colunas fixas, bloqueio, anonimização, autoria pelo banco) e sem DELETE. Um módulo `src/modules/financeiro/` com funções puras (dinheiro, situação, CSV) e funções de banco por `withTenant`. A cobrança nasce numa função só (`cobrarConsultaRealizada`) chamada na transação de `registrarPresenca` e de `registrarAtendimento`. Telas em `/painel/financeiro/…`; a seção da ficha entra no registro de seções do Plano 18.

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas, layouts, actions e Route Handlers) · Drizzle · PostgreSQL 16 (RLS) · Better Auth · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-nutridebby-20-financeiro-design.md` **v0.2** (aprovada pelo dono em 16/11/2026: "aprovo todas as recomendações, pode seguir"; revisão 0.2 na §17 da spec; ajustes técnicos que a revisão do plano levou à spec na §18). Backlog Paridade Dietbox, onda 1: PD-30, PD-31, PD-32, PD-33. Plano revisto em 17/11/2026 (executabilidade, banco e guardas, conflitos com os Planos 17, 18 e 19): ver "Revisão do plano" no fim.

## Ambiente da sessão (Sessão C)

| Item | Valor |
|---|---|
| Worktree | `/home/deploy/servidor/projetos/nutridebby-c` (`../nutridebby-c`) |
| Branch | `plano-20-financeiro` (rebaseado em `origin/main` 680eac3 em 17/11, já com o PR #50; o PR 1 de fundação sai de um branch próprio, `plano-20-fundacao`, a partir dele; ver "Ordem de entrega") |
| Porta | **3103** (`pnpm exec next dev -p 3103`; nunca `pnpm dev`, que fixa a 3100 do principal) |
| Banco | **`nutri_dev_c`** no Postgres de dev (`127.0.0.1:54329`) |
| Preparar | do worktree principal: `scripts/sessao-paralela.sh c plano-20-financeiro` (cria/reaproveita o worktree, o `.env.local` com porta e banco, o banco, `pnpm install --frozen-lockfile` e `pnpm db:migrate`). O script e o runbook `docs/operacao/sessoes-paralelas.md` estão na `main` desde o PR #50 |
| Variáveis | nenhuma `DATABASE_URL`, `DATABASE_URL_MIGRATOR`, `APP_URL` ou `DATA_DIR` exportada no shell (venceriam o `.env.local`); conferir só os nomes: `env \| cut -d= -f1 \| grep -E '^(DATABASE_URL\|APP_URL\|DATA_DIR)'` |
| Olhar o banco | `docker compose -f ../nutridebby/docker-compose.dev.yml exec db psql -U nutri_owner -d nutri_dev_c` (o MCP `postgres-dev` aponta para o banco do principal; **nunca** produção, regra 5) |
| E2E | `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3103 pnpm test:e2e <spec>` (a `APP_URL` só nesse comando); parar o `pnpm worker` da sessão antes; **um E2E de cada vez entre as sessões** (Mailpit único). Bloco de IP do `e2e/financeiro.spec.ts`: o que a orquestradora fixar (proposta: `10.9.34`; em uso hoje: 10.9.{0,2,3,5–8,10–17,19,26–29}; propostas para as outras sessões: 17 = 10.9.30, 18 = 10.9.31 e 10.9.32, 19 = 10.9.33) |
| Vitest | `pnpm vitest run <arquivos>` sobe o próprio Postgres (Testcontainers); três suítes ao mesmo tempo pesam na CPU: escalone com as outras sessões |

Proibido nesta sessão: tocar produção (nem leitura), `docker service update`, push, merge, editar outros worktrees, `nutri-backup.sh`.

## Global Constraints

- Regras 1, 2, 3, 7, 8 e 9 do `CLAUDE.md`: toda consulta a `fin_*` por `withTenant(ctx, fn)`; o admin nunca consulta; as três tabelas em `STAFF_ONLY`; `app_enable_audit('fin_lancamentos', 'financeiro')`; migrations com `DATABASE_URL_MIGRATOR`; `FABRICAS` de `test/isolamento.test.ts`.
- **Migrations:** número = o que `pnpm db:generate` der em cima da `main` do momento; **nada reservado**. Antes de abrir o PR 1 (e de novo se outro PR com migration entrar antes), seguir `docs/operacao/sessoes-paralelas.md` §5, passos 1 a 8: guardar as migrations do branch, rebase em `origin/main`, apagar as do branch e voltar o journal ao da `main`, `pnpm db:generate` de novo, recriar a custom `rls_financeiro` colando o SQL guardado, conferir encadeamento (`idx` seguidos, `prevId`, `pnpm drizzle-kit check`, `grep -rn "<número antigo>" src test docs CLAUDE.md`), recriar o banco `nutri_dev_c` (com OK do dono: é apagar, mesmo em dev) e rodar `pnpm test src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/migrate.test.ts src/db/migrate-owner.test.ts src/modules/financeiro/banco.test.ts` (o `migrate-owner.test.ts` é o único que migra com o migrator **sem** superusuário, como em produção; o CI migra como superusuário). O `when` de cada migration nova tem de ser maior que o último da `main` (a guarda da Tarefa 1 quebra o CI se não for).
- Dinheiro em **centavos inteiros** do formulário ao banco; nunca `parseFloat`/`Number("1.250,50")`; somas em `bigint` no SQL, convertidas para `number` abaixo de `Number.MAX_SAFE_INTEGER`.
- Datas de calendário (`date`) no fuso do consultório: "hoje" = `hojeNoFuso(tenant.fuso, agora)` (`src/modules/pacientes/datas.ts:23`); helpers de mês novos ficam em `src/modules/financeiro/meses.ts` — **não editar** `src/modules/agenda/fuso.ts` (disputado com o Plano 17).
- Situação calculada (sem coluna): Cancelado > Recebido/Pago > Em atraso (vencimento < hoje) > Previsto.
- Valor, descrição, motivo, categoria e nome de paciente **nunca** em log, Sentry ou mensagem de erro (regra 3; RN-322). Erros logam só código e motivo técnico.
- Nada do Financeiro no portal (`/p`), na página pública, em push, e-mail ou WhatsApp ao paciente (C-302), nem em contexto de IA (RN-323).
- Sem dependência nova; sem PDF; sem arquivo novo em `stored_files` (C-303, C-304).
- Funções do módulo conferem `ctx.role === 'nutri'` antes de abrir a transação (exceto `titular.ts`, do worker).
- Textos de interface em pt-BR, **exatos** da spec §6.2, em `MSG_FINANCEIRO` (`src/modules/financeiro/constantes.ts`). Rótulos de botão e campo podem morar nos `.tsx`; os que um guia cita entre aspas e moram no módulo exigem `'src/modules/financeiro'` em `TSX_FORA` (`src/modules/ajuda/conteudo.test.ts:13`).
- Correção para "Faltou" **não** cancela cobrança (F-D19 v0.2, como a F-D7 aprovada); se o dono escolher a opção (a) da F-P5 antes da Tarefa 7, ela muda (meia tarefa).
- Arquivos disputados (`sessoes-paralelas.md` §6): `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md`, `navegacao.ts`, `src/db/schema/index.ts`, `src/modules/plataforma/audit.ts` (e o teste), `src/modules/pacientes/lgpd.ts`, `src/modules/pacientes/exportacao-job.ts` e `exportacao.test.ts`, `scripts/e2e-seed.ts`, `e2e/painel-rotas.ts`, `e2e/acessibilidade-painel.spec.ts`, `src/modules/ajuda/conteudo.ts` (e o teste), `docs/manual-tecnico/`, `.claude/agent-memory/**`, índice dos planos e backlog — **só acrescentar**, no fim da lista, do objeto ou do bloco, sem reordenar nem reformatar, seguindo o formato que a `main` tiver no rebase (o Plano 17 já pôs `IMUTAVEIS` um item por linha: entrada nova como linha nova no fim). No rebase, manter as duas contribuições (nunca escolher um lado inteiro): em `SEM_DELETE` o Plano 18 também acrescenta (`patient_cadastro`); em `SO_APAGA.patients` o filtro do 20 e o do 18 entram como linhas `and not exists …` no fim da mesma expressão; em `e2e/painel-rotas.ts`, juntar as rotas de todos (o `rotas-axe.test.ts` exige uma por `page.tsx`).
- **`CLAUDE.md` no rebase:** cada regra é uma linha física (conflito garantido com os Planos 17, 18 e 19). Ficar com a linha da `main` e reacrescentar só a frase do Plano 20 no fim de cada regra; conferir `grep -c "Plano 1[789]" CLAUDE.md` antes e depois (o número não pode cair).
- **Nome do paciente nas telas** (Plano 18, D7/RN-266): se o PR 2 do Plano 18 (nome social) estiver na `main` no rebase do PR 2, as telas do Financeiro (seletor de paciente, chip "Paciente: {nome}", pendências, edição, mensagens) mostram o nome pelo helper de exibição do Plano 18 (nome social primeiro); o **CSV para o contador** sai com o **nome civil** (`patients.nome`: documento fiscal). Se o Plano 20 entrar antes, o Plano 18 inclui as telas do Financeiro e `e2e/financeiro.spec.ts`/`e2e/painel.ts` na troca (aviso à orquestradora). E2E que cria paciente usa o helper `e2e/portal.ts` (os rótulos do formulário de paciente mudam no PR 2 do Plano 18: "Nome completo", "Celular / WhatsApp (opcional)").

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
| **PR 0 — guarda do journal (opcional)** | parte da T1 | Já, se a orquestradora quiser: PR mínimo, sem migration, só com a guarda do `_journal.json` em `src/db/migrate.test.ts` (e, se ela quiser, a reserva dos blocos de IP do E2E) | Protege todo merge de migration da onda, inclusive o do Plano 17. Se sair, a T1 não a repete |
| **PR 1 — fundação** | T1 | Na fila de migrations (uma por vez), **depois do Plano 17** (0118–0120 já commitadas, e os Planos 18 e 19 contam com elas antes). Exceção, decisão da orquestradora: se o 17 estiver a mais de ~1 dia do merge quando o PR 1 ficar pronto, o PR 1 entra antes (o SQL do 20 não toca objeto do 17, e o 17 refaz o §5) | É o que as outras sessões encontram na `main` ao fazer rebase (tabelas, guardas, listas de isolamento, semente do E2E, guarda do journal); pequeno, revisão rápida |
| **PR 2 — Financeiro** | T2 a T11 | Depois do merge do PR 1 e do Plano 17 (a T9 mexe em `lgpd.ts`/`exportacao-job.ts`; rebasear também sobre os Planos 18 e 19 se entrarem antes) | **Sem migration** (não espera a fila de migrations, só o trem de CI). A LGPD (T9) vai no mesmo deploy da primeira escrita de lançamento com paciente (R-313): o PR 2 não vai a merge sem a T9 |
| **PR 3 — ficha** | T12 | Depois do merge do **PR 1** do Plano 18 (onde nasce o registro de seções; a seção não depende do `patient_cadastro` nem do "No app") **e** da decisão do contrato da seção (T12, "Antes") | PD-33 depende do PD-12 |

**Branch do PR 2 depois do merge do PR 1.** O §5 regenera as migrations no `plano-20-fundacao`; o `plano-20-financeiro` continua com os commits velhos da T1 (migrations com número e `when` velhos), e um rebase simples conflita no `drizzle/` ou duplica a migration. Depois do merge do PR 1:

```bash
git fetch origin
git rebase --onto origin/main <último commit da T1> plano-20-financeiro   # descarta os commits da T1, já na main
git diff origin/main -- drizzle/                                          # tem de sair vazio
```

Depois, recriar o `nutri_dev_c` do zero (§5, passo 7, **com OK do dono**: é apagar, mesmo em dev).

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
| `src/modules/financeiro/tipos.ts` | Tipos compartilhados entre as tarefas (`LinhaCsv`, `LinhaFluxo`, `FluxoDoAno`, `FiltrosLista`, `TotaisDaLista`, `LancamentoNaTela`) |
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
| `src/modules/plataforma/dpa.ts`, `src/app/painel/dpa/page.tsx` (modificar) | DPA 1.1 (o texto do DPA mora em `dpa.ts`; `textos-legais.ts` não existe em `plataforma/`, só o teste `textos-legais.test.ts`) |
| `src/modules/ficha/secoes/financeiro.ts` (PR 3) | Seção do Início |
| `e2e/financeiro.spec.ts` | E2E (bloco de IP fixado pela orquestradora) |
| `docs/operacao/financeiro.md` | Runbook (começo a partir do Dietbox, aviso do DPA, nota da Res. 856) |

---

### Task 1: Fundação — tabelas, RLS, gatilhos, guardas e semente do E2E (PR 1)

**Files:**
- Create: `src/db/schema/financeiro.ts`; export em `src/db/schema/index.ts` (uma linha no fim)
- Create: `drizzle/<NNNN>_financeiro.sql` (`pnpm db:generate`), `drizzle/<NNNN+1>_rls_financeiro.sql` (`pnpm drizzle-kit generate --custom --name rls_financeiro`)
- Modify: `src/db/rls-guard.ts` (`STAFF_ONLY`: as três, com o motivo da spec §9.5), `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO.financeiro = 'Financeiro'`; `financeiro_configuracoes` sem rótulo no Histórico do paciente, porque não tem paciente)
- Modify: `test/isolamento.test.ts` — `FABRICAS` das três (`fin_configuracoes` com `ON CONFLICT DO NOTHING`; `fin_categorias` com nome único por chamada; `fin_lancamentos` como entrada com paciente, sem consulta, criando a categoria no mesmo comando por CTE); `COM_MAE`: `fin_lancamentos` (comentário: escolha registrada na spec §9.5, prova própria em `banco.test.ts`); `SEM_DELETE` e `DELETE_REVOGADO`: `fin_lancamentos`, `fin_configuracoes`; `IMUTAVEIS`: `fin_lancamentos` (linha nova no fim, no formato da `main`; comentário: `Plano 20: fin_lancamentos_regras recusa mudar tenant_id/patient_id com 42501 antes da RLS`); `SO_APAGA`: filtro de `patients` (linha `and not exists (select 1 from fin_lancamentos f where f.tenant_id = patients.tenant_id and f.patient_id = patients.id)` no fim da expressão) e chave nova `fin_categorias` no fim do objeto (sem lançamento e `chave is null`). **`fin_categorias` não entra em `ULTIMAS`** (spec §9.5 revista): a única filha dela é `fin_lancamentos`, que está em `SEM_DELETE` (nunca é apagada no teste), e o `SO_APAGA.fin_categorias` já deixa de fora as categorias com lançamento; assim `ULTIMAS` não é tocada (sem conflito com o Plano 17, que pôs `lembretes_rotina` antes de `patients`)
- Modify: `src/db/migrate.test.ts` — guarda do journal
- Modify: `scripts/e2e-seed.ts` — limpeza da agenda com lançamentos (spec §9.5); o consultório do E2E sai **configurado** (linha de `fin_configuracoes` com saldo de R$ 1.000,00 no dia 1º do mês corrente e valor da consulta R$ 250,00, e as categorias iniciais com `ON CONFLICT DO NOTHING`, no contexto `worker`). **Primeiro acesso repetível** (o banco de dev é reaproveitado e a linha de `fin_configuracoes` não se apaga: DELETE/TRUNCATE revogados; não resolver liberando DELETE nem com o migrator, regra 1): a cada execução a semente cria **dois consultórios novos, ainda sem Financeiro** — slug com sufixo único (`e2e-fin-novo-<timestamp>` e `e2e-fin-axe-<timestamp>`), DPA aceito com `DPA_VERSAO`, sem linha em `fin_configuracoes` — e duas contas de nutricionista com e-mail fixo (`E2E_FIN_NOVO`, que o `financeiro.spec` configura, e `E2E_FIN_AXE`, que o axe do estado "não configurado" nunca configura), apagadas e recriadas apontando para o consultório da execução, no molde de `E2E_NUTRI` (linhas 90-92), com `guia: TUDO_VISTO`. Assim a ordem entre as specs não importa. Os consultórios das execuções anteriores ficam no banco de dev (sem conta)
- Modify: `CLAUDE.md` (no rebase, ver "Global Constraints") — regra 1 (frase nova: `fin_*` são `staff_only`, só a sessão `nutri`; `titular.ts` e `app_anonimizar_financeiro` no `worker`), regra 2 (Plano 20: as três em `STAFF_ONLY`; `fin_lancamentos` e `fin_configuracoes` em `SEM_DELETE`/`DELETE_REVOGADO`; `fin_lancamentos` em `IMUTAVEIS` e `COM_MAE`; gatilhos `fin_lancamentos_regras` e `fin_categorias_fixas`; marcador `app.fin_anonimizando` só por `app_anonimizar_financeiro`), regra 8 (entidade `financeiro`, "Financeiro"; `auditRead` só nas telas de um paciente; `exportar` no CSV; `financeiro_configuracoes` com `recordAudit` sem paciente) — frases novas no fim de cada regra
- Test: `src/modules/financeiro/banco.test.ts`, `src/db/migrate.test.ts`, `src/db/migrate-owner.test.ts`, `src/modules/plataforma/audit.test.ts`

**Interfaces:**
- Produces: `finConfiguracoes`, `finCategorias`, `finLancamentos`, tipos `FinLancamentoRow`, `FinCategoriaRow`, `TipoLancamento = 'entrada' | 'saida'`, `FORMAS_DE_PAGAMENTO` e `FormaPagamento` — **fonte única** em `src/db/schema/financeiro.ts` (o CHECK da coluna usa a lista); `constantes.ts` (T2) importa daqui e só acrescenta `ROTULO_FORMA`.
- `criado_por` e `cancelado_por` são `uuid` **sem FK** para `user` (molde de `enviado_por`): a semente do E2E apaga e recria as contas a cada execução (linhas 90-92) e as fábricas do isolamento usam `actorUserId: randomUUID()`; com FK, as duas quebram.

Colunas, CHECKs, FKs e índices exatamente como a spec §9.1 a §9.3 (inclusive `fin_lancamentos_consulta_ativa_unique` com predicado em literais, como `tipoUmPorHorario`). Migration custom (molde da 0116/0117), na ordem: `app_enable_tenant_rls` + `app_enable_staff_only` nas três; `app_enable_patient_rls('fin_lancamentos')`; `app_enable_audit('fin_lancamentos', 'financeiro')`; `REVOKE DELETE, TRUNCATE` em `fin_lancamentos` e `fin_configuracoes`; gatilho `fin_categorias_fixas` (BEFORE UPDATE OR DELETE); gatilho `fin_lancamentos_regras` (BEFORE INSERT OR UPDATE, regras da spec §9.4, comparações com `IS DISTINCT FROM`, `ERRCODE = '42501'`); função `app_anonimizar_financeiro(p_patient uuid)` (`SECURITY INVOKER`, `SET search_path = public, pg_temp`, nomes com `public.`, paciente `FOR UPDATE`, marcador ligado e desligado, `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO nutri_app_role`).
- **Ordem dentro do gatilho `fin_lancamentos_regras`** (o `BEFORE INSERT` roda antes do `WITH CHECK` da RLS; escrever assim e não "consertar" afrouxando o teste): (1) contexto vazio ou `worker` → 42501 (no UPDATE, o `worker` só passa no ramo da anonimização com o marcador); (2) qualquer papel diferente de `nutri` → `RETURN NEW` **sem ler `patients`** (paciente, `publico` e `conta` são recusados pela RLS da própria tabela; se o gatilho lesse o paciente antes, nesses contextos ele vem vazio pela RLS e a mensagem ou a trava mudam); (3) só na sessão `nutri` lê `status, anonimizado_em` do paciente com `FOR KEY SHARE` — no INSERT **e** no ramo de UPDATE (hoje quem trava no UPDATE é o módulo; o gatilho também trava, como defesa).
- `SET search_path = public, pg_temp` e nomes com `public.` também nas funções dos gatilhos `fin_lancamentos_regras` e `fin_categorias_fixas` (leem `patients`/`fin_lancamentos`: uma tabela temporária com esse nome contornaria a RN-315; molde 0102/0116).
- **Anonimização só depois do prazo** (defesa a mais; spec §9.4 revista): `app_anonimizar_financeiro` exige também `anonimizar_apos IS NOT NULL AND anonimizar_apos < ` hoje no fuso do tenant (`(now() AT TIME ZONE t.fuso)::date`, lendo `public.tenants`), como o filtro de `anonimizarVencidos` (`lt(patients.anonimizarApos, hoje)`). Nas condições com `current_setting(...)`, usar `coalesce(current_setting('app.fin_anonimizando', true), '') = '1'`/`IS DISTINCT FROM`: com `IF NOT (...)` um NULL deixa passar.

- [ ] **Step 1: Testes que falham** em `banco.test.ts` (sessões por `withTenant` e o helper de `test/sessao.ts`/`test/pacientes.ts`):
  - `nutri cria e lê; paciente, publico e conta não leem nenhuma linha` (`staff_only`, `publico_negado`).
  - `INSERT pela sessão de paciente, publico e conta em fin_lancamentos com categoria já existente → erro de RLS da própria tabela`; `pela worker → 42501 do gatilho` (prova que `COM_MAE` não esconde a política, spec §9.5); o mesmo com um paciente **invisível** ao contexto (`publico`/`conta`): o gatilho deixa passar e a recusa é da RLS, nunca um 42501 próprio.
  - `criado_por é o da sessão` — INSERT com `criado_por` de outro usuário grava `app_current_user()`.
  - `colunas fixas` — UPDATE de `tipo`, `patient_id`, `appointment_id`, `criado_por`, `created_at` → 42501; UPDATE sem mudança passa.
  - `cancelamento` — sem motivo → violação de CHECK; com motivo, `cancelado_por` = usuária da sessão e `cancelado_em` do banco (mesmo se o módulo mandar outro); depois de cancelado, UPDATE de `valor_centavos` → 42501.
  - `saída com paciente`, `consulta sem paciente`, `categoria de outro tipo` (FK composta), `pago sem forma`, `valor 0` → violação de CHECK/FK.
  - `paciente bloqueado` — INSERT → 42501; UPDATE de `pago_em`/`forma_pagamento` passa; `valor_centavos` menor passa, maior → 42501; `vencimento`, `categoria_id`, `descricao` → 42501; cancelar passa.
  - `bloqueio concorrente` — transação A `FOR UPDATE` no paciente e o leva a `bloqueado`; transação B insere lançamento dele (o gatilho espera no `FOR KEY SHARE`); A confirma → B recebe 42501.
  - `anonimização` — `app_anonimizar_financeiro` fora do `worker` → recusa; paciente não bloqueado → recusa; bloqueado com `anonimizar_apos` hoje ou no futuro (no fuso) → recusa; no `worker` com paciente bloqueado: textos nulos, `anonimizado_em` preenchido, em aberto vira cancelado com `cancelado_por` nulo, valor/datas/categoria/forma iguais; depois, `current_setting('app.fin_anonimizando', true)` vazio na mesma transação; qualquer UPDATE depois → 42501; UPDATE com o marcador ligado à mão pela sessão `nutri` → 42501.
  - `uma cobrança ativa por consulta` — segunda com a mesma `appointment_id` e `cancelado_em` nulo → violação do índice; depois de cancelar a primeira, a segunda entra.
  - `Consultas` — arquivar → CHECK; DELETE → 42501; mudar `chave`/`tipo` → 42501; renomear passa.
  - `DELETE e TRUNCATE revogados` em `fin_lancamentos` e `fin_configuracoes` (42501 de permissão).
  - `escrita vira audit_log` — INSERT e UPDATE pela `nutri` gravam `audit_log` com entidade `financeiro` e o `patient_id`; lançamento sem paciente grava sem paciente.
  - Em `migrate.test.ts`: `journal: when estritamente crescente e idx sem buraco` (lê `drizzle/meta/_journal.json`; `entries[i].idx === i` e `entries[i].when > entries[i-1].when`).
  - Em `audit.test.ts`: `ENTIDADE_ROTULO.financeiro` é `Financeiro` (chave nova depois de `lembretes`, se o Plano 17 já estiver na `main`).
  - Em `migrate-owner.test.ts` (migra com o migrator sem superusuário, como em produção): `nutri_app` executa `app_anonimizar_financeiro`; DELETE em `fin_lancamentos` e em `fin_configuracoes` → 42501.
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/banco.test.ts src/db/migrate.test.ts src/modules/plataforma/audit.test.ts` → FAIL (tabelas não existem; a guarda do journal já deve passar na `main` — se falhar, parar e avisar a orquestradora: é um problema da `main`).
- [ ] **Step 3:** schema, `pnpm db:generate`, migration custom, `pnpm db:migrate` (com o `DATABASE_URL_MIGRATOR` do `.env.local`, regra 7); listas das guardas; `audit.ts`; semente; `CLAUDE.md`.
- [ ] **Step 4:** `pnpm vitest run src/modules/financeiro/banco.test.ts src/db/migrate.test.ts src/db/migrate-owner.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/modules/plataforma/audit.test.ts test/isolamento.test.ts` → PASS; `pnpm typecheck && pnpm lint`. Semente no `nutri_dev_c`: `pnpm e2e:seed`; depois, **exercitar a limpeza** — como `nutri` do consultório E2E (psql com `set_config('app.tenant_id', …)`/`app.role` = `nutri` e `app.user_id`, ou um script de uma linha com `withTenant`), criar uma cobrança ligada a uma consulta do consultório E2E; rodar `pnpm e2e:seed` de novo → sem erro, a consulta com lançamento ficou `cancelada` (`cancelado_por = 'sistema'`), as outras saíram; os consultórios do primeiro acesso da execução não têm linha em `fin_configuracoes` (conferir pelo psql do dev).
- [ ] **Step 5:** commit `feat(financeiro): tabelas, RLS, gatilhos e guardas do Financeiro (P20-01)`.

**Pronto quando:** testes acima verdes; `pnpm e2e:seed` repetível (com a limpeza exercitada); revisão do `revisor-rls` sem Critical/Important; procedimento do §5 do `sessoes-paralelas.md` feito em cima da `main` atual; PR 1 aberto (sem push sem o OK; a orquestradora conduz).

---

### Task 2: Regras puras — dinheiro, situação, meses e CSV

**Files:**
- Create: `src/modules/financeiro/constantes.ts`, `tipos.ts`, `dinheiro.ts`, `situacao.ts`, `meses.ts`, `csv.ts`
- Test: `src/modules/financeiro/dinheiro.test.ts`, `situacao.test.ts`, `meses.test.ts`, `csv.test.ts`, `constantes.test.ts`

**Interfaces:**
- Produces:
```ts
// constantes.ts
export const VALOR_MAX_CENTAVOS = 100_000_000; export const SALDO_MAX_CENTAVOS = 1_000_000_000;
export const DESCRICAO_MAX = 200; export const MOTIVO_MAX = 200; export const NOME_CATEGORIA_MAX = 60;
export { FORMAS_DE_PAGAMENTO, type FormaPagamento } from '@/db/schema/financeiro'; // fonte única: T1
export const ROTULO_FORMA: Record<FormaPagamento, string>; // "Pix" … "Outra"
export const CATEGORIAS_INICIAIS: { tipo: 'entrada' | 'saida'; nome: string; chave: 'consultas' | null }[];
export const MSG_FINANCEIRO: { … }; // todos os textos da spec §6.2, chave por chave
// tipos.ts (definidos aqui para a T2 não depender da T4; a T3 e a T4 importam daqui)
export type LinhaCsv = { vencimento: string; pagoEm: string | null; tipo: 'entrada' | 'saida'; categoria: string; descricao: string | null;
  paciente: string | null /* nome civil */; forma: FormaPagamento | null; valorCentavos: number; situacao: Situacao };
export type LinhaFluxo = { categoria: string; valores: number[] /* 12 meses, centavos */ };
export type FluxoDoAno = { ano: number; meses: string[]; categoriasEntrada: LinhaFluxo[]; categoriasSaida: LinhaFluxo[];
  totalEntradas: number[]; totalSaidas: number[]; resultado: number[]; saldoInicio: (number | null)[]; saldoFim: (number | null)[]; saldoDesde: string | null };
export type FiltrosLista = { mes?: string /* 'AAAA-MM' */; tipo?: 'entrada' | 'saida'; situacao?: Situacao; categoriaId?: string; pacienteId?: string };
export type TotaisDaLista = { entradas: { recebido: number; aReceber: number }; saidas: { pago: number; aPagar: number } };
export type LancamentoNaTela = { id; tipo; categoria: { id; nome }; valorCentavos; vencimento; pagoEm; forma; descricao; paciente: { id; nome; bloqueado: boolean } | null; consulta: { id; inicio: Date } | null; situacao: Situacao; canceladoEm; motivoCancelamento; anonimizado: boolean };
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

- [ ] **Step 1: Testes que falham** com os exemplos acima e: `situacaoDoLancamento` com vencimento hoje → previsto; ontem → em atraso; cancelado vence tudo; saída paga → `pago`; `dataDeReferencia` pela data de pagamento quando há; `meses.test.ts`: fevereiro de 2028 (bissexto), `ultimos12Meses('2026-11-16')` começa em `2025-12`; `csv.test.ts`: BOM no início, CRLF, `;`, "=HIPERLINK(…)" → "'=HIPERLINK(…)", tabulação e CR neutralizados, descrição vazia na linha com paciente sem a opção, presente com a opção; `constantes.test.ts`: `CATEGORIAS_INICIAIS` igual às 12 da RN-302 (2 de entrada, "Consultas" com chave `consultas` e "Outras entradas"; 10 de saída), na ordem e com os nomes exatos; os textos de `MSG_FINANCEIRO` iguais à §6.2 (amostra das mensagens de erro e das quatro mensagens da consulta).
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/dinheiro.test.ts src/modules/financeiro/situacao.test.ts src/modules/financeiro/meses.test.ts src/modules/financeiro/csv.test.ts src/modules/financeiro/constantes.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(financeiro): dinheiro, situação, meses e CSV (P20-02)`.

**Pronto quando:** testes verdes; nenhum `parseFloat`/`Number(` sobre texto do usuário em `src/modules/financeiro` (grep no review).

---

### Task 3: Configurações e lançamentos (módulo)

**Files:**
- Create: `src/modules/financeiro/configuracoes.ts`, `src/modules/financeiro/lancamentos.ts`, `src/modules/financeiro/erros.ts`
- Test: `src/modules/financeiro/configuracoes.test.ts`, `lancamentos.test.ts`, `guardas.test.ts`, `log.test.ts`; `src/app/sw-escopo.test.ts` (sem mudança, continua verde)

**Interfaces:**
- Consumes: Tarefa 1 (tabelas), Tarefa 2 (todas, inclusive `tipos.ts`: `LancamentoNaTela`, `FiltrosLista`, `TotaisDaLista`).
- Produces:
```ts
export class FinanceiroError extends Error { constructor(public erros: Record<string, string>) } // mensagens de MSG_FINANCEIRO
export type Configuracao = { saldoInicialCentavos: number; saldoInicialEm: string; valorConsultaCentavos: number | null };
export async function lerConfiguracoes(ctx: TenantContext, deps?: { db?: Db }): Promise<Configuracao | null>;
export async function salvarConfiguracoes(ctx: TenantContext, tenant: { fuso: string }, input: unknown, deps?: { db?: Db; agora?: Date }): Promise<void>;
export async function listarCategorias(ctx: TenantContext, deps?): Promise<FinCategoriaRow[]>;
export async function criarCategoria / renomearCategoria / arquivarCategoria / reativarCategoria / excluirCategoria(ctx, …): Promise<void>;
export async function criarLancamento(ctx, tenant, input: unknown, deps?): Promise<{ id: string; antesDoSaldo: boolean; mes: string }>;
export async function editarLancamento(ctx, tenant, id: string, input: unknown, deps?): Promise<{ antesDoSaldo: boolean; mes: string }>;
export async function marcarRecebido(ctx, tenant, id: string, input: { pagoEm: string; forma: string }, deps?): Promise<{ mes: string }>;
export async function desfazerRecebimento(ctx, id: string, deps?): Promise<void>;
export async function cancelarLancamento(ctx, id: string, motivo: string, deps?): Promise<void>;
export async function listarLancamentos(ctx, tenant, filtros: FiltrosLista, deps?): Promise<{ linhas: LancamentoNaTela[]; totais: TotaisDaLista; maisDe200: boolean; meses: string[] /* do mês do lançamento mais antigo (data de referência) até o atual, mais recentes primeiro: o <select> da RN-306 */ }>;
export async function abrirLancamento(ctx, tenant, id: string, deps?): Promise<LancamentoNaTela | null>;
export async function pacientesParaLancamento(ctx, deps?): Promise<{ id; nome; arquivado: boolean }[]>; // ativos e arquivados, não bloqueados nem anonimizados
```
- `salvarConfiguracoes`: trava `fin_configuracoes` `FOR UPDATE`; `INSERT … ON CONFLICT DO NOTHING RETURNING` e só quem inseriu semeia as categorias (também com `ON CONFLICT DO NOTHING`); `recordAudit({ acao: 'alterar', entidade: 'financeiro_configuracoes', entidadeId: tenantId, patientId: null })` em toda gravação; erros da spec §6.2 ("Configurações: erros").
- `criarLancamento`: paciente `FOR KEY SHARE` e conferência de `status`/`anonimizado_em` sob a trava antes do INSERT (RN-317); categoria ativa do mesmo tipo; RN-304; `antesDoSaldo` quando `pagoEm < saldoInicialEm`.
- `editarLancamento`/`marcarRecebido`/`desfazerRecebimento`/`cancelarLancamento`: paciente (se houver) `FOR KEY SHARE` → lançamento `FOR UPDATE`; nunca `carregarPacienteParaEscrita`; bloqueado → só o permitido pela RN-315, com a mensagem da spec; anonimizado → "Este lançamento foi anonimizado e não pode mais ser alterado."; cancelado → a mensagem de cancelado. O 42501 do gatilho que escapar vira `FinanceiroError` com a mensagem certa (corrida com a anonimização), sem logar o valor.
- `criarLancamento`/`editarLancamento`: RN-304 inteira, inclusive o intervalo das datas — vencimento de 01/01/2000 até 31/12 do ano de hoje + 5 (no fuso); recebimento de 01/01/2000 até hoje.
- `listarLancamentos`: filtros da RN-306 (sem `mes` → mês atual; com `paciente` e sem `mes` → todos, limite 200 + `maisDe200`); `auditRead` (entidade `financeiro`) só com o filtro de paciente e quando devolve linha — **um** registro por abertura (`entidadeId: null`, `patientId` do filtro), nunca um por lançamento (encheria o Histórico do paciente); `abrirLancamento` chama `auditRead` (`entidadeId` = id do lançamento) quando o lançamento tem paciente. A mesma granularidade vale para `pendenciasDoPaciente` (T4), `cobrancaDaConsulta` (T7) e a seção da ficha (T12).
- Todas conferem `ctx.role === 'nutri'` e lançam `Error('financeiro: só a sessão nutri')` antes de abrir a transação.

- [ ] **Step 1: Testes que falham:**
  - `configuracoes.test.ts`: primeira gravação semeia as categorias uma vez (duas gravações concorrentes → um conjunto só); leitura não grava; saldo fora do intervalo, data no futuro (no fuso), valor "abc" → `FinanceiroError` com os textos exatos; `recordAudit` gravado sem paciente; "Consultas" não arquiva nem exclui (mensagem exata); categoria com lançamento não exclui (mensagem exata); nome repetido sem diferença de maiúsculas → "Já existe uma categoria com este nome.".
  - `lancamentos.test.ts`: cria entrada com paciente e saída sem; vencimento em 31/12 de hoje + 5 anos passa e em 01/01 do ano seguinte é recusado; antes de 01/01/2000 é recusado; saída com paciente recusada; recebimento no futuro (fuso, servidor às 01:30 UTC do dia seguinte) recusado; forma obrigatória; `antesDoSaldo`; paciente bloqueado recusa criação com a mensagem exata; **Review Focus 3** bloqueio concorrente durante `criarLancamento` → `FinanceiroError` do bloqueado; bloqueado: recebe, desfaz, reduz, cancela; aumentar valor → mensagem exata; cancelado e anonimizado não mudam (mensagens); lista com `paciente` sem `mes` traz todos os meses e grava **um** `ler` no `audit_log` (com vários lançamentos); `meses` começa no mês atual e termina no do lançamento mais antigo; lista sem paciente não grava; `abrirLancamento` com paciente grava; sessão de paciente → erro do assert (não lista vazia); outro tenant não vê.
  - `guardas.test.ts` (RN-323): guarda **por grafo** com `test/grafo-de-imports.ts` (`grafoDeImports`, `caminhoAte`, `fontesDe`), como a de `exportacao.test.ts` — nenhum arquivo alcançável a partir de `src/modules/ia/**` (inclusive por um caminho indireto, como ia → ficha/secoes → financeiro, quando a T12 existir) é de `src/modules/financeiro/` ou `src/db/schema/financeiro.ts`; e a guarda de texto: nenhum arquivo de `src/modules/ia/**` contém `fin_`. RNF-307: `src/app/sw.ts` não contém `financeiro` (o escopo do service worker já é guardado por `sw-escopo.test.ts`).
  - `log.test.ts` (RNF-300, CS-302): força erros em `criarLancamento`, `editarLancamento` e `salvarConfiguracoes` com valor, descrição, motivo, categoria e nome conhecidos; o logger capturado e o `beforeSend` do Sentry (`src/lib/sentry-filtro.ts`) não recebem nenhum desses textos; conferir que os formulários do Financeiro ficam fora dos breadcrumbs de entrada (ajustar o filtro se preciso, com teste).
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/configuracoes.test.ts src/modules/financeiro/lancamentos.test.ts src/modules/financeiro/guardas.test.ts src/modules/financeiro/log.test.ts src/app/sw-escopo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(financeiro): configurações e lançamentos (P20-03)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` (travas, assert, `auditRead`) sem Critical/Important.

---

### Task 4: Agregados — Resumo, fluxo de caixa, 12 meses e pendências

**Files:**
- Create: `src/modules/financeiro/resumo.ts`
- Test: `src/modules/financeiro/resumo.test.ts`, `src/modules/financeiro/resumo-propriedade.test.ts`, `src/modules/financeiro/resumo.tempo.test.ts`

**Interfaces:**
- Consumes: Tarefas 1–3 (`FluxoDoAno` e `LinhaFluxo` vêm de `tipos.ts`, T2).
- Produces:
```ts
export type ResumoDoMes = { configurado: boolean; saldoAtual: number | null; saldoDesde: string | null; semValorConsulta: boolean;
  entradas: { recebido: number; aReceber: number; atrasoAnterior: number }; saidas: { pago: number; aPagar: number; atrasoAnterior: number };
  pendentes: { pacientes: number; total: number }; ultimos: LancamentoNaTela[] /* 10 */ };
export async function resumoDoMes(ctx, tenant: { fuso: string }, deps?: { db?: Db; agora?: Date }): Promise<ResumoDoMes>;
export async function fluxoDeCaixaDoAno(ctx, tenant, ano: number, deps?): Promise<FluxoDoAno>;
export async function entradasESaidas12Meses(ctx, tenant, deps?): Promise<{ mes: string; entradas: number; saidas: number; resultado: number }[]>;
export async function pagamentosPendentes(ctx, tenant, deps?): Promise<{ paciente: { id; nome }; total: number; quantidade: number; maisAntiga: string; emAtraso: boolean }[]>;
export async function pendenciasDoPaciente(ctx, tenant, patientId: string, deps?): Promise<{ paciente: { id; nome; bloqueado: boolean }; linhas: LancamentoNaTela[] } | null>;
```
- Uma transação por função; agregação no SQL (`sum(valor_centavos) filter (where …)`, `bigint` → texto → `number`); sem N+1. Saldo (RN-307): pagos com `pago_em >= saldo_inicial_em`, não cancelados. Fluxo (US-306): meses antes do saldo com `null` nas linhas de saldo; **no mês do saldo**, `saldoInicio` `null` e `saldoFim` = saldo + movimentos com `pago_em >= saldo_inicial_em` daquele mês; depois, início = fim anterior e fim = início + resultado. `atrasoAnterior`: em aberto com vencimento antes do dia 1º do mês corrente (RN-307).
- `pendenciasDoPaciente` chama `auditRead` (entidade `financeiro`) quando devolve linha; `resumoDoMes`, `pagamentosPendentes`, `fluxoDeCaixaDoAno` e `entradasESaidas12Meses` não chamam (RN-318).

- [ ] **Step 1: Testes que falham:** o cenário exato da US-305 (saldo R$ 1.500,00 em 01/11/2026 … → "Saldo atual" R$ 1.050,00) e o do atraso de meses anteriores; **Review Focus 4** virada do mês: entrada recebida em 2026-12-01 com `agora` = 2026-12-01T01:30:00Z (30/11 22:30 em `America/Sao_Paulo`) não conta em novembro como recebida e o "hoje" é 2026-11-30; fluxo do mês do saldo (início "—", fim = saldo + movimentos desde a data); pendências agrupadas e ordenadas pela mais antiga, selo de atraso; **US-304 "Cobrança futura"**: entrada com paciente vencendo daqui a 10 dias, não recebida, entra em `pagamentosPendentes` como prevista (sem selo de atraso); `pendenciasDoPaciente` grava **um** `ler`, `pagamentosPendentes` não; RNF-301: com 5.000 lançamentos no ano (inseridos em lote, um `INSERT … SELECT generate_series`), cada função abre **uma** transação e faz um número fixo de consultas — contar com um `Db` de teste cujo `pg.Pool` é embrulhado para contar as chamadas de `query` (método nomeado no teste; sem `pg_stat_statements`), sem N+1. Esses testes pesados levam `timeout` explícito no `it` (o `testTimeout` global é 30 s).
- `resumo.tempo.test.ts` (padrão de `test/arquivos-de-tempo.ts`: no CI roda depois, sozinho, em `pnpm test:tempo`): `resumoDoMes` < 800 ms com os 5.000 lançamentos. É gate só ali, nunca no meio da suíte paralela.
- `resumo-propriedade.test.ts` (CS-301): 200 rodadas (semente fixa; reduzir para 50 se passar de ~60 s, com `timeout` explícito, e registrar no teste; cada rodada insere em lote e roda dentro de uma transação desfeita no fim, sem subir banco novo) com lançamentos aleatórios (datas nas bordas: dia 1º, último dia, 00h00 e 23h59 locais, cancelados, antes do saldo); a soma do Resumo, das linhas do fluxo, dos 12 meses e das linhas do `csvLancamentos` do mês bate com a soma feita em memória, centavo a centavo; nos meses depois do saldo, `saldoFim = saldoInicio + resultado`.
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/resumo.test.ts src/modules/financeiro/resumo-propriedade.test.ts src/modules/financeiro/resumo.tempo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(financeiro): resumo, fluxo de caixa e pendências (P20-04)`.

**Pronto quando:** testes verdes, inclusive a propriedade com semente fixa registrada no teste.

---

### Task 5: Menu, navegação interna, Configurações (primeiro acesso) e Resumo

**Files:**
- Create: `src/app/painel/financeiro/layout.tsx` (h1 por página; `nav aria-label="Seções do Financeiro"` com `aria-current`), `src/app/painel/financeiro/page.tsx` (Resumo ou "Comece por aqui"), `src/app/painel/financeiro/mensagens.tsx` (região `role="status"` sempre montada + foco no h1 quando `ok=`), `src/app/painel/financeiro/configuracoes/page.tsx`, `.../configuracoes/actions.ts`, `.../configuracoes/form-saldo.tsx`, `.../configuracoes/categorias.tsx`
- Modify: `src/app/painel/navegacao.ts` (item "Financeiro" entre "Conteúdos" e "Configurações"; `itemAtual` em `/painel/financeiro/…`; comentário "os seis itens" → "os itens do topo"), `src/app/painel/navegacao.test.ts` (ordem nova em todos os casos de `itensDoMenu`)
- Modify: `src/modules/ajuda/conteudo.ts` — guia novo `financeiro` no **fim** de `GUIAS` (o Plano 18 insere guias antes de `prontuario`) (`versao: 1`, `padrao: /^\/painel\/financeiro(\/.*)?$/`, passos com `alvo` nos `data-guia` desta tarefa: `financeiro-secoes`, `financeiro-saldo`, `financeiro-valor-consulta`, `financeiro-categorias`, `financeiro-cartoes`), texto em rascunho; guia `boas-vindas`: `versao` **+1 sobre a da `main` no rebase** (hoje 3 → 4; comentário `Plano 20: o passo do menu cita "Financeiro"`) com o passo do menu citando "Financeiro". **Atenção ao limite:** o passo `menu` tem hoje 297 caracteres e o teste limita a 300 (`conteudo.test.ts:43`); acrescentar "Financeiro, " passa. Reescrever o texto inteiro mantendo, literalmente, `'"Exames recebidos" aparece também'` e `'"Dúvidas dos pacientes" aparece também, com o número das abertas.'` (testes das linhas 77 e 136), por exemplo encurtando a primeira frase ("Pacientes, Agenda, Diários, Conteúdos, Financeiro e Configurações ficam no topo.") e a do recebimento de exames
- Modify: `src/modules/ajuda/conteudo.test.ts` — `'src/modules/financeiro'` no **fim** de `TSX_FORA`; o teste do Plano 15 que fixa `expect(g.versao).toBe(3)` (linha 135) passa a `toBeGreaterThanOrEqual(3)` e um caso novo do Plano 20 fixa a versão nova (+1) e `toContain('Financeiro')` no passo do menu; um teste do guia `financeiro`
- Modify: `e2e/acessibilidade-painel.spec.ts:216-224` — o laço do teclado vai a **9** itens e "Financeiro" entra antes de "Configurações" (a semente deixa o Financeiro sempre no menu: o item não depende de configuração)
- Modify: `e2e/painel-rotas.ts` — `'/painel/financeiro'` e `'/painel/financeiro/configuracoes'` em `ROTAS_DO_PAINEL` (a semente da T1 já deixa o Financeiro configurado)
- Test: `.../configuracoes/actions.test.ts`, `src/app/painel/financeiro/page.test.ts`, `src/app/painel/navegacao.test.ts`, `src/modules/ajuda/conteudo.test.ts`, `src/app/painel/rotas-axe.test.ts` (sem mudança: precisa continuar verde)

Páginas com `export const dynamic = 'force-dynamic'`, `requireNutri`, componentes de `src/components/ui`, tokens de `globals.css`, alvos `min-h-11`. Primeiro acesso: "Comece por aqui" + `comeceTexto` + botão "Configurar o Financeiro" (sem "Nova entrada"/"Nova saída"). Formulário de saldo e valor da consulta com `<form noValidate>`, estado `{ erros?, valores?, ok?, envio? }` e `key={state.envio}` (padrão de `consulta-form.tsx`); erros `role="alert"` ligados por `aria-describedby`; rótulos "Data do saldo", "Valor do saldo", "Valor da consulta" e as ajudas exatas. Categorias: listas "Entradas" e "Saídas", "Nova categoria", "Renomear", "Arquivar", "Reativar", "Excluir", selo "Arquivada"; nome acessível de cada botão começa pelo texto visível e cita a categoria (`Arquivar categoria Divulgação`). Resumo: os quatro cartões (com "Em atraso de meses anteriores" só quando > 0), aviso `semValorConsulta` com o link `informarValor`, "Últimos lançamentos" e "Ver todos os lançamentos" (o link aponta para a lista, criada na Tarefa 6).

- [ ] **Step 1: Testes que falham:** `actions.test.ts` — salva e redireciona com `?ok=config`; devolve `erros` e `valores` (o que foi digitado volta); sessão de outra usuária/tenant não salva; `page.test.ts` — sem configuração mostra "Comece por aqui" e não mostra "Nova entrada"; com configuração e sem valor da consulta mostra o aviso exato; `navegacao.test.ts` — "Financeiro" entre "Conteúdos" e "Configurações" em todas as combinações; `conteudo.test.ts` — guia `financeiro` v1, `boas-vindas` ≥ 4, `TSX_FORA` com o módulo.
- [ ] **Step 2:** `pnpm vitest run src/app/painel/financeiro src/app/painel/navegacao.test.ts src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar (ler `node_modules/next/dist/docs/` sobre layouts e Server Actions antes).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS. Medir o menu a 1280 px e 1024 px (R-310) no `next dev -p 3103`; registrar no commit. O E2E do menu (9 itens) roda na T11.
- [ ] **Step 5:** commit `feat(painel): Financeiro — menu, configurações e resumo (P20-05)`.

**Pronto quando:** testes verdes; `revisor-interface` sem Critical/Important; CI (`pnpm test`) não quebra em `rotas-axe.test.ts` nem em `conteudo.test.ts`.

---

### Task 6: Lançamentos — lista, formulários, receber e cancelar

**Files:**
- Create: `src/app/painel/financeiro/lancamentos/page.tsx` (filtros, totais, lista), `.../lancamentos/filtros.tsx`, `.../lancamentos/novo/page.tsx`, `.../lancamentos/[id]/page.tsx`, `.../lancamentos/form-lancamento.tsx` (client), `.../lancamentos/receber.tsx`, `.../lancamentos/cancelar.tsx`, `.../lancamentos/actions.ts`
- Modify: `src/modules/ajuda/conteudo.ts` (passos do guia `financeiro` para a lista e o formulário: `financeiro-filtros`, `financeiro-novo`, `financeiro-receber`, `financeiro-cancelar`; a versão continua 1, o guia ainda não foi ao ar), `e2e/painel-rotas.ts` (`'/painel/financeiro/lancamentos'`, `'/painel/financeiro/lancamentos/novo'` com `?tipo=entrada`, `'/painel/financeiro/lancamentos/[id]'`), `e2e/painel.ts` (`prepararTelasComId` cria um lançamento com paciente pela UI e devolve `lancamento` em `IdsDoPainel`)
- Modify: `src/modules/financeiro/log.test.ts` (RNF-300 também nas actions: erros forçados em `criarLancamentoAction`, `editarLancamentoAction` e na action das Configurações não levam valor, descrição, motivo, categoria nem nome ao logger nem ao `beforeSend`)
- Test: `.../lancamentos/actions.test.ts`, `.../lancamentos/page.test.ts`, `src/app/painel/financeiro/configuracoes/page.test.ts` (aviso `informeSaldo`), `src/modules/financeiro/log.test.ts`

Comportamento (spec US-301, US-302, RN-301, RN-306, §6.2, §7):
- **Sem configuração (RN-301, US-301 "Sem configuração"):** `lancamentos/novo` (qualquer `tipo`) e as actions de criar redirecionam para `/painel/financeiro/configuracoes?aviso=informeSaldo`, e a página das Configurações mostra "Informe o saldo do caixa para começar." (`MSG_FINANCEIRO.informeSaldo`) na região de mensagens; a lista e o Resumo sem configuração mostram o primeiro acesso (T5), sem "Nova entrada"/"Nova saída".
- **Pré-seleção do paciente** (§4.1: `novo?tipo=entrada&paciente=<id>`, usada pelo chip da lista, pelas pendências e pela seção da ficha): o paciente vem escolhido se estiver em `pacientesParaLancamento` (ativo ou arquivado, não bloqueado nem anonimizado); id inválido, de outro tenant, bloqueado ou anonimizado → formulário sem paciente escolhido e, para bloqueado, o aviso `bloqueado` da §6.2; `paciente=` com `tipo=saida` é ignorado. A action confere de novo sob a trava (T3).
- Filtro "Mês" em `<select>` (meses desde o lançamento mais antigo, mais recentes primeiro; "Todos os meses" só com `paciente`) + links "Mês anterior"/"Próximo mês"; chip "Paciente: {nome}" com "Limpar"; `totaisDaLista` em duas linhas; aviso dos 200.
- Formulário: "Paciente (opcional)" só na entrada, com ativos e arquivados ("(arquivado)"), sem bloqueados; ajudas da descrição por tipo; "Já foi recebido"/"Já foi pago" mostra data e forma; `noValidate`, `valores` + `key` como na Tarefa 5. Depois de salvar → `redirect('/painel/financeiro/lancamentos?mes=<mes>&ok=salvo[&aviso=antes_do_saldo]')`.
- Edição: h1 "Entrada — {categoria}"/"Saída — {categoria}"; tipo e paciente como texto; consulta ligada como link ("Cobrança da consulta de {dd/mm/aaaa}, {hh:mm}"); paciente bloqueado: aviso `bloqueado`, só valor (menor), receber/desfazer e cancelar; cancelado/anonimizado: só leitura com a mensagem.
- Receber/desfazer/cancelar na linha e na edição; cancelar com `avisoCancelar`, "Motivo do cancelamento" e "Confirmar cancelamento". Mensagens na região fixa de `mensagens.tsx`; foco no h1.

- [ ] **Step 1: Testes que falham:** `actions.test.ts` — sem configuração, criar redireciona para `/painel/financeiro/configuracoes?aviso=informeSaldo`; com `paciente` bloqueado no formulário → texto exato do bloqueado; criar devolve o redirect com `mes` e `aviso=antes_do_saldo` quando é o caso; erro devolve `valores`; paciente bloqueado recusa com o texto exato; aumentar valor de bloqueado recusa com o texto exato; cancelar sem motivo → "Informe o motivo do cancelamento."; outra sessão/tenant não grava. `page.test.ts` — sem `mes` lista o mês atual no fuso; `paciente` sem `mes` lista todos os meses; o `<select>` de mês traz os meses de `listarLancamentos().meses`; a saída não tem o campo "Paciente"; "Todos os meses" só com paciente; `novo?tipo=entrada` sem configuração redireciona com `informeSaldo`; `novo?tipo=entrada&paciente=<id>` vem com o paciente escolhido, e com paciente bloqueado vem sem ele. `configuracoes/page.test.ts` — `?aviso=informeSaldo` mostra o texto exato.
- [ ] **Step 2:** `pnpm vitest run src/app/painel/financeiro/lancamentos src/app/painel/financeiro/configuracoes src/modules/financeiro/log.test.ts src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(painel): Financeiro — lançamentos (P20-06)`.

**Pronto quando:** testes verdes; `revisor-interface` sem Critical/Important (região viva, foco, erro sem perder o digitado, `<select>` de mês).

---

### Task 7: Cobrança da consulta — os dois caminhos e a tela da consulta

**Files:**
- Create: `src/modules/financeiro/cobranca.ts`, `src/app/painel/agenda/consultas/[id]/cobranca.tsx`, `src/app/painel/agenda/consultas/[id]/cobranca-actions.ts`, `src/app/painel/agenda/actions.test.ts` (**não existe hoje**), `src/app/painel/pacientes/[id]/atendimentos/[atendimentoId]/page.test.ts` (não há teste da página nem da action do atendimento)
- Modify: `src/modules/agenda/presenca.ts` (`registrarPresenca` passa a ler `tenants.fuso` na transação e devolve `{ cobranca: ResultadoCobranca | null }`; na passagem para `realizada` chama `cobrarConsultaRealizada(tx, …)`; na correção para `faltou` chama `aoCorrigirParaFaltou(tx, …)`; o `return` antecipado de "mesma situação" devolve `{ cobranca: null }`), `src/modules/pacientes/atendimentos.ts` (`registrarAtendimento` devolve `{ id, cobranca }`; chama `cobrarConsultaRealizada` depois de gravar `realizada`, linha ~83), `src/app/painel/agenda/actions.ts` (`presencaAction`: `?ok=presenca&cobranca=<resultado>`; **sem `&valor=`** na URL — fora da spec e ficaria no histórico do navegador; a página lê o valor da cobrança por `cobrancaDaConsulta`), `src/app/painel/pacientes/[id]/atendimentos/actions.ts` (`?ok=atendimento&cobranca=…` **só** quando o atendimento é ligado a uma consulta e `cobranca !== null`; sem consulta, a URL continua terminando no id), `src/app/painel/agenda/consultas/[id]/page.tsx` (seção "Cobrança" abaixo de "Registrar presença" e as mensagens), `src/app/painel/pacientes/[id]/atendimentos/[atendimentoId]/page.tsx` (hoje não lê `searchParams` nem tem `Aviso`: passa a ler `searchParams` — `Promise` no Next 16, ler `node_modules/next/dist/docs/` — e mostra a mensagem na região de status), os testes que chamam `registrarAtendimento` e dependem do retorno antigo (`src/modules/pacientes/antropometria.test.ts`, `exportacao.test.ts`, `lgpd.test.ts`, `src/modules/agenda/presenca.test.ts`, `atendimentos.test.ts`: `id` → `{ id }`)
- Modify: `e2e/agenda.spec.ts:376` (atendimento ligado a consulta: a URL ganha a query) e `e2e/painel.ts:110` (`prepararTelasComId`, atendimento sem consulta: por defesa) — regex `/\/atendimentos\/[0-9a-f-]{36}(\?.*)?$/`
- Modify: `src/modules/ajuda/conteudo.ts` — guia `agenda` `versao` **+1 sobre a da `main` no rebase** (hoje 1 → 2; comentário `Plano 20: Realizada gera a cobrança`), texto do passo a passo citando a cobrança; `src/modules/ajuda/conteudo.test.ts`
- Test: `src/modules/financeiro/cobranca.test.ts`, `src/modules/agenda/presenca.test.ts`, `src/modules/pacientes/atendimentos.test.ts`, `src/app/painel/agenda/actions.test.ts` (casos novos), `src/app/painel/agenda/consultas/[id]/cobranca-actions.test.ts`

**Interfaces:**
- Consumes: Tarefas 1–3.
- Produces:
```ts
export type ResultadoCobranca =
  | { tipo: 'criada'; valorCentavos: number } | { tipo: 'sem_valor' } | { tipo: 'bloqueado' } | { tipo: 'ja_existia' } // passagem a Realizada
  | { tipo: 'aberta' } | { tipo: 'recebida' } | { tipo: 'nenhuma' };                                                  // correção para Faltou (só leitura)
export async function cobrarConsultaRealizada(tx: Tx, a: { tenantId: string; fuso: string; consulta: { id: string; patientId: string; inicio: Date } }): Promise<ResultadoCobranca>;
export async function aoCorrigirParaFaltou(tx: Tx, a: { consultaId: string }): Promise<ResultadoCobranca>;
export async function cobrancaDaConsulta(ctx, tenant, consultaId: string, deps?): Promise<{ cobranca: LancamentoNaTela | null; podeRegistrar: boolean; motivo: 'nao_configurado' | 'bloqueado' | 'nao_realizada' | null; valorSugerido: number | null }>;
export async function registrarCobrancaManual(ctx, tenant, consultaId: string, valor: string, deps?): Promise<{ id: string }>;
```
- `cobrarConsultaRealizada` roda **depois** das travas do caminho (paciente → consulta); `travarPacienteDaConsulta` (`cancelamento.ts:73`) só devolve o id, então a própria `cobranca.ts` lê `status, anonimizado_em` do paciente com `FOR KEY SHARE` (refazer a trava não custa nada) **antes** do INSERT — nunca recebe o estado de fora: lido antes da trava, um bloqueio no meio faria o gatilho recusar com 42501 e a presença inteira cair com erro genérico, em vez de devolver `bloqueado`; sem configuração ou sem valor → `sem_valor`; bloqueado/anonimizado → `bloqueado`; `INSERT … ON CONFLICT (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL AND cancelado_em IS NULL DO NOTHING RETURNING id` (sem retorno → `ja_existia`); vencimento = data do início no fuso; categoria pela `chave = 'consultas'`.
- `aoCorrigirParaFaltou` **não grava** (F-D19 v0.2).
- `cobrancaDaConsulta` chama `auditRead` quando há cobrança (RN-318). `registrarCobrancaManual`: paciente `FOR KEY SHARE` → consulta → INSERT; RN-314; concorrência → "Esta consulta já tem uma cobrança.".

- [ ] **Step 1: Testes que falham:**
  - `cobranca.test.ts`: cria com o valor da configuração, vencimento no fuso (consulta às 22:30 locais de 30/11 vence em 30/11), categoria "Consultas", paciente e consulta ligados, autor = quem marcou; `sem_valor`; `bloqueado`; bloqueio **concorrente** durante `registrarPresenca` (A `FOR UPDATE` no paciente e o bloqueia; B marca "Realizada" e espera; A confirma) → B devolve `{ cobranca: { tipo: 'bloqueado' } }` e a presença é gravada, sem 42501; **Review Focus 3** duas transações cobrando a mesma consulta → uma linha só; `aoCorrigirParaFaltou` com aberta e recebida → resultado certo e **nenhuma** linha alterada; manual recusa consulta não realizada, Financeiro não configurado, bloqueado; seção da consulta grava `ler` só com cobrança.
  - `presenca.test.ts`: `realizada` devolve `{ cobranca: { tipo: 'criada', … } }`; mesma situação devolve `{ cobranca: null }` sem tocar no Financeiro; `faltou` com cobrança aberta devolve `aberta`; voltar a `realizada` com cobrança ativa → `ja_existia`, valor ajustado mantido.
  - `atendimentos.test.ts`: atendimento ligado a consulta `faltou` → consulta `realizada` + cobrança na mesma transação, retorno `{ id, cobranca: { tipo: 'criada' } }`; consulta já `realizada` → `cobranca: null`.
  - `src/app/painel/agenda/actions.test.ts` (novo): `presencaAction` redireciona com `cobranca=<resultado>` e sem `valor`; a página da consulta mostra os quatro textos exatos (com o valor lido da cobrança) e os links para `/painel/financeiro/configuracoes`.
  - `[atendimentoId]/page.test.ts` (novo): os dois textos exatos do atendimento a partir de `?ok=atendimento&cobranca=…`; sem a query, nenhuma mensagem.
  - `cobranca-actions.test.ts`: registrar à mão (RN-314: só `realizada`, sem cobrança ativa, não bloqueado, configurado; valor obrigatório, mensagens exatas), salvar o valor ajustado e marcar como recebido pela seção da consulta; outra sessão/tenant não grava.
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/cobranca.test.ts src/modules/agenda/presenca.test.ts src/modules/pacientes/atendimentos.test.ts src/modules/pacientes/antropometria.test.ts src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts src/app/painel/agenda src/app/painel/pacientes/\[id\]/atendimentos src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar (nos arquivos da agenda, só a chamada e o retorno; a lógica fica em `cobranca.ts`).
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS. Os E2E `e2e/agenda.spec.ts` e o axe do painel (`prepararTelasComId`) rodam na T11 (um E2E por vez entre as sessões).
- [ ] **Step 5:** commit `feat(financeiro): cobrança da consulta realizada (P20-07)`.

**Pronto quando:** testes verdes; `revisor-rls` (travas e transação) e `revisor-interface` (mensagens, links, seção) sem Critical/Important; se o dono tiver respondido a F-P5 com (a) antes desta tarefa, ajustar `aoCorrigirParaFaltou` e a mensagem e registrar.

---

### Task 8: Pagamentos pendentes, Relatórios e CSV

**Files:**
- Create: `src/app/painel/financeiro/pendencias/page.tsx`, `.../pendencias/[patientId]/page.tsx`, `src/app/painel/financeiro/relatorios/page.tsx`, `.../relatorios/fluxo.tsx` (tabela no contêiner focável), `.../relatorios/barras.tsx` (SVG `aria-hidden`, classes com token, legenda em texto), `.../relatorios/baixar-csv.tsx` (client: valida o período e navega), `src/app/api/painel/financeiro/lancamentos.csv/route.ts`, `src/app/api/painel/financeiro/fluxo-de-caixa.csv/route.ts`
- Modify: `e2e/painel-rotas.ts` (`'/painel/financeiro/pendencias'`, `'/painel/financeiro/pendencias/[patientId]'` com o `i.paciente` de `IdsDoPainel` — o paciente do lançamento que `prepararTelasComId` cria —, `'/painel/financeiro/relatorios'`), `src/modules/ajuda/conteudo.ts` (passos `financeiro-pendentes`, `financeiro-relatorios`, `financeiro-csv`; versão 1)
- Modify: `src/lib/tenant-session.ts` — helper que devolve o **motivo** da recusa de `requireApiNutri` (`'sem_sessao' | 'dpa_pendente' | 'papel'`) sem a rota ler o corpo da resposta (por exemplo, `requireApiNutri` passa a anexar `motivo` ao resultado `ok: false`, sem mudar status nem corpo)
- Test: `src/app/api/painel/financeiro/csv.test.ts`, `src/app/painel/financeiro/pendencias/page.test.ts`, `src/app/painel/financeiro/relatorios/page.test.ts`, `src/app/api/painel/acesso-negado.test.ts` (sem mudança: passa a cobrir as duas rotas CSV e tem de continuar verde), `src/lib/tenant-session.test.ts`

Comportamento: lista de pendentes com `caption` "Pacientes com pagamento pendente", colunas da spec, `pendentesIntro`; detalhe com "Marcar como recebido" em cada linha, a região fixa e o estado vazio ("Nenhum pagamento pendente de {nome}." + "Voltar aos pagamentos pendentes"), link "Ver todos os lançamentos de {nome}" (`lancamentos?paciente=<id>`). Relatórios com "Ano" (`<select>`), as duas tabelas e a nota do saldo. Rotas CSV: `requireApiNutri`; em navegação, **nunca JSON** para a nutricionista — sem sessão (401) → redirect ao login com volta para Relatórios; 403 de **DPA pendente** → `/painel/dpa`; papel errado (paciente, admin) → o **403 JSON `{ erro: 'Acesso negado' }` de sempre** (a guarda `acesso-negado.test.ts` chama toda `route.ts` de `/api/painel` com sessão de paciente e de admin e exige isso); os dois 403 se distinguem pelo motivo do helper, nunca lendo o corpo; período inválido → 303 para `/painel/financeiro/relatorios?erro=periodo`; `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="lancamentos-AAAA-MM-DD-a-AAAA-MM-DD.csv"`, `Cache-Control: no-store`; `recordAudit` `exportar` (entidade `financeiro`): uma linha por paciente presente com `pacientes=1`, uma sem paciente com `pacientes=0` e no fluxo. A leitura dos lançamentos e o `recordAudit` ficam na **mesma** transação `withTenant` da rota (regra 8). A coluna "Paciente" do CSV sai com o nome civil (ver "Global Constraints"). Ler `node_modules/next/dist/docs/` sobre Route Handlers antes.

- [ ] **Step 1: Testes que falham:** `csv.test.ts` — BOM, `;`, CRLF; sem `pacientes` não há coluna "Paciente" e a descrição das entradas de pacientes sai vazia; com `pacientes=1` há coluna e um `exportar` por paciente; 367 dias → 303 para `?erro=periodo`; sem sessão → redirect ao login (não JSON); DPA pendente → `/painel/dpa`; sessão de paciente e de admin → 403 `{ erro: 'Acesso negado' }`; cabeçalhos exatos; uma falha no meio (erro forçado depois da leitura) não deixa `exportar` gravado. `pendencias/page.test.ts` — a lista não grava `ler`; o detalhe grava; estado vazio do detalhe com o texto exato. `relatorios/page.test.ts` — o contêiner tem `role="region"`, `tabIndex={0}` e `focus-visible:outline-offset-[-3px]`; `?erro=periodo` mostra o alerta junto do campo.
- [ ] **Step 2:** `pnpm vitest run src/app/api/painel/financeiro src/app/api/painel/acesso-negado.test.ts src/lib/tenant-session.test.ts src/app/painel/financeiro/pendencias src/app/painel/financeiro/relatorios src/app/painel/cores.test.ts src/app/painel/rotas-axe.test.ts src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(painel): Financeiro — pendências, relatórios e CSV (P20-08)`.

**Pronto quando:** testes verdes; `cores.test.ts` verde sem exceção nova; `revisor-interface` sem Critical/Important.

---

### Task 9: LGPD — exportação, anonimização e textos da exclusão

**Antes:** `git fetch origin && git rebase origin/main` depois do merge do Plano 17 (e dos Planos 18/19, se entrarem antes); resolver conflitos em `lgpd.ts`, `exportacao-job.ts` e testes mantendo as duas contribuições.

**Files:**
- Create: `src/modules/financeiro/titular.ts`
- Modify: `src/modules/pacientes/exportacao-job.ts` (`montarDados`: chave `financeiro` por inclusão explícita, nos dois escopos, com os campos da spec §10; o comentário "todas as tabelas do paciente, menos as staff_only" passa a citar `ia_tarefas` e `fin_lancamentos`; tipo `DadosExportacao`), `src/modules/pacientes/exportacao.test.ts` (literais de `DadosExportacao`), `src/modules/pacientes/lgpd.ts` (`anonimizarVencidos`, nesta ordem: (1) `app_anonimizar_aceites` (~:538); (2) `select app_anonimizar_financeiro(<paciente>)`; (3) o UPDATE de `patients` (com o `lembretesPausadosEm: null` do Plano 17, se já estiver na `main`); (4) o bloco `if (r.length)` onde os Planos 17 e 18 apagam `lembretes_rotina`/`patient_cadastro`; (5) a "rede" do Plano 18 no fim da varredura), `src/modules/pacientes/lgpd.test.ts`, `src/email/templates.tsx` (`pedido_exclusao_registrado`, `exclusao_atendida`), `src/email/render.test.ts` (é onde os textos dos e-mails estão fixados; `templates.test.ts` não existe), `src/app/p/(portal)/perfil/privacidade.tsx` (`CONFIRMAR_EXCLUSAO` passa a ser **exportado**) e `src/app/p/(portal)/perfil/page.test.ts` (texto exato), `src/app/painel/pacientes/[id]/privacidade/page.tsx` (frase da §6.2 numa constante **própria** — chave nova no fim de `MSG_LGPD` ou parágrafo separado —, sem editar a string da exclusão que o Plano 18 troca na T7 dele)
- Create: `src/app/painel/pacientes/[id]/privacidade/page.test.ts` (a página não tem teste hoje)
- Exportação: `financeiro` como **última** chave do tipo `DadosExportacao`, do objeto `dados` e dos literais de `exportacao.test.ts` (~:635 e ~:1082); no comentário "todas as tabelas do paciente, menos as staff_only" (que o Plano 18 também reescreve), só acrescentar `fin_lancamentos`, sem reescrever o resto
- Test: `src/modules/financeiro/titular.test.ts` + os acima

**Interfaces:**
- Produces: `financeiroParaExportacao(tx: Tx, patientId: string, hoje: string): Promise<FinanceiroExportado[]>` com `{ vencimento, pagoEm, valorCentavos, valor, formaDePagamento, formaDePagamentoRotulo, situacao, situacaoRotulo, categoria, descricao, consultaInicio, canceladoEm, motivoCancelamento }` — **sem** `criadoPor`/`canceladoPor`. Roda no `worker` (sem o assert de `nutri`).

- [ ] **Step 1: Testes que falham:** `titular.test.ts` — campos exatos (teste das chaves), situação no dia da exportação no fuso, sem autor; `exportacao.test.ts` — `dados.json` com `financeiro` nos dois escopos, `prontuario.pdf` sem mudança, nenhum arquivo novo no ZIP; `lgpd.test.ts` — anonimização limpa os textos, cancela os em aberto (`cancelado_por` nulo), mantém valor/datas/categoria/forma, marca `anonimizado_em`, e o resto da anonimização continua igual; atender o pedido de exclusão não mexe nos lançamentos; textos exatos dos dois e-mails, do `CONFIRMAR_EXCLUSAO` e da aba Privacidade (spec §6.2).
- [ ] **Step 2:** `pnpm vitest run src/modules/financeiro/titular.test.ts src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts src/email/render.test.ts "src/app/p/(portal)/perfil" "src/app/painel/pacientes/[id]/privacidade"` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm test test/isolamento.test.ts src/db` → PASS.
- [ ] **Step 5:** commit `feat(lgpd): Financeiro na exportação, na anonimização e nos textos da exclusão (P20-09)`.

**Pronto quando:** testes verdes; `normas-cfn-lgpd` e `revisor-rls` sem Critical/Important; textos ao paciente marcados para o pacote do advogado (E-09) no fechamento.

---

### Task 10: DPA 1.1

**Files:**
- Modify: `src/modules/plataforma/dpa.ts` — é onde mora o texto do DPA (`DPA_1_0`, `DPA_TEXTOS`, `DPA_PARAGRAFOS`, `DPA_MUDOU`; `plataforma/textos-legais.ts` **não existe**): `DPA_VERSAO = '1.1'`, `DPA_VERSAO_DATA` fixa no PR; `DPA_1_1` (cláusulas 2 e 5 da spec §10, **sem mudar a numeração**) e `DPA_O_QUE_MUDOU`; `DPA_PARAGRAFOS = DPA_1_1`. **Armadilha:** hoje o último parágrafo da 1.0 usa `formatarData(DPA_VERSAO_DATA)` e a entrada do mapa é `[DPA_VERSAO]: { data: DPA_VERSAO_DATA, paragrafos: DPA_1_0 }`; só trocar `DPA_VERSAO` faria a 1.0 sumir do mapa ou mudar de data. **Congelar a 1.0**: data literal `'2026-10-15'` no último parágrafo (`'Versão 1.0, de 15/10/2026.'`) e na entrada do mapa, com uma constante como chave (`const DPA_VERSAO_1_0 = '1.0'`; `[DPA_VERSAO_1_0]: { data: '2026-10-15', paragrafos: DPA_1_0 }`), **nunca a chave literal `'1.0'`** (o Turbopack já a descartou do objeto no CI do PR #38, comentário do arquivo); a 1.1 entra como `[DPA_VERSAO]: { data: DPA_VERSAO_DATA, paragrafos: DPA_1_1 }`. `src/app/painel/dpa/page.tsx` (mostra `DPA_O_QUE_MUDOU`), `src/modules/ia/textos-legais.ts:331` (comentário "DPA (1.0, cláusula 8)" → citar que a cláusula 8 não mudou na 1.1)
- Modify (testes que fixam '1.0'): `src/app/painel/actions.test.ts:106`, `src/lib/tenant-session.test.ts:73`, `src/modules/plataforma/textos-legais.test.ts` (linhas ~75-82 e ~117: `DPA_VERSAO`, `DPA_TERMO`, `DPA_MUDOU`, chaves `['0.1-provisorio','1.0','1.1']`), `src/modules/plataforma/dpa.test.ts` (linhas ~61-78), `src/app/painel/dpa/page.test.ts:27` (regex `versão 1\.1`)
- Test: os acima + `src/modules/ia/textos-legais.test.ts` (o aditivo continua citando as mesmas cláusulas)

- [ ] **Step 1: Testes que falham:** `DPA_VERSAO` '1.1' e termo `dpa-1.1`; texto 1.1 com as frases exatas das cláusulas 2 e 5 e a mesma numeração de cláusulas da 1.0 (contar os títulos); `DPA_TEXTOS['1.0']` igual ao de hoje, com `DPA_TEXTOS['1.0'].data === '2026-10-15'` e `DPA_TEXTOS['1.0'].paragrafos.at(-1) === 'Versão 1.0, de 15/10/2026.'`; quem aceitou a 1.0 é levada a `/painel/dpa` e as APIs do painel dão 403 até aceitar; aceitar grava `consents` `dpa-1.1`; a página mostra `DPA_MUDOU` com 1.1 e `DPA_O_QUE_MUDOU`.
- [ ] **Step 2:** `pnpm vitest run src/modules/plataforma src/app/painel/dpa src/app/painel/actions.test.ts src/lib/tenant-session.test.ts src/modules/ia/textos-legais.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm e2e:seed` (usa a constante) sem erro; depois de cada rebase, `grep -rn "dpa-1\.0\|DPA_VERSAO\|'1\.0'" src test e2e` para achar testes novos dos Planos 17, 18 e 19 com a 1.0 fixa e acertá-los.
- [ ] **Step 5:** commit `feat(dpa): DPA 1.1 com o Financeiro (P20-10)`.

**Pronto quando:** testes verdes; `normas-cfn-lgpd` sem Critical/Important; `DPA_VERSAO_DATA` marcada no PR para conferir antes do merge (R-309); confirmado com a orquestradora que **só o Plano 20 sobe o DPA nesta onda** (R-309) e que isso está registrado no Plano 18 (se o 18 precisar de cláusula nova pelos campos do cadastro, ela entra na 1.1 quando o PR 2 do 18 entrar antes do PR 2 do 20; senão vira 1.2) — um único novo aceite da Debby.

---

### Task 11: Fechamento do PR 2 — E2E, acessibilidade, manuais, ajuda e runbook

**Files:**
- Create: `e2e/financeiro.spec.ts` (bloco de IP fixado pela orquestradora no cabeçalho; proposta `10.9.34`), `docs/operacao/financeiro.md`
- Modify: `e2e/acessibilidade-painel.spec.ts` (estados fora de `ROTAS_DO_PAINEL`: Financeiro **não configurado** com a conta `E2E_FIN_AXE` da semente (consultório novo a cada execução, nunca configurado), formulário de lançamento com erro, detalhe de pendências vazio, nos modos claro e escuro com `escolherTema`, voltando a "Igual ao aparelho" no `afterAll`)
- Modify: `docs/manual-tecnico/` (capítulo novo do Financeiro com o próximo número livre, ou seção no `04`/`05` se o `guardiao-manual` preferir; `02-banco-de-dados.md` com as três tabelas, gatilhos e função; `README.md`: índice, glossário — "lançamento", "cobrança da consulta", "pagamentos pendentes", "saldo do caixa" — e divergências spec × código), manual do usuário (Docs) e Central de Ajuda (preparados pelo `guardiao-manual` para o dono aplicar), `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md` (só acrescentar: item do termo do paciente 1.1 com prazo, F-D17; "antes/depois" da edição, R-311; F-P1 a F-P5; R-314, volta atrás da imagem do PR 2), `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md` (situação do Plano 20 no fechamento de cada PR)
- Test: o próprio E2E

`docs/operacao/financeiro.md`: começo a partir do Dietbox (F-D28: saldo do caixa na data da virada e as pendências abertas como entradas previstas por paciente, inclusive de arquivados); aviso à Debby antes do deploy do DPA 1.1 (R-309) e conferência de `DPA_VERSAO_DATA`; conferência do primeiro mês (CS-303); nota da Res. CFN 856/2026, art. 68, II (informar o valor dos honorários antes; vigência a conferir no DOU) e o lembrete de sigilo do CSV com nomes.

- [ ] **Step 1: E2E que falha** (CS-300): a nutricionista cria um paciente novo e uma consulta já começada para ele → abre a consulta → "Realizada" → vê "Presença registrada. Cobrança de R$ 250,00 criada no Financeiro." → "Marcar como recebido" com "Pix" → "Recebimento registrado." → o paciente sai de "Pagamentos pendentes" → o Resumo mostra o lançamento em "Últimos lançamentos" (asserções sobre o paciente desta execução, nunca sobre os totais do consultório: a semente mantém lançamentos antigos). Primeiro acesso com a conta `E2E_FIN_NOVO` da semente (consultório novo a cada execução): "Comece por aqui" → salva → Resumo. O paciente é criado pelo helper `e2e/portal.ts` (rótulos do formulário mudam com o Plano 18). CSV: "Baixar CSV" com período de 13 meses mostra o alerta; com 1 mês baixa o arquivo (`page.waitForEvent('download')`). Axe nos estados acima, nos dois temas, a 1280 px e 360 px; seletores pelos nomes acessíveis.
- [ ] **Step 2:** `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3103 pnpm test:e2e e2e/financeiro.spec.ts e2e/acessibilidade-painel.spec.ts` → FAIL (um E2E de cada vez entre as sessões).
- [ ] **Step 3:** ajustes que o E2E pedir; manuais e ajuda pelo `guardiao-manual`; runbook; backlog.
- [ ] **Step 4:** `APP_URL=http://localhost:3103 pnpm test:e2e e2e/financeiro.spec.ts e2e/acessibilidade-painel.spec.ts e2e/agenda.spec.ts && pnpm test && pnpm lint && pnpm typecheck` → PASS. Rodar `pnpm e2e:seed` de novo e repetir `e2e/financeiro.spec.ts`, `e2e/acessibilidade-painel.spec.ts` **e** `e2e/agenda.spec.ts` (banco reaproveitado, R-312): depois do PR 2, todo "Realizada" no consultório do E2E cria cobrança e essa consulta nunca mais sai da semente (fica `cancelada`); conferir que não há colisão com o `EXCLUDE appointments_sem_sobreposicao` nem expectativa de agenda vazia. Avisar as outras sessões desse efeito ao abrir o PR 2.
- [ ] **Step 5:** commit `test(e2e)+docs: fechamento do Plano 20 — Financeiro (P20-11)`.

**Pronto quando:** E2E e suíte verdes duas vezes seguidas no banco reaproveitado; manual técnico conferido pelo `guardiao-manual`; textos para o dono (Docs, Central de Ajuda, pacote do advogado) prontos.

---

### Task 12: Seção "Financeiro" no Início da ficha (PR 3, depois do PR 1 do Plano 18 e da decisão do contrato)

**Antes:** (1) **decisão do contrato da seção** (bloqueia a tarefa; orquestradora com o dono, ver "Perguntas ao dono" no fim): a RN-277 do Plano 18 diz que o `resumo` da seção **nunca** chama `auditRead` (o `registro.test.ts` de lá proíbe o texto em `src/modules/ficha/secoes/`), `disponivel(tenant, p, total)` é síncrono e não vê `fin_configuracoes`, "Ver todos" é relativo à ficha (segmento `aba`) e `adicionar` só aceita destino relativo e os grupos `'avaliacoes' | 'prescricoes'` — o comportamento abaixo (RN-318/RN-329) não cabe sem mudança; (2) merge do **PR 1** do Plano 18 (registro) na `main`; `git rebase origin/main`; ler o registro como mergeado (`src/modules/ficha/secoes/index.ts`, tipo `SecaoDaFicha`, teste de chaves de `ItemDaSecao`) — se divergir da spec do Plano 18 (RN-277), seguir o código e registrar a diferença.

**Files:**
- Create: `src/modules/ficha/secoes/financeiro.ts` (só chama o módulo do Financeiro); função `resumoFinanceiroDoPaciente(tx, patientId)` em `src/modules/financeiro/resumo.ts`
- Modify: `src/modules/ficha/secoes/index.ts` (uma linha no **fim** de `SECOES_DA_FICHA`), o teste de chaves das seções, `src/modules/ajuda/conteudo.ts` (guia do Início/prontuário, subir a `versao` se o texto mudar, com comentário `Plano 20`), `docs/manual-tecnico/` e a ajuda (o que a Tarefa 11 escreveu sobre a ficha)
- Test: `src/modules/ficha/secoes/financeiro.test.ts` e o teste de paridade/chaves do registro

Comportamento (US-308, RN-329), na opção (a) da decisão: `disponivel` sempre verdadeiro (a US-308 não manda esconder a seção sem configuração; sem configuração ela mostra "Financeiro (0)" e "Nova entrada" leva às Configurações, RN-301); `resumo` = contador e os 3 mais recentes como `ItemDaSecao` (rótulo "Entrada — {categoria}", data de referência, situação; sem valor e sem descrição); "Ver todos" → `/painel/financeiro/lancamentos?paciente=<id>`; "Nova entrada" (pelo `adicionar` ou botão da seção, conforme o registro) só sem bloqueio; `auditRead` (entidade `financeiro`) uma vez por abertura do Início, só quando devolve lançamento; nada no "No app" (o paciente não vê o Financeiro).

Na opção (b): sem `auditRead` na seção (precedente D17 do Plano 10A: só rótulo, data e situação, sem valor nem descrição), "Ver todos" e "Nova entrada" por rotas da ficha que redirecionam (`/painel/pacientes/[id]/financeiro` → `/painel/financeiro/lancamentos?paciente=<id>`; idem para `novo?tipo=entrada&paciente=<id>`), entradas novas em `ROTAS_DO_PAINEL`; a RN-318/RN-329 da spec muda antes (OK do `normas-cfn-lgpd` e do dono).

- [ ] **Step 1: Testes que falham:** chaves exatas do `ItemDaSecao`; sem lançamento → contador 0 e nenhum `ler`; com lançamento → na opção (a), um `ler` por abertura; na (b), nenhum; bloqueado sem "Nova entrada"; a seção roda na transação única do Início (RNF-260 do Plano 18).
- [ ] **Step 2:** `pnpm vitest run src/modules/ficha src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm typecheck && pnpm lint`; E2E da ficha do Plano 18 e `e2e/acessibilidade-painel.spec.ts` com `APP_URL=http://localhost:3103` → PASS.
- [ ] **Step 5:** commit `feat(ficha): seção Financeiro no Início (P20-12)`.

**Pronto quando:** testes verdes; `revisor-interface` e `guardiao-manual` sem Critical/Important; PR 3 com o mesmo fluxo de revisão abaixo.

---

## Depois das tarefas (fluxo do CLAUDE.md)

Para cada PR (1, 2 e 3): revisão final do branch (workflow, com `revisor-rls` — gatilhos, travas, `staff_only`, `auditRead`/`exportar`, guarda do journal —, `normas-cfn-lgpd` — exportação integral (F-D22 v0.2), textos da exclusão ao paciente, CSV sem nomes, DPA 1.1, bloqueado só com receber/desfazer/reduzir/cancelar —, `revisor-interface` — mensagens, foco, região viva, contêiner rolável, menu com 9 itens, primeiro acesso nos dois temas — e `guardiao-manual` — manual técnico e ajuda) → uma onda de correções → `/code-review high` no PR **uma vez** → correções Critical/Important (Minor para o backlog) → re-revisão **só do diff das correções** → `/security-review` (CSV: injeção de fórmula, cabeçalhos, sessão; RLS e isolamento) → merge **só com o OK do dono** (merge = deploy; a migration do PR 1 roda no boot; sem merge das 03h às 07h30 BRT; sem snapshot da Hostinger). Se sobrar Critical/Important confirmado depois da re-revisão, parar e avisar o dono.

A sessão avisa a orquestradora a cada etapa (início, PR aberto, CI verde, revisão, pronto para merge) para o painel do backlog Paridade Dietbox. Antes do merge do PR 2: conferir `DPA_VERSAO_DATA`, avisar a Debby do novo aceite (R-309) e, se o Plano 17, 18 ou 19 tiver entrado depois do último rebase, refazer o rebase (o PR 2 não tem migration; o PR 1 refaz o §5 do `sessoes-paralelas.md`).

---

## Revisão do plano (17/11/2026)

Três lentes sobre o commit d1d333f: executabilidade, banco e guardas (`revisor-rls`) e conflitos com as sessões paralelas (Planos 17, 18 e 19). Cada achado foi conferido no código do worktree (`main` 680eac3, depois do rebase) e, para o Plano 18, no branch `plano-18-ficha-cadastro`. O branch foi rebaseado em `origin/main` (só docs; sem conflito).

**Aplicados**

| Achado | Onde |
|---|---|
| Exec. I-1 — `plataforma/textos-legais.ts` não existe; armadilha da 1.0 em `dpa.ts` | T10 (arquivo certo, 1.0 congelada com data literal e chave por constante, teste do último parágrafo); "Estrutura de arquivos" |
| Exec. I-2 — `?ok=atendimento&cobranca=` quebra `e2e/agenda.spec.ts:376` e `e2e/painel.ts:110` | T7 (query só com consulta e `cobranca !== null`; os dois E2E em Modify; roda na T11) |
| Exec. I-3 — rotas CSV × `acesso-negado.test.ts` | T8 (redirect só no 401 e no 403 de DPA; papel errado mantém o 403 JSON; helper de motivo em `tenant-session.ts`; guarda nos passos) |
| Exec. I-4 / RLS I-1 — primeiro acesso não se repete no banco reaproveitado | T1 (dois consultórios novos por execução, contas `E2E_FIN_NOVO` e `E2E_FIN_AXE`), T11 |
| Exec. I-5 — branch do PR 2 com os commits velhos da T1 | "Ordem de entrega" (`git rebase --onto`, `drizzle/` igual à `main`, recriar o `nutri_dev_c` com OK do dono) |
| Exec. I-6 — tipos que nascem tarde ou em lugar nenhum | T2 (`tipos.ts` com `LinhaCsv`, `LinhaFluxo`, `FluxoDoAno`, `FiltrosLista`, `TotaisDaLista`, `LancamentoNaTela`); T3/T4 importam |
| Exec. I-7 — RN-301 "Sem configuração" e pré-seleção `paciente=<id>` | T6 (redirect com `informeSaldo`, pré-seleção recusando bloqueado, testes) |
| Exec. M-1 — passo `menu` com 297/300 caracteres | T5 (reescrever mantendo as duas frases testadas; `toBe(3)` → `≥ 3` + caso novo) |
| Exec. M-2 — E2E do menu com 8 itens | T5 (`acessibilidade-painel.spec.ts:216-224` com 9) |
| Exec. M-3 — arquivos de teste da T7 | T7 (`agenda/actions.test.ts` e `[atendimentoId]/page.test.ts` como Create; chamadores de `registrarAtendimento` nos testes; `searchParams` na página; conteúdo do `cobranca-actions.test.ts`) |
| Exec. M-4 — `&valor=` na URL | T7 (sai; a página lê a cobrança) |
| Exec. M-5 / RLS Minor 2 — status do paciente lido de fora da trava | T7 (`cobranca.ts` lê `status`/`anonimizado_em` com `FOR KEY SHARE`; teste de bloqueio concorrente na presença) |
| Exec. M-6 — nomes de arquivo da T9 | T9 (`render.test.ts`; `privacidade/page.test.ts` como Create; `CONFIRMAR_EXCLUSAO` exportado e testado em `perfil/page.test.ts`) |
| Exec. M-7 — `criado_por` sem FK | T1 (escrito, com o motivo) |
| Exec. M-8 / RLS Minor 1 — ordem gatilho × RLS | T1 (ordem escrita; teste com paciente invisível); spec §9.4 |
| Exec. M-9 — limpeza da semente não exercitada | T1, Step 4 |
| Exec. M-11 — testes pesados e de tempo | T4 (`timeout` explícito, inserção em lote, `resumo.tempo.test.ts`, contagem de consultas por `Pool` embrulhado) |
| Exec. M-12 — lacunas | T3 (intervalo de datas da RN-304; `meses` do `<select>`; RNF-307 em `guardas.test.ts` + `sw-escopo.test.ts`), T4 (US-304 "Cobrança futura"), T6 (RNF-300 nas actions), T1 (`FormaPagamento` com fonte única no schema), T8 (`i.paciente`) |
| Exec. M-13 — fechamento | T11 (índice dos planos), T12 (`disponivel` sem depender da configuração), T2 ("12 da RN-302": 2 de entrada + 10 de saída), T10 (R-309 no "Pronto quando") |
| RLS Minor 3 — `search_path` dos gatilhos e `FOR KEY SHARE` no UPDATE | T1; spec §9.4 |
| RLS Minor 4 — anonimização antes do prazo | T1 (exige `anonimizar_apos` vencido no fuso; `coalesce` no marcador); spec §9.4 |
| RLS Minor 6 — `migrate-owner.test.ts` | T1 e "Global Constraints" |
| RLS Minor 7 — CSV e `exportar` na mesma transação | T8 |
| RLS Minor 8 — granularidade do `auditRead` | T3 (um por abertura, `entidadeId` nulo; vale para T4, T7 e T12) |
| RLS Minor 9 — guarda da RN-323 por grafo | T3 (`test/grafo-de-imports.ts`) |
| RLS Minor 10 — volta atrás com a imagem do PR 1 | spec R-314; backlog (T11) |
| Paralelas A2 — nome social | "Global Constraints" (telas pelo helper do Plano 18, D7; CSV com nome civil) |
| Paralelas A3 — DPA | T10 (grep dos testes com 1.0; acordo registrado no 18) |
| Paralelas A4 — ordem das migrations | "Ordem de entrega" (PR 0 opcional; PR 1 depois do Plano 17, com a exceção) |
| Paralelas A5 — texto do PR #50 | rebase feito; "Ambiente" e "Global Constraints" |
| Paralelas C2 a C9 — listas, `CLAUDE.md`, `lgpd.ts`, exportação, ajuda, semente | "Global Constraints", T1, T5, T7, T9, T11 |
| Paralelas C10 — IP do E2E | "Ambiente" e T11 (proposta 10.9.34, a orquestradora fixa) |
| Paralelas — PR 3 só depende do PR 1 do 18; lista de disputados | "Ordem de entrega"; "Global Constraints" |
| Spec DEP-F8 — cita um texto que não existe mais na spec do Plano 18 | spec DEP-F8 corrigida (§18 da spec) |

**Descartados ou aplicados de outro jeito**

- Exec. M-10, RLS Minor 5 e Paralelas C1 (posição de `fin_categorias` em `ULTIMAS`): os três partiam de que ela precisa estar em `ULTIMAS`. Não precisa. A única filha é `fin_lancamentos`, que está em `SEM_DELETE` e nunca é apagada no teste de DELETE (`test/isolamento.test.ts:458`), e o `SO_APAGA.fin_categorias` já exclui as categorias com lançamento. `fin_categorias` fica fora de `ULTIMAS` (spec §9.5 revista), e a lista não muda, o que também evita o conflito com o Plano 17.
- Paralelas A1 (contrato da seção no registro do Plano 18): não dá para decidir aqui, porque muda regra aprovada (RN-318/RN-329) ou o PR 1 do Plano 18. A T12 fica bloqueada até a decisão, com as duas opções descritas; ver as perguntas abaixo.
- Paralelas, "Plano 17/18/19 precisam fazer…": não cabe neste plano. Fica para a orquestradora.

**Perguntas ao dono** (decisões que não saem das já aprovadas)

1. **Seção "Financeiro" no Início (T12, PD-33).** O registro do Plano 18 (RN-277) proíbe `auditRead` nas seções e não comporta "Ver todos"/"Nova entrada" fora da ficha. Há duas saídas:
   - (a) O PR 1 do Plano 18 estende o contrato: `verTodos` e destino absolutos, um grupo novo, `disponivel` vindo do `resumo` e `auditar?: { entidade }` chamado de forma central. Isso contraria o "Início sem `auditRead` das seções" do 18.
   - (b) A seção do Financeiro fica sem `auditRead`, pelo precedente D17 do Plano 10A (só rótulo, data e situação, sem valor). "Ver todos" e "Nova entrada" passam por rotas da ficha que redirecionam. Nada muda no Plano 18, mas a RN-318/RN-329 muda, com o OK do `normas-cfn-lgpd`.

   Recomendação: **(b)**. Mantém o Plano 18 intacto, e a seção não mostra valor nem descrição, como as listas de documentos (D17).

## Decisões da orquestradora (16/11/2026, com autorização do dono para seguir as recomendações)

- **Seção "Financeiro" no Início (T12):** fica a opção **(a)**, o contrato estendido que o Plano 18 entrega no PR 1 (`leitura: { entidade: "financeiro" }`, `verTodos`, `href` absoluto, grupo `outros`, `podeAdicionar`). O `auditRead` é feito de forma central por `inicio.ts`, nunca pelo arquivo da seção. Com isso, as RN-318 e RN-329 ficam como estão. A (b) foi descartada: o 18 já resolveu a regra "sem auditRead nas seções" com a auditoria central, e valor financeiro na ficha é leitura que merece registro.
- **Trem de merge da onda 1:** 17 → 18 PR 1 → 20 PR 1 → 19 (código) → 18 PR 2 → 20 PR 2 → 20 PR 3 → 19 (seed, sozinho).
- **DPA:** nesta onda, só o Plano 20 sobe a versão, para a 1.1.
- **Faixa de IP do E2E:** cada plano usa a própria faixa (sufixo = número do plano). Antes, confira em `e2e/` como os IPs são gerados.
- **F-P5 (17/11/2026, fechada):** fica a **v0.2** — a correção de "Realizada" para "Faltou" com cobrança em aberto **avisa e não cancela** ("Presença registrada. Esta consulta tem uma cobrança em aberto. Cancele-a no Financeiro se não for cobrar."), como a F-D7 aprovada e a F-D19 da spec; a nutricionista cancela com o motivo, se não for cobrar. A opção (a) (cancelar sozinha com o motivo fixo) não entra. Registrado no PR 2, no índice dos planos e no backlog (P20-15).
- **Faixa de IP do Plano 20:** `10.9.20.x` (no lugar da proposta `10.9.34`): `10.9.20.1` em `e2e/financeiro.spec.ts` (conta `E2E_FIN_NOVO`) e `10.9.20.2` em `e2e/acessibilidade-painel.spec.ts` (conta `E2E_FIN_AXE`).
