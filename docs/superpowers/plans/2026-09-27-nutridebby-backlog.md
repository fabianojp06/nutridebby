# NutriDebby MVP — Backlog

Fonte: spec v1.10 + [índice dos planos](2026-09-27-nutridebby-00-indice.md). As tarefas dos Planos 02–08 são refinadas (divididas em passos com código) quando cada plano é escrito; os IDs aqui continuam valendo.

**Legenda:** Prior. **M** = obrigatório para o go-live · **S** = desejável · Resp.: **Dev** (desenvolvimento) · **Você** · **Debby** · **Adv.** (advogado) · Status: ⬜ a fazer · 🔄 em andamento · ✅ feito

Linhas com ↳ são subtarefas (ID com sufixo a/b/c) criadas quando o plano detalhado dividiu um item; os IDs originais não mudam e o resumo conta só os itens principais.

## Trilha externa (fora do código)

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| E-01 | Criar repositório privado no GitHub e corrigir o token do MCP do GitHub | P-09 | — | Você | M | 🔄 |
| E-02 | Definir nome do produto e domínio; registro A de `app.<dominio>` → IP da VPS | P-03 | — | Você | M | ✅ |
| E-03 | Criar projeto `nutri` no Easypanel (`nutri_app`, `nutri_worker`, `nutri_db`) | §9.4 | E-02 | Você | M | ✅ |
| E-04 | ~~Verificação da Meta Business + app WhatsApp Cloud API + número + 3 templates~~ → **E-04 revisado (spec v1.8):** Evolution API no Easypanel (`nutri_evolution`, banco `evolution` no `nutri_db`), variáveis no app e no worker e conectar o número da Debby por QR — runbook no fim do Plano 05; confirmação a cada passo e snapshot no hPanel antes; depois do merge do Plano 05 e antes de pacientes reais. Conferir ali a P-17 | INT-01, P-04, P-17 | Merge do Plano 05 | Você | M | ⬜ |
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

**Situação em 2026-10-03:** os 9 itens (P04-01 a P04-09) estão **em produção** (PR #5 com merge e deploy feitos, commits `0cae87d` a `5d053a5`); P04-10 segue a fazer. Spec atualizada para a v1.6. O backup no host (P02-11) segue pendente: sem ele, nada de pacientes reais. **Para o Plano 06** (spec v1.6, P-16, antes de qualquer sessão de paciente): escrita só da equipe em `foods`, `food_measures` e `anamnesis_templates` (políticas `RESTRICTIVE`), filtro de rascunho na exportação do titular (US-046), decisão sobre a auditoria de rascunho visível ao paciente, `stored_files` restrita por paciente no download do PDF, e o aviso "Seu novo plano alimentar está disponível" (push + e-mail, adiado do P04-08) — **tudo feito no Plano 06** (PR #8, P-16 resolvida na spec v1.9).

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
| P04-10 | Débitos do Plano 04 (PR #5, rodada 2 do `/code-review`, itens 7–9, adiados com OK do dono): exportação lendo as versões do plano em lote (hoje N+1); inserts de refeições/itens em lote no `salvarRascunho`; helper único de trava paciente → plano (hoje repetido em 4 funções) — **Plano 07 (PR #10):** ✅ exportação lendo as versões em lote (D04-1, Tarefa 12) e ✅ inserts em lote no `salvarRascunho` (D04-2, Tarefa 8); falta o helper de trava (D04-3) | PR #5 | P04-09 | Dev | S | 🔄 |

## Plano 05 — Agenda & lembretes (M4)

**Situação em 2026-10-03:** as 15 tarefas do plano feitas na branch `plano-05-agenda` (PR #7), com a spec atualizada para a **v1.8**; **PR #7 mergeado e em produção desde 03/10/2026 ~08h50 BRT** (migrations 0048 a 0069; WhatsApp e push desligados até o E-04 revisado e as variáveis do VAPID; a página pública da Debby desligada até ela ligar em Configurações). Pendente do dono: E-04 revisado (Evolution no Easypanel, runbook do Plano 05). O backup no host (P02-11) segue pendente: sem ele, nada de pacientes reais.

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P05-01 | Horários de atendimento + bloqueios + gerador de horários livres | US-030, RN-03 | Plano 03 | Dev | M | ✅ |
| P05-01a | ↳ Fuso e horários livres: funções puras da agenda (`Intl`, horário de verão) — Tarefa 1 (`47bf854`) | RN-03, RN-06 | — | Dev | M | ✅ |
| P05-01b | ↳ Tabelas, regras e tela de horários e bloqueios — Tarefa 2 (`47bf854..078c569`) | US-030 | P05-01a | Dev | M | ✅ |
| P05-02 | Agenda da nutricionista (dia/semana/lista) + criar consulta + conflito (`EXCLUDE`) | US-031 | P05-01 | Dev | M | ✅ |
| P05-02a | ↳ Consultas com `EXCLUDE`, contexto `publico` negado no banco, agendar e alterar pela nutricionista — Tarefa 3 (`078c569..20d74e9`) | US-031, D9, D11 | P05-01b | Dev | M | ✅ |
| P05-02b | ↳ Telas da agenda (dia, semana, lista), nova consulta e "Alterar data e hora" — Tarefa 4 (`20d74e9..c4ac366`) | US-031 | P05-02a | Dev | M | ✅ |
| P05-03 | Agendamento pelo paciente (antecedência mínima, 60 dias, corrida pelo mesmo horário) — domínio; a tela é o P06-09 — Tarefa 6 (`85026b2..2f86144`) | US-032 | P05-02 | Dev | M | ✅ |
| P05-04 | Página pública `/n/<slug>` com Turnstile, código por e-mail e limites — Tarefa 8 (`a0431a6..16f6448`); desligada por padrão (migration 0067) | US-032, RN-16 | P05-03, P02-09 | Dev | M | ✅ |
| P05-05 | Cancelar e remarcar + página do link assinado da consulta — Tarefa 7 (`2f86144..a0431a6`) | US-033, RN-04 | P05-03 | Dev | M | ✅ |
| P05-06 | Motor de lembretes (24 h / 2 h, horário silencioso, ignoradas, reagendamento, suspensão/reativação) — Tarefa 5 (`c4ac366..85026b2`) | US-034, RN-05, RN-06, US-004 | P05-02 | Dev | M | ✅ |
| P05-07 | WhatsApp pela **Evolution API** (spec v1.8; era Cloud API): envio de texto simples, novas tentativas, fallback por e-mail | INT-01 | P05-06 | Dev | M | ✅ |
| P05-07a | ↳ Provedor (evolution/sandbox/fake), variáveis e conexão por QR code no painel — Tarefa 9 (`16f6448..613bd2e`) | INT-01, D1, D2 | P05-06 | Dev | M | ✅ |
| P05-07b | ↳ WhatsApp nos lembretes: textos (sem link), pré-condições, novas tentativas, fallback e ritmo de 8/min — Tarefa 10 (`613bd2e..cc055ec`) | INT-01, D16 | P05-07a | Dev | M | ✅ |
| P05-08 | Webhook do WhatsApp: JWT por instância, status, resposta "1"/"2", idempotência — Tarefa 12 (`bb53c48..1656bd3`); o "2" manda e-mail novo com o link (fechamento) | US-035 | P05-07 | Dev | M | ✅ |
| P05-09 | Cota de WhatsApp (80% / 100% / virada do mês) como limite de uso — Tarefa 11 (`cc055ec..bb53c48`) | US-036, RN-09 | P05-07 | Dev | M | ✅ |
| P05-10 | Envio de push (web-push, VAPID, limpeza de inscrições 404/410, texto neutro) — Tarefa 13 (`1656bd3..9a0b6db`) | INT-03 | P05-06 | Dev | M | ✅ |
| P05-11 | Convite de paciente por WhatsApp, aviso sem link (completa a US-010) — Tarefa 14 (`9a0b6db..17ab651`) | US-010 | P05-07 | Dev | M | ✅ |
| P05-12 | Registro de presença/falta + indicadores de faltas + "Iniciar atendimento" + LGPD da agenda — Tarefa 15 (`17ab651..affaf3e`) | US-037, CS-03, US-018 | P05-02 | Dev | M | ✅ |

## Plano 06 — Portal do paciente / PWA (M5)

**Situação em 2026-10-03:** as 13 tarefas do plano ([`2026-10-03-nutridebby-06-portal-paciente.md`](2026-10-03-nutridebby-06-portal-paciente.md)) feitas na branch `plano-06-portal` e **em produção**: PR #8 mesclado (`7dad611`) e reimplantado pelo Easypanel em 03/10/2026 às 21:26 UTC (18h26 BRT), com as migrations 0070 a 0080 (81 no total); spec atualizada para a **v1.9**. Pendentes do dono: `VAPID_PUBLIC_KEY` no app (Easypanel; a mesma do worker), o teste manual no celular (runbook do Plano 06, passo 5) e, antes de pacientes reais, o backup no host (P02-11). Débitos do plano: P06-12 (lista abaixo da tabela).

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P06-00 | Pré-requisitos de segurança/LGPD antes de existir sessão de paciente (revisão final do Plano 04, spec v1.6): escrita só da equipe (políticas `RESTRICTIVE`) em `foods`, `food_measures` e `anamnesis_templates`, com testes; rascunho fora da exportação do titular (US-046); decidir se a auditoria de edições do rascunho fica visível ao paciente; `stored_files` restrito por paciente (download do PDF no portal) — **entregue:** escrita do paciente negada por padrão em toda tabela com `tenant_id` (`paciente_sem_*` + `PACIENTE_ESCREVE`, migration 0070) e reforço da 0080; `stored_files.patient_id` + `paciente_arquivos` (0071/0072); exportação do titular sem rascunho (`data_exports.escopo`); auditoria do rascunho não se aplica (D5) — P-16 resolvida — Tarefas 1, 2 e 11 | D12, US-046 | Plano 04 | Dev | M | ✅ |
| P06-01 | PWA: manifest, service worker, instalação (Android + tutorial iOS), plano disponível offline — **entregue:** contexto `conta`, `requirePaciente`, escolha da nutricionista e navegação do portal (Tarefa 3); ícones, manifest sem orientação fixa, "Meu plano" offline (cópia que acompanha o build e sai quando o acesso acaba), "Instalar app" e tutorial do iPhone, selo offline e "Sair" que limpa o aparelho (Tarefa 5) | US-040 | P01-15, Plano 04 | Dev | M | ✅ |
| P06-02 | Inscrição de push + push de teste; registro de acesso diário (`access_events`) — **entregue:** inscrição por vínculo ativo, push de teste sem repetição, aviso de plano novo (US-025), `access_events` no fuso do tenant — Tarefa 6 | US-040, CS-02 | P06-01, P05-10 | Dev | M | ✅ |
| P06-03 | Tela "Meu plano" + download do PDF — Tarefa 4 | US-041 | P06-01, P04-09 | Dev | M | ✅ |
| P06-04 | Diário alimentar com foto (conversão HEIC no worker, limite de 10/dia) — **entregue:** `heic-decode` + `sharp` só no worker, 40 MP, cota pela diferença na conversão, varredura da foto presa em "processando" — Tarefa 7 | US-042, RN-07 | P06-01, P02-02 | Dev | M | ✅ |
| P06-05 | Feed de diários + comentários da nutricionista — Tarefa 8 | US-043 | P06-04 | Dev | S | ✅ |
| P06-06 | "Minha evolução" (respeitando o % de gordura oculto) — Tarefa 9 | US-044 | P06-01 | Dev | S | ✅ |
| P06-07 | Lista de compras — Tarefa 10 | US-045, RN-13 | P06-03 | Dev | S | ✅ |
| P06-08 | "Meus dados": exportar + pedir exclusão; e anonimizar nome e e-mail da conta `user` do titular anonimizado que não tiver outro vínculo ativo (desvio consciente do Plano 03, decidido pelo dono em 2026-09-30: até aqui a anonimização só solta `patients.user_id`) — **entregue:** 1 pedido de dados a cada 24 h, pedido de exclusão único com quadro "Pedidos do titular", fotos do diário apagadas, conta anonimizada sem outro vínculo (`app_conta_sem_outro_vinculo`, 0079) — Tarefa 11 | US-046, US-018 | P03-11 | Dev | M | ✅ |
| P06-09 | Agendar, cancelar e remarcar pelo PWA (interface sobre o Plano 05) — **entregue** com o teto de 3 consultas futuras da página pública (decisão do dono, 03/10/2026) — Tarefa 12 | US-032, US-033 | P05-05 | Dev | M | ✅ |
| P06-10 | Auditoria axe das telas do PWA — **entregue:** zero violação em todas as telas do portal e 360 px sem rolagem horizontal — Tarefa 13 | RNF-10 | P06-01 a P06-09 | Dev | M | ✅ |
| P06-11 | Renovar o cookie de sessão do paciente com o uso (hoje `maxAge` fixo de 30 dias desde o login; o banco já desliza em `requireUser`) — rota que reescreva o cookie (Route Handler/Server Action) quando o app do paciente existir. Adiado do Plano 01 (rodada 3, achado 2) — **entregue:** `POST /api/p/acesso` reemite o cookie (e o `nd_vinculo` com 2+ vínculos) — Tarefa 6 | RNF-06 | P06-01 | Dev | M | ✅ |
| P06-12 | Débitos do Plano 06 (PR #8: Minors do `/code-review high`, da revisão final por workflow e das re-revisões), agrupados por tema na lista abaixo — em parte resolvidos pelo PR #11 (débitos pré-go-live) e pelo Plano 07 (PR #10), marcados ✅ na lista | PR #8 | P06-01 | Dev | S | 🔄 |

### P06-12 — débitos do Plano 06 (por tema)

**Situação em 04/10/2026:** a triagem da preparação do Plano 07 deu um código a cada item (S-, B-, W-, F-, L-, T-, X-). O **PR #11** (débitos pré-go-live, mesclado em `226c3e3` e em produção desde 04/10/2026) resolveu S-1 a S-6, B-1 a B-3, F-1 a F-4, F-13, L-1 a L-3, T-1, T-6, X-1 e X-3; o **Plano 07** (PR #10) resolveu B-5, S-9, T-4, W-1/X-7 e F-12, e conferiu na spec v1.10 o B-9 (já na §4.1 desde a v1.9) e o T-9 (os textos do e-mail e da aba Privacidade da exclusão, na tabela do E5). Os itens resolvidos estão marcados ✅ abaixo; o resto continua a fazer (B-4 e B-6 ficaram fora do Plano 07: não tocam conteúdo — PR de débitos ou P08-05).

**Do `/code-review high` (PR #8):**
- `requirePaciente` sem o `cache()` do React: layout e página repetem sessão, `vinculosDaConta`, tenant e termo (~2× por requisição); `acessoDaConta` relê `tenants` já trazido no join (envolver a leitura em `cache()`, sem cachear o `redirect`).
- `app_soltar_endpoint_push` percorre todos os tenants (O(tenants)) a cada ativação e a cada abertura do portal com inscrição; localizar antes os tenants que têm o endpoint (índice `push_subscriptions_endpoint_idx`). `POST /api/p/push` sem limite por conta.
- Leitor do cabeçalho `Cookie` e prazo de 30 dias duplicados (`sessao-cookies.ts`, `paciente-session.ts`, `PATIENT_SESSION_MS`).
- `MSG_PUSH` copiado à mão no cliente (`notificacoes.tsx`): mover para um módulo de constantes sem servidor.
- ✅ Conferência de mesma origem copiada em 6 rotas (`/api/p/acesso`, `/api/p/diario`, `/api/p/push` e 3 anteriores): extrair um helper — `mesmaOrigem(req)`, `src/lib/mesma-origem.ts` (Plano 07, S-9).

**Sessão e vínculos:**
- ✅ `/p/termo`: o aceite volta sempre a `/p/inicio` e perde o destino original (ex.: link da exportação) — `?volta=` (PR #11, S-1).
- ✅ `/indisponivel` usa `BotaoSair`, não `SairPortal`, para paciente (não cancela o push nem apaga o plano no Safari < 17) (PR #11, S-3).
- ✅ "Sair" em `/p/termo`, `/p/escolher` e `/p/sem-acesso`: o `DELETE /api/p/push` volta 403 e o endpoint fica no servidor (PR #11, S-2).
- `?v=` igual ao cookie fica na URL: com o cookie trocado em outra aba, recarregar ou uma Server Action volta ao consultório do link (a ação se perde); o `router.push` do login para um link com `?v=` não tem teste.
- ✅ Recusa 403 "Acesso negado" (vínculo a escolher) no diário e em "Ativar notificações" sem link para `/p/escolher` (PR #11, S-4).
- ✅ Cópia offline do consultório suspenso fica até a escolha em `/p/escolher` (sem `EsquecerPlanoGuardado` lá) (PR #11, S-6).
- `ctxDoVinculo` monta o `TenantContext` à mão (mover para `sessao.ts`).
- ✅ `min-h-dvh` aninhado (rolagem vertical extra) (Plano 07, T-4).

**Banco e RLS:**
- ✅ `findPacienteEscritaViolations` não confere a expressão da política (igual à guarda do `publico`) (Plano 07, B-5; o reforço — sem `toLowerCase()` e conferindo `roles` — está no P07-09).
- UPDATE liberado ao paciente em `patients` vale para qualquer coluna (gatilho que só deixe opt-in/opt-out, `user_id` nulo → conta e `updated_at`); o de `data_exports` vale para a linha inteira (a 0080 só fixa o escopo).
- `audit_log` legível pela sessão de paciente (as próprias linhas, com IP e ator da equipe); o portal não mostra (D5).
- Ficam fora da negação da D1 as tabelas fora da RLS: as sem `tenant_id` (`tenants`, `session`, `account`, `verification`, `two_factor`, `backup_runs`, `public_rate_limits`) e as com `tenant_id` listadas em `RLS_EXCEPTIONS` (`user`, `consents`, `invites`; `consents` é gravada pelo aceite do termo no portal, `src/modules/portal/termo.ts`) — limite conhecido. ✅ Registrado na spec (§4.1, v1.9; conferido na v1.10, B-9).
- ✅ `app_soltar_endpoint_push` e `app_conta_sem_outro_vinculo` só testadas com dono superusuário: chamar as duas em `migrate-owner.test.ts` (PR #11, B-3).
- ✅ Janela residual da D18: convite aceito logo depois do commit da anonimização liga o prontuário a uma conta anonimizada (travar `user` no aceite) (PR #11, B-2).
- ✅ `anonimizarContaSemVinculo` não apaga `verification`, não limpa `user.image` nem confere `app_role = 'paciente'` (PR #11, B-1).
- `cancelarAparelho` só nos vínculos ativos (vínculo arquivado e reativado volta a receber push); `onConflictDoNothing` não renova `p256dh`/`auth`; a equipe do tenant lê endpoint e chaves de `push_subscriptions`.

**PWA e push:**
- Renovação da cópia no `activate` que falha (sem rede ou > 10 s) deixa a cópia do build antigo sem estilos até a próxima visita com rede (opção: apagar na falha).
- A cópia é gravada com o dono que a página informa, sem conferência no servidor: `renovarCopia` busca com o cookie atual e pode guardar o plano de outro vínculo da mesma conta com o dono antigo (o `conferirDono` corrige na abertura seguinte); opcional: `/p/plano` devolver o dono num cabeçalho e o service worker só gravar se bater.
- Cada renovação da cópia grava 1 "Visualizou · Plano alimentar" (D22): cosmético no histórico.
- Selo offline não aparece quando o NetworkFirst serve a cópia por demora (> 4 s) e o ping responde depois.
- Erros do service worker engolidos sem registro; `notificationclick` abre janela nova em vez de focar a aberta; falta o teste do relógio do aparelho que volta no tempo.
- `serviceWorker.ready` sem prazo no "Ativar"; troca da chave VAPID deixa a inscrição antiga como ativa (comparar `applicationServerKey`); sem `VAPID_PUBLIC_KEY` no app, o 503 vem antes de soltar o endpoint alheio.
- ✅ `TipoNotificacao`/`ROTULO_TIPO` sem `push_teste`, `comentario_diario` e `plano_novo` (sem efeito hoje) (Plano 07, W-1/X-7, junto do `conteudo_novo`).
- `avisarPlanoNovo`/`dispararEnvio` usam o `getBoss()` global (ignoram `deps.boss`); republicar várias vezes manda um aviso por publicação, sem agrupar.
- `standalone` exportado de arquivo de componente (`instalar.tsx`).

**Diário e arquivos:**
- ✅ `CotaEsgotadaError` na conversão (JPEG maior que o original, perto dos 5 GB) não é definitiva: 2 tentativas à toa (PR #11, F-2).
- ✅ `MAX_PIXELS` de 40 MP recusa o HEIF de 48 MP dos iPhone 14 Pro e posteriores (decisão do dono: memória × compatibilidade); corrigir o comentário "mais que qualquer câmera" (PR #11, F-3: limite mantido, comentário corrigido).
- ✅ Erro relançado pelo job vai para o `output` do pg-boss com o caminho (ENOENT): relançar só com o código (PR #11, F-1).
- Texto com NUL → 500 (não 400); limite de 2000 em UTF-16 × code points; o 408 de corpo lento usa a mensagem genérica; literal "Conta temporariamente indisponível" fora de `MSG_DIARIO` — ✅ NUL → 400 e o limite em caracteres (PR #11, F-4); ficam o 408 e o literal (F-5).
- Duas contas podem ocupar as 2 vagas globais de envio de foto (limite por tenant ou rate limit); `findJobs` com `data @>` sem índice; `heic-decode` não chama `dispose` em "HEIF image not found".
- Feed "Diários" com limite de 50, sem paginação nem visão por paciente (com 50+ não vistos, o comentado some).
- `abrirRegistro` grava "visto" em paciente bloqueado ou anonimizado e gera "Alterou · Diário alimentar" quando a nutricionista só leu; "visto" não muda `updated_at`.
- Registro "processando" cujo original foi apagado por fora (anonimização) fica "processando" para sempre.
- ✅ O e-mail da exclusão diz "Foram apagados agora: as fotos do diário", mas `apagarFotosDoDiario` roda depois da transação (se falhar, só a varredura do dia seguinte as apaga) — o e-mail sai por job próprio, depois das fotos (PR #11, F-13).
- ✅ Renomear `lerLaudos` → `lerAnexos` e o log "laudo ausente" (agora lê fotos) (Plano 07, F-12).

**LGPD e titular:**
- ✅ `pedirExclusao` não confere `status = 'ativo'` sob a trava (corrida com o atendimento cria pedido aberto de bloqueado) (PR #11, L-1).
- ✅ Titular bloqueado depois de pedir os dados recebe e-mail com link que cai em `/p/sem-acesso` (PR #11, L-2: o pedido vira "falhou", sem ZIP nem e-mail).
- ✅ Página do link com pendente perdido (> 30 min) diz "Volte em alguns minutos" para sempre; sem limite para "falhou" em sequência (PR #11, L-3).
- "Exportações recentes" da aba Privacidade mistura titular e equipe sem rótulo; o texto de "Exportar dados" não cita as fotos do diário.
- O ZIP do titular leva % de gordura, dobras, exames e anamneses mesmo com a opção desligada no portal (LGPD art. 18, II; avaliar uma nota no texto da opção).

**Telas e textos:**
- Agenda do portal: literais que repetem `MSG_AGENDA`; "Consulta encerrada" diverge do link; mensagem de sucesso montada do formulário; ações velhas na tela depois de um erro; `?ok=remarcada` reaparece ao recarregar; `/p/inicio` faz duas consultas; "Agendar consulta" aparece com 3 futuras; `pedirRemarcacao` sem a RN-04 no servidor — ✅ "Agendar consulta" com 3 futuras (PR #11, T-1); o resto fica (T-2, T-3).
- ✅ `/n/[slug]` com 2+ vínculos: "Entrar (já sou paciente)" cai no vínculo do cookie (pode marcar com a nutricionista errada) — leva `?v=` (PR #11, S-5).
- ✅ Perfil: caixa do WhatsApp continua marcada depois do erro "sem telefone"; `role="status"` vazios (PR #11, T-6).
- Evolução: chave React repetida nas orientações; `select()` inteiro de `anthropometry` (minimização).
- Lista de compras: `?dias` repetido cai em 7 sem erro; o campo volta a 7 junto com o alerta.
- Plano: kcal omitido no portal × "—" no PDF; estado do PDF duplicado (`planoDoPaciente`/`caminhoDoPdf`); `MSG_BLOQUEADO` também para paciente só anonimizado.

**Testes:**
- `test/backup.test.ts` instável na suíte completa; `e2e/auth.spec.ts:15` falha no banco de dev reaproveitado (precisa de seed limpo) — ✅ `backup.test.ts` estável (PR #11, X-1); fica o `auth.spec` (X-2).
- Asserções fracas: foto de outro paciente sem conferir 42501 e sem o caso do paciente gravando logo; PDF "pronto"/isolamento (T4); corrida do 11º registro sem a mensagem; `audit_log` com ator paciente (D22) e 2º paciente na Evolução; lista de compras sem `audit_log`; RN-06 sem render com outro fuso; `getByText('404')`; E2E de remarcar só renderiza; contexto `conta` sem UPDATE/DELETE com 0 linhas; Server Actions do admin fora de `acoes-de-paciente.test.ts`; lista de `/api/painel` à mão; preenchimento da 0072 sem teste automatizado — ✅ as ações do admin e as rotas de `/api/painel` (lidas do disco) na guarda contra paciente (PR #11, X-3); o resto fica (X-4).
- axe não cobre `<details>` aberto, selo offline, estados de erro e o tutorial do iOS; target-size (WCAG 2.2) fora do axe; seed do E2E sem ator no `audit_log`.

## Plano 07 — Biblioteca de conteúdo (M6)

**Situação em 2026-10-04:** as 13 tarefas do plano ([`2026-10-04-nutridebby-07-conteudos.md`](2026-10-04-nutridebby-07-conteudos.md)) feitas na branch `plano-07-conteudos` e **em produção**: PR #10 mesclado (`3a1c6a4`) em 04/10/2026 às 12:33 UTC (09h33 BRT) e implantado no mesmo dia, com as migrations 0081 a 0084 (85 no total); spec atualizada para a **v1.10**. Decisões ★ (D1, D3, D4, D6, D7, D11, D13, D14, D21) aprovadas pelo dono em 04/10/2026 conforme a recomendação; também do dono (04/10): o aviso de conteúdo novo só para paciente com push ativo (US-053 ao pé da letra) e a barra de abas em 7 colunas iguais com hífen (desvio 3 ratificado). Débitos de planos anteriores resolvidos aqui: B-5, S-9, T-4, W-1/X-7 e F-12 (P06-12), D04-1 e D04-2 (P04-10); B-9 e T-9 conferidos na spec. Pendentes do dono: o teste manual (runbook do Plano 07, passo 5), marcar no GitGuardian o falso positivo de `src/modules/conteudo/oembed.ts` e, antes de pacientes reais, o backup no host (P02-11). Débitos do plano: P07-09 (lista abaixo da tabela).

**Notas do Plano 06** (todas atendidas): a aba "Conteúdos" entrou em `ITENS_DO_PORTAL` (no lugar de "Compras", D3); `content_views` e `content_favorites` com `app_allow_paciente_escrita` e em `PACIENTE_ESCREVE`; "Sugestão de receita" no "Meu plano" lê `meals.recipe_content_id` (P07-05); o PDF de orientação é servido pelo caminho lido de `contents`, sem mudar a `paciente_arquivos` (D20).

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P07-01 | Modelo de conteúdo + audiência (todos / etiquetas / pacientes) avaliada na leitura — **entregue:** 6 tabelas com RLS (`contents`, `recipes`, `recipe_ingredients`, `content_audience` auditada, `content_views`, `content_favorites`) e `meals.recipe_content_id` (0081/0082); audiência no banco — `paciente_conteudo_visivel`, `app_conteudo_por_etiqueta`, exceção da receita do plano só com `liberarReceitasDoPlano` (0083) — e as guardas `CONTEUDO_POR_AUDIENCIA`/`ESCRITA_POR_AUDIENCIA` e B-5; o titular sai das audiências na exclusão/anonimização e a exportação leva os conteúdos (D15) — Tarefas 1, 2 e 12 (`1bbb37b`, `6188376`, `f48837c`, `ff67053`) | US-053, RN-12, US-018 | P03-03 | Dev | M | ✅ |
| P07-02 | Vídeo por link: validação YouTube/Vimeo, oEmbed, capa baixada, player sem cookies — **entregue:** `lerLinkDeVideo` (inclusive o Vimeo não listado), player `youtube-nocookie`/Vimeo `dnt=1`, oEmbed fora da transação com prazo total de 5 s e quatro hosts fixos, capa em JPEG sem EXIF (o pipeline da foto do diário), capa padrão em qualquer falha — Tarefas 3 e 5 (`70139e1`, `feaa6c2`) | US-050, RN-10, INT-05 | P07-01 | Dev | M | ✅ |
| P07-03 | Receita com ingredientes e cálculo por porção — **entregue:** ingredientes da tabela de alimentos (até 50), "Por porção" calculado na hora (D11), validação por campo — Tarefa 6 (`a8e94d7`) | US-051, RN-11 | P07-01, P04-03 | Dev | M | ✅ |
| P07-04 | Orientação em texto + PDF, com markdown sanitizado — **entregue:** markdown próprio como elementos React, sem HTML (D7); PDF até 10 MB por `salvarArquivo`; painel dos conteúdos (criar, editar, público, capa, PDF, publicar/despublicar, excluir) com `mesmaOrigem` (S-9) — Tarefas 4 e 5 (`0c2f871`, `fba5b53`, `feaa6c2`) | US-052 | P07-01 | Dev | S | ✅ |
| P07-05 | Anexar receita a uma refeição do plano — **entregue:** "Sugestão de receita em {refeição}" só no rascunho (D13), "Receita indisponível", cartão "Sugestão de receita:" em "Meu plano" (receita fora da audiência só por ele); antes, os inserts em lote no `salvarRascunho` (D04-2) — Tarefas 8 e 9 (`81098d2`, `ebae68b`) | US-054 | P07-03, P04-05 | Dev | S | ✅ |
| P07-06 | Aba "Conteúdos" no PWA: feed, busca, filtros, favoritos, visualizações — **entregue:** "Conteúdos" no lugar de "Compras" (D3; 7 colunas iguais com hífen), feed com "Novo", busca full-text, filtros, favoritos, visualização pelo navegador (D18), detalhe com vídeo, receita e orientação, "Baixar material (PDF)"; `min-h-dvh` (T-4); E2E "conteúdo visível só para a audiência certa" (§9.7) e axe — Tarefas 7 e 13 (`82de3a1`, `56c4574`) | US-055 | P07-01, P06-01 | Dev | M | ✅ |
| P07-07 | Push de conteúdo novo (máx. 1 a cada 24 h por paciente) — **entregue:** "Avisar pacientes", push neutro `conteudo_novo` (D4) só para paciente com push ativo (decisão do dono, 04/10/2026), no máximo 1 a cada 24 h, horário silencioso; `TipoNotificacao`/`ROTULO_TIPO` completos (W-1/X-7) — Tarefa 10 (`b3ede29`) | US-053 | P07-06, P05-10 | Dev | M | ✅ |
| P07-08 | Métricas de conteúdo — **entregue:** "{vistos} de {audiência} pacientes ({pct}%)" pela audiência atual (D14), numa consulta agrupada, e "Quem viu" — Tarefa 11 (`6e692e1`) | US-056 | P07-06 | Dev | S | ✅ |
| P07-09 | Débitos do Plano 07 (PR #10: Minors da revisão final por workflow, do `/code-review high` e das revisões por tarefa), agrupados por tema na lista abaixo | PR #10 | P07-08 | Dev | S | ⬜ |

### P07-09 — débitos do Plano 07 (por tema)

**Banco e RLS:**
- Guardas B-5/R11: `normalizarExpressao` com `toLowerCase()` iguala `'PACIENTE'` a `'paciente'`; a consulta não confere `pg_policies.roles`; a R11 confere por trechos (`NEGA OR true OR …` ainda passaria) — comparar com a expressão inteira (reforço no P08-05).
- `CONTEUDO_POR_AUDIENCIA` é manual: derivar a lista das FKs para `contents` antes de entrar tabela filha nova.
- Defesa em profundidade na 0083: `AND m.patient_id = app_current_patient()` na exceção da receita do plano (hoje a RLS de `meals` garante) e `status = 'publicado'` em `app_conteudo_por_etiqueta` (não explorável hoje) — mudar a migration exige reaplicar no banco de dev.
- Nada no banco impede `recipes` de apontar para conteúdo que não é receita (o código restringe); o `_` de `orientacao_pdf` vale como curinga no LIKE do `contents_pdf_do_tenant` (não abre nada entre tenants); sem índice em `contents.capa_path`/`pdf_path` (apagar um `stored_files` varre `contents` para o `SET NULL`).
- A paciente lê as próprias linhas de `content_audience` de conteúdo em rascunho (só uuids) e as linhas "Público de conteúdo" do `audit_log` (B-6): aceito; registrar no `/security-review` do P08-05.
- Corridas de janela mínima: despublicar ou excluir entre o SELECT e o INSERT da visualização/favorito dá 42501/23503 → 500 (o `favoritoAction` não trata); desfavoritar conteúdo que saiu da audiência devolve false e deixa a linha até a LGPD; `gravarAudiencia` lê `patients` sem trava (sugestão: `FOR SHARE`) e uma visualização pode entrar entre o `requirePaciente` e o bloqueio (a anonimização limpa as duas).

**Painel, arquivos e receitas:**
- Rotas de capa e PDF: leem o corpo inteiro (até 5/10 MB) antes do `idValido`; código duplicado entre as duas e `temNul` repetido; `trocar()` reserva o arquivo novo inteiro sem `substitui` (perto dos 5 GB, a troca é recusada mesmo por um arquivo menor); `MAX_ENVIOS` global por processo (fazer limite por conta).
- Arquivos: se o `apagarSolto` falhar depois do commit, o `stored_files` antigo fica sem ponteiro e contando na cota (mesmo padrão do logo); erro de disco relançado pode levar o caminho ao log (P08-05).
- Vídeo: salvar de novo com o mesmo link não tenta o oEmbed outra vez (a capa padrão fica); `videoDoConteudo` ignora segmentos a mais (o CHECK barra); iframe sem `sandbox` (junto da CSP do P08-05); decode de PNG de 40 MP na rota (k6 do P08-03).
- Receita: erros por posição depois de remover um ingrediente; "Por porção" calculado com porção > rendimento; "Alimento não encontrado." sem `aria-invalid`; `inputMode` decimal no campo de tempo; corrida 23503 na exclusão de "Meu alimento" usado numa receita salva ao mesmo tempo (`for('share')` em `foods`).
- Sugestão de receita e exportação: `listarReceitasPublicadas` sem LIMIT e chamada também no editor só leitura; `planosParaExportacao` reimplementa `lerPlanoNaTransacao`; custo O(refeições × itens) na exportação.
- Aviso de conteúdo novo: "Aviso enviado para 0 pacientes." sem explicar a janela de 24 h nem o push ativo; `avisar=on` aceito em conteúdo já publicado; publicado no horário silencioso e despublicado antes das 08:00 ainda gera o push neutro às 08:00 (abre um feed sem novidade; não vaza nada); e-mail e push dividem a fila por `agendada_para` (até 40 por execução): um "Avisar pacientes" para todos atrasa em minutos os lembretes do mesmo tenant — priorizar por tipo.
- Métricas: `quemViu` responde também para rascunho; `key={k}` em vez de `patientId` na lista; "(100%)" com 199 de 200 (arredondamento); custo conteúdo × pacientes e a lista com `.limit(200)` sem paginação (k6 do P08-03); `lerAudiencia` ordena sem desempate (cosmético); `and()` redundante numa consulta.

**Portal:**
- Markdown: negrito e itálico não se aninham; `<ol>` sem `start`; itálico que atravessa link; limite efetivo do destino do link; `-  item` (dois espaços) e U+00A0 viram parágrafo.
- Feed e detalhe: `?etiqueta=` fora das opções filtra, mas o select mostra "Todas"; `ml-4` solto no link "Lista de compras"; `requirePaciente` com o id cru no caminho do detalhe.
- Busca na URL (`?busca=`, D16): o termo pode citar condição de saúde e fica no histórico e nos logs de acesso do proxy — conferir o Traefik do Easypanel ou trocar por POST (P08-05).

**LGPD:**
- D15 × textos: o e-mail "Seu pedido de exclusão de dados foi atendido" e a aba Privacidade não dizem que o registro de conteúdos abertos e favoritados é apagado na hora — decidir com o dono (texto muda a spec).

**Testes:**
- Banco: `conteudo-schema.test.ts` sem orientação com vídeo, provedor sem id, PDF fora da orientação e capa/PDF de outro tenant; `aviso.test.ts` não prova a trava advisory (`pg_locks`) e não cobre a audiência "pacientes", a paciente anonimizada e o horário silencioso sem job; `tipos.test.ts` copia o CHECK de `notifications.tipo` à mão (ler `pg_constraint`).
- Domínio: `quemViu` só com "pacientes" (faltam todos, etiquetas, etiqueta tirada, bloqueado e anonimizado); isolamento entre consultórios de `trocarCapa`/`trocarPdf`/`remover*`/publicar/despublicar/excluir e da receita (a RLS e o `isolamento.test` cobrem); rota do PDF do painel sem 403/404; receita com JSON malformado e TACO com `null`; conversão do 40P01 do `salvarRascunho` sem teste dedicado (forçar o deadlock não é determinístico).
- Plano e exportação: ramo "trocada" das sugestões sem teste; caso misto do lote (item existente que vira substituição de um principal novo); cartão de `/p/plano` sem teste de unidade (o E2E cobre); caso D15 do `montarDados` sem favoritos; conta com 2 vínculos em `titular.test.ts`; renomear `arquivosDosLaudos` (o campo `laudosForaDoZip` do JSON fica).
- Peças sem banco: `capa.test` sem XMP/ICC; `PlayerVideo` só com YouTube (faltam `live`, Vimeo com `?h=` e o `allow`); teste de linearidade do markdown por fora da normalização U+2028.
- E2E: `rel`/`target` dos links do markdown (o unitário cobre); axe do detalhe do vídeo (iframe de terceiro, `disableFrame`); `auth.spec` (Turnstile) instável; acúmulo de conteúdo "todos" e de diários (> 50) no banco de dev; registrar no índice o bloco de IP 10.9.11.19–21 do E2E.

**Processo (para o dono):**
- As migrations 0081–0083 foram aplicadas no banco de dev compartilhado e linhas do dev foram apagadas ou alteradas (limite de login `10.9.%`, diários marcados como vistos) sem combinar antes — confirmar se está tudo bem.
- CI: o GitGuardian acusa "Generic Password" em `src/modules/conteudo/oembed.ts` (é a recusa de URL com usuário/senha, sem segredo nenhum) — marcar como falso positivo no painel do GitGuardian.

## Plano 08 — Go-live

**Plano 08 escrito e aprovado:** [`2026-10-04-nutridebby-08-go-live.md`](2026-10-04-nutridebby-08-go-live.md), no PR #12 (só documentação, ainda não mesclado; o arquivo entra na `main` com ele): decisões ★ aprovadas pelo dono em 04/10/2026 e `/code-review high` do plano feito, com a re-revisão das correções 10/10. A execução começa agora que o Plano 07 está em produção, no mesmo branch, refeito por rebase (migrations renumeradas se preciso). **Executado no branch em 04/10/2026 (T8 fora: textos legais, E-09); em revisão** — revisão final do branch com uma onda de correções; a seguir `/code-review high`, re-revisão e `/security-review`.

**Da revisão final do branch (para depois do go-live):** `tenant_id` na linha de log de erro e no Sentry (RNF-11/D2 prometia "quando a sessão já foi lida"; hoje a correlação é só pelo `request_id` — desvio registrado no plano).

**Notas do Plano 07:** P08-05 — a CSP global precisa de `frame-src https://www.youtube-nocookie.com https://player.vimeo.com` e de `img-src 'self'` (as capas são locais); revisar os uploads de capa e PDF, a chamada de rede do oEmbed, o `sandbox` do iframe, a busca na URL (`?busca=`) e os reforços das guardas (P07-09). P08-03 (k6) — `/p/conteudos` com 100 conteúdos e audiência por etiqueta (a função roda por linha), a busca full-text e `/painel/conteudos` (a consulta agrupada das métricas com 200 conteúdos publicados e muitos pacientes). P08-06 — o termo do paciente e o DPA citam YouTube e Vimeo (o player roda no aparelho do paciente; P-02/P-18, advogado). P08-08 — a Debby valida o cálculo das receitas (RN-11) e os textos do E6. P08-09 — o teste manual do runbook do Plano 07 (passo 5: vídeo real do YouTube e do Vimeo, push de conteúdo novo no Android e no iPhone, PDF no celular, cartão "Sugestão de receita" no plano) entra no checklist assinado.

**Notas do Plano 06:** o P08-07 lê `access_events` (CS-02: ≥ 60% dos pacientes ativos abrem o PWA 1×/semana); o k6 (P08-03) inclui `/p/plano` e `/api/p/acesso`; o teste manual do PWA no iPhone e no Android (runbook do Plano 06, passo 5) entra no checklist assinado (P08-09); o P08-06 publica o termo do advogado com versão nova, e o portal passa a pedir o novo aceite no login (D25).

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| P08-01 | Sentry com filtro de dados de saúde + Sentry MCP | RNF-11 | E-07 | Dev | M | ⬜ |
| P08-02 | Monitor externo (UptimeRobot ou Uptime Kuma) | RNF-04 | P01-10 | Você + Dev | M | ⬜ |
| P08-03 | Teste de carga k6 (15 mil pacientes, 100 usuários simultâneos) | RNF-01, RNF-02 | Planos 01–07 | Dev | M | ⬜ |
| P08-04 | Teste de restauração do backup, documentado | RNF-05 | P02-10 | Dev | M | ⬜ |
| P08-05 | Revisão de segurança (headers, CSP, uploads, rate limits, RLS) | RNF-06, RNF-07 | Planos 01–07 | Dev | M | ⬜ |
| P08-06 | Textos legais finais publicados (termo v1.0, DPA) + prazo de guarda configurado | P-01, P-02 | E-09 | Dev | M | ⬜ |
| P08-07 | Painel com as métricas de sucesso (CS-01 a CS-03) | CS-01–03 | P05-12, P06-02 | Dev | S | ⬜ |
| P08-08 | Validação com a Debby (fórmulas e fluxo real) + treinamento | P-08 | E-08, Planos 03–07, P08-10 | Debby + Você | M | ⬜ |
| P08-09 | Go-live: conta da Debby em produção + checklist assinado | CS-01 | P08-01 a P08-08 | Você | M | ⬜ |
| P08-10 | Manual guiado na tela para a nutricionista: tour de boas-vindas, tours por tela e central de ajuda `/painel/ajuda` (US-057; pedido do dono em 04/10/2026; D26) | US-057 | — | Dev | M | ⬜ |

## Pós-MVP — Fase 3 (Engajamento) e Fase 4 (Expansão)

Itens **confirmados pelo dono em 03/10/2026**, a **especificar com brainstorming depois do Plano 05** (espelham o painel; não entram na contagem do MVP). Todos com IA ou dado de saúde enviado a terceiros exigem, ao especificar: suboperador declarado no DPA e no aviso de privacidade (LGPD), provedor sem retenção, cota/custo por tenant, nada de conteúdo em log e auditoria.

**Notas do Plano 07:** Bunny Stream para vídeo próprio (P-07, Fase 2); vitrine pública de conteúdo (Fase 4); seletor de medidas caseiras na receita (D12); push de conteúdo novo com o título, se o dono quiser (D4); a barra do portal já tem 7 colunas — "Exames" e "IA Nutri" pedem um "Mais" ou tirar outra aba (D3).

**Notas do Plano 06 (F3-02, F3-04):** "Exames" e "IA Nutri" entram em `ITENS_DO_PORTAL`; qualquer escrita nova do paciente passa pela guarda `PACIENTE_ESCREVE`; o envio de exame pelo paciente reaproveita o molde da foto do diário (original guardado, conversão/checagem no worker, `stored_files.patient_id`).

| ID | Tarefa | Refs | Depende de | Resp. | Prior. | Status |
|---|---|---|---|---|---|---|
| F3-01 | Leitura automática de laudos de exame com IA: a nutricionista anexa o PDF/foto e a IA extrai os marcadores (nome, valor, unidade, data, faixa de referência) para ela conferir e confirmar antes de salvar (decisão do dono de 02/10/2026: caminho com IA, não OCR gratuito) | US-015, §10 Fase 3 | P03 (US-015), go-live | Dev | pós-MVP | ⬜ |
| F3-02 | "IA Nutri" para o paciente: conversar com um assistente sobre o próprio plano, orientações e dúvidas do dia a dia (limites: não diagnostica, não altera plano, encaminha à nutricionista; ligado/desligado por paciente; conferir regras do CFN) | Pedido do dono 02/10/2026 | P06 (portal), F3-03 | Dev | pós-MVP | ⬜ |
| F3-03 | "IA Nutri" para a nutricionista: assistente para montar planos, resumir o histórico do paciente e sugerir condutas para ela revisar (nada salvo sem a confirmação dela) | §10 Fase 3 | go-live, F3-01 | Dev | pós-MVP | ⬜ |
| F3-04 | Paciente envia exames pelo portal; a nutricionista recebe aviso e revisa (com a leitura por IA da F3-01); o exame só entra no prontuário depois de ela aceitar | US-015 | P06 (portal), P03 (exames), F3-01 | Dev | pós-MVP | ⬜ |
| F3-05 | Parecer nutricional sobre os exames, validado e assinado pela nutricionista, entregue ao paciente em PDF (definir assinatura e validade jurídica; conferir com o CFN/CRN) | Pedido do dono 02/10/2026 | F3-04, F3-01 | Dev | pós-MVP | ⬜ |
| F3-06 | Receita: prescrição de suplementos e fitoterápicos pela nutricionista, em PDF assinado, visível ao paciente (só o que o CFN permite; nunca medicamentos) | §10 Fase 3 | go-live | Dev | pós-MVP | ⬜ |
| F4-01 | Loja de produtos do ramo (suplementos, livros, e-books, consultas avulsas…) dentro do NutriDebby (modelo, pagamento pelo Asaas da Fase 2, nota fiscal e ética do CFN/CRN a definir) | §10 Fase 4 | Fase 2 (Asaas), F3-06 | Dev | pós-MVP | ⬜ |

## Resumo

**Situação em 2026-10-04** (espelha o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT): Planos 01 a 07 concluídos e em produção (https://nutri.wsscloud.tech; Plano 07 pelo PR #10, mesclado e implantado em 04/10/2026, com 85 migrations; spec v1.10); também em produção desde 04/10 o PR #11 (débitos pré-go-live de P06-12/P04-10) e o PR #13 (sem modo escuro parcial: o sistema fica claro até o tema escuro do Plano 08); Plano 08 escrito e aprovado (PR #12), executado no branch e em revisão (P08-10, o manual guiado, entrou no plano); 81 itens ✅, 5 🔄 (E-01, E-06, P02-11 — backup no host pendente —, P04-10 e P06-12, débitos em parte resolvidos), 15 ⬜ (P07-09, Plano 08 e os itens externos E-04 revisado, E-07, E-08, E-09). Pós-MVP: 7 itens (F3-01 a F3-06, F4-01) fora da contagem.

| Grupo | Tarefas | M | S |
|---|---|---|---|
| Trilha externa | 10 | 10 | 0 |
| Plano 01 — Fundação | 15 | 15 | 0 |
| Plano 02 — Plataforma | 11 | 11 | 0 |
| Plano 03 — Pacientes & prontuário | 11 | 9 | 2 |
| Plano 04 — Plano alimentar | 10 | 7 | 3 |
| Plano 05 — Agenda & lembretes | 12 | 12 | 0 |
| Plano 06 — Portal PWA | 13 | 9 | 4 |
| Plano 07 — Conteúdo | 9 | 5 | 4 |
| Plano 08 — Go-live | 10 | 9 | 1 |
| **Total** | **101** | **87** | **14** |
