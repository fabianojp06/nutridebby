# Plano 05 — Agenda & lembretes (M4): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A nutricionista define os horários de atendimento e os bloqueios, marca, altera e cancela consultas numa agenda de dia, semana e lista; o paciente marca, confirma, cancela e remarca pelo link da consulta e pela página pública `/n/<slug>` (Turnstile + código por e-mail); lembretes de 24 h e 2 h saem por e-mail, WhatsApp (Evolution API, número da própria nutricionista) e push, com horário silencioso, cota de WhatsApp, confirmação por resposta "1"/"2" e registro de presença/falta com a taxa de faltas (CS-03).

**Architecture:** Dois módulos novos: `src/modules/agenda` (fuso e horários livres puros, disponibilidade, consultas com `EXCLUDE` no Postgres contra sobreposição, agendamento pelo paciente, cancelamento/remarcação, link assinado da consulta, página pública, presença) e `src/modules/notificacoes` (motor de lembretes por estado no banco: uma linha por consulta × tipo × canal, varredura do worker a cada minuto que reserva, envia e registra; canais e-mail, WhatsApp e push atrás de interfaces de provedor com implementação de teste/sandbox). O WhatsApp usa a **Evolution API** autohospedada (decisão do dono, 2026-10-01): uma instância por tenant (`nd-<tenantId>`), conectada por QR code no painel; o webhook é autenticado por JWT HS256 com uma chave **por instância** (`jwt_key` derivado do segredo), recusa a repetição do mesmo pedido, chega por endereço interno e é processado na fila. O contexto sem login (`publico`) é barrado no próprio banco em toda tabela que o fluxo público não precisa. Sem as variáveis da Evolution, o WhatsApp fica desligado e os lembretes seguem por e-mail e push; sem as do VAPID, o push fica desligado.

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 (App Router, Route Handlers, Server Actions, `PageProps`/`RouteContext`) · React 19.2 · PostgreSQL 16 (`btree_gist` já instalada na migration 0000, `EXCLUDE USING gist`, `tstzrange`) · Drizzle 0.45 · pg-boss 12.34 · Zod 4 · `web-push` 3.6.7 (**novo**, só no worker) + `@types/web-push` 3.6.4 (dev) · Evolution API v2.3.7 (serviço externo, imagem `evoapicloud/evolution-api:v2.3.7`, sem SDK: `fetch`) · `qrcode` 1.5.4 (já instalado; QR do sandbox) · Vitest 5 + Testcontainers · Playwright 1.63.

**Spec:** [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.6: §4.1, §6 INT-01/INT-02/INT-03/INT-06, §7 `availability_rules`/`availability_blocks`/`appointments`/`notifications`/`push_subscriptions`/`consents`/`tenants`, §8 RN-03 a RN-06, RN-08, RN-09, RN-15, RN-16, RN-17, §11 P-04/P-06, CS-03) e [`../specs/2026-09-27-nutridebby-mvp-historias.md`](../specs/2026-09-27-nutridebby-mvp-historias.md) (US-030 a US-037; US-004 e US-010 nas partes que dependem do Plano 05). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P05-01 a P05-12).

> **Mudança do dono (2026-10-01):** o WhatsApp do MVP passa da WhatsApp Cloud API da Meta para a **Evolution API** (https://docs.evolutionfoundation.com.br/evolution-api). INT-01, D-07 e o E-04 da spec viram "Desvios conscientes" (abaixo) e a spec é atualizada no fechamento. Fatos da Evolution conferidos na documentação oficial **e no código-fonte da v2.3.7** (a documentação OpenAPI ainda mostra o corpo da v1 em alguns pontos): `POST /message/sendText/{instance}` com cabeçalho `apikey` e corpo `{ number, text, delay?, linkPreview? }` (DTO `SendTextDto`; a página da documentação mostra `textMessage.text`, formato antigo), resposta com `key.id` e `key.remoteJid`; número sem WhatsApp → HTTP 400 com `exists: false`; `POST /instance/create`, `GET /instance/connect/{instance}` (QR em `base64`), `GET /instance/connectionState/{instance}` (`open`/`connecting`/`close`), `DELETE /instance/logout/{instance}`; `POST /webhook/set/{instance}` com `{ webhook: { enabled, url, headers, byEvents, base64, events } }`; eventos `messages.upsert` (resposta do paciente; `remoteJid` em `@lid` já trocado pelo `remoteJidAlt`), `messages.update` (`keyId` + `SERVER_ACK`/`DELIVERY_ACK`/`READ`/`PLAYED`/`ERROR`), `connection.update` (`state` + `wuid`); **sem HMAC de corpo**, mas o cabeçalho especial `jwt_key` do webhook da instância faz a Evolution mandar `Authorization: Bearer <JWT HS256>` (`{ iat, exp: iat + 600, app: 'evolution', action: 'webhook' }`, v2.3.0+); o webhook global **não** manda cabeçalhos (por isso o plano usa o webhook por instância); o JWT é **determinístico** — sem `jti`, sem instância e sem nada do evento: dois eventos da mesma instância no mesmo segundo levam o mesmo JWT (`WebhookController.generateJwtToken`); a Evolution repete o **mesmo** pedido (mesmo JWT e corpo) em 5xx/timeout, até 10 vezes, e desiste em 400/401/403/404/422 (`retryWebhookRequest`); o corpo do webhook traz um campo `apikey` com o token da instância **só** com `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true` (`ChannelStartupService.sendDataWebhook`; nulo com `false`, que o runbook usa — o plano não depende desse campo, D4); `POST /instance/create` aceita `token` (senão gera um UUID); botões interativos (`/message/sendButtons`) existem, mas não são confiáveis via Baileys.

## Global Constraints

- Tudo dos Planos 01–04 continua valendo: Node 24, TypeScript `strict`, `pnpm install --frozen-lockfile` no CI, `src/proxy.ts` (não `middleware.ts`), porta **3100** em dev/E2E local (a 3000 da VPS é o Easypanel), **3000** em containers e CI; `requireNutri` na entrada de toda página e Server Action da nutricionista; `requireApiNutri` em todo Route Handler dela; ids de rota conferidos com `idValido` (id inválido = 404, nunca 500).
- **Base:** `main` em `31330b5`. Se o PR do botão "Sair" (branch `botao-sair`, spec v1.7) entrar na `main` antes, fazer rebase e manter o `BotaoSair` no `Cabecalho` (as Tarefas 4 e 9 só acrescentam links ao `<nav>`); a atualização da spec no fechamento vira a versão seguinte à que estiver na `main`.
- Toda tabela nova com `tenant_id`: depois de `pnpm db:generate`, migration custom `rls_<tabela>` com `SELECT app_enable_tenant_rls('<tabela>');`; com `patient_id`, também `SELECT app_enable_patient_rls('<tabela>');`; tabela que o paciente nunca vê (regras, bloqueios, conexão do WhatsApp, pedidos da página pública): `SELECT app_enable_staff_only('<tabela>');` + entrada em `STAFF_ONLY` (`src/db/rls-guard.ts`). Entrada nova em `FABRICAS` de `test/isolamento.test.ts` (fábrica que precisa de linha-mãe cria a mãe no mesmo comando; tabela referenciada com FK `NO ACTION` entra em `ULTIMAS`; tabela com uma linha só por tenant usa `insert … select … where not exists`, porque a fábrica roda duas vezes por tenant). CLAUDE.md regras 1, 2 e 8. **Contexto `publico` (D11, a partir da Tarefa 3):** `app_enable_tenant_rls` passa a criar também a política RESTRICTIVE `publico_negado` — toda tabela nova nasce fechada para o contexto sem login; a tabela que o fluxo público precisa troca essa política pelas de comando com `SELECT app_allow_publico('<tabela>', '<comando>', …);` **e** uma entrada em `PUBLICO_LIBERADO` (`src/db/rls-guard.ts`), com o motivo. A guarda `findPublicoViolations` quebra o CI se as duas coisas não baterem.
- **Uma conexão por transação:** dentro do callback de um `withTenant` (ou de `db.transaction`) só se usa o `tx` recebido — nada de chamar função que abre outro `withTenant`/`getDb()` (ex.: `horariosLivres`, `escolherHorario`, `buscarTenant`). O que precisa de outra leitura é calculado **antes** de abrir a transação e revalidado dentro dela (pelo `EXCLUDE`, pela trava). Com o pool `max: 10`, dez pedidos assim esgotam as conexões e travam o app. Exceção conhecida: o `send` do pg-boss com `db: fromDrizzle(tx, sql)` usa a própria transação (o pg-boss tem pool próprio).
- **Auditoria (RNF-08, Decisão D10):** `appointments` é dado de saúde adjacente → `app_enable_audit('appointments', 'agenda')` (escritas auditadas pelo gatilho; ninguém precisa chamar `recordAudit` para criar/alterar/cancelar). A **leitura** da agenda (nome, hora, situação) não é auditada, como a lista de pacientes. `notifications`, `push_subscriptions` e `consents` (que passa a ter `patient_id`) ficam em `AUDIT_EXCEPTIONS`, com o motivo.
- Migrations sempre com `DATABASE_URL_MIGRATOR` (CLAUDE.md regra 7). `btree_gist` já existe (migration 0000; extensão *trusted*, criada pelo `nutri_owner` sem superusuário — `src/db/migrate-owner.test.ts` prova); nenhuma extensão nova.
- **Fuso (RN-06):** tudo gravado em UTC (`timestamptz`); calendário, horário silencioso, virada do mês da cota e textos usam `tenants.fuso` com as funções de `src/modules/agenda/fuso.ts` (só `Intl`, sem biblioteca nova). Nunca `new Date().getDate()`/`getHours()` do servidor (UTC). Datas `dd/mm/aaaa`, horas `HH:MM` (RNF-12), e nas mensagens ao paciente a sigla do fuso: "14:00 (horário de Brasília)".
- **Fila:** o motor de lembretes é **estado no banco** (`notifications.status`/`agendada_para`) varrido pelo worker a cada minuto (fila `notificacoes`, `* * * * *`, `America/Sao_Paulo`), não um job atrasado por lembrete — o pg-boss apaga job "created" depois de 14 dias (`retentionSeconds` padrão), e uma consulta pode ser marcada com 60 dias de antecedência. Ações que precisam de envio imediato (confirmação da marcação, resposta no WhatsApp) chamam `dispararEnvio(tx, tenantId)`, que enfileira a mesma varredura só daquele tenant, na mesma transação.
- **WhatsApp (D1–D5):** Evolution API por instância de tenant; nada de botões interativos; texto transacional só (lembretes, convite, respostas "1"/"2"); no máximo **8 mensagens por minuto por tenant** e fila serial; respostas do paciente reduzidas a `confirmar`/`remarcar` **na rota do webhook** (o texto da mensagem nunca é gravado, enfileirado nem logado). Sem `EVOLUTION_API_URL` + `EVOLUTION_API_KEY` (+ `EVOLUTION_WEBHOOK_SECRET` no app) o WhatsApp fica desligado; em produção, `EVOLUTION_WEBHOOK_URL` é obrigatória e interna (rede do Docker/Easypanel; a URL pública só com `EVOLUTION_WEBHOOK_URL_PUBLICA=1`, D4); `WHATSAPP_SANDBOX=1` (dev, CI, E2E; recusado em produção fora de `localhost`) troca o envio pelo Mailpit.
- **Push (D19):** envio com `web-push` + VAPID só no worker; 404/410 → inscrição apagada; payload sem dado de saúde. A tela de inscrição é do P06-02 (Plano 06), que grava em `push_subscriptions` com a sessão do paciente.
- **Página pública e link da consulta:** nunca devolvem dado de outro paciente (horários são só intervalos livres, calculados no contexto `publico`); a página pública valida o Turnstile no servidor antes de qualquer escrita de negócio (o contador do limite por IP é a única escrita antes); respostas iguais para e-mail cadastrado ou não; o link da consulta é um token HMAC que expira no início da consulta, nunca muda estado num `GET` (pré-visualização de link do WhatsApp abre a URL) e a página tem `Referrer-Policy: no-referrer`.
- RNF-11 / CLAUDE.md regra 3: nada de nome, e-mail, telefone, texto de mensagem, link com token, código de 6 dígitos, `apikey`, JWT ou corpo de webhook em log/Sentry; logs só com ids, canal, tipo, motivo e código de erro. Respostas da Evolution nunca são logadas (trazem número e QR).
- Textos de interface em pt-BR, com o texto exato da spec quando existir: "O fim deve ser depois do início", "Consulta dentro de um bloqueio", "Conflito com a consulta de <nome> às 09:00", "Fora do seu horário de atendimento", "Informe o link da chamada (https://…)", "Esse horário acabou de ser ocupado. Escolha outro.", "Para alterar, fale com sua nutricionista.", "Novo paciente via agendamento online", "Completar cadastro", "Você já tem 3 consultas marcadas. Fale com sua nutricionista.", "Agendamento online indisponível. Entre em contato.", "Confirmada via WhatsApp", "Paciente pediu para remarcar", "Você usou 80% dos WhatsApps do mês", "3 consultas sem registro de presença", "Enviar convite por WhatsApp", "Marque que o paciente autorizou o WhatsApp", "Tente novamente em alguns minutos", "Conta temporariamente indisponível". Textos novos estão na tabela de desvios (última linha).
- Acessibilidade (padrão dos Planos 02–04): `<label for>`, `fieldset`/`legend` nos grupos de horários e modalidades, `aria-invalid` + `aria-describedby`, erros com `role="alert"`, sucesso/estado com `role="status"`; situação da consulta e do lembrete com **texto**, não só cor; QR code com `alt`.
- Custo zero na assinatura: Evolution autohospedada (sem custo por mensagem), `web-push` gratuito, Turnstile gratuito, Resend no plano gratuito. **Dependências novas:** só `web-push@3.6.7` (dependência do worker) e `@types/web-push@3.6.4` (dev). O orçamento da imagem no CI (P02-01a) precisa continuar verde.
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): nada de mexer em produção, Easypanel, serviços, firewall ou banco de produção neste plano; nunca exibir segredos (só nomes de variável). Subir a Evolution e criar o banco dela é o **E-04 revisado** (runbook no fim), feito pelo dono, com confirmação a cada passo e snapshot no hPanel antes. Merge = deploy, só com OK explícito do dono.
- Política de revisão por entrega (índice): revisor por tarefa → `/code-review high` no PR → correções → `/code-review high` (precisa sair limpo) → `/security-review` com o checklist reforçado do fechamento (Plano 05 está na lista de checklist reforçado). Se sobrar problema confirmado depois da 3ª rodada, parar e avisar o dono. Lembrar o dono, a cada sessão, de que o **backup no host (P02-11, etapas 6 e 8) segue pendente**: sem ele, nada de pacientes reais.

### Decisões de desenho (tomadas neste plano — o dono confirma as marcadas com ★)

| # | Tema | Decisão | Custo / consequência |
|---|---|---|---|
| D1 ★ | Provedor do WhatsApp | **Evolution API v2.3.7** autohospedada (Baileys, "WhatsApp Web"), atrás da interface `ProvedorWhatsapp` (`enviarTexto`, `conectar`, `estado`, `desconectar`) com três implementações: `evolution` (produção), `sandbox` (dev/CI/E2E: a mensagem vira e-mail no Mailpit para `<número>@whatsapp.sandbox`, QR fictício) e `fake` (Vitest). Liga só com as variáveis (app: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `EVOLUTION_WEBHOOK_URL` — opcional em dev, obrigatória e interna em produção —, opcional `EVOLUTION_WEBHOOK_URL_PUBLICA`; worker: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`) | **Sem custo por mensagem** (a Meta não cobra). Custa RAM da VPS: estimar **~250–400 MB** (Node + Prisma + ~30–60 MB por número conectado); limite de **512 MB** no Easypanel. Precisa de um PostgreSQL (usa um banco `evolution` separado dentro do `nutri_db`, com role próprio) e **não** precisa de Redis (`CACHE_LOCAL_ENABLED=true`). Total do RNF-03 passa de 2,5 GB para ~3 GB dos ~5,5 GB livres (o `cursoia_crm` continua isolado pelos limites). **Risco:** automação não oficial pode levar o número a ser bloqueado pelo WhatsApp — mitigado por D16 |
| D2 ★ | Instância | **Uma por tenant** (`nd-<tenantId>`): cada nutricionista conecta o próprio número por QR code em "WhatsApp" no painel; recomendação na tela: usar um número só do consultório (WhatsApp Business no celular do consultório) | Um bloqueio atinge só aquele consultório (com número único da plataforma, todos os clientes cairiam juntos); o paciente reconhece o número e as respostas livres chegam à própria nutricionista. **Privacidade:** a Evolution recebe todas as mensagens que chegam àquele número; o NutriDebby só aproveita "1"/"2" de quem recebeu lembrete e descarta o resto na rota (nada gravado), mas a Evolution guarda o que a configuração mandar (o runbook desliga o armazenamento de mensagens) e escreve as mensagens recebidas no próprio log do container (`console.log` no código dela) — declarar no DPA (P-02) e manter o log do serviço `nutri_evolution` curto. Fica para o dono: preferir o número único da plataforma (como na spec, D-07) no piloto |
| D3 | Confirmar / remarcar (US-035) | **Resposta por texto** interpretada no webhook — "1", "sim", "confirmo" → confirmar; "2", "remarcar", "preciso remarcar", "não posso" → remarcar (sem acento, maiúsculas e pontuação) — **mais um link assinado** em todo lembrete (WhatsApp e e-mail) para a página `/consulta/<token>` com "Confirmar presença", "Cancelar consulta" e "Remarcar". Nada de botões interativos (não confiáveis no Baileys) | A confirmação funciona mesmo sem WhatsApp (pelo link do e-mail). Selos: "Confirmada via WhatsApp" e "Confirmada pelo link" |
| D4 | Autenticação do webhook (revista na rodada 1 do `/code-review`) | Cabeçalho `jwt_key` na configuração do webhook da instância → a Evolution manda `Authorization: Bearer <JWT HS256>`; a rota confere: só `alg = HS256`, HMAC-SHA256 em tempo constante, `exp` (10 min, folga de 60 s), `iat` não no futuro, `app = 'evolution'`, `action = 'webhook'`. Inválido → **401** (a Evolution não repete 401). Três camadas: **(a) amarrado à instância** — o `jwt_key` de cada instância é `chaveDoWebhook(EVOLUTION_WEBHOOK_SECRET, 'nd-<tenantId>')` (HKDF; o segredo-mestre, ≥ 32 caracteres, nunca sai do app); a rota lê o corpo (≤ 256 KB), pega `instance` e confere o JWT com a chave **dessa** instância — um JWT de um consultório não vale para outro, e o `connection.update` só grava número na instância do próprio tenant. (O campo `apikey` do corpo não é usado: só vem com `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true`, e ele é o token que **envia** mensagens pela instância — circular em todo webhook e ficar no log da Evolution seria pior que a chave derivada.) **(b) sem repetição** — o JWT da Evolution não tem `jti` e é igual para eventos do mesmo segundo, então a marca é o HMAC de "JWT + SHA-256 do corpo", gravada em `public_rate_limits` por 11 min (`consumirLimite` com limite 1); o mesmo pedido de novo → 401 (se enfileirar falhar, a marca é apagada e a repetição da Evolution passa). **(c) endereço interno** — em produção, `EVOLUTION_WEBHOOK_URL` é obrigatória e precisa ser interna (nome de serviço do Docker/Easypanel, sem ponto, ou IP privado); a URL pública só com `EVOLUTION_WEBHOOK_URL_PUBLICA=1`, opção documentada no runbook | Um JWT capturado só vale para aquela instância, por 10 min, e não serve para repetir o mesmo pedido; com a URL interna, capturar exige estar na rede do Docker. A Evolution não assina o corpo: quem capturar um pedido ainda pode montar outro corpo **da mesma instância** nesses 10 min — por isso a URL interna é obrigatória em produção. Trocar o segredo-mestre exige "Conectar WhatsApp" de novo em cada consultório (reconfigura o `jwt_key`) |
| D5 | Processamento do webhook | A rota (≤ 2 s) exige o `Bearer`, lê no máximo 256 KB, confere o JWT com a chave da instância do corpo e a repetição (D4), reduz o evento ao mínimo (resposta → só `confirmar`/`remarcar` + número + id; status → id + status; conexão → estado + número) e enfileira **cifrado** (`sealSecret`, finalidade `whatsapp-evento`) na fila `whatsapp-evento`; o resto (grupos, mensagens próprias, mídia, texto que não é "1"/"2") → 200 e descartado | O texto que o paciente digita nunca é gravado, enfileirado nem logado |
| D6 | Envio e idempotência (revista na rodada 1 do `/code-review`) | Uma linha por (consulta, canal, tipo, **início da consulta**) (`UNIQUE`; coluna `inicio_consulta`, obrigatória quando há consulta), criada na marcação para **os três canais**; as condições (opt-in, telefone, conexão, cota, inscrição, paciente ativo, consulta ativa, tenant ativo, horário da consulta igual ao da linha) são conferidas **na hora do envio** e viram `ignorada` + motivo. **Linha enviada é imutável:** marcar de novo no mesmo horário só reescreve linha `pendente`/`ignorada`/`falhou` (`ON CONFLICT … DO UPDATE … WHERE`); mudar o horário cria linhas novas para o horário novo e a pendente do horário antigo vira `ignorada`/`consulta_remarcada` — a enviada (e a que está saindo) fica como está, com `enviada_em` e o id do provedor, e continua contando na cota e nas métricas (só a anonimização LGPD apaga o `provider_jid`, Tarefa 15). O worker reserva (`pendente → enviando`, `FOR UPDATE SKIP LOCKED`) antes de chamar o provedor, **canal por canal**: e-mail e push primeiro, o WhatsApp com o que sobrar e só se o tenant ainda tem vaga no minuto (D16) — um acúmulo de WhatsApp nunca ocupa a vez dos outros canais; a volta do cron dá a cada tenant uma parte do lote (`max(5, 40 ÷ tenants)`, o que sobrar vai para quem encheu a parte) e começa num tenant diferente a cada minuto, sem perder o limite global de 40. WhatsApp e push são **no máximo uma vez** (linha presa em `enviando` > 15 min vira `falhou`/`interrompido`); e-mail repete com segurança (chave de idempotência do Resend `notificacao:<id>:<início da consulta>`). Status do WhatsApp só avança (`enviada` → `entregue` → `lida`) | Satisfaz US-034 "Sem duplicidade" (no máximo um por tipo, canal e horário da consulta) mesmo com o worker caindo no meio do envio; um evento repetido do webhook não muda nada; a tela da consulta mostra também o histórico do horário antigo ("Não enviado: consulta remarcada") |
| D7 | Horário silencioso (RN-05; revista na rodada 1 do `/code-review`) | **No planejamento:** lembrete cujo horário cai em [21:00, 08:00) no fuso do tenant fica `ignorada`/`horario_silencioso` (não é adiado); 08:00 em ponto vale. **Na reserva para envio** (worker parado, conta reativada à noite, fila atrasada): lembrete que venceu e seria enviado dentro de [21:00, 08:00), na 1ª tentativa, é **adiado para as 08:00** se ainda fizer sentido — o de 24 h, se as 08:00 ficarem antes do lembrete de 2 h (que cobre a reta final), ou até 30 min antes do início quando o de 2 h caiu no silêncio; o de 2 h, até 30 min antes do início — senão fica `ignorada`/`horario_silencioso`. O de 24 h que sai no dia da consulta diz "hoje", não "amanhã". A RN-05 não distingue canal: vale para **e-mail, WhatsApp e push**. Só lembretes: confirmação da marcação, aviso de cancelamento, convite e respostas "1"/"2" respondem a uma ação feita agora e saem na hora. Novas tentativas do mesmo envio (1, 5 e 25 min) não esperam o fim do horário silencioso | No pior caso, uma nova tentativa sai às 21:24; um lembrete atrasado às 23:30 sai às 08:00 |
| D8 | Fuso | `src/modules/agenda/fuso.ts` sobre `Intl.DateTimeFormat`: hora local inexistente (início do horário de verão) é pulada na geração de horários e recusada no agendamento ("Este horário não existe neste dia (mudança de horário de verão)."); hora repetida usa a primeira ocorrência | Sem dependência nova; testes com `America/New_York` cobrem as mudanças |
| D9 | Conflito | `EXCLUDE USING gist (tenant_id WITH =, tstzrange(inicio, fim, '[)') WITH &&) WHERE (status <> 'cancelada')` sobre as colunas `inicio`/`fim` (em vez da coluna `periodo`); consultas `realizada`/`faltou` continuam ocupando o horário. A restrição vale acima da RLS: a corrida entre dois pacientes (que não se veem) é decidida pelo banco | Erro 23P01 vira "Esse horário acabou de ser ocupado. Escolha outro." (paciente) ou "Conflito com a consulta de <nome> às HH:MM" (nutricionista) |
| D10 | LGPD da agenda | `appointments` com RLS por paciente e gatilho de auditoria (entidade `agenda`, rótulo "Agenda" no "Histórico de acessos"); leitura da agenda sem `auditRead` (nome + hora + situação, mesmo critério da lista de pacientes); `notifications` com RLS por paciente, sem auditoria (registro técnico de entrega, sem dado clínico); `motivo_cancelamento` e `provider_jid` apagados na anonimização (Tarefa 15) | O "Histórico de acessos" do paciente mostra quem marcou, mudou ou cancelou cada consulta, sem uma linha por abertura da agenda |
| D11 | Horários livres sem vazar dados (defesa no banco desde a rodada 1 do `/code-review`) | Calculados num contexto novo **`publico`** do `withTenant` (`TenantRole`), que lê regras, bloqueios e só `inicio`/`fim` das consultas, e devolve só intervalos. Sessões de paciente nunca leem regras/bloqueios (`staff_only`) nem consultas de outros (RLS). **No banco:** negar por padrão — `app_enable_tenant_rls` cria a política RESTRICTIVE `publico_negado` (o `publico` não lê nem grava nada) em toda tabela com `tenant_id`, inclusive nas antigas (a migration 0051 aplica em todas) e nas que ainda vão nascer; `app_allow_publico(tabela, comandos…)` troca essa política por uma RESTRICTIVE por comando negado, liberando **só** o que o fluxo público usa: `availability_rules`/`availability_blocks` (`select`), `appointments` (`select`, `insert`), `patients` (`select`, `insert`), `notifications` (`select`, `insert`: o `INSERT … ON CONFLICT` exige ler a linha nova), `audit_log` (`insert`: o gatilho de auditoria roda com o papel de quem grava), `public_booking_requests` (`select`, `insert`, `update`). A lista explícita é `PUBLICO_LIBERADO` (`src/db/rls-guard.ts`) e a guarda confere que o banco bate com ela | Negar por padrão (em vez de "negar tabela a tabela"): tabela nova nasce fechada mesmo se alguém esquecer, e o que é liberado fica numa lista curta e revisável. A RLS não restringe colunas (o papel do banco é o mesmo): "só `inicio`/`fim`" continua garantido pelas funções fechadas de `src/modules/agenda`; o banco garante que notas, anamnese, exames, planos etc. dão 0 linhas para o `publico`. O contexto `publico` não tem ator (auditoria com IP) |
| D12 | Página pública | Dois passos: pedido (nome, e-mail, telefone opcional, "Tenho 18 anos ou mais", termo, opt-in de WhatsApp, Turnstile) → **código de 6 dígitos** no e-mail (10 min, 5 tentativas) → consulta. Limites: 10 tentativas por IP por hora (HTTP 429), 1 código por e-mail a cada 60 s e 5 por hora, 3 consultas futuras por e-mail (conferido **depois** do código, para não revelar quem é paciente). E-mail de paciente ativo → a consulta vai para esse paciente (ele provou o e-mail); arquivado/bloqueado → "Não foi possível agendar por aqui. Fale com sua nutricionista." O botão "Entrar (já sou paciente)" fica para o Plano 06 | Respostas iguais para e-mail cadastrado ou não até o código ser confirmado |
| D13 | Termo aceito na página pública | `consents` ganha `patient_id` (com `tenant_id`) e `user_id` passa a aceitar nulo, com CHECK "conta ou paciente" e `UNIQUE NULLS NOT DISTINCT (user_id, termo_versao, tenant_id, patient_id)` | O visitante ainda não tem conta; a prova de aceite fica onde as outras ficam |
| D14 | `push_subscriptions` | Com `tenant_id` e `patient_id` (🔒, RLS por paciente) em vez de só `user_id`: o envio roda no `withTenant` do worker sem atravessar tenants, a exclusão LGPD apaga só as do vínculo e o P06-02 grava uma linha por vínculo ativo do dispositivo. `UNIQUE (tenant_id, patient_id, endpoint)` | Desvio do §4.1/§7 (registrado) |
| D15 ★ | Cota (RN-09) | Continua por tenant e mês civil no fuso do tenant, padrão **500**, agora como **limite de uso** (protege o número contra bloqueio e a VPS), não de custo: conta lembretes e convites aceitos pela Evolution; respostas automáticas a "1"/"2" não contam; 80% → aviso no painel + e-mail "Você usou 80% dos WhatsApps do mês" (uma vez por mês); 100% → `ignorada`/`cota_esgotada` até o mês seguinte ou até o admin ampliar (vale na hora) | Nenhum custo; o dono pode preferir outro padrão |
| D16 ★ | Ritmo de envio (anti-bloqueio) | Fila serial (1 envio por vez no worker), no máximo **8 mensagens por minuto por tenant**, `delay` de 1,2 s ("digitando…") da Evolution, `linkPreview` desligado; nada de disparo em massa (convite só no cadastro, 2 lembretes por consulta, 1 resposta por consulta) | Num pico (muitos lembretes às 08:00) o último pode sair alguns minutos depois |
| D17 | Remarcar | Pelo **paciente** = cancelar a antiga (`cancelado_por = 'paciente'`) + criar a nova (`remarcada_de`) numa transação (US-033); pela **nutricionista** = "Alterar data e hora" da mesma consulta, que volta a situação para "Agendada"; os lembretes ainda pendentes do horário antigo viram `ignorada`/`consulta_remarcada` e o horário novo ganha linhas próprias (D6, rodada 1 do `/code-review` — o enviado não é reaberto). Mudar só a duração ou a modalidade mantém o horário e as mesmas linhas: os lembretes pendentes saem com os dados novos (lidos no envio), sem nova "Consulta marcada" | O histórico do paciente mostra as duas consultas; a tela da consulta mostra os lembretes dos dois horários |
| D18 | Avisos à nutricionista | E-mail pela fila `email` (consulta marcada, remarcada ou cancelada pelo paciente, pedido de remarcação, novo paciente da página pública, WhatsApp desconectado, 80% da cota) + quadro "Agenda" no painel inicial (Tarefa 15). Sem tabela de notificações internas | O e-mail da nutricionista vem de `user` (CLAUDE.md regra 1: `src/modules/agenda/aviso-nutri.ts` entra na lista) |
| D19 | Push | Envio já aqui (P05-10): `web-push`, VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` no worker), TTL até o início da consulta, 404/410 apagam a inscrição; payload `{ titulo, corpo, url }` sem dado de saúde ("Consulta amanhã às 14:00"). A inscrição e o push de teste são do P06-02 | Até o Plano 06, `sem_inscricao` em todas as linhas de push (esperado) |
| D20 | Link assinado da consulta | Token de 71 caracteres: versão + tenant + consulta + validade (início da consulta) + HMAC-SHA256 truncado em 128 bits, com chave derivada (HKDF) de `ENCRYPTION_KEY` (app e worker já têm; nenhuma variável nova). Ações pelo link rodam com o contexto `paciente` do dono da consulta (RLS por paciente) e o IP de quem clicou | Quem tiver o link pode confirmar/cancelar/remarcar aquela consulta (como num convite de calendário); `Referrer-Policy: no-referrer` |
| D21 | Taxa de faltas (CS-03) | Do mês civil no fuso do tenant: faltas ÷ consultas do mês já iniciadas e não canceladas; "Taxa de faltas do mês: 12,5% (2 de 16)" e a do mês anterior; "sem registro de presença" = consulta não cancelada que terminou há mais de 24 h ainda `agendada`/`confirmada` | Consulta futura não entra no denominador |
| D22 | Agendamento pela nutricionista | Qualquer data (inclusive passada, para registrar um encaixe) e qualquer horário (fora das regras: aviso "Fora do seu horário de atendimento"; dentro de bloqueio: "Consulta dentro de um bloqueio"); duração de 15 a 240 min (padrão 60); paciente arquivado ou bloqueado não é agendado ("Paciente arquivado: desarquive para agendar." / mensagem de bloqueado existente) | Consulta no passado não gera confirmação nem lembrete (`prazo_passado`) |

### Desvios conscientes da spec (registrados aqui; atualizar a spec no fim do plano)

| Spec | Neste plano | Motivo |
|---|---|---|
| INT-01 (WhatsApp Cloud API da Meta, templates aprovados, `X-Hub-Signature-256`, `hub.verify_token`, `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_API_VERSION`) | **Evolution API** (D1): texto simples no lugar de templates; webhook com JWT HS256 do `jwt_key` derivado por instância, sem repetição e por endereço interno (D4), sem `GET` de verificação; variáveis `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `EVOLUTION_WEBHOOK_URL`, `EVOLUTION_WEBHOOK_URL_PUBLICA`, `WHATSAPP_SANDBOX`; chave de idempotência = id da mensagem da Evolution (`key.id`/`keyId`). Mantidos: timeout de 10 s, 3 novas tentativas em 1, 5 e 25 min, fallback por e-mail, opt-in obrigatório antes de qualquer mensagem | Mudança do dono (2026-10-01): sem verificação da Meta nem custo por conversa |
| D-07 "número único da plataforma no MVP" (e Fase 3 "número próprio") | Número da própria nutricionista, uma instância por tenant (D2 ★) | Bloqueio isolado por consultório; respostas chegam à nutricionista |
| E-04 "Verificação da Meta Business + app + número + 3 templates" | **E-04 revisado:** subir a Evolution no Easypanel (serviço `nutri_evolution`, banco `evolution` no `nutri_db`), configurar as variáveis no app e no worker e a Debby conectar o número pelo QR do painel (runbook no fim) | Mudança do dono |
| US-035 botões *quick reply* "Confirmo"/"Preciso remarcar" | Resposta "1"/"2" (e palavras) + link assinado em todo lembrete (D3); selo "Confirmada via WhatsApp" mantido, "Confirmada pelo link" novo | Botões não confiáveis no Baileys |
| RN-09 "cota … para controlar o custo" / "aceita pela API da Meta" | Mesma regra como limite de uso (D15 ★), contando mensagens aceitas pela Evolution | Não há custo por mensagem |
| RN-05 "horário de envio no intervalo [21:00, 08:00)" → `ignorada` | No planejamento, igual. Na **reserva para envio**, o lembrete que venceu e sairia no silêncio (worker parado, conta reativada à noite) é adiado para as 08:00 quando ainda faz sentido para o tipo — senão `ignorada`/`horario_silencioso` —, em todos os canais (a RN-05 não distingue); o de 24 h que sai no dia da consulta diz "hoje" (D7) | Rodada 1 do `/code-review`: o envio atrasado saía de madrugada |
| §7 `appointments.periodo tstzrange` | Colunas `inicio`/`fim` + `EXCLUDE` sobre `tstzrange(inicio, fim, '[)')` (D9); colunas a mais: `confirmada_via`, `cancelada_em`, `remarcada_de`, `presenca_em`, `updated_at`; `origem` só `nutri`/`paciente` (o paciente da página pública marca como `paciente`) | Drizzle não tem tipo `tstzrange`; a faixa é expressão da restrição |
| §7 `notifications` | Status a mais `enviando` (reserva antes do envio, D6); colunas `provider_jid` (destino real no WhatsApp, para casar a resposta), `enviada_em` (base da cota), `erro` (código curto), `conteudo_selado` (convite por WhatsApp com o link cifrado até o envio), `inicio_consulta` (versão: `UNIQUE (appointment_id, canal, tipo, inicio_consulta)` no lugar de §7/US-034 "UNIQUE appointment_id + canal + tipo" — remarcar cria linhas novas e a enviada fica como registro, D6); motivo a mais `consulta_remarcada`; tipos `lembrete_24h`, `lembrete_2h`, `consulta_marcada`, `consulta_cancelada`, `convite_paciente`, `resposta_confirmacao`, `resposta_remarcar` | At-most-once, cota por mês, resposta ao paciente e lembrete enviado imutável (rodada 1 do `/code-review`) |
| §7 `push_subscriptions` sem `tenant_id` (§4.1: "acesso só pelos services do M1") | Com `tenant_id` + `patient_id`, RLS por paciente (D14) | Isolamento no banco e exclusão LGPD por vínculo |
| §7 `consents` (`user_id` obrigatório) | `user_id` nulo + `patient_id` para o aceite da página pública (D13) | O visitante ainda não tem conta |
| Tabelas novas não previstas | `whatsapp_conexoes` 🔒 (estado da instância, avisos de desconexão e de 80%), `public_booking_requests` 🔒 (pedido da página pública com o código, apagado em 24 h), `public_rate_limits` (sem `tenant_id`: contadores por IP/e-mail com HMAC, só `src/modules/agenda/limite-ip.ts` acessa) | Fluxos novos |
| §4.1 módulo `agenda` | Dois módulos: `agenda` e `notificacoes` | O motor de envio é usado também pelo convite (US-010) |
| US-031 "a Ana recebe e-mail e push de confirmação" | E-mail sempre; push só com inscrição (P06-02) | O PWA e a inscrição são do Plano 06 |
| US-032 "precisa entrar (se já for paciente)" na página pública | O código por e-mail serve também para quem já é paciente (D12); o "Entrar" fica para o Plano 06 | O portal ainda não existe |
| US-032 / US-033 / P05-03 / P05-05 pelo PWA | Domínio completo (agendar, cancelar, remarcar com RN-03/RN-04) usado pela página pública e pelo link da consulta; a tela no PWA é o P06-09 | O portal é do Plano 06 |
| Textos novos de interface | Agenda: "Agenda", "Horários de atendimento", "Adicionar horário", "Dia da semana", "Início", "Fim", "Duração", "Modalidade", "Presencial", "Online", "Presencial ou online", "A duração deve ser de 15 a 240 minutos", "O horário precisa caber pelo menos uma consulta", "Este horário se sobrepõe a outro do mesmo dia.", "Informe um horário válido (HH:MM)", "Limite de 30 horários de atendimento.", "Bloqueios", "Adicionar bloqueio", "Data inicial", "Data final", "Motivo (opcional)", "A data final deve ser igual ou posterior à inicial", "O bloqueio pode ter no máximo 366 dias", "Use no máximo 120 caracteres", "Bloqueado: {motivo}", "Nova consulta", "Paciente", "Selecione o paciente", "Data", "Hora", "Link da chamada", "Informe uma data válida", "Este horário não existe neste dia (mudança de horário de verão).", "Paciente arquivado: desarquive para agendar.", "Consulta marcada.", "Consulta não encontrada.", "Alterar data e hora", "Consulta alterada.", "Só dá para alterar consulta agendada ou confirmada.", "Dia", "Semana", "Lista", "Hoje", "Anterior", "Próximo", "Nenhuma consulta neste período.", "Agendada", "Confirmada", "Cancelada", "Realizada", "Faltou", "Confirmada pelo link", "Cancelada pelo paciente", "Cancelar consulta", "Motivo do cancelamento (opcional)", "Cancelar esta consulta? O paciente recebe um aviso por e-mail.", "Consulta cancelada.", "Esta consulta não pode mais ser cancelada.", "Use no máximo 300 caracteres" · Lembretes: "Lembretes", "Lembrete de 24 h", "Lembrete de 2 h", "Confirmação da marcação", "Aviso de cancelamento", "Convite", "Resposta ao paciente", "E-mail", "WhatsApp", "Notificação no app", "Agendado para {quando}", "Enviando…", "Enviado em {quando}", "Entregue", "Lido", "Falhou", e os motivos ("Não enviado: horário silencioso (21h–8h)", "… já tinha passado do horário", "… consulta cancelada", "… consulta remarcada", "… consulta encerrada", "… paciente arquivado ou bloqueado", "… conta suspensa", "… sem autorização de WhatsApp", "… sem telefone", "… WhatsApp não configurado na plataforma", "… WhatsApp desconectado", "… cota de WhatsApp do mês esgotada", "… paciente sem notificações no app", "… notificações no app não configuradas") · Link da consulta: "Sua consulta", "Confirmar presença", "Presença confirmada. Até lá!", "Remarcar", "Escolha um novo horário", "Remarcar para este horário", "Consulta remarcada para {quando}.", "Este link expirou.", "Link inválido.", "Esta consulta foi cancelada.", "Nenhum horário livre nos próximos 60 dias. Fale com sua nutricionista.", "Esse horário não está mais disponível. Escolha outro.", "Avisar que preciso remarcar", "Avisamos sua nutricionista. Ela vai entrar em contato.", "Semana anterior", "Próxima semana", "Presença confirmada", "Consulta realizada", "Consulta encerrada" · Mensagens (e-mail/WhatsApp/push): "Lembrete: sua consulta é amanhã às {hora}", "Lembrete: sua consulta é hoje às {hora}", "Consulta marcada: {quando}", "Consulta cancelada: {quando}", "Confirmar presença ou remarcar", "Responda 1 para confirmar ou 2 se precisar remarcar.", "Tudo bem! Para escolher outro horário, use o link: …", "Consulta amanhã às {hora}", "Seu código para agendar com {nutri}: {código}", avisos à nutricionista ("Consulta marcada pelo paciente", "Consulta remarcada pelo paciente", "Consulta cancelada pelo paciente", "Paciente pediu para remarcar", "Novo paciente via agendamento online", "Ver na agenda"), "Seu WhatsApp foi desconectado do NutriDebby" · Página pública: "Agendar consulta com {nome}", "Escolha a modalidade", "Escolha o horário", "Seus dados", "Telefone (opcional)", "Tenho 18 anos ou mais", "Confirme que você tem 18 anos ou mais", "Quero receber lembretes por WhatsApp", "Informe o telefone para receber lembretes por WhatsApp", "Enviar código", "Enviamos um código de 6 dígitos para {e-mail}. Ele vale por 10 minutos.", "Código", "Confirmar agendamento", "Código incorreto.", "Código expirado. Peça um novo código.", "Muitas tentativas com código errado. Peça um novo código.", "Aguarde 1 minuto para pedir outro código.", "Muitas tentativas. Tente novamente mais tarde.", "Não foi possível agendar por aqui. Fale com sua nutricionista.", "Consulta marcada para {quando}. Enviamos a confirmação para o seu e-mail.", "Escolha um horário", "Nenhum horário livre nesta semana." · WhatsApp: "WhatsApp", "Conectar WhatsApp", "Gerar novo QR code", "No celular, abra o WhatsApp > Aparelhos conectados > Conectar um aparelho e aponte para este código.", "QR code para conectar o WhatsApp", "Conectado ao número {telefone}.", "Desconectar WhatsApp", "Desconectar o WhatsApp? Os lembretes passam a sair só por e-mail e notificação no app.", "WhatsApp desconectado. Os lembretes estão saindo só por e-mail e notificação no app.", "O WhatsApp ainda não está disponível na plataforma. Os lembretes saem por e-mail.", "Use, de preferência, um número só do consultório. Os lembretes saem do número conectado.", "Não foi possível falar com o serviço de WhatsApp. Tente de novo em alguns minutos.", "WhatsApps do mês: {usadas} de {cota}", "Cota de WhatsApp do mês esgotada: os lembretes seguem por e-mail e notificação no app até o mês que vem." · Painel: "Consultas do mês", "Taxa de faltas do mês: {x}% ({faltas} de {total})", "Mês anterior: {y}%", "Sem dados", "Pedidos de remarcação", "Marcadas pelo paciente (últimos 7 dias)", "Canceladas pelo paciente (últimos 7 dias)", "Iniciar atendimento", "Registrar presença", "Realizada", "Faltou", "Presença registrada.", "A presença só pode ser registrada depois do início da consulta.", "Convite por WhatsApp: {situação}" | Formulários e estados novos |

### Itens adiados de planos anteriores

**Incorporados** (a tarefa que resolve está entre parênteses):
- Plano 02 (US-004): lembrete pendente → `ignorada`/`tenant_suspenso` na suspensão e reagendamento na reativação — a suspensão/reativação do admin só enfileira o job `agenda-tenant`; o worker faz a troca dentro do `withTenant` (o admin nunca toca tabela 🔒) (Tarefa 5).
- Plano 02 e 03: `admin_tenant_metrics()` troca os `NULL` de `consultas_mes` e `mensagens_whatsapp_mes` por contagens (Tarefa 11).
- Plano 02: a página pública usa `verifyTurnstile` (Tarefa 8).
- Plano 03: convite por WhatsApp do cadastro (P05-11, US-010) (Tarefa 14).
- Plano 03: `consultations.appointment_id` + "Iniciar atendimento" a partir da agenda (Tarefa 15).
- Plano 03: inscrições de push apagadas em `atenderPedidoExclusao` (Tarefa 13).
- Plano 03: lembretes só para `patients.status = 'ativo'`; WhatsApp só com `whatsapp_optin_em` preenchido e `whatsapp_optout_em` vazio; arquivado/bloqueado não recebe notificação (RN-08) (Tarefas 5 e 10).
- Exportação do titular (US-018 "todas as tabelas de P"): consultas e lembretes entram no `dados.json` (Tarefa 15).

**Não incorporados** (motivo):
- P04-10 (débitos do Plano 04: exportação N+1, inserts em lote, helper de trava) — módulo `plano-alimentar`, sem relação com a agenda; fica num PR pequeno à parte para não aumentar a superfície de revisão deste.
- Plano 03 (a) / P06-00 (d): `stored_files` restrita por paciente — continua no Plano 06 (a agenda não lê arquivos).
- P06-00 (a)–(c): políticas de escrita só da equipe em `foods`, `food_measures` e `anamnesis_templates` etc. — continuam pré-requisito do **Plano 06**. Este plano **não** abre sessão de paciente no navegador: o contexto `paciente` só aparece no servidor, dentro das funções fechadas da agenda (link da consulta), que só tocam `appointments` e `notifications` do próprio paciente.
- P06-02 (inscrição de push e push de teste) e P06-09 (agendar/cancelar/remarcar no PWA) — Plano 06, sobre as funções deste plano.

## Review Focus

1. **Dois pacientes (ou visitantes) no mesmo horário ao mesmo tempo**, e a nutricionista marcando por cima de uma consulta existente. Esperado: exatamente uma consulta criada; o outro paciente vê "Esse horário acabou de ser ocupado. Escolha outro."; a nutricionista vê "Conflito com a consulta de Ana Souza às 09:00"; nenhum dado do outro paciente aparece para o paciente. Testes nas Tarefas 3, 6 e 8.
2. **Bordas de fuso e de relógio.** Consulta às 08:00 (lembrete de 2 h às 06:00 → silencioso), lembrete às 20:59 / 21:00 / 07:59 / 08:00, consulta criada em cima da hora, virada do mês às 23:59 de Brasília (02:59 UTC), dia com mudança de horário de verão num fuso que tem, lembrete que venceu com o worker parado e seria enviado às 23:30, lembrete de 2 h que venceu às 22:00 para consulta às 07:00. Esperado: exatamente as regras da RN-05/RN-06 e da RN-09 no fuso do tenant, nunca no UTC do servidor; o atrasado sai às 08:00 (dizendo "hoje"), o de 2 h que só caberia depois da consulta fica `horario_silencioso` (D7). Testes nas Tarefas 1, 5 e 11.
3. **Resposta no WhatsApp que não bate com nada.** "1" de um número sem lembrete recente, "2" duas vezes, "1" depois do início da consulta, texto livre ("sim, mas atraso 10 min"), número que o WhatsApp devolve sem o 9º dígito, mensagem em `@lid`, dois pacientes com o mesmo telefone. Esperado: só o lembrete enviado àquele `jid` nas últimas 26 h, de consulta futura e ativa, muda de estado; repetido não muda de novo nem responde de novo; o resto é ignorado sem gravar o texto. Testes na Tarefa 12.
4. **Consulta mudada depois de o lembrete estar na fila, e o worker caindo no meio do envio.** A nutricionista altera a hora (antes e depois de o lembrete sair), o paciente remarca, o admin suspende e reativa a conta (com os jobs fora de ordem), o worker reinicia entre a chamada à Evolution e a gravação, 100 WhatsApps atrasados de um consultório. Esperado: o lembrete sai para a hora nova (linhas novas; a pendente da hora antiga vira "consulta remarcada"; a enviada nunca é reaberta e continua contando na cota), nada sai para consulta cancelada ou tenant suspenso, um job "suspenso" atrasado não ignora nada depois da reativação, WhatsApp/push nunca saem duas vezes, e o acúmulo de WhatsApp não segura e-mail e push de nenhum tenant. Testes nas Tarefas 5, 10 e 11.
5. **Abuso e privacidade na página pública, no link da consulta e no webhook.** E-mail de outro paciente, cabeçalho `X-Forwarded-For` forjado, 11ª tentativa na hora, código chutado, e-mail com 3 consultas futuras, página desativada, tenant suspenso. Esperado: nenhum dado revelado antes do código (mesma resposta para qualquer e-mail), HTTP 429 a partir da 11ª tentativa pelo IP real (`TRUSTED_PROXIES`), 5 erros de código invalidam o pedido, "Você já tem 3 consultas marcadas…" só depois do código certo; o contexto `publico` lê 0 linhas de notas, anamnese e de toda tabela fora de `PUBLICO_LIBERADO`; paciente arquivado, bloqueado ou anonimizado não age pelo link da consulta ("Conta temporariamente indisponível", nunca 500); o webhook recusa JWT de outra instância, pedido repetido e, em produção, URL que não seja interna. Testes nas Tarefas 3, 7, 8, 9 e 12.
6. **Nunca abrir uma segunda conexão dentro de uma transação.** Dentro de um `withTenant`, nada de chamar função que abre outro `withTenant`/`getDb()` (`horariosLivres`, `escolherHorario`, `buscarTenant`…): o horário e outras leituras são feitos antes e revalidados dentro (pelo `EXCLUDE`, pela trava). Esperado: remarcar pelo paciente conclui com um pool de **uma** conexão. Teste na Tarefa 7.

---

## Estrutura de arquivos

```
drizzle/
  0048_agenda_disponibilidade (gerada) · 0049_rls_agenda_disponibilidade (custom)            # T2
  0050_consultas (gerada) · 0051_rls_consultas (custom: publico negado, RLS, auditoria, EXCLUDE) # T3
  0052_notificacoes (gerada) · 0053_rls_notificacoes (custom)                                   # T5
  0054_agendamento_publico (gerada: pedidos, limites, consents) · 0055_rls_agendamento_publico  # T8
  0056_whatsapp_conexoes (gerada) · 0057_rls_whatsapp_conexoes (custom)                         # T9
  0058_metricas_agenda (custom: admin_tenant_metrics)                                           # T11
  0059_push_subscriptions (gerada) · 0060_rls_push_subscriptions (custom)                       # T13
  0061_atendimento_da_consulta (gerada) · 0062_fk_atendimento_consulta (custom)                 # T15
src/db/schema/agenda.ts                 # T2, T3, T5, T8, T9, T13 — tabelas da agenda e das notificações
src/db/schema/access.ts                 # T8 — consents com patient_id
src/db/schema/pacientes.ts              # T15 — consultations.appointment_id
src/db/tenant.ts (+test)                # T3 — papel 'publico'
src/db/errors.ts (+ db-error.test)      # T3 — exclusionViolation
src/db/rls-guard.ts (+test) · audit-guard.ts  # T2, T3, T5, T8, T9, T13 — STAFF_ONLY, PUBLICO_LIBERADO (T3), AUDIT_EXCEPTIONS, RLS_EXCEPTIONS (consents)
src/env.ts (+test) · .env.example       # T9, T13 — EVOLUTION_*, WHATSAPP_SANDBOX, VAPID_*
src/email/types.ts · templates.tsx (+ render.test)                                  # T5, T6, T8, T9, T11
src/jobs/queues.ts · src/worker/index.ts                                             # T5, T9, T10, T12, T13
src/modules/agenda/
  fuso.ts (+test) · horarios.ts (+test) · constantes.ts                             # T1
  disponibilidade.ts (+test)                                                        # T2
  consultas.ts (+test)                                                              # T3
  link-consulta.ts (+test)                                                          # T5
  aviso-nutri.ts · agendamento-paciente.ts (+test)                                  # T6
  cancelamento.ts (+test) · acoes-link.ts (+test)                                   # T7
  limite-ip.ts (+test) · agendamento-publico.ts (+test)                             # T8 (T12 usa limite-ip para a marca anti-repetição do webhook)
  presenca.ts (+test)                                                               # T15
src/modules/notificacoes/
  tipos.ts · agendar.ts (+test) · mensagens.ts (+test) · enviar.ts (+test)          # T5 (T10, T11, T13 estendem)
  whatsapp/provedor.ts · evolution.ts (+test) · sandbox.ts (+test) · conexao.ts (+test)  # T9
  whatsapp/cota.ts (+test)                                                          # T11
  whatsapp/jwt.ts (+test)                                                          # T9 (chaveDoWebhook), T12 (verificar/assinar)
  whatsapp/respostas.ts (+test) · whatsapp/webhook.ts (+test)                     # T12
  push.ts (+test)                                                                   # T13
src/modules/pacientes/{pacientes,convite-paciente,lgpd,exportacao-job,atendimentos}.ts (+ convite-whatsapp.test)  # T13, T14, T15
src/modules/plataforma/{suspensao,audit,tenant-status}.ts                           # T3, T5, T8 (buscarTenantPorSlug)
src/app/painel/agenda/
  horarios/{page,regra-form,bloqueio-form}.tsx · horarios/actions.ts                 # T2
  periodo.ts (+test) · page.tsx · item-consulta.tsx · consulta-form.tsx · nova/page.tsx · actions.ts  # T4 (T7, T15 estendem actions)
  consultas/[id]/page.tsx · cancelar-form.tsx · presenca.tsx                          # T4, T5, T7, T15
  pendencias/page.tsx                                                                # T15
src/app/painel/whatsapp/{page,conectar,actions}.tsx                                  # T9, T11
src/app/api/painel/whatsapp/estado/route.ts (+test)                                  # T9
src/app/api/webhooks/whatsapp/route.ts (+test)                                       # T12
src/app/consulta/[token]/{page,acoes,actions}.tsx                                    # T7
src/app/n/[slug]/{page,agendar-form}.tsx · src/app/api/n/[slug]/resposta.ts · {codigo,confirmar,horario}/route.ts (+ codigo/route.test)  # T8
src/app/painel/{page,cabecalho}.tsx                                                  # T4, T9, T15
src/app/painel/pacientes/{paciente-form,actions,valores}.tsx · [id]/atendimentos/…  # T14, T15
next.config.ts                                                                       # T7 — no-referrer em /consulta
test/agenda.ts · test/whatsapp.ts · test/isolamento.test.ts                          # T2+, T9, todas
e2e/agenda.spec.ts · e2e/whatsapp.ts                                                 # T2, T4, T7, T8, T9, T12 (e2e/whatsapp.ts nasce na T12)
.github/workflows/ci.yml · package.json · pnpm-lock.yaml                             # T9, T13
CLAUDE.md                                                                            # T3 — regra 2 (contexto publico); T6, T8 — regra 1 (aviso-nutri, consents, public_rate_limits)
```

**Ordem e dependências das tarefas:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15. A Tarefa 1 é pura (sem banco); 2–4 entregam a agenda da nutricionista sem lembretes; 5 liga o motor (só e-mail); 6–8 trazem o paciente; 9–12 o WhatsApp; 13 o push; 14 e 15 fecham os itens que dependem de tudo.

---
### Task 1: Fuso e horários livres — funções puras da agenda (P05-01a)

**Files:**
- Create: `src/modules/agenda/fuso.ts`, `src/modules/agenda/fuso.test.ts`, `src/modules/agenda/horarios.ts`, `src/modules/agenda/horarios.test.ts`, `src/modules/agenda/constantes.ts`

**Interfaces:**
- Consumes: `somarDias`, `hojeNoFuso`, `formatarData` (`@/modules/pacientes/datas`).
- Produces:
  - `@/modules/agenda/fuso`: `type PartesNoFuso = { data: string; hora: string; diaSemana: number; minutos: number }`, `diaDaSemana(data: string): number` (0 = domingo), `partesNoFuso(instante: Date, fuso: string): PartesNoFuso`, `paraInstante(data: string, hora: string, fuso: string): Date | null`, `inicioDoDia(data: string, fuso: string): Date`, `inicioDoMes(instante: Date, fuso: string): Date`, `inicioDoMesSeguinte(instante: Date, fuso: string): Date`, `formatarQuando(instante: Date, fuso: string): string` ("sex., 16/10/2026 às 14:00"), `rotuloDoFuso(fuso: string): string` ("horário de Brasília"), `quandoComFuso(instante: Date, fuso: string): string` ("sex., 16/10/2026 às 14:00 (horário de Brasília)"), `diaCurto(data: string): string` ("sex., 16/10").
  - `@/modules/agenda/horarios`: `type Modalidade = 'presencial' | 'online'`, `type ModalidadeRegra = Modalidade | 'ambas'`, `type Regra = { diaSemana: number; inicio: string; fim: string; duracaoMin: number; modalidade: ModalidadeRegra }`, `type Intervalo = { inicio: Date; fim: Date }`, `type Horario = Intervalo & { modalidades: Modalidade[] }`, `minutosDe(hhmm: string): number`, `sobrepoe(a: Intervalo, b: Intervalo): boolean`, `gerarHorarios(o: { regras: Regra[]; bloqueios: Intervalo[]; ocupados: Intervalo[]; de: Date; ate: Date; fuso: string; online: boolean }): Horario[]`, `dentroDoHorario(i: Intervalo, regras: Regra[], fuso: string): boolean`.
  - `@/modules/agenda/constantes`: `MSG_AGENDA` (textos das Tarefas 2–4, 6–8), `DURACOES = [15, 20, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180, 240]`, `DURACAO_MIN = 15`, `DURACAO_MAX = 240`, `MAX_REGRAS = 30`, `JANELA_PACIENTE_DIAS = 60`, `MAX_CONSULTAS_FUTURAS_PUBLICO = 3`, `DIAS_SEMANA = ['Domingo', …, 'Sábado']`, `ROTULO_MODALIDADE`, `ROTULO_MODALIDADE_REGRA`.

- [ ] **Step 1: Testes do fuso (falham)** — `src/modules/agenda/fuso.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { diaCurto, diaDaSemana, formatarQuando, inicioDoDia, inicioDoMes, inicioDoMesSeguinte, paraInstante, partesNoFuso, quandoComFuso, rotuloDoFuso } from './fuso';

const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';

describe('fuso do tenant (RN-06)', () => {
  it('data + hora de Brasília viram o instante UTC certo, e voltam', () => {
    expect(paraInstante('2026-10-16', '14:00', SP)?.toISOString()).toBe('2026-10-16T17:00:00.000Z');
    expect(partesNoFuso(new Date('2026-10-16T17:00:00Z'), SP)).toEqual({ data: '2026-10-16', hora: '14:00', diaSemana: 5, minutos: 840 });
    // 23:30 de Brasília ainda é o dia 15, embora no UTC já seja 16
    expect(partesNoFuso(new Date('2026-10-16T02:30:00Z'), SP).data).toBe('2026-10-15');
  });

  it('dia da semana pelo calendário, sem depender do fuso do servidor', () => {
    expect([diaDaSemana('2026-10-18'), diaDaSemana('2026-10-20'), diaDaSemana('2026-10-24')]).toEqual([0, 2, 6]);
  });

  it('horário de verão: hora que não existe → null; hora repetida → a primeira; meia-noite que não existe → 01:00', () => {
    expect(paraInstante('2026-03-08', '02:30', NY)).toBeNull();
    expect(paraInstante('2026-11-01', '01:30', NY)?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(paraInstante('2026-07-01', '09:00', NY)?.toISOString()).toBe('2026-07-01T13:00:00.000Z');
    // Brasília teve horário de verão até 2019: 04/11/2018 começou às 01:00
    expect(paraInstante('2018-11-04', '00:00', SP)).toBeNull();
    expect(inicioDoDia('2018-11-04', SP).toISOString()).toBe('2018-11-04T03:00:00.000Z');
  });

  it('virada do mês no fuso (RN-09): 31/10 23:30 em Brasília ainda é outubro', () => {
    expect(inicioDoMes(new Date('2026-11-01T02:30:00Z'), SP).toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(inicioDoMesSeguinte(new Date('2026-11-01T02:30:00Z'), SP).toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(inicioDoMesSeguinte(new Date('2026-12-15T12:00:00Z'), SP).toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('textos: "sex., 16/10/2026 às 14:00 (horário de Brasília)" e "sex., 16/10"', () => {
    const i = new Date('2026-10-16T17:00:00Z');
    expect(formatarQuando(i, SP)).toBe('sex., 16/10/2026 às 14:00');
    expect(rotuloDoFuso(SP)).toBe('horário de Brasília');
    expect(quandoComFuso(i, SP)).toBe('sex., 16/10/2026 às 14:00 (horário de Brasília)');
    expect(diaCurto('2026-10-16')).toBe('sex., 16/10');
    expect(rotuloDoFuso('America/Manaus')).toMatch(/^horário/);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/modules/agenda/fuso.test.ts`
Expected: FAIL ("Failed to resolve import './fuso'").

- [ ] **Step 3: Implementar** — `src/modules/agenda/fuso.ts`

```ts
import { formatarData, somarDias } from '@/modules/pacientes/datas';

/** RN-06: tudo gravado em UTC; calendário e relógio são os do fuso do tenant. Só Intl, sem biblioteca. */
export type PartesNoFuso = { data: string; hora: string; diaSemana: number; minutos: number };

const formatos = new Map<string, Intl.DateTimeFormat>();
function formato(fuso: string): Intl.DateTimeFormat {
  let f = formatos.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    formatos.set(fuso, f);
  }
  return f;
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** Dia da semana de 'AAAA-MM-DD' (0 = domingo … 6 = sábado), sem depender do fuso do servidor. */
export function diaDaSemana(data: string): number {
  const [a, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

/** Data, hora, dia da semana e minutos desde 00:00 de um instante, no fuso. */
export function partesNoFuso(instante: Date, fuso: string): PartesNoFuso {
  const v: Record<string, number> = {};
  for (const p of formato(fuso).formatToParts(instante)) if (p.type !== 'literal') v[p.type] = Number(p.value);
  const data = `${v.year}-${p2(v.month)}-${p2(v.day)}`;
  return { data, hora: `${p2(v.hour)}:${p2(v.minute)}`, diaSemana: diaDaSemana(data), minutos: v.hour * 60 + v.minute };
}

/** Diferença (ms) entre o relógio do fuso e o UTC naquele instante. */
function deslocamento(instante: number, fuso: string): number {
  const p = partesNoFuso(new Date(instante), fuso);
  const [a, m, d] = p.data.split('-').map(Number);
  return Date.UTC(a, m - 1, d, Math.floor(p.minutos / 60), p.minutos % 60) - Math.floor(instante / 60_000) * 60_000;
}

/**
 * D8: instante da data + hora locais no fuso. Hora que não existe (adiantamento do horário de verão) → null;
 * hora que se repete (fim do horário de verão) → a primeira. Os deslocamentos de 1 dia antes e depois
 * cobrem os dois lados de qualquer mudança de horário.
 */
export function paraInstante(data: string, hora: string, fuso: string): Date | null {
  const [a, m, d] = data.split('-').map(Number);
  const [h, mi] = hora.split(':').map(Number);
  const alvo = Date.UTC(a, m - 1, d, h, mi);
  const validos = [alvo - deslocamento(alvo - 86_400_000, fuso), alvo - deslocamento(alvo + 86_400_000, fuso)].filter((t) => {
    const p = partesNoFuso(new Date(t), fuso);
    return p.data === data && p.hora === `${p2(h)}:${p2(mi)}`;
  });
  return validos.length ? new Date(Math.min(...validos)) : null;
}

/** 00:00 do dia no fuso (meia-noite que não existe no horário de verão → 01:00). */
export function inicioDoDia(data: string, fuso: string): Date {
  return paraInstante(data, '00:00', fuso) ?? paraInstante(data, '01:00', fuso)!;
}

/** 00:00 do dia 1º do mês de `instante` no fuso (RN-09: mês civil do tenant). */
export function inicioDoMes(instante: Date, fuso: string): Date {
  return inicioDoDia(`${partesNoFuso(instante, fuso).data.slice(0, 8)}01`, fuso);
}

/** 00:00 do dia 1º do mês seguinte ao de `instante`, no fuso. */
export function inicioDoMesSeguinte(instante: Date, fuso: string): Date {
  const [a, m] = partesNoFuso(instante, fuso).data.split('-').map(Number);
  return inicioDoDia(m === 12 ? `${a + 1}-01-01` : `${a}-${p2(m + 1)}-01`, fuso);
}

const DIAS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

/** "sex., 16/10" (cabeçalho da agenda). */
export function diaCurto(data: string): string {
  return `${DIAS[diaDaSemana(data)]}, ${formatarData(data).slice(0, 5)}`;
}

/** "sex., 16/10/2026 às 14:00" no fuso (RNF-12). */
export function formatarQuando(instante: Date, fuso: string): string {
  const p = partesNoFuso(instante, fuso);
  return `${DIAS[p.diaSemana]}, ${formatarData(p.data)} às ${p.hora}`;
}

/** RN-06: "horário de Brasília" em America/Sao_Paulo; nos outros fusos, o nome longo do Intl em minúscula. */
export function rotuloDoFuso(fuso: string): string {
  if (fuso === 'America/Sao_Paulo') return 'horário de Brasília';
  const nome = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, timeZoneName: 'long' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
  return nome ? nome.charAt(0).toLowerCase() + nome.slice(1) : fuso;
}

/** Mensagens ao paciente (e-mail, WhatsApp, push): sempre com a sigla do fuso, porque o aparelho pode estar em outro. */
export function quandoComFuso(instante: Date, fuso: string): string {
  return `${formatarQuando(instante, fuso)} (${rotuloDoFuso(fuso)})`;
}

export { somarDias };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm test src/modules/agenda/fuso.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Constantes da agenda** — `src/modules/agenda/constantes.ts`

```ts
import type { Modalidade, ModalidadeRegra } from './horarios';

export const DURACAO_MIN = 15;
export const DURACAO_MAX = 240;
export const DURACOES = [15, 20, 30, 40, 45, 50, 60, 75, 90, 120, 150, 180, 240] as const;
export const MAX_REGRAS = 30;
/** RN-03: o paciente marca até 60 dias à frente. */
export const JANELA_PACIENTE_DIAS = 60;
/** RN-16: no máximo 3 consultas futuras por e-mail no tenant (página pública). */
export const MAX_CONSULTAS_FUTURAS_PUBLICO = 3;
export const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'] as const;
export const ROTULO_MODALIDADE: Record<Modalidade, string> = { presencial: 'Presencial', online: 'Online' };
export const ROTULO_MODALIDADE_REGRA: Record<ModalidadeRegra, string> = { presencial: 'Presencial', online: 'Online', ambas: 'Presencial ou online' };

export const MSG_AGENDA = {
  // US-030 (regras e bloqueios)
  fimAntesDoInicio: 'O fim deve ser depois do início',
  horaInvalida: 'Informe um horário válido (HH:MM)',
  duracao: 'A duração deve ser de 15 a 240 minutos',
  naoCabe: 'O horário precisa caber pelo menos uma consulta',
  sobreposicao: 'Este horário se sobrepõe a outro do mesmo dia.',
  diaSemana: 'Escolha o dia da semana',
  modalidade: 'Escolha a modalidade',
  limiteRegras: 'Limite de 30 horários de atendimento.',
  dataInvalida: 'Informe uma data válida',
  dataFinalAntes: 'A data final deve ser igual ou posterior à inicial',
  bloqueioLongo: 'O bloqueio pode ter no máximo 366 dias',
  motivoLongo: 'Use no máximo 120 caracteres',
  // US-031 (consulta pela nutricionista)
  pacienteObrigatorio: 'Selecione o paciente',
  pacienteArquivado: 'Paciente arquivado: desarquive para agendar.',
  horaInexistente: 'Este horário não existe neste dia (mudança de horário de verão).',
  linkObrigatorio: 'Informe o link da chamada (https://…)',
  conflito: (nome: string, hora: string) => `Conflito com a consulta de ${nome} às ${hora}`,
  foraDoHorario: 'Fora do seu horário de atendimento',
  dentroDeBloqueio: 'Consulta dentro de um bloqueio',
  naoEncontrada: 'Consulta não encontrada.',
  naoAlteravel: 'Só dá para alterar consulta agendada ou confirmada.',
  marcada: 'Consulta marcada.',
  alterada: 'Consulta alterada.',
  // US-032 / US-033 (paciente)
  ocupado: 'Esse horário acabou de ser ocupado. Escolha outro.',
  indisponivel: 'Esse horário não está mais disponível. Escolha outro.',
  foraDoPrazo: 'Para alterar, fale com sua nutricionista.',
  naoCancelavel: 'Esta consulta não pode mais ser cancelada.',
  cancelada: 'Consulta cancelada.',
  limitePublico: 'Você já tem 3 consultas marcadas. Fale com sua nutricionista.',
  semHorarios: 'Nenhum horário livre nos próximos 60 dias. Fale com sua nutricionista.',
  naoAgendavel: 'Não foi possível agendar por aqui. Fale com sua nutricionista.',
  contaIndisponivel: 'Conta temporariamente indisponível',
  // US-033 / US-035 (link da consulta)
  presencaConfirmada: 'Presença confirmada. Até lá!',
  remarcada: (quando: string) => `Consulta remarcada para ${quando}.`,
  linkExpirado: 'Este link expirou.',
  linkInvalido: 'Link inválido.',
  consultaJaCancelada: 'Esta consulta foi cancelada.',
} as const;
```

- [ ] **Step 6: Testes do gerador de horários (falham)** — `src/modules/agenda/horarios.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { paraInstante, partesNoFuso } from './fuso';
import { dentroDoHorario, gerarHorarios, type Regra } from './horarios';

const SP = 'America/Sao_Paulo';
const em = (data: string, hora: string) => paraInstante(data, hora, SP)!;
const rotulos = (hs: { inicio: Date }[]) => hs.map((h) => { const p = partesNoFuso(h.inicio, SP); return `${p.data} ${p.hora}`; });
const TERCA: Regra = { diaSemana: 2, inicio: '08:00', fim: '12:00', duracaoMin: 60, modalidade: 'presencial' };
const semana = { de: em('2026-10-19', '00:00'), ate: em('2026-10-26', '00:00'), fuso: SP };

describe('gerarHorarios (RN-03, US-030)', () => {
  it('"terça, 08:00–12:00, 60 min, presencial" → 08:00, 09:00, 10:00 e 11:00', () => {
    const hs = gerarHorarios({ regras: [TERCA], bloqueios: [], ocupados: [], ...semana, online: false });
    expect(rotulos(hs)).toEqual(['2026-10-20 08:00', '2026-10-20 09:00', '2026-10-20 10:00', '2026-10-20 11:00']);
    expect(hs[0].modalidades).toEqual(['presencial']);
    expect(hs[0].fim.getTime() - hs[0].inicio.getTime()).toBe(60 * 60_000);
  });

  it('bloqueio de 20/10 a 24/10 ("Congresso") tira todos os horários desses dias', () => {
    const bloqueio = { inicio: em('2026-10-20', '00:00'), fim: em('2026-10-25', '00:00') };
    expect(gerarHorarios({ regras: [TERCA], bloqueios: [bloqueio], ocupados: [], ...semana, online: false })).toEqual([]);
  });

  it('consulta não cancelada ocupa o horário, inclusive em parte (09:30–10:30 tira 09:00 e 10:00)', () => {
    const ocupado = { inicio: em('2026-10-20', '09:30'), fim: em('2026-10-20', '10:30') };
    expect(rotulos(gerarHorarios({ regras: [TERCA], bloqueios: [], ocupados: [ocupado], ...semana, online: false }))).toEqual(['2026-10-20 08:00', '2026-10-20 11:00']);
  });

  it('US-032: às 10:00 de 14/10, com antecedência de 12 h, o primeiro horário é 22:00 de 14/10; nada depois de 60 dias', () => {
    const quarta: Regra = { diaSemana: 3, inicio: '08:00', fim: '23:00', duracaoMin: 60, modalidade: 'ambas' };
    const agora = em('2026-10-14', '10:00');
    const hs = gerarHorarios({ regras: [quarta], bloqueios: [], ocupados: [], de: new Date(agora.getTime() + 12 * 3_600_000), ate: new Date(agora.getTime() + 60 * 86_400_000), fuso: SP, online: false });
    expect(rotulos(hs)[0]).toBe('2026-10-14 22:00');
    expect(partesNoFuso(hs.at(-1)!.inicio, SP).data).toBe('2026-12-09');
    expect(hs[0].modalidades).toEqual(['presencial']); // sem link padrão, "ambas" só oferece presencial (US-031)
  });

  it('regra só online sem link padrão não oferece nada; com link, oferece', () => {
    const online: Regra = { diaSemana: 2, inicio: '08:00', fim: '10:00', duracaoMin: 30, modalidade: 'online' };
    expect(gerarHorarios({ regras: [online], bloqueios: [], ocupados: [], ...semana, online: false })).toEqual([]);
    expect(gerarHorarios({ regras: [online], bloqueios: [], ocupados: [], ...semana, online: true }).map((h) => h.modalidades)).toEqual([['online'], ['online'], ['online'], ['online']]);
  });

  it('horário de verão: a hora que não existe é pulada', () => {
    const NY = 'America/New_York';
    const domingo: Regra = { diaSemana: 0, inicio: '01:00', fim: '04:00', duracaoMin: 60, modalidade: 'presencial' };
    const hs = gerarHorarios({ regras: [domingo], bloqueios: [], ocupados: [], de: paraInstante('2026-03-08', '00:00', NY)!, ate: paraInstante('2026-03-09', '00:00', NY)!, fuso: NY, online: false });
    expect(hs.map((h) => partesNoFuso(h.inicio, NY).hora)).toEqual(['01:00', '03:00']);
  });

  it('dentroDoHorario: 09:00–10:00 de terça cabe na regra; 12:00–13:00 e quarta não (aviso "Fora do seu horário de atendimento")', () => {
    expect(dentroDoHorario({ inicio: em('2026-10-20', '09:00'), fim: em('2026-10-20', '10:00') }, [TERCA], SP)).toBe(true);
    expect(dentroDoHorario({ inicio: em('2026-10-20', '11:30'), fim: em('2026-10-20', '12:30') }, [TERCA], SP)).toBe(false);
    expect(dentroDoHorario({ inicio: em('2026-10-21', '09:00'), fim: em('2026-10-21', '10:00') }, [TERCA], SP)).toBe(false);
  });
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `pnpm test src/modules/agenda/horarios.test.ts`
Expected: FAIL ("Failed to resolve import './horarios'").

- [ ] **Step 8: Implementar** — `src/modules/agenda/horarios.ts`

```ts
import { diaDaSemana, paraInstante, partesNoFuso, somarDias } from './fuso';

export type Modalidade = 'presencial' | 'online';
export type ModalidadeRegra = Modalidade | 'ambas';
/** Regra de atendimento (US-030): horários de `inicio`/`fim` como 'HH:MM' no fuso do tenant. */
export type Regra = { diaSemana: number; inicio: string; fim: string; duracaoMin: number; modalidade: ModalidadeRegra };
export type Intervalo = { inicio: Date; fim: Date };
export type Horario = Intervalo & { modalidades: Modalidade[] };

export const minutosDe = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Intervalos semiabertos [inicio, fim): encostar não é sobrepor (como o `tstzrange '[)'` do EXCLUDE). */
export const sobrepoe = (a: Intervalo, b: Intervalo) => a.inicio.getTime() < b.fim.getTime() && b.inicio.getTime() < a.fim.getTime();

function modalidadesDa(regra: ModalidadeRegra, online: boolean): Modalidade[] {
  if (regra === 'presencial') return ['presencial'];
  if (regra === 'online') return online ? ['online'] : [];
  return online ? ['presencial', 'online'] : ['presencial'];
}

/**
 * RN-03: horários livres = regras de atendimento − bloqueios − consultas não canceladas, com início em
 * [de, ate). Cada regra gera horários de `duracaoMin` a partir do início, enquanto couberem até o fim.
 * Hora local que não existe (horário de verão) é pulada (D8). `online = false` (sem link padrão): nada
 * online para o paciente (US-031).
 */
export function gerarHorarios(o: { regras: Regra[]; bloqueios: Intervalo[]; ocupados: Intervalo[]; de: Date; ate: Date; fuso: string; online: boolean }): Horario[] {
  if (o.ate.getTime() <= o.de.getTime()) return [];
  const fora = [...o.bloqueios, ...o.ocupados];
  const saida: Horario[] = [];
  const ultimo = partesNoFuso(o.ate, o.fuso).data;
  for (let dia = partesNoFuso(o.de, o.fuso).data; dia <= ultimo; dia = somarDias(dia, 1)) {
    const semana = diaDaSemana(dia);
    for (const r of o.regras) {
      if (r.diaSemana !== semana) continue;
      const modalidades = modalidadesDa(r.modalidade, o.online);
      if (!modalidades.length) continue;
      for (let m = minutosDe(r.inicio); m + r.duracaoMin <= minutosDe(r.fim); m += r.duracaoMin) {
        const inicio = paraInstante(dia, hhmm(m), o.fuso);
        if (!inicio || inicio.getTime() < o.de.getTime() || inicio.getTime() >= o.ate.getTime()) continue;
        const h: Horario = { inicio, fim: new Date(inicio.getTime() + r.duracaoMin * 60_000), modalidades };
        if (!fora.some((x) => sobrepoe(h, x))) saida.push(h);
      }
    }
  }
  return saida.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

/** US-031 "Fora do horário de atendimento": o intervalo inteiro cabe numa regra do mesmo dia local. */
export function dentroDoHorario(i: Intervalo, regras: Regra[], fuso: string): boolean {
  const a = partesNoFuso(i.inicio, fuso);
  const b = partesNoFuso(i.fim, fuso);
  const fimMin = b.data === a.data ? b.minutos : b.data === somarDias(a.data, 1) && b.minutos === 0 ? 24 * 60 : -1;
  return regras.some((r) => r.diaSemana === a.diaSemana && minutosDe(r.inicio) <= a.minutos && fimMin > a.minutos && fimMin <= minutosDe(r.fim));
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `pnpm test src/modules/agenda`
Expected: PASS (12 testes).

- [ ] **Step 10: Commit**

```bash
git add src/modules/agenda/fuso.ts src/modules/agenda/fuso.test.ts src/modules/agenda/horarios.ts src/modules/agenda/horarios.test.ts src/modules/agenda/constantes.ts
git commit -m "feat(agenda): fuso do tenant e gerador de horários livres (RN-03, RN-06)"
```

---
### Task 2: Horários de atendimento e bloqueios — tabelas, regras e tela (P05-01b)

**Files:**
- Create: `src/db/schema/agenda.ts`, `drizzle/0048_agenda_disponibilidade.sql` (gerada), `drizzle/0049_rls_agenda_disponibilidade.sql` (custom), `src/modules/agenda/disponibilidade.ts`, `src/modules/agenda/disponibilidade.test.ts`, `src/app/painel/agenda/horarios/page.tsx`, `src/app/painel/agenda/horarios/actions.ts`, `src/app/painel/agenda/horarios/regra-form.tsx`, `src/app/painel/agenda/horarios/bloqueio-form.tsx`, `e2e/agenda.spec.ts`
- Modify: `src/db/schema/index.ts`, `src/db/rls-guard.ts` (`STAFF_ONLY`), `test/isolamento.test.ts`, `scripts/e2e-seed.ts`

**Interfaces:**
- Consumes: `withTenant`, `TenantContext`, `Tx`, `Db`, `getDb`; `normalizarTexto` (`@/lib/text`); `idValido` (`@/modules/pacientes/base`); `dataValida` (`@/modules/pacientes/datas`); `MSG_AGENDA`, `MAX_REGRAS`, `DURACAO_MIN`, `DURACAO_MAX`, `DURACOES`, `DIAS_SEMANA`, `ROTULO_MODALIDADE_REGRA` (Tarefa 1); `paraInstante`, `inicioDoDia`, `somarDias`, `formatarQuando` (Tarefa 1); `minutosDe`, `type Regra`, `type Intervalo`, `type ModalidadeRegra` (Tarefa 1); `requireNutri`; `Campo`, `ConfirmarBotao`; `Cabecalho`.
- Produces:
  - Schema: `availabilityRules` 🔒 staff_only, `availabilityBlocks` 🔒 staff_only.
  - `@/modules/agenda/disponibilidade`: `type RegraSalva = Regra & { id: string }`, `type BloqueioSalvo = Intervalo & { id: string; motivo: string }`, `class DisponibilidadeError { erros: Record<string, string> }`, `validarRegra(input: Record<string, unknown>): Regra`, `lerRegras(tx: Tx): Promise<RegraSalva[]>`, `lerBloqueios(tx: Tx, de: Date, ate: Date): Promise<BloqueioSalvo[]>`, `listarRegras(ctx, db?)`, `criarRegra(ctx, input, deps?): Promise<string>`, `excluirRegra(ctx, id, db?): Promise<void>`, `listarBloqueios(ctx, de: Date, ate: Date, db?)`, `criarBloqueio(ctx, tenant: { fuso: string }, input, deps?): Promise<string>`, `excluirBloqueio(ctx, id, db?): Promise<void>`.
  - Página `/painel/agenda/horarios`.
  - `e2e/agenda.spec.ts` (estendido nas Tarefas 4, 7, 8, 9 e 12); seed E2E com a lista `AGENDA_E2E` das tabelas da agenda a esvaziar no consultório do E2E (as tarefas seguintes acrescentam as delas, filhas antes das mães).

- [ ] **Step 1: Tabelas** — `src/db/schema/agenda.ts`

```ts
import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './platform';

/** US-030: horários de atendimento por dia da semana (0 = domingo), em 'HH:MM' no fuso do tenant. O paciente não vê (staff_only, D11). */
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    diaSemana: smallint('dia_semana').notNull(),
    inicio: time('inicio').notNull(),
    fim: time('fim').notNull(),
    duracaoMin: smallint('duracao_min').notNull(),
    modalidade: text('modalidade').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('availability_rules_dia_valido', sql`${t.diaSemana} between 0 and 6`),
    check('availability_rules_fim_depois', sql`${t.fim} > ${t.inicio}`),
    check('availability_rules_duracao_faixa', sql`${t.duracaoMin} between 15 and 240`),
    check('availability_rules_modalidade_valida', sql`${t.modalidade} in ('presencial', 'online', 'ambas')`),
    index('availability_rules_dia_idx').on(t.tenantId, t.diaSemana),
  ],
);

/** US-030: bloqueios (férias, congresso). O motivo pode ser pessoal: o paciente não vê (staff_only). */
export const availabilityBlocks = pgTable(
  'availability_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    inicio: timestamp('inicio', { withTimezone: true }).notNull(),
    fim: timestamp('fim', { withTimezone: true }).notNull(),
    motivo: text('motivo').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('availability_blocks_fim_depois', sql`${t.fim} > ${t.inicio}`),
    check('availability_blocks_motivo_tamanho', sql`char_length(${t.motivo}) <= 120`),
    index('availability_blocks_periodo_idx').on(t.tenantId, t.inicio),
  ],
);
```

Em `src/db/schema/index.ts`: `export * from './agenda';`.

Run: `pnpm db:generate --name agenda_disponibilidade` → `drizzle/0048_agenda_disponibilidade.sql` (confira as 2 tabelas, os 6 CHECKs e os 2 índices).

Run: `pnpm drizzle-kit generate --custom --name rls_agenda_disponibilidade` e preencher `drizzle/0049_rls_agenda_disponibilidade.sql`:

```sql
SELECT app_enable_tenant_rls('availability_rules');
--> statement-breakpoint
SELECT app_enable_staff_only('availability_rules');
--> statement-breakpoint
SELECT app_enable_tenant_rls('availability_blocks');
--> statement-breakpoint
SELECT app_enable_staff_only('availability_blocks');
```

Em `src/db/rls-guard.ts`, no `STAFF_ONLY`:

```ts
  availability_rules: 'US-030 / D11: o paciente só recebe horários livres já calculados, nunca as regras',
  availability_blocks: 'US-030 / D11: o motivo do bloqueio pode ser pessoal ("Médico")',
```

`test/isolamento.test.ts`, no `FABRICAS`:

```ts
  availability_rules: (t) =>
    sql`insert into availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade) values (${t}, 2, '08:00', '12:00', 60, 'presencial')`,
  availability_blocks: (t) =>
    sql`insert into availability_blocks (tenant_id, inicio, fim, motivo) values (${t}, '2030-01-01T03:00:00Z', '2030-01-02T03:00:00Z', 'Iso')`,
```

Run: `pnpm test src/db test/isolamento.test.ts`
Expected: PASS (guarda de RLS, `staff_only` e a matriz de isolamento aceitam as 2 tabelas).

- [ ] **Step 2: Testes das regras e bloqueios (falham)** — `src/modules/agenda/disponibilidade.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { availabilityRules } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { MSG_AGENDA } from './constantes';
import { criarBloqueio, criarRegra, DisponibilidadeError, excluirBloqueio, excluirRegra, listarBloqueios, listarRegras } from './disponibilidade';
import { paraInstante } from './fuso';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db };
const SP = 'America/Sao_Paulo';
const TERCA = { diaSemana: '2', inicio: '08:00', fim: '12:00', duracaoMin: '60', modalidade: 'presencial' };

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof DisponibilidadeError) return e.erros;
    throw e;
  }
  throw new Error('esperava DisponibilidadeError');
};

describe('horários de atendimento (US-030)', () => {
  it('cria e lista em ordem de dia e hora; exclui', async () => {
    const T = await novoTenant(app.db);
    await criarRegra(T.ctx, { ...TERCA, diaSemana: '4' }, deps);
    const id = await criarRegra(T.ctx, TERCA, deps);
    expect((await listarRegras(T.ctx, app.db)).map((r) => [r.diaSemana, r.inicio, r.fim, r.duracaoMin, r.modalidade])).toEqual([
      [2, '08:00', '12:00', 60, 'presencial'],
      [4, '08:00', '12:00', 60, 'presencial'],
    ]);
    await excluirRegra(T.ctx, id, app.db);
    expect(await listarRegras(T.ctx, app.db)).toHaveLength(1);
  });

  it('"O fim deve ser depois do início" (início 12:00, fim 08:00); hora inválida; duração fora da faixa; não cabe', async () => {
    const T = await novoTenant(app.db);
    expect(await erros(criarRegra(T.ctx, { ...TERCA, inicio: '12:00', fim: '08:00' }, deps))).toEqual({ fim: MSG_AGENDA.fimAntesDoInicio });
    expect(await erros(criarRegra(T.ctx, { ...TERCA, inicio: '25:00' }, deps))).toMatchObject({ inicio: MSG_AGENDA.horaInvalida });
    expect(await erros(criarRegra(T.ctx, { ...TERCA, duracaoMin: '10' }, deps))).toEqual({ duracaoMin: MSG_AGENDA.duracao });
    expect(await erros(criarRegra(T.ctx, { ...TERCA, fim: '08:30' }, deps))).toEqual({ duracaoMin: MSG_AGENDA.naoCabe });
    expect(await erros(criarRegra(T.ctx, { ...TERCA, diaSemana: '7', modalidade: 'x' }, deps))).toEqual({ diaSemana: MSG_AGENDA.diaSemana, modalidade: MSG_AGENDA.modalidade });
  });

  it('não sobrepõe outra regra do mesmo dia (encostar pode); outro dia pode', async () => {
    const T = await novoTenant(app.db);
    await criarRegra(T.ctx, TERCA, deps);
    expect(await erros(criarRegra(T.ctx, { ...TERCA, inicio: '11:00', fim: '13:00' }, deps))).toEqual({ inicio: MSG_AGENDA.sobreposicao });
    await expect(criarRegra(T.ctx, { ...TERCA, inicio: '12:00', fim: '14:00' }, deps)).resolves.toBeTypeOf('string');
    await expect(criarRegra(T.ctx, { ...TERCA, diaSemana: '3' }, deps)).resolves.toBeTypeOf('string');
  });

  it('a sessão de paciente não vê nem grava regras (staff_only, D11)', async () => {
    const T = await novoTenant(app.db);
    await criarRegra(T.ctx, TERCA, deps);
    const p = await novoPaciente(app.db, T.ctx);
    const vistas = await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.select().from(availabilityRules), app.db);
    expect(vistas).toEqual([]);
  });
});

describe('bloqueios (US-030)', () => {
  it('"de 20/10/2026 a 24/10/2026, Congresso" cobre os dias inteiros no fuso do tenant', async () => {
    const T = await novoTenant(app.db);
    await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-20', dataFim: '2026-10-24', motivo: '  Congresso  ' }, deps);
    const [b] = await listarBloqueios(T.ctx, paraInstante('2026-10-01', '00:00', SP)!, paraInstante('2026-11-01', '00:00', SP)!, app.db);
    expect(b).toMatchObject({ motivo: 'Congresso', inicio: paraInstante('2026-10-20', '00:00', SP), fim: paraInstante('2026-10-25', '00:00', SP) });
  });

  it('com horas: 16/10 das 14:00 às 18:00; data final antes da inicial; mais de 366 dias; motivo longo', async () => {
    const T = await novoTenant(app.db);
    const id = await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-16', horaInicio: '14:00', dataFim: '2026-10-16', horaFim: '18:00', motivo: '' }, deps);
    const [b] = await listarBloqueios(T.ctx, paraInstante('2026-10-16', '00:00', SP)!, paraInstante('2026-10-17', '00:00', SP)!, app.db);
    expect([b.inicio.toISOString(), b.fim.toISOString()]).toEqual(['2026-10-16T17:00:00.000Z', '2026-10-16T21:00:00.000Z']);
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-20', dataFim: '2026-10-19' }, deps))).toEqual({ dataFim: MSG_AGENDA.dataFinalAntes });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-01-01', dataFim: '2027-01-02' }, deps))).toEqual({ dataFim: MSG_AGENDA.bloqueioLongo });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-20', motivo: 'x'.repeat(121) }, deps))).toEqual({ motivo: MSG_AGENDA.motivoLongo });
    expect(await erros(criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-02-30' }, deps))).toEqual({ dataInicio: MSG_AGENDA.dataInvalida });
    await excluirBloqueio(T.ctx, id, app.db);
    await expect(excluirBloqueio(T.ctx, 'nao-e-uuid', app.db)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test src/modules/agenda/disponibilidade.test.ts`
Expected: FAIL ("Failed to resolve import './disponibilidade'").

- [ ] **Step 4: Implementar** — `src/modules/agenda/disponibilidade.ts`

```ts
import { and, asc, eq, gt, lt, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { availabilityBlocks, availabilityRules } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { normalizarTexto } from '@/lib/text';
import { idValido } from '@/modules/pacientes/base';
import { dataValida } from '@/modules/pacientes/datas';
import { DURACAO_MAX, DURACAO_MIN, MAX_REGRAS, MSG_AGENDA } from './constantes';
import { inicioDoDia, paraInstante, somarDias } from './fuso';
import { minutosDe, type Intervalo, type ModalidadeRegra, type Regra } from './horarios';

export type RegraSalva = Regra & { id: string };
export type BloqueioSalvo = Intervalo & { id: string; motivo: string };

export class DisponibilidadeError extends Error {
  override name = 'DisponibilidadeError';
  constructor(readonly erros: Record<string, string>) {
    super('Disponibilidade inválida');
  }
}

type Deps = { db?: Db; now?: Date };
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const MODALIDADES_REGRA: readonly string[] = ['presencial', 'online', 'ambas'];
const BLOQUEIO_MAX_MS = 366 * 86_400_000;
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Regras do tenant, na transação já com o contexto: tela, aviso "fora do horário" e horários livres. */
export async function lerRegras(tx: Tx): Promise<RegraSalva[]> {
  const rs = await tx.select().from(availabilityRules).orderBy(asc(availabilityRules.diaSemana), asc(availabilityRules.inicio));
  return rs.map((r) => ({ id: r.id, diaSemana: r.diaSemana, inicio: r.inicio.slice(0, 5), fim: r.fim.slice(0, 5), duracaoMin: r.duracaoMin, modalidade: r.modalidade as ModalidadeRegra }));
}

/** Bloqueios que tocam [de, ate). */
export async function lerBloqueios(tx: Tx, de: Date, ate: Date): Promise<BloqueioSalvo[]> {
  const bs = await tx.select().from(availabilityBlocks).where(and(lt(availabilityBlocks.inicio, ate), gt(availabilityBlocks.fim, de))).orderBy(asc(availabilityBlocks.inicio));
  return bs.map((b) => ({ id: b.id, inicio: b.inicio, fim: b.fim, motivo: b.motivo }));
}

export function listarRegras(ctx: TenantContext, db: Db = getDb()): Promise<RegraSalva[]> {
  return withTenant(ctx, lerRegras, db);
}

export function listarBloqueios(ctx: TenantContext, de: Date, ate: Date, db: Db = getDb()): Promise<BloqueioSalvo[]> {
  return withTenant(ctx, (tx) => lerBloqueios(tx, de, ate), db);
}

/** US-030 "Regra inválida" e demais limites; dia e números chegam como texto do formulário. */
export function validarRegra(input: Record<string, unknown>): Regra {
  const erros: Record<string, string> = {};
  const dia = String(input.diaSemana ?? '');
  if (!/^[0-6]$/.test(dia)) erros.diaSemana = MSG_AGENDA.diaSemana;
  const inicio = texto(input.inicio);
  const fim = texto(input.fim);
  if (!HORA.test(inicio)) erros.inicio = MSG_AGENDA.horaInvalida;
  if (!HORA.test(fim)) erros.fim = MSG_AGENDA.horaInvalida;
  else if (HORA.test(inicio) && minutosDe(fim) <= minutosDe(inicio)) erros.fim = MSG_AGENDA.fimAntesDoInicio;
  const duracao = Number(texto(String(input.duracaoMin ?? '')));
  if (!Number.isInteger(duracao) || duracao < DURACAO_MIN || duracao > DURACAO_MAX) erros.duracaoMin = MSG_AGENDA.duracao;
  else if (!erros.inicio && !erros.fim && minutosDe(fim) - minutosDe(inicio) < duracao) erros.duracaoMin = MSG_AGENDA.naoCabe;
  const modalidade = String(input.modalidade ?? '');
  if (!MODALIDADES_REGRA.includes(modalidade)) erros.modalidade = MSG_AGENDA.modalidade;
  if (Object.keys(erros).length) throw new DisponibilidadeError(erros);
  return { diaSemana: Number(dia), inicio, fim, duracaoMin: duracao, modalidade: modalidade as ModalidadeRegra };
}

export async function criarRegra(ctx: TenantContext, input: Record<string, unknown>, deps: Deps = {}): Promise<string> {
  const r = validarRegra(input);
  const now = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      // Uma gravação de regra por vez no tenant: a checagem de sobreposição não pode correr com outra
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agenda-regras'), hashtext(${ctx.tenantId}))`);
      const atuais = await lerRegras(tx);
      if (atuais.length >= MAX_REGRAS) throw new DisponibilidadeError({ geral: MSG_AGENDA.limiteRegras });
      const choca = atuais.some((x) => x.diaSemana === r.diaSemana && minutosDe(x.inicio) < minutosDe(r.fim) && minutosDe(r.inicio) < minutosDe(x.fim));
      if (choca) throw new DisponibilidadeError({ inicio: MSG_AGENDA.sobreposicao });
      const [n] = await tx.insert(availabilityRules).values({ tenantId: ctx.tenantId, ...r, createdAt: now, updatedAt: now }).returning({ id: availabilityRules.id });
      return n.id;
    },
    deps.db ?? getDb(),
  );
}

export async function excluirRegra(ctx: TenantContext, id: string, db: Db = getDb()): Promise<void> {
  if (!idValido(id)) return;
  await withTenant(ctx, (tx) => tx.delete(availabilityRules).where(eq(availabilityRules.id, id)), db);
}

/**
 * Sem hora: dias inteiros no fuso do tenant (00:00 do primeiro dia até 00:00 do dia seguinte ao último).
 * Com hora: o intervalo exato. Hora que não existe no dia (horário de verão) é recusada (D8).
 */
export async function criarBloqueio(ctx: TenantContext, tenant: { fuso: string }, input: Record<string, unknown>, deps: Deps = {}): Promise<string> {
  const erros: Record<string, string> = {};
  const dataInicio = texto(input.dataInicio);
  const dataFimInformada = texto(input.dataFim);
  const dataFim = dataFimInformada || dataInicio;
  const horaInicio = texto(input.horaInicio);
  const horaFim = texto(input.horaFim);
  const motivo = normalizarTexto(input.motivo);
  if (!dataValida(dataInicio)) erros.dataInicio = MSG_AGENDA.dataInvalida;
  if (dataFimInformada && !dataValida(dataFimInformada)) erros.dataFim = MSG_AGENDA.dataInvalida;
  if (horaInicio && !HORA.test(horaInicio)) erros.horaInicio = MSG_AGENDA.horaInvalida;
  if (horaFim && !HORA.test(horaFim)) erros.horaFim = MSG_AGENDA.horaInvalida;
  if (motivo.length > 120) erros.motivo = MSG_AGENDA.motivoLongo;
  let inicio: Date | null = null;
  let fim: Date | null = null;
  if (!erros.dataInicio && !erros.dataFim && !erros.horaInicio && !erros.horaFim) {
    inicio = horaInicio ? paraInstante(dataInicio, horaInicio, tenant.fuso) : inicioDoDia(dataInicio, tenant.fuso);
    fim = horaFim ? paraInstante(dataFim, horaFim, tenant.fuso) : inicioDoDia(somarDias(dataFim, 1), tenant.fuso);
    if (!inicio) erros.horaInicio = MSG_AGENDA.horaInexistente;
    if (!fim) erros.horaFim = MSG_AGENDA.horaInexistente;
    if (inicio && fim && fim.getTime() <= inicio.getTime()) erros.dataFim = MSG_AGENDA.dataFinalAntes;
    else if (inicio && fim && fim.getTime() - inicio.getTime() > BLOQUEIO_MAX_MS) erros.dataFim = MSG_AGENDA.bloqueioLongo;
  }
  if (Object.keys(erros).length) throw new DisponibilidadeError(erros);
  const now = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      const [b] = await tx.insert(availabilityBlocks).values({ tenantId: ctx.tenantId, inicio: inicio!, fim: fim!, motivo, createdAt: now }).returning({ id: availabilityBlocks.id });
      return b.id;
    },
    deps.db ?? getDb(),
  );
}

export async function excluirBloqueio(ctx: TenantContext, id: string, db: Db = getDb()): Promise<void> {
  if (!idValido(id)) return;
  await withTenant(ctx, (tx) => tx.delete(availabilityBlocks).where(eq(availabilityBlocks.id, id)), db);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm test src/modules/agenda/disponibilidade.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 6: Tela "Horários de atendimento"**

`src/app/painel/agenda/horarios/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireNutri } from '@/lib/tenant-session';
import { criarBloqueio, criarRegra, DisponibilidadeError, excluirBloqueio, excluirRegra } from '@/modules/agenda/disponibilidade';

export type FormAgendaState = { erros?: Record<string, string>; valores?: Record<string, string>; ok?: string; envio?: number };
const CAMINHO = '/painel/agenda/horarios';
const valores = (fd: FormData, campos: string[]) => Object.fromEntries(campos.map((c) => [c, String(fd.get(c) ?? '')]));

export async function criarRegraAction(_prev: FormAgendaState, fd: FormData): Promise<FormAgendaState> {
  const { ctx } = await requireNutri(CAMINHO);
  const v = valores(fd, ['diaSemana', 'inicio', 'fim', 'duracaoMin', 'modalidade']);
  try {
    await criarRegra(ctx, v);
  } catch (e) {
    if (e instanceof DisponibilidadeError) return { erros: e.erros, valores: v };
    throw e;
  }
  revalidatePath(CAMINHO);
  return { ok: 'Horário adicionado.', envio: Date.now() };
}

export async function excluirRegraAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(CAMINHO);
  await excluirRegra(ctx, id);
  revalidatePath(CAMINHO);
}

export async function criarBloqueioAction(_prev: FormAgendaState, fd: FormData): Promise<FormAgendaState> {
  const { ctx, tenant } = await requireNutri(CAMINHO);
  const v = valores(fd, ['dataInicio', 'horaInicio', 'dataFim', 'horaFim', 'motivo']);
  try {
    await criarBloqueio(ctx, tenant, v);
  } catch (e) {
    if (e instanceof DisponibilidadeError) return { erros: e.erros, valores: v };
    throw e;
  }
  revalidatePath(CAMINHO);
  revalidatePath('/painel/agenda');
  return { ok: 'Bloqueio adicionado.', envio: Date.now() };
}

export async function excluirBloqueioAction(id: string): Promise<void> {
  const { ctx } = await requireNutri(CAMINHO);
  await excluirBloqueio(ctx, id);
  revalidatePath(CAMINHO);
  revalidatePath('/painel/agenda');
}
```

`src/app/painel/agenda/horarios/regra-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { DIAS_SEMANA, DURACOES, ROTULO_MODALIDADE_REGRA } from '@/modules/agenda/constantes';
import { criarRegraAction, type FormAgendaState } from './actions';

function Selecao({ id, rotulo, erro, opcoes, valor }: { id: string; rotulo: string; erro?: string; opcoes: [string, string][]; valor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">{rotulo}</label>
      <select id={id} name={id} defaultValue={valor ?? ''} aria-invalid={erro ? true : undefined} aria-describedby={erro ? `${id}-erro` : undefined} className="w-full rounded border p-2">
        <option value="" disabled>Escolha…</option>
        {opcoes.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
      </select>
      {erro && <p id={`${id}-erro`} role="alert" className="text-sm text-red-700">{erro}</p>}
    </div>
  );
}

export function RegraForm() {
  const [state, action, pendente] = useActionState<FormAgendaState, FormData>(criarRegraAction, {});
  const v = state.erros ? (state.valores ?? {}) : {};
  const e = state.erros ?? {};
  return (
    <form key={state.envio} action={action} className="grid gap-3 sm:grid-cols-5">
      <Selecao id="diaSemana" rotulo="Dia da semana" erro={e.diaSemana} valor={v.diaSemana} opcoes={DIAS_SEMANA.map((d, i) => [String(i), d])} />
      <Campo id="inicio" rotulo="Início" type="time" required defaultValue={v.inicio} erro={e.inicio} />
      <Campo id="fim" rotulo="Fim" type="time" required defaultValue={v.fim} erro={e.fim} />
      <Selecao id="duracaoMin" rotulo="Duração" erro={e.duracaoMin} valor={v.duracaoMin ?? '60'} opcoes={DURACOES.map((d) => [String(d), `${d} min`])} />
      <Selecao id="modalidade" rotulo="Modalidade" erro={e.modalidade} valor={v.modalidade ?? 'presencial'} opcoes={Object.entries(ROTULO_MODALIDADE_REGRA)} />
      <div className="sm:col-span-5">
        {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
        {state.ok && <p role="status">{state.ok}</p>}
        <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Adicionar horário</button>
      </div>
    </form>
  );
}
```

`src/app/painel/agenda/horarios/bloqueio-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { criarBloqueioAction, type FormAgendaState } from './actions';

export function BloqueioForm() {
  const [state, action, pendente] = useActionState<FormAgendaState, FormData>(criarBloqueioAction, {});
  const v = state.erros ? (state.valores ?? {}) : {};
  const e = state.erros ?? {};
  return (
    <form key={state.envio} action={action} className="grid gap-3 sm:grid-cols-2">
      <Campo id="dataInicio" rotulo="Data inicial" type="date" required defaultValue={v.dataInicio} erro={e.dataInicio} />
      <Campo id="dataFim" rotulo="Data final" type="date" defaultValue={v.dataFim} erro={e.dataFim} dica="Vazio = só a data inicial." />
      <Campo id="horaInicio" rotulo="Hora inicial (opcional)" type="time" defaultValue={v.horaInicio} erro={e.horaInicio} dica="Vazio = o dia inteiro." />
      <Campo id="horaFim" rotulo="Hora final (opcional)" type="time" defaultValue={v.horaFim} erro={e.horaFim} />
      <div className="sm:col-span-2">
        <Campo id="motivo" rotulo="Motivo (opcional)" maxLength={120} defaultValue={v.motivo} erro={e.motivo} />
      </div>
      <div className="sm:col-span-2">
        {state.ok && <p role="status">{state.ok}</p>}
        <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Adicionar bloqueio</button>
      </div>
    </form>
  );
}
```

`src/app/painel/agenda/horarios/page.tsx`:

```tsx
import Link from 'next/link';
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { requireNutri } from '@/lib/tenant-session';
import { DIAS_SEMANA, ROTULO_MODALIDADE_REGRA } from '@/modules/agenda/constantes';
import { listarBloqueios, listarRegras } from '@/modules/agenda/disponibilidade';
import { formatarQuando } from '@/modules/agenda/fuso';
import { Cabecalho } from '../../cabecalho';
import { excluirBloqueioAction, excluirRegraAction } from './actions';
import { BloqueioForm } from './bloqueio-form';
import { RegraForm } from './regra-form';

export const dynamic = 'force-dynamic';

export default async function HorariosPage() {
  const { ctx, tenant } = await requireNutri('/painel/agenda/horarios');
  const agora = new Date();
  const [regras, bloqueios] = await Promise.all([listarRegras(ctx), listarBloqueios(ctx, agora, new Date(agora.getTime() + 10 * 366 * 86_400_000))]);
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-4xl space-y-8 p-6">
        <p className="text-sm"><Link href="/painel/agenda" className="underline">Agenda</Link></p>
        <h1 className="text-2xl font-semibold">Horários de atendimento</h1>
        <section aria-labelledby="regras" className="space-y-3">
          <h2 id="regras" className="text-lg font-semibold">Horários da semana</h2>
          {regras.length === 0 ? (
            <p>Nenhum horário cadastrado: a página de agendamento não oferece horários.</p>
          ) : (
            <ul className="divide-y">
              {regras.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-2">
                  <span>{`${DIAS_SEMANA[r.diaSemana]}, ${r.inicio}–${r.fim}, ${r.duracaoMin} min, ${ROTULO_MODALIDADE_REGRA[r.modalidade]}`}</span>
                  <form action={excluirRegraAction.bind(null, r.id)}>
                    <ConfirmarBotao mensagem="Excluir este horário de atendimento?" rotulo={`Excluir ${DIAS_SEMANA[r.diaSemana]} ${r.inicio}–${r.fim}`}>Excluir</ConfirmarBotao>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <h3 className="font-medium">Adicionar horário</h3>
          <RegraForm />
        </section>
        <section aria-labelledby="bloqueios" className="space-y-3">
          <h2 id="bloqueios" className="text-lg font-semibold">Bloqueios</h2>
          {bloqueios.length === 0 ? (
            <p>Nenhum bloqueio futuro.</p>
          ) : (
            <ul className="divide-y">
              {bloqueios.map((b) => (
                <li key={b.id} className="flex items-center justify-between py-2">
                  <span>{`${formatarQuando(b.inicio, tenant.fuso)} até ${formatarQuando(b.fim, tenant.fuso)}${b.motivo ? ` — ${b.motivo}` : ''}`}</span>
                  <form action={excluirBloqueioAction.bind(null, b.id)}>
                    <ConfirmarBotao mensagem="Excluir este bloqueio?" rotulo={`Excluir bloqueio de ${formatarQuando(b.inicio, tenant.fuso)}`}>Excluir</ConfirmarBotao>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <h3 className="font-medium">Adicionar bloqueio</h3>
          <BloqueioForm />
        </section>
      </main>
    </>
  );
}
```

- [ ] **Step 7: Seed e E2E**

Em `scripts/e2e-seed.ts`, depois do `consultorio` (importe `sql` de `drizzle-orm` e `withTenant` de `@/db/tenant`):

```ts
// Plano 05: o consultório do E2E começa com a agenda vazia a cada execução (filhas antes das mães)
const AGENDA_E2E = ['availability_blocks', 'availability_rules'];
await withTenant({ tenantId: consultorio.id, role: 'nutri' }, async (tx) => {
  for (const t of AGENDA_E2E) await tx.execute(sql`delete from ${sql.identifier(t)}`);
}, db);
```

`e2e/agenda.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { entrarComo } from './helpers';

const NUTRI = { email: 'nutri-e2e@nutridebby.test', senha: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });
let nutri: Page;

/** 'AAAA-MM-DD' da segunda-feira a partir de hoje + `dias` (o teste só compara texto). */
function segundaDepoisDe(dias: number): string {
  const d = new Date(Date.now() + dias * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}
const somar = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);
const br = (iso: string) => iso.split('-').reverse().join('/');
/** Semana bloqueada no E2E ("Congresso"): a segunda-feira daqui a ~30 dias até a sexta. */
const SEMANA_BLOQUEADA = segundaDepoisDe(30);

test.beforeAll(async ({ browser }) => {
  nutri = await entrarComo(browser, NUTRI.email, NUTRI.senha, '10.9.7.1');
  await expect(nutri).toHaveURL(/\/painel$/);
});
test.afterAll(async () => {
  await nutri?.context().close();
});

test('horários de atendimento e bloqueio (US-030)', async () => {
  await nutri.goto('/painel/agenda/horarios');
  await nutri.getByLabel('Dia da semana').selectOption({ label: 'Terça-feira' });
  await nutri.getByLabel('Início').fill('12:00');
  await nutri.getByLabel('Fim').fill('08:00');
  await nutri.getByRole('button', { name: 'Adicionar horário' }).click();
  await expect(nutri.getByText('O fim deve ser depois do início')).toBeVisible();
  for (const dia of ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira']) {
    await nutri.getByLabel('Dia da semana').selectOption({ label: dia });
    await nutri.getByLabel('Início').fill('08:00');
    await nutri.getByLabel('Fim').fill('18:00');
    await nutri.getByLabel('Duração').selectOption('60');
    await nutri.getByLabel('Modalidade').selectOption('ambas');
    await nutri.getByRole('button', { name: 'Adicionar horário' }).click();
    await expect(nutri.getByText(`${dia}, 08:00–18:00, 60 min, Presencial ou online`)).toBeVisible();
  }
  await nutri.getByLabel('Data inicial').fill(SEMANA_BLOQUEADA);
  await nutri.getByLabel('Data final').fill(somar(SEMANA_BLOQUEADA, 4));
  await nutri.getByLabel('Motivo (opcional)').fill('Congresso');
  await nutri.getByRole('button', { name: 'Adicionar bloqueio' }).click();
  await expect(nutri.getByText(`seg., ${br(SEMANA_BLOQUEADA)} às 00:00 até sáb., ${br(somar(SEMANA_BLOQUEADA, 5))} às 00:00 — Congresso`)).toBeVisible();
});
```

Run: `pnpm e2e:seed && pnpm test:e2e e2e/agenda.spec.ts`
Expected: PASS (1 teste).

- [ ] **Step 8: Commit**

```bash
git add src/db/schema/agenda.ts src/db/schema/index.ts drizzle/0048_agenda_disponibilidade.sql drizzle/0049_rls_agenda_disponibilidade.sql drizzle/meta src/db/rls-guard.ts test/isolamento.test.ts src/modules/agenda/disponibilidade.ts src/modules/agenda/disponibilidade.test.ts src/app/painel/agenda/horarios scripts/e2e-seed.ts e2e/agenda.spec.ts
git commit -m "feat(agenda): horários de atendimento e bloqueios (US-030)"
```

---
### Task 3: Consultas — tabela com `EXCLUDE`, papel `publico`, agendar e alterar pela nutricionista, horários livres (P05-02a)

**Files:**
- Create: `drizzle/0050_consultas.sql` (gerada), `drizzle/0051_rls_consultas.sql` (custom), `src/modules/agenda/consultas.ts`, `src/modules/agenda/consultas.test.ts`, `test/agenda.ts`
- Modify: `src/db/schema/agenda.ts`, `src/db/tenant.ts`, `src/db/tenant.test.ts`, `src/db/errors.ts`, `src/db/db-error.test.ts`, `src/db/rls-guard.ts` (`PUBLICO_LIBERADO`, `findPublicoViolations`), `src/db/rls-guard.test.ts`, `test/isolamento.test.ts`, `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO`), `scripts/e2e-seed.ts` (`AGENDA_E2E`), `CLAUDE.md` (regra 2)

**Interfaces:**
- Consumes: `availabilityRules`/`availabilityBlocks`, `lerRegras`, `lerBloqueios` (Tarefa 2); `gerarHorarios`, `dentroDoHorario`, `sobrepoe`, `type Horario`, `type Modalidade`, `paraInstante`, `partesNoFuso`, `MSG_AGENDA`, `DURACAO_MIN`, `DURACAO_MAX` (Tarefa 1); `carregarPacienteParaEscrita`, `idValido`, `PacienteNaoEncontradoError`, `PacienteBloqueadoError` (`@/modules/pacientes/base`); `dataValida` (`@/modules/pacientes/datas`); `patients`, `tenants`, `type TenantRow`.
- Produces:
  - Schema: `appointments` 🔒 (RLS por paciente, auditoria `agenda`, `EXCLUDE appointments_sem_sobreposicao`), `type AppointmentRow`.
  - `@/db/tenant`: `TenantRole` ganha `'publico'` (contexto de sistema das páginas públicas e do cálculo de horários livres; sem `patientId`, ator opcional ausente).
  - SQL (migration 0051): `app_deny_publico(tbl regclass)` (RESTRICTIVE `publico_negado`, FOR ALL), `app_allow_publico(tbl regclass, VARIADIC comandos text[])` (troca por `publico_sem_<comando>` só nos comandos não listados); `app_enable_tenant_rls` passa a chamar `app_deny_publico` (tabela nova nasce fechada); todas as tabelas já existentes com `tenant_isolation` ganham `publico_negado`.
  - `@/db/rls-guard`: `type ComandoPublico = 'select' | 'insert' | 'update' | 'delete'`, `PUBLICO_LIBERADO: Record<string, { comandos: readonly ComandoPublico[]; motivo: string }>`, `findPublicoViolations(db): Promise<RlsViolation[]>`; `findStaleExceptions` passa a aceitar `Record<string, Record<string, unknown>>`.
  - `@/db/errors`: `exclusionViolation(err): string | null` (SQLSTATE 23P01).
  - `@/modules/agenda/consultas`: `type StatusConsulta`, `type AvisoAgenda = 'fora_do_horario' | 'dentro_de_bloqueio'`, `type TenantAgenda = Pick<TenantRow, 'id' | 'fuso' | 'nomeExibicao' | 'linkOnlinePadrao' | 'enderecoConsultorio' | 'antecedenciaMinH' | 'cancelamentoMinH' | 'status' | 'agendamentoPublicoAtivo'>`, `type Consulta`, `type EntradaConsulta`, `class ConsultaError { erros }`, `ConsultaNaoEncontradaError`, `STATUS_ATIVOS: readonly StatusConsulta[]` (`agendada`, `confirmada`), `linkValido(v: string): boolean`, `ehSobreposicao(err): boolean`, `agendarPelaNutri(ctx, tenant, input, deps?): Promise<{ id: string; avisos: AvisoAgenda[] }>`, `moverConsulta(ctx, tenant, id, input, deps?): Promise<{ avisos: AvisoAgenda[] }>`, `listarAgenda(ctx, de, ate, db?): Promise<Consulta[]>`, `buscarConsulta(ctx, id, db?): Promise<Consulta | null>`, `lerConsultaParaEscrita(tx, id): Promise<AppointmentRow>` (trava `FOR UPDATE`), `horariosLivres(tenant, de, ate, opts?: { db?: Db; ignorarConsultaId?: string }): Promise<Horario[]>`.
  - `test/agenda.ts`: `SP`, `em(data, hora): Date`, `tenantAgenda(T, extra?): TenantAgenda`, `semanaToda(db, ctx, extra?)` (regras de domingo a sábado, 08:00–20:00, 60 min, `ambas`), `consultaDireta(db, ctx, patientId, inicio, minutos?, extra?): Promise<string>`.

- [ ] **Step 1: Papel `publico` e erro de exclusão (falham)**

Em `src/db/tenant.test.ts`, dentro do `describe('withTenant')`:

```ts
  it("papel 'publico' (página pública e horários livres, D11): sem paciente, sem ator; com patientId é recusado", async () => {
    const r = await withTenant({ tenantId: A, role: 'publico' }, (tx) => tx.execute<{ r: string }>(sql`select app_current_role() as r`), app.db);
    expect(r.rows[0].r).toBe('publico');
    await expect(withTenant({ tenantId: A, role: 'publico', patientId: randomUUID() }, async () => 1, app.db)).rejects.toThrow(/patientId/);
  });
```

Em `src/db/db-error.test.ts` (acrescente `exclusionViolation` ao import de `./errors`):

```ts
  it('exclusionViolation() acha a restrição EXCLUDE (23P01) no erro ou no cause e ignora o resto', () => {
    expect(exclusionViolation({ code: '23P01', constraint: 'appointments_sem_sobreposicao' })).toBe('appointments_sem_sobreposicao');
    expect(exclusionViolation(Object.assign(new Error('x'), { cause: { code: '23P01', constraint: 'c' } }))).toBe('c');
    expect(exclusionViolation({ code: '23505', constraint: 'u' })).toBeNull();
    expect(exclusionViolation(new Error('x'))).toBeNull();
  });
```

(O caminho real — 23P01 do Postgres saindo do `withTenant` como `DbError` sem valores — é provado em `consultas.test.ts`, Step 5.)

Run: `pnpm test src/db/tenant.test.ts src/db/db-error.test.ts`
Expected: FAIL (`papel inválido para withTenant` e `exclusionViolation is not a function`).

- [ ] **Step 2: Implementar**

`src/db/tenant.ts`:

```ts
/**
 * `publico` (Plano 05, D11): contexto de sistema das páginas sem login (/n/<slug>, link da consulta) e do
 * cálculo de horários livres. No banco, toda tabela com tenant_id nega o `publico` (RESTRICTIVE `publico_negado`),
 * menos as de `PUBLICO_LIBERADO` (src/db/rls-guard.ts), só nos comandos listados. A RLS não restringe colunas:
 * por isso o `publico` só é usado dentro de funções fechadas de src/modules/agenda que devolvem o mínimo (intervalos, ids).
 */
export type TenantRole = 'nutri' | 'paciente' | 'worker' | 'publico';
const ROLES: readonly TenantRole[] = ['nutri', 'paciente', 'worker', 'publico'];
```

`src/db/errors.ts`:

```ts
/** Nome da restrição EXCLUDE violada (Postgres 23P01), olhando também o `cause` do erro do Drizzle. */
export function exclusionViolation(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; e && typeof e === 'object' && i < 5; i++) {
    const pg = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (pg.code === '23P01') return typeof pg.constraint === 'string' ? pg.constraint : '';
    e = pg.cause;
  }
  return null;
}
```

Run: `pnpm test src/db/tenant.test.ts src/db/db-error.test.ts`
Expected: PASS.

- [ ] **Step 3: Tabela** — acrescentar a `src/db/schema/agenda.ts`

```ts
import { foreignKey, unique } from 'drizzle-orm/pg-core'; // junte ao import existente
import { patients } from './pacientes';

/**
 * US-031 a US-037. D9: `inicio`/`fim` + EXCLUDE (migration custom) contra sobreposição de consultas não
 * canceladas do tenant; `realizada`/`faltou` continuam ocupando o horário. D17: `remarcada_de` liga a
 * consulta nova à cancelada quando o paciente remarca.
 */
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    inicio: timestamp('inicio', { withTimezone: true }).notNull(),
    fim: timestamp('fim', { withTimezone: true }).notNull(),
    modalidade: text('modalidade').notNull(),
    linkOnline: text('link_online'),
    status: text('status').notNull().default('agendada'),
    origem: text('origem').notNull(),
    confirmadaVia: text('confirmada_via'),
    canceladoPor: text('cancelado_por'),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    motivoCancelamento: text('motivo_cancelamento'),
    pedidoRemarcacaoEm: timestamp('pedido_remarcacao_em', { withTimezone: true }),
    remarcadaDe: uuid('remarcada_de'),
    presencaEm: timestamp('presenca_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('appointments_periodo_valido', sql`${t.fim} > ${t.inicio} and ${t.fim} - ${t.inicio} <= interval '8 hours'`),
    check('appointments_modalidade_valida', sql`${t.modalidade} in ('presencial', 'online')`),
    check(
      'appointments_link_online',
      sql`(${t.modalidade} = 'presencial' and ${t.linkOnline} is null) or (${t.modalidade} = 'online' and ${t.linkOnline} ~ '^https://' and char_length(${t.linkOnline}) <= 500)`,
    ),
    check('appointments_status_valido', sql`${t.status} in ('agendada', 'confirmada', 'cancelada', 'realizada', 'faltou')`),
    check('appointments_origem_valida', sql`${t.origem} in ('nutri', 'paciente')`),
    check('appointments_confirmada_via_valida', sql`${t.confirmadaVia} is null or ${t.confirmadaVia} in ('whatsapp', 'link')`),
    check('appointments_cancelado_por_valido', sql`${t.canceladoPor} is null or ${t.canceladoPor} in ('nutri', 'paciente')`),
    check('appointments_cancelamento_completo', sql`(${t.status} = 'cancelada') = (${t.canceladoPor} is not null and ${t.canceladaEm} is not null)`),
    check('appointments_motivo_tamanho', sql`char_length(${t.motivoCancelamento}) <= 300`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'appointments_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.remarcadaDe], foreignColumns: [t.tenantId, t.id], name: 'appointments_remarcada_de_fk' }),
    unique('appointments_tenant_id_unique').on(t.tenantId, t.id),
    unique('appointments_tenant_paciente_id_unique').on(t.tenantId, t.patientId, t.id),
    index('appointments_inicio_idx').on(t.tenantId, t.inicio),
    index('appointments_paciente_idx').on(t.tenantId, t.patientId, t.inicio),
  ],
);

export type AppointmentRow = typeof appointments.$inferSelect;
```

Run: `pnpm db:generate --name consultas` → `drizzle/0050_consultas.sql` (confira os 9 CHECKs, as 2 FKs compostas, os 2 UNIQUE e os 2 índices).

Run: `pnpm drizzle-kit generate --custom --name rls_consultas` e preencher `drizzle/0051_rls_consultas.sql` (primeiro o contexto `publico` no banco — D11, rodada 1 do `/code-review` —, depois a tabela):

```sql
-- D11: o contexto `publico` (páginas sem login) não toca tabela nenhuma, a não ser as de PUBLICO_LIBERADO
-- (src/db/rls-guard.ts), só nos comandos listados. RESTRICTIVE: soma-se (AND) às políticas de tenant/paciente.
CREATE OR REPLACE FUNCTION app_deny_publico(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'publico_sem_' || c, tbl);
  END LOOP;
  EXECUTE format('DROP POLICY IF EXISTS publico_negado ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY publico_negado ON %s AS RESTRICTIVE FOR ALL '
    'USING (app_current_role() IS DISTINCT FROM %L) WITH CHECK (app_current_role() IS DISTINCT FROM %L)',
    tbl, 'publico', 'publico');
END $$;
--> statement-breakpoint
-- Libera ao `publico` só os comandos listados: uma política RESTRICTIVE por comando que continua negado.
-- (SELECT … FOR UPDATE/SHARE também exige 'update'; INSERT … RETURNING/ON CONFLICT exige 'select'.)
CREATE OR REPLACE FUNCTION app_allow_publico(tbl regclass, VARIADIC comandos text[]) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  IF NOT comandos <@ ARRAY['select', 'insert', 'update', 'delete'] THEN
    RAISE EXCEPTION 'app_allow_publico: comando inválido em % (use select, insert, update, delete)', comandos;
  END IF;
  EXECUTE format('DROP POLICY IF EXISTS publico_negado ON %s', tbl);
  FOREACH c IN ARRAY ARRAY['select', 'insert', 'update', 'delete'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %s', 'publico_sem_' || c, tbl);
    CONTINUE WHEN c = ANY (comandos);
    IF c = 'insert' THEN
      EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR INSERT WITH CHECK (app_current_role() IS DISTINCT FROM %L)',
        'publico_sem_' || c, tbl, 'publico');
    ELSE
      EXECUTE format('CREATE POLICY %I ON %s AS RESTRICTIVE FOR %s USING (app_current_role() IS DISTINCT FROM %L)',
        'publico_sem_' || c, tbl, upper(c), 'publico');
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Tabela nova nasce fechada para o `publico`: o mesmo corpo da 0000 + app_deny_publico no fim.
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s AS PERMISSIVE FOR ALL '
    'USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())', tbl);
  PERFORM app_deny_publico(tbl);
END $$;
--> statement-breakpoint
-- As tabelas que já existem (Planos 01–04 e Tarefa 2) também ficam fechadas
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation' LOOP
    PERFORM app_deny_publico(format('public.%I', t)::regclass);
  END LOOP;
END $$;
--> statement-breakpoint
-- PUBLICO_LIBERADO: horários livres (Tarefa 3), dono do link da consulta (Tarefa 7) e página pública (Tarefa 8)
SELECT app_allow_publico('availability_rules', 'select');
--> statement-breakpoint
SELECT app_allow_publico('availability_blocks', 'select');
--> statement-breakpoint
SELECT app_allow_publico('patients', 'select', 'insert');
--> statement-breakpoint
SELECT app_allow_publico('audit_log', 'insert');
--> statement-breakpoint
SELECT app_enable_tenant_rls('appointments');
--> statement-breakpoint
SELECT app_enable_patient_rls('appointments');
--> statement-breakpoint
-- D10: dado de saúde adjacente — criar, alterar e cancelar vão para o "Histórico de acessos" do paciente
SELECT app_enable_audit('appointments', 'agenda');
--> statement-breakpoint
SELECT app_allow_publico('appointments', 'select', 'insert');
--> statement-breakpoint
-- D9 / RN-03: duas consultas não canceladas do mesmo tenant nunca se sobrepõem. A restrição vale acima da
-- RLS: a corrida entre dois pacientes (que não se veem) é decidida aqui. O "=" do uuid no GiST vem do
-- btree_gist (migration 0000). '[)': terminar às 10:00 e começar às 10:00 não é sobreposição.
ALTER TABLE appointments ADD CONSTRAINT appointments_sem_sobreposicao
  EXCLUDE USING gist (tenant_id WITH =, tstzrange(inicio, fim, '[)') WITH &&) WHERE (status <> 'cancelada');
```

Em `src/modules/plataforma/audit.ts`, no `ENTIDADE_ROTULO`: `agenda: 'Agenda',`.

`test/isolamento.test.ts`: um contador dá a cada consulta um horário próprio (as fábricas rodam várias vezes por tenant e o `EXCLUDE` recusaria a mesma hora):

```ts
let seqConsulta = 0;
/** Cada chamada ganha um horário próprio de 1 h (EXCLUDE appointments_sem_sobreposicao). */
const horaIso = () => sql`'2030-01-01T00:00:00Z'::timestamptz + ${++seqConsulta} * interval '2 hours'`;
```

e no `FABRICAS`:

```ts
  appointments: (t, p) => {
    const h = horaIso();
    return sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values (${t}, ${p}, ${h}, ${h} + interval '1 hour', 'presencial', 'nutri')`;
  },
```

`const ULTIMAS = ['meals', 'meal_plans', 'anamnesis_templates', 'foods', 'appointments', 'patients'];`

Em `scripts/e2e-seed.ts`: `const AGENDA_E2E = ['appointments', 'availability_blocks', 'availability_rules'];`.

`src/db/rls-guard.ts` — a lista explícita do contexto `publico` e a guarda (D11; `findStaleExceptions` passa a aceitar `maps: Record<string, Record<string, unknown>>`):

```ts
export type ComandoPublico = 'select' | 'insert' | 'update' | 'delete';
const COMANDOS: readonly ComandoPublico[] = ['select', 'insert', 'update', 'delete'];

/**
 * D11: tabelas que o contexto `publico` (páginas sem login) pode tocar, só com estes comandos. Toda outra tabela
 * com tenant_id tem `publico_negado` (app_enable_tenant_rls). Liberar = `SELECT app_allow_publico(...)` + entrada aqui.
 */
export const PUBLICO_LIBERADO: Record<string, { comandos: readonly ComandoPublico[]; motivo: string }> = {
  availability_rules: { comandos: ['select'], motivo: 'horários livres (horariosLivres)' },
  availability_blocks: { comandos: ['select'], motivo: 'horários livres (horariosLivres)' },
  appointments: { comandos: ['select', 'insert'], motivo: 'início/fim nos horários livres, dono do link da consulta e a consulta marcada pela página pública' },
  patients: { comandos: ['select', 'insert'], motivo: 'situação do dono do link; paciente da página pública (procura pelo e-mail e cria)' },
  audit_log: { comandos: ['insert'], motivo: 'o gatilho de auditoria roda com o papel de quem grava (patients, appointments da página pública)' },
};

/** Toda tabela com tenant_id (fora de RLS_EXCEPTIONS) nega o `publico`, ou bate exatamente com PUBLICO_LIBERADO. */
export async function findPublicoViolations(db: Pool | PoolClient): Promise<RlsViolation[]> {
  const { rows } = await db.query<{ t: string; pol: string; cmd: string; permissive: string }>(
    `select tablename as t, policyname as pol, cmd, permissive from pg_policies
      where schemaname = 'public' and policyname like 'publico%'`,
  );
  const out: RlsViolation[] = [];
  for (const table of await listTenantTables(db)) {
    if (RLS_EXCEPTIONS[table]) continue;
    const pols = rows.filter((r) => r.t === table);
    const liberado = PUBLICO_LIBERADO[table];
    if (!liberado) {
      if (pols.length !== 1 || pols[0].pol !== 'publico_negado' || pols[0].cmd !== 'ALL' || pols[0].permissive !== 'RESTRICTIVE') {
        out.push({ table, problem: pols.some((p) => p.pol !== 'publico_negado') ? 'liberada ao publico sem entrada em PUBLICO_LIBERADO' : 'sem política publico_negado (app_enable_tenant_rls/app_deny_publico)' });
      }
      continue;
    }
    const esperadas = COMANDOS.filter((c) => !liberado.comandos.includes(c)).map((c) => `publico_sem_${c}`).sort();
    const atuais = pols.filter((p) => p.permissive === 'RESTRICTIVE').map((p) => p.pol).sort();
    if (pols.length !== atuais.length || JSON.stringify(atuais) !== JSON.stringify(esperadas)) {
      out.push({ table, problem: `políticas do publico diferentes de PUBLICO_LIBERADO (esperado ${esperadas.join(', ') || 'nenhuma'})` });
    }
  }
  return out;
}
```

`src/db/rls-guard.test.ts` (imports `findPublicoViolations`, `PUBLICO_LIBERADO`; o `findStaleExceptions` do teste de `staff_only` ganha `PUBLICO_LIBERADO` no mapa):

```ts
describe('contexto publico (D11)', () => {
  it('toda tabela com tenant_id nega o publico ou bate com PUBLICO_LIBERADO; a lista não cita tabela inexistente', async () => {
    expect(await findPublicoViolations(owner.pool)).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { PUBLICO_LIBERADO })).toEqual([]);
  });
  it('tabela nova nasce fechada; liberar sem declarar, ou perder a política, quebra (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_publico (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_publico')`);
      await client.query('create table tmp_liberada (id int primary key, tenant_id uuid not null)');
      await client.query(`select app_enable_tenant_rls('tmp_liberada')`);
      await client.query(`select app_allow_publico('tmp_liberada', 'select')`);
      let v = await findPublicoViolations(client);
      expect(v.map((x) => x.table)).not.toContain('tmp_publico');
      expect(v).toContainEqual({ table: 'tmp_liberada', problem: 'liberada ao publico sem entrada em PUBLICO_LIBERADO' });
      await client.query('drop policy publico_negado on tmp_publico');
      await client.query('drop policy publico_sem_update on appointments'); // a lista exige; sumiu → acusa
      v = await findPublicoViolations(client);
      expect(v).toContainEqual({ table: 'tmp_publico', problem: 'sem política publico_negado (app_enable_tenant_rls/app_deny_publico)' });
      expect(v.map((x) => x.table)).toContain('appointments');
      await expect(client.query(`select app_allow_publico('tmp_publico', 'truncate')`)).rejects.toThrow(/comando inválido/);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
```

`test/isolamento.test.ts` (import `PUBLICO_LIBERADO` de `@/db/rls-guard`), depois do teste de `staff_only`:

```ts
  it('publico (D11): só lê e grava o que PUBLICO_LIBERADO declara; o resto — notas, anamnese… — dá 0 linhas e recusa a escrita', async () => {
    const comoPublico = (q: SQL) => withTenant({ tenantId: A, role: 'publico' }, (tx) => tx.execute(q), app.db);
    for (const t of tabelas) {
      expect(await contarTenant(t, A), t).toBeGreaterThan(0); // as linhas existem: é a política que esconde
      const pode = PUBLICO_LIBERADO[t]?.comandos ?? [];
      const vistas = (await comoPublico(sql`select 1 from ${sql.identifier(t)}`)).rows.length;
      if (pode.includes('select')) expect(vistas, t).toBeGreaterThan(0);
      else expect(vistas, t).toBe(0);
      if (!pode.includes('insert')) await expect(comoPublico(FABRICAS[t](A, P2)), t).rejects.toSatisfy(violaRls);
      if (SO_INSERE.has(t)) continue; // UPDATE/DELETE já negados por permissão
      if (!pode.includes('update')) expect((await comoPublico(sql`update ${sql.identifier(t)} set tenant_id = tenant_id`)).rowCount, t).toBe(0);
      if (!pode.includes('delete')) expect((await comoPublico(sql`delete from ${sql.identifier(t)}`)).rowCount, t).toBe(0);
    }
    expect((await comoPublico(sql`select 1 from consultation_notes`)).rows).toEqual([]);
    expect((await comoPublico(sql`select 1 from anamneses`)).rows).toEqual([]);
  });
```

`CLAUDE.md`, regra 2, no fim: "Contexto `publico` (páginas sem login, Plano 05): `app_enable_tenant_rls` já nega tudo a ele (`publico_negado`); tabela que o fluxo público precisa ganha `SELECT app_allow_publico('<tabela>', '<comando>', …);` e a entrada em `PUBLICO_LIBERADO` (`src/db/rls-guard.ts`) — a guarda `findPublicoViolations` quebra o CI se esquecer."

Run: `pnpm test src/db test/isolamento.test.ts`
Expected: PASS (as guardas de RLS, de auditoria e do `publico` aceitam `appointments`; a matriz cobre tenant, paciente e o contexto `publico`).

- [ ] **Step 4: Ajudantes de teste** — `test/agenda.ts`

```ts
import { sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { appointments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { TenantAgenda } from '@/modules/agenda/consultas';
import { paraInstante } from '@/modules/agenda/fuso';
import type { TenantDeTeste } from './pacientes';

export const SP = 'America/Sao_Paulo';
export const em = (data: string, hora: string, fuso = SP) => paraInstante(data, hora, fuso)!;

/** Dados do tenant que a agenda lê (os mesmos padrões da tabela `tenants`). */
export const tenantAgenda = (T: TenantDeTeste, extra: Partial<TenantAgenda> = {}): TenantAgenda => ({
  id: T.tenantId,
  fuso: SP,
  nomeExibicao: T.tenant.nomeExibicao,
  linkOnlinePadrao: null,
  enderecoConsultorio: 'Rua das Flores, 10',
  antecedenciaMinH: 12,
  cancelamentoMinH: 24,
  status: 'ativa',
  agendamentoPublicoAtivo: true,
  ...extra,
});

/** Atende todos os dias, 08:00–20:00, consultas de 60 min, presencial ou online. */
export async function semanaToda(db: Db, ctx: TenantContext, extra: { duracaoMin?: number; modalidade?: string } = {}) {
  await withTenant(ctx, (tx) =>
    tx.execute(sql`insert into availability_rules (tenant_id, dia_semana, inicio, fim, duracao_min, modalidade)
      select ${ctx.tenantId}, d, '08:00', '20:00', ${extra.duracaoMin ?? 60}, ${extra.modalidade ?? 'ambas'} from generate_series(0, 6) d`), db);
}

/** Consulta gravada direto (sem regra, sem lembrete): para preparar cenários. */
export async function consultaDireta(db: Db, ctx: TenantContext, patientId: string, inicio: Date, minutos = 60, extra: Partial<typeof appointments.$inferInsert> = {}): Promise<string> {
  const [c] = await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(appointments)
        .values({ tenantId: ctx.tenantId, patientId, inicio, fim: new Date(inicio.getTime() + minutos * 60_000), modalidade: 'presencial', origem: 'nutri', ...extra })
        .returning({ id: appointments.id }),
    db,
  );
  return c.id;
}
```

- [ ] **Step 5: Testes das consultas (falham)** — `src/modules/agenda/consultas.test.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, semanaToda, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, novoPaciente, novoTenant } from '../../../test/pacientes';
import { appointments, auditLog, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { MSG_AGENDA } from './constantes';
import { agendarPelaNutri, buscarConsulta, ConsultaError, ehSobreposicao, horariosLivres, listarAgenda, moverConsulta } from './consultas';
import { criarBloqueio, criarRegra } from './disponibilidade';
import { partesNoFuso } from './fuso';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());
const deps = { db: app.db, now: new Date('2026-10-01T12:00:00Z') };
const SP = 'America/Sao_Paulo';

const erros = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConsultaError) return e.erros;
    throw e;
  }
  throw new Error('esperava ConsultaError');
};

describe('agendar pela nutricionista (US-031)', () => {
  it('Ana em 15/10/2026 às 09:00, 60 min, online com link → "agendada", origem "nutri"', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60', modalidade: 'online', linkOnline: 'https://meet.google.com/abc-defg-hij' }, deps);
    const c = await buscarConsulta(T.ctx, id, app.db);
    expect(c).toMatchObject({ paciente: 'Ana Souza', status: 'agendada', origem: 'nutri', modalidade: 'online', linkOnline: 'https://meet.google.com/abc-defg-hij', inicio: em('2026-10-15', '09:00'), fim: em('2026-10-15', '10:00') });
    expect((await listarAgenda(T.ctx, em('2026-10-15', '00:00'), em('2026-10-16', '00:00'), app.db)).map((x) => x.id)).toEqual([id]);
  });

  it('sobreposição: "Conflito com a consulta de <nome> às 09:00"; encostar às 10:00 pode', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const bia = await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' });
    await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60', modalidade: 'presencial' }, deps);
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: bia.id, data: '2026-10-15', hora: '09:30', duracaoMin: '60', modalidade: 'presencial' }, deps))).toEqual({ geral: MSG_AGENDA.conflito('Ana Souza', '09:00') });
    await expect(agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: bia.id, data: '2026-10-15', hora: '10:00', duracaoMin: '60', modalidade: 'presencial' }, deps)).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('corrida (Review Focus 1): duas marcações simultâneas no mesmo horário → exatamente uma', async () => {
    const T = await novoTenant(app.db);
    const [a, b] = [await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' }), await novoPaciente(app.db, T.ctx, { nome: 'Bia Lima' })];
    const r = await Promise.allSettled([a, b].map((p) => agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: p.id, data: '2026-10-15', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, deps)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const falha = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(falha.reason).toBeInstanceOf(ConsultaError);
    expect((falha.reason as ConsultaError).erros.geral).toMatch(/^Conflito com a consulta de (Ana Souza|Bia Lima) às 14:00$/);
  });

  it('fora do horário de atendimento e dentro de bloqueio: marca, com os avisos', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    await criarRegra(T.ctx, { diaSemana: '4', inicio: '08:00', fim: '12:00', duracaoMin: '60', modalidade: 'presencial' }, deps); // quinta
    await criarBloqueio(T.ctx, { fuso: SP }, { dataInicio: '2026-10-22', motivo: 'Congresso' }, deps);
    const base = { patientId: ana.id, duracaoMin: '60', modalidade: 'presencial' };
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2026-10-15', hora: '09:00' }, deps)).avisos).toEqual([]);
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2026-10-15', hora: '13:00' }, deps)).avisos).toEqual(['fora_do_horario']);
    expect((await agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, data: '2026-10-22', hora: '09:00' }, deps)).avisos).toEqual(['dentro_de_bloqueio']);
  });

  it('link online: sem link e sem padrão → "Informe o link da chamada (https://…)"; usa o link padrão; http:// recusado', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const base = { patientId: ana.id, data: '2026-10-15', duracaoMin: '60', modalidade: 'online' };
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '09:00' }, deps))).toEqual({ linkOnline: MSG_AGENDA.linkObrigatorio });
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, hora: '09:00', linkOnline: 'http://meet.google.com/x' }, deps))).toEqual({ linkOnline: MSG_AGENDA.linkObrigatorio });
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T, { linkOnlinePadrao: 'https://meet.google.com/abc-defg-hij' }), { ...base, hora: '09:00' }, deps);
    expect((await buscarConsulta(T.ctx, id, app.db))?.linkOnline).toBe('https://meet.google.com/abc-defg-hij');
  });

  it('validação: paciente, data, hora, duração; hora que não existe no fuso (horário de verão)', async () => {
    const T = await novoTenant(app.db);
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: 'x', data: '2026-02-30', hora: '9h', duracaoMin: '5', modalidade: 'x' }, deps))).toEqual({
      patientId: MSG_AGENDA.pacienteObrigatorio, data: MSG_AGENDA.dataInvalida, hora: MSG_AGENDA.horaInvalida, duracaoMin: MSG_AGENDA.duracao, modalidade: MSG_AGENDA.modalidade,
    });
    const ana = await novoPaciente(app.db, T.ctx);
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T, { fuso: 'America/New_York' }), { patientId: ana.id, data: '2026-03-08', hora: '02:30', duracaoMin: '60', modalidade: 'presencial' }, deps))).toEqual({ hora: MSG_AGENDA.horaInexistente });
  });

  it('paciente arquivado → "Paciente arquivado: desarquive para agendar."; bloqueado → PacienteBloqueadoError', async () => {
    const T = await novoTenant(app.db);
    const arq = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const blo = await novoPaciente(app.db, T.ctx, { status: 'bloqueado' });
    const base = { data: '2026-10-15', hora: '09:00', duracaoMin: '60', modalidade: 'presencial' };
    expect(await erros(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, patientId: arq.id }, deps))).toEqual({ patientId: MSG_AGENDA.pacienteArquivado });
    await expect(agendarPelaNutri(T.ctx, tenantAgenda(T), { ...base, patientId: blo.id }, deps)).rejects.toBeInstanceOf(PacienteBloqueadoError);
  });

  it('auditoria (D10): criar e alterar viram audit_log "agenda" do paciente, com o ator', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-15', hora: '09:00', duracaoMin: '60', modalidade: 'presencial' }, deps);
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-16', hora: '10:00', duracaoMin: '45', modalidade: 'presencial' }, deps);
    const log = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'agenda'), eq(auditLog.entidadeId, id))).orderBy(auditLog.criadoEm), app.db);
    expect(log.map((l) => [l.acao, l.patientId, l.actorUserId])).toEqual([['criar', ana.id, T.nutriId], ['alterar', ana.id, T.nutriId]]);
  });
});

describe('alterar data e hora (US-031, D17)', () => {
  it('muda a hora, volta para "agendada" e limpa confirmação e pedido de remarcação; ignora a própria consulta no conflito', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'), 60, { status: 'confirmada', confirmadaVia: 'whatsapp', pedidoRemarcacaoEm: new Date() });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-15', hora: '09:30', duracaoMin: '60', modalidade: 'presencial' }, deps);
    expect(await buscarConsulta(T.ctx, id, app.db)).toMatchObject({ inicio: em('2026-10-15', '09:30'), status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
  });

  it('consulta cancelada, realizada ou de outro tenant não se altera', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: new Date() });
    const entrada = { data: '2026-10-16', hora: '09:00', duracaoMin: '60', modalidade: 'presencial' };
    expect(await erros(moverConsulta(T.ctx, tenantAgenda(T), id, entrada, deps))).toEqual({ geral: MSG_AGENDA.naoAlteravel });
    const outro = await novoTenant(app.db);
    await expect(moverConsulta(outro.ctx, tenantAgenda(outro), id, entrada, deps)).rejects.toThrow(MSG_AGENDA.naoEncontrada);
  });
});

describe('horários livres (RN-03, D11)', () => {
  it('tira a consulta ocupada, devolve a cancelada e pode ignorar a própria consulta (remarcação)', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const de = em('2026-10-15', '00:00');
    const ate = em('2026-10-16', '00:00');
    const horas = async (o = {}) => (await horariosLivres(tenantAgenda(T), de, ate, { db: app.db, ...o })).map((h) => partesNoFuso(h.inicio, SP).hora);
    expect(await horas()).toHaveLength(12);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-15', '10:00'), 60, { status: 'cancelada', canceladoPor: 'paciente', canceladaEm: new Date() });
    expect(await horas()).not.toContain('09:00');
    expect(await horas()).toContain('10:00');
    expect(await horas({ ignorarConsultaId: id })).toContain('09:00');
  });

  it('a sessão de paciente não vê a consulta de outro paciente, mas o EXCLUDE a protege mesmo assim (Review Focus 1)', async () => {
    const T = await novoTenant(app.db);
    const [p1, p2] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    await consultaDireta(app.db, T.ctx, p1.id, em('2026-10-15', '09:00'));
    const comoP2 = ctxPaciente(T.tenantId, p2.id);
    expect(await withTenant(comoP2, (tx) => tx.select().from(appointments), app.db)).toEqual([]);
    const err = await withTenant(comoP2, (tx) => tx.insert(appointments).values({ tenantId: T.tenantId, patientId: p2.id, inicio: em('2026-10-15', '09:30'), fim: em('2026-10-15', '10:30'), modalidade: 'presencial', origem: 'paciente' }), app.db).then(
      () => null,
      (e: unknown) => e,
    );
    expect(ehSobreposicao(err)).toBe(true);
    expect(String((err as Error).message)).not.toMatch(/2026|09:30|tstzrange\(/); // DbError sem valores (RNF-11)
    expect(await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.id, p2.id)), app.db)).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `pnpm test src/modules/agenda/consultas.test.ts`
Expected: FAIL ("Failed to resolve import './consultas'").

- [ ] **Step 7: Implementar** — `src/modules/agenda/consultas.ts`

```ts
import { and, asc, eq, gt, lt, ne } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { exclusionViolation } from '@/db/errors';
import { appointments, patients, type AppointmentRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { carregarPacienteParaEscrita, idValido } from '@/modules/pacientes/base';
import { dataValida } from '@/modules/pacientes/datas';
import { DURACAO_MAX, DURACAO_MIN, MSG_AGENDA } from './constantes';
import { lerBloqueios, lerRegras } from './disponibilidade';
import { paraInstante, partesNoFuso } from './fuso';
import { dentroDoHorario, gerarHorarios, sobrepoe, type Horario, type Intervalo, type Modalidade } from './horarios';

export type StatusConsulta = 'agendada' | 'confirmada' | 'cancelada' | 'realizada' | 'faltou';
export type AvisoAgenda = 'fora_do_horario' | 'dentro_de_bloqueio';
export type TenantAgenda = Pick<TenantRow, 'id' | 'fuso' | 'nomeExibicao' | 'linkOnlinePadrao' | 'enderecoConsultorio' | 'antecedenciaMinH' | 'cancelamentoMinH' | 'status' | 'agendamentoPublicoAtivo'>;
export type Consulta = {
  id: string;
  patientId: string;
  paciente: string;
  /** US-032: paciente que veio da página pública e ainda não teve o cadastro completado. */
  pacienteNovoPublico: boolean;
  inicio: Date;
  fim: Date;
  modalidade: Modalidade;
  linkOnline: string | null;
  status: StatusConsulta;
  origem: 'nutri' | 'paciente';
  confirmadaVia: 'whatsapp' | 'link' | null;
  canceladoPor: 'nutri' | 'paciente' | null;
  pedidoRemarcacaoEm: Date | null;
  remarcadaDe: string | null;
};
export type EntradaConsulta = { patientId?: unknown; data: unknown; hora: unknown; duracaoMin: unknown; modalidade: unknown; linkOnline?: unknown };

export class ConsultaError extends Error {
  override name = 'ConsultaError';
  constructor(readonly erros: Record<string, string>) {
    super('Consulta inválida');
  }
}
export class ConsultaNaoEncontradaError extends Error {
  override name = 'ConsultaNaoEncontradaError';
  constructor() {
    super(MSG_AGENDA.naoEncontrada);
  }
}

type Deps = { db?: Db; now?: Date };
export const STATUS_ATIVOS: readonly StatusConsulta[] = ['agendada', 'confirmada'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/** O banco exige `^https://` e até 500 caracteres (appointments_link_online). */
export const linkValido = (v: string) => /^https:\/\/\S+$/.test(v) && v.length <= 500 && URL.canParse(v);
export const ehSobreposicao = (e: unknown) => exclusionViolation(e) === 'appointments_sem_sobreposicao';

type HorarioValidado = Intervalo & { modalidade: Modalidade; linkOnline: string | null };

function validarHorario(tenant: Pick<TenantAgenda, 'fuso' | 'linkOnlinePadrao'>, input: EntradaConsulta, erros: Record<string, string>): HorarioValidado | null {
  const data = texto(input.data);
  const hora = texto(input.hora);
  if (!dataValida(data)) erros.data = MSG_AGENDA.dataInvalida;
  if (!HORA.test(hora)) erros.hora = MSG_AGENDA.horaInvalida;
  const duracao = Number(texto(String(input.duracaoMin ?? '')));
  if (!Number.isInteger(duracao) || duracao < DURACAO_MIN || duracao > DURACAO_MAX) erros.duracaoMin = MSG_AGENDA.duracao;
  const modalidade = String(input.modalidade ?? '');
  if (modalidade !== 'presencial' && modalidade !== 'online') erros.modalidade = MSG_AGENDA.modalidade;
  const link = texto(input.linkOnline) || tenant.linkOnlinePadrao || '';
  if (modalidade === 'online' && !linkValido(link)) erros.linkOnline = MSG_AGENDA.linkObrigatorio;
  let inicio: Date | null = null;
  if (!erros.data && !erros.hora) {
    inicio = paraInstante(data, hora, tenant.fuso);
    if (!inicio) erros.hora = MSG_AGENDA.horaInexistente;
  }
  if (Object.keys(erros).length || !inicio) return null;
  return { inicio, fim: new Date(inicio.getTime() + duracao * 60_000), modalidade: modalidade as Modalidade, linkOnline: modalidade === 'online' ? link : null };
}

/** Mensagem de conflito com o nome e a hora da consulta que já ocupa o horário (só a equipe vê). */
async function mensagemDeConflito(tx: Tx, i: Intervalo, fuso: string, ignorarId?: string): Promise<string | null> {
  const [c] = await tx
    .select({ nome: patients.nome, inicio: appointments.inicio })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(and(ne(appointments.status, 'cancelada'), lt(appointments.inicio, i.fim), gt(appointments.fim, i.inicio), ignorarId ? ne(appointments.id, ignorarId) : undefined))
    .orderBy(asc(appointments.inicio))
    .limit(1);
  return c ? MSG_AGENDA.conflito(c.nome, partesNoFuso(c.inicio, fuso).hora) : null;
}

async function avisosDoHorario(tx: Tx, i: Intervalo, fuso: string): Promise<AvisoAgenda[]> {
  const avisos: AvisoAgenda[] = [];
  if (!dentroDoHorario(i, await lerRegras(tx), fuso)) avisos.push('fora_do_horario');
  if ((await lerBloqueios(tx, i.inicio, i.fim)).some((b) => sobrepoe(b, i))) avisos.push('dentro_de_bloqueio');
  return avisos;
}

/** Corrida perdida para outra gravação (23P01 depois da checagem): lê o conflito numa transação nova. */
async function comoConflito(ctx: TenantContext, i: Intervalo, fuso: string, db: Db, ignorarId?: string): Promise<never> {
  const msg = await withTenant(ctx, (tx) => mensagemDeConflito(tx, i, fuso, ignorarId), db);
  throw new ConsultaError({ geral: msg ?? MSG_AGENDA.ocupado });
}

/**
 * US-031 / D22: a nutricionista marca em qualquer data e horário (fora das regras ou num bloqueio, com aviso).
 * Paciente arquivado não é agendado; bloqueado/anonimizado → PacienteBloqueadoError (carregarPacienteParaEscrita).
 */
export async function agendarPelaNutri(ctx: TenantContext, tenant: TenantAgenda, input: EntradaConsulta, deps: Deps = {}): Promise<{ id: string; avisos: AvisoAgenda[] }> {
  const erros: Record<string, string> = {};
  const patientId = idValido(input.patientId) ? input.patientId : null;
  if (!patientId) erros.patientId = MSG_AGENDA.pacienteObrigatorio;
  const v = validarHorario(tenant, input, erros);
  if (!v || !patientId) throw new ConsultaError(erros);
  const now = deps.now ?? new Date();
  const db = deps.db ?? getDb();
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const p = await carregarPacienteParaEscrita(tx, patientId);
        if (p.status !== 'ativo') throw new ConsultaError({ patientId: MSG_AGENDA.pacienteArquivado });
        const choque = await mensagemDeConflito(tx, v, tenant.fuso);
        if (choque) throw new ConsultaError({ geral: choque });
        const [c] = await tx
          .insert(appointments)
          .values({ tenantId: ctx.tenantId, patientId: p.id, inicio: v.inicio, fim: v.fim, modalidade: v.modalidade, linkOnline: v.linkOnline, status: 'agendada', origem: 'nutri', createdAt: now, updatedAt: now })
          .returning();
        // Tarefa 5: lembretes (RN-05) e "Consulta marcada" ao paciente entram aqui, na mesma transação
        return { id: c.id, avisos: await avisosDoHorario(tx, v, tenant.fuso) };
      },
      db,
    );
  } catch (e) {
    if (ehSobreposicao(e)) return comoConflito(ctx, v, tenant.fuso, db);
    throw e;
  }
}

/** Consulta travada para escrita; outro tenant ou outro paciente (RLS) → não encontrada. */
export async function lerConsultaParaEscrita(tx: Tx, id: string): Promise<AppointmentRow> {
  if (!idValido(id)) throw new ConsultaNaoEncontradaError();
  const [c] = await tx.select().from(appointments).where(eq(appointments.id, id)).for('update');
  if (!c) throw new ConsultaNaoEncontradaError();
  return c;
}

/**
 * D17: "Alterar data e hora" pela nutricionista — a mesma consulta, de volta a "agendada" (a confirmação
 * e o pedido de remarcação eram do horário antigo). Ordem das travas: paciente → consulta.
 */
export async function moverConsulta(ctx: TenantContext, tenant: TenantAgenda, id: string, input: EntradaConsulta, deps: Deps = {}): Promise<{ avisos: AvisoAgenda[] }> {
  const erros: Record<string, string> = {};
  const v = validarHorario(tenant, input, erros);
  if (!v) throw new ConsultaError(erros);
  const now = deps.now ?? new Date();
  const db = deps.db ?? getDb();
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        if (!idValido(id)) throw new ConsultaNaoEncontradaError();
        const [antes] = await tx.select({ patientId: appointments.patientId }).from(appointments).where(eq(appointments.id, id));
        if (!antes) throw new ConsultaNaoEncontradaError();
        await carregarPacienteParaEscrita(tx, antes.patientId);
        const c = await lerConsultaParaEscrita(tx, id);
        if (!STATUS_ATIVOS.includes(c.status as StatusConsulta)) throw new ConsultaError({ geral: MSG_AGENDA.naoAlteravel });
        const choque = await mensagemDeConflito(tx, v, tenant.fuso, id);
        if (choque) throw new ConsultaError({ geral: choque });
        await tx
          .update(appointments)
          .set({ inicio: v.inicio, fim: v.fim, modalidade: v.modalidade, linkOnline: v.linkOnline, status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null, updatedAt: now })
          .where(eq(appointments.id, id));
        // Tarefa 5: lembretes do horário novo são criados como linhas novas; os pendentes do horário antigo viram
        // ignorados (`consulta_remarcada`) e os já enviados ficam como estão (D17: linha enviada é imutável)
        return { avisos: await avisosDoHorario(tx, v, tenant.fuso) };
      },
      db,
    );
  } catch (e) {
    if (ehSobreposicao(e)) return comoConflito(ctx, v, tenant.fuso, db, id);
    throw e;
  }
}

const COLUNAS = {
  c: appointments,
  paciente: patients.nome,
  origemPaciente: patients.origem,
  nascimento: patients.dataNascimento,
};
type Linha = { c: AppointmentRow; paciente: string; origemPaciente: string; nascimento: string | null };
const comoConsulta = ({ c, paciente, origemPaciente, nascimento }: Linha): Consulta => ({
  id: c.id,
  patientId: c.patientId,
  paciente,
  pacienteNovoPublico: origemPaciente === 'agendamento_publico' && !nascimento,
  inicio: c.inicio,
  fim: c.fim,
  modalidade: c.modalidade as Modalidade,
  linkOnline: c.linkOnline,
  status: c.status as StatusConsulta,
  origem: c.origem as Consulta['origem'],
  confirmadaVia: c.confirmadaVia as Consulta['confirmadaVia'],
  canceladoPor: c.canceladoPor as Consulta['canceladoPor'],
  pedidoRemarcacaoEm: c.pedidoRemarcacaoEm,
  remarcadaDe: c.remarcadaDe,
});

/** D10: a agenda (nome, hora, situação) não é leitura auditada — mesmo critério da lista de pacientes. */
export async function listarAgenda(ctx: TenantContext, de: Date, ate: Date, db: Db = getDb()): Promise<Consulta[]> {
  const rs = await withTenant(
    ctx,
    (tx) => tx.select(COLUNAS).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId)).where(and(lt(appointments.inicio, ate), gt(appointments.fim, de))).orderBy(asc(appointments.inicio)),
    db,
  );
  return rs.map(comoConsulta);
}

export async function buscarConsulta(ctx: TenantContext, id: string, db: Db = getDb()): Promise<Consulta | null> {
  if (!idValido(id)) return null;
  const [r] = await withTenant(ctx, (tx) => tx.select(COLUNAS).from(appointments).innerJoin(patients, eq(patients.id, appointments.patientId)).where(eq(appointments.id, id)), db);
  return r ? comoConsulta(r) : null;
}

/**
 * D11: horários livres no contexto `publico` (sem ator): lê regras, bloqueios e só início/fim das consultas
 * não canceladas, e devolve só intervalos — nunca quem ocupa. A margem de 8 h depois de `ate` pega
 * bloqueio/consulta que começa depois do fim da janela mas cruza o último horário.
 */
export async function horariosLivres(tenant: Pick<TenantAgenda, 'id' | 'fuso' | 'linkOnlinePadrao'>, de: Date, ate: Date, opts: { db?: Db; ignorarConsultaId?: string } = {}): Promise<Horario[]> {
  const margem = new Date(ate.getTime() + 8 * 3_600_000);
  return withTenant(
    { tenantId: tenant.id, role: 'publico' },
    async (tx) => {
      const regras = await lerRegras(tx);
      const bloqueios = await lerBloqueios(tx, de, margem);
      const ocupadas = await tx
        .select({ id: appointments.id, inicio: appointments.inicio, fim: appointments.fim })
        .from(appointments)
        .where(and(ne(appointments.status, 'cancelada'), lt(appointments.inicio, margem), gt(appointments.fim, de)));
      const ocupados = ocupadas.filter((o) => o.id !== opts.ignorarConsultaId);
      return gerarHorarios({ regras, bloqueios, ocupados, de, ate, fuso: tenant.fuso, online: !!tenant.linkOnlinePadrao });
    },
    opts.db ?? getDb(),
  );
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm test src/modules/agenda src/db test/isolamento.test.ts`
Expected: PASS (11 testes novos em `consultas.test.ts`; isolamento com `appointments`).

- [ ] **Step 9: Commit**

```bash
git add src/db/schema/agenda.ts drizzle/0050_consultas.sql drizzle/0051_rls_consultas.sql drizzle/meta src/db/tenant.ts src/db/tenant.test.ts src/db/errors.ts src/db/db-error.test.ts src/db/rls-guard.ts src/db/rls-guard.test.ts CLAUDE.md test/isolamento.test.ts test/agenda.ts src/modules/agenda/consultas.ts src/modules/agenda/consultas.test.ts src/modules/plataforma/audit.ts scripts/e2e-seed.ts
git commit -m "feat(agenda): consultas com EXCLUDE contra sobreposição, papel publico (negado no banco por padrão) e horários livres (US-031, RN-03)"
```

---
### Task 4: Agenda da nutricionista — dia, semana e lista, nova consulta e "Alterar data e hora" (P05-02b)

**Files:**
- Create: `src/app/painel/agenda/periodo.ts`, `src/app/painel/agenda/periodo.test.ts`, `src/app/painel/agenda/page.tsx`, `src/app/painel/agenda/item-consulta.tsx`, `src/app/painel/agenda/actions.ts`, `src/app/painel/agenda/consulta-form.tsx`, `src/app/painel/agenda/nova/page.tsx`, `src/app/painel/agenda/consultas/[id]/page.tsx`
- Modify: `src/app/painel/cabecalho.tsx`, `e2e/agenda.spec.ts`

**Interfaces:**
- Consumes: `agendarPelaNutri`, `moverConsulta`, `listarAgenda`, `buscarConsulta`, `ConsultaError`, `ConsultaNaoEncontradaError`, `type Consulta`, `type AvisoAgenda`, `type StatusConsulta` (Tarefa 3); `listarBloqueios`, `type BloqueioSalvo` (Tarefa 2); `diaDaSemana`, `somarDias`, `diaCurto`, `inicioDoDia`, `partesNoFuso`, `formatarQuando` (Tarefa 1); `MSG_AGENDA`, `DURACOES`, `ROTULO_MODALIDADE` (Tarefa 1); `sobrepoe` (Tarefa 1); `listarPacientes` (`@/modules/pacientes/pacientes`); `PacienteBloqueadoError`, `PacienteNaoEncontradoError`, `MSG_BLOQUEADO`; `dataValida`, `hojeNoFuso`; `requireNutri`; `Campo`.
- Produces:
  - `src/app/painel/agenda/periodo.ts`: `type Visao = 'dia' | 'semana' | 'lista'`, `lerVisao(v: unknown): Visao`, `periodoDaVisao(visao: Visao, data: string): { dias: string[]; anterior: string; proximo: string }`, `ROTULO_STATUS: Record<StatusConsulta, string>`, `selosDaConsulta(c: Consulta, dentroDeBloqueio: boolean): string[]`, `AVISO_ROTULO: Record<AvisoAgenda, string>`, `lerAvisos(v: unknown): AvisoAgenda[]`.
  - Páginas `/painel/agenda` (`?visao=dia|semana|lista&data=AAAA-MM-DD`), `/painel/agenda/nova` (`?data=&paciente=`), `/painel/agenda/consultas/[id]` (`?ok=marcada|alterada&avisos=fora_do_horario,dentro_de_bloqueio`). A página da consulta tem seções que as Tarefas 5 (Lembretes), 7 (Cancelar) e 15 (Presença, Iniciar atendimento) completam.
  - Server Actions `agendarAction(prev, fd)`, `moverAction(id, prev, fd)`; `type ConsultaState = { erros?: Record<string, string>; valores?: Record<string, string> }`.
  - `ItemConsulta({ c, fuso, dentroDeBloqueio })`.

- [ ] **Step 1: Testes do período e dos selos (falham)** — `src/app/painel/agenda/periodo.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { Consulta } from '@/modules/agenda/consultas';
import { lerAvisos, lerVisao, periodoDaVisao, selosDaConsulta } from './periodo';

const base: Consulta = {
  id: '1', patientId: 'p', paciente: 'Ana Souza', pacienteNovoPublico: false, inicio: new Date(), fim: new Date(), modalidade: 'presencial', linkOnline: null,
  status: 'agendada', origem: 'nutri', confirmadaVia: null, canceladoPor: null, pedidoRemarcacaoEm: null, remarcadaDe: null,
};

describe('período da agenda', () => {
  it('semana começa na segunda: sexta 16/10/2026 → 12/10 a 18/10; anterior e próxima semana', () => {
    expect(periodoDaVisao('semana', '2026-10-16')).toEqual({
      dias: ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'],
      anterior: '2026-10-05',
      proximo: '2026-10-19',
    });
    expect(periodoDaVisao('semana', '2026-10-18').dias[0]).toBe('2026-10-12'); // domingo fica na semana que começou na segunda
  });
  it('dia e lista (30 dias)', () => {
    expect(periodoDaVisao('dia', '2026-12-31')).toEqual({ dias: ['2026-12-31'], anterior: '2026-12-30', proximo: '2027-01-01' });
    const l = periodoDaVisao('lista', '2026-10-16');
    expect([l.dias.length, l.dias.at(-1), l.proximo]).toEqual([30, '2026-11-14', '2026-11-15']);
  });
  it('visão desconhecida vira semana; avisos só os conhecidos', () => {
    expect([lerVisao('dia'), lerVisao('x'), lerVisao(undefined)]).toEqual(['dia', 'semana', 'semana']);
    expect(lerAvisos('fora_do_horario,xss,dentro_de_bloqueio')).toEqual(['fora_do_horario', 'dentro_de_bloqueio']);
  });
});

describe('selos da consulta (US-030, US-032, US-035)', () => {
  it('situação em texto, não só cor', () => {
    expect(selosDaConsulta(base, false)).toEqual(['Agendada']);
    expect(selosDaConsulta({ ...base, status: 'confirmada', confirmadaVia: 'whatsapp' }, false)).toEqual(['Confirmada via WhatsApp']);
    expect(selosDaConsulta({ ...base, status: 'confirmada', confirmadaVia: 'link' }, false)).toEqual(['Confirmada pelo link']);
    expect(selosDaConsulta({ ...base, status: 'cancelada', canceladoPor: 'paciente' }, true)).toEqual(['Cancelada pelo paciente']);
  });
  it('pedido de remarcação, bloqueio e paciente novo da página pública', () => {
    expect(selosDaConsulta({ ...base, pedidoRemarcacaoEm: new Date(), pacienteNovoPublico: true }, true)).toEqual([
      'Agendada', 'Paciente pediu para remarcar', 'Consulta dentro de um bloqueio', 'Novo paciente via agendamento online', 'Completar cadastro',
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/app/painel/agenda/periodo.test.ts`
Expected: FAIL ("Failed to resolve import './periodo'").

- [ ] **Step 3: Implementar** — `src/app/painel/agenda/periodo.ts`

```ts
import { MSG_AGENDA } from '@/modules/agenda/constantes';
import type { AvisoAgenda, Consulta, StatusConsulta } from '@/modules/agenda/consultas';
import { diaDaSemana, somarDias } from '@/modules/agenda/fuso';

export type Visao = 'dia' | 'semana' | 'lista';
export const lerVisao = (v: unknown): Visao => (v === 'dia' || v === 'lista' ? v : 'semana');

/** Dias exibidos (calendário do tenant) e para onde vão "Anterior" e "Próximo". A semana começa na segunda. */
export function periodoDaVisao(visao: Visao, data: string): { dias: string[]; anterior: string; proximo: string } {
  if (visao === 'dia') return { dias: [data], anterior: somarDias(data, -1), proximo: somarDias(data, 1) };
  const inicio = visao === 'semana' ? somarDias(data, -((diaDaSemana(data) + 6) % 7)) : data;
  const n = visao === 'semana' ? 7 : 30;
  return { dias: Array.from({ length: n }, (_, i) => somarDias(inicio, i)), anterior: somarDias(inicio, -n), proximo: somarDias(inicio, n) };
}

export const ROTULO_STATUS: Record<StatusConsulta, string> = { agendada: 'Agendada', confirmada: 'Confirmada', cancelada: 'Cancelada', realizada: 'Realizada', faltou: 'Faltou' };

export const AVISO_ROTULO: Record<AvisoAgenda, string> = { fora_do_horario: MSG_AGENDA.foraDoHorario, dentro_de_bloqueio: MSG_AGENDA.dentroDeBloqueio };
export const lerAvisos = (v: unknown): AvisoAgenda[] =>
  typeof v === 'string' ? v.split(',').filter((a): a is AvisoAgenda => a === 'fora_do_horario' || a === 'dentro_de_bloqueio') : [];

/** Situação e alertas da consulta, em texto (acessibilidade: nada só por cor). */
export function selosDaConsulta(c: Consulta, dentroDeBloqueio: boolean): string[] {
  const s: string[] = [];
  if (c.status === 'confirmada' && c.confirmadaVia === 'whatsapp') s.push('Confirmada via WhatsApp');
  else if (c.status === 'confirmada' && c.confirmadaVia === 'link') s.push('Confirmada pelo link');
  else if (c.status === 'cancelada' && c.canceladoPor === 'paciente') s.push('Cancelada pelo paciente');
  else s.push(ROTULO_STATUS[c.status]);
  if (c.status === 'cancelada') return s;
  if (c.pedidoRemarcacaoEm) s.push('Paciente pediu para remarcar');
  if (dentroDeBloqueio) s.push(MSG_AGENDA.dentroDeBloqueio);
  if (c.pacienteNovoPublico) s.push('Novo paciente via agendamento online', 'Completar cadastro');
  return s;
}
```

Run: `pnpm test src/app/painel/agenda/periodo.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 4: Ações e formulário da consulta**

`src/app/painel/agenda/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { agendarPelaNutri, ConsultaError, ConsultaNaoEncontradaError, moverConsulta } from '@/modules/agenda/consultas';
import { PacienteBloqueadoError, PacienteNaoEncontradoError } from '@/modules/pacientes/base';

export type ConsultaState = { erros?: Record<string, string>; valores?: Record<string, string> };

const CAMPOS = ['patientId', 'data', 'hora', 'duracaoMin', 'modalidade', 'linkOnline'] as const;
const valores = (fd: FormData) => Object.fromEntries(CAMPOS.map((c) => [c, String(fd.get(c) ?? '')]));

function tratar(e: unknown, v: Record<string, string>): ConsultaState {
  if (e instanceof ConsultaError) return { erros: e.erros, valores: v };
  if (e instanceof PacienteBloqueadoError) return { erros: { patientId: e.message }, valores: v };
  if (e instanceof PacienteNaoEncontradoError) return { erros: { patientId: 'Selecione o paciente' }, valores: v };
  if (e instanceof ConsultaNaoEncontradaError) notFound();
  throw e;
}

export async function agendarAction(_prev: ConsultaState, fd: FormData): Promise<ConsultaState> {
  const { ctx, tenant } = await requireNutri('/painel/agenda/nova');
  const v = valores(fd);
  let r: Awaited<ReturnType<typeof agendarPelaNutri>>;
  try {
    r = await agendarPelaNutri(ctx, tenant, v);
  } catch (e) {
    return tratar(e, v);
  }
  revalidatePath('/painel/agenda');
  redirect(`/painel/agenda/consultas/${r.id}?ok=marcada${r.avisos.length ? `&avisos=${r.avisos.join(',')}` : ''}`);
}

export async function moverAction(id: string, _prev: ConsultaState, fd: FormData): Promise<ConsultaState> {
  const { ctx, tenant } = await requireNutri(`/painel/agenda/consultas/${id}`);
  const v = valores(fd);
  let r: Awaited<ReturnType<typeof moverConsulta>>;
  try {
    r = await moverConsulta(ctx, tenant, id, v);
  } catch (e) {
    return tratar(e, v);
  }
  revalidatePath('/painel/agenda');
  redirect(`/painel/agenda/consultas/${id}?ok=alterada${r.avisos.length ? `&avisos=${r.avisos.join(',')}` : ''}`);
}
```

`src/app/painel/agenda/consulta-form.tsx` (o mesmo formulário para "Nova consulta" e "Alterar data e hora"; sem `pacientes`, não mostra o seletor):

```tsx
'use client';

import { useActionState, useState } from 'react';
import { Campo } from '@/components/campo';
import { DURACOES } from '@/modules/agenda/constantes';
import type { ConsultaState } from './actions';

type Props = {
  acao: (prev: ConsultaState, fd: FormData) => Promise<ConsultaState>;
  inicial: Record<string, string>;
  pacientes?: { id: string; nome: string; email: string }[];
  linkPadrao: string | null;
  botao: string;
};

export function ConsultaForm({ acao, inicial, pacientes, linkPadrao, botao }: Props) {
  const [state, action, pendente] = useActionState<ConsultaState, FormData>(acao, {});
  const v = state.valores ?? inicial;
  const e = state.erros ?? {};
  const [modalidade, setModalidade] = useState(v.modalidade || 'presencial');
  const aria = (k: string) => (e[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  const erro = (k: string) => e[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-red-700">{e[k]}</p>;
  return (
    <form action={action} className="max-w-xl space-y-4">
      {pacientes && (
        <div className="space-y-1">
          <label htmlFor="patientId" className="block font-medium">Paciente</label>
          <select id="patientId" name="patientId" defaultValue={v.patientId ?? ''} className="w-full rounded border p-2" {...aria('patientId')}>
            <option value="" disabled>Selecione o paciente</option>
            {pacientes.map((p) => <option key={p.id} value={p.id}>{`${p.nome} (${p.email})`}</option>)}
          </select>
          {erro('patientId')}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo id="data" rotulo="Data" type="date" required defaultValue={v.data} erro={e.data} />
        <Campo id="hora" rotulo="Hora" type="time" required defaultValue={v.hora} erro={e.hora} />
        <div className="space-y-1">
          <label htmlFor="duracaoMin" className="block font-medium">Duração</label>
          <select id="duracaoMin" name="duracaoMin" defaultValue={v.duracaoMin || '60'} className="w-full rounded border p-2" {...aria('duracaoMin')}>
            {DURACOES.map((d) => <option key={d} value={d}>{`${d} min`}</option>)}
          </select>
          {erro('duracaoMin')}
        </div>
      </div>
      <fieldset className="space-y-1" {...aria('modalidade')}>
        <legend className="font-medium">Modalidade</legend>
        {[['presencial', 'Presencial'], ['online', 'Online']].map(([valor, rotulo]) => (
          <div key={valor} className="flex items-center gap-2">
            <input id={`modalidade-${valor}`} name="modalidade" type="radio" value={valor} checked={modalidade === valor} onChange={() => setModalidade(valor)} />
            <label htmlFor={`modalidade-${valor}`}>{rotulo}</label>
          </div>
        ))}
        {erro('modalidade')}
      </fieldset>
      {modalidade === 'online' && (
        <Campo id="linkOnline" rotulo="Link da chamada" type="url" defaultValue={v.linkOnline} erro={e.linkOnline} placeholder={linkPadrao ?? 'https://…'} dica={linkPadrao ? 'Vazio = o link padrão do seu perfil.' : undefined} />
      )}
      {erro('geral')}
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">{botao}</button>
    </form>
  );
}
```

- [ ] **Step 5: Páginas**

`src/app/painel/agenda/item-consulta.tsx`:

```tsx
import Link from 'next/link';
import { ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import type { Consulta } from '@/modules/agenda/consultas';
import { partesNoFuso } from '@/modules/agenda/fuso';
import { selosDaConsulta } from './periodo';

export function ItemConsulta({ c, fuso, dentroDeBloqueio }: { c: Consulta; fuso: string; dentroDeBloqueio: boolean }) {
  const cancelada = c.status === 'cancelada';
  return (
    <li className={`rounded border p-2 text-sm ${cancelada ? 'text-zinc-500 line-through decoration-zinc-400' : ''}`}>
      <p className="font-medium">{`${partesNoFuso(c.inicio, fuso).hora}–${partesNoFuso(c.fim, fuso).hora}`}</p>
      <p><Link href={`/painel/agenda/consultas/${c.id}`} className="underline">{c.paciente}</Link>{` · ${ROTULO_MODALIDADE[c.modalidade]}`}</p>
      <ul className="mt-1 flex flex-wrap gap-1" aria-label="Situação">
        {selosDaConsulta(c, dentroDeBloqueio).map((s) => <li key={s} className="rounded bg-zinc-100 px-1.5 text-zinc-900 no-underline">{s}</li>)}
      </ul>
    </li>
  );
}
```

`src/app/painel/agenda/page.tsx`:

```tsx
import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { listarAgenda } from '@/modules/agenda/consultas';
import { listarBloqueios } from '@/modules/agenda/disponibilidade';
import { diaCurto, inicioDoDia, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { sobrepoe } from '@/modules/agenda/horarios';
import { dataValida, formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { Cabecalho } from '../cabecalho';
import { ItemConsulta } from './item-consulta';
import { lerVisao, periodoDaVisao, type Visao } from './periodo';

export const dynamic = 'force-dynamic';

const VISOES: [Visao, string][] = [['dia', 'Dia'], ['semana', 'Semana'], ['lista', 'Lista']];

export default async function AgendaPage({ searchParams }: PageProps<'/painel/agenda'>) {
  const { ctx, tenant } = await requireNutri('/painel/agenda');
  const sp = await searchParams;
  const visao = lerVisao(sp.visao);
  const hoje = hojeNoFuso(tenant.fuso);
  const data = typeof sp.data === 'string' && dataValida(sp.data) ? sp.data : hoje;
  const p = periodoDaVisao(visao, data);
  const de = inicioDoDia(p.dias[0], tenant.fuso);
  const ate = inicioDoDia(somarDias(p.dias.at(-1)!, 1), tenant.fuso);
  const [consultas, bloqueios] = await Promise.all([listarAgenda(ctx, de, ate), listarBloqueios(ctx, de, ate)]);
  const emBloqueio = (c: (typeof consultas)[number]) => bloqueios.some((b) => sobrepoe(b, c));
  const doDia = (dia: string) => consultas.filter((c) => partesNoFuso(c.inicio, tenant.fuso).data === dia);
  const href = (v: Visao, d: string) => `/painel/agenda?visao=${v}&data=${d}`;
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Agenda</h1>
          <div className="flex gap-3 text-sm">
            <Link href="/painel/agenda/horarios" className="underline">Horários de atendimento</Link>
            <Link href={`/painel/agenda/nova?data=${data}`} className="rounded bg-emerald-700 px-3 py-1.5 text-white">Nova consulta</Link>
          </div>
        </div>
        <nav aria-label="Período da agenda" className="flex flex-wrap items-center gap-3 text-sm">
          {VISOES.map(([v, r]) => <Link key={v} href={href(v, data)} aria-current={v === visao ? 'page' : undefined} className={v === visao ? 'font-semibold' : 'underline'}>{r}</Link>)}
          <span aria-hidden="true">·</span>
          <Link href={href(visao, hoje)} className="underline">Hoje</Link>
          <Link href={href(visao, p.anterior)} className="underline">Anterior</Link>
          <Link href={href(visao, p.proximo)} className="underline">Próximo</Link>
          <span>{visao === 'dia' ? diaCurto(data) : `${formatarData(p.dias[0])} a ${formatarData(p.dias.at(-1)!)}`}</span>
        </nav>
        {visao === 'lista' ? (
          consultas.length === 0 ? <p>Nenhuma consulta neste período.</p> : (
            <ul className="space-y-2">
              {consultas.map((c) => <ItemConsulta key={c.id} c={c} fuso={tenant.fuso} dentroDeBloqueio={emBloqueio(c)} />)}
            </ul>
          )
        ) : (
          <div className={`grid gap-3 ${visao === 'semana' ? 'md:grid-cols-7' : ''}`}>
            {p.dias.map((dia) => (
              <section key={dia} aria-labelledby={`dia-${dia}`} className="space-y-2">
                <h2 id={`dia-${dia}`} className={`text-sm font-semibold ${dia === hoje ? 'text-emerald-800' : ''}`}>{diaCurto(dia)}{dia === hoje ? ' (hoje)' : ''}</h2>
                {bloqueios.filter((b) => sobrepoe(b, { inicio: inicioDoDia(dia, tenant.fuso), fim: inicioDoDia(somarDias(dia, 1), tenant.fuso) })).map((b) => (
                  <p key={b.id} className="rounded bg-amber-50 p-2 text-sm text-amber-900">{b.motivo ? `Bloqueado: ${b.motivo}` : 'Bloqueado'}</p>
                ))}
                <ul className="space-y-2">
                  {doDia(dia).map((c) => <ItemConsulta key={c.id} c={c} fuso={tenant.fuso} dentroDeBloqueio={emBloqueio(c)} />)}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
```

`src/app/painel/agenda/nova/page.tsx`:

```tsx
import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { dataValida, hojeNoFuso } from '@/modules/pacientes/datas';
import { listarPacientes } from '@/modules/pacientes/pacientes';
import { Cabecalho } from '../../cabecalho';
import { agendarAction } from '../actions';
import { ConsultaForm } from '../consulta-form';

export const dynamic = 'force-dynamic';

export default async function NovaConsultaPage({ searchParams }: PageProps<'/painel/agenda/nova'>) {
  const { ctx, tenant } = await requireNutri('/painel/agenda/nova');
  const sp = await searchParams;
  const pacientes = await listarPacientes(ctx, { status: 'ativo' });
  const data = typeof sp.data === 'string' && dataValida(sp.data) ? sp.data : hojeNoFuso(tenant.fuso);
  const patientId = typeof sp.paciente === 'string' ? sp.paciente : '';
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="space-y-4 p-6">
        <p className="text-sm"><Link href={`/painel/agenda?data=${data}`} className="underline">Agenda</Link></p>
        <h1 className="text-2xl font-semibold">Nova consulta</h1>
        <ConsultaForm acao={agendarAction} pacientes={pacientes} linkPadrao={tenant.linkOnlinePadrao} botao="Marcar consulta"
          inicial={{ patientId, data, hora: '', duracaoMin: '60', modalidade: 'presencial', linkOnline: '' }} />
      </main>
    </>
  );
}
```

`src/app/painel/agenda/consultas/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_AGENDA, ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { buscarConsulta, STATUS_ATIVOS } from '@/modules/agenda/consultas';
import { listarBloqueios } from '@/modules/agenda/disponibilidade';
import { formatarQuando, partesNoFuso } from '@/modules/agenda/fuso';
import { sobrepoe } from '@/modules/agenda/horarios';
import { Cabecalho } from '../../../cabecalho';
import { moverAction } from '../../actions';
import { ConsultaForm } from '../../consulta-form';
import { AVISO_ROTULO, lerAvisos, selosDaConsulta } from '../../periodo';

export const dynamic = 'force-dynamic';

export default async function ConsultaPage({ params, searchParams }: PageProps<'/painel/agenda/consultas/[id]'>) {
  const { id } = await params;
  const sp = await searchParams;
  const { ctx, tenant } = await requireNutri(`/painel/agenda/consultas/${id}`);
  const c = await buscarConsulta(ctx, id);
  if (!c) notFound();
  const emBloqueio = (await listarBloqueios(ctx, c.inicio, c.fim)).some((b) => sobrepoe(b, c));
  const p = partesNoFuso(c.inicio, tenant.fuso);
  const ok = sp.ok === 'marcada' ? MSG_AGENDA.marcada : sp.ok === 'alterada' ? MSG_AGENDA.alterada : null;
  const ativa = STATUS_ATIVOS.includes(c.status);
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="space-y-6 p-6">
        <p className="text-sm"><Link href={`/painel/agenda?data=${p.data}`} className="underline">Agenda</Link></p>
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{`Consulta de ${c.paciente}`}</h1>
          <p>{`${formatarQuando(c.inicio, tenant.fuso)}–${partesNoFuso(c.fim, tenant.fuso).hora} · ${ROTULO_MODALIDADE[c.modalidade]}`}</p>
          {c.linkOnline && <p className="text-sm">Link da chamada: <a href={c.linkOnline} className="underline" rel="noreferrer" target="_blank">{c.linkOnline}</a></p>}
          <ul className="flex flex-wrap gap-1 text-sm" aria-label="Situação">
            {selosDaConsulta(c, emBloqueio).map((s) => <li key={s} className="rounded bg-zinc-100 px-1.5">{s}</li>)}
          </ul>
          <p className="text-sm"><Link href={`/painel/pacientes/${c.patientId}`} className="underline">Abrir prontuário</Link></p>
        </header>
        {ok && <p role="status" className="rounded bg-emerald-50 p-3">{ok}</p>}
        {lerAvisos(sp.avisos).map((a) => <p key={a} role="status" className="rounded bg-amber-50 p-3 text-amber-900">{AVISO_ROTULO[a]}</p>)}
        {/* Tarefa 15: Registrar presença e Iniciar atendimento */}
        {ativa && (
          <section aria-labelledby="alterar" className="space-y-2">
            <h2 id="alterar" className="text-lg font-semibold">Alterar data e hora</h2>
            <ConsultaForm acao={moverAction.bind(null, c.id)} linkPadrao={tenant.linkOnlinePadrao} botao="Salvar alteração"
              inicial={{ data: p.data, hora: p.hora, duracaoMin: String(Math.round((c.fim.getTime() - c.inicio.getTime()) / 60_000)), modalidade: c.modalidade, linkOnline: c.linkOnline ?? '' }} />
          </section>
        )}
        {/* Tarefa 7: Cancelar consulta · Tarefa 5: Lembretes */}
      </main>
    </>
  );
}
```

Em `src/app/painel/cabecalho.tsx`, no `<nav>`, depois de "Pacientes": `<Link href="/painel/agenda">Agenda</Link>`.

- [ ] **Step 6: E2E** — acrescentar a `e2e/agenda.spec.ts`

```ts
const sufixo = Date.now().toString(36);
/** Segunda-feira da semana seguinte à bloqueada: horários livres de 08:00 a 18:00 (Step 7 da Tarefa 2). */
const SEGUNDA_LIVRE = somar(SEMANA_BLOQUEADA, 7);

async function novoPaciente(nome: string, email: string): Promise<void> {
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(nome);
  await nutri.getByLabel('Data de nascimento').fill('1990-05-10');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(email);
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri).toHaveURL(/\/painel\/pacientes\/[0-9a-f-]{36}$/);
}

async function marcar(paciente: string, data: string, hora: string): Promise<void> {
  await nutri.goto(`/painel/agenda/nova?data=${data}`);
  await nutri.getByLabel('Paciente').selectOption({ label: paciente });
  await nutri.getByLabel('Hora').fill(hora);
  await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
}

test('agenda da nutricionista: marcar, conflito, avisos, semana e alterar (US-031)', async () => {
  await novoPaciente(`Carla Agenda ${sufixo}`, `carla-${sufixo}@ex.com`);
  await novoPaciente(`Dora Agenda ${sufixo}`, `dora-${sufixo}@ex.com`);
  const carla = `Carla Agenda ${sufixo} (carla-${sufixo}@ex.com)`;
  const dora = `Dora Agenda ${sufixo} (dora-${sufixo}@ex.com)`;
  await marcar(carla, SEGUNDA_LIVRE, '09:00');
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta marcada.' })).toBeVisible();
  await expect(nutri.getByRole('heading', { name: `Consulta de Carla Agenda ${sufixo}` })).toBeVisible();
  await marcar(dora, SEGUNDA_LIVRE, '09:30');
  await expect(nutri.getByRole('alert')).toHaveText(`Conflito com a consulta de Carla Agenda ${sufixo} às 09:00`);
  await nutri.getByLabel('Hora').fill('19:00');
  await nutri.getByRole('button', { name: 'Marcar consulta' }).click();
  await expect(nutri.getByText('Fora do seu horário de atendimento')).toBeVisible();
  await marcar(dora, somar(SEMANA_BLOQUEADA, 1), '10:00');
  await expect(nutri.getByText('Consulta dentro de um bloqueio').first()).toBeVisible();
  await nutri.goto(`/painel/agenda?visao=semana&data=${SEGUNDA_LIVRE}`);
  await expect(nutri.getByRole('link', { name: `Carla Agenda ${sufixo}` })).toBeVisible();
  await nutri.getByRole('link', { name: `Carla Agenda ${sufixo}` }).click();
  await nutri.getByLabel('Hora').fill('11:00');
  await nutri.getByRole('button', { name: 'Salvar alteração' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta alterada.' })).toBeVisible();
  await expect(nutri.getByText(/às 11:00–12:00 · Presencial/)).toBeVisible();
});
```

Run: `pnpm e2e:seed && pnpm test:e2e e2e/agenda.spec.ts`
Expected: PASS (2 testes).

- [ ] **Step 7: Commit**

```bash
git add src/app/painel/agenda src/app/painel/cabecalho.tsx e2e/agenda.spec.ts
git commit -m "feat(agenda): agenda de dia, semana e lista, nova consulta e alterar data e hora (US-031)"
```

---
### Task 5: Motor de lembretes — tabela `notifications`, 24 h/2 h, horário silencioso, envio por e-mail, link assinado, suspensão/reativação (P05-06)

**Files:**
- Create: `drizzle/0052_notificacoes.sql` (gerada), `drizzle/0053_rls_notificacoes.sql` (custom), `src/modules/notificacoes/tipos.ts`, `src/modules/notificacoes/tipos.test.ts`, `src/modules/notificacoes/agendar.ts`, `src/modules/notificacoes/agendar.test.ts`, `src/modules/notificacoes/mensagens.ts`, `src/modules/notificacoes/enviar.ts`, `src/modules/notificacoes/enviar.test.ts`, `src/modules/agenda/link-consulta.ts`, `src/modules/agenda/link-consulta.test.ts`, `test/email.ts`
- Modify: `src/db/schema/agenda.ts`, `src/db/audit-guard.ts` (`AUDIT_EXCEPTIONS`), `src/db/rls-guard.ts` (`PUBLICO_LIBERADO`), `test/isolamento.test.ts`, `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/jobs/queues.ts`, `src/worker/index.ts`, `src/modules/agenda/consultas.ts`, `src/modules/agenda/consultas.test.ts` (`afterAll`), `src/modules/plataforma/suspensao.ts`, `src/modules/plataforma/suspensao.test.ts`, `src/app/painel/agenda/consultas/[id]/page.tsx`, `scripts/e2e-seed.ts`, `e2e/agenda.spec.ts`

**Interfaces:**
- Consumes: `appointments`, `type AppointmentRow`, `STATUS_ATIVOS` (Tarefa 3); `partesNoFuso`, `paraInstante`, `somarDias`, `quandoComFuso`, `formatarQuando` (Tarefa 1); `patients`, `type PatientRow`, `type TenantRow`; `buscarTenant`, `getTenantStatus`, `listarTenantsParaVarredura` (`@/modules/plataforma/tenant-status`); `renderEmail`, `type EmailTransport`, `type OutgoingEmail`; `getBoss`, `fromDrizzle` (`pg-boss`); `encryptionKey` (`@/lib/crypto`); `urlDoApp`; `logger`.
- Produces:
  - Schema: `notifications` 🔒 (RLS por paciente, sem auditoria), `type NotificationRow`.
  - `@/modules/notificacoes/tipos`: `CANAIS`, `type Canal`, `type TipoNotificacao`, `type TipoLembrete`, `type StatusNotificacao`, `type MotivoIgnorada`, `ehLembrete(t): t is TipoLembrete`, `ROTULO_TIPO`, `ROTULO_CANAL`, `ROTULO_MOTIVO`, `situacaoDaNotificacao(n: Pick<NotificationRow, 'status' | 'motivoIgnorada' | 'agendadaPara' | 'enviadaEm'>, fuso: string): string`.
  - `@/modules/notificacoes/agendar`: `ANTECEDENCIA_MS`, `emHorarioSilencioso(instante, fuso): boolean`, `fimDoSilencio(agora, fuso): Date` (as próximas 08:00), `adiarLembrete(tipo, inicio, fuso, agora): Date | null` (D7 na reserva), `type PlanoLembrete`, `planejarLembretes(inicio, fuso, agora): PlanoLembrete[]`, `type ConsultaParaLembrete = { tenantId; patientId; appointmentId; inicio: Date }`, `agendarLembretes(tx, c, fuso, agora)` (a pendente de outro horário da mesma consulta vira `consulta_remarcada`), `avisarPaciente(tx, c, tipo: 'consulta_marcada' | 'consulta_cancelada', agora)`, `cancelarLembretes(tx, appointmentId, agora)`, `dispararEnvio(tx, tenantId)`, `ignorarPendentesDoTenant(db, tenantId, agora)` e `reagendarTenantReativado(db, tenantId, agora)` (os dois releem o status do tenant sob `FOR SHARE` na mesma transação), `listarNotificacoesDaConsulta(ctx, appointmentId, db?)`.
  - `@/modules/notificacoes/enviar`: `type ContextoEnvio = { n: NotificationRow; paciente: PatientRow; consulta: AppointmentRow | null; tenant: TenantRow; agora: Date }`, `type Resultado`, `type DepsEnvio = { db; agora: () => Date; appUrl: string; chaveLinks: Buffer; email: { transport: EmailTransport; from: string } }` (Tarefas 10 e 13 acrescentam `whatsapp` e `push`), `ESPERAS_S`, `TRAVADA_MS`, `LOTE_POR_EXECUCAO`, `LOTE_MIN_POR_TENANT`, `ordemDaRodada(ids, agora)`, `motivoParaIgnorar(c): Resultado | null`, `processarNotificacoes(deps, opts?: { tenantId?: string }): Promise<{ processadas: number }>`. Pontos de extensão internos: `escolherWhatsapp` (T10/T11), `CANAIS_ENVIO.whatsapp` (T10), `CANAIS_ENVIO.push` (T13), `aposEnvio` (T11).
  - `@/modules/notificacoes/mensagens`: `primeiroNome(nome)`, `ehHoje(c): boolean` (envio no dia da consulta, no fuso), `dadosDaConsulta(c, deps): { nutri; quando; hora; modalidade; local; link }`, `emailDaNotificacao(c, deps): EmailMessage | null`.
  - `@/modules/agenda/link-consulta`: `chaveDosLinks(encryptionKey: Buffer): Buffer`, `assinarLinkConsulta(c: { tenantId; appointmentId; inicio: Date }, chave): string`, `lerLinkConsulta(token, chave, agora): (LinkConsulta & { expirado: boolean }) | null`, `urlDaConsulta(appUrl, token): string`, `type LinkConsulta = { tenantId; appointmentId; expiraEm: Date }`.
  - `EmailMessage` ganha `{ tipo: 'consulta'; evento: 'lembrete_24h' | 'lembrete_2h' | 'consulta_marcada' | 'consulta_cancelada'; para; nome; nutri; quando; hora; modalidade: 'presencial' | 'online'; local: string | null; link: string | null }`; `templates.tsx` ganha o ajudante `simples(subject, linhas, botao?, depois?)`.
  - Filas `notificacoes` (cron `* * * * *` + envio imediato `{ tenantId }`) e `agenda-tenant` (`{ tenantId, evento: 'suspenso' | 'reativado' }`).
  - `test/email.ts`: `transporteFalso(opts?: { falhar?: number }): EmailTransport & { enviados: OutgoingEmail[] }`.

- [ ] **Step 1: Tabela** — acrescentar a `src/db/schema/agenda.ts` (o `smallint` já está importado)

```ts
/**
 * RN-05 / D6: uma linha por (consulta, canal, tipo, início da consulta). Marcar de novo no mesmo horário ou reativar
 * reescreve só a linha que não saiu; mudar o horário cria linhas novas — a enviada é imutável (cota, métricas, histórico).
 * As condições de cada canal (opt-in, cota, inscrição…) são conferidas no envio. Registro técnico: sem auditoria (D10).
 * `provider_jid`: destino real no WhatsApp (casa a resposta "1"/"2"); `conteudo_selado`: convite com link cifrado até o envio;
 * `inicio_consulta`: o horário da consulta para o qual a linha foi planejada (nulo só sem consulta: convite).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    appointmentId: uuid('appointment_id'),
    canal: text('canal').notNull(),
    tipo: text('tipo').notNull(),
    status: text('status').notNull().default('pendente'),
    motivoIgnorada: text('motivo_ignorada'),
    erro: text('erro'),
    providerMsgId: text('provider_msg_id').unique(),
    providerJid: text('provider_jid'),
    conteudoSelado: text('conteudo_selado'),
    tentativas: smallint('tentativas').notNull().default(0),
    inicioConsulta: timestamp('inicio_consulta', { withTimezone: true }),
    agendadaPara: timestamp('agendada_para', { withTimezone: true }).notNull(),
    enviadaEm: timestamp('enviada_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('notifications_canal_valido', sql`${t.canal} in ('email', 'whatsapp', 'push')`),
    check('notifications_tipo_valido', sql`${t.tipo} in ('lembrete_24h', 'lembrete_2h', 'consulta_marcada', 'consulta_cancelada', 'convite_paciente', 'resposta_confirmacao', 'resposta_remarcar')`),
    check('notifications_status_valido', sql`${t.status} in ('pendente', 'enviando', 'enviada', 'entregue', 'lida', 'falhou', 'ignorada')`),
    check('notifications_motivo_so_ignorada', sql`(${t.status} = 'ignorada') = (${t.motivoIgnorada} is not null)`),
    check('notifications_erro_tamanho', sql`char_length(${t.erro}) <= 60`),
    check('notifications_versao_da_consulta', sql`(${t.appointmentId} is null) = (${t.inicioConsulta} is null)`),
    unique('notifications_consulta_versao_unique').on(t.appointmentId, t.canal, t.tipo, t.inicioConsulta),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'notifications_paciente_fk' }),
    foreignKey({ columns: [t.tenantId, t.patientId, t.appointmentId], foreignColumns: [appointments.tenantId, appointments.patientId, appointments.id], name: 'notifications_consulta_fk' }),
    index('notifications_devidas_idx').on(t.tenantId, t.status, t.agendadaPara),
    index('notifications_envios_idx').on(t.tenantId, t.canal, t.enviadaEm),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
```

Run: `pnpm db:generate --name notificacoes` → `drizzle/0052_notificacoes.sql` (confira os 6 CHECKs, a FK composta com a consulta e o UNIQUE de 4 colunas).

Run: `pnpm drizzle-kit generate --custom --name rls_notificacoes` e preencher `drizzle/0053_rls_notificacoes.sql`:

```sql
SELECT app_enable_tenant_rls('notifications');
--> statement-breakpoint
SELECT app_enable_patient_rls('notifications');
--> statement-breakpoint
-- D11: os lembretes da consulta marcada pela página pública (Tarefa 8) nascem no contexto publico;
-- o INSERT … ON CONFLICT exige ler a linha nova ('select'). Nada de update/delete.
SELECT app_allow_publico('notifications', 'select', 'insert');
```

`src/db/rls-guard.ts`, `PUBLICO_LIBERADO`: `notifications: { comandos: ['select', 'insert'], motivo: 'lembretes da consulta marcada pela página pública (INSERT … ON CONFLICT lê a linha nova)' },`.

`src/db/audit-guard.ts`, no `AUDIT_EXCEPTIONS`:

```ts
  notifications: 'D10: registro técnico de entrega (canal, tipo, situação); nenhum dado clínico — o horário da consulta fica em appointments, que é auditada',
```

`test/isolamento.test.ts`, no `FABRICAS` (a consulta-mãe nasce no mesmo comando; `appointments` já está em `ULTIMAS`):

```ts
  notifications: (t, p) => {
    const h = horaIso();
    return sql`with c as (insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem)
        values (${t}, ${p}, ${h}, ${h} + interval '1 hour', 'presencial', 'nutri') returning id, inicio)
      insert into notifications (tenant_id, patient_id, appointment_id, inicio_consulta, canal, tipo, agendada_para) select ${t}, ${p}, c.id, c.inicio, 'email', 'lembrete_24h', now() from c`;
  },
```

Em `scripts/e2e-seed.ts`: `const AGENDA_E2E = ['notifications', 'appointments', 'availability_blocks', 'availability_rules'];`.

Run: `pnpm test src/db test/isolamento.test.ts`
Expected: PASS.

- [ ] **Step 2: Link assinado da consulta (D20)** — teste `src/modules/agenda/link-consulta.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { assinarLinkConsulta, chaveDosLinks, lerLinkConsulta, urlDaConsulta } from './link-consulta';

const chave = chaveDosLinks(Buffer.alloc(32, 9));
const c = { tenantId: '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f', appointmentId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', inicio: new Date('2026-10-16T17:00:00Z') };

describe('link assinado da consulta (D20)', () => {
  it('ida e volta; 71 caracteres sem padding; expira no início da consulta', () => {
    const t = assinarLinkConsulta(c, chave);
    expect(t).toMatch(/^[A-Za-z0-9_-]{71}$/);
    expect(lerLinkConsulta(t, chave, new Date('2026-10-15T00:00:00Z'))).toEqual({ tenantId: c.tenantId, appointmentId: c.appointmentId, expiraEm: c.inicio, expirado: false });
    expect(lerLinkConsulta(t, chave, c.inicio)?.expirado).toBe(true);
    expect(urlDaConsulta('https://app.exemplo.com', t)).toBe(`https://app.exemplo.com/consulta/${t}`);
  });
  it('adulterado, de outra chave ou com outro tamanho → null', () => {
    const t = assinarLinkConsulta(c, chave);
    const trocado = t.slice(0, 10) + (t[10] === 'A' ? 'B' : 'A') + t.slice(11);
    expect(lerLinkConsulta(trocado, chave, new Date())).toBeNull();
    expect(lerLinkConsulta(t, chaveDosLinks(Buffer.alloc(32, 1)), new Date())).toBeNull();
    expect(lerLinkConsulta(`${t}A`, chave, new Date())).toBeNull();
    expect(lerLinkConsulta('../../etc', chave, new Date())).toBeNull();
  });
});
```

Run: `pnpm test src/modules/agenda/link-consulta.test.ts` → FAIL (módulo não existe).

`src/modules/agenda/link-consulta.ts`:

```ts
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { urlDoApp } from '@/lib/url-do-app';

const VERSAO = 1;
const uuidParaBytes = (u: string) => Buffer.from(u.replace(/-/g, ''), 'hex');
const bytesParaUuid = (b: Buffer) => {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export type LinkConsulta = { tenantId: string; appointmentId: string; expiraEm: Date };

/** D20: chave só dos links, derivada (HKDF) de ENCRYPTION_KEY — app e worker já têm; nenhuma variável nova. */
export function chaveDosLinks(encryptionKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', encryptionKey, Buffer.alloc(0), 'nutridebby:link-consulta:v1', 32));
}

const mac = (corpo: Buffer, chave: Buffer) => createHmac('sha256', chave).update(corpo).digest().subarray(0, 16);

/** Versão + tenant + consulta + validade (início da consulta, em segundos) + HMAC truncado em 128 bits. */
export function assinarLinkConsulta(c: { tenantId: string; appointmentId: string; inicio: Date }, chave: Buffer): string {
  const corpo = Buffer.alloc(37);
  corpo.writeUInt8(VERSAO, 0);
  uuidParaBytes(c.tenantId).copy(corpo, 1);
  uuidParaBytes(c.appointmentId).copy(corpo, 17);
  corpo.writeUInt32BE(Math.floor(c.inicio.getTime() / 1000), 33);
  return Buffer.concat([corpo, mac(corpo, chave)]).toString('base64url');
}

/** null = formato, versão ou assinatura inválidos. `expirado` = a consulta já começou. */
export function lerLinkConsulta(token: string, chave: Buffer, agora: Date): (LinkConsulta & { expirado: boolean }) | null {
  if (!/^[A-Za-z0-9_-]{71}$/.test(token)) return null;
  const b = Buffer.from(token, 'base64url');
  if (b.length !== 53 || b.readUInt8(0) !== VERSAO) return null;
  const corpo = b.subarray(0, 37);
  if (!timingSafeEqual(mac(corpo, chave), b.subarray(37))) return null;
  const expiraEm = new Date(corpo.readUInt32BE(33) * 1000);
  return { tenantId: bytesParaUuid(corpo.subarray(1, 17)), appointmentId: bytesParaUuid(corpo.subarray(17, 33)), expiraEm, expirado: expiraEm.getTime() <= agora.getTime() };
}

export const urlDaConsulta = (appUrl: string, token: string) => urlDoApp(appUrl, `/consulta/${token}`);
```

Run: `pnpm test src/modules/agenda/link-consulta.test.ts` → PASS (2 testes).

- [ ] **Step 3: Tipos e textos da situação** — `src/modules/notificacoes/tipos.ts`

```ts
import type { NotificationRow } from '@/db/schema';
import { formatarQuando } from '@/modules/agenda/fuso';

export const CANAIS = ['email', 'whatsapp', 'push'] as const;
export type Canal = (typeof CANAIS)[number];
export type TipoLembrete = 'lembrete_24h' | 'lembrete_2h';
export type TipoNotificacao = TipoLembrete | 'consulta_marcada' | 'consulta_cancelada' | 'convite_paciente' | 'resposta_confirmacao' | 'resposta_remarcar';
export type StatusNotificacao = 'pendente' | 'enviando' | 'enviada' | 'entregue' | 'lida' | 'falhou' | 'ignorada';
export type MotivoIgnorada =
  | 'prazo_passado' | 'horario_silencioso' | 'consulta_cancelada' | 'consulta_remarcada' | 'consulta_encerrada' | 'paciente_inativo' | 'tenant_suspenso'
  | 'sem_optin' | 'sem_telefone' | 'whatsapp_desligado' | 'whatsapp_desconectado' | 'cota_esgotada' | 'sem_inscricao' | 'push_desligado';

export const ehLembrete = (t: string): t is TipoLembrete => t === 'lembrete_24h' || t === 'lembrete_2h';

export const ROTULO_TIPO: Record<TipoNotificacao, string> = {
  lembrete_24h: 'Lembrete de 24 h',
  lembrete_2h: 'Lembrete de 2 h',
  consulta_marcada: 'Confirmação da marcação',
  consulta_cancelada: 'Aviso de cancelamento',
  convite_paciente: 'Convite',
  resposta_confirmacao: 'Resposta ao paciente',
  resposta_remarcar: 'Resposta ao paciente',
};
export const ROTULO_CANAL: Record<Canal, string> = { email: 'E-mail', whatsapp: 'WhatsApp', push: 'Notificação no app' };
export const ROTULO_MOTIVO: Record<MotivoIgnorada, string> = {
  prazo_passado: 'já tinha passado do horário',
  horario_silencioso: 'horário silencioso (21h–8h)',
  consulta_cancelada: 'consulta cancelada',
  consulta_remarcada: 'consulta remarcada',
  consulta_encerrada: 'consulta encerrada',
  paciente_inativo: 'paciente arquivado ou bloqueado',
  tenant_suspenso: 'conta suspensa',
  sem_optin: 'sem autorização de WhatsApp',
  sem_telefone: 'sem telefone',
  whatsapp_desligado: 'WhatsApp não configurado na plataforma',
  whatsapp_desconectado: 'WhatsApp desconectado',
  cota_esgotada: 'cota de WhatsApp do mês esgotada',
  sem_inscricao: 'paciente sem notificações no app',
  push_desligado: 'notificações no app não configuradas',
};

/** Situação em texto (US-034; acessibilidade: nunca só cor). */
export function situacaoDaNotificacao(n: Pick<NotificationRow, 'status' | 'motivoIgnorada' | 'agendadaPara' | 'enviadaEm'>, fuso: string): string {
  switch (n.status as StatusNotificacao) {
    case 'pendente':
      return `Agendado para ${formatarQuando(n.agendadaPara, fuso)}`;
    case 'enviando':
      return 'Enviando…';
    case 'enviada':
      return `Enviado em ${formatarQuando(n.enviadaEm ?? n.agendadaPara, fuso)}`;
    case 'entregue':
      return 'Entregue';
    case 'lida':
      return 'Lido';
    case 'falhou':
      return 'Falhou';
    case 'ignorada':
      return `Não enviado: ${ROTULO_MOTIVO[n.motivoIgnorada as MotivoIgnorada] ?? 'motivo desconhecido'}`;
    default:
      return n.status;
  }
}
```

`src/modules/notificacoes/tipos.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { situacaoDaNotificacao } from './tipos';

const SP = 'America/Sao_Paulo';
const base = { agendadaPara: new Date('2026-10-15T17:00:00Z'), enviadaEm: null, motivoIgnorada: null };

describe('situação do lembrete em texto', () => {
  it('agendado, enviado, entregue, lido, falhou e os motivos de não envio', () => {
    expect(situacaoDaNotificacao({ ...base, status: 'pendente' }, SP)).toBe('Agendado para qui., 15/10/2026 às 14:00');
    expect(situacaoDaNotificacao({ ...base, status: 'enviada', enviadaEm: new Date('2026-10-15T17:00:30Z') }, SP)).toBe('Enviado em qui., 15/10/2026 às 14:00');
    expect(situacaoDaNotificacao({ ...base, status: 'lida' }, SP)).toBe('Lido');
    expect(situacaoDaNotificacao({ ...base, status: 'ignorada', motivoIgnorada: 'horario_silencioso' }, SP)).toBe('Não enviado: horário silencioso (21h–8h)');
    expect(situacaoDaNotificacao({ ...base, status: 'ignorada', motivoIgnorada: 'cota_esgotada' }, SP)).toBe('Não enviado: cota de WhatsApp do mês esgotada');
    expect(situacaoDaNotificacao({ ...base, status: 'ignorada', motivoIgnorada: 'consulta_remarcada' }, SP)).toBe('Não enviado: consulta remarcada');
  });
});
```

Run: `pnpm test src/modules/notificacoes/tipos.test.ts`
Expected: PASS.

- [ ] **Step 4: Testes do agendamento dos lembretes (falham)** — `src/modules/notificacoes/agendar.test.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { em, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { getBoss, stopBoss } from '@/jobs/boss';
import { agendarPelaNutri, moverConsulta } from '@/modules/agenda/consultas';
import { suspenderConta, reativarConta } from '@/modules/plataforma/suspensao';
import { adiarLembrete, emHorarioSilencioso, fimDoSilencio, ignorarPendentesDoTenant, planejarLembretes, reagendarTenantReativado } from './agendar';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = 'America/Sao_Paulo';
const resumo = (ps: { tipo: string; agendadaPara: Date; status: string; motivo?: string }[]) => ps.map((p) => [p.tipo, p.agendadaPara.toISOString(), p.status, p.motivo ?? null]);

describe('planejarLembretes (RN-05, US-034)', () => {
  it('consulta em 16/10 às 14:00 → 24 h em 15/10 14:00 e 2 h em 16/10 12:00', () => {
    expect(resumo(planejarLembretes(em('2026-10-16', '14:00'), SP, em('2026-10-10', '09:00')))).toEqual([
      ['lembrete_24h', '2026-10-15T17:00:00.000Z', 'pendente', null],
      ['lembrete_2h', '2026-10-16T15:00:00.000Z', 'pendente', null],
    ]);
  });
  it('consulta às 08:00 → 24 h às 08:00 (vale) e 2 h às 06:00 → "horario_silencioso"', () => {
    expect(resumo(planejarLembretes(em('2026-10-16', '08:00'), SP, em('2026-10-10', '09:00'))).map((x) => [x[0], x[2], x[3]])).toEqual([
      ['lembrete_24h', 'pendente', null],
      ['lembrete_2h', 'ignorada', 'horario_silencioso'],
    ]);
  });
  it('criada às 10:00 para as 15:00 do mesmo dia → 24 h "prazo_passado" e 2 h às 13:00', () => {
    expect(resumo(planejarLembretes(em('2026-10-16', '15:00'), SP, em('2026-10-16', '10:00')))).toEqual([
      ['lembrete_24h', '2026-10-15T18:00:00.000Z', 'ignorada', 'prazo_passado'],
      ['lembrete_2h', '2026-10-16T16:00:00.000Z', 'pendente', null],
    ]);
  });
  it('bordas do silêncio [21:00, 08:00) no fuso do tenant (Review Focus 2)', () => {
    expect(['20:59', '21:00', '07:59', '08:00'].map((h) => emHorarioSilencioso(em('2026-10-16', h), SP))).toEqual([false, true, true, false]);
  });
  it('D7 na reserva (rodada 1): lembrete que venceu no silêncio vai para as 08:00 só se ainda fizer sentido para o tipo', () => {
    expect(fimDoSilencio(em('2026-10-15', '21:00'), SP)).toEqual(em('2026-10-16', '08:00'));
    expect(fimDoSilencio(em('2026-10-16', '07:59'), SP)).toEqual(em('2026-10-16', '08:00'));
    expect(adiarLembrete('lembrete_24h', em('2026-10-16', '14:00'), SP, em('2026-10-15', '23:30'))).toEqual(em('2026-10-16', '08:00'));
    expect(adiarLembrete('lembrete_24h', em('2026-10-16', '10:00'), SP, em('2026-10-16', '06:00'))).toBeNull(); // o de 2 h sai às 08:00
    expect(adiarLembrete('lembrete_24h', em('2026-10-16', '09:00'), SP, em('2026-10-16', '06:00'))).toEqual(em('2026-10-16', '08:00')); // o de 2 h (07:00) caiu no silêncio
    expect(adiarLembrete('lembrete_2h', em('2026-10-17', '07:00'), SP, em('2026-10-16', '22:00'))).toBeNull(); // as 08:00 já seriam depois da consulta
  });
});

describe('lembretes da consulta no banco', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const linhas = (ctx: Parameters<typeof withTenant>[0], appointmentId: string) =>
    withTenant(ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, appointmentId)), app.db);

  it('marcar cria 24 h e 2 h nos 3 canais + "Consulta marcada" por e-mail e push, e pede envio imediato', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now });
    const ls = await linhas(T.ctx, id);
    expect(ls.map((l) => `${l.tipo}/${l.canal}/${l.status}`).sort()).toEqual([
      'consulta_marcada/email/pendente', 'consulta_marcada/push/pendente',
      'lembrete_24h/email/pendente', 'lembrete_24h/push/pendente', 'lembrete_24h/whatsapp/pendente',
      'lembrete_2h/email/pendente', 'lembrete_2h/push/pendente', 'lembrete_2h/whatsapp/pendente',
    ]);
    expect(ls.find((l) => l.tipo === 'lembrete_24h')?.agendadaPara).toEqual(em('2026-10-15', '14:00'));
    const jobs = await (await getBoss()).findJobs<{ tenantId?: string }>('notificacoes');
    expect(jobs.some((j) => j.data.tenantId === T.tenantId)).toBe(true);
  });

  it('alterar a hora (D6/D17, rodada 1): o horário novo ganha linhas próprias, a pendente do antigo vira "consulta_remarcada" e a enviada não é reaberta; o mesmo horário de novo não duplica', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now });
    const enviadaEm = em('2026-10-15', '14:00');
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'enviada', enviadaEm, tentativas: 1 }).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'lembrete_24h'), eq(notifications.canal, 'email'))), app.db);
    const novo = { data: '2026-10-17', hora: '08:00', duracaoMin: '60', modalidade: 'presencial' };
    await moverConsulta(T.ctx, tenantAgenda(T), id, novo, { db: app.db, now: em('2026-10-15', '15:00') });
    const depois = await linhas(T.ctx, id);
    const doHorario = (data: string, hora: string) => depois.filter((l) => l.inicioConsulta?.getTime() === em(data, hora).getTime());
    const antigo = doHorario('2026-10-16', '14:00');
    const atual = doHorario('2026-10-17', '08:00');
    expect(antigo.find((l) => l.tipo === 'lembrete_24h' && l.canal === 'email')).toMatchObject({ status: 'enviada', enviadaEm, tentativas: 1 });
    expect(antigo.filter((l) => l.status === 'pendente')).toEqual([]);
    expect(antigo.filter((l) => l.tipo === 'lembrete_2h').every((l) => l.status === 'ignorada' && l.motivoIgnorada === 'consulta_remarcada')).toBe(true);
    expect(atual.filter((l) => l.tipo === 'lembrete_2h').every((l) => l.status === 'ignorada' && l.motivoIgnorada === 'horario_silencioso')).toBe(true);
    expect(atual.find((l) => l.tipo === 'lembrete_24h' && l.canal === 'email')).toMatchObject({ status: 'pendente', agendadaPara: em('2026-10-16', '08:00') });
    await moverConsulta(T.ctx, tenantAgenda(T), id, { ...novo, duracaoMin: '45' }, { db: app.db, now: em('2026-10-15', '15:00') });
    expect(await linhas(T.ctx, id)).toHaveLength(depois.length); // mesmo horário: as mesmas linhas
  });

  it('US-004: suspender enfileira o job; o worker troca os pendentes para "tenant_suspenso"; reativar reagenda os futuros', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now });
    await suspenderConta(T.tenantId, T.nutriId, app.db);
    const jobs = await (await getBoss()).findJobs<{ tenantId: string; evento: string }>('agenda-tenant');
    expect(jobs.some((j) => j.data.tenantId === T.tenantId && j.data.evento === 'suspenso')).toBe(true);
    await ignorarPendentesDoTenant(app.db, T.tenantId, now);
    expect((await linhas(T.ctx, id)).every((l) => l.status === 'ignorada' && l.motivoIgnorada === 'tenant_suspenso')).toBe(true);
    await reativarConta(T.tenantId, T.nutriId, app.db);
    await reagendarTenantReativado(app.db, T.tenantId, now);
    const lembretes = (await linhas(T.ctx, id)).filter((l) => l.tipo.startsWith('lembrete'));
    expect(lembretes.every((l) => l.status === 'pendente' && l.motivoIgnorada === null)).toBe(true);
    // a confirmação de marcação ignorada na suspensão não é reenviada
    const marcada = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'consulta_marcada'))), app.db);
    expect(marcada.every((l) => l.motivoIgnorada === 'tenant_suspenso')).toBe(true);
  });

  it('US-004 (rodada 1): jobs fora de ordem — o "suspenso" atrasado, que roda depois da reativação, não ignora nada; o "reativado" atrasado não reabre nada numa nova suspensão', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now });
    const lembretes = async () => (await linhas(T.ctx, id)).filter((l) => l.tipo.startsWith('lembrete'));
    await suspenderConta(T.tenantId, T.nutriId, app.db);
    await reativarConta(T.tenantId, T.nutriId, app.db);
    await reagendarTenantReativado(app.db, T.tenantId, now); // o "reativado" rodou primeiro…
    await ignorarPendentesDoTenant(app.db, T.tenantId, now); // …e o "suspenso" depois: o status relido sob trava é "ativa"
    expect((await lembretes()).every((l) => l.status === 'pendente')).toBe(true);
    await suspenderConta(T.tenantId, T.nutriId, app.db);
    await ignorarPendentesDoTenant(app.db, T.tenantId, now);
    await reagendarTenantReativado(app.db, T.tenantId, now); // "reativado" atrasado de antes: a conta está suspensa
    expect((await lembretes()).every((l) => l.status === 'ignorada' && l.motivoIgnorada === 'tenant_suspenso')).toBe(true);
    await reativarConta(T.tenantId, T.nutriId, app.db);
    await reagendarTenantReativado(app.db, T.tenantId, now); // a reativação reagenda o que a suspensão ignorou
    expect((await lembretes()).every((l) => l.status === 'pendente' && l.motivoIgnorada === null)).toBe(true);
  });
});
```

Run: `pnpm test src/modules/notificacoes/agendar.test.ts`
Expected: FAIL ("Failed to resolve import './agendar'").

- [ ] **Step 5: Implementar o agendamento** — `src/modules/notificacoes/agendar.ts`

```ts
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, notifications, type NotificationRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getBoss } from '@/jobs/boss';
import { paraInstante, partesNoFuso, somarDias } from '@/modules/agenda/fuso';
import { buscarTenant, getTenantStatus } from '@/modules/plataforma/tenant-status';
import { CANAIS, type TipoLembrete } from './tipos';

export const ANTECEDENCIA_MS: Record<TipoLembrete, number> = { lembrete_24h: 24 * 3_600_000, lembrete_2h: 2 * 3_600_000 };

/** RN-05 / D7: [21:00, 08:00) no fuso do tenant; 08:00 em ponto vale. */
export function emHorarioSilencioso(instante: Date, fuso: string): boolean {
  const { minutos } = partesNoFuso(instante, fuso);
  return minutos >= 21 * 60 || minutos < 8 * 60;
}

/** As próximas 08:00 no fuso do tenant (o fim do horário silencioso em que `agora` está). 08:00 sempre existe (DST não mexe nessa hora). */
export function fimDoSilencio(agora: Date, fuso: string): Date {
  const { data, minutos } = partesNoFuso(agora, fuso);
  return paraInstante(minutos >= 21 * 60 ? somarDias(data, 1) : data, '08:00', fuso)!;
}

/**
 * D7 na reserva (rodada 1 do /code-review): lembrete que venceu e sairia no horário silencioso (worker parado,
 * reativação à noite) vai para as 08:00 se ainda fizer sentido — o de 24 h só até o lembrete de 2 h (que cobre a reta
 * final), ou até 30 min antes do início quando o de 2 h caiu no silêncio; o de 2 h, até 30 min antes. Senão, null (ignorar).
 */
export function adiarLembrete(tipo: TipoLembrete, inicio: Date, fuso: string, agora: Date): Date | null {
  const as8 = fimDoSilencio(agora, fuso);
  const de2h = new Date(inicio.getTime() - ANTECEDENCIA_MS.lembrete_2h);
  if (tipo === 'lembrete_24h' && !emHorarioSilencioso(de2h, fuso)) return as8.getTime() < de2h.getTime() ? as8 : null;
  return as8.getTime() <= inicio.getTime() - 30 * 60_000 ? as8 : null;
}

export type PlanoLembrete = { tipo: TipoLembrete; agendadaPara: Date } & ({ status: 'pendente' } | { status: 'ignorada'; motivo: 'prazo_passado' | 'horario_silencioso' });

/** RN-05: 24 h e 2 h antes; horário já passado ou silencioso → "ignorada" com o motivo (não é adiado). */
export function planejarLembretes(inicio: Date, fuso: string, agora: Date): PlanoLembrete[] {
  return (Object.keys(ANTECEDENCIA_MS) as TipoLembrete[]).map((tipo) => {
    const agendadaPara = new Date(inicio.getTime() - ANTECEDENCIA_MS[tipo]);
    if (agendadaPara.getTime() <= agora.getTime()) return { tipo, agendadaPara, status: 'ignorada', motivo: 'prazo_passado' };
    if (emHorarioSilencioso(agendadaPara, fuso)) return { tipo, agendadaPara, status: 'ignorada', motivo: 'horario_silencioso' };
    return { tipo, agendadaPara, status: 'pendente' };
  });
}

export type ConsultaParaLembrete = { tenantId: string; patientId: string; appointmentId: string; inicio: Date };
type Linha = Pick<typeof notifications.$inferInsert, 'tenantId' | 'patientId' | 'appointmentId' | 'inicioConsulta' | 'canal' | 'tipo' | 'status' | 'motivoIgnorada' | 'agendadaPara'>;

/**
 * D6 (rodada 1 do /code-review): (consulta, canal, tipo, início da consulta) é UNIQUE. Marcar de novo no mesmo horário
 * ou reativar reescreve só a linha que NÃO saiu (`pendente`, `ignorada`, `falhou`); a enviada (e a que está saindo)
 * é imutável — não volta a "pendente" nem perde `enviada_em`/`provider_msg_id` (cota, métricas, histórico).
 */
async function gravar(tx: Tx, linhas: Linha[], agora: Date): Promise<void> {
  if (!linhas.length) return;
  await tx
    .insert(notifications)
    .values(linhas.map((l) => ({ ...l, tentativas: 0, createdAt: agora, updatedAt: agora })))
    .onConflictDoUpdate({
      target: [notifications.appointmentId, notifications.canal, notifications.tipo, notifications.inicioConsulta],
      set: { status: sql`excluded.status`, motivoIgnorada: sql`excluded.motivo_ignorada`, agendadaPara: sql`excluded.agendada_para`, tentativas: 0, erro: null, updatedAt: agora },
      setWhere: inArray(notifications.status, ['pendente', 'ignorada', 'falhou']),
    });
}

/** D17 (rodada 1): o horário da consulta mudou — o que ainda não saiu para o horário antigo vira "consulta_remarcada". */
async function descartarHorarioAntigo(tx: Tx, c: ConsultaParaLembrete, agora: Date): Promise<void> {
  await tx
    .update(notifications)
    .set({ status: 'ignorada', motivoIgnorada: 'consulta_remarcada', updatedAt: agora })
    .where(and(eq(notifications.appointmentId, c.appointmentId), eq(notifications.status, 'pendente'), ne(notifications.inicioConsulta, c.inicio)));
}

/** RN-05 / D6: 24 h e 2 h antes, nos três canais; as condições de cada canal são conferidas no envio. */
export async function agendarLembretes(tx: Tx, c: ConsultaParaLembrete, fuso: string, agora: Date): Promise<void> {
  await descartarHorarioAntigo(tx, c, agora);
  await gravar(
    tx,
    planejarLembretes(c.inicio, fuso, agora).flatMap((p) =>
      CANAIS.map((canal) => ({
        tenantId: c.tenantId,
        patientId: c.patientId,
        appointmentId: c.appointmentId,
        inicioConsulta: c.inicio,
        canal,
        tipo: p.tipo,
        status: p.status,
        motivoIgnorada: p.status === 'ignorada' ? p.motivo : null,
        agendadaPara: p.agendadaPara,
      })),
    ),
    agora,
  );
}

/** US-031 / US-033: "Consulta marcada" (também ao mudar o horário) e "Consulta cancelada", por e-mail e push, já. */
export async function avisarPaciente(tx: Tx, c: ConsultaParaLembrete, tipo: 'consulta_marcada' | 'consulta_cancelada', agora: Date): Promise<void> {
  if (tipo === 'consulta_marcada' && c.inicio.getTime() <= agora.getTime()) return; // encaixe registrado depois (D22)
  await gravar(
    tx,
    (['email', 'push'] as const).map((canal) => ({ tenantId: c.tenantId, patientId: c.patientId, appointmentId: c.appointmentId, inicioConsulta: c.inicio, canal, tipo, status: 'pendente', motivoIgnorada: null, agendadaPara: agora })),
    agora,
  );
}

/** US-033: o que ainda não saiu da consulta cancelada vira "ignorada". */
export async function cancelarLembretes(tx: Tx, appointmentId: string, agora: Date): Promise<void> {
  await tx
    .update(notifications)
    .set({ status: 'ignorada', motivoIgnorada: 'consulta_cancelada', updatedAt: agora })
    .where(and(eq(notifications.appointmentId, appointmentId), eq(notifications.status, 'pendente'), inArray(notifications.tipo, ['lembrete_24h', 'lembrete_2h', 'consulta_marcada'])));
}

/** Envio já (sem esperar a varredura do minuto): enfileira a varredura só deste tenant, na mesma transação. */
export async function dispararEnvio(tx: Tx, tenantId: string): Promise<void> {
  const id = await (await getBoss()).send('notificacoes', { tenantId }, { db: fromDrizzle(tx, sql) });
  if (!id) throw new Error('A fila de notificações recusou o envio');
}

/**
 * US-004 / RN-15: tenant suspenso — nada pendente sai. Roda no worker (o admin nunca toca tabela 🔒). Rodada 1: o
 * status é relido sob trava (`FOR SHARE` em `tenants`, na mesma transação). Um job "suspenso" atrasado, que roda
 * depois da reativação, não ignora nada; uma reativação concorrente espera esta transação e o job "reativado" dela
 * reagenda o que foi ignorado aqui.
 */
export async function ignorarPendentesDoTenant(db: Db, tenantId: string, agora: Date): Promise<void> {
  await withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      if ((await getTenantStatus(tx, tenantId, { aguardarSuspensao: true })) !== 'suspensa') return;
      await tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: 'tenant_suspenso', updatedAt: agora }).where(eq(notifications.status, 'pendente'));
    },
    db,
  );
}

/** US-004 "Reativar": os lembretes ignorados pela suspensão, de consultas futuras ativas, voltam a valer (RN-05). */
export async function reagendarTenantReativado(db: Db, tenantId: string, agora: Date): Promise<void> {
  const tenant = await buscarTenant(db, tenantId); // o fuso; lido antes da transação (uma conexão por vez)
  if (!tenant) return;
  await withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      // rodada 1: relido sob trava — um "reativado" atrasado, que roda depois de uma nova suspensão, não reabre nada
      if ((await getTenantStatus(tx, tenantId, { aguardarSuspensao: true })) !== 'ativa') return;
      const alvo = await tx
        .selectDistinct({ id: appointments.id, inicio: appointments.inicio })
        .from(notifications)
        .innerJoin(appointments, eq(appointments.id, notifications.appointmentId))
        .where(and(eq(notifications.motivoIgnorada, 'tenant_suspenso'), inArray(appointments.status, ['agendada', 'confirmada']), gt(appointments.inicio, agora)));
      for (const c of alvo) {
        for (const p of planejarLembretes(c.inicio, tenant.fuso, agora)) {
          await tx
            .update(notifications)
            .set({ status: p.status, motivoIgnorada: p.status === 'ignorada' ? p.motivo : null, agendadaPara: p.agendadaPara, tentativas: 0, erro: null, updatedAt: agora })
            .where(and(eq(notifications.appointmentId, c.id), eq(notifications.inicioConsulta, c.inicio), eq(notifications.tipo, p.tipo), eq(notifications.motivoIgnorada, 'tenant_suspenso')));
        }
      }
    },
    db,
  );
}

/** Lembretes da consulta para a tela da nutricionista (US-034). */
export async function listarNotificacoesDaConsulta(ctx: TenantContext, appointmentId: string, db: Db = getDb()): Promise<NotificationRow[]> {
  return withTenant(ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, appointmentId)).orderBy(asc(notifications.agendadaPara), asc(notifications.tipo), asc(notifications.canal)), db);
}
```

Em `src/modules/agenda/consultas.ts` (imports: `agendarLembretes`, `avisarPaciente`, `dispararEnvio` de `@/modules/notificacoes/agendar`):
- em `agendarPelaNutri`, no lugar do comentário "Tarefa 5":

```ts
        const alvo = { tenantId: ctx.tenantId, patientId: p.id, appointmentId: c.id, inicio: c.inicio };
        await agendarLembretes(tx, alvo, tenant.fuso, now);
        await avisarPaciente(tx, alvo, 'consulta_marcada', now);
        await dispararEnvio(tx, ctx.tenantId);
```

- em `moverConsulta`, depois do `update` (no lugar do comentário "Tarefa 5"):

```ts
        const alvo = { tenantId: ctx.tenantId, patientId: c.patientId, appointmentId: id, inicio: v.inicio };
        await agendarLembretes(tx, alvo, tenant.fuso, now);
        await avisarPaciente(tx, alvo, 'consulta_marcada', now);
        await dispararEnvio(tx, ctx.tenantId);
```

Em `src/modules/agenda/consultas.test.ts`, o `afterAll` passa a:

```ts
afterAll(async () => {
  await stopBoss(); // marcar e alterar enfileiram o envio (Tarefa 5)
  await closeDb();
  await app.pool.end();
});
```

(imports `closeDb` de `@/db/client` e `stopBoss` de `@/jobs/boss`).

`src/modules/plataforma/suspensao.ts`:

```ts
import { eq, inArray, sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import { getDb, type Db, type Tx } from '@/db/client';
import { getBoss } from '@/jobs/boss';
// … demais imports existentes

/** US-004 / P05-06: o worker troca os lembretes do tenant (o admin nunca toca tabela 🔒, CLAUDE.md regra 1). */
async function avisarAgenda(tx: Tx, tenantId: string, evento: 'suspenso' | 'reativado') {
  const id = await (await getBoss()).send('agenda-tenant', { tenantId, evento }, { db: fromDrizzle(tx, sql) });
  if (!id) throw new Error('A fila da agenda recusou o envio');
}
```

e chame `await avisarAgenda(tx, tenantId, 'suspenso');` dentro da transação de `suspenderConta` (depois do `update`); `reativarConta` passa a usar transação:

```ts
export async function reativarConta(tenantId: string, adminId: string, db: Db = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await tx.update(tenants).set({ status: 'ativa', updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
    if (!r.length) throw new ContaNaoEncontradaError();
    await avisarAgenda(tx, tenantId, 'reativado'); // RN-05: lembretes das consultas futuras reagendados
  });
  logger.info({ tenantId, adminId }, 'conta reativada');
}
```

Em `src/modules/plataforma/suspensao.test.ts`: `afterAll(async () => { await stopBoss(); await closeDb(); });` (import `stopBoss` de `@/jobs/boss`).

Run: `pnpm test src/modules/notificacoes/agendar.test.ts src/modules/agenda src/modules/plataforma/suspensao.test.ts`
Expected: PASS.

- [ ] **Step 6: E-mail "consulta" e ajudante `simples`**

`src/email/types.ts`, no `EmailMessage`:

```ts
  | {
      tipo: 'consulta';
      evento: 'lembrete_24h' | 'lembrete_2h' | 'consulta_marcada' | 'consulta_cancelada';
      para: string;
      nome: string;
      nutri: string;
      /** "sex., 16/10/2026 às 14:00 (horário de Brasília)" */
      quando: string;
      hora: string;
      modalidade: 'presencial' | 'online';
      /** Endereço (presencial) ou link da chamada (online). */
      local: string | null;
      /** Link assinado da consulta (D20); nulo no cancelamento. Não passa pela fila: é renderizado no envio. */
      link: string | null;
    }
```

`src/email/templates.tsx` — ajudante (logo depois de `html`):

```tsx
/** Plano 05: parágrafos + botão opcional + parágrafos depois, com a versão em texto igual. */
function simples(subject: string, linhas: string[], botao?: { href: string; rotulo: string }, depois: string[] = []): RenderedEmail {
  return {
    subject,
    html: html(
      <Layout titulo={subject}>
        {linhas.map((l) => <P key={l}>{l}</P>)}
        {botao && <Botao href={botao.href}>{botao.rotulo}</Botao>}
        {depois.map((l) => <P key={l}>{l}</P>)}
        {botao && <LinkReserva href={botao.href} />}
      </Layout>,
    ),
    text: [...linhas, ...(botao ? [`${botao.rotulo}: ${botao.href}`] : []), ...depois].join('\n\n'),
  };
}
```

e o `case` (antes do `default`):

```tsx
    case 'consulta': {
      const subject = {
        lembrete_24h: `Lembrete: sua consulta é amanhã às ${msg.hora}`,
        lembrete_2h: `Lembrete: sua consulta é hoje às ${msg.hora}`,
        consulta_marcada: `Consulta marcada: ${msg.quando}`,
        consulta_cancelada: `Consulta cancelada: ${msg.quando}`,
      }[msg.evento];
      const abertura = {
        lembrete_24h: `Este é um lembrete da sua consulta com ${msg.nutri}: ${msg.quando}.`,
        lembrete_2h: `Sua consulta com ${msg.nutri} é hoje: ${msg.quando}.`,
        consulta_marcada: `Sua consulta com ${msg.nutri} está marcada para ${msg.quando}.`,
        consulta_cancelada: `Sua consulta com ${msg.nutri} de ${msg.quando} foi cancelada.`,
      }[msg.evento];
      if (msg.evento === 'consulta_cancelada') return simples(subject, [`Olá, ${msg.nome}!`, abertura, 'Para marcar outro horário, fale com sua nutricionista.']);
      const local = !msg.local ? [] : [msg.modalidade === 'online' ? `Link da chamada: ${msg.local}` : `Endereço: ${msg.local}`];
      return simples(
        subject,
        [`Olá, ${msg.nome}!`, abertura, ...local],
        msg.link ? { href: msg.link, rotulo: 'Confirmar presença ou remarcar' } : undefined,
        ['Se não puder ir, use o mesmo link para remarcar ou cancelar.'],
      );
    }
```

`src/email/render.test.ts`:

```ts
  it('consulta: lembretes de 24 h e 2 h, marcada e cancelada (com o fuso no texto)', () => {
    const base = { tipo: 'consulta' as const, para: 'ana@ex.com', nome: 'Ana', nutri: 'Debby Silva', quando: 'sex., 16/10/2026 às 14:00 (horário de Brasília)', hora: '14:00', modalidade: 'presencial' as const, local: 'Rua das Flores, 10', link: 'https://x.dev/consulta/tok' };
    const l24 = renderEmail({ ...base, evento: 'lembrete_24h' });
    expect(l24.subject).toBe('Lembrete: sua consulta é amanhã às 14:00');
    expect(l24.text).toContain('Este é um lembrete da sua consulta com Debby Silva: sex., 16/10/2026 às 14:00 (horário de Brasília).');
    expect(l24.text).toContain('Endereço: Rua das Flores, 10');
    expect(l24.text).toContain('Confirmar presença ou remarcar: https://x.dev/consulta/tok');
    expect(renderEmail({ ...base, evento: 'lembrete_2h', modalidade: 'online', local: 'https://meet.google.com/x' }).text).toContain('Link da chamada: https://meet.google.com/x');
    expect(renderEmail({ ...base, evento: 'consulta_marcada' }).subject).toBe('Consulta marcada: sex., 16/10/2026 às 14:00 (horário de Brasília)');
    const c = renderEmail({ ...base, evento: 'consulta_cancelada', link: null });
    expect(c.subject).toBe('Consulta cancelada: sex., 16/10/2026 às 14:00 (horário de Brasília)');
    expect(c.text).not.toContain('/consulta/');
  });
```

Run: `pnpm test src/email`
Expected: PASS.

- [ ] **Step 7: Testes do envio (falham)** — `test/email.ts` e `src/modules/notificacoes/enviar.test.ts`

`test/email.ts`:

```ts
import type { EmailTransport, OutgoingEmail } from '@/email/transport';

/** Transporte em memória; `falhar` = quantas chamadas seguidas recusar antes de aceitar. */
export function transporteFalso(opts: { falhar?: number } = {}): EmailTransport & { enviados: OutgoingEmail[] } {
  let falhas = opts.falhar ?? 0;
  const enviados: OutgoingEmail[] = [];
  return {
    enviados,
    async send(e) {
      if (falhas > 0) {
        falhas--;
        throw new Error('fora do ar');
      }
      enviados.push(e);
    },
  };
}
```

`src/modules/notificacoes/enviar.test.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { transporteFalso } from '../../../test/email';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, notifications, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { agendarPelaNutri } from '@/modules/agenda/consultas';
import { chaveDosLinks, lerLinkConsulta } from '@/modules/agenda/link-consulta';
import { ordemDaRodada, processarNotificacoes, TRAVADA_MS, type DepsEnvio } from './enviar';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const chaveLinks = chaveDosLinks(Buffer.alloc(32, 9));
const marcadaEm = new Date('2026-10-01T12:00:00Z');
const deps = (agora: Date, transport = transporteFalso()): DepsEnvio & { transport: ReturnType<typeof transporteFalso> } =>
  ({ db: app.db, agora: () => agora, appUrl: 'http://localhost:3000', chaveLinks, email: { transport, from: 'NutriDebby <nao-responda@nutridebby.test>' }, transport });

async function marcada(T: TenantDeTeste, extra: Record<string, string> = {}) {
  const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
  const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: ana.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial', ...extra }, { db: app.db, now: marcadaEm });
  return { ana, id };
}
const linha = async (T: TenantDeTeste, id: string, tipo: string, canal: string) =>
  (await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, tipo), eq(notifications.canal, canal))), app.db))[0];

describe('envio das notificações (RN-05, US-034, D6)', () => {
  it('"Consulta marcada" sai na hora; o lembrete de 24 h sai em 15/10 14:00 com o link assinado e o fuso', async () => {
    const T = await novoTenant(app.db);
    const { ana, id } = await marcada(T);
    const d1 = deps(marcadaEm);
    await processarNotificacoes(d1, { tenantId: T.tenantId });
    expect(d1.transport.enviados.map((e) => e.subject)).toEqual(['Consulta marcada: sex., 16/10/2026 às 14:00 (horário de Brasília)']);
    expect(d1.transport.enviados[0].to).toBe(ana.email);
    expect(await linha(T, id, 'consulta_marcada', 'email')).toMatchObject({ status: 'enviada', tentativas: 1 });
    const d2 = deps(em('2026-10-15', '14:00'));
    await processarNotificacoes(d2, { tenantId: T.tenantId });
    const [e] = d2.transport.enviados;
    expect(e.subject).toBe('Lembrete: sua consulta é amanhã às 14:00');
    expect(e.idempotencyKey).toBe(`notificacao:${(await linha(T, id, 'lembrete_24h', 'email')).id}:${em('2026-10-16', '14:00').toISOString()}`);
    const token = /\/consulta\/([A-Za-z0-9_-]{71})/.exec(e.text)![1];
    expect(lerLinkConsulta(token, chaveLinks, em('2026-10-15', '14:00'))).toMatchObject({ tenantId: T.tenantId, appointmentId: id, expirado: false });
  });

  it('sem WhatsApp e sem push configurados (até as Tarefas 10 e 13): "ignorada" com o motivo', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    await processarNotificacoes(deps(em('2026-10-15', '14:00')), { tenantId: T.tenantId });
    expect(await linha(T, id, 'lembrete_24h', 'whatsapp')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'whatsapp_desligado' });
    expect(await linha(T, id, 'lembrete_24h', 'push')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'push_desligado' });
  });

  it('na hora do envio: consulta cancelada, paciente arquivado e consulta já começada viram "ignorada"', async () => {
    const T = await novoTenant(app.db);
    const a = await marcada(T);
    const b = await marcada(T, { data: '2026-10-17' });
    await withTenant(T.ctx, async (tx) => {
      await tx.update(appointments).set({ status: 'cancelada', canceladoPor: 'nutri', canceladaEm: marcadaEm }).where(eq(appointments.id, a.id));
      await tx.update(patients).set({ status: 'arquivado' }).where(eq(patients.id, b.ana.id));
    }, app.db);
    await processarNotificacoes(deps(em('2026-10-16', '13:00')), { tenantId: T.tenantId }); // 24 h e 2 h de "a" venceram
    expect(await linha(T, a.id, 'lembrete_2h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'consulta_cancelada' });
    expect(await linha(T, b.id, 'consulta_marcada', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'paciente_inativo' });
    const p = await novoPaciente(app.db, T.ctx);
    const c = await consultaDireta(app.db, T.ctx, p.id, em('2026-10-16', '09:00'));
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: em('2026-10-16', '09:00'), canal: 'email', tipo: 'lembrete_2h', agendadaPara: em('2026-10-16', '07:00') }), app.db);
    await processarNotificacoes(deps(em('2026-10-16', '09:30')), { tenantId: T.tenantId });
    expect(await linha(T, c, 'lembrete_2h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'prazo_passado' });
    // D6/D17: linha planejada para um horário que a consulta já não tem (a hora mudou depois da reserva) não sai
    const d = await consultaDireta(app.db, T.ctx, p.id, em('2026-10-20', '09:00'));
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: d, inicioConsulta: em('2026-10-19', '09:00'), canal: 'email', tipo: 'lembrete_24h', agendadaPara: em('2026-10-18', '09:00') }), app.db);
    await processarNotificacoes(deps(em('2026-10-18', '09:00')), { tenantId: T.tenantId });
    expect(await linha(T, d, 'lembrete_24h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'consulta_remarcada' });
  });

  it('horário silencioso na reserva (D7, rodada 1): o lembrete que venceu com o worker parado sai às 08:00 dizendo "hoje"; o de 2 h que só caberia depois da consulta é ignorado', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T); // 16/10 às 14:00: o de 24 h venceu em 15/10 às 14:00
    const noite = deps(em('2026-10-15', '23:30'));
    await processarNotificacoes(noite, { tenantId: T.tenantId });
    expect(noite.transport.enviados.filter((e) => e.subject.startsWith('Lembrete'))).toEqual([]);
    expect(await linha(T, id, 'lembrete_24h', 'email')).toMatchObject({ status: 'pendente', tentativas: 0, agendadaPara: em('2026-10-16', '08:00') });
    const manha = deps(em('2026-10-16', '08:00'));
    await processarNotificacoes(manha, { tenantId: T.tenantId });
    expect(manha.transport.enviados.map((e) => e.subject)).toContain('Lembrete: sua consulta é hoje às 14:00');
    expect(await linha(T, id, 'lembrete_24h', 'email')).toMatchObject({ status: 'enviada' });
    // o de 2 h de uma consulta às 07:00 que venceu às 21:50: as 08:00 já seriam depois do início
    const p = await novoPaciente(app.db, T.ctx);
    const cedo = em('2026-10-17', '07:00');
    const c = await consultaDireta(app.db, T.ctx, p.id, cedo);
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: cedo, canal: 'email', tipo: 'lembrete_2h', agendadaPara: em('2026-10-16', '21:50') }), app.db);
    await processarNotificacoes(deps(em('2026-10-16', '22:00')), { tenantId: T.tenantId });
    expect(await linha(T, c, 'lembrete_2h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'horario_silencioso' });
  });

  it('a volta do cron começa num tenant diferente a cada minuto (D6, rodada 1)', () => {
    expect([0, 1, 2, 3].map((m) => ordemDaRodada(['a', 'b', 'c'], new Date(m * 60_000))[0])).toEqual(['a', 'b', 'c', 'a']);
    expect(ordemDaRodada([], new Date())).toEqual([]);
  });

  it('INT-02: e-mail recusado → novas tentativas em 1, 2 e 4 min; depois "falhou"', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    const t = transporteFalso({ falhar: 10 });
    let agora = marcadaEm;
    for (const espera of [60, 120, 240]) {
      await processarNotificacoes(deps(agora, t), { tenantId: T.tenantId });
      const l = await linha(T, id, 'consulta_marcada', 'email');
      expect(l.status).toBe('pendente');
      expect(l.agendadaPara.getTime() - agora.getTime()).toBe(espera * 1000);
      agora = l.agendadaPara;
    }
    await processarNotificacoes(deps(agora, t), { tenantId: T.tenantId });
    expect(await linha(T, id, 'consulta_marcada', 'email')).toMatchObject({ status: 'falhou', erro: 'email', tentativas: 4 });
  });

  it('worker caiu no meio (Review Focus 4): e-mail "enviando" há 15 min volta (mesma chave); WhatsApp vira "falhou"/"interrompido" e nunca repete', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    const travada = new Date(marcadaEm.getTime() - TRAVADA_MS - 1000);
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'enviando', tentativas: 1, updatedAt: travada }).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'consulta_marcada'))), app.db);
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'enviando', tentativas: 1, updatedAt: travada, agendadaPara: travada }).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, 'lembrete_24h'), eq(notifications.canal, 'whatsapp'))), app.db);
    const d = deps(marcadaEm);
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect(await linha(T, id, 'consulta_marcada', 'email')).toMatchObject({ status: 'enviada' });
    expect(d.transport.enviados).toHaveLength(1);
    expect(await linha(T, id, 'lembrete_24h', 'whatsapp')).toMatchObject({ status: 'falhou', erro: 'interrompido' });
  });

  it('duas varreduras ao mesmo tempo não enviam a mesma linha duas vezes (FOR UPDATE SKIP LOCKED)', async () => {
    const T = await novoTenant(app.db);
    await marcada(T);
    const t = transporteFalso();
    await Promise.all([processarNotificacoes(deps(marcadaEm, t), { tenantId: T.tenantId }), processarNotificacoes(deps(marcadaEm, t), { tenantId: T.tenantId })]);
    expect(t.enviados.filter((e) => e.subject.startsWith('Consulta marcada'))).toHaveLength(1);
  });

  it('tenant suspenso: nada sai e o pendente vira "tenant_suspenso" (RN-15)', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcada(T);
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    const d = deps(marcadaEm);
    await processarNotificacoes(d, { tenantId: T.tenantId });
    expect(d.transport.enviados).toEqual([]);
    expect(await linha(T, id, 'lembrete_24h', 'email')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'tenant_suspenso' });
  });
});
```

Run: `pnpm test src/modules/notificacoes/enviar.test.ts`
Expected: FAIL ("Failed to resolve import './enviar'").

- [ ] **Step 8: Implementar o envio** — `src/modules/notificacoes/mensagens.ts` e `src/modules/notificacoes/enviar.ts`

`src/modules/notificacoes/mensagens.ts`:

```ts
import type { AppointmentRow, TenantRow } from '@/db/schema';
import type { EmailMessage } from '@/email/types';
import { partesNoFuso, quandoComFuso } from '@/modules/agenda/fuso';
import { assinarLinkConsulta, urlDaConsulta } from '@/modules/agenda/link-consulta';
import type { ContextoEnvio } from './enviar';

export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || nome;

/** D7 (rodada 1): o envio cai no dia da consulta, no fuso do tenant — o lembrete de 24 h adiado para as 08:00 diz "hoje". */
export const ehHoje = (c: { consulta: AppointmentRow; tenant: TenantRow; agora: Date }) =>
  partesNoFuso(c.agora, c.tenant.fuso).data === partesNoFuso(c.consulta.inicio, c.tenant.fuso).data;

/** Dados comuns às mensagens de uma consulta; o link assinado (D20) vai em todas, menos no cancelamento. */
export function dadosDaConsulta(c: { consulta: AppointmentRow; tenant: TenantRow }, deps: { appUrl: string; chaveLinks: Buffer }) {
  const modalidade = c.consulta.modalidade as 'presencial' | 'online';
  return {
    nutri: c.tenant.nomeExibicao,
    quando: quandoComFuso(c.consulta.inicio, c.tenant.fuso),
    hora: partesNoFuso(c.consulta.inicio, c.tenant.fuso).hora,
    modalidade,
    local: modalidade === 'online' ? c.consulta.linkOnline : c.tenant.enderecoConsultorio,
    link: urlDaConsulta(deps.appUrl, assinarLinkConsulta({ tenantId: c.tenant.id, appointmentId: c.consulta.id, inicio: c.consulta.inicio }, deps.chaveLinks)),
  };
}

/** E-mail de uma linha de `notifications` (só os tipos ligados a consulta têm e-mail). */
export function emailDaNotificacao(c: ContextoEnvio, deps: { appUrl: string; chaveLinks: Buffer }): EmailMessage | null {
  const evento = c.n.tipo;
  if (!c.consulta || (evento !== 'lembrete_24h' && evento !== 'lembrete_2h' && evento !== 'consulta_marcada' && evento !== 'consulta_cancelada')) return null;
  const d = dadosDaConsulta({ consulta: c.consulta, tenant: c.tenant }, deps);
  // D7: o de 24 h que sai no dia da consulta usa o texto "de hoje" (o do lembrete de 2 h), nunca "amanhã"
  const doDia = evento === 'lembrete_24h' && ehHoje({ consulta: c.consulta, tenant: c.tenant, agora: c.agora }) ? 'lembrete_2h' : evento;
  return { tipo: 'consulta', evento: doDia, para: c.paciente.email, nome: primeiroNome(c.paciente.nome), ...d, link: evento === 'consulta_cancelada' ? null : d.link };
}
```

`src/modules/notificacoes/enviar.ts`:

```ts
import { and, asc, eq, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/db/client';
import { appointments, notifications, patients, type AppointmentRow, type NotificationRow, type PatientRow, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { renderEmail } from '@/email/templates';
import type { EmailTransport } from '@/email/transport';
import { logger } from '@/lib/logger';
import { buscarTenant, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { adiarLembrete, emHorarioSilencioso, ignorarPendentesDoTenant } from './agendar';
import { emailDaNotificacao } from './mensagens';
import { ehLembrete, type Canal, type MotivoIgnorada, type TipoLembrete } from './tipos';

export type ContextoEnvio = { n: NotificationRow; paciente: PatientRow; consulta: AppointmentRow | null; tenant: TenantRow; agora: Date };
export type Resultado =
  | { status: 'enviada'; providerMsgId?: string; providerJid?: string }
  | { status: 'ignorada'; motivo: MotivoIgnorada }
  | { status: 'repetir'; erro: string }
  | { status: 'falhou'; erro: string };
export type DepsEnvio = { db: Db; agora: () => Date; appUrl: string; chaveLinks: Buffer; email: { transport: EmailTransport; from: string } };

export const LOTE_POR_EXECUCAO = 40;
/** D6 (rodada 1): parte mínima de cada tenant numa volta do cron; o que sobrar do lote vai para quem encheu a parte. */
export const LOTE_MIN_POR_TENANT = 5;
/** D6: reservada há mais que isto = o worker caiu entre reservar e registrar. */
export const TRAVADA_MS = 15 * 60_000;
/** INT-02: e-mail em 1, 2 e 4 min; INT-01: WhatsApp em 1, 5 e 25 min; push como o WhatsApp. */
export const ESPERAS_S: Record<Canal, readonly number[]> = { email: [60, 120, 240], whatsapp: [60, 300, 1500], push: [60, 300, 1500] };

const ignorar = (motivo: MotivoIgnorada): Resultado => ({ status: 'ignorada', motivo });

/** Condições comuns a todos os canais, conferidas na hora do envio (D6). */
export function motivoParaIgnorar(c: ContextoEnvio): Resultado | null {
  if (!c.paciente || c.paciente.status !== 'ativo' || c.paciente.anonimizadoEm) return ignorar('paciente_inativo'); // RN-08, US-018
  if (!c.consulta || !(ehLembrete(c.n.tipo) || c.n.tipo === 'consulta_marcada')) return null;
  if (c.consulta.status === 'cancelada') return ignorar('consulta_cancelada');
  if (c.consulta.status === 'realizada' || c.consulta.status === 'faltou') return ignorar('consulta_encerrada');
  // D6/D17: linha planejada para outro horário (reservada antes de a nutricionista mudar a hora) não sai
  if (c.n.inicioConsulta && c.n.inicioConsulta.getTime() !== c.consulta.inicio.getTime()) return ignorar('consulta_remarcada');
  if (c.consulta.inicio.getTime() <= c.agora.getTime()) return ignorar('prazo_passado');
  return null;
}

async function enviarEmail(c: ContextoEnvio, deps: DepsEnvio): Promise<Resultado> {
  const msg = emailDaNotificacao(c, deps);
  if (!msg) return { status: 'falhou', erro: 'sem_modelo' };
  const r = renderEmail(msg);
  try {
    // D6: a mesma linha para o mesmo início de consulta tem a mesma chave → o Resend não duplica numa repetição
    const chave = `notificacao:${c.n.id}:${c.consulta?.inicio.toISOString() ?? 'sem-consulta'}`;
    await deps.email.transport.send({ from: deps.email.from, to: msg.para, subject: r.subject, html: r.html, text: r.text, idempotencyKey: chave });
    return { status: 'enviada' };
  } catch {
    return { status: 'repetir', erro: 'email' };
  }
}

/** Um envio por canal. Tarefa 10 troca `whatsapp`; Tarefa 13 troca `push`. */
const CANAIS_ENVIO: Record<Canal, (c: ContextoEnvio, deps: DepsEnvio) => Promise<Resultado>> = {
  email: enviarEmail,
  whatsapp: async () => ignorar('whatsapp_desligado'),
  push: async () => ignorar('push_desligado'),
};

/** As devidas (pendentes, vencidas) de alguns canais — e, se pedido, só de alguns tipos —, mais antigas primeiro, travadas com SKIP LOCKED. */
type Devidas = (canais: readonly Canal[], max: number, tipos?: readonly string[]) => Promise<NotificationRow[]>;

/** WhatsApps devidos desta rodada: quais reservar e quais já ficam sem cota (Tarefa 10: ritmo; Tarefa 11: cota). */
async function escolherWhatsapp(_tx: Tx, _tenant: TenantRow, _agora: Date, max: number, devidas: Devidas): Promise<{ reservar: NotificationRow[]; semCota: string[] }> {
  return { reservar: await devidas(['whatsapp'], max), semCota: [] };
}

/**
 * D7 na reserva (rodada 1 do /code-review): lembrete que venceu e sairia no horário silencioso — worker parado, conta
 * reativada à noite — não sai às 23:30. Na 1ª tentativa, vai para as 08:00 se ainda fizer sentido (`adiarLembrete`);
 * senão, "ignorada"/"horario_silencioso". Vale para os três canais (a RN-05 não distingue); novas tentativas seguem (D7).
 */
async function segurarSilenciosos(tx: Tx, tenant: TenantRow, agora: Date): Promise<void> {
  const ls = await tx
    .select({ id: notifications.id, tipo: notifications.tipo, inicio: appointments.inicio })
    .from(notifications)
    .innerJoin(appointments, eq(appointments.id, notifications.appointmentId))
    .where(and(eq(notifications.status, 'pendente'), lte(notifications.agendadaPara, agora), eq(notifications.tentativas, 0), inArray(notifications.tipo, ['lembrete_24h', 'lembrete_2h'])))
    .for('update', { of: notifications, skipLocked: true });
  for (const l of ls) {
    const para = adiarLembrete(l.tipo as TipoLembrete, l.inicio, tenant.fuso, agora);
    await tx
      .update(notifications)
      .set(para ? { agendadaPara: para, updatedAt: agora } : { status: 'ignorada', motivoIgnorada: 'horario_silencioso', updatedAt: agora })
      .where(eq(notifications.id, l.id));
  }
}

/**
 * D6: reserva o que venceu (pendente → enviando, tentativas + 1) numa transação curta; o envio acontece fora dela.
 * Rodada 1: canal por canal — e-mail e push primeiro, o WhatsApp com o que sobrar (e só com vaga no minuto, D16):
 * um acúmulo de WhatsApp nunca ocupa a vez dos outros canais.
 */
async function reservar(ctx: TenantContext, tenant: TenantRow, deps: DepsEnvio, agora: Date, limite: number): Promise<NotificationRow[]> {
  return withTenant(
    ctx,
    async (tx) => {
      if (emHorarioSilencioso(agora, tenant.fuso)) await segurarSilenciosos(tx, tenant, agora);
      const devidas: Devidas = async (canais, max, tipos) =>
        max <= 0
          ? []
          : tx
              .select()
              .from(notifications)
              .where(and(eq(notifications.status, 'pendente'), lte(notifications.agendadaPara, agora), inArray(notifications.canal, [...canais]), tipos ? inArray(notifications.tipo, [...tipos]) : undefined))
              .orderBy(asc(notifications.agendadaPara))
              .limit(max)
              .for('update', { skipLocked: true });
      const outras = await devidas(['email', 'push'], limite);
      const w = await escolherWhatsapp(tx, tenant, agora, limite - outras.length, devidas);
      if (w.semCota.length) await tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: 'cota_esgotada', updatedAt: agora }).where(inArray(notifications.id, w.semCota));
      const ids = [...outras, ...w.reservar].map((n) => n.id);
      if (!ids.length) return [];
      return tx.update(notifications).set({ status: 'enviando', tentativas: sql`${notifications.tentativas} + 1`, updatedAt: agora }).where(inArray(notifications.id, ids)).returning();
    },
    deps.db,
  );
}

async function carregarContexto(ctx: TenantContext, tenant: TenantRow, n: NotificationRow, deps: DepsEnvio): Promise<ContextoEnvio> {
  return withTenant(
    ctx,
    async (tx) => {
      const [paciente] = await tx.select().from(patients).where(eq(patients.id, n.patientId));
      const [consulta] = n.appointmentId ? await tx.select().from(appointments).where(eq(appointments.id, n.appointmentId)) : [];
      return { n, paciente, consulta: consulta ?? null, tenant, agora: deps.agora() };
    },
    deps.db,
  );
}

/** INT-01: WhatsApp de lembrete que falhou de vez → o e-mail do mesmo lembrete sai de novo, se tinha falhado. */
async function aoFalhar(tx: Tx, n: NotificationRow, agora: Date): Promise<void> {
  if (n.canal !== 'whatsapp' || !ehLembrete(n.tipo) || !n.appointmentId) return;
  await tx
    .update(notifications)
    .set({ status: 'pendente', agendadaPara: agora, tentativas: 0, erro: null, updatedAt: agora })
    // o e-mail do MESMO horário da consulta (CHECK: com consulta, `inicio_consulta` existe)
    .where(and(eq(notifications.appointmentId, n.appointmentId), eq(notifications.inicioConsulta, n.inicioConsulta!), eq(notifications.canal, 'email'), eq(notifications.tipo, n.tipo), eq(notifications.status, 'falhou')));
}

/** Tarefa 11: depois de um envio aceito (aviso de 80% da cota). */
async function aposEnvio(_tx: Tx, _tenant: TenantRow, _n: NotificationRow, _agora: Date): Promise<void> {}

async function registrarResultado(ctx: TenantContext, tenant: TenantRow, n: NotificationRow, r: Resultado, deps: DepsEnvio): Promise<void> {
  const agora = deps.agora();
  await withTenant(
    ctx,
    async (tx) => {
      const onde = and(eq(notifications.id, n.id), eq(notifications.status, 'enviando'));
      if (r.status === 'enviada') {
        const [ok] = await tx
          .update(notifications)
          .set({ status: 'enviada', motivoIgnorada: null, enviadaEm: agora, providerMsgId: r.providerMsgId ?? null, providerJid: r.providerJid ?? null, erro: null, conteudoSelado: null, updatedAt: agora })
          .where(onde)
          .returning();
        if (ok) await aposEnvio(tx, tenant, ok, agora);
        return;
      }
      if (r.status === 'ignorada') {
        await tx.update(notifications).set({ status: 'ignorada', motivoIgnorada: r.motivo, conteudoSelado: null, updatedAt: agora }).where(onde);
        return;
      }
      const esperas = ESPERAS_S[n.canal as Canal];
      if (r.status === 'repetir' && n.tentativas <= esperas.length) {
        await tx.update(notifications).set({ status: 'pendente', agendadaPara: new Date(agora.getTime() + esperas[n.tentativas - 1] * 1000), erro: r.erro, updatedAt: agora }).where(onde);
        return;
      }
      const [f] = await tx.update(notifications).set({ status: 'falhou', erro: r.erro, conteudoSelado: null, updatedAt: agora }).where(onde).returning();
      if (f) await aoFalhar(tx, f, agora);
    },
    deps.db,
  );
}

async function enviarUma(ctx: TenantContext, tenant: TenantRow, n: NotificationRow, deps: DepsEnvio): Promise<void> {
  let r: Resultado;
  try {
    const c = await carregarContexto(ctx, tenant, n, deps);
    r = motivoParaIgnorar(c) ?? (await CANAIS_ENVIO[n.canal as Canal](c, deps));
  } catch (err) {
    // RNF-11: só o nome do erro (mensagens de provedor podem trazer número ou e-mail)
    logger.warn({ tenantId: ctx.tenantId, notificacaoId: n.id, canal: n.canal, err: err instanceof Error ? err.name : 'erro' }, 'falha ao enviar notificação');
    r = { status: 'repetir', erro: 'excecao' };
  }
  await registrarResultado(ctx, tenant, n, r, deps);
  logger.info({ tenantId: ctx.tenantId, notificacaoId: n.id, canal: n.canal, tipo: n.tipo, resultado: r.status, motivo: r.status === 'ignorada' ? r.motivo : undefined, erro: 'erro' in r ? r.erro : undefined }, 'notificação processada');
}

/** D6: worker caiu entre reservar e registrar. E-mail tem chave de idempotência → volta; WhatsApp e push não (no máximo 1, US-034). */
async function destravar(ctx: TenantContext, deps: DepsEnvio, agora: Date): Promise<void> {
  const limite = new Date(agora.getTime() - TRAVADA_MS);
  await withTenant(
    ctx,
    async (tx) => {
      await tx.update(notifications).set({ status: 'pendente', updatedAt: agora }).where(and(eq(notifications.status, 'enviando'), eq(notifications.canal, 'email'), lt(notifications.updatedAt, limite)));
      const falhas = await tx
        .update(notifications)
        .set({ status: 'falhou', erro: 'interrompido', conteudoSelado: null, updatedAt: agora })
        .where(and(eq(notifications.status, 'enviando'), ne(notifications.canal, 'email'), lt(notifications.updatedAt, limite)))
        .returning();
      for (const f of falhas) await aoFalhar(tx, f, agora);
    },
    deps.db,
  );
}

async function processarTenant(tenantId: string, deps: DepsEnvio, limite: number): Promise<number> {
  const tenant = await buscarTenant(deps.db, tenantId);
  if (!tenant) return 0;
  const agora = deps.agora();
  if (tenant.status !== 'ativa') {
    await ignorarPendentesDoTenant(deps.db, tenantId, agora); // RN-15 / US-004
    return 0;
  }
  const ctx: TenantContext = { tenantId, role: 'worker' };
  await destravar(ctx, deps, agora);
  const lote = await reservar(ctx, tenant, deps, agora, limite);
  for (const n of lote) await enviarUma(ctx, tenant, n, deps);
  return lote.length;
}

/** D6 (rodada 1): a cada minuto a volta do cron começa num tenant diferente — com mais tenants que lote, ninguém fica sempre por último. */
export function ordemDaRodada<T>(ids: readonly T[], agora: Date): T[] {
  if (!ids.length) return [];
  const k = Math.floor(agora.getTime() / 60_000) % ids.length;
  return [...ids.slice(k), ...ids.slice(0, k)];
}

async function processarComSeguranca(tenantId: string, deps: DepsEnvio, limite: number): Promise<number> {
  try {
    return await processarTenant(tenantId, deps, limite);
  } catch (err) {
    // um tenant com problema não para os outros; o que ficou "enviando" é destravado na próxima volta
    logger.error({ tenantId, err: err instanceof Error ? err.name : 'erro' }, 'falha ao processar as notificações do tenant');
    return 0;
  }
}

/**
 * RN-05: varre os tenants (cron de 1 min) ou só um (envio imediato); no máximo LOTE_POR_EXECUCAO por execução.
 * Rodada 1 (D6): cada tenant tem uma parte do lote (`max(5, 40 ÷ tenants)`) numa volta que começa num tenant diferente
 * a cada minuto; o que sobrar vai, numa segunda passada, para quem encheu a parte.
 */
export async function processarNotificacoes(deps: DepsEnvio, opts: { tenantId?: string } = {}): Promise<{ processadas: number }> {
  // ordem estável (por id) antes do rodízio: a ordem física de `tenants` muda com qualquer UPDATE (status, cota)
  const ids = (await listarTenantsParaVarredura(deps.db)).map((t) => t.id).sort();
  const alvos = opts.tenantId ? [opts.tenantId] : ordemDaRodada(ids, deps.agora());
  const parte = Math.max(LOTE_MIN_POR_TENANT, Math.ceil(LOTE_POR_EXECUCAO / Math.max(1, alvos.length)));
  let processadas = 0;
  const cheios: string[] = [];
  for (const tenantId of alvos) {
    if (processadas >= LOTE_POR_EXECUCAO) break;
    const limite = Math.min(parte, LOTE_POR_EXECUCAO - processadas);
    const n = await processarComSeguranca(tenantId, deps, limite);
    processadas += n;
    if (n >= limite) cheios.push(tenantId);
  }
  for (const tenantId of cheios) {
    if (processadas >= LOTE_POR_EXECUCAO) break;
    processadas += await processarComSeguranca(tenantId, deps, LOTE_POR_EXECUCAO - processadas);
  }
  return { processadas };
}
```

Run: `pnpm test src/modules/notificacoes`
Expected: PASS (tipos 1, agendar 9, enviar 9).

- [ ] **Step 9: Fila, worker e tela de lembretes**

`src/jobs/queues.ts`, no `QUEUES`:

```ts
  // RN-05 / D6: varredura das notificações a cada minuto, e `{ tenantId }` para envio imediato. O estado fica no
  // banco (notifications), então não há retry do job: o que falhou volta como "pendente" com a próxima tentativa.
  notificacoes: { retryLimit: 0, expireInSeconds: 300, deleteAfterSeconds: 3_600 },
  // US-004: lembretes do tenant suspenso viram "ignorada"; na reativação, os das consultas futuras voltam
  'agenda-tenant': { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
```

`src/worker/index.ts` (imports: `encryptionKey` de `@/lib/crypto`; `chaveDosLinks` de `@/modules/agenda/link-consulta`; `processarNotificacoes`, `type DepsEnvio` de `@/modules/notificacoes/enviar`; `ignorarPendentesDoTenant`, `reagendarTenantReativado` de `@/modules/notificacoes/agendar`), depois do bloco do e-mail:

```ts
  // RN-05 / D6: motor de lembretes. Cron de 1 min para todos os tenants; `{ tenantId }` = envio imediato de um tenant
  const depsEnvio: DepsEnvio = {
    db: getDb(),
    agora: () => new Date(),
    appUrl: env.APP_URL,
    chaveLinks: chaveDosLinks(encryptionKey()),
    email: { transport, from: env.EMAIL_FROM },
  };
  await boss.schedule('notificacoes', '* * * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work<{ tenantId?: string }>('notificacoes', async ([job]) => {
    await processarNotificacoes(depsEnvio, { tenantId: job.data?.tenantId });
  });
  // US-004: o admin suspende/reativa e só enfileira; aqui o worker troca os lembretes dentro do withTenant
  await boss.work<{ tenantId: string; evento: 'suspenso' | 'reativado' }>('agenda-tenant', async ([job]) => {
    if (job.data.evento === 'suspenso') await ignorarPendentesDoTenant(getDb(), job.data.tenantId, new Date());
    else await reagendarTenantReativado(getDb(), job.data.tenantId, new Date());
  });
```

Em `src/app/painel/agenda/consultas/[id]/page.tsx` (imports: `listarNotificacoesDaConsulta` de `@/modules/notificacoes/agendar`; `ROTULO_CANAL`, `ROTULO_TIPO`, `situacaoDaNotificacao`, `type Canal`, `type TipoNotificacao` de `@/modules/notificacoes/tipos`), carregue `const lembretes = await listarNotificacoesDaConsulta(ctx, c.id);` e troque o comentário "Tarefa 5: Lembretes" (deixe o da Tarefa 7) por:

```tsx
        <section aria-labelledby="lembretes" className="space-y-2">
          <h2 id="lembretes" className="text-lg font-semibold">Lembretes</h2>
          {lembretes.length === 0 ? (
            <p>Nenhum lembrete para esta consulta.</p>
          ) : (
            <table className="w-full max-w-3xl text-left text-sm">
              <caption className="sr-only">Lembretes da consulta</caption>
              <thead>
                <tr><th scope="col">Mensagem</th><th scope="col">Canal</th><th scope="col">Situação</th></tr>
              </thead>
              <tbody>
                {lembretes.map((n) => (
                  <tr key={n.id} className="border-t">
                    <td>{ROTULO_TIPO[n.tipo as TipoNotificacao]}</td>
                    <td>{ROTULO_CANAL[n.canal as Canal]}</td>
                    <td>{situacaoDaNotificacao(n, tenant.fuso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
```

- [ ] **Step 10: E2E** — acrescentar a `e2e/agenda.spec.ts` (import `esperarEmail` de `./mailpit`)

```ts
test('e-mail "Consulta marcada" e lembretes agendados (US-031, US-034)', async () => {
  // a consulta da Carla foi alterada para as 11:00 no teste anterior: a confirmação nova diz 11:00
  const email = await esperarEmail(`carla-${sufixo}@ex.com`, { assunto: `Consulta marcada: seg., ${br(SEGUNDA_LIVRE)} às 11:00 (horário de Brasília)` });
  expect(email.texto).toMatch(/\/consulta\/[A-Za-z0-9_-]{71}/);
  await nutri.goto(`/painel/agenda?visao=dia&data=${SEGUNDA_LIVRE}`);
  await nutri.getByRole('link', { name: `Carla Agenda ${sufixo}` }).click();
  const tabela = nutri.getByRole('table', { name: 'Lembretes da consulta' });
  await expect(tabela.getByRole('row', { name: /Lembrete de 24 h E-mail Agendado para dom\., .* às 11:00/ })).toBeVisible();
  await expect(tabela.getByRole('row', { name: /Lembrete de 2 h WhatsApp Agendado para seg\., .* às 09:00/ })).toBeVisible();
});
```

Run: `pnpm e2e:seed && pnpm test:e2e e2e/agenda.spec.ts`
Expected: PASS (3 testes).

- [ ] **Step 11: Commit**

```bash
git add src/db/schema/agenda.ts drizzle/0052_notificacoes.sql drizzle/0053_rls_notificacoes.sql drizzle/meta src/db/audit-guard.ts src/db/rls-guard.ts test/isolamento.test.ts test/email.ts src/modules/notificacoes src/modules/agenda/link-consulta.ts src/modules/agenda/link-consulta.test.ts src/modules/agenda/consultas.ts src/modules/agenda/consultas.test.ts src/email src/jobs/queues.ts src/worker/index.ts src/modules/plataforma/suspensao.ts src/modules/plataforma/suspensao.test.ts src/app/painel/agenda/consultas scripts/e2e-seed.ts e2e/agenda.spec.ts
git commit -m "feat(notificacoes): motor de lembretes 24 h/2 h com horário silencioso, e-mail e link assinado (RN-05, US-034, US-004)"
```

---
### Task 6: Agendamento pelo paciente — janela de 12 h a 60 dias, corrida pelo mesmo horário, aviso à nutricionista (P05-03)

**Files:**
- Create: `src/modules/agenda/aviso-nutri.ts`, `src/modules/agenda/agendamento-paciente.ts`, `src/modules/agenda/agendamento-paciente.test.ts`
- Modify: `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `CLAUDE.md` (regra 1)

**Interfaces:**
- Consumes: `horariosLivres`, `ehSobreposicao`, `ConsultaError`, `type TenantAgenda`, `appointments` (Tarefa 3); `agendarLembretes`, `avisarPaciente`, `dispararEnvio` (Tarefa 5); `quandoComFuso` (Tarefa 1); `MSG_AGENDA`, `JANELA_PACIENTE_DIAS` (Tarefa 1); `type Horario`, `type Modalidade` (Tarefa 1); `carregarPacienteParaEscrita`; `enqueueEmail`; `user`, `type PatientRow`; `urlDoApp`; `getEnv`.
- Produces:
  - `@/modules/agenda/aviso-nutri`: `emailsDaNutri(tx, tenantId): Promise<string[]>`, `avisarNutri(tx, tenantId, montar: (para: string) => EmailMessage): Promise<void>`.
  - `@/modules/agenda/agendamento-paciente`: `type HorarioEscolhido = Horario & { modalidade: Modalidade }`, `janelaDoPaciente(tenant, agora): { de: Date; ate: Date }`, `horariosParaPaciente(tenant, agora, opts?: { db?; de?; ate?; ignorarConsultaId? }): Promise<Horario[]>`, `escolherHorario(tenant, inicio: unknown, modalidade: unknown, agora, opts?: { db?; ignorarConsultaId? }): Promise<HorarioEscolhido>` (lança `ConsultaError({ inicio: MSG_AGENDA.indisponivel })`), `gravarConsultaDoPaciente(tx, tenant, p: Pick<PatientRow, 'id' | 'nome'>, h: HorarioEscolhido, o: { agora: Date; appUrl: string; evento: 'marcada' | 'remarcada' | 'novo_paciente_publico'; remarcadaDe?: string }): Promise<string>` (lança o erro do banco; quem chama trata `ehSobreposicao`), `agendarComoPaciente(ctx, tenant, input: { inicio: unknown; modalidade: unknown }, deps?): Promise<{ id: string }>`.
  - `EmailMessage` ganha `{ tipo: 'aviso_agenda'; para; evento: 'marcada' | 'remarcada' | 'cancelada' | 'pedido_remarcacao' | 'novo_paciente_publico'; paciente: string; quando: string; link: string }`.

- [ ] **Step 1: Testes (falham)** — `src/modules/agenda/agendamento-paciente.test.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { em, semanaToda, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, notifications, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { agendarComoPaciente, horariosParaPaciente } from './agendamento-paciente';
import { MSG_AGENDA } from './constantes';
import { ConsultaError } from './consultas';
import { partesNoFuso } from './fuso';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = 'America/Sao_Paulo';
const agora = em('2026-10-14', '10:00');
const deps = { db: app.db, now: agora, appUrl: 'http://localhost:3000' };
const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConsultaError) return e.erros;
    throw e;
  }
  throw new Error('esperava ConsultaError');
};

describe('horários para o paciente (US-032, RN-03)', () => {
  it('às 10:00 de 14/10, com 12 h de antecedência e regras até 20:00, o primeiro horário é 08:00 de 15/10; nada depois de 60 dias', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const hs = await horariosParaPaciente(tenantAgenda(T), agora, { db: app.db });
    expect(partesNoFuso(hs[0].inicio, SP)).toMatchObject({ data: '2026-10-15', hora: '08:00' });
    expect(hs.every((h) => h.inicio.getTime() < agora.getTime() + 60 * 86_400_000)).toBe(true);
    expect(partesNoFuso(hs.at(-1)!.inicio, SP).data).toBe('2026-12-13');
    // o caso "primeiro horário às 22:00 de 14/10" da US-032 está no teste puro do gerador (Tarefa 1)
  });
});

describe('agendar pelo paciente (US-032)', () => {
  it('cria com origem "paciente", lembretes e confirmação, e avisa a nutricionista por e-mail', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const { id } = await agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T), { inicio: em('2026-10-16', '09:00').toISOString(), modalidade: 'presencial' }, deps);
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db);
    expect(c).toMatchObject({ origem: 'paciente', status: 'agendada', patientId: ana.id, inicio: em('2026-10-16', '09:00'), fim: em('2026-10-16', '10:00') });
    const ns = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, id)), app.db);
    expect(ns.filter((n) => n.tipo === 'lembrete_24h')).toHaveLength(3);
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    const [aviso] = await emailsNaFila('aviso_agenda', nutri.email);
    expect(aviso).toMatchObject({ evento: 'marcada', paciente: 'Ana Souza', quando: 'sex., 16/10/2026 às 09:00 (horário de Brasília)', link: `http://localhost:3000/painel/agenda/consultas/${id}` });
  });

  it('corrida pelo mesmo horário (RN-03): exatamente 1; o outro vê "Esse horário acabou de ser ocupado. Escolha outro."', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const [a, b] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const inicio = em('2026-10-16', '15:00').toISOString();
    const r = await Promise.allSettled([a, b].map((p) => agendarComoPaciente(ctxPaciente(T.tenantId, p.id), tenantAgenda(T), { inicio, modalidade: 'presencial' }, deps)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rej = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((rej.reason as ConsultaError).erros).toEqual({ inicio: expect.stringMatching(/^(Esse horário acabou de ser ocupado\. Escolha outro\.|Esse horário não está mais disponível\. Escolha outro\.)$/) });
  });

  it('horário fora da janela, fora das regras, ocupado ou online sem link padrão → "Esse horário não está mais disponível. Escolha outro."', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, ana.id);
    const indisponivel = { inicio: MSG_AGENDA.indisponivel };
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-14', '19:00').toISOString(), modalidade: 'presencial' }, deps))).toEqual(indisponivel); // < 12 h
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-12-20', '09:00').toISOString(), modalidade: 'presencial' }, deps))).toEqual(indisponivel); // > 60 dias
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '21:00').toISOString(), modalidade: 'presencial' }, deps))).toEqual(indisponivel); // fora das regras
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '09:00').toISOString(), modalidade: 'online' }, deps))).toEqual(indisponivel); // sem link padrão
    expect(await erro(agendarComoPaciente(ctx, tenantAgenda(T), { inicio: 'amanhã', modalidade: 'presencial' }, deps))).toEqual(indisponivel);
    await expect(agendarComoPaciente(ctx, tenantAgenda(T, { linkOnlinePadrao: 'https://meet.google.com/abc' }), { inicio: em('2026-10-16', '09:00').toISOString(), modalidade: 'online' }, deps)).resolves.toMatchObject({ id: expect.any(String) });
  });

  it('paciente arquivado não agenda; tenant suspenso não agenda; só com sessão de paciente', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const arq = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const entrada = { inicio: em('2026-10-16', '09:00').toISOString(), modalidade: 'presencial' };
    expect(await erro(agendarComoPaciente(ctxPaciente(T.tenantId, arq.id), tenantAgenda(T), entrada, deps))).toEqual({ geral: MSG_AGENDA.naoAgendavel });
    const ana = await novoPaciente(app.db, T.ctx);
    expect(await erro(agendarComoPaciente(ctxPaciente(T.tenantId, ana.id), tenantAgenda(T, { status: 'suspensa' }), entrada, deps))).toEqual({ geral: MSG_AGENDA.contaIndisponivel });
    await expect(agendarComoPaciente(T.ctx, tenantAgenda(T), entrada, deps)).rejects.toThrow(/sessão de paciente/);
    const vazias = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(and(eq(appointments.patientId, arq.id))), app.db);
    expect(vazias).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm test src/modules/agenda/agendamento-paciente.test.ts`
Expected: FAIL ("Failed to resolve import './agendamento-paciente'").

- [ ] **Step 3: Aviso à nutricionista** — `src/modules/agenda/aviso-nutri.ts`

```ts
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { user } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import type { EmailMessage } from '@/email/types';

/**
 * D18 / CLAUDE.md regra 1: a tabela `user` do Better Auth é lida aqui, fora do withTenant, só para o e-mail
 * da(s) nutricionista(s) do tenant nos avisos da agenda e do WhatsApp. Nada além do e-mail sai daqui.
 */
export async function emailsDaNutri(tx: Tx, tenantId: string): Promise<string[]> {
  const us = await tx.select({ email: user.email }).from(user).where(and(eq(user.tenantId, tenantId), eq(user.appRole, 'nutri')));
  return us.map((u) => u.email);
}

/** Um e-mail por nutricionista do tenant, na mesma transação do evento (o e-mail só existe se o evento existir). */
export async function avisarNutri(tx: Tx, tenantId: string, montar: (para: string) => EmailMessage): Promise<void> {
  for (const para of await emailsDaNutri(tx, tenantId)) await enqueueEmail(montar(para), { tenantId, tx });
}
```

Em `CLAUDE.md`, regra 1, na lista de quem acessa a tabela `user` fora do `withTenant`, acrescentar depois de `exportacao-job.ts`: "por `src/modules/agenda/aviso-nutri.ts` (e-mail da nutricionista para os avisos da agenda e do WhatsApp, Plano 05)".

- [ ] **Step 4: E-mail "aviso_agenda"**

`src/email/types.ts`:

```ts
  | {
      tipo: 'aviso_agenda';
      para: string;
      evento: 'marcada' | 'remarcada' | 'cancelada' | 'pedido_remarcacao' | 'novo_paciente_publico';
      paciente: string;
      quando: string;
      link: string;
    }
```

`src/email/templates.tsx` (o nome do paciente fica só no corpo, não no assunto):

```tsx
    case 'aviso_agenda': {
      const { subject, linha } = {
        marcada: { subject: 'Consulta marcada pelo paciente', linha: `${msg.paciente} marcou uma consulta para ${msg.quando}.` },
        remarcada: { subject: 'Consulta remarcada pelo paciente', linha: `${msg.paciente} remarcou a consulta para ${msg.quando}.` },
        cancelada: { subject: 'Consulta cancelada pelo paciente', linha: `${msg.paciente} cancelou a consulta de ${msg.quando}.` },
        pedido_remarcacao: { subject: 'Paciente pediu para remarcar', linha: `${msg.paciente} pediu para remarcar a consulta de ${msg.quando}.` },
        novo_paciente_publico: {
          subject: 'Novo paciente via agendamento online',
          linha: `${msg.paciente} marcou uma consulta pela sua página de agendamento para ${msg.quando}. Complete o cadastro (data de nascimento e sexo) antes do atendimento.`,
        },
      }[msg.evento];
      return simples(subject, [linha], { href: msg.link, rotulo: 'Ver na agenda' });
    }
```

`src/email/render.test.ts`:

```ts
  it('aviso à nutricionista: assunto sem nome do paciente; nome e horário no corpo', () => {
    const r = renderEmail({ tipo: 'aviso_agenda', para: 'debby@ex.com', evento: 'novo_paciente_publico', paciente: 'Ana Souza', quando: 'sex., 16/10/2026 às 09:00 (horário de Brasília)', link: 'https://x.dev/painel/agenda/consultas/1' });
    expect(r.subject).toBe('Novo paciente via agendamento online');
    expect(r.text).toContain('Ana Souza marcou uma consulta pela sua página de agendamento para sex., 16/10/2026 às 09:00 (horário de Brasília).');
    expect(r.text).toContain('Ver na agenda: https://x.dev/painel/agenda/consultas/1');
    expect(renderEmail({ tipo: 'aviso_agenda', para: 'd@x', evento: 'pedido_remarcacao', paciente: 'Ana', quando: 'q', link: 'https://x' }).subject).toBe('Paciente pediu para remarcar');
  });
```

- [ ] **Step 5: Implementar** — `src/modules/agenda/agendamento-paciente.ts`

```ts
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, type PatientRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { urlDoApp } from '@/lib/url-do-app';
import { carregarPacienteParaEscrita } from '@/modules/pacientes/base';
import { agendarLembretes, avisarPaciente, dispararEnvio } from '@/modules/notificacoes/agendar';
import { avisarNutri } from './aviso-nutri';
import { JANELA_PACIENTE_DIAS, MSG_AGENDA } from './constantes';
import { ConsultaError, ehSobreposicao, horariosLivres, type TenantAgenda } from './consultas';
import { quandoComFuso } from './fuso';
import type { Horario, Modalidade } from './horarios';

export type HorarioEscolhido = Horario & { modalidade: Modalidade };

/** RN-03: o paciente marca a partir de agora + `antecedencia_min_h` e até 60 dias. */
export function janelaDoPaciente(tenant: Pick<TenantAgenda, 'antecedenciaMinH'>, agora: Date): { de: Date; ate: Date } {
  return { de: new Date(agora.getTime() + tenant.antecedenciaMinH * 3_600_000), ate: new Date(agora.getTime() + JANELA_PACIENTE_DIAS * 86_400_000) };
}

/** Horários livres para o paciente, opcionalmente recortados (uma semana da página pública). */
export async function horariosParaPaciente(tenant: TenantAgenda, agora: Date, opts: { db?: Db; de?: Date; ate?: Date; ignorarConsultaId?: string } = {}): Promise<Horario[]> {
  const j = janelaDoPaciente(tenant, agora);
  const de = opts.de && opts.de.getTime() > j.de.getTime() ? opts.de : j.de;
  const ate = opts.ate && opts.ate.getTime() < j.ate.getTime() ? opts.ate : j.ate;
  return horariosLivres(tenant, de, ate, { db: opts.db, ignorarConsultaId: opts.ignorarConsultaId });
}

/**
 * O horário que o paciente escolheu precisa ser, agora, um horário livre oferecido (janela, regras, bloqueios,
 * ocupação e modalidade). Qualquer outra coisa — inclusive lixo no campo — é "não está mais disponível".
 */
export async function escolherHorario(tenant: TenantAgenda, inicio: unknown, modalidade: unknown, agora: Date, opts: { db?: Db; ignorarConsultaId?: string } = {}): Promise<HorarioEscolhido> {
  const indisponivel = () => new ConsultaError({ inicio: MSG_AGENDA.indisponivel });
  const t = typeof inicio === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(inicio) ? Date.parse(inicio) : NaN;
  if (!Number.isFinite(t) || (modalidade !== 'presencial' && modalidade !== 'online')) throw indisponivel();
  const alvo = new Date(t);
  const [h] = await horariosParaPaciente(tenant, agora, { ...opts, de: alvo, ate: new Date(t + 60_000) });
  if (!h || h.inicio.getTime() !== t || !h.modalidades.includes(modalidade)) throw indisponivel();
  return { ...h, modalidade };
}

/**
 * Grava a consulta do paciente e tudo o que vem junto, na transação de quem chama: lembretes (RN-05),
 * "Consulta marcada" ao paciente, aviso à nutricionista (D18) e envio imediato. O 23P01 sobe para quem chama.
 */
export async function gravarConsultaDoPaciente(
  tx: Tx,
  tenant: TenantAgenda,
  p: Pick<PatientRow, 'id' | 'nome'>,
  h: HorarioEscolhido,
  o: { agora: Date; appUrl: string; evento: 'marcada' | 'remarcada' | 'novo_paciente_publico'; remarcadaDe?: string },
): Promise<string> {
  const [c] = await tx
    .insert(appointments)
    .values({
      tenantId: tenant.id,
      patientId: p.id,
      inicio: h.inicio,
      fim: h.fim,
      modalidade: h.modalidade,
      linkOnline: h.modalidade === 'online' ? tenant.linkOnlinePadrao : null,
      status: 'agendada',
      origem: 'paciente',
      remarcadaDe: o.remarcadaDe ?? null,
      createdAt: o.agora,
      updatedAt: o.agora,
    })
    .returning({ id: appointments.id });
  const alvo = { tenantId: tenant.id, patientId: p.id, appointmentId: c.id, inicio: h.inicio };
  await agendarLembretes(tx, alvo, tenant.fuso, o.agora);
  await avisarPaciente(tx, alvo, 'consulta_marcada', o.agora);
  const quando = quandoComFuso(h.inicio, tenant.fuso);
  const link = urlDoApp(o.appUrl, `/painel/agenda/consultas/${c.id}`);
  await avisarNutri(tx, tenant.id, (para) => ({ tipo: 'aviso_agenda', para, evento: o.evento, paciente: p.nome, quando, link }));
  await dispararEnvio(tx, tenant.id);
  return c.id;
}

/**
 * US-032 (P05-03): o paciente da sessão marca um horário livre. A RLS por paciente garante que só grava
 * para si; o EXCLUDE decide a corrida com outro paciente (D9). A tela é do Plano 06 (P06-09).
 */
export async function agendarComoPaciente(
  ctx: TenantContext,
  tenant: TenantAgenda,
  input: { inicio: unknown; modalidade: unknown },
  deps: { db?: Db; now?: Date; appUrl?: string } = {},
): Promise<{ id: string }> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('agendarComoPaciente exige sessão de paciente');
  if (tenant.status !== 'ativa') throw new ConsultaError({ geral: MSG_AGENDA.contaIndisponivel }); // RN-15
  const db = deps.db ?? getDb();
  const agora = deps.now ?? new Date();
  const h = await escolherHorario(tenant, input.inicio, input.modalidade, agora, { db });
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const p = await carregarPacienteParaEscrita(tx, ctx.patientId!);
        if (p.status !== 'ativo') throw new ConsultaError({ geral: MSG_AGENDA.naoAgendavel }); // RN-08
        return { id: await gravarConsultaDoPaciente(tx, tenant, p, h, { agora, appUrl: deps.appUrl ?? getEnv().APP_URL, evento: 'marcada' }) };
      },
      db,
    );
  } catch (e) {
    if (ehSobreposicao(e)) throw new ConsultaError({ inicio: MSG_AGENDA.ocupado }); // RN-03
    throw e;
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm test src/modules/agenda src/email`
Expected: PASS (4 testes novos em `agendamento-paciente.test.ts`; os anteriores continuam verdes).

- [ ] **Step 7: Commit**

```bash
git add src/modules/agenda/aviso-nutri.ts src/modules/agenda/agendamento-paciente.ts src/modules/agenda/agendamento-paciente.test.ts src/email CLAUDE.md
git commit -m "feat(agenda): agendamento pelo paciente com janela, corrida decidida pelo banco e aviso à nutricionista (US-032, RN-03)"
```

---
### Task 7: Cancelar e remarcar (RN-04) + página do link da consulta (confirmar, cancelar, remarcar) (P05-05)

**Files:**
- Create: `src/modules/agenda/cancelamento.ts`, `src/modules/agenda/cancelamento.test.ts`, `src/modules/agenda/acoes-link.ts`, `src/modules/agenda/acoes-link.test.ts`, `src/components/seletor-horarios.tsx`, `src/app/consulta/[token]/page.tsx`, `src/app/consulta/[token]/actions.ts`, `src/app/consulta/[token]/acoes.tsx`, `src/app/painel/agenda/consultas/[id]/cancelar-form.tsx`
- Modify: `src/modules/agenda/horarios.ts`, `src/modules/agenda/horarios.test.ts`, `src/app/painel/agenda/actions.ts`, `src/app/painel/agenda/consultas/[id]/page.tsx`, `next.config.ts`, `e2e/agenda.spec.ts`

**Interfaces:**
- Consumes: `lerConsultaParaEscrita`, `STATUS_ATIVOS`, `ConsultaError`, `ehSobreposicao`, `type TenantAgenda`, `type StatusConsulta`, `appointments` (Tarefa 3); `escolherHorario`, `gravarConsultaDoPaciente`, `horariosParaPaciente`, `janelaDoPaciente` (Tarefa 6); `avisarNutri` (Tarefa 6); `cancelarLembretes`, `avisarPaciente`, `dispararEnvio` (Tarefa 5); `chaveDosLinks`, `lerLinkConsulta` (Tarefa 5); `quandoComFuso`, `diaCurto`, `partesNoFuso`, `inicioDoDia`, `somarDias` (Tarefa 1); `MSG_AGENDA`; `carregarPacienteParaEscrita`, `PacienteBloqueadoError`, `patients`; `buscarTenant`; `encryptionKey`; `requestIp`; `normalizarTexto`.
- Produces:
  - `@/modules/agenda/horarios`: `type HorarioVisivel = { inicio: string; dia: string; data: string; hora: string; modalidades: Modalidade[] }`, `horariosVisiveis(hs: Horario[], fuso: string): HorarioVisivel[]`.
  - `@/modules/agenda/cancelamento`: `podeAlterarPeloPaciente(inicio: Date, cancelamentoMinH: number, agora: Date): boolean`, `cancelarConsulta(ctx, tenant, id, o: { por: 'nutri' | 'paciente'; motivo?: unknown }, deps?)`, `remarcarComoPaciente(ctx, tenant, id, novo: { inicio: unknown; modalidade: unknown }, deps?): Promise<{ id: string; inicio: Date }>` (o horário é escolhido **antes** da transação; o `EXCLUDE` revalida dentro), `confirmarPresenca(ctx, id, via: 'whatsapp' | 'link', deps?): Promise<'confirmada' | 'ja_confirmada' | 'nao_confirmavel'>`, `pedirRemarcacao(ctx, tenant, id, deps?): Promise<boolean>` (true só na primeira vez). Confirmar, pedir remarcação e cancelar/remarcar pelo paciente exigem sessão de paciente **ativo** (arquivado, bloqueado ou anonimizado: `nao_confirmavel` / `false` / "Para alterar, fale com sua nutricionista." / `PacienteBloqueadoError`).
  - `@/modules/agenda/acoes-link`: `class LinkError`, `type EstadoLink` (`indisponivel` também para paciente arquivado, bloqueado ou anonimizado), `type DepsLink = { db?; agora?; chave?; ip?; appUrl? }`, `abrirLinkConsulta(token, deps?)`, `horariosDoLink(token, de, ate, deps?): Promise<HorarioVisivel[]>`, `confirmarPeloLink(token, deps?)`, `cancelarPeloLink(token, deps?)`, `remarcarPeloLink(token, input, deps?): Promise<{ quando: string }>`, `avisarRemarcacaoPeloLink(token, deps?)`.
  - `SeletorHorarios({ horarios: HorarioVisivel[]; modalidade?: Modalidade; erro?: string })` — também usado pela página pública (Tarefa 8).
  - Página `/consulta/[token]` (`?semana=AAAA-MM-DD`), `cancelarAction(id, prev, fd)` no painel.

- [ ] **Step 1: Horários para exibir** — em `src/modules/agenda/horarios.test.ts`:

```ts
import { horariosVisiveis } from './horarios'; // junte ao import existente

  it('horariosVisiveis: ISO, dia curto e hora no fuso, na ordem', () => {
    const hs = gerarHorarios({ regras: [TERCA], bloqueios: [], ocupados: [], ...semana, online: false });
    expect(horariosVisiveis(hs.slice(0, 2), SP)).toEqual([
      { inicio: '2026-10-20T11:00:00.000Z', dia: 'ter., 20/10', data: '2026-10-20', hora: '08:00', modalidades: ['presencial'] },
      { inicio: '2026-10-20T12:00:00.000Z', dia: 'ter., 20/10', data: '2026-10-20', hora: '09:00', modalidades: ['presencial'] },
    ]);
  });
```

Em `src/modules/agenda/horarios.ts` (acrescente `diaCurto` ao import de `./fuso`):

```ts
/** O que a tela mostra de um horário livre (nada além de intervalo e modalidade, D11). */
export type HorarioVisivel = { inicio: string; dia: string; data: string; hora: string; modalidades: Modalidade[] };

export function horariosVisiveis(hs: Horario[], fuso: string): HorarioVisivel[] {
  return hs.map((h) => {
    const p = partesNoFuso(h.inicio, fuso);
    return { inicio: h.inicio.toISOString(), dia: diaCurto(p.data), data: p.data, hora: p.hora, modalidades: h.modalidades };
  });
}
```

Run: `pnpm test src/modules/agenda/horarios.test.ts` → PASS (8 testes).

- [ ] **Step 2: Testes do cancelamento e da remarcação (falham)** — `src/modules/agenda/cancelamento.test.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, semanaToda, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import * as schema from '@/db/schema';
import { appointments, notifications, patients, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { agendarComoPaciente } from './agendamento-paciente';
import { cancelarConsulta, confirmarPresenca, pedirRemarcacao, podeAlterarPeloPaciente, remarcarComoPaciente } from './cancelamento';
import { MSG_AGENDA } from './constantes';
import { ConsultaError, ConsultaNaoEncontradaError } from './consultas';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const deps = (now: Date) => ({ db: app.db, now, appUrl: 'http://localhost:3000' });
const erro = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConsultaError) return e.erros;
    throw e;
  }
  throw new Error('esperava ConsultaError');
};
const consulta = async (T: TenantDeTeste, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db))[0];
const lembretes = (T: TenantDeTeste, id: string) => withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, id)), app.db);
const emailDaNutri = async (T: TenantDeTeste) => (await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId)))[0].email;

describe('RN-04: prazo do paciente', () => {
  it('pode até cancelamento_min_h antes do início (24 h em ponto ainda pode)', () => {
    const inicio = em('2026-10-16', '14:00');
    expect(podeAlterarPeloPaciente(inicio, 24, em('2026-10-15', '14:00'))).toBe(true);
    expect(podeAlterarPeloPaciente(inicio, 24, em('2026-10-15', '14:01'))).toBe(false);
  });
});

describe('remarcar e cancelar (US-033)', () => {
  it('dentro do prazo (30 h antes): a antiga fica "cancelada" pelo paciente, a nova nasce ligada a ela; lembretes trocados; nutricionista avisada', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const ctx = ctxPaciente(T.tenantId, ana.id);
    const { id } = await agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '14:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-10', '09:00')));
    const novo = await remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-17', '10:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-15', '08:00')));
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'paciente' });
    expect(await consulta(T, novo.id)).toMatchObject({ status: 'agendada', origem: 'paciente', remarcadaDe: id, inicio: em('2026-10-17', '10:00') });
    expect((await lembretes(T, id)).filter((n) => n.tipo.startsWith('lembrete')).every((n) => n.status === 'ignorada' && n.motivoIgnorada === 'consulta_cancelada')).toBe(true);
    expect((await lembretes(T, novo.id)).filter((n) => n.tipo === 'lembrete_24h' && n.status === 'pendente')).toHaveLength(3);
    expect((await emailsNaFila('aviso_agenda', await emailDaNutri(T))).map((m) => m.evento).sort()).toEqual(['marcada', 'remarcada']);
  });

  it('remarcar para um horário que encosta ou se sobrepõe à própria consulta funciona (ela não ocupa a si mesma)', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx, { duracaoMin: 30 });
    const ana = await novoPaciente(app.db, T.ctx);
    const ctx = ctxPaciente(T.tenantId, ana.id);
    const { id } = await agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '14:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-10', '09:00')));
    await expect(remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-16', '14:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-11', '09:00')))).resolves.toMatchObject({ inicio: em('2026-10-16', '14:00') });
  });

  it('fora do prazo (20 h antes): "Para alterar, fale com sua nutricionista." — a nutricionista pode a qualquer momento', async () => {
    const T = await novoTenant(app.db);
    await semanaToda(app.db, T.ctx);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
    const ctx = ctxPaciente(T.tenantId, ana.id);
    const vinteHorasAntes = deps(em('2026-10-15', '18:00'));
    expect(await erro(cancelarConsulta(ctx, tenantAgenda(T), id, { por: 'paciente' }, vinteHorasAntes))).toEqual({ geral: MSG_AGENDA.foraDoPrazo });
    expect(await erro(remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-20', '10:00').toISOString(), modalidade: 'presencial' }, vinteHorasAntes))).toEqual({ geral: MSG_AGENDA.foraDoPrazo });
    await cancelarConsulta(T.ctx, tenantAgenda(T), id, { por: 'nutri', motivo: '  Imprevisto  ' }, vinteHorasAntes);
    expect(await consulta(T, id)).toMatchObject({ status: 'cancelada', canceladoPor: 'nutri', motivoCancelamento: 'Imprevisto' });
    const aviso = (await lembretes(T, id)).filter((n) => n.tipo === 'consulta_cancelada');
    expect(aviso.map((n) => `${n.canal}/${n.status}`).sort()).toEqual(['email/pendente', 'push/pendente']);
    expect(await erro(cancelarConsulta(T.ctx, tenantAgenda(T), id, { por: 'nutri' }, vinteHorasAntes))).toEqual({ geral: MSG_AGENDA.naoCancelavel });
  });

  it('Review Focus 6 (rodada 1): remarcar com um pool de UMA conexão conclui — o horário é escolhido antes da transação, nunca numa segunda conexão dentro dela', async () => {
    const umaConexao = new Pool({ connectionString: inject('appDatabaseUrl'), max: 1 });
    try {
      const T = await novoTenant(app.db);
      await semanaToda(app.db, T.ctx);
      const ana = await novoPaciente(app.db, T.ctx);
      const ctx = ctxPaciente(T.tenantId, ana.id);
      const { id } = await agendarComoPaciente(ctx, tenantAgenda(T), { inicio: em('2026-10-16', '14:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-10', '09:00')));
      const db1 = drizzle({ client: umaConexao, schema });
      await expect(remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-17', '10:00').toISOString(), modalidade: 'presencial' }, { db: db1, now: em('2026-10-11', '09:00'), appUrl: 'http://localhost:3000' })).resolves.toMatchObject({ inicio: em('2026-10-17', '10:00') });
    } finally {
      await umaConexao.end();
    }
  }, 15_000);

  it('rodada 1 (RN-08, US-018): paciente arquivado, bloqueado ou anonimizado não confirma, não pede remarcação, não cancela nem remarca', async () => {
    for (const mudanca of [{ status: 'arquivado' }, { status: 'bloqueado' }, { anonimizadoEm: em('2026-10-01', '09:00') }]) {
      const T = await novoTenant(app.db);
      await semanaToda(app.db, T.ctx);
      const ana = await novoPaciente(app.db, T.ctx);
      const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
      await withTenant(T.ctx, (tx) => tx.update(patients).set(mudanca).where(eq(patients.id, ana.id)), app.db);
      const ctx = ctxPaciente(T.tenantId, ana.id);
      const d = deps(em('2026-10-10', '09:00'));
      expect(await confirmarPresenca(ctx, id, 'whatsapp', d), JSON.stringify(mudanca)).toBe('nao_confirmavel');
      expect(await pedirRemarcacao(ctx, tenantAgenda(T), id, d)).toBe(false);
      expect(await erro(cancelarConsulta(ctx, tenantAgenda(T), id, { por: 'paciente' }, d))).toEqual({ geral: MSG_AGENDA.foraDoPrazo });
      await expect(remarcarComoPaciente(ctx, tenantAgenda(T), id, { inicio: em('2026-10-17', '10:00').toISOString(), modalidade: 'presencial' }, d)).rejects.toSatisfy(
        (e: unknown) => e instanceof PacienteBloqueadoError || (e instanceof ConsultaError && e.erros.geral === MSG_AGENDA.naoAgendavel),
      );
      expect(await consulta(T, id)).toMatchObject({ status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
    }
  });

  it('paciente não cancela consulta de outro paciente (RLS) e o motivo tem até 300 caracteres', async () => {
    const T = await novoTenant(app.db);
    const [p1, p2] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    const id = await consultaDireta(app.db, T.ctx, p1.id, em('2026-10-16', '14:00'));
    await expect(cancelarConsulta(ctxPaciente(T.tenantId, p2.id), tenantAgenda(T), id, { por: 'paciente' }, deps(em('2026-10-10', '09:00')))).rejects.toBeInstanceOf(ConsultaNaoEncontradaError);
    expect(await erro(cancelarConsulta(T.ctx, tenantAgenda(T), id, { por: 'nutri', motivo: 'x'.repeat(301) }, deps(em('2026-10-10', '09:00'))))).toEqual({ motivo: 'Use no máximo 300 caracteres' });
  });
});

describe('confirmar presença e pedir remarcação (US-035)', () => {
  it('confirmar: "agendada" → "confirmada" (via link); de novo não muda; depois do início, não confirma; limpa o pedido de remarcação', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'), 60, { pedidoRemarcacaoEm: em('2026-10-10', '09:00') });
    const ctx = ctxPaciente(T.tenantId, ana.id);
    expect(await confirmarPresenca(ctx, id, 'link', deps(em('2026-10-15', '09:00')))).toBe('confirmada');
    expect(await consulta(T, id)).toMatchObject({ status: 'confirmada', confirmadaVia: 'link', pedidoRemarcacaoEm: null });
    expect(await confirmarPresenca(ctx, id, 'whatsapp', deps(em('2026-10-15', '10:00')))).toBe('ja_confirmada');
    expect((await consulta(T, id)).confirmadaVia).toBe('link');
    const outra = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-17', '14:00'));
    expect(await confirmarPresenca(ctx, outra, 'link', deps(em('2026-10-17', '14:30')))).toBe('nao_confirmavel');
  });

  it('pedir remarcação: grava uma vez e avisa a nutricionista uma vez', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza' });
    const id = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-16', '14:00'));
    const ctx = ctxPaciente(T.tenantId, ana.id);
    expect(await pedirRemarcacao(ctx, tenantAgenda(T), id, deps(em('2026-10-16', '09:00')))).toBe(true);
    expect(await pedirRemarcacao(ctx, tenantAgenda(T), id, deps(em('2026-10-16', '09:05')))).toBe(false);
    expect((await consulta(T, id)).pedidoRemarcacaoEm).toEqual(em('2026-10-16', '09:00'));
    const avisos = await emailsNaFila('aviso_agenda', await emailDaNutri(T));
    expect(avisos.filter((m) => m.evento === 'pedido_remarcacao')).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm test src/modules/agenda/cancelamento.test.ts`
Expected: FAIL ("Failed to resolve import './cancelamento'").

- [ ] **Step 4: Implementar** — `src/modules/agenda/cancelamento.ts`

```ts
import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { appointments, patients } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { normalizarTexto } from '@/lib/text';
import { urlDoApp } from '@/lib/url-do-app';
import { carregarPacienteParaEscrita } from '@/modules/pacientes/base';
import { avisarPaciente, cancelarLembretes, dispararEnvio } from '@/modules/notificacoes/agendar';
import { escolherHorario, gravarConsultaDoPaciente } from './agendamento-paciente';
import { avisarNutri } from './aviso-nutri';
import { MSG_AGENDA } from './constantes';
import { ConsultaError, ehSobreposicao, lerConsultaParaEscrita, STATUS_ATIVOS, type StatusConsulta, type TenantAgenda } from './consultas';
import { quandoComFuso } from './fuso';

type Deps = { db?: Db; now?: Date; appUrl?: string };
const ativa = (status: string) => STATUS_ATIVOS.includes(status as StatusConsulta);
const linkDaAgenda = (appUrl: string, id: string) => urlDoApp(appUrl, `/painel/agenda/consultas/${id}`);

/** RN-04: o paciente cancela ou remarca até `cancelamento_min_h` antes do início (no limite exato, ainda pode). */
export function podeAlterarPeloPaciente(inicio: Date, cancelamentoMinH: number, agora: Date): boolean {
  return inicio.getTime() - agora.getTime() >= cancelamentoMinH * 3_600_000;
}

/**
 * RN-08 / US-018 (rodada 1 do /code-review): paciente arquivado, bloqueado ou anonimizado não age pela agenda (link,
 * WhatsApp, PWA). Trava o paciente (`FOR SHARE`) antes da consulta — a mesma ordem de moverConsulta (paciente → consulta).
 */
async function pacienteAtivo(tx: Tx, ctx: TenantContext): Promise<boolean> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('ação do paciente exige sessão de paciente');
  const [p] = await tx.select({ status: patients.status, anonimizadoEm: patients.anonimizadoEm }).from(patients).where(eq(patients.id, ctx.patientId)).for('share');
  return !!p && p.status === 'ativo' && !p.anonimizadoEm;
}

/** US-033 / RN-04: a nutricionista cancela a qualquer momento; o paciente, dentro do prazo. O paciente recebe o aviso. */
export async function cancelarConsulta(ctx: TenantContext, tenant: TenantAgenda, id: string, o: { por: 'nutri' | 'paciente'; motivo?: unknown }, deps: Deps = {}): Promise<void> {
  const motivo = normalizarTexto(o.motivo);
  if (motivo.length > 300) throw new ConsultaError({ motivo: 'Use no máximo 300 caracteres' });
  const agora = deps.now ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      if (o.por === 'paciente' && !(await pacienteAtivo(tx, ctx))) throw new ConsultaError({ geral: MSG_AGENDA.foraDoPrazo }); // RN-08
      const c = await lerConsultaParaEscrita(tx, id); // RLS: o paciente só alcança a própria
      if (!ativa(c.status)) throw new ConsultaError({ geral: MSG_AGENDA.naoCancelavel });
      if (o.por === 'paciente' && !podeAlterarPeloPaciente(c.inicio, tenant.cancelamentoMinH, agora)) throw new ConsultaError({ geral: MSG_AGENDA.foraDoPrazo });
      await tx
        .update(appointments)
        .set({ status: 'cancelada', canceladoPor: o.por, canceladaEm: agora, motivoCancelamento: motivo || null, pedidoRemarcacaoEm: null, updatedAt: agora })
        .where(eq(appointments.id, id));
      await cancelarLembretes(tx, id, agora);
      await avisarPaciente(tx, { tenantId: ctx.tenantId, patientId: c.patientId, appointmentId: id, inicio: c.inicio }, 'consulta_cancelada', agora);
      if (o.por === 'paciente') {
        const [p] = await tx.select({ nome: patients.nome }).from(patients).where(eq(patients.id, c.patientId));
        const quando = quandoComFuso(c.inicio, tenant.fuso);
        await avisarNutri(tx, ctx.tenantId, (para) => ({ tipo: 'aviso_agenda', para, evento: 'cancelada', paciente: p.nome, quando, link: linkDaAgenda(deps.appUrl ?? getEnv().APP_URL, id) }));
      }
      await dispararEnvio(tx, ctx.tenantId);
    },
    deps.db ?? getDb(),
  );
}

/**
 * US-033 / D17: o paciente remarca = cancela a antiga e cria a nova (`remarcada_de`) numa transação; o horário
 * novo é validado ignorando a própria consulta. Travas: paciente → consulta (mesma ordem de moverConsulta).
 * Review Focus 6 (rodada 1): `escolherHorario` abre a própria transação (contexto publico) — por isso roda ANTES desta,
 * nunca dentro (seria uma segunda conexão com a trava do paciente e da consulta presa; pool max: 10). Dentro, o
 * EXCLUDE revalida o horário (outro paciente pode ter marcado no meio: "Esse horário acabou de ser ocupado").
 */
export async function remarcarComoPaciente(ctx: TenantContext, tenant: TenantAgenda, id: string, novo: { inicio: unknown; modalidade: unknown }, deps: Deps = {}): Promise<{ id: string; inicio: Date }> {
  if (ctx.role !== 'paciente' || !ctx.patientId) throw new Error('remarcarComoPaciente exige sessão de paciente');
  if (tenant.status !== 'ativa') throw new ConsultaError({ geral: MSG_AGENDA.contaIndisponivel });
  const db = deps.db ?? getDb();
  const agora = deps.now ?? new Date();
  const h = await escolherHorario(tenant, novo.inicio, novo.modalidade, agora, { db, ignorarConsultaId: id });
  try {
    return await withTenant(
      ctx,
      async (tx) => {
        const p = await carregarPacienteParaEscrita(tx, ctx.patientId!);
        if (p.status !== 'ativo') throw new ConsultaError({ geral: MSG_AGENDA.naoAgendavel });
        const c = await lerConsultaParaEscrita(tx, id);
        if (!ativa(c.status)) throw new ConsultaError({ geral: MSG_AGENDA.naoAlteravel });
        if (!podeAlterarPeloPaciente(c.inicio, tenant.cancelamentoMinH, agora)) throw new ConsultaError({ geral: MSG_AGENDA.foraDoPrazo });
        await tx
          .update(appointments)
          .set({ status: 'cancelada', canceladoPor: 'paciente', canceladaEm: agora, motivoCancelamento: 'Remarcada pelo paciente', pedidoRemarcacaoEm: null, updatedAt: agora })
          .where(eq(appointments.id, id));
        await cancelarLembretes(tx, id, agora);
        const novoId = await gravarConsultaDoPaciente(tx, tenant, p, h, { agora, appUrl: deps.appUrl ?? getEnv().APP_URL, evento: 'remarcada', remarcadaDe: id });
        return { id: novoId, inicio: h.inicio };
      },
      db,
    );
  } catch (e) {
    if (ehSobreposicao(e)) throw new ConsultaError({ inicio: MSG_AGENDA.ocupado });
    throw e;
  }
}

/** US-035: "1" no WhatsApp ou "Confirmar presença" no link. Idempotente; só antes do início e só de paciente ativo (RN-08). */
export async function confirmarPresenca(ctx: TenantContext, id: string, via: 'whatsapp' | 'link', deps: Deps = {}): Promise<'confirmada' | 'ja_confirmada' | 'nao_confirmavel'> {
  const agora = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      if (!(await pacienteAtivo(tx, ctx))) return 'nao_confirmavel';
      const c = await lerConsultaParaEscrita(tx, id);
      if (!ativa(c.status) || c.inicio.getTime() <= agora.getTime()) return 'nao_confirmavel';
      if (c.status === 'confirmada') return 'ja_confirmada';
      await tx.update(appointments).set({ status: 'confirmada', confirmadaVia: via, pedidoRemarcacaoEm: null, updatedAt: agora }).where(eq(appointments.id, id));
      return 'confirmada';
    },
    deps.db ?? getDb(),
  );
}

/** US-035 "Preciso remarcar": marca o pedido e avisa a nutricionista — uma vez só (repetir não avisa de novo); só paciente ativo. */
export async function pedirRemarcacao(ctx: TenantContext, tenant: TenantAgenda, id: string, deps: Deps = {}): Promise<boolean> {
  const agora = deps.now ?? new Date();
  return withTenant(
    ctx,
    async (tx) => {
      if (!(await pacienteAtivo(tx, ctx))) return false;
      const c = await lerConsultaParaEscrita(tx, id);
      if (!ativa(c.status) || c.inicio.getTime() <= agora.getTime() || c.pedidoRemarcacaoEm) return false;
      await tx.update(appointments).set({ pedidoRemarcacaoEm: agora, updatedAt: agora }).where(eq(appointments.id, id));
      const [p] = await tx.select({ nome: patients.nome }).from(patients).where(eq(patients.id, c.patientId));
      const quando = quandoComFuso(c.inicio, tenant.fuso);
      await avisarNutri(tx, ctx.tenantId, (para) => ({ tipo: 'aviso_agenda', para, evento: 'pedido_remarcacao', paciente: p.nome, quando, link: linkDaAgenda(deps.appUrl ?? getEnv().APP_URL, id) }));
      return true;
    },
    deps.db ?? getDb(),
  );
}
```

Run: `pnpm test src/modules/agenda/cancelamento.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Testes das ações pelo link (falham)** — `src/modules/agenda/acoes-link.test.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, semanaToda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, auditLog, patients, tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { abrirLinkConsulta, avisarRemarcacaoPeloLink, cancelarPeloLink, confirmarPeloLink, horariosDoLink, LinkError, remarcarPeloLink } from './acoes-link';
import { MSG_AGENDA } from './constantes';
import { ConsultaError } from './consultas';
import { assinarLinkConsulta, chaveDosLinks } from './link-consulta';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const chave = chaveDosLinks(Buffer.alloc(32, 9));
const deps = (agora: Date) => ({ db: app.db, agora, chave, ip: '203.0.113.9', appUrl: 'http://localhost:3000' });

async function cenario() {
  const T = await novoTenant(app.db, 'Debby Silva');
  await semanaToda(app.db, T.ctx);
  const ana = await novoPaciente(app.db, T.ctx);
  const inicio = em('2026-10-16', '14:00');
  const id = await consultaDireta(app.db, T.ctx, ana.id, inicio);
  return { T, ana, id, token: assinarLinkConsulta({ tenantId: T.tenantId, appointmentId: id, inicio }, chave) };
}

describe('link da consulta (D20, US-033, US-035)', () => {
  it('abre com nutricionista, quando (com fuso) e o que pode fazer; o GET não muda nada', async () => {
    const { T, id, token } = await cenario();
    expect(await abrirLinkConsulta(token, deps(em('2026-10-14', '09:00')))).toMatchObject({
      estado: 'ok', nutri: 'Debby Silva', quando: 'sex., 16/10/2026 às 14:00 (horário de Brasília)', modalidade: 'presencial', local: null, ativa: true, podeAlterar: true, confirmada: false,
    });
    expect((await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db))[0].status).toBe('agendada');
    expect((await abrirLinkConsulta(token, deps(em('2026-10-16', '09:00')))) as { podeAlterar: boolean }).toMatchObject({ podeAlterar: false });
  });

  it('inválido, expirado (consulta começou), tenant suspenso', async () => {
    const { T, token } = await cenario();
    // troca um caractere do meio (o último carrega bits de preenchimento que o decodificador ignora)
    const adulterado = token.slice(0, 10) + (token[10] === 'A' ? 'B' : 'A') + token.slice(11);
    expect(await abrirLinkConsulta(adulterado, deps(em('2026-10-14', '09:00')))).toEqual({ estado: 'invalido' });
    expect(await abrirLinkConsulta(token, deps(em('2026-10-16', '14:00')))).toEqual({ estado: 'expirado' });
    await app.db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, T.tenantId));
    expect(await abrirLinkConsulta(token, deps(em('2026-10-14', '09:00')))).toEqual({ estado: 'indisponivel' });
    await expect(confirmarPeloLink(token, deps(em('2026-10-14', '09:00')))).rejects.toThrow(LinkError);
  });

  it('confirmar pelo link: "Confirmada pelo link", auditado como o paciente (sem ator, com o IP)', async () => {
    const { T, ana, id, token } = await cenario();
    await confirmarPeloLink(token, deps(em('2026-10-14', '09:00')));
    expect((await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db))[0]).toMatchObject({ status: 'confirmada', confirmadaVia: 'link' });
    const [log] = await withTenant(T.ctx, (tx) => tx.select().from(auditLog).where(and(eq(auditLog.entidade, 'agenda'), eq(auditLog.entidadeId, id), eq(auditLog.acao, 'alterar'))), app.db);
    expect(log).toMatchObject({ patientId: ana.id, actorUserId: null, ip: '203.0.113.9' });
  });

  it('remarcar pelo link: os horários incluem o da própria consulta; a nova vale; dentro de 24 h, recusa', async () => {
    const { token } = await cenario();
    const hs = await horariosDoLink(token, em('2026-10-16', '00:00'), em('2026-10-17', '00:00'), deps(em('2026-10-14', '09:00')));
    expect(hs.map((h) => h.hora)).toContain('14:00');
    expect(await remarcarPeloLink(token, { inicio: em('2026-10-16', '16:00').toISOString(), modalidade: 'presencial' }, deps(em('2026-10-14', '09:00')))).toEqual({ quando: 'sex., 16/10/2026 às 16:00 (horário de Brasília)' });
    const outro = await cenario();
    await expect(cancelarPeloLink(outro.token, deps(em('2026-10-16', '09:00')))).rejects.toSatisfy((e: unknown) => e instanceof ConsultaError && e.erros.geral === MSG_AGENDA.foraDoPrazo);
  });

  it('rodada 1 (RN-08, US-018): paciente arquivado, bloqueado ou anonimizado → link "indisponivel"; confirmar, cancelar, remarcar e avisar recusam (nunca 500) e nada muda', async () => {
    for (const mudanca of [{ status: 'arquivado' }, { status: 'bloqueado' }, { anonimizadoEm: em('2026-10-01', '09:00') }]) {
      const { T, ana, id, token } = await cenario();
      await withTenant(T.ctx, (tx) => tx.update(patients).set(mudanca).where(eq(patients.id, ana.id)), app.db);
      const d = deps(em('2026-10-14', '09:00'));
      expect(await abrirLinkConsulta(token, d), JSON.stringify(mudanca)).toEqual({ estado: 'indisponivel' });
      expect(await horariosDoLink(token, em('2026-10-16', '00:00'), em('2026-10-17', '00:00'), d)).toEqual([]);
      const acoes = [
        () => confirmarPeloLink(token, d),
        () => cancelarPeloLink(token, d),
        () => remarcarPeloLink(token, { inicio: em('2026-10-16', '16:00').toISOString(), modalidade: 'presencial' }, d),
        () => avisarRemarcacaoPeloLink(token, d),
      ];
      for (const acao of acoes) await expect(acao()).rejects.toSatisfy((e: unknown) => e instanceof LinkError && e.message === MSG_AGENDA.contaIndisponivel);
      expect((await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db))[0]).toMatchObject({ status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
    }
  });
});
```

Run: `pnpm test src/modules/agenda/acoes-link.test.ts` → FAIL (módulo não existe).

- [ ] **Step 6: Implementar** — `src/modules/agenda/acoes-link.ts`

```ts
import { eq } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments, patients, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { encryptionKey } from '@/lib/crypto';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { horariosParaPaciente } from './agendamento-paciente';
import { cancelarConsulta, confirmarPresenca, pedirRemarcacao, podeAlterarPeloPaciente, remarcarComoPaciente } from './cancelamento';
import { MSG_AGENDA } from './constantes';
import { STATUS_ATIVOS, type StatusConsulta } from './consultas';
import { quandoComFuso } from './fuso';
import { horariosVisiveis, type HorarioVisivel, type Modalidade } from './horarios';
import { chaveDosLinks, lerLinkConsulta } from './link-consulta';

export class LinkError extends Error {
  override name = 'LinkError';
}

export type DepsLink = { db?: Db; agora?: Date; chave?: Buffer; ip?: string | null; appUrl?: string };
export type EstadoLink =
  | { estado: 'invalido' | 'expirado' | 'indisponivel' }
  | {
      estado: 'ok';
      nutri: string;
      quando: string;
      modalidade: Modalidade;
      local: string | null;
      status: StatusConsulta;
      ativa: boolean;
      podeAlterar: boolean;
      confirmada: boolean;
      pedidoRemarcacao: boolean;
      temOnline: boolean;
      fuso: string;
    };

type Resolvido = { tenant: TenantRow; appointmentId: string; patientId: string; agora: Date; db: Db };
type Falha = { estado: 'invalido' | 'expirado' | 'indisponivel' };

/**
 * Token → tenant ativo + dono da consulta (lido no contexto `publico`: só o `patient_id` e a situação do paciente).
 * Rodada 1: paciente arquivado, bloqueado ou anonimizado (RN-08, US-018) → "indisponivel", como o tenant suspenso.
 */
async function resolver(token: string, deps: DepsLink): Promise<Resolvido | Falha> {
  const agora = deps.agora ?? new Date();
  const db = deps.db ?? getDb();
  const l = lerLinkConsulta(token, deps.chave ?? chaveDosLinks(encryptionKey()), agora);
  if (!l) return { estado: 'invalido' };
  if (l.expirado) return { estado: 'expirado' };
  const tenant = await buscarTenant(db, l.tenantId);
  if (!tenant) return { estado: 'invalido' };
  if (tenant.status !== 'ativa') return { estado: 'indisponivel' }; // RN-15
  const [c] = await withTenant(
    { tenantId: tenant.id, role: 'publico' },
    (tx) =>
      tx
        .select({ patientId: appointments.patientId, status: patients.status, anonimizadoEm: patients.anonimizadoEm })
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .where(eq(appointments.id, l.appointmentId)),
    db,
  );
  if (!c) return { estado: 'invalido' };
  if (c.status !== 'ativo' || c.anonimizadoEm) return { estado: 'indisponivel' };
  return { tenant, appointmentId: l.appointmentId, patientId: c.patientId, agora, db };
}

/** D20: as ações rodam como o próprio paciente (RLS por paciente), sem ator, com o IP de quem clicou. */
const comoPaciente = (r: Resolvido, ip?: string | null): TenantContext => ({ tenantId: r.tenant.id, role: 'paciente', patientId: r.patientId, ip: ip ?? null });

async function exigir(token: string, deps: DepsLink): Promise<Resolvido> {
  const r = await resolver(token, deps);
  if ('tenant' in r) return r;
  throw new LinkError(r.estado === 'expirado' ? MSG_AGENDA.linkExpirado : r.estado === 'indisponivel' ? MSG_AGENDA.contaIndisponivel : MSG_AGENDA.linkInvalido);
}

/** Rodada 1: paciente bloqueado/anonimizado entre abrir o link e agir → o mesmo "indisponível" do resolver (nunca 500). */
async function comoLink<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof PacienteBloqueadoError) throw new LinkError(MSG_AGENDA.contaIndisponivel);
    throw e;
  }
}

/** Leitura da página (GET): nunca muda estado — a pré-visualização de link do WhatsApp abre a URL. */
export async function abrirLinkConsulta(token: string, deps: DepsLink = {}): Promise<EstadoLink> {
  const r = await resolver(token, deps);
  if (!('tenant' in r)) return r;
  const [c] = await withTenant(comoPaciente(r), (tx) => tx.select().from(appointments).where(eq(appointments.id, r.appointmentId)), r.db);
  if (!c) return { estado: 'invalido' };
  if (c.inicio.getTime() <= r.agora.getTime()) return { estado: 'expirado' }; // consulta trazida para antes do fim do token
  const modalidade = c.modalidade as Modalidade;
  const ativa = STATUS_ATIVOS.includes(c.status as StatusConsulta);
  return {
    estado: 'ok',
    nutri: r.tenant.nomeExibicao,
    quando: quandoComFuso(c.inicio, r.tenant.fuso),
    modalidade,
    local: modalidade === 'online' ? c.linkOnline : r.tenant.enderecoConsultorio,
    status: c.status as StatusConsulta,
    ativa,
    podeAlterar: ativa && podeAlterarPeloPaciente(c.inicio, r.tenant.cancelamentoMinH, r.agora),
    confirmada: c.status === 'confirmada',
    pedidoRemarcacao: !!c.pedidoRemarcacaoEm,
    temOnline: !!r.tenant.linkOnlinePadrao,
    fuso: r.tenant.fuso,
  };
}

/** Horários para remarcar (a própria consulta não ocupa); recorte de uma semana. */
export async function horariosDoLink(token: string, de: Date, ate: Date, deps: DepsLink = {}): Promise<HorarioVisivel[]> {
  const r = await resolver(token, deps);
  if (!('tenant' in r)) return [];
  return horariosVisiveis(await horariosParaPaciente(r.tenant, r.agora, { db: r.db, de, ate, ignorarConsultaId: r.appointmentId }), r.tenant.fuso);
}

export async function confirmarPeloLink(token: string, deps: DepsLink = {}): Promise<'confirmada' | 'ja_confirmada' | 'nao_confirmavel'> {
  const r = await exigir(token, deps);
  return comoLink(() => confirmarPresenca(comoPaciente(r, deps.ip), r.appointmentId, 'link', { db: r.db, now: r.agora }));
}

export async function cancelarPeloLink(token: string, deps: DepsLink = {}): Promise<void> {
  const r = await exigir(token, deps);
  await comoLink(() => cancelarConsulta(comoPaciente(r, deps.ip), r.tenant, r.appointmentId, { por: 'paciente' }, { db: r.db, now: r.agora, appUrl: deps.appUrl }));
}

export async function remarcarPeloLink(token: string, input: { inicio: unknown; modalidade: unknown }, deps: DepsLink = {}): Promise<{ quando: string }> {
  const r = await exigir(token, deps);
  const novo = await comoLink(() => remarcarComoPaciente(comoPaciente(r, deps.ip), r.tenant, r.appointmentId, input, { db: r.db, now: r.agora, appUrl: deps.appUrl }));
  return { quando: quandoComFuso(novo.inicio, r.tenant.fuso) };
}

/** Fora do prazo do RN-04: o paciente só consegue avisar a nutricionista (US-035 "Preciso remarcar"). */
export async function avisarRemarcacaoPeloLink(token: string, deps: DepsLink = {}): Promise<void> {
  const r = await exigir(token, deps);
  await comoLink(() => pedirRemarcacao(comoPaciente(r, deps.ip), r.tenant, r.appointmentId, { db: r.db, now: r.agora, appUrl: deps.appUrl }));
}
```

Run: `pnpm test src/modules/agenda/acoes-link.test.ts` → PASS (5 testes).

- [ ] **Step 7: Seletor de horários e página do link**

`src/components/seletor-horarios.tsx` (sem hooks: serve a componentes de servidor e de cliente):

```tsx
import type { HorarioVisivel, Modalidade } from '@/modules/agenda/horarios';

/** Horários livres agrupados por dia (fieldset/legend), um rádio por horário. */
export function SeletorHorarios({ horarios, modalidade, erro }: { horarios: HorarioVisivel[]; modalidade?: Modalidade; erro?: string }) {
  const lista = modalidade ? horarios.filter((h) => h.modalidades.includes(modalidade)) : horarios;
  if (!lista.length) return <p>Nenhum horário livre nesta semana.</p>;
  const dias = [...new Set(lista.map((h) => h.dia))];
  return (
    <div className="space-y-3">
      {dias.map((dia) => (
        <fieldset key={dia} className="space-y-1" aria-describedby={erro ? 'inicio-erro' : undefined}>
          <legend className="font-medium">{dia}</legend>
          <div className="flex flex-wrap gap-2">
            {lista.filter((h) => h.dia === dia).map((h) => (
              <label key={h.inicio} className="flex items-center gap-1 rounded border px-2 py-1">
                <input type="radio" name="inicio" value={h.inicio} required /> {h.hora}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {erro && <p id="inicio-erro" role="alert" className="text-sm text-red-700">{erro}</p>}
    </div>
  );
}
```

`src/app/consulta/[token]/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { getEnv } from '@/env';
import { requestIp } from '@/lib/request-ip';
import { avisarRemarcacaoPeloLink, cancelarPeloLink, confirmarPeloLink, LinkError, remarcarPeloLink } from '@/modules/agenda/acoes-link';
import { MSG_AGENDA } from '@/modules/agenda/constantes';
import { ConsultaError } from '@/modules/agenda/consultas';
import { PacienteBloqueadoError } from '@/modules/pacientes/base';

export type AcaoLinkState = { ok?: string; erro?: string; erroHorario?: string };

async function executar(token: string, f: () => Promise<string>): Promise<AcaoLinkState> {
  try {
    const ok = await f();
    revalidatePath(`/consulta/${token}`);
    return { ok };
  } catch (e) {
    if (e instanceof LinkError) return { erro: e.message };
    // rodada 1 (US-018): o acoes-link já converte; aqui é a última rede — paciente bloqueado nunca vira 500
    if (e instanceof PacienteBloqueadoError) return { erro: MSG_AGENDA.contaIndisponivel };
    if (e instanceof ConsultaError) return e.erros.inicio ? { erroHorario: e.erros.inicio } : { erro: e.erros.geral ?? Object.values(e.erros)[0] };
    throw e;
  }
}
const deps = async () => ({ ip: await requestIp(), appUrl: getEnv().APP_URL });

export async function confirmarAction(token: string): Promise<AcaoLinkState> {
  return executar(token, async () => {
    const r = await confirmarPeloLink(token, await deps());
    return r === 'nao_confirmavel' ? MSG_AGENDA.naoAlteravel : MSG_AGENDA.presencaConfirmada;
  });
}
export async function cancelarAction(token: string): Promise<AcaoLinkState> {
  return executar(token, async () => {
    await cancelarPeloLink(token, await deps());
    return MSG_AGENDA.cancelada;
  });
}
export async function remarcarAction(token: string, _prev: AcaoLinkState, fd: FormData): Promise<AcaoLinkState> {
  return executar(token, async () => MSG_AGENDA.remarcada((await remarcarPeloLink(token, { inicio: fd.get('inicio'), modalidade: fd.get('modalidade') }, await deps())).quando));
}
export async function avisarAction(token: string): Promise<AcaoLinkState> {
  return executar(token, async () => {
    await avisarRemarcacaoPeloLink(token, await deps());
    return 'Avisamos sua nutricionista. Ela vai entrar em contato.';
  });
}
```

`src/app/consulta/[token]/acoes.tsx`:

```tsx
'use client';

import { useActionState, useState } from 'react';
import { SeletorHorarios } from '@/components/seletor-horarios';
import type { HorarioVisivel, Modalidade } from '@/modules/agenda/horarios';
import { avisarAction, cancelarAction, confirmarAction, remarcarAction, type AcaoLinkState } from './actions';

type Props = { token: string; confirmada: boolean; podeAlterar: boolean; pedidoRemarcacao: boolean; modalidade: Modalidade; temOnline: boolean; horarios: HorarioVisivel[] };

function Retorno({ s }: { s: AcaoLinkState }) {
  if (s.erro) return <p role="alert" className="text-red-700">{s.erro}</p>;
  if (s.ok) return <p role="status" className="rounded bg-emerald-50 p-3">{s.ok}</p>;
  return null;
}

export function AcoesConsulta({ token, confirmada, podeAlterar, pedidoRemarcacao, modalidade, temOnline, horarios }: Props) {
  const [conf, confirmar, confirmando] = useActionState<AcaoLinkState>(confirmarAction.bind(null, token), {});
  const [canc, cancelar, cancelando] = useActionState<AcaoLinkState>(cancelarAction.bind(null, token), {});
  const [avis, avisar, avisando] = useActionState<AcaoLinkState>(avisarAction.bind(null, token), {});
  const [rem, remarcar, remarcando] = useActionState<AcaoLinkState, FormData>(remarcarAction.bind(null, token), {});
  const [mod, setMod] = useState<Modalidade>(modalidade);
  return (
    <div className="space-y-6">
      {!confirmada && (
        <form action={confirmar}>
          <button disabled={confirmando} className="rounded bg-emerald-700 px-4 py-2 text-white">Confirmar presença</button>
        </form>
      )}
      <Retorno s={conf} />
      {podeAlterar ? (
        <>
          <section aria-labelledby="remarcar" className="space-y-3">
            <h2 id="remarcar" className="text-lg font-semibold">Remarcar</h2>
            <form action={remarcar} className="space-y-3">
              {temOnline && (
                <fieldset className="space-y-1">
                  <legend className="font-medium">Modalidade</legend>
                  {(['presencial', 'online'] as const).map((m) => (
                    <div key={m} className="flex items-center gap-2">
                      <input id={`mod-${m}`} type="radio" name="modalidade" value={m} checked={mod === m} onChange={() => setMod(m)} />
                      <label htmlFor={`mod-${m}`}>{m === 'presencial' ? 'Presencial' : 'Online'}</label>
                    </div>
                  ))}
                </fieldset>
              )}
              {!temOnline && <input type="hidden" name="modalidade" value="presencial" />}
              <p className="font-medium">Escolha um novo horário</p>
              <SeletorHorarios horarios={horarios} modalidade={mod} erro={rem.erroHorario} />
              <button disabled={remarcando} className="rounded border px-4 py-2">Remarcar para este horário</button>
            </form>
            <Retorno s={rem} />
          </section>
          <form action={cancelar} onSubmit={(e) => { if (!window.confirm('Cancelar esta consulta?')) e.preventDefault(); }}>
            <button disabled={cancelando} className="underline">Cancelar consulta</button>
          </form>
          <Retorno s={canc} />
        </>
      ) : (
        <>
          <p role="status">Para alterar, fale com sua nutricionista.</p>
          {!pedidoRemarcacao && (
            <form action={avisar}>
              <button disabled={avisando} className="underline">Avisar que preciso remarcar</button>
            </form>
          )}
          <Retorno s={avis} />
        </>
      )}
    </div>
  );
}
```

`src/app/consulta/[token]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { horariosDoLink, abrirLinkConsulta } from '@/modules/agenda/acoes-link';
import { MSG_AGENDA, ROTULO_MODALIDADE } from '@/modules/agenda/constantes';
import { diaDaSemana, inicioDoDia, somarDias } from '@/modules/agenda/fuso';
import { dataValida, formatarData, hojeNoFuso } from '@/modules/pacientes/datas';
import { AcoesConsulta } from './acoes';

export const dynamic = 'force-dynamic';
// O token está na URL: nunca mandá-lo como Referer (o next.config também manda o cabeçalho em /consulta/*)
export const metadata: Metadata = { title: 'Sua consulta', referrer: 'no-referrer', robots: { index: false, follow: false } };

const SITUACAO = { agendada: 'Agendada', confirmada: 'Presença confirmada', cancelada: MSG_AGENDA.consultaJaCancelada, realizada: 'Consulta realizada', faltou: 'Consulta encerrada' } as const;

function Aviso({ texto }: { texto: string }) {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Sua consulta</h1>
      <p role="alert">{texto}</p>
    </main>
  );
}

export default async function ConsultaPeloLink({ params, searchParams }: PageProps<'/consulta/[token]'>) {
  const { token } = await params;
  const sp = await searchParams;
  const e = await abrirLinkConsulta(token);
  if (e.estado === 'invalido') return <Aviso texto={MSG_AGENDA.linkInvalido} />;
  if (e.estado === 'expirado') return <Aviso texto={MSG_AGENDA.linkExpirado} />;
  if (e.estado === 'indisponivel') return <Aviso texto={MSG_AGENDA.contaIndisponivel} />;
  const hoje = hojeNoFuso(e.fuso);
  const pedida = typeof sp.semana === 'string' && dataValida(sp.semana) ? sp.semana : hoje;
  const semana = somarDias(pedida, -((diaDaSemana(pedida) + 6) % 7));
  const horarios = e.podeAlterar ? await horariosDoLink(token, inicioDoDia(semana, e.fuso), inicioDoDia(somarDias(semana, 7), e.fuso)) : [];
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Sua consulta</h1>
      <p>{`Com ${e.nutri} · ${e.quando} · ${ROTULO_MODALIDADE[e.modalidade]}`}</p>
      {e.local && <p className="text-sm">{e.modalidade === 'online' ? `Link da chamada: ${e.local}` : `Endereço: ${e.local}`}</p>}
      <p role="status">{SITUACAO[e.status]}</p>
      {e.ativa && (
        <>
          {e.podeAlterar && (
            <nav aria-label="Semana" className="flex gap-3 text-sm">
              <Link href={`/consulta/${token}?semana=${somarDias(semana, -7)}`} className="underline">Semana anterior</Link>
              <span>{`${formatarData(semana)} a ${formatarData(somarDias(semana, 6))}`}</span>
              <Link href={`/consulta/${token}?semana=${somarDias(semana, 7)}`} className="underline">Próxima semana</Link>
            </nav>
          )}
          <AcoesConsulta token={token} confirmada={e.confirmada} podeAlterar={e.podeAlterar} pedidoRemarcacao={e.pedidoRemarcacao} modalidade={e.modalidade} temOnline={e.temOnline} horarios={horarios} />
        </>
      )}
    </main>
  );
}
```

`next.config.ts` — o mesmo cabeçalho do convite para o link da consulta:

```ts
  headers: async () => [
    { source: '/convite/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    // D20: o token do link da consulta também está na URL
    { source: '/consulta/:token*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
  ],
```

- [ ] **Step 8: "Cancelar consulta" no painel**

Em `src/app/painel/agenda/actions.ts` (import `cancelarConsulta` de `@/modules/agenda/cancelamento`):

```ts
export async function cancelarAction(id: string, _prev: ConsultaState, fd: FormData): Promise<ConsultaState> {
  const { ctx, tenant } = await requireNutri(`/painel/agenda/consultas/${id}`);
  const v = { motivo: String(fd.get('motivo') ?? '') };
  try {
    await cancelarConsulta(ctx, tenant, id, { por: 'nutri', motivo: v.motivo });
  } catch (e) {
    return tratar(e, v);
  }
  revalidatePath('/painel/agenda');
  redirect(`/painel/agenda/consultas/${id}?ok=cancelada`);
}
```

`src/app/painel/agenda/consultas/[id]/cancelar-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import type { ConsultaState } from '../../actions';

export function CancelarForm({ acao }: { acao: (prev: ConsultaState, fd: FormData) => Promise<ConsultaState> }) {
  const [state, action, pendente] = useActionState<ConsultaState, FormData>(acao, {});
  const e = state.erros ?? {};
  return (
    <form action={action} className="max-w-xl space-y-3" onSubmit={(ev) => { if (!window.confirm('Cancelar esta consulta? O paciente recebe um aviso por e-mail.')) ev.preventDefault(); }}>
      <Campo id="motivo" rotulo="Motivo do cancelamento (opcional)" maxLength={300} defaultValue={state.valores?.motivo} erro={e.motivo} dica="Só você vê." />
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      <button disabled={pendente} className="rounded border border-red-700 px-4 py-2 text-red-800">Cancelar consulta</button>
    </form>
  );
}
```

Na página da consulta (`src/app/painel/agenda/consultas/[id]/page.tsx`): a mensagem `ok` ganha `sp.ok === 'cancelada' ? MSG_AGENDA.cancelada`, e o comentário "Tarefa 7" vira (só para consulta ativa):

```tsx
        {ativa && (
          <section aria-labelledby="cancelar" className="space-y-2">
            <h2 id="cancelar" className="text-lg font-semibold">Cancelar consulta</h2>
            <CancelarForm acao={cancelarAction.bind(null, c.id)} />
          </section>
        )}
```

(imports `cancelarAction` de `../../actions` e `CancelarForm` de `./cancelar-form`).

- [ ] **Step 9: E2E** — acrescentar a `e2e/agenda.spec.ts` (import `primeiroLink` de `./mailpit`)

```ts
test('link da consulta: confirmar, remarcar (US-033, US-035) e cancelamento pela nutricionista', async ({ browser }) => {
  const email = await esperarEmail(`carla-${sufixo}@ex.com`, { assunto: `Consulta marcada: seg., ${br(SEGUNDA_LIVRE)} às 11:00 (horário de Brasília)` });
  const link = primeiroLink(email.texto, '/consulta/');
  const paciente = await (await browser.newContext()).newPage();
  await paciente.goto(link);
  await expect(paciente.getByText(`Com Consultório E2E · seg., ${br(SEGUNDA_LIVRE)} às 11:00 (horário de Brasília) · Presencial`)).toBeVisible();
  await paciente.getByRole('button', { name: 'Confirmar presença' }).click();
  await expect(paciente.getByRole('status').filter({ hasText: 'Presença confirmada. Até lá!' })).toBeVisible();
  await nutri.goto(`/painel/agenda?visao=dia&data=${SEGUNDA_LIVRE}`);
  await expect(nutri.getByText('Confirmada pelo link')).toBeVisible();

  await paciente.goto(`${link}?semana=${SEGUNDA_LIVRE}`);
  await paciente.getByRole('group', { name: `ter., ${br(somar(SEGUNDA_LIVRE, 1)).slice(0, 5)}` }).getByRole('radio', { name: '14:00' }).check();
  await paciente.getByRole('button', { name: 'Remarcar para este horário' }).click();
  await expect(paciente.getByText(`Consulta remarcada para ter., ${br(somar(SEGUNDA_LIVRE, 1))} às 14:00 (horário de Brasília).`)).toBeVisible();
  await nutri.goto(`/painel/agenda?visao=semana&data=${SEGUNDA_LIVRE}`);
  await expect(nutri.getByText('Cancelada pelo paciente')).toBeVisible();

  // a nutricionista cancela a nova; a paciente recebe o aviso
  await nutri.getByRole('link', { name: `Carla Agenda ${sufixo}` }).last().click();
  nutri.once('dialog', (d) => d.accept());
  await nutri.getByLabel('Motivo do cancelamento (opcional)').fill('Imprevisto');
  await nutri.getByRole('button', { name: 'Cancelar consulta' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Consulta cancelada.' })).toBeVisible();
  await esperarEmail(`carla-${sufixo}@ex.com`, { assunto: `Consulta cancelada: ter., ${br(somar(SEGUNDA_LIVRE, 1))} às 14:00 (horário de Brasília)` });
  await paciente.context().close();
});
```

Run: `pnpm e2e:seed && pnpm test:e2e e2e/agenda.spec.ts`
Expected: PASS (4 testes).

- [ ] **Step 10: Commit**

```bash
git add src/modules/agenda src/components/seletor-horarios.tsx src/app/consulta src/app/painel/agenda next.config.ts e2e/agenda.spec.ts
git commit -m "feat(agenda): cancelar, remarcar e confirmar pelo link assinado da consulta (US-033, US-035, RN-04)"
```

---
### Task 8: Página pública `/n/<slug>` — Turnstile, código por e-mail, limites, paciente novo e aceite do termo (P05-04)

**Files:**
- Create: `drizzle/0054_agendamento_publico.sql` (gerada), `drizzle/0055_rls_agendamento_publico.sql` (custom), `src/modules/agenda/limite-ip.ts`, `src/modules/agenda/limite-ip.test.ts`, `src/modules/agenda/agendamento-publico.ts`, `src/modules/agenda/agendamento-publico.test.ts`, `src/app/api/n/[slug]/resposta.ts`, `src/app/api/n/[slug]/codigo/route.ts`, `src/app/api/n/[slug]/codigo/route.test.ts`, `src/app/api/n/[slug]/confirmar/route.ts`, `src/app/api/n/[slug]/horario/route.ts`, `src/app/n/[slug]/page.tsx`, `src/app/n/[slug]/agendar-form.tsx`
- Modify: `src/db/schema/agenda.ts`, `src/db/schema/access.ts` (`consents`), `src/db/rls-guard.ts` (`STAFF_ONLY`, `PUBLICO_LIBERADO`, texto de `RLS_EXCEPTIONS.consents`), `src/db/audit-guard.ts`, `src/modules/plataforma/tenant-status.ts` (`buscarTenantPorSlug`), `test/isolamento.test.ts`, `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/jobs/queues.ts`, `src/worker/index.ts`, `CLAUDE.md` (regra 1), `scripts/e2e-seed.ts`, `e2e/agenda.spec.ts`

**Interfaces:**
- Consumes: `escolherHorario`, `gravarConsultaDoPaciente`, `horariosParaPaciente`, `type HorarioEscolhido` (Tarefa 6); `ConsultaError`, `ehSobreposicao`, `appointments` (Tarefa 3); `horariosVisiveis`, `type HorarioVisivel` (Tarefa 7); `SeletorHorarios` (Tarefa 7); `quandoComFuso`, `diaDaSemana`, `inicioDoDia`, `somarDias` (Tarefa 1); `MSG_AGENDA`, `MAX_CONSULTAS_FUTURAS_PUBLICO`; `verifyTurnstile`, `MSG_TURNSTILE_FORA`, `MSG_TURNSTILE_INVALIDO`, `type ResultadoTurnstile`; `TurnstileWidget`; `TERMO_PACIENTE`, `TERMO_PACIENTE_ROTULO`, `TERMO_PACIENTE_PARAGRAFOS`, `TERMO_PACIENTE_TITULO`, `MSG_TERMO_NAO_ACEITO`; `normalizarTelefone`; `normalizeEmail`, `normalizarTexto`; `randomToken`, `sha256`, `safeEqual`, `encryptionKey`; `clientIp`; `lerCorpoLimitado`, `CorpoGrandeError`; `enqueueEmail`; `citext`, `patients`, `consents`; `listarTenantsParaVarredura`.
- Produces:
  - Schema: `publicBookingRequests` 🔒 staff_only (liberada ao contexto `publico` em `select`, `insert`, `update` — D11), `publicRateLimits` (sem `tenant_id`), `consents.patientId` + `consents.userId` nulo (D13).
  - `@/modules/plataforma/tenant-status`: `buscarTenantPorSlug(db, slug): Promise<TenantRow | null>` (formato inválido → `null` sem consultar; `tenants` só se lê em `src/modules/plataforma`, CLAUDE.md regra 1).
  - `@/modules/agenda/limite-ip`: `chaveDoLimite(tipo: 'ip' | 'email-hora', valor: string): string`, `consumirLimite(db, chave, limite, janelaS, agora): Promise<boolean>`, `limparLimites(db, agora): Promise<number>`.
  - `@/modules/agenda/agendamento-publico`: `MSG_PUBLICO`, `class PublicoError { status: number; erros: Record<string, string> }`, `type PaginaPublica`, `carregarPaginaPublica(slug, opts: { semana?: unknown; agora?: Date; db?: Db }): Promise<PaginaPublica>`, `type DepsPublico = { db?; agora?; ip: string | null; verificarTurnstile: (token: string | null) => Promise<ResultadoTurnstile>; appUrl? }`, `solicitarCodigo(slug, input, deps): Promise<{ pedido: string }>`, `type ResultadoConfirmacao = { estado: 'agendada'; quando: string } | { estado: 'horario_ocupado'; horarios: HorarioVisivel[] }`, `confirmarCodigo(slug, input, deps)`, `escolherOutroHorario(slug, input, deps)`, `limparPedidosPublicos(db, agora): Promise<number>`.
  - Rotas `POST /api/n/[slug]/codigo` (200 `{ pedido }` · 422 `{ erros }` · 403/503 `{ erro }` (Turnstile) · 409 · 404 · 429 · 400 JSON inválido · 413), `POST /api/n/[slug]/confirmar` e `POST /api/n/[slug]/horario` (200 `ResultadoConfirmacao` · 422 · 409 · 410 · 429).
  - `EmailMessage` ganha `{ tipo: 'codigo_agendamento'; para; nutri; codigo }`.
  - Fila `agenda-limpeza` (diária, 04:30): apaga pedidos públicos com mais de 24 h e contadores velhos.

- [ ] **Step 1: Tabelas e `consents`**

Acrescentar a `src/db/schema/agenda.ts` (imports: `boolean`, `integer` de `drizzle-orm/pg-core`; `citext` de `./pacientes`):

```ts
/**
 * RN-16: pedido da página pública até o código de 6 dígitos ser confirmado. Só o hash do token do pedido e o
 * HMAC do código são guardados; a linha some em 24 h (agenda-limpeza). A sessão de paciente não vê (staff_only).
 */
export const publicBookingRequests = pgTable(
  'public_booking_requests',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    tokenHash: text('token_hash').notNull().unique(),
    codigoHash: text('codigo_hash').notNull(),
    email: citext('email').notNull(),
    nome: text('nome').notNull(),
    telefoneE164: text('telefone_e164'),
    whatsappOptin: boolean('whatsapp_optin').notNull().default(false),
    inicio: timestamp('inicio', { withTimezone: true }).notNull(),
    modalidade: text('modalidade').notNull(),
    termoVersao: text('termo_versao').notNull(),
    ip: text('ip'),
    tentativas: smallint('tentativas').notNull().default(0),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    verificadoEm: timestamp('verificado_em', { withTimezone: true }),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }),
    appointmentId: uuid('appointment_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('public_booking_requests_modalidade', sql`${t.modalidade} in ('presencial', 'online')`),
    check('public_booking_requests_nome', sql`char_length(${t.nome}) between 2 and 120`),
    index('public_booking_requests_email_idx').on(t.tenantId, t.email, t.createdAt),
    index('public_booking_requests_criado_idx').on(t.tenantId, t.createdAt),
  ],
);

/** RN-16: contadores da página pública. A chave é o HMAC do IP ou do e-mail, nunca o valor. Sem tenant_id: só limite-ip.ts. */
export const publicRateLimits = pgTable('public_rate_limits', {
  chave: text('chave').primaryKey(),
  janelaInicio: timestamp('janela_inicio', { withTimezone: true }).notNull(),
  contagem: integer('contagem').notNull(),
});
```

Em `src/db/schema/access.ts`, `consents` passa a (D13; imports `check`, `foreignKey` já existem no arquivo ou acrescente):

```ts
/**
 * Aceites versionados (DPA da nutricionista; termo do paciente). Sem cascade: é prova de aceite.
 * D13 (Plano 05): o aceite da página pública é do prontuário (`patient_id` + `tenant_id`), porque o visitante ainda não tem conta.
 */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => user.id),
    /** Termo do paciente: o tenant do vínculo aceito. DPA da nutricionista: nulo. */
    tenantId: uuid('tenant_id').references(() => tenants.id),
    patientId: uuid('patient_id'),
    termoVersao: text('termo_versao').notNull(),
    aceitoEm: timestamp('aceito_em', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
  },
  (t) => [
    unique('consents_titular_termo_unique').on(t.userId, t.termoVersao, t.tenantId, t.patientId).nullsNotDistinct(),
    check('consents_titular', sql`${t.userId} is not null or (${t.patientId} is not null and ${t.tenantId} is not null)`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'consents_paciente_fk' }),
  ],
);
```

Run: `pnpm db:generate --name agendamento_publico` → `drizzle/0054_agendamento_publico.sql` (confira: 2 tabelas novas; em `consents`, `DROP CONSTRAINT consents_user_termo_tenant_unique`, `user_id DROP NOT NULL`, `ADD COLUMN patient_id`, a UNIQUE NULLS NOT DISTINCT nova, o CHECK e a FK). O `REVOKE UPDATE, DELETE ON consents` da 0009 continua valendo.

Run: `pnpm drizzle-kit generate --custom --name rls_agendamento_publico` e preencher `drizzle/0055_rls_agendamento_publico.sql`:

```sql
SELECT app_enable_tenant_rls('public_booking_requests');
--> statement-breakpoint
SELECT app_enable_staff_only('public_booking_requests');
--> statement-breakpoint
-- D11: o pedido da página pública é lido, criado e atualizado (tentativas, verificado, concluído; SELECT … FOR UPDATE) no contexto publico
SELECT app_allow_publico('public_booking_requests', 'select', 'insert', 'update');
```

`src/db/rls-guard.ts`:
- `STAFF_ONLY`: `public_booking_requests: 'RN-16: pedido da página pública (código, contato) — só o contexto publico e a equipe',`
- `PUBLICO_LIBERADO`: `public_booking_requests: { comandos: ['select', 'insert', 'update'], motivo: 'pedido da página pública: cria, confere o código (FOR UPDATE) e conclui' },`
- `RLS_EXCEPTIONS.consents`: o fim do texto passa a "…acesso só por src/modules/plataforma/dpa.ts, src/modules/pacientes/convite-paciente.ts e src/modules/agenda/agendamento-publico.ts (aceite da página pública, D13)".

`src/db/audit-guard.ts`, `AUDIT_EXCEPTIONS`: `consents: 'prova de aceite do termo (versão, data, IP), append-only; não é dado de saúde',`.

`test/isolamento.test.ts`, no `FABRICAS`:

```ts
  public_booking_requests: (t) =>
    sql`insert into public_booking_requests (id, tenant_id, token_hash, codigo_hash, email, nome, inicio, modalidade, termo_versao, expira_em)
        values (gen_random_uuid(), ${t}, ${randomUUID()}, 'x', ${`iso-${randomUUID().slice(0, 8)}@teste.dev`}, 'Iso', '2030-01-01T12:00:00Z', 'presencial', 't', now() + interval '10 minutes')`,
```

`CLAUDE.md`, regra 1: em "As tabelas do M1 fora da RLS (…)", acrescentar `public_rate_limits` (sem `tenant_id`, só `src/modules/agenda/limite-ip.ts`), e na frase de `consents`, acrescentar `src/modules/agenda/agendamento-publico.ts` (aceite do termo na página pública, Plano 05).

Em `scripts/e2e-seed.ts`: `const AGENDA_E2E = ['public_booking_requests', 'notifications', 'appointments', 'availability_blocks', 'availability_rules'];` e, no `onConflictDoUpdate` do consultório, `linkOnlinePadrao: 'https://meet.example.test/e2e'`, `enderecoConsultorio: 'Rua E2E, 100'`, `agendamentoPublicoAtivo: true` (também no `values`).

Run: `pnpm test src/db test/isolamento.test.ts src/modules/plataforma/dpa.test.ts src/modules/pacientes/convite-paciente.test.ts`
Expected: PASS (o DPA e o aceite do convite continuam com uma prova por versão).

- [ ] **Step 2: Limite por IP/e-mail (falha → passa)** — `src/modules/agenda/limite-ip.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { publicRateLimits } from '@/db/schema';
import { chaveDoLimite, consumirLimite, limparLimites } from './limite-ip';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

describe('limite da página pública (RN-16)', () => {
  it('10 por hora: a 11ª é recusada; passada a janela, volta a contar do 1', async () => {
    const chave = chaveDoLimite('ip', `198.51.100.${Math.floor(Math.random() * 250)}-${Date.now()}`);
    const t0 = new Date('2026-10-16T12:00:00Z');
    for (let i = 0; i < 10; i++) expect(await consumirLimite(app.db, chave, 10, 3600, t0)).toBe(true);
    expect(await consumirLimite(app.db, chave, 10, 3600, new Date(t0.getTime() + 59 * 60_000))).toBe(false);
    expect(await consumirLimite(app.db, chave, 10, 3600, new Date(t0.getTime() + 61 * 60_000))).toBe(true);
  });
  it('a chave é HMAC (nunca o IP ou o e-mail) e limpar apaga os velhos', async () => {
    const chave = chaveDoLimite('email-hora', 'tenant:ana@ex.com');
    expect(chave).toMatch(/^email-hora:[A-Za-z0-9_-]{43}$/);
    expect(chave).not.toContain('ana');
    await consumirLimite(app.db, chave, 5, 3600, new Date('2020-01-01T00:00:00Z'));
    expect(await limparLimites(app.db, new Date('2026-10-16T00:00:00Z'))).toBeGreaterThanOrEqual(1);
    expect((await app.db.select().from(publicRateLimits)).some((l) => l.chave === chave)).toBe(false);
  });
});
```

`src/modules/agenda/limite-ip.ts`:

```ts
import { createHmac, hkdfSync } from 'node:crypto';
import { lt, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { publicRateLimits } from '@/db/schema';
import { encryptionKey } from '@/lib/crypto';

let chave: Buffer | undefined;
const chaveDosLimites = () => (chave ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:limite-publico:v1', 32)));

/** RN-16 / LGPD: a linha guarda o HMAC do IP ou do e-mail, nunca o valor. */
export function chaveDoLimite(tipo: 'ip' | 'email-hora', valor: string): string {
  return `${tipo}:${createHmac('sha256', chaveDosLimites()).update(valor).digest('base64url')}`;
}

/** Conta mais uma tentativa na janela, de forma atômica, e diz se ainda está dentro do limite. */
export async function consumirLimite(db: Db, chaveLimite: string, limite: number, janelaS: number, agora: Date): Promise<boolean> {
  const virou = sql`public_rate_limits.janela_inicio <= ${agora}::timestamptz - make_interval(secs => ${janelaS})`;
  const r = await db.execute<{ contagem: number }>(sql`
    insert into public_rate_limits (chave, janela_inicio, contagem) values (${chaveLimite}, ${agora}, 1)
    on conflict (chave) do update set
      contagem = case when ${virou} then 1 else public_rate_limits.contagem + 1 end,
      janela_inicio = case when ${virou} then ${agora}::timestamptz else public_rate_limits.janela_inicio end
    returning contagem`);
  return Number(r.rows[0].contagem) <= limite;
}

/** Diário (agenda-limpeza): contadores de mais de 1 dia. */
export async function limparLimites(db: Db, agora: Date): Promise<number> {
  const r = await db.delete(publicRateLimits).where(lt(publicRateLimits.janelaInicio, new Date(agora.getTime() - 86_400_000))).returning({ chave: publicRateLimits.chave });
  return r.length;
}
```

Run: `pnpm test src/modules/agenda/limite-ip.test.ts` → PASS (2 testes).

- [ ] **Step 3: E-mail do código**

`src/email/types.ts`: `| { tipo: 'codigo_agendamento'; para: string; nutri: string; codigo: string }` (o job da fila `email` já vai cifrado).

`src/email/templates.tsx`:

```tsx
    case 'codigo_agendamento':
      return simples(`Seu código para agendar com ${msg.nutri}: ${msg.codigo}`, [
        `Use o código ${msg.codigo} para confirmar o agendamento com ${msg.nutri}.`,
        'Ele vale por 10 minutos. Se não foi você que pediu, ignore este e-mail.',
      ]);
```

`src/email/render.test.ts`:

```ts
  it('código do agendamento público: código no assunto e no corpo, validade de 10 min', () => {
    const r = renderEmail({ tipo: 'codigo_agendamento', para: 'ana@ex.com', nutri: 'Debby Silva', codigo: '042917' });
    expect(r.subject).toBe('Seu código para agendar com Debby Silva: 042917');
    expect(r.text).toContain('10 minutos');
  });
```

- [ ] **Step 4: Testes do fluxo (falham)** — `src/modules/agenda/agendamento-publico.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, semanaToda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { appointments, consents, patients, publicBookingRequests, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { buscarTenantPorSlug } from '@/modules/plataforma/tenant-status';
import { carregarPaginaPublica, confirmarCodigo, escolherOutroHorario, MSG_PUBLICO, PublicoError, solicitarCodigo, type DepsPublico } from './agendamento-publico';
import { MSG_AGENDA } from './constantes';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const agora = em('2026-10-14', '10:00');
/** Um IP por chamada (o limite de 10 por hora vale por IP): 16 milhões de combinações, sem colisão entre testes. */
const r254 = () => Math.floor(Math.random() * 254) + 1;
const ipUnico = () => `10.${r254()}.${r254()}.${r254()}`;
const deps = (extra: Partial<DepsPublico> = {}): DepsPublico => ({ db: app.db, agora, ip: ipUnico(), verificarTurnstile: async () => 'ok', appUrl: 'http://localhost:3000', ...extra });

async function consultorio(extra: Partial<typeof tenants.$inferInsert> = {}): Promise<TenantDeTeste & { slug: string }> {
  const T = await novoTenant(app.db, 'Debby Silva');
  const [t] = await app.db.update(tenants).set({ enderecoConsultorio: 'Rua das Flores, 10', ...extra }).where(eq(tenants.id, T.tenantId)).returning();
  await semanaToda(app.db, T.ctx);
  return { ...T, slug: t.slug };
}
const pedido = (inicio = em('2026-10-16', '09:00'), extra: Record<string, unknown> = {}) => ({
  nome: 'Ana Souza', email: `ana-${randomUUID().slice(0, 8)}@ex.com`, telefone: '(11) 91234-5678', maiorDeIdade: true, aceitouTermo: true, whatsapp: true,
  inicio: inicio.toISOString(), modalidade: 'presencial', turnstileToken: 'tok', ...extra,
});
const codigoDe = async (email: string) => (await emailsNaFila('codigo_agendamento', email)).at(-1)!.codigo;
const falha = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof PublicoError) return { status: e.status, erros: e.erros };
    throw e;
  }
  throw new Error('esperava PublicoError');
};

describe('página pública (US-032, RN-16)', () => {
  it('ativa: nome e horários livres (só horas); desativada: "Agendamento online indisponível. Entre em contato."; inexistente', async () => {
    const T = await consultorio();
    const p = await carregarPaginaPublica(T.slug, { agora, db: app.db, semana: '2026-10-15' });
    expect(p).toMatchObject({ estado: 'ativa', nome: 'Debby Silva', temOnline: false, semana: '2026-10-12' });
    if (p.estado !== 'ativa') throw new Error();
    expect(p.horarios[0]).toEqual({ inicio: em('2026-10-15', '08:00').toISOString(), dia: 'qui., 15/10', data: '2026-10-15', hora: '08:00', modalidades: ['presencial'] });
    const D = await consultorio({ agendamentoPublicoAtivo: false });
    expect(await carregarPaginaPublica(D.slug, { agora, db: app.db })).toEqual({ estado: 'desativada', nome: 'Debby Silva' });
    expect(await carregarPaginaPublica('nao-existe-xyz', { agora, db: app.db })).toEqual({ estado: 'nao_encontrada' });
    expect(await carregarPaginaPublica('../x', { agora, db: app.db })).toEqual({ estado: 'nao_encontrada' });
    // a leitura de `tenants` é da plataforma (CLAUDE.md regra 1)
    expect((await buscarTenantPorSlug(app.db, T.slug))?.id).toBe(T.tenantId);
    expect(await buscarTenantPorSlug(app.db, "x' or '1'='1")).toBeNull();
  });

  it('fluxo feliz: código no e-mail → paciente novo sem nascimento/sexo, consulta, aceite do termo e aviso "novo paciente"', async () => {
    const T = await consultorio();
    const entrada = pedido();
    const { pedido: token } = await solicitarCodigo(T.slug, entrada, deps());
    const r = await confirmarCodigo(T.slug, { pedido: token, codigo: await codigoDe(entrada.email) }, deps());
    expect(r).toEqual({ estado: 'agendada', quando: 'sex., 16/10/2026 às 09:00 (horário de Brasília)' });
    const [p] = await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.email, entrada.email)), app.db);
    expect(p).toMatchObject({ nome: 'Ana Souza', origem: 'agendamento_publico', dataNascimento: null, sexo: null, telefoneE164: '+5511912345678', whatsappOptinOrigem: 'paciente' });
    const [c] = await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, p.id)), app.db);
    expect(c).toMatchObject({ origem: 'paciente', status: 'agendada', inicio: em('2026-10-16', '09:00') });
    const [aceite] = await app.db.select().from(consents).where(eq(consents.patientId, p.id));
    expect(aceite).toMatchObject({ userId: null, tenantId: T.tenantId, termoVersao: TERMO_PACIENTE });
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect((await emailsNaFila('aviso_agenda', nutri.email)).map((m) => m.evento)).toEqual(['novo_paciente_publico']);
    await expect(confirmarCodigo(T.slug, { pedido: token, codigo: '000000' }, deps())).rejects.toBeInstanceOf(PublicoError); // pedido já concluído
  });

  it('e-mail de paciente ativo: a consulta vai para ele (sem duplicar); arquivado → "Não foi possível agendar por aqui…"', async () => {
    const T = await consultorio();
    const ana = await novoPaciente(app.db, T.ctx, { email: `ana-${randomUUID().slice(0, 8)}@ex.com` });
    const e1 = pedido(em('2026-10-16', '09:00'), { email: ana.email.toUpperCase() });
    const t1 = await solicitarCodigo(T.slug, e1, deps());
    await confirmarCodigo(T.slug, { pedido: t1.pedido, codigo: await codigoDe(ana.email) }, deps());
    expect(await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.patientId, ana.id)), app.db)).toHaveLength(1);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(patients).where(eq(patients.email, ana.email)), app.db)).toHaveLength(1);
    const arq = await novoPaciente(app.db, T.ctx, { status: 'arquivado' });
    const t2 = await solicitarCodigo(T.slug, pedido(em('2026-10-16', '10:00'), { email: arq.email }), deps());
    expect(await falha(confirmarCodigo(T.slug, { pedido: t2.pedido, codigo: await codigoDe(arq.email) }, deps()))).toEqual({ status: 409, erros: { geral: MSG_AGENDA.naoAgendavel } });
  });

  it('3 consultas futuras: a 4ª é recusada só depois do código certo (não revela antes)', async () => {
    const T = await consultorio();
    const ana = await novoPaciente(app.db, T.ctx);
    for (const h of ['08:00', '09:00', '10:00']) await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-20', h));
    const t = await solicitarCodigo(T.slug, pedido(em('2026-10-16', '09:00'), { email: ana.email }), deps());
    expect(t).toEqual({ pedido: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) }); // mesma resposta de qualquer e-mail
    expect(await falha(confirmarCodigo(T.slug, { pedido: t.pedido, codigo: await codigoDe(ana.email) }, deps()))).toEqual({ status: 409, erros: { geral: MSG_AGENDA.limitePublico } });
  });

  it('código: errado 5 vezes bloqueia; expirado depois de 10 min', async () => {
    const T = await consultorio();
    const e = pedido();
    const t = await solicitarCodigo(T.slug, e, deps());
    const certo = await codigoDe(e.email);
    const errado = certo === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) expect(await falha(confirmarCodigo(T.slug, { pedido: t.pedido, codigo: errado }, deps()))).toEqual({ status: 422, erros: { codigo: MSG_PUBLICO.codigoIncorreto } });
    expect(await falha(confirmarCodigo(T.slug, { pedido: t.pedido, codigo: certo }, deps()))).toEqual({ status: 410, erros: { geral: MSG_PUBLICO.codigoBloqueado } });
    const e2 = pedido(em('2026-10-16', '11:00'));
    const t2 = await solicitarCodigo(T.slug, e2, deps());
    expect(await falha(confirmarCodigo(T.slug, { pedido: t2.pedido, codigo: await codigoDe(e2.email) }, deps({ agora: new Date(agora.getTime() + 11 * 60_000) })))).toEqual({ status: 410, erros: { geral: MSG_PUBLICO.codigoExpirado } });
  });

  it('horário ocupado entre o pedido e o código: devolve outros horários; escolher outro conclui sem novo código', async () => {
    const T = await consultorio();
    const e = pedido(em('2026-10-16', '14:00'));
    const t = await solicitarCodigo(T.slug, e, deps());
    await consultaDireta(app.db, T.ctx, (await novoPaciente(app.db, T.ctx)).id, em('2026-10-16', '14:00'));
    const r = await confirmarCodigo(T.slug, { pedido: t.pedido, codigo: await codigoDe(e.email) }, deps());
    expect(r.estado).toBe('horario_ocupado');
    if (r.estado !== 'horario_ocupado') throw new Error();
    expect(r.horarios.map((h) => h.hora)).not.toContain('14:00');
    expect(await escolherOutroHorario(T.slug, { pedido: t.pedido, inicio: em('2026-10-16', '15:00').toISOString(), modalidade: 'presencial' }, deps())).toEqual({ estado: 'agendada', quando: 'sex., 16/10/2026 às 15:00 (horário de Brasília)' });
  });

  it('validação, Turnstile e limites: nada é gravado antes do Turnstile; 11ª tentativa do IP → 429; código de novo em menos de 1 min → 429', async () => {
    const T = await consultorio();
    expect(await falha(solicitarCodigo(T.slug, pedido(undefined, { nome: 'A', email: 'x', telefone: '12', maiorDeIdade: false, aceitouTermo: false }), deps()))).toEqual({
      status: 422, erros: { nome: MSG_PUBLICO.nome, email: MSG_PUBLICO.email, telefone: MSG_PUBLICO.telefone, maiorDeIdade: MSG_PUBLICO.maioridade, aceitouTermo: MSG_PUBLICO.termo },
    });
    const e = pedido();
    expect(await falha(solicitarCodigo(T.slug, e, deps({ verificarTurnstile: async () => 'invalido' })))).toEqual({ status: 403, erros: { geral: 'Confirme que você não é um robô.' } });
    expect(await falha(solicitarCodigo(T.slug, e, deps({ verificarTurnstile: async () => 'indisponivel' })))).toEqual({ status: 503, erros: { geral: 'Tente novamente em alguns minutos' } });
    expect(await withTenant(T.ctx, (tx) => tx.select().from(publicBookingRequests).where(and(eq(publicBookingRequests.email, e.email))), app.db)).toEqual([]);
    const ip = ipUnico();
    for (let i = 0; i < 10; i++) await falha(solicitarCodigo(T.slug, pedido(undefined, { nome: '' }), deps({ ip })));
    expect((await falha(solicitarCodigo(T.slug, pedido(), deps({ ip })))).status).toBe(429);
    await solicitarCodigo(T.slug, e, deps());
    expect(await falha(solicitarCodigo(T.slug, { ...e, inicio: em('2026-10-16', '10:00').toISOString() }, deps({ agora: new Date(agora.getTime() + 30_000) })))).toEqual({ status: 429, erros: { geral: MSG_PUBLICO.aguarde } });
  });

  it('página desativada ou conta suspensa → 404 sem gravar nada; horário fora das regras → 409', async () => {
    const D = await consultorio({ agendamentoPublicoAtivo: false });
    expect((await falha(solicitarCodigo(D.slug, pedido(), deps()))).status).toBe(404);
    const S = await consultorio({ status: 'suspensa' });
    expect((await falha(solicitarCodigo(S.slug, pedido(), deps()))).status).toBe(404);
    const T = await consultorio();
    expect(await falha(solicitarCodigo(T.slug, pedido(em('2026-10-16', '21:00')), deps()))).toEqual({ status: 409, erros: { inicio: MSG_AGENDA.indisponivel } });
  });
});
```

Run: `pnpm test src/modules/agenda/agendamento-publico.test.ts`
Expected: FAIL ("Failed to resolve import './agendamento-publico'").

- [ ] **Step 5: Implementar** — `src/modules/plataforma/tenant-status.ts` e `src/modules/agenda/agendamento-publico.ts`

Em `src/modules/plataforma/tenant-status.ts` (rodada 1 do `/code-review`: `tenants` não tem `tenant_id` nem RLS — só serviços de `src/modules/plataforma` a leem, CLAUDE.md regra 1; a página pública e o E2E usam esta função):

```ts
/** Plano 05 (página pública /n/<slug>, E2E): o tenant pelo endereço. Formato inválido → null sem consultar (tenants_slug_formato). */
export async function buscarTenantPorSlug(db: Db, slug: string): Promise<TenantRow | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const [row] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return row ?? null;
}
```

`src/modules/agenda/agendamento-publico.ts`:

```ts
import { createHmac, hkdfSync, randomInt, randomUUID } from 'node:crypto';
import { and, count, eq, gt, inArray, lt, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { appointments, consents, patients, publicBookingRequests, type TenantRow } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { encryptionKey, randomToken, safeEqual, sha256 } from '@/lib/crypto';
import { normalizeEmail, normalizarTexto } from '@/lib/text';
import { MSG_TURNSTILE_FORA, MSG_TURNSTILE_INVALIDO, type ResultadoTurnstile } from '@/lib/turnstile';
import { normalizarTelefone } from '@/modules/pacientes/telefone';
import { MSG_TERMO_NAO_ACEITO, TERMO_PACIENTE } from '@/modules/pacientes/termo-paciente';
import { buscarTenantPorSlug, listarTenantsParaVarredura } from '@/modules/plataforma/tenant-status';
import { escolherHorario, gravarConsultaDoPaciente, horariosParaPaciente, type HorarioEscolhido } from './agendamento-paciente';
import { MAX_CONSULTAS_FUTURAS_PUBLICO, MSG_AGENDA } from './constantes';
import { ConsultaError, ehSobreposicao } from './consultas';
import { diaDaSemana, inicioDoDia, partesNoFuso, quandoComFuso, somarDias } from './fuso';
import { horariosVisiveis, type HorarioVisivel } from './horarios';
import { chaveDoLimite, consumirLimite } from './limite-ip';

export const MSG_PUBLICO = {
  indisponivel: 'Agendamento online indisponível. Entre em contato.',
  nome: 'Informe o nome',
  email: 'Informe um e-mail válido',
  telefone: 'Telefone inválido',
  telefoneWhatsapp: 'Informe o telefone para receber lembretes por WhatsApp',
  maioridade: 'Confirme que você tem 18 anos ou mais',
  termo: MSG_TERMO_NAO_ACEITO,
  muitasTentativas: 'Muitas tentativas. Tente novamente mais tarde.',
  aguarde: 'Aguarde 1 minuto para pedir outro código.',
  codigoIncorreto: 'Código incorreto.',
  codigoExpirado: 'Código expirado. Peça um novo código.',
  codigoBloqueado: 'Muitas tentativas com código errado. Peça um novo código.',
  enviado: (email: string) => `Enviamos um código de 6 dígitos para ${email}. Ele vale por 10 minutos.`,
  agendada: (quando: string) => `Consulta marcada para ${quando}. Enviamos a confirmação para o seu e-mail.`,
} as const;

/** `status` = o HTTP que a rota devolve. */
export class PublicoError extends Error {
  override name = 'PublicoError';
  constructor(readonly status: number, readonly erros: Record<string, string>) {
    super('Agendamento público recusado');
  }
}

export type PaginaPublica =
  | { estado: 'nao_encontrada' }
  | { estado: 'suspensa' | 'desativada'; nome: string }
  | { estado: 'ativa'; nome: string; temOnline: boolean; semana: string; horarios: HorarioVisivel[] };
export type DepsPublico = { db?: Db; agora?: Date; ip: string | null; verificarTurnstile: (token: string | null) => Promise<ResultadoTurnstile>; appUrl?: string };
export type ResultadoConfirmacao = { estado: 'agendada'; quando: string } | { estado: 'horario_ocupado'; horarios: HorarioVisivel[] };

const CODIGO_VALIDADE_MS = 10 * 60_000;
const VERIFICADO_VALIDADE_MS = 30 * 60_000;
const MAX_ERROS_CODIGO = 5;
const LIMITE_IP_HORA = 10;
const LIMITE_EMAIL_HORA = 5;

let chaveCodigos: Buffer | undefined;
const hashDoCodigo = (pedidoId: string, codigo: string) =>
  createHmac('sha256', (chaveCodigos ??= Buffer.from(hkdfSync('sha256', encryptionKey(), Buffer.alloc(0), 'nutridebby:codigo-agendamento:v1', 32))))
    .update(`${pedidoId}:${codigo}`)
    .digest('base64url');

const segunda = (data: string) => somarDias(data, -((diaDaSemana(data) + 6) % 7));

async function horariosDaSemana(tenant: TenantRow, semana: string, agora: Date, db: Db): Promise<HorarioVisivel[]> {
  const hs = await horariosParaPaciente(tenant, agora, { db, de: inicioDoDia(semana, tenant.fuso), ate: inicioDoDia(somarDias(semana, 7), tenant.fuso) });
  return horariosVisiveis(hs, tenant.fuso);
}

/** US-032: o que a página pública mostra — nome da nutricionista e horários livres de uma semana (D11: só intervalos). */
export async function carregarPaginaPublica(slug: string, opts: { semana?: unknown; agora?: Date; db?: Db } = {}): Promise<PaginaPublica> {
  const db = opts.db ?? getDb();
  const agora = opts.agora ?? new Date();
  const t = await buscarTenantPorSlug(db, slug);
  if (!t) return { estado: 'nao_encontrada' };
  if (t.status !== 'ativa') return { estado: 'suspensa', nome: t.nomeExibicao }; // RN-15
  if (!t.agendamentoPublicoAtivo) return { estado: 'desativada', nome: t.nomeExibicao };
  const hoje = partesNoFuso(agora, t.fuso).data;
  const pedida = typeof opts.semana === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.semana) && opts.semana >= hoje ? opts.semana : hoje;
  const semana = segunda(pedida);
  return { estado: 'ativa', nome: t.nomeExibicao, temOnline: !!t.linkOnlinePadrao, semana, horarios: await horariosDaSemana(t, semana, agora, db) };
}

type Pedido = { nome: string; email: string; telefone: string | null; whatsapp: boolean };

function validarPedido(input: Record<string, unknown>): Pedido {
  const erros: Record<string, string> = {};
  const nome = normalizarTexto(input.nome);
  if (nome.length < 2 || nome.length > 120) erros.nome = MSG_PUBLICO.nome;
  const email = typeof input.email === 'string' ? normalizeEmail(input.email) : '';
  if (email.length > 254 || !z.email().safeParse(email).success) erros.email = MSG_PUBLICO.email;
  const telTxt = typeof input.telefone === 'string' ? input.telefone.trim() : '';
  const telefone = telTxt ? normalizarTelefone(telTxt) : null;
  if (telTxt && !telefone) erros.telefone = MSG_PUBLICO.telefone;
  const whatsapp = input.whatsapp === true;
  if (whatsapp && !telefone && !erros.telefone) erros.telefone = MSG_PUBLICO.telefoneWhatsapp;
  if (input.maiorDeIdade !== true) erros.maiorDeIdade = MSG_PUBLICO.maioridade; // RN-17
  if (input.aceitouTermo !== true) erros.aceitouTermo = MSG_PUBLICO.termo;
  if (Object.keys(erros).length) throw new PublicoError(422, erros);
  return { nome, email, telefone, whatsapp };
}

async function abrir(slug: string, deps: DepsPublico): Promise<{ db: Db; agora: Date; tenant: TenantRow }> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  // RN-16: 10 tentativas por IP por hora (o contador é a única escrita antes do Turnstile; D12)
  if (!(await consumirLimite(db, chaveDoLimite('ip', deps.ip ?? 'desconhecido'), LIMITE_IP_HORA, 3600, agora))) throw new PublicoError(429, { geral: MSG_PUBLICO.muitasTentativas });
  const tenant = await buscarTenantPorSlug(db, slug);
  if (!tenant || tenant.status !== 'ativa' || !tenant.agendamentoPublicoAtivo) throw new PublicoError(404, { geral: MSG_PUBLICO.indisponivel });
  return { db, agora, tenant };
}

/**
 * RN-16 passo 1: valida, confere o Turnstile (antes de qualquer escrita de negócio), confere o horário e manda o
 * código de 6 dígitos (10 min). A resposta é a mesma para e-mail cadastrado ou não (D12).
 */
export async function solicitarCodigo(slug: string, input: Record<string, unknown>, deps: DepsPublico): Promise<{ pedido: string }> {
  const { db, agora, tenant } = await abrir(slug, deps);
  const v = validarPedido(input);
  const t = await deps.verificarTurnstile(typeof input.turnstileToken === 'string' ? input.turnstileToken : null);
  if (t === 'indisponivel') throw new PublicoError(503, { geral: MSG_TURNSTILE_FORA });
  if (t !== 'ok') throw new PublicoError(403, { geral: MSG_TURNSTILE_INVALIDO });
  try {
    await escolherHorario(tenant, input.inicio, input.modalidade, agora, { db });
  } catch (e) {
    if (e instanceof ConsultaError) throw new PublicoError(409, { inicio: MSG_AGENDA.indisponivel });
    throw e;
  }
  if (!(await consumirLimite(db, chaveDoLimite('email-hora', `${tenant.id}:${v.email}`), LIMITE_EMAIL_HORA, 3600, agora))) throw new PublicoError(429, { geral: MSG_PUBLICO.muitasTentativas });
  const pedido = randomToken();
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const id = randomUUID();
  await withTenant(
    { tenantId: tenant.id, role: 'publico', ip: deps.ip },
    async (tx) => {
      const [u] = await tx.select({ em: max(publicBookingRequests.createdAt) }).from(publicBookingRequests).where(eq(publicBookingRequests.email, v.email));
      if (u?.em && agora.getTime() - u.em.getTime() < 60_000) throw new PublicoError(429, { geral: MSG_PUBLICO.aguarde });
      await tx.insert(publicBookingRequests).values({
        id,
        tenantId: tenant.id,
        tokenHash: sha256(pedido),
        codigoHash: hashDoCodigo(id, codigo),
        email: v.email,
        nome: v.nome,
        telefoneE164: v.telefone,
        whatsappOptin: v.whatsapp,
        inicio: new Date(String(input.inicio)),
        modalidade: String(input.modalidade),
        termoVersao: TERMO_PACIENTE,
        ip: deps.ip,
        expiraEm: new Date(agora.getTime() + CODIGO_VALIDADE_MS),
        createdAt: agora,
      });
      await enqueueEmail({ tipo: 'codigo_agendamento', para: v.email, nutri: tenant.nomeExibicao, codigo }, { tenantId: tenant.id, tx });
    },
    db,
  );
  return { pedido };
}

type PedidoRow = typeof publicBookingRequests.$inferSelect;

/**
 * Cria (ou reaproveita, se o e-mail já é de paciente ativo — ele provou o e-mail) o paciente, marca a consulta e
 * grava o aceite do termo (D13). O limite de 3 consultas futuras é conferido aqui, depois do código (D12).
 */
async function concluir(tenant: TenantRow, r: PedidoRow, escolha: { inicio: unknown; modalidade: unknown }, deps: DepsPublico, db: Db, agora: Date): Promise<ResultadoConfirmacao> {
  const outros = async (ref: unknown) => {
    const data = typeof ref === 'string' && Number.isFinite(Date.parse(ref)) ? partesNoFuso(new Date(ref), tenant.fuso).data : partesNoFuso(agora, tenant.fuso).data;
    return { estado: 'horario_ocupado' as const, horarios: await horariosDaSemana(tenant, segunda(data), agora, db) };
  };
  let h: HorarioEscolhido;
  try {
    h = await escolherHorario(tenant, escolha.inicio, escolha.modalidade, agora, { db });
  } catch (e) {
    if (e instanceof ConsultaError) return outros(escolha.inicio);
    throw e;
  }
  try {
    return await withTenant(
      { tenantId: tenant.id, role: 'publico', ip: deps.ip },
      async (tx) => {
        // um agendamento por e-mail por vez no tenant (a contagem das 3 consultas futuras não pode correr)
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('agenda-publico'), hashtext(${`${tenant.id}:${r.email}`}))`);
        const [atual] = await tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.id, r.id)).for('update');
        if (!atual || atual.concluidoEm) throw new PublicoError(410, { geral: MSG_PUBLICO.codigoExpirado });
        let [p] = await tx.select().from(patients).where(eq(patients.email, r.email));
        if (p && p.status !== 'ativo') throw new PublicoError(409, { geral: MSG_AGENDA.naoAgendavel });
        const novo = !p;
        if (!p) {
          const optin = r.whatsappOptin && r.telefoneE164 ? { whatsappOptinEm: agora, whatsappOptinOrigem: 'paciente' } : {};
          [p] = await tx
            .insert(patients)
            .values({ tenantId: tenant.id, nome: r.nome, email: r.email, telefoneE164: r.telefoneE164, origem: 'agendamento_publico', ...optin, createdAt: agora, updatedAt: agora })
            .returning();
        }
        const [{ n }] = await tx
          .select({ n: count() })
          .from(appointments)
          .where(and(eq(appointments.patientId, p.id), inArray(appointments.status, ['agendada', 'confirmada']), gt(appointments.inicio, agora)));
        if (n >= MAX_CONSULTAS_FUTURAS_PUBLICO) throw new PublicoError(409, { geral: MSG_AGENDA.limitePublico });
        const id = await gravarConsultaDoPaciente(tx, tenant, p, h, { agora, appUrl: deps.appUrl ?? getEnv().APP_URL, evento: novo ? 'novo_paciente_publico' : 'marcada' });
        await tx.insert(consents).values({ patientId: p.id, tenantId: tenant.id, termoVersao: r.termoVersao, aceitoEm: agora, ip: r.ip }).onConflictDoNothing();
        await tx.update(publicBookingRequests).set({ concluidoEm: agora, appointmentId: id }).where(eq(publicBookingRequests.id, r.id));
        return { estado: 'agendada' as const, quando: quandoComFuso(h.inicio, tenant.fuso) };
      },
      db,
    );
  } catch (e) {
    if (ehSobreposicao(e)) return outros(escolha.inicio); // RN-03: ocupado entre a checagem e a gravação
    throw e;
  }
}

/** RN-16 passo 2: o código certo marca o pedido como verificado (30 min para escolher outro horário, se preciso) e conclui. */
export async function confirmarCodigo(slug: string, input: Record<string, unknown>, deps: DepsPublico): Promise<ResultadoConfirmacao> {
  const { db, agora, tenant } = await abrir(slug, deps);
  const r = await withTenant(
    { tenantId: tenant.id, role: 'publico', ip: deps.ip },
    async (tx) => {
      const [p] = await tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.tokenHash, sha256(String(input.pedido ?? '')))).for('update');
      if (!p || p.concluidoEm) return { erro: new PublicoError(410, { geral: MSG_PUBLICO.codigoExpirado }) };
      if (p.verificadoEm) return { pedido: p };
      if (p.tentativas >= MAX_ERROS_CODIGO) return { erro: new PublicoError(410, { geral: MSG_PUBLICO.codigoBloqueado }) };
      if (p.expiraEm.getTime() <= agora.getTime()) return { erro: new PublicoError(410, { geral: MSG_PUBLICO.codigoExpirado }) };
      const codigo = String(input.codigo ?? '').replace(/\D/g, '');
      if (!safeEqual(hashDoCodigo(p.id, codigo), p.codigoHash)) {
        await tx.update(publicBookingRequests).set({ tentativas: p.tentativas + 1 }).where(eq(publicBookingRequests.id, p.id)); // grava o erro antes de responder
        return { erro: new PublicoError(422, { codigo: MSG_PUBLICO.codigoIncorreto }) };
      }
      const [v] = await tx.update(publicBookingRequests).set({ verificadoEm: agora }).where(eq(publicBookingRequests.id, p.id)).returning();
      return { pedido: v };
    },
    db,
  );
  if ('erro' in r) throw r.erro;
  return concluir(tenant, r.pedido, { inicio: r.pedido.inicio.toISOString(), modalidade: r.pedido.modalidade }, deps, db, agora);
}

/** Depois de "horário ocupado": o pedido já verificado escolhe outro horário sem novo código (até 30 min). */
export async function escolherOutroHorario(slug: string, input: Record<string, unknown>, deps: DepsPublico): Promise<ResultadoConfirmacao> {
  const { db, agora, tenant } = await abrir(slug, deps);
  const [p] = await withTenant({ tenantId: tenant.id, role: 'publico' }, (tx) => tx.select().from(publicBookingRequests).where(eq(publicBookingRequests.tokenHash, sha256(String(input.pedido ?? '')))), db);
  if (!p || !p.verificadoEm || p.concluidoEm || agora.getTime() - p.verificadoEm.getTime() > VERIFICADO_VALIDADE_MS) throw new PublicoError(410, { geral: MSG_PUBLICO.codigoExpirado });
  return concluir(tenant, p, { inicio: input.inicio, modalidade: input.modalidade }, deps, db, agora);
}

/** Diário (agenda-limpeza): pedidos com mais de 24 h somem (LGPD: minimização). */
export async function limparPedidosPublicos(db: Db, agora: Date): Promise<number> {
  let n = 0;
  for (const t of await listarTenantsParaVarredura(db)) {
    const r = await withTenant({ tenantId: t.id, role: 'worker' }, (tx) => tx.delete(publicBookingRequests).where(lt(publicBookingRequests.createdAt, new Date(agora.getTime() - 86_400_000))).returning({ id: publicBookingRequests.id }), db);
    n += r.length;
  }
  return n;
}
```

Run: `pnpm test src/modules/agenda/agendamento-publico.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 6: Rotas** — `src/app/api/n/[slug]/resposta.ts`

```ts
import { getEnv } from '@/env';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { clientIp } from '@/lib/ip';
import { logger } from '@/lib/logger';
import { verifyTurnstile } from '@/lib/turnstile';
import { PublicoError, type DepsPublico } from '@/modules/agenda/agendamento-publico';

export const SEM_CACHE = { 'cache-control': 'no-store' };

/** JSON de até 8 KB; corpo inválido vira PublicoError (400/413). */
export async function lerJson(req: Request): Promise<Record<string, unknown>> {
  let bruto: Buffer;
  try {
    bruto = await lerCorpoLimitado(req, 8 * 1024);
  } catch (e) {
    if (e instanceof CorpoGrandeError) throw new PublicoError(413, { geral: 'Pedido grande demais.' });
    throw e;
  }
  try {
    const v = JSON.parse(bruto.toString('utf8'));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // cai no 400 abaixo
  }
  throw new PublicoError(400, { geral: 'Pedido inválido.' });
}

export function depsDaRequisicao(req: Request): DepsPublico {
  const env = getEnv();
  const ip = clientIp(req.headers, env.TRUSTED_PROXIES);
  return {
    ip,
    appUrl: env.APP_URL,
    verificarTurnstile: (token) =>
      verifyTurnstile(token, {
        secret: env.TURNSTILE_SECRET_KEY,
        ip,
        hostname: new URL(env.APP_URL).hostname,
        // só motivo/status/códigos: nunca token, segredo, IP ou e-mail (CLAUDE.md regra 3)
        onFalha: ({ motivo, status, codigos }) => logger.warn({ motivo, status, codigos }, 'Turnstile indisponível'),
      }),
  };
}

export function comoResposta(e: unknown): Response {
  if (e instanceof PublicoError) {
    const erros = e.erros;
    const corpo = Object.keys(erros).length === 1 && erros.geral ? { erro: erros.geral } : { erros };
    return Response.json(corpo, { status: e.status, headers: SEM_CACHE });
  }
  throw e;
}
```

`src/app/api/n/[slug]/codigo/route.ts`:

```ts
import { solicitarCodigo } from '@/modules/agenda/agendamento-publico';
import { comoResposta, depsDaRequisicao, lerJson, SEM_CACHE } from '../resposta';

export const dynamic = 'force-dynamic';

/** RN-16 passo 1 (página pública, sem sessão). */
export async function POST(req: Request, { params }: RouteContext<'/api/n/[slug]/codigo'>) {
  try {
    const r = await solicitarCodigo((await params).slug, await lerJson(req), depsDaRequisicao(req));
    return Response.json(r, { headers: SEM_CACHE });
  } catch (e) {
    return comoResposta(e);
  }
}
```

`src/app/api/n/[slug]/confirmar/route.ts`:

```ts
import { confirmarCodigo } from '@/modules/agenda/agendamento-publico';
import { comoResposta, depsDaRequisicao, lerJson, SEM_CACHE } from '../resposta';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: RouteContext<'/api/n/[slug]/confirmar'>) {
  try {
    return Response.json(await confirmarCodigo((await params).slug, await lerJson(req), depsDaRequisicao(req)), { headers: SEM_CACHE });
  } catch (e) {
    return comoResposta(e);
  }
}
```

`src/app/api/n/[slug]/horario/route.ts`:

```ts
import { escolherOutroHorario } from '@/modules/agenda/agendamento-publico';
import { comoResposta, depsDaRequisicao, lerJson, SEM_CACHE } from '../resposta';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: RouteContext<'/api/n/[slug]/horario'>) {
  try {
    return Response.json(await escolherOutroHorario((await params).slug, await lerJson(req), depsDaRequisicao(req)), { headers: SEM_CACHE });
  } catch (e) {
    return comoResposta(e);
  }
}
```

`src/app/api/n/[slug]/codigo/route.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { novoTenant } from '../../../../../../test/pacientes';
import { POST } from './route';

const db = getDb();
afterAll(async () => {
  await stopBoss();
  await closeDb();
});

const pedir = (slug: string, corpo: string, ip: string) =>
  POST(new Request(`http://localhost:3000/api/n/${slug}/codigo`, { method: 'POST', body: corpo, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } }), { params: Promise.resolve({ slug }) });

describe('POST /api/n/[slug]/codigo (RN-16)', () => {
  it('404 sem conta; 400 JSON inválido; 413 corpo grande; 422 campos; sem cache', async () => {
    const T = await novoTenant(db);
    const [{ slug }] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, T.tenantId));
    expect((await pedir('nao-existe-xyz', '{}', '203.0.113.71')).status).toBe(404);
    expect((await pedir(slug, '{x', '203.0.113.72')).status).toBe(400);
    expect((await pedir(slug, JSON.stringify({ nome: 'x'.repeat(9000) }), '203.0.113.73')).status).toBe(413);
    const r = await pedir(slug, JSON.stringify({ nome: 'A' }), '203.0.113.74');
    expect(r.status).toBe(422);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await r.json()).erros.nome).toBe('Informe o nome');
  });

  it('HTTP 429 a partir da 11ª tentativa na hora pelo mesmo IP', async () => {
    const T = await novoTenant(db);
    const [{ slug }] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, T.tenantId));
    const ip = `203.0.113.${100 + Math.floor(Math.random() * 100)}`;
    for (let i = 0; i < 10; i++) expect((await pedir(slug, '{}', ip)).status).toBe(422);
    const r = await pedir(slug, '{}', ip);
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ erro: 'Muitas tentativas. Tente novamente mais tarde.' });
  });
});
```

(Com `TRUSTED_PROXIES` vazio, `clientIp` aceita um único IP em `X-Forwarded-For` — `@better-auth/core/utils/ip` —, então cada teste usa o próprio balde.)

Run: `pnpm test src/app/api/n`
Expected: PASS.

- [ ] **Step 7: Página `/n/[slug]`**

`src/app/n/[slug]/page.tsx`:

```tsx
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEnv } from '@/env';
import { carregarPaginaPublica, MSG_PUBLICO } from '@/modules/agenda/agendamento-publico';
import { MSG_AGENDA } from '@/modules/agenda/constantes';
import { somarDias } from '@/modules/agenda/fuso';
import { formatarData } from '@/modules/pacientes/datas';
import { TERMO_PACIENTE_PARAGRAFOS, TERMO_PACIENTE_ROTULO, TERMO_PACIENTE_TITULO } from '@/modules/pacientes/termo-paciente';
import { AgendarForm } from './agendar-form';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Agendar consulta' };

export default async function PaginaPublica({ params, searchParams }: PageProps<'/n/[slug]'>) {
  const { slug } = await params;
  const sp = await searchParams;
  const p = await carregarPaginaPublica(slug, { semana: sp.semana });
  if (p.estado === 'nao_encontrada') notFound();
  if (p.estado === 'suspensa') return <main className="mx-auto max-w-lg p-6"><p role="alert">{MSG_AGENDA.contaIndisponivel}</p></main>;
  if (p.estado === 'desativada') {
    return (
      <main className="mx-auto max-w-lg space-y-3 p-6">
        <h1 className="text-2xl font-semibold">{p.nome}</h1>
        <p role="status">{MSG_PUBLICO.indisponivel}</p>
      </main>
    );
  }
  const modalidade = sp.modalidade === 'online' && p.temOnline ? 'online' : 'presencial';
  const href = (semana: string, m = modalidade) => `/n/${slug}?semana=${semana}&modalidade=${m}`;
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{`Agendar consulta com ${p.nome}`}</h1>
      {p.temOnline && (
        <nav aria-label="Escolha a modalidade" className="flex gap-3 text-sm">
          {(['presencial', 'online'] as const).map((m) => (
            <Link key={m} href={href(p.semana, m)} aria-current={m === modalidade ? 'page' : undefined} className={m === modalidade ? 'font-semibold' : 'underline'}>
              {m === 'presencial' ? 'Presencial' : 'Online'}
            </Link>
          ))}
        </nav>
      )}
      <nav aria-label="Semana" className="flex gap-3 text-sm">
        <Link href={href(somarDias(p.semana, -7))} className="underline">Semana anterior</Link>
        <span>{`${formatarData(p.semana)} a ${formatarData(somarDias(p.semana, 6))}`}</span>
        <Link href={href(somarDias(p.semana, 7))} className="underline">Próxima semana</Link>
      </nav>
      <AgendarForm
        slug={slug}
        siteKey={getEnv().TURNSTILE_SITE_KEY}
        modalidade={modalidade}
        horarios={p.horarios}
        termo={{ titulo: TERMO_PACIENTE_TITULO, paragrafos: [...TERMO_PACIENTE_PARAGRAFOS], rotulo: TERMO_PACIENTE_ROTULO }}
      />
    </main>
  );
}
```

`src/app/n/[slug]/agendar-form.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { SeletorHorarios } from '@/components/seletor-horarios';
import { TurnstileWidget } from '@/components/turnstile-widget';
import type { HorarioVisivel, Modalidade } from '@/modules/agenda/horarios';
import { MSG_TURNSTILE_FORA, MSG_TURNSTILE_INVALIDO } from '@/lib/turnstile';

type Props = { slug: string; siteKey: string; modalidade: Modalidade; horarios: HorarioVisivel[]; termo: { titulo: string; paragrafos: string[]; rotulo: string } };
type Resposta = { erro?: string; erros?: Record<string, string>; pedido?: string; estado?: 'agendada' | 'horario_ocupado'; quando?: string; horarios?: HorarioVisivel[] };

async function enviar(url: string, corpo: unknown): Promise<{ status: number; r: Resposta }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
    return { status: res.status, r: (await res.json().catch(() => ({}))) as Resposta };
  } catch {
    return { status: 0, r: { erro: MSG_TURNSTILE_FORA } };
  }
}

export function AgendarForm({ slug, siteKey, modalidade, horarios, termo }: Props) {
  const [etapa, setEtapa] = useState<'dados' | 'codigo' | 'outro' | 'pronto'>('dados');
  const [token, setToken] = useState<string | null>(null);
  const [widget, setWidget] = useState(0);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [pedido, setPedido] = useState('');
  const [email, setEmail] = useState('');
  const [outros, setOutros] = useState<HorarioVisivel[]>([]);
  const [quando, setQuando] = useState('');
  const [enviando, setEnviando] = useState(false);
  const aria = (k: string) => (erros[k] ? { 'aria-invalid': true as const, 'aria-describedby': `${k}-erro` } : {});
  const msg = (k: string) => erros[k] && <p id={`${k}-erro`} role="alert" className="text-sm text-red-700">{erros[k]}</p>;

  function tratar(status: number, r: Resposta) {
    setErros(r.erros ?? {});
    setErro(r.erro ?? '');
    if (status === 200 && r.estado === 'agendada') {
      setQuando(r.quando!);
      setEtapa('pronto');
    } else if (status === 200 && r.estado === 'horario_ocupado') {
      setOutros(r.horarios ?? []);
      setErro('Esse horário acabou de ser ocupado. Escolha outro.');
      setEtapa('outro');
    } else if (status === 410) setEtapa('dados');
    if (status === 403 || status === 503 || status === 0) {
      setToken(null);
      setWidget((n) => n + 1); // o token do Turnstile é de uso único
    }
  }

  async function pedirCodigo(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return setErro(MSG_TURNSTILE_INVALIDO);
    const f = new FormData(e.currentTarget);
    setEnviando(true);
    const corpo = {
      nome: f.get('nome'), email: f.get('email'), telefone: f.get('telefone'), whatsapp: f.get('whatsapp') === 'on',
      maiorDeIdade: f.get('maiorDeIdade') === 'on', aceitouTermo: f.get('aceitouTermo') === 'on', inicio: f.get('inicio'), modalidade, turnstileToken: token,
    };
    const { status, r } = await enviar(`/api/n/${slug}/codigo`, corpo);
    setEnviando(false);
    if (status === 200 && r.pedido) {
      setPedido(r.pedido);
      setEmail(String(corpo.email));
      setErros({});
      setErro('');
      setEtapa('codigo');
      return;
    }
    tratar(status, r);
    // 422: os campos são conferidos antes do Turnstile, então o token não foi gasto; nos outros casos, foi (uso único)
    if (status !== 422) {
      setToken(null);
      setWidget((n) => n + 1);
    }
  }

  async function confirmar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const { status, r } = await enviar(`/api/n/${slug}/confirmar`, { pedido, codigo: new FormData(e.currentTarget).get('codigo') });
    setEnviando(false);
    tratar(status, r);
  }

  async function escolherOutro(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setEnviando(true);
    const { status, r } = await enviar(`/api/n/${slug}/horario`, { pedido, inicio: new FormData(e.currentTarget).get('inicio'), modalidade });
    setEnviando(false);
    tratar(status, r);
  }

  if (etapa === 'pronto') return <p role="status" className="rounded bg-emerald-50 p-3">{`Consulta marcada para ${quando}. Enviamos a confirmação para o seu e-mail.`}</p>;
  if (etapa === 'codigo') {
    return (
      <form onSubmit={confirmar} className="max-w-sm space-y-3">
        <p role="status">{`Enviamos um código de 6 dígitos para ${email}. Ele vale por 10 minutos.`}</p>
        <label htmlFor="codigo" className="block font-medium">Código</label>
        <input id="codigo" name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="w-full rounded border p-2" {...aria('codigo')} />
        {msg('codigo')}
        {erro && <p role="alert" className="text-red-700">{erro}</p>}
        <button disabled={enviando} className="rounded bg-emerald-700 px-4 py-2 text-white">Confirmar agendamento</button>
      </form>
    );
  }
  if (etapa === 'outro') {
    return (
      <form onSubmit={escolherOutro} className="space-y-3">
        {erro && <p role="alert" className="text-red-700">{erro}</p>}
        <p className="font-medium">Escolha um horário</p>
        <SeletorHorarios horarios={outros} modalidade={modalidade} erro={erros.inicio} />
        <button disabled={enviando} className="rounded bg-emerald-700 px-4 py-2 text-white">Confirmar agendamento</button>
      </form>
    );
  }
  return (
    <form onSubmit={pedirCodigo} className="space-y-4">
      <section aria-labelledby="horario" className="space-y-2">
        <h2 id="horario" className="text-lg font-semibold">Escolha o horário</h2>
        <SeletorHorarios horarios={horarios} modalidade={modalidade} erro={erros.inicio} />
      </section>
      <section aria-labelledby="dados" className="max-w-md space-y-3">
        <h2 id="dados" className="text-lg font-semibold">Seus dados</h2>
        {(
          [
            ['nome', 'Nome', 'text', 'name'],
            ['email', 'E-mail', 'email', 'email'],
            ['telefone', 'Telefone (opcional)', 'tel', 'tel'],
          ] as const
        ).map(([id, rotulo, type, auto]) => (
          <div key={id} className="space-y-1">
            <label htmlFor={id} className="block font-medium">{rotulo}</label>
            <input id={id} name={id} type={type} autoComplete={auto} required={id !== 'telefone'} className="w-full rounded border p-2" {...aria(id)} />
            {msg(id)}
          </div>
        ))}
        <div className="flex items-start gap-2">
          <input id="whatsapp" name="whatsapp" type="checkbox" className="mt-1" />
          <label htmlFor="whatsapp">Quero receber lembretes por WhatsApp</label>
        </div>
        <div className="flex items-start gap-2">
          <input id="maiorDeIdade" name="maiorDeIdade" type="checkbox" className="mt-1" {...aria('maiorDeIdade')} />
          <label htmlFor="maiorDeIdade">Tenho 18 anos ou mais</label>
        </div>
        {msg('maiorDeIdade')}
        <section aria-labelledby="termo-titulo" tabIndex={0} className="max-h-48 space-y-2 overflow-y-auto rounded border p-3 text-sm">
          <h3 id="termo-titulo" className="font-semibold">{termo.titulo}</h3>
          {termo.paragrafos.map((p) => <p key={p}>{p}</p>)}
        </section>
        <div className="flex items-start gap-2">
          <input id="aceitouTermo" name="aceitouTermo" type="checkbox" className="mt-1" {...aria('aceitouTermo')} />
          <label htmlFor="aceitouTermo">{termo.rotulo}</label>
        </div>
        {msg('aceitouTermo')}
        <TurnstileWidget key={widget} siteKey={siteKey} onToken={setToken} onIndisponivel={() => setErro(MSG_TURNSTILE_FORA)} />
        {erro && <p role="alert" className="text-red-700">{erro}</p>}
        <button disabled={enviando || !token} className="rounded bg-emerald-700 px-4 py-2 text-white">Enviar código</button>
      </section>
    </form>
  );
}
```

- [ ] **Step 8: Limpeza diária**

`src/jobs/queues.ts`: `// RN-16 / LGPD: pedidos da página pública com mais de 24 h e contadores velhos` + `'agenda-limpeza': { retryLimit: 2, retryDelay: 600, expireInSeconds: 300 },`.

`src/worker/index.ts` (imports `limparPedidosPublicos` e `limparLimites`):

```ts
  await boss.schedule('agenda-limpeza', '30 4 * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('agenda-limpeza', async () => {
    const pedidos = await limparPedidosPublicos(getDb(), new Date());
    const limites = await limparLimites(getDb(), new Date());
    logger.info({ pedidos, limites }, 'limpeza da agenda pública');
  });
```

- [ ] **Step 9: E2E** — acrescentar a `e2e/agenda.spec.ts`

```ts
test('página pública: horário, Turnstile, código por e-mail e "Novo paciente via agendamento online" (US-032, RN-16)', async ({ browser }) => {
  const visitante = await (await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.7.50' } })).newPage();
  const email = `pub-${sufixo}@ex.com`;
  const quarta = somar(SEGUNDA_LIVRE, 2);
  await visitante.goto(`/n/e2e-consultorio?semana=${quarta}`);
  await expect(visitante.getByRole('heading', { name: 'Agendar consulta com Consultório E2E' })).toBeVisible();
  await visitante.getByRole('group', { name: `qua., ${br(quarta).slice(0, 5)}` }).getByRole('radio', { name: '16:00' }).check();
  await visitante.getByLabel('Nome').fill(`Eva Publica ${sufixo}`);
  await visitante.getByLabel('E-mail').fill(email);
  // Turnstile com a site key de teste da Cloudflare (sempre passa): espera o token chegar
  await expect(visitante.getByRole('button', { name: 'Enviar código' })).toBeEnabled({ timeout: 20_000 });
  await visitante.getByRole('button', { name: 'Enviar código' }).click();
  await expect(visitante.getByText('Confirme que você tem 18 anos ou mais')).toBeVisible();
  await visitante.getByLabel('Tenho 18 anos ou mais').check();
  await visitante.getByLabel(/^Li e aceito o Termo de Uso e Privacidade/).check();
  await visitante.getByRole('button', { name: 'Enviar código' }).click();
  await expect(visitante.getByText(`Enviamos um código de 6 dígitos para ${email}. Ele vale por 10 minutos.`)).toBeVisible();
  const m = await esperarEmail(email, { assunto: undefined });
  const codigo = /\b(\d{6})\b/.exec(m.assunto)![1];
  await visitante.getByLabel('Código').fill(codigo);
  await visitante.getByRole('button', { name: 'Confirmar agendamento' }).click();
  await expect(visitante.getByText(`Consulta marcada para qua., ${br(quarta)} às 16:00 (horário de Brasília). Enviamos a confirmação para o seu e-mail.`)).toBeVisible();
  await nutri.goto(`/painel/agenda?visao=dia&data=${quarta}`);
  await expect(nutri.getByText('Novo paciente via agendamento online')).toBeVisible();
  await expect(nutri.getByText('Completar cadastro')).toBeVisible();
  await visitante.context().close();
});
```

(O E2E usa a chave de teste do Turnstile, que sempre passa — Plano 02.)

Run: `pnpm e2e:seed && pnpm test:e2e e2e/agenda.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 10: Commit**

```bash
git add src/db/schema drizzle/0054_agendamento_publico.sql drizzle/0055_rls_agendamento_publico.sql drizzle/meta src/db/rls-guard.ts src/db/audit-guard.ts test/isolamento.test.ts src/modules/agenda src/modules/plataforma/tenant-status.ts src/email src/jobs/queues.ts src/worker/index.ts src/app/api/n src/app/n CLAUDE.md scripts/e2e-seed.ts e2e/agenda.spec.ts
git commit -m "feat(agenda): página pública de agendamento com Turnstile, código por e-mail e limites (US-032, RN-16)"
```

---
### Task 9: WhatsApp pela Evolution API — provedor, sandbox, variáveis, conexão por QR code no painel (P05-07a)

**Files:**
- Create: `drizzle/0056_whatsapp_conexoes.sql` (gerada), `drizzle/0057_rls_whatsapp_conexoes.sql` (custom), `src/modules/notificacoes/whatsapp/provedor.ts`, `src/modules/notificacoes/whatsapp/evolution.ts`, `src/modules/notificacoes/whatsapp/evolution.test.ts`, `src/modules/notificacoes/whatsapp/sandbox.ts`, `src/modules/notificacoes/whatsapp/sandbox.test.ts`, `src/modules/notificacoes/whatsapp/ambiente.ts`, `src/modules/notificacoes/whatsapp/jwt.ts`, `src/modules/notificacoes/whatsapp/jwt.test.ts`, `src/modules/notificacoes/whatsapp/conexao.ts`, `src/modules/notificacoes/whatsapp/conexao.test.ts`, `src/app/api/painel/whatsapp/estado/route.ts`, `src/app/api/painel/whatsapp/estado/route.test.ts`, `src/app/painel/whatsapp/page.tsx`, `src/app/painel/whatsapp/actions.ts`, `src/app/painel/whatsapp/conectar.tsx`, `test/whatsapp.ts`
- Modify: `src/db/schema/agenda.ts`, `src/db/rls-guard.ts` (`STAFF_ONLY`), `test/isolamento.test.ts`, `src/env.ts`, `src/env.test.ts`, `.env.example`, `.github/workflows/ci.yml`, `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/app/painel/cabecalho.tsx`, `src/app/painel/page.tsx`, `scripts/e2e-seed.ts`, `e2e/agenda.spec.ts`

**Interfaces:**
- Consumes: `avisarNutri` (Tarefa 6); `idValido`; `urlDoApp`; `mailpitTransport` (`@/email/transport`); `QRCode` (`qrcode`); `requireApiNutri`, `requireNutri`; `formatarTelefone` (`@/modules/pacientes/telefone`); `getEnv`.
- Produces:
  - Schema: `whatsappConexoes` 🔒 staff_only (`tenant_id` UNIQUE, `instancia = 'nd-' || tenant_id`), `type WhatsappConexaoRow`.
  - `@/modules/notificacoes/whatsapp/provedor`: `type EnvioTexto = { instancia: string; numero: string; texto: string }` (`numero` só dígitos com DDI), `type ResultadoEnvio = { ok: true; id: string; jid: string } | { ok: false; definitivo: boolean; codigo: CodigoFalha }`, `type CodigoFalha = 'numero_sem_whatsapp' | 'recusado' | 'nao_autorizado' | 'instancia_inexistente' | 'indisponivel' | 'sem_resposta' | 'resposta_invalida'`, `type EstadoConexao = 'conectada' | 'conectando' | 'desconectada'`, `type Conexao = { estado: 'conectada' } | { estado: 'qr'; qr: string }`, `interface ProvedorWhatsapp { nome; enviarTexto; conectar; estado; desconectar }`, `class WhatsappIndisponivelError`, `digitosDoE164(e164): string`, `digitosDoJid(jid): string`, `e164DoJid(jid): string | null`.
  - `@/modules/notificacoes/whatsapp/jwt`: `chaveDoWebhook(segredo: string, instancia: string): string` (D4 (a): o `jwt_key` de cada instância, HKDF do segredo-mestre; a Tarefa 12 acrescenta `verificarJwtWebhook` e `assinarJwtWebhook`).
  - `@/modules/notificacoes/whatsapp/evolution`: `evolutionProvedor(o: { url; apiKey; webhookUrl; webhookSecret?; fetchImpl?; timeoutMs? }): ProvedorWhatsapp` (o webhook de cada instância leva `jwt_key: chaveDoWebhook(webhookSecret, instância)`), `EVENTOS_WEBHOOK`.
  - `@/modules/notificacoes/whatsapp/sandbox`: `sandboxProvedor(o: { mailpitUrl?; from?; fetchImpl? }): ProvedorWhatsapp`.
  - `@/modules/notificacoes/whatsapp/ambiente`: `type ModoWhatsapp = 'evolution' | 'sandbox' | 'desligado'`, `modoWhatsapp(e): ModoWhatsapp`, `provedorDoAmbiente(e, fetchImpl?): ProvedorWhatsapp | null`.
  - `@/modules/notificacoes/whatsapp/conexao`: `instanciaDoTenant(tenantId): string`, `tenantDaInstancia(instancia: unknown): string | null`, `type SituacaoWhatsapp = { ligado: boolean; estado: EstadoConexao; numero: string | null; desconectadaEm: Date | null; conectadaAntes: boolean }`, `lerConexao(tx): Promise<WhatsappConexaoRow | null>`, `situacaoDoWhatsapp(ctx, ligado: boolean, db?)`, `conectarWhatsapp(ctx, provedor, deps?): Promise<Conexao>`, `sincronizarEstado(ctx, provedor, deps?): Promise<SituacaoWhatsapp>`, `desconectarWhatsapp(ctx, provedor, deps?)`, `atualizarEstadoConexao(tenantId, novo: { estado: EstadoConexao; numero?: string | null }, deps: { db?; agora?; appUrl? }): Promise<void>`, `provedorDoApp(): ProvedorWhatsapp | null`.
  - Variáveis: app `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET` (as três juntas ou nenhuma — com `WHATSAPP_SANDBOX=1` fora de produção, só o segredo basta), `EVOLUTION_WEBHOOK_URL` (opcional em dev; em produção obrigatória e interna), `EVOLUTION_WEBHOOK_URL_PUBLICA` (`1` = aceitar URL pública, opção explícita do runbook), `WHATSAPP_SANDBOX`; worker `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` (juntas ou nenhuma), `WHATSAPP_SANDBOX`.
  - `GET /api/painel/whatsapp/estado` → `{ estado, numero }`; página `/painel/whatsapp`.
  - `EmailMessage` ganha `{ tipo: 'whatsapp_desconectado'; para; link }`.
  - `test/whatsapp.ts`: `whatsappFalso(opts?)`, `conexaoDeTeste(db, ctx, estado?)` (o `e2e/whatsapp.ts` com o webhook assinado nasce na Tarefa 12).

- [ ] **Step 1: Tabela** — acrescentar a `src/db/schema/agenda.ts`

```ts
/**
 * D2: uma instância da Evolution por tenant (`nd-<tenantId>`). Estado vindo do webhook (connection.update) e da
 * consulta do painel. `aviso_desconexao_em`: e-mail de desconexão já mandado; `aviso_cota_mes`: 'AAAA-MM' do aviso de 80% (Tarefa 11).
 */
export const whatsappConexoes = pgTable(
  'whatsapp_conexoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().unique().references(() => tenants.id),
    instancia: text('instancia').notNull().unique(),
    estado: text('estado').notNull().default('desconectada'),
    numeroE164: text('numero_e164'),
    conectadaEm: timestamp('conectada_em', { withTimezone: true }),
    desconectadaEm: timestamp('desconectada_em', { withTimezone: true }),
    avisoDesconexaoEm: timestamp('aviso_desconexao_em', { withTimezone: true }),
    avisoCotaMes: text('aviso_cota_mes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('whatsapp_conexoes_estado_valido', sql`${t.estado} in ('conectada', 'conectando', 'desconectada')`),
    check('whatsapp_conexoes_instancia_do_tenant', sql`${t.instancia} = 'nd-' || ${t.tenantId}::text`),
    check('whatsapp_conexoes_numero_e164', sql`${t.numeroE164} is null or ${t.numeroE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
  ],
);

export type WhatsappConexaoRow = typeof whatsappConexoes.$inferSelect;
```

Run: `pnpm db:generate --name whatsapp_conexoes` e `pnpm drizzle-kit generate --custom --name rls_whatsapp_conexoes`; preencher `drizzle/0057_rls_whatsapp_conexoes.sql`:

```sql
SELECT app_enable_tenant_rls('whatsapp_conexoes');
--> statement-breakpoint
SELECT app_enable_staff_only('whatsapp_conexoes');
```

`src/db/rls-guard.ts`, `STAFF_ONLY`: `whatsapp_conexoes: 'D2: número e estado do WhatsApp do consultório — só a equipe',`.

`test/isolamento.test.ts`, `FABRICAS` (uma linha por tenant: a fábrica roda duas vezes por tenant):

```ts
  whatsapp_conexoes: (t) =>
    sql`insert into whatsapp_conexoes (tenant_id, instancia) select ${t}, ${`nd-${t}`} where not exists (select 1 from whatsapp_conexoes where tenant_id = ${t})`,
```

Em `scripts/e2e-seed.ts`: `const AGENDA_E2E = ['whatsapp_conexoes', 'public_booking_requests', 'notifications', 'appointments', 'availability_blocks', 'availability_rules'];`.

Run: `pnpm test src/db test/isolamento.test.ts` → PASS.

- [ ] **Step 2: Variáveis (testes falham)** — em `src/env.test.ts`

```ts
describe('WhatsApp pela Evolution (D1, D4)', () => {
  const evo = { EVOLUTION_API_URL: 'http://nutri_evolution:8080', EVOLUTION_API_KEY: 'k'.repeat(32), EVOLUTION_WEBHOOK_SECRET: 'w'.repeat(32) };
  const prod = { ...base, NODE_ENV: 'production', TRUSTED_PROXIES: '10.0.0.0/8', APP_URL: 'https://app.exemplo.com', TURNSTILE_SITE_KEY: '0x4AAAAAAAreal', TURNSTILE_SECRET_KEY: '0x4AAAAAAArealsecret' };
  const interna = 'http://nutridebby_app:3000/api/webhooks/whatsapp';
  it('app: as três juntas ou nenhuma; segredo com 32+ caracteres', () => {
    expect(parseEnv({ ...base, ...evo }).EVOLUTION_API_URL).toBe('http://nutri_evolution:8080');
    expect(parseEnv(base).EVOLUTION_API_URL).toBeUndefined();
    expect(() => parseEnv({ ...base, EVOLUTION_API_URL: evo.EVOLUTION_API_URL })).toThrow(/juntas/);
    expect(() => parseEnv({ ...base, ...evo, EVOLUTION_WEBHOOK_SECRET: 'curto' })).toThrow(/32 caracteres/);
  });
  it('produção (rodada 1): só uma das três → erro; o webhook só por endereço interno, a URL pública só com EVOLUTION_WEBHOOK_URL_PUBLICA=1 (D4)', () => {
    for (const so of ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_WEBHOOK_SECRET'] as const) expect(() => parseEnv({ ...prod, [so]: evo[so] }), so).toThrow(/juntas/);
    expect(parseEnv({ ...prod, ...evo, EVOLUTION_WEBHOOK_URL: interna }).EVOLUTION_WEBHOOK_URL).toBe(interna);
    expect(parseEnv({ ...prod, ...evo, EVOLUTION_WEBHOOK_URL: 'http://10.0.1.7:3000/api/webhooks/whatsapp' }).EVOLUTION_API_URL).toBe(evo.EVOLUTION_API_URL);
    expect(() => parseEnv({ ...prod, ...evo })).toThrow(/EVOLUTION_WEBHOOK_URL é obrigatória em produção/);
    const publica = 'https://app.exemplo.com/api/webhooks/whatsapp';
    expect(() => parseEnv({ ...prod, ...evo, EVOLUTION_WEBHOOK_URL: publica })).toThrow(/endereço interno/);
    expect(parseEnv({ ...prod, ...evo, EVOLUTION_WEBHOOK_URL: publica, EVOLUTION_WEBHOOK_URL_PUBLICA: '1' }).EVOLUTION_WEBHOOK_URL_PUBLICA).toBe('1');
  });
  it('sandbox: recusado em produção fora de localhost; exige o segredo do webhook (o E2E assina os eventos); só o segredo, sem URL e chave, não é configuração pela metade', () => {
    expect(() => parseEnv({ ...prod, WHATSAPP_SANDBOX: '1', EVOLUTION_WEBHOOK_SECRET: 'w'.repeat(32) })).toThrow(/WHATSAPP_SANDBOX só fora de produção/);
    expect(() => parseEnv({ ...base, WHATSAPP_SANDBOX: '1' })).toThrow(/EVOLUTION_WEBHOOK_SECRET/);
    expect(parseEnv({ ...base, WHATSAPP_SANDBOX: '1', EVOLUTION_WEBHOOK_SECRET: 'w'.repeat(32) }).WHATSAPP_SANDBOX).toBe('1');
    expect(() => parseEnv({ ...base, WHATSAPP_SANDBOX: '1', EVOLUTION_WEBHOOK_SECRET: 'w'.repeat(32), EVOLUTION_API_KEY: evo.EVOLUTION_API_KEY })).toThrow(/juntas/);
  });
  it('worker: URL e chave juntas ou nenhuma; não exige o segredo do webhook', () => {
    const w = { NODE_ENV: 'development', DATABASE_URL, APP_URL: 'http://localhost:3000', ENCRYPTION_KEY: KEY, DATA_DIR: './data', EMAIL_FROM: 'NutriDebby <x@y.dev>', MAILPIT_URL: 'http://localhost:8025' };
    expect(parseWorkerEnv({ ...w, EVOLUTION_API_URL: evo.EVOLUTION_API_URL, EVOLUTION_API_KEY: evo.EVOLUTION_API_KEY }).EVOLUTION_API_KEY).toBe(evo.EVOLUTION_API_KEY);
    expect(() => parseWorkerEnv({ ...w, EVOLUTION_API_KEY: evo.EVOLUTION_API_KEY })).toThrow(/juntas/);
  });
});
```

Run: `pnpm test src/env.test.ts` → FAIL.

- [ ] **Step 3: Implementar as variáveis** — `src/env.ts`

Antes do `appSchema`:

```ts
/** D1: WhatsApp pela Evolution API — opcional; sem as variáveis, o WhatsApp fica desligado (lembretes por e-mail e push). */
const evolutionUrl = opcional(z.url({ message: 'EVOLUTION_API_URL deve ser uma URL (ex.: http://nutri_evolution:8080)' }).optional());
const evolutionKey = opcional(z.string().min(16, { message: 'EVOLUTION_API_KEY precisa de pelo menos 16 caracteres' }).optional());
const whatsappSandbox = opcional(z.enum(['0', '1'], { message: 'WHATSAPP_SANDBOX deve ser 0 ou 1' }).optional());
const ehLocal = (appUrl: string) => URL.canParse(appUrl) && ['localhost', '127.0.0.1'].includes(new URL(appUrl).hostname);
/** D4 (c): endereço da rede interna do Docker/Easypanel — nome de serviço (sem ponto) ou IPv4 privado. */
const ehHostInterno = (url: string) => {
  if (!URL.canParse(url)) return false;
  const h = new URL(url).hostname;
  return !h.includes('.') || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
};
```

No `appSchema.extend({ … })`:

```ts
    EVOLUTION_API_URL: evolutionUrl,
    EVOLUTION_API_KEY: evolutionKey,
    EVOLUTION_WEBHOOK_SECRET: opcional(z.string().min(32, { message: 'EVOLUTION_WEBHOOK_SECRET precisa de pelo menos 32 caracteres' }).optional()),
    EVOLUTION_WEBHOOK_URL: opcional(z.url({ message: 'EVOLUTION_WEBHOOK_URL deve ser uma URL' }).optional()),
    EVOLUTION_WEBHOOK_URL_PUBLICA: opcional(z.enum(['0', '1'], { message: 'EVOLUTION_WEBHOOK_URL_PUBLICA deve ser 0 ou 1' }).optional()),
    WHATSAPP_SANDBOX: whatsappSandbox,
```

e no `superRefine` do app, no fim:

```ts
    const evo = [e.EVOLUTION_API_URL, e.EVOLUTION_API_KEY, e.EVOLUTION_WEBHOOK_SECRET];
    // rodada 1: o sandbox (dev/CI/E2E) usa só o segredo (o E2E assina os webhooks) — sem URL e chave não é configuração pela metade
    const soSandbox = e.WHATSAPP_SANDBOX === '1' && !e.EVOLUTION_API_URL && !e.EVOLUTION_API_KEY;
    if (evo.some(Boolean) && !evo.every(Boolean) && !soSandbox) {
      ctx.addIssue({ code: 'custom', path: ['EVOLUTION_API_URL'], message: 'Configure EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_WEBHOOK_SECRET juntas (ou nenhuma)' });
    }
    // D4 (c): em produção, a Evolution chama o app pela rede interna; a URL pública só como opção explícita
    if (e.NODE_ENV === 'production' && !ehLocal(e.APP_URL) && e.EVOLUTION_API_URL) {
      if (!e.EVOLUTION_WEBHOOK_URL) {
        ctx.addIssue({ code: 'custom', path: ['EVOLUTION_WEBHOOK_URL'], message: 'EVOLUTION_WEBHOOK_URL é obrigatória em produção (endereço interno do app, ex.: http://nutridebby_app:3000/api/webhooks/whatsapp)' });
      } else if (!ehHostInterno(e.EVOLUTION_WEBHOOK_URL) && e.EVOLUTION_WEBHOOK_URL_PUBLICA !== '1') {
        ctx.addIssue({ code: 'custom', path: ['EVOLUTION_WEBHOOK_URL'], message: 'EVOLUTION_WEBHOOK_URL precisa ser um endereço interno (nome do serviço ou IP privado); URL pública só com EVOLUTION_WEBHOOK_URL_PUBLICA=1' });
      }
    }
    if (e.WHATSAPP_SANDBOX === '1') {
      if (e.NODE_ENV === 'production' && !ehLocal(e.APP_URL)) ctx.addIssue({ code: 'custom', path: ['WHATSAPP_SANDBOX'], message: 'WHATSAPP_SANDBOX só fora de produção' });
      if (!e.EVOLUTION_WEBHOOK_SECRET) ctx.addIssue({ code: 'custom', path: ['EVOLUTION_WEBHOOK_SECRET'], message: 'EVOLUTION_WEBHOOK_SECRET é obrigatória com WHATSAPP_SANDBOX=1 (o E2E assina os webhooks)' });
    }
```

No `workerSchema.extend({ … })`: `EVOLUTION_API_URL: evolutionUrl, EVOLUTION_API_KEY: evolutionKey, WHATSAPP_SANDBOX: whatsappSandbox,` e no `superRefine` do worker:

```ts
    if (Boolean(e.EVOLUTION_API_URL) !== Boolean(e.EVOLUTION_API_KEY)) {
      ctx.addIssue({ code: 'custom', path: ['EVOLUTION_API_URL'], message: 'Configure EVOLUTION_API_URL e EVOLUTION_API_KEY juntas (ou nenhuma)' });
    }
    if (e.WHATSAPP_SANDBOX === '1' && e.NODE_ENV === 'production' && !ehLocal(e.APP_URL)) {
      ctx.addIssue({ code: 'custom', path: ['WHATSAPP_SANDBOX'], message: 'WHATSAPP_SANDBOX só fora de produção' });
    }
    if (e.WHATSAPP_SANDBOX === '1' && !e.MAILPIT_URL) ctx.addIssue({ code: 'custom', path: ['MAILPIT_URL'], message: 'MAILPIT_URL é obrigatória com WHATSAPP_SANDBOX=1' });
```

`.env.example`, no lugar das 5 linhas `WHATSAPP_*`:

```bash
# --- Plano 05: WhatsApp pela Evolution API (D1). Sem estas, o WhatsApp fica desligado ---
# app e worker: endereço interno da Evolution (rede do Easypanel) e a AUTHENTICATION_API_KEY dela
EVOLUTION_API_URL=
EVOLUTION_API_KEY=
# só app: segredo do JWT do webhook (o mesmo que vai em `jwt_key`; gere com: openssl rand -base64 48)
EVOLUTION_WEBHOOK_SECRET=dev-webhook-secret-com-pelo-menos-32-caracteres
# só app: URL que a Evolution chama. Dev: opcional (padrão APP_URL + /api/webhooks/whatsapp).
# Produção: obrigatória e interna (ex.: http://nutridebby_app:3000/api/webhooks/whatsapp) — D4
EVOLUTION_WEBHOOK_URL=
# só app: 1 = aceitar uma EVOLUTION_WEBHOOK_URL pública em produção (opção explícita do runbook; o padrão é recusar)
EVOLUTION_WEBHOOK_URL_PUBLICA=
# dev/CI/E2E: mensagens vão para o Mailpit (<número>@whatsapp.sandbox); recusado em produção
WHATSAPP_SANDBOX=1
```

`.github/workflows/ci.yml`, no `env` do job do E2E: `WHATSAPP_SANDBOX: '1'` e `EVOLUTION_WEBHOOK_SECRET: ci-webhook-secret-with-at-least-32-characters`.

Run: `pnpm test src/env.test.ts` → PASS.

- [ ] **Step 4: Chave do webhook, provedor e Evolution (testes falham)**

`src/modules/notificacoes/whatsapp/jwt.test.ts` (a Tarefa 12 acrescenta os testes do JWT):

```ts
import { describe, expect, it } from 'vitest';
import { chaveDoWebhook } from './jwt';

describe('chave do webhook por instância (D4 a)', () => {
  it('uma chave por instância, estável, sem o segredo-mestre dentro', () => {
    const S = 's'.repeat(40);
    const a = chaveDoWebhook(S, 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f');
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(chaveDoWebhook(S, 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).toBe(a);
    expect(chaveDoWebhook(S, 'nd-1c7e4d2f-9b8e-4d3c-8a21-2b3c4d5e6f70')).not.toBe(a);
    expect(chaveDoWebhook('t'.repeat(40), 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f')).not.toBe(a);
    expect(a).not.toContain(S.slice(0, 8));
  });
});
```

`src/modules/notificacoes/whatsapp/evolution.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evolutionProvedor } from './evolution';
import { chaveDoWebhook } from './jwt';

type Chamada = { url: string; init: RequestInit };
function fetchFalso(respostas: Record<string, { status: number; body?: unknown } | Error>) {
  const chamadas: Chamada[] = [];
  const f = (async (url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const chave = `${init.method} ${new URL(url).pathname}`;
    const r = respostas[chave];
    if (!r) throw new Error(`sem resposta para ${chave}`);
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { f, chamadas };
}
const config = { url: 'http://evo:8080/', apiKey: 'chave-global-da-evolution', webhookUrl: 'http://app:3000/api/webhooks/whatsapp', webhookSecret: 's'.repeat(40) };

describe('Evolution API (D1)', () => {
  it('sendText: POST /message/sendText/<instância> com apikey e { number, text, delay, linkPreview }; devolve key.id e key.remoteJid', async () => {
    const { f, chamadas } = fetchFalso({ 'POST /message/sendText/nd-t1': { status: 201, body: { key: { id: 'WAID1', remoteJid: '551191234567@s.whatsapp.net', fromMe: true }, status: 'PENDING' } } });
    const r = await evolutionProvedor({ ...config, fetchImpl: f }).enviarTexto({ instancia: 'nd-t1', numero: '5511912345678', texto: 'Olá' });
    expect(r).toEqual({ ok: true, id: 'WAID1', jid: '551191234567@s.whatsapp.net' });
    expect(chamadas[0].url).toBe('http://evo:8080/message/sendText/nd-t1');
    expect(chamadas[0].init.headers).toMatchObject({ apikey: 'chave-global-da-evolution', 'content-type': 'application/json' });
    expect(JSON.parse(String(chamadas[0].init.body))).toEqual({ number: '5511912345678', text: 'Olá', delay: 1200, linkPreview: false });
  });

  it('falhas: número sem WhatsApp e 401/404 são definitivas; 5xx e rede caída repetem; timeout é definitivo (pode ter saído: no máximo 1)', async () => {
    const envio = { instancia: 'nd-t1', numero: '5511900000000', texto: 'x' };
    const com = (r: { status: number; body?: unknown } | Error) => evolutionProvedor({ ...config, fetchImpl: fetchFalso({ 'POST /message/sendText/nd-t1': r }).f }).enviarTexto(envio);
    expect(await com({ status: 400, body: { status: 400, error: 'Bad Request', response: { message: [{ exists: false, jid: '5511900000000@s.whatsapp.net', number: '5511900000000' }] } } })).toEqual({ ok: false, definitivo: true, codigo: 'numero_sem_whatsapp' });
    expect(await com({ status: 400, body: { response: { message: ['Text is required'] } } })).toEqual({ ok: false, definitivo: true, codigo: 'recusado' });
    expect(await com({ status: 401 })).toEqual({ ok: false, definitivo: true, codigo: 'nao_autorizado' });
    expect(await com({ status: 404 })).toEqual({ ok: false, definitivo: true, codigo: 'instancia_inexistente' });
    expect(await com({ status: 502 })).toEqual({ ok: false, definitivo: false, codigo: 'indisponivel' });
    expect(await com(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }))).toEqual({ ok: false, definitivo: false, codigo: 'indisponivel' });
    expect(await com(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))).toEqual({ ok: false, definitivo: true, codigo: 'sem_resposta' });
    expect(await com({ status: 201, body: { nada: true } })).toEqual({ ok: false, definitivo: true, codigo: 'resposta_invalida' });
  });

  it('conectar: cria a instância que falta, configura o webhook com o jwt_key DESTA instância (D4 a) e devolve o QR', async () => {
    const qr = 'data:image/png;base64,iVBORw0KGgo=';
    const { f, chamadas } = fetchFalso({
      'GET /instance/connectionState/nd-t1': { status: 404 },
      'POST /instance/create': { status: 201, body: { instance: { instanceName: 'nd-t1', status: 'connecting' } } },
      'POST /webhook/set/nd-t1': { status: 201, body: {} },
      'GET /instance/connect/nd-t1': { status: 200, body: { pairingCode: null, code: '2@x', base64: qr, count: 1 } },
    });
    expect(await evolutionProvedor({ ...config, fetchImpl: f }).conectar('nd-t1')).toEqual({ estado: 'qr', qr });
    expect(JSON.parse(String(chamadas[1].init.body))).toMatchObject({ instanceName: 'nd-t1', integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: true, readMessages: false, syncFullHistory: false });
    expect(JSON.parse(String(chamadas[2].init.body))).toEqual({
      webhook: { enabled: true, url: config.webhookUrl, headers: { jwt_key: chaveDoWebhook(config.webhookSecret, 'nd-t1') }, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'] },
    });
    expect(String(chamadas[2].init.body)).not.toContain(config.webhookSecret); // o segredo-mestre nunca sai do app
  });

  it('conectar já conectado → "conectada"; estado pelo fetchInstances com o número; erro do serviço não vaza a chave', async () => {
    const { f } = fetchFalso({
      'GET /instance/connectionState/nd-t1': { status: 200, body: { instance: { instanceName: 'nd-t1', state: 'open' } } },
      'POST /webhook/set/nd-t1': { status: 201, body: {} },
      'GET /instance/connect/nd-t1': { status: 200, body: { instance: { instanceName: 'nd-t1', state: 'open' } } },
      'GET /instance/fetchInstances': { status: 200, body: [{ name: 'nd-t1', connectionStatus: 'open', ownerJid: '5511912345678@s.whatsapp.net', token: 'segredo-da-instancia' }] },
    });
    const p = evolutionProvedor({ ...config, fetchImpl: f });
    expect(await p.conectar('nd-t1')).toEqual({ estado: 'conectada' });
    expect(await p.estado('nd-t1')).toEqual({ estado: 'conectada', numero: '+5511912345678' });
    const quebrado = evolutionProvedor({ ...config, fetchImpl: fetchFalso({ 'GET /instance/connectionState/nd-t1': { status: 500 } }).f });
    const erro = await quebrado.conectar('nd-t1').catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect(String((erro as Error).message)).not.toContain(config.apiKey);
  });
});
```

`src/modules/notificacoes/whatsapp/sandbox.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sandboxProvedor } from './sandbox';

describe('sandbox do WhatsApp (dev, CI, E2E)', () => {
  it('a mensagem vira e-mail no Mailpit para <número>@whatsapp.sandbox; finais 0000 e 9999 simulam falhas', async () => {
    const enviados: { url: string; corpo: { To: { Email: string }[]; Subject: string; Text: string } }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      enviados.push({ url, corpo: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const p = sandboxProvedor({ mailpitUrl: 'http://mailpit:8025', from: 'NutriDebby <x@y.dev>', fetchImpl: f });
    const r = await p.enviarTexto({ instancia: 'nd-t1', numero: '5511912345678', texto: 'Olá <b>Ana</b>' });
    expect(r).toMatchObject({ ok: true, jid: '5511912345678@s.whatsapp.net' });
    expect(enviados[0].corpo.To[0].Email).toBe('5511912345678@whatsapp.sandbox');
    expect(enviados[0].corpo.Subject).toBe('WhatsApp (nd-t1)');
    expect(enviados[0].corpo.Text).toBe('Olá <b>Ana</b>');
    expect(await p.enviarTexto({ instancia: 'nd-t1', numero: '5511900000000', texto: 'x' })).toEqual({ ok: false, definitivo: true, codigo: 'numero_sem_whatsapp' });
    expect(await p.enviarTexto({ instancia: 'nd-t1', numero: '5511999999999', texto: 'x' })).toEqual({ ok: false, definitivo: false, codigo: 'indisponivel' });
  });
  it('conectar devolve um QR de verdade (PNG em data URL); estado não tem informação (quem muda é o webhook assinado)', async () => {
    const p = sandboxProvedor({});
    const c = await p.conectar('nd-t1');
    expect(c.estado === 'qr' && c.qr.startsWith('data:image/png;base64,')).toBe(true);
    expect(await p.estado('nd-t1')).toBeNull();
  });
});
```

Run: `pnpm test src/modules/notificacoes/whatsapp` → FAIL (módulos não existem).

- [ ] **Step 5: Implementar o provedor**

`src/modules/notificacoes/whatsapp/jwt.ts` (a Tarefa 12 acrescenta a verificação):

```ts
import { hkdfSync } from 'node:crypto';

/**
 * D4 (a), rodada 1 do /code-review: o `jwt_key` de cada instância é derivado do segredo-mestre
 * (EVOLUTION_WEBHOOK_SECRET, que nunca sai do app). Um JWT de um consultório não vale para outro.
 * Trocar o segredo-mestre exige reconectar (o "Conectar WhatsApp" reconfigura o webhook da instância).
 */
export function chaveDoWebhook(segredo: string, instancia: string): string {
  return Buffer.from(hkdfSync('sha256', Buffer.from(segredo, 'utf8'), Buffer.alloc(0), `nutridebby:webhook-jwt:${instancia}`, 32)).toString('base64url');
}
```

`src/modules/notificacoes/whatsapp/provedor.ts`:

```ts
/** D1: tudo o que o NutriDebby pede ao WhatsApp, independente do provedor (Evolution, sandbox, falso nos testes). */
export type EnvioTexto = { instancia: string; numero: string; texto: string };
export type CodigoFalha = 'numero_sem_whatsapp' | 'recusado' | 'nao_autorizado' | 'instancia_inexistente' | 'indisponivel' | 'sem_resposta' | 'resposta_invalida';
/** `definitivo`: não adianta tentar de novo — ou não se sabe se saiu (timeout), e repetir poderia duplicar (D6). */
export type ResultadoEnvio = { ok: true; id: string; jid: string } | { ok: false; definitivo: boolean; codigo: CodigoFalha };
export type EstadoConexao = 'conectada' | 'conectando' | 'desconectada';
export type Conexao = { estado: 'conectada' } | { estado: 'qr'; qr: string };

export interface ProvedorWhatsapp {
  readonly nome: 'evolution' | 'sandbox' | 'fake';
  enviarTexto(e: EnvioTexto): Promise<ResultadoEnvio>;
  /** Cria a instância se faltar, (re)configura o webhook e devolve o QR — ou "conectada". */
  conectar(instancia: string): Promise<Conexao>;
  /** null = o provedor não informa (sandbox: o estado muda pelo webhook). */
  estado(instancia: string): Promise<{ estado: EstadoConexao; numero: string | null } | null>;
  desconectar(instancia: string): Promise<void>;
}

/** Serviço do WhatsApp fora do ar ou recusando (mensagem sem chave, número nem QR). */
export class WhatsappIndisponivelError extends Error {
  override name = 'WhatsappIndisponivelError';
}

export const digitosDoE164 = (e164: string) => e164.replace(/^\+/, '');
/** '5511912345678@s.whatsapp.net' (ou ':1@…' de aparelho) → '5511912345678'. */
export const digitosDoJid = (jid: string) => jid.split('@')[0].split(':')[0];
export function e164DoJid(jid: string): string | null {
  const d = digitosDoJid(jid);
  return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
}
```

`src/modules/notificacoes/whatsapp/evolution.ts`:

```ts
import { chaveDoWebhook } from './jwt';
import { e164DoJid, WhatsappIndisponivelError, type CodigoFalha, type ProvedorWhatsapp, type ResultadoEnvio } from './provedor';

export const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE'] as const;

type Opcoes = { url: string; apiKey: string; webhookUrl: string; webhookSecret?: string; fetchImpl?: typeof fetch; timeoutMs?: number };
const falha = (definitivo: boolean, codigo: CodigoFalha): ResultadoEnvio => ({ ok: false, definitivo, codigo });

/**
 * D1: cliente HTTP da Evolution API v2.3.7 (Baileys). Corpo do sendText conforme o DTO da v2
 * (`{ number, text }`; a página da documentação ainda mostra `textMessage.text`, formato da v1).
 * Respostas nunca são logadas (trazem número, QR e o token da instância).
 */
export function evolutionProvedor(o: Opcoes): ProvedorWhatsapp {
  const base = o.url.replace(/\/+$/, '');
  const f = o.fetchImpl ?? fetch;
  const inst = (i: string) => encodeURIComponent(i);

  async function chamar(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown): Promise<{ status: number; json: unknown; texto: string }> {
    const res = await f(`${base}${caminho}`, {
      method: metodo,
      headers: { apikey: o.apiKey, ...(corpo === undefined ? {} : { 'content-type': 'application/json' }) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000), // INT-01: 10 s
    });
    const texto = await res.text();
    let json: unknown = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json, texto };
  }

  async function exigir(metodo: 'GET' | 'POST' | 'DELETE', caminho: string, corpo?: unknown, aceitar: number[] = []) {
    let r: Awaited<ReturnType<typeof chamar>>;
    try {
      r = await chamar(metodo, caminho, corpo);
    } catch (e) {
      throw new WhatsappIndisponivelError(`Evolution sem resposta (${e instanceof Error ? e.name : 'erro'})`);
    }
    if (r.status >= 300 && !aceitar.includes(r.status)) throw new WhatsappIndisponivelError(`Evolution respondeu HTTP ${r.status}`);
    return r;
  }

  return {
    nome: 'evolution',
    async enviarTexto(e) {
      let r: Awaited<ReturnType<typeof chamar>>;
      try {
        r = await chamar('POST', `/message/sendText/${inst(e.instancia)}`, { number: e.numero, text: e.texto, delay: 1200, linkPreview: false });
      } catch (err) {
        const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        return falha(timeout, timeout ? 'sem_resposta' : 'indisponivel');
      }
      if (r.status === 200 || r.status === 201) {
        const k = (r.json as { key?: { id?: unknown; remoteJid?: unknown } } | null)?.key;
        return typeof k?.id === 'string' && typeof k.remoteJid === 'string' ? { ok: true, id: k.id, jid: k.remoteJid } : falha(true, 'resposta_invalida');
      }
      if (r.status === 400) return falha(true, /"exists"\s*:\s*false/.test(r.texto) ? 'numero_sem_whatsapp' : 'recusado');
      if (r.status === 401 || r.status === 403) return falha(true, 'nao_autorizado');
      if (r.status === 404) return falha(true, 'instancia_inexistente');
      return falha(false, 'indisponivel');
    },

    async conectar(instancia) {
      if (!o.webhookSecret) throw new WhatsappIndisponivelError('EVOLUTION_WEBHOOK_SECRET ausente');
      const atual = await exigir('GET', `/instance/connectionState/${inst(instancia)}`, undefined, [404]);
      if (atual.status === 404) {
        await exigir('POST', '/instance/create', {
          instanceName: instancia,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: true,
          groupsIgnore: true,
          rejectCall: false,
          alwaysOnline: false,
          readMessages: false,
          readStatus: false,
          syncFullHistory: false,
        });
      }
      // D4: a cada conexão o webhook é (re)configurado — troca de segredo ou de URL vale a partir daqui. O jwt_key é o
      // DESTA instância (derivado do segredo-mestre): o JWT que a Evolution gera só vale para ela (D4 a).
      await exigir('POST', `/webhook/set/${inst(instancia)}`, {
        webhook: { enabled: true, url: o.webhookUrl, headers: { jwt_key: chaveDoWebhook(o.webhookSecret, instancia) }, byEvents: false, base64: false, events: [...EVENTOS_WEBHOOK] },
      });
      const q = await exigir('GET', `/instance/connect/${inst(instancia)}`);
      const j = q.json as { base64?: unknown; instance?: { state?: unknown } } | null;
      if (j?.instance?.state === 'open') return { estado: 'conectada' };
      if (typeof j?.base64 === 'string' && j.base64.startsWith('data:image/png;base64,')) return { estado: 'qr', qr: j.base64 };
      throw new WhatsappIndisponivelError('Evolution não devolveu o QR code');
    },

    async estado(instancia) {
      const r = await exigir('GET', `/instance/fetchInstances?instanceName=${inst(instancia)}`, undefined, [404]);
      const i = Array.isArray(r.json) ? (r.json[0] as { connectionStatus?: unknown; ownerJid?: unknown } | undefined) : undefined;
      if (r.status === 404 || !i) return { estado: 'desconectada', numero: null };
      const estado = i.connectionStatus === 'open' ? 'conectada' : i.connectionStatus === 'connecting' ? 'conectando' : 'desconectada';
      return { estado, numero: typeof i.ownerJid === 'string' ? e164DoJid(i.ownerJid) : null };
    },

    async desconectar(instancia) {
      // 400 = já não estava conectada; 404 = a instância não existe — nos dois casos, desconectada
      await exigir('DELETE', `/instance/logout/${inst(instancia)}`, undefined, [400, 404]);
    },
  };
}
```

`src/modules/notificacoes/whatsapp/sandbox.ts`:

```ts
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { mailpitTransport } from '@/email/transport';
import type { ProvedorWhatsapp } from './provedor';

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * D1/D26: WhatsApp de mentira para dev, CI e E2E — a mensagem vira e-mail no Mailpit (`<número>@whatsapp.sandbox`).
 * Números terminados em 0000 = "sem WhatsApp"; em 9999 = serviço fora do ar. Nunca em produção (env.ts recusa).
 */
export function sandboxProvedor(o: { mailpitUrl?: string; from?: string; fetchImpl?: typeof fetch }): ProvedorWhatsapp {
  return {
    nome: 'sandbox',
    async enviarTexto(e) {
      if (!o.mailpitUrl || !o.from) throw new Error('sandbox do WhatsApp sem MAILPIT_URL/EMAIL_FROM');
      if (e.numero.endsWith('0000')) return { ok: false, definitivo: true, codigo: 'numero_sem_whatsapp' };
      if (e.numero.endsWith('9999')) return { ok: false, definitivo: false, codigo: 'indisponivel' };
      await mailpitTransport(o.mailpitUrl, o.fetchImpl).send({
        from: o.from,
        to: `${e.numero}@whatsapp.sandbox`,
        subject: `WhatsApp (${e.instancia})`,
        html: `<pre>${escapar(e.texto)}</pre>`,
        text: e.texto,
        idempotencyKey: randomUUID(),
      });
      return { ok: true, id: `sandbox-${randomUUID()}`, jid: `${e.numero}@s.whatsapp.net` };
    },
    async conectar(instancia) {
      return { estado: 'qr', qr: await QRCode.toDataURL(`nutridebby-sandbox:${instancia}`) };
    },
    async estado() {
      return null;
    },
    async desconectar() {},
  };
}
```

`src/modules/notificacoes/whatsapp/ambiente.ts`:

```ts
import { urlDoApp } from '@/lib/url-do-app';
import { evolutionProvedor } from './evolution';
import type { ProvedorWhatsapp } from './provedor';
import { sandboxProvedor } from './sandbox';

export type ModoWhatsapp = 'evolution' | 'sandbox' | 'desligado';
type Ambiente = {
  APP_URL: string;
  EVOLUTION_API_URL?: string;
  EVOLUTION_API_KEY?: string;
  EVOLUTION_WEBHOOK_SECRET?: string;
  EVOLUTION_WEBHOOK_URL?: string;
  WHATSAPP_SANDBOX?: string;
  MAILPIT_URL?: string;
  EMAIL_FROM?: string;
};

export function modoWhatsapp(e: Ambiente): ModoWhatsapp {
  if (e.EVOLUTION_API_URL && e.EVOLUTION_API_KEY) return 'evolution';
  return e.WHATSAPP_SANDBOX === '1' ? 'sandbox' : 'desligado';
}

/** D1: o WhatsApp só liga com as variáveis da Evolution (ou o sandbox fora de produção); senão, null. */
export function provedorDoAmbiente(e: Ambiente, fetchImpl?: typeof fetch): ProvedorWhatsapp | null {
  switch (modoWhatsapp(e)) {
    case 'evolution':
      return evolutionProvedor({
        url: e.EVOLUTION_API_URL!,
        apiKey: e.EVOLUTION_API_KEY!,
        webhookUrl: e.EVOLUTION_WEBHOOK_URL ?? urlDoApp(e.APP_URL, '/api/webhooks/whatsapp'),
        webhookSecret: e.EVOLUTION_WEBHOOK_SECRET,
        fetchImpl,
      });
    case 'sandbox':
      return sandboxProvedor({ mailpitUrl: e.MAILPIT_URL, from: e.EMAIL_FROM, fetchImpl });
    default:
      return null;
  }
}
```

Run: `pnpm test src/modules/notificacoes/whatsapp` → PASS (7 testes).

- [ ] **Step 6: Conexão do tenant (testes falham)** — `test/whatsapp.ts` e `src/modules/notificacoes/whatsapp/conexao.test.ts`

`test/whatsapp.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Db } from '@/db/client';
import { whatsappConexoes } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import type { EnvioTexto, EstadoConexao, ProvedorWhatsapp, ResultadoEnvio } from '@/modules/notificacoes/whatsapp/provedor';

/** WhatsApp em memória para os testes; `resposta` decide o resultado de cada envio. */
export function whatsappFalso(opts: { resposta?: (e: EnvioTexto) => ResultadoEnvio; estado?: EstadoConexao } = {}): ProvedorWhatsapp & { enviados: EnvioTexto[]; conectadas: string[]; desconectadas: string[] } {
  const enviados: EnvioTexto[] = [];
  const conectadas: string[] = [];
  const desconectadas: string[] = [];
  return {
    nome: 'fake',
    enviados,
    conectadas,
    desconectadas,
    async enviarTexto(e) {
      enviados.push(e);
      return opts.resposta?.(e) ?? { ok: true, id: `fake-${randomUUID()}`, jid: `${e.numero}@s.whatsapp.net` };
    },
    async conectar(i) {
      conectadas.push(i);
      return opts.estado === 'conectada' ? { estado: 'conectada' } : { estado: 'qr', qr: 'data:image/png;base64,AAAA' };
    },
    async estado() {
      return { estado: opts.estado ?? 'conectando', numero: opts.estado === 'conectada' ? '+5511900001111' : null };
    },
    async desconectar(i) {
      desconectadas.push(i);
    },
  };
}

/** Conexão do WhatsApp gravada direto (ex.: "conectada" para testar o envio). */
export async function conexaoDeTeste(db: Db, ctx: TenantContext, estado: EstadoConexao = 'conectada'): Promise<void> {
  await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(whatsappConexoes)
        .values({ tenantId: ctx.tenantId, instancia: `nd-${ctx.tenantId}`, estado, numeroE164: estado === 'conectada' ? '+5511900001111' : null, conectadaEm: estado === 'conectada' ? new Date() : null })
        .onConflictDoUpdate({ target: whatsappConexoes.tenantId, set: { estado } }),
    db,
  );
}
```

`src/modules/notificacoes/whatsapp/conexao.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../../test/db';
import { ctxPaciente, emailsNaFila, novoPaciente, novoTenant } from '../../../../test/pacientes';
import { whatsappFalso } from '../../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { user, whatsappConexoes } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { atualizarEstadoConexao, conectarWhatsapp, desconectarWhatsapp, instanciaDoTenant, situacaoDoWhatsapp, sincronizarEstado, tenantDaInstancia } from './conexao';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const deps = { db: app.db, agora: new Date('2026-10-14T12:00:00Z'), appUrl: 'http://localhost:3000' };

describe('conexão do WhatsApp por tenant (D2)', () => {
  it('instância nd-<tenantId>, e de volta; nada fora do formato', () => {
    const id = randomUUID();
    expect(tenantDaInstancia(instanciaDoTenant(id))).toBe(id);
    expect([tenantDaInstancia('nd-x'), tenantDaInstancia('outra'), tenantDaInstancia(42)]).toEqual([null, null, null]);
  });

  it('conectar: grava "conectando" e devolve o QR; o webhook "open" vira "conectada" com o número; polling também', async () => {
    const T = await novoTenant(app.db);
    const w = whatsappFalso();
    expect(await conectarWhatsapp(T.ctx, w, deps)).toEqual({ estado: 'qr', qr: 'data:image/png;base64,AAAA' });
    expect(w.conectadas).toEqual([`nd-${T.tenantId}`]);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ ligado: true, estado: 'conectando', numero: null });
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ estado: 'conectada', numero: '+5511912345678', conectadaAntes: true });
    const U = await novoTenant(app.db);
    await conectarWhatsapp(U.ctx, w, deps);
    expect(await sincronizarEstado(U.ctx, whatsappFalso({ estado: 'conectada' }), deps)).toMatchObject({ estado: 'conectada', numero: '+5511900001111' });
  });

  it('o celular desconecta: "desconectada" e um e-mail à nutricionista (uma vez por desconexão); desconectar pelo painel não manda e-mail', async () => {
    const T = await novoTenant(app.db);
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    await conectarWhatsapp(T.ctx, whatsappFalso(), deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, deps);
    await atualizarEstadoConexao(T.tenantId, { estado: 'desconectada' }, deps);
    expect(await emailsNaFila('whatsapp_desconectado', nutri.email)).toHaveLength(1);
    expect(await situacaoDoWhatsapp(T.ctx, true, app.db)).toMatchObject({ estado: 'desconectada', conectadaAntes: true });
    const U = await novoTenant(app.db);
    const [nu] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, U.nutriId));
    const w = whatsappFalso();
    await conectarWhatsapp(U.ctx, w, deps);
    await atualizarEstadoConexao(U.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    await desconectarWhatsapp(U.ctx, w, deps);
    expect(w.desconectadas).toEqual([`nd-${U.tenantId}`]);
    await atualizarEstadoConexao(U.tenantId, { estado: 'desconectada' }, deps); // o webhook chega depois
    expect(await emailsNaFila('whatsapp_desconectado', nu.email)).toEqual([]);
  });

  it('tenant sem conexão: o webhook não cria linha; WhatsApp desligado na plataforma; paciente não vê a conexão (staff_only)', async () => {
    const T = await novoTenant(app.db);
    await atualizarEstadoConexao(T.tenantId, { estado: 'conectada', numero: '+5511912345678' }, deps);
    expect(await withTenant(T.ctx, (tx) => tx.select().from(whatsappConexoes), app.db)).toEqual([]);
    expect(await situacaoDoWhatsapp(T.ctx, false, app.db)).toMatchObject({ ligado: false, estado: 'desconectada' });
    await conectarWhatsapp(T.ctx, whatsappFalso(), deps);
    const p = await novoPaciente(app.db, T.ctx);
    expect(await withTenant(ctxPaciente(T.tenantId, p.id), (tx) => tx.select().from(whatsappConexoes), app.db)).toEqual([]);
  });
});
```

Run: `pnpm test src/modules/notificacoes/whatsapp/conexao.test.ts` → FAIL.

- [ ] **Step 7: Implementar a conexão** — `src/modules/notificacoes/whatsapp/conexao.ts`

```ts
import { eq } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { whatsappConexoes, type WhatsappConexaoRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { urlDoApp } from '@/lib/url-do-app';
import { avisarNutri } from '@/modules/agenda/aviso-nutri';
import { idValido } from '@/modules/pacientes/base';
import { provedorDoAmbiente } from './ambiente';
import type { Conexao, EstadoConexao, ProvedorWhatsapp } from './provedor';

export const instanciaDoTenant = (tenantId: string) => `nd-${tenantId}`;

/** Instância do webhook → tenant; só o formato `nd-<uuid>` (D4). */
export function tenantDaInstancia(instancia: unknown): string | null {
  if (typeof instancia !== 'string' || !instancia.startsWith('nd-')) return null;
  const id = instancia.slice(3);
  return idValido(id) ? id : null;
}

/** O app usa as variáveis dele (sem MAILPIT_URL: o sandbox do app só gera o QR). */
export function provedorDoApp(): ProvedorWhatsapp | null {
  return provedorDoAmbiente(getEnv());
}

export type SituacaoWhatsapp = { ligado: boolean; estado: EstadoConexao; numero: string | null; desconectadaEm: Date | null; conectadaAntes: boolean };

export async function lerConexao(tx: Tx): Promise<WhatsappConexaoRow | null> {
  const [c] = await tx.select().from(whatsappConexoes);
  return c ?? null;
}

const situacao = (ligado: boolean, c: WhatsappConexaoRow | null): SituacaoWhatsapp => ({
  ligado,
  estado: (c?.estado as EstadoConexao | undefined) ?? 'desconectada',
  numero: c?.numeroE164 ?? null,
  desconectadaEm: c?.desconectadaEm ?? null,
  conectadaAntes: !!c?.conectadaEm,
});

export async function situacaoDoWhatsapp(ctx: TenantContext, ligado: boolean, db: Db = getDb()): Promise<SituacaoWhatsapp> {
  return situacao(ligado, await withTenant(ctx, lerConexao, db));
}

type Deps = { db?: Db; agora?: Date; appUrl?: string };

/** "Conectar WhatsApp": grava a conexão como "conectando" (cria na primeira vez) e pede o QR ao provedor. */
export async function conectarWhatsapp(ctx: TenantContext, provedor: ProvedorWhatsapp, deps: Deps = {}): Promise<Conexao> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  const instancia = instanciaDoTenant(ctx.tenantId);
  await withTenant(
    ctx,
    (tx) =>
      tx
        .insert(whatsappConexoes)
        .values({ tenantId: ctx.tenantId, instancia, estado: 'conectando', createdAt: agora, updatedAt: agora })
        .onConflictDoUpdate({ target: whatsappConexoes.tenantId, set: { estado: 'conectando', updatedAt: agora } }),
    db,
  );
  const r = await provedor.conectar(instancia);
  if (r.estado === 'conectada') await atualizarEstadoConexao(ctx.tenantId, { estado: 'conectada' }, deps);
  return r;
}

/** Polling do painel: pergunta ao provedor (Evolution) e grava; o sandbox não informa (fica o que o webhook gravou). */
export async function sincronizarEstado(ctx: TenantContext, provedor: ProvedorWhatsapp, deps: Deps = {}): Promise<SituacaoWhatsapp> {
  const db = deps.db ?? getDb();
  const atual = await withTenant(ctx, lerConexao, db);
  if (atual) {
    const r = await provedor.estado(atual.instancia);
    if (r) await atualizarEstadoConexao(ctx.tenantId, r, deps);
  }
  return situacaoDoWhatsapp(ctx, true, db);
}

/** "Desconectar WhatsApp" pelo painel: sem e-mail de aviso (foi a própria nutricionista). */
export async function desconectarWhatsapp(ctx: TenantContext, provedor: ProvedorWhatsapp, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  await provedor.desconectar(instanciaDoTenant(ctx.tenantId));
  await withTenant(
    ctx,
    (tx) => tx.update(whatsappConexoes).set({ estado: 'desconectada', desconectadaEm: agora, avisoDesconexaoEm: agora, updatedAt: agora }).where(eq(whatsappConexoes.tenantId, ctx.tenantId)),
    db,
  );
}

/**
 * connection.update (webhook) ou polling. Só atualiza conexão que existe (o webhook nunca cria). De "conectada"
 * para "desconectada" sem ter sido pelo painel: e-mail à nutricionista, uma vez por desconexão (D18).
 */
export async function atualizarEstadoConexao(tenantId: string, novo: { estado: EstadoConexao; numero?: string | null }, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  await withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      const [c] = await tx.select().from(whatsappConexoes).where(eq(whatsappConexoes.tenantId, tenantId)).for('update');
      if (!c || (c.estado === novo.estado && (novo.numero === undefined || novo.numero === c.numeroE164))) return;
      if (novo.estado === 'conectada') {
        await tx
          .update(whatsappConexoes)
          .set({ estado: 'conectada', numeroE164: novo.numero ?? c.numeroE164, conectadaEm: agora, desconectadaEm: null, avisoDesconexaoEm: null, updatedAt: agora })
          .where(eq(whatsappConexoes.id, c.id));
        return;
      }
      const caiu = c.estado === 'conectada' && novo.estado === 'desconectada';
      await tx
        .update(whatsappConexoes)
        .set({ estado: novo.estado, ...(caiu ? { desconectadaEm: agora } : {}), updatedAt: agora })
        .where(eq(whatsappConexoes.id, c.id));
      if (caiu && !c.avisoDesconexaoEm) {
        await tx.update(whatsappConexoes).set({ avisoDesconexaoEm: agora }).where(eq(whatsappConexoes.id, c.id));
        const link = urlDoApp(deps.appUrl ?? getEnv().APP_URL, '/painel/whatsapp');
        await avisarNutri(tx, tenantId, (para) => ({ tipo: 'whatsapp_desconectado', para, link }));
      }
    },
    db,
  );
}
```

> `getEnv()` só é chamado sem `deps.appUrl` (no app). No worker, `processarEventoWhatsapp` (Tarefa 12) passa `appUrl`.

`src/email/types.ts`: `| { tipo: 'whatsapp_desconectado'; para: string; link: string }`.

`src/email/templates.tsx`:

```tsx
    case 'whatsapp_desconectado':
      return simples(
        'Seu WhatsApp foi desconectado do NutriDebby',
        ['O WhatsApp do consultório foi desconectado (o celular saiu de "Aparelhos conectados" ou ficou muito tempo sem internet).', 'Os lembretes estão saindo só por e-mail e notificação no app.'],
        { href: msg.link, rotulo: 'Conectar o WhatsApp de novo' },
      );
```

`src/email/render.test.ts`:

```ts
  it('WhatsApp desconectado: o que aconteceu e o link para conectar de novo', () => {
    const r = renderEmail({ tipo: 'whatsapp_desconectado', para: 'd@x.dev', link: 'https://x.dev/painel/whatsapp' });
    expect(r.subject).toBe('Seu WhatsApp foi desconectado do NutriDebby');
    expect(r.text).toContain('Conectar o WhatsApp de novo: https://x.dev/painel/whatsapp');
  });
```

Run: `pnpm test src/modules/notificacoes/whatsapp src/email` → PASS.

- [ ] **Step 8: Rota de estado e tela "WhatsApp"**

`src/app/api/painel/whatsapp/estado/route.ts`:

```ts
import { logger } from '@/lib/logger';
import { requireApiNutri } from '@/lib/tenant-session';
import { provedorDoApp, sincronizarEstado, situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { WhatsappIndisponivelError } from '@/modules/notificacoes/whatsapp/provedor';

export const dynamic = 'force-dynamic';
const SEM_CACHE = { 'cache-control': 'no-store' };

/** Polling da tela de conexão (a cada 3 s enquanto o QR está na tela). Só estado e número: nada do provedor vaza. */
export async function GET(req: Request) {
  const acesso = await requireApiNutri(req);
  if (!acesso.ok) return acesso.response;
  const provedor = provedorDoApp();
  try {
    const s = provedor ? await sincronizarEstado(acesso.ctx, provedor) : await situacaoDoWhatsapp(acesso.ctx, false);
    return Response.json({ estado: s.estado, numero: s.numero }, { headers: SEM_CACHE });
  } catch (e) {
    if (!(e instanceof WhatsappIndisponivelError)) throw e;
    logger.warn({ tenantId: acesso.ctx.tenantId, err: e.message }, 'WhatsApp indisponível no polling');
    const s = await situacaoDoWhatsapp(acesso.ctx, true);
    return Response.json({ estado: s.estado, numero: s.numero }, { headers: SEM_CACHE });
  }
}
```

`src/app/api/painel/whatsapp/estado/route.test.ts`:

```ts
import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { getAuth } from '@/lib/auth';
import { conexaoDeTeste } from '../../../../../../test/whatsapp';
import { nutriComDpa } from '../../../../../../test/nutri';
import { GET } from './route';

vi.mock('server-only', () => ({}));
const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());
const pedir = (cookie?: string) => GET(new Request('http://localhost:3000/api/painel/whatsapp/estado', { headers: cookie ? { cookie } : {} }));

describe('GET /api/painel/whatsapp/estado', () => {
  it('estado e número da conexão do próprio tenant, sem cache; sem sessão = 401', async () => {
    const A = await nutriComDpa(db, auth);
    expect(await (await pedir(A.cookie)).json()).toEqual({ estado: 'desconectada', numero: null });
    await conexaoDeTeste(db, A.ctx, 'conectada');
    const r = await pedir(A.cookie);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ estado: 'conectada', numero: '+5511900001111' });
    expect((await pedir()).status).toBe(401);
  });
});
```

> No teste, `WHATSAPP_SANDBOX` não está no ambiente: `provedorDoApp()` é `null` e a rota só lê o banco.

`src/app/painel/whatsapp/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { logger } from '@/lib/logger';
import { requireNutri } from '@/lib/tenant-session';
import { conectarWhatsapp, desconectarWhatsapp, provedorDoApp } from '@/modules/notificacoes/whatsapp/conexao';
import { WhatsappIndisponivelError } from '@/modules/notificacoes/whatsapp/provedor';

export type ConectarState = { qr?: string; conectada?: boolean; erro?: string; envio?: number };
const MSG_FORA = 'Não foi possível falar com o serviço de WhatsApp. Tente de novo em alguns minutos.';

export async function conectarAction(_prev: ConectarState): Promise<ConectarState> {
  const { ctx } = await requireNutri('/painel/whatsapp');
  const provedor = provedorDoApp();
  if (!provedor) return { erro: 'O WhatsApp ainda não está disponível na plataforma. Os lembretes saem por e-mail.' };
  try {
    const r = await conectarWhatsapp(ctx, provedor);
    revalidatePath('/painel/whatsapp');
    return r.estado === 'qr' ? { qr: r.qr, envio: Date.now() } : { conectada: true };
  } catch (e) {
    if (!(e instanceof WhatsappIndisponivelError)) throw e;
    logger.warn({ tenantId: ctx.tenantId, err: e.message }, 'falha ao conectar o WhatsApp');
    return { erro: MSG_FORA };
  }
}

export async function desconectarAction(): Promise<void> {
  const { ctx } = await requireNutri('/painel/whatsapp');
  const provedor = provedorDoApp();
  if (!provedor) return;
  try {
    await desconectarWhatsapp(ctx, provedor);
  } catch (e) {
    if (!(e instanceof WhatsappIndisponivelError)) throw e;
    logger.warn({ tenantId: ctx.tenantId, err: e.message }, 'falha ao desconectar o WhatsApp');
  }
  revalidatePath('/painel/whatsapp');
}
```

`src/app/painel/whatsapp/conectar.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';
import { conectarAction, type ConectarState } from './actions';

/** QR + polling do estado a cada 3 s por até 3 min; conectado → recarrega a página. */
export function ConectarWhatsapp() {
  const [state, action, pendente] = useActionState<ConectarState>(conectarAction, {});
  const router = useRouter();
  useEffect(() => {
    if (state.conectada) return router.refresh();
    if (!state.qr) return;
    const fim = Date.now() + 3 * 60_000;
    const t = setInterval(async () => {
      if (Date.now() > fim) return clearInterval(t);
      const r = await fetch('/api/painel/whatsapp/estado', { cache: 'no-store' }).catch(() => null);
      const j = r?.ok ? ((await r.json()) as { estado: string }) : null;
      if (j?.estado === 'conectada') {
        clearInterval(t);
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(t);
  }, [state, router]);
  return (
    <div className="space-y-3">
      <form action={action}>
        <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">{state.qr ? 'Gerar novo QR code' : 'Conectar WhatsApp'}</button>
      </form>
      {state.erro && <p role="alert" className="text-red-700">{state.erro}</p>}
      {state.qr && (
        <div className="space-y-2">
          <p>No celular, abra o WhatsApp &gt; Aparelhos conectados &gt; Conectar um aparelho e aponte para este código.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- QR em data URL gerado na hora, fora do otimizador */}
          <img src={state.qr} alt="QR code para conectar o WhatsApp" width={264} height={264} className="rounded border bg-white p-2" />
        </div>
      )}
    </div>
  );
}
```

`src/app/painel/whatsapp/page.tsx`:

```tsx
import { ConfirmarBotao } from '@/components/confirmar-botao';
import { requireNutri } from '@/lib/tenant-session';
import { formatarQuando } from '@/modules/agenda/fuso';
import { provedorDoApp, situacaoDoWhatsapp } from '@/modules/notificacoes/whatsapp/conexao';
import { formatarTelefone } from '@/modules/pacientes/telefone';
import { Cabecalho } from '../cabecalho';
import { desconectarAction } from './actions';
import { ConectarWhatsapp } from './conectar';

export const dynamic = 'force-dynamic';

export default async function WhatsappPage() {
  const { ctx, tenant } = await requireNutri('/painel/whatsapp');
  const s = await situacaoDoWhatsapp(ctx, provedorDoApp() !== null);
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        {!s.ligado ? (
          <p role="status">O WhatsApp ainda não está disponível na plataforma. Os lembretes saem por e-mail.</p>
        ) : s.estado === 'conectada' ? (
          <section className="space-y-3">
            <p role="status">{`Conectado ao número ${s.numero ? formatarTelefone(s.numero) : '(número ainda não informado)'}.`}</p>
            <form action={desconectarAction}>
              <ConfirmarBotao mensagem="Desconectar o WhatsApp? Os lembretes passam a sair só por e-mail e notificação no app.">Desconectar WhatsApp</ConfirmarBotao>
            </form>
          </section>
        ) : (
          <section className="space-y-3">
            {s.conectadaAntes && s.desconectadaEm && (
              <p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">{`WhatsApp desconectado. Os lembretes estão saindo só por e-mail e notificação no app. (Desde ${formatarQuando(s.desconectadaEm, tenant.fuso)}.)`}</p>
            )}
            <p>Use, de preferência, um número só do consultório. Os lembretes saem do número conectado.</p>
            <ConectarWhatsapp />
          </section>
        )}
        {/* Tarefa 11: WhatsApps do mês */}
      </main>
    </>
  );
}
```

Em `src/app/painel/cabecalho.tsx`, no `<nav>`, depois de "Agenda": `<Link href="/painel/whatsapp">WhatsApp</Link>`.

Em `src/app/painel/page.tsx` (alerta do painel inicial; imports `Link`, `provedorDoApp`, `situacaoDoWhatsapp`): `const { data, tenant, ctx } = await requireNutri('/painel');`, antes do `return`:

```tsx
  const whatsapp = await situacaoDoWhatsapp(ctx, provedorDoApp() !== null);
```

e, depois do aviso de armazenamento:

```tsx
        {whatsapp.ligado && whatsapp.conectadaAntes && whatsapp.estado === 'desconectada' && (
          <p role="alert" className="rounded bg-amber-50 p-3 text-amber-900">
            WhatsApp desconectado. Os lembretes estão saindo só por e-mail e notificação no app. <Link href="/painel/whatsapp" className="underline">Conectar de novo</Link>
          </p>
        )}
```

- [ ] **Step 9: E2E** — a tela de conexão (o `e2e/whatsapp.ts`, com o webhook assinado pela chave da instância, nasce na Tarefa 12)

Em `e2e/agenda.spec.ts`:

```ts
test('WhatsApp: tela de conexão mostra o QR (D2)', async () => {
  await nutri.goto('/painel/whatsapp');
  await expect(nutri.getByText('Use, de preferência, um número só do consultório. Os lembretes saem do número conectado.')).toBeVisible();
  await nutri.getByRole('button', { name: 'Conectar WhatsApp' }).click();
  await expect(nutri.getByRole('img', { name: 'QR code para conectar o WhatsApp' })).toBeVisible();
  await expect(nutri.getByRole('button', { name: 'Gerar novo QR code' })).toBeVisible();
});
```

Run: `pnpm e2e:seed && pnpm test:e2e e2e/agenda.spec.ts`
Expected: PASS (6 testes).

- [ ] **Step 10: Commit**

```bash
git add src/db/schema/agenda.ts drizzle/0056_whatsapp_conexoes.sql drizzle/0057_rls_whatsapp_conexoes.sql drizzle/meta src/db/rls-guard.ts test/isolamento.test.ts src/env.ts src/env.test.ts .env.example .github/workflows/ci.yml src/modules/notificacoes/whatsapp src/email src/app/api/painel/whatsapp src/app/painel/whatsapp src/app/painel/cabecalho.tsx src/app/painel/page.tsx test/whatsapp.ts e2e/agenda.spec.ts scripts/e2e-seed.ts
git commit -m "feat(whatsapp): provedor Evolution API com sandbox, variáveis e conexão por QR code no painel (D1, D2)"
```

---
### Task 10: WhatsApp nos lembretes — textos, pré-condições, novas tentativas, fallback por e-mail e ritmo de envio (P05-07b)

**Files:**
- Create: `src/modules/notificacoes/mensagens.test.ts`, `src/modules/notificacoes/enviar-whatsapp.test.ts`
- Modify: `src/modules/notificacoes/mensagens.ts`, `src/modules/notificacoes/enviar.ts`, `src/modules/notificacoes/enviar.test.ts` (deps com `whatsapp: null`), `src/worker/index.ts`

**Interfaces:**
- Consumes: `ProvedorWhatsapp`, `digitosDoE164` (Tarefa 9); `lerConexao` (Tarefa 9); `dadosDaConsulta`, `primeiroNome` (Tarefa 5); `openSecret` (`@/lib/crypto`); `provedorDoAmbiente` (Tarefa 9); `whatsappFalso`, `conexaoDeTeste` (Tarefa 9); `transporteFalso` (Tarefa 5).
- Produces:
  - `DepsEnvio` ganha `whatsapp: ProvedorWhatsapp | null`.
  - `@/modules/notificacoes/mensagens`: `FINALIDADE_CONTEUDO = 'notificacao-conteudo'` (texto pronto e cifrado em `notifications.conteudo_selado`; a Tarefa 14 usa no convite), `textoWhatsapp(c: ContextoEnvio, deps: { appUrl; chaveLinks }): string | null`.
  - `@/modules/notificacoes/enviar`: `WHATSAPP_POR_MINUTO = 8`; `vagasDoMinuto(tx, tenant, agora)` (interna) e `escolherWhatsapp` com o ritmo (D16: sem vaga no minuto, nem busca); `CANAIS_ENVIO.whatsapp = enviarWhatsapp`.

- [ ] **Step 1: Textos (falham)** — `src/modules/notificacoes/mensagens.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { AppointmentRow, NotificationRow, PatientRow, TenantRow } from '@/db/schema';
import { sealSecret } from '@/lib/crypto';
import { chaveDosLinks } from '@/modules/agenda/link-consulta';
import type { ContextoEnvio } from './enviar';
import { FINALIDADE_CONTEUDO, textoWhatsapp } from './mensagens';

const deps = { appUrl: 'https://app.exemplo.com', chaveLinks: chaveDosLinks(Buffer.alloc(32, 9)) };
const tenant = { id: '0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f', nomeExibicao: 'Debby Silva', fuso: 'America/Sao_Paulo', enderecoConsultorio: 'Rua das Flores, 10', cancelamentoMinH: 24 } as TenantRow;
const consulta = { id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', inicio: new Date('2026-10-16T17:00:00Z'), modalidade: 'presencial', linkOnline: null } as AppointmentRow;
const paciente = { nome: 'Ana Souza Lima', email: 'ana@ex.com' } as PatientRow;
const ctx = (tipo: string, extra: Partial<NotificationRow> = {}): ContextoEnvio => ({ n: { tipo, conteudoSelado: null, ...extra } as NotificationRow, paciente, consulta, tenant, agora: new Date('2026-10-15T17:00:00Z') });

describe('textos do WhatsApp (D3)', () => {
  it('lembrete de 24 h: quando com fuso, endereço, "1"/"2" e o link assinado', () => {
    const t = textoWhatsapp(ctx('lembrete_24h'), deps)!;
    expect(t).toContain('Olá, Ana! Lembrete da sua consulta com Debby Silva: sex., 16/10/2026 às 14:00 (horário de Brasília), presencial.');
    expect(t).toContain('Endereço: Rua das Flores, 10');
    expect(t).toContain('Responda 1 para confirmar ou 2 se precisar remarcar.');
    expect(t).toMatch(/Ou use o link: https:\/\/app\.exemplo\.com\/consulta\/[A-Za-z0-9_-]{71}$/);
  });
  it('lembrete de 2 h online: hoje, link da chamada e link da consulta', () => {
    const t = textoWhatsapp({ ...ctx('lembrete_2h'), consulta: { ...consulta, modalidade: 'online', linkOnline: 'https://meet.google.com/abc' } as AppointmentRow }, deps)!;
    expect(t).toContain('Olá, Ana! Sua consulta com Debby Silva é hoje às 14:00 (horário de Brasília).');
    expect(t).toContain('Link da chamada: https://meet.google.com/abc');
    expect(t).toContain('Se não puder ir, avise pelo link: https://app.exemplo.com/consulta/');
  });
  it('respostas a "1" e "2"; texto pronto e cifrado (convite) é aberto; tipo sem texto → null', () => {
    expect(textoWhatsapp(ctx('resposta_confirmacao'), deps)).toBe('Presença confirmada. Até lá!');
    expect(textoWhatsapp(ctx('resposta_remarcar'), deps)).toMatch(/^Tudo bem! Para escolher outro horário, use o link: https:\/\/app\.exemplo\.com\/consulta\/\S+\nSe faltarem menos de 24 h para a consulta, fale direto com Debby Silva\.$/);
    expect(textoWhatsapp(ctx('convite_paciente', { conteudoSelado: sealSecret('Convite pronto', FINALIDADE_CONTEUDO) }), deps)).toBe('Convite pronto');
    expect(textoWhatsapp(ctx('consulta_marcada'), deps)).toBeNull();
  });
});
```

Run: `pnpm test src/modules/notificacoes/mensagens.test.ts` → FAIL.

- [ ] **Step 2: Implementar os textos** — acrescentar a `src/modules/notificacoes/mensagens.ts` (import `openSecret` de `@/lib/crypto`)

```ts
/** Texto pronto, cifrado na linha até o envio (convite com link de uso único, Tarefa 14). */
export const FINALIDADE_CONTEUDO = 'notificacao-conteudo';

/**
 * D3: texto simples (sem botões, sem template). Só transacional: lembrete, resposta e convite. O link assinado
 * da consulta vai em todo lembrete; a resposta "1"/"2" é interpretada no webhook (Tarefa 12).
 */
export function textoWhatsapp(c: ContextoEnvio, deps: { appUrl: string; chaveLinks: Buffer }): string | null {
  if (c.n.conteudoSelado) return openSecret(c.n.conteudoSelado, FINALIDADE_CONTEUDO);
  if (c.n.tipo === 'resposta_confirmacao') return 'Presença confirmada. Até lá!';
  if (!c.consulta) return null;
  const d = dadosDaConsulta({ consulta: c.consulta, tenant: c.tenant }, deps);
  const nome = primeiroNome(c.paciente.nome);
  const local = d.local ? (d.modalidade === 'online' ? `Link da chamada: ${d.local}` : `Endereço: ${d.local}`) : null;
  switch (c.n.tipo) {
    case 'lembrete_24h':
      return [`Olá, ${nome}! Lembrete da sua consulta com ${d.nutri}: ${d.quando}, ${d.modalidade}.`, local, '', 'Responda 1 para confirmar ou 2 se precisar remarcar.', `Ou use o link: ${d.link}`].filter((l) => l !== null).join('\n');
    case 'lembrete_2h':
      return [`Olá, ${nome}! Sua consulta com ${d.nutri} é hoje às ${d.hora} (${d.quando.slice(d.quando.indexOf('(') + 1, -1)}).`, local, '', `Se não puder ir, avise pelo link: ${d.link}`].filter((l) => l !== null).join('\n');
    case 'resposta_remarcar':
      return `Tudo bem! Para escolher outro horário, use o link: ${d.link}\nSe faltarem menos de ${c.tenant.cancelamentoMinH} h para a consulta, fale direto com ${d.nutri}.`;
    default:
      return null;
  }
}
```

Run: `pnpm test src/modules/notificacoes/mensagens.test.ts` → PASS (3 testes).

- [ ] **Step 3: Testes do canal WhatsApp (falham)** — `src/modules/notificacoes/enviar-whatsapp.test.ts`

```ts
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { transporteFalso } from '../../../test/email';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { conexaoDeTeste, whatsappFalso } from '../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { notifications, patients } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { sealSecret } from '@/lib/crypto';
import { agendarPelaNutri } from '@/modules/agenda/consultas';
import { chaveDosLinks } from '@/modules/agenda/link-consulta';
import { processarNotificacoes, WHATSAPP_POR_MINUTO, type DepsEnvio } from './enviar';
import { FINALIDADE_CONTEUDO } from './mensagens';
import type { ResultadoEnvio } from './whatsapp/provedor';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const marcadaEm = new Date('2026-10-01T12:00:00Z');
const comWhats = { telefoneE164: '+5511912345678', whatsappOptinEm: marcadaEm, whatsappOptinOrigem: 'nutri' };
const deps = (agora: Date, whatsapp: DepsEnvio['whatsapp'], transport = transporteFalso()): DepsEnvio => ({
  db: app.db, agora: () => agora, appUrl: 'http://localhost:3000', chaveLinks: chaveDosLinks(Buffer.alloc(32, 9)), email: { transport, from: 'NutriDebby <x@y.dev>' }, whatsapp,
});
async function marcada(T: TenantDeTeste, paciente: Record<string, unknown> = comWhats) {
  const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza', ...paciente });
  const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: p.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: marcadaEm });
  return { p, id };
}
const linha = async (T: TenantDeTeste, id: string, tipo: string, canal: string) =>
  (await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, tipo), eq(notifications.canal, canal))), app.db))[0];
const vence24h = em('2026-10-15', '14:00');

describe('WhatsApp nos lembretes (INT-01 adaptado, D6)', () => {
  it('com opt-in, telefone e conexão: envia o texto com "1"/"2" e grava id e jid do provedor', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const { id } = await marcada(T);
    const w = whatsappFalso();
    await processarNotificacoes(deps(vence24h, w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(1);
    expect(w.enviados[0]).toMatchObject({ instancia: `nd-${T.tenantId}`, numero: '5511912345678' });
    expect(w.enviados[0].texto).toContain('Responda 1 para confirmar ou 2 se precisar remarcar.');
    const l = await linha(T, id, 'lembrete_24h', 'whatsapp');
    expect(l).toMatchObject({ status: 'enviada', providerJid: '5511912345678@s.whatsapp.net' });
    expect(l.providerMsgId).toMatch(/^fake-/);
  });

  it('sem opt-in, com opt-out, sem telefone, desconectado ou desligado na plataforma → "ignorada" com o motivo (e-mail segue)', async () => {
    const casos: [Record<string, unknown>, 'conectada' | 'desconectada', boolean, string][] = [
      [{ telefoneE164: '+5511912345678' }, 'conectada', true, 'sem_optin'],
      [{ ...comWhats, whatsappOptoutEm: marcadaEm }, 'conectada', true, 'sem_optin'],
      [{ whatsappOptinEm: null }, 'conectada', true, 'sem_optin'],
      [{ telefoneE164: null, whatsappOptinEm: marcadaEm, whatsappOptinOrigem: 'nutri' }, 'conectada', true, 'sem_telefone'],
      [comWhats, 'desconectada', true, 'whatsapp_desconectado'],
      [comWhats, 'conectada', false, 'whatsapp_desligado'],
    ];
    for (const [paciente, estado, ligado, motivo] of casos) {
      const T = await novoTenant(app.db);
      await conexaoDeTeste(app.db, T.ctx, estado);
      const { id } = await marcada(T, paciente);
      const t = transporteFalso();
      await processarNotificacoes(deps(vence24h, ligado ? whatsappFalso() : null, t), { tenantId: T.tenantId });
      expect(await linha(T, id, 'lembrete_24h', 'whatsapp'), motivo).toMatchObject({ status: 'ignorada', motivoIgnorada: motivo });
      expect(t.enviados.some((e) => e.subject.startsWith('Lembrete'))).toBe(true);
    }
  });

  it('erro passageiro: novas tentativas em 1, 5 e 25 min; depois "falhou" e o e-mail do lembrete que tinha falhado sai de novo (US-034)', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const { id } = await marcada(T);
    // o e-mail deste lembrete já tinha falhado de vez
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ status: 'falhou', erro: 'email' }).where(and(eq(notifications.appointmentId, id), eq(notifications.canal, 'email'), eq(notifications.tipo, 'lembrete_24h'))), app.db);
    const fora: ResultadoEnvio = { ok: false, definitivo: false, codigo: 'indisponivel' };
    const w = whatsappFalso({ resposta: () => fora });
    let agora = vence24h;
    for (const espera of [60, 300, 1500]) {
      await processarNotificacoes(deps(agora, w), { tenantId: T.tenantId });
      const l = await linha(T, id, 'lembrete_24h', 'whatsapp');
      expect(l.status).toBe('pendente');
      expect(l.agendadaPara.getTime() - agora.getTime()).toBe(espera * 1000);
      agora = l.agendadaPara;
    }
    const t = transporteFalso();
    await processarNotificacoes(deps(agora, w, t), { tenantId: T.tenantId }); // 4ª = 1 + 3 novas tentativas
    expect(await linha(T, id, 'lembrete_24h', 'whatsapp')).toMatchObject({ status: 'falhou', erro: 'indisponivel', tentativas: 4 });
    expect(w.enviados).toHaveLength(4);
    await processarNotificacoes(deps(agora, w, t), { tenantId: T.tenantId });
    expect(await linha(T, id, 'lembrete_24h', 'email')).toMatchObject({ status: 'enviada' });
    expect(t.enviados.map((e) => e.subject)).toContain('Lembrete: sua consulta é amanhã às 14:00');
  });

  it('número sem WhatsApp: "falhou" na hora, sem nova tentativa', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const { id } = await marcada(T);
    const w = whatsappFalso({ resposta: () => ({ ok: false, definitivo: true, codigo: 'numero_sem_whatsapp' }) });
    await processarNotificacoes(deps(vence24h, w), { tenantId: T.tenantId });
    expect(await linha(T, id, 'lembrete_24h', 'whatsapp')).toMatchObject({ status: 'falhou', erro: 'numero_sem_whatsapp', tentativas: 1 });
  });

  it(`ritmo (D16): no máximo ${WHATSAPP_POR_MINUTO} por minuto por tenant; o resto sai na volta seguinte`, async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    for (let i = 0; i < WHATSAPP_POR_MINUTO + 2; i++) {
      const p = await novoPaciente(app.db, T.ctx, comWhats);
      const inicio = em('2026-10-16', `${String(8 + i).padStart(2, '0')}:00`);
      const c = await consultaDireta(app.db, T.ctx, p.id, inicio);
      await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: inicio, canal: 'whatsapp', tipo: 'lembrete_24h', agendadaPara: em('2026-10-15', '08:00') }), app.db);
    }
    const w = whatsappFalso();
    await processarNotificacoes(deps(em('2026-10-15', '08:00'), w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(WHATSAPP_POR_MINUTO);
    await processarNotificacoes(deps(em('2026-10-15', '08:00'), w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(WHATSAPP_POR_MINUTO); // ainda no mesmo minuto
    await processarNotificacoes(deps(em('2026-10-15', '08:01'), w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(WHATSAPP_POR_MINUTO + 2);
  });

  it('rodada 1 (D6): 100 WhatsApps atrasados de um tenant não seguram o e-mail e o push dele nem os de outro tenant na mesma volta do cron', async () => {
    // setembro: nenhum outro teste deixa linha vencida antes disso (a volta do cron passa por todos os tenants do banco)
    const agora = em('2026-09-14', '10:00');
    const T = await novoTenant(app.db);
    const U = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const p = await novoPaciente(app.db, T.ctx, comWhats);
    const selado = sealSecret('Convite de teste', FINALIDADE_CONTEUDO);
    await withTenant(
      T.ctx,
      (tx) => tx.execute(sql`insert into notifications (tenant_id, patient_id, canal, tipo, conteudo_selado, agendada_para)
        select ${T.tenantId}, ${p.id}, 'whatsapp', 'convite_paciente', ${selado}, ${em('2026-09-14', '09:00')}::timestamptz from generate_series(1, 100)`),
      app.db,
    );
    const consultas: Record<string, string> = {};
    for (const X of [T, U]) {
      const q = await novoPaciente(app.db, X.ctx, comWhats);
      consultas[X.tenantId] = (await agendarPelaNutri(X.ctx, tenantAgenda(X), { patientId: q.id, data: '2026-10-20', hora: '10:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: agora })).id;
    }
    const w = whatsappFalso();
    const t = transporteFalso();
    await processarNotificacoes(deps(agora, w, t)); // a volta do cron: todos os tenants
    for (const X of [T, U]) {
      expect(await linha(X, consultas[X.tenantId], 'consulta_marcada', 'email'), X.tenantId).toMatchObject({ status: 'enviada' });
      expect((await linha(X, consultas[X.tenantId], 'consulta_marcada', 'push')).status, X.tenantId).not.toBe('pendente');
    }
    expect(w.enviados).toHaveLength(WHATSAPP_POR_MINUTO); // o WhatsApp andou no ritmo, sem passar dele
  });

  it('paciente que revogou o WhatsApp depois de marcar não recebe (US-011 "Revogar")', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const { p, id } = await marcada(T);
    await withTenant(T.ctx, (tx) => tx.update(patients).set({ whatsappOptoutEm: marcadaEm }).where(eq(patients.id, p.id)), app.db);
    const w = whatsappFalso();
    await processarNotificacoes(deps(vence24h, w), { tenantId: T.tenantId });
    expect(w.enviados).toEqual([]);
    expect(await linha(T, id, 'lembrete_24h', 'whatsapp')).toMatchObject({ motivoIgnorada: 'sem_optin' });
  });
});
```

Run: `pnpm test src/modules/notificacoes/enviar-whatsapp.test.ts` → FAIL (`WHATSAPP_POR_MINUTO` não exportado; WhatsApp sempre "whatsapp_desligado").

- [ ] **Step 4: Implementar o canal e o ritmo** — em `src/modules/notificacoes/enviar.ts`

Imports novos: `count`, `gt`, `or` de `drizzle-orm`; `type ProvedorWhatsapp`, `digitosDoE164` de `./whatsapp/provedor`; `lerConexao` de `./whatsapp/conexao`; `textoWhatsapp` de `./mensagens`.

`DepsEnvio` passa a:

```ts
export type DepsEnvio = {
  db: Db;
  agora: () => Date;
  appUrl: string;
  chaveLinks: Buffer;
  email: { transport: EmailTransport; from: string };
  /** null = WhatsApp desligado na plataforma (sem as variáveis da Evolution). */
  whatsapp: ProvedorWhatsapp | null;
};
```

O canal (substitui `whatsapp: async () => ignorar('whatsapp_desligado')` em `CANAIS_ENVIO` por `whatsapp: enviarWhatsapp`):

```ts
/** INT-01 (Evolution): pré-condições na hora do envio; timeout e falha definitiva não repetem (no máximo 1, D6). */
async function enviarWhatsapp(c: ContextoEnvio, deps: DepsEnvio): Promise<Resultado> {
  if (!deps.whatsapp) return ignorar('whatsapp_desligado');
  const conexao = await withTenant({ tenantId: c.tenant.id, role: 'worker' }, lerConexao, deps.db);
  if (!conexao || conexao.estado !== 'conectada') return ignorar('whatsapp_desconectado');
  if (!c.paciente.whatsappOptinEm || c.paciente.whatsappOptoutEm) return ignorar('sem_optin'); // INT-01: opt-in antes de qualquer mensagem
  if (!c.paciente.telefoneE164) return ignorar('sem_telefone');
  const texto = textoWhatsapp(c, deps);
  if (!texto) return { status: 'falhou', erro: 'sem_modelo' };
  const r = await deps.whatsapp.enviarTexto({ instancia: conexao.instancia, numero: digitosDoE164(c.paciente.telefoneE164), texto });
  if (r.ok) return { status: 'enviada', providerMsgId: r.id, providerJid: r.jid };
  return r.definitivo ? { status: 'falhou', erro: r.codigo } : { status: 'repetir', erro: r.codigo };
}
```

E o ritmo, substituindo a função `escolherWhatsapp` da Tarefa 5:

```ts
/** D16: no máximo 8 WhatsApps por minuto por tenant (anti-bloqueio). O que passar fica "pendente" para a próxima volta. */
export const WHATSAPP_POR_MINUTO = 8;

/** D16: vagas do minuto deste tenant. Um worker por vez decide o ritmo dele (mesmo que um dia haja mais de uma instância). */
async function vagasDoMinuto(tx: Tx, tenant: TenantRow, agora: Date): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('whatsapp-envio'), hashtext(${tenant.id}))`);
  const [{ n }] = await tx
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.canal, 'whatsapp'), or(eq(notifications.status, 'enviando'), gt(notifications.enviadaEm, new Date(agora.getTime() - 60_000)))));
  return Math.max(0, WHATSAPP_POR_MINUTO - n);
}

/** WhatsApps desta rodada (Tarefa 11 acrescenta a cota). Sem vaga no minuto, nem busca: o resto fica para a próxima volta. */
async function escolherWhatsapp(tx: Tx, tenant: TenantRow, agora: Date, max: number, devidas: Devidas): Promise<{ reservar: NotificationRow[]; semCota: string[] }> {
  if (max <= 0) return { reservar: [], semCota: [] };
  const livres = Math.min(max, await vagasDoMinuto(tx, tenant, agora));
  return { reservar: livres > 0 ? await devidas(['whatsapp'], livres) : [], semCota: [] };
}
```

Em `src/modules/notificacoes/enviar.test.ts`, o `deps(...)` passa a incluir `whatsapp: null`.

Em `src/worker/index.ts` (import `provedorDoAmbiente` de `@/modules/notificacoes/whatsapp/ambiente`): no `depsEnvio`, `whatsapp: provedorDoAmbiente(env),` e, logo depois, `logger.info({ whatsapp: depsEnvio.whatsapp?.nome ?? 'desligado' }, 'canal de WhatsApp');` (só o modo: nunca URL nem chave). A fila `notificacoes` continua com um job por vez no worker (padrão do `boss.work`: `localConcurrency` 1) — isso é a "fila serial" da D16.

Run: `pnpm test src/modules/notificacoes`
Expected: PASS (7 testes novos em `enviar-whatsapp.test.ts`; os anteriores verdes).

(O E2E do WhatsApp — conexão pelo webhook, lembrete no sandbox e resposta "1"/"2" — fica no Step 7 da Tarefa 12, que tem a rota do webhook.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/notificacoes src/worker/index.ts
git commit -m "feat(whatsapp): lembretes por WhatsApp com pré-condições, novas tentativas, fallback por e-mail e ritmo de 8/min (INT-01, D6, D16)"
```

---
### Task 11: Cota de WhatsApp (RN-09) — 80%, 100%, virada do mês no fuso, admin amplia, métricas do admin (P05-09)

**Files:**
- Create: `src/modules/notificacoes/whatsapp/cota.ts`, `src/modules/notificacoes/whatsapp/cota.test.ts`, `drizzle/0058_metricas_agenda.sql` (custom)
- Modify: `src/modules/notificacoes/enviar.ts` (`escolherWhatsapp`, `aposEnvio`), `src/email/types.ts`, `src/email/templates.tsx`, `src/email/render.test.ts`, `src/app/painel/whatsapp/page.tsx`, `src/app/painel/page.tsx`, `src/modules/plataforma/metricas.test.ts`

**Interfaces:**
- Consumes: `notifications`, `whatsappConexoes`, `type NotificationRow`, `type TenantRow`; `inicioDoMes`, `inicioDoMesSeguinte`, `partesNoFuso` (Tarefa 1); `avisarNutri` (Tarefa 6); `urlDoApp`; `escolherWhatsapp`, `vagasDoMinuto`, `aposEnvio`, `WHATSAPP_POR_MINUTO` (Tarefas 5 e 10); `agendarPelaNutri`, `moverConsulta` (Tarefa 3).
- Produces:
  - `@/modules/notificacoes/whatsapp/cota`: `CONTA_COTA`, `FORA_DA_COTA` (respostas "1"/"2"), `contaCota(tipo): boolean`, `mesDe(instante, fuso): string` ('AAAA-MM'), `usoDoMes(tx, fuso, agora, opts?: { comEnviando?: boolean }): Promise<number>`, `type NivelCota = 'ok' | 'aviso' | 'esgotada'`, `nivelDaCota(usadas, cota): NivelCota`, `type SituacaoCota = { usadas: number; cota: number; nivel: NivelCota }`, `situacaoDaCota(ctx, tenant, agora?, db?): Promise<SituacaoCota>`, `avisarSeChegou80(tx, tenant, agora, appUrl): Promise<void>`, `MSG_COTA`.
  - `admin_tenant_metrics()` devolve `consultas_mes` (consultas não canceladas do mês do tenant) e `mensagens_whatsapp_mes` (WhatsApps que contam na cota, aceitos no mês).
  - `EmailMessage` ganha `{ tipo: 'cota_whatsapp'; para; usadas: number; cota: number; link }`.

- [ ] **Step 1: Testes da cota (falham)** — `src/modules/notificacoes/whatsapp/cota.test.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em, tenantAgenda } from '../../../../test/agenda';
import { makeDb } from '../../../../test/db';
import { transporteFalso } from '../../../../test/email';
import { emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';
import { conexaoDeTeste, whatsappFalso } from '../../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { notifications, tenants, user } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { agendarPelaNutri, moverConsulta } from '@/modules/agenda/consultas';
import { chaveDosLinks } from '@/modules/agenda/link-consulta';
import { processarNotificacoes, type DepsEnvio } from '../enviar';
import { nivelDaCota, situacaoDaCota, usoDoMes } from './cota';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = 'America/Sao_Paulo';
const comWhats = { telefoneE164: '+5511912345678', whatsappOptinEm: new Date('2026-10-01T12:00:00Z'), whatsappOptinOrigem: 'nutri' };
const deps = (agora: Date, whatsapp = whatsappFalso()): DepsEnvio => ({
  db: app.db, agora: () => agora, appUrl: 'http://localhost:3000', chaveLinks: chaveDosLinks(Buffer.alloc(32, 9)), email: { transport: transporteFalso(), from: 'NutriDebby <x@y.dev>' }, whatsapp,
});

/** n lembretes de WhatsApp vencidos em `vence`, um por paciente/consulta. */
async function devidos(T: TenantDeTeste, n: number, vence: Date, dia = '2026-10-20') {
  for (let i = 0; i < n; i++) {
    const p = await novoPaciente(app.db, T.ctx, comWhats);
    const inicio = em(dia, `${String(8 + i).padStart(2, '0')}:00`);
    const c = await consultaDireta(app.db, T.ctx, p.id, inicio);
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: inicio, canal: 'whatsapp', tipo: 'lembrete_24h', agendadaPara: vence }), app.db);
  }
}
const cota = (T: TenantDeTeste, n: number) => app.db.update(tenants).set({ waCotaMensal: n }).where(eq(tenants.id, T.tenantId));
const emailDaNutri = async (T: TenantDeTeste) => (await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId)))[0].email;

describe('cota de WhatsApp (RN-09, US-036)', () => {
  it('nível: 80% é aviso, 100% esgotada; cota 0 = esgotada', () => {
    expect([nivelDaCota(399, 500), nivelDaCota(400, 500), nivelDaCota(499, 500), nivelDaCota(500, 500), nivelDaCota(0, 0)]).toEqual(['ok', 'aviso', 'aviso', 'esgotada', 'esgotada']);
  });

  it('conta só WhatsApps que contam (lembretes e convite) aceitos no mês civil do tenant — 31/10 às 23:30 de Brasília ainda é outubro', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const linhas = [
      { tipo: 'lembrete_24h', canal: 'whatsapp', enviadaEm: em('2026-10-31', '23:30') },
      { tipo: 'convite_paciente', canal: 'whatsapp', enviadaEm: em('2026-10-02', '10:00') },
      { tipo: 'resposta_confirmacao', canal: 'whatsapp', enviadaEm: em('2026-10-10', '10:00') }, // resposta livre não conta
      { tipo: 'lembrete_24h', canal: 'email', enviadaEm: em('2026-10-10', '10:00') },
      { tipo: 'lembrete_2h', canal: 'whatsapp', enviadaEm: em('2026-11-01', '00:30') },
    ];
    for (const [i, l] of linhas.entries()) {
      const inicio = new Date(em('2026-12-01', '08:00').getTime() + i * 7_200_000);
      const c = await consultaDireta(app.db, T.ctx, p.id, inicio);
      const semConsulta = l.tipo === 'convite_paciente';
      await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: semConsulta ? null : c, inicioConsulta: semConsulta ? null : inicio, canal: l.canal, tipo: l.tipo, status: 'enviada', agendadaPara: l.enviadaEm, enviadaEm: l.enviadaEm }), app.db);
    }
    expect(await withTenant(T.ctx, (tx) => usoDoMes(tx, SP, em('2026-10-31', '23:59')), app.db)).toBe(2);
    expect(await withTenant(T.ctx, (tx) => usoDoMes(tx, SP, em('2026-11-01', '00:00')), app.db)).toBe(1); // virada do mês
  });

  it('100%: o que passa da cota vira "ignorada"/"cota_esgotada"; e-mail segue; o admin amplia e volta na hora', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await cota(T, 2);
    const vence = em('2026-10-19', '09:00');
    await devidos(T, 3, vence);
    const w = whatsappFalso();
    await processarNotificacoes(deps(vence, w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(2);
    const ns = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.canal, 'whatsapp')), app.db);
    expect(ns.filter((n) => n.motivoIgnorada === 'cota_esgotada')).toHaveLength(1);
    expect(await situacaoDaCota(T.ctx, { fuso: SP, waCotaMensal: 2 }, vence, app.db)).toEqual({ usadas: 2, cota: 2, nivel: 'esgotada' });
    await cota(T, 1000);
    await devidos(T, 1, new Date(vence.getTime() + 60_000), '2026-10-21');
    await processarNotificacoes(deps(new Date(vence.getTime() + 61_000), w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(3);
  });

  it('rodada 1 (D6): o lembrete enviado é imutável — enviar, a nutricionista mudar a hora e enviar de novo contam 2; mudar a hora não reduz o uso do mês', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const p = await novoPaciente(app.db, T.ctx, comWhats);
    const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: p.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: em('2026-10-01', '09:00') });
    const w = whatsappFalso();
    const uso = (agora: Date) => withTenant(T.ctx, (tx) => usoDoMes(tx, SP, agora), app.db);
    await processarNotificacoes(deps(em('2026-10-15', '14:00'), w), { tenantId: T.tenantId });
    expect(await uso(em('2026-10-15', '15:00'))).toBe(1);
    await moverConsulta(T.ctx, tenantAgenda(T), id, { data: '2026-10-17', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: em('2026-10-15', '15:00') });
    expect(await uso(em('2026-10-15', '15:00'))).toBe(1); // a enviada continua lá, com enviada_em
    await processarNotificacoes(deps(em('2026-10-16', '14:00'), w), { tenantId: T.tenantId });
    expect(w.enviados).toHaveLength(2);
    expect(await uso(em('2026-10-16', '15:00'))).toBe(2);
    const enviadas = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.canal, 'whatsapp'), eq(notifications.status, 'enviada'))), app.db);
    expect(enviadas.map((n) => n.inicioConsulta?.toISOString()).sort()).toEqual([em('2026-10-16', '14:00').toISOString(), em('2026-10-17', '14:00').toISOString()]);
  });

  it('80%: e-mail "Você usou 80% dos WhatsApps do mês" uma vez por mês', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    await cota(T, 5);
    const vence = em('2026-10-19', '09:00');
    await devidos(T, 5, vence);
    await processarNotificacoes(deps(vence), { tenantId: T.tenantId });
    const avisos = await emailsNaFila('cota_whatsapp', await emailDaNutri(T));
    expect(avisos.map((a) => [a.usadas, a.cota])).toEqual([[4, 5]]);
    const nov = em('2026-11-02', '09:00');
    await devidos(T, 4, nov, '2026-11-20');
    await processarNotificacoes(deps(nov), { tenantId: T.tenantId });
    expect(await emailsNaFila('cota_whatsapp', await emailDaNutri(T))).toHaveLength(2); // novo mês, novo aviso
    const marcado = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.canal, 'whatsapp'), eq(notifications.status, 'enviada'))), app.db);
    expect(marcado).toHaveLength(9);
  });
});
```

Run: `pnpm test src/modules/notificacoes/whatsapp/cota.test.ts` → FAIL.

- [ ] **Step 2: Implementar** — `src/modules/notificacoes/whatsapp/cota.ts`

```ts
import { and, count, eq, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { notifications, whatsappConexoes, type TenantRow } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { urlDoApp } from '@/lib/url-do-app';
import { avisarNutri } from '@/modules/agenda/aviso-nutri';
import { inicioDoMes, inicioDoMesSeguinte, partesNoFuso } from '@/modules/agenda/fuso';

/** D15: o que conta na cota — lembretes e convite. Respostas automáticas a "1"/"2" (dentro da conversa) não contam. */
export const CONTA_COTA = ['lembrete_24h', 'lembrete_2h', 'convite_paciente'] as const;
/** Os outros tipos que saem por WhatsApp (as respostas): seguem o ritmo, mas não a cota. */
export const FORA_DA_COTA = ['resposta_confirmacao', 'resposta_remarcar'] as const;
export const contaCota = (tipo: string) => (CONTA_COTA as readonly string[]).includes(tipo);
export const mesDe = (instante: Date, fuso: string) => partesNoFuso(instante, fuso).data.slice(0, 7);

export const MSG_COTA = {
  uso: (usadas: number, cota: number) => `WhatsApps do mês: ${usadas} de ${cota}`,
  aviso: 'Você usou 80% dos WhatsApps do mês',
  esgotada: 'Cota de WhatsApp do mês esgotada: os lembretes seguem por e-mail e notificação no app até o mês que vem.',
} as const;

/**
 * RN-09: aceitas pela Evolution (`enviada_em`) no mês civil do tenant. `comEnviando` (reserva do envio) soma as que
 * estão saindo agora, para duas voltas não passarem da cota; o aviso e a tela contam só as aceitas.
 */
export async function usoDoMes(tx: Tx, fuso: string, agora: Date, opts: { comEnviando?: boolean } = {}): Promise<number> {
  const doMes = and(gte(notifications.enviadaEm, inicioDoMes(agora, fuso)), lt(notifications.enviadaEm, inicioDoMesSeguinte(agora, fuso)));
  const [{ n }] = await tx
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.canal, 'whatsapp'), inArray(notifications.tipo, [...CONTA_COTA]), opts.comEnviando ? or(doMes, eq(notifications.status, 'enviando')) : doMes));
  return Number(n);
}

export type NivelCota = 'ok' | 'aviso' | 'esgotada';
/** RN-09: 80% → aviso; 100% → esgotada (cota 0 = esgotada). */
export function nivelDaCota(usadas: number, cota: number): NivelCota {
  if (usadas >= cota) return 'esgotada';
  return usadas >= Math.ceil(cota * 0.8) ? 'aviso' : 'ok';
}

export type SituacaoCota = { usadas: number; cota: number; nivel: NivelCota };

export async function situacaoDaCota(ctx: TenantContext, tenant: Pick<TenantRow, 'fuso' | 'waCotaMensal'>, agora: Date = new Date(), db: Db = getDb()): Promise<SituacaoCota> {
  const usadas = await withTenant(ctx, (tx) => usoDoMes(tx, tenant.fuso, agora), db);
  return { usadas, cota: tenant.waCotaMensal, nivel: nivelDaCota(usadas, tenant.waCotaMensal) };
}

/** US-036: ao chegar a 80% (ou passar), um e-mail à nutricionista por mês (`aviso_cota_mes`). */
export async function avisarSeChegou80(tx: Tx, tenant: TenantRow, agora: Date, appUrl: string): Promise<void> {
  const usadas = await usoDoMes(tx, tenant.fuso, agora); // só as aceitas: as outras do lote ainda estão "enviando"
  if (nivelDaCota(usadas, tenant.waCotaMensal) === 'ok') return;
  const mes = mesDe(agora, tenant.fuso);
  const [marcou] = await tx
    .update(whatsappConexoes)
    .set({ avisoCotaMes: mes, updatedAt: agora })
    .where(and(eq(whatsappConexoes.tenantId, tenant.id), or(isNull(whatsappConexoes.avisoCotaMes), ne(whatsappConexoes.avisoCotaMes, mes))))
    .returning({ id: whatsappConexoes.id });
  if (!marcou) return; // já avisado neste mês
  const link = urlDoApp(appUrl, '/painel/whatsapp');
  await avisarNutri(tx, tenant.id, (para) => ({ tipo: 'cota_whatsapp', para, usadas, cota: tenant.waCotaMensal, link }));
}
```

Em `src/modules/notificacoes/enviar.ts` (imports `contaCota`, `FORA_DA_COTA`, `CONTA_COTA`, `usoDoMes`, `avisarSeChegou80` de `./whatsapp/cota`) — `escolherWhatsapp` passa a (substitui a da Tarefa 10; `vagasDoMinuto` fica como está):

```ts
/**
 * D15 + D16: cota do mês (RN-09) e ritmo de 8/min. Cota esgotada → os que contam viram "cota_esgotada" já, sem gastar
 * vaga; sem vaga no minuto → nem busca (fica para a próxima volta). E-mail e push já foram reservados antes (D6).
 */
async function escolherWhatsapp(tx: Tx, tenant: TenantRow, agora: Date, max: number, devidas: Devidas): Promise<{ reservar: NotificationRow[]; semCota: string[] }> {
  if (max <= 0) return { reservar: [], semCota: [] };
  const livres = Math.min(max, await vagasDoMinuto(tx, tenant, agora));
  let saldo = tenant.waCotaMensal - (await usoDoMes(tx, tenant.fuso, agora, { comEnviando: true })); // lido agora: o admin ampliar vale na hora
  if (saldo <= 0) {
    const semCota = (await devidas(['whatsapp'], max, CONTA_COTA)).map((n) => n.id);
    return { reservar: livres > 0 ? await devidas(['whatsapp'], livres, FORA_DA_COTA) : [], semCota };
  }
  const reservar: NotificationRow[] = [];
  const semCota: string[] = [];
  for (const n of livres > 0 ? await devidas(['whatsapp'], livres) : []) {
    if (!contaCota(n.tipo)) reservar.push(n);
    else if (saldo > 0) {
      saldo--;
      reservar.push(n);
    } else semCota.push(n.id);
  }
  return { reservar, semCota };
}
```

e `aposEnvio` (com a chamada em `registrarResultado` passando `deps.appUrl`):

```ts
/** Depois de um envio aceito: o aviso de 80% da cota (US-036). */
async function aposEnvio(tx: Tx, tenant: TenantRow, n: NotificationRow, agora: Date, appUrl: string): Promise<void> {
  if (n.canal === 'whatsapp' && contaCota(n.tipo)) await avisarSeChegou80(tx, tenant, agora, appUrl);
}
```

(em `registrarResultado`: `if (ok) await aposEnvio(tx, tenant, ok, agora, deps.appUrl);`).

`src/email/types.ts`: `| { tipo: 'cota_whatsapp'; para: string; usadas: number; cota: number; link: string }`.

`src/email/templates.tsx`:

```tsx
    case 'cota_whatsapp':
      return simples(
        'Você usou 80% dos WhatsApps do mês',
        [
          `Já foram ${msg.usadas} de ${msg.cota} mensagens de WhatsApp neste mês.`,
          'Quando chegar a 100%, os lembretes seguem só por e-mail e notificação no app até o mês que vem (ou até o suporte ampliar a cota).',
        ],
        { href: msg.link, rotulo: 'Ver o uso do WhatsApp' },
      );
```

`src/email/render.test.ts`:

```ts
  it('cota de WhatsApp: o texto exato da US-036 no assunto e o uso no corpo', () => {
    const r = renderEmail({ tipo: 'cota_whatsapp', para: 'd@x.dev', usadas: 400, cota: 500, link: 'https://x.dev/painel/whatsapp' });
    expect(r.subject).toBe('Você usou 80% dos WhatsApps do mês');
    expect(r.text).toContain('Já foram 400 de 500 mensagens de WhatsApp neste mês.');
  });
```

Run: `pnpm test src/modules/notificacoes src/email` → PASS (5 testes novos em `cota.test.ts`).

- [ ] **Step 3: Painel** — uso e avisos

Em `src/app/painel/whatsapp/page.tsx` (imports `MSG_COTA`, `situacaoDaCota`), no lugar do comentário "Tarefa 11":

```tsx
        {s.ligado && (
          <section aria-labelledby="uso" className="space-y-2">
            <h2 id="uso" className="text-lg font-semibold">Uso do mês</h2>
            <p>{MSG_COTA.uso(cota.usadas, cota.cota)}</p>
            {cota.nivel === 'aviso' && <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">{MSG_COTA.aviso}</p>}
            {cota.nivel === 'esgotada' && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{MSG_COTA.esgotada}</p>}
          </section>
        )}
```

com `const cota = await situacaoDaCota(ctx, tenant);` depois do `situacaoDoWhatsapp`.

Em `src/app/painel/page.tsx`, depois do alerta de WhatsApp desconectado (só com WhatsApp ligado):

```tsx
        {whatsapp.ligado && cota.nivel === 'aviso' && <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">{MSG_COTA.aviso}</p>}
        {whatsapp.ligado && cota.nivel === 'esgotada' && <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{MSG_COTA.esgotada}</p>}
```

com `const cota = await situacaoDaCota(ctx, tenant);` antes do `return`.

- [ ] **Step 4: Métricas do admin** — `pnpm drizzle-kit generate --custom --name metricas_agenda` e preencher `drizzle/0058_metricas_agenda.sql`

```sql
-- §3: o admin passa a ver consultas e WhatsApps do mês (só contagens). Mesmo corpo da 0017, trocando os NULL.
-- Mês civil no fuso de cada tenant (RN-09). Variáveis com prefixo v_ (#variable_conflict use_column: "inicio" é coluna).
CREATE OR REPLACE FUNCTION admin_tenant_metrics()
RETURNS TABLE (
  tenant_id uuid,
  arquivos bigint,
  armazenamento_bytes bigint,
  pacientes_ativos bigint,
  consultas_mes bigint,
  mensagens_whatsapp_mes bigint
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  t record;
  v_inicio_mes timestamptz;
  v_fim_mes timestamptz;
BEGIN
  IF coalesce(current_setting('app.tenant_id', true), '') <> '' THEN
    RAISE EXCEPTION 'admin_tenant_metrics() não pode rodar dentro de withTenant (contexto app.* de um tenant ativo)'
      USING ERRCODE = '55000';
  END IF;
  FOR t IN SELECT tn.id, tn.armazenamento_bytes AS bytes, tn.fuso FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    v_inicio_mes := date_trunc('month', now() AT TIME ZONE t.fuso) AT TIME ZONE t.fuso;
    v_fim_mes := (date_trunc('month', now() AT TIME ZONE t.fuso) + interval '1 month') AT TIME ZONE t.fuso;
    tenant_id := t.id;
    armazenamento_bytes := t.bytes;
    SELECT count(*) INTO arquivos FROM public.stored_files sf WHERE sf.tenant_id = t.id;
    SELECT count(*) INTO pacientes_ativos FROM public.patients p WHERE p.tenant_id = t.id AND p.status = 'ativo';
    SELECT count(*) INTO consultas_mes FROM public.appointments a
      WHERE a.tenant_id = t.id AND a.status <> 'cancelada' AND a.inicio >= v_inicio_mes AND a.inicio < v_fim_mes;
    SELECT count(*) INTO mensagens_whatsapp_mes FROM public.notifications n
      WHERE n.tenant_id = t.id AND n.canal = 'whatsapp' AND n.tipo IN ('lembrete_24h', 'lembrete_2h', 'convite_paciente')
        AND n.enviada_em >= v_inicio_mes AND n.enviada_em < v_fim_mes;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
```

Em `src/modules/plataforma/metricas.test.ts`, o primeiro teste passa a esperar `consultasMes: 0, mensagensWhatsappMes: 0`, e um teste novo:

```ts
  it('conta consultas não canceladas e WhatsApps aceitos do mês do tenant (Plano 05)', async () => {
    const t = await tenantComArquivos(0, 0);
    const p = randomUUID();
    await withTenant({ tenantId: t, role: 'nutri' }, async (tx) => {
      await tx.execute(sql`insert into patients (id, tenant_id, nome, data_nascimento, sexo, email) values (${p}, ${t}, 'M', '1990-01-01', 'F', ${`m-${p}@t.dev`})`);
      // início do mês corrente no fuso do tenant + 1 dia: sempre dentro do mês, a qualquer hora que o teste rode
      const dia = sql`(date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo' + interval '1 day')`;
      await tx.execute(sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem) values (${t}, ${p}, ${dia}, ${dia} + interval '1 hour', 'presencial', 'nutri')`);
      await tx.execute(sql`insert into appointments (tenant_id, patient_id, inicio, fim, modalidade, origem, status, cancelado_por, cancelada_em) values (${t}, ${p}, ${dia} + interval '2 hours', ${dia} + interval '3 hours', 'presencial', 'nutri', 'cancelada', 'nutri', now())`);
      await tx.execute(sql`insert into notifications (tenant_id, patient_id, canal, tipo, status, agendada_para, enviada_em) values (${t}, ${p}, 'whatsapp', 'convite_paciente', 'enviada', now(), now()), (${t}, ${p}, 'whatsapp', 'resposta_confirmacao', 'enviada', now(), now())`);
    }, app.db);
    expect((await metricasPorTenant(app.db)).get(t)).toMatchObject({ consultasMes: 1, mensagensWhatsappMes: 1 });
  });
```

Run: `pnpm test src/modules/plataforma/metricas.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/notificacoes drizzle/0058_metricas_agenda.sql drizzle/meta src/email src/app/painel src/modules/plataforma/metricas.test.ts
git commit -m "feat(whatsapp): cota mensal por tenant com aviso de 80%, bloqueio a 100% e métricas do admin (RN-09, US-036)"
```

---
### Task 12: Webhook do WhatsApp — JWT, status de entrega, resposta "1"/"2", conexão, idempotência (P05-08)

**Files:**
- Create: `src/modules/notificacoes/whatsapp/respostas.ts`, `src/modules/notificacoes/whatsapp/respostas.test.ts`, `src/modules/notificacoes/whatsapp/webhook.ts`, `src/modules/notificacoes/whatsapp/webhook.test.ts`, `src/app/api/webhooks/whatsapp/route.ts`, `e2e/whatsapp.ts`
- Modify: `src/modules/notificacoes/whatsapp/jwt.ts` e `jwt.test.ts` (da Tarefa 9), `src/modules/agenda/limite-ip.ts` e `limite-ip.test.ts` (marca anti-repetição), `src/modules/notificacoes/enviar.ts` (exporta `fallbackPorEmail`), `src/jobs/queues.ts`, `src/worker/index.ts`, `e2e/agenda.spec.ts`

**Interfaces:**
- Consumes: `tenantDaInstancia`, `atualizarEstadoConexao` (Tarefa 9); `chaveDoWebhook` (Tarefa 9); `digitosDoJid`, `e164DoJid`, `type EstadoConexao` (Tarefa 9); `confirmarPresenca`, `pedirRemarcacao` (Tarefa 7); `dispararEnvio` (Tarefa 5); `aoFalhar` de `enviar.ts` (Tarefa 5, exportado aqui como `fallbackPorEmail`); `chaveDoLimite`, `consumirLimite` (Tarefa 8); `buscarTenant`, `buscarTenantPorSlug` (E2E); `sealSecret`, `openSecret`; `lerCorpoLimitado`, `CorpoGrandeError`; `getBoss`; `logger`.
- Produces:
  - `@/modules/notificacoes/whatsapp/jwt` (acrescenta à Tarefa 9): `type VerificacaoJwt`, `verificarJwtWebhook(token, chave, agora): VerificacaoJwt` (a `chave` é a da instância: `chaveDoWebhook(segredo, instância)`), `assinarJwtWebhook(chave, agora, extra?): string` (testes e E2E).
  - `@/modules/agenda/limite-ip`: `chaveDoLimite` aceita o tipo `'webhook'`; `liberarLimite(db, chave): Promise<void>`.
  - `@/modules/notificacoes/whatsapp/respostas`: `type Intencao = 'confirmar' | 'remarcar'`, `interpretarResposta(texto: string): Intencao | null`.
  - `@/modules/notificacoes/whatsapp/webhook`: `type EventoWhatsapp`, `classificarEvento(corpo: unknown): EventoWhatsapp | null` (`connection.update` com `data.instance` de outra instância → `null`), `FINALIDADE_EVENTO = 'whatsapp-evento'`, `REPETICAO_S = 660`, `enfileirarEventoWhatsapp(ev): Promise<void>`, `receberWebhook(req, o: { segredo: string | undefined; agora?: Date; db?: Db; enfileirar: (ev: EventoWhatsapp) => Promise<void> }): Promise<Response>`, `processarEventoWhatsapp(ev, deps: { db?; agora?; appUrl? }): Promise<void>`.
  - `POST /api/webhooks/whatsapp` (sem segredo configurado: 404; sem `Bearer`: 401; > 256 KB: 413; JSON inválido: 400; instância fora do formato, JWT que não é o da instância do corpo, expirado ou pedido repetido: 401; senão 200 `{ ok: true }` em ≤ 2 s).
  - `e2e/whatsapp.ts`: `idDoTenant(slug)` (por `buscarTenantPorSlug`), `webhookAssinado(request, corpo)` (JWT com a chave da instância do corpo).
  - Fila `whatsapp-evento` (payload cifrado).

- [ ] **Step 1: JWT e respostas (puros)** — testes

`src/modules/notificacoes/whatsapp/jwt.test.ts` (o import passa a `import { assinarJwtWebhook, chaveDoWebhook, verificarJwtWebhook } from './jwt';`; acrescentar, depois do `describe` da Tarefa 9):

```ts
const S = 'segredo-do-webhook-com-pelo-menos-32-caracteres';
const agora = new Date('2026-10-16T12:00:00Z');

describe('JWT do webhook da Evolution (D4)', () => {
  it('aceita o JWT HS256 do jwt_key (iat, exp = iat + 600, app/action da Evolution)', () => {
    expect(verificarJwtWebhook(assinarJwtWebhook(S, agora), S, agora)).toEqual({ ok: true });
  });
  it('recusa outro segredo, assinatura trocada, alg "none", expirado, emissor errado e lixo', () => {
    const t = assinarJwtWebhook(S, agora);
    expect(verificarJwtWebhook(t, `${S}x`, agora)).toEqual({ ok: false, motivo: 'assinatura' });
    expect(verificarJwtWebhook(`${t.slice(0, -2)}${t.endsWith('AA') ? 'BB' : 'AA'}`, S, agora)).toEqual({ ok: false, motivo: 'assinatura' });
    const [, p] = t.split('.');
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${p}.`;
    expect(verificarJwtWebhook(none, S, agora).ok).toBe(false);
    const hs512 = `${Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64url')}.${p}.${t.split('.')[2]}`;
    expect(verificarJwtWebhook(hs512, S, agora)).toEqual({ ok: false, motivo: 'algoritmo' });
    expect(verificarJwtWebhook(t, S, new Date(agora.getTime() + 12 * 60_000))).toEqual({ ok: false, motivo: 'expirado' });
    expect(verificarJwtWebhook(assinarJwtWebhook(S, agora, { app: 'outro' }), S, agora)).toEqual({ ok: false, motivo: 'emissor' });
    expect(verificarJwtWebhook('x.y', S, agora)).toEqual({ ok: false, motivo: 'formato' });
  });
  it('D4 (a): o JWT assinado com a chave de uma instância não vale com a de outra, nem com o segredo-mestre', () => {
    const [a, b] = ['nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f', 'nd-1c7e4d2f-9b8e-4d3c-8a21-2b3c4d5e6f70'].map((i) => chaveDoWebhook(S, i));
    const t = assinarJwtWebhook(a, agora);
    expect(verificarJwtWebhook(t, a, agora)).toEqual({ ok: true });
    expect(verificarJwtWebhook(t, b, agora)).toEqual({ ok: false, motivo: 'assinatura' });
    expect(verificarJwtWebhook(assinarJwtWebhook(S, agora), a, agora)).toEqual({ ok: false, motivo: 'assinatura' });
  });
});
```

`src/modules/notificacoes/whatsapp/respostas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { interpretarResposta } from './respostas';

describe('resposta do paciente (D3)', () => {
  it('"1", "sim", "confirmo" → confirmar; "2", "preciso remarcar", "não posso" → remarcar (sem acento, maiúscula, pontuação, emoji)', () => {
    expect(['1', ' 1 ', '1.', 'Sim!', 'CONFIRMO 👍', 'Confirmado'].map(interpretarResposta)).toEqual(Array(6).fill('confirmar'));
    expect(['2', 'Preciso remarcar', 'não posso', 'Não vou poder.'].map(interpretarResposta)).toEqual(Array(4).fill('remarcar'));
  });
  it('qualquer outra coisa é ignorada (a nutricionista lê no próprio WhatsApp)', () => {
    expect(['12', 'oi', '1 2', 'sim, mas atraso 10 min', '', 'x'.repeat(61)].map(interpretarResposta)).toEqual(Array(6).fill(null));
  });
});
```

Run: `pnpm test src/modules/notificacoes/whatsapp/jwt.test.ts src/modules/notificacoes/whatsapp/respostas.test.ts` → FAIL.

`src/modules/notificacoes/whatsapp/jwt.ts` (o import da Tarefa 9 passa a `import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';`; `chaveDoWebhook` continua igual; acrescentar):

```ts

export type VerificacaoJwt = { ok: true } | { ok: false; motivo: 'formato' | 'algoritmo' | 'assinatura' | 'expirado' | 'emissor' };

const json = (s: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * D4: o `jwt_key` do webhook da instância (Evolution v2.3+) vira `Authorization: Bearer <JWT HS256>` com
 * { iat, exp: iat + 600, app: 'evolution', action: 'webhook' }. Só HS256 (nada de "none" nem RS*), assinatura
 * comparada em tempo constante, exp com 60 s de folga de relógio, iat não muito no futuro e validade máxima de 15 min.
 * `chave` = `chaveDoWebhook(segredo, instância)` — a da instância que o corpo diz ser (D4 a).
 */
export function verificarJwtWebhook(token: string, chave: string, agora: Date): VerificacaoJwt {
  const partes = token.split('.');
  if (token.length > 2048 || partes.length !== 3 || partes.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, motivo: 'formato' };
  const [h, p, s] = partes;
  if (json(h)?.alg !== 'HS256') return { ok: false, motivo: 'algoritmo' };
  const esperado = createHmac('sha256', Buffer.from(chave, 'utf8')).update(`${h}.${p}`).digest();
  const recebido = Buffer.from(s, 'base64url');
  if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) return { ok: false, motivo: 'assinatura' };
  const c = json(p);
  if (!c || typeof c.exp !== 'number' || typeof c.iat !== 'number') return { ok: false, motivo: 'formato' };
  const seg = Math.floor(agora.getTime() / 1000);
  if (c.exp + 60 < seg || c.iat - 60 > seg || c.exp - c.iat > 900) return { ok: false, motivo: 'expirado' };
  if (c.app !== 'evolution' || c.action !== 'webhook') return { ok: false, motivo: 'emissor' };
  return { ok: true };
}

/** Testes e E2E: o mesmo JWT que a Evolution gera com o `jwt_key` da instância (jsonwebtoken.sign, HS256). */
export function assinarJwtWebhook(chave: string, agora: Date, extra: Record<string, unknown> = {}): string {
  const iat = Math.floor(agora.getTime() / 1000);
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const corpo = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ iat, exp: iat + 600, app: 'evolution', action: 'webhook', ...extra })}`;
  return `${corpo}.${createHmac('sha256', Buffer.from(chave, 'utf8')).update(corpo).digest('base64url')}`;
}
```

`src/modules/notificacoes/whatsapp/respostas.ts`:

```ts
export type Intencao = 'confirmar' | 'remarcar';

const CONFIRMAR = new Set(['1', 'sim', 'confirmo', 'confirmar', 'confirmado', 'confirmada', 'ok']);
const REMARCAR = new Set(['2', 'remarcar', 'preciso remarcar', 'quero remarcar', 'nao posso', 'nao vou poder']);

/** D3: só respostas curtas e inequívocas; o resto (inclusive "sim, mas atraso") fica para a nutricionista ler. */
export function interpretarResposta(texto: string): Intencao | null {
  if (texto.length > 60) return null;
  const t = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (CONFIRMAR.has(t)) return 'confirmar';
  if (REMARCAR.has(t)) return 'remarcar';
  return null;
}
```

Run: `pnpm test src/modules/notificacoes/whatsapp` → PASS.

- [ ] **Step 2: Testes do webhook (falham)** — `src/modules/notificacoes/whatsapp/webhook.test.ts`

```ts
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em } from '../../../../test/agenda';
import { makeDb } from '../../../../test/db';
import { emailsNaFila, novoPaciente, novoTenant, type TenantDeTeste } from '../../../../test/pacientes';
import { conexaoDeTeste } from '../../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { appointments, notifications, user, whatsappConexoes } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { assinarJwtWebhook, chaveDoWebhook } from './jwt';
import { classificarEvento, processarEventoWhatsapp, receberWebhook, type EventoWhatsapp } from './webhook';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const JID = '5511912345678@s.whatsapp.net';
const agora = em('2026-10-15', '15:00');
const deps = { db: app.db, agora, appUrl: 'http://localhost:3000' };
const upsert = (instance: string, texto: string, extra: Record<string, unknown> = {}) => ({
  event: 'messages.upsert', instance, apikey: null,
  data: { key: { remoteJid: JID, fromMe: false, id: `IN-${Math.random()}` }, pushName: 'Ana', message: { conversation: texto }, messageType: 'conversation', ...extra },
});

/** Consulta futura com o lembrete de 24 h já enviado por WhatsApp para JID. */
async function lembreteEnviado(T: TenantDeTeste, inicio = em('2026-10-16', '14:00'), msgId = `WA-${Math.random()}`) {
  await conexaoDeTeste(app.db, T.ctx, 'conectada');
  const p = await novoPaciente(app.db, T.ctx, { nome: 'Ana Souza', telefoneE164: '+5511912345678', whatsappOptinEm: agora, whatsappOptinOrigem: 'nutri' });
  const c = await consultaDireta(app.db, T.ctx, p.id, inicio);
  await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: p.id, appointmentId: c, inicioConsulta: inicio, canal: 'whatsapp', tipo: 'lembrete_24h', status: 'enviada', providerMsgId: msgId, providerJid: JID, agendadaPara: em('2026-10-15', '14:00'), enviadaEm: em('2026-10-15', '14:00') }), app.db);
  return { p, c, msgId };
}
const consulta = async (T: TenantDeTeste, id: string) => (await withTenant(T.ctx, (tx) => tx.select().from(appointments).where(eq(appointments.id, id)), app.db))[0];
const respostas = (T: TenantDeTeste, id: string) => withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.canal, 'whatsapp'))), app.db);
const processar = async (corpo: unknown) => {
  const ev = classificarEvento(corpo);
  if (ev) await processarEventoWhatsapp(ev, deps);
  return ev;
};

describe('classificarEvento (D5: o texto nunca sai da rota)', () => {
  const inst = 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';
  it('resposta "1" vira intenção, sem o texto; o resto é descartado', () => {
    const ev = classificarEvento(upsert(inst, ' 1 ', { contextInfo: { stanzaId: 'WA9' } }))!;
    expect(ev).toMatchObject({ tipo: 'resposta', instancia: inst, de: '5511912345678', citado: 'WA9', intencao: 'confirmar' });
    expect(JSON.stringify(ev)).not.toContain('conversation');
    expect(classificarEvento(upsert(inst, 'Oi, tudo bem?'))).toBeNull();
    expect(classificarEvento({ ...upsert(inst, '1'), data: { ...upsert(inst, '1').data, key: { remoteJid: '1203@g.us', fromMe: false, id: 'g' } } })).toBeNull();
    expect(classificarEvento({ ...upsert(inst, '1'), data: { ...upsert(inst, '1').data, key: { remoteJid: JID, fromMe: true, id: 'm' } } })).toBeNull();
    expect(classificarEvento(upsert('outra-instancia', '1'))).toBeNull();
    expect(classificarEvento({ event: 'chats.update', instance: inst, data: {} })).toBeNull();
    expect(classificarEvento('lixo')).toBeNull();
  });
  it('status de entrega/leitura/erro das mensagens enviadas; conexão com o número', () => {
    expect(classificarEvento({ event: 'messages.update', instance: inst, data: { keyId: 'WA1', remoteJid: JID, fromMe: true, status: 'DELIVERY_ACK' } })).toEqual({ tipo: 'status', instancia: inst, id: 'WA1', status: 'entregue' });
    expect(classificarEvento({ event: 'messages.update', instance: inst, data: { keyId: 'WA1', fromMe: true, status: 'READ' } })).toMatchObject({ status: 'lida' });
    expect(classificarEvento({ event: 'messages.update', instance: inst, data: { keyId: 'WA1', fromMe: true, status: 'SERVER_ACK' } })).toBeNull();
    expect(classificarEvento({ event: 'connection.update', instance: inst, data: { instance: inst, state: 'open', wuid: JID } })).toEqual({ tipo: 'conexao', instancia: inst, estado: 'conectada', numero: '+5511912345678' });
    expect(classificarEvento({ event: 'connection.update', instance: inst, data: { state: 'close', statusReason: 401 } })).toMatchObject({ estado: 'desconectada', numero: null });
    // D4 (a): número só para a própria instância — `data.instance` de outra instância é descartado
    expect(classificarEvento({ event: 'connection.update', instance: inst, data: { instance: 'nd-1c7e4d2f-9b8e-4d3c-8a21-2b3c4d5e6f70', state: 'open', wuid: JID } })).toBeNull();
  });
});

describe('processarEventoWhatsapp (US-035)', () => {
  it('"1": consulta "confirmada" via WhatsApp e uma resposta "Presença confirmada"; repetido não muda nada nem responde de novo', async () => {
    const T = await novoTenant(app.db);
    const { c } = await lembreteEnviado(T);
    const corpo = upsert(`nd-${T.tenantId}`, '1');
    await processar(corpo);
    await processar(corpo); // a Evolution reenviou
    expect(await consulta(T, c)).toMatchObject({ status: 'confirmada', confirmadaVia: 'whatsapp' });
    expect((await respostas(T, c)).filter((n) => n.tipo === 'resposta_confirmacao')).toHaveLength(1);
  });

  it('"2": pedido de remarcação, aviso à nutricionista (uma vez) e resposta com o link', async () => {
    const T = await novoTenant(app.db);
    const { c } = await lembreteEnviado(T);
    await processar(upsert(`nd-${T.tenantId}`, 'Preciso remarcar'));
    await processar(upsert(`nd-${T.tenantId}`, '2'));
    expect((await consulta(T, c)).pedidoRemarcacaoEm).toEqual(agora);
    expect((await respostas(T, c)).filter((n) => n.tipo === 'resposta_remarcar')).toHaveLength(1);
    const [nutri] = await app.db.select({ email: user.email }).from(user).where(eq(user.id, T.nutriId));
    expect((await emailsNaFila('aviso_agenda', nutri.email)).filter((m) => m.evento === 'pedido_remarcacao')).toHaveLength(1);
  });

  it('resposta citando a mensagem escolhe aquela consulta; sem citação, a do lembrete mais recente', async () => {
    const T = await novoTenant(app.db);
    const a = await lembreteEnviado(T, em('2026-10-16', '09:00'), 'WA-A');
    await withTenant(T.ctx, (tx) => tx.update(notifications).set({ enviadaEm: em('2026-10-15', '09:00') }).where(eq(notifications.providerMsgId, 'WA-A')), app.db);
    const c2 = await consultaDireta(app.db, T.ctx, a.p.id, em('2026-10-16', '16:00'));
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: a.p.id, appointmentId: c2, inicioConsulta: em('2026-10-16', '16:00'), canal: 'whatsapp', tipo: 'lembrete_24h', status: 'lida', providerMsgId: 'WA-B', providerJid: JID, agendadaPara: em('2026-10-15', '14:00'), enviadaEm: em('2026-10-15', '14:00') }), app.db);
    await processar(upsert(`nd-${T.tenantId}`, '1', { contextInfo: { stanzaId: 'WA-A' } }));
    expect((await consulta(T, a.c)).status).toBe('confirmada');
    expect((await consulta(T, c2)).status).toBe('agendada');
    await processar(upsert(`nd-${T.tenantId}`, '1'));
    expect((await consulta(T, c2)).status).toBe('confirmada');
  });

  it('depois de "Alterar data e hora", "1" ou "2" ao lembrete do horário antigo não muda a consulta nem responde (D17)', async () => {
    const T = await novoTenant(app.db);
    const { c } = await lembreteEnviado(T, em('2026-10-16', '14:00'), 'WA-VELHO');
    // a nutricionista moveu a consulta depois do envio: a linha enviada continua com inicio_consulta = 16/10 14:00
    await withTenant(T.ctx, (tx) => tx.update(appointments).set({ inicio: em('2026-10-18', '10:00'), fim: em('2026-10-18', '10:50') }).where(eq(appointments.id, c)), app.db);
    await processar(upsert(`nd-${T.tenantId}`, '1'));
    await processar(upsert(`nd-${T.tenantId}`, '2', { contextInfo: { stanzaId: 'WA-VELHO' } }));
    expect(await consulta(T, c)).toMatchObject({ status: 'agendada', confirmadaVia: null, pedidoRemarcacaoEm: null });
    expect((await respostas(T, c)).filter((n) => n.tipo !== 'lembrete_24h')).toHaveLength(0);
  });

  it('nada muda: outro número, lembrete de mais de 26 h, consulta já começada, tenant sem a consulta', async () => {
    const T = await novoTenant(app.db);
    const { c } = await lembreteEnviado(T);
    const inst = `nd-${T.tenantId}`;
    await processar({ ...upsert(inst, '1'), data: { ...upsert(inst, '1').data, key: { remoteJid: '5511988887777@s.whatsapp.net', fromMe: false, id: 'x1' } } });
    expect((await consulta(T, c)).status).toBe('agendada');
    await processarEventoWhatsapp(classificarEvento(upsert(inst, '1'))!, { ...deps, agora: em('2026-10-16', '17:00') }); // > 26 h e depois do início
    expect((await consulta(T, c)).status).toBe('agendada');
    const U = await novoTenant(app.db);
    await processar(upsert(`nd-${U.tenantId}`, '1'));
    expect((await consulta(T, c)).status).toBe('agendada');
  });

  it('status: só avança (enviada → entregue → lida); ERROR de lembrete enviado vira "falhou" e o e-mail que tinha falhado volta', async () => {
    const T = await novoTenant(app.db);
    const { c, msgId } = await lembreteEnviado(T);
    const inst = `nd-${T.tenantId}`;
    const st = (status: string) => processar({ event: 'messages.update', instance: inst, data: { keyId: msgId, fromMe: true, status } });
    await st('DELIVERY_ACK');
    await st('READ');
    await st('DELIVERY_ACK'); // fora de ordem
    expect((await respostas(T, c)).find((n) => n.tipo === 'lembrete_24h')?.status).toBe('lida');
    const o = await lembreteEnviado(T, em('2026-10-17', '14:00'), 'WA-ERR');
    await withTenant(T.ctx, (tx) => tx.insert(notifications).values({ tenantId: T.tenantId, patientId: o.p.id, appointmentId: o.c, inicioConsulta: em('2026-10-17', '14:00'), canal: 'email', tipo: 'lembrete_24h', status: 'falhou', erro: 'email', agendadaPara: agora }), app.db);
    await processar({ event: 'messages.update', instance: inst, data: { keyId: 'WA-ERR', fromMe: true, status: 'ERROR' } });
    const ns = await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(eq(notifications.appointmentId, o.c)), app.db);
    expect(ns.find((n) => n.canal === 'whatsapp')).toMatchObject({ status: 'falhou', erro: 'erro_entrega' });
    expect(ns.find((n) => n.canal === 'email')).toMatchObject({ status: 'pendente' });
  });

  it('conexão: "open" grava "conectada" e o número', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectando');
    await processar({ event: 'connection.update', instance: `nd-${T.tenantId}`, data: { state: 'open', wuid: JID } });
    const [cx] = await withTenant(T.ctx, (tx) => tx.select().from(whatsappConexoes), app.db);
    expect(cx).toMatchObject({ estado: 'conectada', numeroE164: '+5511912345678' });
  });
});

describe('receberWebhook (D4, D5)', () => {
  const S = 's'.repeat(40);
  const A = 'nd-0b6f3c1e-8a7d-4c2b-9f10-1a2b3c4d5e6f';
  const B = 'nd-1c7e4d2f-9b8e-4d3c-8a21-2b3c4d5e6f70';
  const jwtDe = (instancia: string) => assinarJwtWebhook(chaveDoWebhook(S, instancia), new Date());
  const req = (corpo: string, token?: string) => new Request('http://localhost/api/webhooks/whatsapp', { method: 'POST', body: corpo, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const fila: EventoWhatsapp[] = [];
  const o = { segredo: S, db: app.db, enfileirar: async (ev: EventoWhatsapp) => void fila.push(ev) };

  it('sem segredo: 404; sem JWT: 401 sem enfileirar; > 256 KB: 413; JSON inválido: 400; válido: 200 e enfileira só o evento reduzido', async () => {
    fila.length = 0;
    const corpo = JSON.stringify(upsert(A, '1'));
    expect((await receberWebhook(req(corpo), { ...o, segredo: undefined })).status).toBe(404);
    expect((await receberWebhook(req(corpo), o)).status).toBe(401);
    expect(fila).toEqual([]);
    expect((await receberWebhook(req(JSON.stringify({ x: 'y'.repeat(300 * 1024) }), jwtDe(A)), o)).status).toBe(413);
    expect((await receberWebhook(req('{x', jwtDe(A)), o)).status).toBe(400);
    const ok = await receberWebhook(req(corpo, jwtDe(A)), o);
    expect(ok.status).toBe(200);
    expect(fila).toHaveLength(1);
    expect(await (await receberWebhook(req(JSON.stringify({ event: 'chats.update', instance: A, data: {} }), jwtDe(A)), o)).json()).toEqual({ ok: true });
    expect(fila).toHaveLength(1);
  });

  it('D4 (a): JWT da instância de outro consultório, do segredo-mestre (sem a chave da instância) ou corpo sem instância válida → 401 sem enfileirar', async () => {
    fila.length = 0;
    expect((await receberWebhook(req(JSON.stringify(upsert(B, '1')), jwtDe(A)), o)).status).toBe(401); // corpo de B com o JWT de A
    expect((await receberWebhook(req(JSON.stringify(upsert(A, '1')), assinarJwtWebhook(S, new Date())), o)).status).toBe(401);
    expect((await receberWebhook(req(JSON.stringify(upsert('outra-instancia', '1')), jwtDe('outra-instancia')), o)).status).toBe(401);
    expect(fila).toEqual([]);
  });

  it('D4 (b): o mesmo pedido (JWT + corpo) repetido → 401; outro evento no mesmo segundo, com o mesmo JWT, passa; se enfileirar falhar, a repetição da Evolution passa', async () => {
    fila.length = 0;
    const t = jwtDe(A);
    const um = JSON.stringify(upsert(A, '1'));
    expect((await receberWebhook(req(um, t), o)).status).toBe(200);
    expect((await receberWebhook(req(um, t), o)).status).toBe(401);
    expect((await receberWebhook(req(JSON.stringify(upsert(A, '2')), t), o)).status).toBe(200); // o JWT da Evolution é o mesmo no mesmo segundo
    expect(fila).toHaveLength(2);
    const outro = JSON.stringify(upsert(A, 'sim'));
    await expect(receberWebhook(req(outro, t), { ...o, enfileirar: async () => { throw new Error('fila fora do ar'); } })).rejects.toThrow('fila fora do ar');
    expect((await receberWebhook(req(outro, t), o)).status).toBe(200);
    expect(fila).toHaveLength(3);
  });
});
```

Em `src/modules/agenda/limite-ip.test.ts` (import `liberarLimite`):

```ts
  it('D4 (b), rodada 1: marca de uma vez só (webhook) — a 2ª é recusada; liberar apaga a marca', async () => {
    const chave = chaveDoLimite('webhook', `jwt.${Date.now()}.${Math.random()}`);
    const t0 = new Date('2026-10-16T12:00:00Z');
    expect(await consumirLimite(app.db, chave, 1, 660, t0)).toBe(true);
    expect(await consumirLimite(app.db, chave, 1, 660, t0)).toBe(false);
    await liberarLimite(app.db, chave);
    expect(await consumirLimite(app.db, chave, 1, 660, t0)).toBe(true);
  });
```

Run: `pnpm test src/modules/notificacoes/whatsapp/webhook.test.ts src/modules/agenda/limite-ip.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — em `src/modules/notificacoes/enviar.ts`, renomeie `aoFalhar` para `fallbackPorEmail` e exporte (`export async function fallbackPorEmail(tx: Tx, n: NotificationRow, agora: Date)`), trocando as duas chamadas. Depois, `src/modules/notificacoes/whatsapp/webhook.ts`:

```ts
import { createHash } from 'node:crypto';
import { and, desc, eq, gt, gte, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments, notifications } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { getBoss } from '@/jobs/boss';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { sealSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { confirmarPresenca, pedirRemarcacao } from '@/modules/agenda/cancelamento';
import { chaveDoLimite, consumirLimite, liberarLimite } from '@/modules/agenda/limite-ip';
import { buscarTenant } from '@/modules/plataforma/tenant-status';
import { dispararEnvio } from '../agendar';
import { fallbackPorEmail } from '../enviar';
import { atualizarEstadoConexao, tenantDaInstancia } from './conexao';
import { chaveDoWebhook, verificarJwtWebhook } from './jwt';
import { digitosDoJid, e164DoJid, type EstadoConexao } from './provedor';
import { interpretarResposta, type Intencao } from './respostas';

export const FINALIDADE_EVENTO = 'whatsapp-evento';
const LIMITE_CORPO = 256 * 1024;
/** D4 (b): a marca anti-repetição vale o tempo de vida do JWT (exp 600 s) + a folga de relógio (60 s). */
export const REPETICAO_S = 660;
/** Uma resposta "1"/"2" vale para o lembrete enviado àquele número nas últimas 26 h (24 h + folga). */
const JANELA_RESPOSTA_MS = 26 * 3_600_000;

/** D5: o mínimo que sai da rota — nunca o texto que o paciente digitou. */
export type EventoWhatsapp =
  | { tipo: 'resposta'; instancia: string; de: string; id: string; citado: string | null; intencao: Intencao }
  | { tipo: 'status'; instancia: string; id: string; status: 'entregue' | 'lida' | 'falhou' }
  | { tipo: 'conexao'; instancia: string; estado: EstadoConexao; numero: string | null };

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Eventos `messages.upsert`, `messages.update` e `connection.update` da Evolution v2 (corpo `{ event, instance, data }`). */
export function classificarEvento(corpo: unknown): EventoWhatsapp | null {
  const c = obj(corpo);
  const d = obj(c?.data);
  const instancia = c?.instance;
  if (!c || !d || typeof instancia !== 'string' || !tenantDaInstancia(instancia)) return null;
  if (c.event === 'messages.upsert') {
    const key = obj(d.key);
    if (!key || key.fromMe !== false || typeof key.id !== 'string' || typeof key.remoteJid !== 'string' || !key.remoteJid.endsWith('@s.whatsapp.net')) return null; // grupos, status, @lid sem número
    const texto = obj(d.message)?.conversation;
    const intencao = typeof texto === 'string' ? interpretarResposta(texto) : null;
    if (!intencao) return null;
    const citado = obj(d.contextInfo)?.stanzaId;
    return { tipo: 'resposta', instancia, de: digitosDoJid(key.remoteJid), id: key.id, citado: typeof citado === 'string' ? citado : null, intencao };
  }
  if (c.event === 'messages.update') {
    if (d.fromMe !== true || typeof d.keyId !== 'string') return null;
    const status = d.status === 'DELIVERY_ACK' ? 'entregue' : d.status === 'READ' || d.status === 'PLAYED' ? 'lida' : d.status === 'ERROR' ? 'falhou' : null;
    return status ? { tipo: 'status', instancia, id: d.keyId, status } : null;
  }
  if (c.event === 'connection.update') {
    // D4 (a): o número só vale para a própria instância (a do corpo, já amarrada ao JWT); `data.instance` de outra → descarta
    if (d.instance !== undefined && d.instance !== instancia) return null;
    const estado = d.state === 'open' ? 'conectada' : d.state === 'connecting' ? 'conectando' : d.state === 'close' || d.state === 'refused' ? 'desconectada' : null;
    if (!estado) return null;
    return { tipo: 'conexao', instancia, estado, numero: typeof d.wuid === 'string' ? e164DoJid(d.wuid) : null };
  }
  return null;
}

export async function enfileirarEventoWhatsapp(ev: EventoWhatsapp): Promise<void> {
  const id = await (await getBoss()).send('whatsapp-evento', { selado: sealSecret(JSON.stringify(ev), FINALIDADE_EVENTO) });
  if (!id) throw new Error('A fila de eventos do WhatsApp recusou o evento');
}

const recusar = (motivo: string) => {
  logger.warn({ motivo }, 'webhook do WhatsApp recusado'); // só o motivo: nunca JWT, corpo ou instância
  return Response.json({ erro: 'Não autorizado.' }, { status: 401 });
};

/**
 * INT-01/D4/D5: exige o `Bearer`, lê no máximo 256 KB, confere o JWT com a chave da instância do corpo (a), recusa a
 * repetição do mesmo pedido (b), reduz e enfileira (cifrado); responde em ≤ 2 s. 401 não é repetido pela Evolution.
 * Nada do corpo vai para log (traz número, texto e o campo `apikey`).
 */
export async function receberWebhook(req: Request, o: { segredo: string | undefined; agora?: Date; db?: Db; enfileirar: (ev: EventoWhatsapp) => Promise<void> }): Promise<Response> {
  if (!o.segredo) return new Response(null, { status: 404 });
  const agora = o.agora ?? new Date();
  const m = /^Bearer ([A-Za-z0-9._-]+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m) return recusar('formato');
  let bruto: Buffer;
  let corpo: unknown;
  try {
    bruto = await lerCorpoLimitado(req, LIMITE_CORPO);
    corpo = JSON.parse(bruto.toString('utf8'));
  } catch (e) {
    if (e instanceof CorpoGrandeError) return Response.json({ erro: 'Grande demais.' }, { status: 413 });
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }
  // D4 (a): o JWT tem de ser o da instância que o corpo diz ser — um consultório não fala por outro
  const instancia = obj(corpo)?.instance;
  if (typeof instancia !== 'string' || !tenantDaInstancia(instancia)) return recusar('instancia');
  const v = verificarJwtWebhook(m[1], chaveDoWebhook(o.segredo, instancia), agora);
  if (!v.ok) return recusar(v.motivo);
  const ev = classificarEvento(corpo);
  if (!ev) return Response.json({ ok: true });
  // D4 (b): o mesmo pedido só vale uma vez. O JWT da Evolution não tem jti e é igual no mesmo segundo: a marca é JWT + corpo
  const db = o.db ?? getDb();
  const marca = chaveDoLimite('webhook', `${m[1]}.${createHash('sha256').update(bruto).digest('base64url')}`);
  if (!(await consumirLimite(db, marca, 1, REPETICAO_S, agora))) return recusar('repetido');
  try {
    await o.enfileirar(ev);
  } catch (e) {
    await liberarLimite(db, marca); // a Evolution repete o pedido (5xx) e ele precisa passar
    throw e;
  }
  return Response.json({ ok: true });
}

const RANK: Record<string, number> = { enviada: 1, entregue: 2, lida: 3 };

async function atualizarStatus(tenantId: string, ev: Extract<EventoWhatsapp, { tipo: 'status' }>, db: Db, agora: Date): Promise<void> {
  await withTenant(
    { tenantId, role: 'worker' },
    async (tx) => {
      const [n] = await tx.select().from(notifications).where(eq(notifications.providerMsgId, ev.id)).for('update');
      if (!n) return;
      if (ev.status === 'falhou') {
        if (n.status !== 'enviada') return; // entregue/lida não "desfalham"; repetido não faz nada
        const [f] = await tx.update(notifications).set({ status: 'falhou', erro: 'erro_entrega', updatedAt: agora }).where(eq(notifications.id, n.id)).returning();
        await fallbackPorEmail(tx, f, agora);
        return;
      }
      // D6: só avança (eventos fora de ordem e repetidos não voltam o estado)
      if ((RANK[ev.status] ?? 0) > (RANK[n.status] ?? 99)) await tx.update(notifications).set({ status: ev.status, updatedAt: agora }).where(eq(notifications.id, n.id));
    },
    db,
  );
}

/**
 * US-035: "1"/"2" vale para o lembrete de WhatsApp enviado àquele número (o `jid` que a Evolution devolveu no envio)
 * nas últimas 26 h, de consulta futura e ativa — o citado, se houver; senão o mais recente. A ação roda como o
 * próprio paciente (RLS por paciente) e a resposta é uma linha única por consulta (repetir não responde de novo).
 */
async function tratarResposta(tenantId: string, ev: Extract<EventoWhatsapp, { tipo: 'resposta' }>, db: Db, agora: Date, appUrl: string): Promise<void> {
  const tenant = await buscarTenant(db, tenantId);
  if (!tenant || tenant.status !== 'ativa') return; // RN-15
  const candidatos = await withTenant(
    { tenantId, role: 'worker' },
    (tx) =>
      tx
        .select({ msgId: notifications.providerMsgId, jid: notifications.providerJid, appointmentId: appointments.id, patientId: appointments.patientId, inicio: appointments.inicio })
        .from(notifications)
        .innerJoin(appointments, eq(appointments.id, notifications.appointmentId))
        .where(
          and(
            eq(notifications.canal, 'whatsapp'),
            inArray(notifications.tipo, ['lembrete_24h', 'lembrete_2h']),
            inArray(notifications.status, ['enviada', 'entregue', 'lida']),
            gte(notifications.enviadaEm, new Date(agora.getTime() - JANELA_RESPOSTA_MS)),
            inArray(appointments.status, ['agendada', 'confirmada']),
            gt(appointments.inicio, agora),
            // D17: o lembrete enviado é imutável — depois de "Alterar data e hora", responder ao lembrete do horário
            // antigo não pode confirmar/remarcar o horário novo (o paciente não recebeu o horário novo pelo WhatsApp)
            eq(notifications.inicioConsulta, appointments.inicio),
          ),
        )
        .orderBy(desc(notifications.enviadaEm)),
    db,
  );
  const doNumero = candidatos.filter((x) => x.jid && digitosDoJid(x.jid) === ev.de);
  const alvo = (ev.citado ? doNumero.find((x) => x.msgId === ev.citado) : undefined) ?? doNumero[0];
  if (!alvo) return;
  const comoPaciente: TenantContext = { tenantId, role: 'paciente', patientId: alvo.patientId };
  if (ev.intencao === 'confirmar') await confirmarPresenca(comoPaciente, alvo.appointmentId, 'whatsapp', { db, now: agora });
  else await pedirRemarcacao(comoPaciente, tenant, alvo.appointmentId, { db, now: agora, appUrl });
  await withTenant(
    comoPaciente,
    async (tx) => {
      const tipo = ev.intencao === 'confirmar' ? 'resposta_confirmacao' : 'resposta_remarcar';
      const novas = await tx
        .insert(notifications)
        // uma resposta por consulta e horário (UNIQUE com inicio_consulta, D6): repetir "1" não responde de novo
        .values({ tenantId, patientId: alvo.patientId, appointmentId: alvo.appointmentId, inicioConsulta: alvo.inicio, canal: 'whatsapp', tipo, agendadaPara: agora, createdAt: agora, updatedAt: agora })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      if (novas.length) await dispararEnvio(tx, tenantId);
    },
    db,
  );
}

/** Worker (fila whatsapp-evento): conexão, status e respostas, todos idempotentes (a Evolution repete eventos). */
export async function processarEventoWhatsapp(ev: EventoWhatsapp, deps: { db?: Db; agora?: Date; appUrl?: string } = {}): Promise<void> {
  const tenantId = tenantDaInstancia(ev.instancia);
  if (!tenantId) return;
  const db = deps.db ?? getDb();
  const agora = deps.agora ?? new Date();
  if (ev.tipo === 'conexao') await atualizarEstadoConexao(tenantId, { estado: ev.estado, numero: ev.numero ?? undefined }, { db, agora, appUrl: deps.appUrl });
  else if (ev.tipo === 'status') await atualizarStatus(tenantId, ev, db, agora);
  else await tratarResposta(tenantId, ev, db, agora, deps.appUrl ?? getEnv().APP_URL);
}
```

`src/modules/agenda/limite-ip.ts`: o tipo de `chaveDoLimite` passa a `'ip' | 'email-hora' | 'webhook'` e, no fim:

```ts
/** D4 (b): desfaz a marca quando o pedido não chegou a valer (a fila recusou) — a repetição da Evolution precisa passar. */
export async function liberarLimite(db: Db, chaveLimite: string): Promise<void> {
  await db.delete(publicRateLimits).where(eq(publicRateLimits.chave, chaveLimite));
}
```

(import `eq` de `drizzle-orm`, junto de `lt` e `sql`; o comentário de `publicRateLimits` passa a "contadores da página pública e marcas anti-repetição do webhook do WhatsApp").

Run: `pnpm test src/modules/notificacoes/whatsapp src/modules/agenda/limite-ip.test.ts` → PASS (webhook: 11 testes; limite: 3).

- [ ] **Step 4: Rota, fila e worker**

`src/app/api/webhooks/whatsapp/route.ts`:

```ts
import { getEnv } from '@/env';
import { enfileirarEventoWhatsapp, receberWebhook } from '@/modules/notificacoes/whatsapp/webhook';

export const dynamic = 'force-dynamic';

/** INT-01 (Evolution): sem sessão; autenticado pelo JWT do `jwt_key` (D4). O proxy não atua em /api. */
export function POST(req: Request) {
  return receberWebhook(req, { segredo: getEnv().EVOLUTION_WEBHOOK_SECRET, enfileirar: enfileirarEventoWhatsapp });
}
```

`src/jobs/queues.ts`: `// INT-01/D5: eventos do webhook (cifrados), processados em ordem de chegada; idempotentes` + `'whatsapp-evento': { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 60, deleteAfterSeconds: 86_400 },`.

`src/worker/index.ts` (imports `openSecret`; `FINALIDADE_EVENTO`, `processarEventoWhatsapp`, `type EventoWhatsapp`):

```ts
  // INT-01/D5: eventos do webhook do WhatsApp (conexão, status de entrega, resposta "1"/"2")
  await boss.work<{ selado: string }>('whatsapp-evento', async ([job]) => {
    const ev = JSON.parse(openSecret(job.data.selado, FINALIDADE_EVENTO)) as EventoWhatsapp;
    await processarEventoWhatsapp(ev, { db: getDb(), appUrl: env.APP_URL });
  });
```

- [ ] **Step 5: E2E** — `e2e/whatsapp.ts` (id do consultório e webhook assinado com a chave da instância); o teste usa o webhook assinado

`e2e/whatsapp.ts` (o Playwright resolve o `@/` pelo `paths` do `tsconfig.json`; `jwt.ts` só usa `node:crypto`):

```ts
import type { APIRequestContext } from '@playwright/test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@/db/schema';
import { assinarJwtWebhook, chaveDoWebhook } from '@/modules/notificacoes/whatsapp/jwt';
import { buscarTenantPorSlug } from '@/modules/plataforma/tenant-status';

const SEGREDO = process.env.EVOLUTION_WEBHOOK_SECRET ?? 'dev-webhook-secret-com-pelo-menos-32-caracteres';

/** Id do consultório do E2E — pela mesma função da plataforma (CLAUDE.md regra 1: `tenants` só por src/modules/plataforma). */
export async function idDoTenant(slug: string): Promise<string> {
  // CI: DATABASE_URL do job; local: o padrão do .env.example (o Playwright não lê o .env.local)
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://nutri_app:dev-app@localhost:54329/nutri', max: 1 });
  try {
    const t = await buscarTenantPorSlug(drizzle({ client: pool, schema }), slug);
    if (!t) throw new Error(`consultório ${slug} não existe (rode pnpm e2e:seed)`);
    return t.id;
  } finally {
    await pool.end();
  }
}

/** Simula a Evolution chamando o webhook do app (sandbox do E2E): JWT HS256 com o `jwt_key` da instância do corpo (D4 a). */
export async function webhookAssinado(request: APIRequestContext, corpo: { instance: string } & Record<string, unknown>) {
  const jwt = assinarJwtWebhook(chaveDoWebhook(SEGREDO, corpo.instance), new Date());
  return request.post('/api/webhooks/whatsapp', { data: corpo, headers: { authorization: `Bearer ${jwt}` } });
}
```

Em `e2e/agenda.spec.ts` (imports `webhookAssinado`, `idDoTenant` de `./whatsapp`), depois do teste da tela de conexão:

```ts
test('webhook do WhatsApp: sem JWT → 401; conexão "open" pela Evolution → "Conectado ao número" (D4)', async ({ request }) => {
  expect((await request.post('/api/webhooks/whatsapp', { data: { event: 'connection.update' } })).status()).toBe(401);
  const instancia = `nd-${await idDoTenant('e2e-consultorio')}`;
  const r = await webhookAssinado(request, { event: 'connection.update', instance: instancia, data: { instance: instancia, state: 'open', wuid: '5511900001111@s.whatsapp.net' } });
  expect(r.status()).toBe(200);
  await expect(async () => {
    await nutri.goto('/painel/whatsapp');
    await expect(nutri.getByText('Conectado ao número (11) 90000-1111.')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });
});
```

Run: `pnpm e2e:seed && pnpm test:e2e e2e/agenda.spec.ts`
Expected: PASS (7 testes).

- [ ] **Step 6: Commit**

```bash
git add src/modules/notificacoes src/modules/agenda/limite-ip.ts src/modules/agenda/limite-ip.test.ts src/app/api/webhooks src/jobs/queues.ts src/worker/index.ts e2e
git commit -m "feat(whatsapp): webhook com JWT por instância e sem repetição, status de entrega, resposta 1/2 e conexão, idempotentes (US-035, D4, D5)"
```

---
### Task 13: Envio de push (INT-03) — `web-push` com VAPID, limpeza de inscrições 404/410, exclusão LGPD (P05-10)

**Files:**
- Create: `drizzle/0059_push_subscriptions.sql` (gerada), `drizzle/0060_rls_push_subscriptions.sql` (custom), `src/modules/notificacoes/push.ts`, `src/modules/notificacoes/push.test.ts`
- Modify: `package.json` + `pnpm-lock.yaml` (`web-push`, `@types/web-push`), `src/db/schema/agenda.ts`, `src/db/audit-guard.ts`, `test/isolamento.test.ts`, `src/env.ts`, `src/env.test.ts`, `.env.example`, `src/modules/notificacoes/mensagens.ts`, `src/modules/notificacoes/enviar.ts`, `src/modules/notificacoes/enviar.test.ts`, `src/modules/notificacoes/enviar-whatsapp.test.ts`, `src/modules/notificacoes/whatsapp/cota.test.ts`, `src/worker/index.ts`, `src/modules/pacientes/lgpd.ts`, `src/modules/pacientes/lgpd.test.ts`

**Interfaces:**
- Consumes: `patients`, `tenants`; `dadosDaConsulta` (Tarefa 5); `ContextoEnvio`, `Resultado`, `DepsEnvio`, `CANAIS_ENVIO` (Tarefa 5).
- Produces:
  - Schema: `pushSubscriptions` 🔒 (RLS por paciente; `UNIQUE (tenant_id, patient_id, endpoint)`), `type PushSubscriptionRow`. **Contrato para o P06-02:** a inscrição é gravada com a sessão do paciente (`withTenant` papel `paciente`), uma linha por vínculo ativo do dispositivo; `endpoint` https até 1000 caracteres, `p256dh` (87) e `auth` (22) em base64url; `onConflictDoNothing` no `(tenant_id, patient_id, endpoint)`.
  - `@/modules/notificacoes/push`: `type InscricaoPush`, `type ResultadoPush = { ok: true } | { ok: false; remover: boolean; definitivo: boolean; codigo: string }`, `interface ProvedorPush { enviar(i, payload: string, ttlS: number): Promise<ResultadoPush> }`, `webPushProvedor(o: { publicKey; privateKey; subject; enviar? }): ProvedorPush`, `pushDoAmbiente(e): ProvedorPush | null`.
  - `@/modules/notificacoes/mensagens`: `pushDaNotificacao(c, deps): { titulo: string; corpo: string; url: string | null } | null`.
  - `DepsEnvio` ganha `push: ProvedorPush | null`; variáveis do worker `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (as três juntas ou nenhuma).

- [ ] **Step 1: Dependência**

Run: `pnpm add web-push@3.6.7 && pnpm add -D @types/web-push@3.6.4`
Expected: `package.json` com `"web-push": "3.6.7"` em `dependencies` e `"@types/web-push": "3.6.4"` em `devDependencies`; lockfile atualizado. (Só o worker importa `web-push`; nenhuma rota do Next.)

- [ ] **Step 2: Tabela** — acrescentar a `src/db/schema/agenda.ts`

```ts
/**
 * INT-03 / D14: inscrição de push por vínculo e dispositivo. Gravada pelo P06-02 (sessão do paciente); o worker
 * envia e apaga as que o serviço de push devolve 404/410. Apagada na exclusão LGPD (US-018).
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    patientId: uuid('patient_id').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('push_subscriptions_vinculo_endpoint_unique').on(t.tenantId, t.patientId, t.endpoint),
    check('push_subscriptions_endpoint_https', sql`${t.endpoint} ~ '^https://' and char_length(${t.endpoint}) <= 1000`),
    check('push_subscriptions_chaves', sql`${t.p256dh} ~ '^[A-Za-z0-9_-]{80,100}$' and ${t.auth} ~ '^[A-Za-z0-9_-]{16,30}$'`),
    check('push_subscriptions_user_agent', sql`char_length(${t.userAgent}) <= 300`),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id], name: 'push_subscriptions_paciente_fk' }),
    index('push_subscriptions_paciente_idx').on(t.tenantId, t.patientId),
  ],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
```

Run: `pnpm db:generate --name push_subscriptions` e `pnpm drizzle-kit generate --custom --name rls_push_subscriptions`; `drizzle/0060_rls_push_subscriptions.sql`:

```sql
SELECT app_enable_tenant_rls('push_subscriptions');
--> statement-breakpoint
SELECT app_enable_patient_rls('push_subscriptions');
```

`src/db/audit-guard.ts`, `AUDIT_EXCEPTIONS`: `push_subscriptions: 'INT-03: endereço do dispositivo para push; não é dado de saúde',`.

`test/isolamento.test.ts`, `FABRICAS`:

```ts
  push_subscriptions: (t, p) =>
    sql`insert into push_subscriptions (tenant_id, patient_id, endpoint, p256dh, auth) values (${t}, ${p}, ${`https://push.example.test/${randomUUID()}`}, ${'a'.repeat(87)}, ${'b'.repeat(22)})`,
```

Run: `pnpm test src/db test/isolamento.test.ts` → PASS.

- [ ] **Step 3: Variáveis do VAPID (falham → passam)** — `src/env.test.ts`

```ts
describe('push (INT-03): VAPID no worker', () => {
  const w = { NODE_ENV: 'development', DATABASE_URL, APP_URL: 'http://localhost:3000', ENCRYPTION_KEY: KEY, DATA_DIR: './data', EMAIL_FROM: 'NutriDebby <x@y.dev>', MAILPIT_URL: 'http://localhost:8025' };
  const vapid = { VAPID_PUBLIC_KEY: 'B'.repeat(87), VAPID_PRIVATE_KEY: 'p'.repeat(43), VAPID_SUBJECT: 'mailto:suporte@exemplo.com' };
  it('as três juntas ou nenhuma; formato das chaves e do subject', () => {
    expect(parseWorkerEnv({ ...w, ...vapid }).VAPID_SUBJECT).toBe('mailto:suporte@exemplo.com');
    expect(parseWorkerEnv(w).VAPID_PUBLIC_KEY).toBeUndefined();
    expect(() => parseWorkerEnv({ ...w, VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY })).toThrow(/juntas/);
    expect(() => parseWorkerEnv({ ...w, ...vapid, VAPID_SUBJECT: 'suporte@exemplo.com' })).toThrow(/mailto:/);
    expect(() => parseWorkerEnv({ ...w, ...vapid, VAPID_PRIVATE_KEY: 'curta' })).toThrow(/VAPID_PRIVATE_KEY/);
  });
});
```

Em `src/env.ts`, no `workerSchema.extend({ … })`:

```ts
    // INT-03: chaves do push (gere com: npx web-push generate-vapid-keys). Sem elas, o push fica desligado
    VAPID_PUBLIC_KEY: opcional(z.string().regex(/^[A-Za-z0-9_-]{87}$/, { message: 'VAPID_PUBLIC_KEY deve ser a chave pública em base64url (87 caracteres)' }).optional()),
    VAPID_PRIVATE_KEY: opcional(z.string().regex(/^[A-Za-z0-9_-]{43}$/, { message: 'VAPID_PRIVATE_KEY deve ser a chave privada em base64url (43 caracteres)' }).optional()),
    VAPID_SUBJECT: opcional(z.string().regex(/^(mailto:|https:\/\/)/, { message: 'VAPID_SUBJECT deve começar com mailto: ou https://' }).optional()),
```

e no `superRefine` do worker:

```ts
    const vapid = [e.VAPID_PUBLIC_KEY, e.VAPID_PRIVATE_KEY, e.VAPID_SUBJECT];
    if (vapid.some(Boolean) && !vapid.every(Boolean)) {
      ctx.addIssue({ code: 'custom', path: ['VAPID_PUBLIC_KEY'], message: 'Configure VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT juntas (ou nenhuma)' });
    }
```

`.env.example`: as linhas `VAPID_*` existentes ganham o comentário `# worker: push (INT-03). Gere com: npx web-push generate-vapid-keys — sem as três, o push fica desligado`.

Run: `pnpm test src/env.test.ts` → PASS.

- [ ] **Step 4: Testes do push (falham)** — `src/modules/notificacoes/push.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { em, tenantAgenda } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { transporteFalso } from '../../../test/email';
import { novoPaciente, novoTenant, type TenantDeTeste } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { notifications, pushSubscriptions } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { agendarPelaNutri } from '@/modules/agenda/consultas';
import { chaveDosLinks } from '@/modules/agenda/link-consulta';
import { processarNotificacoes, type DepsEnvio } from './enviar';
import { pushDoAmbiente, webPushProvedor, type InscricaoPush, type ProvedorPush, type ResultadoPush } from './push';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const marcadaEm = new Date('2026-10-01T12:00:00Z');
const pushFalso = (r: (i: InscricaoPush) => ResultadoPush = () => ({ ok: true })): ProvedorPush & { enviados: { i: InscricaoPush; payload: string; ttl: number }[] } => {
  const enviados: { i: InscricaoPush; payload: string; ttl: number }[] = [];
  return { enviados, async enviar(i, payload, ttl) { enviados.push({ i, payload, ttl }); return r(i); } };
};
const deps = (agora: Date, push: ProvedorPush | null): DepsEnvio => ({
  db: app.db, agora: () => agora, appUrl: 'http://localhost:3000', chaveLinks: chaveDosLinks(Buffer.alloc(32, 9)), email: { transport: transporteFalso(), from: 'NutriDebby <x@y.dev>' }, whatsapp: null, push,
});
async function marcadaComInscricoes(T: TenantDeTeste, n: number) {
  const p = await novoPaciente(app.db, T.ctx);
  const endpoints = Array.from({ length: n }, () => `https://push.example.test/${randomUUID()}`);
  for (const endpoint of endpoints) await withTenant(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId: p.id, endpoint, p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }), app.db);
  const { id } = await agendarPelaNutri(T.ctx, tenantAgenda(T), { patientId: p.id, data: '2026-10-16', hora: '14:00', duracaoMin: '60', modalidade: 'presencial' }, { db: app.db, now: marcadaEm });
  return { p, id, endpoints };
}
const linha = async (T: TenantDeTeste, id: string, tipo: string) =>
  (await withTenant(T.ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.appointmentId, id), eq(notifications.tipo, tipo), eq(notifications.canal, 'push'))), app.db))[0];
const inscricoes = (T: TenantDeTeste) => withTenant(T.ctx, (tx) => tx.select().from(pushSubscriptions), app.db);

describe('push (INT-03, D19)', () => {
  it('envia para todos os dispositivos; payload sem dado de saúde, com o link da consulta; TTL até o início', async () => {
    const T = await novoTenant(app.db);
    const { id } = await marcadaComInscricoes(T, 2);
    const p = pushFalso();
    const agora = em('2026-10-15', '14:00');
    await processarNotificacoes(deps(agora, p), { tenantId: T.tenantId });
    const doLembrete = p.enviados.filter((e) => JSON.parse(e.payload).titulo === 'Consulta amanhã às 14:00');
    expect(doLembrete).toHaveLength(2);
    expect(Object.keys(JSON.parse(doLembrete[0].payload)).sort()).toEqual(['corpo', 'titulo', 'url']);
    expect(JSON.parse(doLembrete[0].payload).url).toMatch(/^http:\/\/localhost:3000\/consulta\/[A-Za-z0-9_-]{71}$/);
    expect(doLembrete[0].ttl).toBe(86_400);
    expect(await linha(T, id, 'lembrete_24h')).toMatchObject({ status: 'enviada' });
  });

  it('404/410 apaga a inscrição; se nenhuma sobrar, "sem_inscricao"; 5xx tenta de novo; sem VAPID, "push_desligado"', async () => {
    const T = await novoTenant(app.db);
    const { id, endpoints } = await marcadaComInscricoes(T, 2);
    const p = pushFalso((i) => (i.endpoint === endpoints[0] ? { ok: false, remover: true, definitivo: true, codigo: 'http_410' } : { ok: true }));
    await processarNotificacoes(deps(marcadaEm, p), { tenantId: T.tenantId });
    expect((await inscricoes(T)).map((i) => i.endpoint)).toEqual([endpoints[1]]);
    expect(await linha(T, id, 'consulta_marcada')).toMatchObject({ status: 'enviada' });
    const U = await novoTenant(app.db);
    const u = await marcadaComInscricoes(U, 1);
    await processarNotificacoes(deps(marcadaEm, pushFalso(() => ({ ok: false, remover: true, definitivo: true, codigo: 'http_404' }))), { tenantId: U.tenantId });
    expect(await linha(U, u.id, 'consulta_marcada')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'sem_inscricao' });
    expect(await inscricoes(U)).toEqual([]);
    const V = await novoTenant(app.db);
    const v = await marcadaComInscricoes(V, 1);
    await processarNotificacoes(deps(marcadaEm, pushFalso(() => ({ ok: false, remover: false, definitivo: false, codigo: 'http_503' }))), { tenantId: V.tenantId });
    expect(await linha(V, v.id, 'consulta_marcada')).toMatchObject({ status: 'pendente', erro: 'push' });
    const X = await novoTenant(app.db);
    const x = await marcadaComInscricoes(X, 1);
    await processarNotificacoes(deps(marcadaEm, null), { tenantId: X.tenantId });
    expect(await linha(X, x.id, 'consulta_marcada')).toMatchObject({ status: 'ignorada', motivoIgnorada: 'push_desligado' });
  });

  it('webPushProvedor: 410/404 removem; 400/413 definitivos; 429/5xx/rede repetem; manda VAPID, TTL e timeout', async () => {
    const chamadas: unknown[][] = [];
    const com = (erro: unknown) =>
      webPushProvedor({
        publicKey: 'B'.repeat(87), privateKey: 'p'.repeat(43), subject: 'mailto:x@y.dev',
        enviar: (async (...a: unknown[]) => { chamadas.push(a); if (erro) throw erro; return { statusCode: 201, body: '', headers: {} }; }) as never,
      }).enviar({ endpoint: 'https://push.example.test/1', p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }, '{}', 3600);
    expect(await com(null)).toEqual({ ok: true });
    expect(chamadas[0][2]).toMatchObject({ TTL: 3600, timeout: 10_000, vapidDetails: { subject: 'mailto:x@y.dev' } });
    expect(await com({ statusCode: 410 })).toEqual({ ok: false, remover: true, definitivo: true, codigo: 'http_410' });
    expect(await com({ statusCode: 404 })).toMatchObject({ remover: true });
    expect(await com({ statusCode: 413 })).toEqual({ ok: false, remover: false, definitivo: true, codigo: 'http_413' });
    expect(await com({ statusCode: 429 })).toMatchObject({ definitivo: false });
    expect(await com({ statusCode: 502 })).toMatchObject({ definitivo: false });
    expect(await com(new Error('ECONNRESET'))).toEqual({ ok: false, remover: false, definitivo: false, codigo: 'rede' });
    expect(pushDoAmbiente({})).toBeNull();
  });
});
```

Run: `pnpm test src/modules/notificacoes/push.test.ts` → FAIL.

- [ ] **Step 5: Implementar**

`src/modules/notificacoes/push.ts`:

```ts
import webpush from 'web-push';

export type InscricaoPush = { endpoint: string; p256dh: string; auth: string };
export type ResultadoPush = { ok: true } | { ok: false; remover: boolean; definitivo: boolean; codigo: string };
export interface ProvedorPush {
  enviar(i: InscricaoPush, payload: string, ttlS: number): Promise<ResultadoPush>;
}

/** INT-03: `web-push` com VAPID. 404/410 = inscrição morta (apagar); 4xx = definitivo; 429, 5xx e rede = tentar de novo. */
export function webPushProvedor(o: { publicKey: string; privateKey: string; subject: string; enviar?: typeof webpush.sendNotification }): ProvedorPush {
  const enviar = o.enviar ?? webpush.sendNotification;
  return {
    async enviar(i, payload, ttlS) {
      try {
        await enviar({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, payload, {
          vapidDetails: { subject: o.subject, publicKey: o.publicKey, privateKey: o.privateKey },
          TTL: ttlS,
          timeout: 10_000,
          urgency: 'normal',
        });
        return { ok: true };
      } catch (e) {
        const status = (e as { statusCode?: unknown }).statusCode;
        if (typeof status !== 'number') return { ok: false, remover: false, definitivo: false, codigo: 'rede' };
        if (status === 404 || status === 410) return { ok: false, remover: true, definitivo: true, codigo: `http_${status}` };
        if (status >= 400 && status < 500 && status !== 429) return { ok: false, remover: false, definitivo: true, codigo: `http_${status}` };
        return { ok: false, remover: false, definitivo: false, codigo: `http_${status}` };
      }
    },
  };
}

/** Sem as três variáveis do VAPID, o push fica desligado (lembretes por e-mail e WhatsApp). */
export function pushDoAmbiente(e: { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string }): ProvedorPush | null {
  if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY || !e.VAPID_SUBJECT) return null;
  return webPushProvedor({ publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY, subject: e.VAPID_SUBJECT });
}
```

Em `src/modules/notificacoes/mensagens.ts`:

```ts
/** D19: texto do push sem dado de saúde — só o horário e a nutricionista; o toque abre o link da consulta. */
export function pushDaNotificacao(c: ContextoEnvio, deps: { appUrl: string; chaveLinks: Buffer }): { titulo: string; corpo: string; url: string | null } | null {
  if (!c.consulta) return null;
  const d = dadosDaConsulta({ consulta: c.consulta, tenant: c.tenant }, deps);
  switch (c.n.tipo) {
    case 'lembrete_24h': // D7: adiado para as 08:00 do dia da consulta → "hoje"
      return { titulo: `Consulta ${ehHoje({ consulta: c.consulta, tenant: c.tenant, agora: c.agora }) ? 'hoje' : 'amanhã'} às ${d.hora}`, corpo: `Com ${d.nutri}. Toque para confirmar ou remarcar.`, url: d.link };
    case 'lembrete_2h':
      return { titulo: `Consulta hoje às ${d.hora}`, corpo: `Com ${d.nutri}.`, url: d.link };
    case 'consulta_marcada':
      return { titulo: 'Consulta marcada', corpo: `${d.quando}, com ${d.nutri}.`, url: d.link };
    case 'consulta_cancelada':
      return { titulo: 'Consulta cancelada', corpo: `${d.quando}, com ${d.nutri}.`, url: null };
    default:
      return null;
  }
}
```

Em `src/modules/notificacoes/enviar.ts` (imports `pushSubscriptions`; `type ProvedorPush`; `pushDaNotificacao`): `DepsEnvio` ganha `push: ProvedorPush | null;` e `CANAIS_ENVIO.push` passa a `enviarPush`:

```ts
/** INT-03: todos os dispositivos do vínculo; 404/410 apaga a inscrição; repete só se nenhum recebeu (no máximo 1, D6). */
async function enviarPush(c: ContextoEnvio, deps: DepsEnvio): Promise<Resultado> {
  if (!deps.push) return ignorar('push_desligado');
  const ctx: TenantContext = { tenantId: c.tenant.id, role: 'worker' };
  const inscricoes = await withTenant(ctx, (tx) => tx.select().from(pushSubscriptions).where(eq(pushSubscriptions.patientId, c.paciente.id)), deps.db);
  if (!inscricoes.length) return ignorar('sem_inscricao');
  const p = pushDaNotificacao(c, deps);
  if (!p) return { status: 'falhou', erro: 'sem_modelo' };
  const ate = c.consulta ? (c.consulta.inicio.getTime() - c.agora.getTime()) / 1000 : 86_400;
  const ttl = Math.round(Math.min(86_400, Math.max(60, ate)));
  let entregues = 0;
  let repetir = false;
  const mortas: string[] = [];
  for (const i of inscricoes) {
    const r = await deps.push.enviar(i, JSON.stringify(p), ttl);
    if (r.ok) entregues++;
    else if (r.remover) mortas.push(i.id);
    else if (!r.definitivo) repetir = true;
  }
  if (mortas.length) await withTenant(ctx, (tx) => tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, mortas)), deps.db);
  if (entregues) return { status: 'enviada' };
  if (repetir) return { status: 'repetir', erro: 'push' };
  return mortas.length === inscricoes.length ? ignorar('sem_inscricao') : { status: 'falhou', erro: 'push' };
}
```

Nos `deps(...)` de `enviar.test.ts`, `enviar-whatsapp.test.ts` e `whatsapp/cota.test.ts`: `push: null`.

`src/worker/index.ts` (import `pushDoAmbiente`): no `depsEnvio`, `push: pushDoAmbiente(env),` e no log de início, `push: depsEnvio.push ? 'ligado' : 'desligado'`.

- [ ] **Step 6: Exclusão LGPD apaga as inscrições** — em `src/modules/pacientes/lgpd.ts`, `atenderPedidoExclusao`, logo depois de `apagarConvitesPendentes(tx, ctx.tenantId, p.id)` (import `pushSubscriptions`):

```ts
      // US-018: "inscrições de push … apagadas na hora" (só as deste vínculo — D14)
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.patientId, p.id));
```

(e o comentário do cabeçalho da função passa a "Plano 06: apagar aqui também as fotos do diário").

Em `src/modules/pacientes/lgpd.test.ts`, no `describe('atender pedido de exclusão…')`:

```ts
  it('apaga as inscrições de push do paciente (só as dele, D14)', async () => {
    const T = await novoTenant(app.db);
    const [ana, bia] = [await novoPaciente(app.db, T.ctx), await novoPaciente(app.db, T.ctx)];
    for (const p of [ana, bia]) {
      await withTenant(T.ctx, (tx) => tx.insert(pushSubscriptions).values({ tenantId: T.tenantId, patientId: p.id, endpoint: `https://push.example.test/${randomUUID()}`, p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) }), app.db);
    }
    await atenderPedidoExclusao(T.ctx, T.tenant, ana.id, ana.nome, deps);
    const restam = await withTenant(T.ctx, (tx) => tx.select().from(pushSubscriptions), app.db);
    expect(restam.map((s) => s.patientId)).toEqual([bia.id]);
  });
```

(import `pushSubscriptions` de `@/db/schema`).

Run: `pnpm test src/modules/notificacoes src/modules/pacientes/lgpd.test.ts src/env.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/db/schema/agenda.ts drizzle/0059_push_subscriptions.sql drizzle/0060_rls_push_subscriptions.sql drizzle/meta src/db/audit-guard.ts test/isolamento.test.ts src/env.ts src/env.test.ts .env.example src/modules/notificacoes src/worker/index.ts src/modules/pacientes/lgpd.ts src/modules/pacientes/lgpd.test.ts
git commit -m "feat(notificacoes): envio de push com VAPID, limpeza de inscrições 404/410 e exclusão LGPD (INT-03, D14, D19)"
```

---
### Task 14: Convite do paciente por WhatsApp (US-010, completa o cadastro) (P05-11)

**Files:**
- Create: `src/modules/pacientes/convite-whatsapp.test.ts`
- Modify: `src/modules/pacientes/pacientes.ts`, `src/modules/pacientes/convite-paciente.ts`, `src/modules/notificacoes/agendar.ts`, `src/modules/notificacoes/mensagens.ts`, `src/app/painel/pacientes/valores.ts`, `src/app/painel/pacientes/valores.test.ts`, `src/app/painel/pacientes/paciente-form.tsx`, `src/app/painel/pacientes/novo/page.tsx`, `src/app/painel/pacientes/[id]/page.tsx`, `e2e/agenda.spec.ts`

**Interfaces:**
- Consumes: `enviarConvitePaciente` (Plano 03); `dispararEnvio`, `notifications` (Tarefa 5); `FINALIDADE_CONTEUDO`, `primeiroNome` (Tarefas 5 e 10); `sealSecret`, `openSecret`; `situacaoDaNotificacao`, `type MotivoIgnorada` (Tarefa 5); `whatsappFalso`, `conexaoDeTeste` (Tarefa 9); `processarNotificacoes` (Tarefa 5).
- Produces:
  - `enviarConvitePaciente` passa a devolver `{ expiraEm: Date; link: string; contaExistente: boolean }`.
  - `pacienteSchema` aceita `enviarConviteWhatsapp: boolean` (padrão `false`; com `true` exige `whatsappAutorizado`, senão "Marque que o paciente autorizou o WhatsApp"); `ErrosPaciente` ganha a chave `enviarConviteWhatsapp`.
  - `@/modules/notificacoes/mensagens`: `textoConviteWhatsapp(o: { nome: string; nutri: string; link: string; contaExistente: boolean }): string`.
  - `@/modules/notificacoes/agendar`: `agendarConviteWhatsapp(tx, o: { tenantId; patientId; texto: string }, agora): Promise<void>` (linha `convite_paciente`/`whatsapp` com o texto cifrado em `conteudo_selado` + envio imediato).
  - `@/modules/pacientes/convite-paciente`: `situacaoDoConviteWhatsapp(ctx, patientId, db?): Promise<Pick<NotificationRow, 'status' | 'motivoIgnorada' | 'agendadaPara' | 'enviadaEm'> | null>`.
  - `ValoresPaciente` ganha `enviarConviteWhatsapp: boolean`; `PacienteForm` ganha a prop `conviteWhatsapp?: boolean` (só no cadastro).

- [ ] **Step 1: Testes (falham)** — `src/modules/pacientes/convite-whatsapp.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, inject, it } from 'vitest';
import { makeDb } from '../../../test/db';
import { transporteFalso } from '../../../test/email';
import { emailsNaFila, novoTenant } from '../../../test/pacientes';
import { conexaoDeTeste, whatsappFalso } from '../../../test/whatsapp';
import { closeDb } from '@/db/client';
import { notifications } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { stopBoss } from '@/jobs/boss';
import { openSecret } from '@/lib/crypto';
import { chaveDosLinks } from '@/modules/agenda/link-consulta';
import { processarNotificacoes } from '@/modules/notificacoes/enviar';
import { FINALIDADE_CONTEUDO } from '@/modules/notificacoes/mensagens';
import { usoDoMes } from '@/modules/notificacoes/whatsapp/cota';
import { situacaoDoConviteWhatsapp } from './convite-paciente';
import { criarPaciente, MSG_PACIENTE, PacienteError } from './pacientes';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const now = new Date('2026-10-14T13:00:00Z');
const deps = { db: app.db, now, appUrl: 'http://localhost:3000' };
const cadastro = (extra: Record<string, unknown> = {}) => ({
  nome: 'Ana Souza', dataNascimento: '1991-03-10', sexo: 'F', email: `ana-${randomUUID().slice(0, 8)}@ex.com`,
  telefone: '(11) 91234-5678', whatsappAutorizado: true, enviarConviteWhatsapp: true, ...extra,
});
const convites = (ctx: Parameters<typeof withTenant>[0], patientId: string) =>
  withTenant(ctx, (tx) => tx.select().from(notifications).where(and(eq(notifications.patientId, patientId), eq(notifications.tipo, 'convite_paciente'))), app.db);

describe('convite por WhatsApp (US-010)', () => {
  it('autorizado + "Enviar convite por WhatsApp": e-mail de convite e mensagem com o mesmo link (cifrada até o envio)', async () => {
    const T = await novoTenant(app.db, 'Debby Silva');
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    expect(p).toMatchObject({ whatsappOptinOrigem: 'nutri', telefoneE164: '+5511912345678' });
    const [email] = await emailsNaFila('convite_paciente', p.email);
    const [n] = await convites(T.ctx, p.id);
    expect(n).toMatchObject({ canal: 'whatsapp', status: 'pendente', appointmentId: null });
    const texto = openSecret(n.conteudoSelado!, FINALIDADE_CONTEUDO);
    expect(texto).toBe(`Olá, Ana! Debby Silva convidou você para acompanhar seu tratamento pelo NutriDebby. Crie sua senha pelo link (vale por 7 dias): ${email.link}`);
  });

  it('"Enviar convite por WhatsApp" sem a autorização → "Marque que o paciente autorizou o WhatsApp"; nada é criado', async () => {
    const T = await novoTenant(app.db);
    const e = await criarPaciente(T.ctx, T.tenant, cadastro({ whatsappAutorizado: false }), deps).catch((x: unknown) => x);
    expect((e as PacienteError).erros).toEqual({ enviarConviteWhatsapp: MSG_PACIENTE.conviteSemAutorizacao });
    expect(MSG_PACIENTE.conviteSemAutorizacao).toBe('Marque que o paciente autorizou o WhatsApp');
  });

  it('sem marcar o convite por WhatsApp, só o e-mail', async () => {
    const T = await novoTenant(app.db);
    const p = await criarPaciente(T.ctx, T.tenant, cadastro({ enviarConviteWhatsapp: false }), deps);
    expect(await convites(T.ctx, p.id)).toEqual([]);
  });

  it('o worker envia para "+5511912345678", apaga o texto cifrado, conta 1 na cota e a tela mostra a situação', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'conectada');
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    const w = whatsappFalso();
    await processarNotificacoes(
      { db: app.db, agora: () => now, appUrl: 'http://localhost:3000', chaveLinks: chaveDosLinks(Buffer.alloc(32, 9)), email: { transport: transporteFalso(), from: 'x@y.dev' }, whatsapp: w, push: null },
      { tenantId: T.tenantId },
    );
    expect(w.enviados.map((e) => e.numero)).toEqual(['5511912345678']);
    expect(w.enviados[0].texto).toContain('/convite/paciente/');
    const [n] = await convites(T.ctx, p.id);
    expect(n).toMatchObject({ status: 'enviada', conteudoSelado: null });
    expect(await withTenant(T.ctx, (tx) => usoDoMes(tx, T.tenant.fuso, now), app.db)).toBe(1);
    expect(await situacaoDoConviteWhatsapp(T.ctx, p.id, app.db)).toMatchObject({ status: 'enviada' });
  });

  it('WhatsApp desconectado: o convite fica "ignorada"/"whatsapp_desconectado" (o e-mail já foi)', async () => {
    const T = await novoTenant(app.db);
    await conexaoDeTeste(app.db, T.ctx, 'desconectada');
    const p = await criarPaciente(T.ctx, T.tenant, cadastro(), deps);
    await processarNotificacoes(
      { db: app.db, agora: () => now, appUrl: 'http://localhost:3000', chaveLinks: chaveDosLinks(Buffer.alloc(32, 9)), email: { transport: transporteFalso(), from: 'x@y.dev' }, whatsapp: whatsappFalso(), push: null },
      { tenantId: T.tenantId },
    );
    expect(await situacaoDoConviteWhatsapp(T.ctx, p.id, app.db)).toMatchObject({ status: 'ignorada', motivoIgnorada: 'whatsapp_desconectado' });
  });
});
```

Run: `pnpm test src/modules/pacientes/convite-whatsapp.test.ts` → FAIL.

- [ ] **Step 2: Implementar**

`src/modules/notificacoes/mensagens.ts`:

```ts
/** US-010: o convite por WhatsApp leva o mesmo link (de uso único) do e-mail. */
export function textoConviteWhatsapp(o: { nome: string; nutri: string; link: string; contaExistente: boolean }): string {
  const nome = primeiroNome(o.nome);
  return o.contaExistente
    ? `Olá, ${nome}! Entre com sua conta existente para ver os dados da nutricionista ${o.nutri}: ${o.link}`
    : `Olá, ${nome}! ${o.nutri} convidou você para acompanhar seu tratamento pelo NutriDebby. Crie sua senha pelo link (vale por 7 dias): ${o.link}`;
}
```

`src/modules/notificacoes/agendar.ts` (imports `sealSecret` de `@/lib/crypto` e `FINALIDADE_CONTEUDO` de `./mensagens`):

```ts
/** US-010: convite por WhatsApp — o texto (com o link de uso único) fica cifrado na linha até o envio. Conta na cota (RN-09). */
export async function agendarConviteWhatsapp(tx: Tx, o: { tenantId: string; patientId: string; texto: string }, agora: Date): Promise<void> {
  await tx.insert(notifications).values({
    tenantId: o.tenantId,
    patientId: o.patientId,
    appointmentId: null,
    canal: 'whatsapp',
    tipo: 'convite_paciente',
    agendadaPara: agora,
    conteudoSelado: sealSecret(o.texto, FINALIDADE_CONTEUDO),
    createdAt: agora,
    updatedAt: agora,
  });
  await dispararEnvio(tx, o.tenantId);
}
```

`src/modules/pacientes/convite-paciente.ts` — `enviarConvitePaciente` passa a devolver o link e se a conta existe (as chamadas existentes continuam usando só `expiraEm`):

```ts
): Promise<{ expiraEm: Date; link: string; contaExistente: boolean }> {
  // … corpo igual até o enqueueEmail, guardando o link e a conta numa variável:
  const link = linkDoConvitePaciente(deps.appUrl, token);
  const contaExistente = conta?.papel === 'paciente';
  await enqueueEmail({ tipo: 'convite_paciente', para: p.email, nome: p.nome, nutri: deps.nutri, link, contaExistente }, { tenantId: p.tenantId, tx });
  return { expiraEm, link, contaExistente };
}
```

e, no fim do arquivo (imports `notifications`, `type NotificationRow`):

```ts
/** Situação do último convite por WhatsApp (tela do paciente). Sem dado de saúde: só status e horários. */
export async function situacaoDoConviteWhatsapp(ctx: TenantContext, patientId: string, db: Db = getDb()): Promise<Pick<NotificationRow, 'status' | 'motivoIgnorada' | 'agendadaPara' | 'enviadaEm'> | null> {
  const [n] = await withTenant(
    ctx,
    (tx) =>
      tx
        .select({ status: notifications.status, motivoIgnorada: notifications.motivoIgnorada, agendadaPara: notifications.agendadaPara, enviadaEm: notifications.enviadaEm })
        .from(notifications)
        .where(and(eq(notifications.patientId, patientId), eq(notifications.tipo, 'convite_paciente'), eq(notifications.canal, 'whatsapp')))
        .orderBy(desc(notifications.createdAt))
        .limit(1),
    db,
  );
  return n ?? null;
}
```

`src/modules/pacientes/pacientes.ts`:
- `MSG_PACIENTE` ganha `conviteSemAutorizacao: 'Marque que o paciente autorizou o WhatsApp',`;
- `ErrosPaciente` ganha `'enviarConviteWhatsapp'`;
- no `pacienteSchema`, `enviarConviteWhatsapp: z.boolean().default(false),` e, no `superRefine`:

```ts
      if (v.enviarConviteWhatsapp && !v.whatsappAutorizado) {
        ctx.addIssue({ code: 'custom', path: ['enviarConviteWhatsapp'], message: MSG_PACIENTE.conviteSemAutorizacao });
      }
```

- em `criarPaciente`, o convite por e-mail passa a guardar o retorno e, com o WhatsApp marcado, agenda a mensagem (imports `agendarConviteWhatsapp` e `textoConviteWhatsapp`):

```ts
        // US-010: convite de 7 dias por e-mail na mesma transação (paciente criado ⇔ convite na fila)
        const convite = await enviarConvitePaciente(tx, p, { appUrl: deps.appUrl ?? getEnv().APP_URL, nutri: tenant.nomeExibicao, now });
        // US-010 "Convite também por WhatsApp": o mesmo link, só com a autorização registrada (INT-01: opt-in antes de qualquer mensagem)
        if (v.enviarConviteWhatsapp && p.whatsappOptinEm && !p.whatsappOptoutEm) {
          await agendarConviteWhatsapp(tx, { tenantId: ctx.tenantId, patientId: p.id, texto: textoConviteWhatsapp({ nome: p.nome, nutri: tenant.nomeExibicao, link: convite.link, contaExistente: convite.contaExistente }) }, now);
        }
        return p;
```

`src/app/painel/pacientes/valores.ts`: `ValoresPaciente` ganha `enviarConviteWhatsapp: boolean`; `valoresDoFormulario` → `enviarConviteWhatsapp: f.get('enviarConviteWhatsapp') === 'on'`; `valoresDoPaciente` → `enviarConviteWhatsapp: false`; e uma função:

```ts
/** US-010: situação do convite por WhatsApp na tela do paciente. */
export function textoDoConviteWhatsapp(n: Parameters<typeof situacaoDaNotificacao>[0] | null, fuso: string): string | null {
  return n ? `Convite por WhatsApp: ${situacaoDaNotificacao(n, fuso).replace(/^./, (c) => c.toLowerCase())}` : null;
}
```

(import `situacaoDaNotificacao` de `@/modules/notificacoes/tipos`).

`src/app/painel/pacientes/novo/page.tsx`: `VAZIO` ganha `enviarConviteWhatsapp: false` e o formulário recebe `conviteWhatsapp`.

`src/app/painel/pacientes/valores.test.ts`: os objetos esperados de `valoresDoFormulario` e `valoresDoPaciente` ganham `enviarConviteWhatsapp: false` (e o caso com `f.set('enviarConviteWhatsapp', 'on')` → `true`).

`src/app/painel/pacientes/paciente-form.tsx` — prop `conviteWhatsapp?: boolean`; o checkbox de autorização vira controlado para habilitar o convite (US-010 "WhatsApp sem autorização: a opção fica desabilitada"):

```tsx
  const [autorizado, setAutorizado] = useState(v.whatsappAutorizado);
```

no `<input id="whatsappAutorizado" …>`, troque `defaultChecked={v.whatsappAutorizado}` por `checked={autorizado} onChange={(ev) => setAutorizado(ev.target.checked)}`; e, logo depois do erro da autorização:

```tsx
        {conviteWhatsapp && (
          <div className="flex items-start gap-2">
            <input
              id="enviarConviteWhatsapp"
              name="enviarConviteWhatsapp"
              type="checkbox"
              className="mt-1"
              defaultChecked={v.enviarConviteWhatsapp}
              disabled={!autorizado || !telefone.trim()}
              aria-invalid={e.enviarConviteWhatsapp ? true : undefined}
              aria-describedby={e.enviarConviteWhatsapp ? 'enviarConviteWhatsapp-erro' : undefined}
            />
            <label htmlFor="enviarConviteWhatsapp">Enviar convite por WhatsApp</label>
          </div>
        )}
        {e.enviarConviteWhatsapp && <p id="enviarConviteWhatsapp-erro" role="alert" className="text-sm text-red-700">{e.enviarConviteWhatsapp}</p>}
```

`src/app/painel/pacientes/[id]/page.tsx`: carrega `const conviteWa = await situacaoDoConviteWhatsapp(ctx, paciente.id);` e, na seção "Acesso ao portal", depois do texto do acesso: `{textoDoConviteWhatsapp(conviteWa, tenant.fuso) && <p className="text-sm">{textoDoConviteWhatsapp(conviteWa, tenant.fuso)}</p>}`.

Run: `pnpm test src/modules/pacientes src/app/painel/pacientes`
Expected: PASS (5 testes novos; `pacientes.test.ts`, `convite-paciente.test.ts` e `valores.test.ts` verdes).

- [ ] **Step 3: E2E** — acrescentar a `e2e/agenda.spec.ts` (depois do teste do webhook, com o WhatsApp do consultório conectado)

```ts
test('convite por WhatsApp no cadastro chega ao número do paciente (sandbox) (US-010)', async () => {
  const antes = new Date();
  await nutri.goto('/painel/pacientes/novo');
  await nutri.getByLabel('Nome').fill(`Gabi Whats ${sufixo}`);
  await nutri.getByLabel('Data de nascimento').fill('1990-05-10');
  await nutri.getByLabel('Feminino').check();
  await nutri.getByLabel('E-mail').fill(`gabi-${sufixo}@ex.com`);
  await nutri.getByLabel('Telefone (opcional)').fill('(11) 98765-4321');
  await expect(nutri.getByLabel('Enviar convite por WhatsApp')).toBeDisabled();
  await nutri.getByLabel('Paciente autorizou receber mensagens por WhatsApp').check();
  await nutri.getByLabel('Enviar convite por WhatsApp').check();
  await nutri.getByRole('button', { name: 'Cadastrar paciente' }).click();
  await expect(nutri).toHaveURL(/\/painel\/pacientes\/[0-9a-f-]{36}$/);
  const msg = await esperarEmail('5511987654321@whatsapp.sandbox', { depoisDe: antes });
  expect(msg.texto).toMatch(/^Olá, Gabi! Consultório E2E convidou você para acompanhar seu tratamento pelo NutriDebby\. Crie sua senha pelo link \(vale por 7 dias\): http\S+\/convite\/paciente\//);
  await nutri.reload();
  await expect(nutri.getByText(/^Convite por WhatsApp: enviado em /)).toBeVisible();
});
```

Run: `pnpm e2e:seed && pnpm test:e2e e2e/agenda.spec.ts`
Expected: PASS (8 testes).

- [ ] **Step 4: Commit**

```bash
git add src/modules/pacientes src/modules/notificacoes src/app/painel/pacientes e2e/agenda.spec.ts
git commit -m "feat(pacientes): convite por WhatsApp no cadastro, com o mesmo link do e-mail (US-010, P05-11)"
```

---
### Task 15: Presença/falta, indicadores de faltas (CS-03), "Iniciar atendimento", painel inicial e LGPD da agenda (P05-12)

**Files:**
- Create: `src/modules/agenda/presenca.ts`, `src/modules/agenda/presenca.test.ts`, `drizzle/0061_atendimento_da_consulta.sql` (gerada), `drizzle/0062_fk_atendimento_consulta.sql` (custom), `src/app/painel/agenda/consultas/[id]/presenca.tsx`, `src/app/painel/agenda/pendencias/page.tsx`
- Modify: `src/modules/agenda/consultas.ts` (`listarConsultas`), `src/db/schema/pacientes.ts` (`consultations.appointmentId`), `src/modules/pacientes/atendimentos.ts`, `src/modules/pacientes/atendimentos.test.ts`, `src/app/painel/pacientes/[id]/atendimentos/{page,actions,atendimento-form}.tsx`, `src/app/painel/agenda/actions.ts`, `src/app/painel/agenda/consultas/[id]/page.tsx`, `src/app/painel/page.tsx`, `src/modules/pacientes/exportacao-job.ts`, `src/modules/pacientes/exportacao.test.ts`, `src/modules/pacientes/lgpd.ts`, `src/modules/pacientes/lgpd.test.ts`, `scripts/e2e-seed.ts`, `e2e/agenda.spec.ts`

**Interfaces:**
- Consumes: `lerConsultaParaEscrita`, `ConsultaError`, `STATUS_ATIVOS`, `type Consulta`, `COLUNAS`/`comoConsulta` internos (Tarefa 3); `inicioDoMes`, `inicioDoMesSeguinte`, `quandoComFuso` (Tarefa 1); `formatarDecimal` (`@/lib/numero`); `registrarAtendimento` (Plano 03).
- Produces:
  - Schema: `consultations.appointmentId` (UNIQUE quando preenchido; FK composta `(tenant_id, patient_id, appointment_id)` → `appointments`, só na migration custom).
  - `@/modules/agenda/consultas`: `listarConsultas(ctx, onde, o: { ordem; limite }, db?): Promise<Consulta[]>`.
  - `@/modules/agenda/presenca`: `MSG_PRESENCA`, `registrarPresenca(ctx, id, situacao: 'realizada' | 'faltou', deps?): Promise<void>`, `pendenciasDePresenca(ctx, agora, db?): Promise<Consulta[]>`, `type Indicadores = { consultasMes: number; faltasMes: number; iniciadasMes: number; taxaMes: number | null; taxaMesAnterior: number | null }`, `indicadoresDaAgenda(ctx, fuso, agora, db?)`, `textoTaxa(taxa, faltas?, total?): string`, `novidadesDaAgenda(ctx, agora, db?): Promise<{ pedidosRemarcacao: Consulta[]; marcadasPeloPaciente: Consulta[]; canceladasPeloPaciente: Consulta[] }>`.
  - `registrarAtendimento` aceita `appointmentId` na entrada (liga a consulta e a marca "realizada").
  - `DadosExportacao` ganha `consultas` e `lembretes`.

- [ ] **Step 1: Testes da presença e dos indicadores (falham)** — `src/modules/agenda/presenca.test.ts`

```ts
import { afterAll, describe, expect, inject, it } from 'vitest';
import { consultaDireta, em } from '../../../test/agenda';
import { makeDb } from '../../../test/db';
import { novoPaciente, novoTenant } from '../../../test/pacientes';
import { closeDb } from '@/db/client';
import { stopBoss } from '@/jobs/boss';
import { MSG_AGENDA } from './constantes';
import { buscarConsulta, ConsultaError } from './consultas';
import { indicadoresDaAgenda, MSG_PRESENCA, novidadesDaAgenda, pendenciasDePresenca, registrarPresenca, textoTaxa } from './presenca';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(async () => {
  await stopBoss();
  await closeDb();
  await app.pool.end();
});
const SP = 'America/Sao_Paulo';
const agora = em('2026-10-20', '12:00');
const erro = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => (e instanceof ConsultaError ? e.erros : Promise.reject(e)));

describe('presença e falta (US-037, CS-03)', () => {
  it('consulta passada "agendada" ou "confirmada" → "faltou"/"realizada" (pode corrigir); futura não; cancelada não', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const passada = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-19', '09:00'), 60, { status: 'confirmada', confirmadaVia: 'whatsapp' });
    await registrarPresenca(T.ctx, passada, 'faltou', { db: app.db, now: agora });
    expect(await buscarConsulta(T.ctx, passada, app.db)).toMatchObject({ status: 'faltou' });
    await registrarPresenca(T.ctx, passada, 'realizada', { db: app.db, now: agora });
    expect((await buscarConsulta(T.ctx, passada, app.db))?.status).toBe('realizada');
    const futura = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-21', '09:00'));
    expect(await erro(registrarPresenca(T.ctx, futura, 'faltou', { db: app.db, now: agora }))).toEqual({ geral: MSG_PRESENCA.antesDoInicio });
    const cancelada = await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-18', '09:00'), 60, { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora });
    expect(await erro(registrarPresenca(T.ctx, cancelada, 'faltou', { db: app.db, now: agora }))).toEqual({ geral: MSG_AGENDA.naoAlteravel });
  });

  it('pendências: passadas há mais de 24 h sem registro ("3 consultas sem registro de presença")', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    for (const d of ['2026-10-15', '2026-10-16', '2026-10-17']) await consultaDireta(app.db, T.ctx, ana.id, em(d, '09:00'));
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-19', '15:00')); // terminou há menos de 24 h
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-14', '09:00'), 60, { status: 'realizada' });
    expect(await pendenciasDePresenca(T.ctx, agora, app.db)).toHaveLength(3);
  });

  it('indicadores: consultas do mês, taxa de faltas do mês (só as já iniciadas) e a do mês anterior, no fuso do tenant', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    const c = (data: string, extra = {}) => consultaDireta(app.db, T.ctx, ana.id, em(data, '09:00'), 60, extra);
    await c('2026-09-10', { status: 'faltou' });
    await c('2026-09-11', { status: 'realizada' });
    await c('2026-09-12', { status: 'realizada' });
    await c('2026-09-13', { status: 'realizada' });
    await c('2026-10-01', { status: 'faltou' });
    await c('2026-10-02', { status: 'realizada' });
    await c('2026-10-03', { status: 'cancelada', canceladoPor: 'nutri', canceladaEm: agora });
    await c('2026-10-25'); // futura: conta no mês, não na taxa
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-09-30', '23:30'), 30, { status: 'faltou' }); // 30/09 23:30 de Brasília é setembro
    expect(await indicadoresDaAgenda(T.ctx, SP, agora, app.db)).toEqual({ consultasMes: 3, faltasMes: 1, iniciadasMes: 2, taxaMes: 0.5, taxaMesAnterior: 0.4 });
    expect(textoTaxa(0.125, 2, 16)).toBe('12,5% (2 de 16)');
    expect(textoTaxa(null)).toBe('Sem dados');
  });

  it('novidades para o painel: pedidos de remarcação, marcadas e canceladas pelo paciente nos últimos 7 dias', async () => {
    const T = await novoTenant(app.db);
    const ana = await novoPaciente(app.db, T.ctx);
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-22', '09:00'), 60, { pedidoRemarcacaoEm: em('2026-10-20', '08:00') });
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-23', '09:00'), 60, { origem: 'paciente' });
    await consultaDireta(app.db, T.ctx, ana.id, em('2026-10-24', '09:00'), 60, { origem: 'paciente', status: 'cancelada', canceladoPor: 'paciente', canceladaEm: em('2026-10-19', '10:00') });
    const n = await novidadesDaAgenda(T.ctx, agora, app.db);
    expect([n.pedidosRemarcacao.length, n.marcadasPeloPaciente.length, n.canceladasPeloPaciente.length]).toEqual([1, 1, 1]);
  });
});
```

> No terceiro teste, setembro tem 4 consultas iniciadas + a de 30/09 às 23:30 = 5, com 2 faltas → 40%; outubro tem 3 não canceladas (2 iniciadas, 1 falta) → 50%.

Run: `pnpm test src/modules/agenda/presenca.test.ts` → FAIL.

- [ ] **Step 2: Implementar** — primeiro, em `src/modules/agenda/consultas.ts` (imports `desc` e `type SQL` de `drizzle-orm`), uma lista genérica com o nome do paciente numa consulta só (sem N+1):

```ts
/** Listas do painel (pendências, novidades): mesmo formato da agenda, sem leitura auditada (D10). */
export async function listarConsultas(ctx: TenantContext, onde: SQL | undefined, o: { ordem: 'asc' | 'desc'; limite: number }, db: Db = getDb()): Promise<Consulta[]> {
  const rs = await withTenant(
    ctx,
    (tx) =>
      tx
        .select(COLUNAS)
        .from(appointments)
        .innerJoin(patients, eq(patients.id, appointments.patientId))
        .where(onde)
        .orderBy(o.ordem === 'asc' ? asc(appointments.inicio) : desc(appointments.inicio))
        .limit(o.limite),
    db,
  );
  return rs.map(comoConsulta);
}
```

Depois, `src/modules/agenda/presenca.ts`

```ts
import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { appointments } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { formatarDecimal } from '@/lib/numero';
import { MSG_AGENDA } from './constantes';
import { ConsultaError, lerConsultaParaEscrita, listarConsultas, type Consulta } from './consultas';
import { inicioDoMes, inicioDoMesSeguinte } from './fuso';

export const MSG_PRESENCA = {
  antesDoInicio: 'A presença só pode ser registrada depois do início da consulta.',
  registrada: 'Presença registrada.',
  pendencias: (n: number) => `${n} ${n === 1 ? 'consulta' : 'consultas'} sem registro de presença`,
} as const;

/** US-037: depois do início, "realizada" ou "faltou" (pode corrigir). Cancelada não. */
export async function registrarPresenca(ctx: TenantContext, id: string, situacao: 'realizada' | 'faltou', deps: { db?: Db; now?: Date } = {}): Promise<void> {
  const agora = deps.now ?? new Date();
  await withTenant(
    ctx,
    async (tx) => {
      const c = await lerConsultaParaEscrita(tx, id);
      if (c.status === 'cancelada') throw new ConsultaError({ geral: MSG_AGENDA.naoAlteravel });
      if (c.inicio.getTime() > agora.getTime()) throw new ConsultaError({ geral: MSG_PRESENCA.antesDoInicio });
      if (c.status === situacao) return;
      await tx.update(appointments).set({ status: situacao, presencaEm: agora, updatedAt: agora }).where(eq(appointments.id, id));
    },
    deps.db ?? getDb(),
  );
}

/** US-037 "Pendências": terminou há mais de 24 h e continua "agendada"/"confirmada". */
export function pendenciasDePresenca(ctx: TenantContext, agora: Date, db: Db = getDb()): Promise<Consulta[]> {
  return listarConsultas(ctx, and(inArray(appointments.status, ['agendada', 'confirmada']), lt(appointments.fim, new Date(agora.getTime() - 86_400_000))), { ordem: 'asc', limite: 100 }, db);
}

export type Indicadores = { consultasMes: number; faltasMes: number; iniciadasMes: number; taxaMes: number | null; taxaMesAnterior: number | null };

/** CS-03 / D21: mês civil no fuso; taxa = faltas ÷ consultas não canceladas já iniciadas. */
export async function indicadoresDaAgenda(ctx: TenantContext, fuso: string, agora: Date, db: Db = getDb()): Promise<Indicadores> {
  const contar = async (de: Date, ate: Date) => {
    const [r] = await withTenant(
      ctx,
      (tx) =>
        tx
          .select({
            total: sql<number>`count(*) filter (where ${appointments.status} <> 'cancelada')`.mapWith(Number),
            iniciadas: sql<number>`count(*) filter (where ${appointments.status} <> 'cancelada' and ${appointments.inicio} <= ${agora})`.mapWith(Number),
            faltas: sql<number>`count(*) filter (where ${appointments.status} = 'faltou')`.mapWith(Number),
          })
          .from(appointments)
          .where(and(gte(appointments.inicio, de), lt(appointments.inicio, ate))),
      db,
    );
    return r;
  };
  const ini = inicioDoMes(agora, fuso);
  const mes = await contar(ini, inicioDoMesSeguinte(agora, fuso));
  const ant = await contar(inicioDoMes(new Date(ini.getTime() - 1), fuso), ini);
  return {
    consultasMes: mes.total,
    faltasMes: mes.faltas,
    iniciadasMes: mes.iniciadas,
    taxaMes: mes.iniciadas ? mes.faltas / mes.iniciadas : null,
    taxaMesAnterior: ant.iniciadas ? ant.faltas / ant.iniciadas : null,
  };
}

/** "12,5% (2 de 16)" ou "Sem dados" (RNF-12: vírgula decimal). */
export function textoTaxa(taxa: number | null, faltas?: number, total?: number): string {
  if (taxa === null) return 'Sem dados';
  const pct = `${formatarDecimal(Math.round(taxa * 1000) / 10, 1)}%`;
  return faltas === undefined ? pct : `${pct} (${faltas} de ${total})`;
}

/** US-032/033/035 no painel: o que o paciente fez na agenda nos últimos 7 dias. */
export async function novidadesDaAgenda(ctx: TenantContext, agora: Date, db: Db = getDb()) {
  const semana = new Date(agora.getTime() - 7 * 86_400_000);
  const [pedidosRemarcacao, marcadasPeloPaciente, canceladasPeloPaciente] = [
    await listarConsultas(ctx, and(isNotNull(appointments.pedidoRemarcacaoEm), inArray(appointments.status, ['agendada', 'confirmada']), gte(appointments.inicio, agora)), { ordem: 'asc', limite: 20 }, db),
    await listarConsultas(ctx, and(eq(appointments.origem, 'paciente'), gte(appointments.createdAt, semana), inArray(appointments.status, ['agendada', 'confirmada'])), { ordem: 'asc', limite: 20 }, db),
    await listarConsultas(ctx, and(eq(appointments.canceladoPor, 'paciente'), gte(appointments.canceladaEm, semana)), { ordem: 'desc', limite: 20 }, db),
  ];
  return { pedidosRemarcacao, marcadasPeloPaciente, canceladasPeloPaciente };
}
```

Run: `pnpm test src/modules/agenda/presenca.test.ts` → PASS (4 testes).

- [ ] **Step 3: Atendimento ligado à consulta ("Iniciar atendimento")**

Em `src/db/schema/pacientes.ts`, `consultations` ganha `appointmentId: uuid('appointment_id'),` e, nas restrições, `uniqueIndex('consultations_consulta_idx').on(t.appointmentId).where(sql\`${t.appointmentId} is not null\`),`.

Run: `pnpm db:generate --name atendimento_da_consulta` e `pnpm drizzle-kit generate --custom --name fk_atendimento_consulta`; `drizzle/0062_fk_atendimento_consulta.sql`:

```sql
-- Plano 03 (adiado): o atendimento pode nascer da consulta da agenda. FK composta (mesmo tenant e mesmo paciente);
-- declarada só aqui porque a tabela appointments vive em outro arquivo de schema (import circular no Drizzle).
-- Consultas nunca são apagadas (cancelar muda o status), então NO ACTION basta.
ALTER TABLE consultations ADD CONSTRAINT consultations_consulta_fk
  FOREIGN KEY (tenant_id, patient_id, appointment_id) REFERENCES appointments (tenant_id, patient_id, id);
```

Em `scripts/e2e-seed.ts`, antes do laço de `AGENDA_E2E`: `await tx.execute(sql\`update consultations set appointment_id = null where appointment_id is not null\`);` (dentro do mesmo `withTenant`).

Em `src/modules/pacientes/atendimentos.test.ts`:

```ts
  it('"Iniciar atendimento" da agenda: liga a consulta, marca "realizada"; a mesma consulta não tem dois atendimentos', async () => {
    const T = await novoTenant(app.db);
    const p = await novoPaciente(app.db, T.ctx);
    const c = await consultaDireta(app.db, T.ctx, p.id, new Date('2026-09-30T12:00:00Z'));
    const id = await registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-09-30', notasPrivadas: '', orientacoes: '', appointmentId: c }, { db: app.db, now: new Date('2026-10-01T15:00:00Z') });
    const [linha] = await withTenant(T.ctx, (tx) => tx.select().from(consultations).where(eq(consultations.id, id)), app.db);
    expect(linha.appointmentId).toBe(c);
    expect((await buscarConsulta(T.ctx, c, app.db))?.status).toBe('realizada');
    await expect(registrarAtendimento(T.ctx, T.tenant, p.id, { data: '2026-09-30', notasPrivadas: '', orientacoes: '', appointmentId: c }, { db: app.db, now: new Date('2026-10-01T15:00:00Z') })).rejects.toMatchObject({ erros: { geral: MSG_ATENDIMENTO.consultaJaAtendida } });
    const outro = await novoPaciente(app.db, T.ctx);
    await expect(registrarAtendimento(T.ctx, T.tenant, outro.id, { data: '2026-09-30', notasPrivadas: '', orientacoes: '', appointmentId: c }, { db: app.db, now: new Date('2026-10-01T15:00:00Z') })).rejects.toMatchObject({ erros: { geral: MSG_ATENDIMENTO.consultaInvalida } });
  });
```

(imports `consultaDireta` de `../../../test/agenda`, `buscarConsulta` de `@/modules/agenda/consultas`.)

Em `src/modules/pacientes/atendimentos.ts`:
- `MSG_ATENDIMENTO` ganha `consultaJaAtendida: 'Esta consulta já tem um atendimento registrado.'` e `consultaInvalida: 'Consulta não encontrada para este paciente.'`;
- `type Entrada = { data: unknown; notasPrivadas: unknown; orientacoes: unknown; appointmentId?: unknown };`
- em `registrarAtendimento`, depois de `carregarPacienteParaEscrita` e antes do `insert` (imports `appointments` de `@/db/schema`, `idValido` já importado, `uniqueViolation` de `@/db/errors`):

```ts
      // Plano 05: atendimento iniciado pela agenda — a consulta precisa ser deste paciente e não cancelada; vira "realizada"
      const appointmentId = input.appointmentId === undefined || input.appointmentId === '' ? null : input.appointmentId;
      if (appointmentId !== null) {
        const [c] = idValido(appointmentId)
          ? await tx.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.patientId, p.id))).for('update')
          : [];
        if (!c || c.status === 'cancelada') throw new AtendimentoError({ geral: MSG_ATENDIMENTO.consultaInvalida });
        if (c.status === 'agendada' || c.status === 'confirmada') await tx.update(appointments).set({ status: 'realizada', presencaEm: now, updatedAt: now }).where(eq(appointments.id, c.id));
      }
```

e o `insert` passa a gravar `appointmentId: appointmentId as string | null`; o `withTenant` fica dentro de um `try` que troca `uniqueViolation(e) === 'consultations_consulta_idx'` por `new AtendimentoError({ geral: MSG_ATENDIMENTO.consultaJaAtendida })`.

Na tela de atendimentos (`src/app/painel/pacientes/[id]/atendimentos/page.tsx`): lê `searchParams.consulta`; se for um id válido de consulta deste paciente (`buscarConsulta(ctx, consulta)` com `patientId === paciente.id`), a data inicial do formulário é o dia da consulta no fuso e o `AtendimentoForm` recebe `consultaId`, que vira `<input type="hidden" name="appointmentId" value={consultaId} />`; em `actions.ts`, `valoresDo` passa a incluir `appointmentId: String(f.get('appointmentId') ?? '')`.

Run: `pnpm test src/modules/pacientes/atendimentos.test.ts` → PASS.

- [ ] **Step 4: Telas — presença, pendências e painel inicial**

`src/app/painel/agenda/actions.ts` (import `registrarPresenca`):

```ts
export async function presencaAction(id: string, situacao: 'realizada' | 'faltou'): Promise<ConsultaState> {
  const { ctx } = await requireNutri(`/painel/agenda/consultas/${id}`);
  try {
    await registrarPresenca(ctx, id, situacao);
  } catch (e) {
    return tratar(e, {});
  }
  revalidatePath('/painel/agenda');
  redirect(`/painel/agenda/consultas/${id}?ok=presenca`);
}
```

`src/app/painel/agenda/consultas/[id]/presenca.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import type { ConsultaState } from '../../actions';

export function PresencaForm({ realizada, faltou }: { realizada: () => Promise<ConsultaState>; faltou: () => Promise<ConsultaState> }) {
  const [sr, acaoRealizada, pr] = useActionState<ConsultaState>(realizada, {});
  const [sf, acaoFaltou, pf] = useActionState<ConsultaState>(faltou, {});
  const erro = sr.erros?.geral ?? sf.erros?.geral;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={acaoRealizada}><button disabled={pr || pf} className="rounded border px-3 py-1.5">Realizada</button></form>
      <form action={acaoFaltou}><button disabled={pr || pf} className="rounded border px-3 py-1.5">Faltou</button></form>
      {erro && <p role="alert" className="text-red-700">{erro}</p>}
    </div>
  );
}
```

Na página da consulta, `ok` ganha `sp.ok === 'presenca' ? MSG_PRESENCA.registrada`, e o comentário "Tarefa 15" vira (consulta não cancelada que já começou):

```tsx
        {c.status !== 'cancelada' && c.inicio.getTime() <= Date.now() && (
          <section aria-labelledby="presenca" className="space-y-2">
            <h2 id="presenca" className="text-lg font-semibold">Registrar presença</h2>
            <PresencaForm realizada={presencaAction.bind(null, c.id, 'realizada')} faltou={presencaAction.bind(null, c.id, 'faltou')} />
          </section>
        )}
        {ativa && (
          <p><Link href={`/painel/pacientes/${c.patientId}/atendimentos?consulta=${c.id}`} className="rounded bg-emerald-700 px-3 py-1.5 text-white">Iniciar atendimento</Link></p>
        )}
```

`src/app/painel/agenda/pendencias/page.tsx`:

```tsx
import Link from 'next/link';
import { requireNutri } from '@/lib/tenant-session';
import { MSG_PRESENCA, pendenciasDePresenca } from '@/modules/agenda/presenca';
import { Cabecalho } from '../../cabecalho';
import { ItemConsulta } from '../item-consulta';

export const dynamic = 'force-dynamic';

export default async function PendenciasPage() {
  const { ctx, tenant } = await requireNutri('/painel/agenda/pendencias');
  const lista = await pendenciasDePresenca(ctx, new Date());
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <p className="text-sm"><Link href="/painel/agenda" className="underline">Agenda</Link></p>
        <h1 className="text-2xl font-semibold">{MSG_PRESENCA.pendencias(lista.length)}</h1>
        <ul className="space-y-2">{lista.map((c) => <ItemConsulta key={c.id} c={c} fuso={tenant.fuso} dentroDeBloqueio={false} />)}</ul>
      </main>
    </>
  );
}
```

`src/app/painel/page.tsx` — seção "Agenda" (imports `indicadoresDaAgenda`, `novidadesDaAgenda`, `pendenciasDePresenca`, `textoTaxa`, `MSG_PRESENCA`, `formatarQuando`; antes do `return`: `const agora = new Date(); const [ind, pend, nov] = await Promise.all([indicadoresDaAgenda(ctx, tenant.fuso, agora), pendenciasDePresenca(ctx, agora), novidadesDaAgenda(ctx, agora)]);`):

```tsx
        <section aria-labelledby="agenda-resumo" className="space-y-2">
          <h2 id="agenda-resumo" className="text-lg font-semibold">Agenda</h2>
          <p>{`Consultas do mês: ${ind.consultasMes}`}</p>
          <p>{`Taxa de faltas do mês: ${textoTaxa(ind.taxaMes, ind.faltasMes, ind.iniciadasMes)}`}</p>
          <p>{`Mês anterior: ${textoTaxa(ind.taxaMesAnterior)}`}</p>
          {pend.length > 0 && <p><Link href="/painel/agenda/pendencias" className="underline">{MSG_PRESENCA.pendencias(pend.length)}</Link></p>}
          {(
            [
              ['Pedidos de remarcação', nov.pedidosRemarcacao],
              ['Marcadas pelo paciente (últimos 7 dias)', nov.marcadasPeloPaciente],
              ['Canceladas pelo paciente (últimos 7 dias)', nov.canceladasPeloPaciente],
            ] as const
          ).map(([titulo, lista]) =>
            lista.length ? (
              <div key={titulo}>
                <h3 className="font-medium">{titulo}</h3>
                <ul className="list-disc pl-5 text-sm">
                  {lista.map((c) => <li key={c.id}><Link href={`/painel/agenda/consultas/${c.id}`} className="underline">{`${c.paciente} — ${formatarQuando(c.inicio, tenant.fuso)}`}</Link></li>)}
                </ul>
              </div>
            ) : null,
          )}
        </section>
```

- [ ] **Step 5: LGPD da agenda — exportação e anonimização**

`src/modules/pacientes/exportacao-job.ts` — `DadosExportacao` ganha (antes de `laudosForaDoZip`):

```ts
  /** Plano 05: consultas da agenda e os lembretes enviados (canal e situação; sem texto de mensagem). */
  consultas: { inicio: string; fim: string; modalidade: string; status: string; origem: string; canceladoPor: string | null; motivoCancelamento: string | null }[];
  lembretes: { tipo: string; canal: string; status: string; enviadaEm: string | null }[];
```

e em `montarDados` (imports `appointments`, `notifications`), depois dos pedidos LGPD:

```ts
  const cs = await tx.select().from(appointments).where(eq(appointments.patientId, patientId)).orderBy(asc(appointments.inicio));
  const ns = await tx.select().from(notifications).where(eq(notifications.patientId, patientId)).orderBy(asc(notifications.agendadaPara));
```

com, no objeto `dados`:

```ts
    consultas: cs.map((c) => ({ inicio: c.inicio.toISOString(), fim: c.fim.toISOString(), modalidade: c.modalidade, status: c.status, origem: c.origem, canceladoPor: c.canceladoPor, motivoCancelamento: c.motivoCancelamento })),
    lembretes: ns.map((n) => ({ tipo: n.tipo, canal: n.canal, status: n.status, enviadaEm: n.enviadaEm?.toISOString() ?? null })),
```

Em `src/modules/pacientes/exportacao.test.ts`, no teste do `dados.json`: grave uma consulta com `consultaDireta` antes de pedir a exportação e confira `expect(dados.consultas).toHaveLength(1)` e `expect(dados.lembretes).toEqual([])`.

`src/modules/pacientes/lgpd.ts`, `anonimizarVencidos`, dentro da transação que anonimiza, logo depois do `update(patients)` (só quando `r.length`; imports `appointments`, `notifications`):

```ts
            if (r.length) {
              // D10: textos livres e destinos de mensagem do titular também saem (o número fica em provider_jid)
              await tx.update(appointments).set({ motivoCancelamento: null, linkOnline: sql`case when ${appointments.modalidade} = 'online' then 'https://anonimizado.invalid' else null end`, updatedAt: now }).where(eq(appointments.patientId, id));
              await tx.update(notifications).set({ providerJid: null, conteudoSelado: null, updatedAt: now }).where(eq(notifications.patientId, id));
            }
```

Em `src/modules/pacientes/lgpd.test.ts`, no teste "anonimiza nome, e-mail…": grave antes uma consulta cancelada com `motivoCancelamento: 'Viagem com a Ana'` e uma notificação com `providerJid: '5511912345678@s.whatsapp.net'` (ligada à consulta, com `inicioConsulta` igual ao início dela — CHECK `notifications_versao_da_consulta`); depois de `anonimizarVencidos`, confira os dois `null`.

Run: `pnpm test src/modules/pacientes src/modules/agenda`
Expected: PASS.

- [ ] **Step 6: E2E** — acrescentar a `e2e/agenda.spec.ts`

```ts
test('presença: consulta de ontem → "Faltou"; "Iniciar atendimento" → "Realizada"; indicadores no painel (US-037)', async () => {
  const ontem = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(Date.now() - 86_400_000));
  await marcar(`Dora Agenda ${sufixo} (dora-${sufixo}@ex.com)`, ontem, '07:00');
  await nutri.getByRole('button', { name: 'Faltou' }).click();
  await expect(nutri.getByRole('status').filter({ hasText: 'Presença registrada.' })).toBeVisible();
  await expect(nutri.getByRole('list', { name: 'Situação' }).getByText('Faltou')).toBeVisible();
  await marcar(`Carla Agenda ${sufixo} (carla-${sufixo}@ex.com)`, ontem, '06:00');
  const urlDaConsulta = nutri.url().split('?')[0];
  await nutri.getByRole('link', { name: 'Iniciar atendimento' }).click();
  await nutri.getByRole('button', { name: 'Registrar atendimento' }).click();
  await expect(nutri).toHaveURL(/\/atendimentos\/[0-9a-f-]{36}$/);
  await nutri.goto(urlDaConsulta);
  await expect(nutri.getByRole('list', { name: 'Situação' }).getByText('Realizada')).toBeVisible();
  await nutri.goto('/painel');
  await expect(nutri.getByText(/^Consultas do mês: \d+$/)).toBeVisible();
  await expect(nutri.getByText(/^Taxa de faltas do mês: /)).toBeVisible();
});
```

Run: `pnpm e2e:seed && pnpm test:e2e e2e/agenda.spec.ts`
Expected: PASS (9 testes).

- [ ] **Step 7: Commit**

```bash
git add src/modules/agenda src/db/schema/pacientes.ts drizzle/0061_atendimento_da_consulta.sql drizzle/0062_fk_atendimento_consulta.sql drizzle/meta src/modules/pacientes src/app/painel scripts/e2e-seed.ts e2e/agenda.spec.ts
git commit -m "feat(agenda): presença e falta, taxa de faltas (CS-03), iniciar atendimento pela agenda e LGPD da agenda (US-037)"
```

---
## Runbook do E-04 revisado — Evolution API no Easypanel (o dono faz, com confirmação a cada passo)

Não faz parte do PR: é configuração de serviço (regra do servidor: pelo Easypanel, nunca `docker service update`). Fazer **depois** do merge deste plano e **antes** de qualquer paciente real (o backup do host, P02-11, continua pré-requisito). Antes de começar: **snapshot no hPanel**.

1. **Banco da Evolution** (console do serviço `nutri_db` no Easypanel, como o superusuário do Postgres — mexe no banco de produção, então só com o OK do dono):

   ```sql
   CREATE ROLE evolution LOGIN PASSWORD '<senha gerada com: openssl rand -base64 32>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   CREATE DATABASE evolution OWNER evolution;
   ```

   O role `evolution` não recebe nenhum `GRANT` no banco `nutri` (as tabelas do NutriDebby só concedem a `nutri_app_role`). O banco `evolution` **não entra** no backup diário (`nutri-backup.sh` só copia o `nutri`): perder esse banco significa só reconectar o WhatsApp pelo QR.

2. **Serviço `nutri_evolution`** (App no projeto `nutri` do Easypanel): imagem `evoapicloud/evolution-api:v2.3.7`; **sem domínio** (só rede interna); volume em `/evolution/instances`; limite de **512 MB** de memória e 0,5 vCPU. Variáveis (nomes; os valores ficam só no Easypanel):
   - `SERVER_TYPE=http`, `SERVER_PORT=8080`, `SERVER_URL=http://<nome interno do serviço>:8080`
   - `AUTHENTICATION_API_KEY=<openssl rand -hex 32>` e `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false` (sem isso o corpo de todo webhook traz o token da instância, que envia mensagens por ela; o NutriDebby não usa esse campo — D4)
   - `DATABASE_PROVIDER=postgresql`, `DATABASE_CONNECTION_URI=postgresql://evolution:<senha>@<nome interno do nutri_db>:5432/evolution?schema=evolution_api`, `DATABASE_CONNECTION_CLIENT_NAME=nutridebby`
   - Guardar o mínimo: `DATABASE_SAVE_DATA_INSTANCE=true` e `false` em `DATABASE_SAVE_DATA_NEW_MESSAGE`, `DATABASE_SAVE_MESSAGE_UPDATE`, `DATABASE_SAVE_DATA_CONTACTS`, `DATABASE_SAVE_DATA_CHATS`, `DATABASE_SAVE_DATA_LABELS`, `DATABASE_SAVE_DATA_HISTORIC`, `DATABASE_SAVE_IS_ON_WHATSAPP`
   - Sem Redis: `CACHE_REDIS_ENABLED=false`, `CACHE_LOCAL_ENABLED=true`
   - `WEBHOOK_GLOBAL_ENABLED=false` (o webhook é por instância, com o `jwt_key` — D4)
   - `LOG_LEVEL=ERROR,WARN`, `LOG_BAILEYS=error`, `TELEMETRY_ENABLED=false`, `DEL_INSTANCE=false`, `QRCODE_LIMIT=30`, `CONFIG_SESSION_PHONE_CLIENT=NutriDebby`, `CONFIG_SESSION_PHONE_NAME=Chrome`
   - Observação de privacidade (D2): a Evolution escreve as mensagens recebidas no próprio log do container; manter a retenção de log desse serviço curta e não compartilhar o log.

3. **Variáveis do NutriDebby no Easypanel** (gerar o segredo do webhook com `openssl rand -base64 48`; as chaves do push com `npx web-push generate-vapid-keys`, uma vez, guardadas fora da VPS):
   - `nutri_app`: `EVOLUTION_API_URL=http://<nome interno do nutri_evolution>:8080`, `EVOLUTION_API_KEY` (= `AUTHENTICATION_API_KEY`), `EVOLUTION_WEBHOOK_SECRET`, `EVOLUTION_WEBHOOK_URL=http://<nome interno do nutri_app>:3000/api/webhooks/whatsapp` (**obrigatória** em produção e interna — nome do serviço, sem ponto, ou IP privado: o webhook não passa pela internet; D4 c). Só se um dia a Evolution ficar fora da VPS: URL pública + `EVOLUTION_WEBHOOK_URL_PUBLICA=1` (opção explícita; o webhook fica exposto e passa a depender só do JWT por instância e da recusa de repetição) — decidir com o dono antes.
   - O `EVOLUTION_WEBHOOK_SECRET` é o segredo-mestre: cada instância recebe um `jwt_key` derivado dele no "Conectar WhatsApp" (D4 a). Trocar o segredo exige cada consultório clicar em "Conectar WhatsApp" de novo (reconfigura o webhook; o número continua conectado) — até lá, os webhooks dessa instância dão 401.
   - `nutri_worker`: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` do suporte).
   - **Nunca** `WHATSAPP_SANDBOX` em produção (a validação recusa).
   - Reiniciar `nutri_app` e `nutri_worker` para ler as variáveis (pede confirmação; regra 3 do servidor).

4. **Conectar o número da Debby:** Painel → WhatsApp → "Conectar WhatsApp" → no celular do consultório, WhatsApp → Aparelhos conectados → Conectar um aparelho → ler o QR. A tela passa a "Conectado ao número (…)".

5. **Teste de ponta a ponta** (com o celular do dono como paciente de teste, autorizado): cadastrar com "Enviar convite por WhatsApp" → a mensagem chega; marcar uma consulta para daqui a 2 h 10 min (fora do horário silencioso) → o lembrete de 2 h chega; responder "1" → a agenda mostra "Confirmada via WhatsApp".

6. **Desligar (rollback):** remover `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` (e o segredo) do app e do worker → o WhatsApp fica desligado e os lembretes seguem por e-mail e push; o serviço `nutri_evolution` pode ser parado sem afetar o resto.

---

## Fechamento do plano (após a Tarefa 15)

- [ ] Revisão da entrega conforme o índice: revisor por tarefa (feito ao longo) → `/code-review high` no PR → corrigir → `/code-review high` (precisa sair sem problema confirmado) → `/security-review` com o **checklist reforçado** deste plano:
  - **Isolamento/RLS:** `availability_rules`, `availability_blocks`, `whatsapp_conexoes` e `public_booking_requests` com `staff_only`; `appointments`, `notifications` e `push_subscriptions` com RLS por paciente; todas na matriz de `test/isolamento.test.ts`; o papel `publico` só em funções de `src/modules/agenda` que devolvem intervalos/ids (D11) **e negado no banco** (`publico_negado` em toda tabela com `tenant_id`, inclusive as novas; só `PUBLICO_LIBERADO`, com os comandos mínimos, e a guarda `findPublicoViolations` verde); nenhum `withTenant`/`getDb()` dentro de outra transação (Review Focus 6); o `EXCLUDE` decide a corrida mesmo com pacientes que não se veem (D9); ações pelo link e pelo webhook rodam como o paciente dono da consulta (RLS), nunca como equipe.
  - **Página pública e link da consulta:** Turnstile no servidor antes de qualquer escrita de negócio; 10 tentativas/IP/hora (IP real via `TRUSTED_PROXIES`; HMAC na chave); 1 código/e-mail/min e 5/h; código de 6 dígitos com HMAC, 10 min, 5 erros; mesma resposta para e-mail cadastrado ou não; 3 consultas futuras conferidas depois do código; pedidos apagados em 24 h; corpo JSON ≤ 8 KB; o link é HMAC de 128 bits, expira no início da consulta, nunca muda estado em `GET`, tem `Referrer-Policy: no-referrer` e `noindex`; paciente arquivado, bloqueado ou anonimizado → "indisponível" no link e recusa em confirmar/cancelar/remarcar/avisar (nunca 500).
  - **Webhook do WhatsApp:** só HS256, comparação em tempo constante, `exp`/`iat`, `app`/`action`; JWT conferido com a chave **da instância do corpo** (`chaveDoWebhook`; o segredo-mestre nunca sai do app); o mesmo pedido (JWT + corpo) recusado na repetição; `connection.update` só grava número na própria instância; em produção, `EVOLUTION_WEBHOOK_URL` interna (a pública só com `EVOLUTION_WEBHOOK_URL_PUBLICA=1`); 401 sem enfileirar; corpo ≤ 256 KB; o texto do paciente reduzido a `confirmar`/`remarcar` na rota e o evento enfileirado cifrado; nada do corpo em log; idempotente (status só avança, resposta única por consulta); a resposta só vale para o `jid` do lembrete enviado nas últimas 26 h, de consulta futura e ativa.
  - **Provedor e motor de envio:** `apikey` e respostas da Evolution nunca em log ou mensagem de erro; WhatsApp e push no máximo uma vez (timeout é definitivo); cota e ritmo de 8/min por tenant; reserva canal por canal (o WhatsApp acumulado não segura e-mail/push) e parte do lote por tenant com rodízio; lembrete enviado imutável (remarcar cria linhas novas; cota e métricas não diminuem); horário silencioso também na reserva (adiado para as 08:00 ou ignorado); suspensão/reativação relidas sob trava; sandbox recusado em produção; sem variáveis, desligado.
  - **LGPD/RNF-08:** escritas em `appointments` auditadas (entidade "Agenda"); `notifications` sem texto de mensagem (só o convite, cifrado até o envio); exportação com consultas e lembretes; anonimização apaga `motivo_cancelamento`, link online e `provider_jid`; exclusão apaga as inscrições de push do vínculo; aceite do termo da página pública em `consents` (D13); `aviso-nutri.ts` só lê o e-mail da nutricionista.
  - **Logs:** nada de nome, e-mail, telefone, texto de mensagem, código, link com token, JWT ou corpo de webhook (só ids, canal, tipo, motivo e código de erro).
  Tudo na assinatura (sem `/code-review ultra`). Registrar os resumos no PR. Se sobrar problema confirmado depois da 3ª rodada, parar e avisar o dono.
- [ ] Atualizar o backlog (`2026-09-27-nutridebby-backlog.md` **e** o painel https://claude.ai/artifact/BS9jN9FitWBcMSwougt7eT): P05-01 a P05-12 (com as subtarefas P05-01a/b, P05-02a/b, P05-07a/b criadas por este plano) e o **E-04 revisado** ("Evolution API no Easypanel + conectar o número por QR", responsável: dono; runbook acima).
- [ ] Atualizar a spec para a versão seguinte à da `main` (Apêndice C e corpo) com os "Desvios conscientes" desta página: INT-01 pela Evolution (texto, JWT do `jwt_key`, variáveis `EVOLUTION_*`/`WHATSAPP_SANDBOX`, sem `GET` de verificação), D-07 → número de cada nutricionista, E-04 revisado, US-035 por resposta "1"/"2" + link assinado (selo "Confirmada pelo link"), RN-09 como limite de uso, §7 (`appointments.inicio/fim` + `EXCLUDE`, colunas novas; `notifications` com `enviando`, `provider_jid`, `enviada_em`, `erro`, `conteudo_selado`, `inicio_consulta` (UNIQUE com a consulta, o canal e o tipo; enviada imutável), o motivo `consulta_remarcada` e os tipos; RN-05 com o horário silencioso também na reserva (D7); `push_subscriptions` com `tenant_id`/`patient_id`; `consents.patient_id`; tabelas `whatsapp_conexoes`, `public_booking_requests`, `public_rate_limits`; `consultations.appointment_id`), §4.1 (papel `publico`, negado no banco por padrão; módulos `agenda` e `notificacoes`), RNF-03 (+512 MB do `nutri_evolution`), §9.6 (variáveis, com `EVOLUTION_WEBHOOK_URL` interna obrigatória em produção e `EVOLUTION_WEBHOOK_URL_PUBLICA`), US-031/US-032 (push só com inscrição; "Entrar" no Plano 06), e os textos novos de interface.
- [ ] Anotar para os próximos planos:
  - **Plano 06 (portal):** P06-02 grava `push_subscriptions` com a sessão do paciente, uma linha por vínculo ativo (contrato na Tarefa 13) e passa `VAPID_PUBLIC_KEY` ao app; P06-09 é a tela sobre `horariosParaPaciente`, `agendarComoPaciente`, `remarcarComoPaciente`, `cancelarConsulta(por: 'paciente')` e `confirmarPresenca`; a página pública ganha "Entrar (já sou paciente)"; RN-06 no PWA (sigla do fuso quando o aparelho estiver em outro); "Perfil > Notificações" grava `whatsapp_optout_em` (o envio já respeita); o portal lista as consultas do paciente com a RLS por paciente.
  - **Plano 08 (go-live):** k6 inclui a varredura de notificações; monitor externo também do `nutri_evolution` (ou alerta no painel quando a conexão cair, que já existe); retenção curta do log da Evolution; o DPA (P-02) declara a Evolution como suboperadora técnica autohospedada e o tratamento das mensagens que chegam ao número.
- [ ] Lembrar o dono: o **backup no host (P02-11, etapas 6 e 8)** segue pendente — sem ele, nada de pacientes reais; o E-04 revisado (runbook acima) é dele; o merge (= deploy) só com OK explícito e snapshot no hPanel antes.
- [ ] Pedir ao dono o merge do PR (= deploy).

---

## Autorrevisão do plano (writing-plans)

**1. Cobertura da spec**

| Requisito | Onde |
|---|---|
| US-030 "Geração de horários" (terça 08–12, 60 min → 4 horários) | Tarefa 1 (gerador puro) |
| US-030 "Bloqueio" (nenhum horário; consultas destacadas "Consulta dentro de um bloqueio") | Tarefas 1, 2 (bloqueios) e 4 (selo na agenda) |
| US-030 "Regra inválida" ("O fim deve ser depois do início") | Tarefa 2 (+ E2E) |
| US-031 "Agendar" (agendada/nutri, e-mail e push de confirmação, lembretes) | Tarefas 3, 5 (lembretes + "Consulta marcada") e 13 (push) |
| US-031 "Sobreposição" / "Fora do horário" / "Link online" | Tarefa 3 (+ E2E na 4) |
| US-031 agenda dia/semana/lista | Tarefa 4 |
| US-032 "Agendar pelo PWA" (12 h, 60 dias, origem paciente, nutri avisada) | Tarefa 6 (domínio; tela no P06-09) |
| US-032 "Corrida pelo mesmo horário" | Tarefas 3 (EXCLUDE), 6 e 8 |
| US-032 "Página pública" / "Abuso" (3 consultas, 429) / "Desativada" | Tarefa 8 (+ E2E) |
| US-033 "Dentro do prazo" / "Fora do prazo" | Tarefa 7 (domínio + página do link + E2E) |
| US-034 "Agendamento dos lembretes" / "Horário silencioso" / "Criada em cima da hora" | Tarefa 5 |
| US-034 "Falha no WhatsApp com fallback" / "Sem duplicidade" | Tarefas 5 (D6) e 10 |
| US-035 "Confirmar" / "Remarcar" / "Webhook sem assinatura válida" / "Evento repetido" | Tarefa 12 (resposta "1"/"2", JWT — desvio D3/D4) e Tarefa 7 (link) |
| US-036 80% / esgotada / virada do mês / admin amplia | Tarefa 11 |
| US-037 marcar falta / pendências / indicador | Tarefa 15 |
| US-010 "Convite também por WhatsApp" / "WhatsApp sem autorização" | Tarefa 14 |
| US-004 lembrete `tenant_suspenso` e reagendar na reativação | Tarefa 5 |
| RN-03, RN-04, RN-05, RN-06, RN-09, RN-15, RN-16, RN-17 (declaração na página pública) | Tarefas 1, 3, 5, 6, 7, 8, 11 |
| INT-01 (Evolution), INT-02 (e-mails de agenda), INT-03 (envio), INT-06 (Turnstile na página pública) | Tarefas 9–12, 5–8, 13, 8 |
| CS-03 (taxa de faltas) e métricas do admin (§3) | Tarefas 15 e 11 |
| RNF-07 (matriz de isolamento), RNF-08 (auditoria, exportação, anonimização), RNF-11 (logs) | Todas as tarefas com tabela; Tarefa 15 (LGPD da agenda) |

**2. Placeholders:** nenhum "TBD"/"implementar depois"; todo passo de código tem o código. Os trechos em prosa são trocas mecânicas em arquivos existentes (imports, `AGENDA_E2E`, `afterAll`, `deps` com `whatsapp`/`push: null`, objetos esperados de testes existentes), com o texto exato a usar.

**3. Consistência de tipos e nomes:** `Regra`/`Intervalo`/`Horario`/`Modalidade` (T1) → `lerRegras`/`lerBloqueios` (T2) → `horariosLivres` (T3) → `horariosParaPaciente`/`escolherHorario`/`HorarioEscolhido` (T6) → `horariosVisiveis`/`HorarioVisivel`/`SeletorHorarios` (T7) → página pública (T8); `TenantAgenda` (T3) em T6–T8; `ConsultaError`/`ehSobreposicao`/`lerConsultaParaEscrita`/`STATUS_ATIVOS` (T3) em T6, T7, T15; `agendarLembretes`/`avisarPaciente`/`cancelarLembretes`/`dispararEnvio` (T5) em T3, T6, T7, T12, T14; `DepsEnvio` cresce em T10 (`whatsapp`) e T13 (`push`), e os `deps(...)` dos testes anteriores são atualizados na mesma tarefa; `escolherWhatsapp` (T5 → T10 → T11, com o tipo `Devidas` da T5 e `vagasDoMinuto` da T10) e `aposEnvio` (T5 → T11) têm a versão completa a cada troca; `inicioConsulta` (T5) em toda linha de `notifications` ligada a consulta — `agendarLembretes`/`avisarPaciente` (T5), a resposta "1"/"2" (T12) e os `insert` diretos dos testes das T5, T10, T11, T12 e T15; `chaveDoWebhook` (T9) em `evolution.ts` (T9), `receberWebhook` e `e2e/whatsapp.ts` (T12); `buscarTenantPorSlug` (T8) na página pública e no E2E (T12); `PUBLICO_LIBERADO` (T3) cresce em T5 (`notifications`) e T8 (`public_booking_requests`), sempre junto do `app_allow_publico` da migration; `ProvedorWhatsapp`/`EnvioTexto`/`ResultadoEnvio` (T9) em T10 e testes; `tenantDaInstancia`/`atualizarEstadoConexao` (T9) em T12; `FINALIDADE_CONTEUDO` (T10) em T14; `chaveDosLinks`/`assinarLinkConsulta` (T5) em T7 e T10; `fallbackPorEmail` (renomeado de `aoFalhar` na T12); `MSG_AGENDA` (T1) concentra os textos das Tarefas 2–8.

**4. Review Focus:** 1 (corrida) → T3 "corrida", T6 "corrida pelo mesmo horário", T8 "horário ocupado entre o pedido e o código"; 2 (fuso/relógio) → T1 (DST, virada do mês), T5 (bordas 20:59–08:00, "em cima da hora", `adiarLembrete`, "horário silencioso na reserva"), T11 (31/10 23:30); 3 (resposta que não bate) → T12 ("nada muda", citado, repetido, 26 h, outro número); 4 (consulta mudada / worker caindo) → T5 ("alterar a hora" com linhas novas e a enviada intacta, "worker caiu no meio", suspensão, jobs fora de ordem, `consulta_remarcada` na hora do envio), T10 (timeout definitivo, fallback, 100 WhatsApps atrasados), T11 (enviar → remarcar → enviar conta 2); 5 (abuso/privacidade) → T3 (`publico` na matriz de isolamento e na guarda), T7 (paciente arquivado/bloqueado/anonimizado no link), T8 (Turnstile, 429, código, 3 consultas depois do código, mesma resposta), T9 (variáveis de produção), T12 (JWT de outra instância, segredo-mestre, repetição); 6 (uma conexão por transação) → T7 (remarcar com pool de 1 conexão).

**5. Rodada 1 do `/code-review` (PR #7) — o que mudou no plano:** (1) T9: com o sandbox e só o segredo, a regra "juntas" não vale; produção com só uma das três → erro. (2) T7: `remarcarComoPaciente` escolhe o horário antes da transação (Global Constraints e Review Focus 6; nenhum outro `withTenant`/`getDb()` aninhado no plano — `concluir`, `agendarComoPaciente`, `processarTenant` e o webhook já liam antes ou depois). (3) T5: `ignorarPendentesDoTenant` e `reagendarTenantReativado` releem o status do tenant com `FOR SHARE` na mesma transação. (4) T5/T13: horário silencioso também na reserva, adiando para as 08:00 quando faz sentido, em todos os canais (D7). (5) T9/T12: webhook com chave por instância, recusa de repetição e URL interna em produção (D4). (6) T3/T5/T8: contexto `publico` negado no banco por padrão + `PUBLICO_LIBERADO` + guarda + matriz (D11). (7) T5/T10/T11: reserva canal por canal, parte do lote por tenant e rodízio (D6). (8) T5/T11/T12: `inicio_consulta` na chave única, enviada imutável, `consulta_remarcada` (D6/D17). (9) T8/T12: `buscarTenantPorSlug` em `tenant-status.ts`, usada pela página pública e pelo E2E. (10) T7: paciente inativo/bloqueado/anonimizado no link da consulta.

## Execução

Recomendado: **subagent-driven** (uma tarefa por subagente, revisor por tarefa, revisão do PR no fim) — as 15 tarefas dependem umas das outras por interfaces bem definidas (o motor de envio da T5 é estendido em T10, T11 e T13), e um erro de RLS, de corrida, de assinatura do webhook ou de envio duplicado é caro de desfazer em produção.
