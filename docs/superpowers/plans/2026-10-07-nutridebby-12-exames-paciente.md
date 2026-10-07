# Plano 12 — Paciente envia exames (F3-04): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Escrito em 07/10/2026** a partir de `main` @ `1a78217` + `5f94d6d` (spec C v0.3, só a parte F3-04; Planos 01–11 em produção, migrations `0000`–`0100`), com as decisões do dono de 07/10/2026 ("vamos para o plano 12": D13 = b, D14 = a, D15 = b, D16 = a, D17 = a, D18 = a, D20 = a, D23 = a, aprovadas como recomendadas) e o relatório da preparação (fora do git: `.superpowers/sdd/2026-10-07-plano12-preparacao/spec.md`). Nenhuma linha de código de produto foi escrita; nada foi rodado em banco; nenhum banco de produção foi tocado. Os nomes de função, tabela, rota, fila e helper usados aqui foram conferidos no código da `main` (os que este plano cria estão em "Contratos entre tarefas"). A biblioteca de rasterização (DEP-10, PM-6) foi conferida no registro do npm (licença, tamanho, API) em 07/10/2026; a medida de memória é a primeira coisa da Tarefa 3. Próximo passo: revisão do plano e execução.

**Goal:** O paciente envia pelo app (PWA) o laudo do exame — 1 PDF ou até 5 fotos — e o envio **não entra no prontuário sozinho**: o worker converte tudo em imagens (o PDF do paciente é rasterizado página a página, sem nada do original), monta um PDF limpo, avisa a nutricionista por e-mail agrupado, e ela confere as páginas na fila "Exames recebidos" e **aceita** (vira um exame da US-015, com a leitura por IA da F3-01 se quiser) ou **recusa** com motivo — com RLS por paciente, auditoria, transições conferidas no banco, cota, limites por paciente, expiração em 90 dias, push neutro e as rotinas da LGPD (exportação, exclusão atendida, anonimização).

**Architecture:** Duas tabelas novas (`exam_submissions`, `exam_submission_files`; migrations `0101` gerada e `0102` custom) com RLS por tenant e por paciente, auditoria (entidade `exames_enviados`), políticas `RESTRICTIVE` da sessão de paciente (só cria envio `processando` e só cancela `recebido`), gatilho de transições por papel e "sem apagar" fora da LGPD. O paciente envia por Route Handler (`POST /api/p/exames`, molde de `/api/p/diario`); os originais entram por `salvarArquivos` (nova, uma reserva de cota para o lote, DEP-09 reduzida) e o job `exame-envio` entra na mesma transação. O worker converte as fotos (pipeline do diário, 2000 px, qualidade 85) e rasteriza o PDF com o **PDFium em WebAssembly** (`@hyzyla/pdfium`, sem motor de JavaScript) num **processo filho** com teto de memória vigiado e prazo, monta o PDF limpo (`@react-pdf/renderer`) e grava páginas e PDF, cada um no seu `salvarArquivo`. A revisão (`src/modules/pacientes/exames-enviados.ts`) cria o exame apontando para o mesmo PDF limpo (um dono só) e chama `pedirLeituraExame` depois, quando pedido. Limpeza no molde do Plano 10A (um `apagarArquivo` por arquivo, ponteiro no `naMesmaTransacao`, varredura de 15 em 15 min).

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 (App Router, Server Actions, Route Handlers, `PageProps`/`RouteContext`) · React 19.2 · PostgreSQL 16 · Drizzle 0.45 · pg-boss 12.34 · Zod 4 · `sharp` 0.35 · `heic-decode` 2.1 · `@react-pdf/renderer` 4.9 (já instalados). **Dependência nova (custo zero, código aberto):** `@hyzyla/pdfium` **2.1.13** (fixada, sem `^`; MIT; o PDFium é BSD-3-Clause/Apache-2.0; só no processo filho do worker).

**Spec:** [`../specs/2026-10-03-nutridebby-paciente-exames-ia-design.md`](../specs/2026-10-03-nutridebby-paciente-exames-ia-design.md) (**v0.3, só a parte F3-04**: §1.2 C-02/C-05, §1.3 DEP-01 a DEP-10, §2.1 F3-04a/b, §4.1, §6.1–6.6, US-160 a US-165, RN-160 a RN-169, RNF-161 a RNF-163, RNF-166, RNF-167, RNF-169, §12, §13.1–13.3, §15 R-165/R-170/R-173/R-174/R-175, §17 PM-6 e PM-8 a PM-14, §18 "Decisões do dono (07/10/2026)") e a spec do MVP [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.13: RN-07, RN-08, RN-15, RN-17, RN-18, RNF-07, RNF-10, RNF-11, US-015, US-018, US-044, US-046). Subprojeto A (F3-01, em produção): [`../specs/2026-10-03-nutridebby-ia-nutricionista-design.md`](../specs/2026-10-03-nutridebby-ia-nutricionista-design.md) v0.4 (US-110). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P12-01 a P12-14). Manual técnico: [`../../manual-tecnico/README.md`](../../manual-tecnico/README.md).

## Global Constraints

- Tudo dos Planos 01–11 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, `src/proxy.ts` (as rotas `/api/` ficam fora dele), porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel); `requireNutri` na **primeira** linha de toda página e Server Action da nutricionista (guarda `src/app/painel/acoes-de-paciente.test.ts`), `requirePaciente`/`requireApiPaciente` no portal; ids de rota conferidos com `idValido` (id inválido = 404, nunca 500); formulários com `action={…}` ou `method="post"` (guarda `src/app/formularios-post.test.ts`); rota de API nova com método de escrita confere a origem com `mesmaOrigem` **antes** da sessão (guarda `src/app/api/mesma-origem-rotas.test.ts`, que varre `src/app/api` inteiro).
- **Base:** `main` em `1a78217` (+ a spec v0.3, `5f94d6d`). Migrations deste plano: **`0101_exames_enviados`** (gerada, T1) e **`0102_rls_exames_enviados`** (custom, T1). Se outro plano entrar na `main` com migration antes, renumerar no rebase e corrigir as referências. Migrations só com `DATABASE_URL_MIGRATOR` (CLAUDE.md regra 7); nunca no banco de dev compartilhado sem combinar; nunca em produção fora do deploy.
- **CLAUDE.md regra 1:** toda consulta a `exam_submissions` e `exam_submission_files` por `withTenant` (`src/db/tenant.ts`); o admin nunca as consulta (só a função `SECURITY DEFINER` `admin_metricas_exames_enviados()`, T1); o e-mail à nutricionista reaproveita `avisarNutri` (`src/modules/agenda/aviso-nutri.ts`, já na lista de exceções da tabela `user`). **Nenhum arquivo novo** entra na lista da regra 1.
- **Regra 2:** as duas tabelas com `app_enable_tenant_rls` + `app_enable_patient_rls`; **nenhuma** em `PUBLICO_LIBERADO`, `STAFF_ONLY` ou `CONTEUDO_POR_AUDIENCIA`; `PACIENTE_ESCREVE` ganha `exam_submissions` (`insert`, `update`) e `exam_submission_files` (`insert`), cada uma com a política `RESTRICTIVE` da spec §13.1; `stored_files` continua só `insert` para o paciente, agora dos tipos `diario_foto_original` **ou** `exame_original`; as duas em `FABRICAS` de `test/isolamento.test.ts` (a das linhas de arquivo cria a mãe no mesmo comando e entra em `COM_MAE`).
- **Regra 3 / RNF-11 / C-05 / RNF-166:** nada de dado de saúde (nome do exame, observação, motivo de recusa, nome do paciente, caminho de arquivo) em log, Sentry, fila, push ou e-mail. Os jobs levam só `{ tenantId, envioId }`; logs só com ids, motivo de uma lista fechada e contagens. Push ao paciente: **um texto só**, "Há uma atualização para você no app." (sem "exame"); e-mail à nutricionista: "Você tem exames novos enviados por pacientes para revisar." (+ a frase dos 30 dias), sem nome nem arquivo.
- **Regra 8 (auditoria):** `app_enable_audit('exam_submissions', 'exames_enviados')` e `app_enable_audit('exam_submission_files', 'exames_enviados')`; `ENTIDADE_ROTULO.exames_enviados = 'Exames enviados pelo paciente'`. `auditRead` (entidade `exames_enviados`) ao **abrir** um envio no painel e, no portal, na **lista** e no **download** do próprio PDF (Plano 06, D22: leitura do titular é auditada). A **fila** do painel e os contadores não chamam (só listam, como a lista de pacientes). O worker grava com ator nulo ("Sistema"). Nenhuma migration deste plano desliga o gatilho de auditoria (NGS1.07.01).
- **Regra 9 (arquivos):** gravar e apagar só por `salvarArquivo`/`salvarArquivos`/`apagarArquivo` (`src/modules/plataforma/armazenamento.ts`); tipo pelo conteúdo (`detectarTipo`); o registro que aponta para o arquivo é gravado no `registrar` e apagado no `naMesmaTransacao` (as linhas de `exam_submission_files` saem pela FK `ON DELETE CASCADE` na mesma transação do `DELETE` de `stored_files`); servir só por `signFileUrl` (5 min); nunca montar caminho com texto do usuário. Tipos novos com dono: `exame_original` (o que o paciente enviou; só enquanto `processando`) e `exame_pagina` (imagens de página para a revisão; temporárias); o PDF limpo usa `exame` (vira o laudo, sem cópia). `salvarArquivos` é **só** do envio do paciente (DEP-09 reduzida, PM-8).
- **Worker e arquivo não confiável (R-170, RNF-162, RNF-169):** todo envio passa pelo worker (D23 = a); o PDF do paciente só é aberto pelo PDFium num **processo filho** (`fork`, sem variáveis de ambiente, heap de 64 MB, teto de memória residente vigiado de 20 em 20 ms, prazo de 120 s, uma página por vez); imagens dentro do PDF acima de 20 MP declarados são recusadas antes de decodificar; nada do original é guardado nem chega ao navegador ou à F3-01. `@hyzyla/pdfium`, `heic-decode`, `@react-pdf/renderer`, `rasterizar-pdf*.ts` e `exames-enviados-job.tsx` ficam **fora do grafo do Next** (guardas de grafo). Fila `exame-envio` com **um job por vez** (padrão do `boss.work`).
- **Boas práticas SBIS NGS1 (spec §6.5):** nada do paciente entra no prontuário sem a ação da nutricionista, com quem e quando (`revisado_por`, `revisado_em`) e a origem do exame (`exam_submissions.exam_id`, selo "Enviado pelo paciente") (ECF.17.01); o registro do envio não é apagado na revisão — só os **arquivos** saem; a linha só sai no pedido de exclusão atendido e na anonimização (gatilho `exam_submissions_sem_apagar`) (NGS1.12.03); cada papel só faz a sua transição, conferida no banco (gatilho `exam_submissions_regras` + políticas `RESTRICTIVE`) (NGS1.03.01, NGS1.03.04); trilha de escrita e de leitura (NGS1.07.02 a 07.04); datas consistentes — coleta não futura, não anterior a 10 anos nem ao nascimento (ECF.17.05).
- Textos de interface em pt-BR, **com o texto exato da spec v0.3** quando existir (US-160 a US-165, §6.2); os textos novos estão listados em "Desvios conscientes" e vão à revisão de interface.
- Visual V2 (Plano 08): só os tokens do tema (`bg-cartao`, `text-suave`, `border-borda`, `text-link`, `text-erro`…), nunca cor fixa em `src/app/painel` e `src/modules/*/ui` (guarda `src/app/painel/cores.test.ts`); componentes `Botao`/`BotaoLink`, `Aviso`, `Selo`, `ConfirmarBotao`; acessibilidade (RNF-10, RNF-167): `<label htmlFor>`, `aria-invalid` + `aria-describedby`, erros com `role="alert"`, sucesso com `role="status"`, alvo de toque ≥ 44 px (`min-h-11`), situação do envio em texto (não só cor); toda tela nova do painel em `ROTAS_DO_PAINEL` (`e2e/painel-rotas.ts`, guarda `src/app/painel/rotas-axe.test.ts`) e a do portal na lista do axe (`e2e/acessibilidade.spec.ts`).
- Custo: nenhuma despesa nova de serviço (sem IA nova; a leitura de um exame aceito é a F3-01, já aceita). O volume guardado cresce (C-02, D14 = a, aceito pelo dono); a imagem Docker tem orçamento de **260 MB** comprimidos (CI, job `image`) e estava em 258 MB no Plano 11 — a T3 poda a dependência nova e, se ainda passar, **para e pergunta ao dono** (não apaga outra coisa às cegas).
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel, serviços, firewall ou banco de produção neste plano; nunca exibir segredos. Merge = deploy, só com OK explícito do dono e snapshot no hPanel antes. Subagentes nunca consultam o banco de produção. O `nutri-backup.sh` só roda dentro de `test/backup.test.ts` (regra 10).
- Política de revisão por entrega (índice, revista em 02/10/2026; modo misto aprovado pelo dono): revisor por tarefa (cada tarefa diz **Revisão: completa (agente …)** ou **Revisão: leve (revisor-interface)**) → revisão final do branch (workflow) com uma onda de correções → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor vai para o backlog) → re-revisão só do diff das correções → `/security-review` com o checklist reforçado (arquivo não confiável vindo do paciente, rasterização, cota, transições no banco). Se sobrar Critical/Important confirmado, parar e avisar o dono. Lembrar o dono, a cada sessão, de que o **backup no host (P02-11)** segue pendente.

**Revisão completa** = o agente especialista indicado (`.claude/agents/revisor-rls.md` para banco/RLS/auditoria/armazenamento/rotas/worker; `.claude/agents/normas-cfn-lgpd.md` para prontuário, LGPD, exportação e anonimização) com as lentes de segurança/LGPD e de spec, três verificadores adversariais por achado, até duas rodadas de correção. **Revisão leve** = `revisor-interface` (visual V2, textos, acessibilidade, manual guiado), uma rodada.

### Decisões do plano

As marcadas com ★ **ainda são do dono**. As outras são técnicas, tomadas aqui com base na spec v0.3 e no código.

| # | Tema | Decisão (aplicada no plano) | Consequência |
|---|---|---|---|
| D1 | Rasterização (DEP-10, PM-6, R-175) | **`@hyzyla/pdfium` 2.1.13** (PDFium — o motor de PDF do Chrome — em WebAssembly; a compilação não tem o V8, então nenhum JavaScript do PDF roda; ≈ 4 MB de WASM; MIT + BSD-3-Clause/Apache-2.0, sem AGPL). O `sharp` 0.35.4 pré-compilado **não abre PDF** (`sharp.format.pdf.input.buffer === false`, conferido em 07/10/2026). Roda num **processo filho** (`fork`) e não numa thread: a memória do WASM fica fora do teto do heap de uma thread, e só um processo à parte pode ser medido (`/proc/<pid>/status`) e morto (`SIGKILL`) sem derrubar o worker de 512 MB. Teto do filho: 120 MB de memória residente (vigia de 20 em 20 ms), heap de 64 MB, prazo de 120 s, uma página por vez; imagem dentro do PDF acima de 20 MP declarados recusada **antes** de decodificar (`FPDFImageObj_GetImagePixelSize`, também dentro de Form XObjects e nas imagens inline). **Plano B** (só se a T3 reprovar a medida): `pdfjs-dist` 6.4.299 (Apache-2.0) + `@napi-rs/canvas` 1.0.10 (MIT), no mesmo processo filho — ≈ 70 MB descompactados a mais na imagem, que já está no limite; a troca volta ao dono | T3 mede primeiro; a guarda `exames-enviados-guardas.test.ts` prende o pacote ao processo filho |
| D2 | Qualidade do JPEG (PM-9) | `paraJpegSemMetadados(img, ladoMax, qualidade = 80)` ganha o parâmetro; o laudo usa **85** e 2000 px; o diário e a capa continuam em 80 | T2 |
| D3 | DEP-09 (PM-8) | Confirmada a versão reduzida: só `salvarArquivos` (lote do paciente, uma reserva pela soma, tudo ou nada); o resto no molde do diário e do 10A (`apagarArquivosDoEnvio`, um `apagarArquivo` por arquivo) | T2; regra 9 do CLAUDE.md atualizada (T2) |
| D4 ★ | Onde "Exames" fica no portal (PM-10) | Recomendação da spec aplicada: **não vira aba**; `/p/exames` marca "Perfil" (`tambem`), link "Meus exames" em Perfil e botão "Enviar exame" no Início, os dois só com o recebimento ligado (D18). Se o dono preferir aba, é uma troca em `ITENS_DO_PORTAL` | T10; confirmar com o dono na revisão do plano |
| D5 | Gatilho de transição (PM-14) | **Sim**: `exam_submissions_regras` (colunas fixas; transições permitidas; quem faz cada uma: `aceito`/`recusado` só `nutri`, `cancelado` só `paciente`, `recebido`/`falhou`/`expirado` só `worker`; a sessão de paciente só muda `status` e `updated_at`) e `exam_submissions_sem_apagar` (DELETE só no contexto `worker` com o titular bloqueado ou anonimizado) | T1; `IMUTAVEIS` e `SEM_DELETE` no isolamento |
| D6 ★ | Lembrete dos 30 dias (PM-12) | Como a spec: a frase sai **junto** do próximo e-mail de envio novo; lembrete próprio (sem envio novo) fica no backlog (P12-13) se a Debby quiser | T6 |
| D7 | Texto de cota (PM-13) | O da spec no envio ("…Avise sua nutricionista."); uniformizar o do diário fica no backlog | T4, T6 |
| D8 ★ | Backup (PM-11) | `--exclude '/*/exame_pagina/**'` **e** `--exclude '/*/exame_original/**'` no `rclone sync` (as duas são temporárias; o original pode ter EXIF/GPS e vive minutos); regra 10: o dono reinstala o script no host quando ligar o backup (P02-11 ainda pendente) | T13 + runbook |
| D9 ★ | "Aceitar e ler" (R-174) | O botão aparece como a spec manda (IA ativa + paciente apto); a medida da leitura em laudos rasterizados a 2000 px entra no **passo 4 do runbook do Plano 11** (avaliação com laudos fictícios), antes de a admin liberar a IA para dado real — hoje `ia_liberada` é `false` em produção, então nada sai | Runbook, passo 5 |
| D10 | Aviso à nutricionista (RN-168) | `avisarExamesRecebidos` roda **no `registrar` do PDF limpo** — a mesma transação que marca o envio `recebido`, com a linha do tenant já travada pela reserva de cota; confere e grava `tenants.exames_aviso_em` (no máximo 1 a cada 6 h) | T6 |
| D11 | Menu do painel | "Exames recebidos" é o 5º item (depois de "Diários") **só** com o recebimento ligado ou com envio aguardando; o rótulo leva o contador ("Exames recebidos (3)"); o layout conta e as ações da revisão chamam `revalidatePath('/painel', 'layout')` | T11 |
| D12 | Processamento interrompido | Como o diário: `processando` parado > 30 min sem job vivo → `falhou` (`interrompido`), sem reprocessar; uma nova tentativa do job apaga as páginas de uma tentativa anterior antes de refazê-las (`refazer: true`) | T6, T8 |
| D13 | Ordem e paralelismo | **T1 → [T2 ‖ T3] → T4 → [T5 ‖ T6 ‖ T7 ‖ T9 ‖ T12] → T8 → [T10 ‖ T11] → T13** (detalhe em "Dependências", abaixo) | — |

### Desvios conscientes da spec v0.3

1. **`paciente_arquivos` esconde só `exame_pagina`** (spec §13.2: também `exame_original`). A política `RESTRICTIVE` de `INSERT` em `exam_submission_files` confere, sob a RLS da própria sessão do paciente, que o original é dele e do tipo `exame_original` (o mesmo desenho da `paciente_diario_insert`, 0080); se o paciente não enxergasse a linha do original, a conferência falharia sempre. O original é do próprio paciente, vive minutos e nenhuma rota o serve.
2. **Métricas do admin numa função nova**, `admin_metricas_exames_enviados()` (molde de `admin_metricas_ia()`, 0099), em vez de colunas novas em `admin_tenant_metrics()` (spec §13.2): mudar o tipo de retorno exigiria `DROP FUNCTION` da função das métricas principais.
3. **`stored_files_dono` não muda**: os tipos novos já caem no lado "tem dono" do CHECK (`tipo in ('logo','capa','orientacao_pdf')` = sem dono).
4. **Processo filho em vez de thread** para a rasterização (spec §4.1 e RNF-162 citam o molde de `preparar-pdf-thread.ts`): ver D1.
5. **Expiração contada de `created_at`** (a spec não tem `recebido_em`): o processamento leva minutos, e a data do envio é a que o paciente vê.
6. **Corrida com envio `expirado`/`falhou`** no aceite ou na recusa mostra "Este envio já foi revisado." (a spec só define o texto do cancelado e do já revisado).
7. **Textos novos** (não estão na spec; vão à revisão de interface): "Informe a data da coleta", "Use no máximo 120 caracteres.", "Use no máximo 500 caracteres.", "Nenhum exame enviado ainda.", "Meus exames", "Enviar exame" (título da seção; o botão do Início é da spec), "Meus exames enviados" (já citado na US-160 como nome da lista), "Data da coleta", "Nome do exame (opcional)", "Observação (opcional)", "PDF ou fotos do exame", "Enviar", "Enviado em {data} · Coleta em {data}", "Baixar PDF", "Cancelar envio" (da spec), "Envio não encontrado.", "Escolha o motivo.", "Envio recusado.", "Nenhum exame aguardando revisão.", "hoje" (no lugar de "há 0 dias"), "Voltar para Exames recebidos", "Página {i} de {n} do exame enviado" (texto alternativo), "Observação do paciente:", "Título", "Data", "Motivo", "Escreva o motivo", "Confirmar recusa", "Exames enviados pelos pacientes" (seção de Configurações), "Salvar", "Configuração salva.", a coluna do admin "Exames do app" com "Enviados no mês: {n}" e "Aguardando revisão: {n}"; no painel, a legenda da fila "Exames enviados pelos pacientes aguardando revisão", as colunas "Paciente", "Exame", "Enviado em", "Coleta" e "Aguardando", "Páginas do exame", "Revisão", "Aceitar"/"Recusar" (abrem os formulários), "{paciente} · enviado em {data} · coleta em {data}"; o e-mail: assunto "Exames enviados por pacientes" e botão "Ver exames recebidos"; e o guia "Exames recebidos" do manual guiado (T13; rascunho até a Debby aprovar, como o P08-08).

## Review Focus

1. **PDF hostil do paciente.** PDF com JavaScript (`/OpenAction`), link (`/URI`) e anexo embutido; PDF de 300 KB cujo conteúdo descomprime para 256 MB ("bomba"); imagem embutida que declara 6000 × 6000 px; PDF sem páginas; PDF truncado; página com tamanho zero. Esperado: o PDF limpo tem só imagens (nenhum `/JavaScript`, `/URI`, `/EmbeddedFile`, `/OpenAction`, nem o texto do original); a bomba e a imagem gigante viram `falhou` (`conversao`) sem derrubar o worker (o filho morre no teto de memória); arquivos apagados e cota devolvida. Testes nas Tarefas 3 e 6.
2. **Corridas entre os papéis.** O paciente cancela enquanto a nutricionista confere; duas abas aceitam o mesmo envio; recusa e cancelamento juntos; o paciente tenta cancelar um envio `processando`; a varredura expira um envio no instante do aceite; o job roda duas vezes. Esperado: um vencedor só, as mensagens da US-163 ("Este envio foi cancelado pelo paciente.", "Este envio já foi revisado."), nenhum exame duplicado, nenhum arquivo perdido apontado nem órfão contando na cota. Testes nas Tarefas 1 (gatilho), 7 e 8.
3. **Fotos reais de celular.** HEIC de 48 MP; JPEG girado (orientação 6) com GPS; PNG com transparência; 5 fotos de 6 MB (30 MB exatos) e 4 de 9 MB (36 MB); uma foto de 0 byte no meio; JPEG de cabeçalho que declara 50 MP. Esperado: páginas em pé, sem EXIF, ≤ 2000 px; recusa com a mensagem única da US-160 para o que passa dos limites; HEIC grande → `falhou`. Testes nas Tarefas 4 e 6.
4. **O titular muda por baixo do envio.** Pedido de exclusão atendido durante o processamento; paciente arquivado com envio aguardando (a nutricionista ainda aceita); anonimização com envio aceito, recebido e falhou. Esperado: o worker não grava nada para o bloqueado; os envios não aceitos e os arquivos saem na exclusão atendida; tudo sai na anonimização; o aceite de arquivado funciona; o de bloqueado dá `MSG_BLOQUEADO`. Testes nas Tarefas 6, 7 e 12.
5. **Cota no limite.** 10 MB livres e 3 fotos de 6 MB; cota que acaba entre o envio e o processamento; cancelamento, recusa, expiração e falha devolvendo o espaço. Esperado: nada gravado no envio (uma reserva só); `falhou` (`cota`) no worker com tudo apagado; `tenants.armazenamento_bytes` volta exatamente ao valor de antes em cada caminho. Testes nas Tarefas 2, 4, 6, 7 e 8.

---

## Estrutura de arquivos

```
drizzle/
  0101_exames_enviados (gerada: exam_submissions, exam_submission_files, colunas de tenants, CHECKs de stored_files e notifications)  # T1
  0102_rls_exames_enviados (custom: FK SET NULL (exam_id), RLS, auditoria, políticas do paciente, stored_files, gatilhos, admin)  # T1
src/db/schema/exames-enviados.ts (+ index.ts) · platform.ts (tenants, stored_files) · agenda.ts (notifications)                 # T1
src/db/exames-enviados-schema.test.ts · src/db/rls-guard.ts · src/db/paciente-escrita.test.ts · test/isolamento.test.ts         # T1
test/exames-enviados.ts (helpers)                                                                                            # T1
src/modules/plataforma/audit.ts (ENTIDADE_ROTULO) · src/modules/notificacoes/tipos.ts (+test)                                # T1
src/modules/plataforma/armazenamento.ts (tipos: T1; salvarArquivos: T2) · armazenamento-lote.test.ts                        # T1, T2
src/lib/jpeg.ts (+ jpeg.test.ts) · src/modules/portal/diario-foto-job.ts (fotoParaJpeg exportada)                          # T2
src/modules/pacientes/
  exames-enviados-constantes.ts (+test)                     # T2 (sem imports de servidor: o formulário do portal usa)
  exames-enviados-arquivos.ts (+test)                       # T2 (apagarArquivosDoEnvio)
  rasterizar-pdf.ts (+test) · rasterizar-pdf-processo.ts    # T3 (só worker)
  exames-enviados-guardas.test.ts                           # T3
  exames-enviados-job.tsx (+ exames-enviados-job.test.ts)   # T6 (só worker)
  exames-enviados-aviso.ts (+test)                          # T6
  exames-enviados.ts (+test)                                # T7 (lado da equipe)
  exames-enviados-ia.ts (+test)                             # T11 (mensagem da IA pela URL, lista fechada)
  exames-enviados-varredura.ts (+test)                      # T8
  lgpd.ts · exportacao-job.ts (+tests)                      # T12
src/modules/portal/exames-enviados.ts (+test)               # T4 (lado do paciente)
src/modules/portal/avisos.ts · src/modules/notificacoes/mensagens.ts (+test)                                                # T7
src/modules/plataforma/recebimento-exames.ts (+test) · metricas.ts (+test)                                                 # T9
src/email/types.ts · src/email/templates.tsx                                                                                # T6
src/jobs/queues.ts (T4) · src/worker/index.ts (T6, T8)
package.json · pnpm-lock.yaml · Dockerfile · .github/workflows/ci.yml                                                      # T3
src/app/api/p/exames/route.ts (+test) · src/app/api/p/exames/[id]/pdf/route.ts (+test)                                    # T5
src/app/p/(portal)/exames/{page.tsx, envio-form.tsx, cancelar-envio.tsx, actions.ts} · src/app/p/navegacao.ts (+test)      # T10
src/app/p/(portal)/perfil/page.tsx · src/app/p/(portal)/inicio/page.tsx · e2e/acessibilidade.spec.ts · scripts/e2e-seed.ts # T10
src/app/painel/exames-recebidos/page.tsx · [id]/{page.tsx, actions.ts, aceitar-form.tsx, recusar-form.tsx}                 # T11
src/app/painel/{navegacao.ts (+test), menu-painel.tsx, cabecalho.tsx, layout.tsx}                                          # T11
src/app/painel/pacientes/[id]/exames/page.tsx · e2e/painel-rotas.ts · e2e/painel.ts                                         # T11
src/app/painel/configuracoes/{page.tsx, actions.ts, exames-secao.tsx} · src/app/admin/page.tsx                              # T9
e2e/exames-enviados.spec.ts · src/modules/ajuda/conteudo.ts · scripts/backup/nutri-backup.sh · test/backup.test.ts          # T13
docs/manual-tecnico/11-exames-enviados.md · README.md · docs/operacao/exames-enviados.md · índice · backlog · spec          # T13
CLAUDE.md                                                                                       # T1 (regras 2, 8), T2 (regra 9), T13 (regra 10)
```

### Dependências entre tarefas (worktrees em paralelo)

| Tarefa | Depende de | Pode rodar em paralelo com | Por quê |
|---|---|---|---|
| T1 Banco | — | — | tudo usa o schema |
| T2 Lote, limpeza e JPEG | T1 | T3 | arquivos diferentes (`armazenamento.ts`, `jpeg.ts`, `diario-foto-job.ts` × `package.json`, `Dockerfile`) |
| T3 Rasterização | T1 (só a pasta) | T2 | é a única que mexe no `package.json`/lockfile |
| T4 Envio do paciente (módulo) | T1, T2 | — | usa `salvarArquivos` e as constantes |
| T5 Rotas do portal | T4 | T6, T7, T9 | só `src/app/api/p/exames` |
| T6 Job do worker + e-mail | T2, T3, T4 | T5, T7, T9 | `exames-enviados-job.tsx`, `src/email/*`, `worker/index.ts` |
| T7 Revisão pela nutricionista | T2, T4 | T5, T6, T9 | `exames-enviados.ts`, `mensagens.ts`, `avisos.ts` |
| T9 Configurações e admin | T1, T2 | T5, T6, T7, T12 | `configuracoes/`, `admin/`, `metricas.ts` (usa os textos da T2) |
| T8 Limpeza e varredura | T6, T7 | — | mexe no `worker/index.ts` depois da T6 e usa o push da T7 |
| T10 Telas do portal | T5 | T11 | `src/app/p/`, `e2e/acessibilidade.spec.ts`, `scripts/e2e-seed.ts` |
| T11 Telas do painel | T7 (o E2E do `prepararTelasComId` precisa do seed da T10) | T10 | `src/app/painel/`, `e2e/painel*.ts` |
| T12 LGPD | T1, T2 | T5, T6, T7, T9 | `lgpd.ts`, `exportacao-job.ts` (só os helpers de teste da T1) |
| T13 Fechamento | todas | — | E2E, manuais, backup, docs |

### Contratos entre tarefas (nomes que várias tarefas usam)

```ts
// src/db/schema/exames-enviados.ts (T1)
export const examSubmissions; export type ExamSubmissionRow; export const examSubmissionFiles; export type ExamSubmissionFileRow;
// tenants (T1): examesPacienteAtivadoEm: Date | null; examesAvisoEm: Date | null
// src/modules/plataforma/armazenamento.ts (T1: tipos; T2: lote)
export type TipoDeArquivo = … | 'exame_original' | 'exame_pagina';
export function salvarArquivos(ctx: TenantContext, input: { tipo: TipoDeArquivo; conteudos: readonly Buffer[]; permitidos: readonly TipoArquivo['ext'][]; patientId?: string; antesDaReserva?: (tx: Tx) => Promise<void>; registrar?: (tx: Tx, arquivos: ArquivoSalvo[]) => Promise<void> }, deps?: { db?: Db; dataDir?: string }): Promise<ArquivoSalvo[]>;
// src/lib/jpeg.ts (T2)
export function paraJpegSemMetadados(img: Sharp, ladoMax: number, qualidade?: number): Promise<Buffer>;
// src/modules/portal/diario-foto-job.ts (T2)
export class FotoInvalidaError extends Error {}; export type AbrirHeic;
export function fotoParaJpeg(original: Buffer, ext: string, o: { ladoMax: number; qualidade?: number; abrirHeic?: AbrirHeic }): Promise<Buffer>;
// src/modules/pacientes/exames-enviados-constantes.ts (T2; sem imports de servidor)
export const ENVIO_PDF_MAX_BYTES, ENVIO_FOTO_MAX_BYTES, ENVIO_TOTAL_MAX_BYTES, ENVIO_MAX_FOTOS = 5, ENVIO_MAX_PAGINAS = 10, ENVIO_MAX_PIXELS, MAX_PIXELS_IMAGEM_PDF, ENVIO_LADO_MAX = 2000, ENVIO_QUALIDADE_JPEG = 85, ENVIOS_PENDENTES_MAX = 10, ENVIOS_POR_DIA_MAX = 5, NOME_ENVIO_MAX = 120, OBSERVACAO_ENVIO_MAX = 500, MOTIVO_RECUSA_TEXTO_MAX = 300, ENVIO_EXPIRA_DIAS = 90, ENVIO_LEMBRETE_DIAS = 30, AVISO_EXAMES_INTERVALO_MS;
export const STATUS_ENVIO; export type StatusEnvio; export const MOTIVOS_RECUSA; export type MotivoRecusa; export const MOTIVOS_FALHA_ENVIO; export type MotivoFalhaEnvio;
export const ROTULO_MOTIVO_RECUSA: Record<MotivoRecusa, string>; export const MSG_ENVIO; export const SITUACAO; export const MSG_REVISAO;
export function situacaoParaPaciente(e: { status: string; motivoRecusa: string | null; motivoRecusaTexto: string | null; motivoFalha: string | null }): string;
export function nomeDoEnvio(nome: string | null, enviadoEm: string): string; export function diasEntre(de: string, ate: string): number; export function haDias(n: number): string;
// src/modules/pacientes/exames-enviados-arquivos.ts (T2)
export function apagarArquivosDoEnvio(ctx: TenantContext, envioId: string, deps?: { db?: Db; dataDir?: string; papel?: 'original' | 'pagina'; refazer?: boolean }): Promise<number>;
// src/modules/pacientes/rasterizar-pdf.ts (T3; só worker)
export class RasterizacaoError extends Error { motivo: 'paginas' | 'conversao' }
export type PaginaRaster = { indice: number; largura: number; altura: number; rgba: Buffer };
export function rasterizarPdf(pdf: Buffer, o: { limitePaginas: number; ladoMax: number; maxPixelsImagem: number; tempoMaxMs?: number; tetoRssBytes?: number }, aoReceber: (p: PaginaRaster) => Promise<void>): Promise<{ paginas: number; picoBytes: number | null }>;
// src/modules/portal/exames-enviados.ts (T4)
export class EnvioError extends Error { status: 400 | 404 | 409 | 507; erros: Partial<Record<'dataColeta' | 'nome' | 'observacao' | 'arquivos' | 'geral', string>> }
export function classificarArquivos(arquivos: readonly Buffer[]): Promise<{ tipo: 'pdf' | 'fotos' } | null>;
export function enviarExame(ctx, tenant: { fuso: string }, entrada: { dataColeta: unknown; nome: unknown; observacao: unknown; arquivos: Buffer[] }, deps?): Promise<{ id: string }>;
export type MeuEnvio = { id; enviadoEm: Date; dataColeta: string; nome: string | null; status: StatusEnvio; situacao: string; podeBaixar: boolean; mostraCancelar: boolean };
export function meusEnvios(ctx, o?): Promise<MeuEnvio[]>; export function pdfDoMeuEnvio(ctx, id: string, db?): Promise<string | null>; export function cancelarMeuEnvio(ctx, id: string, deps?): Promise<void>;
// src/modules/pacientes/exames-enviados-job.tsx (T6; só worker)
export type DadosEnvio = { tenantId: string; envioId: string };
export function renderizarPdfLimpo(paginas: readonly Buffer[]): Promise<Buffer>;
export function processarEnvio(data: DadosEnvio, deps: DepsProcessar): Promise<'recebido' | 'falhou' | 'ignorado'>;
// src/modules/pacientes/exames-enviados-aviso.ts (T6)
export function avisarExamesRecebidos(tx: Tx, o: { tenantId: string; agora: Date; appUrl: string }): Promise<boolean>;
// src/modules/pacientes/exames-enviados.ts (T7)
export class RevisaoError extends Error { erros: Partial<Record<'titulo' | 'data' | 'motivo' | 'texto' | 'geral', string>> }
export function filaDeEnvios(ctx, db?): Promise<EnvioNaFila[]>; export function contarEnviosRecebidos(ctx, db?): Promise<number>;
export function contarEnviosDoPaciente(ctx, patientId: string, db?): Promise<number>; export function examesEnviadosPeloPaciente(ctx, patientId: string, db?): Promise<Set<string>>;
export function abrirEnvio(ctx, id: string, db?): Promise<EnvioAberto | null>;
export function aceitarEnvio(ctx, tenant: { fuso: string }, id: string, entrada: { titulo: unknown; data: unknown }, deps?): Promise<{ examId: string; patientId: string }>;
export function recusarEnvio(ctx, id: string, entrada: { motivo: unknown; texto: unknown }, deps?): Promise<void>;
// src/modules/portal/avisos.ts (T7)
export function avisarEnvioAtualizado(tx: Tx, o: { tenantId: string; patientId: string; tipo: 'exame_revisado' | 'exame_expirado' }, agora: Date): Promise<void>;
// src/modules/pacientes/exames-enviados-varredura.ts (T8)
export function limparEnvio(data: DadosEnvio, deps: { db: Db; dataDir: string }): Promise<number>;
export function varrerEnvios(deps: { db: Db; dataDir: string; boss: Pick<PgBoss, 'findJobs'> }, agora: Date, o?: { tenantId?: string }): Promise<{ interrompidos: number; expirados: number; arquivos: number }>;
// src/modules/plataforma/recebimento-exames.ts (T9)
export function definirRecebimentoDeExames(ctx: TenantContext, ligar: boolean, deps?): Promise<void>;
// src/modules/plataforma/metricas.ts (T9)
export function metricasDeExamesEnviadosPorTenant(db?): Promise<Map<string, { enviadosMes: number; pendentes: number }>>;
// src/modules/pacientes/lgpd.ts (T12)
export function apagarEnviosDoTitular(ctx: TenantContext, patientId: string, deps?: { db?: Db; dataDir?: string; todos?: boolean }): Promise<number>;
// test/exames-enviados.ts (T1)
export const JPEG_MINIMO: Buffer; export function ligarExames(db, tenantId: string): Promise<void>;
export function envioNoBanco(db, ctx, patientId: string, o?): Promise<string>; export function arquivoDeEnvio(db, ctx, patientId: string, tipo: 'exame' | 'exame_original' | 'exame_pagina', dataDir: string, conteudo?: Buffer): Promise<string>;
export function envioRecebido(db, ctx, patientId: string, dataDir: string, o?: { paginas?: number; nome?: string | null; dataColeta?: string; criadoEm?: Date }): Promise<{ id: string; pdf: string; paginas: string[] }>;
export function jpegQueDeclara(largura: number, altura: number): Promise<Buffer>; export function jpegDe(bytes: number): Promise<Buffer>;
```

### Cobertura da spec v0.3, parte F3-04 (autoconferência)

| Requisito | Tarefa(s) |
|---|---|
| US-160 (enviar PDF e fotos, conteúdo ativo, PDF longo, inválidos, data, limites, cota no envio e no worker, concorrência, desligado, falha) | T2 (`salvarArquivos`), T3 (rasterização), T4 (`enviarExame`), T5 (rota, 429), T6 (worker), T10 (tela) |
| US-161 (lista, download só em `recebido`, cancelar, processando, isolamento, auditoria do titular) | T1 (RLS), T4, T5 (GET), T8 (limpeza), T10 |
| US-162 (e-mail agrupado, fila, contador, prontuário, auditoria só ao abrir) | T6 (aviso), T7 (fila, contadores, `abrirEnvio`), T11 (telas e menu) |
| US-163 (aceitar, aceitar e ler, IA recusando, IA indisponível, corridas) | T1 (gatilho), T7 (`aceitarEnvio`), T11 (formulário, `pedirLeituraExame` depois) |
| US-164 (recusar, outro motivo, outra pessoa) | T7 (`recusarEnvio`), T11 |
| US-165 (lembrete 30 dias, expirar 90 dias) | T6 (frase no e-mail), T8 (`varrerEnvios`) |
| RN-160 / RN-161 / RN-162 | T4, T5 / T4, T5, T6 / T4 |
| RN-163 / RN-164 / RN-165 / RN-166 | T3, T6, T8 / T7 / T7 / T4, T8 |
| RN-167 / RN-168 / RN-169 | T8 / T6 / T4, T5, T10 |
| RNF-161 / RNF-162 / RNF-163 | T5 (prazo do corpo), T6 / T3, T6 / T1 |
| RNF-166 / RNF-167 / RNF-169 | T6, T7 / T10, T11, T13 / T3, T6 |
| §6.5 SBIS (1–7) | T1 (gatilhos, auditoria), T7 (selo, quem/quando), T4 (datas), T6 (só imagens) |
| §13.3 LGPD (exportação, exclusão atendida, anonimização) | T12 |
| C-02 / PM-11 (backup) | T13 + runbook |
| Admin só contagens (§3) | T1 (função), T9 (coluna) |

### Task 1: Banco — envios e arquivos do envio, RLS do paciente, transições, sem apagar, auditoria, tipos novos e guardas (P12-01)

**Revisão: completa (agente revisor-rls)** — tabelas novas com `tenant_id`, políticas da sessão de paciente, gatilhos, auditoria, `stored_files` e a função do admin.

**Files:**
- Create: `src/db/schema/exames-enviados.ts`, `drizzle/0101_exames_enviados.sql` (gerada), `drizzle/0102_rls_exames_enviados.sql` (custom), `src/db/exames-enviados-schema.test.ts`, `test/exames-enviados.ts`
- Modify: `src/db/schema/index.ts`, `src/db/schema/platform.ts` (`tenants`, `storedFiles`), `src/db/schema/agenda.ts` (CHECK `notifications_tipo_valido`), `src/db/rls-guard.ts` (`PACIENTE_ESCREVE`), `test/isolamento.test.ts` (`FABRICAS`, `COM_MAE`, `SEM_DELETE`, `IMUTAVEIS`, `SO_APAGA.patients`, `UPDATE_DO_PACIENTE`), `src/db/paciente-escrita.test.ts` (caso (c)), `src/modules/plataforma/armazenamento.ts` (`TipoDeArquivo`, `TIPOS_DO_PACIENTE`), `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO`), `src/modules/notificacoes/tipos.ts` (+ `tipos.test.ts`), `CLAUDE.md` (regras 2 e 8)

**Interfaces:**
- Consumes: `app_enable_tenant_rls`, `app_enable_patient_rls`, `app_enable_audit`, `app_allow_paciente_escrita`, `app_current_role()`, `app_current_user()`, `app_current_patient()` (0007/0017/0051/0070); `exams_tenant_paciente_id_unique` (0098); `tenants`, `patients`, `exams`, `storedFiles`; `salvarArquivo`; `PDF_MINIMO` (`test/ia.ts`).
- Produces:
  - `@/db/schema`: `examSubmissions`, `examSubmissionFiles`, `ExamSubmissionRow`, `ExamSubmissionFileRow`; `tenants.examesPacienteAtivadoEm`, `tenants.examesAvisoEm`.
  - Banco: gatilhos `exam_submissions_regras` e `exam_submissions_sem_apagar`; políticas `paciente_envio_insert`, `paciente_envio_update`, `paciente_envio_arquivo`; `paciente_arquivo_insert` e `paciente_arquivos` refeitas; função `admin_metricas_exames_enviados()`.
  - `TipoDeArquivo` com `'exame_original' | 'exame_pagina'`; `TipoNotificacao` com `'exame_revisado' | 'exame_expirado'`; `ENTIDADE_ROTULO.exames_enviados`.
  - `test/exames-enviados.ts`: `JPEG_MINIMO`, `ligarExames`, `envioNoBanco`, `arquivoDeEnvio`, `envioRecebido`, `jpegQueDeclara`, `jpegDe`.

- [ ] **Step 1: Criar os helpers de teste**

Criar `test/exames-enviados.ts`:

```ts
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { examSubmissionFiles, examSubmissions, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { salvarArquivo } from '@/modules/plataforma/armazenamento';
import { PDF_MINIMO } from './ia';

/** JPEG mínimo que passa no detectarTipo (não decodifica: só para arquivos que o teste não converte). */
export const JPEG_MINIMO = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 1)]);

/** D18: liga o recebimento de exames pelo app no tenant (fora de withTenant, como o seed). */
export async function ligarExames(db: Db, tenantId: string): Promise<void> {
  await db.update(tenants).set({ examesPacienteAtivadoEm: new Date() }).where(eq(tenants.id, tenantId));
}

/** Envio gravado direto por `ctx` (equipe: fora das políticas do paciente), na situação pedida. */
export async function envioNoBanco(db: Db, ctx: TenantContext, patientId: string, o: Partial<typeof examSubmissions.$inferInsert> = {}): Promise<string> {
  const [e] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(examSubmissions)
        .values({ tenantId: ctx.tenantId, patientId, enviadoPor: randomUUID(), status: 'recebido', dataColeta: '2026-09-28', nome: 'Hemograma', ...o })
        .returning({ id: examSubmissions.id }),
    db,
  );
  return e.id;
}

/** Arquivo do envio de verdade (stored_files + disco, com dono): PDF mínimo para `exame`, JPEG mínimo para os outros. */
export async function arquivoDeEnvio(
  db: Db,
  ctx: TenantContext,
  patientId: string,
  tipo: 'exame' | 'exame_original' | 'exame_pagina',
  dataDir: string,
  conteudo?: Buffer,
): Promise<string> {
  const a = await salvarArquivo(
    ctx,
    { tipo, conteudo: conteudo ?? (tipo === 'exame' ? PDF_MINIMO : JPEG_MINIMO), permitidos: ['pdf', 'jpg', 'png', 'heic'], patientId },
    { db, dataDir },
  );
  return a.caminho;
}

/** Envio "recebido" como o worker deixa: o PDF limpo apontado e `paginas` imagens de página (papel 'pagina'). */
export async function envioRecebido(
  db: Db,
  ctx: TenantContext,
  patientId: string,
  dataDir: string,
  o: { paginas?: number; nome?: string | null; dataColeta?: string; criadoEm?: Date } = {},
): Promise<{ id: string; pdf: string; paginas: string[] }> {
  const pdf = await arquivoDeEnvio(db, ctx, patientId, 'exame', dataDir);
  const id = await envioNoBanco(db, ctx, patientId, {
    status: 'recebido',
    arquivoPath: pdf,
    nome: o.nome === undefined ? 'Hemograma' : o.nome,
    dataColeta: o.dataColeta ?? '2026-09-28',
    ...(o.criadoEm ? { createdAt: o.criadoEm, updatedAt: o.criadoEm } : {}),
  });
  const paginas: string[] = [];
  for (let i = 0; i < (o.paginas ?? 2); i++) {
    const c = await arquivoDeEnvio(db, ctx, patientId, 'exame_pagina', dataDir);
    await withTenant(ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: ctx.tenantId, patientId, submissionId: id, arquivoPath: c, papel: 'pagina', ordem: i + 1 }), db);
    paginas.push(c);
  }
  return { id, pdf, paginas };
}

/** JPEG pequeno cujo cabeçalho (SOF0) declara `largura` × `altura` — o sharp e o pdf-lib leem só o cabeçalho. */
export async function jpegQueDeclara(largura: number, altura: number): Promise<Buffer> {
  const b = Buffer.from(await sharp({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).jpeg({ mozjpeg: false }).toBuffer());
  for (let i = 2; i + 9 < b.length; i++) {
    if (b[i] === 0xff && b[i + 1] === 0xc0) {
      b.writeUInt16BE(altura, i + 5);
      b.writeUInt16BE(largura, i + 7);
      return b;
    }
  }
  throw new Error('JPEG sem SOF0');
}

/** JPEG válido com `bytes` bytes (zeros depois do fim da imagem): passa no detectarTipo e no metadata() do sharp. */
export async function jpegDe(bytes: number): Promise<Buffer> {
  const base = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  return Buffer.concat([base, Buffer.alloc(Math.max(0, bytes - base.length), 0)]);
}
```

- [ ] **Step 2: Escrever o teste do banco (falha: as tabelas não existem)**

Criar `src/db/exames-enviados-schema.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco } from '../../test/exames-enviados';
import { auditLog, examSubmissionFiles, examSubmissions, exams, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { excluirExame } from '@/modules/pacientes/exames';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envios-schema-'));
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});

const codigo = (e: unknown) => ((e as { cause?: { code?: string } }).cause ?? (e as { code?: string })).code;
const falhaCom = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return codigo(e);
  }
  return 'sem erro';
};
const comoWorker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });

async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const conta = randomUUID();
  return { T, p, conta, comoPaciente: ctxPaciente(T.tenantId, p.id, conta) };
}
const mudar = (ctx: TenantContext, id: string, set: Partial<typeof examSubmissions.$inferInsert>) =>
  withTenant(ctx, (tx) => tx.update(examSubmissions).set(set).where(eq(examSubmissions.id, id)).returning({ id: examSubmissions.id }), app.db);

describe('Plano 12 — banco dos exames enviados (spec C v0.3 §13, §6.5)', () => {
  it('D18 = a: o tenant nasce com o recebimento desligado e sem aviso enviado', async () => {
    const T = await novoTenant(app.db);
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t).toMatchObject({ examesPacienteAtivadoEm: null, examesAvisoEm: null });
  });

  it('sessão de paciente: cria só envio "processando", dele e com a própria conta; a auditoria grava o paciente como ator', async () => {
    const { T, p, conta, comoPaciente } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const base = { tenantId: T.tenantId, patientId: p.id, enviadoPor: conta, dataColeta: '2026-09-28' };
    const inserir = (v: Partial<typeof examSubmissions.$inferInsert>) => withTenant(comoPaciente, (tx) => tx.insert(examSubmissions).values({ ...base, ...v }), app.db);
    await inserir({ status: 'processando' });
    expect(await falhaCom(inserir({ status: 'recebido' }))).toBe('42501');
    expect(await falhaCom(inserir({ status: 'processando', enviadoPor: randomUUID() }))).toBe('42501');
    expect(await falhaCom(inserir({ status: 'processando', patientId: outro.id }))).toBe('42501');
    const [linha] = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'exames_enviados'), eq(auditLog.patientId, p.id))), app.db);
    expect(linha).toMatchObject({ acao: 'criar', actorUserId: conta });
  });

  it('RN-166: o paciente só cancela o próprio envio "recebido" e não muda nenhuma outra coluna; não aceita', async () => {
    const { T, p, comoPaciente } = await cenario();
    const id = await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    expect(await falhaCom(mudar(comoPaciente, id, { status: 'cancelado', nome: 'Outro nome' }))).toBe('42501');
    expect(await falhaCom(mudar(comoPaciente, id, { status: 'aceito', revisadoPor: randomUUID(), revisadoEm: new Date() }))).toBe('42501');
    expect(await mudar(comoPaciente, id, { status: 'cancelado', updatedAt: new Date() })).toHaveLength(1);
    expect(await mudar(comoPaciente, id, { status: 'cancelado' })).toHaveLength(0); // já não é "recebido": a política esconde
    const processando = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    expect(await mudar(comoPaciente, processando, { status: 'cancelado' })).toHaveLength(0);
  });

  it('PM-14 / NGS1.03: cada papel só faz a sua transição; transição pulada, final reaberta e coluna fixa são recusadas', async () => {
    const { T, p } = await cenario();
    const worker = comoWorker(T.tenantId);
    const proc = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    expect(await falhaCom(mudar(T.ctx, proc, { status: 'recebido' }))).toBe('42501'); // "recebido" é do worker
    expect(await falhaCom(mudar(T.ctx, proc, { status: 'falhou', motivoFalha: 'conversao' }))).toBe('42501');
    expect(await falhaCom(mudar(T.ctx, proc, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() }))).toBe('42501'); // pula etapa
    await mudar(worker, proc, { status: 'falhou', motivoFalha: 'conversao' });
    expect(await falhaCom(mudar(worker, proc, { status: 'recebido' }))).toBe('42501'); // "falhou" é final
    const rec = await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    expect(await falhaCom(mudar(worker, rec, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() }))).toBe('42501'); // o worker não aceita
    await mudar(T.ctx, rec, { status: 'recusado', motivoRecusa: 'ilegivel', revisadoPor: T.nutriId, revisadoEm: new Date() });
    expect(await falhaCom(mudar(T.ctx, rec, { status: 'aceito' }))).toBe('42501');
    expect(await falhaCom(mudar(T.ctx, rec, { motivoRecusa: 'repetido' }))).toBe('42501'); // a revisão não é reescrita
    expect(await falhaCom(mudar(T.ctx, rec, { dataColeta: '2026-01-01' }))).toBe('42501');
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await falhaCom(mudar(T.ctx, rec, { patientId: outro.id }))).toBe('42501');
  });

  it('CHECKs: PDF limpo só em "recebido" e só do tipo exame; motivo só na recusa; "outro" exige texto; falha com motivo; nome ≤ 120', async () => {
    const { T, p } = await cenario();
    const pdf = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame', dataDir);
    const pagina = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_pagina', dataDir);
    const revisao = { revisadoPor: T.nutriId, revisadoEm: new Date() };
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'processando', arquivoPath: pdf }))).toBe('23514');
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', arquivoPath: pagina }))).toBe('23514');
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', motivoRecusa: 'outro', ...revisao }))).toBe('23514');
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', motivoRecusa: 'ilegivel', motivoRecusaTexto: 'x', ...revisao }))).toBe('23514');
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', motivoRecusa: 'ilegivel' }))).toBe('23514'); // sem quem e quando
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'falhou' }))).toBe('23514');
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', nome: 'x'.repeat(121) }))).toBe('23514');
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', arquivoPath: pdf });
  });

  it('excluir o exame aceito deixa o envio com exam_id nulo (ON DELETE SET NULL (exam_id)); exame de outro paciente não serve', async () => {
    const { T, p } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const exame = async (patientId: string) =>
      (await withTenant(T.ctx, (tx) => tx.insert(exams).values({ tenantId: T.tenantId, patientId, data: '2026-09-28', titulo: 'Hemograma' }).returning({ id: exams.id }), app.db))[0].id;
    const revisao = { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() } as const;
    expect(await falhaCom(envioNoBanco(app.db, T.ctx, p.id, { ...revisao, examId: await exame(outro.id) }))).toBe('23503');
    const ex = await exame(p.id);
    const id = await envioNoBanco(app.db, T.ctx, p.id, { ...revisao, examId: ex });
    expect(await excluirExame(T.ctx, p.id, ex, { db: app.db, dataDir })).toBe(true);
    const [e] = await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db);
    expect(e).toMatchObject({ id, examId: null, status: 'aceito' });
  });

  it('NGS1.12.03: ninguém apaga envio de paciente ativo — nem a nutricionista nem o worker; o worker apaga o do bloqueado', async () => {
    const { T, p } = await cenario();
    const id = await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    const apagar = (ctx: TenantContext) => withTenant(ctx, (tx) => tx.delete(examSubmissions).where(eq(examSubmissions.id, id)), app.db);
    expect(await falhaCom(apagar(T.ctx))).toBe('42501');
    expect(await falhaCom(apagar(comoWorker(T.tenantId)))).toBe('42501');
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    expect(await falhaCom(apagar(T.ctx))).toBe('42501');
    await apagar(comoWorker(T.tenantId));
    expect(await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db)).toEqual([]);
  });

  it('stored_files: o paciente grava exame_original (o dele), não grava exame_pagina nem exame, e não vê as páginas', async () => {
    const { T, p, comoPaciente } = await cenario();
    const arquivo = (tipo: string): SQL =>
      sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, ${tipo}, ${`${T.tenantId}/${tipo}/${randomUUID()}.jpg`}, 1, 'image/jpeg', ${p.id}) returning caminho`;
    const comoP = (q: SQL) => withTenant(comoPaciente, (tx) => tx.execute(q), app.db);
    expect((await comoP(arquivo('exame_original'))).rows).toHaveLength(1);
    for (const tipo of ['exame_pagina', 'exame']) expect(await falhaCom(comoP(arquivo(tipo))), tipo).toBe('42501');
    const pagina = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_pagina', dataDir);
    const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
    const vistos = (await comoP(sql`select caminho from stored_files`)).rows.map((r) => r.caminho);
    expect(vistos).toContain(original);
    expect(vistos).not.toContain(pagina);
  });

  it('exam_submission_files: o paciente só insere a linha "original" do próprio envio "processando", com o próprio original; não lê as páginas', async () => {
    const { T, p, comoPaciente } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    const envio = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    const recebido = await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
    const doOutro = await arquivoDeEnvio(app.db, T.ctx, outro.id, 'exame_original', dataDir);
    const pagina = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_pagina', dataDir);
    const linha = (submissionId: string, arquivoPath: string, papel = 'original') =>
      withTenant(comoPaciente, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId, arquivoPath, papel, ordem: 1 }), app.db);
    expect(await falhaCom(linha(envio, doOutro))).toBe('42501');
    expect(await falhaCom(linha(recebido, original))).toBe('42501');
    expect(await falhaCom(linha(envio, pagina, 'pagina'))).toBe('42501');
    await linha(envio, original);
    await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId: envio, arquivoPath: pagina, papel: 'pagina', ordem: 1 }), app.db);
    const vistas = await withTenant(comoPaciente, (tx) => tx.select({ papel: examSubmissionFiles.papel }).from(examSubmissionFiles), app.db);
    expect(vistas).toEqual([{ papel: 'original' }]);
  });

  it('admin_metricas_exames_enviados(): só contagens por tenant (enviados no mês e aguardando); recusa rodar dentro de withTenant', async () => {
    const { T, p } = await cenario();
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    const antigo = new Date(Date.now() - 70 * 86_400_000);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', createdAt: antigo, updatedAt: antigo });
    const r = await app.db.execute<{ tenant_id: string; enviados_mes: string; pendentes: string }>(sql`select * from admin_metricas_exames_enviados()`);
    const linha = r.rows.find((x) => x.tenant_id === T.tenantId)!;
    expect(Object.keys(linha).sort()).toEqual(['enviados_mes', 'pendentes', 'tenant_id']);
    expect(Number(linha.enviados_mes)).toBe(3);
    expect(Number(linha.pendentes)).toBe(3);
    expect(await falhaCom(withTenant(T.ctx, (tx) => tx.execute(sql`select * from admin_metricas_exames_enviados()`), app.db))).toBe('55000');
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `pnpm vitest run src/db/exames-enviados-schema.test.ts`
Expected: FAIL — `examSubmissions` não existe em `@/db/schema` (erro de importação).

- [ ] **Step 4: Schema das tabelas novas**

Criar `src/db/schema/exames-enviados.ts`:

```ts
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { patients } from './pacientes';
import { storedFiles, tenants } from './platform';

/**
 * Plano 12 (spec C v0.3 §13.1, F3-04): exame enviado pelo paciente pelo app. Fica FORA do prontuário até a nutricionista
 * aceitar (vira `exams`). A FK composta para `exams` com `ON DELETE SET NULL (exam_id)` fica só na migration custom 0102
 * (o Drizzle não declara a lista de colunas do SET NULL), como em ia_tarefas (0099). As transições por papel e o "sem
 * apagar" são gatilhos da 0102 (§6.5); as políticas da sessão de paciente também.
 */
export const examSubmissions = pgTable(
  'exam_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    /** Conta do paciente que enviou (sem FK, como data_exports.solicitado_por). */
    enviadoPor: uuid('enviado_por').notNull(),
    status: text('status').notNull().default('processando'),
    dataColeta: date('data_coleta', { mode: 'string' }).notNull(),
    nome: text('nome'),
    /** Dado de saúde (texto do paciente). */
    observacao: text('observacao'),
    /** O PDF limpo (tipo `exame`), só em `recebido`; no aceite o ponteiro passa ao exame (um dono só). */
    arquivoPath: text('arquivo_path').references(() => storedFiles.caminho, { onDelete: 'set null' }),
    motivoRecusa: text('motivo_recusa'),
    motivoRecusaTexto: text('motivo_recusa_texto'),
    motivoFalha: text('motivo_falha'),
    examId: uuid('exam_id'),
    /** ECF.17.01: quem aceitou ou recusou, e quando. */
    revisadoPor: uuid('revisado_por'),
    revisadoEm: timestamp('revisado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'exam_submissions_paciente_fk' }),
    // alvo da FK composta das linhas de arquivo (mesmo tenant e mesmo paciente)
    unique('exam_submissions_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    check('exam_submissions_status_valido', sql`${t.status} in ('processando', 'recebido', 'aceito', 'recusado', 'cancelado', 'expirado', 'falhou')`),
    check('exam_submissions_nome_tamanho', sql`${t.nome} is null or char_length(${t.nome}) between 1 and 120`),
    check('exam_submissions_observacao_tamanho', sql`${t.observacao} is null or char_length(${t.observacao}) between 1 and 500`),
    check('exam_submissions_arquivo_so_recebido', sql`${t.arquivoPath} is null or (${t.status} = 'recebido' and ${t.arquivoPath} like ${t.tenantId}::text || '/exame/%')`),
    check(
      'exam_submissions_recusa',
      sql`(${t.status} = 'recusado') = (${t.motivoRecusa} is not null) and (${t.motivoRecusa} is null or ${t.motivoRecusa} in ('ilegivel', 'nao_e_exame', 'outra_pessoa', 'repetido', 'outro'))`,
    ),
    check(
      'exam_submissions_recusa_texto',
      sql`(${t.motivoRecusaTexto} is not null) = (${t.motivoRecusa} is not distinct from 'outro') and (${t.motivoRecusaTexto} is null or char_length(${t.motivoRecusaTexto}) between 1 and 300)`,
    ),
    check('exam_submissions_exame_so_aceito', sql`${t.examId} is null or ${t.status} = 'aceito'`),
    check('exam_submissions_revisao', sql`(${t.status} in ('aceito', 'recusado')) = (${t.revisadoEm} is not null) and (${t.revisadoEm} is null) = (${t.revisadoPor} is null)`),
    check(
      'exam_submissions_falha',
      sql`(${t.status} = 'falhou') = (${t.motivoFalha} is not null) and (${t.motivoFalha} is null or ${t.motivoFalha} in ('conversao', 'paginas', 'cota', 'interrompido'))`,
    ),
    index('exam_submissions_fila_idx').on(t.tenantId, t.status, t.createdAt),
    index('exam_submissions_paciente_idx').on(t.tenantId, t.patientId, t.createdAt.desc()),
  ],
);

export type ExamSubmissionRow = typeof examSubmissions.$inferSelect;

/**
 * Plano 12: os arquivos do envio — os originais do paciente (`original`, tipo `exame_original`, só enquanto o envio está
 * `processando`) e as imagens de página para a revisão (`pagina`, tipo `exame_pagina`, D23). Apagar o arquivo pela API de
 * armazenamento apaga a linha junto (FK `ON DELETE CASCADE`, regra 9).
 */
export const examSubmissionFiles = pgTable(
  'exam_submission_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    submissionId: uuid('submission_id').notNull(),
    arquivoPath: text('arquivo_path')
      .notNull()
      .references(() => storedFiles.caminho, { onDelete: 'cascade' }),
    papel: text('papel').notNull(),
    ordem: integer('ordem').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId, t.submissionId], foreignColumns: [examSubmissions.tenantId, examSubmissions.patientId, examSubmissions.id], name: 'exam_submission_files_envio_fk' }).onDelete('cascade'),
    check(
      'exam_submission_files_papel_valido',
      sql`(${t.papel} = 'original' and ${t.arquivoPath} like ${t.tenantId}::text || '/exame_original/%') or (${t.papel} = 'pagina' and ${t.arquivoPath} like ${t.tenantId}::text || '/exame_pagina/%')`,
    ),
    check('exam_submission_files_ordem_valida', sql`${t.ordem} between 1 and 10`),
    uniqueIndex('exam_submission_files_ordem_idx').on(t.submissionId, t.papel, t.ordem),
    unique('exam_submission_files_arquivo_unique').on(t.arquivoPath),
    index('exam_submission_files_envio_idx').on(t.tenantId, t.submissionId),
  ],
);

export type ExamSubmissionFileRow = typeof examSubmissionFiles.$inferSelect;
```

Em `src/db/schema/index.ts`, acrescentar no fim: `export * from './exames-enviados';`.

Em `src/db/schema/platform.ts`, na tabela `tenants`, depois de `iaAvisoMes`:

```ts
    /** Plano 12 (D18 = a): a nutricionista ligou o recebimento de exames pelo app. Nulo = desligado (nasce nulo para todos). */
    examesPacienteAtivadoEm: timestamp('exames_paciente_ativado_em', { withTimezone: true }),
    /** RN-168: último e-mail "exames novos" à nutricionista (no máximo 1 a cada 6 h). */
    examesAvisoEm: timestamp('exames_aviso_em', { withTimezone: true }),
```

e, em `storedFiles`, trocar o CHECK `stored_files_tipo_valido` por:

```ts
    check(
      'stored_files_tipo_valido',
      sql`${t.tipo} in ('logo','capa','exame','plano_pdf','diario_foto','diario_foto_original','orientacao_pdf','exportacao','documento_base','documento_assinado','documento_digitalizado','exame_original','exame_pagina')`,
    ),
```

(o CHECK `stored_files_dono` **não muda**: os tipos novos já caem no lado "tem dono" — Desvio 3).

Em `src/db/schema/agenda.ts`, no CHECK `notifications_tipo_valido`, acrescentar `'exame_revisado', 'exame_expirado'` ao fim da lista.

- [ ] **Step 5: Gerar a migration 0101 e conferir**

Run: `pnpm db:generate --name exames_enviados`
Expected: `drizzle/0101_exames_enviados.sql` com **só**: `CREATE TABLE "exam_submissions"` e `"exam_submission_files"` (com as FKs, CHECKs, UNIQUE e índices acima), `ALTER TABLE "tenants" ADD COLUMN "exames_paciente_ativado_em"` e `"exames_aviso_em"`, `DROP/ADD CONSTRAINT "stored_files_tipo_valido"` e `DROP/ADD CONSTRAINT "notifications_tipo_valido"`. Se aparecer qualquer outra mudança (sinal de schema fora de sincronia), parar e avisar o controlador.

- [ ] **Step 6: Escrever a migration custom 0102**

Run: `pnpm drizzle-kit generate --custom --name rls_exames_enviados`
Expected: `drizzle/0102_rls_exames_enviados.sql` vazio e a entrada no `drizzle/meta/_journal.json`.

Preencher `drizzle/0102_rls_exames_enviados.sql`:

```sql
-- Plano 12 (spec C v0.3, §13.1, §6.5). CLAUDE.md regras 2, 8 e 9.
-- FK composta para exams com SET NULL só do exam_id (PostgreSQL 15+), como ia_tarefas (0099): excluir o exame aceito mantém o
-- registro de que ele veio do paciente; o tenant e o paciente do envio nunca mudam.
ALTER TABLE exam_submissions ADD CONSTRAINT exam_submissions_exame_fk
  FOREIGN KEY (tenant_id, patient_id, exam_id) REFERENCES exams (tenant_id, patient_id, id) ON DELETE SET NULL (exam_id);
--> statement-breakpoint
SELECT app_enable_tenant_rls('exam_submissions');
--> statement-breakpoint
SELECT app_enable_patient_rls('exam_submissions');
--> statement-breakpoint
SELECT app_enable_audit('exam_submissions', 'exames_enviados');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('exam_submissions', 'insert', 'update');
--> statement-breakpoint
SELECT app_enable_tenant_rls('exam_submission_files');
--> statement-breakpoint
SELECT app_enable_patient_rls('exam_submission_files');
--> statement-breakpoint
SELECT app_enable_audit('exam_submission_files', 'exames_enviados');
--> statement-breakpoint
SELECT app_allow_paciente_escrita('exam_submission_files', 'insert');
--> statement-breakpoint
-- RN-160/RN-166 (NGS1.03.04): a sessão de paciente só CRIA envio "processando", dela (conta da sessão) e sem nada da revisão
-- nem do processamento; e só ALTERA envio "recebido" para "cancelado" (o gatilho abaixo confere que nenhuma outra coluna muda).
-- RESTRICTIVE e só para o papel `paciente`: soma-se às políticas de tenant e de paciente; a equipe e o worker não mudam.
CREATE POLICY paciente_envio_insert ON exam_submissions AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (status = 'processando' AND enviado_por = app_current_user() AND arquivo_path IS NULL AND exam_id IS NULL
        AND revisado_por IS NULL AND revisado_em IS NULL AND motivo_recusa IS NULL AND motivo_recusa_texto IS NULL AND motivo_falha IS NULL)
  );
--> statement-breakpoint
CREATE POLICY paciente_envio_update ON exam_submissions AS RESTRICTIVE FOR UPDATE
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR status = 'recebido')
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR status = 'cancelado');
--> statement-breakpoint
-- US-160: o paciente registra só os ORIGINAIS do próprio envio "processando", apontando para um exame_original dele (sem isto a
-- sessão de paciente poderia apontar o arquivo de OUTRO paciente do tenant — a FK não passa pela RLS — e o worker o
-- processaria para este envio). As imagens de página (D23) são do worker: o paciente nem as lê.
CREATE POLICY paciente_envio_arquivo ON exam_submission_files AS RESTRICTIVE FOR ALL
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR papel = 'original')
  WITH CHECK (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (papel = 'original'
        AND EXISTS (SELECT 1 FROM exam_submissions s
                     WHERE s.tenant_id = exam_submission_files.tenant_id AND s.id = exam_submission_files.submission_id
                       AND s.patient_id = exam_submission_files.patient_id AND s.status = 'processando')
        AND EXISTS (SELECT 1 FROM stored_files sf
                     WHERE sf.tenant_id = exam_submission_files.tenant_id AND sf.caminho = exam_submission_files.arquivo_path
                       AND sf.patient_id = exam_submission_files.patient_id AND sf.tipo = 'exame_original'))
  );
--> statement-breakpoint
-- D4 (0080): a sessão de paciente grava só a foto original do diário e, agora, o original do exame enviado.
DROP POLICY paciente_arquivo_insert ON stored_files;
--> statement-breakpoint
CREATE POLICY paciente_arquivo_insert ON stored_files AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR tipo IN ('diario_foto_original', 'exame_original'));
--> statement-breakpoint
-- 0090 + Plano 12: o paciente também não vê as imagens de página do envio (temporárias, só para a revisão). O exame_original
-- continua visível ao dono: a paciente_envio_arquivo confere, sob a RLS da própria sessão, que o original é dele (Desvio 1).
DROP POLICY paciente_arquivos ON stored_files;
--> statement-breakpoint
CREATE POLICY paciente_arquivos ON stored_files AS RESTRICTIVE FOR ALL
  USING (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR (patient_id = app_current_patient() AND tipo NOT IN ('documento_base', 'documento_digitalizado', 'exame_pagina'))
    OR tipo = 'logo'
    OR (tipo = 'capa' AND EXISTS (SELECT 1 FROM contents c WHERE c.tenant_id = stored_files.tenant_id AND c.capa_path = stored_files.caminho))
  )
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR patient_id = app_current_patient());
--> statement-breakpoint
-- PM-14 / §6.5 (NGS1.03.01, NGS1.03.04): cada papel só faz a sua transição, conferida no banco — nem o código da equipe pula
-- etapas. Colunas fixas; transições permitidas; quem faz cada uma; o PDF limpo só entra no fim do processamento e o exame só
-- no aceite (os dois podem ir a nulo a qualquer hora: limpeza e o SET NULL da FK); a revisão só é gravada no aceite ou na
-- recusa; a falha, só na falha; a sessão de paciente só muda a situação (e updated_at). Sem contexto (migrations, seed) as
-- transições continuam conferidas. Recusa com 42501, como a RLS.
CREATE OR REPLACE FUNCTION app_exam_submissions_regras() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.enviado_por, NEW.data_coleta, NEW.nome, NEW.observacao, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.enviado_por, OLD.data_coleta, OLD.nome, OLD.observacao, OLD.created_at) THEN
    RAISE EXCEPTION 'coluna fixa do envio de exame' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status, NEW.status) NOT IN (('processando', 'recebido'), ('processando', 'falhou'), ('recebido', 'aceito'),
                                         ('recebido', 'recusado'), ('recebido', 'cancelado'), ('recebido', 'expirado')) THEN
      RAISE EXCEPTION 'transição de envio de exame inválida' USING ERRCODE = '42501';
    END IF;
    IF r <> '' AND NOT ((NEW.status IN ('recebido', 'falhou', 'expirado') AND r = 'worker')
                        OR (NEW.status IN ('aceito', 'recusado') AND r = 'nutri')
                        OR (NEW.status = 'cancelado' AND r = 'paciente')) THEN
      RAISE EXCEPTION 'este papel não faz esta transição do envio de exame' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.arquivo_path IS NOT NULL AND NEW.arquivo_path IS DISTINCT FROM OLD.arquivo_path
     AND NOT (OLD.status = 'processando' AND NEW.status = 'recebido') THEN
    RAISE EXCEPTION 'o PDF limpo só entra no fim do processamento' USING ERRCODE = '42501';
  END IF;
  IF NEW.exam_id IS NOT NULL AND NEW.exam_id IS DISTINCT FROM OLD.exam_id AND NOT (OLD.status = 'recebido' AND NEW.status = 'aceito') THEN
    RAISE EXCEPTION 'o envio só ganha exame no aceite' USING ERRCODE = '42501';
  END IF;
  IF (NEW.revisado_por, NEW.revisado_em, NEW.motivo_recusa, NEW.motivo_recusa_texto)
     IS DISTINCT FROM (OLD.revisado_por, OLD.revisado_em, OLD.motivo_recusa, OLD.motivo_recusa_texto)
     AND NOT (OLD.status = 'recebido' AND NEW.status IN ('aceito', 'recusado')) THEN
    RAISE EXCEPTION 'a revisão só é gravada no aceite ou na recusa' USING ERRCODE = '42501';
  END IF;
  IF NEW.motivo_falha IS DISTINCT FROM OLD.motivo_falha AND NOT (OLD.status = 'processando' AND NEW.status = 'falhou') THEN
    RAISE EXCEPTION 'o motivo da falha só é gravado na falha' USING ERRCODE = '42501';
  END IF;
  IF r = 'paciente' AND (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'o paciente só cancela o envio' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER exam_submissions_regras BEFORE UPDATE ON exam_submissions FOR EACH ROW EXECUTE FUNCTION app_exam_submissions_regras();
--> statement-breakpoint
-- §6.5 item 2 (NGS1.12.03): o registro do envio não é apagado na revisão (só os arquivos saem). A linha só sai no pedido de
-- exclusão atendido e na anonimização (lgpd.ts, contexto worker). O papel worker também roda no processo web (agendamento
-- público, webhook do WhatsApp, link de documento): por isso o gatilho exige o titular bloqueado ou anonimizado.
CREATE OR REPLACE FUNCTION app_exam_submissions_sem_apagar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_role() IS DISTINCT FROM 'worker'
     OR NOT EXISTS (SELECT 1 FROM patients p WHERE p.tenant_id = OLD.tenant_id AND p.id = OLD.patient_id
                       AND (p.status = 'bloqueado' OR p.anonimizado_em IS NOT NULL)) THEN
    RAISE EXCEPTION 'envios de exame só são apagados no pedido de exclusão atendido ou na anonimização' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER exam_submissions_sem_apagar BEFORE DELETE ON exam_submissions FOR EACH ROW EXECUTE FUNCTION app_exam_submissions_sem_apagar();
--> statement-breakpoint
-- §3: o admin vê só contagens por tenant — envios no mês (fuso do tenant) e aguardando (processando + recebido). Molde de
-- admin_metricas_ia (0099); função própria para não mudar o tipo de retorno de admin_tenant_metrics (Desvio 2).
CREATE OR REPLACE FUNCTION admin_metricas_exames_enviados()
RETURNS TABLE (tenant_id uuid, enviados_mes bigint, pendentes bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t record;
  v_inicio timestamptz;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_metricas_exames_enviados() não pode rodar dentro de withTenant' USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.fuso FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    v_inicio := date_trunc('month', now() AT TIME ZONE t.fuso) AT TIME ZONE t.fuso;
    tenant_id := t.id;
    SELECT count(*) FILTER (WHERE s.created_at >= v_inicio), count(*) FILTER (WHERE s.status IN ('processando', 'recebido'))
      INTO enviados_mes, pendentes
      FROM public.exam_submissions s
     WHERE s.tenant_id = t.id;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_metricas_exames_enviados() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_metricas_exames_enviados() TO nutri_app_role;
```

- [ ] **Step 7: Tipos, rótulos e guardas**

Em `src/modules/plataforma/armazenamento.ts`:

```ts
export type TipoDeArquivo =
  | 'logo' | 'capa' | 'exame' | 'plano_pdf' | 'diario_foto' | 'diario_foto_original' | 'orientacao_pdf' | 'exportacao'
  | 'documento_base' | 'documento_assinado' | 'documento_digitalizado' | 'exame_original' | 'exame_pagina';

/** D4: arquivos com dono (paciente). O resto é do consultório. Plano 12: o original e as páginas do exame enviado. */
export const TIPOS_DO_PACIENTE: readonly TipoDeArquivo[] = [
  'exame', 'plano_pdf', 'diario_foto', 'diario_foto_original', 'exportacao', 'documento_base', 'documento_assinado', 'documento_digitalizado',
  'exame_original', 'exame_pagina',
];
```

Em `src/modules/plataforma/audit.ts`, em `ENTIDADE_ROTULO`, depois de `ia`: `exames_enviados: 'Exames enviados pelo paciente',`.

Em `src/modules/notificacoes/tipos.ts`: acrescentar `| 'exame_revisado' | 'exame_expirado'` ao fim de `TipoNotificacao` e, em `ROTULO_TIPO`, `exame_revisado: 'Exame revisado',` e `exame_expirado: 'Exame expirado',`. Em `src/modules/notificacoes/tipos.test.ts`, na lista do teste "tem rótulo para todo tipo do CHECK de notifications", acrescentar `'documento_novo', 'documento_atualizado', 'exame_revisado', 'exame_expirado'`.

Em `src/db/rls-guard.ts`, em `PACIENTE_ESCREVE`, trocar a entrada de `stored_files` e acrescentar as duas tabelas:

```ts
  stored_files: { comandos: ['insert'], motivo: 'foto do diário (US-042) e original do exame enviado (US-160, Plano 12): salvarArquivo/salvarArquivos com a sessão do paciente — só os tipos diario_foto_original e exame_original (0080, 0102)' },
  exam_submissions: { comandos: ['insert', 'update'], motivo: 'US-160/US-161 (Plano 12): o paciente cria o envio "processando" e cancela o próprio "recebido" — políticas paciente_envio_insert/paciente_envio_update e o gatilho exam_submissions_regras (0102)' },
  exam_submission_files: { comandos: ['insert'], motivo: 'US-160 (Plano 12): o paciente registra os originais do próprio envio "processando" (paciente_envio_arquivo, 0102); não lê as páginas' },
```

Em `test/isolamento.test.ts`:

```ts
// em FABRICAS, depois de ia_uso:
  // Plano 12: "recebido" para a sessão de paciente conseguir cancelar a própria linha (UPDATE_DO_PACIENTE); o gatilho
  // exam_submissions_regras recusa mudar tenant/paciente (IMUTAVEIS) e o exam_submissions_sem_apagar recusa o DELETE (SEM_DELETE)
  exam_submissions: (t, p) =>
    sql`insert into exam_submissions (tenant_id, patient_id, enviado_por, status, data_coleta)
        values (${t}, ${p}, coalesce(app_current_user(), gen_random_uuid()), 'recebido', '2026-01-01')`,
  // a linha de arquivo precisa do original (stored_files) e do envio: cria os dois no mesmo comando (COM_MAE)
  exam_submission_files: (t, p) =>
    sql`with a as (insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id)
                   values (${t}, 'exame_original', ${t}::text || '/exame_original/' || gen_random_uuid()::text || '.jpg', 1, 'image/jpeg', ${p}) returning caminho),
             s as (insert into exam_submissions (tenant_id, patient_id, enviado_por, status, data_coleta)
                   values (${t}, ${p}, coalesce(app_current_user(), gen_random_uuid()), 'recebido', '2026-01-01') returning id)
        insert into exam_submission_files (tenant_id, patient_id, submission_id, arquivo_path, papel, ordem)
        select ${t}, ${p}, s.id, a.caminho, 'original', 1 from a, s`,
```

e, nas listas:

```ts
const SEM_DELETE = new Set(['ia_tarefas', 'ia_uso', 'exam_submissions']);
const IMUTAVEIS = new Set(['signed_documents', 'signed_document_notes', 'document_access_codes', 'ia_tarefas', 'exam_submissions']);
// SO_APAGA.patients ganha, no fim da expressão:
//                and not exists (select 1 from exam_submissions e where e.tenant_id = patients.tenant_id and e.patient_id = patients.id)
// COM_MAE ganha 'exam_submission_files'
const UPDATE_DO_PACIENTE: Record<string, SQL> = { data_exports: sql`status = 'falhou'`, exam_submissions: sql`status = 'cancelado'` };
```

(Atualizar os comentários de `SEM_DELETE`, `IMUTAVEIS` e `UPDATE_DO_PACIENTE` com "Plano 12: exam_submissions — gatilhos `exam_submissions_sem_apagar` e `exam_submissions_regras` (0102); o paciente só cancela o próprio recebido".)

Em `src/db/paciente-escrita.test.ts`, trocar o caso (c) por:

```ts
  it('(c) stored_files: o paciente só grava a foto original do diário e o original do exame enviado (Plano 12) — nem laudo, PDF, ZIP ou página de exame', async () => {
    const { T, p2, comoP2 } = await cenario();
    for (const tipo of ['exame', 'plano_pdf', 'diario_foto', 'exportacao', 'exame_pagina']) await expect(comoP2(arquivo(T.tenantId, p2.id, tipo)), tipo).rejects.toSatisfy(violaRls);
    expect((await comoP2(arquivo(T.tenantId, p2.id, 'diario_foto_original'))).rows).toHaveLength(1);
    expect((await comoP2(arquivo(T.tenantId, p2.id, 'exame_original'))).rows).toHaveLength(1);
  });
```

- [ ] **Step 8: CLAUDE.md (regras 2 e 8)**

Na regra 2, no fim: "Plano 12: `exam_submissions` (`insert`, `update`) e `exam_submission_files` (`insert`) em `PACIENTE_ESCREVE`, com as políticas `RESTRICTIVE` `paciente_envio_insert`, `paciente_envio_update` e `paciente_envio_arquivo` (0102); `stored_files` aceita da sessão de paciente os tipos `diario_foto_original` e `exame_original`; `exam_submissions` tem o gatilho de transições `exam_submissions_regras` (cada papel só faz a sua) e o `exam_submissions_sem_apagar` (DELETE só pelo worker com o titular bloqueado ou anonimizado) e entra em `IMUTAVEIS` e `SEM_DELETE` de `test/isolamento.test.ts`."

Na regra 8, no fim: "Plano 12: `exam_submissions` e `exam_submission_files` têm o gatilho (entidade `exames_enviados`, "Exames enviados pelo paciente"); `auditRead` ao abrir o envio no painel (`abrirEnvio`) e, no portal, na lista e no download do próprio PDF (`meusEnvios`, `pdfDoMeuEnvio`); a fila "Exames recebidos" e os contadores não chamam (só listam, como a lista de pacientes)."

- [ ] **Step 9: Rodar os testes do banco e as guardas**

Run: `pnpm vitest run src/db/exames-enviados-schema.test.ts test/isolamento.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts src/db/paciente-escrita.test.ts src/modules/notificacoes/tipos.test.ts src/modules/plataforma/armazenamento-paciente.test.ts`
Expected: PASS (o Testcontainers aplica `0101` e `0102`; a guarda de RLS acha as duas tabelas com tenant e paciente e as entradas novas de `PACIENTE_ESCREVE`; a de auditoria acha os dois gatilhos; o isolamento passa com as fábricas novas).

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 10: Commit**

```bash
git add src/db/schema/exames-enviados.ts src/db/schema/index.ts src/db/schema/platform.ts src/db/schema/agenda.ts \
  drizzle/0101_exames_enviados.sql drizzle/0102_rls_exames_enviados.sql drizzle/meta src/db/exames-enviados-schema.test.ts \
  src/db/rls-guard.ts src/db/paciente-escrita.test.ts test/isolamento.test.ts test/exames-enviados.ts \
  src/modules/plataforma/armazenamento.ts src/modules/plataforma/audit.ts src/modules/notificacoes/tipos.ts src/modules/notificacoes/tipos.test.ts CLAUDE.md
git commit -m "feat(exames-enviados): banco — envios do paciente, RLS, transições, sem apagar e auditoria (P12-01)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 2: Constantes e textos, `salvarArquivos` (lote do paciente), limpeza dos arquivos do envio e JPEG do laudo (P12-02)

**Revisão: completa (agente revisor-rls)** — armazenamento e cota (reserva única, tudo ou nada, devolução), ponteiros na transação do arquivo (regra 9).

**Files:**
- Create: `src/modules/pacientes/exames-enviados-constantes.ts` (+ `exames-enviados-constantes.test.ts`), `src/modules/pacientes/exames-enviados-arquivos.ts` (+ `exames-enviados-arquivos.test.ts`), `src/modules/plataforma/armazenamento-lote.test.ts`, `src/lib/jpeg.test.ts`
- Modify: `src/modules/plataforma/armazenamento.ts` (`salvarArquivos`), `src/lib/jpeg.ts` (parâmetro `qualidade`), `src/modules/portal/diario-foto-job.ts` (`fotoParaJpeg`, `FotoInvalidaError`, `AbrirHeic` exportados), `src/modules/portal/diario-foto-job.test.ts` (um caso novo), `CLAUDE.md` (regra 9)

**Interfaces:**
- Consumes: T1 (`examSubmissions`, `examSubmissionFiles`, tipos novos); `apagarArquivo`, `detectarTipo`, `resolverCaminho`, `CotaEsgotadaError`, `TipoNaoPermitidoError`, `COTA_BYTES`; `EXAME_MAX_BYTES` (`exames-constantes.ts`).
- Produces: `salvarArquivos`; `paraJpegSemMetadados(img, ladoMax, qualidade = 80)`; `fotoParaJpeg`, `FotoInvalidaError`, `AbrirHeic`; todas as constantes, textos e funções puras de `exames-enviados-constantes.ts`; `apagarArquivosDoEnvio` (contrato no topo).

- [ ] **Step 1: Teste das constantes e textos (falha: o módulo não existe)**

Criar `src/modules/pacientes/exames-enviados-constantes.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { diasEntre, ENVIO_TOTAL_MAX_BYTES, haDias, MSG_ENVIO, MSG_REVISAO, nomeDoEnvio, ROTULO_MOTIVO_RECUSA, situacaoParaPaciente } from './exames-enviados-constantes';

const s = (status: string, extra: Partial<Parameters<typeof situacaoParaPaciente>[0]> = {}) =>
  situacaoParaPaciente({ status, motivoRecusa: null, motivoRecusaTexto: null, motivoFalha: null, ...extra });

describe('textos do envio de exame (spec C v0.3 §6.2, US-160 a US-165)', () => {
  it('a situação que o paciente vê, com o texto exato da spec', () => {
    expect(s('processando')).toBe('Processando…');
    expect(s('recebido')).toBe('Aguardando sua nutricionista');
    expect(s('aceito')).toBe('Recebido no seu prontuário');
    expect(s('recusado', { motivoRecusa: 'ilegivel' })).toBe('Não aceito: Arquivo ilegível');
    expect(s('recusado', { motivoRecusa: 'outra_pessoa' })).toBe('Não aceito: Exame de outra pessoa');
    expect(s('recusado', { motivoRecusa: 'outro', motivoRecusaTexto: 'Faltou a página 2' })).toBe('Não aceito: Faltou a página 2');
    expect(s('expirado')).toBe('Não revisado a tempo. Se ainda for útil, envie de novo.');
    expect(s('falhou', { motivoFalha: 'conversao' })).toBe('Não conseguimos processar o arquivo. Tente enviar de novo.');
    expect(s('falhou', { motivoFalha: 'interrompido' })).toBe('Não conseguimos processar o arquivo. Tente enviar de novo.');
    expect(s('falhou', { motivoFalha: 'paginas' })).toBe('O PDF tem mais de 10 páginas. Envie só as páginas com os resultados.');
    expect(s('falhou', { motivoFalha: 'cota' })).toBe('Não foi possível enviar agora: o espaço de arquivos do consultório acabou. Avise sua nutricionista.');
  });

  it('motivos de recusa e mensagens da US-160 a US-165', () => {
    expect(Object.values(ROTULO_MOTIVO_RECUSA)).toEqual(['Arquivo ilegível', 'Não é um exame', 'Exame de outra pessoa', 'Exame repetido', 'Outro motivo']);
    expect(MSG_ENVIO.arquivos).toBe('Envie 1 PDF de até 20 MB ou até 5 fotos (JPEG, PNG ou HEIC) de até 10 MB cada, somando até 30 MB.');
    expect(MSG_ENVIO.enviado).toBe('Exame enviado. Sua nutricionista vai revisar.');
    expect(MSG_ENVIO.pendentes).toBe('Você já tem 10 exames aguardando sua nutricionista. Aguarde a revisão antes de enviar outros.');
    expect(MSG_ENVIO.porDia).toBe('Você já enviou 5 exames hoje. Tente amanhã.');
    expect(MSG_REVISAO.pushNeutro).toBe('Há uma atualização para você no app.');
    expect(MSG_REVISAO.pushNeutro.toLowerCase()).not.toContain('exame');
    expect(MSG_REVISAO.noProntuario(1)).toBe('Exames enviados pelo paciente (1)');
    expect(ENVIO_TOTAL_MAX_BYTES).toBe(30 * 1024 * 1024);
  });

  it('nome do envio sem nome, "há {n} dias" e dias entre datas (fila da US-162)', () => {
    expect(nomeDoEnvio('Hemograma', '28/09/2026')).toBe('Hemograma');
    expect(nomeDoEnvio(null, '28/09/2026')).toBe('Exame enviado em 28/09/2026');
    expect(diasEntre('2026-09-28', '2026-10-07')).toBe(9);
    expect(diasEntre('2026-10-07', '2026-10-07')).toBe(0);
    expect(haDias(0)).toBe('hoje');
    expect(haDias(1)).toBe('há 1 dia');
    expect(haDias(9)).toBe('há 9 dias');
  });

  it('sem import de servidor: o formulário do portal (cliente) usa este arquivo', () => {
    const fonte = readFileSync('src/modules/pacientes/exames-enviados-constantes.ts', 'utf8');
    expect(fonte).not.toMatch(/from '@\/(db|jobs|env|lib)|from 'node:|from 'sharp'/);
  });
});
```

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-constantes.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 2: Constantes e textos**

Criar `src/modules/pacientes/exames-enviados-constantes.ts`:

```ts
import { EXAME_MAX_BYTES } from './exames-constantes';

/** Plano 12 (F3-04). Sem banco e sem Node: o formulário do portal (cliente), o painel e o worker usam. Textos da spec C v0.3. */
export const ENVIO_PDF_MAX_BYTES = EXAME_MAX_BYTES; // D13 = b: o mesmo da US-015 (20 MB)
export const ENVIO_FOTO_MAX_BYTES = 10 * 1024 * 1024; // D13 = b: o teto da foto do diário
export const ENVIO_TOTAL_MAX_BYTES = 30 * 1024 * 1024;
export const ENVIO_MAX_FOTOS = 5;
export const ENVIO_MAX_PAGINAS = 10;
/** RN-161: JPEG/PNG acima disto recusados pelo cabeçalho na rota (como a digitalizada, RN-157); o HEIC, no worker. */
export const ENVIO_MAX_PIXELS = 40_000_000;
/** D1 do plano: imagem dentro do PDF acima disto (declarado) recusa o PDF antes de decodificar. */
export const MAX_PIXELS_IMAGEM_PDF = 20_000_000;
export const ENVIO_LADO_MAX = 2000;
export const ENVIO_QUALIDADE_JPEG = 85; // PM-9 (D2)
export const ENVIOS_PENDENTES_MAX = 10; // D14 = a
export const ENVIOS_POR_DIA_MAX = 5; // D14 = a
export const NOME_ENVIO_MAX = 120;
export const OBSERVACAO_ENVIO_MAX = 500;
export const MOTIVO_RECUSA_TEXTO_MAX = 300;
export const ENVIO_EXPIRA_DIAS = 90; // D15 = b
export const ENVIO_LEMBRETE_DIAS = 30; // US-165
export const AVISO_EXAMES_INTERVALO_MS = 6 * 3600_000; // D16 = a

export const STATUS_ENVIO = ['processando', 'recebido', 'aceito', 'recusado', 'cancelado', 'expirado', 'falhou'] as const;
export type StatusEnvio = (typeof STATUS_ENVIO)[number];
export const MOTIVOS_RECUSA = ['ilegivel', 'nao_e_exame', 'outra_pessoa', 'repetido', 'outro'] as const;
export type MotivoRecusa = (typeof MOTIVOS_RECUSA)[number];
export const MOTIVOS_FALHA_ENVIO = ['conversao', 'paginas', 'cota', 'interrompido'] as const;
export type MotivoFalhaEnvio = (typeof MOTIVOS_FALHA_ENVIO)[number];

/** RN-165 (D20 = a): o motivo que o paciente vê. */
export const ROTULO_MOTIVO_RECUSA: Record<MotivoRecusa, string> = {
  ilegivel: 'Arquivo ilegível',
  nao_e_exame: 'Não é um exame',
  outra_pessoa: 'Exame de outra pessoa',
  repetido: 'Exame repetido',
  outro: 'Outro motivo',
};

/** US-160 / US-161 (textos novos marcados: Desvio 7). */
export const MSG_ENVIO = {
  enviado: 'Exame enviado. Sua nutricionista vai revisar.',
  arquivos: 'Envie 1 PDF de até 20 MB ou até 5 fotos (JPEG, PNG ou HEIC) de até 10 MB cada, somando até 30 MB.',
  dataObrigatoria: 'Informe a data da coleta', // novo (molde de MSG_EXAME.data)
  dataFutura: 'A data não pode ser no futuro',
  dataConfira: 'Confira a data da coleta',
  nome: 'Use no máximo 120 caracteres.', // novo
  observacao: 'Use no máximo 500 caracteres.', // novo
  dicaObservacao: 'Ex.: exame pedido na consulta de setembro.',
  pendentes: 'Você já tem 10 exames aguardando sua nutricionista. Aguarde a revisão antes de enviar outros.',
  porDia: 'Você já enviou 5 exames hoje. Tente amanhã.',
  cota: 'Não foi possível enviar agora: o espaço de arquivos do consultório acabou. Avise sua nutricionista.',
  ocupado: 'Tente novamente em alguns instantes.',
  indisponivel: 'Conta temporariamente indisponível', // o mesmo do diário (paciente fora de "ativo")
  formulario: 'Formulário inválido.',
  aguarde: 'Aguarde o processamento terminar.',
  confirmarCancelar: 'Cancelar este envio? O arquivo será apagado.',
  nenhum: 'Nenhum exame enviado ainda.', // novo
} as const;

/** §6.2: o que o paciente vê de cada situação. */
export const SITUACAO = {
  processando: 'Processando…',
  recebido: 'Aguardando sua nutricionista',
  aceito: 'Recebido no seu prontuário',
  recusado: (motivo: string) => `Não aceito: ${motivo}`,
  expirado: 'Não revisado a tempo. Se ainda for útil, envie de novo.',
  falhou: 'Não conseguimos processar o arquivo. Tente enviar de novo.',
  falhouPaginas: 'O PDF tem mais de 10 páginas. Envie só as páginas com os resultados.',
  falhouCota: 'Não foi possível enviar agora: o espaço de arquivos do consultório acabou. Avise sua nutricionista.',
} as const;

/** US-162 a US-165 (lado da nutricionista; novos marcados). */
export const MSG_REVISAO = {
  jaRevisado: 'Este envio já foi revisado.',
  cancelado: 'Este envio foi cancelado pelo paciente.',
  naoEncontrado: 'Envio não encontrado.', // novo
  salvo: 'Exame salvo no prontuário.',
  escolhaMotivo: 'Escolha o motivo.', // novo
  motivoObrigatorio: 'Escreva o motivo para o paciente',
  recusado: 'Envio recusado.', // novo
  filaVazia: 'Nenhum exame aguardando revisão.', // novo
  selo: 'Enviado pelo paciente',
  noProntuario: (n: number) => `Exames enviados pelo paciente (${n})`,
  avisoEmail: 'Você tem exames novos enviados por pacientes para revisar.',
  lembrete30: 'Há exames enviados por pacientes aguardando revisão há mais de 30 dias.',
  pushNeutro: 'Há uma atualização para você no app.',
  configuracao: 'Receber exames enviados pelos pacientes pelo app',
  configuracaoSalva: 'Configuração salva.', // novo
} as const;

export function situacaoParaPaciente(e: { status: string; motivoRecusa: string | null; motivoRecusaTexto: string | null; motivoFalha: string | null }): string {
  switch (e.status) {
    case 'processando':
      return SITUACAO.processando;
    case 'recebido':
      return SITUACAO.recebido;
    case 'aceito':
      return SITUACAO.aceito;
    case 'recusado':
      return SITUACAO.recusado(
        e.motivoRecusa === 'outro' && e.motivoRecusaTexto ? e.motivoRecusaTexto : (ROTULO_MOTIVO_RECUSA[e.motivoRecusa as MotivoRecusa] ?? ROTULO_MOTIVO_RECUSA.outro),
      );
    case 'expirado':
      return SITUACAO.expirado;
    case 'falhou':
      return e.motivoFalha === 'paginas' ? SITUACAO.falhouPaginas : e.motivoFalha === 'cota' ? SITUACAO.falhouCota : SITUACAO.falhou;
    default:
      return '';
  }
}

/** §6.1: sem nome, o envio aparece como "Exame enviado em {data}" (`enviadoEm` já formatado, dd/mm/aaaa). */
export const nomeDoEnvio = (nome: string | null, enviadoEm: string): string => nome ?? `Exame enviado em ${enviadoEm}`;

/** Dias de calendário entre duas datas AAAA-MM-DD (no fuso de quem chamou). */
export const diasEntre = (de: string, ate: string): number => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/** US-162: "há {n} dias" (0 = "hoje", novo; 1 = "há 1 dia"). */
export const haDias = (n: number): string => (n <= 0 ? 'hoje' : n === 1 ? 'há 1 dia' : `há ${n} dias`);
```

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-constantes.test.ts`
Expected: PASS.

- [ ] **Step 3: Teste de `salvarArquivos` (falha: a função não existe)**

Criar `src/modules/plataforma/armazenamento-lote.test.ts`:

```ts
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { JPEG_MINIMO } from '../../../test/exames-enviados';
import { PDF_MINIMO } from '../../../test/ia';
import { storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { COTA_BYTES, CotaEsgotadaError, resolverCaminho, salvarArquivos, TipoNaoPermitidoError, type ArquivoSalvo } from './armazenamento';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-lote-'));
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const bytes = async (tenantId: string) => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, tenantId)))[0].b;
const noDisco = (tenantId: string) => {
  try {
    return readdirSync(path.join(dataDir, tenantId, 'exame_original'));
  } catch {
    return [];
  }
};
async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  return { T, p, ctx: ctxPaciente(T.tenantId, p.id) };
}
const jpegCom = (total: number) => Buffer.concat([JPEG_MINIMO, Buffer.alloc(total - JPEG_MINIMO.length, 1)]);

describe('salvarArquivos (DEP-09 reduzida: o lote do envio do paciente, tudo ou nada)', () => {
  it('grava o lote com UMA reserva (a soma), com dono, e um registrar com todos os arquivos na ordem', async () => {
    const { T, p, ctx } = await cenario();
    const antes = await bytes(T.tenantId);
    const conteudos = [JPEG_MINIMO, PDF_MINIMO, jpegCom(900)];
    let vistos: ArquivoSalvo[] = [];
    const r = await salvarArquivos(ctx, { tipo: 'exame_original', conteudos, permitidos: ['jpg', 'pdf'], patientId: p.id, registrar: async (_tx, a) => void (vistos = a) }, { db: app.db, dataDir });
    expect(r.map((a) => a.mime)).toEqual(['image/jpeg', 'application/pdf', 'image/jpeg']);
    expect(vistos.map((a) => a.caminho)).toEqual(r.map((a) => a.caminho));
    expect(await bytes(T.tenantId)).toBe(antes + conteudos.reduce((s, b) => s + b.length, 0));
    for (const a of r) expect(existsSync(resolverCaminho(dataDir, a.caminho))).toBe(true);
    const linhas = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(inArray(storedFiles.caminho, r.map((a) => a.caminho))), app.db);
    expect(linhas.every((l) => l.patientId === p.id && l.tipo === 'exame_original')).toBe(true);
  });

  it('US-160 "Espaço do consultório esgotado": cabe um, não cabe a soma → nada gravado (nem linha, nem disco, nem reserva)', async () => {
    const { T, p, ctx } = await cenario();
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES - 1000 }).where(eq(tenants.id, T.tenantId));
    await expect(
      salvarArquivos(ctx, { tipo: 'exame_original', conteudos: [jpegCom(600), jpegCom(600)], permitidos: ['jpg'], patientId: p.id }, { db: app.db, dataDir }),
    ).rejects.toBeInstanceOf(CotaEsgotadaError);
    expect(await bytes(T.tenantId)).toBe(COTA_BYTES - 1000);
    expect(noDisco(T.tenantId)).toEqual([]);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.patientId, p.id)), app.db)).toEqual([]);
  });

  it('um conteúdo fora dos permitidos, vazio ou lote vazio: TipoNaoPermitidoError antes de gravar qualquer um', async () => {
    const { T, p, ctx } = await cenario();
    for (const conteudos of [[JPEG_MINIMO, Buffer.from('PK\u0003\u0004zip')], [JPEG_MINIMO, Buffer.alloc(0)], []]) {
      await expect(salvarArquivos(ctx, { tipo: 'exame_original', conteudos, permitidos: ['jpg', 'pdf'], patientId: p.id }, { db: app.db, dataDir })).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    }
    expect(noDisco(T.tenantId)).toEqual([]);
  });

  it('o registrar que lança desfaz tudo: sem linha, sem arquivo no disco, sem reserva', async () => {
    const { T, p, ctx } = await cenario();
    const antes = await bytes(T.tenantId);
    await expect(
      salvarArquivos(ctx, { tipo: 'exame_original', conteudos: [JPEG_MINIMO, JPEG_MINIMO], permitidos: ['jpg'], patientId: p.id, registrar: async () => { throw new Error('falha no registro'); } }, { db: app.db, dataDir }),
    ).rejects.toThrow('falha no registro');
    expect(await bytes(T.tenantId)).toBe(antes);
    expect(noDisco(T.tenantId).filter((f) => !f.endsWith('.tmp'))).toEqual([]);
    expect(noDisco(T.tenantId).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('dono obrigatório nos tipos do paciente; a sessão de paciente não grava o lote de outro paciente', async () => {
    const { T, p, ctx } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx);
    await expect(salvarArquivos(ctx, { tipo: 'exame_original', conteudos: [JPEG_MINIMO], permitidos: ['jpg'] }, { db: app.db, dataDir })).rejects.toThrow(/patientId obrigatório/);
    await expect(salvarArquivos(ctx, { tipo: 'exame_original', conteudos: [JPEG_MINIMO], permitidos: ['jpg'], patientId: outro.id }, { db: app.db, dataDir })).rejects.toThrow();
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.patientId, p.id)), app.db)).toEqual([]);
  });
});
```

Run: `pnpm vitest run src/modules/plataforma/armazenamento-lote.test.ts`
Expected: FAIL (`salvarArquivos` não é exportada).

- [ ] **Step 4: Implementar `salvarArquivos`**

Em `src/modules/plataforma/armazenamento.ts`, depois de `salvarArquivo`:

```ts
/**
 * Plano 12 (DEP-09 reduzida, PM-8): vários arquivos com UMA reserva de cota (a soma) e um `registrar` só — tudo ou nada.
 * Só o envio de exame pelo paciente usa: a sessão de paciente não tem DELETE em stored_files e não conseguiria desfazer um
 * envio gravado pela metade. Tudo é conferido antes de gravar (tipo pelo conteúdo de cada um); o conteúdo vai ao disco antes
 * da transação (como salvarArquivo); a mesma ordem de travas: dono (`antesDaReserva`) → tenant (cota) → `registrar`.
 */
export async function salvarArquivos(
  ctx: TenantContext,
  input: {
    tipo: TipoDeArquivo;
    conteudos: readonly Buffer[];
    permitidos: readonly TipoArquivo['ext'][];
    patientId?: string;
    antesDaReserva?: (tx: Tx) => Promise<void>;
    registrar?: (tx: Tx, arquivos: ArquivoSalvo[]) => Promise<void>;
  },
  deps: Deps = {},
): Promise<ArquivoSalvo[]> {
  const db = deps.db ?? getDb();
  const dataDir = deps.dataDir ?? getEnv().DATA_DIR;
  if (TIPOS_DO_PACIENTE.includes(input.tipo) !== Boolean(input.patientId)) {
    throw new Error(`salvarArquivos: patientId ${input.patientId ? 'proibido' : 'obrigatório'} para o tipo ${input.tipo}`);
  }
  if (!input.conteudos.length) throw new TipoNaoPermitidoError();
  const itens = input.conteudos.map((conteudo) => {
    const real = conteudo.length ? detectarTipo(conteudo) : null;
    if (!real || real.ext === 'svg' || !input.permitidos.includes(real.ext)) throw new TipoNaoPermitidoError();
    const id = randomUUID();
    const caminho = `${ctx.tenantId}/${input.tipo}/${id}.${real.ext}`;
    const destino = resolverCaminho(dataDir, caminho);
    return { id, caminho, destino, tmp: `${destino}.${process.pid}.tmp`, conteudo, bytes: conteudo.length, mime: real.mime };
  });
  const total = itens.reduce((s, i) => s + i.bytes, 0);
  const gravados: string[] = [];
  try {
    for (const i of itens) {
      await mkdir(path.dirname(i.destino), { recursive: true, mode: 0o750 });
      await writeFile(i.tmp, i.conteudo, { mode: 0o640, flag: 'wx' });
    }
    return await withTenant(
      ctx,
      async (tx) => {
        if (input.antesDaReserva) await input.antesDaReserva(tx);
        const reserva = await tx
          .update(tenants)
          .set({ armazenamentoBytes: sql`${tenants.armazenamentoBytes} + ${total}` })
          .where(and(eq(tenants.id, ctx.tenantId), sql`${tenants.armazenamentoBytes} + ${total} <= ${COTA_BYTES}`))
          .returning({ id: tenants.id });
        if (!reserva.length) throw new CotaEsgotadaError();
        await tx.insert(storedFiles).values(
          itens.map((i) => ({ id: i.id, tenantId: ctx.tenantId, tipo: input.tipo, caminho: i.caminho, bytes: i.bytes, mime: i.mime, criadoPor: ctx.actorUserId ?? null, patientId: input.patientId ?? null })),
        );
        const arquivos = itens.map((i) => ({ id: i.id, caminho: i.caminho, bytes: i.bytes, mime: i.mime }));
        if (input.registrar) await input.registrar(tx, arquivos);
        for (const i of itens) {
          await rename(i.tmp, i.destino);
          gravados.push(i.destino);
        }
        return arquivos;
      },
      db,
    );
  } catch (err) {
    for (const i of itens) await rm(i.tmp, { force: true }).catch(() => undefined);
    for (const d of gravados) await rm(d, { force: true }).catch(() => undefined); // o commit falhou depois da gravação
    throw err;
  }
}
```

Run: `pnpm vitest run src/modules/plataforma/armazenamento-lote.test.ts src/modules/plataforma/armazenamento.test.ts`
Expected: PASS.

- [ ] **Step 5: Teste de `apagarArquivosDoEnvio` (falha: o módulo não existe)**

Criar `src/modules/pacientes/exames-enviados-arquivos.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco, envioRecebido } from '../../../test/exames-enviados';
import { examSubmissionFiles, examSubmissions, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';
import { apagarArquivosDoEnvio } from './exames-enviados-arquivos';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-arq-'));
afterAll(async () => {
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const deps = { db: app.db, dataDir };
const bytes = async (tenantId: string) => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, tenantId)))[0].b;
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });
async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  return { T, p, antes: await bytes(T.tenantId) };
}
const linhas = (ctx: TenantContext, id: string) =>
  withTenant(ctx, (tx) => tx.select({ papel: examSubmissionFiles.papel }).from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, id)), app.db);
const envio = async (ctx: TenantContext, id: string) => (await withTenant(ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db))[0];

describe('apagarArquivosDoEnvio (regra 9: um apagarArquivo por arquivo, ponteiro na mesma transação)', () => {
  it('envio "recebido": nada sai (a nutricionista ainda vai conferir as páginas e o PDF limpo)', async () => {
    const { T, p } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    expect(await apagarArquivosDoEnvio(worker(T.tenantId), e.id, deps)).toBe(0);
    expect(await linhas(T.ctx, e.id)).toHaveLength(2);
    expect(existsSync(resolverCaminho(dataDir, e.pdf))).toBe(true);
  });

  it('cancelado pelo paciente: o PDF limpo (ponteiro solto) e as páginas saem do disco e da cota; idempotente', async () => {
    const { T, p, antes } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.update(examSubmissions).set({ status: 'cancelado' }).where(eq(examSubmissions.id, e.id)), app.db);
    expect(await apagarArquivosDoEnvio(worker(T.tenantId), e.id, deps)).toBe(3);
    expect(await linhas(T.ctx, e.id)).toEqual([]);
    expect(await envio(T.ctx, e.id)).toMatchObject({ status: 'cancelado', arquivoPath: null });
    for (const c of [e.pdf, ...e.paginas]) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect(await bytes(T.tenantId)).toBe(antes);
    expect(await apagarArquivosDoEnvio(worker(T.tenantId), e.id, deps)).toBe(0);
  });

  it('originais só saem depois do processamento; "refazer" tira as páginas de uma tentativa anterior ainda "processando"', async () => {
    const { T, p } = await cenario();
    const w = worker(T.tenantId);
    const id = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
    const pagina = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_pagina', dataDir);
    await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values([
      { tenantId: T.tenantId, patientId: p.id, submissionId: id, arquivoPath: original, papel: 'original', ordem: 1 },
      { tenantId: T.tenantId, patientId: p.id, submissionId: id, arquivoPath: pagina, papel: 'pagina', ordem: 1 },
    ]), app.db);
    expect(await apagarArquivosDoEnvio(w, id, { ...deps, papel: 'original' })).toBe(0);
    expect(await apagarArquivosDoEnvio(w, id, { ...deps, papel: 'pagina' })).toBe(0); // sem "refazer", página de envio vivo fica
    expect(await apagarArquivosDoEnvio(w, id, { ...deps, papel: 'pagina', refazer: true })).toBe(1);
    expect((await linhas(T.ctx, id)).map((l) => l.papel)).toEqual(['original']);
    const pdf = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame', dataDir);
    await withTenant(w, (tx) => tx.update(examSubmissions).set({ status: 'recebido', arquivoPath: pdf }).where(eq(examSubmissions.id, id)), app.db);
    expect(await apagarArquivosDoEnvio(w, id, { ...deps, papel: 'original' })).toBe(1);
    expect(await linhas(T.ctx, id)).toEqual([]);
    expect(existsSync(resolverCaminho(dataDir, pdf))).toBe(true); // o PDF limpo do "recebido" fica
  });

  it('aceito: as páginas que sobraram saem; o PDF limpo (agora do exame) não é tocado', async () => {
    const { T, p } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir, { paginas: 3 });
    await withTenant(T.ctx, (tx) => tx.update(examSubmissions).set({ status: 'aceito', arquivoPath: null, revisadoPor: T.nutriId, revisadoEm: new Date() }).where(eq(examSubmissions.id, e.id)), app.db);
    expect(await apagarArquivosDoEnvio(T.ctx, e.id, deps)).toBe(3);
    expect(existsSync(resolverCaminho(dataDir, e.pdf))).toBe(true);
  });
});
```

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-arquivos.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 6: Implementar `apagarArquivosDoEnvio`**

Criar `src/modules/pacientes/exames-enviados-arquivos.ts`:

```ts
import { and, eq, notInArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { examSubmissionFiles, examSubmissions } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';

type Papel = 'original' | 'pagina';

/**
 * Quando cada arquivo do envio deixa de ser preciso (D23, RN-163 a RN-167): o original, depois do processamento; a página,
 * depois da revisão (ou do cancelamento, da expiração, da falha). `refazer`: uma nova tentativa do job refaz as páginas de
 * uma tentativa anterior que caiu no meio (o envio ainda está "processando").
 */
const PODE_SAIR: Record<Papel, (status: string, refazer: boolean) => boolean> = {
  original: (s) => s !== 'processando',
  pagina: (s, refazer) => (refazer ? s === 'processando' : s !== 'processando' && s !== 'recebido'),
};

/**
 * Regra 9 / DEP-09 reduzida (spec §4.1): cada arquivo do envio sai no SEU apagarArquivo; a linha de exam_submission_files sai
 * junto (FK ON DELETE CASCADE, mesma transação) e o PDF limpo solta o ponteiro `arquivo_path` no naMesmaTransacao — só se o
 * envio, travado ali, ainda permite (situação relida). Ordem de travas: envio → tenant (a de salvarArquivo é paciente → envio →
 * tenant). Um arquivo que falha não para os outros: a varredura (exames-enviados-varredura.ts) tenta de novo. `papel`: só os
 * originais (fim do processamento) ou só as páginas. Devolve quantos arquivos saíram. Log só com ids (RNF-11).
 */
export async function apagarArquivosDoEnvio(
  ctx: TenantContext,
  envioId: string,
  deps: { db?: Db; dataDir?: string; papel?: Papel; refazer?: boolean } = {},
): Promise<number> {
  const db = deps.db ?? getDb();
  const refazer = !!deps.refazer;
  const lido = await withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx.select({ status: examSubmissions.status, pdf: examSubmissions.arquivoPath }).from(examSubmissions).where(eq(examSubmissions.id, envioId));
      if (!e) return null;
      const arquivos = await tx
        .select({ caminho: examSubmissionFiles.arquivoPath, papel: examSubmissionFiles.papel })
        .from(examSubmissionFiles)
        .where(and(eq(examSubmissionFiles.submissionId, envioId), deps.papel ? eq(examSubmissionFiles.papel, deps.papel) : undefined));
      return { ...e, arquivos };
    },
    db,
  );
  if (!lido) return 0;
  const situacaoTravada = async (tx: Tx) => (await tx.select({ status: examSubmissions.status }).from(examSubmissions).where(eq(examSubmissions.id, envioId)).for('update'))[0]?.status;
  let n = 0;
  let falhas = 0;
  for (const a of lido.arquivos) {
    const papel = a.papel as Papel;
    if (!PODE_SAIR[papel](lido.status, refazer)) continue;
    const ok = await apagarArquivo(ctx, { caminho: a.caminho }, {
      db,
      dataDir: deps.dataDir,
      naMesmaTransacao: async (tx) => {
        const s = await situacaoTravada(tx);
        return s !== undefined && PODE_SAIR[papel](s, refazer);
      },
    }).catch(() => {
      falhas++;
      return false;
    });
    if (ok) n++;
  }
  if (!deps.papel && lido.pdf && lido.status !== 'recebido' && lido.status !== 'processando') {
    const pdf = lido.pdf;
    const ok = await apagarArquivo(ctx, { caminho: pdf }, {
      db,
      dataDir: deps.dataDir,
      naMesmaTransacao: async (tx) =>
        (
          await tx
            .update(examSubmissions)
            .set({ arquivoPath: null, updatedAt: new Date() })
            .where(and(eq(examSubmissions.id, envioId), eq(examSubmissions.arquivoPath, pdf), notInArray(examSubmissions.status, ['processando', 'recebido'])))
            .returning({ id: examSubmissions.id })
        ).length > 0,
    }).catch(() => {
      falhas++;
      return false;
    });
    if (ok) n++;
  }
  if (falhas) logger.warn({ tenantId: ctx.tenantId, envioId, falhas, motivo: 'arquivo_do_envio' }, 'arquivo do envio não apagado (a varredura tenta de novo)');
  return n;
}
```

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-arquivos.test.ts`
Expected: PASS.

- [ ] **Step 7: JPEG do laudo — teste da qualidade e da foto (falham)**

Criar `src/lib/jpeg.test.ts`:

```ts
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { paraJpegSemMetadados } from './jpeg';

// pixels fixos (sem ruído aleatório): o mesmo pipeline com a mesma qualidade dá os mesmos bytes
const raw = Buffer.alloc(800 * 600 * 3);
for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
const img = () => sharp(raw, { raw: { width: 800, height: 600, channels: 3 } });

describe('paraJpegSemMetadados (PM-9)', () => {
  it('qualidade padrão 80 (diário e capa sem mudança) e 85 quando pedida (laudo enviado pelo paciente)', async () => {
    const padrao = await paraJpegSemMetadados(img(), 2000);
    expect(padrao.equals(await paraJpegSemMetadados(img(), 2000, 80))).toBe(true);
    expect((await paraJpegSemMetadados(img(), 2000, 85)).length).toBeGreaterThan(padrao.length);
  });
});
```

Em `src/modules/portal/diario-foto-job.test.ts`, trocar o import de `./diario-foto-job` para `import { converterFotoDoDiario, expirarFotosPendentes, fotoParaJpeg, FotoInvalidaError, MAX_PIXELS } from './diario-foto-job';` e acrescentar, dentro do `describe('conversão da foto do diário (RN-07)'…)`:

```ts
  it('fotoParaJpeg (Plano 12): parâmetros do laudo — maior lado 2000 px, qualidade 85, em pé e sem EXIF; lixo → FotoInvalidaError', async () => {
    const foto = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#88aa44' } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'marca-exif-gps' } } })
      .toBuffer();
    const jpeg = await fotoParaJpeg(foto, 'jpg', { ladoMax: 2000, qualidade: 85 });
    const m = await sharp(jpeg).metadata();
    expect([m.width, m.height]).toEqual([1500, 2000]); // a orientação 6 foi aplicada antes de tirar o EXIF
    expect(m.exif).toBeUndefined();
    expect(jpeg.includes('marca-exif-gps')).toBe(false);
    await expect(fotoParaJpeg(Buffer.from('não é foto'), 'jpg', { ladoMax: 2000 })).rejects.toBeInstanceOf(FotoInvalidaError);
  });
```

Run: `pnpm vitest run src/lib/jpeg.test.ts src/modules/portal/diario-foto-job.test.ts`
Expected: FAIL (`qualidade` ignorado: os tamanhos são iguais; `fotoParaJpeg` não exportada).

- [ ] **Step 8: Implementar a qualidade e exportar o pipeline da foto**

Em `src/lib/jpeg.ts`:

```ts
/**
 * Pixels → JPEG que cabe em `ladoMax` × `ladoMax`, sem metadados (o sharp só copia EXIF/GPS com withMetadata).
 * Transparência (PNG/WebP) sobre fundo BRANCO: sem o flatten, o JPEG pinta o transparente de preto. Um pipeline só para a
 * foto do diário (Plano 06, 1600 px, 80), a capa do conteúdo (Plano 07, 1280 px, 80) e o laudo enviado pelo paciente
 * (Plano 12, 2000 px, 85 — PM-9).
 */
export function paraJpegSemMetadados(img: Sharp, ladoMax: number, qualidade = 80): Promise<Buffer> {
  return img
    .resize({ width: ladoMax, height: ladoMax, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: qualidade, mozjpeg: true })
    .toBuffer();
}
```

Em `src/modules/portal/diario-foto-job.ts`:
1. `type AbrirHeic = …` vira `export type AbrirHeic = …`; `class FotoInvalidaError extends Error {}` vira `export class FotoInvalidaError extends Error {}`.
2. Trocar a função `paraJpeg` por:

```ts
/**
 * Foto (JPEG, PNG ou HEIC) → JPEG ≤ `ladoMax` no maior lado, sem metadados e com a orientação aplicada; 40 MP conferidos pelo
 * cabeçalho ANTES de decodificar. O diário usa 1600 px e 80; o exame enviado pelo paciente (Plano 12), 2000 px e 85.
 */
export async function fotoParaJpeg(original: Buffer, ext: string, o: { ladoMax: number; qualidade?: number; abrirHeic?: AbrirHeic }): Promise<Buffer> {
  let img: Sharp;
  if (ext === 'heic') {
    img = await pixelsDoHeic(original, o.abrirHeic ?? heicDeVerdade);
  } else {
    const meta = await sharp(original).metadata().catch(() => {
      throw new FotoInvalidaError('metadata');
    }); // só o cabeçalho: o sharp não decodifica pixels no metadata()
    if (grandeDemais(meta.width, meta.height)) throw new FotoInvalidaError('pixels');
    img = sharp(original, { limitInputPixels: MAX_PIXELS }).rotate(); // aplica a orientação do EXIF antes de descartá-lo
  }
  return paraJpegSemMetadados(img, o.ladoMax, o.qualidade).catch(() => {
    throw new FotoInvalidaError('conversao');
  });
}
```

3. Em `converterFotoDoDiario`, trocar `const jpeg = await paraJpeg(buf, original.slice(original.lastIndexOf('.') + 1), deps.abrirHeic ?? heicDeVerdade);` por `const jpeg = await fotoParaJpeg(buf, original.slice(original.lastIndexOf('.') + 1), { ladoMax: LADO_MAX, abrirHeic: deps.abrirHeic });`.

Run: `pnpm vitest run src/lib/jpeg.test.ts src/modules/portal/diario-foto-job.test.ts src/modules/conteudo/capa.test.ts`
Expected: PASS (o diário e a capa sem mudança de comportamento).

- [ ] **Step 9: CLAUDE.md (regra 9)**

No fim da regra 9, acrescentar: "Plano 12: `salvarArquivos` (vários conteúdos com uma reserva pela soma e um `registrar` só — tudo ou nada) é **só** do envio de exame pelo paciente (`enviarExame`, `src/modules/portal/exames-enviados.ts`); os tipos `exame_original` (o que o paciente enviou; vive enquanto o envio está `processando`) e `exame_pagina` (imagens de página para a revisão; saem na revisão, no cancelamento, na expiração ou na falha) têm dono; o PDF limpo é `exame` e, no aceite, o exame passa a apontar para ele e o envio solta o ponteiro (um dono só); cada arquivo do envio sai no seu `apagarArquivo` por `apagarArquivosDoEnvio` (`src/modules/pacientes/exames-enviados-arquivos.ts`; as linhas de `exam_submission_files` saem pela FK em cascata na mesma transação)."

- [ ] **Step 10: Rodar e commitar**

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-constantes.test.ts src/modules/plataforma/armazenamento-lote.test.ts src/modules/plataforma/armazenamento.test.ts src/modules/pacientes/exames-enviados-arquivos.test.ts src/lib/jpeg.test.ts src/modules/portal/diario-foto-job.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, sem erros.

```bash
git add src/modules/pacientes/exames-enviados-constantes.ts src/modules/pacientes/exames-enviados-constantes.test.ts \
  src/modules/pacientes/exames-enviados-arquivos.ts src/modules/pacientes/exames-enviados-arquivos.test.ts \
  src/modules/plataforma/armazenamento.ts src/modules/plataforma/armazenamento-lote.test.ts src/lib/jpeg.ts src/lib/jpeg.test.ts \
  src/modules/portal/diario-foto-job.ts src/modules/portal/diario-foto-job.test.ts CLAUDE.md
git commit -m "feat(exames-enviados): textos, salvarArquivos (lote do paciente), limpeza dos arquivos do envio e JPEG do laudo (P12-02)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 3: Rasterização do PDF do paciente — PDFium em WebAssembly num processo filho com teto de memória (P12-03)

**Revisão: completa (agente revisor-rls)** — o worker abre arquivo não confiável vindo do paciente (R-170, R-175, RNF-162, RNF-169); dependência nova; poda da imagem.

**Files:**
- Create: `src/modules/pacientes/rasterizar-pdf-processo.ts`, `src/modules/pacientes/rasterizar-pdf.ts` (+ `rasterizar-pdf.test.ts`), `src/modules/pacientes/exames-enviados-guardas.test.ts`
- Modify: `package.json` + `pnpm-lock.yaml` (`@hyzyla/pdfium` 2.1.13), `Dockerfile` (poda), `.github/workflows/ci.yml` (job `image`: a rasterização roda na imagem podada), `test/exames-enviados.ts` (PDFs de teste), `CLAUDE.md` (regra 9)

**Interfaces:**
- Consumes: `logger`; `jpegQueDeclara` (T1); `pdfDeTeste` (`test/ia.ts`).
- Produces: `rasterizarPdf`, `RasterizacaoError`, `PaginaRaster`, `HEAP_MAX_RASTER_MB`, `TEMPO_MAX_RASTER_MS`, `TETO_RSS_RASTER_BYTES`; `MensagemDoProcesso` (tipo, só para `rasterizar-pdf.ts`); em `test/exames-enviados.ts`: `pdfComConteudoAtivo()`, `pdfComImagemDeclarada(largura, altura)`, `pdfDeFotos(paginas)`.

- [ ] **Step 1: Instalar a dependência fixada e conferir a licença**

Run: `pnpm add @hyzyla/pdfium@2.1.13 --save-exact`
Expected: `"@hyzyla/pdfium": "2.1.13"` em `dependencies` (sem `^`) e o lockfile atualizado; `node_modules/@hyzyla/pdfium/dist/pdfium.wasm` existe (≈ 4 MB).

Run: `node -e "const p=require('./node_modules/@hyzyla/pdfium/package.json'); console.log(p.license, p.version)" && node -e "console.log(require('sharp').format.pdf.input.buffer)"`
Expected: `MIT 2.1.13` e `false` (o sharp pré-compilado não abre PDF — por isso a dependência nova, D1).

- [ ] **Step 2: PDFs de teste**

Em `test/exames-enviados.ts`, acrescentar os imports `import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';` e:

```ts
/** R-170: PDF com JavaScript na abertura, link (URI) e arquivo anexado — nada disso pode chegar ao PDF limpo. */
export async function pdfComConteudoAtivo(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595, 842]);
  p.drawText('Glicose de jejum 92 mg/dL', { x: 50, y: 780, size: 14, font: fonte });
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.register(doc.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('app.alert("x")') })));
  const link = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [50, 700, 300, 720], A: { S: 'URI', URI: PDFString.of('https://exemplo.invalid/') } }));
  p.node.set(PDFName.of('Annots'), doc.context.obj([link]));
  await doc.attach(Buffer.from('conteudo escondido'), 'anexo.txt', { mimeType: 'text/plain' });
  return Buffer.from(await doc.save());
}

/** Uma página com uma imagem cujo cabeçalho declara `largura` × `altura` (o pdf-lib não decodifica a imagem). */
export async function pdfComImagemDeclarada(largura: number, altura: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(await jpegQueDeclara(largura, altura));
  doc.addPage([595, 842]).drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  return Buffer.from(await doc.save());
}

/** Laudo "digitalizado": `paginas` páginas, cada uma com a sua foto JPEG de 1600 × 1200 que quase não comprime. */
export async function pdfDeFotos(paginas: number): Promise<Buffer> {
  const raw = Buffer.alloc(1600 * 1200 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  const foto = await sharp(raw, { raw: { width: 1600, height: 1200, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) {
    const img = await doc.embedJpg(foto); // um objeto de imagem por página, como um app de "scanner" grava
    doc.addPage([595, 842]).drawImage(img, { x: 20, y: 20, width: 555, height: 416 });
  }
  return Buffer.from(await doc.save());
}
```

- [ ] **Step 3: Escrever o teste da rasterização (falha: o módulo não existe)**

Criar `src/modules/pacientes/rasterizar-pdf.test.ts`:

```ts
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDeflate } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { pdfComConteudoAtivo, pdfComImagemDeclarada, pdfDeFotos } from '../../../test/exames-enviados';
import { pdfDeTeste } from '../../../test/ia';
import { RasterizacaoError, rasterizarPdf, TETO_RSS_RASTER_BYTES, type PaginaRaster } from './rasterizar-pdf';

const execFileP = promisify(execFile);
const MB = 1024 * 1024;
const OPCOES = { limitePaginas: 10, ladoMax: 2000, maxPixelsImagem: 20_000_000 };

async function rasterizar(pdf: Buffer, o: { tempoMaxMs?: number; tetoRssBytes?: number } = {}) {
  const paginas: PaginaRaster[] = [];
  const r = await rasterizarPdf(pdf, { ...OPCOES, ...o }, async (p) => void paginas.push(p));
  return { ...r, paginas };
}
const motivo = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof RasterizacaoError ? e.motivo : `outro: ${e instanceof Error ? e.message : String(e)}`;
  }
  return 'sem erro';
};
/** Algum pixel escuro (o texto desenhado), não só a página em branco. */
const temTinta = (p: PaginaRaster) => p.rgba.some((v, i) => i % 4 !== 3 && v < 100);

/** "Bomba": o conteúdo da página descomprime para `mb` MB (espaços), gerado aos pedaços — o teste não aloca tudo. */
async function pdfBomba(mb: number): Promise<Buffer> {
  const comprimido = await new Promise<Buffer>((ok, falha) => {
    const partes: Buffer[] = [];
    const z = createDeflate({ level: 9 });
    z.on('data', (c: Buffer) => partes.push(c));
    z.on('end', () => ok(Buffer.concat(partes)));
    z.on('error', falha);
    const bloco = Buffer.alloc(MB, 0x20);
    let i = 0;
    const escrever = () => {
      while (i < mb) {
        i++;
        if (!z.write(bloco)) return void z.once('drain', escrever);
      }
      z.end();
    };
    escrever();
  });
  const doc = await PDFDocument.create();
  const pagina = doc.addPage([595, 842]);
  pagina.node.set(PDFName.of('Contents'), doc.context.register(PDFRawStream.of(doc.context.obj({ Filter: 'FlateDecode', Length: comprimido.length }), comprimido)));
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/**
 * Mede num Node novo (com tsx) o pico de memória do lado do worker (VmHWM, zerado logo antes) e devolve também o pico do
 * processo filho (que ele mesmo informa no "fim"), como o teste do RNF-101 do Plano 11.
 */
const MEDIR = `
import { readFileSync, writeFileSync } from 'node:fs';
const { rasterizarPdf } = await import('./src/modules/pacientes/rasterizar-pdf.ts');
const pdf = readFileSync(process.argv[1]);
const pico = () => Number(/VmHWM:\\s+(\\d+) kB/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) * 1024;
globalThis.gc();
writeFileSync('/proc/self/clear_refs', '5');
const antes = process.memoryUsage().rss;
const r = await rasterizarPdf(pdf, { limitePaginas: 10, ladoMax: 2000, maxPixelsImagem: 20_000_000 }, async () => {}).catch((e) => ({ motivo: e.motivo ?? 'erro inesperado' }));
console.log(JSON.stringify({ pai: pico() - antes, ...r }));
`;
const RAIZ = fileURLToPath(new URL('../../..', import.meta.url));
async function medir(pdf: Buffer): Promise<{ pai: number; paginas?: number; picoBytes?: number | null; motivo?: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'raster-'));
  try {
    const arquivo = path.join(dir, 'laudo.pdf');
    await writeFile(arquivo, pdf);
    const { stdout } = await execFileP(process.execPath, ['--expose-gc', '--import', 'tsx', '--input-type=module', '-e', MEDIR, arquivo], { cwd: RAIZ, timeout: 180_000 });
    return JSON.parse(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('rasterização do PDF enviado pelo paciente (D23 = a, R-170, RNF-162)', () => {
  it('3 páginas A4: uma por vez, na ordem, maior lado 2000 px, RGBA com o texto desenhado', async () => {
    const r = await rasterizar(await pdfDeTeste({ paginas: 3 }));
    expect(r.paginas.map((p) => p.indice)).toEqual([0, 1, 2]);
    for (const p of r.paginas) {
      expect([p.largura, p.altura]).toEqual([1413, 2000]); // 595 × 842 pt
      expect(p.rgba.length).toBe(p.largura * p.altura * 4);
      expect(temTinta(p)).toBe(true);
    }
    expect(r.paginas).toHaveLength(3);
    expect(r.picoBytes ?? 0).toBeLessThan(TETO_RSS_RASTER_BYTES);
  }, 60_000);

  it('página deitada (842 × 595): a largura é que vira 2000 px', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([842, 595]);
    const r = await rasterizar(Buffer.from(await doc.save()));
    expect([r.paginas[0].largura, r.paginas[0].altura]).toEqual([2000, 1413]);
  }, 60_000);

  it('US-160 "PDF longo": 11 páginas → "paginas" antes de desenhar qualquer uma', async () => {
    let chamadas = 0;
    await expect(rasterizarPdf(await pdfDeTeste({ paginas: 11 }), OPCOES, async () => void chamadas++)).rejects.toMatchObject({ motivo: 'paginas' });
    expect(chamadas).toBe(0);
  }, 60_000);

  it('não é PDF, PDF truncado e PDF sem páginas → "conversao"', async () => {
    const bom = await pdfDeTeste({ paginas: 2 });
    const semPaginas = Buffer.from(await (await PDFDocument.create()).save());
    for (const pdf of [Buffer.from('%PDF-1.7\nlixo'), bom.subarray(0, Math.floor(bom.length / 3)), semPaginas]) {
      expect(await motivo(rasterizar(pdf))).toBe('conversao');
    }
  }, 60_000);

  it('R-170: PDF com JavaScript, link e anexo é desenhado normalmente e só pixels saem do processo filho', async () => {
    const r = await rasterizar(await pdfComConteudoAtivo());
    expect(r.paginas).toHaveLength(1);
    expect(Object.keys(r.paginas[0]).sort()).toEqual(['altura', 'indice', 'largura', 'rgba']);
    expect(temTinta(r.paginas[0])).toBe(true);
  }, 60_000);

  it('imagem que declara 6000 × 6000 px (36 MP) → "conversao" sem decodificar', async () => {
    expect(await motivo(rasterizar(await pdfComImagemDeclarada(6000, 6000)))).toBe('conversao');
  }, 60_000);

  it('bomba de descompressão (256 MB): o filho morre no teto de memória (ou o PDFium recusa); o worker segue', async () => {
    const r = await rasterizar(await pdfBomba(256)).then(
      (x) => ({ ok: true as const, pico: x.picoBytes }),
      (e: unknown) => ({ ok: false as const, motivo: e instanceof RasterizacaoError ? e.motivo : 'outro' }),
    );
    if (r.ok) expect(r.pico ?? 0).toBeLessThanOrEqual(TETO_RSS_RASTER_BYTES);
    else expect(r.motivo).toBe('conversao');
  }, 120_000);

  it('teto de memória menor que o próprio Node: o filho é morto e vira "conversao"; prazo vencido também', async () => {
    const pdf = await pdfDeTeste({ paginas: 1 });
    expect(await motivo(rasterizar(pdf, { tetoRssBytes: 8 * MB }))).toBe('conversao');
    expect(await motivo(rasterizar(pdf, { tempoMaxMs: 1 }))).toBe('conversao');
  }, 60_000);

  it('o erro de quem recebe a página volta como está e o filho é encerrado', async () => {
    const erro = new Error('falhou ao converter');
    await expect(rasterizarPdf(await pdfDeTeste({ paginas: 2 }), OPCOES, async () => { throw erro; })).rejects.toBe(erro);
  }, 60_000);

  it('RNF-162: laudo digitalizado de 10 páginas — pico do worker + pico do filho abaixo de 150 MB', async () => {
    const pdf = await pdfDeFotos(10);
    const r = await medir(pdf);
    console.info(`RNF-162: PDF de ${Math.round(pdf.length / MB)} MB → worker +${Math.round(r.pai / MB)} MB, filho ${Math.round((r.picoBytes ?? 0) / MB)} MB`);
    expect(r.paginas).toBe(10);
    expect(r.pai + (r.picoBytes ?? 0)).toBeLessThan(150 * MB);
  }, 240_000);
});
```

Run: `pnpm vitest run src/modules/pacientes/rasterizar-pdf.test.ts`
Expected: FAIL (`./rasterizar-pdf` não existe).

- [ ] **Step 4: O processo filho**

Criar `src/modules/pacientes/rasterizar-pdf-processo.ts`:

```ts
import { readFileSync } from 'node:fs';
import { PDFiumModule } from '@hyzyla/pdfium';

/**
 * Plano 12 (D23 = a, DEP-10, R-170; D1 do plano): processo filho que desenha cada página do PDF enviado pelo PACIENTE
 * (conteúdo não confiável) com o PDFium em WebAssembly. A compilação do @hyzyla/pdfium não tem o V8: nenhum JavaScript do PDF
 * roda; o processo nasce sem variáveis de ambiente (rasterizar-pdf.ts). Só os pixels de cada página saem, uma por vez: o filho
 * espera o "proxima" do pai antes de desenhar a seguinte (RNF-162). Antes de desenhar uma página, confere o tamanho DECLARADO
 * de cada imagem dela (também dentro de Form XObjects e as inline) sem decodificar: acima de `maxPixelsImagem`, recusa — a
 * decodificação, na memória do WASM, ficaria fora do heap. O pai mede a memória residente deste processo e o mata acima do
 * teto. Carregado direto pelo Node (sem tsx: tipos apagados, sem import local e sem alias). Nunca sai sozinho: o pai encerra
 * depois do "fim" ou da "recusa". Só o worker chega aqui (guarda em exames-enviados-guardas.test.ts).
 */
type Entrada = { tipo: 'entrada'; pdf: Uint8Array; limitePaginas: number; ladoMax: number; maxPixelsImagem: number };
export type MensagemDoProcesso =
  | { tipo: 'recusa'; motivo: 'paginas' | 'conversao'; erro?: string }
  | { tipo: 'pagina'; indice: number; total: number; largura: number; altura: number; rgba: Uint8Array }
  | { tipo: 'fim'; picoBytes: number | null };

/** As funções da API C do PDFium usadas aqui (exportadas pelo módulo do @hyzyla/pdfium 2.1.13, versão fixada). */
type Pdfium = {
  _FPDF_InitLibraryWithConfig(config: object): void;
  _FPDF_LoadMemDocument(ptr: number, tamanho: number, senha: number): number;
  _FPDF_GetPageCount(doc: number): number;
  _FPDF_LoadPage(doc: number, indice: number): number;
  _FPDF_GetPageWidth(pagina: number): number;
  _FPDF_GetPageHeight(pagina: number): number;
  _FPDFPage_CountObjects(pagina: number): number;
  _FPDFPage_GetObject(pagina: number, i: number): number;
  _FPDFPageObj_GetType(obj: number): number;
  _FPDFFormObj_CountObjects(obj: number): number;
  _FPDFFormObj_GetObject(obj: number, i: number): number;
  _FPDFImageObj_GetImagePixelSize(obj: number, largura: number, altura: number): number;
  _FPDFBitmap_CreateEx(largura: number, altura: number, formato: number, ptr: number, passo: number): number;
  _FPDFBitmap_FillRect(bitmap: number, x: number, y: number, largura: number, altura: number, cor: number): void;
  _FPDF_RenderPageBitmap(bitmap: number, pagina: number, x: number, y: number, largura: number, altura: number, rotacao: number, flags: number): void;
  _FPDFBitmap_Destroy(bitmap: number): void;
  _FPDF_ClosePage(pagina: number): void;
  _FPDF_CloseDocument(doc: number): void;
  wasmExports: { malloc(n: number): number; free(ptr: number): void };
  HEAPU8: Uint8Array;
};

const TIPO_IMAGEM = 3; // FPDF_PAGEOBJ_IMAGE
const TIPO_FORM = 5; // FPDF_PAGEOBJ_FORM
const FORMATO_BGRA = 4; // FPDFBitmap_BGRA
// FPDF_ANNOT (aparência das anotações, como um visualizador) | FPDF_REVERSE_BYTE_ORDER (sai RGBA) | FPDF_RENDER_LIMITEDIMAGECACHE
const FLAGS = 0x01 | 0x10 | 0x200;
const MAX_OBJETOS = 50_000; // por página, contando os de dentro dos formulários
const MAX_PROFUNDIDADE = 8;

class RecusaError extends Error {
  motivo: 'paginas' | 'conversao';
  constructor(motivo: 'paginas' | 'conversao') {
    super(motivo);
    this.motivo = motivo;
  }
}
/** Só o nome da exceção (regra 3: a mensagem pode citar o conteúdo do PDF), para o log de quem chamou. */
const nomeDoErro = (e: unknown) => (e instanceof Error ? e.name : 'erro').slice(0, 60);

const fila: unknown[] = [];
let acordar: (() => void) | null = null;
process.on('message', (m: unknown) => {
  fila.push(m);
  const a = acordar;
  acordar = null;
  a?.();
});
async function receber(): Promise<unknown> {
  while (!fila.length) await new Promise<void>((r) => (acordar = r));
  return fila.shift();
}
const enviar = (m: MensagemDoProcesso) => new Promise<void>((ok, falha) => void process.send!(m, undefined, {}, (e) => (e ? falha(e) : ok())));

function picoDesteProcesso(): number | null {
  try {
    const m = /VmHWM:\s+(\d+) kB/.exec(readFileSync('/proc/self/status', 'utf8'));
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

const lerU32 = (mod: Pdfium, ptr: number) => new DataView(mod.HEAPU8.buffer).getUint32(ptr, true);

/** Tamanho declarado de cada imagem (sem decodificar), descendo nos formulários; objetos demais ou fundo demais = recusa. */
function conferirImagens(mod: Pdfium, contar: () => number, pegar: (i: number) => number, ptr: number, max: number, cont: { n: number }, nivel: number): void {
  if (nivel > MAX_PROFUNDIDADE) throw new RecusaError('conversao');
  const n = contar();
  for (let i = 0; i < n; i++) {
    if (++cont.n > MAX_OBJETOS) throw new RecusaError('conversao');
    const obj = pegar(i);
    if (!obj) continue;
    const tipo = mod._FPDFPageObj_GetType(obj);
    if (tipo === TIPO_IMAGEM) {
      if (!mod._FPDFImageObj_GetImagePixelSize(obj, ptr, ptr + 4)) throw new RecusaError('conversao');
      if (lerU32(mod, ptr) * lerU32(mod, ptr + 4) > max) throw new RecusaError('conversao');
    } else if (tipo === TIPO_FORM) {
      conferirImagens(mod, () => mod._FPDFFormObj_CountObjects(obj), (j) => mod._FPDFFormObj_GetObject(obj, j), ptr, max, cont, nivel + 1);
    }
  }
}

/** A página inteira, maior lado = `ladoMax`, fundo branco, RGBA. */
function desenhar(mod: Pdfium, pagina: number, ladoMax: number): { largura: number; altura: number; rgba: Uint8Array } {
  const w = mod._FPDF_GetPageWidth(pagina);
  const h = mod._FPDF_GetPageHeight(pagina);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) throw new RecusaError('conversao');
  const escala = ladoMax / Math.max(w, h);
  const largura = Math.max(1, Math.round(w * escala));
  const altura = Math.max(1, Math.round(h * escala));
  const bytes = largura * altura * 4;
  const ptr = mod.wasmExports.malloc(bytes);
  if (!ptr) throw new RecusaError('conversao');
  let bitmap = 0;
  try {
    bitmap = mod._FPDFBitmap_CreateEx(largura, altura, FORMATO_BGRA, ptr, largura * 4);
    if (!bitmap) throw new RecusaError('conversao');
    mod._FPDFBitmap_FillRect(bitmap, 0, 0, largura, altura, 0xffffffff);
    mod._FPDF_RenderPageBitmap(bitmap, pagina, 0, 0, largura, altura, 0, FLAGS);
    return { largura, altura, rgba: mod.HEAPU8.slice(ptr, ptr + bytes) };
  } finally {
    if (bitmap) mod._FPDFBitmap_Destroy(bitmap);
    mod.wasmExports.free(ptr);
  }
}

async function rasterizar(e: Entrada): Promise<void> {
  const mod = await (PDFiumModule as unknown as () => Promise<Pdfium>)();
  // o mesmo que o PDFiumLibrary.init() do pacote faz (sem isolate do V8: a compilação não tem JavaScript)
  mod._FPDF_InitLibraryWithConfig({ version: 2, m_pIsolate: null, m_pUserFontPaths: null, m_v8EmbedderSlot: 0, m_pPlatform: null });
  const ptrPdf = mod.wasmExports.malloc(e.pdf.length);
  const ptrTamanho = mod.wasmExports.malloc(8);
  if (!ptrPdf || !ptrTamanho) throw new RecusaError('conversao');
  mod.HEAPU8.set(e.pdf, ptrPdf);
  // ilegível, truncado ou com senha: o paciente vê o mesmo texto (§6.2)
  const doc = mod._FPDF_LoadMemDocument(ptrPdf, e.pdf.length, 0);
  if (!doc) throw new RecusaError('conversao');
  try {
    const total = mod._FPDF_GetPageCount(doc);
    if (total < 1) throw new RecusaError('conversao');
    if (total > e.limitePaginas) throw new RecusaError('paginas');
    for (let i = 0; i < total; i++) {
      if ((await receber()) !== 'proxima') throw new RecusaError('conversao');
      const pagina = mod._FPDF_LoadPage(doc, i);
      if (!pagina) throw new RecusaError('conversao');
      try {
        conferirImagens(mod, () => mod._FPDFPage_CountObjects(pagina), (j) => mod._FPDFPage_GetObject(pagina, j), ptrTamanho, e.maxPixelsImagem, { n: 0 }, 0);
        const d = desenhar(mod, pagina, e.ladoMax);
        await enviar({ tipo: 'pagina', indice: i, total, largura: d.largura, altura: d.altura, rgba: d.rgba });
      } finally {
        mod._FPDF_ClosePage(pagina);
      }
    }
  } finally {
    mod._FPDF_CloseDocument(doc);
    mod.wasmExports.free(ptrPdf);
    mod.wasmExports.free(ptrTamanho);
  }
  await enviar({ tipo: 'fim', picoBytes: picoDesteProcesso() });
}

async function principal(): Promise<void> {
  const e = (await receber()) as Entrada;
  try {
    await rasterizar(e);
  } catch (err) {
    await enviar(err instanceof RecusaError ? { tipo: 'recusa', motivo: err.motivo } : { tipo: 'recusa', motivo: 'conversao', erro: nomeDoErro(err) });
  }
}

if (process.send) await principal();
```

- [ ] **Step 5: O lado do worker**

Criar `src/modules/pacientes/rasterizar-pdf.ts`:

```ts
import { fork, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { logger } from '@/lib/logger';
import type { MensagemDoProcesso } from './rasterizar-pdf-processo';

/** RNF-162 / D1: heap do processo filho, prazo da rasterização inteira e teto de memória residente (o filho é morto acima). */
export const HEAP_MAX_RASTER_MB = 64;
export const TEMPO_MAX_RASTER_MS = 120_000;
export const TETO_RSS_RASTER_BYTES = 120 * 1024 * 1024;
const VIGIA_MS = 20;

export class RasterizacaoError extends Error {
  override name = 'RasterizacaoError';
  constructor(readonly motivo: 'paginas' | 'conversao') {
    super(`rasterização: ${motivo}`);
  }
}

export type PaginaRaster = { indice: number; largura: number; altura: number; rgba: Buffer };
type Opcoes = { limitePaginas: number; ladoMax: number; maxPixelsImagem: number; tempoMaxMs?: number; tetoRssBytes?: number };

/** O motivo técnico fica no log, só o nome/código (regra 3: nada do PDF). */
function registrarRecusa(causa: unknown): void {
  const nome = typeof causa === 'string' ? causa : causa instanceof Error ? ((causa as NodeJS.ErrnoException).code ?? causa.name) : 'erro';
  logger.warn({ etapa: 'rasterizar', erro: nome.slice(0, 60) }, 'PDF do paciente recusado na rasterização');
}

/** Memória residente de um processo filho (Linux: /proc). Fora do Linux, null (sem vigia — só dev local). */
function rssDe(pid: number | undefined): number | null {
  if (!pid) return null;
  try {
    const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) * 1024 : null;
  } catch {
    return null;
  }
}

/**
 * Plano 12 (D23 = a, R-170, RNF-162, D1 do plano): rasteriza o PDF do paciente no processo filho rasterizar-pdf-processo.ts
 * (sem variáveis de ambiente, heap limitado, memória residente vigiada de 20 em 20 ms e prazo) e entrega UMA página por vez a
 * `aoReceber`, que converte e solta os pixels; só então pede a próxima. Estouro do teto, erro, saída sem resposta ou prazo
 * vencido → RasterizacaoError('conversao') e o filho é morto (SIGKILL) — o worker de 512 MB segue com as outras filas. Mais de
 * `limitePaginas` → ('paginas'), antes de desenhar. O erro de `aoReceber` volta como está. Só o worker importa (guarda).
 */
export function rasterizarPdf(pdf: Buffer, o: Opcoes, aoReceber: (p: PaginaRaster) => Promise<void>): Promise<{ paginas: number; picoBytes: number | null }> {
  return new Promise((resolve, reject) => {
    let filho: ChildProcess;
    try {
      filho = fork(fileURLToPath(new URL('./rasterizar-pdf-processo.ts', import.meta.url)), [], {
        execArgv: [`--max-old-space-size=${HEAP_MAX_RASTER_MB}`],
        env: {}, // nenhuma credencial do worker chega ao processo que abre o PDF do paciente
        serialization: 'advanced', // Uint8Array pela IPC
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'], // nada do filho vai para o log: pode citar o conteúdo
      });
    } catch (e) {
      registrarRecusa(e);
      return reject(new RasterizacaoError('conversao'));
    }
    let acabou = false;
    let paginas = 0;
    const teto = o.tetoRssBytes ?? TETO_RSS_RASTER_BYTES;
    const encerrar = (fim: () => void) => {
      if (acabou) return;
      acabou = true;
      clearTimeout(prazo);
      clearInterval(vigia);
      filho.kill('SIGKILL');
      fim();
    };
    const falhar = (motivo: 'paginas' | 'conversao', causa?: unknown) =>
      encerrar(() => {
        if (causa !== undefined) registrarRecusa(causa);
        reject(new RasterizacaoError(motivo));
      });
    const prazo = setTimeout(() => falhar('conversao', 'prazo'), o.tempoMaxMs ?? TEMPO_MAX_RASTER_MS);
    const vigia = setInterval(() => {
      const rss = rssDe(filho.pid);
      if (rss !== null && rss > teto) falhar('conversao', 'memoria');
    }, VIGIA_MS);
    filho.on('message', (m: MensagemDoProcesso) => {
      if (acabou) return;
      if (m.tipo === 'recusa') return falhar(m.motivo, m.erro);
      if (m.tipo === 'fim') return encerrar(() => resolve({ paginas, picoBytes: m.picoBytes }));
      paginas++;
      aoReceber({ indice: m.indice, largura: m.largura, altura: m.altura, rgba: Buffer.from(m.rgba.buffer, m.rgba.byteOffset, m.rgba.byteLength) }).then(
        () => {
          if (!acabou) filho.send('proxima');
        },
        (e: unknown) => encerrar(() => reject(e)),
      );
    });
    filho.once('error', (e) => falhar('conversao', e));
    filho.once('exit', () => falhar('conversao', 'saiu_sem_resposta'));
    filho.send({ tipo: 'entrada', pdf, limitePaginas: o.limitePaginas, ladoMax: o.ladoMax, maxPixelsImagem: o.maxPixelsImagem });
    filho.send('proxima');
  });
}
```

- [ ] **Step 6: Rodar o teste — inclusive a medida de memória**

Run: `pnpm vitest run src/modules/pacientes/rasterizar-pdf.test.ts`
Expected: PASS; o `console.info` do RNF-162 mostra o pico do worker e o do filho (registrar os números no PR e no manual técnico, T13).

**Se o teste do RNF-162 ou o da bomba reprovar** (pico acima de 150 MB, worker afetado ou o PDFium não abrir os PDFs de teste): **parar e avisar o controlador** com os números — não aumentar `TETO_RSS_RASTER_BYTES` nem o limite de 150 MB por conta própria. As saídas previstas (decisão do controlador com o dono): baixar `ENVIO_LADO_MAX` para 1600 px ou `MAX_PIXELS_IMAGEM_PDF` para 12 MP e medir de novo; ou o plano B da D1 (`pdfjs-dist` 6.4.299 + `@napi-rs/canvas` 1.0.10 no mesmo processo filho, com a imagem maior).

- [ ] **Step 7: Guarda estática (RNF-169)**

Criar `src/modules/pacientes/exames-enviados-guardas.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { caminhoAte, grafoDeImports, raizesDoNext } from '../../../test/grafo-de-imports';

const fontes = (dir: string): string[] =>
  readdirSync(path.resolve(dir), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.(ts|tsx|mjs|js)$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
    .map((d) => path.relative(process.cwd(), path.join(d.parentPath, d.name)).split(path.sep).join('/'));
const importa = (pacote: string) => (f: string) => new RegExp(`from '${pacote}(/[^']*)?'|import\\('${pacote}`).test(readFileSync(f, 'utf8'));

describe('RNF-169 / R-175: a rasterização e o job do envio de exame só no worker', () => {
  it('@hyzyla/pdfium só no processo filho da rasterização (src e scripts)', () => {
    expect([...fontes('src'), ...fontes('scripts')].filter(importa('@hyzyla/pdfium'))).toEqual(['src/modules/pacientes/rasterizar-pdf-processo.ts']);
  });

  it('nada do grafo do Next alcança a rasterização, o processo filho, o job do envio nem o PDFium', () => {
    const g = grafoDeImports(raizesDoNext());
    for (const proibido of [
      'src/modules/pacientes/rasterizar-pdf.ts',
      'src/modules/pacientes/rasterizar-pdf-processo.ts',
      'src/modules/pacientes/exames-enviados-job.tsx',
    ]) {
      expect(g.arquivos.has(proibido), `${proibido} alcançado por: ${caminhoAte(g, proibido).join(' → ')}`).toBe(false);
    }
    expect(g.pacotes.get('@hyzyla/pdfium'), '@hyzyla/pdfium importado (no grafo do Next) por').toBeUndefined();
    expect(g.pacotes.get('heic-decode'), 'heic-decode importado (no grafo do Next) por').toBeUndefined();
  });
});
```

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-guardas.test.ts src/modules/ia/guardas.test.ts`
Expected: PASS (o `exames-enviados-job.tsx` ainda não existe; a guarda já o protege quando a T6 o criar).

- [ ] **Step 8: Poda na imagem e conferência no CI**

No `Dockerfile`, no `RUN set -eu; …` da poda (estágio `build`), acrescentar depois do laço do `@anthropic-ai/sdk`:

```dockerfile
    for d in node_modules/.pnpm/@hyzyla+pdfium@*/node_modules/@hyzyla/pdfium; do \
      test -f "$d/dist/index.esm.js"; test -f "$d/dist/pdfium.wasm"; \
      find "$d/dist" -type f ! -name 'index.esm.js' ! -name 'pdfium.wasm' -delete; \
      find "$d/dist" -mindepth 1 -type d -empty -delete; \
    done
```

e ampliar o comentário acima do `RUN`: "Plano 12: do `@hyzyla/pdfium` só ficam o `index.esm.js` (que carrega o WASM pelo caminho) e o `pdfium.wasm`; saem as cópias em base64, os bundles de navegador, de CDN e de worker, o CJS e as declarações (~5 MB comprimidos)."

Em `.github/workflows/ci.yml`, no job `image`, depois do passo "O worker carrega o pdf-lib e o SDK da IA na imagem podada (Plano 11)":

```yaml
      - name: O worker rasteriza PDF na imagem podada (Plano 12)
        # O Dockerfile poda o @hyzyla/pdfium; aqui o processo filho sobe como no worker (node puro, .ts com tipos apagados).
        shell: bash
        run: |
          set -euo pipefail
          docker run --rm --network none --entrypoint node -e NODE_ENV=production nutridebby:ci --import tsx --input-type=module -e "
            const { PDFDocument } = await import('pdf-lib');
            const d = await PDFDocument.create(); d.addPage([595, 842]);
            const { rasterizarPdf } = await import('./src/modules/pacientes/rasterizar-pdf.ts');
            let n = 0;
            const r = await rasterizarPdf(Buffer.from(await d.save()), { limitePaginas: 10, ladoMax: 2000, maxPixelsImagem: 20000000 }, async () => { n++; });
            if (r.paginas !== 1 || n !== 1) throw new Error('rasterização falhou na imagem');
            console.log('rasterização ok na imagem');"
```

Se houver Docker na máquina: `docker build -t nutridebby:plano12 . && docker save nutridebby:plano12 | gzip -6 | wc -c` — o resultado em MB (arredondado para cima) tem de ficar **≤ 260**. Sem Docker, o job `image` do CI confere no PR. **Se passar de 260 MB: parar e avisar o dono** (subir o orçamento não custa nada, mas é decisão dele; não apagar outra parte da imagem às cegas).

- [ ] **Step 9: CLAUDE.md (regra 9) e commit**

No fim da regra 9, acrescentar: "A rasterização do PDF do paciente (`src/modules/pacientes/rasterizar-pdf.ts` e o processo filho `rasterizar-pdf-processo.ts`, único importador de `@hyzyla/pdfium`) e o job do envio (`exames-enviados-job.tsx`) só no worker (guarda em `exames-enviados-guardas.test.ts`); o original do paciente nunca chega ao navegador nem à F3-01."

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

```bash
git add package.json pnpm-lock.yaml Dockerfile .github/workflows/ci.yml test/exames-enviados.ts \
  src/modules/pacientes/rasterizar-pdf-processo.ts src/modules/pacientes/rasterizar-pdf.ts src/modules/pacientes/rasterizar-pdf.test.ts \
  src/modules/pacientes/exames-enviados-guardas.test.ts CLAUDE.md
git commit -m "feat(exames-enviados): rasterização do PDF do paciente (PDFium em WASM) num processo filho com teto de memória (P12-03)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 4: Envio pelo paciente — validação, limites, lote com uma reserva, lista, download e cancelamento (P12-04)

**Revisão: completa (agente revisor-rls)** — escrita da sessão de paciente, cota, limites contados com o paciente travado, auditoria da leitura do titular, isolamento entre pacientes.

**Files:**
- Create: `src/modules/portal/exames-enviados.ts` (+ `exames-enviados.test.ts`)
- Modify: `src/jobs/queues.ts` (filas `exame-envio`, `exame-envio-limpar`, `expirar-exame-envio`)

**Interfaces:**
- Consumes: T1 (tabelas, RLS), T2 (`salvarArquivos`, constantes, textos, `situacaoParaPaciente`); `pacienteDaSessao` (`src/modules/portal/sessao.ts`), `idValido` (`src/modules/pacientes/base.ts`), `dataValida`, `hojeNoFuso`, `somarAnos` (`src/modules/pacientes/datas.ts`), `inicioDoDia`, `partesNoFuso`, `somarDias` (`src/modules/agenda/fuso.ts`), `detectarTipo`, `auditRead`, `getBoss`, `fromDrizzle`.
- Produces: `EnvioError`, `classificarArquivos`, `enviarExame`, `MeuEnvio`, `meusEnvios`, `pdfDoMeuEnvio`, `cancelarMeuEnvio` (contratos no topo); filas `exame-envio` (payload `{ tenantId, envioId }`), `exame-envio-limpar` (idem) e `expirar-exame-envio` (agendada pela T8).

- [ ] **Step 1: As filas**

Em `src/jobs/queues.ts`, depois de `'expirar-ia'`:

```ts
  // Plano 12 (RN-163, D23 = a): o envio de exame do paciente — fotos convertidas e PDF rasterizado num processo filho, PDF
  // limpo, páginas e aviso. Payload { tenantId, envioId } (nada de dado de saúde). Um por vez (padrão do boss.work, RNF-162);
  // 300 s acima do pior caso (rasterização de até 120 s + gravações); na última tentativa, "falhou" (o handler decide).
  'exame-envio': { retryLimit: 2, retryDelay: 30, retryBackoff: true, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  // RN-166: o paciente cancelou; o worker apaga o PDF limpo e as páginas (a sessão de paciente não apaga stored_files)
  'exame-envio-limpar': { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  // RN-163/RN-167: processando parado > 30 min sem job vivo → falhou; recebido há 90 dias → expirado; sobras de arquivo (15 em 15 min)
  'expirar-exame-envio': { retryLimit: 1, retryDelay: 60, expireInSeconds: 300 },
```

- [ ] **Step 2: Escrever o teste do módulo (falha: o módulo não existe)**

Criar `src/modules/portal/exames-enviados.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { envioNoBanco, envioRecebido, JPEG_MINIMO, jpegDe, jpegQueDeclara, ligarExames } from '../../../test/exames-enviados';
import { PDF_MINIMO, pdfDeTeste } from '../../../test/ia';
import { closeDb } from '@/db/client';
import { auditLog, examSubmissionFiles, examSubmissions, patients, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { MSG_ENVIO } from '@/modules/pacientes/exames-enviados-constantes';
import { COTA_BYTES } from '@/modules/plataforma/armazenamento';
import { cancelarMeuEnvio, classificarArquivos, enviarExame, EnvioError, meusEnvios, pdfDoMeuEnvio } from './exames-enviados';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-pac-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const MB = 1024 * 1024;
const SP = { fuso: 'America/Sao_Paulo' };
const AGORA = new Date('2026-10-07T15:00:00Z'); // 12:00 em Brasília
const deps = { db: app.db, dataDir, agora: AGORA };
/** Passa no detectarTipo como HEIC (caixa ftyp); o conteúdo de verdade só o worker decodifica. */
const HEIC_FALSO = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(64)]);
const erroDe = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof EnvioError) return { status: e.status, erros: e.erros };
    throw e;
  }
  throw new Error('esperava EnvioError');
};
async function cenario(o: { ligado?: boolean; nascimento?: string } = {}) {
  const T = await novoTenant(app.db);
  if (o.ligado !== false) await ligarExames(app.db, T.tenantId);
  const p = await novoPaciente(app.db, T.ctx, o.nascimento ? { dataNascimento: o.nascimento } : {});
  return { T, p, ctx: ctxPaciente(T.tenantId, p.id) };
}
const entrada = (arquivos: Buffer[], extra: Record<string, unknown> = {}) => ({ dataColeta: '2026-09-28', nome: 'Hemograma', observacao: '', arquivos, ...extra });
const envios = (T: Awaited<ReturnType<typeof novoTenant>>, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.patientId, patientId)), app.db);
const bytes = async (tenantId: string) => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, tenantId)))[0].b;

describe('envio de exame pelo paciente (US-160, US-161, RN-160 a RN-162, RN-166, RN-169)', () => {
  it('US-160 "Enviar um PDF": envio "processando" do paciente, original com dono, linha "original" e o job na mesma transação; auditado', async () => {
    const { T, p, ctx } = await cenario();
    const { id } = await enviarExame(ctx, SP, entrada([await pdfDeTeste({ paginas: 2 })]), deps);
    const [e] = await envios(T, p.id);
    expect(e).toMatchObject({ id, status: 'processando', enviadoPor: ctx.actorUserId, dataColeta: '2026-09-28', nome: 'Hemograma', observacao: null, arquivoPath: null });
    const arquivos = await withTenant(T.ctx, (tx) => tx.select().from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, id)), app.db);
    expect(arquivos.map((a) => [a.papel, a.ordem])).toEqual([['original', 1]]);
    const [f] = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, arquivos[0].arquivoPath)), app.db);
    expect(f).toMatchObject({ tipo: 'exame_original', patientId: p.id, mime: 'application/pdf' });
    const jobs = await (await getBoss()).findJobs('exame-envio');
    expect(jobs.some((j) => (j.data as { envioId: string }).envioId === id)).toBe(true);
    const [a] = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'exames_enviados'), eq(auditLog.entidadeId, id))), app.db);
    expect(a).toMatchObject({ acao: 'criar', actorUserId: ctx.actorUserId });
  });

  it('US-160 "Enviar fotos" (D13 = b): JPEG, PNG e HEIC na ordem das páginas → 3 originais, ordem 1 a 3', async () => {
    const { T, ctx } = await cenario();
    const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { id } = await enviarExame(ctx, SP, entrada([await jpegDe(2000), png, HEIC_FALSO]), deps);
    const arquivos = await withTenant(T.ctx, (tx) => tx.select().from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, id)).orderBy(examSubmissionFiles.ordem), app.db);
    expect(arquivos.map((a) => [a.ordem, a.arquivoPath.split('.').pop()])).toEqual([[1, 'jpg'], [2, 'png'], [3, 'heic']]);
    expect(await classificarArquivos([await jpegDe(2000)])).toEqual({ tipo: 'fotos' });
    expect(await classificarArquivos([PDF_MINIMO])).toEqual({ tipo: 'pdf' });
  });

  it('US-160 "Arquivo inválido" e "PDF e fotos juntos, ou mais de 5 fotos": a mesma mensagem e nada gravado', async () => {
    const { T, p, ctx } = await cenario();
    const foto = await jpegDe(2000);
    const casos: [string, Buffer[]][] = [
      ['docx (zip)', [Buffer.from('PK\u0003\u0004docx')]],
      ['foto de 15 MB', [await jpegDe(15 * MB)]],
      ['PDF de 25 MB', [Buffer.concat([PDF_MINIMO, Buffer.alloc(25 * MB)])]],
      ['4 fotos de 9 MB', [await jpegDe(9 * MB), await jpegDe(9 * MB), await jpegDe(9 * MB), await jpegDe(9 * MB)]],
      ['JPEG de 50 MP', [await jpegQueDeclara(8000, 6250)]],
      ['PDF e foto', [PDF_MINIMO, foto]],
      ['6 fotos', Array.from({ length: 6 }, () => foto)],
      ['foto que não abre', [JPEG_MINIMO]],
      ['nenhum arquivo', []],
    ];
    for (const [nome, arquivos] of casos) {
      expect(await erroDe(enviarExame(ctx, SP, entrada(arquivos), deps)), nome).toEqual({ status: 400, erros: { arquivos: MSG_ENVIO.arquivos } });
    }
    expect(await envios(T, p.id)).toEqual([]);
  });

  it('US-160 "Data inválida" (ECF.17.05): futura, mais de 10 anos, antes do nascimento, vazia ou impossível', async () => {
    const { ctx } = await cenario({ nascimento: '2020-01-01' });
    const foto = await jpegDe(2000);
    const erros = async (dataColeta: string) => (await erroDe(enviarExame(ctx, SP, entrada([foto], { dataColeta }), deps))).erros;
    expect(await erros('2026-10-08')).toEqual({ dataColeta: MSG_ENVIO.dataFutura });
    expect(await erros('2016-10-06')).toEqual({ dataColeta: MSG_ENVIO.dataConfira });
    expect(await erros('2019-12-31')).toEqual({ dataColeta: MSG_ENVIO.dataConfira }); // antes do nascimento, dentro dos 10 anos
    expect(await erros('')).toEqual({ dataColeta: MSG_ENVIO.dataObrigatoria });
    expect(await erros('2026-02-30')).toEqual({ dataColeta: MSG_ENVIO.dataObrigatoria });
  });

  it('nome ≤ 120 e observação ≤ 500 caracteres (code points, como o CHECK); NUL → formulário inválido; a observação guarda as quebras de linha', async () => {
    const { T, p, ctx } = await cenario();
    const foto = await jpegDe(2000);
    expect((await erroDe(enviarExame(ctx, SP, entrada([foto], { nome: 'x'.repeat(121), observacao: 'y'.repeat(501) }), deps))).erros).toEqual({ nome: MSG_ENVIO.nome, observacao: MSG_ENVIO.observacao });
    expect((await erroDe(enviarExame(ctx, SP, entrada([foto], { nome: 'a\u0000b' }), deps))).erros).toEqual({ geral: MSG_ENVIO.formulario });
    await enviarExame(ctx, SP, entrada([foto], { nome: '🧪'.repeat(120), observacao: '  exame pedido\nna consulta de setembro  ' }), deps);
    const [e] = await envios(T, p.id);
    expect(e).toMatchObject({ nome: '🧪'.repeat(120), observacao: 'exame pedido\nna consulta de setembro' });
  });

  it('US-160 "Limites por paciente" (D14 = a): 10 aguardando; 5 no dia, no fuso do tenant', async () => {
    const foto = await jpegDe(2000);
    const A = await cenario();
    for (let i = 0; i < 10; i++) await envioNoBanco(app.db, A.T.ctx, A.p.id, { status: i % 2 ? 'recebido' : 'processando', createdAt: new Date('2026-09-01T12:00:00Z') });
    expect(await erroDe(enviarExame(A.ctx, SP, entrada([foto]), deps))).toEqual({ status: 409, erros: { geral: MSG_ENVIO.pendentes } });
    const B = await cenario();
    for (let i = 0; i < 4; i++) await envioNoBanco(app.db, B.T.ctx, B.p.id, { status: 'cancelado', createdAt: new Date('2026-10-07T12:00:00Z') });
    await envioNoBanco(app.db, B.T.ctx, B.p.id, { status: 'cancelado', createdAt: new Date('2026-10-07T02:30:00Z') }); // 06/10 23:30 em Brasília
    await enviarExame(B.ctx, SP, entrada([foto]), deps); // o 5º de hoje passa
    expect(await erroDe(enviarExame(B.ctx, SP, entrada([foto]), deps))).toEqual({ status: 409, erros: { geral: MSG_ENVIO.porDia } });
  });

  it('US-160 "Espaço do consultório esgotado": 10 MB livres e 3 fotos de 6 MB → 507 com o texto da spec; nada gravado', async () => {
    const { T, p, ctx } = await cenario();
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES - 10 * MB }).where(eq(tenants.id, T.tenantId));
    const foto = await jpegDe(6 * MB);
    expect(await erroDe(enviarExame(ctx, SP, entrada([foto, foto, foto]), deps))).toEqual({ status: 507, erros: { geral: MSG_ENVIO.cota } });
    expect(await envios(T, p.id)).toEqual([]);
    expect(await bytes(T.tenantId)).toBe(COTA_BYTES - 10 * MB);
  });

  it('RN-160: recebimento desligado → 404; paciente arquivado → "Conta temporariamente indisponível"', async () => {
    const foto = await jpegDe(2000);
    const desligado = await cenario({ ligado: false });
    expect((await erroDe(enviarExame(desligado.ctx, SP, entrada([foto]), deps))).status).toBe(404);
    const { T, p, ctx } = await cenario();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, p.id)), app.db);
    expect(await erroDe(enviarExame(ctx, SP, entrada([foto]), deps))).toEqual({ status: 409, erros: { geral: MSG_ENVIO.indisponivel } });
  });

  it('US-161 "Lista": só os próprios, sem os cancelados, com o texto da §6.2; download só em "recebido"; a lista é auditada (D22)', async () => {
    const { T, p, ctx } = await cenario();
    const rec = await envioRecebido(app.db, T.ctx, p.id, dataDir, { nome: null });
    const revisao = { revisadoPor: T.nutriId, revisadoEm: new Date() };
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', motivoRecusa: 'outro', motivoRecusaTexto: 'Faltou a página 2', ...revisao });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'falhou', motivoFalha: 'paginas' });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'cancelado' });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    const outro = await novoPaciente(app.db, T.ctx);
    await envioNoBanco(app.db, T.ctx, outro.id, { status: 'recebido' });
    const lista = await meusEnvios(ctx, { db: app.db });
    expect(lista.map((e) => e.situacao).sort()).toEqual(
      ['Aguardando sua nutricionista', 'Não aceito: Faltou a página 2', 'O PDF tem mais de 10 páginas. Envie só as páginas com os resultados.', 'Processando…'].sort(),
    );
    expect(lista.find((e) => e.id === rec.id)).toMatchObject({ nome: null, status: 'recebido', podeBaixar: true, mostraCancelar: true });
    expect(lista.filter((e) => e.podeBaixar)).toHaveLength(1);
    expect(lista.find((e) => e.status === 'processando')).toMatchObject({ podeBaixar: false, mostraCancelar: true });
    expect(lista.find((e) => e.status === 'recusado')).toMatchObject({ mostraCancelar: false });
    for (const e of lista) expect(Object.keys(e).sort()).toEqual(['dataColeta', 'enviadoEm', 'id', 'mostraCancelar', 'nome', 'podeBaixar', 'situacao', 'status']);
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'exames_enviados'), eq(auditLog.patientId, p.id))), app.db);
    expect(lidas).toHaveLength(1);
  });

  it('D17 = a: baixa o próprio PDF limpo só em "recebido" (auditado); aceito, de outro paciente ou id inválido → null', async () => {
    const { T, p, ctx } = await cenario();
    const rec = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    expect(await pdfDoMeuEnvio(ctx, rec.id, app.db)).toBe(rec.pdf);
    const [lida] = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.acao, 'ler'), eq(auditLog.entidadeId, rec.id))), app.db);
    expect(lida).toMatchObject({ entidade: 'exames_enviados', patientId: p.id, actorUserId: ctx.actorUserId });
    const aceito = await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() });
    expect(await pdfDoMeuEnvio(ctx, aceito, app.db)).toBeNull();
    const outro = await novoPaciente(app.db, T.ctx);
    const doOutro = await envioRecebido(app.db, T.ctx, outro.id, dataDir);
    expect(await pdfDoMeuEnvio(ctx, doOutro.id, app.db)).toBeNull();
    expect(await pdfDoMeuEnvio(ctx, 'nao-e-uuid', app.db)).toBeNull();
  });

  it('US-161 "Cancelar": recebido → cancelado + job de limpeza; processando → "Aguarde…"; revisado ou de outro paciente → 404 e nada muda', async () => {
    const { T, p, ctx } = await cenario();
    const rec = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await cancelarMeuEnvio(ctx, rec.id, { db: app.db });
    expect((await envios(T, p.id)).find((e) => e.id === rec.id)?.status).toBe('cancelado');
    const jobs = await (await getBoss()).findJobs('exame-envio-limpar');
    expect(jobs.some((j) => (j.data as { envioId: string }).envioId === rec.id)).toBe(true);
    const proc = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    expect(await erroDe(cancelarMeuEnvio(ctx, proc, { db: app.db }))).toEqual({ status: 409, erros: { geral: MSG_ENVIO.aguarde } });
    const aceito = await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() });
    expect((await erroDe(cancelarMeuEnvio(ctx, aceito, { db: app.db }))).status).toBe(404);
    // US-161 "Isolamento": B não vê, não baixa e não cancela os envios de A
    const outro = await novoPaciente(app.db, T.ctx);
    const doOutro = await envioRecebido(app.db, T.ctx, outro.id, dataDir);
    expect((await erroDe(cancelarMeuEnvio(ctx, doOutro.id, { db: app.db }))).status).toBe(404);
    expect((await meusEnvios(ctx, { db: app.db })).map((e) => e.id)).not.toContain(doOutro.id);
    expect((await envios(T, outro.id))[0].status).toBe('recebido');
  });
});
```

Run: `pnpm vitest run src/modules/portal/exames-enviados.test.ts`
Expected: FAIL (`./exames-enviados` não existe).

- [ ] **Step 3: Implementar o módulo do paciente**

Criar `src/modules/portal/exames-enviados.ts`:

```ts
import { and, count, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import sharp from 'sharp';
import { getDb, type Db, type Tx } from '@/db/client';
import { examSubmissionFiles, examSubmissions, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { detectarTipo } from '@/lib/file-type';
import { inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { idValido } from '@/modules/pacientes/base';
import { dataValida, hojeNoFuso, somarAnos } from '@/modules/pacientes/datas';
import {
  ENVIO_FOTO_MAX_BYTES, ENVIO_MAX_FOTOS, ENVIO_MAX_PIXELS, ENVIO_PDF_MAX_BYTES, ENVIO_TOTAL_MAX_BYTES, ENVIOS_PENDENTES_MAX, ENVIOS_POR_DIA_MAX,
  MSG_ENVIO, NOME_ENVIO_MAX, OBSERVACAO_ENVIO_MAX, situacaoParaPaciente, type StatusEnvio,
} from '@/modules/pacientes/exames-enviados-constantes';
import { CotaEsgotadaError, salvarArquivos, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { pacienteDaSessao } from './sessao';

type Campo = 'dataColeta' | 'nome' | 'observacao' | 'arquivos' | 'geral';

/** Recusa com o texto da spec. `status`: o da resposta da rota (404 = recebimento desligado ou envio que não é dele). */
export class EnvioError extends Error {
  override name = 'EnvioError';
  constructor(
    readonly status: 400 | 404 | 409 | 507,
    readonly erros: Partial<Record<Campo, string>>,
  ) {
    super('Envio de exame recusado');
  }
}

/**
 * RN-161 (D13 = b): 1 PDF de até 20 MB OU 1 a 5 fotos JPEG/PNG/HEIC de até 10 MB cada, somando até 30 MB; tipo pelo conteúdo;
 * JPEG/PNG acima de 40 MP recusados pelo CABEÇALHO (sharp metadata, sem decodificar — como a digitalizada, RN-157); o HEIC e o
 * número de páginas do PDF são conferidos no worker. Fora disso, null (a rota mostra a mensagem única da US-160).
 */
export async function classificarArquivos(arquivos: readonly Buffer[]): Promise<{ tipo: 'pdf' | 'fotos' } | null> {
  if (!arquivos.length || arquivos.length > ENVIO_MAX_FOTOS) return null;
  if (arquivos.reduce((s, b) => s + b.length, 0) > ENVIO_TOTAL_MAX_BYTES) return null;
  const exts = arquivos.map((b) => (b.length ? detectarTipo(b)?.ext : undefined));
  if (exts.includes('pdf')) return arquivos.length === 1 && arquivos[0].length <= ENVIO_PDF_MAX_BYTES ? { tipo: 'pdf' } : null;
  for (let i = 0; i < arquivos.length; i++) {
    const ext = exts[i];
    if (ext !== 'jpg' && ext !== 'png' && ext !== 'heic') return null;
    if (arquivos[i].length > ENVIO_FOTO_MAX_BYTES) return null;
    if (ext === 'heic') continue;
    const m = await sharp(arquivos[i], { limitInputPixels: ENVIO_MAX_PIXELS, failOn: 'error' }).metadata().catch(() => null);
    if (!m?.width || !m.height || m.width * m.height > ENVIO_MAX_PIXELS) return null;
  }
  return { tipo: 'fotos' };
}

/** Texto digitado: NFC e sem espaço nas pontas; o nome também junta os espaços (a observação guarda as quebras de linha). */
const texto = (v: unknown, juntarEspacos: boolean): string => {
  if (typeof v !== 'string') return '';
  const t = v.normalize('NFC').trim();
  return juntarEspacos ? t.replace(/\s+/g, ' ') : t;
};
const caracteres = (s: string) => [...s].length; // code points, como o CHECK (char_length)

/**
 * RN-160 / RN-162, conferidas com o paciente TRAVADO (FOR UPDATE; ele pode ter sido arquivado ou bloqueado no meio) e de
 * novo no `antesDaReserva` da transação que grava: recebimento ligado (D18), paciente ativo e não anonimizado, no máximo 10
 * envios aguardando e 5 no dia (fuso do tenant). Os cancelados contam no dia (o limite é de envios, não de pendências).
 */
async function conferirAntesDeGravar(tx: Tx, tenantId: string, patientId: string, fuso: string, agora: Date): Promise<void> {
  const [t] = await tx.select({ ligado: tenants.examesPacienteAtivadoEm }).from(tenants).where(eq(tenants.id, tenantId));
  if (!t?.ligado) throw new EnvioError(404, {});
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p || p.status !== 'ativo' || p.anonimizadoEm) throw new EnvioError(409, { geral: MSG_ENVIO.indisponivel });
  const [{ pendentes }] = await tx
    .select({ pendentes: count() })
    .from(examSubmissions)
    .where(and(eq(examSubmissions.patientId, patientId), inArray(examSubmissions.status, ['processando', 'recebido'])));
  if (pendentes >= ENVIOS_PENDENTES_MAX) throw new EnvioError(409, { geral: MSG_ENVIO.pendentes });
  const hoje = partesNoFuso(agora, fuso).data;
  const [{ noDia }] = await tx
    .select({ noDia: count() })
    .from(examSubmissions)
    .where(and(eq(examSubmissions.patientId, patientId), gte(examSubmissions.createdAt, inicioDoDia(hoje, fuso)), lt(examSubmissions.createdAt, inicioDoDia(somarDias(hoje, 1), fuso))));
  if (noDia >= ENVIOS_POR_DIA_MAX) throw new EnvioError(409, { geral: MSG_ENVIO.porDia });
}

/**
 * US-160 / RN-163: o envio nasce "processando". Todos os originais (tipo `exame_original`) entram por `salvarArquivos` com UMA
 * reserva de cota pela soma; o `registrar` grava o envio, as linhas "original" e o job `exame-envio` na MESMA transação —
 * tudo ou nada (DEP-09: a sessão de paciente não desfaria um envio gravado pela metade). Nada vai ao prontuário aqui.
 */
export async function enviarExame(
  ctx: TenantContext,
  tenant: { fuso: string },
  entrada: { dataColeta: unknown; nome: unknown; observacao: unknown; arquivos: Buffer[] },
  deps: { db?: Db; agora?: Date; dataDir?: string; boss?: PgBoss } = {},
): Promise<{ id: string }> {
  const patientId = pacienteDaSessao(ctx, 'enviarExame');
  const conta = ctx.actorUserId;
  if (!conta) throw new Error('enviarExame: sessão de paciente sem conta');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const nome = texto(entrada.nome, true);
  const observacao = texto(entrada.observacao, false);
  // NUL não cabe num `text` do Postgres (SQLSTATE 22021): sem isto, um 500 em vez de um 400
  if (nome.includes('\0') || observacao.includes('\0')) throw new EnvioError(400, { geral: MSG_ENVIO.formulario });
  const erros: Partial<Record<Campo, string>> = {};
  if (caracteres(nome) > NOME_ENVIO_MAX) erros.nome = MSG_ENVIO.nome;
  if (caracteres(observacao) > OBSERVACAO_ENVIO_MAX) erros.observacao = MSG_ENVIO.observacao;
  const dataColeta = typeof entrada.dataColeta === 'string' ? entrada.dataColeta.trim() : '';
  const hoje = hojeNoFuso(tenant.fuso, agora);
  const [p] = await withTenant(ctx, (tx) => tx.select({ nascimento: patients.dataNascimento }).from(patients).where(eq(patients.id, patientId)), db);
  if (!dataValida(dataColeta)) erros.dataColeta = MSG_ENVIO.dataObrigatoria;
  else if (dataColeta > hoje) erros.dataColeta = MSG_ENVIO.dataFutura;
  else if (dataColeta < somarAnos(hoje, -10) || (p?.nascimento && dataColeta < p.nascimento)) erros.dataColeta = MSG_ENVIO.dataConfira;
  if (!(await classificarArquivos(entrada.arquivos))) erros.arquivos = MSG_ENVIO.arquivos;
  if (Object.keys(erros).length) throw new EnvioError(400, erros);
  // barato e antes de mandar até 30 MB ao disco; vale de novo, com a trava, na transação que grava
  await withTenant(ctx, (tx) => conferirAntesDeGravar(tx, ctx.tenantId, patientId, tenant.fuso, agora), db);
  // fora da transação: o start do pg-boss não pode esperar segurando a conexão (e a trava) do paciente
  const boss = deps.boss ?? (await getBoss());
  let id = '';
  try {
    await salvarArquivos(
      ctx,
      {
        tipo: 'exame_original',
        conteudos: entrada.arquivos,
        permitidos: ['pdf', 'jpg', 'png', 'heic'],
        patientId,
        antesDaReserva: (tx) => conferirAntesDeGravar(tx, ctx.tenantId, patientId, tenant.fuso, agora),
        registrar: async (tx, arquivos) => {
          const [e] = await tx
            .insert(examSubmissions)
            .values({ tenantId: ctx.tenantId, patientId, enviadoPor: conta, status: 'processando', dataColeta, nome: nome || null, observacao: observacao || null, createdAt: agora, updatedAt: agora })
            .returning({ id: examSubmissions.id });
          id = e.id;
          await tx.insert(examSubmissionFiles).values(arquivos.map((a, i) => ({ tenantId: ctx.tenantId, patientId, submissionId: e.id, arquivoPath: a.caminho, papel: 'original', ordem: i + 1 })));
          const job = await boss.send('exame-envio', { tenantId: ctx.tenantId, envioId: e.id }, { db: fromDrizzle(tx, sql) });
          if (!job) throw new Error('A fila recusou o processamento do exame enviado');
        },
      },
      { db, dataDir: deps.dataDir },
    );
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) throw new EnvioError(400, { arquivos: MSG_ENVIO.arquivos });
    if (e instanceof CotaEsgotadaError) throw new EnvioError(507, { geral: MSG_ENVIO.cota });
    throw e;
  }
  return { id };
}

export type MeuEnvio = {
  id: string;
  enviadoEm: Date;
  dataColeta: string;
  nome: string | null;
  status: StatusEnvio;
  /** §6.2: o texto que o paciente vê. */
  situacao: string;
  /** D17 = a: o próprio PDF limpo, só enquanto aguarda a revisão. */
  podeBaixar: boolean;
  /** "Cancelar envio": no recebido cancela; no processando mostra "Aguarde o processamento terminar." (US-161). */
  mostraCancelar: boolean;
};

/**
 * US-161 / RN-169: os envios do paciente da sessão (RLS por paciente), mais recentes primeiro, sem os cancelados ("some da
 * lista"). Projeção fechada: nunca caminho de arquivo, códigos internos nem a revisão. Leitura do titular auditada (D22).
 */
export async function meusEnvios(ctx: TenantContext, o: { db?: Db; limite?: number } = {}): Promise<MeuEnvio[]> {
  const patientId = pacienteDaSessao(ctx, 'meusEnvios');
  const linhas = await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .select()
        .from(examSubmissions)
        .where(and(eq(examSubmissions.patientId, patientId), ne(examSubmissions.status, 'cancelado')))
        .orderBy(desc(examSubmissions.createdAt))
        .limit(o.limite ?? 50);
      if (r.length) await auditRead(tx, { entidade: 'exames_enviados', entidadeId: null, patientId });
      return r;
    },
    o.db ?? getDb(),
  );
  return linhas.map((e) => ({
    id: e.id,
    enviadoEm: e.createdAt,
    dataColeta: e.dataColeta,
    nome: e.nome,
    status: e.status as StatusEnvio,
    situacao: situacaoParaPaciente(e),
    podeBaixar: e.status === 'recebido' && !!e.arquivoPath,
    mostraCancelar: e.status === 'recebido' || e.status === 'processando',
  }));
}

/** D17 = a / RN-169: o caminho do próprio PDF limpo, só com o envio "recebido" (depois do aceite é laudo: US-044). Auditado. */
export async function pdfDoMeuEnvio(ctx: TenantContext, id: string, db: Db = getDb()): Promise<string | null> {
  const patientId = pacienteDaSessao(ctx, 'pdfDoMeuEnvio');
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx
        .select({ caminho: examSubmissions.arquivoPath })
        .from(examSubmissions)
        .where(and(eq(examSubmissions.id, id), eq(examSubmissions.patientId, patientId), eq(examSubmissions.status, 'recebido')));
      if (!e?.caminho) return null;
      await auditRead(tx, { entidade: 'exames_enviados', entidadeId: id, patientId });
      return e.caminho;
    },
    db,
  );
}

/**
 * RN-166: a sessão de paciente marca o próprio envio "recebido" como "cancelado" (a única transição que a política e o gatilho
 * deixam) e enfileira `exame-envio-limpar` na MESMA transação; quem apaga os arquivos é o worker. "processando" → "Aguarde o
 * processamento terminar."; outro envio, revisado ou inexistente → 404.
 */
export async function cancelarMeuEnvio(ctx: TenantContext, id: string, deps: { db?: Db; boss?: PgBoss; agora?: Date } = {}): Promise<void> {
  const patientId = pacienteDaSessao(ctx, 'cancelarMeuEnvio');
  if (!idValido(id)) throw new EnvioError(404, {});
  const boss = deps.boss ?? (await getBoss());
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const r = await tx
        .update(examSubmissions)
        .set({ status: 'cancelado', updatedAt: agora })
        .where(and(eq(examSubmissions.id, id), eq(examSubmissions.patientId, patientId), eq(examSubmissions.status, 'recebido')))
        .returning({ id: examSubmissions.id });
      if (!r.length) {
        const [e] = await tx.select({ status: examSubmissions.status }).from(examSubmissions).where(and(eq(examSubmissions.id, id), eq(examSubmissions.patientId, patientId)));
        if (e?.status === 'processando') throw new EnvioError(409, { geral: MSG_ENVIO.aguarde });
        throw new EnvioError(404, {});
      }
      const job = await boss.send('exame-envio-limpar', { tenantId: ctx.tenantId, envioId: id }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou a limpeza do envio cancelado');
    },
    deps.db ?? getDb(),
  );
}
```

- [ ] **Step 4: Rodar e commitar**

Run: `pnpm vitest run src/modules/portal/exames-enviados.test.ts src/jobs/boss.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, sem erros.

```bash
git add src/modules/portal/exames-enviados.ts src/modules/portal/exames-enviados.test.ts src/jobs/queues.ts
git commit -m "feat(exames-enviados): envio pelo paciente — validação, limites, lote com uma reserva, lista, download e cancelamento (P12-04)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 5: Rotas do portal — `POST /api/p/exames` e `GET /api/p/exames/[id]/pdf` (P12-05)

**Revisão: completa (agente revisor-rls)** — rota de envio do paciente: origem, sessão, corpo limitado com prazo, vagas por processo e por conta (R-173), recebimento desligado.

**Files:**
- Create: `src/app/api/p/exames/route.ts` (+ `route.test.ts`), `src/app/api/p/exames/[id]/pdf/route.ts` (+ `route.test.ts`)

**Interfaces:**
- Consumes: `mesmaOrigem`, `requireApiPaciente`, `lerCorpoLimitado`/`CorpoGrandeError`/`CorpoLentoError` (`src/lib/corpo.ts`), `signFileUrl`; T4 (`enviarExame`, `EnvioError`, `pdfDoMeuEnvio`); `MSG_ENVIO`, `ENVIO_TOTAL_MAX_BYTES`.
- Produces: `POST /api/p/exames` (multipart: `dataColeta`, `nome`, `observacao`, `arquivos` repetido) → `200 { ok: true, id, mensagem }` | `4xx/507 { erros }`; `GET /api/p/exames/{id}/pdf` → `303` para a URL assinada (5 min) | `404`.

- [ ] **Step 1: Escrever os testes das rotas (falham: as rotas não existem)**

Criar `src/app/api/p/exames/route.test.ts`:

```ts
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { examSubmissions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getAuth } from '@/lib/auth';
import { stopBoss } from '@/jobs/boss';
import { MSG_ENVIO } from '@/modules/pacientes/exames-enviados-constantes';
import { novoTenant } from '../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../test/portal';
import { entrar } from '../../../../../test/sessao';
import { jpegDe, ligarExames } from '../../../../../test/exames-enviados';
import { PDF_MINIMO } from '../../../../../test/ia';
import { POST } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});

async function pacienteLogado(o: { ligado?: boolean } = {}) {
  const T = await novoTenant(db);
  if (o.ligado !== false) await ligarExames(db, T.tenantId);
  const { paciente, email } = await pacienteComConta(db, T);
  return { T, paciente, cookie: await entrar(auth, email) };
}
function enviar(campos: { dataColeta?: string; nome?: string; arquivos?: Blob[] }, o: { cookie?: string; origin?: string; headers?: Record<string, string> } = {}) {
  const f = new FormData();
  f.set('dataColeta', campos.dataColeta ?? '2026-09-28');
  if (campos.nome) f.set('nome', campos.nome);
  for (const a of campos.arquivos ?? []) f.append('arquivos', a);
  return POST(
    new Request('http://localhost:3000/api/p/exames', {
      method: 'POST',
      body: f,
      headers: { ...(o.cookie ? { cookie: o.cookie } : {}), origin: o.origin ?? 'http://localhost:3000', ...o.headers },
    }),
  );
}
const envios = (T: Awaited<ReturnType<typeof novoTenant>>, patientId: string) => withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.patientId, patientId)), db);
const pdf = () => new Blob([PDF_MINIMO], { type: 'application/pdf' });

describe('POST /api/p/exames (US-160, RN-161)', () => {
  it('sem sessão → 401; outra origem → 403; recebimento desligado → 404; nada gravado', async () => {
    const A = await pacienteLogado();
    expect((await enviar({ arquivos: [pdf()] })).status).toBe(401);
    expect((await enviar({ arquivos: [pdf()] }, { cookie: A.cookie, origin: 'https://evil.example' })).status).toBe(403);
    const D = await pacienteLogado({ ligado: false });
    expect((await enviar({ arquivos: [pdf()] }, { cookie: D.cookie })).status).toBe(404);
    expect(await envios(A.T, A.paciente.id)).toEqual([]);
    expect(await envios(D.T, D.paciente.id)).toEqual([]);
  });

  it('PDF válido → 200 com "Exame enviado. Sua nutricionista vai revisar." e o envio "processando"; sem cache', async () => {
    const A = await pacienteLogado();
    const r = await enviar({ nome: 'Hemograma', arquivos: [pdf()] }, { cookie: A.cookie });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo = await r.json();
    expect(corpo).toMatchObject({ ok: true, mensagem: MSG_ENVIO.enviado });
    expect((await envios(A.T, A.paciente.id)).map((e) => [e.id, e.status])).toEqual([[corpo.id, 'processando']]);
  });

  it('content-length acima de 30 MB + margem → 413; arquivo inválido → 400 com a mensagem única; data futura → 400 no campo', async () => {
    const A = await pacienteLogado();
    const grande = await enviar({ arquivos: [pdf()] }, { cookie: A.cookie, headers: { 'content-length': String(31 * 1024 * 1024) } });
    expect(grande.status).toBe(413);
    expect(await grande.json()).toEqual({ erros: { arquivos: MSG_ENVIO.arquivos } });
    const docx = await enviar({ arquivos: [new Blob([Buffer.from('PK\u0003\u0004docx')])] }, { cookie: A.cookie });
    expect(docx.status).toBe(400);
    expect(await docx.json()).toEqual({ erros: { arquivos: MSG_ENVIO.arquivos } });
    const futura = await enviar({ dataColeta: '2999-01-01', arquivos: [new Blob([await jpegDe(2000)])] }, { cookie: A.cookie });
    expect(futura.status).toBe(400);
    expect(await futura.json()).toEqual({ erros: { dataColeta: MSG_ENVIO.dataFutura } });
    expect(await envios(A.T, A.paciente.id)).toEqual([]);
  });

  it('US-160 "Muitos envios ao mesmo tempo": o 2º envio da mesma conta enquanto o 1º chega → 429, sem afetar outro paciente', async () => {
    const A = await pacienteLogado();
    const B = await pacienteLogado();
    const f = new FormData();
    f.set('dataColeta', '2026-09-28');
    f.append('arquivos', pdf());
    const pronto = new Request('http://localhost:3000/api/p/exames', { method: 'POST', body: f });
    const corpo = new Uint8Array(await pronto.arrayBuffer());
    let terminar!: () => void;
    let lendo!: () => void;
    const comecouALer = new Promise<void>((r) => (lendo = r));
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(corpo.slice(0, 10));
        terminar = () => {
          c.enqueue(corpo.slice(10));
          c.close();
        };
      },
      pull: () => lendo(),
    });
    const primeiro = POST(
      new Request('http://localhost:3000/api/p/exames', {
        method: 'POST',
        body,
        duplex: 'half',
        headers: { cookie: A.cookie, origin: 'http://localhost:3000', 'content-type': pronto.headers.get('content-type')! },
      } as RequestInit),
    );
    await comecouALer;
    const segundo = await enviar({ arquivos: [pdf()] }, { cookie: A.cookie });
    expect(segundo.status).toBe(429);
    expect(await segundo.json()).toEqual({ erros: { geral: MSG_ENVIO.ocupado } });
    expect((await enviar({ arquivos: [pdf()] }, { cookie: B.cookie })).status).toBe(200);
    terminar();
    expect((await primeiro).status).toBe(200);
    expect(await envios(A.T, A.paciente.id)).toHaveLength(1);
  });
});
```

Criar `src/app/api/p/exames/[id]/pdf/route.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { stopBoss } from '@/jobs/boss';
import { novoTenant } from '../../../../../../../test/pacientes';
import { pacienteComConta } from '../../../../../../../test/portal';
import { entrar } from '../../../../../../../test/sessao';
import { envioNoBanco, envioRecebido } from '../../../../../../../test/exames-enviados';
import { GET } from './route';

vi.mock('server-only', () => ({}));

const db = getDb();
const auth = getAuth();
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-pdf-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
const baixar = (id: string, cookie?: string) =>
  GET(new Request(`http://localhost:3000/api/p/exames/${id}/pdf`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) } as RouteContext<'/api/p/exames/[id]/pdf'>);

describe('GET /api/p/exames/{id}/pdf (D17 = a, RN-169)', () => {
  it('o próprio envio "recebido" → 303 para a URL assinada; aceito, de outro paciente ou sem sessão → 404/401', async () => {
    const T = await novoTenant(db);
    const { paciente, email } = await pacienteComConta(db, T);
    const cookie = await entrar(auth, email);
    const rec = await envioRecebido(db, T.ctx, paciente.id, dataDir);
    const r = await baixar(rec.id, cookie);
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toMatch(/^\/api\/arquivos\?c=/);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const aceito = await envioNoBanco(db, T.ctx, paciente.id, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() });
    expect((await baixar(aceito, cookie)).status).toBe(404);
    const outro = await pacienteComConta(db, T);
    const doOutro = await envioRecebido(db, T.ctx, outro.paciente.id, dataDir);
    expect((await baixar(doOutro.id, cookie)).status).toBe(404);
    expect((await baixar(rec.id)).status).toBe(401);
  });
});
```

(O `dataDir` do teste só guarda os arquivos de apoio; a rota não lê o disco: devolve a URL assinada.)

Run: `pnpm vitest run src/app/api/p/exames`
Expected: FAIL (as rotas não existem).

- [ ] **Step 2: Implementar as rotas**

Criar `src/app/api/p/exames/route.ts`:

```ts
import { CorpoGrandeError, CorpoLentoError, lerCorpoLimitado } from '@/lib/corpo';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiPaciente, type ApiPaciente } from '@/lib/paciente-session';
import { ENVIO_TOTAL_MAX_BYTES, MSG_ENVIO } from '@/modules/pacientes/exames-enviados-constantes';
import { enviarExame, EnvioError } from '@/modules/portal/exames-enviados';

export const dynamic = 'force-dynamic';

const LIMITE_CORPO = ENVIO_TOTAL_MAX_BYTES + 256 * 1024; // os 30 MB + os campos e as bordas do multipart
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
/**
 * R-173 / RNF-162 (molde de /api/p/diario): cada envio segura ≈ 3 cópias do corpo (≈ 90 MB com 30 MB) numa VPS dividida com o
 * CRM de produção — no máximo 2 envios por processo e 1 por conta; e um prazo para o corpo chegar (RNF-161: 30 MB a
 * ≈ 1,4 Mbit/s levam ≈ 180 s), para um envio lento não segurar a vaga pelos 300 s do `requestTimeout` do Node.
 */
const MAX_ENVIOS = 2;
let emAndamento = 0;
const enviosPorConta = new Set<string>();
const PRAZO_CORPO_MS = 180_000;

/** US-160: multipart (dataColeta, nome, observacao, arquivos…). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request): Promise<Response> {
  if (!mesmaOrigem(req)) return resposta(403, { erros: { geral: 'Acesso negado' } });
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  // D18 = a: com o recebimento desligado, a opção nem aparece; um envio direto à API é recusado
  if (!acesso.tenant.examesPacienteAtivadoEm) return resposta(404, { erros: {} });
  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erros: { arquivos: MSG_ENVIO.arquivos } });
  const conta = acesso.data.user.id;
  if (emAndamento >= MAX_ENVIOS || enviosPorConta.has(conta)) return resposta(429, { erros: { geral: MSG_ENVIO.ocupado } });
  emAndamento++;
  enviosPorConta.add(conta);
  try {
    return await receber(req, acesso);
  } finally {
    emAndamento--;
    enviosPorConta.delete(conta);
  }
}

async function receber(req: Request, acesso: Extract<ApiPaciente, { ok: true }>): Promise<Response> {
  let form: FormData;
  try {
    const corpo = await lerCorpoLimitado(req, LIMITE_CORPO, { prazoMs: PRAZO_CORPO_MS });
    form = await new Response(new Uint8Array(corpo.buffer as ArrayBuffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
  } catch (e) {
    if (e instanceof CorpoGrandeError) return resposta(413, { erros: { arquivos: MSG_ENVIO.arquivos } });
    if (e instanceof CorpoLentoError) return resposta(408, { erros: { geral: MSG_ENVIO.ocupado } });
    return resposta(400, { erros: { geral: MSG_ENVIO.formulario } });
  }
  const arquivos: Buffer[] = [];
  for (const a of form.getAll('arquivos')) if (a instanceof Blob && a.size > 0) arquivos.push(Buffer.from(await a.arrayBuffer()));
  try {
    const { id } = await enviarExame(acesso.ctx, acesso.tenant, { dataColeta: form.get('dataColeta'), nome: form.get('nome'), observacao: form.get('observacao'), arquivos });
    return resposta(200, { ok: true, id, mensagem: MSG_ENVIO.enviado });
  } catch (e) {
    if (e instanceof EnvioError) return resposta(e.status, { erros: e.erros });
    throw e;
  }
}
```

Criar `src/app/api/p/exames/[id]/pdf/route.ts`:

```ts
import { requireApiPaciente } from '@/lib/paciente-session';
import { signFileUrl } from '@/lib/signed-url';
import { pdfDoMeuEnvio } from '@/modules/portal/exames-enviados';

export const dynamic = 'force-dynamic';

const naoEncontrado = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

/**
 * US-161 / D17 = a: o próprio PDF limpo enquanto o envio aguarda a revisão. A leitura é auditada no módulo (D22) e a URL
 * assinada (5 min) nasce no clique, nunca no HTML guardado (como /api/p/documentos/[id]/pdf).
 */
export async function GET(req: Request, { params }: RouteContext<'/api/p/exames/[id]/pdf'>): Promise<Response> {
  const acesso = await requireApiPaciente(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  const caminho = await pdfDoMeuEnvio(acesso.ctx, id);
  if (!caminho) return naoEncontrado();
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), 'cache-control': 'no-store' } });
}
```

- [ ] **Step 3: Rodar e commitar**

Run: `pnpm vitest run src/app/api/p/exames src/app/api/mesma-origem-rotas.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS (a guarda de origem varre a rota nova e acha o 403 antes da sessão).

```bash
git add src/app/api/p/exames
git commit -m "feat(exames-enviados): rotas do portal — envio multipart com vagas e prazo, e download do próprio PDF (P12-05)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 6: O job do worker — fotos e PDF viram páginas e um PDF limpo; aviso agrupado à nutricionista (P12-06)

**Revisão: completa (agente revisor-rls)** — o worker trata o arquivo não confiável do paciente, grava com as travas na ordem, falha sem perder cota, e o e-mail não leva dado de saúde (C-05, RNF-166).

**Files:**
- Create: `src/modules/pacientes/exames-enviados-job.tsx` (+ `exames-enviados-job.test.ts`), `src/modules/pacientes/exames-enviados-aviso.ts`
- Modify: `src/email/types.ts` (tipo `exames_recebidos`), `src/email/templates.tsx` (o e-mail), `src/worker/index.ts` (fila `exame-envio`)

**Interfaces:**
- Consumes: T1 (tabelas), T2 (`apagarArquivosDoEnvio`, `fotoParaJpeg`, `FotoInvalidaError`, `AbrirHeic`, `paraJpegSemMetadados`, constantes), T3 (`rasterizarPdf`, `RasterizacaoError`), T4 (`enviarExame` nos testes); `salvarArquivo`, `resolverCaminho`, `CotaEsgotadaError`, `avisarNutri`, `urlDoApp`, `@react-pdf/renderer` (`Document`, `Page`, `Image`, `renderToBuffer`).
- Produces: `DadosEnvio`, `DepsProcessar`, `renderizarPdfLimpo`, `processarEnvio` (contratos no topo); `avisarExamesRecebidos`; `EmailMessage` `{ tipo: 'exames_recebidos'; para; link; pendentesAntigos }`.

- [ ] **Step 1: Escrever o teste do job (falha: o módulo não existe)**

Criar `src/modules/pacientes/exames-enviados-job.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco, jpegDe, ligarExames, pdfComConteudoAtivo } from '../../../test/exames-enviados';
import { pdfDeTeste } from '../../../test/ia';
import { paginasDoPdf, textoDoPdf } from '../../../test/pdf';
import { closeDb } from '@/db/client';
import { examSubmissionFiles, examSubmissions, patients, storedFiles, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { renderEmail } from '@/email/templates';
import { stopBoss } from '@/jobs/boss';
import { COTA_BYTES, resolverCaminho } from '@/modules/plataforma/armazenamento';
import type { AbrirHeic } from '@/modules/portal/diario-foto-job';
import { enviarExame } from '@/modules/portal/exames-enviados';
import { MSG_REVISAO } from './exames-enviados-constantes';
import { processarEnvio, renderizarPdfLimpo, type DepsProcessar } from './exames-enviados-job';
import { RasterizacaoError } from './rasterizar-pdf';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-job-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const SP = { fuso: 'America/Sao_Paulo' };
const APP_URL = 'https://app.exemplo.com';
const deps = (o: Partial<DepsProcessar> = {}): DepsProcessar => ({ db: app.db, dataDir, appUrl: APP_URL, ultimaTentativa: false, ...o });
/** Passa no detectarTipo como HEIC; os pixels vêm do `abrirHeic` simulado (como no teste do diário). */
const HEIC_FALSO = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(64)]);
const heicDe = (largura: number, altura: number): AbrirHeic => async () => ({
  width: largura,
  height: altura,
  decode: async () => ({ data: new Uint8ClampedArray(largura * altura * 4).fill(180) }),
});
const emailDaNutri = async (nutriId: string) => (await app.db.select({ email: user.email }).from(user).where(eq(user.id, nutriId)))[0].email;
const arquivo = (caminho: string) => readFileSync(resolverCaminho(dataDir, caminho));

async function enviado(arquivos: Buffer[]) {
  const T = await novoTenant(app.db);
  await ligarExames(app.db, T.tenantId);
  const p = await novoPaciente(app.db, T.ctx);
  const bytes = async () => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, T.tenantId)))[0].b;
  const inicial = await bytes();
  const { id } = await enviarExame(ctxPaciente(T.tenantId, p.id), SP, { dataColeta: '2026-09-28', nome: 'Hemograma', observacao: '', arquivos }, { db: app.db, dataDir });
  const ler = async () => (await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db))[0];
  const linhas = () =>
    withTenant(T.ctx, (tx) => tx.select().from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, id)).orderBy(asc(examSubmissionFiles.papel), asc(examSubmissionFiles.ordem)), app.db);
  return { T, p, id, dados: { tenantId: T.tenantId, envioId: id }, ler, linhas, bytes, inicial };
}

describe('job exame-envio (RN-163, D23 = a)', () => {
  it('US-160 "Enviar um PDF": cada página rasterizada (JPEG ≤ 2000 px, sem EXIF), PDF limpo do tipo exame, original apagado, "recebido" e e-mail', async () => {
    const e = await enviado([await pdfDeTeste({ paginas: 3, textos: ['Glicose 92 mg/dL', 'Colesterol 180 mg/dL', 'Ferritina 50 ng/mL'] })]);
    const [original] = await e.linhas();
    expect(await processarEnvio(e.dados, deps())).toBe('recebido');
    const envio = await e.ler();
    expect(envio).toMatchObject({ status: 'recebido', motivoFalha: null });
    const pdf = arquivo(envio.arquivoPath!);
    expect(paginasDoPdf(pdf)).toBe(3);
    for (const t of ['Glicose', 'Colesterol', 'Ferritina']) expect(textoDoPdf(pdf)).not.toContain(t);
    const linhas = await e.linhas();
    expect(linhas.map((l) => [l.papel, l.ordem])).toEqual([['pagina', 1], ['pagina', 2], ['pagina', 3]]);
    for (const l of linhas) {
      const m = await sharp(arquivo(l.arquivoPath)).metadata();
      expect(m.format).toBe('jpeg');
      expect(Math.max(m.width!, m.height!)).toBe(2000);
      expect(m.exif).toBeUndefined();
    }
    expect(existsSync(resolverCaminho(dataDir, original.arquivoPath))).toBe(false);
    const [f] = await withTenant(e.T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, envio.arquivoPath!)), app.db);
    expect(f).toMatchObject({ tipo: 'exame', patientId: e.p.id, mime: 'application/pdf' });
    const para = await emailDaNutri(e.T.nutriId);
    expect(await emailsNaFila('exames_recebidos', para)).toEqual([{ tipo: 'exames_recebidos', para, link: `${APP_URL}/painel/exames-recebidos`, pendentesAntigos: false }]);
  }, 120_000);

  it('R-170: PDF com JavaScript, link e anexo → o PDF limpo não tem nada disso, nem o texto do original', async () => {
    const e = await enviado([await pdfComConteudoAtivo()]);
    expect(await processarEnvio(e.dados, deps())).toBe('recebido');
    const pdf = arquivo((await e.ler()).arquivoPath!);
    const bruto = pdf.toString('latin1');
    for (const proibido of ['/JavaScript', '/URI', '/EmbeddedFile', '/OpenAction', '/Annots', 'exemplo.invalid', 'conteudo escondido']) expect(bruto, proibido).not.toContain(proibido);
    expect(textoDoPdf(pdf)).not.toContain('Glicose');
  }, 60_000);

  it('US-160 "Enviar fotos": JPEG girado com EXIF, PNG transparente e HEIC → páginas em pé, sem EXIF, fundo branco, ≤ 2000 px, na ordem', async () => {
    const girada = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#335577' } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'marca-gps' } } })
      .toBuffer();
    const png = await sharp({ create: { width: 1200, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const e = await enviado([girada, png, HEIC_FALSO]);
    expect(await processarEnvio(e.dados, deps({ abrirHeic: heicDe(1500, 2000) }))).toBe('recebido');
    const linhas = await e.linhas();
    const dims = await Promise.all(linhas.map(async (l) => {
      const m = await sharp(arquivo(l.arquivoPath)).metadata();
      return [m.width, m.height, m.exif === undefined];
    }));
    expect(dims).toEqual([[1500, 2000, true], [1200, 800, true], [1500, 2000, true]]);
    const { data } = await sharp(arquivo(linhas[1].arquivoPath)).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240); // transparente vira branco (não preto)
    for (const l of linhas) expect(arquivo(l.arquivoPath).includes('marca-gps')).toBe(false);
    expect(paginasDoPdf(arquivo((await e.ler()).arquivoPath!))).toBe(3);
  }, 60_000);

  it('US-160 "PDF longo": 11 páginas → "falhou" (paginas); arquivos apagados e a cota volta ao que era antes do envio', async () => {
    const e = await enviado([await pdfDeTeste({ paginas: 11 })]);
    expect(await processarEnvio(e.dados, deps())).toBe('falhou');
    expect(await e.ler()).toMatchObject({ status: 'falhou', motivoFalha: 'paginas', arquivoPath: null });
    expect(await e.linhas()).toEqual([]);
    expect(await e.bytes()).toBe(e.inicial);
  }, 60_000);

  it('US-160 "Falha na conversão": foto que não decodifica e HEIC acima de 40 MP → "falhou" (conversao), tudo apagado', async () => {
    const inteira = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#888888' } }).jpeg().toBuffer();
    const quebrada = await enviado([inteira.subarray(0, Math.floor(inteira.length / 2))]);
    expect(await processarEnvio(quebrada.dados, deps())).toBe('falhou');
    expect(await quebrada.ler()).toMatchObject({ status: 'falhou', motivoFalha: 'conversao' });
    expect(await quebrada.bytes()).toBe(quebrada.inicial);
    const heic = await enviado([HEIC_FALSO]);
    expect(await processarEnvio(heic.dados, deps({ abrirHeic: heicDe(8064, 6048) }))).toBe('falhou'); // iPhone "HEIF Max", 48 MP
    expect(await heic.ler()).toMatchObject({ status: 'falhou', motivoFalha: 'conversao' });
    expect(await heic.linhas()).toEqual([]);
  }, 60_000);

  it('US-160 "Espaço esgotado durante o processamento": "falhou" (cota), arquivos apagados e o espaço do original devolvido', async () => {
    const e = await enviado([await pdfDeTeste({ paginas: 2 })]);
    const [original] = await e.linhas();
    const [sf] = await withTenant(e.T.ctx, (tx) => tx.select({ bytes: storedFiles.bytes }).from(storedFiles).where(eq(storedFiles.caminho, original.arquivoPath)), app.db);
    await app.db.update(tenants).set({ armazenamentoBytes: COTA_BYTES - 100 }).where(eq(tenants.id, e.T.tenantId));
    expect(await processarEnvio(e.dados, deps())).toBe('falhou');
    expect(await e.ler()).toMatchObject({ status: 'falhou', motivoFalha: 'cota' });
    expect(await e.linhas()).toEqual([]);
    expect(await e.bytes()).toBe(COTA_BYTES - 100 - sf.bytes);
  }, 60_000);

  it('idempotente: depois de "recebido" não refaz nada; "recebido" com original que sobrou → só apaga o original', async () => {
    const e = await enviado([await jpegDe(2000)]);
    expect(await processarEnvio(e.dados, deps())).toBe('recebido');
    const depois = await e.linhas();
    const pdf = (await e.ler()).arquivoPath;
    expect(await processarEnvio(e.dados, deps())).toBe('ignorado');
    expect(await e.linhas()).toEqual(depois);
    expect((await e.ler()).arquivoPath).toBe(pdf);
    // a queda entre gravar o PDF limpo e apagar o original deixa o original apontado num envio "recebido"
    const original = await arquivoDeEnvio(app.db, e.T.ctx, e.p.id, 'exame_original', dataDir);
    await withTenant(e.T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: e.T.tenantId, patientId: e.p.id, submissionId: e.id, arquivoPath: original, papel: 'original', ordem: 1 }), app.db);
    expect(await processarEnvio(e.dados, deps())).toBe('ignorado');
    expect((await e.linhas()).map((l) => l.papel)).toEqual(['pagina']);
    expect(existsSync(resolverCaminho(dataDir, original))).toBe(false);
  }, 60_000);

  it('D12: a nova tentativa de um envio que caiu depois de gravar páginas refaz as páginas (as antigas saem)', async () => {
    const e = await enviado([await pdfDeTeste({ paginas: 2 })]);
    const velha = await arquivoDeEnvio(app.db, e.T.ctx, e.p.id, 'exame_pagina', dataDir);
    await withTenant(e.T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: e.T.tenantId, patientId: e.p.id, submissionId: e.id, arquivoPath: velha, papel: 'pagina', ordem: 1 }), app.db);
    expect(await processarEnvio(e.dados, deps())).toBe('recebido');
    expect(existsSync(resolverCaminho(dataDir, velha))).toBe(false);
    expect((await e.linhas()).filter((l) => l.papel === 'pagina')).toHaveLength(2);
  }, 60_000);

  it('RN-163 / §13.3: titular bloqueado → "ignorado", nada gravado (a exclusão atendida apaga os arquivos)', async () => {
    const e = await enviado([await jpegDe(2000)]);
    await withTenant(e.T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, e.p.id)), app.db);
    expect(await processarEnvio(e.dados, deps())).toBe('ignorado');
    expect(await e.ler()).toMatchObject({ status: 'processando', arquivoPath: null });
    expect((await e.linhas()).map((l) => l.papel)).toEqual(['original']);
  });

  it('erro de infraestrutura relança (o pg-boss tenta de novo); na última tentativa, "falhou"; recusa da rasterização falha na hora', async () => {
    const e = await enviado([await pdfDeTeste({ paginas: 1 })]);
    const quebra = async (): Promise<never> => {
      throw new Error('ECONNRESET');
    };
    await expect(processarEnvio(e.dados, deps({ rasterizar: quebra }))).rejects.toThrow('ECONNRESET');
    expect((await e.ler()).status).toBe('processando');
    expect(await processarEnvio(e.dados, deps({ rasterizar: quebra, ultimaTentativa: true }))).toBe('falhou');
    expect(await e.ler()).toMatchObject({ status: 'falhou', motivoFalha: 'conversao' });
    const r = await enviado([await pdfDeTeste({ paginas: 1 })]);
    const recusa = async (): Promise<never> => {
      throw new RasterizacaoError('conversao');
    };
    expect(await processarEnvio(r.dados, deps({ rasterizar: recusa }))).toBe('falhou'); // definitiva: sem nova tentativa
  });

  it('D16 = a: no máximo 1 e-mail a cada 6 h por consultório; com envio aguardando há mais de 30 dias, a frase do lembrete vai junto', async () => {
    const T = await novoTenant(app.db);
    await ligarExames(app.db, T.tenantId);
    const p = await novoPaciente(app.db, T.ctx);
    const para = await emailDaNutri(T.nutriId);
    const agora = new Date();
    const enviarE = async () =>
      (await enviarExame(ctxPaciente(T.tenantId, p.id), SP, { dataColeta: '2026-09-28', nome: '', observacao: '', arquivos: [await jpegDe(2000)] }, { db: app.db, dataDir })).id;
    const processar = async (horas: number) => processarEnvio({ tenantId: T.tenantId, envioId: await enviarE() }, deps({ agora: () => new Date(agora.getTime() + horas * 3600_000) }));
    await processar(0);
    await processar(1);
    expect(await emailsNaFila('exames_recebidos', para)).toHaveLength(1);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido', createdAt: new Date(agora.getTime() - 31 * 86_400_000) });
    await processar(7);
    expect((await emailsNaFila('exames_recebidos', para)).map((m) => m.pendentesAntigos)).toEqual([false, true]);
  }, 60_000);
});

describe('PDF limpo e e-mail (RNF-166)', () => {
  it('renderizarPdfLimpo: uma página por imagem, na ordem, sem metadado do paciente', async () => {
    const j = await sharp({ create: { width: 100, height: 140, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
    const pdf = await renderizarPdfLimpo([j, j]);
    expect(paginasDoPdf(pdf)).toBe(2);
    expect(pdf.toString('latin1')).not.toMatch(/Hemograma|Ana Souza/);
  });

  it('o e-mail "exames recebidos" não leva nome de paciente, nome de exame nem arquivo; a frase dos 30 dias só quando há pendente antigo', () => {
    const sem = renderEmail({ tipo: 'exames_recebidos', para: 'n@x.dev', link: `${APP_URL}/painel/exames-recebidos`, pendentesAntigos: false });
    const com = renderEmail({ tipo: 'exames_recebidos', para: 'n@x.dev', link: `${APP_URL}/painel/exames-recebidos`, pendentesAntigos: true });
    expect(sem.text).toContain(MSG_REVISAO.avisoEmail);
    expect(sem.text).not.toContain(MSG_REVISAO.lembrete30);
    expect(com.text).toContain(MSG_REVISAO.lembrete30);
    expect(sem.subject).toBe('Exames enviados por pacientes');
    for (const proibido of ['Hemograma', 'Ana', '.pdf', '.jpg']) expect(`${sem.subject} ${sem.text} ${com.text}`).not.toContain(proibido);
  });
});
```

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-job.test.ts`
Expected: FAIL (`./exames-enviados-job` não existe).

- [ ] **Step 2: O e-mail**

Em `src/email/types.ts`, acrescentar ao fim da união `EmailMessage` (antes do `;`):

```ts
  /**
   * Plano 12 (RN-168, D16 = a): exames novos enviados por pacientes, às nutricionistas do tenant (no máximo 1 a cada 6 h);
   * `pendentesAntigos` = há envio aguardando há mais de 30 dias (US-165). Sem nome de paciente, de exame nem arquivo (C-05).
   */
  | { tipo: 'exames_recebidos'; para: string; link: string; pendentesAntigos: boolean }
```

Em `src/email/templates.tsx`, importar `import { MSG_REVISAO } from '@/modules/pacientes/exames-enviados-constantes';` e acrescentar o caso antes do `default`:

```tsx
    case 'exames_recebidos':
      // RN-168 / C-05: genérico — nem paciente, nem exame, nem arquivo
      return simples(
        'Exames enviados por pacientes',
        [MSG_REVISAO.avisoEmail, ...(msg.pendentesAntigos ? [MSG_REVISAO.lembrete30] : [])],
        { href: msg.link, rotulo: 'Ver exames recebidos' },
      );
```

- [ ] **Step 3: O aviso agrupado**

Criar `src/modules/pacientes/exames-enviados-aviso.ts`:

```ts
import { and, eq, lt } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { examSubmissions, tenants } from '@/db/schema';
import { urlDoApp } from '@/lib/url-do-app';
import { avisarNutri } from '@/modules/agenda/aviso-nutri';
import { AVISO_EXAMES_INTERVALO_MS, ENVIO_LEMBRETE_DIAS } from './exames-enviados-constantes';

/**
 * RN-168 (D16 = a) e US-165: e-mail genérico às nutricionistas do tenant quando um envio chega a "recebido" — no máximo 1 a
 * cada 6 h por tenant (`tenants.exames_aviso_em`, conferido e gravado com a linha do tenant travada; na transação do "recebido"
 * ela já está travada pela reserva de cota, D10). Leva a frase dos 30 dias quando há envio aguardando há mais que isso (PM-12:
 * o lembrete só sai junto de um aviso). Nada do paciente, do exame ou do arquivo (C-05). Devolve se avisou.
 */
export async function avisarExamesRecebidos(tx: Tx, o: { tenantId: string; agora: Date; appUrl: string }): Promise<boolean> {
  const [t] = await tx.select({ ultimo: tenants.examesAvisoEm }).from(tenants).where(eq(tenants.id, o.tenantId)).for('update');
  if (!t || (t.ultimo && o.agora.getTime() - t.ultimo.getTime() < AVISO_EXAMES_INTERVALO_MS)) return false;
  await tx.update(tenants).set({ examesAvisoEm: o.agora }).where(eq(tenants.id, o.tenantId));
  const [antigo] = await tx
    .select({ id: examSubmissions.id })
    .from(examSubmissions)
    .where(and(eq(examSubmissions.status, 'recebido'), lt(examSubmissions.createdAt, new Date(o.agora.getTime() - ENVIO_LEMBRETE_DIAS * 86_400_000))))
    .limit(1);
  const link = urlDoApp(o.appUrl, '/painel/exames-recebidos');
  await avisarNutri(tx, o.tenantId, (para) => ({ tipo: 'exames_recebidos', para, link, pendentesAntigos: !!antigo }));
  return true;
}
```

- [ ] **Step 4: O job**

Criar `src/modules/pacientes/exames-enviados-job.tsx`:

```tsx
import { readFile } from 'node:fs/promises';
import { Document, Image, Page, renderToBuffer } from '@react-pdf/renderer';
import { and, asc, eq } from 'drizzle-orm';
import sharp from 'sharp';
import type { Db, Tx } from '@/db/client';
import { examSubmissionFiles, examSubmissions, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { paraJpegSemMetadados } from '@/lib/jpeg';
import { logger } from '@/lib/logger';
import { CotaEsgotadaError, resolverCaminho, salvarArquivo } from '@/modules/plataforma/armazenamento';
import { fotoParaJpeg, FotoInvalidaError, type AbrirHeic } from '@/modules/portal/diario-foto-job';
import { apagarArquivosDoEnvio } from './exames-enviados-arquivos';
import { avisarExamesRecebidos } from './exames-enviados-aviso';
import { ENVIO_LADO_MAX, ENVIO_MAX_PAGINAS, ENVIO_QUALIDADE_JPEG, MAX_PIXELS_IMAGEM_PDF, type MotivoFalhaEnvio } from './exames-enviados-constantes';
import { RasterizacaoError, rasterizarPdf } from './rasterizar-pdf';

// Só o worker importa este arquivo (@react-pdf, sharp, heic-decode, a rasterização): guarda em exames-enviados-guardas.test.ts.

export type DadosEnvio = { tenantId: string; envioId: string };
export type DepsProcessar = {
  db: Db;
  dataDir: string;
  appUrl: string;
  ultimaTentativa: boolean;
  agora?: () => Date;
  abrirHeic?: AbrirHeic;
  rasterizar?: typeof rasterizarPdf;
  renderizar?: typeof renderizarPdfLimpo;
};

/** D23 = a: o PDF LIMPO — só as imagens de página, uma por página A4, na ordem; nada do original (R-170). */
export async function renderizarPdfLimpo(paginas: readonly Buffer[]): Promise<Buffer> {
  return renderToBuffer(
    <Document title="Exame" creator="NutriDebby" producer="NutriDebby">
      {paginas.map((p, i) => (
        <Page key={i} size="A4" style={{ padding: 24 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- o Image do @react-pdf não é <img> */}
          <Image src={{ data: p, format: 'jpg' }} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </Page>
      ))}
    </Document>,
  );
}

class TitularComExclusaoError extends Error {}
class EnvioMudouError extends Error {}

/**
 * Ordem de travas de salvarArquivo: dono (paciente) → registro (envio) → tenant (cota). O paciente vem primeiro porque o INSERT
 * em stored_files pede KEY SHARE nele (FK) — a mesma ordem do diário. Desiste se a exclusão chegou ou o envio mudou.
 */
async function travarParaGravar(tx: Tx, patientId: string, envioId: string): Promise<void> {
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, patientId)).for('update');
  if (!p || p.status === 'bloqueado' || p.anonimizadoEm) throw new TitularComExclusaoError();
  const [e] = await tx.select({ id: examSubmissions.id }).from(examSubmissions).where(and(eq(examSubmissions.id, envioId), eq(examSubmissions.status, 'processando'))).for('update');
  if (!e) throw new EnvioMudouError();
}

/**
 * Job `exame-envio` (RN-163, D23 = a). Idempotente:
 * - "processando": cada foto vira JPEG (sem EXIF/GPS, orientação aplicada, ≤ 2000 px, qualidade 85) e o PDF é RASTERIZADO
 *   página a página no processo filho (rasterizar-pdf.ts); o PDF limpo é montado só com essas imagens. Cada imagem de página
 *   entra no SEU salvarArquivo (tipo `exame_pagina`, linha "pagina" no `registrar`) e por último o PDF limpo (tipo `exame`;
 *   `registrar` = envio "recebido" com o `arquivo_path` + o aviso à nutricionista, D10); depois os originais saem por
 *   apagarArquivosDoEnvio. Páginas de uma tentativa anterior que caiu no meio saem antes (D12, `refazer`).
 * - "recebido" com original que sobrou (queda entre gravar o PDF e apagar o original): só apaga o original.
 * - Titular bloqueado ou anonimizado: "ignorado" — os arquivos saem pela rotina da exclusão (§13.3).
 * Falha de conversão, PDF com mais de 10 páginas ou cota esgotada → "falhou" na hora (definitivo; motivo_falha) e todos os
 * arquivos do envio saem (cota devolvida). Erro de infraestrutura → relança (o pg-boss tenta de novo; o worker limpa o
 * detalhe, RNF-11); na última tentativa, "falhou" (conversao). Log só com ids e o motivo.
 */
export async function processarEnvio(data: DadosEnvio, deps: DepsProcessar): Promise<'recebido' | 'falhou' | 'ignorado'> {
  const ctx: TenantContext = { tenantId: data.tenantId, role: 'worker' };
  const arquivos = { db: deps.db, dataDir: deps.dataDir };
  const lido = await withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx.select().from(examSubmissions).where(eq(examSubmissions.id, data.envioId));
      if (!e) return null;
      const linhas = await tx.select().from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, e.id)).orderBy(asc(examSubmissionFiles.papel), asc(examSubmissionFiles.ordem));
      const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, e.patientId));
      return { e, linhas, titularFora: !p || p.status === 'bloqueado' || !!p.anonimizadoEm };
    },
    deps.db,
  );
  if (!lido) return 'ignorado';
  const { e, linhas } = lido;
  const originais = linhas.filter((l) => l.papel === 'original');
  if (e.status === 'recebido') {
    if (originais.length) await apagarArquivosDoEnvio(ctx, e.id, { ...arquivos, papel: 'original' });
    return 'ignorado';
  }
  if (e.status !== 'processando' || lido.titularFora) return 'ignorado';
  const falhar = async (motivo: MotivoFalhaEnvio): Promise<'falhou'> => {
    logger.warn({ tenantId: data.tenantId, envioId: data.envioId, motivo }, 'exame enviado não processado');
    await withTenant(
      ctx,
      (tx) => tx.update(examSubmissions).set({ status: 'falhou', motivoFalha: motivo, updatedAt: new Date() }).where(and(eq(examSubmissions.id, e.id), eq(examSubmissions.status, 'processando'))),
      deps.db,
    );
    await apagarArquivosDoEnvio(ctx, e.id, arquivos);
    return 'falhou';
  };
  if (linhas.some((l) => l.papel === 'pagina')) await apagarArquivosDoEnvio(ctx, e.id, { ...arquivos, papel: 'pagina', refazer: true });
  try {
    const jpegs: Buffer[] = [];
    for (const o of originais) {
      const buf = await readFile(resolverCaminho(deps.dataDir, o.arquivoPath));
      const ext = o.arquivoPath.slice(o.arquivoPath.lastIndexOf('.') + 1);
      if (ext === 'pdf') {
        await (deps.rasterizar ?? rasterizarPdf)(buf, { limitePaginas: ENVIO_MAX_PAGINAS, ladoMax: ENVIO_LADO_MAX, maxPixelsImagem: MAX_PIXELS_IMAGEM_PDF }, async (p) => {
          // uma página por vez (RNF-162): os pixels saem da memória assim que viram JPEG
          jpegs.push(await paraJpegSemMetadados(sharp(p.rgba, { raw: { width: p.largura, height: p.altura, channels: 4 } }), ENVIO_LADO_MAX, ENVIO_QUALIDADE_JPEG));
        });
      } else {
        jpegs.push(await fotoParaJpeg(buf, ext, { ladoMax: ENVIO_LADO_MAX, qualidade: ENVIO_QUALIDADE_JPEG, abrirHeic: deps.abrirHeic }));
      }
    }
    if (!jpegs.length) return falhar('conversao');
    const pdf = await (deps.renderizar ?? renderizarPdfLimpo)(jpegs);
    for (let i = 0; i < jpegs.length; i++) {
      await salvarArquivo(
        ctx,
        {
          tipo: 'exame_pagina',
          conteudo: jpegs[i],
          permitidos: ['jpg'],
          patientId: e.patientId,
          antesDaReserva: (tx) => travarParaGravar(tx, e.patientId, e.id),
          registrar: async (tx, a) => {
            await tx.insert(examSubmissionFiles).values({ tenantId: data.tenantId, patientId: e.patientId, submissionId: e.id, arquivoPath: a.caminho, papel: 'pagina', ordem: i + 1 });
          },
        },
        arquivos,
      );
    }
    const agora = deps.agora?.() ?? new Date();
    await salvarArquivo(
      ctx,
      {
        tipo: 'exame',
        conteudo: pdf,
        permitidos: ['pdf'],
        patientId: e.patientId,
        antesDaReserva: (tx) => travarParaGravar(tx, e.patientId, e.id),
        registrar: async (tx, a) => {
          await tx.update(examSubmissions).set({ status: 'recebido', arquivoPath: a.caminho, updatedAt: agora }).where(eq(examSubmissions.id, e.id));
          await avisarExamesRecebidos(tx, { tenantId: data.tenantId, agora, appUrl: deps.appUrl });
        },
      },
      arquivos,
    );
  } catch (err) {
    if (err instanceof TitularComExclusaoError || err instanceof EnvioMudouError) {
      logger.warn({ tenantId: data.tenantId, envioId: data.envioId, motivo: err instanceof EnvioMudouError ? 'envio_mudou' : 'exclusao' }, 'exame enviado não processado');
      return 'ignorado';
    }
    if (err instanceof RasterizacaoError) return falhar(err.motivo);
    if (err instanceof FotoInvalidaError) return falhar('conversao');
    if (err instanceof CotaEsgotadaError) return falhar('cota');
    logger.warn({ tenantId: data.tenantId, envioId: data.envioId, motivo: 'erro', definitivo: deps.ultimaTentativa }, 'falha ao processar o exame enviado');
    if (!deps.ultimaTentativa) throw err;
    return falhar('conversao');
  }
  // o envio já está "recebido": os originais saem; uma falha aqui fica para a próxima tentativa ou para a varredura
  await apagarArquivosDoEnvio(ctx, e.id, { ...arquivos, papel: 'original' }).catch((err: unknown) =>
    logger.warn({ tenantId: data.tenantId, envioId: data.envioId, motivo: 'original', err: err instanceof Error ? err.name : 'erro' }, 'original do exame enviado não apagado'),
  );
  return 'recebido';
}
```

- [ ] **Step 5: Registrar a fila no worker**

Em `src/worker/index.ts`, importar `import { processarEnvio, type DadosEnvio } from '@/modules/pacientes/exames-enviados-job';` e, depois do bloco da fila `ia`/`expirar-ia`:

```ts
  // Plano 12 (RN-163, D23 = a): envio de exame do paciente — fotos convertidas, PDF rasterizado num processo filho (sem
  // ambiente, teto de memória vigiado), PDF limpo, páginas e o aviso agrupado. Um por vez (padrão do boss.work, RNF-162).
  await work('exame-envio', { includeMetadata: true }, async ([job]: JobWithMetadata<DadosEnvio>[]) => {
    await processarEnvio(job.data, { db: getDb(), dataDir: env.DATA_DIR, appUrl: env.APP_URL, ultimaTentativa: job.retryCount >= job.retryLimit });
  });
```

- [ ] **Step 6: Rodar e commitar**

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-job.test.ts src/modules/pacientes/exames-enviados-guardas.test.ts src/email src/modules/pacientes/exportacao.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS (a guarda de grafo agora protege o `exames-enviados-job.tsx`; a do `exportacao.test.ts` continua: o `@react-pdf` segue fora do grafo do Next).

```bash
git add src/modules/pacientes/exames-enviados-job.tsx src/modules/pacientes/exames-enviados-job.test.ts src/modules/pacientes/exames-enviados-aviso.ts \
  src/email/types.ts src/email/templates.tsx src/worker/index.ts
git commit -m "feat(exames-enviados): job do worker — páginas e PDF limpo só com imagens, falhas com a cota devolvida e aviso agrupado (P12-06)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 7: Revisão pela nutricionista — fila, abrir (auditado), aceitar (vira exame, um dono só), recusar e o push neutro (P12-07)

**Revisão: completa (agente normas-cfn-lgpd)** — o que entra no prontuário e com que trilha (SBIS NGS1, ECF.17.01), minimização na recusa (D20 = a), push sem dado de saúde (C-05).

**Files:**
- Create: `src/modules/pacientes/exames-enviados.ts` (+ `exames-enviados.test.ts`)
- Modify: `src/modules/portal/avisos.ts` (`avisarEnvioAtualizado`), `src/modules/notificacoes/mensagens.ts` (`AVISOS_DO_PORTAL`) (+ `mensagens.test.ts`)

**Interfaces:**
- Consumes: T1, T2 (`apagarArquivosDoEnvio`, constantes, `MSG_REVISAO`); `carregarPacienteParaEscrita`, `idValido`, `PacienteBloqueadoError` (`base.ts`); `dataValida`, `hojeNoFuso`; `MSG_EXAME`; `normalizarTexto`; `apagarArquivo`; `auditRead`; `dispararEnvio` (`src/modules/notificacoes/agendar.ts`); `notifications`.
- Produces: `RevisaoError`, `EnvioNaFila`, `EnvioAberto` (`{ id; paciente: PatientRow; status; enviadoEm; dataColeta; nome; observacao; pdf; paginas: string[] }`), `filaDeEnvios`, `contarEnviosRecebidos`, `contarEnviosDoPaciente`, `examesEnviadosPeloPaciente`, `abrirEnvio`, `aceitarEnvio`, `recusarEnvio`, `avisarEnvioAtualizado`; os avisos `exame_revisado` e `exame_expirado` do portal.

- [ ] **Step 1: O push neutro — teste (falha) e implementação**

Em `src/modules/notificacoes/mensagens.test.ts`, dentro do `describe` do push, acrescentar:

```ts
  it('Plano 12 (C-05): exame revisado e expirado — o mesmo texto neutro, sem "exame"; o toque abre /p/exames do consultório', () => {
    const semConsulta = (tipo: string): ContextoEnvio => ({ ...ctx(tipo), consulta: null });
    for (const tipo of ['exame_revisado', 'exame_expirado']) {
      const p = pushDaNotificacao(semConsulta(tipo), deps)!;
      expect(p).toEqual({ titulo: 'NutriDebby', corpo: 'Há uma atualização para você no app.', url: `https://app.exemplo.com/p/exames?v=${tenant.id}` });
      expect(p.corpo.toLowerCase()).not.toContain('exame');
      for (const dado of ['Ana', 'Souza', 'Debby', 'Silva']) expect(p.corpo, dado).not.toContain(dado);
    }
  });
```

Run: `pnpm vitest run src/modules/notificacoes/mensagens.test.ts`
Expected: FAIL (`pushDaNotificacao` devolve null para os tipos novos).

Em `src/modules/notificacoes/mensagens.ts`, em `AVISOS_DO_PORTAL`, acrescentar:

```ts
  // Plano 12 (C-05): neutro de propósito, mais que os outros — nem "exame" (a palavra na tela de bloqueio já diz dado de saúde)
  exame_revisado: { corpo: 'Há uma atualização para você no app.', tela: '/p/exames' },
  exame_expirado: { corpo: 'Há uma atualização para você no app.', tela: '/p/exames' },
```

Em `src/modules/portal/avisos.ts`, acrescentar:

```ts
/**
 * Plano 12 (US-163/US-164/US-165, INT-03, C-05): exame enviado revisado (aceito ou recusado) ou expirado — o push neutro "Há
 * uma atualização para você no app.", na transação do evento. O motor decide a entrega (paciente ativo, com conta e push
 * ativo — senão "ignorada"); o detalhe aparece só dentro do PWA, em /p/exames.
 */
export async function avisarEnvioAtualizado(tx: Tx, o: { tenantId: string; patientId: string; tipo: 'exame_revisado' | 'exame_expirado' }, agora: Date): Promise<void> {
  await tx.insert(notifications).values({ tenantId: o.tenantId, patientId: o.patientId, canal: 'push', tipo: o.tipo, agendadaPara: agora });
  await dispararEnvio(tx, o.tenantId);
}
```

Run: `pnpm vitest run src/modules/notificacoes/mensagens.test.ts`
Expected: PASS.

- [ ] **Step 2: Teste da revisão (falha: o módulo não existe)**

Criar `src/modules/pacientes/exames-enviados.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { envioNoBanco, envioRecebido, JPEG_MINIMO } from '../../../test/exames-enviados';
import { closeDb } from '@/db/client';
import { auditLog, examSubmissions, exams, notifications, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';
import { PacienteBloqueadoError } from './base';
import { MSG_EXAME } from './exames-constantes';
import { MSG_REVISAO } from './exames-enviados-constantes';
import { abrirEnvio, aceitarEnvio, contarEnviosDoPaciente, contarEnviosRecebidos, examesEnviadosPeloPaciente, filaDeEnvios, recusarEnvio, RevisaoError } from './exames-enviados';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-revisao-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const SP = { fuso: 'America/Sao_Paulo' };
const deps = { db: app.db, dataDir };
const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof RevisaoError) return e.erros;
    throw e;
  }
  throw new Error('esperava RevisaoError');
};
async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const bytes = async () => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, T.tenantId)))[0].b;
  const ler = async (id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db))[0];
  const pushes = () => withTenant(T.ctx, (tx) => tx.select({ tipo: notifications.tipo, canal: notifications.canal }).from(notifications).where(eq(notifications.patientId, p.id)), app.db);
  return { T, p, bytes, ler, pushes };
}
const aceitar = { titulo: 'Hemograma', data: '2026-09-28' };

describe('revisão do exame enviado (US-162 a US-164, RN-164, RN-165, §6.5)', () => {
  it('US-163 "Aceitar": exame com o PDF limpo (sem cópia), envio "aceito" com quem e quando, páginas apagadas, push neutro e trilha', async () => {
    const { T, p, bytes, ler, pushes } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir, { paginas: 2 });
    const antes = await bytes();
    const { examId, patientId } = await aceitarEnvio(T.ctx, SP, e.id, aceitar, deps);
    expect(patientId).toBe(p.id);
    const [ex] = await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, examId)), app.db);
    expect(ex).toMatchObject({ patientId: p.id, titulo: 'Hemograma', data: '2026-09-28', arquivoPath: e.pdf, valores: [] });
    const envio = await ler(e.id);
    expect(envio).toMatchObject({ status: 'aceito', examId, revisadoPor: T.nutriId, arquivoPath: null });
    expect(envio.revisadoEm).toBeInstanceOf(Date);
    for (const c of e.paginas) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect(existsSync(resolverCaminho(dataDir, e.pdf))).toBe(true);
    expect(await bytes()).toBe(antes - 2 * JPEG_MINIMO.length); // só as páginas saíram; o PDF não foi copiado
    expect(await pushes()).toEqual([{ tipo: 'exame_revisado', canal: 'push' }]);
    const trilha = await withTenant(
      T.ctx,
      (tx) =>
        tx
          .select({ acao: auditLog.acao, entidade: auditLog.entidade, ator: auditLog.actorUserId })
          .from(auditLog)
          .where(and(eq(auditLog.patientId, p.id), inArray(auditLog.entidade, ['exames', 'exames_enviados']), inArray(auditLog.acao, ['criar', 'alterar']))),
      app.db,
    );
    expect(trilha).toEqual(expect.arrayContaining([{ acao: 'criar', entidade: 'exames', ator: T.nutriId }, { acao: 'alterar', entidade: 'exames_enviados', ator: T.nutriId }]));
    expect(await examesEnviadosPeloPaciente(T.ctx, p.id, app.db)).toEqual(new Set([examId]));
  });

  it('as regras da US-015: título obrigatório (cortado em 120, como criarExame), data válida e não futura; nada gravado', async () => {
    const { T, p, ler } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    expect(await erros(aceitarEnvio(T.ctx, SP, e.id, { titulo: '   ', data: '2026-09-28' }, deps))).toEqual({ titulo: MSG_EXAME.titulo });
    expect(await erros(aceitarEnvio(T.ctx, SP, e.id, { titulo: 'Hemograma', data: '2999-01-01' }, deps))).toEqual({ data: MSG_EXAME.futuro });
    expect(await erros(aceitarEnvio(T.ctx, SP, e.id, { titulo: 'Hemograma', data: 'ontem' }, deps))).toEqual({ data: MSG_EXAME.data });
    expect((await ler(e.id)).status).toBe('recebido');
    const { examId } = await aceitarEnvio(T.ctx, SP, e.id, { titulo: 'x'.repeat(130), data: '2026-09-28' }, deps);
    const [ex] = await withTenant(T.ctx, (tx) => tx.select({ titulo: exams.titulo }).from(exams).where(eq(exams.id, examId)), app.db);
    expect(ex.titulo).toHaveLength(120);
  });

  it('US-163 corridas: cancelado pelo paciente → "Este envio foi cancelado pelo paciente."; aceito em outra aba → "Este envio já foi revisado."', async () => {
    const { T, p } = await cenario();
    const c = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.update(examSubmissions).set({ status: 'cancelado' }).where(eq(examSubmissions.id, c.id)), app.db);
    expect(await erros(aceitarEnvio(T.ctx, SP, c.id, aceitar, deps))).toEqual({ geral: MSG_REVISAO.cancelado });
    expect(await erros(recusarEnvio(T.ctx, c.id, { motivo: 'ilegivel', texto: '' }, deps))).toEqual({ geral: MSG_REVISAO.cancelado });
    const a = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await aceitarEnvio(T.ctx, SP, a.id, aceitar, deps);
    expect(await erros(aceitarEnvio(T.ctx, SP, a.id, aceitar, deps))).toEqual({ geral: MSG_REVISAO.jaRevisado });
    expect(await erros(recusarEnvio(T.ctx, a.id, { motivo: 'repetido', texto: '' }, deps))).toEqual({ geral: MSG_REVISAO.jaRevisado });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.patientId, p.id)), app.db)).toHaveLength(1);
    expect(await erros(aceitarEnvio(T.ctx, SP, '00000000-0000-4000-8000-000000000000', aceitar, deps))).toEqual({ geral: MSG_REVISAO.naoEncontrado });
  });

  it('§6.3: paciente arquivado → aceita normalmente; bloqueado → PacienteBloqueadoError e nada gravado', async () => {
    const { T, p } = await cenario();
    const e1 = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, p.id)), app.db);
    await aceitarEnvio(T.ctx, SP, e1.id, aceitar, deps);
    const e2 = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado' }).where(eq(patients.id, p.id)), app.db);
    await expect(aceitarEnvio(T.ctx, SP, e2.id, aceitar, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    await expect(recusarEnvio(T.ctx, e2.id, { motivo: 'ilegivel', texto: '' }, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(exams).where(eq(exams.patientId, p.id)), app.db)).toHaveLength(1);
  });

  it('US-164 "Recusar" (D20 = a): o PDF limpo sai na mesma transação que marca "recusado"; as páginas logo depois; cota devolvida; push neutro', async () => {
    const { T, p, bytes, ler, pushes } = await cenario();
    const inicial = await bytes();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await recusarEnvio(T.ctx, e.id, { motivo: 'outra_pessoa', texto: 'ignorado fora de "outro"' }, deps);
    expect(await ler(e.id)).toMatchObject({ status: 'recusado', motivoRecusa: 'outra_pessoa', motivoRecusaTexto: null, revisadoPor: T.nutriId, arquivoPath: null });
    for (const c of [e.pdf, ...e.paginas]) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect(await bytes()).toBe(inicial);
    expect(await pushes()).toEqual([{ tipo: 'exame_revisado', canal: 'push' }]);
  });

  it('US-164 "Outro motivo": texto obrigatório de 1 a 300 — "Escreva o motivo para o paciente"; motivo fora da lista → "Escolha o motivo."', async () => {
    const { T, p, ler } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    expect(await erros(recusarEnvio(T.ctx, e.id, { motivo: 'outro', texto: '   ' }, deps))).toEqual({ texto: MSG_REVISAO.motivoObrigatorio });
    expect(await erros(recusarEnvio(T.ctx, e.id, { motivo: 'outro', texto: 'x'.repeat(301) }, deps))).toEqual({ texto: MSG_REVISAO.motivoObrigatorio });
    expect(await erros(recusarEnvio(T.ctx, e.id, { motivo: 'qualquer', texto: '' }, deps))).toEqual({ motivo: MSG_REVISAO.escolhaMotivo });
    await recusarEnvio(T.ctx, e.id, { motivo: 'outro', texto: 'Faltou a página 2' }, deps);
    expect(await ler(e.id)).toMatchObject({ motivoRecusa: 'outro', motivoRecusaTexto: 'Faltou a página 2' });
  });

  it('US-162 "Fila": só "recebido", de todos os pacientes, mais antigos primeiro, sem auditoria; contadores; abrir audita e traz as páginas em ordem', async () => {
    const { T, p } = await cenario();
    const p2 = await novoPaciente(app.db, T.ctx, { nome: 'Bruno Lima' });
    const novo = await envioRecebido(app.db, T.ctx, p.id, dataDir, { criadoEm: new Date('2026-10-05T12:00:00Z') });
    const velho = await envioRecebido(app.db, T.ctx, p2.id, dataDir, { criadoEm: new Date('2026-09-20T12:00:00Z'), nome: null });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
    const fila = await filaDeEnvios(T.ctx, app.db);
    expect(fila.map((f) => [f.id, f.paciente, f.nome])).toEqual([[velho.id, 'Bruno Lima', null], [novo.id, 'Ana Souza', 'Hemograma']]);
    expect(await contarEnviosRecebidos(T.ctx, app.db)).toBe(2);
    expect(await contarEnviosDoPaciente(T.ctx, p.id, app.db)).toBe(1);
    const lidas = () => withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.acao, 'ler'), eq(auditLog.entidade, 'exames_enviados'))), app.db);
    expect(await lidas()).toEqual([]);
    const aberto = await abrirEnvio(T.ctx, novo.id, app.db);
    expect(aberto).toMatchObject({ id: novo.id, status: 'recebido', pdf: novo.pdf, paginas: novo.paginas, nome: 'Hemograma', dataColeta: '2026-09-28' });
    expect(aberto?.paciente.id).toBe(p.id);
    expect((await lidas()).map((l) => [l.entidadeId, l.actorUserId])).toEqual([[novo.id, T.nutriId]]);
    const outro = await novoTenant(app.db);
    expect(await abrirEnvio(outro.ctx, novo.id, app.db)).toBeNull();
    expect(await abrirEnvio(T.ctx, 'nao-e-uuid', app.db)).toBeNull();
  });
});
```

Run: `pnpm vitest run src/modules/pacientes/exames-enviados.test.ts`
Expected: FAIL (`./exames-enviados` não existe).

- [ ] **Step 3: Implementar a revisão**

Criar `src/modules/pacientes/exames-enviados.ts`:

```ts
import { and, asc, count, eq, isNotNull } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { examSubmissionFiles, examSubmissions, exams, patients, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { normalizarTexto } from '@/lib/text';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { auditRead } from '@/modules/plataforma/audit';
import { avisarEnvioAtualizado } from '@/modules/portal/avisos';
import { carregarPacienteParaEscrita, idValido } from './base';
import { dataValida, hojeNoFuso } from './datas';
import { MSG_EXAME } from './exames-constantes';
import { apagarArquivosDoEnvio } from './exames-enviados-arquivos';
import { MOTIVO_RECUSA_TEXTO_MAX, MOTIVOS_RECUSA, MSG_REVISAO, type MotivoRecusa, type StatusEnvio } from './exames-enviados-constantes';

/** Recusa com texto pronto para a tela (US-015, US-163, US-164). */
export class RevisaoError extends Error {
  override name = 'RevisaoError';
  constructor(readonly erros: Partial<Record<'titulo' | 'data' | 'motivo' | 'texto' | 'geral', string>>) {
    super('Revisão do envio recusada');
  }
}

export type EnvioNaFila = { id: string; patientId: string; paciente: string; enviadoEm: Date; dataColeta: string; nome: string | null };

/** US-162: a fila "Exames recebidos" — todos os pacientes, os mais antigos primeiro. Só lista: sem auditRead (como a lista de pacientes). */
export async function filaDeEnvios(ctx: TenantContext, db: Db = getDb()): Promise<EnvioNaFila[]> {
  return withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: examSubmissions.id, patientId: examSubmissions.patientId, paciente: patients.nome, enviadoEm: examSubmissions.createdAt, dataColeta: examSubmissions.dataColeta, nome: examSubmissions.nome })
        .from(examSubmissions)
        .innerJoin(patients, and(eq(patients.tenantId, examSubmissions.tenantId), eq(patients.id, examSubmissions.patientId)))
        .where(eq(examSubmissions.status, 'recebido'))
        .orderBy(asc(examSubmissions.createdAt)),
    db,
  );
}

/** US-162: o contador do menu ("Exames recebidos (3)"); só conta, sem auditoria. */
export async function contarEnviosRecebidos(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  const [{ n }] = await withTenant(ctx, (tx) => tx.select({ n: count() }).from(examSubmissions).where(eq(examSubmissions.status, 'recebido')), db);
  return n;
}

/** US-162 "No prontuário": "Exames enviados pelo paciente ({n})" — os que aguardam a revisão. */
export async function contarEnviosDoPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<number> {
  if (!idValido(patientId)) return 0;
  const [{ n }] = await withTenant(ctx, (tx) => tx.select({ n: count() }).from(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), eq(examSubmissions.status, 'recebido'))), db);
  return n;
}

/** §6.5 item 1 (ECF.17.01): os exames do paciente que vieram de um envio aceito — o selo "Enviado pelo paciente" na aba Exames. */
export async function examesEnviadosPeloPaciente(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<Set<string>> {
  if (!idValido(patientId)) return new Set();
  const r = await withTenant(
    ctx,
    (tx) => tx.select({ examId: examSubmissions.examId }).from(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), eq(examSubmissions.status, 'aceito'), isNotNull(examSubmissions.examId))),
    db,
  );
  return new Set(r.map((x) => x.examId!));
}

export type EnvioAberto = {
  id: string;
  paciente: PatientRow;
  status: StatusEnvio;
  enviadoEm: Date;
  dataColeta: string;
  nome: string | null;
  observacao: string | null;
  /** O PDF limpo (só em "recebido"). */
  pdf: string | null;
  /** As imagens de página, na ordem (D23 = a: a nutricionista confere como imagens). */
  paginas: string[];
};

/** US-162: abre um envio no painel — "Visualizou — Exames enviados pelo paciente" (auditRead na mesma transação). */
export async function abrirEnvio(ctx: TenantContext, id: string, db: Db = getDb()): Promise<EnvioAberto | null> {
  if (!idValido(id)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [e] = await tx.select().from(examSubmissions).where(eq(examSubmissions.id, id));
      if (!e) return null;
      const [p] = await tx.select().from(patients).where(eq(patients.id, e.patientId));
      const paginas = await tx
        .select({ c: examSubmissionFiles.arquivoPath })
        .from(examSubmissionFiles)
        .where(and(eq(examSubmissionFiles.submissionId, id), eq(examSubmissionFiles.papel, 'pagina')))
        .orderBy(asc(examSubmissionFiles.ordem));
      await auditRead(tx, { entidade: 'exames_enviados', entidadeId: id, patientId: e.patientId });
      return { id: e.id, paciente: p, status: e.status as StatusEnvio, enviadoEm: e.createdAt, dataColeta: e.dataColeta, nome: e.nome, observacao: e.observacao, pdf: e.arquivoPath, paginas: paginas.map((x) => x.c) };
    },
    db,
  );
}

async function lerEnvio(ctx: TenantContext, id: string, db: Db): Promise<{ patientId: string; arquivoPath: string | null }> {
  const [e] = idValido(id)
    ? await withTenant(ctx, (tx) => tx.select({ patientId: examSubmissions.patientId, arquivoPath: examSubmissions.arquivoPath }).from(examSubmissions).where(eq(examSubmissions.id, id)), db)
    : [];
  if (!e) throw new RevisaoError({ geral: MSG_REVISAO.naoEncontrado });
  return e;
}

/**
 * Ordem de travas de criarExame e de salvarArquivo: paciente (carregarPacienteParaEscrita: bloqueado ou anonimizado →
 * PacienteBloqueadoError; arquivado passa, §6.3) → envio (FOR UPDATE) → tenant (no apagarArquivo da recusa). Corridas da US-163.
 */
async function travarEnvioRecebido(tx: Tx, id: string, patientId: string): Promise<{ arquivoPath: string | null }> {
  await carregarPacienteParaEscrita(tx, patientId);
  const [e] = await tx.select({ status: examSubmissions.status, arquivoPath: examSubmissions.arquivoPath }).from(examSubmissions).where(eq(examSubmissions.id, id)).for('update');
  if (!e) throw new RevisaoError({ geral: MSG_REVISAO.naoEncontrado });
  if (e.status === 'cancelado') throw new RevisaoError({ geral: MSG_REVISAO.cancelado });
  if (e.status !== 'recebido') throw new RevisaoError({ geral: MSG_REVISAO.jaRevisado });
  return e;
}

const soltarPaginas = (ctx: TenantContext, id: string, deps: { db: Db; dataDir?: string }) =>
  apagarArquivosDoEnvio(ctx, id, deps).catch((err: unknown) =>
    logger.warn({ tenantId: ctx.tenantId, envioId: id, err: err instanceof Error ? err.name : 'erro' }, 'páginas do envio revisado não apagadas (a varredura tenta de novo)'),
  );

/**
 * US-163 / RN-164: numa transação — exame novo (título 1–120, data válida e não futura, `valores = []`) apontando para o MESMO
 * PDF limpo (sem cópia: o exame passa a ser o único dono do arquivo) e o envio "aceito" com `exam_id`, quem e quando, soltando
 * o ponteiro; o push neutro ao paciente. Depois do commit, as imagens de página saem (cada uma no seu apagarArquivo; sobra →
 * varredura). "Aceitar e ler valores com IA" chama `pedirLeituraExame` DEPOIS desta função (a recusa da IA não desfaz o aceite).
 */
export async function aceitarEnvio(
  ctx: TenantContext,
  tenant: { fuso: string },
  id: string,
  entrada: { titulo: unknown; data: unknown },
  deps: { db?: Db; dataDir?: string; agora?: Date } = {},
): Promise<{ examId: string; patientId: string }> {
  const revisor = ctx.actorUserId;
  if (ctx.role !== 'nutri' || !revisor) throw new Error('aceitarEnvio: só a nutricionista');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const erros: Partial<Record<'titulo' | 'data', string>> = {};
  const titulo = normalizarTexto(entrada.titulo).slice(0, 120);
  if (!titulo) erros.titulo = MSG_EXAME.titulo;
  const data = typeof entrada.data === 'string' ? entrada.data.trim() : '';
  if (!dataValida(data)) erros.data = MSG_EXAME.data;
  else if (data > hojeNoFuso(tenant.fuso, agora)) erros.data = MSG_EXAME.futuro;
  if (Object.keys(erros).length) throw new RevisaoError(erros);
  const lido = await lerEnvio(ctx, id, db);
  const r = await withTenant(
    ctx,
    async (tx) => {
      const e = await travarEnvioRecebido(tx, id, lido.patientId);
      if (!e.arquivoPath) throw new RevisaoError({ geral: MSG_REVISAO.jaRevisado });
      const [ex] = await tx
        .insert(exams)
        .values({ tenantId: ctx.tenantId, patientId: lido.patientId, data, titulo, arquivoPath: e.arquivoPath, valores: [], createdAt: agora, updatedAt: agora })
        .returning({ id: exams.id });
      await tx
        .update(examSubmissions)
        .set({ status: 'aceito', examId: ex.id, revisadoPor: revisor, revisadoEm: agora, arquivoPath: null, updatedAt: agora })
        .where(eq(examSubmissions.id, id));
      await avisarEnvioAtualizado(tx, { tenantId: ctx.tenantId, patientId: lido.patientId, tipo: 'exame_revisado' }, agora);
      return { examId: ex.id, patientId: lido.patientId };
    },
    db,
  );
  await soltarPaginas(ctx, id, { db, dataDir: deps.dataDir });
  return r;
}

/**
 * US-164 / RN-165 (D20 = a): motivo da lista; "outro" exige texto de 1 a 300. O PDF limpo sai por apagarArquivo cujo
 * `naMesmaTransacao` trava paciente → envio, confere "recebido" e o marca "recusado" (quem, quando, motivo) com o push neutro;
 * as imagens de página saem logo depois. "Exame de outra pessoa": o mesmo caminho (dado de terceiro, minimização).
 */
export async function recusarEnvio(ctx: TenantContext, id: string, entrada: { motivo: unknown; texto: unknown }, deps: { db?: Db; dataDir?: string; agora?: Date } = {}): Promise<void> {
  const revisor = ctx.actorUserId;
  if (ctx.role !== 'nutri' || !revisor) throw new Error('recusarEnvio: só a nutricionista');
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const motivo = typeof entrada.motivo === 'string' && (MOTIVOS_RECUSA as readonly string[]).includes(entrada.motivo) ? (entrada.motivo as MotivoRecusa) : null;
  if (!motivo) throw new RevisaoError({ motivo: MSG_REVISAO.escolhaMotivo });
  const texto = motivo === 'outro' ? normalizarTexto(entrada.texto) : '';
  if (motivo === 'outro' && (!texto || [...texto].length > MOTIVO_RECUSA_TEXTO_MAX)) throw new RevisaoError({ texto: MSG_REVISAO.motivoObrigatorio });
  const lido = await lerEnvio(ctx, id, db);
  const marcar = async (tx: Tx): Promise<boolean> => {
    await travarEnvioRecebido(tx, id, lido.patientId);
    await tx
      .update(examSubmissions)
      .set({ status: 'recusado', motivoRecusa: motivo, motivoRecusaTexto: motivo === 'outro' ? texto : null, revisadoPor: revisor, revisadoEm: agora, arquivoPath: null, updatedAt: agora })
      .where(eq(examSubmissions.id, id));
    await avisarEnvioAtualizado(tx, { tenantId: ctx.tenantId, patientId: lido.patientId, tipo: 'exame_revisado' }, agora);
    return true;
  };
  if (lido.arquivoPath) await apagarArquivo(ctx, { caminho: lido.arquivoPath }, { db, dataDir: deps.dataDir, naMesmaTransacao: marcar });
  else await withTenant(ctx, marcar, db);
  await soltarPaginas(ctx, id, { db, dataDir: deps.dataDir });
}
```

- [ ] **Step 4: Rodar e commitar**

Run: `pnpm vitest run src/modules/pacientes/exames-enviados.test.ts src/modules/notificacoes src/modules/portal/avisos.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, sem erros.

```bash
git add src/modules/pacientes/exames-enviados.ts src/modules/pacientes/exames-enviados.test.ts src/modules/portal/avisos.ts \
  src/modules/notificacoes/mensagens.ts src/modules/notificacoes/mensagens.test.ts
git commit -m "feat(exames-enviados): revisão — fila, abrir auditado, aceitar (um dono só), recusar e push neutro (P12-07)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 8: Limpeza do cancelamento e varredura — interrompidos, expiração em 90 dias, sobras e órfãos (P12-08)

**Revisão: completa (agente revisor-rls)** — worker que apaga arquivos (regra 9: ponteiro na transação do arquivo), push da expiração, varredura por tenant que não para nos erros.

**Files:**
- Create: `src/modules/pacientes/exames-enviados-varredura.ts` (+ `exames-enviados-varredura.test.ts`)
- Modify: `src/worker/index.ts` (filas `exame-envio-limpar` e `expirar-exame-envio`)

**Interfaces:**
- Consumes: T2 (`apagarArquivosDoEnvio`, `ENVIO_EXPIRA_DIAS`), T7 (`avisarEnvioAtualizado`); `apagarArquivo`, `listarTenantsParaVarredura` (`src/modules/plataforma/tenant-status.ts`); `PgBoss['findJobs']`.
- Produces: `limparEnvio`, `varrerEnvios`, `ENVIO_PARADO_MAX_MS` (contratos no topo).

- [ ] **Step 1: Escrever o teste (falha: o módulo não existe)**

Criar `src/modules/pacientes/exames-enviados-varredura.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PgBoss } from 'pg-boss';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco, envioRecebido } from '../../../test/exames-enviados';
import { closeDb } from '@/db/client';
import { examSubmissionFiles, examSubmissions, notifications, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';
import { limparEnvio, varrerEnvios } from './exames-enviados-varredura';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-varredura-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const semJobs = { findJobs: async () => [] } as unknown as Pick<PgBoss, 'findJobs'>;
const comJobVivo = { findJobs: async () => [{ state: 'retry' }] } as unknown as Pick<PgBoss, 'findJobs'>;
const AGORA = new Date('2026-10-07T15:00:00Z');
const atras = (ms: number) => new Date(AGORA.getTime() - ms);
const DIA = 86_400_000;
async function cenario() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const bytes = async () => (await app.db.select({ b: tenants.armazenamentoBytes }).from(tenants).where(eq(tenants.id, T.tenantId)))[0].b;
  const ler = async (id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(examSubmissions).where(eq(examSubmissions.id, id)), app.db))[0];
  const linhas = (id: string) => withTenant(T.ctx, (tx) => tx.select().from(examSubmissionFiles).where(eq(examSubmissionFiles.submissionId, id)), app.db);
  const varrer = (boss = semJobs) => varrerEnvios({ db: app.db, dataDir, boss }, AGORA, { tenantId: T.tenantId });
  return { T, p, bytes, ler, linhas, varrer, inicial: await bytes() };
}

describe('limpeza e varredura dos envios (RN-163, RN-166, RN-167)', () => {
  it('RN-166: o job do cancelamento apaga o PDF limpo e as páginas e devolve a cota; idempotente', async () => {
    const { T, p, bytes, ler, linhas, inicial } = await cenario();
    const e = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.update(examSubmissions).set({ status: 'cancelado' }).where(eq(examSubmissions.id, e.id)), app.db);
    expect(await limparEnvio({ tenantId: T.tenantId, envioId: e.id }, { db: app.db, dataDir })).toBe(3);
    expect(await ler(e.id)).toMatchObject({ status: 'cancelado', arquivoPath: null });
    expect(await linhas(e.id)).toEqual([]);
    expect(await bytes()).toBe(inicial);
    expect(await limparEnvio({ tenantId: T.tenantId, envioId: e.id }, { db: app.db, dataDir })).toBe(0);
  });

  it('D12: "processando" parado há mais de 30 min sem job vivo → "falhou" (interrompido), sem reprocessar, e o original sai; com job vivo ou recente, espera', async () => {
    const { T, p, ler, linhas, varrer } = await cenario();
    const parado = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando', updatedAt: atras(31 * 60_000) });
    const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
    await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId: parado, arquivoPath: original, papel: 'original', ordem: 1 }), app.db);
    const recente = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando', updatedAt: atras(10 * 60_000) });
    expect((await varrer(comJobVivo)).interrompidos).toBe(0);
    expect((await ler(parado)).status).toBe('processando');
    expect((await varrer()).interrompidos).toBe(1);
    expect(await ler(parado)).toMatchObject({ status: 'falhou', motivoFalha: 'interrompido' });
    expect(await linhas(parado)).toEqual([]);
    expect(existsSync(resolverCaminho(dataDir, original))).toBe(false);
    expect((await ler(recente)).status).toBe('processando');
  });

  it('US-165 "Expirar" (D15 = b): "recebido" há 90 dias → "expirado", PDF e páginas apagados, push neutro; com 89 dias, fica', async () => {
    const { T, p, ler, linhas, varrer, bytes, inicial } = await cenario();
    const velho = await envioRecebido(app.db, T.ctx, p.id, dataDir, { criadoEm: atras(91 * DIA) });
    const novo = await envioRecebido(app.db, T.ctx, p.id, dataDir, { criadoEm: atras(89 * DIA) });
    const r = await varrer();
    expect(r.expirados).toBe(1);
    expect(await ler(velho.id)).toMatchObject({ status: 'expirado', arquivoPath: null });
    expect(await linhas(velho.id)).toEqual([]);
    for (const c of [velho.pdf, ...velho.paginas]) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect((await ler(novo.id)).status).toBe('recebido');
    const pushes = await withTenant(T.ctx, (tx) => tx.select({ tipo: notifications.tipo }).from(notifications).where(eq(notifications.patientId, p.id)), app.db);
    expect(pushes).toEqual([{ tipo: 'exame_expirado' }]);
    expect(await bytes()).toBeGreaterThan(inicial); // só o novo continua ocupando espaço
  });

  it('sobras: páginas de um envio já aceito e o original de um envio já "recebido" saem; a segunda varredura não acha nada', async () => {
    const { T, p, linhas, varrer } = await cenario();
    const aceito = await envioRecebido(app.db, T.ctx, p.id, dataDir);
    await withTenant(T.ctx, (tx) => tx.update(examSubmissions).set({ status: 'aceito', arquivoPath: null, revisadoPor: T.nutriId, revisadoEm: new Date() }).where(eq(examSubmissions.id, aceito.id)), app.db);
    const rec = await envioRecebido(app.db, T.ctx, p.id, dataDir, { paginas: 1 });
    const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
    await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId: rec.id, arquivoPath: original, papel: 'original', ordem: 1 }), app.db);
    const r = await varrer();
    expect(r.arquivos).toBe(3); // 2 páginas do aceito + o original do recebido
    expect(await linhas(aceito.id)).toEqual([]);
    expect((await linhas(rec.id)).map((l) => l.papel)).toEqual(['pagina']);
    expect(await varrer()).toEqual({ interrompidos: 0, expirados: 0, arquivos: 0 });
  });
});
```

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-varredura.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 2: Implementar**

Criar `src/modules/pacientes/exames-enviados-varredura.ts`:

```ts
import { and, eq, inArray, isNotNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { Db, Tx } from '@/db/client';
import { examSubmissionFiles, examSubmissions, storedFiles } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { apagarArquivo } from '@/modules/plataforma/armazenamento';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { avisarEnvioAtualizado } from '@/modules/portal/avisos';
import { apagarArquivosDoEnvio } from './exames-enviados-arquivos';
import { ENVIO_EXPIRA_DIAS } from './exames-enviados-constantes';

/** As tentativas do job `exame-envio` somam poucos minutos (30 s, 60 s de espera + até 300 s cada): 30 min parado é abandono. */
export const ENVIO_PARADO_MAX_MS = 30 * 60_000;
const ORFAO_MIN_MS = 3600_000;
const JOB_VIVO = new Set(['created', 'retry', 'active']);
const DIA_MS = 86_400_000;

/** RN-166: o paciente cancelou; o worker apaga o PDF limpo e as páginas (a sessão de paciente não apaga stored_files). Idempotente. */
export function limparEnvio(data: { tenantId: string; envioId: string }, deps: { db: Db; dataDir: string }): Promise<number> {
  return apagarArquivosDoEnvio({ tenantId: data.tenantId, role: 'worker' }, data.envioId, deps);
}

/**
 * Fila `expirar-exame-envio`, de 15 em 15 min (RN-163, RN-167; molde de expirarFotosPendentes e de
 * limparArquivosOrfaosDeDocumentos):
 * 1. "processando" parado há mais de 30 min sem job vivo → "falhou" (interrompido) e os arquivos saem. Não reprocessa: se a
 *    queda foi falta de memória com este arquivo, cada varredura derrubaria o worker outra vez (D12).
 * 2. "recebido" há 90 dias → "expirado" (D15 = b): o PDF limpo sai no apagarArquivo cujo naMesmaTransacao marca o envio e
 *    grava o push neutro; as páginas logo depois. O lembrete dos 30 dias vai no e-mail de envio novo (PM-12).
 * 3. Sobras: arquivo de envio que já não está vivo (cancelado cujo job de limpeza falhou, páginas de aceito ou recusado,
 *    original de um "recebido") e, por defesa, arquivo de envio sem linha que aponte para ele, com mais de 1 h.
 * Um tenant com erro não para os outros; log só com contagens e ids (RNF-11). `o.tenantId`: só os testes.
 */
export async function varrerEnvios(
  deps: { db: Db; dataDir: string; boss: Pick<PgBoss, 'findJobs'> },
  agora: Date,
  o: { tenantId?: string } = {},
): Promise<{ interrompidos: number; expirados: number; arquivos: number }> {
  const r = { interrompidos: 0, expirados: 0, arquivos: 0 };
  const arquivos = { db: deps.db, dataDir: deps.dataDir };
  for (const t of o.tenantId ? [{ id: o.tenantId }] : await listarTenantsParaVarredura(deps.db)) {
    const ctx: TenantContext = { tenantId: t.id, role: 'worker' };
    try {
      const parados = await withTenant(
        ctx,
        (tx) => tx.select({ id: examSubmissions.id }).from(examSubmissions).where(and(eq(examSubmissions.status, 'processando'), lt(examSubmissions.updatedAt, new Date(agora.getTime() - ENVIO_PARADO_MAX_MS)))),
        deps.db,
      );
      for (const e of parados) {
        const jobs = await deps.boss.findJobs<{ envioId: string }>('exame-envio', { data: { envioId: e.id } });
        if (jobs.some((j) => JOB_VIVO.has(j.state))) continue;
        const marcado = await withTenant(
          ctx,
          (tx) =>
            tx
              .update(examSubmissions)
              .set({ status: 'falhou', motivoFalha: 'interrompido', updatedAt: agora })
              .where(and(eq(examSubmissions.id, e.id), eq(examSubmissions.status, 'processando')))
              .returning({ id: examSubmissions.id }),
          deps.db,
        );
        if (marcado.length) r.interrompidos++;
        r.arquivos += await apagarArquivosDoEnvio(ctx, e.id, arquivos);
      }

      const vencidos = await withTenant(
        ctx,
        (tx) =>
          tx
            .select({ id: examSubmissions.id, patientId: examSubmissions.patientId, pdf: examSubmissions.arquivoPath })
            .from(examSubmissions)
            .where(and(eq(examSubmissions.status, 'recebido'), lt(examSubmissions.createdAt, new Date(agora.getTime() - ENVIO_EXPIRA_DIAS * DIA_MS)))),
        deps.db,
      );
      for (const v of vencidos) {
        const expirar = async (tx: Tx): Promise<boolean> => {
          const u = await tx
            .update(examSubmissions)
            .set({ status: 'expirado', arquivoPath: null, updatedAt: agora })
            .where(and(eq(examSubmissions.id, v.id), eq(examSubmissions.status, 'recebido')))
            .returning({ id: examSubmissions.id });
          if (!u.length) return false;
          await avisarEnvioAtualizado(tx, { tenantId: t.id, patientId: v.patientId, tipo: 'exame_expirado' }, agora);
          return true;
        };
        const ok = v.pdf ? await apagarArquivo(ctx, { caminho: v.pdf }, { ...arquivos, naMesmaTransacao: expirar }) : await withTenant(ctx, expirar, deps.db);
        if (ok) {
          r.expirados++;
          if (v.pdf) r.arquivos++;
        }
        r.arquivos += await apagarArquivosDoEnvio(ctx, v.id, arquivos);
      }

      const sobras = await withTenant(
        ctx,
        (tx) =>
          tx
            .selectDistinct({ id: examSubmissions.id })
            .from(examSubmissions)
            .leftJoin(examSubmissionFiles, eq(examSubmissionFiles.submissionId, examSubmissions.id))
            .where(and(notInArray(examSubmissions.status, ['processando', 'recebido']), or(isNotNull(examSubmissions.arquivoPath), isNotNull(examSubmissionFiles.id)))),
        deps.db,
      );
      for (const s of sobras) r.arquivos += await apagarArquivosDoEnvio(ctx, s.id, arquivos);
      const originaisDeRecebido = await withTenant(
        ctx,
        (tx) =>
          tx
            .selectDistinct({ id: examSubmissions.id })
            .from(examSubmissions)
            .innerJoin(examSubmissionFiles, eq(examSubmissionFiles.submissionId, examSubmissions.id))
            .where(and(eq(examSubmissions.status, 'recebido'), eq(examSubmissionFiles.papel, 'original'))),
        deps.db,
      );
      for (const s of originaisDeRecebido) r.arquivos += await apagarArquivosDoEnvio(ctx, s.id, { ...arquivos, papel: 'original' });

      const semLinha = sql`not exists (select 1 from exam_submission_files f where f.tenant_id = ${storedFiles.tenantId} and f.arquivo_path = ${storedFiles.caminho})`;
      const orfaos = await withTenant(
        ctx,
        (tx) =>
          tx
            .select({ caminho: storedFiles.caminho })
            .from(storedFiles)
            .where(and(inArray(storedFiles.tipo, ['exame_original', 'exame_pagina']), lt(storedFiles.createdAt, new Date(agora.getTime() - ORFAO_MIN_MS)), semLinha)),
        deps.db,
      );
      for (const f of orfaos) {
        const ok = await apagarArquivo(ctx, { caminho: f.caminho }, {
          ...arquivos,
          naMesmaTransacao: async (tx) => (await tx.select({ c: storedFiles.caminho }).from(storedFiles).where(and(eq(storedFiles.caminho, f.caminho), semLinha))).length > 0,
        });
        if (ok) r.arquivos++;
      }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.name : 'erro', tenantId: t.id }, 'falha ao varrer os envios de exame');
    }
  }
  if (r.interrompidos || r.expirados || r.arquivos) logger.info(r, 'varredura dos envios de exame');
  return r;
}
```

- [ ] **Step 3: Registrar as filas no worker**

Em `src/worker/index.ts`, importar `import { limparEnvio, varrerEnvios } from '@/modules/pacientes/exames-enviados-varredura';` e, depois da fila `exame-envio` (T6):

```ts
  // RN-166: cancelamento pelo paciente — o worker apaga o PDF limpo e as páginas
  await work<DadosEnvio>('exame-envio-limpar', async ([job]) => {
    await limparEnvio(job.data, { db: getDb(), dataDir: env.DATA_DIR });
  });
  // RN-163/RN-167: interrompidos → falhou, 90 dias → expirado (push neutro) e sobras de arquivo, de 15 em 15 min
  await boss.schedule('expirar-exame-envio', '*/15 * * * *', {}, { tz: 'America/Sao_Paulo' });
  await work('expirar-exame-envio', async () => {
    await varrerEnvios({ db: getDb(), dataDir: env.DATA_DIR, boss }, new Date());
  });
```

- [ ] **Step 4: Rodar e commitar**

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-varredura.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, sem erros.

```bash
git add src/modules/pacientes/exames-enviados-varredura.ts src/modules/pacientes/exames-enviados-varredura.test.ts src/worker/index.ts
git commit -m "feat(exames-enviados): limpeza do cancelamento e varredura — interrompidos, expiração em 90 dias e sobras (P12-08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 9: Configurações (ligar o recebimento) e a coluna do admin (P12-09)

**Revisão: leve (revisor-interface)** — uma seção de Configurações e uma coluna de contagens no admin; o banco (função do admin) já passou pela revisão completa na T1.

**Files:**
- Create: `src/modules/plataforma/recebimento-exames.ts` (+ `recebimento-exames.test.ts`), `src/app/painel/configuracoes/exames-secao.tsx`
- Modify: `src/app/painel/configuracoes/actions.ts`, `src/app/painel/configuracoes/page.tsx`, `src/modules/plataforma/metricas.ts` (+ `metricas.test.ts`), `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: T1 (`tenants.examesPacienteAtivadoEm`, `admin_metricas_exames_enviados()`), T2 (`MSG_REVISAO`); `requireNutri`, `Botao`, `Aviso`.
- Produces: `definirRecebimentoDeExames(ctx, ligar, deps?)`; `definirRecebimentoAction(fd)`; `metricasDeExamesEnviadosPorTenant(db?)`; a seção "Exames enviados pelos pacientes" em Configurações; a coluna "Exames do app" no admin.

- [ ] **Step 1: Testes (falham: as funções não existem)**

Criar `src/modules/plataforma/recebimento-exames.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { tenants } from '@/db/schema';
import { definirRecebimentoDeExames } from './recebimento-exames';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const ligadoEm = async (tenantId: string) => (await app.db.select({ em: tenants.examesPacienteAtivadoEm }).from(tenants).where(eq(tenants.id, tenantId)))[0].em;

describe('D18 = a: recebimento de exames pelo app (Configurações)', () => {
  it('a nutricionista liga (guarda a primeira data), liga de novo sem mudar a data e desliga', async () => {
    const T = await novoTenant(app.db);
    await definirRecebimentoDeExames(T.ctx, true, { db: app.db, agora: new Date('2026-10-07T12:00:00Z') });
    await definirRecebimentoDeExames(T.ctx, true, { db: app.db, agora: new Date('2026-10-08T12:00:00Z') });
    expect(await ligadoEm(T.tenantId)).toEqual(new Date('2026-10-07T12:00:00Z'));
    await definirRecebimentoDeExames(T.ctx, false, { db: app.db });
    expect(await ligadoEm(T.tenantId)).toBeNull();
  });

  it('só a nutricionista muda (a sessão de paciente e o worker não)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await expect(definirRecebimentoDeExames(ctxPaciente(T.tenantId, p.id, randomUUID()), true, { db: app.db })).rejects.toThrow();
    await expect(definirRecebimentoDeExames({ tenantId: T.tenantId, role: 'worker' }, true, { db: app.db })).rejects.toThrow();
    expect(await ligadoEm(T.tenantId)).toBeNull();
  });
});
```

Em `src/modules/plataforma/metricas.test.ts`, acrescentar `metricasDeExamesEnviadosPorTenant` ao import de `./metricas`, os imports `import { novoPaciente } from '../../../test/pacientes';` (junto do `novoTenant` que já está lá) e `import { envioNoBanco } from '../../../test/exames-enviados';`, e o caso:

```ts
describe('metricasDeExamesEnviadosPorTenant (§3: só contagens, Plano 12)', () => {
  it('enviados no mês e aguardando revisão, pela função SECURITY DEFINER', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'recebido' });
    await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito', revisadoPor: T.nutriId, revisadoEm: new Date() });
    expect((await metricasDeExamesEnviadosPorTenant(app.db)).get(T.tenantId)).toEqual({ enviadosMes: 2, pendentes: 1 });
  });
});
```

Run: `pnpm vitest run src/modules/plataforma/recebimento-exames.test.ts src/modules/plataforma/metricas.test.ts`
Expected: FAIL (funções inexistentes).

- [ ] **Step 2: Implementar o módulo e a métrica**

Criar `src/modules/plataforma/recebimento-exames.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { logger } from '@/lib/logger';

/**
 * D18 = (a) (Plano 12): a nutricionista liga ou desliga o recebimento de exames enviados pelos pacientes pelo app. Nasce
 * desligado (como a página pública de agendamento). Ligar guarda a PRIMEIRA data; desligar só esconde o "Enviar exame" do
 * portal — os envios já recebidos continuam na fila. `tenants` não é auditada: a mudança fica no log (só ids), como a
 * ativação da IA (D21 do Plano 11).
 */
export async function definirRecebimentoDeExames(ctx: TenantContext, ligar: boolean, deps: { db?: Db; agora?: Date } = {}): Promise<void> {
  if (ctx.role !== 'nutri') throw new Error('definirRecebimentoDeExames: só a nutricionista');
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctx,
    (tx) =>
      tx
        .update(tenants)
        .set({ examesPacienteAtivadoEm: ligar ? sql`coalesce(${tenants.examesPacienteAtivadoEm}, ${agora.toISOString()}::timestamptz)` : null, updatedAt: agora })
        .where(eq(tenants.id, ctx.tenantId)),
    deps.db ?? getDb(),
  );
  logger.info({ tenantId: ctx.tenantId, actorUserId: ctx.actorUserId ?? null, ligado: ligar }, 'recebimento de exames pelo app');
}
```

Em `src/modules/plataforma/metricas.ts`, no fim:

```ts
export type MetricasExamesTenant = { enviadosMes: number; pendentes: number };

/** Plano 12 (§3): envios de exame do mês e aguardando revisão, só contagens (função SECURITY DEFINER, 0102). */
export async function metricasDeExamesEnviadosPorTenant(db: Db = getDb()): Promise<Map<string, MetricasExamesTenant>> {
  const r = await db.execute<{ tenant_id: string; enviados_mes: string; pendentes: string }>(sql`select * from admin_metricas_exames_enviados()`);
  return new Map(r.rows.map((x) => [x.tenant_id, { enviadosMes: Number(x.enviados_mes), pendentes: Number(x.pendentes) }]));
}
```

Run: `pnpm vitest run src/modules/plataforma/recebimento-exames.test.ts src/modules/plataforma/metricas.test.ts`
Expected: PASS.

- [ ] **Step 3: A seção de Configurações**

Criar `src/app/painel/configuracoes/exames-secao.tsx`:

```tsx
import { Aviso } from '@/components/ui/aviso';
import { Botao } from '@/components/ui/botao';
import { MSG_REVISAO } from '@/modules/pacientes/exames-enviados-constantes';
import { definirRecebimentoAction } from './actions';

/** D18 = a (Plano 12): "Receber exames enviados pelos pacientes pelo app" — nasce desligado. */
export function ExamesSecao({ ligado, salvo }: { ligado: boolean; salvo: boolean }) {
  return (
    <section data-guia="exames-app" aria-labelledby="exames-app" className="max-w-lg space-y-3 rounded-3xl border border-borda bg-cartao p-5">
      <h2 id="exames-app" className="font-titulo text-lg font-semibold">Exames enviados pelos pacientes</h2>
      {salvo && <Aviso tipo="ok">{MSG_REVISAO.configuracaoSalva}</Aviso>}
      <form action={definirRecebimentoAction} className="space-y-3">
        <div className="flex min-h-11 items-center gap-3">
          <input id="receberExames" name="receberExames" type="checkbox" value="on" defaultChecked={ligado} className="h-5 w-5" />
          <label htmlFor="receberExames">{MSG_REVISAO.configuracao}</label>
        </div>
        <Botao variante="secundario">Salvar</Botao>
      </form>
    </section>
  );
}
```

Em `src/app/painel/configuracoes/actions.ts`, importar `import { definirRecebimentoDeExames } from '@/modules/plataforma/recebimento-exames';` e acrescentar:

```ts
/** D18 = a (Plano 12): liga/desliga o recebimento de exames pelo app. O consultório vem da sessão, nunca do formulário. */
export async function definirRecebimentoAction(fd: FormData): Promise<void> {
  const { ctx } = await requireNutri('/painel/configuracoes');
  await definirRecebimentoDeExames(ctx, fd.get('receberExames') === 'on');
  revalidatePath('/painel', 'layout'); // o menu ("Exames recebidos") depende do recebimento ligado
  redirect('/painel/configuracoes?exames=salvo');
}
```

Em `src/app/painel/configuracoes/page.tsx`, importar `import { ExamesSecao } from './exames-secao';`, trocar `const { ia } = await searchParams;` por `const { ia, exames } = await searchParams;` e, antes de `<IaSecao …/>`, acrescentar `<ExamesSecao ligado={!!tenant.examesPacienteAtivadoEm} salvo={exames === 'salvo'} />`.

- [ ] **Step 4: A coluna do admin**

Em `src/app/admin/page.tsx`: importar `metricasDeExamesEnviadosPorTenant` de `@/modules/plataforma/metricas`; trocar o `Promise.all` por `const [contas, metricas, sucesso, iaMetricas, exames] = await Promise.all([listarContas(), metricasPorTenant(), metricasDeSucessoPorTenant(), metricasDeIaPorTenant(), metricasDeExamesEnviadosPorTenant()]);`; acrescentar `<th scope="col">Exames do app</th>` antes de `<th scope="col">IA</th>`; e, antes da célula da IA:

```tsx
              {/* Plano 12 (§3): só contagens — o admin nunca vê envio, arquivo ou paciente */}
              <td className="space-y-1">
                <p>{`Enviados no mês: ${exames.get(c.tenantId)?.enviadosMes ?? 0}`}</p>
                <p>{`Aguardando revisão: ${exames.get(c.tenantId)?.pendentes ?? 0}`}</p>
              </td>
```

- [ ] **Step 5: Rodar e commitar**

Run: `pnpm vitest run src/modules/plataforma src/app/painel/configuracoes src/app/admin src/app/painel/acoes-de-paciente.test.ts src/app/painel/cores.test.ts src/app/formularios-post.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, sem erros.

```bash
git add src/modules/plataforma/recebimento-exames.ts src/modules/plataforma/recebimento-exames.test.ts src/modules/plataforma/metricas.ts src/modules/plataforma/metricas.test.ts \
  src/app/painel/configuracoes/exames-secao.tsx src/app/painel/configuracoes/actions.ts src/app/painel/configuracoes/page.tsx src/app/admin/page.tsx
git commit -m "feat(exames-enviados): ligar o recebimento em Configurações e contagens no admin (P12-09)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 10: Telas do portal — "Meus exames", enviar, acompanhar, baixar e cancelar (P12-10)

**Revisão: leve (revisor-interface)** — tela do PWA, textos da spec, acessibilidade (RNF-167), barra do portal (D4 ★).

**Files:**
- Create: `src/app/p/(portal)/exames/page.tsx` (+ `page.test.ts`), `src/app/p/(portal)/exames/envio-form.tsx` (+ `envio-form.test.ts`), `src/app/p/(portal)/exames/cancelar-envio.tsx`, `src/app/p/(portal)/exames/actions.ts`
- Modify: `src/app/p/navegacao.ts` (+ `navegacao.test.ts`), `src/app/p/(portal)/perfil/page.tsx`, `src/app/p/(portal)/inicio/page.tsx`, `e2e/acessibilidade.spec.ts` (`ROTAS`), `scripts/e2e-seed.ts` (recebimento ligado no consultório do E2E)

**Interfaces:**
- Consumes: T4 (`meusEnvios`, `cancelarMeuEnvio`, `EnvioError`), T5 (as rotas), T2 (constantes e textos); `requirePaciente`, `recusaDoPortal`/`linkDaRecusa`, `formatarData`, `formatarDataNoFuso`, `hojeNoFuso`, `BotaoLink`, `ConfirmarBotao`.
- Produces: a página `/p/exames`; `arquivosValidos(arquivos)` (conferência no navegador); `cancelarEnvioAction(id, prev, fd)`.

- [ ] **Step 1: Testes da página, do formulário e da barra (falham)**

Criar `src/app/p/(portal)/exames/envio-form.test.ts`:

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// (Os testes do projeto são `.ts`, sem JSX: createElement.)
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { arquivosValidos, EnvioForm } = await import('./envio-form');
const MB = 1024 * 1024;
const arq = (size: number, type: string) => ({ size, type });

describe('EnvioForm (US-160)', () => {
  it('P09-04: "Enviar" nasce desabilitado no HTML do servidor (sem envio nativo com a observação na URL)', () => {
    const html = renderToStaticMarkup(createElement(EnvioForm, { hoje: '2026-10-07' }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Enviar<\/button>/);
    expect(html).toContain('max="2026-10-07"');
    expect(html).toContain('Ex.: exame pedido na consulta de setembro.');
    expect(html).toMatch(/<form[^>]*method="post"/);
  });

  it('confere no navegador o que dá sem abrir o arquivo (o servidor confere de novo pelo conteúdo)', () => {
    expect(arquivosValidos([arq(3 * MB, 'application/pdf')])).toBe(true);
    expect(arquivosValidos([arq(25 * MB, 'application/pdf')])).toBe(false);
    expect(arquivosValidos([arq(1 * MB, 'application/pdf'), arq(1 * MB, 'image/jpeg')])).toBe(false);
    expect(arquivosValidos(Array.from({ length: 5 }, () => arq(6 * MB, 'image/heic')))).toBe(true); // 30 MB exatos
    expect(arquivosValidos(Array.from({ length: 4 }, () => arq(9 * MB, 'image/jpeg')))).toBe(false); // 36 MB
    expect(arquivosValidos(Array.from({ length: 6 }, () => arq(1 * MB, 'image/jpeg')))).toBe(false);
    expect(arquivosValidos([arq(15 * MB, 'image/jpeg')])).toBe(false);
    expect(arquivosValidos([])).toBe(false);
  });
});
```

Criar `src/app/p/(portal)/exames/page.test.ts`:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeuEnvio } from '@/modules/portal/exames-enviados';

// Só a montagem da página: sessão e lista simuladas.
const sessao = { ligado: true };
const lista: MeuEnvio[] = [];
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, tenant: { fuso: 'America/Sao_Paulo', examesPacienteAtivadoEm: sessao.ligado ? new Date() : null } }),
}));
vi.mock('@/modules/portal/exames-enviados', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/portal/exames-enviados')>()),
  meusEnvios: vi.fn(async () => lista),
}));
vi.mock('./actions', () => ({ cancelarEnvioAction: async () => ({}) }));
const { default: MeusExames } = await import('./page');

const envio = (o: Partial<MeuEnvio>): MeuEnvio => ({
  id: '00000000-0000-4000-8000-0000000000e1',
  enviadoEm: new Date('2026-10-07T13:00:00Z'),
  dataColeta: '2026-09-28',
  nome: 'Hemograma',
  status: 'recebido',
  situacao: 'Aguardando sua nutricionista',
  podeBaixar: true,
  mostraCancelar: true,
  ...o,
});
const render = async () => renderToStaticMarkup(await MeusExames());

describe('/p/exames (US-160, US-161)', () => {
  beforeEach(() => {
    sessao.ligado = true;
    lista.length = 0;
  });

  it('com o recebimento ligado: o formulário e a lista com a situação em texto, o download e o cancelamento', async () => {
    lista.push(envio({}), envio({ id: '00000000-0000-4000-8000-0000000000e2', nome: null, status: 'aceito', situacao: 'Recebido no seu prontuário', podeBaixar: false, mostraCancelar: false }));
    const html = await render();
    expect(html).toContain('Enviar exame');
    expect(html).toContain('Meus exames enviados');
    expect(html).toContain('Aguardando sua nutricionista');
    expect(html).toContain('Recebido no seu prontuário');
    expect(html).toContain('Exame enviado em 07/10/2026');
    expect(html).toContain('href="/api/p/exames/00000000-0000-4000-8000-0000000000e1/pdf"');
    expect(html).not.toContain('/api/p/exames/00000000-0000-4000-8000-0000000000e2/pdf');
    expect((html.match(/Cancelar envio/g) ?? []).length).toBe(1);
  });

  it('com o recebimento desligado: sem "Enviar exame"; os envios antigos continuam na lista', async () => {
    sessao.ligado = false;
    lista.push(envio({}));
    const html = await render();
    expect(html).not.toContain('Enviar exame');
    expect(html).toContain('Aguardando sua nutricionista');
  });

  it('sem envios: "Nenhum exame enviado ainda."', async () => {
    expect(await render()).toContain('Nenhum exame enviado ainda.');
  });
});
```

Em `src/app/p/navegacao.test.ts`, acrescentar ao teste da US-146 (ou num `it` novo): `expect(itemAtual('/p/exames')).toBe('/p/perfil');`.

Run: `pnpm vitest run "src/app/p/(portal)/exames" src/app/p/navegacao.test.ts`
Expected: FAIL (arquivos inexistentes; `/p/exames` não marca "Perfil").

- [ ] **Step 2: Barra, Perfil e Início (D4 ★)**

Em `src/app/p/navegacao.ts`: trocar a entrada de Perfil por `{ href: '/p/perfil', rotulo: 'Perfil', tambem: ['/p/documentos', '/p/exames'] },` e completar o comentário do topo: "Plano 12 (PM-10): "Exames" também não é aba — marca "Perfil" (link "Meus exames" em Perfil e "Enviar exame" no Início)."

Em `src/app/p/(portal)/perfil/page.tsx`, depois do bloco de "Meus documentos":

```tsx
      {tenant.examesPacienteAtivadoEm && (
        <p>
          <Link href="/p/exames" className="inline-flex min-h-11 items-center underline">
            Meus exames
          </Link>
        </p>
      )}
```

Em `src/app/p/(portal)/inicio/page.tsx`, importar `import { BotaoLink } from '@/components/ui/botao';` e, depois do cartão "Documentos":

```tsx
      {/* US-160 / PM-10: só com o recebimento ligado pela nutricionista (D18 = a) */}
      {tenant.examesPacienteAtivadoEm && (
        <p>
          <BotaoLink href="/p/exames" variante="secundario">Enviar exame</BotaoLink>
        </p>
      )}
```

- [ ] **Step 3: O formulário de envio**

Criar `src/app/p/(portal)/exames/envio-form.tsx`:

```tsx
'use client';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, type FormEvent } from 'react';
import {
  ENVIO_FOTO_MAX_BYTES, ENVIO_MAX_FOTOS, ENVIO_PDF_MAX_BYTES, ENVIO_TOTAL_MAX_BYTES, MSG_ENVIO, NOME_ENVIO_MAX, OBSERVACAO_ENVIO_MAX,
} from '@/modules/pacientes/exames-enviados-constantes';
import { linkDaRecusa, recusaDoPortal } from '../../recusa-api';

type Campo = 'dataColeta' | 'nome' | 'observacao' | 'arquivos' | 'geral';
type Erros = Partial<Record<Campo, string>>;

/** true só no cliente depois da hidratação (no servidor e na hidratação, false) — sem setState em efeito. */
const semInscricao = () => () => {};

/** RN-161 no navegador, pelo tamanho e pelo tipo declarado (o servidor confere de novo, pelo conteúdo). */
export function arquivosValidos(arquivos: { size: number; type: string }[]): boolean {
  if (!arquivos.length || arquivos.length > ENVIO_MAX_FOTOS) return false;
  if (arquivos.reduce((s, a) => s + a.size, 0) > ENVIO_TOTAL_MAX_BYTES) return false;
  if (arquivos.some((a) => a.type === 'application/pdf')) return arquivos.length === 1 && arquivos[0].size <= ENVIO_PDF_MAX_BYTES;
  return arquivos.every((a) => a.size <= ENVIO_FOTO_MAX_BYTES);
}

/** US-160: envia por fetch (multipart) para /api/p/exames; o worker processa depois ("Processando…" na lista). */
export function EnvioForm({ hoje }: { hoje: string }) {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [ok, setOk] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [link, setLink] = useState<{ href: string; texto: string } | null>(null);
  /** P09-04: antes da hidratação, "Enviar" faria o envio nativo; o botão nasce desabilitado. */
  const hidratado = useSyncExternalStore(semInscricao, () => true, () => false);
  const enviar = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const dados = new FormData(form);
    const arquivos = dados.getAll('arquivos').filter((a): a is File => a instanceof File && a.size > 0);
    setOk(null);
    setLink(null);
    if (!arquivosValidos(arquivos)) return setErros({ arquivos: MSG_ENVIO.arquivos });
    setEnviando(true);
    setErros({});
    try {
      const r = await fetch('/api/p/exames', { method: 'POST', body: dados });
      const corpo = (await r.json().catch(() => ({}))) as { erros?: Erros; mensagem?: string };
      if (!r.ok) {
        // recusa da sessão ({ erro }: 401 expirada, 403 termo/indisponível/escolher) — não é erro de campo; o formulário fica
        const recusa = recusaDoPortal(r.status, corpo, '/p/exames');
        if (recusa) {
          setLink(linkDaRecusa(recusa));
          return setErros({ geral: recusa.mensagem });
        }
        return setErros(corpo.erros && Object.keys(corpo.erros).length ? corpo.erros : { geral: MSG_ENVIO.ocupado });
      }
      setOk(corpo.mensagem ?? MSG_ENVIO.enviado);
      form.reset();
      router.refresh();
    } catch {
      setErros({ geral: MSG_ENVIO.ocupado });
    } finally {
      setEnviando(false);
    }
  };
  const descrito = (id: Campo, dica?: string) => {
    const ids = [dica, erros[id] ? `${id}-erro` : undefined].filter(Boolean).join(' ');
    return { ...(erros[id] ? { 'aria-invalid': true } : {}), ...(ids ? { 'aria-describedby': ids } : {}) };
  };
  const erro = (id: Campo) => erros[id] && <p id={`${id}-erro`} role="alert" className="text-sm text-erro">{erros[id]}</p>;
  return (
    <form method="post" onSubmit={enviar} className="space-y-3" noValidate>
      <div className="space-y-1">
        <label htmlFor="dataColeta" className="block font-medium">Data da coleta</label>
        <input id="dataColeta" name="dataColeta" type="date" max={hoje} required className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...descrito('dataColeta')} />
        {erro('dataColeta')}
      </div>
      <div className="space-y-1">
        <label htmlFor="nome" className="block font-medium">Nome do exame (opcional)</label>
        <input id="nome" name="nome" maxLength={NOME_ENVIO_MAX} className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...descrito('nome')} />
        {erro('nome')}
      </div>
      <div className="space-y-1">
        <label htmlFor="observacao" className="block font-medium">Observação (opcional)</label>
        <textarea id="observacao" name="observacao" maxLength={OBSERVACAO_ENVIO_MAX} rows={3} className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...descrito('observacao', 'observacao-dica')} />
        <p id="observacao-dica" className="text-sm text-suave">{MSG_ENVIO.dicaObservacao}</p>
        {erro('observacao')}
      </div>
      <div className="space-y-1">
        <label htmlFor="arquivos" className="block font-medium">PDF ou fotos do exame</label>
        <input id="arquivos" name="arquivos" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/heic,image/heif" className="block min-h-11 w-full max-w-full" {...descrito('arquivos', 'arquivos-dica')} />
        <p id="arquivos-dica" className="text-sm text-suave">{MSG_ENVIO.arquivos}</p>
        {erro('arquivos')}
      </div>
      {erros.geral && (
        <p role="alert" className="text-erro">
          {erros.geral}
          {link && (
            <>
              {' '}
              <a href={link.href} className="inline-flex min-h-11 items-center underline">{link.texto}</a>
            </>
          )}
        </p>
      )}
      {ok && <p role="status" className="rounded bg-ok-fundo p-3">{ok}</p>}
      <button disabled={enviando || !hidratado} className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white">Enviar</button>
    </form>
  );
}
```

- [ ] **Step 4: Cancelar e a página**

Criar `src/app/p/(portal)/exames/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { requirePaciente } from '@/lib/paciente-session';
import { cancelarMeuEnvio, EnvioError } from '@/modules/portal/exames-enviados';

export type CancelarState = { erro?: string };

/** US-161 "Cancelar envio": o paciente e o consultório vêm da sessão; o módulo confere o id e a situação. */
export async function cancelarEnvioAction(id: string, _prev: CancelarState, _fd: FormData): Promise<CancelarState> {
  const { ctx } = await requirePaciente('/p/exames');
  try {
    await cancelarMeuEnvio(ctx, id);
  } catch (e) {
    if (e instanceof EnvioError) return { erro: e.erros.geral };
    throw e;
  }
  revalidatePath('/p/exames');
  return {};
}
```

Criar `src/app/p/(portal)/exames/cancelar-envio.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { MSG_ENVIO } from '@/modules/pacientes/exames-enviados-constantes';
import { cancelarEnvioAction, type CancelarState } from './actions';

/** US-161: "Cancelar envio" — no "recebido" pede a confirmação da spec; no "processando" o servidor responde "Aguarde…". */
export function CancelarEnvio({ id, processando, rotulo }: { id: string; processando: boolean; rotulo: string }) {
  const [state, action, pendente] = useActionState<CancelarState, FormData>(cancelarEnvioAction.bind(null, id), {});
  const idErro = `cancelar-erro-${id}`;
  return (
    <form action={action} className="space-y-1">
      <button
        disabled={pendente}
        aria-describedby={state.erro ? idErro : undefined}
        className="inline-flex min-h-11 items-center underline"
        onClick={(e) => {
          if (!processando && !window.confirm(MSG_ENVIO.confirmarCancelar)) e.preventDefault();
        }}
      >
        Cancelar envio<span className="sr-only">{` ${rotulo}`}</span>
      </button>
      {state.erro && <p id={idErro} role="alert" className="text-sm text-erro">{state.erro}</p>}
    </form>
  );
}
```

Criar `src/app/p/(portal)/exames/page.tsx`:

```tsx
import { requirePaciente } from '@/lib/paciente-session';
import { formatarData, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { MSG_ENVIO, nomeDoEnvio } from '@/modules/pacientes/exames-enviados-constantes';
import { meusEnvios } from '@/modules/portal/exames-enviados';
import { CancelarEnvio } from './cancelar-envio';
import { EnvioForm } from './envio-form';

export const dynamic = 'force-dynamic';

/**
 * US-160 / US-161 (PM-10 = molde de "Documentos"): "Meus exames" — não é aba; marca "Perfil" (`tambem`). O formulário só
 * com o recebimento ligado (D18 = a); a lista continua (os envios antigos). Fora da cópia offline (o service worker só
 * guarda /p/plano). A lista é auditada no módulo (D22).
 */
export default async function MeusExames() {
  const { ctx, tenant } = await requirePaciente('/p/exames');
  const lista = await meusEnvios(ctx);
  const data = (d: Date) => formatarDataNoFuso(d, tenant.fuso);
  return (
    <main className="space-y-6 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Meus exames</h1>
      {tenant.examesPacienteAtivadoEm && (
        <section aria-labelledby="enviar" className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
          <h2 id="enviar" className="text-lg font-semibold">Enviar exame</h2>
          <EnvioForm hoje={hojeNoFuso(tenant.fuso)} />
        </section>
      )}
      <section aria-labelledby="enviados" className="space-y-3">
        <h2 id="enviados" className="text-lg font-semibold">Meus exames enviados</h2>
        {lista.length === 0 && <p>{MSG_ENVIO.nenhum}</p>}
        <ul className="space-y-4">
          {lista.map((e) => {
            const nome = nomeDoEnvio(e.nome, data(e.enviadoEm));
            return (
              <li key={e.id} className="space-y-2 rounded-2xl border border-borda bg-cartao p-4">
                <h3 className="font-semibold">{nome}</h3>
                <p className="text-sm text-suave">{`Enviado em ${data(e.enviadoEm)} · Coleta em ${formatarData(e.dataColeta)}`}</p>
                <p>{e.situacao}</p>
                {e.podeBaixar && (
                  <a href={`/api/p/exames/${e.id}/pdf`} className="inline-flex min-h-11 items-center underline">
                    Baixar PDF<span className="sr-only">{` do ${nome}`}</span>
                  </a>
                )}
                {e.mostraCancelar && <CancelarEnvio id={e.id} processando={e.status === 'processando'} rotulo={`do ${nome}`} />}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Axe e o seed do E2E**

Em `e2e/acessibilidade.spec.ts`, acrescentar `'/p/exames'` ao fim de `ROTAS`. Em `scripts/e2e-seed.ts`, depois de `const IA = …`:

```ts
// Plano 12 (D18 = a): o recebimento de exames pelo app ligado no consultório do E2E (o axe passa por /p/exames com o formulário)
const EXAMES_APP = { examesPacienteAtivadoEm: new Date(), examesAvisoEm: null };
```

e acrescentar `...EXAMES_APP` ao `values({ …, ...IA })` e ao `set: { …, ...IA }` do consultório do E2E.

- [ ] **Step 6: Rodar e commitar**

Run: `pnpm vitest run "src/app/p/(portal)/exames" src/app/p/navegacao.test.ts src/app/formularios-post.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, sem erros.

```bash
git add "src/app/p/(portal)/exames" src/app/p/navegacao.ts src/app/p/navegacao.test.ts "src/app/p/(portal)/perfil/page.tsx" "src/app/p/(portal)/inicio/page.tsx" \
  e2e/acessibilidade.spec.ts scripts/e2e-seed.ts
git commit -m "feat(exames-enviados): telas do portal — Meus exames, enviar, acompanhar, baixar e cancelar (P12-10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 11: Telas do painel — fila "Exames recebidos", abrir o envio, aceitar (e ler com IA), recusar, menu com contador e o prontuário (P12-11)

**Revisão: leve (revisor-interface)** — telas, textos da spec, acessibilidade, menu (D11) e a mensagem da IA (lista fechada); a regra de negócio já passou pela revisão completa na T7.

**Files:**
- Create: `src/app/painel/exames-recebidos/page.tsx`, `src/app/painel/exames-recebidos/[id]/page.tsx`, `src/app/painel/exames-recebidos/[id]/actions.ts` (+ `actions.test.ts`), `src/app/painel/exames-recebidos/[id]/aceitar-form.tsx`, `src/app/painel/exames-recebidos/[id]/recusar-form.tsx`, `src/modules/pacientes/exames-enviados-ia.ts` (+ `exames-enviados-ia.test.ts`)
- Modify: `src/app/painel/navegacao.ts` (+ `navegacao.test.ts`), `src/app/painel/menu-painel.tsx`, `src/app/painel/cabecalho.tsx`, `src/app/painel/layout.tsx`, `src/app/painel/pacientes/[id]/exames/page.tsx`, `e2e/painel-rotas.ts`, `e2e/painel.ts`

**Interfaces:**
- Consumes: T7 (`filaDeEnvios`, `contarEnviosRecebidos`, `contarEnviosDoPaciente`, `examesEnviadosPeloPaciente`, `abrirEnvio`, `aceitarEnvio`, `recusarEnvio`, `RevisaoError`), T2 (textos, `nomeDoEnvio`, `diasEntre`, `haDias`, `ROTULO_MOTIVO_RECUSA`); `pedirLeituraExame`, `PedidoIaError` (`src/modules/ia/tarefas.ts`), `configIA`, `estadoIaDoTenant` (`modo.ts`), `motivoDoPaciente` (`ciencia-paciente.ts`), `MSG_IA`, `MSG_FALHA` (`constantes.ts`); `PacienteBloqueadoError`; `signFileUrl`; `Aviso`, `Botao`, `Selo`.
- Produces: `/painel/exames-recebidos` e `/painel/exames-recebidos/[id]`; `aceitarEnvioAction(id, prev, fd)`, `recusarEnvioAction(id, prev, fd)`, `RevisaoState`; `chaveDaMensagemIa(mensagem)`, `mensagemIaDaChave(chave)`; `ITEM_EXAMES`, `itensDoMenu({ exames })`, `rotuloDoItem(rotulo, n)`; `MenuPainel({ exames })`; `IdsDoPainel.envio`.

- [ ] **Step 1: Testes (falham)**

Criar `src/modules/pacientes/exames-enviados-ia.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MSG_FALHA, MSG_IA } from '@/modules/ia/constantes';
import { chaveDaMensagemIa, mensagemIaDaChave } from './exames-enviados-ia';

describe('mensagem da IA pela URL (US-163 "Aceitar e ler, com a IA recusando o pedido")', () => {
  it('só uma CHAVE de lista fechada vai à URL; a tela mostra o texto da lista, nunca o que veio na URL', () => {
    const chave = chaveDaMensagemIa(MSG_IA.cotaAcabou)!;
    expect(chave).toBe('ia.cotaAcabou');
    expect(mensagemIaDaChave(chave)).toBe('O limite de uso da IA deste mês acabou. Ele renova no dia 1º ou quando o suporte ampliar o limite.');
    expect(mensagemIaDaChave(chaveDaMensagemIa(MSG_FALHA.arquivo_invalido))).toBe(MSG_FALHA.arquivo_invalido);
    expect(chaveDaMensagemIa('texto qualquer')).toBeNull();
    for (const ruim of ['<script>alert(1)</script>', 'ia.usoDoMes', 'toString', '__proto__', undefined, 42]) expect(mensagemIaDaChave(ruim)).toBeNull();
  });
});
```

Criar `src/app/painel/exames-recebidos/[id]/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sessao = { ctx: { tenantId: '00000000-0000-4000-8000-000000000001', role: 'nutri', actorUserId: '00000000-0000-4000-8000-000000000002' }, tenant: { fuso: 'America/Sao_Paulo' } };
vi.mock('@/lib/tenant-session', () => ({ requireNutri: vi.fn(async () => sessao) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn((u: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url: u }); }), notFound: vi.fn() }));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'fake', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
const aceitar = vi.fn();
const recusar = vi.fn();
const pedir = vi.fn();
vi.mock('@/modules/pacientes/exames-enviados', async (orig) => ({ ...(await orig<typeof import('@/modules/pacientes/exames-enviados')>()), aceitarEnvio: aceitar, recusarEnvio: recusar }));
vi.mock('@/modules/ia/tarefas', async (orig) => ({ ...(await orig<typeof import('@/modules/ia/tarefas')>()), pedirLeituraExame: pedir }));

const { aceitarEnvioAction, recusarEnvioAction } = await import('./actions');
const { RevisaoError } = await import('@/modules/pacientes/exames-enviados');
const { PedidoIaError } = await import('@/modules/ia/tarefas');
const { MSG_IA } = await import('@/modules/ia/constantes');

const ENVIO = '00000000-0000-4000-8000-0000000000e1';
const P = '00000000-0000-4000-8000-0000000000aa';
const EXAME = '00000000-0000-4000-8000-0000000000bb';
const fd = (campos: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
beforeEach(() => {
  vi.clearAllMocks();
  aceitar.mockResolvedValue({ examId: EXAME, patientId: P });
});

describe('ações da revisão do envio (US-163, US-164)', () => {
  it('"Salvar no prontuário": aceita com título e data e vai ao prontuário com "Exame salvo no prontuário."; sem leitura por IA', async () => {
    await expect(aceitarEnvioAction(ENVIO, {}, fd({ titulo: 'Hemograma', data: '2026-09-28' }))).rejects.toMatchObject({ url: `/painel/pacientes/${P}/exames?envio=salvo` });
    expect(aceitar).toHaveBeenCalledWith(sessao.ctx, sessao.tenant, ENVIO, { titulo: 'Hemograma', data: '2026-09-28' });
    expect(pedir).not.toHaveBeenCalled();
  });

  it('"Aceitar e ler valores com IA": aceita e DEPOIS pede a leitura; a recusa da IA não desfaz o aceite e vai como chave', async () => {
    await expect(aceitarEnvioAction(ENVIO, {}, fd({ titulo: 'Hemograma', data: '2026-09-28', ler: '1' }))).rejects.toMatchObject({ url: `/painel/pacientes/${P}/exames?envio=salvo` });
    expect(pedir).toHaveBeenCalledWith(sessao.ctx, sessao.tenant, P, EXAME, expect.objectContaining({ ia: expect.objectContaining({ modo: 'fake' }) }));
    pedir.mockRejectedValueOnce(new PedidoIaError(MSG_IA.cotaAcabou));
    await expect(aceitarEnvioAction(ENVIO, {}, fd({ titulo: 'Hemograma', data: '2026-09-28', ler: '1' }))).rejects.toMatchObject({ url: `/painel/pacientes/${P}/exames?envio=salvo&iaMsg=ia.cotaAcabou` });
  });

  it('erros da revisão voltam à tela (corridas, título, motivo); recusa vai à fila com "Envio recusado."', async () => {
    aceitar.mockRejectedValueOnce(new RevisaoError({ geral: 'Este envio foi cancelado pelo paciente.' }));
    expect(await aceitarEnvioAction(ENVIO, {}, fd({ titulo: 'X', data: '2026-09-28' }))).toEqual({ erros: { geral: 'Este envio foi cancelado pelo paciente.' } });
    recusar.mockRejectedValueOnce(new RevisaoError({ texto: 'Escreva o motivo para o paciente' }));
    expect(await recusarEnvioAction(ENVIO, {}, fd({ motivo: 'outro', texto: '' }))).toEqual({ erros: { texto: 'Escreva o motivo para o paciente' } });
    await expect(recusarEnvioAction(ENVIO, {}, fd({ motivo: 'ilegivel' }))).rejects.toMatchObject({ url: '/painel/exames-recebidos?recusado=1' });
    expect(recusar).toHaveBeenLastCalledWith(sessao.ctx, ENVIO, { motivo: 'ilegivel', texto: null });
  });
});
```

Em `src/app/painel/navegacao.test.ts`, importar também `ITEM_EXAMES, itensDoMenu, rotuloDoItem` e acrescentar:

```ts
  it('Plano 12 (D11): "Exames recebidos" entra depois de "Diários" só quando pedido, com o contador no rótulo; marca as subpáginas', () => {
    expect(itensDoMenu({ exames: false }).map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Conteúdos', 'Configurações']);
    expect(itensDoMenu({ exames: true }).map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Exames recebidos', 'Conteúdos', 'Configurações']);
    expect(rotuloDoItem(ITEM_EXAMES.rotulo, 3)).toBe('Exames recebidos (3)');
    expect(rotuloDoItem(ITEM_EXAMES.rotulo, 0)).toBe('Exames recebidos');
    expect(itemAtual('/painel/exames-recebidos')).toBe('/painel/exames-recebidos');
    expect(itemAtual('/painel/exames-recebidos/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b')).toBe('/painel/exames-recebidos');
  });
```

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-ia.test.ts "src/app/painel/exames-recebidos" src/app/painel/navegacao.test.ts`
Expected: FAIL (arquivos e exportações inexistentes).

- [ ] **Step 2: A mensagem da IA em lista fechada**

Criar `src/modules/pacientes/exames-enviados-ia.ts`:

```ts
import { MSG_FALHA, MSG_IA } from '@/modules/ia/constantes';

/**
 * US-163 "Aceitar e ler, com a IA recusando o pedido": depois do aceite, a tela do prontuário mostra "Exame salvo no
 * prontuário." e a mensagem da US-110. Pela URL vai só a CHAVE de uma lista fechada (os textos de MSG_IA e MSG_FALHA);
 * a tela mostra o texto da lista — nunca o que veio na URL.
 */
const MENSAGENS: Record<string, string> = Object.fromEntries([
  ...Object.entries(MSG_IA).flatMap(([k, v]) => (typeof v === 'string' ? [[`ia.${k}`, v] as const] : [])),
  ...Object.entries(MSG_FALHA).map(([k, v]) => [`falha.${k}`, v] as const),
]);

export const chaveDaMensagemIa = (mensagem: string): string | null => Object.entries(MENSAGENS).find(([, v]) => v === mensagem)?.[0] ?? null;

export const mensagemIaDaChave = (chave: unknown): string | null => (typeof chave === 'string' && Object.hasOwn(MENSAGENS, chave) ? MENSAGENS[chave] : null);
```

- [ ] **Step 3: Ações e formulários da revisão**

Criar `src/app/painel/exames-recebidos/[id]/actions.ts`:

```ts
'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getEnv } from '@/env';
import { requireNutri } from '@/lib/tenant-session';
import { configIA } from '@/modules/ia/modo';
import { pedirLeituraExame, PedidoIaError } from '@/modules/ia/tarefas';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { aceitarEnvio, recusarEnvio, RevisaoError } from '@/modules/pacientes/exames-enviados';
import { chaveDaMensagemIa } from '@/modules/pacientes/exames-enviados-ia';

export type RevisaoState = { erros?: Partial<Record<'titulo' | 'data' | 'motivo' | 'texto' | 'geral', string>> };

/**
 * US-163: "Salvar no prontuário" e "Aceitar e ler valores com IA" (o mesmo formulário: título e data valem para os dois). O
 * aceite é uma transação; a leitura por IA vem DEPOIS (`pedirLeituraExame`, transação própria do Plano 11) e a recusa dela
 * não desfaz o aceite. O consultório, a usuária e o paciente vêm da sessão e do envio, nunca do formulário.
 */
export async function aceitarEnvioAction(id: string, _prev: RevisaoState, fd: FormData): Promise<RevisaoState> {
  const { ctx, tenant } = await requireNutri('/painel/exames-recebidos');
  let aceito: { examId: string; patientId: string };
  try {
    aceito = await aceitarEnvio(ctx, tenant, id, { titulo: fd.get('titulo'), data: fd.get('data') });
  } catch (e) {
    if (e instanceof RevisaoError) return { erros: e.erros };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message } };
    throw e;
  }
  let iaMsg: string | null = null;
  if (fd.get('ler') === '1') {
    try {
      await pedirLeituraExame(ctx, tenant, aceito.patientId, aceito.examId, { ia: configIA(getEnv()) });
    } catch (e) {
      if (!(e instanceof PedidoIaError)) throw e;
      iaMsg = chaveDaMensagemIa(e.mensagem);
    }
  }
  revalidatePath('/painel', 'layout'); // o contador do menu
  redirect(`/painel/pacientes/${aceito.patientId}/exames?envio=salvo${iaMsg ? `&iaMsg=${encodeURIComponent(iaMsg)}` : ''}`);
}

/** US-164 / RN-165: "Confirmar recusa" com o motivo da lista (e o texto, em "Outro motivo"). */
export async function recusarEnvioAction(id: string, _prev: RevisaoState, fd: FormData): Promise<RevisaoState> {
  const { ctx } = await requireNutri('/painel/exames-recebidos');
  try {
    await recusarEnvio(ctx, id, { motivo: fd.get('motivo'), texto: fd.get('texto') });
  } catch (e) {
    if (e instanceof RevisaoError) return { erros: e.erros };
    if (e instanceof PacienteBloqueadoError) return { erros: { geral: e.message } };
    throw e;
  }
  revalidatePath('/painel', 'layout');
  redirect('/painel/exames-recebidos?recusado=1');
}
```

Criar `src/app/painel/exames-recebidos/[id]/aceitar-form.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { aceitarEnvioAction, type RevisaoState } from './actions';

/** US-163: "Aceitar" abre o formulário com "Título" e "Data" (do envio, editáveis); "Aceitar e ler" só com a IA disponível. */
export function AceitarForm({ id, tituloInicial, dataInicial, hoje, comIa }: { id: string; tituloInicial: string; dataInicial: string; hoje: string; comIa: boolean }) {
  const [state, action, pendente] = useActionState<RevisaoState, FormData>(aceitarEnvioAction.bind(null, id), {});
  const e = state.erros ?? {};
  const campo = (c: 'titulo' | 'data') => (e[c] ? { 'aria-invalid': true, 'aria-describedby': `aceitar-${c}-erro` } : {});
  return (
    <details open={!!state.erros} className="rounded-2xl border border-borda bg-cartao p-4">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Aceitar</summary>
      <form action={action} className="mt-3 space-y-3">
        <div className="space-y-1">
          <label htmlFor="aceitar-titulo" className="block font-medium">Título</label>
          <input id="aceitar-titulo" name="titulo" defaultValue={tituloInicial} maxLength={120} required className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...campo('titulo')} />
          {e.titulo && <p id="aceitar-titulo-erro" role="alert" className="text-sm text-erro">{e.titulo}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="aceitar-data" className="block font-medium">Data</label>
          <input id="aceitar-data" name="data" type="date" defaultValue={dataInicial} max={hoje} required className="min-h-11 w-full rounded-xl border border-campo bg-cartao p-2 text-texto" {...campo('data')} />
          {e.data && <p id="aceitar-data-erro" role="alert" className="text-sm text-erro">{e.data}</p>}
        </div>
        {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
        <div className="flex flex-wrap gap-3">
          <Botao disabled={pendente}>Salvar no prontuário</Botao>
          {comIa && (
            <Botao variante="secundario" name="ler" value="1" disabled={pendente}>
              Aceitar e ler valores com IA
            </Botao>
          )}
        </div>
      </form>
    </details>
  );
}
```

Criar `src/app/painel/exames-recebidos/[id]/recusar-form.tsx`:

```tsx
'use client';
import { useActionState } from 'react';
import { Botao } from '@/components/ui/botao';
import { MOTIVO_RECUSA_TEXTO_MAX, MOTIVOS_RECUSA, ROTULO_MOTIVO_RECUSA } from '@/modules/pacientes/exames-enviados-constantes';
import { recusarEnvioAction, type RevisaoState } from './actions';

/** US-164: o motivo da lista (o paciente vê "Não aceito: {motivo}"); "Outro motivo" com o texto de até 300 caracteres. */
export function RecusarForm({ id }: { id: string }) {
  const [state, action, pendente] = useActionState<RevisaoState, FormData>(recusarEnvioAction.bind(null, id), {});
  const e = state.erros ?? {};
  return (
    <details open={!!state.erros} className="rounded-2xl border border-borda bg-cartao p-4">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">Recusar</summary>
      <form action={action} className="mt-3 space-y-3">
        <fieldset className="space-y-1" aria-describedby={e.motivo ? 'recusar-motivo-erro' : undefined}>
          <legend className="font-medium">Motivo</legend>
          {MOTIVOS_RECUSA.map((m) => (
            <div key={m} className="flex min-h-11 items-center gap-3">
              <input id={`motivo-${m}`} type="radio" name="motivo" value={m} className="h-5 w-5" />
              <label htmlFor={`motivo-${m}`}>{ROTULO_MOTIVO_RECUSA[m]}</label>
            </div>
          ))}
        </fieldset>
        {e.motivo && <p id="recusar-motivo-erro" role="alert" className="text-sm text-erro">{e.motivo}</p>}
        <div className="space-y-1">
          <label htmlFor="recusar-texto" className="block font-medium">Escreva o motivo</label>
          <textarea
            id="recusar-texto"
            name="texto"
            maxLength={MOTIVO_RECUSA_TEXTO_MAX}
            rows={3}
            className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"
            {...(e.texto ? { 'aria-invalid': true, 'aria-describedby': 'recusar-texto-erro' } : {})}
          />
          {e.texto && <p id="recusar-texto-erro" role="alert" className="text-sm text-erro">{e.texto}</p>}
        </div>
        {e.geral && <p role="alert" className="text-erro">{e.geral}</p>}
        <Botao variante="secundario" disabled={pendente}>Confirmar recusa</Botao>
      </form>
    </details>
  );
}
```

- [ ] **Step 4: As duas telas**

Criar `src/app/painel/exames-recebidos/page.tsx`:

```tsx
import Link from 'next/link';
import { Aviso } from '@/components/ui/aviso';
import { requireNutri } from '@/lib/tenant-session';
import { formatarData, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { filaDeEnvios } from '@/modules/pacientes/exames-enviados';
import { diasEntre, haDias, MSG_REVISAO, nomeDoEnvio } from '@/modules/pacientes/exames-enviados-constantes';

export const dynamic = 'force-dynamic';

/** US-162: a fila — os envios "recebido" de todos os pacientes, os mais antigos primeiro. Só lista (sem auditoria). */
export default async function ExamesRecebidos({ searchParams }: PageProps<'/painel/exames-recebidos'>) {
  const { ctx, tenant } = await requireNutri('/painel/exames-recebidos');
  const { recusado } = await searchParams;
  const fila = await filaDeEnvios(ctx);
  const hoje = hojeNoFuso(tenant.fuso);
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">Exames recebidos</h1>
      {recusado === '1' && <Aviso tipo="ok">{MSG_REVISAO.recusado}</Aviso>}
      {fila.length === 0 ? (
        <p>{MSG_REVISAO.filaVazia}</p>
      ) : (
        <table data-guia="fila-exames" className="w-full text-left">
          <caption className="sr-only">Exames enviados pelos pacientes aguardando revisão</caption>
          <thead className="text-sm text-suave">
            <tr>
              <th scope="col">Paciente</th>
              <th scope="col">Exame</th>
              <th scope="col">Enviado em</th>
              <th scope="col">Coleta</th>
              <th scope="col">Aguardando</th>
            </tr>
          </thead>
          <tbody>
            {fila.map((e) => {
              const enviado = formatarDataNoFuso(e.enviadoEm, tenant.fuso);
              const nome = nomeDoEnvio(e.nome, enviado);
              return (
                <tr key={e.id} className="border-t border-linha">
                  <td>
                    <Link href={`/painel/exames-recebidos/${e.id}`} className="inline-flex min-h-11 items-center text-link underline">
                      {e.paciente}
                      <span className="sr-only">{` — abrir ${nome}`}</span>
                    </Link>
                  </td>
                  <td>{nome}</td>
                  <td>{enviado}</td>
                  <td>{formatarData(e.dataColeta)}</td>
                  <td>{haDias(diasEntre(hojeNoFuso(tenant.fuso, e.enviadoEm), hoje))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
```

Criar `src/app/painel/exames-recebidos/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEnv } from '@/env';
import { signFileUrl } from '@/lib/signed-url';
import { requireNutri } from '@/lib/tenant-session';
import { motivoDoPaciente } from '@/modules/ia/ciencia-paciente';
import { configIA, estadoIaDoTenant } from '@/modules/ia/modo';
import { formatarData, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { abrirEnvio } from '@/modules/pacientes/exames-enviados';
import { MSG_REVISAO, nomeDoEnvio } from '@/modules/pacientes/exames-enviados-constantes';
import { AceitarForm } from './aceitar-form';
import { RecusarForm } from './recusar-form';

export const dynamic = 'force-dynamic';

/**
 * US-162/US-163/US-164: as páginas do envio como IMAGENS ao lado das ações (D23 = a: URL assinada de 5 min; a rota serve
 * imagem inline), a observação, o PDF limpo para baixar, Aceitar e Recusar. Abrir é auditado (abrirEnvio). "Aceitar e ler"
 * só com a IA ativa no consultório e o paciente apto (US-163 "IA indisponível").
 */
export default async function EnvioRecebido({ params }: PageProps<'/painel/exames-recebidos/[id]'>) {
  const { ctx, tenant } = await requireNutri('/painel/exames-recebidos');
  const { id } = await params;
  const envio = await abrirEnvio(ctx, id);
  if (!envio) notFound();
  const comIa = estadoIaDoTenant(tenant, configIA(getEnv()).modo) === 'ativa' && motivoDoPaciente(envio.paciente) === null;
  const enviado = formatarDataNoFuso(envio.enviadoEm, tenant.fuso);
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <p>
        <Link href="/painel/exames-recebidos" className="inline-flex min-h-11 items-center text-link underline">Voltar para Exames recebidos</Link>
      </p>
      <h1 className="font-titulo text-2xl font-semibold">{nomeDoEnvio(envio.nome, enviado)}</h1>
      <p className="text-suave">{`${envio.paciente.nome} · enviado em ${enviado} · coleta em ${formatarData(envio.dataColeta)}`}</p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section aria-label="Páginas do exame" className="space-y-3">
          {envio.paginas.map((c, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min (signFileUrl), não passa pelo otimizador
            <img key={c} src={signFileUrl(c)} alt={`Página ${i + 1} de ${envio.paginas.length} do exame enviado`} className="w-full rounded border border-borda" />
          ))}
        </section>
        <section aria-labelledby="revisao" className="space-y-4">
          <h2 id="revisao" className="text-lg font-semibold">Revisão</h2>
          {envio.observacao && (
            <p className="whitespace-pre-line">
              <strong>Observação do paciente: </strong>
              {envio.observacao}
            </p>
          )}
          {envio.pdf && (
            <p>
              <a href={signFileUrl(envio.pdf)} className="inline-flex min-h-11 items-center text-link underline">Baixar PDF</a>
            </p>
          )}
          {envio.status === 'recebido' ? (
            <>
              <AceitarForm id={envio.id} tituloInicial={envio.nome ?? 'Exame'} dataInicial={envio.dataColeta} hoje={hojeNoFuso(tenant.fuso)} comIa={comIa} />
              <RecusarForm id={envio.id} />
            </>
          ) : (
            <p role="status">{envio.status === 'cancelado' ? MSG_REVISAO.cancelado : MSG_REVISAO.jaRevisado}</p>
          )}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Menu com contador (D11)**

Em `src/app/painel/navegacao.ts`, depois de `ITENS_DO_MENU`:

```ts
/** Plano 12 (D11): "Exames recebidos" — 5º item, só com o recebimento ligado ou com envio aguardando (o layout decide). */
export const ITEM_EXAMES = { href: '/painel/exames-recebidos', rotulo: 'Exames recebidos' } as const;

export function itensDoMenu(o: { exames: boolean }): { href: string; rotulo: string }[] {
  return o.exames ? [...ITENS_DO_MENU.slice(0, 4), ITEM_EXAMES, ...ITENS_DO_MENU.slice(4)] : [...ITENS_DO_MENU];
}

/** US-162: "Exames recebidos (3)"; sem pendentes, só o nome. */
export const rotuloDoItem = (rotulo: string, contador: number): string => (contador > 0 ? `${rotulo} (${contador})` : rotulo);
```

e, em `itemAtual`, trocar `ITENS_DO_MENU.find(` por `[...ITENS_DO_MENU, ITEM_EXAMES].find(`.

Em `src/app/painel/menu-painel.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { classeDoItem, ITEM_EXAMES, itemAtual, itensDoMenu, rotuloDoItem } from './navegacao';

/** D20: o item ativo é pílula na cor do consultório, sublinhado e em negrito (forma + cor + aria-current, WCAG 1.4.1). */
export function MenuPainel({ exames = { mostrar: false, pendentes: 0 } }: { exames?: { mostrar: boolean; pendentes: number } }) {
  const atual = itemAtual(usePathname());
  return (
    <nav aria-label="Menu do painel" data-guia="menu">
      <ul className="flex flex-wrap gap-1">
        {itensDoMenu({ exames: exames.mostrar }).map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={atual === i.href ? 'page' : undefined}
              className={classeDoItem(atual === i.href)}
            >
              {i.href === ITEM_EXAMES.href ? rotuloDoItem(i.rotulo, exames.pendentes) : i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

Em `src/app/painel/cabecalho.tsx`: acrescentar `exames` às props de `CabecalhoPainel` (`exames: { mostrar: boolean; pendentes: number }`) e trocar `{completo && <MenuPainel />}` por `{completo && <MenuPainel exames={exames} />}`.

Em `src/app/painel/layout.tsx`: importar `import { contarEnviosRecebidos } from '@/modules/pacientes/exames-enviados';`; trocar `const { data, tenant } = await requireNutri(…)` por `const { data, tenant, ctx } = await requireNutri(…)`; depois de `progresso`:

```ts
  // US-162 / D11: o contador do menu; o layout não refaz na navegação pelo cliente — as ações da revisão chamam
  // revalidatePath('/painel', 'layout'), e um envio novo aparece na próxima navegação completa
  const pendentes = completo ? await contarEnviosRecebidos(ctx) : 0;
  const exames = { mostrar: !!tenant.examesPacienteAtivadoEm || pendentes > 0, pendentes };
```

e passar `exames={exames}` ao `<CabecalhoPainel …/>`.

- [ ] **Step 6: O prontuário — contador e selo**

Em `src/app/painel/pacientes/[id]/exames/page.tsx`: importar `Link` (`next/link`), `Selo` (`@/components/ui/selo`), `contarEnviosDoPaciente`, `examesEnviadosPeloPaciente` (`@/modules/pacientes/exames-enviados`), `MSG_REVISAO` (`@/modules/pacientes/exames-enviados-constantes`) e `mensagemIaDaChave` (`@/modules/pacientes/exames-enviados-ia`); ampliar o `Promise.all`:

```ts
  const [situacoes, marcas, cota, enviados, doPaciente] = await Promise.all([
    mostrarIa ? tarefasDosExames(ctx, paciente.id) : new Map(),
    temOrigemIa ? marcasDeIa(ctx, paciente.id) : new Map<string, Date>(),
    mostrarIa && estadoIa === 'ativa' ? situacaoDaCotaIa(ctx, tenant, agora) : null,
    contarEnviosDoPaciente(ctx, paciente.id),
    examesEnviadosPeloPaciente(ctx, paciente.id),
  ]);
  const iaRecusou = mensagemIaDaChave(busca.iaMsg);
```

no topo do `<div className="space-y-8">`, antes dos avisos da IA:

```tsx
      {busca.envio === 'salvo' && <Aviso tipo="ok">{MSG_REVISAO.salvo}</Aviso>}
      {iaRecusou && <Aviso tipo="aviso">{iaRecusou}</Aviso>}
      {enviados > 0 && (
        <p>
          <Link href="/painel/exames-recebidos" className="inline-flex min-h-11 items-center text-link underline">{MSG_REVISAO.noProntuario(enviados)}</Link>
        </p>
      )}
```

e, logo depois do `<h3 id={`exame-${e.id}`} …>…</h3>`: `{doPaciente.has(e.id) && <Selo>{MSG_REVISAO.selo}</Selo>}` (envolver o `h3` e o selo num `<div className="flex flex-wrap items-center gap-2">`).

- [ ] **Step 7: Axe do painel (rotas novas) e o id do envio no E2E**

Em `e2e/painel-rotas.ts`: acrescentar `envio: string` ao tipo `IdsDoPainel` e, em `ROTAS_DO_PAINEL`:

```ts
  '/painel/exames-recebidos': () => '/painel/exames-recebidos',
  '/painel/exames-recebidos/[id]': (i) => `/painel/exames-recebidos/${i.envio}`,
```

Em `e2e/painel.ts`: importar `import { PDFDocument } from 'pdf-lib';`; em `prepararTelasComId`, logo depois do registro no diário e **antes** de `await paciente.page.context().close();`:

```ts
  // exame enviado pelo paciente (Plano 12): o consultório do E2E recebe exames (seed); o worker processa e o envio entra na fila
  const laudo = await PDFDocument.create();
  laudo.addPage([595, 842]);
  await paciente.page.goto('/p/exames');
  await paciente.page.getByLabel('Data da coleta').fill('2026-09-28');
  await paciente.page.getByLabel('PDF ou fotos do exame').setInputFiles({ name: 'laudo.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await laudo.save()) });
  await paciente.page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Exame enviado. Sua nutricionista vai revisar.' })).toBeVisible();
```

e, no objeto devolvido:

```ts
    envio: await (async () => {
      await expect
        .poll(async () => {
          await nutri.goto('/painel/exames-recebidos');
          return nutri.locator('a[href^="/painel/exames-recebidos/"]').count();
        }, { timeout: 60_000 })
        .toBeGreaterThan(0);
      return idDoLink(nutri, '/painel/exames-recebidos', new RegExp(`/painel/exames-recebidos/(${UUID})$`));
    })(),
```

- [ ] **Step 8: Rodar e commitar**

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-ia.test.ts "src/app/painel/exames-recebidos" src/app/painel/navegacao.test.ts src/app/painel/cabecalho.test.ts src/app/painel/rotas-axe.test.ts src/app/painel/acoes-de-paciente.test.ts src/app/painel/cores.test.ts src/app/formularios-post.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS (a guarda do axe acha as duas telas novas em `ROTAS_DO_PAINEL`; a das ações acha `requireNutri` na primeira linha).

```bash
git add src/app/painel/exames-recebidos src/modules/pacientes/exames-enviados-ia.ts src/modules/pacientes/exames-enviados-ia.test.ts \
  src/app/painel/navegacao.ts src/app/painel/navegacao.test.ts src/app/painel/menu-painel.tsx src/app/painel/cabecalho.tsx src/app/painel/layout.tsx \
  "src/app/painel/pacientes/[id]/exames/page.tsx" e2e/painel-rotas.ts e2e/painel.ts
git commit -m "feat(exames-enviados): telas do painel — fila, revisão com as páginas, aceitar e ler com IA, recusar, menu e prontuário (P12-11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 12: LGPD — exportação, pedido de exclusão atendido e anonimização com os envios (P12-12)

**Revisão: completa (agente normas-cfn-lgpd)** — direitos do titular (art. 18), minimização, fim do prazo de guarda; envios não aceitos não são prontuário (§13.3).

**Files:**
- Create: `src/modules/pacientes/exames-enviados-lgpd.test.ts`
- Modify: `src/modules/pacientes/lgpd.ts` (`apagarEnviosDoTitular`, `concluirExclusaoAtendida`, `anexosDoPaciente`, `anonimizarVencidos`), `src/modules/pacientes/exportacao-job.ts` (`examesEnviados`, `envios/` no ZIP), `src/modules/pacientes/exportacao.test.ts` (as duas comparações do `dados.json` ganham `examesEnviados: []`)

**Interfaces:**
- Consumes: T1, T2 (`ROTULO_MOTIVO_RECUSA`, `MotivoRecusa`); `apagarArquivo`, `montarDados`, `concluirExclusaoAtendida`, `anonimizarVencidos`.
- Produces: `apagarEnviosDoTitular(ctx, patientId, deps?)`; `DadosExportacao.examesEnviados`; o anexo `envios/<data da coleta>-<posição>.pdf` no ZIP.

- [ ] **Step 1: Escrever o teste (falha)**

Criar `src/modules/pacientes/exames-enviados-lgpd.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { arquivoDeEnvio, envioNoBanco, envioRecebido } from '../../../test/exames-enviados';
import { closeDb } from '@/db/client';
import { examSubmissionFiles, examSubmissions, exams, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';
import { montarDados } from './exportacao-job';
import { anexosDoPaciente, anonimizarVencidos, apagarEnviosDoTitular, concluirExclusaoAtendida } from './lgpd';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-envio-lgpd-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });

/** Um titular com um envio de cada tipo: aguardando (PDF + páginas), processando (original), recusado e aceito (o exame fica). */
async function titularComEnvios() {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx);
  const recebido = await envioRecebido(app.db, T.ctx, p.id, dataDir, { paginas: 2, dataColeta: '2026-09-28' });
  const processando = await envioNoBanco(app.db, T.ctx, p.id, { status: 'processando' });
  const original = await arquivoDeEnvio(app.db, T.ctx, p.id, 'exame_original', dataDir);
  await withTenant(T.ctx, (tx) => tx.insert(examSubmissionFiles).values({ tenantId: T.tenantId, patientId: p.id, submissionId: processando, arquivoPath: original, papel: 'original', ordem: 1 }), app.db);
  const revisao = { revisadoPor: T.nutriId, revisadoEm: new Date() };
  await envioNoBanco(app.db, T.ctx, p.id, { status: 'recusado', motivoRecusa: 'outro', motivoRecusaTexto: 'Faltou a página 2', observacao: 'pedido na consulta', ...revisao });
  const [ex] = await withTenant(T.ctx, (tx) => tx.insert(exams).values({ tenantId: T.tenantId, patientId: p.id, data: '2026-09-01', titulo: 'Glicemia' }).returning({ id: exams.id }), app.db);
  const aceito = await envioNoBanco(app.db, T.ctx, p.id, { status: 'aceito', examId: ex.id, ...revisao });
  const envios = () => withTenant(T.ctx, (tx) => tx.select({ id: examSubmissions.id, status: examSubmissions.status }).from(examSubmissions).where(eq(examSubmissions.patientId, p.id)), app.db);
  const arquivos = [recebido.pdf, ...recebido.paginas, original];
  return { T, p, recebido, processando, aceito, exame: ex.id, envios, arquivos };
}
const bloquear = (T: Awaited<ReturnType<typeof novoTenant>>, patientId: string, anonimizarApos: string) =>
  withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', bloqueadoEm: new Date(), anonimizarApos }).where(eq(patients.id, patientId)), app.db);

describe('LGPD e os exames enviados (spec C v0.3 §13.3)', () => {
  it('exportação (US-018/US-046): examesEnviados no dados.json; o PDF limpo de quem aguarda vai para envios/; nunca páginas nem originais', async () => {
    const t = await titularComEnvios();
    const { dados, laudos } = await withTenant(worker(t.T.tenantId), (tx) => montarDados(tx, t.p.id, new Date(), 'America/Sao_Paulo', 'titular'), app.db);
    expect(dados.examesEnviados.map((e) => [e.situacao, e.motivoRecusa])).toEqual(
      expect.arrayContaining([['recebido', null], ['processando', null], ['recusado', 'Faltou a página 2'], ['aceito', null]]),
    );
    expect(dados.examesEnviados.find((e) => e.situacao === 'recusado')).toMatchObject({ observacao: 'pedido na consulta', dataColeta: '2026-09-28' });
    const doEnvio = laudos.filter((l) => l.nome.startsWith('envios/'));
    expect(doEnvio).toEqual([expect.objectContaining({ tipo: 'envio', caminho: t.recebido.pdf, nome: expect.stringMatching(/^envios\/2026-09-28-\d{2}\.pdf$/) })]);
    for (const c of [...t.recebido.paginas, t.arquivos[3]]) expect(laudos.some((l) => l.caminho === c)).toBe(false);
  });

  it('anexosDoPaciente inclui os arquivos de envio (defesa da anonimização)', async () => {
    const t = await titularComEnvios();
    const anexos = await withTenant(worker(t.T.tenantId), (tx) => anexosDoPaciente(tx, t.p.id), app.db);
    expect(anexos).toEqual(expect.arrayContaining(t.arquivos));
  });

  it('exclusão atendida (job exclusao-atendida): arquivos e linhas dos envios NÃO aceitos saem antes do e-mail; o aceito e o exame ficam', async () => {
    const t = await titularComEnvios();
    await bloquear(t.T, t.p.id, '2046-10-07');
    expect(await concluirExclusaoAtendida({ tenantId: t.T.tenantId, patientId: t.p.id }, { db: app.db, dataDir, ultimaTentativa: false })).toBe('avisado');
    expect(await t.envios()).toEqual([{ id: t.aceito, status: 'aceito' }]);
    for (const c of t.arquivos) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
    expect(await withTenant(t.T.ctx, (tx) => tx.select().from(exams).where(eq(exams.id, t.exame)), app.db)).toHaveLength(1);
    expect(await apagarEnviosDoTitular(worker(t.T.tenantId), t.p.id, { db: app.db, dataDir })).toBe(0); // idempotente
  });

  it('anonimização (fim do prazo): nenhuma linha de envio sobra, nem a do aceito; nenhum arquivo de envio', async () => {
    const t = await titularComEnvios();
    await bloquear(t.T, t.p.id, '2020-01-01');
    await anonimizarVencidos(app.db, new Date(), { dataDir });
    const [p] = await withTenant(t.T.ctx, (tx) => tx.select({ anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, t.p.id)), app.db);
    expect(p.anonimizadoEm).toBeInstanceOf(Date);
    expect(await t.envios()).toEqual([]);
    expect(await withTenant(t.T.ctx, (tx) => tx.select().from(examSubmissionFiles).where(and(eq(examSubmissionFiles.tenantId, t.T.tenantId), eq(examSubmissionFiles.patientId, t.p.id))), app.db)).toEqual([]);
    for (const c of t.arquivos) expect(existsSync(resolverCaminho(dataDir, c))).toBe(false);
  });
});
```

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-lgpd.test.ts`
Expected: FAIL (`apagarEnviosDoTitular` não existe; `examesEnviados` não existe em `dados`).

- [ ] **Step 2: Exclusão atendida, anonimização e anexos**

Em `src/modules/pacientes/lgpd.ts`: importar `examSubmissionFiles`, `examSubmissions` de `@/db/schema` e `ne` de `drizzle-orm`; acrescentar depois de `apagarFotosDoDiario`:

```ts
/**
 * §13.3 (US-018): os envios de exame do titular bloqueado (pedido de exclusão atendido) ou anonimizado — cada arquivo (PDF
 * limpo, originais e páginas) no seu apagarArquivo, com o `rm` antes do commit (como as fotos do diário; o ponteiro do PDF
 * limpo sai no naMesmaTransacao, e as linhas de arquivo pela FK em cascata), e depois as linhas dos envios NÃO aceitos (não são
 * prontuário). `todos`: também as dos aceitos (a anonimização as apaga dentro da própria transação). O gatilho
 * exam_submissions_sem_apagar (0102) só deixa o worker apagar, e só com o titular bloqueado ou anonimizado. Idempotente.
 */
export async function apagarEnviosDoTitular(ctx: TenantContext, patientId: string, deps: { db?: Db; dataDir?: string; todos?: boolean } = {}): Promise<number> {
  const db = deps.db ?? getDb();
  const caminhos = await withTenant(
    ctx,
    async (tx) => [
      ...(await tx.select({ c: examSubmissions.arquivoPath }).from(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), isNotNull(examSubmissions.arquivoPath)))).map((x) => x.c!),
      ...(await tx.select({ c: examSubmissionFiles.arquivoPath }).from(examSubmissionFiles).where(eq(examSubmissionFiles.patientId, patientId))).map((x) => x.c),
    ],
    db,
  );
  let n = 0;
  for (const caminho of caminhos) {
    const ok = await apagarArquivo(ctx, { caminho }, {
      db,
      dataDir: deps.dataDir,
      removerAntesDoCommit: true,
      naMesmaTransacao: async (tx) => {
        await tx.update(examSubmissions).set({ arquivoPath: null, updatedAt: new Date() }).where(and(eq(examSubmissions.patientId, patientId), eq(examSubmissions.arquivoPath, caminho)));
        return true;
      },
    });
    if (ok) n++;
  }
  await withTenant(ctx, (tx) => tx.delete(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), deps.todos ? undefined : ne(examSubmissions.status, 'aceito'))), db);
  return n;
}
```

Em `concluirExclusaoAtendida`, logo depois do `try { await apagarFotosDoDiario(…) } catch …`:

```ts
  // Plano 12 (§13.3): os envios de exame não aceitos (arquivos e linhas) também saem antes do aviso
  try {
    await apagarEnviosDoTitular(ctx, data.patientId, { db, dataDir: deps.dataDir });
  } catch (err) {
    const motivo = motivoDoErro(err);
    logger.error({ motivo, tenantId: data.tenantId, definitivo: deps.ultimaTentativa }, 'falha ao apagar os envios de exame antes do aviso da exclusão');
    if (!deps.ultimaTentativa) throw new Error(`falha ao apagar os envios de exame (${motivo})`);
  }
```

Em `anexosDoPaciente`, antes do `return`:

```ts
  // Plano 12 (§13.3, defesa): o PDF limpo de envio não aceito e os originais/páginas que tenham sobrado
  const deEnvios = await tx.select({ c: examSubmissions.arquivoPath }).from(examSubmissions).where(and(eq(examSubmissions.patientId, patientId), isNotNull(examSubmissions.arquivoPath)));
  const arquivosDeEnvios = await tx.select({ c: examSubmissionFiles.arquivoPath }).from(examSubmissionFiles).where(eq(examSubmissionFiles.patientId, patientId));
```

e incluir `...deEnvios.map((e) => e.c!), ...arquivosDeEnvios.map((e) => e.c)` na lista devolvida.

Em `anonimizarVencidos`: logo depois de `await anonimizarDocumentosDoPaciente(ctx, id, …);`, acrescentar `await apagarEnviosDoTitular(ctx, id, { db, dataDir: deps.dataDir });` e, dentro da transação, junto das outras exclusões depois do `UPDATE` de `patients` (perto do `tx.delete(iaTarefas)`):

```ts
            // Plano 12 (§13.3): as linhas de envio que sobraram (as dos aceitos: o exame já é o prontuário) — contexto worker,
            // titular já anonimizado (gatilho exam_submissions_sem_apagar)
            if (r.length) await tx.delete(examSubmissions).where(eq(examSubmissions.patientId, id));
```

E, para a rede de segurança diária dos bloqueados (como `apagarFotosDosBloqueados`), acrescentar e chamar logo depois de `await apagarFotosDosBloqueados(ctx, db, deps);`:

```ts
/** Rede de segurança (§13.3): bloqueado com envio não aceito (o job da exclusão falhou de vez) perde os envios; erro só no log. */
async function apagarEnviosDosBloqueados(ctx: TenantContext, db: Db, deps: { dataDir?: string }): Promise<void> {
  try {
    const comEnvio = await withTenant(
      ctx,
      (tx) =>
        tx
          .selectDistinct({ id: patients.id })
          .from(patients)
          .innerJoin(examSubmissions, and(eq(examSubmissions.tenantId, patients.tenantId), eq(examSubmissions.patientId, patients.id)))
          .where(and(eq(patients.status, 'bloqueado'), ne(examSubmissions.status, 'aceito'))),
      db,
    );
    for (const { id } of comEnvio) await apagarEnviosDoTitular(ctx, id, { db, dataDir: deps.dataDir });
  } catch (err) {
    logger.error({ motivo: motivoDoErro(err), tenantId: ctx.tenantId }, 'falha ao apagar envios de exame de paciente bloqueado');
  }
}
```

- [ ] **Step 3: Exportação**

Em `src/modules/pacientes/exportacao-job.ts`:
1. importar `examSubmissions` (no import de `@/db/schema`) e `import { ROTULO_MOTIVO_RECUSA, type MotivoRecusa } from './exames-enviados-constantes';`;
2. em `DadosExportacao`, depois de `ia`:

```ts
  /**
   * Plano 12 (§13.3): exames enviados pelo paciente pelo app — envio, coleta, nome, observação, situação e motivo da recusa.
   * `pdf` = o PDF limpo no ZIP (`envios/…`), só dos que aguardam revisão (o dos aceitos já sai em `laudos/`, como exame).
   * Nunca as imagens de página nem os originais.
   */
  examesEnviados: { enviadoEm: string; dataColeta: string; nome: string | null; observacao: string | null; situacao: string; motivoRecusa: string | null; pdf: string | null }[];
```

3. `type AnexoParaZip = { tipo: 'laudo' | 'foto' | 'documento' | 'envio'; … }` (comentário: "ou PDF limpo de exame enviado aguardando revisão (`indice` em `examesEnviados`, Plano 12)");
4. em `montarDados`, depois da consulta `di`: `const ee = await tx.select().from(examSubmissions).where(eq(examSubmissions.patientId, patientId)).orderBy(asc(examSubmissions.createdAt));`; depois de `fotos`:

```ts
  // Plano 12: o PDF limpo dos envios que aguardam revisão (nome sem texto do usuário: data da coleta + posição)
  const envios: AnexoParaZip[] = ee.flatMap((e, i) =>
    e.status === 'recebido' && e.arquivoPath ? [{ tipo: 'envio' as const, indice: i, caminho: e.arquivoPath, nome: `envios/${e.dataColeta}-${String(i + 1).padStart(2, '0')}.pdf` }] : [],
  );
```

no objeto `dados`, depois de `ia: …`:

```ts
    examesEnviados: ee.map((e) => ({
      enviadoEm: e.createdAt.toISOString(),
      dataColeta: e.dataColeta,
      nome: e.nome,
      observacao: e.observacao,
      situacao: e.status,
      motivoRecusa: e.motivoRecusa === 'outro' ? e.motivoRecusaTexto : e.motivoRecusa ? ROTULO_MOTIVO_RECUSA[e.motivoRecusa as MotivoRecusa] : null,
      pdf: null,
    })),
```

e o retorno vira `return { dados, laudos: [...laudos, ...fotos, ...envios, ...pdfsDeDocumentos] };`;
5. em `lerAnexos`, depois do ramo de `documento`: `else if (l.tipo === 'envio') dados.examesEnviados[l.indice].pdf = l.nome;`.

Em `src/modules/pacientes/exportacao.test.ts`, nas duas comparações completas do `dados.json` (as que terminam em `laudosForaDoZip: false`), acrescentar `examesEnviados: [],` depois de `ia: [],`.

- [ ] **Step 4: Rodar e commitar**

Run: `pnpm vitest run src/modules/pacientes/exames-enviados-lgpd.test.ts src/modules/pacientes/lgpd.test.ts src/modules/pacientes/exportacao.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, sem erros.

```bash
git add src/modules/pacientes/lgpd.ts src/modules/pacientes/exportacao-job.ts src/modules/pacientes/exportacao.test.ts src/modules/pacientes/exames-enviados-lgpd.test.ts
git commit -m "feat(exames-enviados): LGPD — exportação, exclusão atendida e anonimização com os envios do paciente (P12-12)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

### Task 13: Fechamento — E2E, manual guiado, backup, manual técnico, runbook, índice e backlog (P12-13)

**Revisão: leve (revisor-interface)** — E2E, textos do manual guiado; o capítulo do manual técnico passa também pelo `guardiao-manual` (`.claude/agents/guardiao-manual.md`).

**Files:**
- Create: `e2e/exames-enviados.spec.ts`, `docs/manual-tecnico/11-exames-enviados.md`, `docs/operacao/exames-enviados.md`
- Modify: `src/modules/ajuda/conteudo.ts` (+ `conteudo.test.ts` se conferir a lista de guias), `scripts/backup/nutri-backup.sh`, `test/backup.test.ts`, `CLAUDE.md` (regra 10), `docs/manual-tecnico/README.md`, `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md`, `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md`, `docs/superpowers/specs/2026-10-03-nutridebby-paciente-exames-ia-design.md` (status da parte F3-04)

**Interfaces:**
- Consumes: tudo das Tarefas 1–12.
- Produces: o E2E de ponta a ponta (paciente envia → worker → nutricionista aceita → paciente vê "Recebido no seu prontuário"); o guia "Exames recebidos"; o `--exclude` das pastas temporárias no backup; o capítulo 11 do manual técnico; o runbook.

- [ ] **Step 1: O E2E de ponta a ponta**

Criar `e2e/exames-enviados.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { entrarComo } from './helpers';
import { pacienteNoPortal } from './portal';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;

// O limite de login é por IP: este spec usa o bloco 10.9.20.x (nutri em .1; cada paciente com o seu)
test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.20.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

async function laudo(paginas: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < paginas; i++) doc.addPage([595, 842]).drawText(`Glicose de jejum 92 mg/dL (página ${i + 1})`, { x: 50, y: 780, size: 12, font: fonte });
  return Buffer.from(await doc.save());
}
async function enviar(p: Page, nome: string, pdf: Buffer) {
  await p.goto('/p/exames');
  await p.getByLabel('Data da coleta').fill('2026-09-28');
  await p.getByLabel('Nome do exame (opcional)').fill(nome);
  await p.getByLabel('PDF ou fotos do exame').setInputFiles({ name: 'laudo.pdf', mimeType: 'application/pdf', buffer: pdf });
  await p.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(p.getByRole('status').filter({ hasText: 'Exame enviado. Sua nutricionista vai revisar.' })).toBeVisible();
}
const situacao = async (p: Page, texto: string) =>
  expect.poll(async () => {
    await p.reload();
    return p.getByText(texto).count();
  }, { timeout: 60_000 }).toBeGreaterThan(0);

test('US-160 a US-163: o paciente envia um PDF, o worker processa, a nutricionista vê as páginas e aceita; o paciente vê "Recebido no seu prontuário"', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.20.2');
  await p.page.goto('/p/inicio');
  await p.page.getByRole('link', { name: 'Enviar exame' }).click();
  await expect(p.page).toHaveURL(/\/p\/exames$/);
  await expect(p.page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');
  await enviar(p.page, 'Hemograma E2E', await laudo(2));
  await situacao(p.page, 'Aguardando sua nutricionista');
  await expect(p.page.getByRole('link', { name: /Baixar PDF/ })).toBeVisible();

  await nutri.goto('/painel/exames-recebidos');
  await nutri.getByRole('link', { name: new RegExp(p.nome) }).first().click();
  await expect(nutri.getByRole('img', { name: 'Página 1 de 2 do exame enviado' })).toBeVisible();
  await expect(nutri.getByRole('img', { name: 'Página 2 de 2 do exame enviado' })).toBeVisible();
  await nutri.getByText('Aceitar', { exact: true }).click();
  await expect(nutri.getByLabel('Título')).toHaveValue('Hemograma E2E');
  await expect(nutri.getByLabel('Data')).toHaveValue('2026-09-28');
  await nutri.getByRole('button', { name: 'Salvar no prontuário' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Exame salvo no prontuário.' })).toBeVisible();
  await expect(nutri.getByText('Enviado pelo paciente')).toBeVisible();

  await situacao(p.page, 'Recebido no seu prontuário');
  await expect(p.page.getByRole('link', { name: /Baixar PDF/ })).toHaveCount(0);
  await p.page.context().close();
});

test('US-161 e US-164: o paciente cancela um envio; a nutricionista recusa outro com "Outro motivo" e o paciente vê o motivo', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.20.3');
  await enviar(p.page, 'Para cancelar', await laudo(1));
  await situacao(p.page, 'Aguardando sua nutricionista');
  p.page.once('dialog', (d) => d.accept()); // "Cancelar este envio? O arquivo será apagado."
  await p.page.getByRole('button', { name: /Cancelar envio/ }).click();
  await expect(p.page.getByText('Para cancelar')).toHaveCount(0);

  await enviar(p.page, 'Para recusar', await laudo(1));
  await situacao(p.page, 'Aguardando sua nutricionista');
  await nutri.goto('/painel/exames-recebidos');
  await nutri.getByRole('link', { name: new RegExp(p.nome) }).first().click();
  await nutri.getByText('Recusar', { exact: true }).click();
  await nutri.getByLabel('Outro motivo').check();
  await nutri.getByRole('button', { name: 'Confirmar recusa' }).click();
  await expect(nutri.getByRole('alert').filter({ hasText: 'Escreva o motivo para o paciente' })).toBeVisible();
  await nutri.getByLabel('Escreva o motivo').fill('Faltou a página com os resultados');
  await nutri.getByRole('button', { name: 'Confirmar recusa' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Envio recusado.' })).toBeVisible();
  await situacao(p.page, 'Não aceito: Faltou a página com os resultados');
  await p.page.context().close();
});

test('US-160 "PDF longo": 11 páginas → o paciente vê a mensagem do limite de páginas', async ({ browser }) => {
  const p = await pacienteNoPortal(browser, nutri, '10.9.20.4');
  await enviar(p.page, 'Longo', await laudo(11));
  await situacao(p.page, 'O PDF tem mais de 10 páginas. Envie só as páginas com os resultados.');
  await p.page.context().close();
});
```

Run (com o ambiente do E2E de pé, como nos planos anteriores): `pnpm test:e2e e2e/exames-enviados.spec.ts e2e/acessibilidade.spec.ts e2e/acessibilidade-painel.spec.ts`
Expected: PASS (o axe passa em `/p/exames`, `/painel/exames-recebidos` e `/painel/exames-recebidos/[id]`).

- [ ] **Step 2: Manual guiado**

Em `src/modules/ajuda/conteudo.ts`: no guia `boas-vindas`, `versao` + 1 e o passo do menu passa a dizer `'Pacientes, Agenda, Diários, Conteúdos e Configurações ficam sempre aqui no topo. Quando você liga o recebimento de exames pelo app, "Exames recebidos" aparece também, com o número dos que aguardam.'`; acrescentar o guia (antes do de `diarios`):

```ts
  {
    id: 'exames-recebidos',
    versao: 1,
    padrao: /^\/painel\/exames-recebidos(\/.*)?$/,
    titulo: 'Exames recebidos',
    ajuda: {
      resumo: 'Os exames que os pacientes enviaram pelo app ficam aqui até você conferir. Nada entra no prontuário sem você aceitar.',
      secoes: [
        {
          titulo: 'O que dá para fazer aqui',
          itens: [
            'Abrir um envio e conferir as páginas, como imagens.',
            'Aceitar: o exame entra na aba Exames do paciente, com o selo "Enviado pelo paciente". Com a IA ativa, dá para aceitar e já pedir a leitura dos valores.',
            'Recusar com um motivo: o arquivo é apagado na hora e o paciente vê o motivo no app.',
          ],
        },
        {
          titulo: 'Perguntas comuns',
          itens: [
            'O recebimento é ligado em Configurações, em "Exames enviados pelos pacientes".',
            'Você recebe no máximo um e-mail a cada 6 horas avisando que há exames novos, sem nome de paciente nem de exame.',
            'Envios não revisados em 90 dias expiram: o arquivo é apagado e o paciente é avisado.',
          ],
        },
      ],
    },
    passos: [{ alvo: 'fila-exames', titulo: 'Exames dos pacientes', texto: 'Os mais antigos ficam no topo. Abra um envio para conferir as páginas e aceitar ou recusar.' }],
  },
```

Run: `pnpm vitest run src/modules/ajuda`
Expected: PASS (se `conteudo.test.ts` conferir a lista de ids ou de alvos `data-guia`, acrescentar `exames-recebidos` e `fila-exames`).

- [ ] **Step 3: Backup sem as pastas temporárias (PM-11, D8 ★)**

Em `test/backup.test.ts`, no teste "dia seguinte…", junto do `exportacao`:

```ts
    for (const pasta of ['exame_pagina', 'exame_original']) {
      mkdirSync(path.join(dados, 't1', pasta), { recursive: true });
      writeFileSync(path.join(dados, 't1', pasta, 'x.jpg'), 'temporario');
    }
```

e, depois do `expect(await lsf('data/atual/t1/')).toEqual(['logo/'])` (que já cobre as três pastas fora do R2): `expect(await lsf('data/historico/2026-10-05/t1/')).not.toContain('exame_pagina/');`.

Em `scripts/backup/nutri-backup.sh`, na linha do `rclone sync`, acrescentar `--exclude '/*/exame_pagina/**' --exclude '/*/exame_original/**'` depois do `--exclude '/*/exportacao/**'` e, no comentário acima: "Plano 12 (PM-11): as imagens de página e os originais do exame enviado pelo paciente são temporários (saem na revisão, minutos depois ou na falha); o PDF limpo, que vira laudo, vai normalmente."

Run: `pnpm vitest run test/backup.test.ts`
Expected: PASS (o script roda só aqui, contra o remoto local — regra 10).

Em `CLAUDE.md`, regra 10, acrescentar: "Plano 12: o `rclone sync` exclui também `exame_pagina/` e `exame_original/` (temporários do envio de exame) — mudou o script, o dono reinstala no host (P02-11)."

- [ ] **Step 4: Manual técnico, runbook, índice, backlog e spec**

Criar `docs/manual-tecnico/11-exames-enviados.md` ("11. Exames enviados pelo paciente (Plano 12, F3-04)"), conferido contra o código do branch, com: 11.1 Visão (o fluxo de §4.1 da spec com os nomes reais: `POST /api/p/exames` → `enviarExame` → fila `exame-envio` → `processarEnvio` → fila "Exames recebidos" → `aceitarEnvio`/`recusarEnvio`; cancelamento → `exame-envio-limpar`; `varrerEnvios`); 11.2 Peças (tabela dos arquivos, quais só o worker importa); 11.3 Banco (`exam_submissions`, `exam_submission_files`, colunas de `tenants`, tipos de `stored_files`, as políticas do paciente, os gatilhos `exam_submissions_regras` e `exam_submissions_sem_apagar` com a tabela de transições, `admin_metricas_exames_enviados()`); 11.4 Arquivos e cota (`salvarArquivos`, `apagarArquivosDoEnvio`, um dono só no aceite, ordem de travas); 11.5 Rasterização (PDFium em WASM, processo filho, teto de 120 MB, prazo de 120 s, 20 MP por imagem, a medida do RNF-162 da T3 com os números, licenças, a poda na imagem e o tamanho final da imagem); 11.6 Privacidade (push e e-mail neutros, auditoria de leitura, LGPD §13.3); 11.7 Como estender (outro tipo de arquivo; outro motor de rasterização = só o processo filho); 11.8 Divergências conhecidas (os Desvios 1–7 e os Minors que ficarem no backlog). No `docs/manual-tecnico/README.md`, acrescentar o capítulo 11 ao índice e atualizar "Conferido contra"/"Escopo" com o Plano 12 e as migrations `0101`–`0102`.

Criar `docs/operacao/exames-enviados.md` com o **Runbook do dono** (seção abaixo, copiada sem mudança).

No índice dos planos: a linha do Plano 12 passa a apontar para a spec **v0.3** e para este plano, situação "Em execução". No backlog: trocar "Spec C v0.2" por "Spec C v0.3" na linha P12-00 e acrescentar as linhas P12-01 a P12-13 (uma por tarefa) e P12-14 (liberação para uso real, dono — runbook). Na spec C, no cabeçalho, "Status" da parte F3-04: "plano de implementação escrito (Plano 12)".

- [ ] **Step 5: Verificação completa**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add e2e/exames-enviados.spec.ts src/modules/ajuda scripts/backup/nutri-backup.sh test/backup.test.ts CLAUDE.md \
  docs/manual-tecnico docs/operacao/exames-enviados.md docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md \
  docs/superpowers/plans/2026-09-27-nutridebby-backlog.md docs/superpowers/specs/2026-10-03-nutridebby-paciente-exames-ia-design.md
git commit -m "test(exames-enviados): E2E de ponta a ponta; docs: manual guiado, manual técnico (cap. 11), backup e runbook (P12-13)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

## Runbook do dono (Plano 12 — exames enviados pelo paciente)

Nenhum passo é do código; cada um tem dono. A função nasce **desligada** em todo consultório (D18 = a): nada muda para os pacientes até a nutricionista ligar.

1. **Antes do merge (merge = deploy).** Snapshot da VPS no hPanel; OK explícito do dono no PR. Conferir no PR o job `image` do CI: a imagem comprimida tem de ficar em **≤ 260 MB**; se passar, a T3 parou e pediu a decisão (subir o orçamento não custa nada).
2. **Backup no host (P02-11) — continua pendente.** Os envios ficam só em `/data` da VPS até o backup ser ligado. Quando ligar, instalar o `nutri-backup.sh` desta versão (com o `--exclude` das pastas `exame_pagina/` e `exame_original/`, D8 ★) — regra 10: o script mudou, reinstalar no host. **Não ligar o recebimento para pacientes reais antes do backup.**
3. **Teste no consultório (Debby, com dado fictício).** Em Configurações, marcar "Receber exames enviados pelos pacientes pelo app" e salvar. Com uma conta de paciente de teste no celular dela: enviar 1 PDF de laudo **fictício** (2 a 3 páginas) e 3 fotos **reais de um papel qualquer** (uma HEIC do iPhone, se tiver), conferir "Processando…" → "Aguardando sua nutricionista", o e-mail genérico, a fila com o contador, as páginas legíveis, aceitar um, recusar outro com "Outro motivo" e cancelar um terceiro pelo app. Anotar o tempo de "Processando…" (RNF-161: até 60 s) e se as páginas estão legíveis em 2000 px / qualidade 85 (PM-9). **HEIC de 24 MP ou mais:** conferir no log do worker se houve "falhou" por memória (ver Riscos).
4. **Onde fica no portal (D4 ★, PM-10).** Confirmar com a Debby que "Meus exames" em Perfil + "Enviar exame" no Início bastam; se quiserem aba própria, é uma troca em `ITENS_DO_PORTAL` (outra entrega).
5. **Leitura por IA de envios (D9 ★, R-174).** Hoje a IA segue bloqueada para dado real (Plano 11, `ia_liberada = false`). Antes de a admin liberar a IA, o passo 4 do runbook do Plano 11 (avaliação com laudos fictícios) deve incluir laudos **rasterizados** (2000 px, só imagem): se a precisão cair, subir `ENVIO_LADO_MAX` (até 2576 px, o teto da IA) e medir a memória de novo (T3).
6. **Textos a confirmar com o dono/advogado.** O e-mail "Seu pedido de exclusão de dados foi atendido" diz o que foi apagado e não cita os exames enviados pelo app (que também saem): decidir se o texto muda (backlog P12-14). O lembrete dos 30 dias só sai junto de um envio novo (D6 ★, PM-12): a Debby diz se precisa de lembrete próprio.
7. **Ligar para pacientes reais.** Com 1–6 feitos, a Debby avisa os pacientes de que podem enviar exames pelo app. Acompanhar a coluna "Exames do app" no admin e, na primeira semana, os avisos "PDF do paciente recusado na rasterização" e "exame enviado não processado" no log do worker (só ids e motivo).

## Checagem final (antes do PR)

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verdes; `pnpm test:e2e` com `exames-enviados.spec.ts`, `acessibilidade.spec.ts` e `acessibilidade-painel.spec.ts` verdes.
- [ ] Guardas: `src/db/rls-guard.test.ts`, `src/db/audit-guard.test.ts`, `test/isolamento.test.ts`, `src/app/api/mesma-origem-rotas.test.ts`, `src/app/formularios-post.test.ts`, `src/app/painel/acoes-de-paciente.test.ts`, `src/app/painel/rotas-axe.test.ts`, `src/app/painel/cores.test.ts`, `src/modules/pacientes/exames-enviados-guardas.test.ts`, `src/modules/ia/guardas.test.ts`, `src/modules/pacientes/exportacao.test.ts` (grafo) e `src/modules/notificacoes/push.test.ts` (grafo).
- [ ] As medidas da T3 (RNF-162: worker + filho < 150 MB; bomba contida) registradas no PR e no capítulo 11; o tamanho da imagem do job `image` (≤ 260 MB).
- [ ] `git grep -n "exame_original\|exame_pagina"` só em: schema, migrations, `armazenamento.ts`, `exames-enviados-*.ts`, `portal/exames-enviados.ts`, `lgpd.ts`, `rls-guard.ts`, testes, backup, CLAUDE.md e docs.
- [ ] Nenhum texto de push, e-mail ou log com nome de paciente, nome de exame, observação, motivo de recusa ou caminho de arquivo (RNF-166; revisar `logger.` nos arquivos novos).
- [ ] CLAUDE.md (regras 2, 8, 9 e 10), manual técnico (cap. 11 + README), runbook em `docs/operacao/`, índice, backlog e o status da spec C atualizados.
- [ ] Revisão final do branch (workflow) com uma onda de correções → `/code-review high` uma vez → correções Critical/Important → re-revisão do diff → `/security-review` (checklist: arquivo não confiável do paciente, processo filho e teto de memória, cota e devolução, transições no banco, auditoria de leitura do titular). Lembrar o dono do backup no host (P02-11).

## Riscos e pendências que ficam

| # | Risco / pendência | Onde está tratado | O que falta |
|---|---|---|---|
| R1 | A rasterização (PDFium em WASM) estoura a memória ou não abre os PDFs reais; a bomba de descompressão não é contida pelo vigia de 20 ms | T3 mede antes de tudo (RNF-162 e bomba); o processo filho é morto acima de 120 MB | Se reprovar, decisão do controlador com o dono: `ENVIO_LADO_MAX`/`MAX_PIXELS_IMAGEM_PDF` menores ou o plano B (pdfjs-dist + @napi-rs/canvas), com imagem maior |
| R2 | Orçamento da imagem Docker (258 de 260 MB no Plano 11) | T3 poda o pacote (fica ≈ 4 MB de WASM) e o CI confere | Se passar, o dono decide subir o orçamento (sem custo) |
| R3 | HEIC grande no worker: o `heic-decode` aloca largura × altura × 4 bytes (24 MP ≈ 96 MB, mais a cópia do sharp) — o pico do RNF-162 (150 MB) não é garantido para HEIC acima de ~15 MP; o limite de 40 MP vem do diário | Não há HEIC real nos testes do CI (o decodificador é simulado, como no diário) | Runbook passo 3 (HEIC real do iPhone); se precisar, um teto próprio de pixels para o HEIC do exame (backlog) |
| R4 | Leitura por IA de PDF só com imagens pode perder precisão (R-174) | D9: a IA continua bloqueada para dado real | Runbook passo 5 (avaliação com laudos rasterizados antes da liberação) |
| R5 | O contador do menu não se atualiza sozinho na navegação pelo cliente (o layout do Next não refaz) | D11: as ações da revisão revalidam o layout | Se a Debby sentir falta, contador por consulta periódica (backlog) |
| R6 | O e-mail da exclusão atendida não cita os exames enviados apagados | Runbook passo 6 | Decisão de texto com o dono/advogado (P12-14) |
| R7 | O backup ainda não está ligado (P02-11): até lá, os envios só existem em `/data` | Runbook passo 2 | Ligar o backup antes do uso real |
| R8 | Duas execuções simultâneas do mesmo job (o pg-boss relança um job expirado com o anterior ainda rodando) podem disputar as páginas (`refazer`) | `expireInSeconds: 300` acima do pior caso; um job por vez; o "recebido" é gravado com o envio travado e o perdedor vira "ignorado" | Monitorar o log nas primeiras semanas |

## Autoconferência do plano (writing-plans)

- **Cobertura da spec:** a tabela "Cobertura da spec v0.3" acima liga cada US, RN e RNF da parte F3-04 a uma tarefa; §13.3 na T12; C-02/PM-11 na T13 e no runbook; admin na T1 e T9. Itens da F3-02 ficam de fora (Plano 15).
- **Sem lacunas de código:** cada passo de código traz o código; os passos "modificar" dizem o arquivo, o lugar e o trecho exato.
- **Nomes consistentes:** os contratos do topo são os usados nas tarefas (`salvarArquivos`, `apagarArquivosDoEnvio`, `rasterizarPdf`, `processarEnvio`, `enviarExame`, `meusEnvios`, `pdfDoMeuEnvio`, `cancelarMeuEnvio`, `filaDeEnvios`, `abrirEnvio`, `aceitarEnvio`, `recusarEnvio`, `avisarEnvioAtualizado`, `avisarExamesRecebidos`, `limparEnvio`, `varrerEnvios`, `definirRecebimentoDeExames`, `metricasDeExamesEnviadosPorTenant`, `apagarEnviosDoTitular`); os nomes do código existente foram conferidos na `main` (`salvarArquivo`, `apagarArquivo`, `resolverCaminho`, `detectarTipo`, `paraJpegSemMetadados`, `lerCorpoLimitado`, `mesmaOrigem`, `requireApiPaciente`, `requirePaciente`, `requireNutri`, `carregarPacienteParaEscrita`, `pacienteDaSessao`, `auditRead`, `avisarNutri`, `dispararEnvio`, `telaDoPortal`, `pedirLeituraExame`, `estadoIaDoTenant`, `motivoDoPaciente`, `configIA`, `listarTenantsParaVarredura`, `app_allow_paciente_escrita`, `app_enable_audit`, `exams_tenant_paciente_id_unique`).
- **Review Focus:** cada linha tem os testes nas tarefas indicadas.
