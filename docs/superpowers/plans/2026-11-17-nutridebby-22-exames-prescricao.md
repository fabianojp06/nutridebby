# Plano 22 — Exames e prescrição — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a nutricionista pede exames num documento assinado e verificável, lança e corrige os resultados a partir de um catálogo do consultório, vê a classificação neutra pela faixa do laudo (e a categoria das faixas dela, com a fonte), escreve a nota de interpretação, compara datas e libera exames escolhidos no app; na receita, ganha a fórmula magistral fitoterápica, orientações com formatação mínima, itens salvos e modelos; o paciente compartilha o PDF assinado com quem ele escolher — tudo dentro das normas que já valem (Res. CFN 599/656/680, Lei 8.234/1991, LGPD).

**Architecture:** seis tabelas novas `staff_only` com `tenant_id`: quatro bibliotecas do consultório sem paciente (`exames_catalogo`, `exames_modelos_solicitacao`, `prescricao_itens_salvos`, `prescricao_modelos`) e duas filhas de `exams`, só de inclusão e auditadas (`exam_interpretacoes`, `exam_versoes`). Em `exams`, a coluna `mostrar_no_app_em` e a política RESTRICTIVE `paciente_exame_liberado` (a RLS decide quais exames o paciente lê; a projeção do portal decide quais campos). Regras puras e sem import do servidor em `src/modules/exames/{classificacao,catalogo-regras,constantes}.ts`, `src/modules/documentos/{marcacao,solicitacao,tipos-de-documento}.ts` e `prescricao.ts`; o resto por `withTenant`. A solicitação é um **tipo novo de documento assinado** (`solicitacao_exames`) sobre a base do Plano 10A, com os ternários de tipo trocados por `switch` + `assertNever` e os PDFs nas filas novas `documento-pdf-2` e `documento-digitalizado-2` (o worker antigo nunca vê um documento que não sabe desenhar). Nada de classificação gravada, nada de IA nova, nenhum tipo novo em `stored_files`.

**Tech Stack:** Node 24 · Next.js 16 (App Router; ler `node_modules/next/dist/docs/` antes de rotas, layouts, Server Actions, Route Handlers e componentes cliente) · Drizzle · PostgreSQL 16 (RLS) · Better Auth · pg-boss · `@react-pdf/renderer` (só no worker) · Zod · Vitest + Testcontainers · Playwright.

**Spec:** `docs/superpowers/specs/2026-11-17-nutridebby-22-exames-prescricao-design.md` **v0.2** (17/11/2026; revisão das quatro lentes na §18, menores na §19; decisões delegadas pelo dono, onda 2: "seguir as recomendações"). Backlog Paridade Dietbox, onda 2, Sessão B: PD-60 a PD-66 e o "Mostrar no aplicativo do paciente". Este plano tem **12 tarefas** (P22-01 a P22-12, PM-E16) em **4 PRs** (EP-D38); as decisões novas do plano são EP-D45 a EP-D59 (fim do documento).

## Ambiente da sessão (Sessão B)

| Item | Valor |
|---|---|
| Worktree | `/home/deploy/servidor/projetos/nutridebby-b` (`../nutridebby-b`) — o da Sessão B (`sessoes-paralelas.md` §3). Hoje ele está com o Plano 19; o Plano 22 só começa lá **depois do fechamento da sessão do 19** (EP-D55). A spec e este plano foram escritos no worktree de spec `../nutridebby-22`, que sai antes do preparo (o git não deixa o mesmo branch em dois worktrees; `git worktree remove ../nutridebby-22` não apaga o branch) — remoção com OK do dono |
| Branch | `plano-22-exames-prescricao` (nasceu de `origin/main` 6c3ee8f; rebase em `origin/main` antes da Tarefa 1). O PR 1 de fundação sai de um branch próprio, `plano-22-fundacao`, a partir dele (ver "Ordem de entrega") |
| Porta | **3102** (`pnpm exec next dev -p 3102`; nunca `pnpm dev`, que fixa a 3100 do principal) |
| Banco | **`nutri_dev_b`** no Postgres de dev (`127.0.0.1:54329`); recriado do zero no preparo (o do Plano 19 tem migrations que o 22 pode não ter: `dropdb` com OK do dono, `sessoes-paralelas.md` §4) |
| Preparar | do worktree principal: `scripts/sessao-paralela.sh b plano-22-exames-prescricao` (cria o worktree `../nutridebby-b`, o `.env.local` com porta e banco, o banco, `pnpm install --frozen-lockfile` e `pnpm db:migrate`; recusa se o worktree existir com outro branch — por isso o fechamento do 19 vem antes) |
| Variáveis | nenhuma `DATABASE_URL`, `DATABASE_URL_MIGRATOR`, `APP_URL` ou `DATA_DIR` exportada no shell; conferir só os nomes: `env \| cut -d= -f1 \| grep -E '^(DATABASE_URL\|APP_URL\|DATA_DIR)'` (saída vazia) |
| Olhar o banco | `docker compose -f ../nutridebby/docker-compose.dev.yml exec db psql -U nutri_owner -d nutri_dev_b` (o MCP `postgres-dev` aponta para o banco do principal; **nunca** produção, regra 5) |
| E2E | `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e <spec>` (a `APP_URL` só nesse comando); parar o `pnpm worker` da sessão antes; **um E2E de cada vez entre as sessões** (Mailpit único). Bloco de IP dos E2E novos: **`10.9.22`** (proposta, EP-D58; em uso hoje: 10.9.{0,2,3,5–8,10–19,26–29,31}; conferir `grep -rhoE "10\.9\.[0-9]+" e2e \| sort -u` antes; a orquestradora fixa) |
| Vitest | `pnpm vitest run <arquivos>` sobe o próprio Postgres (Testcontainers). Suíte inteira (`pnpm test`, `CI=1` na frente de rodadas por diretório que alcancem um `*.tempo.test.ts`) e E2E só quando a orquestradora liberar a CPU (3 sessões, `sessoes-paralelas.md` §2) |

Proibido nesta sessão: tocar produção (nem leitura), `docker service update`, push sem o controlador, merge sem o OK do dono, editar outros worktrees, `nutri-backup.sh`, subagente consultando banco de produção.

## Global Constraints

- **Regras 1, 2, 3, 7, 8 e 9 do `CLAUDE.md`.** Toda consulta às tabelas novas e a `exams` por `withTenant(ctx, fn)` com `actorUserId` e `ip`; o admin nunca consulta. As seis tabelas novas em `STAFF_ONLY`; nada em `PUBLICO_LIBERADO`, `PACIENTE_ESCREVE` nem `CONTEUDO_POR_AUDIENCIA`. `app_enable_audit` em `exam_interpretacoes` (entidade `exames`) e `exam_versoes` (entidade `exames_versoes`); `AUDIT_EXCEPTIONS` não muda. Migrations com `DATABASE_URL_MIGRATOR`. `FABRICAS` de `test/isolamento.test.ts` para as seis. Nenhum `salvarArquivo`/`apagarArquivo` novo e nenhum tipo novo em `stored_files` (C-375): a solicitação usa `documento_base`, `documento_digitalizado` e `documento_assinado` como a receita.
- **Funções dos módulos novos conferem `ctx.role === 'nutri'`** e lançam `Error('exames: só a sessão nutri')` (ou `'prescricao: só a sessão nutri'`) **antes** de abrir a transação (numa sessão de paciente, `staff_only` devolveria vazio em silêncio). Exceção: `src/modules/portal/exames-liberados.ts`, que só aceita sessão de paciente (`pacienteDaSessao`).
- **Migrations** (`sessoes-paralelas.md` §5): número = o que `pnpm db:generate` der em cima da `main` do momento; **nada reservado**; antes de abrir cada PR com migration (PR 1 e PR 4) e de novo se outro PR com migration entrar antes, passos 1 a 8 do §5. Toda edição à mão numa migration gerada leva `-- Plano 22 (editado à mão): …`; as custom (`rls_exames`, `rls_prescricao_modelos`) começam com `-- Plano 22 (editado à mão). Spec §9.7 …` e seguem o formato da `0123_rls_financeiro.sql` (um comando por bloco, `--> statement-breakpoint`). Rodar `src/db/migrate.test.ts` (guarda do `_journal.json`: `when` crescente, `idx` sem buraco) e `src/db/migrate-owner.test.ts` (migra com o migrator sem superusuário, como em produção) a cada regeração. Só expansão (RNF-375): coluna anulável sem default, CHECKs ampliados, tabelas novas.
- **Limites exatos** (spec §6 e §9): catálogo até **500** exames por consultório, nome **1–80**, unidade **≤ 20**, até **10** outros nomes (1–80), painel com **2–30** componentes (1–80, um nível), até **20** faixas por exame, idade **0–130** anos completos, fonte **2–300**, modelo de nota **≤ 1000** por sentido; linhas do exame **até 50** (como hoje), `|x| < 1e15`, `refMin ≤ refMax`; justificativa da edição **5–500** sem NUL; nota **1–2000**; comparativo **2–6** exames; solicitação e modelo de solicitação **1–40** exames (nome 1–80), indicação clínica **≤ 500**, orientações da solicitação **≤ 1000**, da receita e do modelo de prescrição **≤ 2000**; fórmula com **2–10** compostos, posologia **≤ 300**; itens salvos até **300** e modelos de prescrição até **100** por consultório, modelo com **1–20** itens; receita até **20** itens.
- **Números do formulário** só por `lerDecimal` (`src/lib/numero.ts`, o mesmo de `exames.ts`) ou pelo leitor de quantidade de `prescricao.ts`; nunca `parseFloat`/`Number(texto)` solto (RNF-374). Datas `AAAA-MM-DD` no fuso do consultório (`hojeNoFuso`, `src/modules/pacientes/datas.ts`); idade em anos completos por `idadeEm` (mesmo arquivo, puro; EP-D46).
- **Nunca gravar a classificação** nem a categoria (EP-D11): calculadas na leitura, com o catálogo **atual**. O formato de `exams.valores` só ganha as chaves opcionais `refMin`/`refMax` (C-378); `iaTarefaId` só é copiado pelo servidor, pelo índice `origem` da linha original (RN-378).
- **Marcação nunca vira HTML** (RN-395): `lerMarcacao` → blocos → componentes; nenhum `dangerouslySetInnerHTML` em arquivo novo ou alterado (guarda de texto na T9). O portal e a página do link continuam **sem** itens nem orientações (D17 do 10A); a verificação só mostra o rótulo do tipo (D8).
- **Sem IA nova** (C-373, RN-399): nada em `src/modules/ia/**` importa `@/modules/exames/interpretacao` nem contém `exam_interpretacoes`/`exam_versoes`; nada em `src/modules/ia/nutri-paciente/**` importa `exams` de `@/db/schema` nem `@/modules/portal/exames-liberados`; `campos-enviados.ts` intacto.
- **Valores, nomes de exame, faixas, notas, justificativas, indicação clínica, orientações e itens nunca vão a log, Sentry ou mensagem de erro** (regra 3, RNF-370): erros logam só código e motivo técnico.
- **Textos de interface em pt-BR, exatos da spec §6.2**, nas constantes `MSG_EXAMES` (`src/modules/exames/constantes.ts`), `MSG_SOLICITACAO` (`src/modules/documentos/solicitacao.ts`), `MSG_PRESCRICAO` (acréscimos), `MSG_MODELOS` (`src/modules/documentos/modelos.ts`), `MSG_COMPARTILHAR` (`src/components/portal/compartilhar-pdf.tsx`) e `MSG_FICHA.itens.solicitacao`. Os textos normativos (declaração, termos barrados, categorias, nomes para começar) ficam marcados "rascunho para a Debby" no código (EP-P3). Rótulo que um guia cita entre aspas e mora num módulo exige o diretório em `TSX_FORA` (`src/modules/ajuda/conteudo.test.ts:13`): `'src/modules/exames'` no fim da lista (T3).
- **Telas:** visual V2 (`src/components/ui`), `dynamic = 'force-dynamic'` em toda `page.tsx` nova (RNF-377), alvos `min-h-11`, erros `role="alert"` com `aria-describedby`, região `<p role="status">` sempre montada, h1 com `tabIndex={-1}` recebendo o foco depois de salvar, formulários devolvem `valores` e usam `defaultValue` + `key` (um erro não apaga o digitado). Diálogos e confirmações com rótulos próprios **só** pelo `Dialogo` (T2, EP-D42), nunca `window.confirm`/`ConfirmarBotao` nas telas novas; formulário dentro do diálogo é `<form>` próprio, fora do `<form>` da receita ou do exame. Testes de componente **sem DOM** (`environment: 'node'`): `.test.ts` com `createElement` + `renderToStaticMarkup`, só estrutura; axe no Playwright.
- **Toda `page.tsx` nova** entra em `e2e/painel-rotas.ts` (`ROTAS_DO_PAINEL`; ids novos em `IdsDoPainel`/`prepararTelasComId`, criados pelo caminho real da UI) e tem guia do manual guiado ou entrada em `SEM_AJUDA` — a guarda `src/app/painel/rotas-axe.test.ts` e `src/modules/ajuda/conteudo.test.ts` quebram o CI na própria tarefa (PM-E14).
- **Guias sobem +1 sobre a versão da `main` no rebase**, por PR que muda a tela (EP-D52), com comentário `Plano 22: …`; nunca número fixo copiado deste plano.
- **Sem dependência nova** (C-379, RNF-376); sem editor de texto rico; sem notificação nova; sem cadastro de farmácia ou laboratório em campo algum (C-374).
- **Arquivos disputados** (`sessoes-paralelas.md` §6): `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md`, `src/db/schema/index.ts`, `src/app/painel/navegacao.ts` (`DO_HUB`), `src/app/painel/configuracoes/page.tsx` (`CARTOES`), `src/jobs/queues.ts`, `src/worker/index.ts`, `src/modules/plataforma/audit.ts` (e o teste), `src/modules/pacientes/lgpd.ts`, `src/modules/pacientes/exportacao-job.ts` (e `exportacao.test.ts`), `src/modules/ficha/{tipos,textos}.ts`, `src/modules/ficha/secoes/{exames,documentos}.ts`, `scripts/e2e-seed.ts`, `e2e/painel-rotas.ts`, `e2e/painel.ts`, `e2e/acessibilidade-painel.spec.ts`, `src/modules/ajuda/{conteudo,portal}.ts` (e os testes), `docs/manual-tecnico/`, `.claude/agent-memory/**`, índice dos planos e backlog — **só acrescentar**, no fim da lista, do objeto, do union ou do bloco, sem reordenar nem reformatar, no formato que a `main` tiver no rebase. No rebase, manter as duas contribuições (nunca escolher um lado inteiro).
- **`CLAUDE.md` no rebase:** cada regra é uma linha física (conflito garantido com os Planos 18, 19, 20, 21 e 23). Ficar com a linha da `main` e reacrescentar só a frase "Plano 22: …" no fim de cada regra; conferir `grep -c "Plano 2[0-3]\|Plano 1[789]" CLAUDE.md` antes e depois (o número não pode cair).
- **Ordem de travas** (RN-378, RN-383, RN-385): paciente (`carregarPacienteParaEscrita`, `FOR UPDATE`, recusa bloqueado e anonimizado) → exame `.for('no key update')` (`where id = exameId and patient_id = patientId`; sem linha → "Exame não encontrado.") → filha (versão, nota) ou tarefa da IA — a mesma de `conferencia.ts` (`FOR UPDATE` no exame) e de `excluirExame`.

## Review Focus

1. **RLS do app em `exams`** — `paciente_exame_liberado` é RESTRICTIVE, `FOR SELECT`, cita `mostrar_no_app_em` (`pg_policies`); a fábrica de `exams` grava o exame **liberado** e o laço genérico de leitura da sessão de paciente continua exigindo `vistas.rows.length >= 1` em `exams` (nunca tirar `exams` do laço nem pô-la em `semLeituraDoPaciente`); um `it` próprio prova que P2 não vê o não liberado, vê o liberado e não vê `exam_interpretacoes` nem `exam_versoes`; a contagem do "No app" bate com o portal (paridade). Tarefas 1 e 6.
2. **Só de inclusão e autoria pelo banco** — `UPDATE`, `DELETE` e `TRUNCATE` revogados de `nutri_app_role` em `exam_interpretacoes` e `exam_versoes` (42501, também no `migrate-owner.test.ts`); `criado_por`/`criado_em` e `alterado_por`/`alterado_em` do gatilho (o valor enviado é ignorado); a exclusão do exame leva as filhas pela cascata. Tarefa 1 (`src/modules/exames/banco.test.ts`).
3. **Concorrência e `updated_at`** — editar × conferência da IA (duas transações; quem chega depois recebe "O exame mudou desde que você abriu. Recarregue a página."); nota × `excluirExame` concorrente ("Exame não encontrado.", nunca o 23503 cru); "Mostrar no app" **não** muda `updated_at` (o resumo da IA não fica desatualizado, uma edição aberta não é recusada); `iaTarefaId` forjado no formulário ignorado. Tarefas 4, 5 e 6.
4. **Tipo novo de documento** — nenhum ramo cai em "receita" por exclusão (`switch` + `assertNever`; grep de `=== 'parecer'`, `!== 'receita'`, `?? 'receita'` nos módulos de documento); retificação conserva tipo, todas as chaves e `orientacoesFormato`; habilitação em salvar, preparar **e assinar** para `fitoterapico` e `formula_fitoterapica`; o app novo só enfileira nas filas "-2" (guarda de fonte); verificação pública só com o rótulo. Tarefas 7, 8 e 9.
5. **Projeções fechadas** — `examesLiberadosDoPaciente` devolve só `id`, `data`, `titulo` e, por linha, `nome`, `valor`, `unidade`, `referencia`, `fora` (teste das chaves); `documentosDoPaciente` e `verificacao.ts` sem chave nova com uma solicitação e uma fórmula; marcação maliciosa (`<script>`, links, `&`) sai como texto no PDF, na prévia e na página do painel. Tarefas 6, 9 e 11.
6. **LGPD no mesmo PR da primeira escrita** (PM-E13) — PR 2: `refMin`/`refMax`, `versoesAnteriores` e `notaDeInterpretacao` no `dados.json`; PR 3: `mostradoNoAppEm`; PR 4: solicitação e fórmula. A nota sai na cópia do titular (EP-D19) e nunca no app, no PDF, na IA ou no comparativo. Tarefas 4, 5, 6, 8 e 9.

## Ordem de entrega

| PR | Tarefas | Quando | Por quê |
|---|---|---|---|
| **PR 1 — fundação** | T1, T2 | Na fila de migrations (uma por vez), **depois das migrations da onda 1** que ainda faltarem (Plano 19 e Plano 18 PR 2); entre os PR 1 da onda 2 (21, 22, 23), a ordem é da orquestradora (proposta: o que ficar pronto primeiro) | Tabelas, política de `exams`, guardas, listas de isolamento, regras puras e o `Dialogo`: é o que as outras sessões encontram no rebase. Pequeno; nenhuma tela; nenhum tipo novo visível (EP-D48, EP-D49) |
| **PR 2 — exames** | T3, T4, T5 | Depois do merge do PR 1 | **Sem migration** (só o trem de CI). Catálogo, lançamento, edição com versão, classificação, REF, nota e comparativo, com a exportação dessas chaves (PM-E13) |
| **PR 3 — app** | T6 | Depois do merge do **Plano 18 PR 2** (`noAppPor`, `no-app.test.ts`, RN-279) e do PR 2 deste plano (R-385) | Sem migration. A política já está na `main` desde o PR 1; o PR 3 só liga a tela |
| **PR 4 — documentos** | T7, T8, T9, T10, T11, T12 | Depois do merge do PR 2; **independe** do PR 3 e do 18 PR 2 | Tem a migration das duas tabelas de prescrição (T10, fila de migrations). Linha de corte (R-388, EP-D38): se a onda apertar, T9 e T10 viram "Plano 22B" na onda 3 e a migration da T10 sai junto; o PR 4 fica com T7, T8, T11 e T12 |

**Branch do PR seguinte depois do merge do PR 1.** O §5 regenera as migrations no `plano-22-fundacao`; o `plano-22-exames-prescricao` continua com os commits velhos da T1. Depois do merge do PR 1:

```bash
git fetch origin
git rebase --onto origin/main <último commit da T2> plano-22-exames-prescricao   # descarta T1 e T2, já na main
git diff origin/main -- drizzle/                                                 # tem de sair vazio
```

Depois, recriar o `nutri_dev_b` do zero (§5, passo 7, **com OK do dono**: é apagar, mesmo em dev). O mesmo vale para o PR 4 se outro PR com migration entrar antes dele (só a migration da T10 é regenerada).

Merge sempre com OK do dono (merge = deploy; a migration roda no boot); nunca das 03h às 07h30 BRT; sem snapshot da Hostinger (congela a VPS): migration só aditiva e o backup restic diário. **Volta atrás abaixo do PR 4 depois da primeira solicitação ou fórmula:** só com o runbook da R-375 (T12).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Tarefa |
|---|---|---|
| `src/db/schema/exames-catalogo.ts` (novo; export em `src/db/schema/index.ts`, linha no fim) | `examesCatalogo`, `examesModelosSolicitacao`; tipos `FaixaDoConsultorio`, `ExameDaLista` | T1 |
| `src/db/schema/pacientes.ts` | `exams.mostrarNoAppEm`; `refMin?`/`refMax?` no tipo de `valores`; `examInterpretacoes`, `examVersoes` | T1 |
| `src/db/schema/documentos.ts` | CHECKs `signed_documents_tipo_valido` e `document_verifications_tipo_valido` com `'solicitacao_exames'` | T1 |
| `drizzle/<NNNN>_exames.sql` (gerada) + `drizzle/<NNNN+1>_rls_exames.sql` (custom) | Tabelas, coluna, CHECKs; RLS, `staff_only`, auditoria, `REVOKE`, gatilhos de autoria, política `paciente_exame_liberado` | T1 |
| `src/modules/exames/constantes.ts` | `MSG_EXAMES`, `CATEGORIAS_DO_CONSULTORIO`, `NOMES_PARA_COMECAR`, `PAINEIS_PARA_COMECAR`, limites | T2 |
| `src/modules/exames/classificacao.ts` (puro) | Neutra, categoria, `sugerirFaixa`, `referenciaDaFaixa`, `casarComCatalogo`, `foraParaOApp` | T2 |
| `src/modules/exames/catalogo-regras.ts` (puro) | Zod do exame do catálogo (faixas, componentes, outros nomes, modelos de nota), sobreposição, `expandirParaAnalise` (EP-D47) | T2 |
| `src/modules/documentos/marcacao.ts` (puro) | `lerMarcacao` | T2 |
| `src/modules/documentos/solicitacao.ts` (puro) | Zod da solicitação, `MSG_SOLICITACAO`, `DECLARACAO_SOLICITACAO` | T2 |
| `src/modules/documentos/prescricao.ts` | `exigeHabilitacao`, binômio, `TERMOS_NAO_VEGETAIS` (T2); `formula_fitoterapica` no `TIPOS_ITEM` e no Zod, `orientacoesFormato` (T9) | T2, T9 |
| `src/modules/ia/correspondencia.ts` | `normUnidade` passa a ser exportada (só isso) | T2 |
| `src/components/dialogo.tsx` | `Dialogo` (EP-D42) | T2 |
| `src/modules/exames/catalogo.ts`, `modelos-solicitacao.ts` | Banco do catálogo e dos modelos de solicitação | T3 |
| `src/app/painel/exames/**` | Catálogo e modelos de solicitação (layout com `nav`, páginas, actions) | T3 |
| `src/modules/pacientes/exames.ts` | `lerValores` com faixa, `editarExame`, `versoesDoExame` (T4); `abrirExame` (T5); `mostrarNoApp`/`retirarDoApp` (T6) | T4–T6 |
| `src/app/painel/pacientes/[id]/exames/**` | Formulário com catálogo, editar, versões, detalhe, comparativo, "Mostrar no app" | T4–T6 |
| `src/modules/exames/interpretacao.ts`, `comparativo.ts` | Nota e comparativo | T5 |
| `src/modules/portal/exames-liberados.ts` | Projeção fechada do portal e `temExameLiberado*` | T6 |
| `src/modules/documentos/tipos-de-documento.ts` (puro) | `TIPOS_DE_DOCUMENTO`, `assertNever`, `conteudoVazio`, `semCopia`, reexporta `exigeHabilitacao` | T7 |
| `src/modules/documentos/lancar-resultados.ts` | `examesParaLancar` (servidor; EP-D47, EP-D50) | T8 |
| `src/modules/documentos/modelos.ts` + `src/db/schema/prescricao-modelos.ts` + `drizzle/<MMMM>_prescricao_modelos.sql` + `drizzle/<MMMM+1>_rls_prescricao_modelos.sql` | Itens salvos e modelos de prescrição | T10 |
| `src/app/painel/prescricao/**` | Itens salvos e modelos de prescrição | T10 |
| `src/components/portal/compartilhar-pdf.tsx` | "Preparar para compartilhar" → "Compartilhar" (`MSG_COMPARTILHAR`) | T11 |
| `src/worker/filas-documento-pdf.test.ts` | Guarda de fonte das filas "-2" | T7 |
| `e2e/exames.spec.ts`, `e2e/solicitacao-exames.spec.ts`, `e2e/acessibilidade-exames.spec.ts` | CS-370, CS-371, CS-372, download do "Compartilhar", axe dos estados que não são rota | T3–T12 |

---

## PR 1 — Fundação

### Task 1: Banco — tabelas, coluna, política, gatilhos e guardas (P22-01)

**Files:**
- Create: `src/db/schema/exames-catalogo.ts`; `export * from './exames-catalogo';` no **fim** de `src/db/schema/index.ts`
- Modify: `src/db/schema/pacientes.ts` (ao lado de `exams`), `src/db/schema/documentos.ts` (dois CHECKs)
- Create: `drizzle/<NNNN>_exames.sql` (`pnpm db:generate --name exames`), `drizzle/<NNNN+1>_rls_exames.sql` (`pnpm drizzle-kit generate --custom --name rls_exames`)
- Modify: `src/db/rls-guard.ts` — `STAFF_ONLY` no fim: `exames_catalogo` e `exames_modelos_solicitacao` ("Plano 22 (EP-D8, EP-D29, EP-D30): bibliotecas do consultório — só a equipe; sem paciente"), `exam_interpretacoes` ("Plano 22 (EP-D18, EP-D19): nota de interpretação — fora do app; o titular recebe pela exportação (inclusão explícita)"), `exam_versoes` ("Plano 22 (EP-D41): versões anteriores do exame — só a equipe; o titular recebe pela exportação, sem a justificativa")
- Modify: `test/isolamento.test.ts` — fábrica de `exams` passa a gravar `mostrar_no_app_em = now()` (comentário: "Plano 22 (§9.8): liberado, como meal_plans grava 'publicado' por causa da paciente_sem_rascunho — mantém a prova de leitura da sessão de paciente"); `FABRICAS` novas no fim: `exames_catalogo` (nome único por chamada: `'Iso ' || gen_random_uuid()`), `exames_modelos_solicitacao` (idem, `exames = '[{"nome":"Iso"}]'`), `exam_interpretacoes` e `exam_versoes` (cada uma cria o exame-mãe **sem** a marca no mesmo comando por CTE, `versao = 1`; `exam_versoes` com `titulo`, `data`, `valores = '[]'`); `COM_MAE` (linhas novas no fim): `exam_interpretacoes`, `exam_versoes` (comentário: "Plano 22: a recusa dos negativos de INSERT vem de exams; prova própria em src/modules/exames/banco.test.ts"); `SO_INSERE`: as duas; `it` novo no fim do `describe`: "Plano 22 (RN-385): a paciente P2 não vê o exame não liberado, vê o liberado e não vê exam_interpretacoes nem exam_versoes" (semeia como `nutri` um exame **não** liberado de P2). `ULTIMAS`, `SEM_DELETE`, `IMUTAVEIS`, `SO_APAGA`, `DELETE_REVOGADO` **não mudam** (§9.8: `exam_*` saem em cascata com `exams`; `listTenantTables` ordena por `relname` e elas vêm antes de `exams`)
- Modify: `src/modules/plataforma/audit.ts` — `ENTIDADE_ROTULO.exames_versoes = 'Versões do exame'` (linha nova no fim, comentário `Plano 22 (RN-378)`)
- Modify: `CLAUDE.md` — regra 2 (frase "Plano 22: …" no fim: as seis tabelas `staff_only` (as duas de prescrição no PR 4); `exam_interpretacoes` e `exam_versoes` só de inclusão, `REVOKE UPDATE, DELETE, TRUNCATE`, gatilhos `exam_interpretacoes_regras` e `exam_versoes_regras` (autor e hora), em `COM_MAE` e `SO_INSERE`; a fábrica de `exams` grava o exame liberado; política RESTRICTIVE `paciente_exame_liberado` em `exams`), regra 8 (frase: `exam_interpretacoes` com o gatilho, entidade `exames`; `exam_versoes`, entidade `exames_versoes`, "Versões do exame")
- Test: `src/modules/exames/banco.test.ts` (novo), `src/db/migrate.test.ts`, `src/db/migrate-owner.test.ts`, `src/modules/plataforma/audit.test.ts`, `src/db/rls-guard.test.ts`, `src/db/audit-guard.test.ts`, `test/isolamento.test.ts`

**Interfaces:**
```ts
// src/db/schema/exames-catalogo.ts
export type FaixaDoConsultorio = { sexo: 'F' | 'M' | null; idadeMin: number | null; idadeMax: number | null;
  aPartirDe: number | null /* inclusivo */; abaixoDe: number | null /* exclusivo */; categoria: string; fonte: string; atualizadaEm: string /* AAAA-MM-DD */ };
export type ExameDaLista = { nome: string; painel?: true };
export const examesCatalogo; // id, tenantId, nome, unidade, sinonimos: string[], componentes: string[], faixas: FaixaDoConsultorio[], modeloNotaAbaixo, modeloNotaAcima, createdAt, updatedAt
export const examesModelosSolicitacao; // id, tenantId, nome, exames: ExameDaLista[], orientacoes, createdAt, updatedAt
export type ExameCatalogoRow = typeof examesCatalogo.$inferSelect;
export type ModeloSolicitacaoRow = typeof examesModelosSolicitacao.$inferSelect;
// src/db/schema/pacientes.ts
exams.mostrarNoAppEm: timestamp('mostrar_no_app_em', { withTimezone: true }) // anulável, sem default
// tipo de exams.valores: { nome; valor; unidade; referencia; iaTarefaId?: string; refMin?: number; refMax?: number }[]
export const examInterpretacoes; // id, tenantId, patientId, examId, versao (smallint), texto (null = apagada), criadoPor, criadoEm
export const examVersoes;        // id, tenantId, patientId, examId, versao, titulo, data, valores, justificativa, alteradoPor, alteradoEm
export type ExamInterpretacaoRow, ExamVersaoRow;
```
- Colunas, CHECKs, índices e FKs **exatamente** como a spec §9.1, §9.2, §9.5 e §9.5a: CHECKs de array com `case when jsonb_typeof(x) = 'array' then … else false end`; `exames_catalogo_painel`; `exames_catalogo_faixa_com_unidade`; índices únicos `(tenant_id, lower(nome))` nas duas bibliotecas; FK composta `(tenant_id, patient_id, exam_id) → exams (tenant_id, patient_id, id) ON DELETE CASCADE` (alvo `exams_tenant_paciente_id_unique`); único `(tenant_id, exam_id, versao)` nas duas filhas; `criado_por`/`alterado_por` `uuid not null` **sem FK** para `user` (molde do Plano 20: a semente do E2E recria contas e as fábricas usam `randomUUID()`).
- Custom `rls_exames`: o SQL da spec §9.7, mais os dois gatilhos (um comando por bloco), no molde de `app_fin_categorias_fixas` (0123): `CREATE OR REPLACE FUNCTION app_exam_interpretacoes_regras() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp`: (1) `app_current_role()` diferente de `nutri` → `RETURN NEW` sem tocar (a RLS da própria tabela recusa paciente, `publico` e `conta`; o `worker` não grava nota); (2) `app_current_user()` nulo → `RAISE EXCEPTION … USING ERRCODE = '42501'`; (3) `NEW.criado_por := app_current_user(); NEW.criado_em := clock_timestamp();`. `app_exam_versoes_regras` igual com `alterado_por`/`alterado_em`. Gatilhos `BEFORE INSERT … FOR EACH ROW`.
- **Cascata:** as ações referenciais rodam sem RLS (`SECURITY_NOFORCE_RLS` do RI) e sem a permissão revogada; se o teste da cascata falhar, trocar o `REVOKE DELETE` por um gatilho que só aceita `pg_trigger_depth() > 1` (plano B da §9.5) e **registrar a escolha** no comentário da custom e na regra 2 do `CLAUDE.md`.

- [ ] **Step 1: Testes que falham** em `src/modules/exames/banco.test.ts` (sessões por `withTenant`, pacientes por `test/pacientes.ts`, contas por `test/sessao.ts`):
  - `bibliotecas: nutri cria e lê; paciente (com conta e semConta), publico e conta não leem nenhuma linha` (`exames_catalogo`, `exames_modelos_solicitacao`, `exam_interpretacoes`, `exam_versoes`).
  - `CHECKs do catálogo: painel com unidade → 23514; faixas com unidade nula → 23514; sinonimos = '{}' (objeto) → 23514, nunca 22023; 11 outros nomes → 23514; nome repetido sem diferença de maiúsculas → 23505`.
  - `CHECK do modelo de solicitação: 0 e 41 exames → 23514`.
  - `nota: INSERT de exam_interpretacoes com exame já criado pela nutri grava criado_por = usuária da sessão e criado_em do banco (o valor enviado é ignorado); texto '' → 23514; texto nulo passa (apagar)`.
  - `nota e versão na sessão de paciente, publico e conta: INSERT recusado pela RLS da própria tabela (o exame já existe — fora de COM_MAE)`; `worker: INSERT recusado (42501 do gatilho: sem usuário)`.
  - `só de inclusão: UPDATE, DELETE e TRUNCATE pela nutri em exam_interpretacoes e exam_versoes → 42501`.
  - `cascata: excluir o exame (DELETE de exams pela nutri) leva as notas e as versões`.
  - `versão: justificativa de 4 caracteres → 23514; nula passa; versao 0 → 23514; (exam_id, versao) repetido → 23505`.
  - `paciente_exame_liberado: em pg_policies é RESTRICTIVE (permissive = 'RESTRICTIVE'), cmd = 'SELECT' e qual cita mostrar_no_app_em`; `P2 com login lê o exame liberado e não lê o não liberado; a nutri lê os dois`.
  - `exams.mostrar_no_app_em: UPDATE só dessa coluna não muda updated_at` (sem gatilho de `updated_at` em `exams`: prova que a coluna nova não ganhou um).
  - `escrita vira audit_log: INSERT de nota → criar/exames com o patient_id; INSERT de versão → criar/exames_versoes`.
  - `CHECKs de tipo: signed_documents e document_verifications aceitam 'solicitacao_exames' e recusam 'outro'`.
  - Em `migrate-owner.test.ts`: `Plano 22: nutri_app não apaga nem altera exam_interpretacoes/exam_versoes (42501) com o schema migrado pelo migrator sem superusuário`.
  - Em `audit.test.ts`: `ENTIDADE_ROTULO.exames_versoes é 'Versões do exame'`.
  - Em `test/isolamento.test.ts`: o `it` novo acima; o laço genérico "a paciente P2 só vê e só altera as próprias linhas…" continua verde com `exams` dentro.
- [ ] **Step 2:** `pnpm vitest run src/modules/exames/banco.test.ts src/modules/plataforma/audit.test.ts` → FAIL (tabelas não existem); `pnpm vitest run src/db/migrate.test.ts` → PASS (a guarda do journal já está na `main`; se falhar, parar e avisar a orquestradora).
- [ ] **Step 3:** schema, `pnpm db:generate --name exames` (conferir no SQL gerado o drop + add dos dois CHECKs de tipo e a coluna sem default), custom `rls_exames`, `pnpm db:migrate` (com o `DATABASE_URL_MIGRATOR` do `.env.local`, regra 7); listas das guardas; `audit.ts`; `CLAUDE.md`.
- [ ] **Step 4:** `pnpm vitest run src/modules/exames/banco.test.ts src/db/migrate.test.ts src/db/migrate-owner.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/modules/plataforma/audit.test.ts test/isolamento.test.ts` → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(exames): catálogo, versões e nota do exame, liberação no app — banco e guardas (P22-01)`.

**Pronto quando:** testes verdes; `revisor-rls` sem Critical/Important (política, `COM_MAE`/`SO_INSERE`, fábrica liberada, cascata e a escolha registrada); procedimento do §5 feito em cima da `main` atual antes de abrir o PR 1.

---

### Task 2: Regras puras, constantes e o `Dialogo` (P22-02)

**Files:**
- Create: `src/modules/exames/constantes.ts`, `src/modules/exames/classificacao.ts`, `src/modules/exames/catalogo-regras.ts`, `src/modules/documentos/marcacao.ts`, `src/modules/documentos/solicitacao.ts`, `src/components/dialogo.tsx`
- Modify: `src/modules/documentos/prescricao.ts` (funções puras da fórmula, `exigeHabilitacao`; `conferirHabilitacao` passa a usar `exigeHabilitacao`; chaves novas de `MSG_PRESCRICAO`: `compostos`, `binomio`, `naoVegetal`) — **sem** tocar `TIPOS_ITEM` nem a união do Zod do item (EP-D48); `src/modules/ia/correspondencia.ts` (só `export` em `normUnidade`)
- Test: `src/modules/exames/classificacao.test.ts`, `src/modules/exames/catalogo-regras.test.ts`, `src/modules/exames/constantes.test.ts`, `src/modules/documentos/marcacao.test.ts`, `src/modules/documentos/solicitacao.test.ts`, `src/modules/documentos/prescricao.test.ts` (casos novos), `src/components/dialogo.test.ts`, `src/modules/exames/puros.test.ts` (guarda de grafo)

**Interfaces:**
```ts
// src/modules/exames/constantes.ts
export const CATALOGO_MAX = 500; export const SINONIMOS_MAX = 10; export const COMPONENTES_MIN = 2; export const COMPONENTES_MAX = 30;
export const FAIXAS_MAX = 20; export const NOTA_MAX = 2000; export const MODELO_NOTA_MAX = 1000; export const COMPARAR_MIN = 2; export const COMPARAR_MAX = 6;
export const CATEGORIAS_DO_CONSULTORIO = ['Baixo','Normal','Alto','Ótimo','Desejável','Adequado','Suficiente','Aceitável','Limítrofe','Elevado',
  'Muito elevado','Insuficiente','Deficiência','Depleção leve','Depleção moderada','Depleção grave'] as const; // rascunho para a Debby (RN-381, EP-D12)
export type CategoriaDoConsultorio = (typeof CATEGORIAS_DO_CONSULTORIO)[number];
export const NOMES_PARA_COMECAR: readonly { nome: string; sinonimos: string[] }[]; // os 14 grupos de SINONIMOS (correspondencia.ts) + os nomes do hemograma; sem unidade/faixa/ordem; rascunho para a Debby (RN-372)
export const PAINEIS_PARA_COMECAR: readonly { nome: 'Hemograma completo'; componentes: string[] }[];
export const MSG_EXAMES: { … }; // todos os textos da spec §6.2 das linhas Catálogo, Exame do catálogo, Faixas, Modelos de nota, Catálogo: erros, Lançamento, Lançamento: erros, Exame, Classificação, REF, Nota, Comparativo, Mostrar no app (painel), Portal, Estados vazios e erros genéricos
// src/modules/exames/classificacao.ts (sem import do servidor; usa normalizarNome e normUnidade de ia/correspondencia.ts e idadeEm de pacientes/datas.ts)
export type Neutra = 'abaixo' | 'dentro' | 'acima';
export const ROTULO_NEUTRA: Record<Neutra, string>; // "Abaixo da referência" · "Dentro da referência" · "Acima da referência"
export function classificarNeutra(valor: number, refMin?: number | null, refMax?: number | null): Neutra | null; // limites inclusivos; sem limite → null
export type ExameParaCasar = { id: string; nome: string; unidade: string | null; sinonimos: string[]; componentes: string[]; faixas: FaixaDoConsultorio[] };
export type IndiceDoCatalogo = Map<string /* nome normalizado */, ExameParaCasar[]>;
export function indiceDoCatalogo(itens: ExameParaCasar[]): IndiceDoCatalogo; // nome e outros nomes; um Map, lido uma vez (RNF-371)
export function casarComCatalogo(nome: string, unidade: string | null, indice: IndiceDoCatalogo): { exame: ExameParaCasar; mesmaUnidade: boolean } | null; // dois → null (EP-D14)
export function categoriaDoConsultorio(linha: { nome: string; valor: number; unidade: string | null }, indice: IndiceDoCatalogo,
  paciente: { sexo: string | null; dataNascimento: string | null }, dataDoExame: string): { categoria: string; faixa: FaixaDoConsultorio } | null; // RN-380 (a)–(e)
export function sugerirFaixa(texto: string | null): { refMin: number; refMax: number } | null; // RN-377
export function referenciaDaFaixa(refMin?: number | null, refMax?: number | null): string | null; // "70 a 99", "até 200", "a partir de 30", vírgula decimal
export function faixaDiverge(l: { referencia: string | null; refMin?: number; refMax?: number }): boolean; // texto e faixa numérica diferentes (aviso RN-376)
export function foraParaOApp(l: { valor: number; referencia: string | null; refMin?: number; refMax?: number }): boolean | null; // RN-385: null sem faixa ou com faixaDiverge
// src/modules/exames/catalogo-regras.ts
export class CatalogoError extends Error { constructor(readonly erros: Record<string, string>) }
export type ExameDoCatalogoEntrada = { nome: string; unidade: string | null; sinonimos: string[]; componentes: string[];
  faixas: Omit<FaixaDoConsultorio, 'atualizadaEm'>[]; modeloNotaAbaixo: string | null; modeloNotaAcima: string | null };
export function validarExameDoCatalogo(input: unknown): ExameDoCatalogoEntrada; // lança CatalogoError com as mensagens de MSG_EXAMES
export function faixasSeSobrepoem(a: Omit<FaixaDoConsultorio, 'atualizadaEm'>, b: Omit<FaixaDoConsultorio, 'atualizadaEm'>): boolean;
export function expandirParaAnalise(exames: ExameDaLista[], indice: IndiceDoCatalogo): { nome: string; unidade: string | null }[]; // painel → componentes, um nível (RN-373)
export function validarListaDeExames(input: unknown, o: { max: 40 }): ExameDaLista[]; // 1–40, nome 1–80, sem repetição normalizada
// src/modules/documentos/marcacao.ts
export type Trecho = { texto: string; negrito: boolean };
export type Bloco = { tipo: 'paragrafo'; trechos: Trecho[] } | { tipo: 'lista'; itens: Trecho[][] };
export function lerMarcacao(texto: string): Bloco[]; // RN-395
// src/modules/documentos/solicitacao.ts
export const DECLARACAO_SOLICITACAO: string; // texto exato da §6.2
export const MSG_SOLICITACAO: { … }; // linhas Solicitação e Solicitação: erros da §6.2
export type ConteudoSolicitacao = { versao: 1; tipo: 'solicitacao_exames'; exames: ExameDaLista[]; indicacaoClinica: string | null; orientacoes: string;
  orientacoesFormato: 'marcacao'; copia?: CopiaDoDocumento; declaracao?: string };
export function validarRascunhoSolicitacao(input: unknown): ConteudoSolicitacao; // 0 exames vale no rascunho; DocumentoError
export function validarSolicitacaoParaPreparar(c: ConteudoSolicitacao): void; // "Inclua ao menos um exame."
// src/modules/documentos/prescricao.ts (acréscimos)
export const TERMOS_NAO_VEGETAIS: readonly string[]; // lista da RN-392, rascunho para a Debby
export function exigeHabilitacao(tipo: string): boolean; // true só para 'fitoterapico' e 'formula_fitoterapica'
export function binomioValido(nomenclatura: string): boolean; // "Gênero epíteto" (ou "×"), autor e categorias abaixo de espécie depois
export function temTermoNaoVegetal(texto: string): boolean; // palavra inteira, sem acento e sem diferença de maiúsculas; "L-" no começo de palavra
// src/components/dialogo.tsx ('use client')
export function Dialogo(p: { aberto: boolean; titulo: string; aoFechar: () => void; children: ReactNode; rodape?: ReactNode }): JSX.Element;
export function DialogoConfirmar(p: { aberto: boolean; titulo: string; texto: string; confirmar: string; cancelar?: string /* "Cancelar" */;
  aoConfirmar: () => void; aoFechar: () => void; perigo?: boolean }): JSX.Element;
```
- `Dialogo`: `<dialog>` + `showModal()` no efeito quando `aberto`; `aria-labelledby` no h2 do título (`useId`); `Esc` (evento `cancel`) chama `aoFechar`; ao fechar, o foco volta ao elemento que estava focado na abertura; rodapé com os botões; botões `min-h-11`. Nenhum `<form>` embrulha o diálogo: quem precisa de formulário põe um `<form>` **dentro** dele.
- `lerMarcacao`: parágrafos separados por linha em branco; lista = linhas seguidas que começam com `"- "`; negrito `**…**` sem aninhar (asterisco solto fica); `<`, `>`, `&` e qualquer HTML ficam como **texto** nos trechos; nada de link, imagem, título ou cor.
- `sugerirFaixa`: só um padrão `a a b`, `a - b` ou `a – b` (vírgula ou ponto decimal, unidade opcional depois); nada se houver `<`, `>`, `≤`, `≥`, "até", "acima", "abaixo", `;` ou segunda faixa.

- [ ] **Step 1: Testes que falham:**
  - `classificacao.test.ts`: os quatro exemplos da US-372 ("Acima" com 105 em 70–99; "Dentro" com 70; "Acima" com 210 e só "até 200"; sem faixa → `null`); categoria do cenário "Vitamina D" (F, 40 anos na data do exame, outro nome "25-hidroxivitamina D", ng/mL, valor 15 → "Deficiência" com a faixa); mesma linha em nmol/L → `null`; sem unidade → `null`; sexo ou nascimento nulos → `null`; < 1 ano na data do exame → `null`; aniversário no dia do exame (idade na data, não hoje); faixa com só "A partir de" e só "Abaixo de" (inclusivo × exclusivo); nome que casa com dois exames do catálogo → `null`; `sugerirFaixa`: "70 a 99 mg/dL" → 70–99, "4,5 - 6,0" → 4,5–6, "Desejável < 200; Limítrofe 200 a 239" → `null`, "até 200" → `null`, "70 a 99 e 100 a 125" → `null`; `referenciaDaFaixa`: "70 a 99", "até 200", "a partir de 30", "4,5 a 6"; `foraParaOApp`: `null` com faixa 70–110 e texto "70 a 99" (N22-07), `true`/`false` com faixa coerente, `null` sem faixa.
  - `catalogo-regras.test.ts`: cada mensagem de "Catálogo: erros" da §6.2 (nome 0/81, 11 outros nomes, painel com 1 e 31 componentes, painel com unidade ou faixa ou modelo de nota, faixa sem unidade, fonte 1/301, sem limite, "A partir de" 30 e "Abaixo de" 20, idade 50 a 18, 21 faixas, modelo de nota 1001); sobreposição (mesmo sexo, idades e valores que se cruzam → sobrepõe; "Todos" coincide com F; idades disjuntas → não; valores encostados `[x, 20)` e `[20, y)` → não); `expandirParaAnalise`: painel "Hemograma completo" de 20 componentes → 20 linhas com a unidade do exame do catálogo de mesmo nome ou outro nome, sem unidade quando não casa, componente que é painel não expande de novo; `validarListaDeExames`: 41 → "A solicitação pode ter até 40 exames.", repetido normalizado → "Este exame já está na lista.".
  - `constantes.test.ts`: `NOMES_PARA_COMECAR` sem nenhuma chave de unidade, faixa ou ordem; sem "mineralograma" e sem "IgG" (RN-372); todo grupo de `SINONIMOS` presente; `CATEGORIAS_DO_CONSULTORIO` igual à lista da RN-381, sem "Desnutrição"; amostra de `MSG_EXAMES` igual à §6.2.
  - `marcacao.test.ts`: parágrafos, lista, negrito, asterisco solto, `**sem fim`, `<script>alert(1)</script>`, `[link](http://x)`, `<b>x</b>` e `&amp;` saem como texto literal nos trechos; texto vazio → `[]`.
  - `solicitacao.test.ts`: as mensagens de "Solicitação: erros"; indicação vazia vira `null`; `orientacoesFormato` sempre `'marcacao'`; sem chave de laboratório (conteúdo com `laboratorio` → a chave não sai, `strict`).
  - `prescricao.test.ts` (casos novos): `exigeHabilitacao` (`fitoterapico`, `formula_fitoterapica` → true; `suplemento`, `planta_cha`, `derivado_vegetal` → false); `conferirHabilitacao` com `fitoterapico` sem habilitação continua recusando com `semHabilitacao`; `binomioValido` ("Matricaria chamomilla L.", "Citrus aurantium var. amara", "Mentha × piperita" → true; "camomila", "matricaria chamomilla" → false); `temTermoNaoVegetal` ("Picolinato de cromo", "Vitamina C", "Creatina monoidratada", "Glutamina livre", "Curcumina lipossomal", "Lactobacillus acidophilus", "Saccharomyces boulardii", "curcumina isolada", "L-teanina" → true; "Matricaria chamomilla L." → false).
  - `dialogo.test.ts`: `aria-labelledby` aponta para o h2 do título; `DialogoConfirmar` mostra o texto e os rótulos recebidos ("Remover", "Cancelar") e nenhum `<form>` em volta.
  - `puros.test.ts` (guarda por grafo, `test/grafo-de-imports.ts`): a partir de `classificacao.ts`, `catalogo-regras.ts`, `constantes.ts`, `marcacao.ts`, `solicitacao.ts` e `prescricao.ts`, nenhum arquivo alcançável importa `@/db/client`, `@/db/tenant`, `server-only` ou `pg`.
- [ ] **Step 2:** `pnpm vitest run src/modules/exames src/modules/documentos/marcacao.test.ts src/modules/documentos/solicitacao.test.ts src/modules/documentos/prescricao.test.ts src/components/dialogo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm vitest run src/modules/ia/correspondencia.test.ts src/modules/documentos` → PASS (nenhum comportamento mudou); `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(exames): classificação, catálogo, marcação, solicitação, fórmula e Dialogo — regras puras (P22-02)`.

**Pronto quando:** testes verdes; `normas-cfn-lgpd` conferiu as constantes normativas (categorias, nomes para começar, termos barrados, declaração) como rascunho para a Debby; PR 1 aberto pela orquestradora (sem push sem o OK).

---

## PR 2 — Exames

### Task 3: Catálogo de exames e modelos de solicitação (P22-03)

**Files:**
- Create: `src/modules/exames/catalogo.ts`, `src/modules/exames/modelos-solicitacao.ts`
- Create: `src/app/painel/exames/layout.tsx` (`nav aria-label="Seções de exames"` com "Catálogo" e "Modelos de solicitação", `aria-current="page"`), `src/app/painel/exames/catalogo/page.tsx`, `.../catalogo/novo/page.tsx`, `.../catalogo/[id]/page.tsx`, `.../catalogo/exame-catalogo-form.tsx`, `.../catalogo/nomes-para-comecar.tsx` (diálogo), `.../catalogo/actions.ts`, `src/app/painel/exames/modelos/page.tsx`, `.../modelos/novo/page.tsx`, `.../modelos/[id]/page.tsx`, `.../modelos/modelo-form.tsx`, `.../modelos/actions.ts`, `src/app/painel/exames/escolher-do-catalogo.tsx` (diálogo "Adicionar do catálogo", reaproveitado nas T4 e T8), `e2e/acessibilidade-exames.spec.ts`
- Modify: `src/app/painel/configuracoes/page.tsx` (cartão no **fim** de `CARTOES`: `{ href: '/painel/exames/catalogo', titulo: 'Exames', texto: 'Catálogo de exames, faixas do consultório e modelos de solicitação.' }`), `src/app/painel/navegacao.ts` (`'/painel/exames'` no **fim** de `DO_HUB`, EP-D51), `src/modules/ajuda/conteudo.ts` (guia novo `exames-do-consultorio` no fim de `GUIAS`, `versao: 1`, `padrao: /^\/painel\/exames(\/.*)?$/`, passos com `alvo` nos `data-guia` desta tarefa; guia `configuracoes` +1 sobre a `main`, passo dos cartões citando "Exames"), `src/modules/ajuda/conteudo.test.ts` (`'src/modules/exames'` no fim de `TSX_FORA`), `e2e/painel-rotas.ts` (as seis rotas; `exameCatalogo` e `modeloSolicitacao` em `IdsDoPainel`), `e2e/painel.ts` (`prepararTelasComId` cria um exame do catálogo e um modelo pelo caminho real da UI)
- Test: `src/modules/exames/catalogo.test.ts`, `src/modules/exames/modelos-solicitacao.test.ts`, `src/app/painel/exames/catalogo/actions.test.ts`, `src/app/painel/navegacao.test.ts` (caso novo), `src/modules/ajuda/conteudo.test.ts`, `src/app/painel/rotas-axe.test.ts` (sem mudança, verde)

**Interfaces:**
```ts
// src/modules/exames/catalogo.ts
export type ItemParaLancamento = ExameParaCasar; // nome, unidade, sinonimos, componentes, faixas
export async function listarCatalogo(ctx: TenantContext, deps?: { db?: Db }): Promise<ExameCatalogoRow[]>;
export async function abrirExameDoCatalogo(ctx: TenantContext, id: string, deps?: { db?: Db }): Promise<ExameCatalogoRow | null>;
export async function salvarExameDoCatalogo(ctx: TenantContext, tenant: { fuso: string }, id: string | null, input: unknown, deps?: { db?: Db; agora?: Date }): Promise<string>;
export async function excluirExameDoCatalogo(ctx: TenantContext, id: string, deps?: { db?: Db }): Promise<boolean>;
export async function nomesParaComecarFaltando(ctx: TenantContext, deps?: { db?: Db }): Promise<{ nome: string; sinonimos: string[]; componentes: string[] }[]>;
export async function adicionarNomesParaComecar(ctx: TenantContext, nomes: unknown, deps?: { db?: Db }): Promise<number>;
export async function catalogoParaLancamentoNaTransacao(tx: Tx): Promise<ItemParaLancamento[]>; // usado por T4/T5/T8, na transação de quem chama
// src/modules/exames/modelos-solicitacao.ts
export async function listarModelosSolicitacao(ctx: TenantContext, deps?: { db?: Db }): Promise<ModeloSolicitacaoRow[]>;
export async function abrirModeloSolicitacao(ctx: TenantContext, id: string, deps?: { db?: Db }): Promise<ModeloSolicitacaoRow | null>;
export async function salvarModeloSolicitacao(ctx: TenantContext, id: string | null, input: unknown, deps?: { db?: Db }): Promise<string>;
export async function excluirModeloSolicitacao(ctx: TenantContext, id: string, deps?: { db?: Db }): Promise<boolean>;
export async function exameDosModelos(ctx: TenantContext, modeloId: string, deps?: { db?: Db }): Promise<{ exames: ExameDaLista[]; linhas: { nome: string; unidade: string | null }[]; orientacoes: string } | null>;
```
- `salvarExameDoCatalogo`: `validarExameDoCatalogo`; `pg_advisory_xact_lock(hashtextextended('exames_catalogo:' || tenant_id, 0))` no início da transação; com a trava, confere a unicidade normalizada do nome **e** dos outros nomes contra todos os exames do consultório ("Já existe um exame com este nome ou com um destes outros nomes: {nome}."), o teto de 500 ("O catálogo chegou ao limite de 500 exames."), a sobreposição das faixas ("Esta faixa se sobrepõe a outra do mesmo público.") e a troca de unidade com faixas ("Remova as faixas antes de trocar a unidade."); `atualizadaEm` = hoje no fuso só nas faixas novas ou mudadas; o `23505` do índice vira a mesma mensagem.
- Excluir não mexe em exame, modelo nem documento (cópia do nome, sem FK). Modelos de solicitação: nome único sem diferença de maiúsculas ("Já existe um modelo com este nome."), `validarListaDeExames(…, { max: 40 })` ("O modelo pode ter até 40 exames."), orientações ≤ 1000 (marcação), sem indicação clínica; **não dependem de `documentos_liberados`** (RN-391).
- Telas com os textos da §6.2 ("Catálogo", "Exame do catálogo", "Faixas", "Modelos de nota", "Modelos de solicitação"): lista "Exame · Unidade · Faixas · Ação" com "Painel ({n} exames)"; "Seu catálogo ainda está vazio." e o botão "Nomes de exames para começar" (fica enquanto houver nome da lista fora do catálogo); diálogo "Nomes de exames para começar (você escolhe o que usar)" com a ajuda, nada marcado, "Selecionar todos" e "Adicionar ao catálogo"; formulário com as três áreas; confirmação de excluir pelo `DialogoConfirmar` ("Excluir {nome} do catálogo? Exames, modelos e documentos já gravados não mudam."); aviso "Retire dados do paciente antes de salvar." nos modelos de nota e no modelo de solicitação.
- `escolher-do-catalogo.tsx`: `Dialogo` "Buscar no catálogo", busca por nome e outros nomes, "Selecionar todos" (nome acessível "Selecionar todos os exames mostrados"), "Adicionar {n} exame(s)", catálogo vazio → "Seu catálogo está vazio. Cadastre exames em Catálogo de exames." (link), busca sem resultado → "Nenhum exame encontrado.". Prop `modo: 'linhas' | 'lista'` (linhas expande painéis; lista mantém o painel como um item).

- [ ] **Step 1: Testes que falham:**
  - `catalogo.test.ts`: cria "Ferritina" (ng/mL, outro nome "ferritina sérica") → lido de volta; "Glicose de jejum" com "Glicemia de jejum" tendo o outro nome "glicose de jejum" → mensagem exata com o nome; duas gravações concorrentes de nomes que colidem só pelos outros nomes → uma passa, a outra recebe a mensagem (a trava serializa); 501º exame → mensagem do limite; faixa que sobrepõe → mensagem; troca de unidade com faixas → mensagem e nada muda; `atualizadaEm` só muda na faixa alterada; painel salvo sem unidade, faixas nem modelos; `nomesParaComecarFaltando` some com o que já entrou (por nome normalizado); `adicionarNomesParaComecar` grava só nome e outros nomes (sem unidade); excluir não muda um exame lançado nem um modelo; sessão de paciente → erro do assert (não lista vazia); outro tenant não vê.
  - `modelos-solicitacao.test.ts`: cria "Check-up anual" com exames do catálogo e livres; 41 exames → mensagem; repetido → mensagem; nome repetido → mensagem; `exameDosModelos` expande o painel nas `linhas` e mantém o painel nos `exames`; funciona com `documentos_liberados` desligado.
  - `actions.test.ts`: a action devolve `valores` no erro (nada some); sucesso → "Exame salvo." e redirect para a lista; papel errado → `requireNutri` redireciona.
  - `navegacao.test.ts`: `/painel/exames/catalogo` e `/painel/exames/modelos/novo` marcam "Configurações"; `/painel/exames-recebidos` continua marcando "Exames recebidos".
  - `conteudo.test.ts`: guia `exames-do-consultorio` cobre as rotas novas; `configuracoes` com a versão nova (+1) e o passo dos cartões citando "Exames".
- [ ] **Step 2:** `pnpm vitest run src/modules/exames src/app/painel/exames src/app/painel/navegacao.test.ts src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → FAIL.
- [ ] **Step 3:** implementar; `e2e/acessibilidade-exames.spec.ts` (claro e escuro, 1280 e 360 px, `escolherTema` e volta a "Igual ao aparelho" no `afterAll`): diálogo "Nomes de exames para começar" aberto, `DialogoConfirmar` do excluir aberto, formulário do exame com erro de faixa.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm typecheck && pnpm lint`; quando a orquestradora liberar: `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e e2e/acessibilidade-painel.spec.ts e2e/acessibilidade-exames.spec.ts` → PASS.
- [ ] **Step 5:** commit `feat(exames): catálogo do consultório e modelos de solicitação (P22-03)`.

**Pronto quando:** testes verdes; `revisor-interface` (textos, foco, diálogos, 360 px) e `normas-cfn-lgpd` (aviso de dados do paciente, nomes para começar) sem Critical/Important.

---

### Task 4: Lançar e editar exame, com versão (P22-04)

**Files:**
- Modify: `src/modules/pacientes/exames.ts` (`ValorExame` com `refMin?`/`refMax?`; `lerValores` aceita a faixa e grava `referencia = referenciaDaFaixa(…)` quando o texto está vazio; `editarExame`; `versoesDoExame`; as mensagens novas ficam em `MSG_EXAMES`, as de hoje continuam em `exames-constantes.ts`)
- Modify: `src/app/api/painel/pacientes/[id]/exames/route.ts` (aceita as linhas com faixa; nada mais muda), `src/app/painel/pacientes/[id]/exames/exame-form.tsx` (linhas como grupos rotulados, "Adicionar do catálogo", "Carregar modelo de solicitação", "Remover todos" com `DialogoConfirmar`, "Faixa do laudo: de/até", "Usar {a} a {b}", aviso de faixa divergente, classificação neutra ao vivo; prop `inicial?: { titulo: string; linhas: { nome: string; unidade: string | null }[] }` para a T8), `src/app/painel/pacientes/[id]/exames/page.tsx` (lê o catálogo e os modelos na mesma transação; "Editar" por exame), `src/app/painel/pacientes/[id]/exames/actions.ts` (`editarExameAction`)
- Create: `src/app/painel/pacientes/[id]/exames/[exameId]/editar/page.tsx`, `.../editar/editar-form.tsx`, `src/app/painel/pacientes/[id]/exames/[exameId]/versoes/page.tsx`, `src/app/painel/pacientes/[id]/exames/linhas-do-exame.tsx` (os campos das linhas, compartilhados por criar e editar)
- Modify: `src/modules/plataforma/audit.ts` — `export async function nomesDosAtores(db: Db, ids: string[]): Promise<Map<string, string>>` (o mesmo `select` de `user` que `listAccessHistory` já faz, extraído; EP-D53); `CLAUDE.md` regra 1 (frase "Plano 22: `audit.ts` também dá o nome do autor nas versões anteriores do exame e da nota (`nomesDosAtores`)")
- Modify: `src/modules/pacientes/exportacao-job.ts` — tipo de `exames[]` com `refMin?`/`refMax?` nas linhas (já saem: `valores: e.valores`) e `versoesAnteriores: { versao: number; titulo: string; data: string; valores: …[]; alteradoEm: string }[]` lida de `exam_versoes` (inclusão explícita de tabela `staff_only`, sem a justificativa e sem o autor, RN-399); comentário de `:326` ("menos as staff_only") ganha "salvo `exam_versoes` (Plano 22, EP-D41) e `exam_interpretacoes` (EP-D19)"
- Modify: `e2e/painel-rotas.ts` (`/painel/pacientes/[id]/exames/[exameId]/editar` e `/versoes`; `exame` em `IdsDoPainel`), `e2e/painel.ts`, `src/modules/ajuda/conteudo.ts` (guia `prontuario` +1 sobre a `main`, passo da aba Exames citando "Adicionar do catálogo" e "Editar"; rota de editar e de versões cobertas pelo padrão do guia ou em `SEM_AJUDA` com o motivo)
- Test: `src/modules/pacientes/exames.test.ts` (casos novos), `src/modules/pacientes/exames-edicao.test.ts`, `src/modules/pacientes/exames-leitores.test.ts`, `src/app/painel/pacientes/[id]/exames/linhas-do-exame.test.ts`, `src/modules/pacientes/exportacao.test.ts` (casos novos), `src/modules/plataforma/audit.test.ts`

**Interfaces:**
```ts
export type ValorExame = { nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string; refMin?: number; refMax?: number };
export function lerValores(bruto: unknown): ValorExame[] | null; // aceita refMin/refMax (lerDecimal; vírgula; |x| < 1e15; refMin ≤ refMax) e ignora iaTarefaId do bruto
export type LinhaEditada = { origem: number | null /* índice da linha original; null = nova */; nome: unknown; valor: unknown; unidade: unknown; referencia: unknown; refMin: unknown; refMax: unknown };
export async function editarExame(ctx: TenantContext, tenant: { fuso: string }, patientId: string, exameId: string,
  input: { titulo: unknown; data: unknown; linhas: LinhaEditada[]; justificativa: unknown; lidoEm: string /* updated_at ISO lido na abertura */ },
  deps?: { db?: Db }): Promise<void>; // ExameError com as mensagens de "Lançamento: erros"
export type VersaoDoExame = { versao: number; titulo: string; data: string; valores: ValorExame[]; justificativa: string | null; por: string; em: Date };
export async function versoesDoExame(ctx: TenantContext, patientId: string, exameId: string, deps?: { db?: Db }): Promise<{ exame: { titulo: string; data: string }; versoes: VersaoDoExame[] } | null>;
// actions.ts
export type EditarState = { erros?: Record<string, string>; valores?: Record<string, unknown> };
export async function editarExameAction(patientId: string, exameId: string, _prev: EditarState, f: FormData): Promise<EditarState>;
```
- `editarExame` (RN-378): valida tudo antes da transação; `carregarPacienteParaEscrita` → exame `.for('no key update')` → compara `updated_at` com `lidoEm` ("O exame mudou desde que você abriu. Recarregue a página.") → monta as linhas: para `origem` válido, copia `iaTarefaId` de `e.valores[origem]` (nunca do formulário); linha com `iaTarefaId` mantém `nome` e `valor` da original (só faixa e referência mudam); sem mudança nenhuma → "Nada foi alterado."; só acréscimo (título, data e linhas existentes iguais, na mesma ordem) → justificativa opcional; senão obrigatória (5–500, sem NUL) → "Informe a justificativa da alteração (de 5 a 500 caracteres)."; INSERT em `exam_versoes` com o estado **de antes** (`versao` = maior + 1 lido sob a trava do exame) e UPDATE de `exams` (`titulo`, `data`, `valores`, `updated_at`). O laudo não muda (EP-D44).
- `versoesDoExame`: `auditRead({ entidade: 'exames_versoes', entidadeId: exameId, patientId })` quando há versão; nomes por `nomesDosAtores` (fora da transação, como o Histórico).
- Formulário (§7): grupo `role="group"` com `aria-label` "Linha {n}: {marcador}"; rótulos "Marcador {n}", "Valor {n}", "Unidade {n}", "Referência do laudo {n}", "Faixa do laudo: de {n}", "até {n}"; ajuda "Copie a faixa impressa no laudo."; "Usar {a} a {b}" com nome acessível "Usar {a} a {b} (linha {n})" só preenche os campos; classificação ao vivo é texto ligado ao valor por `aria-describedby`, **não** região viva por tecla; aviso fixo "Classificação automática pela faixa de referência informada. Não é diagnóstico." uma vez, antes da tabela, por `aria-describedby`; layout de 8 células ≥ 1024 px, duas linhas de 768 a 1023 px, empilhado < 768 px; âncora `#novo-exame` mantida; "Carregar modelo de solicitação" traz só as linhas (as orientações não entram); exame no app → aviso "Este exame está no app do paciente. O que você salvar aparece lá na hora." (o campo é lido de `mostrarNoAppEm`, que já existe desde a T1).

- [ ] **Step 1: Testes que falham:**
  - `exames.test.ts`: linha com faixa 70–99 e referência vazia grava `referencia = "70 a 99"`; "de" 120 e "até" 99 → "O início da faixa deve ser menor ou igual ao fim."; "4.5" ou "abc" na faixa → "Faixa inválida. Use só números, como 70 ou 4,5."; `iaTarefaId` no bruto do POST é descartado.
  - `exames-edicao.test.ts`: o cenário "Editar exame" da US-371 (título, data e valor mudados com justificativa → versão 1 com o estado de antes, justificativa, `alterado_por` da sessão; `audit_log` com `alterar`/`exames` e `criar`/`exames_versoes`); sem justificativa → mensagem e nada gravado; só acréscimo → passa sem justificativa e grava a versão; nada mudou → "Nada foi alterado."; `iaTarefaId` forjado numa linha nova → ignorado; linha da IA com `nome`/`valor` mudados no formulário → gravada com os originais (só faixa e referência mudam); **Review Focus 3**: transação A abre a conferência (`aplicarSugestao` com o exame `FOR UPDATE`), B chama `editarExame` com o `lidoEm` antigo e espera; A confirma → B recebe a mensagem de "mudou"; paciente bloqueado ou anonimizado → recusa de hoje; o exame aceito do app sem valores ganha linhas sem justificativa; `versoesDoExame` grava um `ler`/`exames_versoes` e devolve o nome do autor; sessão de paciente → erro do assert de `requireNutri`/papel.
  - `exames-leitores.test.ts` (DEP-E1, R-371): com uma linha antiga (sem faixa) e uma nova (com `refMin`/`refMax`), cada leitor funciona e não muda de saída: `agruparMarcadores`/`marcadoresDoPaciente`, `copiarExames` (`parecer-exames.ts`: a cópia **não** leva `refMin`/`refMax`) e `mesmoExame` (`parecer.ts`: mudar só a faixa não conta como "valores mudaram"), `nomeDaSerie`/`jaLancado` (`correspondencia.ts`), o resumo da IA (`resumo-dados.ts`: as linhas campo a campo, sem faixa), `evolucao.ts`, `montarDados` (`exportacao-job.ts`).
  - `linhas-do-exame.test.ts` (estrutura, sem DOM): grupos com `aria-label`, rótulos numerados, aviso fixo antes da tabela com o `id` citado no `aria-describedby`, "Usar 70 a 99 (linha 1)" só com referência de padrão único.
  - `exportacao.test.ts`: `dados.json` traz `refMin`/`refMax` nas linhas e `versoesAnteriores` sem `justificativa` e sem autor, nos dois escopos.
  - `audit.test.ts`: `nomesDosAtores` devolve os nomes e ignora ids inexistentes.
- [ ] **Step 2:** `pnpm vitest run src/modules/pacientes/exames.test.ts src/modules/pacientes/exames-edicao.test.ts src/modules/pacientes/exames-leitores.test.ts src/app/painel/pacientes/[id]/exames src/modules/pacientes/exportacao.test.ts src/modules/plataforma/audit.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm vitest run src/modules/ia src/modules/documentos src/app/api/painel/pacientes src/app/painel/rotas-axe.test.ts src/modules/ajuda/conteudo.test.ts` → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(exames): lançar do catálogo e editar exame com versão (P22-04)`.

**Pronto quando:** testes verdes; `revisor-rls` (travas, `updated_at`, origem da IA, inclusão explícita na exportação) e `revisor-interface` (linhas, 360 px, foco) sem Critical/Important.

---

### Task 5: Detalhe do exame — categoria, REF, nota de interpretação e comparativo (P22-05)

**Files:**
- Create: `src/modules/exames/interpretacao.ts`, `src/modules/exames/comparativo.ts`
- Modify: `src/modules/pacientes/exames.ts` (`abrirExame`; `listarExames` passa a devolver o necessário para "Abrir"/"Comparar"/classificação, sem `auditRead` a mais)
- Create: `src/app/painel/pacientes/[id]/exames/[exameId]/page.tsx` (h1 "{título} — {dd/mm/aaaa}"), `.../[exameId]/nota-form.tsx`, `.../[exameId]/actions.ts` (`salvarNotaAction`, `apagarNotaAction`), `src/app/painel/pacientes/[id]/exames/ver-referencia.tsx` (`Dialogo` "Ver referência"), `src/app/painel/pacientes/[id]/exames/tabela-classificada.tsx` (lista, detalhe e comparativo), `src/app/painel/pacientes/[id]/exames/comparativo/page.tsx` (h1 "Comparativo de exames")
- Modify: `src/app/painel/pacientes/[id]/exames/page.tsx` ("Abrir {título} de {data}", caixas "Comparar {título} de {data}", botão "Comparar {n} exames" com o texto de apoio "Escolha de 2 a 6 exames para comparar." por `aria-describedby`; "Ler valores com IA", "Baixar laudo" e "Excluir" onde estão hoje — o E2E da conferência depende deles), `src/app/painel/pacientes/[id]/exames/[exameId]/versoes/page.tsx` (seção "Notas anteriores")
- Modify: `src/modules/pacientes/exportacao-job.ts` — `notaDeInterpretacao: string | null` (a em vigor) nos dois escopos e `notasAnteriores: { versao: number; texto: string | null; criadoEm: string }[]` só no escopo `equipe` (inclusão explícita, RN-399)
- Modify: `e2e/painel-rotas.ts` (`/painel/pacientes/[id]/exames/[exameId]` e `/comparativo`), `scripts/e2e-seed.ts` (catálogo do consultório do E2E: o painel "Hemograma completo" com 20 componentes e "Ferritina", com `ON CONFLICT DO NOTHING`, repetível), `e2e/acessibilidade-exames.spec.ts` ("Ver referência" aberto, diálogo "Inserir modelo"), `e2e/exames.spec.ts` (novo, IP `10.9.22`: CS-371)
- Modify (fechamento do PR 2): `docs/manual-tecnico/02-banco-de-dados.md` (quatro tabelas, coluna, política, gatilhos), `docs/manual-tecnico/04-modulos-clinicos.md` (catálogo, classificação, edição com versão, nota, comparativo), `docs/manual-tecnico/README.md` (glossário: "catálogo de exames", "faixa do laudo", "faixa do consultório", "classificação neutra", "nota de interpretação"), `CLAUDE.md` regra 8 (frase "Plano 22: `abrirExame`, o comparativo e `versoesDoExame` chamam `auditRead` (entidades `exames`/`exames_versoes`); a lista da aba continua com um `auditRead` por abertura"), índice dos planos (situação do PR 2)
- Test: `src/modules/exames/interpretacao.test.ts`, `src/modules/exames/comparativo.test.ts`, `src/modules/pacientes/exames-detalhe.test.ts`, `src/modules/exames/guardas.test.ts`, `src/modules/exames/log.test.ts`, `src/app/painel/pacientes/[id]/exames/tabela-classificada.test.ts`, `src/modules/pacientes/exportacao.test.ts`

**Interfaces:**
```ts
// src/modules/pacientes/exames.ts
export type LinhaNaTela = ValorExame & { neutra: Neutra | null; categoria: { nome: string; faixa: FaixaDoConsultorio } | null;
  faixasDoConsultorio: FaixaDoConsultorio[] /* do exame do catálogo que casou; [] sem casamento */; modeloNota: { abaixo: string | null; acima: string | null } | null };
export type ExameAberto = { id: string; titulo: string; data: string; temLaudo: boolean; noAppEm: Date | null; pacienteUsaApp: boolean;
  updatedAt: string; linhas: LinhaNaTela[]; nota: { versao: number; texto: string } | null };
export async function abrirExame(ctx: TenantContext, patientId: string, exameId: string, deps?: { db?: Db }): Promise<ExameAberto | null>;
// src/modules/exames/interpretacao.ts
export class NotaError extends Error { constructor(readonly erros: Record<string, string>) }
export async function salvarNota(ctx: TenantContext, patientId: string, exameId: string, texto: unknown, deps?: { db?: Db }): Promise<void>;
export async function apagarNota(ctx: TenantContext, patientId: string, exameId: string, deps?: { db?: Db }): Promise<void>;
export async function notasAnteriores(ctx: TenantContext, patientId: string, exameId: string, deps?: { db?: Db }): Promise<{ versao: number; texto: string | null; por: string; em: Date }[]>;
// src/modules/exames/comparativo.ts
export type Comparativo = { exames: { id: string; titulo: string; data: string }[]; linhas: { marcador: string; unidade: string | null;
  celulas: ({ valor: number; unidade: string | null; neutra: Neutra | null } | null)[] }[]; unidadesSeparadas: boolean };
export async function comparativo(ctx: TenantContext, patientId: string, ids: string[], deps?: { db?: Db }): Promise<Comparativo | { erro: 'quantidade' }>;
```
- `abrirExame`: uma transação: exame do paciente, nota em vigor (maior versão), catálogo (`catalogoParaLancamentoNaTransacao`, casado em memória por `indiceDoCatalogo`), `patients.sexo`/`data_nascimento` (nunca `patient_cadastro`, EP-D13), `patients.user_id` (para "Este paciente ainda não usa o app…", T6); `auditRead({ entidade: 'exames', entidadeId: exameId, patientId })`.
- `salvarNota`/`apagarNota` (RN-383): `ctx.role === 'nutri'`; texto 1–2000 ("A nota tem no máximo 2000 caracteres."); `carregarPacienteParaEscrita` → exame `.for('no key update')` (sem linha → "Exame não encontrado.") → INSERT com `versao` = maior + 1 (apagar = `texto` nulo). Nenhuma das duas faz UPDATE.
- `comparativo` (RN-384): ids de outro paciente ignorados (filtro por `patient_id` na consulta); depois do filtro, menos de 2 ou mais de 6 → `{ erro: 'quantidade' }`; ordem pela data (empate pela criação); linhas por `agruparMarcadores` (nome normalizado + unidade); célula com a neutra da linha daquele exame; **sem** categoria e sem nota; um `auditRead` por exame mostrado (entidade `exames`).
- Detalhe (§7): "Ver referência" por linha (nome acessível "Referência de {marcador}") com "Referência do laudo: {texto ou —}", "Faixa do laudo: {faixa}" e "Faixas do consultório" ("{Feminino|Masculino|Todos}, {idade}: {limites} — {categoria}", "Fonte: {fonte} · atualizada em {dd/mm/aaaa}") ou "Sem referência."; categoria ao lado da neutra com "(faixa do consultório)"; com categoria, também "As faixas do consultório não consideram gestação."; "Nota de interpretação" com a linha fixa acima do campo, a ajuda "Não aparece no app; entra na cópia dos dados que o paciente pedir.", "Inserir modelo" (lista "{exame} — abaixo"/"{exame} — acima" dos exames fora da faixa do laudo que casam com o catálogo; vazio → "Nenhum modelo para os exames fora da referência."; o texto entra na posição do cursor), "Salvar nota", "Apagar nota". Comparativo: `caption` "Resultados por data", `th scope="col"`/`scope="row"`, contêiner `div role="region" aria-labelledby tabIndex={0} … focus-visible:outline-offset-[-3px]` (exigência de `src/app/painel/cores.test.ts`), "—" sem a linha, nota "Marcadores com unidades diferentes aparecem em linhas separadas.", "Voltar aos exames"; URL com 0, 1 ou 7 ids → "Escolha de 2 a 6 exames para comparar.".

- [ ] **Step 1: Testes que falham:**
  - `interpretacao.test.ts`: o cenário "Escrever a nota" (versão 1, `audit_log` `criar`/`exames`); salvar de novo → versão 2, a 1 continua; "Apagar nota" → versão 3 com texto nulo e `abrirExame` sem nota; 2001 caracteres → mensagem; paciente bloqueado e anonimizado → recusa de hoje e nada gravado; `excluirExame` concorrente (A trava o exame e o exclui; B chama `salvarNota` e espera) → B recebe "Exame não encontrado.", nunca 23503; duas notas concorrentes no mesmo exame → versões 1 e 2, sem 23505.
  - `exames-detalhe.test.ts`: `abrirExame` devolve neutra, categoria do cenário "Vitamina D", faixas do REF e o modelo de nota; grava um `ler`/`exames` com o id; mudar a faixa do consultório muda a categoria mostrada num exame antigo (a data aparece); paciente sem sexo → só a neutra; nome ambíguo → sem categoria; a nota em vigor é a de maior versão.
  - `comparativo.test.ts`: o cenário "Comparar" da US-374 (3 de 4 exames; mais antiga à esquerda; "—" sem o marcador; mg/dL e mmol/L em linhas separadas com `unidadesSeparadas`); 1 e 7 ids → `erro`; id de outro paciente ignorado (e conta para o mínimo só se do paciente); três `ler` gravados; nenhuma chave de categoria ou nota no retorno.
  - `tabela-classificada.test.ts`: `caption`, `th scope`, região rolável focável com o contorno para dentro, classificação em texto, aviso fixo ligado por `aria-describedby`.
  - `guardas.test.ts` (RN-399, guarda por grafo com `test/grafo-de-imports.ts` + texto): nenhum arquivo alcançável de `src/modules/ia/**` é `src/modules/exames/interpretacao.ts`; nenhum arquivo de `src/modules/ia/**` contém `exam_interpretacoes`, `exam_versoes`, `examInterpretacoes` ou `examVersoes`; nenhum arquivo não-teste de `src/modules/ia/nutri-paciente/**` importa `exams` de `@/db/schema` nem `@/modules/portal/exames-liberados` (o segundo arquivo nasce na T6: a guarda já o cita); `campos-enviados.ts` sem mudança (comparar com a lista de hoje); RNF-377: `src/app/sw.ts` não contém `/p/exames`.
  - `log.test.ts` (RNF-370): força erros em `editarExame`, `salvarNota`, `salvarExameDoCatalogo` e `salvarModeloSolicitacao` com nome de exame, valor, faixa, nota e justificativa conhecidos; o logger capturado e o `beforeSend` (`src/lib/sentry-filtro.ts`) não recebem nenhum desses textos.
  - `exportacao.test.ts`: titular com `notaDeInterpretacao` (em vigor) e sem `notasAnteriores`; equipe com as duas; exame sem nota → `null`.
- [ ] **Step 2:** `pnpm vitest run src/modules/exames src/modules/pacientes/exames-detalhe.test.ts src/app/painel/pacientes/[id]/exames src/modules/pacientes/exportacao.test.ts` → FAIL.
- [ ] **Step 3:** implementar; E2E `e2e/exames.spec.ts` (CS-371): com o catálogo da semente (o `e2e-seed` ganha um painel "Hemograma completo" de 20 componentes e "Ferritina"), "Adicionar do catálogo" → painel → 20 linhas com nome e unidade; preencher a faixa de uma linha → "Acima da referência" antes de salvar; salvar; abrir; escrever e salvar a nota; marcar 2 exames e abrir o comparativo.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm typecheck && pnpm lint`; com a CPU liberada: `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e e2e/exames.spec.ts e2e/conferencia-ia.spec.ts e2e/acessibilidade-exames.spec.ts e2e/acessibilidade-painel.spec.ts` → PASS.
- [ ] **Step 5:** commit `feat(exames): detalhe com categoria, REF, nota de interpretação e comparativo (P22-05)`.

**Pronto quando:** testes verdes; `normas-cfn-lgpd` (nota honesta, categorias, aviso de gestação, exportação) e `revisor-interface` sem Critical/Important; `guardiao-manual` conferiu o manual técnico do PR 2; PR 2 pronto para o fluxo de revisão.

---

## PR 3 — App do paciente

### Task 6: "Mostrar no app" — painel, portal, menu e "No app" da ficha (P22-06)

**Antes:** merge do **Plano 18 PR 2** e do PR 2 deste plano na `main`; `git rebase origin/main`; ler `noAppPor` (`src/modules/ficha/secoes/comum.ts`), `src/modules/ficha/no-app.ts` e `no-app.test.ts` como mergeados — se divergirem do PR 2 do 18 lido em 17/11 (`nutridebby-18`, 3799409), seguir o código e registrar a diferença.

**Files:**
- Modify: `src/modules/pacientes/exames.ts` (`mostrarNoApp`, `retirarDoApp`), `src/app/painel/pacientes/[id]/exames/[exameId]/page.tsx` + `.../[exameId]/no-app.tsx` (botão, `DialogoConfirmar`, selo "No app", região de status fora do bloco trocado, foco de volta ao botão), `src/app/painel/pacientes/[id]/exames/page.tsx` (selo "No app" na lista; confirmação de excluir com "Este exame está no app do paciente. Ao excluir, ele some de lá." pelo `DialogoConfirmar`)
- Modify: `src/modules/plataforma/audit.ts` — `ENTIDADE_ROTULO` no fim: `exame_no_app_liberado: 'Exames'`, `exame_no_app_retirado: 'Exames'`; `rotuloDaAcao`: `if (i.entidade === 'exame_no_app_liberado' && i.acao === 'alterar') return 'Liberou exame no app';` e o par `'Retirou exame do app'` (EP-D45)
- Create: `src/modules/portal/exames-liberados.ts`
- Modify: `src/modules/portal/exames-enviados.ts` (`examesVisiveis` com o terceiro termo, avaliado por último), `src/app/p/moldura.ts`, `src/modules/portal/hoje.ts`, `src/app/p/(portal)/exames/page.tsx` (seção "Resultados liberados" acima do envio, em cartões com `<dl>`; "Meus exames enviados" some com o recebimento desligado e sem envio)
- Modify: `src/modules/ficha/secoes/exames.ts` (`noApp: noAppPor(exams, exams.id, (patientId) => eq(exams.patientId, patientId))` — a política faz o filtro; nenhum filtro em TypeScript além da RLS, RN-387), `src/modules/ficha/no-app.test.ts` (exame liberado e não liberado no cenário de paridade; e, se a T8 já estiver na `main`, a solicitação assinada e em rascunho, EP-D59)
- Modify: `src/modules/pacientes/exportacao-job.ts` (`mostradoNoAppEm: string | null` em `exames[]`, PM-E13), `src/modules/ajuda/portal.ts` (guia `portal-novidades` +1 sobre a `main`: Exames "enviar exame (quando o consultório recebe) e ver os resultados que a sua nutricionista liberar"; EP-D52) e `src/modules/ajuda/portal.test.ts` (pin da versão), `scripts/e2e-seed.ts` (um exame liberado da paciente do E2E), `docs/superpowers/specs/2026-11-16-nutridebby-18-ficha-cadastro-design.md` (no **fim**: "RN-279 v2 (Plano 22, EP-D22): os exames da nutricionista marcados 'Mostrar no app' contam no 'No app'"; a RN-279 não é editada no lugar), `CLAUDE.md` regra 1 (frase "Plano 22: a sessão de paciente lê de `exams` só o liberado (política `paciente_exame_liberado`); só `src/modules/portal/exames-liberados.ts` consulta, com projeção fechada") e regra 8 (frase "Plano 22: liberar e retirar do app gravam `recordAudit` próprio (`exame_no_app_liberado`/`_retirado`, 'Liberou exame no app'/'Retirou exame do app'); `examesLiberadosDoPaciente` chama `auditRead` (entidade `exames`, `entidadeId: null`); `temExameLiberado*` não chamam"), `docs/manual-tecnico/05-agenda-portal-conteudo.md` e `04-modulos-clinicos.md`
- Test: `src/modules/pacientes/exames-no-app.test.ts`, `src/modules/portal/exames-liberados.test.ts`, `src/modules/portal/exames-enviados.test.ts` (as quatro combinações), `src/modules/portal/hoje.test.ts`, `src/app/p/(portal)/exames/page.test.ts`, `src/modules/ficha/no-app.test.ts`, `src/modules/plataforma/audit.test.ts`, `src/modules/pacientes/exportacao.test.ts`, `src/modules/ajuda/portal.test.ts`, `e2e/app-paciente.spec.ts` (caso novo)

**Interfaces:**
```ts
// src/modules/pacientes/exames.ts
export async function mostrarNoApp(ctx: TenantContext, patientId: string, exameId: string, deps?: { db?: Db; agora?: Date }): Promise<{ pacienteUsaApp: boolean }>;
export async function retirarDoApp(ctx: TenantContext, patientId: string, exameId: string, deps?: { db?: Db }): Promise<void>;
// src/modules/portal/exames-liberados.ts
export type ExameLiberado = { id: string; data: string; titulo: string;
  linhas: { nome: string; valor: number; unidade: string | null; referencia: string | null; fora: boolean | null }[] };
export async function examesLiberadosDoPaciente(ctx: TenantContext, db?: Db): Promise<ExameLiberado[]>; // auditRead uma vez com itens
export async function temExameLiberado(ctx: TenantContext, db?: Db): Promise<boolean>;
export async function temExameLiberadoNaTransacao(tx: Tx, patientId: string): Promise<boolean>;
// src/modules/portal/exames-enviados.ts
export async function examesVisiveis(tenant: { examesPacienteAtivadoEm: Date | null }, temEnvio: () => Promise<boolean>, temLiberado: () => Promise<boolean>): Promise<boolean>;
```
- `mostrarNoApp`/`retirarDoApp` (RN-385): `carregarPacienteParaEscrita` → exame `.for('no key update')` → UPDATE **só** de `mostrar_no_app_em` (`now()` ou `null`; nunca `updated_at`) → `recordAudit(tx, { acao: 'alterar', entidade: 'exame_no_app_liberado' | 'exame_no_app_retirado', entidadeId: exameId, patientId })`. Liberar o que já está liberado e retirar o que não está: sem UPDATE e sem evento. `pacienteUsaApp` = `patients.user_id IS NOT NULL` (o estado de `situacaoDoAcesso`).
- `examesLiberadosDoPaciente`: `pacienteDaSessao(ctx, …)`; consulta `exams` **sem** filtro por `mostrar_no_app_em` em TypeScript (a RLS decide; M7 da crítica) além de `patient_id`; mapeia só as chaves acima (`fora` por `foraParaOApp`); nunca `iaTarefaId`, `arquivo_path`, nota ou categoria.
- Portal (§7): h2 "Resultados liberados", "Resultados que sua nutricionista liberou para você.", aviso "Não é diagnóstico. Converse com sua nutricionista." no topo da seção; cartão por exame (título e data no cabeçalho, `wrap-break-word`), `<dl>` por marcador: nome em destaque, "Resultado: {valor} {unidade}", "Referência: {texto}"; "Fora da referência" no `Selo`, junto do valor; sem tabela.
- Textos do painel: "Mostrar no app do paciente" (botão, não `role=switch`), confirmação "O paciente verá no app o título, a data, os valores e a referência deste exame, com o aviso de que não é diagnóstico. A nota de interpretação, as categorias do consultório e o laudo não aparecem." ("Mostrar no app", "Cancelar"), "O exame aparece no app do paciente.", "Este paciente ainda não usa o app. O exame aparece quando ele entrar.", "Retirar do app" (imediato), "O exame saiu do app do paciente.", erro "Não foi possível mudar o app do paciente. Tente de novo.".

- [ ] **Step 1: Testes que falham:**
  - `exames-no-app.test.ts`: liberar, retirar e liberar de novo → três eventos distinguíveis (`exame_no_app_liberado`, `_retirado`, `_liberado`), cada um com o ator da sessão; `updated_at` igual antes e depois (**Review Focus 3**); um `editarExame` com o `lidoEm` de antes da liberação passa; paciente sem `user_id` → `pacienteUsaApp: false`; bloqueado → recusa; liberar duas vezes → um evento.
  - `audit.test.ts`: `rotuloDaAcao` devolve "Liberou exame no app"/"Retirou exame do app" e `ENTIDADE_ROTULO` "Exames" para as duas entidades.
  - `exames-liberados.test.ts`: P2 com login vê só o liberado; chaves **exatas** do retorno (`Object.keys` de exame e de linha); `fora` `null` com faixa e texto divergentes; `auditRead` uma vez com itens e nenhuma sem; `temExameLiberado` sem `ler`; sessão `nutri` → erro de `pacienteDaSessao`.
  - `exames-enviados.test.ts`: as quatro combinações de `examesVisiveis` (recebimento ligado; desligado com envio; desligado sem envio com liberado; desligado sem nada → `false`) e `temLiberado` não é chamado quando um termo anterior já deu `true`.
  - `hoje.test.ts`: `faixaDeHoje` com recebimento desligado, sem envio e com exame liberado → `exames: true`, na mesma transação.
  - `page.test.ts` (portal, estrutura): "Resultados liberados" antes de "Enviar exame"; `<dl>`; "Meus exames enviados" ausente sem recebimento e sem envio; presente com envio antigo.
  - `no-app.test.ts`: contagem e selo do exame liberado iguais aos de `examesLiberadosDoPaciente` na sessão da paciente; não liberado fora.
  - `exportacao.test.ts`: `mostradoNoAppEm` ISO ou `null`.
  - `e2e/app-paciente.spec.ts`: a paciente do E2E vê o exame liberado em "Exames" a 360 px, sem rolagem lateral, com o aviso; o menu mostra "Exames" com o recebimento desligado.
- [ ] **Step 2:** `pnpm vitest run src/modules/pacientes/exames-no-app.test.ts src/modules/portal src/app/p src/modules/ficha src/modules/plataforma/audit.test.ts src/modules/pacientes/exportacao.test.ts src/modules/ajuda/portal.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm vitest run test/isolamento.test.ts src/modules/exames/guardas.test.ts` → PASS; `pnpm typecheck && pnpm lint`; com a CPU liberada: `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e e2e/app-paciente.spec.ts e2e/exames-enviados.spec.ts e2e/acessibilidade.spec.ts e2e/acessibilidade-exames.spec.ts e2e/ficha.spec.ts` → PASS (axe do cartão do portal com exame liberado e da confirmação "Mostrar no app").
- [ ] **Step 5:** commit `feat(exames): mostrar no app do paciente, com o menu e o No app da ficha (P22-06)`.

**Pronto quando:** testes verdes; `revisor-rls` (RLS × projeção, paridade, `recordAudit`) e `revisor-interface` (portal a 360 px, botão e status) sem Critical/Important; RN-279 v2 acrescentada ao fim da spec 18; PR 3 pronto para o fluxo de revisão.

---

## PR 4 — Documentos

### Task 7: Infraestrutura do tipo novo de documento e filas "-2" (P22-07)

**Files:**
- Create: `src/modules/documentos/tipos-de-documento.ts`, `src/worker/filas-documento-pdf.test.ts`
- Modify: `src/modules/documentos/constantes.ts` (`TIPO_DOCUMENTO_ROTULO.solicitacao_exames = 'Solicitação de exames laboratoriais'`; `TIPO_DOCUMENTO_COM_ARTIGO.solicitacao_exames = 'da solicitação de exames laboratoriais'`; `DECLARACAO_POR_TIPO.solicitacao_exames = DECLARACAO_SOLICITACAO`, importada de `solicitacao.ts`), `src/modules/documentos/parecer.ts` (`ConteudoDocumento = ConteudoReceita | ConteudoParecer | ConteudoSolicitacao`)
- Modify (ternários → `switch` + `assertNever`, DEP-E7): `src/modules/documentos/retificacao.ts:30-33` (`semCopia` vem de `tipos-de-documento.ts`, copia **todas** as chaves do conteúdo menos `copia` e `declaracao`) e `:63` (justificativa só para a receita, por `switch`); `src/modules/documentos/documento-pdf.tsx:109` (corpo por `switch`; `CorpoSolicitacao` nesta tarefa, em texto puro: título, exames — um painel com o nome dele —, indicação clínica só se preenchida, orientações; sem campo de laboratório); `src/modules/documentos/documentos.ts:37` (`conteudoVazio(tipo)`) e `:141` (`switch` no preparo; o caso `solicitacao_exames` chama `validarSolicitacaoParaPreparar`); `:75` e `:96` **ficam** (as guardas do editor recusam qualquer outro tipo, inclusive o novo; EP-D57); `src/modules/documentos/link-documento.ts:128` (sem `?? 'receita'`: tipo ausente → `indisponivel`); `src/modules/documentos/lgpd-documentos.ts:93` (`switch`; o caso da solicitação na T8); `src/modules/documentos/registrar-assinatura.ts:52` (`exigirHabilitacaoAtual` por `switch`: receita confere `exigeHabilitacao(i.tipo)` em cada item; parecer e solicitação passam por caso explícito; conteúdo `'{}'` anonimizado passa); `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx:45-46` (`switch` no formulário/visão por tipo; o caso `solicitacao_exames` responde `notFound()` até a T8, que o troca pelo formulário e pela visão no mesmo PR — nenhum caminho do app cria solicitação antes da T8); `src/modules/documentos/digitalizada-job.tsx:29` (o título vem do `switch`, sem `?? TIPO_DOCUMENTO_ROTULO.receita`) e `:92`
- Modify (filas, EP-D34): `src/jobs/queues.ts` (`'documento-pdf-2'` e `'documento-digitalizado-2'` com as mesmas opções das originais, linhas novas; `FILA_DO_PDF_DO_DOCUMENTO`, `FILAS_DO_PDF_DO_DOCUMENTO`, `FILA_DA_DIGITALIZADA`, `FILAS_DA_DIGITALIZADA` em linhas separadas, no molde de `FILA_DO_PDF_DO_PLANO` do Plano 19), `src/worker/index.ts` (`for (const fila of FILAS_DO_PDF_DO_DOCUMENTO) await work(fila, …)` com o handler de hoje; idem para a digitalizada), `src/modules/documentos/documentos.ts:163` e `:225`, `src/modules/documentos/digitalizada.ts:113` (enviam para `FILA_DO_PDF_DO_DOCUMENTO`/`FILA_DA_DIGITALIZADA`)
- Test: `src/modules/documentos/tipos-de-documento.test.ts`, `src/modules/documentos/retificacao.test.ts`, `src/modules/documentos/registrar-assinatura.test.ts`, `src/modules/documentos/documento-pdf-job.test.ts`, `src/modules/documentos/digitalizada-job.test.ts`, `src/modules/documentos/link-documento.test.ts`, `src/modules/documentos/verificacao.test.ts`, `src/worker/filas-documento-pdf.test.ts`

**Interfaces:**
```ts
// src/modules/documentos/tipos-de-documento.ts (puro)
export const TIPOS_DE_DOCUMENTO = ['receita', 'parecer', 'solicitacao_exames'] as const;
export function assertNever(x: never): never;
export function conteudoVazio(tipo: TipoDocumento): ConteudoDocumento;
export function semCopia(c: ConteudoDocumento): ConteudoDocumento;
export { exigeHabilitacao } from './prescricao';
// src/jobs/queues.ts
export const FILA_DO_PDF_DO_DOCUMENTO = 'documento-pdf-2' satisfies QueueName;
export const FILAS_DO_PDF_DO_DOCUMENTO = ['documento-pdf', FILA_DO_PDF_DO_DOCUMENTO] as const satisfies readonly QueueName[];
export const FILA_DA_DIGITALIZADA = 'documento-digitalizado-2' satisfies QueueName;
export const FILAS_DA_DIGITALIZADA = ['documento-digitalizado', FILA_DA_DIGITALIZADA] as const satisfies readonly QueueName[];
```

- [ ] **Step 1: Testes que falham:**
  - `tipos-de-documento.test.ts`: `TIPOS_DE_DOCUMENTO` igual às chaves de `TIPO_DOCUMENTO_ROTULO` e ao CHECK do schema (`signed_documents_tipo_valido`, lido do SQL de `src/db/schema/documentos.ts`); `conteudoVazio` de cada tipo; `semCopia` mantém `orientacoesFormato`, `indicacaoClinica` e uma chave desconhecida, e tira `copia` e `declaracao`.
  - `retificacao.test.ts`: retificar uma solicitação assinada → versão 2 `solicitacao_exames` com os mesmos exames, indicação e `orientacoesFormato`; a nota da versão nova sem justificativa; retificar a receita continua levando a justificativa.
  - `registrar-assinatura.test.ts`: solicitação passa sem olhar habilitação; receita com `fitoterapico` sem habilitação continua recusada (`habilitacao_retirada`).
  - `documento-pdf-job.test.ts`: PDF da solicitação com o título "Solicitação de exames laboratoriais", os exames, a indicação só quando preenchida, sem a palavra "Laboratório" como campo, com código e QR; o da receita e o do parecer iguais aos de hoje (snapshot de texto).
  - `digitalizada-job.test.ts`: título da solicitação certo; nenhum `undefined` no título de nenhum tipo.
  - `link-documento.test.ts`: dado de link sem `tipoDoc` → `indisponivel` (nunca vira receita).
  - `verificacao.test.ts`: verificação de uma solicitação mostra só o rótulo, o código, a data e a situação (chaves iguais às de hoje).
  - `filas-documento-pdf.test.ts` (lê o fonte, molde de `filas-plano-pdf.test.ts` do Plano 19): nenhum `send('documento-pdf'` nem `send('documento-digitalizado'` (com aspas simples ou duplas) em `src/` fora de `queues.ts`; `worker/index.ts` registra as quatro filas pelas constantes.
- [ ] **Step 2:** `pnpm vitest run src/modules/documentos src/worker/filas-documento-pdf.test.ts` → FAIL.
- [ ] **Step 3:** implementar; depois, `grep -rn "=== 'parecer'\|!== 'parecer'\|=== 'receita'\|!== 'receita'\|?? 'receita'\|TIPO_DOCUMENTO_ROTULO.receita" src/modules/documentos src/app/painel/pacientes src/app/p src/app/documento src/modules/ficha` e justificar cada sobra num comentário (`contents.tipo = 'receita'`, receita culinária, não conta).
- [ ] **Step 4:** mesmo comando + `pnpm vitest run src/modules/ficha src/app/painel/pacientes/[id]/documentos src/app/p/(portal)/documentos` → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `refactor(documentos): tipo de documento por switch exaustivo e filas -2 do PDF (P22-07)`.

**Pronto quando:** testes verdes; grep do Step 3 sem sobra injustificada; `revisor-rls` (fila, assinatura, LGPD) sem Critical/Important.

---

### Task 8: Solicitação de exames laboratoriais e "Lançar resultados" (P22-08)

**Files:**
- Modify: `src/modules/documentos/documentos.ts` (`criarSolicitacao`, `salvarRascunhoSolicitacao`), `src/modules/documentos/lgpd-documentos.ts` (caso `solicitacao_exames`: exames, indicação clínica e orientações; titular só os emitidos, como a receita), `src/modules/pacientes/exportacao-job.ts` (tipo da seção `documentos` com a solicitação)
- Create: `src/modules/documentos/lancar-resultados.ts`, `src/app/painel/pacientes/[id]/documentos/[docId]/solicitacao-form.tsx`, `.../[docId]/solicitacao-visao.tsx` (somente leitura: cartões "Exames solicitados", "Indicação clínica", "Orientações")
- Modify: `src/app/painel/pacientes/[id]/documentos/actions.ts` (`criarSolicitacaoAction`, `salvarSolicitacaoAction`, `prepararSolicitacaoAction`, no molde de `criarReceitaAction`/`salvarRascunhoAction`/`prepararAction`), `src/app/painel/pacientes/[id]/documentos/page.tsx` (botão "Nova solicitação de exames", só com `documentos_liberados`), `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx` (o `switch` da T7 aponta para o formulário e a visão; "Lançar resultados" na solicitação `assinada` em vigor), `src/app/painel/pacientes/[id]/exames/page.tsx` (`?solicitacao=<docId>` → `examesParaLancar` → `ExameForm` com `inicial`, EP-D50)
- Modify (ficha, Plano 18): `src/modules/ficha/tipos.ts` (`'criar-solicitacao'` no **fim** do union `ChaveDeAcao`), `src/modules/ficha/secoes/documentos.ts` (linha no **fim** de `adicionar`: `{ grupo: 'avaliacoes', rotulo: MSG_FICHA.itens.solicitacao, destino: { acao: 'criar-solicitacao' } }`), `src/modules/ficha/textos.ts` (`MSG_FICHA.itens.solicitacao = 'Solicitação de exames'`), `src/app/painel/pacientes/[id]/inicio/acoes.ts` (`'criar-solicitacao': criarSolicitacaoAction`), `src/modules/ficha/no-app.test.ts` (solicitação assinada e em rascunho no cenário, se o 18 PR 2 estiver na `main`, EP-D59)
- Modify: `src/modules/ajuda/conteudo.ts` (guia `documentos` +1 sobre a `main` — hoje 2 → 3 —, passo novo `nova-solicitacao` com `data-guia` no botão e perguntas sobre "Lançar resultados"; o texto novo do `prontuario`, se mudar, sem a palavra "documento"), `src/modules/ajuda/conteudo.test.ts`, `e2e/solicitacao-exames.spec.ts` (novo, IP `10.9.22`)
- Test: `src/modules/documentos/solicitacao-documento.test.ts`, `src/modules/documentos/lancar-resultados.test.ts`, `src/modules/documentos/lgpd-documentos.test.ts`, `src/app/painel/pacientes/[id]/documentos/actions.test.ts`, `src/app/painel/pacientes/[id]/documentos/[docId]/solicitacao-form.test.ts`, `src/modules/ficha/registro.test.ts`, `src/modules/ficha/secoes.test.ts`, `src/modules/pacientes/exportacao.test.ts`

**Interfaces:**
```ts
// src/modules/documentos/documentos.ts
export const criarSolicitacao = (ctx: TenantContext, patientId: string, deps?: { db?: Db }): Promise<string>; // criarDocumento(…, conteudoVazio('solicitacao_exames'), …)
export async function salvarRascunhoSolicitacao(ctx: TenantContext, patientId: string, docId: string,
  input: { conteudo: unknown; motivoRetificacao?: unknown }, deps?: { db?: Db }): Promise<void>; // travas paciente → documento; d.tipo !== 'solicitacao_exames' → TransicaoInvalidaError
// src/modules/documentos/lancar-resultados.ts
export async function examesParaLancar(ctx: TenantContext, patientId: string, docId: string, deps?: { db?: Db }):
  Promise<{ titulo: string /* "Exames solicitados em {dd/mm/aaaa}" (data do preparo) */; linhas: { nome: string; unidade: string | null }[] } | null>;
// src/app/painel/pacientes/[id]/documentos/actions.ts
export async function criarSolicitacaoAction(patientId: string): Promise<void>;
export async function salvarSolicitacaoAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm>;
export async function prepararSolicitacaoAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm>;
```
- `examesParaLancar` (RN-390): só a solicitação `assinada` em vigor do paciente (senão `null`); lê o conteúdo por `lerDocumentoNaTransacao(tx, docId, { auditar: true, patientId })` (o `auditRead` de `lerDocumento`); expande os painéis com o catálogo atual (`expandirParaAnalise`); o exame que a nutricionista salvar **não** aponta para a solicitação.
- Editor (§6.2, §7): h1 "Solicitação de exames laboratoriais"; "Exames" com "Remover" por linha; "Adicionar do catálogo" (`escolher-do-catalogo.tsx`, `modo: 'lista'`), "Adicionar exame fora do catálogo" com a ajuda fixa "Só exames laboratoriais (Lei nº 8.234/1991, art. 4º, VIII).", "Carregar modelo" ("Acrescentar", "Substituir" com "Substituir os {n} exames da solicitação pelos do modelo?"; as orientações do modelo só se as da tela estiverem vazias; "Nenhum modelo ainda." com o link), "Remover todos"; "Indicação clínica (opcional)" com a linha fixa "Descreva a finalidade nutricional; não afirme doença."; "Orientações ao paciente (opcional)" com a ajuda "Preparo, jejum, horário. Aparecem no pedido." (em texto puro nesta tarefa; a barra de marcação e a prévia na T9); aviso "Planos de saúde podem recusar pedido de exame feito por nutricionista." num `Aviso tipo="aviso"`; declaração `DECLARACAO_SOLICITACAO` no preparo.

- [ ] **Step 1: Testes que falham:**
  - `solicitacao-documento.test.ts`: criar → rascunho `solicitacao_exames` com `conteudoVazio`; salvar com exames do catálogo, painel e livre; preparar sem exames → "Inclua ao menos um exame."; preparar com a declaração → `preparando`, código, cópia do profissional e do paciente, `declaracao = DECLARACAO_SOLICITACAO` e **um job em `documento-pdf-2`** (nenhum em `documento-pdf`); sem `documentos_liberados` → a action recusa (como a receita); o editor da receita não grava numa solicitação (`TransicaoInvalidaError`) e vice-versa; assinatura digitalizada, entrega, recebimento, cancelamento e verificação pelo caminho de hoje (um teste de ponta a ponta no módulo).
  - `lancar-resultados.test.ts`: o cenário "Lançar resultados" da US-377 (título com a data do preparo; painel expandido; um `ler` gravado); rascunho, cancelada ou substituída → `null`; outro paciente → `null`.
  - `lgpd-documentos.test.ts`: cópia do titular com a solicitação emitida (exames, indicação, orientações) e sem o rascunho; anonimizada (`'{}'`) passa sem erro.
  - `solicitacao-form.test.ts` (estrutura): ajudas fixas presentes; nenhum campo de laboratório; aviso dos planos de saúde.
  - `registro.test.ts`/`secoes.test.ts`: `adicionar` da seção Documentos termina com a solicitação no grupo `avaliacoes`; `ACOES` tem a chave nova (o `Record<ChaveDeAcao, …>` compila); sem `documentos_liberados` a entrada não aparece.
  - `exportacao.test.ts`: `dados.json` com a solicitação em `documentos`.
  - `e2e/solicitacao-exames.spec.ts` (CS-370): ficha → "Adicionar" → "Solicitação de exames" → "Carregar modelo" (modelo da semente) → preparar → assinar (digitalizada da semente, como `e2e/documentos.ts`) → entregar no portal; o paciente vê o documento; "Lançar resultados" abre o "Novo exame" com as linhas — sem digitar nome de exame.
- [ ] **Step 2:** `pnpm vitest run src/modules/documentos src/app/painel/pacientes/[id]/documentos src/modules/ficha src/modules/pacientes/exportacao.test.ts src/modules/ajuda/conteudo.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm typecheck && pnpm lint`; com a CPU liberada: `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e e2e/solicitacao-exames.spec.ts e2e/documentos.spec.ts e2e/parecer.spec.ts e2e/inicio.spec.ts` → PASS.
- [ ] **Step 5:** commit `feat(documentos): solicitação de exames laboratoriais e Lançar resultados (P22-08)`.

**Pronto quando:** testes verdes; `normas-cfn-lgpd` (declaração, ajudas fixas, sem laboratório, aviso dos planos) e `revisor-interface` sem Critical/Important.

---

### Task 9: Receita — fórmula magistral fitoterápica e orientações formatadas (P22-09)

**Files:**
- Modify: `src/modules/documentos/prescricao.ts` (`TIPOS_ITEM.formula_fitoterapica = 'Fórmula magistral com vários compostos vegetais'`; item `formula_fitoterapica` na união do Zod: 2–10 compostos `{ nomenclatura, parte, extracao, padronizacao?, quantidade, unidade }`, `formaFarmaceutica`, `via` (oral, sublingual ou enteral), `posologia` ≤ 300, `duracao`; binômio e termos barrados por `superRefine` com as mensagens `compostos`, `binomio`, `naoVegetal`; a padronização fica fora da conferência; `descreverItem` com o caso novo e `assertNever` no `default`; `ConteudoReceita.orientacoesFormato?: 'marcacao'`, gravado em todo conteúdo novo; `semHabilitacao` e `dicaOutro` citando os dois tipos), `src/modules/documentos/constantes.ts` (`declaracaoDoDocumento`, EP-D56)
- Modify: `src/modules/documentos/documentos.ts` (`prepararParaAssinatura` grava `declaracao: declaracaoDoDocumento(conteudo)`), `src/modules/documentos/documento-pdf.tsx` (fórmula; orientações por `lerMarcacao` → `<Text>` com negrito e lista, receita e solicitação; sem a chave → texto puro), `src/modules/documentos/lgpd-documentos.ts` (a fórmula pelo `descreverItem`)
- Create: `src/app/painel/pacientes/[id]/documentos/[docId]/orientacoes-campo.tsx` (barra "Negrito" · "Lista", ajuda "Escreva ** antes e depois do trecho para negrito; comece a linha com um hífen para fazer lista.", "Prévia"), `src/components/marcacao-blocos.tsx` (blocos → `<p>`, `<ul>`, `<strong>`; nunca `dangerouslySetInnerHTML`)
- Modify: `src/app/painel/pacientes/[id]/documentos/[docId]/receita-form.tsx` (tipo novo com lista de compostos e "Acrescentar composto", ajuda sob o seletor do tipo por `aria-describedby`, tipo desabilitado sem habilitação com a mensagem `semHabilitacao`; `OrientacoesCampo`), `.../[docId]/solicitacao-form.tsx` (`OrientacoesCampo`), `.../[docId]/page.tsx` (orientações formatadas na página do documento; a declaração mostrada no preparo = `declaracaoDoDocumento`)
- Modify: `src/modules/ajuda/conteudo.ts` (guias `documentos` e `configuracoes` citam os dois tipos de fitoterápico e dizem que o tipo aparece **desabilitado** sem a habilitação; sem novo bump se a T8 já subiu `documentos` neste PR)
- Test: `src/modules/documentos/prescricao.test.ts`, `src/modules/documentos/formula-fitoterapica.test.ts`, `src/modules/documentos/marcacao-documento.test.ts`, `src/modules/documentos/portal.test.ts`, `src/modules/documentos/verificacao.test.ts`, `src/modules/documentos/documento-pdf-job.test.ts`, `src/app/painel/pacientes/[id]/documentos/[docId]/receita-form.test.ts`, `src/components/marcacao-blocos.test.ts`, `src/modules/pacientes/exportacao.test.ts`

**Interfaces:**
```ts
// src/modules/documentos/constantes.ts
export const FRASE_FORMULA_FITOTERAPICA = ', e que a fórmula magistral fitoterápica tem só derivados vegetais, sem vitaminas, minerais, aminoácidos ou substâncias isoladas (Resolução CFN nº 680/2021, art. 9º, II)';
export function declaracaoDoDocumento(c: ConteudoDocumento): string; // receita com formula_fitoterapica → DECLARACAO_RECEITA com a frase antes do ponto final; senão DECLARACAO_POR_TIPO[c.tipo]
// src/components/marcacao-blocos.tsx
export function MarcacaoBlocos(p: { texto: string; formato?: 'marcacao' }): JSX.Element; // sem formato → texto puro com quebras de linha
```

- [ ] **Step 1: Testes que falham:**
  - `formula-fitoterapica.test.ts`: o cenário da US-378 com 3 compostos e habilitação → salvo; sem habilitação → salvar, preparar e assinar recusados com `semHabilitacao` (**Review Focus 4**, inclusive habilitação retirada entre o preparo e o envio das fotos); "Picolinato de cromo", "Vitamina C", "Creatina monoidratada", "Curcumina lipossomal", "Lactobacillus acidophilus" e "curcumina isolada" no derivado → `naoVegetal`; "camomila" → `binomio`; padronização "5% de curcuminoides" passa; 1 e 11 compostos → `compostos`; declaração do preparo com a frase só quando há fórmula; retificar uma receita com fórmula e orientações formatadas → versão 2 com a fórmula, `orientacoesFormato` e a justificativa.
  - `marcacao-documento.test.ts` (RNF-374): PDF da receita e da solicitação com `**negrito**`, lista e `<script>alert(1)</script>` → o texto aparece literal no PDF (extração de texto), sem link; receita antiga (sem `orientacoesFormato`) sai em texto puro como hoje; rascunho antigo salvo de novo passa a `'marcacao'`.
  - `portal.test.ts` e `verificacao.test.ts`: chaves de `documentosDoPaciente` e da verificação **iguais às de hoje** com uma solicitação e uma receita com fórmula (nenhuma chave nova, D17 e D8 do 10A).
  - `marcacao-blocos.test.ts`: `<script>` e `<b>` saem escapados no HTML renderizado; lista vira `<ul>`; guarda de texto: nenhum arquivo de `src/app/painel/pacientes/[id]/documentos`, `src/components/marcacao-blocos.tsx` e `src/modules/documentos` contém `dangerouslySetInnerHTML`.
  - `receita-form.test.ts`: ajuda do seletor ligada por `aria-describedby`; tipo desabilitado sem habilitação; "Acrescentar composto".
  - `exportacao.test.ts`: a fórmula descrita item a item no `dados.json`.
- [ ] **Step 2:** `pnpm vitest run src/modules/documentos src/app/painel/pacientes/[id]/documentos src/components/marcacao-blocos.test.ts src/modules/pacientes/exportacao.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando + `pnpm vitest run src/modules/ajuda/conteudo.test.ts` → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(documentos): fórmula magistral fitoterápica e orientações com marcação mínima (P22-09)`.

**Pronto quando:** testes verdes; `normas-cfn-lgpd` (art. 9º, II, termos barrados como conferência de apoio, frase da declaração, habilitação nos três pontos) sem Critical/Important.

---

### Task 10: Itens salvos e modelos de prescrição (P22-10)

**Files:**
- Create: `src/db/schema/prescricao-modelos.ts` (`prescricaoItensSalvos`, `prescricaoModelos`; export no **fim** de `src/db/schema/index.ts`), `drizzle/<MMMM>_prescricao_modelos.sql` (`pnpm db:generate --name prescricao_modelos`), `drizzle/<MMMM+1>_rls_prescricao_modelos.sql` (custom; cabeçalho `-- Plano 22 (editado à mão). Spec §9.7, RN-393, RN-394. CLAUDE.md regra 2.`; `app_enable_tenant_rls` e `app_enable_staff_only` das duas, um comando por bloco)
- Modify: `src/db/rls-guard.ts` (`STAFF_ONLY` no fim: as duas, com o motivo das bibliotecas), `test/isolamento.test.ts` (`FABRICAS` no fim: nome único por chamada; `item`/`itens` com um suplemento válido), `CLAUDE.md` regra 2 (frase "Plano 22: `prescricao_itens_salvos` e `prescricao_modelos` em `STAFF_ONLY` (PR 4)")
- Create: `src/modules/documentos/modelos.ts`, `src/app/painel/prescricao/layout.tsx` (`notFound()` sem `documentos_liberados`; `nav aria-label="Seções de prescrição"` com "Suplementos · Fitoterápicos · Modelos de prescrição"), `src/app/painel/prescricao/itens/page.tsx` (`?tipo=suplementos|fitoterapicos`; ausente ou inválido → `suplementos`), `.../itens/novo/page.tsx`, `.../itens/[id]/page.tsx`, `.../itens/item-salvo-form.tsx` (reaproveita os campos do item da receita), `.../itens/actions.ts`, `src/app/painel/prescricao/modelos/page.tsx`, `.../modelos/[id]/page.tsx`, `.../modelos/actions.ts`
- Modify: `src/app/painel/pacientes/[id]/documentos/[docId]/receita-form.tsx` ("Salvar item" por item, "Adicionar item salvo", "Salvar como modelo", "Carregar modelo" — cada um com o seu `Dialogo` e `<form>` próprio, fora do `<form>` da receita), `src/app/painel/pacientes/[id]/documentos/actions.ts` (`salvarItemAction`, `salvarComoModeloAction`, `carregarModeloAction`), `src/app/painel/configuracoes/page.tsx` (cartão no **fim** de `CARTOES`, só com `documentos_liberados`: "Prescrição" · "Suplementos, fitoterápicos e modelos de prescrição." → `/painel/prescricao/itens`), `src/app/painel/navegacao.ts` (`'/painel/prescricao'` no **fim** de `DO_HUB`), `src/modules/ajuda/conteudo.ts` (guia novo `prescricao` no fim de `GUIAS`; `configuracoes` +1 sobre a `main`), `e2e/painel-rotas.ts` (cinco rotas; `itemSalvo` e `modeloPrescricao` em `IdsDoPainel`), `e2e/painel.ts`
- Test: `src/modules/documentos/modelos.test.ts`, `src/modules/documentos/banco-modelos.test.ts`, `src/app/painel/prescricao/itens/actions.test.ts`, `src/app/painel/pacientes/[id]/documentos/actions.test.ts`, `src/app/painel/navegacao.test.ts`, `test/isolamento.test.ts`, `src/db/rls-guard.test.ts`, `src/modules/ajuda/conteudo.test.ts`

**Interfaces:**
```ts
// src/modules/documentos/modelos.ts
export const MSG_MODELOS: { … }; // linha "Itens salvos e modelos" da §6.2
export type GrupoDeItens = 'suplementos' | 'fitoterapicos'; // suplemento | planta_cha, derivado_vegetal, fitoterapico, formula_fitoterapica
export async function listarItensSalvos(ctx: TenantContext, grupo: GrupoDeItens, deps?: { db?: Db }): Promise<{ id: string; nome: string; tipo: string; item: ItemPrescricao }[]>;
export async function salvarItemSalvo(ctx: TenantContext, tenant: Pick<TenantRow, 'fitoterapiaRegistro'>, id: string | null, input: { nome: unknown; item: unknown }, deps?: { db?: Db }): Promise<string>;
export async function excluirItemSalvo(ctx: TenantContext, id: string, deps?: { db?: Db }): Promise<boolean>;
export async function listarModelosPrescricao(ctx: TenantContext, deps?: { db?: Db }): Promise<{ id: string; nome: string; itens: number }[]>;
export async function salvarModeloPrescricao(ctx: TenantContext, tenant: Pick<TenantRow, 'fitoterapiaRegistro'>, id: string | null, input: { nome: unknown; itens: unknown; orientacoes: unknown }, deps?: { db?: Db }): Promise<string>;
export async function excluirModeloPrescricao(ctx: TenantContext, id: string, deps?: { db?: Db }): Promise<boolean>;
export async function carregarModeloNaReceita(ctx: TenantContext, tenant: TenantRow, patientId: string, docId: string,
  input: { conteudo: unknown; justificativa: unknown; modeloId: string; modo: 'acrescentar' | 'substituir' }, deps?: { db?: Db }): Promise<ConteudoReceita>;
```
- `carregarModeloNaReceita` (RN-394, EP-D30): lê o modelo, junta com o `conteudo` **da tela** (acrescentar ou substituir; orientações do modelo só se as da tela estiverem vazias; mais de 20 → "Com este modelo a receita passaria de 20 itens. Use Substituir ou retire itens."), grava pelo **mesmo caminho** de `salvarRascunhoReceita` (todas as conferências, inclusive a habilitação; tudo ou nada; a justificativa digitada vai junto e fica) e devolve o conteúdo gravado; o cliente remonta o formulário por `key` com o retorno. Sem habilitação e com fitoterápico formulado no modelo → `semHabilitacao` e nada muda.
- Itens salvos: mesmo Zod do item (sem marca, fabricante ou farmácia); nome único sem diferença de maiúsculas ("Já existe um item salvo com este nome."); até 300; item que exige habilitação exige a do consultório. Modelos: nome único ("Já existe um modelo com este nome."), 1–20 itens, orientações ≤ 2000 com `orientacoesFormato`, **sem** justificativa; até 100. "Adicionar item salvo" copia no cliente, sem gravar; "Salvar item" e "Salvar como modelo" não salvam o rascunho. Excluir: "Excluir {nome}? As receitas já emitidas não mudam." → "Item excluído."/"Modelo excluído.". Listas vazias com os textos exatos da §6.2.

- [ ] **Step 1: Testes que falham:**
  - `banco-modelos.test.ts`: as duas tabelas `staff_only` (paciente, `publico` e `conta` não leem); CHECK de `tipo` e de `itens` (0 e 21 → 23514; objeto → 23514).
  - `modelos.test.ts`: o cenário "Carregar modelo" da US-379 — digitar um item sem salvar, carregar um modelo de 3 itens em "acrescentar" → o retorno tem os 4 e a justificativa digitada continua no banco; "substituir" troca os itens; 19 + 3 → mensagem dos 20 e nada muda; habilitação retirada depois de salvar o modelo → `semHabilitacao` e nada muda (R-377); orientações do modelo só com as da tela vazias; editar o item salvo depois não muda a receita; nome repetido → mensagem; 301º item e 101º modelo → recusa; sessão de paciente → erro do assert.
  - `actions.test.ts` (prescrição): sem `documentos_liberados` → `notFound`; `tipo` inválido → `suplementos`.
  - `navegacao.test.ts`: `/painel/prescricao/itens` marca "Configurações".
  - `isolamento.test.ts`, `rls-guard.test.ts`: verdes com as duas tabelas.
- [ ] **Step 2:** `pnpm vitest run src/modules/documentos/modelos.test.ts src/modules/documentos/banco-modelos.test.ts src/app/painel/prescricao src/app/painel/pacientes/[id]/documentos src/app/painel/navegacao.test.ts` → FAIL.
- [ ] **Step 3:** schema, `pnpm db:generate --name prescricao_modelos`, custom, `pnpm db:migrate`; módulo e telas.
- [ ] **Step 4:** mesmo comando + `pnpm vitest run test/isolamento.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/db/migrate.test.ts src/db/migrate-owner.test.ts src/modules/ajuda/conteudo.test.ts src/app/painel/rotas-axe.test.ts` → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 5:** commit `feat(documentos): itens salvos e modelos de prescrição (P22-10)`.

**Pronto quando:** testes verdes; `revisor-interface` (diálogos fora do formulário, foco, listas vazias) sem Critical/Important; procedimento do §5 feito para a migration da T10 antes de abrir o PR 4.

---

### Task 11: "Compartilhar" o PDF assinado (P22-11)

**Files:**
- Create: `src/components/portal/compartilhar-pdf.tsx` (`'use client'`, `MSG_COMPARTILHAR`)
- Modify: `src/app/p/(portal)/documentos/page.tsx` (o componente em cada documento `assinado` — nunca no `substituido` ou cancelado, que continuam com `MSG_PORTAL_DOC.substituido`/`.cancelado`), `src/modules/documentos/link-documento.ts` (`estadoDoLink` devolve `tipoDoc` no estado `aberto`), `src/app/documento/[token]/page.tsx` (o componente com a rota do link), `src/modules/ajuda/portal.ts` (guia `portal-novidades` +1 sobre a `main`: "compartilhar" o PDF, EP-D52) e `src/modules/ajuda/portal.test.ts`
- Test: `src/components/portal/compartilhar-pdf.test.ts`, `src/app/p/(portal)/documentos/page.test.ts`, `src/modules/documentos/link-documento.test.ts`, `src/modules/ajuda/portal.test.ts`, `e2e/portal.spec.ts` (caso novo: download)

**Interfaces:**
```ts
export const MSG_COMPARTILHAR: { preparar: 'Preparar para compartilhar'; preparando: 'Preparando o PDF…'; pronto: 'PDF pronto. Toque em Compartilhar.';
  compartilhar: 'Compartilhar'; porTipo: Record<TipoDocumento, string>; objeto: Record<TipoDocumento, string>; saude: 'O PDF tem dados da sua saúde. Envie só a quem você quiser que veja.';
  semSuporte: string; venceu: 'O acesso venceu. Digite o código de novo.'; falha: 'Não foi possível preparar o PDF. Tente de novo.' };
export function CompartilharPdf(p: { url: string /* /api/p/documentos/{id}/pdf ou a rota do link */; tipo: TipoDocumento; data: string /* dd/mm/aaaa */; nomeDoArquivo: string }): JSX.Element;
```
- RN-396: "Preparar para compartilhar" (nome acessível "Preparar para compartilhar {objeto} de {dd/mm/aaaa}", com `MSG_COMPARTILHAR.objeto`: "a receita", "o parecer nutricional", "a solicitação de exames laboratoriais" — ex.: "Preparar para compartilhar a receita de 12/11/2026") faz um `fetch` da rota de sempre (o `auditRead` de hoje, uma vez); confere `content-type` `application/pdf` (a do link responde 303 para a página quando a sessão de 15 min venceu → `venceu`); o botão fica `disabled` com `preparando` durante a busca; pronto → "Compartilhar" aparece, recebe o foco (`ref.focus()`) e a região `<p role="status">` (sempre montada) diz `pronto`; "Compartilhar" chama `navigator.share({ files: [pdf] })` quando `navigator.canShare({ files })`; senão baixa o arquivo (link com `URL.createObjectURL`) e mostra `semSuporte`; `AbortError` é ignorado; outro erro → `falha`. Texto por tipo: receita "Envie à farmácia que você escolher.", solicitação "Envie ao laboratório que você escolher.", parecer "Envie a quem você escolher."; nos três, `saude`. Alvos ≥ 44 px. Nada sai pela plataforma; nenhum registro novo.

- [ ] **Step 1: Testes que falham:**
  - `compartilhar-pdf.test.ts` (estrutura e a função de decisão extraída, pura): região de status presente antes do toque; nomes acessíveis por tipo; resposta 303/HTML → estado `venceu`; `AbortError` → sem mensagem de erro; sem `canShare` → caminho do download.
  - `page.test.ts` (portal): o componente só nos `assinado`; substituído e cancelado com os textos de hoje.
  - `link-documento.test.ts`: `estadoDoLink` aberto devolve `tipoDoc`.
  - `e2e/portal.spec.ts`: no Chromium sem compartilhar de arquivos, "Preparar para compartilhar" → "Compartilhar" → `page.waitForEvent('download')` com um PDF; a mensagem `semSuporte` aparece.
- [ ] **Step 2:** `pnpm vitest run src/components/portal src/app/p/(portal)/documentos src/modules/documentos/link-documento.test.ts src/modules/ajuda/portal.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `pnpm typecheck && pnpm lint`; com a CPU liberada: `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e e2e/portal.spec.ts e2e/documentos.spec.ts e2e/acessibilidade.spec.ts` → PASS.
- [ ] **Step 5:** commit `feat(portal): compartilhar o PDF assinado pelo aparelho (P22-11)`.

**Pronto quando:** testes verdes; `revisor-interface` (dois passos, foco, status, 44 px) sem Critical/Important.

---

### Task 12: Fechamento do PR 4 — E2E, acessibilidade, manuais, ajuda e runbook (P22-12)

**Files:**
- Modify: `e2e/solicitacao-exames.spec.ts` (CS-372: receita de 5 itens a partir de um modelo da semente em 1 clique + revisão, com as conferências), `e2e/acessibilidade-exames.spec.ts` (estados que não são rota: diálogos "Carregar modelo", "Salvar item", "Salvar como modelo", "Adicionar item salvo", "Compartilhar" pronto no portal; claro e escuro, 1280 e 360 px), `scripts/e2e-seed.ts` (consultório do E2E com habilitação em Fitoterapia, um modelo de solicitação, um modelo de prescrição de 5 itens e itens salvos — tudo com `ON CONFLICT DO NOTHING`, repetível)
- Modify: `docs/manual-tecnico/09-documentos-assinados.md` (tipo novo, filas "-2", `switch`, fórmula, marcação, itens salvos e modelos, compartilhar; **runbook da volta atrás** da R-375: não voltar abaixo do PR 4 depois da primeira solicitação ou fórmula; se inevitável, desligar `documentos_liberados` dos consultórios antes; depois, reprocessar no worker novo as exportações concluídas no intervalo ou segurar a fila `exportacao` até o worker novo subir), `docs/manual-tecnico/02-banco-de-dados.md` (as duas tabelas de prescrição; CHECKs de tipo), `docs/manual-tecnico/06-worker-seguranca-operacao.md` (as quatro filas), `docs/manual-tecnico/05-agenda-portal-conteudo.md` §5.8.1 (uma linha "Plano 22: guia X na vY" por guia que mudou nos PRs 2, 3 e 4), `docs/manual-tecnico/README.md` (glossário: "solicitação de exames", "fórmula magistral fitoterápica", "item salvo", "modelo de prescrição", "marcação mínima"; divergências spec × código, inclusive EP-D45 a EP-D58)
- Modify: `CLAUDE.md` — regra 8 (frase "Plano 22: a solicitação de exames herda os gatilhos e a anonimização dos documentos (`app_anonimizar_documentos`); `examesParaLancar` chama `auditRead` como `lerDocumento`"), regra 9 (frase "Plano 22: a solicitação usa `documento_base`, `documento_digitalizado` e `documento_assinado` como a receita; nenhum tipo novo em `stored_files`; o PDF da solicitação e da fórmula só no worker, pelas filas `documento-pdf-2`/`documento-digitalizado-2`")
- Modify: `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md` (só acrescentar: item "Termo do paciente 1.1 da onda 2" com o Anexo A da spec, a F-D17 do Plano 20 e as fotos do Plano 21, com dono e prazo e a pergunta EP-P2 (3); EP-P1 a EP-P5; gestação nas faixas depois do Plano 21 (R-379); os menores da §19; convergir os diálogos à mão do Plano 19 para o `Dialogo`), `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md` (situação de cada PR)
- Modify: manual do usuário (Docs) e Central de Ajuda — preparados pelo `guardiao-manual` para o dono aplicar (guias `exames-do-consultorio`, `prescricao`, `prontuario`, `configuracoes`, `documentos` e `portal-novidades`, com os `data-guia` de cada passo novo na tela)
- Test: os E2E acima e a suíte

- [ ] **Step 1: E2E que falham:** CS-372 em `e2e/solicitacao-exames.spec.ts`; o axe dos estados em `e2e/acessibilidade-exames.spec.ts`.
- [ ] **Step 2:** `pnpm e2e:seed && pnpm build && APP_URL=http://localhost:3102 pnpm test:e2e e2e/solicitacao-exames.spec.ts e2e/acessibilidade-exames.spec.ts` → FAIL (um E2E por vez entre as sessões).
- [ ] **Step 3:** ajustes que o E2E pedir; semente; manuais, ajuda e backlog pelo `guardiao-manual`; runbook.
- [ ] **Step 4:** `APP_URL=http://localhost:3102 pnpm test:e2e e2e/solicitacao-exames.spec.ts e2e/exames.spec.ts e2e/acessibilidade-exames.spec.ts e2e/acessibilidade-painel.spec.ts e2e/documentos.spec.ts e2e/parecer.spec.ts e2e/portal.spec.ts && pnpm test && pnpm lint && pnpm typecheck` → PASS. Rodar `pnpm e2e:seed` de novo e repetir os E2E (banco reaproveitado).
- [ ] **Step 5:** commit `test(e2e)+docs: fechamento do Plano 22 — exames e prescrição (P22-12)`.

**Pronto quando:** E2E e suíte verdes duas vezes seguidas no banco reaproveitado; manual técnico conferido pelo `guardiao-manual`; textos para o dono (Docs, Central de Ajuda, pacote do CRN-3 e do advogado: EP-P1, EP-P2) prontos.

---

## Depois das tarefas (fluxo do CLAUDE.md)

Para cada PR (1, 2, 3 e 4): revisão final do branch (workflow, com `revisor-rls` — política `paciente_exame_liberado`, `staff_only`, só de inclusão, gatilhos de autoria, travas, `recordAudit`/`auditRead`, filas "-2" —, `normas-cfn-lgpd` — categorias sem doença, nota honesta, declaração da solicitação, fórmula (art. 9º, II), sem farmácia nem laboratório, exportação —, `revisor-interface` — textos exatos, `Dialogo`, foco, regiões vivas, 360 px, portal — e `guardiao-manual` — manual técnico e ajuda) → uma onda de correções → `/code-review high` no PR **uma vez** → correções Critical/Important (Minor para o backlog) → re-revisão **só do diff das correções** → `/security-review` (RLS e isolamento; projeção do portal; marcação sem HTML; `iaTarefaId` só do servidor; compartilhar sem envio pela plataforma) → merge **só com o OK do dono** (merge = deploy; a migration do PR 1 e a do PR 4 rodam no boot; sem merge das 03h às 07h30 BRT; sem snapshot da Hostinger). Se sobrar Critical/Important confirmado depois da re-revisão, parar e avisar o dono.

Revisores por tarefa (PM-E15): `revisor-rls` (T1, T4, T6, T7, T10), `normas-cfn-lgpd` (T2, T3, T5, T8, T9, T12), `revisor-interface` (T3–T6, T8, T10, T11), `guardiao-manual` (T5, T6, T12). A sessão avisa a orquestradora a cada etapa (início, PR aberto, CI verde, revisão, pronto para merge) para o painel do backlog Paridade Dietbox.

## Coordenação

**Com a onda 1** (worktrees lidos em 17/11/2026):

| Sessão | O que se cruza | Como resolver |
|---|---|---|
| **Plano 18 PR 2** (`nutridebby-18`, `plano-18-pr2`, 3799409) | `noAppPor` (`secoes/comum.ts:26`) e `no-app.test.ts` só existem lá; RN-279; `ficha/tipos.ts` (`ChaveDeAcao`), `secoes/{exames,documentos}.ts`, `ficha/textos.ts`; `patient_cadastro` (`identidade_genero`); migrations próprias; `lgpd.ts`, `exportacao-job.ts`, `audit.ts`, `isolamento.test.ts`, `ajuda/conteudo.ts`, `e2e/painel-rotas.ts`, `CLAUDE.md` | A T6 (PR 3) só começa com ele na `main`; o PR 1 e o PR 4 não dependem dele. RN-279 v2 acrescentada ao **fim** da spec 18 (T6). `'criar-solicitacao'` no fim do union e a entrada no fim de `adicionar` (T8). A categoria lê `patients.sexo`, nunca `identidade_genero` (EP-D13). O cenário da solicitação em `no-app.test.ts` entra em quem chegar depois do 18 PR 2 (EP-D59) |
| **Plano 19** (`nutridebby-b`, `plano-19-plano-alimentar-2`) | `src/jobs/queues.ts` e `src/worker/index.ts` (`plano-pdf-2`, `FILA_DO_PDF_DO_PLANO`); `CARTOES` (+3) e o guia `configuracoes` (8 → 9); `STAFF_ONLY`, `FABRICAS`, `schema/index.ts`; diálogos à mão (`dialogo-busca.tsx`, `minhas-refeicoes.tsx`); o worktree e o banco da Sessão B; seed da USDA (Testcontainers mais lento) | O 22 só começa na Sessão B depois do fechamento do 19 (EP-D55). As constantes das filas "-2" do 22 em linhas próprias, no mesmo molde; o worker registra as duas famílias. Cartões no fim e guia +1 sobre a `main` (EP-D52). O 22 não edita os diálogos do 19 (backlog: convergir para o `Dialogo`). Medir `pnpm test` depois do seed |
| **Plano 20 PR 2** (`nutridebby-c`, `plano-20-financeiro`) | `navegacao.ts` (item "Financeiro" e `DO_HUB`), `lgpd.ts`, `exportacao-job.ts` (seção `financeiro`, comentário de `:326`), `audit.ts` (`ENTIDADE_ROTULO`), `e2e/acessibilidade-painel.spec.ts` (menu com 9 itens), DPA 1.1, termo 1.1 (F-D17) | O 22 não muda DPA, e-mail nem menu; em `DO_HUB` só acrescenta; na exportação só acrescenta chaves em `exames`/`documentos` e ajusta o comentário de `:326` junto com o do 20 no rebase; termo pela EP-D36 |

**Com a onda 2:**

| Sessão | O que se cruza | Como resolver |
|---|---|---|
| **Plano 21** (`nutridebby-21`, `plano-21-avaliacao-fisica`) | Bloco de numeração 330–369; `stored_files_tipo_valido` e `armazenamento.ts`; `exportacao-job.ts` e `lgpd.ts` (RN-352, RN-353 do 21); `audit.ts` (`antropometria_arquivos`, `antropometria_versoes`); `isolamento.test.ts`, `rls-guard.ts`; termo 1.1 (fotos); `anthropometry_versoes` é o molde da `exam_versoes` | Bloco 370 (EP-D39). O 22 não toca IA, `ia_tarefas`, `leitura-job.ts` nem `stored_files`; a PD-44 está no 21B. Nos arquivos comuns, só linhas novas. Se o 21 também criar um diálogo comum, quem entra depois usa o `Dialogo` do PR 1 do 22 (ou o contrário) — avisar a orquestradora antes de criar um segundo |
| **Plano 23** (`nutridebby-23`, `plano-23-agenda-2`) | `CARTOES` ("Locais de atendimento") e o guia `configuracoes`; `secoes/index.ts` (seção "Consultas"); `isolamento.test.ts`, `rls-guard.ts`, `ajuda/conteudo.ts`, `e2e/painel-rotas.ts`; o 23 **não** mexe em `queues.ts`/`worker/index.ts` (C-403) | Cartões no fim; guia `configuracoes` +1 sobre a `main` em cada PR que entrar depois; nenhuma posição fixa. O 22 não mexe em `secoes/index.ts` |

**Arquivos disputados (§6):** os da "Global Constraints", só com acréscimos; nos conflitos de rebase, manter as duas contribuições.

**Migrations (§5):** duas migrations com número — a do PR 1 (`exames` + `rls_exames`) e a do PR 4 (`prescricao_modelos` + `rls_prescricao_modelos`) —, nenhuma reservada, cada uma **gerada de novo** sobre a `main` antes do PR e de novo se outra entrar antes; uma migration na fila de merge por vez em todo o repositório.

**Ordem de merge proposta para a orquestradora:** onda 1 conforme a decisão de 16/11 (17 → 18 PR 1 → 20 PR 1 → 19 código → 18 PR 2 → 20 PR 2 → 20 PR 3 → 19 seed); na onda 2, os PR 1 (fundações) de 21, 22 e 23 um por vez na fila de migrations; depois, 22 PR 2 (sem migration) a qualquer momento depois do 22 PR 1; 22 PR 3 depois do 18 PR 2 e do 22 PR 2; 22 PR 4 (com migration) na fila de migrations depois do 22 PR 2. Pedidos à orquestradora: (1) confirmar o bloco 370 e o IP `10.9.22`; (2) criar o item "Termo do paciente 1.1 da onda 2" com dono e prazo (Anexo A da spec, EP-D36); (3) autorizar o fim da sessão do 19 e a remoção do worktree de spec `nutridebby-22` antes do preparo (EP-D55).

## Revisão do plano

Ainda não revisado. A revisão (executabilidade, `revisor-rls` e conflitos com as sessões paralelas, como a do Plano 20) registra aqui os achados aplicados e os descartados, e leva à spec os ajustes técnicos.

## Decisões

**Da spec, usadas por este plano** (texto e porquê completos na spec §14; aqui, onde cada uma vira código):

| ID | Decisão | Onde no plano |
|---|---|---|
| EP-D1 | Solicitação = tipo novo de documento assinado, mesmo nível da receita | T7, T8 |
| EP-D2 | Título fixo, sem campo de laboratório | T7 (`CorpoSolicitacao`), T8 |
| EP-D3 | Indicação clínica e orientações opcionais, com a linha fixa | T2 (Zod), T8 |
| EP-D4 | Aviso dos planos de saúde na tela, não no PDF | T8 |
| EP-D5, EP-D6, EP-D7 | Modelos de solicitação por cópia; exame livre; até 40; "Lançar resultados" sem FK | T3, T8 |
| EP-D8, EP-D9, EP-D10 | Catálogo `staff_only` só com nomes para começar; painel de um nível; linha livre continua | T1, T2, T3 |
| EP-D11 a EP-D17 | Classificação neutra e categoria calculadas na leitura; categorias fechadas; sexo do cadastro e idade na data; casamento único; `refMin`/`refMax` opcionais; sugestão só por botão; REF | T2, T4, T5 |
| EP-D18, EP-D19 | Nota de interpretação da nutricionista, na cópia do titular | T1, T5 |
| EP-D20 | Comparativo na aba Exames | T5 |
| EP-D21, EP-D41 | Edição com concorrência otimista e versão; nota só de inclusão | T1, T4, T5 |
| EP-D22, EP-D23 | "Mostrar no app" por exame, política RESTRICTIVE; menu do app com três termos | T1, T6 |
| EP-D24, EP-D25, EP-D43 | Sem farmácia; compartilhar em dois passos; a entrega de hoje é o "compartilhar com o paciente" | T11 |
| EP-D26 a EP-D28 | Fórmula fitoterápica com habilitação; conferência de apoio; suplemento manipulado intacto | T2, T9 |
| EP-D29, EP-D30 | Itens salvos e modelos de prescrição; "Carregar" pelo caminho do salvar | T10 |
| EP-D31 | Marcação mínima, nunca HTML | T2, T9 |
| EP-D32, EP-D44 | Sem título livre nem data editável; troca de laudo fora | T4, T8 |
| EP-D33 | Dois cartões no fim; nenhum item de menu nem aba | T3, T10 |
| EP-D34 | Infraestrutura antes do editor; filas "-2" | T7 |
| EP-D35 | O que depende de `documentos_liberados` | T3, T8, T10 |
| EP-D36 | Termo 1.1 só na versão única da onda 2 | T12 (backlog), Coordenação |
| EP-D37, EP-D40 | Sem IA nova; sem lembrete da posologia | T5 (guardas) |
| EP-D38, EP-D39 | Quatro PRs, 12 tarefas, linha de corte; bloco 370 | Ordem de entrega |
| EP-D42 | `Dialogo` novo na fundação | T2 |

**Novas deste plano** (o dono autorizou seguir as recomendações; cada uma com o porquê):

| ID | Decisão | Porquê |
|---|---|---|
| EP-D45 | No Histórico de acessos, "Liberou exame no app" e "Retirou exame do app" saem na coluna **Ação** (`rotuloDaAcao`), com `ENTIDADE_ROTULO` = "Exames" para `exame_no_app_liberado` e `exame_no_app_retirado` — a spec §9.8 punha os dois textos em `ENTIDADE_ROTULO` | A tabela tem duas colunas (`historico-acessos.tsx:37-38`: ação e entidade); com o rótulo na entidade, a linha ficaria "Alterou · Liberou exame no app". É o padrão de "Perguntou à IA" (Plano 15) e de "Ligou"/"Desligou" (peso no app, Plano 16) |
| EP-D46 | A idade na data do exame usa `idadeEm(nascimento, em)` de `src/modules/pacientes/datas.ts`, em vez de uma `idadeNaData` nova | A função já existe, é pura (sem import) e trata o 29/02; duas regras de idade divergiriam |
| EP-D47 | As regras que rodam no cliente ficam em arquivos puros: `catalogo-regras.ts` (Zod, sobreposição, `expandirParaAnalise`) e `solicitacao.ts` (Zod, mensagens, declaração); o que lê o banco fica em `catalogo.ts` e em `lancar-resultados.ts` (`examesParaLancar`) | O formulário valida no cliente como `prescricao.ts`; um import do servidor no mesmo arquivo levaria `pg` ao bundle. Guarda de grafo na T2 |
| EP-D48 | `formula_fitoterapica` só entra em `TIPOS_ITEM` e na união do Zod na T9 (PR 4); a T2 entrega só as funções puras (`exigeHabilitacao`, binômio, termos barrados) | O PR 1 não pode mostrar no editor um tipo sem tela, e o worker antigo não desenha o item (R-375); a linha de corte (22B) não deixa nada visível pela metade |
| EP-D49 | `'solicitacao_exames'` entra nos CHECKs no PR 1 (expansão), mas só ganha rótulo, união de tipos e telas no PR 4 (T7) | Migration só aditiva no PR de fundação, sem nenhum caminho do app que grave o tipo antes das filas "-2" |
| EP-D50 | "Lançar resultados" é um link para `/painel/pacientes/[id]/exames?solicitacao=<docId>#novo-exame`: a página lê `examesParaLancar` (com `auditRead`) e preenche o `ExameForm`; a criação continua no `POST /api/painel/pacientes/[id]/exames` (o laudo é multipart); a edição é a Server Action `editarExameAction` (sem arquivo, EP-D44) | Reaproveita o formulário e a rota que o E2E da conferência já usa; nenhuma rota nova de criação; o laudo entra na criação, como a spec quer |
| EP-D51 | `/painel/exames` (T3) e `/painel/prescricao` (T10) entram no **fim** de `DO_HUB` (`src/app/painel/navegacao.ts`) | As telas do hub marcam "Configurações" no menu, como Alimentos e Modelos; sem item novo (EP-D33); `/painel/exames-recebidos` não é afetado (`dentro()` exige `/` depois da base) |
| EP-D52 | Cada PR que muda uma tela sobe o guia dela **+1 sobre a versão da `main`**: `configuracoes` no PR 2 (cartão "Exames") e no PR 4 (cartão "Prescrição"); `prontuario` no PR 2; `documentos` no PR 4 (2 → 3 hoje); `portal-novidades` no PR 3 (Exames) e no PR 4 (Compartilhar) — a spec previa um bump só por guia | Cada PR é um deploy; um guia que cita função ainda não publicada mentiria; a ordem entre o PR 3 e o PR 4 não é fixa (o PR 3 espera o 18 PR 2) |
| EP-D53 | O nome do autor em "Versões anteriores" (exame e nota) vem de `nomesDosAtores`, extraída de `listAccessHistory` em `src/modules/plataforma/audit.ts`, com frase nova na regra 1 do `CLAUDE.md` | `audit.ts` já está na lista de quem lê a tabela `user`; um leitor novo da `user` em `exames.ts` abriria outra exceção de RLS |
| EP-D54 | O axe do `Dialogo` e dos estados que não são rota fica em `e2e/acessibilidade-exames.spec.ts`, criada na T3 (primeira tela que usa o diálogo); a T2 testa só a estrutura (`renderToStaticMarkup`) | O Vitest roda em `environment: 'node'`, sem DOM nem jsdom (acrescentar exige OK do dono); a T2 não tem página |
| EP-D55 | O Plano 22 roda na **Sessão B** (`../nutridebby-b`, porta 3102, banco `nutri_dev_b`) só depois do fechamento da sessão do Plano 19; o worktree de spec `../nutridebby-22` sai antes do preparo (com OK do dono); o banco `nutri_dev_b` é recriado | `sessoes-paralelas.md` §1 e §3 (uma sessão = um worktree + um branch; o script só conhece `a`, `b`, `c`); o git não deixa o mesmo branch em dois worktrees; o banco do 19 tem migrations que o 22 não tem |
| EP-D56 | A declaração gravada e mostrada no preparo vem de `declaracaoDoDocumento(conteudo)`: a da receita ganha a frase da fórmula **só** quando há `formula_fitoterapica`; os outros tipos seguem `DECLARACAO_POR_TIPO` | RN-392 (a frase entra só nesse caso); a tela tem de mostrar exatamente o texto que o preparo grava na cópia |
| EP-D57 | Em `documentos.ts`, as guardas de editor `:75` (`d.tipo !== 'receita'` em `salvarRascunhoReceita`) e `:96` (`d.tipo !== 'parecer'` em `salvarRascunhoParecer`) ficam; só `:37` (`conteudoVazio`) e `:141` (preparo) viram `switch` | Essas duas recusam qualquer outro tipo, inclusive o novo — é o comportamento certo; o risco da DEP-E7 é o ramo que trata "tudo o que não é parecer" como receita |
| EP-D58 | Bloco de IP dos E2E novos: `10.9.22` (proposta) | A decisão da orquestradora de 16/11 dá a cada plano a própria faixa pelo número; `10.9.22` não está em uso em `e2e/` (conferido em 17/11/2026); a orquestradora fixa |
| EP-D59 | O cenário da solicitação em `no-app.test.ts` entra em quem chegar à `main` depois do Plano 18 PR 2: na T8 (PR 4) se o 18 PR 2 já estiver lá; senão na T6 (PR 3), que sempre vem depois dele | `no-app.test.ts` só existe no 18 PR 2; o PR 4 não pode depender dele (R-385), e a paridade da RNF-263 b tem de cobrir o tipo novo |
