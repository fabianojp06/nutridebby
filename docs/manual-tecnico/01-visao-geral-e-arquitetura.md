# Capítulo 1 — Visão geral e arquitetura

> **Manual técnico do NutriDebby.** Este capítulo é a porta de entrada para quem vai manter o sistema sem ter
> participado do projeto. Ele explica o que existe, por que foi feito assim e onde cada coisa mora no código.
> Os capítulos seguintes detalham banco e RLS, autenticação, módulos de domínio, worker, operação e testes
> (índice, glossário e divergências consolidadas no [README do manual](README.md)).

| Item | Valor |
|---|---|
| Conferido contra | `main` em `62615b9` (merge do PR #15, 04/10/2026), worktree `docs-manual-tecnico`; as linhas do Plano 10A contra `3991c7d` (merge do PR #19); as do Plano 11 contra `2efa27b` (merge do PR #23); as do Plano 14B-1 (modelos sugeridos pela IA: variáveis, rota de situação, fila `ia-assistente`) contra o branch `plano-14b-ia-nutri`, antes do merge (em produção pelo PR #34, merge `95b2728`); as do Plano 14B-2 (resumo e rascunho pela IA: telas, fila, variável do teto, cronologia) contra o branch `plano-14b-2-resumo-rascunho` em `1a92740`, antes do merge; as do Plano 15 (IA Nutri do paciente: variáveis, rotas, módulo, cronologia) contra o branch `plano-15-ia-nutri-paciente` em `4f8fade`, antes do merge; as do Plano 17 (lembretes de rotina: fila, módulo, rota do portal, cronologia) e as linhas de `src/worker/index.ts` contra o branch `plano-17-lembretes-rotina` em `df641d3`, antes do merge (mergeado no PR #51, `667c952`, em 16/11/2026); as do Plano 18, PR 1 (ficha: módulo, rota `perfil`, cronologia) contra o branch `plano-18-ficha-cadastro` em `d9066f9`, antes do merge (mergeado no PR #52, `9eeacaf`, em 17/11/2026); as do Plano 18, PR 2 (cadastro complementar, lista, "No app", rota `app`) contra o branch local `plano-18-pr2` em `3799409`, antes da revisão final e do rebase |
| Data da conferência | 05/10/2026; Plano 10A em 06/10/2026; Plano 11 em 07/10/2026; Plano 14B-1 em 10/10/2026; Plano 14B-2 em 14/10/2026; Plano 15 em 15/10/2026; Plano 17 em 17/11/2026; Plano 18, PR 1, em 17/11/2026; Plano 18, PR 2, em 17/11/2026 |
| Spec de referência | `docs/superpowers/specs/2026-09-27-nutridebby-mvp-design.md` v1.11 e `…-mvp-historias.md` |
| Ordem de autoridade | **código** > spec > planos e backlog (`docs/superpowers/plans/`) > runbooks (`docs/operacao/`) > `CLAUDE.md` |
| Segredos | Este manual só cita **nomes** de variáveis. Nenhum valor. |

Convenções de citação: `arquivo:linha` aponta para a linha no commit acima; "Plano NN, Dx" é a decisão "Dx" da tabela
"Decisões de desenho" do plano NN em `docs/superpowers/plans/`; "§x" é a seção da spec de design.

---

## 1.1 O produto

O NutriDebby é um **SaaS multi-tenant de gestão de consultório de nutrição**, com um portal do paciente em PWA
(spec §1). Cada consultório (uma nutricionista) é um **tenant**. A primeira cliente é a Debby, piloto do produto
(spec §1, D-01). O onboarding é **manual**: o admin da plataforma cria cada conta de nutricionista (spec §1, D-06).
Não há cobrança nem autocadastro no MVP (spec §2.2, §10).

O sistema guarda **dado de saúde** (prontuário, exames, diário alimentar). Por isso a LGPD molda boa parte da
arquitetura: isolamento no banco, auditoria automática, minimização de dados em logs e no Sentry, exportação e
exclusão a pedido do titular (spec RNF-07, RNF-08, RNF-11; `CLAUDE.md` do projeto, regras 1, 3 e 8).

Situação em 05/10/2026: Planos 01 a 08 em produção em `https://nutri.wsscloud.tech`, com 89 migrations
(`drizzle/0000_…` a `drizzle/0088_…`) e o **MVP completo no código**, exceto os textos legais definitivos
(Plano 08, Tarefa 8, bloqueada no item externo E-09) — ver `docs/superpowers/plans/2026-09-27-nutridebby-backlog.md`,
"Resumo", e o índice dos planos (`…-00-indice.md`, linha do Plano 08). O go-live com pacientes reais depende do
checklist `docs/operacao/go-live.md`. Depois do MVP (07/10/2026): Planos 09 (itens P09-01 a P09-05), 10A (receita) e 11
(base de IA e leitura de laudos) em produção, com 101 migrations (`0000` a `0100`); a receita e a IA nascem desligadas
para uso real, cada uma com o seu interruptor da admin (`documentos_liberados`, `ia_liberada`).

### Módulos funcionais do MVP

| ID | Módulo | Conteúdo (resumo da spec §2.1) | Módulos de código |
|---|---|---|---|
| M1 | Plataforma & acesso | Multi-tenant, login, 2FA, recuperação de senha, admin, marca, auditoria, tema e manual guiado | `plataforma`, `ajuda` |
| M2 | Pacientes & prontuário | Cadastro, convite, etiquetas, anamnese, antropometria, gasto energético, exames, atendimentos, evolução, LGPD | `pacientes` |
| M3 | Plano alimentar | TACO + alimentos próprios, refeições, cálculo, substituições, modelos, publicação, PDF | `alimentos`, `plano-alimentar` |
| M4 | Agenda | Horários, consultas, página pública, lembretes por e-mail/WhatsApp/push, confirmação, presença, cota | `agenda`, `notificacoes` |
| M5 | Portal do paciente (PWA) | Plano offline, push, diário com foto, evolução, lista de compras, agenda, direitos do titular | `portal` |
| M6 | Biblioteca de conteúdo | Vídeos, receitas, orientações, audiência, aba "Conteúdos", métricas | `conteudo` |

Critérios de sucesso do MVP (CS-01 a CS-03, spec §1.1) são calculados por `metricasDeSucesso`
(`src/modules/plataforma/metricas-sucesso.ts`) e aparecem no Início do painel e na tela do admin (Plano 08, D15).

---

## 1.2 Perfis de acesso

O login é global por e-mail e cada conta tem **um único papel** (`appRole`): `admin`, `nutri` ou `paciente`
(`src/lib/session-rules.ts:1`; spec §3, "Modelo de identidade"). O **visitante** não tem conta: usa páginas
públicas ou links assinados. No banco, o "papel" que vale para a RLS é outro conceito: o `TenantRole` passado ao
`withTenant` (`src/db/tenant.ts:14`: `nutri`, `paciente`, `worker`, `publico`), mais o contexto `conta` do
`withConta` (`src/db/tenant.ts:114`).

| Perfil | Como entra | Área | Contexto no banco | Regras principais | Onde está no código |
|---|---|---|---|---|---|
| **Admin da plataforma** | E-mail + senha + **2FA obrigatório** | `/admin` | **Nunca** usa `withTenant`: `admin` não está em `ROLES` (`src/db/tenant.ts:15`, recusa em `:49`). Métricas só por funções `SECURITY DEFINER` que devolvem contagens (`admin_tenant_metrics`, `drizzle/0012_metricas_admin.sql:7`; `admin_metricas_sucesso`, migration 0087) | Sem 2FA, toda página manda para `/conta/seguranca` (`evaluateSession`, `src/lib/session-rules.ts:144`). Sessão: 30 min sem uso com aviso 2 min antes, limite de 8 h e fim ao fechar o navegador (`STAFF_IDLE_MS`, `STAFF_MAX_MS`, `:9-11`; P12-14, cap. 03 §3.6). Nunca lê dado de saúde (spec §3) | `src/app/admin/`, `requireUser(['admin'], …)` na primeira linha de cada página (`src/app/admin/page.tsx:46`); guarda `src/app/admin/sem-tabelas-tenant.test.ts` |
| **Nutricionista** (dona do tenant) | Convite de 72 h criado pelo admin; 2FA opcional | `/painel` | `withTenant` com `role: 'nutri'`, `actorUserId` e `ip` obrigatórios (`src/db/tenant.ts:69`) | Precisa aceitar o DPA da versão atual antes de usar o painel (`requireNutri`, `src/lib/tenant-session.ts:22`); tenant suspenso vai para `/indisponivel` (RN-15); 30 min sem uso (aviso 2 min antes), limite de 8 h, fim ao fechar o navegador (P12-14) | `src/lib/tenant-session.ts` (`requireNutri`, `requireApiNutri`) |
| **Paciente** | Convite de 7 dias da nutricionista (ou cadastro pela página pública) | `/p` (PWA) | `withTenant` com `role: 'paciente'` e `patientId`; para achar os vínculos, `withConta` (contexto `conta`, Plano 06, D2) | Pode ser paciente de vários consultórios; o vínculo escolhido fica no cookie `nd_vinculo`, reconferido a cada requisição (Plano 06, D3; `COOKIE_VINCULO`, `src/lib/paciente-session.ts`). Precisa aceitar a versão atual do termo naquele consultório (Plano 06, D25). Sessão de 30 dias (`PATIENT_SESSION_MS`, `src/lib/session-rules.ts:6`). Escrita negada por padrão no banco (Plano 06, D1) | `requirePaciente` e `requireApiPaciente` (`src/lib/paciente-session.ts`) |
| **Visitante** (sem conta) | Nenhum login | `/n/<slug>`, `/consulta/<token>`, `/convite/…`, `/definir-senha`, `/esqueci-senha` | Página pública: `role: 'publico'`, sem ator, negado por padrão no banco (Plano 05, D11). Link da consulta, resposta do WhatsApp e leitura do convite: `role: 'paciente'` com `semConta: true`, só nos arquivos de `SEM_CONTA_PERMITIDOS` (`src/db/tenant.ts:39`) | Turnstile + código por e-mail na página pública (Plano 05, D12); link da consulta assinado por HMAC com validade até o início da consulta (Plano 05, D20) | `src/modules/agenda/agendamento-publico.ts`, `src/modules/agenda/acoes-link.ts`, `src/modules/pacientes/convite-paciente.ts` |

Dois "atores técnicos" completam o quadro:

- **Worker**: jobs rodam com `withTenant({ role: 'worker' })` e o mesmo role de banco da aplicação, sem
  `BYPASSRLS`; varreduras entre tenants partem da tabela `tenants` (spec §4.1, "Worker").
- **Evolution API** (WhatsApp): chama `POST /api/webhooks/whatsapp`, autenticada por JWT HS256 com chave derivada por
  instância (Plano 05, D4; `src/app/api/webhooks/whatsapp/route.ts`).

Para onde cada papel vai depois do login: `homeFor` (`src/lib/session-rules.ts:15`) — `admin` → `/admin`,
`nutri` → `/painel`, `paciente` → `/p/inicio`. A rota `/inicio` faz esse desvio (`src/app/inicio/page.tsx`).

---

## 1.3 Stack

Versões conferidas em `package.json` (dependências fixadas; `^` indica faixa). Node ≥ 24 (`engines`) e
`packageManager: pnpm@12.6.0`.

### Dependências de produção

| Camada | Pacote | Versão | Para quê / observação |
|---|---|---|---|
| Framework web | `next` | 16.3.6 | App Router, Server Components, Server Actions, Route Handlers; `src/proxy.ts` no lugar do `middleware.ts` |
| UI | `react`, `react-dom` | 19.2.8 | Também renderiza os e-mails (`react-dom/server`, Plano 02, "Modelos de e-mail") |
| Banco | `pg` | 8.23.0 | Pool de conexões (`src/db/client.ts:39`, `max: 10`) |
| ORM | `drizzle-orm` | 0.45.3 | Consultas tipadas; o erro do Drizzle é sanitizado antes de subir (`src/db/client.ts`, topo) |
| Fila | `pg-boss` | 12.34.0 | Fila e agendamento dentro do Postgres, schema `pgboss` (sem Redis; spec §4) |
| Autenticação | `better-auth` | 1.7.6 | E-mail/senha, sessões no Postgres, plugin `twoFactor` (`src/lib/auth.ts:172`), prefixo de cookie `nd` (`:151`) |
| Hash de senha | `@node-rs/argon2` | 2.2.1 | Argon2id (`src/lib/password.server.ts`; RNF-06) |
| Validação | `zod` | 4.6.5 | Variáveis de ambiente (`src/env.ts`) e formulários |
| Logs | `pino` | 10.3.1 | JSON com `redact` de segredos (`src/lib/logger.ts`) |
| Erros | `@sentry/node` | 11.4.0 | Só servidor e worker; sem SDK no navegador (Plano 08, D1) |
| PWA | `@serwist/turbopack`, `serwist` | 9.5.12 | Service worker em `/serwist/sw.js` (`src/app/serwist/[path]/route.ts`, `src/app/sw.ts`; P-14 resolvida) |
| Push | `web-push` | 3.6.7 | VAPID; **só no worker** (Plano 05, D19) |
| E-mail | `resend` | 6.30.0 | Transporte de produção (`src/email/transport.ts:27`) |
| PDF | `@react-pdf/renderer` | 4.9.0 | Prontuário e plano alimentar; **só no worker** (Plano 03, "PDF e ZIP") |
| ZIP | `fflate` | 0.8.3 | Exportação do paciente; **só no worker** |
| Imagem | `sharp` | 0.35.4 | Logo, capa e foto do diário (JPEG sem metadados, `src/lib/jpeg.ts`) |
| HEIC | `heic-decode` | 2.1.0 | Foto do iPhone; **só no worker** (Plano 06, D10) |
| QR code | `qrcode` | ^1.5.4 | QR do 2FA |
| Runtime TS | `tsx` | 4.23.15 | Dependência **de produção**: o worker, as migrations e o `admin:criar` rodam TypeScript direto (`node --import tsx`, `docker-entrypoint.sh:9-15`) |
| Marcador | `server-only` | ^0.0.1 | Impede importar módulos de servidor no cliente |
| IA (Plano 11) | `@anthropic-ai/sdk` | 0.131.0 | Messages API da Anthropic; importado **só** por `src/modules/ia/provedor-anthropic.ts` e **só no worker** (guarda `src/modules/ia/guardas.test.ts`; [cap. 10](10-ia.md)) |
| IA na UE (Plano 14A) | `@anthropic-ai/bedrock-sdk` | 0.34.4 | Cliente do AWS Bedrock (InvokeModel, perfil `eu.`; traz `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/credential-providers` e `@smithy/*`); importado **só** por `src/modules/ia/provedor-bedrock.ts` e **só no worker** (guarda `src/modules/ia/guardas.test.ts`); `pnpm-workspace.yaml` tem a exceção de `minimumReleaseAgeExclude` só para essa versão ([§10.10.8](10-ia.md#10108-provedor-bedrock-eu-d1d5)) |
| PDF do laudo (Plano 11) | `pdf-lib` | 1.17.1 | Regrava o laudo sem metadados antes da IA; **só no worker**, numa `worker_thread` (`preparar-pdf-thread.ts`) e no gerador de laudos fictícios |

### Dependências de desenvolvimento

| Pacote | Versão | Para quê |
|---|---|---|
| `typescript` | ^5 | `strict: true` (`tsconfig.json:7`) |
| `drizzle-kit` | 0.31.11 | Gera migrations SQL (`pnpm db:generate`) |
| `tailwindcss`, `@tailwindcss/postcss` | ^4 | Estilos; tokens `--nd-*` por tema (spec §4.3) |
| `vitest` | 5.0.2 | Testes unitários e de banco |
| `@testcontainers/postgresql` | 12.1.0 | Postgres real nos testes (RLS, isolamento) |
| `@playwright/test` | 1.63.0 | E2E (projetos `chromium`, `celular`, `painel`, `playwright.config.ts:14-20`) |
| `@axe-core/playwright` | 4.13.0 | Acessibilidade (RNF-10) |
| `eslint`, `eslint-config-next` | ^9, 16.3.6 | Lint |
| `prettier` | ^3.9.9 | Formatação |
| `esbuild` | ^0.28.2 | Build do service worker pelo Serwist (`useNativeEsbuild: true`) |
| `otpauth` | ^9.5.2 | Gera códigos TOTP nos testes de 2FA (`e2e/helpers.ts`, `src/lib/two-factor.test.ts`) |
| `xlsx` | tarball do SheetJS | Lê a planilha da TACO no seed (`scripts/seeds/planilhas.ts:1`) |

Fora do `package.json`: **PostgreSQL 16** (imagem `postgres:16` em produção; `postgres:16-alpine` no dev e no CI),
com as extensões `citext`, `pg_trgm`, `unaccent` e `btree_gist` (`drizzle/0000_base_roles_e_rls.sql:1-7`);
Mailpit no dev e no CI; k6 por imagem Docker e Lighthouse por `pnpm dlx` só na pilha de carga (spec §9.1).

`pnpm-workspace.yaml` poda `@sentry/bundler-plugins` por `overrides` (só os caminhos de bundler do SDK o usam) para a
imagem caber no orçamento do CI (260 MB até o Plano 11; **265 MB** desde o Plano 12, D-R2; spec §9.1, "Logs / erros"). No Plano 11, o estágio `build` do `Dockerfile`
poda do `pdf-lib` e do `@anthropic-ai/sdk` o que não roda no worker (258 MB no job `image` do PR #23); no Plano 12, do `@hyzyla/pdfium` só ficam o carregador e o `pdfium.wasm` (263 MB; [§7.7](07-testes-qualidade-e-processo.md#77-pipeline-do-ci-e-deploy)); no Plano 14A, do SDK do Bedrock e dos `@aws-sdk/*`/`@smithy/*` saem fontes, declarações e mapas (264,4 MB na medida local da T3, folga de ≈ 0,6 MB; a medida do PR fica no runbook).

---

## 1.4 Arquitetura: monólito modular + worker

### Visão em uma frase

Um repositório, **uma imagem Docker**, três processos possíveis — **app** (Next.js), **worker** (pg-boss) e
**admin:criar** (CLI) — e **um banco PostgreSQL** que guarda os dados, a fila e o isolamento entre consultórios
(spec §4; Plano 01, "Architecture").

### Por que assim

| Decisão | Motivo | Fonte |
|---|---|---|
| Monólito modular em Next.js, não microsserviços | Um dev, uma VPS compartilhada, deploy simples; módulos por domínio mantêm a separação | Spec §4, §4.1; D-04 |
| Worker na **mesma imagem** | Mesmo código de domínio no app e nos jobs; uma imagem só no GHCR gratuito (500 MB para 2 versões) | Plano 01, "Architecture"; `.github/workflows/ci.yml:191-209` (orçamento da imagem) |
| Fila no **Postgres** (pg-boss), sem Redis | Um serviço a menos; o envio do job entra na **mesma transação** da escrita (`enqueueEmail(msg, { tx })`) | Spec §4; Plano 02, "Fila de e-mail" |
| Isolamento por **RLS forçada** no banco | Um erro de código não expõe outro consultório nem outro paciente | RNF-07; Plano 01, Global Constraints |
| Código pesado **só no worker** (PDF, ZIP, web-push, HEIC) | Mantém o grafo do Next leve e evita processamento longo na requisição | Plano 03, "PDF e ZIP"; Plano 05, D19; Plano 06, D10 |
| Backup **no host** (systemd), não no worker | Imagem menor e o worker continua sem privilégio para ler todos os tenants | Plano 02, "Onde roda o backup" |
| Build da imagem **fora da VPS** | Não consumir CPU e memória do CRM que divide a VPS | RNF-03; §9.7 |

### O processo app (Next.js 16)

- **App Router** em `src/app/`. Páginas são Server Components; formulários usam Server Actions; uploads, PDF, PWA e
  integrações usam Route Handlers em `src/app/api/` (§1.6 abaixo).
- **`src/proxy.ts`** é o interceptador do Next 16 (substitui o `middleware.ts`; Plano 01, Global Constraints). Ele:
  1. redireciona para `/entrar?volta=…` quem acessa `/admin`, `/painel`, `/p`, `/conta` ou `/inicio` **sem cookie**
     de sessão (`src/proxy.ts:7`, `:22-27`) — só confere a **presença** do cookie; a autorização de verdade é feita
     em cada página por `requireUser`/`requireNutri`/`requirePaciente` (o layout não é barreira de segurança, spec §4.1);
  2. gera um `x-request-id` novo, ignorando o do cliente (Plano 08, D2; `:19`);
  3. monta a **CSP com nonce** por requisição (Plano 08, D7; `:29-45`, `src/lib/csp.ts`).
- O `matcher` **exclui `/api/*`**, `/serwist/*` e estáticos (`src/proxy.ts:55`). Motivo (Plano 08, D2): o Next copia
  para a memória o corpo de toda requisição que passa pelo proxy, com corte silencioso em 10 MB; o upload de exame
  (até 20 MB) chegaria cortado. Consequência: rotas de API fazem a própria checagem de sessão
  (`requireApiNutri`, `requireApiPaciente`, `requireApiUser`) e de origem (`mesmaOrigem`, `src/lib/mesma-origem.ts`).
- **Cabeçalhos globais** de segurança vêm de `next.config.ts` (`CABECALHOS_SEGURANCA`, `src/lib/csp.ts:43`: HSTS sem
  `includeSubDomains`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`), com
  `poweredByHeader: false` e `pg-boss` como pacote externo do servidor (`next.config.ts:7-8`).
- **`src/instrumentation.ts`** liga o Sentry no runtime Node e registra todo erro de requisição com o `request_id`
  (`register`, `onRequestError`).
- O app **produz** jobs mas não os processa: `getBoss()` (`src/jobs/boss.ts:18`) abre um pg-boss com pool próprio de
  2 conexões, `supervise: false` e `schedule: false`.

### O processo worker (pg-boss)

`startWorker` (`src/worker/index.ts:48`) valida o ambiente do worker, conecta o pg-boss ao schema `pgboss`
(`createSchema: false`: o schema é criado pela migration com dono = role da aplicação, `src/db/migrate.ts:81`),
cria/atualiza as filas declaradas em `QUEUES` (`src/jobs/queues.ts:9`) e registra cada consumidor por
`workSemDetalhe` (o erro devolvido ao pg-boss leva só fila e código; `src/worker/sem-detalhe.ts`).

Agendamentos (todos no fuso `America/Sao_Paulo`; a VPS roda em UTC):

| Fila | Quando | O que faz | Linha |
|---|---|---|---|
| `heartbeat` | a cada minuto | Grava a batida em `system_heartbeat`; o `/api/health` responde 503 se passar de 10 min (`src/worker/heartbeat.ts:5`) | `src/worker/index.ts:81` |
| `notificacoes` | a cada minuto (e sob demanda por tenant) | Motor de lembretes e avisos: e-mail, WhatsApp e push (Plano 05, D6) | `:108` |
| `lembretes-rotina` | a cada minuto | Lembretes de rotina por push (água, refeições, diário, suplemento, livre), no máximo uma vez por slot (Plano 17, [§5.3.9](05-agenda-portal-conteudo.md#539-lembretes-de-rotina-por-push-plano-17)) | `:115` |
| `agenda-limpeza` | 04:30 | Apaga pedidos da página pública, contadores de limite e `access_events` vencidos | `:133` |
| `retencao-lgpd` | 04:00 | Anonimiza bloqueados no fim do prazo de guarda; apaga exportações vencidas | `:171` |
| `monitor-backup` | 07:00 | Confere em `backup_runs` se o backup do host rodou e alerta os admins | `:149` |
| `monitor-disco` | a cada hora | Alerta com o disco de `/data` em 70% (RNF-13) | `:159` |
| `expirar-diario-foto`, `expirar-plano-pdf` | a cada 15 min | Recupera fotos e PDFs presos em "processando"/"pendente" | `:221`, `:225` |
| `limpar-tmp` | 04:00 | Remove `.tmp` órfãos de `DATA_DIR` | `:324` |
| `expirar-documento-pdf`, `expirar-ia` | a cada 15 min | Recupera PDFs de documento presos (Plano 10A); tarefas de IA paradas, esquecidas na fila ou com sugestão vencida (Plano 11, [§10.3](10-ia.md#103-fluxo)) | `:237`, `:258` |

Filas sem agendamento, disparadas pelo app: `email`, `agenda-tenant`, `whatsapp-evento`, `exportacao-paciente`,
`expirar-exportacao`, `exclusao-atendida`, `plano-pdf`, `diario-foto`, `documento-pdf`, `documento-digitalizado` (Plano
10A) e `ia` (Plano 11; um job por vez, a única fila que chama um serviço de IA) (`src/worker/index.ts`). As opções de
novas tentativas e expiração de cada fila estão em `src/jobs/queues.ts`.

**Guarda de arquitetura:** testes percorrem o grafo de imports a partir das raízes do Next (`src/app`, `proxy`,
`instrumentation`, `next.config`) e falham se ele alcançar código exclusivo do worker —
`push.ts`, `enviar.ts`, `diario-foto-job.ts`, `web-push`, `heic-decode` (`src/modules/notificacoes/push.test.ts:433`)
e `exportacao-job.ts`, `prontuario-pdf.tsx`, `plano-pdf*.tsx`, `@react-pdf/renderer`, `fflate`
(`src/modules/pacientes/exportacao.test.ts`, teste "o PDF e o ZIP ficam fora do grafo do Next"); desde o Plano 11, também
`provedor-anthropic.ts`, `provedor-do-ambiente.ts`, `preparar-arquivo.ts`, `preparar-pdf-thread.ts`, `leitura-job.ts`,
`avaliacao/*`, `@anthropic-ai/sdk` e `pdf-lib` (`src/modules/ia/guardas.test.ts`). O grafo é montado por
`test/grafo-de-imports.ts`.

### O banco (PostgreSQL 16)

- Dois roles (Plano 01, "Architecture"; `CLAUDE.md`, regra 7): o **migrator** (dono do schema, roda migrations,
  `DATABASE_URL_MIGRATOR`) e o **app** (`nutri_app`, membro de `nutri_app_role`, `NOSUPERUSER NOBYPASSRLS`;
  `drizzle/0000_base_roles_e_rls.sql:10-19`). O role de login do app é criado e conferido a cada `migrate`
  (`ensureAppLogin`, `src/db/migrate.ts:21`).
- Toda consulta a tabela com `tenant_id` passa por **`withTenant(ctx, fn)`** (`src/db/tenant.ts:86`), que abre uma
  transação e define `app.tenant_id`, `app.role`, `app.patient_id`, `app.user_id` e `app.ip` com `set_config(…, true)`
  (local à transação; `:79-84`). As políticas RLS leem esses valores. `app_enable_tenant_rls` liga e **força** a RLS
  (`drizzle/0000_base_roles_e_rls.sql:30-34`).
- O detalhe de RLS, auditoria e guardas de CI fica no capítulo de banco de dados.

### Diagrama de componentes

```mermaid
flowchart LR
  subgraph Clientes
    N[Nutricionista<br/>navegador]
    P[Paciente<br/>PWA /p]
    A[Admin<br/>navegador]
    V[Visitante<br/>/n/slug, /consulta/token]
  end

  subgraph VPS["VPS Hostinger (Easypanel / Docker Swarm)"]
    T[Traefik + Let's Encrypt]
    subgraph APP["nutri_app (imagem nutridebby, modo app)"]
      PX[src/proxy.ts<br/>sessão, request_id, CSP]
      PG[Páginas + Server Actions<br/>src/app]
      API[Route Handlers<br/>src/app/api]
      MOD[Módulos de domínio<br/>src/modules/*]
      PROD[getBoss produtor<br/>src/jobs/boss.ts]
    end
    subgraph WRK["nutri_worker (mesma imagem, modo worker)"]
      W[src/worker/index.ts<br/>pg-boss consumidor + cron]
      WJ[PDF, ZIP, push, HEIC,<br/>lembretes, LGPD, monitores]
    end
    DB[(nutri_db<br/>PostgreSQL 16<br/>dados + RLS + schema pgboss)]
    FS[[volume /data<br/>arquivos]]
    EVO[nutri_evolution<br/>Evolution API<br/>opcional, rede interna]
    BK[systemd no host<br/>nutri-backup.sh 03:00]
  end

  subgraph Externos
    RS[Resend]
    TS[Cloudflare Turnstile]
    R2[Cloudflare R2]
    SE[Sentry]
    WP[Serviços de push]
    YT[YouTube / Vimeo]
  end

  N & P & A & V --> T --> PX --> PG
  T --> API
  PG --> MOD
  API --> MOD
  MOD --> DB
  MOD --> FS
  MOD --> PROD --> DB
  W --> DB
  W --> WJ --> FS
  WJ --> RS
  WJ --> WP
  WJ --> EVO
  EVO -- webhook JWT --> API
  API --> TS
  APP -.-> SE
  WRK -.-> SE
  MOD -- oEmbed --> YT
  BK -- pg_dump + rclone crypt --> R2
  BK --> DB
  BK --> FS
```

Notas do diagrama: o Sentry só recebe eventos com `SENTRY_DSN` configurada; a Evolution só existe com as variáveis
`EVOLUTION_*` (sem elas, o WhatsApp fica desligado e os lembretes seguem por e-mail e push — `src/env.ts`, comentário
D1, e Plano 08, D16). Em 05/10/2026, `docker service ls` mostra só `nutri_app`, `nutri_worker` e `nutri_db`.

### Caminho de uma requisição do painel

```mermaid
sequenceDiagram
  participant B as Navegador
  participant T as Traefik
  participant X as src/proxy.ts
  participant P as Página /painel/...
  participant S as requireNutri
  participant M as Módulo de domínio
  participant D as PostgreSQL (RLS)
  B->>T: GET /painel/pacientes (cookie de sessão, prefixo nd)
  T->>X: repassa (X-Forwarded-For)
  X->>X: cookie presente? gera request_id e nonce da CSP
  X->>P: segue com cabeçalhos
  P->>S: requireNutri(path)
  S->>S: sessão válida (30 min sem uso, 8 h), 2FA (admin), DPA aceito, tenant ativo
  S-->>P: ctx com tenantId, role nutri, actorUserId e ip
  P->>M: listarPacientes(ctx, ...)
  M->>D: BEGIN, set_config de app.tenant_id, app.role etc., SELECT
  D-->>M: só linhas do tenant (RLS forçada)
  M-->>P: dados
  P-->>B: HTML com CSP (nonce) e x-request-id
```

---

## 1.5 Mapa de `src/` e da raiz do repositório

| Caminho | Responsabilidade |
|---|---|
| `src/app/` | Rotas do App Router: páginas, layouts, Server Actions, Route Handlers (`api/`), PWA (`manifest.ts`, `sw.ts`, `serwist/`) |
| `src/components/` | Componentes compartilhados (`campo.tsx`, `confirmar-botao.tsx`, `player-sob-demanda.tsx`, `turnstile-widget.tsx`…) e a base visual em `ui/` (`Cartao`, `Botao`, `Aviso`, `Selo`; spec §4.3) |
| `src/db/` | Cliente (`client.ts`), schema Drizzle (`schema/`), `withTenant`/`withConta` (`tenant.ts`), migrations em runtime (`migrate.ts`), sanitização de erros (`errors.ts`) e as guardas de RLS e auditoria (`rls-guard.ts`, `audit-guard.ts` e testes) |
| `src/email/` | Fila de e-mail (`queue.ts`, payload cifrado), consumidor (`job.ts`), transportes Resend/Mailpit (`transport.ts`), modelos React (`templates.tsx`) |
| `src/env.ts` | Validação das variáveis por processo (app, worker, migrator), com Zod |
| `src/instrumentation.ts` | Sentry do servidor e `onRequestError` |
| `src/jobs/` | Produtor pg-boss do app (`boss.ts`) e catálogo de filas (`queues.ts`) |
| `src/lib/` | Infraestrutura transversal: autenticação e sessão (`auth.ts`, `session.ts`, `session-rules.ts`, `tenant-session.ts`, `paciente-session.ts`, `api-auth.ts`), criptografia (`crypto.ts`), URL assinada (`signed-url.ts`), link absoluto do app (`url-do-app.ts`: `urlDoApp(APP_URL, caminho)` só concatena, mantendo o prefixo de caminho; usado em `convites.ts:32` e em `admin/contas/nova/page.tsx:16`), erros de formulário Zod (`validacao.ts`: `primeiroErroPorCampo`, usado em `contas.ts:63`, `marca.ts:66`, `alimentos/medidas.ts`), IP real (`ip.ts`, `request-ip.ts`), CSP (`csp.ts`), logs e Sentry (`logger.ts`, `sentry.ts`, `sentry-filtro.ts`), limites (`limite-memoria.ts`, `corpo.ts`), Turnstile, formatos pt-BR (`numero.ts`, `format.ts`, `text.ts`), tema (`tema/`) |
| `src/modules/` | Domínio, um diretório por módulo (§1.6) |
| `src/proxy.ts` | Interceptador do Next 16 (§1.4) |
| `src/types/` | Tipos de pacotes sem tipagem (`heic-decode.d.ts`) |
| `src/worker/` | Entrada do worker (`index.ts`), heartbeat e embrulho dos consumidores (`sem-detalhe.ts`) |
| `drizzle/` | 94 migrations SQL versionadas (`0000` a `0093`) e o journal do Drizzle |
| `scripts/` | `migrate.ts`, `admin-criar.ts`, `e2e-seed.ts`, `gerar-icones.ts`, seeds da TACO/IBGE (`seeds/`) e o backup do host (`backup/`) |
| `seeds/` | Fontes oficiais (TACO, IBGE) e CSVs curados (Plano 04, D3) |
| `test/` | Helpers do Vitest, teste de isolamento (`isolamento.test.ts`), backup/restauração, grafo de imports, pilha de carga (`carga/`) |
| `e2e/` | Specs do Playwright, inclusive acessibilidade |
| `docs/` | Spec, planos, backlog, runbooks de operação e este manual |
| `Dockerfile`, `docker-entrypoint.sh` | Imagem única e seleção do modo (§1.8) |
| `docker-compose.dev.yml` | Postgres (127.0.0.1:54329) e Mailpit (:8025) do dev |
| `docker-compose.carga.yml` | Pilha separada do teste de carga (Plano 08, D5) |

### Tabelas por arquivo de schema

| Arquivo (`src/db/schema/`) | Tabelas |
|---|---|
| `platform.ts` | `tenants`, `audit_log`, `system_heartbeat`, `stored_files`, `backup_runs`, `admin_actions` (Plano 09) |
| `auth.ts` | `user`, `session`, `account`, `verification`, `two_factor`, `rate_limit` (Better Auth) |
| `access.ts` | `invites`, `consents` |
| `pacientes.ts` | `patients`, `patient_tags`, `patient_tag_links`, `consultations`, `consultation_notes`, `anthropometry`, `energy_calcs`, `anamnesis_templates`, `anamneses`, `exams`, `privacy_requests`, `data_exports` |
| `alimentos.ts` | `foods`, `food_measures` |
| `plano-alimentar.ts` | `meal_plans`, `meals`, `meal_items` |
| `agenda.ts` | `availability_rules`, `availability_blocks`, `appointments`, `notifications`, `public_booking_requests`, `public_rate_limits`, `whatsapp_conexoes`, `push_subscriptions` |
| `conteudo.ts` | `contents`, `recipes`, `recipe_ingredients`, `content_audience`, `content_views`, `content_favorites` |
| `portal.ts` | `access_events`, `diary_entries` |
| `documentos.ts` (Plano 10A) | `signed_documents`, `signed_document_notes`, `signed_document_receipts`, `document_access_codes`, `document_verifications` |
| `ia.ts` (Plano 11) | `ia_tarefas`, `ia_uso`, `ia_gasto_plataforma` |

---

## 1.6 Módulos de domínio (`src/modules/`)

Cada módulo expõe **funções de domínio** em vários arquivos (não um `service.ts` único; Plano 02, spec §4.1). As
rotas e a UI chamam o módulo; o módulo abre `withTenant` e fala com o banco.

| Módulo | Responsabilidade | Arquivos principais | Origem |
|---|---|---|---|
| `plataforma` | Contas de nutricionista, convites, DPA, suspensão/reativação, status do tenant, armazenamento em `/data` com cota e URL assinada, auditoria (`auditRead`, `recordAudit`, "Histórico de acessos" e sua tabela de tela, `ui/historico-acessos.tsx`: `HistoricoAcessos`, `HistoricoAcessosTabela`, `formatarDataHora`), marca e logo, métricas do admin, métricas de sucesso, monitor de backup/disco, preferências da usuária (tema, manual), bootstrap do admin | `contas.ts`, `convites.ts`, `dpa.ts`, `suspensao.ts`, `tenant-status.ts`, `armazenamento.ts`, `audit.ts`, `marca.ts`, `logo.ts`, `metricas.ts`, `metricas-sucesso.ts`, `monitoramento.ts`, `preferencias.ts`, `admin-bootstrap.ts` | Planos 01, 02, 08 |
| `pacientes` | Cadastro, convite e aceite do paciente, etiquetas (`staff_only`), anamnese, antropometria e fórmulas (Apêndice A), gasto energético, atendimentos e notas privadas, exames, evolução, LGPD (arquivar, bloquear, anonimizar), exportação ZIP e anonimização da conta do titular | `pacientes.ts`, `convite-paciente.ts`, `etiquetas.ts`, `anamnese.ts`, `antropometria.ts`, `formulas.ts`, `gasto-energetico.ts`, `atendimentos.ts`, `exames.ts`, `evolucao.ts`, `lgpd.ts`, `exportacao.ts`, `exportacao-job.ts`*, `prontuario-pdf.tsx`*, `conta-titular.ts`, `termo-paciente.ts`; utilitários `base.ts`, `datas.ts`, `telefone.ts` | Plano 03 (+06) |
| `alimentos` | TACO (somente leitura), busca com trigramas, alimentos próprios, medidas caseiras | `taco.ts`, `busca.ts`, `alimentos.ts`, `medidas.ts`, `grupos.ts` | Plano 04 |
| `plano-alimentar` | Cálculo (função pura usada no editor, no servidor e no PDF), rascunho com salvamento por diferença e `revisao`, modelos, publicação/versionamento, meta, PDF | `calculo.ts`, `rascunho.ts`, `carregar.ts`, `modelos.ts`, `publicacao.ts`, `meta.ts`, `plano-pdf.tsx`*, `plano-pdf-job.ts`* | Plano 04 |
| `agenda` | Fuso horário, horários de atendimento e bloqueios, horários livres, consultas, agendamento pelo paciente e pela página pública, cancelamento/remarcação, presença e faltas, link assinado da consulta, limites por IP, avisos à nutricionista, Início do painel | `fuso.ts`, `horarios.ts`, `disponibilidade.ts`, `consultas.ts`, `agendamento-paciente.ts`, `agendamento-publico.ts`, `cancelamento.ts`, `presenca.ts`, `link-consulta.ts`, `acoes-link.ts`, `limite-ip.ts`, `aviso-nutri.ts`, `inicio.ts` | Plano 05 (+08) |
| `notificacoes` | Planejamento dos lembretes (app e worker), envio (só worker), textos, push (só worker), WhatsApp (provedor `evolution`/`sandbox`/`fake`, conexão por QR, cota, JWT e webhook) | `agendar.ts`, `enviar.ts`*, `mensagens.ts`, `push.ts`*, `push-endpoint.ts`, `whatsapp/*` | Plano 05 |
| `portal` | Vínculos da conta (`withConta`), sessão e termo do paciente, acesso diário (CS-02), plano, diário (e conversão da foto*), comentários da nutricionista, evolução, lista de compras, meus dados, perfil, inscrição de push, agenda e conteúdos do portal; desde o P08-13, a faixa de Hoje numa transação | `vinculos.ts`, `sessao.ts`, `termo.ts`, `acesso.ts`, `hoje.ts`, `plano.ts`, `diario.ts`, `diario-foto-job.ts`*, `diario-nutri.ts`, `evolucao.ts`, `lista-compras.ts`, `meus-dados.ts`, `perfil.ts`, `push-inscricao.ts`, `agenda.ts`, `conteudos.ts`, `avisos.ts`, `link-portal.ts` | Planos 06, 07 |
| `conteudo` | Conteúdos (vídeo, receita, orientação), arquivos (capa, PDF), audiência, vídeo e oEmbed, markdown seguro, receitas e cálculo, aviso de conteúdo novo, métricas, LGPD do titular | `conteudos.ts`, `arquivos.ts`, `audiencia.ts`, `video.ts`, `oembed.ts`, `capa.ts`, `markdown.tsx`, `receitas.ts`, `receita-calculo.ts`, `aviso.ts`, `metricas.ts`, `titular.ts` | Plano 07 |
| `lembretes` | Lembretes de rotina por push (Plano 17): validação da configuração, plano do dia (slots, fusão por minuto, teto de 24), leitura e escrita pela equipe e pelo paciente, job de envio* | `constantes.ts`, `config.ts`, `slots.ts`, `equipe.ts`, `paciente.ts`, `envio.ts`* (o envio aos dispositivos fica em `notificacoes/push-dispositivos.ts`*) | Plano 17 |
| `ajuda` | Texto tipado do manual guiado do painel (`GUIAS`; desde o Plano 10A também o guia de `/conta/seguranca`) | `conteudo.ts`, `precisa-do-guia.ts` (P08-13: `precisaDoGuia` à parte, para o portal não levar `GUIAS` ao navegador) | Plano 08 (P08-10) |
| `ia` | Leitura de laudos com IA (F3-01): provedor trocável (`anthropic`, `sandbox`, `fake`), preparo do laudo sem metadados*, job da leitura com portão do envio*, cota e teto da plataforma, ativação com aditivo, ciência do paciente e "Não usar IA", conferência e aplicação das sugestões, avaliação com laudos fictícios*. Detalhe no [cap. 10](10-ia.md) | `constantes.ts`, `textos-legais.ts`, `modo.ts`, `provedor.ts`, `provedor-anthropic.ts`*, `provedor-sandbox.ts`, `provedor-fake.ts`, `provedor-do-ambiente.ts`*, `precos.ts`, `cota.ts`, `cancelar.ts`, `alertas.ts`, `ativacao.ts`, `ciencia-paciente.ts`, `tarefas.ts`, `preparar-arquivo.ts`*, `preparar-pdf-thread.ts`*, `instrucoes/leitura.ts`, `resposta-leitura.ts`, `valor-laudo.ts`, `correspondencia.ts`, `leitura-job.ts`*, `conferencia.ts`, `avaliacao/`*; Plano 15: a pasta `nutri-paciente/` (IA Nutri do paciente: `conversa.ts`, `estado.ts`, `participacao.ts`, `consentimento.ts`, `duvidas.ts`, `textos.ts`, `sinais-risco.ts`, `termos-sensiveis.ts`, `validar-resposta.ts`, `montar-resposta.ts`, `instrucoes.ts`, `lgpd.ts`, `contexto.ts`*, `job.ts`*, `revogacao-job.ts`*, `risco-job.ts`*, `varredura.ts`*, `retencao.ts`*; [§10.14](10-ia.md#1014-ia-nutri-do-paciente-plano-15)) | Plano 11; 14A, 14B e 15 |
| `documentos` | Documentos assinados: perfil profissional para documentos, receita (prescrição), preparo e PDF com código e QR*, assinatura digitalizada (fotos + 2FA → PDF novo*), assinatura no banco sem sessão, entrega (portal, link de uso único, pessoalmente), recebimento, verificação pública, cancelamento, LGPD da receita. Detalhe no [cap. 9](09-documentos-assinados.md) | `constantes.ts`, `erros.ts`, `perfil-profissional.ts`, `codigo.ts`, `prescricao.ts`, `documentos.ts`, `arquivos-do-preparo.ts`, `documento-pdf.tsx`*, `documento-pdf-job.ts`*, `digitalizada.ts`, `digitalizada-job.tsx`*, `registrar-assinatura.ts`, `verificacao.ts`, `entrega.ts`, `recebimento.ts`, `link-documento.ts`, `portal.ts`, `cancelamento.ts`, `lgpd-documentos.ts` | Plano 10A |
| `ficha` | Ficha do paciente no painel (Plano 18, PR 1): registro de seções do Início (contrato `SecaoDaFicha`, 8 seções numa transação `nutri`, sem `auditRead`; a seção com `leitura` ganha um, gravado por `inicio.ts`), cartão Resumo, diálogo Adicionar e cabeçalho com a última avaliação (um `auditRead` de antropometria); PR 2: a nota "Cadastro incompleto" (só presença) e o "No app do paciente" (`noAppDoPaciente`, sessão `nutri` + contexto do paciente sem login, só contagens e ids) | `tipos.ts`, `secoes/` (um arquivo por seção + `index.ts`), `inicio.ts`, `resumo.ts`, `adicionar.ts`, `cabecalho.ts`, `textos.ts`; PR 2: `incompleto.ts`, `no-app.ts` ([§4.2.10](04-modulos-clinicos.md#4210-ficha-do-paciente-início-perfil-cabeçalho-e-registro-de-seções-plano-18-pr-1), [§4.2.11](04-modulos-clinicos.md#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2)) | Plano 18 |

\* Só roda no worker; protegido pela guarda de grafo de imports (§1.4).

### Dependências entre módulos

Contagem de `import` de `@/modules/<outro>` em código de produção (sem testes), em 05/10/2026 (antes do Plano 10A; o
módulo `documentos` usa `pacientes`, `plataforma`, `notificacoes`, `portal` e `agenda`, e é usado por `pacientes`
— exportação e anonimização — e por `agenda/inicio.ts`, o cartão do Início; o módulo `ia`, do Plano 11, usa `pacientes`
(13 imports), `plataforma` (6), `agenda` (2) e `notificacoes` (1), e é usado por `pacientes` — `lgpd.ts`, `exames.ts`,
`exportacao-job.ts` — e por `plataforma` — `contas.ts`, `dpa.ts`; o módulo `lembretes`, do Plano 17, usa `agenda` (5 imports),
`plataforma` (3), `portal` (3), `notificacoes` (2) e `pacientes` (2), e nenhum outro módulo o importa (`lgpd.ts` e
`exportacao-job.ts` usam só a tabela, por `@/db/schema`): só as telas e o worker o chamam; o módulo `ficha`, do Plano 18,
usa `pacientes` (6 imports no PR 1; no PR 2, também `convite-paciente.ts` e `datas.ts`, pelo `no-app.ts`), `documentos` (2) e
`plataforma` (2), e só as telas da ficha o importam):

| Módulo → | agenda | alimentos | conteudo | notificacoes | pacientes | plano-alimentar | plataforma | portal |
|---|---|---|---|---|---|---|---|---|
| `agenda` | — | | | 6 | 16 | | 4 | 1 |
| `ajuda` | | | | | | | 1 | |
| `alimentos` | | — | | | 2 | | | |
| `conteudo` | | 2 | — | 1 | 5 | 3 | 3 | |
| `notificacoes` | 9 | | | — | 1 | | 3 | 1 |
| `pacientes` | 2 | | 2 | 1 | — | | 15 | 2 |
| `plano-alimentar` | | 7 | | | 9 | — | 5 | 1 |
| `plataforma` | 1 | | | | 2 | | — | |
| `portal` | 9 | 1 | 6 | 3 | 11 | 3 | 7 | — |

```mermaid
flowchart TD
  planoAlimentar[plano-alimentar]
  portal --> agenda & conteudo & pacientes & plataforma & notificacoes & planoAlimentar & alimentos
  conteudo --> pacientes & plataforma & planoAlimentar & alimentos & notificacoes
  planoAlimentar --> pacientes & alimentos & plataforma & portal
  agenda --> pacientes & notificacoes & plataforma & portal
  notificacoes --> agenda & plataforma & pacientes & portal
  pacientes --> plataforma & agenda & conteudo & portal & notificacoes
  alimentos --> pacientes
  plataforma --> pacientes & agenda
  ajuda --> plataforma
```

Como ler o grafo:

- **Não há camadas estritas.** Existem ciclos entre módulos, por exemplo `agenda` ↔ `notificacoes`
  (`agenda` usa `notificacoes/agendar`; `notificacoes/tipos.ts` usa `agenda/fuso`) e `pacientes` ↔ `portal`
  (`pacientes/lgpd.ts:14` importa `portal/acesso`; o portal lê o prontuário). Os ciclos são entre **arquivos
  diferentes** dos módulos; mantenha assim (um arquivo não deve importar outro que o importa de volta).
- A maior parte do acoplamento passa por **utilitários compartilhados**: `pacientes/base.ts`
  (`carregarPacienteParaEscrita`, erros de paciente), `pacientes/datas.ts` (datas no fuso), `agenda/fuso.ts`,
  `plataforma/audit.ts`, `plataforma/tenant-status.ts`, `plataforma/armazenamento.ts` e `notificacoes/agendar.ts`.
- **LGPD é transversal**: `pacientes/lgpd.ts` chama `agenda/cancelamento`, `conteudo/titular`, `portal/acesso` e
  `plataforma/armazenamento` (`src/modules/pacientes/lgpd.ts:9-15`) para apagar ou anonimizar o que cada módulo guarda.
  Um módulo novo que guarde dado do paciente precisa entrar ali.
- O **admin** só pode importar módulos que não acessam tabela com `tenant_id` (ou que só trazem constantes): guarda
  `src/app/admin/sem-tabelas-tenant.test.ts` (spec §4.1, "Métricas do admin").

---

## 1.7 Rotas principais

### Páginas

| Área | Rotas | Guarda |
|---|---|---|
| Entrada | `/` (redireciona para `/entrar`), `/entrar`, `/entrar/2fa`, `/esqueci-senha`, `/definir-senha`, `/inicio` (desvia pelo papel), `/indisponivel` (tenant suspenso), `/sair/erro` | Públicas; `/inicio` usa `requireUser` |
| Conta | `/conta/seguranca` (2FA e senha; usada pelo admin e pela nutricionista; bloco "Como funciona" com o guia `seguranca` desde o Plano 10A) | `requireUser` |
| Admin | Três abas desde o Plano 16 (T17, `ABAS_DO_ADMIN`, `src/app/admin/navegacao.ts`): **Contas** (`/admin`, lista enxuta com o resumo `resumoDasContas` e busca; `/admin/contas/<id>`, a página da conta com métricas, uso, liberações, cotas, suspensão e convite, `contaPorId`; `/admin/contas/nova`), **Servidor** (`/admin/servidor`, backup e disco; desde o Plano 15, o desligamento de emergência da IA Nutri) e **Segurança** (`/admin/seguranca`, reinício do 2FA) | `requireUser(['admin'])` |
| Painel da nutricionista | `/painel` (Início em bento), `/painel/pacientes` e o prontuário `/painel/pacientes/[id]/…` (desde o Plano 18, a aba Início na raiz, `perfil`, com o cadastro, o acesso ao app e as etiquetas, e — PR 2 — `app`, o "No app do paciente", [§4.2.10](04-modulos-clinicos.md#4210-ficha-do-paciente-início-perfil-cabeçalho-e-registro-de-seções-plano-18-pr-1); anamnese, antropometria, gasto energético, atendimentos, exames, evolução, plano alimentar, privacidade, histórico, exportações; desde o Plano 14B-2, `resumo-ia` e `plano-alimentar/rascunho-ia`, [§10.13.6](10-ia.md#10136-telas-e-manual-guiado); desde o Plano 15, a aba `ia-nutri`, com a IA Nutri ativada ou com participação), `/painel/duvidas` (+ `[id]`; fila "Dúvidas dos pacientes", Plano 15, [§10.14.10](10-ia.md#101410-telas-textos-fixos-e-manual-guiado)), `/painel/agenda` (+ `nova`, `horarios`, `pendencias`, `consultas/[id]`), `/painel/diarios`, `/painel/conteudos`, `/painel/alimentos`, `/painel/planos/modelos`, `/painel/anamnese/modelos`, `/painel/whatsapp`, `/painel/configuracoes` (+ `perfil`, com a seção "Dados para documentos"), `/painel/ajuda`, `/painel/dpa`; Plano 10A: `/painel/pacientes/[id]/documentos` (+ `[docId]`), só com o interruptor `documentos_liberados` | `requireNutri` em cada página. Menu de 6 itens em `src/app/painel/navegacao.ts:3-8` |
| Portal do paciente (PWA) | Cinco seções desde o Plano 16 (layout G): Hoje `/p/inicio`, Jornada `/p/jornada`, Plano `/p/plano` (+ `refeicao/[id]`), Exames `/p/exames` (condicional), Eu `/p/perfil`; e `/p/compras`, `/p/diario`, `/p/conteudos` (+ `[id]`), `/p/evolucao` ("Todas as medidas"), `/p/agenda` (+ `nova`, `[id]`), `/p/ajuda`, `/p/meus-dados/exportacoes/[id]`, `/p/documentos` (Plano 10A), `/p/perfil/ia` (autorização de IA, Plano 14A), `/p/perfil/lembretes` (Plano 17), `/p/plano/ia` e `/p/plano/ia/autorizar` (IA Nutri do paciente e o consentimento, dentro de Plano; Plano 15), cada uma marcando uma seção; fora do layout: `/p/escolher`, `/p/sem-acesso`, `/p/termo` | `requirePaciente`. Seções em `SECOES_DO_PORTAL` (`src/app/p/navegacao.ts`; [§5.5.2](05-agenda-portal-conteudo.md#552-rotas-e-seções)). Manifest com `scope: '/p/'` e `start_url: '/p/inicio'` (`src/app/manifest.ts`) |
| Visitante | `/n/[slug]` (agendamento público), `/consulta/[token]` (link da consulta), `/convite/[token]` (nutricionista, 72 h), `/convite/paciente/[token]` (paciente, 7 dias), `/documento/[token]` (link do documento, 30 dias, código de 6 dígitos; Plano 10A), `/v` e `/v/[codigo]` (verificação pública do documento; Plano 10A), `/autorizacao-ia/[token]` (pedido e retirada da autorização de IA pelo link do e-mail; o GET não grava; Plano 14A) | Sem login; Turnstile, token com hash ou HMAC; limites por IP |

A lista de telas do painel no E2E de acessibilidade (`e2e/painel-rotas.ts`) é comparada com os `page.tsx` pela
guarda `src/app/painel/rotas-axe.test.ts`: tela nova sem axe quebra o CI (Plano 08, D25). Checklist de tela nova
(painel e portal, com o que o CI cobra e o que não cobra): [§7.4.5](07-testes-qualidade-e-processo.md#745-checklist-tela-nova).

### Route Handlers (`src/app/api/` e outros)

Nenhuma rota de API passa pelo `src/proxy.ts` (§1.4).

| Rota | Métodos | Uso | Guarda |
|---|---|---|---|
| `/api/auth/[...all]` | GET, POST | Better Auth (login, 2FA, recuperação de senha) | Better Auth; limite 5/15 min por IP+rota; Turnstile no `request-password-reset` (`src/lib/auth.ts:159-164`) |
| `/sair` | POST | Encerra a sessão e limpa o aparelho (`Clear-Site-Data`) | Sessão própria (`src/app/sair/route.ts`) |
| `/api/health` | GET | Banco + heartbeat do worker; 200 ou 503 com motivo (RNF-04) | Pública |
| `/api/arquivos` | GET | Serve arquivo de `/data` por URL assinada de 5 min | Assinatura HMAC (`verifyFileUrl`, `src/lib/signed-url.ts`) |
| `/api/painel/pacientes/[id]` | GET | JSON do paciente (404 fora do tenant) | `requireApiNutri` |
| `/api/painel/pacientes/[id]/exames` | POST | Upload de laudo (até 20 MB) | `mesmaOrigem` + `requireApiNutri` + corpo limitado |
| `/api/painel/alimentos` | GET | Busca de alimentos do editor | `requireApiNutri` |
| `/api/painel/planos/[id]` | GET, PUT | Carrega e salva o rascunho do plano (por diferença, `revisao`) | `requireApiNutri`; corpo do PUT ≤ 512 KB; PUT: `mesmaOrigem` antes da sessão (P09-01) |
| `/api/painel/planos/[id]/revisao`, `/pdf` | GET | Revisão atual; PDF do plano | `requireApiNutri` |
| `/api/painel/marca/logo` | POST | Upload do logo | `mesmaOrigem` + `requireApiNutri` |
| `/api/painel/conteudos/[id]/capa`, `/pdf` | POST | Upload da capa e do PDF do conteúdo | `mesmaOrigem` + `requireApiNutri` |
| `/api/painel/whatsapp/estado` | GET | Estado da conexão do WhatsApp (QR) | `requireApiNutri` |
| `/api/p/acesso` | POST | Acesso do dia (CS-02) e renovação dos cookies | `mesmaOrigem` + `requireApiPaciente` |
| `/api/p/diario` | POST | Registro do diário (multipart) | `mesmaOrigem` + `requireApiPaciente` |
| `/api/p/push` | POST, DELETE | Ativar, sincronizar e cancelar push | POST: `mesmaOrigem` (primeira linha, antes até da falta de VAPID, P09-01) + `requireApiPaciente` + limite em memória (`src/app/api/p/push/route.ts:49`); DELETE: `mesmaOrigem` + `requireApiUser(['paciente'])` (`:67`), que basta a sessão de paciente, sem termo nem vínculo (S-2) |
| `/api/p/plano/pdf`, `/api/p/conteudos/[id]/pdf` | GET | PDF do plano publicado; PDF da orientação (303 para URL assinada) | `requireApiPaciente` |
| `/api/p/vinculo` | GET | Troca o consultório do cookie `nd_vinculo` | `requireApiUser(['paciente'])` |
| `/api/p/ping` | GET | 204 para o selo offline | Pública |
| `/api/n/[slug]/codigo`, `/horario`, `/confirmar` | POST | Página pública: pedido + código por e-mail + consulta | Turnstile, limites por IP/e-mail, corpo ≤ 8 KB (`src/app/api/n/[slug]/resposta.ts`) |
| `/api/webhooks/whatsapp` | POST | Eventos da Evolution API | JWT HS256 por instância (Plano 05, D4) |
| `/api/erro-cliente` | POST | Erros do navegador (RNF-11) | `mesmaOrigem` + limite + corpo limitado |
| `/api/csp-relatorio` | POST | Relatórios de CSP, só com `CSP_MODO=relatorio` | Limite + corpo limitado |
| `/serwist/[path]` | GET | Service worker gerado no build | Pública |
| `/api/painel/documentos/[id]/pdf` | GET | Estado do PDF (`?estado=1`), PDF preparado (`?base=1`) ou assinado (303 para URL assinada) — Plano 10A | `requireApiNutri` + interruptor `documentos_liberados` |
| `/api/painel/documentos/[id]/digitalizada` | POST | Fotos assinadas + código do 2FA (multipart, ≤ 10 MB) — Plano 10A | `mesmaOrigem` + `requireApiNutri` + corpo limitado + 2 envios por processo, 1 por usuária |
| `/api/p/documentos/[id]/pdf` | GET | PDF do documento no portal (registra "aberto") — Plano 10A | `requireApiPaciente` + interruptor |
| `/api/documento/[token]/codigo`, `/confirmar`, `/recebido` | POST | Link do documento: pedir o código, abrir a sessão, confirmar o recebimento — Plano 10A | `mesmaOrigem`; Turnstile e limites por IP e por documento; sessão `nd_doc` |
| `/api/documento/[token]/pdf` | GET | PDF pelo link (com a sessão) | Token + sessão `nd_doc` |
| `/api/painel/ia/tarefas/[id]` | GET | Situação da leitura de laudo (`{ status, erro }`, `no-store`, sem auditoria) para o acompanhamento da aba Exames — Plano 11 | `requireApiNutri` |
| `/api/painel/ia/geracoes/[id]` | GET | Situação do pacote de modelos sugeridos pela IA (`{ status, erro }`, `no-store`, sem auditoria: não há paciente) para o acompanhamento em Configurações — Plano 14B-1 | `requireApiNutri` (sem renovar a sessão) |
| `/api/painel/pacientes/[id]/autorizacao-ia/termo` | POST | Termo em papel da autorização de IA assinado (multipart, ≤ 20 MB) — Plano 14A | `mesmaOrigem` + `requireApiNutri` + `idValido` + corpo limitado (60 s) + 2 envios por processo |
| `/api/painel/pacientes/[id]/autorizacao-ia/[autorizacaoId]/termo` | GET | "Ver termo assinado": `auditRead` e 303 para a URL assinada de 5 min — Plano 14A | `requireApiNutri` |
| `/api/p/ia-nutri/situacao` | GET | Situação das perguntas da IA Nutri (`[{ id, status }]` das 5 últimas, `no-store`, sem `auditRead`) para a tela sair de "Pensando…" — Plano 15 | `requireApiPaciente` |
| `/api/autorizacao-ia/[token]/autorizar`, `/retirar` | POST | Autorizar ou retirar a autorização de IA pelo link do e-mail, sem login — Plano 14A | `mesmaOrigem`; corpo ≤ 8 KB; Turnstile; 20 por hora por IP; token com MAC ([§10.10.5](10-ia.md#10105-os-canais-app-link-e-papel)) |

---

## 1.8 Infraestrutura

### Servidor

| Item | Valor | Fonte |
|---|---|---|
| Máquina | VPS Hostinger, 8 vCPU, 32 GB de RAM, ~400 GB de disco, Ubuntu 24.04 | `CLAUDE.md` do servidor (medido em 04/10/2026); spec RNF-03 v1.11 |
| Orquestração | **Easypanel** sobre **Docker Swarm**; o Traefik do Easypanel termina o HTTPS (Let's Encrypt) | Spec §4; Plano 01, Tarefa 13 |
| Projeto no Easypanel | `nutri`, com os serviços `nutri_app`, `nutri_worker`, `nutri_db` | Plano 01, Tarefa 13; `docker service ls` (05/10/2026) |
| Vizinhos | O CRM `cursoia_crm` roda na mesma VPS e não pode ser afetado | Spec RNF-03, P-05 |
| Domínio | `https://nutri.wsscloud.tech` (produção) | Backlog, "Resumo"; Plano 08, D8 |
| Runner de CI (desde 12/10/2026) | Runner próprio do GitHub Actions (`vps-nutri-ci`, rótulo `nutri-ci`) no usuário `gh-runner` (UID 1500): Docker rootless próprio, sem Swarm e sem acesso ao socket de produção; `user-1500.slice` com 4 de 8 vCPU, 12 GB e sem swap; disco de 100 GB em imagem ext4; filtro de saída nft (só 80/443 e DNS); vigias de início e fim de job | `docs/operacao/runner-proprio.md` (seção 0 = como ficou instalado); `infra/runner/`; [§7.7](07-testes-qualidade-e-processo.md#77-pipeline-do-ci-e-deploy) |

**Regra de operação:** configuração de serviço (variáveis, domínio, imagem, volumes) muda **só pelo Easypanel**,
nunca por `docker service update` — o Easypanel sobrescreve no próximo deploy (`CLAUDE.md` do servidor, regra 1;
`CLAUDE.md` do projeto, regra 6). Reiniciar serviço, mexer no banco de produção e dar merge na `main` exigem
confirmação do dono.

### Serviços (estado observado em 05/10/2026 por `docker service inspect`, só leitura)

| Serviço | Imagem | Modo | Limites | Volume | Atualização |
|---|---|---|---|---|---|
| `nutri_app` | `ghcr.io/fabianojp06/nutridebby:latest` | `APP_ROLE=app` (migra e sobe o Next na porta 3000) | 2 vCPU (desde 22/10/2026, RNF-03), 1 GiB | bind em `/data` | `start-first` |
| `nutri_worker` | mesma imagem | `APP_ROLE=worker` | 1 vCPU, 1 GiB | bind em `/data` | `start-first` |
| `nutri_db` | `postgres:16` | — | 1 GiB | bind em `/var/lib/postgresql/data` | `stop-first` |
| `nutri_evolution` | Evolution API v2.3.7 (spec §4) | — | 512 MB / 0,5 vCPU previstos (RNF-03) | — | **ainda não implantado** (E-04 revisado; Plano 08, D16) |

O app e o worker montam o **mesmo** `/data` (spec §4: "mesmo nó"). A spec ainda vai revisar os limites depois da
rodada do k6 (RNF-03, pendente).

### Backup (fora do Easypanel)

O backup roda **no host** por `systemd` às 03:00 (America/Sao_Paulo): `pg_dump` dentro do container `nutri_db` e
`rclone crypt` para o Cloudflare R2, mais `rclone sync` do `/data` (`scripts/backup/nutri-backup.timer`,
`nutri-backup.service`, `nutri-backup.sh`; spec RNF-05; Plano 02, "Onde roda o backup"). O worker só confere
`backup_runs` às 07:00. A instalação no host (P02-11) ainda está pendente no backlog. **Nunca** rode
`nutri-backup.sh` fora de `test/backup.test.ts` (`CLAUDE.md` do projeto, regra 10). Detalhe em
[§6.5 Backup e restauração](06-worker-seguranca-operacao.md#65-backup-e-restauração-rnf-05-regra-10).

### Imagem Docker

`Dockerfile` multi-estágio:

| Estágio | O que faz | Linhas |
|---|---|---|
| `base` | `node:24-bookworm-slim`, `corepack enable`, telemetria do Next desligada | `Dockerfile:2-5` |
| `deps` | `pnpm install --frozen-lockfile` com cache | `:7-9` |
| `build` | Copia o repositório, define variáveis **fictícias só para o build** (nenhuma conexão é aberta), `pnpm build`, `pnpm prune --prod`, apaga `.next/cache` | `:11-23` |
| `runner` | `NODE_ENV=production`, `PORT=3000`; copia só `package.json`, `node_modules`, `.next`, `public`, `src`, `scripts`, `drizzle`, `next.config.ts`, `tsconfig.json` e o entrypoint; cria `/data` do usuário `node`; roda como `node` | `:25-43` |

O `src/` vai para a imagem porque o worker, as migrations e o `admin:criar` rodam TypeScript direto com `tsx`.

`docker-entrypoint.sh` escolhe o modo pelo primeiro argumento ou por `APP_ROLE` (padrão `app`):

| Modo | Comando | Detalhe |
|---|---|---|
| `app` | `node --import tsx scripts/migrate.ts` e depois `next start` | Migrations antes do start; o Next sobe **sem** `DATABASE_URL_MIGRATOR` no ambiente (`env -u`) |
| `worker` | `node --import tsx src/worker/index.ts` | Sem `DATABASE_URL_MIGRATOR` |
| `admin:criar` | `node --import tsx scripts/admin-criar.ts <email>` | Só por `docker exec -it` interativo: o link de definição de senha sai no terminal (Plano 01, Tarefa 13, Step 5) |
| `admin:reiniciar-2fa` | `node --import tsx scripts/admin-reiniciar-2fa.ts <email>` | Sem `DATABASE_URL_MIGRATOR`. Só o dono, por `docker exec -it`, com OK e snapshot, quando nenhum admin consegue entrar (P09-02; [§6.9.1](06-worker-seguranca-operacao.md#691-segredo-vazado)) |
| outro | `exec` do comando | Depuração |

Por que remover `DATABASE_URL_MIGRATOR`: é a credencial do dono do schema, capaz de desligar a RLS; só o script de
migrations a recebe (`src/env.ts:6-10`, comentário RNF-07).

### Deploy: CI no runner próprio → GHCR → Easypanel

```mermaid
flowchart LR
  PR[Pull request] --> CI
  subgraph CI["ci.yml (PR e chamado pelo deploy) — runner próprio na VPS, um job por vez"]
    Q[quality<br/>lint + typecheck]
    TE[test<br/>Vitest + Testcontainers<br/>rclone do host]
    E2E[e2e<br/>Postgres 16 + Mailpit<br/>migrate, seed, build, Playwright]
    IMG[image<br/>build local + orçamento 265 MB]
  end
  M[Merge na main<br/>= deploy] --> D
  subgraph D["deploy.yml (push na main; decidir e publish no GitHub)"]
    DEC[decidir: o PR já passou<br/>o CI nesta árvore?] -->|não ou dúvida| C2[job ci: reusa ci.yml]
    DEC -->|sim| PUB
    EMG[disparo manual na main<br/>PUBLICAR-SEM-CI<br/>emergência, OK do dono] --> PUB
    C2 --> PUB[publish<br/>build + push GHCR<br/>:sha e :latest]
    PUB --> PODA[poda: mantém 2 versões]
    PODA --> HK[POST webhooks Easypanel<br/>app e worker]
  end
  HK --> EP[Easypanel puxa :latest<br/>nutri_app migra e sobe<br/>nutri_worker sobe]
```

Resumo: o CI (`.github/workflows/ci.yml`) tem os jobs `mudancas`, `quality`, `test`, `e2e` e `image`. Desde 12/10/2026,
eles rodam no runner próprio da VPS, um por vez, e o CI de PR não gasta minutos do Actions. O deploy
(`.github/workflows/deploy.yml`) reusa o CI — ou o pula, quando o PR já passou o CI na mesma árvore (job `decidir`,
desde 09/10/2026) —, publica `:<sha>` e `:latest` no GHCR, poda para 2 versões e chama os webhooks do Easypanel do app e
do worker. O `decidir` e o `publish` ficam no GitHub (`ubuntu-latest`): os segredos de deploy e o `packages: write`
nunca vão para a VPS, e a imagem publicada é montada lá. Com o runner fora do ar, há a publicação de emergência sem CI
(disparo manual com `PUBLICAR-SEM-CI`, só com validação local e OK do dono).
As migrations rodam no start do app (`docker-entrypoint.sh:9`), por isso seguem **expand/contract** (spec §9.7).
Volta atrás: fixar o `:<sha>` anterior no app e no worker (os serviços usam `:latest`), sem voltar migration; roteiro
em [§6.8.1](06-worker-seguranca-operacao.md#681-roteiro-de-volta-atrás). Jobs, passos, variáveis do CI e o porquê de cada escolha:
[§7.7 Pipeline do CI e deploy](07-testes-qualidade-e-processo.md#77-pipeline-do-ci-e-deploy).

Merge na `main` = deploy em produção = reinício de serviço: exige OK explícito do dono (índice dos planos, "Revisão
obrigatória a cada entrega").

### Ambientes

| Ambiente | Onde | Composição |
|---|---|---|
| dev | VPS, `docker-compose.dev.yml` | Postgres 16 em `127.0.0.1:54329`, Mailpit em `:8025`, `pnpm dev` na porta **3100** (a 3000 é o painel do Easypanel), `pnpm worker` |
| CI | Runner próprio na VPS (desde 12/10/2026), isolado da produção: usuário `gh-runner`, Docker rootless, `user-1500.slice`, filtro de rede ([§7.7](07-testes-qualidade-e-processo.md#77-pipeline-do-ci-e-deploy); `docs/operacao/runner-proprio.md`) | Jobs em contêiner `mcr.microsoft.com/playwright:v1.63.0-noble`; Postgres e Mailpit como `services` sem portas publicadas, pelo nome na rede do job; Testcontainers no `pnpm test`, pelo IP do contêiner. O `decidir` e o `publish` do deploy rodam no GitHub |
| carga | VPS, `docker-compose.carga.yml` | Banco próprio, imagem do GHCR, portas só em `127.0.0.1`; nunca contra produção (Plano 08, D5) |
| prod | Easypanel, projeto `nutri` | Tabela "Serviços" acima |
| staging | — | Fase 2 (spec §9.4) |

---

## 1.9 Variáveis de ambiente

Fonte da verdade: `src/env.ts`. Cada processo valida **só o que usa** e falha na subida com mensagem clara
(`parseWith`, `src/env.ts:308-315`):

| Esquema | Quem usa | Linha |
|---|---|---|
| `serverSchema` | Base de todos; sozinho no cliente do banco e no produtor pg-boss (`getServerEnv`) | `src/env.ts:28` |
| `appSchema` | App Next.js e `admin:criar` (`getEnv`) | `src/env.ts:109` |
| `workerSchema` | Worker (`getWorkerEnv`) | `src/env.ts:229` |
| `migratorSchema` | Só `scripts/migrate.ts` (`getMigratorEnv`) | `src/env.ts:282` |

"Produção" nas regras abaixo é `emProducao`: `NODE_ENV=production` **e** `APP_URL` fora de `localhost`
(`src/env.ts:88`) — o E2E com `next start` em `localhost` não conta como produção. Variável opcional com valor vazio
(`CHAVE=`) conta como ausente (`opcional`, `src/env.ts:25`).

### Aplicação e worker

| Variável | Processo | Obrigatória? | Para que serve | Validada / lida em |
|---|---|---|---|---|
| `NODE_ENV` | todos | Não (padrão `development`; a imagem fixa `production`) | Modo de execução; liga as regras de produção | `src/env.ts:29`; `src/proxy.ts:32` (CSP de dev); `Dockerfile:26` |
| `DATABASE_URL` | app, worker, migrator | **Sim** | Conexão com o role da aplicação (sem `BYPASSRLS`); o migrator a usa para criar/conferir esse role | `src/env.ts:30`, `:284`; `src/db/client.ts:39`; `src/jobs/boss.ts:20`; `src/worker/index.ts:52`; `src/db/migrate.ts:21` |
| `DATABASE_URL_MIGRATOR` | só migrations | **Sim** no `migrate` | Role dono do schema; precisa ser **outro** usuário que o de `DATABASE_URL` (`src/env.ts:287-300`). Removida do ambiente de app e worker pelo entrypoint | `src/env.ts:285`; `scripts/migrate.ts:4`; `drizzle.config.ts` |
| `LOG_LEVEL` | todos | Não (padrão `info`) | Nível do pino | `src/env.ts:31`; `src/lib/logger.ts:27` (lê `process.env`) |
| `SENTRY_DSN` | app, worker | Não (sem ela, Sentry desligado) | DSN do Sentry; só `https://` | `src/env.ts:33`; `src/instrumentation.ts:9`; `src/worker/index.ts:49` |
| `SENTRY_ENVIRONMENT` | app, worker | Não (padrão `producao`) | Ambiente no Sentry (`[a-z0-9-]`) | `src/env.ts:34`; mesmos pontos |
| `APP_URL` | app, worker | **Sim** | URL pública; base de todos os links (e-mail, push, WhatsApp), `baseURL` do Better Auth, conferência de origem; normalizada sem barra final. Desde o Plano 10A, impressa no QR e no rodapé de toda receita (`/v/<código>`): mudar o domínio exige manter `/v/*` respondendo | `src/env.ts:119`, `:231`; `src/lib/auth.ts:42`; `src/lib/mesma-origem.ts:9`; `src/proxy.ts:33` |
| `AUTH_SECRET` | app | **Sim** (≥ 32) | Segredo do Better Auth (cookies, cifra do TOTP) | `src/env.ts:120`; `src/lib/auth.ts:54` |
| `ENCRYPTION_KEY` | app, worker | **Sim** (32 bytes em base64 canônico) | AES-256-GCM dos payloads da fila (e-mail, eventos do WhatsApp) e chave-mãe (HKDF) do link assinado da consulta, dos contadores de `public_rate_limits` e, desde o Plano 10A, do link do documento (`nutridebby:link-documento:v1`); trocar a chave invalida esses links | `src/env.ts:123`, `:232`; `src/lib/crypto.ts:27`; Plano 05, D20 |
| `FILE_URL_SECRET` | app | **Sim** (≥ 32) | HMAC das URLs assinadas de arquivo (5 min) | `src/env.ts:124`; `src/lib/signed-url.ts:18`, `:32` |
| `DATA_DIR` | app, worker | **Sim** | Pasta dos arquivos (`/data` em produção), resolvida para caminho absoluto | `src/env.ts:127`, `:233`; `src/modules/plataforma/armazenamento.ts:88`; `src/worker/index.ts` |
| `TURNSTILE_SITE_KEY` | app | **Sim** | Chave pública do widget (recuperação de senha, página pública); chave de teste recusada em produção | `src/env.ts:128`; `src/app/esqueci-senha/page.tsx:10`; `src/app/n/[slug]/page.tsx:52` |
| `TURNSTILE_SECRET_KEY` | app | **Sim** | Validação do token no servidor; chave de teste recusada em produção | `src/env.ts:133`; `src/lib/auth.ts:46`; `src/app/api/n/[slug]/resposta.ts:41` |
| `TRUSTED_PROXIES` | app | **Sim com `NODE_ENV=production`** | CIDRs dos proxies confiáveis (rede do Traefik/Swarm) para achar o IP real; sem ela, o limite de login vira um balde global | `src/env.ts:135`, `:174-181`; `src/lib/auth.ts:43`; `src/lib/ip.ts`; rotas `/api/n`, `/api/p/push`, `/api/erro-cliente`, `/api/csp-relatorio` |
| `EVOLUTION_API_URL` | app, worker | Não (as três `EVOLUTION_*` juntas ou nenhuma) | Endereço interno da Evolution API | `src/env.ts:149`, `:240`; `src/modules/notificacoes/whatsapp/ambiente.ts:19` |
| `EVOLUTION_API_KEY` | app, worker | Junto com a anterior (≥ 16) | Chave da API da Evolution | `src/env.ts:150`, `:241`; `ambiente.ts:29` |
| `EVOLUTION_WEBHOOK_SECRET` | app | Junto com as anteriores; **sim** com `WHATSAPP_SANDBOX=1` | Segredo-mestre do `jwt_key` de cada instância; o valor do `.env.example` é recusado em produção | `src/env.ts:151`; `src/app/api/webhooks/whatsapp/route.ts:12` |
| `EVOLUTION_WEBHOOK_URL` | app | **Sim em produção** com Evolution ligada; tem de ser endereço interno | URL que a Evolution chama (padrão em dev: `APP_URL` + `/api/webhooks/whatsapp`) | `src/env.ts:152`, `:188-203`; `ambiente.ts:30` |
| `EVOLUTION_WEBHOOK_URL_PUBLICA` | app | Não | `1` permite URL pública no webhook (opção explícita) | `src/env.ts:153` |
| `WHATSAPP_SANDBOX` | app, worker | Não; **recusada em produção** | `1` = WhatsApp vira e-mail no Mailpit (dev, CI, E2E) | `src/env.ts:154`, `:242`; `ambiente.ts:20` |
| `VAPID_PUBLIC_KEY` | app, worker | Não (no worker, as três `VAPID_*` juntas) | Chave pública do push; a do app entrega ao navegador e tem de ser **a mesma** do worker | `src/env.ts:156`, `:244`; `src/app/api/p/push/route.ts:48`; `src/modules/notificacoes/push.ts:79` |
| `VAPID_PRIVATE_KEY` | worker | Junto com as outras `VAPID_*` | Chave privada; o worker confere que é do mesmo par da pública | `src/env.ts:245`, `:276-278` |
| `VAPID_SUBJECT` | worker | Junto com as outras `VAPID_*` | `mailto:` ou `https://` de contato | `src/env.ts:246` |
| `CSP_MODO` | app | Não (vazio = CSP valendo) | `relatorio` = só `Report-Only`, para emergência | `src/env.ts:158`; `src/proxy.ts:34` e `src/app/api/csp-relatorio/route.ts:19` (leem `process.env`) |
| `EMAIL_FROM` | worker | **Sim** | Remetente (`Nome <email>` ou só o e-mail) | `src/env.ts:234`; `src/worker/index.ts:73` |
| `EMAIL_TRANSPORT` | worker | Não (padrão `resend` em produção, `mailpit` fora) | Transporte de e-mail | `src/env.ts:237`, `:256`; `src/email/transport.ts:60` |
| `RESEND_API_KEY` | worker | **Sim** com transporte `resend` | Chave do Resend | `src/env.ts:238`, `:260-262`; `src/email/transport.ts:60` |
| `MAILPIT_URL` | worker | **Sim** com `mailpit` ou `WHATSAPP_SANDBOX=1` | API do Mailpit | `src/env.ts:239`; `src/email/transport.ts:60`; `ambiente.ts:35` |
| `IA_PROVEDOR` | app, worker | Não (**ausente = IA desligada**, a seção nem aparece) | `anthropic`, `sandbox` ou `fake` (Plano 11) e `bedrock-eu` (Plano 14A, AWS na UE); `sandbox` e `fake` recusados em produção. O provedor define o **destino** gravado na autorização do paciente: trocar pede nova autorização de todos (RN-109) | `src/env.ts:84`, `:117-139` (`conferirIa`); `configIA`, `src/modules/ia/modo.ts` |
| `IA_RETENCAO_ZERO` | app, worker | Não (ausente ou `0` = nenhum uso com dado de paciente) | `1` = a retenção zero do provedor confirmada pelo dono no runbook (A-D4, D9); sem ela, configurações, pedidos de autorização e retiradas funcionam, mas a leitura de laudo fica "indisponível" | `src/env.ts:106`; `estadoIaComPaciente`, `modo.ts:95` |
| `IA_BEDROCK_REGIAO` | app, worker | **Sim** com `IA_PROVEDOR=bedrock-eu` | Região da UE do cliente do Bedrock: `eu-central-1`, `eu-west-1`, `eu-west-3`, `eu-north-1`, `eu-south-1` ou `eu-south-2` (Plano 14A) | `src/env.ts:113`, `:123` |
| `IA_DESLIGADA` | app, worker | Não | `1` = interruptor de emergência: esconde os botões e mostra "A IA está indisponível no momento. Você pode continuar sem ela." | `src/env.ts:85`; `modo.ts` |
| `IA_MODELO_LEITURA` | app, worker | Não (padrão `claude-opus-5-5`, provisório até a D12 ★) | Modelo da leitura; só `claude-opus-5-5` ou `claude-sonnet-5-5` (`MODELOS_DA_NUTRICIONISTA` desde o Plano 15: o Haiku 5.5 de `MODELOS_IA` não foi avaliado para a leitura, R13); com `bedrock-eu`, só `claude-sonnet-5-5` (`MODELOS_BEDROCK_EU`, D3) | `src/env.ts:87`, `:124-126` |
| `IA_INFERENCE_GEO` | app, worker | Não (padrão `us`) | Região de inferência da API direta; com `IA_PROVEDOR=anthropic`, **só `us` em produção** (A-D5); no `bedrock-eu` não vale (a região vem do perfil `eu.`, D5) | `src/env.ts:101`, `:138` |
| `IA_TETO_GLOBAL_MENSAL_USD` | app, worker | Não (padrão 50) | Teto mensal da plataforma inteira, em US$ (0–10000) | `src/env.ts:103` |
| `IA_MODELO_ASSISTENTE` | app, worker | Não (padrão `claude-sonnet-5-5`, A-D3) | Modelo do assistente da nutricionista — os modelos sugeridos por área (Plano 14B-1) e, desde a 14B-2, o resumo e o rascunho (gravado na tarefa no pedido); só `MODELOS_DA_NUTRICIONISTA` (sem o Haiku 5.5, Plano 15); com `bedrock-eu`, só `MODELOS_BEDROCK_EU` (`conferirIa`). O worker loga `IA Nutri` com o `modeloAssistente` e, desde o Plano 15, o `modeloPaciente` e o `nutriDesligada` | `src/env.ts:89`, `:127-129`; `configIA`, `modo.ts` |
| `IA_MODELO_PACIENTE` | app, worker | Não (sem padrão no esquema: sem ela, `claude-haiku-5-5` na Anthropic direta, no `sandbox` e no `fake`, e `claude-sonnet-5-5` no `bedrock-eu`) | Modelo da IA Nutri do paciente (Plano 15, D5); qualquer um de `MODELOS_IA`; com `bedrock-eu`, só `MODELOS_BEDROCK_EU` (o Haiku 5.5 fica fora até ser conferido). Escolhido pela avaliação RN-184 antes do merge ([§10.14.4](10-ia.md#10144-cota-por-escopo-e-custo-d3-d5-dp-7-dp-8-dp-11)) | `src/env.ts:94`, `:130-133`; `configIA`, `modo.ts:64` |
| `IA_NUTRI_DESLIGADA` | app, worker | Não | `1` = a IA Nutri do paciente desligada em todos os consultórios (RN-185): a **segunda barreira**, além da pausa de emergência no banco (`ia_nutri_pausa`, Admin › Servidor); exige redeploy. A desativação pelo paciente, a leitura das conversas e a fila continuam | `src/env.ts:96`; `ConfigIA.nutriDesligada`, `modo.ts:65` |
| `IA_TETO_RASCUNHO_USD` | app, worker | Não (padrão 1; de 0,05 a 5) | Teto por tarefa de rascunho de plano (RN-121, D5), até a avaliação definir o valor (RN-127); declarada na 14B-1 e usada desde a 14B-2 como a reserva do pedido (`pedirRascunhoIa`) e o teto do laço (`rascunho-job.ts`); um teto que não comporta a 1ª volta faz o rascunho terminar em `limite_custo` sem nada enviado. O pacote de modelos tem teto fixo de US$ 1,00 (`TETO_PACOTE_MODELOS_USD`) | `src/env.ts:98-99`; `configIA`, `modo.ts` |
| `ANTHROPIC_API_KEY` | **só worker** | Não (sem ela, cada leitura falha como `credencial_invalida` e os admins recebem e-mail, 1 por hora) | Chave do workspace **de produção** do Console; o app não a declara (RNF-103). Nenhuma outra `ANTHROPIC_*` no worker: o SDK leria `ANTHROPIC_CUSTOM_HEADERS` ([§10.9](10-ia.md#109-divergências-conhecidas)) | `src/env.ts:306`; `src/modules/ia/provedor-do-ambiente.ts` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | **só worker** | Juntas; sem elas, com `bedrock-eu`, cada leitura falha como `credencial_invalida` | Chave de acesso **de longo prazo** do usuário IAM de produção (a de acesso começa com `AKIA`); o app não as declara (Plano 14A, RNF-103) | `src/env.ts:309-310`, `:333-335`; `provedor-do-ambiente.ts` |
| `AWS_BEARER_TOKEN_BEDROCK`, `AWS_SESSION_TOKEN`, `AWS_PROFILE`, `ANTHROPIC_BEDROCK_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS` | **proibidas** no worker | — | O worker não sobe com qualquer uma delas definida: o SDK do provedor as leria sozinho (Plano 14A, D2) | `proibidaNoWorker`, `src/env.ts:311-315` |

### Container e deploy

| Variável | Onde | Obrigatória? | Para que serve |
|---|---|---|---|
| `APP_ROLE` | Serviços `nutri_app` e `nutri_worker` | Não (padrão `app`) | Modo do entrypoint: `app`, `worker` ou `admin:criar` (`docker-entrypoint.sh:3`) |
| `PORT` | Imagem | Não (padrão 3000) | Porta do `next start` (`Dockerfile:26`; `docker-entrypoint.sh:10`) |
| `NEXT_RUNTIME` | Definida pelo Next | — | `src/instrumentation.ts` só liga o Sentry no runtime `nodejs` |
| `GIT_SHA`, `DEPLOY_TIMESTAMP` | Presentes nos serviços (observado em 05/10/2026) | — | Nenhuma leitura no código |
| `GITHUB_TOKEN` | GitHub Actions | Automática | Login no GHCR no `deploy.yml` (job `publish`, hospedado). No runner próprio, os jobs do `ci.yml` só têm `contents: read` |
| `EASYPANEL_DEPLOY_HOOK_APP`, `EASYPANEL_DEPLOY_HOOK_WORKER` | Segredos do repositório no GitHub | **Sim** para o deploy | URLs de "Deploy Webhook" do Easypanel (`.github/workflows/deploy.yml:124-125`); só no `publish`, hospedado (guarda `test/runner-proprio.test.ts`) |
| `CI` | GitHub Actions (também no runner próprio) | — | Ajusta o Playwright (`playwright.config.ts`: `retries` 1, `workers` 2) e o Vitest (`vitest.config.ts`: `maxWorkers` 3), torna o `rclone` obrigatório nos testes de backup/restauração e faz `e2e/mailpit.ts` e `e2e/whatsapp.ts` lançarem erro sem `MAILPIT_URL`, `EVOLUTION_WEBHOOK_SECRET` ou `DATABASE_URL` |

### Host (backup) e testes

| Variável | Onde | Para que serve |
|---|---|---|
| `NUTRI_DATA_DIR`, `NUTRI_BACKUP_REMOTE` | `/etc/nutri-backup/backup.env` (root, 600) | Pasta de arquivos e remoto do rclone (`scripts/backup/backup.env.example`) |
| `NUTRI_DB_CONTAINER_FILTER`, `NUTRI_DB_USER`, `NUTRI_DB_NAME` | Idem, opcionais | Container e banco do `pg_dump` (padrões `nutri_db`, `postgres`, `nutri`; `nutri-backup.sh:12-22`) |
| `RCLONE_CONFIG_R2_*` (`TYPE`, `PROVIDER`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `ENDPOINT`, `NO_CHECK_BUCKET`) | Idem | Remoto R2 do rclone |
| `RCLONE_CONFIG_CRIPTO_*` (`TYPE`, `REMOTE`, `PASSWORD`, `PASSWORD2`) | Idem | Remoto `crypt` (senha e salt ofuscados; os originais ficam fora da VPS) |
| `NUTRI_BACKUP_TZ`, `NUTRI_BACKUP_TODAY`, `NUTRI_PG_DUMP_ARGS`, `NUTRI_DB_CONTAINER` | Script de backup, opcionais | Ajustes usados pelos testes (`nutri-backup.sh:14-22`, `:79`) |
| `NUTRI_RESTAURAR_IMAGEM`, `NUTRI_RESTAURAR_DIA`, `NUTRI_RESTAURAR_PERMITIR_DEFINER_SUPER` | `nutri-restauracao-teste.sh` | Teste de restauração (`docs/operacao/restauracao.md`) |
| `CARGA_TENANTS`, `CARGA_PACIENTES`, `CARGA_VENCER_EM_MIN` | `test/carga/seed.ts` | Tamanho da semente sintética da pilha de carga |
| `IA_AVALIACAO`, `IA_AVALIACAO_DIR`, `IA_AVALIACAO_MODELOS`, `IA_AVALIACAO_TETO_USD`, `IA_AVALIACAO_ESFORCO`, `IA_AVALIACAO_PROVEDOR`, `IA_AVALIACAO_TAREFA` | `.env.avaliacao` na máquina do dono (fora do git), lido por `pnpm ia:avaliar` (`scripts/ia-avaliar.ts`) | Avaliação da IA com laudos fictícios e a chave do workspace de **dev** (runbook do Plano 11, passo 4); desde o Plano 14A, `IA_AVALIACAO_PROVEDOR=bedrock-eu` com `IA_BEDROCK_REGIAO` e as chaves do usuário IAM **de dev** (runbook do Plano 14A, passo 4); desde o Plano 14B-1, `IA_AVALIACAO_TAREFA=modelos` avalia os 7 pacotes de área (o padrão, `laudos`, é a leitura; [§10.12.6](10-ia.md#10126-avaliação-dos-pacotes-rn-127-fora-do-ci)); `IA_AVALIACAO_DIR` também em `pnpm ia:laudos`. Nunca no Easypanel |
| `NUTRI_DEV_DATABASE_URL` | Ambiente do desenvolvedor, lida pelo `.mcp.json` (`:16`) | Conexão do MCP `postgres-dev`, **só banco de dev** (regra 5 do CLAUDE.md); só o nome aqui, nunca o valor |
| `DOCKER_HOST` | `test/backup.test.ts`, `test/restauracao.test.ts`; no CI, o job `test` e o `.env` do runner próprio | Docker usado pelos testes; no runner próprio, o socket rootless do CI (`/run/user/1500/docker.sock`) |
| `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE` | Job `test` do `ci.yml` | Caminho do socket que o Testcontainers monta nos contêineres auxiliares, como o Ryuk (o rootless do CI) |
| `NUTRI_CI_REDE_DIRETA` | Job `test` do `ci.yml` (`1`), lida por `test/postgres-teste.ts` | Postgres do Testcontainers pelo IP do contêiner na rede `bridge`, porta 5432, com espera só pelo healthcheck: no Docker rootless, a porta publicada só existe do lado do host. Fora do runner próprio, ausente |
| `TESTCONTAINERS_RYUK_DISABLED` | Job `test` do `ci.yml` (`true`) | Desliga o Ryuk (o contêiner de limpeza do Testcontainers); o vigia de fim do runner apaga todos os contêineres a cada job |
| `ACTIONS_RUNNER_HOOK_JOB_STARTED`, `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` | `.env` do runner próprio (`instalar-2-runner.sh`) | Vigias de início e de fim de job (`/opt/nutri-ci/hooks/inicio.sh`, `fim.sh`) |

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` e `BACKUP_PASSPHRASE` aparecem no
`.env.example`, mas **nenhum código os lê**: no backup do host eles viram as `RCLONE_CONFIG_*` acima (spec §9.6,
nota do Plano 02).

### Onde cada variável é configurada em produção

As variáveis de app e worker ficam no **Easypanel**, serviço a serviço. Em 05/10/2026 (só nomes, por
`docker service inspect`): o `nutri_app` tem `APP_ROLE`, `APP_URL`, `AUTH_SECRET`, `DATABASE_URL`,
`DATABASE_URL_MIGRATOR`, `DATA_DIR`, `ENCRYPTION_KEY`, `FILE_URL_SECRET`, `LOG_LEVEL`, `NODE_ENV`, `PORT`,
`TRUSTED_PROXIES`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` e `VAPID_PUBLIC_KEY`; o `nutri_worker` tem `APP_ROLE`,
`APP_URL`, `DATABASE_URL`, `DATA_DIR`, `EMAIL_FROM`, `ENCRYPTION_KEY`, `LOG_LEVEL`, `NODE_ENV`, `RESEND_API_KEY` e as três
`VAPID_*`. Não há ainda `SENTRY_*` nem `EVOLUTION_*` (Sentry e WhatsApp desligados; itens E-07 e E-04 do backlog).
O worker **não** recebe `DATABASE_URL_MIGRATOR`, como manda o Plano 01 (Tarefa 13). As variáveis da IA (Plano 11) entram
pelo passo 6 do runbook `docs/operacao/ia.md` (`IA_*` no app e no worker; `ANTHROPIC_API_KEY` só no worker); sem
`IA_PROVEDOR` a IA fica desligada. Com o Plano 14A, pelo passo 7 do runbook novo (seção "Plano 14A" do mesmo arquivo):
`IA_PROVEDOR=bedrock-eu`, `IA_BEDROCK_REGIAO`, `IA_MODELO_LEITURA`, `IA_RETENCAO_ZERO=1` e `IA_TETO_GLOBAL_MENSAL_USD` no
app e no worker; `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` só no worker. Com o Plano 15, pelo passo 3 do runbook da
IA Nutri (seção "Plano 15" do mesmo arquivo): `IA_MODELO_PACIENTE` no app e no worker (o modelo aprovado na avaliação
RN-184); `IA_NUTRI_DESLIGADA=1` só em emergência.

---

## 1.10 Cronologia dos planos

Cada plano entrega software em produção, com testes, e termina atualizando a spec (índice dos planos). Datas = merge
na `main` (`git log --merges`). Migrations = arquivos SQL adicionados pelo merge.

| Plano | PR (merge) | Migrations | Spec | O que introduziu na arquitetura |
|---|---|---|---|---|
| **01 Fundação** | #1 (30/09/2026) | 0000–0005 | v1.3 | Scaffold Next 16 com `src/proxy.ts`; `src/env.ts`; roles migrator/app e funções de RLS reutilizáveis; `withTenant`, `tenants`, `audit_log`; guarda de RLS no CI; Better Auth com argon2id, política de senha, sessão de 12 h/30 dias e 2FA; telas de acesso; CLI `admin:criar`; logger, worker com heartbeat e `/api/health`; Dockerfile e entrypoint; CI e deploy GHCR → Easypanel; spike do Serwist com Turbopack (P-14) |
| **02 Plataforma (M1)** | #2 (30/09/2026); ajustes no #4 (01/10, v1.5) | 0006–0015 | v1.4 | Variáveis por processo, cofre de segredos (AES-256-GCM) e IP real; fila de e-mail (Resend/Mailpit) com payload cifrado; recuperação de senha por e-mail; **auditoria por gatilho** + `auditRead`; contas de nutricionista, convite de 72 h, DPA; suspensão (RN-15); armazenamento em `/data` com cota de 5 GB e URL assinada de 5 min; métricas do admin por `SECURITY DEFINER`; marca; Turnstile; **backup no host** e monitor de backup/disco |
| **03 Pacientes & prontuário (M2)** | #3 (30/09/2026) | 0016–0037 | — | `patients` e FK composta `(tenant_id, patient_id)` em toda tabela filha; convite do paciente (7 dias) e termo; `staff_only` (notas privadas, etiquetas); fórmulas do Apêndice A; antropometria, gasto energético, anamnese com modelo, atendimentos, exames; gráficos SVG no servidor; LGPD (arquivar, bloquear, anonimizar por job); exportação ZIP + PDF **no worker** |
| **04 Plano alimentar (M3)** | #5 (01/10/2026); botão "Sair" no #6 (01/10, v1.7) | 0038–0047 | v1.6 | TACO com ids determinísticos e leitura compartilhada (`taco_leitura`); medidas IBGE; busca por trigramas com `app_unaccent`; cálculo puro compartilhado; salvamento automático por diferença com `revisao`; plano publicado imutável (nutrientes congelados); `paciente_sem_rascunho`; PDF do plano no worker (D1–D15) |
| **05 Agenda & lembretes (M4)** | #7 (03/10/2026) | 0048–0069 | v1.8 | Módulos `agenda` e `notificacoes`; fuso por `Intl`; `EXCLUDE` contra conflito; papel **`publico`** negado por padrão; página `/n/<slug>` com Turnstile e código; motor de lembretes (cron de 1 min, envio no máximo uma vez); link assinado da consulta; **WhatsApp pela Evolution API** (uma instância por tenant, webhook com JWT); cota; envio de push; presença e taxa de faltas (D1–D22) |
| **06 Portal do paciente (M5)** | #8 (03/10/2026); fechamento no #9 | 0070–0080 | v1.9 | **Escrita do paciente negada por padrão** (`paciente_sem_*`); `stored_files` por paciente; contexto **`conta`** e `withConta`; `requirePaciente` e cookie `nd_vinculo`; PWA instalável com "Meu plano" offline; inscrição de push; `access_events` (CS-02); diário com foto (HEIC no worker); "Diários" da nutricionista; evolução, lista de compras, perfil e direitos do titular; agenda no PWA; axe no portal (D1–D26) |
| **07 Biblioteca de conteúdo (M6)** | #10 (04/10/2026); débitos no #11, correção de tema no #13, fechamento no #14 | 0081–0084 | v1.10 | `contents` e tabelas filhas; **audiência na RLS** (`paciente_conteudo_visivel`, `app_conteudo_por_etiqueta`); vídeo por link com player sem cookies e capa pelo oEmbed; markdown seguro sem HTML; receitas com cálculo; receita sugerida no plano (`liberarReceitasDoPlano`); aviso de conteúdo novo; métricas "Quem viu" (D1–D21) |
| **08 Go-live** | #12 (04/10/2026); fechamento no #15 | 0085–0088 | v1.11 | Sentry (`@sentry/node`) com filtro e `request_id`; `/api/erro-cliente`; health com motivo; **CSP com nonce** e cabeçalhos; RLS final por coluna (`paciente_colunas`); limites e player sob demanda; retenção de `access_events`; métricas de sucesso; pilha de carga k6 e teste de restauração; visual V2 do painel com tema na conta (`user.tema`, `user.guia`); menu e Início em bento; **manual guiado** (`modules/ajuda`). Tarefa 8 (textos legais) pendente no E-09 (D1–D27) |
| **09 Fechamento do MVP** (P09-01 a P09-05) | #22 (06/10/2026) | 0094–0097 | — | Conferência de origem no salvamento do plano e nas rotas de escrita (`mesmaOrigem`); worker espera a versão do schema; reinício do 2FA pelo admin (`admin_actions`, `admin:reiniciar-2fa`); aviso de aparelho com outro papel; E2E estável; painel instalável (PWA) sem cópia offline de dado de saúde; formulários em POST |
| **10A Receita** (pós-MVP) | #19 (06/10/2026); plano no #18, divisão 10A/10B aprovada em 05/10/2026 | 0089–0093 | MVP v1.12; documentos v0.4 | Módulo **`documentos`** ([cap. 9](09-documentos-assinados.md)): receita de suplementos e fitoterápicos; **imutabilidade no banco** (gatilho `app_documento_imutavel`) e anonimização só pela função `app_anonimizar_documentos` (`SECURITY INVOKER`, só `worker`); primeiras FKs `NO ACTION` para `stored_files`; PDF preparado e PDF da digitalizada no worker; **2FA no momento de assinar** (`confirmarCodigo2fa`); recibo só INSERT; link de uso único sem login (`semConta`) com código de 6 dígitos; **verificação pública** `/v` fora da RLS (`document_verifications`); interruptor do admin `documentos_liberados` (D1–D24; Plano 10B, gov.br e ICP-Brasil, ainda por fazer) |
| **11 Base de IA + leitura de laudos** (pós-MVP) | #23 (07/10/2026) | 0098–0100 | MVP v1.13; IA v0.4 | Módulo **`ia`** ([cap. 10](10-ia.md)): primeiro serviço de IA, **só no worker** (`@anthropic-ai/sdk` e `pdf-lib` fora do grafo do Next); provedor trocável com `sandbox`/`fake` (o CI nunca chama a API real); **portão do envio** (RN-100 reconferida com travas antes de o laudo sair, uma vez); cota em micro-dólares com reserva e acerto (`ia_uso`) e teto da plataforma (`ia_gasto_plataforma`, sem `tenant_id`); travas do tenant em `FOR NO KEY UPDATE`; ciência do paciente e aditivo de IA em `consents`; interruptor da admin `ia_liberada` e gatilho que só deixa a admin mudar os interruptores (`0100`); tarefas sem `DELETE` fora da anonimização e com colunas fixas; `censor` do pino para `resultado`/`parametros` (D1–D22; A-D21 e A-D22 do dono em 07/10/2026) |
| **12 Paciente envia exames** (pós-MVP) | #25 (08/10/2026) | 0101–0103 | Exames e IA do paciente (spec C) v0.3 | Envio de laudos pelo app ([cap. 11](11-exames-enviados.md)): `exam_submissions`, rasterização do PDF num processo filho (PDFium em WASM), PDF limpo só com imagens, fila "Exames recebidos"; sessão da equipe por inatividade (30 min, no máximo 8 h; 0103) |
| **13 Parecer nutricional e retificação** (pós-MVP) | #27 (08/10/2026) | 0104–0105 | documentos v0.6; IA v0.4 (§5.10) | No módulo `documentos` ([§9.11](09-documentos-assinados.md#911-parecer-nutricional-e-retificação-plano-13)): segundo tipo de documento (parecer, com a cópia congelada dos exames) e **versões** — retificação com motivo, gatilho `documento_versao` no INSERT e substituição da anterior na assinatura; P09-07 (páginas e busca do `/admin`) |
| **16 App do paciente no layout G** (pós-MVP) | #28 (08/10/2026) | 0106 | app do paciente G v0.1 | Portal do paciente em **cinco seções** (Hoje, Jornada, Plano, Exames, Eu; `SECOES_DO_PORTAL`, toda página marca uma seção) com moldura de servidor e cor da faixa calculada (`corDaFaixa`); **mural de Hoje** composto na leitura, sem tabela (`muralDoPaciente` × `comporMural`, autoria visível, `auditRead` por entidade); **respostas à refeição do plano** no próprio diário (`resposta`, `refeicao_do_plano` como cópia, idempotência com o paciente travado, "Desfazer" só no aparelho); **Jornada**; "Não mostrar peso no app" filtrado no módulo (`peso_no_app` na trilha); guia do portal; fontes servidas pelo app; `/admin` em abas (T17) ([§5.5](05-agenda-portal-conteudo.md#55-portal-do-paciente-p-plano-06-layout-g-no-plano-16)) |
| **14A Autorização do paciente para IA e provedor na UE** (pós-MVP) | #29 (09/10/2026); prazo de guarda e textos 1.0 no #31 (0110) | 0107–0109; 0110 no #31 | IA v0.6 (execução); v0.6.1 com a A-D27 (#31) | No módulo `ia` ([§10.10](10-ia.md#1010-autorização-do-paciente-e-provedor-na-ue-plano-14a)): **autorização do paciente** no lugar da ciência do aviso — `ia_autorizacoes` só de inclusão (`REVOKE UPDATE, DELETE`), política RESTRICTIVE para a sessão de paciente, gatilho de INSERT com o relógio do banco e duas funções `SECURITY DEFINER` da anonimização; três canais (app, **link sem login** com tokens sem estado e termo **em papel** impresso pelo navegador com código de referência); a RN-100 reconferida em todo ponto (pedido, portão, resultado, aplicação, varredura) com a autorização da **tarefa** (D14) e o **destino** gravado no portão (`ia_tarefas.destino`, D6); job `ia-retirada`; segundo provedor, **AWS Bedrock na UE** (`@anthropic-ai/bedrock-sdk` só no worker, variáveis que o SDK leria sozinho proibidas); `IA_RETENCAO_ZERO`; a ciência do Plano 11 congelada (`0109`) (D1–D21; F1–F9 do parecer JUR-2026-013) |
| **14B-1 Modelos sugeridos pela IA** (pós-MVP) | #34 (13/10/2026) | 0111–0112 | IA v0.6.1 | No módulo `ia` ([§10.12](10-ia.md#1012-modelos-sugeridos-pela-ia-plano-14b-1)): `gerar` com ferramentas nos dois provedores (só `strict`/`auto`) e **laço só de inclusão** com limites (`laco-ferramentas.ts`, só no worker); ferramentas de busca sem escrita e no tenant da geração; `ia_geracoes_modelos` (STAFF_ONLY, um pacote por vez, gatilho `app_ia_geracoes_imutavel`); colunas de origem e aprovação em `meal_plans` e `anamnesis_templates` com o gatilho `app_modelo_ia_origem`; só modelos aprovados nas escolhas do paciente; fila **`ia-assistente`** e varredura das gerações |
| **14B-2 Resumo do histórico e rascunho de plano pela IA** (pós-MVP) | #35 (14/10/2026); a versão dos textos na confirmação do "Liberar" do admin no #36 (14/10/2026) | 0113–0114 | IA v0.7 | No módulo `ia` ([§10.13](10-ia.md#1013-ia-nutri--resumo-e-rascunho-plano-14b-2)): primeiro uso com **dado de paciente pseudonimizado** — o contrato do que sai (`campos-enviados.ts`) testado contra o texto, a máscara de texto livre (`pseudonimizar.ts`), idade no lugar do nascimento e índices locais `#n`; tipos `resumo_historico` e `rascunho_plano` em `ia_tarefas`, com o índice de um em andamento por paciente e o `carimbo_dados` do "Reaproveitar" (`0113`, `0114`); portão do paciente que monta o pedido com o paciente travado; resumo com as fontes conferidas e a abertura auditada; rascunho pelo laço com a autorização reconferida a cada volta e "Usar como rascunho" na mesma transação; selo do art. 37 no PDF e no app (`meal_plans.ia_origem_em`); autorização e aditivo **1.1** com os três usos (nova autorização de todos, RN-109); rótulos do Histórico de acessos pelo tipo (D2–D5, D8–D16, D21–D23) |
| **15 IA Nutri do paciente** (pós-MVP) | #37 (15/10/2026; vai ao ar ligada pela nutricionista, ★ DO-1 = não) | 0115–0117 | Exames e IA do paciente (spec C) v0.5; caderno com a D37 | No módulo `ia`, pasta `nutri-paciente/` ([§10.14](10-ia.md#1014-ia-nutri-do-paciente-plano-15)): a **primeira IA que responde ao paciente**, sem escrever o texto que ele lê — o modelo só classifica e aponta índices, a resposta é **montada** com os trechos relidos do banco ou é um **texto fixo**; filtro de risco determinístico antes de gravar; funções `SECURITY DEFINER` fechadas para a pergunta, o envio direto, a revogação e as métricas do admin (troca de papel, não enfileiram); contexto lido na **sessão de paciente sem conta** (`semConta`); **cota por escopo** (`paciente` × `nutri`) no mesmo teto global; consentimento próprio só de inclusão (1.0) e aditivo 1.2 com mínimo próprio; revogação que apaga o conteúdo e deixa um esqueleto até o fim do mês (D32), com a mensagem de risco guardada até 30 dias (D22); pausa de **emergência** da plataforma (`ia_nutri_pausa`, nasce não pausada) e `IA_NUTRI_DESLIGADA`; fila "Dúvidas dos pacientes" (só "Marcar como vista") com push neutro; cinco filas novas (`ia-paciente` com 2 por vez, `expirar-ia-paciente` de minuto em minuto, `ia-nutri-risco`, `ia-nutri-revogacao`, `ia-nutri-retencao`); Haiku 5.5 (`IA_MODELO_PACIENTE`) |
| **17 Lembretes de rotina** (pós-MVP) | #51 (16/11/2026, `667c952`; no ar sem interruptor no consultório) | 0118–0121 | lembretes de rotina (13/11/2026) | Módulo **`lembretes`** ([§5.3.9](05-agenda-portal-conteudo.md#539-lembretes-de-rotina-por-push-plano-17)): a nutricionista configura, por paciente, água, refeições do plano (com o pedido do diário), suplemento e lembrete livre, na seção "Lembretes no app" da aba Plano alimentar; um **motor de push à parte** de `notifications` (job `lembretes-rotina` a cada minuto, plano do dia puro com fusão por minuto e teto de 24, tolerância de 10 min, marca do slot por upsert condicional sob trava por tenant: no máximo uma vez); o envio aos dispositivos extraído para `push-dispositivos.ts`; `lembretes_rotina` (auditada) e `lembretes_rotina_envios` (`staff_only`, fora da auditoria); "a nutricionista não religa" no banco (gatilhos da `0119` e da `0120`); Eu › Lembretes no portal (desligar e pausar); configuração apagada de fato (ajuste do app, não prontuário, NORMAS-03) |
| **18 Ficha e cadastro** (pós-MVP) — PR 1, fundação | #52 (17/11/2026, `9eeacaf`) | nenhuma no PR 1 (D21; a do PR 2 não tem número prometido, D22) | ficha e cadastro (16/11/2026) | Módulo **`ficha`** ([§4.2.10](04-modulos-clinicos.md#4210-ficha-do-paciente-início-perfil-cabeçalho-e-registro-de-seções-plano-18-pr-1)): ficha com as abas **Início** (no lugar do Resumo) e **Perfil** (cadastro, "Acesso ao app" e etiquetas) e "Histórico" com o nome acessível "Histórico de acessos" (D12); cabeçalho com a última antropometria lida uma vez por requisição (`carregarCabecalho`, `cache()` do React) com **um** `auditRead`, fora da impressão (D13); **registro de seções** que os outros planos reaproveitam (`SECOES_DA_FICHA`, contrato `SecaoDaFicha` com `leitura`, `verTodos`, `href` absoluto, grupo `outros` e `podeAdicionar`; 8 seções numa transação `nutri`, só contador e rótulos genéricos, sem `auditRead`, D14); cartão Resumo; botão e diálogo **Adicionar** com destinos por âncora (`FocoNaAncora`) ou pelas Server Actions da aba Documentos (D15, D25); guia `inicio-paciente` e `prontuario` v3; helper único `criarPacientePeloFormulario` nos E2E |
| **18 Ficha e cadastro** (pós-MVP) — PR 2, cadastro, lista e "No app" | — (pronto no branch local `plano-18-pr2`, `3799409`, 17/11/2026; falta a revisão final, o rebase na `main` com as migrations geradas de novo e o OK do dono no merge) | 0124–0125 (geradas sobre a `main` do momento; mudam se outra migration entrar antes) | ficha e cadastro v0.3 | Tabela **`patient_cadastro`** (cadastro complementar da Res. CFN 594/2017, negada ao público e ao paciente sem login, auditada como `patients`, DELETE só na anonimização) com o **CPF** opcional, validado e único por consultório (pré-checagem sob trava; fora de todo log), formulário em seções no Perfil e em "Novo paciente", **nome social** (tela, impressão com o nome civil primeiro, lista, busca, máscara da IA), lista com abas, ordem, "Desde" e menu "Ações" por linha (arquivar e reativar sem sair), nota "Cadastro incompleto", **"No app do paciente"** (cartão, selo e página `/app`, contado no contexto do paciente: `no-app.ts` em `SEM_CONTA_PERMITIDOS`), `paciente.cadastro` no `dados.json`, identificação da 594 no `prontuario.pdf`, anonimização com rede; guias `pacientes` v2, `inicio-paciente` v2 e `perfil-paciente`; E2E `cadastro.spec.ts`; cenário de carga "abrir a ficha" ([§4.2.11](04-modulos-clinicos.md#4211-cadastro-complementar-lista-e-no-app-do-paciente-plano-18-pr-2)) |

Fora dos planos, mudanças de infraestrutura do CI:

| Mudança | PR (merge) | O que introduziu |
|---|---|---|
| Deploy sem repetir o CI do PR | #31 (09/10/2026) | Job `decidir` hospedado com `.github/scripts/ci-ja-passou.sh` e `run-name` `ci-pr-<n>-<base.sha>` no `ci.yml` ([§7.7](07-testes-qualidade-e-processo.md#77-pipeline-do-ci-e-deploy)) |
| **CI no runner próprio** | #33 (13/10/2026; runner instalado na VPS em 12/10/2026) | Jobs do `ci.yml` em `[self-hosted, nutri-ci]`, em contêiner do Playwright, um por vez; usuário `gh-runner` com Docker rootless, `user-1500.slice`, disco de 100 GB, filtro de saída nft e vigias de início e fim (`infra/runner/`); Testcontainers por IP direto (`test/postgres-teste.ts`); 2 workers do Playwright e 3 do Vitest no CI; orçamento da imagem com a mesma conta em qualquer Docker; `decidir` e `publish` hospedados; publicação de emergência `PUBLICAR-SEM-CI` no `deploy.yml`; guardas em `test/runner-proprio.test.ts` (`docs/operacao/runner-proprio.md`) |

Itens de desempenho do backlog do Plano 08, depois da rodada 1 da carga (21/10/2026,
[§6.6](06-worker-seguranca-operacao.md#66-teste-de-carga-k6)):

| Item | PR (merge) | O que introduziu |
|---|---|---|
| **P08-13 Tela Hoje e portal mais leves** | #42 (21/10/2026; sem migration) | `requirePaciente` uma vez por requisição (`acessoDaRequisicao`, `cache()` do React, S-7) e o consultório no join dos vínculos (`vinculosComConsultorio`, [§3.8](03-autenticacao-e-acesso.md#38-sessão-do-paciente-vínculos-nd_vinculo-e-contexto-conta)); a faixa de Hoje numa transação (`faixaDeHoje`, D2 do Plano 16) e as consultas futuras pelo índice do paciente ([§5.5.13](05-agenda-portal-conteudo.md#5513-jornada-plano-16-us-194-45)); Figtree e Bricolage sem preload no layout raiz, `precisaDoGuia` fora de `conteudo.ts` e o título do tour do portal na fonte do portal ([§5.7](05-agenda-portal-conteudo.md#57-interface-do-painel-plano-08), [§5.8](05-agenda-portal-conteudo.md#58-manual-guiado-p08-10-p08-d26-d27)) |

O processo de revisão de cada entrega (revisor por tarefa, revisão final do branch, `/code-review high` uma vez,
re-revisão do diff das correções e `/security-review`) está no índice dos planos e no `CLAUDE.md` do projeto.

---

## 1.11 Como estender com segurança (resumo)

Os capítulos seguintes detalham cada item. O mínimo para não quebrar a arquitetura:

1. **Tabela nova com `tenant_id`**: migration de RLS com `app_enable_tenant_rls` (e `app_enable_patient_rls`,
   `app_enable_audit`, `app_enable_staff_only` conforme o caso), entrada na fábrica de `test/isolamento.test.ts` e nas
   listas de `src/db/rls-guard.ts` (`CLAUDE.md` do projeto, regras 2, 8 e 9). As guardas do CI quebram se esquecer.
   Passo a passo: [§2.11](02-banco-de-dados.md#211-passo-a-passo-tabela-nova-com-tenant_id).
2. **Acesso a dado**: sempre por `withTenant` com o contexto devolvido por `requireNutri`/`requirePaciente`; nunca
   pelo admin ([§2.6.2](02-banco-de-dados.md#262-withtenant-e-withconta), [§3.7](03-autenticacao-e-acesso.md#37-guardas-por-papel)).
3. **Processamento pesado** (PDF, imagem, envio externo): job no worker, fila declarada em `src/jobs/queues.ts`;
   nunca importar o código do job a partir de `src/app` (guarda de grafo de imports; [§6.2.8](06-worker-seguranca-operacao.md#628-como-adicionar-uma-fila)).
4. **Variável nova**: declarar no esquema certo de `src/env.ts` (app, worker ou ambos), no `.env.example`, na
   tabela da §1.9 e no Easypanel; nunca ler `process.env` direto sem motivo registrado.
5. **Migration**: sempre expand/contract (app novo e antigo convivem no deploy `start-first`) e sempre com
   `DATABASE_URL_MIGRATOR` (`CLAUDE.md` do projeto, regra 7).
6. **Rota de API nova**: ela não passa pelo proxy — chamar `requireApiNutri`/`requireApiPaciente`, `mesmaOrigem` antes da
   sessão em `POST`/`PUT`/`PATCH`/`DELETE` com cookie — guarda em `src/app/api/mesma-origem-rotas.test.ts` — e `lerCorpoLimitado` em upload ([§3.13](03-autenticacao-e-acesso.md#313-proxy-e-redirecionamento-seguro)).
7. **Dado do paciente num módulo novo**: incluir a limpeza em `src/modules/pacientes/lgpd.ts` (exclusão atendida e
   anonimização) e, se couber, na exportação.
8. **Algo novo no Início da ficha** (Plano 18): uma seção no registro (`src/modules/ficha/secoes/` e uma linha no fim de
   `SECOES_DA_FICHA`), nunca uma consulta solta na página; o arquivo da seção não chama `auditRead`
   ([§4.2.10](04-modulos-clinicos.md#4210-ficha-do-paciente-início-perfil-cabeçalho-e-registro-de-seções-plano-18-pr-1)).

---

## Divergências encontradas

Conferência de 05/10/2026. Quando código e spec divergem, este capítulo descreve o código.

| # | Spec / documento | Código / produção | Impacto |
|---|---|---|---|
| 1 | Spec §9.1, linha "UI": "Tailwind CSS 4 · shadcn/ui · react-hook-form · Recharts · lucide-react" | `package.json` não tem `shadcn/ui` (nem `components.json`), `react-hook-form`, `recharts` nem `lucide-react`. Os gráficos são SVG próprio no servidor (desvio registrado no Plano 03, "Gráficos"); os componentes base são próprios (`src/components/ui/`) | Documental: a §9.1 deve listar só o que existe |
| 2 | Spec §9.2: `@sentry/cli` como dependência de dev do projeto | Não existe no `package.json`; sem source maps do navegador (Plano 08, D1) | Documental |
| 3 | Spec §9.7: "no container do app, `migrate` roda antes do `start` (o worker espera a versão do schema)" | Nenhum código faz o worker esperar a versão do schema: `src/worker/index.ts` sobe direto, e o `deploy.yml:64-65` dispara os webhooks do app e do worker em sequência imediata | **Resolvida no Plano 09 (P09-02 a).** Num deploy com migration, o worker novo pode rodar alguns segundos antes de o app terminar as migrations. Reforça a regra de migrations expand/contract |
| 4 | Spec §9.7: imagem publicada "com tag = SHA do commit"; etapas do PR em sequência (lint → tsc → Vitest → RLS → build → E2E) | `deploy.yml` publica `:<sha>` **e** `:latest`, e os serviços usam `:latest`; o CI tem jobs separados (`mudancas`, `quality`, `test`, `e2e`, `image`), que no runner próprio (desde 12/10/2026) rodam um por vez, e um job extra de orçamento da imagem (265 MB desde o Plano 12) | Rollback exige apontar o serviço para o SHA anterior no Easypanel |
| 5 | Spec §9.6 (lista de variáveis) | Faltam `TRUSTED_PROXIES` (**obrigatória em produção**, `src/env.ts:174-181`), `LOG_LEVEL`, `NODE_ENV`, `APP_ROLE` e `PORT` | Quem montar um ambiente pela spec não sobe o app em produção |
| 6 | `.env.example` lista `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `BACKUP_PASSPHRASE` | Nenhum código os lê; a spec §9.6 (nota do Plano 02) diz que ficam só no `backup.env` do host, como `RCLONE_CONFIG_*` | Pode levar alguém a cadastrá-los no Easypanel sem efeito |
| 7 | Spec §4.2: URLs `app.<dominio>/…` e "O domínio definitivo ainda não foi escolhido" | Produção em `https://nutri.wsscloud.tech` (backlog, "Resumo"; Plano 08, D8) | Documental |
| 8 | Spec RNF-03: `nutri_worker` com 512 MB | Serviço observado com 1 vCPU e 1 GiB (`docker service inspect`, 05/10/2026). A própria RNF-03 diz que os limites serão revistos depois do k6 | **Resolvida no Plano 12 (R-D5):** o limite de 1 GiB do worker foi conferido de novo em 07/10/2026 (`MemoryBytes` 1073741824) e a RNF-03 da spec do MVP registra o valor; a revisão geral dos limites depois do k6 continua pendente |
| 9 | Spec §4.1: "As rotas e a UI chamam só o módulo, nunca o banco direto" | `src/app/sair/route.ts:49` apaga a linha de `session` direto; `src/app/api/health/route.ts` lê `system_heartbeat` direto. Ambas as tabelas ficam fora da RLS. Outras páginas só passam `getDb()` para funções de módulo (`src/app/painel/actions.ts:15`, `src/app/admin/painel-infra.tsx:17`, páginas de convite) | Exceções pequenas e sem dado de tenant; manter a lista curta |
| 10 | Infraestrutura real: serviço `nutri_app` | A mensagem de erro de `EVOLUTION_WEBHOOK_URL` (`src/env.ts:194`) e o comentário do `.env.example` dão como exemplo `http://nutridebby_app:3000/…` | O exemplo não funciona copiado: o nome do serviço na rede interna é `nutri_app` |
| 11 | Spec §4 (diagrama): `nutri_evolution` na VPS | Não implantado em 05/10/2026 (`docker service ls`); o WhatsApp é opcional e o go-live pode sair sem ele (Plano 08, D16) | Estado operacional, não erro de código |
| 12 | §1.11 item 6 (e `src/lib/mesma-origem.ts:3-7`): rota de escrita com cookie chama `mesmaOrigem` | `PUT /api/painel/planos/[id]` (`src/app/api/painel/planos/[id]/route.ts:22`) só chama `requireApiNutri`; nenhum comentário ou teste explica a exceção. O que protege na prática é o cookie de sessão `SameSite=Lax`, que o navegador não envia em requisição entre sites, mais o corpo JSON lido por `lerCorpoLimitado`. Os outros handlers de escrita (`/api/p/push` POST e DELETE, uploads, `/api/erro-cliente`) conferem a origem | **Resolvida no Plano 09 (P09-01).** Defesa em profundidade a menos, sem motivo registrado. Sugestão: incluir `mesmaOrigem` no `PUT` ou registrar por que não |
| 13 | Spec §9.7 ("Build da imagem no GitHub Actions (não na VPS, para não consumir CPU e memória do CRM)") e RNF-03 ("Build da imagem fora da VPS") | Desde 12/10/2026, o CI roda na VPS, no runner próprio, inclusive o build de prova do job `image` (sem push). A imagem **publicada** continua montada no GitHub, no job `publish` (`ubuntu-latest`) | A proteção da produção e do `cursoia_crm` passa a ser a `user-1500.slice` (4 de 8 vCPU, 12 GB, sem swap, teto de IO) e o disco de 100 GB do CI ([§7.7](07-testes-qualidade-e-processo.md#77-pipeline-do-ci-e-deploy)). A spec ainda não registra o runner próprio |
