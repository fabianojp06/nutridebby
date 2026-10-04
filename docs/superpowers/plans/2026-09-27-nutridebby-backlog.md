# NutriDebby MVP — Backlog

Fonte: spec v1.9 + [índice dos planos](2026-09-27-nutridebby-00-indice.md). As tarefas dos Planos 02–08 são refinadas (divididas em passos com código) quando cada plano é escrito; os IDs aqui continuam valendo.

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
| P04-10 | Débitos do Plano 04 (PR #5, rodada 2 do `/code-review`, itens 7–9, adiados com OK do dono): exportação lendo as versões do plano em lote (hoje N+1); inserts de refeições/itens em lote no `salvarRascunho`; helper único de trava paciente → plano (hoje repetido em 4 funções) | PR #5 | P04-09 | Dev | S | ⬜ |

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
| P06-12 | Débitos do Plano 06 (PR #8: Minors do `/code-review high`, da revisão final por workflow e das re-revisões), agrupados por tema na lista abaixo | PR #8 | P06-01 | Dev | S | ⬜ |

### P06-12 — débitos do Plano 06 (por tema)

**Do `/code-review high` (PR #8):**
- `requirePaciente` sem o `cache()` do React: layout e página repetem sessão, `vinculosDaConta`, tenant e termo (~2× por requisição); `acessoDaConta` relê `tenants` já trazido no join (envolver a leitura em `cache()`, sem cachear o `redirect`).
- `app_soltar_endpoint_push` percorre todos os tenants (O(tenants)) a cada ativação e a cada abertura do portal com inscrição; localizar antes os tenants que têm o endpoint (índice `push_subscriptions_endpoint_idx`). `POST /api/p/push` sem limite por conta.
- Leitor do cabeçalho `Cookie` e prazo de 30 dias duplicados (`sessao-cookies.ts`, `paciente-session.ts`, `PATIENT_SESSION_MS`).
- `MSG_PUSH` copiado à mão no cliente (`notificacoes.tsx`): mover para um módulo de constantes sem servidor.
- Conferência de mesma origem copiada em 6 rotas (`/api/p/acesso`, `/api/p/diario`, `/api/p/push` e 3 anteriores): extrair um helper.

**Sessão e vínculos:**
- `/p/termo`: o aceite volta sempre a `/p/inicio` e perde o destino original (ex.: link da exportação).
- `/indisponivel` usa `BotaoSair`, não `SairPortal`, para paciente (não cancela o push nem apaga o plano no Safari < 17).
- "Sair" em `/p/termo`, `/p/escolher` e `/p/sem-acesso`: o `DELETE /api/p/push` volta 403 e o endpoint fica no servidor.
- `?v=` igual ao cookie fica na URL: com o cookie trocado em outra aba, recarregar ou uma Server Action volta ao consultório do link (a ação se perde); o `router.push` do login para um link com `?v=` não tem teste.
- Recusa 403 "Acesso negado" (vínculo a escolher) no diário e em "Ativar notificações" sem link para `/p/escolher`.
- Cópia offline do consultório suspenso fica até a escolha em `/p/escolher` (sem `EsquecerPlanoGuardado` lá).
- `ctxDoVinculo` monta o `TenantContext` à mão (mover para `sessao.ts`).
- `min-h-dvh` aninhado (rolagem vertical extra).

**Banco e RLS:**
- `findPacienteEscritaViolations` não confere a expressão da política (igual à guarda do `publico`).
- UPDATE liberado ao paciente em `patients` vale para qualquer coluna (gatilho que só deixe opt-in/opt-out, `user_id` nulo → conta e `updated_at`); o de `data_exports` vale para a linha inteira (a 0080 só fixa o escopo).
- `audit_log` legível pela sessão de paciente (as próprias linhas, com IP e ator da equipe); o portal não mostra (D5).
- Ficam fora da negação da D1 as tabelas fora da RLS: as sem `tenant_id` (`tenants`, `session`, `account`, `verification`, `two_factor`, `backup_runs`, `public_rate_limits`) e as com `tenant_id` listadas em `RLS_EXCEPTIONS` (`user`, `consents`, `invites`; `consents` é gravada pelo aceite do termo no portal, `src/modules/portal/termo.ts`) — limite conhecido.
- `app_soltar_endpoint_push` e `app_conta_sem_outro_vinculo` só testadas com dono superusuário: chamar as duas em `migrate-owner.test.ts`.
- Janela residual da D18: convite aceito logo depois do commit da anonimização liga o prontuário a uma conta anonimizada (travar `user` no aceite).
- `anonimizarContaSemVinculo` não apaga `verification`, não limpa `user.image` nem confere `app_role = 'paciente'`.
- `cancelarAparelho` só nos vínculos ativos (vínculo arquivado e reativado volta a receber push); `onConflictDoNothing` não renova `p256dh`/`auth`; a equipe do tenant lê endpoint e chaves de `push_subscriptions`.

**PWA e push:**
- Renovação da cópia no `activate` que falha (sem rede ou > 10 s) deixa a cópia do build antigo sem estilos até a próxima visita com rede (opção: apagar na falha).
- A cópia é gravada com o dono que a página informa, sem conferência no servidor: `renovarCopia` busca com o cookie atual e pode guardar o plano de outro vínculo da mesma conta com o dono antigo (o `conferirDono` corrige na abertura seguinte); opcional: `/p/plano` devolver o dono num cabeçalho e o service worker só gravar se bater.
- Cada renovação da cópia grava 1 "Visualizou · Plano alimentar" (D22): cosmético no histórico.
- Selo offline não aparece quando o NetworkFirst serve a cópia por demora (> 4 s) e o ping responde depois.
- Erros do service worker engolidos sem registro; `notificationclick` abre janela nova em vez de focar a aberta; falta o teste do relógio do aparelho que volta no tempo.
- `serviceWorker.ready` sem prazo no "Ativar"; troca da chave VAPID deixa a inscrição antiga como ativa (comparar `applicationServerKey`); sem `VAPID_PUBLIC_KEY` no app, o 503 vem antes de soltar o endpoint alheio.
- `TipoNotificacao`/`ROTULO_TIPO` sem `push_teste`, `comentario_diario` e `plano_novo` (sem efeito hoje).
- `avisarPlanoNovo`/`dispararEnvio` usam o `getBoss()` global (ignoram `deps.boss`); republicar várias vezes manda um aviso por publicação, sem agrupar.
- `standalone` exportado de arquivo de componente (`instalar.tsx`).

**Diário e arquivos:**
- `CotaEsgotadaError` na conversão (JPEG maior que o original, perto dos 5 GB) não é definitiva: 2 tentativas à toa.
- `MAX_PIXELS` de 40 MP recusa o HEIF de 48 MP dos iPhone 14 Pro e posteriores (decisão do dono: memória × compatibilidade); corrigir o comentário "mais que qualquer câmera".
- Erro relançado pelo job vai para o `output` do pg-boss com o caminho (ENOENT): relançar só com o código.
- Texto com NUL → 500 (não 400); limite de 2000 em UTF-16 × code points; o 408 de corpo lento usa a mensagem genérica; literal "Conta temporariamente indisponível" fora de `MSG_DIARIO`.
- Duas contas podem ocupar as 2 vagas globais de envio de foto (limite por tenant ou rate limit); `findJobs` com `data @>` sem índice; `heic-decode` não chama `dispose` em "HEIF image not found".
- Feed "Diários" com limite de 50, sem paginação nem visão por paciente (com 50+ não vistos, o comentado some).
- `abrirRegistro` grava "visto" em paciente bloqueado ou anonimizado e gera "Alterou · Diário alimentar" quando a nutricionista só leu; "visto" não muda `updated_at`.
- Registro "processando" cujo original foi apagado por fora (anonimização) fica "processando" para sempre.
- O e-mail da exclusão diz "Foram apagados agora: as fotos do diário", mas `apagarFotosDoDiario` roda depois da transação (se falhar, só a varredura do dia seguinte as apaga).
- Renomear `lerLaudos` → `lerAnexos` e o log "laudo ausente" (agora lê fotos).

**LGPD e titular:**
- `pedirExclusao` não confere `status = 'ativo'` sob a trava (corrida com o atendimento cria pedido aberto de bloqueado).
- Titular bloqueado depois de pedir os dados recebe e-mail com link que cai em `/p/sem-acesso`.
- Página do link com pendente perdido (> 30 min) diz "Volte em alguns minutos" para sempre; sem limite para "falhou" em sequência.
- "Exportações recentes" da aba Privacidade mistura titular e equipe sem rótulo; o texto de "Exportar dados" não cita as fotos do diário.
- O ZIP do titular leva % de gordura, dobras, exames e anamneses mesmo com a opção desligada no portal (LGPD art. 18, II; avaliar uma nota no texto da opção).

**Telas e textos:**
- Agenda do portal: literais que repetem `MSG_AGENDA`; "Consulta encerrada" diverge do link; mensagem de sucesso montada do formulário; ações velhas na tela depois de um erro; `?ok=remarcada` reaparece ao recarregar; `/p/inicio` faz duas consultas; "Agendar consulta" aparece com 3 futuras; `pedirRemarcacao` sem a RN-04 no servidor.
- `/n/[slug]` com 2+ vínculos: "Entrar (já sou paciente)" cai no vínculo do cookie (pode marcar com a nutricionista errada).
- Perfil: caixa do WhatsApp continua marcada depois do erro "sem telefone"; `role="status"` vazios.
- Evolução: chave React repetida nas orientações; `select()` inteiro de `anthropometry` (minimização).
- Lista de compras: `?dias` repetido cai em 7 sem erro; o campo volta a 7 junto com o alerta.
- Plano: kcal omitido no portal × "—" no PDF; estado do PDF duplicado (`planoDoPaciente`/`caminhoDoPdf`); `MSG_BLOQUEADO` também para paciente só anonimizado.

**Testes:**
- `test/backup.test.ts` instável na suíte completa; `e2e/auth.spec.ts:15` falha no banco de dev reaproveitado (precisa de seed limpo).
- Asserções fracas: foto de outro paciente sem conferir 42501 e sem o caso do paciente gravando logo; PDF "pronto"/isolamento (T4); corrida do 11º registro sem a mensagem; `audit_log` com ator paciente (D22) e 2º paciente na Evolução; lista de compras sem `audit_log`; RN-06 sem render com outro fuso; `getByText('404')`; E2E de remarcar só renderiza; contexto `conta` sem UPDATE/DELETE com 0 linhas; Server Actions do admin fora de `acoes-de-paciente.test.ts`; lista de `/api/painel` à mão; preenchimento da 0072 sem teste automatizado.
- axe não cobre `<details>` aberto, selo offline, estados de erro e o tutorial do iOS; target-size (WCAG 2.2) fora do axe; seed do E2E sem ator no `audit_log`.

## Plano 07 — Biblioteca de conteúdo (M6)

**Plano 07 escrito (decisões ★ aprovadas pelo dono em 04/10/2026):** [`2026-10-04-nutridebby-07-conteudos.md`](2026-10-04-nutridebby-07-conteudos.md) — 13 tarefas (P07-01 a P07-08, mais os débitos da mesma área: B-5, S-9, T-4, D04-1, D04-2, F-12, W-1); decisões ★ (D1, D3, D4, D6, D7, D11, D13, D14, D21) aprovadas conforme a recomendação; próximo: `/code-review high` no plano e execução.

**Notas do Plano 06:** a aba "Conteúdos" entra em `ITENS_DO_PORTAL` (`src/app/p/navegacao.ts`); `contents`, `content_views` e `content_favorites` precisam de `app_allow_paciente_escrita` para as visualizações e os favoritos (e da entrada em `PACIENTE_ESCREVE`, guarda no CI); "Sugestão de receita" no "Meu plano" (US-041, P07-05) lê `meals.recipe_content_id`; o PDF de orientação (`orientacao_pdf`, `patient_id` nulo) é invisível ao paciente pela `paciente_arquivos` e precisa entrar na política quando o portal o servir.

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
| P08-08 | Validação com a Debby (fórmulas e fluxo real) + treinamento | P-08 | E-08, Planos 03–07 | Debby + Você | M | ⬜ |
| P08-09 | Go-live: conta da Debby em produção + checklist assinado | CS-01 | P08-01 a P08-08 | Você | M | ⬜ |

## Pós-MVP — Fase 3 (Engajamento) e Fase 4 (Expansão)

Itens **confirmados pelo dono em 03/10/2026**, a **especificar com brainstorming depois do Plano 05** (espelham o painel; não entram na contagem do MVP). Todos com IA ou dado de saúde enviado a terceiros exigem, ao especificar: suboperador declarado no DPA e no aviso de privacidade (LGPD), provedor sem retenção, cota/custo por tenant, nada de conteúdo em log e auditoria.

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

**Situação em 2026-10-03** (espelha o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT): Planos 01 a 06 concluídos e em produção (https://nutri.wsscloud.tech; Plano 06 pelo PR #8, deploy em 03/10 às 21:26 UTC, 18h26 BRT, com 81 migrations; spec v1.9); próximo: Plano 07 (Biblioteca de conteúdo); 73 itens ✅, 3 🔄 (E-01, E-06, P02-11 — backup no host pendente), 23 ⬜ (P04-10, P06-12, Planos 07–08 e os itens externos E-04 revisado, E-07, E-08, E-09). Pós-MVP: 7 itens (F3-01 a F3-06, F4-01) fora da contagem.

| Grupo | Tarefas | M | S |
|---|---|---|---|
| Trilha externa | 10 | 10 | 0 |
| Plano 01 — Fundação | 15 | 15 | 0 |
| Plano 02 — Plataforma | 11 | 11 | 0 |
| Plano 03 — Pacientes & prontuário | 11 | 9 | 2 |
| Plano 04 — Plano alimentar | 10 | 7 | 3 |
| Plano 05 — Agenda & lembretes | 12 | 12 | 0 |
| Plano 06 — Portal PWA | 13 | 9 | 4 |
| Plano 07 — Conteúdo | 8 | 5 | 3 |
| Plano 08 — Go-live | 9 | 8 | 1 |
| **Total** | **99** | **86** | **13** |
