# Plano 13 — Parecer nutricional (F3-05), retificação e LGPD do parecer: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Escrito em 08/10/2026** a partir da `main` @ `3b59c38` (Planos 01–12 em produção, migrations `0000`–`0103`) + `22aea8d` (spec de documentos assinados **v0.5**, só a parte do Plano 13), no worktree `nutridebby-plano13`, branch `plano-13-parecer`, pedido e aprovado pelo dono em 08/10/2026 ("siga" para o Plano 13; **D2 = (a)**: o parecer tem o mesmo nível de assinatura da receita enquanto o CRN-3 não responder, revisável para (b)). Relatório da preparação (fora do git): `.superpowers/sdd/2026-10-08-plano13-preparacao/spec.md`. Nenhuma linha de código de produto foi escrita; nada foi rodado em banco; nenhum banco de produção foi tocado. Os nomes de função, tabela, gatilho, rota e helper usados aqui foram conferidos no código da `main` (os que este plano cria estão em "Contratos entre tarefas"). **Correção de numeração:** a tarefa pedia migrations "a partir da 0103", mas a `0103_sessao_equipe_30min` já existe (Plano 12, P12-14): este plano usa **`0104`** (gerada) e **`0105`** (custom), como a spec v0.5 já registra. As perguntas Q13-1 a Q13-5 da spec ainda são do dono: o plano aplica as **recomendações** da spec (marcadas ★ em "Decisões do plano") e diz o que muda se o dono decidir diferente. Próximo passo: revisão do plano pelo dono (Q13-1 a Q13-6, seção "Decisões do dono") e execução. **Revisto em 08/10/2026** pela revisão do plano (lentes banco, normas e execução): as correções estão aplicadas nas tarefas e listadas em "Correções da revisão do plano (08/10/2026)", no fim.

**Goal:** A nutricionista redige, prepara, assina (digitalizada, como a receita — D2 = (a)) e entrega o **parecer nutricional** sobre os exames lançados, com a cópia dos valores congelada no preparo e o aviso quando o exame muda depois; qualquer documento assinado (receita ou parecer) pode ser **retificado** por uma versão nova, com motivo, que substitui a anterior na assinatura; o portal, o link de uso único, a verificação pública e as rotinas da LGPD passam a conhecer o parecer e as versões; e o `/admin` ganha paginação e busca (P09-07).

**Architecture:** Nenhuma tabela nova. Duas migrations: `0104_parecer` (gerada: `tipo` `'parecer'` em `signed_documents` e `document_verifications`, coluna `signed_document_notes.motivo_retificacao`) e `0105_parecer_regras` (custom: gatilho **novo** `app_documento_versao` no INSERT da versão nova; `app_documento_imutavel` refeita — substituir só com a retificação assinada, cancelar só sem retificação em andamento, retificação só vai ao preparo com motivo; `app_notas_imutaveis` e `app_anonimizar_documentos` refeitas para o motivo). No código, o parecer reaproveita toda a base do Plano 10A: o mesmo `signed_documents` com `tipo = 'parecer'`, o mesmo preparo, o mesmo PDF no worker (`documento-pdf.tsx`, com o corpo do parecer), a mesma digitalizada com 2FA e a mesma entrega; o conteúdo do parecer (`ConteudoParecer`) guarda a **cópia** dos exames (`conteudo.exames`), refeita a cada salvamento do rascunho e uma última vez no preparo (RN-148, RN-154). A retificação (`retificacao.ts`) cria a versão `n + 1` com `retifica_id`, travando a original antes; a assinatura da versão nova (`registrarAssinatura`, na transação do PDF final) leva a original a `substituido` e a verificação dela a "substituído"; a ordem de travas é paciente → original → versão nova → tenant (`travarDocumentoAntesDaCota`). O `/admin` pagina por cursor (id do consultório, ordem `created_at desc, id desc`) com busca por `position()` (sem curinga de `LIKE`).

**Tech Stack:** Node 24 · pnpm · Next.js 16 (App Router, Server Actions, `PageProps`) · React 19.2 · PostgreSQL 16 · Drizzle (drizzle-kit `generate` e `--custom`) · pg-boss · Zod 4 · `@react-pdf/renderer` e `qrcode` (já instalados, só no worker) · Vitest + Testcontainers · Playwright + `@axe-core/playwright`. **Nenhuma dependência nova.**

**Spec:** [`../specs/2026-10-03-nutridebby-documentos-assinados-design.md`](../specs/2026-10-03-nutridebby-documentos-assinados-design.md) **v0.5, só a parte do Plano 13**: §2.3 (coluna "Plano 13"), §3.1 (com a nota v0.5), §3.4 (D2 = (a)), §5, US-141, US-146 (nota v0.5), US-147 (nota v0.5), US-148, US-149 (só "Cancelar com retificação em andamento" e a nota v0.5), US-150 (nota v0.5), RN-140, RN-141, RN-146, RN-147, RN-148, RN-154, §10 (notas v0.5), "Decisão do dono de 08/10/2026 (D2, Plano 13)" e a seção "Plano 13 — preparação (v0.5)" inteira (dependências, pontos fixos em "receita", desvios 1–11, migrations, regras do CLAUDE.md, SBIS NGS1, Q13-1 a Q13-5 e o item à parte **P09-07**). Base do MVP: [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (US-015, US-018, US-046, RN-08, RNF-10). Plano anterior da base: [`2026-10-05-nutridebby-10a-receita.md`](2026-10-05-nutridebby-10a-receita.md). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P13-00, P09-07). Manual técnico: [`../../manual-tecnico/09-documentos-assinados.md`](../../manual-tecnico/09-documentos-assinados.md).

## Global Constraints

- Tudo dos Planos 01–12 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel); `requireNutri` na **primeira** linha de toda página e Server Action da nutricionista (guarda `src/app/painel/acoes-de-paciente.test.ts`); ids de rota conferidos com `idValido` (id inválido = 404, nunca 500); todo `<form>` com `action={…}`, `method="post"` ou `method="get"` declarado em `GET_PERMITIDOS` (guarda `src/app/formularios-post.test.ts`). **Next.js 16 não é o Next do treino** (`AGENTS.md`): antes de escrever página, Server Action ou `searchParams`, ler o guia em `node_modules/next/dist/docs/01-app/`.
- **Base:** `main` em `3b59c38` + a spec v0.5 (`22aea8d`). Migrations: **`0104_parecer`** (gerada, T1) e **`0105_parecer_regras`** (custom, T1). Se o Plano 10B (ou outro) entrar na `main` com migration antes, renumerar no rebase e corrigir as referências. Migrations só com `DATABASE_URL_MIGRATOR` (regra 7); nunca no banco de dev compartilhado sem combinar; nunca em produção fora do deploy. **Nenhum `DISABLE TRIGGER`** e nenhuma migração de dados (SBIS NGS1.07.01).
- **Regra 1:** toda leitura de `exams`, `exam_submissions` e `signed_documents` dentro de `withTenant` (painel = `nutri` com `actorUserId` e `ip`; PDF e digitalizada = `worker`; portal = `paciente`); `document_verifications` continua **só** em `src/modules/documentos/verificacao.ts`; o `/admin` (P09-07) continua só com `tenants`, `user`, `account` e `invites` (guarda `src/app/admin/sem-tabelas-tenant.test.ts`). **Nenhum arquivo novo** entra nas listas da regra 1.
- **Regra 2:** nenhuma tabela nova com `tenant_id` — nada novo em `FABRICAS`, `STAFF_ONLY`, `PACIENTE_ESCREVE`, `PUBLICO_LIBERADO` ou `CONTEUDO_POR_AUDIENCIA`. A coluna nova `motivo_retificacao` fica em `signed_document_notes`, que já é `STAFF_ONLY`, com RLS e auditoria (0090).
- **Regra 3 / RNF-142:** nada de exame, valor, avaliação, conduta, encaminhamento, motivo de retificação ou nome de paciente em log, Sentry, fila, push ou e-mail. Os jobs continuam só com ids. O e-mail e o push da versão nova são os neutros do 10A (`documento_novo`); **nenhum** e-mail novo (Q13-3 ★).
- **Regra 8 (auditoria):** as escritas já são auditadas (gatilho `audit_row_change`, entidade `documentos`, 0090). `auditRead` continua na leitura do conteúdo no painel (`lerDocumento`) e nas rotas que devolvem o PDF (painel, portal, link); a seleção de exames do editor lê por `listarExames` (`auditRead` entidade `exames`, sem exceção nova). As listas (prontuário e portal) continuam **sem** `auditRead` e só com tipo, título, data, situação, assinatura, recibos e **versão** (testes das chaves em `documentos.test.ts` e `portal.test.ts`). `situacaoDosExames` (T3) não chama `auditRead`: devolve só "igual"/"mudou"/"excluído", nunca valores (decisão D-P2).
- **Regra 9 (arquivos):** o PDF do parecer só no worker (`documento-pdf.tsx`/`documento-pdf-job.ts`, guarda de grafo em `src/modules/pacientes/exportacao.test.ts`); arquivos só por `salvarArquivo`/`apagarArquivo` com a ordem de travas documento → tenant (`travarDocumentoAntesDaCota`) — **numa retificação, original → versão nova → tenant** (T7); o laudo do exame (`exams.arquivo_path`) **nunca** é copiado para o parecer.
- **SBIS NGS1 (spec v0.5, seção "Plano 13 — preparação"):** NGS1.12.01 — correção de registro finalizado só por nova versão, pelo autor (B-01), **com justificativa** (Q13-1 ★, motivo obrigatório também no banco, T1); NGS1.12.02 — a versão nova nasce do conteúdo da vigente (T7); NGS1.12.03 — inativar com justificativa, emitido nunca apagado (10A, mantido); NGS1.07.01 — nenhuma migration desliga auditoria; NGS1.07.03 — trilha de criação, consulta e alteração (gatilho + `auditRead`); NGS1.07.06 — `audit_log` sem conteúdo; NGS1.01.01 — versão identificada no PDF, no portal e na exportação (`versao`, `retificaCodigo`).
- Textos de interface em pt-BR, **com o texto exato da spec v0.5** quando existir (US-141, US-146, US-147, US-148, US-149, D5); os textos novos e os "(proposto)" da spec estão em "Desvios conscientes" e vão à revisão de interface e à Debby (como o P08-08: rascunho até a aprovação). A declaração e a ressalva do parecer (D5) são **rascunho** até a revisão da Debby e a consulta ao CRN-3 (P-B1).
- Visual V2 (Plano 08): só os tokens do tema (`bg-cartao`, `text-suave`, `border-borda`, `text-link`, `text-erro`…), nunca cor fixa em `src/app/painel` e `src/modules/*/ui` (guarda `src/app/painel/cores.test.ts`); componentes `Botao`/`BotaoLink`, `Aviso`, `Selo`, `Cartao`; acessibilidade (RNF-10, RNF-144): `<label htmlFor>`, `aria-invalid` + `aria-describedby`, erros com `role="alert"`, sucesso com `role="status"`, alvo de toque ≥ 44 px (`min-h-11`). Nenhuma página nova do painel (o parecer usa as rotas do 10A, já em `ROTAS_DO_PAINEL`).
- **Imagem Docker:** orçamento de **265 MB** comprimidos (job `image` do CI, D-R2 do Plano 12); hoje em **260 MB**. **Nenhuma biblioteca nova** neste plano; se alguma tarefa achar que precisa de uma, para e pergunta ao dono com a medida da imagem e a poda proposta.
- Custo: nenhum serviço novo (D1 da spec: R$ 0). O parecer segue o interruptor do admin `tenants.documentos_liberados` (D20 do 10A) — **nenhum interruptor novo**.
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel, serviços, firewall ou banco de produção; nunca exibir segredos. Merge = deploy, só com OK explícito do dono e snapshot no hPanel antes. Subagentes nunca consultam o banco de produção. Lembrar o dono, a cada sessão, do **backup no host (P02-11)**, ainda pendente.
- Política de revisão por entrega (índice, revista em 02/10/2026; modo misto): revisor por tarefa (cada tarefa diz **Revisão: completa (agente …)** ou **Revisão: leve (revisor-interface)**) → revisão final do branch (workflow) com uma onda de correções → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor vai para o backlog) → re-revisão só do diff das correções → `/security-review` (checklist: versões e retificação no banco, ordem de travas, cópia dos exames só do próprio paciente, verificação pública sem dado de saúde, exportação e anonimização das versões, busca do admin). Se sobrar Critical/Important confirmado, parar e avisar o dono.

**Revisão completa** = o agente especialista indicado (`.claude/agents/revisor-rls.md` para banco, RLS, auditoria, gatilhos, arquivos, worker e rotas; `.claude/agents/normas-cfn-lgpd.md` para textos normativos, assinatura, prontuário, LGPD, exportação e anonimização) com as lentes de segurança/LGPD e de spec, três verificadores adversariais por achado, até duas rodadas de correção. **Revisão leve** = `revisor-interface` (visual V2, textos, acessibilidade, manual guiado), uma rodada. O fechamento (T12) passa também pelo `guardiao-manual`.

### Decisões do plano

As marcadas com ★ **ainda são do dono** (perguntas Q13 da spec v0.5): o plano aplica a recomendação da spec e diz o que muda se a resposta for outra. As outras são técnicas, tomadas aqui com base na spec v0.5 e no código.

| # | Tema | Decisão (aplicada no plano) | Se o dono decidir diferente |
|---|---|---|---|
| D2 | Nível de assinatura do parecer | **(a)** — decidida pelo dono em 08/10/2026: digitalizada com 2FA em todo envio (10A), gov.br/ICP pelo 10B; **sem** `assinatura_tipo = 'plataforma'` nem a variante `preparando → assinado` | Revisão para (b) com a resposta do CRN-3 = plano próprio (backlog "Pontos menores" da spec) |
| Q13-1 ★ | Motivo da retificação | **(a)**: "Motivo da retificação" obrigatório (1–500) para **preparar** a versão nova; guardado em `signed_document_notes.motivo_retificacao` (só a equipe, como o motivo de cancelamento); na exportação da **equipe**, fora da do **titular** — **confirmar com o advogado (E-09), junto com o motivo de cancelamento da D15** (runbook, passo 5; `go-live.md`, P-B3/E-09, T12); exigido também no banco (gatilho, T1: a versão nova só nasce em rascunho e só vai ao preparo com o motivo) | Se o advogado disser que o titular tem acesso: tirar a condição `escopo === 'equipe'` da T6 (uma linha) e o `not.toHaveProperty` do teste. (b): T1 sem a coluna e sem a regra no gatilho; T6, T7 e T9 sem o campo; NGS1.12.01 fica parcial (registrar na spec) |
| Q13-2 ★ | Origem dos valores (IA conferida, enviado pelo paciente) | **(a)**: só na cópia guardada (`iaTarefaId` por linha, `enviadoPeloPaciente` por exame) e na exportação (`lidoComIa`, `enviadoPeloPaciente`); **nunca** no PDF. **Atenção (revisão do plano):** com a (a), valores lidos pela IA do Plano 11 chegam ao paciente no PDF sem indicação de IA — isso quebra a premissa da §5.10 da spec da IA ("A leitura de laudo não gera material entregue ao paciente") e difere do selo escolhido para o plano alimentar (A-D13). A pergunta do art. 37 da Res. CFN 856/2026 vai ao CRN-3 (runbook, passo 5; P-B1, T12), com resposta antes de 23/01/2027 (vigência prorrogada, ato a conferir no DOU, P-B11); risco R10 | (b): a T4 acrescenta a nota por linha no PDF (texto a definir com a Debby) — também o caminho se o CRN-3 responder que o art. 37 se aplica |
| Q13-3 ★ | E-mails na substituição | **(a)**: só o "Você tem um novo documento" da versão nova (o da entrega do 10A); nenhum `documento_atualizado` | (b): a T7 enfileira também o `documento_atualizado` da original, na mesma transação. **Para pesar na resposta (D11, "avisar o paciente… na substituição"):** com a (a), o e-mail não diz que a versão anterior deixou de valer; o paciente só sabe pelo portal ("Substituído por uma versão mais nova.") e pela verificação pública — pesa mais na receita (quem levou a versão 1 impressa à farmácia) |
| Q13-4 ★ | Coluna `exam_ids` | **(a) não**: os ids ficam na cópia (`conteudo.exames[].id`) | (b): coluna `uuid[]` na 0104, limpa na `app_anonimizar_documentos` e na lista `mudou <@ …` do gatilho (0105) |
| Q13-5 ★ | Versão visível ao paciente | **(a)**: "Versão 2" no portal e no link; "Versão {n} — substitui o documento {código}" no PDF e no painel | (b): a T5 tira a versão do portal e do link (o PDF continua com ela, NGS1.01.01) |
| D-P1 | Ordem de travas da retificação | paciente → **original** → versão nova → tenant: `retificarDocumento` trava a original; `travarDocumentoAntesDaCota` trava a original **antes** da versão nova (todo `salvarArquivo` de uma retificação); `cancelarDocumento` trava paciente → documento (já era) | — |
| D-P2 | `situacaoDosExames` sem `auditRead` | Devolve só `igual`/`mudou`/`excluido` por id da cópia (nenhum valor sai); a página do documento já audita `documentos` | Se a revisão de normas pedir, `auditRead(tx, { entidade: 'exames', entidadeId: null, patientId })` na mesma transação (uma linha) |
| D-P3 | Regras novas no banco, além das da spec | Além das duas da spec (INSERT da versão nova; substituir só com retificação assinada): **cancelar** recusado com retificação em andamento (RN-147 no banco) e **preparar** uma retificação só com o motivo na nota (Q13-1); a versão nova (com `retifica_id`) só é **inserida em rascunho** — sem isso, um INSERT direto já "preparando"/"assinado" pularia o motivo e deixaria duas versões "assinado" em vigor (revisão do plano); o INSERT trava a original com `FOR SHARE` (fecha a corrida com um cancelamento por outro caminho) | — |
| D-P4 | Rascunho do parecer incompleto | Como a receita (0 itens no rascunho): o rascunho aceita 0 exames e avaliação vazia; "Selecione ao menos um exame." e "Escreva a avaliação nutricional (até 5000 caracteres)." saem no **preparo**; os máximos (20 exames, 5000/5000/1000 caracteres) valem também no salvar | — |
| D-P5 | Métricas do `/admin` (P09-07) | **Filtro do mapa já pronto**: as quatro funções `admin_metricas_*` continuam sem parâmetro (sem migration); a página só desenha as linhas da página. O problema medido era o HTML (1,8 MB) e o desenho de ~220 linhas | Se a medida da T11 no dev passar de 1 s só nas funções, parâmetro de ids numa migration própria (backlog) |
| D-P6 | Paginação do `/admin` | Cursor = id do consultório (`?depois=<id>` / `?antes=<id>`), comparação `(created_at, id)` com a linha do cursor no banco (sem perder os microssegundos do `created_at` no JavaScript), 50 por página; busca por `position(lower(busca) in lower(nome · slug · e-mail))` — `%` e `_` são literais | — |
| D-P7 | Ordem e paralelismo | **[T1 ‖ T2] → T3 → [T4 ‖ T6 ‖ T8] → T5 (depois da T4) → T7 (depois da T4 e da T5) → T9 (depois da T7 e da T8) → T10 → T11 → T12**; a T11 (P09-07) não depende de nada e pode correr num worktree próprio desde o início, mas entra no branch **por último** antes do fechamento | — |
| D-P8 | Janela do expand/contract no deploy (manual técnico, cap. 01/06) | O `nutri_worker` novo pode subir antes de a 0104 terminar: a leitura de `signed_document_notes` (`select()` sem colunas em `lerDocumentoNaTransacao`, `documentos.ts:203`, e `motivoRetificacao` na exportação, T6) dá `42703` até a migration acabar. **Aceita**: a 0104 é curta (uma coluna anulável e três CHECKs), os jobs da exportação e do PDF têm retry do pg-boss e o interruptor `documentos_liberados` decide quem usa; nenhuma migration muda (risco R11) | Se o dono preferir zero erro: a leitura da nota com colunas explícitas até o deploy seguinte (backlog) |

### Decisões do dono

Só o dono decide estas; o plano segue a recomendação (★) até a resposta. A interpretação de norma é do CRN-3 (P-B1) e a de direito de acesso, do advogado (P-B3/E-09) — o dono decide depois de ouvi-los.

- ★ **Q13-1** — motivo da retificação obrigatório (a) e fora da exportação do titular; a exclusão do titular vai ao advogado (E-09) junto com o motivo de cancelamento da D15.
- ★ **Q13-2** — origem dos valores só na cópia e na exportação (a), nunca no PDF; ou nota por linha no PDF (b). A (a) depende da resposta do CRN-3 sobre o art. 37 da Res. CFN 856/2026 (valores lidos por IA e conferidos pela nutricionista no parecer entregue ao paciente), antes de 23/01/2027.
- ★ **Q13-3** — um e-mail só, o da versão nova (a), sabendo que ele não diz que a anterior foi substituída; ou também o `documento_atualizado` da original (b).
- ★ **Q13-4** — sem coluna `exam_ids` (a) ou com ela (b).
- ★ **Q13-5** — "Versão {n}" visível ao paciente no portal e no link (a) ou só no PDF (b).
- ★ **Q13-6 (nova, revisão do plano)** — o parecer **não tem interruptor próprio**: aparece em todo consultório que já estiver com `documentos_liberados` ligado no dia do merge. O plano só deixa a dependência explícita (runbook, passo 2: conferir no `/admin` antes do merge; risco R9). Decidir se basta essa conferência (recomendação: sim, enquanto houver um consultório só) ou se o parecer ganha um interruptor próprio (plano à parte: coluna em `tenants`, migration e tela do `/admin`).

### Desvios conscientes da spec v0.5

1. **Rascunho do parecer aceita 0 exames e avaliação vazia** (D-P4); o preparo exige — como a receita (US-142 v0.4: 0 itens no rascunho).
2. **"Uma retificação por vez" pela trava, não pelo 23505:** `retificarDocumento` trava a original (`FOR UPDATE`) antes de procurar a retificação aberta, então dois cliques simultâneos se enfileiram e o segundo abre a mesma versão nova; o índice `signed_documents_retificacao_aberta` continua como barreira do banco (o teste da T1 o exercita). A spec v0.5 previa o segundo clique batendo no 23505.
3. **Regras a mais no banco** (D-P3): cancelar com retificação em andamento e preparar retificação sem motivo também são recusados pelo gatilho, não só pelo módulo.
4. **Os avisos de exame** ("Os valores deste exame mudaram depois do parecer.", "O exame … foi excluído depois do parecer.") aparecem no cartão do conteúdo, abaixo de cada exame afetado; o "Voltar a editar" e o "Retificar" ficam nos cartões de sempre ("Aguardando assinatura", "Documento assinado"), não duplicados ao lado de cada aviso (dois botões com o mesmo nome confundem o leitor de tela).
5. **`copia.retificacao`** (`{ versao, substitui }`, o código da versão anterior) entra na cópia congelada no preparo (RN-154), para o PDF imprimir "Versão {n} — substitui o documento {código}" sem o worker ler outra linha.
6. **A retificação da receita copia a justificativa de uso** para a nota da versão nova (a habilitação em Fitoterapia é conferida de novo ao salvar, preparar e assinar, como no 10A); o motivo da retificação nasce vazio.
7. **`travarDocumentoAntesDaCota` passa a travar a original** quando o documento é uma retificação (D-P1) — vale para o PDF base, as fotos e o PDF assinado da versão nova.
8. **`/admin`:** depois de uma ação (suspender, liberar…), o redirecionamento continua indo para `/admin?aviso=…` (primeira página, sem busca) — como hoje; guardar a página e a busca fica no backlog se o dono sentir falta.
9. **Textos novos ou propostos** (vão à revisão de interface e à Debby): "Novo parecer nutricional" (da spec), "Exames considerados" (da spec, título do campo e da seção do PDF), "Nenhum exame lançado. Lance os exames na aba Exames." (novo), "Avaliação nutricional" / "Conduta e orientações (opcional)" / "Encaminhamentos (opcional)" (rótulos da spec + "(opcional)" como na receita), "Marcador · Valor · Unidade · Referência" (cabeçalho da tabela do PDF, novo), "Os valores deste exame mudaram depois do parecer." (spec), "O exame {título — data} foi excluído depois do parecer." e "Um dos exames selecionados foi excluído. Revise a seleção." (propostos na spec), "Retificar" (spec), "Motivo da retificação" + dica "Fica só no prontuário." (Q13-1, como o do cancelamento), "Escreva o motivo da retificação (até 500 caracteres)." (Q13-1), "Motivo da retificação (só no prontuário): {motivo}" (novo, como o do cancelamento), "Versão {n} — substitui o documento {código}" (proposto na spec), "Versão {n}" (proposto na spec), cartão "Documento substituído", "Substituído em {data} pela versão {n}." e "Abrir a versão {n}" (novos), "Há uma retificação em andamento (versão N). Conclua ou apague a retificação antes de cancelar." (spec); no `/admin`: "Buscar por nome, endereço ou e-mail", "Buscar", "Limpar busca", "Anterior", "Próxima" (spec), "Nenhuma conta encontrada." (novos); no manual guiado, o guia `documentos` v2 (T10).
10. **Seleção dos exames no editor:** a lista vem de `listarExames` (com `auditRead`); um id da cópia que não está mais na lista (exame excluído) aparece como aviso "Um dos exames selecionados foi excluído. Revise a seleção." acima da lista e **não** fica marcado (a nutricionista não consegue manter um exame que não existe); o servidor recusa com a mesma mensagem se o exame sumir entre a tela e o salvar.
11. **Isolamento da retificação fora de `test/isolamento.test.ts`** (revisão do plano): a spec v0.5 ("Migrations propostas") diz que `IMUTAVEIS` "ganha os casos novos do gatilho"; o plano deixa o teste de isolamento como está (as fábricas inserem versão 1 sem `retifica_id`) e cobre os casos entre consultórios e entre pacientes em `src/db/documentos-versoes.test.ts` (T1): INSERT com `retifica_id` de um documento de outro paciente ou de outro consultório → "retificação fora da regra" (o gatilho procura a original no mesmo tenant e paciente), e o consultório B levando a "substituido" um documento de A não acha a linha (RLS: 0 linhas, a original continua "assinado"). A frase da spec já foi corrigida junto com esta revisão do plano (seção "Migrations propostas"); a T12 a cita na revisão 0.6.

## Review Focus

1. **Corridas da retificação.** Dois cliques em "Retificar" ao mesmo tempo; "Cancelar documento" na original enquanto a versão nova é assinada noutra aba; "Retificar" e "Cancelar" juntos; a versão nova assinada duas vezes (job repetido). Esperado: uma versão nova só; nunca deadlock (ordem paciente → original → versão nova → tenant); ou a original vira "Substituído" (e o cancelamento recusa com o texto da US-148/RN-147) ou o cancelamento passa e a versão nova não chega a ser criada; nunca uma original "Cancelado" com uma versão nova "Assinado". Testes: T1 (gatilhos), T7 (dois `retificarDocumento` com `Promise.all`; a assinatura da versão nova esperando a original presa noutra conexão, `tenantLivreEnquantoEsperaODocumento`, com a cota livre; cancelar com a retificação em andamento).
2. **O exame muda por baixo do parecer.** A IA acrescenta linhas entre o salvar e o preparar; a data do exame muda; o exame é excluído com o parecer em rascunho, em "Aguardando assinatura" e assinado; um id de exame **de outro paciente** (ou de outro consultório) forjado no JSON do editor. Esperado: a cópia é a do último salvamento/preparo e não muda depois do preparo (gatilho); avisos "mudou"/"excluído" só na tela; o id alheio recusado com "Um dos exames selecionados foi excluído. Revise a seleção." e nada gravado. Testes: T3.
3. **Código fixo em "receita" atravessado pelo parecer.** `exigirHabilitacaoAtual` lendo `conteudo.itens` de um parecer (quebraria a digitalizada); o PDF com `title="Receita"`; o portal com "Abrir PDF da parecer nutricional"; a exportação lendo `itens` de um parecer; a verificação dizendo "Tipo: Receita". Esperado: cada ponto da lista "Pontos do código fixos em receita" da spec v0.5 responde pelo tipo. Testes: T4 (habilitação, PDF, digitalizada de ponta a ponta), T5 (verificação, portal, link, leitor de tela), T6 (exportação).
4. **LGPD com versões.** Paciente com v1 "Substituído", v2 "Assinado" e v3 em rascunho tem o pedido de exclusão atendido e depois é anonimizado; exportação do titular com v1 e v2; o motivo da retificação na exportação do titular. Esperado: bloqueio — nenhuma escrita (inclusive "Retificar"); anonimização — v3 apagada, v1 e v2 limpas (conteúdo, notas com o motivo, PDF) e verificação "eliminado" nas duas; titular recebe v1 e v2 com `versao` e `retificaCodigo`, sem motivo de retificação nem de cancelamento. Testes: T1 (função), T6.
5. **Busca e páginas do `/admin`.** Busca com `%`, `_`, aspas, 101 caracteres, só espaços; cursor que não é uuid ou de consultório inexistente; página do meio voltando com "Anterior"; consultório criado entre duas páginas. Esperado: `%`/`_` literais; busca vazia = lista toda; cursor inválido = primeira página; nenhuma linha repetida nem pulada entre "Próxima" e "Anterior"; nenhuma tabela 🔒 lida. Testes: T11.

---

## Estrutura de arquivos

```
drizzle/
  0104_parecer (gerada: CHECK de tipo em signed_documents e document_verifications; motivo_retificacao)   # T1
  0105_parecer_regras (custom: app_documento_versao + gatilho; app_documento_imutavel, app_notas_imutaveis e
                       app_anonimizar_documentos refeitas)                                             # T1
src/db/schema/documentos.ts · src/db/documentos-versoes.test.ts (novo) · src/db/documentos-imutaveis.test.ts
  · src/db/documentos-schema.test.ts                                                                               # T1
test/documentos.ts (documentoNoBanco, outroDocumento, retificacaoAssinadaNoBanco, CONTEUDO_PARECER_TESTE)         # T1
CLAUDE.md (regra 8)                                                                                               # T1 (e T12)
src/modules/documentos/
  constantes.ts (TipoDocumento, rótulos, declaração e ressalva do parecer, versão, MSG_RETIFICACAO)               # T2
  parecer.ts (+ parecer.test.ts) — esquema Zod, ConteudoParecer, comparação e linhas do PDF (sem servidor)       # T2
  perfil-profissional.ts (CopiaDoDocumento) · prescricao.ts (copia: CopiaDoDocumento)                            # T2
  parecer-exames.ts (copiarExames, situacaoDosExames) · documentos.ts (+ parecer-documentos.test.ts)             # T3
  documento-pdf.tsx · documento-pdf-job.ts · digitalizada.ts · digitalizada-job.tsx (+ tests)                     # T4 (só worker)
  registrar-assinatura.ts                                                                                         # T4 (habilitação), T5 (tipo), T7 (substituir)
  verificacao.ts · portal.ts · link-documento.ts (+ tests)                                                        # T5
  lgpd-documentos.ts (+ lgpd-documentos.test.ts) · src/modules/pacientes/exportacao.test.ts (estreitar o tipo)    # T6
  retificacao.ts (+ retificacao.test.ts) · arquivos-do-preparo.ts · cancelamento.ts (+ cancelamento.test.ts)      # T7
src/app/painel/pacientes/[id]/documentos/
  page.tsx · actions.ts (+ actions.test.ts)                                                                       # T8, T9
  [docId]/page.tsx (+ page.test.ts) · parecer-form.tsx (novo) · aviso-exame.tsx (novo)                            # T3 (tipos), T8
  [docId]/receita-form.tsx (+ receita-form.test.ts) · motivo-retificacao.tsx (novo); o cartão "Documento
    substituído" fica dentro de [docId]/page.tsx                                                                  # T9
src/app/painel/configuracoes/perfil/page.tsx · perfil/documentos-form.tsx (texto do carimbo)                      # T8
src/modules/documentos/documentos.test.ts · entrega.test.ts (fixtures com `versao`)                                # T3
src/app/p/(portal)/documentos/page.tsx (+ page.test.ts) · src/app/documento/[token]/page.tsx                      # T5
src/modules/ajuda/conteudo.ts (+ conteudo.test.ts) · e2e/documentos.ts · e2e/parecer.spec.ts (novo)
  · scripts/e2e-seed.ts (limite da verificação do IP sem login)                                                    # T10
src/modules/plataforma/contas.ts (+ contas.test.ts) · src/app/admin/page.tsx · src/app/formularios-post.test.ts
  · e2e/plataforma.spec.ts                                                                                         # T11
docs/manual-tecnico/09-documentos-assinados.md · 11-exames-enviados.md · README.md · docs/operacao/go-live.md
  · índice · backlog · spec · spec da IA da nutricionista (§5.10)                                                 # T12
```

### Dependências entre tarefas (worktrees em paralelo)

| Tarefa | Depende de | Pode rodar em paralelo com | Por quê |
|---|---|---|---|
| T1 Banco | — | T2, T11 | só `src/db/`, `drizzle/`, `test/documentos.ts`, `CLAUDE.md` |
| T2 Constantes e esquema do parecer | — | T1, T11 | só arquivos puros (`constantes.ts`, `parecer.ts`, tipos) — nenhum teste de banco |
| T3 Módulo do parecer | T1, T2 | T11 | `documentos.ts`, `parecer-exames.ts`, os tipos que todos usam (`ConteudoDocumento` em `DocumentoLido`) |
| T4 PDF e digitalizada por tipo | T3 | T6, T8, T11 | arquivos do worker + `exigirHabilitacaoAtual` |
| T6 LGPD | T3 | T4, T5, T8, T11 | só `lgpd-documentos.ts` (usa `retificacaoAssinadaNoBanco` da T1) |
| T8 Painel — parecer | T3 | T4, T5, T6, T7, T11 | `src/app/painel/pacientes/[id]/documentos/**` (a T3 só mexeu nos tipos da página) |
| T5 Verificação, portal e link | T4 (mesmo `registrar-assinatura.ts`) | T6, T8, T11 | `verificacao.ts`, `portal.ts`, `link-documento.ts`, duas telas pequenas |
| T7 Retificação (módulo) | T4, T5 | T6, T8, T11 | `retificacao.ts`, `registrar-assinatura.ts`, `arquivos-do-preparo.ts`, `cancelamento.ts`, `documentos.ts` |
| T9 Painel — retificação | T7, T8 | T11 | as mesmas telas da T8 |
| T10 Manual guiado e E2E | T5, T8, T9 | T11 | `ajuda/conteudo.ts`, `e2e/` |
| T11 P09-07 (`/admin`) | — | todas | `contas.ts`, `src/app/admin/page.tsx`, `formularios-post.test.ts`, `e2e/plataforma.spec.ts`; integrada **por último** antes do fechamento |
| T12 Fechamento | todas | — | manuais, runbook, índice, backlog, spec |

### Contratos entre tarefas (nomes que várias tarefas usam)

```ts
// test/documentos.ts (T1)
export const CONTEUDO_PARECER_TESTE: Record<string, unknown>;
export function documentoNoBanco(db, ctx, patientId, o?: { status?; conteudo?; assinaturaTipo?; tipo?: 'receita' | 'parecer'; versao?: number; retificaId?: string }): Promise<{ id: string; codigo: string | null; pdfPath: string | null }>;
export function outroDocumento(c: Consultorio, db, o?: { base?: Buffer; conteudo?: Record<string, unknown>; paciente?: PatientRow; tipo?: 'receita' | 'parecer'; retifica?: { id: string; versao: number }; motivo?: string });
export function retificacaoAssinadaNoBanco(db, ctx, patientId, original: { id: string; versao: number }, o?: { motivo?: string; tipo?: 'receita' | 'parecer'; conteudo?: Record<string, unknown>; substituir?: boolean }): Promise<{ id: string; codigo: string; pdfPath: string }>;
// documentoNoBanco com `retificaId` só em rascunho (o gatilho da 0105 recusa a versão nova inserida fora do rascunho)
// banco (T1): gatilho documento_versao (app_documento_versao); mensagens dos gatilhos citadas nos testes:
//   'versão sem retificação', 'retificação fora da regra', 'substituição só com a retificação assinada',
//   'cancelamento com retificação em andamento', 'retificação sem motivo', 'motivo de retificação só numa retificação'
// src/modules/documentos/constantes.ts (T2; sem imports)
export const TIPO_DOCUMENTO_ROTULO: { readonly receita: 'Receita'; readonly parecer: 'Parecer nutricional' };
export type TipoDocumento = 'receita' | 'parecer';
export const TIPO_DOCUMENTO_COM_ARTIGO: Record<TipoDocumento, string>;
export const DECLARACAO_PARECER: string; export const RESSALVA_PARECER: string; export const DECLARACAO_POR_TIPO: Record<TipoDocumento, string>;
export const rotuloDaVersao: (versao: number) => string; export const linhaDaVersao: (versao: number, codigoAnterior: string) => string;
export const MSG_RETIFICACAO: { motivo: string; emAndamento: (versao: number) => string };
// src/modules/documentos/perfil-profissional.ts (T2)
export type CopiaDoDocumento = { profissional: CopiaProfissional; paciente: { nome: string }; retificacao?: { versao: number; substitui: string } };
// src/modules/documentos/parecer.ts (T2; sem servidor — o formulário 'use client' importa)
export const PARECER_MAX_EXAMES = 20, AVALIACAO_MAX = 5000, CONDUTA_MAX = 5000, ENCAMINHAMENTOS_MAX = 1000;
export const MSG_PARECER: { semExame; examesDemais; avaliacao; conduta; encaminhamentos; exameExcluido; semValores; valoresMudaram; exameExcluidoDepois: (exame: string) => string };
export const CABECALHO_VALORES: string;
export type ValorCopiado = { nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string };
export type ExameCopiado = { id: string; data: string; titulo: string; valores: ValorCopiado[]; enviadoPeloPaciente?: true };
export type ConteudoParecer = { versao: 1; tipo: 'parecer'; exames: ExameCopiado[]; avaliacao: string; conduta: string; encaminhamentos: string; copia?: CopiaDoDocumento; declaracao?: string };
export type ConteudoDocumento = ConteudoReceita | ConteudoParecer;
export type RascunhoParecer = { exameIds: string[]; avaliacao: string; conduta: string; encaminhamentos: string };
export function validarRascunhoParecer(input: unknown): RascunhoParecer;
export function validarParecerParaPreparar(c: ConteudoParecer): void;
export function mesmoExame(copia: Pick<ExameCopiado, 'data' | 'titulo' | 'valores'>, atual: Pick<ExameCopiado, 'data' | 'titulo' | 'valores'>): boolean;
export function rotuloDoExame(e: { titulo: string; data: string }): string; // "Hemograma — 01/09/2026"
export function linhaDoValor(v: ValorCopiado): string;                     // "Hemoglobina · 13,5 · g/dL · 12 a 16"
// src/modules/documentos/parecer-exames.ts (T3)
export type SituacaoExame = 'igual' | 'mudou' | 'excluido';
export function copiarExames(tx: Tx, patientId: string, ids: readonly string[]): Promise<ExameCopiado[]>;
export function situacaoDosExames(ctx: TenantContext, patientId: string, copia: readonly ExameCopiado[], db?: Db): Promise<Record<string, SituacaoExame>>;
// src/modules/documentos/documentos.ts (T3; a T7 acrescenta)
export type ItemLista = { id; tipo: TipoDocumento; versao: number; status; codigo; createdAt; assinadoEm; assinaturaTipo; pdfStatus; entregueEm; recibos };
export type DocumentoLido = ItemLista & { conteudo: ConteudoDocumento; … /* T7: */ retificaId: string | null; motivoRetificacao: string | null; substituidoEm: Date | null;
  versoes: { anterior: { id: string; versao: number; codigo: string | null } | null; seguinte: { id: string; versao: number; status: StatusDocumento } | null } };
export function criarParecer(ctx: TenantContext, patientId: string, deps?: { db?: Db }): Promise<string>;
export function salvarRascunhoParecer(ctx: TenantContext, patientId: string, docId: string, input: { conteudo: unknown; motivoRetificacao?: unknown }, deps?: { db?: Db }): Promise<void>;
// salvarRascunhoReceita(ctx, tenant, patientId, docId, input: { conteudo: unknown; justificativa: unknown; motivoRetificacao?: unknown }, deps?) — T7 acrescenta motivoRetificacao
// src/modules/documentos/verificacao.ts (T5)
export type NovaVerificacao = { …; tipo: TipoDocumento; … };
export type VerificacaoPublica = { …; tipo: 'Receita' | 'Parecer nutricional'; … };
// src/modules/documentos/portal.ts (T5)
export type DocumentoNoPortal = { id: string; tipo: TipoDocumento; titulo: string; versao: number; data: Date; status: 'assinado' | 'substituido' | 'cancelado'; assinaturaTipo: TipoAssinatura; aberto: boolean; recebidoEm: Date | null };
// src/modules/documentos/link-documento.ts (T5)
// EstadoLink 'aberto' = { tipo: 'aberto'; titulo: string; versao: number; data: Date; recebidoEm: Date | null }
// src/modules/documentos/lgpd-documentos.ts (T6)
export type DocumentoExportado = BaseExportada & (ReceitaExportada | ParecerExportado); // tipo, versao, retificaCodigo, motivoDaRetificacao? (só equipe)
// src/modules/documentos/retificacao.ts (T7)
export function retificacaoEmAndamento(tx: Tx, documentoId: string): Promise<{ id: string; versao: number } | null>;
export function retificarDocumento(ctx: TenantContext, patientId: string, docId: string, deps?: { db?: Db }): Promise<string>;
export function lerMotivoRetificacao(v: unknown): string | null; // null = vazio; DocumentoError acima de 500
// src/modules/plataforma/contas.ts (T11)
export const CONTAS_POR_PAGINA = 50;
export type FiltroContas = { busca?: unknown; depois?: unknown; antes?: unknown; limite?: number };
export type PaginaDeContas = { contas: ContaResumo[]; anterior: string | null; proxima: string | null; busca: string };
export function listarContas(db?: Db, now?: Date, f?: FiltroContas): Promise<PaginaDeContas>;
```

### Cobertura da spec v0.5, parte do Plano 13 (autoconferência)

| Requisito | Tarefa(s) |
|---|---|
| US-141 (criar, sem valores, valores atualizados no rascunho, congelados antes e depois da assinatura, exame excluído, bloqueado) | T2 (esquema e comparação), T3 (cópia, preparo, situação), T4 (PDF), T8 (tela e avisos) |
| US-146 v0.5 (título pelo tipo, versão, substituído, sem chave de conteúdo) | T5 |
| US-147 v0.5 ("Tipo: Parecer nutricional", CHECK do tipo, substituído com o código próprio) | T1 (CHECK), T5 (tipo real), T7 (`mudarSituacao` na substituição) |
| US-148 (retificar, uma por vez, apagada → nova, só a versão em vigor) + v0.5 (os dois tipos, ordem de travas, entrega, corrida) | T1 (gatilhos), T7 (módulo), T9 (tela) |
| US-149 (cancelar com retificação em andamento) | T1 (gatilho), T7 (módulo), T9 (o texto chega ao formulário) |
| US-150 v0.5 (auditoria, exportação com `versao`/`retificaCodigo` e o parecer, bloqueio, anonimização das versões) | T1 (função), T6 |
| RN-140 / RN-141 (sem variante A) / RN-146 / RN-147 / RN-148 / RN-154 | T1 / T1 / T1, T7 / T1, T7 / T2, T3, T8 / T3, T7 |
| §10 v0.5 (CHECKs de tipo; sem `exam_ids`; motivo) | T1 |
| SBIS NGS1.12.01–03, 07.01, 07.03, 07.06, 01.01 | T1, T5, T6, T7 (ver Global Constraints) |
| Desvio 10 da spec (P09-07 no backlog) e item à parte P09-07 | T11 |
| Desvio 11 da spec (cap. 11 do manual diz "sem merge") | T12 |

### Task 1: Banco — tipo "parecer", motivo da retificação, versão nova conferida no INSERT, substituir/cancelar/preparar com as regras da retificação (P13-01)

**Revisão: completa (agente revisor-rls)** — gatilhos de imutabilidade refeitos (CS-141), gatilho novo de INSERT, função de anonimização, CHECKs.

**Files:**
- Modify: `src/db/schema/documentos.ts` (CHECKs de `tipo`, coluna `motivoRetificacao`, CHECK de tamanho das notas)
- Create: `drizzle/0104_parecer.sql` (gerada), `drizzle/0105_parecer_regras.sql` (custom), `src/db/documentos-versoes.test.ts`
- Modify: `test/documentos.ts` (`documentoNoBanco`, `outroDocumento`, `retificacaoAssinadaNoBanco`, `CONTEUDO_PARECER_TESTE`), `src/db/documentos-imutaveis.test.ts` (o caso do substituído passa a criar a retificação assinada), `src/db/documentos-schema.test.ts` (o caso do tipo inválido deixa de usar `'parecer'`), `CLAUDE.md` (regra 8)

**Interfaces:**
- Consumes: `app_documento_imutavel` (0093), `app_notas_imutaveis` e `app_anonimizar_documentos` (0091), `app_current_role()`, `app_current_tenant()`, o índice `signed_documents_retificacao_aberta` e a FK `signed_documents_retifica_fk` (0089), `codigoAleatorio` e `novoPaciente`.
- Produces: o que está em "Contratos entre tarefas" para `test/documentos.ts` e o banco (gatilho `documento_versao`; as seis mensagens).

- [ ] **Step 1: Os helpers de teste**

Em `test/documentos.ts`, trocar `documentoNoBanco` e `outroDocumento` e acrescentar `CONTEUDO_PARECER_TESTE` e `retificacaoAssinadaNoBanco` (o resto do arquivo não muda; acrescentar `type PatientRow` ao import de `@/db/schema`):

```ts
/** Plano 13: o conteúdo mínimo de um parecer (como o rascunho vazio de `criarParecer`). */
export const CONTEUDO_PARECER_TESTE = { versao: 1, tipo: 'parecer', exames: [], avaliacao: '', conduta: '', encaminhamentos: '' };

/**
 * Documento gravado direto no banco (sem o fluxo), no estado pedido. Emitido = com o stored_files do PDF assinado (FK NO
 * ACTION), SHA-256 e assinatura digitalizada (a única do 10A; o 10B passa `assinaturaTipo: 'govbr'` nos testes dele).
 * O gatilho de imutabilidade (0091) não olha INSERT; o `documento_versao` (0105, Plano 13) confere a versão: sem
 * `retificaId`, versão 1 (em qualquer estado, como a fábrica do isolamento); com ele, só em RASCUNHO, da original "assinado"
 * do mesmo tipo e paciente e com a versão seguinte — a retificação emitida passa por `retificacaoAssinadaNoBanco`.
 */
export async function documentoNoBanco(
  db: Db,
  ctx: TenantContext,
  patientId: string,
  o: { status?: StatusDocumento; conteudo?: Record<string, unknown>; assinaturaTipo?: TipoAssinatura; tipo?: 'receita' | 'parecer'; versao?: number; retificaId?: string } = {},
): Promise<{ id: string; codigo: string | null; pdfPath: string | null }> {
  const status = o.status ?? 'rascunho';
  const tipo = o.tipo ?? 'receita';
  const emitido = ['assinado', 'substituido', 'cancelado'].includes(status);
  const codigo = status === 'rascunho' ? null : codigoAleatorio();
  const pdfPath = emitido ? `${ctx.tenantId}/documento_assinado/${randomUUID()}.pdf` : null;
  const conteudo = o.conteudo ?? (tipo === 'parecer' ? CONTEUDO_PARECER_TESTE : { versao: 1, tipo: 'receita', itens: [], orientacoes: '' });
  const id = randomUUID();
  await withTenant(ctx, async (tx) => {
    if (pdfPath)
      await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${ctx.tenantId}, 'documento_assinado', ${pdfPath}, 100, 'application/pdf', ${patientId})`);
    await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, tipo, versao, retifica_id, status, codigo, conteudo, pdf_path, pdf_sha256, assinado_em, assinatura_tipo, assinante_nome, entregue_em)
      values (${id}, ${ctx.tenantId}, ${patientId}, ${tipo}, ${o.versao ?? 1}, ${o.retificaId ?? null}, ${status}, ${codigo}, ${JSON.stringify(conteudo)}::jsonb,
              ${pdfPath}, ${emitido ? 'a'.repeat(64) : null}, ${emitido ? new Date() : null}, ${emitido ? (o.assinaturaTipo ?? 'digitalizada') : null}, ${emitido && (o.assinaturaTipo ?? 'digitalizada') !== 'digitalizada' ? 'DEBBY SILVA' : null}, ${emitido ? new Date() : null})`);
  }, db);
  return { id, codigo, pdfPath };
}
```

```ts
/**
 * Um documento em "Aguardando assinatura" com o base no disco (como depois da T7 do 10A). Plano 13: `paciente` (a
 * retificação é do mesmo paciente da original), `tipo` e `retifica` (a versão nova de uma original "assinado"). Com
 * `retifica`, o caminho que os gatilhos da 0105 aceitam: INSERT em rascunho, a nota com o motivo e o UPDATE para o preparo.
 */
export async function outroDocumento(
  c: Consultorio,
  db: Db,
  o: { base?: Buffer; conteudo?: Record<string, unknown>; paciente?: PatientRow; tipo?: 'receita' | 'parecer'; retifica?: { id: string; versao: number }; motivo?: string } = {},
) {
  const BASE_DOC = o.base ?? pdfDeTeste();
  const p = o.paciente ?? (await novoPaciente(db, c.T.ctx));
  const base = `${c.T.tenantId}/documento_base/${randomUUID()}.pdf`;
  await mkdir(path.join(c.dataDir, path.dirname(base)), { recursive: true });
  await writeFile(path.join(c.dataDir, base), BASE_DOC);
  const id = randomUUID();
  const tipo = o.tipo ?? 'receita';
  const copia = { profissional: COPIA_TESTE, paciente: { nome: 'Ana Souza' } };
  const conteudo = o.conteudo ?? (tipo === 'parecer' ? { ...CONTEUDO_PARECER_TESTE, avaliacao: 'Avaliação de teste.', copia } : { versao: 1, tipo: 'receita', itens: [], orientacoes: '', copia });
  const codigo = codigoAleatorio();
  await withTenant(c.T.ctx, async (tx) => {
    await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${c.T.tenantId}, 'documento_base', ${base}, ${BASE_DOC.length}, 'application/pdf', ${p.id})`);
    if (!o.retifica) {
      await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, tipo, status, codigo, conteudo, declaracao_em)
        values (${id}, ${c.T.tenantId}, ${p.id}, ${tipo}, 'preparando', ${codigo}, ${JSON.stringify(conteudo)}::jsonb, now())`);
      return;
    }
    // 0105: a versão nova só nasce em rascunho e só vai ao preparo com o motivo na nota (Q13-1)
    await tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, tipo, versao, retifica_id, conteudo)
      values (${id}, ${c.T.tenantId}, ${p.id}, ${tipo}, ${o.retifica.versao + 1}, ${o.retifica.id}, ${JSON.stringify(conteudo)}::jsonb)`);
    await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_retificacao) values (${c.T.tenantId}, ${p.id}, ${id}, ${o.motivo ?? 'Retificação de teste'})`);
    await tx.execute(sql`update signed_documents set status = 'preparando', codigo = ${codigo}, declaracao_em = now(), pdf_status = 'pendente', pdf_pedido_em = now() where id = ${id}`);
  }, db);
  await withTenant({ tenantId: c.T.tenantId, role: 'worker' }, (tx) => tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${sha256(BASE_DOC)}, base_pdf_bytes = ${BASE_DOC.length}, area_assinatura = ${JSON.stringify(AREA_ASSINATURA)}::jsonb where id = ${id}`), db);
  return { ...c, p, id, base, codigo, baseSha256: sha256(BASE_DOC) };
}

/**
 * Plano 13: a versão seguinte de `original` ASSINADA, direto no banco pelo caminho que os gatilhos aceitam — rascunho com a
 * nota (o motivo, Q13-1), preparo, base pelo worker, assinatura e a original "substituido" (o gatilho só deixa com a
 * retificação já assinada). Sem verificação pública nem arquivo no disco (os testes de LGPD e do portal não precisam).
 * `substituir: false` para antes da substituição (os testes do gatilho fazem o UPDATE da original eles mesmos).
 */
export async function retificacaoAssinadaNoBanco(
  db: Db,
  ctx: TenantContext,
  patientId: string,
  original: { id: string; versao: number },
  o: { motivo?: string; tipo?: 'receita' | 'parecer'; conteudo?: Record<string, unknown>; substituir?: boolean } = {},
): Promise<{ id: string; codigo: string; pdfPath: string }> {
  const v = await documentoNoBanco(db, ctx, patientId, { tipo: o.tipo, conteudo: o.conteudo, retificaId: original.id, versao: original.versao + 1 });
  const codigo = codigoAleatorio();
  const arq = (tipo: string) => `${ctx.tenantId}/${tipo}/${randomUUID()}.pdf`;
  const [base, pdf] = [arq('documento_base'), arq('documento_assinado')];
  await withTenant(ctx, async (tx) => {
    await tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_retificacao) values (${ctx.tenantId}, ${patientId}, ${v.id}, ${o.motivo ?? 'Retificação de teste'})`);
    await tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${ctx.tenantId}, 'documento_base', ${base}, 10, 'application/pdf', ${patientId}), (${ctx.tenantId}, 'documento_assinado', ${pdf}, 10, 'application/pdf', ${patientId})`);
    await tx.execute(sql`update signed_documents set status = 'preparando', codigo = ${codigo}, declaracao_em = now(), pdf_status = 'pendente', pdf_pedido_em = now() where id = ${v.id}`);
  }, db);
  await withTenant({ tenantId: ctx.tenantId, role: 'worker' }, (tx) => tx.execute(sql`update signed_documents set status = 'aguardando_assinatura', pdf_status = 'pronto', base_pdf_path = ${base}, base_pdf_sha256 = ${'b'.repeat(64)}, base_pdf_bytes = 10 where id = ${v.id}`), db);
  await withTenant(ctx, async (tx) => {
    await tx.execute(sql`update signed_documents set status = 'assinado', pdf_path = ${pdf}, pdf_sha256 = ${'a'.repeat(64)}, assinado_em = now(), assinatura_tipo = 'digitalizada' where id = ${v.id}`);
    await tx.execute(sql`update signed_documents set base_pdf_path = null where id = ${v.id}`); // o base "sai" (regra 9); a linha de stored_files fica órfã, como depois de um soltar que falhou
    if (o.substituir !== false) await tx.execute(sql`update signed_documents set status = 'substituido', substituido_em = now() where id = ${original.id}`);
  }, db);
  return { id: v.id, codigo, pdfPath: pdf };
}
```

- [ ] **Step 2: O teste que falha**

Criar `src/db/documentos-versoes.test.ts`:

```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { codigoAleatorio, documentoNoBanco, retificacaoAssinadaNoBanco } from '../../test/documentos';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant, type TenantContext } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string; constraint?: string };
const negadoPor = (trecho: string) => (e: unknown) => causa(e).code === '42501' && String(causa(e).message).includes(trecho);
const violaCheck = (nome: string) => (e: unknown) => causa(e).code === '23514' && causa(e).constraint === nome;
const unico = (e: unknown) => causa(e).code === '23505';
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });

async function cenario(o: { bloqueado?: boolean } = {}) {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx, o.bloqueado ? { status: 'bloqueado' } : {});
  const q = (s: ReturnType<typeof sql>, ctx: TenantContext = T.ctx) => withTenant(ctx, (tx) => tx.execute(s), app.db);
  return { T, p, q };
}

describe('0104: o tipo "parecer" (spec v0.5, §10)', () => {
  it('signed_documents e document_verifications aceitam "receita" e "parecer" e nada mais', async () => {
    const { T, p, q } = await cenario();
    await documentoNoBanco(app.db, T.ctx, p.id, { tipo: 'parecer' });
    await expect(q(sql`insert into signed_documents (tenant_id, patient_id, tipo) values (${T.tenantId}, ${p.id}, 'atestado')`)).rejects.toSatisfy(violaCheck('signed_documents_tipo_valido'));
    const verificacao = (tipo: string, d: { id: string; codigo: string | null }) =>
      app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
        values (${d.codigo}, ${T.tenantId}, ${d.id}, ${tipo}, now(), 'Debby Silva', 'CRN-3 12345', 'digitalizada', ${'a'.repeat(64)})`);
    await verificacao('parecer', await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', tipo: 'parecer' }));
    await expect(verificacao('atestado', await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' }))).rejects.toSatisfy(violaCheck('document_verifications_tipo_valido'));
  });
});

describe('0105: app_documento_versao — o INSERT da versão nova (RN-146)', () => {
  it('sem retifica_id, só a versão 1; com retifica_id, só em rascunho, da original "assinado" do mesmo tipo e paciente, com a versão seguinte', async () => {
    const { T, p } = await cenario();
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { versao: 2 })).rejects.toSatisfy(negadoPor('versão sem retificação'));
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 3 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2, tipo: 'parecer' })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    const rascunho = await documentoNoBanco(app.db, T.ctx, p.id);
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: rascunho.id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    const cancelado = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: cancelado.id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    const outro = await novoPaciente(app.db, T.ctx);
    await expect(documentoNoBanco(app.db, T.ctx, outro.id, { retificaId: v1.id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    // revisão do plano: a versão nova só nasce em rascunho (sem isso, pularia o motivo e ficariam duas "assinado" em vigor)
    for (const status of ['preparando', 'assinado'] as const)
      await expect(documentoNoBanco(app.db, T.ctx, p.id, { status, retificaId: v1.id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    expect((await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 })).id).toBeTruthy();
  });

  it('outro consultório (desvio 11 do plano): B não retifica nem substitui um documento de A', async () => {
    const { T, p } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const B = await novoTenant(app.db);
    const pb = await novoPaciente(app.db, B.ctx);
    await expect(documentoNoBanco(app.db, B.ctx, pb.id, { retificaId: v1.id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
    const r = await withTenant(B.ctx, (tx) => tx.execute(sql`update signed_documents set status = 'substituido', substituido_em = now() where id = ${v1.id}`), app.db);
    expect(r.rowCount).toBe(0); // RLS: B não vê a linha
    expect((await withTenant(T.ctx, (tx) => tx.execute(sql`select status from signed_documents where id = ${v1.id}`), app.db)).rows).toEqual([{ status: 'assinado' }]);
  });

  it('a original anonimizada não é retificada', async () => {
    const { T, p, q } = await cenario();
    const [{ id }] = (await q(sql`insert into signed_documents (tenant_id, patient_id, status, codigo, anonimizado_em) values (${T.tenantId}, ${p.id}, 'assinado', ${codigoAleatorio()}, now()) returning id`)).rows as { id: string }[];
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: id, versao: 2 })).rejects.toSatisfy(negadoPor('retificação fora da regra'));
  });

  it('uma retificação em andamento por documento (índice da 0089): a segunda bate no 23505; apagada a primeira, outra nasce', async () => {
    const { T, p, q } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 });
    await expect(documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 })).rejects.toSatisfy(unico);
    await q(sql`delete from signed_documents where id = ${v2.id}`);
    expect((await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 })).id).toBeTruthy();
  });
});

describe('0105: app_documento_imutavel — substituir, cancelar e preparar com a retificação (RN-146, RN-147, Q13-1)', () => {
  it('assinado → substituido só com uma retificação dela já "assinado" (nem sem retificação, nem com ela em rascunho)', async () => {
    const { T, p, q } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const substituir = sql`update signed_documents set status = 'substituido', substituido_em = now() where id = ${v1.id}`;
    await expect(q(substituir)).rejects.toSatisfy(negadoPor('substituição só com a retificação assinada'));
    const v2 = await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 });
    await expect(q(substituir)).rejects.toSatisfy(negadoPor('substituição só com a retificação assinada'));
    await q(sql`delete from signed_documents where id = ${v2.id}`);
    // a retificação assinada pelo caminho dos gatilhos (rascunho → nota com o motivo → preparo → worker → assinado)
    await retificacaoAssinadaNoBanco(app.db, T.ctx, p.id, { id: v1.id, versao: 1 }, { substituir: false });
    await q(substituir);
  });

  it('assinado → cancelado recusado com uma retificação em andamento; sem ela, passa (RN-147 também no banco)', async () => {
    const { T, p, q } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 });
    const cancelar = sql`update signed_documents set status = 'cancelado', cancelado_em = now() where id = ${v1.id}`;
    await expect(q(cancelar)).rejects.toSatisfy(negadoPor('cancelamento com retificação em andamento'));
    await q(sql`delete from signed_documents where id = ${v2.id}`);
    await q(cancelar);
  });

  it('a retificação só vai a "preparando" com o motivo na nota (1–500, sem só espaços); depois o motivo é fixo', async () => {
    const { T, p, q } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: v1.id, versao: 2 });
    await q(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id) values (${T.tenantId}, ${p.id}, ${v2.id})`);
    const preparar = sql`update signed_documents set status = 'preparando', codigo = ${codigoAleatorio()}, declaracao_em = now(), pdf_status = 'pendente', pdf_pedido_em = now() where id = ${v2.id}`;
    await expect(q(preparar)).rejects.toSatisfy(negadoPor('retificação sem motivo'));
    await q(sql`update signed_document_notes set motivo_retificacao = '   ' where documento_id = ${v2.id}`);
    await expect(q(preparar)).rejects.toSatisfy(negadoPor('retificação sem motivo'));
    await q(sql`update signed_document_notes set motivo_retificacao = ${'\n\t \r\n'} where documento_id = ${v2.id}`); // só quebras e tabulações
    await expect(q(preparar)).rejects.toSatisfy(negadoPor('retificação sem motivo'));
    await q(sql`update signed_document_notes set motivo_retificacao = 'Ferritina lançada depois do parecer' where documento_id = ${v2.id}`);
    await q(preparar);
    await expect(q(sql`update signed_document_notes set motivo_retificacao = 'outro' where documento_id = ${v2.id}`)).rejects.toSatisfy(negadoPor('nota congelada'));
    // a versão 1 (sem retificação) prepara sem motivo, como no 10A
    const r = await documentoNoBanco(app.db, T.ctx, p.id);
    await q(sql`update signed_documents set status = 'preparando', codigo = ${codigoAleatorio()}, declaracao_em = now(), pdf_status = 'pendente', pdf_pedido_em = now() where id = ${r.id}`);
  });
});

describe('0105: app_notas_imutaveis e app_anonimizar_documentos — o motivo da retificação', () => {
  it('o motivo só numa versão nova (com retifica_id) e com até 500 caracteres', async () => {
    const { T, p, q } = await cenario();
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id);
    await expect(q(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_retificacao) values (${T.tenantId}, ${p.id}, ${v1.id}, 'x')`)).rejects.toSatisfy(negadoPor('motivo de retificação só numa retificação'));
    const a = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await documentoNoBanco(app.db, T.ctx, p.id, { retificaId: a.id, versao: 2 });
    await expect(q(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_retificacao) values (${T.tenantId}, ${p.id}, ${v2.id}, ${'x'.repeat(501)})`)).rejects.toSatisfy(violaCheck('signed_document_notes_tamanhos'));
    await q(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id, motivo_retificacao) values (${T.tenantId}, ${p.id}, ${v2.id}, 'Ferritina')`);
  });

  it('a anonimização (worker, paciente bloqueado) limpa também o motivo da retificação', async () => {
    const { T, p, q } = await cenario({ bloqueado: true });
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await retificacaoAssinadaNoBanco(app.db, T.ctx, p.id, { id: v1.id, versao: 1 }, { motivo: 'Ferritina lançada depois' });
    await q(sql`select app_anonimizar_documentos(${v2.id})`, worker(T.tenantId));
    expect((await q(sql`select motivo_retificacao, justificativa_uso from signed_document_notes where documento_id = ${v2.id}`)).rows).toEqual([{ motivo_retificacao: null, justificativa_uso: null }]);
    expect((await q(sql`select status from signed_documents where id = ${v1.id}`)).rows).toEqual([{ status: 'substituido' }]);
  });
});
```

Run: `pnpm vitest run src/db/documentos-versoes.test.ts`
Expected: FAIL (o CHECK aceita só `'receita'`, a coluna `motivo_retificacao` não existe, o INSERT não é conferido).

- [ ] **Step 3: O schema e a migration gerada**

Em `src/db/schema/documentos.ts`:

```ts
    // Plano 13 (spec v0.5, §10): o parecer nutricional (F3-05) ao lado da receita
    check('signed_documents_tipo_valido', sql`${t.tipo} in ('receita','parecer')`),
```

em `signedDocumentNotes`, depois de `motivoCancelamento`:

```ts
    /** Plano 13 (Q13-1, SBIS NGS1.12.01): por que a versão nova corrige a anterior. Só numa retificação; fixo do preparo em diante (0105). */
    motivoRetificacao: text('motivo_retificacao'),
```

```ts
    check(
      'signed_document_notes_tamanhos',
      sql`coalesce(char_length(${t.justificativaUso}), 0) <= 2000 and coalesce(char_length(${t.motivoCancelamento}), 0) <= 500 and coalesce(char_length(${t.motivoRetificacao}), 0) <= 500`,
    ),
```

e em `documentVerifications`:

```ts
    // Plano 13 (spec v0.5, US-147): a verificação grava o tipo real do documento
    check('document_verifications_tipo_valido', sql`${t.tipo} in ('receita','parecer')`),
```

Run: `pnpm db:generate --name parecer`
Expected: `drizzle/0104_parecer.sql` (e o `meta/` atualizado) com, nesta ordem ou equivalente:

```sql
ALTER TABLE "signed_document_notes" ADD COLUMN "motivo_retificacao" text;--> statement-breakpoint
ALTER TABLE "signed_documents" DROP CONSTRAINT "signed_documents_tipo_valido";--> statement-breakpoint
ALTER TABLE "signed_document_notes" DROP CONSTRAINT "signed_document_notes_tamanhos";--> statement-breakpoint
ALTER TABLE "signed_documents" ADD CONSTRAINT "signed_documents_tipo_valido" CHECK ("signed_documents"."tipo" in ('receita','parecer'));--> statement-breakpoint
ALTER TABLE "signed_document_notes" ADD CONSTRAINT "signed_document_notes_tamanhos" CHECK (coalesce(char_length("signed_document_notes"."justificativa_uso"), 0) <= 2000 and coalesce(char_length("signed_document_notes"."motivo_cancelamento"), 0) <= 500 and coalesce(char_length("signed_document_notes"."motivo_retificacao"), 0) <= 500);--> statement-breakpoint
ALTER TABLE "document_verifications" ADD CONSTRAINT "document_verifications_tipo_valido" CHECK ("document_verifications"."tipo" in ('receita','parecer'));
```

Conferir o arquivo gerado: se o drizzle-kit não emitir alguma das trocas de CHECK, escrevê-la no começo da 0105 (Step 4) e registrar no commit. Os dados existentes passam nos CHECKs novos (só há `'receita'`).

- [ ] **Step 4: A migration custom**

Run: `pnpm drizzle-kit generate --custom --name parecer_regras` e preencher `drizzle/0105_parecer_regras.sql`:

```sql
-- Plano 13 (spec de documentos assinados v0.5, "Plano 13 — preparação"): retificação no banco. Custom (regra 2 do
-- CLAUDE.md): não edita as migrations 0089/0091/0093. Rodar com DATABASE_URL_MIGRATOR (regra 7). Sem migração de dados e
-- sem DISABLE TRIGGER (SBIS NGS1.07.01); o gatilho de auditoria (regra 8, 0090) não muda.

-- 1. RN-146: o INSERT da versão nova. Sem retifica_id, só a versão 1, em qualquer estado (a fábrica do teste de
-- isolamento, D19 do 10A, e os helpers inserem emitidos direto; nenhuma usa retifica_id). Com retifica_id: só em RASCUNHO
-- (o motivo, regra (a) abaixo, e as colunas do preparo e da assinatura passam pelo ramo de rascunho do
-- app_documento_imutavel; um INSERT direto já "preparando"/"assinado" pularia o motivo e deixaria duas versões "assinado"
-- em vigor), da original do mesmo tenant e paciente, do MESMO tipo, ainda "assinado" (a versão em vigor) e não
-- anonimizada, e com a versão seguinte à dela. FOR SHARE: um cancelamento ou uma substituição concorrentes da original
-- esperam este INSERT (e vice-versa).
CREATE OR REPLACE FUNCTION app_documento_versao() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  o record;
BEGIN
  IF NEW.retifica_id IS NULL THEN
    IF NEW.versao <> 1 THEN
      RAISE EXCEPTION 'versão sem retificação (RN-146)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status <> 'rascunho' THEN
    RAISE EXCEPTION 'retificação fora da regra (RN-146): a versão nova nasce em rascunho' USING ERRCODE = '42501';
  END IF;
  SELECT tipo, status, versao, anonimizado_em INTO o
    FROM signed_documents
   WHERE id = NEW.retifica_id AND tenant_id = NEW.tenant_id AND patient_id = NEW.patient_id
   FOR SHARE;
  IF NOT FOUND OR o.tipo <> NEW.tipo OR o.status <> 'assinado' OR o.anonimizado_em IS NOT NULL OR NEW.versao <> o.versao + 1 THEN
    RAISE EXCEPTION 'retificação fora da regra (RN-146): só da versão em vigor, do mesmo tipo, com a versão seguinte' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER documento_versao BEFORE INSERT ON signed_documents FOR EACH ROW EXECUTE FUNCTION app_documento_versao();
--> statement-breakpoint
-- 2. app_documento_imutavel (0093) com três regras do Plano 13 — o resto é o da 0093, linha a linha:
--   (a) rascunho → preparando de uma retificação exige o motivo na nota (Q13-1, SBIS NGS1.12.01);
--   (b) assinado → cancelado recusado com uma retificação em andamento (RN-147 no banco, D-P3 do plano);
--   (c) assinado → substituido só com uma retificação desta já "assinado" (RN-146: na mesma transação da assinatura dela).
-- search_path fixo (Minor do Plano 12 para as funções de gatilho).
CREATE OR REPLACE FUNCTION app_documento_imutavel() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  o jsonb;
  n jsonb;
  mudou text[];
  fixas constant text[] := ARRAY['id', 'tenant_id', 'patient_id', 'tipo', 'versao', 'retifica_id', 'created_at'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'rascunho' THEN
      RAISE EXCEPTION 'documento fora do rascunho não é apagado (RN-140)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  o := to_jsonb(OLD) - 'updated_at';
  n := to_jsonb(NEW) - 'updated_at';
  IF o = n THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(array_agg(k), '{}') INTO mudou FROM jsonb_object_keys(o) AS k WHERE o -> k IS DISTINCT FROM n -> k;
  IF mudou && fixas THEN
    RAISE EXCEPTION 'coluna fixa do documento (RN-140)' USING ERRCODE = '42501';
  END IF;

  -- anonimização (RN-140 c): só o worker, só documento emitido, e só limpar
  IF OLD.anonimizado_em IS NULL AND NEW.anonimizado_em IS NOT NULL THEN
    IF app_current_role() IS DISTINCT FROM 'worker' OR OLD.status NOT IN ('assinado', 'substituido', 'cancelado')
       OR NOT (mudou <@ ARRAY['anonimizado_em', 'conteudo', 'pdf_path', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'])
       OR NEW.conteudo <> '{}'::jsonb OR NEW.pdf_path IS NOT NULL OR NEW.base_pdf_path IS NOT NULL THEN
      RAISE EXCEPTION 'anonimização fora da regra (RN-140 c)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.anonimizado_em IS NOT NULL THEN
    RAISE EXCEPTION 'documento anonimizado não muda' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'rascunho' THEN
    IF NEW.status NOT IN ('rascunho', 'preparando') OR 'anonimizado_em' = ANY (mudou) THEN
      RAISE EXCEPTION 'transição inválida a partir do rascunho (RN-141)' USING ERRCODE = '42501';
    END IF;
    IF NEW.pdf_path IS NOT NULL OR NEW.pdf_sha256 IS NOT NULL OR NEW.assinado_em IS NOT NULL OR NEW.assinatura_tipo IS NOT NULL
       OR NEW.assinado_por IS NOT NULL OR NEW.assinatura_emissor IS NOT NULL OR NEW.assinante_nome IS NOT NULL
       OR NEW.cancelado_em IS NOT NULL OR NEW.substituido_em IS NOT NULL
       OR NEW.base_pdf_path IS NOT NULL OR NEW.entregue_em IS NOT NULL
       OR NEW.digitalizacao IS NOT NULL OR NEW.digitalizacao_status IS NOT NULL OR NEW.digitalizacao_em IS NOT NULL THEN
      RAISE EXCEPTION 'rascunho sem PDF nem assinatura (RN-141)' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'preparando' AND (NEW.declaracao_em IS NULL OR NEW.pdf_status IS DISTINCT FROM 'pendente') THEN
      RAISE EXCEPTION 'preparo fora da regra (RN-141): declaração e PDF pendente' USING ERRCODE = '42501';
    END IF;
    -- (a) Plano 13: a retificação vai ao preparo só com o motivo (1–500, não só espaços, tabulações ou quebras de linha)
    IF NEW.status = 'preparando' AND NEW.retifica_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM signed_document_notes nt
          WHERE nt.documento_id = NEW.id AND char_length(btrim(coalesce(nt.motivo_retificacao, ''), E' \t\r\n')) BETWEEN 1 AND 500) THEN
      RAISE EXCEPTION 'retificação sem motivo (RN-146, SBIS NGS1.12.01)' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('preparando', 'aguardando_assinatura') THEN
    IF NEW.status = 'rascunho' THEN
      IF NOT (mudou <@ ARRAY['status', 'codigo', 'declaracao_em', 'base_pdf_path', 'base_pdf_sha256', 'base_pdf_bytes', 'area_assinatura', 'pdf_status', 'pdf_pedido_em', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'])
         OR NEW.codigo IS NOT NULL OR NEW.declaracao_em IS NOT NULL OR NEW.base_pdf_path IS NOT NULL OR NEW.base_pdf_sha256 IS NOT NULL
         OR NEW.base_pdf_bytes IS NOT NULL OR NEW.area_assinatura IS NOT NULL
         OR NEW.digitalizacao IS NOT NULL OR NEW.digitalizacao_status IS NOT NULL OR NEW.digitalizacao_em IS NOT NULL THEN
        RAISE EXCEPTION 'voltar a editar fora da regra (RN-140 a)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.status = 'preparando' AND NEW.status = 'aguardando_assinatura' THEN
      IF app_current_role() IS DISTINCT FROM 'worker'
         OR NOT (mudou <@ ARRAY['status', 'pdf_status', 'base_pdf_path', 'base_pdf_sha256', 'base_pdf_bytes', 'area_assinatura'])
         OR OLD.base_pdf_path IS NOT NULL OR NEW.base_pdf_path IS NULL OR NEW.base_pdf_sha256 IS NULL OR NEW.base_pdf_bytes IS NULL THEN
        RAISE EXCEPTION 'PDF base fora da regra (RN-141)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.status = OLD.status THEN
      IF NOT (mudou <@ ARRAY['pdf_status', 'pdf_pedido_em'])
         AND NOT (OLD.status = 'aguardando_assinatura' AND mudou <@ ARRAY['pdf_status', 'pdf_pedido_em', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em']) THEN
        RAISE EXCEPTION 'conteúdo congelado desde o preparo (RN-140)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.status = 'aguardando_assinatura' AND NEW.status = 'assinado' THEN
      IF NOT (mudou <@ ARRAY['status', 'pdf_path', 'pdf_sha256', 'assinatura_tipo', 'assinatura_emissor', 'assinante_nome', 'assinado_em', 'assinado_por', 'entregue_em', 'digitalizacao_status', 'digitalizacao_em']) THEN
        RAISE EXCEPTION 'assinatura fora da regra (RN-140 b)' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM stored_files f
                      WHERE f.caminho = NEW.pdf_path AND f.tenant_id = NEW.tenant_id AND f.patient_id = NEW.patient_id AND f.tipo = 'documento_assinado') THEN
        RAISE EXCEPTION 'PDF assinado fora da regra (RN-140 b): arquivo de outro tipo' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'transição inválida (RN-141)' USING ERRCODE = '42501';
  END IF;

  IF NOT (NEW.base_pdf_path IS NULL OR NEW.base_pdf_path IS NOT DISTINCT FROM OLD.base_pdf_path)
     OR NOT (NEW.digitalizacao IS NULL OR (OLD.digitalizacao IS NOT NULL AND jsonb_typeof(NEW.digitalizacao) = 'array' AND OLD.digitalizacao @> NEW.digitalizacao)) THEN
    RAISE EXCEPTION 'ponteiro de arquivo de documento emitido só sai (RN-140, regra 9)' USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'assinado' THEN
    IF NEW.status = 'assinado' AND mudou <@ ARRAY['base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em', 'entregue_em']
       AND (OLD.entregue_em IS NULL OR NEW.entregue_em IS NOT DISTINCT FROM OLD.entregue_em) THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'cancelado' AND mudou <@ ARRAY['status', 'cancelado_em', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] AND NEW.cancelado_em IS NOT NULL THEN
      -- (b) Plano 13 (RN-147): conclua ou apague a retificação antes de cancelar
      IF EXISTS (SELECT 1 FROM signed_documents r
                  WHERE r.retifica_id = OLD.id AND r.tenant_id = OLD.tenant_id AND r.status IN ('rascunho', 'preparando', 'aguardando_assinatura')) THEN
        RAISE EXCEPTION 'cancelamento com retificação em andamento (RN-147)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.status = 'substituido' AND mudou <@ ARRAY['status', 'substituido_em', 'base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] AND NEW.substituido_em IS NOT NULL THEN
      -- (c) Plano 13 (RN-146): só quando a retificação desta já foi assinada (na mesma transação, registrarAssinatura)
      IF NOT EXISTS (SELECT 1 FROM signed_documents r
                      WHERE r.retifica_id = OLD.id AND r.tenant_id = OLD.tenant_id AND r.status = 'assinado') THEN
        RAISE EXCEPTION 'substituição só com a retificação assinada (RN-146)' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'documento assinado não muda (RN-140)' USING ERRCODE = '42501';
  END IF;

  IF NEW.status = OLD.status AND mudou <@ ARRAY['base_pdf_path', 'digitalizacao', 'digitalizacao_status', 'digitalizacao_em'] THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'documento emitido não muda (RN-140)' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
-- 3. app_notas_imutaveis (0091) com o motivo da retificação: só numa versão nova (retifica_id), livre no rascunho, fixo do
-- preparo em diante (como a justificativa), limpo na anonimização.
CREATE OR REPLACE FUNCTION app_notas_imutaveis() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  d record;
BEGIN
  SELECT status, anonimizado_em, retifica_id INTO d FROM signed_documents WHERE id = coalesce(NEW.documento_id, OLD.documento_id);
  IF TG_OP = 'DELETE' THEN
    IF d.status IS NOT NULL AND d.status <> 'rascunho' THEN
      RAISE EXCEPTION 'nota de documento emitido não é apagada (RN-140)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.documento_id) IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.documento_id) THEN
    RAISE EXCEPTION 'coluna fixa da nota (RN-140)' USING ERRCODE = '42501';
  END IF;
  IF d.anonimizado_em IS NOT NULL THEN
    IF NEW.justificativa_uso IS NOT NULL OR NEW.motivo_cancelamento IS NOT NULL OR NEW.motivo_retificacao IS NOT NULL THEN
      RAISE EXCEPTION 'nota de documento anonimizado só é limpa' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.motivo_retificacao IS NOT NULL AND d.retifica_id IS NULL THEN
    RAISE EXCEPTION 'motivo de retificação só numa retificação (RN-146)' USING ERRCODE = '42501';
  END IF;
  IF d.status = 'rascunho' THEN
    IF NEW.motivo_cancelamento IS NOT NULL THEN
      RAISE EXCEPTION 'rascunho não tem motivo de cancelamento' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF (TG_OP = 'INSERT' AND (NEW.justificativa_uso IS NOT NULL OR NEW.motivo_retificacao IS NOT NULL))
     OR (TG_OP = 'UPDATE' AND (NEW.justificativa_uso IS DISTINCT FROM OLD.justificativa_uso OR NEW.motivo_retificacao IS DISTINCT FROM OLD.motivo_retificacao))
     OR (NEW.motivo_cancelamento IS NOT NULL AND (d.status <> 'cancelado' OR (TG_OP = 'UPDATE' AND OLD.motivo_cancelamento IS NOT NULL AND NEW.motivo_cancelamento IS DISTINCT FROM OLD.motivo_cancelamento)))
     OR (TG_OP = 'UPDATE' AND OLD.motivo_cancelamento IS NOT NULL AND NEW.motivo_cancelamento IS NULL) THEN
    RAISE EXCEPTION 'nota congelada desde o preparo (RN-140)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- 4. app_anonimizar_documentos (0091) limpando também o motivo da retificação. O resto é o da 0091.
CREATE OR REPLACE FUNCTION app_anonimizar_documentos(p_documento uuid) RETURNS text
LANGUAGE plpgsql VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
  v_caminho text;
BEGIN
  IF v_tenant IS NULL OR app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_anonimizar_documentos() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  SELECT sd.pdf_path INTO v_caminho
    FROM public.signed_documents sd
    JOIN public.patients p ON p.tenant_id = sd.tenant_id AND p.id = sd.patient_id
   WHERE sd.id = p_documento AND sd.tenant_id = v_tenant AND p.status = 'bloqueado' AND p.anonimizado_em IS NULL
     AND sd.anonimizado_em IS NULL AND sd.status IN ('assinado', 'substituido', 'cancelado')
   FOR UPDATE OF sd;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_anonimizar_documentos(): documento emitido de paciente bloqueado não encontrado neste tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.signed_documents
     SET anonimizado_em = clock_timestamp(), conteudo = '{}'::jsonb, pdf_path = NULL, base_pdf_path = NULL, digitalizacao = NULL, digitalizacao_status = NULL, digitalizacao_em = NULL, updated_at = clock_timestamp()
   WHERE id = p_documento;
  UPDATE public.signed_document_notes
     SET justificativa_uso = NULL, motivo_cancelamento = NULL, motivo_retificacao = NULL, updated_at = clock_timestamp()
   WHERE documento_id = p_documento;
  UPDATE public.document_verifications SET situacao = 'eliminado', situacao_em = clock_timestamp() WHERE documento_id = p_documento;
  DELETE FROM public.document_access_codes WHERE documento_id = p_documento;
  RETURN v_caminho;
END $$;
```

O `CREATE OR REPLACE` mantém o `REVOKE`/`GRANT` da 0091 na `app_anonimizar_documentos` e os gatilhos `documento_imutavel` e `notas_imutaveis` (eles apontam para o nome da função).

- [ ] **Step 5: O caso do "substituído" do 10A**

Em `src/db/documentos-imutaveis.test.ts`, acrescentar `retificacaoAssinadaNoBanco` ao import de `../../test/documentos` e, no teste `'substituído (D2 ★, testado por SQL): …'`, logo antes da linha que aceita a substituição (`await q(sql\`update signed_documents set status = 'substituido', substituido_em = now() where id = ${d.id}\`);`), acrescentar a retificação assinada (Plano 13: o gatilho só deixa substituir com ela; e a versão nova só nasce em rascunho, então ela passa pelo caminho dos gatilhos, sem substituir — o UPDATE seguinte do teste substitui):

```ts
    // Plano 13 (0105, RN-146): a substituição só passa com uma retificação desta já assinada
    await expect(q(sql`update signed_documents set status = 'substituido', substituido_em = now() where id = ${d.id}`)).rejects.toSatisfy(negadoPor('substituição só com a retificação assinada'));
    await retificacaoAssinadaNoBanco(app.db, T.ctx, p.id, { id: d.id, versao: 1 }, { substituir: false });
```

e renomear o teste para `'substituído (RN-146, testado por SQL): assinado → substituido só com substituido_em e a retificação assinada; depois só solta o base e as fotos'`.

Em `src/db/documentos-schema.test.ts`, no teste `'CHECKs: … tipo só receita no Plano 10A'`, o INSERT com tipo `'parecer'` passa a ser aceito pela 0104: trocar `'parecer'` por `'atestado'` nessa linha e renomear o teste para `'CHECKs: código só fora do rascunho e no formato Crockford; emitido sem PDF recusado; tipo só receita e parecer (Plano 13)'`.

- [ ] **Step 6: Rodar os testes de banco**

Run: `pnpm vitest run src/db/documentos-versoes.test.ts src/db/documentos-imutaveis.test.ts src/db/documentos-schema.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts`
Expected: PASS. O `test/isolamento.test.ts` não muda (desvio 11): as fábricas inserem versão 1 sem `retifica_id` (livre no gatilho novo) e as notas sem motivo; os casos da retificação entre consultórios e entre pacientes ficam em `documentos-versoes.test.ts`.

Deploy (D-P8): a 0104 só acrescenta uma coluna anulável e troca CHECKs; o `nutri_worker` novo que subir antes de ela terminar recebe `42703` na leitura da nota e na exportação até o fim da migration — aceito (retry do pg-boss); registrar no PR.

- [ ] **Step 7: CLAUDE.md, regra 8**

Na frase das listas de documentos assinados ("devolvem só tipo, data, situação, tipo de assinatura e recibos"), acrescentar "e versão" (T3 e T5 devolvem `versao`; testes das chaves) e, no fim da regra 8, depois dessa frase, acrescentar:

"Retificação (Plano 13, 0105): o INSERT de uma versão nova passa pelo gatilho `app_documento_versao` (só em rascunho, só da versão em vigor, mesmo tipo, versão seguinte); a ida a `substituido` só com a retificação já assinada, o cancelamento só sem retificação em andamento e o preparo de uma retificação só com `motivo_retificacao` (coluna de `signed_document_notes`, STAFF_ONLY, limpa pela `app_anonimizar_documentos`); a ordem de travas é paciente → original → versão nova → tenant (`travarDocumentoAntesDaCota`)."

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/documentos.ts drizzle/0104_parecer.sql drizzle/0105_parecer_regras.sql drizzle/meta src/db/documentos-versoes.test.ts \
  src/db/documentos-imutaveis.test.ts src/db/documentos-schema.test.ts test/documentos.ts CLAUDE.md
git commit -m "feat(documentos): parecer e retificação no banco — tipo, motivo, versão nova conferida, substituir/cancelar/preparar (P13-01)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 2: Constantes, textos e o esquema do parecer (sem banco) (P13-02)

**Revisão: completa (agente normas-cfn-lgpd)** — declaração e ressalva do parecer (D5), o que a cópia guarda (Q13-2 ★), textos da retificação e da versão.

**Files:**
- Modify: `src/modules/documentos/constantes.ts`, `src/modules/documentos/perfil-profissional.ts` (tipo `CopiaDoDocumento`), `src/modules/documentos/prescricao.ts` (`ConteudoReceita.copia`)
- Create: `src/modules/documentos/parecer.ts`, `src/modules/documentos/parecer.test.ts`

**Interfaces:**
- Consumes: `DocumentoError` (`erros.ts`), `CopiaProfissional` (`perfil-profissional.ts`), `ConteudoReceita` (`prescricao.ts`).
- Produces: o que está em "Contratos entre tarefas" para `constantes.ts`, `perfil-profissional.ts` e `parecer.ts`.

- [ ] **Step 1: O teste que falha**

Criar `src/modules/documentos/parecer.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DECLARACAO_PARECER, DECLARACAO_POR_TIPO, DECLARACAO_RECEITA, linhaDaVersao, MSG_RETIFICACAO, RESSALVA_PARECER, rotuloDaVersao, TIPO_DOCUMENTO_COM_ARTIGO, TIPO_DOCUMENTO_ROTULO } from './constantes';
import { DocumentoError } from './erros';
import { linhaDoValor, mesmoExame, MSG_PARECER, rotuloDoExame, validarParecerParaPreparar, validarRascunhoParecer, type ConteudoParecer, type ExameCopiado } from './parecer';

const erroEm = (campo: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[campo] === msg;
/** O erro lançado (o teste falha se nada for lançado). */
const erroDe = (f: () => unknown): unknown => {
  try {
    f();
  } catch (e) {
    return e;
  }
  throw new Error('não lançou');
};
const exame = (o: Partial<ExameCopiado> = {}): ExameCopiado => ({ id: randomUUID(), data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16' }], ...o });
const parecer = (o: Partial<ConteudoParecer> = {}): ConteudoParecer => ({ versao: 1, tipo: 'parecer', exames: [exame()], avaliacao: 'Marcadores compatíveis com baixa reserva de ferro.', conduta: '', encaminhamentos: '', ...o });

describe('textos do parecer e da retificação (spec v0.5, D5, US-148, Q13-5)', () => {
  it('rótulos, declaração e ressalva (D5, rascunho até a Debby e o CRN-3)', () => {
    expect(TIPO_DOCUMENTO_ROTULO).toEqual({ receita: 'Receita', parecer: 'Parecer nutricional' });
    expect(TIPO_DOCUMENTO_COM_ARTIGO).toEqual({ receita: 'da receita', parecer: 'do parecer nutricional' });
    expect(DECLARACAO_PARECER).toBe('Declaro que este parecer não afirma diagnóstico de doença nem prescreve medicamento.');
    expect(RESSALVA_PARECER).toBe('Este parecer trata do estado nutricional e não constitui diagnóstico de doença nem substitui avaliação médica.');
    expect(DECLARACAO_POR_TIPO).toEqual({ receita: DECLARACAO_RECEITA, parecer: DECLARACAO_PARECER });
    expect(rotuloDaVersao(2)).toBe('Versão 2');
    expect(linhaDaVersao(2, 'ABCD-EFGH-JKMN')).toBe('Versão 2 — substitui o documento ABCD-EFGH-JKMN');
    expect(MSG_RETIFICACAO.motivo).toBe('Escreva o motivo da retificação (até 500 caracteres).');
    expect(MSG_RETIFICACAO.emAndamento(2)).toBe('Há uma retificação em andamento (versão 2). Conclua ou apague a retificação antes de cancelar.');
  });

  it('linhas do exame e do valor (PDF e painel); sem a origem da IA (Q13-2 ★)', () => {
    expect(rotuloDoExame({ titulo: 'Hemograma', data: '2026-09-01' })).toBe('Hemograma — 01/09/2026');
    expect(linhaDoValor({ nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null, iaTarefaId: randomUUID() })).toBe('Ferritina · 12 · ng/mL · —');
    expect(linhaDoValor({ nome: 'Glicose', valor: 92.5, unidade: null, referencia: '70 a 99' })).toBe('Glicose · 92,5 · — · 70 a 99');
    expect(MSG_PARECER.exameExcluidoDepois('Hemograma — 01/09/2026')).toBe('O exame Hemograma — 01/09/2026 foi excluído depois do parecer.');
  });
});

describe('validarRascunhoParecer (US-141, D-P4)', () => {
  it('aceita o rascunho incompleto; tira ids repetidos; normaliza a quebra de linha do navegador (\\r\\n) antes de contar', () => {
    const id = randomUUID();
    expect(validarRascunhoParecer({})).toEqual({ exameIds: [], avaliacao: '', conduta: '', encaminhamentos: '' });
    const r = validarRascunhoParecer({ exameIds: [id, id], avaliacao: `  a\r\nb  `, conduta: 'c', encaminhamentos: 'e' });
    expect(r).toEqual({ exameIds: [id], avaliacao: 'a\nb', conduta: 'c', encaminhamentos: 'e' });
    // 2499 × "x\n" (4998) + "xx" = 5000 depois da troca do \r\n: cabe
    expect(() => validarRascunhoParecer({ avaliacao: 'x\r\n'.repeat(2499) + 'xx' })).not.toThrow();
  });

  it('os máximos valem no salvar: 20 exames, 5000/5000/1000 caracteres; id que não é uuid = exame que não existe', () => {
    expect(erroDe(() => validarRascunhoParecer({ exameIds: Array.from({ length: 21 }, () => randomUUID()) }))).toSatisfy(erroEm('exames', MSG_PARECER.examesDemais));
    const e = erroDe(() => validarRascunhoParecer({ avaliacao: 'x'.repeat(5001), conduta: 'x'.repeat(5001), encaminhamentos: 'x'.repeat(1001), exameIds: ['1; drop table exams'] }));
    expect(e).toSatisfy(erroEm('avaliacao', 'Escreva a avaliação nutricional (até 5000 caracteres).'));
    expect(e).toSatisfy(erroEm('conduta', 'Use no máximo 5000 caracteres.'));
    expect(e).toSatisfy(erroEm('encaminhamentos', 'Use no máximo 1000 caracteres.'));
    expect(e).toSatisfy(erroEm('exames', 'Um dos exames selecionados foi excluído. Revise a seleção.'));
  });
});

describe('validarParecerParaPreparar (US-141, RN-148)', () => {
  it('exige ao menos um exame e a avaliação; aceita conduta e encaminhamentos vazios', () => {
    expect(erroDe(() => validarParecerParaPreparar(parecer({ exames: [] })))).toSatisfy(erroEm('exames', 'Selecione ao menos um exame.'));
    expect(erroDe(() => validarParecerParaPreparar(parecer({ avaliacao: '   ' })))).toSatisfy(erroEm('avaliacao', 'Escreva a avaliação nutricional (até 5000 caracteres).'));
    expect(() => validarParecerParaPreparar(parecer())).not.toThrow();
  });
});

describe('mesmoExame (RN-148 v0.5: título, data e linhas; a origem não conta)', () => {
  it('igual; linha acrescentada (IA); data trocada; título trocado; valor diferente', () => {
    const e = exame();
    expect(mesmoExame(e, { ...e, valores: e.valores.map((v) => ({ ...v, iaTarefaId: randomUUID() })) })).toBe(true);
    expect(mesmoExame(e, { ...e, valores: [...e.valores, { nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null }] })).toBe(false);
    expect(mesmoExame(e, { ...e, data: '2026-09-02' })).toBe(false);
    expect(mesmoExame(e, { ...e, titulo: 'Hemograma completo' })).toBe(false);
    expect(mesmoExame(e, { ...e, valores: [{ ...e.valores[0], valor: 13.6 }] })).toBe(false);
  });
});
```

Run: `pnpm vitest run src/modules/documentos/parecer.test.ts`
Expected: FAIL (`./parecer` não existe).

- [ ] **Step 2: As constantes**

Em `src/modules/documentos/constantes.ts` (o arquivo continua **sem imports**), trocar a linha de `TIPO_DOCUMENTO_ROTULO` por:

```ts
/** Plano 13: o parecer nutricional (F3-05) ao lado da receita. "Receita" no banco e na tela (D16 do 10A). */
export const TIPO_DOCUMENTO_ROTULO = { receita: 'Receita', parecer: 'Parecer nutricional' } as const;
export type TipoDocumento = keyof typeof TIPO_DOCUMENTO_ROTULO;
/** Leitor de tela no portal ("Abrir PDF da receita de …", "Abrir PDF do parecer nutricional de …"): o artigo muda com o tipo. */
export const TIPO_DOCUMENTO_COM_ARTIGO: Record<TipoDocumento, string> = { receita: 'da receita', parecer: 'do parecer nutricional' };
```

e, depois de `DECLARACAO_RECEITA`:

```ts
/** D5 da spec (RASCUNHO até a revisão da Debby e a consulta ao CRN-3, P-B1): a declaração ao preparar o parecer (RN-148). */
export const DECLARACAO_PARECER = 'Declaro que este parecer não afirma diagnóstico de doença nem prescreve medicamento.';
/** D5 da spec (RASCUNHO, como a declaração): a ressalva fixa impressa no PDF do parecer (§3.1). */
export const RESSALVA_PARECER = 'Este parecer trata do estado nutricional e não constitui diagnóstico de doença nem substitui avaliação médica.';
export const DECLARACAO_POR_TIPO: Record<TipoDocumento, string> = { receita: DECLARACAO_RECEITA, parecer: DECLARACAO_PARECER };

/** Q13-5 ★ (proposto na spec v0.5): a versão no portal e no link ("Versão 2") e no PDF e no painel (a linha abaixo do título). */
export const rotuloDaVersao = (versao: number): string => `Versão ${versao}`;
export const linhaDaVersao = (versao: number, codigoAnterior: string): string => `Versão ${versao} — substitui o documento ${codigoAnterior}`;
/** US-148 / Q13-1 ★ e US-149 (texto exato da spec v0.5). */
export const MSG_RETIFICACAO = {
  motivo: 'Escreva o motivo da retificação (até 500 caracteres).',
  emAndamento: (versao: number) => `Há uma retificação em andamento (versão ${versao}). Conclua ou apague a retificação antes de cancelar.`,
} as const;
```

- [ ] **Step 3: A cópia comum aos dois tipos**

Em `src/modules/documentos/perfil-profissional.ts`, logo abaixo de `CopiaProfissional`:

```ts
/**
 * RN-154: a cópia congelada no preparo, igual nos dois tipos. Plano 13: `retificacao` (a versão e o código da versão que
 * esta substitui) entra no preparo de uma versão nova, para o PDF imprimir "Versão {n} — substitui o documento {código}".
 */
export type CopiaDoDocumento = { profissional: CopiaProfissional; paciente: { nome: string }; retificacao?: { versao: number; substitui: string } };
```

Em `src/modules/documentos/prescricao.ts`, trocar o import de tipo por `import type { CopiaDoDocumento } from './perfil-profissional';` (se `CopiaProfissional` ainda for usado no arquivo, importar os dois) e, em `ConteudoReceita`, `copia?: { profissional: CopiaProfissional; paciente: { nome: string } };` por `copia?: CopiaDoDocumento;`.

- [ ] **Step 4: O esquema do parecer**

Criar `src/modules/documentos/parecer.ts`:

```ts
import { z } from 'zod';
import { DocumentoError } from './erros';
import type { CopiaDoDocumento } from './perfil-profissional';
import type { ConteudoReceita } from './prescricao';

/**
 * Plano 13 — parecer nutricional (F3-05, US-141, RN-148). Sem imports do servidor: o formulário 'use client' e o PDF do
 * worker leem daqui (como prescricao.ts). A cópia dos exames (RN-154) é refeita a cada salvamento do rascunho e no preparo;
 * do preparo em diante o `conteudo` inteiro é fixo (gatilho, RN-140).
 */
export const PARECER_MAX_EXAMES = 20;
export const AVALIACAO_MAX = 5000;
export const CONDUTA_MAX = 5000;
export const ENCAMINHAMENTOS_MAX = 1000;

/** US-141 (texto exato da spec v0.5; os marcados "proposto" na spec vão à Debby). */
export const MSG_PARECER = {
  semExame: 'Selecione ao menos um exame.',
  examesDemais: 'Selecione no máximo 20 exames.',
  avaliacao: 'Escreva a avaliação nutricional (até 5000 caracteres).',
  conduta: 'Use no máximo 5000 caracteres.',
  encaminhamentos: 'Use no máximo 1000 caracteres.',
  /** proposto na spec v0.5 (exame excluído na seleção de um rascunho) */
  exameExcluido: 'Um dos exames selecionados foi excluído. Revise a seleção.',
  semValores: 'laudo no prontuário, sem valores lançados',
  valoresMudaram: 'Os valores deste exame mudaram depois do parecer.',
  /** proposto na spec v0.5 */
  exameExcluidoDepois: (exame: string) => `O exame ${exame} foi excluído depois do parecer.`,
} as const;
/** Texto novo (cabeçalho da tabela dos valores no PDF; vai à Debby). */
export const CABECALHO_VALORES = 'Marcador · Valor · Unidade · Referência';

/** Uma linha de `exams.valores` como estava (US-015). `iaTarefaId` (Plano 11) fica só na cópia e na exportação (Q13-2 ★). */
export type ValorCopiado = { nome: string; valor: number; unidade: string | null; referencia: string | null; iaTarefaId?: string };
/** O exame na cópia: nunca o arquivo do laudo (RN-148). `enviadoPeloPaciente`: veio de um envio aceito (Plano 12; Q13-2 ★). */
export type ExameCopiado = { id: string; data: string; titulo: string; valores: ValorCopiado[]; enviadoPeloPaciente?: true };
export type ConteudoParecer = {
  versao: 1;
  tipo: 'parecer';
  exames: ExameCopiado[];
  avaliacao: string;
  conduta: string;
  encaminhamentos: string;
  /** RN-154: a cópia congelada no preparo. */
  copia?: CopiaDoDocumento;
  /** D5: o texto da declaração confirmada no preparo. */
  declaracao?: string;
};
export type ConteudoDocumento = ConteudoReceita | ConteudoParecer;

/** O navegador manda a quebra de linha do <textarea> como \r\n: normalizar antes de contar (o maxLength da tela conta 1). */
const texto = (max: number, msg: string) =>
  z.string().optional().transform((s) => (s ?? '').replace(/\r\n?/g, '\n').trim()).pipe(z.string().max(max, msg));
const rascunho = z.object({
  // G5: z.guid() aceita o mesmo formato do tipo uuid do Postgres (z.uuid() exige a versão RFC), como src/app/admin/actions.ts:19
  exameIds: z.array(z.guid({ message: MSG_PARECER.exameExcluido }), { message: MSG_PARECER.exameExcluido }).max(PARECER_MAX_EXAMES, MSG_PARECER.examesDemais).default([]),
  avaliacao: texto(AVALIACAO_MAX, MSG_PARECER.avaliacao),
  conduta: texto(CONDUTA_MAX, MSG_PARECER.conduta),
  encaminhamentos: texto(ENCAMINHAMENTOS_MAX, MSG_PARECER.encaminhamentos),
});
export type RascunhoParecer = z.output<typeof rascunho>;

/** D-P4: o rascunho aceita 0 exames e avaliação vazia; os máximos valem já no salvar. Erros de `exameIds.*` vão para `exames`. */
export function validarRascunhoParecer(input: unknown): RascunhoParecer {
  const p = rascunho.safeParse(input ?? {});
  if (!p.success) {
    const e: Record<string, string> = {};
    for (const i of p.error.issues) e[i.path[0] === 'exameIds' ? 'exames' : String(i.path[0] ?? 'geral')] ??= i.message;
    throw new DocumentoError(e);
  }
  return { ...p.data, exameIds: [...new Set(p.data.exameIds)] };
}

/** US-141 / RN-148: para preparar, 1 a 20 exames e a avaliação. */
export function validarParecerParaPreparar(c: ConteudoParecer): void {
  const e: Record<string, string> = {};
  if (!c.exames.length) e.exames = MSG_PARECER.semExame;
  else if (c.exames.length > PARECER_MAX_EXAMES) e.exames = MSG_PARECER.examesDemais;
  if (!c.avaliacao.trim()) e.avaliacao = MSG_PARECER.avaliacao;
  if (Object.keys(e).length) throw new DocumentoError(e);
}

const linhas = (vs: readonly ValorCopiado[]) => JSON.stringify(vs.map((v) => [v.nome, v.valor, v.unidade ?? null, v.referencia ?? null]));
/** RN-148 v0.5: "o exame mudou" = título, data ou linhas diferentes (linhas da IA acrescentadas, data trocada); a origem não conta. */
export function mesmoExame(copia: Pick<ExameCopiado, 'data' | 'titulo' | 'valores'>, atual: Pick<ExameCopiado, 'data' | 'titulo' | 'valores'>): boolean {
  return copia.titulo === atual.titulo && copia.data === atual.data && linhas(copia.valores) === linhas(atual.valores);
}

const dataBr = (iso: string) => {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
};
/** "Hemograma — 01/09/2026" (US-141). */
export const rotuloDoExame = (e: { titulo: string; data: string }): string => `${e.titulo} — ${dataBr(e.data)}`;
/** A linha da tabela do PDF e do painel: marcador · valor · unidade · referência (vírgula decimal; "—" no que falta). */
export const linhaDoValor = (v: ValorCopiado): string => [v.nome, String(v.valor).replace('.', ','), v.unidade ?? '—', v.referencia ?? '—'].join(' · ');
```

- [ ] **Step 5: Rodar**

Run: `pnpm vitest run src/modules/documentos/parecer.test.ts src/modules/documentos/prescricao.test.ts && pnpm typecheck`
Expected: PASS (nenhum outro arquivo usa ainda os tipos novos; `ConteudoReceita.copia` continua com a mesma forma).

- [ ] **Step 6: Commit**

```bash
git add src/modules/documentos/constantes.ts src/modules/documentos/perfil-profissional.ts src/modules/documentos/prescricao.ts \
  src/modules/documentos/parecer.ts src/modules/documentos/parecer.test.ts
git commit -m "feat(documentos): textos e esquema do parecer nutricional, versão e retificação (P13-02)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 3: O módulo do parecer — criar, salvar com a cópia dos exames, preparar por tipo, situação dos exames, lista com versão (P13-03)

**Revisão: completa (agente revisor-rls)** — leitura de `exams`/`exam_submissions` por paciente dentro do `withTenant` (regra 1), cópia congelada (RN-148/154), `auditRead` (regra 8), chaves da lista.

**Files:**
- Create: `src/modules/documentos/parecer-exames.ts`, `src/modules/documentos/parecer-documentos.test.ts`
- Modify: `src/modules/documentos/documentos.ts`, `src/modules/documentos/documentos.test.ts` (chaves da lista com `versao`; fixture `base` com `versao: 1`), `src/modules/documentos/entrega.test.ts` (fixture com `versao: 1`), `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx` (só o estreitamento do tipo: a página da receita continua igual)

**Interfaces:**
- Consumes: `exams`, `examSubmissions` (`@/db/schema`), `carregarPacienteParaEscrita`, `idValido`; da T2: `validarRascunhoParecer`, `validarParecerParaPreparar`, `mesmoExame`, `ConteudoParecer`, `ConteudoDocumento`, `ExameCopiado`, `MSG_PARECER`, `DECLARACAO_POR_TIPO`, `TipoDocumento`.
- Produces: `copiarExames`, `situacaoDosExames`, `SituacaoExame`; `criarParecer`, `salvarRascunhoParecer`; `prepararParaAssinatura` por tipo; `ItemLista.tipo: TipoDocumento` e `ItemLista.versao`; `DocumentoLido.conteudo: ConteudoDocumento`.

- [ ] **Step 1: O teste que falha**

Criar `src/modules/documentos/parecer-documentos.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { envioNoBanco } from '../../../test/exames-enviados';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { exams, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { criarExame, excluirExame } from '@/modules/pacientes/exames';
import { DECLARACAO_PARECER } from './constantes';
import { criarParecer, criarReceita, lerDocumento, listarDocumentos, prepararParaAssinatura, salvarRascunhoParecer, salvarRascunhoReceita } from './documentos';
import { DocumentoError, TransicaoInvalidaError } from './erros';
import { situacaoDosExames } from './parecer-exames';
import type { ConteudoParecer } from './parecer';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss(); // prepararParaAssinatura enfileira o PDF
  await app.pool.end();
});
const FUSO = { fuso: 'America/Sao_Paulo' };
const erroEm = (campo: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[campo] === msg;

async function consultorio() {
  const T = await novoTenant(app.db);
  await app.db.update(tenants).set({ crn: 'CRN-3 12345', nomeProfissional: 'Débora Silva Santos', contatoEmail: 'debby@consultorio.com', contatoTelefoneE164: '+5511912345678', documentosLiberados: true }).where(eq(tenants.id, T.tenantId));
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  return { T, tenant: tenant as TenantRow };
}
const hemograma = (ctx: TenantContext, patientId: string, valores: unknown[] = [{ nome: 'Hemoglobina', valor: '13,5', unidade: 'g/dL', referencia: '12 a 16' }]) =>
  criarExame(ctx, FUSO, patientId, { titulo: 'Hemograma', data: '2026-09-01', valores, arquivo: null }, { db: app.db, now: new Date('2026-10-01T15:00:00Z') });
const conteudo = async (ctx: TenantContext, patientId: string, id: string) => (await lerDocumento(ctx, patientId, id, app.db))!.conteudo as ConteudoParecer;

describe('parecer nutricional — rascunho (US-141, RN-148)', () => {
  it('"Novo parecer nutricional": rascunho do tipo parecer, versão 1; a lista só com as chaves de ItemLista (sem exames nem avaliação)', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const id = await criarParecer(T.ctx, p.id, { db: app.db });
    const lista = await listarDocumentos(T.ctx, p.id, app.db);
    expect(lista).toMatchObject([{ id, tipo: 'parecer', versao: 1, status: 'rascunho' }]);
    expect(Object.keys(lista[0]).sort()).toEqual(['assinadoEm', 'assinaturaTipo', 'codigo', 'createdAt', 'entregueEm', 'id', 'pdfStatus', 'recibos', 'status', 'tipo', 'versao']);
  });

  it('salvar copia os exames escolhidos (id, data, título e linhas, com a origem só na cópia — Q13-2 ★); nada do laudo', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const comValores = await hemograma(T.ctx, p.id);
    const soLaudo = await criarExame(T.ctx, FUSO, p.id, { titulo: 'Perfil lipídico', data: '2026-08-20', valores: [], arquivo: null }, { db: app.db, now: new Date('2026-10-01T15:00:00Z') });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito', examId: soLaudo });
    const ia = randomUUID();
    await withTenant(T.ctx, (tx) => tx.update(exams).set({ valores: sql`valores || ${JSON.stringify([{ nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null, iaTarefaId: ia }])}::jsonb` }).where(eq(exams.id, comValores)), app.db);
    const id = await criarParecer(T.ctx, p.id, { db: app.db });
    await salvarRascunhoParecer(T.ctx, p.id, id, { conteudo: { exameIds: [comValores, soLaudo], avaliacao: 'Baixa reserva de ferro.' } }, { db: app.db });
    const c = await conteudo(T.ctx, p.id, id);
    expect(c.exames).toEqual([
      { id: comValores, data: '2026-09-01', titulo: 'Hemograma', valores: [
        { nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16' },
        { nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null, iaTarefaId: ia },
      ] },
      { id: soLaudo, data: '2026-08-20', titulo: 'Perfil lipídico', valores: [], enviadoPeloPaciente: true },
    ]);
    expect(JSON.stringify(c)).not.toContain('arquivo');
  });

  it('a cópia é refeita a cada salvamento (linhas acrescentadas pela IA entram no rascunho)', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const e = await hemograma(T.ctx, p.id);
    const id = await criarParecer(T.ctx, p.id, { db: app.db });
    const salvar = () => salvarRascunhoParecer(T.ctx, p.id, id, { conteudo: { exameIds: [e], avaliacao: 'x' } }, { db: app.db });
    await salvar();
    await withTenant(T.ctx, (tx) => tx.update(exams).set({ valores: sql`valores || '[{"nome":"Ferritina","valor":12,"unidade":"ng/mL","referencia":null}]'::jsonb` }).where(eq(exams.id, e)), app.db);
    await salvar();
    expect((await conteudo(T.ctx, p.id, id)).exames[0].valores.map((v) => v.nome)).toEqual(['Hemoglobina', 'Ferritina']);
  });

  it('exame de outro paciente, de outro consultório ou excluído: "Um dos exames selecionados foi excluído. Revise a seleção." e nada gravado', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const doOutro = await hemograma(T.ctx, outro.id);
    const B = await consultorio();
    const pb = await novoPaciente(app.db, B.T.ctx);
    const deOutroConsultorio = await hemograma(B.T.ctx, pb.id);
    const id = await criarParecer(T.ctx, p.id, { db: app.db });
    for (const alheio of [doOutro, deOutroConsultorio, randomUUID()])
      await expect(salvarRascunhoParecer(T.ctx, p.id, id, { conteudo: { exameIds: [alheio], avaliacao: 'x' } }, { db: app.db })).rejects.toSatisfy(erroEm('exames', 'Um dos exames selecionados foi excluído. Revise a seleção.'));
    expect((await conteudo(T.ctx, p.id, id)).exames).toEqual([]);
  });

  it('receita e parecer não se misturam: o salvar de um tipo recusa o documento do outro', async () => {
    const { T, tenant } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const r = await criarReceita(T.ctx, p.id, { db: app.db });
    const pa = await criarParecer(T.ctx, p.id, { db: app.db });
    await expect(salvarRascunhoParecer(T.ctx, p.id, r, { conteudo: {} }, { db: app.db })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    await expect(salvarRascunhoReceita(T.ctx, tenant, p.id, pa, { conteudo: {}, justificativa: '' }, { db: app.db })).rejects.toBeInstanceOf(TransicaoInvalidaError);
  });

  it('paciente bloqueado: "Paciente bloqueado por pedido de exclusão…" (nada é criado)', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(criarParecer(T.ctx, p.id, { db: app.db })).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
});

describe('parecer nutricional — preparar e congelar (US-141, US-143, RN-148, RN-154)', () => {
  it('preparar exige exame e avaliação; congela a cópia com a declaração do parecer; depois disso a situação dos exames aparece', async () => {
    const { T, tenant } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const e = await hemograma(T.ctx, p.id);
    const id = await criarParecer(T.ctx, p.id, { db: app.db });
    await expect(prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy(erroEm('exames', 'Selecione ao menos um exame.'));
    await salvarRascunhoParecer(T.ctx, p.id, id, { conteudo: { exameIds: [e], avaliacao: '' } }, { db: app.db });
    await expect(prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy(erroEm('avaliacao', 'Escreva a avaliação nutricional (até 5000 caracteres).'));
    await salvarRascunhoParecer(T.ctx, p.id, id, { conteudo: { exameIds: [e], avaliacao: 'Baixa reserva de ferro.' } }, { db: app.db });
    // a IA acrescenta uma linha entre o salvar e o preparar: a cópia do preparo é a última (RN-148, "por último, ao preparar")
    await withTenant(T.ctx, (tx) => tx.update(exams).set({ valores: sql`valores || '[{"nome":"Ferritina","valor":12,"unidade":"ng/mL","referencia":null}]'::jsonb` }).where(eq(exams.id, e)), app.db);
    await prepararParaAssinatura(T.ctx, tenant, p.id, id, { declaracao: 'on' }, { db: app.db });
    const d = (await lerDocumento(T.ctx, p.id, id, app.db))!;
    const c = d.conteudo as ConteudoParecer;
    expect(d.status).toBe('preparando');
    expect(c.declaracao).toBe(DECLARACAO_PARECER);
    expect(c.copia).toMatchObject({ paciente: { nome: 'Ana Souza' }, profissional: { nomeCompleto: 'Débora Silva Santos' } });
    expect(c.exames[0].valores.map((v) => v.nome)).toEqual(['Hemoglobina', 'Ferritina']);
    expect(await situacaoDosExames(T.ctx, p.id, c.exames, app.db)).toEqual({ [e]: 'igual' });
    // depois do preparo: o exame muda (data trocada pela IA) → "mudou"; a cópia não muda (gatilho)
    await withTenant(T.ctx, (tx) => tx.update(exams).set({ data: '2026-09-02' }).where(eq(exams.id, e)), app.db);
    expect(await situacaoDosExames(T.ctx, p.id, c.exames, app.db)).toEqual({ [e]: 'mudou' });
    expect(((await lerDocumento(T.ctx, p.id, id, app.db))!.conteudo as ConteudoParecer).exames[0].data).toBe('2026-09-01');
    // o exame excluído → "excluido"; o parecer continua com a cópia
    expect(await excluirExame(T.ctx, p.id, e, { db: app.db })).toBe(true);
    expect(await situacaoDosExames(T.ctx, p.id, c.exames, app.db)).toEqual({ [e]: 'excluido' });
  });

  it('situacaoDosExames não grava auditoria nem devolve valores (D-P2); de outro paciente, o exame aparece como excluído', async () => {
    const { T } = await consultorio();
    const p = await novoPaciente(app.db, T.ctx);
    const outro = await novoPaciente(app.db, T.ctx);
    const e = await hemograma(T.ctx, p.id);
    const copia = [{ id: e, data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16' }] }];
    expect(await situacaoDosExames(T.ctx, outro.id, copia, app.db)).toEqual({ [e]: 'excluido' });
    const audit = await withTenant(T.ctx, (tx) => tx.execute(sql`select 1 from audit_log where acao = 'ler' and entidade = 'exames' and patient_id = ${p.id}`), app.db);
    expect(audit.rows).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/modules/documentos/parecer-documentos.test.ts`
Expected: FAIL (`criarParecer`, `salvarRascunhoParecer` e `./parecer-exames` não existem).

- [ ] **Step 2: A cópia e a situação dos exames**

Criar `src/modules/documentos/parecer-exames.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { examSubmissions, exams } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { idValido } from '@/modules/pacientes/base';
import { DocumentoError } from './erros';
import { mesmoExame, MSG_PARECER, type ExameCopiado } from './parecer';

/**
 * RN-148 / RN-154 (Plano 13): a cópia dos exames escolhidos, na transação de quem chama (salvar o rascunho e, por último,
 * o preparo). Só exames do PRÓPRIO paciente (filtro por `patient_id` dentro do withTenant da nutricionista, regra 1): um id
 * de outro paciente, de outro consultório ou excluído é "Um dos exames selecionados foi excluído." e nada é gravado.
 * Copia data, título e as linhas de `valores` como estão (a origem `iaTarefaId` vai junto; Q13-2 ★) e marca o exame que veio
 * de um envio aceito do paciente (Plano 12); NUNCA o laudo (`arquivo_path`). Sem auditRead: nada é devolvido à tela aqui —
 * a seleção do editor já passou por listarExames (auditada).
 */
export async function copiarExames(tx: Tx, patientId: string, ids: readonly string[]): Promise<ExameCopiado[]> {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return [];
  const rs = await tx
    .select({ id: exams.id, data: exams.data, titulo: exams.titulo, valores: exams.valores })
    .from(exams)
    .where(and(eq(exams.patientId, patientId), inArray(exams.id, unicos)));
  if (rs.length !== unicos.length) throw new DocumentoError({ exames: MSG_PARECER.exameExcluido });
  const doApp = new Set(
    (await tx.select({ e: examSubmissions.examId }).from(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), inArray(examSubmissions.examId, unicos)))).map((r) => r.e),
  );
  const porId = new Map(rs.map((r) => [r.id, r]));
  return unicos.map((id) => {
    const e = porId.get(id)!;
    return {
      id,
      data: e.data,
      titulo: e.titulo,
      valores: e.valores.map((v) => ({ nome: v.nome, valor: v.valor, unidade: v.unidade, referencia: v.referencia, ...(v.iaTarefaId ? { iaTarefaId: v.iaTarefaId } : {}) })),
      ...(doApp.has(id) ? { enviadoPeloPaciente: true as const } : {}),
    };
  });
}

export type SituacaoExame = 'igual' | 'mudou' | 'excluido';

/**
 * RN-148 v0.5: a tela do parecer compara a cópia guardada com o exame atual (mesmo id: título, data e linhas), sem gravar
 * nada. Devolve só a situação por id da cópia — nenhum valor sai daqui (D-P2: sem auditRead; a página já audita a leitura
 * do documento). Exame de outro paciente (id forjado) conta como excluído.
 */
export async function situacaoDosExames(ctx: TenantContext, patientId: string, copia: readonly ExameCopiado[], db: Db = getDb()): Promise<Record<string, SituacaoExame>> {
  if (!copia.length || !idValido(patientId)) return {};
  return withTenant(
    ctx,
    async (tx) => {
      const atuais = await tx
        .select({ id: exams.id, data: exams.data, titulo: exams.titulo, valores: exams.valores })
        .from(exams)
        .where(and(eq(exams.patientId, patientId), inArray(exams.id, copia.map((e) => e.id))));
      const porId = new Map(atuais.map((a) => [a.id, a]));
      return Object.fromEntries(copia.map((e) => {
        const a = porId.get(e.id);
        return [e.id, !a ? 'excluido' : mesmoExame(e, a) ? 'igual' : 'mudou'] as const;
      }));
    },
    db,
  );
}
```

- [ ] **Step 3: Os dois tipos em `documentos.ts`**

Em `src/modules/documentos/documentos.ts`:

1. Imports: trocar `DECLARACAO_RECEITA` por `DECLARACAO_POR_TIPO` e acrescentar `type TipoDocumento` no import de `./constantes`; acrescentar `import { copiarExames } from './parecer-exames';` e `import { validarParecerParaPreparar, validarRascunhoParecer, type ConteudoDocumento, type ConteudoParecer } from './parecer';`.
2. Tipos:

```ts
export type ItemLista = {
  id: string; tipo: TipoDocumento; versao: number; status: StatusDocumento; codigo: string | null; createdAt: Date; assinadoEm: Date | null;
  assinaturaTipo: TipoAssinatura | null; pdfStatus: string | null; entregueEm: Date | null; recibos: Recibo[];
};
export type DocumentoLido = ItemLista & {
  conteudo: ConteudoDocumento; justificativa: string | null; motivoCancelamento: string | null; assinanteNome: string | null;
  basePdfPath: string | null; pdfPath: string | null; pdfSha256: string | null; digitalizacaoStatus: string | null; digitalizacaoEm: Date | null;
  anonimizadoEm: Date | null; canceladoEm: Date | null;
};

const CONTEUDO_VAZIO: ConteudoReceita = { versao: 1, tipo: 'receita', itens: [], orientacoes: '' };
const PARECER_VAZIO: ConteudoParecer = { versao: 1, tipo: 'parecer', exames: [], avaliacao: '', conduta: '', encaminhamentos: '' };
```

3. Criar (a receita passa pela mesma função):

```ts
/** US-142 / US-141: o rascunho vazio e a nota (justificativa, motivos: fora do conteúdo, D15 da spec). */
async function criarDocumento(ctx: TenantContext, patientId: string, conteudo: ConteudoDocumento, db: Db): Promise<string> {
  return withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const [d] = await tx.insert(signedDocuments).values({ tenantId: ctx.tenantId, patientId, tipo: conteudo.tipo, conteudo }).returning({ id: signedDocuments.id });
    await tx.insert(signedDocumentNotes).values({ tenantId: ctx.tenantId, patientId, documentoId: d.id });
    return d.id;
  }, db);
}

/** US-142: "Nova receita". */
export const criarReceita = (ctx: TenantContext, patientId: string, deps: { db?: Db } = {}): Promise<string> => criarDocumento(ctx, patientId, CONTEUDO_VAZIO, deps.db ?? getDb());
/** US-141: "Novo parecer nutricional". */
export const criarParecer = (ctx: TenantContext, patientId: string, deps: { db?: Db } = {}): Promise<string> => criarDocumento(ctx, patientId, PARECER_VAZIO, deps.db ?? getDb());
```

(remover a `criarReceita` antiga.)

4. Em `salvarRascunhoReceita`, trocar `await travarDocumento(tx, patientId, docId, ['rascunho']);` por:

```ts
    const d = await travarDocumento(tx, patientId, docId, ['rascunho']);
    if (d.tipo !== 'receita') throw new TransicaoInvalidaError(); // o editor da receita não grava num parecer
```

5. Acrescentar, depois de `salvarRascunhoReceita`:

```ts
/**
 * US-141 "Rascunho salvo." — valida (D-P4: incompleto vale no rascunho) e REFAZ a cópia dos exames escolhidos (RN-148):
 * linhas acrescentadas pela IA ou data trocada entram a cada salvamento. Ordem de travas: paciente → documento.
 */
export async function salvarRascunhoParecer(ctx: TenantContext, patientId: string, docId: string, input: { conteudo: unknown }, deps: { db?: Db } = {}): Promise<void> {
  const r = validarRascunhoParecer(input.conteudo);
  await withTenant(ctx, async (tx) => {
    await carregarPacienteParaEscrita(tx, patientId);
    const d = await travarDocumento(tx, patientId, docId, ['rascunho']);
    if (d.tipo !== 'parecer') throw new TransicaoInvalidaError();
    const exames = await copiarExames(tx, patientId, r.exameIds);
    const conteudo: ConteudoParecer = { versao: 1, tipo: 'parecer', exames, avaliacao: r.avaliacao, conduta: r.conduta, encaminhamentos: r.encaminhamentos };
    await tx.update(signedDocuments).set({ conteudo, updatedAt: new Date() }).where(eq(signedDocuments.id, docId));
  }, deps.db ?? getDb());
}
```

6. Em `prepararParaAssinatura`, trocar o bloco que vai de `const [nota] = …` até `.where(eq(signedDocuments.id, docId));` (o `update` do preparo) por:

```ts
    const [nota] = await tx.select({ j: signedDocumentNotes.justificativaUso }).from(signedDocumentNotes).where(eq(signedDocumentNotes.documentoId, docId));
    const tipo = d.tipo as TipoDocumento;
    let conteudo: ConteudoDocumento;
    if (tipo === 'parecer') {
      const c = d.conteudo as ConteudoParecer;
      validarParecerParaPreparar(c);
      // RN-148: a cópia "por último, ao preparar" — o que a IA acrescentou depois do último salvar entra; excluído → erro
      conteudo = { ...c, exames: await copiarExames(tx, patientId, c.exames.map((e) => e.id)) };
    } else {
      const c = d.conteudo as ConteudoReceita;
      validarParaPreparar(c, nota?.j ?? null, { habilitada: !!tenant.fitoterapiaRegistro });
      conteudo = c;
    }
    await tx
      .update(signedDocuments)
      .set({
        status: 'preparando',
        codigo: gerarCodigo(),
        declaracaoEm: agora,
        conteudo: { ...conteudo, copia: { profissional, paciente: { nome: paciente.nome } }, declaracao: DECLARACAO_POR_TIPO[tipo] },
        pdfStatus: 'pendente',
        pdfPedidoEm: agora,
        updatedAt: agora,
      })
      .where(eq(signedDocuments.id, docId));
```

e o comentário da função: "US-143 / US-141: declaração do tipo (D5) + perfil completo + (receita) justificativa ou (parecer) exames e avaliação → congela a cópia (RN-154; no parecer, a última cópia dos exames, RN-148), gera o código (RN-142) e enfileira o PDF na mesma transação."

7. `comoItem` e `lerDocumentoNaTransacao`:

```ts
const comoItem = (d: typeof signedDocuments.$inferSelect, recibos: Recibo[]): ItemLista => ({
  id: d.id, tipo: d.tipo as TipoDocumento, versao: d.versao, status: d.status as StatusDocumento, codigo: d.codigo, createdAt: d.createdAt, assinadoEm: d.assinadoEm,
  assinaturaTipo: d.assinaturaTipo as TipoAssinatura | null, pdfStatus: d.pdfStatus, entregueEm: d.entregueEm, recibos,
});
```

e, em `lerDocumentoNaTransacao`, `conteudo: d.conteudo as ConteudoDocumento,`.

8. Em `src/modules/documentos/documentos.test.ts`, no teste `'cria o rascunho, salva itens …'`, trocar a lista de chaves esperada por `['assinadoEm', 'assinaturaTipo', 'codigo', 'createdAt', 'entregueEm', 'id', 'pdfStatus', 'recibos', 'status', 'tipo', 'versao']` e o comentário: "D17 / regra 8: a lista não audita porque não devolve conteúdo — só estas chaves (Plano 13: + versão)".

9. Os fixtures que montam `ItemLista` à mão ganham `versao: 1` (sem isso o `pnpm typecheck` do Step 5 falha: o `tsconfig.json` inclui os testes): `src/modules/documentos/documentos.test.ts:196` (`const base: ItemLista = { id: 'x', tipo: 'receita', versao: 1, status: 'rascunho', … }`) e `src/modules/documentos/entrega.test.ts:84` (`const base = { id: randomUUID(), tipo: 'receita' as const, versao: 1, status: 'assinado' as const, … }`, passado a `situacaoDaEntrega`, que recebe `ItemLista`).

- [ ] **Step 4: A página da receita com o tipo estreitado**

Em `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx` (sem mudar nada que a tela mostra para a receita — o parecer ganha tela na T8):

```tsx
import { DECLARACAO_RECEITA, envioEmCurso, podeVoltarAEditar, ROTULO_ASSINATURA, ROTULO_STATUS, TIPO_DOCUMENTO_ROTULO } from '@/modules/documentos/constantes';
```

```tsx
  // Plano 13: o conteúdo é da receita ou do parecer; o anonimizado tem conteudo '{}' (sem tipo)
  const receita = d.conteudo.tipo === 'receita' ? d.conteudo : null;
```

- `<h2 id="documento" className="text-lg font-semibold">Receita</h2>` → `<h2 id="documento" className="text-lg font-semibold">{TIPO_DOCUMENTO_ROTULO[d.tipo]}</h2>`;
- `{d.status === 'rascunho' && !bloqueado && (` → `{d.status === 'rascunho' && !bloqueado && receita && (` e, no `ReceitaForm`, `conteudo={receita}`;
- `{d.status !== 'rascunho' && !anonimizado && (` (o cartão "Itens da receita") → `{d.status !== 'rascunho' && !anonimizado && receita && (`, com `receita.itens.map(…)` no lugar de `(d.conteudo.itens ?? []).map(…)` e `receita.orientacoes` no lugar de `d.conteudo.orientacoes`.

- [ ] **Step 5: Rodar**

Run: `pnpm vitest run src/modules/documentos src/app/painel/pacientes && pnpm typecheck`
Expected: PASS (o resto do módulo ainda lê o conteúdo como `ConteudoReceita` por `as`; a T4 generaliza).

- [ ] **Step 6: Commit**

```bash
git add src/modules/documentos/parecer-exames.ts src/modules/documentos/parecer-documentos.test.ts src/modules/documentos/documentos.ts \
  src/modules/documentos/documentos.test.ts src/modules/documentos/entrega.test.ts "src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx"
git commit -m "feat(documentos): parecer nutricional — rascunho com a cópia dos exames, preparo por tipo e situação dos exames (P13-03)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 4: O PDF do parecer no worker e a digitalizada por tipo (P13-04)

**Revisão: completa (agente revisor-rls)** — arquivos só do worker (regra 9, guarda de grafo), assinatura do parecer pelo mesmo fluxo (D2 = (a)), habilitação só da receita.

**Files:**
- Modify: `src/modules/documentos/documento-pdf.tsx`, `src/modules/documentos/documento-pdf-job.ts`, `src/modules/documentos/digitalizada.ts`, `src/modules/documentos/digitalizada-job.tsx`, `src/modules/documentos/registrar-assinatura.ts` (só `exigirHabilitacaoAtual`)
- Test: `src/modules/documentos/documento-pdf-job.test.ts`, `src/modules/documentos/registrar-assinatura.test.ts`, `src/modules/documentos/digitalizada-job.test.ts`

**Interfaces:**
- Consumes: da T2 `ConteudoDocumento`, `ConteudoParecer`, `MSG_PARECER`, `CABECALHO_VALORES`, `rotuloDoExame`, `linhaDoValor`, `RESSALVA_PARECER`, `TIPO_DOCUMENTO_ROTULO`, `linhaDaVersao`; da T1 `outroDocumento(…, { tipo: 'parecer' })`; `textoDoPdf` (`test/pdf.ts`).
- Produces: `DadosPdfDocumento.conteudo: ConteudoDocumento`; `exigirHabilitacaoAtual(tenant, conteudo: ConteudoDocumento)` (no-op fora da receita).

- [ ] **Step 1: Os testes que falham**

Em `src/modules/documentos/documento-pdf-job.test.ts`, acrescentar `import { paginasDoPdf, textoDoPdf } from '../../../test/pdf';` e:

```ts
const IA_ID = randomUUID();
const parecer = {
  versao: 1, tipo: 'parecer', avaliacao: 'Marcadores compatíveis com baixa reserva de ferro.', conduta: '', encaminhamentos: 'Sugiro avaliação médica.',
  exames: [
    { id: randomUUID(), data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16', iaTarefaId: IA_ID }] },
    { id: randomUUID(), data: '2026-08-20', titulo: 'Perfil lipídico', valores: [], enviadoPeloPaciente: true },
  ],
  copia: conteudo.copia,
};

describe('PDF do parecer (US-141, RN-148, D5)', () => {
  it('título, exames com a tabela ou "(laudo no prontuário, sem valores lançados)", avaliação, encaminhamentos e a ressalva; sem conduta vazia, sem a origem da IA (Q13-2 ★)', async () => {
    const pdf = await renderizarDocumento({ conteudo: parecer as never, codigo: 'ABCDEFGHJKMN', urlVerificacao: 'https://x/v/ABCDEFGHJKMN', data: '01/10/2026', cor: '#0f766e', logo: null, nomeConsultorio: 'Consultório Debby' });
    const t = textoDoPdf(pdf);
    for (const trecho of ['Parecer nutricional', 'Paciente: Ana Souza', 'Data de emissão: 01/10/2026', 'Exames considerados', 'Hemograma', '01/09/2026',
      'Hemoglobina · 13,5 · g/dL · 12 a 16', '(laudo no prontuário, sem valores lançados)', 'Avaliação nutricional', 'Marcadores compatíveis com baixa reserva de ferro.',
      'Encaminhamentos', 'Sugiro avaliação médica.', 'Este parecer trata do estado nutricional', 'não constitui diagnóstico de doença',
      'Assinatura digital', 'Código de verificação: ABCD-EFGH-JKMN'])
      expect(t, trecho).toContain(trecho); // trechos curtos: uma linha quebrada pelo react-pdf perde o espaço no textoDoPdf
    expect(t).not.toContain('Conduta e orientações');
    expect(t).not.toContain(IA_ID); // a origem fica só na cópia (Q13-2 ★)
    expect(t).not.toContain('Receita');
  });

  it('versão nova (copia.retificacao): "Versão 2" e o código da versão anterior abaixo do título (Q13-5 ★, NGS1.01.01)', async () => {
    const pdf = await renderizarDocumento({
      conteudo: { ...parecer, copia: { ...conteudo.copia, retificacao: { versao: 2, substitui: 'ABCDEFGHJKMN' } } } as never,
      codigo: 'NMKJHGFEDCBA', urlVerificacao: 'https://x/v/NMKJHGFEDCBA', data: '02/10/2026', cor: '#0f766e', logo: null, nomeConsultorio: 'Consultório Debby',
    });
    const t = textoDoPdf(pdf);
    expect(t).toContain('Versão 2');
    expect(t).toContain('substitui o documento ABCD-EFGH-JKMN');
  });

  it('exame grande (50 linhas longas, MAX_LINHAS de exames.ts) quebra entre páginas sem perder linha nem invadir o rodapé (revisão do plano)', async () => {
    const valores = Array.from({ length: 50 }, (_, i) => ({ nome: `Marcador ${i + 1} ${'x'.repeat(60)}`, valor: i + 1, unidade: 'mg/dL', referencia: `${'y'.repeat(70)} ${i + 1}` }));
    const grande = { ...parecer, exames: [{ id: randomUUID(), data: '2026-09-01', titulo: 'Painel extenso', valores }] };
    const pdf = await renderizarDocumento({ conteudo: grande as never, codigo: 'ABCDEFGHJKMN', urlVerificacao: 'https://x/v/ABCDEFGHJKMN', data: '01/10/2026', cor: '#0f766e', logo: null, nomeConsultorio: 'Consultório Debby' });
    expect(paginasDoPdf(pdf)).toBeGreaterThanOrEqual(2);
    const t = textoDoPdf(pdf);
    expect(t).toContain('Marcador 1 ');
    expect(t).toContain('Marcador 50');
    expect(t).toContain('Código de verificação: ABCD-EFGH-JKMN');
  });

  it('o job gera o PDF do parecer em preparo e leva a "Aguardando assinatura"', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const id = randomUUID();
    await withTenant(T.ctx, (tx) => tx.execute(sql`insert into signed_documents (id, tenant_id, patient_id, tipo, status, codigo, conteudo, declaracao_em, pdf_status, pdf_pedido_em)
      values (${id}, ${T.tenantId}, ${p.id}, 'parecer', 'preparando', ${codigoAleatorio()}, ${JSON.stringify(parecer)}::jsonb, now(), 'pendente', now())`), app.db);
    const dataDir = await mkdtemp(path.join(tmpdir(), 'docpdf-'));
    expect(await gerarPdfDoDocumento({ tenantId: T.tenantId, documentoId: id }, { db: app.db, dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('pronto');
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status, base_pdf_path from signed_documents where id = ${id}`), app.db)).rows as { status: string; base_pdf_path: string }[];
    expect(d.status).toBe('aguardando_assinatura');
    expect(textoDoPdf(await readFile(path.join(dataDir, d.base_pdf_path)))).toContain('Parecer nutricional');
  });
});
```

Em `src/modules/documentos/registrar-assinatura.test.ts`, acrescentar:

```ts
describe('exigirHabilitacaoAtual (Plano 13): só a receita tem fitoterápico', () => {
  it('parecer e conteúdo anonimizado ({}) passam sem habilitação; a receita com fitoterápico continua recusada', () => {
    const semHabilitacao = { fitoterapiaRegistro: null };
    expect(() => exigirHabilitacaoAtual(semHabilitacao, { versao: 1, tipo: 'parecer', exames: [], avaliacao: 'x', conduta: '', encaminhamentos: '' })).not.toThrow();
    expect(() => exigirHabilitacaoAtual(semHabilitacao, {} as never)).not.toThrow();
    const fito = { tipo: 'fitoterapico', nomenclatura: 'Matricaria recutita L.', parte: 'Flores', extracao: 'Extrato seco', formaFarmaceutica: 'Cápsula', dose: '300 mg', via: 'oral', posologia: '1 ao dia', padronizacao: '', nomePopular: '', duracao: '' };
    expect(() => exigirHabilitacaoAtual(semHabilitacao, { versao: 1, tipo: 'receita', itens: [fito as never], orientacoes: '' })).toThrow(RecusaAssinaturaError);
  });
});
```

Em `src/modules/documentos/digitalizada-job.test.ts`, acrescentar:

```ts
it('D2 = (a): o parecer é assinado pela digitalizada como a receita (consultório sem habilitação em Fitoterapia)', async () => {
  const x = await outroDocumento(await novoConsultorio(app.db), app.db, { tipo: 'parecer' });
  const foto = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  await receberDigitalizada(x.acesso, x.id, [foto], '123456', { db: app.db, dataDir: x.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
  expect(await montarPdfDigitalizado({ tenantId: x.T.tenantId, documentoId: x.id, userId: x.T.nutriId }, { db: app.db, dataDir: x.dataDir, appUrl: 'https://x', ultimaTentativa: false })).toBe('pronto');
  const [d] = (await withTenant(x.T.ctx, (tx) => tx.execute(sql`select status, tipo, assinatura_tipo from signed_documents where id = ${x.id}`), app.db)).rows;
  expect(d).toEqual({ status: 'assinado', tipo: 'parecer', assinatura_tipo: 'digitalizada' });
});
```

Run: `pnpm vitest run src/modules/documentos/documento-pdf-job.test.ts src/modules/documentos/registrar-assinatura.test.ts src/modules/documentos/digitalizada-job.test.ts`
Expected: FAIL (o PDF só sabe desenhar a receita — `c.itens` de um parecer quebra o render; `exigirHabilitacaoAtual` lê `conteudo.itens` de um parecer).

- [ ] **Step 2: O PDF dos dois tipos**

Em `src/modules/documentos/documento-pdf.tsx`, trocar os imports, o tipo, os estilos e o componente `Receita` por:

```tsx
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { paraWinAnsi as w } from '@/modules/pacientes/prontuario-pdf';
import { formatarCodigo } from './codigo';
import { AREA_ASSINATURA as A, linhaDaVersao, RESSALVA_PARECER, TIPO_DOCUMENTO_ROTULO } from './constantes';
import { CABECALHO_VALORES, linhaDoValor, MSG_PARECER, rotuloDoExame, type ConteudoDocumento, type ConteudoParecer } from './parecer';
import { descreverItem, type ConteudoReceita } from './prescricao';

/** Só o worker importa este arquivo (guarda de grafo em exportacao.test.ts). Plano 13: a receita e o parecer. */
export type DadosPdfDocumento = { conteudo: ConteudoDocumento; codigo: string; urlVerificacao: string; data: string; cor: string; logo: Buffer | null; nomeConsultorio: string };

const ALTURA_RODAPE = 150; // o quadro (y1 62 → y2 132) + a faixa do código; o conteúdo nunca passa por baixo
const s = StyleSheet.create({
  pagina: { padding: 36, paddingBottom: ALTURA_RODAPE, fontSize: 10, fontFamily: 'Helvetica', lineHeight: 1.4 },
  topo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottomWidth: 2 },
  logo: { width: 64, height: 64, objectFit: 'contain' },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 6 },
  item: { marginTop: 8 },
  itemTitulo: { fontFamily: 'Helvetica-Bold' },
  secao: { marginTop: 12, fontFamily: 'Helvetica-Bold' },
  cabecalho: { fontSize: 8, color: '#666666' },
  ressalva: { marginTop: 14, fontSize: 9, fontFamily: 'Helvetica-Oblique' },
  carimbo: { marginTop: 18, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#999999' },
  quadro: { position: 'absolute', left: A.x1, bottom: A.y1, width: A.x2 - A.x1, height: A.y2 - A.y1, borderWidth: 1, borderColor: '#999999', borderStyle: 'dashed' },
  rodape: { position: 'absolute', left: 36, right: 36, bottom: 16, flexDirection: 'row', alignItems: 'center' },
});

function CorpoReceita({ c }: { c: ConteudoReceita }) {
  return (
    <>
      {c.itens.map((it, i) => {
        const x = descreverItem(it);
        return (
          <View key={i} style={s.item} wrap={false}>
            <Text style={s.itemTitulo}>{w(`${i + 1}. ${x.titulo}`)}</Text>
            {x.linhas.map((l) => <Text key={l}>{w(l)}</Text>)}
          </View>
        );
      })}
      {c.orientacoes ? <Text style={{ marginTop: 12 }}>{w(`Orientações gerais: ${c.orientacoes}`)}</Text> : null}
    </>
  );
}

/**
 * US-141 v0.5 (PDF proposto): "Exames considerados" com a cópia congelada (RN-148) — por exame, "{título} — dd/mm/aaaa" e a
 * tabela, ou "(laudo no prontuário, sem valores lançados)"; a origem dos valores NÃO sai aqui (Q13-2 ★); depois a avaliação,
 * a conduta e os encaminhamentos (se houver) e a ressalva fixa da D5.
 */
function CorpoParecer({ c }: { c: ConteudoParecer }) {
  return (
    <>
      <Text style={s.secao}>Exames considerados</Text>
      {/* Revisão do plano: um exame tem até 50 linhas (exames.ts, MAX_LINHAS) e passa da altura útil (842 − 36 − ALTURA_RODAPE).
          wrap={false} no exame inteiro faria o react-pdf desenhar o bloco numa página só, por cima do quadro "Assinatura digital"
          e do rodapé. Como no plano-pdf.tsx: o título não fica sozinho no fim da página (minPresenceAhead) e só cada linha é
          indivisível. */}
      {c.exames.map((e) => (
        <View key={e.id} style={s.item}>
          <Text style={s.itemTitulo} minPresenceAhead={28}>{w(rotuloDoExame(e))}</Text>
          {e.valores.length === 0 ? (
            <Text wrap={false}>{w(`(${MSG_PARECER.semValores})`)}</Text>
          ) : (
            <>
              <Text style={s.cabecalho} minPresenceAhead={14}>{w(CABECALHO_VALORES)}</Text>
              {e.valores.map((v, i) => <Text key={i} wrap={false}>{w(linhaDoValor(v))}</Text>)}
            </>
          )}
        </View>
      ))}
      <Text style={s.secao}>Avaliação nutricional</Text>
      <Text>{w(c.avaliacao)}</Text>
      {c.conduta ? (
        <>
          <Text style={s.secao}>Conduta e orientações</Text>
          <Text>{w(c.conduta)}</Text>
        </>
      ) : null}
      {c.encaminhamentos ? (
        <>
          <Text style={s.secao}>Encaminhamentos</Text>
          <Text>{w(c.encaminhamentos)}</Text>
        </>
      ) : null}
      <Text style={s.ressalva}>{w(RESSALVA_PARECER)}</Text>
    </>
  );
}

function Documento({ d, qr }: { d: DadosPdfDocumento; qr: Buffer }) {
  const c = d.conteudo;
  const p = c.copia!.profissional;
  const titulo = TIPO_DOCUMENTO_ROTULO[c.tipo];
  const retificacao = c.copia!.retificacao;
  const carimbo = [p.nomeCompleto, 'Nutricionista', p.crn, p.email, p.telefone].join(' · ');
  return (
    <Document title={titulo} author={p.nomeCompleto} creator="NutriDebby" producer="NutriDebby">
      <Page size="A4" style={s.pagina}>
        <View style={[s.topo, { borderBottomColor: d.cor }]}>
          <Text style={{ fontFamily: 'Helvetica-Bold', fontSize: 12 }}>{w(d.nomeConsultorio)}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
          {d.logo && <Image style={s.logo} src={{ data: d.logo, format: 'png' }} />}
        </View>
        <Text style={s.titulo}>{w(titulo)}</Text>
        {/* Q13-5 ★ / NGS1.01.01: a versão nova diz qual documento ela substitui */}
        {retificacao ? <Text>{w(linhaDaVersao(retificacao.versao, formatarCodigo(retificacao.substitui)))}</Text> : null}
        <Text>{w(`Paciente: ${c.copia!.paciente.nome}`)}</Text>
        <Text>{`Data de emissão: ${d.data}`}</Text>
        {c.tipo === 'parecer' ? <CorpoParecer c={c} /> : <CorpoReceita c={c} />}
        <View style={s.carimbo} wrap={false}>
          <Text>{w(carimbo)}</Text>
          {p.endereco ? <Text>{w(p.endereco)}</Text> : null}
        </View>
        {/* D15 / RN-144 (6): o quadro em branco, em TODA página, na posição gravada em area_assinatura */}
        <View fixed style={s.quadro}>
          <Text style={{ fontSize: 8, color: '#666666', margin: 4 }}>Assinatura digital</Text>
        </View>
        <View fixed style={s.rodape}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
          <Image src={{ data: qr, format: 'png' }} style={{ width: 40, height: 40, marginRight: 8 }} />
          <Text style={{ fontSize: 8, flex: 1 }}>{`Código de verificação: ${formatarCodigo(d.codigo)} · Verifique em ${d.urlVerificacao}`}</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderizarDocumento(d: DadosPdfDocumento): Promise<Buffer> {
  const qr = await QRCode.toBuffer(d.urlVerificacao, { errorCorrectionLevel: 'M', margin: 1, width: 240 });
  return renderToBuffer(<Documento d={d} qr={qr} />);
}
```

- [ ] **Step 3: O job, a digitalizada e a habilitação**

- `src/modules/documentos/documento-pdf-job.ts`: `import type { ConteudoReceita } from './prescricao';` → `import type { ConteudoDocumento } from './parecer';` e `conteudo: lido.conteudo as ConteudoReceita,` → `conteudo: lido.conteudo as ConteudoDocumento,`.
- `src/modules/documentos/digitalizada-job.tsx`: o mesmo import e `const copia = (d.conteudo as ConteudoReceita).copia!.profissional;` → `const copia = (d.conteudo as ConteudoDocumento).copia!.profissional;`.
- `src/modules/documentos/digitalizada.ts`: o mesmo import e `conteudo: d.conteudo as ConteudoReceita` → `conteudo: d.conteudo as ConteudoDocumento`.
- `src/modules/documentos/registrar-assinatura.ts`: trocar `import type { ConteudoReceita } from './prescricao';` por `import type { ConteudoDocumento } from './parecer';` e a função:

```ts
/**
 * Minor 9 da revisão de segurança: a habilitação em Fitoterapia é conferida ao salvar e ao preparar (T5) e de novo AO
 * ASSINAR — retirada entre o preparo e o envio, o fitoterápico formulado não é assinado. Quem chama passa o tenant lido
 * na sessão do envio (a digitalizada no envio das fotos; o 10B no envio do PDF assinado). Plano 13: só a receita tem
 * itens; o parecer (e o conteúdo '{}' de um anonimizado) passa direto.
 */
export function exigirHabilitacaoAtual(tenant: Pick<TenantRow, 'fitoterapiaRegistro'>, conteudo: ConteudoDocumento): void {
  if (conteudo.tipo !== 'receita') return;
  if (!tenant.fitoterapiaRegistro && conteudo.itens.some((i) => i.tipo === 'fitoterapico')) throw new RecusaAssinaturaError('sem_habilitacao', 'habilitacao_retirada');
}
```

- [ ] **Step 4: Rodar (inclusive a guarda de grafo do worker)**

Run: `pnpm vitest run src/modules/documentos src/modules/pacientes/exportacao.test.ts && pnpm typecheck`
Expected: PASS (`parecer.ts` não importa nada do servidor nem do `@react-pdf/renderer`; o `documento-pdf.tsx` continua só no grafo do worker).

- [ ] **Step 5: Commit**

```bash
git add src/modules/documentos/documento-pdf.tsx src/modules/documentos/documento-pdf-job.ts src/modules/documentos/digitalizada.ts \
  src/modules/documentos/digitalizada-job.tsx src/modules/documentos/registrar-assinatura.ts src/modules/documentos/*.test.ts
git commit -m "feat(documentos): PDF do parecer no worker e assinatura digitalizada por tipo (P13-04)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 5: Verificação pública, portal e link pelo tipo e pela versão (P13-05)

**Revisão: completa (agente revisor-rls)** — `document_verifications` só por `verificacao.ts` (regra 1), chaves da lista do portal sem conteúdo (regra 8, D17 do 10A), página pública sem dado de saúde (D8). As duas linhas de tela (portal e link) vão também ao `revisor-interface` na revisão final do branch.

**Files:**
- Modify: `src/modules/documentos/verificacao.ts`, `src/modules/documentos/registrar-assinatura.ts` (o tipo real na verificação), `src/modules/documentos/portal.ts`, `src/modules/documentos/link-documento.ts`, `src/app/p/(portal)/documentos/page.tsx`, `src/app/documento/[token]/page.tsx`
- Test: `src/modules/documentos/verificacao-publica.test.ts`, `src/modules/documentos/registrar-assinatura.test.ts`, `src/modules/documentos/portal.test.ts`, `src/modules/documentos/link-documento.test.ts`, `src/app/p/(portal)/documentos/page.test.ts`

**Interfaces:**
- Consumes: da T2 `TipoDocumento`, `TIPO_DOCUMENTO_ROTULO`, `TIPO_DOCUMENTO_COM_ARTIGO`, `rotuloDaVersao`; da T1 `documentoNoBanco(…, { tipo, retificaId, versao })`, `retificacaoAssinadaNoBanco`.
- Produces: `NovaVerificacao.tipo: TipoDocumento`; `VerificacaoPublica.tipo: 'Receita' | 'Parecer nutricional'`; `DocumentoNoPortal` com `tipo`, `titulo` pelo tipo e `versao`; `EstadoLink` "aberto" com `titulo` pelo tipo e `versao`.

- [ ] **Step 1: Os testes que falham**

Em `src/modules/documentos/verificacao-publica.test.ts`, deixar `verificacao()` receber o tipo — `async function verificacao(situacao = 'valido', assinatura = 'digitalizada', tipo: 'receita' | 'parecer' = 'receita')`, com `{ status: 'assinado', tipo }` no `documentoNoBanco` e `${tipo}` no lugar de `'receita'` no INSERT — e acrescentar:

```ts
  it('Plano 13 (US-147 v0.5): o parecer aparece como "Tipo: Parecer nutricional" e nada mais do parecer', async () => {
    const { codigo } = await verificacao('valido', 'digitalizada', 'parecer');
    const r = await consultarVerificacao(codigo, { db: app.db, ipDoLimite: ip() });
    expect(r).toMatchObject({ tipo: 'ok', v: { codigo, tipo: 'Parecer nutricional', situacao: 'valido' } });
    expect(Object.keys((r as { v: object }).v).sort()).toEqual(['assinadoEm', 'assinanteNome', 'assinatura', 'codigo', 'emissorCrn', 'emissorNome', 'sha256', 'situacao', 'situacaoEm', 'tipo'].sort());
  });
```

Em `src/modules/documentos/registrar-assinatura.test.ts`, acrescentar (o `assinarNoBanco` do arquivo já faz o caminho da digitalizada e do 10B):

```ts
  it('Plano 13: a verificação grava o tipo real do documento (parecer)', async () => {
    const x = await outroDocumento(await novoConsultorio(app.db), app.db, { tipo: 'parecer' });
    await assinarNoBanco(x, { codigo: x.codigo, baseSha256: x.baseSha256 });
    expect((await app.db.execute(sql`select tipo from document_verifications where codigo = ${x.codigo}`)).rows).toEqual([{ tipo: 'parecer' }]);
  });
```

Em `src/modules/documentos/portal.test.ts`, trocar a lista de chaves esperada no primeiro teste por `['aberto', 'assinaturaTipo', 'data', 'id', 'recebidoEm', 'status', 'tipo', 'titulo', 'versao']` e acrescentar (com `retificacaoAssinadaNoBanco` no import de `../../../test/documentos`):

```ts
  it('Plano 13 (US-146 v0.5): parecer com o título dele; a versão 1 substituída e a 2 vigente aparecem as duas, cada uma com a sua versão', async () => {
    const T = await consultorioLiberado();
    const p = await novoPaciente(app.db, T.ctx);
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', tipo: 'parecer' });
    const v2 = await retificacaoAssinadaNoBanco(app.db, T.ctx, p.id, { id: v1.id, versao: 1 }, { tipo: 'parecer' });
    const lista = await documentosDoPaciente(ctxPaciente(T.tenantId, p.id), app.db);
    expect(lista.map((d) => ({ id: d.id, tipo: d.tipo, titulo: d.titulo, versao: d.versao, status: d.status })).sort((a, b) => a.versao - b.versao)).toEqual([
      { id: v1.id, tipo: 'parecer', titulo: 'Parecer nutricional', versao: 1, status: 'substituido' },
      { id: v2.id, tipo: 'parecer', titulo: 'Parecer nutricional', versao: 2, status: 'assinado' },
    ]);
    // o substituído não conta como novo (só "assinado" não aberto) e não confirma recebimento
    expect(await novosNoPortal(ctxPaciente(T.tenantId, p.id), app.db)).toBe(1);
    expect(await confirmarRecebimentoNoPortal(ctxPaciente(T.tenantId, p.id), v1.id, app.db)).toBeNull();
  });
```

Em `src/modules/documentos/link-documento.test.ts`, deixar `cenario()` receber o tipo — `async function cenario(o: { liberado?: boolean; tipo?: 'receita' | 'parecer' } = {})`, com `{ status: 'assinado', tipo: o.tipo }` no `documentoNoBanco` — e acrescentar (com `retificacaoAssinadaNoBanco` no import):

```ts
  it('Plano 13: o parecer abre com o título dele e a versão; substituído por uma retificação, o link fica "não está mais disponível" (RN-158)', async () => {
    const x = await cenario({ tipo: 'parecer' });
    await pedirCodigoDocumento(x.token, { turnstile: 't' }, deps());
    const { sessao } = await confirmarCodigoDocumento(x.token, { codigo: await ultimoCodigo(x.p.email) }, deps());
    expect(await estadoDoLink(x.token, sessao, deps())).toMatchObject({ tipo: 'aberto', titulo: 'Parecer nutricional', versao: 1 });
    await retificacaoAssinadaNoBanco(app.db, x.T.ctx, x.p.id, { id: x.d.id, versao: 1 }, { tipo: 'parecer' });
    expect(await estadoDoLink(x.token, sessao, deps())).toEqual({ tipo: 'indisponivel' });
  });
```

Em `src/app/p/(portal)/documentos/page.test.ts`, acrescentar `tipo: 'receita', versao: 1,` ao `doc()` padrão e:

```ts
  it('Plano 13: o parecer e a versão ("Parecer nutricional · 04/10/2026 · Versão 2") e o leitor de tela com o artigo certo', async () => {
    lista.splice(0, lista.length, doc({ tipo: 'parecer', titulo: 'Parecer nutricional', versao: 2 }));
    const html = await render();
    expect(html).toContain('Parecer nutricional · 04/10/2026 · Versão 2');
    expect(html).toContain('Abrir PDF<span class="sr-only"> do parecer nutricional de 04/10/2026</span>');
    lista.splice(0, lista.length, doc({}));
    const receita = await render();
    expect(receita).toContain('Receita · 04/10/2026<'); // versão 1: sem "Versão"
    expect(receita).toContain('Abrir PDF<span class="sr-only"> da receita de 04/10/2026</span>');
  });
```

Run: `pnpm vitest run src/modules/documentos/verificacao-publica.test.ts src/modules/documentos/registrar-assinatura.test.ts src/modules/documentos/portal.test.ts src/modules/documentos/link-documento.test.ts "src/app/p/(portal)/documentos/page.test.ts"`
Expected: FAIL (o tipo e a versão não existem nos módulos; a verificação diz "Receita"; `registrarAssinatura` grava `'receita'`).

- [ ] **Step 2: A verificação e a assinatura**

Em `src/modules/documentos/verificacao.ts`:

```ts
import { ROTULO_ASSINATURA, TIPO_DOCUMENTO_ROTULO, type SituacaoVerificacao, type TipoAssinatura, type TipoDocumento } from './constantes';

export type NovaVerificacao = {
  codigo: string; tenantId: string; documentoId: string; tipo: TipoDocumento; assinadoEm: Date; emissorNome: string; emissorCrn: string;
  assinanteNome: string | null; assinaturaTipo: TipoAssinatura; pdfSha256: string;
};
```

```ts
/** D8: o que a página pública mostra — nada do paciente nem do conteúdo (Plano 13: do parecer, só o tipo). */
export type VerificacaoPublica = {
  codigo: string; tipo: (typeof TIPO_DOCUMENTO_ROTULO)[TipoDocumento]; situacao: SituacaoVerificacao; situacaoEm: Date; assinadoEm: Date; emissorNome: string; emissorCrn: string;
  assinanteNome: string | null; assinatura: string; sha256: string;
};
```

e, em `consultarVerificacao`, `tipo: d.tipo,` no `select` e `codigo, tipo: TIPO_DOCUMENTO_ROTULO[v.tipo as TipoDocumento], …` no resultado (no lugar de `tipo: 'Receita'`).

Em `src/modules/documentos/registrar-assinatura.ts`, acrescentar `import type { TipoAssinatura, TipoDocumento } from './constantes';` (no lugar do import só de `TipoAssinatura`), trocar o `.returning({ id: signedDocuments.id })` do UPDATE da assinatura por `.returning({ id: signedDocuments.id, tipo: signedDocuments.tipo })` e, no `registrarVerificacao`, `tipo: 'receita'` por `tipo: r[0].tipo as TipoDocumento`.

- [ ] **Step 3: O portal e o link**

Em `src/modules/documentos/portal.ts`:

```ts
import { TIPO_DOCUMENTO_ROTULO, type TipoAssinatura, type TipoDocumento } from './constantes';

/** US-146 v0.5: título pelo tipo e a versão (Q13-5 ★); nunca exames, valores, avaliação, itens ou orientações (D17 do 10A). */
export type DocumentoNoPortal = {
  id: string;
  tipo: TipoDocumento;
  titulo: string;
  versao: number;
  data: Date;
  status: 'assinado' | 'substituido' | 'cancelado';
  assinaturaTipo: TipoAssinatura;
  aberto: boolean;
  recebidoEm: Date | null;
};
```

em `documentosDoPaciente`, `tipo: signedDocuments.tipo, versao: signedDocuments.versao,` no `select` e, no `map`:

```ts
      return ds.map((d) => ({
        id: d.id,
        tipo: d.tipo as TipoDocumento,
        titulo: TIPO_DOCUMENTO_ROTULO[d.tipo as TipoDocumento],
        versao: d.versao,
        data: d.assinadoEm!,
        status: d.status as DocumentoNoPortal['status'],
        assinaturaTipo: d.assinaturaTipo as TipoAssinatura,
        aberto: rs.some((r) => r.documentoId === d.id && r.evento === 'aberto'),
        recebidoEm: rs.find((r) => r.documentoId === d.id && r.evento === 'recebido')?.em ?? null,
      }));
```

Em `src/modules/documentos/link-documento.ts`:

- `EstadoLink`: `{ tipo: 'aberto'; titulo: 'Receita'; data: Date; recebidoEm: Date | null }` → `{ tipo: 'aberto'; titulo: string; versao: number; data: Date; recebidoEm: Date | null }` (o `tipo` do `EstadoLink` é a situação do link, não o do documento);
- em `abrirLink`, o `select` do documento ganha `tipoDoc: signedDocuments.tipo, versao: signedDocuments.versao`, e o retorno, `tipoDoc: (d?.tipoDoc ?? 'receita') as TipoDocumento, versao: d?.versao ?? 1`;
- em `estadoDoLink`: `return { tipo: 'aberto', titulo: TIPO_DOCUMENTO_ROTULO[l.dados.tipoDoc], versao: l.dados.versao, data: l.dados.assinadoEm!, recebidoEm: recebido };`;
- import de `TIPO_DOCUMENTO_ROTULO` e `type TipoDocumento` de `./constantes`.

A versão substituída já cai em "indisponível" (`disponivel` exige `d.status === 'assinado'`), sem código novo — o teste do Step 1 prende isso.

- [ ] **Step 4: As duas telas**

Em `src/app/p/(portal)/documentos/page.tsx`, importar `rotuloDaVersao` e `TIPO_DOCUMENTO_COM_ARTIGO` de `@/modules/documentos/constantes` e trocar:

```tsx
            <h2 className="font-semibold">{`${d.titulo} · ${data(d.data)}${d.versao > 1 ? ` · ${rotuloDaVersao(d.versao)}` : ''}`}</h2>
```

```tsx
              Abrir PDF<span className="sr-only">{` ${TIPO_DOCUMENTO_COM_ARTIGO[d.tipo]} de ${data(d.data)}`}</span>
```

Em `src/app/documento/[token]/page.tsx`, importar `rotuloDaVersao` e trocar o `<h2>` por:

```tsx
          <h2 id="documento" className="font-semibold">{`${estado.titulo} · ${formatarData(hojeNoFuso('America/Sao_Paulo', estado.data))}${estado.versao > 1 ? ` · ${rotuloDaVersao(estado.versao)}` : ''}`}</h2>
```

- [ ] **Step 5: Rodar**

Run: `pnpm vitest run src/modules/documentos "src/app/p/(portal)/documentos" src/app/documento src/app/v && pnpm typecheck`
Expected: PASS. O E2E da receita (`e2e/documentos.spec.ts`) continua achando "Abrir PDF da receita" (o texto da receita não muda).

- [ ] **Step 6: Commit**

```bash
git add src/modules/documentos/verificacao.ts src/modules/documentos/registrar-assinatura.ts src/modules/documentos/portal.ts src/modules/documentos/link-documento.ts \
  src/modules/documentos/*.test.ts "src/app/p/(portal)/documentos" "src/app/documento/[token]/page.tsx"
git commit -m "feat(documentos): verificação, portal e link pelo tipo e pela versão (P13-05)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 6: LGPD — exportação do parecer e das versões, anonimização com retificações (P13-06)

**Revisão: completa (agente normas-cfn-lgpd)** — US-150 v0.5: o que a equipe e o titular recebem (D15, Q13-1 ★, Q13-2 ★), anonimização das versões (RN-140 c).

**Files:**
- Modify: `src/modules/documentos/lgpd-documentos.ts`, `src/modules/pacientes/exportacao.test.ts` (estreitar o tipo na linha 846)
- Test: `src/modules/documentos/lgpd-documentos.test.ts`

**Interfaces:**
- Consumes: da T2 `ConteudoParecer`, `TipoDocumento`, `TIPO_DOCUMENTO_ROTULO`; da T1 `documentoNoBanco`, `retificacaoAssinadaNoBanco`; `formatarCodigo`, `descreverItem`.
- Produces: `DocumentoExportado` (o `dados.json`, chave `documentos`) com `tipo` pelo documento, `versao`, `retificaCodigo` e, por tipo, `itens`/`orientacoes`/`justificativaDeUso` (receita) ou `exames`/`avaliacao`/`conduta`/`encaminhamentos` (parecer); `motivoDaRetificacao` só no escopo `equipe`. `anonimizarDocumentosDoPaciente` e `pdfsDeDocumentosRestantes` não mudam de assinatura.

- [ ] **Step 1: Os testes que falham**

Em `src/modules/documentos/lgpd-documentos.test.ts`, acrescentar `retificacaoAssinadaNoBanco` ao import de `../../../test/documentos` e:

```ts
const parecer = {
  versao: 1, tipo: 'parecer', avaliacao: 'Baixa reserva de ferro.', conduta: 'Aumentar fontes de ferro.', encaminhamentos: '',
  exames: [{ id: randomUUID(), data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null, iaTarefaId: randomUUID() }], enviadoPeloPaciente: true }],
  copia: { profissional: {}, paciente: { nome: 'Ana Souza' } },
};

describe('LGPD do parecer e das versões (US-150 v0.5)', () => {
  it('parecer: a cópia dos exames (com a origem — Q13-2 ★), avaliação, conduta e encaminhamentos no lugar dos itens; versão e código da anterior', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', tipo: 'parecer', conteudo: parecer });
    const v2 = await retificacaoAssinadaNoBanco(app.db, T.ctx, p.id, { id: v1.id, versao: 1 }, { tipo: 'parecer', conteudo: parecer, motivo: 'Ferritina lançada depois' });
    const worker = { tenantId: T.tenantId, role: 'worker' as const };
    const titular = await withTenant(worker, (tx) => documentosParaExportacao(tx, p.id, 'titular'), app.db);
    const porVersao = (n: number) => titular.documentos.find((d) => d.versao === n)!;
    expect(titular.documentos).toHaveLength(2); // a v1 substituída e a v2 vigente vão as duas
    expect(porVersao(1)).toMatchObject({ tipo: 'Parecer nutricional', situacao: 'Substituído', versao: 1, retificaCodigo: null });
    expect(porVersao(2)).toMatchObject({
      tipo: 'Parecer nutricional', situacao: 'Assinado', versao: 2,
      retificaCodigo: `${v1.codigo!.slice(0, 4)}-${v1.codigo!.slice(4, 8)}-${v1.codigo!.slice(8)}`,
      avaliacao: 'Baixa reserva de ferro.', conduta: 'Aumentar fontes de ferro.', encaminhamentos: '',
      exames: [{ titulo: 'Hemograma', data: '2026-09-01', enviadoPeloPaciente: true, valores: [{ nome: 'Ferritina', valor: 12, unidade: 'ng/mL', referencia: null, lidoComIa: true }] }],
    });
    expect(porVersao(2)).not.toHaveProperty('itens');
    // Q13-1 ★: o motivo da retificação só na exportação da equipe; o titular nunca (nem a chave)
    expect(porVersao(2)).not.toHaveProperty('motivoDaRetificacao');
    expect(JSON.stringify(titular)).not.toContain('Ferritina lançada depois');
    const equipe = await withTenant(worker, (tx) => documentosParaExportacao(tx, p.id, 'equipe'), app.db);
    expect(equipe.documentos.find((d) => d.versao === 2)).toMatchObject({ motivoDaRetificacao: 'Ferritina lançada depois' });
    expect(equipe.documentos.find((d) => d.versao === 1)).toMatchObject({ motivoDaRetificacao: null });
    expect(v2.id).toBeTruthy();
  });

  it('receita continua com itens, orientações e justificativa, agora com versão (1) e retificaCodigo (nulo)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', conteudo });
    const r = await withTenant({ tenantId: T.tenantId, role: 'worker' }, (tx) => documentosParaExportacao(tx, p.id, 'titular'), app.db);
    expect(r.documentos[0]).toMatchObject({ tipo: 'Receita', versao: 1, retificaCodigo: null, orientacoes: 'Com água.' });
    expect(r.documentos[0]).not.toHaveProperty('exames');
  });

  it('anonimização com v1 substituída, v2 assinada e v3 em rascunho: v3 apagada, v1 e v2 limpas (com as notas e o motivo); nada sobra', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const dataDir = await mkdtemp(path.join(tmpdir(), 'lgpd-ret-'));
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado', tipo: 'parecer', conteudo: parecer });
    const v2 = await retificacaoAssinadaNoBanco(app.db, T.ctx, p.id, { id: v1.id, versao: 1 }, { tipo: 'parecer', conteudo: parecer });
    const v3 = await documentoNoBanco(app.db, T.ctx, p.id, { tipo: 'parecer', conteudo: parecer, retificaId: v2.id, versao: 3 });
    for (const pdf of [v1.pdfPath!, v2.pdfPath]) {
      await mkdir(path.join(dataDir, path.dirname(pdf)), { recursive: true });
      await writeFile(path.join(dataDir, pdf), '%PDF-1.3');
    }
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set status = 'bloqueado' where id = ${p.id}`), app.db);
    const worker = { tenantId: T.tenantId, role: 'worker' as const };
    expect(await anonimizarDocumentosDoPaciente(worker, p.id, { db: app.db, dataDir })).toBe(3);
    const docs = await withTenant(T.ctx, (tx) => tx.execute(sql`select id, status, conteudo, pdf_path from signed_documents where patient_id = ${p.id} order by versao`), app.db);
    expect(docs.rows).toEqual([
      { id: v1.id, status: 'substituido', conteudo: {}, pdf_path: null },
      { id: v2.id, status: 'assinado', conteudo: {}, pdf_path: null },
    ]);
    expect(docs.rows.map((d) => (d as { id: string }).id)).not.toContain(v3.id);
    const notas = await withTenant(T.ctx, (tx) => tx.execute(sql`select motivo_retificacao from signed_document_notes where documento_id = ${v2.id}`), app.db);
    expect(notas.rows).toEqual([{ motivo_retificacao: null }]);
    expect(await withTenant(worker, (tx) => pdfsDeDocumentosRestantes(tx, p.id), app.db)).toBe(0);
  });
});
```

Run: `pnpm vitest run src/modules/documentos/lgpd-documentos.test.ts`
Expected: FAIL (`tipo` fixo em "Receita", sem `versao`, `retificaCodigo`, `exames`, `motivoDaRetificacao`).

- [ ] **Step 2: A exportação pelos dois tipos**

Em `src/modules/documentos/lgpd-documentos.ts`, trocar o tipo e `documentosParaExportacao` por:

```ts
import { EMITIDOS, ROTULO_ASSINATURA, ROTULO_STATUS, TIPO_DOCUMENTO_ROTULO, type StatusDocumento, type TipoAssinatura, type TipoDocumento } from './constantes';
import type { ConteudoParecer } from './parecer';
import { descreverItem, type ConteudoReceita } from './prescricao';

type BaseExportada = {
  tipo: string;
  /** NGS1.01.01: a versão do documento e, numa retificação, o código (formatado) da versão que ela substitui. */
  versao: number;
  retificaCodigo: string | null;
  situacao: string;
  criadoEm: string;
  assinadoEm: string | null;
  codigo: string | null;
  sha256: string | null;
  assinatura: string | null;
  recebimento: { evento: string; via: string; em: string }[];
  /** Caminho do PDF assinado dentro do ZIP (`documentos/…`); null se não há PDF ou se ele ficou de fora. */
  pdf: string | null;
  /** Q13-1 ★: só na exportação da EQUIPE (a chave nem existe na do titular, como o motivo de cancelamento, que nunca sai). */
  motivoDaRetificacao?: string | null;
};
type ReceitaExportada = { itens: { titulo: string; linhas: string[] }[]; orientacoes: string; justificativaDeUso: string | null };
/** Q13-2 ★: a origem dos valores (IA conferida, envio do paciente) sai aqui, nunca no PDF. Nada do laudo. */
type ParecerExportado = {
  exames: { titulo: string; data: string; enviadoPeloPaciente: boolean; valores: { nome: string; valor: number; unidade: string | null; referencia: string | null; lidoComIa: boolean }[] }[];
  avaliacao: string;
  conduta: string;
  encaminhamentos: string;
};
export type DocumentoExportado = BaseExportada & (ReceitaExportada | ParecerExportado);

const emitido = (s: string) => EMITIDOS.includes(s as StatusDocumento);

/**
 * US-150 base (D1 ★) + Plano 13: equipe = todos, com a justificativa e o motivo da retificação; titular = só os emitidos,
 * com a justificativa (D15 = (b)) e o recebimento, sem motivo de retificação (Q13-1 ★); o motivo de cancelamento nunca
 * sai. O worker roda como `worker` (a RLS do paciente não filtra): o filtro do titular é explícito aqui. Cada versão é um
 * documento (v1 substituída e v2 vigente vão as duas). O PDF preparado nunca vai; o assinado vai em documentos/.
 */
export async function documentosParaExportacao(
  tx: Tx,
  patientId: string,
  escopo: EscopoExportacao,
): Promise<{ documentos: DocumentoExportado[]; anexos: { indice: number; caminho: string; nome: string }[] }> {
  const ds = await tx
    .select()
    .from(signedDocuments)
    .where(and(eq(signedDocuments.patientId, patientId), escopo === 'titular' ? inArray(signedDocuments.status, [...EMITIDOS]) : undefined))
    .orderBy(asc(signedDocuments.createdAt), asc(signedDocuments.id));
  const ids = ds.map((d) => d.id);
  const notas = ids.length
    ? await tx
        .select({ d: signedDocumentNotes.documentoId, j: signedDocumentNotes.justificativaUso, m: signedDocumentNotes.motivoRetificacao })
        .from(signedDocumentNotes)
        .where(inArray(signedDocumentNotes.documentoId, ids))
    : [];
  const recibos = ids.length
    ? await tx.select().from(signedDocumentReceipts).where(inArray(signedDocumentReceipts.documentoId, ids)).orderBy(asc(signedDocumentReceipts.em))
    : [];
  // a versão anterior é do mesmo paciente (FK composta de retifica_id): o código dela, se emitida, está na própria lista
  const codigoDe = new Map(ds.map((d) => [d.id, d.codigo && d.status !== 'rascunho' ? formatarCodigo(d.codigo) : null]));
  const anexos: { indice: number; caminho: string; nome: string }[] = [];
  const documentos: DocumentoExportado[] = ds.map((d, i) => {
    // nome sem texto do usuário (data + posição), como os laudos
    if (d.pdfPath && !d.anonimizadoEm)
      anexos.push({ indice: i, caminho: d.pdfPath, nome: `documentos/${(d.assinadoEm ?? d.createdAt).toISOString().slice(0, 10)}-${String(i + 1).padStart(2, '0')}.pdf` });
    const nota = notas.find((n) => n.d === d.id);
    const tipo = d.tipo as TipoDocumento;
    const base: BaseExportada = {
      tipo: TIPO_DOCUMENTO_ROTULO[tipo],
      versao: d.versao,
      retificaCodigo: d.retificaId ? (codigoDe.get(d.retificaId) ?? null) : null,
      situacao: ROTULO_STATUS[d.status as StatusDocumento],
      criadoEm: d.createdAt.toISOString(),
      assinadoEm: d.assinadoEm?.toISOString() ?? null,
      codigo: codigoDe.get(d.id) ?? null,
      sha256: d.pdfSha256,
      assinatura: d.assinaturaTipo ? ROTULO_ASSINATURA[d.assinaturaTipo as TipoAssinatura] : null,
      recebimento: recibos.filter((r) => r.documentoId === d.id).map((r) => ({ evento: r.evento, via: r.via, em: r.em.toISOString() })),
      pdf: null,
      ...(escopo === 'equipe' ? { motivoDaRetificacao: nota?.m ?? null } : {}),
    };
    if (tipo === 'parecer') {
      const c = d.conteudo as Partial<ConteudoParecer>; // anonimizado: '{}'
      return {
        ...base,
        exames: (c.exames ?? []).map((e) => ({
          titulo: e.titulo, data: e.data, enviadoPeloPaciente: !!e.enviadoPeloPaciente,
          valores: e.valores.map((v) => ({ nome: v.nome, valor: v.valor, unidade: v.unidade, referencia: v.referencia, lidoComIa: !!v.iaTarefaId })),
        })),
        avaliacao: c.avaliacao ?? '',
        conduta: c.conduta ?? '',
        encaminhamentos: c.encaminhamentos ?? '',
      };
    }
    const c = d.conteudo as Partial<ConteudoReceita>;
    return { ...base, itens: (c.itens ?? []).map((item) => descreverItem(item)), orientacoes: c.orientacoes ?? '', justificativaDeUso: nota?.j ?? null };
  });
  return { documentos, anexos };
}
```

`anonimizarDocumentosDoPaciente` não muda: o rascunho da retificação é apagado pelo caminho (a) (a FK `retifica_id` não impede: a original nunca é apagada), e cada emitido é limpo pela `app_anonimizar_documentos` (que, desde a 0105, limpa também o motivo).

- [ ] **Step 3: O `dados.json` da exportação**

Run: `pnpm vitest run src/modules/documentos/lgpd-documentos.test.ts src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.test.ts && pnpm typecheck`
Expected: PASS (`exportacao-job.ts` repassa `docs.documentos` como estão; se algum teste da exportação conferir as chaves do documento exportado, acrescentar `versao`, `retificaCodigo` e — na equipe — `motivoDaRetificacao`).

Antes de rodar, estreitar os três acessos dos testes existentes: com a união `ReceitaExportada | ParecerExportado`, `.itens` e `.justificativaDeUso` sem estreitar dão TS2339 no `pnpm typecheck` (o `tsconfig.json` inclui os testes):
- `src/modules/documentos/lgpd-documentos.test.ts:35`: `expect(equipe.documentos.find((d) => d.situacao === 'Rascunho')).toMatchObject({ justificativaDeUso: 'J rascunho' });`
- `src/modules/documentos/lgpd-documentos.test.ts:49`: `expect(titular.documentos[0]).toMatchObject({ itens: [expect.objectContaining({ titulo: expect.stringContaining('Vitamina D3') })] });`
- `src/modules/pacientes/exportacao.test.ts:846`: `equipe.dados.documentos.map((x) => [x.situacao, 'justificativaDeUso' in x ? x.justificativaDeUso : undefined])`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/documentos/lgpd-documentos.ts src/modules/documentos/lgpd-documentos.test.ts src/modules/pacientes/exportacao.test.ts
git commit -m "feat(documentos): exportação do parecer e das versões; anonimização com retificações (P13-06)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 7: Retificação — a versão nova, o motivo, a assinatura que substitui e o cancelamento com retificação em andamento (P13-07)

**Revisão: completa (agente revisor-rls)** — ordem de travas (D-P1) e deadlock, substituição na transação da assinatura (RN-146), cancelamento (RN-147), registro sem dependência de sessão (D23 do 10A). A revisão de normas (NGS1.12.01/02, Q13-1 ★, Q13-3 ★) entra como lente na mesma rodada.

**Files:**
- Create: `src/modules/documentos/retificacao.ts`, `src/modules/documentos/retificacao.test.ts`
- Modify: `src/modules/documentos/documentos.ts` (motivo no salvar dos dois tipos; preparo da retificação; `DocumentoLido` com as versões), `src/modules/documentos/registrar-assinatura.ts` (substituir a original), `src/modules/documentos/arquivos-do-preparo.ts` (`travarDocumentoAntesDaCota` trava a original antes), `src/modules/documentos/cancelamento.ts` (+ `cancelamento.test.ts`)

**Interfaces:**
- Consumes: da T1 os gatilhos e `outroDocumento(…, { paciente, retifica })`; da T2 `MSG_RETIFICACAO`, `ConteudoDocumento`, `CopiaDoDocumento`; da T4 a digitalizada do parecer; da T5 `registrarAssinatura` com `.returning({ id, tipo })` e `mudarSituacao`; `tenantLivreEnquantoEsperaODocumento` (`test/documentos.ts`); `emailsNaFila` (`test/pacientes.ts`).
- Produces: `retificacaoEmAndamento`, `retificarDocumento`, `lerMotivoRetificacao`; `salvarRascunhoReceita`/`salvarRascunhoParecer` aceitam `motivoRetificacao`; `DocumentoLido` com `retificaId`, `motivoRetificacao`, `substituidoEm` e `versoes`.

- [ ] **Step 1: O teste que falha**

Criar `src/modules/documentos/retificacao.test.ts`:

```ts
import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { documentoNoBanco, novoConsultorio, outroDocumento, tenantLivreEnquantoEsperaODocumento } from '../../../test/documentos';
import { emailsNaFila, novoPaciente } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { exams, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { criarExame } from '@/modules/pacientes/exames';
import { receberDigitalizada } from './digitalizada';
import { montarPdfDigitalizado } from './digitalizada-job';
import { apagarRascunho, lerDocumento, prepararParaAssinatura, salvarRascunhoParecer, salvarRascunhoReceita } from './documentos';
import { DocumentoError, TransicaoInvalidaError } from './erros';
import type { ConteudoParecer } from './parecer';
import { retificarDocumento } from './retificacao';
import { consultarVerificacao } from './verificacao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const erroEm = (campo: string, msg: string) => (e: unknown) => e instanceof DocumentoError && e.erros[campo] === msg;
const contar = async (ctx: Parameters<typeof withTenant>[0], original: string) =>
  Number((await withTenant(ctx, (tx) => tx.execute(sql`select count(*)::int as n from signed_documents where retifica_id = ${original}`), app.db)).rows[0].n);

async function consultorio() {
  const c = await novoConsultorio(app.db);
  const [t] = await app.db.select().from(tenants).where(eq(tenants.id, c.T.tenantId));
  return { ...c, tenant: t as TenantRow };
}

describe('retificar (US-148, RN-146, SBIS NGS1.12.01/02)', () => {
  it('receita: abre a "Versão 2" com os itens, as orientações e a justificativa da 1 (sem a cópia do perfil); a 1 continua "Assinado"', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const itens = [{ tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 ao dia', duracao: '', manipulado: false }];
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado', conteudo: { versao: 1, tipo: 'receita', itens, orientacoes: 'Com água.', copia: { profissional: {}, paciente: { nome: 'Ana Souza' } }, declaracao: 'x' } });
    await withTenant(c.T.ctx, (tx) => tx.execute(sql`insert into signed_document_notes (tenant_id, patient_id, documento_id) values (${c.T.tenantId}, ${p.id}, ${v1.id})`), app.db);
    const v2 = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    const d = (await lerDocumento(c.T.ctx, p.id, v2, app.db))!;
    expect(d).toMatchObject({ tipo: 'receita', status: 'rascunho', versao: 2, retificaId: v1.id, motivoRetificacao: null, conteudo: { tipo: 'receita', itens, orientacoes: 'Com água.' } });
    expect(d.conteudo).not.toHaveProperty('copia');
    expect(d.conteudo).not.toHaveProperty('declaracao');
    expect(d.versoes.anterior).toMatchObject({ id: v1.id, versao: 1, codigo: v1.codigo });
    const original = (await lerDocumento(c.T.ctx, p.id, v1.id, app.db))!;
    expect(original).toMatchObject({ status: 'assinado', versoes: { anterior: null, seguinte: { id: v2, versao: 2, status: 'rascunho' } } });
  });

  it('parecer: copia a seleção e os textos; o primeiro salvar refaz a cópia pelos exames atuais (o caso de uso principal)', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const e = await criarExame(c.T.ctx, { fuso: 'America/Sao_Paulo' }, p.id, { titulo: 'Hemograma', data: '2026-09-01', valores: [{ nome: 'Hemoglobina', valor: '13,5', unidade: 'g/dL', referencia: '12 a 16' }], arquivo: null }, { db: app.db, now: new Date('2026-10-01T15:00:00Z') });
    const copia = [{ id: e, data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16' }] }];
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado', tipo: 'parecer', conteudo: { versao: 1, tipo: 'parecer', exames: copia, avaliacao: 'A.', conduta: 'C.', encaminhamentos: 'E.' } });
    await withTenant(c.T.ctx, (tx) => tx.update(exams).set({ valores: sql`valores || '[{"nome":"Ferritina","valor":12,"unidade":"ng/mL","referencia":null}]'::jsonb` }).where(eq(exams.id, e)), app.db);
    const v2 = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    expect((await lerDocumento(c.T.ctx, p.id, v2, app.db))!.conteudo).toMatchObject({ tipo: 'parecer', exames: copia, avaliacao: 'A.', conduta: 'C.', encaminhamentos: 'E.' });
    await salvarRascunhoParecer(c.T.ctx, p.id, v2, { conteudo: { exameIds: [e], avaliacao: 'A.', conduta: 'C.', encaminhamentos: 'E.' }, motivoRetificacao: 'Ferritina lançada depois' }, { db: app.db });
    const d = (await lerDocumento(c.T.ctx, p.id, v2, app.db))!;
    expect((d.conteudo as ConteudoParecer).exames[0].valores.map((v) => v.nome)).toEqual(['Hemoglobina', 'Ferritina']);
    expect(d.motivoRetificacao).toBe('Ferritina lançada depois');
  });

  it('uma por vez: "Retificar" de novo (ou dois cliques ao mesmo tempo) abre a mesma; apagada, nasce outra "Versão 2"', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado' });
    const [a, b] = await Promise.all([retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db }), retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db })]);
    expect(a).toBe(b);
    expect(await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db })).toBe(a);
    expect(await contar(c.T.ctx, v1.id)).toBe(1);
    await apagarRascunho(c.T.ctx, p.id, a, { db: app.db });
    const nova = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    expect(nova).not.toBe(a);
    expect((await lerDocumento(c.T.ctx, p.id, nova, app.db))!.versao).toBe(2);
  });

  it('só a versão em vigor: rascunho, substituído e cancelado recusam; paciente bloqueado também (só consulta)', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    for (const status of ['rascunho', 'cancelado', 'substituido'] as const) {
      const d = await documentoNoBanco(app.db, c.T.ctx, p.id, { status });
      await expect(retificarDocumento(c.T.ctx, p.id, d.id, { db: app.db })).rejects.toBeInstanceOf(TransicaoInvalidaError);
    }
    const b = await novoPaciente(app.db, c.T.ctx, { status: 'bloqueado' });
    const d = await documentoNoBanco(app.db, c.T.ctx, b.id, { status: 'assinado' });
    await expect(retificarDocumento(c.T.ctx, b.id, d.id, { db: app.db })).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('Q13-1 ★: preparar a versão nova exige o motivo (até 500); o preparo congela "Versão 2 — substitui o documento {código}"', async () => {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx);
    const itens = [{ tipo: 'suplemento', categoria: 'nutriente', composicao: [{ nome: 'Vitamina D3', quantidade: 2000, unidade: 'UI' }], forma: 'Cápsula', via: 'oral', posologia: '1 ao dia' }];
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado' });
    const v2 = await retificarDocumento(c.T.ctx, p.id, v1.id, { db: app.db });
    const salvar = (motivo: unknown) => salvarRascunhoReceita(c.T.ctx, c.tenant, p.id, v2, { conteudo: { itens }, justificativa: 'Exposição solar baixa', motivoRetificacao: motivo }, { db: app.db });
    await expect(salvar('x'.repeat(501))).rejects.toSatisfy(erroEm('motivoRetificacao', 'Escreva o motivo da retificação (até 500 caracteres).'));
    await salvar('  ');
    await expect(prepararParaAssinatura(c.T.ctx, c.tenant, p.id, v2, { declaracao: 'on' }, { db: app.db })).rejects.toSatisfy(erroEm('motivoRetificacao', 'Escreva o motivo da retificação (até 500 caracteres).'));
    await salvar('Dose corrigida');
    await prepararParaAssinatura(c.T.ctx, c.tenant, p.id, v2, { declaracao: 'on' }, { db: app.db });
    expect((await lerDocumento(c.T.ctx, p.id, v2, app.db))!.conteudo.copia?.retificacao).toEqual({ versao: 2, substitui: v1.codigo });
  });
});

describe('assinar a versão nova (US-148, RN-146, Q13-3 ★)', () => {
  async function versaoNovaAguardando() {
    const c = await consultorio();
    const p = await novoPaciente(app.db, c.T.ctx, { nome: 'Ana Souza' });
    const v1 = await documentoNoBanco(app.db, c.T.ctx, p.id, { status: 'assinado' });
    await app.db.execute(sql`insert into document_verifications (codigo, tenant_id, documento_id, tipo, assinado_em, emissor_nome, emissor_crn, assinatura_tipo, pdf_sha256)
      values (${v1.codigo}, ${c.T.tenantId}, ${v1.id}, 'receita', now(), 'Débora', 'CRN-3 12345', 'digitalizada', ${'a'.repeat(64)})`);
    const v2 = await outroDocumento(c, app.db, { paciente: p, retifica: { id: v1.id, versao: 1 } });
    const foto = await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    await receberDigitalizada(c.acesso, v2.id, [foto], '123456', { db: app.db, dataDir: c.dataDir, headers: new Headers(), confirmar2fa: async () => 'ok' });
    const assinar = () => montarPdfDigitalizado({ tenantId: c.T.tenantId, documentoId: v2.id, userId: c.T.nutriId }, { db: app.db, dataDir: c.dataDir, appUrl: 'https://x', ultimaTentativa: false });
    return { c, p, v1, v2, assinar };
  }

  it('assinada a 2, a 1 vira "Substituído" na mesma transação, também na verificação; a 2 tem o código próprio "válido"; só o e-mail de documento novo', async () => {
    const { c, p, v1, v2, assinar } = await versaoNovaAguardando();
    expect(await assinar()).toBe('pronto');
    const [d1] = (await withTenant(c.T.ctx, (tx) => tx.execute(sql`select status, substituido_em is not null as em from signed_documents where id = ${v1.id}`), app.db)).rows;
    expect(d1).toEqual({ status: 'substituido', em: true });
    expect(await consultarVerificacao(v1.codigo, { db: app.db, ipDoLimite: '192.0.2.131' })).toMatchObject({ tipo: 'ok', v: { situacao: 'substituido' } });
    expect(await consultarVerificacao(v2.codigo, { db: app.db, ipDoLimite: '192.0.2.132' })).toMatchObject({ tipo: 'ok', v: { situacao: 'valido', tipo: 'Receita' } });
    expect(await emailsNaFila('documento_atualizado', p.email)).toEqual([]); // Q13-3 ★: um e-mail só
    expect((await emailsNaFila('documento_link', p.email)).length).toBe(1); // paciente sem conta: o link da versão nova
  });

  it('ordem de travas (D-P1): a assinatura da 2 espera a ORIGINAL (presa por um cancelamento noutra conexão) com a cota do tenant livre', async () => {
    const { c, v1, assinar } = await versaoNovaAguardando();
    const r = await tenantLivreEnquantoEsperaODocumento(app.db, c.T.ctx, v1.id, assinar);
    expect(r).toEqual({ tenantLivre: true, resultado: 'pronto' });
  });
});
```

Em `src/modules/documentos/cancelamento.test.ts`, acrescentar:

```ts
  it('Plano 13 (US-149, RN-147): com a "Versão 2" em andamento, "Há uma retificação em andamento (versão 2)…" e nada muda; apagada, cancela', async () => {
    const T = await novoTenant(app.db, 'Consultório Debby');
    await liberarDocumentos(app.db, T.tenantId);
    const p = await novoPaciente(app.db, T.ctx);
    const v1 = await documentoNoBanco(app.db, T.ctx, p.id, { status: 'assinado' });
    const v2 = await retificarDocumento(T.ctx, p.id, v1.id, { db: app.db });
    await expect(cancelarDocumento(T.ctx, p.id, v1.id, 'Dose errada', { db: app.db, appUrl: 'https://x' })).rejects.toSatisfy(
      (e) => e instanceof DocumentoError && e.erros.geral === 'Há uma retificação em andamento (versão 2). Conclua ou apague a retificação antes de cancelar.',
    );
    const [d] = (await withTenant(T.ctx, (tx) => tx.execute(sql`select status from signed_documents where id = ${v1.id}`), app.db)).rows;
    expect(d).toEqual({ status: 'assinado' });
    await apagarRascunho(T.ctx, p.id, v2, { db: app.db });
    await cancelarDocumento(T.ctx, p.id, v1.id, 'Dose errada', { db: app.db, appUrl: 'https://x' });
  });
```

(com `import { apagarRascunho } from './documentos';` e `import { retificarDocumento } from './retificacao';`.)

Run: `pnpm vitest run src/modules/documentos/retificacao.test.ts src/modules/documentos/cancelamento.test.ts`
Expected: FAIL (`./retificacao` não existe; a assinatura não substitui; o cancelamento não confere a retificação).

- [ ] **Step 2: O módulo da retificação**

Criar `src/modules/documentos/retificacao.ts`:

```ts
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { signedDocumentNotes, signedDocuments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { MSG_RETIFICACAO, type StatusDocumento } from './constantes';
import { DocumentoError, DocumentoNaoEncontradoError, TransicaoInvalidaError } from './erros';
import type { ConteudoDocumento } from './parecer';

const EM_ANDAMENTO: StatusDocumento[] = ['rascunho', 'preparando', 'aguardando_assinatura'];

/** RN-146: a retificação aberta (rascunho, preparando ou aguardando assinatura) de um documento, se houver — no máximo uma (índice da 0089). */
export async function retificacaoEmAndamento(tx: Tx, documentoId: string): Promise<{ id: string; versao: number } | null> {
  const [r] = await tx
    .select({ id: signedDocuments.id, versao: signedDocuments.versao })
    .from(signedDocuments)
    .where(and(eq(signedDocuments.retificaId, documentoId), inArray(signedDocuments.status, EM_ANDAMENTO)))
    .limit(1);
  return r ?? null;
}

/** Q13-1 ★: o motivo da retificação (até 500; vazio = null — o preparo é que o exige). */
export function lerMotivoRetificacao(v: unknown): string | null {
  const m = typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '';
  if (m.length > 500) throw new DocumentoError({ motivoRetificacao: MSG_RETIFICACAO.motivo });
  return m || null;
}

/** NGS1.12.02: a versão nova nasce do conteúdo da vigente — sem a cópia do perfil/paciente e sem a declaração (RN-154: nascem de novo no preparo). */
function semCopia(c: ConteudoDocumento): ConteudoDocumento {
  return c.tipo === 'parecer'
    ? { versao: 1, tipo: 'parecer', exames: c.exames, avaliacao: c.avaliacao, conduta: c.conduta, encaminhamentos: c.encaminhamentos }
    : { versao: 1, tipo: 'receita', itens: c.itens, orientacoes: c.orientacoes };
}

/**
 * US-148: "Retificar" um documento "assinado" (a versão em vigor) abre o rascunho da versão seguinte com o conteúdo dela;
 * havendo uma retificação em andamento, abre a mesma (uma por vez). Ordem de travas (D-P1): paciente → ORIGINAL (FOR
 * UPDATE) — a do cancelamento e da assinatura da versão nova —, então dois cliques simultâneos se enfileiram e o segundo
 * acha a primeira (o índice único da 0089 continua como barreira do banco). Na receita, a justificativa de uso vai para a
 * nota da versão nova (a habilitação é conferida de novo ao salvar, preparar e assinar); o motivo nasce vazio (Q13-1 ★).
 */
export async function retificarDocumento(ctx: TenantContext, patientId: string, docId: string, deps: { db?: Db } = {}): Promise<string> {
  return withTenant(
    ctx,
    async (tx) => {
      await carregarPacienteParaEscrita(tx, patientId);
      if (!idValido(docId)) throw new DocumentoNaoEncontradoError();
      const [o] = await tx
        .select()
        .from(signedDocuments)
        .where(and(eq(signedDocuments.id, docId), eq(signedDocuments.patientId, patientId)))
        .for('update');
      if (!o) throw new DocumentoNaoEncontradoError();
      if (o.status !== 'assinado' || o.anonimizadoEm) throw new TransicaoInvalidaError();
      const aberta = await retificacaoEmAndamento(tx, docId);
      if (aberta) return aberta.id;
      const [n] = await tx
        .insert(signedDocuments)
        .values({ tenantId: ctx.tenantId, patientId, tipo: o.tipo, versao: o.versao + 1, retificaId: o.id, conteudo: semCopia(o.conteudo as ConteudoDocumento) })
        .returning({ id: signedDocuments.id });
      const [nota] = await tx.select({ j: signedDocumentNotes.justificativaUso }).from(signedDocumentNotes).where(eq(signedDocumentNotes.documentoId, docId));
      await tx.insert(signedDocumentNotes).values({ tenantId: ctx.tenantId, patientId, documentoId: n.id, justificativaUso: o.tipo === 'receita' ? (nota?.j ?? null) : null });
      return n.id;
    },
    deps.db ?? getDb(),
  );
}
```

- [ ] **Step 3: O motivo no salvar, a retificação no preparo e as versões na leitura**

Em `src/modules/documentos/documentos.ts` (import de `desc` já existe; acrescentar `import { lerMotivoRetificacao } from './retificacao';` e `MSG_RETIFICACAO` ao import de `./constantes`):

1. `salvarRascunhoReceita` — assinatura `input: { conteudo: unknown; justificativa: unknown; motivoRetificacao?: unknown }`; logo depois do `j` validado: `const motivo = input.motivoRetificacao === undefined ? undefined : lerMotivoRetificacao(input.motivoRetificacao);`; e o UPDATE da nota:

```ts
    await tx
      .update(signedDocumentNotes)
      .set({ justificativaUso: j || null, ...(d.retificaId && motivo !== undefined ? { motivoRetificacao: motivo } : {}), updatedAt: new Date() })
      .where(eq(signedDocumentNotes.documentoId, docId));
```

2. `salvarRascunhoParecer` — `input: { conteudo: unknown; motivoRetificacao?: unknown }`; o mesmo `motivo` antes da transação; depois do UPDATE do conteúdo:

```ts
    if (d.retificaId && motivo !== undefined)
      await tx.update(signedDocumentNotes).set({ motivoRetificacao: motivo, updatedAt: new Date() }).where(eq(signedDocumentNotes.documentoId, docId));
```

3. `prepararParaAssinatura` — a leitura da nota passa a `select({ j: signedDocumentNotes.justificativaUso, m: signedDocumentNotes.motivoRetificacao })`; logo depois dela:

```ts
    // US-148 / Q13-1 ★ (NGS1.12.01): a retificação vai ao preparo com o motivo; a cópia leva a versão e o código da anterior (RN-154)
    let retificacao: CopiaDoDocumento['retificacao'];
    if (d.retificaId) {
      if (!nota?.m?.trim()) throw new DocumentoError({ motivoRetificacao: MSG_RETIFICACAO.motivo });
      const [anterior] = await tx.select({ codigo: signedDocuments.codigo }).from(signedDocuments).where(eq(signedDocuments.id, d.retificaId));
      retificacao = { versao: d.versao, substitui: anterior!.codigo! };
    }
```

e a cópia no `set` passa a `copia: { profissional, paciente: { nome: paciente.nome }, ...(retificacao ? { retificacao } : {}) }` (com `import type { CopiaDoDocumento } from './perfil-profissional';`).

4. As versões na leitura — tipo:

```ts
export type VersaoVizinha = { id: string; versao: number };
export type DocumentoLido = ItemLista & {
  conteudo: ConteudoDocumento; justificativa: string | null; motivoCancelamento: string | null; assinanteNome: string | null;
  basePdfPath: string | null; pdfPath: string | null; pdfSha256: string | null; digitalizacaoStatus: string | null; digitalizacaoEm: Date | null;
  anonimizadoEm: Date | null; canceladoEm: Date | null;
  /** Plano 13 (US-148): a versão anterior (desta retificação) e a seguinte (a retificação desta, em andamento ou assinada). */
  retificaId: string | null; motivoRetificacao: string | null; substituidoEm: Date | null;
  versoes: { anterior: (VersaoVizinha & { codigo: string | null }) | null; seguinte: (VersaoVizinha & { status: StatusDocumento }) | null };
};
```

e, em `lerDocumentoNaTransacao`, antes do `return`:

```ts
  const [anterior] = d.retificaId
    ? await tx.select({ id: signedDocuments.id, versao: signedDocuments.versao, codigo: signedDocuments.codigo }).from(signedDocuments).where(eq(signedDocuments.id, d.retificaId))
    : [];
  const [seguinte] = await tx
    .select({ id: signedDocuments.id, versao: signedDocuments.versao, status: signedDocuments.status })
    .from(signedDocuments)
    .where(eq(signedDocuments.retificaId, id))
    .orderBy(desc(signedDocuments.createdAt))
    .limit(1);
```

com o retorno acrescido de `retificaId: d.retificaId, motivoRetificacao: n?.motivoRetificacao ?? null, substituidoEm: d.substituidoEm, versoes: { anterior: anterior ?? null, seguinte: seguinte ? { ...seguinte, status: seguinte.status as StatusDocumento } : null },`.

- [ ] **Step 4: A assinatura que substitui, a ordem de travas e o cancelamento**

Em `src/modules/documentos/registrar-assinatura.ts`, `import { mudarSituacao, registrarVerificacao } from './verificacao';`, o `.returning(...)` da assinatura passa a `.returning({ id: signedDocuments.id, tipo: signedDocuments.tipo, retificaId: signedDocuments.retificaId })` e, logo depois do `registrarVerificacao(…)`:

```ts
  // RN-146 (Plano 13): a versão nova assinada substitui a original NA MESMA TRANSAÇÃO — só se ela ainda está "assinado"
  // (senão a assinatura inteira volta: o salvarArquivo desfaz tudo). O gatilho só deixa com esta já "assinado" (0105). A
  // original já está travada desde o antesDaReserva (travarDocumentoAntesDaCota: original → versão nova → tenant).
  // Q13-3 ★: o paciente recebe só o e-mail de documento novo da entrega abaixo, sem um "documento atualizado".
  // O `!s.length` é defesa em profundidade: pelos caminhos legais a original não sai de "assinado" com esta retificação em
  // andamento (o cancelamento recusa e só esta pode substituí-la — gatilhos da 0105), então não há teste que o alcance.
  if (r[0].retificaId) {
    const s = await tx
      .update(signedDocuments)
      .set({ status: 'substituido', substituidoEm: a.agora, updatedAt: a.agora })
      .where(and(eq(signedDocuments.id, r[0].retificaId), eq(signedDocuments.status, 'assinado')))
      .returning({ id: signedDocuments.id });
    if (!s.length) throw new TransicaoInvalidaError();
    await mudarSituacao(tx, r[0].retificaId, 'substituido', a.agora);
  }
```

Em `src/modules/documentos/arquivos-do-preparo.ts`:

```ts
/**
 * Ordem de travas de armazenamento.ts (dono → tenant → registro), com o documento como dono (code review do PR #19, I2):
 * todo salvarArquivo que grava em `signed_documents` no `registrar` chama isto no `antesDaReserva` (depois do paciente,
 * quando o trava). Sem isso, o salvarArquivo travaria tenant → documento e o soltarArquivosDoPreparo (abaixo), documento
 * → tenant: os dois ao mesmo tempo no mesmo documento terminam em deadlock (40P01). Plano 13 (D-P1): numa retificação, a
 * ORIGINAL é travada antes (a assinatura da versão nova a leva a "substituido"), na ordem do cancelamento e do retificar:
 * paciente → original → versão nova → tenant. `retifica_id` é coluna fixa (gatilho), então lê-la sem trava é seguro.
 */
export async function travarDocumentoAntesDaCota(tx: Tx, documentoId: string): Promise<void> {
  const [d] = await tx.select({ retificaId: signedDocuments.retificaId }).from(signedDocuments).where(eq(signedDocuments.id, documentoId));
  if (d?.retificaId) await tx.select({ id: signedDocuments.id }).from(signedDocuments).where(eq(signedDocuments.id, d.retificaId)).for('update');
  await tx.select({ id: signedDocuments.id }).from(signedDocuments).where(eq(signedDocuments.id, documentoId)).for('update');
}
```

Em `src/modules/documentos/cancelamento.ts` (`import { MSG_RETIFICACAO } from './constantes';` e `import { retificacaoEmAndamento } from './retificacao';`), trocar o comentário "A retificação em andamento (Plano 13) entra aqui quando existir." por "Plano 13 (RN-147): com a original travada, uma retificação em andamento recusa (o gatilho também, 0105)." e, logo depois de `if (d.status !== 'assinado') throw new TransicaoInvalidaError();`:

```ts
      const aberta = await retificacaoEmAndamento(tx, docId);
      if (aberta) throw new DocumentoError({ geral: MSG_RETIFICACAO.emAndamento(aberta.versao) });
```

- [ ] **Step 5: Rodar (com a guarda de grafo da assinatura no worker)**

Run: `pnpm vitest run src/modules/documentos src/db/documentos-versoes.test.ts && pnpm typecheck`
Expected: PASS. A guarda de `registrar-assinatura.test.ts` (nenhum módulo de sessão no grafo do worker) continua passando: a assinatura não importa `retificacao.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/documentos/retificacao.ts src/modules/documentos/retificacao.test.ts src/modules/documentos/documentos.ts src/modules/documentos/registrar-assinatura.ts \
  src/modules/documentos/arquivos-do-preparo.ts src/modules/documentos/cancelamento.ts src/modules/documentos/cancelamento.test.ts
git commit -m "feat(documentos): retificação — versão nova com motivo, substituição na assinatura, cancelamento com retificação em andamento (P13-07)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 8: Painel — o parecer na aba Documentos: novo, editor com os exames, leitura e avisos de exame (P13-08)

**Revisão: leve (revisor-interface)** — textos da US-141 e os propostos, acessibilidade do editor (grupo de caixas, erros por campo), visual V2. As ações chamam só o módulo da T3 (sem regra nova de banco).

**Files:**
- Create: `src/app/painel/pacientes/[id]/documentos/[docId]/parecer-form.tsx`, `src/app/painel/pacientes/[id]/documentos/[docId]/aviso-exame.tsx`
- Modify: `src/app/painel/pacientes/[id]/documentos/page.tsx` (botão "Novo parecer nutricional"), `src/app/painel/pacientes/[id]/documentos/actions.ts` (+ `actions.test.ts`), `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx` (+ `page.test.ts`), `src/app/painel/configuracoes/perfil/page.tsx` e `src/app/painel/configuracoes/perfil/documentos-form.tsx` (o carimbo também sai no parecer)

**Interfaces:**
- Consumes: da T3 `criarParecer`, `salvarRascunhoParecer`, `prepararParaAssinatura`, `situacaoDosExames`, `SituacaoExame`; da T2 `ConteudoParecer`, `MSG_PARECER`, `PARECER_MAX_EXAMES`, `AVALIACAO_MAX`, `CONDUTA_MAX`, `ENCAMINHAMENTOS_MAX`, `rotuloDoExame`, `linhaDoValor`, `DECLARACAO_PARECER`; `listarExames` (`@/modules/pacientes/exames`, com `auditRead`); `Preparar` (`./preparar`).
- Produces: `criarParecerAction`, `salvarParecerAction`, `prepararParecerAction`; `ParecerForm` (props `patientId`, `docId`, `conteudo`, `exames: ExameParaEscolher[]`, `declaracao`; a T9 acrescenta `motivo`); `AvisoDoExame`; os alvos do manual guiado `data-guia="novo-parecer"` e `data-guia="editor-parecer"`.

- [ ] **Step 1: Os testes que falham**

Em `src/app/painel/pacientes/[id]/documentos/actions.test.ts`, acrescentar `criarParecerAction`, `prepararParecerAction` e `salvarParecerAction` ao import de `./actions`, `import { criarExame } from '@/modules/pacientes/exames';` e:

```ts
describe('parecer nutricional pelas ações (US-141)', () => {
  const editor = (o: { exameIds: string[]; avaliacao: string; declaracao?: boolean }) => {
    const f = new FormData();
    f.set('conteudo', JSON.stringify({ exameIds: o.exameIds, avaliacao: o.avaliacao }));
    if (o.declaracao) f.set('declaracao', 'on');
    return f;
  };
  const exame = (ctx: Parameters<typeof criarExame>[0], patientId: string) =>
    criarExame(ctx, { fuso: 'America/Sao_Paulo' }, patientId, { titulo: 'Hemograma', data: '2026-09-01', valores: [{ nome: 'Hemoglobina', valor: '13,5', unidade: 'g/dL', referencia: '12 a 16' }], arquivo: null }, { db, now: new Date('2026-10-01T15:00:00Z') });

  it('"Novo parecer nutricional" abre o rascunho; o erro de exame alheio e o do preparo voltam ao campo; com exame e avaliação, prepara', async () => {
    const { N, p } = await consultorio();
    const destino = await criarParecerAction(p.id).catch((e: Error) => e.message);
    expect(destino).toMatch(new RegExp(`^redirect /painel/pacientes/${p.id}/documentos/[0-9a-f-]{36}$`));
    const id = String(destino).split('/').at(-1)!;
    const outro = await novoPaciente(db, N.ctx);
    expect(await salvarParecerAction(p.id, id, {}, editor({ exameIds: [await exame(N.ctx, outro.id)], avaliacao: 'x' }))).toEqual({ erros: { exames: 'Um dos exames selecionados foi excluído. Revise a seleção.' } });
    expect(await prepararParecerAction(p.id, id, {}, editor({ exameIds: [], avaliacao: 'x', declaracao: true }))).toEqual({ erros: { exames: 'Selecione ao menos um exame.' } });
    revalidatePath.mockClear();
    expect(await prepararParecerAction(p.id, id, {}, editor({ exameIds: [await exame(N.ctx, p.id)], avaliacao: 'Baixa reserva de ferro.', declaracao: true }))).toEqual({ ok: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/painel/pacientes/${p.id}/documentos`, 'layout');
    expect((await lerDocumento(N.ctx, p.id, id, db))?.status).toBe('preparando');
  });

  it('paciente bloqueado: "Novo parecer nutricional" volta para a lista com ?bloqueado=1', async () => {
    const { N } = await consultorio();
    const b = await novoPaciente(db, N.ctx, { status: 'bloqueado' });
    await expect(criarParecerAction(b.id)).rejects.toThrow(`redirect /painel/pacientes/${b.id}/documentos?bloqueado=1`);
  });
});
```

Em `src/app/painel/pacientes/[id]/documentos/[docId]/page.test.ts`:

- no `caso` hoisted, acrescentar `exames: [] as Record<string, unknown>[], situacao: {} as Record<string, string>`;
- no mock de `'../actions'`, acrescentar `salvarParecerAction: vi.fn(), prepararParecerAction: vi.fn()`;
- acrescentar, antes do `await import('./page')`:

```ts
vi.mock('@/modules/pacientes/exames', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/modules/pacientes/exames')>()), listarExames: async () => caso.exames }));
vi.mock('@/modules/documentos/parecer-exames', () => ({ situacaoDosExames: async () => caso.situacao }));
```

- e o bloco:

```ts
describe('página do documento: parecer nutricional (US-141, RN-148)', () => {
  const HEMOGRAMA = { id: '00000000-0000-4000-8000-0000000000e1', data: '2026-09-01', titulo: 'Hemograma', valores: [{ nome: 'Hemoglobina', valor: 13.5, unidade: 'g/dL', referencia: '12 a 16' }] };
  const LIPIDICO = { id: '00000000-0000-4000-8000-0000000000e2', data: '2026-08-20', titulo: 'Perfil lipídico', valores: [] };
  const parecer = (status: string, extra: Record<string, unknown> = {}) => ({
    id: DOC, tipo: 'parecer', versao: 1, status, codigo: status === 'rascunho' ? null : 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'),
    assinadoEm: status === 'assinado' ? new Date('2026-09-02T12:00:00Z') : null, assinaturaTipo: status === 'assinado' ? 'digitalizada' : null, pdfStatus: 'pronto',
    entregueEm: null, recibos: [], conteudo: { versao: 1, tipo: 'parecer', exames: [HEMOGRAMA], avaliacao: 'Baixa reserva de ferro.', conduta: '', encaminhamentos: 'Sugiro avaliação médica.' },
    justificativa: null, motivoCancelamento: null, assinanteNome: null, basePdfPath: 'x', pdfPath: status === 'assinado' ? 'y' : null, pdfSha256: null,
    digitalizacaoStatus: null, digitalizacaoEm: null, anonimizadoEm: null, canceladoEm: null, ...extra,
  });
  const pagina = async (d: Record<string, unknown>, o: { exames?: Record<string, unknown>[]; situacao?: Record<string, string> } = {}) => {
    caso.twoFactorEnabled = true;
    caso.paciente = { id: PACIENTE, status: 'ativo', anonimizadoEm: null, userId: null, email: 'ana@ex.com' };
    caso.doc = d;
    caso.exames = o.exames ?? [];
    caso.situacao = o.situacao ?? {};
    return renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve({}) } as never));
  };

  it('rascunho: o editor com os exames do prontuário (o só com laudo marcado), a avaliação e a declaração do parecer; nada da receita', async () => {
    const html = await pagina(parecer('rascunho'), { exames: [HEMOGRAMA, LIPIDICO] });
    expect(html).toContain('<h2 id="documento" class="text-lg font-semibold">Parecer nutricional</h2>');
    expect(html).toContain('data-guia="editor-parecer"');
    expect(html).toContain('Exames considerados');
    expect(html).toContain('Hemograma — 01/09/2026');
    expect(html).toContain('Perfil lipídico — 20/08/2026 (laudo no prontuário, sem valores lançados)');
    expect(html).toContain('Avaliação nutricional');
    expect(html).toContain('Conduta e orientações (opcional)');
    expect(html).toContain('Encaminhamentos (opcional)');
    expect(html).toContain('Declaro que este parecer não afirma diagnóstico de doença nem prescreve medicamento.');
    expect(html).not.toContain('Itens da receita');
    expect(html).not.toContain('Justificativa de uso');
  });

  it('rascunho com um exame da cópia que foi excluído: o aviso proposto, e o exame fora da seleção', async () => {
    const html = await pagina(parecer('rascunho'), { exames: [LIPIDICO] });
    expect(html).toContain('Um dos exames selecionados foi excluído. Revise a seleção.');
    expect(html).not.toContain('Hemograma — 01/09/2026');
  });

  it('aguardando assinatura com o exame mudado: a cópia, "Os valores deste exame mudaram depois do parecer." e o "Voltar a editar"', async () => {
    const html = await pagina(parecer('aguardando_assinatura'), { situacao: { [HEMOGRAMA.id]: 'mudou' } });
    expect(html).toContain('Hemoglobina · 13,5 · g/dL · 12 a 16');
    expect(html).toContain('Os valores deste exame mudaram depois do parecer.');
    expect(html).toContain('Voltar a editar');
  });

  it('assinado com o exame excluído: "O exame Hemograma — 01/09/2026 foi excluído depois do parecer."; encaminhamentos sim, conduta vazia não', async () => {
    const html = await pagina(parecer('assinado'), { situacao: { [HEMOGRAMA.id]: 'excluido' } });
    expect(html).toContain('O exame Hemograma — 01/09/2026 foi excluído depois do parecer.');
    expect(html).toContain('Baixa reserva de ferro.');
    expect(html).toContain('Sugiro avaliação médica.');
    expect(html).not.toContain('Conduta e orientações');
    expect(html).not.toContain('Os valores deste exame mudaram');
  });
});
```

Run: `pnpm vitest run "src/app/painel/pacientes/[id]/documentos"`
Expected: FAIL (as ações e o editor do parecer não existem; a página não desenha o parecer).

- [ ] **Step 2: As ações**

Em `src/app/painel/pacientes/[id]/documentos/actions.ts`, acrescentar `criarParecer` e `salvarRascunhoParecer` ao import de `@/modules/documentos/documentos` e trocar `criarReceitaAction` por:

```ts
/** US-142 / US-141: "Nova receita" e "Novo parecer nutricional" abrem o rascunho; bloqueado volta à lista com o aviso. */
async function criarDocumentoAction(patientId: string, criar: (ctx: TenantContext, patientId: string) => Promise<string>): Promise<void> {
  const { ctx } = await acesso(caminho(patientId));
  let id: string;
  try {
    id = await criar(ctx, patientId);
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (e instanceof PacienteBloqueadoError) redirect(`${caminho(patientId)}?bloqueado=1`);
    throw e;
  }
  redirect(caminho(patientId, id));
}

export async function criarReceitaAction(patientId: string): Promise<void> {
  await criarDocumentoAction(patientId, (ctx, p) => criarReceita(ctx, p));
}

export async function criarParecerAction(patientId: string): Promise<void> {
  await criarDocumentoAction(patientId, (ctx, p) => criarParecer(ctx, p));
}
```

(com `import type { TenantContext } from '@/db/tenant';`). A guarda `acoes-de-paciente.test.ts` exige `requireNutri` (por `acesso`) na primeira linha de cada ação exportada: se ela não aceitar a chamada indireta por `criarDocumentoAction`, deixar as duas ações exportadas com `await acesso(caminho(patientId));` na primeira linha e passar o `ctx` para o helper.

Depois de `prepararAction`, acrescentar:

```ts
/** US-141 "Rascunho salvo." do parecer: o editor manda a seleção e os textos num campo só (JSON), como o da receita. */
export async function salvarParecerAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  const editor = lerEditor(f);
  if (!editor) return { erros: { geral: 'Formulário inválido.' } };
  try {
    await salvarRascunhoParecer(ctx, patientId, docId, { conteudo: editor.conteudo });
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}

/** US-141 + US-143: "Preparar para assinatura" do parecer grava o que está na tela (a cópia dos exames é refeita) e prepara. */
export async function prepararParecerAction(patientId: string, docId: string, _prev: EstadoForm, f: FormData): Promise<EstadoForm> {
  const { ctx, tenant } = await acesso(caminho(patientId, docId));
  const editor = lerEditor(f);
  if (!editor) return { erros: { geral: 'Formulário inválido.' } };
  try {
    await salvarRascunhoParecer(ctx, patientId, docId, { conteudo: editor.conteudo });
    await prepararParaAssinatura(ctx, tenant, patientId, docId, { declaracao: f.get('declaracao') });
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  return { ok: true };
}
```

- [ ] **Step 3: O botão na lista**

Em `src/app/painel/pacientes/[id]/documentos/page.tsx`, importar `criarParecerAction` e trocar o formulário único por:

```tsx
        {!bloqueado && (
          <div className="flex flex-wrap gap-2">
            <form action={criarReceitaAction.bind(null, paciente.id)} data-guia="nova-receita">
              <Botao>Nova receita</Botao>
            </form>
            {/* US-141 (Plano 13): o parecer na mesma aba, ao lado da receita */}
            <form action={criarParecerAction.bind(null, paciente.id)} data-guia="novo-parecer">
              <Botao variante="secundario">Novo parecer nutricional</Botao>
            </form>
          </div>
        )}
```

(o link da lista já usa `TIPO_DOCUMENTO_ROTULO[d.tipo]`: "Parecer nutricional de dd/mm/aaaa".)

Revisão do plano: os textos do perfil dizem que os dados saem só "no carimbo das receitas (Resolução CFN nº 656/2020)", mas a T4 põe o mesmo carimbo no parecer, cuja base é outra. Trocar (rascunho para a Debby, desvio 9):
- `src/app/painel/configuracoes/perfil/page.tsx:21`: "O nome completo, o CRN e o contato saem no carimbo das receitas (Resolução CFN nº 656/2020) e dos pareceres (Resolução CFN nº 760/2023, art. 10, I). O CRN e o endereço ficam no formulário acima."
- `src/app/painel/configuracoes/perfil/documentos-form.tsx:15`, dica do "Nome completo": "Sai no carimbo das receitas e dos pareceres, como no seu registro no CRN."

- [ ] **Step 4: O editor do parecer**

Criar `src/app/painel/pacientes/[id]/documentos/[docId]/parecer-form.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useActionState, useState, type ReactNode } from 'react';
import { Botao } from '@/components/ui/botao';
import { AVALIACAO_MAX, CONDUTA_MAX, ENCAMINHAMENTOS_MAX, MSG_PARECER, PARECER_MAX_EXAMES, type ConteudoParecer } from '@/modules/documentos/parecer';
import { prepararParecerAction, salvarParecerAction, type EstadoForm } from '../actions';
import { Preparar } from './preparar';

/** Um exame da lista do prontuário (listarExames, com auditRead), já com o rótulo "Hemograma — 01/09/2026". */
export type ExameParaEscolher = { id: string; rotulo: string; semValores: boolean };
type Estado = EstadoForm & { intencao?: 'salvar' | 'preparar' };
type Texto = { id: 'avaliacao' | 'conduta' | 'encaminhamentos'; rotulo: string; max: number };
const TEXTOS: Texto[] = [
  { id: 'avaliacao', rotulo: 'Avaliação nutricional', max: AVALIACAO_MAX },
  { id: 'conduta', rotulo: 'Conduta e orientações (opcional)', max: CONDUTA_MAX },
  { id: 'encaminhamentos', rotulo: 'Encaminhamentos (opcional)', max: ENCAMINHAMENTOS_MAX },
];

/**
 * US-141 + US-143: o editor e o preparo do parecer são UM formulário, como o da receita (revisão da T6 do 10A). Tudo
 * controlado (o React 19 reseta campos não controlados depois de cada action). A seleção vem da lista do prontuário; um
 * exame da cópia que não está mais nela (excluído) sai da seleção com o aviso proposto da spec v0.5 (desvio 10).
 */
export function ParecerForm({ patientId, docId, conteudo, exames, declaracao }: { patientId: string; docId: string; conteudo: ConteudoParecer; exames: ExameParaEscolher[]; declaracao: string }) {
  const [s, action, pendente] = useActionState<Estado, FormData>(async (prev, f) => {
    const intencao = f.get('intencao') === 'preparar' ? 'preparar' : 'salvar';
    return { ...(await (intencao === 'preparar' ? prepararParecerAction : salvarParecerAction)(patientId, docId, prev, f)), intencao };
  }, {});
  const existentes = new Set(exames.map((x) => x.id));
  const [selecionados, setSelecionados] = useState<string[]>(() => conteudo.exames.map((x) => x.id).filter((id) => existentes.has(id)));
  const [textos, setTextos] = useState({ avaliacao: conteudo.avaliacao, conduta: conteudo.conduta, encaminhamentos: conteudo.encaminhamentos });
  const [declarada, setDeclarada] = useState(false);
  const excluidoNaCopia = conteudo.exames.some((x) => !existentes.has(x.id));
  const e = s.erros ?? {};
  const aria = (k: string) => ({ 'aria-invalid': e[k] ? (true as const) : undefined, 'aria-describedby': e[k] ? `${k}-erro` : undefined });
  const msg = (k: string) => e[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-erro">{e[k]}</p>;
  // a ordem da lista do prontuário (mais recente primeiro) é a do parecer
  const exameIds = exames.map((x) => x.id).filter((id) => selecionados.includes(id));
  const sobras = [...new Set(Object.keys(e).filter((k) => !['geral', 'exames', 'avaliacao', 'conduta', 'encaminhamentos', 'declaracao'].includes(k)).map((k) => e[k]))];
  const aviso: ReactNode = (e.geral || sobras.length > 0) && (
    <div role="alert" className="space-y-1 text-erro">
      {e.geral && (
        <p>
          {e.geral} {s.perfilIncompleto && <Link href="/painel/configuracoes/perfil#documentos" className="underline">Completar perfil</Link>}
        </p>
      )}
      {sobras.map((m) => <p key={m}>{m}</p>)}
    </div>
  );
  return (
    <form action={action} className="space-y-6" data-guia="editor-parecer">
      <input type="hidden" name="conteudo" value={JSON.stringify({ exameIds, ...textos })} />
      {/* só aria-describedby: aria-invalid não vale num grupo (fieldset) */}
      <fieldset className="space-y-2" aria-describedby={e.exames ? 'exames-erro' : undefined}>
        <legend className="font-semibold">Exames considerados</legend>
        {excluidoNaCopia && <p role="note" className="text-sm text-erro">{MSG_PARECER.exameExcluido}</p>}
        {exames.length === 0 ? (
          <p>
            Nenhum exame lançado. Lance os exames na aba <Link href={`/painel/pacientes/${patientId}/exames`} className="text-link underline">Exames</Link>.
          </p>
        ) : (
          exames.map((x) => {
            const marcado = selecionados.includes(x.id);
            return (
              <div key={x.id} className="flex min-h-11 items-center gap-2">
                <input
                  id={`exame-${x.id}`}
                  type="checkbox"
                  checked={marcado}
                  disabled={!marcado && selecionados.length >= PARECER_MAX_EXAMES}
                  onChange={(ev) => setSelecionados((xs) => (ev.target.checked ? [...xs, x.id] : xs.filter((id) => id !== x.id)))}
                  className="size-5"
                />
                <label htmlFor={`exame-${x.id}`}>{x.semValores ? `${x.rotulo} (${MSG_PARECER.semValores})` : x.rotulo}</label>
              </div>
            );
          })
        )}
        {msg('exames')}
      </fieldset>
      {TEXTOS.map((t) => (
        <div key={t.id} className="space-y-1">
          <label htmlFor={t.id} className="block font-medium">{t.rotulo}</label>
          <textarea id={t.id} maxLength={t.max} rows={t.id === 'avaliacao' ? 8 : 4} value={textos[t.id]} onChange={(ev) => setTextos((x) => ({ ...x, [t.id]: ev.target.value }))} {...aria(t.id)} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" />
          {msg(t.id)}
        </div>
      ))}
      {s.intencao !== 'preparar' && aviso}
      {s.ok && s.intencao === 'salvar' && <p role="status">Rascunho salvo.</p>}
      <Botao disabled={pendente}>Salvar rascunho</Botao>
      <Preparar declaracao={declaracao} marcada={declarada} aoMarcar={setDeclarada} erro={e.declaracao} aviso={s.intencao === 'preparar' ? aviso : null} pendente={pendente} />
    </form>
  );
}
```

Criar `src/app/painel/pacientes/[id]/documentos/[docId]/aviso-exame.tsx`:

```tsx
import { Aviso } from '@/components/ui/aviso';
import { MSG_PARECER, rotuloDoExame } from '@/modules/documentos/parecer';
import type { SituacaoExame } from '@/modules/documentos/parecer-exames';

/**
 * RN-148 v0.5: o aviso (não bloqueio) quando o exame mudou ou foi excluído depois do preparo — abaixo do exame, no cartão
 * do conteúdo; a ação ("Voltar a editar" ou "Retificar") fica no cartão da situação (desvio 4 do plano).
 */
export function AvisoDoExame({ situacao, exame }: { situacao: SituacaoExame | undefined; exame: { titulo: string; data: string } }) {
  if (situacao === 'mudou') return <Aviso tipo="aviso">{MSG_PARECER.valoresMudaram}</Aviso>;
  if (situacao === 'excluido') return <Aviso tipo="aviso">{MSG_PARECER.exameExcluidoDepois(rotuloDoExame(exame))}</Aviso>;
  return null;
}
```

- [ ] **Step 5: A página do documento com o parecer**

Em `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx`:

1. Imports: `DECLARACAO_PARECER` (constantes), `linhaDoValor`, `MSG_PARECER`, `rotuloDoExame` de `@/modules/documentos/parecer`, `situacaoDosExames` de `@/modules/documentos/parecer-exames`, `listarExames` de `@/modules/pacientes/exames`, `AvisoDoExame` de `./aviso-exame` e `ParecerForm` de `./parecer-form`.
2. Depois de `const receita = …` (T3):

```tsx
  const parecer = d.conteudo.tipo === 'parecer' ? d.conteudo : null;
  // US-141: a seleção do editor pela lista do prontuário (listarExames grava "Visualizou · Exames", regra 8)
  const examesParaEscolher = parecer && d.status === 'rascunho' && !bloqueado
    ? (await listarExames(ctx, paciente.id)).map((x) => ({ id: x.id, rotulo: rotuloDoExame(x), semValores: x.valores.length === 0 }))
    : [];
  // RN-148 v0.5: o aviso de exame mudado/excluído só onde a nutricionista ainda age (aguardando → voltar a editar; assinado → retificar)
  const situacao = parecer && !anonimizado && (d.status === 'aguardando_assinatura' || d.status === 'assinado') ? await situacaoDosExames(ctx, paciente.id, parecer.exames) : {};
```

3. Junto do bloco do rascunho da receita, o do parecer:

```tsx
      {d.status === 'rascunho' && !bloqueado && parecer && (
        <>
          <ParecerForm patientId={paciente.id} docId={d.id} conteudo={parecer} exames={examesParaEscolher} declaracao={DECLARACAO_PARECER} />
          <AcaoDocumento acao={apagarRascunhoAction.bind(null, paciente.id, d.id)} rotulo="Apagar rascunho" confirmar="Apagar este rascunho?" />
        </>
      )}
```

4. Junto do cartão "Itens da receita", os do parecer:

```tsx
      {d.status !== 'rascunho' && !anonimizado && parecer && (
        <>
          <Cartao id="exames-parecer" titulo="Exames considerados">
            <ul className="space-y-3">
              {parecer.exames.map((x) => (
                <li key={x.id} className="space-y-1">
                  <p className="font-semibold">{rotuloDoExame(x)}</p>
                  {x.valores.length === 0 ? (
                    <p className="text-sm">{`(${MSG_PARECER.semValores})`}</p>
                  ) : (
                    <ul className="text-sm">{x.valores.map((v, i) => <li key={i}>{linhaDoValor(v)}</li>)}</ul>
                  )}
                  <AvisoDoExame situacao={situacao[x.id]} exame={x} />
                </li>
              ))}
            </ul>
          </Cartao>
          <Cartao id="avaliacao-parecer" titulo="Avaliação nutricional">
            <p className="whitespace-pre-line">{parecer.avaliacao}</p>
            {parecer.conduta && (
              <>
                <h3 className="mt-3 font-semibold">Conduta e orientações</h3>
                <p className="whitespace-pre-line">{parecer.conduta}</p>
              </>
            )}
            {parecer.encaminhamentos && (
              <>
                <h3 className="mt-3 font-semibold">Encaminhamentos</h3>
                <p className="whitespace-pre-line">{parecer.encaminhamentos}</p>
              </>
            )}
          </Cartao>
        </>
      )}
```

(confirmar no `Cartao` (`src/components/ui/cartao.tsx`) que o `titulo` vira um título de seção — o `Cartao` "Itens da receita" é o molde.)

- [ ] **Step 6: Rodar**

Run: `pnpm vitest run "src/app/painel/pacientes/[id]/documentos" src/app/painel/acoes-de-paciente.test.ts src/app/painel/cores.test.ts src/app/formularios-post.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/painel/pacientes/[id]/documentos" src/app/painel/configuracoes/perfil/page.tsx src/app/painel/configuracoes/perfil/documentos-form.tsx
git commit -m "feat(documentos): parecer nutricional no painel — novo, editor com os exames, leitura e avisos de exame (P13-08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 9: Painel — retificar, o motivo, a versão e o documento substituído (P13-09)

**Revisão: leve (revisor-interface)** — textos da US-148/US-149 e os propostos, foco e anúncio dos erros, visual V2. As ações chamam só o módulo da T7.

**Files:**
- Create: `src/app/painel/pacientes/[id]/documentos/[docId]/motivo-retificacao.tsx`
- Modify: `src/app/painel/pacientes/[id]/documentos/actions.ts` (+ `actions.test.ts`), `src/app/painel/pacientes/[id]/documentos/page.tsx` (versão na lista), `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx` (+ `page.test.ts`), `[docId]/receita-form.tsx`, `[docId]/parecer-form.tsx`

**Interfaces:**
- Consumes: da T7 `retificarDocumento`, `DocumentoLido.versoes`/`motivoRetificacao`/`substituidoEm`, o `motivoRetificacao` dos dois salvar; da T2 `linhaDaVersao`, `rotuloDaVersao`, `MSG_RETIFICACAO`; `formatarCodigo`, `dataHora`; da T8 `ParecerForm`.
- Produces: `retificarAction`; o campo "Motivo da retificação" (`name="motivoRetificacao"`) nos dois editores; o alvo do manual guiado `data-guia="retificar-documento"`.

- [ ] **Step 1: Os testes que falham**

Em `actions.test.ts`, acrescentar `retificarAction` ao import de `./actions` e:

```ts
describe('retificar pelas ações (US-148, US-149)', () => {
  it('"Retificar" abre a versão nova (ou a que já existe); "Cancelar documento" com ela em andamento devolve o texto da US-149; preparar sem motivo, o erro do campo', async () => {
    const { N, p } = await consultorio();
    const v1 = await documentoNoBanco(db, N.ctx, p.id, { status: 'assinado' });
    const destino = await retificarAction(p.id, v1.id, {}).catch((e: Error) => e.message);
    expect(destino).toMatch(new RegExp(`^redirect /painel/pacientes/${p.id}/documentos/[0-9a-f-]{36}$`));
    await expect(retificarAction(p.id, v1.id, {})).rejects.toThrow(String(destino)); // uma por vez: a mesma
    const motivo = new FormData();
    motivo.set('motivo', 'Dose errada');
    expect(await cancelarAction(p.id, v1.id, {}, motivo)).toEqual({ erros: { geral: 'Há uma retificação em andamento (versão 2). Conclua ou apague a retificação antes de cancelar.' } });
    const v2 = String(destino).split('/').at(-1)!;
    const f = formulario({ itens: [vitD('50')], justificativa: 'Exposição solar baixa', declaracao: true });
    expect(await prepararAction(p.id, v2, {}, f)).toEqual({ erros: { motivoRetificacao: 'Escreva o motivo da retificação (até 500 caracteres).' } });
    f.set('motivoRetificacao', 'Dose corrigida');
    expect(await prepararAction(p.id, v2, {}, f)).toEqual({ ok: true });
    expect(await lerDocumento(N.ctx, p.id, v2, db)).toMatchObject({ status: 'preparando', versao: 2, motivoRetificacao: 'Dose corrigida' });
  });

  it('"Retificar" de um documento que não é a versão em vigor: o motivo, sem redirecionar', async () => {
    const { N, p } = await consultorio();
    const cancelado = await documentoNoBanco(db, N.ctx, p.id, { status: 'cancelado' });
    expect(await retificarAction(p.id, cancelado.id, {})).toEqual(MUDOU);
  });
});
```

Em `page.test.ts`, acrescentar ao mock de `'../actions'` `retificarAction: vi.fn()`; no mock de `lerDocumento`, completar os documentos simulados com os campos da T7 (os casos do 10A e da T8 não os têm, e a página passa a ler `d.versoes`):

```ts
  lerDocumento: async () => ({
    retificaId: null, motivoRetificacao: null, substituidoEm: null, versoes: { anterior: null, seguinte: null },
    ...(caso.doc ?? { /* o emitido anonimizado padrão, como já está no arquivo */ }),
  }),
```

(o objeto padrão de hoje — o assinado anonimizado — vai dentro do `??`, sem mudança) e o bloco:

```ts
describe('página do documento: retificação (US-148, Q13-1 ★, Q13-5 ★)', () => {
  const base = (status: string, extra: Record<string, unknown> = {}) => ({
    id: DOC, tipo: 'receita', versao: 1, status, codigo: status === 'rascunho' ? null : 'ABCDEFGHJKMN', createdAt: new Date('2026-09-01T12:00:00Z'),
    assinadoEm: ['assinado', 'substituido'].includes(status) ? new Date('2026-09-02T12:00:00Z') : null, assinaturaTipo: ['assinado', 'substituido'].includes(status) ? 'digitalizada' : null,
    pdfStatus: null, entregueEm: null, recibos: [], conteudo: { versao: 1, tipo: 'receita', itens: [], orientacoes: '' }, justificativa: null, motivoCancelamento: null,
    assinanteNome: null, basePdfPath: null, pdfPath: 'x', pdfSha256: 'a'.repeat(64), digitalizacaoStatus: null, digitalizacaoEm: null, anonimizadoEm: null, canceladoEm: null,
    retificaId: null, motivoRetificacao: null, substituidoEm: null, versoes: { anterior: null, seguinte: null }, ...extra,
  });
  const pagina = async (d: Record<string, unknown>, paciente: Record<string, unknown> = { status: 'ativo' }) => {
    caso.twoFactorEnabled = true;
    caso.paciente = { id: PACIENTE, anonimizadoEm: null, userId: null, email: 'ana@ex.com', ...paciente };
    caso.doc = d;
    return renderToStaticMarkup(await DocumentoPage({ params: Promise.resolve({ id: PACIENTE, docId: DOC }), searchParams: Promise.resolve({}) } as never));
  };

  it('assinado: o botão "Retificar" (não com o paciente bloqueado)', async () => {
    const html = await pagina(base('assinado'));
    expect(html).toContain('data-guia="retificar-documento"');
    expect(html).toContain('>Retificar<');
    expect(await pagina(base('assinado'), { status: 'bloqueado' })).not.toContain('>Retificar<');
  });

  it('rascunho da versão 2: "Versão 2 — substitui o documento ABCD-EFGH-JKMN" e o campo "Motivo da retificação" ("Fica só no prontuário.")', async () => {
    const html = await pagina(base('rascunho', { versao: 2, retificaId: '00000000-0000-4000-8000-0000000000d0', versoes: { anterior: { id: '00000000-0000-4000-8000-0000000000d0', versao: 1, codigo: 'ABCDEFGHJKMN' }, seguinte: null } }));
    expect(html).toContain('Versão 2 — substitui o documento ABCD-EFGH-JKMN');
    expect(html).toContain('Motivo da retificação');
    expect(html).toContain('name="motivoRetificacao"');
    expect(await pagina(base('rascunho'))).not.toContain('Motivo da retificação'); // a versão 1 não tem o campo
  });

  it('versão 2 preparada: o motivo só no prontuário; substituído: o cartão, a data, o link para a versão 2 e sem "Retificar" nem "Cancelar documento"', async () => {
    const preparada = await pagina(base('aguardando_assinatura', { versao: 2, retificaId: 'x', motivoRetificacao: 'Dose corrigida', pdfStatus: 'pronto', basePdfPath: 'b', pdfPath: null, versoes: { anterior: { id: 'x', versao: 1, codigo: 'ABCDEFGHJKMN' }, seguinte: null } }));
    expect(preparada).toContain('Motivo da retificação (só no prontuário): Dose corrigida');
    const V2 = '00000000-0000-4000-8000-0000000000d2';
    const html = await pagina(base('substituido', { substituidoEm: new Date('2026-09-10T12:00:00Z'), versoes: { anterior: null, seguinte: { id: V2, versao: 2, status: 'assinado' } } }));
    expect(html).toContain('Documento substituído');
    expect(html).toContain('Substituído em 10/09/2026 pela versão 2.');
    expect(html).toContain(`href="/painel/pacientes/${PACIENTE}/documentos/${V2}"`);
    expect(html).toContain('Abrir a versão 2');
    expect(html).toContain('Baixar PDF assinado');
    expect(html).not.toContain('>Retificar<');
    expect(html).not.toContain('Cancelar documento');
  });
});
```

Run: `pnpm vitest run "src/app/painel/pacientes/[id]/documentos"`
Expected: FAIL.

- [ ] **Step 2: As ações**

Em `actions.ts` (`import { retificarDocumento } from '@/modules/documentos/retificacao';`):

```ts
/** O editor manda os itens e as orientações num campo só (JSON), a justificativa à parte (D15 da spec) e, numa retificação, o motivo (Q13-1 ★). */
function lerEditor(f: FormData): { conteudo: unknown; justificativa: unknown; motivoRetificacao: unknown } | null {
  try {
    // ausente (versão 1: o campo não existe) = undefined, para o módulo não tocar no motivo
    return { conteudo: JSON.parse(String(f.get('conteudo') ?? '{}')), justificativa: f.get('justificativa'), motivoRetificacao: f.has('motivoRetificacao') ? f.get('motivoRetificacao') : undefined };
  } catch {
    return null;
  }
}
```

em `salvarParecerAction` e `prepararParecerAction`, `salvarRascunhoParecer(ctx, patientId, docId, { conteudo: editor.conteudo, motivoRetificacao: editor.motivoRetificacao })` (a receita já recebe o `editor` inteiro) e, no fim do arquivo:

```ts
/** US-148: "Retificar" abre a versão nova — ou a retificação que já está em andamento (uma por vez). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- o estado anterior do useActionState (AcaoDocumento) não é usado
export async function retificarAction(patientId: string, docId: string, _prev: EstadoForm): Promise<EstadoForm> {
  const { ctx } = await acesso(caminho(patientId, docId));
  let id: string;
  try {
    id = await retificarDocumento(ctx, patientId, docId);
  } catch (e) {
    return comoEstado(e);
  }
  revalidatePath(caminho(patientId), 'layout');
  redirect(caminho(patientId, id));
}
```

- [ ] **Step 3: O campo do motivo nos dois editores**

Criar `src/app/painel/pacientes/[id]/documentos/[docId]/motivo-retificacao.tsx`:

```tsx
'use client';

/**
 * US-148 / Q13-1 ★ (SBIS NGS1.12.01): por que esta versão corrige a anterior. Só numa retificação; obrigatório para preparar;
 * fica só no prontuário (como o motivo do cancelamento). Controlado pelo editor (o reset do React 19 o apagaria depois de um erro).
 */
export function MotivoRetificacao({ valor, aoMudar, erro }: { valor: string; aoMudar: (v: string) => void; erro?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor="motivoRetificacao" className="block font-medium">Motivo da retificação</label>
      <textarea
        id="motivoRetificacao"
        name="motivoRetificacao"
        maxLength={500}
        value={valor}
        onChange={(ev) => aoMudar(ev.target.value)}
        aria-invalid={erro ? true : undefined}
        aria-describedby={erro ? 'motivoRetificacao-dica motivoRetificacao-erro' : 'motivoRetificacao-dica'}
        className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
      />
      <p id="motivoRetificacao-dica" className="text-sm text-suave">Fica só no prontuário.</p>
      {erro && <p id="motivoRetificacao-erro" role="alert" className="text-sm text-erro">{erro}</p>}
    </div>
  );
}
```

Nos dois editores, a prop nova **opcional** `motivo?: string | null`, com padrão `null` na desestruturação (`motivo = null`; `null` = não é retificação, o campo não aparece). Opcional para o `receita-form.test.ts` (que monta o `ReceitaForm` sem `motivo`) continuar compilando no `pnpm typecheck`:

- `receita-form.tsx`: `import { MotivoRetificacao } from './motivo-retificacao';`; na assinatura, `motivo` depois de `declaracao`; `const [motivoRet, setMotivoRet] = useState(motivo ?? '');`; logo no começo do `editor` (antes de `<h3>Itens da receita</h3>`): `{motivo !== null && <MotivoRetificacao valor={motivoRet} aoMudar={setMotivoRet} erro={erroDe('motivoRetificacao')} />}` (o `erroDe` marca a chave em `mostradas`, então ela não se repete no aviso geral).
- `parecer-form.tsx`: o mesmo import, a mesma prop e o mesmo estado; o campo logo depois da abertura do `<form>` (antes do `fieldset` dos exames), com `erro={e.motivoRetificacao}`, e `'motivoRetificacao'` na lista de chaves conhecidas do cálculo de `sobras`.

- [ ] **Step 4: A página e a lista**

Em `[docId]/page.tsx` (imports: `linhaDaVersao` das constantes, `retificarAction` de `../actions`, `Link` de `next/link`):

1. Os editores recebem `motivo={d.retificaId ? (d.motivoRetificacao ?? '') : null}`.
2. No cabeçalho, logo depois do `<div>` do título, do selo e do código:

```tsx
      {/* Q13-5 ★ / NGS1.01.01: a versão nova diz qual ela substitui; o motivo (Q13-1 ★) fica só no prontuário */}
      {d.versoes.anterior?.codigo && <p className="text-sm text-suave">{linhaDaVersao(d.versao, formatarCodigo(d.versoes.anterior.codigo))}</p>}
      {d.status !== 'rascunho' && d.motivoRetificacao && <p className="text-sm text-suave">{`Motivo da retificação (só no prontuário): ${d.motivoRetificacao}`}</p>}
```

3. No cartão "Documento assinado", antes do `Cancelar`:

```tsx
          {/* US-148: só a versão em vigor; com uma retificação em andamento, o botão abre a mesma (uma por vez) */}
          {!bloqueado && (
            <div className="mt-4" data-guia="retificar-documento">
              <AcaoDocumento acao={retificarAction.bind(null, paciente.id, d.id)} rotulo="Retificar" secundario />
            </div>
          )}
```

4. Depois do cartão "Documento cancelado", o do substituído:

```tsx
      {d.status === 'substituido' && (
        <Cartao id="documento-substituido" titulo="Documento substituído">
          {d.substituidoEm && d.versoes.seguinte && <p>{`Substituído em ${dataHora(d.substituidoEm, tenant.fuso).split(' às ')[0]} pela versão ${d.versoes.seguinte.versao}.`}</p>}
          {d.versoes.seguinte && (
            <Link href={`/painel/pacientes/${paciente.id}/documentos/${d.versoes.seguinte.id}`} className="inline-flex min-h-11 items-center text-link underline">
              {`Abrir a versão ${d.versoes.seguinte.versao}`}
            </Link>
          )}
          {emitido}
        </Cartao>
      )}
```

Em `src/app/painel/pacientes/[id]/documentos/page.tsx`, importar `rotuloDaVersao` e trocar o texto do link da lista por `` {`${TIPO_DOCUMENTO_ROTULO[d.tipo]} de ${formatarData(hojeNoFuso(tenant.fuso, d.createdAt))}${d.versao > 1 ? ` · ${rotuloDaVersao(d.versao)}` : ''}`} ``.

- [ ] **Step 5: Rodar**

Run: `pnpm vitest run "src/app/painel/pacientes/[id]/documentos" src/app/painel/acoes-de-paciente.test.ts src/app/painel/cores.test.ts src/app/formularios-post.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "src/app/painel/pacientes/[id]/documentos"
git commit -m "feat(documentos): retificar no painel — motivo, versão, documento substituído e cancelar com retificação em andamento (P13-09)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 10: Manual guiado (guia `documentos` v2) e o E2E do parecer e da retificação (P13-10)

**Revisão: leve (revisor-interface)** — textos do manual guiado (rascunho até a Debby, como o P08-08), E2E e axe do editor do parecer e do cartão do substituído.

**Files:**
- Modify: `src/modules/ajuda/conteudo.ts` (+ `conteudo.test.ts`; guias `documentos` e `configuracoes`), `e2e/documentos.ts` (`assinarDigitalizada` extraída de `emitirReceita`), `scripts/e2e-seed.ts` (limite da verificação do IP sem login)
- Create: `e2e/parecer.spec.ts`

**Interfaces:**
- Consumes: tudo das T5, T8 e T9 (textos, rótulos e `data-guia`); `entrarComoDocs`, `violacoesNoPainel`, `pacienteNoPortal`.
- Produces: `assinarDigitalizada(page, opcoes?)` em `e2e/documentos.ts`; o guia `documentos` v2.

- [ ] **Step 1: O manual guiado**

Em `src/modules/ajuda/conteudo.ts`, no guia `documentos`: `versao: 2` (quem já viu o tour, vê de novo), `titulo: 'Documentos: receita e parecer'` e:

```ts
    ajuda: {
      resumo: 'Receitas de suplementos e fitoterápicos e pareceres nutricionais sobre os exames, assinados por você à mão (digitalizada) e entregues ao paciente com código de verificação.',
      secoes: [
        {
          titulo: 'Passo a passo',
          itens: [
            'Clique em "Nova receita" (adicione os itens e escreva a justificativa de uso, que fica no prontuário e não vai na receita) ou em "Novo parecer nutricional" (escolha os exames e escreva a avaliação). Clique em "Salvar rascunho".',
            'Clique em "Preparar para assinatura" e confirme a declaração. Em alguns segundos o PDF fica pronto.',
            'Clique em "Baixar PDF para assinar", imprima, assine à mão e envie as fotos das páginas em "Enviar documento digitalizado (assinado à mão)", com o código da verificação em duas etapas.',
            'Assinado, o documento vai para o app do paciente; quem não tem o app recebe um link por e-mail. Na consulta presencial, use "Entregue pessoalmente".',
          ],
        },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'Para assinar, a verificação em duas etapas precisa estar ativa (Segurança).',
            'Depois de assinado, o documento não muda. Errou, ou o exame mudou? Use "Retificar": a versão nova, com o motivo (fica só no prontuário), substitui a anterior quando for assinada. "Cancelar documento" é para o documento que não deve mais valer.',
            'O parecer guarda uma cópia dos valores dos exames. Se o exame mudar depois de preparar, a tela avisa e o parecer continua com a cópia.',
            'O parecer não afirma diagnóstico de doença nem prescreve medicamento: para isso, encaminhe ao médico.',
            'Qualquer pessoa com o código de verificação (o paciente, uma farmácia) confere a autenticidade sem ver o conteúdo.',
            '"Fitoterápico (forma farmacêutica ou fórmula magistral)" só aparece com a habilitação registrada em Configurações.',
          ],
        },
      ],
    },
    passos: [
      { alvo: 'nova-receita', titulo: 'Nova receita', texto: 'Comece aqui. A receita nasce como rascunho e só o paciente certo a recebe depois de assinada.' },
      { alvo: 'novo-parecer', titulo: 'Novo parecer nutricional', texto: 'O parecer lê os exames lançados na aba Exames: você escolhe os exames e escreve a avaliação, a conduta e os encaminhamentos.' },
      { alvo: 'editor-receita', titulo: 'Itens e justificativa', texto: 'Cada tipo de item pede os campos da resolução do CFN. A justificativa de uso fica só no prontuário.' },
      { alvo: 'editor-parecer', titulo: 'Exames e avaliação', texto: 'Os valores dos exames escolhidos são copiados a cada vez que você salva e congelados ao preparar.' },
      { alvo: 'preparar-documento', titulo: 'Preparar para assinatura', texto: 'A declaração confirma a sua responsabilidade. O PDF sai com a sua marca, o código de verificação e o QR code.' },
      { alvo: 'assinar-documento', titulo: 'Assinar e enviar', texto: 'Baixe o PDF, imprima, assine à mão e envie as fotos das páginas com o código da verificação em duas etapas. O sistema monta um PDF novo com o código e o QR.' },
      { alvo: 'entrega-documento', titulo: 'Entrega', texto: 'O paciente recebe pelo app ou por um link por e-mail. Aqui você vê se ele abriu e confirmou o recebimento, ou marca a entrega pessoal.' },
      { alvo: 'retificar-documento', titulo: 'Retificar', texto: 'Para corrigir um documento assinado, abra uma versão nova e escreva o motivo. A anterior continua valendo até a nova ser assinada.' },
      { alvo: 'cancelar-documento', titulo: 'Cancelar', texto: 'Documento que não deve mais valer? Cancele com o motivo (fica só no prontuário). A verificação pública passa a mostrar "cancelado".' },
    ],
```

Em `src/modules/ajuda/conteudo.test.ts`, acrescentar:

```ts
  it('Plano 13: o guia de documentos cita o parecer e a retificação e subiu de versão (quem já viu o tour, vê de novo)', () => {
    const g = GUIAS.find((x) => x.id === 'documentos')!;
    expect(g.versao).toBe(2);
    expect(g.passos.map((p) => p.alvo)).toEqual(expect.arrayContaining(['novo-parecer', 'editor-parecer', 'retificar-documento']));
    expect(JSON.stringify(g.ajuda)).toContain('"Novo parecer nutricional"');
  });
```

No guia `configuracoes` (revisão do plano: o carimbo também sai no parecer, T8): `versao: 3` → `versao: 4`; na seção "Dados para documentos" (`conteudo.ts:232`), "…que saem no carimbo das receitas, junto com o CRN." → "…que saem no carimbo das receitas e dos pareceres, junto com o CRN."; no passo `dados-documentos` (`:251`), "…do carimbo das receitas." → "…do carimbo das receitas e dos pareceres." (rascunho para a Debby).

Run: `pnpm vitest run src/modules/ajuda`
Expected: PASS (as guardas do arquivo conferem que cada alvo existe como `data-guia` e que cada nome entre aspas existe numa tela — "Novo parecer nutricional" e "Retificar" vêm da T8 e da T9).

- [ ] **Step 2: O envio digitalizado como ajudante do E2E**

Em `e2e/documentos.ts`, extrair o envio das fotos de `emitirReceita` (do clique em "Enviar documento digitalizado (assinado à mão)" até o `return` do código):

```ts
/**
 * O envio digitalizado (fotos + 2FA) do documento aberto em "Aguardando assinatura" — receita ou parecer (D2 = (a)).
 * Devolve o código de verificação como a tela mostra (XXXX-XXXX-XXXX). `noFormulario` roda com o formulário das fotos aberto.
 * Outra spec (outro processo do Playwright) pode assinar com a mesma conta no mesmo passo do TOTP: a recusa do código
 * repetido espera o próximo passo e envia de novo (no máximo 3 vezes; o acerto zera o contador de erros).
 */
export async function assinarDigitalizada(page: Page, opcoes: { noFormulario?: () => Promise<void> } = {}): Promise<string> {
  await page.getByRole('button', { name: 'Enviar documento digitalizado (assinado à mão)' }).click();
  await expect(page.getByRole('note').filter({ hasText: 'O sistema não confere o conteúdo de documentos digitalizados.' })).toBeFocused();
  await opcoes.noFormulario?.();
  const foto = await paginaAssinada();
  for (let tentativa = 1; ; tentativa++) {
    await page.getByLabel('Fotos das páginas (JPEG ou PNG, até 5)').setInputFiles(foto);
    await page.getByLabel('Código da verificação em duas etapas').fill(await codigoParaAssinar());
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/digitalizada')),
      page.getByRole('button', { name: 'Enviar', exact: true }).click(),
    ]);
    if (resposta.status() !== 422 || ((await resposta.json()) as { codigo?: string }).codigo !== 'codigo_2fa' || tentativa === 3) break;
    await expect(page.getByRole('alert').filter({ hasText: MSG_CODIGO_RECUSADO })).toBeVisible();
  }
  await expect(page.getByText('Assinado em', { exact: true })).toBeVisible({ timeout: 60_000 });
  return (await page.getByText(/^Código de verificação: /).innerText()).replace('Código de verificação: ', '');
}
```

e `emitirReceita` termina com `await expect(page.getByRole('link', { name: 'Baixar PDF para assinar' })).toBeVisible({ timeout: 60_000 });` seguido de `return assinarDigitalizada(page, opcoes);` (o resto do corpo antigo sai).

- [ ] **Step 3: O E2E do parecer e da retificação**

Bloco de IPs `10.9.18.x` (revisão do plano: o `10.9.15.x` já é do `ia-laudos.spec.ts`, .81–.85, e o `10.9.16.x` do `exames-enviados.spec.ts`; em 08/10/2026 `git grep -ohE "10\.9\.[0-9]+\." e2e scripts | sort -u` vai até `10.9.17.` — conferir de novo antes de criar). Em `scripts/e2e-seed.ts`, na lista do `liberarLimite` da verificação (linha 98, hoje `'10.9.14.77'` a `'10.9.14.80'`), acrescentar `'10.9.18.3'` (o visitante sem login consulta a `/v` duas vezes) e o `parecer.spec` no comentário da linha 97. Criar `e2e/parecer.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { assinarDigitalizada, entrarComoDocs, violacoesNoPainel } from './documentos';
import { pacienteNoPortal } from './portal';

// Plano 13 (US-141, US-146, US-147, US-148): o parecer de ponta a ponta pela digitalizada (D2 = (a)) e a retificação que
// substitui a versão 1. Conta própria com o 2FA ativo (E2E_DOCS do seed). IPs (bloco só deste spec): nutricionista
// 10.9.18.1, paciente .2, sem login .3 (zerado no seed, como os da documentos.spec).
test('parecer: exame → rascunho → preparar → digitalizada → portal → verificação; retificar → a versão 2 substitui a 1', async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await entrarComoDocs(browser, '10.9.18.1');
  const paciente = await pacienteNoPortal(browser, page, '10.9.18.2');

  // o exame lançado na aba Exames (US-015)
  await page.goto(`${paciente.prontuario}/exames`);
  await page.getByLabel('Título do exame').fill('Hemograma');
  await page.getByLabel('Data do exame').fill('2026-09-01');
  if ((await page.getByLabel('Marcador 1').count()) === 0) await page.getByRole('button', { name: 'Adicionar valor' }).click();
  await page.getByLabel('Marcador 1').fill('Hemoglobina');
  await page.getByLabel('Valor 1').fill('13,5');
  await page.getByLabel('Unidade 1').fill('g/dL');
  await page.getByRole('button', { name: 'Salvar exame' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Exame salvo.' })).toBeVisible();

  // US-141: o rascunho, o axe do editor e o preparo
  await page.goto(`${paciente.prontuario}/documentos`);
  await page.getByRole('button', { name: 'Novo parecer nutricional' }).click();
  await expect(page).toHaveURL(/\/documentos\/[0-9a-f-]{36}$/);
  const urlV1 = page.url();
  await page.getByLabel('Hemograma — 01/09/2026').check();
  await page.getByLabel('Avaliação nutricional').fill('Marcadores compatíveis com boa reserva de ferro.');
  await page.getByRole('button', { name: 'Salvar rascunho' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo.' })).toBeVisible();
  expect(await violacoesNoPainel(page), 'editor do parecer').toEqual([]);
  await page.getByLabel(/Declaro que este parecer não afirma diagnóstico de doença/).check();
  await page.getByRole('button', { name: 'Preparar para assinatura' }).click();
  await expect(page.getByRole('link', { name: 'Baixar PDF para assinar' })).toBeVisible({ timeout: 60_000 });
  const v1 = await assinarDigitalizada(page);
  await expect(page.getByText('Hemoglobina · 13,5 · g/dL · —')).toBeVisible();

  // US-146 v0.5: o portal com o título do parecer e o leitor de tela com o artigo certo
  const p = paciente.page;
  await p.goto('/p/documentos');
  await expect(p.getByRole('heading', { name: /^Parecer nutricional · / })).toBeVisible();
  await expect(p.getByRole('link', { name: /^Abrir PDF do parecer nutricional/ })).toBeVisible();

  // US-147 v0.5: "Tipo: Parecer nutricional", nada do paciente nem dos exames
  const anonimo = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.18.3' } })).newPage();
  await anonimo.goto(`/v/${v1.replace(/-/g, '')}`);
  await expect(anonimo.getByRole('heading', { name: 'Documento válido' })).toBeVisible();
  await expect(anonimo.getByText('Parecer nutricional')).toBeVisible();
  await expect(anonimo.getByText('Hemoglobina')).toHaveCount(0);
  await expect(anonimo.getByText(paciente.nome)).toHaveCount(0);

  // US-148: retificar com o motivo; assinada a 2, a 1 é "Substituído" (portal, verificação e painel)
  await page.getByRole('button', { name: 'Retificar' }).click();
  await expect(page.getByText(`Versão 2 — substitui o documento ${v1}`)).toBeVisible();
  await page.getByLabel('Motivo da retificação').fill('Encaminhamento acrescentado.');
  await page.getByLabel('Encaminhamentos (opcional)').fill('Sugiro avaliação médica.');
  await page.getByLabel(/Declaro que este parecer não afirma diagnóstico de doença/).check();
  await page.getByRole('button', { name: 'Preparar para assinatura' }).click();
  await expect(page.getByRole('link', { name: 'Baixar PDF para assinar' })).toBeVisible({ timeout: 60_000 });
  const v2 = await assinarDigitalizada(page);
  expect(v2).not.toBe(v1);
  await expect(page.getByText('Motivo da retificação (só no prontuário): Encaminhamento acrescentado.')).toBeVisible();

  await anonimo.goto(`/v/${v1.replace(/-/g, '')}`);
  await expect(anonimo.getByRole('heading', { name: /^Documento substituído/ })).toBeVisible();
  await p.goto('/p/documentos');
  await expect(p.getByRole('heading', { name: /· Versão 2$/ })).toBeVisible();
  await expect(p.getByText('Substituído por uma versão mais nova.')).toBeVisible();
  await page.goto(urlV1);
  await expect(page.getByRole('heading', { name: 'Documento substituído' })).toBeVisible();
  expect(await violacoesNoPainel(page), 'documento substituído').toEqual([]);

  await anonimo.context().close();
  await p.context().close();
  await page.context().close();
});
```

Run (com o ambiente do E2E de pé, como nos planos anteriores): `pnpm test:e2e e2e/parecer.spec.ts e2e/documentos.spec.ts e2e/acessibilidade.spec.ts`
Expected: PASS (o `documentos.spec.ts` da receita continua passando com o `assinarDigitalizada` extraído). Se o título do cartão do `Cartao` não for um *heading*, trocar o `getByRole('heading', { name: 'Documento substituído' })` por `getByText('Documento substituído', { exact: true })`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/ajuda/conteudo.ts src/modules/ajuda/conteudo.test.ts e2e/documentos.ts e2e/parecer.spec.ts scripts/e2e-seed.ts
git commit -m "test(documentos): E2E do parecer e da retificação; docs: guia documentos v2 no manual guiado (P13-10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 11: P09-07 — páginas e busca da lista de consultórios no `/admin` (P13-11)

**Revisão: completa (agente revisor-rls)** — consulta do admin só com `tenants`, `user`, `account` e `invites` (regra 1, guarda `sem-tabelas-tenant.test.ts`), busca sem curinga nem injeção, cursor validado, formulário GET na lista permitida.

**Files:**
- Modify: `src/modules/plataforma/contas.ts` (+ `contas.test.ts`), `src/app/admin/page.tsx`, `src/app/formularios-post.test.ts` (`GET_PERMITIDOS`), `e2e/plataforma.spec.ts`

**Interfaces:**
- Consumes: `tenants`, `user`, `account`, `invites` (como hoje); as quatro funções de métricas (sem mudança, D-P5).
- Produces: `CONTAS_POR_PAGINA`, `BUSCA_CONTAS_MAX`, `FiltroContas`, `PaginaDeContas`, `listarContas(db?, now?, f?)` devolvendo a página.

- [ ] **Step 1: Os testes que falham**

Em `src/modules/plataforma/contas.test.ts`:

1. Nos testes que já usam `listarContas`, procurar pela busca (com mais de 50 consultórios no banco de teste, a primeira página pode não ter o consultório do teste): `(await listarContas(app.db, quando)).find(…)` → `(await listarContas(app.db, quando, { busca: \`lista-${x}\` })).contas.find(…)` (o slug criado em cada teste: `lista-${x}`, `met-${x}`, `doc-${x}`); no teste `'listarContas mostra IA liberada, ativada e a cota'`, ler o slug antes — `const [t] = await app.db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, T.tenantId));` — e buscar por `t.slug`.
2. Acrescentar:

```ts
describe('P09-07: páginas e busca da lista de consultórios', () => {
  /** Cinco consultórios com o mesmo marcador no nome e no slug e `created_at` em segundos seguidos; devolve os ids do mais novo ao mais antigo. */
  async function cinco() {
    const marca = `p097${s()}`;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const [t] = await app.db.insert(tenants).values({ slug: `${marca}-${i}`, nomeExibicao: `Consultório ${marca} ${i}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) }).returning({ id: tenants.id });
      ids.push(t.id);
    }
    return { marca, ids: ids.reverse() };
  }
  const ids = (p: { contas: { tenantId: string }[] }) => p.contas.map((c) => c.tenantId);

  it('cursor: "Próxima" até o fim e "Anterior" de volta, sem repetir nem pular (created_at desc, id desc), com duas nutricionistas no mesmo consultório', async () => {
    const { marca, ids: t } = await cinco();
    // revisão do plano: nada impede duas usuárias 'nutri' no mesmo consultório (o seed do E2E cria três); uma linha por consultório
    for (const n of [1, 2]) await app.db.insert(user).values({ name: `Nutri ${n}`, email: `${marca}-${n}@teste.local`, appRole: 'nutri', tenantId: t[2] });
    expect(ids(await listarContas(app.db, now, { busca: `${marca}-2@teste.local` }))).toEqual([t[2]]);
    const p1 = await listarContas(app.db, now, { busca: marca, limite: 2 });
    expect(ids(p1)).toEqual(t.slice(0, 2));
    expect(p1).toMatchObject({ anterior: null, proxima: t[1] });
    const p2 = await listarContas(app.db, now, { busca: marca, depois: p1.proxima, limite: 2 });
    expect(ids(p2)).toEqual(t.slice(2, 4));
    expect(p2).toMatchObject({ anterior: t[2], proxima: t[3] });
    const p3 = await listarContas(app.db, now, { busca: marca, depois: p2.proxima, limite: 2 });
    expect(ids(p3)).toEqual([t[4]]);
    expect(p3).toMatchObject({ anterior: t[4], proxima: null });
    const volta = await listarContas(app.db, now, { busca: marca, antes: p3.anterior, limite: 2 });
    expect(ids(volta)).toEqual(t.slice(2, 4));
    expect(volta).toMatchObject({ anterior: t[2], proxima: t[3] });
    const inicio = await listarContas(app.db, now, { busca: marca, antes: volta.anterior, limite: 2 });
    expect(ids(inicio)).toEqual(t.slice(0, 2));
    expect(inicio).toMatchObject({ anterior: null, proxima: t[1] });
  });

  it('busca por nome, endereço (slug) ou e-mail, sem diferenciar maiúsculas; % e _ são literais; até 100 caracteres; só espaços = sem busca', async () => {
    const { marca, ids: t } = await cinco();
    // a parte ASCII em maiúsculas (o lower() do Postgres em collation C não troca o Ó)
    expect(ids(await listarContas(app.db, now, { busca: `consultório ${marca.toUpperCase()} 3` }))).toEqual([t[1]]);
    expect(ids(await listarContas(app.db, now, { busca: `${marca}-0` }))).toEqual([t[4]]);
    const N = await novoTenant(app.db);
    const [u] = await app.db.select({ email: user.email }).from(user).where(eq(user.tenantId, N.tenantId));
    expect(ids(await listarContas(app.db, now, { busca: u.email.toUpperCase() }))).toEqual([N.tenantId]);
    expect((await listarContas(app.db, now, { busca: `${marca}%` })).contas).toEqual([]);
    expect((await listarContas(app.db, now, { busca: `${marca}_0` })).contas).toEqual([]);
    expect((await listarContas(app.db, now, { busca: `${marca}${'x'.repeat(200)}` })).busca).toHaveLength(100);
    expect((await listarContas(app.db, now, { busca: '   ' })).busca).toBe('');
  });

  it('cursor que não é uuid ou de consultório inexistente = primeira página; a página nunca passa de 50', async () => {
    const { marca, ids: t } = await cinco();
    expect(ids(await listarContas(app.db, now, { busca: marca, depois: "x' or 1=1 --", limite: 2 }))).toEqual(t.slice(0, 2));
    expect(ids(await listarContas(app.db, now, { busca: marca, depois: randomUUID(), limite: 2 }))).toEqual(t.slice(0, 2));
    expect((await listarContas(app.db, now)).contas.length).toBeLessThanOrEqual(CONTAS_POR_PAGINA);
  });
});
```

(com `CONTAS_POR_PAGINA` no import de `./contas` e `user` no de `@/db/schema`, se ainda não estiverem.)

Run: `pnpm vitest run src/modules/plataforma/contas.test.ts`
Expected: FAIL (`listarContas` devolve a lista inteira, sem `contas`/`anterior`/`proxima`).

- [ ] **Step 2: `listarContas` com páginas e busca**

Em `src/modules/plataforma/contas.ts`, trocar `listarContas` por:

```ts
/** P09-07: 50 consultórios por página; a busca vai até 100 caracteres. */
export const CONTAS_POR_PAGINA = 50;
export const BUSCA_CONTAS_MAX = 100;
/** `depois`/`antes`: o id do último/primeiro consultório da página vista ("Próxima"/"Anterior"); `limite` só nos testes. */
export type FiltroContas = { busca?: unknown; depois?: unknown; antes?: unknown; limite?: number };
export type PaginaDeContas = { contas: ContaResumo[]; anterior: string | null; proxima: string | null; busca: string };

type LinhaConta = {
  tenant_id: string; slug: string; nome_exibicao: string; status: 'ativa' | 'suspensa'; crn: string | null;
  created_at: Date; email: string | null; tem_senha: boolean; convite_expira: Date | null; wa_cota_mensal: number;
  taxa_faltas_base: string | null; go_live_em: string | null; documentos_liberados: boolean;
  ia_liberada: boolean; ia_ativada: boolean; ia_cota_mensal_usd: string;
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cursor = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

/**
 * Lista para o admin: só `tenants`, `user`, `account` e `invites` — nenhuma tabela 🔒. P09-07 (Plano 13): por páginas de
 * 50, com cursor = o id de um consultório (a comparação `(created_at, id)` usa a linha dele no banco, sem perder os
 * microssegundos do `created_at` no JavaScript) e busca por nome de exibição, slug ou e-mail da nutricionista, sem
 * diferenciar maiúsculas — por `position()`, então `%` e `_` são literais (sem LIKE). Cursor inválido ou de consultório
 * que não existe = primeira página.
 */
export async function listarContas(db: Db = getDb(), now: Date = new Date(), f: FiltroContas = {}): Promise<PaginaDeContas> {
  const busca = typeof f.busca === 'string' ? f.busca.trim().slice(0, BUSCA_CONTAS_MAX) : '';
  const antes = cursor(f.antes);
  const depois = antes ? null : cursor(f.depois);
  const limite = f.limite ?? CONTAS_POR_PAGINA;
  // o e-mail de QUALQUER nutricionista do consultório entra na busca (exists), sem repetir o consultório
  const filtroBusca = busca
    ? sql`and (position(lower(${busca}) in lower(t.nome_exibicao || ' ' || t.slug)) > 0
           or exists (select 1 from "user" ub where ub.tenant_id = t.id and ub.app_role = 'nutri' and position(lower(${busca}) in lower(ub.email::text)) > 0))`
    : sql``;
  const filtroCursor = depois
    ? sql`and (t.created_at, t.id) < (select c.created_at, c.id from tenants c where c.id = ${depois}::uuid)`
    : antes
      ? sql`and (t.created_at, t.id) > (select c.created_at, c.id from tenants c where c.id = ${antes}::uuid)`
      : sql``;
  const ordem = antes ? sql`order by t.created_at asc, t.id asc` : sql`order by t.created_at desc, t.id desc`;
  const r = await db.execute<LinhaConta>(sql`
    select t.id as tenant_id, t.slug, t.nome_exibicao, t.status, t.crn, t.created_at, t.wa_cota_mensal, u.email,
           t.taxa_faltas_base, to_char(t.go_live_em, 'YYYY-MM-DD') as go_live_em, t.documentos_liberados,
           t.ia_liberada, t.ia_ativada_em is not null as ia_ativada, t.ia_cota_mensal_usd,
           exists (select 1 from account a where a.user_id = u.id and a.provider_id = 'credential') as tem_senha,
           (select max(i.expira_em) from invites i where i.user_id = u.id and i.usado_em is null) as convite_expira
      from tenants t
      -- uma linha por consultório (revisão do plano): com duas usuárias 'nutri' no mesmo tenant, o join simples repetiria o
      -- consultório, o limit contaria linhas e o cursor (created_at, id) pularia as outras linhas dele na "Próxima"
      left join lateral (select u1.id, u1.email from "user" u1 where u1.tenant_id = t.id and u1.app_role = 'nutri'
                          order by u1.created_at, u1.id limit 1) u on true
     where true ${filtroBusca} ${filtroCursor}
     ${ordem}
     limit ${limite + 1}`);
  if ((depois || antes) && !r.rows.length) return listarContas(db, now, { busca, limite: f.limite });
  const temMais = r.rows.length > limite;
  const linhas = r.rows.slice(0, limite);
  if (antes) linhas.reverse();
  const contas = linhas.map((row): ContaResumo => {
    const expira = row.convite_expira ? new Date(row.convite_expira) : null;
    const convite = row.tem_senha ? 'aceito' : !expira ? 'sem_convite' : expira.getTime() > now.getTime() ? 'pendente' : 'expirado';
    return {
      tenantId: row.tenant_id, slug: row.slug, nomeExibicao: row.nome_exibicao, status: row.status, crn: row.crn,
      email: row.email, convite, conviteExpiraEm: expira, criadaEm: new Date(row.created_at), waCotaMensal: row.wa_cota_mensal,
      taxaFaltasBase: row.taxa_faltas_base === null ? null : Number(row.taxa_faltas_base), goLiveEm: row.go_live_em,
      documentosLiberados: row.documentos_liberados,
      iaLiberada: row.ia_liberada, iaAtivada: row.ia_ativada, iaCotaMensalUsd: Number(row.ia_cota_mensal_usd),
    };
  });
  const primeira = contas[0]?.tenantId ?? null;
  const ultima = contas.at(-1)?.tenantId ?? null;
  return {
    contas,
    busca,
    // voltando ("Anterior"), há sempre a página de onde se veio; indo, há anterior se chegou por um cursor
    anterior: antes ? (temMais ? primeira : null) : depois ? primeira : null,
    proxima: antes ? ultima : temMais ? ultima : null,
  };
}
```

- [ ] **Step 3: A página**

Em `src/app/admin/page.tsx`:

```tsx
export default async function AdminHome({ searchParams }: PageProps<'/admin'>) {
  const { user } = await requireUser(['admin'], '/admin');
  const { aviso, busca, depois, antes } = await searchParams;
  const a = typeof aviso === 'string' ? AVISOS[aviso] : undefined;
  // D-P5: as métricas continuam vindo de todos os consultórios (funções SECURITY DEFINER sem parâmetro); a página só desenha os 50 dela
  const [pagina, metricas, sucesso, iaMetricas, exames] = await Promise.all([listarContas(undefined, undefined, { busca, depois, antes }), metricasPorTenant(), metricasDeSucessoPorTenant(), metricasDeIaPorTenant(), metricasDeExamesEnviadosPorTenant()]);
  const contas = pagina.contas;
  const linkDaPagina = (c: { depois?: string; antes?: string }) => {
    const q = new URLSearchParams();
    if (pagina.busca) q.set('busca', pagina.busca);
    if (c.depois) q.set('depois', c.depois);
    if (c.antes) q.set('antes', c.antes);
    return `/admin?${q.toString()}`;
  };
```

e, entre a seção "Verificação em duas etapas" e a `<table>`:

```tsx
      {/* P09-07: busca e páginas da lista (GET: a busca não é dado de saúde; GET_PERMITIDOS) */}
      <form method="get" action="/admin" role="search" className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="busca" className="block text-sm font-medium">Buscar por nome, endereço ou e-mail</label>
          <input id="busca" name="busca" type="search" maxLength={100} defaultValue={pagina.busca} className="rounded border p-2" />
        </div>
        <button className="min-h-11 rounded border px-4">Buscar</button>
        {pagina.busca && <Link href="/admin" className="inline-flex min-h-11 items-center underline">Limpar busca</Link>}
      </form>
      {contas.length === 0 && <p>Nenhuma conta encontrada.</p>}
```

a `<table>` só com `contas.length > 0` (`{contas.length > 0 && (<table …>…</table>)}`) e, depois dela:

```tsx
      {(pagina.anterior || pagina.proxima) && (
        <nav aria-label="Páginas da lista de contas" className="flex gap-4">
          {pagina.anterior && <Link href={linkDaPagina({ antes: pagina.anterior })} className="inline-flex min-h-11 items-center underline">Anterior</Link>}
          {pagina.proxima && <Link href={linkDaPagina({ depois: pagina.proxima })} className="inline-flex min-h-11 items-center underline">Próxima</Link>}
        </nav>
      )}
```

Em `src/app/formularios-post.test.ts`, em `GET_PERMITIDOS`: `'src/app/admin/page.tsx': 'P09-07: busca da lista de consultórios do admin (nome, endereço, e-mail da nutricionista — sem dado de saúde)',`.

- [ ] **Step 4: O E2E e o axe**

Em `e2e/plataforma.spec.ts` (`import AxeBuilder from '@axe-core/playwright';`), nos testes que abrem `/admin` para achar a linha do consultório criado (`admin.getByRole('row', { name: new RegExp(NUTRI.slug) })`), trocar `admin.goto('/admin')` por ``admin.goto(`/admin?busca=${NUTRI.slug}`)`` (depois de uma ação, o redirecionamento volta à primeira página, desvio 8: com poucos consultórios no banco do E2E, a linha continua nela) e acrescentar, depois do teste de criação da conta:

```ts
test('P09-07: a busca acha o consultório pelo endereço e pelo e-mail; sem resultado, "Nenhuma conta encontrada."; axe da página', async () => {
  await admin.goto('/admin');
  await admin.getByLabel('Buscar por nome, endereço ou e-mail').fill(NUTRI.slug);
  await admin.getByRole('button', { name: 'Buscar' }).click();
  await expect(admin).toHaveURL(new RegExp(`/admin\\?busca=${NUTRI.slug}`));
  await expect(admin.getByRole('row', { name: new RegExp(NUTRI.slug) })).toBeVisible();
  await expect(admin.getByRole('row')).toHaveCount(2); // o cabeçalho e o consultório
  await admin.goto(`/admin?busca=${encodeURIComponent(NUTRI.email)}`);
  await expect(admin.getByRole('row', { name: new RegExp(NUTRI.slug) })).toBeVisible();
  await admin.goto('/admin?busca=%25%25nada-assim%25%25');
  await expect(admin.getByText('Nenhuma conta encontrada.')).toBeVisible();
  const r = await new AxeBuilder({ page: admin }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});
```

Se o axe acusar algo **fora** da busca e da navegação (a página do admin nunca passou pelo axe), registrar no backlog como Minor do P09-07 e restringir esta conferência com `.include('form[role="search"]')` e `.include('nav[aria-label="Páginas da lista de contas"]')` — não corrigir o resto da página nesta tarefa.

- [ ] **Step 5: Medir e rodar**

Run: `pnpm vitest run src/modules/plataforma/contas.test.ts src/app/admin/sem-tabelas-tenant.test.ts src/app/formularios-post.test.ts && pnpm typecheck && pnpm test:e2e e2e/plataforma.spec.ts e2e/auth.spec.ts`
Expected: PASS. No banco de dev (com ~220 consultórios de teste, **sem** produção), abrir `/admin` com `pnpm dev` e anotar no PR o tamanho do HTML e o tempo (antes: 1,8 MB e ~11 s); se as quatro funções de métricas sozinhas passarem de 1 s, registrar no backlog o parâmetro de ids (D-P5).

- [ ] **Step 6: Commit**

```bash
git add src/modules/plataforma/contas.ts src/modules/plataforma/contas.test.ts src/app/admin/page.tsx src/app/formularios-post.test.ts e2e/plataforma.spec.ts
git commit -m "feat(admin): paginação por cursor e busca na lista de consultórios (P09-07, P13-11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 12: Fechamento — manual técnico, CLAUDE.md, runbook, índice, backlog e spec (P13-12)

**Revisão: leve (revisor-interface)** e **`guardiao-manual`** (`.claude/agents/guardiao-manual.md`) no capítulo 09, no README e no cabeçalho do capítulo 11.

**Files:**
- Modify: `docs/manual-tecnico/09-documentos-assinados.md`, `docs/manual-tecnico/11-exames-enviados.md` (cabeçalho), `docs/manual-tecnico/README.md`, `docs/operacao/go-live.md` (seção do Plano 13), `CLAUDE.md` (regra 9, se a revisão final pedir), `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md`, `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md`, `docs/superpowers/specs/2026-10-03-nutridebby-documentos-assinados-design.md` (status e nota "v0.6"), `docs/superpowers/specs/2026-10-03-nutridebby-ia-nutricionista-design.md` (§5.10)

**Interfaces:**
- Consumes: tudo das Tarefas 1–11.
- Produces: o manual técnico atualizado (cap. 09 com o parecer e a retificação; cap. 11 sem o "sem merge"; README com as migrations 0104–0105); o runbook do dono (seção abaixo) em `docs/operacao/go-live.md`; índice, backlog e spec com o estado do Plano 13.

- [ ] **Step 1: Manual técnico**

Conferido contra o código do branch: no capítulo 09, uma seção "9.x Parecer nutricional e retificação (Plano 13)" com: o fluxo (`criarParecer` → `salvarRascunhoParecer`/`copiarExames` → `prepararParaAssinatura` → `documento-pdf.tsx` → digitalizada → `registrarAssinatura`), o `ConteudoParecer` e a cópia (o que entra e o que nunca entra — o laudo), `situacaoDosExames` (sem `auditRead`, D-P2), a retificação (`retificarDocumento`, `retificacaoEmAndamento`, o motivo em `signed_document_notes.motivo_retificacao`, a substituição em `registrarAssinatura`), a ordem de travas (paciente → original → versão nova → tenant, `travarDocumentoAntesDaCota`), os gatilhos da 0105 (`app_documento_versao` e as três regras novas de `app_documento_imutavel`, com a tabela de transições atualizada), a exportação (`versao`, `retificaCodigo`, `motivoDaRetificacao` só na equipe, `exames`/`avaliacao`/`conduta`/`encaminhamentos`), o portal/link/verificação pelo tipo, as decisões Q13-1 a Q13-6 como o dono as tomou e os desvios 1–11 deste plano; na seção de divergências, os "Pontos menores" que ficarem. No capítulo 11, trocar "(Tarefas 1–14 integradas; ainda sem merge na `main`)" por "(em produção desde o merge do PR #25, `3b59c38`)" (desvio 11 da spec v0.5). No README, "Conferido contra"/"Escopo" com o Plano 13 e as migrations `0104`–`0105`, e a P09-07 citada no capítulo do admin (o que mudou em `listarContas`, inclusive uma linha por consultório com o e-mail da primeira nutricionista e a busca em todas). No cap. 09, registrar também a janela do expand/contract da 0104 (D-P8) e que a versão nova só nasce em rascunho (0105).

- [ ] **Step 2: Runbook, índice, backlog e spec**

Em `docs/operacao/go-live.md`, uma seção "## Plano 13 — parecer nutricional e retificação" com o **Runbook do dono** abaixo (copiado sem mudança). No índice, a linha do Plano 13 passa a apontar para a spec **v0.5** e para este plano, situação "Em execução". No backlog: P13-00 com o link deste plano; as linhas P13-01 a P13-12 (uma por tarefa); P13-13 (liberação do parecer para uso real — dono, runbook); P09-07 marcada como feita na T11 (✅ quando o PR entrar); os "Pontos menores" do fim deste plano como Minors do Plano 13. Na spec, no cabeçalho, uma linha "Revisão 0.6" curta (o que a execução mudou, conferido no código: as respostas do dono a Q13-1..5, os desvios deste plano que valerem) e "Status" da parte do Plano 13: "em execução (plano `2026-10-08-nutridebby-13-parecer.md`)" — o fechamento do PR muda para "em produção". A revisão 0.6 cita o desvio 11 (isolamento, frase de "Migrations propostas" já corrigida) e a Q13-6.

Revisão do plano (normas), na mesma etapa:
- **Spec da IA, §5.10:** depois de "A leitura de laudo não gera material entregue ao paciente", acrescentar: "Desde o Plano 13, os valores lidos pela IA e conferidos pela nutricionista chegam ao paciente no PDF do parecer nutricional (cópia congelada, Q13-2); se isso é "material produzido com suporte de IA" (art. 37) está em consulta ao CRN-3 (P-B1), com resposta antes da vigência (23/01/2027)." Ajustar a frase da vigência que diz que ela "não bloqueia o Plano 11" para dizer que ela pode pedir a nota de origem no parecer (Q13-2 (b)).
- **`docs/operacao/go-live.md`:** no item do CRN-3 (P-B1, linha 44), acrescentar "a pergunta do art. 37 da Res. CFN 856/2026 sobre o parecer com valores lidos por IA (Q13-2)" e "a declaração e a ressalva do parecer (D5)"; no item do termo e DPA (P-B3/E-09, linha 46), acrescentar "o motivo da retificação fora da exportação do titular, junto com o motivo de cancelamento da D15 (Q13-1)"; na seção do Plano 13, o runbook abaixo (com a conferência do interruptor no passo 2).

- [ ] **Step 3: Verificação completa**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tudo verde.

- [ ] **Step 4: Commit**

```bash
git add docs/manual-tecnico docs/operacao/go-live.md CLAUDE.md docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md \
  docs/superpowers/plans/2026-09-27-nutridebby-backlog.md docs/superpowers/specs/2026-10-03-nutridebby-documentos-assinados-design.md \
  docs/superpowers/specs/2026-10-03-nutridebby-ia-nutricionista-design.md
git commit -m "docs: manual técnico (cap. 09 e 11), runbook, índice, backlog e spec do Plano 13 (P13-12)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

## Runbook do dono (Plano 13 — parecer nutricional e retificação)

Nenhum passo é do código; cada um tem dono. O parecer **segue o interruptor** `documentos_liberados` do Plano 10A e **não tem interruptor próprio** (Q13-6 ★): o runbook parte de que ele está **desligado** em todo consultório no dia do merge — o passo 2 confere. A liberação da receita (checklist do 10A em `docs/operacao/go-live.md`) não espera o Plano 13; se ela vier antes do merge, o parecer entra no ar no deploy, para quem já estiver liberado.

1. **Antes da execução.** Responder Q13-1 a Q13-6 (seção "Decisões do dono"): o plano aplica as recomendações da spec; uma resposta diferente muda as tarefas indicadas.
2. **Antes do merge (merge = deploy).** Snapshot da VPS no hPanel; OK explícito do dono no PR. Conferir no PR o job `image` do CI (orçamento de 265 MB; o plano não traz dependência nova). As migrations `0104`/`0105` rodam no deploy com `DATABASE_URL_MIGRATOR` (durante a 0104, o worker pode registrar `42703` por alguns segundos; os jobs repetem — D-P8). **Conferir no `/admin` que nenhum consultório está com "Documentos: Liberados".** Se algum estiver, só fazer o merge depois dos passos 4 (Debby) e 5 (CRN-3 e advogado): o parecer apareceria na hora, com a declaração e a ressalva ainda em rascunho (risco R9).
3. **Backup no host (P02-11) — continua pendente.** Os PDFs dos pareceres ficam só em `/data` da VPS até o backup ser ligado. Não liberar documentos para dado real antes do backup.
4. **Textos para a Debby (rascunho, como o P08-08).** A declaração e a ressalva do parecer (D5), os textos propostos (desvio 9: exame excluído, versão, substituído, motivo da retificação) o guia `documentos` v2 do manual guiado e o carimbo "das receitas e dos pareceres" no perfil (T8) e no guia `configuracoes` (T10). Mudou algum texto: troca-se no código e na spec antes da liberação.
5. **Consulta ao CRN-3 (P-B1) e ao advogado (P-B3/E-09).** Ao CRN-3, junto das perguntas da receita: (i) a D2 — se o CRN-3 confirmar que a assinatura na plataforma com 2FA e código verificador (opção A) atende o parecer (Res. CFN 760/2023, art. 10, II), a D2 pode ir para (b), plano próprio (variante `preparando → assinado`, `assinatura_tipo = 'plataforma'`, textos da variante A); (ii) a declaração e a ressalva do parecer (D5), já revistas pela Debby no passo 4, se a consulta da receita já tiver sido enviada sem elas; (iii) o art. 37 da Res. CFN 856/2026: um parecer com valores de exame transcritos por IA e conferidos pela nutricionista é "material produzido com suporte de IA"? A resposta é necessária antes de 23/01/2027 (vigência; ato de prorrogação a conferir no DOU, P-B11) e decide a Q13-2 (se sim, a nota de origem no PDF, Q13-2 (b)). Ao advogado, junto do motivo de cancelamento da D15: o motivo da retificação fora da exportação do titular (Q13-1); se o titular tiver direito a ele, tirar a condição `escopo === 'equipe'` (T6).
6. **Teste no consultório (Debby, com dado fictício, depois da liberação de documentos do 10A).** Lançar um exame fictício (com valores e outro só com laudo), criar um parecer, preparar, assinar pela digitalizada, conferir o PDF ("Exames considerados", a ressalva, o código), o portal ("Parecer nutricional · …"), a verificação pública ("Tipo: Parecer nutricional"); acrescentar uma linha ao exame pela leitura com IA (se a IA estiver liberada) ou excluir o exame e ver o aviso; retificar com o motivo e assinar a versão 2; conferir a versão 1 "Substituído" no portal e na verificação, e um e-mail só ao paciente (Q13-3).
7. **Uso real.** Com 1–6 feitos, o parecer está disponível para a Debby junto com a receita (mesmo interruptor). Acompanhar, na primeira semana, os avisos "PDF do documento não gerado" e "PDF da digitalização não montado" no log do worker (só ids e motivo).

## Checagem final (antes do PR)

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verdes; `pnpm test:e2e` com `parecer.spec.ts`, `documentos.spec.ts`, `plataforma.spec.ts` e `acessibilidade.spec.ts` verdes.
- [ ] Guardas: `src/db/rls-guard.test.ts`, `src/db/audit-guard.test.ts`, `test/isolamento.test.ts`, `src/db/documentos-imutaveis.test.ts`, `src/db/documentos-versoes.test.ts`, `src/app/admin/sem-tabelas-tenant.test.ts`, `src/app/formularios-post.test.ts`, `src/app/painel/acoes-de-paciente.test.ts`, `src/app/painel/cores.test.ts`, `src/modules/pacientes/exportacao.test.ts` (grafo do worker), a guarda de sessão de `registrar-assinatura.test.ts`, `src/modules/documentos/verificacao.test.ts` (só `verificacao.ts` toca `document_verifications`) e `src/modules/ajuda/conteudo.test.ts`.
- [ ] `git grep -n "'Receita'" src/modules/documentos` só em `constantes.ts` (o rótulo) e em testes — nenhum ponto da lista "Pontos do código fixos em receita" da spec v0.5 ficou fixo.
- [ ] `git grep -n "motivo_retificacao\|motivoRetificacao"` só em schema, migrations, `documentos.ts`, `retificacao.ts`, `lgpd-documentos.ts`, telas do painel, testes, CLAUDE.md e docs (nunca no portal, no link, na verificação, em log ou e-mail).
- [ ] Nenhuma migration com `DISABLE TRIGGER`; a 0105 refaz `app_documento_imutavel` linha a linha a partir da 0093 (diff conferido na revisão).
- [ ] CLAUDE.md (regra 8), manual técnico (cap. 09, 11 e README), runbook em `docs/operacao/go-live.md`, índice, backlog e o status da spec atualizados; a medida do `/admin` no dev registrada no PR.
- [ ] Revisão final do branch (workflow) com uma onda de correções → `/code-review high` uma vez → correções Critical/Important → re-revisão do diff → `/security-review` (checklist em Global Constraints). Lembrar o dono do backup no host (P02-11).

## Riscos e pendências que ficam

| # | Risco / pendência | Onde está tratado | O que falta |
|---|---|---|---|
| R1 | Q13-1 a Q13-6 ainda são do dono; uma resposta diferente da recomendação muda T1, T5, T6, T7 e T9 | "Decisões do plano" (coluna "Se o dono decidir diferente") | Respostas antes da execução (runbook passo 1) |
| R2 | A 0105 reescreve `app_documento_imutavel` inteira (CS-141): um erro de cópia da 0093 abre uma transição | Teste de imutabilidade do 10A inteiro roda de novo (T1, Step 6) + os casos novos; checagem final (diff linha a linha) | Revisão completa da T1 com atenção ao diff |
| R3 | Deadlock entre assinar a versão nova e cancelar/retificar a original | D-P1 (ordem única), teste com duas conexões (T7), gatilho com `FOR SHARE` no INSERT (T1) | Monitorar `40P01` no log nas primeiras semanas |
| R4 | O parecer depende da liberação dos documentos (D20 do 10A), que depende do CRN-3, do termo/DPA e do backup | Runbook passos 3–7 | P-B1, P-B3, P02-11 (dono) |
| R5 | A declaração e a ressalva do parecer (D5) ainda são rascunho; o CRN-3 pode pedir outro texto | Runbook passos 4–5 | Debby e CRN-3 |
| R6 | E2E do `/admin` com mais de 50 consultórios no banco do E2E: depois de uma ação, a linha pode não estar na primeira página (desvio 8) | Testes do E2E abrem `/admin?busca=…`; o banco do E2E é novo a cada execução | Se acontecer, guardar a busca no redirecionamento das ações (backlog) |
| R7 | As métricas do `/admin` continuam calculadas para todos os consultórios (D-P5) | Medida no dev na T11 (Step 5) | Parâmetro de ids nas funções `admin_metricas_*` se passar de 1 s |
| R8 | O Plano 10B, se entrar antes, também numera a partir da 0104 e mexe em `registrar-assinatura.ts`/`arquivos-do-preparo.ts` | Global Constraints (renumerar no rebase) | Rebase cuidadoso de quem entrar depois |
| R9 | O parecer não tem interruptor próprio: se a receita for liberada antes do merge, o deploy põe o parecer e a retificação no ar com a declaração, a ressalva (D5) e os textos do desvio 9 em rascunho, e os passos 4 e 5 do runbook são pulados sem ninguém notar | Runbook, passo 2 (conferir no `/admin` antes do merge); Q13-6 ★ | Dono: conferir no merge, ou decidir por um interruptor próprio (plano à parte) |
| R10 | Q13-2 (a) quebra a premissa da §5.10 da spec da IA ("A leitura de laudo não gera material entregue ao paciente"): valores lidos pela IA chegam ao paciente no PDF do parecer sem indicação de IA; o art. 37 da Res. CFN 856/2026 vale a partir de 23/01/2027 | Runbook, passo 5 (pergunta ao CRN-3); T12 (§5.10 da spec da IA e P-B1 do `go-live.md`); Q13-2 (b) pronta como alternativa | Resposta do CRN-3 antes de 23/01/2027; com "sim", a nota de origem no PDF (Q13-2 (b)) |
| R11 | Expand/contract: o `nutri_worker` novo pode subir antes de a 0104 terminar e dar `42703` na leitura da nota e na exportação | D-P8 (aceita: migration curta, retry do pg-boss) | Acompanhar o log do worker no deploy |

## Autoconferência do plano (writing-plans)

- **Cobertura da spec:** a tabela "Cobertura da spec v0.5" liga cada US, RN e nota v0.5 do Plano 13 a uma tarefa; a lista "Pontos do código fixos em receita" da spec é coberta por T3 (`documentos.ts`, página), T4 (`documento-pdf.tsx`, `documento-pdf-job.ts`, `digitalizada.ts`, `digitalizada-job.tsx`, `exigirHabilitacaoAtual`), T5 (`registrar-assinatura.ts`, `verificacao.ts`, `portal.ts`, `link-documento.ts`) e T6 (`lgpd-documentos.ts`); `prescricao.ts:116/:144` ficam (são da receita); os desvios 1–11 da spec estão em T1 (2, 3, 5, 9), T2/T3 (1), D2 (6), Q13-1 (7), Q13-4 (8), T11 (10) e T12 (11). Fora: a variante A (D2 = (a)) e o 10B.
- **Sem lacunas de código:** cada passo de código traz o código; os passos "modificar" dizem o arquivo, o lugar e o trecho; a 0105 traz as quatro funções inteiras.
- **Nomes consistentes:** os contratos do topo são os usados nas tarefas (`copiarExames`, `situacaoDosExames`, `criarParecer`, `salvarRascunhoParecer`, `retificarDocumento`, `retificacaoEmAndamento`, `lerMotivoRetificacao`, `assinarDigitalizada`, `listarContas`, `retificacaoAssinadaNoBanco`, `CONTEUDO_PARECER_TESTE`); os do código existente foram conferidos na `main` (`travarDocumento`, `travarDocumentoAntesDaCota`, `soltarArquivosDoPreparo`, `registrarAssinatura`, `registrarVerificacao`, `mudarSituacao`, `consultarVerificacao`, `documentosDoPaciente`, `novosNoPortal`, `confirmarRecebimentoNoPortal`, `estadoDoLink`, `documentosParaExportacao`, `anonimizarDocumentosDoPaciente`, `pdfsDeDocumentosRestantes`, `cancelarDocumento`, `receberDigitalizada`, `montarPdfDigitalizado`, `gerarPdfDoDocumento`, `renderizarDocumento`, `exigirHabilitacaoAtual`, `carregarPacienteParaEscrita`, `listarExames`, `criarExame`, `excluirExame`, `envioNoBanco`, `tenantLivreEnquantoEsperaODocumento`, `emailsNaFila`, `textoDoPdf`, `outroDocumento`, `documentoNoBanco`, `novoConsultorio`, `app_documento_imutavel`, `app_notas_imutaveis`, `app_anonimizar_documentos`, `signed_documents_retificacao_aberta`).
- **Review Focus:** cada linha tem os testes nas tarefas indicadas.

## Correções da revisão do plano (08/10/2026)

Uma linha por achado da revisão do plano (lentes banco, normas e execução), conferido no código da `main` @ `3b59c38`:

1. **[Important, banco]** A versão nova com `retifica_id` só nasce em **rascunho** (`app_documento_versao`, 0105): um INSERT direto já "preparando"/"assinado" pulava o motivo e deixava duas "assinado" em vigor; os testes passam por `retificacaoAssinadaNoBanco` (opção `substituir: false`) e `outroDocumento(…, { retifica })` insere em rascunho + nota com motivo + preparo; caso novo "inserida já preparando/assinado" (T1).
2. **[Minor, banco]** Isolamento da retificação: desvio 11 (casos entre consultórios e entre pacientes em `documentos-versoes.test.ts`, teste novo "outro consultório"); frase da spec corrigida.
3. **[Minor, banco]** Janela do expand/contract da 0104 aceita e registrada (D-P8, R11, runbook passo 2, T12).
4. **[Minor, banco]** Motivo só com quebras de linha ou tabulações recusado no banco (`btrim(…, E' \t\r\n')`, regra (a)) e caso no teste (T1).
5. **[Minor, banco]** `conteudo->>'tipo'` × coluna `tipo`: para "Pontos menores" (CHECK numa migration própria).
6. **[Minor, banco]** Tipo da verificação × tipo do documento: para "Pontos menores".
7. **[Important, normas]** Q13-2 (a) × §5.10 da spec da IA e art. 37 da Res. CFN 856/2026: atenção na Q13-2, pergunta ao CRN-3 no runbook (passo 5) e no P-B1 do `go-live.md` (T12), R10 e a §5.10 atualizada na T12.
8. **[Important, normas]** Parecer sem interruptor próprio: conferência no `/admin` antes do merge (runbook passo 2), R9 e Q13-6 ★.
9. **[Important, normas]** Motivo da retificação fora da exportação do titular vai ao advogado (E-09) junto com o da D15: Q13-1, runbook passo 5 e P-B3/E-09 do `go-live.md` (T12).
10. **[Minor, normas]** Runbook passo 5 leva ao CRN-3 também a declaração e a ressalva do parecer (D5).
11. **[Minor, normas]** Carimbo "das receitas e dos pareceres" (Res. CFN 656/2020 e 760/2023, art. 10, I) no perfil (T8) e no guia `configuracoes` v4 (T10), como rascunho para a Debby.
12. **[Minor, normas]** Q13-3: registrado que o e-mail único não diz que a versão anterior foi substituída (D11).
13. **[Important, execução]** `src/db/documentos-schema.test.ts:24` exigia a recusa de `'parecer'`: T1 troca por `'atestado'`, renomeia o teste e inclui o arquivo nos Files e no `git add`.
14. **[Important, execução]** Fixtures de `ItemLista` sem `versao` quebravam o typecheck: T3 acrescenta `versao: 1` em `documentos.test.ts:196` e `entrega.test.ts:84` (arquivo nos Files e no `git add`).
15. **[Important, execução]** União `DocumentoExportado` quebrava o typecheck de três testes: T6 estreita `lgpd-documentos.test.ts:35/:49` e `exportacao.test.ts:846` (arquivo nos Files e no `git add`).
16. **[Important, execução]** `motivo` passa a ser prop opcional (padrão `null`) nos dois editores; o `receita-form.test.ts` continua compilando (T9).
17. **[Important, execução]** PDF do parecer: `wrap={false}` só por linha e `minPresenceAhead` no título do exame (padrão do `plano-pdf.tsx`); teste com 50 linhas longas e ≥ 2 páginas (T4).
18. **[Minor, execução]** `/admin`: uma linha por consultório (`left join lateral … limit 1`), busca no e-mail de qualquer nutricionista por `exists`, caso com duas nutricionistas no teste do cursor (T11).
19. **[Minor, execução]** E2E do parecer no bloco `10.9.18.x` (o `10.9.15.x` é do `ia-laudos.spec`) e o IP sem login zerado no seed (T10).
20. **[Minor, execução]** Isolamento × spec (mesmo achado do 2): resolvido pelo desvio 11.
21. **[Minor, execução]** "Estrutura de arquivos" alinhada às tarefas (`aviso-exame.tsx`, sem `substituido.tsx`) e aos arquivos novos das correções.
22. **[Minor, execução]** `z.guid()` no lugar de `z.uuid()` nos ids dos exames (G5, como `src/app/admin/actions.ts:19`) (T2).
23. **[Minor, execução]** Regra 8 do CLAUDE.md: "e versão" na frase das listas e "só em rascunho" na frase da retificação (T1, Step 7).

## Pontos menores (backlog do Plano 13)

- **Guardar a busca e a página do `/admin` depois de uma ação** (desvio 8): campo escondido com `busca`/`depois` nos formulários das ações e no `redirect`.
- **Parâmetro de ids nas métricas do admin** (D-P5), se a medida da T11 pedir.
- **"Citado em parecer" na aba Exames** (Q13-4 = (b)), se a Debby pedir.
- **Nota de origem dos valores no PDF** (Q13-2 = (b)), se o CRN-3 ou a Res. CFN 856/2026, art. 37, pedirem — a pergunta vai no passo 5 do runbook (R10).
- **`conteudo->>'tipo'` amarrado à coluna `tipo`** (revisão do plano, banco): `exigirHabilitacaoAtual` e o corpo do PDF decidem pelo `conteudo.tipo` (jsonb, gravável no rascunho), não pela coluna `signed_documents.tipo` (fixa pelo gatilho). Defesa: `CHECK (conteudo = '{}'::jsonb OR conteudo->>'tipo' = tipo)` numa migration própria; os dados atuais passam (só receitas com `tipo: 'receita'`), mas conferir antes os testes do 10A que gravam `conteudo` sem `tipo` (`documentos-imutaveis.test.ts`, linhas 59, 121, 151, 155 e 218 — os de documento emitido são recusados pelo gatilho antes do CHECK).
- **Tipo da verificação amarrado ao tipo do documento** (revisão do plano, banco): o CHECK novo de `document_verifications.tipo` não o liga ao documento; a FK `document_verifications_documento_fk` (0092) é `(tenant_id, documento_id, codigo)`. Opcional: `UNIQUE (tenant_id, id, codigo, tipo)` em `signed_documents` e a FK com `tipo` (a coluna é fixa pelo gatilho). Hoje só `registrarVerificacao` grava, com o `tipo` lido da própria linha (T5).
- **Leitura da nota com colunas explícitas** (D-P8), se o dono quiser zero `42703` na janela do deploy da 0104.
