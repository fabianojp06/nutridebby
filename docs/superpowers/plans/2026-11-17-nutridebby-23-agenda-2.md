# Plano 23 — Agenda 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a nutricionista atende em vários locais (presenciais e de videoconferência), vê a agenda em Dia e Semana com grade de horas, Mês e Lista, filtra por local, por paciente, por previsão de retorno e por aniversário, imprime a agenda pelo navegador, escolhe se os pedidos dos pacientes esperam a sua confirmação ("Solicitações") e manda a mensagem de aniversário por e-mail a quem autorizou — sem nada novo por WhatsApp e sem o link da sala vazar para fora da consulta do próprio paciente.

**Architecture:** uma tabela nova `locais_atendimento` (`staff_only` + `publico_negado`), lida fora do painel só por funções `SECURITY DEFINER` de projeção (molde 0083, troca de papel para `worker`); `local_id` anulável com FK composta `(tenant_id, local_id, modalidade)` em `appointments`, `availability_rules` e `public_booking_requests`. O pedido do paciente é uma consulta `solicitada` (o `EXCLUDE` segura o horário), decidida no banco pelo gatilho `appointments_regras_pedido` a partir da chave `tenants.agenda_confirmar_pedidos`; o pedido de pessoa nova fica "aguardando" em `public_booking_requests`, gravado e lido só por funções. A autorização de aniversário é uma tabela de eventos só de inclusão (`aniversario_autorizacoes`). Visões e marcadores em `src/modules/agenda/visoes.ts` com consultas agregadas por período; helpers de calendário em `calendario.ts` (nunca em `fuso.ts`). O vencimento dos pedidos roda no começo de `processarNotificacoes` (sem fila nova). Impressão pelo navegador com um `exportar` sem paciente.

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas, layouts, Server Actions e Route Handlers) · Drizzle · PostgreSQL 16 (RLS) · Better Auth · pg-boss · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-nutridebby-23-agenda-2-design.md` **v0.3** (painel de revisão aplicado, §18 da spec; revisão do plano, §18.1; decisões delegadas pelo dono, AG-D1 a AG-D45). Backlog Paridade Dietbox, onda 2, Sessão C: PD-70, PD-71, PD-72, PD-73, PD-74 (PD-75, Google Agenda, fica para o Plano 29). Plano conferido contra o código da `main` 6c3ee8f e contra os worktrees da onda 1 e da onda 2 em 17/11/2026: ver "Conferência do plano contra o código" no fim. As decisões novas deste plano continuam a numeração da spec (AG-D46 em diante) e vão para a spec no fechamento (T12).

## Ambiente da sessão (Sessão C)

| Item | Valor |
|---|---|
| Worktree | `/home/deploy/servidor/projetos/nutridebby-c` (`../nutridebby-c`), **depois** de fechada a Sessão C da onda 1 (Plano 20). O worktree `../nutridebby-23`, onde a spec e este plano foram escritos, é só de documento: o mesmo branch não pode estar em dois worktrees, e o script só conhece `a`, `b` e `c` (AG-D46) |
| Branch | `plano-23-agenda-2` (spec e plano; base `origin/main` 6c3ee8f). O PR 1 de fundação sai de um branch próprio, `plano-23-fundacao`, criado a partir dele (ver "Ordem de entrega") |
| Porta | **3103** (`pnpm exec next dev -p 3103`; nunca `pnpm dev`, que fixa a 3100 do principal) |
| Banco | **`nutri_dev_c`** no Postgres de dev (`127.0.0.1:54329`), recriado do zero na abertura (o da onda 1 tem as migrations do Plano 20 por fora da `main`) |
| Preparar | com OK do dono (é apagar, mesmo em dev), do worktree principal: fechar a sessão do Plano 20 (`sessoes-paralelas.md` §4, "Fechar a sessão": parar `next dev` e `pnpm worker`, `git worktree remove ../nutridebby-c`, `dropdb … nutri_dev_c`); `git worktree remove ../nutridebby-23` (árvore limpa; o branch fica); depois `scripts/sessao-paralela.sh c plano-23-agenda-2` (cria o worktree no branch, o `.env.local` com a porta e o banco, o banco, `pnpm install --frozen-lockfile` e `pnpm db:migrate`) |
| Variáveis | nenhuma `DATABASE_URL`, `DATABASE_URL_MIGRATOR`, `APP_URL` ou `DATA_DIR` exportada no shell; conferir só os nomes: `env \| cut -d= -f1 \| grep -E '^(DATABASE_URL\|APP_URL\|DATA_DIR)'` |
| Olhar o banco | `docker compose -f ../nutridebby/docker-compose.dev.yml exec db psql -U nutri_owner -d nutri_dev_c` (o MCP `postgres-dev` aponta para o banco do principal; **nunca** produção, regra 5) |
| E2E | `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3103 pnpm test:e2e <spec>` (a `APP_URL` só nesse comando); parar o `pnpm worker` da sessão antes; **um E2E de cada vez entre as sessões** (Mailpit único). Bloco de IP do Plano 23: **`10.9.23.x`** (regra da orquestradora: sufixo = número do plano; livre em 17/11/2026 em todos os worktrees; AG-D56) |
| Vitest | `pnpm vitest run <arquivos>` sobe o próprio Postgres (Testcontainers); escalonar com as Sessões A (21) e B (22) |

Proibido nesta sessão: tocar produção (nem leitura), `docker service update`, push, merge, editar outros worktrees, `nutri-backup.sh`, subagente consultando banco de produção.

## Global Constraints

- Regras 1, 2, 3, 7, 8 e 9 do `CLAUDE.md`. Toda consulta a tabela com `tenant_id` por `withTenant(ctx, fn)`; o admin nunca consulta; as funções do painel conferem `ctx.role === 'nutri'` e lançam `Error('agenda: só a sessão nutri')` **antes** de abrir a transação (RN-400); `ctx` com `actorUserId` e `ip`.
- **Migrations:** uma gerada (`pnpm db:generate --name agenda_2`, sem edição à mão) e uma custom (`pnpm drizzle-kit generate --custom --name rls_agenda_2`), **só no PR 1**, com `DATABASE_URL_MIGRATOR` (regra 7). Número = o que o `db:generate` der em cima da `main` do momento; **nada reservado**. Antes de abrir o PR 1 (e de novo se outro PR com migration entrar antes — 18 PR 2, 19, 21 ou 22), `docs/operacao/sessoes-paralelas.md` §5, passos 1 a 8: guardar a custom, rebase em `origin/main`, apagar as duas e voltar o journal ao da `main`, gerar de novo, recriar a custom colando o SQL guardado **e trocando o corpo das funções de métricas e o CHECK de `notifications.tipo` pelos da `main` do momento** (R-410), conferir encadeamento (`idx`, `prevId`, `pnpm drizzle-kit check`, `grep -rn "<número antigo>" src test docs CLAUDE.md`), recriar o `nutri_dev_c` (com OK do dono) e rodar `pnpm vitest run src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/migrate.test.ts src/db/migrate-owner.test.ts src/modules/agenda/banco.test.ts`. O `migrate-owner.test.ts` é o único que migra com dono **sem** superusuário, como em produção: é nele que as peças `SECURITY DEFINER` são provadas (AG-D54).
- **Expansão, nunca contração** (RNF-407, C-406): colunas novas anuláveis ou com default; `tenants.endereco_consultorio` e `link_online_padrao` ficam; a chave nasce desligada. A imagem anterior tem de rodar sobre o banco do PR 1 (inclusive as regras "ambas" desdobradas: AG-D47).
- **Status:** `STATUS_ATIVOS` continua `['agendada','confirmada']`; `STATUS_OCUPA = [...STATUS_ATIVOS, 'solicitada']` só nos pontos da tabela fechada da spec §4.3. Nenhuma comparação ou filtro novo de status **de consulta** em `src/modules` e `src/app` fora dos pontos listados (guarda da T6a, com padrões restritos a status de consulta: `status ===`/`!== '<agendada|confirmada|cancelada|realizada|faltou|solicitada>'`, `ne|eq|inArray|notInArray(appointments.status`, SQL cru `status <> | not in | in ('cancelada'|'agendada'|'confirmada'…` e `Record<string` com a chave `agendada:`; exceções por arquivo, com contagem e motivo, nunca por linha). Todo mapa indexado por status é `Record<StatusConsulta, …>`.
- **Datas** no fuso do consultório (`tenants.fuso`): "hoje" = `hojeNoFuso(tenant.fuso, agora)` (`src/modules/pacientes/datas.ts:23`); helpers novos em `src/modules/agenda/calendario.ts` — **não editar** `src/modules/agenda/fuso.ts` (C-402); usar os que já existem (`segundaDaSemana`, `inicioDoDia`, `partesNoFuso`, `dataDaAgendaOuHoje`, `somarDias`).
- **Privacidade (regra 3, RNF-402):** nome de paciente, e-mail, endereço do local, link da sala e texto de mensagem nunca em log, Sentry ou mensagem de erro; erro loga só código e motivo técnico. O link da sala nunca na página pública, no WhatsApp, no push nem na impressão (RN-406).
- **Leitura da agenda sem `auditRead`** (RN-414, AG-D30): visões, filtro por paciente, marcadores, aniversariantes e seção "Consultas". A impressão grava **um** `recordAudit({ acao: 'exportar', entidade: 'agenda', entidadeId: '{de}..{ate}|{localId ou "todos"}', patientId: null })` na transação da leitura (RN-419).
- **Nada novo por WhatsApp:** nenhum tipo entra em `CONTA_COTA` (`src/modules/notificacoes/whatsapp/cota.ts:11`); `textoWhatsapp` devolve `null` para `aniversario` e `pedido_nao_confirmado` (C-405).
- **Sem fila nova e sem mexer em `src/worker/index.ts` nem em `src/jobs/queues.ts`** (disputados com 19 e 22): `vencerSolicitacoes` é chamada no começo de `processarNotificacoes` (C-403, AG-D19).
- **O vencimento nunca derruba a varredura** (AG-D67): `processarNotificacoes` é o job de minuto de todos os envios de todos os consultórios. `vencerSolicitacoes` abre uma transação por pedido, com `try/catch` que registra só o código e o motivo técnico (regra 3) e segue para o próximo; a chamada em `processarNotificacoes` fica também num `try/catch` próprio, como `processarComSeguranca`.
- **Grafo de imports** (`push.test.ts` "R1: web-push só no worker"; guarda RN-439 da T9): `solicitacoes.ts` e `aniversarios.ts` nunca importam `notificacoes/enviar.ts`, `push.ts` nem `mensagens.ts`; `aviso-nutri.ts` não importa `locais`, `solicitacoes`, `aniversarios` nem `retorno`.
- **Ordem global de travas** (AG-D65): e-mail (`travarEmail`) → tenant (`pg_advisory_xact_lock(hashtext('agenda-pedidos-tenant'), hashtext(tenantId))`) → paciente (`carregarPacienteParaEscrita` ou `FOR NO KEY UPDATE`) → consulta ou linha do pedido → notificações. Quem precisa da trava do tenant e da do paciente toma a do tenant **no começo da transação** (no portal, `agendarComoPaciente` e `remarcarComoPaciente`, antes de `carregarPacienteParaEscrita`; nunca dentro de `gravarConsultaDoPaciente`). A linha do pedido da pessoa nova só é travada por quem já segura a trava do tenant, então entre eles a ordem paciente × pedido é livre.
- **Links com token e impressão** (AG-D71): `next.config.ts` ganha, depois da regra `/:path*` (a última vence), `Referrer-Policy: no-referrer` + `Cache-Control: no-store` para `/n/:slug/pedido/:token*`, `/api/n/:slug/pedido/:token*`, `/aniversario/sair/:token*` e `/api/aniversario/sair/:token*`, e `Cache-Control: no-store` para `/painel/agenda/imprimir` (um `page.tsx` não define cabeçalho; molde das linhas 15-23).
- **Guia junto com a página** (`src/modules/ajuda/conteudo.test.ts`, "%s tem guia ou está em SEM_AJUDA"): a tarefa que cria um `page.tsx` em `/painel/agenda/*` amplia na mesma tarefa o `padrao` do guia `agenda` (hoje `/^\/painel\/agenda(\/(nova|pendencias|consultas\/.+))?$/`) ou põe a rota em `SEM_AJUDA`; mudar só o `padrao` não pede versão nova. Versão + 1 e passos novos ficam na T12.
- **Sem arquivo novo, sem PDF no servidor, sem dependência nova** (C-404, RNF-405): grade e impressão em HTML/CSS.
- **Nada da agenda nova na IA** (RN-439): `src/modules/ia/**` não importa `locais`, `aniversarios`, `retorno`, `solicitacoes` nem contém `retorno_previsto`; `src/modules/ia/campos-enviados.test.ts` continua verde sem mudança.
- **Textos** em pt-BR, **exatos** da spec §6.2, em `MSG_AGENDA`, `MSG_PUBLICO`, `MSG_LOCAIS`, `MSG_SOLICITACOES`, `MSG_ANIVERSARIO` (`src/modules/agenda/constantes.ts`). Rótulos de botão e campo podem morar nos `.tsx`; os que um guia cita entre aspas precisam existir num `.tsx` ou em `src/modules/agenda` (`TSX_FORA` de `src/modules/ajuda/conteudo.test.ts`).
- **Nome na agenda e na impressão = nome de registro** (`patients.nome`, Plano 18 D7, C-408); a única exceção é a saudação do aniversário (AG-D35).
- **Arquivos disputados** (`sessoes-paralelas.md` §6) — **só acrescentar**, no fim da lista, do objeto ou do bloco, no formato que a `main` tiver no rebase: `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md`, `src/db/tenant.ts` (`SEM_CONTA_PERMITIDOS`), `src/db/schema/agenda.ts`, `src/modules/ficha/secoes/index.ts`, `src/app/painel/configuracoes/page.tsx` (`CARTOES`), `src/modules/notificacoes/tipos.ts`, `src/email/types.ts`, `src/email/templates.tsx`, `src/modules/pacientes/{lgpd,exportacao-job}.ts`, `scripts/e2e-seed.ts`, `e2e/painel-rotas.ts`, `e2e/acessibilidade*.spec.ts`, `src/modules/ajuda/{conteudo,portal}.ts` (e testes), `docs/manual-tecnico/`, `.claude/agent-memory/**`, índice dos planos e backlog. No rebase, manter as duas contribuições; em `SO_APAGA.patients`, o filtro novo é uma linha `and not exists …` no fim da expressão.
- **`CLAUDE.md` no rebase:** cada regra é uma linha física. Ficar com a linha da `main` e reacrescentar só a frase "Plano 23" no fim das regras 1, 2 e 8; conferir `grep -c "Plano 2[0-3]" CLAUDE.md` antes e depois (não pode cair).
- **Não mudar assinaturas do Plano 20 PR 2:** `registrarPresenca` → `{ cobranca }` e `registrarAtendimento` → `{ id, cobranca }` (hoje `Promise<string>`, `src/modules/pacientes/atendimentos.ts:66`). As tarefas que tocam esses arquivos (T6, T9) rebaseiam sobre o 20 PR 2 e só acrescentam.

## Review Focus

1. **Peças `SECURITY DEFINER` com dono `NOBYPASSRLS`** — `app_locais_para_agendamento`, `app_local_da_consulta`, `app_pedidos_aguardando`, `app_pedido_aguardar`, `app_pedido_publico_desistir` (AG-D48; `gravou` e o primeiro nome só na chamada que gravou, AG-D63) e o gatilho `appointments_link_da_sala` (cópia da sala em qualquer papel, recusa só no `paciente`/`publico`; `local_id` nulo passa intacto): troca de papel para `worker`, filtro à mão por tenant (e paciente), contexto restaurado, `search_path`, `REVOKE`/`GRANT`. Provadas em `src/db/migrate-owner.test.ts` (T1); com o dono superusuário dos outros testes passariam sem provar nada.
2. **Transições do pedido no banco** — `appointments_regras_pedido`: nasce `solicitada` só em `paciente`/`publico` com a chave ligada; a remarcação provada pelo marcador `app.agenda_remarcavel` (também dentro de SAVEPOINT); os três `cancelado_por` novos só saindo de `solicitada`; `sistema` só com titular bloqueado. Testes em `src/modules/agenda/banco.test.ts` (T1) e `solicitacoes.test.ts` (T6).
3. **Concorrência e travas** — duas consultas em locais diferentes no mesmo horário (`EXCLUDE`); pessoa nova × paciente × portal no mesmo horário (trava do tenant de classe própria; ordem global e-mail → tenant → paciente → consulta/pedido, AG-D65, sem 40P01); vencimento × aceite (paciente → consulta → notificações, RN-427a); job avulso de um tenant não vence pedidos de outro. Testes nas T1, T6 e T7. O vencimento isola erro por pedido (AG-D67).
4. **Link da sala** — nunca ao `publico` nem ao `paciente` pela tabela; chaves de `horariosLivres`, `resolver()`, `textoWhatsapp`, `pushDaNotificacao` e da impressão; guarda de grep contra `select()` sem colunas em `appointments` no `publico` (CS-401). T1, T4, T5.
5. **Compatibilidade do deploy** — a imagem anterior sobre o banco do PR 1 (regras "ambas" desdobradas, AG-D47), o consultório criado depois da migration e a regra sem local (`garantirLocaisIniciais`, RN-410a), a página pública desligada sem tirar horários do portal (AG-D40). T1 a T3.
6. **LGPD do aniversário e da pessoa nova** — elegibilidade na marcação e no envio, uma por ano (índice + `ON CONFLICT` idênticos), retirada de um clique (RFC 8058) fora da guarda de mesma origem, cadastro só no aceite, dados do pedido apagados pela limpeza, exportação e anonimização. T7 e T10.
7. **Fuso** — virada do mês e da semana em `America/Sao_Paulo` com o servidor em UTC, 29/02, mensagem às 9h no fuso, janela de 12 h dos pedidos (AG-D41). T5, T6, T10.

## Ordem de entrega

| PR | Tarefas | Quando | Por quê |
|---|---|---|---|
| **PR 1 — fundação** | T1 (T1a, T1b, T1c) | **Portão real (AG-D66):** a T1 começa quando a orquestradora fechar a Sessão C do Plano 20, depois do merge do 20 PR 2 e do 20 PR 3 (AG-D46). Pronta, entra na fila de migrations (uma por vez), depois de todo PR com migration que já estiver nela (18 PR 2, 19; e o 21 ou o 22 que ficar pronto antes). O **código** do PR 1 não depende do 20 PR 2; a **sessão**, sim | Tabelas, gatilhos, funções, guardas, listas de isolamento e semente do E2E: o que os PRs seguintes (e os rebases dos outros planos) encontram na `main`. Pequeno no código; revisão do `revisor-rls` |
| **PR 2 — locais e visões** | T2 a T5 | Depois do merge do PR 1 **e** do 20 PR 2 (`consultas/[id]/page.tsx`, `agenda/actions.ts`, `e2e/agenda.spec.ts`) | Sem migration: só o trem de CI. Entrega PD-70 (sem a Fase B) e PD-71/PD-72 (menos previsão de retorno) |
| **PR 3 — pedidos, retorno e aniversário** | T6 a T10 | Depois do merge do PR 2 | Sem migration. A T6 e a T7 vão juntas com a T8 (a chave só aparece na tela da T8; o banco já recusa tudo o que a tela não oferece) |
| **PR 4 — Fase B** | T11 | **Portão:** só com o 18 PR 2 e o 20 PR 2 na `main`; se a onda 1 atrasar, vira o Plano 23B sem refazer a spec (AG-D38) | Filtros de local fora da agenda |
| — | T12 | Fecha o plano (depois do último PR) | Manuais, ajuda, backlog, runbook |

**Trava da chave (decisão da orquestradora 17/11, `/code-review` do #59):** `tenants.agenda_confirmar_pedidos` só pode ser ligada — em produção, pela tela da T8 ou por qualquer PR que a ligue — depois que a T6 e a T10 estiverem na `main` (critérios de aceite vindos do #59: métricas e exclusão LGPD com `solicitada`; anonimização das autorizações de aniversário). Até lá, os três ficam sem efeito porque a chave está desligada.

**Nota para a T2/PR 2 (re-revisão do #59):** ao mover uma consulta de origem `paciente` para um local online **sem sala** (só a equipe chega lá), o `UPDATE` de `local_id` precisa mandar o `link_online` explicitamente: o gatilho `appointments_link_da_sala` usa `coalesce(link_sala, NEW.link_online)` e, sem link no `UPDATE`, ficaria a sala do local anterior.

O fechamento de cada PR (axe das rotas novas, `ROTAS_DO_PAINEL`, manual técnico do que mudou) é o passo final da última tarefa do PR; a T12 só fecha o plano.

**Branch do PR 2 depois do merge do PR 1.** O §5 regenera as migrations no `plano-23-fundacao`; o `plano-23-agenda-2` continua com os commits velhos da T1. Depois do merge do PR 1:

```bash
git fetch origin
git rebase --onto origin/main <último commit da T1> plano-23-agenda-2   # descarta os commits da T1, já na main
git diff origin/main -- drizzle/                                       # tem de sair vazio
```

Depois, recriar o `nutri_dev_c` do zero (§5, passo 7, **com OK do dono**).

Merge sempre com OK do dono (merge = deploy; a migration do PR 1 roda no boot); nunca das 03h às 07h30 BRT; **sem snapshot da Hostinger** (congela a VPS): migration só aditiva e o backup restic diário. Runbook de volta atrás (R-403) em `docs/operacao/agenda-2.md`, **criado na T1** (PR 1) e completado nas T5 e T8; a descrição de cada PR leva a seção "Volta atrás" com os efeitos daquele PR (AG-D68). Regra fixa do runbook: **nunca voltar para uma imagem anterior ao PR 1**; a volta mínima é a imagem do PR 1 (tem a junção da AG-D47).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/db/schema/agenda.ts` (modificar, só acrescentar) | `locaisAtendimento`, `aniversarioAutorizacoes`; colunas novas de `appointments`, `availabilityRules`, `publicBookingRequests`; CHECKs com `solicitada`, `cancelado_por` novos e tipos novos de `notifications` |
| `src/db/schema/platform.ts`, `src/db/schema/pacientes.ts` (modificar) | `tenants.agendaConfirmarPedidos`; `consultations.retornoPrevistoEm` |
| `drizzle/<NNNN>_agenda_2.sql` (gerada) + `drizzle/<NNNN+1>_rls_agenda_2.sql` (custom) | Tabelas e colunas; RLS, funções, gatilhos, locais iniciais, backfill das regras, métricas |
| `src/modules/agenda/status.ts` (novo, puro) | `STATUS_OCUPA`, `ROTULO_STATUS` (sai de `src/app/painel/agenda/periodo.ts:16`, que reexporta; AG-D57), rótulos e selos do pedido, `TITULO_SECAO_CONSULTAS` (T9) e o fragmento `sqlEhRetorno` (T5; só `sql` do drizzle, sem I/O) |
| `src/modules/agenda/calendario.ts` (novo, puro) | Semana, mês (segunda a domingo), faixa da grade, "Ir para data", dia do aniversário (29/02) |
| `src/modules/agenda/locais.ts` (novo) | CRUD, `garantirLocaisIniciais`, projeções, `localPrincipal`, `linkSugerido` |
| `src/modules/agenda/visoes.ts` (novo) | `agendaDoPeriodo`, `hrefDaAgenda`, `lerFiltros`, classificação Primeira consulta/Retorno, selos, marcadores |
| `src/modules/agenda/impressao.ts` (novo) | Linhas da impressão (lista fechada) e o `exportar` |
| `src/modules/agenda/solicitacoes.ts` (novo) | Fila, aceitar, recusar, desistir, vencer |
| `src/modules/agenda/retorno.ts` (novo) | `previsoesDeRetorno` |
| `src/modules/agenda/aniversarios.ts` (novo; em `SEM_CONTA_PERMITIDOS`) | Lista do mês, elegibilidade, envio, autorização, retirada pelo link |
| `src/modules/agenda/aniversario-link.ts` (novo, puro) | Token HMAC do link de saída (AG-D50) |
| `src/modules/ficha/secoes/consultas.ts` (novo) | Seção "Consultas" do Início da ficha |
| Mudam em `src/modules/agenda/` | `consultas.ts`, `disponibilidade.ts`, `horarios.ts`, `agendamento-paciente.ts`, `agendamento-publico.ts`, `acoes-link.ts`, `cancelamento.ts`, `presenca.ts`, `inicio.ts`, `constantes.ts`, `aviso-nutri.ts` |
| Mudam fora | `notificacoes/{tipos,mensagens,enviar,agendar}.ts`, `src/email/{types,templates.tsx,transport,job}.ts`, `portal/agenda.ts`, `pacientes/{atendimentos,exportacao-job,lgpd}.ts`, `plataforma/marca.ts`, `src/db/tenant.ts`, `src/db/{rls-guard,audit-guard}.ts`, `next.config.ts` (cabeçalhos dos tokens e da impressão, AG-D71), `docs/operacao/agenda-2.md` (runbook, desde a T1) |
| Telas novas | `src/app/painel/agenda/{locais,solicitacoes,aniversariantes,imprimir}/page.tsx` (+ `actions.ts` e componentes), `src/app/painel/agenda/abas.tsx`, `src/app/aniversario/sair/[token]/page.tsx`, `src/app/n/[slug]/pedido/[token]/page.tsx` |
| Rotas novas | `src/app/api/aniversario/sair/[token]/route.ts` (um clique, RN-434), `src/app/api/n/[slug]/pedido/[token]/route.ts` (desistência da pessoa nova) |
| Telas que mudam | `src/app/painel/agenda/{page.tsx,periodo.ts,item-consulta.tsx,consulta-form.tsx,nova/page.tsx,consultas/[id]/page.tsx,horarios/*}`, `src/app/painel/page.tsx`, `src/app/painel/configuracoes/{page.tsx,perfil-form.tsx}`, `src/app/n/[slug]/*`, `src/app/p/(portal)/agenda/**`, `src/app/p/(portal)/perfil/*`, `src/app/consulta/[token]/*`, `src/components/seletor-horarios.tsx`, `src/app/painel/pacientes/[id]/atendimentos/*` |
| Testes novos | `src/modules/agenda/{banco,locais,calendario,visoes,impressao,solicitacoes,pedido-publico,retorno,aniversarios,status-guarda}.test.ts`, `src/app/api/aniversario/sair/[token]/route.test.ts`, `e2e/agenda-2.spec.ts` |

---

### Task 1: Fundação — schema, migrations, funções, gatilhos, guardas e semente (PR 1)

> **Divisão (AG-D69):** um PR só, executado e revisado em três subtarefas, cada uma com o próprio ciclo TDD (Steps 1 a 5 só com os seus testes), commit (`P23-01a`, `-01b`, `-01c`) e revisão do `revisor-rls`. A custom `rls_agenda_2` é uma só; cada subtarefa acrescenta o seu trecho na ordem da lista "Custom" abaixo. **T1a** — schema, gerada, RLS (`staff_only`, `patient_rls`, `aguardando_fora_do_publico`, `paciente_aniversario_proprio`, `REVOKE`), CHECKs, listas das guardas, isolamento, `CLAUDE.md` e o runbook inicial; testes de RLS, CHECK e FK de `banco.test.ts`. **T1b** — gatilhos `appointments_regras_pedido`, `tenants_agenda_da_equipe` e `aniversario_autorizacoes_regras`; testes de gatilho de `banco.test.ts`. **T1c** — funções `SECURITY DEFINER`, `appointments_link_da_sala`, `app_anonimizar_autorizacoes_aniversario`, backfill, métricas, `migrate-owner.test.ts`, `metricas*.test.ts`, semente e `gerarHorarios`. O §5 do `sessoes-paralelas.md` e o "Pronto quando" valem para o PR.

**Files:**
- Modify: `src/db/schema/agenda.ts` (tabelas e colunas da spec §9.1–§9.4, §9.7, §9.8, no fim do arquivo e das listas de colunas), `src/db/schema/platform.ts` (`agendaConfirmarPedidos`), `src/db/schema/pacientes.ts` (`retornoPrevistoEm` em `consultations`, `:127`)
- Create: `drizzle/<NNNN>_agenda_2.sql` (`pnpm db:generate --name agenda_2`), `drizzle/<NNNN+1>_rls_agenda_2.sql` (`pnpm drizzle-kit generate --custom --name rls_agenda_2`)
- Modify: `src/modules/agenda/horarios.ts` — **só** `gerarHorarios` junta horários de mesmo `inicio`/`fim` (união das modalidades), para a imagem do PR 1 funcionar com as regras "ambas" desdobradas pelo backfill (AG-D47)
- Modify: `src/db/rls-guard.ts` (`STAFF_ONLY` + `locais_atendimento`, motivo "link da sala: fora do paciente e do público; projeções `app_locais_para_agendamento`/`app_local_da_consulta` (Plano 23, AG-D4)"; `PACIENTE_ESCREVE` + `aniversario_autorizacoes: { comandos: ['insert'], motivo }`), `src/db/audit-guard.ts` (`AUDIT_EXCEPTIONS` + `aniversario_autorizacoes`, "prova só de inclusão: quem, quando, origem e forma na própria linha, como `consents` e `ia_autorizacoes` (Plano 23, RN-433)")
- Modify: `test/isolamento.test.ts` — `FABRICAS` (`locais_atendimento` com `nome = 'Local ' || patientId` e `principal = false`; `aniversario_autorizacoes` no molde de `ia_autorizacoes`, `test/isolamento.test.ts:130-135`: `insert into aniversario_autorizacoes (tenant_id, patient_id, evento, origem, forma, registrado_por) values (${t}, ${p}, 'retirou', 'nutri', 'escrito', coalesce(app_current_user(), gen_random_uuid()))`, com o comentário "`retirou`: o gatilho nunca procura o titular, que B e P2 não enxergam; `coalesce`: nos contextos sem usuário (publico, conta) o gatilho deixa passar e a RLS recusa"), `ULTIMAS` (`'locais_atendimento'` logo depois de `'appointments'`), `SO_INSERE` + `aniversario_autorizacoes`, `SO_APAGA.patients` (linha `and not exists (select 1 from aniversario_autorizacoes a where a.tenant_id = patients.tenant_id and a.patient_id = patients.id)` no fim). **`appointments` não entra em `IMUTAVEIS`**: as linhas da fábrica nascem `agendada` com origem `nutri`, o gatilho não recusa nada nelas, e trocar `violaRls` por `negado` (qualquer 42501) só enfraqueceria a prova numa tabela de `PUBLICO_LIBERADO`; a imutabilidade do pedido tem teste próprio em `banco.test.ts`
- Modify: `src/db/migrate-owner.test.ts` — `describe` novo no fim (AG-D54), que acha a custom por `readdirSync(new URL('../../drizzle/', import.meta.url)).find((f) => f.endsWith('_rls_agenda_2.sql'))`, sem número fixo (o §5 renumera); `src/db/migrate.test.ts` — guarda do journal (já na `main` pelo Plano 20) conferida com as duas novas
- Modify: `scripts/e2e-seed.ts` — locais da semente (AG-D59), chave desligada a cada execução, horários próprios do Plano 23 no `EXCLUDE`
- Modify: `CLAUDE.md` — frases "Plano 23" no fim das regras 1, 2 e 8 (texto da spec §9.10)
- Create: `src/modules/agenda/banco.test.ts`, `docs/operacao/agenda-2.md` (runbook; nesta tarefa só a seção "Volta atrás" do PR 1: a imagem anterior ao PR 1 sobre as regras desdobradas gera dois horários no mesmo instante e recusa o online — nunca voltar para ela; AG-D68)
- Test: `src/modules/agenda/horarios.test.ts` (caso novo), `src/modules/plataforma/metricas.test.ts` (`admin_tenant_metrics`) e `src/modules/plataforma/metricas-sucesso.test.ts` (`admin_metricas_sucesso`): caso novo "consulta `solicitada` inserida pelo dono não conta", no PR 1, junto com o `CREATE OR REPLACE`

**Interfaces:**
- Produces (schema, fonte única para as outras tarefas):
```ts
export const TIPOS_DE_LOCAL = ['presencial', 'online'] as const; export type TipoDeLocal = (typeof TIPOS_DE_LOCAL)[number];
export const locaisAtendimento = pgTable('locais_atendimento', { id, tenantId, nome, tipo, endereco, cidade, mostrarEndereco, linkSala, agendamentoOnline, principal, arquivadoEm, createdAt, updatedAt }, …);
export type LocalRow = typeof locaisAtendimento.$inferSelect;
export const EVENTOS_ANIVERSARIO = ['autorizou', 'retirou'] as const; export const ORIGENS_ANIVERSARIO = ['nutri', 'app', 'link'] as const;
export const FORMAS_ANIVERSARIO = ['escrito', 'mensagem', 'verbal'] as const; export type FormaAniversario = (typeof FORMAS_ANIVERSARIO)[number];
export const aniversarioAutorizacoes = pgTable('aniversario_autorizacoes', { id, tenantId, patientId, evento, origem, registradoEm, registradoPor, forma }, …);
// appointments: localId; publicBookingRequests: fim, localId, aguardandoDesde, resolvidoEm, resolucao; availabilityRules: localId
export const RESOLUCOES_DO_PEDIDO = ['aceito', 'recusado', 'vencido', 'desistido'] as const; // CHECK + `(resolucao is null) = (resolvido_em is null)` (AG-D63)
// tenants: agendaConfirmarPedidos; consultations: retornoPrevistoEm
export const CANCELADO_POR_PEDIDO = ['pedido_desistido', 'pedido_recusado', 'pedido_vencido'] as const;
```
- `registrado_por` é `uuid` **sem FK** para `user` (molde de `criado_por` do Plano 20: a semente apaga e recria as contas; as fábricas usam `randomUUID()`).
- Índice único parcial do aniversário **no schema** (vai para a gerada) com a expressão literal da spec §9.8; o `ON CONFLICT` da T10 repete a expressão e o `WHERE` (constante `ANIVERSARIO_UM_POR_ANO` exportada ao lado, molde de `tipoUmPorHorario`).
- Custom `rls_agenda_2`, nesta ordem (molde 0116/0117 e 0083): `app_enable_tenant_rls` + `app_enable_staff_only('locais_atendimento')`; `app_enable_tenant_rls` + `app_enable_patient_rls('aniversario_autorizacoes')` + `app_allow_paciente_escrita('aniversario_autorizacoes', 'insert')` + política RESTRICTIVE `paciente_aniversario_proprio` + `REVOKE UPDATE, DELETE, TRUNCATE … FROM nutri_app_role`; política RESTRICTIVE `aguardando_fora_do_publico` (`FOR ALL`, `USING (app_current_role() is distinct from 'publico' or aguardando_desde is null)`, `WITH CHECK (app_current_role() is distinct from 'publico' or (aguardando_desde is null and resolvido_em is null and resolucao is null))`) em `public_booking_requests` — **o nome não começa com `publico`** (AG-D64): `findPublicoViolations` (`src/db/rls-guard.ts:151-178`) lê toda política `like 'publico%'` e, em tabela de `PUBLICO_LIBERADO`, exige só os `publico_sem_<comando>`; o arquivo é disputado e não muda; funções `app_locais_para_agendamento()`, `app_local_da_consulta(uuid)`, `app_pedidos_aguardando(timestamptz, timestamptz)` (papéis `publico` e `paciente`; AG-D58), `app_pedido_aguardar(uuid, uuid, timestamptz, timestamptz)`, `app_pedido_publico_desistir(text, boolean)` (AG-D48); gatilhos `appointments_regras_pedido` (BEFORE INSERT OR UPDATE), `appointments_link_da_sala` (BEFORE INSERT, `SECURITY DEFINER`), `tenants_agenda_da_equipe` (BEFORE UPDATE), `aniversario_autorizacoes_regras` (BEFORE INSERT); `app_anonimizar_autorizacoes_aniversario(uuid)`; bloco `-- P23-BACKFILL início` … `-- P23-BACKFILL fim` (locais iniciais e backfill das regras, `NO FORCE … FORCE` da 0042, **idempotente**: só tenant sem nenhum local e só regra com `local_id` nulo, para o teste poder rodar o bloco de novo); `CREATE OR REPLACE` de `admin_tenant_metrics()` (0059) e `admin_metricas_sucesso()` (0087) com `not in ('cancelada','solicitada')`, corpo copiado da `main` na regeneração.
- Molde de toda peça `SECURITY DEFINER` (spec §9.1): guarda `app.role` e `app.patient_id`; nas **funções**, fora do papel esperado ou com tenant nulo devolve vazio (o gatilho `appointments_link_da_sala` tem regra própria, abaixo: a cópia vale em qualquer papel); `set_config('app.role','worker',true)` e `set_config('app.patient_id','',true)`; filtro à mão por `tenant_id = app_current_tenant()` (e `patient_id` guardado em `app_local_da_consulta`); restaura o contexto antes de cada `RETURN` (também nos ramos de erro com `EXCEPTION`); `SET search_path = public, pg_temp`, nomes com `public.`; `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO nutri_app_role`.
- `app_locais_para_agendamento()` (papéis `publico` e `paciente`; AG-D62) `RETURNS TABLE (id uuid, nome text, tipo text, cidade text, endereco text, principal boolean, agendamento_online boolean, criado_em timestamptz)`: **todos** os locais ativos do tenant, `ORDER BY principal desc, created_at, id`; nunca `link_sala`; `nome` e `cidade` só quando `agendamento_online` (nulos nos outros: minimização); `endereco` só com `mostrar_endereco` **e** `agendamento_online`. O recorte por `agendamento_online` é feito no TS, **depois** de `regraNoLocal` (RN-410a): a regra sem local vai para o principal ativo do tipo (ou, no `ambas`, para o primeiro online ativo por `created_at`) mesmo que ele não aceite agendamento, e então não gera horário fora do painel.
- `appointments_link_da_sala` (BEFORE INSERT, `SECURITY DEFINER`): `IF NEW.local_id IS NULL THEN RETURN NEW` **antes** de trocar o papel (a imagem anterior e a do PR 1 gravam consulta do portal e da página pública sem local, com o `link_online` mandado pelo código); com local, troca para `worker`, lê o local do tenant e (a) **em qualquer papel**, quando `NEW.origem = 'paciente'` e o local é online, `NEW.link_online := link_sala` (o aceite da pessoa nova roda na sessão `nutri` com `origem = 'paciente'`; sem a cópia, o CHECK `appointments_link_online` recusaria todo aceite online); (b) **só** nos papéis `paciente` e `publico`, recusa com 42501 local arquivado ou sem `agendamento_online`; restaura o contexto antes do `RETURN` e do `RAISE`.
- `app_pedido_aguardar(p_pedido uuid, p_local uuid, p_inicio timestamptz, p_fim timestamptz)` devolve `text` (`'ok' | 'teto_tenant' | 'email' | 'ocupado' | 'invalido'`); trava `pg_advisory_xact_lock(hashtext('agenda-pedidos-tenant'), hashtext(tenant))` antes de ler; `invalido` quando o pedido não tem `verificado_em` dentro da validade (30 min: constante igual a `VERIFICADO_VALIDADE_MS` de `agendamento-publico.ts:59`, com comentário nos dois lados), já está aguardando ou concluído, ou quando `p_local` não é local ativo com `agendamento_online` do tenant; grava `local_id`, **`modalidade` = tipo do local** (lido sob a troca de papel; a FK composta recusaria outro), `inicio`, `fim` e `aguardando_desde`; teto **20** por tenant e **1** por e-mail; sobreposição com `appointments` em `('agendada','confirmada','solicitada')` e com os outros aguardando.
- `app_pedido_publico_desistir(p_token_hash text, p_confirmar boolean) RETURNS TABLE (estado text, inicio timestamptz, gravou boolean, primeiro_nome text)` (papel `publico`; AG-D48, AG-D63), sob a trava do tenant → linha do pedido: `estado` ∈ `aguardando` (mostra, com `p_confirmar` falso), `cancelado` (gravou agora `resolvido_em` + `resolucao = 'desistido'` com `p_confirmar`, **ou** a linha já tem `resolucao = 'desistido'`), `invalido` (não existe, sem `aguardando_desde`, vencido, aceito ou recusado); `gravou` só é verdadeiro na chamada que gravou, e `primeiro_nome` (primeira palavra de `nome`) só vem nela. A rota avisa a nutricionista só com `gravou = true`: F5, duplo clique e o provedor que reabre o link não repetem o aviso.
- `public_booking_requests.resolucao` (AG-D63) é gravada junto com `resolvido_em`: `aceito` (`aceitarPedidoPublico`), `recusado` (recusa), `vencido` (`vencerSolicitacoes`), `desistido` (a função acima).
- `appointments_regras_pedido` segue RN-421 e RN-422 da spec **ao pé da letra** (marcador `app.agenda_remarcavel`, limpo depois do INSERT aceito; `pedido_desistido` nunca liga o marcador); comparações com `IS DISTINCT FROM`; `ERRCODE = '42501'`; condições com `coalesce(current_setting(…, true), '')`. `cancelado_por = 'pedido_vencido'` só no papel `worker` **e** com `OLD.inicio - make_interval(hours => t.antecedencia_min_h) <= now()` (de `tenants` do `OLD.tenant_id`): o processo web também usa o papel `worker` (página pública, limpeza), e um caminho errado não pode vencer pedido no prazo.
- `aniversario_autorizacoes` (AG-D61): CHECK `aniversario_autorizacoes_forma` = `(origem = 'nutri' and (evento = 'retirou' or forma is not null)) or (origem <> 'nutri' and forma is null)` — a retirada pela nutricionista não pede a forma (LGPD, art. 8º, § 5º: retirar tem de ser fácil). Gatilho `aniversario_autorizacoes_regras` (BEFORE INSERT): grava `registrado_em = clock_timestamp()`; **na sessão `nutri`**, só origem `nutri` com `registrado_por = app_current_user()` (42501 próprio); no `worker`, 42501 próprio; em `autorizou`, procura o titular e recusa (42501) só o titular **visível** com `status <> 'ativo'` ou `anonimizado_em` não nulo — o invisível (outro tenant, outro paciente) passa, e a RLS recusa. Nos papéis `publico`, `conta` e `paciente`, o gatilho não recusa por origem nem por autoria: quem recusa é a RLS (`publico_negado`, isolamento do tenant, `paciente_aniversario_proprio`), para os testes genéricos do isolamento receberem a mensagem "row-level security" (`violaRlsDe`, `test/isolamento.test.ts:371`).

- [ ] **Step 1: Testes que falham** em `src/modules/agenda/banco.test.ts` (sessões por `withTenant`; helpers de `test/sessao.ts`, `test/pacientes.ts`, `test/portal.ts`, `test/agenda.ts`):
  - `locais: nutri cria e lê; paciente e publico não leem nenhuma linha` (`staff_only`, `publico_negado`).
  - `locais: principal único ativo` (segundo principal → 23505), `principal arquivado` → CHECK, `online com endereço` → CHECK, `link_sala fora de ^https://\S+$` → CHECK, `agendamento_online em online sem sala` → CHECK, `nome repetido sem diferença de maiúsculas entre não arquivados` → 23505 (arquivado não conta).
  - `FK composta: consulta presencial em local online` → 23503; `mudar o tipo de local usado` → 23503; `excluir local usado` → 23503 (`NO ACTION`).
  - `pedido: chave desligada → INSERT de paciente nasce agendada`; `chave ligada → paciente e publico nascem solicitada`; `nutri e worker nunca nascem solicitada`; `solicitada com origem nutri` → CHECK `appointments_solicitada_do_paciente`.
  - `remarcação: cancelar agendada como paciente + INSERT com remarcada_de = ela → agendada` (também dentro de `SAVEPOINT`); `desistir de solicitada (pedido_desistido) + INSERT com remarcada_de → solicitada`; `remarcada_de de outro paciente → solicitada`; `segundo INSERT com o mesmo marcador → solicitada` (uma por cancelamento).
  - `transições: solicitada → agendada só nutri`; `→ cancelada com (paciente, pedido_desistido)`, `(nutri, pedido_recusado)`, `(worker, pedido_vencido)` passam; trocas de papel × valor → 42501; `(worker, pedido_vencido)` antes do prazo (`inicio − antecedência > now()`) → 42501; `(nutri, sistema)` com titular `ativo` → 42501, com `bloqueado` passa; `pedido_* saindo de agendada` → 42501; `UPDATE para solicitada` → 42501; `inicio`, `fim`, `local_id`, `modalidade`, `patient_id` de solicitada → 42501.
  - `tenants_agenda_da_equipe`: `paciente`, `publico` e `conta` mudando `agenda_confirmar_pedidos` → 42501; `nutri` passa; UPDATE de outra coluna pelo `paciente` não é barrado por este gatilho.
  - `aguardando_fora_do_publico`: o `publico` não vê a linha aguardando (`SELECT` e `SELECT … FOR UPDATE` vazios); UPDATE direto do `publico` para `aguardando_desde` (com e sem `WHERE`) → 42501; INSERT do `publico` já aguardando (com e sem `RETURNING`) → 42501, o comum (com ou sem `local_id`) passa; `rls-guard: findPublicoViolations()` sem violação depois da migration (AG-D64); CHECK de `resolucao` (sem `resolvido_em` → 23514; valor fora da lista → 23514).
  - `aniversario_autorizacoes`: `nutri` com `forma` e `registrado_por` = a própria usuária passa (`registrado_em` = `clock_timestamp()`, mesmo se o módulo mandar outro); `nutri` **retira sem forma → passa**; `nutri` autoriza sem forma → 23514 (AG-D61); `registrado_por` de outra usuária → 42501; paciente com conta canal `app` passa só com `registrado_por = app_current_user()` e o próprio `patient_id`; **paciente com conta + origem `link` → 42501 da RLS**; **P2 + origem `app` + `patient_id` de P1 → 42501 da RLS**; `link` (`semConta`) só `retirou` e `registrado_por` nulo; `autorizou` de titular arquivado, bloqueado ou anonimizado → 42501 do gatilho; `worker` → 42501 do gatilho; `publico` → 42501 **da RLS** (mensagem "row-level security", não do gatilho); UPDATE/DELETE/TRUNCATE → 42501 de permissão.
  - `notifications`: CHECK aceita `aniversario` (sem consulta) e `pedido_nao_confirmado`; índice do aniversário: segunda linha do mesmo paciente no mesmo ano (UTC) → 23505, inclusive com a primeira `ignorada`.
  - `consultations.retorno_previsto_em` fora de `[data, data + 730]` → CHECK; mudar a `data` de um atendimento com previsão para depois dela → CHECK (a T9 traduz).
  - `escrita vira audit_log`: aceite de pedido (UPDATE em `appointments`) com entidade `agenda`; `aniversario_autorizacoes` sem gatilho de auditoria.
  - Em `src/db/migrate-owner.test.ts` (`describe('Plano 23: peças SECURITY DEFINER com dono NOBYPASSRLS')`, AG-D54): `app_locais_para_agendamento` no `publico` e no `paciente` devolve todos os ativos (arquivado fora) com `principal`, `agendamento_online` e `criado_em`, na ordem principal → `created_at` → `id`, sem `link_sala` nas chaves, com `nome`/`cidade` nulos no local sem agendamento e `endereco` nulo sem `mostrar_endereco` ou sem agendamento, e vazio no `nutri`; com a projeção, "principal sem agendamento + outro presencial com agendamento": a regra sem local não gera horário no `publico` (AG-D62); `app_local_da_consulta` devolve o local da consulta do próprio paciente e vazio para a consulta de outro; `appointments_link_da_sala` copia `link_sala` para `link_online` numa consulta `origem = 'paciente'` em local online (o `link_online` que o código mandou é ignorado), **também na sessão `nutri` com origem `paciente`**, e recusa (42501) local arquivado ou sem `agendamento_online` só no `paciente`/`publico`; INSERT de `paciente` e de `publico` com `local_id` nulo (imagem do PR 1) passa intacto, com o `link_online` mandado e `agendada` com a chave desligada; `app_pedidos_aguardando` devolve só `tstzrange`; `app_pedido_aguardar` grava e devolve `teto_tenant` (21º), `email` (2º do mesmo e-mail), `ocupado` (sobre `solicitada` e sobre outro aguardando) e `invalido` (sem `verificado_em`, com `verificado_em` de mais de 30 min, com local arquivado ou sem agendamento); pedido presencial aguardando num local online grava `modalidade = 'online'`; `app_pedido_publico_desistir` mostra (GET: `gravou` falso, sem nome), cancela com `p_confirmar` (`gravou` verdadeiro e o primeiro nome, uma vez), chamada de novo devolve `cancelado` com `gravou` falso e sem nome, e devolve `invalido` para token de pedido concluído, recusado ou vencido; depois de cada chamada, `current_setting('app.role')` e `app.patient_id` são os de antes; `nutri_app` executa `app_anonimizar_autorizacoes_aniversario` e ela recusa titular não bloqueado e anula só `registrado_por` de origem `app`.
  - Backfill (mesmo `describe`, por último no arquivo, porque roda em todos os tenants do cluster, como o caso da 0110): o bloco `P23-BACKFILL` lido do SQL da custom e rodado de novo pelo dono sobre consultórios preparados — (com endereço, sem link, regra "ambas") → "Consultório" principal + "Videoconferência" sem sala, `ambas` vira presencial + par online; (sem endereço, com link, só regra `online`) → só "Videoconferência" principal com `link_sala`; (sem nada) → só "Consultório"; (com endereço e com link, `agendamento_publico_ativo = false`) → os dois com `agendamento_online` conforme AG-D40 (o portal continua com horários); rodar de novo não duplica nada.
  - Em `horarios.test.ts`: `gerarHorarios junta presencial e online do mesmo início e fim num horário com as duas modalidades` (AG-D47) e `escolherHorario aceita online no horário juntado` (a T3 restringe a junção ao mesmo `localId` e reescreve estes casos).
  - Em `metricas.test.ts` e `metricas-sucesso.test.ts`: consulta `solicitada` inserida pelo dono não conta em `admin_tenant_metrics()` nem em `admin_metricas_sucesso()`.
- [ ] **Step 2:** `pnpm vitest run src/modules/agenda/banco.test.ts src/db/migrate-owner.test.ts src/modules/agenda/horarios.test.ts` → FAIL (tabelas e colunas não existem).
- [ ] **Step 3:** schema, `pnpm db:generate --name agenda_2`, custom, `pnpm db:migrate` (com o `DATABASE_URL_MIGRATOR` do `.env.local`); `gerarHorarios`; listas das guardas; semente; `CLAUDE.md`.
- [ ] **Step 4:** `pnpm vitest run src/modules/agenda/banco.test.ts src/db/migrate.test.ts src/db/migrate-owner.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/db/sem-conta-guarda.test.ts test/isolamento.test.ts src/modules/agenda src/modules/notificacoes src/modules/plataforma/metricas.test.ts src/modules/plataforma/metricas-sucesso.test.ts` → PASS; `pnpm typecheck && pnpm lint`; `pnpm e2e:seed` duas vezes seguidas no `nutri_dev_c` sem erro.
- [ ] **Step 5:** commits `feat(agenda): … no banco (P23-01a|b|c)`, um por subtarefa. Descrição do PR 1 com a seção "Volta atrás" (runbook).

**Pronto quando:** testes verdes; `pnpm e2e:seed` repetível; revisão do `revisor-rls` sem Critical/Important; §5 do `sessoes-paralelas.md` feito sobre a `main` atual; PR 1 pronto para abrir (sem push sem o OK; a orquestradora conduz).

---

### Task 2: Locais de atendimento — módulo, tela, Perfil e hub (PR 2)

**Files:**
- Create: `src/modules/agenda/status.ts`, `src/modules/agenda/locais.ts`, `src/app/painel/agenda/locais/{page.tsx,actions.ts,local-form.tsx}`, `src/app/painel/agenda/abas.tsx` (`AbasDaAgenda`)
- Modify: `src/modules/agenda/constantes.ts` (`MSG_LOCAIS`), `src/app/painel/agenda/periodo.ts` (reexporta `ROTULO_STATUS` de `status.ts`; AG-D57), `src/app/painel/configuracoes/page.tsx` (cartão "Locais de atendimento" no **fim** de `CARTOES`, texto "Consultórios, salas de videoconferência e onde cada um aceita agendamento."), `src/app/painel/configuracoes/perfil-form.tsx` (rótulo "Endereço profissional (documentos)" com a ajuda; o campo `linkOnlinePadrao` sai e dá lugar ao aviso com link para Locais; aviso do CRN), `src/app/painel/actions.ts` e `src/modules/plataforma/marca.ts` (o perfil deixa de gravar `linkOnlinePadrao`: sai de `perfilSchema`/`atualizarPerfil`; a coluna fica — AG-D7), `e2e/painel-rotas.ts` (`/painel/agenda/locais`), `src/modules/agenda/inicio.ts` (`lerInicio(ctx, tenant)`: o `Pick` do tenant ganha `'id' | 'enderecoConsultorio'` e a transação chama `garantirLocaisIniciais` no começo) + `src/app/painel/page.tsx` (passa o tenant), `src/modules/agenda/disponibilidade.ts` (`listarRegras` chama `garantirLocaisIniciais`: Horários), `src/app/painel/agenda/pendencias/page.tsx` e `src/app/painel/agenda/horarios/page.tsx` (só a aba), `src/modules/ajuda/conteudo.ts` (só o `padrao` do guia `agenda` + `locais`)
- Test: `src/modules/agenda/locais.test.ts`, `src/modules/agenda/status.test.ts`, `src/app/painel/agenda/locais/page.test.ts`, `src/app/painel/actions.test.ts` (`describe` próprio no fim: salvar o Perfil não lê nem grava `link_online_padrao`, e o valor antigo continua no banco; ajustar os casos que mandam `linkOnlinePadrao`, `:36` e `:62-93`), `src/modules/plataforma/marca.test.ts` (`linkOnlinePadrao` sai do `perfilSchema`; ajustar `:15`, `:44-46` e `:62-66`), `src/modules/agenda/inicio.test.ts`, `src/modules/agenda/disponibilidade.test.ts`

**Interfaces:**
```ts
// status.ts (puro: só tipos de consultas.ts)
export const STATUS_OCUPA: readonly StatusConsulta[]; // agendada, confirmada, solicitada (a T6 acrescenta 'solicitada' a StatusConsulta; até lá, a constante nasce com os dois e um teste fixa a lista)
export const ROTULO_STATUS: Record<StatusConsulta, string>;
// locais.ts
export class LocalError extends Error { constructor(readonly erros: Record<string, string>) }
export type LocalNaTela = Pick<LocalRow, 'id' | 'nome' | 'tipo' | 'endereco' | 'cidade' | 'mostrarEndereco' | 'linkSala' | 'agendamentoOnline' | 'principal' | 'arquivadoEm'> & { emUso: boolean };
export type LocalProjetado = { id: string; nome: string | null; tipo: TipoDeLocal; cidade: string | null; endereco: string | null; principal: boolean; agendamentoOnline: boolean; criadoEm: Date }; // sem sala; nome/cidade nulos sem agendamento (AG-D62)
export async function garantirLocaisIniciais(tx: Tx, tenant: Pick<TenantRow, 'id' | 'enderecoConsultorio'>): Promise<void>;
export async function listarLocais(ctx: TenantContext, o: { arquivados: boolean }, deps?: { db?: Db }): Promise<{ locais: LocalNaTela[]; avisoLinkDivergente: boolean }>;
export async function salvarLocal(ctx: TenantContext, id: string | null, input: Record<string, unknown>, deps?): Promise<{ id: string }>;
export async function definirPrincipal / arquivarLocal / reativarLocal / excluirLocal(ctx: TenantContext, id: string, deps?): Promise<void>;
export async function locaisAtivos(tx: Tx): Promise<LocalRow[]>;                       // sessão nutri
export async function locaisParaAgendamento(tx: Tx): Promise<LocalProjetado[]>;         // publico/paciente: só app_locais_para_agendamento(); todos os ativos, o filtro vem depois de regraNoLocal
export async function localDaConsulta(tx: Tx, appointmentId: string): Promise<Omit<LocalProjetado, 'id'> | null>; // paciente: app_local_da_consulta
export function linkSugerido(local: Pick<LocalRow, 'tipo' | 'linkSala'>): string | null;
```
- `garantirLocaisIniciais`: trava `pg_advisory_xact_lock(hashtext('agenda-locais'), hashtext(tenantId))`; sem nenhum local, cria "Consultório" principal presencial com `agendamento_online = true` e o endereço do Perfil; aplica às regras com `local_id` nulo o backfill da RN-410a (grava o local; `ambas` vira presencial + par online, só se houver local online ativo; senão fica presencial); idempotente. Chamadores (cada um com teste da ligação): `lerInicio` (Início do painel) e `listarRegras` (Horários) nesta tarefa, `listarLocais` (Locais), Nova consulta na T3 e `agendaDoPeriodo` (Agenda) na T5.
- `salvarLocal` valida RN-401/RN-405 com as mensagens de `MSG_LOCAIS`; o tipo só muda sem uso (`emUso` = existe consulta, regra ou pedido; o banco confirma pela FK, 23503 → "Este local tem consultas ou horários. Arquive em vez de excluir."). `definirPrincipal` troca numa transação (tira o antigo, põe o novo). `arquivarLocal` recusa o principal ("Defina outro local como principal antes de arquivar este.") e desliga `agendamento_online` na mesma gravação (CHECK).
- `avisoLinkDivergente`: `tenants.link_online_padrao` não nulo e diferente do `link_sala` do local "Videoconferência" (RN-410a, P23-I1).
- Textos exatos (`MSG_LOCAIS`, spec §6.2): "Local salvo." · "Local arquivado." · "Local reativado." · "Já existe um local com este nome." · "O nome tem de 2 a 60 caracteres." · "Este local tem consultas ou horários. Arquive em vez de excluir." · "Defina outro local como principal antes de arquivar este." · "Para aceitar agendamento pelo paciente, informe a sala fixa." · "Informe um link que comece com https://." · vazio "Cadastre um local de atendimento para marcar consultas e definir horários." · "O link do Perfil mudou depois da atualização: confira a sala deste local." · telenutrição (RN-404, sem número da resolução até o DOU): "Antes do primeiro atendimento online, faça o cadastro no e-Nutricionista e colha o TCLE de telenutrição, guardando o comprovante. Não grave as consultas." e, com sala fixa, "Use sala de espera ou senha e admita um paciente por vez.". Campos: "Tipo" ("Presencial", "Videoconferência"), "Nome do local" (ajuda "Não use nome nem endereço de paciente."), "Endereço", "Cidade", "Mostrar o endereço na página de agendamento", "Sala fixa (link, opcional)" (ajuda "Sem sala fixa, informe o link em cada consulta."), "Aceita agendamento pelo paciente" (ajuda "Vale para o app do paciente e, se a página de agendamento estiver ligada no Perfil, para ela também."), "Em uso: arquive".
- Perfil: "Endereço profissional (documentos)" · ajuda "Vai no cabeçalho dos documentos assinados. O endereço de cada local fica em Locais de atendimento." · "O link da videoconferência agora fica em Locais de atendimento." · sem CRN: "Informe o CRN: ele aparece na página de agendamento.".
- `AbasDaAgenda({ atual, solicitacoes, comAniversariantes })`: links com `aria-current="page"`. No PR 2, só "Agenda · Pendências · Horários · Locais" (nenhum link para página que ainda não existe, AG-D72); a T8 liga "Solicitações ({n})" (só com a chave ligada ou `n > 0`) e a T10 liga "Aniversariantes", uma linha cada no componente. Ordem final: "Agenda · Solicitações ({n}) · Aniversariantes · Pendências · Horários · Locais". Usada só nas telas da agenda (a T2 põe em Locais, Pendências e Horários; a T5 na Agenda; a T8 e a T10 nas delas), nunca em `layout.tsx`.

- [ ] **Step 1: Testes que falham:**
  - `locais.test.ts`: cria presencial e online; nome repetido (maiúsculas) → mensagem; 1 e 61 caracteres → mensagem; online com endereço ignorado; sala sem `https://` → mensagem; `agendamento_online` em online sem sala → mensagem; trocar o principal numa transação (dois `withTenant` concorrentes terminam com um principal só); arquivar o principal → mensagem; arquivar desliga `agendamento_online`; excluir local em uso → mensagem (e o 23503 de uma corrida vira a mesma mensagem); mudar o tipo de local usado → recusado; `garantirLocaisIniciais` em tenant sem local cria o "Consultório" uma vez (duas chamadas concorrentes), e uma regra "ambas" sem local vira presencial + online; `avisoLinkDivergente`; sessão de paciente → erro do assert antes da transação; `locaisParaAgendamento` no `publico` não tem `linkSala` nas chaves (teste das chaves).
  - `status.test.ts`: `ROTULO_STATUS` tem uma chave por `StatusConsulta`; `STATUS_OCUPA` = `[...STATUS_ATIVOS, 'solicitada']` (a T6 liga este caso).
  - `locais/page.test.ts`: "Em uso: arquive" no lugar de "Excluir"; vazio com o link; aviso de telenutrição só no online; `aria-label` "Editar {nome}"/"Arquivar {nome}" nos botões repetidos.
  - `locais/page.test.ts`: abas do PR 2 sem links para páginas inexistentes (nem "Solicitações" nem "Aniversariantes").
  - `src/app/painel/actions.test.ts` e `marca.test.ts`: salvar o Perfil não mexe em `link_online_padrao`.
  - `inicio.test.ts`: consultório sem local — abrir o Início cria o "Consultório" principal uma vez. `disponibilidade.test.ts`: regra `ambas` sem local vira o par ao listar os horários.
- [ ] **Step 2:** `pnpm vitest run src/modules/agenda/locais.test.ts src/modules/agenda/status.test.ts src/app/painel/agenda/locais/page.test.ts src/app/painel/actions.test.ts src/modules/plataforma/marca.test.ts src/modules/agenda/inicio.test.ts src/modules/agenda/disponibilidade.test.ts` → FAIL.
- [ ] **Step 3:** implementar; ler `node_modules/next/dist/docs/` (Server Actions e `searchParams` como `Promise`).
- [ ] **Step 4:** mesmo comando → PASS; `pnpm vitest run src/app/painel/rotas-axe.test.ts src/app/formularios-post.test.ts src/modules/ajuda/conteudo.test.ts` (o `padrao` do guia `agenda` passa a `(nova|pendencias|locais|consultas\/.+)`).
- [ ] **Step 5:** commit `feat(agenda): locais de atendimento (P23-02)`.

**Pronto quando:** testes verdes; revisão do `revisor-interface` (formulário por tipo, cartões a 360 px, `role="status"`, foco) e do `normas-cfn-lgpd` (aviso de telenutrição, ajuda do nome) sem Critical/Important.

---

### Task 3: Local na consulta e nos horários do painel (PR 2)

**Files:**
- Modify: `src/modules/agenda/disponibilidade.ts` (`validarRegra` exige `localId` e tira a modalidade do tipo do local; `criarRegra` com `tambemOnline` cria o par numa transação; `MAX_REGRAS` 60 em `constantes.ts:7`, `MSG_AGENDA.limiteRegras` = "Você chegou ao limite de 60 horários. Apague um antes de criar outro."; sobreposição conferida **por local**), `src/modules/agenda/horarios.ts` (`gerarHorarios` por local, RN-410a), `src/modules/agenda/consultas.ts` (`EntradaConsulta.localId`; `validarHorario` pelo local; `horariosLivres` com locais; `Consulta.local`), `src/app/painel/agenda/horarios/{page.tsx,regra-form.tsx,actions.ts}` (agrupado por local; "Também atender por videoconferência nestes horários"; estado vazio), `src/app/painel/agenda/{consulta-form.tsx,nova/page.tsx,actions.ts}` (Nova consulta chama `garantirLocaisIniciais`), `src/app/painel/agenda/consultas/[id]/page.tsx` (local no detalhe; consulta antiga sem local → "Consultório (endereço do perfil)")
- Test: `src/modules/agenda/disponibilidade.test.ts`, `horarios.test.ts`, `consultas.test.ts`, `src/app/painel/agenda/actions.test.ts` (casos novos em `describe` próprio)

**Interfaces:**
```ts
export type Regra = { diaSemana: number; inicio: string; fim: string; duracaoMin: number; modalidade: ModalidadeRegra; localId: string | null };
export type LocalDaGeracao = { id: string; tipo: TipoDeLocal; principal: boolean; agendamentoOnline: boolean };
export type Horario = Intervalo & { modalidades: Modalidade[]; localId: string };
export function gerarHorarios(o: { regras: Regra[]; locais: LocalDaGeracao[]; bloqueios: Intervalo[]; ocupados: Intervalo[]; de: Date; ate: Date; fuso: string; soAgendamentoOnline: boolean }): Horario[];
export function regraNoLocal(r: Regra, locais: LocalDaGeracao[]): { localId: string; modalidade: Modalidade }[]; // RN-410a
export async function horariosLivres(tenant: Pick<TenantAgenda, 'id' | 'fuso'>, de: Date, ate: Date, opts?: { db?: Db; ignorarConsultaId?: string; localId?: string }): Promise<Horario[]>;
export type EntradaConsulta = { patientId?: unknown; data: unknown; hora: unknown; duracaoMin: unknown; localId: unknown; linkOnline?: unknown };
export type Consulta = { …; localId: string | null; local: { nome: string; tipo: TipoDeLocal } | null };
export async function criarRegra(ctx: TenantContext, input: Record<string, unknown> /* + localId, tambemOnline */, deps?): Promise<string[]>;
```
- `regraNoLocal` (RN-410a): com `localId`, o próprio local; sem local, o principal ativo do tipo da modalidade; `ambas` sem local, o presencial principal e o primeiro online ativo (por `created_at`); sem local que sirva → nenhum horário (teste). A atribuição usa **todos** os locais ativos; `soAgendamentoOnline` corta depois (AG-D62).
- **Junção da AG-D47 por local:** a partir desta tarefa, `gerarHorarios` junta horários de mesmo início e fim **só no mesmo `localId`** (com locais, cada local tem um tipo e a junção vira no-op); os casos da T1 em `horarios.test.ts` são reescritos para "regra `ambas` sem local (RN-410a) gera um horário por local".
- `moverConsulta` trocando presencial ↔ online sem trocar o local → `ConsultaError` no campo do local ("Escolha o local."), nunca 23503 da FK composta.
- `horariosLivres` continua no contexto `publico`; locais por `app_locais_para_agendamento()` (todos os ativos, com `principal` e `agendamento_online`), `soAgendamentoOnline: true` aplicado depois de `regraNoLocal`, ocupação por `appointments` só com `id, inicio, fim` e `status <> 'cancelada'` (`solicitada` ocupa, como o `EXCLUDE`) **mais** `app_pedidos_aguardando(de, margem)` (RN-409). Com a chave ligada, recorte em `agora + antecedencia_min_h + JANELA_RESPOSTA_PEDIDO_H` (a T6 acrescenta; aqui o parâmetro já existe e vale 0).
- `linkOnline` da consulta: vazio → `linkSugerido(local)`; online sem sala e sem link → `MSG_AGENDA.linkObrigatorio`; dica "Vazio = a sala fixa do local.".
- Nova consulta: "Local" vem com o principal; sem nenhum local ativo, estado vazio da §6.2.

- [ ] **Step 1: Testes que falham:**
  - `horarios.test.ts`: os três casos da RN-410a (regra com local; `presencial`/`online` sem local; `ambas` sem local com e sem local online ativo); `soAgendamentoOnline` tira o local sem a marca; **principal sem agendamento + outro presencial com agendamento: a regra sem local não gera horário com `soAgendamentoOnline`**; o mesmo início em dois locais dá dois horários (um por `localId`); casos da T1 reescritos (junção só no mesmo local).
  - `disponibilidade.test.ts`: regra sem local → "Escolha o local."; regra presencial com "Também atender por videoconferência nestes horários" cria as duas numa transação (a segunda falha → nenhuma fica); o par só com local online ativo; 60 regras → mensagem nova; sobreposição no mesmo local recusada e em locais diferentes aceita; regra com local arquivado → recusada.
  - `consultas.test.ts`: `agendarPelaNutri` com local online e sem link usa a sala; com local presencial ignora o link; **corrida em dois locais** — duas transações marcando o mesmo horário em "Clínica Centro" e "Videoconferência" → uma fica, a outra recebe o conflito (`EXCLUDE` por tenant, RN-408, CS-400); `horariosLivres` não devolve nada além de `inicio`, `fim`, `modalidades`, `localId` (teste das chaves, CS-401); horário de pessoa nova aguardando some; `moverConsulta` trocando presencial ↔ online sem trocar o local → mensagem, nunca 23503.
  - `actions.test.ts`: `agendarAction` com `localId` de outro tenant → erro de local.
- [ ] **Step 2:** `pnpm vitest run src/modules/agenda/horarios.test.ts src/modules/agenda/disponibilidade.test.ts src/modules/agenda/consultas.test.ts src/app/painel/agenda/actions.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm typecheck`.
- [ ] **Step 5:** commit `feat(agenda): local na consulta e nos horários (P23-03)`.

**Pronto quando:** testes verdes; nenhum chamador de `gerarHorarios`/`horariosLivres` sem `locais` (typecheck).

---

### Task 4: Local fora do painel — página pública, portal, link, mensagens e exportação (PR 2)

**Files:**
- Modify: `src/modules/agenda/agendamento-paciente.ts` (`escolherHorario(tenant, inicio, localId, agora, opts)`; `gravarConsultaDoPaciente` grava `local_id` e manda `link_online` nulo — o gatilho copia a sala, RN-406), `src/modules/agenda/agendamento-publico.ts` (`PaginaPublica` com `locais: LocalProjetado[]` e `cabecalho` no lugar de `temOnline`; o pedido guarda `local_id`), `src/modules/agenda/cancelamento.ts` (`remarcarComoPaciente` com `localId`), `src/modules/agenda/acoes-link.ts` (`EstadoLink` com `locais` e `localDaConsulta`; `temOnline` sai), `src/modules/portal/agenda.ts` (local da consulta por `localDaConsulta`), `src/modules/notificacoes/mensagens.ts` (`dadosDaConsulta(c: { consulta, tenant, local? })` usa `local?.endereco ?? tenant.enderecoConsultorio`; push sem local), `src/modules/notificacoes/enviar.ts` (`ContextoEnvio.local?: { nome; tipo; endereco } | null`, lido em `carregarContexto`, `:266-276`, junto com a consulta; opcional, para os testes que montam o contexto à mão continuarem compilando), `src/modules/pacientes/exportacao-job.ts` (`consultas[]` ganha a chave `local` com o **nome**; a seção se chama `consultas`, `:173`), `src/components/seletor-horarios.tsx` (rádio de local, `<label>` de bloco `min-h-11`, "Nome · Cidade", endereço só com `mostrar_endereco`; filtra no cliente), `src/app/n/[slug]/{page.tsx,agendar-form.tsx}`, `src/app/api/n/[slug]/{codigo,confirmar,horario}/route.ts` (aceitam `localId`), `src/app/p/(portal)/agenda/{nova/page.tsx,[id]/page.tsx,agendar-form.tsx,actions.ts}`, `src/app/consulta/[token]/{page.tsx,acoes.tsx,actions.ts}`
- Test: `src/modules/agenda/agendamento-paciente.test.ts`, `agendamento-publico.test.ts` (`describe('Plano 23: local')` próprio), `acoes-link.test.ts`, `src/modules/notificacoes/mensagens.test.ts`, `src/modules/notificacoes/enviar.test.ts` (o worker carrega o local), `src/modules/pacientes/exportacao.test.ts`, `src/app/n/[slug]/page.test.ts`, `src/app/p/(portal)/agenda/[id]/page.test.ts`, `src/modules/agenda/publico-guarda.test.ts` (novo)

**Interfaces:**
```ts
export type HorarioEscolhido = Horario & { modalidade: Modalidade };
export async function escolherHorario(tenant: TenantAgenda, inicio: unknown, localId: unknown, agora: Date, opts?: { db?: Db; ignorarConsultaId?: string }): Promise<HorarioEscolhido>;
export type HorarioVisivel = { inicio: string; dia: string; data: string; hora: string; modalidades: Modalidade[]; localId: string };
export type CabecalhoPublico = { nome: string /* nome profissional ou de exibição */; crn: string | null };
export type PaginaPublica = … | { estado: 'ativa'; tenantId; cabecalho: CabecalhoPublico; locais: LocalProjetado[]; localInicial: string | null; semana; primeira; ultima; horarios: HorarioVisivel[] };
```
- `escolherHorario` procura `hs.find((h) => h.inicio.getTime() === t && h.localId === localId)`, nunca o primeiro horário do instante (com dois locais no mesmo instante, o segundo daria "não está mais disponível").
- `?local=` é só o valor inicial (I-13); a escolha só aparece com mais de um local com agendamento; o título da escolha é "Onde você quer ser atendido?". Cabeçalho: "{nome} · Nutricionista · {crn como gravado}" ou, sem CRN, "{nome} · Nutricionista".
- A remarcação (portal e link) abre com o local da consulta e deixa trocar por outro local com horário.
- O link da sala vai no e-mail da consulta (`emailDaNotificacao`), no painel e em "Sua consulta" no portal (só a própria consulta online ativa, como hoje); `textoWhatsapp` e `pushDaNotificacao` nunca levam link, nome nem endereço do local.
- Guarda nova (`publico-guarda.test.ts`, RN-406/CS-401), **por AST** (API do `typescript`, já no projeto): nas funções passadas a `withTenant` com `role: 'publico'` em `src/modules/agenda/**` e nas funções do mesmo arquivo que elas chamam (`gravarPedido`, `horariosLivres`…), nenhum `.select()` sem argumento seguido de `.from(appointments)` e nenhuma referência a `locaisAtendimento`. Busca por texto no arquivo inteiro daria falso positivo (`lerConsultaParaEscrita`, `consultas.ts:161`, e `acoes-link.ts:114` não são do `publico`). Controle positivo com um trecho sintético.

- [ ] **Step 1: Testes que falham:**
  - `agendamento-paciente.test.ts`: o portal só oferece locais com "Aceita agendamento pelo paciente"; com `agendamento_publico_ativo = false` o portal continua oferecendo (AG-D40); a consulta online do paciente nasce com o `link_online` = sala (pelo gatilho); local arquivado entre a tela e o envio → "Esse horário não está mais disponível. Escolha outro." (42501 traduzido).
  - `agendamento-publico.test.ts`: página com dois locais lista os dois sem `linkSala`; um local só → sem escolha; local sem agendamento não aparece; cabeçalho com e sem CRN; o pedido guarda `local_id`.
  - `acoes-link.test.ts`: `resolver()` e `abrirLinkConsulta` sem `link_online` nas chaves fora da própria consulta online; remarcar pelo link para outro local.
  - `mensagens.test.ts`: lembrete por e-mail e WhatsApp com o endereço de "Clínica Centro"; consulta sem local → endereço do Perfil; push só com o horário (D19).
  - `agendamento-paciente.test.ts`: dois locais no mesmo instante — escolher o segundo local marca no segundo.
  - `exportacao.test.ts`: `consultas[].local` = nome do local; consulta antiga → `null`.
  - `n/[slug]/page.test.ts` e `p/(portal)/agenda/[id]/page.test.ts`: "Onde você quer ser atendido?" com dois locais; endereço só com `mostrar_endereco`; remarcação com o local da consulta marcado.
  - `publico-guarda.test.ts`: a guarda acima.
- [ ] **Step 2:** `pnpm vitest run src/modules/agenda/agendamento-paciente.test.ts src/modules/agenda/agendamento-publico.test.ts src/modules/agenda/acoes-link.test.ts src/modules/agenda/publico-guarda.test.ts src/modules/notificacoes/mensagens.test.ts src/modules/notificacoes/enviar.test.ts src/modules/pacientes/exportacao.test.ts "src/app/n/[slug]/page.test.ts" "src/app/p/(portal)/agenda/[id]/page.test.ts"` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(agenda): local na página pública, no portal e nas mensagens (P23-04)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` (projeções, chaves, guarda) sem Critical/Important.

---

### Task 5: Visões, filtros, legenda, marcador de aniversário e impressão (PR 2)

**Files:**
- Create: `src/modules/agenda/calendario.ts`, `src/modules/agenda/visoes.ts`, `src/modules/agenda/impressao.ts`, `src/app/painel/agenda/{grade-semana.tsx,grade-mes.tsx,filtros.tsx,legenda.tsx}`, `src/app/painel/agenda/imprimir/page.tsx`
- Modify: `src/app/painel/agenda/{page.tsx,periodo.ts,item-consulta.tsx}` (`periodo.ts` reexporta `Visao`, `lerVisao` e `periodoDaVisao` de `@/modules/agenda/calendario`, como faz com `ROTULO_STATUS`; nada de dois `lerVisao`), `src/modules/agenda/status.ts` (`sqlEhRetorno`), `next.config.ts` (`/painel/agenda/imprimir` com `Cache-Control: no-store`, AG-D71), `test/carga/seed.ts` e `test/carga/cenario.js` (cenário "Mês com marcadores": 300 pacientes, 2.000 consultas, com nascimento e previsão; só acrescentar), `docs/operacao/agenda-2.md` (volta atrás do PR 2: o `moverConsulta` antigo, ao trocar a modalidade de consulta com `local_id`, cai em 23503 e dá 500; o Perfil antigo volta a editar `link_online_padrao`, já desatualizado), `src/app/formularios-post.test.ts` (`GET_PERMITIDOS` + `src/app/painel/agenda/filtros.tsx`: "filtros e 'Ir para data' da agenda: datas, ids de local e de paciente, sem dado sensível"; AG-D52), `e2e/painel-rotas.ts` (`/painel/agenda/imprimir`)
- Test: `src/modules/agenda/calendario.test.ts`, `visoes.test.ts`, `impressao.test.ts`, `src/app/painel/agenda/periodo.test.ts`, `src/app/painel/agenda/page.test.ts` (novo), `src/app/painel/agenda/imprimir/page.test.ts`

**Interfaces:**
```ts
// calendario.ts (puro; datas 'AAAA-MM-DD', meses 'AAAA-MM')
export type Visao = 'dia' | 'semana' | 'mes' | 'lista';
export function lerVisao(v: unknown): Visao; // outro valor → 'semana'
export function semanaDe(data: string): string[]; // segunda a domingo (segundaDaSemana de fuso.ts)
export function gradeDoMes(data: string): string[][]; // 5 ou 6 semanas de 7 dias, a partir da segunda
export function periodoDaVisao(v: Visao, data: string, o: { comPaciente: boolean; hoje: string }): { dias: string[]; de: string; ate: string; anterior: string; proximo: string };
export function faixaDaGrade(regras: { inicio: string; fim: string; diaSemana: number }[], dias: string[], itens: { inicioMin: number; fimMin: number }[], horas24: boolean): { de: number; ate: number }; // horas cheias
export function diaDoAniversario(nascimento: string, ano: number): string; // 29/02 → 28/02 em ano não bissexto
// status.ts (puro; só o fragmento sql do drizzle, sem I/O) — RN-416 num lugar só
export function sqlEhRetorno(a: typeof appointments, c: typeof consultations): SQL; // existe realizada anterior ou atendimento anterior do paciente
// visoes.ts
export const MARCADOR_RETORNO_LIGADO = false; // a T9 liga (AG-D73)
export async function tiposDasConsultas(tx: Tx, ids: string[]): Promise<Map<string, 'primeira' | 'retorno'>>; // usado pela T6 (primeiraOnline) e pela T8 (aviso do TCLE)
export type FiltrosDaAgenda = { visao: Visao; data: string; local?: string; paciente?: string; horas24: boolean; retorno: boolean; aniversario: boolean };
export function lerFiltros(sp: Record<string, string | string[] | undefined>, hoje: string): FiltrosDaAgenda;
export function hrefDaAgenda(f: Partial<FiltrosDaAgenda>, base?: '/painel/agenda' | '/painel/agenda/imprimir'): string;
export type ItemDaAgenda = Consulta & { tipoConsulta: 'primeira' | 'retorno'; selos: string[]; local: { nome: string; tipo: TipoDeLocal } | null };
export type AgendaDoPeriodo = { itens: ItemDaAgenda[]; bloqueios: BloqueioSalvo[]; retornos: { patientId: string; nome: string; data: string }[]; aniversarios: { patientId: string; nome: string; data: string }[]; regras: RegraSalva[] };
export async function agendaDoPeriodo(ctx: TenantContext, tenant: TenantAgenda, f: FiltrosDaAgenda, deps?: { db?: Db; agora?: Date }): Promise<AgendaDoPeriodo>;
// impressao.ts
export const CAMPOS_DA_IMPRESSAO = ['hora', 'paciente', 'tipoConsulta', 'local', 'modalidade', 'situacao'] as const;
export type LinhaDaImpressao = { [K in (typeof CAMPOS_DA_IMPRESSAO)[number]]: string };
export async function agendaParaImprimir(ctx: TenantContext, tenant: TenantAgenda, f: FiltrosDaAgenda, deps?): Promise<{ titulo: string; local: string; dias: { dia: string; linhas: (LinhaDaImpressao | { bloqueado: string /* "hh:mm–hh:mm" */ })[] }[] }>;
```
- `agendaDoPeriodo`: **uma** transação, que começa por `garantirLocaisIniciais`; consultas do período com `local` (join), bloqueios, regras, "Retorno" numa consulta agregada (`min(inicio)` das realizadas e `min(data)` dos atendimentos por paciente do período, RN-416; o mesmo critério de `sqlEhRetorno`, que a seção da T9 usa); marcadores só quando ligados — aniversário (RN-414: `status = 'ativo'`, `anonimizado_em is null`, `data_nascimento` não nula, dia/mês no fuso, só o nome) e retorno (a T9 liga a função; aqui o marcador fica atrás do parâmetro e devolve `[]`); sem `auditRead`; `paciente=` inválido (não uuid) é ignorado. Lista com `paciente` = de hoje a hoje + 12 meses (RN-411). Canceladas só na Lista (RN-413).
- Grade (spec §7): `table` com `caption`, `th scope="col"` (dias) e `th scope="row"` (horas); item na linha da hora em que **começa**, com "08:40–09:30" visível; o que atravessa linhas aparece uma vez, com "até hh:mm"; bloqueio "Bloqueado: {motivo}" com o horário; link nomeado pelo conteúdo visível (sem `aria-label`); a 360 px (e o Mês abaixo de 768 px) lista por dia (`h2` por dia) com `hidden md:table`/`md:hidden` e `data-testid` por versão. Mês: `caption` "{mês} de {ano}", "{n} consultas", até 3 nomes e "mais {n}", link do dia para a visão Dia.
- Filtros (formulário GET, sem JS): "Local" ("Todos os locais"), "Paciente" ("Todos"), "Previsões de retorno" (só com `MARCADOR_RETORNO_LIGADO`: no PR 2 não há onde preencher a previsão, AG-D73), "Aniversários", "Mostrar 24 horas", "Filtrar", "Limpar filtros"; "Ir para data" com `label` e "Ir para a data", demais parâmetros em `hidden`. Navegação: "Dia" · "Semana" · "Mês" · "Lista" · "Hoje" · "Anterior" · "Próximo" · "Imprimir ou salvar em PDF" (`prefetch={false}`). Legenda (título "Legenda"): "Primeira consulta" · "Retorno" · "Pedido a responder" · "Presença a registrar" · "Bloqueio" · "Retorno previsto" (só com `MARCADOR_RETORNO_LIGADO`) · "Aniversário"; cor só reforça, tokens existentes (`bg-linha`, `aviso`, `ok`).
- Impressão: h1 "Agenda de {período}", "Local: {nome ou Todos os locais}", tabela por dia, bloqueio "Bloqueado" sem motivo, rodapé "Contém dados pessoais de pacientes. Uso restrito do consultório." (repete por página), "Imprimir ou salvar em PDF" e "Voltar à agenda" com `print:hidden` (padrão de `termo-ia/imprimir.tsx`); `dynamic = 'force-dynamic'` e `Cache-Control: no-store` pela regra do `next.config.ts` (um `page.tsx` não define cabeçalho); o render grava o `exportar` (RN-419) na transação da leitura.
- `AbasDaAgenda` (T2) entra em `/painel/agenda`.

- [ ] **Step 1: Testes que falham:**
  - `calendario.test.ts`: `lerVisao('mes')`, `lerVisao('x')` → `semana`; semana que vira o mês e o ano; `gradeDoMes('2027-02-10')` começa em 01/02/2027 (segunda) e `gradeDoMes('2026-11-17')` em 26/10/2026; faixa sem regra = 8–18; com regra 07:30–19:15 = 7–20; item às 22:00 amplia; `horas24` = 0–24; `diaDoAniversario('2000-02-29', 2027)` = `2027-02-28`, 2028 = `2028-02-29`; com o servidor em UTC e o relógio em 30/11 23:30 em `America/Sao_Paulo`, "hoje" ainda é 30/11.
  - `visoes.test.ts`: `hrefDaAgenda` preserva local, paciente e marcadores em "Próximo" e "Ir para a data"; `lerFiltros` aceita `string[]`; "Primeira consulta" × "Retorno" (realizada antes, atendimento manual antes, nenhum) numa consulta só (contador de consultas por `Pool` embrulhado, como no Plano 20 T4: sem N+1); aniversário só de ativo e não anonimizado com data (bloqueado, arquivado e anonimizado fora); filtro por paciente não grava `audit_log` (AG-D30); Lista com paciente cobre 12 meses; canceladas fora da Semana e no Lista.
  - `impressao.test.ts`: as chaves de cada linha são exatamente `CAMPOS_DA_IMPRESSAO`; bloqueio sem motivo; nenhum telefone, e-mail, link, observação ou valor no HTML renderizado; um `exportar` com `entidade = 'agenda'`, `patient_id` nulo e `entidade_id = '2026-11-16..2026-11-22|todos'`.
  - `page.test.ts`: grade com consulta às 08:40 e outra de 90 min (aparece uma vez, "até 10:30"); `caption` e `th scope`; Mês com "mais 2"; o formulário GET leva os outros filtros em `hidden`; sem "Previsões de retorno" nem "Retorno previsto" no PR 2.
  - `periodo.test.ts`: passa para a assinatura nova (`periodoDaVisao(v, data, { comPaciente, hoje })`), pela reexportação.
  - `imprimir/page.test.ts`: o `next.config.ts` tem a regra `no-store` de `/painel/agenda/imprimir`.
- [ ] **Step 2:** `pnpm vitest run src/modules/agenda/calendario.test.ts src/modules/agenda/visoes.test.ts src/modules/agenda/impressao.test.ts src/app/painel/agenda/periodo.test.ts src/app/painel/agenda/page.test.ts src/app/painel/agenda/imprimir/page.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm vitest run src/app/painel/rotas-axe.test.ts src/app/formularios-post.test.ts src/modules/ajuda/conteudo.test.ts` (a rota `/painel/agenda/imprimir` entra em `SEM_AJUDA`: "página de impressão, sem fluxo para ensinar"). A `AbasDaAgenda` entra em `/painel/agenda`.
- [ ] **Step 5 (fechamento do PR 2):** E2E da visão Mês, da Semana com filtro e da impressão em `e2e/agenda-2.spec.ts` (bloco `10.9.23.1`–`.9`) e axe de `/painel/agenda?visao=mes`, `?visao=semana&horas=24&local=…`, `/painel/agenda/locais` e `/painel/agenda/imprimir` nos três modos e a 360 px (`e2e/acessibilidade-painel.spec.ts`); `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3103 pnpm test:e2e e2e/agenda-2.spec.ts e2e/agenda.spec.ts e2e/acessibilidade-painel.spec.ts`; manual técnico cap. 05 (seções novas no fim) pelo `guardiao-manual`; commit `feat(agenda): visões, filtros, legenda e impressão (P23-05)`.

**Pronto quando:** testes e E2E verdes; carga P08-03 com o cenário "Mês com marcadores" (300 pacientes ativos, 2.000 consultas) com p95 ≤ 800 ms (CS-402, RNF-400; rodar com a pilha de carga quando o dono liberar a CPU); revisão do `revisor-interface` sem Critical/Important.

---

### Task 6: Solicitações — `solicitada`, paciente com conta e vencimento (PR 3)

> **Divisão (AG-D69):** duas subtarefas com ciclo TDD, commit e revisão próprios. **T6a** — `StatusConsulta` + `solicitada`, `status.ts`, `status-guarda.test.ts` e os pontos da §4.3 (presença, início, portal, mapas, métricas já feitas na T1); commit `P23-06a`. **T6b** — `solicitacoes.ts`, travas do portal, vencimento, notificações e e-mails; commit `P23-06b`.

**Files:**
- Create: `src/modules/agenda/solicitacoes.ts`, `src/modules/agenda/status-guarda.test.ts`
- Modify: `src/modules/agenda/consultas.ts` (`StatusConsulta` + `'solicitada'`; `Consulta.canceladoPor` com os três novos; `moverConsulta` recusa `solicitada` com `naoAlteravel`; `TenantAgenda` ganha `'agendaConfirmarPedidos'`, `:16`), `src/modules/agenda/status.ts` (`ROTULO_STATUS.solicitada = 'Pedido a responder'`), `src/modules/agenda/constantes.ts` (`JANELA_RESPOSTA_PEDIDO_H = 12`; `MSG_SOLICITACOES`), `src/modules/agenda/agendamento-paciente.ts` (`gravarConsultaDoPaciente` devolve `{ id, status }` do `RETURNING` e decide por ele, AG-D53; `agendarComoPaciente` devolve `{ id, status }`; teto com `STATUS_OCUPA`, `:124`; trava do tenant no **começo** da transação de `agendarComoPaciente`, antes de `carregarPacienteParaEscrita` (AG-D65), e `app_pedidos_aguardando` conferida antes do INSERT, RN-425 — nada de trava dentro de `gravarConsultaDoPaciente`; janela de 12 h só com `tenant.agendaConfirmarPedidos`), `src/modules/agenda/cancelamento.ts` (`remarcarComoPaciente` também toma a trava do tenant no começo, antes de `carregarPacienteParaEscrita`; `cancelarConsulta` **não muda**: `solicitada` está fora de `STATUS_ATIVOS` e cai em `naoCancelavel`, a desistência é só `desistirDoPedido`, AG-D70; `cancelarFuturasPelaExclusao` com `STATUS_OCUPA`, `:127`), `src/modules/agenda/presenca.ts` (`registrarPresenca` recusa `solicitada`; `motivoParaNaoIniciarAtendimento` devolve `'pedido'`; indicadores e novidades com `not in ('cancelada','solicitada')`, `:82-85` e `:116`), `src/modules/pacientes/atendimentos.ts` (o motivo `'pedido'` → "Aceite o pedido antes de registrar o atendimento."; **sem** mudar o retorno do 20 PR 2), `src/modules/agenda/inicio.ts` (agenda de hoje com o selo, sem contar no número, `:47,55`), `src/modules/agenda/aviso-nutri.ts` + `src/email/types.ts` (`aviso_agenda.evento` + `'pedido' | 'pedido_desistido'`), `src/email/templates.tsx` (os dois eventos; `pedido_nao_confirmado`), `src/modules/notificacoes/{tipos,mensagens,enviar}.ts` (`TipoNotificacao` + `'aniversario' | 'pedido_nao_confirmado'` no fim; `ROTULO_TIPO` "Mensagem de aniversário" · "Pedido de consulta não confirmado"; `MotivoIgnorada` + `'sem_autorizacao' | 'consulta_nao_aceita'`; `motivoParaIgnorar` da §4.3; `processarNotificacoes` chama `vencerSolicitacoes` antes da varredura, num `try/catch` próprio, AG-D67), `src/app/painel/agenda/periodo.ts` (`selosDaConsulta`: "Pedido retirado pelo paciente", "Pedido não aceito", "Pedido vencido"), `src/modules/portal/agenda.ts` (`ativas` e `podeAgendar` com `STATUS_OCUPA`), `src/app/p/(portal)/agenda/page.tsx` e `src/app/consulta/[token]/page.tsx` (`SITUACAO` vira `Record<StatusConsulta, string>`, I-03)
- Test: `src/modules/agenda/solicitacoes.test.ts`, `presenca.test.ts`, `cancelamento.test.ts`, `agendamento-paciente.test.ts`, `src/modules/pacientes/atendimentos.test.ts`, `src/modules/pacientes/lgpd.test.ts`, `src/modules/notificacoes/{enviar,mensagens,tipos}.test.ts`, `src/modules/portal/{jornada,mural}.test.ts` (só casos novos: pedido não aparece)

**Interfaces:**
```ts
export type PedidoNaFila =
  | { tipo: 'consulta'; id: string; patientId: string; nome: string; inicio: Date; fim: Date; local: string | null; origem: 'app' | 'pagina'; pedidoEm: Date; respondaAte: Date; primeiraOnline: boolean }
  | { tipo: 'pessoa_nova'; id: string; nome: string; inicio: Date; fim: Date; local: string | null; origem: 'pagina'; pedidoEm: Date; respondaAte: Date };
export class PedidoMudouError extends Error {} // "Este pedido já foi respondido ou venceu."
export async function listarSolicitacoes(ctx: TenantContext, tenant: TenantAgenda, deps?: { db?: Db; agora?: Date }): Promise<PedidoNaFila[]>;
export async function contarSolicitacoesNaTransacao(tx: Tx, tenant: Pick<TenantAgenda, 'antecedenciaMinH'>, agora: Date): Promise<number>;
export async function aceitarSolicitacao(ctx: TenantContext, tenant: TenantAgenda, p: { tipo: 'consulta' | 'pessoa_nova'; id: string }, deps?): Promise<void>;
export async function recusarSolicitacao(ctx: TenantContext, tenant: TenantAgenda, p: { tipo: 'consulta' | 'pessoa_nova'; id: string; motivo?: unknown }, deps?): Promise<void>;
export async function desistirDoPedido(ctx: TenantContext, tenant: TenantAgenda, id: string, deps?): Promise<void>; // portal
export async function vencerSolicitacoes(db: Db, agora: Date, o?: { tenantId?: string }): Promise<number>;
export async function gravarConsultaDoPaciente(tx, tenant, p, h, o): Promise<{ id: string; status: 'agendada' | 'solicitada' }>;
export async function agendarComoPaciente(ctx, tenant, input, deps?): Promise<{ id: string; status: 'agendada' | 'solicitada' }>; // a T8 mostra "Pedido enviado…" por ele
```
- `aceitarSolicitacao` (consulta): trava paciente (`FOR NO KEY UPDATE`) → consulta (`FOR UPDATE`) → reconfere `solicitada` e `inicio − antecedência > agora` (senão `PedidoMudouError`); `status = 'agendada'`; `agendarLembretes`, `avisarPaciente(…, 'consulta_marcada')`, `dispararEnvio`. Pessoa nova: delega a `aceitarPedidoPublico` (T7).
- `recusarSolicitacao` (consulta): mesma trava; `cancelada`, `cancelado_por = 'pedido_recusado'`, `motivo_cancelamento` = motivo (só a nutricionista vê, AG-D23); `notifications` `pedido_nao_confirmado` por e-mail e push (`avisarPaciente` aceita o tipo novo); nada por WhatsApp.
- `desistirDoPedido`: sessão `paciente`; trava paciente → consulta; `cancelado_por = 'pedido_desistido'`; `avisarNutriDaConsulta(…, 'pedido_desistido')`; nunca liga o marcador da remarcação (o gatilho garante).
- `vencerSolicitacoes`: seleciona os vencidos sem trava (`solicitada` com `inicio − antecedencia_min_h ≤ agora`; pessoa nova aguardando idem); **uma transação por pedido, com `try/catch`** que loga só o código e o motivo técnico e segue (AG-D67); por pedido, trava como acima, reconfere e pula se mudou; consulta → `cancelada` / `pedido_vencido` + `pedido_nao_confirmado`; pessoa nova → `resolvido_em` + `enqueueEmail` (T7 liga); com `tenantId`, só aquele consultório; idempotente.
- `PedidoNaFila.primeiraOnline` usa `tiposDasConsultas` (T5); a janela de 12 h (`JANELA_RESPOSTA_PEDIDO_H`) só é somada com `tenant.agendaConfirmarPedidos` e é só a oferta: quem decide o status continua o gatilho.
- `motivoParaIgnorar`: lembrete, `consulta_marcada` e respostas de consulta `solicitada` → `consulta_nao_aceita`; `pedido_nao_confirmado` só sai com a consulta `cancelada` (senão `consulta_nao_aceita`); a reconferência do aniversário entra na T10.
- E-mails (§6.2): à nutricionista "Novo pedido de consulta" ("{nome} pediu {data} às {hora}. Responda em Solicitações: {link de /painel/agenda/solicitacoes}") e "Pedido de consulta retirado" ("{primeiro nome} retirou o pedido de {data} às {hora}."); ao paciente "Seu pedido de consulta não foi confirmado" ("O horário de {data} às {hora} não foi confirmado. Escolha outro horário: {link}", link `/p/agenda/nova` quando veio do portal; sem link, só a primeira frase). Push: título "NutriDebby", corpo "Seu pedido de consulta não foi confirmado.", URL da agenda do portal.

- [ ] **Step 1: Testes que falham:**
  - `status-guarda.test.ts` (R-400, I-03), **restrito a status de consulta** (`status === '` sozinho casa 218 linhas de outros status): padrões `/status\s*[!=]==\s*'(agendada|confirmada|cancelada|realizada|faltou|solicitada)'/`, `/\b(ne|eq|inArray|notInArray)\(appointments\.status\b/` (hoje `consultas.ts:100,308`, `portal/agenda.ts:40`), `/status\s*(<>|not in|in)\s*\(?'(cancelada|agendada|confirmada)/` e `Record<string` com a chave `agendada:`, em `src/modules` e `src/app`; exceções em `Record<string, { n: number; motivo: string }>` por **arquivo**, com a contagem esperada e o motivo da §4.3 (nunca por número de linha: quebra a cada rebase); controle positivo: um texto sintético com `ne(appointments.status, 'cancelada')` é pego.
  - `solicitacoes.test.ts`: chave ligada → portal grava `solicitada`, sem lembretes nem "consulta marcada", com o aviso "pedido" à nutricionista; teto de 3 conta o pedido (2 consultas + 1 pedido → aviso do teto); janela de 12 h (antecedência 12 h, agora 10:00 → primeiro horário oferecido 10:00 do dia seguinte); aceitar → `agendada` + lembretes + `consulta_marcada`; recusar → `pedido_recusado` + `pedido_nao_confirmado` (e-mail e push, nada de WhatsApp) e o motivo nunca no e-mail; aceitar ou recusar pedido vencido ou já respondido → `PedidoMudouError`; desistir → `pedido_desistido` + aviso à nutricionista; **remarcar consulta agendada com a chave ligada → nasce agendada** (AG-D24); vencimento às 04:00 de um pedido para 16:00 com antecedência 12 h; `vencerSolicitacoes(db, agora, { tenantId: A })` não vence pedido de B; **corrida** aceite × vencimento (só um vence: o outro recebe `PedidoMudouError` ou pula); duas abas aceitando → uma `PedidoMudouError`; **corrida portal × aceite de pessoa nova com o e-mail do mesmo paciente** → um fica, sem 40P01 (AG-D65); `agendarComoPaciente` devolve `status = 'solicitada'` com a chave ligada.
  - `presenca.test.ts`: presença em `solicitada` → recusada; `motivoParaNaoIniciarAtendimento` → `'pedido'`; indicadores e novidades não contam o pedido.
  - `atendimentos.test.ts`: registrar atendimento ligado a um pedido → "Aceite o pedido antes de registrar o atendimento.".
  - `cancelamento.test.ts`: cancelar `solicitada` como paciente → `naoCancelavel` (a desistência é `desistirDoPedido`, AG-D70).
  - `lgpd.test.ts`: exclusão atendida com pedido `solicitada` → cancelado com `sistema` depois do bloqueio (RN-422).
  - `enviar.test.ts`: `consulta_marcada` de consulta `solicitada` → `ignorada` (`consulta_nao_aceita`); `processarNotificacoes({ tenantId })` vence só os pedidos do tenant; **com um vencimento que lança, o lembrete pendente de outro tenant continua saindo** (AG-D67).
  - `mensagens.test.ts`: os três casos do link do "não confirmado" (portal; pessoa nova com página pública ligada; desligada).
  - `portal/agenda` e mapas: `SITUACAO` tem "Aguardando confirmação da nutricionista"; pedido recusado e vencido → "Não confirmado".
- [ ] **Step 2:** `pnpm vitest run src/modules/agenda/status-guarda.test.ts src/modules/agenda/solicitacoes.test.ts src/modules/agenda/presenca.test.ts src/modules/agenda/cancelamento.test.ts src/modules/agenda/agendamento-paciente.test.ts src/modules/pacientes/atendimentos.test.ts src/modules/pacientes/lgpd.test.ts src/modules/notificacoes` → FAIL.
- [ ] **Step 3:** implementar; conferir a RN-422 contra todos os `status: 'cancelada'` de `src/modules` (hoje `cancelamento.ts:104`, `:134`, `:169`).
- [ ] **Step 4:** mesmo comando → PASS; `pnpm typecheck` (os `Record<StatusConsulta, …>` e os `switch` exaustivos quebram até cada ponto ser tratado).
- [ ] **Step 5:** commits `feat(agenda): status solicitada (P23-06a)` e `feat(agenda): pedidos do paciente com confirmação (P23-06b)`.

- **Critérios de aceite vindos do `/code-review` do PR 1 (#59), decisão da orquestradora 17/11:** (1) as métricas da nutricionista em `src/modules/agenda/presenca.ts` (total, iniciadas, iniciadasAnt) não contam `solicitada` (o mesmo recorte das métricas do admin, R-410), com teste de uma `solicitada` no mês que não muda os números; (2) na exclusão LGPD, `cancelarFuturasPelaExclusao` cancela também a `solicitada`, com `cancelado_por = 'sistema'` (o gatilho aceita com o titular bloqueado na sessão `nutri`), com teste: pedido pendente de quem pediu exclusão sai da agenda e libera o horário.

**Pronto quando:** testes verdes; revisão do `revisor-rls` (travas, transições, vencimento) e do `normas-cfn-lgpd` (textos, motivo só da nutricionista) sem Critical/Important.

---

### Task 7: Solicitações — pessoa nova pela página pública (PR 3)

**Files:**
- Modify: `src/modules/agenda/agendamento-publico.ts` (`gravarPedido`: chave ligada e e-mail sem paciente → `app_pedido_aguardar`, sem cadastro; com paciente → consulta `solicitada` pelo gatilho; `ResultadoConfirmacao` + `{ estado: 'pedido' }`; `travarEmail` → trava do tenant (RN-425); `confirmarCodigo`/`escolherOutroHorario`/`concluir` → 410 para pedido aguardando, RN-424a; `aceitarPedidoPublico`; `desistirDoPedidoPublico`; `limparPedidosPublicos` com as regras da RN-429), `src/modules/agenda/solicitacoes.ts` (pessoa nova em listar, recusar, vencer), `src/modules/agenda/constantes.ts` (`MSG_PUBLICO`), `src/email/types.ts` + `src/email/templates.tsx` (`pedido_recebido`, `pedido_nao_confirmado_publico`, no fim), `next.config.ts` (`/n/:slug/pedido/:token*` e `/api/n/:slug/pedido/:token*` com `no-referrer` + `no-store`, AG-D71)
- Create: `src/app/n/[slug]/pedido/[token]/page.tsx`, `src/app/api/n/[slug]/pedido/[token]/route.ts` (pasta `n` já em `EXCLUIDAS` de `src/app/api/mesma-origem-rotas.test.ts`; limite por IP com `consumirLimite(db, chaveDoLimite('ip', …), …)`, o mesmo balde da página pública), `src/modules/agenda/pedido-publico.test.ts`
- Modify: `src/app/n/[slug]/{page.tsx,agendar-form.tsx}` (frase do ponto de coleta antes de enviar, com a chave ligada; tela "Pedido enviado. {nome} vai confirmar o horário e você recebe um e-mail."), `src/db/tenant.ts` (nada: a pessoa nova age no `publico`), `CLAUDE.md` (regra 1: `aceitarPedidoPublico` grava `consents` na sessão `nutri`; já previsto na T1, conferir)
- Test: `src/modules/agenda/agendamento-publico.test.ts` (`describe('Plano 23: pedido aguardando')`), `src/modules/agenda/pedido-publico.test.ts`, `src/email/render.test.ts`, `src/app/n/[slug]/page.test.ts`

**Interfaces:**
```ts
export type ResultadoConfirmacao = { estado: 'agendada'; quando: string } | { estado: 'pedido'; quando: string } | { estado: 'horario_ocupado'; horarios: HorarioVisivel[] };
export async function aceitarPedidoPublico(tx: Tx, tenant: TenantAgenda, pedidoId: string, o: { agora: Date; appUrl: string }): Promise<{ appointmentId: string }>; // sessão nutri, chamada por aceitarSolicitacao
export async function desistirDoPedidoPublico(slug: string, token: string, o: { confirmar: boolean; ip: string | null; agora?: Date; db?: Db }): Promise<{ estado: 'aguardando' | 'cancelado' | 'invalido'; quando?: string }>;
export async function limparPedidosPublicos(db: Db, agora: Date): Promise<number>;
// e-mails
| { tipo: 'pedido_recebido'; para: string; quando: string; linkDesistir: string | null }
| { tipo: 'pedido_nao_confirmado_publico'; para: string; quando: string; link: string | null }
```
- `gravarPedido`: o teto de 3 futuras (`agendamento-publico.ts:223`) passa a contar `inArray(appointments.status, STATUS_OCUPA)` (com a chave ligada o pedido nasce `solicitada` e, sem isso, o paciente pediria sem limite; entra na lista da guarda de status). Com a chave ligada: ordem de travas e-mail → tenant → paciente → linha do pedido/consulta (AG-D65); conferência de `app_pedidos_aguardando` sob a trava do tenant antes do INSERT da consulta `solicitada`; mesma tela e o mesmo `pedido_recebido` (por `enqueueEmail`, na mesma transação) para paciente e para pessoa nova (RN-426); só a pessoa nova recebe `linkDesistir` (`/n/<slug>/pedido/<token>`, o token do próprio pedido, AG-D48); motivos de `app_pedido_aguardar` → `email`: "Você já tem um pedido aguardando resposta. Espere a resposta antes de pedir outro horário." (só depois do código), `ocupado` → outros horários da semana, `teto_tenant` → `MSG_AGENDA.naoAgendavel`; 23505 do índice por e-mail → a mesma mensagem do `email`.
- `aceitarPedidoPublico` (RN-424): trava do tenant → linha do pedido (`FOR UPDATE`, sessão `nutri` vê a linha); e-mail de paciente ativo → consulta para ele, opt-in dele intacto; arquivado ou bloqueado → `ConsultaError` "Este e-mail é de um paciente arquivado ou bloqueado. Recuse o pedido ou fale com a pessoa."; senão cria o paciente (`origem = 'agendamento_publico'`; opt-in do WhatsApp do pedido com `whatsapp_optin_em = verificado_em` e `whatsapp_optin_origem = 'paciente'`), `consents` com `aceito_em = verificado_em`, `ip` e `termo_versao` do pedido, e a consulta `agendada` (`origem = 'paciente'`, local do pedido); sobreposição (23P01) → "Esse horário já está ocupado. Recuse o pedido ou combine outro horário com a pessoa."; grava `concluido_em`, `appointment_id`, `resolvido_em` e `resolucao = 'aceito'`. Local online: a consulta nasce com `link_online` = sala, pelo gatilho (cópia em qualquer papel, T1).
- Recusa e vencimento da pessoa nova: `resolvido_em` + `resolucao` (`recusado`, `vencido`) + `enqueueEmail` `pedido_nao_confirmado_publico` (link `/n/<slug>` só com `agendamento_publico_ativo`), na mesma transação; sem campo de motivo (AG-D23).
- Desistência (AG-D42, AG-D48, AG-D49): a página GET chama `app_pedido_publico_desistir(sha256(token), false)` e **não grava**; o botão "Desistir do pedido" faz POST (formulário com `method="post"`, funciona sem JS) para a rota, que chama com `true`, avisa a nutricionista **só quando a função devolve `gravou = true`** (`aviso_agenda` evento `pedido_desistido`, nome "Nova pessoa: {primeiro_nome devolvido pela função}" — o `publico` não lê a linha) e redireciona (303) para a página com `?ok=1`. Textos: h1 "Seu pedido de consulta" · "Desistir do pedido de {data} às {hora}?" · "Desistir do pedido" · "Pedido cancelado." · "Este link não é válido.".
- Limpeza (RN-429): recusado, vencido ou desistido → apagado na primeira limpeza depois de 24 h de `resolvido_em`; aceito → depois de 24 h do aceite; sem código → como hoje (24 h da criação); aguardando nunca pelas 24 h da criação.
- Ponto de coleta (com a chave ligada, antes de enviar): "Até a resposta, guardamos seu nome, e-mail, telefone e o número de rede (IP) do seu aparelho só para este pedido. Se ele não for aceito ou o horário passar, apagamos esses dados depois de 24 horas, na limpeza diária.".

- [ ] **Step 1: Testes que falham:**
  - `agendamento-publico.test.ts` (`describe('Plano 23: pedido aguardando')`): 2 consultas + 1 pedido `solicitada` → `limitePublico` depois do código; chave ligada + e-mail novo → linha aguardando, **nenhum** paciente, `pedido_recebido` com link de desistência; e-mail de paciente → consulta `solicitada` e o mesmo `pedido_recebido` sem o link, mesma resposta da tela (RN-426; antes do código, nada difere); segundo pedido do mesmo e-mail → mensagem do aguardando só depois do código; 21º aguardando → `naoAgendavel`; reabrir o link do código ou `escolherOutroHorario` com o token aguardando → 410 (RN-424a) e o horário não muda; **corrida** pessoa nova × paciente × portal no mesmo horário (só um fica; o horário aguardando some de `horariosLivres`); limpeza nos quatro casos da RN-429 (relógio às 04:30).
  - `pedido-publico.test.ts` (`aceitarPedidoPublico` e desistência): aceite cria paciente, aceite do termo (versão e momento do pedido) e consulta; com opt-in → `whatsapp_optin_em` = `verificado_em`; sem opt-in → nulo; e-mail virou paciente ativo → consulta para ele sem cadastro novo; arquivado ou bloqueado → mensagem; nutricionista marcou por cima → mensagem do horário ocupado; recusa → `resolvido_em` + e-mail nos dois casos do link; desistência GET não grava, POST grava e avisa a nutricionista, **o segundo POST não gera um segundo aviso**, token de pedido concluído → "Este link não é válido."; **aceite de pessoa nova em local online grava `link_online` = sala**; `resolucao` gravada no aceite, na recusa e no vencimento.
  - `route.test.ts` e `page.test.ts` do token: o `next.config.ts` tem a regra `no-referrer` + `no-store`.
  - `render.test.ts`: os dois modelos, com e sem link; texto sem motivo da recusa.
  - `n/[slug]/page.test.ts`: frase do ponto de coleta só com a chave ligada.
- [ ] **Step 2:** `pnpm vitest run src/modules/agenda/agendamento-publico.test.ts src/modules/agenda/pedido-publico.test.ts src/modules/agenda/solicitacoes.test.ts src/email/render.test.ts "src/app/n/[slug]/page.test.ts" src/app/api/mesma-origem-rotas.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(agenda): pedido de pessoa nova pela página pública (P23-07)`.

**Pronto quando:** testes verdes; revisão do `revisor-rls` (travas, funções, RN-424a) e do `normas-cfn-lgpd` (cadastro só no aceite, opt-in com a data da verificação, frase do ponto de coleta, eliminação) sem Critical/Important.

---

### Task 8: Solicitações — telas, chave, portal e E2E (PR 3)

**Files:**
- Create: `src/app/painel/agenda/solicitacoes/{page.tsx,actions.ts,recusar-dialogo.tsx}`. O foco usa `focarTitulo(['titulo-agenda'])` de `@/app/painel/financeiro/foco` (`focarTitulo(alvos = [ID_TITULO])`, do 20 PR 2, que já está na `main` quando o PR 3 abre), com `ID_TITULO_AGENDA = 'titulo-agenda'` na página; sem `foco.ts` próprio
- Modify: `docs/operacao/agenda-2.md` (completa o runbook criado na T1: volta atrás do PR 3, R-403), `src/app/painel/agenda/abas.tsx` (liga "Solicitações ({n})"), `src/modules/ajuda/conteudo.ts` (`padrao` do guia `agenda` + `solicitacoes`)
- Modify: `src/app/painel/agenda/horarios/page.tsx` (h2 "Pedidos de consulta", "Confirmar os pedidos antes de marcar", ajuda "Os pedidos feitos pelo app e pela página de agendamento esperam a sua resposta em Solicitações.", "Configuração salva."), `src/app/painel/agenda/horarios/actions.ts` (`salvarChaveAction`), `src/modules/agenda/disponibilidade.ts` ou `locais.ts` (`salvarConfirmacaoDosPedidos(ctx, ligar: boolean)`), `src/app/painel/agenda/consultas/[id]/page.tsx` (selo "Pedido a responder", "Aceitar" e "Recusar" com confirmação, sem "Alterar" nem "Registrar presença"; aviso "Primeira consulta online: confira o TCLE de telenutrição antes de atender." na consulta online com "Primeira consulta"), `src/app/painel/page.tsx` + `src/modules/agenda/inicio.ts` (`Inicio.solicitacoes: number` e o cartão "Solicitações ({n})", só quando há), `src/app/p/(portal)/agenda/{page.tsx,[id]/page.tsx,acoes-consulta.tsx,actions.ts}` ("Aguardando confirmação da nutricionista", "Desistir do pedido" com "Desistir deste pedido?", `?ok=pedido-cancelado` com "Pedido cancelado." numa região `role="status"` fixa que recebe o foco; "Pedido enviado. Sua nutricionista vai confirmar o horário e você recebe um e-mail."; "Não confirmado"), `e2e/painel-rotas.ts` (`/painel/agenda/solicitacoes`), `scripts/e2e-seed.ts` (chave desligada e sem pedido no começo)
- Create: `e2e/agenda-2.spec.ts` (casos novos) — bloco `10.9.23.10`–`.29`
- Test: `src/app/painel/agenda/solicitacoes/page.test.ts`, `src/app/painel/agenda/solicitacoes/actions.test.ts`, `src/app/p/(portal)/agenda/actions.test.ts`, `src/modules/agenda/inicio.test.ts`

**Interfaces:**
```ts
export async function aceitarAction(tipo: 'consulta' | 'pessoa_nova', id: string): Promise<void>; // redirect('/painel/agenda/solicitacoes?ok=aceito|mudou') ou erro na região de status
export async function recusarAction(tipo: 'consulta' | 'pessoa_nova', id: string, _prev: unknown, fd: FormData): Promise<{ erro?: string }>; // ?ok=recusado|mudou
export async function salvarConfirmacaoDosPedidos(ctx: TenantContext, ligar: boolean, deps?): Promise<void>; // só nutri; o gatilho tenants_agenda_da_equipe confirma
```
- Fila (§7): cartões (`h2` por pedido) com paciente ou "Nova pessoa: {nome}", horário, local, origem ("App" ou "Página de agendamento"), "Pedido em {dd/mm/aaaa}", "Responda até {dd/mm/aaaa} às {hh:mm}"; "Aceitar" e "Recusar" com `aria-label` "Aceitar o pedido de {nome}"/"Recusar o pedido de {nome}"; recusa: "Recusar o pedido de {nome}? A pessoa recebe um e-mail avisando." com "Motivo (só você vê)" (só no pedido de paciente) e "Confirmar recusa"; vazio "Nenhum pedido aguardando resposta."; região `role="status"` fixa acima da lista com "Pedido aceito. Consulta marcada." / "Pedido recusado." / "Este pedido já foi respondido ou venceu."; foco no h1 (`tabIndex={-1}`).
- Abas: "Solicitações ({n})" com um `count` só na transação da tela.

- [ ] **Step 1: Testes que falham:**
  - `solicitacoes/page.test.ts`: os textos da fila; vencidos fora (leitura preguiçosa); campo de motivo só no pedido de paciente; aviso de TCLE na primeira consulta online.
  - `solicitacoes/actions.test.ts`: `?ok=aceito`, `?ok=recusado`, `?ok=mudou`; sessão de paciente → recusada antes da transação.
  - `p/(portal)/agenda/actions.test.ts`: desistir redireciona com `?ok=pedido-cancelado`; "Remarcar" não aparece no pedido.
  - `inicio.test.ts`: "Solicitações (3)" com 3 pendentes; sem pendente, sem cartão.
  - `solicitacoes.test.ts` (US-407): desligar a chave com 2 pedidos pendentes — os dois continuam na fila; os novos voltam a ser marcados direto.
  - `p/(portal)/agenda/actions.test.ts`: pedido feito com a chave ligada mostra "Pedido enviado. Sua nutricionista vai confirmar o horário e você recebe um e-mail." (pelo `status` devolvido por `agendarComoPaciente`).
  - `e2e/agenda-2.spec.ts`: ligar a chave em Horários; paciente pede pelo portal e vê "Aguardando confirmação da nutricionista"; nutricionista aceita (e-mail "consulta marcada" no Mailpit); outro pedido recusado (e-mail "não confirmado"); pessoa nova pela página pública (código pelo Mailpit) → fila "Nova pessoa: …" → aceitar cria o cadastro; remarcar consulta agendada com a chave ligada → nasce agendada; desistência da pessoa nova pelo link do e-mail.
- [ ] **Step 2:** `pnpm vitest run src/app/painel/agenda/solicitacoes "src/app/p/(portal)/agenda/actions.test.ts" src/modules/agenda/inicio.test.ts src/modules/agenda/solicitacoes.test.ts` → FAIL.
- [ ] **Step 3:** implementar; runbook `docs/operacao/agenda-2.md`, seção do PR 3 (volta atrás: desligar a chave, responder ou cancelar os pedidos, conferir que não há `solicitada` nem aguardando; a imagem anterior lê as regras pela modalidade; nunca para antes do PR 1).
- [ ] **Step 4:** mesmo comando → PASS; `pnpm vitest run src/modules/ajuda/conteudo.test.ts`; `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3103 pnpm test:e2e e2e/agenda-2.spec.ts e2e/agenda.spec.ts e2e/portal.spec.ts`; axe da fila com pedido, da recusa aberta e do portal com pedido (três modos, 360 px); `/n/<slug>/pedido/[token]` no `e2e/acessibilidade.spec.ts`.
- [ ] **Step 5:** commit `feat(agenda): fila de solicitações, chave e portal (P23-08)`.

**Pronto quando:** testes e E2E verdes; revisão do `revisor-interface` (foco, região viva, confirmação, vocabulário AG-D43) sem Critical/Important.

---

### Task 9: Previsão de retorno e seção "Consultas" no Início da ficha (PR 3)

**Files:**
- Create: `src/modules/agenda/retorno.ts`, `src/modules/ficha/secoes/consultas.ts`
- Modify: `src/modules/pacientes/atendimentos.ts` (campo `retornoPrevistoEm` na entrada; "em {n} semanas" convertido no fuso; editar a `data` com previsão fora da faixa → mensagem da RN-430, nunca 23514; sem mudar o retorno do 20 PR 2), `src/modules/pacientes/exportacao-job.ts` (só acrescentar `retornoPrevistoEm: consultations.retornoPrevistoEm` no select de `consultations`, `:360`, e no tipo `atendimentos: { data; orientacoes; retornoPrevistoEm: string | null }`, `:150`; RN-438 — a exportação lista as colunas à mão), `src/app/painel/pacientes/[id]/atendimentos/*` (campo "Retorno previsto (opcional)" com "Data" ou "Em {n} semanas"), `src/modules/agenda/visoes.ts` (liga o marcador de retorno e `MARCADOR_RETORNO_LIGADO = true`; toque abre `/painel/agenda/nova?paciente=<id>`), `src/modules/ficha/secoes/index.ts` (**uma linha no fim** de `SECOES_DA_FICHA`), `src/modules/agenda/status.ts` (`TITULO_SECAO_CONSULTAS = 'Consultas'`; **não** em `MSG_FICHA.titulos`: `registro.test.ts:56` exige que os títulos sejam exatamente os 8 do Plano 18, AG-D74), `src/modules/ficha/registro.test.ts` (`IMPORTS_PERMITIDOS` + `'@/modules/agenda/status'`, com o comentário "status.ts é puro: rótulos e STATUS_OCUPA, sem banco nem auditRead (Plano 23, §4.4)"), `src/modules/ia/guardas-agenda.test.ts` (novo, RN-439)
- Test: `src/modules/agenda/retorno.test.ts`, `src/modules/pacientes/atendimentos.test.ts`, `src/modules/pacientes/exportacao.test.ts` (`atendimentos[].retornoPrevistoEm`), `src/modules/ficha/secoes.test.ts`, `src/app/painel/agenda/page.test.ts` (o filtro "Previsões de retorno" aparece), `src/modules/ia/guardas-agenda.test.ts`, `src/modules/ia/campos-enviados.test.ts` (sem mudança)

**Interfaces:**
```ts
export async function previsoesDeRetorno(tx: Tx, de: string, ate: string, filtro: { patientId?: string }): Promise<{ patientId: string; nome: string; data: string }[]>; // último atendimento com previsão, paciente ativo sem consulta futura em STATUS_OCUPA
export const secaoConsultas: SecaoDaFicha; // id 'consultas', titulo TITULO_SECAO_CONSULTAS (de status.ts), rótulo Primeira consulta/Retorno pelo fragmento sqlEhRetorno, aba '', verTodos: (id) => `/painel/agenda?visao=lista&paciente=${id}`, disponivel: () => true, sem adicionar, sem leitura
export function retornoEmSemanas(dataAtendimento: string, semanas: number): string; // AAAA-MM-DD
```
- Validação (RN-430): "A previsão de retorno deve ficar entre a data do atendimento e 2 anos depois.".
- `resumo` da seção (§4.4): `total` = consultas futuras em `STATUS_OCUPA`, ou 1 quando não há futura e há previsão; até 3 itens em ordem **crescente** (exceção documentada ao "mais recentes primeiro" de `tipos.ts`), rótulo "Primeira consulta" ou "Retorno" e situação "Agendada", "Confirmada" ou "Pedido a responder"; sem futura e com previsão, o item "Retorno previsto" com a data; `noApp` conta as futuras que o paciente vê em "Minhas consultas" (quando o 18 PR 2 tiver o `no-app.ts`; antes, `noApp: false`, como o `inicio.ts` da `main`).
- Guarda RN-439 (`guardas-agenda.test.ts`, por grafo com `test/grafo-de-imports.ts`, como a do Plano 20): nada alcançável a partir de `src/modules/ia/**` é `locais.ts`, `aniversarios.ts`, `retorno.ts` ou `solicitacoes.ts`; nenhum arquivo de `src/modules/ia/**` contém `retorno_previsto`.

- [ ] **Step 1: Testes que falham:** previsão "em 6 semanas" no fuso (servidor em UTC às 01:30 do dia seguinte); limite antes e depois de 2 anos; editar a data do atendimento com previsão fora da faixa → mensagem da RN-430, nunca 23514; `atendimentos[].retornoPrevistoEm` no `dados.json`; marcador só do último atendimento com previsão e só sem consulta futura (com `solicitada` futura, some); paciente arquivado fora; a seção abre com o item "Retorno previsto" sem consulta futura; o `total` bate com as futuras da Lista filtrada pelo paciente (RN-411); a previsão não aparece no portal (`jornada.ts` projeta só `id`, `data` e `orientacao`); guardas da IA.
- [ ] **Step 2:** `pnpm vitest run src/modules/agenda/retorno.test.ts src/modules/pacientes/atendimentos.test.ts src/modules/pacientes/exportacao.test.ts src/app/painel/agenda/page.test.ts src/modules/ficha src/modules/ia/guardas-agenda.test.ts src/modules/ia/campos-enviados.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(agenda): previsão de retorno e seção Consultas na ficha (P23-09)`.

**Pronto quando:** testes verdes; `campos-enviados.test.ts` sem mudança.

---

### Task 10: Aniversariantes — lista, autorização, envio, saída e LGPD (PR 3)

**Files:**
- Create: `src/modules/agenda/aniversarios.ts`, `src/modules/agenda/aniversario-link.ts` (AG-D50; só o token), `src/app/painel/agenda/aniversariantes/{page.tsx,actions.ts,selecao.tsx,autorizacao-dialogo.tsx,whatsapp.ts}` (`whatsapp.ts` puro, sem `server-only`, é o único dono de `urlWhatsappAniversario`), `src/app/p/(portal)/perfil/aniversario.tsx`, `src/app/aniversario/sair/[token]/page.tsx`, `src/app/api/aniversario/sair/[token]/route.ts`
- Modify: `src/db/tenant.ts` (`SEM_CONTA_PERMITIDOS` + `'src/modules/agenda/aniversarios.ts'` no fim), `src/modules/agenda/limite-ip.ts` (`chaveDoLimite` ganha o tipo `'aniversario-sair'`, no fim da união), `src/app/api/mesma-origem-rotas.test.ts` (`EXCLUIDAS` + `aniversario: 'POST de um clique (RFC 8058) vindo do provedor de e-mail: sem cookie; vale o token HMAC'`, AG-D51), `src/email/transport.ts` (`OutgoingEmail.headers?: Record<string, string>`, repassado ao Resend e ao Mailpit), `src/email/types.ts` (`RenderedEmail.headers?`; modelo `aniversario`), `src/email/templates.tsx`, `src/email/job.ts` e `src/modules/notificacoes/enviar.ts` (passam `headers`), `src/modules/notificacoes/{mensagens,enviar}.ts` (`emailDaNotificacao` do tipo `aniversario`; o contexto carrega a autorização vigente só para esse tipo; `motivoParaIgnorar` reconfere a RN-431 → `sem_autorizacao` ou `paciente_inativo`), `src/app/p/(portal)/perfil/{page.tsx,actions.ts}` (só acrescentar o bloco), `src/modules/agenda/visoes.ts` (nada: o marcador de aniversário já é da T5), `src/app/painel/page.tsx` + `src/modules/agenda/inicio.ts` ("Aniversariantes de hoje ({n})"), `src/modules/pacientes/exportacao-job.ts` (seção nova `aniversario` no fim: evento, origem, forma, data; notificações `aniversario` e `pedido_nao_confirmado` na seção `lembretes`), `src/modules/pacientes/lgpd.ts` (`select app_anonimizar_autorizacoes_aniversario(id)` ao lado de `app_anonimizar_aceites`, `:552`), `e2e/painel-rotas.ts` (`/painel/agenda/aniversariantes`), `next.config.ts` (`/aniversario/sair/:token*` e `/api/aniversario/sair/:token*` com `no-referrer` + `no-store`, AG-D71), `src/app/painel/agenda/abas.tsx` (liga "Aniversariantes"), `src/modules/ajuda/conteudo.ts` (`padrao` do guia `agenda` + `aniversariantes`)
- Test: `src/modules/agenda/aniversarios.test.ts`, `src/modules/agenda/aniversario-link.test.ts`, `src/app/api/aniversario/sair/[token]/route.test.ts`, `src/app/aniversario/sair/[token]/page.test.ts`, `src/app/painel/agenda/aniversariantes/whatsapp.test.ts`, `src/email/transport.test.ts`, `src/email/render.test.ts`, `src/modules/notificacoes/enviar.test.ts`, `src/modules/pacientes/{exportacao,lgpd}.test.ts`, `src/db/sem-conta-guarda.test.ts`, `src/app/p/(portal)/perfil/page.test.ts`, `src/app/p/(portal)/perfil/actions.test.ts`, `src/modules/agenda/inicio.test.ts`

**Interfaces:**
```ts
export type SituacaoAniversario = 'pode_receber' | 'sem_autorizacao' | 'menor' | 'ja_enviada' | 'ja_passou' | 'passou_do_horario';
export type Aniversariante = { patientId: string; nome: string; dia: string; faz: number; situacao: SituacaoAniversario; autorizadoEm: string | null; telefone: boolean };
export async function aniversariantesDoMes(ctx: TenantContext, tenant: TenantAgenda, mes: string, deps?: { db?: Db; agora?: Date }): Promise<{ mes: string; corrente: boolean; lista: Aniversariante[] }>;
export function elegivel(p: { status: string; anonimizadoEm: Date | null; dataNascimento: string | null }, autorizacao: { evento: string; registradoEm: Date } | null, dia: string, hoje: string, agoraNoFuso: { hora: number }): SituacaoAniversario; // puro
export async function enviarMensagensDeAniversario(ctx: TenantContext, tenant: TenantAgenda, ids: string[], deps?): Promise<{ agendadas: number; agora: number }>;
export async function registrarAutorizacao(ctx: TenantContext, patientId: string, forma: FormaAniversario, deps?): Promise<void>; // nutri
export async function retirarAutorizacao(ctx: TenantContext, patientId: string, deps?): Promise<void>;                            // nutri (sem forma, AG-D61) ou paciente (canal app)
export async function autorizarPeloApp(ctx: TenantContext, deps?): Promise<void>;                                                // paciente com conta
export async function estadoDoLinkDeSaida(token: string, deps?): Promise<{ estado: 'ok'; nutri: string } | { estado: 'invalido' }>;
export async function retirarPeloLink(token: string, deps?): Promise<'retirada' | 'ja_retirada' | 'invalido'>;                     // semConta, idempotente
// aniversario-link.ts (puro)
export const FINALIDADE_ANIVERSARIO = 'aniversario_sair';
export function assinarLinkDeSaida(l: { tenantId: string; patientId: string }): string;
export function lerLinkDeSaida(token: unknown): { tenantId: string; patientId: string } | null;
// whatsapp.ts (src/app/painel/agenda/aniversariantes; puro, montado no navegador, RN-435)
export function urlWhatsappAniversario(telefoneE164: string, primeiroNome: string, nutri: string): string; // wa.me, texto da RN-435, sem http no texto
```
- Envio (RN-432): `notifications` tipo `aniversario`, canal `email`, sem consulta, `agendada_para` = 9h do dia no fuso; aniversariante de hoje depois das 9h e antes das 21h → agora; `INSERT … ON CONFLICT (tenant_id, patient_id, (date_part('year', timezone('UTC', agendada_para)))) WHERE tipo = 'aniversario' DO NOTHING` (constante `ANIVERSARIO_UM_POR_ANO` da T1); a elegibilidade é conferida de novo na transação; a trava do paciente é só a da FK (`FOR KEY SHARE`, que **não** conflita com o `FOR NO KEY UPDATE` da autorização): quem garante é a reconferência da RN-431 no envio (`motivoParaIgnorar`), com o teste "retirada depois da marcação → ignorada".
- **Nome da nutricionista** (`{nutricionista}` no e-mail, na página de saída e no WhatsApp): `tenants.nome_profissional`, ou `nome_exibicao` quando o profissional não estiver preenchido; nunca da tabela `user` (`aniversarios.ts` não está na exceção da regra 1).
- Autorização (RN-433): o módulo trava o paciente (`FOR NO KEY UPDATE`) antes do INSERT, nos três canais; `retirar` sem autorização vigente não cria linha; menor de 18 → "Menor de idade" (desabilitado no painel e no portal).
- Saída (RN-434): página GET mostra e não grava; "Confirmar" faz POST (`method="post"`) para a rota; a rota aceita o corpo `List-Unsubscribe=One-Click` e responde **200 sem corpo**, e o formulário da página (campo `origem=pagina`) recebe 303 para `?ok=1`; limite por token (`consumirLimite` com `chaveDoLimite('aniversario-sair', token)`), não por IP. O e-mail leva `List-Unsubscribe: <{url da rota}>` e `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- Textos exatos (§6.2): tela "Aniversariantes de {mês}" · "Mês anterior" · "Próximo mês" · colunas "Paciente", "Dia", "Faz", "Situação" · "Pode receber" · "Sem autorização" · "Menor de idade" · "Já enviada este ano" · "Aniversário já passou" · "Passou do horário de hoje" · "O envio abre no dia 1º de {mês}." · "Pacientes sem data de nascimento não aparecem nesta lista." · "Selecionar todos" · "Limpar seleção" · "{n} marcados" · "Enviar mensagem" · "Abrir no WhatsApp" · "Registrar autorização" · "Retirar autorização" · "Como o paciente autorizou?" ("Por escrito", "Por mensagem", "Verbalmente") · "O paciente autorizou receber mensagens de aniversário. Guarde o comprovante." · prévia "Texto padrão do NutriDebby, enviado em seu nome" · "Vai para {n} pacientes por e-mail, às 9h do dia do aniversário." · "{n} de hoje saem agora." · "Mensagens agendadas: {n}." · vazio "Nenhum aniversariante neste mês."; e-mail: assunto "Uma mensagem da sua nutricionista", corpo "Feliz aniversário, {primeiro nome}! {nutricionista} deseja a você um novo ano com muita saúde.", rodapé "Mensagem enviada pelo NutriDebby a pedido de {nutricionista}.", link "Não quero mais receber mensagens de aniversário"; portal: h2 "Receber mensagem de aniversário da sua nutricionista", ajuda "Uma mensagem por ano, por e-mail, no dia do seu aniversário. Usamos seu nome, sua data de nascimento e seu e-mail. Você pode desligar quando quiser, aqui ou pelo link no próprio e-mail.", "Autorizar", "Retirar autorização", "Autorizado em {dd/mm/aaaa}", "Não autorizado", "Menor de idade", "Não foi possível salvar. Tente de novo."; saída: h1 "Mensagens de aniversário", "Você não quer mais receber mensagens de aniversário de {nutricionista}?", "Confirmar", "Pronto. Você não vai mais receber mensagens de aniversário.", "Este link não é válido.".
- Saudação (AG-D35): primeiro nome social quando o 18 PR 2 estiver na `main` (`patient_cadastro`, lido só no worker); antes, o de registro. Nenhum `auditRead` na lista (US-412).

- [ ] **Step 1: Testes que falham:**
  - `aniversarios.test.ts`: as seis situações; 29/02 em 28/02; mês seguinte só consulta (sem caixa de seleção); "Selecionar todos" só os "Pode receber" de hoje ao fim do mês; relógio às 15h → `agora` = 1, às 22h → "Passou do horário de hoje"; autorização registrada antes dos 18 não conta (CS-404); bloqueado, arquivado, anonimizado e menor nunca recebem; segundo envio no mesmo ano devolve 0 (também com a primeira `ignorada`; retirar e reautorizar não reenvia); autorização retirada depois do agendamento → às 9h `ignorada` (`sem_autorizacao`); `nutri` sem `forma` → recusado; corrida autorizar × retirar no mesmo paciente (a ordem pela trava); lista sem `audit_log`.
  - `aniversario-link.test.ts`: token de outra finalidade (link da consulta, autorização de IA) não abre.
  - `whatsapp.test.ts`: `urlWhatsappAniversario` sem `http` no texto e com o texto da RN-435.
  - `inicio.test.ts`: "Aniversariantes de hoje (2)".
  - `p/(portal)/perfil/actions.test.ts`: autorizar e retirar; menor desabilitado; erro "Não foi possível salvar. Tente de novo.".
  - `aniversarios.test.ts`: a nutricionista retira sem `forma`; `{nutricionista}` = `nome_profissional` ou, sem ele, `nome_exibicao`.
  - `route.test.ts` e `page.test.ts` da saída: o `next.config.ts` tem a regra `no-referrer` + `no-store`.
  - `route.test.ts`: POST de um clique (corpo `List-Unsubscribe=One-Click`, sem cookie, de outra origem) → 200 sem corpo e a linha `retirou` (origem `link`); de novo → 200 sem linha nova; token inválido → 200 sem efeito (sem enumeração); limite por token.
  - `page.test.ts` (saída): GET não grava.
  - `transport.test.ts`: os cabeçalhos chegam ao Resend (`headers`) e ao Mailpit (`Headers`); sem `headers`, nada muda nos chamadores de hoje.
  - `exportacao.test.ts` e `lgpd.test.ts`: seção `aniversario`; anonimização só do `registrado_por` de origem `app`.
  - `sem-conta-guarda.test.ts`: `aniversarios.ts` na lista.
  - `perfil/page.test.ts`: o bloco do portal com a ajuda e o botão explícito; menor desabilitado.
- [ ] **Step 2:** `pnpm vitest run src/modules/agenda/aniversarios.test.ts src/modules/agenda/aniversario-link.test.ts "src/app/api/aniversario/sair/[token]/route.test.ts" "src/app/aniversario/sair/[token]/page.test.ts" src/app/painel/agenda/aniversariantes src/email src/modules/notificacoes/enviar.test.ts src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts src/db/sem-conta-guarda.test.ts src/app/api/mesma-origem-rotas.test.ts "src/app/p/(portal)/perfil/page.test.ts" "src/app/p/(portal)/perfil/actions.test.ts" src/modules/agenda/inicio.test.ts src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5 (fechamento do PR 3):** E2E (autorizar no portal, marcar e "Enviar mensagem" com o relógio do worker, e-mail no Mailpit com `List-Unsubscribe`, sair pelo link) em `e2e/agenda-2.spec.ts` (bloco `10.9.23.30`–`.39`); axe de `/painel/agenda/aniversariantes` (com a prévia aberta) e de `/aniversario/sair/[token]`; manual técnico caps. 02, 05 e 06 (seções novas no fim: tabelas, funções, `vencerSolicitacoes` em `processarNotificacoes`, rota de um clique) pelo `guardiao-manual`; commit `feat(agenda): aniversariantes com autorização e saída de um clique (P23-10)`.

- **Critério de aceite vindo do `/code-review` do PR 1 (#59), decisão da orquestradora 17/11:** `anonimizarVencidos` (`src/modules/pacientes/lgpd.ts`) chama `app_anonimizar_autorizacoes_aniversario` na anonimização do titular, na ordem da regra 8. Teste em `lgpd.test.ts`: depois da anonimização, `registrado_por` das autorizações com origem `app` fica nulo e a linha continua como prova, com controle positivo (antes da anonimização o `registrado_por` está preenchido).

**Pronto quando:** testes e E2E verdes; revisão do `normas-cfn-lgpd` (autorização própria, menores, texto fixo, saída, exportação) e do `revisor-rls` (gatilho, `semConta`, anonimização) sem Critical/Important.

---

### Task 11: Fase B — filtro de local em Pacientes e no Financeiro (PR 4, com portão)

**Antes:** conferir na `main` o 18 PR 2 (`FiltroDaLista` com o ponto de extensão, `src/modules/pacientes/pacientes.ts`, e `filtroDaUrl`) e o 20 PR 2 (`src/modules/financeiro/*`, Lançamentos, Relatórios, CSV). Faltando um deles, parar: a tarefa vira o Plano 23B (AG-D38) e a orquestradora é avisada.

**Files:**
- Modify: `src/modules/pacientes/pacientes.ts` (`FiltroDaLista.localId?: string`; `filtroDaUrl` lê `local`; um `exists` em `conds`, RN-436), `src/app/painel/pacientes/page.tsx` (filtro "Local" que combina com a aba, a busca e a etiqueta), `src/modules/financeiro/lancamentos.ts` (`FiltrosLista.localId?: string | 'sem_local'`), `src/modules/financeiro/resumo.ts` ("Entradas e saídas nos últimos 12 meses" com o filtro; Resumo, saldo e Fluxo de caixa sem divisão, com "Todos os locais"), rotas CSV do Financeiro (parâmetro `local`), telas `src/app/painel/financeiro/{lancamentos,relatorios}/*`
- Test: `src/modules/pacientes/pacientes.test.ts`, `src/modules/financeiro/lancamentos.test.ts`, `src/modules/financeiro/resumo-propriedade.test.ts` (caso novo de propriedade), `src/app/painel/pacientes/page.test.ts`

**Interfaces:**
```ts
export type FiltroDaLista = { …; localId?: string }; // exists de consulta no local com status not in ('cancelada','solicitada')
export type FiltrosLista = { …; localId?: string | 'sem_local' }; // fin_lancamentos.appointment_id → appointments.local_id
```

- [ ] **Step 1: Testes que falham:** lista de pacientes por local (só consultas não canceladas e não pedidas); combinação com aba, busca e etiqueta; Lançamentos por local e "Sem local" (lançamento sem consulta e consulta antiga); **propriedade**: soma dos locais + "Sem local" = total sem filtro (CS, RN-437), em Lançamentos, no CSV e nos 12 meses; Resumo e Fluxo não aceitam o filtro.
- [ ] **Step 2:** `pnpm vitest run src/modules/pacientes/pacientes.test.ts src/modules/financeiro/lancamentos.test.ts src/modules/financeiro/resumo-propriedade.test.ts src/app/painel/pacientes/page.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; E2E de `e2e/pacientes.spec.ts` e do Financeiro com o filtro.
- [ ] **Step 5:** commit `feat(agenda): filtro de local em Pacientes e no Financeiro (P23-11)`.

**Pronto quando:** testes verdes; nenhuma coluna nova em `patients`, `patient_cadastro` ou `fin_lancamentos`.

---

### Task 12: Fechamento do plano

**Files:**
- Modify: `src/modules/ajuda/conteudo.ts` (+ `conteudo.test.ts`): guia `agenda` com `versao` + 1 sobre a da `main` (o `padrao` já foi ampliado nas T2, T8 e T10) (passo "Marque uma consulta presencial ou online" reescrito para o local; passos novos com ressalva: "se você ligar 'Confirmar os pedidos antes de marcar' em Horários, aparece a aba 'Solicitações'"); `horarios` + 1 (local e chave); `configuracoes` + 1 (resumo cita "locais de atendimento"; AG-D55); `SEM_AJUDA` com `/painel/agenda/imprimir`. `src/modules/ajuda/portal.ts` (+ teste): guia do portal + 1 ("se a sua nutricionista confirma os pedidos", aniversário no Perfil). Cada guia sobe **uma vez** no plano, a partir da versão da `main` no rebase
- Modify: `docs/manual-tecnico/{02-banco-de-dados,05-agenda-portal-conteudo,06-worker-seguranca-operacao}.md` e o índice/glossário do `README.md` (pelo `guardiao-manual`), `CLAUDE.md` (conferir as frases do Plano 23), `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md` (PD-70 a PD-74 entregues; itens da §2.2 "Fora" e da §19 da spec), `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md` (linha do Plano 23), a spec (decisões AG-D46 em diante e a seção "Revisão do plano"; RN-438 já corrigida na revisão do plano), `docs/operacao/agenda-2.md`
- Manual do usuário (Docs) e Central de Ajuda: textos preparados para o dono e a Debby (AG-P4); textos ao paciente no pacote do advogado (E-09)
- E2E completo: `e2e/agenda-2.spec.ts`, `e2e/agenda.spec.ts`, `e2e/portal.spec.ts`, `e2e/acessibilidade*.spec.ts`

- [ ] **Step 1:** guias e testes (`pnpm vitest run src/modules/ajuda`): cada rótulo citado entre aspas existe num `.tsx` ou em `src/modules/agenda`.
- [ ] **Step 2:** manuais e documentos acima; migrations geradas de novo sobre a `main` se o PR 1 ainda não tiver entrado (§5).
- [ ] **Step 3:** `pnpm test` inteiro (escalonado com as outras sessões), `pnpm lint`, `pnpm typecheck`, E2E completo.
- [ ] **Step 4:** CS-405 combinado com a Debby (2 semanas de Semana em grade e impressão), registrado no runbook.
- [ ] **Step 5:** commit `docs(agenda): fechamento do Plano 23 (P23-12)`.

---

## Depois das tarefas (fluxo do CLAUDE.md)

Para cada PR (1, 2, 3 e 4): revisão final do branch (workflow, com `revisor-rls` — peças `SECURITY DEFINER`, gatilhos, travas, `staff_only`, `aguardando_fora_do_publico`, `exportar`, `semConta` —, `normas-cfn-lgpd` — telenutrição, aniversário, pessoa nova, exportação e anonimização —, `revisor-interface` — grade, Mês, fila, foco, região viva, 360 px, os dois temas — e `guardiao-manual` — manual técnico e ajuda) → uma onda de correções → `/code-review high` no PR **uma vez** → correções Critical/Important (Minor para o backlog) → re-revisão **só do diff das correções** → `/security-review` (rota de um clique, desistência pública, enumeração na página pública, link da sala, RLS e isolamento) → merge **só com o OK do dono** (merge = deploy; sem merge das 03h às 07h30 BRT; sem snapshot da Hostinger). Se sobrar Critical/Important confirmado depois da re-revisão, parar e avisar o dono.

Agentes por tarefa (PM-A14): `revisor-rls` (T1, T4, T6, T7, T10), `normas-cfn-lgpd` (T2, T6, T7, T10), `revisor-interface` (T2, T5, T8, T10), `guardiao-manual` (fechamento de cada PR e T12). A sessão avisa a orquestradora a cada etapa (início, PR aberto, CI verde, revisão, pronto para merge) para o painel do backlog Paridade Dietbox. Antes do merge do PR 3: runbook de volta atrás pronto (R-403) e a chave desligada em produção (padrão).

---

## Conferência do plano contra o código (17/11/2026)

Feita no worktree `nutridebby-23` (`main` 6c3ee8f + spec) e nos worktrees da onda 1 e da onda 2. O que a spec não dizia ou dizia de outro jeito, e como o plano trata:

| Achado | Onde no código | Tratamento |
|---|---|---|
| A imagem do PR 1 roda sobre as regras "ambas" desdobradas: `gerarHorarios` gera dois horários com o mesmo início (um presencial, um online) e `escolherHorario` pega o primeiro e confere a modalidade — o paciente que escolhe "online" receberia "não está mais disponível" | `src/modules/agenda/horarios.ts:34-55`, `agendamento-paciente.ts:48-56` | T1 junta horários de mesmo início/fim (AG-D47) |
| O `publico` não lê a linha aguardando (`aguardando_fora_do_publico`), então a desistência da pessoa nova pelo link do e-mail (AG-D42) não tinha como ler nem gravar | spec §9.4 | Função `app_pedido_publico_desistir` no molde §9.1, com o `token_hash` do próprio pedido (AG-D48) |
| A rota de um clique recebe POST de outra origem; a guarda `mesma-origem-rotas.test.ts` exige `mesmaOrigem` em toda pasta de `src/app/api` fora de `EXCLUIDAS` | `src/app/api/mesma-origem-rotas.test.ts:21-29` | Pasta `aniversario` em `EXCLUIDAS` com o motivo; a desistência vai em `api/n/`, já excluída (AG-D51) |
| Os filtros da agenda são formulário GET; `formularios-post.test.ts` só aceita GET em `GET_PERMITIDOS` | `src/app/formularios-post.test.ts:15-22` | `src/app/painel/agenda/filtros.tsx` na lista (AG-D52) |
| `ROTULO_STATUS` mora em `src/app/painel/agenda/periodo.ts:16`; a seção da ficha só pode importar módulos da lista `IMPORTS_PERMITIDOS` | `periodo.ts`, `src/modules/ficha/registro.test.ts:24` | Vai para `src/modules/agenda/status.ts`, `periodo.ts` reexporta (AG-D57) |
| `gravarConsultaDoPaciente` sempre grava `agendada` e agenda lembretes; com a chave ligada o status sai do gatilho | `agendamento-paciente.ts:63-89` | Devolve `{ id, status }` do `RETURNING` e decide por ele (AG-D53) |
| O Perfil grava o link padrão por `src/app/painel/actions.ts:38-39` e `src/modules/plataforma/marca.ts:39-40`, com o campo em `src/app/painel/configuracoes/perfil-form.tsx:21-22` | — | T2 tira o campo e a gravação; a coluna fica (AG-D7) |
| `mural.ts:57` e `jornada.ts:14` já filtram por `STATUS_ATIVOS`, que não muda: o pedido não aparece sem mexer neles | `src/modules/portal/{mural,jornada}.ts` | Só testes novos; o conflito com o 19 (que reescreve o mural) deixa de existir no código |
| O cancelamento da exclusão LGPD é chamado em `lgpd.ts:176` (a spec cita `:157`) | `src/modules/pacientes/lgpd.ts:176` | Só a referência |
| `registrarAtendimento` devolve `Promise<string>` na `main`; o 20 PR 2 muda para `{ id, cobranca }` | `src/modules/pacientes/atendimentos.ts:66` | T9 rebaseia sobre o 20 PR 2 e não muda o retorno |
| Os testes das peças `SECURITY DEFINER` precisam de dono sem superusuário; o único cluster assim é o de `migrate-owner.test.ts`, que já re-executa trechos de migration (caso da 0110) | `src/db/migrate-owner.test.ts:16-22`, `:491-520` | `describe` novo no fim do arquivo; bloco `P23-BACKFILL` idempotente para o teste rodar de novo (AG-D54) |
| O guia `configuracoes` (versão 8) cita "horários" no resumo; o cartão novo de Locais o deixa incompleto, e o 19 e o 22 também sobem a versão | `src/modules/ajuda/conteudo.ts:311-316` | Versão + 1 na T12 (AG-D55) |
| Bloco de IP do E2E | `e2e/*.spec.ts` (em uso: 10.9.{0,2,3,5–8,10–20,26–29,31}) | `10.9.23.x` (AG-D56) |
| Numeração 21 × 22 (aviso da spec §13) | specs em `nutridebby-21` e `nutridebby-22` | Já resolvida: o 22 foi para 370–399 (EP-D39); o 23 continua no 400–439 |
| Heads da onda 1 andaram: 18 PR 2 em 3799409 (a spec citou 2061d0c), 19 em 3fc8b51 (citou 4d07fc1), 20 PR 2 em c9ade41 | worktrees | "Coordenação" usa os novos; reconferir na T1 e na T11 |

---

## Coordenação

Conferido com `git diff --name-only 6c3ee8f...HEAD` em cada worktree em 17/11/2026: `nutridebby-18` (`plano-18-pr2`, 3799409), `nutridebby-b` (`plano-19-plano-alimentar-2`, 3fc8b51), `nutridebby-c` (`plano-20-financeiro`, c9ade41) e as specs da onda 2 em `nutridebby-21` (`plano-21-avaliacao-fisica`, 7635639) e `nutridebby-22` (`plano-22-exames-prescricao`, 8801c17). Os branches andam: reconferir na T1 (antes do §5) e na T11.

### Onda 1

| Onde | Quem | Conflito | Como resolver |
|---|---|---|---|
| `drizzle/` | 18 PR 2 (0124–0125 no branch), 19 (até 0133 no branch) | Números, journal e `when` | §5: o PR 1 gera de novo sobre a `main` do momento; nada reservado; um PR com migration por vez na fila |
| `src/modules/pacientes/pacientes.ts`, `src/app/painel/pacientes/page.tsx` | 18 PR 2 (reescreve a lista; `FiltroDaLista` com o ponto de extensão, `:243-251`) | Filtro "Local" | Só na T11 (Fase B, portão); só `localId?` e um `exists` |
| `src/app/painel/agenda/nova/page.tsx` | 18 PR 2 (`listarPacientes({ aba, ordem: 'registro' })`) | Seletor de local | T3 rebaseia; manter a chamada do 18 |
| `src/db/tenant.ts` (`SEM_CONTA_PERMITIDOS`) | 18 PR 2 (`ficha/no-app.ts`) | `aniversarios.ts` na mesma lista | Só acrescentar no fim (T10) |
| `src/modules/agenda/agendamento-publico.test.ts` | 18 PR 2 | Casos novos | `describe` próprios (T4, T7) |
| `src/modules/ficha/secoes/*` | 18 PR 2 (`atendimentos.ts`, `no-app.ts`) | Seção "Consultas" e o `noApp` | Arquivo novo + uma linha no fim de `SECOES_DA_FICHA`; o `noApp` só com o `no-app.ts` na `main` (T9) |
| `consultas/[id]/page.tsx`, `agenda/actions.ts` (+ teste), `presenca.ts` (+ teste), `pacientes/atendimentos.ts`, `[id]/atendimentos/*` | 20 PR 2 ("Cobrança", `{ cobranca }`, `{ id, cobranca }`) | Local, Aceitar/Recusar, status, previsão | PR 2 e PR 3 depois do merge do 20 PR 2; não mudar as assinaturas do 20 |
| `src/app/painel/financeiro/foco.ts` | 20 PR 2 (cria) | Foco da fila Solicitações | O PR 3 só abre depois do 20 PR 2: usar `focarTitulo(['titulo-agenda'])` dele, sem cópia (T8) |
| `src/app/formularios-post.test.ts` | 20 PR 2 | `GET_PERMITIDOS` | Só acrescentar no fim (T5) |
| `src/app/painel/actions.test.ts` | 20 PR 2 | Perfil sem `linkOnlinePadrao` | `describe` próprio no fim; ajustar só os casos do link (T2) |
| `src/modules/ficha/{registro.test.ts,textos.ts}` | 18 PR 2 | `IMPORTS_PERMITIDOS` e títulos | Só acrescentar `@/modules/agenda/status` no fim de `IMPORTS_PERMITIDOS`; `textos.ts` não muda (o título vem de `status.ts`, AG-D74) (T9) |
| `test/carga/{seed.ts,cenario.js}` | 18 PR 2 (os dois), 19 (`seed.ts`) | Cenário "Mês com marcadores" | Só acrescentar (T5) |
| `src/db/migrate-owner.test.ts` | 19 (teste da TACO no fim, P19-01) | `describe` do 23 | Só acrescentar; o backfill continua o último bloco depois do rebase (T1) |
| `src/modules/financeiro/*`, `src/app/painel/financeiro/*` | 20 PR 2 (cria) | Filtro de local | T11 (portão); manter o teste de propriedade do 20 |
| `src/app/p/(portal)/perfil/*` (`privacidade.tsx`, `page.test.ts`) | 20 PR 2 | Bloco do aniversário | Componente novo `aniversario.tsx`; só acrescentar na página (T10) |
| `src/email/templates.tsx`, `src/email/render.test.ts` | 20 PR 2 | Modelos novos | Só no fim (T6, T7, T10) |
| `src/modules/pacientes/{lgpd,exportacao-job}.ts` (+ testes) | 18 PR 2, 19, 20 PR 2 | Seção `aniversario`, nome do local, anonimização | Só acrescentar; filtro de `SO_APAGA.patients` como linha nova (T1, T4, T10) |
| `src/modules/portal/mural.ts` | 19 (reescreve) | — | Nenhuma mudança de código no 23 (filtra por `STATUS_ATIVOS`); só testes |
| `src/worker/index.ts`, `src/jobs/queues.ts` | 19 (`plano-pdf-2`) | — | Não mexer (C-403) |
| `src/app/painel/configuracoes/page.tsx` (`CARTOES`), guia `configuracoes` | 19 (três cartões) | Cartão "Locais de atendimento" | Cartão no fim; guia + 1 sobre a `main` no rebase (T2, T12) |
| `src/modules/ajuda/{conteudo,portal}.ts` (+ testes) | 18 PR 2, 19, 20 PR 2 | Guias `agenda`, `horarios`, `configuracoes`, portal | Só acrescentar passos; versão + 1 uma vez cada, sobre a da `main` (T12) |
| `src/app/painel/navegacao.ts` | 20 PR 2 ("Financeiro") | — | Não mexer (AG-D37) |
| `src/lib/tenant-session.ts` | 20 PR 2 | — | Não mexer |
| `e2e/agenda.spec.ts`, `e2e/painel-rotas.ts`, `scripts/e2e-seed.ts`, `e2e/acessibilidade-painel.spec.ts` | 18 PR 2, 19, 20 PR 2 (cada "Realizada" cria cobrança) | Seletores da grade nova; horários da semente no `EXCLUDE` | E2E novo em `e2e/agenda-2.spec.ts`; em `agenda.spec.ts` só o que a grade quebrar; horários próprios do 23; um E2E por vez |
| `docs/manual-tecnico/{02,05,06}` | 20 PR 2 | Seções novas | Seções no fim; rebase |
| Textos legais (DPA 1.1 do 20 PR 2; termo do paciente) | 20 PR 2 | — | Não mexer (C-410); termo 1.1 pela orquestradora, um texto legal por vez |

### Onda 2

| Onde | Quem | Conflito | Como resolver |
|---|---|---|---|
| `drizzle/` | 21 e 22 (cada um com migration no PR 1) | Fila de migrations | Um PR com migration por vez; quem entra depois refaz o §5. Ordem pela prontidão, decidida pela orquestradora |
| `test/isolamento.test.ts` (`ULTIMAS`, `FABRICAS`, `SO_APAGA`), `rls-guard.ts`, `audit-guard.ts`, `CLAUDE.md` | 21, 22 | Entradas novas | Só acrescentar; em `ULTIMAS`, `locais_atendimento` fica logo depois de `'appointments'` mesmo que outro plano acrescente antes de `'patients'` |
| `src/modules/pacientes/{exportacao-job,lgpd}.ts` | 21, 22 | Seções novas | Só acrescentar |
| `src/app/painel/configuracoes/page.tsx` (`CARTOES`) e guia `configuracoes` | 22 (dois cartões) | Cartões e versão do guia | Cartões no fim; a versão sobe uma vez por plano sobre a da `main` no rebase (a spec do 22 já prevê o 23) |
| `src/worker/index.ts`, `src/jobs/queues.ts` | 22 (filas novas de documento) | — | O 23 não mexe |
| `src/email/templates.tsx`, `src/email/types.ts` | 22 (talvez) | Modelos | Só no fim da união |
| `src/modules/notificacoes/tipos.ts` e o CHECK de `notifications.tipo` | 22 (se criar tipo) | Tipos novos | Na regeneração, partir do CHECK da `main` e acrescentar no fim |
| `e2e/painel-rotas.ts`, `scripts/e2e-seed.ts`, `src/modules/ajuda/conteudo.ts` | 21, 22 | Rotas e guias | Só acrescentar; blocos de IP próprios (21 = `10.9.21.x`, 22 = `10.9.22.x`, 23 = `10.9.23.x`) |
| Numeração (US/RN) | 21 (330–369), 22 (370–399) | — | 23 em 400–439 |

**Ordem de merge proposta (a orquestradora decide):** trem da onda 1 como está (… → 18 PR 2 → 20 PR 2 → 20 PR 3 → 19 seed). Na onda 2, os PRs 1 (fundação) de 21, 22 e 23 entram um por vez na fila de migrations, na ordem em que ficarem prontos; os PRs 2 e 3 do 23 esperam o 20 PR 2; o PR 4 do 23 espera o 18 PR 2 e o 20 PR 2. Cada PR faz rebase e roda o CI depois do deploy do anterior.

---

**Componentes compartilhados com o Plano 22 (decisão da orquestradora, 17/11/2026, pedido 4):** os diálogos da T8 (`recusar-dialogo.tsx`) e da T10 (`autorizacao-dialogo.tsx`) usam o `Dialogo` compartilhado de `src/components/dialogo.tsx`, sem cópia. Quem entrar primeiro na `main` (o PR 1 do Plano 22, T2, ou o PR 3 deste plano) cria o componente com a interface da T2 do Plano 22; o outro reaproveita no rebase. O `focarTitulo` continua vindo do 20 PR 2 (`src/app/painel/financeiro/foco.ts`), sem cópia; se for preciso fora do Financeiro, move para `src/components/` no próprio PR, mantendo a exportação antiga como reexportação.

## Decisões

### Decisões da spec que este plano usa

AG-D1 a AG-D45 (spec §14.1), todas. As que mudam a forma das tarefas: AG-D4 (tabela fechada + projeções: T1, T4), AG-D5 (sem backfill de consultas: T1), AG-D6 e AG-D45 (locais iniciais e `garantirLocaisIniciais`: T1, T2), AG-D7 (Perfil: T2), AG-D9 (par de videoconferência, teto 60: T3), AG-D14 (`calendario.ts`, nunca `fuso.ts`: T5), AG-D15 (impressão do navegador: T5), AG-D17 a AG-D24 (pedidos: T6, T7), AG-D19 e AG-D37 (vencimento em `processarNotificacoes`, sem fila nem menu: T6), AG-D29 (seção "Consultas": T9), AG-D30 (sem `auditRead` na leitura: T5, T9, T10), AG-D31 a AG-D35 (aniversário: T10), AG-D38 (PR 1 com a migration e Fase B com portão: "Ordem de entrega", T11), AG-D40 e AG-D41 (agendamento do local e janela de 12 h: T1, T3, T6), AG-D42 a AG-D44 (desistência, vocabulário, `cancelado_por`: T6 a T8).

### Decisões novas deste plano (vão para a spec na T12)

| ID | Decisão | Porquê |
|---|---|---|
| AG-D46 | **O código do Plano 23 roda na Sessão C em `../nutridebby-c`** (porta 3103, banco `nutri_dev_c`), depois de fechada a sessão do Plano 20; o worktree `../nutridebby-23` (só documento) é removido antes, com OK do dono | O `sessao-paralela.sh` só conhece `a`, `b` e `c`, a porta e o banco do §3 são da Sessão C, e o git não deixa o mesmo branch em dois worktrees |
| AG-D47 | **`gerarHorarios` junta horários de mesmo início e fim (união das modalidades), já no PR 1**; a partir da T3, com locais, a junção vale só no mesmo `localId` (AG-D60) | O backfill desdobra "ambas" em duas regras; sem a junção, a imagem do PR 1 (e o portal até o PR 2) recusaria o horário online com "não está mais disponível", porque `escolherHorario` pega o primeiro horário do instante |
| AG-D48 | **Desistência da pessoa nova por `app_pedido_publico_desistir(token_hash, confirmar)`** (`SECURITY DEFINER`, molde §9.1, papel `publico`), com o token do próprio pedido, sem coluna nova | O `publico` não vê a linha aguardando (`aguardando_fora_do_publico`, de propósito) e o papel `worker` não atende requisição da web; o token de 32 bytes já existe e a RN-424a o impede de concluir de novo |
| AG-D49 | **A desistência da pessoa nova também avisa a nutricionista** (evento `pedido_desistido`, "Nova pessoa: {primeiro nome}") | Mesma razão da AG-D42 para o paciente: o horário volta a ficar livre e a fila muda sem a nutricionista ver |
| AG-D50 | **Token do link de saída do aniversário em `src/modules/agenda/aniversario-link.ts`** (puro, HMAC com a finalidade `aniversario_sair`, molde `src/modules/ia/autorizacao-token.ts`) | Separa a credencial do módulo que fala com o banco; só `aniversarios.ts` entra em `SEM_CONTA_PERMITIDOS` |
| AG-D51 | **Pasta `aniversario` em `EXCLUIDAS` da guarda de mesma origem**; a desistência pública em `src/app/api/n/[slug]/pedido/[token]/route.ts` | O POST de um clique (RFC 8058) vem do provedor de e-mail, sem cookie nem origem do site; vale o token, com limite por token. A pasta `n` já é excluída pelo mesmo motivo (página pública sem cookie, limite por IP) |
| AG-D52 | **`src/app/painel/agenda/filtros.tsx` em `GET_PERMITIDOS`** de `formularios-post.test.ts` | A agenda guarda as preferências na URL (RN-411) e funciona sem JS; só datas e ids vão à URL, nenhum dado sensível |
| AG-D53 | **`gravarConsultaDoPaciente` devolve `{ id, status }` lido do `RETURNING` e age pelo status** (lembretes e "consulta marcada" só em `agendada`; aviso "pedido" à nutricionista em `solicitada`) | Quem decide o status é o gatilho, com a chave lida no banco; a aplicação nunca decide sozinha (sem corrida entre ler a chave e gravar) |
| AG-D54 | **Peças `SECURITY DEFINER` e o backfill testados num `describe` novo no fim de `src/db/migrate-owner.test.ts`**; o bloco `P23-BACKFILL` da custom é idempotente | É o único cluster com dono `NOBYPASSRLS` (como em produção) e já re-executa trecho de migration (0110); um container novo pesaria no CI e na VPS |
| AG-D55 | **Guia `configuracoes` sobe uma versão** (o resumo passa a citar os locais de atendimento) | O cartão novo muda o que a tela oferece; o 19 e o 22 também sobem, e cada plano sobe uma vez sobre a versão da `main` no rebase |
| AG-D56 | **Bloco de IP do E2E `10.9.23.x`** (`.1`–`.9` visões, `.10`–`.29` pedidos, `.30`–`.39` aniversário) | Regra da orquestradora (sufixo = número do plano); livre em todos os worktrees em 17/11/2026 |
| AG-D57 | **`ROTULO_STATUS` vai para `src/modules/agenda/status.ts`**; `src/app/painel/agenda/periodo.ts` reexporta | A seção "Consultas" (módulo) só importa módulos puros da lista `IMPORTS_PERMITIDOS`; um rótulo só para o painel, a ficha e a impressão |
| AG-D58 | **`app_pedidos_aguardando` aceita os papéis `publico` e `paciente`**; `nutri` e `worker` leem a tabela direto | O portal confere os aguardando sob a trava do tenant na sessão do paciente antes do INSERT (RN-425); fora desses papéis a função devolve vazio, como as projeções |
| AG-D59 | **A semente do E2E cria e reaproveita três locais** ("Consultório E2E" principal presencial, "Clínica Centro E2E" presencial com agendamento e "Videoconferência E2E" com sala fixa), pelo nome, e nunca os apaga | Consultas com lançamento ficam no banco de dev (Plano 20) e prendem o local pela FK `NO ACTION`; recriar quebraria a semente na segunda execução |
| AG-D60 | **Horário livre com `localId`**: `Horario` e `HorarioVisivel` ganham `localId`; um horário por (início, local) | O portal e a página pública filtram o local no cliente (I-13) e `escolherHorario` confere o par início-local escolhido; o mesmo instante em dois locais são duas ofertas, e o `EXCLUDE` garante uma consulta só |
| AG-D61 | **A retirada da autorização de aniversário pela nutricionista não pede a `forma`**: CHECK `(origem = 'nutri' and (evento = 'retirou' or forma is not null)) or (origem <> 'nutri' and forma is null)` | A forma prova como o paciente **autorizou** (ônus do controlador, art. 8º, § 2º); retirar tem de ser fácil (art. 8º, § 5º). Com o CHECK da spec 0.2, `retirarAutorizacao` cairia em 23514 e o botão do painel nunca funcionaria, e o erro só apareceria depois de a migration estar na `main` |
| AG-D62 | **`app_locais_para_agendamento()` devolve todos os locais ativos** com `principal`, `agendamento_online` e `criado_em`, na ordem principal → `created_at` → `id`; `nome` e `cidade` só dos que aceitam agendamento, `endereco` só com `mostrar_endereco` e agendamento; o recorte por agendamento fica no TS, depois de `regraNoLocal` | A RN-410a precisa do principal e da ordem; sem eles, a regra sem local cairia num local onde a nutricionista não definiu atendimento. A função nasce congelada no PR 1, então tem de sair certa |
| AG-D63 | **`public_booking_requests.resolucao`** (`aceito`, `recusado`, `vencido`, `desistido`, coerente com `resolvido_em`) e `app_pedido_publico_desistir` devolvendo `gravou` e `primeiro_nome` (só na chamada que gravou) | Sem a causa gravada, a função não distingue "já desistiu" de "recusado"; sem `gravou`, cada POST repetido avisaria a nutricionista de novo; sem o nome, a rota (papel `publico`, que não lê a linha) não monta "Nova pessoa: {primeiro nome}" |
| AG-D64 | **A política RESTRICTIVE do aguardando se chama `aguardando_fora_do_publico`** (`USING (app_current_role() is distinct from 'publico' or aguardando_desde is null)`) | `findPublicoViolations` lê toda política `like 'publico%'` e exige, em tabela de `PUBLICO_LIBERADO`, só os `publico_sem_<comando>`; o nome da spec 0.2 quebraria o `rls-guard.test.ts`, e o arquivo é disputado |
| AG-D65 | **Ordem global de travas: e-mail → tenant → paciente → consulta/pedido → notificações**; o portal toma a trava do tenant no começo da transação, antes de `carregarPacienteParaEscrita` | O portal travava paciente → tenant, e a página pública e o aceite da pessoa nova, tenant → paciente (pela FK): ciclo e 40P01, que viraria "horário ocupado" ou 500 |
| AG-D66 | **Portão real do PR 1: a T1 começa quando a orquestradora fechar a Sessão C do Plano 20** (depois do 20 PR 2 e do 20 PR 3) | A AG-D46 põe o código do 23 em `../nutridebby-c`; a frase "não depende do 20 PR 2" valia para o código, não para a sessão. Se a orquestradora quiser antecipar, abre a T1 numa sessão que fechar antes (A ou B), com a porta e o banco dela |
| AG-D67 | **`vencerSolicitacoes` isola erro por pedido** (uma transação por pedido com `try/catch`, log só do código) e a chamada em `processarNotificacoes` fica em `try/catch` próprio | O job de minuto leva todos os lembretes da plataforma; uma linha ruim não pode parar os envios (o mesmo padrão do Plano 17 T4) |
| AG-D68 | **Runbook `docs/operacao/agenda-2.md` desde o PR 1**, com a seção "Volta atrás" na descrição de cada PR; nunca voltar para imagem anterior ao PR 1 | A imagem anterior ao PR 1 gera dois horários no mesmo instante sobre as regras desdobradas; o `moverConsulta` anterior ao PR 2 cai em 23503 ao trocar a modalidade de consulta com local; o Perfil anterior ao PR 2 volta a editar um link já desatualizado |
| AG-D69 | **T1 e T6 em subtarefas** (T1a/T1b/T1c; T6a/T6b), sem mudar os PRs | Grandes demais para um ciclo de revisão e correção por subagente; o `revisor-rls` recebe uma peça por vez |
| AG-D70 | **A desistência do paciente é só `desistirDoPedido`**; `cancelarConsulta` continua recusando `solicitada` (`naoCancelavel`) | Um caminho só para a mesma transição: a action do portal e o teste ficam sem ambiguidade |
| AG-D71 | **Cabeçalhos em `next.config.ts`**: `no-referrer` + `no-store` nos links com token novos (pedido da pessoa nova e saída do aniversário, página e rota) e `no-store` na impressão | Mesmo tratamento de todo link com token do projeto (`next.config.ts:15-23`); o `Cache-Control` da impressão (RNF-406) não sai de um `page.tsx` |
| AG-D72 | **Abas da agenda sem link para página que ainda não existe**: no PR 2, só Agenda · Pendências · Horários · Locais; a T8 liga Solicitações e a T10, Aniversariantes | O deploy do PR 2 levaria um link 404 para produção |
| AG-D73 | **Filtro "Previsões de retorno" e item "Retorno previsto" da legenda atrás de `MARCADOR_RETORNO_LIGADO`**, desligado no PR 2 e ligado na T9 | No PR 2 não há onde preencher a previsão; o filtro iria a produção sempre vazio |
| AG-D74 | **Título da seção "Consultas" em `TITULO_SECAO_CONSULTAS` (`src/modules/agenda/status.ts`)**, não em `MSG_FICHA.titulos` | `registro.test.ts:56` exige que os títulos sejam exatamente os 8 do Plano 18; `status.ts` já entra em `IMPORTS_PERMITIDOS` |
| AG-D75 | **Aviso de pedido não confirmado fora do horário silencioso** (decisão da orquestradora, 23/11/2026): o `pedido_nao_confirmado` ao paciente (e-mail e push) e o e-mail `pedido_nao_confirmado_publico` à pessoa nova, quando o vencimento ou a recusa cair entre 21h e 8h no fuso do consultório, saem às 08:00 locais (`emHorarioSilencioso`/`fimDoSilencio`, molde de `conteudo/aviso.ts`), como os lembretes (RN-05) | O vencimento roda a qualquer hora (`inicio − antecedência`: consulta às 15h com 12 h de antecedência vence às 03h); a revisão de normas da T6 (M3) apontou o aviso de madrugada | RN-427, RN-428, RN-05 |

---

## Revisão do plano (17/11/2026)

Verificador cético sobre 50 achados (18 da lente `revisor-rls`, P23-PL-RLS-01 a -18, e 32 do crítico do plano, P23-PL-01 a -32), cada um conferido no código da `main` 6c3ee8f e nos worktrees da onda 1 (`nutridebby-18` e4dc52b, `nutridebby-b` a7978a6, `nutridebby-c` c9ade41). Nenhum rejeitado; quatro duplicados juntados (RLS-01 = PL-04, RLS-03 + PL-02, RLS-04 + PL-03, RLS-05 = PL-12) e um aplicado em parte (PL-02: a projeção devolve todos os ativos, como pede o RLS-03, e `LocalDaGeracao` mantém `agendamentoOnline`). Uma linha por mudança:

| Achado | Mudança |
|---|---|
| PL-01 (crítico) | Política renomeada para `aguardando_fora_do_publico` em todo o plano e na spec; teste `findPublicoViolations()` sem violação (AG-D64) |
| PL-02 (crítico, em parte), RLS-03 | `app_locais_para_agendamento()` devolve todos os ativos com `principal`, `agendamento_online`, `criado_em` e a ordem; recorte no TS depois de `regraNoLocal`; `LocalProjetado` e testes (T1, T2, T3; AG-D62) |
| PL-03 (crítico), RLS-04 | Coluna `resolucao`; `app_pedido_publico_desistir` devolve `gravou` e `primeiro_nome`; a rota avisa só com `gravou`; teste do segundo POST (T1, T7; AG-D63) |
| RLS-01, PL-04 | Fábrica de `aniversario_autorizacoes` com `'retirou'` e `coalesce`; gatilho recusa só na sessão `nutri`, no `worker` e no titular visível não ativo; `publico` → 42501 da RLS (T1) |
| RLS-02 | CHECK da `forma` aceita a retirada da nutricionista sem forma; testes (T1, T10; AG-D61) |
| RLS-05, PL-12 | Trava do tenant no começo de `agendarComoPaciente`/`remarcarComoPaciente`; ordem global nas Global Constraints; teste de corrida sem 40P01 (T6; AG-D65) |
| RLS-06 | `exportacao-job.ts` ganha `atendimentos[].retornoPrevistoEm` na T9, com teste; frase da spec §9.6 e RN-438 corrigidas agora |
| RLS-07, PL-19 (2ª parte) | `vencerSolicitacoes` com transação e `try/catch` por pedido e `try/catch` na chamada; teste "lembrete de outro tenant continua saindo" (T6; AG-D67) |
| RLS-08 | `appointments_link_da_sala` copia a sala em qualquer papel; só a recusa é do `paciente`/`publico`; testes no `nutri` e no aceite online (T1, T7) |
| RLS-09 | `appointments` fora de `IMUTAVEIS` (plano e spec §9.2/§9.10) |
| RLS-10 | Exportação: `consultas[].local` (não `agenda`) na T4 e na RN-438 |
| RLS-11 | Envio do aniversário: a trava é só a da FK; a garantia é a reconferência da RN-431 (T10) |
| RLS-12 | Testes "paciente com conta + origem `link`" e "P2 + `app` + `patient_id` de P1" → 42501 da RLS (T1) |
| RLS-13, PL-32 | Runbook criado na T1 e completado nas T5 e T8; "Volta atrás" na descrição de cada PR; nunca antes do PR 1; teste de `moverConsulta` trocando a modalidade (T3; AG-D68) |
| RLS-14 | `pedido_vencido` só com o prazo vencido, conferido no gatilho; teste (T1) |
| RLS-15, PL-24 | `app_pedido_aguardar`: `invalido` para local sem agendamento e `verificado_em` vencido; grava `modalidade` = tipo do local; testes (T1) |
| RLS-16 | `src/db/migrate-owner.test.ts` (19) na tabela de coordenação |
| RLS-17 | Teste "editar a data com previsão fora da faixa → mensagem" (T1, T9) |
| RLS-18 | Nome da nutricionista = `nome_profissional` ou `nome_exibicao`, nunca `user` (T10) |
| PL-05 | Título "Consultas" em `TITULO_SECAO_CONSULTAS` (`status.ts`); `textos.ts` fora; coordenação com o 18 PR 2 (T9; AG-D74) |
| PL-06 | `padrao` do guia `agenda` ampliado na T2 (`locais`), T8 (`solicitacoes`) e T10 (`aniversariantes`); `conteudo.test.ts` no Step 4 delas; T12 só a versão |
| PL-07 | Guarda de status restrita a status de consulta, com `ne/eq/inArray/notInArray(appointments.status` e SQL cru; exceções por arquivo com contagem; controle positivo (T6a) |
| PL-08 | Testes do Perfil em `src/app/painel/actions.test.ts` e `marca.test.ts` (não em `configuracoes/actions.test.ts`); coordenação com o 20 PR 2 (T2) |
| PL-09 | Abas sem link morto no PR 2; T8 e T10 ligam as delas; Pendências e Horários nos Files da T2 (AG-D72) |
| PL-10 | `garantirLocaisIniciais` ligada em `lerInicio`, `listarRegras`, `listarLocais`, Nova consulta (T3) e `agendaDoPeriodo` (T5), com testes |
| PL-11 | Junção da AG-D47 só no mesmo `localId` a partir da T3; `escolherHorario` filtra por início **e** local; testes reescritos (T3, T4) |
| PL-13 | `next.config.ts` com `no-referrer` + `no-store` nos tokens e `no-store` na impressão (T5, T7, T10; AG-D71) |
| PL-14 | Teto da página pública com `STATUS_OCUPA` em `gravarPedido`; teste (T7) |
| PL-15 | `local_id` nulo passa intacto pelo gatilho (`RETURN NEW` antes da troca); teste da imagem do PR 1 (T1) |
| PL-16 | Portão real do PR 1 na "Ordem de entrega" (AG-D66) |
| PL-17 | T1 em T1a/T1b/T1c e T6 em T6a/T6b, mesmos PRs (AG-D69) |
| PL-18 | `ContextoEnvio.local?` em `enviar.ts`; `dadosDaConsulta` com o endereço do local (T4) |
| PL-19 | Global Constraint do grafo de imports |
| PL-20 | `sqlEhRetorno` em `status.ts` e `tiposDasConsultas` em `visoes.ts` (T5), usados pelas T6, T8 e T9 |
| PL-21 | `urlWhatsappAniversario` só em `aniversariantes/whatsapp.ts` (T10) |
| PL-22 | Desistência só por `desistirDoPedido`; `cancelarConsulta` recusa `solicitada` (T6; AG-D70) |
| PL-23 | Testes das métricas (`metricas.test.ts` e `metricas-sucesso.test.ts`) na T1, junto com o `CREATE OR REPLACE` |
| PL-25 | `publico-guarda.test.ts` por AST, com controle positivo (T4) |
| PL-26 | `periodo.ts` reexporta `Visao`, `lerVisao` e `periodoDaVisao` de `calendario.ts`; `periodo.test.ts` na assinatura nova (T5) |
| PL-27 | `agendarComoPaciente` → `{ id, status }`; `TenantAgenda` + `agendaConfirmarPedidos` (T6) |
| PL-28 | Filtro e legenda de retorno atrás de `MARCADOR_RETORNO_LIGADO` até a T9 (AG-D73) |
| PL-29 | Sem `src/app/painel/agenda/foco.ts`: `focarTitulo(['titulo-agenda'])` do 20 PR 2 (T8) |
| PL-30 | Coordenação: `formularios-post.test.ts`, `painel/actions.test.ts`, `test/carga/*`; T5 ganha `test/carga/{seed.ts,cenario.js}` |
| PL-31 | Testes de US-407 (T8), "Aniversariantes de hoje (2)" e ações do Perfil do portal (T10); `migrate-owner.test.ts` acha a custom por sufixo (T1) |

**Spec mudada nesta revisão** (`docs/superpowers/specs/2026-11-17-nutridebby-23-agenda-2-design.md`, v0.3): nome da política (AG-D64) em todas as menções; §9.1 (projeção de locais e gatilho da sala); §9.2 e §9.10 (`appointments` fora de `IMUTAVEIS`; prazo do `pedido_vencido`); §9.4 (`resolucao`, `app_pedido_aguardar`, `app_pedido_publico_desistir`); §9.6 (a exportação lista colunas); §9.7 (CHECK da `forma` e papéis do gatilho); RN-410a, RN-422, RN-425, RN-433 e RN-438; §18.1 com o resumo. As decisões AG-D46 a AG-D74 continuam indo para a §14 da spec no fechamento (T12).
