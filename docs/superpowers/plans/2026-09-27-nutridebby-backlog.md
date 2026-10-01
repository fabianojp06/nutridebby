# NutriDebby MVP — Backlog

Fonte: spec v1.6 + [índice dos planos](2026-09-27-nutridebby-00-indice.md). As tarefas dos Planos 02–08 são refinadas (divididas em passos com código) quando cada plano é escrito; os IDs aqui continuam valendo.

**Legenda:** Prior. **M** = obrigatório para o go-live · **S** = desejável · Resp.: **Dev** (desenvolvimento) · **Você** · **Debby** · **Adv.** (advogado) · Status: ⬜ a fazer · 🔄 em andamento · ✅ feito

Linhas com ↳ são subtarefas (ID com sufixo a/b/c) criadas quando o plano detalhado dividiu um item; os IDs originais não mudam e o resumo conta só os itens principais.

## Trilha externa (fora do código)

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| E-01 | Criar repositório privado no GitHub e corrigir o token do MCP do GitHub | P-09 | — | Você | M | 🔄 |
| E-02 | Definir nome do produto e domínio; registro A de `app.<dominio>` → IP da VPS | P-03 | — | Você | M | ✅ |
| E-03 | Criar projeto `nutri` no Easypanel (`nutri_app`, `nutri_worker`, `nutri_db`) | §9.4 | E-02 | Você | M | ✅ |
| E-04 | Verificação da Meta Business + app WhatsApp Cloud API + número + 3 templates | INT-01, P-04 | — | Você | M | ⬜ |
| E-05 | Conta no Resend + domínio verificado (SPF, DKIM, DMARC) | INT-02 | E-02 | Você | M | ✅ |
| E-06 | Bucket privado no Cloudflare R2 + chave com escopo; chaves do Turnstile | RNF-05, INT-06 | — | Você | M | 🔄 |
| E-07 | Conta no Sentry | RNF-11 | — | Você | M | ⬜ |
| E-08 | Lista dos ~150 alimentos mais usados, taxa de faltas atual, validação das fórmulas | P-08, P-10, P-15 | — | Debby | M | ⬜ |
| E-09 | Termo do paciente, DPA e prazo de guarda do prontuário | P-01, P-02 | — | Você + Adv. | M | ⬜ |
| E-10 | VPS: 2 GB de swap + `postgresql-client-16` e `rclone` no host (com confirmação) | RNF-03 | — | Dev (após OK) | M | ✅ |

## Plano 01 — Fundação

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P01-01 | Scaffold Next.js 16 + TypeScript strict + pnpm + ESLint/Prettier + Vitest | §9.1 | — | Dev | M | ✅ |
| P01-02 | Ambiente dev: docker compose (Postgres 16 + Mailpit), env validado com Zod, `.env.example` | §9.4, §9.6 | P01-01 | Dev | M | ✅ |
| P01-03 | Banco: cliente Drizzle, bootstrap dos roles (migrator e app sem `BYPASSRLS`), extensões | RNF-07 | P01-02 | Dev | M | ✅ |
| P01-04 | Núcleo multi-tenant: `withTenant` (tenant/papel/paciente), funções SQL de RLS por tenant e por paciente, tabelas `tenants` e `audit_log` | §4.1, RNF-07 | P01-03 | Dev | M | ✅ |
| P01-05 | Testes de isolamento: catálogo (toda tabela com `tenant_id` tem RLS forçada) + acesso cruzado entre tenants e entre pacientes (Testcontainers) | US-006 | P01-04 | Dev | M | ✅ |
| P01-06 | Better Auth: e-mail/senha com argon2id, sessões (12 h equipe / 30 d paciente), rate limit de login, papéis | US-002, RNF-06 | P01-04 | Dev | M | ✅ |
| P01-07 | 2FA TOTP: ativação, códigos de recuperação, obrigatório para admin | US-003 | P01-06 | Dev | M | ✅ |
| P01-08 | Telas de login, 2FA e recuperação de senha + roteamento por perfil (`proxy.ts`) + E2E Playwright | US-002 | P01-07 | Dev | M | ✅ |
| P01-09 | CLI `pnpm admin:criar` (link de definição de senha no terminal até o e-mail do Plano 02) | US-001 | P01-06 | Dev | M | ✅ |
| P01-10 | Worker pg-boss + heartbeat + `/api/health` (banco + worker) + logs pino | RNF-04, RNF-11 | P01-03 | Dev | M | ✅ |
| P01-11 | Dockerfile standalone (comandos app/worker, migrate no start) | §9.7 | P01-10 | Dev | M | ✅ |
| P01-12 | CI (lint, tipos, Vitest, RLS, build, E2E) + CD (GHCR → webhook do Easypanel) | §9.7 | P01-11, E-01 | Dev | M | ✅ |
| P01-13 | Configurar serviços no Easypanel (limites RNF-03, volume, domínio) + primeiro deploy | RNF-03 | P01-12, E-02, E-03 | Você + Dev | M | ✅ |
| P01-14 | `CLAUDE.md` do projeto, `.mcp.json` (Postgres MCP dev, shadcn, next-devtools), desativar plugins Vercel/Supabase | §9.3 | P01-01 | Dev | M | ✅ |
| P01-15 | Spike PWA: Serwist + Turbopack no Next 16 | P-14 | P01-01 | Dev | M | ✅ |

## Plano 02 — Plataforma (M1)

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P02-01 | E-mail transacional: Resend (prod) / Mailpit (dev), React Email, fila com retry | INT-02 | P01-10, E-05 | Dev | M | ✅ |
| P02-01a | ↳ Base: env por processo (`TRUSTED_PROXIES` obrigatória em produção), cofre AES-GCM, fila pg-boss compartilhada, orçamento da imagem no CI | INT-02 | P01-10 | Dev | M | ✅ |
| P02-01b | ↳ E-mail: modelos React (`react-dom/server`), transportes Resend/Mailpit, job cifrado com 3 novas tentativas | INT-02 | P02-01a | Dev | M | ✅ |
| P02-01c | ↳ "Esqueci minha senha" envia o e-mail; tokens do Better Auth em hash; E2E com Mailpit | INT-02, US-002 | P02-01b | Dev | M | ✅ |
| P02-02 | Armazenamento `/data`: upload validado por magic bytes, URL assinada 5 min, contador e cota de 5 GB | RNF-06, RN-18, RNF-13 | P01-04 | Dev | M | ✅ |
| P02-03 | Admin: criar conta de nutricionista + convite de 72 h + reenviar | US-001 | P02-01 | Dev | M | ✅ |
| P02-04 | Primeiro acesso da nutricionista + aceite do DPA | US-002, RNF-08 | P02-03 | Dev | M | ✅ |
| P02-05 | Admin: suspender/reativar conta + tela "Conta temporariamente indisponível" | US-004, RN-15 | P02-03 | Dev | M | ✅ |
| P02-06 | Admin: métricas agregadas (função `SECURITY DEFINER`) + ajuste da cota de WhatsApp | §3, §4.1 | P02-03 | Dev | M | ✅ |
| P02-07 | Perfil e marca: logo, cor (contraste), CRN, endereço, link online padrão, antecedências, agendamento público on/off | US-005 | P02-02 | Dev | M | ✅ |
| P02-08 | Auditoria automática de leitura/alteração de dado de saúde + aba "Histórico de acessos" | US-007 | P01-04 | Dev | M | ✅ |
| P02-09 | Validação do Turnstile no servidor | INT-06 | E-06 | Dev | M | ✅ |
| P02-10 | Backup diário (`pg_dump` + rclone crypt → R2, sync de `/data`, retenção) + alerta de disco em 70% — **no host (systemd)**, desvio do Plano 02 | RNF-05, RNF-13 | E-06, E-10 | Dev | M | ✅ |
| P02-10a | ↳ Script do host (`pg_dump` no container `nutri_db`, rclone crypt, 7+4, `/data` com histórico de 30 dias) testado no CI | RNF-05 | P01-04 | Dev | M | ✅ |
| P02-10b | ↳ Worker confere o backup do dia e o disco (70%) e alerta o admin por e-mail; painel na administração | RNF-05, RNF-13 | P02-10a, P02-01b | Dev | M | ✅ |
| P02-11 | Ativação em produção com o dono (runbook): Resend/DNS, Turnstile, R2, `/data`, variáveis, swap/rclone no host, primeiro backup + restauração de conferência | RNF-05, INT-02, INT-06 | P02-01 a P02-10, E-05, E-06, E-10, P01-13 | Você + Dev | M | 🔄 |

## Plano 03 — Pacientes & prontuário (M2)

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P03-01 | Cadastro de paciente (validações, ≥ 18 anos) + convite por e-mail + autorização de WhatsApp registrada | US-010, RN-17 | Plano 02 | Dev | M | ✅ |
| P03-02 | Aceite do convite: senha, termo versionado, opt-in/opt-out de WhatsApp, escolha de nutricionista (mais de um vínculo) | US-011 | P03-01 | Dev | M | ✅ |
| P03-03 | Etiquetas de paciente + filtro | US-019 | P03-01 | Dev | S | ✅ |
| P03-04 | Modelos de anamnese (editor, 7 tipos de pergunta, modelo padrão) + preenchimento com snapshot | US-012 | P03-01 | Dev | M | ✅ |
| P03-05 | Biblioteca de fórmulas (IMC, JP3/JP7, Siri, Harris-Benedict, Mifflin, FAO/OMS) com os casos do Apêndice A | Apêndice A, RN-14 | — | Dev | M | ✅ |
| P03-06 | Antropometria: registro, validações, % de gordura | US-013 | P03-05 | Dev | M | ✅ |
| P03-07 | Gasto energético: comparar fórmulas, fator de atividade, usar como meta | US-014 | P03-05 | Dev | M | ✅ |
| P03-08 | Exames: upload, valores e gráfico | US-015 | P02-02 | Dev | S | ✅ |
| P03-09 | Registro de atendimento (notas privadas × orientações ao paciente) | US-016 | P03-01 | Dev | M | ✅ |
| P03-10 | Evolução: gráficos e diferenças entre avaliações | US-017 | P03-06 | Dev | M | ✅ |
| P03-11 | LGPD: arquivar, exportar ZIP, bloquear (pedido de exclusão), job de anonimização após o prazo | US-018, RNF-08 | P03-01 | Dev | M | ✅ |

## Plano 04 — Plano alimentar (M3)

**Situação em 2026-10-01:** os 9 itens estão feitos na branch `plano-04-plano-alimentar` (commits `0cae87d` a `5d053a5`, em cima de `e154466`). **Merge e deploy pendentes:** faltam as revisões do PR (`/code-review high` duas rodadas e `/security-review`) e o OK explícito do dono (merge = deploy; snapshot no hPanel antes). Spec atualizada para a v1.6. O backup no host (P02-11) segue pendente: sem ele, nada de pacientes reais. **Para o Plano 06** (spec v1.6, P-16, antes de qualquer sessão de paciente): escrita só da equipe em `foods`, `food_measures` e `anamnesis_templates` (políticas `RESTRICTIVE`), filtro de rascunho na exportação do titular (US-046), decisão sobre a auditoria de rascunho visível ao paciente, `stored_files` restrita por paciente no download do PDF, e o aviso "Seu novo plano alimentar está disponível" (push + e-mail, adiado do P04-08).

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P04-01 | Seed TACO 4ª ed. (tratamento de "Tr" e "NA") + índice de busca sem acento — **entregue:** seed gerado da planilha oficial da NEPA (`Tr` → 0; `NA`, `*` e vazio → NULL), `app_unaccent` + índice GIN, RLS de `foods` com `taco_leitura` (`0cae87d`) | INT-04 | Plano 03 | Dev | M | ✅ |
| P04-02 | Seed de medidas caseiras IBGE para os 150 alimentos + `food_measures` — **entregue com 28 alimentos / 44 medidas** conferidos na tabela do IBGE (desvio da spec v1.6); os demais até 150 aguardam a lista da Debby (E-08) e entram só editando `seeds/medidas-ibge.csv`; medida própria não repete o nome de uma medida do IBGE do mesmo alimento (`0ce29ca`, `a9a91a8`) | P-10 | P04-01, E-08 | Dev | M | ✅ |
| P04-03 | Busca de alimentos em ≤ 300 ms, com selo TACO / Meu alimento — **entregue:** busca sem acento (p95 de 22 ms com 3000 alimentos), selo, API e tela Alimentos (`4dbc8ba`) | US-020 | P04-01 | Dev | M | ✅ |
| P04-04 | Alimentos próprios + "Duplicar como meu alimento" — **entregue:** "Cadastrar meu alimento", edição, exclusão (bloqueada se estiver num plano), duplicação e cadastro de medida caseira (`1f375b4`, `ff3bdf9`) | US-021 | P04-03 | Dev | S | ✅ |
| P04-05 | Editor de plano: refeições, itens, cálculo no cliente, indicador de meta, macros, salvamento automático — **entregue:** cálculo RN-02 puro, tabelas com RLS por paciente e sem rascunho para paciente, salvamento por diferença com trava de revisão, meta do gasto energético, aviso offline e confirmação ao sair com edição pendente (`fcfcf7e`, `acc9b2a`, `5d9d0c9`, `bf6e973`; correções da revisão final `862b861`, `dec0f46`, `5d053a5`) | US-022, RN-02 | P04-03 | Dev | M | ✅ |
| P04-06 | Substituições — **entregue:** ligadas ao item principal por `substitui_item_id`, fora do total, com a diferença de kcal; mover o principal leva as substituições junto (`3b8eebe`) | US-023 | P04-05 | Dev | M | ✅ |
| P04-07 | Modelos de plano — **entregue:** "Salvar como modelo", "Criar modelo", "Criar a partir de modelo" e "Excluir modelo"; a nota de privacidade do texto livre está na spec v1.6 (RNF-08) (`dfc5e49`, `632be77`) | US-024 | P04-05 | Dev | S | ✅ |
| P04-08 | Publicação e versionamento (índice único parcial) + aviso ao paciente — **entregue sem o aviso:** 1 plano publicado e 1 rascunho por paciente, nutrientes congelados na publicação, "Editar" cria a versão seguinte; o push/e-mail ao paciente foi adiado para o Plano 06 (desvio da spec v1.6) (`652b0c0`) | US-025, RN-01 | P04-05 | Dev | M | ✅ |
| P04-09 | PDF gerado pelo worker na publicação — **entregue:** PDF com a marca gerado pelo worker, "Baixar PDF" no painel, "Gerar o PDF de novo", varredura de PDF pendente há mais de 1 h e limpeza de `.tmp` órfãos (`c2384b2`, `2c5423f`; correções da revisão final `57c6d2c`, `b966dba`, `c9b8826`) | US-026 | P04-08 | Dev | M | ✅ |
| P04-10 | Débitos do Plano 04 (PR #5, rodada 2 do `/code-review`, itens 7–9, adiados com OK do dono): exportação lendo as versões do plano em lote (hoje N+1); inserts de refeições/itens em lote no `salvarRascunho`; helper único de trava paciente → plano (hoje repetido em 4 funções) | PR #5 | P04-09 | Dev | S | ⬜ |

## Plano 05 — Agenda & lembretes (M4)

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P05-01 | Horários de atendimento + bloqueios + gerador de horários livres | US-030, RN-03 | Plano 03 | Dev | M | ⬜ |
| P05-02 | Agenda da nutricionista (dia/semana/lista) + criar consulta + conflito (`EXCLUDE`) | US-031 | P05-01 | Dev | M | ⬜ |
| P05-03 | Agendamento pelo paciente (antecedência mínima, 60 dias, corrida pelo mesmo horário) | US-032 | P05-02 | Dev | M | ⬜ |
| P05-04 | Página pública `/n/<slug>` com Turnstile, código por e-mail e limites | US-032, RN-16 | P05-03, P02-09 | Dev | M | ⬜ |
| P05-05 | Cancelar e remarcar | US-033, RN-04 | P05-03 | Dev | M | ⬜ |
| P05-06 | Motor de lembretes (24 h / 2 h, horário silencioso, ignoradas, reagendamento) | US-034, RN-05, RN-06 | P05-02 | Dev | M | ⬜ |
| P05-07 | WhatsApp Cloud API: envio de templates, novas tentativas, fallback por e-mail | INT-01 | P05-06, E-04 | Dev | M | ⬜ |
| P05-08 | Webhook do WhatsApp: assinatura, status, botões Confirmo/Remarcar, idempotência | US-035 | P05-07 | Dev | M | ⬜ |
| P05-09 | Cota de WhatsApp (80% / 100% / virada do mês) | US-036, RN-09 | P05-07 | Dev | M | ⬜ |
| P05-10 | Envio de push (web-push, VAPID, limpeza de inscrições 404/410) | INT-03 | P05-06 | Dev | M | ⬜ |
| P05-11 | Convite de paciente por WhatsApp (completa a US-010) | US-010 | P05-07 | Dev | M | ⬜ |
| P05-12 | Registro de presença/falta + indicadores de faltas | US-037, CS-03 | P05-02 | Dev | M | ⬜ |

## Plano 06 — Portal do paciente / PWA (M5)

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P06-00 | Pré-requisitos de segurança/LGPD antes de existir sessão de paciente (revisão final do Plano 04, spec v1.6): escrita só da equipe (políticas `RESTRICTIVE`) em `foods`, `food_measures` e `anamnesis_templates`, com testes; rascunho fora da exportação do titular (US-046); decidir se a auditoria de edições do rascunho fica visível ao paciente; `stored_files` restrito por paciente (download do PDF no portal) | D12, US-046 | Plano 04 | Dev | M | ⬜ |
| P06-01 | PWA: manifest, service worker, instalação (Android + tutorial iOS), plano disponível offline | US-040 | P01-15, Plano 04 | Dev | M | ⬜ |
| P06-02 | Inscrição de push + push de teste; registro de acesso diário (`access_events`) | US-040, CS-02 | P06-01, P05-10 | Dev | M | ⬜ |
| P06-03 | Tela "Meu plano" + download do PDF | US-041 | P06-01, P04-09 | Dev | M | ⬜ |
| P06-04 | Diário alimentar com foto (conversão HEIC no worker, limite de 10/dia) | US-042, RN-07 | P06-01, P02-02 | Dev | M | ⬜ |
| P06-05 | Feed de diários + comentários da nutricionista | US-043 | P06-04 | Dev | S | ⬜ |
| P06-06 | "Minha evolução" (respeitando o % de gordura oculto) | US-044 | P06-01 | Dev | S | ⬜ |
| P06-07 | Lista de compras | US-045, RN-13 | P06-03 | Dev | S | ⬜ |
| P06-08 | "Meus dados": exportar + pedir exclusão; e anonimizar nome e e-mail da conta `user` do titular anonimizado que não tiver outro vínculo ativo (desvio consciente do Plano 03, decidido pelo dono em 2026-09-30: até aqui a anonimização só solta `patients.user_id`) | US-046, US-018 | P03-11 | Dev | M | ⬜ |
| P06-09 | Agendar, cancelar e remarcar pelo PWA (interface sobre o Plano 05) | US-032, US-033 | P05-05 | Dev | M | ⬜ |
| P06-10 | Auditoria axe das telas do PWA | RNF-10 | P06-01 a P06-09 | Dev | M | ⬜ |
| P06-11 | Renovar o cookie de sessão do paciente com o uso (hoje `maxAge` fixo de 30 dias desde o login; o banco já desliza em `requireUser`) — rota que reescreva o cookie (Route Handler/Server Action) quando o app do paciente existir. Adiado do Plano 01 (rodada 3, achado 2) | RNF-06 | P06-01 | Dev | M | ⬜ |

## Plano 07 — Biblioteca de conteúdo (M6)

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P07-01 | Modelo de conteúdo + audiência (todos / etiquetas / pacientes) avaliada na leitura | US-053, RN-12 | P03-03 | Dev | M | ⬜ |
| P07-02 | Vídeo por link: validação YouTube/Vimeo, oEmbed, capa baixada, player sem cookies | US-050, RN-10, INT-05 | P07-01 | Dev | M | ⬜ |
| P07-03 | Receita com ingredientes e cálculo por porção | US-051, RN-11 | P07-01, P04-03 | Dev | M | ⬜ |
| P07-04 | Orientação em texto + PDF, com markdown sanitizado | US-052 | P07-01 | Dev | S | ⬜ |
| P07-05 | Anexar receita a uma refeição do plano | US-054 | P07-03, P04-05 | Dev | S | ⬜ |
| P07-06 | Aba "Conteúdos" no PWA: feed, busca, filtros, favoritos, visualizações | US-055 | P07-01, P06-01 | Dev | M | ⬜ |
| P07-07 | Push de conteúdo novo (máx. 1 a cada 24 h por paciente) | US-053 | P07-06, P05-10 | Dev | M | ⬜ |
| P07-08 | Métricas de conteúdo | US-056 | P07-06 | Dev | S | ⬜ |

## Plano 08 — Go-live

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P08-01 | Sentry com filtro de dados de saúde + Sentry MCP | RNF-11 | E-07 | Dev | M | ⬜ |
| P08-02 | Monitor externo (UptimeRobot ou Uptime Kuma) | RNF-04 | P01-10 | Você + Dev | M | ⬜ |
| P08-03 | Teste de carga k6 (15 mil pacientes, 100 usuários simultâneos) | RNF-01, RNF-02 | Planos 01–07 | Dev | M | ⬜ |
| P08-04 | Teste de restauração do backup, documentado | RNF-05 | P02-10 | Dev | M | ⬜ |
| P08-05 | Revisão de segurança (headers, CSP, uploads, rate limits, RLS) | RNF-06, RNF-07 | Planos 01–07 | Dev | M | ⬜ |
| P08-06 | Textos legais finais publicados (termo v1.0, DPA) + prazo de guarda configurado | P-01, P-02 | E-09 | Dev | M | ⬜ |
| P08-07 | Painel com as métricas de sucesso (CS-01 a CS-03) | CS-01–03 | P05-12, P06-02 | Dev | S | ⬜ |
| P08-08 | Validação com a Debby (fórmulas e fluxo real) + treinamento | P-08 | E-08, Planos 03–07 | Debby + Você | M | ⬜ |
| P08-09 | Go-live: conta da Debby em produção + checklist assinado | CS-01 | P08-01 a P08-08 | Você | M | ⬜ |

## Resumo

**Situação em 2026-10-01** (espelha o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT): Planos 01, 02 e 03 concluídos e em produção (https://nutri.wsscloud.tech); Plano 04 feito na branch `plano-04-plano-alimentar` (PR #5), com merge e deploy pendentes das revisões do PR e do OK do dono; 54 itens ✅, 3 🔄 (E-01, E-06, P02-11 — backup no host pendente), 46 ⬜ (P04-10, P06-00, Planos 05–08 e itens externos E-04, E-07, E-08, E-09).

| Grupo | Tarefas | M | S |
|---|---|---|---|
| Trilha externa | 10 | 10 | 0 |
| Plano 01 — Fundação | 15 | 15 | 0 |
| Plano 02 — Plataforma | 11 | 11 | 0 |
| Plano 03 — Pacientes & prontuário | 11 | 9 | 2 |
| Plano 04 — Plano alimentar | 10 | 7 | 3 |
| Plano 05 — Agenda & lembretes | 12 | 12 | 0 |
| Plano 06 — Portal PWA | 12 | 9 | 3 |
| Plano 07 — Conteúdo | 8 | 5 | 3 |
| Plano 08 — Go-live | 9 | 8 | 1 |
| **Total** | **98** | **86** | **12** |
