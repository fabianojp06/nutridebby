# Plano 25 — Mensagens e recados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a nutricionista conversa com cada paciente por mensagens, no painel (`/painel/mensagens`) e no app (`/p/mensagens`), depois de liberar a conversa com o registro do TCLE de telenutrição; vê "Todas" e "Não lidas", o contador no menu e o selo "Sinal de risco"; troca texto e um anexo por mensagem (imagem sem metadados ou PDF dela; foto do paciente); define o horário de atendimento por mensagens; responde pela conversa a dúvida que a IA Nutri encaminhou; e envia recados a vários pacientes (todos com app, por etiqueta e, com o Plano 23 na `main`, por local) — com avisos sem conteúdo, cada registro dela identificado com nome e CRN, nada do chat na IA, no WhatsApp ou em log, e a conversa guardada como prontuário até a anonimização.

**Architecture:** seis tabelas novas (`chat_conversas`, `chat_mensagens`, `chat_leituras`, `chat_configuracoes`, `chat_horarios`, `recados`) numa migration gerada e numa custom `rls_mensagens`, só no PR 1. Escrita do paciente por `PACIENTE_ESCREVE` com políticas RESTRICTIVE próprias (`paciente_chat_envio`, `paciente_leitura_propria_*`) e a `paciente_com_conta` em todas as `chat_*`; quatro gatilhos (`chat_conversas_regras`, `chat_mensagens_regras`, `chat_leituras_regras`, `recados_regras`) que fixam autoria, relógio (`clock_timestamp()`), carimbo profissional (`tenants.nome_profissional`, `tenants.crn`) e as transições do anexo, e que devolvem `NEW` no que a RLS já recusa; três funções `SECURITY DEFINER` (`app_chat_soltar_anexo`, `app_chat_aviso_nutri_devido`, `app_chat_apagar_do_titular`). Módulo novo `src/modules/mensagens/` (constantes, caixa, conversa, envio, avisos, horário, recados, anexos, job, varredura, lgpd). Sem tempo real: consulta de "há novas?" (só contagem) a cada 15 s na conversa e de 60 s para o contador do menu; o conteúdo vem sempre pelo render do servidor, com `auditRead`. Marcador de leitura e cursores pelo id da mensagem, resolvidos no SQL. Avisos pelo caminho de `notifications` existente (tipos `chat_mensagem` e `recado`, motivo `mensagem_lida`) e pelo `avisarNutri`. Anexos pela regra 9, com a fila `chat-anexo` no molde do diário.

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas, layouts, Server Actions, Route Handlers e `Link`/prefetch) · Drizzle · PostgreSQL 16 (RLS) · Better Auth · pg-boss · Serwist (service worker do portal) · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-nutridebby-25-chat-recados-design.md` **v0.3** (v0.2 = painel de revisão, §17.1–17.2 da spec; v0.3 = revisão deste plano, §17.3 da spec e "Revisão do plano" no fim deste arquivo; decisões CH-D1 a CH-D48 na spec, CH-D49 a CH-D69 aqui). Backlog Paridade Dietbox, onda 3: PD-90 e PD-91. Plano conferido contra o código da `main` 07756c4 e contra os worktrees dos Planos 19 (`nutridebby-b`, 67b21d3), 20 PR 2 (`origin/plano-20-financeiro`), 21 (`nutridebby-21`, 1dab109), 22 (`nutridebby-22`, 0d1ab95), 23 (`nutridebby-c`, f660f60) e 26 (spec em `nutridebby-26`) em 17/11/2026: ver "Conferência do plano contra o código" no fim. As decisões novas deste plano continuam a numeração da spec (CH-D49 em diante) e vão para a spec no fechamento (T12).

## Ambiente da sessão

| Item | Valor |
|---|---|
| Worktree | O código roda numa sessão de letra (`a`, `b` ou `c`), a que a orquestradora liberar primeiro na onda 3 (CH-D49). O worktree `../nutridebby-25`, onde a spec e este plano foram escritos, é só de documento: o git não deixa o mesmo branch em dois worktrees, e o `scripts/sessao-paralela.sh` só conhece `a`, `b` e `c` |
| Branch | `plano-25-chat-recados` (spec e plano; base `origin/main` 07756c4). O PR 1 sai de um branch próprio, `plano-25-fundacao`, criado a partir dele (ver "Ordem de entrega") |
| Porta e banco | Os da letra (`sessoes-paralelas.md` §3: A = 3101/`nutri_dev_a`, B = 3102/`nutri_dev_b`, C = 3103/`nutri_dev_c`); `pnpm exec next dev -p 310x`, nunca `pnpm dev` |
| Preparar | Com OK do dono (é apagar, mesmo em dev), do worktree principal: fechar a sessão anterior da letra (§4, "Fechar a sessão"); `git worktree remove ../nutridebby-25` (árvore limpa e commitada; o branch fica); `scripts/sessao-paralela.sh <letra> plano-25-chat-recados` (worktree, `.env.local`, banco, `pnpm install --frozen-lockfile`, `pnpm db:migrate`) |
| Variáveis | Nenhuma `DATABASE_URL`, `DATABASE_URL_MIGRATOR`, `APP_URL` ou `DATA_DIR` exportada no shell; conferir só os nomes: `env \| cut -d= -f1 \| grep -E '^(DATABASE_URL\|APP_URL\|DATA_DIR)'` |
| Olhar o banco | `docker compose -f ../nutridebby/docker-compose.dev.yml exec db psql -U nutri_owner -d nutri_dev_<letra>` (o MCP `postgres-dev` aponta para o banco do principal; **nunca** produção, regra 5) |
| E2E | `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:310x pnpm test:e2e <spec>` (a `APP_URL` só nesse comando); parar o `pnpm worker` da sessão antes; **um E2E de cada vez entre as sessões** (Mailpit único). Bloco de IP do Plano 25: **`10.9.25.x`** (sufixo = número do plano; livre em 17/11/2026 em todos os worktrees; CH-D50) |
| Vitest | `pnpm vitest run <arquivos>` sobe o próprio Postgres (Testcontainers); escalonar com as outras sessões |

Proibido nesta sessão: tocar produção (nem leitura), `docker service update`, push, merge, editar outros worktrees, `nutri-backup.sh`, subagente consultando banco de produção, snapshot da Hostinger (congela a VPS).

## Global Constraints

- Regras 1, 2, 3, 7, 8 e 9 do `CLAUDE.md`. Toda consulta a tabela com `tenant_id` por `withTenant(ctx, fn)`; o admin nunca consulta; as funções do painel conferem `ctx.role === 'nutri'` e lançam `Error('mensagens: só a sessão nutri')` **antes** de abrir a transação; as do portal, `sessaoDePacienteComConta(ctx)` (`src/db/tenant.ts:80`); `ctx` com `actorUserId` e `ip` (RN-440).
- **Migrations:** uma gerada (`pnpm db:generate --name mensagens`, sem edição à mão) e uma custom (`pnpm drizzle-kit generate --custom --name rls_mensagens`), **só no PR 1**, com `DATABASE_URL_MIGRATOR` (regra 7). Número = o que o `db:generate` der em cima da `main` do momento; **nada reservado** (a última na `main` é a 0125; 19, 21, 22 e 23 têm migrations no branch). Antes de abrir o PR 1 (e de novo se outro PR com migration entrar antes), `docs/operacao/sessoes-paralelas.md` §5, passos 1 a 8: guardar a custom, rebase em `origin/main`, apagar as duas e voltar o journal ao da `main`, gerar de novo, recriar a custom colando o SQL guardado **e trocando os CHECKs de `notifications.tipo`, `stored_files.tipo` e `ia_nutri_mensagens.resolucao` e a política `paciente_arquivo_insert` pelos da `main` do momento** (o 21 acrescenta tipos de arquivo, o 23 tipos de notificação), conferir encadeamento (`idx`, `prevId`, `pnpm drizzle-kit check`, `grep -rn "<número antigo>" src test docs CLAUDE.md`), recriar o banco da sessão (com OK do dono) e rodar `pnpm vitest run src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/migrate.test.ts src/db/migrate-owner.test.ts src/modules/mensagens/banco.test.ts`. As funções `SECURITY DEFINER` são provadas em `src/db/migrate-owner.test.ts`, o único cluster com dono sem superusuário, como em produção (CH-D51).
- **Expansão, nunca contração** (§9.9 da spec): só tabelas novas e CHECKs ampliados; a imagem anterior roda sobre o banco do PR 1. Runbook de volta atrás em `docs/operacao/mensagens.md`, criado na T1 e completado nas T5, T8 e T10 (CH-D52). Regra fixa: depois que a conversa estiver em uso, voltar para a imagem anterior ao PR 2 tem os efeitos da §9.9 da spec (nada apaga nem expõe dado; a rede de limpeza recolhe ao voltar).
- **Privacidade (regra 3, RN-470):** texto de mensagem, `anexo_nome`, texto do recado, caminho de arquivo, nome de paciente e e-mail nunca em log, Sentry ou mensagem de erro; erro loga só `nomeDoErro`, `sqlstate` e ids. Guarda de grep em `src/modules/mensagens/guardas.test.ts` (T3) sobre `src/modules/mensagens`, `src/app/**/mensagens/**` e `src/app/api/**/mensagens/**`.
- **Corpos fixos nos avisos** (CS-440): push e e-mail ao paciente e e-mail à nutricionista com texto fixo, sem nome de paciente (no e-mail à nutricionista), sem texto, sem nome de anexo; nenhuma coluna de conteúdo em `notifications`.
- **Leituras:** `auditRead` na abertura da conversa (painel e portal) e no download de anexo; **sem** `auditRead` na caixa, no contador, na situação, na seção da ficha e na lista de recados (RN-453). Escritas pelo gatilho (`chat`, `chat_conversa` fora da tela) e os atos de liberar, pausar e retomar por `recordAudit` (`chat_liberacao`, `chat_pausa`, `chat_retomada`; CH-D39).
- **Marcador e cursores pelo id da mensagem** (CH-D40): nenhum `Date` do JS vira filtro de `criada_em`; o cursor `?antes=`/`depois=` é um id resolvido no SQL; `lida_ate` vem de `select criada_em … where id = $ultima`. Teste de regressão com duas mensagens no mesmo milissegundo (T3).
- **Ids vindos da URL** (v0.3): todo id de mensagem recebido do cliente (`antes`, `depois`, a última mostrada no `marcarLida`, o `mensagemId` do download) é resolvido com `tenant_id` **e** `patient_id` da conversa aberta (no portal, o da sessão); id de outra conversa → lista vazia, contagem 0, marcador parado ou 404. O `auditRead` grava o `patient_id` **da linha lida**, nunca o da URL.
- **Carimbo profissional** (RN-475, CH-D37): toda mensagem e todo recado da nutricionista gravam `autor_nome`/`autor_crn` pelo gatilho; sem carimbo, liberar, enviar e recado são recusados (módulo antes, gatilho como rede). Nada lê a tabela `user` para isso.
- **Links com efeito de leitura** com `prefetch={false}` e `/p/mensagens` fora do cache do service worker (RN-473, CH-D46). Teste por arquivo (T6, T7).
- **Nada do chat na IA** (RN-469): `src/modules/ia/**` não importa `src/modules/mensagens` nem cita `chat_mensagens`/`recados`; `src/modules/mensagens` importa de `src/modules/ia` só `nutri-paciente/sinais-risco.ts` e `nutri-paciente/duvidas.ts`; `src/modules/ia/campos-enviados.test.ts` continua verde sem mudança.
- **Nada novo por WhatsApp:** nenhum tipo entra em `CONTA_COTA` (`src/modules/notificacoes/whatsapp/cota.ts`); `textoWhatsapp` devolve `null` para `chat_mensagem` e `recado`.
- **Grafo de imports:** sharp/HEIC e `anexo-job.ts`/`varredura.ts` só no worker (guardas de `exportacao.test.ts` e `push.test.ts`, estendidas na T8); nenhuma rota importa `notificacoes/enviar.ts` ou `push.ts`.
- **Texto como texto** (RNF-444): nenhum `dangerouslySetInnerHTML`, nenhum link automático (CH-D34); guarda de grep em `guardas.test.ts`.
- **Ordem global de travas** (RN-447 v0.3): trava de classe do consultório (`pg_advisory_xact_lock(hashtext('recados-tenant' | 'chat-anexos-tenant'), hashtext(tenantId))`, como **primeiro comando da transação que grava** — no anexo, o primeiro do `antesDaReserva` de `salvarArquivo`, nunca numa transação à parte) → paciente (`FOR UPDATE` no envio do paciente, na pausa, na retomada e no passo (1) da anonimização; `FOR SHARE` no envio da nutricionista, na liberação e no job) → conversa (`FOR NO KEY UPDATE`: serializa com a pausa sem bloquear o `FOR KEY SHARE` da FK no INSERT do paciente e no marcador de leitura) → mensagem → `ia_nutri_mensagens` → `notifications`. Sem 40P01 nos testes de corrida (T3, T9, T10).
- **Datas** no fuso do consultório (`tenants.fuso`): "Hoje"/"Ontem", hora da mensagem, horário de atendimento, horário silencioso (21h–8h) e teto diário de recados; helpers de `src/modules/pacientes/datas.ts` (`hojeNoFuso`) e de `src/modules/agenda/fuso.ts` (só usar, não editar).
- **Textos** em pt-BR, **exatos** da spec §6.2, em `MSG_MENSAGENS`, `MSG_RECADOS`, `MSG_PORTAL_MENSAGENS` (`src/modules/mensagens/constantes.ts`). `src/modules/mensagens` entra em `TSX_FORA` de `src/modules/ajuda/conteudo.test.ts` (T6a), para os rótulos citados pelos guias.
- **Componentes:** diálogos pelo `Dialogo` compartilhado de `src/components/dialogo.tsx` (interface do Plano 22 T2); se ainda não estiver na `main` quando a T6b começar, a T6b o cria com essa interface (ver "Coordenação"). Nunca `window.confirm` (`ConfirmarBotao`) para liberar ou pausar.
- **Arquivos disputados** (`sessoes-paralelas.md` §6) — **só acrescentar**, no fim da lista, do objeto ou do bloco, no formato que a `main` tiver no rebase: `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md`, `src/db/schema/{agenda,platform,ia-nutri,index}.ts`, `src/modules/notificacoes/{tipos,mensagens,enviar}.ts`, `src/email/{types.ts,templates.tsx}`, `src/modules/plataforma/{armazenamento,audit}.ts`, `src/modules/pacientes/{lgpd,exportacao-job}.ts`, `src/jobs/queues.ts`, `src/worker/index.ts`, `src/app/painel/{navegacao.ts,navegacao.test.ts,layout.tsx,cabecalho.tsx}`, `src/app/painel/configuracoes/page.tsx` (`CARTOES`), `src/modules/ficha/secoes/index.ts`, `src/modules/ajuda/{conteudo,portal}.ts` (e testes), `e2e/painel-rotas.ts`, `e2e/acessibilidade*.spec.ts`, `scripts/e2e-seed.ts`, `src/db/migrate-owner.test.ts`, `docs/manual-tecnico/`, `.claude/agent-memory/**`, índice dos planos e backlog. Em `SO_APAGA.patients`, o filtro novo é uma linha `and not exists …` no fim da expressão. **Exceção avisada (v0.3, CH-D58):** o corpo do `beforeAll` de `test/isolamento.test.ts` muda (aceitar fábrica de `paciente`, com `patientId` e ator) — não é só acréscimo; a sessão avisa a orquestradora para o §6 de `sessoes-paralelas.md` antes do PR 1, e no rebase fica com o corpo da `main` e reaplica só essa troca.
- **`CLAUDE.md` no rebase:** cada regra é uma linha física. Ficar com a linha da `main` e reacrescentar só as frases "Plano 25" no fim das regras 1, 2, 8 e 9; conferir `grep -c "Plano 2[0-9]" CLAUDE.md` antes e depois (não pode cair).
- **Plano 26:** nenhuma tabela, rota, item de menu ou tipo de notificação do 25 é liberado à recepcionista; o 26 nega por padrão (RN-505, RN-507 e PM-R13 da spec do 26). Se o 26 entrar antes, a tarefa que cria a tela ou o item de menu acrescenta o filtro por papel no mesmo PR (T6, T7). **As três guardas do 26 (CH-D65)**, se ele estiver na `main` no rebase: (a) `FUNCOES_COM_PAPEL`/`findPapelEmFuncoesViolations` (RN-511) — T1b e T1c acrescentam os quatro gatilhos com "não se aplica" (tabelas negadas à recepção; a `recepcao` está na lista fechada que devolve `NEW`) e as três funções `SECURITY DEFINER` com "recusa"; (b) o teste de `TIPOS_DA_AGENDA` contra o CHECK `notifications_tipo_valido` (RN-507) — a T1a registra `chat_mensagem` e `recado` como fora da agenda; (c) o teste de fonte das rotas (RN-513) — toda `page.tsx`, `route.ts` e action exportada nova de `src/app/painel/**` e `src/app/api/painel/**` chama `requireNutri`/`requireApiNutri` (T6a, T6b, T6c, T8a, T9, T10), com o teste do 26 verde. Se o 25 entrar antes, nada a fazer aqui: o 26 acrescenta.

## Review Focus

1. **RLS e isolamento** — `paciente_chat_envio` (com a amarra do ponteiro ao `stored_files` do mesmo paciente), `paciente_leitura_propria_*`, `paciente_com_conta`, `staff_only` de `recados`, `paciente_arquivo_insert` refeita; os gatilhos devolvendo `NEW` no que a RLS já recusa — inclusive a sessão de paciente em `chat_conversas` e `recados` e a lista fechada `publico`/`conta`/`recepcao`, com falha fechada para papel desconhecido (CH-D38, CH-D57) —, para os negativos genéricos de `test/isolamento.test.ts` provarem a política da própria tabela; `chat_mensagens` e `recados` em `SO_INSERE`; `chat_conversas` e `chat_leituras` em `SEM_DELETE_DO_PACIENTE`; a fábrica de `chat_leituras` pela sessão de paciente (CH-D58); os caminhos do anexo fixos e amarrados ao `stored_files` do mesmo paciente e tipo para todos os papéis (CH-D60). Testes na T1.
2. **Peças `SECURITY DEFINER` com dono `NOBYPASSRLS`** — `app_chat_aviso_nutri_devido` (cria a linha, troca de papel, contexto restaurado), `app_chat_soltar_anexo` (ponteiro igual, original só fora de `processando`, `anexo_path` só sem original — CH-D59 —, `removido`, marcador zerado antes de cada `RETURN`) e `app_chat_apagar_do_titular` (`anonimizar_apos` vencido, `FOR UPDATE`, anonimizado aceito, recusa com anexo apontado). Provadas em `src/db/migrate-owner.test.ts` (T1c).
3. **Anonimização e volta atrás** — anexo `pronto`, `pronto` com o original sobrando e `processando` na anonimização (CH-D41, CH-D59: originais antes dos `anexo_path`), rede de limpeza dos já anonimizados, reconferência na transação final (RN-466). T5 e T8.
4. **Lida e cursores** — `lida_ate` e `?antes=`/`depois=` pelo id da mensagem; teto `clock_timestamp()`; nada volta como "novo" (CH-D40). T3.
5. **Sigilo dos avisos** — corpos fixos, agrupamento por tipo e `mensagem_lida` comparando com a última mensagem não lida (RN-456, CH-D61), o campo novo de `ContextoEnvio` (CH-D62), `app_chat_aviso_nutri_devido` no padrão ligado e só na sessão de paciente com conta (RN-458), horário silencioso também no e-mail. T4.
6. **Concorrência** — envio do paciente × pausa; resposta pela conversa × "Marcar como vista"; recado × envio individual; 100 anexos por dia × duas nutricionistas; job × anonimização. T3, T8, T9, T10.
7. **Identificação profissional e telenutrição** — carimbo em cada linha, liberação sem a forma verbal, textos do diálogo, ajuda do anexo e do recado (CFN). T2, T6, T10.
8. **Interface** — região viva sempre montada, foco nos retornos, campos controlados, 400 px, dois temas, offline e prefetch. T6, T7.

## Ordem de entrega

| PR | Tarefas | Quando | Por quê |
|---|---|---|---|
| **PR 1 — fundação** | T1 (T1a, T1b, T1c) | Entra na fila de migrations (uma por vez), depois de todo PR com migration que já estiver nela (19, 21, 22, 23 PR 1 — a ordem é da orquestradora). O código não depende de nenhum outro plano | Tabelas, gatilhos, funções, guardas, listas de isolamento, semente e runbook: o que os PRs seguintes (e os rebases dos outros planos) encontram na `main`. Nada visível |
| **PR 2 — conversa de texto** | T2 a T7 (T6 em T6a, T6b, T6c) | Depois do merge do PR 1 **e** do 20 PR 2 (`navegacao.ts`, `navegacao.test.ts`, `exportacao-job.ts`, `lgpd.ts`, `templates.tsx`, `conteudo.ts`) | Sem migration. Entrega PD-90 sem anexos: liberação, conversa nos dois lados, avisos, horário, caixa, ficha, titular (exportação e anonimização entram **junto** com a conversa, nunca depois). Antes do merge: o perfil do consultório da Debby com nome profissional e CRN (RN-475); textos da Central de Ajuda e do manual do usuário prontos para a publicação (CH-D64) |
| **PR 3 — anexos, dúvida e recados** | T8 (T8a, T8b), T9, T10 | Depois do merge do PR 2 | Sem migration (os tipos e as políticas já vieram no PR 1). Entrega o resto do PD-90 e o PD-91 sem a Fase B |
| **PR 4 — Fase B** | T11 | **Portão:** só com o Plano 23 PR 2 (locais, `appointments.local_id`, a função do filtro da RN-436) na `main`; se o 23 atrasar, vira o Plano 25B sem refazer a spec | Recado por local |
| — | T12 | Fecha o plano: depois do PR 4 ou, se a T11 virar o Plano 25B (23 PR 2 atrasado), **depois do PR 3** (CH-D64) | Manuais (conferência final), backlog, runbook, carga, CS-445 |

O fechamento de cada PR (axe das rotas novas, `ROTAS_DO_PAINEL`, manual técnico do que mudou, seção "Volta atrás" na descrição do PR) é o passo final da última tarefa do PR; a T12 só fecha o plano.

**Central de Ajuda e manual do usuário por PR (CH-D64).** A conversa e o menu "Mensagens" vão a produção no PR 2: a Debby e os pacientes não podem ficar sem artigo, e os artigos e abas que citam "Dúvidas dos pacientes" e "Marcar como vista" ficariam errados desde esse deploy. No fechamento do PR 2 (T7) e do PR 3 (T10), o `guardiao-manual` prepara os textos em `../.sessoes/plano25-ajuda-pr<n>.md` (artigos novos e trechos trocados da Central de Ajuda; abas do manual do usuário no Docs); a **orquestradora publica** (artefato da Central de Ajuda e o Docs do manual) logo depois do merge, como nos Planos 17 e 18. Conteúdo: PR 2 — conversa, liberação, pausa, horário, menu "Mensagens", aba "Dúvidas da IA Nutri"; PR 3 — anexos, "Responder na conversa", recados (e o local, no PR 4).

**Branch do PR 2 depois do merge do PR 1.** O §5 regenera as migrations no `plano-25-fundacao`; o `plano-25-chat-recados` continua com os commits velhos da T1. Depois do merge do PR 1:

```bash
git fetch origin
git rebase --onto origin/main <último commit da T1> plano-25-chat-recados   # descarta os commits da T1, já na main
git diff origin/main -- drizzle/                                          # tem de sair vazio
```

Depois, recriar o banco da sessão do zero (§5, passo 7, **com OK do dono**).

Merge sempre com OK do dono (merge = deploy; a migration do PR 1 roda no boot); nunca das 03h às 07h30 BRT; **sem snapshot da Hostinger**: migration só aditiva e o backup restic diário.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/db/schema/mensagens.ts` (novo) + `schema/index.ts` (exporta) | As seis tabelas, as listas de valores (`AUTORES_CHAT`, `STATUS_ANEXO`, `TIPOS_ANEXO`, `FORMAS_TCLE`, `LADOS_LEITURA`, `RISCOS_CHAT`, `TIPOS_FILTRO_RECADO`) e os tipos inferidos |
| `src/db/schema/{agenda,platform,ia-nutri}.ts` (só acrescentar) | CHECKs ampliados de `notifications.tipo`, `stored_files.tipo` e `ia_nutri_mensagens.resolucao` |
| `drizzle/<NNNN>_mensagens.sql` (gerada) + `drizzle/<NNNN+1>_rls_mensagens.sql` (custom) | Tabelas; RLS, políticas, gatilhos, funções, auditoria, `REVOKE`/`GRANT`, `EXCLUDE` |
| `src/modules/mensagens/constantes.ts` (novo, puro) | Textos, limites, `RISCO_DO_TEXTO_FIXO`, rótulos, `rotuloDoQuando` |
| `src/modules/mensagens/horario.ts` (novo) | `chat_configuracoes`/`chat_horarios`; `dentroDoHorario`, `resumoDoHorario` (puros) |
| `src/modules/mensagens/conversa.ts` (novo) | Liberar, pausar, retomar; `conversaNoPainel`, `minhaConversa`, `situacao`, marcador |
| `src/modules/mensagens/caixa.ts` (novo) | `caixaDeMensagens`, `contadorDeMensagens`, `pacientesParaNovaConversa` (CH-D66) |
| `src/modules/mensagens/envio.ts` (novo) | `enviarComoNutri`, `enviarComoPaciente`, `responderDuvidaPelaConversa` (T9) |
| `src/modules/mensagens/avisos.ts` (novo) | `avisarPaciente`, `avisarNutriDeMensagem`; o silêncio por `emHorarioSilencioso`/`fimDoSilencio` de `notificacoes/agendar.ts` (sem helper novo, CH-D61) |
| `src/modules/mensagens/anexos.ts` (novo, T8) | `salvarAnexoDaNutri`, `salvarFotoDoPaciente`, `caminhoDoAnexo` |
| `src/modules/mensagens/anexo-job.ts`, `varredura.ts` (novos, **só worker**, T8) | Fila `chat-anexo`; RN-474 |
| `src/modules/mensagens/recados.ts` (novo, T10) | `alcanceDoRecado`, `enviarRecado`, `listarRecados` |
| `src/modules/mensagens/lgpd.ts` (novo) | `mensagensParaExportacao`, `apagarConversaDoTitular`, `anexosDeChatRestantes`, `apagarConversasDosAnonimizados` |
| `src/modules/ficha/secoes/mensagens.ts` (novo) | Seção "Mensagens" do Início |
| Mudam fora do módulo | `notificacoes/{tipos,mensagens,enviar}.ts`, `src/email/{types.ts,templates.tsx}`, `agenda/aviso-nutri.ts` (docstring), `plataforma/{armazenamento,audit}.ts`, `ia/nutri-paciente/{duvidas,conversa,lgpd,constantes}.ts`, `pacientes/{exportacao-job,lgpd}.ts`, `ficha/{tipos,adicionar}.ts`, `ficha/secoes/index.ts`, `ajuda/{conteudo,portal}.ts`, `src/app/sw.ts`, `src/jobs/queues.ts`, `src/worker/index.ts`, `src/components/ui/selo.tsx`, `src/components/portal/faixa.tsx` |
| Telas novas | `src/app/painel/mensagens/{page.tsx,abas.tsx,nova/page.tsx,[patientId]/page.tsx,[patientId]/actions.ts,[patientId]/*.tsx,recados/page.tsx,recados/novo/page.tsx,recados/actions.ts}`, `src/app/painel/configuracoes/mensagens/{page.tsx,actions.ts,horario-form.tsx}`, `src/app/p/(portal)/mensagens/{page.tsx,actions.ts,*.tsx}` |
| Rotas novas | `src/app/api/painel/mensagens/{situacao,contador}/route.ts`, `src/app/api/painel/mensagens/[patientId]/{anexo,anexos/[mensagemId]}/route.ts`, `src/app/api/p/mensagens/{situacao,foto,anexos/[mensagemId]}/route.ts` |
| Telas que mudam | `src/app/painel/{navegacao.ts,layout.tsx,cabecalho.tsx,menu-painel.tsx}`, `src/app/painel/duvidas/**`, `src/app/painel/configuracoes/page.tsx`, `src/app/painel/pacientes/[id]/**` (aba IA Nutri: "Respondida em Mensagens"), `src/app/p/navegacao.ts`, `src/app/p/(portal)/plano/ia/**` |
| Testes novos | `src/modules/mensagens/{banco,horario,conversa,caixa,envio,avisos,anexos,anexo-job,varredura,recados,lgpd,guardas,constantes}.test.ts`, `src/modules/ficha/secoes/mensagens.test.ts`, rotas `route.test.ts`, componentes `situacao.test.tsx` (painel e portal) e `contador-de-mensagens.test.tsx`, `e2e/mensagens.spec.ts` (inclusive o bloco sem JS) |
| Docs | `docs/operacao/mensagens.md` (runbook, desde a T1) |

---

### Task 1: Fundação — schema, migrations, gatilhos, funções, guardas e semente (PR 1)

> **Divisão (CH-D53):** um PR, três subtarefas com o próprio ciclo TDD, commit (`P25-01a`, `-01b`, `-01c`) e revisão do `revisor-rls`. A custom `rls_mensagens` é uma só; cada subtarefa acrescenta o seu trecho na ordem da lista abaixo. **T1a** — schema, gerada, RLS e políticas, CHECKs, `REVOKE`/`GRANT`, listas das guardas, isolamento, `CLAUDE.md`, runbook inicial. **T1b** — os quatro gatilhos. **T1c** — as três funções `SECURITY DEFINER`, `migrate-owner.test.ts` e a semente. A T1a fica verde sozinha (CH-D67): `criada_em`/`criado_em` com `default clock_timestamp()` no esquema e as fábricas de `chat_mensagens` e `recados` gravando o carimbo igual ao do tenant (o gatilho da T1b passa a sobrescrever).

**Files:**
- Create: `src/db/schema/mensagens.ts`; Modify: `src/db/schema/index.ts` (exporta, no fim), `src/db/schema/agenda.ts` (CHECK `notifications_tipo_valido` + `chat_mensagem`, `recado`), `src/db/schema/platform.ts` (CHECK `stored_files_tipo_valido` + `chat_anexo`, `chat_anexo_original`), `src/db/schema/ia-nutri.ts` (CHECK `ia_nutri_mensagens_resolucao` + `respondida`)
- Create: `drizzle/<NNNN>_mensagens.sql` (`pnpm db:generate --name mensagens`), `drizzle/<NNNN+1>_rls_mensagens.sql` (`pnpm drizzle-kit generate --custom --name rls_mensagens`)
- Modify: `src/db/rls-guard.ts` (`STAFF_ONLY` + `recados`; `PACIENTE_ESCREVE` + `chat_mensagens: ['insert']`, `chat_leituras: ['insert', 'update']`, com os motivos da spec §9.8; **se o Plano 26 estiver na `main`**, `FUNCOES_COM_PAPEL` + os quatro gatilhos com "não se aplica" (T1b) e as três funções com "recusa" (T1c), CH-D65), `src/db/audit-guard.ts` (`AUDIT_EXCEPTIONS` + `chat_leituras`, motivo da spec §9.3); **se o 26 estiver na `main`**, o teste de `TIPOS_DA_AGENDA` (RN-507 do 26) com `chat_mensagem` e `recado` registrados como fora da agenda (T1a)
- Modify: `test/isolamento.test.ts` (spec §9.8 v0.3: `FABRICAS` das seis, **nenhuma em `COM_MAE`**, as de `chat_mensagens` e `recados` com o carimbo; `beforeAll` grava `nome_profissional` e `crn` nos tenants A e B **e passa a aceitar fábrica de `paciente`** (`withTenant({ tenantId, role: 'paciente', patientId: p, actorUserId })`: troca no corpo, avisada no §6, CH-D58); `PAPEL_DA_FABRICA` + `chat_leituras: 'paciente'` (a fábrica grava `lado = 'paciente'`); `SO_INSERE` + `recados`, `chat_mensagens`; `SEM_DELETE` e `DELETE_REVOGADO` + `chat_conversas`, `chat_leituras`; **`SEM_DELETE_DO_PACIENTE` + `chat_conversas`, `chat_leituras`** (o teste da P2 roda `delete` sem savepoint; com o `REVOKE DELETE`, a P2 receberia 42501 antes da RLS); `IMUTAVEIS` + `chat_conversas`, `chat_leituras`; `UPDATE_DO_PACIENTE` + `chat_leituras` (`lida_ate = lida_ate`); linha nova em `SO_APAGA.patients`)
- Modify: `src/db/migrate-owner.test.ts` (`describe` novo no fim, que acha a custom por `readdirSync(new URL('../../drizzle/', import.meta.url)).find((f) => f.endsWith('_rls_mensagens.sql'))`, sem número fixo)
- Modify: `scripts/e2e-seed.ts` (tenant próprio do E2E do chat, com carimbo; ver T6), `CLAUDE.md` (frases "Plano 25" no fim das regras 1, 2, 8 e 9: texto da spec §9.8)
- Create: `src/modules/mensagens/banco.test.ts`, `docs/operacao/mensagens.md` (seção "Volta atrás" do PR 1: a imagem anterior ignora as tabelas novas; nada a desfazer)

**Interfaces:**
```ts
export const AUTORES_CHAT = ['nutri', 'paciente'] as const;
export const STATUS_ANEXO = ['sem_anexo', 'processando', 'pronto', 'falhou', 'removido'] as const; // CH-D41
export const TIPOS_ANEXO = ['imagem', 'pdf'] as const;
export const FORMAS_TCLE = ['termo_assinado', 'aceite_escrito'] as const; // CH-D3 (v0.2)
export const LADOS_LEITURA = ['consultorio', 'paciente'] as const;
export const RISCOS_CHAT = ['emergencia', 'sintoma_agudo', 'transtorno_alimentar'] as const;
export const TIPOS_FILTRO_RECADO = ['todos', 'etiquetas', 'local'] as const;
export const chatConversas = pgTable('chat_conversas', { id, tenantId, patientId, liberadaEm, liberadaPor, tcleForma, pausadaEm, pausadaPor, createdAt, updatedAt }, …);
export const chatMensagens = pgTable('chat_mensagens', { id, tenantId, patientId, autor, autorUserId, autorNome, autorCrn, texto, recadoId, duvidaEm, risco, anexoStatus, anexoPath, anexoOriginalPath, anexoTipo, anexoNome, anexoBytes, criadaEm, updatedAt }, …);
export const chatLeituras = pgTable('chat_leituras', { tenantId, patientId, lado, lidaAte, updatedAt }, …);
export const chatConfiguracoes = pgTable('chat_configuracoes', { tenantId, horarioAtivo, avisoEmail, avisoNutriEm, updatedAt });
export const chatHorarios = pgTable('chat_horarios', { id, tenantId, diaSemana, inicioMin, fimMin }, …);
export const recados = pgTable('recados', { id, tenantId, texto, filtro, filtroRotulo, destinatarios, autorNome, autorCrn, criadoPor, criadoEm }, …);
```
- Colunas, CHECKs, índices e FKs exatamente como a spec §9.1–§9.5 (v0.3), com as FKs para `patients` e `chat_conversas` em `ON DELETE NO ACTION` explícito; `UNIQUE (anexo_path)` e `UNIQUE (anexo_original_path)`; CHECK novo `chat_mensagens_sem_anexo_sem_caminho` (`anexo_status <> 'sem_anexo' or (anexo_path is null and anexo_original_path is null)`, CH-D60); `criada_em` e `criado_em` com `default clock_timestamp()` (CH-D67); `liberada_por`, `pausada_por`, `autor_user_id` e `criado_por` `uuid` **sem FK** para `user`.
- O `EXCLUDE USING gist` de `chat_horarios` vai na custom se o Drizzle não o gerar (`btree_gist` já existe, 0051).
- Custom `rls_mensagens`, nesta ordem (molde 0102, 0116/0117 e 0083): `app_enable_tenant_rls` nas seis; `app_enable_patient_rls` em `chat_conversas`, `chat_mensagens`, `chat_leituras`; `app_enable_staff_only('recados')`; `app_enable_audit('chat_conversas', 'chat_conversa')` e `app_enable_audit('chat_mensagens', 'chat')`; `app_allow_paciente_escrita('chat_mensagens', 'insert')` + RESTRICTIVE `paciente_chat_envio` (spec §9.2, inclusive a amarra do ponteiro); `app_allow_paciente_escrita('chat_leituras', 'insert', 'update')` + RESTRICTIVE `paciente_leitura_propria_insert`/`_update`; RESTRICTIVE `paciente_com_conta` (FOR ALL) nas cinco `chat_*`; `paciente_arquivo_insert` refeita com `chat_anexo_original` (partir da definição da `main` no momento do §5); `REVOKE DELETE, TRUNCATE` em `chat_conversas`, `chat_leituras`; `REVOKE UPDATE, DELETE, TRUNCATE` em `chat_mensagens` com `GRANT UPDATE (anexo_status, anexo_path, anexo_original_path, updated_at)` e em `recados`; gatilhos (T1b); funções (T1c), com `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO nutri_app_role`, `SET search_path = public, pg_temp` e nomes com `public.`.
- Gatilhos (T1b), todos BEFORE, `ERRCODE = '42501'`, condições com `coalesce(current_setting(…, true), '')` e `IS DISTINCT FROM`; **cada um devolve `NEW` antes de qualquer leitura sempre que a RLS já recusa aquele papel naquele comando** (CH-D38, CH-D57): (i) `NEW.tenant_id` ≠ `app_current_tenant()`; (ii) sessão de paciente com `NEW.patient_id` ≠ `app_current_patient()`; (iii) os papéis fora de `nutri`, `paciente` e `worker` **que a RLS nega**, numa lista fechada: `publico`, `conta` e `recepcao` (Plano 26, negada por padrão pela RN-505 dele) — **papel desconhecido** (qualquer outro valor de `app.role`) recebe o 42501 do gatilho, falha fechada: `app_current_role()` não valida o valor (`drizzle/0000_base_roles_e_rls.sql:27-28`) e a `tenant_isolation` não olha o papel, então um `NEW` para papel desconhecido deixaria a escrita passar; (iv) **a sessão de paciente nas tabelas em que a RLS a recusa em todo comando**: `chat_conversas` (fora de `PACIENTE_ESCREVE`: `paciente_sem_insert`/`paciente_sem_update`) e `recados` (`staff_only` e `paciente_sem_insert`). Sem (iv), o teste D1 (`FABRICAS.chat_conversas(A, P2)` como P2) e o de `staff_only` (`FABRICAS.recados(A, P2)` como P2) recebem o 42501 do gatilho, com mensagem própria, e `violaRlsDe` (`test/isolamento.test.ts:378-383`) falha — corrigir afrouxando o teste é proibido. Sem papel (migration, semente sem `withTenant`) o gatilho também devolve `NEW` cedo: as colunas de relógio vêm do `default`, e quem grava sem papel preenche o carimbo (o CHECK exige).
  - `chat_conversas_regras` (INSERT OR UPDATE): chaves fixas; INSERT só na sessão `nutri` (liberação ou recado; o `worker` não cria conversa); liberar (`liberada_em` de nulo a não nulo) só na `nutri`, com `liberada_por = app_current_user()`, titular `ativo` sem `anonimizado_em` e carimbo do tenant preenchido; `liberada_em`/`liberada_por`/`tcle_forma` nunca mudam depois de gravados; pausa e retomada só na `nutri`, com `pausada_por = app_current_user()`.
  - `chat_mensagens_regras` (INSERT; UPDATE): spec §9.2 v0.3 (a)–(h) e RN-443/RN-445/RN-462. No INSERT, `criada_em := clock_timestamp()`, `autor` coerente com o papel, `autor_user_id = app_current_user()`, carimbo de `tenants` quando `autor = 'nutri'`, `worker` recusado; mensagem individual exige conversa liberada e não pausada e titular `ativo` sem `anonimizado_em`; cópia de recado exige titular `ativo` sem `anonimizado_em`; `duvida_em` só na `nutri`; **`anexo_path` exige `stored_files` do mesmo tenant e paciente com `tipo = 'chat_anexo'`, e `anexo_original_path` com `tipo = 'chat_anexo_original'`** (CH-D60, para todos os papéis; no paciente, a política também confere). No UPDATE, colunas fixas exceto as quatro do `GRANT`; `processando → pronto | falhou` pelo `worker`; `anexo_path` só vai de nulo a valor em `processando → pronto` (e com a mesma amarra ao `stored_files`); `anexo_original_path` nunca vai de nulo a valor; um caminho não nulo nunca troca por outro (`pronto → pronto` com outro `anexo_path` → 42501); `→ removido` e caminhos a nulo só com `current_setting('app.chat_soltando', true) = 'on'`.
  - `chat_leituras_regras` (INSERT OR UPDATE): chaves fixas; lado × papel conferido **só no INSERT e no UPDATE em que `lida_ate` muda** (CH-D58: o `update … set tenant_id = tenant_id` da `nutri` B, `test/isolamento.test.ts:516`, numa linha `lado = 'paciente'` não pode cair na recusa) — `lado = 'consultorio'` só na `nutri`, `lado = 'paciente'` só na `paciente` com `app_current_user()` não nulo; `lida_ate := greatest(OLD.lida_ate, NEW.lida_ate)` e nunca maior que `clock_timestamp()`.
  - `recados_regras` (INSERT): devolve `NEW` nos casos (i)–(iv) acima (o paciente é recusado pela `staff_only`); o `worker` → 42501; na `nutri`, `criado_por := app_current_user()`, `criado_em := clock_timestamp()`, `autor_nome`/`autor_crn` de `tenants` (42501 sem o carimbo).
- Funções (T1c), spec §9.7 v0.3, molde 0083 (troca de papel com `set_config('app.role','worker',true)`, contexto restaurado antes de cada `RETURN` e no `EXCEPTION`). v0.3: `app_chat_soltar_anexo` recusa o `anexo_path` enquanto houver `anexo_original_path` (mensagem "solte antes o original", CH-D59); `app_chat_aviso_nutri_devido` recusa (42501) fora da sessão de paciente com conta, antes de trocar o papel (RLS Minor 6); `app_chat_apagar_do_titular` compara `anonimizar_apos` com `(now() at time zone tenants.fuso)::date`, nunca `current_date` (como `hojeNoFuso(t.fuso)` em `lgpd.ts:509`).

- [ ] **Step 1: Testes que falham** em `src/modules/mensagens/banco.test.ts` (sessões por `withTenant`; helpers de `test/sessao.ts`, `test/pacientes.ts`, `test/portal.ts`):
  - RLS: paciente com conta lê só a própria conversa, as próprias mensagens e o próprio marcador; não lê `recados` (`staff_only`); `semConta` (contexto `paciente` sem `actorUserId`) não lê nem grava nenhuma `chat_*` (`paciente_com_conta`); `publico` e `conta` nada.
  - `paciente_chat_envio`: P1 com conta envia texto na conversa liberada; recusa com conversa não liberada, pausada, titular arquivado/bloqueado/anonimizado, `autor = 'nutri'`, `autor_user_id` de outro, `recado_id`/`duvida_em`/`anexo_path`/`anexo_nome` preenchidos, `anexo_status = 'pronto'`; `anexo_original_path` de outro paciente ou de outro tipo → recusa; **P2 grava `autor = 'paciente'` com o próprio ator no `patient_id` de P1 → recusa de `patient_isolation`** (mensagem com o nome da política).
  - CHECKs: conteúdo vazio, texto com 2.001 caracteres ou só espaços, `pronto` sem caminho, `removido` com caminho, `pdf` do paciente, recado com anexo, carimbo nulo em `autor = 'nutri'` e preenchido em `autor = 'paciente'`, `tcle_forma = 'verbal'`, liberação sem `liberada_por`, pausa sem liberação, `chat_horarios` sobrepostos (`EXCLUDE`, 23P01), fora de 15 min, `fim <= inicio`; `UNIQUE` de `anexo_path` (23505); `resolucao = 'respondida'` aceito em `ia_nutri_mensagens`; tipos novos aceitos em `notifications` e `stored_files`.
  - CHECK novo (CH-D60): `sem_anexo` com `anexo_original_path` ou `anexo_path` → 23514 (inclusive na sessão do paciente).
  - Permissões: `UPDATE chat_mensagens set texto` → 42501 (permissão); `DELETE`/`TRUNCATE` das seis → 42501; `UPDATE recados` → 42501; **o `delete` da P2 em `chat_conversas` e `chat_leituras` → 42501 de permissão** (a prova que sai do teste genérico com `SEM_DELETE_DO_PACIENTE`, CH-D58).
  - Gatilhos (T1b): `criada_em` = `clock_timestamp()` mesmo se o módulo mandar outro; `autor_user_id` de outra usuária → 42501; o `worker` não insere mensagem; cópia de recado para titular arquivado → 42501; carimbo copiado de `tenants` e recusa sem ele (mensagem e recado); liberar com titular arquivado ou sem carimbo → 42501; liberar com `liberada_por` de outra → 42501; mudar `liberada_em` depois de gravada → 42501; transições do anexo (o `worker` faz `processando → pronto`; a `nutri` não; `pronto → processando` não; `→ removido` sem o marcador não); `chat_leituras`: o `worker` e a `nutri` não gravam `lado = 'paciente'`, o paciente não grava `consultorio`, `lida_ate` não volta nem passa de `clock_timestamp()`; o `update chat_leituras set tenant_id = tenant_id` da `nutri` numa linha `lado = 'paciente'` passa (lado × papel só com `lida_ate` mudando); e, para cada gatilho, os casos de outro tenant, de P2 e do `publico` saem com a mensagem "row-level security" (o gatilho devolveu `NEW`); **v0.3 (CH-D57):** a P2 inserindo a própria conversa em `chat_conversas` e um recado em `recados` sai com "row-level security" (política `paciente_sem_insert`/`staff_only`, não o gatilho), e um papel desconhecido (`set_config('app.role', 'desconhecido', true)` numa transação crua do `app`, com o tenant de A) nas quatro tabelas recebe o 42501 **do gatilho** (falha fechada; a `tenant_isolation` deixaria passar); com o Plano 26 na `main`, a `recepcao` nas quatro sai com "row-level security" (o teste de isolamento do 26 cobre também); **caminhos do anexo (CH-D60):** a `nutri` inserindo `anexo_path` de `chat_anexo` de outro paciente, ou de outro tipo, → 42501; o `worker` num `pronto → pronto` trocando o `anexo_path` → 42501; o `worker` gravando `anexo_original_path` num UPDATE → 42501; `processando → pronto` com `anexo_path` de outro paciente → 42501.
  - O UPDATE do `worker` entre tenants: o `worker` do tenant B não muda `anexo_status` de mensagem de A (0 linhas).
  - Auditoria: INSERT em `chat_mensagens` vira `audit_log` (entidade `chat`, sem o texto); INSERT/UPDATE em `chat_conversas`, entidade `chat_conversa`; `chat_leituras` sem gatilho.
  - Em `src/db/migrate-owner.test.ts` (`describe('Plano 25: peças SECURITY DEFINER com dono NOBYPASSRLS')`, T1c): `app_chat_aviso_nutri_devido` na sessão de paciente **cria a linha** que faltava e devolve `true` (padrão `aviso_email` ligado), `false` na segunda chamada antes de 2 h, `false` com `aviso_email` desligado ou `p_no_horario` falso, e não devolve coluna; contexto (`app.role`, `app.patient_id`) igual ao de antes depois de cada chamada; `app_chat_soltar_anexo` recusa fora do `worker`, com caminho diferente do ponteiro, com o original de mensagem em `processando`, com `anexo_path` de titular ativo; solta o original de `pronto`/`falhou`; solta o `anexo_path` de titular na anonimização e grava `removido`; depois de cada chamada, `current_setting('app.chat_soltando', true)` está vazio (também depois de um erro capturado num `SAVEPOINT`); **recusa o `anexo_path` de uma mensagem `pronto` que ainda tem o original (CH-D59) e aceita depois de soltar o original**; `app_chat_aviso_nutri_devido` recusa (42501) nas sessões `nutri`, `publico`, `worker` e paciente sem conta, sem tocar `aviso_nutri_em`; `app_chat_apagar_do_titular` recusa titular `ativo`, `bloqueado` com `anonimizar_apos` no futuro e titular com anexo apontado, apaga titular `bloqueado` vencido e titular já anonimizado, só no tenant da sessão, e `nutri_app` a executa só no `worker`; **fuso:** com o tenant em `America/Sao_Paulo` e o relógio às 01h UTC (22h do dia anterior em Brasília), `anonimizar_apos` = a data de Brasília ainda é recusado.
- [ ] **Step 2:** `pnpm vitest run src/modules/mensagens/banco.test.ts src/db/migrate-owner.test.ts` → FAIL.
- [ ] **Step 3:** schema, `pnpm db:generate --name mensagens`, custom, `pnpm db:migrate`; listas das guardas; isolamento; semente; `CLAUDE.md`; runbook.
- [ ] **Step 4:** `pnpm vitest run src/modules/mensagens/banco.test.ts src/db/migrate.test.ts src/db/migrate-owner.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/db/sem-conta-guarda.test.ts test/isolamento.test.ts src/modules/notificacoes src/modules/ia/nutri-paciente` → PASS (ao fim da **T1a**, sem os gatilhos, o `isolamento.test.ts` já fica verde: CH-D67); `pnpm typecheck && pnpm lint`; `pnpm e2e:seed` duas vezes seguidas sem erro (a semente grava pelo `withTenant` com a sessão `nutri` — e `paciente`, para o lado do paciente —, nunca sem papel).
- [ ] **Step 5:** commits `feat(mensagens): … no banco (P25-01a|b|c)`. Descrição do PR 1 com "Volta atrás".

**Testes de isolamento (o que muda em `test/isolamento.test.ts`):** fábricas da spec §9.8 v0.3. **`chat_leituras` (decidido, CH-D58):** a fábrica grava sempre `lado = 'paciente'` (`lida_ate = now()`) e roda no `beforeAll` pela sessão de paciente com conta (`PAPEL_DA_FABRICA.chat_leituras = 'paciente'`; o `beforeAll` monta `{ tenantId, role: 'paciente', patientId: p, actorUserId: randomUUID() }` para esse papel). Assim P1 e P2 têm a própria linha: o UPDATE da P2 (`UPDATE_DO_PACIENTE`, `lida_ate = lida_ate`) altera `vistas` linhas, e o "mover para P1" chega ao gatilho, que devolve `NEW`, e à `patient_isolation` (recusa com "row-level security"). Pela sessão `nutri` isso seria impossível: o gatilho proíbe a `nutri` de gravar `lado = 'paciente'`, e a USING de `paciente_leitura_propria_update` esconde as linhas `consultorio` do UPDATE da P2 (0 linhas, sem erro). Nos negativos (outro tenant, P2 no P1, `publico`, `conta`) a fábrica roda em outros papéis e a recusa vem da RLS, porque o gatilho devolve `NEW` antes. A fábrica roda uma vez por (tenant, paciente): sem `ON CONFLICT`. `ON CONFLICT DO NOTHING` só em `chat_configuracoes` (PK por tenant), conferindo que a RLS recusa antes do conflito nos negativos (a checagem `WITH CHECK` do INSERT roda antes da do conflito no Postgres 16; se um negativo sair sem erro, a fábrica troca o `ON CONFLICT` por outra forma que não repete). `chat_horarios`: `dia_semana = 0`, `inicio_min = 15 * (select count(*) from chat_horarios where tenant_id = $t)`, `fim_min = inicio_min + 15`. `chat_mensagens` e `recados`: com `autor_nome`/`autor_crn` iguais ao carimbo gravado no `beforeAll` (CH-D67).

**Revisores:** `revisor-rls` em cada subtarefa (T1a, T1b, T1c).

**Pronto quando:** testes verdes; `pnpm e2e:seed` repetível; revisão do `revisor-rls` sem Critical/Important; §5 feito sobre a `main` atual; PR 1 pronto para abrir (sem push sem o OK; a orquestradora conduz).

---

### Task 2: Liberação, pausa, retomada e horário — módulo (PR 2)

**Files:**
- Create: `src/modules/mensagens/constantes.ts` (todos os textos da spec §6.2, limites, `RISCO_DO_TEXTO_FIXO`, `ROTULO_FORMA_TCLE`, `rotuloDoQuando`, singulares), `src/modules/mensagens/horario.ts`, `src/modules/mensagens/conversa.ts` (só liberar, pausar, retomar e `estadoDaConversa` nesta tarefa)
- Modify: `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO` + `chat`, `chat_conversa`, `chat_liberacao`, `chat_pausa`, `chat_retomada`; `acaoDoItem` com "Liberou/Pausou/Retomou a conversa por mensagens"; `visivelNoHistorico` com `and not (entidade = 'chat_conversa')` no fim)
- Test: `src/modules/mensagens/{constantes,horario,conversa}.test.ts`, `src/modules/plataforma/audit.test.ts` (casos novos no fim)

**Interfaces:**
```ts
export type EstadoDaConversa = { existe: boolean; liberadaEm: Date | null; formaDoTcle: FormaTcle | null; pausada: boolean; titular: 'ativo' | 'arquivado' | 'bloqueado' | 'anonimizado'; temConta: boolean; carimbo: boolean };
export async function liberarConversa(ctx: TenantContext, patientId: string, i: { forma: FormaTcle; confirmou: true }, db?: Db): Promise<'ok' | 'ja_liberada' | 'titular_inativo' | 'sem_carimbo'>;
export async function pausarConversa(ctx, patientId, db?): Promise<'ok' | 'nao_liberada' | 'ja_pausada'>;
export async function retomarConversa(ctx, patientId, db?): Promise<'ok' | 'nao_pausada'>;
export function dentroDoHorario(faixas: Faixa[], fuso: string, agora: Date): boolean; // puro
export function resumoDoHorario(faixas: Faixa[]): string; // "segunda a sexta, 9h às 12h e 14h às 18h"
export async function lerConfiguracao(ctx, db?): Promise<{ horarioAtivo: boolean; avisoEmail: boolean; faixas: Faixa[] }>; // padrões sem linha
export async function salvarConfiguracao(ctx, i: { horarioAtivo: boolean; avisoEmail: boolean; faixas: Faixa[] }, db?): Promise<'ok' | ErroDeFaixa>;
export async function horarioParaPaciente(tx: Tx): Promise<{ horarioAtivo: boolean; faixas: Faixa[] }>; // projeção sem aviso_*
```
- `liberarConversa`: trava o paciente `FOR SHARE` primeiro (o gatilho lê a situação do titular sem trava e correria com um arquivar concorrente; RLS Minor 7) e só então `INSERT … ON CONFLICT (tenant_id, patient_id) DO UPDATE` só quando `liberada_em` é nulo (a conversa pode ter nascido de um recado); `recordAudit({ acao: 'criar', entidade: 'chat_liberacao', entidadeId: conversaId, patientId })` na mesma transação. `pausarConversa` **e `retomarConversa`**: travam o paciente `FOR UPDATE` antes da conversa (RN-442, RN-447 v0.3).
- `salvarConfiguracao`: trava a linha da configuração (`INSERT … ON CONFLICT DO NOTHING` + `SELECT … FOR UPDATE`), confere 3 faixas por dia, `inicio < fim`, múltiplos de 15 e sobreposição; troca as faixas (apaga e regrava: `chat_horarios` aceita DELETE da equipe).

- [ ] **Step 1: Testes que falham:** liberar grava os três campos e o `recordAudit`, e o Histórico do paciente mostra "Liberou a conversa por mensagens" e **nenhum** "Criou"/"Alterou" da linha da conversa (`listAccessHistory`); liberar conversa nascida de recado (UPDATE) idem; sem carimbo → `sem_carimbo` e nada gravado; titular arquivado → `titular_inativo`; sessão de paciente → `Error` antes da transação; pausar/retomar com o rótulo no Histórico; liberar × arquivar concorrente (duas conexões: o arquivar espera a liberação ou a liberação vê o titular arquivado e devolve `titular_inativo`, sem 40P01); RN-465: arquivar deixa a conversa só leitura e desarquivar devolve a conversa como estava (liberada, pausada ou não, com a mesma forma do TCLE), sem nova liberação; `dentroDoHorario` na virada do dia em `America/Sao_Paulo` com o servidor em UTC, 24:00, domingo = 0; `resumoDoHorario` junta dias seguidos; `salvarConfiguracao` recusa as faixas da US-446 com os textos exatos e a 4ª faixa no mesmo dia com "No máximo 3 faixas por dia." (RN-451); `horarioParaPaciente` sem chaves `aviso*` (teste das chaves); `RISCO_DO_TEXTO_FIXO` cobre os três códigos de `detectarRisco`.
- [ ] **Step 2:** `pnpm vitest run src/modules/mensagens src/modules/plataforma/audit.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmos testes → PASS; `pnpm typecheck && pnpm lint`.
- [ ] O teste "pausar × envio do paciente concorrente" fica na T3, onde `enviarComoPaciente` nasce (G3 da crítica de completude).
- [ ] **Step 5:** commit `feat(mensagens): liberação, pausa e horário (P25-02)`.

**Revisores:** `revisor-rls` (travas, `recordAudit`, `visivelNoHistorico`), `normas-cfn-lgpd` (só CFN: formas do TCLE, textos da liberação e da pausa, carimbo).

**Pronto quando:** testes verdes; os textos de §6.2 "Liberação" e "Pausa" iguais à spec; revisões sem Critical/Important.

---

### Task 3: Envio, leitura, caixa e situação — módulo (PR 2)

**Files:**
- Create: `src/modules/mensagens/envio.ts` (texto; o anexo entra na T8), `src/modules/mensagens/caixa.ts`, `src/modules/mensagens/guardas.test.ts`
- Modify: `src/modules/mensagens/conversa.ts` (`conversaNoPainel`, `minhaConversa`, `situacao`, `marcarLida`)
- Test: `src/modules/mensagens/{envio,conversa,caixa}.test.ts`

**Interfaces:**
```ts
export type MensagemNaTela = { id: string; autor: 'nutri' | 'paciente'; minha: boolean; autorNome: string | null; autorCrn: string | null; texto: string | null; recado: boolean; duvidaEm: Date | null; risco: RiscoChat | null; anexo: AnexoNaTela | null; criadaEm: Date };
export async function conversaNoPainel(ctx, patientId, o: { antes?: string /* id */ }, db?): Promise<{ estado: EstadoDaConversa; mensagens: MensagemNaTela[]; haAnteriores: boolean; ultimaLida: string | null }>;
export async function minhaConversa(ctx, o: { antes?: string }, db?): Promise<{ estado: …; horario: …; mensagens: MensagemNaTela[]; haAnteriores: boolean; ultimaLida: string | null }>;
export async function situacao(ctx, o: { patientId?: string; depois: string /* id */ }, db?): Promise<{ novas: number; ultimaLida: string | null }>;
export async function enviarComoNutri(ctx, patientId, i: { texto: string }, db?): Promise<{ id: string } | ErroDeEnvio>;
export async function enviarComoPaciente(ctx, i: { texto: string }, db?): Promise<{ id: string; textoFixo: CodigoTextoFixo | null } | ErroDeEnvio>;
export async function caixaDeMensagens(ctx, o: { filtro: 'todas' | 'nao-lidas'; busca?: string; pagina?: number }, db?): Promise<{ itens: ItemDaCaixa[]; haMais: boolean }>;
export async function contadorDeMensagens(ctx, db?): Promise<number>;
export async function pacientesParaNovaConversa(ctx, o: { busca?: string; pagina?: number }, db?): Promise<{ itens: { id: string; nome: string; temConta: boolean }[]; haMais: boolean }>; // CH-D66
```
- `marcarLida(tx, lado, patientId, ultimaId)`: `insert into chat_leituras … select m.tenant_id, m.patient_id, $lado, m.criada_em, now() from chat_mensagens m where m.id = $ultimaId and m.patient_id = $patientId on conflict (tenant_id, patient_id, lado) do update set lida_ate = greatest(chat_leituras.lida_ate, excluded.lida_ate), updated_at = now()` (CH-D40). Chamado na transação da leitura, depois do `auditRead`.
- Cursores: `(m.criada_em, m.id) < (select criada_em, id from chat_mensagens where id = $antes and tenant_id = … and patient_id = …)`; id de outra conversa → lista vazia. `situacao` resolve `depois` do mesmo jeito (id de outra conversa → `novas = 0`); no portal, o `patient_id` vem sempre da sessão (RLS Minor 5).
- `enviarComoNutri`: paciente `FOR SHARE` → conversa `FOR NO KEY UPDATE` (RN-447 v0.3; `FOR UPDATE` bloquearia o `FOR KEY SHARE` da FK no INSERT do paciente e no `marcarLida` do render dele) → INSERT → avisos.
- `pacientesParaNovaConversa` (CH-D66): titulares `ativo` e não anonimizados, com ou sem conversa, ordem alfabética do nome de registro, busca por nome com o mesmo critério da lista de pacientes, 50 por página com `haMais`; `temConta` pelo `user_id`; nunca outra coluna (teste das chaves); sem `auditRead` (como a lista de pacientes, regra 8).
- `caixaDeMensagens`: uma consulta (`DISTINCT ON (patient_id)` ou janela) só sobre conversas liberadas ou com mensagem sem `recado_id` (CH-D42); devolve nome de registro, quando, tipo da última, não lidas, `riscoNaoLido`; nunca `texto` (teste das chaves); ordem risco não lido → mais recente.
- `enviarComoPaciente`: trava → limites (RN-447) → `detectarRisco` → `RISCO_DO_TEXTO_FIXO` → INSERT; devolve o `textoFixo` para a tela mostrar o socorro.

- [ ] **Step 1: Testes que falham:** `auditRead` uma vez por render (entidade `chat`) em `conversaNoPainel` e `minhaConversa`; `caixaDeMensagens`, `contadorDeMensagens` e `situacao` sem `audit_log`; **regressão µs:** duas mensagens gravadas no mesmo milissegundo, abrir mostra as duas, a situação seguinte devolve `novas = 0` e o contador zera (com `Date` do JS falharia); `?antes=` não pula nem repete com 120 mensagens de `criada_em` iguais no ms; `lida_ate` nunca volta; "Lida"/`ultimaLida` só depois de o outro lado abrir; caixa sem conversas só de recado e com o risco no topo; limites 30/h e 200/dia com os textos; envio em conversa pausada → erro sem gravar; sintoma agudo grava `sintoma_agudo` e devolve `textoFixo = 'sintoma_agudo'`; autolesão grava `emergencia`; envio sem carimbo (nutri) → erro; `semConta` → `Error` antes da transação; **pausar × envio do paciente concorrente** (vindo da T2: duas conexões; o envio que começou depois da pausa é recusado, sem 40P01); envio da nutricionista × render do paciente (`marcarLida` e INSERT do paciente) concorrentes sem espera longa nem 40P01 (`FOR NO KEY UPDATE`); **ids de outra conversa** em `?antes=`, `depois` e no `marcarLida` → lista vazia, `novas = 0` e marcador parado, e o `auditRead` grava o paciente da conversa aberta; `pacientesParaNovaConversa`: arquivado, bloqueado e anonimizado fora, `temConta` falso para quem não tem acesso ao app, busca, 51 pacientes → `haMais`, sem `audit_log`, chaves fechadas.
- [ ] Guardas em `guardas.test.ts`: grep de `logger.`/`Sentry` com `texto`, `anexoNome`, `recado`, `caminho` (RN-470); nenhum `dangerouslySetInnerHTML` nem `linkify` em `src/app/**/mensagens/**`; grafo `src/modules/ia/**` ↛ `src/modules/mensagens` e `src/modules/mensagens` → `src/modules/ia` só os dois arquivos permitidos (RN-469).
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/modules/mensagens src/modules/ia/campos-enviados.test.ts`); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(mensagens): envio, leitura e caixa (P25-03)`.

**Revisores:** `revisor-rls` (travas, `auditRead`, marcador, consultas agregadas).

**Pronto quando:** testes verdes, inclusive a regressão µs e as guardas; revisão sem Critical/Important.

---

### Task 4: Avisos ao paciente e à nutricionista (PR 2)

**Files:**
- Create: `src/modules/mensagens/avisos.ts`
- Modify: `src/modules/notificacoes/tipos.ts` (`chat_mensagem`, `recado`; motivo `mensagem_lida`), `src/modules/notificacoes/mensagens.ts` (`AVISOS_DO_PORTAL` com os corpos e a tela `/p/mensagens?v=`; `emailDaNotificacao` sem consulta para `chat_mensagem`; `textoWhatsapp` → `null`), `src/modules/notificacoes/enviar.ts` (`ContextoEnvio` ganha o campo opcional `chatNaoLido?: boolean`, carregado por `carregarContexto` — uma consulta, só para `chat_mensagem` e `recado` —, e `motivoParaIgnorar`, que continua puro, devolve `mensagem_lida` quando ele é `false`; CH-D62), `src/email/types.ts` e `src/email/templates.tsx` (`chat_mensagem`, `aviso_mensagens_nutri`, no fim), `src/modules/agenda/aviso-nutri.ts` (só a docstring de `emailsDaNutri`), `src/modules/mensagens/envio.ts` (chama os avisos)
- Test: `src/modules/mensagens/avisos.test.ts`, `src/modules/notificacoes/{mensagens,enviar}.test.ts` (casos no fim, inclusive o do carregador), `src/email/render.test.ts` (no fim)

**Interfaces:**
```ts
export async function avisarPaciente(tx: Tx, a: { tenant: { id: string; fuso: string }; patientId: string; tipo: 'chat_mensagem' | 'recado'; agora: Date }): Promise<void>;
export async function avisarNutriDeMensagem(tx: Tx, a: { tenant: { id: string; fuso: string }; agora: Date; appUrl: string }): Promise<void>; // chama app_chat_aviso_nutri_devido
```
- Sem helper novo de horário (CH-D61): o silêncio é `emHorarioSilencioso(instante, fuso)` e as 8h seguintes, `fimDoSilencio(agora, fuso)`, de `src/modules/notificacoes/agendar.ts:14-23` (o mesmo par que `src/modules/conteudo/aviso.ts` já usa).
- `avisarPaciente`: só com conta (sem conta, nenhuma `notifications`); sem `notifications` `pendente` **do mesmo tipo** do paciente (CH-D61: o push pendente de um recado não segura o aviso de uma mensagem individual, que tem e-mail, nem o contrário); push agora (ou `fimDoSilencio` se `emHorarioSilencioso(agora)`); e-mail só para `chat_mensagem`, em push + 30 min e, se esse instante cair no silêncio, em `fimDoSilencio` dele (mensagem às 20h45 → e-mail às 8h, não às 21h15); `dispararEnvio(tx, tenantId)` uma vez.
- `carregarContexto` (`mensagem_lida`, CH-D62): para `chat_mensagem`/`recado`, `chatNaoLido = exists (select 1 from chat_mensagens m left join chat_leituras l on l.tenant_id = m.tenant_id and l.patient_id = m.patient_id and l.lado = 'paciente' where m.tenant_id = n.tenant_id and m.patient_id = n.patient_id and m.autor = 'nutri' and m.criada_em > coalesce(l.lida_ate, '-infinity'))`; `motivoParaIgnorar` (puro, `enviar.ts:48`) devolve `mensagem_lida` com `chatNaoLido === false`, antes do retorno dos tipos sem consulta. O Plano 23 também mexe em `enviar.ts` (motivos novos): só acrescentar ("Coordenação").
- `avisarNutriDeMensagem`: `select app_chat_aviso_nutri_devido($noHorario)` depois das travas do paciente; se `true`, `avisarNutri(tx, tenantId, …)` com o modelo `aviso_mensagens_nutri`.

- [ ] **Step 1: Testes que falham:** três mensagens seguidas → um push e um e-mail pendentes; 22h → 8h do dia seguinte no fuso; **mensagem às 20h45 → push às 20h45 e e-mail às 8h do dia seguinte** (o e-mail também respeita o silêncio); **push de recado pendente + mensagem individual em seguida → nasce o push e o e-mail da mensagem** (agrupamento por tipo); o carregador põe `chatNaoLido` só nos tipos do chat e `motivoParaIgnorar` continua sem acesso ao banco (teste de unidade com o contexto montado à mão); paciente sem conta → nenhuma `notifications` criada; e-mail `ignorada` com `mensagem_lida` quando o paciente leu tudo; **US-445 "Aviso agrupado não perde mensagem"** (leu a 1ª, chega a 2ª, o e-mail sai); titular bloqueado → `paciente_inativo`; recado → push sem e-mail; sem inscrição de push → push `ignorada`, e-mail sai; corpos fixos (CS-440): `pushDaNotificacao` e `emailDaNotificacao` sem texto nem nome de anexo, e-mail à nutricionista sem nome de paciente (render do modelo); `app_chat_aviso_nutri_devido` no padrão (sem linha) envia o primeiro e-mail e segura o segundo antes de 2 h (US-445); fora do horário não envia; **com o horário desligado, entre 21h e 8h também não envia** (RN-458), e às 8h01 envia; `app_chat_aviso_nutri_devido` recusada fora da sessão de paciente com conta (a T1c prova no banco; aqui, `avisarNutriDeMensagem` só é chamada do envio do paciente); `notifications` sem coluna nova (teste de esquema); `textoWhatsapp` nulo; `CONTA_COTA` sem tipo novo.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/modules/mensagens src/modules/notificacoes src/email`); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(mensagens): avisos sem conteúdo (P25-04)`.

**Revisores:** `revisor-rls` (consultas de `motivoParaIgnorar`, função, travas), `normas-cfn-lgpd` (só CFN: sigilo nos textos dos avisos).

**Pronto quando:** testes verdes; nenhum texto de mensagem nos canais externos; revisões sem Critical/Important.

---

### Task 5: Titular — exportação, anonimização, rede de limpeza e bloqueio (PR 2)

**Files:**
- Create: `src/modules/mensagens/lgpd.ts`
- Modify: `src/modules/pacientes/exportacao-job.ts` (seções `mensagens` e `conversa` nos dois escopos, em linhas próprias; o ZIP dos anexos na T8), `src/modules/pacientes/lgpd.ts` (`apagarConversaDoTitular` na anonimização, depois dos documentos e antes de `anexosDoPaciente`; `apagarConversasDosAnonimizados` no início de cada tenant em `anonimizarVencidos`, ao lado de `apagarCadastrosDosAnonimizados`; `anexosDeChatRestantes` na reconferência da transação final, ao lado de `pdfsDeDocumentosRestantes`; no atendimento do pedido de exclusão, nada apagado e os avisos pendentes `ignorada` pelo caminho de hoje)
- Modify: `docs/operacao/mensagens.md` (seção "Volta atrás" do PR 2: spec §9.9)
- Test: `src/modules/mensagens/lgpd.test.ts`, `src/modules/pacientes/{lgpd,exportacao}.test.ts` (casos no fim)

**Interfaces:**
```ts
export async function mensagensParaExportacao(tx: Tx, patientId: string): Promise<{ conversa: ConversaExportada | null; mensagens: MensagemExportada[] }>; // worker, incluída explicitamente
export async function apagarConversaDoTitular(ctx: TenantContext /* worker */, patientId: string, deps: { db?: Db; dataDir?: string }): Promise<void>;
export async function anexosDeChatRestantes(tx: Tx, patientId: string): Promise<boolean>;
export async function apagarConversasDosAnonimizados(ctx: TenantContext /* worker */, deps): Promise<void>;
```
- `apagarConversaDoTitular`: (1) numa transação, trava o paciente `FOR UPDATE` (serializa com o `FOR SHARE` do job) e leva `processando` → `falhou` (worker); (2) **em duas voltas (CH-D59): primeiro cada `anexo_original_path`, depois cada `anexo_path`**, por `apagarArquivo` com `naMesmaTransacao` = `select app_chat_soltar_anexo($msg, $caminho)` — a mensagem `pronto` com o original ainda preso existe por desenho (o job grava `pronto` e só depois, em outra transação, apaga o original; a RN-474 cuida do que sobra), e soltar o `anexo_path` antes daria 23514 no CHECK `removido ⇒ sem caminhos`, que o `try` de `anonimizarVencidos` engoliria, e o titular nunca seria anonimizado; (3) `select app_chat_apagar_do_titular($patient)`. Uma transação por arquivo, como `apagarFotosDoDiario`.
- Job × anonimização: se o passo (1) levar a mensagem a `falhou` enquanto o job converte, o `registrar` do job (UPDATE `processando → pronto`) é recusado pelo gatilho; a transação do `salvarArquivo` desfaz o `stored_files` e `gravarArquivos` apaga o JPEG (`armazenamento.ts:206-210`). O job trata essa recusa como desistência (sem nova tentativa) e registra só o código (T8a).

- [ ] **Step 1: Testes que falham:** `dados.json` com `mensagens` (autor, `autorNome`/`autorCrn` só da nutricionista, recado, `respostaADuvidaDe`, risco pelo rótulo) e `conversa`, nos escopos `titular` e `equipe`; nada de `audit_log` lido; **anonimização de titular com anexo `pronto`, com anexo `processando` e com uma mensagem `pronto` com o original sobrando** (o job caído entre as transações) termina e não deixa linha nem arquivo (CH-D41, CH-D59); passo (1) × job concorrente (duas conexões) sem 40P01; titular bloqueado não vencido → a função recusa; o caminho do processo web (papel `worker`, titular ativo) não apaga nada; **volta atrás:** titular marcado `anonimizado_em` pela imagem antiga (conversa e anexo de pé) → a próxima `anonimizarVencidos` limpa pela rede; a transação final falha (e repete no dia seguinte) se surgir anexo de chat no meio; pedido de exclusão atendido → conversa só leitura, push/e-mail pendentes `ignorada`; recado fica em `recados` sem a cópia.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/modules/mensagens src/modules/pacientes`); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(mensagens): exportação e anonimização da conversa (P25-05)`.

**Revisores:** `revisor-rls` (funções, ordem das transações, rede de limpeza), `normas-cfn-lgpd` (só CFN: guarda do prontuário, CH-D2/CH-D25).

**Pronto quando:** testes verdes; o runbook com a seção do PR 2; revisões sem Critical/Important.

---

### Task 6: Painel — caixa, conversa, nova conversa, configuração, menu e ficha (PR 2)

> **Divisão (CH-D63, molde CH-D53):** três subtarefas, cada uma com o próprio ciclo TDD, commit (`P25-06a`, `-06b`, `-06c`) e revisão (`revisor-interface`; `normas-cfn-lgpd` só CFN na T6b). Ordem: T6a → T6b → T6c. O guia `mensagens` nasce na T6a (versão 1) e ganha os passos da conversa na T6b **sem subir a versão** (o PR 2 ainda não foi a produção, CH-D55). Em cada subtarefa: ler `node_modules/next/dist/docs/` de `Link`, Server Actions e Route Handlers antes; toda `page.tsx`, `route.ts` e action nova chama `requireNutri`/`requireApiNutri` (teste de fonte do Plano 26, RN-513, verde se ele já estiver na `main`; CH-D65); todo `<Link` dos arquivos novos com `prefetch={false}` (teste por arquivo, RN-473).

**Interfaces (as três):**
- `ITEM_MENSAGENS = { href: '/painel/mensagens', rotulo: 'Mensagens' }`, sempre visível na sessão `nutri`; contador = `contadorDeMensagens` + `contadorDeDuvidas`. A aba "Dúvidas da IA Nutri" só com a IA Nutri ativada ou com dúvida aberta (regra de hoje do `ITEM_DUVIDAS`).
- Rotas `GET` de situação e contador: `Cache-Control: no-store`, chaves fechadas (`{ novas, ultimaLida }`, `{ n }`), `requireApiNutri`, sem `auditRead`; guarda de mesma origem não se aplica a GET.
- Consultas no cliente (RN-452, RNF-441, RN-459): a da situação a cada 15 s com a aba visível, 60 s depois de 5 min sem interação, nenhuma com `document.visibilityState === 'hidden'` ou `navigator.onLine === false` (volta ao ficar visível ou ao reconectar); a do contador do menu a cada 60 s com a aba visível. Um temporizador só por componente, limpo no desmonte.
- Conversa: Server Actions (`enviar`, `liberar`, `pausar`, `retomar`) com `useActionState`; estado devolvido com `texto` para `defaultValue` (o texto nunca se perde); `revalidatePath('/painel', 'layout')` depois de abrir e de enviar; redirect `?ok=` nos atos. Funciona sem JS para ler e enviar texto (RNF-443): o formulário do campo é um `<form action>` comum, e sem JS a página volta pelo redirect.

#### T6a — Menu, contador, abas, caixa, nova conversa e a fila "Dúvidas da IA Nutri"

**Files:**
- Create: `src/app/painel/mensagens/{page.tsx,abas.tsx,lista.tsx,nova/page.tsx}`, `src/app/api/painel/mensagens/contador/route.ts`, `src/app/painel/contador-de-mensagens.tsx` (consulta de 60 s)
- Modify: `src/app/painel/navegacao.ts` (`ITEM_MENSAGENS` no lugar de `ITEM_DUVIDAS`, mesma posição; `itemAtual` marca "Mensagens" em `/painel/duvidas`; `itensDoMenu({ exames, mensagens })`), `navegacao.test.ts`, `layout.tsx`, `cabecalho.tsx`, `cabecalho.test.ts`, `menu-painel.tsx` (prop `mensagens`), `src/app/painel/duvidas/**` (abas, h1 "Dúvidas da IA Nutri", "Voltar para Dúvidas da IA Nutri"; CH-D45), `src/components/ui/selo.tsx` (variante `alerta`)
- Modify (guias e testes): `src/modules/ajuda/conteudo.ts` — guia **`mensagens`** novo (versão 1, `padrao` `/^\/painel\/mensagens(\/.*)?$/`, **antes** de qualquer guia mais genérico; passos da caixa e da nova conversa, cada um com o seu `data-guia`); `boas-vindas` 3 → 4 (o passo do menu cita "Mensagens"); `duvidas`: só os títulos para "Dúvidas da IA Nutri" (a versão sobe na T9); `conteudo.test.ts` (`TSX_FORA` + `src/modules/mensagens`; frases e versões novas); `e2e/painel-rotas.ts` (`ROTAS_DO_PAINEL` e `IdsDoPainel` com a caixa e a nova conversa); `e2e/ia-nutri-paciente.spec.ts:115-118`, `e2e/acessibilidade-painel.spec.ts:304-310`, `e2e/sessao-equipe.spec.ts:108` (menu novo)
- Test: `src/app/painel/mensagens/page.test.ts`, `src/app/painel/mensagens/nova/page.test.ts`, `src/app/api/painel/mensagens/contador/route.test.ts`, `src/app/painel/contador-de-mensagens.test.tsx`, `src/app/painel/navegacao.test.ts`, `src/app/painel/rotas-axe.test.ts`

- [ ] **Step 1: Testes que falham:** caixa sem texto de mensagem (chaves e HTML); "Não lidas"; vazio e vazio do filtro com os textos exatos; `?pagina=`; `<nav>` com os dois `aria-label`; `<title>` "Mensagens"; selo `alerta` com texto; nova conversa (CH-D66): só ativos não anonimizados, "Sem acesso ao app", "Nenhum paciente encontrado.", "Mostrar mais", link `prefetch={false}` para a conversa, sem `audit_log`; rota do contador com só `{ n }`, `no-store` e sem `auditRead`; **componente do contador com relógio falso** (`vi.useFakeTimers`): consulta a cada 60 s com a aba visível, nenhuma com `visibilityState = 'hidden'` nem sem rede, retoma no `visibilitychange`; menu sem "Dúvidas dos pacientes" e com "Mensagens ({n})" e o `aria-label` singular/plural; `/painel/duvidas` com o h1 e as abas; guias: `conteudo.test.ts` verde (versões, frases, rótulos existentes).
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/app/painel src/app/api/painel/mensagens src/modules/ajuda src/modules/mensagens`); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** axe da caixa e da nova conversa nos temas claro, escuro e aparelho (`e2e/acessibilidade-painel.spec.ts`, laço existente); o menu quebra sem cobrir o conteúdo (`sessao-equipe.spec.ts`); E2E (`e2e/mensagens.spec.ts`, `10.9.25.1`–`.5`): caixa → "Nova conversa" → busca → abre a conversa.
- [ ] **Step 6:** commit `feat(mensagens): menu, caixa e nova conversa no painel (P25-06a)`.

#### T6b — A conversa no painel (liberar, pausar, enviar, situação, região viva)

**Files:**
- Create: `src/app/painel/mensagens/[patientId]/{page.tsx,actions.ts,campo.tsx,lista-de-mensagens.tsx,liberar-dialogo.tsx,pausar-dialogo.tsx,situacao.tsx}`, `src/app/api/painel/mensagens/situacao/route.ts`; `src/components/dialogo.tsx` **só se** ainda não estiver na `main` (interface do Plano 22 T2)
- Modify: `src/modules/ajuda/conteudo.ts` (guia `mensagens`: passos da conversa e da liberação, mesma versão 1), `e2e/painel-rotas.ts` (a conversa), `scripts/e2e-seed.ts` (no tenant do E2E do chat, uma conversa com mensagem de risco **e** um recado com a cópia, gravados por `withTenant` nas sessões `nutri` e `paciente`, para o axe; CH-D68)
- Test: `src/app/painel/mensagens/[patientId]/page.test.ts`, `situacao.test.tsx`, `src/app/api/painel/mensagens/situacao/route.test.ts`

- [ ] **Step 1: Testes que falham:** conversa com hora e `<time datetime>`, "Você"/carimbo, "Lida"/"Enviada", região viva montada e vazia, `?ok=` sem rolar e com foco na região; **a cópia de recado** com "Recado" e o carimbo da linha (a exibição é desta tarefa, não da T10: CH-D68); diálogo de liberar com o select ("Escolha", duas formas) e o erro junto ao campo; sem carimbo → texto com link ao Perfil; arquivado e bloqueado → só leitura; anonimizado → "Paciente anonimizado: a conversa foi apagada junto com os dados do paciente."; id inexistente ou de outro consultório → `notFound()`; **paciente sem conta** → "{nome} ainda não tem acesso ao app…" e o envio grava a mensagem sem nenhuma `notifications`; pausada → "Retomar conversa"; rota de situação com só as duas chaves; **US-441 "Mensagem nova com a tela aberta"** (componente `situacao.tsx` com relógio falso e `fetch` falso): a situação devolve `novas = 1` → a região viva anuncia "Nova mensagem de {primeiro nome}." e aparece "Mostrar novas mensagens"; nenhum texto de mensagem chega ao componente antes do toque (o `fetch` da situação só traz as duas chaves; o conteúdo vem do `router.refresh()` depois do toque); depois do toque, o foco vai para a primeira mensagem nova; **consulta da situação** a cada 15 s com a aba visível, 60 s depois de 5 min sem interação, nenhuma com a aba escondida ou sem rede.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/app/painel/mensagens src/app/api/painel/mensagens src/modules/ajuda src/modules/mensagens`); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** axe da conversa (com risco e com recado na semente) nos três temas; E2E (`e2e/mensagens.spec.ts`, `10.9.25.6`–`.15`): liberar → enviar → o paciente abre → no painel, "Lida"; **mensagem nova com a tela aberta** (o paciente envia por outra página; `page.clock` avança 15 s; a região viva anuncia; "Mostrar novas mensagens" leva o foco à primeira nova); **sem JS** (`test.use({ javaScriptEnabled: false })`): a conversa abre, mostra as mensagens e envia texto (RNF-443).
- [ ] **Step 6:** commit `feat(mensagens): conversa no painel (P25-06b)`.

#### T6c — Configuração, hub e seção da ficha

**Files:**
- Create: `src/app/painel/configuracoes/mensagens/{page.tsx,actions.ts,horario-form.tsx}`, `src/modules/ficha/secoes/mensagens.ts`
- Modify: `src/app/painel/configuracoes/page.tsx` (cartão "Atendimento por mensagens" no **fim** de `CARTOES`), `src/modules/ficha/{tipos.ts,adicionar.ts,secoes/index.ts}` (`rotuloDoTotal?`, `{id}` em `caminhoNaFicha`, uma linha no fim de `SECOES_DA_FICHA`), `src/modules/ficha/textos.ts` (`MSG_FICHA.titulos`) e `registro.test.ts` (`IMPORTS_PERMITIDOS` + `@/modules/mensagens/constantes`, se a seção importar)
- Modify (guias): `src/modules/ajuda/conteudo.ts` — guia novo **`configuracoes-mensagens`** (versão 1, `padrao` `/^\/painel\/configuracoes\/mensagens$/`, **antes** do genérico `configuracoes`, como `/painel/agenda/horarios` antes da agenda; passos com `data-guia` das faixas, do "24:00" e do aviso por e-mail); `configuracoes` 8 → 9 (o passo dos cartões cita "Atendimento por mensagens", a `ajuda.resumo` cita as mensagens e a fila "Dúvidas da IA Nutri"); `conteudo.test.ts`; `e2e/painel-rotas.ts` (a configuração)
- Test: `src/app/painel/configuracoes/mensagens/page.test.ts`, `src/modules/ficha/secoes/mensagens.test.ts`, `src/modules/ficha/adicionar.test.ts` (caso `{id}`)

- [ ] **Step 1: Testes que falham:** configuração com `<fieldset>`/`<legend>`, `<select>` de 15 min, "24:00", nomes acessíveis completos, erros exatos (inclusive "No máximo 3 faixas por dia."); ficha: "2 não lidas", "Enviar mensagem" com href `/painel/mensagens/<id>` e sem o item para titular inativo, nunca `texto` (teste das chaves), sem `auditRead`; o guia `configuracoes-mensagens` casa com a rota e o `configuracoes` não; guias: `conteudo.test.ts` verde.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/app/painel/configuracoes src/modules/ficha src/modules/ajuda src/modules/mensagens`); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** axe da configuração nos três temas; E2E (`10.9.25.16`–`.19`): salvar faixas e ver o resumo no portal.
- [ ] **Step 6:** commit `feat(mensagens): configuração e ficha (P25-06c)`.

**Revisores:** `revisor-interface` (as três: telas, foco, região viva, diálogos, guias), `normas-cfn-lgpd` (só CFN, T6b: liberação, carimbo, textos).

**Pronto quando:** testes, axe e E2E verdes nas três; `rotas-axe.test.ts` verde; revisões sem Critical/Important.

---

### Task 7: Portal — link na faixa e `/p/mensagens` (PR 2)

**Files:**
- Create: `src/app/p/(portal)/mensagens/{page.tsx,actions.ts,conversa-portal.tsx,socorro.tsx}`, `src/app/api/p/mensagens/situacao/route.ts`
- Modify: `src/components/portal/faixa.tsx` (link "Mensagens"/"Mensagens ({n})" com `aria-label` singular/plural, `min-h-11`, linha com `flex-wrap` e `ml-auto`, `prefetch={false}`, só com conversa liberada ou recado; sem contador na cópia guardada), `src/app/p/navegacao.ts` (`/p/mensagens` no `tambem` de "Hoje"), `src/app/sw.ts` (`/p/mensagens` fora do `NetworkOnly` com `planoGuardado()` e fora de todo cache; sem rede, a página cliente já carregada mostra o aviso), `src/modules/ajuda/portal.ts` (`portal-novidades` + 1 **sobre a versão da `main` do momento** — o Plano 19 já sobe a dele no branch; hoje 3 → 4: "Mensagens" na faixa "quando o consultório liberar" e o item novo de "Perguntas comuns" da spec §6.2, "Portal: ajuda": o canal não é para urgências e a conversa fica no prontuário) e `portal.test.ts`, `e2e/acessibilidade.spec.ts` (rota `/p/mensagens`)
- Test: `src/app/p/(portal)/mensagens/page.test.ts`, `conversa-portal.test.tsx`, `src/app/api/p/mensagens/situacao/route.test.ts`, `src/app/sw.test.ts` (ou o teste existente do service worker), `src/components/portal/faixa.test.ts`

**Interfaces:** `minhaConversa` e `enviarComoPaciente` (T3); `horarioParaPaciente` (T2); cabeçalho "Conversa com {nome profissional}, nutricionista, CRN {crn}" e contatos do perfil (`tenants.contato_email`, `contato_telefone_e164`).

- [ ] **Step 1: Testes que falham:** faixa com e sem contador, `aria-label` "Mensagens, 1 não lida", sem link sem conversa; aviso de urgência sempre; horário ligado/desligado/sem faixas (RN-451, RN-472); fora do horário com o texto exato e o envio permitido; socorro abaixo da mensagem de risco pelo `risco` gravado (sintoma agudo ≠ emergência); só recados → só leitura e o texto da US-443; pausada → texto e sem campo; erro de envio em conversa pausada com o texto novo; recado com "Recado do consultório · {nome} · CRN {crn}"; `sw.ts`: `/p/mensagens` não casa com o matcher de navegação do portal nem com o do plano, e nenhum `cache.put` a guarda; componente sem rede → "Sem conexão. Escreva quando voltar." na região `role="status"` montada, campo e botões desabilitados, texto preservado; `semConta` → redireciona como as outras telas com conta; **consulta da situação no portal** (relógio falso): 15 s com a aba visível, 60 s depois de 5 min parado, nada com a aba escondida ou sem rede, e "Nova mensagem da sua nutricionista." + "Mostrar novas mensagens" sem o texto antes do toque (RN-452, RNF-441, US-443); **RN-471/RN-473:** o cabeçalho com "Conversa com {nome profissional}, nutricionista, CRN {crn}" e os contatos do perfil; o link da faixa na cópia guardada de `/p/plano` sai sem contador; a tela do push (`/p/mensagens?v=<consultório>`) com paciente de dois consultórios abre a conversa do consultório do `?v=` (R-450); `?erro=` sem JS com os códigos da spec §6.2 e código desconhecido sem texto.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/app/p src/components/portal src/modules/ajuda src/app/sw`); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** E2E (`e2e/mensagens.spec.ts`, `10.9.25.20`–`.39`): paciente abre pela faixa, envia, recebe "Lida"; envio com sinal de risco mostra o socorro; 400 px sem rolagem lateral (`scrollWidth <= clientWidth`); modo sem rede (`context.setOffline(true)`) mostra o aviso e nunca o plano; **sem JS** (`javaScriptEnabled: false`): a conversa abre e envia texto (RNF-443); axe de `/p/mensagens` nos dois temas.
- [ ] **Step 6:** commit `feat(mensagens): conversa no app (P25-07)`. Fechamento do PR 2: `ROTAS_DO_PAINEL` conferido; manual técnico pelo `guardiao-manual` (M1 da crítica): caps. `01-visao-geral-e-arquitetura.md` (módulo `mensagens`), `02-banco-de-dados.md` (tabelas, políticas, gatilhos, funções), `03-autenticacao-e-acesso.md` (`paciente_com_conta`, `PACIENTE_ESCREVE`, a lista fechada de papéis dos gatilhos), `04-modulos-clinicos.md` (seção "Mensagens" da ficha, `caminhoNaFicha` com `{id}`), `05-agenda-portal-conteudo.md` (conversa, avisos, `/p/mensagens`, service worker), `07-testes-qualidade-e-processo.md` (`guardas.test.ts`, `describe` do `migrate-owner`, bloco de IP `10.9.25.x`, o `beforeAll` do isolamento com fábrica de paciente) e o `README.md` (índice e glossário); `10-ia.md` (fila renomeada "Dúvidas da IA Nutri"); textos da Central de Ajuda e do manual do usuário do PR 2 em `../.sessoes/plano25-ajuda-pr2.md` para a orquestradora publicar depois do merge (CH-D64); descrição do PR com "Volta atrás".

**Revisores:** `revisor-interface` (portal G, 400 px, offline, região viva), `normas-cfn-lgpd` (só CFN: urgência, socorro, identificação no cabeçalho), `guardiao-manual` (fechamento do PR 2).

**Pronto quando:** testes, axe e E2E verdes; o PR 2 inteiro com a revisão final do branch (ver "Depois das tarefas").

---

### Task 8: Anexos — upload, download, job, varredura e ZIP (PR 3)

> **Divisão (CH-D63):** duas subtarefas com o próprio ciclo TDD, commit (`P25-08a`, `-08b`) e revisão (`revisor-rls` e `revisor-interface` em cada). T8a — anexo da nutricionista (PDF e imagem), os dois downloads e o job. T8b — foto do paciente, varredura e ZIP. A rede das rotas novas: `mesmaOrigem` nos POST (`src/app/api/mesma-origem-rotas.test.ts`), `requireApiNutri` nas do painel (teste de fonte do Plano 26, se na `main`).

**Interfaces (as duas):**
```ts
export async function salvarAnexoDaNutri(ctx, patientId, a: { conteudo: Buffer; nome: string; texto?: string }, deps): Promise<{ id: string } | ErroDeAnexo>;
export async function salvarFotoDoPaciente(ctx, a: { conteudo: Buffer; texto?: string }, deps): Promise<{ id: string; textoFixo: CodigoTextoFixo | null } | ErroDeAnexo>;
export async function caminhoDoAnexo(ctx, o: { patientId?: string; mensagemId: string }, db?): Promise<string | null>; // só anexo_path 'pronto'; auditRead
export type DadosChatAnexo = { tenantId: string; mensagemId: string };
export async function converterAnexo(d: DadosChatAnexo, deps): Promise<void>; // worker
export async function varrerAnexosDoChat(deps, agora: Date): Promise<void>; // RN-474
```
- `salvarAnexoDaNutri` (RN-447 v0.3, RLS Minor 2): `salvarArquivo` com `antesDaReserva` = **primeiro** `pg_advisory_xact_lock(hashtext('chat-anexos-tenant'), hashtext(tenantId))` (dentro da transação do `salvarArquivo`; fora dela, a trava sairia no commit de outra transação e duas nutricionistas passariam de 100) → contagem dos 100 por dia (no fuso) → paciente `FOR SHARE` → conversa liberada e não pausada (`FOR NO KEY UPDATE`); `registrar` = INSERT da mensagem (`processando` com `chat_anexo_original` para imagem; `pronto` com `chat_anexo` para PDF) + avisos; `permitidos` = `['jpg','png','heic','pdf']`; `anexo_nome` sem a pasta (só o último segmento) e com até 120 caracteres (RN-454).
- `salvarFotoDoPaciente`: `antesDaReserva` = trava `FOR UPDATE` + limites (20 fotos/dia, 30/h, 200/dia); `permitidos` = `['jpg','png','heic']`.
- `caminhoDoAnexo` (RLS Minor 5): a mensagem é buscada por `id` **e** `patient_id` da conversa (no portal, o da sessão); id de outra conversa → `null` (404); o `auditRead` grava o `patient_id` da linha.
- Job: trava o paciente (`FOR SHARE`) no `antesDaReserva` do `salvarArquivo` do JPEG; `registrar` = UPDATE `processando → pronto` + `anexo_path` (o gatilho confere a amarra ao `stored_files`, CH-D60); depois `apagarArquivo(original)` com `app_chat_soltar_anexo`. Se o gatilho recusar o `registrar` (a anonimização levou a mensagem a `falhou` no meio, T5), a transação desfaz o `stored_files` e `gravarArquivos` apaga o JPEG: o job encerra sem nova tentativa, com log só do código (RN-470). Falha da conversão → `falhou` e o original sai. 40 MP, um por vez, `expireInSeconds` 120 (RNF-446), `paraJpegSemMetadados`; lado maior até 1.600 px (RN-454).
- Rotas de upload: `LIMITE_CORPO` 10 MB + margem, `mesmaOrigem`, sem JS → 303 para a conversa com `?erro=<código>` (códigos fechados da spec §6.2 v0.3); com JS → JSON `{ ok }`/`{ erro }`. Downloads: `auditRead` + 303 para `signFileUrl` (5 min).

#### T8a — Anexo da nutricionista, downloads e job

**Files:**
- Create: `src/modules/mensagens/{anexos.ts,anexo-job.ts}` (`salvarAnexoDaNutri`, `caminhoDoAnexo`, `converterAnexo`), `src/app/api/painel/mensagens/[patientId]/{anexo,anexos/[mensagemId]}/route.ts`, `src/app/api/p/mensagens/anexos/[mensagemId]/route.ts`
- Modify: `src/modules/plataforma/armazenamento.ts` (`TipoDeArquivo` + `chat_anexo`, `chat_anexo_original`; `TIPOS_DO_PACIENTE` + os dois, no fim), `src/jobs/queues.ts` (fila `chat-anexo`, linha no fim, molde `diario-foto`), `src/worker/index.ts` (`work('chat-anexo', …)`, no fim), `src/modules/mensagens/envio.ts` (anexo opcional), telas da conversa no painel ("Anexar arquivo", prévia, "Remover anexo", estados "processando"/"falhou"/"removido", `accept` restrito, `?erro=`) e no portal (abrir o anexo da nutricionista), guardas de grafo em `src/modules/pacientes/exportacao.test.ts` e `src/modules/notificacoes/push.test.ts` (`anexo-job.ts`, sharp e HEIC só no worker), `src/app/api/mesma-origem-rotas.test.ts`, `docs/operacao/mensagens.md` (seção do PR 3)
- Test: `src/modules/mensagens/{anexos,anexo-job}.test.ts`, `route.test.ts` das três rotas

- [ ] **Step 1: Testes que falham:** PDF da nutricionista pronto na hora, "Abrir" grava `auditRead` (entidade `chat`, `entidadeId` = mensagem, `patient_id` da linha) e redireciona para a URL assinada; imagem HEIC vira JPEG sem EXIF/GPS (fixture com GPS) e com o lado maior ≤ 1.600 px; o original **nunca** é servido (`caminhoDoAnexo` em `processando` → `null`); `mensagemId` de outro paciente na URL do painel e do portal → 404 sem `audit_log`; SVG recusado pelo conteúdo; `anexo_nome` sem a pasta (`C:\fotos\a.pdf` → `a.pdf`) e cortado em 120; 12 MB → "O arquivo passa de 10 MB."; cota esgotada → texto; 100 anexos/dia com duas nutricionistas concorrentes (a trava do consultório dentro do `antesDaReserva`: a 101ª recusada, sem 40P01); job recusado pelo gatilho depois de a mensagem ir a `falhou` → sem JPEG no disco nem em `stored_files`; guardas de grafo; `mesma-origem-rotas.test.ts` verde.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/modules/mensagens src/modules/plataforma src/modules/pacientes/exportacao.test.ts src/app/api src/modules/notificacoes/push.test.ts`); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** E2E (`10.9.25.40`–`.44`): nutricionista envia PDF, paciente abre; nutricionista envia imagem, vê "Imagem em processamento…" e depois a imagem (com `pnpm worker` da sessão rodando só neste caso).
- [ ] **Step 6:** commit `feat(mensagens): anexos da nutricionista (P25-08a)`.

#### T8b — Foto do paciente, varredura e ZIP

**Files:**
- Create: `src/modules/mensagens/varredura.ts` (só worker), `src/app/api/p/mensagens/foto/route.ts`
- Modify: `src/modules/mensagens/anexos.ts` (`salvarFotoDoPaciente`), `src/worker/index.ts` (`boss.schedule('expirar-chat-anexo', '*/15 * * * *', …)`, no fim), telas do portal ("Enviar foto", prévia, "Remover foto", estados, `accept` restrito, `?erro=`), `src/modules/pacientes/exportacao-job.ts` (anexos `pronto` no ZIP em `mensagens/<data>-<id curto>.<ext>`), `src/modules/mensagens/lgpd.ts` (o caso de anexo já existe da T5; só os testes com upload real), guardas de grafo (`varredura.ts` só no worker), `src/app/api/mesma-origem-rotas.test.ts`
- Test: `src/modules/mensagens/{anexos,varredura}.test.ts`, `route.test.ts` da rota da foto

- [ ] **Step 1: Testes que falham:** PDF do paciente recusado pelo conteúdo, com nome `.jpg`; 20 fotos/dia (conferido sob a trava: duas requisições concorrentes não passam de 20); varredura: presa em `processando` → `falhou`; original que sobrou → apagado; arquivo órfão `chat_*` → apagado; ZIP com nome gerado, nunca o `anexo_nome`; anonimização com upload real (T5) continua verde, inclusive a mensagem `pronto` com o original sobrando (CH-D59); `?erro=` sem JS na rota da foto com os códigos do portal.
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/modules/mensagens src/modules/pacientes src/app/api src/modules/notificacoes/push.test.ts`); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** E2E (`10.9.25.45`–`.49`): paciente envia foto, a nutricionista vê "Imagem em processamento…" e depois a imagem (com `pnpm worker` da sessão rodando só neste caso); foto sem JS volta à conversa com o 303.
- [ ] **Step 6:** commit `feat(mensagens): fotos do paciente, varredura e ZIP (P25-08b)`.

**Revisores:** `revisor-rls` (regra 9, travas, `app_chat_soltar_anexo`, varredura), `revisor-interface` (upload, estados, `accept`, erros sem JS), nas duas.

**Pronto quando:** testes e E2E verdes nas duas; revisões sem Critical/Important.

---

### Task 9: Dúvida da IA Nutri respondida pela conversa (PR 3)

**Files:**
- Modify: `src/modules/mensagens/envio.ts` (`responderDuvidaPelaConversa`), `src/modules/ia/nutri-paciente/duvidas.ts` (`situacaoDaDuvida` com `respondida`; `abrirDuvida` devolve `podeResponderNaConversa` e `conversaLiberada`), `src/modules/ia/nutri-paciente/conversa.ts` (`duvida: 'respondida'`, `:248`), `src/modules/ia/nutri-paciente/lgpd.ts` (`SITUACAO_DA_DUVIDA` + `respondida`, `:155`), `src/modules/ia/nutri-paciente/constantes.ts` ("Sua nutricionista respondeu em Mensagens.", "Abrir Mensagens", "Respondida em Mensagens"), `src/app/painel/duvidas/[id]/**` ("Responder na conversa" ao lado de "Marcar como vista", com o mesmo peso e `prefetch={false}`; sem conversa liberada, o texto da US-447 com o link), `src/app/painel/mensagens/[patientId]/**` (`?duvida=`: faixa, "Ver a pergunta" em nova aba, dica, "Cancelar resposta", `?ok=respondida`), aba IA Nutri da ficha ("Respondida em Mensagens"), `src/app/p/(portal)/plano/ia/**` (texto e link "Abrir Mensagens" com `prefetch={false}`), `src/modules/ajuda/conteudo.ts` (`duvidas` 1 → 2: "Responder na conversa" e "Marcar como vista"; some "A resposta você dá na consulta ou pelo canal que já usa")
- Test: `src/modules/mensagens/envio.test.ts`, `src/modules/ia/nutri-paciente/{duvidas,conversa,lgpd}.test.ts`, telas

**Interfaces:**
```ts
export async function responderDuvidaPelaConversa(ctx, duvidaId: string, i: { texto: string }, db?): Promise<{ id: string } | 'ja_tratada' | 'nao_liberada' | ErroDeEnvio>;
```
- Ordem: paciente (`FOR SHARE`) → conversa (`FOR NO KEY UPDATE`, RN-447 v0.3; liberada, não pausada, titular ativo) → `ia_nutri_mensagens` (`FOR UPDATE`, reconfere aberta e sem selo `risco_revogado`/`aviso_minimo`) → INSERT da mensagem com `duvida_em` = `created_at` da dúvida → UPDATE da dúvida (`resolucao = 'respondida'`, `resolvida_em`, `resolvida_por`, `aberta_pela_nutri_em = coalesce(…, now())`) → `avisarPaciente('chat_mensagem')`. Sem `duvida_vista`. O texto da dúvida não é copiado (CH-D13).

- [ ] **Step 1: Testes que falham:** resposta resolve a dúvida na mesma transação e sai da fila (`filaDeDuvidas`, `contadorDeDuvidas`); corrida com "Marcar como vista" em duas conexões → um vence, o outro recebe `ja_tratada` sem gravar nada, sem 40P01; dúvida com selo `risco_revogado` **ou `aviso_minimo`** não oferece o botão (RN-460); `?duvida=` de dúvida que já saiu (180 dias) ou de outro paciente → sem faixa e "Esta dúvida não está mais disponível."; a mensagem antiga com `duvida_em` mostra "Resposta à dúvida enviada pela IA Nutri em {data}" sem link; conversa não liberada → `nao_liberada`; push de mensagem, nenhum `duvida_vista`; a ficha e o portal mostram "respondida"; exportação com `situacaoDaDuvida` "Respondida em Mensagens"; a mensagem não contém o texto da dúvida; o gatilho `ia_nutri_mensagens_regras` não mudou (a equipe grava `resolvida_por` = a própria usuária); "Ver a pergunta" com `target="_blank"` e o aviso "abre em nova aba".
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/modules/mensagens src/modules/ia/nutri-paciente src/app/painel/duvidas src/app/p src/modules/ajuda`); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** E2E (`10.9.25.50`–`.59`): dúvida aberta → "Responder na conversa" → enviar → sai da fila → no portal, "Sua nutricionista respondeu em Mensagens." → "Abrir Mensagens". A semente cria, **a cada execução**, no tenant novo do E2E do chat, um paciente novo com a IA Nutri ativada e uma dúvida aberta (por `withTenant` nas sessões de sempre): reaproveitar um consultório deixaria a conversa liberada para sempre (DELETE revogado, liberação imutável) e a 2ª execução divergiria (RLS Minor 10).
- [ ] **Step 6:** commit `feat(mensagens): dúvida respondida pela conversa (P25-09)`.

**Revisores:** `revisor-rls` (ordem de travas, corrida, `ia_nutri_mensagens`), `revisor-interface` (faixa, nova aba, retornos), `normas-cfn-lgpd` (só CFN: resposta escrita como telenutrição e prontuário, a dica da faixa).

**Pronto quando:** testes e E2E verdes; revisões sem Critical/Important.

---

### Task 10: Recados (PR 3)

**Files:**
- Create: `src/modules/mensagens/recados.ts`, `src/app/painel/mensagens/recados/{page.tsx,novo/page.tsx,actions.ts,recado-form.tsx}`
- Modify: `src/app/painel/mensagens/abas.tsx` (aba "Recados"), `src/modules/ajuda/conteudo.ts` (guia `mensagens` 1 → 2 com os passos de Recados e Novo recado), `e2e/painel-rotas.ts`, `docs/operacao/mensagens.md`. A cópia do recado na conversa (rótulo e carimbo) já é exibida desde a T6b e a T7 (CH-D68); aqui só se confere com recados reais
- Test: `src/modules/mensagens/recados.test.ts`, telas

**Interfaces:**
```ts
export type FiltroDoRecado = { tipo: 'todos' } | { tipo: 'etiquetas'; ids: string[] } | { tipo: 'local'; id: string } /* T11 */;
export async function alcanceDoRecado(ctx, f: FiltroDoRecado, db?): Promise<{ comApp: number; semApp: number }>;
export async function enviarRecado(ctx, i: { texto: string; filtro: FiltroDoRecado }, db?): Promise<{ id: string; destinatarios: number } | ErroDoRecado>;
export async function listarRecados(ctx, o: { pagina?: number }, db?): Promise<{ itens: ItemDoRecado[]; haMais: boolean }>; // sem auditRead
```
- `enviarRecado`: trava `recados-tenant` → teto 10/dia (no fuso) → recalcula o alcance (ativos, não anonimizados, com conta, etiquetas "qualquer") → teto 500 → pacientes `FOR SHARE` em ordem de `id` → INSERT em `recados` → conversas que faltam (`INSERT … ON CONFLICT DO NOTHING`, sem liberação) → INSERT em lote das cópias → `notifications` em lote (push `recado`, sem e-mail; agrupado pela RN-456) → `dispararEnvio` uma vez. `filtro_rotulo` gravado no envio.
- "Lido por {l} de {n}": uma consulta agregada sobre as cópias × `chat_leituras` do lado `paciente`.

- [ ] **Step 1: Testes que falham:** alcance por todos e por etiquetas ("qualquer"), sem conta contado à parte (singular e plural); envio recalcula sob a trava e devolve o número real; 500 → erro; 10/dia no fuso (11º → erro; virada do dia em `America/Sao_Paulo`); arquivado/bloqueado/anonimizado fora do alcance e recusado pelo gatilho se entrar; cópia com carimbo; conversa criada sem liberação não aparece na caixa (CH-D42) e o paciente vê só leitura; push `recado` sem e-mail; recado × envio individual concorrente sem 40P01; etiqueta de outro consultório no filtro → recusada (nenhum paciente de fora no alcance) e 11 etiquetas → "Escolha no máximo 10 etiquetas." (RN-462); `page.tsx` e actions novas com `requireNutri` (teste de fonte do 26, se na `main`); 500 destinatários numa transação em < 5 s (RNF-442, teste marcado `*.tempo.test.ts`); histórico sem `auditRead`, com "Lido por"; `recados` sem UPDATE/DELETE; a paciente não lê `recados`; formulário: "Revisar" é a confirmação, "Voltar e editar" devolve texto e etiquetas, revisão sem ninguém não oferece "Enviar recado".
- [ ] **Step 2–4:** FAIL → implementar → PASS (`pnpm vitest run src/modules/mensagens src/app/painel/mensagens src/modules/ajuda`); `pnpm test:tempo` para o de 500; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** E2E (`10.9.25.60`–`.69`): recado por etiqueta → o paciente vê na conversa → "Lido por 1 de 1"; axe de Recados e Novo recado nos dois temas. Fechamento do PR 3: `ROTAS_DO_PAINEL`; manual técnico pelo `guardiao-manual` nos mesmos capítulos do fechamento do PR 2 (T7) com o que o PR 3 mudou — `02` (fila `chat-anexo`, varredura, `recados`), `04` (aba IA Nutri, "Respondida em Mensagens"), `05` (anexos, recados), `06-worker-seguranca-operacao.md` (job, varredura, runbook), `07` (teste de tempo de 500 destinatários), `10-ia.md` (dúvida `respondida`, "Responder na conversa") e o `README.md`; textos da Central de Ajuda e do manual do usuário do PR 3 em `../.sessoes/plano25-ajuda-pr3.md` para a orquestradora publicar depois do merge (CH-D64); "Volta atrás".
- [ ] **Step 6:** commit `feat(mensagens): recados (P25-10)`.

**Revisores:** `revisor-rls` (travas, lote, `staff_only`), `revisor-interface` (dois passos, tabela, singulares), `normas-cfn-lgpd` (só CFN: ajuda do recado, CH-D18, P-CH2), `guardiao-manual` (fechamento do PR 3).

**Pronto quando:** testes, E2E e axe verdes; o PR 3 inteiro com a revisão final do branch.

---

### Task 11: Fase B — recado por local de atendimento (PR 4, com portão)

**Portão:** o Plano 23 PR 2 na `main` (`locais_atendimento`, `appointments.local_id` e a função do filtro de local da RN-436 do 23). Reconferir o nome e a assinatura da função no momento; o recado **reaproveita** a função, sem cópia — a mesma que o Plano 26 usa nos relatórios por local: 23, 25 e 26 chamam uma função só.

**Files:**
- Modify: `src/modules/mensagens/recados.ts` (`{ tipo: 'local', id }`; `filtro_rotulo` "Local: {nome}"), `src/app/painel/mensagens/recados/novo/**` ("Pacientes atendidos no local" e o seletor dos locais ativos), `src/modules/ajuda/conteudo.ts` (um passo no guia `mensagens`, sem subir a versão de novo se a T10 ainda não tiver ido para produção; senão + 1)
- Test: `src/modules/mensagens/recados.test.ts` (casos de local)

- [ ] **Step 1: Testes que falham:** alcance por local conta só pacientes com consulta no local fora de `cancelada` e `solicitada` (RN-436 do 23); local arquivado fora do seletor; local de outro tenant recusado; rótulo gravado; recado por local não muda as regras de alcance da T10.
- [ ] **Step 2–4:** FAIL → implementar → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(mensagens): recado por local (P25-11)`.

**Revisores:** `revisor-rls` (filtro pela função do 23, isolamento por tenant).

**Pronto quando:** testes verdes; revisão sem Critical/Important.

---

### Task 12: Fechamento do plano

**Files:**
- Modify: conferência final do manual técnico pelo `guardiao-manual` em todos os capítulos tocados nos fechamentos dos PRs 2 e 3 — `01`, `02`, `03`, `04`, `05`, `06`, `07`, `10` e o índice/glossário do `README.md` — e o que a Fase B mudou, `CLAUDE.md` (conferir as frases do Plano 25 nas regras 1, 2, 8 e 9), `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md` (PD-90 e PD-91 entregues; itens da §2.2 "Fora" e o andamento do upload em %), `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md` (linha do Plano 25), a spec (decisões CH-D49 em diante; tabela "Textos de interface"), `docs/operacao/mensagens.md` (runbook completo e CS-445)
- Manual do usuário (Docs) e Central de Ajuda: já publicados por PR (CH-D64); aqui só a conferência final e o que a Fase B acrescentar (recado por local); textos ao paciente no pacote do advogado (E-09) só se o dono pedir (a LGPD está fora deste plano)
- Carga: `test/carga/{seed.ts,cenario.js}` — cenário "Caixa com 300 conversas", "Conversa com 500 mensagens" (CS-443) e "Situação" (RNF-440: p95 ≤ 100 ms), só acrescentar; a semente grava as mensagens por `withTenant` com as sessões `nutri` e `paciente` (o gatilho carimba e recusa o `worker`; sem papel, o gatilho devolve `NEW` cedo e o carimbo ficaria por conta da semente — RLS Minor 11)
- E2E completo: `e2e/mensagens.spec.ts`, `e2e/ia-nutri-paciente.spec.ts`, `e2e/portal.spec.ts`, `e2e/acessibilidade*.spec.ts`

- [ ] **Step 1:** guias e testes (`pnpm vitest run src/modules/ajuda`): cada rótulo citado entre aspas existe num `.tsx` ou em `src/modules/mensagens`; versões subidas uma vez por plano sobre a da `main`.
- [ ] **Step 2:** manuais e documentos acima.
- [ ] **Step 3:** `pnpm test` inteiro (escalonado), `pnpm test:tempo`, `pnpm lint`, `pnpm typecheck`, E2E completo, pilha de carga (CS-443: p95 ≤ 800 ms; RNF-440: situação p95 ≤ 100 ms).
- [ ] **Step 4:** CS-445 combinado com a Debby (2 semanas atendendo por Mensagens), registrado no runbook.
- [ ] **Step 5:** commit `docs(mensagens): fechamento do Plano 25 (P25-12)`.

**Revisores:** `guardiao-manual` (manuais, ajuda), `revisor-interface` (guias do painel e do portal), `normas-cfn-lgpd` (só CFN: conferência final dos textos normativos e das pendências P-CH1 a P-CH6).

---

## Depois das tarefas (fluxo do CLAUDE.md)

Para cada PR (1, 2, 3 e 4): revisão final do branch (workflow, com `revisor-rls` — gatilhos, políticas, funções `SECURITY DEFINER`, travas, `auditRead`, regra 9 —, `normas-cfn-lgpd` só CFN — telenutrição, identificação profissional, recados —, `revisor-interface` — foco, região viva, 400 px, dois temas, offline — e `guardiao-manual`) → uma onda de correções → `/code-review high` no PR **uma vez** → correções Critical/Important (Minor para o backlog) → re-revisão **só do diff das correções** → `/security-review`. Se sobrar Critical/Important confirmado depois da re-revisão, parar e avisar o dono. A sessão avisa a orquestradora a cada etapa (início, PR aberto, CI verde, revisão, pronto para merge) para o painel do backlog Paridade Dietbox. Merge só com OK do dono.

Agentes por tarefa: `revisor-rls` (T1a, T1b, T1c, T2, T3, T4, T5, T8a, T8b, T9, T10, T11), `normas-cfn-lgpd` só CFN (T2, T4, T5, T6b, T7, T9, T10, T12), `revisor-interface` (T6a, T6b, T6c, T7, T8a, T8b, T9, T10, T12), `guardiao-manual` (fechamento dos PRs 2 e 3, na T7 e na T10 — manual técnico e os textos da Central de Ajuda e do manual do usuário —, e a T12).

---

## Conferência do plano contra o código (17/11/2026)

Feita no worktree `nutridebby-25` (`main` 07756c4 + spec v0.2) e nos worktrees da onda. O que a spec não dizia ou dizia de outro jeito, e como o plano trata:

| Achado | Onde no código | Tratamento |
|---|---|---|
| A varredura dos envios de exame roda de 15 em 15 min (`expirar-exame-envio`), não por dia | `src/worker/index.ts:320-323` | RN-474 corrigida na spec; agendamento próprio `expirar-chat-anexo` de 15 min (T8) |
| `SecaoDaFicha.resumo` já devolve `podeAdicionar` | `src/modules/ficha/tipos.ts:55` | O "Enviar mensagem" some com o titular inativo por `podeAdicionar: false`; só `rotuloDoTotal?` é novo (T6) |
| `caminhoNaFicha` devolve o href absoluto sem troca | `src/modules/ficha/adicionar.ts:19` | Troca de `{id}` nessa função (CH-D44, T6) |
| Os tenants do isolamento nascem só com `slug` e `nomeExibicao` | `test/isolamento.test.ts:287-293` | `beforeAll` grava o carimbo (o gatilho exige) (T1) |
| `listTenantTables` ordena por nome: `chat_conversas` antes de `chat_leituras` e `chat_mensagens` | `src/db/rls-guard.ts:49`, `test/isolamento.test.ts:299` | Fábricas sem `COM_MAE` (CH-D38, T1) |
| Toda navegação do portal sem rede cai em `planoGuardado()` | `src/app/sw.ts:36`, `:166-167` | `/p/mensagens` fora do matcher e do cache (RN-473, T7) |
| O layout do painel não refaz na navegação pelo cliente | `src/app/painel/layout.tsx:28-36` | Consulta de 60 s do contador (CH-D43, T6) |
| `detectarRisco` devolve `emergencia` também para sintoma agudo | `src/modules/ia/nutri-paciente/sinais-risco.ts:38-42` | Gravação pelo `textoFixo` (RN-449, T3) |
| Um consultório = uma conta `nutri` | `src/modules/plataforma/contas.ts:61-81`; spec de documentos, B-01 | Carimbo do consultório (CH-D37) |
| Semente do E2E: só alguns tenants têm `nomeProfissional` | `scripts/e2e-seed.ts:90`, `:244` | Tenant próprio do E2E do chat com carimbo, novo a cada execução (T1, T6) |
| `anonimizarVencidos` filtra `anonimizar_apos < hoje` | `src/modules/pacientes/lgpd.ts:519-527` | A mesma regra em `app_chat_apagar_do_titular` (T1c) |
| `TipoDeArquivo` e `TIPOS_DO_PACIENTE` são listas TS fechadas | `src/modules/plataforma/armazenamento.ts:16-24` | Só na T8 (os CHECKs já no PR 1); o 21 também acrescenta |
| `TSX_FORA` não tem `src/modules/mensagens` | `src/modules/ajuda/conteudo.test.ts:13` | Entra na T6 |
| Guias que citam "Dúvidas dos pacientes" e testes do menu | `conteudo.ts:20,32,288,302,371,383`; `navegacao.test.ts:43-47`; três E2E | T6a/T6c (menu, `boas-vindas`, `configuracoes`) e T9 (`duvidas`) |
| (revisão do plano) O teste da P2 roda `delete` sem savepoint em toda tabela com titular fora de `SO_INSERE` e de `SEM_DELETE_DO_PACIENTE` | `test/isolamento.test.ts:334`, `:556`, `:571` | `chat_conversas` e `chat_leituras` em `SEM_DELETE_DO_PACIENTE` (CH-D58, T1a) |
| (revisão do plano) O `beforeAll` monta o contexto só para `nutri` e `worker`; `assertContext` exige `patientId` e ator para `paciente` | `test/isolamento.test.ts:310-314`; `src/db/tenant.ts:53-62` | `beforeAll` aceita fábrica de `paciente` (CH-D58, T1a; troca no corpo, avisada no §6) |
| (revisão do plano) `app_current_role()` não valida o valor e a `tenant_isolation` não olha o papel | `drizzle/0000_base_roles_e_rls.sql:27-28`; `drizzle/0070_paciente_sem_escrita.sql` (`app_enable_tenant_rls`) | Lista fechada de papéis que devolvem `NEW`; papel desconhecido com falha fechada (CH-D57, T1b) |
| (revisão do plano) `motivoParaIgnorar` é puro; o contexto vem de `carregarContexto` | `src/modules/notificacoes/enviar.ts:18`, `:48-60`, `:266-276` | Campo `chatNaoLido` em `ContextoEnvio` (CH-D62, T4) |
| (revisão do plano) `emHorarioSilencioso` e `fimDoSilencio` já existem; `segurarAtrasados` só trata lembretes | `src/modules/notificacoes/agendar.ts:14-23`; `enviar.ts:200-229` | Reaproveitados; o e-mail do chat calcula o próprio adiamento ao nascer (CH-D61, T4) |
| (revisão do plano) `gravarArquivos` apaga `.tmp` e arquivo já renomeado quando a transação falha | `src/modules/plataforma/armazenamento.ts:176-210` | O `registrar` recusado do job não deixa JPEG órfão (descarte parcial do RLS Minor 4); a trava do consultório vai no `antesDaReserva` (RLS Minor 2, T8a) |
| (revisão do plano) `anonimizarVencidos` calcula "hoje" com `hojeNoFuso(t.fuso)` | `src/modules/pacientes/lgpd.ts:509`, `:526` | `app_chat_apagar_do_titular` no fuso do consultório (T1c) |
| (revisão do plano) O guia genérico `configuracoes` casa com `/painel/configuracoes/mensagens` | `src/modules/ajuda/conteudo.ts:346-348` | Guia `configuracoes-mensagens` antes dele (T6c) |

---

## Coordenação

Conferido com `git diff --name-only 07756c4...HEAD` em cada worktree em 17/11/2026: `nutridebby-b` (`plano-19-seed-usda`, 67b21d3), `origin/plano-20-financeiro`, `nutridebby-21` (`plano-21-avaliacao-fisica`, 1dab109), `nutridebby-22` (`plano-22-exames-prescricao`, 0d1ab95), `nutridebby-c` (`plano-23-agenda-2`, f660f60) e a spec do 26 em `nutridebby-26`. Os branches andam: reconferir na T1 (antes do §5), no começo do PR 2 e na T11.

| Onde | Quem | Conflito | Como resolver |
|---|---|---|---|
| `drizzle/` | 19 (0124–0134 no branch), 21 (0124–0125), 22 (0126–0127), 23 (0126–0127) | Números, journal e `when` | §5: o PR 1 gera de novo sobre a `main` do momento; nada reservado; um PR com migration por vez na fila |
| CHECK `notifications_tipo_valido`, `src/modules/notificacoes/{tipos,mensagens,enviar}.ts` | 23 (`aniversario`, `pedido_nao_confirmado`, avisos sem consulta, motivos novos); 26 (`TIPOS_DA_AGENDA`) | Tipos, `case` e caminho do e-mail sem consulta | Na regeneração, partir do CHECK da `main` e acrescentar no fim; o caminho de e-mail sem consulta é criado por quem entrar primeiro, o outro só acrescenta o tipo; os tipos do 25 ficam fora de `TIPOS_DA_AGENDA` do 26 |
| CHECK `stored_files_tipo_valido`, `armazenamento.ts`, `paciente_arquivo_insert` | 21 (`avaliacao_foto`, `avaliacao_anexo`; `armazenamento.ts` no branch) | Tipos e política | Partir da `main`; se o 21 refizer `paciente_arquivo_insert`, a custom do 25 parte da versão dele |
| `test/isolamento.test.ts`, `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `CLAUDE.md` | 19, 21, 22, 23 | Entradas novas | Só acrescentar; `SO_APAGA.patients` com a linha do 25 no fim |
| `src/db/migrate-owner.test.ts` | 19 (TACO), 23 (`describe` + backfill por último) | `describe` do 25 | Só acrescentar, **antes** do bloco de backfill do 23 se ele já estiver na `main` (o do 23 roda em todos os tenants e fica por último) |
| `src/app/painel/navegacao.ts` (+ teste), `layout.tsx`, `cabecalho.tsx` | 20 PR 2 ("Financeiro" entre "Conteúdos" e "Configurações"); 26 (filtro por papel, "Relatórios") | `ITEM_MENSAGENS` no lugar de `ITEM_DUVIDAS` | PR 2 depois do 20 PR 2; "Mensagens" na posição de "Dúvidas dos pacientes" (antes de "Conteúdos"); se o 26 entrar antes, o item e a consulta de 60 s ficam fora do menu e do layout da recepção |
| `src/modules/pacientes/{exportacao-job,lgpd}.ts` (+ testes) | 19, 20 PR 2, 21, 22, 23 | Seções e passos novos | Só acrescentar, em linhas próprias; a rede de limpeza ao lado da do 18 |
| `src/email/{types.ts,templates.tsx}`, `render.test.ts` | 20 PR 2, 23 | Modelos | Só no fim |
| `src/jobs/queues.ts`, `src/worker/index.ts` | 19 (`plano-pdf-2`), 22 (`documento-pdf-2`, `documento-digitalizado-2`) | Fila `chat-anexo` e o agendamento | Linhas novas no fim (T8, PR 3) |
| `src/app/painel/configuracoes/page.tsx` (`CARTOES`) e guia `configuracoes` | 19 (três cartões), 22 (dois), 23 (Locais) | Cartão "Atendimento por mensagens" e versão do guia | Cartão no fim; a versão sobe uma vez sobre a da `main` no rebase |
| `src/modules/ajuda/{conteudo,portal}.ts` (+ testes) | 19, 20 PR 2, 21 | Guias `boas-vindas`, `configuracoes`, `duvidas`, portal | Só acrescentar passos; versão + 1 uma vez cada por plano, sobre a da `main` |
| `src/modules/ficha/{tipos,adicionar}.ts`, `secoes/index.ts` | 23 (seção "Consultas") | `rotuloDoTotal?`, `{id}`, seção nova | Membro opcional e uma linha no fim; a troca de `{id}` não afeta hrefs sem o marcador |
| `src/components/dialogo.tsx` | 22 T2, 23 PR 3 | Diálogo compartilhado | Quem entrar primeiro cria com a interface do 22 T2; o 25 reaproveita, sem cópia |
| `e2e/painel-rotas.ts`, `scripts/e2e-seed.ts`, `e2e/acessibilidade*.spec.ts` | todos | Rotas, semente, laço do axe | Só acrescentar; bloco de IP `10.9.25.x`; tenant e pacientes novos do 25 a cada execução |
| Recado por local | 23 (RN-436, `locais_atendimento`) | Função do filtro | T11 só depois do 23 PR 2; reaproveitar a função, sem cópia; o 23 continua sem "campanhas" (o recado é aviso administrativo no app, CH-D18) |
| Recepcionista | 26 (RN-505, RN-507, PM-R13) | Tabelas, menu, tipos de notificação | Nada do 25 liberado à recepção; quem entrar depois acrescenta às listas do outro |
| `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO`, `acaoDoItem`, `visivelNoHistorico`) | 21 e 22 (já mexem nos branches: `nutridebby-21` 8622137, `nutridebby-22` f57e2d6) | Rótulos e o filtro de `visivelNoHistorico` | Só acrescentar: entradas no fim do objeto e o `and not (entidade = 'chat_conversa')` como linha própria no fim da expressão (T2) |
| `src/modules/ajuda/portal.ts` (+ teste) | 19 (já sobe a versão do `portal-novidades` no `nutridebby-b`) | Versão e "Perguntas comuns" | A versão sobe uma vez sobre a da `main` do momento (T7) |
| `src/modules/notificacoes/enviar.ts` (`ContextoEnvio`, `carregarContexto`, `motivoParaIgnorar`) | 23 (motivos novos, em PR futuro) | Campo novo e regra nova | Membro opcional no fim do tipo, consulta própria no carregador, regra antes do retorno dos tipos sem consulta (T4) |
| `test/isolamento.test.ts` (corpo do `beforeAll`) | todos | O `beforeAll` passa a aceitar fábrica de `paciente` (CH-D58) | **Não é só acréscimo:** avisar a orquestradora antes do PR 1; no rebase, ficar com o corpo da `main` e reaplicar só a montagem do contexto de `paciente` |
| Guardas do Plano 26 (`FUNCOES_COM_PAPEL`, teste de `TIPOS_DA_AGENDA`, teste de fonte das rotas) | 26 (RN-507, RN-511, RN-513) | Funções, tipos e rotas do 25 sem decisão quebram o CI do 25 se o 26 entrar antes | Passos condicionais na T1a, T1b, T1c, T6a–c, T8a, T9 e T10 (CH-D65); se o 25 entrar antes, o 26 acrescenta |
| Numeração | 23 (400–439), 26 (480–519) | — | 25 em 440–479; decisões CH-Dn |

**Ordem no trem (proposta; a orquestradora decide):** os PRs 1 (fundação) de 19, 21, 22, 23 e 25 entram um por vez na fila de migrations, na ordem em que ficarem prontos; o 25 PR 1 não depende de nenhum deles. O 25 PR 2 espera o próprio PR 1 e o 20 PR 2 (menu e exportação). O 25 PR 3 espera o PR 2. O 25 PR 4 espera o 23 PR 2. Cada PR faz rebase e roda o CI depois do deploy do anterior. Com o 26 em paralelo, o que entrar depois acrescenta as tabelas, o menu e os tipos do outro às listas de negação da recepção.

---

## Decisões

### Decisões da spec que este plano usa

CH-D1 a CH-D48 (spec §14.1, v0.2), todas. As que mudam a forma das tarefas: CH-D2, CH-D24 e CH-D25 (prontuário, apagar só na anonimização: T5), CH-D3 (formas do TCLE: T1, T2, T6), CH-D4 (sem tempo real: T3, T6, T7), CH-D9, CH-D10 e CH-D16 (avisos: T4, T10), CH-D13 e CH-D14 (fila e menu: T6, T9), CH-D15 e CH-D48 (portal: T7), CH-D17, CH-D18 e CH-D42 (recados e caixa: T3, T10), CH-D20 e CH-D37 (carimbo: T1, T2, T6, T7), CH-D26 e CH-D44 (ficha: T6), CH-D31 (migrations: T1), CH-D38 (isolamento: T1), CH-D39 (auditoria: T2), CH-D40 (cursores: T3), CH-D41 (`removido`: T1, T5, T8), CH-D43 (contador: T6), CH-D45 (nome da fila: T6, T9), CH-D46 (offline e prefetch: T6, T7), CH-D47 (`paciente_com_conta`: T1).

### Decisões novas deste plano (vão para a spec na T12)

| ID | Decisão | Porquê |
|---|---|---|
| CH-D49 | **O código roda na sessão de letra que a orquestradora liberar primeiro na onda 3**; o worktree `../nutridebby-25` (só documento) é removido antes, com OK do dono | O `sessao-paralela.sh` só conhece `a`, `b` e `c`, e o git não deixa o mesmo branch em dois worktrees (molde da AG-D46 do 23) |
| CH-D50 | **Bloco de IP do E2E `10.9.25.x`** (`.1`–`.19` painel, `.20`–`.39` portal, `.40`–`.49` anexos, `.50`–`.59` dúvida, `.60`–`.69` recados) | Regra da orquestradora (sufixo = número do plano); livre em todos os worktrees em 17/11/2026 |
| CH-D51 | **Funções `SECURITY DEFINER` testadas num `describe` novo de `src/db/migrate-owner.test.ts`** | É o único cluster com dono `NOBYPASSRLS`, como em produção; com o dono superusuário dos outros testes, as funções passariam sem provar nada |
| CH-D52 | **Runbook `docs/operacao/mensagens.md` criado na T1 e completado por PR**, com a seção "Volta atrás" também na descrição de cada PR | A volta atrás tem efeitos diferentes por PR (§9.9 da spec); quem faz o deploy precisa deles no PR |
| CH-D53 | **T1 em três subtarefas (a, b, c) num PR só**, cada uma com TDD, commit e revisão do `revisor-rls` | A custom é uma só, mas o volume (seis tabelas, quatro gatilhos, três funções) pede revisão em partes (molde AG-D69) |
| CH-D54 | **Quatro PRs: fundação; conversa de texto (com exportação e anonimização); anexos, dúvida e recados; Fase B** | A conversa não vai a produção sem os direitos do titular (exportação e anonimização no mesmo PR); anexos e recados pesam na revisão e ficam juntos num PR sem migration; a Fase B tem portão próprio |
| CH-D55 | **Guias por PR:** `mensagens` (v1), `configuracoes-mensagens` (v1, revisão do plano) e `boas-vindas`/`configuracoes` + 1 no PR 2; `duvidas` + 1 e `mensagens` + 1 no PR 3 | A guarda "%s tem guia" e a de rótulos existentes quebram no mesmo PR da tela; a fila só muda de sentido ("Responder na conversa") no PR 3 |
| CH-D56 | **Antes do merge do PR 2, o perfil do consultório da Debby com nome profissional e CRN** (conferido pelo dono no painel; nada pelo banco) | Sem o carimbo, a liberação é recusada (RN-475); a conferência é de tela, sem tocar produção |
| CH-D57 | **Os gatilhos devolvem `NEW` sempre que a RLS já recusa aquele papel naquele comando** — outro tenant; paciente com outro `patient_id`; a lista fechada `publico`, `conta`, `recepcao`; e a sessão de paciente em `chat_conversas` e `recados` —, e **papel desconhecido recebe o 42501 do gatilho** (falha fechada) | Os testes D1 e de `staff_only` do isolamento rodam a fábrica como P2 no próprio paciente; a `recepcao` do 26 espera erro de RLS em todas as fábricas; `app_current_role()` não valida o valor e a `tenant_isolation` não olha o papel, então um `NEW` para papel que a RLS não conhece abriria a escrita (RLS I-3, completude I2) |
| CH-D58 | **`chat_conversas` e `chat_leituras` em `SEM_DELETE_DO_PACIENTE`; a fábrica de `chat_leituras` roda pela sessão de paciente (`PAPEL_DA_FABRICA`, com o `beforeAll` aceitando `paciente`); o gatilho de `chat_leituras` confere lado × papel só no INSERT e com `lida_ate` mudando** | Com o DELETE revogado, a P2 receberia 42501 de permissão no teste sem savepoint; sem linha `lado = 'paciente'`, o UPDATE da P2 daria 0 linhas e o "mover para P1" não recusaria nada; o `set tenant_id = tenant_id` da equipe não é escrita do lado do paciente (RLS I-1, I-2) |
| CH-D59 | **Na anonimização, primeiro os `anexo_original_path`, depois os `anexo_path`; `app_chat_soltar_anexo` recusa o `anexo_path` enquanto houver original** | A mensagem `pronto` com o original preso existe por desenho; soltar o `anexo_path` antes dá 23514 no CHECK `removido ⇒ sem caminhos`, o `try` de `anonimizarVencidos` engole o erro e o titular nunca é anonimizado (RLS I-4) |
| CH-D60 | **Caminhos do anexo fixos e amarrados ao `stored_files` do mesmo tenant, paciente e tipo, no gatilho, para todos os papéis; CHECK `sem_anexo ⇒ sem caminhos`** | A FK é só por `caminho` e o CHECK só pelo prefixo do tenant: um erro de mapeamento no job ou no envio apontaria a mensagem de A para a foto de B, que A baixaria; e um original apontado por `sem_anexo` escaparia da varredura (RLS I-5) |
| CH-D61 | **Avisos ao paciente agrupados por tipo; o e-mail do chat também respeita o silêncio (21h–8h); sem helper novo de horário** (`emHorarioSilencioso`, `fimDoSilencio`) | Com o agrupamento dos dois tipos, um push de recado pendente engolia o e-mail da mensagem individual (recado não tem e-mail); push às 20h45 levava o e-mail para 21h15; os helpers já existem em `agendar.ts` (completude I5) |
| CH-D62 | **`mensagem_lida` por um campo novo de `ContextoEnvio` (`chatNaoLido`), carregado em `carregarContexto` só para os tipos do chat; `motivoParaIgnorar` continua puro** | Hoje `motivoParaIgnorar` não consulta o banco; pôr SQL nele quebraria o desenho e os testes de unidade (completude I4) |
| CH-D63 | **T6 em T6a/T6b/T6c e T8 em T8a/T8b** (subtarefas, molde CH-D53), mantendo 12 tarefas | A T6 juntava caixa, conversa, nova conversa, configuração, menu, ficha, guias, quatro E2E e duas APIs; a T8 quatro rotas, job, varredura, duas interfaces de upload e o ZIP (completude G1, G2) |
| CH-D64 | **Central de Ajuda e manual do usuário (Docs) no fechamento dos PRs 2 e 3: o `guardiao-manual` prepara os textos em `../.sessoes/plano25-ajuda-pr<n>.md`, a orquestradora publica depois do merge; a T12 roda depois do último PR entregue (o PR 3, se a Fase B virar o Plano 25B)** | A conversa e o menu mudam em produção no PR 2; esperar a T12 (atrás do portão do 23) deixaria a Debby e os pacientes sem artigo e os artigos de "Dúvidas dos pacientes" errados (completude M2, M3) |
| CH-D65 | **Guardas do Plano 26 tratadas por passo condicional**: os quatro gatilhos em `FUNCOES_COM_PAPEL` com "não se aplica", as três funções `SECURITY DEFINER` com "recusa", `chat_mensagem`/`recado` fora de `TIPOS_DA_AGENDA`, toda rota nova com `requireNutri`/`requireApiNutri` | Se o 26 PR 2 entrar antes, o CI do 25 quebra em cada uma (completude I1, I3) |
| CH-D66 | **"Nova conversa": titulares `ativo` não anonimizados, com ou sem conversa, ordem alfabética, 50 por página, busca por nome, "Sem acesso ao app", sem `auditRead`** | É uma lista de pacientes (precedente da lista de pacientes, regra 8); arquivado e bloqueado teriam conversa só leitura (completude I6) |
| CH-D67 | **`criada_em`/`criado_em` com `default clock_timestamp()` no esquema e as fábricas de `chat_mensagens` e `recados` com o carimbo; sementes (E2E e carga) sempre por `withTenant` com papel** | A T1a fica verde sem os gatilhos da T1b; sem papel, o gatilho devolve `NEW` cedo (RLS Minor 1, 11) |
| CH-D68 | **A cópia do recado na conversa (rótulo e carimbo) é exibida desde o PR 2 (T6b, T7); a T10 só cria recados** | A T6 já pedia axe com recado na semente e a T7 já testava o rótulo; a conversa tem de mostrar qualquer linha que o banco aceita (RLS Minor 9) |
| CH-D69 | **Textos novos (spec §6.2 v0.3):** conversa de titular anonimizado; `notFound()` para id inexistente ou de outro consultório; códigos fechados de `?erro=` sem JS; "Esta dúvida não está mais disponível."; erro de cota e genérico no portal; item de "Perguntas comuns" sobre urgência e prontuário | Telas que a spec não cobria (completude, Minor de telas) |

## Revisão do plano (17/11/2026)

Duas revisões sobre este plano e a spec v0.2: `revisor-rls` (contra `test/isolamento.test.ts`, `src/db/tenant.ts`, migrations 0000, 0070, 0102 e 0116, `pacientes/lgpd.ts`, `armazenamento.ts` e `ia/nutri-paciente/duvidas.ts`) e a crítica de completude (contra o backlog PD-90/PD-91, os branches dos Planos 19, 21, 22 e 23 e a spec do 26). Cada achado foi conferido no código do worktree antes de entrar (tabela "Conferência do plano contra o código", linhas "revisão do plano"). A spec foi para a v0.3 (§17.3 dela).

### O que entrou

| Achado | Onde entrou |
|---|---|
| RLS I-1 (DELETE da P2 com o `REVOKE`) | CH-D58; T1 (Files, Step 1); spec §9.8 |
| RLS I-2 (linha `lado = 'paciente'` para o UPDATE da P2) | CH-D58; T1 (Files, gatilho de `chat_leituras`, nota do isolamento reescrita); spec §9.3, §9.8; "Coordenação" (corpo do `beforeAll`) |
| RLS I-3 e completude I2 (o gatilho e o paciente; a recepção) | CH-D57; T1 (gatilhos, Step 1); Review Focus 1; spec §9.1, §9.2, §9.5. Ajuste nosso: o "fora de `nutri`/`paciente`/`worker`" da spec e da crítica virou lista fechada com falha fechada (ver descartes) |
| RLS I-4 (ordem da soltura) | CH-D59; T1c, T5; spec RN-466, §9.7 |
| RLS I-5 (caminhos fixos e amarrados; CHECK `sem_anexo`) | CH-D60; T1 (Interfaces, gatilho, Step 1), T8; spec §9.2 (f), (g) |
| RLS Minor 1 e 11 | CH-D67; T1, T12 |
| RLS Minor 2 | T8a; spec RN-447 |
| RLS Minor 3 | T1c (função e teste de fuso); spec §9.7 |
| RLS Minor 4 (primeira parte) | T5 (trava do passo 1, job × anonimização) |
| RLS Minor 5 | Global Constraints ("Ids vindos da URL"); T3, T8 |
| RLS Minor 6 | T1c; spec §9.7 |
| RLS Minor 7 | T2; Global Constraints; spec RN-447 |
| RLS Minor 8 | T3, T9; Global Constraints; spec RN-447 |
| RLS Minor 9 | CH-D68; T6b, T10 |
| RLS Minor 10 | T9 (Step 5) |
| Completude I1, I3 | CH-D65; Global Constraints; T1 (Files); T6, T8a, T10; "Coordenação"; spec §13 |
| Completude I4 | CH-D62; T4; "Coordenação"; spec §4.2, RN-456 |
| Completude I5 | CH-D61; T4; spec RN-456, §4.2 |
| Completude I6 (consultas periódicas, US-441, sem JS, nova conversa, sem conta) | CH-D66; T3, T6a, T6b, T7; spec §4.1 |
| Completude G1, G2 | CH-D63; T6, T8 |
| Completude G3 | T2 → T3 (pausar × envio) |
| Completude M1 | T7 e T10 (fechamentos), T12 |
| Completude M2, M3 | CH-D64; "Ordem de entrega"; T7, T10, T12 |
| Completude: guia de `/painel/configuracoes/mensagens` | T6c (guia `configuracoes-mensagens`, `resumo` do `configuracoes`) |
| Completude: textos que faltavam; ajuda do portal | CH-D69; spec §6.2; T6b, T7, T9 |
| Completude: regras com teste parcial (RN-451, 454, 458, 460, 462, 465, 471, 473; RNF-440) | T2 (451, 465), T4 (458), T7 (471, 473), T8a (454), T9 (460), T10 (462), T12 (RNF-440) |
| Completude: conflitos `audit.ts`, `portal.ts`, Fase B com o 26 | "Coordenação"; T7, T11; spec §13 |
| Completude: nome do helper de avisos (spec × plano) | Spec §4.2 v0.3 (corrigida agora, não na T12) |

### O que foi descartado ou ajustado, e por quê

| Achado | Decisão | Por quê |
|---|---|---|
| RLS I-3 / completude I2 — "devolver `NEW` em qualquer papel fora de `nutri`, `paciente` e `worker`", com teste de papel desconhecido saindo com "row-level security" | **Ajustado**: lista fechada (`publico`, `conta`, `recepcao`) e papel desconhecido com o 42501 do gatilho | Conferido em `drizzle/0000_base_roles_e_rls.sql:27-28` e na `app_enable_tenant_rls` (0070): `app_current_role()` devolve o valor cru de `app.role` e a `tenant_isolation` só compara o tenant. Antes do 26, um papel desconhecido com o tenant certo **passa** pela RLS; o gatilho que lhe devolve `NEW` deixaria a escrita entrar sem autoria nem carimbo. A `recepcao` entra nominalmente porque o 26 a nega por padrão (RN-505 dele) |
| RLS Minor 4, segunda parte — "o `registrar` do job deve travar a mensagem e reconferir `processando`; hoje o JPEG vira órfão até a varredura" | **Descartado** | `gravarArquivos` (`armazenamento.ts:206-210`) apaga o `.tmp` e o arquivo já renomeado quando a transação falha, e o `stored_files` volta com ela: a recusa do gatilho não deixa órfão. Trocar a recusa por um UPDATE condicional (0 linhas sem erro) é que deixaria o JPEG registrado sem mensagem. Ficou a regra de tratar a recusa como desistência (T8) e a trava do passo (1) (T5) |
| RLS Minor 1 — "mover para a T1b as entradas do isolamento de `chat_mensagens` e `recados`" | **Descartada a alternativa**; ficou a outra que o próprio achado oferece (fábricas com o carimbo) | Sem fábrica, o teste "toda tabela com tenant_id tem fábrica" quebraria na T1a do mesmo jeito |
| Completude M2 — "dizer quem publica" como pendência do dono | **Resolvido por recomendação** (orquestradora publica, CH-D64) | É o fluxo dos Planos 17 e 18 (textos da sessão em `.sessoes/`, publicação pela sessão orquestradora); não é decisão de produto |
