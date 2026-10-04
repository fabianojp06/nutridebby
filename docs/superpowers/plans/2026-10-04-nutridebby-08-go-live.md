# Plano 08 — Go-live: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **DECISÕES ★ APROVADAS pelo dono em 04/10/2026 (todas conforme a recomendação do plano); plano aguardando `/code-review high` e a execução.** Escrito em 04/10/2026 a partir de `origin/main` @ `359e1bb` (Planos 01–06 em produção, spec v1.9), com o PR #11 (`debitos-pre-golive`) e o PR #10 (`plano-07-conteudos`, plano do Plano 07, migrations 0081–0084) ainda sem merge. As decisões marcadas com ★ eram do dono e foram **aprovadas em 04/10/2026, todas conforme a recomendação**; a tabela segue dizendo o custo e a consequência de cada alternativa, para o caso de reabrir alguma. **Pré-requisito da execução:** o PR #11 e o Plano 07 (executado e revisado) mergeados na `main`; este branch é refeito por rebase e as migrations são renumeradas se preciso. Nenhuma linha de código deste plano foi escrita; nada foi rodado no banco (nem no de dev); nada foi tocado em produção.

**Goal:** Deixar o NutriDebby pronto para a Debby usar com pacientes reais: erros no Sentry sem dado de saúde, monitor externo, teste de carga e de restauração documentados, cabeçalhos de segurança e CSP valendo, RLS e limites revistos, textos legais definitivos, métricas de sucesso (CS-01 a CS-03), o visual novo do painel (Versão 2 "bento", claro e escuro, com botão de alternar e preferência por usuária) em todas as telas da nutricionista, o manual guiado (P08-10) e o go-live com o checklist assinado (P08-09).

**Architecture:** Quatro frentes que se encontram no checklist. (1) **Operação e observabilidade:** um filtro único (`src/lib/sentry-filtro.ts`) por onde passa todo evento do Sentry (app pelo `instrumentation.ts`, worker pelo `semDetalhe` do PR #11, erros do navegador por uma rota própria que só leva `digest`, nome e rota), `request_id` gerado no `src/proxy.ts` (páginas e ações; nas APIs, que ficam fora do `matcher`, no `onRequestError`), `/api/health` com o motivo certo, k6 numa pilha de carga separada e um script de restauração testado no CI. (2) **Segurança e LGPD:** cabeçalhos globais no `next.config.ts`, CSP com nonce no `proxy.ts` (todas as páginas passam a ser dinâmicas), uma migration que fecha as colunas que o paciente pode alterar (B-4), tira dele a leitura do `audit_log` (B-6) e restringe as capas à audiência; `access_events` entra na exclusão e ganha retenção; os textos do advogado entram com versão nova (novo aceite pela D25 do Plano 06). (3) **Medição:** métricas CS-01..CS-03 numa função de módulo para a nutricionista e numa função `SECURITY DEFINER` só com contagens para o admin. (4) **Visual e manual:** tokens de cor por bloco de modo (sem `light-dark()`, que o Safari 16.4–17.4 não tem) e `data-tema` (sem `dark:` espalhado), um `src/app/painel/layout.tsx` que desenha o cabeçalho novo para todas as telas, preferência de tema e progresso do manual em colunas da própria `user`, componentes base (`Cartao`, `Botao`, `Aviso`, `Selo`), o Início em bento, axe do painel nos dois modos e o manual guiado com `<dialog>` nativo (tour de boas-vindas, tours por tela e a central `/painel/ajuda`).

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 (App Router, `src/proxy.ts`, `instrumentation.ts`, `connection()`) · React 19.2 · Tailwind 4 (`@theme`, `@custom-variant`) · PostgreSQL 16 · Drizzle 0.45 · Better Auth 1.7 (`additionalFields`) · pg-boss 12.34 · Zod 4 · Vitest 5 + Testcontainers · Playwright 1.63 + `@axe-core/playwright` 4.13.0. **Uma dependência nova:** `@sentry/node` (versão exata fixada na Tarefa 2). Ferramentas sem dependência no `package.json`: k6 pela imagem `grafana/k6` (Docker) e Lighthouse CLI por `pnpm dlx`. Fontes Figtree e Bricolage Grotesque por `next/font/google` (baixadas no build, servidas pelo próprio app).

**Spec:** [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.9: §1.1 CS-01 a CS-03, §5 RNF-01 a RNF-13, §9 operação e deploy, §11 P-01, P-02, P-05, P-06, P-08, P-12, P-15, P-17, P-18) e [`../specs/2026-09-27-nutridebby-mvp-historias.md`](../specs/2026-09-27-nutridebby-mvp-historias.md) (US-001, US-002, US-005, US-011, US-018, US-037, US-046; DoD de todas as histórias). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P08-01 a P08-09; **P08-10 "Manual guiado" existe só no painel do backlog** — https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT, pedido do dono em 04/10/2026, fora da spec v1.9). Pesquisas de preparação: `.superpowers/sdd/2026-10-04-nutridebby-08-preparacao/` (backlog, spec, visual, operação). Modelo de formato: Planos 06 e 07.

## Global Constraints

- Tudo dos Planos 01–07 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, `src/proxy.ts` (não `middleware.ts`), porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel), **3000** em containers e CI; `requireNutri` é a **primeira** linha de toda página e Server Action da nutricionista (a guarda `acoes-de-paciente.test.ts` chama toda ação do painel com sessão de paciente), `requireApiNutri` nos Route Handlers dela; `requirePaciente`/`requireApiPaciente` no portal; ids de rota conferidos com `idValido` (id inválido = 404, nunca 500). **Muda na Tarefa 14:** as páginas de `src/app/painel/**` deixam de renderizar `<Cabecalho`; quem desenha o cabeçalho é `src/app/painel/layout.tsx` (a guarda `cabecalho.test.ts` é reescrita). O layout **não é barreira de segurança**: toda página continua chamando `requireNutri`.
- **Base:** `origin/main` depois do merge do PR #11 e do Plano 07 (migrations até `0084`). As migrations deste plano começam em **`0085`**: `0085_paciente_colunas` (custom, T5), `0086_metricas_sucesso` (gerada, T9), `0087_metricas_sucesso_admin` (custom, T9), `0088_preferencias_usuaria` (gerada, T13). O número exato é o que o `drizzle-kit` gerar; se outra migration entrar antes, renumerar no rebase e corrigir as referências deste plano no PR. Migrations só com `DATABASE_URL_MIGRATOR` (CLAUDE.md regra 7); **nunca** no banco de dev compartilhado sem combinar, nunca em produção fora do deploy.
- CLAUDE.md regras 1, 2, 8 e 9: nenhuma tabela nova com `tenant_id` neste plano. As colunas novas de `user` (`tema`, `guia`) são acessadas fora do `withTenant` só por `src/modules/plataforma/preferencias.ts` — a Tarefa 13 acrescenta o arquivo à lista da regra 1. As colunas novas de `tenants` (`taxa_faltas_base`, `go_live_em`) seguem a regra de `tenants` (sem RLS; o `tenantId` vem sempre da sessão ou do admin).
- **RNF-11 / CLAUDE.md regra 3:** nada de senha, token, cookie, e-mail, telefone, nome de paciente, caminho de arquivo, corpo de requisição, query string, mensagem de erro de banco/Zod/rede ou texto clínico em log ou no Sentry. Todo evento do Sentry passa por `filtrarEvento`/`filtrarBreadcrumb` (Tarefa 1); `Sentry.init` existe em **um** arquivo (`src/lib/sentry.ts`, guarda na Tarefa 2); sem Session Replay, sem tracing, sem `sendDefaultPii`, sem variáveis locais na pilha.
- **Uma conexão por transação** (Plano 05): dentro do callback de `withTenant` só o `tx` recebido.
- Textos de interface em pt-BR, com o texto exato da spec quando existir; textos novos na tabela de desvios (última linha). O texto do manual guiado (Tarefa 20) é **rascunho** até o dono e a Debby aprovarem no P08-08.
- **Acessibilidade (RNF-10):** WCAG 2.1 AA no PWA (como hoje) **e, a partir deste plano, no painel**, nos modos claro, escuro e "igual ao aparelho" (D25); foco visível em tudo (`:focus-visible` global); alvos ≥ 44 px nos botões do cabeçalho; nenhuma cor como único sinal.
- **Custo zero na assinatura:** Sentry no plano gratuito (Developer), monitor externo gratuito, k6 OSS por Docker (nada de k6 Cloud), Lighthouse CLI, nenhuma biblioteca de tour paga nem serviço de onboarding com rastreamento (Intro.js e Shepherd ficam de fora pela licença AGPL/comercial), nenhum `/code-review ultra`.
- **Regras do servidor** (`/home/deploy/servidor/CLAUDE.md`): configuração de serviço (variáveis, limites, imagem) só pelo Easypanel, pelo dono; nada de mexer em produção, firewall ou banco de produção sem confirmação; nunca exibir segredos (só o nome da variável). A pilha de carga (Tarefa 10) sobe na VPS **só com OK do dono**, de madrugada (horário de Brasília), sem dado real. O teste de restauração (Tarefa 11) lê o backup de produção: cada execução no host pede confirmação. **Nunca rodar `nutri-backup.sh` fora de `test/backup.test.ts`** (regra 10); mudou o script → o dono reinstala no host. Lembrar o snapshot no hPanel antes de cada merge (= deploy).
- Horários: o dono está em Brasília (UTC−3); a VPS está em UTC. Crons do pg-boss em `America/Sao_Paulo`; ao relatar horários, converter.
- Política de revisão por entrega (índice, revista em 02/10/2026): revisor por tarefa → revisão final do branch (workflow) com uma onda de correções → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor vai para o backlog) → re-revisão só do diff das correções → `/security-review` **com o checklist reforçado** (este é o P08-05, a revisão geral final). Se sobrar problema Critical/Important confirmado, parar e avisar o dono. Lembrar o dono, a cada sessão, de que o **backup no host (P02-11, etapas 6 e 8) segue pendente**: sem ele, nada de pacientes reais.

### Decisões de desenho (★ = do dono, **aprovadas em 04/10/2026 conforme a recomendação**)

| # | Tema | Decisão (aplicada no plano) | Custo / consequência · se o dono escolher outra |
|---|---|---|---|
| D1 ★ ✅ | Serviço de erros (P08-01, RNF-11) | **Sentry SaaS, plano gratuito (Developer)**, org criada na região UE se o gratuito permitir; SDK **só no servidor e no worker** (`@sentry/node`); erros do navegador vão a uma rota própria (`POST /api/erro-cliente`) que só repassa `digest`, nome do erro e rota; regras de servidor do Sentry ligadas (Data Scrubbing, "Prevent storing of IP addresses"); sem Replay e sem tracing. O DPA passa a listar o Sentry (suboperador, transferência internacional) | Custo zero; o MCP do Sentry (spec §9) funciona. Alternativas: **GlitchTip autohospedado** (dado não sai da VPS; +3 serviços no Easypanel — web, worker, Postgres/Valkey —, ~1 GB de RAM, atualização por conta do dono, sem MCP); **SDK também no navegador com túnel** (`@sentry/nextjs`: DSN no build pelo GitHub Actions, +~70 KB no bundle do PWA, mais superfície para o filtro — o clique e a URL do navegador carregam nome de paciente) |
| D2 | `request_id` (RNF-11) | Gerado no `proxy.ts` para páginas e Server Actions, sobrescrevendo o que o cliente mandar; volta no cabeçalho `x-request-id`; vai como tag no Sentry e na linha de log de erro (`onRequestError`), com `tenant_id` quando a sessão já foi lida. **O `matcher` continua sem `/api/*`:** pelo `proxyClientMaxBodySize.md` do Next 16, toda requisição que passa pelo proxy tem o corpo copiado para a memória, com corte silencioso em 10 MB — o exame de até 20 MB (US-015) chegaria cortado e o `lerCorpoLimitado` (limite de tamanho e `prazoMs`) das rotas sem login só agiria depois de o Next já ter guardado até 10 MB por requisição. Nas APIs, o id nasce no `onRequestError` (sempre `novoRequestId()`: sem o proxy, o `x-request-id` viria do cliente) e não volta em cabeçalho | Não vai em **toda** linha de log: com o `AsyncContextFrame` do Node 24, um `enterWith` feito dentro do `requireUser` não chega à página que o chamou (o contexto é restaurado no `await`). Desvio registrado; a correlação "erro do usuário ↔ Sentry ↔ log" funciona pelo id |
| D3 ★ ✅ | Monitor externo (P08-02, RNF-04) | **UptimeRobot gratuito**, checando `GET /api/health` (espera 200 e `"ok"`) e `/entrar` **a cada 5 min**, alerta por e-mail e pelo app do celular do dono; a spec passa a dizer "checagem a cada 5 min, alerta em até 10 min" (desvio). Conferir na contratação se o plano grátis permite uso comercial; se não, cair para a alternativa (b) | Custo zero, nenhum código para manter; 99% ao mês tolera 7,3 h fora — 5 min não muda a meta. Alternativas: (b) **HetrixTools grátis** (checagem de 1 min, cumpre a RNF-04 sem desvio; conta em mais um terceiro); (c) **Cloudflare Worker com Cron Trigger de 1 min** (a conta Cloudflare já existe; ~60 linhas nossas para manter e um canal de alerta a montar); (d) Uptime Kuma na própria VPS (descartado: cai junto com ela, não é externo) |
| D4 ★ ✅ | Critério de aceite do teste de carga (P08-03, RNF-01/RNF-02) | Com 50 tenants × 300 pacientes ativos e 100 VUs: **Route Handlers (`/api/*`) p95 ≤ 300 ms** (RNF-01, bloqueia); **páginas (HTML/RSC) p95 ≤ 800 ms** (meta nova, bloqueia); **falhas < 1%** sem contar os 429 esperados; job `notificacoes` com 15 mil pacientes **< 20 s**; **LCP ≤ 2,5 s** ("Slow 4G", Lighthouse) em `/p/inicio` e `/p/plano`, medido **depois** da CSP; `cursoia_crm` sem degradação (a VPS mantém ≥ 2 vCPU livres no `docker stats` durante o teste). Rodada 1 com os limites atuais do Easypanel para achar o gargalo; rodada 2 com a configuração final | Alternativas: **300 ms também nas páginas** (provável reprovação sem cache, com o render dinâmico da CSP; mais dias de otimização antes do go-live); **só relatório, sem bloquear** (sobe sem saber se aguenta 50 tenants — aceitável para 1 tenant, mas a RNF-02 vira promessa sem medida) |
| D5 | Onde roda o k6 | Pilha de carga separada na VPS (`docker-compose.carga.yml`: banco próprio, a mesma imagem do GHCR, os mesmos limites do Easypanel, portas só em `127.0.0.1`), semeada por `test/carga/seed.ts`, de madrugada, com OK do dono; **nunca** contra produção nem com dado real. k6 por `docker run grafana/k6`, fora do CI | O CI gratuito não tem fôlego nem rede estável para carga |
| D6 ★ ✅ | Roles na restauração (P08-04, RNF-05) | O script de backup passa a gravar também `pg_dumpall --globals-only --no-role-passwords` (`db/globais.sql`, no mesmo remoto cifrado); a restauração aplica os roles antes do `pg_restore`; como voltam sem senha, o roteiro de desastre manda o dono devolver a senha do migrator pelo `\password` do psql (sem eco, sem passar pelo chat) antes de subir o app. **Mexe no script → o dono reinstala no host** (regra 10) | Restauração reproduzível dentro do RTO de 4 h (os donos das funções `SECURITY DEFINER` voltam iguais). Alternativa: **criar os roles à mão** pela lista do `docs/operacao/restauracao.md` (sem mexer no script já pronto; mais passo manual na hora da crise e risco de dono errado nas funções da RLS) |
| D7 | CSP (P08-05, RNF-06) | **Nonce por requisição** no `proxy.ts` + `'strict-dynamic'` (o guia `content-security-policy.md` do Next 16); o layout raiz chama `connection()`, então **todas as páginas passam a ser dinâmicas** (`/entrar` deixa de ser pré-renderizada — o LCP é medido depois, D4). `style-src 'self' 'unsafe-inline'` (há atributos `style` do React: cor da marca, gráficos). `connect-src 'self'` (D1: o Sentry não é chamado pelo navegador). `frame-src` com YouTube sem cookies, Vimeo e Turnstile (D10 do Plano 07). **Vale direto** (produção ainda sem pacientes reais; o E2E roda todas as telas sem violação); `CSP_MODO=relatorio` no Easypanel volta para Report-Only em emergência, com os relatórios num log só de contagem | Report-Only antes por uma semana não acrescenta sinal sem usuários reais |
| D8 ★ ✅ | HSTS | `Strict-Transport-Security: max-age=63072000` **sem `includeSubDomains` e sem `preload`** | Outros subdomínios de `wsscloud.tech` (o CRM, o Easypanel) não ficam obrigados a HTTPS por causa do NutriDebby. Alternativa: com `includeSubDomains`/`preload` (mais forte, mas um subdomínio sem HTTPS fica inacessível por 2 anos nos navegadores que já viram o cabeçalho; `preload` é difícil de desfazer) |
| D9 | RLS final (P08-05, RNF-07; débitos B-4, B-6 e a capa do Plano 07) | Migration `0085`: gatilho `BEFORE UPDATE` em `patients` (a sessão de paciente só muda `user_id` de nulo para a própria conta, as colunas do WhatsApp — com origem `paciente` — e `updated_at`) e em `data_exports` (só `pendente → falhou`); `audit_log` sem SELECT para paciente (`RESTRICTIVE`); `paciente_arquivos` passa a mostrar ao paciente só a capa de conteúdo que a RLS da audiência já deixa ele ver | O `auditRead` e o gatilho de auditoria só fazem INSERT (sem `RETURNING`): nada quebra. Erro do gatilho = 42501 |
| D10 | Limites e sessão (P08-05; débitos B-8, S-12, notas N4 e N7) | **B-8:** `POST /api/p/push` com limite por conta em memória (10 a cada 10 min; 1 réplica — anotado), e o custo O(tenants) do `app_soltar_endpoint_push` **medido** no k6 (sem reescrita: a RLS forçada impede achar os tenants do endpoint antes do laço). **S-12:** `GET /api/p/vinculo` **mantido** (o caso de uso são links de e-mail, que chegam como navegação de outro site; o impacto é trocar entre vínculos ativos da própria vítima) — justificativa na spec. **N4:** política de senha com `\p{L}`/`\p{Nd}` (a faixa `À-ÿ` aceitava `×` e `÷`). **N7:** `withTenant` recusa `nutri` sem `actorUserId` e `paciente` sem `actorUserId`, salvo com `semConta: true` — marca explícita dos três fluxos sem login (link assinado da consulta, respostas do WhatsApp, leitura do convite), que mantêm a RLS por paciente e o `audit_log` sem ator (D20 do Plano 05); lista fechada conferida por guarda | Sem tabela nova |
| D11 ★ ✅ | Limite de login com CGNAT | **Mantém** 5 tentativas/15 min por IP+rota (Plano 01); o teste manual do checklist confere o 429 com o IP real; se o k6 ou a Debby mostrarem bloqueio de pacientes legítimos atrás do mesmo IP de operadora, vira item do backlog | Alternativa: **IP + e-mail** (a spec fala em "IP+e-mail"): tira o risco do CGNAT, mas exige limitador próprio em volta do Better Auth (~1 dia) e um balde por e-mail permite travar a conta de alguém de propósito |
| D12 ★ ✅ | Player do vídeo (privacidade, Plano 07) | **"Clique para carregar"**: o portal mostra a capa e o botão "Carregar o vídeo", com o aviso "O vídeo é exibido pelo YouTube." (ou Vimeo); o `iframe` só entra depois do clique | Abrir um conteúdo não manda mais o IP do paciente ao Google/Vimeo sem uma ação dele; +1 clique para assistir; ~0,5 dia. Alternativa: **player direto** (como o Plano 07 aprovou; o termo v1.0 declara YouTube/Vimeo de qualquer forma) |
| D13 | `access_events` (RNF-08; lacuna achada na preparação) | Entra no que a exclusão (pedido atendido) e a anonimização apagam; retenção de **400 dias** (13 meses de série do CS-02 + folga), apagada pelo job `agenda-limpeza` | Dado não obrigatório some na hora (RNF-08) |
| D14 | Textos legais e prazo (P08-06, P-01, P-02) | `DPA_VERSAO` e `TERMO_PACIENTE_VERSAO` = `'1.0'` com o texto **entregue pelo advogado (E-09)**, sem edição nossa; uma lista `SUBOPERADORES` no código (Hostinger, Cloudflare, Resend, Sentry, serviços de push, YouTube, Vimeo, Evolution API autohospedada) que o teste confere no texto do DPA; `PRAZO_GUARDA_ANOS` só muda se o advogado/CRN definir outro valor (o novo prazo vale para os bloqueios novos; não há paciente real bloqueado hoje). Nota do L-5 na opção "Mostrar % de gordura ao paciente" | Depende do E-09 (prazo de terceiro); o resto do plano não espera por ele |
| D15 ★ ✅ | Métricas de sucesso (P08-07) | **CS-01:** consultas `realizada` com atendimento registrado ÷ consultas `realizada` desde `go_live_em`, mais "dias desde o início: N de 30" (a parte "sem voltar à ferramenta anterior" é a confirmação da Debby no checklist). **CS-02:** pacientes **ativos com conta no portal** que abriram o app nos últimos 7 dias ÷ ativos com conta (meta 60%), com as barras dos 7 dias. **CS-03:** a taxa do mês (já existe) contra a **taxa-base informada pelo admin** (`tenants.taxa_faltas_base`, P-15/E-08). O admin vê só contagens por uma função `SECURITY DEFINER` nova | Alternativas: denominador do CS-02 = **todos os ativos** (penaliza quem ainda não convidou todos; a meta de 60% fica mais difícil no começo); base do CS-03 **só no checklist** (sem coluna nova; a comparação não aparece no painel) ou **informada pela própria Debby** em Configurações (um campo a mais na tela dela) |
| D16 ★ ✅ | WhatsApp no go-live | Go-live **com WhatsApp só se** o E-04 revisado (Evolution + número da Debby por QR) e a P-17 estiverem conferidos; senão, sobe com lembretes por e-mail e push (a spec permite) e o WhatsApp entra depois, sem deploy | Alternativa: esperar o WhatsApp para subir (atrasa o go-live pelo prazo do E-04) |
| D17 ★ ✅ | Onde guardar a preferência de tema | **Colunas na `user`**: `tema text not null default 'sistema'` (`sistema`/`claro`/`escuro`) e `guia jsonb not null default '{}'` (progresso do manual). O `tema` chega em `data.user` pelo `additionalFields` do Better Auth (`input: false`), na leitura de sessão que já existe; o servidor desenha o tema certo, sem piscada e sem script inline | Acompanha a usuária em qualquer aparelho. Alternativas: **cookie** (vale por aparelho e navegador; ler no layout raiz deixaria tudo dinâmico de novo); **`localStorage`** (o "Sair" manda `Clear-Site-Data: "storage"` e apagaria a escolha a cada saída; exige script inline com nonce para não piscar); **tabela nova** (mais uma exceção de RLS ou mais RLS + fábrica no `isolamento.test.ts` para dois campos) |
| D18 ★ ✅ | O portal do paciente ganha o visual novo e o modo escuro? | **Correção já** do bug de produção (o `globals.css` escurece o fundo no aparelho escuro sem adaptar as telas: barra de abas com contraste 1,17) na Tarefa 12, e **na Tarefa 18 o portal recebe os mesmos tokens e fontes, seguindo o modo do aparelho, sem botão** (`data-tema="sistema"` fixo; `themeColor` claro/escuro). A disposição das telas (360 px, barra de abas, R16) **não** vira bento | ~1,5–2 dias. Alternativas: **só o painel** (o portal fica sempre claro depois da correção; a Tarefa 18 sai do plano); **portal com botão também** (precisa de preferência para o paciente e uma opção nova em "Perfil"; +1 dia) |
| D19 ★ ✅ | Marca no topo do painel (US-005 "Marca aplicada") | **Logo e nome do consultório** à esquerda (ou um círculo com as iniciais); "NutriDebby" só no `<title>`. O cabeçalho fica neutro e a cor do tenant vai para o item ativo do menu, o cartão de destaque, os botões primários e o foco; no escuro, uma variante clareada calculada no servidor (`corNoEscuro`) | Alternativa: o logo "NutriDebby" do design (contraria a US-005 e o multi-tenant: a segunda nutricionista veria a marca da primeira) |
| D20 ★ ✅ | Menu do painel | **6 itens no topo** (Início, Pacientes, Agenda, Diários, Conteúdos, Configurações); **Configurações** vira uma página de cartões (Perfil e marca, Tema, Horários de atendimento, WhatsApp, Alimentos, Modelos de plano, Modelos de anamnese, Segurança); **menu da conta** no avatar (`<details>`): "Perfil e marca", "Segurança", "Manual", "Rever o tour de boas-vindas", "Sair". A Segurança continua em `/conta/seguranca` (o admin usa a mesma tela; o 2FA obrigatório redireciona para lá) e ganha os tokens, sem o layout do painel | Alternativa: manter os 10 links de hoje (não cabem no design; quebram em 3 linhas abaixo de 1200 px) |
| D21 ★ ✅ | Sino "Avisos" do design | **Fica fora na v1**: os alertas (cota de armazenamento, WhatsApp desconectado, cota do WhatsApp, pendências de presença, pedidos do titular) continuam no Início, como `Aviso` com `role="alert"`/`status` | Alternativa: central de avisos no sino (+1 dia; alerta importante escondido atrás de um clique) |
| D22 ★ ✅ | "Peso" no cartão "Próxima consulta" | **Sai.** Mostrar peso no Início exigiria `auditRead` a cada abertura (regra 8) — o "Histórico de acessos" do paciente encheria sem a nutricionista ter aberto o prontuário — e expõe dado de saúde na tela inicial (minimização). No lugar: "Diário: N registros em 7 dias" e "Portal: N de 7 dias" (contagens, sem `auditRead`, como a agenda — D10 do Plano 05) | Alternativa: mostrar o peso com `auditRead` a cada abertura do Início |
| D23 | `COR_PADRAO` | `#047857` → **`#1d6b5a`** (a cor do design e do `themeColor` do PWA; 6,36:1 com branco). Só muda para quem nunca gravou `cor_primaria` | — |
| D24 | Tokens, fontes e tema no HTML | Cores como variáveis `--nd-*` no `globals.css`, **sem `light-dark()`** (o Safari só o tem a partir da 17.5 e a RNF-09 exige iOS 16.4+: a variável ficaria inválida e o foco e as cores sumiriam): valores claros em `:root`/`[data-tema=claro]`, escuros em `[data-tema=escuro]` e em `@media (prefers-color-scheme: dark) { [data-tema=sistema] }`, expostas ao Tailwind por `@theme inline` (`bg-cartao`, `text-suave`, `text-erro`, `border-campo`…), fonte única em `src/lib/tema/tokens.ts` (teste de contraste e teste que confere o CSS); `data-tema` no `div` do layout do painel (não no `<html>`); `:focus-visible` global; Figtree (texto) e Bricolage Grotesque (títulos) por `next/font/google` | Nenhum `dark:` espalhado; o modo "igual ao aparelho" funciona só com CSS |
| D25 | Axe no painel (RNF-10) | O axe passa a rodar também no painel (projeto Playwright `painel`, desktop), em **todas** as telas (~43, uma por `page.tsx`, com as telas de id — inclusive o editor do plano — criadas no preparo; guarda `rotas-axe.test.ts` compara a lista com os `page.tsx`), em claro, escuro e "igual ao aparelho" com o aparelho escuro, mais as tags `wcag22aa` (alvo de toque) no painel; 768 px sem rolagem horizontal | A spec v1.9 só exige o axe no PWA: estender a RNF-10 (spec v2.0) |
| D26 ★ ✅ | Formato do manual guiado (P08-10) | **Os dois:** (1) **tour de boas-vindas** que abre sozinho uma vez no `/painel`, depois do aceite do DPA (5–7 passos; "Pular o tour" grava "dispensado"); (2) **tours por tela** sob demanda (Pacientes, Prontuário, Plano alimentar, Agenda, Horários, Diários, Conteúdos, Configurações, WhatsApp); (3) **central de ajuda**: botão "Ajuda" no cabeçalho com o texto da tela atual e a página `/painel/ajuda` (manual completo, funciona sem JavaScript e dá para imprimir — base do treinamento do P08-08). Componente próprio com `<dialog>` nativo; conteúdo num arquivo TS tipado; progresso em `user.guia` | ~4–5 dias + texto. Alternativas: **só o tour** (~2–3 dias; sem material de consulta nem de treinamento); **só a central de ajuda** (~2 dias; a Debby não é guiada na primeira vez) |
| D27 | Regras do manual | Tours por tela **não abrem sozinhos**: na primeira visita, um aviso discreto "Primeira vez aqui? Ver como funciona" (dispensável); progresso salvo só como `{id: {v, estado}}` (sem data por passo, sem cliques, sem envio a terceiros); subir a `versao` de um tour faz o aviso voltar; nenhum dado de saúde nos exemplos; `prefers-reduced-motion` respeitado | — |

### Desvios conscientes da spec (registrados aqui; atualizar a spec no fim do plano)

| Spec | Neste plano | Motivo |
|---|---|---|
| RNF-04 "a cada 1 min, alerta ≤ 2 min" | Checagem a cada 5 min, alerta em até 10 min (se D3 for aprovada como recomendada) | Plano gratuito |
| RNF-11 "logs com `request_id`" | `request_id` no cabeçalho, no Sentry e na linha de erro da requisição; não em toda linha de log. Nas rotas `/api/*` (fora do `matcher` do proxy, para não bufferizar o corpo) não há `x-request-id` na resposta: o id é criado no `onRequestError` e só existe no log e no Sentry | D2 |
| RNF-11 / §9 `@sentry/nextjs` | `@sentry/node` só no servidor e no worker; erros do navegador por `/api/erro-cliente` | D1 |
| RNF-06 CSP "`connect-src` próprio + Sentry" | `connect-src 'self'`; `style-src` com `'unsafe-inline'` | D1, D7 |
| RNF-06 HSTS | Sem `includeSubDomains`/`preload` | D8 |
| RNF-01 | Meta nova para páginas (p95 ≤ 800 ms); LCP medido depois da CSP | D4, D7 |
| RNF-03 | Limites revistos para a VPS de 8 vCPU / 32 GB depois da rodada 1 do k6 (o texto "~5,5 GB livres" sai) | VPS nova |
| RNF-05 / §9.2 `postgresql-client-16` no host | Restauração com o `pg_restore` de um container descartável; o cliente no host não é instalado (corrigir o E-10) | D6 |
| RNF-08 | `access_events` apagado na exclusão; retenção de 400 dias | D13 |
| RNF-10 | Axe também no painel, nos três modos | D25 |
| RNF-06 / Plano 06 S-12 | `GET /api/p/vinculo` grava cookie num GET — mantido, com justificativa | D10 |
| CS-01 / CS-02 / CS-03 (§1.1) | Fórmulas da D15; CS-02 conta **dias com acesso** (`access_events`), não "sessões" | D15 |
| US-005 "Marca aplicada" | Cabeçalho neutro; a cor do tenant nos destaques e uma variante clara no escuro | D19 |
| §2.1 / histórias | P08-10 não está na spec v1.9: entra como história nova **US-057 "Manual guiado"** (E1), com a tabela "Textos do manual" | Pedido do dono (04/10/2026) |
| §4.1 regra de acesso à `user` | `src/modules/plataforma/preferencias.ts` acessa `user.tema`/`user.guia` | D17 |
| US-050 (Plano 07) | Player só depois do clique (se D12 aprovada) | D12 |
| Textos novos de interface | Painel: "Seu dia, {primeiro nome}", "Próxima consulta", "Hoje", "Diários para ver", "Agenda do dia", "Pacientes no app esta semana", "Atalhos", "Novo paciente", "Abrir prontuário", "Entrar na chamada", "Presencial", "Online", "{n}ª consulta", "Confirmada pelo link", "Confirmada pelo WhatsApp", "Diário: {n} registros em 7 dias" / "Diário: 1 registro em 7 dias", "Portal: {n} de 7 dias", "Nenhuma consulta hoje.", "{n} consultas" / "1 consulta", "{n} confirmadas", "{n} pedidos de remarcação", "{n} registros novos" / "1 registro novo", "Abrir Diários", "{abriram} de {total} pacientes abriram o app nos últimos 7 dias", "Critérios de sucesso", "Atendimentos registrados: {x} de {y} consultas realizadas ({pct}%)", "Dias desde o início: {n} de 30", "Taxa de faltas antes do sistema: {pct}%", "Configurações", "Perfil e marca", "Tema", "Claro", "Escuro", "Igual ao aparelho", "Tema salvo.", "Horários de atendimento", "Segurança", "Manual", "Rever o tour de boas-vindas", "Conta de {nome}", "Menu", "Modo escuro" (rótulo fixo do botão), "Mudar para o modo claro" / "Mudar para o modo escuro" (dica), "Mesmo desligada, a cópia dos dados que o paciente pede inclui todas as medidas (LGPD, art. 18, II)." (L-5) · Manual: "Ajuda", "Ajuda desta tela", "Ver o tour desta tela", "Abrir o manual completo", "Voltar", "Próximo", "Concluir", "Pular o tour", "{i} de {n}", "Primeira vez aqui?", "Ver como funciona", "Dispensar", "Fechar", "Manual do NutriDebby", "Nesta página" e o conteúdo da Tarefa 20 · Admin: "Taxa de faltas antes do sistema (%)", "Início do uso", "App na semana", "Faltas no mês", "Métricas salvas." · Erros: "Algo deu errado.", "Tentar de novo", "Muitas tentativas. Tente de novo em alguns minutos." · Portal (D12): "Carregar o vídeo", "O vídeo é exibido pelo YouTube." / "O vídeo é exibido pelo Vimeo." | Telas novas |

### Itens adiados de planos anteriores e débitos

**Incorporados** (a tarefa entre parênteses):
- Notas "para o Plano 08" (pesquisa de backlog, N1–N39): N4 senha (T6), N5 texto do health + E2E (T3), N7 `actorUserId` (T6), N9/N14/N20 cenários do k6 (T10), N11 retenção do log da Evolution (runbook), N13 `access_events` no CS-02 (T9), N15/N36/N37 testes manuais e VAPID (checklist), N16/N21/N34/N39 textos legais (T8 + insumos do advogado no runbook), N17–N19 CSP (T4), N23 B-4/B-6 (T5), N27 Sentry MCP (runbook), N29 restauração (T11), N35 DMARC (checklist), N38 capas (T5).
- Débitos da triagem: **B-4, B-6** (T5), **B-8, S-12** (T6), **W-13, X-5** (checklist), **L-5** (T8), **S-7** (a leitura de sessão ganha `cache()` na T14, em `requireUserComTenant`, que a nutricionista e o `requirePaciente` usam; o p95 de `/p/*` é medido no k6, T10).
- Lacunas da preparação: `access_events` na exclusão (T7), roles fora do dump (T11), E-10 sem `psql` no host (fechamento), RNF-03 desatualizado (fechamento), bug do modo escuro do aparelho em produção (T12, passo 1).

**Não incorporados** (motivo):
- B-9 (tabelas fora da negação da D1) e T-9: só texto da spec, no fechamento.
- P04-10, P06-12, P07-05/P07-08 e os Minors do Plano 07: prioridade S; ficam no backlog (não bloqueiam o go-live).
- O O(tenants) do `app_soltar_endpoint_push` (B-8, parte 2): medido no k6 (o cenário do paciente chama `POST /api/p/push?sincronizar=1` com uma inscrição sintética já gravada); só vira tarefa se passar da meta da D4.
- S-7, parte do paciente (`vinculosDaConta` e `termoAceito` por chamada no `requirePaciente`): sem `cache()` próprio neste plano; vira tarefa se o p95 de `/p/*` no k6 passar da meta da D4.
- Staging, Asaas, acesso de suporte autorizado: Fase 2 (spec §10).

## Review Focus

1. **Dado de saúde chegando ao Sentry ou ao log por um caminho não óbvio.** `ZodError` com o valor digitado ("Glicemia 180"), erro do `pg` com parâmetro na mensagem, `DrizzleQueryError` antes do `sanitizarErroDeBanco`, URL com token (`/convite/paciente/<token>`, `/consulta/<token>`, `?token=` do `/definir-senha`), breadcrumb de clique com o nome do paciente, `extra`/`contexts` preenchidos por uma biblioteca, e-mail no `user` do evento, corpo do `POST /api/erro-cliente` com 5 KB de texto livre, erro de job com caminho `/data/<tenant>/…`. Esperado: mensagem `[removido]` (salvo a lista de classes com mensagem fixa), URL só com o caminho e `:id`/`:token`, sem breadcrumbs de UI/console, `user` só com `id`, rota de erro do cliente recusando corpo grande ou campo fora do formato. Testes nas Tarefas 1 e 2 (inclusive um envelope real do SDK com transporte falso).
2. **CSP quebrando o que funciona hoje.** Turnstile da página pública e do "Esqueci minha senha", player do YouTube/Vimeo, Server Actions (`form-action`), fontes do `next/font`, atributos `style` (cor da marca, gráfico), foto do diário (`blob:`), QR do 2FA (`data:`), service worker e a cópia offline do plano (guardada com o nonce do HTML), download do PDF, navegação `next/link` com prefetch. Esperado: nenhuma mensagem "Content Security Policy" no console em nenhuma tela do E2E; offline do plano igual. Testes na Tarefa 4 (E2E que coleta o console) e as specs existentes.
3. **Tema e marca nos dois modos.** Cor do tenant no limite (4,5:1 com branco) usada como texto ou foco no escuro; modo "igual ao aparelho" com o aparelho mudando no meio da sessão; sem JavaScript; dois aparelhos da mesma usuária; o tema depois do "Sair" (o `Clear-Site-Data` não pode apagar a escolha); tenant sem cor gravada; QR do WhatsApp (precisa de fundo branco no escuro). Esperado: contraste ≥ 4,5 em todo par de texto (teste de propriedade com cores aleatórias), tema igual em outro contexto do navegador, QR legível. Testes nas Tarefas 12, 13, 17.
4. **Paciente forjando escrita ou leitura com SQL arbitrário.** UPDATE de `status`, `anonimizar_apos`, `user_id` de outra conta ou `whatsapp_optin_origem = 'nutri'` em `patients`; `data_exports` passando para `pronta` com `arquivo_path` de outro; SELECT em `audit_log`; capa de conteúdo fora da audiência pelo caminho do arquivo. Esperado: 42501 (gatilho ou RLS), 0 linhas no `audit_log`, capa invisível; o aceite do convite e o opt-in/opt-out continuam funcionando. Testes na Tarefa 5.
5. **Manual atrapalhando o trabalho.** Tour abrindo em cima do aceite do DPA, a cada navegação, com o alvo ausente (sem consulta hoje), a 768 px, sem JavaScript; foco preso depois de fechar; E2E de outras specs esbarrando no tour; progresso gravado na conta de outra usuária; duas abas gravando o progresso ao mesmo tempo. Esperado: abre uma vez, só no `/painel`, só com o DPA aceito; passo sem alvo aparece centralizado; `Esc` = "Pular" e devolve o foco; o seed marca o tour como concluído; `jsonb_set` atômico só na linha da sessão. Testes nas Tarefas 13, 19 e 20.

---

## Estrutura de arquivos

```
drizzle/
  0085_paciente_colunas (custom: gatilhos B-4, audit_log sem SELECT do paciente, capas pela audiência)   # T5
  0086_metricas_sucesso (gerada: tenants.taxa_faltas_base, tenants.go_live_em)                          # T9
  0087_metricas_sucesso_admin (custom: admin_metricas_sucesso())                                        # T9
  0088_preferencias_usuaria (gerada: user.tema, user.guia)                                              # T13
src/lib/
  sentry-filtro.ts (+test) · request-id.ts (+test)                                                      # T1
  sentry.ts (+test, +sentry-guarda.test.ts) · limite-memoria.ts (+test)                                 # T2
  csp.ts (+test)                                                                                        # T4
  password-policy.ts (+test)                                                                            # T6
  tema/{contraste,tokens,marca-tema}.ts (+tests)                                                        # T12
src/instrumentation.ts                                                                                  # T2
src/proxy.ts (+proxy.test.ts) · next.config.ts · src/app/layout.tsx                                    # T1, T4, T12
src/app/{global-error,error}.tsx · src/components/reportar-erro.ts · src/app/api/erro-cliente/route.ts (+test)   # T2
src/app/api/csp-relatorio/route.ts                                                                      # T4
src/app/api/health/route.ts · src/worker/heartbeat.ts (+test)                                           # T3
src/worker/{index,sem-detalhe}.ts                                                                       # T2, T7
src/env.ts (+test)                                                                                      # T2, T4
src/db/tenant.ts (+test, +sem-conta-guarda.test.ts) · src/db/paciente-colunas.test.ts                     # T5, T6
src/modules/{agenda/acoes-link,notificacoes/whatsapp/webhook,pacientes/convite-paciente}.ts (semConta)   # T6
src/app/api/p/push/route.ts (+test) · src/components/player-video.tsx (+test)                           # T6
src/modules/portal/acesso.ts (+test) · src/modules/pacientes/lgpd.ts (+test)                            # T7
src/modules/plataforma/{dpa,suboperadores}.ts · src/modules/pacientes/termo-paciente.ts · src/modules/plataforma/textos-legais.test.ts · src/app/painel/configuracoes/perfil-form.tsx   # T8
src/db/schema/platform.ts · src/modules/plataforma/{metricas-sucesso,metricas}.ts (+test) · src/app/admin/{page,metricas-form}.tsx, actions.ts   # T9
docker-compose.carga.yml · test/carga/{seed.ts,cenario.js} · docs/operacao/carga.md                      # T10
scripts/backup/{nutri-backup.sh,nutri-restauracao-teste.sh} · test/{backup,restauracao}.test.ts · docs/operacao/restauracao.md   # T11
src/app/globals.css · src/modules/plataforma/{marca,marca-constantes}.ts                                # T12
src/db/schema/auth.ts · src/lib/auth.ts · src/modules/plataforma/preferencias.ts (+test) · src/app/painel/preferencias/actions.ts · CLAUDE.md   # T13
src/app/painel/{layout,cabecalho,menu-painel,menu-conta,alternar-tema,navegacao}.tsx|ts (+cabecalho.test.ts, navegacao.test.ts) · src/lib/{session,tenant-session}.ts · 30 page.tsx + pacientes/[id]/layout.tsx · src/app/painel/configuracoes/{page,perfil/page,tema-form}.tsx · src/app/painel/dpa/page.tsx   # T14
src/components/ui/{cartao,botao,aviso,selo}.tsx (+test) · src/components/campo.tsx · src/modules/agenda/inicio.ts (+test) · src/modules/portal/diario-nutri.ts · src/app/painel/page.tsx   # T15
src/app/painel/**/*.tsx · src/modules/*/ui/*.tsx · src/app/conta/seguranca/** · src/app/painel/cores.test.ts   # T16
playwright.config.ts · e2e/acessibilidade-painel.spec.ts · e2e/painel.ts · e2e/*.spec.ts (menu novo)   # T17
src/app/p/** · src/app/p/layout.tsx · e2e/acessibilidade.spec.ts                                        # T18 (só com D18)
src/modules/ajuda/conteudo.ts (+test) · src/app/painel/guia/{tour,ajuda,aviso-primeira-vez}.tsx · src/app/painel/ajuda/page.tsx   # T19
data-guia nas telas · scripts/e2e-seed.ts · e2e/manual.spec.ts · e2e/helpers.ts                          # T20
docs/operacao/go-live.md                                                                                # T21
```

**Ordem e dependências:** Frente de operação e segurança: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Frente visual e manual: 12 → 13 → 14 → 15 → 16 → 17 → (18) → 19 → 20. Fecho: 21. As duas frentes podem correr em paralelo em worktrees (como no Plano 06), com estas dependências cruzadas declaradas: **(a) T9 antes da T15** — os cartões de métricas do Início (T15) importam `metricasDeSucesso`/`DIAS_CS01`/`META_CS02` e leem `tenants.go_live_em`/`taxa_faltas_base`, tudo da T9: antes de começar a T15, integrar no worktree visual a frente de operação até a T9 (com as migrations 0085–0087; a 0088 da T13 é renumerada nessa integração, se preciso); **(b) T12 antes da T8, ou o fallback** — a nota do L-5 (T8) usa `text-suave` da T12 (sem a T12, `text-zinc-600`, e a T16 troca) e mexe em `perfil-form.tsx`, que a T14 reorganiza em `configuracoes/perfil`: resolver na integração; **(c) T4 antes da T17** — a CSP e o axe do painel se encontram no E2E. A T10 (k6) mede a configuração final e **roda depois do merge do Plano 08**, com a imagem do deploy (não há imagem do branch no GHCR) e antes de qualquer paciente real; os relatórios entram num PR curto de docs. A T8 espera o texto do advogado (E-09); se ele atrasar, o branch segue sem ela e a T8 vira um PR curto depois. As Tarefas 18 e 12 (passo 12.1) dependem da D18.

---
### Task 1: Filtro do Sentry e `request_id` (P08-01 a; RNF-11, CLAUDE.md regra 3)

**Files:**
- Create: `src/lib/sentry-filtro.ts`, `src/lib/sentry-filtro.test.ts`, `src/lib/request-id.ts`, `src/lib/request-id.test.ts`
- Modify: `src/proxy.ts`, `src/proxy.test.ts`

**Interfaces:**
- Consumes: nada novo (módulos puros).
- Produces:
  - `@/lib/sentry-filtro`: `filtrarEvento<E extends EventoSentry>(e: E): E`, `filtrarBreadcrumb(b: Breadcrumb): Breadcrumb | null`, `caminhoSeguro(url: string | undefined): string | undefined`, `MENSAGENS_FIXAS: ReadonlySet<string>`, tipos `EventoSentry`, `Breadcrumb`, `TAGS_PERMITIDAS`.
  - `@/lib/request-id`: `CABECALHO_REQUEST_ID = 'x-request-id'`, `novoRequestId(): string`, `requestIdDe(v: string | string[] | null | undefined): string | null`.
  - `src/proxy.ts`: toda página e Server Action sai com `x-request-id` no cabeçalho da requisição repassada e da resposta. **`/api/*` continua fora do `matcher`** (D2): o Next copia para a memória o corpo de toda requisição que passa pelo proxy, com corte silencioso em 10 MB (`proxyClientMaxBodySize`); o id das APIs nasce no `onRequestError` (Tarefa 2, passo 7). **Não** resolver aumentando o `proxyClientMaxBodySize`: o corpo continuaria todo na memória e a proteção contra corpo lento (`prazoMs`) continuaria anulada.

- [ ] **Step 1: Testes do filtro (falham)** — `src/lib/sentry-filtro.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { caminhoSeguro, filtrarBreadcrumb, filtrarEvento, type EventoSentry } from './sentry-filtro';

const SAUDE = ['Glicemia 180', 'Ana Souza', 'ana@ex.com', '11912345678', 'anamnese: diabetes tipo 2', 'Diário: comi um bolo'];
const semSaude = (e: unknown) => {
  const s = JSON.stringify(e);
  for (const t of SAUDE) expect(s, t).not.toContain(t);
};

describe('filtrarEvento (RNF-11, regra 3)', () => {
  it('mensagem de erro sai como [removido]; tipo fica se for um nome de classe', () => {
    const e = filtrarEvento<EventoSentry>({
      exception: { values: [{ type: 'ZodError', value: 'Glicemia 180 inválida para Ana Souza' }, { type: 'Error: <script>', value: 'x' }] },
    });
    expect(e.exception!.values![0]).toMatchObject({ type: 'ZodError', value: '[removido]' });
    expect(e.exception!.values![1].type).toBe('Error');
    semSaude(e);
  });

  it('classes com mensagem fixa do próprio código mantêm a mensagem (até 200 caracteres)', () => {
    const e = filtrarEvento<EventoSentry>({ exception: { values: [{ type: 'TenantContextError', value: 'patientId obrigatório para sessão de paciente' }] } });
    expect(e.exception!.values![0].value).toBe('patientId obrigatório para sessão de paciente');
  });

  it('pilha sem variáveis locais nem linhas de código', () => {
    const e = filtrarEvento<EventoSentry>({
      exception: {
        values: [{ type: 'Error', value: 'x', stacktrace: { frames: [{ filename: '/app/src/x.ts', function: 'f', lineno: 3, vars: { nome: 'Ana Souza' }, context_line: 'const t = "Glicemia 180"', pre_context: ['a'], post_context: ['b'] }] } }],
      },
    });
    expect(e.exception!.values![0].stacktrace!.frames![0]).toEqual({ filename: '/app/src/x.ts', function: 'f', lineno: 3 });
  });

  it('request: só método e caminho (sem query, corpo, cookies, cabeçalhos); tokens e UUIDs trocados', () => {
    const e = filtrarEvento<EventoSentry>({
      request: {
        method: 'POST',
        url: 'https://nutri.wsscloud.tech/convite/paciente/AbCdEfGhIjKlMnOpQrStUvWx?email=ana@ex.com',
        data: { anamnese: 'anamnese: diabetes tipo 2' },
        cookies: { 'nd.session_token': 'segredo' },
        headers: { cookie: 'nd.session_token=segredo', 'user-agent': 'Mozilla' },
        query_string: 'email=ana@ex.com',
        env: { REMOTE_ADDR: '200.1.2.3' },
      },
    });
    expect(e.request).toEqual({ method: 'POST', url: '/convite/paciente/:token' });
    semSaude(e);
  });

  it('user só com id; e-mail, IP e nome saem', () => {
    const e = filtrarEvento<EventoSentry>({ user: { id: 'u-1', email: 'ana@ex.com', ip_address: '200.1.2.3', username: 'Ana Souza' } });
    expect(e.user).toEqual({ id: 'u-1' });
  });

  it('extra sai; tags só da lista e com valor curto e sem espaço; contexts só runtime/os/trace', () => {
    const e = filtrarEvento<EventoSentry>({
      extra: { corpo: 'Diário: comi um bolo' },
      tags: { request_id: 'b1c2', rota: '/painel/pacientes/[id]', nome: 'Ana Souza', fila: 'email', motivo: 'ECONNREFUSED' },
      contexts: { runtime: { name: 'node' }, os: { name: 'Linux' }, trace: { trace_id: 't' }, paciente: { nome: 'Ana Souza' } },
    });
    expect(e.extra).toBeUndefined();
    expect(e.tags).toEqual({ request_id: 'b1c2', rota: '/painel/pacientes/[id]', fila: 'email', motivo: 'ECONNREFUSED' });
    expect(Object.keys(e.contexts!).sort()).toEqual(['os', 'runtime', 'trace']);
    semSaude(e);
  });

  it('tag rota de uma página do portal (grupo de rota com parênteses) fica', () => {
    const e = filtrarEvento<EventoSentry>({ tags: { rota: '/p/(portal)/plano/page', tipo_rota: 'render' } });
    expect(e.tags).toEqual({ rota: '/p/(portal)/plano/page', tipo_rota: 'render' });
  });

  it('mensagem (captureMessage) só se for uma das fixas; logentry sai; transaction com caminho seguro', () => {
    expect(filtrarEvento<EventoSentry>({ message: 'erro no navegador' }).message).toBe('erro no navegador');
    expect(filtrarEvento<EventoSentry>({ message: 'Paciente Ana Souza' }).message).toBe('[removido]');
    expect(filtrarEvento<EventoSentry>({ logentry: { message: 'Ana Souza' } }).logentry).toBeUndefined();
    expect(filtrarEvento<EventoSentry>({ transaction: 'GET /painel/pacientes/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b/exames' }).transaction).toBe(
      'GET /painel/pacientes/:id/exames',
    );
  });

  it('breadcrumbs: console, ui e consultas saem; http fica só com método, status e origem', () => {
    const e = filtrarEvento<EventoSentry>({
      breadcrumbs: [
        { category: 'console', message: 'Ana Souza' },
        { category: 'ui.click', message: 'button[aria-label="Abrir Ana Souza"]' },
        { category: 'query', message: 'select * from patients where nome = $1' },
        { category: 'http', type: 'http', data: { method: 'POST', status_code: 500, url: 'https://api.resend.com/emails?to=ana@ex.com', 'http.query': 'to=ana' } },
      ],
    });
    expect(e.breadcrumbs).toEqual([{ category: 'http', type: 'http', data: { method: 'POST', status_code: 500, url: 'https://api.resend.com' } }]);
  });

  it('não muda campos técnicos (event_id, release, environment, server_name)', () => {
    const e = filtrarEvento<EventoSentry>({ event_id: 'abc', release: 'sha', environment: 'producao', server_name: 'nutri_app.1' });
    expect(e).toMatchObject({ event_id: 'abc', release: 'sha', environment: 'producao', server_name: 'nutri_app.1' });
  });
});

describe('filtrarBreadcrumb', () => {
  it('fetch do Node também fica só com origem; outros somem', () => {
    expect(filtrarBreadcrumb({ category: 'fetch', data: { method: 'GET', status_code: 200, url: 'https://www.youtube.com/oembed?url=x' } })).toEqual({
      category: 'fetch',
      data: { method: 'GET', status_code: 200, url: 'https://www.youtube.com' },
    });
    expect(filtrarBreadcrumb({ category: 'navigation', data: { from: '/p/plano', to: '/p/diario' } })).toBeNull();
  });
});

describe('caminhoSeguro', () => {
  it.each([
    ['/consulta/AbCdEfGhIjKlMnOpQrStUvWx', '/consulta/:token'],
    ['/convite/xYz123-_abcdefghijklmnop', '/convite/:token'],
    ['https://x.test/definir-senha?token=abc', '/definir-senha'],
    ['/p/conteudos/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b?de=plano#x', '/p/conteudos/:id'],
    ['/painel/pacientes/novo', '/painel/pacientes/novo'],
    ['/api/arquivos?c=t1/exame/a.pdf&e=1&s=assinatura', '/api/arquivos'],
  ])('%s → %s', (de, para) => expect(caminhoSeguro(de)).toBe(para));
  it('URL inválida não lança', () => expect(caminhoSeguro('http://[::1')).toBe('[removido]'));
});
```

Run: `pnpm test src/lib/sentry-filtro.test.ts` → FAIL (Cannot find module './sentry-filtro').

- [ ] **Step 2: O filtro** — `src/lib/sentry-filtro.ts`

```ts
/**
 * RNF-11 / CLAUDE.md regra 3: todo evento do Sentry (app e worker) passa por aqui — `beforeSend`,
 * `beforeSendTransaction` (o tracing fica desligado, mas o filtro vale se alguém ligar) e `beforeBreadcrumb`.
 * Regra: o que não está na lista do que pode sair, sai. Puro, sem o SDK: testável com fixtures.
 */

export type Frame = {
  filename?: string; function?: string; module?: string; lineno?: number; colno?: number; in_app?: boolean; abs_path?: string;
  vars?: unknown; context_line?: string; pre_context?: string[]; post_context?: string[];
};
export type Breadcrumb = { category?: string; type?: string; level?: string; message?: string; timestamp?: number; data?: Record<string, unknown> };
export type EventoSentry = {
  message?: unknown;
  logentry?: unknown;
  request?: Record<string, unknown>;
  user?: Record<string, unknown>;
  exception?: { values?: { type?: string; value?: string; mechanism?: unknown; stacktrace?: { frames?: Frame[] } }[] };
  breadcrumbs?: Breadcrumb[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  transaction?: string;
  [k: string]: unknown;
};

/** Classes do próprio código cuja mensagem é um texto fixo, sem dado do usuário. */
const MENSAGEM_SEGURA = new Set(['TenantContextError', 'CorpoGrandeError', 'CorpoLentoError']);
/** Mensagens de `captureMessage` que o próprio código manda (texto fixo). */
export const MENSAGENS_FIXAS: ReadonlySet<string> = new Set(['erro no navegador']);
export const TAGS_PERMITIDAS: ReadonlySet<string> = new Set(['request_id', 'tenant_id', 'papel', 'rota', 'tipo_rota', 'fila', 'motivo', 'digest', 'nome_erro']);
const CONTEXTOS_PERMITIDOS = new Set(['runtime', 'os', 'trace']);
const NOME_DE_CLASSE = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;
/** Parênteses: o `routePath` do onRequestError traz os grupos de rota (`/p/(portal)/plano/page`). Sem espaço, sem `?`/`=`/`@`. */
const VALOR_DE_TAG = /^[\w:./[\]()-]{1,100}$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const TOKEN = /^[A-Za-z0-9_-]{20,}$/;
const REMOVIDO = '[removido]';

/** Só o caminho, sem query nem fragmento; UUID → `:id`; segmento longo sem cara de palavra → `:token`; convites e links de consulta → `:token`. */
export function caminhoSeguro(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  let caminho: string;
  try {
    caminho = new URL(url, 'http://local.invalid').pathname;
  } catch {
    return REMOVIDO;
  }
  return caminho
    .split('/')
    .map((s) => s.replace(UUID, ':id'))
    .map((s) => (s !== ':id' && TOKEN.test(s) ? ':token' : s))
    .join('/')
    .replace(/^\/(convite(?:\/paciente)?|consulta)\/[^/]+/, '/$1/:token');
}

function origemSegura(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** `GET /painel/pacientes/<uuid>` → `GET /painel/pacientes/:id`. */
function transacaoSegura(t: string): string {
  const m = /^([A-Z]+) (.*)$/.exec(t);
  return m ? `${m[1]} ${caminhoSeguro(m[2])}` : (caminhoSeguro(t) ?? REMOVIDO);
}

export function filtrarBreadcrumb(b: Breadcrumb): Breadcrumb | null {
  if (b.category !== 'http' && b.category !== 'fetch') return null;
  const d = b.data ?? {};
  const data: Record<string, unknown> = {};
  if (typeof d.method === 'string') data.method = d.method;
  if (typeof d.status_code === 'number') data.status_code = d.status_code;
  const origem = origemSegura(d.url);
  if (origem) data.url = origem;
  const out: Breadcrumb = { category: b.category, data };
  if (b.type) out.type = b.type;
  if (b.level) out.level = b.level;
  if (b.timestamp) out.timestamp = b.timestamp;
  return out;
}

function textoDaMensagem(m: unknown): string | null {
  if (typeof m === 'string') return m;
  if (m && typeof m === 'object') {
    const o = m as { formatted?: unknown; message?: unknown };
    if (typeof o.formatted === 'string') return o.formatted;
    if (typeof o.message === 'string') return o.message;
  }
  return null;
}

export function filtrarEvento<E extends EventoSentry>(e: E): E {
  const out: EventoSentry = { ...e };
  delete out.extra;
  delete out.logentry;
  if (out.message !== undefined) {
    const t = textoDaMensagem(out.message);
    out.message = t !== null && MENSAGENS_FIXAS.has(t) ? t : REMOVIDO;
  }
  if (out.request) {
    const r = out.request;
    out.request = {
      ...(typeof r.method === 'string' ? { method: r.method } : {}),
      ...(typeof r.url === 'string' ? { url: caminhoSeguro(r.url) } : {}),
    };
  }
  if (out.user) {
    const id = out.user.id;
    if (typeof id === 'string' || typeof id === 'number') out.user = { id: String(id) };
    else delete out.user;
  }
  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => {
        const tipo = v.type && NOME_DE_CLASSE.test(v.type) ? v.type : 'Error';
        const valor = MENSAGEM_SEGURA.has(tipo) && typeof v.value === 'string' ? v.value.slice(0, 200) : REMOVIDO;
        const frames = v.stacktrace?.frames?.map(({ vars: _v, context_line: _c, pre_context: _a, post_context: _p, ...f }) => f);
        return { ...v, type: tipo, value: valor, ...(frames ? { stacktrace: { frames } } : {}) };
      }),
    };
  }
  if (out.breadcrumbs) out.breadcrumbs = out.breadcrumbs.map(filtrarBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  if (out.tags) {
    out.tags = Object.fromEntries(Object.entries(out.tags).filter(([k, v]) => TAGS_PERMITIDAS.has(k) && typeof v === 'string' && VALOR_DE_TAG.test(v)));
  }
  if (out.contexts) out.contexts = Object.fromEntries(Object.entries(out.contexts).filter(([k]) => CONTEXTOS_PERMITIDOS.has(k)));
  if (typeof out.transaction === 'string') out.transaction = transacaoSegura(out.transaction);
  return out as E;
}
```

Run: `pnpm test src/lib/sentry-filtro.test.ts` → PASS.

- [ ] **Step 3: `request_id` (teste e módulo)** — `src/lib/request-id.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { novoRequestId, requestIdDe } from './request-id';

describe('request_id (RNF-11)', () => {
  it('novo id é um UUID v4 e aceito por requestIdDe', () => {
    const id = novoRequestId();
    expect(requestIdDe(id)).toBe(id);
  });
  it.each([null, undefined, '', 'abc', '<script>', `${novoRequestId()} x`])('recusa %s', (v) => expect(requestIdDe(v)).toBeNull());
  it('lista de valores (cabeçalho repetido): usa o primeiro, se válido', () => {
    const id = novoRequestId();
    expect(requestIdDe([id, 'outro'])).toBe(id);
  });
});
```

`src/lib/request-id.ts`

```ts
/** RNF-11 (D2): id por requisição, gerado no proxy (sobrescreve o do cliente) e devolvido em `x-request-id`. */
export const CABECALHO_REQUEST_ID = 'x-request-id';
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const novoRequestId = (): string => crypto.randomUUID();

/** O id que o proxy gravou (formato conferido: nunca entra no log um valor arbitrário). */
export function requestIdDe(v: string | string[] | null | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && UUID_V4.test(s) ? s : null;
}
```

Run: `pnpm test src/lib/request-id.test.ts` → PASS.

- [ ] **Step 4: Teste do proxy (falha)** — acrescentar ao fim do `describe` de `src/proxy.test.ts`:

```ts
  it('D2: página e Server Action ganham x-request-id novo (repassado e devolvido), sobrescrevendo o do cliente', () => {
    for (const url of ['http://localhost:3100/entrar', 'http://localhost:3100/painel/pacientes?busca=ana']) {
      const res = proxy(new NextRequest(url, { headers: { 'x-request-id': 'forjado', cookie: 'nd.session_token=abc.def' } }));
      const repassado = res.headers.get('x-middleware-request-x-request-id');
      expect(repassado, url).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.headers.get('x-request-id'), url).toBe(repassado);
    }
  });

  it('D2: o matcher continua sem /api (o Next bufferizaria o corpo, com corte em 10 MB) e fora de estáticos e do service worker', async () => {
    const { config } = await import('./proxy');
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test('/entrar')).toBe(true);
    expect(re.test('/painel/pacientes/x/exames')).toBe(true); // a página, não a API
    for (const fora of ['/api/health', '/api/painel/pacientes/x/exames', '/api/p/diario', '/api/erro-cliente', '/_next/static/chunks/a.js', '/serwist/sw.js']) {
      expect(re.test(fora), fora).toBe(false);
    }
  });
```

Run: `pnpm test src/proxy.test.ts` → FAIL (sem `x-request-id`).

- [ ] **Step 5: Proxy com `request_id`** — `src/proxy.ts` (a Tarefa 4 acrescenta a CSP neste mesmo arquivo)

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { CABECALHO_REQUEST_ID, novoRequestId } from '@/lib/request-id';
import { CURRENT_PATH_HEADER } from '@/lib/safe-return';

const PROTECTED = ['/admin', '/painel', '/p', '/conta', '/inicio'];

/** Caminho + query da página pedida, sem o `_rsc` interno das navegações do App Router. */
function currentPath(req: NextRequest): string {
  const params = new URLSearchParams(req.nextUrl.search);
  params.delete('_rsc');
  const qs = params.toString();
  return qs ? `${req.nextUrl.pathname}?${qs}` : req.nextUrl.pathname;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = novoRequestId(); // D2: o do cliente nunca é usado
  // /api/* não passa por aqui (matcher): o id das APIs nasce no onRequestError (Tarefa 2)
  const current = currentPath(req);
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !getSessionCookie(req, { cookiePrefix: 'nd' })) {
    const url = new URL('/entrar', req.url);
    url.searchParams.set('volta', current); // /entrar valida com safeReturnPath
    return NextResponse.redirect(url);
  }
  // Repassa o caminho atual para requireUser (sessão expirada → /entrar mantendo o ?volta)
  const headers = new Headers(req.headers);
  headers.set(CURRENT_PATH_HEADER, current);
  headers.set(CABECALHO_REQUEST_ID, requestId);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(CABECALHO_REQUEST_ID, requestId);
  return res;
}

// D2: `api/` continua fora — o Next copia para a memória o corpo de toda requisição que passa pelo proxy, com corte
// silencioso em 10 MB (proxyClientMaxBodySize.md): o exame de até 20 MB (US-015) chegaria cortado e o lerCorpoLimitado
// das rotas sem login só agiria depois de o Next já ter guardado o corpo. Não aumentar o proxyClientMaxBodySize.
export const config = {
  matcher: ['/((?!api/|serwist/|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)'],
};
```

Run: `pnpm test src/proxy.test.ts` → PASS. `pnpm typecheck && pnpm lint` → sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sentry-filtro.ts src/lib/sentry-filtro.test.ts src/lib/request-id.ts src/lib/request-id.test.ts src/proxy.ts src/proxy.test.ts
git commit -m "feat(observabilidade): filtro único dos eventos do Sentry e request_id em toda requisição (RNF-11, D2)"
```

---

### Task 2: Sentry no app e no worker, erros do navegador e limite em memória (P08-01 b; RNF-11)

**Files:**
- Create: `src/lib/sentry.ts`, `src/lib/sentry.test.ts`, `src/lib/sentry-guarda.test.ts`, `src/lib/limite-memoria.ts`, `src/lib/limite-memoria.test.ts`, `src/instrumentation.ts`, `src/app/global-error.tsx`, `src/app/error.tsx`, `src/components/reportar-erro.ts`, `src/app/api/erro-cliente/route.ts`, `src/app/api/erro-cliente/route.test.ts`
- Modify: `package.json` / `pnpm-lock.yaml` (`@sentry/node`), `src/env.ts` (+ `src/env.test.ts`), `.env.example`, `src/worker/index.ts`, `src/worker/sem-detalhe.ts` (do PR #11)

**Interfaces:**
- Consumes: `filtrarEvento`, `filtrarBreadcrumb`, `caminhoSeguro` (T1); `requestIdDe` (T1); `nomeDoErro`, `logger` (`src/lib/logger.ts`); `motivoDoErro` (`armazenamento.ts`); `semDetalhe`/`workSemDetalhe` (`src/worker/sem-detalhe.ts`, PR #11); `mesmaOrigem` (`src/lib/mesma-origem.ts`, Plano 07 S-9); `clientIpDoLimite` (`src/lib/ip.ts`: IPv6 pelo /64, a regra do limite de tentativas — RN-16), `getEnv().TRUSTED_PROXIES`.
- Produces:
  - `@/lib/sentry`: `opcoesDoSentry(o: { dsn: string; ambiente: string; papel: 'app' | 'worker'; release?: string }): NodeOptions`, `iniciarSentry(o: { dsn?: string; ambiente: string; papel: 'app' | 'worker'; release?: string; transport?: NodeOptions['transport'] }): boolean`, `capturarErro(err: unknown, tags: Record<string, string>): void`, `registrarErroDaRequisicao(err: unknown, r: { requestId: string | null; rota: string; tipoRota: string }): void`, `capturarErroDoNavegador(e: { digest: string | null; nome: string; rota: string }): void`, `encerrarSentry(): Promise<void>`.
  - `@/lib/limite-memoria`: `criarLimite(o: { janelaMs: number; max: number }): { permitir(chave: string, agora?: number): boolean }`, `MSG_MUITAS_TENTATIVAS = 'Muitas tentativas. Tente de novo em alguns minutos.'`.
  - `@/components/reportar-erro`: `reportarErro(error: Error & { digest?: string }): void` (cliente).
  - Env: `SENTRY_DSN` (opcional, app e worker), `SENTRY_ENVIRONMENT` (opcional, padrão `producao`).

- [ ] **Step 1: Dependência** — conferir a versão estável atual e fixar exata (como o resto do `package.json`):

```bash
pnpm view @sentry/node version     # anotar, ex.: 11.x.y (11.4.0 em 04/10/2026)
pnpm add --save-exact @sentry/node@<versão anotada>
```

Conferir no log do último CI a folga do passo "Orçamento da imagem" (limite 260 MB comprimidos). Se a imagem passar do limite com o SDK, parar e avisar o dono (alternativa: GlitchTip/D1, ou podar dependências opcionais do SDK).

- [ ] **Step 2: Limite em memória (teste e módulo)** — `src/lib/limite-memoria.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { criarLimite } from './limite-memoria';

describe('criarLimite (1 réplica do app — D10)', () => {
  it('permite até max por janela e volta a permitir depois dela', () => {
    const l = criarLimite({ janelaMs: 1000, max: 2 });
    expect([l.permitir('a', 0), l.permitir('a', 10), l.permitir('a', 20)]).toEqual([true, true, false]);
    expect(l.permitir('b', 20)).toBe(true); // outra chave, outro balde
    expect(l.permitir('a', 1001)).toBe(true);
  });
  it('não cresce sem limite: chaves vencidas saem na varredura', () => {
    const l = criarLimite({ janelaMs: 10, max: 1 });
    for (let i = 0; i < 5000; i++) l.permitir(`k${i}`, 0);
    l.permitir('nova', 100);
    expect(l.tamanho()).toBe(1);
  });
});
```

`src/lib/limite-memoria.ts`

```ts
export const MSG_MUITAS_TENTATIVAS = 'Muitas tentativas. Tente de novo em alguns minutos.';

/**
 * Janela fixa por chave, em memória do processo (D10). Correto com 1 réplica do app — escalar para 2+ réplicas muda o
 * limite (anotado no fechamento). Uma varredura das chaves vencidas por janela: o mapa não cresce sem fim.
 */
export function criarLimite(o: { janelaMs: number; max: number }) {
  const baldes = new Map<string, { inicio: number; n: number }>();
  let ultimaVarredura = 0;
  return {
    permitir(chave: string, agora: number = Date.now()): boolean {
      if (agora - ultimaVarredura >= o.janelaMs) {
        for (const [k, b] of baldes) if (agora - b.inicio >= o.janelaMs) baldes.delete(k);
        ultimaVarredura = agora;
      }
      const b = baldes.get(chave);
      if (!b || agora - b.inicio >= o.janelaMs) {
        baldes.set(chave, { inicio: agora, n: 1 });
        return true;
      }
      if (b.n >= o.max) return false;
      b.n++;
      return true;
    },
    tamanho: () => baldes.size,
  };
}
```

Run: `pnpm test src/lib/limite-memoria.test.ts` → PASS.

- [ ] **Step 3: Variáveis** — `src/env.ts`: em `appSchema` e em `workerSchema`, depois de `VAPID_PUBLIC_KEY`:

```ts
    // P08-01 (D1): sem DSN, o Sentry fica desligado (como o WhatsApp). Só https.
    SENTRY_DSN: opcional(z.url({ message: 'SENTRY_DSN deve ser uma URL' }).refine((v) => v.startsWith('https://'), { message: 'SENTRY_DSN deve começar com https://' }).optional()),
    SENTRY_ENVIRONMENT: opcional(z.string().regex(/^[a-z0-9-]{1,30}$/, { message: 'SENTRY_ENVIRONMENT: letras minúsculas, números e hífen' }).optional()),
```

`src/env.test.ts` — acrescentar:

```ts
  it('P08-01: SENTRY_DSN é opcional, só https; vazio = desligado', () => {
    expect(parseEnv({ ...base, SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined();
    expect(parseEnv({ ...base, SENTRY_DSN: 'https://abc@o1.ingest.de.sentry.io/2' }).SENTRY_DSN).toBe('https://abc@o1.ingest.de.sentry.io/2');
    expect(() => parseEnv({ ...base, SENTRY_DSN: 'http://abc@o1.ingest.sentry.io/2' })).toThrow('SENTRY_DSN deve começar com https://');
  });
```

(`base` é o objeto de ambiente válido que `src/env.test.ts` já declara no topo). `.env.example`: trocar as linhas vazias `SENTRY_DSN=`/`SENTRY_AUTH_TOKEN=` por `SENTRY_DSN=` e `SENTRY_ENVIRONMENT=` com o comentário `# P08-01: DSN do projeto no Sentry (plano gratuito). Vazio = desligado. SENTRY_AUTH_TOKEN não é usado (sem source maps do navegador, D1).`

- [ ] **Step 4: Testes do módulo do Sentry (falham)** — `src/lib/sentry.test.ts`

```ts
import * as Sentry from '@sentry/node';
import { afterEach, describe, expect, it } from 'vitest';
import { capturarErro, encerrarSentry, iniciarSentry, opcoesDoSentry, registrarErroDaRequisicao } from './sentry';
import { filtrarBreadcrumb, filtrarEvento } from './sentry-filtro';

const DSN = 'https://chave@o0.ingest.sentry.io/0';

/** Transporte falso: guarda os envelopes em texto (nada sai da máquina). */
function transporteFalso(enviados: string[]) {
  return () => ({
    send: async (envelope: unknown) => {
      enviados.push(JSON.stringify(envelope, (_k, v) => (v instanceof Uint8Array ? new TextDecoder().decode(v) : v)));
      return {};
    },
    flush: async () => true,
  });
}

afterEach(async () => {
  await encerrarSentry();
});

describe('Sentry (P08-01, D1)', () => {
  it('opções: filtro em tudo, sem PII, sem tracing, sem variáveis locais', () => {
    const o = opcoesDoSentry({ dsn: DSN, ambiente: 'producao', papel: 'app' });
    expect(o.beforeSend?.({ message: 'Ana Souza', user: { email: 'ana@ex.com', id: 'u1' } } as never, {} as never)).toEqual(filtrarEvento({ message: 'Ana Souza', user: { email: 'ana@ex.com', id: 'u1' } }));
    expect(o.beforeBreadcrumb?.({ category: 'console', message: 'Ana Souza' } as never, {} as never)).toBeNull();
    expect(filtrarBreadcrumb({ category: 'console' })).toBeNull();
    expect(o.beforeSendTransaction?.({} as never, {} as never)).toBeNull();
    expect(o).toMatchObject({ dsn: DSN, environment: 'producao', sendDefaultPii: false, includeLocalVariables: false, tracePropagationTargets: [] });
    // v8+: tracesSampleRate 0 NÃO desliga o tracing (só não envia); desligado = a chave ausente (docs.sentry.io, "Disabling Tracing")
    expect('tracesSampleRate' in o).toBe(false);
    expect('tracesSampler' in o).toBe(false);
    expect(o.initialScope).toMatchObject({ tags: { papel: 'app' } });
  });

  it('sem DSN não liga (e capturarErro não faz nada)', () => {
    expect(iniciarSentry({ dsn: undefined, ambiente: 'producao', papel: 'worker' })).toBe(false);
    expect(() => capturarErro(new Error('x'), { fila: 'email' })).not.toThrow();
  });

  it('envelope real do SDK: o erro com texto de saúde sai limpo; tags permitidas ficam', async () => {
    const enviados: string[] = [];
    expect(iniciarSentry({ dsn: DSN, ambiente: 'teste', papel: 'worker', transport: transporteFalso(enviados) as never })).toBe(true);
    Sentry.addBreadcrumb({ category: 'console', message: 'Ana Souza' });
    capturarErro(new Error('Glicemia 180 de Ana Souza (ana@ex.com)'), { fila: 'exportacao-paciente', motivo: 'ENOENT' });
    await Sentry.flush(2000);
    const tudo = enviados.join('\n');
    expect(tudo).toContain('exportacao-paciente');
    expect(tudo).toContain('[removido]');
    for (const t of ['Glicemia', 'Ana Souza', 'ana@ex.com']) expect(tudo).not.toContain(t);
  });

  it('erro de requisição: request_id e rota (padrão) como tags; mensagem removida', async () => {
    const enviados: string[] = [];
    iniciarSentry({ dsn: DSN, ambiente: 'teste', papel: 'app', transport: transporteFalso(enviados) as never });
    registrarErroDaRequisicao(Object.assign(new Error('anamnese: diabetes tipo 2'), { digest: '123456' }), {
      requestId: '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b',
      rota: '/painel/pacientes/[id]',
      tipoRota: 'render',
    });
    await Sentry.flush(2000);
    const tudo = enviados.join('\n');
    expect(tudo).toContain('0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b');
    expect(tudo).toContain('/painel/pacientes/[id]');
    expect(tudo).not.toContain('diabetes');
  });
});
```

Run: `pnpm test src/lib/sentry.test.ts` → FAIL (Cannot find module './sentry').

- [ ] **Step 5: O módulo** — `src/lib/sentry.ts`

```ts
import * as Sentry from '@sentry/node';
import type { NodeOptions } from '@sentry/node';
import { logger, nomeDoErro } from './logger';
import { filtrarBreadcrumb, filtrarEvento, type Breadcrumb, type EventoSentry } from './sentry-filtro';

type Papel = 'app' | 'worker';
let ligado = false;

/**
 * D1 / RNF-11: as únicas opções com que o Sentry sobe (guarda em sentry-guarda.test.ts). Sem PII, sem variáveis locais
 * na pilha, sem Replay (o SDK de Node nem tem). Todo evento passa pelo filtro.
 * Sem tracing: no @sentry/node v8+ a taxa de amostragem igual a zero NÃO desliga o tracing (liga a instrumentação
 * OpenTelemetry e só deixa de enviar); desligado é não declarar a taxa nem o amostrador (docs.sentry.io, "Disabling
 * Tracing"). E tracePropagationTargets vazio: no servidor o padrão propaga sentry-trace/baggage para toda requisição
 * de saída (Resend, Evolution, FCM/APNs, oEmbed) — nenhum cabeçalho do Sentry sai para terceiros.
 */
export function opcoesDoSentry(o: { dsn: string; ambiente: string; papel: Papel; release?: string }): NodeOptions {
  return {
    dsn: o.dsn,
    environment: o.ambiente,
    release: o.release,
    sendDefaultPii: false,
    includeLocalVariables: false,
    tracePropagationTargets: [],
    maxBreadcrumbs: 30,
    // os tipos do SDK são interfaces sem assinatura de índice: o filtro trabalha no formato mínimo (EventoSentry)
    beforeSend: (e) => filtrarEvento(e as unknown as EventoSentry) as unknown as typeof e,
    beforeSendTransaction: () => null,
    beforeBreadcrumb: (b) => filtrarBreadcrumb(b as Breadcrumb) as typeof b | null,
    initialScope: { tags: { papel: o.papel } },
  };
}

/** Liga o Sentry se houver DSN. Devolve se ligou. `transport` só nos testes. */
export function iniciarSentry(o: { dsn?: string; ambiente: string; papel: Papel; release?: string; transport?: NodeOptions['transport'] }): boolean {
  if (!o.dsn) return false;
  Sentry.init({ ...opcoesDoSentry({ dsn: o.dsn, ambiente: o.ambiente, papel: o.papel, release: o.release }), ...(o.transport ? { transport: o.transport } : {}) });
  ligado = true;
  logger.info({ papel: o.papel }, 'sentry ligado'); // nunca o DSN
  return true;
}

export function capturarErro(err: unknown, tags: Record<string, string>): void {
  if (!ligado) return;
  Sentry.captureException(err, { tags });
}

/** `onRequestError` do Next (instrumentation.ts): uma linha de log com o id e o Sentry com as mesmas tags. */
export function registrarErroDaRequisicao(err: unknown, r: { requestId: string | null; rota: string; tipoRota: string }): void {
  const digest = typeof err === 'object' && err !== null && 'digest' in err ? String((err as { digest: unknown }).digest).slice(0, 40) : undefined;
  logger.error({ request_id: r.requestId, rota: r.rota, digest, erro: nomeDoErro(err) }, 'erro na requisição');
  const tags: Record<string, string> = { rota: r.rota, tipo_rota: r.tipoRota };
  if (r.requestId) tags.request_id = r.requestId;
  if (digest) tags.digest = digest;
  capturarErro(err, tags);
}

/** Erro do navegador (rota /api/erro-cliente): só digest, nome e rota — nunca texto. */
export function capturarErroDoNavegador(e: { digest: string | null; nome: string; rota: string }): void {
  logger.warn({ digest: e.digest, nome_erro: e.nome, rota: e.rota }, 'erro no navegador');
  if (!ligado) return;
  Sentry.captureMessage('erro no navegador', { level: 'error', tags: { nome_erro: e.nome, rota: e.rota, ...(e.digest ? { digest: e.digest } : {}) } });
}

export async function encerrarSentry(): Promise<void> {
  if (!ligado) return;
  await Sentry.close(2000);
  ligado = false;
}
```

Run: `pnpm test src/lib/sentry.test.ts` → PASS. Se o tipo do transporte falso não bater com `NodeOptions['transport']` na versão instalada, ajustar só o `as never` do teste (o comportamento é o mesmo).

- [ ] **Step 6: Guarda estática** — `src/lib/sentry-guarda.test.ts`

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// D1 / RNF-11: o Sentry sobe num lugar só (com o filtro), nunca no navegador e nunca com Replay.
const ARQUIVOS = readdirSync(path.resolve('src'), { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && /\.(ts|tsx)$/.test(d.name) && !d.name.endsWith('.test.ts'))
  .map((d) => path.join(d.parentPath, d.name));

describe('guarda do Sentry', () => {
  it('Sentry.init só em src/lib/sentry.ts', () => {
    const com = ARQUIVOS.filter((f) => /Sentry\.init\(/.test(readFileSync(f, 'utf8'))).map((f) => path.relative(process.cwd(), f));
    expect(com).toEqual(['src/lib/sentry.ts']);
  });
  it('nenhum SDK de navegador, Replay ou tracing', () => {
    for (const f of ARQUIVOS) {
      const s = readFileSync(f, 'utf8');
      // a chave de amostragem é proibida com qualquer valor: no v8+ até o zero liga a instrumentação de tracing
      expect(s, f).not.toMatch(/@sentry\/(nextjs|browser|react)|replayIntegration|browserTracingIntegration|\btraces(SampleRate|Sampler)\s*:/);
    }
  });
  it('@sentry/node não é importado por componente de cliente', () => {
    for (const f of ARQUIVOS) {
      const s = readFileSync(f, 'utf8');
      if (/^['"]use client['"]/m.test(s)) expect(s, f).not.toMatch(/@sentry\/|@\/lib\/sentry/);
    }
  });
});
```

Run: `pnpm test src/lib/sentry-guarda.test.ts` → PASS.

- [ ] **Step 7: App (`instrumentation.ts`)** — `src/instrumentation.ts`

```ts
import type { Instrumentation } from 'next';

/** P08-01: o Sentry do servidor (só no runtime Node). Sem SENTRY_DSN, nada liga. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { getEnv } = await import('./env');
  const { iniciarSentry } = await import('./lib/sentry');
  const env = getEnv();
  iniciarSentry({ dsn: env.SENTRY_DSN, ambiente: env.SENTRY_ENVIRONMENT ?? 'producao', papel: 'app' });
}

/** Todo erro de página, ação ou Route Handler: log com o request_id e o Sentry (filtrado). */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [{ registrarErroDaRequisicao }, { novoRequestId, requestIdDe }] = await Promise.all([import('./lib/sentry'), import('./lib/request-id')]);
  // D2: páginas e ações passam pelo proxy, que sobrescreve o x-request-id do cliente — esse id vale. /api/* e /serwist/*
  // ficam fora do matcher: lá o cabeçalho viria do cliente (forjável), então o id nasce aqui, sempre novo.
  const foraDoProxy = /^\/(api|serwist)\//.test(request.path);
  const requestId = (foraDoProxy ? null : requestIdDe(request.headers['x-request-id'])) ?? novoRequestId();
  registrarErroDaRequisicao(err, { requestId, rota: context.routePath, tipoRota: context.routeType });
};
```

- [ ] **Step 8: Worker** — `src/worker/index.ts`, no início de `startWorker(env)` (antes do `new PgBoss`):

```ts
  iniciarSentry({ dsn: env.SENTRY_DSN, ambiente: env.SENTRY_ENVIRONMENT ?? 'producao', papel: 'worker' });
```

e, na função de parada, antes de `closeDb()`: `await encerrarSentry();`. Import: `import { encerrarSentry, iniciarSentry } from '@/lib/sentry';`.

`src/worker/sem-detalhe.ts` (PR #11) — no `catch` de `semDetalhe`, antes de relançar:

```ts
    } catch (err) {
      capturarErro(err, { fila, motivo: motivoDoErro(err) }); // o original: o filtro tira a mensagem (T1)
      throw erroSemDetalhe(fila, err);
    }
```

com `import { capturarErro } from '@/lib/sentry';`. `src/worker/sem-detalhe.test.ts`: acrescentar o caso "o erro original vai para capturarErro com a fila e o motivo" com `vi.mock('@/lib/sentry', () => ({ capturarErro: vi.fn() }))` e `expect(capturarErro).toHaveBeenCalledWith(expect.any(Error), { fila: 'email', motivo: 'ENOENT' })` para um erro com `code: 'ENOENT'`.

- [ ] **Step 9: Erros do navegador** — teste da rota primeiro, `src/app/api/erro-cliente/route.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const capturar = vi.fn();
vi.mock('@/lib/sentry', () => ({ capturarErroDoNavegador: (e: unknown) => capturar(e) }));
const { POST } = await import('./route');

const req = (corpo: string, h: Record<string, string> = {}) =>
  new Request('http://localhost:3000/api/erro-cliente', { method: 'POST', headers: { origin: 'http://localhost:3000', 'x-forwarded-for': `10.7.${Math.floor(Math.random() * 250)}.1`, ...h }, body: corpo });

beforeEach(() => capturar.mockReset());

describe('POST /api/erro-cliente (D1)', () => {
  it('204 e repassa só digest, nome e rota segura', async () => {
    const r = await POST(req(JSON.stringify({ digest: '1234567', nome: 'TypeError', rota: '/painel/pacientes/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b?busca=Ana' })));
    expect(r.status).toBe(204);
    expect(capturar).toHaveBeenCalledWith({ digest: '1234567', nome: 'TypeError', rota: '/painel/pacientes/:id' });
  });
  it.each([
    ['outra origem', JSON.stringify({ nome: 'TypeError', rota: '/p' }), { origin: 'https://evil.test' }, 403],
    ['corpo grande', JSON.stringify({ nome: 'TypeError', rota: `/${'a'.repeat(3000)}` }), {}, 413],
    ['JSON inválido', '{', {}, 400],
    ['nome com texto livre', JSON.stringify({ nome: 'Glicemia 180', rota: '/p' }), {}, 400],
    ['digest fora do formato', JSON.stringify({ digest: 'Ana Souza', nome: 'Error', rota: '/p' }), {}, 400],
  ])('%s → %i e nada vai ao Sentry', async (_n, corpo, h, status) => {
    expect((await POST(req(corpo, h as Record<string, string>))).status).toBe(status);
    expect(capturar).not.toHaveBeenCalled();
  });
  it('limite por IP: a 21ª no mesmo minuto dá 429', async () => {
    const ip = { 'x-forwarded-for': '10.8.8.8' };
    const corpo = JSON.stringify({ nome: 'Error', rota: '/p' });
    for (let i = 0; i < 20; i++) await POST(req(corpo, ip));
    expect((await POST(req(corpo, ip))).status).toBe(429);
  });
});
```

(Se `clientIpDoLimite` ignorar o `x-forwarded-for` sem `TRUSTED_PROXIES` no ambiente de teste, o último caso vira: todas as requisições sem IP caem no balde `sem-ip`; o teste continua válido com o mesmo balde — ajustar só o nome do caso.)

`src/app/api/erro-cliente/route.ts`

```ts
import { z } from 'zod';
import { getEnv } from '@/env';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { clientIpDoLimite } from '@/lib/ip';
import { criarLimite } from '@/lib/limite-memoria';
import { mesmaOrigem } from '@/lib/mesma-origem';
import { capturarErroDoNavegador } from '@/lib/sentry';
import { caminhoSeguro } from '@/lib/sentry-filtro';

export const dynamic = 'force-dynamic';

const CORPO_MAX = 1024;
const limite = criarLimite({ janelaMs: 60_000, max: 20 });
const schema = z.object({
  digest: z.string().regex(/^[A-Za-z0-9]{1,40}$/).optional(),
  nome: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,59}$/),
  rota: z.string().startsWith('/').max(500),
});
const vazio = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** D1: o navegador manda só digest, nome do erro e rota (reportarErro); o texto do erro nunca sai do aparelho. */
export async function POST(req: Request): Promise<Response> {
  if (!mesmaOrigem(req)) return vazio(403);
  // balde pelo /64 no IPv6 (clientIpDoLimite): com clientIp (/128) quem tem um /64 inteiro trocaria de balde a cada pedido
  if (!limite.permitir(clientIpDoLimite(req.headers, getEnv().TRUSTED_PROXIES) ?? 'sem-ip')) return vazio(429);
  let dados: unknown;
  try {
    dados = JSON.parse(new TextDecoder().decode(await lerCorpoLimitado(req, CORPO_MAX)));
  } catch (e) {
    return vazio(e instanceof CorpoGrandeError ? 413 : 400);
  }
  const p = schema.safeParse(dados);
  if (!p.success) return vazio(400);
  capturarErroDoNavegador({ digest: p.data.digest ?? null, nome: p.data.nome, rota: caminhoSeguro(p.data.rota) ?? '/' });
  return vazio(204);
}
```

(Conferir a assinatura de `mesmaOrigem` criada pelo Plano 07 — S-9; se ela devolver uma `Response` de recusa em vez de booleano, usar o retorno dela.)

`src/components/reportar-erro.ts`

```ts
'use client';

/** D1: avisa o servidor de um erro no navegador — só o digest, o nome da classe e o caminho (nunca a mensagem). */
export function reportarErro(error: Error & { digest?: string }): void {
  try {
    const corpo = JSON.stringify({ digest: error.digest, nome: /^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(error.name) ? error.name : 'Error', rota: location.pathname });
    if (!navigator.sendBeacon?.('/api/erro-cliente', new Blob([corpo], { type: 'application/json' }))) {
      void fetch('/api/erro-cliente', { method: 'POST', body: corpo, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch {
    // relatar erro nunca pode gerar outro erro
  }
}
```

`src/app/error.tsx`

```tsx
'use client';

import { useEffect } from 'react';
import { reportarErro } from '@/components/reportar-erro';

export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportarErro(error), [error]);
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Algo deu errado.</h1>
      <button type="button" onClick={reset} className="min-h-11 rounded border px-4">
        Tentar de novo
      </button>
    </main>
  );
}
```

`src/app/global-error.tsx`

```tsx
'use client';

import { useEffect } from 'react';
import { reportarErro } from '@/components/reportar-erro';

export default function ErroGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportarErro(error), [error]);
  return (
    <html lang="pt-BR">
      <body>
        <main style={{ maxWidth: 480, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <h1>Algo deu errado.</h1>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: '0 16px' }}>
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
```

Run: `pnpm test src/app/api/erro-cliente src/lib src/worker src/env.test.ts` → PASS. `pnpm typecheck && pnpm lint && pnpm build` → sem erros.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml src/env.ts src/env.test.ts .env.example src/lib/sentry.ts src/lib/sentry.test.ts src/lib/sentry-guarda.test.ts src/lib/limite-memoria.ts src/lib/limite-memoria.test.ts src/instrumentation.ts src/worker/index.ts src/worker/sem-detalhe.ts src/worker/sem-detalhe.test.ts src/app/api/erro-cliente src/components/reportar-erro.ts src/app/error.tsx src/app/global-error.tsx
git commit -m "feat(observabilidade): Sentry no app e no worker com o filtro de dado de saúde, erros do navegador por rota própria (P08-01, D1)"
```

---

### Task 3: `/api/health` com o motivo certo e E2E (P08-02, parte de código; RNF-04)

**Files:**
- Modify: `src/worker/heartbeat.ts`, `src/worker/heartbeat.test.ts`, `src/app/api/health/route.ts`
- Create: `e2e/health.spec.ts`

**Interfaces:**
- Consumes: `systemHeartbeat`, `getDb`.
- Produces: `evaluateHealth(i: { dbOk: boolean; heartbeatLido: boolean; lastBeat: Date | null; now: Date })` com o motivo novo `'heartbeat ilegível'` (nota N5 do Plano 02).

- [ ] **Step 1: Teste (falha)** — `src/worker/heartbeat.test.ts`, acrescentar:

```ts
describe('evaluateHealth — motivos (N5, P08-02)', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  it('banco fora: "banco indisponível"', () => {
    expect(evaluateHealth({ dbOk: false, heartbeatLido: false, lastBeat: null, now })).toEqual({ status: 'degradado', reason: 'banco indisponível' });
  });
  it('banco ok, leitura do heartbeat falhou: "heartbeat ilegível" (não "banco indisponível")', () => {
    expect(evaluateHealth({ dbOk: true, heartbeatLido: false, lastBeat: null, now })).toEqual({ status: 'degradado', reason: 'heartbeat ilegível' });
  });
  it('heartbeat de 9 min: ok; de 11 min: degradado', () => {
    expect(evaluateHealth({ dbOk: true, heartbeatLido: true, lastBeat: new Date(now.getTime() - 9 * 60_000), now }).status).toBe('ok');
    expect(evaluateHealth({ dbOk: true, heartbeatLido: true, lastBeat: new Date(now.getTime() - 11 * 60_000), now }).reason).toBe('worker sem heartbeat há mais de 10 min');
  });
});
```

Atualizar as chamadas antigas de `evaluateHealth` no mesmo arquivo com `heartbeatLido: true`. Run: `pnpm test src/worker/heartbeat.test.ts` → FAIL (tipo e motivo novos).

- [ ] **Step 2: Implementação** — `src/worker/heartbeat.ts`, trocar `evaluateHealth`:

```ts
export function evaluateHealth(i: { dbOk: boolean; heartbeatLido: boolean; lastBeat: Date | null; now: Date }): {
  status: 'ok' | 'degradado';
  reason?: string;
} {
  if (!i.dbOk) return { status: 'degradado', reason: 'banco indisponível' };
  if (!i.heartbeatLido) return { status: 'degradado', reason: 'heartbeat ilegível' };
  if (!i.lastBeat) return { status: 'degradado', reason: 'worker sem heartbeat' };
  if (i.now.getTime() - i.lastBeat.getTime() > HEARTBEAT_MAX_AGE_MS) {
    return { status: 'degradado', reason: 'worker sem heartbeat há mais de 10 min' };
  }
  return { status: 'ok' };
}
```

`src/app/api/health/route.ts`, trocar o corpo de `GET`:

```ts
export async function GET() {
  const db = getDb();
  let dbOk = false;
  let heartbeatLido = false;
  let lastBeat: Date | null = null;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
    const [row] = await db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, 'worker'));
    lastBeat = row?.beatAt ?? null;
    heartbeatLido = true;
  } catch {
    // dbOk diz qual das duas leituras falhou (N5)
  }
  const result = evaluateHealth({ dbOk, heartbeatLido, lastBeat, now: new Date() });
  return Response.json(result, {
    status: result.status === 'ok' ? 200 : 503,
    headers: { 'cache-control': 'no-store' },
  });
}
```

Run: `pnpm test src/worker/heartbeat.test.ts` → PASS.

- [ ] **Step 3: E2E** — `e2e/health.spec.ts`

```ts
import { expect, test } from '@playwright/test';

// RNF-04 / P08-02: o que o monitor externo confere — 200, "ok", sem cache. Sem x-request-id: /api/* fica fora do
// matcher do proxy (D2), o id das APIs só existe no log e no Sentry.
test('GET /api/health responde 200 {"status":"ok"} sem cache, com o worker no ar', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ status: 'ok' });
  expect(r.headers()['cache-control']).toBe('no-store');
});
```

Run: `pnpm build && pnpm test:e2e e2e/health.spec.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/worker/heartbeat.ts src/worker/heartbeat.test.ts src/app/api/health/route.ts e2e/health.spec.ts
git commit -m "fix(health): motivo 'heartbeat ilegível' separado de 'banco indisponível' e E2E do /api/health (P08-02, N5)"
```

O cadastro do monitor (D3) é passo do dono no runbook (passo 4).

---
### Task 4: Cabeçalhos de segurança e CSP com nonce (P08-05 a; RNF-06; notas N17–N19)

**Files:**
- Create: `src/lib/csp.ts`, `src/lib/csp.test.ts`, `src/app/api/csp-relatorio/route.ts`, `e2e/csp.spec.ts`
- Modify: `src/proxy.ts`, `src/proxy.test.ts`, `next.config.ts`, `src/app/layout.tsx`, `src/env.ts` (+ `src/env.test.ts`), `.env.example`

**Interfaces:**
- Consumes: `novoRequestId`, `CABECALHO_REQUEST_ID` (T1); `criarLimite` (T2); `clientIpDoLimite` (`src/lib/ip.ts`).
- Produces:
  - `@/lib/csp`: `montarCsp(o: { nonce: string; dev: boolean; https: boolean; modo: ModoCsp }): { nome: 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only'; valor: string }`, `novoNonce(): string`, `CABECALHOS_SEGURANCA: { key: string; value: string }[]`, `FRAMES_PERMITIDOS`, `ROTA_RELATORIO_CSP = '/api/csp-relatorio'`, tipo `ModoCsp = 'valendo' | 'relatorio'`.
  - Env: `CSP_MODO` (opcional, `valendo` | `relatorio`, padrão `valendo`).
  - Toda página: `Content-Security-Policy` com nonce novo a cada requisição; o cabeçalho `x-nonce` na requisição repassada (para quem precisar do nonce num `<Script>`).

- [ ] **Step 1: Testes da CSP (falham)** — `src/lib/csp.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { CABECALHOS_SEGURANCA, montarCsp, novoNonce } from './csp';

const diretiva = (csp: string, nome: string) => csp.split('; ').find((d) => d.startsWith(`${nome} `) || d === nome);

describe('CSP (RNF-06, D7)', () => {
  const { nome, valor } = montarCsp({ nonce: 'abc123', dev: false, https: true, modo: 'valendo' });
  it('vale de verdade, com nonce + strict-dynamic e o Turnstile como reserva', () => {
    expect(nome).toBe('Content-Security-Policy');
    expect(diretiva(valor, 'script-src')).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic' https://challenges.cloudflare.com");
  });
  it('frames só do YouTube sem cookies, do Vimeo e do Turnstile (Plano 07, D10)', () => {
    expect(diretiva(valor, 'frame-src')).toBe('frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com');
  });
  it.each([
    ["default-src 'self'"],
    ["img-src 'self' data: blob:"],
    ["connect-src 'self'"],
    ["object-src 'none'"],
    ["base-uri 'none'"],
    ["form-action 'self'"],
    ["frame-ancestors 'none'"],
    ["worker-src 'self'"],
    ['upgrade-insecure-requests'],
  ])('tem %s', (d) => expect(valor.split('; ')).toContain(d));
  it("sem 'unsafe-eval' em produção; com ele só em dev; sem upgrade-insecure-requests em http (E2E local)", () => {
    expect(valor).not.toContain('unsafe-eval');
    const dev = montarCsp({ nonce: 'n', dev: true, https: false, modo: 'valendo' }).valor;
    expect(diretiva(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(dev).not.toContain('upgrade-insecure-requests');
  });
  it('modo relatório: outro cabeçalho e report-uri da rota própria', () => {
    const r = montarCsp({ nonce: 'n', dev: false, https: true, modo: 'relatorio' });
    expect(r.nome).toBe('Content-Security-Policy-Report-Only');
    expect(r.valor).toContain('report-uri /api/csp-relatorio');
  });
  it('nonce: 128 bits em base64, diferente a cada chamada', () => {
    const [a, b] = [novoNonce(), novoNonce()];
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
  it('cabeçalhos globais (D8: HSTS sem includeSubDomains)', () => {
    expect(CABECALHOS_SEGURANCA).toEqual([
      { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
    ]);
  });
});
```

Run: `pnpm test src/lib/csp.test.ts` → FAIL (Cannot find module './csp').

- [ ] **Step 2: O módulo** — `src/lib/csp.ts`

```ts
/** RNF-06 (D7): CSP por nonce (guia content-security-policy.md do Next 16) e cabeçalhos globais (D8). */
export type ModoCsp = 'valendo' | 'relatorio';
export const ROTA_RELATORIO_CSP = '/api/csp-relatorio';
/** Plano 07 (D10): players sem cookies; INT-06: o widget do Turnstile. */
export const FRAMES_PERMITIDOS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://challenges.cloudflare.com'] as const;

export const novoNonce = (): string => Buffer.from(crypto.randomUUID()).toString('base64');

export function montarCsp(o: { nonce: string; dev: boolean; https: boolean; modo: ModoCsp }): {
  nome: 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only';
  valor: string;
} {
  const d = [
    "default-src 'self'",
    // 'strict-dynamic': o que um script com nonce carrega (o api.js do Turnstile pelo next/script) também vale;
    // o host do Turnstile fica como reserva para navegador sem strict-dynamic
    `script-src 'self' 'nonce-${o.nonce}' 'strict-dynamic' https://challenges.cloudflare.com${o.dev ? " 'unsafe-eval'" : ''}`,
    // atributos style do React (cor da marca, gráficos): não há como pôr nonce em atributo
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", // capas e logos locais (/api/arquivos), QR do 2FA (data:), prévia da foto do diário (blob:)
    "font-src 'self'", // next/font serve as fontes do próprio app
    "connect-src 'self'", // D1: o navegador não fala com o Sentry
    `frame-src ${FRAMES_PERMITIDOS.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (o.https) d.push('upgrade-insecure-requests');
  if (o.modo === 'relatorio') d.push(`report-uri ${ROTA_RELATORIO_CSP}`);
  return { nome: o.modo === 'relatorio' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', valor: d.join('; ') };
}

/** Todas as rotas (next.config.ts). HSTS em resposta http é ignorado pelo navegador: pode ir sempre. */
export const CABECALHOS_SEGURANCA = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
];
```

Run: `pnpm test src/lib/csp.test.ts` → PASS.

- [ ] **Step 3: Teste do proxy com a CSP (falha)** — `src/proxy.test.ts`, acrescentar:

```ts
  it('D7: página ganha CSP com nonce novo, repassada ao Next (request) e devolvida (response)', () => {
    const a = proxy(new NextRequest('http://localhost:3100/entrar'));
    const b = proxy(new NextRequest('http://localhost:3100/entrar'));
    const csp = a.headers.get('content-security-policy')!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    expect(a.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(a.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(b.headers.get('content-security-policy')).not.toBe(csp);
    // /api/* não chega ao proxy (matcher, D2): o teste do matcher da Tarefa 1 continua valendo
  });

  it('CSP_MODO=relatorio troca para Report-Only', () => {
    process.env.CSP_MODO = 'relatorio';
    try {
      const r = proxy(new NextRequest('http://localhost:3100/entrar'));
      expect(r.headers.get('content-security-policy')).toBeNull();
      expect(r.headers.get('content-security-policy-report-only')).toContain('report-uri /api/csp-relatorio');
    } finally {
      delete process.env.CSP_MODO;
    }
  });
```

Run: `pnpm test src/proxy.test.ts` → FAIL.

- [ ] **Step 4: Proxy final** — `src/proxy.ts` (versão completa, com o `request_id` da Tarefa 1)

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { montarCsp, novoNonce } from '@/lib/csp';
import { CABECALHO_REQUEST_ID, novoRequestId } from '@/lib/request-id';
import { CURRENT_PATH_HEADER } from '@/lib/safe-return';

const PROTECTED = ['/admin', '/painel', '/p', '/conta', '/inicio'];

/** Caminho + query da página pedida, sem o `_rsc` interno das navegações do App Router. */
function currentPath(req: NextRequest): string {
  const params = new URLSearchParams(req.nextUrl.search);
  params.delete('_rsc');
  const qs = params.toString();
  return qs ? `${req.nextUrl.pathname}?${qs}` : req.nextUrl.pathname;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestId = novoRequestId(); // D2: o do cliente nunca é usado
  const headers = new Headers(req.headers);
  headers.set(CABECALHO_REQUEST_ID, requestId);
  // /api/* não passa por aqui (matcher, D2): sem CSP de documento e sem request_id no cabeçalho
  const current = currentPath(req);
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isProtected && !getSessionCookie(req, { cookiePrefix: 'nd' })) {
    const url = new URL('/entrar', req.url);
    url.searchParams.set('volta', current); // /entrar valida com safeReturnPath
    return NextResponse.redirect(url);
  }
  // D7: o Next lê o nonce do cabeçalho de CSP da requisição e o aplica aos próprios scripts
  const nonce = novoNonce();
  const csp = montarCsp({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    https: (process.env.APP_URL ?? '').startsWith('https://'),
    modo: process.env.CSP_MODO === 'relatorio' ? 'relatorio' : 'valendo',
  });
  headers.set(CURRENT_PATH_HEADER, current); // requireUser: sessão expirada → /entrar mantendo o ?volta
  headers.set('x-nonce', nonce);
  headers.set(csp.nome, csp.valor);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set(csp.nome, csp.valor);
  res.headers.set(CABECALHO_REQUEST_ID, requestId);
  return res;
}

// D2: `api/` continua fora (o Next bufferizaria o corpo de toda requisição, com corte silencioso em 10 MB)
export const config = {
  matcher: ['/((?!api/|serwist/|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)'],
};
```

Run: `pnpm test src/proxy.test.ts` → PASS.

- [ ] **Step 5: Páginas dinâmicas e cabeçalhos globais**

`src/app/layout.tsx` — o layout raiz vira `async` e espera a requisição (o nonce só existe em render dinâmico):

```tsx
import { connection } from 'next/server';
// … imports e fontes como estão (a Tarefa 12 troca as fontes)

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection(); // D7: CSP com nonce exige render por requisição em todas as páginas
  return (
    <html lang="pt-BR" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

`next.config.ts` — `poweredByHeader: false` e os cabeçalhos globais **antes** das regras de convite/consulta (a última regra que casa vence para a mesma chave):

```ts
import type { NextConfig } from 'next';
import { withSerwist } from '@serwist/turbopack';
import { CABECALHOS_SEGURANCA } from './src/lib/csp';

const nextConfig: NextConfig = {
  // pg-boss é biblioteca de servidor com SQL próprio; o `pg` já é externo por padrão no Next
  serverExternalPackages: ['pg-boss'],
  poweredByHeader: false, // P08-05: sem "x-powered-by: Next.js"
  headers: async () => [
    // P08-05 / RNF-06 (D8): todas as rotas, inclusive /api (a CSP de documento vem do proxy)
    { source: '/:path*', headers: CABECALHOS_SEGURANCA },
    // M7: o token do convite está na URL; além da <meta name="referrer"> da página, o cabeçalho
    // vale desde a primeira resposta (inclusive para recursos pedidos antes do <head> ser lido).
    { source: '/convite/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    // D20: o token do link da consulta também está na URL
    { source: '/consulta/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
  ],
};

export default withSerwist(nextConfig);
```

`src/env.ts` (`appSchema`): `CSP_MODO: opcional(z.enum(['valendo', 'relatorio'], { message: 'CSP_MODO deve ser valendo ou relatorio' }).optional()),` e um caso em `src/env.test.ts` (`parseEnv({ ...base, CSP_MODO: 'outro' })` lança `CSP_MODO deve ser valendo ou relatorio`). `.env.example`: `CSP_MODO=` com o comentário `# P08-05: vazio = CSP valendo; "relatorio" = só Report-Only (emergência)`.

- [ ] **Step 6: Rota dos relatórios (modo de emergência)** — `src/app/api/csp-relatorio/route.ts`

```ts
import { getEnv } from '@/env';
import { lerCorpoLimitado } from '@/lib/corpo';
import { clientIpDoLimite } from '@/lib/ip';
import { criarLimite } from '@/lib/limite-memoria';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const limite = criarLimite({ janelaMs: 60_000, max: 60 });
const DIRETIVA = /^[a-z-]{3,40}$/;

/** D7: com CSP_MODO=relatorio, o navegador manda as violações aqui. Log só da diretiva e da origem bloqueada (nunca a URL da página). */
export async function POST(req: Request): Promise<Response> {
  const vazio = new Response(null, { status: 204 });
  if (!limite.permitir(clientIpDoLimite(req.headers, getEnv().TRUSTED_PROXIES) ?? 'sem-ip')) return vazio; // /64 no IPv6, como o T2
  try {
    const corpo = JSON.parse(new TextDecoder().decode(await lerCorpoLimitado(req, 8192))) as { 'csp-report'?: Record<string, unknown> };
    const r = corpo['csp-report'] ?? {};
    const diretiva = String(r['effective-directive'] ?? r['violated-directive'] ?? '').split(' ')[0];
    let bloqueado = 'inline';
    try {
      bloqueado = new URL(String(r['blocked-uri'])).origin;
    } catch {
      // "inline", "eval" ou vazio: fica "inline"
    }
    if (DIRETIVA.test(diretiva)) logger.warn({ diretiva, bloqueado }, 'csp violada');
  } catch {
    // relatório malformado: ignora
  }
  return vazio;
}
```

- [ ] **Step 7: E2E (nenhuma violação no console)** — `e2e/csp.spec.ts`

```ts
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { pacienteNoPortal, publicarPlanoSimples } from './portal';

// P08-05 / RNF-06 (D7, D8). Bloco de IP deste spec: 10.9.12.x — nutri .1 e .4, paciente .2 e .5, visitante .3.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

function vigiarCsp(page: Page): string[] {
  const erros: string[] = [];
  page.on('console', (m) => {
    if (/Content[- ]Security[- ]Policy/i.test(m.text())) erros.push(`${page.url()}: ${m.text()}`);
  });
  return erros;
}

test('cabeçalhos de segurança e nonce novo a cada requisição', async ({ request }) => {
  const [a, b] = [await request.get('/entrar'), await request.get('/entrar')];
  const h = a.headers();
  expect(h['content-security-policy']).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(b.headers()['content-security-policy']).not.toBe(h['content-security-policy']);
  expect(h['strict-transport-security']).toBe('max-age=63072000');
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['x-frame-options']).toBe('DENY');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['x-powered-by']).toBeUndefined();
  expect((await request.get('/convite/token-invalido')).headers()['referrer-policy']).toBe('no-referrer');
  expect((await request.get('/api/health')).headers()['x-content-type-options']).toBe('nosniff');
});

test('login, painel, agenda, prontuário, plano, portal e página pública (Turnstile) sem violação de CSP', async ({ browser }) => {
  const visitante = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.12.3' } })).newPage();
  const erros = vigiarCsp(visitante);
  for (const url of ['/entrar', '/esqueci-senha', '/n/e2e-consultorio']) {
    await visitante.goto(url);
    await visitante.waitForLoadState('networkidle');
  }
  // o widget do Turnstile (chave de teste) carregou o iframe
  await expect(visitante.locator('iframe[src^="https://challenges.cloudflare.com"]').first()).toBeAttached({ timeout: 15_000 });

  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.12.1');
  const errosNutri = vigiarCsp(nutri);
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.12.2');
  const errosPaciente = vigiarCsp(paciente.page);
  await publicarPlanoSimples(nutri, paciente.prontuario);
  for (const url of ['/painel', '/painel/agenda', '/painel/pacientes', paciente.prontuario, '/painel/configuracoes']) {
    await nutri.goto(url);
    await nutri.waitForLoadState('networkidle');
  }
  for (const url of ['/p/inicio', '/p/plano', '/p/diario', '/p/agenda', '/p/perfil', '/p/conteudos']) {
    await paciente.page.goto(url);
    await paciente.page.waitForLoadState('networkidle');
  }
  expect([...erros, ...errosNutri, ...errosPaciente]).toEqual([]);
  await visitante.context().close();
  await paciente.page.context().close();
  await nutri.context().close();
});

// D2: /api/* fora do matcher do proxy. Se alguém incluir /api, o Next corta o corpo em 10 MB (proxyClientMaxBodySize)
// sem erro para o cliente e este exame de 15 MB falha. Conferir que a cota do tenant de E2E comporta 15 MB.
test('exame de 15 MB passa pelo servidor inteiro (US-015, até 20 MB)', async ({ browser }) => {
  const nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.12.4');
  const paciente = await pacienteNoPortal(browser, nutri, '10.9.12.5');
  const id = paciente.prontuario.split('/').pop()!;
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(15 * 1024 * 1024, 0x20), Buffer.from('\n%%EOF\n')]);
  const r = await nutri.request.post(`/api/painel/pacientes/${id}/exames`, {
    headers: { origin: new URL(nutri.url()).origin },
    multipart: { titulo: 'Exame grande', data: '2026-10-01', valores: '[]', arquivo: { name: 'grande.pdf', mimeType: 'application/pdf', buffer: pdf } },
  });
  expect(r.status()).toBe(200);
  expect(await r.json()).toMatchObject({ ok: true });
  await paciente.page.context().close();
  await nutri.context().close();
});
```

O caso do player do Plano 07 fica na Tarefa 6 (D12), onde o player muda. Run: `pnpm build && pnpm test:e2e` → PASS em **todas** as specs (a CSP vale para tudo: o `portal.spec.ts` confere o offline do plano, o `plataforma.spec.ts` o QR do 2FA, o `agenda.spec.ts` a página pública). Uma violação nova = corrigir a diretiva **com justificativa no comentário de `montarCsp`**, nunca afrouxar `script-src`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/csp.ts src/lib/csp.test.ts src/proxy.ts src/proxy.test.ts next.config.ts src/app/layout.tsx src/env.ts src/env.test.ts .env.example src/app/api/csp-relatorio e2e/csp.spec.ts
git commit -m "feat(seguranca): CSP com nonce em todas as páginas, HSTS e cabeçalhos globais (P08-05, RNF-06, D7, D8)"
```

---

### Task 5: RLS final — colunas que o paciente altera, `audit_log` e capas (P08-05 b; RNF-07; débitos B-4, B-6, nota N38)

**Files:**
- Create: `drizzle/0085_paciente_colunas.sql` (custom), `src/db/paciente-colunas.test.ts`
- Modify: `src/db/rls-guard.ts` (comentário de `PACIENTE_ESCREVE`), `drizzle/meta/_journal.json` (pelo `drizzle-kit`)

**Interfaces:**
- Consumes: `app_current_role()`, `app_current_user()`, `app_current_patient()` (migrations 0000/0007); `pacienteComConta` (`test/portal.ts`); `novoTenant`, `novoPaciente` (`test/pacientes.ts`); `novoConteudo` (`test/conteudos.ts`, Plano 07).
- Produces: funções `app_paciente_colunas_patients()` e `app_paciente_colunas_exports()` + gatilhos `paciente_colunas` (BEFORE UPDATE) em `patients` e `data_exports`; política `paciente_sem_leitura` (RESTRICTIVE FOR SELECT) em `audit_log`; `paciente_arquivos` refeita (capa só pela audiência).

- [ ] **Step 1: Teste (falha)** — `src/db/paciente-colunas.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../test/db';
import { novoConteudo } from '../../test/conteudos';
import { novoPaciente, novoTenant } from '../../test/pacientes';
import { pacienteComConta } from '../../test/portal';
import { user } from './schema';
import { withTenant, type TenantContext } from './tenant';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const codigo = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
const negado = (e: unknown) => codigo(e) === '42501';

async function cenario() {
  const T = await novoTenant(app.db);
  const { paciente, userId } = await pacienteComConta(app.db, T, { telefoneE164: '+5511912345678' });
  const ctx: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: paciente.id, actorUserId: userId, ip: '203.0.113.9' };
  const comoPaciente = (s: ReturnType<typeof sql>) => withTenant(ctx, (tx) => tx.execute(s), app.db);
  return { T, paciente, userId, comoPaciente };
}

describe('B-4: o que a sessão de paciente altera em patients (0085)', () => {
  it('opt-in (origem paciente) e opt-out do WhatsApp passam', async () => {
    const { paciente, comoPaciente } = await cenario();
    await comoPaciente(sql`update patients set whatsapp_optin_em = now(), whatsapp_optin_origem = 'paciente', whatsapp_optout_em = null, updated_at = now() where id = ${paciente.id}`);
    await comoPaciente(sql`update patients set whatsapp_optout_em = now(), updated_at = now() where id = ${paciente.id}`);
  });

  it.each([
    ['status', "status = 'arquivado'"],
    ['anonimizar_apos', "anonimizar_apos = '2099-01-01'"],
    ['nome', "nome = 'Outro Nome'"],
    ['opt-in com origem nutri', "whatsapp_optin_em = now(), whatsapp_optin_origem = 'nutri'"],
  ])('%s → 42501', async (_n, set) => {
    const { paciente, comoPaciente } = await cenario();
    await expect(comoPaciente(sql.raw(`update patients set ${set} where id = '${paciente.id}'`))).rejects.toSatisfy(negado);
  });

  it('user_id: só de nulo para a própria conta; nunca troca a conta já ligada', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const [eu, outro] = [randomUUID(), randomUUID()];
    for (const id of [eu, outro]) await app.db.insert(user).values({ id, name: 'Conta', email: `c-${id.slice(0, 8)}@teste.dev`, appRole: 'paciente' });
    const ctx: TenantContext = { tenantId: T.tenantId, role: 'paciente', patientId: p.id, actorUserId: eu };
    await expect(withTenant(ctx, (tx) => tx.execute(sql`update patients set user_id = ${outro} where id = ${p.id}`), app.db)).rejects.toSatisfy(negado);
    await withTenant(ctx, (tx) => tx.execute(sql`update patients set user_id = ${eu}, updated_at = now() where id = ${p.id}`), app.db);
    await expect(withTenant(ctx, (tx) => tx.execute(sql`update patients set user_id = null where id = ${p.id}`), app.db)).rejects.toSatisfy(negado);
  });

  it('a nutricionista continua alterando qualquer coluna', async () => {
    const { T, paciente } = await cenario();
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set nome = 'Ana S.', status = 'arquivado' where id = ${paciente.id}`), app.db);
  });
});

describe('B-4: data_exports na sessão de paciente', () => {
  it('só pendente → falhou; pronta ou outro caminho → 42501', async () => {
    const { T, paciente, comoPaciente } = await cenario();
    const novo = async () =>
      (await withTenant(T.ctx, (tx) => tx.execute(sql`insert into data_exports (tenant_id, patient_id, escopo) values (${T.tenantId}, ${paciente.id}, 'titular') returning id`), app.db)).rows[0].id as string;
    const a = await novo();
    await comoPaciente(sql`update data_exports set status = 'falhou', updated_at = now() where id = ${a}`);
    const b = await novo();
    await expect(comoPaciente(sql`update data_exports set status = 'pronta', expira_em = now() where id = ${b}`)).rejects.toSatisfy(negado);
    await expect(comoPaciente(sql`update data_exports set escopo = 'equipe' where id = ${b}`)).rejects.toSatisfy(negado);
  });
});

describe('B-6: audit_log não é legível pela sessão de paciente', () => {
  it('0 linhas, mesmo com linhas do próprio paciente; o INSERT (auditRead/gatilho) continua', async () => {
    const { T, paciente, comoPaciente } = await cenario();
    await withTenant(T.ctx, (tx) => tx.execute(sql`update patients set nome = 'Ana Souza' where id = ${paciente.id}`), app.db); // gera linha auditada
    const n = await withTenant(T.ctx, (tx) => tx.execute(sql`select count(*)::int as n from audit_log where patient_id = ${paciente.id}`), app.db);
    expect(n.rows[0].n).toBeGreaterThan(0);
    expect((await comoPaciente(sql`select count(*)::int as n from audit_log`)).rows[0].n).toBe(0);
    await comoPaciente(sql`update patients set whatsapp_optout_em = now() where id = ${paciente.id}`); // o gatilho grava como paciente
  });
});

describe('N38: capa de conteúdo só pela audiência (paciente_arquivos)', () => {
  it('capa de conteúdo da audiência é visível; de conteúdo para outro paciente, não; logo do consultório, sim', async () => {
    const { T, paciente, comoPaciente } = await cenario();
    const outro = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    const capa = (n: string) => `${T.tenantId}/capa/${n}.jpg`;
    await withTenant(
      T.ctx,
      (tx) =>
        tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values
          (${T.tenantId}, 'capa', ${capa('minha')}, 10, 'image/jpeg'),
          (${T.tenantId}, 'capa', ${capa('dela')}, 10, 'image/jpeg'),
          (${T.tenantId}, 'logo', ${`${T.tenantId}/logo/l.png`}, 10, 'image/png')`),
      app.db,
    );
    await novoConteudo(app.db, T, { capaPath: capa('minha'), visibilidade: 'pacientes', pacientes: [paciente.id] });
    await novoConteudo(app.db, T, { capaPath: capa('dela'), visibilidade: 'pacientes', pacientes: [outro.id] });
    const vistos = (await comoPaciente(sql`select caminho from stored_files where tipo in ('capa', 'logo') order by caminho`)).rows.map((r) => r.caminho);
    expect(vistos).toEqual([capa('minha'), `${T.tenantId}/logo/l.png`].sort());
  });
});
```

Run: `pnpm test src/db/paciente-colunas.test.ts` → FAIL (os UPDATEs proibidos passam; o paciente lê o `audit_log`; a capa "dela" aparece).

- [ ] **Step 2: Migration** — `pnpm drizzle-kit generate --custom --name paciente_colunas` e o conteúdo de `drizzle/0085_paciente_colunas.sql`:

```sql
-- P08-05 / B-4: o banco confere O QUE a sessão de paciente grava, não só ONDE (PACIENTE_ESCREVE). Em patients: o aceite do
-- convite (user_id de nulo para a própria conta) e o WhatsApp (opt-in com origem 'paciente', opt-out). O gatilho de
-- auditoria continua (AFTER); este roda antes e recusa com 42501, o mesmo código da RLS.
CREATE OR REPLACE FUNCTION app_paciente_colunas_patients() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  livres text[] := ARRAY['user_id', 'whatsapp_optin_em', 'whatsapp_optin_origem', 'whatsapp_optout_em', 'updated_at'];
BEGIN
  IF app_current_role() IS DISTINCT FROM 'paciente' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - livres) IS DISTINCT FROM (to_jsonb(OLD) - livres) THEN
    RAISE EXCEPTION 'a sessão de paciente só altera o aceite do convite e o WhatsApp' USING ERRCODE = '42501';
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id AND (OLD.user_id IS NOT NULL OR NEW.user_id IS DISTINCT FROM app_current_user()) THEN
    RAISE EXCEPTION 'a sessão de paciente só liga o prontuário à própria conta' USING ERRCODE = '42501';
  END IF;
  IF NEW.whatsapp_optin_origem IS DISTINCT FROM OLD.whatsapp_optin_origem AND NEW.whatsapp_optin_origem IS DISTINCT FROM 'paciente' THEN
    RAISE EXCEPTION 'opt-in do paciente tem origem paciente' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER paciente_colunas BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION app_paciente_colunas_patients();
--> statement-breakpoint
-- B-4: em data_exports o titular só marca o pedido esquecido como falhou (solicitarExportacao, US-046)
CREATE OR REPLACE FUNCTION app_paciente_colunas_exports() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_role() IS DISTINCT FROM 'paciente' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'updated_at'])
     OR NOT (OLD.status = 'pendente' AND NEW.status = 'falhou') THEN
    RAISE EXCEPTION 'a sessão de paciente só marca o pedido pendente como falhou' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER paciente_colunas BEFORE UPDATE ON data_exports FOR EACH ROW EXECUTE FUNCTION app_paciente_colunas_exports();
--> statement-breakpoint
-- B-6: o portal nunca mostra o audit_log ao paciente (D5 do Plano 06); com SQL arbitrário ele leria as próprias linhas,
-- com IP e ator da equipe. auditRead e o gatilho só fazem INSERT sem RETURNING: não precisam de SELECT.
CREATE POLICY paciente_sem_leitura ON audit_log AS RESTRICTIVE FOR SELECT USING (app_current_role() IS DISTINCT FROM 'paciente');
--> statement-breakpoint
-- N38 (revisão do Plano 07): a capa só é visível ao paciente se o conteúdo dela for visível a ele. A subconsulta em
-- contents passa pela RLS de contents (paciente_conteudo_visivel, 0083) — inclusive a liberação das receitas do plano
-- (app.receitas_do_plano) na mesma transação. Logo do consultório: sempre.
DROP POLICY paciente_arquivos ON stored_files;
--> statement-breakpoint
CREATE POLICY paciente_arquivos ON stored_files AS RESTRICTIVE FOR ALL
  USING (
    app_current_role() IS DISTINCT FROM 'paciente'
    OR patient_id = app_current_patient()
    OR tipo = 'logo'
    OR (tipo = 'capa' AND EXISTS (SELECT 1 FROM contents c WHERE c.tenant_id = stored_files.tenant_id AND c.capa_path = stored_files.caminho))
  )
  WITH CHECK (app_current_role() IS DISTINCT FROM 'paciente' OR patient_id = app_current_patient());
```

Antes de aplicar, conferir que nenhuma leitura da sessão de paciente depende de `audit_log` nem de capa sem conteúdo:

```bash
grep -rn "auditLog\|audit_log" src --include=*.ts | grep -v test | grep -n "select\|returning"   # esperado: só leituras da equipe (historico-acessos, exportacao-job)
grep -rn "storedFiles" src/modules/portal src/app/p src/app/api/p                                   # esperado: nenhum SELECT de capa
```

Se aparecer leitura de `audit_log` com `RETURNING` na sessão de paciente, trocar por INSERT sem retorno (o id não é usado).

Run: `pnpm db:migrate` **só no banco do Testcontainers** (o `pnpm test` aplica sozinho) → `pnpm test src/db/paciente-colunas.test.ts` → PASS. Depois: `pnpm test` inteiro (guardas `rls-guard`, `audit-guard`, `isolamento`, os fluxos de convite e de opt-in, `migrate-owner.test.ts`) → PASS.

- [ ] **Step 3: Comentário da lista** — `src/db/rls-guard.ts`, nas entradas de `PACIENTE_ESCREVE`:

```ts
  patients: { comandos: ['update'], motivo: 'aceite do convite (US-011), opt-in/opt-out do WhatsApp e a trava FOR UPDATE das ações do paciente — colunas conferidas pelo gatilho paciente_colunas (0085, B-4)' },
  // …
  data_exports: { comandos: ['insert', 'update'], motivo: 'US-046: o titular pede os próprios dados (solicitarExportacao marca o pendente esquecido como falhou); só escopo titular (0080); UPDATE só pendente → falhou (gatilho paciente_colunas, 0085)' },
```

- [ ] **Step 4: Commit**

```bash
git add drizzle/0085_paciente_colunas.sql drizzle/meta src/db/paciente-colunas.test.ts src/db/rls-guard.ts
git commit -m "feat(rls): paciente só altera as colunas do convite e do WhatsApp, sem leitura do audit_log e capas pela audiência (P08-05, B-4, B-6, N38)"
```

---

### Task 6: Limites, sessão, senha e o player sob demanda (P08-05 c; débitos B-8, S-12; notas N4, N7; D10, D12)

**Files:**
- Modify: `src/lib/password-policy.ts` (+ test), `src/db/tenant.ts` (+ `src/db/tenant.test.ts`, + `src/db/sem-conta-guarda.test.ts`), `src/modules/agenda/acoes-link.ts`, `src/modules/notificacoes/whatsapp/webhook.ts`, `src/modules/pacientes/convite-paciente.ts`, `scripts/e2e-seed.ts`, `test/conteudos.ts` (Plano 07), `src/app/api/p/push/route.ts` (+ `route.test.ts`), `src/components/player-video.tsx` (+ teste do Plano 07), `e2e/conteudos.spec.ts` (Plano 07)
- Create: `src/components/player-sob-demanda.tsx`

**Interfaces:**
- Consumes: `criarLimite`, `MSG_MUITAS_TENTATIVAS` (T2); `PlayerVideo`, `urlDoPlayer`, `VideoDoLink` (Plano 07, T3).
- Produces: `validatePasswordPolicy` com `\p{L}`/`\p{Nd}`; `TenantContext.semConta?: true` (só com `role: 'paciente'`, sem `actorUserId`); `withTenant`/`assertContext` recusam `nutri` sem `actorUserId` e `paciente` sem `actorUserId` e sem `semConta: true` (`TenantContextError('actorUserId obrigatório para sessão de nutricionista ou paciente')`); `SEM_CONTA_PERMITIDOS` (`src/db/tenant.ts`) com a lista fechada dos chamadores sem conta, conferida por guarda; `POST /api/p/push` → 429 depois de 20 em 10 min por conta; `PlayerVideo({ video, titulo })` passa a renderizar `PlayerSobDemanda` (D12).

- [ ] **Step 1: Senha (N4)** — `src/lib/password-policy.test.ts`, acrescentar:

```ts
  it('N4: letra e número por classe Unicode — "×" e "÷" não contam como letra; "Ç" conta', () => {
    expect(validatePasswordPolicy('××××××××11')).toBe('A senha precisa ter pelo menos 1 letra e 1 número.');
    expect(validatePasswordPolicy('÷÷÷÷÷÷÷÷÷1')).toBe('A senha precisa ter pelo menos 1 letra e 1 número.');
    expect(validatePasswordPolicy('ÇãoÇãoÇão1')).toBeNull();
    expect(validatePasswordPolicy('ΑβγδεζηθικΛ1')).toBeNull(); // grego também é letra
  });
```

Run → FAIL. `src/lib/password-policy.ts`: trocar a linha da regex por `if (!/\p{L}/u.test(pw) || !/\p{Nd}/u.test(pw)) {`. Run → PASS.

- [ ] **Step 2: `actorUserId` obrigatório quando há sessão de login (N7)**

Três fluxos de produção rodam como paciente **sem ator, de propósito**, e precisam continuar com a RLS por paciente (trocar para `worker` tiraria essa RLS de um fluxo sem login; inventar um UUID falsificaria o `audit_log`):
- `src/modules/agenda/acoes-link.ts` (`comoPaciente`, ~linha 80): ações dos links assinados da consulta (D20 do Plano 05: "sem ator", com o IP de quem clicou);
- `src/modules/notificacoes/whatsapp/webhook.ts` (`comoPaciente`, ~linha 246): respostas 1/2 do paciente pelo WhatsApp;
- `src/modules/pacientes/convite-paciente.ts` (~linha 151): leitura do paciente ao abrir o convite (a conta ainda não existe).

Por isso o ator passa a ser exigido **só quando há sessão de login**: um campo explícito `semConta: true` marca os três fluxos, e uma guarda fecha a lista de quem pode usá-lo. `src/db/tenant.test.ts`, acrescentar:

```ts
  it('N7: nutri sempre com ator; paciente com ator ou com semConta: true; worker e publico sem ator seguem', async () => {
    const tenantId = crypto.randomUUID();
    const patientId = crypto.randomUUID();
    await expect(withTenant({ tenantId, role: 'nutri' }, async () => 1, app.db)).rejects.toThrow('actorUserId obrigatório para sessão de nutricionista ou paciente');
    await expect(withTenant({ tenantId, role: 'paciente', patientId }, async () => 1, app.db)).rejects.toThrow('actorUserId obrigatório');
    await expect(withTenant({ tenantId, role: 'paciente', patientId, semConta: true }, async () => 1, app.db)).resolves.toBe(1);
    await expect(withTenant({ tenantId, role: 'paciente', patientId, actorUserId: crypto.randomUUID() }, async () => 1, app.db)).resolves.toBe(1);
    await expect(withTenant({ tenantId, role: 'worker' }, async () => 1, app.db)).resolves.toBe(1);
  });

  it('N7: semConta só para paciente e nunca junto com um ator', async () => {
    const tenantId = crypto.randomUUID();
    await expect(withTenant({ tenantId, role: 'nutri', semConta: true, actorUserId: crypto.randomUUID() } as never, async () => 1, app.db)).rejects.toThrow('semConta só é permitido para paciente sem ator');
    await expect(withTenant({ tenantId, role: 'paciente', patientId: crypto.randomUUID(), semConta: true, actorUserId: crypto.randomUUID() }, async () => 1, app.db)).rejects.toThrow('semConta só é permitido para paciente sem ator');
  });
```

(`app` = o `makeDb` que o arquivo já usa.) Run → FAIL. `src/db/tenant.ts`:

```ts
export type TenantContext = {
  tenantId: string;
  role: TenantRole;
  patientId?: string;
  /** Quem age (auditoria, RNF-08). Obrigatório para `nutri`; para `paciente`, salvo com `semConta`. Ausente em jobs do worker. */
  actorUserId?: string;
  /**
   * N7 (Plano 08): paciente agindo **sem sessão de login** (link assinado da consulta, resposta pelo WhatsApp, leitura do
   * convite antes da conta existir). Mantém a RLS por paciente; o `audit_log` sai sem ator, como a D20 do Plano 05 define.
   * Só os arquivos de `SEM_CONTA_PERMITIDOS` usam (guarda em sem-conta-guarda.test.ts).
   */
  semConta?: true;
  ip?: string | null;
};

/** N7: lista fechada dos fluxos de paciente sem sessão de login (sem-conta-guarda.test.ts). */
export const SEM_CONTA_PERMITIDOS: readonly string[] = [
  'src/modules/agenda/acoes-link.ts',
  'src/modules/notificacoes/whatsapp/webhook.ts',
  'src/modules/pacientes/convite-paciente.ts',
];
```

e, em `assertContext`, depois da conferência do `patientId`:

```ts
  // N7 (Plano 03): toda escrita com sessão de login vai para o audit_log com o ator — sem ele, a linha sai anônima.
  // Paciente sem login (link, WhatsApp, convite) declara isso com semConta: true (lista fechada em SEM_CONTA_PERMITIDOS).
  if (ctx.semConta !== undefined && (ctx.semConta !== true || ctx.role !== 'paciente' || ctx.actorUserId !== undefined)) {
    throw new TenantContextError('semConta só é permitido para paciente sem ator');
  }
  if ((ctx.role === 'nutri' || (ctx.role === 'paciente' && !ctx.semConta)) && !ctx.actorUserId) {
    throw new TenantContextError('actorUserId obrigatório para sessão de nutricionista ou paciente');
  }
```

Nos três chamadores, acrescentar `semConta: true` ao contexto (nada mais muda):
- `acoes-link.ts`: `({ tenantId: r.tenant.id, role: 'paciente', patientId: r.patientId, semConta: true, ip: ip ?? null })`;
- `webhook.ts`: `{ tenantId, role: 'paciente', patientId: alvo.patientId, semConta: true }`;
- `convite-paciente.ts`: `withTenant({ tenantId, role: 'paciente', patientId, semConta: true }, …)`.

Guarda — `src/db/sem-conta-guarda.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEM_CONTA_PERMITIDOS } from './tenant';

// N7: semConta tira a exigência do ator. Só os fluxos de paciente sem login podem usar (lista fechada).
describe('guarda do semConta', () => {
  it('semConta só nos arquivos de SEM_CONTA_PERMITIDOS (fora dos testes e do próprio tenant.ts)', () => {
    const usam = readdirSync(path.resolve('src'), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
      .map((d) => path.relative(process.cwd(), path.join(d.parentPath, d.name)))
      .filter((f) => f !== 'src/db/tenant.ts' && /\bsemConta\b/.test(readFileSync(f, 'utf8')))
      .sort();
    expect(usam).toEqual([...SEM_CONTA_PERMITIDOS].sort());
  });
});
```

Run: `pnpm test` → os testes que quebrarem são chamadas sem ator. Corrigir cada uma **sem afrouxar a regra**: scripts e varreduras do sistema usam `role: 'worker'` (em `scripts/e2e-seed.ts`, as duas chamadas `withTenant({ tenantId: …, role: 'nutri' }, …)` viram `role: 'worker'`); helpers de teste com sessão recebem o ator (em `test/conteudos.ts` do Plano 07, `ctxPaciente(tenantId, patientId)` passa a montar `{ tenantId, role: 'paciente', patientId, actorUserId: crypto.randomUUID() }` — o ator não precisa existir em `user`, `audit_log.actor_user_id` não tem FK); **nunca** pôr `semConta` num chamador fora da lista nem trocar os três fluxos acima para `worker`. Listar os pontos com `grep -rn "role: 'nutri'\|role: 'paciente'" src scripts test --include=*.ts | grep -v "actorUserId\|semConta"`. Os testes já existentes dos três fluxos precisam passar **sem mudança de expectativa**: `src/modules/agenda/acoes-link.test.ts` (confirmar e pedir remarcação pelo link, com o `audit_log` da consulta sem ator e com o IP), `src/modules/notificacoes/whatsapp/webhook.test.ts` (respostas 1 e 2) e `src/modules/pacientes/convite-paciente.test.ts` (abrir e aceitar o convite); acrescentar a `acoes-link.test.ts` e a `webhook.test.ts` um caso que confere que o contexto continua `paciente` (a consulta de outro paciente do mesmo tenant segue invisível ao fluxo). Run: `pnpm test` → PASS. `pnpm build && pnpm test:e2e e2e/agenda.spec.ts` → PASS (o link da consulta no navegador).

- [ ] **Step 3: Limite por conta no push (B-8)** — `src/app/api/p/push/route.test.ts`, acrescentar (no padrão de sessão de paciente que o arquivo já usa):

```ts
  it('B-8: a 21ª inscrição da mesma conta em 10 min dá 429 com a mensagem; outra conta segue', async () => {
    const corpo = JSON.stringify(inscricaoValida()); // o helper de inscrição que o arquivo já tem
    for (let i = 0; i < 20; i++) await POST(reqComSessao(cookieAna, corpo, '?sincronizar=1'));
    const r = await POST(reqComSessao(cookieAna, corpo, '?sincronizar=1'));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ erro: 'Muitas tentativas. Tente de novo em alguns minutos.' });
    expect((await POST(reqComSessao(cookieBia, corpo, '?sincronizar=1'))).status).not.toBe(429);
  });
```

(usar os nomes dos helpers e cookies que `route.test.ts` já declara; se ele não tiver um `reqComSessao`, montar o `Request` como os outros casos do arquivo.) Run → FAIL. `src/app/api/p/push/route.ts`:

```ts
import { criarLimite, MSG_MUITAS_TENTATIVAS } from '@/lib/limite-memoria';
// …
/** B-8 (D10): cada abertura do portal sincroniza a inscrição; 20 em 10 min por conta é folga larga para uso real. */
const limitePorConta = criarLimite({ janelaMs: 10 * 60_000, max: 20 });
```

e no `POST`, logo depois de `if (!e.ok) return e.erro;`:

```ts
  if (!limitePorConta.permitir(e.acesso.data.user.id)) return resposta(429, { erro: MSG_MUITAS_TENTATIVAS });
```

Run → PASS. O custo O(tenants) do `app_soltar_endpoint_push` é medido no k6 (Tarefa 10, cenário com 50 tenants).

- [ ] **Step 4: Player sob demanda (D12 — só se o dono aprovar)** — teste primeiro, no teste do `PlayerVideo` do Plano 07 (`src/components/player-video.test.ts`), trocar o caso do iframe por:

```ts
  it('D12: sem clique, nenhum iframe nem pedido ao provedor — só o botão e o aviso', () => {
    const html = renderToStaticMarkup(createElement(PlayerVideo, { video: { provider: 'youtube', id: 'dQw4w9WgXcQ' }, titulo: 'Como montar o prato' }));
    expect(html).not.toContain('<iframe');
    expect(html).toContain('Carregar o vídeo');
    expect(html).toContain('O vídeo é exibido pelo YouTube.');
  });
```

Run → FAIL. `src/components/player-sob-demanda.tsx`

```tsx
'use client';

import { useState } from 'react';

/**
 * D12: o iframe do YouTube/Vimeo só entra depois do clique — abrir o conteúdo não manda o IP do paciente ao provedor.
 * `src` já vem montado do id validado (urlDoPlayer, Plano 07 D10).
 */
export function PlayerSobDemanda({ src, titulo, provedor }: { src: string; titulo: string; provedor: 'YouTube' | 'Vimeo' }) {
  const [carregar, setCarregar] = useState(false);
  if (carregar) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded bg-black">
        <iframe
          src={src}
          title={`Vídeo: ${titulo}`}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    );
  }
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded bg-black p-4 text-center text-white">
      <button type="button" onClick={() => setCarregar(true)} className="min-h-11 rounded-full bg-white px-5 font-semibold text-black">
        Carregar o vídeo
      </button>
      <p className="text-sm">{`O vídeo é exibido pelo ${provedor}.`}</p>
    </div>
  );
}
```

`src/components/player-video.tsx` (do Plano 07) passa a ser:

```tsx
import type { VideoDoLink } from '@/modules/conteudo/video';
import { urlDoPlayer } from '@/modules/conteudo/video';
import { PlayerSobDemanda } from './player-sob-demanda';

/** Plano 07 (D10) + D12 do Plano 08: o player só carrega com o clique do paciente. */
export function PlayerVideo({ video, titulo }: { video: VideoDoLink; titulo: string }) {
  return <PlayerSobDemanda src={urlDoPlayer(video)} titulo={titulo} provedor={video.provider === 'youtube' ? 'YouTube' : 'Vimeo'} />;
}
```

(Conferir o caminho real de `urlDoPlayer` no código do Plano 07; o plano dele o declara em `src/modules/conteudo/video.ts`.) `e2e/conteudos.spec.ts` (Plano 07), no primeiro teste, antes de conferir o `src` do iframe: `await ana.page.getByRole('button', { name: 'Carregar o vídeo' }).click();`. E no `e2e/csp.spec.ts` (T4), um caso a mais no fim do segundo teste: abrir um vídeo do Plano 07 no portal, clicar "Carregar o vídeo" e conferir que o iframe `https://www.youtube-nocookie.com/embed/…` está no DOM e a lista de erros de CSP continua vazia.

Run: `pnpm test src/components && pnpm build && pnpm test:e2e e2e/conteudos.spec.ts e2e/csp.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/password-policy.ts src/lib/password-policy.test.ts src/db/tenant.ts src/db/tenant.test.ts src/db/sem-conta-guarda.test.ts src/modules/agenda/acoes-link.ts src/modules/agenda/acoes-link.test.ts src/modules/notificacoes/whatsapp/webhook.ts src/modules/notificacoes/whatsapp/webhook.test.ts src/modules/pacientes/convite-paciente.ts scripts/e2e-seed.ts test src/app/api/p/push src/components/player-video.tsx src/components/player-sob-demanda.tsx src/components/player-video.test.ts e2e/conteudos.spec.ts e2e/csp.spec.ts
git commit -m "feat(seguranca): limite por conta no push, ator obrigatório no withTenant, senha por classe Unicode e player sob demanda (P08-05, B-8, N4, N7, D12)"
```

O S-12 (`GET /api/p/vinculo`) fica como está (D10); a justificativa entra na spec no fechamento.

---

### Task 7: `access_events` na exclusão, na anonimização e com retenção (RNF-08; D13)

**Files:**
- Modify: `src/modules/portal/acesso.ts` (+ `acesso.test.ts`), `src/modules/pacientes/lgpd.ts` (+ `lgpd.test.ts`), `src/worker/index.ts`

**Interfaces:**
- Consumes: `accessEvents` (`@/db/schema`); `listarTenantsParaVarredura` (`tenant-status.ts`); `hojeNoFuso`, `somarDias` (`pacientes/datas.ts`); `atenderPedidoExclusao`, `anonimizarVencidos` (`lgpd.ts`, versão do PR #11).
- Produces: `apagarAcessosDoTitular(tx: Tx, patientId: string): Promise<void>`, `limparAcessosAntigos(db: Db, agora: Date): Promise<number>`, `RETENCAO_ACESSOS_DIAS = 400` (`@/modules/portal/acesso`).

- [ ] **Step 1: Testes (falham)** — `src/modules/portal/acesso.test.ts`, acrescentar:

```ts
describe('retenção de access_events (D13)', () => {
  it('apaga só o que tem mais de 400 dias no fuso do tenant', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const agora = new Date('2026-10-20T15:00:00Z');
    const hoje = hojeNoFuso(T.tenant.fuso, agora);
    await withTenant(
      T.ctx,
      (tx) =>
        tx.insert(accessEvents).values([
          { tenantId: T.tenantId, patientId: p.id, dia: somarDias(hoje, -401) },
          { tenantId: T.tenantId, patientId: p.id, dia: somarDias(hoje, -399) },
        ]),
      app.db,
    );
    expect(await limparAcessosAntigos(app.db, agora)).toBeGreaterThanOrEqual(1);
    const dias = await withTenant(T.ctx, (tx) => tx.select({ dia: accessEvents.dia }).from(accessEvents).where(eq(accessEvents.patientId, p.id)), app.db);
    expect(dias.map((d) => d.dia)).toEqual([somarDias(hoje, -399)]);
  });
});
```

(imports a acrescentar no topo do arquivo, se faltarem: `eq` de `drizzle-orm`, `accessEvents`, `withTenant`, `novoPaciente`/`novoTenant` de `test/pacientes`, `hojeNoFuso`/`somarDias` de `@/modules/pacientes/datas`, `limparAcessosAntigos`.)

`src/modules/pacientes/lgpd.test.ts`, no `describe` do pedido de exclusão (com o `deps` que o arquivo já monta):

```ts
  it('D13: o pedido atendido apaga os acessos do titular ao portal (access_events)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: ana.id, dia: '2026-09-10' }), app.db);
    await atenderPedidoExclusao(T.ctx, T.tenant, ana.id, ana.nome, deps);
    const n = await withTenant(T.ctx, (tx) => tx.select({ id: accessEvents.id }).from(accessEvents).where(eq(accessEvents.patientId, ana.id)), app.db);
    expect(n).toEqual([]);
  });
```

e o mesmo para a anonimização, no `describe` de `anonimizarVencidos` (paciente bloqueado com `anonimizar_apos` vencido e uma linha de `access_events` criada depois do bloqueio → nenhuma linha depois do job).

Run: `pnpm test src/modules/portal/acesso.test.ts src/modules/pacientes/lgpd.test.ts` → FAIL.

- [ ] **Step 2: Implementação** — `src/modules/portal/acesso.ts`, acrescentar:

```ts
import { eq, lt } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';

/** D13: 13 meses de série do CS-02 + folga. */
export const RETENCAO_ACESSOS_DIAS = 400;

/** RNF-08 / D13: dado de uso, não obrigatório — sai na exclusão (pedido atendido) e na anonimização. */
export async function apagarAcessosDoTitular(tx: Tx, patientId: string): Promise<void> {
  await tx.delete(accessEvents).where(eq(accessEvents.patientId, patientId));
}

/** Job `agenda-limpeza`: tenant a tenant (RLS forçada), no fuso de cada um. */
export async function limparAcessosAntigos(db: Db, agora: Date): Promise<number> {
  let n = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const corte = somarDias(hojeNoFuso(t.fuso, agora), -RETENCAO_ACESSOS_DIAS);
    const r = await withTenant({ tenantId: t.id, role: 'worker' }, (tx) => tx.delete(accessEvents).where(lt(accessEvents.dia, corte)).returning({ id: accessEvents.id }), db);
    n += r.length;
  }
  return n;
}
```

`src/modules/pacientes/lgpd.ts` (versão do PR #11): onde `atenderPedidoExclusao` apaga `pushSubscriptions` (`await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.patientId, p.id));`), acrescentar logo abaixo `await apagarAcessosDoTitular(tx, p.id);`; em `anonimizarVencidos`, no mesmo ponto em que apaga `pushSubscriptions` do paciente anonimizado, `await apagarAcessosDoTitular(tx, id);`. Import: `import { apagarAcessosDoTitular } from '@/modules/portal/acesso';` (conferir com `test/grafo-de-imports.test.ts` que não cria ciclo; se criar, mover as duas funções para `src/modules/portal/acesso-retencao.ts`).

`src/worker/index.ts`, no job `agenda-limpeza`:

```ts
    const acessos = await limparAcessosAntigos(getDb(), new Date()); // D13
    logger.info({ pedidos, limites, acessos }, 'limpeza da agenda pública');
```

Run: `pnpm test src/modules/portal src/modules/pacientes test/grafo-de-imports.test.ts` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/modules/portal/acesso.ts src/modules/portal/acesso.test.ts src/modules/pacientes/lgpd.ts src/modules/pacientes/lgpd.test.ts src/worker/index.ts
git commit -m "feat(lgpd): acessos ao portal saem na exclusão e na anonimização, com retenção de 400 dias (RNF-08, D13)"
```

---

### Task 8: Textos legais definitivos e prazo de guarda (P08-06; P-01, P-02, P-12, P-18 c; débito L-5) — **depende do E-09**

**Files:**
- Create: `src/modules/plataforma/suboperadores.ts`, `src/modules/plataforma/textos-legais.test.ts`
- Modify: `src/modules/plataforma/dpa.ts`, `src/modules/pacientes/termo-paciente.ts`, `src/modules/pacientes/lgpd.ts` (só se o prazo mudar), `src/app/painel/configuracoes/perfil-form.tsx`

**Interfaces:**
- Consumes: o texto do advogado (E-09: DPA, termo do paciente, prazo de guarda) — **insumo externo**, colado sem edição; a lista dos insumos que ele recebe está no runbook (passo 2).
- Produces: `SUBOPERADORES: readonly { nome: string; finalidade: string }[]`; `DPA_VERSAO = '1.0'`, `TERMO_PACIENTE_VERSAO = '1.0'` (a troca de versão obriga o novo aceite: `requireNutri` → `/painel/dpa`; `requirePaciente` → `/p/termo`, D25 do Plano 06 e S-1 do PR #11).

- [ ] **Step 1: Teste (falha)** — `src/modules/plataforma/textos-legais.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { TERMO_PACIENTE_PARAGRAFOS, TERMO_PACIENTE_ROTULO, TERMO_PACIENTE_VERSAO } from '@/modules/pacientes/termo-paciente';
import { DPA_PARAGRAFOS, DPA_VERSAO } from './dpa';
import { SUBOPERADORES } from './suboperadores';

const dpa = DPA_PARAGRAFOS.join('\n');
const termo = TERMO_PACIENTE_PARAGRAFOS.join('\n');

describe('textos legais definitivos (P08-06, E-09)', () => {
  it('versão 1.0 nos dois, sem texto provisório (US-011: "versão 1.0")', () => {
    expect(DPA_VERSAO).toBe('1.0');
    expect(TERMO_PACIENTE_VERSAO).toBe('1.0');
    expect(TERMO_PACIENTE_ROTULO).toBe('Li e aceito o Termo de Uso e Privacidade (versão 1.0)');
    expect(`${dpa}\n${termo}`).not.toMatch(/provis[óo]ri/i);
  });
  it.each(SUBOPERADORES.map((s) => [s.nome]))('o DPA cita o suboperador %s (P-12, P-18 c)', (nome) => {
    expect(dpa).toContain(nome);
  });
  it('o DPA não cita mais a Meta como suboperadora (o WhatsApp é a Evolution autohospedada desde a v1.8)', () => {
    expect(dpa).not.toMatch(/\bMeta\b/);
  });
  it('o DPA declara o acesso técnico do dono do servidor e a criptografia do provedor (P-12)', () => {
    expect(dpa).toMatch(/acesso técnico/i);
  });
  it('o termo do paciente cita os players de vídeo, as notificações e o registro de uso do app', () => {
    for (const t of ['YouTube', 'Vimeo', 'notificaç']) expect(termo).toContain(t);
  });
});
```

Run: `pnpm test src/modules/plataforma/textos-legais.test.ts` → FAIL (versão `0.1-provisorio`; "Meta" no DPA).

- [ ] **Step 2: Lista de suboperadores** — `src/modules/plataforma/suboperadores.ts`

```ts
/**
 * P-02 / P-12 / P-18 (c): quem trata dado em nome da plataforma. É a lista que vai ao advogado (E-09) e que o teste
 * confere no texto do DPA. Mudou um serviço (ex.: D1 = GlitchTip tira o Sentry) → muda aqui e no texto, com versão nova.
 */
export const SUBOPERADORES = [
  { nome: 'Hostinger', finalidade: 'servidor (VPS) onde ficam o banco de dados e os arquivos' },
  { nome: 'Cloudflare', finalidade: 'cópia de segurança criptografada (R2) e proteção anti-robô (Turnstile)' },
  { nome: 'Resend', finalidade: 'envio de e-mails' },
  { nome: 'Sentry', finalidade: 'registro de erros técnicos, sem dados de saúde' },
  { nome: 'Google', finalidade: 'entrega de notificações no Android e no Chrome (FCM) e o player do YouTube' },
  { nome: 'Apple', finalidade: 'entrega de notificações no iPhone (APNs)' },
  { nome: 'Mozilla', finalidade: 'entrega de notificações no Firefox' },
  { nome: 'Microsoft', finalidade: 'entrega de notificações no Edge' },
  { nome: 'Vimeo', finalidade: 'player dos vídeos publicados pela controladora' },
  { nome: 'Evolution API', finalidade: 'envio de WhatsApp pelo número da controladora, instalada no mesmo servidor (sem terceiro)' },
] as const;
```

- [ ] **Step 3: Colar o texto do advogado** — em `src/modules/plataforma/dpa.ts`: `DPA_VERSAO = '1.0'`, `DPA_PARAGRAFOS` = os parágrafos do DPA entregue pelo advogado, **um parágrafo por item do array, sem editar uma palavra**; o comentário da constante passa a ser `/** Texto do advogado (E-09), versão 1.0 de <data da entrega>. Mudar a versão obriga novo aceite (requireNutri). */`. Em `src/modules/pacientes/termo-paciente.ts`: `TERMO_PACIENTE_VERSAO = '1.0'` e `TERMO_PACIENTE_PARAGRAFOS` com o termo entregue, do mesmo jeito. Se o texto não citar algum item que o teste exige, **não** completar por conta própria: devolver ao dono com a lista do que falta (o teste diz qual).

- [ ] **Step 4: Prazo de guarda (P-01)** — se o advogado/CRN confirmar 20 anos, nada muda em `src/modules/pacientes/lgpd.ts` (só o comentário: `/** P-01: confirmado por <advogado/CRN> em <data>. */`). Se definir outro prazo `N`: `PRAZO_GUARDA_ANOS = N`; os testes que usam a constante (`lgpd.test.ts:91`) continuam verdes; o novo prazo vale para os bloqueios a partir do deploy (sem migração de dados: não há paciente real bloqueado — conferir com o dono antes do deploy; se houver, uma migration de dados por tenant, regra 8).

- [ ] **Step 5: Nota do L-5** — `src/app/painel/configuracoes/perfil-form.tsx`, trocar o bloco da opção por:

```tsx
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <input id="mostrarPercGorduraPaciente" name="mostrarPercGorduraPaciente" type="checkbox" aria-describedby="mostrarPercGorduraPaciente-dica" defaultChecked={v ? v.mostrarPercGorduraPaciente === 'on' : tenant.mostrarPercGorduraPaciente} />
          <label htmlFor="mostrarPercGorduraPaciente">Mostrar % de gordura ao paciente</label>
        </div>
        <p id="mostrarPercGorduraPaciente-dica" className="text-sm text-suave">Mesmo desligada, a cópia dos dados que o paciente pede inclui todas as medidas (LGPD, art. 18, II).</p>
      </div>
```

(`text-suave` vem da Tarefa 12; se esta tarefa entrar antes, usar `text-zinc-600` e a Tarefa 16 troca.)

Run: `pnpm test` → PASS (inclui `textos-legais.test.ts`, os testes do aceite do DPA e do termo, `termo.test.ts` do PR #11). `pnpm build && pnpm test:e2e e2e/plataforma.spec.ts e2e/portal.spec.ts` → PASS (o seed grava o aceite com as constantes novas).

- [ ] **Step 6: Commit**

```bash
git add src/modules/plataforma/suboperadores.ts src/modules/plataforma/textos-legais.test.ts src/modules/plataforma/dpa.ts src/modules/pacientes/termo-paciente.ts src/modules/pacientes/lgpd.ts src/app/painel/configuracoes/perfil-form.tsx
git commit -m "feat(lgpd): DPA e termo do paciente v1.0 (texto do advogado), suboperadores conferidos e nota do L-5 (P08-06, P-01, P-02)"
```

---
### Task 9: Métricas de sucesso CS-01 a CS-03 (P08-07, prioridade S; D15)

**Files:**
- Create: `src/modules/plataforma/metricas-sucesso.ts`, `src/modules/plataforma/metricas-sucesso.test.ts`, `drizzle/0086_metricas_sucesso.sql` (gerada), `drizzle/0087_metricas_sucesso_admin.sql` (custom), `src/app/admin/metricas-form.tsx`
- Modify: `src/db/schema/platform.ts` (`tenants`), `src/modules/plataforma/metricas.ts` (+ teste), `src/modules/plataforma/contas.ts` (`listarContas`), `src/app/admin/actions.ts`, `src/app/admin/page.tsx`, `src/db/migrate-owner.test.ts`

**Interfaces:**
- Consumes: `accessEvents`, `appointments`, `consultations`, `patients`, `tenants`; `withTenant`; `hojeNoFuso`, `somarDias` (`pacientes/datas.ts`); `inicioDoDia` (`agenda/fuso.ts`); `requireUser(['admin'], …)`.
- Produces:
  - `tenants.taxaFaltasBase: number | null` (0–100, duas casas) e `tenants.goLiveEm: string | null` (`date`).
  - `@/modules/plataforma/metricas-sucesso`: `metricasDeSucesso(ctx: TenantContext, tenant: Pick<TenantRow, 'fuso' | 'goLiveEm' | 'taxaFaltasBase'>, agora: Date, db?: Db): Promise<MetricasSucesso>`, `type MetricasSucesso = { cs01: { desde: string | null; dias: number; realizadas: number; comAtendimento: number }; cs02: { comConta: number; abriram: number; porDia: { dia: string; n: number }[] }; cs03: { base: number | null } }`, `META_CS02 = 0.6`, `DIAS_CS01 = 30`, `salvarMetricasBase(tenantId: string, entrada: { taxaBase: string; goLiveEm: string }, db?: Db): Promise<void>`, `MSG_METRICAS`.
  - `@/modules/plataforma/metricas`: `metricasDeSucessoPorTenant(db?: Db): Promise<Map<string, { comConta: number; abriram: number; faltasMes: number; iniciadasMes: number }>>`.
  - SQL: `admin_metricas_sucesso()` (`SECURITY DEFINER`, só contagens, mesmo molde da `admin_tenant_metrics`, 0059).

- [ ] **Step 1: Teste (falha)** — `src/modules/plataforma/metricas-sucesso.test.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { pacienteComConta } from '../../../test/portal';
import { accessEvents, appointments, consultations, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { metricasDeSucesso, MSG_METRICAS, salvarMetricasBase } from './metricas-sucesso';
import { metricasDeSucessoPorTenant } from './metricas';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const agora = new Date('2026-10-20T15:00:00Z'); // 12:00 em São Paulo

describe('CS-02 (D15): ativos com conta que abriram o app nos últimos 7 dias', () => {
  it('denominador só com conta e ativo; numerador pelos 7 dias no fuso; barras dos 7 dias', async () => {
    const T = await novoTenant(app.db);
    const a = (await pacienteComConta(app.db, T)).paciente;
    const b = (await pacienteComConta(app.db, T)).paciente;
    await pacienteComConta(app.db, T, { status: 'arquivado' }); // fora
    const semConta = await novoPaciente(app.db, T.ctx); // sem conta: fora (também das barras)
    await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values([
      { tenantId: T.tenantId, patientId: a.id, dia: '2026-10-20' },
      { tenantId: T.tenantId, patientId: semConta.id, dia: '2026-10-20' }, // fora do denominador → fora da barra
      { tenantId: T.tenantId, patientId: a.id, dia: '2026-10-14' },
      { tenantId: T.tenantId, patientId: b.id, dia: '2026-10-13' }, // 8 dias atrás: fora
    ]), app.db);
    const m = await metricasDeSucesso(T.ctx, { fuso: 'America/Sao_Paulo', goLiveEm: null, taxaFaltasBase: null }, agora, app.db);
    expect(m.cs02).toMatchObject({ comConta: 2, abriram: 1 });
    expect(m.cs02.porDia.map((d) => d.dia)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20']);
    expect(m.cs02.porDia[0].n).toBe(1);
    expect(m.cs02.porDia[6].n).toBe(1);
  });
});

describe('CS-01 (D15): consultas realizadas com atendimento registrado desde o go-live', () => {
  it('conta só realizadas desde go_live_em; dias desde o início', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-30T13:00:00Z'), 60, { status: 'realizada' }); // antes do go-live: fora
    const com = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-10-05T13:00:00Z'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, p.id, new Date('2026-10-06T13:00:00Z'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, p.id, new Date('2026-10-07T13:00:00Z'), 60, { status: 'faltou' });
    await withTenant(T.ctx, (tx) => tx.insert(consultations).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: com, data: '2026-10-05' }), app.db);
    const m = await metricasDeSucesso(T.ctx, { fuso: 'America/Sao_Paulo', goLiveEm: '2026-10-01', taxaFaltasBase: 18.5 }, agora, app.db);
    expect(m.cs01).toEqual({ desde: '2026-10-01', dias: 20, realizadas: 2, comAtendimento: 1 });
    expect(m.cs03.base).toBe(18.5);
  });
  it('sem go_live_em: zeros e dias 0', async () => {
    const T = await novoTenant(app.db);
    const m = await metricasDeSucesso(T.ctx, { fuso: 'America/Sao_Paulo', goLiveEm: null, taxaFaltasBase: null }, agora, app.db);
    expect(m.cs01).toEqual({ desde: null, dias: 0, realizadas: 0, comAtendimento: 0 });
  });
});

describe('admin (D15): só contagens pela função SECURITY DEFINER', () => {
  it('admin_metricas_sucesso devolve o CS-02 e as faltas do mês por tenant, fora do withTenant', async () => {
    const T = await novoTenant(app.db);
    const a = (await pacienteComConta(app.db, T)).paciente;
    await withTenant(T.ctx, (tx) => tx.insert(accessEvents).values({ tenantId: T.tenantId, patientId: a.id, dia: new Date().toISOString().slice(0, 10) }), app.db);
    const m = (await metricasDeSucessoPorTenant(app.db)).get(T.tenantId)!;
    expect(m).toMatchObject({ comConta: 1, abriram: 1 });
    await expect(withTenant(T.ctx, (tx) => tx.execute(sql`select * from admin_metricas_sucesso()`), app.db)).rejects.toThrow();
  });
  it('salvarMetricasBase: valida a taxa (0 a 100, vírgula) e a data', async () => {
    const T = await novoTenant(app.db);
    await salvarMetricasBase(T.tenantId, { taxaBase: '18,5', goLiveEm: '2026-10-01' }, app.db);
    const [t] = await app.db.select({ base: tenants.taxaFaltasBase, desde: tenants.goLiveEm }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect(t).toEqual({ base: 18.5, desde: '2026-10-01' });
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '120', goLiveEm: '' }, app.db)).rejects.toThrow(MSG_METRICAS.taxa);
    await expect(salvarMetricasBase(T.tenantId, { taxaBase: '', goLiveEm: '31/02/2026' }, app.db)).rejects.toThrow(MSG_METRICAS.data);
  });
});
```

(Conferir em `test/agenda.ts` se `consultaDireta` aceita `status` no `extra`; se a consulta exigir `fim` > `inicio`, o helper já monta com `minutos`.) As colunas obrigatórias de `consultations` são as do schema (`src/db/schema/pacientes.ts`); se houver outra obrigatória além de `tenantId`, `patientId` e `data`, preencher com o valor mínimo válido.

Run: `pnpm test src/modules/plataforma/metricas-sucesso.test.ts` → FAIL.

- [ ] **Step 2: Colunas** — `src/db/schema/platform.ts`, em `tenants` (imports `numeric`, `date`):

```ts
    /** CS-03 / P-15 (D15): taxa de faltas (%) do mês anterior ao sistema, informada pelo admin (E-08). */
    taxaFaltasBase: numeric('taxa_faltas_base', { precision: 5, scale: 2, mode: 'number' }),
    /** CS-01 (D15): dia em que a nutricionista passou a atender pelo sistema. */
    goLiveEm: date('go_live_em', { mode: 'string' }),
```

e no array de restrições: `check('tenants_taxa_faltas_base_valida', sql\`${t.taxaFaltasBase} is null or ${t.taxaFaltasBase} between 0 and 100\`),`. Run: `pnpm db:generate` → `drizzle/0086_metricas_sucesso.sql` (renomear o arquivo e a entrada do `_journal.json` para esse nome, como nos planos anteriores). Conferir que a migration só faz `ALTER TABLE "tenants" ADD COLUMN …` e o `ADD CONSTRAINT`.

- [ ] **Step 3: Função do admin** — `pnpm drizzle-kit generate --custom --name metricas_sucesso_admin`, conteúdo de `drizzle/0087_metricas_sucesso_admin.sql`:

```sql
-- P08-07 (D15): o admin vê só contagens do CS-02 e do CS-03 por tenant. Mesmo molde da admin_tenant_metrics (0059):
-- SECURITY DEFINER, entra tenant a tenant (RLS forçada), recusa rodar dentro de withTenant.
CREATE OR REPLACE FUNCTION admin_metricas_sucesso()
RETURNS TABLE (tenant_id uuid, pacientes_com_conta bigint, abriram_7_dias bigint, faltas_mes bigint, iniciadas_mes bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t record;
  v_hoje date;
  v_inicio_mes timestamptz;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_metricas_sucesso() não pode rodar dentro de withTenant' USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.fuso FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    v_hoje := (now() AT TIME ZONE t.fuso)::date;
    v_inicio_mes := date_trunc('month', now() AT TIME ZONE t.fuso) AT TIME ZONE t.fuso;
    tenant_id := t.id;
    SELECT count(*),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.access_events e WHERE e.tenant_id = p.tenant_id AND e.patient_id = p.id AND e.dia >= v_hoje - 6))
      INTO pacientes_com_conta, abriram_7_dias
      FROM public.patients p
     WHERE p.tenant_id = t.id AND p.status = 'ativo' AND p.user_id IS NOT NULL AND p.anonimizado_em IS NULL;
    SELECT count(*) FILTER (WHERE a.status = 'faltou'), count(*) FILTER (WHERE a.status <> 'cancelada')
      INTO faltas_mes, iniciadas_mes
      FROM public.appointments a
     WHERE a.tenant_id = t.id AND a.inicio >= v_inicio_mes AND a.inicio <= now();
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_metricas_sucesso() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_metricas_sucesso() TO nutri_app_role;
```

`src/db/migrate-owner.test.ts` (PR #11, B-3): acrescentar `admin_metricas_sucesso()` ao caso que confere as funções `SECURITY DEFINER` com o dono sem superusuário (mesmo formato do caso da `admin_tenant_metrics`).

- [ ] **Step 4: Módulo** — `src/modules/plataforma/metricas-sucesso.ts`

```ts
import { and, count, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { accessEvents, appointments, consultations, patients, tenants, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { inicioDoDia } from '@/modules/agenda/fuso';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';

export const META_CS02 = 0.6;
export const DIAS_CS01 = 30;
export const MSG_METRICAS = {
  taxa: 'Informe um percentual de 0 a 100',
  data: 'Informe a data no formato dd/mm/aaaa',
} as const;

export type MetricasSucesso = {
  cs01: { desde: string | null; dias: number; realizadas: number; comAtendimento: number };
  cs02: { comConta: number; abriram: number; porDia: { dia: string; n: number }[] };
  cs03: { base: number | null };
};

const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);

/**
 * §1.1 (D15): só contagens, sem auditRead (não devolve dado de saúde de ninguém — como a lista de pacientes). Uma
 * transação. CS-03 usa `indicadoresDaAgenda` (já no Início) + a base informada pelo admin.
 */
export async function metricasDeSucesso(
  ctx: TenantContext,
  tenant: Pick<TenantRow, 'fuso' | 'goLiveEm' | 'taxaFaltasBase'>,
  agora: Date,
  db: Db = getDb(),
): Promise<MetricasSucesso> {
  const hoje = hojeNoFuso(tenant.fuso, agora);
  const inicioJanela = somarDias(hoje, -6);
  const desde = tenant.goLiveEm;
  return withTenant(
    ctx,
    async (tx) => {
      const [c1] = desde
        ? await tx
            .select({
              realizadas: sql<number>`count(*) filter (where ${appointments.status} = 'realizada')`.mapWith(Number),
              comAtendimento: sql<number>`count(*) filter (where ${appointments.status} = 'realizada' and exists (select 1 from ${consultations} where ${consultations.appointmentId} = ${appointments.id}))`.mapWith(Number),
            })
            .from(appointments)
            .where(and(gte(appointments.inicio, inicioDoDia(desde, tenant.fuso)), lt(appointments.inicio, agora)))
        : [{ realizadas: 0, comAtendimento: 0 }];
      // a mesma população no número, no total e nas barras: paciente ativo, com conta e não anonimizado
      const populacaoCs02 = and(eq(patients.status, 'ativo'), isNotNull(patients.userId), isNull(patients.anonimizadoEm));
      const [c2] = await tx
        .select({
          comConta: count(),
          abriram: sql<number>`count(*) filter (where exists (select 1 from ${accessEvents} where ${accessEvents.patientId} = ${patients.id} and ${accessEvents.dia} >= ${inicioJanela}))`.mapWith(Number),
        })
        .from(patients)
        .where(populacaoCs02);
      const linhas = await tx
        .select({ dia: accessEvents.dia, n: count() })
        .from(accessEvents)
        .innerJoin(patients, eq(patients.id, accessEvents.patientId))
        .where(and(gte(accessEvents.dia, inicioJanela), populacaoCs02))
        .groupBy(accessEvents.dia);
      const porDia = Array.from({ length: 7 }, (_, i) => somarDias(inicioJanela, i)).map((dia) => ({ dia, n: linhas.find((l) => l.dia === dia)?.n ?? 0 }));
      return {
        cs01: { desde, dias: desde ? Math.max(0, diasEntre(desde, hoje) + 1) : 0, realizadas: c1.realizadas, comAtendimento: c1.comAtendimento },
        cs02: { comConta: c2.comConta, abriram: c2.abriram, porDia },
        cs03: { base: tenant.taxaFaltasBase },
      };
    },
    db,
  );
}

const taxaSchema = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : Number(v.replace(',', '.'))))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 100), MSG_METRICAS.taxa);
const dataSchema = z
  .string()
  .trim()
  .refine((v) => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v)), MSG_METRICAS.data)
  .transform((v) => (v === '' ? null : v));

/** D15: o admin grava a base do CS-03 (E-08) e o início do uso (CS-01). `tenants` não tem RLS; o id vem da tela do admin. */
export async function salvarMetricasBase(tenantId: string, entrada: { taxaBase: string; goLiveEm: string }, db: Db = getDb()): Promise<void> {
  const taxa = taxaSchema.safeParse(entrada.taxaBase);
  if (!taxa.success) throw new Error(MSG_METRICAS.taxa);
  const data = dataSchema.safeParse(entrada.goLiveEm);
  if (!data.success) throw new Error(MSG_METRICAS.data);
  await db.update(tenants).set({ taxaFaltasBase: taxa.data, goLiveEm: data.data, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}
```

(O `<input type="date">` manda `aaaa-mm-dd`; a mensagem diz o formato que a tela mostra.)

`src/modules/plataforma/metricas.ts`, acrescentar:

```ts
export type MetricasSucessoTenant = { comConta: number; abriram: number; faltasMes: number; iniciadasMes: number };

/** D15: CS-02 e CS-03 por tenant, só contagens (função SECURITY DEFINER, 0087). */
export async function metricasDeSucessoPorTenant(db: Db = getDb()): Promise<Map<string, MetricasSucessoTenant>> {
  const r = await db.execute<{ tenant_id: string; pacientes_com_conta: string; abriram_7_dias: string; faltas_mes: string; iniciadas_mes: string }>(
    sql`select * from admin_metricas_sucesso()`,
  );
  return new Map(
    r.rows.map((x) => [x.tenant_id, { comConta: Number(x.pacientes_com_conta), abriram: Number(x.abriram_7_dias), faltasMes: Number(x.faltas_mes), iniciadasMes: Number(x.iniciadas_mes) }]),
  );
}
```

Run: `pnpm test src/modules/plataforma` → PASS.

- [ ] **Step 5: Tela do admin** — `src/modules/plataforma/contas.ts`: acrescentar `taxaFaltasBase: tenants.taxaFaltasBase, goLiveEm: tenants.goLiveEm` ao `select` de `listarContas` (e ao tipo da linha). `src/app/admin/actions.ts`:

```ts
import { MSG_METRICAS, salvarMetricasBase } from '@/modules/plataforma/metricas-sucesso';

export type MetricasState = { ok?: boolean; erro?: string };

export async function salvarMetricasAction(tenantId: string, _prev: MetricasState, formData: FormData): Promise<MetricasState> {
  await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) return { erro: MSG_CONTA_NAO_ENCONTRADA };
  try {
    await salvarMetricasBase(tenantId, { taxaBase: campo(formData, 'taxaBase'), goLiveEm: campo(formData, 'goLiveEm') });
  } catch (e) {
    if (e instanceof Error && (e.message === MSG_METRICAS.taxa || e.message === MSG_METRICAS.data)) return { erro: e.message };
    throw e;
  }
  revalidatePath('/admin');
  return { ok: true };
}
```

`src/app/admin/metricas-form.tsx`

```tsx
'use client';

import { useActionState } from 'react';
import { salvarMetricasAction, type MetricasState } from './actions';

/** D15: base do CS-03 (P-15, informada pela Debby no E-08) e início do uso (CS-01). */
export function MetricasForm({ tenantId, conta, taxaBase, goLiveEm }: { tenantId: string; conta: string; taxaBase: number | null; goLiveEm: string | null }) {
  const [state, action, pendente] = useActionState<MetricasState, FormData>(salvarMetricasAction.bind(null, tenantId), {});
  const id = `metricas-${tenantId}`;
  return (
    <form action={action} className="space-y-1">
      <label htmlFor={`${id}-taxa`} className="block text-sm">Taxa de faltas antes do sistema (%)<span className="sr-only">{` de ${conta}`}</span></label>
      <input id={`${id}-taxa`} name="taxaBase" inputMode="decimal" defaultValue={taxaBase === null ? '' : String(taxaBase).replace('.', ',')} className="w-24 rounded border p-1" aria-describedby={state.erro ? `${id}-erro` : undefined} />
      <label htmlFor={`${id}-data`} className="block text-sm">Início do uso<span className="sr-only">{` de ${conta}`}</span></label>
      <input id={`${id}-data`} name="goLiveEm" type="date" defaultValue={goLiveEm ?? ''} className="rounded border p-1" />
      <button disabled={pendente} className="block underline">Salvar<span className="sr-only">{` as métricas de ${conta}`}</span></button>
      {state.erro && <span id={`${id}-erro`} role="alert" className="text-red-700">{state.erro}</span>}
      {state.ok && <span role="status">Métricas salvas.</span>}
    </form>
  );
}
```

`src/app/admin/page.tsx`: `const [contas, metricas, sucesso] = await Promise.all([listarContas(), metricasPorTenant(), metricasDeSucessoPorTenant()]);`; duas colunas novas depois de "Consultas no mês" — `<th scope="col">App na semana</th>` e `<th scope="col">Faltas no mês</th>` — e uma depois de "Armazenamento" — `<th scope="col">Métricas de sucesso</th>`; nas linhas:

```tsx
              <td>{(() => { const s = sucesso.get(c.tenantId); return s && s.comConta ? `${s.abriram} de ${s.comConta} (${Math.round((s.abriram / s.comConta) * 100)}%)` : '—'; })()}</td>
              <td>{(() => { const s = sucesso.get(c.tenantId); return s && s.iniciadasMes ? textoTaxa(s.faltasMes / s.iniciadasMes, s.faltasMes, s.iniciadasMes) : '—'; })()}</td>
              {/* … */}
              <td><MetricasForm tenantId={c.tenantId} conta={c.nomeExibicao} taxaBase={c.taxaFaltasBase} goLiveEm={c.goLiveEm} /></td>
```

(`textoTaxa` de `@/modules/agenda/presenca` — só formata número; o admin continua sem ler tabela com `tenant_id`: a guarda `src/app/admin/sem-tabelas-tenant.test.ts` precisa seguir verde.) O cartão da nutricionista com essas métricas entra no Início na Tarefa 15.

Run: `pnpm test src/app/admin src/modules/plataforma && pnpm build` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/platform.ts drizzle/0086_metricas_sucesso.sql drizzle/0087_metricas_sucesso_admin.sql drizzle/meta src/modules/plataforma/metricas-sucesso.ts src/modules/plataforma/metricas-sucesso.test.ts src/modules/plataforma/metricas.ts src/modules/plataforma/contas.ts src/app/admin src/db/migrate-owner.test.ts
git commit -m "feat(metricas): CS-01 a CS-03 para a nutricionista e contagens para o admin, com a base do CS-03 (P08-07, D15)"
```

---

### Task 10: Teste de carga com k6 e Lighthouse (P08-03; RNF-01, RNF-02; D4, D5; notas N9, N14, N20; débitos S-7, B-8)

**Files:**
- Create: `docker-compose.carga.yml`, `test/carga/gerar-env.sh`, `test/carga/seed.ts`, `test/carga/cenario.js`, `docs/operacao/carga.md`
- Modify: `.gitignore` (`test/carga/.sessoes.json`)

**Interfaces:**
- Consumes: a imagem que o **deploy do merge do Plano 08** publica no GHCR (`ghcr.io/<dono>/nutridebby:<sha do merge na main>`) — não existe imagem do branch: o `ci.yml` constrói com `push: false`, o `deploy.yml` só publica em push na `main` e a RNF-03 proíbe construir na VPS; a imagem da `main` de antes do merge também não serve (a semente usa o `createAuth` com o `additionalFields` `tema`, que falha num banco sem a 0088). Por isso a carga roda **depois do merge e antes de qualquer paciente real** (o checklist da Tarefa 21 já bloqueia ali); `entrar` (`test/sessao.ts`); `consultaDireta` (`test/agenda.ts`); `agendarLembretes` (`src/modules/notificacoes/agendar.ts`); `pushSubscriptions` (schema); `novoConteudo`, `novaEtiqueta` (`test/conteudos.ts`, Plano 07); `criarRascunho`, `salvarRascunho` (`rascunho.ts`), `revisaoDoPlano` (`carregar.ts`), `publicarPlano` (`publicacao.ts`); `createAuth` (`src/lib/auth.ts`); `hashPassword` (`password.server.ts`); `DPA_VERSAO`, `TERMO_PACIENTE`.
- Produces: `test/carga/.sessoes.json` (fora do git: cookies e inscrições de push sintéticas da pilha de carga) e o relatório `docs/operacao/carga-AAAA-MM-DD.md` (preenchido pelo executor a partir de `docs/operacao/carga.md`; entra num **PR curto de docs** depois do merge, não no PR do Plano 08).

- [ ] **Step 1: Pilha de carga** — `docker-compose.carga.yml`

```yaml
name: nutridebby-carga
# P08-03 (D5): pilha de carga SEPARADA — banco próprio, dados sintéticos, portas só em 127.0.0.1. Nunca aponta para o
# banco de produção. Sobe na VPS só com OK do dono, de madrugada (horário de Brasília), e é derrubada no fim (down -v).
# Mesmos limites do Easypanel na rodada 1; na rodada 2, os que o dono decidir (variáveis CARGA_*).
# Imagem: a do deploy do merge do Plano 08 (o GHCR não tem imagem de branch; a RNF-03 proíbe construir aqui).
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: carga_owner
      POSTGRES_PASSWORD: ${CARGA_OWNER_SENHA:?gere com test/carga/gerar-env.sh}
      POSTGRES_DB: nutri
    command: ['postgres', '-c', 'shared_buffers=${CARGA_SHARED_BUFFERS:-128MB}', '-c', 'max_connections=100']
    ports: ['127.0.0.1:54339:5432']
    mem_limit: ${CARGA_DB_MEM:-1g}
    volumes: ['nd-carga-db:/var/lib/postgresql/data']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U carga_owner -d nutri']
      interval: 5s
      retries: 20
  mailpit:
    image: axllent/mailpit:v1.27
    mem_limit: 128m
  app:
    image: ${CARGA_IMAGEM:?ghcr.io/<dono>/nutridebby:<sha do merge na main>}
    env_file: .env.carga
    # B-8: só o app tem a chave pública (o POST /api/p/push responde 503 sem ela); o worker fica sem as chaves VAPID,
    # então nenhum push sai da pilha para o FCM com as inscrições sintéticas
    environment:
      VAPID_PUBLIC_KEY: ${CARGA_VAPID_PUBLICA:?gere com test/carga/gerar-env.sh}
    ports: ['127.0.0.1:3200:3000']
    cpus: ${CARGA_APP_CPUS:-1}
    mem_limit: ${CARGA_APP_MEM:-1g}
    tmpfs: ['/data']
    depends_on: { db: { condition: service_healthy } }
  worker:
    image: ${CARGA_IMAGEM}
    command: ['worker']
    env_file: .env.carga
    cpus: ${CARGA_WORKER_CPUS:-1}
    mem_limit: ${CARGA_WORKER_MEM:-1g}
    tmpfs: ['/data']
    depends_on: { app: { condition: service_started } }
volumes:
  nd-carga-db:
```

`test/carga/gerar-env.sh` (segredos novos, só da pilha de carga; nada de produção):

```bash
#!/usr/bin/env bash
# P08-03: gera .env.carga com segredos novos (nunca os de produção). Uso: bash test/carga/gerar-env.sh > .env.carga
set -euo pipefail
owner="$(openssl rand -hex 16)"; app="$(openssl rand -hex 16)"
# B-8: par VAPID novo, só da carga (a chave pública vai só para o app; a privada é descartada)
vapid="$(node -e "console.log(require('web-push').generateVAPIDKeys().publicKey)")"
printf 'CARGA_OWNER_SENHA=%s\nCARGA_VAPID_PUBLICA=%s\n' "${owner}" "${vapid}" > .env.carga.compose
cat <<EOF
NODE_ENV=production
APP_URL=http://localhost:3200
DATABASE_URL=postgres://nutri_app:${app}@db:5432/nutri
DATABASE_URL_MIGRATOR=postgres://carga_owner:${owner}@db:5432/nutri
AUTH_SECRET=$(openssl rand -base64 48)
ENCRYPTION_KEY=$(openssl rand -base64 32)
FILE_URL_SECRET=$(openssl rand -base64 48)
DATA_DIR=/data
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
TRUSTED_PROXIES=172.16.0.0/12
EMAIL_FROM=NutriDebby Carga <carga@nutridebby.test>
EMAIL_TRANSPORT=mailpit
MAILPIT_URL=http://mailpit:8025
LOG_LEVEL=warn
EOF
```

(`APP_URL` em `localhost` deixa a validação aceitar as chaves de teste do Turnstile e o `NODE_ENV=production`; `.env.carga*` já está no `.gitignore` por `.env*`. Sem `SENTRY_DSN` na rodada 1; na rodada 2, o DSN de um projeto **de teste** do Sentry, para medir o custo do SDK.)

- [ ] **Step 2: Semente de volume** — `test/carga/seed.ts` (roda no host contra `127.0.0.1:54339`; nunca importado pelo app nem pelo Vitest — não termina em `.test.ts`)

```ts
/**
 * P08-03 (D5): 50 consultórios × 300 pacientes ativos com conta (RNF-02), agenda do mês, acessos de 30 dias,
 * 100 conteúdos por consultório (Plano 07) e as sessões dos usuários virtuais do k6. SÓ na pilha de carga:
 * recusa qualquer banco que não seja o da porta 54339 em 127.0.0.1.
 * Uso: CARGA_DATABASE_URL=postgres://nutri_app:<senha>@127.0.0.1:54339/nutri CARGA_AUTH_SECRET=<o do .env.carga> pnpm tsx test/carga/seed.ts
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { PgBoss } from 'pg-boss';
import * as schema from '@/db/schema';
import { account, accessEvents, consents, patients, pushSubscriptions, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { createAuth } from '@/lib/auth';
import { hashPassword } from '@/lib/password.server';
import { agendarLembretes } from '@/modules/notificacoes/agendar';
import { revisaoDoPlano } from '@/modules/plano-alimentar/carregar';
import { publicarPlano } from '@/modules/plano-alimentar/publicacao';
import { criarRascunho, salvarRascunho } from '@/modules/plano-alimentar/rascunho';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { consultaDireta } from '../agenda';
import { novaEtiqueta, novoConteudo } from '../conteudos';
import type { TenantDeTeste } from '../pacientes';
import { entrar, SENHA_TESTE } from '../sessao';

const URL_DB = process.env.CARGA_DATABASE_URL ?? '';
const u = new URL(URL_DB);
if (u.hostname !== '127.0.0.1' || u.port !== '54339') throw new Error('seed de carga só roda na pilha de carga (127.0.0.1:54339)');
const SEGREDO = process.env.CARGA_AUTH_SECRET ?? '';
if (SEGREDO.length < 32) throw new Error('CARGA_AUTH_SECRET: o AUTH_SECRET do .env.carga');

const TENANTS = Number(process.env.CARGA_TENANTS ?? 50);
const PACIENTES = Number(process.env.CARGA_PACIENTES ?? 300);
const SESSOES_POR_TENANT = 6; // 300 pacientes com sessão no total: os VUs do k6 se revezam entre eles
const pool = new Pool({ connectionString: URL_DB, max: 8 });
const db = drizzle({ client: pool, schema });
const auth = createAuth(db, { baseURL: 'http://localhost:3000', secret: SEGREDO, verificarTurnstile: async () => 'ok' });
const boss = new PgBoss({ connectionString: URL_DB });
await boss.start();
const hash = await hashPassword(SENHA_TESTE); // um hash para todas as contas (argon2 é lento de propósito)
const fuso = 'America/Sao_Paulo';
const agora = new Date();
type Inscricao = { endpoint: string; keys: { p256dh: string; auth: string } };
const sessoes: { pacientes: { cookie: string; conteudo: string; inscricao: Inscricao }[]; nutris: { cookie: string; pacientes: string[]; planos: string[] }[]; slugs: string[] } = { pacientes: [], nutris: [], slugs: [] };
const tenantIds: string[] = [];
const alimentos = (await db.execute<{ id: string }>(sql`select id from foods where tenant_id is null order by id limit 6`)).rows.map((r) => r.id);

for (let t = 0; t < TENANTS; t++) {
  const slug = `carga-${String(t).padStart(2, '0')}`;
  const [tn] = await db.insert(tenants).values({ slug, nomeExibicao: `Consultório Carga ${t}`, dpaVersao: DPA_VERSAO, dpaAceitoEm: agora, agendamentoPublicoAtivo: true }).returning({ id: tenants.id });
  tenantIds.push(tn.id);
  const nutriId = randomUUID();
  const emailNutri = `nutri-${slug}@carga.test`;
  await db.insert(user).values({ id: nutriId, name: `Nutri ${t}`, email: emailNutri, emailVerified: true, appRole: 'nutri', tenantId: tn.id });
  await db.insert(account).values({ id: randomUUID(), userId: nutriId, accountId: nutriId, providerId: 'credential', password: hash });
  const ctx: TenantContext = { tenantId: tn.id, role: 'nutri', actorUserId: nutriId, ip: '127.0.0.1' };
  const T: TenantDeTeste = { tenantId: tn.id, nutriId, ctx, tenant: { fuso, nomeExibicao: `Consultório Carga ${t}` } };

  // 300 pacientes ativos, todos com conta e o termo aceito
  const ids: { id: string; userId: string; email: string }[] = [];
  for (let p = 0; p < PACIENTES; p++) {
    const userId = randomUUID();
    const email = `p${p}-${slug}@carga.test`;
    ids.push({ id: randomUUID(), userId, email });
  }
  await db.insert(user).values(ids.map((x, i) => ({ id: x.userId, name: `Paciente ${i}`, email: x.email, emailVerified: true, appRole: 'paciente' })));
  await db.insert(account).values(ids.map((x) => ({ id: randomUUID(), userId: x.userId, accountId: x.userId, providerId: 'credential', password: hash })));
  await withTenant(ctx, (tx) => tx.insert(patients).values(ids.map((x, i) => ({ id: x.id, tenantId: tn.id, nome: `Paciente ${i} ${slug}`, email: x.email, userId: x.userId, dataNascimento: '1990-01-01', sexo: i % 2 ? 'F' : 'M' }))), db);
  await db.insert(consents).values(ids.map((x) => ({ userId: x.userId, tenantId: tn.id, termoVersao: TERMO_PACIENTE, ip: null })));

  // agenda do mês: 8 consultas por dia útil, espalhadas entre os pacientes (varredura de notificações, N9).
  // consultaDireta grava "sem regra, sem lembrete" (test/agenda.ts): as futuras ganham os lembretes pela função real
  // (agendarLembretes, a mesma da marcação) — senão `notifications` fica vazia e a meta da D4 não é medida
  for (let d = -10; d <= 20; d++) {
    const dia = new Date(agora.getTime() + d * 86_400_000);
    if ([0, 6].includes(dia.getUTCDay())) continue;
    for (let h = 0; h < 8; h++) {
      const inicio = new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), 11 + h, 0));
      const patientId = ids[(d * 8 + h + 400) % PACIENTES].id;
      const appointmentId = await consultaDireta(db, ctx, patientId, inicio, 60, d < 0 ? { status: 'realizada' } : {});
      if (inicio > agora) await withTenant(ctx, (tx) => agendarLembretes(tx, { tenantId: tn.id, patientId, appointmentId, inicio }, fuso, agora), db);
    }
  }
  // acessos dos últimos 30 dias (CS-02): ~60% dos pacientes por dia
  const acessos = [];
  for (let d = 0; d < 30; d++) {
    const dia = new Date(agora.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    for (const x of ids) if ((x.id.charCodeAt(0) + d) % 5 < 3) acessos.push({ tenantId: tn.id, patientId: x.id, dia });
  }
  for (let i = 0; i < acessos.length; i += 2000) await withTenant(ctx, (tx) => tx.insert(accessEvents).values(acessos.slice(i, i + 2000)).onConflictDoNothing(), db);

  // 100 conteúdos (Plano 07): 70 para todos, 20 por etiqueta de paciente, 10 para pacientes específicos (N20)
  const etiqueta = await novaEtiqueta(db, T, 'gestante', ids.slice(0, 60).map((x) => x.id));
  const conteudos: string[] = [];
  for (let c = 0; c < 100; c++) {
    const extra = c < 70 ? {} : c < 90 ? { visibilidade: 'etiquetas' as const, tags: [etiqueta] } : { visibilidade: 'pacientes' as const, pacientes: ids.slice(c, c + 20).map((x) => x.id) };
    const row = await novoConteudo(db, T, { titulo: `Conteúdo ${c} com aveia`, resumo: 'Receita sem lactose', etiquetas: ['sem lactose'], ...extra });
    if (c < 70) conteudos.push(row.id);
  }

  // planos publicados e sessões só para os pacientes que o k6 usa
  const planos: string[] = [];
  for (const x of ids.slice(0, SESSOES_POR_TENANT)) {
    const { id: planId } = await criarRascunho(ctx, x.id, { db });
    const revisao = (await revisaoDoPlano(ctx, planId, x.id, db)) ?? 0;
    const refeicao = randomUUID();
    await salvarRascunho(ctx, planId, {
      revisao, envio: randomUUID(), titulo: 'Plano de carga', metaKcal: '1800', mostrarCalorias: true, orientacoes: '',
      refeicoes: [{ id: refeicao, nome: 'Almoço', horario: '12:00', observacao: '', itens: alimentos.map((foodId) => ({ id: randomUUID(), foodId, quantidadeG: '100', medida: null, substituiItemId: null })) }],
    }, { db });
    await publicarPlano(ctx, x.id, planId, { db, boss });
    planos.push(planId);
    // B-8: uma inscrição de push sintética (formato do Zod de push-inscricao.ts) já gravada, para o
    // POST /api/p/push?sincronizar=1 do k6 percorrer o app_soltar_endpoint_push com 50 tenants e responder 204
    const inscricao: Inscricao = {
      endpoint: `https://fcm.googleapis.com/fcm/send/carga-${randomUUID()}`,
      keys: { p256dh: randomBytes(65).toString('base64url'), auth: randomBytes(16).toString('base64url') },
    };
    const ctxPaciente: TenantContext = { tenantId: tn.id, role: 'paciente', patientId: x.id, actorUserId: x.userId, ip: '127.0.0.1' };
    await withTenant(ctxPaciente, (tx) => tx.insert(pushSubscriptions).values({ tenantId: tn.id, patientId: x.id, endpoint: inscricao.endpoint, p256dh: inscricao.keys.p256dh, auth: inscricao.keys.auth, userAgent: 'k6' }), db);
    sessoes.pacientes.push({ cookie: await entrar(auth, x.email), conteudo: conteudos[sessoes.pacientes.length % conteudos.length], inscricao });
  }
  sessoes.nutris.push({ cookie: await entrar(auth, emailNutri), pacientes: ids.slice(0, 50).map((x) => x.id), planos });
  sessoes.slugs.push(slug);
  console.log(`${slug}: ${PACIENTES} pacientes, ${acessos.length} acessos, 100 conteúdos`);
}

// D4: parte dos lembretes vence DURANTE a rodada (o job `notificacoes` varre e envia de verdade, para o Mailpit).
// CARGA_VENCER_EM_MIN: minutos entre o fim da semente e o início da rodada; os vencimentos se espalham por 12 min.
const VENCER_EM_MIN = Number(process.env.CARGA_VENCER_EM_MIN ?? 20);
for (const tenantId of tenantIds) {
  await withTenant({ tenantId, role: 'worker' }, (tx) => tx.execute(sql`
    update notifications set agendada_para = now() + make_interval(mins => ${VENCER_EM_MIN}) + random() * interval '12 minutes'
    where id in (select id from notifications where status = 'pendente' order by random() limit 150)`), db);
}

writeFileSync('test/carga/.sessoes.json', JSON.stringify(sessoes));
await boss.stop();
await pool.end();
console.log('pronto: test/carga/.sessoes.json');
```

(Conferir no código do Plano 07 a assinatura final de `novoConteudo` (campos `visibilidade`, `tags`, `pacientes`, `etiquetas`) e no Plano 04 o tipo de `deps` de `criarRascunho`/`salvarRascunho`/`publicarPlano` — este seed usa só os campos que os planos declaram.)

`.gitignore`: acrescentar `test/carga/.sessoes.json`.

- [ ] **Step 3: Cenário do k6** — `test/carga/cenario.js`

```js
// P08-03 (RNF-01, RNF-02, D4): 100 VUs — 70 pacientes, 25 nutricionistas, 5 visitantes da página pública.
// docker run --rm --network host -v "$PWD/test/carga:/carga" -e BASE_URL=http://127.0.0.1:3200 grafana/k6 run /carga/cenario.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3200';
const S = JSON.parse(open('./.sessoes.json'));
const pacientes = new SharedArray('pacientes', () => S.pacientes);
const nutris = new SharedArray('nutris', () => S.nutris);
const slugs = new SharedArray('slugs', () => S.slugs);

// 429 é esperado em alguns envios (MAX_ENVIOS do diário, limite do push): não conta como falha
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

const rampa = (alvo) => [{ duration: '2m', target: alvo }, { duration: '10m', target: alvo }, { duration: '1m', target: 0 }];
export const options = {
  scenarios: {
    paciente: { executor: 'ramping-vus', exec: 'paciente', stages: rampa(70) },
    nutri: { executor: 'ramping-vus', exec: 'nutri', stages: rampa(25) },
    publico: { executor: 'ramping-vus', exec: 'publico', stages: rampa(5) },
  },
  thresholds: {
    'http_req_duration{tipo:api}': ['p(95)<300'], // RNF-01 (Route Handlers)
    'http_req_duration{tipo:pagina}': ['p(95)<800'], // D4 (páginas)
    'http_req_duration{nome:/api/p/push}': ['p(95)<300'], // B-8: app_soltar_endpoint_push com 50 tenants (linha própria no resumo)
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

const nome = (url) => url.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id');
const pagina = (url, cookie) => {
  const r = http.get(`${BASE}${url}`, { headers: { cookie }, redirects: 0, tags: { tipo: 'pagina', nome: nome(url) } });
  check(r, { 'página 200 (sessão válida)': (x) => x.status === 200 });
  return r;
};
const api = (metodo, url, cookie, corpo = null) => {
  const headers = corpo === null ? { cookie } : { cookie, 'content-type': 'application/json' };
  const r = http.request(metodo, `${BASE}${url}`, corpo === null ? null : JSON.stringify(corpo), { headers, tags: { tipo: 'api', nome: nome(url) } });
  check(r, { 'api 2xx/429': (x) => (x.status >= 200 && x.status < 300) || x.status === 429 });
  return r;
};
const pausa = () => sleep(1 + Math.random() * 2);

export function paciente() {
  const p = pacientes[(__VU * 7 + __ITER) % pacientes.length];
  api('POST', '/api/p/acesso', p.cookie); // N14: uma "abertura" do app
  api('POST', '/api/p/push?sincronizar=1', p.cookie, p.inscricao); // B-8: a sincronização da abertura (204; 429 = limite da T6)
  for (const url of ['/p/inicio', '/p/plano', '/p/agenda', '/p/conteudos', '/p/conteudos?busca=aveia', '/p/conteudos?etiqueta=sem%20lactose', `/p/conteudos/${p.conteudo}`, '/p/diario']) {
    pagina(url, p.cookie);
    pausa();
  }
}

export function nutri() {
  const n = nutris[(__VU + __ITER) % nutris.length];
  const pid = n.pacientes[__ITER % n.pacientes.length];
  for (const url of ['/painel', '/painel/agenda', '/painel/pacientes', `/painel/pacientes/${pid}`, `/painel/pacientes/${pid}/antropometria`, '/painel/conteudos']) {
    pagina(url, n.cookie);
    pausa();
  }
  if (n.planos.length) {
    const plano = n.planos[__ITER % n.planos.length];
    api('GET', `/api/painel/planos/${plano}`, n.cookie);
    api('GET', `/api/painel/planos/${plano}/revisao`, n.cookie);
  }
  api('GET', '/api/painel/alimentos?q=arroz', n.cookie);
  pausa();
}

export function publico() {
  pagina(`/n/${slugs[__ITER % slugs.length]}`, '');
  pausa();
}
```

Antes da rodada de verdade, uma rodada curta de fumaça com `--vus 3 --duration 30s` na linha de comando (sobrescreve os cenários).

- [ ] **Step 4: Roteiro e relatório** — `docs/operacao/carga.md` (o modelo; cada rodada vira `docs/operacao/carga-AAAA-MM-DD.md`):

```markdown
# Teste de carga (P08-03) — roteiro e modelo de relatório

**Nunca contra produção nem com dado real.** Cada passo com a VPS pede OK do dono. Horário: madrugada (Brasília).

## Roteiro
1. Snapshot no hPanel (regra do servidor) e OK do dono para subir a pilha `nutridebby-carga`.
2. **Depois do merge do Plano 08 e antes de qualquer paciente real** (o GHCR só tem a imagem do deploy da `main`; a RNF-03 proíbe construir na VPS). `bash test/carga/gerar-env.sh > .env.carga` e `CARGA_IMAGEM=ghcr.io/<dono>/nutridebby:<sha do merge na main> docker compose -f docker-compose.carga.yml --env-file .env.carga.compose up -d` (o app aplica as migrations ao subir).
3. Com o checkout do repositório no mesmo commit da imagem: `CARGA_DATABASE_URL=postgres://nutri_app:<senha do .env.carga>@127.0.0.1:54339/nutri CARGA_AUTH_SECRET=<AUTH_SECRET do .env.carga> CARGA_VENCER_EM_MIN=<minutos até a rodada> pnpm tsx test/carga/seed.ts` (sem exibir os valores na tela: ler do arquivo com `set -a; . ./.env.carga; set +a` num shell e montar a URL).
4. Em outro terminal, `docker stats` gravando em arquivo (`docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'` a cada 10 s) — inclui o `cursoia_crm` (não pode piorar) e os containers da carga.
5. Fumaça: `docker run --rm --network host -v "$PWD/test/carga:/carga" grafana/k6 run --vus 3 --duration 30s /carga/cenario.js`.
6. Rodada: `docker run --rm --network host -v "$PWD/test/carga:/carga" -e BASE_URL=http://127.0.0.1:3200 grafana/k6 run --summary-export /carga/resumo.json /carga/cenario.js`.
7. Worker com o volume: antes da rodada, o total de lembretes (`docker compose -f docker-compose.carga.yml exec db psql -U carga_owner -d nutri -c "select status, count(*) from notifications group by status"`; esperado: milhares de `pendente`, ~150 por consultório vencendo durante a rodada — com `notifications` vazia a meta não está sendo medida, parar e corrigir a semente). Depois, a duração do job `notificacoes` (roda a cada minuto; meta D4: < 20 s) pelas colunas `started_on`/`completed_on` da tabela `pgboss.job` do banco **da carga** (`select max(completed_on - started_on) from pgboss.job where name = 'notificacoes' and state = 'completed'`) e quantas linhas a varredura tratou (`select status, count(*) from notifications where updated_at >= '<início da rodada>' group by status` — enviadas, ignoradas e adiadas pelo horário silencioso contam). `retencao-lgpd` (04h) e `agenda-limpeza` (04h30) entram no relatório se a rodada passar desses horários.
8. S-7: anotar o p95 das páginas `/p/*` (cenário `paciente`). A imagem já tem o `cache()` da Tarefa 14 em `requireUserComTenant`, que o `requirePaciente` também usa; a parte própria do paciente (`vinculosDaConta`, `termoAceito`) **não** ganha `cache()` neste plano — não há "antes/depois". Se o p95 de `/p/*` passar da meta da D4, o relatório propõe o `cache()` no `requirePaciente` como tarefa.
9. Lighthouse (LCP, D4), com a pilha no ar e uma sessão de paciente: `pnpm dlx lighthouse@12 http://127.0.0.1:3200/p/inicio --preset=perf --form-factor=mobile --throttling-method=simulate --extra-headers='{"cookie":"<cookie de .sessoes.json>"}' --output=json --output-path=/tmp/lh-inicio.json` e o mesmo para `/p/plano`; anotar o `largest-contentful-paint`. (O perfil móvel padrão do Lighthouse é o "Slow 4G" da RNF-01.)
10. `docker compose -f docker-compose.carga.yml down -v` e apagar `.env.carga*` e `test/carga/.sessoes.json`.

## Relatório (copiar para carga-AAAA-MM-DD.md)
- Commit/imagem: · Limites (app/worker/db, shared_buffers, pool): · Rodada: 1 / 2
- k6: p95 api: · p95 páginas: · falhas: · checks: · pior rota (p95):
- Worker: lembretes pendentes antes da rodada: · tratados durante a rodada (por status): · `notificacoes` com 15 mil pacientes (máx.): · `agenda-limpeza`:
- `docker stats`: pico de CPU/memória por container · `cursoia_crm`: sem mudança? · CPU livre mínima:
- Lighthouse: LCP `/p/inicio`: · LCP `/p/plano`:
- B-8 (`app_soltar_endpoint_push` com 50 tenants): p95 do `POST /api/p/push?sincronizar=1` (tag `nome:/api/p/push`): · respostas 204/409/429:
- S-7: p95 das páginas `/p/*`:
- Gargalo e ajuste proposto ao dono (limites no Easypanel, `shared_buffers`, pool):
- Resultado contra a D4: aprovado / reprovado (o quê)
```

- [ ] **Step 5: Execução (rodada 1 e rodada 2)** — seguir o roteiro com o dono. Rodada 1 com os limites atuais (`nutri_app` 1 vCPU/1 GiB, `nutri_db` 1 GiB, `nutri_worker` 1 vCPU/1 GiB, pool 10, `shared_buffers` 128 MB). Se reprovar, o relatório propõe os limites novos (há folga com 8 vCPU/32 GB); o dono muda **no Easypanel** (produção) e nas variáveis `CARGA_*` (carga); rodada 2 com Sentry (projeto de teste). As duas rodadas usam a imagem do deploy do merge (CSP e `cache()` da Tarefa 14 já dentro). Os dois relatórios entram num **PR curto de docs** (`docs/carga-AAAA-MM-DD`, a partir da `main`); se a rodada pedir mudança de código, é outro PR, com nova rodada antes do primeiro paciente real.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.carga.yml test/carga/gerar-env.sh test/carga/seed.ts test/carga/cenario.js docs/operacao/carga.md .gitignore
git commit -m "test(carga): pilha de carga separada, semente de 15 mil pacientes, cenário k6 e roteiro com Lighthouse (P08-03, D4, D5)"
# depois de cada rodada, num branch de docs a partir da main (o Plano 08 já foi mergeado):
git add docs/operacao/carga-*.md && git commit -m "docs(carga): relatório da rodada N do k6 (P08-03)"
```

---

### Task 11: Teste de restauração do backup, documentado (P08-04; RNF-05; D6)

**Files:**
- Create: `scripts/backup/nutri-restauracao-teste.sh`, `test/restauracao.test.ts`, `docs/operacao/restauracao.md`
- Modify: `scripts/backup/nutri-backup.sh` (roles), `test/backup.test.ts`

**Interfaces:**
- Consumes: o remoto `crypt` do backup (`NUTRI_BACKUP_REMOTE`), o dump diário `db/diario/nutri-<dia>.dump`; Docker no host.
- Produces: `db/globais.sql` no remoto (roles sem senha, D6); o script de restauração imprime uma linha `restauracao ok: duracao=<s>s tabelas_sem_rls=<n> migrations=<n> tenants=<n> pacientes=<n> funcoes_definer_superusuario=<n> roles=<ok|faltando>` (só contagens) e sai 0 só se o banco ficou pronto (servidor definitivo, por TCP), o `pg_restore` deu certo, `tabelas_sem_rls=0`, `roles=ok` e `funcoes_definer_superusuario=0` (este último relaxado só por `NUTRI_RESTAURAR_PERMITIR_DEFINER_SUPER=1`, que só o teste do CI usa — lá as migrations rodam como superusuário do Testcontainers).

- [ ] **Step 1: Teste do backup com os roles (falha)** — `test/backup.test.ts`, no caso "domingo: …", acrescentar ao fim:

```ts
    // D6 (P08-04): os roles (sem senha) vão junto, para a restauração recriar donos e grants
    const globais = (await cat('db/globais.sql')).toString();
    expect(globais).toContain('nutri_app_role');
    expect(globais).not.toMatch(/PASSWORD\s+'/i);
```

Run: `pnpm test test/backup.test.ts` → FAIL (sem `db/globais.sql`).

- [ ] **Step 2: Script do backup** — `scripts/backup/nutri-backup.sh`, em `backup_banco`, logo depois do bloco que copia o semanal (`if [ "$(date -d "$HOJE" +%u)" = 7 ]; then … fi`):

```bash
    # D6 (P08-04): roles sem senha — a restauração precisa deles antes do pg_restore (donos das funções SECURITY DEFINER)
    if ! docker exec "$DB" pg_dumpall -U "$DB_USER" --globals-only --no-role-passwords 2>/dev/null \
      | rclone rcat "${REMOTO}db/globais.sql" >/dev/null 2>&1; then
      ok=false
      detalhe="roles falhou"
    fi
```

e trocar a linha `if [ "$ok" = false ]; then detalhe="retenção falhou"; fi` por `if [ "$ok" = false ] && [ -z "$detalhe" ]; then detalhe="retenção falhou"; fi`. Run: `pnpm test test/backup.test.ts` → PASS (todos os casos antigos também). **Mudou o script → o dono reinstala no host** (regra 10; runbook, passo 3).

- [ ] **Step 3: Teste da restauração (falha)** — `test/restauracao.test.ts`

```ts
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

const execFile = promisify(execFileCb);
const tem = (cmd: string) => {
  try {
    execFileSync(cmd, ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const temRclone = tem('rclone');
if (process.env.CI && !temRclone) throw new Error('rclone é obrigatório no CI (teste da restauração, P08-04)');

const BACKUP = path.resolve('scripts/backup/nutri-backup.sh');
const RESTAURAR = path.resolve('scripts/backup/nutri-restauracao-teste.sh');

describe.skipIf(!temRclone)('teste de restauração (RNF-05, P08-04)', () => {
  let base = '';
  let env = {} as NodeJS.ProcessEnv;

  beforeAll(async () => {
    base = mkdtempSync(path.join(tmpdir(), 'nd-restaura-'));
    const destino = path.join(base, 'r2');
    const dados = path.join(base, 'data');
    mkdirSync(destino);
    mkdirSync(path.join(dados, 't1', 'logo'), { recursive: true });
    writeFileSync(path.join(dados, 't1', 'logo', 'a.png'), 'x');
    const senha = execFileSync('rclone', ['obscure', randomBytes(24).toString('hex')]).toString().trim();
    env = {
      PATH: process.env.PATH,
      ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}),
      HOME: base,
      RCLONE_CONFIG: path.join(base, 'rclone.conf'),
      RCLONE_CONFIG_CRIPTO_TYPE: 'crypt',
      RCLONE_CONFIG_CRIPTO_REMOTE: destino,
      RCLONE_CONFIG_CRIPTO_PASSWORD: senha,
      NUTRI_BACKUP_REMOTE: 'cripto:',
      NUTRI_DATA_DIR: dados,
      NUTRI_DB_CONTAINER: inject('pgContainerId'),
      NUTRI_DB_USER: inject('pgUser'),
      NUTRI_DB_NAME: inject('pgDatabase'),
      NUTRI_BACKUP_TODAY: '2026-10-04',
    } as unknown as NodeJS.ProcessEnv;
    await execFile('bash', [BACKUP], { env }); // o backup do banco de teste (Testcontainers), nunca o de produção
  }, 180_000);
  afterAll(() => {
    if (base) rmSync(base, { recursive: true, force: true });
  });

  it('restaura num banco descartável sem rede, confere a RLS e os roles e só imprime contagens', async () => {
    // Testcontainers migra como superusuário: as funções SECURITY DEFINER têm dono superusuário só aqui (em produção, 0)
    const r = await execFile('bash', [RESTAURAR], { env: { ...env, NUTRI_RESTAURAR_DIA: '2026-10-04', NUTRI_RESTAURAR_PERMITIR_DEFINER_SUPER: '1' }, timeout: 170_000 });
    const saida = `${r.stdout}${r.stderr}`;
    expect(saida).toMatch(/restauracao ok: duracao=\d+s tabelas_sem_rls=0 migrations=\d+ tenants=\d+ pacientes=\d+ funcoes_definer_superusuario=\d+ roles=ok/);
    expect(saida).not.toMatch(/PASSWORD|senha|@/i);
    const sobra = execFileSync('docker', ['ps', '-a', '--filter', 'name=nutri_restauracao_teste', '--format', '{{.Names}}'], { env }).toString().trim();
    expect(sobra).toBe(''); // o container (com dado restaurado) não fica
  }, 180_000);

  it('sem a permissão do CI, função SECURITY DEFINER com dono superusuário reprova a restauração', async () => {
    const r = execFile('bash', [RESTAURAR], { env: { ...env, NUTRI_RESTAURAR_DIA: '2026-10-04' }, timeout: 170_000 });
    await expect(r).rejects.toMatchObject({ code: 1, stdout: expect.stringContaining('função SECURITY DEFINER com dono superusuário') });
  }, 180_000);

  it('dia sem dump: sai com erro e mensagem fixa', async () => {
    await expect(execFile('bash', [RESTAURAR], { env: { ...env, NUTRI_RESTAURAR_DIA: '2001-01-01' } })).rejects.toMatchObject({ code: 1 });
  }, 120_000);
});
```

Run: `pnpm test test/restauracao.test.ts` → FAIL (script não existe).

- [ ] **Step 4: Script de restauração** — `scripts/backup/nutri-restauracao-teste.sh`

```bash
#!/usr/bin/env bash
# Teste de restauração do NutriDebby (RNF-05, P08-04). Roda NO HOST, uma vez por mês, com OK do dono (lê o backup
# de produção). Banco descartável: container sem rede, dados em tmpfs, apagado no fim (é dado de saúde, LGPD).
# Imprime só contagens. Segredos só no ambiente (RCLONE_CONFIG_* de /etc/nutri-backup/backup.env). Ver docs/operacao/restauracao.md.
set -uo pipefail

REMOTO="${NUTRI_BACKUP_REMOTE:-cripto:}"
DIA="${NUTRI_RESTAURAR_DIA:?defina NUTRI_RESTAURAR_DIA (AAAA-MM-DD do dump)}"
IMAGEM="${NUTRI_RESTAURAR_IMAGEM:-postgres:16-alpine}"
NOME="nutri_restauracao_teste_$$"

log() { printf '%s nutri-restauracao: %s\n' "$(date -u +%FT%TZ)" "$*"; }
limpar() { docker rm -f "$NOME" >/dev/null 2>&1 || true; }
trap limpar EXIT

[[ "$DIA" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { log "ERRO: dia inválido"; exit 1; }
if ! rclone lsf "${REMOTO}db/diario/nutri-${DIA}.dump" >/dev/null 2>&1 || [ -z "$(rclone lsf "${REMOTO}db/diario/nutri-${DIA}.dump" 2>/dev/null)" ]; then
  log "ERRO: dump do dia não encontrado"
  exit 1
fi

inicio=$(date +%s)
# Senha descartável só no ambiente (docker run/exec -e NOME, sem o valor na linha de comando)
POSTGRES_PASSWORD="$(openssl rand -hex 16)"; PGPASSWORD="$POSTGRES_PASSWORD"; export POSTGRES_PASSWORD PGPASSWORD
docker run -d --rm --name "$NOME" --network none --tmpfs /var/lib/postgresql/data:rw \
  -e POSTGRES_PASSWORD -e POSTGRES_DB=nutri "$IMAGEM" >/dev/null 2>&1 \
  || { log "ERRO: não subiu o banco descartável"; exit 1; }
# A imagem oficial sobe antes um servidor TEMPORÁRIO só por socket (listen_addresses=''), cria o banco, desliga e sobe o
# definitivo. Por socket, o pg_isready já responde no temporário e o psql/pg_restore seriam derrubados quando ele para.
# Só o definitivo escuta TCP: esperar e conectar por 127.0.0.1 (o loopback existe mesmo com --network none).
pronto=false
for _ in $(seq 1 60); do
  if docker exec "$NOME" pg_isready -h 127.0.0.1 -U postgres -d nutri >/dev/null 2>&1; then pronto=true; break; fi
  sleep 1
done
[ "$pronto" = true ] || { log "ERRO: o banco descartável não ficou pronto em 60 s"; exit 1; }
PG=(docker exec -i -e PGPASSWORD "$NOME")
# D6: roles antes do dump (o "role postgres já existe" e afins são esperados: ON_ERROR_STOP=0)
if rclone cat "${REMOTO}db/globais.sql" 2>/dev/null | "${PG[@]}" psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=0 -q >/dev/null 2>&1; then
  log "roles aplicados"
else
  log "AVISO: sem db/globais.sql — criar os roles à mão (docs/operacao/restauracao.md)"
fi
# Sem o stderr do pg_restore no log (cita nomes de objetos e, em erro de dado, valores)
if ! rclone cat "${REMOTO}db/diario/nutri-${DIA}.dump" 2>/dev/null | "${PG[@]}" pg_restore -h 127.0.0.1 -U postgres -d nutri --exit-on-error >/dev/null 2>&1; then
  log "ERRO: pg_restore falhou"
  exit 1
fi
duracao=$(( $(date +%s) - inicio ))

q() { "${PG[@]}" psql -h 127.0.0.1 -U postgres -d nutri -At -v ON_ERROR_STOP=1 -c "$1" 2>/dev/null; }
sem_rls=$(q "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relkind in ('r','p') and c.relname not in ('user','consents','invites')
    and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'tenant_id')
    and not (c.relrowsecurity and c.relforcerowsecurity)")
migrations=$(q "select count(*) from drizzle.__drizzle_migrations")
tenants=$(q "select count(*) from tenants")
pacientes=$(q "select count(*) from patients")
definer=$(q "select count(*) from pg_proc p join pg_roles r on r.oid = p.proowner where p.prosecdef and r.rolsuper")
# D6: os roles voltaram — nutri_app_role sem login, ao menos um membro dele com login (o role do app) e todo dono de
# tabela do public com login (o migrator: é ele que roda as migrations no deploy)
roles=$(q "select case when exists (select 1 from pg_roles where rolname = 'nutri_app_role' and not rolcanlogin)
  and exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member
              where m.roleid = (select oid from pg_roles where rolname = 'nutri_app_role') and r.rolcanlogin)
  and not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
                  join pg_roles r on r.oid = c.relowner where c.relkind in ('r','p') and not r.rolcanlogin)
  then 'ok' else 'faltando' end")

echo "restauracao ok: duracao=${duracao}s tabelas_sem_rls=${sem_rls:-?} migrations=${migrations:-?} tenants=${tenants:-?} pacientes=${pacientes:-?} funcoes_definer_superusuario=${definer:-?} roles=${roles:-?}"
[ "${sem_rls:-1}" = 0 ] || { log "ERRO: tabela com tenant_id sem RLS forçada depois da restauração"; exit 1; }
[ "${roles:-}" = ok ] || { log "ERRO: roles faltando ou sem login depois da restauração (docs/operacao/restauracao.md)"; exit 1; }
if [ "${definer:-1}" != 0 ] && [ "${NUTRI_RESTAURAR_PERMITIR_DEFINER_SUPER:-}" != 1 ]; then
  log "ERRO: função SECURITY DEFINER com dono superusuário depois da restauração (o migrator de produção não é superusuário)"
  exit 1
fi
exit 0
```

(O `rclone lsf` de um arquivo inexistente sai 0 com saída vazia em alguns backends e 3 em outros — por isso as duas condições. O `log` vai para a saída padrão: o teste do CI confere a mensagem fixa nela.) Run: `pnpm test test/restauracao.test.ts` → PASS. `bash -n scripts/backup/nutri-restauracao-teste.sh` → sem erro.

- [ ] **Step 5: Procedimento documentado** — `docs/operacao/restauracao.md`

```markdown
# Restauração do backup (RNF-05, P08-04)

Metas: **RPO 24 h, RTO 4 h**. Teste **mensal**, com OK do dono (lê o backup de produção). Registro de cada teste em
`docs/operacao/restauracao-AAAA-MM.md` (data, dump usado, tamanho, duração, contagens, problemas).

## O que precisa estar FORA da VPS (gerenciador de senhas do dono — nunca colar em chat)
`BACKUP_PASSPHRASE` e o salt do rclone crypt; `AUTH_SECRET` (cifra o TOTP), `ENCRYPTION_KEY`, `FILE_URL_SECRET`,
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, `EVOLUTION_*`, chaves do R2, do Turnstile e do Resend. Sem eles o backup não
recupera o serviço (o TOTP e os links assinados dependem das chaves).

## Teste mensal (no host)
1. Snapshot no hPanel não é preciso (nada muda em produção); confirmar com o dono.
2. `sudo -i`, `set -a; . /etc/nutri-backup/backup.env; set +a` (sem exibir).
3. `NUTRI_RESTAURAR_DIA=<ontem> bash /opt/nutri-backup/nutri-restauracao-teste.sh` → linha `restauracao ok: …` com `tabelas_sem_rls=0`, `funcoes_definer_superusuario=0` e `roles=ok` (o script sai 1 se qualquer um falhar; **nunca** usar `NUTRI_RESTAURAR_PERMITIR_DEFINER_SUPER` no host — é só do teste do CI).
4. Arquivos: `rclone cryptcheck "$NUTRI_DATA_DIR" cripto:data/atual` (só hashes) e restaurar 1 arquivo para `/tmp/restauracao-<data>/`,
   conferir o tamanho com `stored_files.bytes` (leitura do banco de produção → confirmação) e apagar a pasta.
5. Registrar o resultado. Duração acima de 1 h → avisar o dono (o RTO é 4 h para o serviço inteiro).

## Restauração de verdade (desastre)
1. VPS nova ou a mesma: Easypanel com o projeto `nutri` (serviços `nutri_db`, `nutri_app`, `nutri_worker`; `nutri_evolution` à parte).
2. `nutri_db` vazio; aplicar `db/globais.sql` (roles) e depois `pg_restore -d nutri --exit-on-error` do dump mais recente.
   Sem `globais.sql` (backup antigo): criar à mão `nutri_app_role` (NOLOGIN), o role dono das migrations (o de `DATABASE_URL_MIGRATOR`,
   sem superusuário) e o role de login do app (o de `DATABASE_URL`, membro de `nutri_app_role`) **antes** do `pg_restore`.
   **Os roles voltam SEM senha** (`--no-role-passwords`). Antes de subir o `nutri_app`, o dono devolve a senha do role
   do migrator (o usuário de `DATABASE_URL_MIGRATOR`): `docker exec -it $(docker ps -q -f name=nutri_db | head -n1) psql -U postgres -d nutri`
   e, dentro do psql, `\password <role do migrator>` — o psql pede a senha duas vezes **sem eco** e manda só o hash (nada vai
   para o histórico do shell nem do psql); o valor vem do gerenciador de senhas e **nunca passa pelo chat**. Sem isso, o
   `docker-entrypoint.sh` roda `scripts/migrate.ts` antes do `next start`, a autenticação SCRAM do migrator falha e o app
   não sobe (o RTO de 4 h fica em risco). A senha do role do app (`DATABASE_URL`) volta sozinha: as migrations a gravam a
   partir do `DATABASE_URL` (`ensureAppLogin`, `src/db/migrate.ts`).
3. `/data`: `rclone copy cripto:data/atual /srv/nutri/data` (alterados/apagados dos últimos 30 dias em `data/historico/<dia>`).
4. Variáveis do Easypanel a partir do gerenciador de senhas; subir `nutri_app` (as migrations conferem a versão e regravam a senha do role do app) e `nutri_worker`.
5. `GET /api/health` = 200; login da nutricionista; abrir um prontuário; conferir um arquivo.
6. O banco `evolution` não está no backup (INT-01): reconectar o WhatsApp pelo QR em "WhatsApp".
7. Exclusões por LGPD feitas depois do dump restaurado: reaplicar (o "Histórico de acessos" e o `audit_log` do período
   perdido não voltam — registrar no relatório de incidente).
```

- [ ] **Step 6: Commit**

```bash
git add scripts/backup/nutri-backup.sh scripts/backup/nutri-restauracao-teste.sh test/backup.test.ts test/restauracao.test.ts docs/operacao/restauracao.md
git commit -m "feat(backup): roles no backup e teste de restauração em banco descartável, documentado (P08-04, RNF-05, D6)"
```

O primeiro teste em produção é passo do runbook (passo 3), depois da instalação do backup no host (P02-11).

---
### Task 12: Correção do modo escuro do aparelho, tokens, fontes, foco e a marca nos dois modos (visual V2 — fundação; D18, D19, D23, D24)

**Files:**
- Create: `src/lib/tema/contraste.ts`, `src/lib/tema/tokens.ts`, `src/lib/tema/marca-tema.ts`, `src/lib/tema/tema.test.ts`
- Modify: `src/app/globals.css`, `src/app/layout.tsx`, `src/modules/plataforma/marca.ts` (+ `marca.test.ts`), `src/modules/plataforma/marca-constantes.ts`, `e2e/acessibilidade.spec.ts`

**Interfaces:**
- Consumes: `contrasteComBranco` (hoje em `marca.ts`).
- Produces:
  - `@/lib/tema/contraste`: `luminancia(hex)`, `contraste(a, b)`, `misturar(hex, alvo, p)` (`p` de 0 a 1).
  - `@/lib/tema/tokens`: `TOKENS: Record<Token, readonly [claro: string, escuro: string]>`, `type Token`, `PARES: readonly { texto: Token; fundo: Token; minimo: number }[]`.
  - `@/lib/tema/marca-tema`: `corNoEscuro(cor: string): string` (≥ 4,5:1 sobre o cartão e o fundo escuros), `CINZA_SOBRE_DESTAQUE = 'rgb(0 0 0 / 0.15)'`.
  - `getTenantBrand(tenant)` → `{ nome, cor, corNoEscuro, logoUrl }`; `COR_PADRAO = '#1d6b5a'`.
  - CSS: variáveis `--nd-*`, classes Tailwind `bg-fundo`, `bg-cartao`, `text-texto`, `text-suave`, `border-borda`, `border-campo`, `bg-linha`, `text-link`, `text-erro`/`bg-erro-fundo`, `text-aviso`/`bg-aviso-fundo`, `text-ok`/`bg-ok-fundo`, `bg-botao`/`text-botao-texto`, `text-marca`/`bg-marca`/`border-marca`, `bg-destaque`/`border-destaque`, `font-sans` (Figtree), `font-titulo` (Bricolage Grotesque); atributo `data-tema="claro|escuro|sistema"` num contêiner liga os modos.

- [ ] **Step 1: O bug de produção primeiro (teste que falha)** — `e2e/acessibilidade.spec.ts`, depois do laço das `ROTAS`:

```ts
// Plano 08 (achado da preparação): o globals.css escurecia o fundo no aparelho escuro sem adaptar as telas
// (barra de abas com contraste 1,17). O PWA tem de passar no axe também com o aparelho no modo escuro.
for (const url of ROTAS) {
  test(`axe sem violações com o aparelho no modo escuro em ${url}`, async () => {
    await paciente.page.emulateMedia({ colorScheme: 'dark' });
    try {
      await semViolacoes(paciente.page, url);
    } finally {
      await paciente.page.emulateMedia({ colorScheme: 'light' });
    }
  });
}
```

Run: `pnpm build && pnpm test:e2e e2e/acessibilidade.spec.ts` → FAIL (`color-contrast` em `nav-portal` e no topo do portal). Apagar o bloco `@media (prefers-color-scheme: dark) { … }` do `src/app/globals.css` (linhas 15–20) e acrescentar `color-scheme: light;` ao `:root`. Run → PASS. Commit separado (pode ir para produção antes do resto, num PR curto, se o dono quiser):

```bash
git add src/app/globals.css e2e/acessibilidade.spec.ts
git commit -m "fix(portal): aparelho no modo escuro não escurece mais o fundo sem adaptar as telas (contraste 1,17 na barra de abas)"
```

- [ ] **Step 2: Testes dos tokens e da marca (falham)** — `src/lib/tema/tema.test.ts`

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contraste, misturar } from './contraste';
import { corNoEscuro } from './marca-tema';
import { PARES, TOKENS, type Token } from './tokens';

describe('tokens do visual V2 (D24, RNF-10)', () => {
  it.each(PARES.flatMap((p) => [0, 1].map((m) => [p.texto, p.fundo, m === 0 ? 'claro' : 'escuro', p.minimo, m] as const)))(
    '%s sobre %s no modo %s: contraste ≥ %d',
    (texto, fundo, _modo, minimo, m) => {
      expect(contraste(TOKENS[texto as Token][m], TOKENS[fundo as Token][m])).toBeGreaterThanOrEqual(minimo);
    },
  );
  it('o globals.css tem cada token com os mesmos valores nos três blocos (fonte única: tokens.ts), sem light-dark()', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    // RNF-09: Safari < 17.5 não tem light-dark() — a variável ficaria inválida e o foco/as cores sumiriam no iOS 16.4–17.4
    expect(css).not.toContain('light-dark(');
    const bloco = (inicio: string) => {
      const i = css.indexOf(inicio);
      expect(i, inicio).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf('}', i));
    };
    const claro = bloco(':root {');
    const escuro = bloco("[data-tema='escuro'] {");
    const sistemaEscuro = bloco("@media (prefers-color-scheme: dark) {");
    for (const [nome, [c, e]] of Object.entries(TOKENS)) {
      expect(claro, `${nome} claro`).toContain(`--nd-${nome}: ${c};`);
      expect(escuro, `${nome} escuro`).toContain(`--nd-${nome}: ${e};`);
      expect(sistemaEscuro, `${nome} aparelho escuro`).toContain(`--nd-${nome}: ${e};`);
    }
    expect(css).toMatch(/:focus-visible \{\s*outline: 3px solid var\(--nd-foco, #[0-9a-f]{6}\);/);
  });
});

/** PRNG com semente: o teste de propriedade é reproduzível. */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('cor do consultório nos dois modos (D19, §3.4 da pesquisa)', () => {
  const rnd = mulberry32(2026);
  const cores = Array.from({ length: 3000 }, () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, '0')}`).filter((c) => contraste(c, '#ffffff') >= 4.5);
  it('há cores suficientes no teste', () => expect(cores.length).toBeGreaterThan(500));
  it('toda cor aceita pelo perfil (≥ 4,5 com branco) vira, no escuro, texto ≥ 4,5 sobre o cartão e o fundo', () => {
    for (const c of cores) {
      const e = corNoEscuro(c);
      expect(contraste(e, TOKENS.cartao[1]), `${c} → ${e}`).toBeGreaterThanOrEqual(4.5);
      expect(contraste(e, TOKENS.fundo[1]), `${c} → ${e}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('texto branco sobre a caixa com a sobreposição escura (15% de preto) do cartão de destaque continua ≥ 4,5', () => {
    for (const c of cores) expect(contraste('#ffffff', misturar(c, '#000000', 0.15))).toBeGreaterThanOrEqual(4.5);
  });
  it('as cores conferidas na pesquisa', () => {
    expect(contraste(corNoEscuro('#047857'), TOKENS.cartao[1])).toBeGreaterThanOrEqual(4.5);
    expect(contraste(corNoEscuro('#1d6b5a'), TOKENS.cartao[1])).toBeGreaterThanOrEqual(4.5);
  });
});
```

Run: `pnpm test src/lib/tema` → FAIL (módulos não existem).

- [ ] **Step 3: Os módulos** — `src/lib/tema/contraste.ts`

```ts
/** WCAG 2.1: luminância relativa e razão de contraste entre duas cores #rrggbb. Puro (servidor e cliente). */
const canal = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function luminancia(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => canal(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** `hex` misturada com `alvo` na proporção `p` (0 = só hex, 1 = só alvo). */
export function misturar(hex: string, alvo: string, p: number): string {
  const [a, b] = [rgb(hex), rgb(alvo)];
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * p).toString(16).padStart(2, '0')).join('')}`;
}
```

`src/lib/tema/tokens.ts`

```ts
/**
 * D24: cores do visual V2 (Bento), [claro, escuro]. Fonte única: o globals.css repete os valores (teste confere).
 * Faltavam no design e foram acrescentadas: borda de campo (≥ 3:1, WCAG 1.4.11), fundos de erro/aviso/ok e o foco.
 */
export const TOKENS = {
  fundo: ['#eaf0ec', '#0f1613'],
  cartao: ['#ffffff', '#17211d'],
  texto: ['#14211d', '#e6eeea'],
  suave: ['#4b5c55', '#a3b5ad'],
  borda: ['#d5e0da', '#26332e'],
  campo: ['#6f817a', '#7a8c84'],
  linha: ['#edf2ef', '#22302b'],
  link: ['#0f4f42', '#7fd4b9'],
  erro: ['#8f2f22', '#ff9c8f'],
  'erro-fundo': ['#fbe9e6', '#3a1d19'],
  aviso: ['#8a5306', '#f0b867'],
  'aviso-fundo': ['#fdf3e1', '#33270f'],
  ok: ['#1f6b45', '#7fd4b9'],
  'ok-fundo': ['#e4f2ea', '#15302a'],
  botao: ['#14211d', '#e6eeea'],
  'botao-texto': ['#ffffff', '#0f1613'],
} as const satisfies Record<string, readonly [string, string]>;

export type Token = keyof typeof TOKENS;

/** Pares que a interface usa: texto normal 4,5:1; borda de campo 3:1 (componente). */
export const PARES: readonly { texto: Token; fundo: Token; minimo: number }[] = [
  { texto: 'texto', fundo: 'fundo', minimo: 4.5 },
  { texto: 'texto', fundo: 'cartao', minimo: 4.5 },
  { texto: 'texto', fundo: 'linha', minimo: 4.5 },
  { texto: 'suave', fundo: 'cartao', minimo: 4.5 },
  { texto: 'suave', fundo: 'fundo', minimo: 4.5 },
  { texto: 'link', fundo: 'cartao', minimo: 4.5 },
  { texto: 'erro', fundo: 'cartao', minimo: 4.5 },
  { texto: 'erro', fundo: 'erro-fundo', minimo: 4.5 },
  { texto: 'aviso', fundo: 'cartao', minimo: 4.5 },
  { texto: 'aviso', fundo: 'aviso-fundo', minimo: 4.5 },
  { texto: 'ok', fundo: 'cartao', minimo: 4.5 },
  { texto: 'ok', fundo: 'ok-fundo', minimo: 4.5 },
  { texto: 'botao-texto', fundo: 'botao', minimo: 4.5 },
  { texto: 'campo', fundo: 'cartao', minimo: 3 },
  { texto: 'campo', fundo: 'fundo', minimo: 3 },
];
```

`src/lib/tema/marca-tema.ts`

```ts
import { contraste, misturar } from './contraste';
import { TOKENS } from './tokens';

/**
 * D19 / §3.4: a cor do consultório sempre aceita texto branco por cima (perfilSchema: ≥ 4,5), mas como TEXTO, link ou
 * foco sobre o escuro ela reprova (#047857: 3,01). Clareia com branco em passos de 2% até passar sobre o cartão e o fundo.
 */
export function corNoEscuro(cor: string): string {
  for (let i = 0; i <= 50; i++) {
    const c = misturar(cor, '#ffffff', i / 50);
    if (contraste(c, TOKENS.cartao[1]) >= 4.5 && contraste(c, TOKENS.fundo[1]) >= 4.5) return c;
  }
  return '#ffffff';
}

/** Caixas dentro do cartão de destaque: sobreposição escura (a clara derrubava o branco para 3,6 com cores no limite). */
export const CINZA_SOBRE_DESTAQUE = 'rgb(0 0 0 / 0.15)';
```

Run: `pnpm test src/lib/tema/tema.test.ts` → falha só no caso do `globals.css` (próximo passo).

- [ ] **Step 4: CSS e fontes** — `src/app/globals.css` (arquivo inteiro)

```css
@import "tailwindcss";

/* D24: dark: segue a escolha da usuária (data-tema), não só o aparelho. Prefira os tokens; dark: só em exceção. */
@custom-variant dark (&:where([data-tema=escuro], [data-tema=escuro] *));

/* Sem a função light-dark do CSS: o Safari só a entende a partir da 17.5, e a RNF-09 exige o PWA no iOS 16.4+. Lá, uma
   variável que a usa fica inválida na hora do cálculo — o outline do :focus-visible virava none (sem foco visível em nenhuma
   página, WCAG 2.4.7) e as cores do portal (T18) sumiam. Cada modo declara os valores literais no próprio bloco. */

/* Claro: fora do painel e do portal (entrar, admin, páginas públicas) e no data-tema=claro */
:root {
  color-scheme: light;
  --nd-fundo: #eaf0ec;
  --nd-cartao: #ffffff;
  --nd-texto: #14211d;
  --nd-suave: #4b5c55;
  --nd-borda: #d5e0da;
  --nd-campo: #6f817a;
  --nd-linha: #edf2ef;
  --nd-link: #0f4f42;
  --nd-erro: #8f2f22;
  --nd-erro-fundo: #fbe9e6;
  --nd-aviso: #8a5306;
  --nd-aviso-fundo: #fdf3e1;
  --nd-ok: #1f6b45;
  --nd-ok-fundo: #e4f2ea;
  --nd-botao: #14211d;
  --nd-botao-texto: #ffffff;
  --nd-marca: #1d6b5a;
  --nd-foco: var(--nd-marca);
}
[data-tema='claro'] { color-scheme: light; }
[data-tema='sistema'] { color-scheme: light dark; }
/* A cor do consultório chega no estilo do contêiner (--nd-marca-base/--nd-marca-clara): as variáveis que dependem dela
   são recalculadas NO contêiner (var() em propriedade customizada resolve onde ela é declarada, não onde é usada). */
[data-tema] {
  --nd-marca: var(--nd-marca-base, #1d6b5a);
  --nd-foco: var(--nd-marca);
}
/* Escuro: escolhido na conta… */
[data-tema='escuro'] {
  color-scheme: dark;
  --nd-fundo: #0f1613;
  --nd-cartao: #17211d;
  --nd-texto: #e6eeea;
  --nd-suave: #a3b5ad;
  --nd-borda: #26332e;
  --nd-campo: #7a8c84;
  --nd-linha: #22302b;
  --nd-link: #7fd4b9;
  --nd-erro: #ff9c8f;
  --nd-erro-fundo: #3a1d19;
  --nd-aviso: #f0b867;
  --nd-aviso-fundo: #33270f;
  --nd-ok: #7fd4b9;
  --nd-ok-fundo: #15302a;
  --nd-botao: #e6eeea;
  --nd-botao-texto: #0f1613;
  --nd-marca: var(--nd-marca-clara, #6fcfb2);
  --nd-foco: var(--nd-marca);
}
/* …ou "igual ao aparelho" com o aparelho escuro (mesmos valores; o teste confere os dois blocos) */
@media (prefers-color-scheme: dark) {
  [data-tema='sistema'] {
    --nd-fundo: #0f1613;
    --nd-cartao: #17211d;
    --nd-texto: #e6eeea;
    --nd-suave: #a3b5ad;
    --nd-borda: #26332e;
    --nd-campo: #7a8c84;
    --nd-linha: #22302b;
    --nd-link: #7fd4b9;
    --nd-erro: #ff9c8f;
    --nd-erro-fundo: #3a1d19;
    --nd-aviso: #f0b867;
    --nd-aviso-fundo: #33270f;
    --nd-ok: #7fd4b9;
    --nd-ok-fundo: #15302a;
    --nd-botao: #e6eeea;
    --nd-botao-texto: #0f1613;
    --nd-marca: var(--nd-marca-clara, #6fcfb2);
    --nd-foco: var(--nd-marca);
  }
}

@theme inline {
  --color-fundo: var(--nd-fundo);
  --color-cartao: var(--nd-cartao);
  --color-texto: var(--nd-texto);
  --color-suave: var(--nd-suave);
  --color-borda: var(--nd-borda);
  --color-campo: var(--nd-campo);
  --color-linha: var(--nd-linha);
  --color-link: var(--nd-link);
  --color-erro: var(--nd-erro);
  --color-erro-fundo: var(--nd-erro-fundo);
  --color-aviso: var(--nd-aviso);
  --color-aviso-fundo: var(--nd-aviso-fundo);
  --color-ok: var(--nd-ok);
  --color-ok-fundo: var(--nd-ok-fundo);
  --color-botao: var(--nd-botao);
  --color-botao-texto: var(--nd-botao-texto);
  --color-marca: var(--nd-marca);
  --color-destaque: var(--nd-marca-base, #1d6b5a); /* sempre a cor original: fundo com texto branco nos dois modos */
  --font-sans: var(--font-figtree), system-ui, sans-serif;
  --font-titulo: var(--font-bricolage), var(--font-figtree), system-ui, sans-serif;
}

body {
  background: #ffffff;
  color: #171717;
  font-family: Arial, Helvetica, sans-serif;
}

/* WCAG 2.4.7: o design não tinha foco visível. Cor literal de reserva se a variável faltar (nunca outline: none) */
:focus-visible {
  outline: 3px solid var(--nd-foco, #1d6b5a);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
}
```

`src/app/layout.tsx` (com o `connection()` da Tarefa 4):

```tsx
import type { Metadata } from 'next';
import { Bricolage_Grotesque, Figtree } from 'next/font/google';
import { connection } from 'next/server';
import './globals.css';

// D24: baixadas no build e servidas pelo próprio app — o navegador não fala com o Google (LGPD, CSP font-src 'self')
const figtree = Figtree({ variable: '--font-figtree', subsets: ['latin'], display: 'swap' });
const bricolage = Bricolage_Grotesque({ variable: '--font-bricolage', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'NutriDebby',
  description: 'NutriDebby',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  await connection(); // D7: CSP com nonce exige render por requisição em todas as páginas
  return (
    <html lang="pt-BR" className={`${figtree.variable} ${bricolage.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

(`font-mono` volta à pilha padrão do Tailwind: conferir com `grep -rn font-mono src` que só aparece no segredo do 2FA, onde qualquer monoespaçada serve.) Run: `pnpm test src/lib/tema` → PASS.

- [ ] **Step 5: Marca** — `src/modules/plataforma/marca-constantes.ts`: `export const COR_PADRAO = '#1d6b5a';` (D23; comentário: `// D23 (Plano 08): a cor do design e do themeColor do PWA (6,36:1 com branco)`). `src/modules/plataforma/marca.ts`:

```ts
import { contraste } from '@/lib/tema/contraste';
import { corNoEscuro } from '@/lib/tema/marca-tema';
// …
/** Razão de contraste WCAG 2.1 entre a cor e o branco. */
export const contrasteComBranco = (hex: string): number => contraste(hex, '#ffffff');
// …
export type MarcaTenant = { nome: string; cor: string; corNoEscuro: string; logoUrl: string | null };

/** Marca da nutricionista (US-005 "Marca aplicada"); D19: a variante clara vai para texto/foco no modo escuro. */
export function getTenantBrand(tenant: TenantRow): MarcaTenant {
  const cor = tenant.corPrimaria ?? COR_PADRAO;
  return { nome: tenant.nomeExibicao, cor, corNoEscuro: corNoEscuro(cor), logoUrl: tenant.logoPath ? signFileUrl(tenant.logoPath) : null };
}
```

`marca.test.ts`: o caso que espera `COR_PADRAO`/`#047857` passa a esperar `#1d6b5a` e o objeto ganha `corNoEscuro: expect.stringMatching(/^#[0-9a-f]{6}$/)`. Conferir com `grep -rn "047857" src e2e test scripts` e trocar onde o valor é a cor padrão (não onde é uma cor qualquer de teste). Run: `pnpm test src/modules/plataforma src/lib/tema && pnpm build && pnpm test:e2e e2e/acessibilidade.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tema src/app/globals.css src/app/layout.tsx src/modules/plataforma/marca.ts src/modules/plataforma/marca.test.ts src/modules/plataforma/marca-constantes.ts
git commit -m "feat(visual): tokens claro/escuro por bloco (sem light-dark, Safari 16.4+), fontes Figtree/Bricolage, foco visível e a cor do consultório nos dois modos (D19, D23, D24)"
```

---

### Task 13: Preferência de tema e progresso do manual na conta (D17)

**Files:**
- Create: `drizzle/0088_preferencias_usuaria.sql` (gerada), `src/modules/plataforma/preferencias-tipos.ts`, `src/modules/plataforma/preferencias.ts`, `src/modules/plataforma/preferencias.test.ts`, `src/app/painel/preferencias/actions.ts`
- Modify: `src/db/schema/auth.ts` (`user`), `src/lib/auth.ts` (`additionalFields`), `CLAUDE.md` (regra 1)

**Interfaces:**
- Consumes: `user` (`@/db/schema`), `requireNutri`.
- Produces:
  - `user.tema text not null default 'sistema'` (CHECK `sistema|claro|escuro`) e `user.guia jsonb not null default '{}'`; `data.user.tema` na sessão (Better Auth, `input: false`).
  - `@/modules/plataforma/preferencias-tipos` (puro, importável no cliente): `TEMAS`, `type Tema`, `ehTema(v): v is Tema`, `proximoTema(atual: Tema, aparelhoEscuro: boolean): Tema`, `type EstadoGuia = 'concluido' | 'dispensado' | 'visto'`, `type ProgressoGuia = Record<string, { v: number; estado: EstadoGuia }>`, `ID_GUIA = /^[a-z][a-z0-9-]{1,39}$/`.
  - `@/modules/plataforma/preferencias`: `gravarTema(userId, tema: unknown, db?)`, `lerGuia(userId, db?) : Promise<ProgressoGuia>`, `marcarGuia(userId, id: string, versao: number, estado: EstadoGuia, db?)`, `PreferenciaError`.
  - Server Actions (`src/app/painel/preferencias/actions.ts`): `alternarTemaAction(formData)`, `escolherTemaAction(prev: { ok?: boolean; erro?: string }, formData)`, `marcarGuiaAction(id: string, versao: number, estado: EstadoGuia)`.

- [ ] **Step 1: Teste (falha)** — `src/modules/plataforma/preferencias.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { user } from '@/db/schema';
import { gravarTema, lerGuia, marcarGuia, PreferenciaError } from './preferencias';
import { proximoTema } from './preferencias-tipos';

const owner = makeDb(inject('ownerDatabaseUrl')); // a tabela user não tem RLS; o owner só cria as contas de teste
const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await owner.pool.end();
  await app.pool.end();
});
async function conta(): Promise<string> {
  const id = randomUUID();
  await owner.db.insert(user).values({ id, name: 'Debby Silva', email: `pref-${id.slice(0, 8)}@teste.dev`, appRole: 'nutri' });
  return id;
}

describe('preferências da usuária (D17)', () => {
  it('nasce em "sistema" e com o guia vazio', async () => {
    const id = await conta();
    const [u] = await app.db.select({ tema: user.tema, guia: user.guia }).from(user).where(eq(user.id, id));
    expect(u).toEqual({ tema: 'sistema', guia: {} });
  });
  it('gravarTema aceita só os três valores e grava só na conta indicada', async () => {
    const [a, b] = [await conta(), await conta()];
    await gravarTema(a, 'escuro', app.db);
    await expect(gravarTema(a, 'roxo', app.db)).rejects.toBeInstanceOf(PreferenciaError);
    const temas = await app.db.select({ id: user.id, tema: user.tema }).from(user).where(eq(user.id, b));
    expect(temas[0].tema).toBe('sistema');
  });
  it('marcarGuia: atômico (duas abas não se apagam), idempotente, "visto" não rebaixa "concluido" da mesma versão e versão menor não sobrescreve', async () => {
    const id = await conta();
    await Promise.all([marcarGuia(id, 'boas-vindas', 1, 'concluido', app.db), marcarGuia(id, 'agenda', 1, 'dispensado', app.db)]);
    await marcarGuia(id, 'boas-vindas', 1, 'visto', app.db);
    expect(await lerGuia(id, app.db)).toEqual({ 'boas-vindas': { v: 1, estado: 'concluido' }, agenda: { v: 1, estado: 'dispensado' } });
    await marcarGuia(id, 'boas-vindas', 2, 'visto', app.db); // versão nova do tour: volta a "visto"
    expect((await lerGuia(id, app.db))['boas-vindas']).toEqual({ v: 2, estado: 'visto' });
    // aba aberta antes do deploy (GUIAS antigo): versão menor nunca sobrescreve a maior, nem com "concluido"
    await marcarGuia(id, 'boas-vindas', 1, 'concluido', app.db);
    await marcarGuia(id, 'agenda', 2, 'concluido', app.db);
    await marcarGuia(id, 'agenda', 1, 'visto', app.db);
    expect(await lerGuia(id, app.db)).toEqual({ 'boas-vindas': { v: 2, estado: 'visto' }, agenda: { v: 2, estado: 'concluido' } });
  });
  it('id fora do formato ou versão inválida → PreferenciaError (nada de chave arbitrária no jsonb)', async () => {
    const id = await conta();
    await expect(marcarGuia(id, '__proto__', 1, 'visto', app.db)).rejects.toBeInstanceOf(PreferenciaError);
    await expect(marcarGuia(id, 'agenda', 0, 'visto', app.db)).rejects.toBeInstanceOf(PreferenciaError);
  });
  it('proximoTema: claro↔escuro; "sistema" vira o oposto do que o aparelho mostra', () => {
    expect(proximoTema('claro', true)).toBe('escuro');
    expect(proximoTema('escuro', false)).toBe('claro');
    expect(proximoTema('sistema', true)).toBe('claro');
    expect(proximoTema('sistema', false)).toBe('escuro');
  });
});
```

Run: `pnpm test src/modules/plataforma/preferencias.test.ts` → FAIL.

- [ ] **Step 2: Schema e migration** — `src/db/schema/auth.ts`, em `user` (imports `jsonb`):

```ts
    /** D17 (Plano 08): tema do painel — 'sistema' segue o aparelho. Lido na sessão (additionalFields). */
    tema: text("tema").default("sistema").notNull(),
    /** D17/D27: progresso do manual guiado — { "<id do tour>": { v, estado } }; só preferencias.ts grava. */
    guia: jsonb("guia").$type<Record<string, { v: number; estado: "concluido" | "dispensado" | "visto" }>>().default(sql`'{}'::jsonb`).notNull(),
```

e no array de restrições: `check("user_tema_valido", sql\`${t.tema} in ('sistema','claro','escuro')\`),`. Run: `pnpm db:generate` → renomear para `drizzle/0088_preferencias_usuaria.sql` (e a entrada do `_journal.json`); conferir que só tem `ALTER TABLE "user" ADD COLUMN "tema" …`, `ADD COLUMN "guia" …` e o `ADD CONSTRAINT`. `user` está em `RLS_EXCEPTIONS`: nenhuma guarda muda; não é dado de saúde (sem auditoria).

- [ ] **Step 3: Tipos e módulo** — `src/modules/plataforma/preferencias-tipos.ts`

```ts
/** D17: puro (sem banco) — o botão de tema e o manual, no cliente, usam estes tipos. */
export const TEMAS = ['sistema', 'claro', 'escuro'] as const;
export type Tema = (typeof TEMAS)[number];
export const ehTema = (v: unknown): v is Tema => typeof v === 'string' && (TEMAS as readonly string[]).includes(v);

/** O botão alterna o que a usuária VÊ: em "sistema", vira o oposto do modo atual do aparelho. */
export function proximoTema(atual: Tema, aparelhoEscuro: boolean): Tema {
  const efetivo = atual === 'sistema' ? (aparelhoEscuro ? 'escuro' : 'claro') : atual;
  return efetivo === 'escuro' ? 'claro' : 'escuro';
}

export type EstadoGuia = 'concluido' | 'dispensado' | 'visto';
export type ProgressoGuia = Record<string, { v: number; estado: EstadoGuia }>;
export const ID_GUIA = /^[a-z][a-z0-9-]{1,39}$/;
export const ESTADOS_GUIA: readonly EstadoGuia[] = ['concluido', 'dispensado', 'visto'];
```

`src/modules/plataforma/preferencias.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { user } from '@/db/schema';
import { ehTema, ESTADOS_GUIA, ID_GUIA, type EstadoGuia, type ProgressoGuia, type Tema } from './preferencias-tipos';

export * from './preferencias-tipos';

export class PreferenciaError extends Error {
  override name = 'PreferenciaError';
}

/**
 * D17: a tabela `user` é exceção de RLS (CLAUDE.md regra 1). Este módulo só lê/grava `tema` e `guia` da conta da
 * própria sessão — o `userId` vem sempre de requireNutri, nunca do formulário.
 */
export async function gravarTema(userId: string, tema: unknown, db: Db = getDb()): Promise<Tema> {
  if (!ehTema(tema)) throw new PreferenciaError('tema inválido');
  await db.update(user).set({ tema }).where(eq(user.id, userId));
  return tema;
}

export async function lerGuia(userId: string, db: Db = getDb()): Promise<ProgressoGuia> {
  const [u] = await db.select({ guia: user.guia }).from(user).where(eq(user.id, userId));
  return u?.guia ?? {};
}

/**
 * Atômico (`jsonb_set` numa instrução): duas abas gravando tours diferentes não se apagam. Uma versão menor que a gravada
 * nunca sobrescreve (aba aberta antes do deploy, com o GUIAS antigo); "visto" não rebaixa um tour já concluído/dispensado
 * na mesma versão. Mesma regra do `aplicarMarca` (T19).
 */
export async function marcarGuia(userId: string, id: string, versao: number, estado: EstadoGuia, db: Db = getDb()): Promise<void> {
  if (!ID_GUIA.test(id) || !Number.isInteger(versao) || versao < 1 || versao > 1000 || !ESTADOS_GUIA.includes(estado)) {
    throw new PreferenciaError('progresso do manual inválido');
  }
  const valor = JSON.stringify({ v: versao, estado });
  const novo = sql`jsonb_set(${user.guia}, array[${id}]::text[], ${valor}::jsonb, true)`;
  const versaoGravada = sql`(${user.guia} -> ${id} ->> 'v')::int`; // null quando o tour ainda não tem marca
  const manter =
    estado === 'visto'
      ? sql`${versaoGravada} > ${versao} or (${versaoGravada} = ${versao} and ${user.guia} -> ${id} ->> 'estado' in ('concluido', 'dispensado'))`
      : sql`${versaoGravada} > ${versao}`;
  const guia = sql`case when coalesce(${manter}, false) then ${user.guia} else ${novo} end`;
  await db.update(user).set({ guia }).where(eq(user.id, userId));
}
```

`src/lib/auth.ts`, em `user.additionalFields`: `tema: { type: 'string', required: false, input: false, defaultValue: 'sistema' },` (com `input: false`, o `/api/auth/update-user` não grava o campo). Run: `pnpm test src/modules/plataforma/preferencias.test.ts src/lib/auth.test.ts` → PASS.

- [ ] **Step 4: Ações** — `src/app/painel/preferencias/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireNutri } from '@/lib/tenant-session';
import { ehTema, gravarTema, marcarGuia, PreferenciaError, proximoTema, type EstadoGuia } from '@/modules/plataforma/preferencias';

export type TemaState = { ok?: boolean; erro?: string };

/** Botão do cabeçalho (funciona sem JavaScript: o formulário posta e a página volta com o tema novo). */
export async function alternarTemaAction(formData: FormData): Promise<void> {
  const { data } = await requireNutri('/painel', { permitirDpaPendente: true });
  const atual = ehTema(data.user.tema) ? data.user.tema : 'sistema';
  await gravarTema(data.user.id, proximoTema(atual, formData.get('aparelhoEscuro') === '1'));
  revalidatePath('/painel', 'layout');
}

/** Configurações → Tema (três opções). */
export async function escolherTemaAction(_prev: TemaState, formData: FormData): Promise<TemaState> {
  const { data } = await requireNutri('/painel/configuracoes');
  try {
    await gravarTema(data.user.id, formData.get('tema'));
  } catch (e) {
    if (e instanceof PreferenciaError) return { erro: 'Escolha uma das opções.' };
    throw e;
  }
  revalidatePath('/painel', 'layout');
  return { ok: true };
}

/**
 * Manual guiado (D27): concluído, dispensado ou visto, por tour e versão. Sem revalidatePath de propósito: o "visto" é
 * gravado ao montar o aviso e revalidar o layout a cada marcação refaria o render do painel inteiro; o GuiaDoPainel
 * (T19) mantém o progresso em estado local, atualizado de forma otimista.
 */
export async function marcarGuiaAction(id: string, versao: number, estado: EstadoGuia): Promise<void> {
  const { data } = await requireNutri('/painel', { permitirDpaPendente: true });
  await marcarGuia(data.user.id, id, versao, estado);
}
```

(`requireNutri` na primeira linha: a guarda `acoes-de-paciente.test.ts` pega o arquivo `actions.ts` novo sozinha.) Run: `pnpm test src/app/painel/acoes-de-paciente.test.ts` → PASS.

- [ ] **Step 5: CLAUDE.md, regra 1** — na lista de quem acessa a tabela `user` fora do `withTenant`, depois de `src/modules/agenda/aviso-nutri.ts (…)`, acrescentar: `por \`src/modules/plataforma/preferencias.ts\` (tema do painel e progresso do manual guiado da própria usuária, Plano 08, D17)`.

- [ ] **Step 6: Commit**

```bash
git add src/db/schema/auth.ts drizzle/0088_preferencias_usuaria.sql drizzle/meta src/modules/plataforma/preferencias-tipos.ts src/modules/plataforma/preferencias.ts src/modules/plataforma/preferencias.test.ts src/lib/auth.ts src/app/painel/preferencias CLAUDE.md
git commit -m "feat(visual): tema e progresso do manual guardados na conta, com ações do painel (D17)"
```

---

### Task 14: Layout do painel, cabeçalho novo, menu, menu da conta, botão de tema e Configurações (D19, D20, D21)

**Files:**
- Create: `src/app/painel/layout.tsx`, `src/app/painel/navegacao.ts`, `src/app/painel/navegacao.test.ts`, `src/app/painel/menu-painel.tsx`, `src/app/painel/menu-conta.tsx`, `src/app/painel/alternar-tema.tsx`, `src/app/painel/configuracoes/perfil/page.tsx`, `src/app/painel/configuracoes/tema-form.tsx`
- Modify: `src/app/painel/cabecalho.tsx` (vira `CabecalhoPainel`), `src/app/painel/cabecalho.test.ts` (reescrita), `src/lib/session.ts` (`cache()`), `src/app/painel/configuracoes/page.tsx` (hub), `src/app/painel/dpa/page.tsx`, `src/app/painel/pacientes/[id]/layout.tsx` e toda página de `src/app/painel/**` que renderiza `<Cabecalho`, `src/app/painel/configuracoes/actions.ts` (`revalidatePath`)

**Interfaces:**
- Consumes: `getTenantBrand` (T12, com `corNoEscuro`); `ehTema`, `proximoTema`, `type Tema` (T13); `alternarTemaAction`, `escolherTemaAction` (T13); `BotaoSair`; `DPA_VERSAO`.
- Produces:
  - `src/app/painel/layout.tsx`: `<div data-tema={tema} style={{ '--nd-marca-base', '--nd-marca-clara' }} className="min-h-dvh bg-fundo font-sans text-texto">` + `<CabecalhoPainel>` + `children`.
  - `@/app/painel/navegacao`: `ITENS_DO_MENU: readonly { href: string; rotulo: string }[]`, `itemAtual(caminho: string): string | null`, `iniciais(nome: string): string` (avatar da conta e círculo da marca sem logo — uma definição só).
  - `CabecalhoPainel({ marca, nome, email, tema, completo }: { marca: MarcaTenant; nome: string; email: string; tema: Tema; completo: boolean })`; `MenuPainel()`; `MenuConta({ nome, email })`; `AlternarTema({ tema })`.
  - Rotas: `/painel/configuracoes` vira o hub; `/painel/configuracoes/perfil` tem "Perfil e marca" (os formulários de hoje, sem mudar de arquivo).

- [ ] **Step 1: Navegação (teste e módulo)** — `src/app/painel/navegacao.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { iniciais, ITENS_DO_MENU, itemAtual } from './navegacao';

describe('menu do painel (D20)', () => {
  it('iniciais: duas primeiras palavras, maiúsculas', () => {
    expect(iniciais('débora  lima souza')).toBe('DL');
    expect(iniciais('Consultório')).toBe('C');
  });
  it('seis itens, nesta ordem', () => {
    expect(ITENS_DO_MENU.map((i) => i.rotulo)).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Conteúdos', 'Configurações']);
  });
  it.each([
    ['/painel', '/painel'],
    ['/painel/pacientes/0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b/exames', '/painel/pacientes'],
    ['/painel/agenda/horarios', '/painel/agenda'],
    ['/painel/whatsapp', '/painel/configuracoes'],
    ['/painel/alimentos/novo', '/painel/configuracoes'],
    ['/painel/planos/modelos', '/painel/configuracoes'],
    ['/painel/anamnese/modelos/novo', '/painel/configuracoes'],
    ['/painel/configuracoes/perfil', '/painel/configuracoes'],
    ['/painel/ajuda', null],
    ['/painel/pacientesx', null],
  ])('%s → %s', (caminho, item) => expect(itemAtual(caminho)).toBe(item));
});
```

`src/app/painel/navegacao.ts`

```ts
/** D20: os seis itens do topo. O resto das configurações fica no hub "Configurações". Puro (o MenuPainel é cliente). */
export const ITENS_DO_MENU = [
  { href: '/painel', rotulo: 'Início' },
  { href: '/painel/pacientes', rotulo: 'Pacientes' },
  { href: '/painel/agenda', rotulo: 'Agenda' },
  { href: '/painel/diarios', rotulo: 'Diários' },
  { href: '/painel/conteudos', rotulo: 'Conteúdos' },
  { href: '/painel/configuracoes', rotulo: 'Configurações' },
] as const;

/** Telas que moram no hub "Configurações" (o item fica marcado nelas). */
const DO_HUB = ['/painel/configuracoes', '/painel/whatsapp', '/painel/alimentos', '/painel/planos/modelos', '/painel/anamnese/modelos'];
const dentro = (caminho: string, base: string) => caminho === base || caminho.startsWith(`${base}/`);

export function itemAtual(caminho: string): string | null {
  if (caminho === '/painel') return '/painel';
  if (DO_HUB.some((b) => dentro(caminho, b))) return '/painel/configuracoes';
  return ITENS_DO_MENU.find((i) => i.href !== '/painel' && dentro(caminho, i.href))?.href ?? null;
}

/** Avatar da conta (MenuConta) e círculo da marca sem logo (CabecalhoPainel): as duas primeiras palavras do nome. */
export function iniciais(nome: string): string {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}
```

Run: `pnpm test src/app/painel/navegacao.test.ts` → PASS.

- [ ] **Step 2: A guarda nova (falha)** — `src/app/painel/cabecalho.test.ts` (arquivo inteiro)

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Plano 08 (T14): o cabeçalho do painel é desenhado SÓ pelo layout (src/app/painel/layout.tsx). Nenhuma página nem layout
// interno desenha outro (menu em dobro). O layout não é barreira: toda página continua conferindo a sessão.
const RAIZ = path.resolve('src/app/painel');
const TSX = readdirSync(RAIZ, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith('.tsx'))
  .map((d) => path.relative(RAIZ, path.join(d.parentPath, d.name)).split(path.sep).join('/'))
  .sort();
const PAGINAS = TSX.filter((f) => f.endsWith('page.tsx'));
const ler = (f: string) => readFileSync(path.join(RAIZ, f), 'utf8');

describe('cabeçalho do painel (D20)', () => {
  it('o layout do painel desenha o CabecalhoPainel e lê a sessão com o DPA pendente permitido', () => {
    const s = ler('layout.tsx');
    expect(s).toMatch(/<CabecalhoPainel[\s/>]/);
    expect(s).toMatch(/requireNutri\([^)]*permitirDpaPendente:\s*true/);
    expect(s).toMatch(/data-tema=/);
  });
  it.each(TSX.filter((f) => !['layout.tsx', 'cabecalho.tsx'].includes(f)))('%s não desenha cabeçalho próprio', (f) => {
    const s = ler(f);
    expect(s).not.toMatch(/<Cabecalho(Painel)?[\s/>]/);
    expect(s).not.toMatch(/from '(\.\.\/)+cabecalho'|from '\.\/cabecalho'/);
  });
  it.each(PAGINAS)('%s confere a sessão (requireNutri ou carregarProntuario)', (f) => {
    expect(ler(f)).toMatch(/requireNutri\(|carregarProntuario\(/);
  });
});
```

Run: `pnpm test src/app/painel/cabecalho.test.ts` → FAIL (não há layout; 20+ páginas renderizam `<Cabecalho`).

- [ ] **Step 3: Uma leitura de sessão por requisição** — `src/lib/session.ts` (o layout e a página leem a sessão na mesma requisição; o `cache()` do React deduplica dentro do render — o redirecionamento continua por chamada, porque a decisão roda fora do cache):

```ts
import { cache } from 'react';
import { logger, nomeDoErro } from './logger'; // era só `logger`
// …
/** T14 (S-7, nutricionista): uma leitura de sessão + tenant por requisição, dividida entre o layout e a página. */
const lerSessaoDaRequisicao = cache(async () => {
  const h = await headers();
  // disableRefresh: a inatividade é avaliada com o updatedAt/expiresAt gravados, antes de
  // qualquer renovação (RNF-06); a renovação só acontece depois, em slideSession.
  const data = await getAuth().api.getSession({ headers: h, query: { disableRefresh: true } });
  const tenantId = (data?.user as { tenantId?: string | null } | undefined)?.tenantId;
  // RN-15: 1 leitura por PK; a suspensão vale na próxima requisição, mesmo com sessão aberta
  const tenant = tenantId ? await buscarTenant(getDb(), tenantId) : null;
  return { h, data, tenant };
});

/** A renovação da sessão, uma vez por requisição. */
const deslizarUmaVez = cache(async (sessionId: string) => {
  const { data } = await lerSessaoDaRequisicao();
  if (!data || data.session.id !== sessionId) return;
  try {
    // Também em navegação RSC, em que o Better Auth não renova sozinho
    await slideSession(getDb(), data.session, data.user.appRole as AppRole, new Date());
  } catch (err) {
    // A requisição já está autenticada; falhar a renovação não pode derrubar a página.
    // Só o nome do erro (RNF-11, regra 3): a mensagem do erro de banco traz o SQL e os parâmetros (id e token da sessão).
    logger.warn({ erro: nomeDoErro(err), userId: data.user.id }, 'falha ao renovar a sessão');
  }
});
```

e em `requireUserComTenant`, trocar as quatro primeiras leituras por `const { h, data, tenant } = await lerSessaoDaRequisicao(); const auth = getAuth(); const now = new Date();` e o `case 'ok'` por:

```ts
    case 'ok':
      await deslizarUmaVez(data!.session.id);
      return { data: data!, tenant };
```

Fora de um render (Server Action, Route Handler, teste), o `cache` do React só repassa a chamada: o comportamento é o de hoje. Run: `pnpm test src/lib/session.test.ts src/lib/tenant-session.test.ts` → PASS.

- [ ] **Step 4: Componentes do cabeçalho** — `src/app/painel/alternar-tema.tsx`

```tsx
'use client';

import { useSyncExternalStore } from 'react';
import { proximoTema, type Tema } from '@/modules/plataforma/preferencias-tipos';
import { alternarTemaAction } from './preferencias/actions';

const consulta = () => window.matchMedia('(prefers-color-scheme: dark)');
const assinar = (avisar: () => void) => {
  const m = consulta();
  m.addEventListener('change', avisar);
  return () => m.removeEventListener('change', avisar);
};

/**
 * D17: rótulo fixo "Modo escuro" + aria-pressed (padrão de botão de alternar). Sem JavaScript, o formulário posta e a
 * página volta com o tema novo; com JavaScript, o data-tema do contêiner muda na hora (otimista) e a ação grava.
 */
export function AlternarTema({ tema }: { tema: Tema }) {
  const aparelhoEscuro = useSyncExternalStore(assinar, () => consulta().matches, () => false);
  const escuro = tema === 'escuro' || (tema === 'sistema' && aparelhoEscuro);
  return (
    <form action={alternarTemaAction} onSubmit={() => document.querySelector('[data-tema]')?.setAttribute('data-tema', proximoTema(tema, aparelhoEscuro))}>
      <input type="hidden" name="aparelhoEscuro" value={aparelhoEscuro ? '1' : '0'} />
      <button
        type="submit"
        aria-label="Modo escuro"
        aria-pressed={escuro}
        title={escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
        className="grid size-11 place-items-center rounded-full border border-borda bg-cartao text-texto hover:bg-linha"
      >
        {escuro ? (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </button>
    </form>
  );
}
```

`src/app/painel/menu-painel.tsx`

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ITENS_DO_MENU, itemAtual } from './navegacao';

/** D20: o item ativo é pílula na cor do consultório (forma + cor + aria-current, WCAG 1.4.1). */
export function MenuPainel() {
  const atual = itemAtual(usePathname());
  return (
    <nav aria-label="Menu do painel" data-guia="menu">
      <ul className="flex flex-wrap gap-1">
        {ITENS_DO_MENU.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={atual === i.href ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-4 font-medium ${atual === i.href ? 'bg-destaque text-white' : 'text-suave hover:bg-linha hover:text-texto'}`}
            >
              {i.rotulo}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

`src/app/painel/menu-conta.tsx`

```tsx
import Link from 'next/link';
import { BotaoSair } from '@/components/botao-sair';
import { iniciais } from './navegacao';

const ITEM = 'flex min-h-11 w-full items-center rounded-xl px-3 text-left hover:bg-linha';

/** D20: menu da conta (disclosure com <details>, funciona sem JavaScript). O "Sair" mantém o data-sair (editor do plano). */
export function MenuConta({ nome, email }: { nome: string; email: string }) {
  return (
    <details className="relative" data-guia="conta">
      <summary aria-label={`Conta de ${nome}`} className="grid size-11 cursor-pointer list-none place-items-center rounded-full bg-[#f3b660] font-semibold text-[#3a2508] [&::-webkit-details-marker]:hidden">
        {iniciais(nome)}
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-72 rounded-2xl border border-borda bg-cartao p-2 text-texto shadow-lg">
        <p className="px-3 py-2 text-sm text-suave">{`Conectado como ${email}.`}</p>
        <ul>
          <li><Link href="/painel/configuracoes/perfil" className={ITEM}>Perfil e marca</Link></li>
          <li><Link href="/conta/seguranca" className={ITEM}>Segurança</Link></li>
          <li><Link href="/painel/ajuda" className={ITEM}>Manual</Link></li>
          <li><Link href="/painel?tour=boas-vindas" className={ITEM}>Rever o tour de boas-vindas</Link></li>
          <li><BotaoSair className={ITEM} /></li>
        </ul>
      </div>
    </details>
  );
}
```

(O avatar usa as cores fixas do design — `#3a2508` sobre `#f3b660`, 8,06:1 nos dois modos.) `src/app/painel/cabecalho.tsx` (arquivo inteiro)

```tsx
import Link from 'next/link';
import { BotaoSair } from '@/components/botao-sair';
import type { MarcaTenant } from '@/modules/plataforma/marca';
import type { Tema } from '@/modules/plataforma/preferencias-tipos';
import { AlternarTema } from './alternar-tema';
import { MenuConta } from './menu-conta';
import { MenuPainel } from './menu-painel';
import { iniciais } from './navegacao';

/**
 * D19/D20: marca do consultório à esquerda (US-005), menu de 6 itens, tema e conta à direita. Com o DPA pendente
 * (`completo = false`), só a marca, o tema e o "Sair" — a nutricionista só pode aceitar o contrato ou sair.
 */
export function CabecalhoPainel({ marca, nome, email, tema, completo }: { marca: MarcaTenant; nome: string; email: string; tema: Tema; completo: boolean }) {
  return (
    <header className="border-b border-borda bg-cartao">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-3 px-4 py-3 md:px-6">
        <Link href="/painel" className="flex items-center gap-3 rounded-xl">
          {marca.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, fora do otimizador de imagens
            <img src={marca.logoUrl} alt={`Logo de ${marca.nome}`} className="h-10 w-auto rounded bg-white p-1" />
          ) : (
            <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-destaque font-titulo font-extrabold text-white">{iniciais(marca.nome)}</span>
          )}
          <span className="font-titulo text-lg font-semibold">{marca.nome}</span>
        </Link>
        {completo && <MenuPainel />}
        <div className="ml-auto flex items-center gap-2">
          <AlternarTema tema={tema} />
          {completo ? <MenuConta nome={nome} email={email} /> : <BotaoSair className="inline-flex min-h-11 items-center rounded-full border border-campo px-4" />}
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: O layout** — `src/app/painel/layout.tsx`

```tsx
import type { CSSProperties } from 'react';
import { requireNutri } from '@/lib/tenant-session';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { getTenantBrand } from '@/modules/plataforma/marca';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';
import { CabecalhoPainel } from './cabecalho';

/**
 * Visual V2 (D24): o tema (data-tema, D17) e a cor do consultório (D19) valem para todas as telas do painel. O layout
 * NÃO é barreira de segurança: cada página chama requireNutri (guarda em cabecalho.test.ts).
 */
export default async function PainelLayout({ children }: LayoutProps<'/painel'>) {
  const { data, tenant } = await requireNutri('/painel', { permitirDpaPendente: true });
  const marca = getTenantBrand(tenant);
  const tema = ehTema(data.user.tema) ? data.user.tema : 'sistema';
  const cores = { '--nd-marca-base': marca.cor, '--nd-marca-clara': marca.corNoEscuro } as CSSProperties;
  return (
    <div data-tema={tema} style={cores} className="flex min-h-dvh flex-col bg-fundo font-sans text-texto">
      <CabecalhoPainel marca={marca} nome={data.user.name} email={data.user.email} tema={tema} completo={tenant.dpaVersao === DPA_VERSAO} />
      {children}
    </div>
  );
}
```

O fundo além do conteúdo (efeito elástico ao rolar no celular) fica com a cor do `body`: em `globals.css`, acrescentar `:root:has([data-tema='escuro']) { background: #0f1613; }` (e o mesmo para `sistema` dentro de `@media (prefers-color-scheme: dark)`).

- [ ] **Step 6: Tirar o cabeçalho das páginas** — em todos os arquivos que o renderizam (o layout já desenha):

```bash
FILES=$(grep -rl '<Cabecalho' src/app/painel --include=*.tsx | grep -v '^src/app/painel/cabecalho.tsx$')
perl -0pi -e 's/^import \{ Cabecalho \} from [^\n]+\n//m; s/\n[ \t]*<Cabecalho tenant=\{tenant\} \/>//g' $FILES
pnpm lint   # aponta `tenant` sem uso nas páginas que só o usavam para o cabeçalho: tirar da desestruturação
```

`src/app/painel/dpa/page.tsx`: tirar o `BotaoSair` próprio (o cabeçalho mínimo do layout já tem o "Sair") — o `<div className="flex items-start justify-between gap-4">` vira só o `<h1>`, e sai o import. Run: `pnpm test src/app/painel/cabecalho.test.ts && pnpm typecheck && pnpm lint` → PASS.

- [ ] **Step 7: Configurações vira o hub** — `src/app/painel/configuracoes/perfil/page.tsx` (os formulários continuam nos mesmos arquivos):

```tsx
import { requireNutri } from '@/lib/tenant-session';
import { LogoForm } from '../logo-form';
import { PerfilForm } from '../perfil-form';

export const dynamic = 'force-dynamic';

export default async function PerfilPage() {
  const { tenant } = await requireNutri('/painel/configuracoes/perfil');
  return (
    <main className="mx-auto w-full max-w-lg space-y-8 p-6">
      <h1 className="font-titulo text-2xl font-semibold">Perfil e marca</h1>
      <LogoForm />
      <PerfilForm tenant={tenant} />
    </main>
  );
}
```

`src/app/painel/configuracoes/tema-form.tsx`

```tsx
'use client';

import { useActionState } from 'react';
import type { Tema } from '@/modules/plataforma/preferencias-tipos';
import { escolherTemaAction, type TemaState } from '../preferencias/actions';

const OPCOES: { valor: Tema; rotulo: string }[] = [
  { valor: 'claro', rotulo: 'Claro' },
  { valor: 'escuro', rotulo: 'Escuro' },
  { valor: 'sistema', rotulo: 'Igual ao aparelho' },
];

export function TemaForm({ tema }: { tema: Tema }) {
  const [state, action, pendente] = useActionState<TemaState, FormData>(escolherTemaAction, {});
  return (
    <form action={action} className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="font-medium">Tema</legend>
        {OPCOES.map((o) => (
          <label key={o.valor} className="flex min-h-11 items-center gap-2">
            <input type="radio" name="tema" value={o.valor} defaultChecked={tema === o.valor} />
            {o.rotulo}
          </label>
        ))}
      </fieldset>
      <button disabled={pendente} className="inline-flex min-h-11 items-center rounded-full bg-destaque px-5 font-semibold text-white">Salvar tema</button>
      {state.erro && <p role="alert" className="text-erro">{state.erro}</p>}
      {state.ok && <p role="status">Tema salvo.</p>}
    </form>
  );
}
```

`src/app/painel/configuracoes/page.tsx` (arquivo inteiro)

```tsx
import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { ehTema } from '@/modules/plataforma/preferencias-tipos';
import { TemaForm } from './tema-form';

export const dynamic = 'force-dynamic';

const CARTOES = [
  { href: '/painel/configuracoes/perfil', titulo: 'Perfil e marca', texto: 'Nome, CRN, logo, cor e regras da agenda.' },
  { href: '/painel/agenda/horarios', titulo: 'Horários de atendimento', texto: 'Dias, horários e bloqueios da agenda.' },
  { href: '/painel/whatsapp', titulo: 'WhatsApp', texto: 'Conectar o número do consultório.' },
  { href: '/painel/alimentos', titulo: 'Alimentos', texto: 'Tabela TACO e os seus alimentos.' },
  { href: '/painel/planos/modelos', titulo: 'Modelos de plano', texto: 'Planos prontos para começar mais rápido.' },
  { href: '/painel/anamnese/modelos', titulo: 'Modelos de anamnese', texto: 'Perguntas da primeira consulta.' },
  { href: '/conta/seguranca', titulo: 'Segurança', texto: 'Senha e verificação em duas etapas.' },
];

/** D20: hub de Configurações. */
export default async function ConfiguracoesPage() {
  const { data } = await requireNutri('/painel/configuracoes');
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-6 p-4 md:p-6">
      <h1 className="font-titulo text-2xl font-semibold">Configurações</h1>
      <ul className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        {CARTOES.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className="block h-full rounded-3xl border border-borda bg-cartao p-5 hover:border-campo">
              <span className="block font-titulo text-lg font-semibold">{c.titulo}</span>
              <span className="mt-1 block text-suave">{c.texto}</span>
            </Link>
          </li>
        ))}
      </ul>
      <section aria-labelledby="tema" className="max-w-lg rounded-3xl border border-borda bg-cartao p-5">
        <h2 id="tema" className="sr-only">Tema</h2>
        <TemaForm tema={ehTema(data.user.tema) ? data.user.tema : 'sistema'} />
      </section>
    </main>
  );
}
```

Nos `actions.ts` dos formulários de perfil e logo (`src/app/painel/configuracoes/actions.ts` e a rota do logo), trocar `revalidatePath('/painel/configuracoes')` por `revalidatePath('/painel', 'layout')` (a marca aparece no cabeçalho de todas as telas). Os textos "Horários de atendimento", "Dias, horários…" etc. entram na tabela de textos da spec no fechamento.

Run: `pnpm test src/app/painel && pnpm typecheck && pnpm lint && pnpm build` → PASS. Os E2E que navegam pelo menu antigo são ajustados na Tarefa 17.

- [ ] **Step 8: Commit**

```bash
git add src/app/painel src/lib/session.ts src/app/globals.css
git commit -m "feat(visual): layout do painel com cabeçalho novo, menu de 6 itens, menu da conta, botão de tema e hub de Configurações (D19, D20, D21)"
```

---

### Task 15: Componentes base e o Início em bento (D21, D22; CS-02 do P08-07 no cartão)

**Files:**
- Create: `src/components/ui/cartao.tsx`, `src/components/ui/botao.tsx`, `src/components/ui/aviso.tsx`, `src/components/ui/selo.tsx`, `src/components/ui/ui.test.ts`, `src/modules/agenda/inicio.ts`, `src/modules/agenda/inicio.test.ts`
- Modify: `src/components/campo.tsx`, `src/modules/portal/diario-nutri.ts` (+ teste), `src/app/painel/page.tsx`, `e2e/auth.spec.ts`, `e2e/plataforma.spec.ts`, `e2e/sair.spec.ts`

**Interfaces:**
- Consumes: `listarAgenda`, `STATUS_ATIVOS`, `type Consulta` (`agenda/consultas.ts`); `inicioDoDia` (`agenda/fuso.ts`); `hojeNoFuso`, `somarDias`; `indicadoresDaAgenda`, `contarPendenciasDePresenca`, `novidadesDaAgenda`, `textoTaxa`, `MSG_PRESENCA`; `pedidosDoTitularAbertos`; `metricasDeSucesso`, `DIAS_CS01`, `META_CS02` (T9); `CINZA_SOBRE_DESTAQUE` (T12).
- Produces:
  - `@/components/ui/cartao`: `Cartao({ id, titulo, children, acao?, className?, destaque? })`; `@/components/ui/botao`: `Botao(props & { variante?: 'primario' | 'secundario' | 'escuro' })`, `BotaoLink(props de Link & { variante? })`; `@/components/ui/aviso`: `Aviso({ tipo: 'erro' | 'aviso' | 'ok'; papel?: 'alert' | 'status'; children })`; `@/components/ui/selo`: `Selo({ children })`.
  - `@/modules/agenda/inicio`: `resumoDoDia(ctx, fuso, agora, db?): Promise<ResumoDoDia>`, `type ResumoDoDia = { proxima: { consulta: Consulta; numero: number; diario7d: number; portal7d: number } | null; hoje: { total: number; confirmadas: number; pedidosRemarcacao: number }; agenda: Consulta[] }`.
  - `@/modules/portal/diario-nutri`: `contarDiariosNaoVistos(ctx, db?): Promise<number>`.

- [ ] **Step 1: Componentes (teste e código)** — `src/components/ui/ui.test.ts`

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Aviso } from './aviso';
import { Botao } from './botao';
import { Cartao } from './cartao';

describe('componentes base (D24)', () => {
  it('Aviso de erro é role="alert"; de aviso, "status"; o papel pode ser forçado', () => {
    expect(renderToStaticMarkup(createElement(Aviso, { tipo: 'erro' }, 'x'))).toContain('role="alert"');
    expect(renderToStaticMarkup(createElement(Aviso, { tipo: 'aviso' }, 'x'))).toContain('role="status"');
    expect(renderToStaticMarkup(createElement(Aviso, { tipo: 'aviso', papel: 'alert' }, 'x'))).toContain('role="alert"');
  });
  it('Cartao é uma seção nomeada pelo h2', () => {
    const html = renderToStaticMarkup(createElement(Cartao, { id: 'hoje', titulo: 'Hoje' }, 'x'));
    expect(html).toMatch(/<section aria-labelledby="hoje"[^>]*>.*<h2 id="hoje"[^>]*>Hoje<\/h2>/);
  });
  it('Botao tem alvo de 44 px (min-h-11)', () => {
    expect(renderToStaticMarkup(createElement(Botao, { type: 'button' }, 'Salvar'))).toContain('min-h-11');
  });
});
```

`src/components/ui/cartao.tsx`

```tsx
import type { HTMLAttributes, ReactNode } from 'react';

type Props = { id: string; titulo: string; children?: ReactNode; acao?: ReactNode; className?: string; destaque?: boolean } & Omit<HTMLAttributes<HTMLElement>, 'title' | 'id' | 'className' | 'children'>;

/** D24: o cartão do Bento (raio 24). `destaque`: fundo na cor do consultório, todo texto branco (≥ 4,5 garantido). `resto`: data-guia (manual). */
export function Cartao({ id, titulo, children, acao, className = '', destaque = false, ...resto }: Props) {
  return (
    <section {...resto} aria-labelledby={id} className={`rounded-3xl border p-5 ${destaque ? 'border-transparent bg-destaque text-white' : 'border-borda bg-cartao text-texto'} ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 id={id} className="font-titulo text-lg font-semibold">{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}
```

`src/components/ui/botao.tsx`

```tsx
import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps } from 'react';

const ESTILO = {
  primario: 'bg-destaque text-white hover:brightness-110',
  secundario: 'border border-campo bg-cartao text-texto hover:bg-linha',
  escuro: 'bg-botao text-botao-texto hover:opacity-90',
} as const;
type Variante = keyof typeof ESTILO;
const BASE = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 font-semibold disabled:opacity-60';

export function Botao({ variante = 'primario', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return <button className={`${BASE} ${ESTILO[variante]} ${className}`} {...props} />;
}

export function BotaoLink({ variante = 'primario', className = '', ...props }: ComponentProps<typeof Link> & { variante?: Variante }) {
  return <Link className={`${BASE} ${ESTILO[variante]} ${className}`} {...props} />;
}
```

`src/components/ui/aviso.tsx`

```tsx
import type { ReactNode } from 'react';

const ESTILO = { erro: 'border-erro bg-erro-fundo text-erro', aviso: 'border-aviso bg-aviso-fundo text-aviso', ok: 'border-ok bg-ok-fundo text-ok' } as const;

/** Mensagens do topo das telas (cota, WhatsApp, sucesso). Erro anuncia na hora (alert); o resto, educado (status). */
export function Aviso({ tipo, papel, children }: { tipo: keyof typeof ESTILO; papel?: 'alert' | 'status'; children: ReactNode }) {
  return (
    <p role={papel ?? (tipo === 'erro' ? 'alert' : 'status')} className={`rounded-2xl border p-3 ${ESTILO[tipo]}`}>
      {children}
    </p>
  );
}
```

`src/components/ui/selo.tsx`

```tsx
import type { ReactNode } from 'react';

export function Selo({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-linha px-2 py-0.5 text-sm text-texto">{children}</span>;
}
```

`src/components/campo.tsx`: input `className="w-full rounded-xl border border-campo bg-cartao p-2 text-texto"`, dica `text-suave`, erro `text-erro`. Run: `pnpm test src/components` → PASS.

- [ ] **Step 2: Dados do Início (teste)** — `src/modules/agenda/inicio.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { accessEvents, diaryEntries } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { contarDiariosNaoVistos } from '@/modules/portal/diario-nutri';
import { resumoDoDia } from './inicio';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const fuso = 'America/Sao_Paulo';
const agora = new Date('2026-10-20T15:00:00Z'); // 12:00 em São Paulo
const as = (h: number) => new Date(Date.UTC(2026, 9, 20, h + 3, 0)); // hora local → UTC

describe('Início em bento (D22)', () => {
  it('próxima consulta: a primeira de hoje que ainda não terminou; nº da consulta; diário e portal em 7 dias (só contagens)', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await consultaDireta(app.db, T.ctx, ana.id, new Date('2026-09-20T13:00:00Z'), 60, { status: 'realizada' });
    await consultaDireta(app.db, T.ctx, bia.id, as(9), 60, { status: 'confirmada' }); // já terminou
    await consultaDireta(app.db, T.ctx, ana.id, as(15), 60, { status: 'confirmada' });
    await consultaDireta(app.db, T.ctx, bia.id, as(17), 60, { pedidoRemarcacaoEm: agora });
    await withTenant(T.ctx, async (tx) => {
      await tx.insert(diaryEntries).values([
        { tenantId: T.tenantId, patientId: ana.id, refeicao: 'Almoço', texto: 'arroz', dataHora: new Date('2026-10-18T15:00:00Z') },
        { tenantId: T.tenantId, patientId: ana.id, refeicao: 'Jantar', texto: 'sopa', dataHora: new Date('2026-10-01T22:00:00Z') }, // fora dos 7 dias
      ]);
      await tx.insert(accessEvents).values([
        { tenantId: T.tenantId, patientId: ana.id, dia: '2026-10-19' },
        { tenantId: T.tenantId, patientId: ana.id, dia: '2026-10-20' },
      ]);
    }, app.db);
    const r = await resumoDoDia(T.ctx, fuso, agora, app.db);
    expect(r.proxima?.consulta.patientId).toBe(ana.id);
    expect(r.proxima).toMatchObject({ numero: 2, diario7d: 1, portal7d: 2 });
    expect(r.hoje).toEqual({ total: 3, confirmadas: 2, pedidosRemarcacao: 1 });
    expect(r.agenda.map((c) => c.inicio.toISOString())).toEqual([as(9), as(15), as(17)].map((d) => d.toISOString()));
    expect(await contarDiariosNaoVistos(T.ctx, app.db)).toBe(2);
  });
  it('sem consulta hoje: proxima null e totais zerados', async () => {
    const T = await novoTenant(app.db);
    expect(await resumoDoDia(T.ctx, fuso, agora, app.db)).toEqual({ proxima: null, hoje: { total: 0, confirmadas: 0, pedidosRemarcacao: 0 }, agenda: [] });
  });
});
```

Run: `pnpm test src/modules/agenda/inicio.test.ts` → FAIL.

- [ ] **Step 3: Implementação** — `src/modules/agenda/inicio.ts`

```ts
import { sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { accessEvents, appointments, diaryEntries } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { hojeNoFuso, somarDias } from '@/modules/pacientes/datas';
import { listarAgenda, STATUS_ATIVOS, type Consulta } from './consultas';
import { inicioDoDia } from './fuso';

export type ResumoDoDia = {
  proxima: { consulta: Consulta; numero: number; diario7d: number; portal7d: number } | null;
  hoje: { total: number; confirmadas: number; pedidosRemarcacao: number };
  agenda: Consulta[];
};

/**
 * Início (D22): a agenda de hoje (como a leitura da agenda, sem auditRead — D10 do Plano 05) e, da próxima consulta, só
 * contagens (registros no diário e dias no portal em 7 dias). Nada de peso nem de outro dado clínico.
 */
export async function resumoDoDia(ctx: TenantContext, fuso: string, agora: Date, db: Db = getDb()): Promise<ResumoDoDia> {
  const hoje = hojeNoFuso(fuso, agora);
  const agenda = (await listarAgenda(ctx, inicioDoDia(hoje, fuso), inicioDoDia(somarDias(hoje, 1), fuso), db)).filter((c) => c.status !== 'cancelada');
  const resumo = {
    total: agenda.length,
    confirmadas: agenda.filter((c) => c.status === 'confirmada').length,
    pedidosRemarcacao: agenda.filter((c) => c.pedidoRemarcacaoEm !== null).length,
  };
  const consulta = agenda.find((c) => c.fim.getTime() > agora.getTime() && STATUS_ATIVOS.includes(c.status)) ?? null;
  if (!consulta) return { proxima: null, hoje: resumo, agenda };
  const desde = somarDias(hoje, -6);
  const r = await withTenant(
    ctx,
    (tx) =>
      tx.execute<{ numero: string; diario: string; portal: string }>(sql`select
        (select count(*) from ${appointments} where ${appointments.patientId} = ${consulta.patientId} and ${appointments.status} <> 'cancelada' and ${appointments.inicio} <= ${consulta.inicio}) as numero,
        (select count(*) from ${diaryEntries} where ${diaryEntries.patientId} = ${consulta.patientId} and ${diaryEntries.dataHora} >= ${inicioDoDia(desde, fuso)}) as diario,
        (select count(*) from ${accessEvents} where ${accessEvents.patientId} = ${consulta.patientId} and ${accessEvents.dia} >= ${desde}) as portal`),
    db,
  );
  const [x] = r.rows;
  return { proxima: { consulta, numero: Number(x.numero), diario7d: Number(x.diario), portal7d: Number(x.portal) }, hoje: resumo, agenda };
}
```

`src/modules/portal/diario-nutri.ts`, acrescentar:

```ts
/** Início (cartão "Diários para ver"): só a contagem — sem auditRead (nenhum registro é devolvido). */
export async function contarDiariosNaoVistos(ctx: TenantContext, db: Db = getDb()): Promise<number> {
  const [r] = await withTenant(ctx, (tx) => tx.select({ n: count() }).from(diaryEntries).where(isNull(diaryEntries.vistoPelaNutriEm)), db);
  return r.n;
}
```

(imports `count`, `isNull` de `drizzle-orm`, se faltarem.) Run: `pnpm test src/modules/agenda/inicio.test.ts` → PASS.

- [ ] **Step 4: A página** — `src/app/painel/page.tsx` (arquivo inteiro)

```tsx
import Link from 'next/link';
import { Aviso } from '@/components/ui/aviso';
import { BotaoLink } from '@/components/ui/botao';
import { Cartao } from '@/components/ui/cartao';
import { formatarBytes } from '@/lib/format';
import { formatarDecimal } from '@/lib/numero';
import { CINZA_SOBRE_DESTAQUE } from '@/lib/tema/marca-tema';
import { requireNutri } from '@/lib/tenant-session';
import type { Consulta } from '@/modules/agenda/consultas';
import { formatarQuando } from '@/modules/agenda/fuso';
import { resumoDoDia } from '@/modules/agenda/inicio';
import { contarPendenciasDePresenca, indicadoresDaAgenda, MSG_PRESENCA, novidadesDaAgenda, textoTaxa } from '@/modules/agenda/presenca';
import { provedorDoApp, situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { MSG_COTA, situacaoDaCota } from '@/modules/notificacoes/whatsapp/cota';
import { formatarData } from '@/modules/pacientes/datas';
import { pedidosDoTitularAbertos } from '@/modules/pacientes/lgpd';
import { COTA_BYTES, MSG_COTA_ESGOTADA, nivelDeUso } from '@/modules/plataforma/armazenamento';
import { DIAS_CS01, metricasDeSucesso } from '@/modules/plataforma/metricas-sucesso';
import { contarDiariosNaoVistos } from '@/modules/portal/diario-nutri';

export const dynamic = 'force-dynamic';

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export default async function PainelHome() {
  const { data, tenant, ctx } = await requireNutri('/painel');
  const agora = new Date();
  const whatsapp = await situacaoDoWhatsapp(ctx, provedorDoApp() !== null);
  const cota = whatsapp.ligado ? await situacaoDaCota(ctx, tenant) : null; // RN-09: só com o WhatsApp ligado
  // cada leitura é uma transação; nenhuma dentro de outra
  const [ind, pendentes, nov, pedidos, dia, naoVistos, cs] = await Promise.all([
    indicadoresDaAgenda(ctx, tenant.fuso, agora),
    contarPendenciasDePresenca(ctx, agora),
    novidadesDaAgenda(ctx, agora),
    pedidosDoTitularAbertos(ctx),
    resumoDoDia(ctx, tenant.fuso, agora),
    contarDiariosNaoVistos(ctx),
    metricasDeSucesso(ctx, tenant, agora),
  ]);
  const hora = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: tenant.fuso, hour: '2-digit', minute: '2-digit' }).format(d);
  const novidades: [string, Consulta[]][] = [
    ['Pedidos de remarcação', nov.pedidosRemarcacao],
    ['Marcadas pelo paciente (últimos 7 dias)', nov.marcadasPeloPaciente],
    ['Canceladas pelo paciente (últimos 7 dias)', nov.canceladasPeloPaciente],
  ];
  const uso = nivelDeUso(tenant.armazenamentoBytes);
  const p = dia.proxima;
  const maxBarra = Math.max(1, ...cs.cs02.porDia.map((d) => d.n));
  return (
    <main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-titulo text-3xl font-extrabold">{`Seu dia, ${data.user.name.split(/\s+/)[0]}`}</h1>
        <div className="flex flex-wrap gap-2" data-guia="atalhos-topo">
          <BotaoLink href="/painel/pacientes/novo" variante="secundario">Novo paciente</BotaoLink>
          <BotaoLink href="/painel/agenda/nova">Agendar</BotaoLink>
        </div>
      </div>

      {uso.nivel === 'esgotado' && <Aviso tipo="erro">{MSG_COTA_ESGOTADA}</Aviso>}
      {uso.nivel === 'aviso' && (
        <Aviso tipo="aviso">{`Você já usou ${uso.percentual}% do espaço de armazenamento (${formatarBytes(tenant.armazenamentoBytes)} de ${formatarBytes(COTA_BYTES)}).`}</Aviso>
      )}
      {whatsapp.ligado && whatsapp.conectadaAntes && whatsapp.estado === 'desconectada' && (
        <Aviso tipo="aviso" papel="alert">
          WhatsApp desconectado. Os lembretes estão saindo só por e-mail e notificação no app. <Link href="/painel/whatsapp" className="underline">Conectar de novo</Link>
        </Aviso>
      )}
      {cota?.nivel === 'aviso' && <Aviso tipo="aviso">{MSG_COTA.aviso}</Aviso>}
      {cota?.nivel === 'esgotada' && <Aviso tipo="erro">{MSG_COTA.esgotada}</Aviso>}

      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        <Cartao id="proxima" titulo="Próxima consulta" destaque className="md:col-span-2 md:row-span-2" data-guia="proxima-consulta">
          {p ? (
            <div className="space-y-4">
              <p className="font-titulo text-5xl font-extrabold">{hora(p.consulta.inicio)}</p>
              <p className="text-xl font-semibold">{p.consulta.paciente}</p>
              <p>
                {[p.consulta.modalidade === 'online' ? 'Online' : 'Presencial', `${p.numero}ª consulta`, p.consulta.confirmadaVia === 'link' ? 'Confirmada pelo link' : p.consulta.confirmadaVia === 'whatsapp' ? 'Confirmada pelo WhatsApp' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                <li className="rounded-2xl p-3" style={{ background: CINZA_SOBRE_DESTAQUE }}>{p.diario7d === 1 ? 'Diário: 1 registro em 7 dias' : `Diário: ${p.diario7d} registros em 7 dias`}</li>
                <li className="rounded-2xl p-3" style={{ background: CINZA_SOBRE_DESTAQUE }}>{`Portal: ${p.portal7d} de 7 dias`}</li>
              </ul>
              <div className="flex flex-wrap gap-2">
                <Link href={`/painel/pacientes/${p.consulta.patientId}`} className="inline-flex min-h-11 items-center rounded-full bg-white px-5 font-semibold text-[#14211d]">Abrir prontuário</Link>
                {p.consulta.modalidade === 'online' && p.consulta.linkOnline && (
                  <a href={p.consulta.linkOnline} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-white px-5 font-semibold text-white">Entrar na chamada</a>
                )}
              </div>
            </div>
          ) : (
            <p>Nenhuma consulta hoje.</p>
          )}
        </Cartao>

        <Cartao id="hoje" titulo="Hoje">
          <p className="font-titulo text-4xl font-extrabold">{plural(dia.hoje.total, 'consulta', 'consultas')}</p>
          <p className="text-suave">{`${dia.hoje.confirmadas} confirmadas · ${plural(dia.hoje.pedidosRemarcacao, 'pedido de remarcação', 'pedidos de remarcação')}`}</p>
        </Cartao>

        <Cartao id="diarios" titulo="Diários para ver" className="border-transparent! bg-[#f3b660]! text-[#2c1c05]!">
          <p className="font-titulo text-4xl font-extrabold">{plural(naoVistos, 'registro novo', 'registros novos')}</p>
          <Link href="/painel/diarios" className="underline">Abrir Diários</Link>
        </Cartao>

        <Cartao id="agenda-dia" titulo="Agenda do dia">
          {dia.agenda.length ? (
            <ul className="space-y-1">
              {dia.agenda.map((c) => (
                <li key={c.id}>
                  <Link href={`/painel/agenda/consultas/${c.id}`} className="flex min-h-11 items-center gap-3 rounded-xl px-2 hover:bg-linha">
                    <span className="font-semibold">{hora(c.inicio)}</span>
                    <span>{c.paciente}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-suave">Nenhuma consulta hoje.</p>
          )}
        </Cartao>

        <Cartao id="app-semana" titulo="Pacientes no app esta semana">
          <p>{`${cs.cs02.abriram} de ${cs.cs02.comConta} pacientes abriram o app nos últimos 7 dias`}</p>
          <div aria-hidden="true" className="mt-3 flex h-20 items-end gap-1">
            {cs.cs02.porDia.map((d) => (
              <span key={d.dia} className="flex-1 rounded-t bg-marca" style={{ height: `${Math.max(4, (d.n / maxBarra) * 100)}%` }} />
            ))}
          </div>
        </Cartao>

        <Cartao id="agenda-resumo" titulo="Agenda">
          <p>{`Consultas do mês: ${ind.consultasMes}`}</p>
          <p>{`Taxa de faltas do mês: ${textoTaxa(ind.taxaMes, ind.faltasMes, ind.iniciadasMes)}`}</p>
          <p>{`Mês anterior: ${textoTaxa(ind.taxaMesAnterior)}`}</p>
          {pendentes > 0 && <p><Link href="/painel/agenda/pendencias" className="underline">{MSG_PRESENCA.pendencias(pendentes)}</Link></p>}
          {novidades.map(([titulo, lista]) =>
            lista.length ? (
              <div key={titulo} className="mt-2">
                <h3 className="font-medium">{titulo}</h3>
                <ul className="list-disc pl-5 text-sm">
                  {lista.map((c) => <li key={c.id}><Link href={`/painel/agenda/consultas/${c.id}`} className="underline">{`${c.paciente} — ${formatarQuando(c.inicio, tenant.fuso)}`}</Link></li>)}
                </ul>
              </div>
            ) : null,
          )}
        </Cartao>

        <Cartao id="criterios" titulo="Critérios de sucesso">
          <ul className="space-y-1">
            <li>{`Atendimentos registrados: ${cs.cs01.comAtendimento} de ${cs.cs01.realizadas} consultas realizadas (${pct(cs.cs01.comAtendimento, cs.cs01.realizadas)})`}</li>
            {cs.cs01.desde && <li>{`Dias desde o início: ${Math.min(cs.cs01.dias, DIAS_CS01)} de ${DIAS_CS01}`}</li>}
            {cs.cs03.base !== null && <li>{`Taxa de faltas antes do sistema: ${formatarDecimal(cs.cs03.base, 1)}%`}</li>}
          </ul>
        </Cartao>

        {pedidos.length > 0 && (
          <Cartao id="pedidos-titular" titulo="Pedidos do titular" className="border-aviso!">
            <ul className="list-disc pl-5 text-sm">
              {pedidos.map((x) => (
                <li key={`${x.patientId}-${x.tipo}`}>
                  <Link href={`/painel/pacientes/${x.patientId}/privacidade`} className="underline">
                    {x.tipo === 'exclusao' ? `Pedido de exclusão de ${x.nome}` : `Pedido de dados de ${x.nome}`}
                  </Link>
                  {` · prazo ${formatarData(x.prazo)}`}
                </li>
              ))}
            </ul>
          </Cartao>
        )}

        <Cartao id="atalhos" titulo="Atalhos" className="border-transparent! bg-botao! text-botao-texto!">
          <ul className="flex flex-wrap gap-2" data-guia="atalhos">
            <li><Link href="/painel/pacientes/novo" className="inline-flex min-h-11 items-center rounded-full border border-current px-4">Novo paciente</Link></li>
            <li><Link href="/painel/agenda/nova" className="inline-flex min-h-11 items-center rounded-full border border-current px-4">Agendar</Link></li>
            <li><Link href="/painel/conteudos/novo?tipo=video" className="inline-flex min-h-11 items-center rounded-full border border-current px-4">Novo conteúdo</Link></li>
          </ul>
        </Cartao>
      </div>
    </main>
  );
}
```

O `!` no fim da classe (important do Tailwind 4) nos cartões "Diários" e "Atalhos" sobrescreve o fundo do `Cartao` (cores fixas do design, 9,15:1 e 15,5:1 nos dois modos). O `formatarDecimal` é o de `src/lib/numero.ts` (vírgula, RNF-12).

- [ ] **Step 5: E2E que dependiam do título antigo** — trocar `getByRole('heading', { name: 'Painel da nutricionista' })` por `getByRole('heading', { name: /^Seu dia, / })` em `e2e/auth.spec.ts`, `e2e/plataforma.spec.ts` e `e2e/sair.spec.ts` (6 ocorrências); procurar também `'Conectado como'` (agora no menu da conta: abrir `getByRole('group')`/`summary` "Conta de …" antes de conferir). Run: `pnpm test && pnpm build && pnpm test:e2e e2e/auth.spec.ts e2e/plataforma.spec.ts e2e/sair.spec.ts e2e/agenda.spec.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components src/modules/agenda/inicio.ts src/modules/agenda/inicio.test.ts src/modules/portal/diario-nutri.ts src/app/painel/page.tsx e2e/auth.spec.ts e2e/plataforma.spec.ts e2e/sair.spec.ts
git commit -m "feat(visual): componentes base e o Início em bento — próxima consulta, hoje, diários, agenda do dia, app na semana e critérios de sucesso (D21, D22, P08-07)"
```

---
### Task 16: As demais telas do painel com os tokens (visual V2 em todas as telas; D24)

**Files:**
- Create: `src/app/painel/cores.test.ts`
- Modify: os `.tsx` de `src/app/painel/**` (prontuário e abas, editor do plano e modelos, agenda, pacientes, diários, alimentos, modelos de anamnese, WhatsApp, DPA), `src/components/*.tsx`, `src/modules/pacientes/ui/grafico-linha.tsx` (+ teste), `src/modules/plataforma/ui/historico-acessos.tsx`, `src/app/conta/seguranca/**` (D20: a Segurança ganha os tokens, sem o layout do painel)

**Interfaces:**
- Consumes: tokens e classes (T12); `Botao`, `BotaoLink`, `Cartao`, `Aviso`, `Selo`, `Campo` (T15).
- Produces: nenhuma classe de cor fixa da paleta do Tailwind nas telas da nutricionista (guarda `cores.test.ts`); `border` sempre com cor de token.

- [ ] **Step 1: A guarda (falha em dezenas de arquivos)** — `src/app/painel/cores.test.ts`

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Visual V2 (D24): as telas da nutricionista usam só tokens (mudam com o tema). Cor fixa da paleta do Tailwind reprova no
// escuro (text-red-700: 2,55 sobre o cartão escuro; text-zinc-600: 2,14). `text-white` fica: só sobre bg-destaque/bg-marca.
const PASTAS = ['src/app/painel', 'src/components', 'src/modules', 'src/app/conta'];
const ARQUIVOS = PASTAS.flatMap((p) =>
  readdirSync(path.resolve(p), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.tsx') && (p !== 'src/modules' || d.parentPath.split(path.sep).includes('ui')))
    .map((d) => path.relative(process.cwd(), path.join(d.parentPath, d.name)).split(path.sep).join('/')),
).sort();

/** Arquivos que precisam de cor fixa, com o motivo. */
const EXCECOES: Record<string, string> = {
  'src/app/painel/whatsapp/conectar.tsx': 'o QR precisa de fundo branco para ser lido, também no modo escuro',
  'src/app/painel/cabecalho.tsx': 'o logo do consultório fica sobre fundo branco (um logo escuro sem fundo sumiria no escuro)',
  'src/app/painel/page.tsx': 'Início (T15): o botão "Abrir prontuário" é branco sobre o cartão de destaque, que tem a cor original da marca nos dois modos (bg-destaque); nenhum token é branco nos dois modos',
  'src/components/player-sob-demanda.tsx': 'player sob demanda (T6, D12): moldura preta como a do próprio YouTube/Vimeo nos dois modos, botão branco com texto preto sobre ela (21:1 fixo)',
};

const PALETA = 'red|amber|emerald|zinc|gray|green|yellow|blue|slate|neutral|stone|orange|lime|teal|sky|indigo|violet|purple|pink|rose';
const COR_FIXA = new RegExp(`(?<![\\w-])(?:dark:[\\w-]+|(?:text|bg|border|ring|outline|fill|stroke|divide|placeholder|decoration|from|via|to)-(?:${PALETA})-\\d{2,3}|bg-white|bg-black|text-black)(?![\\w-])`, 'g');
const CLASSES = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;
const BORDA_COM_COR = /border-(?:campo|borda|transparent|marca|destaque|erro|aviso|ok|linha|current|white)/;

function problemas(arquivo: string): string[] {
  const s = readFileSync(arquivo, 'utf8');
  const out = [...s.matchAll(COR_FIXA)].map((m) => m[0]);
  for (const m of s.matchAll(CLASSES)) {
    const c = m[1] ?? m[2] ?? '';
    if (/(^|\s)border(\s|$)/.test(c) && !BORDA_COM_COR.test(c)) out.push(`"border" sem cor: ${c}`);
  }
  return out;
}

describe('sem cor fixa nas telas da nutricionista (D24)', () => {
  it.each(ARQUIVOS.filter((f) => !(f in EXCECOES)))('%s', (f) => expect(problemas(f)).toEqual([]));
  it('as exceções existem e ainda precisam ser exceção', () => {
    for (const f of Object.keys(EXCECOES)) expect(problemas(f).length, f).toBeGreaterThan(0);
  });
});
```

Run: `pnpm test src/app/painel/cores.test.ts` → FAIL (a lista dos arquivos é o trabalho desta tarefa).

- [ ] **Step 2: Trocas mecânicas (1:1)** — em todos os arquivos da guarda, menos as exceções:

```bash
FILES=$(grep -rlE '(text|bg|border|fill|stroke)-(red|amber|emerald|green|zinc|gray)-[0-9]{2,3}|dark:' src/app/painel src/components src/modules/*/ui src/app/conta --include=*.tsx | grep -v -e whatsapp/conectar.tsx -e painel/cabecalho.tsx -e "^src/app/painel/page.tsx$" -e player-sob-demanda.tsx)
perl -pi -e '
  s/\btext-red-(?:600|700|800)\b/text-erro/g;      s/\bbg-red-50\b/bg-erro-fundo/g;     s/\bborder-red-\d{3}\b/border-erro/g;
  s/\btext-amber-(?:700|800|900)\b/text-aviso/g;   s/\bbg-amber-50\b/bg-aviso-fundo/g;  s/\bborder-amber-\d{3}\b/border-aviso/g;
  s/\btext-(?:emerald|green)-(?:700|800)\b/text-ok/g; s/\bbg-(?:emerald|green)-50\b/bg-ok-fundo/g;
  s/\bhover:bg-emerald-800\b/hover:brightness-110/g; s/\bbg-emerald-700\b/bg-destaque/g;  s/\bborder-emerald-700\b/border-destaque/g;
  s/\btext-(?:zinc|gray)-(?:500|600|700)\b/text-suave/g; s/\btext-(?:zinc|gray)-900\b/text-texto/g;
  s/\bbg-(?:zinc|gray)-(?:50|100|200)\b/bg-linha/g; s/\bborder-(?:zinc|gray)-\d{3}\b/border-borda/g;
' $FILES
```

- [ ] **Step 3: Trocas que pedem olho (tabela)** — o que a guarda ainda apontar, pela regra:

| Padrão de hoje | Vira |
|---|---|
| `rounded bg-destaque px-4 py-2 text-white` (botão principal, 24×) | `<Botao>` / `<BotaoLink>` (ou a mesma classe com `inline-flex min-h-11 items-center rounded-full px-5 font-semibold`) |
| `w-full rounded border p-2` (input/select/textarea, 27×) | `w-full rounded-xl border border-campo bg-cartao p-2 text-texto` |
| `rounded border p-3`/`rounded border` em blocos e listas | `rounded-2xl border border-borda bg-cartao p-3` (ou `<Cartao>` quando tem título) |
| `<p role="alert" className="… bg-red-50 …">` / `role="status" … bg-amber-50` | `<Aviso tipo="erro">` / `<Aviso tipo="aviso">` |
| `rounded bg-linha px-2 py-0.5 text-sm` (selo de situação) | `<Selo>` |
| `text-2xl font-semibold` no `<h1>` | `font-titulo text-2xl font-semibold` |
| `<main className="p-6">` | `<main className="mx-auto w-full max-w-[1360px] space-y-4 p-4 md:p-6">` (formulários estreitos ficam com o `max-w-lg` de hoje) |
| `underline` em link de texto | `text-link underline` |
| tabelas (10) | `<table className="w-full text-left">`, `<thead className="text-sm text-suave">`, linhas `border-t border-linha` |

Arquivos com regra própria:
- `src/modules/pacientes/ui/grafico-linha.tsx`: `figure` → `text-suave`; `polyline` → `className="stroke-marca"`; o círculo → `className="fill-marca stroke-cartao"` (sem `dark:`: o gráfico segue o tema da usuária, não o do aparelho). O `grafico-linha.test.ts` que confere classes passa a esperar essas.
- `src/app/painel/pacientes/[id]/abas.tsx`: a faixa vira `flex gap-1 overflow-x-auto border-b border-borda` (só a faixa rola em tela estreita); a aba ativa `border-b-2 border-destaque font-semibold`; cada aba `inline-flex min-h-11 items-center px-3`.
- `src/app/painel/pacientes/[id]/layout.tsx`: o cabeçalho do paciente num cartão (`rounded-3xl border border-borda bg-cartao p-5`), o selo com `<Selo>`, a linha de idade/sexo/e-mail `text-suave`; `data-guia="cabecalho-paciente"` no cartão (Tarefa 20).
- `src/app/painel/planos/editor/*` (editor do plano, a maior tela cliente): refeições em cartões, o painel de totais com `bg-cartao border-borda`; **não mexer** no `data-sair` nem no `use-salvamento.ts`.
- `src/app/conta/seguranca/**`: a página ganha `data-tema="claro"` num contêiner (fica sempre clara: o admin também usa) e os tokens no lugar das 8 cores fixas de `enable-2fa.tsx`.

- [ ] **Step 4: Por área, com conferência visual e commit** — para cada área abaixo: rodar a guarda filtrada, abrir as telas em `pnpm dev` (porta 3100) com o tema claro e o escuro (botão do cabeçalho) e conferir se nada ficou ilegível ou desalinhado (o `mcp__playwright__browser_take_screenshot` ajuda); depois `pnpm test && pnpm typecheck && pnpm lint` e o commit da área.

```bash
pnpm test src/app/painel/cores.test.ts -t 'pacientes/\[id\]|modules/pacientes/ui|modules/plataforma/ui'
git add -A src/app/painel/pacientes src/modules/pacientes/ui src/modules/plataforma/ui && git commit -m "feat(visual): prontuário, abas e gráficos com os tokens (D24)"

pnpm test src/app/painel/cores.test.ts -t 'planos|plano-alimentar'
git add -A src/app/painel/planos src/app/painel/pacientes && git commit -m "feat(visual): editor do plano e modelos de plano com os tokens (D24)"

pnpm test src/app/painel/cores.test.ts -t 'agenda'
git add -A src/app/painel/agenda src/components/seletor-horarios.tsx && git commit -m "feat(visual): agenda, consulta, horários e pendências com os tokens (D24)"

pnpm test src/app/painel/cores.test.ts
git add -A src/app/painel src/components src/app/conta && git commit -m "feat(visual): pacientes, diários, alimentos, anamnese, WhatsApp, DPA, configurações e segurança com os tokens (D24)"
```

No fim: `pnpm test` inteiro → PASS (inclui `cores.test.ts` verde e as exceções ainda necessárias); `pnpm build && pnpm test:e2e` → PASS (as specs procuram por papel e texto, não por classe).

---

### Task 17: Axe do painel nos três modos, 768 px, teclado e os E2E com o menu novo (RNF-10; D25)

**Files:**
- Create: `e2e/acessibilidade-painel.spec.ts`, `e2e/painel.ts`, `e2e/painel-rotas.ts`, `src/app/painel/rotas-axe.test.ts`
- Modify: `playwright.config.ts`, os specs que navegavam pelo menu antigo (`e2e/*.spec.ts`)

**Interfaces:**
- Consumes: `entrarComo` (`e2e/helpers.ts`); `pacienteNoPortal`, `publicarPlanoSimples`, `marcarParaPaciente`, `avaliar` (`e2e/portal.ts`); o hub de Configurações e o `TemaForm` (T14).
- Produces: projeto Playwright `painel` (Desktop Chrome) só com `acessibilidade-painel.spec.ts`; `escolherTema(page, rotulo: 'Claro' | 'Escuro' | 'Igual ao aparelho')`, `irPeloMenu(page, item)` e `prepararTelasComId(browser, nutri, ip)` em `e2e/painel.ts`; `ROTAS_DO_PAINEL` e `type IdsDoPainel` em `e2e/painel-rotas.ts` (sem import do Playwright: a guarda do Vitest o importa); bloco de IP **10.9.13.x** (nutri .1, outro "aparelho" .2, paciente .3).

- [ ] **Step 1: Projeto do Playwright** — `playwright.config.ts`, em `projects`:

```ts
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /acessibilidade(-painel)?\.spec\.ts/ },
    // RNF-09 / RNF-10: as telas do PWA no tamanho de um Android (Chrome) — o Safari do iOS fica no teste manual do runbook
    { name: 'celular', use: { ...devices['Pixel 7'] }, testMatch: /acessibilidade\.spec\.ts/ },
    // D25 (Plano 08): o painel da nutricionista, em tela de computador, nos modos claro, escuro e "igual ao aparelho"
    { name: 'painel', use: { ...devices['Desktop Chrome'] }, testMatch: /acessibilidade-painel\.spec\.ts/ },
```

- [ ] **Step 2: Helpers** — `e2e/painel.ts`

```ts
import { expect, type Page } from '@playwright/test';

/** D17: grava o tema pela tela de Configurações (o caminho real da usuária). */
export async function escolherTema(page: Page, rotulo: 'Claro' | 'Escuro' | 'Igual ao aparelho'): Promise<void> {
  await page.goto('/painel/configuracoes');
  await page.getByRole('radio', { name: rotulo }).check();
  await page.getByRole('button', { name: 'Salvar tema' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Tema salvo.' })).toBeVisible();
}

/** D20: os seis itens do topo. */
export async function irPeloMenu(page: Page, item: 'Início' | 'Pacientes' | 'Agenda' | 'Diários' | 'Conteúdos' | 'Configurações'): Promise<void> {
  await page.getByRole('navigation', { name: 'Menu do painel' }).getByRole('link', { name: item, exact: true }).click();
}
```

- [ ] **Step 3: Todas as telas, com guarda** — `e2e/painel-rotas.ts` (um padrão por `page.tsx` de `src/app/painel`, com o caminho concreto de cada um):

```ts
/** D25: os ids que as telas com parâmetro precisam (criados pelo caminho real da UI em prepararTelasComId). */
export type IdsDoPainel = {
  paciente: string; consulta: string; alimento: string; modeloAnamnese: string; modeloPlano: string; diario: string;
  anamnese: string; atendimento: string; exportacao: string; plano: string; conteudo: string;
};

/** RNF-10 (D25): toda tela do painel. A guarda rotas-axe.test.ts compara as chaves com os page.tsx — tela nova sem axe quebra o CI. */
export const ROTAS_DO_PAINEL: Record<string, (i: IdsDoPainel) => string> = {
  '/painel': () => '/painel',
  '/painel/agenda': () => '/painel/agenda',
  '/painel/agenda/nova': () => '/painel/agenda/nova',
  '/painel/agenda/horarios': () => '/painel/agenda/horarios',
  '/painel/agenda/pendencias': () => '/painel/agenda/pendencias',
  '/painel/agenda/consultas/[id]': (i) => `/painel/agenda/consultas/${i.consulta}`,
  '/painel/ajuda': () => '/painel/ajuda',
  '/painel/alimentos': () => '/painel/alimentos',
  '/painel/alimentos/novo': () => '/painel/alimentos/novo',
  '/painel/alimentos/[id]': (i) => `/painel/alimentos/${i.alimento}`,
  '/painel/alimentos/[id]/editar': (i) => `/painel/alimentos/${i.alimento}/editar`,
  '/painel/anamnese/modelos': () => '/painel/anamnese/modelos',
  '/painel/anamnese/modelos/novo': () => '/painel/anamnese/modelos/novo',
  '/painel/anamnese/modelos/[modeloId]': (i) => `/painel/anamnese/modelos/${i.modeloAnamnese}`,
  '/painel/configuracoes': () => '/painel/configuracoes',
  '/painel/configuracoes/perfil': () => '/painel/configuracoes/perfil',
  '/painel/conteudos': () => '/painel/conteudos',
  '/painel/conteudos/novo': () => '/painel/conteudos/novo?tipo=video',
  '/painel/conteudos/[id]': (i) => `/painel/conteudos/${i.conteudo}`,
  '/painel/conteudos/[id]/visualizacoes': (i) => `/painel/conteudos/${i.conteudo}/visualizacoes`,
  '/painel/diarios': () => '/painel/diarios',
  '/painel/diarios/[id]': (i) => `/painel/diarios/${i.diario}`,
  '/painel/dpa': () => '/painel/dpa',
  '/painel/pacientes': () => '/painel/pacientes',
  '/painel/pacientes/novo': () => '/painel/pacientes/novo',
  '/painel/pacientes/[id]': (i) => `/painel/pacientes/${i.paciente}`,
  '/painel/pacientes/[id]/anamnese': (i) => `/painel/pacientes/${i.paciente}/anamnese`,
  '/painel/pacientes/[id]/anamnese/nova': (i) => `/painel/pacientes/${i.paciente}/anamnese/nova`,
  '/painel/pacientes/[id]/anamnese/[anamneseId]': (i) => `/painel/pacientes/${i.paciente}/anamnese/${i.anamnese}`,
  '/painel/pacientes/[id]/antropometria': (i) => `/painel/pacientes/${i.paciente}/antropometria`,
  '/painel/pacientes/[id]/atendimentos': (i) => `/painel/pacientes/${i.paciente}/atendimentos`,
  '/painel/pacientes/[id]/atendimentos/[atendimentoId]': (i) => `/painel/pacientes/${i.paciente}/atendimentos/${i.atendimento}`,
  '/painel/pacientes/[id]/evolucao': (i) => `/painel/pacientes/${i.paciente}/evolucao`,
  '/painel/pacientes/[id]/exames': (i) => `/painel/pacientes/${i.paciente}/exames`,
  '/painel/pacientes/[id]/exportacoes/[exportId]': (i) => `/painel/pacientes/${i.paciente}/exportacoes/${i.exportacao}`,
  '/painel/pacientes/[id]/gasto-energetico': (i) => `/painel/pacientes/${i.paciente}/gasto-energetico`,
  '/painel/pacientes/[id]/historico': (i) => `/painel/pacientes/${i.paciente}/historico`,
  '/painel/pacientes/[id]/plano-alimentar': (i) => `/painel/pacientes/${i.paciente}/plano-alimentar`,
  '/painel/pacientes/[id]/plano-alimentar/[planId]': (i) => `/painel/pacientes/${i.paciente}/plano-alimentar/${i.plano}`, // o editor
  '/painel/pacientes/[id]/privacidade': (i) => `/painel/pacientes/${i.paciente}/privacidade`,
  '/painel/planos/modelos': () => '/painel/planos/modelos',
  '/painel/planos/modelos/[id]': (i) => `/painel/planos/modelos/${i.modeloPlano}`,
  '/painel/whatsapp': () => '/painel/whatsapp',
};
```

Guarda — `src/app/painel/rotas-axe.test.ts`:

```ts
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROTAS_DO_PAINEL } from '../../../e2e/painel-rotas';

// RNF-10 (D25): o axe do painel cobre toda tela. Tela nova em src/app/painel sem entrada em ROTAS_DO_PAINEL quebra aqui.
describe('ROTAS_DO_PAINEL', () => {
  it('tem exatamente um caminho por page.tsx de src/app/painel', () => {
    const raiz = path.resolve('src/app');
    const paginas = readdirSync(path.join(raiz, 'painel'), { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && d.name === 'page.tsx')
      .map((d) => `/${path.relative(raiz, d.parentPath).split(path.sep).join('/')}`)
      .sort();
    expect(Object.keys(ROTAS_DO_PAINEL).sort()).toEqual(paginas);
  });
});
```

(Antes da Tarefa 19, `/painel/ajuda` não existe: a entrada entra no commit da T19, com a página. Telas do Plano 07 ou de outro plano mergeado antes entram aqui do mesmo jeito — a guarda diz quais faltam.)

`e2e/painel.ts` — acrescentar o preparo das telas com id, **pelo caminho real da UI** (reaproveitar os passos dos specs que já criam cada coisa: `pacientes.spec.ts`, `plano-alimentar.spec.ts`, `agenda.spec.ts`, `portal.spec.ts`, `plataforma.spec.ts` e o `conteudos.spec.ts` do Plano 07), lendo o id do link da lista:

```ts
import type { Browser } from '@playwright/test';
import type { IdsDoPainel } from './painel-rotas';
import { avaliar, marcarParaPaciente, pacienteNoPortal, publicarPlanoSimples } from './portal';

/** O último segmento do primeiro link da página `lista` que casa com `padrao` (falha com a lista no texto). */
async function idDoLink(page: Page, lista: string, padrao: RegExp): Promise<string> {
  await page.goto(lista);
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  const href = hrefs.find((h) => padrao.test(h.split('?')[0]));
  expect(href, `${lista}: nenhum link casa com ${padrao}`).toBeDefined();
  return padrao.exec(href!.split('?')[0])![1];
}

/**
 * D25: cria um paciente e uma linha de cada tela com parâmetro — plano (publicarPlanoSimples), consulta
 * (marcarParaPaciente), avaliação, anamnese, atendimento, alimento próprio, modelo de anamnese, modelo de plano
 * ("Salvar como modelo" do editor), registro no diário (pelo portal, com o paciente), exportação ("Gerar cópia dos
 * dados" em Privacidade; a tela abre "em preparo" sem o worker) e conteúdo (Plano 07) — e devolve os ids.
 */
export async function prepararTelasComId(browser: Browser, nutri: Page, ip: string): Promise<IdsDoPainel> {
  const paciente = await pacienteNoPortal(browser, nutri, ip);
  const p = paciente.prontuario;
  await publicarPlanoSimples(nutri, p);
  await marcarParaPaciente(nutri, paciente.nome, paciente.email, 2);
  await avaliar(nutri, p, '2026-08-01', '80');
  // … os passos de criação de anamnese, atendimento, alimento, modelos, diário (paciente.page), exportação e conteúdo,
  // copiados dos specs citados acima (mesmos rótulos e mensagens de sucesso)
  await paciente.page.context().close();
  const ids: IdsDoPainel = {
    paciente: p.split('/').pop()!,
    plano: await idDoLink(nutri, `${p}/plano-alimentar`, /\/plano-alimentar\/([0-9a-f-]{36})$/),
    consulta: await idDoLink(nutri, p, /\/painel\/agenda\/consultas\/([0-9a-f-]{36})$/), // a próxima consulta no prontuário; se não houver link ali, a agenda da semana da consulta
    anamnese: await idDoLink(nutri, `${p}/anamnese`, /\/anamnese\/([0-9a-f-]{36})$/),
    atendimento: await idDoLink(nutri, `${p}/atendimentos`, /\/atendimentos\/([0-9a-f-]{36})$/),
    exportacao: await idDoLink(nutri, `${p}/privacidade`, /\/exportacoes\/([0-9a-f-]{36})$/),
    alimento: await idDoLink(nutri, '/painel/alimentos?origem=proprios', /\/painel\/alimentos\/([0-9a-f-]{36})$/),
    modeloAnamnese: await idDoLink(nutri, '/painel/anamnese/modelos', /\/anamnese\/modelos\/([0-9a-f-]{36})$/),
    modeloPlano: await idDoLink(nutri, '/painel/planos/modelos', /\/planos\/modelos\/([0-9a-f-]{36})$/),
    diario: await idDoLink(nutri, '/painel/diarios', /\/painel\/diarios\/([0-9a-f-]{36})$/),
    conteudo: await idDoLink(nutri, '/painel/conteudos', /\/painel\/conteudos\/([0-9a-f-]{36})$/),
  };
  return ids;
}
```

(Conferir em cada lista o formato real do link — e o filtro da lista de alimentos próprios — e ajustar só o padrão; o helper falha dizendo qual lista não tinha o link.)

- [ ] **Step 4: O spec** — `e2e/acessibilidade-painel.spec.ts`

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { escolherTema, prepararTelasComId } from './painel';
import { ROTAS_DO_PAINEL } from './painel-rotas';

// RNF-10 (D25): o painel com zero violação WCAG 2.1 AA (+ alvo de toque da 2.2) nos três modos, em TODAS as telas
// (ROTAS_DO_PAINEL, conferida pela guarda rotas-axe.test.ts). Bloco de IP: 10.9.13.x.
const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
test.describe.configure({ mode: 'serial' });
let nutri: Page;
let rotas: string[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000); // o preparo cria uma linha de cada tela com id
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.1');
  await expect(nutri).toHaveURL(/\/painel$/);
  const ids = await prepararTelasComId(browser, nutri, '10.9.13.3');
  rotas = Object.values(ROTAS_DO_PAINEL).map((f) => f(ids));
});
test.afterAll(async () => {
  await escolherTema(nutri, 'Igual ao aparelho'); // o seed e as outras specs esperam o padrão
  await nutri?.context().close();
});

async function violacoes(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(r.passes.length, 'o axe rodou regras na página').toBeGreaterThan(0);
  // fundos com transparência caem em "incomplete" no color-contrast: não podem passar calados
  const contrasteIncerto = r.incomplete.filter((i) => i.id === 'color-contrast').flatMap((i) => i.nodes.map((n) => `incompleto color-contrast: ${n.target.join(' ')}`));
  return [...r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), ...contrasteIncerto];
}

for (const [modo, tema, aparelho] of [
  ['claro', 'Claro', 'light'],
  ['escuro', 'Escuro', 'light'],
  ['igual ao aparelho (aparelho escuro)', 'Igual ao aparelho', 'dark'],
] as const) {
  test(`axe sem violações em todas as telas do painel — modo ${modo}`, async () => {
    await escolherTema(nutri, tema);
    await nutri.emulateMedia({ colorScheme: aparelho });
    const falhas: string[] = [];
    for (const url of rotas) {
      await nutri.goto(url);
      await nutri.waitForLoadState('networkidle');
      for (const v of await violacoes(nutri)) falhas.push(`${url} — ${v}`);
    }
    await nutri.emulateMedia({ colorScheme: 'light' });
    expect(falhas).toEqual([]);
  });
}

test('estados abertos também passam: menu da conta, aviso de erro de formulário', async () => {
  await escolherTema(nutri, 'Escuro');
  await nutri.goto('/painel');
  await nutri.getByLabel(/^Conta de /).click();
  expect(await violacoes(nutri)).toEqual([]);
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click(); // vazio: erros por campo (role="alert")
  expect(await violacoes(nutri)).toEqual([]);
});

test('768 px: nenhuma tela do painel rola na horizontal', async () => {
  await nutri.setViewportSize({ width: 768, height: 1000 });
  try {
    for (const url of rotas) {
      await nutri.goto(url);
      await nutri.waitForLoadState('networkidle');
      expect(await nutri.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
    }
  } finally {
    await nutri.setViewportSize({ width: 1280, height: 720 });
  }
});

test('D17: o botão de tema alterna, persiste depois de recarregar e em outro aparelho (está na conta, não no navegador)', async ({ browser }) => {
  await escolherTema(nutri, 'Claro');
  await nutri.goto('/painel');
  const botao = nutri.getByRole('button', { name: 'Modo escuro' });
  await expect(botao).toHaveAttribute('aria-pressed', 'false');
  await botao.focus();
  await nutri.keyboard.press('Enter');
  await expect(nutri.locator('[data-tema="escuro"]')).toBeAttached();
  await nutri.reload();
  await expect(nutri.getByRole('button', { name: 'Modo escuro' })).toHaveAttribute('aria-pressed', 'true');
  const outro = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.13.2');
  await expect(outro.locator('[data-tema="escuro"]')).toBeAttached();
  await outro.context().close();
});

test('teclado: Tab chega aos itens do menu na ordem da tela, e o item atual é anunciado', async () => {
  await nutri.goto('/painel/agenda');
  const menu = nutri.getByRole('navigation', { name: 'Menu do painel' });
  await expect(menu.getByRole('link', { name: 'Agenda', exact: true })).toHaveAttribute('aria-current', 'page');
  const rotulos: string[] = [];
  await menu.getByRole('link', { name: 'Início' }).focus();
  for (let i = 0; i < 6; i++) {
    rotulos.push((await nutri.evaluate(() => document.activeElement?.textContent ?? '')).trim());
    await nutri.keyboard.press('Tab');
  }
  expect(rotulos).toEqual(['Início', 'Pacientes', 'Agenda', 'Diários', 'Conteúdos', 'Configurações']);
});
```

(A rota `/painel/ajuda` entra na Tarefa 19; até lá, tirar de `ROTAS_DO_PAINEL` e devolvê-la no commit da T19 — a guarda confere.)

- [ ] **Step 5: Specs que navegavam pelo menu antigo** — listar e trocar pelo caminho novo (link no hub de Configurações, menu da conta ou `page.goto`):

```bash
grep -rn "getByRole('link', { name: '\(Perfil e marca\|WhatsApp\|Alimentos\|Modelos de plano\|Modelos de anamnese\|Segurança\|Sair\)'" e2e
grep -rn "Menu do painel" e2e
```

Regras: "Perfil e marca", "WhatsApp", "Alimentos", "Modelos de plano", "Modelos de anamnese" → `await irPeloMenu(page, 'Configurações'); await page.getByRole('link', { name: /^Perfil e marca|^WhatsApp|…/ }).click();` (o cartão tem o título e o texto no mesmo link: usar `{ name: /^Perfil e marca/ }`); "Segurança" e "Sair" → abrir o menu da conta antes (`await page.getByLabel(/^Conta de /).click()`), menos na tela do DPA, em que o "Sair" está no cabeçalho mínimo. A guarda do `sair.spec.ts` que procura o botão `data-sair` continua valendo (o `BotaoSair` é o mesmo).

Run: `pnpm test src/app/painel/rotas-axe.test.ts` → PASS. `pnpm build && pnpm test:e2e` → PASS nos três projetos (`chromium`, `celular`, `painel`).

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts e2e src/app/painel/rotas-axe.test.ts
git commit -m "test(e2e): axe do painel nos modos claro, escuro e do aparelho, 768 px, teclado, tema na conta e specs no menu novo (RNF-10, D25)"
```

---

### Task 18: Portal do paciente com os tokens e o modo do aparelho (D18 — só se o dono aprovar)

**Files:**
- Modify: `src/app/p/layout.tsx`, `src/app/p/(portal)/layout.tsx` (`data-tema` + cor do consultório), os `.tsx` de `src/app/p/**`, `src/app/painel/cores.test.ts` (inclui o portal), `e2e/acessibilidade.spec.ts`, `e2e/portal.spec.ts`

**Interfaces:**
- Consumes: tokens e componentes (T12, T15); a passada do axe com o aparelho escuro (T12, passo 1).
- Produces: o portal com `data-tema="sistema"` fixo (segue o aparelho, sem botão), fontes Figtree/Bricolage, cartões arredondados e o `themeColor` claro/escuro. A disposição das telas (360 px, barra de abas, R16) não muda.

- [ ] **Step 1: A guarda passa a cobrir o portal (falha)** — `src/app/painel/cores.test.ts`: `const PASTAS = ['src/app/painel', 'src/components', 'src/modules', 'src/app/conta', 'src/app/p'];`. Run → FAIL nos arquivos do portal (10× `text-red-700`, `bg-white` da barra de abas, `text-gray-700` do topo…).

- [ ] **Step 2: Contêiner do tema** — `src/app/p/layout.tsx`:

```tsx
export const viewport: Viewport = {
  // D18: barra do sistema na cor do tema do aparelho
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f1613' },
    { color: '#1d6b5a' },
  ],
};

/** Todas as páginas do portal do paciente ganham o botão "Sair", que limpa o aparelho. D18: o tema segue o aparelho. */
export default function PacienteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-tema="sistema" className="flex min-h-dvh flex-col bg-fundo font-sans text-texto">
      <SwProvider>
        <header className="flex justify-end px-6 pt-4">
          <SairPortal />
        </header>
        {children}
      </SwProvider>
    </div>
  );
}
```

(Conferir o débito T-4 do Plano 07 — `min-h-dvh` aninhado no layout do portal: o `(portal)/layout.tsx` não pode repetir `min-h-dvh` dentro deste contêiner; a asserção de "tela curta não rola na vertical" do `acessibilidade.spec.ts` confere.) A cor do consultório no portal continua vindo do `(portal)/layout.tsx` (é ele que tem o tenant; o layout externo também serve `/p/escolher`, `/p/sem-acesso` e `/p/termo`, sem tenant). O `--nd-marca` é calculado no elemento que tem `[data-tema]` (var() em propriedade customizada resolve onde é declarada, não onde é usada): só pôr `--nd-marca-base` num filho não muda o `text-marca`/`border-marca`/foco do portal. Por isso o contêiner do `(portal)/layout.tsx` **repete** `data-tema="sistema"` junto com o estilo, e as regras `[data-tema]`/`[data-tema='sistema']` recalculam `--nd-marca` ali:

```tsx
import type { CSSProperties } from 'react';
// …
const cores = { '--nd-marca-base': marca.cor, '--nd-marca-clara': marca.corNoEscuro } as CSSProperties;
return (
  <div data-tema="sistema" style={cores} className="flex flex-1 flex-col">{/* sem min-h-dvh (T-4) */}
    {/* …o mesmo conteúdo de hoje… */}
  </div>
);
```

e o contêiner do `src/app/p/layout.tsx` acima vira `flex min-h-dvh flex-col` para o `flex-1` valer. Prova no `e2e/portal.spec.ts`: com o tenant do paciente numa cor diferente da padrão (`#1d6b5a`; gravar `tenants.cor_primaria`, ex. `#2E7D32`, pelo campo "Cor principal" da nutricionista como em `e2e/plataforma.spec.ts`, ou direto no seed), o `getComputedStyle` do item ativo da barra de abas (`text-marca`) tem essa cor, e com `colorScheme: 'dark'` a `corNoEscuro` dela — sem o `data-tema` no contêiner do `(portal)/layout.tsx`, os dois casos dariam o verde padrão.

- [ ] **Step 3: Trocas** — o mesmo `perl` da Tarefa 16, passo 2, com `FILES=$(grep -rlE '…' src/app/p --include=*.tsx)`; a barra de abas (`src/app/p/nav-portal.tsx:13`, `bg-white`) vira `bg-cartao border-t border-borda`; o item ativo, `text-marca` com sublinhado; o topo de `(portal)/layout.tsx` (`text-gray-700`) vira `text-suave`. Alvos de 44 px continuam (RNF-10).

Run: `pnpm test src/app/painel/cores.test.ts && pnpm build && pnpm test:e2e e2e/acessibilidade.spec.ts e2e/portal.spec.ts` → PASS (o axe do portal com o aparelho claro e escuro, a 360 px).

- [ ] **Step 4: Commit**

```bash
git add src/app/p src/app/painel/cores.test.ts e2e/acessibilidade.spec.ts e2e/portal.spec.ts
git commit -m "feat(visual): portal do paciente com os tokens, as fontes novas e o modo do aparelho (D18)"
```

---

### Task 19: Manual guiado — motor do tour, gaveta de ajuda, página do manual e o progresso (P08-10; D26, D27)

**Files:**
- Create: `src/modules/ajuda/conteudo.ts`, `src/modules/ajuda/conteudo.test.ts`, `src/app/painel/guia/guia-do-painel.tsx`, `src/app/painel/guia/tour.tsx`, `src/app/painel/guia/gaveta-ajuda.tsx`, `src/app/painel/ajuda/page.tsx`
- Modify: `src/app/painel/layout.tsx`, `src/app/painel/cabecalho.tsx`, `src/app/painel/alternar-tema.tsx` (`data-guia="tema"`)

**Interfaces:**
- Consumes: `lerGuia`, `marcarGuiaAction`, `type ProgressoGuia`, `ID_GUIA` (T13); `CabecalhoPainel` (T14).
- Produces:
  - `@/modules/ajuda/conteudo`: `type Passo = { alvo?: string; titulo: string; texto: string }`, `type Guia = { id: string; versao: number; padrao: RegExp; titulo: string; ajuda: { resumo: string; secoes: { titulo: string; itens: string[] }[] }; passos: Passo[] }`, `GUIAS: readonly Guia[]`, `guiaDaRota(caminho: string): Guia | null`, `ID_BOAS_VINDAS = 'boas-vindas'`, `precisaDoGuia(p: ProgressoGuia, g: Guia, estados: EstadoGuia[]): boolean`.
  - `GuiaDoPainel({ progresso }: { progresso: ProgressoGuia })` (cliente): o botão "Ajuda" do cabeçalho, a gaveta, o tour e o aviso "Primeira vez aqui?". O `progresso` do layout é só o valor **inicial**: o layout não é renderizado de novo na navegação pelo cliente e a ação não revalida, então o componente guarda o progresso em estado local, atualizado de forma otimista a cada marcação (`aplicarMarca`, com a mesma regra do `marcarGuia`: versão menor não sobrescreve a maior; "visto" não rebaixa concluído/dispensado na mesma versão).
  - `Tour({ guia, aberto, aoFechar, aoMarcar })`: quem grava é o `GuiaDoPainel` (`aoMarcar(estado)`), não o tour.
  - Página `/painel/ajuda` (servidor, funciona sem JavaScript).

- [ ] **Step 1: Teste do conteúdo e das âncoras (falha)** — `src/modules/ajuda/conteudo.test.ts`

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID_GUIA } from '@/modules/plataforma/preferencias-tipos';
import { GUIAS, guiaDaRota, ID_BOAS_VINDAS, precisaDoGuia } from './conteudo';

const TSX = ['src/app/painel', 'src/components']
  .flatMap((p) => readdirSync(path.resolve(p), { recursive: true, withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith('.tsx')).map((d) => path.join(d.parentPath, d.name)))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

/** Páginas sem guia, com o motivo. */
const SEM_AJUDA: Record<string, string> = {
  '/painel/dpa': 'aceite do contrato: a nutricionista ainda não usa o painel',
  '/painel/ajuda': 'é o próprio manual',
};
const UUID = '0b8f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b';
const PAGINAS = readdirSync(path.resolve('src/app/painel'), { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && d.name === 'page.tsx')
  .map((d) => `/painel/${path.relative(path.resolve('src/app/painel'), d.parentPath).split(path.sep).join('/')}`.replace(/\/$/, '').replace(/\[[^\]]+\]/g, UUID));

describe('conteúdo do manual (P08-10)', () => {
  it('ids únicos e no formato do progresso; versão ≥ 1; textos curtos e não vazios', () => {
    expect(new Set(GUIAS.map((g) => g.id)).size).toBe(GUIAS.length);
    for (const g of GUIAS) {
      expect(g.id, g.id).toMatch(ID_GUIA);
      expect(g.versao).toBeGreaterThanOrEqual(1);
      expect(g.passos.length, g.id).toBeGreaterThan(0);
      for (const p of g.passos) {
        expect(p.titulo.length, `${g.id}: ${p.titulo}`).toBeGreaterThan(0);
        expect(p.texto.length, `${g.id}: ${p.titulo}`).toBeLessThanOrEqual(300);
      }
    }
    expect(GUIAS[0].id).toBe(ID_BOAS_VINDAS);
  });
  it.each(GUIAS.flatMap((g) => g.passos.filter((p) => p.alvo).map((p) => [g.id, p.alvo!])))('%s: o alvo "%s" existe como data-guia numa tela', (_g, alvo) => {
    expect(TSX).toContain(`data-guia="${alvo}"`);
  });
  it.each(PAGINAS.map((p) => [p]))('%s tem guia ou está em SEM_AJUDA', (pagina) => {
    expect(guiaDaRota(pagina) !== null || pagina in SEM_AJUDA, pagina).toBe(true);
  });
  it('guiaDaRota: o plano alimentar tem guia próprio dentro do prontuário; o Início é o de boas-vindas', () => {
    expect(guiaDaRota('/painel')?.id).toBe(ID_BOAS_VINDAS);
    expect(guiaDaRota(`/painel/pacientes/${UUID}/plano-alimentar/${UUID}`)?.id).toBe('plano-alimentar');
    expect(guiaDaRota(`/painel/pacientes/${UUID}/exames`)?.id).toBe('prontuario');
    expect(guiaDaRota('/painel/agenda/horarios')?.id).toBe('horarios');
  });
  it('precisaDoGuia: versão nova volta a pedir; concluído/dispensado na versão atual, não', () => {
    const g = GUIAS[0];
    expect(precisaDoGuia({}, g, ['concluido', 'dispensado'])).toBe(true);
    expect(precisaDoGuia({ [g.id]: { v: g.versao, estado: 'dispensado' } }, g, ['concluido', 'dispensado'])).toBe(false);
    expect(precisaDoGuia({ [g.id]: { v: g.versao - 1, estado: 'concluido' } }, g, ['concluido', 'dispensado'])).toBe(true);
  });
});
```

Run: `pnpm test src/modules/ajuda` → FAIL.

- [ ] **Step 2: O conteúdo (estrutura + os dois primeiros guias)** — `src/modules/ajuda/conteudo.ts`. O arquivo completo, com todos os guias, está na Tarefa 20 (passo 1); aqui entra o mesmo arquivo só com `boas-vindas` e `agenda`, para testar o motor:

```ts
import type { EstadoGuia, ProgressoGuia } from '@/modules/plataforma/preferencias-tipos';

/** P08-10 (D26): o manual guiado. Texto RASCUNHO até o dono e a Debby aprovarem (P08-08); espelhado na spec (US-057). */
export type Passo = { alvo?: string; titulo: string; texto: string };
export type Guia = {
  id: string;
  /** Sobe quando o texto muda de verdade: o aviso "Primeira vez aqui?" volta a aparecer (D27). */
  versao: number;
  /** Caminhos em que o guia vale (o primeiro guia da lista que casar). */
  padrao: RegExp;
  titulo: string;
  ajuda: { resumo: string; secoes: { titulo: string; itens: string[] }[] };
  passos: Passo[];
};

export const ID_BOAS_VINDAS = 'boas-vindas';

export const GUIAS: readonly Guia[] = [
  {
    id: ID_BOAS_VINDAS,
    versao: 1,
    padrao: /^\/painel$/,
    titulo: 'Início',
    ajuda: {
      resumo: 'O Início mostra o seu dia: a próxima consulta, a agenda de hoje, os diários novos e como os pacientes estão usando o app.',
      secoes: [{ titulo: 'O que dá para fazer aqui', itens: ['Abrir o prontuário do próximo paciente.', 'Ver os diários que ainda não foram vistos.', 'Acompanhar os pedidos de dados e de exclusão dos pacientes.'] }],
    },
    passos: [
      { titulo: 'Boas-vindas ao NutriDebby', texto: 'Um passeio rápido pelo painel. Você pode pular agora e rever depois no menu da sua conta.' },
      { alvo: 'menu', titulo: 'Menu do painel', texto: 'Pacientes, Agenda, Diários, Conteúdos e Configurações ficam sempre aqui no topo.' },
    ],
  },
  {
    id: 'agenda',
    versao: 1,
    padrao: /^\/painel\/agenda(\/(nova|pendencias|consultas\/.+))?$/,
    titulo: 'Agenda',
    ajuda: { resumo: 'A agenda do dia e da semana, com as consultas marcadas por você e pelos pacientes.', secoes: [] },
    passos: [{ alvo: 'menu', titulo: 'Agenda', texto: 'Escolha o dia ou a semana e abra uma consulta para confirmar, remarcar ou registrar a presença.' }],
  },
];

export function guiaDaRota(caminho: string): Guia | null {
  return GUIAS.find((g) => g.padrao.test(caminho)) ?? null;
}

/** true = ainda não está em nenhum dos `estados` na versão atual. */
export function precisaDoGuia(p: ProgressoGuia, g: Guia, estados: EstadoGuia[]): boolean {
  const r = p[g.id];
  return !r || r.v < g.versao || !estados.includes(r.estado);
}
```

Run: `pnpm test src/modules/ajuda -t 'ids únicos|precisaDoGuia'` → PASS (os casos de páginas, alvos e `guiaDaRota` passam com o conteúdo completo da Tarefa 20).

- [ ] **Step 3: O tour** — `src/app/painel/guia/tour.tsx`

```tsx
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Guia } from '@/modules/ajuda/conteudo';

const CARTAO_LARGURA = 384;
const CARTAO_ALTURA = 240;

function posicao(c: DOMRect): CSSProperties | undefined {
  if (window.innerWidth < 640) return undefined; // folha no rodapé (classes max-sm)
  const left = Math.min(Math.max(12, c.left), window.innerWidth - 12 - CARTAO_LARGURA);
  const top = c.bottom + 16 + CARTAO_ALTURA < window.innerHeight ? c.bottom + 16 : Math.max(12, c.top - 16 - CARTAO_ALTURA);
  return { top, left };
}

/**
 * D26: <dialog> modal nativo (foco preso, Esc, fundo inerte). O "holofote" marca o alvo (data-guia); passo sem alvo,
 * ou com o alvo fora da tela (ex.: sem consulta hoje), aparece centralizado. A cada passo o foco vai ao título (o leitor
 * de tela anuncia). Esc = "Pular o tour" (grava "dispensado", D27). O alvo não é clicável durante o tour.
 */
export function Tour({ guia, aberto, aoFechar, aoMarcar }: { guia: Guia; aberto: boolean; aoFechar: () => void; aoMarcar: (estado: 'concluido' | 'dispensado') => void }) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const [i, setI] = useState(0);
  const [caixa, setCaixa] = useState<DOMRect | null>(null);
  const passo = guia.passos[Math.min(i, guia.passos.length - 1)];
  const ultimo = i >= guia.passos.length - 1;

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  const medir = useCallback(() => {
    const alvo = passo.alvo ? document.querySelector<HTMLElement>(`[data-guia="${passo.alvo}"]`) : null;
    setCaixa(alvo && alvo.getClientRects().length > 0 ? alvo.getBoundingClientRect() : null);
  }, [passo]);

  useLayoutEffect(() => {
    if (!aberto) return;
    const alvo = passo.alvo ? document.querySelector<HTMLElement>(`[data-guia="${passo.alvo}"]`) : null;
    const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    alvo?.scrollIntoView({ block: 'center', behavior: reduz ? 'auto' : 'smooth' });
    medir();
    titulo.current?.focus();
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [aberto, passo, medir]);

  const fechar = (estado: 'concluido' | 'dispensado') => {
    aoMarcar(estado); // o GuiaDoPainel atualiza o progresso local e grava na conta
    setI(0);
    aoFechar();
  };

  return (
    <dialog
      ref={dialogo}
      aria-labelledby="tour-titulo"
      aria-describedby="tour-texto"
      onCancel={(e) => {
        e.preventDefault();
        fechar('dispensado');
      }}
      className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none border-0 bg-transparent p-0 backdrop:bg-transparent"
    >
      {caixa ? (
        <div
          aria-hidden="true"
          data-holofote
          className="pointer-events-none fixed rounded-2xl"
          style={{ top: caixa.top - 6, left: caixa.left - 6, width: caixa.width + 12, height: caixa.height + 12, boxShadow: '0 0 0 100vmax rgb(0 0 0 / 0.55)', outline: '3px solid var(--nd-foco)' }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0" style={{ background: 'rgb(0 0 0 / 0.55)' }} />
      )}
      <div
        style={caixa ? posicao(caixa) : undefined}
        className={`fixed w-[min(24rem,calc(100vw-1.5rem))] rounded-3xl border border-borda bg-cartao p-5 text-texto shadow-xl max-sm:inset-x-3 max-sm:bottom-3 ${caixa ? '' : 'sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2'}`}
      >
        <p className="text-sm text-suave">{`${i + 1} de ${guia.passos.length}`}</p>
        <h2 id="tour-titulo" ref={titulo} tabIndex={-1} className="font-titulo text-xl font-semibold">{passo.titulo}</h2>
        <p id="tour-texto" className="mt-2">{passo.texto}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {i > 0 && (
            <button type="button" onClick={() => setI(i - 1)} className="inline-flex min-h-11 items-center rounded-full border border-campo px-4">Voltar</button>
          )}
          {ultimo ? (
            <button type="button" onClick={() => fechar('concluido')} className="inline-flex min-h-11 items-center rounded-full bg-destaque px-5 font-semibold text-white">Concluir</button>
          ) : (
            <button type="button" onClick={() => setI(i + 1)} className="inline-flex min-h-11 items-center rounded-full bg-destaque px-5 font-semibold text-white">Próximo</button>
          )}
          <button type="button" onClick={() => fechar('dispensado')} className="ml-auto inline-flex min-h-11 items-center px-2 text-link underline">Pular o tour</button>
        </div>
      </div>
    </dialog>
  );
}
```

- [ ] **Step 4: Gaveta de ajuda e o orquestrador** — `src/app/painel/guia/gaveta-ajuda.tsx`

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { Guia } from '@/modules/ajuda/conteudo';

/** D26: o texto da tela atual, numa gaveta modal à direita (<dialog>). */
export function GavetaAjuda({ guia, aberta, aoFechar, verTour }: { guia: Guia | null; aberta: boolean; aoFechar: () => void; verTour: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberta && !d.open) d.showModal();
    if (!aberta && d.open) d.close();
  }, [aberta]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="ajuda-titulo"
      onClose={aoFechar}
      className="fixed inset-y-0 right-0 left-auto m-0 h-full max-h-none w-[min(28rem,100vw)] border-l border-borda bg-cartao p-6 text-texto"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="ajuda-titulo" className="font-titulo text-xl font-semibold">{guia ? `Ajuda: ${guia.titulo}` : 'Ajuda'}</h2>
        <button type="button" onClick={aoFechar} className="inline-flex min-h-11 items-center px-2 text-link underline">Fechar</button>
      </div>
      {guia && (
        <div className="mt-4 space-y-4">
          <p>{guia.ajuda.resumo}</p>
          {guia.ajuda.secoes.map((s) => (
            <section key={s.titulo} className="space-y-1">
              <h3 className="font-semibold">{s.titulo}</h3>
              <ul className="list-disc space-y-1 pl-5">{s.itens.map((it) => <li key={it}>{it}</li>)}</ul>
            </section>
          ))}
          <button type="button" onClick={verTour} className="inline-flex min-h-11 items-center rounded-full bg-destaque px-5 font-semibold text-white">Ver o tour desta tela</button>
        </div>
      )}
      <p className="mt-6"><Link href={guia ? `/painel/ajuda#${guia.id}` : '/painel/ajuda'} className="text-link underline">Abrir o manual completo</Link></p>
    </dialog>
  );
}
```

`src/app/painel/guia/guia-do-painel.tsx`

```tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { guiaDaRota, GUIAS, ID_BOAS_VINDAS, precisaDoGuia, type Guia } from '@/modules/ajuda/conteudo';
import type { EstadoGuia, ProgressoGuia } from '@/modules/plataforma/preferencias-tipos';
import { marcarGuiaAction } from '../preferencias/actions';
import { GavetaAjuda } from './gaveta-ajuda';
import { Tour } from './tour';

/** A mesma regra do marcarGuia (T13), no estado local: versão menor não sobrescreve a maior; "visto" não rebaixa concluído/dispensado na mesma versão. */
export function aplicarMarca(p: ProgressoGuia, id: string, versao: number, estado: EstadoGuia): ProgressoGuia {
  const atual = p[id];
  if (atual && atual.v > versao) return p;
  if (estado === 'visto' && atual?.v === versao && (atual.estado === 'concluido' || atual.estado === 'dispensado')) return p;
  return { ...p, [id]: { v: versao, estado } };
}

/**
 * D26/D27: o botão "Ajuda" do cabeçalho, a gaveta, o tour e o aviso "Primeira vez aqui?". Só o tour de boas-vindas abre
 * sozinho (uma vez, no Início, com o DPA já aceito — o layout só monta isto com o DPA em dia). `?tour=boas-vindas` reabre.
 * O `progresso` do layout é só o valor inicial: o layout NÃO é renderizado de novo na navegação pelo cliente, então o
 * progresso vive em estado local, atualizado de forma otimista a cada marcação — concluir o tour, ir a Pacientes e voltar
 * ao Início pelo menu não o reabre.
 */
export function GuiaDoPainel({ progresso: inicial }: { progresso: ProgressoGuia }) {
  const caminho = usePathname();
  const busca = useSearchParams();
  const router = useRouter();
  const guia = guiaDaRota(caminho);
  const boasVindas = GUIAS[0];
  const [progresso, setProgresso] = useState<ProgressoGuia>(inicial);
  const [tour, setTour] = useState<Guia | null>(null);
  const [gaveta, setGaveta] = useState(false);
  // um id por aviso dispensado: dispensar numa tela não esconde o aviso das outras
  const [avisosFechados, setAvisosFechados] = useState<ReadonlySet<string>>(() => new Set());

  // um render novo do layout (recarregar, ação que revalida) traz o valor do servidor; o local, mais novo, prevalece
  useEffect(() => setProgresso((local) => ({ ...inicial, ...local })), [inicial]);

  const marcar = useCallback((g: Guia, estado: EstadoGuia) => {
    setProgresso((p) => aplicarMarca(p, g.id, g.versao, estado));
    void marcarGuiaAction(g.id, g.versao, estado);
  }, []);
  const fecharAviso = (id: string) => setAvisosFechados((f) => new Set(f).add(id));

  // dois efeitos separados: o ?tour= só age quando a busca muda (fechar o tour marca o progresso antes de o
  // router.replace tirar o parâmetro — um efeito único reabriria o tour nesse meio-tempo)
  useEffect(() => {
    if (caminho === '/painel' && busca.get('tour') === ID_BOAS_VINDAS) setTour(boasVindas);
  }, [caminho, busca, boasVindas]);
  useEffect(() => {
    if (caminho === '/painel' && precisaDoGuia(progresso, boasVindas, ['concluido', 'dispensado'])) setTour(boasVindas);
  }, [caminho, progresso, boasVindas]);

  const mostrarAviso = !!guia && guia.id !== ID_BOAS_VINDAS && !avisosFechados.has(guia.id) && precisaDoGuia(progresso, guia, ['concluido', 'dispensado', 'visto']);
  useEffect(() => {
    // D27: o aviso aparece uma vez. Marca no servidor sem tirar o aviso desta visita (ele some ao dispensar ou ao navegar)
    if (mostrarAviso && guia) void marcarGuiaAction(guia.id, guia.versao, 'visto');
  }, [mostrarAviso, guia]);
  // ao sair da tela, o "visto" entra no estado local: voltar a ela pelo menu não mostra o aviso de novo
  useEffect(() => () => { if (guia && guia.id !== ID_BOAS_VINDAS) setProgresso((p) => aplicarMarca(p, guia.id, guia.versao, 'visto')); }, [guia]);

  return (
    <>
      <button type="button" data-guia="ajuda" aria-label="Ajuda desta tela" title="Ajuda" onClick={() => setGaveta(true)} className="grid size-11 place-items-center rounded-full border border-borda bg-cartao font-titulo text-lg font-bold text-texto hover:bg-linha">
        ?
      </button>
      <GavetaAjuda guia={guia} aberta={gaveta} aoFechar={() => setGaveta(false)} verTour={() => { setGaveta(false); setTour(guia); }} />
      {tour && (
        <Tour
          guia={tour}
          aberto
          aoMarcar={(estado) => marcar(tour, estado)}
          aoFechar={() => {
            setTour(null);
            if (busca.get('tour')) router.replace(caminho);
          }}
        />
      )}
      {mostrarAviso && guia && !tour && (
        <aside aria-label="Dica" className="fixed right-4 bottom-4 z-20 flex max-w-sm flex-wrap items-center gap-2 rounded-2xl border border-borda bg-cartao p-3 text-texto shadow-lg">
          <span>Primeira vez aqui?</span>
          <button type="button" onClick={() => { fecharAviso(guia.id); setTour(guia); }} className="inline-flex min-h-11 items-center rounded-full bg-destaque px-4 font-semibold text-white">Ver como funciona</button>
          <button type="button" onClick={() => fecharAviso(guia.id)} className="inline-flex min-h-11 items-center px-2 text-link underline">Dispensar</button>
        </aside>
      )}
    </>
  );
}
```

Teste da regra local — acrescentar a `src/modules/ajuda/conteudo.test.ts` (ou a um `guia-do-painel.test.ts` ao lado, importando só `aplicarMarca`):

```ts
import { aplicarMarca } from '@/app/painel/guia/guia-do-painel';

describe('aplicarMarca (progresso local do GuiaDoPainel)', () => {
  it('concluir grava; "visto" depois não rebaixa; versão nova volta a valer', () => {
    const a = aplicarMarca({}, 'pacientes', 1, 'concluido');
    expect(a).toEqual({ pacientes: { v: 1, estado: 'concluido' } });
    expect(aplicarMarca(a, 'pacientes', 1, 'visto')).toBe(a);
    const b = aplicarMarca(a, 'pacientes', 2, 'visto');
    expect(b).toEqual({ pacientes: { v: 2, estado: 'visto' } });
    expect(aplicarMarca(b, 'pacientes', 1, 'concluido')).toBe(b); // versão menor não sobrescreve
  });
});
```

`src/app/painel/cabecalho.tsx`: a prop nova `progresso: ProgressoGuia | null` e, no grupo da direita, antes do `AlternarTema`: `{completo && progresso && <Suspense fallback={null}><GuiaDoPainel progresso={progresso} /></Suspense>}` (o `useSearchParams` pede o `Suspense`). `src/app/painel/layout.tsx`: `const completo = tenant.dpaVersao === DPA_VERSAO; const progresso = completo ? await lerGuia(data.user.id) : null;` e repassar ao `CabecalhoPainel`. `src/app/painel/alternar-tema.tsx`: `data-guia="tema"` no `<form>`.

- [ ] **Step 5: A página do manual** — `src/app/painel/ajuda/page.tsx`

```tsx
import { requireNutri } from '@/lib/tenant-session';
import { GUIAS } from '@/modules/ajuda/conteudo';

export const dynamic = 'force-dynamic';

/** D26: o manual completo — funciona sem JavaScript, dá para imprimir e é a base do treinamento (P08-08). */
export default async function AjudaPage() {
  await requireNutri('/painel/ajuda');
  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 p-4 md:p-6 print:max-w-none">
      <h1 className="font-titulo text-3xl font-extrabold">Manual do NutriDebby</h1>
      <nav aria-labelledby="indice" className="rounded-3xl border border-borda bg-cartao p-5 print:hidden">
        <h2 id="indice" className="font-semibold">Nesta página</h2>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {GUIAS.map((g) => <li key={g.id}><a href={`#${g.id}`} className="text-link underline">{g.titulo}</a></li>)}
        </ul>
      </nav>
      {GUIAS.map((g) => (
        <section key={g.id} id={g.id} aria-labelledby={`${g.id}-titulo`} className="scroll-mt-24 space-y-3 rounded-3xl border border-borda bg-cartao p-5 print:break-inside-avoid">
          <h2 id={`${g.id}-titulo`} className="font-titulo text-2xl font-semibold">{g.titulo}</h2>
          <p>{g.ajuda.resumo}</p>
          <ol className="list-decimal space-y-1 pl-5">{g.passos.map((p) => <li key={p.titulo}><strong>{p.titulo}.</strong> {p.texto}</li>)}</ol>
          {g.ajuda.secoes.map((s) => (
            <div key={s.titulo}>
              <h3 className="font-semibold">{s.titulo}</h3>
              <ul className="list-disc space-y-1 pl-5">{s.itens.map((it) => <li key={it}>{it}</li>)}</ul>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
```

Devolver `'/painel/ajuda'` a `ROTAS_DO_PAINEL` (`e2e/painel-rotas.ts`, T17; a guarda `rotas-axe.test.ts` exige, porque a página passa a existir). Run: `pnpm test src/app/painel && pnpm test src/modules/ajuda -t 'ids únicos|precisaDoGuia' && pnpm typecheck && pnpm lint && pnpm build` → PASS. Os casos de cobertura de páginas e de alvos do `conteudo.test.ts` só passam com o conteúdo completo da Tarefa 20: as duas tarefas vão no mesmo PR.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ajuda src/app/painel/guia src/app/painel/ajuda src/app/painel/layout.tsx src/app/painel/cabecalho.tsx src/app/painel/alternar-tema.tsx e2e/painel-rotas.ts
git commit -m "feat(manual): tour com <dialog> nativo, gaveta de ajuda por tela, página do manual e progresso na conta (P08-10, D26, D27)"
```

---
### Task 20: Manual guiado — o texto de todas as telas, as âncoras, o seed e o E2E (P08-10; D26, D27)

**Files:**
- Modify: `src/modules/ajuda/conteudo.ts` (arquivo completo), as telas com `data-guia` (tabela do passo 2), `scripts/e2e-seed.ts`, `e2e/helpers.ts`, `e2e/plataforma.spec.ts`
- Create: `e2e/manual.spec.ts`

**Interfaces:**
- Consumes: `GUIAS`, `guiaDaRota`, `precisaDoGuia` (T19); `GuiaDoPainel`, `Tour` (`data-holofote`), `GavetaAjuda` (T19); `user.guia` (T13).
- Produces: os 12 guias (rascunho de texto para o dono e a Debby aprovarem no P08-08); `E2E_MANUAL = { email: 'manual-e2e@nutridebby.test', password: 'Nutri2026segura' }` no seed (progresso zerado a cada execução); `pularTourSeAparecer(page: Page): Promise<void>` em `e2e/helpers.ts`; bloco de IP do `manual.spec.ts`: **10.9.14.x** (.1 e .2).

- [ ] **Step 1: O conteúdo completo** — `src/modules/ajuda/conteudo.ts` (arquivo inteiro)

```ts
import type { EstadoGuia, ProgressoGuia } from '@/modules/plataforma/preferencias-tipos';

/** P08-10 (D26): o manual guiado. Texto RASCUNHO até o dono e a Debby aprovarem (P08-08); espelhado na spec (US-057). Nenhum dado de saúde nos exemplos. */
export type Passo = { alvo?: string; titulo: string; texto: string };
export type Guia = {
  id: string;
  /** Sobe quando o texto muda de verdade: o aviso "Primeira vez aqui?" volta a aparecer (D27). */
  versao: number;
  /** Caminhos em que o guia vale (o primeiro guia da lista que casar). */
  padrao: RegExp;
  titulo: string;
  ajuda: { resumo: string; secoes: { titulo: string; itens: string[] }[] };
  passos: Passo[];
};

export const ID_BOAS_VINDAS = 'boas-vindas';
const ID = '[0-9a-f-]{36}';

export const GUIAS: readonly Guia[] = [
  {
    id: ID_BOAS_VINDAS,
    versao: 1,
    padrao: /^\/painel$/,
    titulo: 'Início',
    ajuda: {
      resumo: 'O Início mostra o seu dia: a próxima consulta, a agenda de hoje, os diários novos e como os pacientes estão usando o app.',
      secoes: [
        { titulo: 'O que dá para fazer aqui', itens: ['Abrir o prontuário do próximo paciente.', 'Ver os diários que ainda não foram vistos.', 'Acompanhar os pedidos de cópia e de exclusão de dados dos pacientes (prazo de 15 dias).'] },
        { titulo: 'Perguntas comuns', itens: ['A taxa de faltas conta só as consultas que já começaram e não foram canceladas.', 'Os avisos do topo (espaço, WhatsApp) somem sozinhos quando o problema é resolvido.'] },
      ],
    },
    passos: [
      { titulo: 'Boas-vindas ao NutriDebby', texto: 'Um passeio rápido pelo painel. Você pode pular agora e rever depois no menu da sua conta.' },
      { alvo: 'menu', titulo: 'Menu do painel', texto: 'Pacientes, Agenda, Diários, Conteúdos e Configurações ficam sempre aqui no topo.' },
      { alvo: 'proxima-consulta', titulo: 'Próxima consulta', texto: 'A consulta mais próxima de hoje, com atalhos para o prontuário e para a chamada online.' },
      { alvo: 'atalhos', titulo: 'Atalhos', texto: 'Cadastre um paciente, marque uma consulta ou publique um conteúdo sem sair do Início.' },
      { alvo: 'tema', titulo: 'Claro ou escuro', texto: 'Este botão liga e desliga o modo escuro. A escolha fica salva na sua conta, em qualquer aparelho.' },
      { alvo: 'ajuda', titulo: 'Ajuda em cada tela', texto: 'Em qualquer tela, este botão explica o que dá para fazer ali e abre o manual completo.' },
      { alvo: 'conta', titulo: 'Sua conta', texto: 'Perfil e marca, segurança, o manual, este tour e o Sair ficam aqui.' },
    ],
  },
  {
    id: 'pacientes',
    versao: 1,
    padrao: /^\/painel\/pacientes(\/novo)?$/,
    titulo: 'Pacientes',
    ajuda: {
      resumo: 'A lista dos seus pacientes. Tudo começa aqui: cadastrar, convidar para o app e abrir o prontuário.',
      secoes: [{ titulo: 'Passo a passo', itens: ['Clique em "Novo paciente" e preencha nome, data de nascimento, sexo e e-mail.', 'No prontuário, use "Convidar para o app": o paciente recebe o convite por e-mail (e por WhatsApp, se autorizado).', 'Use a busca para achar pelo nome; arquivados aparecem no filtro de situação.'] }],
    },
    passos: [
      { alvo: 'novo-paciente', titulo: 'Novo paciente', texto: 'Comece cadastrando o paciente. Depois, convide-o para o app pelo prontuário.' },
      { alvo: 'busca-pacientes', titulo: 'Busca', texto: 'Ache um paciente pelo nome ou filtre pela situação (ativo, arquivado).' },
    ],
  },
  {
    id: 'plano-alimentar',
    versao: 1,
    padrao: new RegExp(`^/painel/pacientes/${ID}/plano-alimentar(/.*)?$`),
    titulo: 'Plano alimentar',
    ajuda: {
      resumo: 'Monte o plano por refeições, com os alimentos da TACO ou os seus. O salvamento é automático; o paciente só vê depois de "Publicar".',
      secoes: [
        { titulo: 'Passo a passo', itens: ['Crie as refeições e adicione os alimentos com a quantidade em gramas ou medida caseira.', 'Confira os totais e a meta ao lado.', 'Clique em "Publicar": a versão anterior é arquivada e o paciente recebe o aviso no app.'] },
        { titulo: 'Perguntas comuns', itens: ['Para mudar um plano publicado, use "Editar": uma versão nova é criada, e a publicada continua valendo até você publicar a nova.', 'O PDF do plano fica pronto em alguns segundos depois de publicar.'] },
      ],
    },
    passos: [
      { alvo: 'editor-plano', titulo: 'Refeições e alimentos', texto: 'Cada refeição é um bloco. A busca de alimentos aceita parte do nome; a quantidade pode ser em gramas ou medida caseira.' },
      { alvo: 'publicar-plano', titulo: 'Publicar', texto: 'O paciente só vê o plano depois de publicado. Tudo o que você digita já fica salvo no rascunho.' },
    ],
  },
  {
    id: 'prontuario',
    versao: 1,
    padrao: new RegExp(`^/painel/pacientes/${ID}(/.*)?$`),
    titulo: 'Prontuário',
    ajuda: {
      resumo: 'Tudo do paciente em abas: anamnese, antropometria, gasto energético, atendimentos, exames, evolução, plano alimentar e privacidade.',
      secoes: [
        { titulo: 'Passo a passo', itens: ['Comece pela anamnese (use um modelo para ganhar tempo).', 'Registre as medidas em Antropometria; a Evolução mostra os gráficos.', 'Em Privacidade ficam a cópia dos dados e o pedido de exclusão do paciente.'] },
        { titulo: 'Perguntas comuns', itens: ['Cada acesso ao prontuário fica registrado no "Histórico de acessos" (LGPD).', 'Paciente arquivado sai da agenda e dos conteúdos, mas o prontuário continua guardado.'] },
      ],
    },
    passos: [
      { alvo: 'cabecalho-paciente', titulo: 'O paciente', texto: 'Nome, idade e situação. O selo mostra se o paciente está arquivado ou bloqueado.' },
      { alvo: 'abas-prontuario', titulo: 'Abas do prontuário', texto: 'Cada parte do acompanhamento fica numa aba. Em tela estreita, a faixa de abas rola para o lado.' },
    ],
  },
  {
    id: 'agenda',
    versao: 1,
    padrao: /^\/painel\/agenda(\/(nova|pendencias|consultas\/.+))?$/,
    titulo: 'Agenda',
    ajuda: {
      resumo: 'As consultas do dia e da semana, marcadas por você, pelo paciente no app ou pela sua página pública.',
      secoes: [
        { titulo: 'Passo a passo', itens: ['Use "Nova consulta" para marcar; o paciente recebe a confirmação e os lembretes.', 'Abra a consulta para remarcar, cancelar, registrar a presença ou iniciar o atendimento.', 'Consultas sem registro de presença aparecem em "Pendências".'] },
        { titulo: 'Perguntas comuns', itens: ['Os lembretes saem 24 h e 2 h antes, por e-mail, notificação no app e WhatsApp (se conectado e autorizado).'] },
      ],
    },
    passos: [
      { alvo: 'periodo-agenda', titulo: 'Dia ou semana', texto: 'Troque a visão e navegue entre os dias. "Hoje" volta para o dia atual.' },
      { alvo: 'nova-consulta', titulo: 'Nova consulta', texto: 'Marque uma consulta presencial ou online; o horário respeita os seus horários de atendimento.' },
    ],
  },
  {
    id: 'horarios',
    versao: 1,
    padrao: /^\/painel\/agenda\/horarios$/,
    titulo: 'Horários de atendimento',
    ajuda: { resumo: 'Os dias e horários em que os pacientes podem marcar consulta, e os bloqueios (férias, feriados).', secoes: [{ titulo: 'Passo a passo', itens: ['Crie uma regra por dia da semana, com início, fim, duração e modalidade.', 'Use os bloqueios para tirar um período da agenda sem apagar as regras.'] }] },
    passos: [
      { alvo: 'regras-horario', titulo: 'Regras', texto: 'Cada regra diz o dia, o horário e a duração das consultas.' },
      { alvo: 'bloqueios-horario', titulo: 'Bloqueios', texto: 'Férias e feriados: o período bloqueado some da agenda dos pacientes.' },
    ],
  },
  {
    id: 'diarios',
    versao: 1,
    padrao: /^\/painel\/diarios(\/.*)?$/,
    titulo: 'Diários',
    ajuda: { resumo: 'O que os pacientes registram no app (refeição, texto e foto). Os não vistos aparecem primeiro.', secoes: [{ titulo: 'Passo a passo', itens: ['Abra um registro para ver a foto e comentar; o paciente recebe o aviso do comentário no app.'] }] },
    passos: [{ alvo: 'feed-diarios', titulo: 'Registros dos pacientes', texto: 'Os registros novos ficam no topo. Abrir um registro marca como visto.' }],
  },
  {
    id: 'conteudos',
    versao: 1,
    padrao: /^\/painel\/conteudos(\/.*)?$/,
    titulo: 'Conteúdos',
    ajuda: {
      resumo: 'Vídeos, receitas e orientações para os pacientes, com quem vê cada um e quantos já abriram.',
      secoes: [{ titulo: 'Passo a passo', itens: ['Escolha o tipo, preencha e salve como rascunho.', 'Em "Quem vê", escolha todos os pacientes, uma etiqueta ou pacientes específicos.', 'Clique em "Publicar"; marque "Avisar pacientes" para mandar a notificação.'] }],
    },
    passos: [{ alvo: 'novo-conteudo', titulo: 'Novo conteúdo', texto: 'Vídeo (link do YouTube ou Vimeo), receita com o valor por porção ou orientação em texto e PDF.' }],
  },
  {
    id: 'alimentos',
    versao: 1,
    padrao: /^\/painel\/alimentos(\/.*)?$/,
    titulo: 'Alimentos',
    ajuda: { resumo: 'A tabela TACO e os alimentos que você cadastrar ("Meu alimento"), com as medidas caseiras.', secoes: [{ titulo: 'Perguntas comuns', itens: ['Alimento usado em algum plano ou receita não pode ser excluído.'] }] },
    passos: [{ alvo: 'busca-alimentos', titulo: 'Busca', texto: 'Procure pelo nome; os seus alimentos aparecem junto com os da TACO.' }],
  },
  {
    id: 'modelos',
    versao: 1,
    padrao: /^\/painel\/(planos\/modelos|anamnese\/modelos)(\/.*)?$/,
    titulo: 'Modelos',
    ajuda: { resumo: 'Modelos de plano alimentar e de anamnese para começar mais rápido. Usar um modelo copia o conteúdo; mudar o modelo depois não muda o que já foi criado.', secoes: [] },
    passos: [{ titulo: 'Modelos', texto: 'Crie um modelo aqui ou salve um plano pronto como modelo pelo editor do plano.' }],
  },
  {
    id: 'configuracoes',
    versao: 1,
    padrao: /^\/painel\/configuracoes(\/.*)?$/,
    titulo: 'Configurações',
    ajuda: { resumo: 'Perfil e marca, horários, WhatsApp, alimentos, modelos, segurança e o tema do painel.', secoes: [{ titulo: 'Perguntas comuns', itens: ['A cor da marca aparece no painel, no app do paciente e no PDF do plano.', 'O tema (claro, escuro ou igual ao aparelho) fica salvo na sua conta.'] }] },
    passos: [
      { alvo: 'cartoes-configuracoes', titulo: 'Tudo num lugar', texto: 'Cada cartão abre uma parte das configurações do consultório.' },
      { alvo: 'tema-form', titulo: 'Tema', texto: 'Claro, escuro ou igual ao aparelho.' },
    ],
  },
  {
    id: 'whatsapp',
    versao: 1,
    padrao: /^\/painel\/whatsapp$/,
    titulo: 'WhatsApp',
    ajuda: {
      resumo: 'Conecte o número do consultório para os lembretes e confirmações saírem pelo WhatsApp.',
      secoes: [{ titulo: 'Perguntas comuns', itens: ['Sem WhatsApp, os lembretes continuam por e-mail e notificação no app.', 'Só recebem mensagem os pacientes que autorizaram.', 'Se o celular desconectar, o Início avisa e mostra como conectar de novo.'] }],
    },
    passos: [{ alvo: 'conectar-whatsapp', titulo: 'Conectar', texto: 'Leia o código QR com o WhatsApp do celular do consultório (Aparelhos conectados).' }],
  },
];

export function guiaDaRota(caminho: string): Guia | null {
  return GUIAS.find((g) => g.padrao.test(caminho)) ?? null;
}

/** true = ainda não está em nenhum dos `estados` na versão atual. */
export function precisaDoGuia(p: ProgressoGuia, g: Guia, estados: EstadoGuia[]): boolean {
  const r = p[g.id];
  return !r || r.v < g.versao || !estados.includes(r.estado);
}
```

- [ ] **Step 2: As âncoras** — acrescentar o atributo (inerte; não muda o axe) a cada elemento:

| `data-guia` | Arquivo e elemento |
|---|---|
| `menu`, `conta`, `tema`, `ajuda`, `proxima-consulta`, `atalhos`, `cartoes-configuracoes` | já postos nas Tarefas 14, 15 e 19 (`<nav>` do `MenuPainel`, `<details>` do `MenuConta`, `<form>` do `AlternarTema`, botão do `GuiaDoPainel`, cartão e `<ul>` do Início, `<ul>` de `configuracoes/page.tsx` — este último: acrescentar agora) |
| `tema-form` | `src/app/painel/configuracoes/page.tsx`: a `<section aria-labelledby="tema">` |
| `novo-paciente` | `src/app/painel/pacientes/page.tsx`: o `<Link href="/painel/pacientes/novo">` |
| `busca-pacientes` | `src/app/painel/pacientes/page.tsx`: o `<form role="search">` |
| `cabecalho-paciente` | `src/app/painel/pacientes/[id]/layout.tsx`: o cartão do cabeçalho do paciente (Tarefa 16) |
| `abas-prontuario` | `src/app/painel/pacientes/[id]/abas.tsx`: o `<nav>` |
| `editor-plano` | `src/app/painel/planos/editor/editor-plano.tsx`: o `<div className="space-y-6">` raiz do `return` principal |
| `publicar-plano` | `src/app/painel/pacientes/[id]/plano-alimentar/[planId]/page.tsx`: envolver o `<BotaoAcao … rotulo="Publicar" …/>` num `<span data-guia="publicar-plano">` |
| `periodo-agenda` | `src/app/painel/agenda/page.tsx`: o `<nav aria-label="Período da agenda">` |
| `nova-consulta` | `src/app/painel/agenda/page.tsx`: o `<Link href={…/painel/agenda/nova…}>` "Nova consulta" |
| `regras-horario`, `bloqueios-horario` | `src/app/painel/agenda/horarios/page.tsx`: as `<section aria-labelledby="regras">` e `<section aria-labelledby="bloqueios">` |
| `feed-diarios` | `src/app/painel/diarios/page.tsx`: o `<ul>` da lista de registros |
| `novo-conteudo` | `src/app/painel/conteudos/page.tsx` (Plano 07): o elemento que agrupa os links "Novo vídeo", "Nova receita" e "Nova orientação" |
| `busca-alimentos` | `src/app/painel/alimentos/busca-alimento.tsx`: o elemento raiz do componente |
| `conectar-whatsapp` | `src/app/painel/whatsapp/conectar.tsx`: o elemento raiz do componente |

Run: `pnpm test src/modules/ajuda` → PASS (todos os casos: ids, alvos, cobertura de todas as páginas, `guiaDaRota`).

- [ ] **Step 3: Seed e helper** — `scripts/e2e-seed.ts`, depois da criação da nutricionista do E2E:

```ts
// P08-10 (D27): as contas do E2E não esbarram no tour nem no aviso "Primeira vez aqui?"; a conta do manual.spec começa zerada
const TUDO_VISTO = Object.fromEntries(GUIAS.map((g) => [g.id, { v: g.versao, estado: 'concluido' as const }]));
await db.update(user).set({ guia: TUDO_VISTO, tema: 'sistema' }).where(inArray(user.email, [E2E_NUTRI.email, E2E_RECUPERA.email]));
await db.delete(user).where(eq(user.email, E2E_MANUAL.email));
const manualId = randomUUID();
await db.insert(user).values({ id: manualId, name: 'Manual E2E', email: E2E_MANUAL.email, emailVerified: true, appRole: 'nutri', tenantId: consultorio.id });
await db.insert(account).values({ id: randomUUID(), userId: manualId, accountId: manualId, providerId: 'credential', password: await hashPassword(E2E_MANUAL.password) });
```

com `export const E2E_MANUAL = { email: 'manual-e2e@nutridebby.test', password: 'Nutri2026segura' };` no topo e os imports `inArray` (`drizzle-orm`) e `GUIAS` (`@/modules/ajuda/conteudo`). `e2e/helpers.ts`:

```ts
/** P08-10: contas criadas pelo fluxo do admin (plataforma.spec) veem o tour de boas-vindas uma vez — fecha se aparecer. */
export async function pularTourSeAparecer(page: Page): Promise<void> {
  const tour = page.getByRole('dialog', { name: 'Boas-vindas ao NutriDebby' });
  if (await tour.isVisible({ timeout: 3000 }).catch(() => false)) await page.keyboard.press('Escape');
  await expect(tour).toBeHidden();
}
```

`e2e/plataforma.spec.ts`: chamar `await pularTourSeAparecer(page);` logo depois do aceite do DPA, antes de conferir o título do Início (o diálogo modal deixa o resto da tela inerte para o `getByRole`).

- [ ] **Step 4: O E2E** — `e2e/manual.spec.ts`

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';
import { escolherTema, irPeloMenu } from './painel';

// P08-10 (D26, D27). Conta própria, com o progresso zerado pelo seed a cada execução. Bloco de IP: 10.9.14.x.
const MANUAL = { email: 'manual-e2e@nutridebby.test', senha: 'Nutri2026segura' };
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
test.describe.configure({ mode: 'serial' });
let page: Page;
const tour = () => page.getByRole('dialog', { name: /Boas-vindas ao NutriDebby|Menu do painel|Próxima consulta|Atalhos|Claro ou escuro|Ajuda em cada tela|Sua conta/ });
const semViolacoes = async () => expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);

test.beforeAll(async ({ browser }) => {
  page = await entrarComo(browser, MANUAL.email, MANUAL.senha, '10.9.14.1');
});
test.afterAll(async () => {
  await page?.context().close();
});

test('primeiro acesso: o tour abre sozinho no Início; Esc pula e grava (não volta ao recarregar)', async () => {
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('dialog', { name: 'Boas-vindas ao NutriDebby' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour()).toBeHidden();
  await page.reload();
  await expect(tour()).toBeHidden();
});

test('rever pelo menu da conta: foco preso no diálogo, Próximo até Concluir; outro aparelho não vê de novo', async ({ browser }) => {
  await page.getByLabel(/^Conta de /).click();
  await page.getByRole('link', { name: 'Rever o tour de boas-vindas' }).click();
  await expect(page.getByRole('dialog', { name: 'Boas-vindas ao NutriDebby' })).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    // o fundo fica inerte: o foco está no diálogo (ou saiu para a interface do navegador), nunca na página por trás
    expect(await page.evaluate(() => { const a = document.activeElement; return !a || a === document.body || !!a.closest('dialog'); })).toBe(true);
  }
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Próximo' }).click();
  await expect(page.getByText('7 de 7')).toBeVisible();
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(tour()).toBeHidden();
  await expect(page).toHaveURL(/\/painel$/); // o ?tour= sai da URL
  const outro = await entrarComo(browser, MANUAL.email, MANUAL.senha, '10.9.14.2');
  await expect(outro).toHaveURL(/\/painel$/);
  await expect(outro.getByRole('dialog', { name: 'Boas-vindas ao NutriDebby' })).toBeHidden();
  await outro.context().close();
});

// O progresso vem do layout, que NÃO é renderizado de novo na navegação pelo cliente: este caso não pode recarregar
test('navegação pelo cliente: depois de concluir, ir a Pacientes e voltar ao Início pelo menu não reabre o tour', async () => {
  await page.goto('/painel?tour=boas-vindas');
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Próximo' }).click();
  await page.getByRole('button', { name: 'Concluir' }).click();
  await expect(tour()).toBeHidden();
  await irPeloMenu(page, 'Pacientes');
  await expect(page).toHaveURL(/\/painel\/pacientes$/);
  await irPeloMenu(page, 'Início');
  await expect(page).toHaveURL(/\/painel$/);
  await page.waitForLoadState('networkidle');
  await expect(tour()).toBeHidden();
});

test('axe com o tour aberto, em cada passo, nos modos claro e escuro', async () => {
  for (const tema of ['Claro', 'Escuro'] as const) {
    await escolherTema(page, tema);
    await page.goto('/painel?tour=boas-vindas');
    for (let i = 0; i < 7; i++) {
      await expect(page.getByText(`${i + 1} de 7`)).toBeVisible();
      await semViolacoes();
      if (i < 6) await page.getByRole('button', { name: 'Próximo' }).click();
    }
    await page.getByRole('button', { name: 'Pular o tour' }).click();
  }
  await escolherTema(page, 'Igual ao aparelho');
});

test('Ajuda na Agenda: a gaveta mostra o texto da tela; o tour da tela marca o alvo certo', async () => {
  await page.goto('/painel/agenda');
  await page.getByRole('complementary', { name: 'Dica' }).getByRole('button', { name: 'Dispensar' }).click(); // D27: aviso da primeira visita
  await page.getByRole('button', { name: 'Ajuda desta tela' }).click();
  const gaveta = page.getByRole('dialog', { name: 'Ajuda: Agenda' });
  await expect(gaveta).toBeVisible();
  await semViolacoes();
  await gaveta.getByRole('button', { name: 'Ver o tour desta tela' }).click();
  await expect(page.getByRole('dialog', { name: 'Dia ou semana' })).toBeVisible();
  const alvo = (await page.locator('[data-guia="periodo-agenda"]').boundingBox())!;
  const luz = (await page.locator('[data-holofote]').boundingBox())!;
  expect(Math.abs(luz.x - (alvo.x - 6))).toBeLessThanOrEqual(2);
  expect(Math.abs(luz.width - (alvo.width + 12))).toBeLessThanOrEqual(2);
  await page.getByRole('button', { name: 'Pular o tour' }).click();
});

test('"Primeira vez aqui?" aparece uma vez por tela, também na navegação pelo menu; dispensar numa tela não esconde o das outras', async () => {
  const dica = page.getByRole('complementary', { name: 'Dica' });
  await page.goto('/painel/diarios');
  await expect(dica).toContainText('Primeira vez aqui?');
  await dica.getByRole('button', { name: 'Dispensar' }).click();
  await irPeloMenu(page, 'Conteúdos');
  await expect(dica).toContainText('Primeira vez aqui?'); // outra tela, outro aviso (dispensados por id)
  await irPeloMenu(page, 'Diários');
  await page.waitForLoadState('networkidle');
  await expect(dica).toBeHidden(); // sem recarregar: o "visto" já está no progresso local
  await page.reload();
  await expect(dica).toBeHidden();
});

test('o manual completo funciona sem JavaScript', async ({ browser }) => {
  const semJs = await browser.newContext({ javaScriptEnabled: false, storageState: await page.context().storageState(), extraHTTPHeaders: { 'x-forwarded-for': '10.9.14.1' } });
  const p = await semJs.newPage();
  await p.goto('/painel/ajuda');
  await expect(p.getByRole('heading', { name: 'Manual do NutriDebby', level: 1 })).toBeVisible();
  for (const t of ['Início', 'Pacientes', 'Prontuário', 'Plano alimentar', 'Agenda', 'Conteúdos', 'WhatsApp']) {
    await expect(p.getByRole('heading', { name: t, level: 2 })).toBeVisible();
  }
  await semJs.close();
});
```

Run: `pnpm e2e:seed && pnpm build && pnpm test:e2e` → PASS em todas as specs (as do E2E não esbarram no tour; `plataforma.spec.ts` pula o tour da conta criada pelo admin).

- [ ] **Step 5: Commit**

```bash
git add src/modules/ajuda/conteudo.ts src/app/painel src/app/painel/conteudos scripts/e2e-seed.ts e2e/helpers.ts e2e/plataforma.spec.ts e2e/manual.spec.ts
git commit -m "feat(manual): texto das 12 telas (rascunho para aprovação), âncoras, seed sem tour e E2E do manual guiado (P08-10)"
```

---

### Task 21: Checklist do go-live no repositório (P08-09)

**Files:**
- Create: `docs/operacao/go-live.md`

**Interfaces:**
- Consumes: os relatórios `docs/operacao/carga-*.md` (T10) e `restauracao-*.md` (T11), o runbook abaixo.
- Produces: o checklist que o dono assina (P08-09); a assinatura é um commit do dono neste arquivo (nome, data e o "de acordo"), com o OK da Debby no item da validação.

- [ ] **Step 1: O arquivo** — `docs/operacao/go-live.md`

```markdown
# Go-live do NutriDebby — checklist (P08-09)

Assinar só com **todos** os itens de "Bloqueia" marcados. Cada item diz quem confere e onde está a prova. Nunca colar
segredo neste arquivo (só o nome da variável). Horários em Brasília.

## Bloqueia (sem isso, nada de paciente real)
- [ ] Backup instalado no host (P02-11, etapas 6 e 8): timer ativo, primeiro `banco ok`/`arquivos ok`/`roles ok`, linhas em `backup_runs` — **dono**
- [ ] Teste de restauração feito e registrado (`docs/operacao/restauracao-AAAA-MM.md`), duração dentro do RTO — **dono + Dev**
- [ ] Passphrase e salt do rclone crypt e os segredos do app/worker (`AUTH_SECRET`, `ENCRYPTION_KEY`, `FILE_URL_SECRET`, `VAPID_*`, R2, Turnstile, Resend, `EVOLUTION_*`) num gerenciador de senhas, fora da VPS — **dono**
- [ ] PR #11 e Plano 07 mergeados; Plano 08 mergeado com a revisão completa e o `/security-review` (checklist reforçado) sem Critical/Important — **Dev**
- [ ] Textos legais v1.0 publicados (P08-06); a Debby aceitou o DPA v1.0; o novo aceite do paciente funciona (D25 + S-1) — **dono + Debby**
- [ ] Prazo de guarda confirmado pelo advogado/CRN (P-01) — **dono**
- [ ] Sentry recebendo erro de produção; o erro sintético com texto falso de saúde chegou **sem** o texto (runbook, passo 5) — **dono + Dev**
- [ ] Monitor externo ativo e o alerta de teste recebido no e-mail e no celular (D3) — **dono**
- [ ] `curl -sI https://<domínio>/entrar`: `content-security-policy` (com nonce), `strict-transport-security`, `x-content-type-options`, `x-frame-options`, `referrer-policy`; sem `x-powered-by` — **Dev**
- [ ] k6: relatório aprovado pela D4 (p95 das APIs ≤ 300 ms, páginas ≤ 800 ms, falhas < 1%, `notificacoes` < 20 s, LCP ≤ 2,5 s) — **Dev**
- [ ] 6ª tentativa de login errada em 15 min dá 429 com o IP real (`TRUSTED_PROXIES`, Plano 01 R17) — **Dev, em produção, com a conta de teste**

## Ambiente
- [ ] Limites do Easypanel revistos depois do k6 (`nutri_app`, `nutri_db`, `nutri_worker`) e a RNF-03 da spec atualizada; `cursoia_crm` sem impacto — **dono**
- [ ] WhatsApp (D16): `nutri_evolution` implantado, número da Debby conectado e a P-17 conferida (runbook do Plano 05, passo 5) **ou** go-live sem WhatsApp, decidido — **dono**
- [ ] Log do `nutri_evolution` com retenção curta (ele grava as mensagens recebidas; nota N11) — **dono**
- [ ] `VAPID_PUBLIC_KEY` do `nutri_app` igual à do `nutri_worker` (runbook do Plano 06, passo 2) — **dono**
- [ ] Turnstile com chaves reais; Resend com domínio verificado; **DMARC em `p=quarantine`** (nota do E-05) — **dono**
- [ ] Admin com 2FA; conta da Debby criada pelo admin (US-001), com 2FA ativada — **dono**
- [ ] Na tela do admin: "Taxa de faltas antes do sistema (%)" (E-08/P-15) e "Início do uso" preenchidos (D15) — **dono**
- [ ] Dados de teste em produção: decisão do dono e limpeza só com confirmação (pendência de 30/09) — **dono**
- [ ] Snapshot no hPanel antes do merge final; volta = redeploy da imagem anterior no GHCR (ficam as 2 últimas) — **dono**

## Produto e acessibilidade
- [ ] Teste manual do PWA no **Android** e no **iPhone (iOS 16.4+, de preferência um com Safari anterior ao 17.5)**: **foco visível** ao navegar com teclado/VoiceOver em `/entrar` e no portal (o axe roda só no Chromium), cores do portal no aparelho escuro (D18), instalar, ativar notificações, push real (lembrete, plano novo, conteúdo novo), plano offline, troca de conta no mesmo aparelho, foto HEIC do iPhone no diário (W-13; runbook do Plano 06, passo 5) — **dono**
- [ ] Teste manual do Plano 07: vídeo não listado do YouTube da Debby, Vimeo com `dnt=1`, "Carregar o vídeo" (D12), PDF de orientação, receita no plano — **dono**
- [ ] Acessibilidade fora do axe (X-5): `<details>` abertos, selo offline, estados de erro, tutorial do iOS, alvo de toque — conferência manual no celular — **dono + Dev**
- [ ] Painel no modo escuro e no claro, num computador e num tablet (768 px) — **Debby**
- [ ] Validação da Debby (P08-08): fórmulas do Apêndice A com casos reais, cálculo das receitas (RN-11), textos do E6 e do manual guiado, fluxo real de ponta a ponta — **Debby** (lista do que ela pediu mudar vai para o backlog)
- [ ] Treinamento feito (com o manual guiado e a página `/painel/ajuda`) — **dono + Debby**
- [ ] Job `retencao-lgpd` rodou em produção (log das 04h) — **Dev**

## Assinatura
- Dono: ____________________ Data: ___/___/______ — "Conferi os itens acima e autorizo o go-live."
- Debby (fluxo e fórmulas): ____________________ Data: ___/___/______
- CS-01 começa a contar em: ___/___/______ (o mesmo dia do "Início do uso" no admin)
```

- [ ] **Step 2: Commit**

```bash
git add docs/operacao/go-live.md
git commit -m "docs(operacao): checklist do go-live para o dono assinar (P08-09)"
```

---

## Runbook do go-live (o dono faz, com confirmação a cada passo)

0. **Lembrete fixo:** o **backup no host (P02-11, etapas 6 e 8) segue pendente** — sem ele, nada de pacientes reais. Antes de qualquer merge, snapshot no hPanel.
1. **Começar já (prazo de terceiros, em paralelo à execução):** E-07 (conta no Sentry, plano gratuito; D1), E-09 (advogado, passo 2) e a **consulta ao CRN** sobre o prazo de guarda do prontuário de nutrição (sugestão: registrar como **E-11** no backlog, resp. dono + Debby), E-08 (Debby: ~150 alimentos, taxa de faltas atual, casos reais das fórmulas), conta do monitor (D3), E-04 revisado se a D16 for "com WhatsApp", DMARC `p=quarantine`.
2. **Insumos para o advogado (E-09)** — mandar junto com o pedido: (a) a lista `SUBOPERADORES` (Tarefa 8) com a finalidade de cada um; (b) a Evolution API autohospedada recebe **todas** as mensagens que chegam ao número conectado, com log de retenção curta (P-18 c, N11); (c) serviços de push (Google, Apple, Mozilla, Microsoft) recebem o endereço do aparelho e o texto neutro do aviso; (d) YouTube e Vimeo: o player roda no aparelho do paciente e recebe o IP dele **depois do clique** (D12); (e) P-12: a criptografia em repouso depende do provedor e o dono do servidor tem acesso técnico ao banco — declarar; (f) backup no Cloudflare R2 em região ENAM (transferência internacional); Sentry (região da org, D1); Resend (`sa-east-1`); (g) prazo de guarda (referência: 20 anos, Lei 13.787/2018) e se o CFN/CRN exige outro; (h) o registro do dia de abertura do app (`access_events`, retenção de 400 dias, D13); (i) o L-5 (a cópia de dados do titular leva todas as medidas mesmo com "Mostrar % de gordura" desligado — LGPD art. 18, II); (j) se a página pública de agendamento precisa de um aviso de privacidade próprio; (k) um plano curto de resposta a incidente (ANPD e titulares). Pedir o DPA e o termo do paciente como **versão 1.0**, em parágrafos.
3. **Backup no host (P02-11, etapas 6 e 8)**, já com o script novo da Tarefa 11 (roles): instalar por SSH com `sudo` seguindo o runbook do Plano 02, Tarefa 14; gerar `BACKUP_PASSPHRASE` e salt no computador do dono; `/etc/nutri-backup/backup.env` com 600; ligar o timer; primeiro backup; depois o primeiro **teste de restauração** pelo `docs/operacao/restauracao.md` (cada execução lê produção → confirmação). Lembrete mensal do teste no calendário do dono.
4. **Monitor externo (D3):** monitores HTTP(S) de `https://<domínio>/api/health` (palavra-chave `"ok"`) e de `https://<domínio>/entrar`, intervalo de 5 min (ou 1 min na alternativa), alerta por e-mail e pelo app no celular; alerta de certificado TLS se o serviço tiver; mandar o "alerta de teste" do próprio serviço e marcar no checklist. O `nutri_evolution` não tem endereço público: vale o aviso do painel quando o WhatsApp cai.
5. **Sentry (P08-01):** criar o projeto (plataforma Node), ligar em *Settings → Security & Privacy* o *Data Scrubber*, os *Default Scrubbers* e *Prevent Storing of IP Addresses*; `SENTRY_DSN` e `SENTRY_ENVIRONMENT=producao` no Easypanel em `nutri_app` **e** `nutri_worker` (o dono, pelo painel; nunca colar o DSN no chat). Depois do deploy, o **erro sintético** (com confirmação; `docker exec` só para diagnóstico): `docker exec -i $(docker ps -q -f name=nutri_app | head -n1) node --import tsx -e "const s = await import('./src/lib/sentry.ts'); s.iniciarSentry({ dsn: process.env.SENTRY_DSN, ambiente: 'producao', papel: 'app' }); s.capturarErro(new Error('Glicemia 180 de Paciente Falso'), { motivo: 'teste' }); await s.encerrarSentry();"` → no Sentry, o evento chega com `[removido]` e sem "Glicemia". MCP do Sentry nesta máquina: autenticar na org nova (sem arquivo no repositório).
6. **Merge do Plano 08 (= deploy)**, só com OK explícito: snapshot no hPanel; as migrations **0085–0088** rodam no deploy com `DATABASE_URL_MIGRATOR` — 0085 cria dois gatilhos (`patients`, `data_exports`), uma política no `audit_log` e refaz a `paciente_arquivos` (nenhuma linha muda); 0086 e 0088 só acrescentam colunas com padrão; 0087 cria uma função. A partir do deploy, todas as páginas são dinâmicas (CSP com nonce): conferir com `curl -sI` e abrir o painel e o portal. Se algo quebrar por CSP: `CSP_MODO=relatorio` no Easypanel (`nutri_app`) e reiniciar o serviço **com confirmação**; os relatórios aparecem no log como "csp violada".
7. **Carga (P08-03), depois do merge e antes de qualquer paciente real:** seguir `docs/operacao/carga.md` (madrugada, pilha separada, OK do dono) com a imagem do deploy do passo 6 (`ghcr.io/<dono>/nutridebby:<sha do merge>`; o GHCR não tem imagem de branch). Rodada 1 → o relatório propõe os limites → o dono ajusta no Easypanel → rodada 2 → os dois relatórios num PR curto de docs e o item do checklist marcado. Mudança de código pedida pela carga = outro PR e nova rodada, ainda antes do primeiro paciente real.
8. **Textos legais (P08-06):** quando o advogado entregar, a Tarefa 8 vira um PR curto; no deploy, a Debby aceita o DPA v1.0 no primeiro acesso e cada paciente aceita o termo v1.0 no próximo login (D25).
9. **Validação com a Debby (P08-08)**, em produção com um paciente de teste (apagar depois, com confirmação): cadastrar e convidar → aceite do termo → anamnese → antropometria e gasto energético com os casos do Apêndice A → plano alimentar, publicar, PDF → agenda, horários, página pública, lembretes (e-mail, push; WhatsApp se D16) → presença/falta → diário com foto e comentário → conteúdos (vídeo, receita com o valor por porção, orientação com PDF) → pedido de dados e de exclusão → histórico de acessos. Registrar o aceite dela (fórmulas, textos, fluxo, **texto do manual guiado**) e a lista de mudanças (backlog; só erro de cálculo bloqueia).
10. **Treinamento:** sessão por videochamada gratuita usando o tour de boas-vindas e `/painel/ajuda` (impressa, se ela quiser); guia curto para os pacientes: instalar o app no Android e no iPhone, ativar notificações, "Sair" em aparelho compartilhado. Combinar o canal de suporte.
11. **Conta da Debby:** criada pelo admin (US-001) depois do DPA v1.0 publicado; ela ativa a 2FA; o dono preenche no admin a taxa de faltas antes do sistema e o início do uso (D15).
12. **Assinar o checklist** (`docs/operacao/go-live.md`) e atualizar o backlog e o painel do backlog.

## Fechamento do plano (após a Tarefa 21)

- [ ] Revisão da entrega conforme o índice (revista em 02/10/2026): revisor por tarefa (ao longo) → **revisão final do branch (workflow) com uma onda de correções** → `/code-review high` no PR **uma vez** → correções do que for Critical/Important (Minor → backlog) → re-revisão **só do diff das correções** → `/security-review` com o **checklist reforçado** — este é o P08-05, a revisão geral final do MVP:
  - **Sentry e logs (RNF-11):** todo `Sentry.init` passa por `opcoesDoSentry` (guarda verde); `filtrarEvento` nos três caminhos (app, worker, navegador); `/api/erro-cliente` com origem, limite, corpo de 1 KB e campos por regex; nenhum `console`/breadcrumb/`extra` com dado; `request_id` só UUID gerado no proxy (páginas e ações) ou no `onRequestError` (APIs); `matcher` do proxy sem `/api/*` (D2: nada de corpo bufferizado pelo Next; o E2E do exame de 15 MB passa).
  - **CSP e cabeçalhos (RNF-06):** nonce novo por requisição; nenhum `'unsafe-eval'` em produção; `script-src` sem `'unsafe-inline'`; `frame-src` só os três hosts; `frame-ancestors 'none'`; HSTS; `/api/arquivos` mantém o `default-src 'none'; sandbox`; o modo relatório só por variável.
  - **RLS (RNF-07):** os gatilhos da 0085 recusam toda coluna fora da lista (também com `UPDATE … SET` de várias colunas); `user_id` só de nulo para a própria conta; `audit_log` invisível ao paciente; capas só pela audiência; `admin_metricas_sucesso()` com dono sem superusuário e recusando rodar em `withTenant`.
  - **Limites e sessão:** limite por conta no push; `actorUserId` obrigatório com sessão de login; `semConta: true` só nos três fluxos de `SEM_CONTA_PERMITIDOS` (link da consulta, respostas do WhatsApp, convite), com a RLS por paciente mantida e nenhum ator inventado; `cache()` da sessão não guarda decisão de acesso (a decisão roda por chamada); S-12 mantido com justificativa.
  - **LGPD:** `access_events` na exclusão e na anonimização; retenção de 400 dias; textos v1.0 com os suboperadores; novo aceite.
  - **Tema e manual:** `user.tema`/`user.guia` gravados só por `preferencias.ts`, com o `userId` da sessão; `marcarGuia` sem chave arbitrária no `jsonb`; o tour não executa ações; nada do progresso sai do servidor.
  - **Backup:** o script novo não põe segredo nem stderr no log; a restauração apaga o container; nada de dado restaurado em disco.
  Tudo na assinatura (sem `/code-review ultra`). Registrar os resumos no PR. Se sobrar problema Critical/Important confirmado, parar e avisar o dono.
- [ ] Atualizar o backlog (`2026-09-27-nutridebby-backlog.md` **e** o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT): **acrescentar o P08-10 ao `.md`** (resumo: Plano 08 com 10 itens, 9 M e 1 S; P08-09 depende de P08-01 a P08-10); P08-01 a P08-10 ✅ (com o PR e o checklist); débitos B-4, B-6, B-8, L-5, W-13, X-5 ✅; os Minor da revisão num item "P08-11 — débitos do Plano 08"; E-11 (CRN) se o dono criar; corrigir o texto do E-10 (o `postgresql-client-16` não foi instalado no host e não é mais necessário — D6) e o cabeçalho do painel do backlog ("spec v1.5").
- [ ] Atualizar a spec para a v2.0: §1.1 (fórmulas do CS-01 a CS-03 e o denominador do CS-02, D15), §5 RNF-01 (meta de páginas e LCP depois da CSP), RNF-03 (VPS de 8 vCPU / 32 GB e os limites revistos no k6), RNF-04 (monitor e intervalo, D3), RNF-05 (roles no backup, restauração em container, sem cliente no host), RNF-06 (CSP como ficou, HSTS sem subdomínios, S-12 mantido com a justificativa), RNF-08 (`access_events`), RNF-10 (painel nos três modos), RNF-11 (Sentry só servidor/worker, `request_id` como ficou), §4.1 (exceções da `user`: `preferencias.ts`; B-4/B-6/capas; B-9: limite conhecido da D1 do Plano 06), §7 (`user.tema`, `user.guia`, `tenants.taxa_faltas_base`, `tenants.go_live_em`), US-005 (marca no visual V2), **US-057 "Manual guiado"** (nova, E1) com a tabela "Textos do manual" (o conteúdo aprovado no P08-08) e os textos novos de interface desta página; §11: P-01, P-02, P-12 e P-18 (c) resolvidas com a data do texto do advogado; P-15 resolvida (base no admin); P-05 revista.
- [ ] Atualizar o índice: linha do Plano 08 com o link e "em produção" + "go-live em <data>"; registro do processo (como o do Plano 06).
- [ ] Avisar o dono: o `/home/deploy/servidor/CLAUDE.md` (fora do repositório) ainda descreve a VPS como "KVM 2 — 2 vCPU, 8 GB RAM"; a edição é dele.
- [ ] Anotar para o pós-MVP (backlog): O(tenants) do `app_soltar_endpoint_push` se o k6 apontar; limite de login por e-mail (D11) se aparecer bloqueio por CGNAT; réplicas do app (os limites em memória mudam); central de avisos no sino (D21); portal com botão de tema (D18); tours do portal para o paciente; Fase 2 (staging, Asaas, acesso de suporte).
- [ ] Lembrar o dono: merge (= deploy) só com OK explícito e snapshot no hPanel antes.

---

## Autorrevisão do plano (writing-plans)

**1. Cobertura (itens do backlog, spec e notas)**

| Requisito | Onde |
|---|---|
| P08-01 Sentry com filtro de dado de saúde + Sentry MCP (RNF-11) | Tarefas 1, 2; runbook, passo 5 |
| P08-02 Monitor externo (RNF-04) | Tarefa 3 (health + E2E); runbook, passo 4; D3 |
| P08-03 k6 15 mil pacientes / 100 usuários + LCP (RNF-01, RNF-02) | Tarefa 10; D4, D5; runbook, passo 7 |
| P08-04 Teste de restauração documentado (RNF-05) | Tarefa 11; D6; runbook, passo 3 |
| P08-05 Revisão de segurança (headers, CSP, uploads, rate limits, RLS) | Tarefas 4, 5, 6; `/security-review` reforçado no fechamento |
| P08-06 Textos legais + prazo de guarda (P-01, P-02) | Tarefa 8; runbook, passos 2 e 8 |
| P08-07 Métricas CS-01 a CS-03 | Tarefas 9 e 15 (cartões); D15 |
| P08-08 Validação com a Debby + treinamento | Runbook, passos 9 e 10; checklist |
| P08-09 Go-live + checklist assinado | Tarefa 21; runbook, passos 11 e 12 |
| P08-10 Manual guiado | Tarefas 19, 20; D26, D27 |
| Visual V2 (bento, claro/escuro, botão, preferência por usuária) em todas as telas do painel | Tarefas 12–17 (e 18 para o portal, D18); o axe e os 768 px cobrem toda tela com `page.tsx` (`ROTAS_DO_PAINEL` + guarda `rotas-axe.test.ts`, T17) |
| RNF-08 LGPD (`access_events`) | Tarefa 7 |
| RNF-10 axe (painel e portal no escuro) | Tarefas 12 (passo 1), 17, 18, 20 |
| Notas N1 (429 com IP real), N11 (log da Evolution), N15/N36/N37 (testes manuais, VAPID), N35 (DMARC) | Checklist (Tarefa 21) |
| Débitos B-4, B-6, B-8, S-12, L-5, W-13, X-5, S-7 | Tarefas 5, 6, 8, 10, 14; checklist |

**2. Placeholders:** nenhum "TBD"/"implementar depois". Os únicos conteúdos de fora são **insumos externos declarados** (o texto do advogado na Tarefa 8, colado sem edição e conferido por teste; os números do k6 e da restauração, que são resultado de execução) — o plano diz de onde vêm e o que fazer se faltarem. Trechos em prosa são trocas mecânicas em arquivos existentes (uma linha num `select`, um import, um atributo `data-guia` num elemento identificado), com o texto exato.

**3. Consistência de nomes e tipos:** `filtrarEvento`/`filtrarBreadcrumb`/`caminhoSeguro` (T1) em T2 e na rota de erro do cliente; `requestIdDe`/`CABECALHO_REQUEST_ID` (T1) em T2 e T4; `criarLimite`/`MSG_MUITAS_TENTATIVAS` (T2) em T4 e T6; `montarCsp`/`novoNonce`/`CABECALHOS_SEGURANCA` (T4) no proxy e no `next.config.ts`; `apagarAcessosDoTitular`/`limparAcessosAntigos` (T7) no `lgpd.ts` e no worker; `SUBOPERADORES` (T8) no teste e no runbook; `metricasDeSucesso`/`DIAS_CS01`/`salvarMetricasBase`/`metricasDeSucessoPorTenant` (T9) em T15 e no admin; `TOKENS`/`PARES`/`contraste`/`misturar`/`corNoEscuro`/`CINZA_SOBRE_DESTAQUE` (T12) em T14 e T15; `MarcaTenant.corNoEscuro` (T12) no layout (T14) e no portal (T18); `Tema`/`ehTema`/`proximoTema`/`ProgressoGuia`/`EstadoGuia` (T13, `preferencias-tipos.ts`) em T14 e T19; `alternarTemaAction`/`escolherTemaAction`/`marcarGuiaAction` (T13) em T14 e T19; `ITENS_DO_MENU`/`itemAtual`/`iniciais` (T14, `navegacao.ts`) no menu, no `MenuConta` e no `CabecalhoPainel`; `Cartao`/`Botao`/`BotaoLink`/`Aviso`/`Selo` (T15) em T16; `resumoDoDia`/`contarDiariosNaoVistos` (T15); `GUIAS`/`guiaDaRota`/`precisaDoGuia`/`ID_BOAS_VINDAS` (T19/T20) no seed e nos testes; `escolherTema`/`irPeloMenu` (T17) em T20; `pularTourSeAparecer` (T20). Migrations: 0085 (T5), 0086/0087 (T9), 0088 (T13), na ordem das tarefas.

**4. Review Focus → testes:** 1 (dado no Sentry) → T1 (`sentry-filtro.test.ts`: mensagens, URLs com token, `user`, `extra`, tags, breadcrumbs), T2 (envelope real com transporte falso; rota `/api/erro-cliente` com 5 casos de recusa e o limite); 2 (CSP) → T4 (`csp.test.ts`, `proxy.test.ts`, `e2e/csp.spec.ts` com Turnstile e as telas do painel e do portal; todas as specs rodam com a CSP valendo), T6 (player sob demanda sem violação); 3 (tema e marca) → T12 (teste de propriedade com 3000 cores, sobreposição escura), T13 (tema por conta), T17 (outro aparelho, recarregar, três modos no axe, 768 px); 4 (escrita forjada do paciente) → T5 (`paciente-colunas.test.ts`: status, `anonimizar_apos`, nome, origem do opt-in, `user_id` de outra conta, `data_exports` pronta/escopo, `audit_log`, capa fora da audiência); 5 (manual atrapalhando) → T13 (`jsonb_set` atômico, chave inválida), T19 (`conteudo.test.ts`: cobertura de páginas e alvos), T19 (`aplicarMarca`: progresso local otimista), T20 (`manual.spec.ts`: abre uma vez, Esc grava, foco preso, outro aparelho, **concluir e voltar ao Início pelo menu sem recarregar não reabre**, aviso por tela também na navegação pelo menu, alvo do holofote, sem JS, seed sem tour para as outras specs).

## Decisões para o dono (★ — todas aprovadas em 04/10/2026, conforme a recomendação)

**Aprovadas pelo dono em 04/10/2026:** D1, D3, D4, D6, D8, D11, D12, D15, D16, D17, D18, D19, D20, D21, D22 e D26, todas como recomendadas abaixo. Nada a responder; a lista fica como registro.

1. **D1 — Sentry SaaS gratuito, só servidor e worker** (erros do navegador por rota própria). *Recomendado.* Alternativas: GlitchTip na VPS (dado não sai, +3 serviços para manter, sem MCP) ou SDK no navegador (DSN no build, +70 KB no PWA).
2. **D3 — Monitor: UptimeRobot gratuito a cada 5 min** (a spec passa a "alerta em até 10 min"). *Recomendado.* Alternativas: HetrixTools grátis com 1 min (cumpre a spec, mais um terceiro) ou Cloudflare Worker de 1 min (código nosso).
3. **D4 — Aceite do k6:** APIs p95 ≤ 300 ms e páginas ≤ 800 ms, falhas < 1%, `notificacoes` < 20 s, LCP ≤ 2,5 s, `cursoia_crm` intacto. *Recomendado.* Alternativas: 300 ms também nas páginas (mais otimização antes) ou só relatório, sem bloquear.
4. **D6 — Roles no backup** (o script muda e o dono reinstala no host). *Recomendado.* Alternativa: criar os roles à mão na restauração.
5. **D8 — HSTS sem `includeSubDomains`/`preload`.** *Recomendado.* Alternativa: com subdomínios (obriga HTTPS no CRM e no Easypanel por 2 anos).
6. **D11 — Limite de login por IP mantido** (medir o CGNAT; mudar só se aparecer bloqueio). *Recomendado.* Alternativa: IP + e-mail (~1 dia; permite travar a conta de alguém de propósito).
7. **D12 — Player "clique para carregar"** no portal. *Recomendado* (o IP do paciente só vai ao YouTube/Vimeo com o clique). Alternativa: player direto, como o Plano 07 aprovou.
8. **D15 — Métricas:** CS-02 com os ativos **com conta**; base do CS-03 e início do uso informados **pelo admin**. *Recomendado.* Alternativas: todos os ativos no denominador; base só no checklist ou informada pela Debby.
9. **D16 — WhatsApp no go-live só com o E-04 revisado e a P-17 conferidos**; senão, sobe com e-mail e push. *Recomendado.* Alternativa: esperar o WhatsApp para subir.
10. **D17 — Preferência de tema (e progresso do manual) em colunas da `user`.** *Recomendado.* Alternativas: cookie (por aparelho), `localStorage` (apagado a cada "Sair"), tabela nova.
11. **D18 — Portal: correção do escuro já e, na Tarefa 18, os tokens e fontes seguindo o aparelho, sem botão.** *Recomendado.* Alternativas: só o painel (portal sempre claro) ou portal com botão (+1 dia).
12. **D19 — Logo e nome do consultório no topo** (cor do consultório nos destaques). *Recomendado.* Alternativa: o logo "NutriDebby" do design.
13. **D20 — Menu de 6 itens + hub de Configurações + menu da conta** (Segurança continua em `/conta/seguranca`). *Recomendado.* Alternativa: os 10 links de hoje.
14. **D21 — Sem o sino "Avisos" na v1** (alertas no Início). *Recomendado.* Alternativa: central de avisos (+1 dia).
15. **D22 — Sem o peso no cartão "Próxima consulta".** *Recomendado* (evita `auditRead` a cada Início e dado de saúde na tela inicial). Alternativa: mostrar com `auditRead`.
16. **D26 — Manual guiado: os dois** (tour de boas-vindas + tours por tela + central de ajuda `/painel/ajuda`). *Recomendado.* Alternativas: só o tour (~2–3 dias) ou só a central de ajuda (~2 dias).

Pontos que precisam de atenção (não são decisões):
- **Backup (P02-11, etapas 6 e 8) pendente**: sem ele, nada de pacientes reais; a Tarefa 11 e o checklist dependem dele.
- **O advogado (E-09) é o caminho crítico**: a Tarefa 8 espera o texto; o resto do plano não.
- **Não existe item para o CRN** no backlog: sugerido o E-11 (prazo de guarda do prontuário de nutrição).
- O texto do manual guiado (Tarefa 20) é **rascunho**: o dono e a Debby aprovam no P08-08.
- O `/home/deploy/servidor/CLAUDE.md` ainda descreve a VPS antiga (8 GB); a edição é do dono.

## Execução

Recomendado: **subagent-driven** (uma tarefa por subagente, revisor por tarefa, revisão final do branch no fim), em **duas frentes paralelas em worktrees** — operação e segurança (Tarefas 1–11) e visual e manual (Tarefas 12–20) — com dois pontos de integração — a frente de operação até a Tarefa 9 entra no worktree visual **antes da Tarefa 15** (os cartões de métricas do Início usam a T9) e tudo é integrado antes da Tarefa 17 (o axe do painel roda com a CSP da Tarefa 4) — e fechadas pela 21; a carga (Tarefa 10, passo 5) roda depois do merge. Motivo: são 21 tarefas com interfaces bem definidas entre si (o filtro do Sentry, a CSP, os tokens, as preferências e o conteúdo do manual são consumidos por várias outras), e um erro aqui vai direto para o go-live com dado de saúde real — uma fuga para o Sentry ou uma CSP quebrando o Turnstile em produção custa caro de desfazer. A Tarefa 8 espera o advogado; a 10 e a 11 esperam o OK do dono para rodar na VPS.
