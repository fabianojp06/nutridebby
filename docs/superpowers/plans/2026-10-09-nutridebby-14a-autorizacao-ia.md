# Plano 14A — Autorização do paciente para o uso de IA e provedor AWS Bedrock na UE: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Escrito em 09/10/2026** a partir da `main` @ `8d91fd5` (Planos 01–13 em produção, migrations `0000`–`0105`) + a spec da IA **v0.5.1** (`5e2bf16`), no worktree `nutridebby-plano14`, branch `plano-14-ia-nutricionista`. O dono **aprovou em 08/10/2026** a divisão em 14A e 14B (spec §18.3), a autorização única com a lista dos três usos (A-D24, RV-1) e o link por e-mail **sem** o código de 6 dígitos (RN-107). **Base de código:** o Plano 16 (app do paciente G, branch `plano-16-app-paciente`, migration `0106_app_paciente_g`) entra na `main` **antes** deste plano; a Tarefa 1 começa pelo rebase sobre ele, e as migrations do 14A são **`0107`** (gerada), **`0108`** (custom) e **`0109`** (custom, na Tarefa 10). Nenhuma linha de código de produto foi escrita; nada rodou em banco; nenhum banco de produção foi tocado; nenhuma API de IA foi chamada. Os nomes de função, tabela, gatilho, rota e helper usados aqui foram conferidos no código da `main` e do branch do Plano 16 (os que este plano cria estão em "Contratos entre tarefas"). Próximo passo: revisão do plano pelo dono e execução no modo misto (workflow).

**Goal:** Antes de qualquer dado de paciente sair para a IA, o sistema passa a exigir a **autorização** (consentimento específico e em destaque, LGPD art. 33, VIII) do próprio paciente — dada no app (Eu › Privacidade), pelo link do e-mail (sem login) ou por termo em papel fotografado —, com retirada a qualquer momento e efeito imediato, prova só de inclusão, exportação e anonimização; e ganha um segundo provedor, o **AWS Bedrock na União Europeia** (`IA_PROVEDOR=bedrock-eu`), com o destino gravado em cada saída e mostrado ao titular.

**Architecture:** Uma tabela nova, `ia_autorizacoes` (🔒, por paciente, **sem** `staff_only`, só inclusão: `UPDATE`/`DELETE`/`TRUNCATE` revogados; o paciente insere só a própria autorização ou retirada pela política RESTRICTIVE `paciente_autorizacao_propria`; o gatilho de INSERT grava `registrado_em` e confere canal × papel da sessão; os campos só são anulados por duas funções `SECURITY DEFINER` no contexto `worker`), a coluna `ia_tarefas.destino` (gravada no portão do envio, imutável) e o tipo de arquivo `ia_autorizacao_termo`. O módulo `src/modules/ia/autorizacao.ts` lê a situação (último `autorizou`/`retirou` → vigente só com versão ≥ mínima, o uso da tarefa e o destino do provedor em uso) e escreve os eventos; a RN-100 passa a conferir a autorização no pedido, no portão do envio (com o paciente travado), ao gravar o resultado, ao aplicar a sugestão e na varredura `expirar-ia`; a retirada pelo paciente enfileira o job novo `ia-retirada` (a sessão de paciente não alcança `ia_tarefas`, `staff_only`). O link sem login segue o molde de `link-documento.ts` (sem estado, MAC com o e-mail atual, 7 dias, Turnstile e limite por IP, contexto de paciente `semConta`), com rotas de API. O provedor `bedrock-eu` é uma segunda implementação de `ProvedorIA` (`provedor-bedrock.ts`, único importador de `@anthropic-ai/bedrock-sdk`, cliente `AnthropicBedrock` de `InvokeModel` com o perfil de inferência `eu.`, credenciais e região explícitas, pedido ≤ 20 MB). A ciência do aviso do Plano 11 sai do código; as colunas dela ficam **congeladas** por gatilho (0109).

**Tech Stack:** Node 24 · pnpm · Next.js 16 (App Router, Server Actions, Route Handlers, `PageProps`/`RouteContext`) · React 19.2 · PostgreSQL 16 · Drizzle (drizzle-kit `generate` e `--custom`) · pg-boss 12 · Zod 4 · Vitest + Testcontainers · Playwright + `@axe-core/playwright` · `@anthropic-ai/sdk` 0.131 (já instalado) · **dependência nova: `@anthropic-ai/bedrock-sdk` 0.34.4** (só no worker; A-D26).

**Spec:** [`../specs/2026-10-03-nutridebby-ia-nutricionista-design.md`](../specs/2026-10-03-nutridebby-ia-nutricionista-design.md) **v0.5.1, só a parte do 14A** (§18.3): §1.1 (CS-105), §1.2 (A-04, A-06), §2.1 (AUT, UE), §2.3 (coluna Plano 14, partes do 14A), §3, §4 (fluxo do paciente), §5.1 (A-D26 e "Desenho"), §5.2, §5.3 (transferência, autorização, retirada, aditivo `0.2-provisorio`, direitos do titular), §5.5 (prêmio de 10% e AWS Budgets), §5.6 (portão com a autorização e retirada), §5.11 itens 3 e 8, texto da autorização (`0.1-provisorio`), US-101 (aditivo), US-103/US-104 (substituídas), **US-105 a US-109, US-113**, US-110 (cenário "sem autorização vigente"), RN-100, RN-101 (só a parte da 14A), RN-107, RN-108, RN-109, RN-112 (`sem_autorizacao`), RN-127 (só a leitura com `bedrock-eu`), RN-128, RNF-102, RNF-103, RNF-105, RNF-107, RNF-110, RNF-111, INT-07 (região), **INT-08**, §11 (`ia_autorizacoes`, `ia_tarefas.destino`, `stored_files`, `patients`), §12, R-110 e R-114 a R-117, §16.1.2 (A-D6, A-D23 a A-D26, A-D4), §18.1 (C1, C3, C5–C9, C12), §18.4 (RV-1 a RV-3 e as revisões normativa e de banco aplicadas). **Fora (14B):** US-120 a US-123, RN-103 (índice novo), RN-115 a RN-117, RN-120 a RN-126, `ia_geracoes_modelos`, `carimbo_dados`, os tipos `resumo_historico`/`rascunho_plano` em `ia_tarefas`, `IA_MODELO_ASSISTENTE` e `IA_TETO_RASCUNHO_USD` — o texto da autorização já lista os três usos (congelado, RV-2). Plano anterior da base de IA: [`2026-10-06-nutridebby-11-ia-laudos.md`](2026-10-06-nutridebby-11-ia-laudos.md). App do paciente: spec [`../specs/2026-10-08-nutridebby-app-paciente-g-design.md`](../specs/2026-10-08-nutridebby-app-paciente-g-design.md) (Plano 16). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md). Manual técnico: [`../../manual-tecnico/10-ia.md`](../../manual-tecnico/10-ia.md). Runbook da IA: [`../../operacao/ia.md`](../../operacao/ia.md).

## Global Constraints

- Tudo dos Planos 01–13 e 16 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel); `requireNutri` na **primeira** linha de toda página e Server Action da nutricionista (guarda `src/app/painel/acoes-de-paciente.test.ts`); `requirePaciente` na primeira linha de toda página e Server Action do portal; `requireApiNutri` em toda rota de `/api/painel` (guarda `src/app/api/painel/acesso-negado.test.ts`); toda rota de API de escrita confere `mesmaOrigem` antes de tudo (guarda `src/app/api/mesma-origem-rotas.test.ts`); ids de rota conferidos com `idValido` (id inválido = 404, nunca 500); todo `<form>` com `action={…}`, `method="post"` ou `method="get"` declarado em `GET_PERMITIDOS` (guarda `src/app/formularios-post.test.ts`). **Next.js 16 não é o Next do treino** (`AGENTS.md`): antes de escrever página, Server Action, Route Handler ou `searchParams`, ler o guia em `node_modules/next/dist/docs/01-app/`.
- **Base:** `main` com o Plano 16 (`0106_app_paciente_g`). Migrations: **`0107_ia_autorizacoes`** (gerada, T1), **`0108_rls_ia_autorizacoes`** (custom, T1), **`0109_ia_ciencia_congelada`** (custom, T10). Se outro plano entrar antes com migration, renumerar no rebase e corrigir as referências. Migrations só com `DATABASE_URL_MIGRATOR` (regra 7); nunca no banco de dev compartilhado sem combinar; nunca em produção fora do deploy. **Nenhum `DISABLE TRIGGER`** e nenhuma migração de dados (SBIS NGS1.07.01, §5.11 item 6).
- **Regra 1:** toda leitura e escrita de `ia_autorizacoes`, `ia_tarefas` e `patients` dentro de `withTenant` (painel = `nutri` com `actorUserId` e `ip`; app = `paciente` com `actorUserId`; link = `paciente` com `semConta: true`, só em `src/modules/ia/autorizacao-link.ts`, que entra em `SEM_CONTA_PERMITIDOS`; jobs = `worker`). O perfil profissional (nome, CRN, e-mail de contato) vem de `tenants` (sem RLS). **Nenhum arquivo novo** lê a tabela `user`. O admin continua sem tabelas 🔒 (guarda `src/app/admin/sem-tabelas-tenant.test.ts`).
- **Regra 2:** `ia_autorizacoes` é tabela nova com `tenant_id` e `patient_id`: `app_enable_tenant_rls` + `app_enable_patient_rls` + `app_allow_paciente_escrita('ia_autorizacoes', 'insert')` + entrada em `PACIENTE_ESCREVE` (`src/db/rls-guard.ts`) + `REVOKE UPDATE, DELETE, TRUNCATE` + `FABRICAS`, `SO_INSERE` e o filtro novo em `SO_APAGA.patients` (`test/isolamento.test.ts`). **Sem** `staff_only` (o paciente lê as próprias linhas), **sem** `PUBLICO_LIBERADO` (o link usa o contexto de paciente sem conta, N7).
- **Regra 3 / §5.7 / RNF-104:** nada de dado de saúde, e-mail, IP, user-agent, HMAC, token de link, nome do paciente ou chave da AWS em log, Sentry, fila (payload só ids) ou mensagem. Os e-mails novos (`autorizacao_ia`, `autorizacao_ia_confirmada`) não têm dado de saúde (o job vai cifrado, como todos). As chaves da AWS só pelo **nome** (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), nunca o valor (regra 6 do servidor).
- **Regra 8 (auditoria):** `ia_autorizacoes` fica **sem** o gatilho `audit_row_change`, com a entrada justificada em `AUDIT_EXCEPTIONS` (§11; a própria linha é a prova, como `consents`); "Ver termo assinado" chama `auditRead(tx, { entidade: 'ia_autorizacao', … })` (rótulo novo "Autorização de IA" em `ENTIDADE_ROTULO`). O portão do envio continua gravando o `exportar` da entidade `ia` ("Laudo enviado à IA").
- **Regra 9 (arquivos):** o termo em papel só por `salvarArquivo` (tipo `ia_autorizacao_termo`, `permitidos` `pdf`, `jpg`, `png`, dono = paciente, conta na cota), com o paciente travado no `antesDaReserva` e a linha de `ia_autorizacoes` gravada no `registrar` (ordem paciente → tenant → linha); FK `arquivo_path → stored_files.caminho` **`NO ACTION`**; sai só na anonimização, num passo próprio (`apagarTermosDeAutorizacao`, antes de `anexosDoPaciente`), com o ponteiro anulado por `app_ia_autorizacao_soltar_termo` no `naMesmaTransacao` do `apagarArquivo`; **nunca** no pedido de exclusão; servido só por `signFileUrl` (5 min).
- **RN-100 (todas as conferências):** IA da plataforma ligada (`IA_PROVEDOR` presente e `IA_DESLIGADA` ≠ 1), **retenção zero** (`IA_RETENCAO_ZERO=1`), tenant ativo com `ia_liberada`, `ia_ativada_em` e aditivo ≥ `0.2-provisorio`, paciente `ativo` e com **autorização vigente** (último `autorizou`/`retirou` = `autorizou`, versão ≥ `AUTORIZACAO_IA_VERSAO_MIN`, o uso da tarefa em `usos`, `destino` = o do provedor em uso). No app ao criar a tarefa, no worker (início, **portão do envio** com o paciente travado, gravação do resultado), em `aplicarSugestao` e na varredura `expirar-ia`.
- **Testes nunca chamam provedor real** (`fake` e `sandbox`; `provedor-bedrock.ts` só contra `fetch` falso). A avaliação com o Bedrock real é passo **manual** do dono (`pnpm ia:avaliar` com `IA_AVALIACAO_PROVEDOR=bedrock-eu`, runbook), fora do CI.
- Textos de interface em pt-BR, **com o texto exato da spec v0.5.1** quando existir (US-105 a US-109, US-113, RN-112, texto da autorização, aditivo `0.2-provisorio`); os textos novos estão em "Desvios conscientes" e vão à revisão de interface, à Debby e (os jurídicos) ao advogado. Os textos jurídicos são **provisórios** (`0.1-provisorio` e `0.2-provisorio`): em produção, "Liberar" continua recusado enquanto forem provisórios (D22 do Plano 11, agora pela autorização e pelo aditivo).
- Visual V2: só tokens do tema (`bg-cartao`, `text-suave`, `border-borda`, `text-link`, `text-erro`…), nunca cor fixa em `src/app/painel` e `src/modules/*/ui` (guarda `src/app/painel/cores.test.ts`); no portal, os componentes e tokens do Plano 16; acessibilidade (RNF-10): `<label htmlFor>`, `aria-invalid` + `aria-describedby`, erros com `role="alert"`, sucesso com `role="status"` numa região que já existe na tela, alvo de toque ≥ 44 px (`min-h-11`).
- **Imagem Docker:** orçamento de **265 MB** comprimidos (job `image` do CI; hoje ≈ 260 MB). O `@anthropic-ai/bedrock-sdk` traz `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/credential-providers` e pacotes `@smithy/*`: a T3 mede a imagem e poda o que não roda (fontes, mapas e declarações); **se passar de 265 MB depois da poda, a T3 para e pergunta ao dono** com a medida e as opções (subir o orçamento, ou trocar o SDK por assinatura SigV4 própria com `@smithy/signature-v4`).
- Custo: nenhum serviço pago novo além do uso da IA já aceito (A-01). Conta AWS em nome do CNPJ é passo do dono (runbook).
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel, serviços, firewall ou banco de produção; nunca exibir segredos. **Subagentes nunca consultam o banco de produção**, nem para leitura (a contagem da RN-128 é do controlador, com o OK do dono). Merge = deploy, só com OK explícito do dono e snapshot no hPanel antes. Lembrar o dono, a cada sessão, do **backup no host (P02-11)**.
- Política de revisão por entrega (índice, revista em 02/10/2026; modo misto com workflow): revisor por tarefa (cada tarefa diz **Revisão: completa (agente …)** ou **Revisão: leve (revisor-interface)**) → revisão final do branch (workflow) com uma onda de correções → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor vai para o backlog) → re-revisão só do diff das correções → `/security-review` (checklist: política e gatilho de `ia_autorizacoes`, funções `SECURITY DEFINER`, portão do envio com a autorização, link sem login, upload do termo, credenciais da AWS e variáveis que o SDK lê sozinho, exportação e anonimização). Se sobrar Critical/Important confirmado, parar e avisar o dono.

**Revisão completa** = o agente especialista indicado (`.claude/agents/revisor-rls.md` para banco, RLS, auditoria, gatilhos, arquivos, worker, provedor e rotas; `.claude/agents/normas-cfn-lgpd.md` para textos jurídicos, consentimento, LGPD, exportação e anonimização) com as lentes de segurança/LGPD e de spec, três verificadores adversariais por achado, até duas rodadas de correção. **Revisão leve** = `revisor-interface` (visual V2, textos, acessibilidade, manual guiado), uma rodada. O fechamento (T12) passa também pelo `guardiao-manual`.

### Decisões do plano

Todas técnicas, tomadas aqui com base na spec v0.5.1 e no código. Nenhuma pergunta nova ao dono bloqueia a execução; as pendências jurídicas (advogado) e de texto (Debby) estão no runbook.

| # | Tema | Decisão (aplicada no plano) |
|---|---|---|
| D1 | Cliente do Bedrock (INT-08: "Mantle ou InvokeModel") | **`AnthropicBedrock` (InvokeModel, `bedrock-runtime.{região}.amazonaws.com/model/{perfil}/invoke`)**: é o endpoint em que os perfis de inferência geográficos (`eu.…`) são documentados como `modelId`. O `AnthropicBedrockMantle` (`bedrock-mantle.{região}.api.aws`) fica fora; a avaliação do runbook (passo 4) confirma que o perfil `eu.` responde com `output_config` |
| D2 | Variáveis que o SDK do Bedrock lê sozinho (RNF-103) | Conferido no código do SDK 0.34.4: `AWS_REGION`, `ANTHROPIC_BEDROCK_BASE_URL`, **`AWS_BEARER_TOKEN_BEDROCK` (vence as chaves explícitas!)**, `ANTHROPIC_LOG`, `ANTHROPIC_CUSTOM_HEADERS` e a cadeia de credenciais da AWS (`AWS_PROFILE`, `AWS_SESSION_TOKEN`… — só alcançada sem chaves explícitas). O construtor recebe `awsRegion`, `baseURL`, `awsAccessKey`, `awsSecretKey`, `awsSessionToken: null`, `apiKey: null`, `logLevel: 'off'`, `maxRetries: 0`; e o worker **não sobe** com `AWS_BEARER_TOKEN_BEDROCK`, `AWS_SESSION_TOKEN`, `AWS_PROFILE`, `ANTHROPIC_BEDROCK_BASE_URL` ou `ANTHROPIC_CUSTOM_HEADERS` definidas (`src/env.ts`) |
| D3 | Modelos do `bedrock-eu` | Só `claude-sonnet-5-5` (perfil `eu.anthropic.claude-sonnet-5-5`, conferido no runbook); o Haiku 5.5 só entra depois de avaliado (INT-08). Com `bedrock-eu`, `IA_MODELO_LEITURA` fora da lista → o ambiente não sobe |
| D4 | Limite do pedido (C3, R-116) | Cada provedor declara `limitePedidoBytes` (Anthropic 32 MB, Bedrock **20 MB**); `prepararLaudo` recusa (`arquivo_invalido`, sem envio, **antes** do portão) o arquivo preparado cujo base64 + margem passaria do limite — no Bedrock, ≈ 14 MB de arquivo preparado. O app continua aceitando o laudo de até 20 MB (US-015) |
| D5 | Região e multiplicador (§5.5) | `ConfigIA.geo` vira a **região efetiva** (`RegiaoIA = 'us' \| 'global' \| 'eu'`): `bedrock-eu` → `'eu'`, multiplicador 1,1 (prêmio do perfil geográfico); `inference_geo` nunca vai ao Bedrock. `PRECOS_IA` vale para os dois provedores até o dono conferir a página de preços da AWS (runbook, R-117) |
| D6 | Destino na tarefa (RN-109) | O portão grava `ia_tarefas.destino` junto de `saiu_em`; tarefa que já saiu para um destino e, numa nova tentativa, encontraria outro provedor → `ia_desligada`, sem segunda saída |
| D7 | Situação da autorização | Função pura `situacaoDaAutorizacao(ultimo, destino)` sobre o último evento `autorizou`/`retirou` (por `registrado_em`, depois `id`): `nunca`, `vigente`, `retirada`, `versao_antiga`, `outro_destino`. Com `destino` nulo (IA desligada), o destino não é conferido (só a tela usa assim) |
| D8 | `motivoDoPaciente` | Sai de `ciencia-paciente.ts` e passa a `autorizacao.ts` com a assinatura `(paciente, situação, uso)`: as páginas de exames e de exames recebidos leem a situação por `situacaoIaDoPaciente` (sem auditoria: não é dado de saúde) |
| D9 | Retenção zero (A-D4, §12) | `IA_RETENCAO_ZERO` (app e worker). Sem ela, `estadoIaComPaciente` devolve `sem_retencao` e todo uso com dado de paciente cai em `ia_desligada` ("A IA está indisponível no momento. Você pode continuar sem ela."); configurações, pedidos de autorização e retiradas seguem funcionando |
| D10 | Quem pode pedir e decidir | Pedido por e-mail, termo em papel e "Ler e decidir" no app só com a IA **ativa** no consultório (`estadoIaDoTenant = 'ativa'`, sem exigir a retenção zero) e com o perfil profissional completo (nome, CRN e e-mail de contato — o texto os cita); a **retirada** funciona sempre (IA desativada, bloqueada pela admin, emergência, link vencido) |
| D11 | Link de retirada (RN-107) | Token sem estado amarrado ao **id da autorização** e à chave derivada, **sem** o e-mail no MAC: "não vence" e não morre se o e-mail for corrigido; deixa de valer só quando aquela autorização deixa de ser a decisão mais recente. O link do pedido continua com o MAC do e-mail atual (spec) |
| D12 | Formato dos tokens | Um byte de versão e um de tipo (1 = pedido, 2 = retirada) no corpo, MAC de 128 bits (HMAC-SHA-256 com `hkdf(ENCRYPTION_KEY, 'nutridebby:link-autorizacao-ia:v1')`); pedido = 54 bytes (72 caracteres base64url), retirada = 66 bytes (88). O HMAC do e-mail usa outra chave derivada (`nutridebby:email-autorizacao-ia:v1`) |
| D13 | Um pedido aberto por vez (US-105) | Aberto = o último `pedido_email` tem menos de 7 dias **e** o mesmo HMAC do e-mail atual (com o e-mail corrigido, o link antigo morreu e o pedido novo é permitido) |
| D14 | Job `ia-retirada` | Payload `{ tenantId, patientId, retiradaId }`; trava o paciente, relê a situação; se o paciente autorizou de novo, cancela só as tarefas criadas antes da retirada (`cancelarTarefas` com `criadasAntesDe`) |
| D15 | Varredura `expirar-ia` (rede de segurança, RN-108) | Ganha o critério "paciente sem autorização vigente para o uso": `na_fila`/`pronta` → `cancelada` (estorno da fila), `processando` → `cancelada` (estorno se nada saiu; reserva mantida como incerta se `enviado_em` está gravado). Mesma trava única por id |
| D16 | Data do termo em papel | `em = inicioDoDia(data, fuso do tenant)` (`src/modules/agenda/fuso.ts`), recusada se futura ou anterior a `AUTORIZACAO_IA_VERSAO_DATA` (`'2026-10-09'`) |
| D17 | Legado do Plano 11 (RN-128) | As colunas de ciência ficam; o gatilho `patients_ia_quem` é refeito numa migration **própria** (`0109`, T10) — refeito na `0108`, quebraria a ciência do Plano 11 que o código ainda usa até a T7; o e-mail `aviso_ia` que estiver na fila é descartado por `processEmailJob` sem enviar nem gravar; `aposEnviar`/`aoDesistir` saem do worker (só serviam ao aviso) |
| D18 | Rótulos da auditoria | Só a entidade nova `ia_autorizacao` ("Autorização de IA"). Os rótulos por tipo de tarefa da RN-101 ("Pediu resumo à IA"…) são da 14B |
| D19 | Ordem e paralelismo | Tabela "Dependências e paralelismo" no fim. Em resumo: **[T1 ‖ (T2 → T3)] → T4 → [T5 ‖ T9] → [T6 ‖ T7 ‖ T8] → T10 → T11 → T12** |

### Desvios conscientes da spec v0.5.1

1. **Fábrica do isolamento** (§11 pede "fábrica de canal `app` … + `COM_MAE`"): o gatilho `ia_autorizacoes_regras` recusa a equipe registrando canal `app` ou `link` (defesa a mais, item 4 abaixo) e as fábricas rodam como `nutri`; a fábrica é então `retirou` pelo canal `nutricionista`, e fica **fora** de `COM_MAE` (a mãe, `patients`, já existe — a recusa dos testes negativos vem da política da própria tabela). O canal `app` é coberto em `src/db/ia-autorizacoes.test.ts`.
2. **Link sem login por rotas de API** (§4 desenha "Server Action em `<form>`" também para o link): segue o padrão em produção do link de documentos (`/api/documento/[token]/…`, `fetch` + Turnstile + `mesmaOrigem` + `lerJson`); no app (`/p/perfil/ia`) e no painel, Server Actions em `<form>`.
3. **`em = registrado_em` em todo canal menos o papel** (a spec diz "nos canais `app` e `link`"): a retirada pela nutricionista e o pedido por e-mail também são atos do instante do registro.
4. **Coerência canal × papel no gatilho de INSERT** (defesa a mais, não pedida): a sessão `nutri` só grava `papel`, `nutricionista` ou `pedido_email`, com `registrado_por` = a usuária da sessão; o `worker` não grava evento; a sessão de paciente fica com a política RESTRICTIVE (spec). Fecha a nutricionista "registrando" uma autorização do app em nome do paciente.
5. **`email_hmac` obrigatório só em `autorizou` e `pedido_email` pelo link**; a retirada pelo link de retirada (D11) grava o HMAC do e-mail atual quando há e-mail.
6. **"Nos dois casos, os seus dados saem do Brasil"** (texto da autorização): a tela, o e-mail e o termo mostram só a variante do provedor em uso (spec), então a frase vira **"Os seus dados saem do Brasil."** — vai ao advogado (runbook passo 6). O destino `teste` (dev, CI, E2E) ganha a variante "Ambiente de teste: os dados não são enviados a nenhum fornecedor de IA." e o aditivo, "Provedor de teste, sem envio de dados a fornecedor." (nunca em produção: `sandbox`/`fake` são recusados lá).
7. **Perfil profissional incompleto** bloqueia o pedido, o termo e o "Ler e decidir" (D10), com o texto novo "Complete seu perfil profissional (nome completo, CRN e e-mail de contato) em Configurações antes de pedir a autorização de IA." — o texto da autorização cita o nome, o CRN e o contato.
8. **Bloco do app** (US-106 "Consultório sem IA"): aparece com a IA ativa no consultório **ou** com algum registro do paciente; o "Ler e decidir" só com a IA ativa (D10). Num consultório que ativou e depois desativou a IA, o paciente sem registro não vê o bloco (nada a decidir).
9. **Textos novos** (vão à revisão de interface, à Debby e, os do e-mail, ao advogado junto com a autorização): corpo do e-mail do pedido ("{consultório} pede a sua autorização para usar uma ferramenta de inteligência artificial (IA) com os seus dados de saúde." / "Leia o texto completo pelo botão abaixo e decida. Autorizar é opcional: recusar não muda nada no seu atendimento." / "O link vale por 7 dias.") e o do e-mail de confirmação (resumo com a versão, os três usos e o destino, e "Você pode retirar a autorização quando quiser, sem custo, pelo botão abaixo. Retirar não muda nada no seu atendimento."); "Envie um arquivo JPEG, PNG ou PDF de até 20 MB." (termo); "Tente novamente em alguns minutos" (Turnstile fora, igual ao link de documentos); o perfil incompleto (item 7); o destino `teste` (item 6).
10. **Os campos legados `avisoIa`, `avisoIaEnviadoEm` e `recusouIaEm`** passam a sair na exportação **só quando preenchidos** (US-113; hoje saem sempre, com `null`).
11. **Guia do portal** ganha um item em "Perguntas comuns" sem subir a `versao` (a autorização depende da IA ligada no consultório; subir a versão mostraria o aviso "O app mudou" a todos os pacientes por uma função desligada em produção) — mesmo critério da T17 do Plano 11. O guia `configuracoes` sobe para a versão 5 (texto mudado) e o `prontuario` para a 2 (item novo).

## Review Focus

1. **A retirada corre com o envio.** O paciente retira no app (ou pelo link) entre o pedido e o portão; o job `ia-retirada` atrasa (fila parada) ou o paciente autoriza de novo antes de o job rodar; a nutricionista registra a retirada enquanto o worker está entre o preparo e o portão. Esperado: nada sai depois do commit da retirada (o portão lê a autorização com o paciente travado: `sem_autorizacao`, estorno); a tarefa criada antes da retirada é cancelada mesmo com a reautorização; a criada depois, não; nenhum deadlock (paciente → tenant → tarefas). Testes: T4 (portão com a retirada entre o preparo e o portão; job com reautorização; varredura).
2. **Link forjado, velho ou de outra pessoa.** Token com um byte trocado; token de pedido de outro paciente ou de outro consultório; pedido com mais de 7 dias; e-mail do paciente corrigido depois do envio; link de retirada de uma autorização já substituída; link de retirada depois de 7 dias com a IA desativada; POST sem Turnstile, de outra origem ou acima do limite por IP; paciente bloqueado ou anonimizado. Esperado: os textos da US-107/US-109 ("Este link não é mais válido…", "Este link expirou…", "Esta autorização já não está em vigor.", "Confirme que você não é um robô.", "Muitas tentativas…"), nada gravado, nenhum dado de saúde na página. Testes: T5 (tokens), T6 (fluxos e rotas).
3. **Troca de provedor e de versão.** O dono troca `IA_PROVEDOR` de `anthropic` para `bedrock-eu` com autorizações dadas e tarefas na fila; `AUTORIZACAO_IA_VERSAO_MIN` sobe; `IA_DESLIGADA=1` com autorizações vigentes. Esperado: autorização de outro destino ou versão = sem autorização vigente (tela "O destino mudou…"/"…que não vale mais…", portão `sem_autorizacao`, varredura cancela); tarefa que já saiu para A não sai para B (D6); a exportação mostra o destino gravado em cada tarefa. Testes: T2 (situação), T4 (portão e varredura), T9 (exportação).
4. **Termo em papel, tudo ou nada.** O `registrar` falha depois de o arquivo ir ao disco; o paciente é bloqueado entre a tela e o "Salvar"; data futura, anterior à versão ou inválida; arquivo de 21 MB, SVG ou vazio; cota esgotada; o pedido de exclusão chega depois do termo. Esperado: arquivo e linha nascem juntos ou nenhum; textos da US-108; o bloqueio não apaga a foto nem as linhas; só a anonimização apaga a foto e anula IP, user-agent, HMAC e a conta do canal `app`. Testes: T5 (registro), T9 (bloqueio e anonimização).
5. **A sessão de paciente tentando forjar.** O paciente (app) insere `pedido_email`, canal `papel` ou `nutricionista`, canal `app` com a conta de outra pessoa, canal `link` estando logado, um evento de outro paciente do mesmo consultório, ou manda `em` no passado; um paciente com dois consultórios autoriza num e tenta valer no outro; a sessão de paciente tenta `UPDATE`/`DELETE`. Esperado: recusa pela política (42501) ou pela permissão; `em` sempre = `registrado_em`; a autorização vale só no vínculo aberto. Testes: T1 (banco), T5 (app).

---

## Estrutura de arquivos

```
drizzle/
  0107_ia_autorizacoes (gerada: ia_autorizacoes, ia_tarefas.destino + CHECK, stored_files_tipo_valido com o tipo novo)   # T1
  0108_rls_ia_autorizacoes (custom: RLS, política do paciente, REVOKE, gatilho ia_autorizacoes_regras,
                            app_ia_autorizacao_soltar_termo, app_anonimizar_autorizacoes_ia, ia_tarefas_imutavel refeita)  # T1
  0109_ia_ciencia_congelada (custom: patients_ia_quem refeito — colunas de ciência congeladas, RN-128)                    # T10
src/db/schema/ia.ts (iaAutorizacoes, iaTarefas.destino) · src/db/schema/platform.ts (tipo do stored_files)             # T1
src/db/ia-autorizacoes.test.ts (novo) · src/db/rls-guard.ts · src/db/audit-guard.ts · test/isolamento.test.ts · test/ia.ts  # T1
CLAUDE.md (regras 2 e 8)                                                                                                 # T1 (regra 9 na T9)
src/modules/ia/
  constantes.ts · textos-legais.ts (+ test) · modo.ts (+ test)                                                           # T2
  provedor.ts · provedor-bedrock.ts (novo, + test) · provedor-anthropic.ts (+ test) · provedor-sandbox.ts · provedor-fake.ts
    · provedor-do-ambiente.ts (+ test) · precos.ts (+ test) · preparar-arquivo.ts (+ test) · guardas.test.ts
    · avaliacao/avaliar.ts                                                                                               # T3
  autorizacao.ts (novo: leitura, RN-100, retirada da nutricionista) · autorizacao-retirada-job.ts (novo) · cancelar.ts
    · tarefas.ts · leitura-job.ts · conferencia.ts (+ tests) · travas.test.ts · logs.test.ts                             # T4
  autorizacao.ts (escrita: app, pedido, papel, termo, painel e app) · autorizacao-token.ts (novo, + test)               # T5
  autorizacao-link.ts (novo, + test)                                                                                     # T6
  ciencia-paciente.ts (+ test) — APAGADOS                                                                               # T10
src/components/texto-legal.tsx (novo)                                                                                   # T2
src/env.ts (+ env.test.ts) · .env.example · src/modules/plataforma/contas.ts (+ test) · src/app/admin/page.tsx
  · src/app/painel/configuracoes/ia-secao.tsx                                                                            # T2
package.json · pnpm-lock.yaml · Dockerfile · .github/workflows/ci.yml (fumaça do SDK do Bedrock) · scripts/ia-avaliar.ts   # T3 (ci.yml também na T11)
src/jobs/queues.ts (ia-retirada) · src/worker/index.ts                                                                   # T4 (e T10)
src/app/painel/pacientes/[id]/exames/{page.tsx,ia-exame.tsx,ia-exame.test.ts,actions.ts}
  · src/app/painel/exames-recebidos/[id]/page.tsx                                                                        # T4
src/email/types.ts · src/email/templates.tsx · src/email/render.test.ts · src/modules/plataforma/audit.ts (rótulo)
  · src/modules/agenda/limite-ip.ts (tipo da chave)                                                                      # T5 (limite-ip na T6)
src/db/tenant.ts (SEM_CONTA_PERMITIDOS) · src/app/autorizacao-ia/[token]/{page.tsx,decisao-form.tsx} (novos)
  · src/app/api/autorizacao-ia/[token]/{link.ts,autorizar/route.ts,retirar/route.ts} (novos, + link.test.ts) · next.config.ts  # T6
src/app/painel/pacientes/[id]/privacidade/{page.tsx,uso-ia.tsx,actions.ts,actions.test.ts,termo-papel-form.tsx (novo)}
  · src/app/painel/pacientes/[id]/privacidade/termo-ia/{page.tsx,imprimir.tsx} (novos) · src/app/painel/pacientes/[id]/layout.tsx
  · src/app/api/painel/pacientes/[id]/autorizacao-ia/termo/route.ts (novo, + test)
  · src/app/api/painel/pacientes/[id]/autorizacao-ia/[autorizacaoId]/termo/route.ts (novo, + test) · e2e/painel-rotas.ts   # T7
src/app/p/(portal)/perfil/{page.tsx,privacidade.tsx,actions.ts,page.test.ts} · src/app/p/(portal)/perfil/ia/page.tsx (novo)  # T8
src/modules/pacientes/exportacao-job.ts · exportacao.test.ts · lgpd.ts · lgpd.test.ts · CLAUDE.md (regra 9)             # T9
src/email/job.ts · src/email/email.test.ts · src/db/ia-schema.test.ts · src/db/schema/pacientes.ts (comentários)         # T10
src/modules/ajuda/conteudo.ts · src/modules/ajuda/portal.ts (+ tests) · e2e/ia-laudos.spec.ts · e2e/autorizacao-ia.spec.ts (novo)
  · e2e/acessibilidade.spec.ts · scripts/e2e-seed.ts · playwright.config.ts                                               # T11
docs/manual-tecnico/10-ia.md · 02-banco-de-dados.md · 06-worker-seguranca-operacao.md · README.md · docs/operacao/ia.md
  · docs/operacao/go-live.md · índice · backlog · spec da IA (v0.6)                                                     # T12
```

### Contratos entre tarefas (nomes que várias tarefas usam)

```ts
// src/db/schema/ia.ts (T1)
export const iaAutorizacoes: PgTable; export type IaAutorizacaoRow = typeof iaAutorizacoes.$inferSelect;
// iaTarefas.destino: text('destino') — código do destino gravado no portão (RN-109), imutável depois de gravado
// banco (T1), mensagens citadas nos testes: 'termo em papel sem o arquivo', 'autorização de IA sem quem registrou',
//   'evento pelo link sem o e-mail', 'a equipe não registra autorização pelo app nem pelo link', 'quem registrou é a
//   usuária da sessão', 'o worker não registra autorização de IA', 'só roda no contexto worker', 'o destino da saída ao provedor não muda'
// SQL: app_ia_autorizacao_soltar_termo(uuid) RETURNS boolean · app_anonimizar_autorizacoes_ia(uuid) RETURNS void
// test/ia.ts (T1; T2 e T4 acrescentam)
export function autorizacaoNoBanco(db: Db, tenantId: string, patientId: string, o?: { evento?: 'autorizou' | 'retirou'; versao?: string; usos?: string[]; destino?: string; emailHmac?: string }): Promise<string>;
export function termoNoDisco(db: Db, ctx: TenantContext, patientId: string): Promise<string>; // linha de stored_files do tipo ia_autorizacao_termo
export const IA_TESTE: ConfigIA;                                                           // T2 (fake, destino teste, retenção zero)
export function pacienteAutorizado(db: Db, ctx: TenantContext, extra?: Partial<typeof patients.$inferInsert>): Promise<PatientRow>; // T4

// src/modules/ia/constantes.ts (T2; sem imports)
export const USOS_IA: readonly ['leitura_laudos', 'resumo_historico', 'rascunho_plano']; export type UsoIA;
export const USO_DA_TAREFA: Record<TipoTarefa, UsoIA>;                                     // leitura_exame → leitura_laudos
export const DESTINOS_IA: readonly ['anthropic-us', 'bedrock-eu', 'teste']; export type DestinoIA;
export const DESTINO_ROTULO: Record<DestinoIA, string>; export const ROTULO_DESTINO_LEGADO: string; // "Anthropic (Claude), Estados Unidos"
export const PROVEDORES_IA: readonly ['anthropic', 'bedrock-eu', 'sandbox', 'fake']; export type ProvedorConfigurado;
export const DESTINO_DO_PROVEDOR: Record<ProvedorConfigurado, DestinoIA>;
export const MODELOS_BEDROCK_EU: readonly ModeloIA[]; export const REGIOES_BEDROCK_EU: readonly [...]; export type RegiaoBedrock;
export const CANAIS_AUTORIZACAO; export type CanalAutorizacao; export const CANAL_ROTULO: Record<CanalAutorizacao, string>;
export const EVENTOS_AUTORIZACAO; export type EventoAutorizacao;
export const VALIDADE_PEDIDO_MS = 7 * 86_400_000; export const JANELA_EMAIL_TROCADO_MS = 30 * 86_400_000; export const TERMO_MAX_BYTES = 20 * 1024 * 1024;
// MOTIVOS_FALHA ganha 'sem_autorizacao'; MSG_IA ganha semAutorizacao e retirou; MSG_AUTORIZACAO (textos da US-105 a US-109)
// src/modules/ia/textos-legais.ts (T2)
export const AUTORIZACAO_IA_VERSAO = '0.1-provisorio', AUTORIZACAO_IA_VERSAO_MIN = '0.1-provisorio', AUTORIZACAO_IA_VERSAO_DATA = '2026-10-09';
export const IA_ADITIVO_VERSAO = '0.2-provisorio', IA_ADITIVO_VERSAO_MIN = '0.2-provisorio';
export type Trecho = { texto: string; forte?: true }; export type Paragrafo = readonly Trecho[]; export type TextoLegal = { titulo: string; paragrafos: readonly Paragrafo[] };
export type CanalDoTexto = 'app' | 'link' | 'papel_com_email' | 'papel_sem_email';
export type Responsavel = { consultorio: string; nutricionista: string; crn: string; contato: string };
export function responsavelDoTenant(t: Pick<TenantRow, 'nomeExibicao' | 'nomeProfissional' | 'crn' | 'contatoEmail'>): Responsavel | null;
export function textoDaAutorizacao(versao: string, d: Responsavel & { destino: DestinoIA; canal: CanalDoTexto; avisoPrivacidadeUrl?: string | null }): TextoLegal | null;
export function aditivoIa(destino: DestinoIA): TextoLegal;
export function textoCorrido(p: Paragrafo): string;
// src/modules/ia/modo.ts (T2; T3 muda geo para RegiaoIA)
export type ModoIA = 'ausente' | 'emergencia' | 'anthropic' | 'bedrock-eu' | 'sandbox' | 'fake';
export type ConfigIA = { modo: ModoIA; destino: DestinoIA | null; modelo: ModeloIA; geo: RegiaoIA; tetoGlobalMicroUsd: number; retencaoZero: boolean };
export type EstadoIaTenant = 'ausente' | 'emergencia' | 'suspensa' | 'nao_liberada' | 'nao_ativada' | 'aditivo_desatualizado' | 'sem_retencao' | 'ativa';
export function estadoIaComPaciente(t: Pick<TenantRow, 'status' | 'iaLiberada' | 'iaAtivadaEm' | 'iaAditivoVersao'>, ia: Pick<ConfigIA, 'modo' | 'retencaoZero'>): EstadoIaTenant;
// src/components/texto-legal.tsx (T2)
export function TextoLegalView(p: { texto: TextoLegal; nivel?: 'h2' | 'h3'; id?: string }): JSX.Element;

// src/modules/ia/constantes.ts (T3): export const REGIOES_IA = ['us', 'global', 'eu'] as const; export type RegiaoIA;
// src/modules/ia/precos.ts (T3): MULTIPLICADOR_GEO: Record<RegiaoIA, number> (eu = 1,1); custoMicroUsd/custoMaximoMicroUsd/custoMaximoDoArquivo/reservaDaLeitura com geo: RegiaoIA
// src/modules/ia/provedor.ts (T3)
export interface ProvedorIA { readonly nome: 'anthropic' | 'bedrock-eu' | 'sandbox' | 'fake'; readonly destino: DestinoIA; readonly limitePedidoBytes: number; lerDocumento(p: PedidoLeitura): Promise<RespostaLeitura> }
// PedidoLeitura.geo: RegiaoIA
// src/modules/ia/provedor-bedrock.ts (T3)
export const PERFIL_BEDROCK_EU: Partial<Record<ModeloIA, string>>; export const LIMITE_PEDIDO_BEDROCK_BYTES = 20 * 1024 * 1024;
export function classificarErroBedrock(err: unknown): ErroProvedor;
export function provedorBedrock(o: { regiao: RegiaoBedrock; accessKeyId: string; secretAccessKey: string; fetch?: typeof fetch; baseURL?: string; timeoutMs?: number }): ProvedorIA;
// src/modules/ia/preparar-arquivo.ts (T3)
export function prepararLaudo(conteudo: Buffer, o?: { limitePedidoBytes?: number }): Promise<ArquivoPreparado>;

// src/modules/ia/autorizacao.ts (T4: leitura e retirada da nutricionista; T5: escrita e telas)
export type SituacaoAutorizacao =
  | { tipo: 'nunca' }
  | { tipo: 'vigente'; id: string; em: Date; canal: CanalAutorizacao; versao: string; destino: DestinoIA; usos: UsoIA[] }
  | { tipo: 'retirada'; id: string; em: Date; canal: CanalAutorizacao }
  | { tipo: 'versao_antiga'; id: string; em: Date; canal: CanalAutorizacao; versao: string }
  | { tipo: 'outro_destino'; id: string; em: Date; canal: CanalAutorizacao; versao: string; destino: DestinoIA };
export type EventoDeDecisao = Pick<IaAutorizacaoRow, 'id' | 'evento' | 'versao' | 'usos' | 'destino' | 'canal' | 'em' | 'registradoEm'>;
export function situacaoDaAutorizacao(ultimo: EventoDeDecisao | null, destino: DestinoIA | null): SituacaoAutorizacao;
export function vigentePara(s: SituacaoAutorizacao, uso: UsoIA): boolean;
export function ultimaDecisao(tx: Tx, patientId: string): Promise<EventoDeDecisao | null>;
export function autorizacaoDoPaciente(tx: Tx, patientId: string, destino: DestinoIA | null): Promise<SituacaoAutorizacao>;
export function motivoDoPaciente(p: Pick<PatientRow, 'status' | 'anonimizadoEm'>, s: SituacaoAutorizacao, uso: UsoIA): MotivoFalha | null;
export function situacaoIaDoPaciente(ctx: TenantContext, patientId: string, destino: DestinoIA | null, db?: Db): Promise<SituacaoAutorizacao>;
export function registrarRetiradaPelaNutri(ctx: TenantContext, patientId: string, deps?: { db?: Db; agora?: Date }): Promise<boolean>;
// — T5 —
export class AutorizacaoError extends Error { readonly erros: Record<string, string> }
export type DepsAutorizacao = { ia: ConfigIA; appUrl: string; db?: Db; agora?: Date; boss?: PgBoss; dataDir?: string; ip?: string | null; userAgent?: string | null; depoisDaLinha?: (tx: Tx) => Promise<unknown> /* só testes */ };
export function autorizarNoApp(ctx: TenantContext, deps: DepsAutorizacao): Promise<'registrada' | 'ja_vigente'>;
export function retirarNoApp(ctx: TenantContext, deps: Pick<DepsAutorizacao, 'db' | 'boss' | 'ip' | 'userAgent'>): Promise<'retirada' | 'nada_a_retirar'>;
export function enfileirarConfirmacao(tx: Tx, o: { tenantId: string; patientId: string; autorizacaoId: string; para: string | null; consultorio: string; destino: DestinoIA; appUrl: string }): Promise<void>;
export function enviarPedidoPorEmail(ctx: TenantContext, patientId: string, deps: DepsAutorizacao): Promise<{ validoAte: Date }>;
export function registrarTermoEmPapel(ctx: TenantContext, patientId: string, input: { data: unknown; confirmacao: boolean; arquivo: Buffer | null }, deps: DepsAutorizacao): Promise<string>;
export function caminhoDoTermo(ctx: TenantContext, patientId: string, autorizacaoId: string, db?: Db): Promise<string | null>;
export type EventoNaTela = { id: string; evento: EventoAutorizacao; canal: CanalAutorizacao; versao: string | null; destino: DestinoIA | null; em: Date; temTermo: boolean };
export type PainelAutorizacao = { situacao: SituacaoAutorizacao; eventos: EventoNaTela[]; pedidoAbertoAte: Date | null; alertaEmailTrocado: boolean; codigoDeReferencia: string; temRegistro: boolean };
export function painelDaAutorizacao(ctx: TenantContext, paciente: Pick<PatientRow, 'id' | 'email'>, destino: DestinoIA | null, o?: { db?: Db; agora?: Date }): Promise<PainelAutorizacao>;
export function secaoIaVisivel(modo: ModoIA, tenant: Pick<TenantRow, 'iaLiberada' | 'iaAditivoVersao'>, temRegistro: boolean): boolean;
export type BlocoIaApp = { situacao: SituacaoAutorizacao; podeDecidir: boolean };
export function blocoIaDoApp(ctx: TenantContext, tenant: TenantRow, ia: ConfigIA, db?: Db): Promise<BlocoIaApp | null>;
// src/modules/ia/autorizacao-token.ts (T5)
export function emailHmac(email: string): string;
export function assinarLinkPedido(l: { tenantId: string; patientId: string; emitidoEm: Date; email: string }): string;
export function assinarLinkRetirada(l: { tenantId: string; patientId: string; autorizacaoId: string }): string;
export type LinkDecodificado = { tipo: 'pedido'; tenantId: string; patientId: string; emitidoEm: Date } | { tipo: 'retirada'; tenantId: string; patientId: string; autorizacaoId: string };
export function lerLinkAutorizacao(token: unknown): (LinkDecodificado & { confere: (email: string | null) => boolean }) | null;
export function codigoDeReferencia(tenantId: string, patientId: string, versao: string): string; // "XXXX-XXXX-XXXX"
export const urlDoLinkAutorizacao: (appUrl: string, token: string) => string;
// src/modules/ia/autorizacao-retirada-job.ts (T4)
export type DadosRetiradaIa = { tenantId: string; patientId: string; retiradaId: string };
export function processarRetiradaIa(d: DadosRetiradaIa, deps: { db: Db; destino: DestinoIA | null; agora?: () => Date }): Promise<number>;
// src/modules/ia/cancelar.ts (T4): cancelarTarefas(tx, o & { criadasAntesDe?: Date })
// src/modules/ia/leitura-job.ts (T4): DepsJobIA ganha destino e retencaoZero; expirarTarefasDoTenant(tx, agora, destino); expirarTarefasIA(db, agora, destino)
// src/modules/ia/autorizacao-link.ts (T6)
export type EstadoLinkIa = { tipo: 'invalido' } | { tipo: 'expirado' } | { tipo: 'nao_vigente' }
  | { tipo: 'decidir'; consultorio: string; texto: TextoLegal } | { tipo: 'ja_autorizou'; consultorio: string; em: Date } | { tipo: 'retirar'; consultorio: string; em: Date };
export class LinkIaError extends Error { readonly status: number; readonly mensagem: string }
export type DepsLinkIa = { ia: ConfigIA; appUrl: string; ip: string | null; ipDoLimite: string | null; userAgent: string | null; verificarTurnstile: (t: string | null) => Promise<'ok' | 'invalido' | 'indisponivel'>; db?: Db; agora?: Date };
export function estadoDoLinkIa(token: unknown, deps: DepsLinkIa): Promise<EstadoLinkIa>;
export function autorizarPeloLink(token: unknown, input: { turnstile?: unknown }, deps: DepsLinkIa): Promise<void>;
export function retirarPeloLink(token: unknown, input: { turnstile?: unknown }, deps: DepsLinkIa): Promise<void>;
// src/modules/pacientes/lgpd.ts (T9)
export function apagarTermosDeAutorizacao(ctx: TenantContext, patientId: string, deps: { db?: Db; dataDir?: string }): Promise<number>;
export function termosDeAutorizacaoRestantes(tx: Tx, patientId: string): Promise<boolean>;
// e-mails (T5): { tipo: 'autorizacao_ia'; para; consultorio; link } · { tipo: 'autorizacao_ia_confirmada'; para; consultorio; destino; versao; link }
// fila (T4): 'ia-retirada' { tenantId, patientId, retiradaId }
```

### Cobertura da spec v0.5.1, parte do 14A (autoconferência)

| Requisito | Tarefa(s) |
|---|---|
| RN-107 (tabela, só inclusão, `registrado_em` no gatilho, vigência, quem grava, papel, link, pedido aberto, `AUDIT_EXCEPTIONS`, `auditRead` do termo) | T1 (banco), T4 (vigência), T5 (escrita, papel, pedido, termo), T6 (link) |
| RN-108 (retirada com efeito imediato, job `ia-retirada`, varredura, aplicar) | T4 |
| RN-109 (destino em código, rótulo, destino trocado = sem autorização, `ia_tarefas.destino`, usos congelados) | T1, T2, T4, T9 |
| RN-100 reescrita (retenção zero, aditivo 0.2, autorização vigente; app, portão, resultado, aplicar) | T2, T4 |
| RN-112 (`sem_autorizacao`, texto novo de `paciente_indisponivel`) | T2, T4 |
| RN-128 (colunas congeladas, e-mails `aviso_ia` descartados, exportação do legado) | T9 (exportação), T10 |
| US-101 (aditivo `0.2-provisorio` por destino) | T2 |
| US-105 (seção "Uso de IA", registros, pedido, e-mail trocado, versão/destino, quando aparece) | T5 (dados), T7 (tela) |
| US-106 (app) | T5 (módulo), T8 (telas) |
| US-107 (link) | T5 (token, e-mails), T6 |
| US-108 (termo em papel) | T5 (módulo), T7 (telas e rotas) |
| US-109 (retirada: app, link, nutricionista, efeito imediato, reautorizar) | T4, T5, T6, T7, T8 |
| US-110 (sem autorização vigente; "Aceitar e ler") | T4 |
| US-113 (exportação, anonimização, bloqueio) | T9 |
| INT-08, RNF-103, RNF-105, RNF-107 (Bedrock, SDK, variáveis, `sandbox`/`fake` com destino `teste`), C3, C4, C5 | T2 (ambiente), T3 |
| RNF-102, RNF-110, RNF-111 (a)–(j) | T1 (d, j, f-banco, g-funções), T4 (a, b, c), T5 (f, h), T6 (e, i), T9 (g) |
| CS-105 | T4 (portão: retirada, versão antiga e destino trocado entre o pedido e o envio) |
| §5.5 (prêmio de 10% e região `eu`), A-D4/A-D26 | T2, T3; AWS Budgets e Cost Explorer no runbook (T12) |
| RN-127 (a leitura de novo com `bedrock-eu`) | T3 (script), runbook (T12) |
| C1 (aditivo `0.2-provisorio`), C6, C7, C8 (D22 pela autorização), C9, C12 (bloco em Eu › Privacidade + `/p/perfil/ia`) | T2, T4, T8 |

### Task 1: Banco — `ia_autorizacoes` só de inclusão, política do paciente, gatilho de INSERT, funções de anonimização, `ia_tarefas.destino` e o tipo de arquivo do termo (P14A-01)

**Revisão: completa (agente revisor-rls)** — tabela nova com RLS por tenant e paciente, escrita do paciente, `REVOKE`, gatilho, duas funções `SECURITY DEFINER`, gatilho de imutabilidade refeito, guardas do CI.

**Files:**
- Modify: `src/db/schema/ia.ts` (tabela `iaAutorizacoes`, coluna `iaTarefas.destino` e o CHECK), `src/db/schema/platform.ts` (`stored_files_tipo_valido` com `ia_autorizacao_termo`)
- Create: `drizzle/0107_ia_autorizacoes.sql` (gerada) e o snapshot em `drizzle/meta/`, `drizzle/0108_rls_ia_autorizacoes.sql` (custom), `src/db/ia-autorizacoes.test.ts`
- Modify: `src/db/rls-guard.ts` (`PACIENTE_ESCREVE`), `src/db/audit-guard.ts` (`AUDIT_EXCEPTIONS`), `test/isolamento.test.ts` (`FABRICAS`, `SO_INSERE`, `SO_APAGA.patients`), `test/ia.ts` (`autorizacaoNoBanco`, `termoNoDisco`), `src/modules/plataforma/armazenamento.ts` (`TipoDeArquivo`, `TIPOS_DO_PACIENTE`), `CLAUDE.md` (regras 2 e 8)

**Interfaces:**
- Consumes: `app_enable_tenant_rls`, `app_enable_patient_rls`, `app_allow_paciente_escrita` (0070), `app_current_role()`, `app_current_user()`, `app_current_tenant()`, `app_ia_tarefas_imutavel` (0100), `novoTenant`, `novoPaciente`, `ctxPaciente` (`test/pacientes.ts`), `tarefaNoBanco` (`test/ia.ts`).
- Produces: o que está em "Contratos entre tarefas" para `src/db/schema/ia.ts`, `test/ia.ts` (T1) e o banco (mensagens dos gatilhos e as duas funções).

- [ ] **Step 0: Rebase sobre a `main` com o Plano 16**

O Plano 16 entra na `main` antes deste plano (combinado com o dono). No worktree:

```bash
cd /home/deploy/servidor/projetos/nutridebby-plano14
git fetch origin
git rebase origin/main
ls drizzle | grep -E '^010[5-9]'
```

Expected: `0105_parecer_regras.sql` e `0106_app_paciente_g.sql` presentes, nenhuma `0107`. Se o Plano 16 ainda não estiver na `main`, **parar** e avisar o controlador (o número das migrations e a T8 dependem dele).

- [ ] **Step 1: O helper de teste**

Em `test/ia.ts`, acrescentar ao import `iaAutorizacoes, storedFiles` de `@/db/schema` e, no fim do arquivo:

```ts
/**
 * Plano 14A: um evento de autorização gravado pela sessão de paciente SEM conta (canal `link`, como o link do e-mail): o
 * único caminho de teste que a política paciente_autorizacao_propria e o gatilho ia_autorizacoes_regras (0108) aceitam
 * sem conta de login. `registrado_em` e `em` vêm do gatilho. Padrões: autorizou, versão 0.1-provisorio, os três usos,
 * destino `teste` (o dos provedores sandbox/fake).
 */
export async function autorizacaoNoBanco(
  db: Db,
  tenantId: string,
  patientId: string,
  o: { evento?: 'autorizou' | 'retirou'; versao?: string; usos?: string[]; destino?: string; emailHmac?: string } = {},
): Promise<string> {
  const evento = o.evento ?? 'autorizou';
  const autorizou = evento === 'autorizou';
  const [r] = await withTenant(
    { tenantId, role: 'paciente', patientId, semConta: true },
    (tx) =>
      tx
        .insert(iaAutorizacoes)
        .values({
          tenantId, patientId, evento, canal: 'link', emailHmac: o.emailHmac ?? 'hmac-de-teste',
          versao: autorizou ? (o.versao ?? '0.1-provisorio') : null,
          usos: autorizou ? (o.usos ?? ['leitura_laudos', 'resumo_historico', 'rascunho_plano']) : null,
          destino: autorizou ? (o.destino ?? 'teste') : null,
        })
        .returning({ id: iaAutorizacoes.id }),
    db,
  );
  return r.id;
}

/** Plano 14A: a linha de stored_files de um termo em papel (sem arquivo no disco; os testes de banco só precisam da FK). */
export async function termoNoDisco(db: Db, ctx: TenantContext, patientId: string): Promise<string> {
  const caminho = `${ctx.tenantId}/ia_autorizacao_termo/${randomUUID()}.pdf`;
  await withTenant(ctx, (tx) => tx.insert(storedFiles).values({ tenantId: ctx.tenantId, tipo: 'ia_autorizacao_termo', caminho, bytes: 100, mime: 'application/pdf', patientId }), db);
  return caminho;
}
```

- [ ] **Step 2: O teste que falha**

Criar `src/db/ia-autorizacoes.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { autorizacaoNoBanco, tarefaNoBanco, termoNoDisco } from '../../test/ia';
import { ctxPaciente, novoPaciente, novoTenant } from '../../test/pacientes';
import { withTenant, type TenantContext } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const causa = (e: unknown) => ((e as { cause?: unknown }).cause ?? e) as { code?: string; message?: string; constraint?: string };
const negadoPor = (trecho: string) => (e: unknown) => causa(e).code === '42501' && String(causa(e).message).includes(trecho);
const violaRls = (e: unknown) => causa(e).code === '42501' && /row-level security/.test(String(causa(e).message));
const semPermissao = (e: unknown) => causa(e).code === '42501' && /permission denied/.test(String(causa(e).message));
const violaCheck = (nome?: string) => (e: unknown) => causa(e).code === '23514' && (!nome || causa(e).constraint === nome);
const worker = (tenantId: string): TenantContext => ({ tenantId, role: 'worker' });
const semConta = (tenantId: string, patientId: string): TenantContext => ({ tenantId, role: 'paciente', patientId, semConta: true });

async function cenario(o: { bloqueado?: boolean } = {}) {
  const T = await novoTenant(app.db);
  const p = await novoPaciente(app.db, T.ctx, o.bloqueado ? { status: 'bloqueado' } : {});
  const q = (s: SQL, ctx: TenantContext = T.ctx) => withTenant(ctx, (tx) => tx.execute(s), app.db);
  return { T, p, q };
}
const USOS = sql`array['leitura_laudos','resumo_historico','rascunho_plano']::text[]`;

describe('0107/0108: ia_autorizacoes — o gatilho ia_autorizacoes_regras (RN-107)', () => {
  it('registrado_em é do gatilho; fora do papel, em = registrado_em (o em mandado no INSERT é trocado)', async () => {
    const { T, p, q } = await cenario();
    const [r] = (await q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por, em, registrado_em)
      values (${T.tenantId}, ${p.id}, 'retirou', 'nutricionista', ${T.nutriId}, '2020-01-01', '2020-01-01') returning em, registrado_em`)).rows as { em: string; registrado_em: string }[];
    expect(new Date(r.em).getTime()).toBe(new Date(r.registrado_em).getTime());
    expect(new Date(r.registrado_em).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('papel: exige o arquivo; o em é a data informada (até o registro)', async () => {
    const { T, p, q } = await cenario();
    const papel = (arquivo: string | null, em: string) =>
      q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, arquivo_path, em)
        values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'papel', ${T.nutriId}, ${arquivo}, ${em}) returning em`);
    await expect(papel(null, '2026-10-01')).rejects.toSatisfy(negadoPor('termo em papel sem o arquivo'));
    const arq = await termoNoDisco(app.db, T.ctx, p.id);
    await expect(papel(arq, '2999-01-01')).rejects.toSatisfy(violaCheck('ia_autorizacoes_em'));
    const [r] = (await papel(arq, '2026-10-01T03:00:00Z')).rows as { em: string }[];
    expect(new Date(r.em).toISOString()).toBe('2026-10-01T03:00:00.000Z');
  });

  it('coerência canal × papel da sessão: a equipe não grava app/link nem em nome de outra pessoa; o worker não grava', async () => {
    const { T, p, q } = await cenario();
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'app', ${T.nutriId})`)).rejects.toSatisfy(negadoPor('a equipe não registra autorização pelo app nem pelo link'));
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'retirou', 'nutricionista', ${randomUUID()})`)).rejects.toSatisfy(negadoPor('quem registrou é a usuária da sessão'));
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'retirou', 'nutricionista', ${T.nutriId})`, worker(T.tenantId))).rejects.toSatisfy(negadoPor('o worker não registra autorização de IA'));
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'pedido_email', '0.1-provisorio', 'link', ${T.nutriId})`)).rejects.toSatisfy(negadoPor('evento pelo link sem o e-mail'));
    await q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, canal, registrado_por, email_hmac)
      values (${T.tenantId}, ${p.id}, 'pedido_email', '0.1-provisorio', 'link', ${T.nutriId}, 'h')`);
  });

  it('CHECKs de coerência: usos, destino, versão, canal do evento, IP só no digital, HMAC só no link, arquivo só no papel', async () => {
    const { T, p, q } = await cenario();
    const retirada = (extra: SQL) => q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por, versao, ip) values (${T.tenantId}, ${p.id}, 'retirou', 'nutricionista', ${T.nutriId}, ${extra})`);
    await expect(retirada(sql`'0.1-provisorio', null`)).rejects.toSatisfy(violaCheck('ia_autorizacoes_versao'));
    await expect(retirada(sql`null, '203.0.113.9'`)).rejects.toSatisfy(violaCheck('ia_autorizacoes_ip_so_digital'));
    const arq = await termoNoDisco(app.db, T.ctx, p.id);
    const papel = (usos: SQL, destino: string, arquivo = arq) =>
      q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, arquivo_path, em)
        values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${usos}, ${destino}, 'papel', ${T.nutriId}, ${arquivo}, now())`);
    await expect(papel(sql`array['diagnostico']::text[]`, 'teste')).rejects.toSatisfy(violaCheck('ia_autorizacoes_usos'));
    await expect(papel(sql`array[]::text[]`, 'teste')).rejects.toSatisfy(violaCheck('ia_autorizacoes_usos'));
    await expect(papel(USOS, 'gcp-eu')).rejects.toSatisfy(violaCheck('ia_autorizacoes_destino'));
    const exame = `${T.tenantId}/exame/${randomUUID()}.pdf`;
    await q(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id) values (${T.tenantId}, 'exame', ${exame}, 10, 'application/pdf', ${p.id})`);
    await expect(papel(USOS, 'teste', exame)).rejects.toSatisfy(violaCheck('ia_autorizacoes_arquivo_so_papel'));
    // autorizou pelo canal da retirada da nutricionista; retirou em papel; pedido fora do link
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por)
      values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'nutricionista', ${T.nutriId})`)).rejects.toSatisfy(violaCheck());
    await expect(q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, canal, registrado_por, email_hmac)
      values (${T.tenantId}, ${p.id}, 'pedido_email', '0.1-provisorio', 'nutricionista', ${T.nutriId}, 'h')`)).rejects.toSatisfy(violaCheck());
    await papel(USOS, 'teste');
  });
});

describe('0108: a sessão de paciente (RNF-111 d, j)', () => {
  it('sem conta (link): autoriza e retira a própria; nunca pedido_email, nunca para outro paciente', async () => {
    const { T, p } = await cenario();
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    const outro = await novoPaciente(app.db, T.ctx);
    const comoP = (s: SQL) => withTenant(semConta(T.tenantId, p.id), (tx) => tx.execute(s), app.db);
    // com registrado_por preenchido o gatilho deixa passar: quem recusa é a política (evento fora de autorizou/retirou)
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, canal, email_hmac, registrado_por) values (${T.tenantId}, ${p.id}, 'pedido_email', '0.1-provisorio', 'link', 'h', ${randomUUID()})`)).rejects.toSatisfy(violaRls);
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, email_hmac) values (${T.tenantId}, ${outro.id}, 'retirou', 'link', 'h')`)).rejects.toSatisfy(violaRls);
    // sem conta, o canal app não fecha (registrado_por ≠ app_current_user(), que é nulo)
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por) values (${T.tenantId}, ${p.id}, 'retirou', 'app', ${randomUUID()})`)).rejects.toSatisfy(violaRls);
  });

  it('com conta (app): só com a própria conta em registrado_por; o canal link logado e os canais da equipe são recusados', async () => {
    const { T, p } = await cenario();
    const conta = randomUUID();
    const comoP = (s: SQL) => withTenant(ctxPaciente(T.tenantId, p.id, conta), (tx) => tx.execute(s), app.db);
    await comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, ip)
      values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'app', ${conta}, '203.0.113.7')`);
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por) values (${T.tenantId}, ${p.id}, 'retirou', 'app', ${randomUUID()})`)).rejects.toSatisfy(violaRls);
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, email_hmac) values (${T.tenantId}, ${p.id}, 'retirou', 'link', 'h')`)).rejects.toSatisfy(violaRls);
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por) values (${T.tenantId}, ${p.id}, 'retirou', 'nutricionista', ${conta})`)).rejects.toSatisfy(violaRls);
    const arq = await termoNoDisco(app.db, T.ctx, p.id);
    await expect(comoP(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, arquivo_path, em)
      values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'papel', ${conta}, ${arq}, now())`)).rejects.toSatisfy(violaRls);
    // o paciente lê as próprias linhas (não é staff_only)
    expect((await comoP(sql`select evento from ia_autorizacoes`)).rows).toEqual([{ evento: 'autorizou' }]);
  });

  it('o paciente não grava o termo (stored_files ia_autorizacao_termo continua fora da política da 0102)', async () => {
    const { T, p } = await cenario();
    await expect(
      withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime, patient_id)
        values (${T.tenantId}, 'ia_autorizacao_termo', ${`${T.tenantId}/ia_autorizacao_termo/${randomUUID()}.pdf`}, 10, 'application/pdf', ${p.id})`), app.db),
    ).rejects.toSatisfy(violaRls);
  });
});

describe('0108: só inclusão (RNF-110) e as duas funções SECURITY DEFINER', () => {
  it('UPDATE, DELETE e TRUNCATE recusados por permissão, para a equipe e para o paciente', async () => {
    const { T, p, q } = await cenario();
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    await expect(q(sql`update ia_autorizacoes set versao = '9.9' where patient_id = ${p.id}`)).rejects.toSatisfy(semPermissao);
    await expect(q(sql`delete from ia_autorizacoes where patient_id = ${p.id}`)).rejects.toSatisfy(semPermissao);
    await expect(q(sql`truncate ia_autorizacoes`)).rejects.toSatisfy(semPermissao);
    await expect(q(sql`delete from ia_autorizacoes`, worker(T.tenantId))).rejects.toSatisfy(semPermissao);
    await expect(withTenant(semConta(T.tenantId, p.id), (tx) => tx.execute(sql`delete from ia_autorizacoes`), app.db)).rejects.toSatisfy(semPermissao);
  });

  it('app_ia_autorizacao_soltar_termo: só no worker e com o titular bloqueado ou anonimizado', async () => {
    const { T, p, q } = await cenario();
    const b = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    const termoDe = async (patientId: string) => {
      const arq = await termoNoDisco(app.db, T.ctx, patientId);
      const [{ id }] = (await q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, arquivo_path, em)
        values (${T.tenantId}, ${patientId}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'papel', ${T.nutriId}, ${arq}, now()) returning id`)).rows as { id: string }[];
      return id;
    };
    const doAtivo = await termoDe(p.id);
    const doBloqueado = await termoDe(b.id);
    const soltar = (id: string, ctx: TenantContext) => q(sql`select app_ia_autorizacao_soltar_termo(${id}) as ok`, ctx);
    await expect(soltar(doBloqueado, T.ctx)).rejects.toSatisfy(negadoPor('só roda no contexto worker'));
    expect((await soltar(doAtivo, worker(T.tenantId))).rows).toEqual([{ ok: false }]); // paciente ativo: nada muda (o pedido de exclusão é que bloqueia)
    expect((await soltar(doBloqueado, worker(T.tenantId))).rows).toEqual([{ ok: true }]);
    expect((await q(sql`select id, arquivo_path is null as solto from ia_autorizacoes where id in (${doAtivo}, ${doBloqueado}) order by solto`)).rows).toEqual([
      { id: doAtivo, solto: false },
      { id: doBloqueado, solto: true },
    ]);
  });

  it('app_anonimizar_autorizacoes_ia: só no worker, paciente bloqueado à espera; tira IP, user-agent, HMAC e a conta só do canal app', async () => {
    const { T, p, q } = await cenario();
    const b = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    const conta = randomUUID();
    await withTenant(ctxPaciente(T.tenantId, b.id, conta), (tx) => tx.execute(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, ip, user_agent)
      values (${T.tenantId}, ${b.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'teste', 'app', ${conta}, '203.0.113.7', 'Mozilla/5.0')`), app.db);
    await autorizacaoNoBanco(app.db, T.tenantId, b.id, { evento: 'retirou', emailHmac: 'h-link' });
    await q(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por) values (${T.tenantId}, ${b.id}, 'retirou', 'nutricionista', ${T.nutriId})`);
    const anonimizar = (patientId: string, ctx: TenantContext) => q(sql`select app_anonimizar_autorizacoes_ia(${patientId})`, ctx);
    await expect(anonimizar(b.id, T.ctx)).rejects.toSatisfy(negadoPor('só roda no contexto worker'));
    await expect(anonimizar(p.id, worker(T.tenantId))).rejects.toSatisfy(negadoPor('não está bloqueado'));
    await anonimizar(b.id, worker(T.tenantId));
    const linhas = (await q(sql`select canal, registrado_por, ip, user_agent, email_hmac from ia_autorizacoes where patient_id = ${b.id} order by canal`)).rows;
    expect(linhas).toEqual([
      { canal: 'app', registrado_por: null, ip: null, user_agent: null, email_hmac: null },
      { canal: 'link', registrado_por: null, ip: null, user_agent: null, email_hmac: null },
      { canal: 'nutricionista', registrado_por: T.nutriId, ip: null, user_agent: null, email_hmac: null },
    ]);
  });
});

describe('0107/0108: ia_tarefas.destino (RN-109)', () => {
  it('só com saiu_em, só da lista; depois de gravado, não muda', async () => {
    const { T, p, q } = await cenario();
    await expect(tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'falhou', erro: 'interrompida', destino: 'teste' })).rejects.toSatisfy(violaCheck('ia_tarefas_destino_valido'));
    await expect(tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'falhou', erro: 'interrompida', saiuEm: new Date(), destino: 'gcp-eu' })).rejects.toSatisfy(violaCheck('ia_tarefas_destino_valido'));
    const id = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'falhou', erro: 'interrompida', saiuEm: new Date(), destino: 'teste' });
    await expect(q(sql`update ia_tarefas set destino = 'bedrock-eu' where id = ${id}`)).rejects.toSatisfy(negadoPor('o destino da saída ao provedor não muda'));
    await expect(q(sql`update ia_tarefas set destino = null where id = ${id}`)).rejects.toSatisfy(negadoPor('o destino da saída ao provedor não muda'));
  });
});
```

Run: `pnpm vitest run src/db/ia-autorizacoes.test.ts`
Expected: FAIL (a tabela `ia_autorizacoes` e a coluna `ia_tarefas.destino` não existem).

- [ ] **Step 3: O schema e a migration gerada**

Em `src/db/schema/platform.ts`, no CHECK `stored_files_tipo_valido`, acrescentar `'ia_autorizacao_termo'` ao fim da lista:

```ts
      sql`${t.tipo} in ('logo','capa','exame','plano_pdf','diario_foto','diario_foto_original','orientacao_pdf','exportacao','documento_base','documento_assinado','documento_digitalizado','exame_original','exame_pagina','ia_autorizacao_termo')`,
```

Em `src/modules/plataforma/armazenamento.ts`, o tipo e a lista dos tipos com dono:

```ts
export type TipoDeArquivo =
  | 'logo' | 'capa' | 'exame' | 'plano_pdf' | 'diario_foto' | 'diario_foto_original' | 'orientacao_pdf' | 'exportacao'
  | 'documento_base' | 'documento_assinado' | 'documento_digitalizado' | 'exame_original' | 'exame_pagina' | 'ia_autorizacao_termo';

/** D4: arquivos com dono (paciente). O resto é do consultório. Plano 12: o original e as páginas do exame enviado. Plano 14A: o termo de autorização de IA em papel. */
export const TIPOS_DO_PACIENTE: readonly TipoDeArquivo[] = [
  'exame', 'plano_pdf', 'diario_foto', 'diario_foto_original', 'exportacao', 'documento_base', 'documento_assinado', 'documento_digitalizado',
  'exame_original', 'exame_pagina', 'ia_autorizacao_termo',
];
```

Em `src/db/schema/ia.ts`: no import do `drizzle-orm/pg-core` nada muda (já tem `check`, `foreignKey`, `index`, `text`, `timestamp`, `uuid`); acrescentar `import { storedFiles, tenants } from './platform';` (no lugar do import só de `tenants`). Em `iaTarefas`, depois de `saiuEm`:

```ts
    /** Plano 14A (RN-109): o código do destino gravado no portão do envio, junto da primeira saída; nunca muda (0108). */
    destino: text('destino'),
```

e, na lista de restrições de `iaTarefas`, depois de `ia_tarefas_reserva_valida`:

```ts
    check('ia_tarefas_destino_valido', sql`${t.destino} is null or (${t.destino} in ('anthropic-us', 'bedrock-eu', 'teste') and ${t.saiuEm} is not null)`),
```

No fim do arquivo:

```ts
/**
 * Plano 14A (spec da IA v0.5.1 §11, RN-107): a autorização (consentimento, LGPD art. 33, VIII) do paciente para o uso de
 * IA — um EVENTO por linha (`autorizou`, `retirou`, `pedido_email`), só inclusão: UPDATE/DELETE/TRUNCATE revogados de
 * nutri_app_role (0108); os dados de identificação e o ponteiro do termo só saem pelas funções SECURITY DEFINER da 0108,
 * no contexto worker. `registrado_em` e, fora do papel, `em` vêm do gatilho ia_autorizacoes_regras (clock_timestamp). Sem
 * o gatilho de auditoria (AUDIT_EXCEPTIONS): a própria linha é a prova, como `consents`. "Papel exige arquivo" e "quem
 * registrou" ficam no gatilho de INSERT, não em CHECK: um CHECK valeria também no UPDATE da anonimização.
 */
export const iaAutorizacoes = pgTable(
  'ia_autorizacoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    evento: text('evento').notNull(),
    /** Versão do texto (AUTORIZACAO_IA_VERSAO); nula só em `retirou`. */
    versao: text('versao'),
    /** Só em `autorizou`: lista fechada (USOS_IA). */
    usos: text('usos').array(),
    /** Só em `autorizou`: código estável do destino (RN-109). */
    destino: text('destino'),
    canal: text('canal').notNull(),
    /** O ato (no papel, a data da assinatura informada; nos outros canais, o gatilho grava = registrado_em). */
    em: timestamp('em', { withTimezone: true }).notNull().defaultNow(),
    registradoEm: timestamp('registrado_em', { withTimezone: true }).notNull().defaultNow(),
    /** Quem registrou: a conta do paciente (app), a nutricionista (papel, nutricionista, pedido_email); nulo no link. Sem FK (como audit_log.actor_user_id). */
    registradoPor: uuid('registrado_por'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    /** HMAC do e-mail para onde o link foi (nunca o e-mail em claro). */
    emailHmac: text('email_hmac'),
    /** Só no papel: a foto ou o PDF do termo assinado (FK NO ACTION, regra 9). */
    arquivoPath: text('arquivo_path').references(() => storedFiles.caminho),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'ia_autorizacoes_paciente_fk' }),
    check('ia_autorizacoes_evento_valido', sql`${t.evento} in ('autorizou', 'retirou', 'pedido_email')`),
    check('ia_autorizacoes_canal_valido', sql`${t.canal} in ('app', 'link', 'papel', 'nutricionista')`),
    check('ia_autorizacoes_versao', sql`(${t.evento} = 'retirou') = (${t.versao} is null) and (${t.versao} is null or char_length(${t.versao}) between 1 and 40)`),
    check(
      'ia_autorizacoes_usos',
      sql`(${t.evento} = 'autorizou') = (${t.usos} is not null) and (${t.usos} is null or (cardinality(${t.usos}) > 0 and ${t.usos} <@ array['leitura_laudos', 'resumo_historico', 'rascunho_plano']::text[]))`,
    ),
    check('ia_autorizacoes_destino', sql`(${t.evento} = 'autorizou') = (${t.destino} is not null) and (${t.destino} is null or ${t.destino} in ('anthropic-us', 'bedrock-eu', 'teste'))`),
    check(
      'ia_autorizacoes_canal_do_evento',
      sql`(${t.evento} <> 'pedido_email' or ${t.canal} = 'link') and (${t.evento} <> 'retirou' or ${t.canal} <> 'papel') and (${t.evento} <> 'autorizou' or ${t.canal} <> 'nutricionista')`,
    ),
    check('ia_autorizacoes_em', sql`${t.em} <= ${t.registradoEm}`),
    check('ia_autorizacoes_link_sem_conta', sql`not (${t.canal} = 'link' and ${t.evento} <> 'pedido_email') or ${t.registradoPor} is null`),
    check(
      'ia_autorizacoes_ip_so_digital',
      sql`(${t.ip} is null and ${t.userAgent} is null) or (${t.canal} in ('app', 'link') and ${t.evento} <> 'pedido_email')`,
    ),
    check('ia_autorizacoes_tamanhos', sql`(${t.ip} is null or char_length(${t.ip}) <= 45) and (${t.userAgent} is null or char_length(${t.userAgent}) <= 300) and (${t.emailHmac} is null or char_length(${t.emailHmac}) <= 64)`),
    check('ia_autorizacoes_hmac_so_link', sql`${t.emailHmac} is null or ${t.canal} = 'link'`),
    check(
      'ia_autorizacoes_arquivo_so_papel',
      sql`${t.arquivoPath} is null or (${t.canal} = 'papel' and ${t.evento} = 'autorizou' and ${t.arquivoPath} like ${t.tenantId}::text || '/ia_autorizacao_termo/%')`,
    ),
    index('ia_autorizacoes_paciente_idx').on(t.tenantId, t.patientId, t.registradoEm),
  ],
);

export type IaAutorizacaoRow = typeof iaAutorizacoes.$inferSelect;
```

Gerar a migration:

```bash
pnpm db:generate --name ia_autorizacoes
```

Expected: `drizzle/0107_ia_autorizacoes.sql` com `CREATE TABLE "ia_autorizacoes"`, a FK composta, a FK de `arquivo_path` (sem `ON DELETE`, isto é, `NO ACTION`), os doze CHECKs, o índice, `ALTER TABLE "ia_tarefas" ADD COLUMN "destino" text` + `ia_tarefas_destino_valido`, e o `stored_files_tipo_valido` recriado com o tipo novo. Abrir o arquivo e conferir que **não** há nada além disso (se o drizzle-kit propuser mexer em outra tabela, o schema está fora de sincronia com o Plano 16: parar e conferir o rebase).

- [ ] **Step 4: A migration custom**

```bash
pnpm drizzle-kit generate --custom --name rls_ia_autorizacoes
```

Conteúdo de `drizzle/0108_rls_ia_autorizacoes.sql`:

```sql
-- Plano 14A (spec da IA v0.5.1 §11, RN-107, RNF-102, RNF-110, RNF-111). CLAUDE.md regras 2 e 8.
SELECT app_enable_tenant_rls('ia_autorizacoes');
--> statement-breakpoint
SELECT app_enable_patient_rls('ia_autorizacoes');
--> statement-breakpoint
-- RNF-102: sem staff_only (o paciente lê as próprias linhas, na tela "Eu › Privacidade"). A escrita do paciente é só INSERT
-- da PRÓPRIA autorização ou retirada: no app, com a própria conta; no link (paciente sem conta, N7), sem conta nenhuma.
-- Nunca o pedido por e-mail nem os canais da equipe (RNF-111 d); em = registrado_em (j; o gatilho já grava assim).
SELECT app_allow_paciente_escrita('ia_autorizacoes', 'insert');
--> statement-breakpoint
CREATE POLICY paciente_autorizacao_propria ON ia_autorizacoes AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR (
    evento IN ('autorizou', 'retirou') AND em = registrado_em AND (
      (canal = 'app' AND registrado_por IS NOT NULL AND registrado_por = app_current_user())
      OR (canal = 'link' AND registrado_por IS NULL AND app_current_user() IS NULL))));
--> statement-breakpoint
-- RNF-110 / §5.11 item 8 (revisão de banco da v0.5, I1): prova só de inclusão; nenhum papel do app tem UPDATE legítimo.
REVOKE UPDATE, DELETE, TRUNCATE ON ia_autorizacoes FROM nutri_app_role;
--> statement-breakpoint
-- RN-107 (I2, I5) e defesa a mais (desvio 4 do plano): registrado_em pelo relógio do banco DEPOIS da trava do paciente;
-- fora do papel, o ato é o registro; papel exige o arquivo; quem registrou é obrigatório onde há sessão de login; o link
-- exige o HMAC do e-mail na autorização e no pedido; a sessão nutri só grava papel, nutricionista e pedido_email, em nome
-- da própria usuária; o worker não grava evento. A sessão de paciente fica com a política acima (recusa = erro de RLS).
-- No contexto vazio (migration, seed) só valem as regras de dado. Recusa com 42501, como a RLS.
CREATE OR REPLACE FUNCTION app_ia_autorizacoes_regras() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  r text := coalesce(app_current_role(), '');
BEGIN
  NEW.registrado_em := clock_timestamp();
  IF NEW.canal <> 'papel' THEN
    NEW.em := NEW.registrado_em;
  END IF;
  IF r = 'worker' THEN
    RAISE EXCEPTION 'o worker não registra autorização de IA' USING ERRCODE = '42501';
  END IF;
  IF r = 'nutri' THEN
    IF NOT (NEW.canal IN ('papel', 'nutricionista') OR NEW.evento = 'pedido_email') THEN
      RAISE EXCEPTION 'a equipe não registra autorização pelo app nem pelo link' USING ERRCODE = '42501';
    END IF;
    IF NEW.registrado_por IS DISTINCT FROM app_current_user() THEN
      RAISE EXCEPTION 'quem registrou é a usuária da sessão' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NEW.canal = 'papel' AND NEW.arquivo_path IS NULL THEN
    RAISE EXCEPTION 'termo em papel sem o arquivo' USING ERRCODE = '42501';
  END IF;
  IF (NEW.canal IN ('app', 'papel', 'nutricionista') OR NEW.evento = 'pedido_email') AND NEW.registrado_por IS NULL THEN
    RAISE EXCEPTION 'autorização de IA sem quem registrou' USING ERRCODE = '42501';
  END IF;
  IF NEW.canal = 'link' AND NEW.evento IN ('autorizou', 'pedido_email') AND NEW.email_hmac IS NULL THEN
    RAISE EXCEPTION 'evento pelo link sem o e-mail (HMAC)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ia_autorizacoes_regras BEFORE INSERT ON ia_autorizacoes FOR EACH ROW EXECUTE FUNCTION app_ia_autorizacoes_regras();
--> statement-breakpoint
-- US-113 / I4: o ponteiro do termo em papel sai no naMesmaTransacao do apagarArquivo do termo (lgpd.ts,
-- apagarTermosDeAutorizacao), só no contexto worker e com o titular bloqueado ou anonimizado (molde do
-- exam_submissions_sem_apagar, 0102). Devolve se anulou. SECURITY DEFINER: o UPDATE foi revogado de nutri_app_role.
CREATE OR REPLACE FUNCTION app_ia_autorizacao_soltar_termo(p_autorizacao uuid) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
BEGIN
  IF v_tenant IS NULL OR app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_ia_autorizacao_soltar_termo() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ia_autorizacoes a SET arquivo_path = NULL
   WHERE a.id = p_autorizacao AND a.tenant_id = v_tenant AND a.arquivo_path IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.patients p
                  WHERE p.tenant_id = a.tenant_id AND p.id = a.patient_id AND (p.status = 'bloqueado' OR p.anonimizado_em IS NOT NULL));
  RETURN FOUND;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_ia_autorizacao_soltar_termo(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_ia_autorizacao_soltar_termo(uuid) TO nutri_app_role;
--> statement-breakpoint
-- US-113 / I3: na anonimização (lgpd.ts, ao lado da app_anonimizar_aceites e com a mesma condição da 0065: worker, paciente
-- do tenant bloqueado à espera, anonimizado_em nulo), as linhas ficam sem IP, user-agent e HMAC do e-mail e, SÓ no canal
-- app, sem a conta do titular; evento, versão, usos, destino, canal e datas ficam (prova de que houve consentimento).
CREATE OR REPLACE FUNCTION app_anonimizar_autorizacoes_ia(p_patient uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid := app_current_tenant();
BEGIN
  IF v_tenant IS NULL OR app_current_role() IS DISTINCT FROM 'worker' THEN
    RAISE EXCEPTION 'app_anonimizar_autorizacoes_ia() só roda no contexto worker de um tenant' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.patients p
    WHERE p.id = p_patient AND p.tenant_id = v_tenant AND p.status = 'bloqueado' AND p.anonimizado_em IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_anonimizar_autorizacoes_ia(): o paciente não está bloqueado à espera da anonimização neste tenant' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ia_autorizacoes
     SET ip = NULL, user_agent = NULL, email_hmac = NULL,
         registrado_por = CASE WHEN canal = 'app' THEN NULL ELSE registrado_por END
   WHERE tenant_id = v_tenant AND patient_id = p_patient
     AND (ip IS NOT NULL OR user_agent IS NOT NULL OR email_hmac IS NOT NULL OR (canal = 'app' AND registrado_por IS NOT NULL));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_anonimizar_autorizacoes_ia(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_anonimizar_autorizacoes_ia(uuid) TO nutri_app_role;
--> statement-breakpoint
-- RN-109: app_ia_tarefas_imutavel (0100) + o destino: depois de gravado no portão do envio, não muda nem volta a nulo
-- (é o que a exportação do titular mostra). O resto é o da 0100, linha a linha.
CREATE OR REPLACE FUNCTION app_ia_tarefas_imutavel() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.tenant_id, NEW.patient_id, NEW.tipo, NEW.pedido_por, NEW.modelo, NEW.prompt_versao, NEW.criado_em)
     IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.patient_id, OLD.tipo, OLD.pedido_por, OLD.modelo, OLD.prompt_versao, OLD.criado_em) THEN
    RAISE EXCEPTION 'coluna fixa da tarefa de IA' USING ERRCODE = '42501';
  END IF;
  IF NEW.exam_id IS NOT NULL AND NEW.exam_id IS DISTINCT FROM OLD.exam_id THEN
    RAISE EXCEPTION 'a tarefa de IA não muda de exame' USING ERRCODE = '42501';
  END IF;
  IF OLD.saiu_em IS NOT NULL AND NEW.saiu_em IS DISTINCT FROM OLD.saiu_em THEN
    RAISE EXCEPTION 'a saída do laudo ao provedor não é apagada nem reescrita' USING ERRCODE = '42501';
  END IF;
  IF OLD.destino IS NOT NULL AND NEW.destino IS DISTINCT FROM OLD.destino THEN
    RAISE EXCEPTION 'o destino da saída ao provedor não muda' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
```

(O `CREATE TRIGGER ia_tarefas_imutavel` da 0100 continua apontando para a função; o `CREATE OR REPLACE` basta.)

- [ ] **Step 5: As guardas do CI e o isolamento**

Em `src/db/rls-guard.ts`, em `PACIENTE_ESCREVE`, depois de `exam_submission_files`:

```ts
  ia_autorizacoes: { comandos: ['insert'], motivo: 'Plano 14A (RN-107, US-106, US-107, US-109): o paciente autoriza ou retira a própria autorização de IA no app (canal app, com a própria conta) ou pelo link do e-mail (canal link, sem conta) — política paciente_autorizacao_propria (0108); UPDATE, DELETE e TRUNCATE revogados' },
```

Em `src/db/audit-guard.ts`, em `AUDIT_EXCEPTIONS`, depois de `document_access_codes`:

```ts
  ia_autorizacoes:
    'Plano 14A (RN-107, §11): consentimento do titular para a transferência à IA (LGPD art. 33, VIII), não é dado de saúde; prova só de inclusão (UPDATE e DELETE revogados) com quem registrou, quando, canal, IP e user-agent na própria linha, como consents; a abertura do termo em papel chama auditRead (entidade ia_autorizacao)',
```

Em `test/isolamento.test.ts`:

1. Em `FABRICAS`, depois de `ia_uso`:

```ts
  // Plano 14A (desvio 1 do plano): as fábricas rodam como nutri, e o gatilho ia_autorizacoes_regras só deixa a equipe gravar
  // papel, nutricionista e pedido_email, em nome da própria usuária — a retirada pela nutricionista não precisa de linha-mãe
  // (o paciente já existe), então a recusa dos testes negativos vem da política da própria tabela (fora de COM_MAE).
  // `coalesce`: nos contextos sem usuário (publico, conta) o gatilho deixa passar e a RLS recusa.
  ia_autorizacoes: (t, p) =>
    sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por) values (${t}, ${p}, 'retirou', 'nutricionista', coalesce(app_current_user(), gen_random_uuid()))`,
```

2. `SO_INSERE`:

```ts
const SO_INSERE = new Set(['audit_log', 'signed_document_receipts', 'ia_autorizacoes']);
```

3. Em `SO_APAGA.patients`, acrescentar a linha (FK composta `ia_autorizacoes_paciente_fk`, `NO ACTION`: o paciente com autorização não sai, como o com recibo):

```ts
                and not exists (select 1 from ia_autorizacoes a where a.tenant_id = patients.tenant_id and a.patient_id = patients.id)
```

Em `CLAUDE.md`, regra 2, no fim do parágrafo (depois da frase do Plano 12):

```markdown
Plano 14A: `ia_autorizacoes` (autorização do paciente para a IA, RN-107) — o paciente só **insere** a própria autorização ou retirada (`app_allow_paciente_escrita('ia_autorizacoes', 'insert')` + política RESTRICTIVE `paciente_autorizacao_propria`: canal `app` com a própria conta, canal `link` sem conta, `em = registrado_em`) e `REVOKE UPDATE, DELETE, TRUNCATE` de `nutri_app_role`; o gatilho de INSERT `ia_autorizacoes_regras` grava `registrado_em` (`clock_timestamp()`) e só deixa a sessão `nutri` gravar `papel`, `nutricionista` e `pedido_email` em nome da própria usuária; os campos só são anulados por `app_ia_autorizacao_soltar_termo` e `app_anonimizar_autorizacoes_ia` (SECURITY DEFINER, contexto `worker`); sem `staff_only`; no teste de isolamento, `FABRICAS` (canal `nutricionista`), `SO_INSERE` e o filtro em `SO_APAGA.patients`. `ia_tarefas.destino` (código do destino da primeira saída, RN-109) não muda depois de gravado (`ia_tarefas_imutavel`).
```

E, na regra 8, depois de "como `access_events` e `push_subscriptions`;":

```markdown
no Plano 14A, `ia_autorizacoes` (consentimento do titular, prova só de inclusão com quem, quando, canal, IP e user-agent na própria linha, como `consents`), com `auditRead` (entidade `ia_autorizacao`, "Autorização de IA") ao abrir o termo em papel;
```

- [ ] **Step 6: Migrations e testes**

Run: `pnpm vitest run src/db/ia-autorizacoes.test.ts src/db/rls-guard.test.ts src/db/audit-guard.test.ts test/isolamento.test.ts src/db/ia-schema.test.ts`
Expected: PASS. (O Testcontainers aplica `0107` e `0108` com o role migrator, regra 7. Se o isolamento acusar "toda tabela com tenant_id tem fábrica", a fábrica não entrou; se `patients` de B não apagar nenhuma linha, o filtro de `SO_APAGA` não casou: o paciente `SEM_DOCUMENTO` não tem autorização, então deve casar.)

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema/ia.ts src/db/schema/platform.ts drizzle/0107_ia_autorizacoes.sql drizzle/0108_rls_ia_autorizacoes.sql drizzle/meta \
  src/db/ia-autorizacoes.test.ts src/db/rls-guard.ts src/db/audit-guard.ts test/isolamento.test.ts test/ia.ts \
  src/modules/plataforma/armazenamento.ts CLAUDE.md
git commit -m "feat(ia): ia_autorizacoes só de inclusão, política do paciente, gatilho de INSERT, funções da anonimização e ia_tarefas.destino (P14A-01)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 2: Configuração e textos — usos, destinos, texto da autorização `0.1-provisorio`, aditivo `0.2-provisorio`, `IA_RETENCAO_ZERO`, variáveis do Bedrock e D22 pela autorização (P14A-02)

**Revisão: completa (agente normas-cfn-lgpd)** — textos jurídicos (autorização com as variantes de destino e de canal, aditivo), retenção zero como condição, variáveis de ambiente que mudam o provedor; lente de segurança para `src/env.ts`.

**Files:**
- Modify: `src/modules/ia/constantes.ts`, `src/modules/ia/textos-legais.ts`, `src/modules/ia/textos-legais.test.ts`, `src/modules/ia/modo.ts`, `src/modules/ia/modo.test.ts`, `src/env.ts`, `src/env.test.ts`, `.env.example`, `src/modules/plataforma/contas.ts`, `src/app/admin/page.tsx`, `src/app/painel/configuracoes/ia-secao.tsx`, `test/ia.ts` (`iaPronta` com o aditivo atual, `IA_TESTE`), `src/modules/ia/tarefas.test.ts`, `src/modules/ia/leitura-job.test.ts`, `src/modules/ia/logs.test.ts` (o `ConfigIA` de teste)
- Create: `src/components/texto-legal.tsx`

**Interfaces:**
- Consumes: `versaoAtende`, `estadoIaDoTenant`, `usdParaMicro`, `emProducao` (existentes).
- Produces: o que está em "Contratos entre tarefas" para `constantes.ts`, `textos-legais.ts`, `modo.ts` e `texto-legal.tsx`. `ConfigIA.geo` continua `GeoIA` nesta tarefa (a T3 o troca por `RegiaoIA`). `WorkerEnv` ganha `IA_RETENCAO_ZERO`, `IA_BEDROCK_REGIAO`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; `Env` (app) ganha `IA_RETENCAO_ZERO`, `IA_BEDROCK_REGIAO`.

- [ ] **Step 1: Os testes que falham — textos legais**

Em `src/modules/ia/textos-legais.test.ts`, trocar o import e acrescentar os casos (os três `it` existentes continuam):

```ts
import { describe, expect, it } from 'vitest';
import {
  aditivoIa, AUTORIZACAO_IA_VERSAO, AUTORIZACAO_IA_VERSAO_MIN, AVISO_IA_VERSAO, AVISO_IA_VERSAO_MIN, avisoDaVersao, IA_ADITIVO_TERMO,
  IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_MIN, responsavelDoTenant, textoCorrido, textoDaAutorizacao, versaoAtende,
} from './textos-legais';

const RESP = { consultorio: 'Consultório Debby', nutricionista: 'Debora Silva', crn: 'CRN-3 12345', contato: 'contato@debby.test' };
const corrido = (d: Parameters<typeof textoDaAutorizacao>[1]) => textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, d)!.paragrafos.map(textoCorrido);

describe('Plano 14A — texto da autorização 0.1-provisorio (spec §7, A-D24, RN-109)', () => {
  it('anthropic-us, canal app: o texto da spec, palavra por palavra (com "Os seus dados saem do Brasil.", desvio 6)', () => {
    const t = textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...RESP, destino: 'anthropic-us', canal: 'app' })!;
    expect(t.titulo).toBe('Autorização para uso de inteligência artificial');
    expect(t.paragrafos.map(textoCorrido)).toEqual([
      'Consultório Debby pede a sua autorização para usar uma ferramenta de inteligência artificial (IA) com os seus dados de saúde. Esta autorização é só para isso. Ela é separada do termo de uso do app.',
      'Quem é responsável. A responsável pelos seus dados é a sua nutricionista, Debora Silva (CRN-3 12345), contato: contato@debby.test. A plataforma NutriDebby (WEB SMART SISTEMAS+13 LTDA) trata os dados em nome dela e contrata o fornecedor da IA.',
      'Para que serve. A IA ajuda a sua nutricionista em três tarefas: (1) ler os laudos dos seus exames e sugerir os valores para o seu prontuário; (2) resumir o seu histórico antes da consulta; (3) montar um primeiro rascunho do seu plano alimentar, que ela revisa. A IA só sugere. A nutricionista confere tudo antes de usar e continua responsável pelo seu atendimento. A IA não faz diagnóstico, não interpreta os seus exames, não receita e não fala com você. Benefício: menos tempo digitando e preparando, mais tempo de consulta. Riscos: a IA pode errar (por isso a nutricionista confere tudo) e os seus dados saem do Brasil (veja abaixo).',
      'O que é enviado. Na leitura de laudos, o laudo inteiro, com o seu nome, a sua data de nascimento e tudo o que estiver impresso nele; só os dados escondidos do arquivo, como autor e localização, são retirados. No resumo e no rascunho, as informações do seu prontuário necessárias para a tarefa (medidas, exames, anamnese, orientações, plano, diário e, se a nutricionista escolher, as anotações dela), sem o seu nome, e-mail, telefone, endereço e documentos, com a sua idade no lugar da data de nascimento.',
      'Para onde vai. Os dados são enviados à Anthropic, empresa que fornece a IA (Claude), contratada pela plataforma NutriDebby. O processamento acontece nos Estados Unidos, um país que não tem decisão de adequação da Autoridade Nacional de Proteção de Dados (ANPD). Os seus dados saem do Brasil.',
      'Por quanto tempo. O fornecedor usa os dados só para devolver a resposta, não os usa para treinar a IA e não os guarda depois da resposta. A exceção é quando a lei exigir ou quando os sistemas de segurança dele sinalizarem o conteúdo; nesse caso, ele pode guardá-lo por até 2 anos. A sugestão da IA fica guardada no NutriDebby por até 7 dias, até a nutricionista usar ou descartar. O que ela usar passa a fazer parte do seu prontuário. Cada envio fica registrado e aparece na cópia dos seus dados, que você pode pedir no app (Baixar meus dados) ou à sua nutricionista.',
      'Você decide. Autorizar é opcional. Se você não autorizar, ou se retirar a autorização depois, nada muda no seu atendimento: a nutricionista faz essas tarefas sem a IA. Você pode retirar a autorização quando quiser, sem custo, no app (Eu › Privacidade), pelo link do e-mail de confirmação ou pedindo à sua nutricionista. A partir da retirada, nenhum dado seu é enviado à IA; o que já está no prontuário continua lá.',
      'Seus direitos. Você pode pedir à sua nutricionista acesso, correção, cópia e informações sobre o uso dos seus dados, e a eliminação do que não for obrigatório guardar (Lei nº 13.709/2018, art. 18). Se achar que os seus dados foram mal usados, pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).',
      'Registro. A sua autorização fica registrada com a data, a versão deste texto e o canal (app, link do e-mail ou termo assinado), e, no app e no link, com o endereço IP. Se o texto mudar, se surgir um uso novo, se mudar o que é enviado ou se o destino mudar, pediremos uma nova autorização.',
      'Ao tocar em "Autorizo o envio para fora do Brasil" (ou ao assinar este termo, se recebê-lo impresso), você autoriza o envio dos seus dados para fora do Brasil, ao destino acima, só para essas três tarefas.',
      'Versão provisória 0.1, em revisão jurídica.',
    ]);
  });

  it('bedrock-eu: muda só "Para onde vai" e "Por quanto tempo" (sem a exceção de 2 anos)', () => {
    const eu = corrido({ ...RESP, destino: 'bedrock-eu', canal: 'app' });
    const us = corrido({ ...RESP, destino: 'anthropic-us', canal: 'app' });
    expect(eu[4]).toBe(
      'Para onde vai. Os dados são enviados à Amazon Web Services, que opera a IA Claude, contratada pela plataforma NutriDebby. O processamento acontece na União Europeia, reconhecida pela Autoridade Nacional de Proteção de Dados (ANPD) como de proteção adequada. A Amazon Web Services é uma empresa dos Estados Unidos. Os seus dados saem do Brasil.',
    );
    expect(eu[5]).not.toContain('2 anos');
    expect(eu.filter((p, i) => p !== us[i]).length).toBe(2);
  });

  it('a forma de retirar muda só no trecho do canal (as quatro variantes da spec)', () => {
    const voceDecide = (canal: 'app' | 'link' | 'papel_com_email' | 'papel_sem_email') => corrido({ ...RESP, destino: 'anthropic-us', canal })[6];
    expect(voceDecide('link')).toContain('sem custo, pelo link "Retirar a autorização" do e-mail de confirmação, no app (Eu › Privacidade), se você usar o app, ou pedindo à sua nutricionista.');
    expect(voceDecide('papel_com_email')).toContain('sem custo, pelo link "Retirar a autorização" do e-mail de confirmação que você vai receber, no app (Eu › Privacidade), se você usar o app, ou pedindo à sua nutricionista.');
    expect(voceDecide('papel_sem_email')).toContain('sem custo, pedindo à sua nutricionista, pessoalmente ou pelo contato acima, ou no app (Eu › Privacidade), se você usar o app.');
  });

  it('com o endereço do aviso de privacidade, "Seus direitos" termina com ele; sem, a frase não aparece', () => {
    expect(corrido({ ...RESP, destino: 'anthropic-us', canal: 'app', avisoPrivacidadeUrl: 'https://x.dev/privacidade' })[7]).toMatch(/Mais detalhes no aviso de privacidade: https:\/\/x\.dev\/privacidade\.$/);
    expect(corrido({ ...RESP, destino: 'anthropic-us', canal: 'app' })[7]).not.toContain('Mais detalhes');
  });

  it('em destaque (art. 33, VIII): o país, o "saem do Brasil" e o "nada muda" vão em negrito', () => {
    const t = textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...RESP, destino: 'anthropic-us', canal: 'app' })!;
    const fortes = t.paragrafos.flatMap((p) => p.filter((x) => x.forte).map((x) => x.texto));
    for (const f of ['nos Estados Unidos', 'saem do Brasil', 'Se você não autorizar, ou se retirar a autorização depois, nada muda no seu atendimento:', 'Para onde vai.', 'Benefício:', 'Riscos:']) expect(fortes).toContain(f);
  });

  it('destino de teste (dev/CI/E2E) e versão desconhecida', () => {
    expect(corrido({ ...RESP, destino: 'teste', canal: 'app' })[4]).toBe('Para onde vai. Ambiente de teste: os dados não são enviados a nenhum fornecedor de IA.');
    expect(textoDaAutorizacao('9.9', { ...RESP, destino: 'teste', canal: 'app' })).toBeNull();
    expect(versaoAtende(AUTORIZACAO_IA_VERSAO, AUTORIZACAO_IA_VERSAO_MIN)).toBe(true);
  });

  it('responsavelDoTenant: sem nome profissional, CRN ou e-mail de contato → null (desvio 7)', () => {
    const t = { nomeExibicao: 'Consultório Debby', nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' };
    expect(responsavelDoTenant(t)).toEqual(RESP);
    for (const falta of ['nomeProfissional', 'crn', 'contatoEmail'] as const) expect(responsavelDoTenant({ ...t, [falta]: null }), falta).toBeNull();
  });
});

describe('Plano 14A — aditivo 0.2-provisorio (US-101, C1)', () => {
  it('a versão sobe para 0.2 (a 0.1-provisorio não pediria aceite novo) e quem aceitou a 0.1 fica desatualizado', () => {
    expect(IA_ADITIVO_VERSAO).toBe('0.2-provisorio');
    expect(versaoAtende(IA_ADITIVO_VERSAO, IA_ADITIVO_VERSAO_MIN)).toBe(true);
    expect(versaoAtende('0.1-provisorio', IA_ADITIVO_VERSAO_MIN)).toBe(false);
    expect(IA_ADITIVO_TERMO).toBe('ia-aditivo-0.2-provisorio');
  });

  it('o suboperador e o país seguem o destino; a exceção de 2 anos só na Anthropic; os usos novos e o dever de colher a autorização', () => {
    const us = aditivoIa('anthropic-us').paragrafos.map(textoCorrido);
    const eu = aditivoIa('bedrock-eu').paragrafos.map(textoCorrido);
    expect(us[2]).toBe('3. Suboperador e país. Anthropic (Claude), com processamento nos Estados Unidos. A operadora responde pelo suboperador perante a controladora, nos termos do DPA.');
    expect(eu[2]).toBe('3. Suboperador e país. Amazon Web Services (Claude), com processamento na União Europeia. A operadora responde pelo suboperador perante a controladora, nos termos do DPA.');
    expect(us[5]).toContain('salvo exigência legal ou conteúdo sinalizado pelos sistemas de segurança dele, que pode ser guardado por até 2 anos');
    expect(eu[5]).not.toContain('2 anos');
    expect(us[1]).toContain('(d) sugerir modelos de plano alimentar e de anamnese por área de atendimento');
    expect(us[6]).toContain('(a) obter a autorização dele pela plataforma');
    expect(us.at(-1)).toBe('Versão provisória 0.2, em revisão jurídica. Quando a versão definitiva for publicada, um novo aceite será pedido.');
    expect(us).toHaveLength(11);
  });
});
```

E em `src/modules/ia/modo.test.ts`, trocar o `tenant` e acrescentar:

```ts
import { IA_ADITIVO_VERSAO } from './textos-legais';
// …
const tenant = { status: 'ativa', iaLiberada: true, iaAtivadaEm: new Date(), iaAditivoVersao: IA_ADITIVO_VERSAO };

describe('Plano 14A — destino, retenção zero e estado com dado de paciente (RN-100, RN-109, A-D4)', () => {
  it('o destino vem do IA_PROVEDOR (inclusive na emergência); a retenção zero só com IA_RETENCAO_ZERO=1', () => {
    expect(configIA(base)).toMatchObject({ destino: null, retencaoZero: false });
    expect(configIA({ ...base, IA_PROVEDOR: 'anthropic' })).toMatchObject({ modo: 'anthropic', destino: 'anthropic-us' });
    expect(configIA({ ...base, IA_PROVEDOR: 'bedrock-eu', IA_DESLIGADA: '1' })).toMatchObject({ modo: 'emergencia', destino: 'bedrock-eu' });
    expect(configIA({ ...base, IA_PROVEDOR: 'sandbox', IA_RETENCAO_ZERO: '1' })).toMatchObject({ modo: 'sandbox', destino: 'teste', retencaoZero: true });
    expect(configIA({ ...base, IA_PROVEDOR: 'fake', IA_RETENCAO_ZERO: '0' }).retencaoZero).toBe(false);
  });

  it('estadoIaComPaciente: o do consultório e, por cima, sem retenção zero = sem_retencao; o aditivo 0.1 não vale mais', () => {
    expect(estadoIaComPaciente(tenant, { modo: 'fake', retencaoZero: true })).toBe('ativa');
    expect(estadoIaComPaciente(tenant, { modo: 'fake', retencaoZero: false })).toBe('sem_retencao');
    expect(estadoIaComPaciente({ ...tenant, iaLiberada: false }, { modo: 'fake', retencaoZero: false })).toBe('nao_liberada');
    expect(estadoIaDoTenant({ ...tenant, iaAditivoVersao: '0.1-provisorio' }, 'bedrock-eu')).toBe('aditivo_desatualizado');
  });
});
```

(e `estadoIaComPaciente` no import de `./modo`).

Run: `pnpm vitest run src/modules/ia/textos-legais.test.ts src/modules/ia/modo.test.ts`
Expected: FAIL (`textoDaAutorizacao`, `aditivoIa`, `estadoIaComPaciente` não existem; o aditivo ainda é 0.1).

- [ ] **Step 2: Constantes**

Em `src/modules/ia/constantes.ts`, depois de `EM_ANDAMENTO`:

```ts
/** Plano 14A (RN-107, A-D24): os usos que a autorização lista (congelados no texto, RV-2). */
export const USOS_IA = ['leitura_laudos', 'resumo_historico', 'rascunho_plano'] as const;
export type UsoIA = (typeof USOS_IA)[number];
/** O uso que cada tipo de tarefa pede na RN-100 (a 14B acrescenta resumo e rascunho). */
export const USO_DA_TAREFA: Record<TipoTarefa, UsoIA> = { leitura_exame: 'leitura_laudos' };

/** Plano 14A (RN-109): o destino em código estável (o banco guarda o código; telas, textos e exportação, o rótulo). */
export const DESTINOS_IA = ['anthropic-us', 'bedrock-eu', 'teste'] as const;
export type DestinoIA = (typeof DESTINOS_IA)[number];
export const DESTINO_ROTULO: Record<DestinoIA, string> = {
  'anthropic-us': 'Anthropic (Claude), Estados Unidos',
  'bedrock-eu': 'Amazon Web Services (Claude), União Europeia',
  teste: 'Provedor de teste',
};
/** US-113: a tarefa antiga com `saiu_em` e sem `destino` saiu pelo único provedor do Plano 11. */
export const ROTULO_DESTINO_LEGADO = DESTINO_ROTULO['anthropic-us'];
/** IA_PROVEDOR (spec §12). `sandbox` e `fake` têm o destino de teste (RNF-107): autorização dada com eles não vale em outro. */
export const PROVEDORES_IA = ['anthropic', 'bedrock-eu', 'sandbox', 'fake'] as const;
export type ProvedorConfigurado = (typeof PROVEDORES_IA)[number];
export const DESTINO_DO_PROVEDOR: Record<ProvedorConfigurado, DestinoIA> = { anthropic: 'anthropic-us', 'bedrock-eu': 'bedrock-eu', sandbox: 'teste', fake: 'teste' };
/** INT-08 / D3: modelos do perfil `eu.` liberados (o Haiku 5.5 só entra com avaliação). */
export const MODELOS_BEDROCK_EU: readonly ModeloIA[] = ['claude-sonnet-5-5'];
/** INT-08: regiões da UE para o cliente do Bedrock (Londres, eu-west-2, e Zurique, eu-central-2, não são UE). */
export const REGIOES_BEDROCK_EU = ['eu-central-1', 'eu-west-1', 'eu-west-3', 'eu-north-1', 'eu-south-1', 'eu-south-2'] as const;
export type RegiaoBedrock = (typeof REGIOES_BEDROCK_EU)[number];

/** RN-107: eventos e canais da autorização. */
export const EVENTOS_AUTORIZACAO = ['autorizou', 'retirou', 'pedido_email'] as const;
export type EventoAutorizacao = (typeof EVENTOS_AUTORIZACAO)[number];
export const CANAIS_AUTORIZACAO = ['app', 'link', 'papel', 'nutricionista'] as const;
export type CanalAutorizacao = (typeof CANAIS_AUTORIZACAO)[number];
/** US-105: como o canal aparece na tela. */
export const CANAL_ROTULO: Record<CanalAutorizacao, string> = { app: 'app', link: 'link por e-mail', papel: 'termo em papel', nutricionista: 'a pedido, pela nutricionista' };
/** US-107: o link do pedido vale 7 dias; US-105: o alerta de e-mail trocado olha os pedidos dos 30 dias anteriores. */
export const VALIDADE_PEDIDO_MS = 7 * 86_400_000;
export const JANELA_EMAIL_TROCADO_MS = 30 * 86_400_000;
/** US-108: a foto ou o PDF do termo assinado, até 20 MB (como o laudo, EXAME_MAX_BYTES). */
export const TERMO_MAX_BYTES = 20 * 1024 * 1024;
```

Em `MOTIVOS_FALHA`, acrescentar `'sem_autorizacao'` ao fim da lista. Em `MSG_IA`, depois de `recusou`:

```ts
  // Plano 14A (US-105, US-110): os botões de IA do paciente sem autorização vigente
  semAutorizacao: 'Antes de usar a IA, peça a autorização do paciente (Privacidade > Uso de IA).',
  retirouAutorizacao: 'Este paciente retirou a autorização para o uso de IA.',
```

Em `MSG_FALHA`, trocar `paciente_indisponivel` e acrescentar `sem_autorizacao` (o `paciente_nao_informado` fica, só para exibir linhas antigas — RN-112):

```ts
  paciente_nao_informado: MSG_IA.semCiencia,
  // RN-112 (Plano 14A): o texto novo (a recusa virou a retirada da autorização) e o motivo novo
  paciente_indisponivel: 'Este paciente não pode usar a IA agora (bloqueado, arquivado ou anonimizado).',
  sem_autorizacao: 'A autorização do paciente para o uso de IA não está em vigor.',
```

No fim do arquivo, os textos da US-105 a US-109 (texto exato da spec; os novos marcados, desvio 9):

```ts
/** Plano 14A (US-105 a US-109): textos da autorização no painel, no app e no link (texto exato da spec v0.5.1). */
export const MSG_AUTORIZACAO = {
  // US-105 (painel, aba Privacidade, seção "Uso de IA")
  naoAutorizou: 'Ainda não autorizou.',
  explicacao: 'A IA só pode ser usada com os dados deste paciente depois que ele autorizar. Recusar não muda nada no atendimento.',
  enviarPedido: 'Enviar pedido de autorização por e-mail',
  registrarPapel: 'Registrar termo em papel',
  verTexto: 'Ver o texto da autorização',
  dicaApp: 'O paciente também pode autorizar no app, em Eu › Privacidade.',
  autorizou: (data: string, canal: string, versao: string) => `Autorizou em ${data} (${canal}, versão ${versao}).`,
  verTermo: 'Ver termo assinado',
  registrarRetirada: 'Registrar retirada a pedido do paciente',
  retirou: (data: string) => `Retirou em ${data}.`,
  registros: 'Registros',
  registroAutorizou: (data: string, canal: string, versao: string) => `${data} — Autorizou (${canal}, versão ${versao})`,
  registroRetirou: (data: string, canal: string) => `${data} — Retirou (${canal})`,
  registroPedido: (data: string) => `${data} — Pedido enviado por e-mail`,
  versaoAntiga: (versao: string) => `Autorizou a versão ${versao}, que não vale mais. Peça uma nova autorização.`,
  destinoTrocado: (destino: string) => `Autorizou o envio para ${destino}. O destino mudou: peça uma nova autorização.`,
  pedidoEnviado: 'Pedido enviado. O link vale por 7 dias.',
  semEmail: 'Cadastre o e-mail do paciente para enviar o pedido.',
  pedidoAberto: (data: string) => `Já há um pedido por e-mail válido até ${data}. Aguarde a resposta do paciente ou registre o termo em papel.`,
  emailTrocado: 'Atenção: o e-mail do paciente mudou pouco antes desta autorização. Confirme com ele que foi ele quem autorizou.',
  confirmarRetiradaNutri: 'Registrar que o paciente retirou a autorização? A IA deixa de ser usada com os dados dele na hora.',
  /** Desvio 7 (texto novo): o texto da autorização cita o nome, o CRN e o contato da nutricionista. */
  perfilIncompleto: 'Complete seu perfil profissional (nome completo, CRN e e-mail de contato) em Configurações antes de pedir a autorização de IA.',
  // US-108 (termo em papel)
  imprimir: 'Imprimir termo',
  dataAssinatura: 'Data da assinatura',
  arquivoTermo: 'Foto ou PDF do termo assinado',
  codigoReferencia: (codigo: string) => `Código de referência: ${codigo}`,
  confirmacaoPapel: (versao: string) => `Confirmo que o paciente assinou este termo, na versão ${versao}, e que o arquivo mostra a assinatura.`,
  salvar: 'Salvar',
  termoRegistrado: 'Termo registrado. Entregue ao paciente uma via do termo assinado.',
  faltouArquivo: 'Envie a foto ou o PDF do termo assinado.',
  faltouConfirmacao: 'Confirme que o paciente assinou o termo.',
  dataInvalida: 'Informe a data em que o paciente assinou o termo.',
  /** Desvio 9 (texto novo): arquivo fora do formato ou do tamanho. */
  arquivoInvalido: 'Envie um arquivo JPEG, PNG ou PDF de até 20 MB.',
  nomePaciente: (nome: string) => `Nome do paciente: ${nome}`,
  campoData: 'Data: ____/____/______',
  campoAssinatura: 'Assinatura do paciente: ______________________',
  // US-106 (app, Eu › Privacidade e /p/perfil/ia)
  blocoTitulo: 'Uso de inteligência artificial (IA)',
  voceNaoAutorizou: 'Você ainda não autorizou.',
  lerEDecidir: 'Ler e decidir',
  autorizo: 'Autorizo o envio para fora do Brasil',
  agoraNao: 'Agora não',
  registradaApp: 'Autorização registrada. Você pode retirar quando quiser.',
  voceAutorizou: (data: string, versao: string) => `Você autorizou em ${data} (versão ${versao}).`,
  retirarAutorizacao: 'Retirar autorização',
  tudoBem: 'Tudo bem. Nada muda no seu atendimento.',
  textoMudou: 'O texto da autorização mudou. Leia e decida de novo.',
  // US-107 (link do e-mail)
  emailAssunto: (consultorio: string) => `${consultorio}: autorização para uso de inteligência artificial`,
  registradaLink: 'Autorização registrada. Você pode retirar quando quiser, pelo link do e-mail de confirmação, pelo app ou pedindo à sua nutricionista.',
  confirmacaoAssunto: 'Você autorizou o uso de inteligência artificial',
  retirarALink: 'Retirar a autorização',
  jaAutorizou: (data: string) => `Você já autorizou em ${data}.`,
  linkExpirado: 'Este link expirou. Peça um novo à sua nutricionista.',
  linkInvalido: 'Este link não é mais válido. Fale com sua nutricionista.',
  robo: 'Confirme que você não é um robô.',
  muitasTentativas: 'Muitas tentativas. Tente de novo em alguns minutos.',
  turnstileFora: 'Tente novamente em alguns minutos',
  // US-109 (retirada)
  confirmarRetirada: 'Retirar a autorização? A partir de agora, nenhum dado seu será enviado à IA. Isso não muda nada no seu atendimento.',
  retirada: 'Autorização retirada.',
  voceRetirou: (data: string) => `Você retirou a autorização em ${data}.`,
  naoVigente: 'Esta autorização já não está em vigor.',
} as const;
```

(`MSG_IA.retirou`, de nome parecido, é o texto da recusa do Plano 11 e sai na T10; o da retirada é `MSG_IA.retirouAutorizacao`.)

- [ ] **Step 3: Textos legais**

`src/modules/ia/textos-legais.ts` passa a ser (o aviso do Plano 11 fica até a T10, marcado como legado):

```ts
import type { TenantRow } from '@/db/schema';
import type { DestinoIA } from './constantes';

/**
 * Plano 11 (A-D20) e Plano 14A (A-D23 a A-D25, RN-107, RN-109): os textos legais da IA, PROVISÓRIOS até o advogado (E-09).
 * O interruptor da admin (tenants.ia_liberada, D22) impede o uso real antes da versão final. Versão final: nova entrada
 * aqui e o *_MIN sobe (quem aceitou ou autorizou a provisória volta a "aceite a versão atual" / "não vale mais").
 * Qualquer mudança no que sai para a IA também sobe AUTORIZACAO_IA_VERSAO_MIN (RN-109, RV-2).
 */
/** Legado (RN-128): o aviso de ciência do Plano 11 — sai na T10 do Plano 14A. */
export const AVISO_IA_VERSAO = '0.1-provisorio';
export const AVISO_IA_VERSAO_MIN = '0.1-provisorio';
/** C1 / US-101: 0.2 — a 0.1-provisorio não serviria (versaoAtende só olha a parte numérica). */
export const IA_ADITIVO_VERSAO = '0.2-provisorio';
export const IA_ADITIVO_VERSAO_MIN = '0.2-provisorio';
export const IA_ADITIVO_TERMO = `ia-aditivo-${IA_ADITIVO_VERSAO}`;
export const AUTORIZACAO_IA_VERSAO = '0.1-provisorio';
export const AUTORIZACAO_IA_VERSAO_MIN = '0.1-provisorio';
/** US-108 "Data inválida": o termo em papel não pode ser de antes do início desta versão. */
export const AUTORIZACAO_IA_VERSAO_DATA = '2026-10-09';

/** Um trecho de parágrafo; `forte` = em destaque (art. 33, VIII: "em destaque"). */
export type Trecho = { texto: string; forte?: true };
export type Paragrafo = readonly Trecho[];
export type TextoLegal = { titulo: string; paragrafos: readonly Paragrafo[] };
export const textoCorrido = (p: Paragrafo): string => p.map((t) => t.texto).join('');
const n = (texto: string): Trecho => ({ texto });
const b = (texto: string): Trecho => ({ texto, forte: true });

type TextoAviso = { titulo: string; paragrafos: readonly string[] };
const AVISOS_IA: Record<string, TextoAviso> = {
  // (o conteúdo atual de AVISOS_IA['0.1-provisorio'] fica igual, palavra por palavra)
};
export function avisoDaVersao(versao: string): TextoAviso {
  return AVISOS_IA[versao] ?? AVISOS_IA[AVISO_IA_VERSAO];
}

/** Desvio 7: o texto cita a responsável; sem nome profissional, CRN ou e-mail de contato, não há como pedir. */
export type Responsavel = { consultorio: string; nutricionista: string; crn: string; contato: string };
export function responsavelDoTenant(t: Pick<TenantRow, 'nomeExibicao' | 'nomeProfissional' | 'crn' | 'contatoEmail'>): Responsavel | null {
  if (!t.nomeProfissional || !t.crn || !t.contatoEmail) return null;
  return { consultorio: t.nomeExibicao, nutricionista: t.nomeProfissional, crn: t.crn, contato: t.contatoEmail };
}

/** O trecho "{forma de retirar do canal}" (spec, tabela depois do texto): nem todo paciente tem app ou e-mail. */
export type CanalDoTexto = 'app' | 'link' | 'papel_com_email' | 'papel_sem_email';
const FORMA_DE_RETIRAR: Record<CanalDoTexto, string> = {
  app: 'no app (Eu › Privacidade), pelo link do e-mail de confirmação ou pedindo à sua nutricionista',
  link: 'pelo link "Retirar a autorização" do e-mail de confirmação, no app (Eu › Privacidade), se você usar o app, ou pedindo à sua nutricionista',
  papel_com_email: 'pelo link "Retirar a autorização" do e-mail de confirmação que você vai receber, no app (Eu › Privacidade), se você usar o app, ou pedindo à sua nutricionista',
  papel_sem_email: 'pedindo à sua nutricionista, pessoalmente ou pelo contato acima, ou no app (Eu › Privacidade), se você usar o app',
};
/** RN-109: só a variante do provedor em uso (desvio 6: "Os seus dados saem do Brasil."; o destino de teste, nunca em produção). */
const PARA_ONDE_VAI: Record<DestinoIA, Paragrafo> = {
  'anthropic-us': [
    b('Para onde vai.'),
    n(' Os dados são enviados à Anthropic, empresa que fornece a IA (Claude), contratada pela plataforma NutriDebby. O processamento acontece '),
    b('nos Estados Unidos'),
    n(', um país que não tem decisão de adequação da Autoridade Nacional de Proteção de Dados (ANPD). Os seus dados '),
    b('saem do Brasil'),
    n('.'),
  ],
  'bedrock-eu': [
    b('Para onde vai.'),
    n(' Os dados são enviados à Amazon Web Services, que opera a IA Claude, contratada pela plataforma NutriDebby. O processamento acontece '),
    b('na União Europeia'),
    n(', reconhecida pela Autoridade Nacional de Proteção de Dados (ANPD) como de proteção adequada. A Amazon Web Services é uma empresa dos Estados Unidos. Os seus dados '),
    b('saem do Brasil'),
    n('.'),
  ],
  teste: [b('Para onde vai.'), n(' Ambiente de teste: os dados não são enviados a nenhum fornecedor de IA.')],
};
const EXCECAO_DE_RETENCAO: Partial<Record<DestinoIA, string>> = {
  'anthropic-us': ' A exceção é quando a lei exigir ou quando os sistemas de segurança dele sinalizarem o conteúdo; nesse caso, ele pode guardá-lo por até 2 anos.',
};

type DadosDoTexto = Responsavel & { destino: DestinoIA; canal: CanalDoTexto; avisoPrivacidadeUrl?: string | null };
const AUTORIZACOES_IA: Record<string, (d: DadosDoTexto) => TextoLegal> = {
  '0.1-provisorio': (d) => ({
    titulo: 'Autorização para uso de inteligência artificial',
    paragrafos: [
      [n(`${d.consultorio} pede a sua autorização para usar uma ferramenta de inteligência artificial (IA) com os seus dados de saúde. Esta autorização é só para isso. Ela é separada do termo de uso do app.`)],
      [
        b('Quem é responsável.'),
        n(` A responsável pelos seus dados é a sua nutricionista, ${d.nutricionista} (${d.crn}), contato: ${d.contato}. A plataforma NutriDebby (WEB SMART SISTEMAS+13 LTDA) trata os dados em nome dela e contrata o fornecedor da IA.`),
      ],
      [
        b('Para que serve.'),
        n(' A IA ajuda a sua nutricionista em três tarefas: (1) ler os laudos dos seus exames e sugerir os valores para o seu prontuário; (2) resumir o seu histórico antes da consulta; (3) montar um primeiro rascunho do seu plano alimentar, que ela revisa. A IA só sugere. A nutricionista confere tudo antes de usar e continua responsável pelo seu atendimento. A IA não faz diagnóstico, não interpreta os seus exames, não receita e não fala com você. '),
        b('Benefício:'),
        n(' menos tempo digitando e preparando, mais tempo de consulta. '),
        b('Riscos:'),
        n(' a IA pode errar (por isso a nutricionista confere tudo) e os seus dados saem do Brasil (veja abaixo).'),
      ],
      [
        b('O que é enviado.'),
        n(' Na leitura de laudos, o laudo inteiro, com o seu nome, a sua data de nascimento e tudo o que estiver impresso nele; só os dados escondidos do arquivo, como autor e localização, são retirados. No resumo e no rascunho, as informações do seu prontuário necessárias para a tarefa (medidas, exames, anamnese, orientações, plano, diário e, se a nutricionista escolher, as anotações dela), sem o seu nome, e-mail, telefone, endereço e documentos, com a sua idade no lugar da data de nascimento.'),
      ],
      PARA_ONDE_VAI[d.destino],
      [
        b('Por quanto tempo.'),
        n(` O fornecedor usa os dados só para devolver a resposta, não os usa para treinar a IA e não os guarda depois da resposta.${EXCECAO_DE_RETENCAO[d.destino] ?? ''} A sugestão da IA fica guardada no NutriDebby por até 7 dias, até a nutricionista usar ou descartar. O que ela usar passa a fazer parte do seu prontuário. Cada envio fica registrado e aparece na cópia dos seus dados, que você pode pedir no app (Baixar meus dados) ou à sua nutricionista.`),
      ],
      [
        b('Você decide.'),
        n(' Autorizar é opcional. '),
        b('Se você não autorizar, ou se retirar a autorização depois, nada muda no seu atendimento:'),
        n(` a nutricionista faz essas tarefas sem a IA. Você pode retirar a autorização quando quiser, sem custo, ${FORMA_DE_RETIRAR[d.canal]}. A partir da retirada, nenhum dado seu é enviado à IA; o que já está no prontuário continua lá.`),
      ],
      [
        b('Seus direitos.'),
        n(` Você pode pedir à sua nutricionista acesso, correção, cópia e informações sobre o uso dos seus dados, e a eliminação do que não for obrigatório guardar (Lei nº 13.709/2018, art. 18). Se achar que os seus dados foram mal usados, pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).${d.avisoPrivacidadeUrl ? ` Mais detalhes no aviso de privacidade: ${d.avisoPrivacidadeUrl}.` : ''}`),
      ],
      [
        b('Registro.'),
        n(' A sua autorização fica registrada com a data, a versão deste texto e o canal (app, link do e-mail ou termo assinado), e, no app e no link, com o endereço IP. Se o texto mudar, se surgir um uso novo, se mudar o que é enviado ou se o destino mudar, pediremos uma nova autorização.'),
      ],
      [n('Ao tocar em "Autorizo o envio para fora do Brasil" (ou ao assinar este termo, se recebê-lo impresso), você autoriza o envio dos seus dados para fora do Brasil, ao destino acima, só para essas três tarefas.')],
      [n('Versão provisória 0.1, em revisão jurídica.')],
    ],
  }),
};

/** O texto da versão pedida, com o destino em uso e a forma de retirar do canal; versão que não existe → null. */
export function textoDaAutorizacao(versao: string, d: DadosDoTexto): TextoLegal | null {
  return AUTORIZACOES_IA[versao]?.(d) ?? null;
}

const SUBOPERADOR: Record<DestinoIA, string> = {
  'anthropic-us': 'Anthropic (Claude), com processamento nos Estados Unidos.',
  'bedrock-eu': 'Amazon Web Services (Claude), com processamento na União Europeia.',
  teste: 'Provedor de teste, sem envio de dados a fornecedor.',
};

/** US-101 (Plano 14A): o aditivo 0.2-provisorio, com o parágrafo do suboperador e a retenção conforme o destino (RN-109). */
export function aditivoIa(destino: DestinoIA): TextoLegal {
  const excecao = destino === 'anthropic-us' ? ', salvo exigência legal ou conteúdo sinalizado pelos sistemas de segurança dele, que pode ser guardado por até 2 anos,' : '';
  return {
    titulo: 'Aditivo de inteligência artificial',
    paragrafos: [
      '1. Este aditivo complementa o contrato de tratamento de dados (DPA) entre a nutricionista titular da conta (controladora) e a WEB SMART SISTEMAS+13 LTDA (operadora), para o uso de inteligência artificial (IA) no consultório. Vale a partir do aceite e enquanto a IA estiver ativada.',
      '2. Finalidades. Com dados de paciente: (a) ler o laudo de exame que a controladora escolher e sugerir os valores para o prontuário; (b) resumir o histórico do paciente antes da consulta; (c) montar um rascunho de plano alimentar a partir das metas que a controladora informa. Sem dados de paciente: (d) sugerir modelos de plano alimentar e de anamnese por área de atendimento. A IA não diagnostica, não interpreta exames, não prescreve e não fala com o paciente. Nada entra no prontuário nem chega ao paciente sem a conferência e a ação da controladora, que responde pela conduta profissional.',
      `3. Suboperador e país. ${SUBOPERADOR[destino]} A operadora responde pelo suboperador perante a controladora, nos termos do DPA.`,
      '4. Transferência internacional. Os dados de paciente só vão à IA com a autorização específica e em destaque de cada paciente (LGPD, art. 33, VIII), registrada na plataforma com a versão, os usos, o destino, a data e o canal.',
      '5. O que é enviado. Na leitura, só o arquivo do laudo, sem metadados; os dados impressos nele vão junto. No resumo e no rascunho, os dados do prontuário necessários à tarefa, sem nome, e-mail, telefone, endereço e documentos do paciente, com idade em vez da data de nascimento e com os textos livres mascarados. Nos modelos, nenhum dado de paciente.',
      `6. Retenção. A plataforma só usa a IA com dados de paciente enquanto houver retenção zero com o fornecedor: o fornecedor não guarda o conteúdo depois da resposta${excecao} e não o usa para treinar modelos. A sugestão fica guardada na plataforma por até 7 dias, até ser salva ou descartada. O registro técnico do uso (data, situação e custo, sem conteúdo) é mantido.`,
      '7. Deveres da controladora. Antes de usar a IA com os dados de um paciente: (a) obter a autorização dele pela plataforma (no app, pelo link enviado por e-mail ou pelo termo impresso, assinado e guardado na plataforma com a foto); (b) não pressionar: recusar ou retirar não muda nada no atendimento; (c) registrar a retirada quando o paciente pedir; (d) conferir cada sugestão antes de usá-la.',
      '8. Bloqueios automáticos. A plataforma não envia à IA dados de paciente sem autorização vigente, de paciente bloqueado ou anonimizado, nem quando o limite mensal de custo do consultório foi atingido.',
      '9. Registro. Cada pedido, cada envio de dados ao fornecedor e cada abertura da sugestão aparecem no histórico de acessos do paciente. O paciente que pedir os seus dados recebe as autorizações, a data de cada envio e o nome e o país do fornecedor.',
      '10. Desativação e limite. A controladora pode desativar a IA a qualquer momento. A operadora pode suspendê-la por motivo de segurança, mudança do fornecedor ou de norma, avisando a controladora. O uso tem um limite mensal de custo por consultório, informado no painel.',
      'Versão provisória 0.2, em revisão jurídica. Quando a versão definitiva for publicada, um novo aceite será pedido.',
    ].map((t) => [n(t)]),
  };
}

/** Compara só a parte numérica (`1.10` > `1.9`); qualquer coisa fora do formato não atende. */
export function versaoAtende(versao: string | null, minima: string): boolean {
  // (corpo atual, sem mudança)
}
```

(`IA_ADITIVO_TITULO` e `IA_ADITIVO_PARAGRAFOS` saem: o único uso é a `ia-secao.tsx`, trocada no Step 6.)

- [ ] **Step 4: Modo, configuração e o componente do texto**

`src/modules/ia/modo.ts`:

```ts
import type { TenantRow } from '@/db/schema';
import { DESTINO_DO_PROVEDOR, MODELOS_IA, usdParaMicro, type DestinoIA, type GeoIA, type ModeloIA, type ProvedorConfigurado } from './constantes';
import { IA_ADITIVO_VERSAO_MIN, versaoAtende } from './textos-legais';

export { MODELOS_IA };

/** `ausente` = sem IA_PROVEDOR (nada aparece); `emergencia` = IA_DESLIGADA=1 (aparece "indisponível"). */
export type ModoIA = 'ausente' | 'emergencia' | ProvedorConfigurado;
/**
 * `destino` (RN-109): o do provedor configurado, mesmo na emergência (a tela de autorização compara com ele); nulo sem
 * IA_PROVEDOR. `retencaoZero` (A-D4, Plano 14A): sem ela, nenhum uso com dado de paciente (RN-100).
 */
export type ConfigIA = { modo: ModoIA; destino: DestinoIA | null; modelo: ModeloIA; geo: GeoIA; tetoGlobalMicroUsd: number; retencaoZero: boolean };
export type AmbienteIA = {
  IA_PROVEDOR?: ProvedorConfigurado;
  IA_DESLIGADA?: '0' | '1';
  IA_RETENCAO_ZERO?: '0' | '1';
  IA_MODELO_LEITURA: ModeloIA;
  IA_INFERENCE_GEO: GeoIA;
  IA_TETO_GLOBAL_MENSAL_USD: number;
};

export function configIA(e: AmbienteIA): ConfigIA {
  const modo: ModoIA = !e.IA_PROVEDOR ? 'ausente' : e.IA_DESLIGADA === '1' ? 'emergencia' : e.IA_PROVEDOR;
  return {
    modo,
    destino: e.IA_PROVEDOR ? DESTINO_DO_PROVEDOR[e.IA_PROVEDOR] : null,
    modelo: e.IA_MODELO_LEITURA,
    geo: e.IA_INFERENCE_GEO,
    tetoGlobalMicroUsd: usdParaMicro(e.IA_TETO_GLOBAL_MENSAL_USD),
    retencaoZero: e.IA_RETENCAO_ZERO === '1',
  };
}

export type EstadoIaTenant = 'ausente' | 'emergencia' | 'suspensa' | 'nao_liberada' | 'nao_ativada' | 'aditivo_desatualizado' | 'sem_retencao' | 'ativa';

/** RN-100 (parte do consultório), na ordem em que a tela explica: plataforma → conta → admin → nutricionista → aditivo. */
export function estadoIaDoTenant(t: Pick<TenantRow, 'status' | 'iaLiberada' | 'iaAtivadaEm' | 'iaAditivoVersao'>, modo: ModoIA): EstadoIaTenant {
  if (modo === 'ausente') return 'ausente';
  if (modo === 'emergencia') return 'emergencia';
  if (t.status !== 'ativa') return 'suspensa';
  if (!t.iaLiberada) return 'nao_liberada';
  if (!t.iaAtivadaEm) return 'nao_ativada';
  if (!versaoAtende(t.iaAditivoVersao, IA_ADITIVO_VERSAO_MIN)) return 'aditivo_desatualizado';
  return 'ativa';
}

/**
 * Plano 14A (RN-100, A-D4, D9): o estado para usar a IA COM dado de paciente — o do consultório e, por cima, a retenção
 * zero da plataforma. Configurações, pedidos de autorização e retiradas usam `estadoIaDoTenant` (não dependem dela).
 */
export function estadoIaComPaciente(t: Pick<TenantRow, 'status' | 'iaLiberada' | 'iaAtivadaEm' | 'iaAditivoVersao'>, ia: Pick<ConfigIA, 'modo' | 'retencaoZero'>): EstadoIaTenant {
  const e = estadoIaDoTenant(t, ia.modo);
  return e === 'ativa' && !ia.retencaoZero ? 'sem_retencao' : e;
}
```

Criar `src/components/texto-legal.tsx` (componente de servidor, sem estado; o painel, o portal, o link e a impressão usam):

```tsx
import type { TextoLegal } from '@/modules/ia/textos-legais';

/**
 * Plano 14A: um texto legal com os trechos em destaque (art. 33, VIII: "em destaque") como <strong>. Texto puro, sem
 * HTML vindo de fora. `classeTitulo`: a fonte do título muda entre o painel (font-titulo) e o portal (font-portal-titulo).
 */
export function TextoLegalView({ texto, id, nivel = 'h2', classeTitulo = 'font-titulo text-lg font-semibold' }: { texto: TextoLegal; id: string; nivel?: 'h1' | 'h2' | 'h3'; classeTitulo?: string }) {
  const Titulo = nivel;
  return (
    <article aria-labelledby={id} className="space-y-3">
      <Titulo id={id} className={classeTitulo}>
        {texto.titulo}
      </Titulo>
      {texto.paragrafos.map((p, i) => (
        <p key={i}>{p.map((t, j) => (t.forte ? <strong key={j}>{t.texto}</strong> : <span key={j}>{t.texto}</span>))}</p>
      ))}
    </article>
  );
}
```

- [ ] **Step 5: Os testes que falham — ambiente**

Em `src/env.test.ts`, depois do `describe` do Plano 11:

```ts
describe('Plano 14A — bedrock-eu, retenção zero e variáveis que o SDK leria sozinho (spec §12, INT-08, RNF-103)', () => {
  const w = { NODE_ENV: 'development', DATABASE_URL, APP_URL: 'http://localhost:3000', ENCRYPTION_KEY: KEY, DATA_DIR: './data', EMAIL_FROM: 'NutriDebby <x@y.dev>', MAILPIT_URL: 'http://localhost:8025' };
  const prodWorker = { ...w, NODE_ENV: 'production', APP_URL: 'https://nutri.exemplo.com', EMAIL_TRANSPORT: 'mailpit' };
  const bedrock = { IA_PROVEDOR: 'bedrock-eu', IA_BEDROCK_REGIAO: 'eu-central-1', IA_MODELO_LEITURA: 'claude-sonnet-5-5' };
  const AK = 'AKIA' + 'A'.repeat(16);
  const SK = 'x'.repeat(40);

  it('IA_RETENCAO_ZERO: 0 ou 1, ausente por padrão, no app e no worker', () => {
    expect(parseEnv(base).IA_RETENCAO_ZERO).toBeUndefined();
    expect(parseEnv({ ...base, IA_RETENCAO_ZERO: '1' }).IA_RETENCAO_ZERO).toBe('1');
    expect(parseWorkerEnv({ ...w, IA_RETENCAO_ZERO: '0' }).IA_RETENCAO_ZERO).toBe('0');
    expect(() => parseEnv({ ...base, IA_RETENCAO_ZERO: 'sim' })).toThrow(/IA_RETENCAO_ZERO/);
  });

  it('bedrock-eu exige uma região da UE e o modelo da lista do perfil eu. (D3); Londres e Zurique não são UE', () => {
    expect(() => parseEnv({ ...base, IA_PROVEDOR: 'bedrock-eu', IA_MODELO_LEITURA: 'claude-sonnet-5-5' })).toThrow(/IA_BEDROCK_REGIAO/);
    expect(() => parseEnv({ ...base, IA_PROVEDOR: 'bedrock-eu', IA_BEDROCK_REGIAO: 'eu-central-1' })).toThrow(/IA_MODELO_LEITURA/); // o padrão é o Opus, fora do perfil eu.
    for (const r of ['eu-west-2', 'eu-central-2', 'us-east-1']) expect(() => parseEnv({ ...base, ...bedrock, IA_BEDROCK_REGIAO: r }), r).toThrow(/IA_BEDROCK_REGIAO/);
    expect(parseEnv({ ...base, ...bedrock })).toMatchObject(bedrock);
    expect(parseWorkerEnv({ ...w, ...bedrock, AWS_ACCESS_KEY_ID: AK, AWS_SECRET_ACCESS_KEY: SK })).toMatchObject({ ...bedrock, AWS_ACCESS_KEY_ID: AK });
  });

  it('em produção, IA_INFERENCE_GEO=us só é exigida com a anthropic (C5)', () => {
    expect(parseWorkerEnv({ ...prodWorker, ...bedrock, IA_INFERENCE_GEO: 'global' }).IA_PROVEDOR).toBe('bedrock-eu');
    expect(() => parseWorkerEnv({ ...prodWorker, IA_PROVEDOR: 'anthropic', IA_INFERENCE_GEO: 'global' })).toThrow(/IA_INFERENCE_GEO/);
  });

  it('as chaves da AWS: só no worker, juntas e no formato; a mensagem nunca repete o valor', () => {
    expect(parseEnv({ ...base, AWS_ACCESS_KEY_ID: AK, AWS_SECRET_ACCESS_KEY: SK })).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(() => parseWorkerEnv({ ...w, AWS_ACCESS_KEY_ID: AK })).toThrow(/AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY juntas/);
    const errada = 'ASIA' + 'B'.repeat(16); // credencial temporária (precisaria de token de sessão): recusada
    let msg = '';
    try {
      parseWorkerEnv({ ...w, AWS_ACCESS_KEY_ID: errada, AWS_SECRET_ACCESS_KEY: SK });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/AWS_ACCESS_KEY_ID/);
    expect(msg).not.toContain(errada);
  });

  it('D2: o worker não sobe com as variáveis que o SDK leria sozinho (o token de portador venceria as chaves)', () => {
    for (const nome of ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']) {
      expect(() => parseWorkerEnv({ ...w, [nome]: 'qualquer-coisa' }), nome).toThrow(new RegExp(nome));
      expect(parseWorkerEnv({ ...w, [nome]: '' }), nome).toBeDefined(); // vazio = não definida
    }
  });
});
```

Run: `pnpm vitest run src/env.test.ts`
Expected: FAIL (`bedrock-eu` fora do enum; `IA_RETENCAO_ZERO` e as outras não existem).

- [ ] **Step 6: Ambiente, D22 e Configurações**

Em `src/env.ts`:

1. Import: `import { GEOS_IA, MODELOS_BEDROCK_EU, MODELOS_IA, PROVEDORES_IA, REGIOES_BEDROCK_EU } from '@/modules/ia/constantes';`
2. Trocar `iaProvedor` e acrescentar, logo depois de `iaTeto`:

```ts
/** Plano 11 + 14A (spec §12): ausente = IA desligada; fake/sandbox só fora de produção (RNF-107); bedrock-eu = AWS na UE (A-D26). App e worker. */
const iaProvedor = opcional(z.enum(PROVEDORES_IA, { message: 'IA_PROVEDOR deve ser anthropic, bedrock-eu, sandbox ou fake' }).optional());
/** Plano 14A (A-D4): 1 = retenção zero confirmada pelo dono no runbook; sem ela, nenhum uso com dado de paciente (RN-100). */
const iaRetencaoZero = opcional(z.enum(['0', '1'], { message: 'IA_RETENCAO_ZERO deve ser 0 ou 1' }).optional());
/** Plano 14A (INT-08): a região da UE do cliente do Bedrock (lista fechada). */
const iaBedrockRegiao = opcional(z.enum(REGIOES_BEDROCK_EU, { message: `IA_BEDROCK_REGIAO deve ser uma destas regiões da União Europeia: ${REGIOES_BEDROCK_EU.join(', ')}` }).optional());
/** Plano 14A (RNF-103, D2): variáveis que o SDK do provedor leria sozinho, mudando a chamada sem passar pelo código. */
const proibidaNoWorker = (nome: string) => opcional(z.undefined({ message: `${nome} não pode ser definida no worker: o SDK do provedor de IA a leria sozinho (RNF-103)` }));
```

3. Trocar `conferirIaEmProducao` por `conferirIa` (e as duas chamadas no `superRefine`):

```ts
/** A conferência da IA, igual no app e no worker. A mensagem nunca repete valor. */
function conferirIa(e: { NODE_ENV: string; APP_URL: string; IA_PROVEDOR?: string; IA_INFERENCE_GEO: string; IA_MODELO_LEITURA: string; IA_BEDROCK_REGIAO?: string }, ctx: z.RefinementCtx): void {
  if (e.IA_PROVEDOR === 'bedrock-eu') {
    if (!e.IA_BEDROCK_REGIAO) ctx.addIssue({ code: 'custom', path: ['IA_BEDROCK_REGIAO'], message: 'IA_BEDROCK_REGIAO é obrigatória com IA_PROVEDOR=bedrock-eu' });
    if (!(MODELOS_BEDROCK_EU as readonly string[]).includes(e.IA_MODELO_LEITURA)) {
      ctx.addIssue({ code: 'custom', path: ['IA_MODELO_LEITURA'], message: `Com IA_PROVEDOR=bedrock-eu, IA_MODELO_LEITURA deve ser um destes: ${MODELOS_BEDROCK_EU.join(', ')}` });
    }
  }
  if (!emProducao(e)) return;
  if (e.IA_PROVEDOR === 'fake' || e.IA_PROVEDOR === 'sandbox') ctx.addIssue({ code: 'custom', path: ['IA_PROVEDOR'], message: 'IA_PROVEDOR sandbox ou fake só fora de produção' });
  // C5 (Plano 14A): a região us vale para a API direta; no Bedrock a região vem do perfil eu.
  if (e.IA_PROVEDOR === 'anthropic' && e.IA_INFERENCE_GEO !== 'us') ctx.addIssue({ code: 'custom', path: ['IA_INFERENCE_GEO'], message: 'IA_INFERENCE_GEO deve ser us em produção (A-D5)' });
}
```

4. No schema do app, na linha da IA: `IA_PROVEDOR: iaProvedor, IA_DESLIGADA: iaDesligada, IA_MODELO_LEITURA: iaModelo, IA_INFERENCE_GEO: iaGeo, IA_TETO_GLOBAL_MENSAL_USD: iaTeto, IA_RETENCAO_ZERO: iaRetencaoZero, IA_BEDROCK_REGIAO: iaBedrockRegiao,`
5. No `workerSchema`, a mesma linha e, depois de `ANTHROPIC_API_KEY`:

```ts
    // Plano 14A (INT-08, RNF-103): as chaves da AWS só existem no worker (o app nunca as declara); só a chave de longo prazo
    // do usuário IAM (AKIA…): credencial temporária (ASIA…) precisaria do token de sessão, que o worker não aceita (D2)
    AWS_ACCESS_KEY_ID: opcional(z.string().regex(/^AKIA[A-Z0-9]{16}$/, { message: 'AWS_ACCESS_KEY_ID em formato inválido (use a chave de acesso de longo prazo do usuário IAM, que começa com AKIA)' }).optional()),
    AWS_SECRET_ACCESS_KEY: opcional(z.string().regex(/^[A-Za-z0-9/+=]{40}$/, { message: 'AWS_SECRET_ACCESS_KEY em formato inválido (confira se foi colada inteira)' }).optional()),
    AWS_BEARER_TOKEN_BEDROCK: proibidaNoWorker('AWS_BEARER_TOKEN_BEDROCK'),
    AWS_SESSION_TOKEN: proibidaNoWorker('AWS_SESSION_TOKEN'),
    AWS_PROFILE: proibidaNoWorker('AWS_PROFILE'),
    ANTHROPIC_BEDROCK_BASE_URL: proibidaNoWorker('ANTHROPIC_BEDROCK_BASE_URL'),
    ANTHROPIC_CUSTOM_HEADERS: proibidaNoWorker('ANTHROPIC_CUSTOM_HEADERS'),
```

6. No `superRefine` do worker, depois de `conferirIa(e, ctx);`:

```ts
    if (Boolean(e.AWS_ACCESS_KEY_ID) !== Boolean(e.AWS_SECRET_ACCESS_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['AWS_ACCESS_KEY_ID'], message: 'Configure AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY juntas (ou nenhuma)' });
    }
```

Em `.env.example`, trocar o bloco da IA:

```bash
# Plano 11 / 14A — IA (spec da IA §12). Sem IA_PROVEDOR, a IA fica desligada. Em dev/E2E use sandbox (nunca chama a API).
# IA_PROVEDOR=sandbox            (anthropic | bedrock-eu | sandbox | fake)
# IA_DESLIGADA=0
# IA_RETENCAO_ZERO=1             (dev/E2E com sandbox; em produção, só depois do runbook — sem ela, nada de dado de paciente)
# IA_MODELO_LEITURA=claude-opus-5-5   (com bedrock-eu: claude-sonnet-5-5)
# IA_INFERENCE_GEO=us
# IA_BEDROCK_REGIAO=eu-central-1 (só com bedrock-eu)
# IA_TETO_GLOBAL_MENSAL_USD=50
# ANTHROPIC_API_KEY=   (só no worker; em produção, pelo Easypanel)
# AWS_ACCESS_KEY_ID=  AWS_SECRET_ACCESS_KEY=   (só no worker, com bedrock-eu; nunca AWS_SESSION_TOKEN, AWS_PROFILE nem AWS_BEARER_TOKEN_BEDROCK)
```

Em `src/modules/plataforma/contas.ts` (D22, C8): trocar o import `AVISO_IA_VERSAO` por `AUTORIZACAO_IA_VERSAO`, a mensagem e a conferência:

```ts
export class IaProvisoriaError extends Error {
  override name = 'IaProvisoriaError';
  constructor() {
    super('Os textos legais da IA ainda são provisórios. Publique a autorização do paciente e o aditivo finais antes de liberar.');
  }
}
// …
  // D22 (A-06 também no código; C8 do Plano 14A): em produção, só com a autorização do paciente e o aditivo finais
  if (liberar && producao && [AUTORIZACAO_IA_VERSAO, IA_ADITIVO_VERSAO].some((v) => v.endsWith('-provisorio'))) throw new IaProvisoriaError();
```

Em `src/app/admin/page.tsx`, a mesma frase em `ia_provisoria.texto`.

Em `src/app/painel/configuracoes/ia-secao.tsx`, o aditivo pelo destino em uso:

```tsx
import { aditivoIa, IA_ADITIVO_VERSAO, textoCorrido } from '@/modules/ia/textos-legais';
// …
export async function IaSecao({ tenant, ctx, ativada = false }: { tenant: TenantRow; ctx: TenantContext; ativada?: boolean }) {
  const { modo, destino } = configIA(getEnv());
  const estado = estadoIaDoTenant(tenant, modo);
  if (estado === 'ausente' || estado === 'suspensa' || !destino) return null;
  const texto = aditivoIa(destino); // RN-109: o parágrafo do suboperador muda conforme o provedor em uso
  const aditivo = (
    <details className="rounded-2xl border border-borda p-3">
      <summary className="cursor-pointer font-semibold">{`${texto.titulo} (versão ${IA_ADITIVO_VERSAO})`}</summary>
      <div className="mt-2 space-y-2">{texto.paragrafos.map((p, i) => <p key={i}>{textoCorrido(p)}</p>)}</div>
    </details>
  );
  // (o resto da função não muda)
```

Em `test/ia.ts`, `iaPronta` passa a usar o aditivo atual (com o 0.1 o consultório ficaria "aditivo desatualizado") e nasce a configuração de teste que os testes da IA compartilham:

```ts
import type { ConfigIA } from '@/modules/ia/modo';
import { IA_ADITIVO_VERSAO } from '@/modules/ia/textos-legais';
// …
    .set({ iaLiberada: true, iaAtivadaEm: new Date(), iaAditivoVersao: o.aditivo ?? IA_ADITIVO_VERSAO, iaCotaMensalUsd: o.cotaUsd ?? 15 })
// …
/** Plano 14A: a configuração dos testes da IA — provedor falso (destino `teste`), retenção zero ligada, teto da plataforma folgado. */
export const IA_TESTE: ConfigIA = { modo: 'fake', destino: 'teste', modelo: 'claude-opus-5-5', geo: 'us', tetoGlobalMicroUsd: 50_000_000_000, retencaoZero: true };
```

Nos testes que montam um `ConfigIA` à mão, trocar pelo `IA_TESTE` (o tipo ganhou `destino` e `retencaoZero`): `src/modules/ia/tarefas.test.ts:30` e `src/modules/ia/leitura-job.test.ts:40` (`const IA: ConfigIA = IA_TESTE;`, importando de `../../../test/ia`), e `src/modules/ia/logs.test.ts:41` (`const ia = IA_TESTE;`).

- [ ] **Step 7: Rodar e conferir**

Run: `pnpm vitest run src/modules/ia src/env.test.ts src/modules/plataforma/contas.test.ts src/modules/plataforma/dpa.test.ts src/app/painel/configuracoes`
Expected: PASS. (Se algum teste ainda gravar `iaAditivoVersao: '0.1-provisorio'` esperando a IA ativa, trocar por `IA_ADITIVO_VERSAO`; `git grep -n "iaAditivoVersao: '0.1" src test` deve ficar vazio fora dos casos que testam justamente o aditivo antigo.)

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/modules/ia/constantes.ts src/modules/ia/textos-legais.ts src/modules/ia/textos-legais.test.ts src/modules/ia/modo.ts src/modules/ia/modo.test.ts \
  src/components/texto-legal.tsx src/env.ts src/env.test.ts .env.example src/modules/plataforma/contas.ts src/app/admin/page.tsx \
  src/app/painel/configuracoes/ia-secao.tsx test/ia.ts src/modules/ia/tarefas.test.ts src/modules/ia/leitura-job.test.ts src/modules/ia/logs.test.ts
git commit -m "feat(ia): usos, destinos, texto da autorização 0.1-provisorio, aditivo 0.2-provisorio, IA_RETENCAO_ZERO e variáveis do Bedrock (P14A-02)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 3: Provedor AWS Bedrock na UE — `provedor-bedrock.ts`, região `eu`, limite do pedido por provedor, guardas, imagem e avaliação manual (P14A-03)

**Revisão: completa (agente revisor-rls, lente de segurança)** — SDK novo só no worker, variáveis que ele lê sozinho, credenciais, mapeamento de erros e tentativas (nunca uma segunda chamada cobrada), nada antes do portão do envio, imagem Docker.

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (`@anthropic-ai/bedrock-sdk` 0.34.4, versão fixada), `src/modules/ia/constantes.ts` (`REGIOES_IA`), `src/modules/ia/precos.ts` (+ `precos.test.ts`), `src/modules/ia/modo.ts` (+ `modo.test.ts`), `src/modules/ia/provedor.ts`, `src/modules/ia/provedor-anthropic.ts` (+ test), `src/modules/ia/provedor-sandbox.ts`, `src/modules/ia/provedor-fake.ts`, `src/modules/ia/provedor-do-ambiente.ts` (+ test), `src/modules/ia/preparar-arquivo.ts` (+ test), `src/modules/ia/leitura-job.ts` (+ test: só a chamada do preparo e a credencial), `src/modules/ia/guardas.test.ts`, `src/modules/ia/avaliacao/avaliar.ts`, `scripts/ia-avaliar.ts`, `src/worker/index.ts` (a linha do log), `test/setup.ts`, `Dockerfile`, `.github/workflows/ci.yml` (fumaça do SDK na imagem)
- Create: `src/modules/ia/provedor-bedrock.ts`, `src/modules/ia/provedor-bedrock.test.ts`

**Interfaces:**
- Consumes: `ErroProvedor`, `PedidoLeitura`, `RespostaLeitura`, `UsoTokens` (`provedor.ts`), `ConfigIA`/`configIA` (T2), `WorkerEnv.IA_BEDROCK_REGIAO`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (T2), `PROVEDORES_IA`, `RegiaoBedrock`, `MODELOS_BEDROCK_EU` (T2).
- Produces: `REGIOES_IA`/`RegiaoIA` (constantes), `MULTIPLICADOR_GEO: Record<RegiaoIA, number>` (eu = 1,1), `ProvedorIA` com `destino` e `limitePedidoBytes`, `PedidoLeitura.geo: RegiaoIA`, `ConfigIA.geo: RegiaoIA` (`'eu'` com `bedrock-eu`), `provedorBedrock`, `classificarErroBedrock`, `PERFIL_BEDROCK_EU`, `LIMITE_PEDIDO_BEDROCK_BYTES`, `prepararLaudo(conteudo, { limitePedidoBytes })`, `provedorFake({ limitePedidoBytes })`.

- [ ] **Step 1: A dependência**

```bash
pnpm add @anthropic-ai/bedrock-sdk@0.34.4 --save-exact
```

Expected: `package.json` com `"@anthropic-ai/bedrock-sdk": "0.34.4"` e o `@anthropic-ai/sdk` continua um só no lockfile (o pacote pede `>=0.115.1 <1`; o 0.131.0 atende). Conferir: `pnpm why @anthropic-ai/sdk` lista uma versão só.

- [ ] **Step 2: Os testes que falham — o provedor**

Criar `src/modules/ia/provedor-bedrock.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import type { PedidoLeitura } from './provedor';
import { classificarErroBedrock, LIMITE_PEDIDO_BEDROCK_BYTES, PERFIL_BEDROCK_EU, provedorBedrock } from './provedor-bedrock';

// Nenhuma chamada sai da máquina: todo teste passa um fetch falso. As chaves são de mentira (só o formato).
const CHAVES = { accessKeyId: 'AKIA' + 'T'.repeat(16), secretAccessKey: 's'.repeat(40) };
const pedido: PedidoLeitura = {
  modelo: 'claude-sonnet-5-5', geo: 'eu', sistema: 'SISTEMA', instrucao: 'INSTRUCAO',
  arquivo: { tipo: 'pdf', base64: 'JVBERi0xLjcK', paginas: 1 },
  schema: { type: 'object', additionalProperties: false, properties: {}, required: [] }, maxTokens: 16_000, esforco: 'low',
};
type Chamada = { url: string; corpo: Record<string, unknown>; cabecalhos: Headers };
function fetchFalso(respostas: (() => Response | Promise<Response>)[]) {
  const chamadas: Chamada[] = [];
  const f: typeof fetch = async (entrada, init) => {
    const req = new Request(entrada as RequestInfo, init);
    chamadas.push({ url: req.url, corpo: JSON.parse(await req.text()), cabecalhos: req.headers });
    const r = respostas.shift();
    if (!r) throw new Error('chamada a mais');
    return r();
  };
  return { f, chamadas };
}
const json = (status: number, corpo: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', 'x-amzn-requestid': 'aws-req-1', ...extra } });
const mensagem = (texto: string, stop = 'end_turn') =>
  json(200, {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: texto }],
    stop_reason: stop, stop_details: null, stop_sequence: null, usage: { input_tokens: 9_000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  });
const novo = (f: typeof fetch, extra: { timeoutMs?: number } = {}) => provedorBedrock({ regiao: 'eu-central-1', ...CHAVES, fetch: f, ...extra });

const AMBIENTE = ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION', 'ANTHROPIC_BEDROCK_BASE_URL', 'AWS_PROFILE', 'AWS_SESSION_TOKEN'] as const;
afterEach(() => {
  for (const v of AMBIENTE) delete process.env[v];
});

describe('provedor Bedrock na UE (INT-08, D1, D2) — só contra fetch falso', () => {
  it('InvokeModel do perfil eu. na região dada: PDF inline em base64, output_config, anthropic_version; sem model no corpo, sem inference_geo, sem thinking/ferramentas', async () => {
    const { f, chamadas } = fetchFalso([() => mensagem('{"ok":true}')]);
    const p = novo(f);
    expect(p).toMatchObject({ nome: 'bedrock-eu', destino: 'bedrock-eu', limitePedidoBytes: LIMITE_PEDIDO_BEDROCK_BYTES });
    const r = await p.lerDocumento(pedido);
    expect(r).toMatchObject({ tipo: 'ok', texto: '{"ok":true}', requestId: 'aws-req-1', uso: { entrada: 9_000, saida: 800, geo: 'eu' } });
    const { url, corpo, cabecalhos } = chamadas[0];
    expect(url).toBe(`https://bedrock-runtime.eu-central-1.amazonaws.com/model/${PERFIL_BEDROCK_EU['claude-sonnet-5-5']}/invoke`);
    expect(corpo).toMatchObject({
      anthropic_version: 'bedrock-2023-05-31', max_tokens: 16_000, system: 'SISTEMA',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: pedido.schema } },
      messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjcK' } }, { type: 'text', text: 'INSTRUCAO' }] }],
    });
    for (const proibido of ['model', 'inference_geo', 'thinking', 'tools', 'tool_choice', 'fallbacks', 'speed', 'stream', 'anthropic_beta']) expect(corpo, proibido).not.toHaveProperty(proibido);
    expect(cabecalhos.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATTTTTTTTTTTTTTTT\/\d{8}\/eu-central-1\/bedrock\/aws4_request/);
    expect(cabecalhos.get('anthropic-beta')).toBeNull();
  });

  it('D2: AWS_BEARER_TOKEN_BEDROCK, AWS_REGION e ANTHROPIC_BEDROCK_BASE_URL do ambiente não mudam a credencial, a região nem o destino', async () => {
    process.env.AWS_BEARER_TOKEN_BEDROCK = 'token-do-ambiente';
    process.env.AWS_REGION = 'us-east-1';
    process.env.ANTHROPIC_BEDROCK_BASE_URL = 'http://outro.invalid';
    process.env.AWS_PROFILE = 'perfil-do-ambiente';
    const { f, chamadas } = fetchFalso([() => mensagem('{}')]);
    await novo(f).lerDocumento(pedido);
    expect(new URL(chamadas[0].url).host).toBe('bedrock-runtime.eu-central-1.amazonaws.com');
    const auth = chamadas[0].cabecalhos.get('authorization') ?? '';
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(auth).toContain('/eu-central-1/bedrock/aws4_request');
    expect(auth).not.toContain('token-do-ambiente');
  });

  it('D3: modelo fora do perfil eu. ou região que não é eu → ErroProvedor, sem chamada', async () => {
    const { f, chamadas } = fetchFalso([]);
    await expect(novo(f).lerDocumento({ ...pedido, modelo: 'claude-opus-5-5' })).rejects.toMatchObject({ name: 'ErroProvedor', tipo: 'pedido_invalido' });
    await expect(novo(f).lerDocumento({ ...pedido, geo: 'us' })).rejects.toMatchObject({ tipo: 'pedido_invalido' });
    expect(chamadas).toHaveLength(0);
  });

  it('recusa e saída cortada viram resultado (sem lançar); foto vai como image/jpeg', async () => {
    const { f, chamadas } = fetchFalso([() => mensagem('', 'refusal'), () => mensagem('{"x":', 'max_tokens'), () => mensagem('{}')]);
    const p = novo(f);
    expect(await p.lerDocumento(pedido)).toMatchObject({ tipo: 'recusa' });
    expect(await p.lerDocumento(pedido)).toMatchObject({ tipo: 'cortada' });
    await p.lerDocumento({ ...pedido, arquivo: { tipo: 'imagem', base64: '/9j/4AAQ' } });
    expect((chamadas[2].corpo.messages as { content: unknown[] }[])[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/4AAQ' } });
  });

  it.each([
    [403, 'credencial'], [401, 'credencial'], [413, 'grande_demais'], [429, 'repetir'], [500, 'repetir'], [503, 'repetir'],
    [408, 'incerto'], [424, 'incerto'], [504, 'incerto'], [400, 'pedido_invalido'], [404, 'pedido_invalido'],
  ])('HTTP %i → %s, uma chamada só (maxRetries 0) e sem o texto do provedor', async (status, tipo) => {
    const { f, chamadas } = fetchFalso([() => json(status, { message: 'mensagem da AWS que pode ecoar o pedido' }, { 'x-amzn-errortype': 'QualquerException' })]);
    const erro = await novo(f).lerDocumento(pedido).catch((e: unknown) => e);
    expect(erro).toMatchObject({ name: 'ErroProvedor', tipo, status, requestId: 'aws-req-1' });
    expect(String((erro as Error).message)).not.toContain('ecoar');
    expect(chamadas).toHaveLength(1);
  });

  it('tempo esgotado depois do envio → incerto, uma chamada só', async () => {
    let n = 0;
    const lento: typeof fetch = (_e, init) => {
      n++;
      return new Promise((_r, rejeitar) => init?.signal?.addEventListener('abort', () => rejeitar(Object.assign(new Error('abortado'), { name: 'AbortError' }))));
    };
    await expect(novo(lento, { timeoutMs: 50 }).lerDocumento(pedido)).rejects.toMatchObject({ tipo: 'incerto' });
    expect(n).toBe(1);
  });

  it('classificarErroBedrock: erro desconhecido → incerto (nunca repete o que pode ter sido processado)', () => {
    expect(classificarErroBedrock(new Error('qualquer'))).toMatchObject({ tipo: 'incerto', status: null });
  });
});
```

Run: `pnpm vitest run src/modules/ia/provedor-bedrock.test.ts`
Expected: FAIL (o módulo não existe).

- [ ] **Step 3: Região `eu`, interface e o provedor**

Em `src/modules/ia/constantes.ts`, depois de `GeoIA`:

```ts
/** Plano 14A (§5.5, D5): a região efetiva da chamada — `us`/`global` na API direta (IA_INFERENCE_GEO), `eu` no perfil eu. do Bedrock. */
export const REGIOES_IA = ['us', 'global', 'eu'] as const;
export type RegiaoIA = (typeof REGIOES_IA)[number];
```

Em `src/modules/ia/precos.ts`: trocar `GeoIA` por `RegiaoIA` nos imports e em todas as assinaturas (`custoMicroUsd`, `custoMaximoMicroUsd`, `custoMaximoDoArquivo`, `reservaDaLeitura`) e:

```ts
/** `inference_geo: "us"` custa 1,1× (modelos 4.6+); o perfil geográfico `eu.` do Bedrock tem o prêmio de 10% do endpoint regional (§5.5). */
export const MULTIPLICADOR_GEO: Record<RegiaoIA, number> = { us: 1.1, global: 1, eu: 1.1 };
// …
const geoDe = (g: string | null | undefined, padrao: RegiaoIA): RegiaoIA => (g === 'us' || g === 'global' || g === 'eu' ? g : padrao);
```

(e um comentário em `PRECOS_IA_DATA`: "Plano 14A (R-117): a tabela vale também para o Bedrock até o dono conferir a página de preços da AWS — runbook, passo 3".)

Em `src/modules/ia/modo.ts`: `ConfigIA.geo: RegiaoIA` e, em `configIA`, `geo: e.IA_PROVEDOR === 'bedrock-eu' ? 'eu' : e.IA_INFERENCE_GEO,` (o `IA_INFERENCE_GEO` só vale para a `anthropic`, §12). Em `modo.test.ts`: `expect(configIA({ ...base, IA_PROVEDOR: 'bedrock-eu' }).geo).toBe('eu');`. Em `precos.test.ts`: `expect(MULTIPLICADOR_GEO.eu).toBe(1.1); expect(custoMicroUsd('claude-sonnet-5-5', 'eu', { entrada: 1_000_000, cacheLeitura: 0, cacheGravacao: 0, saida: 0, geo: 'eu' })).toBe(2_200_000);`.

`src/modules/ia/provedor.ts`, a interface:

```ts
import type { DestinoIA, ModeloIA, RegiaoIA } from './constantes';
// …
export type PedidoLeitura = {
  modelo: ModeloIA;
  /** A região efetiva (D5): `us`/`global` na API direta; `eu` no Bedrock (a região vem do perfil; nunca vai como parâmetro). */
  geo: RegiaoIA;
  // (o resto não muda)
};
// …
export interface ProvedorIA {
  readonly nome: 'anthropic' | 'bedrock-eu' | 'sandbox' | 'fake';
  /** RN-109: o destino que o portão do envio grava na tarefa e que a autorização do paciente precisa ter. */
  readonly destino: DestinoIA;
  /** D4 / R-116: o tamanho máximo do pedido inteiro (base64 + instruções); o preparo recusa antes do portão. */
  readonly limitePedidoBytes: number;
  /** Uma chamada; nunca repete sozinho (maxRetries 0); lança ErroProvedor. */
  lerDocumento(p: PedidoLeitura): Promise<RespostaLeitura>;
}
```

`src/modules/ia/provedor-anthropic.ts`: exportar `export const LIMITE_PEDIDO_ANTHROPIC_BYTES = 32 * 1024 * 1024;`, devolver `nome: 'anthropic', destino: 'anthropic-us', limitePedidoBytes: LIMITE_PEDIDO_ANTHROPIC_BYTES` e, no começo de `lerDocumento`:

```ts
      // D5: a região `eu` é do Bedrock; a API direta só tem `us`/`global` — nada sai com outra
      if (p.geo === 'eu') throw new ErroProvedor('pedido_invalido', null, null);
```

(o `inference_geo: p.geo` continua, agora estreitado a `us | global`). Em `provedor-anthropic.test.ts`: `it('geo eu (do Bedrock) nunca vai à API direta', …)` com `fetchFalso([])` esperando `pedido_invalido` e nenhuma chamada.

`src/modules/ia/provedor-sandbox.ts`: `nome: 'sandbox', destino: 'teste', limitePedidoBytes: 32 * 1024 * 1024`. `src/modules/ia/provedor-fake.ts`: `RoteiroFake` ganha `limitePedidoBytes?: number` e o objeto devolvido, `destino: 'teste', limitePedidoBytes: roteiro.limitePedidoBytes ?? 32 * 1024 * 1024`.

Criar `src/modules/ia/provedor-bedrock.ts`:

```ts
import { AnthropicBedrock, APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/bedrock-sdk';
import type { ModeloIA, RegiaoBedrock } from './constantes';
import { ErroProvedor, type PedidoLeitura, type ProvedorIA, type RespostaLeitura, type UsoTokens } from './provedor';

/**
 * INT-08 (Plano 14A, A-D26): o ÚNICO arquivo que importa o SDK do Bedrock (RNF-103; guarda em guardas.test.ts). Só o worker
 * o alcança. Cliente `AnthropicBedrock` (InvokeModel, D1) com o perfil de inferência geográfico `eu.`: o pedido é atendido só
 * em regiões da UE (destinos conferidos por GetInferenceProfile no runbook). Tudo explícito no construtor (D2): região,
 * baseURL, as duas chaves, `awsSessionToken: null` e `apiKey: null` — sem isso, AWS_BEARER_TOKEN_BEDROCK do ambiente venceria
 * as chaves e AWS_REGION/ANTHROPIC_BEDROCK_BASE_URL mudariam o destino; com as chaves explícitas, a cadeia de credenciais
 * da AWS (AWS_PROFILE, SSO, IMDS) nunca é consultada. `maxRetries: 0`: as novas tentativas são do pg-boss (RN-105).
 * Só messages.create, com PDF/imagem inline em base64 — sem Batch (CreateModelInvocationJob), S3, URL, count_tokens nem
 * `inference_geo` (não existe no Bedrock: a região vem do perfil). Nenhum erro sai com o texto do provedor: só
 * ErroProvedor { tipo, status, requestId }.
 */
export const TIMEOUT_MS = 120_000;
/** INT-08 / R-116: o Bedrock aceita pedido de até 20 MB (base64 do arquivo + instruções). */
export const LIMITE_PEDIDO_BEDROCK_BYTES = 20 * 1024 * 1024;
/** D3: o modelo do código → o perfil de inferência `eu.` (ID conferido no runbook, página "inference-profiles-support"). */
export const PERFIL_BEDROCK_EU: Partial<Record<ModeloIA, string>> = { 'claude-sonnet-5-5': 'eu.anthropic.claude-sonnet-5-5' };
/** Códigos do Node em que a requisição nem saiu (RN-105: dá para repetir). */
const ANTES_DO_ENVIO = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

function codigoDaCausa(err: unknown): string | undefined {
  let c: unknown = err;
  for (let i = 0; i < 4 && c; i++) {
    const codigo = (c as { code?: unknown }).code;
    if (typeof codigo === 'string') return codigo;
    c = (c as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * RN-105 no Bedrock (INT-08): 401/403 (AccessDenied, UnrecognizedClient, modelo sem acesso) → credencial; 413 → grande
 * demais; 429 (Throttling), 500 (InternalServer) e 503 (ServiceUnavailable) → repetir; 408 (ModelTimeout), 424 (ModelError)
 * e 504 → incerto (o modelo pode ter processado e cobrado); outros 4xx (Validation, ResourceNotFound) → pedido inválido.
 * A AWS não tem o "limite de gasto" da Anthropic: o teto é o AWS Budgets (alerta) e o teto da plataforma. Exportada para o teste.
 */
export function classificarErroBedrock(err: unknown): ErroProvedor {
  if (err instanceof APIConnectionTimeoutError) return new ErroProvedor('incerto', null, null);
  if (err instanceof APIConnectionError) {
    const codigo = codigoDaCausa(err);
    return new ErroProvedor(codigo && ANTES_DO_ENVIO.has(codigo) ? 'nao_enviado' : 'incerto', null, null);
  }
  if (err instanceof APIError) {
    const status = typeof err.status === 'number' ? err.status : null;
    const requestId = err.headers?.get('x-amzn-requestid') ?? err.requestID ?? null;
    if (status === 401 || status === 403) return new ErroProvedor('credencial', status, requestId);
    if (status === 413) return new ErroProvedor('grande_demais', status, requestId);
    if (status === 429 || status === 500 || status === 503) return new ErroProvedor('repetir', status, requestId);
    if (status === 408 || status === 424 || status === 504) return new ErroProvedor('incerto', status, requestId);
    if (status !== null && status >= 400 && status < 500) return new ErroProvedor('pedido_invalido', status, requestId);
    return new ErroProvedor('incerto', status, requestId);
  }
  return new ErroProvedor('incerto', null, null);
}

function usoDe(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): UsoTokens {
  return { entrada: u.input_tokens, cacheLeitura: u.cache_read_input_tokens ?? 0, cacheGravacao: u.cache_creation_input_tokens ?? 0, saida: u.output_tokens, geo: 'eu' };
}

export function provedorBedrock(o: { regiao: RegiaoBedrock; accessKeyId: string; secretAccessKey: string; fetch?: typeof fetch; baseURL?: string; timeoutMs?: number }): ProvedorIA {
  const cliente = new AnthropicBedrock({
    awsRegion: o.regiao,
    baseURL: o.baseURL ?? `https://bedrock-runtime.${o.regiao}.amazonaws.com`,
    awsAccessKey: o.accessKeyId,
    awsSecretKey: o.secretAccessKey,
    awsSessionToken: null,
    // D2: `null`, não `undefined` — o padrão do construtor leria AWS_BEARER_TOKEN_BEDROCK, que venceria a assinatura SigV4
    apiKey: null as unknown as undefined,
    maxRetries: 0,
    timeout: o.timeoutMs ?? TIMEOUT_MS,
    logLevel: 'off',
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
  return {
    nome: 'bedrock-eu',
    destino: 'bedrock-eu',
    limitePedidoBytes: LIMITE_PEDIDO_BEDROCK_BYTES,
    async lerDocumento(p: PedidoLeitura): Promise<RespostaLeitura> {
      const perfil = PERFIL_BEDROCK_EU[p.modelo];
      // D3: nada sai para modelo fora do perfil eu. nem com região que não é a da UE
      if (!perfil || p.geo !== 'eu') throw new ErroProvedor('pedido_invalido', null, null);
      const bloco =
        p.arquivo.tipo === 'pdf'
          ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.arquivo.base64 } } as const)
          : ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.arquivo.base64 } } as const);
      // `.then(ok, erro)`: o tipo da mensagem vem inferido do SDK do Bedrock (importar o tipo do @anthropic-ai/sdk quebraria
      // a guarda do RNF-103); o erro do SDK vira ErroProvedor aqui dentro, sem o texto do provedor
      const { data: r, response } = await cliente.messages
        .create({
          model: perfil,
          max_tokens: p.maxTokens,
          system: p.sistema,
          messages: [{ role: 'user', content: [bloco, { type: 'text', text: p.instrucao }] }],
          output_config: { effort: p.esforco, format: { type: 'json_schema', schema: p.schema } },
        })
        .withResponse()
        .then(
          (x) => x,
          (err: unknown) => {
            throw classificarErroBedrock(err);
          },
        );
      const requestId = response.headers.get('x-amzn-requestid');
      const uso = usoDe(r.usage);
      if (r.stop_reason === 'refusal') return { tipo: 'recusa', categoria: r.stop_details?.category ?? null, uso, requestId };
      if (r.stop_reason !== 'end_turn') return { tipo: 'cortada', uso, requestId };
      const texto = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      return { tipo: 'ok', texto, uso, requestId };
    },
  };
}
```

(O `stop_details` existe na `Message` do SDK 0.131, que o `@anthropic-ai/bedrock-sdk` reaproveita — o `provedor-anthropic.ts` já o lê. Na linha do log do worker, `src/worker/index.ts`, acrescentar `provedor: provedorIA?.nome ?? 'nenhum'` ao objeto do `logger.info(…, 'IA de laudos')` — só o nome, nunca chave nem região.)

`src/modules/ia/provedor-do-ambiente.ts`:

```ts
import { provedorBedrock } from './provedor-bedrock';
// …
    case 'bedrock-eu':
      // §12 / RNF-107: sem as duas chaves (ou sem a região, que o ambiente já exige), provedor nulo → credencial_invalida
      return {
        modo,
        provedor: env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.IA_BEDROCK_REGIAO
          ? provedorBedrock({ regiao: env.IA_BEDROCK_REGIAO, accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY })
          : null,
      };
```

Em `provedor-do-ambiente.test.ts`, um `vi.mock('./provedor-bedrock', …)` no molde do da Anthropic (o dublê registra as opções e falha ao ler) e:

```ts
  it('bedrock-eu com as duas chaves e a região → o provedor do Bedrock com elas; sem chave → null (credencial_invalida)', () => {
    const AK = 'AKIA' + 'Q'.repeat(16);
    const SK = 'k'.repeat(40);
    const base = { IA_PROVEDOR: 'bedrock-eu', IA_BEDROCK_REGIAO: 'eu-west-3', IA_MODELO_LEITURA: 'claude-sonnet-5-5' };
    expect(provedorIADoAmbiente(env({ ...base, AWS_ACCESS_KEY_ID: AK, AWS_SECRET_ACCESS_KEY: SK }))).toMatchObject({ modo: 'bedrock-eu', provedor: { nome: 'bedrock-eu' } });
    expect(montadoBedrock.mock.calls[0]![0]).toEqual({ regiao: 'eu-west-3', accessKeyId: AK, secretAccessKey: SK });
    expect(provedorIADoAmbiente(env(base))).toEqual({ modo: 'bedrock-eu', provedor: null });
  });
```

Em `test/setup.ts`, depois do `delete process.env.ANTHROPIC_API_KEY;`:

```ts
// Plano 14A (D2): nenhum teste herda credencial nem configuração da AWS do ambiente
for (const v of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'AWS_REGION', 'AWS_BEARER_TOKEN_BEDROCK', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']) delete process.env[v];
```

- [ ] **Step 4: O limite do pedido no preparo, antes do portão (D4)**

Em `src/modules/ia/preparar-arquivo.ts`:

```ts
const cabeNoPedido = (bytes: number, limite: number) => Math.ceil(bytes / 3) * 4 + MARGEM_DO_PEDIDO <= limite;

/**
 * D4 (Plano 14A): o limite do pedido é do provedor em uso (32 MB na API direta, 20 MB no Bedrock — ≈ 14 MB de arquivo
 * preparado, R-116). Acima dele, `arquivo_invalido` aqui, ANTES do portão: nada sai e nada é marcado como saído.
 */
export async function prepararLaudo(conteudo: Buffer, o: { limitePedidoBytes?: number } = {}): Promise<ArquivoPreparado> {
  const limite = o.limitePedidoBytes ?? LIMITE_PEDIDO_BYTES;
  const tipo = conteudo.length ? detectarTipo(conteudo) : null;
  if (tipo?.ext === 'pdf') return prepararPdf(conteudo, limite);
  if (tipo?.ext === 'jpg' || tipo?.ext === 'png') return prepararImagem(conteudo, limite);
  throw new PreparoError('arquivo_invalido');
}
```

e `prepararPdf(conteudo, limite)`/`prepararImagem(conteudo, limite)` passam `limite` ao `cabeNoPedido`. Teste em `preparar-arquivo.test.ts`:

```ts
  it('D4 (Plano 14A): o limite do pedido vem do provedor — acima dele, arquivo_invalido', async () => {
    const pdf = await pdfDeTeste({ paginas: 1 });
    await expect(prepararLaudo(pdf, { limitePedidoBytes: 1024 })).rejects.toMatchObject({ motivo: 'arquivo_invalido' });
    await expect(prepararLaudo(await fotoDeTeste({ largura: 400, altura: 300 }), { limitePedidoBytes: 1024 })).rejects.toMatchObject({ motivo: 'arquivo_invalido' });
    expect((await prepararLaudo(pdf)).tipo).toBe('pdf');
  });
```

Em `src/modules/ia/leitura-job.ts`: `DepsJobIA.geo: RegiaoIA` (import de `./constantes`); no passo (2), a credencial também no Bedrock:

```ts
  if (!deps.provedor) return falhar(deps.modo === 'anthropic' || deps.modo === 'bedrock-eu' ? 'credencial_invalida' : 'ia_desligada');
```

e, no passo (3):

```ts
    arquivo = await prepararLaudo(await readFile(resolverCaminho(deps.dataDir, lida.arquivo)), { limitePedidoBytes: deps.provedor.limitePedidoBytes });
```

Em `leitura-job.test.ts`:

```ts
  it('D4 (Plano 14A): o arquivo preparado acima do limite do provedor em uso → arquivo_invalido, sem sair', async () => {
    const P = await pedido();
    const f = provedorFake({ limitePedidoBytes: 1024 });
    expect(await processarTarefaIA(P.d, deps(f))).toBe('falhou');
    expect(await tarefa(P)).toMatchObject({ status: 'falhou', erro: 'arquivo_invalido', enviadoEm: null, saiuEm: null });
    expect(f.chamadas.ler).toHaveLength(0);
    expect(await saidas(P)).toHaveLength(0);
    expect((await usoDe(P)).situacao).toBe('estornado');
  });

  it('bedrock-eu sem as chaves no worker → credencial_invalida, sem chamada, e os admins avisados', async () => {
    const P = await pedido();
    const a = alertas();
    expect(await processarTarefaIA(P.d, deps(null, { modo: 'bedrock-eu', alertas: a }))).toBe('falhou');
    expect(await tarefa(P)).toMatchObject({ erro: 'credencial_invalida', saiuEm: null });
    expect(a.credencial).toHaveBeenCalledTimes(1);
  });
```

`src/modules/ia/avaliacao/avaliar.ts`: `geo: RegiaoIA` nos dois lugares (import de `../constantes`).

- [ ] **Step 5: As guardas (RNF-103, RNF-105)**

Em `src/modules/ia/guardas.test.ts`:

```ts
  it('@anthropic-ai/bedrock-sdk só em src/modules/ia/provedor-bedrock.ts (src e scripts)', () => {
    expect([...fontes('src'), ...fontes('scripts')].filter(importa('@anthropic-ai/bedrock-sdk'))).toEqual(['src/modules/ia/provedor-bedrock.ts']);
  });

  it('RNF-105 no Bedrock: só InvokeModel do perfil eu. — sem Batch, S3, URL, count_tokens, Mantle, inference_geo nem streaming', () => {
    const codigo = readFileSync('src/modules/ia/provedor-bedrock.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const proibido of [/\bbatches\b/, /CreateModelInvocationJob/, /\bs3\b/i, /type:\s*'url'/, /countTokens|count_tokens/, /Mantle/, /inference_geo/, /\bstream\b/, /\bbetas?\b/, /\bfiles\b/, /\btools\b/, /\bthinking\b/, /\bfallbacks\b/]) {
      expect(codigo, String(proibido)).not.toMatch(proibido);
    }
    expect(codigo).toMatch(/maxRetries:\s*0/);
    expect(codigo).toMatch(/logLevel:\s*'off'/);
    expect(codigo).toMatch(/awsSessionToken:\s*null/);
    expect(codigo).toMatch(/apiKey:\s*null/);
  });
```

e, no teste do grafo do Next, `'src/modules/ia/provedor-bedrock.ts'` na lista dos proibidos e:

```ts
    expect(g.pacotes.get('@anthropic-ai/bedrock-sdk'), '@anthropic-ai/bedrock-sdk importado (no grafo do Next) por').toBeUndefined();
```

(O primeiro teste existente — `@anthropic-ai/sdk` só em `provedor-anthropic.ts` — continua passando: a regex dele não casa `@anthropic-ai/bedrock-sdk`, e o `provedor-bedrock.ts` importa as classes de erro do próprio `@anthropic-ai/bedrock-sdk`, que as reexporta.)

- [ ] **Step 6: A avaliação manual com o Bedrock (RN-127)**

Em `scripts/ia-avaliar.ts`, o provedor pela variável `IA_AVALIACAO_PROVEDOR` (padrão `anthropic`; nunca no CI):

```ts
import { MODELOS_BEDROCK_EU, MODELOS_IA, REGIOES_BEDROCK_EU, type ModeloIA, type RegiaoBedrock } from '@/modules/ia/constantes';
import { provedorAnthropic } from '@/modules/ia/provedor-anthropic';
import { provedorBedrock } from '@/modules/ia/provedor-bedrock';
// … (as conferências de IA_AVALIACAO, NODE_ENV, pasta e teto ficam iguais)
const qual = process.env.IA_AVALIACAO_PROVEDOR ?? 'anthropic';
if (qual !== 'anthropic' && qual !== 'bedrock-eu') falhar('IA_AVALIACAO_PROVEDOR: anthropic ou bedrock-eu.');
let provedor;
let geo: 'us' | 'eu';
let permitidos: readonly ModeloIA[];
if (qual === 'bedrock-eu') {
  // Plano 14A (RN-127, INT-08): a leitura de novo com o perfil eu. — chaves de um usuário IAM de DEV (o script não distingue
  // de produção: conferir no console da AWS antes de rodar, como a chave da Anthropic); só a região da UE da lista
  const ak = process.env.AWS_ACCESS_KEY_ID ?? '';
  const sk = process.env.AWS_SECRET_ACCESS_KEY ?? '';
  const regiao = process.env.IA_BEDROCK_REGIAO ?? '';
  if (!/^AKIA[A-Z0-9]{16}$/.test(ak) || !/^[A-Za-z0-9/+=]{40}$/.test(sk)) falhar('AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY ausentes ou em formato inválido (use o usuário IAM de dev).');
  if (!(REGIOES_BEDROCK_EU as readonly string[]).includes(regiao)) falhar(`IA_BEDROCK_REGIAO: ${REGIOES_BEDROCK_EU.join(', ')}.`);
  for (const v of ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_SESSION_TOKEN', 'AWS_PROFILE', 'ANTHROPIC_BEDROCK_BASE_URL', 'ANTHROPIC_CUSTOM_HEADERS']) if (process.env[v]) falhar(`${v} não pode estar definida (RNF-103).`);
  provedor = provedorBedrock({ regiao: regiao as RegiaoBedrock, accessKeyId: ak, secretAccessKey: sk });
  geo = 'eu';
  permitidos = MODELOS_BEDROCK_EU;
} else {
  const chave = process.env.ANTHROPIC_API_KEY ?? '';
  if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(chave)) falhar('ANTHROPIC_API_KEY ausente ou em formato inválido (use a chave do workspace de dev).');
  provedor = provedorAnthropic({ apiKey: chave });
  geo = 'us';
  permitidos = MODELOS_IA;
}
const modelos = (process.env.IA_AVALIACAO_MODELOS ?? permitidos.join(',')).split(',').map((m) => m.trim()) as ModeloIA[];
if (!modelos.length || modelos.some((m) => !permitidos.includes(m))) falhar(`IA_AVALIACAO_MODELOS: só ${permitidos.join(', ')}.`);
// … avaliar({ dir, modelos, tetoMicroUsd, esforco, geo, provedor: provedor! })
```

(o bloco antigo que lia `ANTHROPIC_API_KEY` e `MODELOS_IA` sai, substituído pelo acima). O relatório não muda: só métricas, nunca conteúdo.

- [ ] **Step 7: A imagem Docker e a fumaça no CI**

No `Dockerfile`, no `RUN set -eu; …` da poda, depois do laço do `@anthropic-ai+sdk`:

```dockerfile
    for d in node_modules/.pnpm/@anthropic-ai+bedrock-sdk@*/node_modules/@anthropic-ai/bedrock-sdk; do \
      test -f "$d/index.js"; rm -rf "$d/src"; find "$d" \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' \) -delete; \
    done; \
    for d in node_modules/.pnpm/@aws-sdk+*/node_modules/@aws-sdk/* node_modules/.pnpm/@smithy+*/node_modules/@smithy/*; do \
      rm -rf "$d/dist-types"; find "$d" -name '*.map' -delete; \
    done; \
```

e o comentário do bloco ganha: "Plano 14A: o SDK do Bedrock (só no worker) e as dependências da AWS: saem os fontes, as declarações e os mapas; ficam `dist-cjs` e `dist-es` (o Node escolhe pelo `exports`)".

Em `.github/workflows/ci.yml`, no passo "O worker carrega o pdf-lib e o SDK da IA na imagem podada (Plano 11)", antes do `console.log('IA ok na imagem')`:

```js
            const { provedorBedrock } = await import('./src/modules/ia/provedor-bedrock.ts');
            const b = provedorBedrock({ regiao: 'eu-central-1', accessKeyId: 'AKIA' + 'C'.repeat(16), secretAccessKey: 'c'.repeat(40) });
            if (b.nome !== 'bedrock-eu' || typeof b.lerDocumento !== 'function') throw new Error('SDK do Bedrock não carregou');
```

Medir a imagem localmente antes do commit (o CI repete):

```bash
docker build -t nutridebby:p14a . && docker save nutridebby:p14a | gzip -6 | wc -c
```

Expected: ≤ 265 MB (277 872 640 bytes). **Se passar**, parar e avisar o controlador com a medida (Global Constraints: o dono decide entre subir o orçamento e a assinatura SigV4 própria). Registrar a medida no PR.

- [ ] **Step 8: Rodar e conferir**

Run: `pnpm vitest run src/modules/ia src/env.test.ts`
Expected: PASS (inclusive `provedor-bedrock.test.ts`, as guardas e o grafo do Next).

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: sem erros; o `next build` não alcança o SDK do Bedrock (a guarda do grafo já confere).

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/modules/ia/constantes.ts src/modules/ia/precos.ts src/modules/ia/precos.test.ts src/modules/ia/modo.ts src/modules/ia/modo.test.ts \
  src/modules/ia/provedor.ts src/modules/ia/provedor-anthropic.ts src/modules/ia/provedor-anthropic.test.ts src/modules/ia/provedor-sandbox.ts \
  src/modules/ia/provedor-fake.ts src/modules/ia/provedor-bedrock.ts src/modules/ia/provedor-bedrock.test.ts src/modules/ia/provedor-do-ambiente.ts \
  src/modules/ia/provedor-do-ambiente.test.ts src/modules/ia/preparar-arquivo.ts src/modules/ia/preparar-arquivo.test.ts src/modules/ia/leitura-job.ts \
  src/modules/ia/leitura-job.test.ts src/modules/ia/guardas.test.ts src/modules/ia/avaliacao/avaliar.ts scripts/ia-avaliar.ts src/worker/index.ts \
  test/setup.ts Dockerfile .github/workflows/ci.yml
git commit -m "feat(ia): provedor AWS Bedrock na UE (perfil eu., InvokeModel), região eu, limite do pedido por provedor e avaliação com bedrock-eu (P14A-03)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 4: RN-100 com a autorização — situação, pedido, portão do envio com o destino, aplicação, varredura, retirada pela nutricionista e o job `ia-retirada` (P14A-04)

**Revisão: completa (agente revisor-rls)** — conferência da autorização com o paciente travado em todos os pontos da RN-100, ordem de travas (paciente → exame → tenant → tarefa), destino gravado no portão, cancelamento e estorno no job e na varredura, CS-105.

**Files:**
- Create: `src/modules/ia/autorizacao.ts` (parte de leitura e a retirada da nutricionista), `src/modules/ia/autorizacao.test.ts`, `src/modules/ia/autorizacao-retirada-job.ts`, `src/modules/ia/autorizacao-retirada-job.test.ts`
- Modify: `src/modules/ia/cancelar.ts` (`criadasAntesDe`), `src/modules/ia/tarefas.ts`, `src/modules/ia/leitura-job.ts`, `src/modules/ia/conferencia.ts`, `src/jobs/queues.ts` (`ia-retirada`), `src/worker/index.ts`, `src/app/painel/pacientes/[id]/exames/{page.tsx,ia-exame.tsx,ia-exame.test.ts,actions.ts}`, `src/app/painel/exames-recebidos/[id]/page.tsx`, `test/ia.ts` (`pacienteAutorizado`), e os testes `src/modules/ia/{tarefas,leitura-job,conferencia,travas,logs}.test.ts`

**Interfaces:**
- Consumes: `iaAutorizacoes`, `autorizacaoNoBanco` (T1); `USO_DA_TAREFA`, `MSG_IA.semAutorizacao`/`retirouAutorizacao`, `MSG_FALHA.sem_autorizacao`, `estadoIaComPaciente`, `ConfigIA.destino`/`retencaoZero`, `IA_TESTE` (T2); `ProvedorIA.destino` (T3); `cancelarTarefas`, `estornar`, `marcarIncerto`, `carregarPacienteParaEscrita` (existentes).
- Produces: `SituacaoAutorizacao`, `EventoDeDecisao`, `situacaoDaAutorizacao`, `vigentePara`, `ultimaDecisao`, `autorizacaoDoPaciente`, `motivoDoPaciente`, `situacaoIaDoPaciente`, `registrarRetiradaPelaNutri` (`autorizacao.ts`); `processarRetiradaIa`, `DadosRetiradaIa`; a fila `ia-retirada`; `cancelarTarefas(…, { criadasAntesDe })`; `DepsJobIA.destino`/`retencaoZero`; `expirarTarefasDoTenant(tx, agora, destino)` → `{ interrompidas, expiradas, canceladas }`; `aplicarSugestao(…, deps & { destino })`; `pacienteAutorizado` (`test/ia.ts`).

- [ ] **Step 1: O helper de teste**

Em `test/ia.ts`, depois de `pacienteInformado` (que fica até a T10, marcado como legado):

```ts
/** Plano 14A: paciente com a autorização vigente (os três usos, versão atual, destino `teste` — o dos provedores fake e sandbox). */
export async function pacienteAutorizado(db: Db, ctx: TenantContext, extra: Partial<typeof patients.$inferInsert> = {}): Promise<PatientRow> {
  const p = await novoPaciente(db, ctx, extra);
  await autorizacaoNoBanco(db, ctx.tenantId, p.id);
  return p;
}
```

e, no comentário de `pacienteInformado`: "Legado do Plano 11 (RN-128): só o teste de `ciencia-paciente.ts` usa; sai na T10."

- [ ] **Step 2: Os testes que falham — situação e retirada pela nutricionista**

Criar `src/modules/ia/autorizacao.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, exameComLaudo, IA_TESTE, iaPronta, pacienteAutorizado, tarefaNoBanco } from '../../../test/ia';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { iaAutorizacoes, iaTarefas, iaUso, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { autorizacaoDoPaciente, motivoDoPaciente, registrarRetiradaPelaNutri, situacaoDaAutorizacao, ultimaDecisao, vigentePara, type EventoDeDecisao } from './autorizacao';
import { pedirLeituraExame } from './tarefas';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-aut-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const agora = new Date(Math.floor(Date.now() / 1000) * 1000);
const evento = (o: Partial<EventoDeDecisao> = {}): EventoDeDecisao => ({
  id: 'e1', evento: 'autorizou', versao: '0.1-provisorio', usos: ['leitura_laudos', 'resumo_historico', 'rascunho_plano'], destino: 'teste', canal: 'link',
  em: new Date('2026-10-09T12:00:00Z'), registradoEm: new Date('2026-10-09T12:00:00Z'), ...o,
});

describe('situacaoDaAutorizacao (RN-107, RN-109, D7) — sem banco', () => {
  it('nunca, vigente, retirada, versão antiga, outro destino; destino nulo (IA desligada) não confere o destino', () => {
    expect(situacaoDaAutorizacao(null, 'teste')).toEqual({ tipo: 'nunca' });
    expect(situacaoDaAutorizacao(evento(), 'teste')).toMatchObject({ tipo: 'vigente', versao: '0.1-provisorio', destino: 'teste', canal: 'link' });
    expect(situacaoDaAutorizacao(evento({ evento: 'retirou', versao: null, usos: null, destino: null, canal: 'app' }), 'teste')).toMatchObject({ tipo: 'retirada', canal: 'app' });
    expect(situacaoDaAutorizacao(evento({ versao: '0.0.9-velha' }), 'teste')).toMatchObject({ tipo: 'versao_antiga', versao: '0.0.9-velha' });
    expect(situacaoDaAutorizacao(evento({ destino: 'anthropic-us' }), 'bedrock-eu')).toMatchObject({ tipo: 'outro_destino', destino: 'anthropic-us' });
    expect(situacaoDaAutorizacao(evento({ destino: 'anthropic-us' }), null)).toMatchObject({ tipo: 'vigente' });
  });

  it('vigentePara confere o uso; motivoDoPaciente: bloqueado, arquivado ou anonimizado antes da autorização', () => {
    const s = situacaoDaAutorizacao(evento({ usos: ['resumo_historico'] }), 'teste');
    expect(vigentePara(s, 'leitura_laudos')).toBe(false);
    expect(vigentePara(s, 'resumo_historico')).toBe(true);
    const ativo = { status: 'ativo', anonimizadoEm: null };
    expect(motivoDoPaciente(ativo, situacaoDaAutorizacao(evento(), 'teste'), 'leitura_laudos')).toBeNull();
    expect(motivoDoPaciente(ativo, { tipo: 'nunca' }, 'leitura_laudos')).toBe('sem_autorizacao');
    expect(motivoDoPaciente(ativo, s, 'leitura_laudos')).toBe('sem_autorizacao');
    for (const p of [{ status: 'bloqueado', anonimizadoEm: null }, { status: 'arquivado', anonimizadoEm: null }, { status: 'ativo', anonimizadoEm: new Date() }]) {
      expect(motivoDoPaciente(p, situacaoDaAutorizacao(evento(), 'teste'), 'leitura_laudos')).toBe('paciente_indisponivel');
    }
  });
});

describe('ultimaDecisao e autorizacaoDoPaciente — no banco', () => {
  it('o último autorizou/retirou decide (por registrado_em); pedido por e-mail não conta; a reautorização volta a valer', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const ler = () => withTenant(T.ctx, (tx) => autorizacaoDoPaciente(tx, p.id, 'teste'), app.db);
    expect(await ler()).toEqual({ tipo: 'nunca' });
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    expect((await ler()).tipo).toBe('vigente');
    await withTenant(T.ctx, (tx) => tx.insert(iaAutorizacoes).values({ tenantId: T.tenantId, patientId: p.id, evento: 'pedido_email', versao: '0.1-provisorio', canal: 'link', registradoPor: T.nutriId, emailHmac: 'h' }), app.db);
    expect((await ler()).tipo).toBe('vigente');
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    expect((await ler()).tipo).toBe('retirada');
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    expect((await ler()).tipo).toBe('vigente');
    expect((await withTenant(T.ctx, (tx) => ultimaDecisao(tx, p.id), app.db))?.evento).toBe('autorizou');
  });
});

describe('registrarRetiradaPelaNutri (US-109, RN-108)', () => {
  it('grava a retirada (canal "a pedido, pela nutricionista") e, na mesma transação, cancela a fila (estorno) e esvazia a pronta', async () => {
    const T = await novoTenant(app.db);
    await iaPronta(app.db, T.tenantId);
    const p = await pacienteAutorizado(app.db, T.ctx);
    const examId = await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir });
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    const naFila = await pedirLeituraExame(T.ctx, tenant as TenantRow, p.id, examId, { db: app.db, agora, ia: IA_TESTE, avisarTeto: async () => 0 });
    const pronta = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'pronta', expiraEm: new Date(agora.getTime() + 86_400_000), resultado: { versao: 1, dataColeta: null, linhas: [], descartadas: 0 } });
    expect(await registrarRetiradaPelaNutri(T.ctx, p.id, { db: app.db, agora })).toBe(true);
    const ts = await withTenant(T.ctx, (tx) => tx.select({ id: iaTarefas.id, status: iaTarefas.status, resultado: iaTarefas.resultado, encerradoPor: iaTarefas.encerradoPor }).from(iaTarefas), app.db);
    expect(ts.find((t) => t.id === naFila)).toMatchObject({ status: 'cancelada', encerradoPor: T.nutriId });
    expect(ts.find((t) => t.id === pronta)).toMatchObject({ status: 'cancelada', resultado: null });
    expect((await withTenant(T.ctx, (tx) => tx.select({ s: iaUso.situacao }).from(iaUso).where(eq(iaUso.tarefaId, naFila)), app.db))[0].s).toBe('estornado');
    const [r] = await withTenant(T.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.evento, 'retirou')), app.db);
    expect(r).toMatchObject({ canal: 'nutricionista', registradoPor: T.nutriId, patientId: p.id, ip: null });
    expect((await withTenant(T.ctx, (tx) => autorizacaoDoPaciente(tx, p.id, 'teste'), app.db)).tipo).toBe('retirada');
    // nada a retirar: não grava outro evento
    expect(await registrarRetiradaPelaNutri(T.ctx, p.id, { db: app.db, agora })).toBe(false);
  });

  it('paciente bloqueado (exclusão atendida): PacienteBloqueadoError, nada gravado', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    await expect(registrarRetiradaPelaNutri(T.ctx, p.id, { db: app.db, agora })).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
});
```

Run: `pnpm vitest run src/modules/ia/autorizacao.test.ts`
Expected: FAIL (`./autorizacao` não existe).

- [ ] **Step 3: O módulo — leitura e a retirada da nutricionista**

Criar `src/modules/ia/autorizacao.ts`:

```ts
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaAutorizacoes, type IaAutorizacaoRow, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { cancelarTarefas } from './cancelar';
import type { CanalAutorizacao, DestinoIA, MotivoFalha, UsoIA } from './constantes';
import { AUTORIZACAO_IA_VERSAO_MIN, versaoAtende } from './textos-legais';

/**
 * Plano 14A (spec da IA v0.5.1, RN-107 a RN-109, A-D23 a A-D25): a autorização do paciente para o uso de IA. Esta é a parte
 * de LEITURA (a situação, a RN-100 do paciente) e a retirada registrada pela nutricionista; a T5 acrescenta o resto da
 * escrita (app, pedido por e-mail, papel). Cada linha de `ia_autorizacoes` é um evento, só de inclusão (0108).
 */
export type SituacaoAutorizacao =
  | { tipo: 'nunca' }
  | { tipo: 'vigente'; id: string; em: Date; canal: CanalAutorizacao; versao: string; destino: DestinoIA; usos: UsoIA[] }
  | { tipo: 'retirada'; id: string; em: Date; canal: CanalAutorizacao }
  | { tipo: 'versao_antiga'; id: string; em: Date; canal: CanalAutorizacao; versao: string }
  | { tipo: 'outro_destino'; id: string; em: Date; canal: CanalAutorizacao; versao: string; destino: DestinoIA };

export type EventoDeDecisao = Pick<IaAutorizacaoRow, 'id' | 'evento' | 'versao' | 'usos' | 'destino' | 'canal' | 'em' | 'registradoEm'>;

/**
 * RN-107 (D7): o último evento de decisão (`autorizou`/`retirou`) decide. Vigente = `autorizou`, versão ≥ o mínimo e o
 * destino do provedor em uso (RN-109); o uso é conferido por `vigentePara`. Com `destino` nulo (IA_PROVEDOR ausente), o
 * destino não é conferido — só a tela usa assim; a RN-100 nunca chega aqui sem provedor.
 */
export function situacaoDaAutorizacao(ultimo: EventoDeDecisao | null, destino: DestinoIA | null): SituacaoAutorizacao {
  if (!ultimo) return { tipo: 'nunca' };
  const base = { id: ultimo.id, em: ultimo.em, canal: ultimo.canal as CanalAutorizacao };
  if (ultimo.evento === 'retirou') return { tipo: 'retirada', ...base };
  const versao = ultimo.versao ?? '';
  if (!versaoAtende(versao, AUTORIZACAO_IA_VERSAO_MIN)) return { tipo: 'versao_antiga', ...base, versao };
  const doEvento = ultimo.destino as DestinoIA;
  if (destino !== null && doEvento !== destino) return { tipo: 'outro_destino', ...base, versao, destino: doEvento };
  return { tipo: 'vigente', ...base, versao, destino: doEvento, usos: (ultimo.usos ?? []) as UsoIA[] };
}

export const vigentePara = (s: SituacaoAutorizacao, uso: UsoIA): boolean => s.tipo === 'vigente' && s.usos.includes(uso);

/** O último `autorizou`/`retirou` do paciente (por `registrado_em`, o relógio do banco depois da trava; desempate pelo id). */
export async function ultimaDecisao(tx: Tx, patientId: string): Promise<EventoDeDecisao | null> {
  const [u] = await tx
    .select({ id: iaAutorizacoes.id, evento: iaAutorizacoes.evento, versao: iaAutorizacoes.versao, usos: iaAutorizacoes.usos, destino: iaAutorizacoes.destino, canal: iaAutorizacoes.canal, em: iaAutorizacoes.em, registradoEm: iaAutorizacoes.registradoEm })
    .from(iaAutorizacoes)
    .where(and(eq(iaAutorizacoes.patientId, patientId), inArray(iaAutorizacoes.evento, ['autorizou', 'retirou'])))
    .orderBy(desc(iaAutorizacoes.registradoEm), desc(iaAutorizacoes.id))
    .limit(1);
  return u ?? null;
}

/** Dentro de withTenant. Quem decide algo com ela trava o paciente ANTES (a retirada trava o paciente FOR UPDATE). */
export async function autorizacaoDoPaciente(tx: Tx, patientId: string, destino: DestinoIA | null): Promise<SituacaoAutorizacao> {
  return situacaoDaAutorizacao(await ultimaDecisao(tx, patientId), destino);
}

/** RN-100 (parte do paciente, D8): ativo e com a autorização vigente para o uso. No app, no worker e ao aplicar. */
export function motivoDoPaciente(p: Pick<PatientRow, 'status' | 'anonimizadoEm'>, s: SituacaoAutorizacao, uso: UsoIA): MotivoFalha | null {
  if (p.status !== 'ativo' || p.anonimizadoEm) return 'paciente_indisponivel';
  return vigentePara(s, uso) ? null : 'sem_autorizacao';
}

/** Para as telas (exames, exames recebidos): a situação, sem auditoria — não é dado de saúde (AUDIT_EXCEPTIONS). */
export async function situacaoIaDoPaciente(ctx: TenantContext, patientId: string, destino: DestinoIA | null, db: Db = getDb()): Promise<SituacaoAutorizacao> {
  if (!idValido(patientId)) return { tipo: 'nunca' };
  return withTenant(ctx, (tx) => autorizacaoDoPaciente(tx, patientId, destino), db);
}

/**
 * US-109 "Retirada a pedido, pela nutricionista" (RN-108): na MESMA transação, o evento `retirou` (canal `nutricionista`)
 * e o cancelamento da fila e das sugestões prontas do paciente — como o `definirRecusaIa` do Plano 11. Ordem de travas da
 * cota: paciente (carregarPacienteParaEscrita) → tenant (cancelarTarefas) → tarefas → ia_uso → plataforma. Funciona com a
 * IA bloqueada pela admin, desativada ou em emergência (a retirada é sempre possível, US-105). Sem nada a retirar → false.
 */
export async function registrarRetiradaPelaNutri(ctx: TenantContext, patientId: string, deps: { db?: Db; agora?: Date } = {}): Promise<boolean> {
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      const s = await autorizacaoDoPaciente(tx, p.id, null);
      if (s.tipo === 'nunca' || s.tipo === 'retirada') return false;
      await tx.insert(iaAutorizacoes).values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'retirou', canal: 'nutricionista', registradoPor: ctx.actorUserId! });
      await cancelarTarefas(tx, { tenantId: ctx.tenantId, patientId: p.id, agora, por: ctx.actorUserId ?? null });
      return true;
    },
    deps.db ?? getDb(),
  );
}
```

Em `src/modules/ia/cancelar.ts`, a opção nova (D14) — na assinatura `o: { …; criadasAntesDe?: Date }`, no import `lt`, e no `where` do `alvo`:

```ts
        o.criadasAntesDe ? lt(iaTarefas.criadoEm, o.criadasAntesDe) : undefined,
```

(comentário: "Plano 14A (D14): o job `ia-retirada` com o paciente reautorizado cancela só as tarefas criadas antes da retirada".)

Run: `pnpm vitest run src/modules/ia/autorizacao.test.ts`
Expected: PASS.

- [ ] **Step 4: Os testes que falham — pedido, portão, aplicação e varredura**

Nos testes da IA, trocar `pacienteInformado` por `pacienteAutorizado` (import de `../../../test/ia`) em `tarefas.test.ts`, `leitura-job.test.ts`, `conferencia.test.ts`, `travas.test.ts` e `logs.test.ts` (sem autorização, a RN-100 nova recusa o pedido e a varredura D15 cancela as tarefas). Em `leitura-job.test.ts`, `deps()` ganha `destino: 'teste', retencaoZero: true` (e o objeto `deps` de `logs.test.ts:43`, os mesmos dois campos); as chamadas de `expirarTarefasDoTenant(tx, agora)` (em `leitura-job.test.ts:336` e `travas.test.ts:126`) ganham o terceiro argumento `'teste'`, e o `toEqual({ interrompidas: 1, expiradas: 1 })` de `travas.test.ts` vira `toEqual({ interrompidas: 1, expiradas: 1, canceladas: 0 })`. Em `conferencia.test.ts`, toda chamada de `aplicarSugestao(…, { db: app.db, agora })` passa a `{ db: app.db, agora, destino: 'teste' }`.

Em `leitura-job.test.ts`, no `it('RN-100 no worker …')`, trocar os casos `recusa` e `sem ciência` por:

```ts
      ['retirada', (P) => autorizacaoNoBanco(app.db, P.T.tenantId, P.p.id, { evento: 'retirou' }), 'sem_autorizacao'],
      ['versão antiga', (P) => autorizacaoNoBanco(app.db, P.T.tenantId, P.p.id, { versao: '0.0.1-antiga' }), 'sem_autorizacao'],
      ['sem retenção zero', async () => undefined, 'ia_desligada'], // com deps({ retencaoZero: false }), abaixo
```

e, no laço, `deps(f, nome === 'sem retenção zero' ? { retencaoZero: false } : {})`. No `it('portão do envio …')`, trocar o caso `Não usar IA` por `['retirada pela nutricionista', (P) => registrarRetiradaPelaNutri(P.T.ctx, P.p.id, { db: app.db, agora }), 'sem_autorizacao']` (import de `./autorizacao`) e acrescentar:

```ts
  it('CS-105 / RNF-111 (a, b): retirada, versão abaixo do mínimo, destino trocado ou uso fora da lista ENTRE o pedido e o envio → nada sai (sem_autorizacao) e a reserva volta', async () => {
    const casos: [string, (P: Awaited<ReturnType<typeof pedido>>) => Promise<unknown>][] = [
      ['retirada pelo link', (P) => autorizacaoNoBanco(app.db, P.T.tenantId, P.p.id, { evento: 'retirou' })],
      ['nova autorização de versão antiga', (P) => autorizacaoNoBanco(app.db, P.T.tenantId, P.p.id, { versao: '0.0.1-antiga' })],
      ['nova autorização para outro destino', (P) => autorizacaoNoBanco(app.db, P.T.tenantId, P.p.id, { destino: 'bedrock-eu' })],
      ['nova autorização sem a leitura de laudos', (P) => autorizacaoNoBanco(app.db, P.T.tenantId, P.p.id, { usos: ['resumo_historico'] })],
    ];
    for (const [nome, mudar] of casos) {
      const P = await pedido();
      const f = provedorFake();
      expect(await processarTarefaIA(P.d, deps(f, { depoisDoPreparo: () => mudar(P) })), nome).toBe('falhou');
      expect(await tarefa(P), nome).toMatchObject({ status: 'falhou', erro: 'sem_autorizacao', enviadoEm: null, saiuEm: null, destino: null });
      expect(f.chamadas.ler, nome).toHaveLength(0);
      expect(await saidas(P), nome).toHaveLength(0);
      expect((await usoDe(P)).situacao, nome).toBe('estornado');
    }
  });

  it('RN-109 / D6: o portão grava o destino com a saída; a tarefa que já saiu para outro destino não sai de novo', async () => {
    const P = await pedido();
    expect(await processarTarefaIA(P.d, deps(provedorFake()))).toBe('pronta');
    expect(await tarefa(P)).toMatchObject({ destino: 'teste' });
    const Q = await pedido();
    // uma tentativa anterior saiu pelo Bedrock e mandou repetir (429); agora o provedor em uso é o de teste
    await withTenant({ tenantId: Q.T.tenantId, role: 'worker' }, (tx) => tx.update(iaTarefas).set({ status: 'processando', saiuEm: agora, destino: 'bedrock-eu' }).where(eq(iaTarefas.id, Q.tarefaId)), app.db);
    const f = provedorFake();
    expect(await processarTarefaIA(Q.d, deps(f))).toBe('falhou');
    expect(await tarefa(Q)).toMatchObject({ erro: 'ia_desligada', destino: 'bedrock-eu' });
    expect(f.chamadas.ler).toHaveLength(0);
  });

  it('a retirada chega DURANTE a chamada: o resultado não é gravado (RN-100 ao gravar), o custo é', async () => {
    const P = await pedido();
    const f = provedorFake({ ler: [respostaOk(RESPOSTA_SANDBOX)] });
    const lerOriginal = f.lerDocumento.bind(f);
    f.lerDocumento = async (p) => {
      await autorizacaoNoBanco(app.db, P.T.tenantId, P.p.id, { evento: 'retirou' });
      return lerOriginal(p);
    };
    expect(await processarTarefaIA(P.d, deps(f))).toBe('falhou');
    expect(await tarefa(P)).toMatchObject({ status: 'falhou', erro: 'sem_autorizacao', resultado: null });
    expect(await tarefa(P)).toHaveProperty('saiuEm', expect.any(Date));
    expect((await usoDe(P)).situacao).toBe('confirmado');
  });

  it('D15: a varredura cancela as tarefas de paciente sem autorização vigente (estorno da fila; pronta esvaziada)', async () => {
    const P = await pedido();
    await autorizacaoNoBanco(app.db, P.T.tenantId, P.p.id, { evento: 'retirou' });
    const r = await withTenant({ tenantId: P.T.tenantId, role: 'worker' }, (tx) => expirarTarefasDoTenant(tx, agora, 'teste'), app.db);
    expect(r).toEqual({ interrompidas: 0, expiradas: 0, canceladas: 1 });
    expect(await tarefa(P)).toMatchObject({ status: 'cancelada', encerradoPor: null });
    expect((await usoDe(P)).situacao).toBe('estornado');
  });
```

Em `tarefas.test.ts`, os casos de paciente sem ciência e com recusa passam a:

```ts
  it('US-110 (Plano 14A): sem autorização, retirada ou de versão antiga → os textos da US-105; sem retenção zero → indisponível; nada reservado', async () => {
    const { T, examId, tenant, p } = await cenario();
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    expect(await mensagem(pedirLeituraExame(T.ctx, tenant, p.id, examId, deps()))).toBe(MSG_IA.retirouAutorizacao);
    const nunca = await novoPaciente(app.db, T.ctx);
    const exameDele = await exameComLaudo(app.db, T.ctx, T.tenant, nunca.id, { dataDir });
    expect(await mensagem(pedirLeituraExame(T.ctx, tenant, nunca.id, exameDele, deps()))).toBe(MSG_IA.semAutorizacao);
    await autorizacaoNoBanco(app.db, T.tenantId, nunca.id, { versao: '0.0.1-antiga' });
    expect(await mensagem(pedirLeituraExame(T.ctx, tenant, nunca.id, exameDele, deps()))).toBe(MSG_IA.semAutorizacao);
    const ok = await pacienteAutorizado(app.db, T.ctx);
    const exameOk = await exameComLaudo(app.db, T.ctx, T.tenant, ok.id, { dataDir });
    expect(await mensagem(pedirLeituraExame(T.ctx, tenant, ok.id, exameOk, deps({ ia: { ...IA_TESTE, retencaoZero: false } })))).toBe(MSG_IA.indisponivel);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(iaTarefas), app.db)).toHaveLength(0);
  });
```

(`mensagem` é o helper existente do arquivo que devolve a `mensagem` do `PedidoIaError`; os imports de `autorizacaoNoBanco`, `pacienteAutorizado`, `IA_TESTE` e `novoPaciente` entram no topo.)

Em `conferencia.test.ts`:

```ts
  it('RN-108: a retirada antes de salvar → "Esta sugestão não está mais disponível." e o exame não muda', async () => {
    const P = await cenario();
    await autorizacaoNoBanco(app.db, P.T.tenantId, P.p.id, { evento: 'retirou' });
    expect(await erros(aplicarSugestao(P.T.ctx, fuso, P.p.id, P.tarefaId, { linhas: [linha(0, '92')], usarData: false }, { db: app.db, agora, destino: 'teste' }))).toEqual({ geral: MSG_IA.indisponivelSugestao });
    expect((await exame(P)).valores).toEqual([]);
  });
```

(`cenario`, `erros`, `linha`, `fuso` e `exame` são os helpers existentes do arquivo; se o de exame tiver outro nome, usar o que o arquivo já tem para ler `exams.valores`.)

Em `travas.test.ts`, o primeiro teste troca o "Não usar IA" pela retirada da nutricionista (mesma ordem paciente → tenant → tarefas):

```ts
  it('worker no passo 1 (tarefa travada, antes do UPDATE auditado) × retirada pela nutricionista: as duas terminam, sem 40P01', async () => {
    // … (o mesmo corpo, com)
    const retirada = registrarRetiradaPelaNutri(T.ctx, p.id, { db: app.db, agora });
    // … Promise.allSettled([worker.fim, retirada]) …
    // o worker confirmou "processando" antes: o cancelamento não a pega (o portão do envio recusa depois — sem autorização)
  });
```

Run: `pnpm vitest run src/modules/ia`
Expected: FAIL nos casos novos (o pedido, o portão, a aplicação e a varredura ainda olham a ciência; `expirarTarefasDoTenant` não tem o terceiro parâmetro).

- [ ] **Step 5: Pedido, portão, gravação, aplicação e varredura**

`src/modules/ia/tarefas.ts`:

```ts
import { autorizacaoDoPaciente, motivoDoPaciente, type SituacaoAutorizacao } from './autorizacao';
import { EM_ANDAMENTO, IA_ARQUIVO_MAX_BYTES, MSG_FALHA, MSG_IA, USO_DA_TAREFA, type MotivoFalha, type StatusTarefa } from './constantes';
import { estadoIaComPaciente, type ConfigIA } from './modo';
// (sai o import de ./ciencia-paciente)

/** US-110 (Plano 14A): a mensagem do paciente — sem autorização vigente (US-105), com a autorização retirada, ou indisponível. */
function mensagemDoPaciente(motivo: MotivoFalha, s: SituacaoAutorizacao): string {
  if (motivo === 'sem_autorizacao') return s.tipo === 'retirada' ? MSG_IA.retirouAutorizacao : MSG_IA.semAutorizacao;
  return MSG_FALHA[motivo];
}
```

e em `pedirLeituraExame`: o atalho `const estado = estadoIaComPaciente(tenant, deps.ia);`; dentro da transação, logo depois de `carregarPacienteParaEscrita`:

```ts
        const p = await carregarPacienteParaEscrita(tx, patientId); // bloqueado/anonimizado → PacienteBloqueadoError
        // RN-100 / RN-107 (Plano 14A): a autorização lida com o paciente travado (a retirada trava o mesmo paciente)
        const situacao = await autorizacaoDoPaciente(tx, p.id, deps.ia.destino);
        const motivo = motivoDoPaciente(p, situacao, USO_DA_TAREFA.leitura_exame);
        if (motivo) throw new PedidoIaError(mensagemDoPaciente(motivo, situacao));
```

e, com o tenant travado, `const estadoTravado = tn ? estadoIaComPaciente(tn, deps.ia) : 'suspensa';`. (`mensagemDoEstado` já devolve `MSG_IA.indisponivel` para `sem_retencao`.)

`src/modules/ia/leitura-job.ts`:

```ts
import { autorizacaoDoPaciente, motivoDoPaciente, vigentePara, type SituacaoAutorizacao } from './autorizacao';
import { PRAZO_SUGESTAO_DIAS, USO_DA_TAREFA, type DestinoIA, type ModeloIA, type MotivoFalha, type RegiaoIA, type TipoTarefa } from './constantes';
import { estadoIaComPaciente, type ModoIA } from './modo';
// (sai o import de ./ciencia-paciente)

export type DepsJobIA = {
  // … (os campos atuais) …
  /** RN-109: o destino do provedor em uso — a autorização tem de ser para ele, e o portão o grava na tarefa. Nulo = sem IA_PROVEDOR. */
  destino: DestinoIA | null;
  /** A-D4: sem retenção zero, nada com dado de paciente sai (ia_desligada). */
  retencaoZero: boolean;
};
```

No passo (1), dentro da transação, a situação junto do paciente:

```ts
      const [p] = await tx.select().from(patients).where(eq(patients.id, t.patientId));
      const situacao = p ? await autorizacaoDoPaciente(tx, p.id, deps.destino) : null;
      const [e] = t.examId ? await tx.select({ arquivo: exams.arquivoPath }).from(exams).where(eq(exams.id, t.examId)) : [];
      return { t, jaEnviada: false as const, paciente: p ?? null, situacao, arquivo: e?.arquivo ?? null };
```

(e `situacao: null` no retorno do `jaEnviada`). No passo (2):

```ts
  const uso = USO_DA_TAREFA[t.tipo as TipoTarefa];
  const tenant = await buscarTenant(db, d.tenantId);
  if (!tenant || estadoIaComPaciente(tenant, deps) !== 'ativa' || !deps.destino) return falhar('ia_desligada');
  const motivoPaciente = lida.paciente && lida.situacao ? motivoDoPaciente(lida.paciente, lida.situacao, uso) : 'paciente_indisponivel';
```

No portão (4), depois das três travas (paciente → exame → tenant, sem mudança na ordem):

```ts
      if (!tn || estadoIaComPaciente(tn, deps) !== 'ativa' || !deps.destino) return 'ia_desligada';
      // D6 (RN-109): a tarefa que já saiu para um destino (tentativa anterior) não sai para outro
      if (t.destino && t.destino !== deps.destino) return 'ia_desligada';
      if (!p) return 'paciente_indisponivel';
      // CS-105 / RN-108: a autorização relida com o paciente travado (FOR SHARE) — serializa com a retirada (FOR UPDATE)
      const doPaciente = motivoDoPaciente(p, await autorizacaoDoPaciente(tx, p.id, deps.destino), uso);
      if (doPaciente) return doPaciente;
      if (!e || e.arquivo !== lida.arquivo) return 'exame_indisponivel';
      const marcada = await tx
        .update(iaTarefas)
        .set({ enviadoEm: agora(), saiuEm: t.saiuEm ?? agora(), destino: t.destino ?? deps.destino, updatedAt: agora() })
        .where(and(eq(iaTarefas.id, t.id), eq(iaTarefas.status, 'processando'), isNull(iaTarefas.enviadoEm)))
        .returning({ id: iaTarefas.id });
```

No passo (6), com as mesmas travas:

```ts
      const doPaciente = p ? motivoDoPaciente(p, await autorizacaoDoPaciente(tx, p.id, deps.destino), uso) : 'paciente_indisponivel';
      let motivo: MotivoFalha | null = null;
      if (atual?.status !== 'processando') motivo = 'interrompida';
      else if (!tn || estadoIaComPaciente(tn, deps) !== 'ativa') motivo = 'ia_desligada';
      else if (doPaciente) motivo = doPaciente;
      // (o resto igual)
```

A varredura, com a rede de segurança da retirada (D15):

```ts
const ATIVAS = ['na_fila', 'processando', 'pronta'] as const;

/**
 * … (comentário atual) … Plano 14A (D15, RN-108): também cancela as tarefas ativas de paciente SEM autorização vigente para
 * o uso da tarefa (rede de segurança do job ia-retirada): na fila → cancelada com estorno; processando → cancelada, com
 * estorno se nada saiu e a reserva mantida (incerta) se `enviado_em` está gravado; pronta → cancelada e esvaziada. A
 * situação é lida antes (sem trava) e a trava única por id continua antes de qualquer estorno.
 */
export async function expirarTarefasDoTenant(tx: Tx, agora: Date, destino: DestinoIA | null): Promise<{ interrompidas: number; expiradas: number; canceladas: number }> {
  const parada = and(eq(iaTarefas.status, 'processando'), lt(iaTarefas.iniciadoEm, new Date(agora.getTime() - PROCESSANDO_MAX_MS)));
  const esquecida = and(eq(iaTarefas.status, 'na_fila'), lt(iaTarefas.criadoEm, new Date(agora.getTime() - NA_FILA_MAX_MS)));
  const vencida = and(eq(iaTarefas.status, 'pronta'), isNotNull(iaTarefas.expiraEm), lt(iaTarefas.expiraEm, agora));
  const candidatas = await tx.select({ id: iaTarefas.id, patientId: iaTarefas.patientId, tipo: iaTarefas.tipo }).from(iaTarefas).where(inArray(iaTarefas.status, [...ATIVAS]));
  const situacoes = new Map<string, SituacaoAutorizacao>();
  const semAutorizacao = new Set<string>();
  for (const c of candidatas) {
    if (!situacoes.has(c.patientId)) situacoes.set(c.patientId, await autorizacaoDoPaciente(tx, c.patientId, destino));
    if (!vigentePara(situacoes.get(c.patientId)!, USO_DA_TAREFA[c.tipo as TipoTarefa])) semAutorizacao.add(c.id);
  }
  const alvo = await tx
    .select({ id: iaTarefas.id, status: iaTarefas.status, enviadoEm: iaTarefas.enviadoEm })
    .from(iaTarefas)
    .where(or(parada, esquecida, vencida, semAutorizacao.size ? inArray(iaTarefas.id, [...semAutorizacao]) : undefined))
    .orderBy(asc(iaTarefas.id))
    .for('update');
  let interrompidas = 0;
  let expiradas = 0;
  let canceladas = 0;
  for (const x of alvo) {
    if (semAutorizacao.has(x.id)) {
      if (!(ATIVAS as readonly string[]).includes(x.status)) continue; // mudou entre a leitura e a trava (aplicada, descartada…)
      await tx.update(iaTarefas).set({ status: 'cancelada', resultado: null, parametros: null, encerradoEm: agora, encerradoPor: null, updatedAt: agora }).where(eq(iaTarefas.id, x.id));
      if (x.status === 'processando' && x.enviadoEm) await marcarIncerto(tx, x.id, agora);
      else if (x.status !== 'pronta') await estornar(tx, x.id, agora);
      canceladas++;
      continue;
    }
    // … (o corpo atual: pronta vencida → expirada; parada/esquecida → falhou interrompida) …
  }
  return { interrompidas, expiradas, canceladas };
}

export async function expirarTarefasIA(db: Db, agora: Date, destino: DestinoIA | null): Promise<{ interrompidas: number; expiradas: number; canceladas: number }> {
  // … (o laço atual, chamando expirarTarefasDoTenant(tx, agora, destino) e somando `canceladas`) …
}
```

`src/modules/ia/conferencia.ts` — `aplicarSugestao` confere a autorização com o paciente travado (RN-108, RN-122):

```ts
import { autorizacaoDoPaciente, vigentePara } from './autorizacao';
import { MAX_LINHAS_SUGESTAO, MAX_VALORES_EXAME, MSG_IA, USO_DA_TAREFA, type DestinoIA } from './constantes';
// …
export async function aplicarSugestao(
  ctx: TenantContext,
  tenant: { fuso: string },
  patientId: string,
  tarefaId: string,
  entrada: { linhas: LinhaEnviada[]; usarData: boolean },
  deps: Deps & { destino: DestinoIA | null },
): Promise<{ linhas: number }> {
  // …
      const p = await carregarPacienteParaEscrita(tx, patientId);
      // RN-108 (Plano 14A): retirada (ou versão/destino que não vale mais) depois da leitura → nada é aplicado
      if (!vigentePara(await autorizacaoDoPaciente(tx, p.id, deps.destino), USO_DA_TAREFA.leitura_exame)) {
        throw new ConferenciaError({ geral: MSG_IA.indisponivelSugestao });
      }
```

Em `src/app/painel/pacientes/[id]/exames/actions.ts`, a chamada passa o destino: `await aplicarSugestao(ctx, tenant, patientId, tarefaId, { linhas, usarData: fd.get('usarData') === '1' }, { destino: configIA(getEnv()).destino });`.

- [ ] **Step 6: O job `ia-retirada`**

Criar `src/modules/ia/autorizacao-retirada-job.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { iaAutorizacoes, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { logger } from '@/lib/logger';
import { autorizacaoDoPaciente } from './autorizacao';
import { cancelarTarefas } from './cancelar';
import type { DestinoIA } from './constantes';

export type DadosRetiradaIa = { tenantId: string; patientId: string; retiradaId: string };

/**
 * RN-108 (Plano 14A, D14): a retirada pelo paciente (app ou link). A sessão de paciente não alcança ia_tarefas nem ia_uso
 * (staff_only): a transação da retirada enfileira este job, que roda no contexto worker na ordem paciente → tenant
 * (cancelarTarefas trava o tenant): trava o paciente, confere de novo a situação e cancela a fila (estorno) e as sugestões
 * prontas (esvaziadas). Se o paciente autorizou de novo depois da retirada, só as tarefas criadas ANTES dela. Até o job
 * rodar, nada sai (portão do envio) e nada é aplicado (aplicarSugestao); a varredura expirar-ia é a rede de segurança.
 */
export async function processarRetiradaIa(d: DadosRetiradaIa, deps: { db: Db; destino: DestinoIA | null; agora?: () => Date }): Promise<number> {
  const agora = (deps.agora ?? (() => new Date()))();
  const n = await withTenant(
    { tenantId: d.tenantId, role: 'worker' },
    async (tx) => {
      const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, d.patientId)).for('update');
      if (!p) return 0;
      const [r] = await tx
        .select({ em: iaAutorizacoes.registradoEm })
        .from(iaAutorizacoes)
        .where(and(eq(iaAutorizacoes.id, d.retiradaId), eq(iaAutorizacoes.patientId, p.id), eq(iaAutorizacoes.evento, 'retirou')));
      if (!r) return 0;
      const s = await autorizacaoDoPaciente(tx, p.id, deps.destino);
      return cancelarTarefas(tx, { tenantId: d.tenantId, patientId: p.id, agora, por: null, criadasAntesDe: s.tipo === 'vigente' ? r.em : undefined });
    },
    deps.db,
  );
  logger.info({ tenantId: d.tenantId, canceladas: n }, 'retirada da autorização de IA: fila e sugestões canceladas');
  return n;
}
```

Criar `src/modules/ia/autorizacao-retirada-job.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, exameComLaudo, IA_TESTE, iaPronta, pacienteAutorizado } from '../../../test/ia';
import { novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { iaTarefas, iaUso, tenants, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { processarRetiradaIa } from './autorizacao-retirada-job';
import { pedirLeituraExame } from './tarefas';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-ret-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const agora = new Date(Math.floor(Date.now() / 1000) * 1000);

async function cenario() {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId);
  const p = await pacienteAutorizado(app.db, T.ctx);
  const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
  const pedir = async () => pedirLeituraExame(T.ctx, tenant as TenantRow, p.id, await exameComLaudo(app.db, T.ctx, T.tenant, p.id, { dataDir }), { db: app.db, agora: new Date(), ia: IA_TESTE, avisarTeto: async () => 0 });
  const status = async (id: string) => (await withTenant(T.ctx, (tx) => tx.select({ s: iaTarefas.status }).from(iaTarefas).where(eq(iaTarefas.id, id)), app.db))[0].s;
  return { T, p, pedir, status };
}

describe('job ia-retirada (RN-108, RNF-111 c, D14)', () => {
  it('cancela a fila (estorno) do paciente que retirou', async () => {
    const { T, p, pedir, status } = await cenario();
    const id = await pedir();
    const retiradaId = await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    expect(await processarRetiradaIa({ tenantId: T.tenantId, patientId: p.id, retiradaId }, { db: app.db, destino: 'teste', agora: () => agora })).toBe(1);
    expect(await status(id)).toBe('cancelada');
    expect((await withTenant(T.ctx, (tx) => tx.select({ s: iaUso.situacao }).from(iaUso).where(eq(iaUso.tarefaId, id)), app.db))[0].s).toBe('estornado');
  });

  it('reautorizou antes de o job rodar: só a tarefa criada antes da retirada é cancelada', async () => {
    const { T, p, pedir, status } = await cenario();
    const antes = await pedir();
    const retiradaId = await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    const depois = await pedir();
    expect(await processarRetiradaIa({ tenantId: T.tenantId, patientId: p.id, retiradaId }, { db: app.db, destino: 'teste', agora: () => agora })).toBe(1);
    expect(await status(antes)).toBe('cancelada');
    expect(await status(depois)).toBe('na_fila');
  });

  it('id de retirada que não é deste paciente (ou não é retirada) → nada', async () => {
    const { T, p, pedir, status } = await cenario();
    const id = await pedir();
    const autorizacao = await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    expect(await processarRetiradaIa({ tenantId: T.tenantId, patientId: p.id, retiradaId: autorizacao }, { db: app.db, destino: 'teste' })).toBe(0);
    expect(await status(id)).toBe('na_fila');
  });
});
```

Em `src/jobs/queues.ts`, depois de `'expirar-ia'`:

```ts
  // Plano 14A (RN-108, D14): a retirada da autorização pelo paciente (app ou link) — cancela a fila e esvazia as sugestões no
  // contexto worker (a sessão de paciente não alcança ia_tarefas). Payload { tenantId, patientId, retiradaId } (só ids).
  'ia-retirada': { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
```

Em `src/worker/index.ts`: o job da IA passa `destino: ia.destino, retencaoZero: ia.retencaoZero` ao `processarTarefaIA`; a varredura, `await expirarTarefasIA(getDb(), new Date(), ia.destino);`; e, depois dela:

```ts
  // Plano 14A (RN-108): a retirada pelo paciente — o job nasce na transação da retirada (app ou link)
  await work<DadosRetiradaIa>('ia-retirada', async ([job]) => {
    await processarRetiradaIa(job.data, { db: getDb(), destino: ia.destino });
  });
```

(import de `processarRetiradaIa` e `DadosRetiradaIa` de `@/modules/ia/autorizacao-retirada-job`; a forma `work<Dados>(fila, async ([job]) => …)` é a mesma da fila `agenda-tenant`.)

- [ ] **Step 7: As telas de exames (D8)**

`src/app/painel/pacientes/[id]/exames/ia-exame.tsx`, o motivo pela autorização:

```tsx
import type { SituacaoAutorizacao } from '@/modules/ia/autorizacao';
// …
export function iaNoExame(p: { estadoIa: EstadoIaTenant; motivo: MotivoFalha | null; situacao: SituacaoAutorizacao; cota: SituacaoCotaIa | null }): IaNoExame {
  if (p.estadoIa === 'nao_ativada') return { podePedir: false, aviso: null };
  const aviso =
    p.estadoIa === 'emergencia' || p.estadoIa === 'sem_retencao' ? MSG_IA.indisponivel
    : p.estadoIa === 'nao_liberada' ? MSG_IA.naoLiberada
    : p.estadoIa === 'aditivo_desatualizado' ? MSG_IA.aditivoDesatualizado
    : p.motivo === 'sem_autorizacao' ? (p.situacao.tipo === 'retirada' ? MSG_IA.retirouAutorizacao : MSG_IA.semAutorizacao)
    : p.motivo ? MSG_FALHA[p.motivo]
    : p.cota?.nivel === 'esgotada' ? MSG_IA.cotaAcabou
    : null;
  return aviso === null ? { podePedir: true, aviso: null } : { podePedir: false, aviso };
}
```

Em `ia-exame.test.ts`, os casos de ciência e recusa viram:

```ts
    const nunca = { tipo: 'nunca' } as const;
    expect(iaNoExame({ estadoIa: 'ativa', motivo: 'sem_autorizacao', situacao: nunca, cota: null }).aviso).toBe(MSG_IA.semAutorizacao);
    expect(iaNoExame({ estadoIa: 'ativa', motivo: 'sem_autorizacao', situacao: { tipo: 'retirada', id: 'r', em: new Date(), canal: 'app' }, cota: null }).aviso).toBe(MSG_IA.retirouAutorizacao);
    expect(iaNoExame({ estadoIa: 'ativa', motivo: 'paciente_indisponivel', situacao: nunca, cota: null }).aviso).toBe(MSG_FALHA.paciente_indisponivel);
    expect(iaNoExame({ estadoIa: 'sem_retencao', motivo: null, situacao: nunca, cota: null })).toEqual({ podePedir: false, aviso: MSG_IA.indisponivel });
```

(e `base` do arquivo ganha `situacao: { tipo: 'nunca' }` no lugar de `recusou`).

`src/app/painel/pacientes/[id]/exames/page.tsx`:

```tsx
import { motivoDoPaciente, situacaoIaDoPaciente } from '@/modules/ia/autorizacao';
import { configIA, estadoIaComPaciente } from '@/modules/ia/modo';
// …
  const ia = configIA(getEnv());
  const estadoIa = estadoIaComPaciente(tenant, ia);
  // … (mostrarIa igual) …
  const situacaoIa = mostrarIa ? await situacaoIaDoPaciente(ctx, paciente.id, ia.destino) : ({ tipo: 'nunca' } as const);
  const iaExame = iaNoExame({ estadoIa, motivo: motivoDoPaciente(paciente, situacaoIa, 'leitura_laudos'), situacao: situacaoIa, cota });
```

`src/app/painel/exames-recebidos/[id]/page.tsx` (US-110 "Aceitar e ler" e US-163):

```tsx
import { motivoDoPaciente, situacaoIaDoPaciente } from '@/modules/ia/autorizacao';
import { configIA, estadoIaComPaciente } from '@/modules/ia/modo';
// …
  const ia = configIA(getEnv());
  const comIa =
    estadoIaComPaciente(tenant, ia) === 'ativa' &&
    motivoDoPaciente(envio.paciente, await situacaoIaDoPaciente(ctx, envio.paciente.id, ia.destino), 'leitura_laudos') === null;
```

(O "Aceitar e ler" continua chamando `pedirLeituraExame` depois do aceite: sem autorização, o exame é aceito e a leitura recusada com a mensagem da US-105 — US-110 "Aceitar e ler valores com IA".)

- [ ] **Step 8: Rodar e conferir**

Run: `pnpm vitest run src/modules/ia src/app/painel/pacientes src/app/painel/exames-recebidos src/modules/pacientes/exames-enviados.test.ts`
Expected: PASS.

Run: `git grep -n "ciencia-paciente" src -- ':!src/modules/ia/ciencia-paciente*'`
Expected: só `src/app/painel/pacientes/[id]/privacidade/{page.tsx,actions.ts,uso-ia.tsx}` e `src/worker/index.ts` (a T7 e a T10 os trocam).

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/modules/ia/autorizacao.ts src/modules/ia/autorizacao.test.ts src/modules/ia/autorizacao-retirada-job.ts src/modules/ia/autorizacao-retirada-job.test.ts \
  src/modules/ia/cancelar.ts src/modules/ia/tarefas.ts src/modules/ia/leitura-job.ts src/modules/ia/conferencia.ts src/jobs/queues.ts src/worker/index.ts \
  "src/app/painel/pacientes/[id]/exames" "src/app/painel/exames-recebidos/[id]/page.tsx" test/ia.ts \
  src/modules/ia/tarefas.test.ts src/modules/ia/leitura-job.test.ts src/modules/ia/conferencia.test.ts src/modules/ia/travas.test.ts src/modules/ia/logs.test.ts
git commit -m "feat(ia): RN-100 com a autorização do paciente (pedido, portão com o destino, resultado, aplicação, varredura) e o job ia-retirada (P14A-04)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 5: Registro da autorização — no app, pedido por e-mail, termo em papel, retirada no app, os links e os dois e-mails (P14A-05)

**Revisão: completa (agentes normas-cfn-lgpd e revisor-rls)** — consentimento (ato afirmativo, prova, um pedido aberto por vez, e-mail de confirmação com o link de retirada), sessão de paciente gravando com a trava, termo em papel tudo ou nada, tokens sem estado, e-mails sem dado de saúde.

**Files:**
- Create: `src/modules/ia/autorizacao-token.ts`, `src/modules/ia/autorizacao-token.test.ts`, `src/modules/ia/autorizacao-escrita.test.ts`
- Modify: `src/modules/ia/autorizacao.ts` (escrita e dados das telas), `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO.ia_autorizacao`)

**Interfaces:**
- Consumes: `autorizacaoDoPaciente`, `situacaoDaAutorizacao`, `ultimaDecisao`, `SituacaoAutorizacao` (T4); `MSG_AUTORIZACAO`, `USOS_IA`, `DESTINO_ROTULO`, `VALIDADE_PEDIDO_MS`, `JANELA_EMAIL_TROCADO_MS`, `TERMO_MAX_BYTES`, `AUTORIZACAO_IA_VERSAO`, `AUTORIZACAO_IA_VERSAO_DATA`, `responsavelDoTenant`, `estadoIaDoTenant`, `ConfigIA` (T2); fila `ia-retirada` (T4); `salvarArquivo`, `carregarPacienteParaEscrita`, `enqueueEmail`, `auditRead`, `inicioDoDia` (`src/modules/agenda/fuso.ts`), `normalizarEmailDoLink` (`src/modules/agenda/link-consulta.ts`), `encryptionKey` (`src/lib/crypto.ts`), `urlDoApp`.
- Produces: o que está em "Contratos entre tarefas" para `autorizacao.ts` (T5) e `autorizacao-token.ts`, mais `enfileirarConfirmacao(tx, o)` (exportada para a T6), `PainelAutorizacao.temRegistro`, e os e-mails `autorizacao_ia` e `autorizacao_ia_confirmada`.

- [ ] **Step 1: Os testes que falham — tokens**

Criar `src/modules/ia/autorizacao-token.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assinarLinkPedido, assinarLinkRetirada, codigoDeReferencia, emailHmac, lerLinkAutorizacao } from './autorizacao-token';

const ids = { tenantId: randomUUID(), patientId: randomUUID() };
const emitidoEm = new Date('2026-10-09T12:00:00Z');
const trocarUm = (t: string, i: number) => t.slice(0, i) + (t[i] === 'A' ? 'B' : 'A') + t.slice(i + 1);

describe('links da autorização de IA (RN-107, D11, D12)', () => {
  it('pedido: 72 caracteres; confere só com o e-mail atual (maiúsculas e espaços não importam); ids e emissão de volta', () => {
    const t = assinarLinkPedido({ ...ids, emitidoEm, email: 'Ana@Ex.com' });
    expect(t).toMatch(/^[A-Za-z0-9_-]{72}$/);
    const l = lerLinkAutorizacao(t)!;
    expect(l).toMatchObject({ tipo: 'pedido', ...ids, emitidoEm });
    expect(l.confere(' ana@ex.com ')).toBe(true);
    expect(l.confere('outra@ex.com')).toBe(false);
    expect(l.confere(null)).toBe(false);
  });

  it('retirada: 88 caracteres, amarrada ao id da autorização, sem o e-mail (não morre com o e-mail corrigido)', () => {
    const autorizacaoId = randomUUID();
    const t = assinarLinkRetirada({ ...ids, autorizacaoId });
    expect(t).toMatch(/^[A-Za-z0-9_-]{88}$/);
    const l = lerLinkAutorizacao(t)!;
    expect(l).toMatchObject({ tipo: 'retirada', ...ids, autorizacaoId });
    expect(l.confere(null)).toBe(true);
    expect(l.confere('qualquer@ex.com')).toBe(true);
  });

  it('adulterado, de outro tamanho ou de outra versão → null ou não confere', () => {
    const t = assinarLinkPedido({ ...ids, emitidoEm, email: 'ana@ex.com' });
    for (const i of [3, 30, 60, 71]) {
      const l = lerLinkAutorizacao(trocarUm(t, i));
      expect(l === null || !l.confere('ana@ex.com'), String(i)).toBe(true);
    }
    for (const lixo of [undefined, 123, '', t.slice(1), `${t}A`, 'x'.repeat(72), t.replace(/./, '_')]) {
      const l = lerLinkAutorizacao(lixo);
      expect(l === null || !l.confere('ana@ex.com')).toBe(true);
    }
    const r = assinarLinkRetirada({ ...ids, autorizacaoId: randomUUID() });
    expect(lerLinkAutorizacao(trocarUm(r, 87))?.confere(null) ?? false).toBe(false);
  });

  it('o HMAC do e-mail normaliza e nunca é o e-mail; o código de referência é XXXX-XXXX-XXXX, fixo por tenant, paciente e versão', () => {
    expect(emailHmac('Ana@Ex.com ')).toBe(emailHmac('ana@ex.com'));
    expect(emailHmac('ana@ex.com')).not.toContain('ana');
    expect(emailHmac('ana@ex.com')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const c = codigoDeReferencia(ids.tenantId, ids.patientId, '0.1-provisorio');
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(codigoDeReferencia(ids.tenantId, ids.patientId, '0.1-provisorio')).toBe(c);
    expect(codigoDeReferencia(ids.tenantId, randomUUID(), '0.1-provisorio')).not.toBe(c);
    expect(codigoDeReferencia(ids.tenantId, ids.patientId, '1.0')).not.toBe(c);
  });
});
```

Run: `pnpm vitest run src/modules/ia/autorizacao-token.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 2: Os tokens**

Criar `src/modules/ia/autorizacao-token.ts`:

```ts
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { encryptionKey } from '@/lib/crypto';
import { urlDoApp } from '@/lib/url-do-app';
import { normalizarEmailDoLink } from '@/modules/agenda/link-consulta';

/**
 * RN-107 / D11 / D12 (Plano 14A): os links da autorização de IA, SEM ESTADO, no molde de link-documento.ts.
 * Pedido (tipo 1): versão + tipo + tenant + paciente + emissão (segundos) e MAC com o e-mail ATUAL do paciente (corrigido o
 * e-mail, o link morre); vale 7 dias (quem lê confere). Retirada (tipo 2): versão + tipo + tenant + paciente + id da
 * autorização e MAC só com a chave — não vence e não depende do e-mail (D11): deixa de valer quando aquela autorização deixa
 * de ser a decisão mais recente (quem lê confere). MAC de 128 bits, chave derivada própria. Sem o código de 6 dígitos do link
 * de documentos (decisão do dono, 08/10/2026): a página não mostra dado de saúde e o código iria ao mesmo e-mail.
 */
const VERSAO = 1;
const TIPO_PEDIDO = 1;
const TIPO_RETIRADA = 2;
let chaveLink: Buffer | undefined;
let chaveEmail: Buffer | undefined;
const chaveDoLink = () => (chaveLink ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:link-autorizacao-ia:v1', 32)));
const chaveDoEmail = () => (chaveEmail ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:email-autorizacao-ia:v1', 32)));
const uuidBytes = (u: string) => Buffer.from(u.replace(/-/g, ''), 'hex');
const bytesUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const mac = (corpo: Buffer, email: string | null) => {
  const h = createHmac('sha256', chaveDoLink()).update(corpo);
  if (email !== null) h.update(createHash('sha256').update(normalizarEmailDoLink(email), 'utf8').digest());
  return h.digest().subarray(0, 16);
};

/** RN-107: o HMAC do e-mail para onde o link foi (nunca o e-mail em claro) — 43 caracteres base64url. */
export const emailHmac = (email: string): string => createHmac('sha256', chaveDoEmail()).update(normalizarEmailDoLink(email), 'utf8').digest('base64url');

export function assinarLinkPedido(l: { tenantId: string; patientId: string; emitidoEm: Date; email: string }): string {
  const corpo = Buffer.alloc(38);
  corpo.writeUInt8(VERSAO, 0);
  corpo.writeUInt8(TIPO_PEDIDO, 1);
  uuidBytes(l.tenantId).copy(corpo, 2);
  uuidBytes(l.patientId).copy(corpo, 18);
  corpo.writeUInt32BE(Math.floor(l.emitidoEm.getTime() / 1000), 34);
  return Buffer.concat([corpo, mac(corpo, l.email)]).toString('base64url'); // 54 bytes → 72 caracteres
}

export function assinarLinkRetirada(l: { tenantId: string; patientId: string; autorizacaoId: string }): string {
  const corpo = Buffer.alloc(50);
  corpo.writeUInt8(VERSAO, 0);
  corpo.writeUInt8(TIPO_RETIRADA, 1);
  uuidBytes(l.tenantId).copy(corpo, 2);
  uuidBytes(l.patientId).copy(corpo, 18);
  uuidBytes(l.autorizacaoId).copy(corpo, 34);
  return Buffer.concat([corpo, mac(corpo, null)]).toString('base64url'); // 66 bytes → 88 caracteres
}

export type LinkDecodificado =
  | { tipo: 'pedido'; tenantId: string; patientId: string; emitidoEm: Date }
  | { tipo: 'retirada'; tenantId: string; patientId: string; autorizacaoId: string };

/**
 * Formato, versão e tipo; os ids devolvidos AINDA NÃO estão autenticados: quem lê carrega o paciente (no contexto dele) e
 * chama `confere(email atual)` — no pedido, o MAC com o e-mail; na retirada, o e-mail é ignorado.
 */
export function lerLinkAutorizacao(token: unknown): (LinkDecodificado & { confere: (email: string | null) => boolean }) | null {
  if (typeof token !== 'string' || !/^(?:[A-Za-z0-9_-]{72}|[A-Za-z0-9_-]{88})$/.test(token)) return null;
  const b = Buffer.from(token, 'base64url');
  if (b.toString('base64url') !== token || b.readUInt8(0) !== VERSAO) return null;
  const tipo = b.readUInt8(1);
  const tenantId = bytesUuid(b.subarray(2, 18));
  const patientId = bytesUuid(b.subarray(18, 34));
  if (tipo === TIPO_PEDIDO && b.length === 54) {
    const corpo = b.subarray(0, 38);
    return { tipo: 'pedido', tenantId, patientId, emitidoEm: new Date(corpo.readUInt32BE(34) * 1000), confere: (email) => !!email && timingSafeEqual(mac(corpo, email), b.subarray(38)) };
  }
  if (tipo === TIPO_RETIRADA && b.length === 66) {
    const corpo = b.subarray(0, 50);
    return { tipo: 'retirada', tenantId, patientId, autorizacaoId: bytesUuid(corpo.subarray(34, 50)), confere: () => timingSafeEqual(mac(corpo, null), b.subarray(50)) };
  }
  return null;
}

export const urlDoLinkAutorizacao = (appUrl: string, token: string) => urlDoApp(appUrl, `/autorizacao-ia/${token}`);

const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const [QUATRO, CINCO, MASCARA] = [BigInt(4), BigInt(5), BigInt(31)];
/**
 * US-108 / RN-107: o código de referência do termo impresso — HMAC curto de tenant, paciente e versão, 12 caracteres em
 * base32 Crockford (o alfabeto do código dos documentos), "XXXX-XXXX-XXXX". A nutricionista confere na foto antes de salvar.
 */
export function codigoDeReferencia(tenantId: string, patientId: string, versao: string): string {
  let n = createHmac('sha256', chaveDoLink()).update(`referencia:${tenantId}:${patientId}:${versao}`).digest().readBigUInt64BE() >> QUATRO;
  let s = '';
  for (let i = 0; i < 12; i++) {
    s = ALFABETO[Number(n & MASCARA)] + s;
    n >>= CINCO;
  }
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}
```

Run: `pnpm vitest run src/modules/ia/autorizacao-token.test.ts`
Expected: PASS.

- [ ] **Step 3: Os testes que falham — escrita e telas**

Criar `src/modules/ia/autorizacao-escrita.test.ts`:

```ts
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, IA_TESTE, iaPronta, PDF_MINIMO } from '../../../test/ia';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { auditLog, iaAutorizacoes, patients, storedFiles, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { inicioDoDia } from '@/modules/agenda/fuso';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { MSG_COTA_ESGOTADA } from '@/modules/plataforma/armazenamento';
import {
  AutorizacaoError, autorizarNoApp, blocoIaDoApp, caminhoDoTermo, enviarPedidoPorEmail, painelDaAutorizacao, registrarTermoEmPapel, retirarNoApp, secaoIaVisivel,
} from './autorizacao';
import { lerLinkAutorizacao } from './autorizacao-token';
import { MSG_AUTORIZACAO, MSG_FALHA, MSG_IA } from './constantes';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-ia-esc-'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
  rmSync(dataDir, { recursive: true, force: true });
});
const PERFIL = { nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' };
async function cenario(o: { perfil?: boolean; ia?: boolean } = {}) {
  const T = await novoTenant(app.db);
  if (o.ia !== false) await iaPronta(app.db, T.tenantId);
  if (o.perfil !== false) await app.db.update(tenants).set(PERFIL).where(eq(tenants.id, T.tenantId));
  const p = await novoPaciente(app.db, T.ctx);
  const conta = randomUUID();
  const P = ctxPaciente(T.tenantId, p.id, conta);
  const deps = (extra: Partial<Parameters<typeof autorizarNoApp>[1]> = {}) => ({ ia: IA_TESTE, appUrl: 'https://app.test', db: app.db, dataDir, ...extra });
  const eventos = () => withTenant(T.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, p.id)), app.db);
  return { T, p, P, conta, deps, eventos };
}
const erros = (pr: Promise<unknown>) => pr.then(() => null, (e: unknown) => (e instanceof AutorizacaoError ? e.erros : e));

describe('US-106 — autorizar no app', () => {
  it('grava canal app, a conta, o IP e o user-agent (até 300), versão, os três usos e o destino; manda a confirmação com o link de retirada', async () => {
    const { p, P, conta, deps, eventos } = await cenario();
    expect(await autorizarNoApp(P, deps({ ip: '203.0.113.9', userAgent: 'U'.repeat(400) }))).toBe('registrada');
    const [e] = await eventos();
    expect(e).toMatchObject({ evento: 'autorizou', canal: 'app', registradoPor: conta, ip: '203.0.113.9', versao: '0.1-provisorio', destino: 'teste', usos: ['leitura_laudos', 'resumo_historico', 'rascunho_plano'] });
    expect(e.userAgent).toHaveLength(300);
    expect(e.em.getTime()).toBe(e.registradoEm.getTime());
    const [m] = await emailsNaFila('autorizacao_ia_confirmada', p.email!);
    expect(m).toMatchObject({ consultorio: expect.any(String), destino: 'Provedor de teste', versao: '0.1-provisorio' });
    const token = m.link.split('/autorizacao-ia/')[1];
    expect(lerLinkAutorizacao(token)).toMatchObject({ tipo: 'retirada', autorizacaoId: e.id });
    expect(await autorizarNoApp(P, deps())).toBe('ja_vigente'); // clique duplo: nada novo
    expect(await eventos()).toHaveLength(1);
  });

  it('D10: com a IA não ativa no consultório → indisponível; perfil profissional incompleto → o texto do desvio 7', async () => {
    const semIa = await cenario({ ia: false });
    expect(await erros(autorizarNoApp(semIa.P, semIa.deps()))).toEqual({ geral: MSG_IA.indisponivel });
    const semPerfil = await cenario({ perfil: false });
    expect(await erros(autorizarNoApp(semPerfil.P, semPerfil.deps()))).toEqual({ geral: MSG_AUTORIZACAO.perfilIncompleto });
    expect(await semPerfil.eventos()).toHaveLength(0);
  });
});

describe('US-109 — retirar no app', () => {
  it('grava a retirada (canal app) e enfileira o job ia-retirada na mesma transação; sem nada a retirar, nada', async () => {
    const { T, p, P, conta, deps, eventos } = await cenario();
    expect(await retirarNoApp(P, deps())).toBe('nada_a_retirar');
    await autorizarNoApp(P, deps());
    expect(await retirarNoApp(P, deps({ ip: '203.0.113.9' }))).toBe('retirada');
    const ret = (await eventos()).find((e) => e.evento === 'retirou')!;
    expect(ret).toMatchObject({ canal: 'app', registradoPor: conta, ip: '203.0.113.9' });
    const jobs = await (await getBoss()).findJobs<{ tenantId: string; patientId: string; retiradaId: string }>('ia-retirada');
    expect(jobs.find((j) => j.data.retiradaId === ret.id)?.data).toEqual({ tenantId: T.tenantId, patientId: p.id, retiradaId: ret.id });
    expect(await retirarNoApp(P, deps())).toBe('nada_a_retirar');
  });

  it('a retirada funciona com a IA desativada no consultório (US-106 "Retirar sempre possível")', async () => {
    const { T, P, deps } = await cenario();
    await autorizarNoApp(P, deps());
    await app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, T.tenantId));
    expect(await retirarNoApp(P, deps())).toBe('retirada');
  });
});

describe('US-105 — pedido por e-mail', () => {
  it('grava pedido_email (canal link, quem pediu, HMAC do e-mail) e enfileira o e-mail com o link de 7 dias; o segundo é recusado enquanto o link vale', async () => {
    const { T, p, deps, eventos } = await cenario();
    const agora = new Date();
    const { validoAte } = await enviarPedidoPorEmail(T.ctx, p.id, deps({ agora }));
    expect(validoAte.getTime() - agora.getTime()).toBe(7 * 86_400_000);
    const [e] = await eventos();
    expect(e).toMatchObject({ evento: 'pedido_email', canal: 'link', registradoPor: T.nutriId, versao: '0.1-provisorio', ip: null });
    expect(e.emailHmac).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [m] = await emailsNaFila('autorizacao_ia', p.email!);
    expect(lerLinkAutorizacao(m.link.split('/autorizacao-ia/')[1])).toMatchObject({ tipo: 'pedido', tenantId: T.tenantId, patientId: p.id });
    const r = await erros(enviarPedidoPorEmail(T.ctx, p.id, deps()));
    expect(r).toEqual({ geral: expect.stringMatching(/^Já há um pedido por e-mail válido até \d{2}\/\d{2}\/\d{4}\. Aguarde a resposta do paciente ou registre o termo em papel\.$/) });
  });

  it('D13: com o e-mail corrigido, o pedido antigo (link morto) não bloqueia o novo', async () => {
    const { T, p, deps, eventos } = await cenario();
    await enviarPedidoPorEmail(T.ctx, p.id, deps());
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ email: `novo-${p.id.slice(0, 8)}@ex.com` }).where(eq(patients.id, p.id)), app.db);
    await enviarPedidoPorEmail(T.ctx, p.id, deps());
    expect((await eventos()).filter((e) => e.evento === 'pedido_email')).toHaveLength(2);
  });

  it('sem e-mail → "Cadastre o e-mail…"; arquivado → indisponível; bloqueado → PacienteBloqueadoError; nada gravado', async () => {
    const { T, deps } = await cenario();
    const semEmail = await novoPaciente(app.db, T.ctx, { email: null });
    expect(await erros(enviarPedidoPorEmail(T.ctx, semEmail.id, deps()))).toEqual({ geral: MSG_AUTORIZACAO.semEmail });
    const arquivado = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    expect(await erros(enviarPedidoPorEmail(T.ctx, arquivado.id, deps()))).toEqual({ geral: MSG_FALHA.paciente_indisponivel });
    const bloqueado = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(enviarPedidoPorEmail(T.ctx, bloqueado.id, deps())).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });
});

describe('US-108 — termo em papel (RNF-111 f)', () => {
  it('arquivo e linha na mesma transação: canal papel, em = início do dia informado, o arquivo do tipo novo; confirmação ao e-mail do paciente', async () => {
    const { T, p, deps, eventos } = await cenario();
    const hoje = hojeNoFuso('America/Sao_Paulo');
    const id = await registrarTermoEmPapel(T.ctx, p.id, { data: hoje, confirmacao: true, arquivo: PDF_MINIMO }, deps());
    const [e] = await eventos();
    expect(e).toMatchObject({ id, evento: 'autorizou', canal: 'papel', registradoPor: T.nutriId, ip: null, destino: 'teste' });
    expect(e.em.getTime()).toBe(inicioDoDia(hoje, 'America/Sao_Paulo').getTime());
    const [f] = await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, e.arquivoPath!)), app.db);
    expect(f).toMatchObject({ tipo: 'ia_autorizacao_termo', patientId: p.id });
    expect(await emailsNaFila('autorizacao_ia_confirmada', p.email!)).toHaveLength(1);
  });

  it('faltou arquivo, confirmação ou data válida (futura, antes da versão, inválida); arquivo fora do formato; nada gravado', async () => {
    const { T, p, deps, eventos } = await cenario();
    expect(await erros(registrarTermoEmPapel(T.ctx, p.id, { data: '2999-01-01', confirmacao: false, arquivo: null }, deps()))).toEqual({
      arquivo: MSG_AUTORIZACAO.faltouArquivo, confirmacao: MSG_AUTORIZACAO.faltouConfirmacao, data: MSG_AUTORIZACAO.dataInvalida,
    });
    for (const data of ['2999-01-01', '2026-10-08', '2026-02-30', 'ontem']) {
      expect((await erros(registrarTermoEmPapel(T.ctx, p.id, { data, confirmacao: true, arquivo: PDF_MINIMO }, deps())) as Record<string, string>).data, data).toBe(MSG_AUTORIZACAO.dataInvalida);
    }
    const hoje = hojeNoFuso('America/Sao_Paulo');
    expect(await erros(registrarTermoEmPapel(T.ctx, p.id, { data: hoje, confirmacao: true, arquivo: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }, deps()))).toEqual({ arquivo: MSG_AUTORIZACAO.arquivoInvalido });
    expect(await erros(registrarTermoEmPapel(T.ctx, p.id, { data: hoje, confirmacao: true, arquivo: Buffer.alloc(20 * 1024 * 1024 + 1) }, deps()))).toEqual({ arquivo: MSG_AUTORIZACAO.arquivoInvalido });
    expect(await eventos()).toHaveLength(0);
  });

  it('a linha falha depois do arquivo → nem a linha nem o arquivo ficam (tudo ou nada); paciente bloqueado no meio → nada', async () => {
    const { T, p, deps, eventos } = await cenario();
    const hoje = hojeNoFuso('America/Sao_Paulo');
    const antes = readdirSync(dataDir, { recursive: true }).length;
    await expect(registrarTermoEmPapel(T.ctx, p.id, { data: hoje, confirmacao: true, arquivo: PDF_MINIMO }, deps({ depoisDaLinha: async () => { throw new Error('falha simulada'); } }))).rejects.toThrow('falha simulada');
    expect(await eventos()).toHaveLength(0);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(and(eq(storedFiles.patientId, p.id), eq(storedFiles.tipo, 'ia_autorizacao_termo'))), app.db)).toHaveLength(0);
    expect(readdirSync(dataDir, { recursive: true }).length).toBe(antes);
    const bloqueado = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    await expect(registrarTermoEmPapel(T.ctx, bloqueado.id, { data: hoje, confirmacao: true, arquivo: PDF_MINIMO }, deps())).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('armazenamento esgotado → o texto da US-108, nada registrado', async () => {
    const { T, p, deps, eventos } = await cenario();
    await app.db.update(tenants).set({ armazenamentoBytes: 5 * 1024 ** 3 }).where(eq(tenants.id, T.tenantId));
    expect(await erros(registrarTermoEmPapel(T.ctx, p.id, { data: hojeNoFuso('America/Sao_Paulo'), confirmacao: true, arquivo: PDF_MINIMO }, deps()))).toEqual({ geral: MSG_COTA_ESGOTADA });
    expect(await eventos()).toHaveLength(0);
  });

  it('"Ver termo assinado": o caminho com auditRead (entidade ia_autorizacao); de outro paciente → null, sem auditoria', async () => {
    const { T, p, deps } = await cenario();
    const id = await registrarTermoEmPapel(T.ctx, p.id, { data: hojeNoFuso('America/Sao_Paulo'), confirmacao: true, arquivo: PDF_MINIMO }, deps());
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await caminhoDoTermo(T.ctx, outro.id, id, app.db)).toBeNull();
    expect(await caminhoDoTermo(T.ctx, p.id, id, app.db)).toMatch(new RegExp(`^${T.tenantId}/ia_autorizacao_termo/`));
    const lidas = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'ia_autorizacao'), eq(auditLog.acao, 'ler'))), app.db);
    expect(lidas).toEqual([expect.objectContaining({ entidadeId: id, patientId: p.id, actorUserId: T.nutriId })]);
  });
});

describe('US-105 — dados da seção "Uso de IA" e do bloco do app', () => {
  it('eventos do mais recente ao mais antigo, pedido aberto, alerta de e-mail trocado, código de referência', async () => {
    const { T, p, deps } = await cenario();
    await enviarPedidoPorEmail(T.ctx, p.id, deps());
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, { emailHmac: 'hmac-de-outro-email' }); // autorizou pelo link de outro e-mail
    const painel = await painelDaAutorizacao(T.ctx, p, 'teste', { db: app.db });
    expect(painel.eventos.map((e) => e.evento)).toEqual(['autorizou', 'pedido_email']);
    expect(painel.situacao.tipo).toBe('vigente');
    expect(painel.pedidoAbertoAte).toBeInstanceOf(Date);
    expect(painel.alertaEmailTrocado).toBe(true);
    expect(painel.temRegistro).toBe(true);
    expect(painel.codigoDeReferencia).toMatch(/^.{4}-.{4}-.{4}$/);
  });

  it('secaoIaVisivel e blocoIaDoApp seguem a US-105 "Quando a seção aparece" e a US-106 "Consultório sem IA" (desvio 8)', async () => {
    expect(secaoIaVisivel('ausente', { iaLiberada: true, iaAditivoVersao: '0.2-provisorio' }, true)).toBe(false);
    expect(secaoIaVisivel('fake', { iaLiberada: false, iaAditivoVersao: null }, false)).toBe(false);
    expect(secaoIaVisivel('fake', { iaLiberada: false, iaAditivoVersao: null }, true)).toBe(true);
    expect(secaoIaVisivel('emergencia', { iaLiberada: false, iaAditivoVersao: '0.2-provisorio' }, false)).toBe(true);
    const { T, P } = await cenario();
    const [tenant] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    expect(await blocoIaDoApp(P, tenant, { ...IA_TESTE, modo: 'ausente' }, app.db)).toBeNull();
    expect(await blocoIaDoApp(P, tenant, IA_TESTE, app.db)).toEqual({ situacao: { tipo: 'nunca' }, podeDecidir: true });
    await app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, T.tenantId));
    const [semIa] = await app.db.select().from(tenants).where(eq(tenants.id, T.tenantId));
    expect(await blocoIaDoApp(P, semIa, IA_TESTE, app.db)).toBeNull();
  });
});
```

Run: `pnpm vitest run src/modules/ia/autorizacao-escrita.test.ts`
Expected: FAIL (as funções de escrita não existem).

- [ ] **Step 4: A escrita e os dados das telas**

Em `src/modules/ia/autorizacao.ts`, os imports passam a:

```ts
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaAutorizacoes, patients, tenants, type IaAutorizacaoRow, type PatientRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getBoss } from '@/jobs/boss';
import { inicioDoDia } from '@/modules/agenda/fuso';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { dataValida, formatarDataNoFuso, hojeNoFuso } from '@/modules/pacientes/datas';
import { auditRead } from '@/modules/plataforma/audit';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, salvarArquivo, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { assinarLinkPedido, assinarLinkRetirada, codigoDeReferencia, emailHmac, urlDoLinkAutorizacao } from './autorizacao-token';
import { cancelarTarefas } from './cancelar';
import {
  DESTINO_ROTULO, JANELA_EMAIL_TROCADO_MS, MSG_AUTORIZACAO, MSG_FALHA, MSG_IA, TERMO_MAX_BYTES, USOS_IA, VALIDADE_PEDIDO_MS,
  type CanalAutorizacao, type DestinoIA, type EventoAutorizacao, type MotivoFalha, type UsoIA,
} from './constantes';
import { estadoIaDoTenant, type ConfigIA, type ModoIA } from './modo';
import { AUTORIZACAO_IA_VERSAO, AUTORIZACAO_IA_VERSAO_DATA, AUTORIZACAO_IA_VERSAO_MIN, responsavelDoTenant, versaoAtende } from './textos-legais';
```

e, no fim do arquivo:

```ts
/** Erros com o texto pronto para a tela, por campo (`geral`, `arquivo`, `data`, `confirmacao`). */
export class AutorizacaoError extends Error {
  override name = 'AutorizacaoError';
  constructor(readonly erros: Record<string, string>) {
    super(Object.values(erros)[0] ?? 'autorização de IA recusada');
  }
}

export type DepsAutorizacao = {
  ia: ConfigIA;
  appUrl: string;
  db?: Db;
  agora?: Date;
  boss?: PgBoss;
  dataDir?: string;
  ip?: string | null;
  userAgent?: string | null;
  /** Só nos testes (RNF-111 f): falha depois de gravar a linha do termo, dentro da transação do arquivo. */
  depoisDaLinha?: (tx: Tx) => Promise<unknown>;
};
const userAgent = (s: string | null | undefined) => (s ? s.slice(0, 300) : null);

/** D10: pedir e decidir só com a IA ativa no consultório (a retenção zero não é exigida aqui) e com o perfil completo (desvio 7). */
function destinoParaPedir(t: TenantRow | undefined, ia: ConfigIA): DestinoIA {
  if (!t || estadoIaDoTenant(t, ia.modo) !== 'ativa' || !ia.destino) throw new AutorizacaoError({ geral: MSG_IA.indisponivel });
  if (!responsavelDoTenant(t)) throw new AutorizacaoError({ geral: MSG_AUTORIZACAO.perfilIncompleto });
  return ia.destino;
}

/**
 * US-107 / US-108 / US-106: o e-mail "Você autorizou o uso de inteligência artificial" com o link de RETIRADA (D11), na
 * transação da autorização (o job vai cifrado). Sem e-mail no cadastro, nada (o papel sem e-mail tem a forma de retirar própria).
 */
export async function enfileirarConfirmacao(
  tx: Tx,
  o: { tenantId: string; patientId: string; autorizacaoId: string; para: string | null; consultorio: string; destino: DestinoIA; appUrl: string },
): Promise<void> {
  if (!o.para) return;
  const link = urlDoLinkAutorizacao(o.appUrl, assinarLinkRetirada({ tenantId: o.tenantId, patientId: o.patientId, autorizacaoId: o.autorizacaoId }));
  await enqueueEmail({ tipo: 'autorizacao_ia_confirmada', para: o.para, consultorio: o.consultorio, destino: DESTINO_ROTULO[o.destino], versao: AUTORIZACAO_IA_VERSAO, link }, { tenantId: o.tenantId, tx });
}

const sessaoDePacienteComConta = (ctx: TenantContext) => ctx.role === 'paciente' && !!ctx.patientId && !!ctx.actorUserId && !ctx.semConta;

/**
 * US-106 "Autorizo o envio para fora do Brasil" no app: sessão de paciente com conta; o paciente travado (FOR UPDATE,
 * PACIENTE_ESCREVE.patients) antes de ler a situação e gravar — a política paciente_autorizacao_propria confere a conta.
 * Já vigente (clique duplo, outra aba) → nada novo.
 */
export async function autorizarNoApp(ctx: TenantContext, deps: DepsAutorizacao): Promise<'registrada' | 'ja_vigente'> {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('autorizarNoApp: só a sessão de paciente com conta');
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select().from(patients).where(eq(patients.id, ctx.patientId!)).for('update');
      if (!p || p.status !== 'ativo' || p.anonimizadoEm) throw new AutorizacaoError({ geral: MSG_IA.indisponivel });
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
      const destino = destinoParaPedir(t, deps.ia);
      if ((await autorizacaoDoPaciente(tx, p.id, destino)).tipo === 'vigente') return 'ja_vigente';
      const [a] = await tx
        .insert(iaAutorizacoes)
        .values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'autorizou', versao: AUTORIZACAO_IA_VERSAO, usos: [...USOS_IA], destino, canal: 'app', registradoPor: ctx.actorUserId!, ip: deps.ip ?? null, userAgent: userAgent(deps.userAgent) })
        .returning({ id: iaAutorizacoes.id });
      await enfileirarConfirmacao(tx, { tenantId: ctx.tenantId, patientId: p.id, autorizacaoId: a.id, para: p.email, consultorio: t!.nomeExibicao, destino, appUrl: deps.appUrl });
      return 'registrada';
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-109 "Retirar autorização" no app (RN-108): o evento `retirou` (canal app) e o job `ia-retirada` NA MESMA transação
 * (`boss.send` com a transação, como enqueueEmail) — a sessão de paciente não alcança ia_tarefas. Funciona com a IA
 * desativada, bloqueada ou em emergência ("Retirar sempre possível"). Sem autorização a retirar → nada.
 */
export async function retirarNoApp(ctx: TenantContext, deps: Pick<DepsAutorizacao, 'db' | 'boss' | 'ip' | 'userAgent'>): Promise<'retirada' | 'nada_a_retirar'> {
  if (!sessaoDePacienteComConta(ctx)) throw new Error('retirarNoApp: só a sessão de paciente com conta');
  const boss = deps.boss ?? (await getBoss());
  return withTenant(
    ctx,
    async (tx) => {
      const [p] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, ctx.patientId!)).for('update');
      if (!p) return 'nada_a_retirar';
      const s = await autorizacaoDoPaciente(tx, p.id, null);
      if (s.tipo === 'nunca' || s.tipo === 'retirada') return 'nada_a_retirar';
      const [r] = await tx
        .insert(iaAutorizacoes)
        .values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'retirou', canal: 'app', registradoPor: ctx.actorUserId!, ip: deps.ip ?? null, userAgent: userAgent(deps.userAgent) })
        .returning({ id: iaAutorizacoes.id });
      const job = await boss.send('ia-retirada', { tenantId: ctx.tenantId, patientId: p.id, retiradaId: r.id }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou a retirada da autorização de IA');
      return 'retirada';
    },
    deps.db ?? getDb(),
  );
}

/** D13: o pedido aberto é o último `pedido_email` com menos de 7 dias e para o e-mail ATUAL (mesmo HMAC). */
function fimDoPedidoAberto(ultimo: { registradoEm: Date; emailHmac: string | null } | undefined, hmacAtual: string | null): Date | null {
  return ultimo && hmacAtual && ultimo.emailHmac === hmacAtual ? new Date(ultimo.registradoEm.getTime() + VALIDADE_PEDIDO_MS) : null;
}

/**
 * US-105 "Enviar pedido de autorização por e-mail": o evento `pedido_email` (canal link, quem pediu, HMAC do e-mail) e o
 * e-mail com o link de 7 dias (US-107), na mesma transação, com o paciente travado (dois cliques se enfileiram). Um pedido
 * aberto por vez (D13). Paciente bloqueado → PacienteBloqueadoError; arquivado → indisponível; sem e-mail → o texto da US-105.
 */
export async function enviarPedidoPorEmail(ctx: TenantContext, patientId: string, deps: DepsAutorizacao): Promise<{ validoAte: Date }> {
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const p = await carregarPacienteParaEscrita(tx, patientId);
      if (p.status !== 'ativo') throw new AutorizacaoError({ geral: MSG_FALHA.paciente_indisponivel });
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
      destinoParaPedir(t, deps.ia);
      if (!p.email) throw new AutorizacaoError({ geral: MSG_AUTORIZACAO.semEmail });
      const hmac = emailHmac(p.email);
      const [ultimo] = await tx
        .select({ registradoEm: iaAutorizacoes.registradoEm, emailHmac: iaAutorizacoes.emailHmac })
        .from(iaAutorizacoes)
        .where(and(eq(iaAutorizacoes.patientId, p.id), eq(iaAutorizacoes.evento, 'pedido_email')))
        .orderBy(desc(iaAutorizacoes.registradoEm))
        .limit(1);
      const aberto = fimDoPedidoAberto(ultimo, hmac);
      if (aberto && aberto > agora) throw new AutorizacaoError({ geral: MSG_AUTORIZACAO.pedidoAberto(formatarDataNoFuso(aberto, t!.fuso)) });
      await tx.insert(iaAutorizacoes).values({ tenantId: ctx.tenantId, patientId: p.id, evento: 'pedido_email', versao: AUTORIZACAO_IA_VERSAO, canal: 'link', registradoPor: ctx.actorUserId!, emailHmac: hmac });
      const token = assinarLinkPedido({ tenantId: ctx.tenantId, patientId: p.id, emitidoEm: agora, email: p.email });
      await enqueueEmail({ tipo: 'autorizacao_ia', para: p.email, consultorio: t!.nomeExibicao, link: urlDoLinkAutorizacao(deps.appUrl, token) }, { tenantId: ctx.tenantId, tx });
      return { validoAte: new Date(agora.getTime() + VALIDADE_PEDIDO_MS) };
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-108 "Guardar o termo assinado" (RN-107, regra 9): o arquivo pelo salvarArquivo (tipo ia_autorizacao_termo, do paciente,
 * conta na cota), com o paciente travado no `antesDaReserva` e a linha `autorizou` (canal papel, em = início do dia
 * informado, D16) no `registrar` — ordem paciente → tenant → linha; tudo ou nada (RNF-111 f). Com e-mail, a confirmação
 * com o link de retirada. Devolve o id da autorização.
 */
export async function registrarTermoEmPapel(
  ctx: TenantContext,
  patientId: string,
  input: { data: unknown; confirmacao: boolean; arquivo: Buffer | null },
  deps: DepsAutorizacao,
): Promise<string> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const [t] = await db.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
  const erros: Record<string, string> = {};
  if (!input.arquivo?.length) erros.arquivo = MSG_AUTORIZACAO.faltouArquivo;
  else if (input.arquivo.length > TERMO_MAX_BYTES) erros.arquivo = MSG_AUTORIZACAO.arquivoInvalido;
  if (!input.confirmacao) erros.confirmacao = MSG_AUTORIZACAO.faltouConfirmacao;
  const data = typeof input.data === 'string' ? input.data.trim() : '';
  if (!t || !dataValida(data) || data > hojeNoFuso(t.fuso, agora) || data < AUTORIZACAO_IA_VERSAO_DATA) erros.data = MSG_AUTORIZACAO.dataInvalida;
  if (Object.keys(erros).length) throw new AutorizacaoError(erros);
  const destino = destinoParaPedir(t, deps.ia);
  let id = '';
  let email: string | null = null;
  try {
    await salvarArquivo(
      ctx,
      {
        tipo: 'ia_autorizacao_termo',
        conteudo: input.arquivo!,
        permitidos: ['pdf', 'jpg', 'png'],
        patientId,
        antesDaReserva: async (tx) => {
          const p = await carregarPacienteParaEscrita(tx, patientId); // bloqueado/anonimizado → PacienteBloqueadoError
          if (p.status !== 'ativo') throw new AutorizacaoError({ geral: MSG_FALHA.paciente_indisponivel });
          email = p.email;
        },
        registrar: async (tx, a) => {
          const [r] = await tx
            .insert(iaAutorizacoes)
            .values({ tenantId: ctx.tenantId, patientId, evento: 'autorizou', versao: AUTORIZACAO_IA_VERSAO, usos: [...USOS_IA], destino, canal: 'papel', em: inicioDoDia(data, t!.fuso), registradoPor: ctx.actorUserId!, arquivoPath: a.caminho })
            .returning({ id: iaAutorizacoes.id });
          id = r.id;
          await deps.depoisDaLinha?.(tx);
          await enfileirarConfirmacao(tx, { tenantId: ctx.tenantId, patientId, autorizacaoId: r.id, para: email, consultorio: t!.nomeExibicao, destino, appUrl: deps.appUrl });
        },
      },
      { db, dataDir: deps.dataDir },
    );
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) throw new AutorizacaoError({ arquivo: MSG_AUTORIZACAO.arquivoInvalido });
    if (e instanceof CotaEsgotadaError) throw new AutorizacaoError({ geral: MSG_COTA_ESGOTADA });
    throw e;
  }
  return id;
}

/** US-108 "Ver termo assinado": o caminho do arquivo (a rota assina a URL de 5 min), com auditRead (entidade ia_autorizacao, RN-107). */
export async function caminhoDoTermo(ctx: TenantContext, patientId: string, autorizacaoId: string, db: Db = getDb()): Promise<string | null> {
  if (!idValido(patientId) || !idValido(autorizacaoId)) return null;
  return withTenant(
    ctx,
    async (tx) => {
      const [a] = await tx
        .select({ caminho: iaAutorizacoes.arquivoPath })
        .from(iaAutorizacoes)
        .where(and(eq(iaAutorizacoes.id, autorizacaoId), eq(iaAutorizacoes.patientId, patientId), eq(iaAutorizacoes.canal, 'papel')));
      if (!a?.caminho) return null;
      await auditRead(tx, { entidade: 'ia_autorizacao', entidadeId: autorizacaoId, patientId });
      return a.caminho;
    },
    db,
  );
}

export type EventoNaTela = { id: string; evento: EventoAutorizacao; canal: CanalAutorizacao; versao: string | null; destino: DestinoIA | null; em: Date; temTermo: boolean };
export type PainelAutorizacao = { situacao: SituacaoAutorizacao; eventos: EventoNaTela[]; pedidoAbertoAte: Date | null; alertaEmailTrocado: boolean; codigoDeReferencia: string; temRegistro: boolean };

/**
 * US-105: os dados da seção "Uso de IA" (sem auditoria: não é dado de saúde, AUDIT_EXCEPTIONS). Eventos do mais recente ao
 * mais antigo; o pedido aberto (D13); o alerta "e-mail mudou pouco antes" — a autorização vigente pelo link com o HMAC
 * diferente do de algum pedido dos 30 dias anteriores (adaptação da §18.4); o código de referência do termo impresso.
 */
export async function painelDaAutorizacao(ctx: TenantContext, paciente: Pick<PatientRow, 'id' | 'email'>, destino: DestinoIA | null, o: { db?: Db; agora?: Date } = {}): Promise<PainelAutorizacao> {
  const agora = o.agora ?? new Date();
  const linhas = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ id: iaAutorizacoes.id, evento: iaAutorizacoes.evento, versao: iaAutorizacoes.versao, usos: iaAutorizacoes.usos, destino: iaAutorizacoes.destino, canal: iaAutorizacoes.canal, em: iaAutorizacoes.em, registradoEm: iaAutorizacoes.registradoEm, emailHmac: iaAutorizacoes.emailHmac, arquivoPath: iaAutorizacoes.arquivoPath })
        .from(iaAutorizacoes)
        .where(eq(iaAutorizacoes.patientId, paciente.id))
        .orderBy(desc(iaAutorizacoes.registradoEm), desc(iaAutorizacoes.id)),
    o.db ?? getDb(),
  );
  const decisao = linhas.find((l) => l.evento !== 'pedido_email') ?? null;
  const situacao = situacaoDaAutorizacao(decisao, destino);
  const fim = fimDoPedidoAberto(linhas.find((l) => l.evento === 'pedido_email'), paciente.email ? emailHmac(paciente.email) : null);
  const alertaEmailTrocado =
    situacao.tipo === 'vigente' && decisao!.canal === 'link' &&
    linhas.some((l) => l.evento === 'pedido_email' && l.registradoEm < decisao!.registradoEm && l.registradoEm.getTime() >= decisao!.registradoEm.getTime() - JANELA_EMAIL_TROCADO_MS && l.emailHmac !== decisao!.emailHmac);
  return {
    situacao,
    eventos: linhas.map((l) => ({ id: l.id, evento: l.evento as EventoAutorizacao, canal: l.canal as CanalAutorizacao, versao: l.versao, destino: l.destino as DestinoIA | null, em: l.em, temTermo: !!l.arquivoPath })),
    pedidoAbertoAte: fim && fim > agora ? fim : null,
    alertaEmailTrocado,
    codigoDeReferencia: codigoDeReferencia(ctx.tenantId, paciente.id, AUTORIZACAO_IA_VERSAO),
    temRegistro: linhas.length > 0,
  };
}

/** US-105 "Quando a seção aparece": com IA_PROVEDOR, se a admin liberou, se o consultório já ativou alguma vez, ou com registro do paciente. */
export function secaoIaVisivel(modo: ModoIA, tenant: Pick<TenantRow, 'iaLiberada' | 'iaAditivoVersao'>, temRegistro: boolean): boolean {
  if (modo === 'ausente') return false;
  return tenant.iaLiberada || tenant.iaAditivoVersao !== null || temRegistro;
}

export type BlocoIaApp = { situacao: SituacaoAutorizacao; podeDecidir: boolean };

/**
 * US-106 (desvio 8): o bloco em Eu › Privacidade — some sem IA_PROVEDOR; aparece com a IA ativa no consultório (e o perfil
 * completo, D10) ou com algum registro do paciente; "Ler e decidir" só com a IA ativa. A situação é a do vínculo aberto
 * (o ctx do paciente é o do consultório escolhido, US-106 "Mais de um consultório").
 */
export async function blocoIaDoApp(ctx: TenantContext, tenant: TenantRow, ia: ConfigIA, db: Db = getDb()): Promise<BlocoIaApp | null> {
  if (ia.modo === 'ausente' || !ctx.patientId) return null;
  const podeDecidir = estadoIaDoTenant(tenant, ia.modo) === 'ativa' && !!ia.destino && !!responsavelDoTenant(tenant);
  const { situacao, temRegistro } = await withTenant(
    ctx,
    async (tx) => {
      const ultimo = await ultimaDecisao(tx, ctx.patientId!);
      const [algum] = ultimo ? [ultimo] : await tx.select({ id: iaAutorizacoes.id }).from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, ctx.patientId!)).limit(1);
      return { situacao: situacaoDaAutorizacao(ultimo, ia.destino), temRegistro: !!algum };
    },
    db,
  );
  if (!podeDecidir && !temRegistro) return null;
  return { situacao, podeDecidir };
}
```

(Os imports `AUTORIZACAO_IA_VERSAO_MIN`, `versaoAtende`, `MotivoFalha`, `UsoIA` e `inArray` já estavam na parte da T4; manter um import só de cada.)

Em `src/modules/plataforma/audit.ts`, `ENTIDADE_ROTULO` ganha `ia_autorizacao: 'Autorização de IA',`.

- [ ] **Step 5: Os dois e-mails**

Em `src/email/types.ts`, antes de `exames_recebidos`:

```ts
  /** Plano 14A (US-105, US-107): o pedido de autorização de IA — `link` = /autorizacao-ia/<token> (sem login, 7 dias). Sem dado de saúde. */
  | { tipo: 'autorizacao_ia'; para: string; consultorio: string; link: string }
  /** Plano 14A (US-106 a US-108): a confirmação, com o resumo do que foi autorizado e o link de RETIRADA (não vence, D11). `destino` = o rótulo. */
  | { tipo: 'autorizacao_ia_confirmada'; para: string; consultorio: string; destino: string; versao: string; link: string }
```

Em `src/email/templates.tsx`, `import { DESTINO_ROTULO, MSG_AUTORIZACAO } from '@/modules/ia/constantes';` e, antes de `case 'exames_recebidos':`:

```tsx
    case 'autorizacao_ia':
      // US-107: só o consultório e o link; nada de saúde (desvio 9: corpo novo, vai ao advogado com a autorização)
      return simples(
        MSG_AUTORIZACAO.emailAssunto(msg.consultorio),
        [
          `${msg.consultorio} pede a sua autorização para usar uma ferramenta de inteligência artificial (IA) com os seus dados de saúde.`,
          'Leia o texto completo pelo botão abaixo e decida. Autorizar é opcional: recusar não muda nada no seu atendimento.',
          'O link vale por 7 dias.',
        ],
        { href: msg.link, rotulo: MSG_AUTORIZACAO.lerEDecidir },
      );
    case 'autorizacao_ia_confirmada':
      // US-107/US-108: o resumo do que foi autorizado e a retirada a qualquer momento (art. 8º, § 5º)
      return simples(
        MSG_AUTORIZACAO.confirmacaoAssunto,
        [
          `Você autorizou ${msg.consultorio} a usar inteligência artificial com os seus dados de saúde (texto da versão ${msg.versao}), só para: ler os laudos dos seus exames, resumir o seu histórico e montar um rascunho do seu plano alimentar.`,
          ...(msg.destino === DESTINO_ROTULO.teste ? [] : [`Destino dos dados: ${msg.destino}. Os seus dados saem do Brasil.`]),
          'Você pode retirar a autorização quando quiser, sem custo, pelo botão abaixo. Retirar não muda nada no seu atendimento.',
        ],
        { href: msg.link, rotulo: MSG_AUTORIZACAO.retirarALink },
      );
```

Em `src/email/render.test.ts`:

```ts
  it('autorizacao_ia: assunto com o consultório, botão "Ler e decidir" com o link; sem dado de saúde', () => {
    const r = renderEmail({ tipo: 'autorizacao_ia', para: 'p@x.dev', consultorio: 'Consultório Debby', link: 'https://app.test/autorizacao-ia/abc' });
    expect(r.subject).toBe('Consultório Debby: autorização para uso de inteligência artificial');
    expect(r.html).toContain('href="https://app.test/autorizacao-ia/abc"');
    expect(r.text).toContain('Ler e decidir');
    expect(r.text).toContain('recusar não muda nada no seu atendimento');
  });

  it('autorizacao_ia_confirmada: os três usos, a versão, o destino e o botão "Retirar a autorização"', () => {
    const r = renderEmail({ tipo: 'autorizacao_ia_confirmada', para: 'p@x.dev', consultorio: 'Consultório Debby', destino: 'Amazon Web Services (Claude), União Europeia', versao: '0.1-provisorio', link: 'https://app.test/autorizacao-ia/xyz' });
    expect(r.subject).toBe('Você autorizou o uso de inteligência artificial');
    for (const t of ['ler os laudos dos seus exames', 'resumir o seu histórico', 'rascunho do seu plano alimentar', '0.1-provisorio', 'União Europeia', 'saem do Brasil', 'Retirar a autorização']) expect(r.text).toContain(t);
    expect(r.html).toContain('href="https://app.test/autorizacao-ia/xyz"');
  });
```

- [ ] **Step 6: Rodar e conferir**

Run: `pnpm vitest run src/modules/ia src/email src/modules/plataforma/audit.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add src/modules/ia/autorizacao.ts src/modules/ia/autorizacao-token.ts src/modules/ia/autorizacao-token.test.ts src/modules/ia/autorizacao-escrita.test.ts \
  src/email/types.ts src/email/templates.tsx src/email/render.test.ts src/modules/plataforma/audit.ts
git commit -m "feat(ia): autorização no app, pedido por e-mail, termo em papel, retirada no app, links sem estado e os e-mails de pedido e confirmação (P14A-05)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 6: Link sem login — página `/autorizacao-ia/[token]`, autorizar e retirar pelo link (P14A-06)

**Revisão: completa (agente revisor-rls, lente de segurança)** — contexto de paciente sem conta (N7), MAC e validade, Turnstile, limite por IP, origem, nenhum dado de saúde na página, cabeçalhos `no-referrer`/`no-store`.

**Files:**
- Create: `src/modules/ia/autorizacao-link.ts`, `src/modules/ia/autorizacao-link.test.ts`, `src/app/autorizacao-ia/[token]/page.tsx`, `src/app/autorizacao-ia/[token]/decisao-form.tsx`, `src/app/api/autorizacao-ia/[token]/link.ts`, `src/app/api/autorizacao-ia/[token]/autorizar/route.ts`, `src/app/api/autorizacao-ia/[token]/retirar/route.ts`, `src/app/api/autorizacao-ia/[token]/link.test.ts`
- Modify: `src/db/tenant.ts` (`SEM_CONTA_PERMITIDOS`), `src/modules/agenda/limite-ip.ts` (o tipo `'autorizacao-ia-ip'` em `chaveDoLimite`), `next.config.ts` (cabeçalhos)

**Interfaces:**
- Consumes: `lerLinkAutorizacao`, `emailHmac` (T5), `autorizacaoDoPaciente`, `enfileirarConfirmacao` (T4/T5), `textoDaAutorizacao`, `responsavelDoTenant`, `MSG_AUTORIZACAO`, `VALIDADE_PEDIDO_MS`, `USOS_IA`, `estadoIaDoTenant`, `ConfigIA` (T2), `TextoLegalView` (T2), fila `ia-retirada` (T4), `consumirLimite`/`chaveDoLimite`, `depsDaRequisicao`/`lerJson`/`comoResposta`/`SEM_CACHE` (`src/app/api/n/[slug]/resposta.ts`), `mesmaOrigem`, `TurnstileWidget`, `Botao`, `Aviso`.
- Produces: `EstadoLinkIa`, `LinkIaError`, `DepsLinkIa`, `estadoDoLinkIa`, `autorizarPeloLink`, `retirarPeloLink`; as rotas `POST /api/autorizacao-ia/[token]/autorizar` e `/retirar`; a página `/autorizacao-ia/[token]`.

- [ ] **Step 1: Os testes que falham — o módulo**

Criar `src/modules/ia/autorizacao-link.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { autorizacaoNoBanco, IA_TESTE, iaPronta } from '../../../test/ia';
import { emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { iaAutorizacoes, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { autorizarPeloLink, estadoDoLinkIa, LinkIaError, retirarPeloLink, type DepsLinkIa } from './autorizacao-link';
import { assinarLinkPedido, assinarLinkRetirada, emailHmac } from './autorizacao-token';
import { MSG_AUTORIZACAO } from './constantes';
import { textoCorrido } from './textos-legais';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const PERFIL = { nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' };
let ip = 0;
const deps = (extra: Partial<DepsLinkIa> = {}): DepsLinkIa => ({
  ia: IA_TESTE, appUrl: 'https://app.test', db: app.db, ip: '203.0.113.50', ipDoLimite: `198.51.${Math.floor(Math.random() * 250)}.${++ip % 250}`,
  userAgent: 'Navegador de teste', verificarTurnstile: async (t) => (t === 'ok' ? 'ok' : 'invalido'), ...extra,
});
async function cenario() {
  const T = await novoTenant(app.db);
  await iaPronta(app.db, T.tenantId);
  await app.db.update(tenants).set(PERFIL).where(eq(tenants.id, T.tenantId));
  const p = await novoPaciente(app.db, T.ctx);
  const pedido = (emitidoEm = new Date()) => assinarLinkPedido({ tenantId: T.tenantId, patientId: p.id, emitidoEm, email: p.email! });
  const eventos = () => withTenant(T.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, p.id)), app.db);
  return { T, p, pedido, eventos };
}
const status = (pr: Promise<unknown>) => pr.then(() => null, (e: unknown) => (e instanceof LinkIaError ? [e.status, e.mensagem] : e));

describe('US-107 — o estado do link (GET não grava nada)', () => {
  it('decidir: o consultório e o texto inteiro da versão atual, com a forma de retirar do link; nada de saúde', async () => {
    const { T, pedido } = await cenario();
    const e = await estadoDoLinkIa(pedido(), deps());
    expect(e).toMatchObject({ tipo: 'decidir', consultorio: expect.any(String) });
    if (e.tipo !== 'decidir') throw new Error('estado');
    const texto = e.texto.paragrafos.map(textoCorrido).join(' ');
    expect(e.texto.titulo).toBe('Autorização para uso de inteligência artificial');
    expect(texto).toContain('Debora Silva (CRN-3 12345)');
    expect(texto).toContain('pelo link "Retirar a autorização" do e-mail de confirmação');
    expect(T.tenantId).toBeTruthy();
  });

  it('inválido: token adulterado, de outro paciente, com o e-mail corrigido, paciente bloqueado/arquivado, IA desativada; vencido: depois de 7 dias', async () => {
    const { T, p, pedido } = await cenario();
    const t = pedido();
    expect(await estadoDoLinkIa(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), deps())).toEqual({ tipo: 'invalido' });
    const outro = await novoPaciente(app.db, T.ctx);
    expect(await estadoDoLinkIa(assinarLinkPedido({ tenantId: T.tenantId, patientId: outro.id, emitidoEm: new Date(), email: p.email! }), deps())).toEqual({ tipo: 'invalido' });
    expect(await estadoDoLinkIa(pedido(new Date(Date.now() - 8 * 86_400_000)), deps())).toEqual({ tipo: 'expirado' });
    await app.db.update(tenants).set({ iaAtivadaEm: null }).where(eq(tenants.id, T.tenantId));
    expect(await estadoDoLinkIa(t, deps())).toEqual({ tipo: 'invalido' });
    await app.db.update(tenants).set({ iaAtivadaEm: new Date() }).where(eq(tenants.id, T.tenantId));
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ email: `trocado-${randomUUID().slice(0, 6)}@ex.com` }).where(eq(patients.id, p.id)), app.db);
    expect(await estadoDoLinkIa(t, deps())).toEqual({ tipo: 'invalido' });
  });
});

describe('US-107 — autorizar pelo link (RNF-111 e)', () => {
  it('grava canal link, sem conta, com IP, user-agent e o HMAC do e-mail; manda a confirmação; o estado vira "já autorizou"', async () => {
    const { p, pedido, eventos } = await cenario();
    const t = pedido();
    await autorizarPeloLink(t, { turnstile: 'ok' }, deps());
    const [e] = await eventos();
    expect(e).toMatchObject({ evento: 'autorizou', canal: 'link', registradoPor: null, ip: '203.0.113.50', userAgent: 'Navegador de teste', emailHmac: emailHmac(p.email!), destino: 'teste' });
    expect(await emailsNaFila('autorizacao_ia_confirmada', p.email!)).toHaveLength(1);
    expect(await estadoDoLinkIa(t, deps())).toMatchObject({ tipo: 'ja_autorizou' });
    await autorizarPeloLink(t, { turnstile: 'ok' }, deps()); // idempotente
    expect(await eventos()).toHaveLength(1);
  });

  it('sem Turnstile → 403; Turnstile fora → 503; acima de 20 por hora no mesmo IP → 429; nada gravado', async () => {
    const { pedido, eventos } = await cenario();
    expect(await status(autorizarPeloLink(pedido(), {}, deps()))).toEqual([403, MSG_AUTORIZACAO.robo]);
    expect(await status(autorizarPeloLink(pedido(), { turnstile: 'ok' }, deps({ verificarTurnstile: async () => 'indisponivel' })))).toEqual([503, MSG_AUTORIZACAO.turnstileFora]);
    const mesmoIp = deps();
    const t = 'x'.repeat(72); // inválido: consome o limite e cai no 410
    for (let i = 0; i < 20; i++) await autorizarPeloLink(t, { turnstile: 'ok' }, mesmoIp).catch(() => undefined);
    expect(await status(autorizarPeloLink(pedido(), { turnstile: 'ok' }, mesmoIp))).toEqual([429, MSG_AUTORIZACAO.muitasTentativas]);
    expect(await eventos()).toHaveLength(0);
  });

  it('vencido → 410 "Este link expirou…"; adulterado, de retirada ou com o e-mail corrigido → 410 "Este link não é mais válido…"', async () => {
    const { T, p, pedido, eventos } = await cenario();
    expect(await status(autorizarPeloLink(pedido(new Date(Date.now() - 8 * 86_400_000)), { turnstile: 'ok' }, deps()))).toEqual([410, MSG_AUTORIZACAO.linkExpirado]);
    expect(await status(autorizarPeloLink(assinarLinkRetirada({ tenantId: T.tenantId, patientId: p.id, autorizacaoId: randomUUID() }), { turnstile: 'ok' }, deps()))).toEqual([410, MSG_AUTORIZACAO.linkInvalido]);
    const t = pedido();
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ email: `trocado-${randomUUID().slice(0, 6)}@ex.com` }).where(eq(patients.id, p.id)), app.db);
    expect(await status(autorizarPeloLink(t, { turnstile: 'ok' }, deps()))).toEqual([410, MSG_AUTORIZACAO.linkInvalido]);
    expect(await eventos()).toHaveLength(0);
  });
});

describe('US-109 — retirar pelo link (RNF-111 i)', () => {
  it('o link de retirada vale depois dos 7 dias e com a IA desativada; grava canal link e enfileira o ia-retirada', async () => {
    const { T, p, eventos } = await cenario();
    const autorizacaoId = await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    await app.db.update(tenants).set({ iaAtivadaEm: null, iaLiberada: false }).where(eq(tenants.id, T.tenantId));
    const t = assinarLinkRetirada({ tenantId: T.tenantId, patientId: p.id, autorizacaoId });
    expect(await estadoDoLinkIa(t, deps())).toMatchObject({ tipo: 'retirar' });
    await retirarPeloLink(t, { turnstile: 'ok' }, deps());
    const ret = (await eventos()).find((e) => e.evento === 'retirou')!;
    expect(ret).toMatchObject({ canal: 'link', registradoPor: null, ip: '203.0.113.50', emailHmac: emailHmac(p.email!) });
    const jobs = await (await getBoss()).findJobs<{ retiradaId: string }>('ia-retirada');
    expect(jobs.some((j) => j.data.retiradaId === ret.id)).toBe(true);
    expect(await estadoDoLinkIa(t, deps())).toEqual({ tipo: 'nao_vigente' });
  });

  it('a autorização daquele link foi substituída (reautorizou) → 410 "Esta autorização já não está em vigor."', async () => {
    const { T, p } = await cenario();
    const antiga = await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    await autorizacaoNoBanco(app.db, T.tenantId, p.id, { evento: 'retirou' });
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    const t = assinarLinkRetirada({ tenantId: T.tenantId, patientId: p.id, autorizacaoId: antiga });
    expect(await status(retirarPeloLink(t, { turnstile: 'ok' }, deps()))).toEqual([410, MSG_AUTORIZACAO.naoVigente]);
  });

  it('com o link do pedido ainda válido também retira (US-109); vencido, não', async () => {
    const { T, p, pedido } = await cenario();
    await autorizacaoNoBanco(app.db, T.tenantId, p.id);
    expect(await status(retirarPeloLink(pedido(new Date(Date.now() - 8 * 86_400_000)), { turnstile: 'ok' }, deps()))).toEqual([410, MSG_AUTORIZACAO.linkExpirado]);
    await retirarPeloLink(pedido(), { turnstile: 'ok' }, deps());
    expect((await estadoDoLinkIa(pedido(), deps())).tipo).toBe('decidir');
  });
});
```

Run: `pnpm vitest run src/modules/ia/autorizacao-link.test.ts`
Expected: FAIL (o módulo não existe).

- [ ] **Step 2: O módulo do link**

Em `src/modules/agenda/limite-ip.ts`, acrescentar `'autorizacao-ia-ip'` à união de tipos de `chaveDoLimite`. Em `src/db/tenant.ts`, `SEM_CONTA_PERMITIDOS` ganha `'src/modules/ia/autorizacao-link.ts'` (em ordem alfabética, depois de `convite-paciente.ts`).

Criar `src/modules/ia/autorizacao-link.ts`:

```ts
import { eq, sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { iaAutorizacoes, patients, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { chaveDoLimite, consumirLimite } from '@/modules/agenda/limite-ip';
import { autorizacaoDoPaciente, enfileirarConfirmacao } from './autorizacao';
import { emailHmac, lerLinkAutorizacao } from './autorizacao-token';
import { MSG_AUTORIZACAO, USOS_IA, VALIDADE_PEDIDO_MS } from './constantes';
import { estadoIaDoTenant, type ConfigIA } from './modo';
import { AUTORIZACAO_IA_VERSAO, responsavelDoTenant, textoDaAutorizacao, type TextoLegal } from './textos-legais';

/**
 * US-107 / US-109 (Plano 14A, RN-107): a autorização e a retirada pelo link do e-mail, SEM login — contexto de paciente
 * sem conta (`semConta`, N7; este arquivo está em SEM_CONTA_PERMITIDOS). O GET da página não grava nada (leitores de link
 * dos provedores de e-mail fazem GET); os POSTs passam por Turnstile e limite por IP. A página não mostra dado de saúde:
 * só o consultório e o texto. Sem o código de 6 dígitos (decisão do dono, 08/10/2026).
 */
export type EstadoLinkIa =
  | { tipo: 'invalido' }
  | { tipo: 'expirado' }
  | { tipo: 'nao_vigente' }
  | { tipo: 'decidir'; consultorio: string; texto: TextoLegal }
  | { tipo: 'ja_autorizou'; consultorio: string; em: Date }
  | { tipo: 'retirar'; consultorio: string; em: Date };

export class LinkIaError extends Error {
  override name = 'LinkIaError';
  constructor(
    readonly status: number,
    readonly mensagem: string,
  ) {
    super(mensagem);
  }
}

export type DepsLinkIa = {
  ia: ConfigIA;
  appUrl: string;
  ip: string | null;
  ipDoLimite: string | null;
  userAgent: string | null;
  verificarTurnstile: (t: string | null) => Promise<'ok' | 'invalido' | 'indisponivel'>;
  db?: Db;
  agora?: Date;
  boss?: PgBoss;
};

const POR_HORA_IP = 20;
const ctxDo = (l: { tenantId: string; patientId: string }, ip: string | null): TenantContext => ({ tenantId: l.tenantId, role: 'paciente', patientId: l.patientId, semConta: true, ip });

type Link = NonNullable<ReturnType<typeof lerLinkAutorizacao>>;

/** O paciente do token (a RLS limita ao paciente e ao tenant do token) e o MAC; `travar` nas escritas (FOR UPDATE, como a retirada). */
async function lerNoContexto(tx: Tx, l: Link, ia: ConfigIA, travar: boolean) {
  const consulta = tx.select({ id: patients.id, email: patients.email, status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, l.patientId));
  const [p] = travar ? await consulta.for('update') : await consulta;
  if (!p || !l.confere(p.email)) return null;
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, l.tenantId));
  if (!t) return null;
  return { p, t, situacao: await autorizacaoDoPaciente(tx, p.id, ia.destino) };
}

/** US-107 "Link inválido": paciente que não está ativo, IA que não está ativa no consultório, sem provedor ou sem o perfil (D10). */
function pedidoUtilizavel(c: NonNullable<Awaited<ReturnType<typeof lerNoContexto>>>, ia: ConfigIA) {
  const resp = responsavelDoTenant(c.t);
  const ok = c.p.status === 'ativo' && !c.p.anonimizadoEm && estadoIaDoTenant(c.t, ia.modo) === 'ativa' && !!ia.destino && !!resp;
  return ok ? { resp: resp!, destino: ia.destino! } : null;
}
const vencido = (l: Link, agora: Date) => l.tipo === 'pedido' && agora.getTime() - l.emitidoEm.getTime() > VALIDADE_PEDIDO_MS;
/** Há uma autorização a retirar (vigente, de versão antiga ou de outro destino: o último evento é `autorizou`). */
const autorizacaoAtual = (s: Awaited<ReturnType<typeof autorizacaoDoPaciente>>) => (s.tipo === 'nunca' || s.tipo === 'retirada' ? null : s);

export async function estadoDoLinkIa(token: unknown, deps: DepsLinkIa): Promise<EstadoLinkIa> {
  const l = lerLinkAutorizacao(token);
  if (!l) return { tipo: 'invalido' };
  const agora = deps.agora ?? new Date();
  return withTenant(
    ctxDo(l, deps.ip),
    async (tx): Promise<EstadoLinkIa> => {
      const c = await lerNoContexto(tx, l, deps.ia, false);
      if (!c) return { tipo: 'invalido' };
      const consultorio = c.t.nomeExibicao;
      const atual = autorizacaoAtual(c.situacao);
      if (l.tipo === 'retirada') {
        // D11: não vence; vale enquanto aquela autorização for a decisão mais recente (com a IA desativada, inclusive)
        if (c.p.anonimizadoEm || !atual || atual.id !== l.autorizacaoId) return { tipo: 'nao_vigente' };
        return { tipo: 'retirar', consultorio, em: atual.em };
      }
      const u = pedidoUtilizavel(c, deps.ia);
      if (!u) return { tipo: 'invalido' };
      if (vencido(l, agora)) return { tipo: 'expirado' };
      if (c.situacao.tipo === 'vigente') return { tipo: 'ja_autorizou', consultorio, em: c.situacao.em };
      return { tipo: 'decidir', consultorio, texto: textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...u.resp, destino: u.destino, canal: 'link' })! };
    },
    deps.db ?? getDb(),
  );
}

/** Turnstile → limite por IP (20/h, como o link de documentos) — antes de abrir o token. */
async function conferirRobo(input: { turnstile?: unknown }, deps: DepsLinkIa): Promise<void> {
  const ts = await deps.verificarTurnstile(typeof input.turnstile === 'string' ? input.turnstile : null);
  if (ts === 'indisponivel') throw new LinkIaError(503, MSG_AUTORIZACAO.turnstileFora);
  if (ts !== 'ok') throw new LinkIaError(403, MSG_AUTORIZACAO.robo);
  if (!(await consumirLimite(deps.db ?? getDb(), chaveDoLimite('autorizacao-ia-ip', deps.ipDoLimite ?? 'sem-ip'), POR_HORA_IP, 3600, deps.agora ?? new Date()))) {
    throw new LinkIaError(429, MSG_AUTORIZACAO.muitasTentativas);
  }
}

/**
 * US-107 "Autorizo o envio para fora do Brasil" pelo link: o evento `autorizou` (canal link, sem conta, IP, user-agent e o
 * HMAC do e-mail para onde o link foi) com o paciente travado, e a confirmação com o link de retirada. Já vigente → nada.
 */
export async function autorizarPeloLink(token: unknown, input: { turnstile?: unknown }, deps: DepsLinkIa): Promise<void> {
  await conferirRobo(input, deps);
  const l = lerLinkAutorizacao(token);
  if (!l || l.tipo !== 'pedido') throw new LinkIaError(410, MSG_AUTORIZACAO.linkInvalido);
  const agora = deps.agora ?? new Date();
  await withTenant(
    ctxDo(l, deps.ip),
    async (tx) => {
      const c = await lerNoContexto(tx, l, deps.ia, true);
      const u = c && pedidoUtilizavel(c, deps.ia);
      if (!c || !u) throw new LinkIaError(410, MSG_AUTORIZACAO.linkInvalido);
      if (vencido(l, agora)) throw new LinkIaError(410, MSG_AUTORIZACAO.linkExpirado);
      if (c.situacao.tipo === 'vigente') return;
      const [a] = await tx
        .insert(iaAutorizacoes)
        .values({ tenantId: l.tenantId, patientId: c.p.id, evento: 'autorizou', versao: AUTORIZACAO_IA_VERSAO, usos: [...USOS_IA], destino: u.destino, canal: 'link', emailHmac: emailHmac(c.p.email!), ip: deps.ip, userAgent: deps.userAgent?.slice(0, 300) ?? null })
        .returning({ id: iaAutorizacoes.id });
      await enfileirarConfirmacao(tx, { tenantId: l.tenantId, patientId: c.p.id, autorizacaoId: a.id, para: c.p.email, consultorio: c.t.nomeExibicao, destino: u.destino, appUrl: deps.appUrl });
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-109 "Retirar autorização" pelo link — o de retirada (D11: não vence, vale só para a autorização daquele link, com a IA
 * desativada inclusive) ou o do pedido ainda válido (retira a autorização atual). O evento `retirou` (canal link) e o job
 * `ia-retirada` na mesma transação, com o paciente travado. Paciente anonimizado → link inválido.
 */
export async function retirarPeloLink(token: unknown, input: { turnstile?: unknown }, deps: DepsLinkIa): Promise<void> {
  await conferirRobo(input, deps);
  const l = lerLinkAutorizacao(token);
  if (!l) throw new LinkIaError(410, MSG_AUTORIZACAO.linkInvalido);
  const agora = deps.agora ?? new Date();
  const boss = deps.boss ?? (await getBoss());
  await withTenant(
    ctxDo(l, deps.ip),
    async (tx) => {
      const c = await lerNoContexto(tx, l, deps.ia, true);
      if (!c || c.p.anonimizadoEm) throw new LinkIaError(410, MSG_AUTORIZACAO.linkInvalido);
      if (vencido(l, agora)) throw new LinkIaError(410, MSG_AUTORIZACAO.linkExpirado);
      const atual = autorizacaoAtual(c.situacao);
      if (!atual || (l.tipo === 'retirada' && atual.id !== l.autorizacaoId)) throw new LinkIaError(410, MSG_AUTORIZACAO.naoVigente);
      const [r] = await tx
        .insert(iaAutorizacoes)
        .values({ tenantId: l.tenantId, patientId: c.p.id, evento: 'retirou', canal: 'link', emailHmac: c.p.email ? emailHmac(c.p.email) : null, ip: deps.ip, userAgent: deps.userAgent?.slice(0, 300) ?? null })
        .returning({ id: iaAutorizacoes.id });
      const job = await boss.send('ia-retirada', { tenantId: l.tenantId, patientId: c.p.id, retiradaId: r.id }, { db: fromDrizzle(tx, sql) });
      if (!job) throw new Error('A fila recusou a retirada da autorização de IA');
    },
    deps.db ?? getDb(),
  );
}
```

Run: `pnpm vitest run src/modules/ia/autorizacao-link.test.ts src/db/sem-conta-guarda.test.ts`
Expected: PASS (a guarda do N7 aceita o arquivo novo por estar em `SEM_CONTA_PERMITIDOS`).

- [ ] **Step 3: As rotas e o teste delas**

Criar `src/app/api/autorizacao-ia/[token]/link.ts`:

```ts
import { getEnv } from '@/env';
import { PublicoError } from '@/modules/agenda/agendamento-publico';
import { LinkIaError, type DepsLinkIa } from '@/modules/ia/autorizacao-link';
import { configIA } from '@/modules/ia/modo';
import { comoResposta, depsDaRequisicao, SEM_CACHE } from '../../n/[slug]/resposta';

/** US-107: o IP real, o balde do limite (/64), o Turnstile da página pública, o user-agent (prova de autoria, RN-107) e a IA. */
export function depsDoLinkIa(req: Request): DepsLinkIa {
  const d = depsDaRequisicao(req);
  const env = getEnv();
  return { ...d, ipDoLimite: d.ipDoLimite ?? null, userAgent: req.headers.get('user-agent'), appUrl: env.APP_URL, ia: configIA(env) };
}

export const recusaOrigem = () => Response.json({ erro: 'Pedido inválido.' }, { status: 403, headers: SEM_CACHE });

/** LinkIaError → `{ erro }` com o status dele; corpo inválido (PublicoError do `lerJson`) → 400/413; o resto sobe (500). */
export function comoRespostaDoLinkIa(e: unknown): Response {
  if (e instanceof LinkIaError) return Response.json({ erro: e.mensagem }, { status: e.status, headers: SEM_CACHE });
  if (e instanceof PublicoError) return comoResposta(e);
  throw e;
}
```

Criar `src/app/api/autorizacao-ia/[token]/autorizar/route.ts`:

```ts
import { mesmaOrigem } from '@/lib/mesma-origem';
import { autorizarPeloLink } from '@/modules/ia/autorizacao-link';
import { lerJson, SEM_CACHE } from '../../../n/[slug]/resposta';
import { comoRespostaDoLinkIa, depsDoLinkIa, recusaOrigem } from '../link';

export const dynamic = 'force-dynamic';

/** US-107: Turnstile → limite por IP → autorização pelo link. 200 · 403/503 (Turnstile) · 410 · 429 · 400 · 413. */
export async function POST(req: Request, { params }: RouteContext<'/api/autorizacao-ia/[token]/autorizar'>) {
  if (!mesmaOrigem(req)) return recusaOrigem();
  const { token } = await params;
  try {
    const corpo = await lerJson(req);
    await autorizarPeloLink(token, { turnstile: corpo.turnstile }, depsDoLinkIa(req));
    return Response.json({ ok: true }, { headers: SEM_CACHE });
  } catch (e) {
    return comoRespostaDoLinkIa(e);
  }
}
```

`src/app/api/autorizacao-ia/[token]/retirar/route.ts`: o mesmo, com `retirarPeloLink`, o tipo `RouteContext<'/api/autorizacao-ia/[token]/retirar'>` e o comentário "US-109: Turnstile → limite por IP → retirada pelo link".

Criar `src/app/api/autorizacao-ia/[token]/link.test.ts`:

```ts
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { POST as autorizar } from './autorizar/route';
import { POST as retirar } from './retirar/route';

// O Turnstile de verdade iria à rede: aqui, só o token "ok" passa
vi.mock('@/lib/turnstile', () => ({ verifyTurnstile: async (t: string | null) => (t === 'ok' ? 'ok' : 'invalido') }));
getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
type Rota = (req: Request, ctx: { params: Promise<{ token: string }> }) => Promise<Response>;
const bloco = `198.18.${Math.floor(Math.random() * 250)}`;
let n = 0;
const chamar = (rota: Rota, acao: string, token: string, o: { corpo?: string; origem?: string } = {}) =>
  rota(
    new Request(`http://localhost:3000/api/autorizacao-ia/${token}/${acao}`, {
      method: 'POST', body: o.corpo ?? '{}',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `${bloco}.${++n % 250}`, ...(o.origem ? { origin: o.origem } : {}) },
    }),
    { params: Promise.resolve({ token }) },
  );

describe('rotas do link da autorização de IA (US-107, US-109)', () => {
  it('outra origem → 403; sem Turnstile → 403 com o texto da US-107; token inválido → 410; corpo grande → 413', async () => {
    const t = 'x'.repeat(72);
    for (const [rota, acao] of [[autorizar, 'autorizar'], [retirar, 'retirar']] as const) {
      expect((await chamar(rota, acao, t, { origem: 'https://outro.site' })).status, acao).toBe(403);
      const semRobo = await chamar(rota, acao, t);
      expect(semRobo.status, acao).toBe(403);
      expect(await semRobo.json()).toEqual({ erro: MSG_AUTORIZACAO.robo });
      const r = await chamar(rota, acao, t, { corpo: JSON.stringify({ turnstile: 'ok' }) });
      expect(r.status, acao).toBe(410);
      expect(await r.json()).toEqual({ erro: MSG_AUTORIZACAO.linkInvalido });
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect((await chamar(rota, acao, t, { corpo: JSON.stringify({ turnstile: 'ok', lixo: 'x'.repeat(9000) }) })).status, acao).toBe(413);
    }
  });
});
```

Run: `pnpm vitest run src/app/api/autorizacao-ia src/app/api/mesma-origem-rotas.test.ts`
Expected: PASS (a guarda de origem varre a pasta nova sozinha: ela não está em `EXCLUIDAS`).

- [ ] **Step 4: A página e o formulário**

Em `next.config.ts`, depois das regras de `/documento`:

```ts
    // Plano 14A (US-107): o token do link da autorização de IA está na URL (nada em cache, nunca como Referer)
    { source: '/autorizacao-ia/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] },
    { source: '/api/autorizacao-ia/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'Cache-Control', value: 'no-store' }] },
```

Criar `src/app/autorizacao-ia/[token]/decisao-form.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { Botao } from '@/components/ui/botao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';

/**
 * US-107 / US-109: Turnstile e os botões da decisão (sem <form>: nada vai à URL; o POST é por fetch, como o link de
 * documentos). "Agora não" não grava nada (decisão da spec, §18.2): só o retorno. A região role="status" existe desde o
 * início (RNF-10) e recebe "Autorização registrada…", "Tudo bem…" ou "Autorização retirada."; o erro vai em role="alert".
 */
export function DecisaoForm({ token, siteKey, modo }: { token: string; siteKey: string; modo: 'decidir' | 'retirar' }) {
  const [turnstile, setTurnstile] = useState<string | null>(null);
  const [widget, setWidget] = useState(0);
  const [retorno, setRetorno] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [encerrado, setEncerrado] = useState(false);

  async function enviar(acao: 'autorizar' | 'retirar') {
    if (acao === 'retirar' && !window.confirm(MSG_AUTORIZACAO.confirmarRetirada)) return;
    setEnviando(true);
    setErro('');
    try {
      const res = await fetch(`/api/autorizacao-ia/${token}/${acao}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnstile }) });
      const r = (await res.json().catch(() => ({}))) as { erro?: string };
      if (res.ok) {
        setEncerrado(true);
        setRetorno(acao === 'autorizar' ? MSG_AUTORIZACAO.registradaLink : MSG_AUTORIZACAO.retirada);
      } else {
        setErro(r.erro ?? MSG_AUTORIZACAO.turnstileFora);
      }
    } catch {
      setErro(MSG_AUTORIZACAO.turnstileFora);
    }
    // o token do Turnstile é de uso único: um widget novo gera outro
    setTurnstile(null);
    setWidget((w) => w + 1);
    setEnviando(false);
  }

  return (
    <div className="space-y-3">
      {!encerrado && (
        <>
          <TurnstileWidget key={widget} siteKey={siteKey} onToken={setTurnstile} onIndisponivel={() => setErro(MSG_AUTORIZACAO.turnstileFora)} />
          <div className="flex flex-wrap gap-3">
            {modo === 'decidir' ? (
              <>
                <Botao type="button" onClick={() => enviar('autorizar')} disabled={enviando || !turnstile}>
                  {MSG_AUTORIZACAO.autorizo}
                </Botao>
                <Botao type="button" variante="secundario" disabled={enviando} onClick={() => { setEncerrado(true); setRetorno(MSG_AUTORIZACAO.tudoBem); }}>
                  {MSG_AUTORIZACAO.agoraNao}
                </Botao>
              </>
            ) : (
              <Botao type="button" onClick={() => enviar('retirar')} disabled={enviando || !turnstile}>
                {MSG_AUTORIZACAO.retirarAutorizacao}
              </Botao>
            )}
          </div>
        </>
      )}
      <p role="status">{retorno}</p>
      {erro && (
        <p role="alert" className="text-erro">
          {erro}
        </p>
      )}
    </div>
  );
}
```

Criar `src/app/autorizacao-ia/[token]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { TextoLegalView } from '@/components/texto-legal';
import { Aviso } from '@/components/ui/aviso';
import { getEnv } from '@/env';
import { clientIp, clientIpDoLimite } from '@/lib/ip';
import { estadoDoLinkIa } from '@/modules/ia/autorizacao-link';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { DecisaoForm } from './decisao-form';

export const dynamic = 'force-dynamic';
// O token está na URL: nunca mandá-lo como Referer (o next.config também manda o cabeçalho em /autorizacao-ia/*)
export const metadata: Metadata = { title: 'Autorização para uso de inteligência artificial', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const TITULO = 'Autorização para uso de inteligência artificial';
const data = (d: Date) => formatarData(hojeNoFuso('America/Sao_Paulo', d));

/** US-107 / US-109: a página do link, sem login. O GET não grava nada; nenhum dado de saúde (só o consultório e o texto). */
export default async function AutorizacaoPeloLink({ params }: PageProps<'/autorizacao-ia/[token]'>) {
  const { token } = await params;
  const env = getEnv();
  const h = await headers();
  const estado = await estadoDoLinkIa(token, {
    ia: configIA(env), appUrl: env.APP_URL, ip: clientIp(h, env.TRUSTED_PROXIES), ipDoLimite: clientIpDoLimite(h, env.TRUSTED_PROXIES), userAgent: null,
    verificarTurnstile: async () => 'invalido' as const,
  });
  return (
    <main className="mx-auto min-h-dvh max-w-2xl space-y-4 bg-fundo p-6 font-sans text-texto">
      {estado.tipo === 'decidir' ? (
        <>
          <p className="text-suave">{estado.consultorio}</p>
          <TextoLegalView texto={estado.texto} id="autorizacao" nivel="h1" classeTitulo="font-titulo text-2xl font-semibold" />
          <DecisaoForm token={token} siteKey={env.TURNSTILE_SITE_KEY} modo="decidir" />
        </>
      ) : (
        <>
          <h1 className="font-titulo text-2xl font-semibold">{TITULO}</h1>
          {estado.tipo === 'invalido' && <Aviso tipo="aviso">{MSG_AUTORIZACAO.linkInvalido}</Aviso>}
          {estado.tipo === 'expirado' && <Aviso tipo="aviso">{MSG_AUTORIZACAO.linkExpirado}</Aviso>}
          {estado.tipo === 'nao_vigente' && <Aviso tipo="aviso">{MSG_AUTORIZACAO.naoVigente}</Aviso>}
          {(estado.tipo === 'ja_autorizou' || estado.tipo === 'retirar') && (
            <section aria-labelledby="situacao" className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
              <h2 id="situacao" className="font-semibold">{estado.consultorio}</h2>
              <p>{MSG_AUTORIZACAO.jaAutorizou(data(estado.em))}</p>
              <DecisaoForm token={token} siteKey={env.TURNSTILE_SITE_KEY} modo="retirar" />
            </section>
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Rodar e conferir**

Run: `pnpm vitest run src/modules/ia src/app/api src/db/sem-conta-guarda.test.ts src/app/formularios-post.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: sem erros (a página e as rotas compilam; o grafo do Next não alcança o SDK).

- [ ] **Step 6: Commit**

```bash
git add src/modules/ia/autorizacao-link.ts src/modules/ia/autorizacao-link.test.ts "src/app/autorizacao-ia" "src/app/api/autorizacao-ia" \
  src/db/tenant.ts src/modules/agenda/limite-ip.ts next.config.ts
git commit -m "feat(ia): autorização e retirada pelo link do e-mail, sem login (Turnstile, limite por IP, sem dado de saúde) (P14A-06)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 7: Painel — a seção "Uso de IA" da aba Privacidade, o termo para imprimir, o envio do termo assinado e "Ver termo assinado" (P14A-07)

**Revisão: leve (revisor-interface)** — textos exatos da US-105/US-108/US-109, visual V2, acessibilidade (rótulos, `role="status"`/`role="alert"`, 44 px), impressão. (As rotas novas são finas: a regra de negócio é da T5.)

**Files:**
- Modify: `src/app/painel/pacientes/[id]/privacidade/page.tsx`, `src/app/painel/pacientes/[id]/privacidade/uso-ia.tsx` (reescrito), `src/app/painel/pacientes/[id]/privacidade/actions.ts`, `src/app/painel/pacientes/[id]/privacidade/actions.test.ts`, `src/app/painel/pacientes/[id]/layout.tsx` (`print:hidden`), `e2e/painel-rotas.ts` (a página nova)
- Create: `src/app/painel/pacientes/[id]/privacidade/pedido-ia-form.tsx`, `src/app/painel/pacientes/[id]/privacidade/termo-ia/page.tsx`, `src/app/painel/pacientes/[id]/privacidade/termo-ia/termo-papel-form.tsx`, `src/app/painel/pacientes/[id]/privacidade/termo-ia/imprimir.tsx`, `src/app/api/painel/pacientes/[id]/autorizacao-ia/termo/route.ts` (+ `route.test.ts`), `src/app/api/painel/pacientes/[id]/autorizacao-ia/[autorizacaoId]/termo/route.ts` (+ `route.test.ts`)

**Interfaces:**
- Consumes: `painelDaAutorizacao`, `secaoIaVisivel`, `enviarPedidoPorEmail`, `registrarTermoEmPapel`, `caminhoDoTermo`, `registrarRetiradaPelaNutri`, `AutorizacaoError`, `PainelAutorizacao` (T4/T5); `MSG_AUTORIZACAO`, `CANAL_ROTULO`, `DESTINO_ROTULO`, `TERMO_MAX_BYTES`, `textoDaAutorizacao`, `responsavelDoTenant`, `AUTORIZACAO_IA_VERSAO`, `configIA`, `estadoIaDoTenant`, `TextoLegalView` (T2); `requireNutri`, `requireApiNutri`, `carregarProntuario`, `signFileUrl`, `lerCorpoLimitado`, `mesmaOrigem`, `ConfirmarBotao`, `Botao`, `Aviso`.
- Produces: as telas e as rotas `POST /api/painel/pacientes/[id]/autorizacao-ia/termo` (multipart: `data`, `confirmacao`, `arquivo`) e `GET /api/painel/pacientes/[id]/autorizacao-ia/[autorizacaoId]/termo` (303 para a URL assinada).

- [ ] **Step 1: Os testes que falham — ações e rotas**

Em `src/app/painel/pacientes/[id]/privacidade/actions.test.ts`, acrescentar (o arquivo já simula `next/headers`, `next/cache` e `next/navigation`; trocar o import das actions por `const { atenderExclusaoAction, enviarPedidoIaAction, retiradaIaAction } = await import('./actions');` e importar `autorizacaoNoBanco`, `iaPronta` de `test/ia`, `emailsNaFila` de `test/pacientes`, `iaAutorizacoes`, `tenants` de `@/db/schema`, `MSG_AUTORIZACAO` de `@/modules/ia/constantes`):

```ts
describe('Uso de IA (US-105, US-109) — Plano 14A', () => {
  const PERFIL = { nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' };

  it('"Enviar pedido de autorização por e-mail": grava o pedido e enfileira o e-mail; o segundo devolve o texto do pedido aberto', async () => {
    vi.stubEnv('IA_PROVEDOR', 'sandbox');
    const N = await nutriComDpa(db, getAuth());
    req.headers = new Headers({ cookie: N.cookie });
    await iaPronta(db, N.tenantId);
    await db.update(tenants).set(PERFIL).where(eq(tenants.id, N.tenantId));
    const p = await novoPaciente(db, N.ctx);
    expect(await enviarPedidoIaAction(p.id, {}, new FormData())).toEqual({ ok: MSG_AUTORIZACAO.pedidoEnviado });
    expect(await emailsNaFila('autorizacao_ia', p.email!)).toHaveLength(1);
    expect((await enviarPedidoIaAction(p.id, {}, new FormData())).erro).toMatch(/^Já há um pedido por e-mail válido até /);
    vi.unstubAllEnvs();
  });

  it('"Registrar retirada a pedido do paciente": grava a retirada da nutricionista', async () => {
    const N = await nutriComDpa(db, getAuth());
    req.headers = new Headers({ cookie: N.cookie });
    const p = await novoPaciente(db, N.ctx);
    await autorizacaoNoBanco(db, N.tenantId, p.id);
    await retiradaIaAction(p.id);
    const [r] = await withTenant(N.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.evento, 'retirou')), db);
    expect(r).toMatchObject({ patientId: p.id, canal: 'nutricionista', registradoPor: N.ctx.actorUserId });
  });
});
```

(`getEnv()` relê `process.env` a cada chamada nos testes? Se o `getEnv` do projeto guardar o ambiente em cache, usar o mesmo recurso que os outros testes de action usam para trocar uma variável; o `nutriComDpa` e o `req` são os do arquivo.)

Criar `src/app/api/painel/pacientes/[id]/autorizacao-ia/termo/route.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { iaAutorizacoes, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { getAuth } from '@/lib/auth';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { hojeNoFuso } from '@/modules/pacientes/datas';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { iaPronta, PDF_MINIMO } from '../../../../../../../../test/ia';
import { novoPaciente } from '../../../../../../../../test/pacientes';
import { criarEEntrar } from '../../../../../../../../test/sessao';
import { POST } from './route';

vi.mock('server-only', () => ({}));
const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});
async function nutri() {
  const [t] = await db.insert(tenants).values({ slug: `ti-${randomUUID().slice(0, 8)}`, nomeExibicao: 'TI', nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' }).returning();
  const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  await iaPronta(db, t.id);
  return { cookie: n.cookie, ctx: { tenantId: t.id, role: 'nutri' as const, actorUserId: n.id } };
}
const enviar = (id: string, campos: Record<string, string | Blob>, cookie: string, origin = 'http://localhost:3000') => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return POST(new Request(`http://localhost:3000/api/painel/pacientes/${id}/autorizacao-ia/termo`, { method: 'POST', body: f, headers: { cookie, origin } }), { params: Promise.resolve({ id }) });
};

describe('POST do termo em papel (US-108)', () => {
  it('grava o arquivo e a autorização; erros por campo com os textos da US-108; outra origem → 403', async () => {
    vi.stubEnv('IA_PROVEDOR', 'sandbox');
    const N = await nutri();
    const p = await novoPaciente(db, N.ctx);
    const hoje = hojeNoFuso('America/Sao_Paulo');
    const sem = await enviar(p.id, { data: hoje }, N.cookie);
    expect(sem.status).toBe(400);
    expect((await sem.json()).erros).toMatchObject({ arquivo: MSG_AUTORIZACAO.faltouArquivo, confirmacao: MSG_AUTORIZACAO.faltouConfirmacao });
    expect((await enviar(p.id, { data: hoje, confirmacao: 'on', arquivo: new Blob([PDF_MINIMO]) }, N.cookie, 'https://outro.site')).status).toBe(403);
    const ok = await enviar(p.id, { data: hoje, confirmacao: 'on', arquivo: new Blob([PDF_MINIMO], { type: 'application/pdf' }) }, N.cookie);
    expect(ok.status).toBe(200);
    const [a] = await withTenant(N.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, p.id)), db);
    expect(a).toMatchObject({ canal: 'papel', evento: 'autorizou' });
    vi.unstubAllEnvs();
  });
});
```

Criar `src/app/api/painel/pacientes/[id]/autorizacao-ia/[autorizacaoId]/termo/route.test.ts` no mesmo molde: com um termo gravado por `registrarTermoEmPapel`, o `GET` responde **303** com `location` começando por `/api/arquivos?` e grava um `ler` de `ia_autorizacao` no `audit_log`; id de outro paciente → **404**; sem sessão → a resposta do `requireApiNutri` (401).

Run: `pnpm vitest run "src/app/painel/pacientes/[id]/privacidade" "src/app/api/painel/pacientes/[id]/autorizacao-ia"`
Expected: FAIL (as actions e as rotas não existem).

- [ ] **Step 2: As ações**

Em `src/app/painel/pacientes/[id]/privacidade/actions.ts`, sair o import de `@/modules/ia/ciencia-paciente` e as três actions do Plano 11 (`enviarAvisoIaAction`, `registrarEntregaIaAction`, `recusaIaAction`); entrar:

```ts
import { getEnv } from '@/env';
import { AutorizacaoError, enviarPedidoPorEmail, registrarRetiradaPelaNutri } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
// …
export type PedidoIaState = { ok?: string; erro?: string };

/** US-105 "Enviar pedido de autorização por e-mail" (o e-mail entra na fila na mesma transação do registro). */
export async function enviarPedidoIaAction(patientId: string, _prev: PedidoIaState, _fd: FormData): Promise<PedidoIaState> {
  const { ctx } = await requireNutri(caminho(patientId));
  try {
    await enviarPedidoPorEmail(ctx, patientId, { ia: configIA(getEnv()), appUrl: getEnv().APP_URL });
  } catch (e) {
    if (e instanceof PacienteNaoEncontradoError) notFound();
    if (e instanceof AutorizacaoError) return { erro: e.message };
    if (e instanceof PacienteBloqueadoError) return { erro: e.message };
    throw e;
  }
  revalidatePath(`/painel/pacientes/${patientId}`, 'layout');
  return { ok: MSG_AUTORIZACAO.pedidoEnviado };
}

/** US-109 "Registrar retirada a pedido do paciente": a retirada e o cancelamento na mesma transação (RN-108). */
export async function retiradaIaAction(patientId: string): Promise<void> {
  await situacao(patientId, async (ctx) => {
    await registrarRetiradaPelaNutri(ctx, patientId);
  });
}
```

- [ ] **Step 3: A seção "Uso de IA"**

`src/app/painel/pacientes/[id]/privacidade/uso-ia.tsx` passa a ser:

```tsx
import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { TextoLegalView } from '@/components/texto-legal';
import { Aviso } from '@/components/ui/aviso';
import type { PatientRow } from '@/db/schema';
import type { PainelAutorizacao } from '@/modules/ia/autorizacao';
import { CANAL_ROTULO, DESTINO_ROTULO, MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import type { TextoLegal } from '@/modules/ia/textos-legais';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { enviarPedidoIaAction, retiradaIaAction } from './actions';
import { PedidoIaForm } from './pedido-ia-form';

const LINK = 'inline-flex min-h-11 items-center text-link underline';

/**
 * US-105 / US-108 / US-109 (Plano 14A): a seção "Uso de IA" da aba Privacidade. `podePedir` (D10): IA ativa no consultório
 * e perfil completo — sem isso, só a situação, os registros e a retirada (que vale sempre). `aviso`: o retorno do termo
 * em papel (?ia=papel), numa região role="status" que já existe na página. `texto`: a variante do link, para "Ver o texto".
 */
export function UsoDeIa(p: { paciente: PatientRow; painel: PainelAutorizacao; podePedir: boolean; motivoSemPedido: string | null; texto: TextoLegal | null; fuso: string; aviso: string | null }) {
  const { paciente, painel, fuso } = p;
  const data = (d: Date) => formatarDataNoFuso(d, fuso);
  const s = painel.situacao;
  const somenteLeitura = paciente.status === 'bloqueado' || Boolean(paciente.anonimizadoEm);
  const semPedidos = somenteLeitura || paciente.status !== 'ativo' || s.tipo === 'vigente';
  const aRetirar = s.tipo === 'vigente' || s.tipo === 'versao_antiga' || s.tipo === 'outro_destino';
  return (
    <section aria-labelledby="uso-ia" className="space-y-3">
      <h2 id="uso-ia" className="text-lg font-semibold">Uso de IA</h2>
      <p role="status">{p.aviso ?? ''}</p>
      {s.tipo === 'nunca' && (
        <>
          <p>{MSG_AUTORIZACAO.naoAutorizou}</p>
          <p className="text-suave">{MSG_AUTORIZACAO.explicacao}</p>
        </>
      )}
      {s.tipo === 'vigente' && (
        <p>
          {MSG_AUTORIZACAO.autorizou(data(s.em), CANAL_ROTULO[s.canal], s.versao)}{' '}
          {s.canal === 'papel' && (
            <a href={`/api/painel/pacientes/${paciente.id}/autorizacao-ia/${s.id}/termo`} target="_blank" rel="noreferrer" className={LINK}>
              {MSG_AUTORIZACAO.verTermo}
            </a>
          )}
        </p>
      )}
      {s.tipo === 'retirada' && <p>{MSG_AUTORIZACAO.retirou(data(s.em))}</p>}
      {s.tipo === 'versao_antiga' && <p>{MSG_AUTORIZACAO.versaoAntiga(s.versao)}</p>}
      {s.tipo === 'outro_destino' && <p>{MSG_AUTORIZACAO.destinoTrocado(DESTINO_ROTULO[s.destino])}</p>}
      {painel.alertaEmailTrocado && <Aviso tipo="aviso">{MSG_AUTORIZACAO.emailTrocado}</Aviso>}

      {!semPedidos && p.podePedir && (
        <div className="space-y-2">
          {!paciente.email ? (
            <p>{MSG_AUTORIZACAO.semEmail}</p>
          ) : (
            // o formulário fica montado também com o pedido aberto: o "Pedido enviado…" sobrevive ao revalidatePath
            <PedidoIaForm acao={enviarPedidoIaAction.bind(null, paciente.id)} aberto={painel.pedidoAbertoAte ? MSG_AUTORIZACAO.pedidoAberto(data(painel.pedidoAbertoAte)) : null} />
          )}
          <p>
            <Link href={`/painel/pacientes/${paciente.id}/privacidade/termo-ia`} className={LINK}>
              {MSG_AUTORIZACAO.registrarPapel}
            </Link>
          </p>
          {paciente.userId && <p className="text-suave">{MSG_AUTORIZACAO.dicaApp}</p>}
        </div>
      )}
      {!semPedidos && !p.podePedir && p.motivoSemPedido && <p className="text-suave">{p.motivoSemPedido}</p>}
      {p.texto && (
        <details className="rounded-2xl border border-borda p-3">
          <summary className="cursor-pointer text-link underline">{MSG_AUTORIZACAO.verTexto}</summary>
          <div className="mt-2">
            <TextoLegalView texto={p.texto} id="texto-autorizacao-ia" nivel="h3" classeTitulo="font-semibold" />
          </div>
        </details>
      )}
      {!somenteLeitura && aRetirar && (
        <form action={retiradaIaAction.bind(null, paciente.id)}>
          <ConfirmarBotao mensagem={MSG_AUTORIZACAO.confirmarRetiradaNutri}>{MSG_AUTORIZACAO.registrarRetirada}</ConfirmarBotao>
        </form>
      )}
      {painel.eventos.length > 0 && (
        <>
          <h3 className="font-semibold">{MSG_AUTORIZACAO.registros}</h3>
          <ul className="space-y-1 text-sm">
            {painel.eventos.map((e) => (
              <li key={e.id}>
                {e.evento === 'autorizou'
                  ? MSG_AUTORIZACAO.registroAutorizou(data(e.em), CANAL_ROTULO[e.canal], e.versao ?? '')
                  : e.evento === 'retirou'
                    ? MSG_AUTORIZACAO.registroRetirou(data(e.em), CANAL_ROTULO[e.canal])
                    : MSG_AUTORIZACAO.registroPedido(data(e.em))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

Criar `src/app/painel/pacientes/[id]/privacidade/pedido-ia-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import type { PedidoIaState } from './actions';

const BOTAO = 'inline-flex min-h-11 items-center justify-center rounded-full border border-campo bg-cartao px-5 text-texto hover:bg-linha';

/**
 * US-105: o botão, ou — com um pedido aberto — "Já há um pedido por e-mail válido até…"; o retorno ("Pedido enviado. O link
 * vale por 7 dias.") numa região role="status" que existe desde o início (RNF-10) e continua montada depois do revalidatePath.
 */
export function PedidoIaForm({ acao, aberto }: { acao: (prev: PedidoIaState, fd: FormData) => Promise<PedidoIaState>; aberto: string | null }) {
  const [state, action, pendente] = useActionState<PedidoIaState, FormData>(acao, {});
  return (
    <form action={action} className="space-y-2">
      {aberto ? (
        <p>{aberto}</p>
      ) : (
        <button disabled={pendente} className={BOTAO}>
          {MSG_AUTORIZACAO.enviarPedido}
        </button>
      )}
      <p role="status">{state.ok ?? ''}</p>
      {state.erro && (
        <p role="alert" className="text-erro">
          {state.erro}
        </p>
      )}
    </form>
  );
}
```

Em `src/app/painel/pacientes/[id]/privacidade/page.tsx`, trocar o import de `usoDeIaVisivel` e a montagem da seção:

```tsx
import { getEnv } from '@/env';
import { painelDaAutorizacao, secaoIaVisivel } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA, estadoIaDoTenant } from '@/modules/ia/modo';
import { AUTORIZACAO_IA_VERSAO, responsavelDoTenant, textoDaAutorizacao } from '@/modules/ia/textos-legais';
// …
  const ia = configIA(getEnv());
  const painel = ia.modo === 'ausente' ? null : await painelDaAutorizacao(ctx, paciente, ia.destino);
  const iaVisivel = !!painel && secaoIaVisivel(ia.modo, tenant, painel.temRegistro);
  const responsavel = responsavelDoTenant(tenant);
  const iaAtiva = estadoIaDoTenant(tenant, ia.modo) === 'ativa' && !!ia.destino;
  const texto = responsavel && ia.destino ? textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...responsavel, destino: ia.destino, canal: 'link' }) : null;
  // …
      {iaVisivel && painel && (
        <UsoDeIa
          paciente={paciente}
          painel={painel}
          podePedir={iaAtiva && !!responsavel}
          motivoSemPedido={!iaAtiva ? null : responsavel ? null : MSG_AUTORIZACAO.perfilIncompleto}
          texto={texto}
          fuso={tenant.fuso}
          aviso={busca.ia === 'papel' ? MSG_AUTORIZACAO.termoRegistrado : null}
        />
      )}
```

(o `enviado={busca.ia === 'enviado'}` do Plano 11 sai.)

- [ ] **Step 4: O termo para imprimir e o envio do termo assinado**

Em `src/app/painel/pacientes/[id]/layout.tsx`, `print:hidden` no `<header data-guia="cabecalho-paciente" …>` (na `className`) e num `<div className="print:hidden">` em volta de `<Abas … />` (o cabeçalho do painel já tem `print:hidden`, D26 do Plano 08).

Criar `src/app/painel/pacientes/[id]/privacidade/termo-ia/imprimir.tsx`:

```tsx
'use client';

import { Botao } from '@/components/ui/botao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';

/** US-108 "Imprimir termo": o diálogo de impressão do navegador (o layout esconde o resto na impressão). */
export function Imprimir() {
  return (
    <Botao type="button" className="print:hidden" onClick={() => window.print()}>
      {MSG_AUTORIZACAO.imprimir}
    </Botao>
  );
}
```

Criar `src/app/painel/pacientes/[id]/privacidade/termo-ia/termo-papel-form.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Botao } from '@/components/ui/botao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';

type Erros = Partial<Record<'geral' | 'data' | 'arquivo' | 'confirmacao', string>>;

/**
 * US-108 "Guardar o termo assinado": multipart para a rota do painel (o arquivo de até 20 MB não passa por Server Action),
 * como o laudo dos exames. Sucesso → volta à aba Privacidade com "Termo registrado…" (?ia=papel). Erros por campo, com
 * aria-invalid/aria-describedby; o geral em role="alert".
 */
export function TermoPapelForm({ patientId, versao, codigo }: { patientId: string; versao: string; codigo: string }) {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    setErros({});
    try {
      const res = await fetch(`/api/painel/pacientes/${patientId}/autorizacao-ia/termo`, { method: 'POST', body: new FormData(e.currentTarget) });
      if (res.ok) {
        router.push(`/painel/pacientes/${patientId}/privacidade?ia=papel`);
        return;
      }
      const r = (await res.json().catch(() => ({}))) as { erros?: Erros };
      setErros(r.erros ?? { geral: 'Não foi possível salvar. Tente de novo.' });
    } catch {
      setErros({ geral: 'Não foi possível salvar. Tente de novo.' });
    }
    setEnviando(false);
  }

  const campo = (nome: keyof Erros) => (erros[nome] ? { 'aria-invalid': true as const, 'aria-describedby': `${nome}-erro` } : {});
  const erro = (nome: keyof Erros) => erros[nome] && (
    <p id={`${nome}-erro`} role="alert" className="text-erro">
      {erros[nome]}
    </p>
  );
  return (
    <form method="post" onSubmit={enviar} className="space-y-3 print:hidden">
      <p className="font-semibold">{MSG_AUTORIZACAO.codigoReferencia(codigo)}</p>
      <div>
        <label htmlFor="data" className="block font-medium">{MSG_AUTORIZACAO.dataAssinatura}</label>
        <input id="data" name="data" type="date" required className="min-h-11 rounded-xl border border-campo bg-cartao p-2 text-texto" {...campo('data')} />
        {erro('data')}
      </div>
      <div>
        <label htmlFor="arquivo" className="block font-medium">{MSG_AUTORIZACAO.arquivoTermo}</label>
        <input id="arquivo" name="arquivo" type="file" accept="image/jpeg,image/png,application/pdf" className="min-h-11" {...campo('arquivo')} />
        {erro('arquivo')}
      </div>
      <div className="flex items-start gap-2">
        <input id="confirmacao" name="confirmacao" type="checkbox" className="mt-1 h-5 w-5" {...campo('confirmacao')} />
        <label htmlFor="confirmacao">{MSG_AUTORIZACAO.confirmacaoPapel(versao)}</label>
      </div>
      {erro('confirmacao')}
      {erro('geral')}
      <Botao type="submit" disabled={enviando}>
        {MSG_AUTORIZACAO.salvar}
      </Botao>
    </form>
  );
}
```

Criar `src/app/painel/pacientes/[id]/privacidade/termo-ia/page.tsx`:

```tsx
import { TextoLegalView } from '@/components/texto-legal';
import { Aviso } from '@/components/ui/aviso';
import { getEnv } from '@/env';
import { painelDaAutorizacao } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO, MSG_FALHA, MSG_IA } from '@/modules/ia/constantes';
import { configIA, estadoIaDoTenant } from '@/modules/ia/modo';
import { AUTORIZACAO_IA_VERSAO, responsavelDoTenant, textoDaAutorizacao } from '@/modules/ia/textos-legais';
import { carregarProntuario } from '../../prontuario';
import { Imprimir } from './imprimir';
import { TermoPapelForm } from './termo-papel-form';

export const dynamic = 'force-dynamic';

/**
 * US-108: o termo impresso (o texto da versão atual com o destino em uso e a forma de retirar do papel, com ou sem e-mail),
 * o nome do paciente, o código de referência (RN-107) e os campos de data e assinatura; abaixo, fora da impressão, o envio
 * do termo assinado. Só com a IA ativa e o perfil completo (D10) e com o paciente ativo.
 */
export default async function TermoIaPage({ params }: PageProps<'/painel/pacientes/[id]/privacidade/termo-ia'>) {
  const { id } = await params;
  const { ctx, tenant, paciente } = await carregarProntuario(id);
  const ia = configIA(getEnv());
  const responsavel = responsavelDoTenant(tenant);
  const motivo =
    estadoIaDoTenant(tenant, ia.modo) !== 'ativa' || !ia.destino ? MSG_IA.indisponivel
    : !responsavel ? MSG_AUTORIZACAO.perfilIncompleto
    : paciente.status !== 'ativo' || paciente.anonimizadoEm ? MSG_FALHA.paciente_indisponivel
    : null;
  if (motivo || !responsavel || !ia.destino) return <Aviso tipo="aviso">{motivo}</Aviso>;
  const texto = textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...responsavel, destino: ia.destino, canal: paciente.email ? 'papel_com_email' : 'papel_sem_email' })!;
  const { codigoDeReferencia } = await painelDaAutorizacao(ctx, paciente, ia.destino);
  return (
    <div className="max-w-3xl space-y-6">
      <Imprimir />
      <div className="space-y-3 rounded-3xl border border-borda bg-cartao p-5 print:border-0 print:p-0">
        <TextoLegalView texto={texto} id="termo-ia" nivel="h2" />
        <p>{MSG_AUTORIZACAO.nomePaciente(paciente.nome)}</p>
        <p>{MSG_AUTORIZACAO.codigoReferencia(codigoDeReferencia)}</p>
        <p className="pt-4">{MSG_AUTORIZACAO.campoData}</p>
        <p className="pt-4">{MSG_AUTORIZACAO.campoAssinatura}</p>
      </div>
      <section aria-labelledby="guardar-termo" className="space-y-3 print:hidden">
        <h2 id="guardar-termo" className="text-lg font-semibold">{MSG_AUTORIZACAO.registrarPapel}</h2>
        <TermoPapelForm patientId={paciente.id} versao={AUTORIZACAO_IA_VERSAO} codigo={codigoDeReferencia} />
      </section>
    </div>
  );
}
```

Em `e2e/painel-rotas.ts`, `ROTAS_DO_PAINEL` ganha `'/painel/pacientes/[id]/privacidade/termo-ia': (i) => \`/painel/pacientes/${i.paciente}/privacidade/termo-ia\`,` (guarda `rotas-axe.test.ts`). O guia `prontuario` já casa a rota pelo prefixo (`conteudo.test.ts` passa sem entrada em `SEM_AJUDA`).

- [ ] **Step 5: As rotas do termo**

Criar `src/app/api/painel/pacientes/[id]/autorizacao-ia/termo/route.ts`:

```ts
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { getEnv } from '@/env';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { requireApiNutri } from '@/lib/tenant-session';
import { AutorizacaoError, registrarTermoEmPapel } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO, TERMO_MAX_BYTES } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export const dynamic = 'force-dynamic';

const LIMITE_CORPO = TERMO_MAX_BYTES + 64 * 1024;
const resposta = (status: number, corpo: unknown) => Response.json(corpo, { status, headers: { 'cache-control': 'no-store' } });
// como o envio de laudo: no máximo 2 corpos de até 20 MB por processo (VPS dividida)
const MAX_ENVIOS = 2;
let enviosEmAndamento = 0;

/** US-108: multipart (data, confirmacao, arquivo). 200 · 400 (campos) · 403 · 404 · 409 (bloqueado) · 413 · 429. */
export async function POST(req: Request, { params }: RouteContext<'/api/painel/pacientes/[id]/autorizacao-ia/termo'>) {
  if (!mesmaOrigem(req)) return resposta(403, { erros: { geral: 'Acesso negado' } });
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id } = await params;
  if (Number(req.headers.get('content-length') ?? 0) > LIMITE_CORPO) return resposta(413, { erros: { arquivo: MSG_AUTORIZACAO.arquivoInvalido } });
  if (enviosEmAndamento >= MAX_ENVIOS) return resposta(429, { erros: { geral: 'Outro envio em andamento. Tente de novo em instantes.' } });
  enviosEmAndamento++;
  try {
    let form: FormData;
    try {
      const corpo = await lerCorpoLimitado(req, LIMITE_CORPO);
      form = await new Response(new Uint8Array(corpo.buffer as ArrayBuffer, corpo.byteOffset, corpo.length), { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
    } catch (e) {
      if (e instanceof CorpoGrandeError) return resposta(413, { erros: { arquivo: MSG_AUTORIZACAO.arquivoInvalido } });
      return resposta(400, { erros: { geral: 'Formulário inválido.' } });
    }
    const arquivo = form.get('arquivo');
    const buf = arquivo instanceof Blob && arquivo.size > 0 ? Buffer.from(await arquivo.arrayBuffer()) : null;
    await registrarTermoEmPapel(acesso.ctx, id, { data: form.get('data'), confirmacao: form.get('confirmacao') === 'on', arquivo: buf }, { ia: configIA(getEnv()), appUrl: getEnv().APP_URL });
    return resposta(200, { ok: true });
  } catch (e) {
    if (e instanceof AutorizacaoError) return resposta(400, { erros: e.erros });
    if (e instanceof PacienteNaoEncontradoError) return resposta(404, { erros: { geral: 'Paciente não encontrado.' } });
    if (e instanceof PacienteBloqueadoError) return resposta(409, { erros: { geral: e.message } });
    throw e;
  } finally {
    enviosEmAndamento--;
  }
}
```

(O texto "Outro envio em andamento. Tente de novo em instantes." é o mesmo `MSG_EXAME.ocupado` do envio de laudo — usar a constante se ela tiver esse texto.)

Criar `src/app/api/painel/pacientes/[id]/autorizacao-ia/[autorizacaoId]/termo/route.ts`:

```ts
import { signFileUrl } from '@/lib/signed-url';
import { requireApiNutri } from '@/lib/tenant-session';
import { caminhoDoTermo } from '@/modules/ia/autorizacao';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/** US-108 "Ver termo assinado": auditRead (entidade ia_autorizacao) e 303 para a URL assinada de 5 min (signFileUrl, regra 9). */
export async function GET(req: Request, { params }: RouteContext<'/api/painel/pacientes/[id]/autorizacao-ia/[autorizacaoId]/termo'>) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const { id, autorizacaoId } = await params;
  const caminho = await caminhoDoTermo(acesso.ctx, id, autorizacaoId);
  if (!caminho) return new Response(null, { status: 404, headers: SEM_CACHE });
  return new Response(null, { status: 303, headers: { location: signFileUrl(caminho), ...SEM_CACHE } });
}
```

- [ ] **Step 6: Rodar e conferir**

Run: `pnpm vitest run "src/app/painel" "src/app/api/painel" src/app/formularios-post.test.ts src/app/api/mesma-origem-rotas.test.ts src/modules/ajuda`
Expected: PASS (inclusive `acesso-negado.test.ts`, que varre as duas rotas novas, `acoes-de-paciente.test.ts`, `rotas-axe.test.ts` e `cores.test.ts`).

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

Conferir à mão com `pnpm dev` (porta 3100, `IA_PROVEDOR=sandbox`, `IA_RETENCAO_ZERO=1`): a aba Privacidade de um paciente sem autorização, com pedido aberto, autorizado em papel ("Ver termo assinado" abre o PDF), retirado; a página do termo e a pré-visualização de impressão (só o termo, sem o cabeçalho nem as abas), no modo claro e no escuro.

- [ ] **Step 7: Commit**

```bash
git add "src/app/painel/pacientes/[id]/privacidade" "src/app/painel/pacientes/[id]/layout.tsx" "src/app/api/painel/pacientes/[id]/autorizacao-ia" e2e/painel-rotas.ts
git commit -m "feat(painel): seção Uso de IA com a autorização do paciente, pedido por e-mail, termo em papel para imprimir e guardar, retirada a pedido (P14A-07)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 8: App do paciente — o bloco em Eu › Privacidade e a página `/p/perfil/ia` (P14A-08)

**Revisão: leve (revisor-interface)** — textos exatos da US-106/US-109, posição do bloco (depois do texto da RN-214 e antes de "Baixar meus dados"), visual G do Plano 16, `role="status"`, alvo de 44 px, celular.

**Files:**
- Modify: `src/app/p/(portal)/perfil/page.tsx`, `src/app/p/(portal)/perfil/privacidade.tsx`, `src/app/p/(portal)/perfil/actions.ts`, `src/app/p/(portal)/perfil/page.test.ts`
- Create: `src/app/p/(portal)/perfil/ia/page.tsx`, `src/app/p/(portal)/perfil/ia/page.test.ts`

**Interfaces:**
- Consumes: `blocoIaDoApp`, `autorizarNoApp`, `retirarNoApp`, `AutorizacaoError`, `SituacaoAutorizacao` (T4/T5); `MSG_AUTORIZACAO`, `textoDaAutorizacao`, `responsavelDoTenant`, `AUTORIZACAO_IA_VERSAO`, `configIA`, `TextoLegalView` (T2); `requirePaciente`, `molduraDaSecao`, `Faixa`, `MSG_G` (Plano 16); `clientIp` (`src/lib/ip.ts`).
- Produces: `autorizarIaAction()`, `retirarIaAction(prev)` (`perfil/actions.ts`); `Privacidade({ ia })` com `BlocoIaNaTela`.

- [ ] **Step 1: Os testes que falham**

Em `src/app/p/(portal)/perfil/page.test.ts`: o mock de `./actions` ganha `retirarIaAction: async () => ({})`; e:

```ts
const blocoIa = vi.hoisted(() => ({ valor: null as null | { situacao: { tipo: string; em?: Date; versao?: string }; podeDecidir: boolean } }));
vi.mock('@/modules/ia/autorizacao', () => ({ blocoIaDoApp: async () => blocoIa.valor }));
// …
  it('US-106: o bloco "Uso de inteligência artificial (IA)" fica depois do texto da RN-214 e antes de "Baixar meus dados"; sem bloco, nada', async () => {
    blocoIa.valor = { situacao: { tipo: 'nunca' }, podeDecidir: true };
    const html = renderToStaticMarkup(await Eu({ searchParams: Promise.resolve({}) }));
    const ordem = ['a critério da sua nutricionista', 'Uso de inteligência artificial (IA)', 'Você ainda não autorizou.', 'Ler e decidir', 'Baixar meus dados'];
    const posicoes = ordem.map((t) => html.indexOf(t));
    expect(posicoes.every((p) => p >= 0), String(posicoes)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    expect(html).toMatch(/<a[^>]*href="\/p\/perfil\/ia"[^>]*>Ler e decidir<\/a>/);
    blocoIa.valor = null;
    expect(renderToStaticMarkup(await Eu({ searchParams: Promise.resolve({}) }))).not.toContain('Uso de inteligência artificial');
  });

  it('US-106/US-109: autorizado → "Você autorizou em … (versão …)." e "Retirar autorização"; retirada → "Você retirou…" e "Ler e decidir"; texto novo; retorno do ?ia=', async () => {
    const em = new Date('2026-10-09T15:00:00Z');
    blocoIa.valor = { situacao: { tipo: 'vigente', em, versao: '0.1-provisorio' }, podeDecidir: true };
    let html = renderToStaticMarkup(await Eu({ searchParams: Promise.resolve({ ia: 'autorizou' }) }));
    expect(html).toContain('Você autorizou em 09/10/2026 (versão 0.1-provisorio).');
    expect(html).toContain('Retirar autorização');
    expect(html).toMatch(/role="status"[^>]*>Autorização registrada\. Você pode retirar quando quiser\.</);
    blocoIa.valor = { situacao: { tipo: 'retirada', em }, podeDecidir: false };
    html = renderToStaticMarkup(await Eu({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Você retirou a autorização em 09/10/2026.');
    expect(html).not.toContain('Ler e decidir'); // a IA não está ativa no consultório: nada a decidir agora
    blocoIa.valor = { situacao: { tipo: 'versao_antiga', em, versao: '0.0.9' }, podeDecidir: true };
    html = renderToStaticMarkup(await Eu({ searchParams: Promise.resolve({ ia: 'agora-nao' }) }));
    expect(html).toContain('O texto da autorização mudou. Leia e decida de novo.');
    expect(html).toContain('Tudo bem. Nada muda no seu atendimento.');
  });
```

(os dois `it` existentes passam a chamar `Eu({ searchParams: Promise.resolve({}) })`, e `blocoIa.valor = null` neles.)

Criar `src/app/p/(portal)/perfil/ia/page.test.ts`:

```ts
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const estado = vi.hoisted(() => ({ bloco: { situacao: { tipo: 'nunca' }, podeDecidir: true } as { situacao: { tipo: string }; podeDecidir: boolean } | null }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect ${url}`); } }));
vi.mock('@/env', () => ({ getEnv: () => ({ IA_PROVEDOR: 'sandbox', IA_MODELO_LEITURA: 'claude-opus-5-5', IA_INFERENCE_GEO: 'us', IA_TETO_GLOBAL_MENSAL_USD: 50 }) }));
vi.mock('@/lib/paciente-session', () => ({
  requirePaciente: async () => ({ ctx: {}, tenant: { nomeExibicao: 'Consultório Debby', nomeProfissional: 'Debora Silva', crn: 'CRN-3 12345', contatoEmail: 'contato@debby.test' }, vinculo: { patientId: 'p1' }, vinculos: [], data: { user: { email: 'm@ex.com' } } }),
}));
vi.mock('@/app/p/moldura', () => ({ molduraDaSecao: async () => ({ marca: { nome: 'Consultório Debby', cor: '#1d6b5a', corNoEscuro: '#6fcfb2', logoUrl: null }, secoes: [] }) }));
vi.mock('@/modules/ia/autorizacao', () => ({ blocoIaDoApp: async () => estado.bloco }));
vi.mock('../actions', () => ({ autorizarIaAction: async () => undefined }));
const { default: AutorizacaoIa } = await import('./page');

describe('/p/perfil/ia — ler e decidir (US-106)', () => {
  it('o título, o consultório, o texto inteiro da versão atual com o destino em uso e a forma de retirar do app; "Autorizo…" e "Agora não"', async () => {
    const html = renderToStaticMarkup(await AutorizacaoIa());
    for (const t of ['Autorização para uso de inteligência artificial', 'Consultório Debby', 'Debora Silva (CRN-3 12345)', 'Ambiente de teste', 'no app (Eu › Privacidade), pelo link do e-mail de confirmação ou pedindo à sua nutricionista', 'Versão provisória 0.1, em revisão jurídica.']) {
      expect(html, t).toContain(t);
    }
    expect(html).toMatch(/<button[^>]*>Autorizo o envio para fora do Brasil<\/button>/);
    expect(html).toMatch(/<a[^>]*href="\/p\/perfil\?ia=agora-nao"[^>]*>Agora não<\/a>/);
  });

  it('sem nada a decidir (IA não ativa, sem provedor) ou já autorizado → volta a Eu', async () => {
    estado.bloco = null;
    await expect(AutorizacaoIa()).rejects.toThrow('redirect /p/perfil');
    estado.bloco = { situacao: { tipo: 'vigente' }, podeDecidir: true };
    await expect(AutorizacaoIa()).rejects.toThrow('redirect /p/perfil');
  });
});
```

Run: `pnpm vitest run "src/app/p/(portal)/perfil"`
Expected: FAIL (o bloco e a página não existem; `Eu` ainda não recebe `searchParams`).

- [ ] **Step 2: As ações**

Em `src/app/p/(portal)/perfil/actions.ts`:

```ts
import { headers } from 'next/headers';
import { getEnv } from '@/env';
import { clientIp } from '@/lib/ip';
import { AutorizacaoError, autorizarNoApp, retirarNoApp } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
// …
/** RN-107: IP e user-agent da requisição (prova do ato no app). */
async function origemDaRequisicao() {
  const h = await headers();
  return { ip: clientIp(h, getEnv().TRUSTED_PROXIES), userAgent: h.get('user-agent') };
}

/** US-106 "Autorizo o envio para fora do Brasil" (/p/perfil/ia): grava e volta a Eu com o retorno. */
export async function autorizarIaAction(): Promise<void> {
  const { ctx } = await requirePaciente('/p/perfil/ia');
  const env = getEnv();
  try {
    await autorizarNoApp(ctx, { ia: configIA(env), appUrl: env.APP_URL, ...(await origemDaRequisicao()) });
  } catch (e) {
    // a IA foi desativada (ou o perfil ficou incompleto) entre a leitura e o toque: Eu mostra a situação de agora
    if (e instanceof AutorizacaoError) redirect('/p/perfil');
    throw e;
  }
  redirect('/p/perfil?ia=autorizou');
}

/** US-109 "Retirar autorização" no app: o evento e o job ia-retirada na mesma transação (RN-108). */
export async function retirarIaAction(_prev: PerfilState): Promise<PerfilState> {
  const { ctx } = await requirePaciente('/p/perfil');
  const r = await retirarNoApp(ctx, await origemDaRequisicao());
  revalidatePath('/p/perfil');
  return r === 'retirada' ? { ok: MSG_AUTORIZACAO.retirada } : {};
}
```

- [ ] **Step 3: O bloco em Eu › Privacidade**

`src/app/p/(portal)/perfil/privacidade.tsx`:

```tsx
'use client';
import Link from 'next/link';
import { useActionState } from 'react';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { exclusaoAction, meusDadosAction, retirarIaAction, type PerfilState } from './actions';

// … (CONFIRMAR_EXCLUSAO e Retorno como estão)

/** US-106 / US-109: o que o bloco de IA mostra, montado no servidor (page.tsx). */
export type BlocoIaNaTela = { situacao: string; lerEDecidir: boolean; retirar: boolean; retorno: string };

/** US-046: "Baixar meus dados" e "Pedir exclusão dos meus dados"; antes, o texto da RN-214 e (Plano 14A) o bloco de IA. */
export function Privacidade({ ia }: { ia: BlocoIaNaTela | null }) {
  const [dados, pedirDados, pedindo] = useActionState<PerfilState>(meusDadosAction, {});
  const [exc, pedirExc, excluindo] = useActionState<PerfilState>(exclusaoAction, {});
  const [ret, retirar, retirando] = useActionState<PerfilState>(retirarIaAction, {});
  return (
    <div className="space-y-4">
      {/* (o parágrafo da RN-214, como está) */}
      {ia && (
        <section aria-labelledby="eu-ia" className="space-y-2 rounded-xl border border-borda p-3">
          <h3 id="eu-ia" className="font-semibold">{MSG_AUTORIZACAO.blocoTitulo}</h3>
          <p>{ia.situacao}</p>
          {ia.lerEDecidir && (
            <Link href="/p/perfil/ia" className="inline-flex min-h-11 items-center font-semibold text-link underline">
              {MSG_AUTORIZACAO.lerEDecidir}
            </Link>
          )}
          {ia.retirar && (
            <form
              action={retirar}
              onSubmit={(e) => {
                if (!window.confirm(MSG_AUTORIZACAO.confirmarRetirada)) e.preventDefault();
              }}
            >
              <button disabled={retirando} className="min-h-11 rounded-xl border border-borda bg-cartao px-4">
                {MSG_AUTORIZACAO.retirarAutorizacao}
              </button>
            </form>
          )}
          {/* RNF-10: a região existe desde o início; o retorno do ?ia= (autorizou / agora-nao) ou o da retirada */}
          <p role="status">{ret.ok ?? ia.retorno}</p>
        </section>
      )}
      {/* (os formulários de "Baixar meus dados" e "Pedir exclusão dos meus dados", como estão) */}
    </div>
  );
}
```

Em `src/app/p/(portal)/perfil/page.tsx`:

```tsx
import { blocoIaDoApp, type SituacaoAutorizacao } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { formatarDataNoFuso } from '@/modules/pacientes/datas';
import { Privacidade, type BlocoIaNaTela } from './privacidade';
// …
/** US-106 / US-109: a frase da situação e os botões do bloco (no fuso do consultório). */
function blocoNaTela(b: { situacao: SituacaoAutorizacao; podeDecidir: boolean }, fuso: string, ia: string | undefined): BlocoIaNaTela {
  const s = b.situacao;
  const data = (d: Date) => formatarDataNoFuso(d, fuso);
  const situacao =
    s.tipo === 'vigente' ? MSG_AUTORIZACAO.voceAutorizou(data(s.em), s.versao)
    : s.tipo === 'retirada' ? MSG_AUTORIZACAO.voceRetirou(data(s.em))
    : s.tipo === 'nunca' ? MSG_AUTORIZACAO.voceNaoAutorizou
    : MSG_AUTORIZACAO.textoMudou; // versão antiga ou outro destino (RN-109)
  return {
    situacao,
    lerEDecidir: b.podeDecidir && s.tipo !== 'vigente',
    retirar: s.tipo === 'vigente' || s.tipo === 'versao_antiga' || s.tipo === 'outro_destino', // US-106 "Retirar sempre possível"
    retorno: ia === 'autorizou' ? MSG_AUTORIZACAO.registradaApp : ia === 'agora-nao' ? MSG_AUTORIZACAO.tudoBem : '',
  };
}

export default async function Eu({ searchParams }: PageProps<'/p/perfil'>) {
  const acesso = await requirePaciente('/p/perfil');
  const { ctx, data, tenant, vinculo, vinculos } = acesso;
  const busca = await searchParams;
  const [moldura, whatsapp, bloco] = await Promise.all([molduraDaSecao(acesso), situacaoDoWhatsapp(ctx), blocoIaDoApp(ctx, tenant, configIA(getEnv()))]);
  const ia = bloco ? blocoNaTela(bloco, tenant.fuso, typeof busca.ia === 'string' ? busca.ia : undefined) : null;
  // … (o resto como está, com <Privacidade ia={ia} /> no cartão "Privacidade")
```

(No mock de `@/lib/paciente-session` do `page.test.ts`, o `tenant` ganha `fuso: 'America/Sao_Paulo'`.)

- [ ] **Step 4: A página `/p/perfil/ia`**

Criar `src/app/p/(portal)/perfil/ia/page.tsx`:

```tsx
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Faixa } from '@/components/portal/faixa';
import { MSG_G } from '@/components/portal/textos';
import { TextoLegalView } from '@/components/texto-legal';
import { getEnv } from '@/env';
import { requirePaciente } from '@/lib/paciente-session';
import { blocoIaDoApp } from '@/modules/ia/autorizacao';
import { MSG_AUTORIZACAO } from '@/modules/ia/constantes';
import { configIA } from '@/modules/ia/modo';
import { AUTORIZACAO_IA_VERSAO, responsavelDoTenant, textoDaAutorizacao } from '@/modules/ia/textos-legais';
import { molduraDaSecao } from '../../../moldura';
import { autorizarIaAction } from '../actions';

export const dynamic = 'force-dynamic';

/**
 * US-106 "Ler e autorizar": a autorização numa página própria, com o texto inteiro e em destaque, separada do termo do app
 * (art. 33, VIII; C12). Só com algo a decidir (IA ativa no consultório do vínculo aberto, perfil completo, não vigente);
 * senão volta a Eu. "Agora não" não grava nada (volta a Eu com "Tudo bem…").
 */
export default async function AutorizacaoIa() {
  const acesso = await requirePaciente('/p/perfil/ia');
  const { ctx, tenant } = acesso;
  const ia = configIA(getEnv());
  const bloco = await blocoIaDoApp(ctx, tenant, ia);
  const responsavel = responsavelDoTenant(tenant);
  if (!bloco?.podeDecidir || bloco.situacao.tipo === 'vigente' || !responsavel || !ia.destino) redirect('/p/perfil');
  const texto = textoDaAutorizacao(AUTORIZACAO_IA_VERSAO, { ...responsavel, destino: ia.destino, canal: 'app' })!;
  const moldura = await molduraDaSecao(acesso);
  return (
    <>
      <Faixa {...moldura} atual="/p/perfil" titulo={MSG_G.titulos.eu} />
      <main className="space-y-4 p-4">
        <p className="text-suave">{tenant.nomeExibicao}</p>
        <section className="space-y-3 rounded-2xl border border-borda bg-cartao p-4">
          <TextoLegalView texto={texto} id="autorizacao-ia" nivel="h2" classeTitulo="font-portal-titulo text-lg font-bold" />
        </section>
        <div className="flex flex-wrap gap-3">
          <form action={autorizarIaAction}>
            <button className="min-h-11 rounded-xl bg-destaque px-4 font-semibold text-white">{MSG_AUTORIZACAO.autorizo}</button>
          </form>
          <Link href="/p/perfil?ia=agora-nao" className="inline-flex min-h-11 items-center rounded-xl border border-borda bg-cartao px-4">
            {MSG_AUTORIZACAO.agoraNao}
          </Link>
        </div>
      </main>
    </>
  );
}
```

(As classes do botão principal seguem o botão primário do portal do Plano 16; se o Plano 16 tiver um componente de botão do portal, usar o componente.)

- [ ] **Step 5: Rodar e conferir**

Run: `pnpm vitest run "src/app/p" src/app/formularios-post.test.ts src/modules/ajuda`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros. Conferir à mão com `pnpm dev` e o portal no celular (390 px): o bloco nos três estados, a página `/p/perfil/ia` rolando o texto inteiro, o modo escuro, o foco do teclado nos dois botões.

- [ ] **Step 6: Commit**

```bash
git add "src/app/p/(portal)/perfil"
git commit -m "feat(portal): bloco de IA em Eu › Privacidade e a página da autorização (/p/perfil/ia) (P14A-08)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 9: LGPD — autorizações e destino na exportação, termo no ZIP, anonimização e o bloqueio que não apaga a prova (P14A-09)

**Revisão: completa (agente normas-cfn-lgpd)** — direitos do titular (art. 18, II e VII), prova do consentimento (art. 8º, § 2º) guardada até a anonimização, o que a anonimização tira e o que fica, destino de cada saída na exportação.

**Files:**
- Modify: `src/modules/pacientes/exportacao-job.ts`, `src/modules/pacientes/exportacao.test.ts`, `src/modules/pacientes/lgpd.ts`, `src/modules/pacientes/lgpd.test.ts`, `src/modules/ia/constantes.ts` (sai `PROVEDOR_IA_DESCRICAO`), `CLAUDE.md` (regra 9)

**Interfaces:**
- Consumes: `iaAutorizacoes`, `iaTarefas.destino`, `app_ia_autorizacao_soltar_termo`, `app_anonimizar_autorizacoes_ia` (T1); `DESTINO_ROTULO`, `ROTULO_DESTINO_LEGADO`, `DestinoIA` (T2); `apagarArquivo`, `salvarArquivo`, `anexosDoPaciente`, `anonimizarVencidos`, `montarDados`, `gerarExportacao` (existentes).
- Produces: `DadosExportacao.paciente.autorizacoesIa`, `DadosExportacao.ia[].destino`, os campos legados opcionais; `apagarTermosDeAutorizacao`, `termosDeAutorizacaoRestantes` (`lgpd.ts`).

- [ ] **Step 1: Os testes que falham — exportação**

Em `src/modules/pacientes/exportacao.test.ts`: trocar o import de `PROVEDOR_IA_DESCRICAO` por `import { DESTINO_ROTULO } from '@/modules/ia/constantes';` (e, no teste do Plano 11, `provedor: PROVEDOR_IA_DESCRICAO` por `provedor: DESTINO_ROTULO['anthropic-us'], destino: null`, e `destino: null` nas outras duas linhas esperadas); acrescentar `const dono = makeDb(inject('ownerDatabaseUrl'));` (com `await dono.pool.end()` no `afterAll`) e `iaAutorizacoes` ao import de `@/db/schema`; trocar o teste "Plano 11 (revisão final …) ciência do aviso" por:

```ts
  it('RN-128 (Plano 14A): os campos legados da ciência saem só quando preenchidos', async () => {
    const T = await novoTenant(app.db);
    const informado = await novoPaciente(app.db, T.ctx);
    const nunca = await novoPaciente(app.db, T.ctx);
    // contexto vazio (o gatilho da T10 congela as colunas para qualquer sessão do app)
    await dono.db.update(patients).set({ iaAvisoVersao: '0.1-provisorio', iaAvisoEm: now, iaAvisoCanal: 'em_maos', iaRecusadaEm: now }).where(eq(patients.id, informado.id));
    for (const escopo of ['equipe', 'titular'] as const) {
      const a = await withTenant(T.ctx, (tx) => montarDados(tx, informado.id, now, 'America/Sao_Paulo', escopo), app.db);
      expect(a.dados.paciente, escopo).toMatchObject({ avisoIa: { versao: '0.1-provisorio', em: now.toISOString(), canal: 'em_maos' }, recusouIaEm: now.toISOString() });
      expect(a.dados.paciente, escopo).not.toHaveProperty('avisoIaEnviadoEm');
      const b = await withTenant(T.ctx, (tx) => montarDados(tx, nunca.id, now, 'America/Sao_Paulo', escopo), app.db);
      for (const campo of ['avisoIa', 'avisoIaEnviadoEm', 'recusouIaEm']) expect(b.dados.paciente, `${escopo} ${campo}`).not.toHaveProperty(campo);
    }
  });

  it('US-113: a seção ia traz o destino gravado no portão (antiga com saída e sem destino = Anthropic, EUA; sem saída, nenhum)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const eu = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'aplicada', linhasAplicadas: 1, encerradoEm: now, criadoEm: now, saiuEm: now, destino: 'bedrock-eu' });
    const antiga = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'aplicada', linhasAplicadas: 1, encerradoEm: now, criadoEm: now, saiuEm: now });
    const naoSaiu = await tarefaNoBanco(app.db, T.ctx, p.id, null, { status: 'falhou', erro: 'sem_autorizacao', criadoEm: now });
    const { dados } = await withTenant(T.ctx, (tx) => montarDados(tx, p.id, now, 'America/Sao_Paulo', 'titular'), app.db);
    expect(dados.ia.find((t) => t.id === eu)).toMatchObject({ destino: 'bedrock-eu', provedor: 'Amazon Web Services (Claude), União Europeia', enviadoEm: now.toISOString() });
    expect(dados.ia.find((t) => t.id === antiga)).toMatchObject({ destino: null, provedor: 'Anthropic (Claude), Estados Unidos' });
    expect(dados.ia.find((t) => t.id === naoSaiu)).toMatchObject({ destino: null, provedor: null, enviadoEm: null });
  });

  it('US-113: autorizacoesIa (evento, versão, usos, destino com código e rótulo, canal, datas, IP e user-agent; nunca o HMAC) e o termo em papel no ZIP (autorizacao-ia/)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 0x20)]);
    const termo = await salvarArquivo(T.ctx, { tipo: 'ia_autorizacao_termo', conteudo: PDF, permitidos: ['pdf'], patientId: p.id }, { db: app.db, dataDir });
    const USOS = sql`array['leitura_laudos','resumo_historico','rascunho_plano']::text[]`;
    await withTenant(T.ctx, async (tx) => {
      await tx.execute(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, canal, registrado_por, email_hmac) values (${T.tenantId}, ${p.id}, 'pedido_email', '0.1-provisorio', 'link', ${T.nutriId}, 'hmac-secreto')`);
      await tx.execute(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, arquivo_path, em) values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', ${USOS}, 'bedrock-eu', 'papel', ${T.nutriId}, ${termo.caminho}, '2026-10-01T03:00:00Z')`);
    }, app.db);
    await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.execute(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por, ip, user_agent) values (${T.tenantId}, ${p.id}, 'retirou', 'app', app_current_user(), '203.0.113.7', 'Mozilla/5.0')`), app.db);
    for (const escopo of ['equipe', 'titular'] as const) {
      const { dados } = await withTenant(T.ctx, (tx) => montarDados(tx, p.id, now, 'America/Sao_Paulo', escopo), app.db);
      expect(dados.paciente.autorizacoesIa, escopo).toEqual([
        { evento: 'pedido_email', versao: '0.1-provisorio', usos: null, destino: null, canal: 'link', em: expect.any(String), registradoEm: expect.any(String), ip: null, userAgent: null, termo: null },
        { evento: 'autorizou', versao: '0.1-provisorio', usos: ['leitura_laudos', 'resumo_historico', 'rascunho_plano'], destino: { codigo: 'bedrock-eu', rotulo: 'Amazon Web Services (Claude), União Europeia' }, canal: 'papel', em: '2026-10-01T03:00:00.000Z', registradoEm: expect.any(String), ip: null, userAgent: null, termo: null },
        { evento: 'retirou', versao: null, usos: null, destino: null, canal: 'app', em: expect.any(String), registradoEm: expect.any(String), ip: '203.0.113.7', userAgent: 'Mozilla/5.0', termo: null },
      ]);
      expect(JSON.stringify(dados), escopo).not.toContain('hmac-secreto');
    }
    const id = await solicitarExportacao(T.ctx, p.id, deps);
    await gerarExportacao({ tenantId: T.tenantId, exportId: id }, { db: app.db, dataDir, appUrl: 'http://localhost:3000', ultimaTentativa: false });
    const zip = await zipDoPedido(T, id);
    const nome = Object.keys(zip).find((n) => n.startsWith('autorizacao-ia/'));
    expect(nome).toBe('autorizacao-ia/2026-10-01-01.pdf');
    expect(Buffer.from(zip[nome!]).equals(PDF)).toBe(true);
    const dados = JSON.parse(strFromU8(zip['dados.json']));
    expect(dados.paciente.autorizacoesIa[1].termo).toBe('autorizacao-ia/2026-10-01-01.pdf');
  });
```

(`deps` e `zipDoPedido` são os helpers do arquivo; se o job do teste vizinho for chamado com outras dependências, usar as dele.)

Run: `pnpm vitest run src/modules/pacientes/exportacao.test.ts`
Expected: FAIL (`autorizacoesIa`, `destino` e o termo no ZIP não existem; os campos legados saem sempre).

- [ ] **Step 2: A exportação**

Em `src/modules/pacientes/exportacao-job.ts`:

1. Imports: `iaAutorizacoes` em `@/db/schema`; `import { DESTINO_ROTULO, ROTULO_DESTINO_LEGADO, type DestinoIA } from '@/modules/ia/constantes';` (sai `PROVEDOR_IA_DESCRICAO`).
2. No tipo `DadosExportacao`, em `paciente`, os legados viram opcionais e entra a lista nova:

```ts
    /**
     * Plano 11 (legado, RN-128): a ciência do aviso de IA e o "Não usar IA" — saem só quando preenchidos (as colunas estão
     * congeladas desde o Plano 14A; o esperado em produção é nunca).
     */
    avisoIa?: { versao: string; em: string; canal: string };
    avisoIaEnviadoEm?: string;
    recusouIaEm?: string;
    /**
     * Plano 14A (US-113, LGPD art. 18): cada evento da autorização de IA — autorizou, retirou, pedido por e-mail — com a
     * versão, os usos, o destino (código e rótulo, RN-109), o canal, o ato, o registro, o IP e o user-agent (nulos no papel,
     * no pedido e na retirada pela nutricionista); `termo` = a foto ou o PDF do termo em papel no ZIP (`autorizacao-ia/…`).
     * O HMAC do e-mail não sai (não serve ao titular).
     */
    autorizacoesIa: {
      evento: string; versao: string | null; usos: string[] | null; destino: { codigo: string; rotulo: string } | null; canal: string;
      em: string; registradoEm: string; ip: string | null; userAgent: string | null; termo: string | null;
    }[];
```

e, em `ia`, o item ganha `destino: string | null` (comentário: "RN-109: o código gravado no portão do envio; `provedor` é o rótulo dele — tarefa antiga com saída e sem destino = Anthropic, EUA, o único provedor do Plano 11").
3. `AnexoParaZip.tipo` ganha `'termo'` (comentário: "termo em papel da autorização de IA (`indice` em `paciente.autorizacoesIa`, Plano 14A)").
4. Em `montarDados`, depois da leitura de `tarefasIa`:

```ts
  // Plano 14A (US-113): os eventos da autorização de IA, na ordem em que foram registrados (o titular lê os próprios — sem staff_only)
  const autorizacoes = await tx
    .select({ evento: iaAutorizacoes.evento, versao: iaAutorizacoes.versao, usos: iaAutorizacoes.usos, destino: iaAutorizacoes.destino, canal: iaAutorizacoes.canal, em: iaAutorizacoes.em, registradoEm: iaAutorizacoes.registradoEm, ip: iaAutorizacoes.ip, userAgent: iaAutorizacoes.userAgent, arquivoPath: iaAutorizacoes.arquivoPath })
    .from(iaAutorizacoes)
    .where(eq(iaAutorizacoes.patientId, patientId))
    .orderBy(asc(iaAutorizacoes.registradoEm), asc(iaAutorizacoes.id));
  let nTermo = 0;
  const termos: AnexoParaZip[] = autorizacoes.flatMap((a, i) =>
    a.arquivoPath ? [{ tipo: 'termo' as const, indice: i, caminho: a.arquivoPath, nome: `autorizacao-ia/${a.em.toISOString().slice(0, 10)}-${String(++nTermo).padStart(2, '0')}${path.extname(a.arquivoPath)}` }] : [],
  );
```

(o nome é a data do ato e a ordem entre os termos — sem texto do usuário, regra 9.) No objeto `paciente`, trocar as três linhas dos legados por:

```ts
      ...(p.iaAvisoVersao && p.iaAvisoEm && p.iaAvisoCanal ? { avisoIa: { versao: p.iaAvisoVersao, em: p.iaAvisoEm.toISOString(), canal: p.iaAvisoCanal } } : {}),
      ...(p.iaAvisoEnviadoEm ? { avisoIaEnviadoEm: p.iaAvisoEnviadoEm.toISOString() } : {}),
      ...(p.iaRecusadaEm ? { recusouIaEm: p.iaRecusadaEm.toISOString() } : {}),
      autorizacoesIa: autorizacoes.map((a) => ({
        evento: a.evento, versao: a.versao, usos: a.usos, canal: a.canal,
        destino: a.destino ? { codigo: a.destino, rotulo: DESTINO_ROTULO[a.destino as DestinoIA] } : null,
        em: a.em.toISOString(), registradoEm: a.registradoEm.toISOString(), ip: a.ip, userAgent: a.userAgent, termo: null,
      })),
```

na seção `ia`:

```ts
    // RN-109 (Plano 14A): o destino gravado no portão; tarefa antiga com saída e sem destino = Anthropic, EUA (Plano 11)
    ia: tarefasIa.map((t) => ({
      id: t.id, tipo: t.tipo, status: t.status, criadoEm: t.criadoEm.toISOString(), encerradoEm: t.encerradoEm?.toISOString() ?? null,
      enviadoEm: t.saiuEm?.toISOString() ?? null,
      destino: t.destino,
      provedor: t.saiuEm ? (t.destino ? DESTINO_ROTULO[t.destino as DestinoIA] : ROTULO_DESTINO_LEGADO) : null,
    })),
```

(com `destino: iaTarefas.destino` no `select` de `tarefasIa`) e, no retorno, `laudos: [...laudos, ...fotos, ...envios, ...pdfsDeDocumentos, ...termos]`. Em `lerAnexos`, depois do ramo `envio`:

```ts
    else if (l.tipo === 'termo') dados.paciente.autorizacoesIa[l.indice].termo = l.nome;
```

Conferir que `src/modules/pacientes/prontuario-pdf.tsx` não lê `avisoIa`/`avisoIaEnviadoEm`/`recusouIaEm` (`git grep -n "avisoIa\|recusouIaEm" src/modules/pacientes` — só `exportacao-job.ts`).

Em `src/modules/ia/constantes.ts`, apagar `PROVEDOR_IA_DESCRICAO` (o último uso era a exportação).

Run: `pnpm vitest run src/modules/pacientes/exportacao.test.ts`
Expected: PASS (inclusive a guarda do grafo do worker no mesmo arquivo).

- [ ] **Step 3: Os testes que falham — bloqueio e anonimização**

Em `src/modules/pacientes/lgpd.test.ts` (imports: `iaAutorizacoes` de `@/db/schema`; `salvarArquivo` de `@/modules/plataforma/armazenamento`; `ctxPaciente` de `test/pacientes`):

```ts
/** Plano 14A: um termo em papel do paciente (arquivo no disco + a autorização que aponta para ele). */
const termoEmPapel = async (T: TenantDeTeste, patientId: string) => {
  const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 0x20)]);
  const a = await salvarArquivo(T.ctx, { tipo: 'ia_autorizacao_termo', conteudo: PDF, permitidos: ['pdf'], patientId }, { db: app.db, dataDir });
  await withTenant(T.ctx, (tx) => tx.execute(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, registrado_por, arquivo_path, em)
    values (${T.tenantId}, ${patientId}, 'autorizou', '0.1-provisorio', array['leitura_laudos','resumo_historico','rascunho_plano']::text[], 'teste', 'papel', ${T.nutriId}, ${a.caminho}, now())`), app.db);
  return a.caminho;
};
const autorizacoesDe = (T: TenantDeTeste, patientId: string) =>
  withTenant(T.ctx, (tx) => tx.select().from(iaAutorizacoes).where(eq(iaAutorizacoes.patientId, patientId)), app.db);

describe('Plano 14A — a autorização de IA na LGPD (US-113, RNF-111 g)', () => {
  it('o pedido de exclusão (bloqueio) e a rede de segurança das fotos NÃO apagam o termo nem as linhas (são a prova até a anonimização)', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const caminho = await termoEmPapel(T, p.id);
    await atenderPedidoExclusao(T.ctx, T.tenant, p.id, p.nome, deps);
    const [job] = await jobsDaExclusao(p.id);
    await concluirExclusaoAtendida(job, { db: app.db, dataDir, ultimaTentativa: false });
    await anonimizarSo(T); // o prazo de guarda não venceu: só a rede de segurança dos bloqueados
    expect(existsSync(path.join(dataDir, caminho))).toBe(true);
    expect(await autorizacoesDe(T, p.id)).toEqual([expect.objectContaining({ arquivoPath: caminho })]);
  });

  it('a anonimização apaga o termo num passo próprio e tira IP, user-agent, HMAC e a conta do canal app; nenhuma linha é apagada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const caminho = await termoEmPapel(T, p.id);
    const conta = randomUUID();
    await withTenant(ctxPaciente(T.tenantId, p.id, conta), (tx) => tx.execute(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, canal, registrado_por, ip, user_agent)
      values (${T.tenantId}, ${p.id}, 'retirou', 'app', ${conta}, '203.0.113.7', 'Mozilla/5.0')`), app.db);
    await withTenant({ tenantId: T.tenantId, role: 'paciente', patientId: p.id, semConta: true }, (tx) => tx.execute(sql`insert into ia_autorizacoes (tenant_id, patient_id, evento, versao, usos, destino, canal, email_hmac, ip)
      values (${T.tenantId}, ${p.id}, 'autorizou', '0.1-provisorio', array['leitura_laudos']::text[], 'teste', 'link', 'hmac-do-email', '203.0.113.8')`), app.db);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ status: 'bloqueado', anonimizarApos: '2026-09-30' }).where(eq(patients.id, p.id)), app.db);
    expect((await anonimizarSo(T)).anonimizados).toBeGreaterThanOrEqual(1);
    expect(existsSync(path.join(dataDir, caminho))).toBe(false);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.caminho, caminho)), app.db)).toEqual([]);
    const linhas = await autorizacoesDe(T, p.id);
    expect(linhas).toHaveLength(3);
    for (const l of linhas) expect(l, l.canal).toMatchObject({ ip: null, userAgent: null, emailHmac: null, arquivoPath: null });
    expect(linhas.find((l) => l.canal === 'app')?.registradoPor).toBeNull();
    expect(linhas.find((l) => l.canal === 'papel')?.registradoPor).toBe(T.nutriId);
    expect((await ler(T.ctx, p.id)).anonimizadoEm).not.toBeNull();
  });
});
```

(`randomUUID`, `existsSync`, `path`, `storedFiles`, `patients`, `sql` e os helpers `anonimizarSo`, `jobsDaExclusao`, `ler`, `deps` já existem no arquivo; o mock de `apagarArquivo` do topo do arquivo continua chamando o real.)

Run: `pnpm vitest run src/modules/pacientes/lgpd.test.ts`
Expected: FAIL na anonimização (o termo não é apagado — `anexosDoPaciente` não o lista — e a FK `NO ACTION` não deixa apagar o `stored_files`; as linhas mantêm IP e HMAC).

- [ ] **Step 4: A anonimização**

Em `src/modules/pacientes/lgpd.ts` (imports: `iaAutorizacoes` de `@/db/schema`, `isNotNull` já importado):

```ts
/**
 * US-113 (Plano 14A): os termos em papel da autorização de IA do titular — cada arquivo no seu apagarArquivo, com o `rm`
 * antes do commit e o ponteiro anulado no naMesmaTransacao pela função SECURITY DEFINER (FK NO ACTION; o UPDATE de
 * ia_autorizacoes é revogado do app). Só na anonimização (contexto worker, titular bloqueado): nunca no pedido de exclusão,
 * em que o termo ainda é a prova do consentimento (art. 8º, § 2º). Fora de anexosDoPaciente por causa da FK.
 */
export async function apagarTermosDeAutorizacao(ctx: TenantContext, patientId: string, deps: { db?: Db; dataDir?: string }): Promise<number> {
  const db = deps.db ?? getDb();
  const termos = await withTenant(
    ctx,
    (tx) => tx.select({ id: iaAutorizacoes.id, caminho: iaAutorizacoes.arquivoPath }).from(iaAutorizacoes).where(and(eq(iaAutorizacoes.patientId, patientId), isNotNull(iaAutorizacoes.arquivoPath))),
    db,
  );
  let apagados = 0;
  for (const t of termos) {
    const ok = await apagarArquivo(ctx, { caminho: t.caminho! }, {
      db,
      dataDir: deps.dataDir,
      removerAntesDoCommit: true,
      naMesmaTransacao: async (tx) => ((await tx.execute(sql`select app_ia_autorizacao_soltar_termo(${t.id}) as ok`)).rows[0] as { ok?: boolean } | undefined)?.ok === true,
    });
    if (ok) apagados++;
  }
  return apagados;
}

/** Com o paciente travado: um termo gravado depois da lista desfaz a anonimização (o dia seguinte tenta de novo). */
export async function termosDeAutorizacaoRestantes(tx: Tx, patientId: string): Promise<boolean> {
  const [t] = await tx.select({ id: iaAutorizacoes.id }).from(iaAutorizacoes).where(and(eq(iaAutorizacoes.patientId, patientId), isNotNull(iaAutorizacoes.arquivoPath))).limit(1);
  return !!t;
}
```

Em `anonimizarVencidos`, depois de `apagarEnviosDoTitular(…)` e antes do laço de `anexosDoPaciente`:

```ts
        // Plano 14A (US-113): os termos em papel da autorização de IA, num passo próprio (FK NO ACTION, função do worker)
        await apagarTermosDeAutorizacao(ctx, id, { db, dataDir: deps.dataDir });
```

na transação final, logo depois de `select app_anonimizar_aceites(${id})`:

```ts
            // Plano 14A (US-113): as autorizações de IA ficam (prova), sem IP, user-agent, HMAC e, no canal app, sem a conta
            await tx.execute(sql`select app_anonimizar_autorizacoes_ia(${id})`);
```

e, depois da conferência de `pdfsDeDocumentosRestantes`:

```ts
            if (r.length && (await termosDeAutorizacaoRestantes(tx, id))) throw new Error('termo de autorização novo durante a anonimização');
```

Em `CLAUDE.md`, regra 9, depois da frase do Plano 12:

```markdown
Plano 14A: o termo em papel da autorização de IA (`ia_autorizacao_termo`, FK `NO ACTION` em `ia_autorizacoes.arquivo_path`) é gravado só por `registrarTermoEmPapel` (`src/modules/ia/autorizacao.ts`: `salvarArquivo` com o paciente travado no `antesDaReserva` e a linha no `registrar`), servido só por "Ver termo assinado" (`caminhoDoTermo`, `auditRead`, `signFileUrl`) e apagado só na anonimização, por `apagarTermosDeAutorizacao` (`src/modules/pacientes/lgpd.ts`, antes de `anexosDoPaciente`, com `app_ia_autorizacao_soltar_termo` no `naMesmaTransacao`) — nunca no pedido de exclusão; entra no ZIP da exportação (`autorizacao-ia/`).
```

- [ ] **Step 5: Rodar e conferir**

Run: `pnpm vitest run src/modules/pacientes src/modules/ia test/isolamento.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/modules/pacientes/exportacao-job.ts src/modules/pacientes/exportacao.test.ts src/modules/pacientes/lgpd.ts src/modules/pacientes/lgpd.test.ts src/modules/ia/constantes.ts CLAUDE.md
git commit -m "feat(lgpd): autorizações de IA e destino na exportação, termo no ZIP, anonimização das autorizações e o bloqueio que guarda a prova (P14A-09)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 10: Legado do Plano 11 (RN-128) — colunas de ciência congeladas (0109), o e-mail `aviso_ia` descartado e a ciência fora do código (P14A-10)

**Revisão: completa (agente revisor-rls)** — gatilho refeito sem brecha (qualquer sessão do app), janela do deploy (job antigo na fila), nada do código ainda gravando nas colunas, remoção sem quebrar a exportação do legado.

**Files:**
- Create: `drizzle/0109_ia_ciencia_congelada.sql` (custom)
- Delete: `src/modules/ia/ciencia-paciente.ts`, `src/modules/ia/ciencia-paciente.test.ts`
- Modify: `src/db/ia-schema.test.ts`, `src/db/schema/pacientes.ts` (comentários), `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/email/job.ts`, `src/email/email.test.ts`, `src/worker/index.ts`, `src/modules/ia/textos-legais.ts` (+ test), `src/modules/ia/constantes.ts` (`MSG_IA` legado), `test/ia.ts` (sai `pacienteInformado`)

**Interfaces:**
- Consumes: `app_patients_ia_quem` (0099/0100), `processEmailJob`, `sealSecret`/`EMAIL_FINALIDADE` (nos testes).
- Produces: as colunas `patients.ia_aviso_*`/`ia_recusada_em` só mudam no contexto vazio; `processEmailJob` sem `aposEnviar`/`aoDesistir`/`ultimaTentativa`, descartando o tipo legado `aviso_ia`; `MSG_IA` sem `semCiencia`, `recusou`, `naoInformado`, `avisoEnviado`, `aguardandoEnvio`, `informado` (o `MSG_FALHA.paciente_nao_informado` fica com o texto literal).

- [ ] **Step 1: Os testes que falham**

Em `src/db/ia-schema.test.ts`, acrescentar `const dono = makeDb(inject('ownerDatabaseUrl'));` (e `await dono.pool.end()` no `afterAll`); trocar os testes "defesa em profundidade (gatilho patients_ia_quem)…" e "Minor 1 (revisão final): com canal e-mail…" por:

```ts
  it('RN-128 (Plano 14A, 0109): as colunas de ciência e recusa do Plano 11 estão congeladas para qualquer sessão do app; no contexto vazio, passam', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    // (o contexto publico não vê a linha para o UPDATE — PUBLICO_LIBERADO.patients é só select/insert —, então só o INSERT dele abaixo)
    const contextos = [T.ctx, { tenantId: T.tenantId, role: 'worker' as const }];
    for (const ctx of contextos) {
      for (const set of [{ iaRecusadaEm: new Date() }, { iaAvisoEnviadoEm: new Date() }, { iaAvisoVersao: '0.1-provisorio', iaAvisoEm: new Date(), iaAvisoCanal: 'em_maos' }]) {
        expect(await falhaCom(withTenant(ctx, (tx) => tx.update(patients).set(set).where(eq(patients.id, p.id)), app.db)), `${ctx.role} ${Object.keys(set)}`).toBe('42501');
      }
    }
    expect(await falhaCom(novoPaciente(app.db, T.ctx, { iaAvisoVersao: '1', iaAvisoEm: new Date(), iaAvisoCanal: 'em_maos' }))).toBe('42501');
    expect(await falhaCom(novoPaciente(app.db, { tenantId: T.tenantId, role: 'publico' }, { origem: 'agendamento_publico', iaRecusadaEm: new Date() }))).toBe('42501');
    // contexto vazio (migration, script do dono): passa — a remoção futura das colunas é a PM-17
    await dono.db.update(patients).set({ iaRecusadaEm: new Date() }).where(eq(patients.id, p.id));
    // o resto do cadastro segue livre para a nutricionista
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ nome: 'Ana Souza Lima' }).where(eq(patients.id, p.id)), app.db);
  });
```

e, no teste "a ciência é 'tudo ou nada' e o canal é da lista", gravar pelo `dono` (o gatilho recusa antes do CHECK em qualquer sessão do app):

```ts
    expect(await falhaCom(dono.db.insert(patients).values({ tenantId: T.tenantId, nome: 'X', iaAvisoVersao: '0.1-provisorio' }))).toBe('23514');
    expect(await falhaCom(dono.db.insert(patients).values({ tenantId: T.tenantId, nome: 'X', iaAvisoVersao: '1', iaAvisoEm: new Date(), iaAvisoCanal: 'whatsapp' }))).toBe('23514');
```

(o teste da sessão de paciente — gatilho `paciente_colunas`, 0085 — continua: o código é o mesmo 42501.)

Em `src/email/email.test.ts`, trocar os dois testes do Plano 11 (`aposEnviar` e `aoDesistir`) por:

```ts
  it('RN-128 (Plano 14A): um e-mail aviso_ia que estava na fila no deploy termina sem enviar e sem erro (tipo legado)', async () => {
    const enviados: string[] = [];
    const legado = { tipo: 'aviso_ia', para: 'p@x.dev', nome: 'Ana', consultorio: 'Debby', versao: '0.1-provisorio', patientId: '00000000-0000-4000-8000-000000000001', enviadoEm: '2026-10-06T15:00:00.000Z' };
    const data = { tenantId: '00000000-0000-4000-8000-0000000000aa', selado: sealSecret(JSON.stringify(legado), EMAIL_FINALIDADE) };
    expect(await processEmailJob(data, 'j-legado', { transport: { send: async () => void enviados.push('send') }, from: 'a@b.dev', tenantAtivo: async () => true })).toBe('ignorado');
    expect(enviados).toEqual([]);
  });
```

Em `src/email/render.test.ts`, apagar o teste `aviso_ia: …`. Em `src/modules/ia/textos-legais.test.ts`, apagar o teste "o aviso declara provedor, país…" e, no "a versão atual atende à mínima…", a linha do `AVISO_IA_VERSAO`.

Run: `pnpm vitest run src/db/ia-schema.test.ts src/email`
Expected: FAIL (o gatilho ainda deixa a nutricionista e o worker gravarem; `processEmailJob` tenta renderizar o `aviso_ia`).

- [ ] **Step 2: A migration**

```bash
pnpm drizzle-kit generate --custom --name ia_ciencia_congelada
```

Conteúdo de `drizzle/0109_ia_ciencia_congelada.sql`:

```sql
-- Plano 14A (spec da IA v0.5.1, RN-128, D17): a ciência do aviso de IA e o "Não usar IA" do Plano 11 saíram do código (a
-- autorização do paciente, ia_autorizacoes, é a condição agora). As colunas FICAM, congeladas: nenhuma sessão do app —
-- qualquer app.role — as grava, nem num INSERT. No contexto vazio (migration, script do dono) passa, para a remoção
-- futura (PM-17: migration destrutiva só com o OK do dono, depois de conferir que estão vazias em produção). A exportação
-- continua a mostrá-las enquanto preenchidas. Janela do deploy: um job aviso_ia pego pelo worker ANTIGO depois desta
-- migration falha aqui e o pg-boss o repete; o worker novo o descarta sem gravar (processEmailJob). Recusa com 42501.
CREATE OR REPLACE FUNCTION app_patients_ia_quem() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_role() IS NOT NULL
     AND ((TG_OP = 'INSERT' AND (NEW.ia_aviso_versao IS NOT NULL OR NEW.ia_aviso_em IS NOT NULL OR NEW.ia_aviso_canal IS NOT NULL
                                 OR NEW.ia_aviso_enviado_em IS NOT NULL OR NEW.ia_recusada_em IS NOT NULL))
          OR (TG_OP = 'UPDATE' AND (NEW.ia_aviso_versao, NEW.ia_aviso_em, NEW.ia_aviso_canal, NEW.ia_aviso_enviado_em, NEW.ia_recusada_em)
              IS DISTINCT FROM (OLD.ia_aviso_versao, OLD.ia_aviso_em, OLD.ia_aviso_canal, OLD.ia_aviso_enviado_em, OLD.ia_recusada_em))) THEN
    RAISE EXCEPTION 'a ciência e a recusa de IA do Plano 11 estão congeladas (RN-128)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
```

(O `CREATE TRIGGER patients_ia_quem` da 0099 continua apontando para a função.) Em `src/db/schema/pacientes.ts`, os comentários das cinco colunas ganham "Congelada desde o Plano 14A (RN-128, 0109): ninguém grava; a exportação a mostra se preenchida".

- [ ] **Step 3: O código do legado sai**

1. `git rm src/modules/ia/ciencia-paciente.ts src/modules/ia/ciencia-paciente.test.ts`.
2. `test/ia.ts`: apagar `pacienteInformado`.
3. `src/email/types.ts`: apagar a variante `aviso_ia` (e o comentário dela). `src/email/templates.tsx`: apagar o `case 'aviso_ia'` e o import de `avisoDaVersao`.
4. `src/email/job.ts`:

```ts
/** RN-128 (Plano 14A): tipos que saíram do código — um job antigo na fila termina sem enviar e sem gravar nada. */
const TIPOS_LEGADOS = new Set(['aviso_ia']);

export async function processEmailJob(
  data: EmailJobData,
  jobId: string,
  deps: { transport: EmailTransport; from: string; tenantAtivo: (tenantId: string) => Promise<boolean>; key?: Buffer },
): Promise<'enviado' | 'ignorado'> {
  if (data.tenantId && !(await deps.tenantAtivo(data.tenantId))) {
    logger.info({ jobId, tenantId: data.tenantId }, 'e-mail ignorado: conta suspensa (RN-15)');
    return 'ignorado';
  }
  const msg = JSON.parse(openSecret(data.selado, EMAIL_FINALIDADE, deps.key)) as EmailMessage;
  if (TIPOS_LEGADOS.has((msg as { tipo: string }).tipo)) {
    logger.info({ jobId, tipo: (msg as { tipo: string }).tipo, tenantId: data.tenantId }, 'e-mail de tipo legado descartado (RN-128)');
    return 'ignorado';
  }
  // Erro aqui sobe para o pg-boss, que tenta de novo (retryLimit da fila)
  const r = renderEmail(msg);
  await deps.transport.send({ from: deps.from, to: msg.para, subject: r.subject, html: r.html, text: r.text, idempotencyKey: jobId });
  logger.info({ jobId, tipo: msg.tipo, tenantId: data.tenantId }, 'e-mail enviado'); // sem destinatário nem link
  return 'enviado';
}
```

(saem `aposEnviar`, `ultimaTentativa` e `aoDesistir`: só serviam ao aviso de IA; `nomeDoErro` sai do import se não sobrar uso.)
5. `src/worker/index.ts`: no `work('email', …)`, o `processEmailJob(job.data, job.id, { transport, from: env.EMAIL_FROM, tenantAtivo: (tenantId) => tenantIsActive(getDb(), tenantId) })` sem os três campos; sai o import de `@/modules/ia/ciencia-paciente`.
6. `src/modules/ia/textos-legais.ts`: apagar `AVISO_IA_VERSAO`, `AVISO_IA_VERSAO_MIN`, `TextoAviso`, `AVISOS_IA` e `avisoDaVersao` (e o comentário "Legado").
7. `src/modules/ia/constantes.ts`: em `MSG_IA`, apagar `semCiencia`, `recusou`, `naoInformado`, `avisoEnviado`, `aguardandoEnvio` e `informado`; em `MSG_FALHA`, `paciente_nao_informado: 'Antes de usar a IA, informe o paciente (Privacidade > Uso de IA).'` (o texto do Plano 11, literal: só exibe linhas antigas — RN-112).

Run: `git grep -n "ciencia-paciente\|aviso_ia\|avisoDaVersao\|AVISO_IA_VERSAO\|pacienteInformado\|MSG_IA.semCiencia\|MSG_IA.recusou\b\|definirRecusaIa\|registrarCienciaPorEmail" -- src test e2e scripts`
Expected: nenhuma linha (fora `src/email/job.ts`, no `TIPOS_LEGADOS`, e o comentário da `0109`). O E2E `ia-laudos.spec.ts` ainda cita o "aviso em mãos": a T11 o troca — se ainda não foi trocado, ele aparece aqui e fica para a T11.

- [ ] **Step 4: Rodar e conferir**

Run: `pnpm vitest run src/db src/email src/modules/ia src/modules/pacientes test/isolamento.test.ts`
Expected: PASS.

Run: `pnpm typecheck && pnpm lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0109_ia_ciencia_congelada.sql drizzle/meta src/db/ia-schema.test.ts src/db/schema/pacientes.ts src/email src/worker/index.ts \
  src/modules/ia/textos-legais.ts src/modules/ia/textos-legais.test.ts src/modules/ia/constantes.ts test/ia.ts
git commit -m "refactor(ia): ciência do Plano 11 congelada (0109), e-mail aviso_ia descartado e a ciência fora do código (RN-128) (P14A-10)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 11: Manual guiado e E2E — a autorização pelo app, pelo link e em papel, e a leitura de laudo autorizada (P14A-11)

**Revisão: leve (revisor-interface)** — textos do manual guiado (painel e portal), axe nas telas novas, os três canais de ponta a ponta com `IA_PROVEDOR=sandbox` (nenhuma chamada à API real).

**Files:**
- Modify: `src/modules/ajuda/conteudo.ts` (guias `prontuario` v2 e `configuracoes` v5), `src/modules/ajuda/conteudo.test.ts` (`TSX_FORA` com `src/modules/ia`), `src/modules/ajuda/portal.ts` (item novo, sem subir a versão), `src/modules/ajuda/portal.test.ts`, `e2e/ia-laudos.spec.ts`, `e2e/acessibilidade.spec.ts`, `scripts/e2e-seed.ts` (conferência do perfil e do IP), `.github/workflows/ci.yml` e `playwright.config.ts` (`IA_RETENCAO_ZERO=1` no E2E)
- Create: `e2e/autorizacao-ia.spec.ts`

**Interfaces:**
- Consumes: as telas da T6, T7 e T8; `entrarComo`, `pacienteNoPortal`, `esperarEmail`, `primeiroLink`, `violacoesNoPainel`; o consultório do E2E (`scripts/e2e-seed.ts`: IA liberada e ativada, `DOCUMENTOS` com nome profissional, CRN e e-mail de contato — o perfil que o texto da autorização cita).
- Produces: nada para outras tarefas.

- [ ] **Step 1: O manual guiado**

Em `src/modules/ajuda/conteudo.ts`, no guia `configuracoes`, `versao: 5, // Plano 14A: a autorização do paciente no lugar do aviso de IA` e, na seção "Inteligência artificial (IA)", trocar o terceiro item por:

```ts
            'Antes de usar a IA com um paciente, peça a autorização dele (aba Privacidade do paciente, "Uso de IA"): pelo app, pelo link do e-mail ou pelo termo em papel. Recusar ou retirar não muda nada no atendimento, e a retirada vale na hora.',
```

No guia `prontuario`, `versao: 2, // Plano 14A: a autorização de IA na aba Privacidade (item novo nas perguntas comuns)` (e o comentário do Plano 11 fica) e, em "Perguntas comuns", depois do item da IA:

```ts
          'Em Privacidade, "Uso de IA" mostra se o paciente autorizou o uso de IA e os registros; o pedido vai por "Enviar pedido de autorização por e-mail" ou pelo "Registrar termo em papel" (imprimir, assinar e guardar a foto).',
```

Em `src/modules/ajuda/conteudo.test.ts`, `TSX_FORA` ganha `'src/modules/ia'` (os rótulos da autorização vêm de `MSG_AUTORIZACAO`). Em `src/modules/ajuda/portal.ts`, em "Perguntas comuns" (sem subir a `versao`: desvio 11):

```ts
          'Se o seu consultório usar inteligência artificial, o pedido de autorização aparece em Eu, no cartão Privacidade. Autorizar é opcional: recusar ou retirar não muda nada no seu atendimento.',
```

e, em `portal.test.ts`, um caso que confere que o item existe e que nenhum texto do guia diz "peso" (a guarda da RN-214 já varre). Run: `pnpm vitest run src/modules/ajuda` → PASS.

- [ ] **Step 2: O ambiente do E2E**

Em `.github/workflows/ci.yml`, no job do E2E, depois de `IA_PROVEDOR: sandbox`: `IA_RETENCAO_ZERO: '1'` (comentário: "Plano 14A (A-D4): retenção zero só no E2E/dev, com o sandbox"). Em `playwright.config.ts`, no `env` do `webServer` (onde está `SESSAO_TESTE_MS`): `IA_RETENCAO_ZERO: '1'`. Em `scripts/e2e-seed.ts`, conferir que o consultório do E2E grava `...DOCUMENTOS` (nome profissional, CRN, e-mail de contato) junto de `...IA` — já grava — e acrescentar, no comentário de `IA`, "Plano 14A: o aditivo 0.2-provisorio (IA_ADITIVO_VERSAO) e o perfil de DOCUMENTOS, que o texto da autorização cita".

- [ ] **Step 3: A leitura de laudo agora com a autorização no app**

Em `e2e/ia-laudos.spec.ts`, trocar o bloco "US-104: sem ciência…" por (o cabeçalho do arquivo passa a citar US-106, US-110 e US-111):

```ts
  // US-105/US-106 (Plano 14A): sem autorização, a seção explica; o paciente autoriza no app (Eu › Privacidade)
  await nutri.goto(`${p}/privacidade`);
  await expect(nutri.getByText('Ainda não autorizou.')).toBeVisible();
  await expect(nutri.getByText('O paciente também pode autorizar no app, em Eu › Privacidade.')).toBeVisible();
  await paciente.page.goto('/p/perfil');
  await expect(paciente.page.getByText('Você ainda não autorizou.')).toBeVisible();
  await paciente.page.getByRole('link', { name: 'Ler e decidir' }).click();
  await expect(paciente.page.getByRole('heading', { name: 'Autorização para uso de inteligência artificial' })).toBeVisible();
  await paciente.page.getByRole('button', { name: 'Autorizo o envio para fora do Brasil' }).click();
  await expect(paciente.page.getByRole('status').filter({ hasText: 'Autorização registrada. Você pode retirar quando quiser.' })).toBeVisible();
  await nutri.reload();
  await expect(nutri.getByText(/^Autorizou em \d{2}\/\d{2}\/\d{4} \(app, versão 0\.1-provisorio\)\.$/)).toBeVisible();
```

(o resto do teste — o exame, "Ler valores com IA", a conferência e o histórico — não muda.)

- [ ] **Step 4: O spec novo**

Criar `e2e/autorizacao-ia.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { PDFDocument } from 'pdf-lib';
import { violacoesNoPainel } from './documentos';
import { entrarComo } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';
import { pacienteNoPortal } from './portal';

// Plano 14A (US-105 a US-109): os três canais da autorização de IA com IA_PROVEDOR=sandbox e IA_RETENCAO_ZERO=1 (nenhuma
// chamada à API real). IPs (faixa só deste spec, 10.9.19.81 a .86): nutricionista .81, paciente .82, sem login .83, papel .84.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };

test('link por e-mail: pedido → página sem login → autorizo → confirmação → retirar pelo link do e-mail', async ({ browser }) => {
  test.setTimeout(120_000);
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.19.81', { viewport: { width: 1280, height: 900 } });
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.19.82');
  await nutri.goto(`${paciente.prontuario}/privacidade`);
  const antes = new Date();
  await nutri.getByRole('button', { name: 'Enviar pedido de autorização por e-mail' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Pedido enviado. O link vale por 7 dias.' })).toBeVisible();
  expect(await violacoesNoPainel(nutri), 'aba Privacidade com a seção Uso de IA').toEqual([]);
  const pedido = await esperarEmail(paciente.email, { assunto: 'Consultório E2E: autorização para uso de inteligência artificial', depoisDe: antes });

  const anonimo = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.19.83' } })).newPage();
  await anonimo.goto(primeiroLink(pedido.texto, '/autorizacao-ia/'));
  await expect(anonimo.getByRole('heading', { name: 'Autorização para uso de inteligência artificial' })).toBeVisible();
  await expect(anonimo.getByText('Consultório E2E').first()).toBeVisible();
  expect((await new AxeBuilder({ page: anonimo }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
  await anonimo.getByRole('button', { name: 'Autorizo o envio para fora do Brasil' }).click();
  await expect(anonimo.getByRole('status').filter({ hasText: /^Autorização registrada\. Você pode retirar quando quiser, pelo link do e-mail de confirmação/ })).toBeVisible();

  await nutri.reload();
  await expect(nutri.getByText(/^Autorizou em .* \(link por e-mail, versão 0\.1-provisorio\)\.$/)).toBeVisible();
  await expect(nutri.getByText(/— Pedido enviado por e-mail$/)).toBeVisible();

  const confirmacao = await esperarEmail(paciente.email, { assunto: 'Você autorizou o uso de inteligência artificial', depoisDe: antes });
  await anonimo.goto(primeiroLink(confirmacao.texto, '/autorizacao-ia/'));
  anonimo.once('dialog', (d) => d.accept());
  await anonimo.getByRole('button', { name: 'Retirar autorização' }).click();
  await expect(anonimo.getByRole('status').filter({ hasText: 'Autorização retirada.' })).toBeVisible();
  await nutri.reload();
  await expect(nutri.getByText(/^Retirou em \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible();
  await expect(nutri.getByText(/— Retirou \(link por e-mail\)$/)).toBeVisible();
  await anonimo.context().close();
  await paciente.page.context().close();
  await nutri.context().close();
});

test('termo em papel: imprimir, guardar a foto com o código de referência, "Ver termo assinado" e a retirada a pedido', async ({ browser }) => {
  test.setTimeout(120_000);
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.19.84', { viewport: { width: 1280, height: 900 } });
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.19.85');
  await nutri.goto(`${paciente.prontuario}/privacidade`);
  await nutri.getByRole('link', { name: 'Registrar termo em papel' }).click();
  await expect(nutri.getByRole('heading', { name: 'Autorização para uso de inteligência artificial' })).toBeVisible();
  await expect(nutri.getByText(`Nome do paciente: ${paciente.nome}`)).toBeVisible();
  await expect(nutri.getByText(/^Código de referência: [0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/).first()).toBeVisible();
  await expect(nutri.getByRole('button', { name: 'Imprimir termo' })).toBeVisible();
  expect(await violacoesNoPainel(nutri), 'página do termo').toEqual([]);

  await nutri.getByRole('button', { name: 'Salvar' }).click();
  await expect(nutri.getByText('Envie a foto ou o PDF do termo assinado.')).toBeVisible();
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  await nutri.getByLabel('Data da assinatura').fill(hoje);
  await nutri.getByLabel('Foto ou PDF do termo assinado').setInputFiles({ name: 'termo.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) });
  await nutri.getByLabel(/^Confirmo que o paciente assinou este termo, na versão 0\.1-provisorio/).check();
  await nutri.getByRole('button', { name: 'Salvar' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Termo registrado. Entregue ao paciente uma via do termo assinado.' })).toBeVisible();
  await expect(nutri.getByText(/^Autorizou em .* \(termo em papel, versão 0\.1-provisorio\)\./)).toBeVisible();
  const [aba] = await Promise.all([nutri.context().waitForEvent('page'), nutri.getByRole('link', { name: 'Ver termo assinado' }).click()]);
  await aba.waitForLoadState();
  expect(aba.url()).toContain('/api/arquivos?');
  await aba.close();

  nutri.once('dialog', (d) => d.accept());
  await nutri.getByRole('button', { name: 'Registrar retirada a pedido do paciente' }).click();
  await expect(nutri.getByText(/^Retirou em \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible();
  await expect(nutri.getByText(/— Retirou \(a pedido, pela nutricionista\)$/)).toBeVisible();
  // a retirada chega ao app do paciente
  await paciente.page.goto('/p/perfil');
  await expect(paciente.page.getByText(/^Você retirou a autorização em \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible();
  await paciente.page.context().close();
  await nutri.context().close();
});
```

Em `e2e/acessibilidade.spec.ts`, na lista `ROTAS` do portal, acrescentar `'/p/perfil/ia'` (o consultório do E2E tem a IA ativa e o perfil completo; um paciente novo não autorizou, então a página abre).

- [ ] **Step 5: Rodar e conferir**

Run: `pnpm build && pnpm test:e2e e2e/autorizacao-ia.spec.ts e2e/ia-laudos.spec.ts e2e/conferencia-ia.spec.ts e2e/exames-enviados.spec.ts e2e/acessibilidade.spec.ts e2e/portal.spec.ts`
Expected: PASS (o E2E local usa a porta 3100 e o Mailpit do `docker-compose.dev.yml`; `IA_PROVEDOR=sandbox` e `IA_RETENCAO_ZERO=1` no `.env.local`). Se `conferencia-ia.spec.ts` ou `exames-enviados.spec.ts` ("Aceitar e ler") pararem em "Antes de usar a IA, peça a autorização do paciente…", o paciente deles precisa autorizar antes, com os mesmos passos do Step 3 — acrescentar ao spec.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ajuda e2e/autorizacao-ia.spec.ts e2e/ia-laudos.spec.ts e2e/acessibilidade.spec.ts e2e/conferencia-ia.spec.ts e2e/exames-enviados.spec.ts \
  scripts/e2e-seed.ts .github/workflows/ci.yml playwright.config.ts
git commit -m "test(e2e): autorização de IA pelo app, pelo link e em papel; manual guiado (prontuario v2, configuracoes v5, portal) (P14A-11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

### Task 12: Fechamento — manual técnico, roteiro do manual do usuário, runbook, índice, backlog e spec (P14A-12)

**Revisão: leve (revisor-interface)** e **`guardiao-manual`** (`.claude/agents/guardiao-manual.md`) no capítulo 10, no README, no runbook e no roteiro do manual do usuário.

**Files:**
- Modify: `docs/manual-tecnico/10-ia.md`, `docs/manual-tecnico/02-banco-de-dados.md`, `docs/manual-tecnico/06-worker-seguranca-operacao.md`, `docs/manual-tecnico/01-visao-geral-e-arquitetura.md` (cronologia), `docs/manual-tecnico/README.md`, `docs/operacao/ia.md`, `docs/operacao/go-live.md`, `docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md`, `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md`, `docs/superpowers/specs/2026-10-03-nutridebby-ia-nutricionista-design.md` (cabeçalho "Revisão 0.6" e §17/§18 só com o status do 14A)

**Interfaces:**
- Consumes: tudo das Tarefas 1–11.
- Produces: o manual técnico atualizado; o runbook do dono (seção abaixo) em `docs/operacao/ia.md`; o roteiro de correções do manual do usuário (lista para o controlador aplicar no documento do Claude Docs "NutriDebby — Manual do sistema", que o guardião não edita); índice, backlog e spec com o estado do 14A.

- [ ] **Step 1: Manual técnico**

Conferido contra o código do branch (cada afirmação com caminho:linha ou função). No capítulo 10, uma seção "10.x Autorização do paciente e provedor na UE (Plano 14A)" com: o modelo (`ia_autorizacoes`, eventos, CHECKs, gatilho `ia_autorizacoes_regras`, política `paciente_autorizacao_propria`, `REVOKE`, as duas funções `SECURITY DEFINER`), a vigência (`situacaoDaAutorizacao`, D7) e todos os pontos em que a RN-100 a confere (`pedirLeituraExame`, passo 1, portão e passo 6 de `processarTarefaIA`, `aplicarSugestao`, `expirarTarefasDoTenant` D15), o destino (`ia_tarefas.destino`, D6), a retirada (nutricionista na transação; paciente pelo job `ia-retirada`, D14), os três canais (app, link — tokens D11/D12, Turnstile, limite —, papel — `salvarArquivo`, código de referência, "Ver termo assinado" com `auditRead`), os e-mails, a exportação e a anonimização, o legado congelado (0109, RN-128), o provedor `bedrock-eu` (D1–D5: cliente, variáveis que o SDK lê e as proibidas no worker, perfil `eu.`, limite de 20 MB no preparo, região `eu` e multiplicador), `IA_RETENCAO_ZERO` (D9) e os desvios 1–11 deste plano. No capítulo 02, a tabela nova e a coluna nova; no 06, a fila `ia-retirada`, as variáveis novas (só os nomes) e a poda da imagem; no 01, a cronologia; no README, "Conferido contra"/"Escopo" com o 14A e as migrations `0107`–`0109`. Divergências spec × código no fim do capítulo 10: a lista "Desvios conscientes" deste plano.

- [ ] **Step 2: Roteiro do manual do usuário**

O `guardiao-manual` lista as correções do manual do usuário (trecho atual exato → texto novo → motivo → evidência no código): a seção da IA em Configurações (aditivo 0.2 com o fornecedor conforme o provedor), a aba Privacidade (troca de "Uso de IA — aviso e Não usar IA" pela autorização: pedido por e-mail, termo em papel, retirada a pedido, registros, avisos de versão, destino e e-mail trocado), os botões de IA dos exames (os textos novos de "sem autorização" e "retirou"), uma seção nova para o paciente (Eu › Privacidade, "Ler e decidir", retirar) e a página do link. A lista vai na descrição do PR, seção "Manual do usuário — correções", para o controlador aplicar no documento (nunca pelo guardião).

- [ ] **Step 3: Runbook, índice, backlog e spec**

Em `docs/operacao/ia.md`, uma seção "## Plano 14A — autorização do paciente e provedor na UE" com o **Runbook do dono** abaixo (copiado sem mudança) e a nota de que o passo 7 do runbook do Plano 11 ("informa cada paciente") foi substituído pela autorização. Em `docs/operacao/go-live.md`, na seção da IA, os itens novos para marcar (escolha do provedor, conta AWS, `GetInferenceProfile`, registro de invocações desligado, avaliação com `bedrock-eu`, `IA_RETENCAO_ZERO`, advogado com os textos 0.1/0.2 e os e-mails, perfil completo). No índice, a linha do Plano 14 vira duas: **14A** (este plano, "Em execução") e **14B** (IA Nutri, "A planejar", spec v0.5.1 §18.3). No backlog: P14A-00 com o link deste plano; P14A-01 a P14A-12 (uma por tarefa); P14A-13 (runbook do dono: provedor, retenção zero, advogado, avaliação, liberação); os "Pontos menores" do fim deste plano como Minors do 14A; P14-00 passa a "14B". Na spec, no cabeçalho, uma linha "Revisão 0.6" curta (o que a execução mudou, conferido no código: D1–D19 e os desvios 1–11 que valerem) e o "Status" do 14A: "em execução (plano `2026-10-09-nutridebby-14a-autorizacao-ia.md`)" — o fechamento do PR muda para "em produção".

- [ ] **Step 4: Verificação completa**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add docs/manual-tecnico docs/operacao/ia.md docs/operacao/go-live.md docs/superpowers/plans/2026-09-27-nutridebby-00-indice.md \
  docs/superpowers/plans/2026-09-27-nutridebby-backlog.md docs/superpowers/specs/2026-10-03-nutridebby-ia-nutricionista-design.md
git commit -m "docs: manual técnico (cap. 10, 02, 06), runbook, índice, backlog e spec do Plano 14A (P14A-12)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_011oVTntWHy84E7M5PG1J3Th"
```

---

## Runbook do dono (Plano 14A — autorização do paciente e provedor na UE)

Nenhum passo é do código; cada um tem dono. A IA continua **desligada para dado real** depois do merge: sem `IA_PROVEDOR` em produção nada aparece, e sem `IA_RETENCAO_ZERO=1` nenhum dado de paciente sai. **Nada de dado real antes do passo 8.**

1. **Antes do merge (merge = deploy).** O controlador, com o OK do dono (nunca um subagente), confere no banco de produção, só leitura: `select count(*) from patients where ia_aviso_versao is not null or ia_aviso_enviado_em is not null or ia_recusada_em is not null;` (esperado **0**: a seção "Uso de IA" nunca apareceu sem `IA_PROVEDOR`) e `select count(*) from tenants where ia_aditivo_versao is not null;` (esperado **0**: a IA nunca foi ativada; se houver, a nutricionista verá "aceite a versão atual" do aditivo 0.2). Snapshot da VPS no hPanel; OK explícito do dono no PR; o job `image` do CI dentro de **265 MB** (a T3 registra a medida). As migrations `0107`–`0109` rodam no deploy com `DATABASE_URL_MIGRATOR`.
2. **Escolher o provedor de produção (R-115) — antes do primeiro pedido de autorização.** A autorização vale para o destino em que foi dada: trocar depois pede autorização nova de todos os pacientes. Recomendação da spec: `bedrock-eu` (UE, adequação da ANPD; a ZDR da Anthropic pode ser negada a conta pequena, R-101).
3. **Se `bedrock-eu`: a conta AWS (A-D26, INT-08).** (a) Conta AWS em nome do CNPJ; aceitar o Customer Agreement e o AWS GDPR DPA; guardar os comprovantes. (b) Bedrock › Model access: habilitar o **Claude Sonnet 5.5** na região escolhida (uma de `IA_BEDROCK_REGIAO`: `eu-central-1`, `eu-west-1`, `eu-west-3`, `eu-north-1`, `eu-south-1`, `eu-south-2`). (c) Conferir na página "inference-profiles-support" o ID do perfil (`eu.anthropic.claude-sonnet-5-5`; se for outro, PR curto em `PERFIL_BEDROCK_EU`) e rodar `aws bedrock get-inference-profile --inference-profile-identifier eu.anthropic.claude-sonnet-5-5 --region <região>`: **todas** as regiões de destino listadas têm de ser da UE (Londres, `eu-west-2`, e Zurique, `eu-central-2`, não são); guardar a saída no registro da liberação. (d) Bedrock › Settings › **Model invocation logging: desligado** (print). (e) Dois usuários IAM só com `bedrock:InvokeModel` nos ARNs do perfil `eu.` e dos modelos de destino (sem S3, Batch nem logging): `nutridebby-ia-dev` (avaliação) e `nutridebby-ia-producao`; uma chave de acesso de **longo prazo** (começa com `AKIA`) por usuário; nunca colar a chave em chat, e-mail, issue ou arquivo do repositório. (f) **AWS Budgets**: alerta mensal (sugestão US$ 50, o `IA_TETO_GLOBAL_MENSAL_USD`). (g) Ler a página "abuse-detection" do Bedrock: se a AWS guardar conteúdo para detecção de abuso, levar ao advogado (passo 6) — muda o texto da autorização e do aditivo. (h) Conferir na página de preços do Bedrock o Sonnet 5.5 no perfil `eu.` (prêmio de 10% sobre o global): se for diferente de US$ 2/10 por milhão × 1,1, PR curto em `PRECOS_IA` com a data (R-117). **Se `anthropic`:** os passos 1 e 2 do runbook do Plano 11 (workspaces e ZDR).
4. **Avaliação manual com laudos fictícios (RN-127, CS-100, CS-102) — custo < US$ 10.** Na máquina do dono: `pnpm ia:laudos` e um `.env.avaliacao` local (fora do git) com `IA_AVALIACAO=1`, `IA_AVALIACAO_PROVEDOR=bedrock-eu`, `IA_BEDROCK_REGIAO`, as chaves do usuário **de dev** e `IA_AVALIACAO_MODELOS=claude-sonnet-5-5`; depois `pnpm ia:avaliar`. Critérios: precisão ≥ 95%, zero inventado, injeção não vazou, nenhuma violação da RN-123, custo médio ≤ US$ 0,20. **Se o Bedrock recusar o pedido** (`pedido_invalido` em todos — o perfil não aceitou `output_config`/`effort` no InvokeModel, D1), parar e trazer o relatório: é decisão de plano (outro cliente ou outro formato de saída). Contar quantos laudos reais da Debby passariam de 14 MB (R-116). Registrar o resultado no PR do plano.
5. **`IA_RETENCAO_ZERO=1`** — só com o passo 3 (d) e (g) conferidos (ou a ZDR da Anthropic concedida por escrito).
6. **Advogado (OAB).** Levar: a spec v0.5.1 (§5.3, texto da autorização, US-101), o texto da autorização `0.1-provisorio` nas variantes do provedor escolhido e dos quatro canais (inclusive o desvio 6 deste plano: "Os seus dados saem do Brasil." no lugar de "Nos dois casos…"), o aditivo `0.2-provisorio`, os dois e-mails (desvio 9), a pergunta de autorizar usos ainda não disponíveis (resumo e rascunho, 14B), a alternativa "uma caixa por uso" (RV-1), R-114 (a adequação da UE alcança a AWS?), A2 (consentimento livre) e o que a detecção de abuso da AWS guarda. Com os textos finais: versão nova em `textos-legais.ts` e os `*_MIN` sobem (PR curto, com revisão; RN-109).
7. **Variáveis no Easypanel (regra 6; o dono aplica).** App e worker: `IA_PROVEDOR=bedrock-eu`, `IA_BEDROCK_REGIAO`, `IA_MODELO_LEITURA=claude-sonnet-5-5`, `IA_RETENCAO_ZERO=1`, `IA_TETO_GLOBAL_MENSAL_USD=50`. **Só no worker:** `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` (usuário de produção). **Nunca** `AWS_SESSION_TOKEN`, `AWS_PROFILE`, `AWS_BEARER_TOKEN_BEDROCK`, `ANTHROPIC_BEDROCK_BASE_URL` nem `ANTHROPIC_CUSTOM_HEADERS` (o worker não sobe com elas, D2). Snapshot no hPanel antes; reiniciar os serviços só com o OK do dono. Conferir no log do worker a linha "IA de laudos" com `provedor: bedrock-eu` e `chave: presente` (nunca a chave).
8. **Debby e liberação.** O perfil profissional completo em Configurações (nome completo, CRN, e-mail de contato — o texto da autorização os cita; sem eles, o pedido não sai); os textos de tela e do manual guiado; um teste com paciente fictício (o pedido para uma caixa dela, o link, o termo em papel, a retirada pelo link e a pedido). Depois, e só com o backup no host (P02-11) funcionando: Admin → "Liberar" (recusado em produção enquanto a autorização ou o aditivo forem provisórios, D22) → a nutricionista aceita o aditivo 0.2 em Configurações → pede as autorizações. **Emergência:** `IA_DESLIGADA=1` no Easypanel (a retirada continua possível).
9. **Todo mês:** a soma de `ia_uso` do mês (coluna "Uso de IA no mês" do admin) × o Cost Explorer da AWS filtrado pelo Bedrock; diferença > 5% abre investigação (RNF-108).

## Checagem final (antes do PR)

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` verdes; `pnpm test:e2e` com `autorizacao-ia.spec.ts`, `ia-laudos.spec.ts`, `conferencia-ia.spec.ts`, `exames-enviados.spec.ts`, `portal.spec.ts` e `acessibilidade.spec.ts` verdes.
- [ ] Guardas: `src/db/rls-guard.test.ts`, `src/db/audit-guard.test.ts`, `test/isolamento.test.ts`, `src/db/ia-autorizacoes.test.ts`, `src/db/ia-schema.test.ts`, `src/db/sem-conta-guarda.test.ts`, `src/modules/ia/guardas.test.ts` (SDKs e grafo do Next), `src/app/api/mesma-origem-rotas.test.ts`, `src/app/api/painel/acesso-negado.test.ts`, `src/app/formularios-post.test.ts`, `src/app/painel/acoes-de-paciente.test.ts`, `src/app/painel/cores.test.ts`, `src/app/painel/rotas-axe.test.ts`, `src/modules/ajuda/conteudo.test.ts`, `src/modules/pacientes/exportacao.test.ts` (grafo do worker).
- [ ] `git grep -n "@anthropic-ai/bedrock-sdk" src scripts` só em `src/modules/ia/provedor-bedrock.ts`; `git grep -n "ciencia-paciente\|aviso_ia\|avisoDaVersao\|PROVEDOR_IA_DESCRICAO" src test e2e scripts` só no `TIPOS_LEGADOS` de `src/email/job.ts`.
- [ ] `git grep -n "email_hmac\|emailHmac" src` só em schema, migrations, `autorizacao*.ts`, testes — nunca em log, Sentry, e-mail ou exportação; `git grep -n "AWS_SECRET_ACCESS_KEY" src` só em `env.ts`, `provedor-do-ambiente.ts`, `scripts/ia-avaliar.ts` e testes.
- [ ] Nenhuma migration com `DISABLE TRIGGER`; a 0108 refaz `app_ia_tarefas_imutavel` linha a linha a partir da 0100 + o destino; a 0109 refaz `app_patients_ia_quem` (diff conferido na revisão).
- [ ] Imagem do job `image` ≤ 265 MB (medida no PR); a fumaça do SDK do Bedrock na imagem passou.
- [ ] CLAUDE.md (regras 2, 8 e 9), manual técnico (cap. 01, 02, 06, 10 e README), runbook em `docs/operacao/ia.md`, `go-live.md`, índice, backlog e o status da spec atualizados; o roteiro do manual do usuário na descrição do PR.
- [ ] Revisão final do branch (workflow) com uma onda de correções → `/code-review high` uma vez → correções Critical/Important → re-revisão do diff → `/security-review` (checklist em Global Constraints). Lembrar o dono do backup no host (P02-11).

## Riscos e pendências que ficam

| # | Risco / pendência | Onde está tratado | O que falta |
|---|---|---|---|
| R1 | O SDK do Bedrock (com `@aws-sdk/client-bedrock-runtime` e `@aws-sdk/credential-providers`) passa a imagem de 265 MB | T3 Step 7 (poda e medida; para e pergunta) | Decisão do dono se passar: subir o orçamento ou assinatura SigV4 própria |
| R2 | O perfil `eu.` no InvokeModel não aceitar `output_config`/`effort` (D1) | Runbook passo 4 (a avaliação detecta: `pedido_invalido`) | Se acontecer, plano curto (outro cliente ou saída por ferramenta) |
| R3 | Troca de provedor depois de colher autorizações (R-115) | Runbook passo 2; RN-109 na tela ("O destino mudou…") e no portão | Dono escolhe antes do primeiro pedido |
| R4 | Textos jurídicos provisórios (autorização 0.1, aditivo 0.2, e-mails, desvio 6) | D22 recusa "Liberar" em produção; runbook passo 6 | Advogado (OAB) |
| R5 | Janela do deploy: worker novo antes da 0107 (`42P01` em `ia_autorizacoes`) ou worker antigo depois da 0109 (job `aviso_ia` falha no gatilho) | Em produção não há tarefa de IA (sem `IA_PROVEDOR`) nem aviso na fila (contagem do passo 1); o pg-boss repete; o worker novo descarta o legado | Acompanhar o log do worker no deploy |
| R6 | Rebase sobre o Plano 16 (conflitos em `exportacao-job.ts`, `perfil/privacidade.tsx`, `isolamento.test.ts`, `conteudo.ts`) | T1 Step 0; T8 parte do branch do Plano 16 | Rebase cuidadoso |
| R7 | Atrito: paciente sem autorização fica sem IA (R-110) | Três canais; a IA nunca é caminho único | PM-13 se a Debby pedir |
| R8 | Perfil profissional incompleto bloqueia o pedido (desvio 7) | Texto que diz o que completar; runbook passo 8 | — |
| R9 | O alerta de e-mail trocado só vê pedidos por e-mail (o HMAC; `patients` não guarda o histórico do e-mail) | US-105 (adaptação da §18.4) | Limitação aceita |
| R10 | O link de retirada é um portador (quem tiver o e-mail encaminhado retira): ação benigna, sem dado exposto | D11 | — |
| R11 | Rebaixar o laudo de 20 para 14 MB no `bedrock-eu` recusa laudos grandes (R-116) | D4; "Não foi possível preparar este arquivo para a IA. Lance os valores manualmente." | Medida no runbook passo 4 |

## Autoconferência do plano (writing-plans)

- **Cobertura da spec:** a tabela "Cobertura da spec v0.5.1, parte do 14A" liga cada US, RN, RNF, INT e C do 14A a uma tarefa; RNF-111 (a)–(j): (a) T4 (portão), (b) T4 (pedido e portão) e T2 (situação), (c) T4 (job) e T5/T6 (enfileirar), (d) T1, (e) T5/T6, (f) T5, (g) T9 e T1, (h) T5, (i) T6, (j) T1. CS-105: T4. Fora, de propósito: 14B (§18.3), o índice novo da RN-103, `carimbo_dados`, `ia_geracoes_modelos`, a remoção das colunas legadas (PM-17).
- **Sem lacunas de código:** cada passo de código traz o código; os "modificar" dizem o arquivo, o lugar e o trecho; a 0108 e a 0109 trazem as funções inteiras. Os três pontos que dependem de helper com nome não conferido (o leitor de exame do `conferencia.test.ts`, o `mensagem` do `tarefas.test.ts` e o recurso de troca de variável do `getEnv` nos testes de action) dizem o que fazer se o nome for outro.
- **Nomes consistentes:** os contratos do topo são os usados nas tarefas (`autorizacaoNoBanco`, `termoNoDisco`, `pacienteAutorizado`, `IA_TESTE`, `situacaoDaAutorizacao`, `vigentePara`, `ultimaDecisao`, `autorizacaoDoPaciente`, `motivoDoPaciente`, `situacaoIaDoPaciente`, `registrarRetiradaPelaNutri`, `processarRetiradaIa`, `autorizarNoApp`, `retirarNoApp`, `enviarPedidoPorEmail`, `registrarTermoEmPapel`, `caminhoDoTermo`, `enfileirarConfirmacao`, `painelDaAutorizacao`, `secaoIaVisivel`, `blocoIaDoApp`, `lerLinkAutorizacao`, `assinarLinkPedido`, `assinarLinkRetirada`, `emailHmac`, `codigoDeReferencia`, `estadoDoLinkIa`, `autorizarPeloLink`, `retirarPeloLink`, `provedorBedrock`, `classificarErroBedrock`, `apagarTermosDeAutorizacao`, `termosDeAutorizacaoRestantes`, `estadoIaComPaciente`, `textoDaAutorizacao`, `aditivoIa`, `responsavelDoTenant`, `textoCorrido`, `TextoLegalView`); os do código existente foram conferidos na `main` e no branch do Plano 16 (`carregarPacienteParaEscrita`, `cancelarTarefas`, `estornar`, `marcarIncerto`, `pedirLeituraExame`, `processarTarefaIA`, `expirarTarefasDoTenant`, `aplicarSugestao`, `salvarArquivo`, `apagarArquivo`, `anexosDoPaciente`, `anonimizarVencidos`, `montarDados`, `gerarExportacao`, `enqueueEmail`, `processEmailJob`, `consumirLimite`, `chaveDoLimite`, `depsDaRequisicao`, `lerJson`, `mesmaOrigem`, `requireApiNutri`, `requirePaciente`, `carregarProntuario`, `inicioDoDia`, `normalizarEmailDoLink`, `formatarCodigo`, `signFileUrl`, `auditRead`, `TurnstileWidget`, `molduraDaSecao`, `Faixa`).
- **Review Focus:** cada linha tem os testes nas tarefas indicadas (1: T4; 2: T5/T6; 3: T2/T4/T9; 4: T5/T9; 5: T1/T5).

## Pontos menores (backlog do Plano 14A)

- **"Uma caixa por uso"** (RV-1), se o advogado preferir: o campo `usos` já comporta; muda o texto, as telas e o termo.
- **Lista "Pacientes sem autorização de IA"** no painel (PM-13), se a Debby pedir.
- **Webhook de devolução do Resend** para avisar a nutricionista de pedido por e-mail devolvido (PM-18).
- **Remover as colunas de ciência congeladas** (PM-17), migration destrutiva só com o OK do dono, depois de conferir que estão vazias.
- **Nome de quem registrou** na lista "Registros" (como a PM-16: hoje a lista não lê a tabela `user`).
- **Reenviar o e-mail de confirmação** (com o link de retirada) a pedido do paciente.
- **Haiku 5.5 no `bedrock-eu`**, se a avaliação o aprovar (INT-08).
- **Link do aviso de privacidade** no parágrafo "Seus direitos", quando o aviso público existir (parecer JUR-2026-012, R5).
- **Data do termo no fuso do consultório na exportação** (o nome do arquivo no ZIP usa a data UTC do ato; em papel, o ato é o início do dia em São Paulo, então o dia pode sair um a menos).

## Dependências e paralelismo

Execução no modo misto com workflow: tarefas no branch principal (`plano-14-ia-nutricionista`) e pares em worktrees, integrados por cherry-pick na ordem da tabela. **Revisão completa** = agente especialista + lentes de segurança/LGPD e de spec + três verificadores adversariais por achado (até duas rodadas). **Revisão leve** = `revisor-interface`, uma rodada.

| Tarefa | Depende de | Pode rodar em paralelo com | Revisão | Por quê / arquivos em comum |
|---|---|---|---|---|
| T1 Banco | — (rebase sobre o Plano 16) | T2, T3 | **completa** (revisor-rls) | `src/db/`, `drizzle/`, `test/isolamento.test.ts`, `CLAUDE.md`; `test/ia.ts` também é tocado pela T2 (funções diferentes: integrar T1 antes) |
| T2 Configuração e textos | — | T1 | **completa** (normas-cfn-lgpd) | constantes, textos legais, `modo.ts`, `env.ts`, aditivo em Configurações |
| T3 Provedor Bedrock | T2 | T1 | **completa** (revisor-rls, lente de segurança) | provedores, preparo, guardas, `package.json`, `Dockerfile`; só a chamada do preparo em `leitura-job.ts` (integrar antes da T4) |
| T4 RN-100 com a autorização | T1, T2, T3 | — | **completa** (revisor-rls) | `leitura-job.ts`, `tarefas.ts`, `conferencia.ts`, telas de exames, testes da IA |
| T5 Escrita, tokens e e-mails | T4 | T9 | **completa** (normas-cfn-lgpd + revisor-rls) | `autorizacao.ts`, `src/email/*` |
| T9 LGPD | T4 | T5, T6, T7, T8 | **completa** (normas-cfn-lgpd) | `exportacao-job.ts`, `lgpd.ts`, `constantes.ts` (só tira `PROVEDOR_IA_DESCRICAO`) |
| T6 Link sem login | T5 | T7, T8, T9 | **completa** (revisor-rls, lente de segurança) | `autorizacao-link.ts`, `src/app/autorizacao-ia`, `src/app/api/autorizacao-ia`, `tenant.ts`, `limite-ip.ts`, `next.config.ts` |
| T7 Painel | T5 | T6, T8, T9 | leve (revisor-interface) | `src/app/painel/pacientes/[id]/privacidade/**`, `src/app/api/painel/pacientes/[id]/autorizacao-ia/**` |
| T8 App do paciente | T5 (e o Plano 16) | T6, T7, T9 | leve (revisor-interface) | `src/app/p/(portal)/perfil/**` |
| T10 Legado (RN-128) | T5 (e-mails), T7 (sem uso de `ciencia-paciente`), T9 (exportação do legado pelo `dono`) | — | **completa** (revisor-rls) | `drizzle/0109`, `src/email/*`, `src/worker/index.ts`, `ciencia-paciente.*` (apagados) |
| T11 Manual guiado e E2E | T6, T7, T8, T10 | — | leve (revisor-interface) | `src/modules/ajuda/*`, `e2e/*`, CI/Playwright |
| T12 Fechamento | todas | — | leve + `guardiao-manual` | docs |

Ondas sugeridas: **1)** T1 no branch principal ‖ T2 → T3 num worktree; **2)** T4; **3)** T5 no principal ‖ T9 num worktree (a partir da T4); **4)** T7 no principal ‖ T6 e T8 em worktrees (a partir da T5); **5)** T10, T11 e T12 no principal.
