# Plano 02 — Plataforma (M1): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o M1 completo sobre a Fundação: e-mail transacional com fila e novas tentativas, admin criando/suspendendo contas de nutricionista com convite de 72 h e aceite do DPA, auditoria automática de dado de saúde, armazenamento em `/data` com cota e URL assinada, perfil e marca, Turnstile validado no servidor e backup diário criptografado no R2 — tudo testado sem depender de Resend, R2 ou Turnstile reais.

**Architecture:** O app (Next.js) só **enfileira** trabalho no pg-boss (inclusive dentro da transação do negócio, via `fromDrizzle`); o worker renderiza e envia e-mails (Resend em produção, Mailpit em dev/CI), com o conteúdo do job cifrado (AES-256-GCM, `ENCRYPTION_KEY`) para que nenhum link com token fique em claro no banco. Escritas em tabelas de saúde são auditadas por gatilho (`app_enable_audit`) com ator e IP vindos do `withTenant`; leituras, por `auditRead()` na mesma transação; uma guarda no CI quebra se uma tabela com `patient_id` ficar sem gatilho. Arquivos vão para `DATA_DIR` com tipo detectado pelo conteúdo, reserva atômica de cota em `tenants.armazenamento_bytes` e download só por URL HMAC de 5 min. Suspensão = `tenants.status` + sessões revogadas + bloqueio no login (hook do Better Auth) e em `requireUser`/`requireApiUser`. O backup roda **no host** (systemd às 03h): `pg_dump` dentro do container `nutri_db` + `rclone crypt` para o R2; o worker só confere se o backup do dia aconteceu e alerta (e-mail) — junto com o alerta de disco em 70%.

**Tech Stack:** Node 24 · pnpm 12 · Next.js 16.3 · React 19.2 (`react-dom/server` para os e-mails) · PostgreSQL 16 · Drizzle 0.45 · Better Auth 1.7.6 · pg-boss 12.34 · Zod 4 · pino · `resend` (SDK) · `sharp` 0.35.4 (já na imagem via Next) · Vitest 5 + Testcontainers · Playwright 1.63 · Mailpit v1.27 · rclone (host e CI) · systemd.

**Spec:** [`../specs/2026-09-27-nutridebby-mvp-design.md`](../specs/2026-09-27-nutridebby-mvp-design.md) (v1.3) e [`../specs/2026-09-27-nutridebby-mvp-historias.md`](../specs/2026-09-27-nutridebby-mvp-historias.md). Índice: [`2026-09-27-nutridebby-00-indice.md`](2026-09-27-nutridebby-00-indice.md). Backlog: [`2026-09-27-nutridebby-backlog.md`](2026-09-27-nutridebby-backlog.md) (P02-01 a P02-11).

## Global Constraints

- Tudo do Plano 01 continua valendo: Node 24, TypeScript `strict`, pnpm com `--frozen-lockfile` no CI, `src/proxy.ts` (não `middleware.ts`), porta **3100** em dev/E2E local (a 3000 da VPS é o painel do Easypanel), **3000** em containers e CI.
- RNF-07 / §4.1: toda tabela com `tenant_id` passa por `withTenant` e ganha migration com `app_enable_tenant_rls` (e `app_enable_patient_rls` se tiver `patient_id`); a guarda `src/db/rls-guard.test.ts` continua passando. O admin **nunca** consulta tabelas 🔒: métricas vêm de uma função `SECURITY DEFINER` que "devolve **só contagens** por tenant". Tabelas sem `tenant_id` (`tenants`, `user`, `invites`, `consents`, `backup_runs`) só são acessadas pelos services de `src/modules/plataforma`.
- Migrations rodam com `DATABASE_URL_MIGRATOR` (em produção, `nutri_owner` sem superusuário). Nada neste plano pode exigir superusuário na migration.
- RNF-08: "auditoria de leitura/alteração de prontuário (quem, ação, entidade, IP, quando)". `audit_log` é append-only ("`REVOKE UPDATE, DELETE` do role da aplicação").
- US-007: "Então vejo os acessos a P em ordem decrescente, com paginação de 50 itens"; aba "Histórico de acessos".
- US-001: campos e erros exatos — "Informe o nome (3 a 80 caracteres)", "E-mail já cadastrado", "CRN inválido. Ex.: CRN-3 12345" (regex `^CRN-?\d{1,2}\s?\d{3,6}$`, sem diferenciar maiúsculas), "Endereço já em uso" (slug `^[a-z0-9-]{3,40}$`); tenant criado com status "ativa" e `wa_cota_mensal` 500; usuário `nutri` "criado sem senha"; convite "com link válido por 72 h"; expirado: "Convite expirado. Peça um novo ao suporte."; botão "Reenviar convite".
- US-002: primeiro acesso = definir senha + aceitar o DPA → `/painel` e `tenants.dpa_aceito_em` preenchido; senha com "mínimo de 10 caracteres, pelo menos 1 letra e 1 número" e fora das 10 mil mais comuns; recuperação sempre responde "Se o e-mail estiver cadastrado, você receberá um link"; link de recuperação "vale por 1 h e só pode ser usado uma vez".
- US-004 / RN-15: "Tenant suspenso: nutricionista e pacientes veem a tela *"Conta temporariamente indisponível"*; o worker não envia notificações desse tenant; os dados ficam intactos".
- US-005: logo "PNG/JPEG/SVG ≤ 2 MB; redimensionado para no máx. 512 px"; `cor_primaria` `^#[0-9a-fA-F]{6}$` com "contraste ≥ 4,5:1 com branco (senão: "Cor muito clara para texto branco")"; `antecedencia_min_h` e `cancelamento_min_h` "inteiro 0–72".
- RN-18 / RNF-13: "Cota de armazenamento: 5 GB por tenant"; "Em 80%, aviso à nutricionista; em 100%, novos uploads são recusados com *"Espaço de armazenamento esgotado. Fale com o suporte."*"; "alerta ao admin com o disco da VPS em 70%".
- RNF-06 / §4: uploads "validados pelo conteúdo real do arquivo (*magic bytes*), não pela extensão"; arquivos "servidos só por URL assinada, TTL 5 min".
- INT-02: e-mail por Resend (`RESEND_API_KEY`, remetente `EMAIL_FROM`); "Retry: 3 tentativas. Em dev, tudo vai para o **Mailpit**."
- INT-06: token validado em `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` com `TURNSTILE_SECRET_KEY` "antes de qualquer escrita"; fora do ar → "Tente novamente em alguns minutos" e **não** aceita envio sem verificação. Vale para a recuperação de senha já neste plano.
- RNF-05: às 03h (America/Sao_Paulo), `pg_dump` criptografado (rclone crypt) no R2, "retenção de 7 diários + 4 semanais"; `/data` com "`rclone sync` + `--backup-dir` datado (arquivos alterados ou apagados ficam 30 dias)"; "Dados excluídos por LGPD somem dos backups em até 35 dias; RPO 24 h; RTO 4 h".
- RNF-11 / CLAUDE.md regra 3: senha, token, cookie, link com token e dado de saúde nunca vão para log, e-mail de alerta ou mensagem de erro.
- Textos de interface em pt-BR, com o texto exato da spec quando existir; formulários acessíveis (`<label for>`, `aria-invalid`, `aria-describedby`, erro em `role="alert"`).
- Custo zero: só planos gratuitos (Resend free, R2 free, Turnstile, GHCR 500 MB). Nenhum serviço pago, nenhum `/code-review ultra`. A imagem Docker tem orçamento no CI (Tarefa 1): **≤ 260 MB comprimida**, para caberem 2 versões no GHCR grátis.
- Dependências novas (exatamente estas): `resend` (Tarefa 2) e `sharp` como dependência direta na **mesma versão que o Next já instala** (0.35.4, Tarefa 10). O pnpm tem *minimum-release-age*: usar a versão mais nova que o gate aceitar, com `--save-exact`, e registrar a versão no commit.
- Regras do servidor (`/home/deploy/servidor/CLAUDE.md`): configuração de serviço só pelo painel do Easypanel; **confirmar com o dono antes** de reiniciar serviço, mexer no banco de produção, firewall, SSH ou instalar pacotes; nunca reiniciar o Easypanel; lembrar do snapshot no hPanel antes de mudança arriscada; nunca exibir segredos (só o nome da variável).
- Itens externos ainda não feitos (E-05 Resend+DNS, E-06 R2+Turnstile, E-10 swap/rclone, P01-13 serviços no Easypanel): **nenhuma tarefa de código depende deles**. Tudo que precisa deles fica na Tarefa 14 (runbook), executada com o dono e **nunca por subagente**.
- Política de revisão por entrega (índice): revisor por tarefa → `/code-review high` → correções → `/code-review high` (limpo) → `/security-review` com checklist reforçado (uploads, autenticação, LGPD, Turnstile, isolamento admin/tenant); merge só com OK explícito do dono.

### Decisões de desenho (tomadas neste plano)

| Tema | Decisão | Custo / consequência |
|---|---|---|
| **Onde roda o backup (P02-10)** | **No host**, por `systemd` (timer às 03:00 America/Sao_Paulo): `pg_dump -Fc` executado **dentro do container `nutri_db`** (`docker exec`, superusuário local, sem senha nova) com a saída em pipe para `rclone rcat` num remoto `crypt` sobre o R2; `/data` com `rclone sync --backup-dir`. O script fica versionado em `scripts/backup/` e é testado no CI. O worker não faz backup: lê a tabela `backup_runs` e alerta se o dia passou sem backup. | (1) Imagem não cresce: `postgresql-client-16` + `rclone` na imagem somariam ≈ 40 MB comprimidos **por versão**, levando 2 versões para ≈ 480 MB dos 500 MB grátis do GHCR, sem folga para `@react-pdf/renderer`, `heic-convert`, `web-push` e Sentry dos próximos planos. (2) `pg_dump` pelo worker exigiria um role com `BYPASSRLS` (a RLS é `FORCE`), contrariando "o worker usa o mesmo role da aplicação (sem `BYPASSRLS`)". (3) Custo: configuração fora do Easypanel (arquivo `/etc/nutri-backup/backup.env` 600 root com as chaves do R2 e a senha do crypt, unidade systemd) — instalada uma vez, com confirmação do dono; `rclone` no host passa a ser obrigatório (E-10). Registrado como desvio. |
| **Alvo S3 nos testes** | **Backend `local` do rclone** (remoto `crypt` sobre uma pasta temporária), sem MinIO. | CI instala `rclone` por `apt` (≈ 5 s); MinIO via Testcontainers custaria ≈ 60 MB de pull e ~5 s de subida por execução e ainda assim não reproduz as manias do R2. O app não usa S3 (uploads ficam em `/data`), então não há SDK S3 a testar. O remoto R2 real é conferido uma vez no runbook (primeiro backup + restauração de conferência). |
| **Suspensão** | `tenants.status = 'suspensa'` + **revogação das sessões** das usuárias do tenant na mesma transação + **bloqueio no login** (`databaseHooks.session.create.before` lança `CONTA_SUSPENSA`) + **checagem em cada requisição** (`requireUser` → decisão `suspended` → `/indisponivel`; `requireApiUser` → 403). Worker: `tenantIsActive()` antes de enviar. | 1 consulta por PK a mais por página autenticada de nutricionista. Pacientes: a checagem por vínculo entra no Plano 06 (a paciente escolhe a nutricionista); a API já aceita o `tenantStatus`. |
| **API de auditoria** | Escrita automática por **gatilho** `audit_row_change` instalado com `SELECT app_enable_audit('<tabela>', '<entidade>')` (lê `app.user_id`/`app.ip` que o `withTenant` define); leitura explícita com `auditRead(tx, { entidade, entidadeId, patientId })` na mesma transação da consulta; ações especiais (`exportar`, `bloquear`, `anonimizar`) com `recordAudit(tx, …)`. `audit_log` ganha `patient_id` para o histórico por paciente. Guarda `findAuditViolations` no CI: toda tabela com `patient_id` (e `patients`) precisa do gatilho. | Planos 03+ só precisam: (a) criar a tabela, (b) `app_enable_audit` na migration de RLS, (c) chamar `auditRead` ao devolver dado de saúde. Esquecer (b) quebra o CI. |
| **Fila de e-mail** | pg-boss, fila `email` com `retryLimit: 3`, `retryBackoff` a partir de 60 s, `expireInSeconds: 60`, jobs concluídos apagados em 1 dia. Payload = `{ tenantId, selado }`, em que `selado` é a mensagem inteira cifrada (AES-256-GCM, AAD `email-job`). Envio **transacional** quando há escrita junto (`enqueueEmail(msg, { tx })` usa `fromDrizzle`). Idempotência no Resend com `Idempotency-Key = id do job`. | App e worker precisam de `ENCRYPTION_KEY`. Um job de tenant suspenso é concluído sem enviar (RN-15). |
| **Modelos de e-mail** | Componentes React próprios renderizados com `react-dom/server` (`renderToStaticMarkup`), versão texto escrita à mão. | Ver desvio "React Email". Zero dependência nova. |

### Desvios conscientes da spec (registrados aqui; atualizar a spec no fim do plano — v1.4)

| Spec | Neste plano | Motivo |
|---|---|---|
| RNF-05 / §4 / §9.2: backup é "Job do worker às 03h"; "a imagem inclui postgresql-client-16 e rclone" | Backup no **host** via systemd; `pg_dump` dentro do container `nutri_db`; `rclone` no host; o worker só verifica (`backup_runs`) e alerta | Orçamento do GHCR grátis e isolamento (sem `BYPASSRLS` no worker). Metas do RNF-05 (03h, crypt, 7+4, 30 dias, 35 dias LGPD, RPO/RTO) mantidas. Ver "Decisões de desenho" |
| §9.6: `R2_*` e `BACKUP_PASSPHRASE` como variáveis do Easypanel | Ficam só em `/etc/nutri-backup/backup.env` (root, 600) no host, no formato `RCLONE_CONFIG_*` | Consequência do backup no host; a senha do crypt também fica guardada fora da VPS pelo dono (sem ela o backup é irrecuperável) |
| INT-02 / §9.1: "Modelos em React Email" | Componentes React próprios + `react-dom/server` | Em 2026-04 os pacotes `@react-email/*` (inclusive `components` e cada componente) foram marcados como *no longer supported*; o substituto `react-email@6` leva o CLI de preview (esbuild, babel, socket.io, prettier, tailwind) para as dependências de produção, estourando o orçamento da imagem |
| INT-02: "Retry: 3 tentativas" | `retryLimit: 3` (3 **novas** tentativas, backoff exponencial a partir de 60 s) | Mesma leitura do INT-01 ("3 novas tentativas") |
| §9.6 | Variáveis novas: `EMAIL_TRANSPORT` (`resend`/`mailpit`; padrão `resend` em produção) e `MAILPIT_URL` (dev/CI) | O CI roda o E2E com `NODE_ENV=production` e precisa do Mailpit |
| §7 `audit_log` | Coluna nova `patient_id` (nula) + política `patient_isolation` | "Histórico de acessos" de P precisa incluir leituras/alterações de tabelas filhas (antropometria, exames…), não só `entidade = 'patients'` |
| §7 | Tabelas novas: `invites` (convite com hash do token), `consents` (já prevista, criada agora para o DPA), `stored_files` 🔒 (arquivos e cota), `backup_runs`; `tenants.dpa_versao` | Convite de uso único com hash; aceite versionado do DPA; controle de cota e de caminhos; verificação do backup |
| US-004 "o lembrete pendente passa a status 'ignorada' com motivo 'tenant_suspenso'" e reagendamento na reativação | Entram no **P05-06** (a tabela `notifications` nasce no Plano 05). Aqui: `tenantIsActive()` e o job de e-mail que ignora tenant suspenso | Não existe lembrete antes do Plano 05 |
| US-005 "Marca aplicada" no PWA e no PDF | Aplicada no **painel** aqui; PWA no Plano 06 e PDF no P04-09, consumindo `getTenantBrand()` | PWA e PDF ainda não existem |
| US-007 aba "Histórico de acessos" no prontuário | Service `listAccessHistory` + componente `HistoricoAcessos` prontos e testados; a aba é montada no prontuário no **P03-01** | O prontuário nasce no Plano 03 |
| §3 métricas "nº de pacientes, consultas, mensagens enviadas" | `admin_tenant_metrics()` já devolve essas colunas, com `NULL` até as tabelas existirem (Planos 03/05 trocam o corpo da função); conta de verdade `arquivos` e `armazenamento_bytes` | Tabelas ainda não existem; a assinatura fica estável para a tela |
| P-02 texto do DPA | Texto **provisório** versionado (`DPA_VERSAO = '0.1-provisorio'`); o P08-06 publica o texto do advogado com nova versão, o que obriga novo aceite | Texto jurídico pendente (E-09) |
| E-10 "`postgresql-client-16` no host" | Não é necessário no Plano 02 (a restauração de conferência usa o `pg_restore` do próprio container `nutri_db`); fica para o P08-04 | Uma instalação a menos no host agora |

### Itens adiados do Plano 01

**Incorporados** (a tarefa que resolve está entre parênteses):
- Tokens de redefinição guardados em claro em `verification.identifier` → `verification.storeIdentifier: 'hashed'` (Tarefa 3).
- "Esqueci minha senha" só registrava aviso no log → envia o e-mail pela fila (Tarefa 3).
- Sem aviso quando `NODE_ENV=production` e `TRUSTED_PROXIES` vazio → falha na inicialização (Tarefa 1).
- "válido por 1 hora" fixo no texto do `admin:criar` → derivado de `RESET_TOKEN_TTL_S` (Tarefa 3).
- `assertContext` sem lista de papéis em tempo de execução → lista explícita (Tarefa 4).
- Mapas de exceção das guardas não conferem se a tabela existe → `findStaleExceptions` (Tarefa 4).
- `shutdown()` do worker sem proteção contra reentrada → memoizado (Tarefa 1).
- Corrida "confere e insere" do `admin:criar` vira erro genérico → `uniqueViolation()` mapeia a constraint (Tarefa 5).
- Crescimento da imagem (o `@swc/core` do spike já custou ≈ 21 MB) → orçamento de tamanho no CI (Tarefa 1).

**Não incorporados** (motivo):
- `.gitignore` reordenado pelo `sort -u` — cosmético, sem efeito.
- Teste de idempotência das migrations não reaplica SQL cru; `ensureAppLogin` fora de transação; teste de `CREATEDB` altera o role compartilhado — infraestrutura do Plano 01 que este plano não toca; cada comando já é idempotente.
- FK `audit_log.tenant_id` com `ON DELETE NO ACTION` — correto: tenants nunca são apagados (suspensão preserva dados, RN-15).
- Normalização da política de senha (trim, faixa `À-ÿ`) — sem risco de segurança; vai para a revisão geral do P08-05.
- Texto "banco indisponível" quando só a leitura do heartbeat falha; E2E de `/api/health` — entram com o monitor externo (P08-02).
- MCP `postgres-dev` com `--network host` — só dev, modo restrito.
- Publicação/poda do `deploy.yml` nunca executada ao vivo — é verificada no primeiro deploy (P01-13), pré-requisito da Tarefa 14.
- Ícones do manifest — Plano 06.

## Review Focus

1. **E-mail e slug digitados com maiúsculas e espaços na criação da conta** (`"  Debby@Exemplo.COM "`, `" Debby "`) — precisam virar `debby@exemplo.com` / `debby`, o login precisa funcionar com qualquer caixa e a duplicidade tem de ser detectada sem diferenciar maiúsculas (inclusive em corrida entre dois admins). Teste na Tarefa 5.
2. **O mesmo convite enviado duas vezes ao mesmo tempo** (duplo clique, duas abas, link reenviado) — só uma senha é gravada, só uma conta de credencial existe, e a segunda tentativa vê "convite inválido". Teste na Tarefa 6.
3. **Arquivo com tipo mentido** (HTML ou SVG com `<script>` renomeado para `.png`; PDF enviado como logo; SVG com `<!ENTITY>`) — recusado pelo conteúdo, nunca servido com tipo que o navegador execute; o SVG aceito vira PNG sem script. Testes nas Tarefas 8 e 10.
4. **Dois uploads simultâneos perto do limite de 5 GB** — só um passa; o contador nunca passa de 5 GB nem fica negativo, e falha na gravação do arquivo devolve a reserva. Teste na Tarefa 8.
5. **Aba da nutricionista aberta no momento da suspensão** (Server Action ou upload enviados depois) — a ação é bloqueada, a sessão antiga não vale mais e o novo login leva a "Conta temporariamente indisponível". Testes na Tarefa 7.

---

## Estrutura de arquivos

```
.
├── .github/workflows/ci.yml                 # T1 (orçamento da imagem, env), T3 (Mailpit no E2E), T12 (rclone no job de teste)
├── Dockerfile                               # T1, T8, T11 (variáveis só de build)
├── CLAUDE.md                                # T4 (auditoria), T8 (arquivos), T12 (backup no host)
├── next.config.ts                           # T1 (serverExternalPackages: pg-boss)
├── playwright.config.ts                     # T3 (worker junto do next start)
├── drizzle/                                 # T4, T5, T6, T8, T9, T12
├── e2e/
│   ├── helpers.ts                           # T6 — login de admin com ativação de 2FA
│   ├── mailpit.ts                           # T3 — lê e-mails do Mailpit
│   ├── recuperacao.spec.ts                  # T3 (T11 acrescenta o Turnstile)
│   └── plataforma.spec.ts                   # T6, T7, T10
├── scripts/
│   ├── admin-criar.ts                       # T3 (texto derivado do TTL)
│   ├── e2e-seed.ts                          # T3, T6
│   └── backup/{nutri-backup.sh,nutri-backup.service,nutri-backup.timer}   # T12
├── test/
│   ├── global-setup.ts                      # T4 (fixture de auditoria), T12 (id do container)
│   ├── setup.ts                             # T1, T2, T8, T11
│   ├── sessao.ts                            # T6 — criar usuário e entrar pelo handler real (testes)
│   ├── isolamento.test.ts                   # T8 — matriz de isolamento de todas as tabelas 🔒
│   └── backup.test.ts                       # T12
└── src/
    ├── env.ts                               # T1, T2, T8, T11
    ├── components/campo.tsx                 # T5 — campo de formulário acessível
    ├── components/turnstile-widget.tsx      # T11
    ├── db/
    │   ├── errors.ts                        # T5 — uniqueViolation
    │   ├── tenant.ts                        # T4 — ator, IP, papéis
    │   ├── audit-guard.ts                   # T4
    │   ├── rls-guard.ts                     # T4 — findStaleExceptions
    │   └── schema/{platform,access,auth,index}.ts   # T4, T5, T6, T8, T12
    ├── email/{types.ts,templates.tsx,transport.ts,queue.ts,job.ts}   # T2
    ├── jobs/{queues.ts,boss.ts}             # T1
    ├── lib/
    │   ├── crypto.ts · ip.ts                # T1
    │   ├── validacao.ts                     # T5
    │   ├── corpo.ts                         # T10 — corpo da requisição com limite
    │   ├── request-ip.ts · tenant-session.ts  # T6
    │   ├── api-auth.ts                      # T7
    │   ├── file-type.ts · signed-url.ts · format.ts   # T8
    │   ├── turnstile.ts                     # T11
    │   ├── session-rules.ts · session.ts    # T7
    │   ├── auth.ts                          # T3, T7, T11
    │   └── password-links.ts                # T3
    ├── modules/plataforma/
    │   ├── tenant-status.ts                 # T2
    │   ├── audit.ts · ui/historico-acessos.tsx   # T4
    │   ├── convites.ts · contas.ts          # T5
    │   ├── dpa.ts                           # T6
    │   ├── suspensao.ts                     # T7
    │   ├── armazenamento.ts                 # T8
    │   ├── metricas.ts                      # T9
    │   ├── marca.ts · logo.ts               # T10
    │   └── monitoramento.ts                 # T13
    ├── worker/index.ts                      # T1, T2, T13
    └── app/
        ├── admin/{page.tsx,actions.ts,confirmar-botao.tsx,cota-form.tsx,painel-infra.tsx}   # T5, T7, T9, T13
        ├── admin/contas/nova/{page.tsx,form.tsx}   # T5
        ├── convite/[token]/{page.tsx,form.tsx,actions.ts}   # T6
        ├── indisponivel/page.tsx            # T7
        ├── painel/{page.tsx,actions.ts,cabecalho.tsx}   # T6, T8, T10
        ├── painel/dpa/{page.tsx,form.tsx}   # T6
        ├── painel/configuracoes/{page.tsx,perfil-form.tsx,logo-form.tsx}   # T10
        ├── esqueci-senha/{page.tsx,form.tsx}   # T11
        ├── api/arquivos/route.ts            # T8
        └── api/painel/marca/logo/route.ts   # T10
```

**Ordem e dependências das tarefas:** 1 → 2 → 3 (e-mail) · 4 (auditoria, depende só do Plano 01) · 5 → 6 → 7 (contas, convite, suspensão; usam 2 e 4) · 8 → 9 → 10 (arquivos, métricas, marca) · 11 (Turnstile; muda a tela da Tarefa 3) · 12 → 13 (backup e monitoramento) · 14 (runbook com o dono, por último).

---
### Task 1: Base — variáveis por processo, cofre de segredos, IP do cliente e fila compartilhada (P02-01a)

**Files:**
- Create: `src/lib/crypto.ts`, `src/lib/crypto.test.ts`, `src/lib/ip.ts`, `src/lib/ip.test.ts`, `src/jobs/queues.ts`, `src/jobs/boss.ts`, `src/jobs/boss.test.ts`
- Modify: `src/env.ts`, `src/env.test.ts`, `src/worker/index.ts`, `next.config.ts`, `test/setup.ts`, `.env.example`, `Dockerfile:13-17`, `.github/workflows/ci.yml` (jobs `e2e` e `image`)

**Interfaces:**
- Consumes: `getPool(): Pool`, `getDb(): Db`, `closeDb()` (`@/db/client`); `recordHeartbeat(db)` (`@/worker/heartbeat`); `logger` (`@/lib/logger`); `getIP(req, options)` exportado por `better-auth/api`.
- Produces:
  - `@/env`: `encryptionKeySchema` (Zod), `Env` passa a ter `ENCRYPTION_KEY: string` e exige `TRUSTED_PROXIES` em produção; `type WorkerEnv = { NODE_ENV; DATABASE_URL; LOG_LEVEL; APP_URL: string; ENCRYPTION_KEY: string }`, `parseWorkerEnv(source)`, `getWorkerEnv(): WorkerEnv`.
  - `@/lib/crypto`: `randomToken(bytes = 32): string` (base64url), `sha256(value: string): string` (base64url), `safeEqual(a: string, b: string): boolean`, `encryptionKey(): Buffer`, `sealSecret(plain: string, finalidade: string, key?: Buffer): string`, `openSecret(sealed: string, finalidade: string, key?: Buffer): string`, `class SealError`.
  - `@/lib/ip`: `clientIp(h: Headers, trustedProxies: string[]): string | null`.
  - `@/jobs/queues`: `QUEUES` (nome → opções do pg-boss), `type QueueName`, `ensureQueues(boss: PgBoss): Promise<void>`.
  - `@/jobs/boss`: `getBoss(): Promise<PgBoss>` (produtor: sem supervisão nem agendamento), `useBoss(boss: PgBoss): void` (o worker registra a instância dele), `stopBoss(): Promise<void>`.
  - `@/worker/index`: `startWorker(env: WorkerEnv): Promise<() => Promise<void>>` (a função de parada é idempotente).

- [ ] **Step 1: Testes que falham do ambiente** — acrescentar ao `src/env.test.ts` (e trocar o `base` e o import no topo):

```ts
import { parseEnv, parseMigratorEnv, parseServerEnv, parseWorkerEnv } from './env';

const KEY = Buffer.alloc(32, 7).toString('base64');

const base = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL,
  AUTH_SECRET: 'x'.repeat(32),
  ENCRYPTION_KEY: KEY,
};

describe('parseEnv — Plano 02', () => {
  it('recusa ENCRYPTION_KEY ausente ou que não tem 32 bytes em base64', () => {
    expect(() => parseEnv({ ...base, ENCRYPTION_KEY: undefined })).toThrow(/ENCRYPTION_KEY é obrigatória/);
    expect(() => parseEnv({ ...base, ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/32 bytes/);
  });
  it('em produção exige TRUSTED_PROXIES (item adiado do Plano 01)', () => {
    expect(() => parseEnv({ ...base, NODE_ENV: 'production' })).toThrow(/TRUSTED_PROXIES é obrigatória em produção/);
    expect(parseEnv({ ...base, NODE_ENV: 'production', TRUSTED_PROXIES: '10.0.1.0/24' }).TRUSTED_PROXIES).toEqual(['10.0.1.0/24']);
  });
  it('recusa TRUSTED_PROXIES com item que não é IP nem CIDR', () => {
    expect(() => parseEnv({ ...base, TRUSTED_PROXIES: '10.0.0.0/8, rede-do-traefik' })).toThrow(/IPs\/CIDRs/);
  });
});

describe('parseWorkerEnv (worker)', () => {
  it('exige APP_URL e ENCRYPTION_KEY, mas não AUTH_SECRET nem DATABASE_URL_MIGRATOR', () => {
    const env = parseWorkerEnv({ DATABASE_URL, APP_URL: 'http://localhost:3100', ENCRYPTION_KEY: KEY });
    expect(env).toMatchObject({ APP_URL: 'http://localhost:3100', ENCRYPTION_KEY: KEY });
    expect(env).not.toHaveProperty('AUTH_SECRET');
    expect(() => parseWorkerEnv({ DATABASE_URL, ENCRYPTION_KEY: KEY })).toThrow(/APP_URL/);
  });
});
```

Run: `pnpm test src/env.test.ts`
Expected: FAIL — `parseWorkerEnv` não existe e os novos casos de `parseEnv` falham.

- [ ] **Step 2: Implementar em `src/env.ts`** — acrescentar depois de `postgresUrl` e substituir `appSchema`; acrescentar `workerSchema` e os exports:

```ts
/** 32 bytes em base64 (gere com `openssl rand -base64 32`): chave AES-256 dos segredos guardados na fila. */
export const encryptionKeySchema = z
  .string({ message: 'ENCRYPTION_KEY é obrigatória' })
  .refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'ENCRYPTION_KEY deve ter 32 bytes em base64 (gere com: openssl rand -base64 32)',
  });

const IP_OU_CIDR = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;
```

```ts
/** App Next.js e admin:criar (Better Auth). */
const appSchema = serverSchema
  .extend({
    APP_URL: z.url({ message: 'APP_URL deve ser uma URL (ex.: https://app.exemplo.com)' }),
    AUTH_SECRET: z.string({ message: 'AUTH_SECRET é obrigatória' }).min(32, {
      message: 'AUTH_SECRET precisa de pelo menos 32 caracteres',
    }),
    ENCRYPTION_KEY: encryptionKeySchema,
    // CIDRs dos proxies confiáveis (rede do Traefik/Swarm em produção); vazio em dev/test
    TRUSTED_PROXIES: z
      .string()
      .optional()
      .transform((v) =>
        (v ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      .refine((l) => l.every((c) => IP_OU_CIDR.test(c)), {
        message: 'TRUSTED_PROXIES deve ser uma lista de IPs/CIDRs separados por vírgula',
      }),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && e.TRUSTED_PROXIES.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUSTED_PROXIES'],
        message:
          'TRUSTED_PROXIES é obrigatória em produção (CIDR da rede do Traefik/Swarm); sem ela o limite de tentativas vira um balde global',
      });
    }
  });

/** Worker: banco com o role da aplicação + o que os jobs usam (links nos e-mails, segredos da fila). */
const workerSchema = serverSchema.extend({
  APP_URL: z.url({ message: 'APP_URL deve ser uma URL (ex.: https://app.exemplo.com)' }),
  ENCRYPTION_KEY: encryptionKeySchema,
});
```

E, junto dos outros tipos e funções:

```ts
export type WorkerEnv = z.infer<typeof workerSchema>;
export const parseWorkerEnv = (source: Source): WorkerEnv => parseWith(workerSchema, source);

let cachedWorker: WorkerEnv | undefined;
/** Ambiente do worker (falha rápido na subida se faltar algo). */
export function getWorkerEnv(): WorkerEnv {
  return (cachedWorker ??= parseWorkerEnv(process.env));
}
```

Run: `pnpm test src/env.test.ts`
Expected: PASS (inclusive os testes antigos de `parseServerEnv`, que não mudam).

- [ ] **Step 3: Teste que falha do cofre de segredos** — `src/lib/crypto.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { openSecret, randomToken, safeEqual, sealSecret, SealError, sha256 } from './crypto';

const key = Buffer.alloc(32, 1);
const outra = Buffer.alloc(32, 2);

describe('cofre de segredos (AES-256-GCM)', () => {
  it('abre o que selou, e o selado não contém o texto', () => {
    const link = 'https://app.exemplo.com/convite/abc123-token';
    const s = sealSecret(link, 'email-job', key);
    expect(s).toMatch(/^v1\./);
    expect(s).not.toContain('abc123');
    expect(openSecret(s, 'email-job', key)).toBe(link);
  });
  it('dois selos do mesmo texto são diferentes (IV aleatório)', () => {
    expect(sealSecret('x', 'f', key)).not.toBe(sealSecret('x', 'f', key));
  });
  it('recusa chave errada, finalidade errada e conteúdo adulterado', () => {
    const s = sealSecret('segredo', 'email-job', key);
    expect(() => openSecret(s, 'email-job', outra)).toThrow(SealError);
    expect(() => openSecret(s, 'outra-finalidade', key)).toThrow(SealError);
    const [v, iv, ct, tag] = s.split('.');
    const adulterado = [v, iv, ct.slice(0, -2) + (ct.endsWith('AA') ? 'BA' : 'AA'), tag].join('.');
    expect(() => openSecret(adulterado, 'email-job', key)).toThrow(SealError);
    expect(() => openSecret('lixo', 'email-job', key)).toThrow(SealError);
  });
  it('selo de texto vazio também funciona', () => {
    expect(openSecret(sealSecret('', 'f', key), 'f', key)).toBe('');
  });
});

describe('tokens e hash', () => {
  it('randomToken tem 256 bits em base64url', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
  });
  it('sha256 é determinístico e não devolve o valor original', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toContain('abc');
    expect(sha256('abc')).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0');
  });
  it('safeEqual compara sem atalho e aceita tamanhos diferentes', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
```

Run: `pnpm test src/lib/crypto.test.ts`
Expected: FAIL — `Cannot find module './crypto'`.

- [ ] **Step 4: Implementar** — `src/lib/crypto.ts`

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { encryptionKeySchema } from '@/env';

export class SealError extends Error {
  override name = 'SealError';
}

/** Token aleatório de `bytes` bytes em base64url (padrão: 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 em base64url — para guardar tokens de alta entropia sem guardá-los em claro. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

let cachedKey: Buffer | undefined;
/** Chave de ENCRYPTION_KEY (validada), usada pelo app e pelo worker. */
export function encryptionKey(): Buffer {
  return (cachedKey ??= Buffer.from(encryptionKeySchema.parse(process.env.ENCRYPTION_KEY), 'base64'));
}

/**
 * AES-256-GCM. A `finalidade` entra como AAD: um segredo selado para a fila de e-mail
 * não abre em outro uso. Formato: v1.<iv>.<cifrado>.<tag> (base64url).
 */
export function sealSecret(plain: string, finalidade: string, key: Buffer = encryptionKey()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(finalidade, 'utf8'));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

export function openSecret(sealed: string, finalidade: string, key: Buffer = encryptionKey()): string {
  const [v, iv, ct, tag, ...resto] = sealed.split('.');
  if (v !== 'v1' || !iv || ct === undefined || !tag || resto.length) throw new SealError('formato inválido');
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAAD(Buffer.from(finalidade, 'utf8'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  } catch {
    throw new SealError('não foi possível abrir o segredo');
  }
}
```

Run: `pnpm test src/lib/crypto.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Teste que falha do IP do cliente** — `src/lib/ip.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { clientIp } from './ip';

const h = (xff?: string) => new Headers(xff ? { 'x-forwarded-for': xff } : {});

describe('clientIp (mesma regra do limite de tentativas do Better Auth)', () => {
  it('sem proxies confiáveis, usa o valor único do X-Forwarded-For', () => {
    expect(clientIp(h('203.0.113.9'), [])).toBe('203.0.113.9');
  });
  it('com proxies confiáveis, ignora da direita para a esquerda os saltos confiáveis', () => {
    expect(clientIp(h('198.51.100.7, 10.0.1.2'), ['10.0.0.0/8'])).toBe('198.51.100.7');
  });
  it('um IP falso colocado pelo cliente à esquerda não vence o IP real', () => {
    expect(clientIp(h('1.2.3.4, 198.51.100.7, 10.0.1.2'), ['10.0.0.0/8'])).toBe('198.51.100.7');
  });
  it('em teste/dev, sem cabeçalho, cai no localhost (comportamento do Better Auth)', () => {
    expect(clientIp(h(), [])).toBe('127.0.0.1');
  });
});
```

Run: `pnpm test src/lib/ip.test.ts` → FAIL (`Cannot find module './ip'`).

- [ ] **Step 6: Implementar** — `src/lib/ip.ts`

```ts
import { getIP } from 'better-auth/api';

/**
 * IP de quem fez a requisição, com a mesma regra usada pelo limite de tentativas do
 * Better Auth (TRUSTED_PROXIES remove os saltos do Traefik da direita para a esquerda).
 * Usado na auditoria (RNF-08) e no Turnstile (INT-06).
 */
export function clientIp(h: Headers, trustedProxies: string[]): string | null {
  return getIP(h, { advanced: { ipAddress: { trustedProxies } } });
}
```

Run: `pnpm test src/lib/ip.test.ts` → PASS (4 testes).

- [ ] **Step 7: Teste que falha da fila** — `src/jobs/boss.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb } from '@/db/client';
import { ensureQueues, QUEUES } from './queues';
import { getBoss, stopBoss } from './boss';

afterAll(async () => {
  await stopBoss();
  await closeDb();
});

describe('fila pg-boss compartilhada (app + worker)', () => {
  it('o produtor do app sobe e cria todas as filas declaradas', async () => {
    const boss = await getBoss();
    for (const name of Object.keys(QUEUES)) expect(await boss.getQueue(name)).not.toBeNull();
  });
  it('ensureQueues é idempotente e aplica a configuração que está no código', async () => {
    const boss = await getBoss();
    await ensureQueues(boss);
    await ensureQueues(boss);
    expect(await boss.getQueue('heartbeat')).toMatchObject({ retryLimit: 0, expireInSeconds: 60 });
  });
  it('getBoss devolve sempre a mesma instância', async () => {
    expect(await getBoss()).toBe(await getBoss());
  });
  it('envia e encontra um job pelo id', async () => {
    const boss = await getBoss();
    const id = await boss.send('heartbeat', { teste: true });
    const [job] = await boss.findJobs<{ teste: boolean }>('heartbeat', { id: id! });
    expect(job.data).toEqual({ teste: true });
  });
});
```

Run: `pnpm test src/jobs` → FAIL (`Cannot find module './queues'`).

- [ ] **Step 8: Implementar** — `src/jobs/queues.ts`

```ts
import type { PgBoss, Queue } from 'pg-boss';

type QueueConfig = Omit<Queue, 'name' | 'partition' | 'policy' | 'deadLetter' | 'retryDelayMax' | 'heartbeatSeconds'>;

/**
 * Todas as filas do sistema e as opções delas. O código é a fonte da verdade: ensureQueues
 * cria o que falta e atualiza o que mudou (createQueue sozinho não altera fila existente).
 */
export const QUEUES = {
  heartbeat: { retryLimit: 0, expireInSeconds: 60 },
} satisfies Record<string, QueueConfig>;

export type QueueName = keyof typeof QUEUES;

export async function ensureQueues(boss: PgBoss): Promise<void> {
  for (const [name, options] of Object.entries(QUEUES)) {
    await boss.createQueue(name, options);
    await boss.updateQueue(name, options);
  }
}
```

`src/jobs/boss.ts`

```ts
import { PgBoss } from 'pg-boss';
import { getPool } from '@/db/client';
import { logger } from '@/lib/logger';
import { ensureQueues } from './queues';

// globalThis: o `next dev` recarrega módulos; sem isso cada HMR abriria outra instância
const g = globalThis as unknown as { __ndBoss?: Promise<PgBoss> };

/**
 * Instância só de envio (app Next.js, scripts e testes): usa o pool da aplicação e não
 * supervisiona nem agenda nada — isso é do worker.
 */
export function getBoss(): Promise<PgBoss> {
  return (g.__ndBoss ??= (async () => {
    const pool = getPool();
    const boss = new PgBoss({
      db: { executeSql: (text, values) => pool.query(text, values as unknown[]) },
      schema: 'pgboss',
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    boss.on('error', (err) => logger.error({ err }, 'pg-boss (produtor) erro'));
    await boss.start();
    await ensureQueues(boss);
    return boss;
  })().catch((err: unknown) => {
    g.__ndBoss = undefined;
    throw err;
  }));
}

/** O worker registra a própria instância (com supervisão) para os envios feitos dentro dele. */
export function useBoss(boss: PgBoss): void {
  g.__ndBoss = Promise.resolve(boss);
}

export async function stopBoss(): Promise<void> {
  const p = g.__ndBoss;
  g.__ndBoss = undefined;
  if (p) await (await p).stop({ graceful: false });
}
```

`createSchema: false` pelo mesmo motivo do worker (Plano 01): o schema `pgboss` já existe e é do role da aplicação.

Run: `pnpm test src/jobs` → PASS (4 testes).

- [ ] **Step 9: Worker usa o ambiente próprio, as filas declaradas e parada idempotente** — `src/worker/index.ts` inteiro:

```ts
import { PgBoss } from 'pg-boss';
import { closeDb, getDb } from '@/db/client';
import { getWorkerEnv, type WorkerEnv } from '@/env';
import { useBoss } from '@/jobs/boss';
import { ensureQueues } from '@/jobs/queues';
import { logger } from '@/lib/logger';
import { recordHeartbeat } from './heartbeat';

export async function startWorker(env: WorkerEnv): Promise<() => Promise<void>> {
  // createSchema: false — ver Plano 01, Tarefa 10 (o schema pgboss é do role da aplicação)
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss', createSchema: false });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss erro'));
  await boss.start();
  await ensureQueues(boss);
  useBoss(boss); // envios feitos dentro do worker usam esta instância

  await boss.schedule('heartbeat', '* * * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('heartbeat', async () => {
    await recordHeartbeat(getDb());
  });

  await recordHeartbeat(getDb()); // batida imediata ao subir
  logger.info('worker iniciado');

  let parando: Promise<void> | undefined;
  // Idempotente: SIGTERM seguido de SIGINT não para o pg-boss duas vezes (item adiado do Plano 01)
  return () =>
    (parando ??= (async () => {
      await boss.stop({ graceful: true, timeout: 30_000 });
      await closeDb();
    })());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = getWorkerEnv(); // falha rápido se faltar configuração
  const stop = await startWorker(env);
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'encerrando worker');
    await stop();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
```

- [ ] **Step 10: Next não empacota o pg-boss** — `next.config.ts`

```ts
import type { NextConfig } from 'next';
import { withSerwist } from '@serwist/turbopack';

const nextConfig: NextConfig = {
  // pg-boss é biblioteca de servidor com SQL próprio; o `pg` já é externo por padrão no Next
  serverExternalPackages: ['pg-boss'],
};

export default withSerwist(nextConfig);
```

- [ ] **Step 11: Variáveis nos testes, no exemplo, no build e no CI**

`test/setup.ts` — acrescentar ao final:

```ts
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
```

`.env.example` — trocar a linha `ENCRYPTION_KEY=` da seção "Planos seguintes" por, na seção do Plano 01, logo depois de `TRUSTED_PROXIES=`:

```bash
# --- Plano 02 ---
# app e worker: chave AES-256 dos segredos da fila (gere com: openssl rand -base64 32)
ENCRYPTION_KEY=
```

E trocar o comentário de `TRUSTED_PROXIES` por: `# CIDRs dos proxies confiáveis (rede do Traefik/Swarm). OBRIGATÓRIA em produção; vazia em dev/test`.

`Dockerfile` — o bloco `ENV` do estágio `build` passa a ser:

```dockerfile
ENV APP_URL=http://build.invalid \
    DATABASE_URL=postgres://build_app:x@127.0.0.1:1/build \
    AUTH_SECRET=build-only-secret-build-only-secret-00 \
    ENCRYPTION_KEY=YnVpbGQtb25seS1rZXktYnVpbGQtb25seS1rZXktMDA= \
    TRUSTED_PROXIES=192.0.2.0/24
```

(`192.0.2.0/24` é a faixa de documentação TEST-NET-1: satisfaz a validação sem confiar em nenhum IP real.)

`.github/workflows/ci.yml` — no `env:` do job `e2e`, acrescentar:

```yaml
      ENCRYPTION_KEY: MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=
      # TEST-NET-1: validação de produção satisfeita sem confiar em nenhum IP; o E2E manda um único X-Forwarded-For
      TRUSTED_PROXIES: 192.0.2.0/24
```

E trocar o job `image` inteiro por (orçamento do GHCR grátis — item adiado do Plano 01):

```yaml
  image:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          load: true
          tags: nutridebby:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Orçamento da imagem (GHCR grátis = 500 MB para as 2 versões mantidas)
        run: |
          bytes=$(docker save nutridebby:ci | gzip -6 | wc -c)
          mb=$((bytes / 1024 / 1024))
          echo "Imagem comprimida: ${mb} MB (limite 260 MB)"
          test "$mb" -le 260 || { echo "::error::Imagem com ${mb} MB passa do orçamento de 260 MB"; exit 1; }
```

Se a **primeira** execução deste passo (ainda sem dependência nova) já medir mais de 260 MB, ajustar o limite para *medido + 15* e registrar o número no PR — a medida por `docker save | gzip` difere um pouco da soma das camadas no GHCR (≈ 239 MB no Plano 01).

`.env.local` de quem desenvolve: gerar e colar `ENCRYPTION_KEY` (o worker e o app passam a exigir).

- [ ] **Step 12: Rodar tudo**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: tudo PASS; build sem erro.

Run (smoke do worker, com `docker compose -f docker-compose.dev.yml up -d` e `.env.local` preenchido): `pnpm worker` e, em outro terminal, `curl -s http://localhost:3100/api/health` com `pnpm dev` rodando.
Expected: log `worker iniciado`; health `{"status":"ok"}`. `Ctrl+C` duas vezes seguidas encerra sem erro.

- [ ] **Step 13: Commit**

```bash
git add src/env.ts src/env.test.ts src/lib/crypto.ts src/lib/crypto.test.ts src/lib/ip.ts src/lib/ip.test.ts \
  src/jobs src/worker/index.ts next.config.ts test/setup.ts .env.example Dockerfile .github/workflows/ci.yml
git commit -m "feat(base): env do worker, TRUSTED_PROXIES obrigatório em produção, cofre AES-GCM, fila compartilhada e orçamento da imagem"
```

---

### Task 2: E-mail transacional — modelos, transportes Resend/Mailpit e job com novas tentativas (P02-01b)

**Files:**
- Create: `src/email/types.ts`, `src/email/templates.tsx`, `src/email/transport.ts`, `src/email/queue.ts`, `src/email/job.ts`, `src/modules/plataforma/tenant-status.ts`, `src/email/render.test.ts`, `src/email/transport.test.ts`, `src/email/email.test.ts`
- Modify: `package.json` / `pnpm-lock.yaml` (`resend`), `src/env.ts`, `src/env.test.ts`, `src/jobs/queues.ts`, `src/worker/index.ts`, `test/setup.ts`, `.env.example`

**Interfaces:**
- Consumes: `sealSecret`, `openSecret`, `encryptionKey` (Tarefa 1); `getBoss()` (Tarefa 1); `Tx`, `Db`, `getDb()` (`@/db/client`); `tenants` (`@/db/schema`); `WorkerEnv` (Tarefa 1, ampliado aqui).
- Produces:
  - `@/email/types`: `type EmailMessage` (união discriminada por `tipo`: `'convite_nutri' { para, nome, link }` · `'redefinir_senha' { para, link }` · `'alerta_disco' { para, percentual, painelUrl }` · `'alerta_backup' { para, detalhe, painelUrl }`), `type EmailJobData = { tenantId: string | null; selado: string }`, `type RenderedEmail = { subject: string; html: string; text: string }`.
  - `@/email/templates`: `renderEmail(msg: EmailMessage): RenderedEmail` (só o worker importa).
  - `@/email/transport`: `type OutgoingEmail`, `interface EmailTransport { send(e: OutgoingEmail): Promise<void> }`, `class EmailSendError`, `resendTransport(apiKey, client?)`, `mailpitTransport(baseUrl, fetchImpl?)`, `transportFromEnv(env: WorkerEnv)`, `parseFrom(from: string): { name?: string; email: string }`.
  - `@/email/queue`: `EMAIL_FINALIDADE = 'email-job'`, `enqueueEmail(msg: EmailMessage, opts?: { tenantId?: string | null; tx?: Tx; boss?: PgBoss }): Promise<string>` (id do job).
  - `@/email/job`: `processEmailJob(data: EmailJobData, jobId: string, deps: { transport: EmailTransport; from: string; tenantAtivo: (tenantId: string) => Promise<boolean>; key?: Buffer }): Promise<'enviado' | 'ignorado'>`.
  - `@/modules/plataforma/tenant-status`: `type TenantStatus = 'ativa' | 'suspensa'`, `getTenantStatus(db: Db, tenantId: string): Promise<TenantStatus | null>`, `tenantIsActive(db: Db, tenantId: string): Promise<boolean>`.
  - `WorkerEnv` ganha `EMAIL_FROM: string`, `EMAIL_TRANSPORT: 'resend' | 'mailpit'`, `RESEND_API_KEY?: string`, `MAILPIT_URL?: string`.

- [ ] **Step 1: Instalar o SDK do Resend**

```bash
pnpm add resend --save-exact
```

Usar a versão mais nova aceita pelo *minimum-release-age* do pnpm (em 2026-09-28 a `latest` era 6.30.0) e anotar a versão no commit. Não instalar `@react-email/*` (desvio "React Email").

- [ ] **Step 2: Testes que falham do ambiente de e-mail** — acrescentar ao `src/env.test.ts`, no `describe('parseWorkerEnv')`:

```ts
  const w = { DATABASE_URL, APP_URL: 'http://localhost:3100', ENCRYPTION_KEY: KEY, EMAIL_FROM: 'NutriDebby <nao-responda@exemplo.com>' };
  it('fora de produção usa Mailpit por padrão e exige MAILPIT_URL', () => {
    expect(parseWorkerEnv({ ...w, MAILPIT_URL: 'http://localhost:8025' }).EMAIL_TRANSPORT).toBe('mailpit');
    expect(() => parseWorkerEnv(w)).toThrow(/MAILPIT_URL/);
  });
  it('em produção usa Resend por padrão e exige RESEND_API_KEY', () => {
    expect(() => parseWorkerEnv({ ...w, NODE_ENV: 'production' })).toThrow(/RESEND_API_KEY é obrigatória/);
    expect(parseWorkerEnv({ ...w, NODE_ENV: 'production', RESEND_API_KEY: 're_x' }).EMAIL_TRANSPORT).toBe('resend');
  });
  it('EMAIL_TRANSPORT=mailpit explícito vale até em produção (E2E do CI)', () => {
    expect(parseWorkerEnv({ ...w, NODE_ENV: 'production', EMAIL_TRANSPORT: 'mailpit', MAILPIT_URL: 'http://localhost:8025' }).EMAIL_TRANSPORT).toBe('mailpit');
  });
  it('recusa EMAIL_FROM sem endereço', () => {
    expect(() => parseWorkerEnv({ ...w, EMAIL_FROM: 'NutriDebby', MAILPIT_URL: 'http://localhost:8025' })).toThrow(/EMAIL_FROM/);
  });
```

E, no teste já existente `exige APP_URL e ENCRYPTION_KEY…`, acrescentar `EMAIL_FROM` e `MAILPIT_URL` ao objeto válido:

```ts
    const env = parseWorkerEnv({ DATABASE_URL, APP_URL: 'http://localhost:3100', ENCRYPTION_KEY: KEY, EMAIL_FROM: 'a@b.dev', MAILPIT_URL: 'http://localhost:8025' });
```

Run: `pnpm test src/env.test.ts` → FAIL (campos novos não existem).

- [ ] **Step 3: Implementar** — em `src/env.ts`, trocar `workerSchema` por:

```ts
const EMAIL_FROM = /^([^<>]*<[^@<>\s]+@[^@<>\s]+>|[^@<>\s]+@[^@<>\s]+)$/;

/** Worker: banco com o role da aplicação + o que os jobs usam (e-mail, links, segredos da fila). */
const workerSchema = serverSchema
  .extend({
    APP_URL: z.url({ message: 'APP_URL deve ser uma URL (ex.: https://app.exemplo.com)' }),
    ENCRYPTION_KEY: encryptionKeySchema,
    EMAIL_FROM: z
      .string({ message: 'EMAIL_FROM é obrigatória' })
      .regex(EMAIL_FROM, { message: 'EMAIL_FROM deve ser "Nome <email@dominio>" ou só o e-mail' }),
    EMAIL_TRANSPORT: z.enum(['resend', 'mailpit']).optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    MAILPIT_URL: z.url({ message: 'MAILPIT_URL deve ser uma URL (ex.: http://localhost:8025)' }).optional(),
  })
  .transform((e) => ({
    ...e,
    // Produção envia pelo Resend; dev e testes pelo Mailpit. O E2E do CI força mailpit.
    EMAIL_TRANSPORT: e.EMAIL_TRANSPORT ?? (e.NODE_ENV === 'production' ? 'resend' : 'mailpit'),
  }))
  .superRefine((e, ctx) => {
    if (e.EMAIL_TRANSPORT === 'resend' && !e.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'RESEND_API_KEY é obrigatória para enviar pelo Resend' });
    }
    if (e.EMAIL_TRANSPORT === 'mailpit' && !e.MAILPIT_URL) {
      ctx.addIssue({ code: 'custom', path: ['MAILPIT_URL'], message: 'MAILPIT_URL é obrigatória para enviar pelo Mailpit' });
    }
  });
```

O `.transform` roda antes do `.superRefine`, então a regra enxerga o transporte já resolvido (padrão por `NODE_ENV`).

Run: `pnpm test src/env.test.ts` → PASS.

- [ ] **Step 4: Tipos das mensagens** — `src/email/types.ts`

```ts
/** Toda mensagem que o sistema envia. `link` pode conter token: por isso o job inteiro vai cifrado. */
export type EmailMessage =
  | { tipo: 'convite_nutri'; para: string; nome: string; link: string }
  | { tipo: 'redefinir_senha'; para: string; link: string }
  | { tipo: 'alerta_disco'; para: string; percentual: number; painelUrl: string }
  | { tipo: 'alerta_backup'; para: string; detalhe: string; painelUrl: string };

/** Payload do job `email` no pg-boss: nada legível além do tenant (RN-15). */
export type EmailJobData = { tenantId: string | null; selado: string };

export type RenderedEmail = { subject: string; html: string; text: string };
```

- [ ] **Step 5: Teste que falha dos modelos** — `src/email/render.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { renderEmail } from './templates';

describe('modelos de e-mail (INT-02)', () => {
  it('convite da nutricionista: assunto, nome, link no botão e no texto, validade de 72 h', () => {
    const link = 'https://app.exemplo.com/convite/tok123';
    const r = renderEmail({ tipo: 'convite_nutri', para: 'debby@exemplo.com', nome: 'Debby Silva', link });
    expect(r.subject).toBe('Seu acesso ao NutriDebby');
    expect(r.html.startsWith('<!doctype html>')).toBe(true);
    expect(r.html).toContain('Olá, Debby Silva!');
    expect(r.html).toContain(`href="${link}"`);
    expect(r.html).toContain('72 horas');
    expect(r.text).toContain(link);
    expect(r.text).toContain('72 horas');
  });
  it('redefinição de senha: 1 hora e uso único', () => {
    const r = renderEmail({ tipo: 'redefinir_senha', para: 'a@b.dev', link: 'https://x.dev/r/1' });
    expect(r.subject).toBe('Redefinição de senha');
    expect(r.text).toContain('1 hora');
    expect(r.text).toContain('só pode ser usado uma vez');
  });
  it('escapa HTML vindo de dados', () => {
    const r = renderEmail({ tipo: 'convite_nutri', para: 'x@y.dev', nome: 'Ana <script>alert(1)</script>', link: 'https://x.dev/c/1' });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
  });
  it('alertas do admin', () => {
    expect(renderEmail({ tipo: 'alerta_disco', para: 'a@b.dev', percentual: 71, painelUrl: 'https://x.dev/admin' }).subject).toBe(
      'Alerta: disco da VPS em 71%',
    );
    const b = renderEmail({ tipo: 'alerta_backup', para: 'a@b.dev', detalhe: 'banco sem backup desde 01/10/2026', painelUrl: 'https://x.dev/admin' });
    expect(b.subject).toBe('Alerta: backup diário não concluído');
    expect(b.text).toContain('banco sem backup desde 01/10/2026');
  });
});
```

Run: `pnpm test src/email/render.test.ts` → FAIL (`Cannot find module './templates'`).

- [ ] **Step 6: Implementar os modelos** — `src/email/templates.tsx`

```tsx
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EmailMessage, RenderedEmail } from './types';

// Só o worker importa este arquivo (react-dom/server fora do grafo do Next).
const COR = '#047857';

function Layout({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <title>{titulo}</title>
      </head>
      <body style={{ margin: 0, backgroundColor: '#f4f4f5', fontFamily: 'Arial, Helvetica, sans-serif', color: '#18181b' }}>
        <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: '24px 12px' }}>
                <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ maxWidth: 560, backgroundColor: '#ffffff', borderRadius: 8 }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '24px 28px 0', fontSize: 20, fontWeight: 700, color: COR }}>NutriDebby</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '16px 28px 28px', fontSize: 15, lineHeight: '22px' }}>{children}</td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ fontSize: 12, color: '#71717a', marginTop: 16 }}>Mensagem automática. Não responda este e-mail.</p>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p style={{ margin: '0 0 16px' }}>{children}</p>;
}

function Botao({ href, children }: { href: string; children: ReactNode }) {
  return (
    <p style={{ margin: '0 0 16px' }}>
      <a href={href} style={{ display: 'inline-block', backgroundColor: COR, color: '#ffffff', padding: '12px 20px', borderRadius: 6, textDecoration: 'none', fontWeight: 700 }}>
        {children}
      </a>
    </p>
  );
}

function LinkReserva({ href }: { href: string }) {
  return (
    <p style={{ margin: 0, fontSize: 13, color: '#52525b' }}>
      Se o botão não funcionar, copie e cole este endereço no navegador: <span style={{ wordBreak: 'break-all' }}>{href}</span>
    </p>
  );
}

const html = (el: ReactNode) => `<!doctype html>${renderToStaticMarkup(el)}`;

export function renderEmail(msg: EmailMessage): RenderedEmail {
  switch (msg.tipo) {
    case 'convite_nutri': {
      const subject = 'Seu acesso ao NutriDebby';
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            <P>{`Olá, ${msg.nome}!`}</P>
            <P>Sua conta de nutricionista no NutriDebby foi criada. Para entrar, defina sua senha e aceite o contrato de tratamento de dados (DPA).</P>
            <Botao href={msg.link}>Definir minha senha</Botao>
            <P>O link vale por 72 horas e só pode ser usado uma vez. Se ele expirar, peça um novo ao suporte.</P>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [
          `Olá, ${msg.nome}!`,
          'Sua conta de nutricionista no NutriDebby foi criada. Para entrar, defina sua senha e aceite o contrato de tratamento de dados (DPA):',
          msg.link,
          'O link vale por 72 horas e só pode ser usado uma vez. Se ele expirar, peça um novo ao suporte.',
        ].join('\n\n'),
      };
    }
    case 'redefinir_senha': {
      const subject = 'Redefinição de senha';
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            <P>Recebemos um pedido para redefinir a senha da sua conta no NutriDebby.</P>
            <Botao href={msg.link}>Criar nova senha</Botao>
            <P>O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.</P>
            <LinkReserva href={msg.link} />
          </Layout>,
        ),
        text: [
          'Recebemos um pedido para redefinir a senha da sua conta no NutriDebby. Para criar uma nova senha, acesse:',
          msg.link,
          'O link vale por 1 hora e só pode ser usado uma vez. Se você não pediu a redefinição, ignore este e-mail: sua senha continua a mesma.',
        ].join('\n\n'),
      };
    }
    case 'alerta_disco': {
      const subject = `Alerta: disco da VPS em ${msg.percentual}%`;
      const linhas = [
        `O disco do servidor está com ${msg.percentual}% de uso (limite de alerta: 70%).`,
        'Libere espaço ou amplie o disco antes que os uploads e os backups falhem.',
      ];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => <P key={l}>{l}</P>)}
            <Botao href={msg.painelUrl}>Abrir a administração</Botao>
          </Layout>,
        ),
        text: [...linhas, msg.painelUrl].join('\n\n'),
      };
    }
    case 'alerta_backup': {
      const subject = 'Alerta: backup diário não concluído';
      const linhas = [
        'O backup diário do NutriDebby não foi concluído nas últimas 26 horas.',
        `Detalhe: ${msg.detalhe}`,
        'Confira o serviço nutri-backup no servidor (journalctl -u nutri-backup) e rode o backup manualmente, se preciso.',
      ];
      return {
        subject,
        html: html(
          <Layout titulo={subject}>
            {linhas.map((l) => <P key={l}>{l}</P>)}
            <Botao href={msg.painelUrl}>Abrir a administração</Botao>
          </Layout>,
        ),
        text: [...linhas, msg.painelUrl].join('\n\n'),
      };
    }
    default: {
      const nunca: never = msg;
      throw new Error(`Tipo de e-mail desconhecido: ${String((nunca as { tipo?: string }).tipo)}`);
    }
  }
}
```

Run: `pnpm test src/email/render.test.ts` → PASS (4 testes).

- [ ] **Step 7: Teste que falha dos transportes** — `src/email/transport.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Resend } from 'resend';
import { EmailSendError, mailpitTransport, parseFrom, resendTransport, type OutgoingEmail } from './transport';

const email: OutgoingEmail = {
  from: 'NutriDebby <nao-responda@exemplo.com>',
  to: 'debby@exemplo.com',
  subject: 'Assunto',
  html: '<p>oi</p>',
  text: 'oi',
  idempotencyKey: 'job-1',
};

describe('parseFrom', () => {
  it('separa nome e endereço', () => {
    expect(parseFrom('NutriDebby <nao-responda@exemplo.com>')).toEqual({ name: 'NutriDebby', email: 'nao-responda@exemplo.com' });
    expect(parseFrom('nao-responda@exemplo.com')).toEqual({ email: 'nao-responda@exemplo.com' });
  });
});

describe('mailpitTransport (dev/CI)', () => {
  it('usa a API de envio do Mailpit', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ID":"x"}', { status: 200 }));
    await mailpitTransport('http://localhost:8025', fetchImpl).send(email);
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:8025/api/v1/send', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({
      From: { Email: 'nao-responda@exemplo.com', Name: 'NutriDebby' },
      To: [{ Email: 'debby@exemplo.com' }],
      Subject: 'Assunto',
      HTML: '<p>oi</p>',
      Text: 'oi',
    });
  });
  it('resposta de erro vira EmailSendError (o pg-boss tenta de novo)', async () => {
    const fetchImpl = vi.fn(async () => new Response('falhou', { status: 500 }));
    await expect(mailpitTransport('http://localhost:8025', fetchImpl).send(email)).rejects.toBeInstanceOf(EmailSendError);
  });
});

describe('resendTransport (produção)', () => {
  it('envia com Idempotency-Key = id do job', async () => {
    const send = vi.fn(async () => ({ data: { id: 'r1' }, error: null, headers: null }));
    const client = { emails: { send } } as unknown as Pick<Resend, 'emails'>;
    await resendTransport('re_x', client).send(email);
    expect(send).toHaveBeenCalledWith(
      { from: email.from, to: 'debby@exemplo.com', subject: 'Assunto', html: '<p>oi</p>', text: 'oi' },
      { idempotencyKey: 'job-1' },
    );
  });
  it('erro do Resend vira EmailSendError sem repetir o destinatário na mensagem', async () => {
    const send = vi.fn(async () => ({ data: null, error: { name: 'rate_limit_exceeded', message: 'x', statusCode: 429 }, headers: null }));
    const client = { emails: { send } } as unknown as Pick<Resend, 'emails'>;
    const err = await resendTransport('re_x', client).send(email).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.message).toContain('rate_limit_exceeded');
    expect(err.message).not.toContain('debby@exemplo.com');
  });
});
```

Run: `pnpm test src/email/transport.test.ts` → FAIL.

- [ ] **Step 8: Implementar os transportes** — `src/email/transport.ts`

```ts
import { Resend } from 'resend';
import type { WorkerEnv } from '@/env';

export type OutgoingEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Id do job: repetição do mesmo job não duplica o e-mail no Resend. */
  idempotencyKey: string;
};

export interface EmailTransport {
  send(e: OutgoingEmail): Promise<void>;
}

export class EmailSendError extends Error {
  override name = 'EmailSendError';
}

export function parseFrom(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  return m ? { ...(m[1] ? { name: m[1] } : {}), email: m[2] } : { email: from.trim() };
}

export function resendTransport(apiKey: string, client: Pick<Resend, 'emails'> = new Resend(apiKey)): EmailTransport {
  return {
    async send(e) {
      const { error } = await client.emails.send(
        { from: e.from, to: e.to, subject: e.subject, html: e.html, text: e.text },
        { idempotencyKey: e.idempotencyKey },
      );
      if (error) throw new EmailSendError(`Resend recusou o envio: ${error.name} (${error.statusCode ?? 'sem status'})`);
    },
  };
}

export function mailpitTransport(baseUrl: string, fetchImpl: typeof fetch = fetch): EmailTransport {
  return {
    async send(e) {
      const from = parseFrom(e.from);
      const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/api/v1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: { Email: from.email, Name: from.name ?? '' },
          To: [{ Email: e.to }],
          Subject: e.subject,
          HTML: e.html,
          Text: e.text,
        }),
      });
      if (!res.ok) throw new EmailSendError(`Mailpit recusou o envio: HTTP ${res.status}`);
    },
  };
}

export function transportFromEnv(env: WorkerEnv): EmailTransport {
  return env.EMAIL_TRANSPORT === 'resend' ? resendTransport(env.RESEND_API_KEY!) : mailpitTransport(env.MAILPIT_URL!);
}
```

Run: `pnpm test src/email/transport.test.ts` → PASS (5 testes).

- [ ] **Step 9: Teste que falha da fila de e-mail** — `src/email/email.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getBoss, stopBoss } from '@/jobs/boss';
import { openSecret } from '@/lib/crypto';
import { tenantIsActive } from '@/modules/plataforma/tenant-status';
import { processEmailJob } from './job';
import { EMAIL_FINALIDADE, enqueueEmail } from './queue';
import type { EmailJobData } from './types';
import type { EmailTransport, OutgoingEmail } from './transport';

afterAll(async () => {
  await stopBoss();
  await closeDb();
});

function fakeTransport() {
  const enviados: OutgoingEmail[] = [];
  const t: EmailTransport = { send: async (e) => void enviados.push(e) };
  return { t, enviados };
}

async function jobData(id: string): Promise<EmailJobData> {
  const [job] = await (await getBoss()).findJobs<EmailJobData>('email', { id });
  return job.data;
}

describe('fila de e-mail (INT-02)', () => {
  it('o job guarda só o tenant e a mensagem cifrada', async () => {
    const link = 'http://localhost:3000/convite/segredo-do-token';
    const id = await enqueueEmail({ tipo: 'convite_nutri', para: 'debby@exemplo.com', nome: 'Debby', link });
    const data = await jobData(id);
    expect(JSON.stringify(data)).not.toContain('segredo-do-token');
    expect(JSON.stringify(data)).not.toContain('debby@exemplo.com');
    expect(JSON.parse(openSecret(data.selado, EMAIL_FINALIDADE))).toMatchObject({ link });
  });

  it('o worker abre, renderiza e envia com a chave de idempotência do job', async () => {
    const id = await enqueueEmail({ tipo: 'redefinir_senha', para: 'a@b.dev', link: 'http://x.dev/r/1' });
    const { t, enviados } = fakeTransport();
    const r = await processEmailJob(await jobData(id), id, { transport: t, from: 'NutriDebby <n@x.dev>', tenantAtivo: async () => true });
    expect(r).toBe('enviado');
    expect(enviados).toEqual([expect.objectContaining({ to: 'a@b.dev', subject: 'Redefinição de senha', idempotencyKey: id })]);
  });

  it('tenant suspenso: o job é concluído sem enviar (RN-15)', async () => {
    const [t] = await getDb().insert(tenants).values({ slug: `s-${randomUUID().slice(0, 8)}`, nomeExibicao: 'S', status: 'suspensa' }).returning();
    const id = await enqueueEmail({ tipo: 'redefinir_senha', para: 'a@b.dev', link: 'http://x.dev/r/2' }, { tenantId: t.id });
    const { t: tr, enviados } = fakeTransport();
    const r = await processEmailJob(await jobData(id), id, { transport: tr, from: 'n@x.dev', tenantAtivo: (tid) => tenantIsActive(getDb(), tid) });
    expect(r).toBe('ignorado');
    expect(enviados).toHaveLength(0);
    await getDb().update(tenants).set({ status: 'ativa' }).where(eq(tenants.id, t.id));
    expect(await tenantIsActive(getDb(), t.id)).toBe(true);
  });

  it('enfileirar dentro de uma transação que é desfeita não deixa job', async () => {
    let id = '';
    await expect(
      getDb().transaction(async (tx) => {
        id = await enqueueEmail({ tipo: 'redefinir_senha', para: 'a@b.dev', link: 'http://x.dev/r/3' }, { tx });
        throw new Error('desfaz');
      }),
    ).rejects.toThrow('desfaz');
    expect(id).not.toBe('');
    expect(await (await getBoss()).findJobs('email', { id })).toEqual([]);
  });

  it('a fila tem 3 novas tentativas com backoff exponencial', async () => {
    expect(await (await getBoss()).getQueue('email')).toMatchObject({ retryLimit: 3, retryDelay: 60, retryBackoff: true });
  });
});
```

Run: `pnpm test src/email/email.test.ts` → FAIL.

- [ ] **Step 10: Implementar fila, job e status do tenant**

`src/jobs/queues.ts` — acrescentar a fila ao `QUEUES`:

```ts
export const QUEUES = {
  heartbeat: { retryLimit: 0, expireInSeconds: 60 },
  // INT-02: 3 novas tentativas (1, 2, 4 min + jitter); concluídos somem em 1 dia (payload já é cifrado)
  email: { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 60, deleteAfterSeconds: 86_400 },
} satisfies Record<string, QueueConfig>;
```

`src/modules/plataforma/tenant-status.ts`

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { tenants } from '@/db/schema';

export type TenantStatus = 'ativa' | 'suspensa';

export async function getTenantStatus(db: Db, tenantId: string): Promise<TenantStatus | null> {
  const [row] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
  return (row?.status as TenantStatus | undefined) ?? null;
}

/** RN-15: jobs de um tenant suspenso não enviam nada. Tenant inexistente conta como inativo. */
export async function tenantIsActive(db: Db, tenantId: string): Promise<boolean> {
  return (await getTenantStatus(db, tenantId)) === 'ativa';
}
```

`src/email/queue.ts`

```ts
import { sql } from 'drizzle-orm';
import { fromDrizzle, type PgBoss } from 'pg-boss';
import type { Tx } from '@/db/client';
import { getBoss } from '@/jobs/boss';
import { sealSecret } from '@/lib/crypto';
import type { EmailJobData, EmailMessage } from './types';

export const EMAIL_FINALIDADE = 'email-job';

/**
 * Enfileira um e-mail (o worker envia). Com `tx`, o job só existe se a transação do negócio
 * for confirmada (ex.: conta criada ⇔ convite enfileirado).
 */
export async function enqueueEmail(
  msg: EmailMessage,
  opts: { tenantId?: string | null; tx?: Tx; boss?: PgBoss } = {},
): Promise<string> {
  const boss = opts.boss ?? (await getBoss());
  const data: EmailJobData = { tenantId: opts.tenantId ?? null, selado: sealSecret(JSON.stringify(msg), EMAIL_FINALIDADE) };
  const id = await boss.send('email', data, opts.tx ? { db: fromDrizzle(opts.tx, sql) } : undefined);
  if (!id) throw new Error('A fila de e-mail recusou o envio');
  return id;
}
```

`src/email/job.ts`

```ts
import { openSecret } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import { EMAIL_FINALIDADE } from './queue';
import { renderEmail } from './templates';
import type { EmailTransport } from './transport';
import type { EmailJobData, EmailMessage } from './types';

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
  const r = renderEmail(msg);
  // Erro aqui sobe para o pg-boss, que tenta de novo (retryLimit da fila)
  await deps.transport.send({ from: deps.from, to: msg.para, subject: r.subject, html: r.html, text: r.text, idempotencyKey: jobId });
  logger.info({ jobId, tipo: msg.tipo, tenantId: data.tenantId }, 'e-mail enviado'); // sem destinatário nem link
  return 'enviado';
}
```

Run: `pnpm test src/email` → PASS (todos os arquivos de `src/email`).

- [ ] **Step 11: Worker envia os e-mails** — em `src/worker/index.ts`, acrescentar os imports e, logo depois do `boss.work('heartbeat', …)`, o registro da fila:

```ts
import { processEmailJob } from '@/email/job';
import { transportFromEnv } from '@/email/transport';
import type { EmailJobData } from '@/email/types';
import { tenantIsActive } from '@/modules/plataforma/tenant-status';
```

```ts
  const transport = transportFromEnv(env);
  await boss.work<EmailJobData>('email', async ([job]) => {
    await processEmailJob(job.data, job.id, {
      transport,
      from: env.EMAIL_FROM,
      tenantAtivo: (tenantId) => tenantIsActive(getDb(), tenantId),
    });
  });
```

- [ ] **Step 12: Variáveis** — `test/setup.ts`, acrescentar:

```ts
process.env.EMAIL_FROM = 'NutriDebby <nao-responda@nutridebby.test>';
process.env.MAILPIT_URL = 'http://localhost:8025';
```

`.env.example`, na seção do Plano 02 (e remover `RESEND_API_KEY=` e `EMAIL_FROM=` da seção "Planos seguintes"):

```bash
# worker: remetente (domínio verificado no Resend em produção)
EMAIL_FROM=NutriDebby <nao-responda@localhost>
# worker: resend (padrão em produção) | mailpit (padrão fora de produção)
EMAIL_TRANSPORT=
# worker, produção: chave de envio do Resend
RESEND_API_KEY=
# worker, dev/CI: Mailpit do docker-compose (interface em http://localhost:8025)
MAILPIT_URL=http://localhost:8025
```

- [ ] **Step 13: Verificar ponta a ponta no dev**

```bash
docker compose -f docker-compose.dev.yml up -d
pnpm worker &
pnpm exec tsx --env-file=.env.local -e "import('./src/email/queue.ts').then(async (m) => { await m.enqueueEmail({ tipo: 'redefinir_senha', para: 'teste@localhost', link: 'http://localhost:3100/definir-senha?token=x' }); process.exit(0) })"
sleep 3 && curl -s 'http://localhost:8025/api/v1/search?query=to:"teste@localhost"' | jq '.messages[0].Subject'
```

Expected: `"Redefinição de senha"`. Parar o worker (`kill %1`).

- [ ] **Step 14: Rodar tudo e commit**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS.

```bash
git add package.json pnpm-lock.yaml src/env.ts src/env.test.ts src/email src/jobs/queues.ts src/worker/index.ts \
  src/modules/plataforma/tenant-status.ts test/setup.ts .env.example
git commit -m "feat(email): fila cifrada no pg-boss com 3 novas tentativas, modelos React e transportes Resend/Mailpit (resend <versão>)"
```

---
### Task 3: "Esqueci minha senha" envia o e-mail; tokens do Better Auth guardados com hash (P02-01c)

**Files:**
- Create: `e2e/mailpit.ts`, `e2e/recuperacao.spec.ts`
- Modify: `src/lib/password-links.ts`, `src/lib/auth.ts:21-49`, `src/lib/auth.test.ts`, `scripts/admin-criar.ts`, `scripts/e2e-seed.ts`, `playwright.config.ts`, `.github/workflows/ci.yml` (job `e2e`)

**Interfaces:**
- Consumes: `enqueueEmail(msg, opts?)`, `EMAIL_FINALIDADE`, `EmailJobData`, `EmailMessage` (Tarefa 2); `getBoss()`, `stopBoss()` (Tarefa 1); `openSecret`, `sha256` (Tarefa 1).
- Produces:
  - `@/lib/password-links`: `emailPasswordLinkSink: PasswordLinkSink` passa a ser o destino padrão (o `defaultPasswordLinkSink` que só registrava aviso deixa de existir); `setPasswordLinkSink` continua igual (usado pelo `admin:criar`).
  - `@/lib/auth`: `RESET_TOKEN_TTL_S = 3600`; Better Auth com `verification.storeIdentifier: 'hashed'`.
  - `e2e/mailpit.ts`: `esperarEmail(para: string, opts?: { assunto?: string; depoisDe?: Date; timeoutMs?: number }): Promise<{ assunto: string; texto: string; html: string }>`, `primeiroLink(texto: string, trecho: string): string`.
  - `scripts/e2e-seed.ts`: `E2E_RECUPERA = { email: 'recupera-e2e@nutridebby.test', password: 'Nutri2026segura' }` (papel `nutri`).
  - Playwright sobe `next start` **e** o worker.

- [ ] **Step 1: Testes que falham** — em `src/lib/auth.test.ts`:

Trocar os imports do topo por:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../test/db';
import { account, user, verification } from '@/db/schema';
import { EMAIL_FINALIDADE } from '@/email/queue';
import type { EmailJobData, EmailMessage } from '@/email/types';
import { getBoss, stopBoss } from '@/jobs/boss';
import { openSecret, sha256 } from './crypto';
import { createAuth } from './auth';
import { hashPassword } from './password.server';
import { setPasswordLinkSink } from './password-links';
```

Trocar o `afterAll(() => app.pool.end());` por:

```ts
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});

/** Usuária própria para cada teste de e-mail (o job é encontrado pelo destinatário). */
async function novaUsuaria(prefixo: string): Promise<string> {
  const id = randomUUID();
  const e = `${prefixo}-${id.slice(0, 8)}@teste.dev`;
  await app.db.insert(user).values({ id, name: 'Nutri', email: e, emailVerified: true, appRole: 'nutri' });
  await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
  return e;
}

async function linksEnviadosPara(destino: string): Promise<string[]> {
  const jobs = await (await getBoss()).findJobs<EmailJobData>('email');
  return jobs
    .map((j) => JSON.parse(openSecret(j.data.selado, EMAIL_FINALIDADE)) as EmailMessage)
    .filter((m): m is Extract<EmailMessage, { tipo: 'redefinir_senha' }> => m.tipo === 'redefinir_senha' && m.para === destino)
    .map((m) => m.link);
}
```

Substituir o teste `recuperação de senha não registra o link nem o token no log` por estes três:

```ts
  it('recuperação de senha enfileira o e-mail; token e link não vão para o log (P02-01)', async () => {
    const destino = await novaUsuaria('rec');
    const saida: string[] = [];
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => { saida.push(args.map(String).join(' ')); }),
    );
    try {
      expect((await post('/request-password-reset', { email: destino, redirectTo: '/definir-senha' }, '10.0.0.7')).status).toBe(200);
      expect((await post('/request-password-reset', { email: 'ninguem@teste.dev', redirectTo: '/definir-senha' }, '10.0.0.7')).status).toBe(200);
    } finally {
      espioes.forEach((e) => e.mockRestore());
    }
    const links = await linksEnviadosPara(destino);
    expect(links).toHaveLength(1);
    expect(await linksEnviadosPara('ninguem@teste.dev')).toEqual([]);
    const token = new URL(links[0]).pathname.split('/').pop()!;
    const log = saida.join('\n');
    expect(log).not.toContain(token);
    expect(log).not.toContain(destino);
  });

  it('o token de redefinição fica só em hash na tabela verification (item adiado do Plano 01)', async () => {
    const destino = await novaUsuaria('hash');
    await post('/request-password-reset', { email: destino, redirectTo: '/definir-senha' }, '10.0.0.8');
    const [link] = await linksEnviadosPara(destino);
    const token = new URL(link).pathname.split('/').pop()!;
    const ids = (await app.db.select({ i: verification.identifier }).from(verification)).map((r) => r.i);
    expect(ids.some((i) => i.includes(token))).toBe(false);
    expect(ids).toContain(sha256(`reset-password:${token}`));
  });

  it('o link do e-mail redefine a senha uma única vez', async () => {
    const destino = await novaUsuaria('uso');
    await post('/request-password-reset', { email: destino, redirectTo: '/definir-senha' }, '10.0.0.9');
    const [link] = await linksEnviadosPara(destino);
    const token = new URL(link).pathname.split('/').pop()!;
    expect((await post('/reset-password', { newPassword: 'OutraSenha2026x', token }, '10.0.0.9')).status).toBe(200);
    const segunda = await post('/reset-password', { newPassword: 'MaisOutra2026y', token }, '10.0.0.9');
    expect(segunda.status).toBe(400);
    expect(await segunda.json()).toMatchObject({ code: 'INVALID_TOKEN' });
  });
```

(`defaultPasswordLinkSink` sai do import; os testes que usam `setPasswordLinkSink` continuam iguais.)

Run: `pnpm test src/lib/auth.test.ts`
Expected: FAIL — nenhum job de e-mail é criado (o destino padrão só registra aviso) e o identificador está em claro.

- [ ] **Step 2: Implementar** — `src/lib/password-links.ts` inteiro:

```ts
import { enqueueEmail } from '@/email/queue';

export type PasswordLink = { email: string; url: string };
export type PasswordLinkSink = (link: PasswordLink) => Promise<void> | void;

/** Destino padrão (P02-01): e-mail pela fila, com o link cifrado dentro do job. */
export const emailPasswordLinkSink: PasswordLinkSink = async ({ email, url }) => {
  await enqueueEmail({ tipo: 'redefinir_senha', para: email, link: url });
};

let sink: PasswordLinkSink = emailPasswordLinkSink;

/** Troca o destino dos links (CLI `admin:criar` e testes). Retorna função que restaura o anterior. */
export function setPasswordLinkSink(fn: PasswordLinkSink): () => void {
  const prev = sink;
  sink = fn;
  return () => {
    sink = prev;
  };
}

export async function deliverPasswordLink(link: PasswordLink): Promise<void> {
  await sink(link);
}
```

Em `src/lib/auth.ts`, acima de `createAuth`:

```ts
/** US-002: o link de redefinição vale 1 h e é de uso único. */
export const RESET_TOKEN_TTL_S = 60 * 60;
```

E no objeto do `betterAuth({...})`: trocar `resetPasswordTokenExpiresIn: 60 * 60, // US-002: 1 h, uso único` por `resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_S,` e acrescentar, logo depois de `database: drizzleAdapter(...)`:

```ts
    // Tokens (redefinição, estado do 2FA) guardados só como SHA-256 em verification.identifier:
    // quem ler o banco não consegue usar um link pendente. Linhas antigas em claro ainda são
    // aceitas pelo Better Auth até expirarem (consumeVerificationValue tenta os dois formatos).
    verification: { storeIdentifier: 'hashed' },
```

`scripts/admin-criar.ts` — trocar o import e a mensagem para derivar do TTL:

```ts
import { closeDb } from '@/db/client';
import { RESET_TOKEN_TTL_S } from '@/lib/auth';
import { AdminBootstrapError, createAdmin } from '@/modules/plataforma/admin-bootstrap';
```

```ts
  const horas = RESET_TOKEN_TTL_S / 3600;
  console.log(`Admin criado. Abra o link abaixo para definir a senha (válido por ${horas === 1 ? '1 hora' : `${horas} horas`}, uso único):`);
```

Run: `pnpm test src/lib src/modules`
Expected: PASS (inclusive `admin-bootstrap.test.ts`, que troca o destino pelo terminal e não gera e-mail, e os testes de 2FA com identificadores em hash).

- [ ] **Step 3: Leitor do Mailpit para o E2E** — `e2e/mailpit.ts`

```ts
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

type Resumo = { ID: string; Subject: string; Created: string };

/** Espera (polling) o e-mail mais recente para `para` no Mailpit. */
export async function esperarEmail(
  para: string,
  opts: { assunto?: string; depoisDe?: Date; timeoutMs?: number } = {},
): Promise<{ assunto: string; texto: string; html: string }> {
  const limite = opts.timeoutMs ?? 30_000;
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${para}"`)}&limit=20`);
    const { messages } = (await r.json()) as { messages: Resumo[] };
    const m = messages.find(
      (x) =>
        (!opts.assunto || x.Subject === opts.assunto) &&
        (!opts.depoisDe || new Date(x.Created).getTime() >= opts.depoisDe.getTime() - 1000),
    );
    if (m) {
      const d = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Subject: string; Text: string; HTML: string };
      return { assunto: d.Subject, texto: d.Text, html: d.HTML };
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`Nenhum e-mail para ${para} em ${limite} ms`);
}

/** Primeiro link absoluto do texto que contém `trecho`. */
export function primeiroLink(texto: string, trecho: string): string {
  const escapado = trecho.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = texto.match(new RegExp(`https?://\\S*${escapado}\\S*`));
  if (!m) throw new Error(`Nenhum link com "${trecho}" no e-mail`);
  return m[0];
}
```

- [ ] **Step 4: Usuária do E2E** — em `scripts/e2e-seed.ts`, acrescentar depois de `E2E_NUTRI`:

```ts
export const E2E_RECUPERA = { email: 'recupera-e2e@nutridebby.test', password: 'Nutri2026segura' };
```

E, antes de `await closeDb();`:

```ts
await db.delete(user).where(eq(user.email, E2E_RECUPERA.email));
const recuperaId = randomUUID();
await db.insert(user).values({ id: recuperaId, name: 'Recupera E2E', email: E2E_RECUPERA.email, emailVerified: true, appRole: 'nutri' });
await db.insert(account).values({ id: randomUUID(), userId: recuperaId, accountId: recuperaId, providerId: 'credential', password: await hashPassword(E2E_RECUPERA.password) });
```

- [ ] **Step 5: E2E que falha** — `e2e/recuperacao.spec.ts`

```ts
import { expect, test } from '@playwright/test';
import { esperarEmail, primeiroLink } from './mailpit';

const USUARIA = 'recupera-e2e@nutridebby.test';

test('esqueci minha senha: o e-mail chega e o link define a nova senha uma única vez (US-002)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.2.1' } });
  const page = await ctx.newPage();
  const antes = new Date();
  await page.goto('/esqueci-senha');
  await page.getByLabel('E-mail').fill(USUARIA);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await expect(page.getByRole('status')).toHaveText('Se o e-mail estiver cadastrado, você receberá um link');

  const email = await esperarEmail(USUARIA, { assunto: 'Redefinição de senha', depoisDe: antes });
  const link = primeiroLink(email.texto, '/api/auth/reset-password/');
  await page.goto(link);
  await expect(page).toHaveURL(/\/definir-senha\?token=/);
  const nova = `Nova${Date.now()}senha`;
  await page.getByLabel('Nova senha').fill(nova);
  await page.getByLabel('Repita a senha').fill(nova);
  await page.getByRole('button', { name: 'Definir senha' }).click();
  await expect(page.getByRole('status')).toContainText('Senha definida.');

  await page.goto(link); // uso único
  await expect(page.locator('p[role="alert"]')).toHaveText('Link inválido ou expirado. Peça um novo.');

  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(USUARIA);
  await page.getByLabel('Senha').fill(nova);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await ctx.close();
});
```

- [ ] **Step 6: Playwright sobe também o worker** — `playwright.config.ts`, trocar `webServer` por:

```ts
  webServer: [
    {
      command: `node_modules/.bin/next start -p ${new URL(baseURL).port || 3000}`,
      url: `${baseURL}/entrar`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // e-mails (Mailpit) são enviados pelo worker
      command: 'pnpm worker',
      wait: { stdout: /worker iniciado/ },
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    },
  ],
```

- [ ] **Step 7: Mailpit no job de E2E do CI** — `.github/workflows/ci.yml`, no job `e2e`, acrescentar ao `services:`:

```yaml
      mailpit:
        image: axllent/mailpit:v1.27
        ports: ['8025:8025', '1025:1025']
```

E ao `env:` do job:

```yaml
      EMAIL_FROM: 'NutriDebby <nao-responda@nutridebby.test>'
      EMAIL_TRANSPORT: mailpit
      MAILPIT_URL: http://localhost:8025
```

- [ ] **Step 8: Rodar o E2E localmente**

```bash
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate && pnpm e2e:seed && pnpm build
APP_URL=http://localhost:3100 pnpm test:e2e e2e/recuperacao.spec.ts
```

Expected: 1 passed. Depois `APP_URL=http://localhost:3100 pnpm test:e2e` inteiro: todos PASS (o `auth.spec.ts` não muda).

- [ ] **Step 9: Commit**

```bash
git add src/lib/password-links.ts src/lib/auth.ts src/lib/auth.test.ts scripts/admin-criar.ts scripts/e2e-seed.ts \
  e2e/mailpit.ts e2e/recuperacao.spec.ts playwright.config.ts .github/workflows/ci.yml
git commit -m "feat(auth): recuperação de senha por e-mail e tokens do Better Auth guardados em hash"
```

---

### Task 4: Auditoria automática de dado de saúde + "Histórico de acessos" (P02-08)

**Files:**
- Create: `drizzle/0006_auditoria_paciente.sql` (gerada), `drizzle/0007_auditoria_funcoes.sql` (custom), `src/db/audit-guard.ts`, `src/db/audit-guard.test.ts`, `src/modules/plataforma/audit.ts`, `src/modules/plataforma/audit.test.ts`, `src/modules/plataforma/ui/historico-acessos.tsx`, `src/modules/plataforma/ui/historico-acessos.test.ts`
- Modify: `src/db/schema/platform.ts` (`auditLog`), `src/db/tenant.ts`, `src/db/tenant.test.ts`, `src/db/rls-guard.ts`, `test/global-setup.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: `withTenant`, `TenantContext`, `Tx`, `Db`, `getDb` (Plano 01); `auditLog`, `user` (`@/db/schema`); `RLS_EXCEPTIONS`, `PATIENT_POLICY_EXCEPTIONS` (`@/db/rls-guard`).
- Produces (API que os Planos 03+ usam):
  - `TenantContext` ganha `actorUserId?: string` e `ip?: string | null` (viram `app.user_id` e `app.ip`); `role` validado em tempo de execução (`'nutri' | 'paciente' | 'worker'`).
  - SQL: `app_current_user()`, `app_current_ip()`, `app_enable_audit(tbl regclass, entidade text, col text DEFAULT 'patient_id')` — instala o gatilho `audit_row_change` (INSERT/UPDATE/DELETE → `criar`/`alterar`/`excluir`), `audit_log.patient_id`.
  - `@/modules/plataforma/audit`: `type AuditAction`, `type AuditEntry = { acao; entidade: string; entidadeId: string | null; patientId: string | null }`, `recordAudit(tx: Tx, e: AuditEntry | AuditEntry[]): Promise<void>`, `auditRead(tx: Tx, e: Omit<AuditEntry,'acao'> | Omit<AuditEntry,'acao'>[]): Promise<void>`, `HISTORICO_POR_PAGINA = 50`, `ACAO_ROTULO`, `ENTIDADE_ROTULO` (Planos 03+ acrescentam entradas), `type AccessHistoryItem`, `type AccessHistoryPage = { itens; pagina; totalPaginas; total }`, `listAccessHistory(ctx: TenantContext, patientId: string, pagina: number, db?: Db): Promise<AccessHistoryPage>`.
  - `@/modules/plataforma/ui/historico-acessos`: `HistoricoAcessosTabela({ pagina, fuso, baseHref })` (puro), `HistoricoAcessos({ ctx, patientId, pagina, fuso, baseHref })` (Server Component async), `formatarDataHora(d: Date, fuso: string): string`.
  - `@/db/audit-guard`: `AUDIT_EXCEPTIONS`, `findAuditViolations(db): Promise<{ table: string; problem: string }[]>`; `@/db/rls-guard`: `findStaleExceptions(db, maps: Record<string, Record<string, string>>): Promise<string[]>`.

- [ ] **Step 1: Coluna `patient_id` no `audit_log`** — em `src/db/schema/platform.ts`, no `auditLog`, acrescentar depois de `entidadeId`:

```ts
    /** Titular do dado (histórico por paciente, US-007). Nulo em ações que não são de um paciente. */
    patientId: uuid('patient_id'),
```

e trocar a lista de índices por:

```ts
    index('audit_log_busca_idx').on(t.tenantId, t.entidade, t.entidadeId, t.criadoEm),
    index('audit_log_paciente_idx').on(t.tenantId, t.patientId, t.criadoEm),
```

Run: `pnpm db:generate --name auditoria_paciente`
Expected: `drizzle/0006_auditoria_paciente.sql` com exatamente:

```sql
ALTER TABLE "audit_log" ADD COLUMN "patient_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_log_paciente_idx" ON "audit_log" USING btree ("tenant_id","patient_id","criado_em");
```

- [ ] **Step 2: Funções de auditoria** — `pnpm drizzle-kit generate --custom --name auditoria_funcoes` e preencher `drizzle/0007_auditoria_funcoes.sql`:

```sql
CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_ip() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.ip', true), '') $$;
--> statement-breakpoint
-- RNF-08 / US-007: toda escrita numa tabela de saúde vira uma linha no audit_log, com o ator
-- e o IP que o withTenant aplicou. Nada do conteúdo da linha é copiado (só id e titular).
-- clock_timestamp(): várias ações na mesma transação ficam em ordem.
CREATE OR REPLACE FUNCTION app_audit_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  INSERT INTO audit_log (tenant_id, actor_user_id, acao, entidade, entidade_id, patient_id, ip, criado_em)
  VALUES (
    (r ->> 'tenant_id')::uuid,
    app_current_user(),
    CASE TG_OP WHEN 'INSERT' THEN 'criar' WHEN 'UPDATE' THEN 'alterar' ELSE 'excluir' END,
    TG_ARGV[0],
    r ->> 'id',
    nullif(r ->> TG_ARGV[1], '')::uuid,
    app_current_ip(),
    clock_timestamp()
  );
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_enable_audit(tbl regclass, entidade text, col text DEFAULT 'patient_id') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON %s', tbl);
  EXECUTE format(
    'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON %s '
    'FOR EACH ROW EXECUTE FUNCTION app_audit_row_change(%L, %L)', tbl, entidade, col);
END $$;
--> statement-breakpoint
-- audit_log agora tem patient_id: sessão de paciente só vê/grava linhas do próprio titular
SELECT app_enable_patient_rls('audit_log');
```

O gatilho roda como o role que fez a escrita (`nutri_app`), então o `INSERT` passa pelas mesmas políticas: `tenant_id` da linha auditada = tenant da sessão; em sessão de paciente, `patient_id` = o próprio paciente.

- [ ] **Step 3: Fixtures de teste** — `test/global-setup.ts`, trocar o bloco SQL do `owner.query` por:

```ts
  await owner.query(`
    CREATE TABLE IF NOT EXISTS rls_fixture_patient_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      patient_id uuid NOT NULL,
      texto text NOT NULL
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON rls_fixture_patient_items TO nutri_app_role;
    SELECT app_enable_tenant_rls('rls_fixture_patient_items');
    SELECT app_enable_patient_rls('rls_fixture_patient_items');
    SELECT app_enable_audit('rls_fixture_patient_items', 'rls_fixture');

    -- Tabela de saúde de exemplo para os testes de auditoria (Tarefa 4 do Plano 02)
    CREATE TABLE IF NOT EXISTS audit_fixture_registros (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      patient_id uuid NOT NULL,
      texto text NOT NULL
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON audit_fixture_registros TO nutri_app_role;
    SELECT app_enable_tenant_rls('audit_fixture_registros');
    SELECT app_enable_patient_rls('audit_fixture_registros');
    SELECT app_enable_audit('audit_fixture_registros', 'registros_teste');
  `);
```

- [ ] **Step 4: Testes que falham do contexto** — em `src/db/tenant.test.ts`, acrescentar ao `describe('withTenant')`:

```ts
  it('aplica ator e IP do contexto para a auditoria', async () => {
    const actor = randomUUID();
    const r = await withTenant({ tenantId: A, role: 'nutri', actorUserId: actor, ip: '203.0.113.5' }, (tx) =>
      tx.execute<{ u: string; ip: string }>(sql`select app_current_user()::text as u, app_current_ip() as ip`), app.db);
    expect(r.rows[0]).toEqual({ u: actor, ip: '203.0.113.5' });
    const semAtor = await withTenant({ tenantId: A, role: 'worker' }, (tx) =>
      tx.execute<{ u: string | null }>(sql`select app_current_user()::text as u`), app.db);
    expect(semAtor.rows[0].u).toBeNull();
  });

  it('recusa papel fora da lista, ator que não é uuid e IP inválido (item adiado do Plano 01)', async () => {
    await expect(withTenant({ tenantId: A, role: 'admin' as never }, async () => 1, app.db)).rejects.toThrow(/papel/);
    await expect(withTenant({ tenantId: A, role: 'nutri', actorUserId: 'x' }, async () => 1, app.db)).rejects.toThrow(/actorUserId/);
    await expect(withTenant({ tenantId: A, role: 'nutri', ip: '999.1.1.1' }, async () => 1, app.db)).rejects.toThrow(/ip/);
  });
```

Run: `pnpm test src/db/tenant.test.ts` → FAIL (campos novos ignorados; `admin` aceito).

- [ ] **Step 5: Implementar** — `src/db/tenant.ts` inteiro:

```ts
import { isIP } from 'node:net';
import { sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from './client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TenantRole = 'nutri' | 'paciente' | 'worker';
const ROLES: readonly TenantRole[] = ['nutri', 'paciente', 'worker'];

export type TenantContext = {
  tenantId: string;
  role: TenantRole;
  patientId?: string;
  /** Quem age (auditoria, RNF-08). Ausente em jobs do worker. */
  actorUserId?: string;
  /** IP de quem fez a requisição (auditoria). */
  ip?: string | null;
};

export class TenantContextError extends Error {
  override name = 'TenantContextError';
}

function assertContext(ctx: TenantContext): void {
  if (!UUID.test(ctx.tenantId)) throw new TenantContextError('tenantId inválido');
  // Lista em tempo de execução: o tipo não protege chamadas vindas de `as` ou de JS
  if (!ROLES.includes(ctx.role)) throw new TenantContextError('papel inválido para withTenant (o admin nunca consulta tabelas 🔒)');
  if (ctx.role === 'paciente') {
    if (!ctx.patientId || !UUID.test(ctx.patientId)) {
      throw new TenantContextError('patientId obrigatório para sessão de paciente');
    }
  } else if (ctx.patientId !== undefined) {
    throw new TenantContextError('patientId só é permitido para sessão de paciente');
  }
  if (ctx.actorUserId !== undefined && !UUID.test(ctx.actorUserId)) throw new TenantContextError('actorUserId inválido');
  if (ctx.ip && isIP(ctx.ip) === 0) throw new TenantContextError('ip inválido');
}

/**
 * Executa `fn` numa transação com o contexto do tenant aplicado à RLS e à auditoria.
 * Toda consulta a tabela com tenant_id DEVE passar por aqui.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  db: Db = getDb(),
): Promise<T> {
  assertContext(ctx);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${ctx.tenantId}, true),
      set_config('app.role', ${ctx.role}, true),
      set_config('app.patient_id', ${ctx.patientId ?? ''}, true),
      set_config('app.user_id', ${ctx.actorUserId ?? ''}, true),
      set_config('app.ip', ${ctx.ip ?? ''}, true)`);
    return fn(tx);
  });
}
```

Run: `pnpm test src/db/tenant.test.ts` (o global-setup aplica as migrations novas no Postgres do Testcontainers) → PASS.

- [ ] **Step 6: Teste que falha da guarda de auditoria** — `src/db/audit-guard.test.ts`

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../test/db';
import { AUDIT_EXCEPTIONS, findAuditViolations } from './audit-guard';
import { findStaleExceptions, PATIENT_POLICY_EXCEPTIONS, RLS_EXCEPTIONS } from './rls-guard';

const owner = makeDb(inject('ownerDatabaseUrl'));
afterAll(() => owner.pool.end());

describe('guarda de auditoria (US-007: toda tabela de saúde é auditada)', () => {
  it('toda tabela com patient_id tem o gatilho audit_row_change', async () => {
    const v = await findAuditViolations(owner.pool);
    expect(v, JSON.stringify(v, null, 2)).toEqual([]);
  });

  it('detecta tabela de saúde nova sem gatilho (a guarda funciona)', async () => {
    const client = await owner.pool.connect();
    try {
      await client.query('begin');
      await client.query('create table tmp_saude_sem_audit (id uuid primary key, tenant_id uuid not null, patient_id uuid not null)');
      await client.query('create table patients (id uuid primary key, tenant_id uuid not null)');
      const v = await findAuditViolations(client);
      expect(v).toContainEqual({ table: 'tmp_saude_sem_audit', problem: 'sem gatilho de auditoria (app_enable_audit)' });
      expect(v).toContainEqual({ table: 'patients', problem: 'sem gatilho de auditoria (app_enable_audit)' });
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('as listas de exceção só citam tabelas que existem (item adiado do Plano 01)', async () => {
    expect(await findStaleExceptions(owner.pool, { RLS_EXCEPTIONS, PATIENT_POLICY_EXCEPTIONS, AUDIT_EXCEPTIONS })).toEqual([]);
    expect(await findStaleExceptions(owner.pool, { TESTE: { nao_existe: 'x' } })).toEqual(['TESTE: nao_existe']);
  });
});
```

Run: `pnpm test src/db/audit-guard.test.ts` → FAIL (`Cannot find module './audit-guard'`).

- [ ] **Step 7: Implementar** — `src/db/audit-guard.ts`

```ts
import type { Pool, PoolClient } from 'pg';

/** Tabelas com patient_id que não levam o gatilho de auditoria, com a justificativa. */
export const AUDIT_EXCEPTIONS: Record<string, string> = {
  audit_log: 'é o próprio registro de auditoria (append-only)',
};

/** Tabelas de dado de saúde (com patient_id, ou a própria `patients`) sem o gatilho audit_row_change. */
export async function findAuditViolations(db: Pool | PoolClient): Promise<{ table: string; problem: string }[]> {
  const { rows } = await db.query<{ table: string }>(`
    select c.relname as table
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind in ('r', 'p')
       and (c.relname = 'patients'
            or exists (select 1 from information_schema.columns k
                        where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'patient_id'))
       and not exists (select 1 from pg_trigger t
                        where t.tgrelid = c.oid and t.tgname = 'audit_row_change' and not t.tgisinternal)
     order by 1`);
  return rows
    .filter((r) => !AUDIT_EXCEPTIONS[r.table])
    .map((r) => ({ table: r.table, problem: 'sem gatilho de auditoria (app_enable_audit)' }));
}
```

Em `src/db/rls-guard.ts`, acrescentar ao final:

```ts
/** Nomes citados nas listas de exceção que não existem no banco (lista esquecida após renomear/remover). */
export async function findStaleExceptions(
  db: Pool | PoolClient,
  maps: Record<string, Record<string, string>>,
): Promise<string[]> {
  const nomes = [...new Set(Object.values(maps).flatMap((m) => Object.keys(m)))];
  if (!nomes.length) return [];
  const { rows } = await db.query<{ t: string }>(
    `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relname = any($1)`,
    [nomes],
  );
  const existentes = new Set(rows.map((r) => r.t));
  return Object.entries(maps).flatMap(([mapa, m]) =>
    Object.keys(m)
      .filter((t) => !existentes.has(t))
      .map((t) => `${mapa}: ${t}`),
  );
}
```

Run: `pnpm test src/db` → PASS (guarda de RLS, guarda de auditoria, tenant).

- [ ] **Step 8: Testes que falham da API de auditoria** — `src/modules/plataforma/audit.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { auditLog, tenants, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { auditRead, HISTORICO_POR_PAGINA, listAccessHistory, recordAudit } from './audit';

const app = makeDb(inject('appDatabaseUrl'));
let A: string;
let B: string;
let nutriId: string;
const P1 = randomUUID();
const P3 = randomUUID();

beforeAll(async () => {
  const [a, b] = await app.db
    .insert(tenants)
    .values([
      { slug: `aud-a-${randomUUID().slice(0, 8)}`, nomeExibicao: 'A' },
      { slug: `aud-b-${randomUUID().slice(0, 8)}`, nomeExibicao: 'B' },
    ])
    .returning({ id: tenants.id });
  A = a.id;
  B = b.id;
  nutriId = randomUUID();
  await app.db.insert(user).values({ id: nutriId, name: 'Debby Silva', email: `aud-${nutriId.slice(0, 8)}@teste.dev`, appRole: 'nutri', tenantId: A });
});
afterAll(() => app.pool.end());

const ctxA = (): TenantContext => ({ tenantId: A, role: 'nutri', actorUserId: nutriId, ip: '203.0.113.10' });
const logDe = (entidadeId: string) =>
  withTenant(ctxA(), (tx) => tx.select().from(auditLog).where(eq(auditLog.entidadeId, entidadeId)).orderBy(auditLog.criadoEm), app.db);

describe('auditoria automática (RNF-08, US-007)', () => {
  it('criar, alterar e excluir numa tabela de saúde viram linhas com ator, IP, paciente — sem o conteúdo', async () => {
    const id = await withTenant(ctxA(), async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${A}, ${P1}, 'peso 70 kg') returning id`);
      const novo = r.rows[0].id;
      await tx.execute(sql`update audit_fixture_registros set texto = 'peso 71 kg' where id = ${novo}`);
      await tx.execute(sql`delete from audit_fixture_registros where id = ${novo}`);
      return novo;
    }, app.db);
    const log = await logDe(id);
    expect(log.map((l) => l.acao)).toEqual(['criar', 'alterar', 'excluir']);
    for (const l of log) {
      expect(l).toMatchObject({ tenantId: A, actorUserId: nutriId, ip: '203.0.113.10', patientId: P1, entidade: 'registros_teste' });
    }
    expect(JSON.stringify(log)).not.toContain('peso');
  });

  it('auditRead grava a leitura na mesma transação', async () => {
    await withTenant(ctxA(), (tx) => auditRead(tx, { entidade: 'patients', entidadeId: P1, patientId: P1 }), app.db);
    const log = await logDe(P1);
    expect(log.at(-1)).toMatchObject({ acao: 'ler', entidade: 'patients', patientId: P1, actorUserId: nutriId });
  });

  it('escrita feita por job do worker fica sem ator (Sistema)', async () => {
    const id = await withTenant({ tenantId: A, role: 'worker' }, async (tx) =>
      (await tx.execute<{ id: string }>(sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${A}, ${P1}, 'x') returning id`)).rows[0].id, app.db);
    expect((await logDe(id))[0]).toMatchObject({ acao: 'criar', actorUserId: null, ip: null });
  });

  it('sem contexto de tenant não há como auditar (e a escrita auditada falha junto)', async () => {
    await expect(app.db.transaction((tx) => recordAudit(tx, { acao: 'ler', entidade: 'patients', entidadeId: P1, patientId: P1 }))).rejects.toThrow();
  });

  it('paciente grava o próprio registro e só enxerga a própria auditoria', async () => {
    const ctxP = { tenantId: A, role: 'paciente' as const, patientId: P1, actorUserId: randomUUID() };
    await withTenant(ctxP, (tx) => tx.execute(sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${A}, ${P1}, 'diário')`), app.db);
    const visto = await withTenant(ctxP, (tx) => tx.select().from(auditLog), app.db);
    expect(visto.length).toBeGreaterThan(0);
    expect(visto.every((l) => l.patientId === P1)).toBe(true);
  });
});

describe('listAccessHistory ("Histórico de acessos", 50 por página, mais recente primeiro)', () => {
  beforeAll(async () => {
    await withTenant(ctxA(), (tx) =>
      recordAudit(tx, Array.from({ length: 120 }, () => ({ acao: 'ler' as const, entidade: 'patients', entidadeId: P3, patientId: P3 }))), app.db);
  });

  it('pagina em 50, em ordem decrescente, com o nome de quem acessou', async () => {
    const p1 = await listAccessHistory(ctxA(), P3, 1, app.db);
    expect(p1).toMatchObject({ pagina: 1, totalPaginas: 3, total: 120 });
    expect(p1.itens).toHaveLength(HISTORICO_POR_PAGINA);
    for (let i = 1; i < p1.itens.length; i++) {
      expect(p1.itens[i - 1].criadoEm.getTime()).toBeGreaterThanOrEqual(p1.itens[i].criadoEm.getTime());
    }
    expect(p1.itens[0].ator).toEqual({ nome: 'Debby Silva', papel: 'nutri' });
    expect((await listAccessHistory(ctxA(), P3, 3, app.db)).itens).toHaveLength(20);
  });

  it('página fora da faixa é ajustada', async () => {
    expect((await listAccessHistory(ctxA(), P3, 99, app.db)).pagina).toBe(3);
    expect((await listAccessHistory(ctxA(), P3, 0, app.db)).pagina).toBe(1);
  });

  it('outro tenant não vê o histórico', async () => {
    expect((await listAccessHistory({ tenantId: B, role: 'nutri' }, P3, 1, app.db)).total).toBe(0);
  });
});
```

Run: `pnpm test src/modules/plataforma/audit.test.ts` → FAIL (`Cannot find module './audit'`).

- [ ] **Step 9: Implementar** — `src/modules/plataforma/audit.ts`

```ts
import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, type Db, type Tx } from '@/db/client';
import { auditLog, user } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';

export type AuditAction = 'ler' | 'criar' | 'alterar' | 'excluir' | 'exportar' | 'bloquear' | 'anonimizar';
export type AuditEntry = { acao: AuditAction; entidade: string; entidadeId: string | null; patientId: string | null };

/**
 * Grava no audit_log usando o tenant, o ator e o IP que o withTenant aplicou (app.*).
 * Fora de withTenant falha (tenant_id nulo) — de propósito.
 */
export async function recordAudit(tx: Tx, entries: AuditEntry | AuditEntry[]): Promise<void> {
  const lista = Array.isArray(entries) ? entries : [entries];
  if (!lista.length) return;
  const json = JSON.stringify(
    lista.map((e) => ({ acao: e.acao, entidade: e.entidade, entidade_id: e.entidadeId, patient_id: e.patientId })),
  );
  await tx.execute(sql`
    insert into audit_log (tenant_id, actor_user_id, acao, entidade, entidade_id, patient_id, ip, criado_em)
    select app_current_tenant(), app_current_user(), x.acao, x.entidade, x.entidade_id, x.patient_id,
           app_current_ip(), clock_timestamp()
      from jsonb_to_recordset(${json}::jsonb) as x(acao text, entidade text, entidade_id text, patient_id uuid)`);
}

/** Leitura de dado de saúde (US-007 "Leitura auditada"): chamar na transação que leu. */
export async function auditRead(
  tx: Tx,
  e: Omit<AuditEntry, 'acao'> | Omit<AuditEntry, 'acao'>[],
): Promise<void> {
  const lista = Array.isArray(e) ? e : [e];
  await recordAudit(tx, lista.map((x) => ({ ...x, acao: 'ler' as const })));
}

export const HISTORICO_POR_PAGINA = 50;

export const ACAO_ROTULO: Record<AuditAction, string> = {
  ler: 'Visualizou',
  criar: 'Criou',
  alterar: 'Alterou',
  excluir: 'Excluiu',
  exportar: 'Exportou',
  bloquear: 'Bloqueou',
  anonimizar: 'Anonimizou',
};

/** Nome amigável de cada entidade auditada. Cada plano acrescenta as suas tabelas. */
export const ENTIDADE_ROTULO: Record<string, string> = {
  patients: 'Cadastro do paciente',
};

export type AccessHistoryItem = {
  id: string;
  criadoEm: Date;
  acao: AuditAction;
  entidade: string;
  entidadeId: string | null;
  ip: string | null;
  /** null = ação do sistema (job do worker) */
  ator: { nome: string; papel: string } | null;
};
export type AccessHistoryPage = { itens: AccessHistoryItem[]; pagina: number; totalPaginas: number; total: number };

export async function listAccessHistory(
  ctx: TenantContext,
  patientId: string,
  pagina: number,
  db: Db = getDb(),
): Promise<AccessHistoryPage> {
  const r = await withTenant(ctx, async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(auditLog).where(eq(auditLog.patientId, patientId));
    const totalPaginas = Math.max(1, Math.ceil(n / HISTORICO_POR_PAGINA));
    const atual = Math.min(Math.max(1, Math.trunc(pagina) || 1), totalPaginas);
    const linhas = await tx
      .select()
      .from(auditLog)
      .where(eq(auditLog.patientId, patientId))
      .orderBy(desc(auditLog.criadoEm), desc(auditLog.id))
      .limit(HISTORICO_POR_PAGINA)
      .offset((atual - 1) * HISTORICO_POR_PAGINA);
    return { linhas, total: n, atual, totalPaginas };
  }, db);

  // Nomes dos atores: tabela `user` (identidade global, exceção de RLS acessada só pelo M1)
  const ids = [...new Set(r.linhas.map((l) => l.actorUserId).filter((x): x is string => !!x))];
  const atores = ids.length
    ? await db.select({ id: user.id, nome: user.name, papel: user.appRole }).from(user).where(inArray(user.id, ids))
    : [];
  const porId = new Map(atores.map((a) => [a.id, { nome: a.nome, papel: a.papel }]));

  return {
    pagina: r.atual,
    totalPaginas: r.totalPaginas,
    total: r.total,
    itens: r.linhas.map((l) => ({
      id: l.id,
      criadoEm: l.criadoEm,
      acao: l.acao as AuditAction,
      entidade: l.entidade,
      entidadeId: l.entidadeId,
      ip: l.ip,
      ator: l.actorUserId ? (porId.get(l.actorUserId) ?? { nome: 'Usuário removido', papel: '' }) : null,
    })),
  };
}
```

Run: `pnpm test src/modules/plataforma/audit.test.ts` → PASS (8 testes).

- [ ] **Step 10: Teste que falha do componente** — `src/modules/plataforma/ui/historico-acessos.test.ts`

```ts
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AccessHistoryItem, AccessHistoryPage } from '../audit';
import { formatarDataHora, HistoricoAcessosTabela } from './historico-acessos';

const item = (min: number, ator: AccessHistoryItem['ator']): AccessHistoryItem => ({
  id: `i${min}`, criadoEm: new Date(Date.UTC(2026, 9, 1, 12, min)), acao: 'ler', entidade: 'patients', entidadeId: 'p', ip: '203.0.113.1', ator,
});
const render = (pagina: AccessHistoryPage) =>
  renderToStaticMarkup(createElement(HistoricoAcessosTabela, { pagina, fuso: 'America/Sao_Paulo', baseHref: '/painel/pacientes/p' }));

describe('HistoricoAcessosTabela', () => {
  it('data no fuso do tenant, quem, ação, registro e IP; sem ator = Sistema', () => {
    const html = render({ itens: [item(1, { nome: 'Debby Silva', papel: 'nutri' }), item(0, null)], pagina: 1, totalPaginas: 1, total: 2 });
    for (const t of ['Histórico de acessos', '01/10/2026, 09:01', 'Debby Silva (nutricionista)', 'Sistema', 'Visualizou', 'Cadastro do paciente', '203.0.113.1']) {
      expect(html).toContain(t);
    }
    expect(html).not.toContain('Próxima');
  });
  it('paginação com ?pagina=', () => {
    const html = render({ itens: [item(0, null)], pagina: 2, totalPaginas: 3, total: 120 });
    expect(html).toContain('href="/painel/pacientes/p?pagina=1"');
    expect(html).toContain('href="/painel/pacientes/p?pagina=3"');
    expect(html).toContain('Página 2 de 3');
  });
  it('sem acessos', () => {
    expect(render({ itens: [], pagina: 1, totalPaginas: 1, total: 0 })).toContain('Nenhum acesso registrado.');
  });
  it('formatarDataHora usa dd/mm/aaaa no fuso', () => {
    expect(formatarDataHora(new Date('2026-10-01T02:30:00Z'), 'America/Sao_Paulo')).toBe('30/09/2026, 23:30');
  });
});
```

Run: `pnpm test src/modules/plataforma/ui` → FAIL.

- [ ] **Step 11: Implementar** — `src/modules/plataforma/ui/historico-acessos.tsx`

```tsx
import type { TenantContext } from '@/db/tenant';
import { ACAO_ROTULO, ENTIDADE_ROTULO, listAccessHistory, type AccessHistoryPage } from '../audit';

const PAPEL: Record<string, string> = { nutri: 'nutricionista', paciente: 'paciente', admin: 'administração' };

export function formatarDataHora(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

/** Aba "Histórico de acessos" do prontuário (US-007). Montada no prontuário no P03-01. */
export function HistoricoAcessosTabela({ pagina, fuso, baseHref }: { pagina: AccessHistoryPage; fuso: string; baseHref: string }) {
  const href = (n: number) => `${baseHref}${baseHref.includes('?') ? '&' : '?'}pagina=${n}`;
  return (
    <section aria-labelledby="historico-acessos-titulo" className="space-y-3">
      <h2 id="historico-acessos-titulo" className="text-lg font-semibold">Histórico de acessos</h2>
      {pagina.total === 0 ? (
        <p>Nenhum acesso registrado.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Acessos ao prontuário, do mais recente para o mais antigo</caption>
          <thead>
            <tr>
              <th scope="col">Data e hora</th>
              <th scope="col">Quem</th>
              <th scope="col">Ação</th>
              <th scope="col">Registro</th>
              <th scope="col">IP</th>
            </tr>
          </thead>
          <tbody>
            {pagina.itens.map((i) => (
              <tr key={i.id} className="border-t">
                <td>{formatarDataHora(i.criadoEm, fuso)}</td>
                <td>{i.ator ? `${i.ator.nome}${PAPEL[i.ator.papel] ? ` (${PAPEL[i.ator.papel]})` : ''}` : 'Sistema'}</td>
                <td>{ACAO_ROTULO[i.acao]}</td>
                <td>{ENTIDADE_ROTULO[i.entidade] ?? i.entidade}</td>
                <td>{i.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pagina.totalPaginas > 1 && (
        <nav aria-label="Páginas do histórico de acessos" className="flex gap-4 text-sm">
          {pagina.pagina > 1 && <a href={href(pagina.pagina - 1)} className="underline">Anterior</a>}
          <span>{`Página ${pagina.pagina} de ${pagina.totalPaginas}`}</span>
          {pagina.pagina < pagina.totalPaginas && <a href={href(pagina.pagina + 1)} className="underline">Próxima</a>}
        </nav>
      )}
    </section>
  );
}

export async function HistoricoAcessos(props: { ctx: TenantContext; patientId: string; pagina: number; fuso: string; baseHref: string }) {
  const pagina = await listAccessHistory(props.ctx, props.patientId, props.pagina);
  return <HistoricoAcessosTabela pagina={pagina} fuso={props.fuso} baseHref={props.baseHref} />;
}
```

Textos montados com variáveis vão numa única template string (`{`Olá, ${x}`}`): assim o React não separa os nós e o HTML fica previsível nos testes.

Run: `pnpm test src/modules/plataforma/ui` → PASS (4 testes).

- [ ] **Step 12: Regra no `CLAUDE.md`** — acrescentar à lista "Regras obrigatórias":

```markdown
8. Dado de saúde (tabela com `patient_id`, e a própria `patients`): na migration de RLS, também `SELECT app_enable_audit('<tabela>', '<entidade>');` (para `patients`: `app_enable_audit('patients', 'patients', 'id')`). Escritas viram `audit_log` sozinhas; ao **devolver** dado de saúde, chamar `auditRead(tx, …)` na mesma transação (`src/modules/plataforma/audit.ts`). O `withTenant` de sessão de usuário leva `actorUserId` e `ip`. Migration de **dados** numa tabela auditada: `set_config('app.tenant_id', …)` por tenant, ou `DISABLE TRIGGER audit_row_change` só dentro da própria migration. A guarda `src/db/audit-guard.test.ts` quebra o CI se faltar o gatilho.
```

- [ ] **Step 13: Rodar tudo e commit**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: PASS (inclusive a guarda de RLS com `audit_log` agora com `patient_isolation`).

```bash
git add drizzle src/db src/modules/plataforma/audit.ts src/modules/plataforma/audit.test.ts src/modules/plataforma/ui test/global-setup.ts CLAUDE.md
git commit -m "feat(auditoria): gatilho app_enable_audit, auditRead, histórico de acessos paginado e guarda no CI"
```

---
### Task 5: Admin cria conta de nutricionista + convite de 72 h + reenviar (P02-03)

**Files:**
- Create: `src/db/schema/access.ts`, `drizzle/0008_tenants_convites.sql` (gerada), `src/db/errors.ts`, `src/lib/validacao.ts`, `src/components/campo.tsx`, `src/modules/plataforma/convites.ts`, `src/modules/plataforma/contas.ts`, `src/modules/plataforma/contas.test.ts`, `src/app/admin/actions.ts`, `src/app/admin/contas/nova/page.tsx`, `src/app/admin/contas/nova/form.tsx`
- Modify: `src/db/schema/platform.ts` (`tenants`), `src/db/schema/index.ts`, `src/db/client.ts` (tipo `Queryable`), `src/modules/plataforma/admin-bootstrap.ts`, `src/modules/plataforma/admin-bootstrap.test.ts`, `src/app/admin/page.tsx`, `CLAUDE.md` (regra 1)

**Interfaces:**
- Consumes: `enqueueEmail(msg, { tenantId, tx })` (Tarefa 2); `randomToken`, `sha256` (Tarefa 1); `normalizeEmail` (`@/lib/text`); `requireUser(['admin'], path)` (Plano 01); `getEnv().APP_URL`.
- Produces:
  - Schema: `tenants` com todas as colunas do §7 (`crn`, `logoPath`, `corPrimaria`, `waCotaMensal` 500, `antecedenciaMinH` 12, `cancelamentoMinH` 24, `enderecoConsultorio`, `linkOnlinePadrao`, `agendamentoPublicoAtivo` true, `mostrarPercGorduraPaciente` false, `armazenamentoBytes` 0, `dpaAceitoEm`) + `dpaVersao`; `type TenantRow = typeof tenants.$inferSelect`; tabela `invites` (`userId`, `tipo`, `tokenHash` UNIQUE, `expiraEm`, `usadoEm`).
  - `@/db/client`: `type Queryable = Pick<Tx, 'select' | 'insert' | 'update' | 'delete' | 'execute'>` (aceita `Db` ou `Tx`).
  - `@/db/errors`: `uniqueViolation(err: unknown): string | null` (nome da constraint).
  - `@/lib/validacao`: `primeiroErroPorCampo(error: z.ZodError): Record<string, string>`.
  - `@/components/campo`: `<Campo id rotulo erro? dica? {...input} />` (label + `aria-invalid` + `aria-describedby`).
  - `@/modules/plataforma/convites`: `CONVITE_NUTRI_VALIDADE_MS`, `CONVITE_EXPIRADO`, `CONVITE_INVALIDO`, `type EstadoConvite`, `criarConvite(q: Queryable, userId, now?)`, `inspecionarConvite(q: Queryable, token, now?)`, `linkDoConvite(appUrl, token)`.
  - `@/modules/plataforma/contas`: `CRN_REGEX`, `MSG`, `nomeExibicaoSchema`, `crnSchema`, `novaContaSchema`, `class ContaError { erros: ErrosDeCampo }`, `criarContaNutri(input, deps?)`, `reenviarConvite(tenantId, deps?)`, `type ContaResumo`, `listarContas(db?, now?)`.
  - Server Actions `criarContaAction(prev, formData)` e `reenviarConviteAction(tenantId)` em `@/app/admin/actions`.

- [ ] **Step 1: Schema** — em `src/db/schema/platform.ts`, trocar o import e a tabela `tenants` por:

```ts
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    nomeExibicao: text('nome_exibicao').notNull(),
    status: text('status').notNull().default('ativa'),
    fuso: text('fuso').notNull().default('America/Sao_Paulo'),
    crn: text('crn'),
    logoPath: text('logo_path'),
    corPrimaria: text('cor_primaria'),
    waCotaMensal: integer('wa_cota_mensal').notNull().default(500),
    antecedenciaMinH: integer('antecedencia_min_h').notNull().default(12),
    cancelamentoMinH: integer('cancelamento_min_h').notNull().default(24),
    enderecoConsultorio: text('endereco_consultorio'),
    linkOnlinePadrao: text('link_online_padrao'),
    agendamentoPublicoAtivo: boolean('agendamento_publico_ativo').notNull().default(true),
    mostrarPercGorduraPaciente: boolean('mostrar_perc_gordura_paciente').notNull().default(false),
    armazenamentoBytes: bigint('armazenamento_bytes', { mode: 'number' }).notNull().default(0),
    dpaAceitoEm: timestamp('dpa_aceito_em', { withTimezone: true }),
    dpaVersao: text('dpa_versao'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenants_slug_formato', sql`${t.slug} ~ '^[a-z0-9-]{3,40}$'`),
    check('tenants_status_valido', sql`${t.status} in ('ativa', 'suspensa')`),
    check('tenants_cor_formato', sql`${t.corPrimaria} is null or ${t.corPrimaria} ~ '^#[0-9a-fA-F]{6}$'`),
    check('tenants_antecedencia_faixa', sql`${t.antecedenciaMinH} between 0 and 72`),
    check('tenants_cancelamento_faixa', sql`${t.cancelamentoMinH} between 0 and 72`),
    check('tenants_wa_cota_valida', sql`${t.waCotaMensal} >= 0`),
    check('tenants_armazenamento_valido', sql`${t.armazenamentoBytes} >= 0`),
  ],
);

export type TenantRow = typeof tenants.$inferSelect;
```

`src/db/schema/access.ts` (arquivo novo, evita import circular entre `platform.ts` e `auth.ts`):

```ts
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

/** Convites de primeiro acesso (US-001). Só o SHA-256 do token é guardado. */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tipo: text('tipo').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    usadoEm: timestamp('usado_em', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('invites_tipo_valido', sql`${t.tipo} in ('nutri')`), index('invites_user_idx').on(t.userId)],
);
```

`src/db/schema/index.ts`:

```ts
export * from './platform';
export * from './auth';
export * from './access';
```

Em `src/db/client.ts`, depois de `export type Tx = …`:

```ts
/** Algo que executa consultas: o `Db` ou uma transação (`Tx`). */
export type Queryable = Pick<Tx, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
```

Run: `pnpm db:generate --name tenants_convites`
Expected: `drizzle/0008_tenants_convites.sql` com `ALTER TABLE "tenants" ADD COLUMN` para as 13 colunas (as `NOT NULL` com `DEFAULT`), os 5 `CHECK` novos e `CREATE TABLE "invites"` com `invites_token_hash_unique`, FK para `"user"` `ON DELETE cascade` e o índice `invites_user_idx`. Nenhuma tabela nova tem `tenant_id` (a guarda de RLS não muda).

- [ ] **Step 2: Utilitários** — `src/db/errors.ts`

```ts
/** Nome da constraint UNIQUE violada (Postgres 23505), olhando também o `cause` do erro do Drizzle. */
export function uniqueViolation(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; e && typeof e === 'object' && i < 5; i++) {
    const pg = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (pg.code === '23505') return typeof pg.constraint === 'string' ? pg.constraint : '';
    e = pg.cause;
  }
  return null;
}
```

`src/lib/validacao.ts`

```ts
import type { z } from 'zod';

/** Primeira mensagem de cada campo (o formulário mostra uma por campo). */
export function primeiroErroPorCampo(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const campo = String(issue.path[0] ?? 'geral');
    out[campo] ??= issue.message;
  }
  return out;
}
```

`src/components/campo.tsx`

```tsx
import type { InputHTMLAttributes } from 'react';

type Props = { id: string; rotulo: string; erro?: string; dica?: string } & InputHTMLAttributes<HTMLInputElement>;

/** Campo acessível: label associada, dica e erro ligados por aria-describedby. */
export function Campo({ id, rotulo, erro, dica, ...input }: Props) {
  const descricao = [dica ? `${id}-dica` : null, erro ? `${id}-erro` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">{rotulo}</label>
      <input id={id} name={id} aria-invalid={erro ? true : undefined} aria-describedby={descricao} className="w-full rounded border p-2" {...input} />
      {dica && <p id={`${id}-dica`} className="text-sm text-zinc-600">{dica}</p>}
      {erro && <p id={`${id}-erro`} role="alert" className="text-sm text-red-700">{erro}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Testes que falham** — `src/modules/plataforma/contas.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { account, invites, tenants, user } from '@/db/schema';
import { EMAIL_FINALIDADE } from '@/email/queue';
import type { EmailJobData, EmailMessage } from '@/email/types';
import { getBoss, stopBoss } from '@/jobs/boss';
import { openSecret, sha256 } from '@/lib/crypto';
import { ContaError, criarContaNutri, listarContas, reenviarConvite } from './contas';
import { inspecionarConvite } from './convites';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T12:00:00Z');
const deps = { db: app.db, appUrl: 'http://localhost:3000', now };
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});

const s = () => randomUUID().slice(0, 8);
async function convitesPara(email: string): Promise<string[]> {
  const jobs = await (await getBoss()).findJobs<EmailJobData>('email');
  return jobs
    .map((j) => JSON.parse(openSecret(j.data.selado, EMAIL_FINALIDADE)) as EmailMessage)
    .filter((m): m is Extract<EmailMessage, { tipo: 'convite_nutri' }> => m.tipo === 'convite_nutri' && m.para === email)
    .map((m) => m.link);
}
const tokenDe = (link: string) => link.split('/convite/')[1];
const contar = async () => ({
  t: (await app.db.select({ n: count() }).from(tenants))[0].n,
  u: (await app.db.select({ n: count() }).from(user))[0].n,
});

describe('criarContaNutri (US-001)', () => {
  it('cria tenant ativa com cota 500, nutri sem senha, convite de 72 h só em hash e e-mail na fila', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Debby Silva', email: `debby-${x}@exemplo.com`, crn: 'crn-3 12345', slug: `debby-${x}` }, deps);
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, r.tenantId));
    expect(t).toMatchObject({ status: 'ativa', waCotaMensal: 500, crn: 'CRN-3 12345', slug: `debby-${x}`, nomeExibicao: 'Debby Silva' });
    const [u] = await app.db.select().from(user).where(eq(user.id, r.userId));
    expect(u).toMatchObject({ appRole: 'nutri', tenantId: r.tenantId, emailVerified: false, email: `debby-${x}@exemplo.com` });
    expect(await app.db.select().from(account).where(eq(account.userId, r.userId))).toEqual([]);
    const [c] = await app.db.select().from(invites).where(eq(invites.userId, r.userId));
    expect(c.expiraEm.toISOString()).toBe('2026-10-04T12:00:00.000Z');
    const links = await convitesPara(`debby-${x}@exemplo.com`);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatch(/^http:\/\/localhost:3000\/convite\/[A-Za-z0-9_-]{43}$/);
    expect(c.tokenHash).toBe(sha256(tokenDe(links[0])));
    expect(await inspecionarConvite(app.db, tokenDe(links[0]), now)).toMatchObject({ estado: 'valido', email: `debby-${x}@exemplo.com`, nome: 'Debby Silva' });
    expect(await inspecionarConvite(app.db, tokenDe(links[0]), new Date('2026-10-04T12:00:01Z'))).toEqual({ estado: 'expirado' });
    expect(await inspecionarConvite(app.db, 'A'.repeat(43), now)).toEqual({ estado: 'invalido' });
    expect(await inspecionarConvite(app.db, '../etc', now)).toEqual({ estado: 'invalido' });
  });

  it('mensagens exatas de validação', async () => {
    const e = await criarContaNutri({ nomeExibicao: 'Db', email: 'nao-e-email', crn: '12345', slug: 'a b' }, deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ContaError);
    expect((e as ContaError).erros).toEqual({
      nomeExibicao: 'Informe o nome (3 a 80 caracteres)',
      email: 'Informe um e-mail válido',
      crn: 'CRN inválido. Ex.: CRN-3 12345',
      slug: 'Use de 3 a 40 letras minúsculas, números ou hífen',
    });
  });

  it('slug duplicado: "Endereço já em uso" e nenhum tenant ou usuário é criado', async () => {
    const x = s();
    await criarContaNutri({ nomeExibicao: 'Primeira', email: `p-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `dup-${x}` }, deps);
    const antes = await contar();
    const e = await criarContaNutri({ nomeExibicao: 'Segunda', email: `s-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `dup-${x}` }, deps).catch((x2: unknown) => x2);
    expect((e as ContaError).erros).toEqual({ slug: 'Endereço já em uso' });
    expect(await contar()).toEqual(antes);
  });

  it('e-mail e slug com maiúsculas e espaços são normalizados; duplicidade sem diferenciar maiúsculas (Review Focus 1)', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: '  Ana Paula  ', email: `  Ana.Paula-${x}@Exemplo.COM `, crn: 'CRN3 123', slug: `  Ana-${x} ` }, deps);
    const [u] = await app.db.select().from(user).where(eq(user.id, r.userId));
    expect(u.email).toBe(`ana.paula-${x}@exemplo.com`);
    expect(u.name).toBe('Ana Paula');
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, r.tenantId));
    expect(t.slug).toBe(`ana-${x}`);
    const e = await criarContaNutri({ nomeExibicao: 'Outra', email: `ANA.PAULA-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `outra-${x}` }, deps).catch((y: unknown) => y);
    expect((e as ContaError).erros).toEqual({ email: 'E-mail já cadastrado' });
  });

  it('corrida entre dois admins com o mesmo endereço: um cria, o outro recebe "Endereço já em uso"', async () => {
    const x = s();
    const [a, b] = await Promise.allSettled([
      criarContaNutri({ nomeExibicao: 'Corrida A', email: `ca-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `corrida-${x}` }, deps),
      criarContaNutri({ nomeExibicao: 'Corrida B', email: `cb-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `corrida-${x}` }, deps),
    ]);
    const ok = [a, b].filter((p) => p.status === 'fulfilled');
    const falha = [a, b].find((p): p is PromiseRejectedResult => p.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect((falha!.reason as ContaError).erros).toEqual({ slug: 'Endereço já em uso' });
  });
});

describe('reenviarConvite (US-001 "Convite expirado")', () => {
  it('troca o convite: o link antigo deixa de valer e um novo e-mail é enfileirado', async () => {
    const x = s();
    const email = `reenvio-${x}@exemplo.com`;
    const r = await criarContaNutri({ nomeExibicao: 'Reenvio', email, crn: 'CRN-3 12345', slug: `reenvio-${x}` }, deps);
    const [antigo] = await convitesPara(email);
    const depois = new Date('2026-10-05T12:00:00Z'); // o primeiro já expirou
    await reenviarConvite(r.tenantId, { ...deps, now: depois });
    const links = await convitesPara(email);
    expect(links).toHaveLength(2);
    const novo = links.find((l) => l !== antigo)!;
    expect(await inspecionarConvite(app.db, tokenDe(antigo), depois)).toEqual({ estado: 'invalido' });
    expect(await inspecionarConvite(app.db, tokenDe(novo), depois)).toMatchObject({ estado: 'valido' });
  });

  it('recusa quando a nutricionista já definiu a senha', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Com senha', email: `cs-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `com-senha-${x}` }, deps);
    await app.db.insert(account).values({ id: randomUUID(), userId: r.userId, accountId: r.userId, providerId: 'credential', password: 'x' });
    await expect(reenviarConvite(r.tenantId, deps)).rejects.toBeInstanceOf(ContaError);
  });
});

describe('listarContas', () => {
  it('mostra o estado do convite: pendente, expirado e aceito', async () => {
    const x = s();
    const r = await criarContaNutri({ nomeExibicao: 'Lista', email: `lista-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `lista-${x}` }, deps);
    const achar = async (quando: Date) => (await listarContas(app.db, quando)).find((c) => c.tenantId === r.tenantId)!;
    expect(await achar(now)).toMatchObject({ convite: 'pendente', email: `lista-${x}@exemplo.com`, status: 'ativa', slug: `lista-${x}` });
    expect((await achar(new Date('2026-10-05T00:00:00Z'))).convite).toBe('expirado');
    await app.db.insert(account).values({ id: randomUUID(), userId: r.userId, accountId: r.userId, providerId: 'credential', password: 'x' });
    await app.db.update(invites).set({ usadoEm: now }).where(and(eq(invites.userId, r.userId)));
    expect((await achar(now)).convite).toBe('aceito');
  });
});
```

Run: `pnpm test src/modules/plataforma/contas.test.ts`
Expected: FAIL — `Cannot find module './contas'`.

- [ ] **Step 4: Implementar os convites** — `src/modules/plataforma/convites.ts`

```ts
import { and, eq, isNull } from 'drizzle-orm';
import type { Queryable } from '@/db/client';
import { invites, user } from '@/db/schema';
import { randomToken, sha256 } from '@/lib/crypto';

export const CONVITE_NUTRI_VALIDADE_MS = 72 * 60 * 60 * 1000; // US-001: 72 h
export const CONVITE_EXPIRADO = 'Convite expirado. Peça um novo ao suporte.';
export const CONVITE_INVALIDO =
  'Convite inválido ou já usado. Se você já definiu sua senha, entre com seu e-mail e senha.';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type EstadoConvite =
  | { estado: 'valido'; userId: string; email: string; nome: string }
  | { estado: 'expirado' }
  | { estado: 'invalido' };

/** Cria um convite e invalida os anteriores ainda não usados do mesmo usuário. Devolve o token em claro (só para o e-mail). */
export async function criarConvite(q: Queryable, userId: string, now: Date = new Date()): Promise<{ token: string; expiraEm: Date }> {
  const token = randomToken();
  const expiraEm = new Date(now.getTime() + CONVITE_NUTRI_VALIDADE_MS);
  await q.delete(invites).where(and(eq(invites.userId, userId), isNull(invites.usadoEm)));
  await q.insert(invites).values({ userId, tipo: 'nutri', tokenHash: sha256(token), expiraEm, createdAt: now });
  return { token, expiraEm };
}

export function linkDoConvite(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/convite/${token}`;
}

export async function inspecionarConvite(q: Queryable, token: string, now: Date = new Date()): Promise<EstadoConvite> {
  if (!TOKEN.test(token)) return { estado: 'invalido' };
  const [c] = await q
    .select({ userId: invites.userId, expiraEm: invites.expiraEm, usadoEm: invites.usadoEm, email: user.email, nome: user.name })
    .from(invites)
    .innerJoin(user, eq(user.id, invites.userId))
    .where(eq(invites.tokenHash, sha256(token)));
  if (!c || c.usadoEm) return { estado: 'invalido' };
  if (c.expiraEm.getTime() <= now.getTime()) return { estado: 'expirado' };
  return { estado: 'valido', userId: c.userId, email: c.email, nome: c.nome };
}
```

- [ ] **Step 5: Implementar as contas** — `src/modules/plataforma/contas.ts`

```ts
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { uniqueViolation } from '@/db/errors';
import { account, tenants, user } from '@/db/schema';
import { enqueueEmail } from '@/email/queue';
import { getEnv } from '@/env';
import { normalizeEmail } from '@/lib/text';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { criarConvite, linkDoConvite } from './convites';

export const CRN_REGEX = /^CRN-?\d{1,2}\s?\d{3,6}$/i;

export const MSG = {
  nome: 'Informe o nome (3 a 80 caracteres)',
  emailInvalido: 'Informe um e-mail válido',
  emailDuplicado: 'E-mail já cadastrado',
  crn: 'CRN inválido. Ex.: CRN-3 12345',
  slugFormato: 'Use de 3 a 40 letras minúsculas, números ou hífen',
  slugDuplicado: 'Endereço já em uso',
  jaTemSenha: 'A nutricionista já definiu a senha. Se ela esqueceu, use "Esqueci minha senha".',
} as const;

export const nomeExibicaoSchema = z.string().trim().min(3, MSG.nome).max(80, MSG.nome);
export const crnSchema = z.string().trim().regex(CRN_REGEX, MSG.crn).transform((v) => v.toUpperCase());

export const novaContaSchema = z.object({
  nomeExibicao: nomeExibicaoSchema,
  email: z.string().transform(normalizeEmail).pipe(z.email({ message: MSG.emailInvalido })),
  crn: crnSchema,
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/, MSG.slugFormato),
});

export type ErrosDeCampo = Partial<Record<'nomeExibicao' | 'email' | 'crn' | 'slug' | 'geral', string>>;

export class ContaError extends Error {
  override name = 'ContaError';
  constructor(readonly erros: ErrosDeCampo) {
    super('Dados da conta inválidos');
  }
}

type Deps = { db?: Db; appUrl?: string; now?: Date };

/** US-001: tenant + nutri sem senha + convite de 72 h + e-mail, tudo na mesma transação. */
export async function criarContaNutri(input: Record<string, unknown>, deps: Deps = {}): Promise<{ tenantId: string; userId: string }> {
  const db = deps.db ?? getDb();
  const appUrl = deps.appUrl ?? getEnv().APP_URL;
  const parsed = novaContaSchema.safeParse(input);
  if (!parsed.success) throw new ContaError(primeiroErroPorCampo(parsed.error));
  const v = parsed.data;

  // Pré-checagem para mensagens amigáveis; em corrida quem decide é a constraint UNIQUE (abaixo)
  const erros: ErrosDeCampo = {};
  if ((await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, v.slug))).length) erros.slug = MSG.slugDuplicado;
  if ((await db.select({ id: user.id }).from(user).where(eq(user.email, v.email))).length) erros.email = MSG.emailDuplicado;
  if (Object.keys(erros).length) throw new ContaError(erros);

  try {
    return await db.transaction(async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug: v.slug, nomeExibicao: v.nomeExibicao, crn: v.crn }).returning({ id: tenants.id });
      const userId = randomUUID();
      await tx.insert(user).values({ id: userId, name: v.nomeExibicao, email: v.email, emailVerified: false, appRole: 'nutri', tenantId: t.id });
      const { token } = await criarConvite(tx, userId, deps.now);
      await enqueueEmail({ tipo: 'convite_nutri', para: v.email, nome: v.nomeExibicao, link: linkDoConvite(appUrl, token) }, { tenantId: t.id, tx });
      return { tenantId: t.id, userId };
    });
  } catch (err) {
    const c = uniqueViolation(err);
    if (c === 'tenants_slug_unique') throw new ContaError({ slug: MSG.slugDuplicado });
    if (c === 'user_email_unique') throw new ContaError({ email: MSG.emailDuplicado });
    throw err;
  }
}

export async function reenviarConvite(tenantId: string, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? getDb();
  const appUrl = deps.appUrl ?? getEnv().APP_URL;
  const [u] = await db
    .select({ id: user.id, email: user.email, nome: user.name })
    .from(user)
    .where(and(eq(user.tenantId, tenantId), eq(user.appRole, 'nutri')));
  if (!u) throw new ContaError({ geral: 'Conta sem nutricionista.' });
  const comSenha = await db.select({ id: account.id }).from(account).where(and(eq(account.userId, u.id), eq(account.providerId, 'credential')));
  if (comSenha.length) throw new ContaError({ geral: MSG.jaTemSenha });
  await db.transaction(async (tx) => {
    const { token } = await criarConvite(tx, u.id, deps.now);
    await enqueueEmail({ tipo: 'convite_nutri', para: u.email, nome: u.nome, link: linkDoConvite(appUrl, token) }, { tenantId, tx });
  });
}

export type ContaResumo = {
  tenantId: string;
  slug: string;
  nomeExibicao: string;
  status: 'ativa' | 'suspensa';
  crn: string | null;
  email: string | null;
  convite: 'aceito' | 'pendente' | 'expirado' | 'sem_convite';
  conviteExpiraEm: Date | null;
  criadaEm: Date;
};

/** Lista para o admin: só `tenants`, `user`, `account` e `invites` — nenhuma tabela 🔒. */
export async function listarContas(db: Db = getDb(), now: Date = new Date()): Promise<ContaResumo[]> {
  const r = await db.execute<{
    tenant_id: string; slug: string; nome_exibicao: string; status: 'ativa' | 'suspensa'; crn: string | null;
    created_at: Date; email: string | null; tem_senha: boolean; convite_expira: Date | null;
  }>(sql`
    select t.id as tenant_id, t.slug, t.nome_exibicao, t.status, t.crn, t.created_at, u.email,
           exists (select 1 from account a where a.user_id = u.id and a.provider_id = 'credential') as tem_senha,
           (select max(i.expira_em) from invites i where i.user_id = u.id and i.usado_em is null) as convite_expira
      from tenants t
      left join "user" u on u.tenant_id = t.id and u.app_role = 'nutri'
     order by t.created_at desc`);
  return r.rows.map((row) => {
    const expira = row.convite_expira ? new Date(row.convite_expira) : null;
    const convite = row.tem_senha ? 'aceito' : !expira ? 'sem_convite' : expira.getTime() > now.getTime() ? 'pendente' : 'expirado';
    return {
      tenantId: row.tenant_id, slug: row.slug, nomeExibicao: row.nome_exibicao, status: row.status, crn: row.crn,
      email: row.email, convite, conviteExpiraEm: expira, criadaEm: new Date(row.created_at),
    };
  });
}
```

Run: `pnpm test src/modules/plataforma/contas.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 6: Corrida do `admin:criar` (item adiado do Plano 01)** — em `src/modules/plataforma/admin-bootstrap.test.ts`, acrescentar:

```ts
  it('dois admin:criar simultâneos com o mesmo e-mail: um cria, o outro recebe a mensagem de duplicado', async () => {
    const email = `corrida-${Date.now()}@exemplo.com`;
    const r = await Promise.allSettled([createAdmin(email, deps), createAdmin(email, deps)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const falha = r.find((x): x is PromiseRejectedResult => x.status === 'rejected')!;
    expect(falha.reason).toBeInstanceOf(AdminBootstrapError);
    expect((falha.reason as Error).message).toBe('Já existe um usuário com este e-mail');
  });
```

Run: `pnpm test src/modules/plataforma/admin-bootstrap.test.ts` → FAIL (a segunda inserção sobe como erro do Postgres).

Em `src/modules/plataforma/admin-bootstrap.ts`, importar `uniqueViolation` de `@/db/errors` e trocar a linha do `insert(user)` por:

```ts
  try {
    await deps.db.insert(user).values({ id: userId, name: 'Administrador', email, emailVerified: true, appRole: 'admin' });
  } catch (err) {
    if (uniqueViolation(err) === 'user_email_unique') throw new AdminBootstrapError('Já existe um usuário com este e-mail');
    throw err;
  }
```

Run: `pnpm test src/modules/plataforma/admin-bootstrap.test.ts` → PASS.

- [ ] **Step 7: Telas do admin** — `src/app/admin/actions.ts`

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/session';
import { ContaError, criarContaNutri, reenviarConvite, type ErrosDeCampo } from '@/modules/plataforma/contas';

export type CriarContaState = { erros?: ErrosDeCampo; valores?: Record<string, string> };

const campo = (f: FormData, k: string) => String(f.get(k) ?? '');
const uuid = z.uuid();

export async function criarContaAction(_prev: CriarContaState, formData: FormData): Promise<CriarContaState> {
  await requireUser(['admin'], '/admin/contas/nova');
  const valores = {
    nomeExibicao: campo(formData, 'nomeExibicao'),
    email: campo(formData, 'email'),
    crn: campo(formData, 'crn'),
    slug: campo(formData, 'slug'),
  };
  try {
    await criarContaNutri(valores);
  } catch (e) {
    if (e instanceof ContaError) return { erros: e.erros, valores };
    throw e;
  }
  revalidatePath('/admin');
  redirect('/admin?aviso=criada');
}

export async function reenviarConviteAction(tenantId: string): Promise<void> {
  await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) redirect('/admin');
  let aviso = 'reenviado';
  try {
    await reenviarConvite(tenantId);
  } catch (e) {
    if (!(e instanceof ContaError)) throw e;
    aviso = 'ja_tem_senha';
  }
  revalidatePath('/admin');
  redirect(`/admin?aviso=${aviso}`);
}
```

`src/app/admin/contas/nova/form.tsx`

```tsx
'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import { criarContaAction, type CriarContaState } from '../../actions';

export function NovaContaForm() {
  const [state, action, pendente] = useActionState<CriarContaState, FormData>(criarContaAction, {});
  const e = state.erros ?? {};
  const v = state.valores ?? {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <Campo id="nomeExibicao" rotulo="Nome de exibição" required defaultValue={v.nomeExibicao} erro={e.nomeExibicao} />
      <Campo id="email" rotulo="E-mail" type="email" autoComplete="off" required defaultValue={v.email} erro={e.email} />
      <Campo id="crn" rotulo="CRN" required defaultValue={v.crn} erro={e.crn} dica="Ex.: CRN-3 12345" />
      <Campo id="slug" rotulo="Endereço" required defaultValue={v.slug} erro={e.slug} dica="Usado na página pública de agendamento: /n/endereço" />
      {e.geral && <p role="alert" className="text-red-700">{e.geral}</p>}
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Criar conta</button>
    </form>
  );
}
```

`src/app/admin/contas/nova/page.tsx`

```tsx
import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { NovaContaForm } from './form';

export const dynamic = 'force-dynamic';

export default async function NovaContaPage() {
  await requireUser(['admin'], '/admin/contas/nova');
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <Link href="/admin" className="text-sm underline">Voltar</Link>
      <h1 className="text-2xl font-semibold">Nova conta de nutricionista</h1>
      <p className="text-sm">A nutricionista recebe por e-mail um convite válido por 72 horas para definir a senha e aceitar o contrato de tratamento de dados.</p>
      <NovaContaForm />
    </main>
  );
}
```

`src/app/admin/page.tsx` inteiro:

```tsx
import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { listarContas, MSG, type ContaResumo } from '@/modules/plataforma/contas';
import { reenviarConviteAction } from './actions';

export const dynamic = 'force-dynamic';

const AVISOS: Record<string, { texto: string; erro?: boolean }> = {
  criada: { texto: 'Conta criada. O convite foi enviado para o e-mail da nutricionista.' },
  reenviado: { texto: 'Convite reenviado.' },
  ja_tem_senha: { texto: MSG.jaTemSenha, erro: true },
};

const data = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);

function Convite({ c }: { c: ContaResumo }) {
  if (c.convite === 'aceito') return <>Aceito</>;
  if (c.convite === 'pendente') return <>{`Pendente (até ${data(c.conviteExpiraEm!)})`}</>;
  if (c.convite === 'expirado') return <>Expirado</>;
  return <>Sem convite</>;
}

export default async function AdminHome({ searchParams }: PageProps<'/admin'>) {
  const { user } = await requireUser(['admin'], '/admin');
  const { aviso } = await searchParams;
  const a = typeof aviso === 'string' ? AVISOS[aviso] : undefined;
  const contas = await listarContas();
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Administração</h1>
          <p className="text-sm">Conectado como {user.email}.</p>
        </div>
        <Link href="/admin/contas/nova" className="rounded bg-emerald-700 px-4 py-2 text-white">Nova conta</Link>
      </header>
      {a && (
        <p role={a.erro ? 'alert' : 'status'} className={a.erro ? 'rounded bg-red-50 p-3 text-red-800' : 'rounded bg-emerald-50 p-3'}>
          {a.texto}
        </p>
      )}
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Contas de nutricionista</caption>
        <thead>
          <tr>
            <th scope="col">Conta</th>
            <th scope="col">E-mail</th>
            <th scope="col">CRN</th>
            <th scope="col">Situação</th>
            <th scope="col">Convite</th>
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {contas.map((c) => (
            <tr key={c.tenantId} className="border-t">
              <th scope="row" className="font-normal">{c.nomeExibicao} <span className="text-zinc-500">({c.slug})</span></th>
              <td>{c.email ?? '—'}</td>
              <td>{c.crn ?? '—'}</td>
              <td>{c.status === 'ativa' ? 'Ativa' : 'Suspensa'}</td>
              <td><Convite c={c} /></td>
              <td>
                {c.convite !== 'aceito' && c.email && (
                  <form action={reenviarConviteAction.bind(null, c.tenantId)}>
                    <button className="underline">Reenviar convite</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 8: `CLAUDE.md`** — na regra 1, trocar a lista de quem pode acessar a tabela `user` fora de `withTenant` por: "…só pelos internos do Better Auth (`src/lib/auth.ts`), pelos services de `src/modules/plataforma/` (bootstrap de admin, contas, convites, suspensão, histórico de acessos) e pelo seed do E2E (`scripts/e2e-seed.ts`). As tabelas sem `tenant_id` do M1 (`tenants`, `invites`, `consents`, `backup_runs`) seguem a mesma regra."

- [ ] **Step 9: Rodar e verificar a tela**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS.

Manual (dev, com `pnpm dev`, `pnpm worker`, admin de dev com 2FA): abrir `http://localhost:3100/admin/contas/nova`, criar uma conta, ver "Conta criada. O convite foi enviado para o e-mail da nutricionista.", a linha com "Pendente (até …)" e o e-mail "Seu acesso ao NutriDebby" no Mailpit (`http://localhost:8025`). Tentar o mesmo endereço de novo → "Endereço já em uso" ao lado do campo.

- [ ] **Step 10: Commit**

```bash
git add drizzle src/db src/lib/validacao.ts src/components/campo.tsx src/modules/plataforma src/app/admin CLAUDE.md
git commit -m "feat(admin): criar conta de nutricionista com convite de 72 h em hash, reenviar convite e lista de contas"
```

---

### Task 6: Primeiro acesso pelo convite + aceite do DPA (P02-04)

**Files:**
- Create: `drizzle/0009_consents.sql` (gerada), `src/modules/plataforma/dpa.ts`, `src/modules/plataforma/primeiro-acesso.test.ts`, `src/lib/request-ip.ts`, `src/lib/tenant-session.ts`, `src/lib/tenant-session.test.ts`, `test/sessao.ts`, `src/app/convite/[token]/page.tsx`, `src/app/convite/[token]/form.tsx`, `src/app/convite/[token]/actions.ts`, `src/app/painel/cabecalho.tsx`, `src/app/painel/actions.ts`, `src/app/painel/dpa/page.tsx`, `src/app/painel/dpa/form.tsx`, `e2e/helpers.ts`, `e2e/plataforma.spec.ts`
- Modify: `src/db/schema/access.ts` (`consents`), `src/modules/plataforma/convites.ts` (`aceitarConvite`), `src/app/painel/page.tsx`, `scripts/e2e-seed.ts`

**Interfaces:**
- Consumes: `inspecionarConvite`, `CONVITE_EXPIRADO`, `CONVITE_INVALIDO` (Tarefa 5); `validatePasswordPolicy`, `commonPasswords`, `hashPassword` (Plano 01); `clientIp` (Tarefa 1); `requireUser`, `SessionData` (Plano 01); `getAuth().api.signInEmail` (Better Auth + `nextCookies`).
- Produces:
  - Schema: `consents` (`userId`, `termoVersao`, `aceitoEm`, `ip`; UNIQUE (`user_id`, `termo_versao`)).
  - `@/modules/plataforma/dpa`: `DPA_VERSAO = '0.1-provisorio'`, `DPA_TERMO = 'dpa-0.1-provisorio'`, `DPA_TITULO`, `DPA_PARAGRAFOS: readonly string[]`, `registrarAceiteDpa(q: Queryable, a: { userId; tenantId; ip: string | null; now?: Date }): Promise<void>`.
  - `@/modules/plataforma/convites`: `class ConviteError`, `aceitarConvite(input: { token; senha; confirmacao; aceitouDpa: boolean; ip: string | null }, deps?: { db?: Db; now?: Date }): Promise<{ email: string }>`.
  - `@/lib/request-ip`: `requestIp(): Promise<string | null>` (server-only).
  - `@/lib/tenant-session`: `DPA_PATH = '/painel/dpa'`, `type NutriAccess = { data: SessionData; tenant: TenantRow; ctx: TenantContext }`, `requireNutri(path: string, opts?: { permitirDpaPendente?: boolean }): Promise<NutriAccess>` — **toda página e Server Action da nutricionista usa isto** (o `ctx` já leva `actorUserId` e `ip` para a auditoria).
  - `test/sessao.ts`: `SENHA_TESTE`, `criarEEntrar(db, auth, { appRole, tenantId?, twoFactorEnabled? }): Promise<{ id; email; cookie }>`, `entrar(auth, email, senha?, ip?): Promise<string>` (cookie).
  - `e2e/helpers.ts`: `entrarComoAdmin(browser, cred, ip): Promise<Page>`, `entrarComo(browser, email, senha, ip): Promise<Page>`.
  - `scripts/e2e-seed.ts`: tenant `e2e-consultorio` com DPA aceito, ligado a `E2E_NUTRI` e `E2E_RECUPERA`; `E2E_ADMIN_PLATAFORMA`.

- [ ] **Step 1: Schema** — em `src/db/schema/access.ts`, trocar o import por `import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';` e acrescentar:

```ts
/** Aceites versionados (DPA da nutricionista agora; termo do paciente no Plano 03). Sem cascade: é prova de aceite. */
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id),
    termoVersao: text('termo_versao').notNull(),
    aceitoEm: timestamp('aceito_em', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
  },
  (t) => [unique('consents_user_termo_unique').on(t.userId, t.termoVersao)],
);
```

Run: `pnpm db:generate --name consents`
Expected: `drizzle/0009_consents.sql` com `CREATE TABLE "consents"`, a UNIQUE `consents_user_termo_unique` e a FK para `"user"` sem cascade.

- [ ] **Step 2: DPA** — `src/modules/plataforma/dpa.ts`

```ts
import { eq } from 'drizzle-orm';
import type { Queryable } from '@/db/client';
import { consents, tenants } from '@/db/schema';

/** Texto provisório até o P08-06 (P-02/E-09). Mudar a versão obriga novo aceite (requireNutri). */
export const DPA_VERSAO = '0.1-provisorio';
export const DPA_TERMO = `dpa-${DPA_VERSAO}`;
export const DPA_TITULO = 'Contrato de tratamento de dados (DPA)';

export const DPA_PARAGRAFOS: readonly string[] = [
  'Este contrato regula o tratamento de dados pessoais feito pela plataforma NutriDebby (operadora) em nome da nutricionista titular da conta (controladora), nos termos da Lei 13.709/2018 (LGPD).',
  'A operadora trata os dados dos pacientes somente para prestar o serviço contratado — prontuário, plano alimentar, agenda, lembretes e portal do paciente — e segundo as instruções da controladora. Nenhum dado é vendido, compartilhado para publicidade ou usado para outra finalidade.',
  'A controladora é responsável pela base legal do tratamento, pelo consentimento dos pacientes quando exigido e pelo atendimento aos direitos dos titulares. A operadora oferece as ferramentas para isso: exportação, bloqueio e registro de acessos.',
  'Medidas de segurança: dados isolados por conta, senhas guardadas com hash forte, verificação em duas etapas, registro de acessos a dados de saúde, backups diários criptografados e comunicação por HTTPS.',
  'Suboperadores: Hostinger (servidor), Cloudflare (armazenamento do backup criptografado e proteção anti-robô), Resend (envio de e-mails) e Meta (mensagens de WhatsApp, quando ativadas pela controladora).',
  'Incidentes de segurança que afetem dados da controladora serão comunicados a ela sem demora injustificada, com as informações disponíveis para que ela avalie a comunicação à ANPD e aos titulares.',
  'Ao fim do contrato, a controladora pode exportar os dados. Depois disso, a operadora os elimina, salvo o que a lei obrigar a guardar.',
  'Versão provisória 0.1, em revisão jurídica. Quando a versão definitiva for publicada, um novo aceite será pedido.',
];

/** Registro do aceite (quem, versão, quando, IP) + marca no tenant (US-002: tenants.dpa_aceito_em). */
export async function registrarAceiteDpa(
  q: Queryable,
  a: { userId: string; tenantId: string; ip: string | null; now?: Date },
): Promise<void> {
  const now = a.now ?? new Date();
  await q.insert(consents).values({ userId: a.userId, termoVersao: DPA_TERMO, aceitoEm: now, ip: a.ip }).onConflictDoNothing();
  await q.update(tenants).set({ dpaAceitoEm: now, dpaVersao: DPA_VERSAO, updatedAt: now }).where(eq(tenants.id, a.tenantId));
}
```

- [ ] **Step 3: Testes que falham do primeiro acesso** — `src/modules/plataforma/primeiro-acesso.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { account, consents, tenants, user } from '@/db/schema';
import { stopBoss } from '@/jobs/boss';
import { verifyPassword } from '@/lib/password.server';
import { ContaError, criarContaNutri } from './contas';
import { aceitarConvite, ConviteError, criarConvite } from './convites';
import { DPA_TERMO, DPA_VERSAO } from './dpa';

const app = makeDb(inject('appDatabaseUrl'));
const now = new Date('2026-10-01T12:00:00Z');
afterAll(async () => {
  await stopBoss();
  await app.pool.end();
});

/** Conta nova + token em claro (gera um convite próprio, sem depender do e-mail). */
async function contaComConvite() {
  const x = randomUUID().slice(0, 8);
  const r = await criarContaNutri({ nomeExibicao: 'Debby Silva', email: `pa-${x}@exemplo.com`, crn: 'CRN-3 12345', slug: `pa-${x}` }, { db: app.db, appUrl: 'http://localhost:3000', now });
  const { token } = await criarConvite(app.db, r.userId, now);
  return { ...r, token, email: `pa-${x}@exemplo.com` };
}
const aceite = (token: string, extra: Partial<Parameters<typeof aceitarConvite>[0]> = {}) =>
  aceitarConvite({ token, senha: 'Nutri2026segura', confirmacao: 'Nutri2026segura', aceitouDpa: true, ip: '203.0.113.7', ...extra }, { db: app.db, now });

describe('aceitarConvite (US-002 "Primeiro acesso da nutricionista pelo convite")', () => {
  it('define a senha em argon2id, registra o DPA (versão, data e IP) e preenche tenants.dpa_aceito_em', async () => {
    const c = await contaComConvite();
    expect(await aceite(c.token)).toEqual({ email: c.email });
    const [acc] = await app.db.select().from(account).where(and(eq(account.userId, c.userId), eq(account.providerId, 'credential')));
    expect(await verifyPassword(acc.password!, 'Nutri2026segura')).toBe(true);
    const [t] = await app.db.select().from(tenants).where(eq(tenants.id, c.tenantId));
    expect(t.dpaAceitoEm?.toISOString()).toBe(now.toISOString());
    expect(t.dpaVersao).toBe(DPA_VERSAO);
    const [cons] = await app.db.select().from(consents).where(eq(consents.userId, c.userId));
    expect(cons).toMatchObject({ termoVersao: DPA_TERMO, ip: '203.0.113.7' });
    const [u] = await app.db.select().from(user).where(eq(user.id, c.userId));
    expect(u.emailVerified).toBe(true);
  });

  it('sem aceitar o DPA, com senha fraca ou senhas diferentes: nada é gravado e o convite continua valendo', async () => {
    const c = await contaComConvite();
    await expect(aceite(c.token, { aceitouDpa: false })).rejects.toThrow('Para continuar, aceite o contrato de tratamento de dados (DPA).');
    await expect(aceite(c.token, { senha: 'curta1', confirmacao: 'curta1' })).rejects.toThrow('A senha precisa ter pelo menos 10 caracteres.');
    await expect(aceite(c.token, { confirmacao: 'Outra2026senha' })).rejects.toThrow('As senhas não conferem.');
    expect(await app.db.select().from(account).where(eq(account.userId, c.userId))).toEqual([]);
    await expect(aceite(c.token)).resolves.toEqual({ email: c.email });
  });

  it('convite expirado: "Convite expirado. Peça um novo ao suporte."', async () => {
    const c = await contaComConvite();
    await expect(
      aceitarConvite({ token: c.token, senha: 'Nutri2026segura', confirmacao: 'Nutri2026segura', aceitouDpa: true, ip: null }, { db: app.db, now: new Date('2026-10-04T12:00:01Z') }),
    ).rejects.toThrow('Convite expirado. Peça um novo ao suporte.');
  });

  it('o mesmo convite enviado duas vezes ao mesmo tempo grava uma única senha (Review Focus 2)', async () => {
    const c = await contaComConvite();
    const r = await Promise.allSettled([aceite(c.token), aceite(c.token), aceite(c.token)]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const f of r.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(f.reason).toBeInstanceOf(ConviteError);
      expect((f.reason as Error).message).toMatch(/^Convite inválido ou já usado/);
    }
    expect(await app.db.select().from(account).where(eq(account.userId, c.userId))).toHaveLength(1);
  });

  it('depois de aceito, reenviar o convite é recusado (ContaError)', async () => {
    const { reenviarConvite } = await import('./contas');
    const c = await contaComConvite();
    await aceite(c.token);
    await expect(reenviarConvite(c.tenantId, { db: app.db, appUrl: 'http://localhost:3000', now })).rejects.toBeInstanceOf(ContaError);
  });
});
```

Run: `pnpm test src/modules/plataforma/primeiro-acesso.test.ts` → FAIL (`aceitarConvite` não existe).

- [ ] **Step 4: Implementar** — em `src/modules/plataforma/convites.ts`, acrescentar os imports e a função:

```ts
import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getDb, type Db, type Queryable } from '@/db/client';
import { account, invites, user } from '@/db/schema';
import { randomToken, sha256 } from '@/lib/crypto';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { commonPasswords, hashPassword } from '@/lib/password.server';
import { registrarAceiteDpa } from './dpa';
```

```ts
export class ConviteError extends Error {
  override name = 'ConviteError';
}

/**
 * US-002: consome o convite (uma única vez, mesmo com envios simultâneos), grava a senha,
 * marca o e-mail como verificado e registra o aceite do DPA — tudo numa transação.
 */
export async function aceitarConvite(
  input: { token: string; senha: string; confirmacao: string; aceitouDpa: boolean; ip: string | null },
  deps: { db?: Db; now?: Date } = {},
): Promise<{ email: string }> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  if (!input.aceitouDpa) throw new ConviteError('Para continuar, aceite o contrato de tratamento de dados (DPA).');
  const politica = validatePasswordPolicy(input.senha, commonPasswords());
  if (politica) throw new ConviteError(politica);
  if (input.senha !== input.confirmacao) throw new ConviteError('As senhas não conferem.');
  if (!TOKEN.test(input.token)) throw new ConviteError(CONVITE_INVALIDO);
  const hash = await hashPassword(input.senha);

  return db.transaction(async (tx) => {
    // UPDATE … WHERE usado_em IS NULL trava a linha: o segundo envio simultâneo vê 0 linhas
    const [c] = await tx
      .update(invites)
      .set({ usadoEm: now })
      .where(and(eq(invites.tokenHash, sha256(input.token)), isNull(invites.usadoEm), gt(invites.expiraEm, now)))
      .returning({ userId: invites.userId });
    if (!c) {
      const estado = await inspecionarConvite(tx, input.token, now);
      throw new ConviteError(estado.estado === 'expirado' ? CONVITE_EXPIRADO : CONVITE_INVALIDO);
    }
    const [u] = await tx.select({ email: user.email, tenantId: user.tenantId }).from(user).where(eq(user.id, c.userId));
    const jaTemSenha = await tx
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, c.userId), eq(account.providerId, 'credential')));
    if (!u?.tenantId || jaTemSenha.length) throw new ConviteError(CONVITE_INVALIDO);
    await tx.insert(account).values({ id: randomUUID(), userId: c.userId, accountId: c.userId, providerId: 'credential', password: hash });
    await tx.update(user).set({ emailVerified: true }).where(eq(user.id, c.userId));
    await registrarAceiteDpa(tx, { userId: c.userId, tenantId: u.tenantId, ip: input.ip, now });
    return { email: u.email };
  });
}
```

Run: `pnpm test src/modules/plataforma/primeiro-acesso.test.ts` → PASS (5 testes).

- [ ] **Step 5: Helper de sessão para testes** — `test/sessao.ts`

```ts
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { account, user } from '@/db/schema';
import type { Auth } from '@/lib/auth';
import { hashPassword } from '@/lib/password.server';

export const SENHA_TESTE = 'Nutri2026segura';

/** Login pelo handler real do Better Auth; devolve o cookie `nd.session_token=…`. */
export async function entrar(auth: Auth, email: string, senha = SENHA_TESTE, ip = `10.3.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`): Promise<string> {
  const res = await auth.handler(
    new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': ip },
      body: JSON.stringify({ email, password: senha }),
    }),
  );
  if (res.status !== 200) throw Object.assign(new Error(`login falhou: HTTP ${res.status}`), { status: res.status, body: await res.text() });
  return res.headers.get('set-cookie')!.match(/nd\.session_token=[^;]+/)![0];
}

/** Cria usuário com senha e entra. `twoFactorEnabled` é ligado depois do login (o admin passa em evaluateSession). */
export async function criarEEntrar(
  db: Db,
  auth: Auth,
  opts: { appRole: 'admin' | 'nutri' | 'paciente'; tenantId?: string; twoFactorEnabled?: boolean },
): Promise<{ id: string; email: string; cookie: string }> {
  const id = randomUUID();
  const email = `${opts.appRole}-${id.slice(0, 8)}@teste.dev`;
  await db.insert(user).values({ id, name: `Teste ${opts.appRole}`, email, emailVerified: true, appRole: opts.appRole, tenantId: opts.tenantId ?? null });
  await db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(SENHA_TESTE) });
  const cookie = await entrar(auth, email);
  if (opts.twoFactorEnabled) await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, id));
  return { id, email, cookie };
}
```

- [ ] **Step 6: Testes que falham do `requireNutri`** — `src/lib/tenant-session.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { criarEEntrar } from '../../test/sessao';
import { getAuth } from './auth';

const req = vi.hoisted(() => ({ headers: new Headers() }));
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { requireNutri } = await import('./tenant-session');
const { registrarAceiteDpa } = await import('@/modules/plataforma/dpa');

const db = getDb();
afterAll(() => closeDb());
beforeEach(() => {
  req.headers = new Headers();
});

async function nutriComTenant() {
  const [t] = await db.insert(tenants).values({ slug: `rn-${randomUUID().slice(0, 8)}`, nomeExibicao: 'RN' }).returning();
  const n = await criarEEntrar(db, getAuth(), { appRole: 'nutri', tenantId: t.id });
  req.headers = new Headers({ cookie: n.cookie, 'x-forwarded-for': '203.0.113.20' });
  return { tenant: t, nutri: n };
}

describe('requireNutri', () => {
  it('sem DPA aceito leva para /painel/dpa', async () => {
    await nutriComTenant();
    await expect(requireNutri('/painel')).rejects.toMatchObject({ url: '/painel/dpa' });
  });

  it('com permitirDpaPendente devolve o contexto do tenant com ator e IP', async () => {
    const { tenant, nutri } = await nutriComTenant();
    const r = await requireNutri('/painel/dpa', { permitirDpaPendente: true });
    expect(r.tenant.id).toBe(tenant.id);
    expect(r.ctx).toEqual({ tenantId: tenant.id, role: 'nutri', actorUserId: nutri.id, ip: '203.0.113.20' });
  });

  it('com o DPA da versão atual aceito, entra; versão antiga pede novo aceite', async () => {
    const { tenant, nutri } = await nutriComTenant();
    await registrarAceiteDpa(db, { userId: nutri.id, tenantId: tenant.id, ip: null });
    await expect(requireNutri('/painel')).resolves.toMatchObject({ tenant: { id: tenant.id } });
    await db.update(tenants).set({ dpaVersao: '0.0-antiga' }).where(eq(tenants.id, tenant.id));
    await expect(requireNutri('/painel')).rejects.toMatchObject({ url: '/painel/dpa' });
  });
});
```

Run: `pnpm test src/lib/tenant-session.test.ts` → FAIL.

- [ ] **Step 7: Implementar** — `src/lib/request-ip.ts`

```ts
import 'server-only';
import { headers } from 'next/headers';
import { getEnv } from '@/env';
import { clientIp } from './ip';

/** IP de quem fez a requisição atual (Server Components e Server Actions). */
export async function requestIp(): Promise<string | null> {
  return clientIp(await headers(), getEnv().TRUSTED_PROXIES);
}
```

`src/lib/tenant-session.ts`

```ts
import 'server-only';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { requestIp } from './request-ip';
import { requireUser, type SessionData } from './session';

export const DPA_PATH = '/painel/dpa';

export type NutriAccess = { data: SessionData; tenant: TenantRow; ctx: TenantContext };

/**
 * Entrada de toda página e Server Action da nutricionista: sessão válida (requireUser),
 * DPA da versão atual aceito e o contexto do tenant pronto para withTenant (com ator e IP).
 */
export async function requireNutri(path: string, opts: { permitirDpaPendente?: boolean } = {}): Promise<NutriAccess> {
  const data = await requireUser(['nutri'], path);
  const tenantId = data.user.tenantId;
  if (!tenantId) throw new Error('Conta de nutricionista sem tenant');
  const [tenant] = await getDb().select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant) throw new Error('Tenant da nutricionista não encontrado');
  if (!opts.permitirDpaPendente && tenant.dpaVersao !== DPA_VERSAO) redirect(DPA_PATH);
  return { data, tenant, ctx: { tenantId, role: 'nutri', actorUserId: data.user.id, ip: await requestIp() } };
}
```

Run: `pnpm test src/lib/tenant-session.test.ts` → PASS (3 testes).

- [ ] **Step 8: Tela do convite** — `src/app/convite/[token]/actions.ts`

```ts
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth';
import { requestIp } from '@/lib/request-ip';
import { aceitarConvite, ConviteError } from '@/modules/plataforma/convites';

export type AceiteState = { erro?: string };

export async function aceitarConviteAction(token: string, _prev: AceiteState, formData: FormData): Promise<AceiteState> {
  const senha = String(formData.get('senha') ?? '');
  let email: string;
  try {
    ({ email } = await aceitarConvite({
      token,
      senha,
      confirmacao: String(formData.get('confirmacao') ?? ''),
      aceitouDpa: formData.get('dpa') === 'on',
      ip: await requestIp(),
    }));
  } catch (e) {
    if (e instanceof ConviteError) return { erro: e.message };
    throw e;
  }
  let entrou = true;
  try {
    // nextCookies grava o cookie de sessão na resposta desta Server Action
    await getAuth().api.signInEmail({ body: { email, password: senha }, headers: await headers() });
  } catch {
    entrou = false;
  }
  redirect(entrou ? '/painel' : '/entrar?volta=%2Fpainel');
}
```

`src/app/convite/[token]/form.tsx`

```tsx
'use client';

import { useActionState, useState } from 'react';
import { aceitarConviteAction, type AceiteState } from './actions';

export function ConviteForm({ token }: { token: string }) {
  const [state, action, pendente] = useActionState<AceiteState, FormData>(aceitarConviteAction.bind(null, token), {});
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  return (
    <form action={action} className="space-y-3">
      <p className="text-sm" id="regra-senha">Mínimo de 10 caracteres, com pelo menos 1 letra e 1 número.</p>
      <label htmlFor="senha" className="block">Nova senha</label>
      <input id="senha" name="senha" type="password" autoComplete="new-password" required aria-describedby="regra-senha" value={senha} onChange={(e) => setSenha(e.target.value)} className="w-full rounded border p-2" />
      <label htmlFor="confirmacao" className="block">Repita a senha</label>
      <input id="confirmacao" name="confirmacao" type="password" autoComplete="new-password" required value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} className="w-full rounded border p-2" />
      <div className="flex items-start gap-2">
        <input id="dpa" name="dpa" type="checkbox" className="mt-1" />
        <label htmlFor="dpa">Li e aceito o contrato de tratamento de dados (DPA)</label>
      </div>
      {state.erro && <p role="alert" className="text-red-700">{state.erro}</p>}
      <button disabled={pendente} className="w-full rounded bg-emerald-700 px-4 py-2 text-white">Criar senha e entrar</button>
    </form>
  );
}
```

`src/app/convite/[token]/page.tsx`

```tsx
import type { Metadata } from 'next';
import { getDb } from '@/db/client';
import { CONVITE_EXPIRADO, CONVITE_INVALIDO, inspecionarConvite } from '@/modules/plataforma/convites';
import { DPA_PARAGRAFOS, DPA_TITULO } from '@/modules/plataforma/dpa';
import { ConviteForm } from './form';

export const dynamic = 'force-dynamic';
// O token está na URL: nunca mandá-lo como Referer para outro site
export const metadata: Metadata = { title: 'Primeiro acesso', referrer: 'no-referrer' };

export default async function ConvitePage({ params }: PageProps<'/convite/[token]'>) {
  const { token } = await params;
  const estado = await inspecionarConvite(getDb(), token);
  if (estado.estado !== 'valido') {
    return (
      <main className="mx-auto max-w-lg space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Primeiro acesso</h1>
        <p role="alert">{estado.estado === 'expirado' ? CONVITE_EXPIRADO : CONVITE_INVALIDO}</p>
        <a href="/entrar" className="underline">Ir para o login</a>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Bem-vinda ao NutriDebby</h1>
      <p>{`Defina a senha de ${estado.email} e aceite o contrato para entrar.`}</p>
      <section aria-labelledby="dpa-titulo" tabIndex={0} className="max-h-64 space-y-2 overflow-y-auto rounded border p-3 text-sm">
        <h2 id="dpa-titulo" className="font-semibold">{DPA_TITULO}</h2>
        {DPA_PARAGRAFOS.map((p) => <p key={p}>{p}</p>)}
      </section>
      <ConviteForm token={token} />
    </main>
  );
}
```

- [ ] **Step 9: Painel exige DPA; tela de novo aceite** — `src/app/painel/cabecalho.tsx`

```tsx
import Link from 'next/link';
import type { TenantRow } from '@/db/schema';

/** Cabeçalho do painel (a Tarefa 10 aplica logo e cor da marca). */
export function Cabecalho({ tenant }: { tenant: TenantRow }) {
  return (
    <header className="flex items-center justify-between bg-emerald-700 px-6 py-3 text-white">
      <p className="text-lg font-semibold">{tenant.nomeExibicao}</p>
      <nav aria-label="Menu do painel" className="flex gap-4 text-sm">
        <Link href="/painel">Início</Link>
        <Link href="/conta/seguranca">Segurança</Link>
      </nav>
    </header>
  );
}
```

`src/app/painel/page.tsx` inteiro:

```tsx
import { requireNutri } from '@/lib/tenant-session';
import { Cabecalho } from './cabecalho';

export const dynamic = 'force-dynamic';

export default async function PainelHome() {
  const { data, tenant } = await requireNutri('/painel');
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="p-6">
        <h1 className="text-2xl font-semibold">Painel da nutricionista</h1>
        <p>Conectado como {data.user.email}.</p>
      </main>
    </>
  );
}
```

`src/app/painel/actions.ts`

```ts
'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { DPA_PATH, requireNutri } from '@/lib/tenant-session';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';

export type DpaState = { erro?: string };

export async function aceitarDpaAction(_prev: DpaState, formData: FormData): Promise<DpaState> {
  const { data, tenant, ctx } = await requireNutri(DPA_PATH, { permitirDpaPendente: true });
  if (formData.get('dpa') !== 'on') return { erro: 'Para continuar, aceite o contrato de tratamento de dados (DPA).' };
  await getDb().transaction((tx) => registrarAceiteDpa(tx, { userId: data.user.id, tenantId: tenant.id, ip: ctx.ip ?? null }));
  redirect('/painel');
}
```

`src/app/painel/dpa/form.tsx`

```tsx
'use client';

import { useActionState } from 'react';
import { aceitarDpaAction, type DpaState } from '../actions';

export function DpaForm() {
  const [state, action, pendente] = useActionState<DpaState, FormData>(aceitarDpaAction, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex items-start gap-2">
        <input id="dpa" name="dpa" type="checkbox" className="mt-1" />
        <label htmlFor="dpa">Li e aceito o contrato de tratamento de dados (DPA)</label>
      </div>
      {state.erro && <p role="alert" className="text-red-700">{state.erro}</p>}
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Aceitar e continuar</button>
    </form>
  );
}
```

`src/app/painel/dpa/page.tsx`

```tsx
import { DPA_PATH, requireNutri } from '@/lib/tenant-session';
import { DPA_PARAGRAFOS, DPA_TITULO, DPA_VERSAO } from '@/modules/plataforma/dpa';
import { DpaForm } from './form';

export const dynamic = 'force-dynamic';

export default async function DpaPage() {
  const { tenant } = await requireNutri(DPA_PATH, { permitirDpaPendente: true });
  const atual = tenant.dpaVersao === DPA_VERSAO;
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{DPA_TITULO}</h1>
      <section aria-label={DPA_TITULO} tabIndex={0} className="max-h-96 space-y-2 overflow-y-auto rounded border p-3 text-sm">
        {DPA_PARAGRAFOS.map((p) => <p key={p}>{p}</p>)}
      </section>
      {atual ? <p role="status">Você já aceitou esta versão do contrato.</p> : <DpaForm />}
    </main>
  );
}
```

- [ ] **Step 10: Seed do E2E** — em `scripts/e2e-seed.ts`, acrescentar aos imports `import { tenants } from '@/db/schema';` e `import { DPA_VERSAO } from '@/modules/plataforma/dpa';`, a constante `export const E2E_ADMIN_PLATAFORMA = { email: 'admin-plataforma-e2e@nutridebby.test', password: 'Nutri2026segura' };`, e logo depois de `const db = getDb();`:

```ts
// Consultório das nutricionistas do E2E, já com o DPA aceito (US-002)
const [consultorio] = await db
  .insert(tenants)
  .values({ slug: 'e2e-consultorio', nomeExibicao: 'Consultório E2E', crn: 'CRN-3 12345', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date() })
  .onConflictDoUpdate({
    target: tenants.slug,
    set: { status: 'ativa', dpaVersao: DPA_VERSAO, dpaAceitoEm: new Date(), corPrimaria: null, logoPath: null, armazenamentoBytes: 0 },
  })
  .returning({ id: tenants.id });
```

Nos `insert(user)` de `E2E_NUTRI` e `E2E_RECUPERA`, acrescentar `tenantId: consultorio.id`. E, antes de `await closeDb();`, o segundo admin (usado só pelo `plataforma.spec.ts`):

```ts
await db.delete(user).where(eq(user.email, E2E_ADMIN_PLATAFORMA.email));
const admin2Id = randomUUID();
await db.insert(user).values({ id: admin2Id, name: 'Admin Plataforma E2E', email: E2E_ADMIN_PLATAFORMA.email, emailVerified: true, appRole: 'admin' });
await db.insert(account).values({ id: randomUUID(), userId: admin2Id, accountId: admin2Id, providerId: 'credential', password: await hashPassword(E2E_ADMIN_PLATAFORMA.password) });
```

- [ ] **Step 11: E2E** — `e2e/helpers.ts`

```ts
import { expect, type Browser, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';

const segredos = new Map<string, string>();

export async function entrarComo(browser: Browser, email: string, senha: string, ip: string): Promise<Page> {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': ip } });
  const page = await ctx.newPage();
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  return page;
}

/** Admin da execução: no primeiro login ativa o 2FA obrigatório (US-003) e guarda o segredo. */
export async function entrarComoAdmin(browser: Browser, cred: { email: string; password: string }, ip: string): Promise<Page> {
  const page = await entrarComo(browser, cred.email, cred.password, ip);
  const segredo = segredos.get(cred.email);
  if (segredo) {
    await expect(page).toHaveURL(/\/entrar\/2fa/);
    await page.getByLabel('Código do app autenticador').fill(new TOTP({ secret: segredo }).generate());
    await page.getByRole('button', { name: 'Verificar' }).click();
  } else {
    await expect(page).toHaveURL(/\/conta\/seguranca/);
    await page.getByLabel('Confirme sua senha').fill(cred.password);
    await page.getByRole('button', { name: 'Ativar verificação em duas etapas' }).click();
    const novo = (await page.getByTestId('totp-secret').textContent())!.trim();
    segredos.set(cred.email, novo);
    await page.getByLabel('Código de 6 dígitos').fill(new TOTP({ secret: novo }).generate());
    await page.getByRole('button', { name: 'Confirmar' }).click();
    await page.getByRole('link', { name: 'Continuar' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible();
  return page;
}
```

`e2e/plataforma.spec.ts`

```ts
import { expect, test, type Page } from '@playwright/test';
import { entrarComoAdmin } from './helpers';
import { esperarEmail, primeiroLink } from './mailpit';

const ADMIN = { email: 'admin-plataforma-e2e@nutridebby.test', password: 'Nutri2026segura' };
test.describe.configure({ mode: 'serial' });

const sufixo = Date.now().toString(36);
const NUTRI = { nome: 'Debby Silva', email: `debby-${sufixo}@nutridebby.test`, slug: `debby-${sufixo}`, senha: `Debby${sufixo}2026` };
let admin: Page;

test.beforeAll(async ({ browser }) => {
  admin = await entrarComoAdmin(browser, ADMIN, '10.9.3.1');
});
test.afterAll(async () => {
  await admin?.context().close();
});

test('admin cria a conta; e-mail com maiúsculas e espaços é aceito; endereço repetido é recusado (US-001)', async () => {
  await admin.goto('/admin/contas/nova');
  await admin.getByLabel('Nome de exibição').fill(NUTRI.nome);
  await admin.getByLabel('E-mail').fill(`  ${NUTRI.email.toUpperCase()} `);
  await admin.getByLabel('CRN').fill('CRN-3 12345');
  await admin.getByLabel('Endereço', { exact: true }).fill(NUTRI.slug);
  await admin.getByRole('button', { name: 'Criar conta' }).click();
  await expect(admin.getByRole('status')).toHaveText('Conta criada. O convite foi enviado para o e-mail da nutricionista.');
  await expect(admin.getByRole('row', { name: new RegExp(NUTRI.slug) })).toContainText('Pendente');

  await admin.goto('/admin/contas/nova');
  await admin.getByLabel('Nome de exibição').fill('Outra Pessoa');
  await admin.getByLabel('E-mail').fill(`outra-${sufixo}@nutridebby.test`);
  await admin.getByLabel('CRN').fill('CRN-3 12345');
  await admin.getByLabel('Endereço', { exact: true }).fill(NUTRI.slug);
  await admin.getByRole('button', { name: 'Criar conta' }).click();
  await expect(admin.getByText('Endereço já em uso')).toBeVisible();
});

test('a nutricionista define a senha, aceita o DPA e chega ao painel; o link não vale de novo (US-002)', async ({ browser }) => {
  const email = await esperarEmail(NUTRI.email, { assunto: 'Seu acesso ao NutriDebby' });
  const link = primeiroLink(email.texto, '/convite/');
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.3.2' } });
  const page = await ctx.newPage();
  await page.goto(link);
  await page.getByLabel('Nova senha').fill(NUTRI.senha);
  await page.getByLabel('Repita a senha').fill(NUTRI.senha);
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Para continuar, aceite o contrato de tratamento de dados (DPA).');

  await page.getByLabel('Nova senha').fill(NUTRI.senha);
  await page.getByLabel('Repita a senha').fill(NUTRI.senha);
  await page.getByLabel('Li e aceito o contrato de tratamento de dados (DPA)').check();
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await expect(page.getByRole('heading', { name: 'Painel da nutricionista' })).toBeVisible();
  await expect(page.getByRole('banner')).toContainText(NUTRI.nome);

  await page.goto(link);
  await expect(page.getByRole('alert')).toContainText('Convite inválido ou já usado.');
  await ctx.close();
});
```

- [ ] **Step 12: Rodar tudo**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Run: `pnpm db:migrate && pnpm e2e:seed && APP_URL=http://localhost:3100 pnpm test:e2e`
Expected: PASS em tudo (inclusive o `auth.spec.ts`: `E2E_NUTRI` agora tem tenant e DPA e continua chegando a `/painel`).

- [ ] **Step 13: Commit**

```bash
git add drizzle src/db/schema/access.ts src/modules/plataforma src/lib/request-ip.ts src/lib/tenant-session.ts src/lib/tenant-session.test.ts \
  test/sessao.ts src/app/convite src/app/painel scripts/e2e-seed.ts e2e/helpers.ts e2e/plataforma.spec.ts
git commit -m "feat(onboarding): primeiro acesso pelo convite com aceite versionado do DPA e requireNutri"
```

---
### Task 7: Suspender e reativar conta + "Conta temporariamente indisponível" (P02-05)

**Files:**
- Create: `src/modules/plataforma/suspensao.ts`, `src/modules/plataforma/suspensao.test.ts`, `src/lib/api-auth.ts`, `src/lib/api-auth.test.ts`, `src/app/indisponivel/page.tsx`, `src/app/admin/confirmar-botao.tsx`
- Modify: `src/lib/session-rules.ts`, `src/lib/session-rules.test.ts`, `src/lib/session.ts`, `src/lib/session.test.ts`, `src/lib/auth.ts` (hook de criação de sessão), `src/lib/auth.test.ts`, `src/app/entrar/page.tsx`, `src/app/entrar/2fa/page.tsx`, `src/app/admin/actions.ts`, `src/app/admin/page.tsx`, `e2e/plataforma.spec.ts`

**Interfaces:**
- Consumes: `getTenantStatus(db, tenantId)` (Tarefa 2); `criarEEntrar`, `entrar` (`test/sessao.ts`, Tarefa 6); `session`, `user`, `tenants` (`@/db/schema`).
- Produces:
  - `@/lib/session-rules`: `SessionDecision` ganha `'suspended'`; `SUSPENDED_PATH = '/indisponivel'`; `evaluateSession({ …, tenantStatus?: 'ativa' | 'suspensa' | null })`.
  - `requireUser` redireciona conta suspensa para `/indisponivel` (vale para `requireNutri`).
  - Better Auth: criar sessão de usuária de tenant suspenso lança `APIError('FORBIDDEN', { code: 'CONTA_SUSPENSA', message: 'Conta temporariamente indisponível' })` (login, 2FA e primeiro acesso).
  - `@/lib/api-auth`: `type ApiAuth = { ok: true; data: SessionData } | { ok: false; response: Response }`, `requireApiUser(req: Request, allowed: readonly AppRole[]): Promise<ApiAuth>` — todo Route Handler de `/api/painel/*` e `/api/p/*` começa por ele.
  - `@/modules/plataforma/suspensao`: `suspenderConta(tenantId, adminId, db?): Promise<{ sessoesRevogadas: number }>`, `reativarConta(tenantId, adminId, db?): Promise<void>`.
  - Server Actions `suspenderAction(tenantId)`, `reativarAction(tenantId)`.

- [ ] **Step 1: Testes que falham da regra** — em `src/lib/session-rules.test.ts`, acrescentar:

```ts
  it('conta suspensa → suspended, mesmo com sessão válida (RN-15)', () => {
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: { updatedAt: recent }, user: { appRole: 'nutri' }, tenantStatus: 'suspensa' })).toBe('suspended');
  });
  it('conta ativa ou usuário sem tenant seguem a regra normal', () => {
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: { updatedAt: recent }, user: { appRole: 'nutri' }, tenantStatus: 'ativa' })).toBe('ok');
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: { updatedAt: recent }, user: { appRole: 'nutri' }, tenantStatus: null })).toBe('ok');
  });
  it('sessão ociosa de conta suspensa continua "expired" (a ociosidade vem antes)', () => {
    expect(evaluateSession({ now, path: '/painel', allowed: ['nutri'], session: { updatedAt: idle }, user: { appRole: 'nutri' }, tenantStatus: 'suspensa' })).toBe('expired');
  });
```

Run: `pnpm test src/lib/session-rules.test.ts` → FAIL.

- [ ] **Step 2: Implementar** — em `src/lib/session-rules.ts`:

```ts
export type SessionDecision = 'ok' | 'login' | 'expired' | 'setup-2fa' | 'forbidden' | 'suspended';
```

```ts
/** RN-15: tela mostrada a quem é de uma conta suspensa. */
export const SUSPENDED_PATH = '/indisponivel';
```

No `evaluateSession`, acrescentar `tenantStatus?: 'ativa' | 'suspensa' | null;` ao tipo do `input`, desestruturar `tenantStatus` e, logo depois da linha da inatividade da equipe (`if (staff && …) return 'expired';`):

```ts
  if (tenantStatus === 'suspensa') return 'suspended';
```

Run: `pnpm test src/lib/session-rules.test.ts` → PASS.

- [ ] **Step 3: Teste que falha do `requireUser`** — em `src/lib/session.test.ts`, acrescentar aos imports `tenants` (de `@/db/schema`) e `import { criarEEntrar } from '../../test/sessao';`, e o teste:

```ts
describe('conta suspensa (RN-15)', () => {
  it('sessão aberta de conta suspensa vai para /indisponivel (Review Focus 5)', async () => {
    const [t] = await db.insert(tenants).values({ slug: `susp-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Susp' }).returning();
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, t.id)); // sem revogar: simula a corrida
    expect(await redirectDe(requireComo(n.cookie, ['nutri'], '/painel'))).toBe('/indisponivel');
  });
});
```

Run: `pnpm test src/lib/session.test.ts` → FAIL (a página abre).

- [ ] **Step 4: Implementar** — em `src/lib/session.ts`, acrescentar os imports `import { getTenantStatus } from '@/modules/plataforma/tenant-status';` e `SUSPENDED_PATH` (de `./session-rules`), e trocar a chamada de `evaluateSession` por:

```ts
  const tenantId = (data?.user as { tenantId?: string | null } | undefined)?.tenantId;
  const decision = evaluateSession({
    session: data?.session ?? null,
    user: data?.user ?? null,
    allowed,
    now,
    path,
    hasSessionCookie: getSessionCookie(h, { cookiePrefix: 'nd' }) !== null,
    // RN-15: 1 leitura por PK; a suspensão vale na próxima requisição, mesmo com sessão aberta
    tenantStatus: tenantId ? await getTenantStatus(getDb(), tenantId) : null,
  });
```

E, no `switch`, antes do `default`:

```ts
    case 'suspended':
      redirect(SUSPENDED_PATH);
```

Run: `pnpm test src/lib/session.test.ts` → PASS.

- [ ] **Step 5: Teste que falha do login bloqueado** — em `src/lib/auth.test.ts`, acrescentar aos imports `tenants` e o teste:

```ts
  it('conta suspensa não abre sessão: HTTP 403 com CONTA_SUSPENSA (US-004, RN-15)', async () => {
    const [t] = await app.db.insert(tenants).values({ slug: `bloq-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Bloq', status: 'suspensa' }).returning();
    const id = randomUUID();
    const e = `bloq-${id.slice(0, 8)}@teste.dev`;
    await app.db.insert(user).values({ id, name: 'Nutri', email: e, emailVerified: true, appRole: 'nutri', tenantId: t.id });
    await app.db.insert(account).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(senha) });
    const res = await post('/sign-in/email', { email: e, password: senha }, '10.0.0.10');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'CONTA_SUSPENSA', message: 'Conta temporariamente indisponível' });
    expect(res.headers.get('set-cookie') ?? '').not.toMatch(/nd\.session_token=[^;]+;/);
  });
```

Run: `pnpm test src/lib/auth.test.ts` → FAIL (login devolve 200).

- [ ] **Step 6: Implementar** — em `src/lib/auth.ts`, importar `getTenantStatus` (`@/modules/plataforma/tenant-status`) e trocar o `before` de `databaseHooks.session.create` por:

```ts
          before: async (s, ctx) => {
            // Adapter do contexto do endpoint (respeita a transação em curso). Sem contexto ou
            // sem usuário, capSessionExpiry aplica o limite menor (12 h).
            const u = (await ctx?.context.internalAdapter.findUserById(s.userId)) as
              | { appRole?: string; tenantId?: string | null }
              | null
              | undefined;
            // RN-15: conta suspensa não abre sessão nova (login, 2FA, primeiro acesso)
            if (u?.tenantId && (await getTenantStatus(db, u.tenantId)) === 'suspensa') {
              throw new APIError('FORBIDDEN', { code: 'CONTA_SUSPENSA', message: 'Conta temporariamente indisponível' });
            }
            return { data: { ...s, expiresAt: capSessionExpiry(s.expiresAt, u?.appRole, new Date()) } };
          },
```

Run: `pnpm test src/lib/auth.test.ts` → PASS.

- [ ] **Step 7: Testes que falham da suspensão e da API** — `src/modules/plataforma/suspensao.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { session, tenants, user } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { criarEEntrar, entrar } from '../../../test/sessao';
import { reativarConta, suspenderConta } from './suspensao';

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());

async function contaComNutri() {
  const [t] = await db.insert(tenants).values({ slug: `sus-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Sus' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  return { t, n };
}

describe('suspenderConta / reativarConta (US-004)', () => {
  it('suspende sem apagar dados e revoga na hora só as sessões daquele tenant', async () => {
    const a = await contaComNutri();
    const b = await contaComNutri();
    const r = await suspenderConta(a.t.id, randomUUID());
    expect(r.sessoesRevogadas).toBe(1);
    expect((await db.select().from(tenants).where(eq(tenants.id, a.t.id)))[0].status).toBe('suspensa');
    expect(await db.select().from(session).where(eq(session.userId, a.n.id))).toEqual([]);
    expect(await db.select().from(session).where(eq(session.userId, b.n.id))).toHaveLength(1);
    expect(await db.select().from(user).where(eq(user.id, a.n.id))).toHaveLength(1); // dados intactos
    expect(await auth.api.getSession({ headers: new Headers({ cookie: a.n.cookie }) })).toBeNull();
  });

  it('com a conta suspensa o login é recusado; reativada, volta ao normal', async () => {
    const { t, n } = await contaComNutri();
    await suspenderConta(t.id, randomUUID());
    await expect(entrar(auth, n.email)).rejects.toMatchObject({ status: 403 });
    await reativarConta(t.id, randomUUID());
    await expect(entrar(auth, n.email)).resolves.toMatch(/^nd\.session_token=/);
  });

  it('conta inexistente é erro', async () => {
    await expect(suspenderConta(randomUUID(), randomUUID())).rejects.toThrow('Conta não encontrada');
  });
});
```

`src/lib/api-auth.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { criarEEntrar } from '../../test/sessao';
import { requireApiUser } from './api-auth';
import { getAuth } from './auth';

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());
const req = (cookie?: string) =>
  new Request('http://localhost:3000/api/painel/marca/logo', { method: 'POST', headers: cookie ? { cookie } : {} });

describe('requireApiUser', () => {
  it('sem sessão → 401', async () => {
    const r = await requireApiUser(req(), ['nutri']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it('admin em /api/painel → 403 (US-004 "Admin não vê prontuário")', async () => {
    const a = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    const r = await requireApiUser(req(a.cookie), ['nutri']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(403);
      expect(await r.response.json()).toEqual({ erro: 'Acesso negado' });
    }
  });

  it('nutricionista de conta ativa passa; a mesma sessão depois da suspensão recebe 403 (Review Focus 5)', async () => {
    const [t] = await db.insert(tenants).values({ slug: `api-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Api' }).returning();
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    expect((await requireApiUser(req(n.cookie), ['nutri'])).ok).toBe(true);
    await db.update(tenants).set({ status: 'suspensa' }).where(eq(tenants.id, t.id));
    const r = await requireApiUser(req(n.cookie), ['nutri']);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(403);
      expect(await r.response.json()).toEqual({ erro: 'Conta temporariamente indisponível' });
    }
  });
});
```

Run: `pnpm test src/modules/plataforma/suspensao.test.ts src/lib/api-auth.test.ts` → FAIL.

- [ ] **Step 8: Implementar** — `src/modules/plataforma/suspensao.ts`

```ts
import { eq, inArray } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { session, tenants, user } from '@/db/schema';
import { logger } from '@/lib/logger';

/**
 * US-004 / RN-15: suspende sem apagar nada e revoga na mesma transação as sessões das
 * usuárias do tenant. Pacientes (Plano 03+) são barrados por vínculo em requireUser (Plano 06).
 */
export async function suspenderConta(tenantId: string, adminId: string, db: Db = getDb()): Promise<{ sessoesRevogadas: number }> {
  return db.transaction(async (tx) => {
    const r = await tx.update(tenants).set({ status: 'suspensa', updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
    if (!r.length) throw new Error('Conta não encontrada');
    const apagadas = await tx
      .delete(session)
      .where(inArray(session.userId, tx.select({ id: user.id }).from(user).where(eq(user.tenantId, tenantId))))
      .returning({ id: session.id });
    logger.info({ tenantId, adminId, sessoesRevogadas: apagadas.length }, 'conta suspensa');
    return { sessoesRevogadas: apagadas.length };
  });
}

export async function reativarConta(tenantId: string, adminId: string, db: Db = getDb()): Promise<void> {
  const r = await db.update(tenants).set({ status: 'ativa', updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
  if (!r.length) throw new Error('Conta não encontrada');
  logger.info({ tenantId, adminId }, 'conta reativada');
  // P05-06: reagendar os lembretes das consultas futuras (RN-05) quando a tabela notifications existir
}
```

`src/lib/api-auth.ts`

```ts
import { getDb } from '@/db/client';
import { getTenantStatus } from '@/modules/plataforma/tenant-status';
import { getAuth } from './auth';
import type { SessionData } from './session';
import { evaluateSession, type AppRole } from './session-rules';

export type ApiAuth = { ok: true; data: SessionData } | { ok: false; response: Response };

const recusa = (status: number, erro: string): ApiAuth => ({
  ok: false,
  response: Response.json({ erro }, { status, headers: { 'cache-control': 'no-store' } }),
});

/** Route Handlers: mesma regra de requireUser (papel, 12 h, 2FA do admin, RN-15), respondendo 401/403. */
export async function requireApiUser(req: Request, allowed: readonly AppRole[]): Promise<ApiAuth> {
  const data = await getAuth().api.getSession({ headers: req.headers, query: { disableRefresh: true } });
  const tenantId = (data?.user as { tenantId?: string | null } | undefined)?.tenantId;
  const decision = evaluateSession({
    session: data?.session ?? null,
    user: data?.user ?? null,
    allowed,
    now: new Date(),
    path: new URL(req.url).pathname,
    tenantStatus: tenantId ? await getTenantStatus(getDb(), tenantId) : null,
  });
  switch (decision) {
    case 'ok':
      return { ok: true, data: data! };
    case 'login':
    case 'expired':
      return recusa(401, 'Sessão expirada. Entre de novo.');
    case 'suspended':
      return recusa(403, 'Conta temporariamente indisponível');
    case 'setup-2fa':
    case 'forbidden':
      return recusa(403, 'Acesso negado');
    default: {
      const nunca: never = decision;
      throw new Error(`Decisão de sessão desconhecida: ${String(nunca)}`);
    }
  }
}
```

Run: `pnpm test src/modules/plataforma/suspensao.test.ts src/lib/api-auth.test.ts` → PASS.

- [ ] **Step 9: Telas** — `src/app/indisponivel/page.tsx`

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Conta temporariamente indisponível' };

export default function IndisponivelPage() {
  return (
    <main className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Conta temporariamente indisponível</h1>
      <p><a href="/entrar" className="underline">Voltar para o login</a></p>
    </main>
  );
}
```

`src/app/entrar/page.tsx` — no `entrar`, trocar o bloco `if (error) { … }` por:

```ts
    if (error) {
      if (error.code === 'CONTA_SUSPENSA') return router.push('/indisponivel');
      return setErro(error.status === 429 ? 'Muitas tentativas. Tente novamente em 15 minutos.' : 'E-mail ou senha incorretos.');
    }
```

`src/app/entrar/2fa/page.tsx` — no `verificar`, trocar o bloco `if (error) { … }` por:

```ts
    if (error) {
      if (error.code === 'CONTA_SUSPENSA') {
        window.location.href = '/indisponivel';
        return;
      }
      return setErro(error.status === 429 ? 'Muitas tentativas. Tente novamente em 15 minutos.' : 'Código inválido.');
    }
```

`src/app/admin/confirmar-botao.tsx`

```tsx
'use client';

import type { ReactNode } from 'react';

/** Botão de envio que pede confirmação antes (ações que derrubam acesso). */
export function ConfirmarBotao({ mensagem, children }: { mensagem: string; children: ReactNode }) {
  return (
    <button className="underline" onClick={(e) => { if (!window.confirm(mensagem)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
```

`src/app/admin/actions.ts` — acrescentar o import `import { reativarConta, suspenderConta } from '@/modules/plataforma/suspensao';` e:

```ts
export async function suspenderAction(tenantId: string): Promise<void> {
  const { user } = await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) redirect('/admin');
  await suspenderConta(tenantId, user.id);
  revalidatePath('/admin');
  redirect('/admin?aviso=suspensa');
}

export async function reativarAction(tenantId: string): Promise<void> {
  const { user } = await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) redirect('/admin');
  await reativarConta(tenantId, user.id);
  revalidatePath('/admin');
  redirect('/admin?aviso=reativada');
}
```

`src/app/admin/page.tsx` — importar `ConfirmarBotao` (`./confirmar-botao`) e `reativarAction`, `suspenderAction` (`./actions`); acrescentar ao `AVISOS`:

```ts
  suspensa: { texto: 'Conta suspensa. A nutricionista e os pacientes veem "Conta temporariamente indisponível".' },
  reativada: { texto: 'Conta reativada.' },
```

E trocar a última célula (`<td>` das ações) por:

```tsx
              <td className="space-y-1">
                {c.convite !== 'aceito' && c.email && (
                  <form action={reenviarConviteAction.bind(null, c.tenantId)}>
                    <button className="underline">Reenviar convite</button>
                  </form>
                )}
                {c.status === 'ativa' ? (
                  <form action={suspenderAction.bind(null, c.tenantId)}>
                    <ConfirmarBotao mensagem={`Suspender a conta ${c.nomeExibicao}? A nutricionista e os pacientes perdem o acesso até a reativação. Nenhum dado é apagado.`}>
                      Suspender
                    </ConfirmarBotao>
                  </form>
                ) : (
                  <form action={reativarAction.bind(null, c.tenantId)}>
                    <ConfirmarBotao mensagem={`Reativar a conta ${c.nomeExibicao}?`}>Reativar</ConfirmarBotao>
                  </form>
                )}
              </td>
```

- [ ] **Step 10: E2E** — acrescentar ao final de `e2e/plataforma.spec.ts`:

```ts
test('suspender derruba a sessão aberta e bloqueia o login; reativar devolve o acesso (US-004)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.3.4' } });
  const nutri = await ctx.newPage();
  const login = async () => {
    await nutri.goto('/entrar');
    await nutri.getByLabel('E-mail').fill(NUTRI.email);
    await nutri.getByLabel('Senha').fill(NUTRI.senha);
    await nutri.getByRole('button', { name: 'Entrar' }).click();
  };
  await login();
  await expect(nutri).toHaveURL(/\/painel$/);

  await admin.goto('/admin');
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('row', { name: new RegExp(NUTRI.slug) }).getByRole('button', { name: 'Suspender' }).click();
  await expect(admin.getByRole('status')).toContainText('Conta suspensa.');

  await nutri.reload(); // a sessão foi revogada
  await expect(nutri).toHaveURL(/\/entrar\?expirada=1/);
  await login();
  await expect(nutri).toHaveURL(/\/indisponivel$/);
  await expect(nutri.getByRole('heading', { name: 'Conta temporariamente indisponível' })).toBeVisible();

  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('row', { name: new RegExp(NUTRI.slug) }).getByRole('button', { name: 'Reativar' }).click();
  await expect(admin.getByRole('status')).toHaveText('Conta reativada.');
  await login();
  await expect(nutri).toHaveURL(/\/painel$/);
  await ctx.close();
});
```

- [ ] **Step 11: Rodar tudo e commit**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm e2e:seed && APP_URL=http://localhost:3100 pnpm test:e2e`
Expected: PASS.

```bash
git add src/lib src/modules/plataforma/suspensao.ts src/modules/plataforma/suspensao.test.ts src/app/indisponivel src/app/entrar src/app/admin e2e/plataforma.spec.ts
git commit -m "feat(admin): suspender/reativar conta com sessões revogadas, login bloqueado e tela de conta indisponível"
```

---

### Task 8: Armazenamento em `/data` — tipo pelo conteúdo, cota de 5 GB e URL assinada de 5 min (P02-02)

**Files:**
- Create: `drizzle/0010_stored_files.sql` (gerada), `drizzle/0011_rls_stored_files.sql` (custom), `src/lib/file-type.ts`, `src/lib/file-type.test.ts`, `src/lib/signed-url.ts`, `src/lib/signed-url.test.ts`, `src/lib/format.ts`, `src/lib/format.test.ts`, `src/modules/plataforma/armazenamento.ts`, `src/modules/plataforma/armazenamento.test.ts`, `src/app/api/arquivos/route.ts`, `src/app/api/arquivos/route.test.ts`, `test/isolamento.test.ts`
- Modify: `src/db/schema/platform.ts` (`storedFiles`), `src/env.ts`, `src/env.test.ts`, `test/setup.ts`, `.env.example`, `Dockerfile`, `.github/workflows/ci.yml` (env do `e2e`), `src/app/painel/page.tsx`, `CLAUDE.md`

**Interfaces:**
- Consumes: `withTenant`, `TenantContext` (Tarefa 4); `tenants.armazenamentoBytes` (Tarefa 5); `safeEqual` (Tarefa 1); `listTenantTables`, `RLS_EXCEPTIONS` (Plano 01).
- Produces:
  - `Env` ganha `FILE_URL_SECRET: string` e `DATA_DIR: string` (absoluto); `WorkerEnv` ganha `DATA_DIR`.
  - Schema: `storedFiles` 🔒 (`tenantId`, `tipo`, `caminho` UNIQUE, `bytes`, `mime`, `criadoPor`).
  - `@/lib/file-type`: `type TipoArquivo = { mime; ext: 'png' | 'jpg' | 'webp' | 'heic' | 'pdf' | 'svg' }`, `detectarTipo(buf: Uint8Array): TipoArquivo | null`.
  - `@/lib/signed-url`: `FILE_URL_TTL_S = 300`, `CAMINHO_ARQUIVO` (regex), `signFileUrl(caminho, opts?: { now?: Date; secret?: string }): string` (`/api/arquivos?c=…&e=…&s=…`), `verifyFileUrl(params: URLSearchParams, opts?): { ok: true; caminho } | { ok: false; motivo: 'assinatura' | 'expirado' | 'caminho' }`.
  - `@/lib/format`: `formatarBytes(n: number): string`.
  - `@/modules/plataforma/armazenamento`: `COTA_BYTES`, `COTA_AVISO = 0.8`, `MSG_COTA_ESGOTADA`, `type TipoDeArquivo`, `class CotaEsgotadaError`, `class TipoNaoPermitidoError`, `type ArquivoSalvo = { id; caminho; bytes; mime }`, `nivelDeUso(bytes): { percentual; nivel: 'ok' | 'aviso' | 'esgotado' }`, `resolverCaminho(dataDir, caminho): string`, `salvarArquivo(ctx, { tipo, conteudo: Buffer, permitidos }, deps?): Promise<ArquivoSalvo>`, `apagarArquivo(ctx, filtro: { id: string } | { caminho: string }, deps?): Promise<boolean>`.
  - Rota `GET /api/arquivos` (só por URL assinada).
  - `test/isolamento.test.ts`: matriz RNF-07 — **toda** tabela 🔒 precisa de uma fábrica ali (os próximos planos acrescentam as suas).

- [ ] **Step 1: Ambiente** — testes em `src/env.test.ts` (acrescentar ao `base`: `FILE_URL_SECRET: 's'.repeat(32), DATA_DIR: './data'`):

```ts
describe('parseEnv — armazenamento', () => {
  it('exige FILE_URL_SECRET com 32+ caracteres e resolve DATA_DIR para caminho absoluto', () => {
    expect(() => parseEnv({ ...base, FILE_URL_SECRET: 'curta' })).toThrow(/FILE_URL_SECRET/);
    expect(parseEnv(base).DATA_DIR).toMatch(/^\/.*\/data$/);
    expect(() => parseEnv({ ...base, DATA_DIR: undefined })).toThrow(/DATA_DIR/);
  });
});
```

E, no `parseWorkerEnv`, acrescentar `DATA_DIR: './data'` aos objetos válidos `w` e do primeiro teste.

Implementar em `src/env.ts` (importar `path` de `node:path` no topo):

```ts
const dataDir = z
  .string({ message: 'DATA_DIR é obrigatória' })
  .min(1, { message: 'DATA_DIR é obrigatória' })
  .transform((p) => path.resolve(p));
```

No `appSchema.extend({…})`, acrescentar:

```ts
    FILE_URL_SECRET: z.string({ message: 'FILE_URL_SECRET é obrigatória' }).min(32, {
      message: 'FILE_URL_SECRET precisa de pelo menos 32 caracteres',
    }),
    DATA_DIR: dataDir,
```

E no `workerSchema.extend({…})`: `DATA_DIR: dataDir,`.

`test/setup.ts`, acrescentar:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
process.env.FILE_URL_SECRET = 'file-url-secret-de-teste-com-32-caracteres!';
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'nd-data-'));
```

`.env.example`, seção do Plano 02:

```bash
# app: segredo das URLs assinadas de arquivo (gere com: openssl rand -base64 48)
FILE_URL_SECRET=
# app e worker: pasta dos arquivos (produção: /data, volume montado nos dois serviços)
DATA_DIR=./data
```

(remover `FILE_URL_SECRET=` e `DATA_DIR=` da seção "Planos seguintes").

`Dockerfile` — no `ENV` do estágio `build`, acrescentar `FILE_URL_SECRET=build-only-file-url-secret-build-only-00 \` e `DATA_DIR=/tmp/build-data`; no estágio `runner`, antes de `USER node`:

```dockerfile
# Ponto de montagem do volume de arquivos (§4): o app e o worker rodam como node
RUN mkdir -p /data && chown node:node /data
```

`.github/workflows/ci.yml`, no `env:` do job `e2e`:

```yaml
      FILE_URL_SECRET: ci-file-url-secret-with-at-least-32-chars
      DATA_DIR: /tmp/nd-data
```

`.env.local` de quem desenvolve: gerar e colar `FILE_URL_SECRET` (o app passa a exigir).

Run: `pnpm test src/env.test.ts` → PASS.

- [ ] **Step 2: Tabela** — em `src/db/schema/platform.ts`, acrescentar:

```ts
/** Arquivos em DATA_DIR (logo, capas, PDFs, exames, fotos) — base da cota de 5 GB (RN-18). */
export const storedFiles = pgTable(
  'stored_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    tipo: text('tipo').notNull(),
    caminho: text('caminho').notNull().unique(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    criadoPor: uuid('criado_por'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('stored_files_tipo_valido', sql`${t.tipo} in ('logo','capa','exame','plano_pdf','diario_foto','orientacao_pdf','exportacao')`),
    check('stored_files_bytes_positivo', sql`${t.bytes} > 0`),
    index('stored_files_tenant_idx').on(t.tenantId, t.tipo),
  ],
);
```

Run: `pnpm db:generate --name stored_files` → `drizzle/0010_stored_files.sql` com `CREATE TABLE "stored_files"`, a UNIQUE de `caminho`, os 2 CHECKs, a FK para `tenants` e o índice.

Run: `pnpm drizzle-kit generate --custom --name rls_stored_files` e preencher `drizzle/0011_rls_stored_files.sql`:

```sql
SELECT app_enable_tenant_rls('stored_files');
```

Run: `pnpm test src/db/rls-guard.test.ts` → PASS (sem a migration custom, falharia com "RLS não habilitada" em `stored_files`).

- [ ] **Step 3: Testes que falham do tipo pelo conteúdo** — `src/lib/file-type.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { detectarTipo } from './file-type';

const b = (...partes: (number[] | string)[]) =>
  Buffer.concat(partes.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('detectarTipo (magic bytes, RNF-06)', () => {
  it('reconhece PNG, JPEG, PDF, WEBP e HEIC pelo conteúdo', () => {
    expect(detectarTipo(b(PNG, [0, 0, 0, 13]))).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detectarTipo(b([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectarTipo(b('%PDF-1.7\n'))).toEqual({ mime: 'application/pdf', ext: 'pdf' });
    expect(detectarTipo(b('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toEqual({ mime: 'image/webp', ext: 'webp' });
    expect(detectarTipo(b([0, 0, 0, 24], 'ftypheic', [0, 0, 0, 0]))).toEqual({ mime: 'image/heic', ext: 'heic' });
  });
  it('reconhece SVG, com ou sem prólogo XML', () => {
    expect(detectarTipo(b('<svg xmlns="http://www.w3.org/2000/svg" width="10"/>'))).toEqual({ mime: 'image/svg+xml', ext: 'svg' });
    expect(detectarTipo(b('﻿<?xml version="1.0"?>\n<!-- logo -->\n<svg viewBox="0 0 1 1"></svg>'))).toMatchObject({ ext: 'svg' });
  });
  it('recusa HTML com script "renomeado para .png", SVG com <!ENTITY>, texto e vazio (Review Focus 3)', () => {
    expect(detectarTipo(b('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectarTipo(b('<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "x">]><svg>&a;</svg>'))).toBeNull();
    expect(detectarTipo(b('olá, não sou imagem'))).toBeNull();
    expect(detectarTipo(new Uint8Array())).toBeNull();
    expect(detectarTipo(b([0, 0, 0, 24], 'ftypavif'))).toBeNull(); // AVIF não é aceito
  });
});
```

Run: `pnpm test src/lib/file-type.test.ts` → FAIL.

- [ ] **Step 4: Implementar** — `src/lib/file-type.ts`

```ts
export type TipoArquivo =
  | { mime: 'image/png'; ext: 'png' }
  | { mime: 'image/jpeg'; ext: 'jpg' }
  | { mime: 'image/webp'; ext: 'webp' }
  | { mime: 'image/heic'; ext: 'heic' }
  | { mime: 'application/pdf'; ext: 'pdf' }
  | { mime: 'image/svg+xml'; ext: 'svg' };

const bytesEm = (buf: Uint8Array, bytes: readonly number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((x, i) => buf[offset + i] === x);
const textoEm = (buf: Uint8Array, s: string, offset = 0) => bytesEm(buf, [...s].map((c) => c.charCodeAt(0)), offset);
const MARCAS_HEIC = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];
const SVG = /^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE\s+svg[^>[]*>\s*)?<svg[\s/>]/i;

/** Tipo real do arquivo pelos primeiros bytes (RNF-06): o nome e o Content-Type do cliente são ignorados. */
export function detectarTipo(buf: Uint8Array): TipoArquivo | null {
  if (bytesEm(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (bytesEm(buf, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (textoEm(buf, '%PDF-')) return { mime: 'application/pdf', ext: 'pdf' };
  if (textoEm(buf, 'RIFF') && textoEm(buf, 'WEBP', 8)) return { mime: 'image/webp', ext: 'webp' };
  if (textoEm(buf, 'ftyp', 4) && MARCAS_HEIC.some((m) => textoEm(buf, m, 8))) return { mime: 'image/heic', ext: 'heic' };
  if (ehSvg(buf)) return { mime: 'image/svg+xml', ext: 'svg' };
  return null;
}

function ehSvg(buf: Uint8Array): boolean {
  if (!buf.length) return false;
  const texto = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
  if (/<!ENTITY/i.test(texto)) return false; // XXE e "billion laughs": recusado sempre
  return SVG.test(texto.slice(0, 4096));
}
```

Run: `pnpm test src/lib/file-type.test.ts` → PASS (3 testes).

- [ ] **Step 5: Testes que falham da URL assinada e do formato de bytes** — `src/lib/signed-url.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { FILE_URL_TTL_S, signFileUrl, verifyFileUrl } from './signed-url';

const secret = 'segredo-de-teste-com-mais-de-32-caracteres';
const caminho = '11111111-1111-4111-8111-111111111111/logo/22222222-2222-4222-8222-222222222222.png';
const t0 = new Date('2026-10-01T12:00:00Z');
const params = (url: string) => new URL(url, 'http://x').searchParams;

describe('URL assinada de arquivo (§4: TTL 5 min)', () => {
  it('vale por 5 minutos e depois expira', () => {
    const url = signFileUrl(caminho, { now: t0, secret });
    expect(url).toMatch(/^\/api\/arquivos\?c=/);
    expect(verifyFileUrl(params(url), { now: new Date(t0.getTime() + (FILE_URL_TTL_S - 1) * 1000), secret })).toEqual({ ok: true, caminho });
    expect(verifyFileUrl(params(url), { now: new Date(t0.getTime() + (FILE_URL_TTL_S + 1) * 1000), secret })).toEqual({ ok: false, motivo: 'expirado' });
  });
  it('trocar o caminho, a validade ou o segredo invalida a assinatura', () => {
    const p = params(signFileUrl(caminho, { now: t0, secret }));
    const outro = new URLSearchParams(p);
    outro.set('c', caminho.replace('/logo/', '/exame/').replace('.png', '.pdf'));
    expect(verifyFileUrl(outro, { now: t0, secret })).toEqual({ ok: false, motivo: 'assinatura' });
    const maisTempo = new URLSearchParams(p);
    maisTempo.set('e', String(Number(p.get('e')) + 3600));
    expect(verifyFileUrl(maisTempo, { now: t0, secret })).toEqual({ ok: false, motivo: 'assinatura' });
    expect(verifyFileUrl(p, { now: t0, secret: 'outro-segredo-com-mais-de-32-caracteres!!' })).toEqual({ ok: false, motivo: 'assinatura' });
  });
  it('caminho fora do formato (path traversal, SVG, absoluto) é recusado antes de tudo', () => {
    for (const c of ['../../etc/passwd', '/etc/passwd', caminho.replace('.png', '.svg'), `${caminho}/../../x.png`]) {
      expect(verifyFileUrl(new URLSearchParams({ c, e: '9999999999', s: 'x' }), { now: t0, secret })).toEqual({ ok: false, motivo: 'caminho' });
    }
    expect(() => signFileUrl('../x.png', { secret })).toThrow();
  });
});
```

`src/lib/format.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { formatarBytes } from './format';

describe('formatarBytes (RNF-12: vírgula decimal)', () => {
  it('usa a maior unidade e 1 casa', () => {
    expect(formatarBytes(0)).toBe('0 B');
    expect(formatarBytes(1536)).toBe('1,5 KB');
    expect(formatarBytes(5 * 1024 ** 3)).toBe('5 GB');
    expect(formatarBytes(4.3 * 1024 ** 3)).toBe('4,3 GB');
  });
});
```

Run: `pnpm test src/lib/signed-url.test.ts src/lib/format.test.ts` → FAIL.

- [ ] **Step 6: Implementar** — `src/lib/signed-url.ts`

```ts
import { createHmac } from 'node:crypto';
import { getEnv } from '@/env';
import { safeEqual } from './crypto';

export const FILE_URL_TTL_S = 300; // §4: TTL 5 min

/** <tenant>/<tipo>/<arquivo>.<ext> — o único formato servido (sem SVG, sem "..", sem caminho absoluto). */
export const CAMINHO_ARQUIVO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z_]+\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|heic|pdf)$/;

const assinar = (caminho: string, exp: number, secret: string) =>
  createHmac('sha256', secret).update(`${caminho}\n${exp}`).digest('base64url');

type Opts = { now?: Date; secret?: string };

export function signFileUrl(caminho: string, opts: Opts = {}): string {
  if (!CAMINHO_ARQUIVO.test(caminho)) throw new Error('caminho de arquivo inválido');
  const secret = opts.secret ?? getEnv().FILE_URL_SECRET;
  const exp = Math.floor((opts.now ?? new Date()).getTime() / 1000) + FILE_URL_TTL_S;
  return `/api/arquivos?${new URLSearchParams({ c: caminho, e: String(exp), s: assinar(caminho, exp, secret) })}`;
}

export type VerificacaoUrl = { ok: true; caminho: string } | { ok: false; motivo: 'assinatura' | 'expirado' | 'caminho' };

export function verifyFileUrl(params: URLSearchParams, opts: Opts = {}): VerificacaoUrl {
  const caminho = params.get('c') ?? '';
  const exp = Number(params.get('e'));
  if (!CAMINHO_ARQUIVO.test(caminho)) return { ok: false, motivo: 'caminho' };
  if (!Number.isSafeInteger(exp)) return { ok: false, motivo: 'assinatura' };
  const secret = opts.secret ?? getEnv().FILE_URL_SECRET;
  if (!safeEqual(params.get('s') ?? '', assinar(caminho, exp, secret))) return { ok: false, motivo: 'assinatura' };
  if (exp * 1000 < (opts.now ?? new Date()).getTime()) return { ok: false, motivo: 'expirado' };
  return { ok: true, caminho };
}
```

`src/lib/format.ts`

```ts
const UNIDADES = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatarBytes(n: number): string {
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNIDADES.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${UNIDADES[i]}`;
}
```

Run: `pnpm test src/lib/signed-url.test.ts src/lib/format.test.ts` → PASS.

- [ ] **Step 7: Testes que falham do armazenamento** — `src/modules/plataforma/armazenamento.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { storedFiles, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import {
  apagarArquivo, COTA_BYTES, CotaEsgotadaError, nivelDeUso, resolverCaminho, salvarArquivo, TipoNaoPermitidoError,
} from './armazenamento';

const app = makeDb(inject('appDatabaseUrl'));
const dataDir = mkdtempSync(path.join(tmpdir(), 'nd-arq-'));
const deps = { db: app.db, dataDir };
afterAll(() => app.pool.end());

const PNG = (n = 100) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]);
async function novoTenant(): Promise<TenantContext> {
  const [t] = await app.db.insert(tenants).values({ slug: `arq-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Arq' }).returning();
  return { tenantId: t.id, role: 'nutri', actorUserId: randomUUID(), ip: '203.0.113.1' };
}
const usado = async (id: string) => (await app.db.select().from(tenants).where(eq(tenants.id, id)))[0].armazenamentoBytes;
const definirUso = (id: string, bytes: number) => app.db.update(tenants).set({ armazenamentoBytes: bytes }).where(eq(tenants.id, id));

describe('salvarArquivo (RN-18, RNF-06)', () => {
  it('grava em <tenant>/<tipo>/<id>.<ext>, registra e soma na cota', async () => {
    const ctx = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(100), permitidos: ['png'] }, deps);
    expect(a.caminho).toBe(`${ctx.tenantId}/logo/${a.id}.png`);
    expect(readFileSync(path.join(dataDir, a.caminho)).equals(PNG(100))).toBe(true);
    expect(await usado(ctx.tenantId)).toBe(108);
    const [row] = await withTenant(ctx, (tx) => tx.select().from(storedFiles).where(eq(storedFiles.id, a.id)), app.db);
    expect(row).toMatchObject({ bytes: 108, mime: 'image/png', tipo: 'logo', criadoPor: ctx.actorUserId });
  });

  it('decide pelo conteúdo: HTML "como .png", PDF onde só cabe imagem e SVG são recusados (Review Focus 3)', async () => {
    const ctx = await novoTenant();
    await expect(salvarArquivo(ctx, { tipo: 'logo', conteudo: Buffer.from('<html><script>x</script></html>'), permitidos: ['png'] }, deps)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    await expect(salvarArquivo(ctx, { tipo: 'logo', conteudo: Buffer.from('%PDF-1.4'), permitidos: ['png', 'jpg'] }, deps)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    await expect(salvarArquivo(ctx, { tipo: 'logo', conteudo: Buffer.from('<svg/>'), permitidos: ['png', 'svg'] }, deps)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    expect(await usado(ctx.tenantId)).toBe(0);
  });

  it('a 100% recusa com a mensagem da spec e não grava nada', async () => {
    const ctx = await novoTenant();
    await definirUso(ctx.tenantId, COTA_BYTES - 10);
    const e = await salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(20), permitidos: ['png'] }, deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CotaEsgotadaError);
    expect((e as Error).message).toBe('Espaço de armazenamento esgotado. Fale com o suporte.');
    expect(await usado(ctx.tenantId)).toBe(COTA_BYTES - 10);
  });

  it('dois uploads simultâneos perto do limite: só um passa (Review Focus 4)', async () => {
    const ctx = await novoTenant();
    await definirUso(ctx.tenantId, COTA_BYTES - 1500);
    const r = await Promise.allSettled([
      salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(992), permitidos: ['png'] }, deps),
      salvarArquivo(ctx, { tipo: 'exame', conteudo: PNG(992), permitidos: ['png'] }, deps),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(CotaEsgotadaError);
    expect(await usado(ctx.tenantId)).toBe(COTA_BYTES - 500);
  });

  it('falha ao gravar o arquivo devolve a reserva e não deixa registro', async () => {
    const ctx = await novoTenant();
    const naoEhPasta = path.join(dataDir, `arquivo-${randomUUID()}`);
    writeFileSync(naoEhPasta, 'x');
    await expect(salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(), permitidos: ['png'] }, { db: app.db, dataDir: naoEhPasta })).rejects.toThrow();
    expect(await usado(ctx.tenantId)).toBe(0);
    expect(await withTenant(ctx, (tx) => tx.select().from(storedFiles), app.db)).toEqual([]);
  });
});

describe('apagarArquivo', () => {
  it('apaga o arquivo e devolve o espaço; outro tenant não consegue apagar', async () => {
    const ctx = await novoTenant();
    const outro = await novoTenant();
    const a = await salvarArquivo(ctx, { tipo: 'logo', conteudo: PNG(50), permitidos: ['png'] }, deps);
    expect(await apagarArquivo(outro, { id: a.id }, deps)).toBe(false);
    expect(existsSync(path.join(dataDir, a.caminho))).toBe(true);
    expect(await apagarArquivo(ctx, { caminho: a.caminho }, deps)).toBe(true);
    expect(existsSync(path.join(dataDir, a.caminho))).toBe(false);
    expect(await usado(ctx.tenantId)).toBe(0);
  });
});

describe('nivelDeUso e resolverCaminho', () => {
  it('aviso a partir de 80%, esgotado em 100%', () => {
    expect(nivelDeUso(0)).toEqual({ percentual: 0, nivel: 'ok' });
    expect(nivelDeUso(COTA_BYTES * 0.8)).toEqual({ percentual: 80, nivel: 'aviso' });
    expect(nivelDeUso(COTA_BYTES)).toEqual({ percentual: 100, nivel: 'esgotado' });
  });
  it('recusa caminhos que escapam do DATA_DIR', () => {
    for (const c of ['../x', '/etc/passwd', 'a/../../x', '']) expect(() => resolverCaminho(dataDir, c)).toThrow();
    expect(resolverCaminho(dataDir, 'a/b.png')).toBe(path.join(dataDir, 'a/b.png'));
  });
});
```

Run: `pnpm test src/modules/plataforma/armazenamento.test.ts` → FAIL.

- [ ] **Step 8: Implementar** — `src/modules/plataforma/armazenamento.ts`

```ts
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Db } from '@/db/client';
import { storedFiles, tenants } from '@/db/schema';
import { withTenant, type TenantContext } from '@/db/tenant';
import { getEnv } from '@/env';
import { detectarTipo, type TipoArquivo } from '@/lib/file-type';
import { logger } from '@/lib/logger';

export const COTA_BYTES = 5 * 1024 ** 3; // RN-18: 5 GB por tenant
export const COTA_AVISO = 0.8;
export const MSG_COTA_ESGOTADA = 'Espaço de armazenamento esgotado. Fale com o suporte.';

export type TipoDeArquivo = 'logo' | 'capa' | 'exame' | 'plano_pdf' | 'diario_foto' | 'orientacao_pdf' | 'exportacao';
export type ArquivoSalvo = { id: string; caminho: string; bytes: number; mime: string };

export class CotaEsgotadaError extends Error {
  override name = 'CotaEsgotadaError';
  constructor() {
    super(MSG_COTA_ESGOTADA);
  }
}
export class TipoNaoPermitidoError extends Error {
  override name = 'TipoNaoPermitidoError';
  constructor() {
    super('Formato de arquivo não permitido.');
  }
}

type Deps = { db?: Db; dataDir?: string };

export function nivelDeUso(bytes: number): { percentual: number; nivel: 'ok' | 'aviso' | 'esgotado' } {
  const percentual = Math.min(100, Math.floor((bytes / COTA_BYTES) * 100));
  const nivel = bytes >= COTA_BYTES ? 'esgotado' : bytes >= COTA_BYTES * COTA_AVISO ? 'aviso' : 'ok';
  return { percentual, nivel };
}

/** Caminho absoluto dentro de DATA_DIR; qualquer coisa que escape da pasta é erro (path traversal). */
export function resolverCaminho(dataDir: string, caminho: string): string {
  const raiz = path.resolve(dataDir);
  const alvo = path.resolve(raiz, caminho);
  if (!caminho || !alvo.startsWith(raiz + path.sep)) throw new Error('caminho fora do diretório de dados');
  return alvo;
}

/**
 * Salva um arquivo do tenant. O tipo vem do conteúdo (nunca do nome); SVG nunca é guardado
 * (a Tarefa 10 converte o logo SVG em PNG antes). A cota é reservada na mesma transação do
 * registro: a linha do tenant fica travada até o commit, então uploads simultâneos não passam do limite.
 */
export async function salvarArquivo(
  ctx: TenantContext,
  input: { tipo: TipoDeArquivo; conteudo: Buffer; permitidos: readonly TipoArquivo['ext'][] },
  deps: Deps = {},
): Promise<ArquivoSalvo> {
  const db = deps.db ?? getDb();
  const dataDir = deps.dataDir ?? getEnv().DATA_DIR;
  const real = detectarTipo(input.conteudo);
  if (!real || real.ext === 'svg' || !input.permitidos.includes(real.ext)) throw new TipoNaoPermitidoError();
  const id = randomUUID();
  const caminho = `${ctx.tenantId}/${input.tipo}/${id}.${real.ext}`;
  const destino = resolverCaminho(dataDir, caminho);
  const tmp = `${destino}.${process.pid}.tmp`;
  const bytes = input.conteudo.length;
  let gravado = false;
  try {
    return await withTenant(ctx, async (tx) => {
      const reserva = await tx
        .update(tenants)
        .set({ armazenamentoBytes: sql`${tenants.armazenamentoBytes} + ${bytes}` })
        .where(and(eq(tenants.id, ctx.tenantId), sql`${tenants.armazenamentoBytes} + ${bytes} <= ${COTA_BYTES}`))
        .returning({ id: tenants.id });
      if (!reserva.length) throw new CotaEsgotadaError();
      await tx.insert(storedFiles).values({ id, tenantId: ctx.tenantId, tipo: input.tipo, caminho, bytes, mime: real.mime, criadoPor: ctx.actorUserId ?? null });
      await mkdir(path.dirname(destino), { recursive: true, mode: 0o750 });
      await writeFile(tmp, input.conteudo, { mode: 0o640, flag: 'wx' });
      await rename(tmp, destino);
      gravado = true;
      return { id, caminho, bytes, mime: real.mime };
    }, db);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    if (gravado) await rm(destino, { force: true }).catch(() => undefined); // o commit falhou depois da gravação
    throw err;
  }
}

/** Apaga o registro e devolve o espaço; o arquivo sai do disco depois do commit. */
export async function apagarArquivo(ctx: TenantContext, filtro: { id: string } | { caminho: string }, deps: Deps = {}): Promise<boolean> {
  const db = deps.db ?? getDb();
  const dataDir = deps.dataDir ?? getEnv().DATA_DIR;
  const onde = 'id' in filtro ? eq(storedFiles.id, filtro.id) : eq(storedFiles.caminho, filtro.caminho);
  const apagado = await withTenant(ctx, async (tx) => {
    const [row] = await tx.delete(storedFiles).where(onde).returning({ caminho: storedFiles.caminho, bytes: storedFiles.bytes });
    if (!row) return null;
    await tx
      .update(tenants)
      .set({ armazenamentoBytes: sql`greatest(${tenants.armazenamentoBytes} - ${row.bytes}, 0)` })
      .where(eq(tenants.id, ctx.tenantId));
    return row;
  }, db);
  if (!apagado) return false;
  await rm(resolverCaminho(dataDir, apagado.caminho), { force: true }).catch((err: unknown) =>
    logger.warn({ err: err instanceof Error ? err.message : String(err), tenantId: ctx.tenantId }, 'arquivo órfão no disco'),
  );
  return true;
}
```

Run: `pnpm test src/modules/plataforma/armazenamento.test.ts` → PASS (9 testes).

- [ ] **Step 9: Rota de download** — teste `src/app/api/arquivos/route.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { signFileUrl } from '@/lib/signed-url';
import { salvarArquivo } from '@/modules/plataforma/armazenamento';
import { GET } from './route';

afterAll(() => closeDb());
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('conteudo')]);
const get = (url: string) => GET(new Request(`http://localhost:3000${url}`));

describe('GET /api/arquivos', () => {
  it('serve o arquivo com URL assinada válida, com cabeçalhos que impedem execução', async () => {
    const [t] = await getDb().insert(tenants).values({ slug: `rota-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Rota' }).returning();
    const a = await salvarArquivo({ tenantId: t.id, role: 'nutri' }, { tipo: 'logo', conteudo: PNG, permitidos: ['png'] });
    const res = await get(signFileUrl(a.caminho));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
  });
  it('expirada → 410; assinatura errada ou caminho fora do formato → 403; arquivo inexistente → 404', async () => {
    const caminho = `${randomUUID()}/logo/${randomUUID()}.png`;
    expect((await get(signFileUrl(caminho, { now: new Date(Date.now() - 10 * 60_000) }))).status).toBe(410);
    expect((await get(`/api/arquivos?c=${encodeURIComponent(caminho)}&e=9999999999&s=x`)).status).toBe(403);
    expect((await get('/api/arquivos?c=..%2F..%2Fetc%2Fpasswd&e=9999999999&s=x')).status).toBe(403);
    expect((await get(signFileUrl(caminho))).status).toBe(404);
  });
});
```

Run: `pnpm test src/app/api/arquivos` → FAIL. Implementar `src/app/api/arquivos/route.ts`:

```ts
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { getEnv } from '@/env';
import { verifyFileUrl } from '@/lib/signed-url';
import { resolverCaminho } from '@/modules/plataforma/armazenamento';

export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf',
};
const erro = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** Arquivos de /data só por URL assinada (TTL 5 min). A assinatura é emitida por quem já checou o acesso. */
export async function GET(req: Request) {
  const v = verifyFileUrl(new URL(req.url).searchParams);
  if (!v.ok) return erro(v.motivo === 'expirado' ? 410 : 403);
  let alvo: string;
  try {
    alvo = resolverCaminho(getEnv().DATA_DIR, v.caminho);
  } catch {
    return erro(403);
  }
  const info = await stat(alvo).catch(() => null);
  if (!info?.isFile()) return erro(404);
  const ext = v.caminho.slice(v.caminho.lastIndexOf('.') + 1);
  return new Response(Readable.toWeb(createReadStream(alvo)) as ReadableStream, {
    headers: {
      'content-type': MIME[ext],
      'content-length': String(info.size),
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': 'inline',
      'referrer-policy': 'no-referrer',
    },
  });
}
```

Run: `pnpm test src/app/api/arquivos` → PASS.

- [ ] **Step 10: Matriz de isolamento de todas as tabelas 🔒 (RNF-07)** — `test/isolamento.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { makeDb } from './db';
import { tenants } from '@/db/schema';
import { listTenantTables, RLS_EXCEPTIONS } from '@/db/rls-guard';
import { withTenant } from '@/db/tenant';

/**
 * RNF-07: "tenta ler, alterar e excluir dados de outro tenant e de outro paciente do mesmo tenant
 * em todas as tabelas 🔒". Cada tabela nova com tenant_id PRECISA de uma fábrica aqui.
 */
const FABRICAS: Record<string, (tenantId: string, patientId: string) => SQL> = {
  audit_log: (t, p) => sql`insert into audit_log (tenant_id, acao, entidade, patient_id) values (${t}, 'ler', 'isolamento', ${p})`,
  stored_files: (t) =>
    sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values (${t}, 'logo', ${`${t}/logo/${randomUUID()}.png`}, 1, 'image/png')`,
  rls_fixture_patient_items: (t, p) => sql`insert into rls_fixture_patient_items (tenant_id, patient_id, texto) values (${t}, ${p}, 'x')`,
  audit_fixture_registros: (t, p) => sql`insert into audit_fixture_registros (tenant_id, patient_id, texto) values (${t}, ${p}, 'x')`,
};
/** Tabelas append-only: UPDATE/DELETE já são negados por permissão. */
const SO_INSERE = new Set(['audit_log']);

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl'));
let A: string;
let B: string;
const P1 = randomUUID();
const P2 = randomUUID();
let tabelas: string[] = [];

beforeAll(async () => {
  const [a, b] = await app.db
    .insert(tenants)
    .values([
      { slug: `iso-a-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Iso A' },
      { slug: `iso-b-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Iso B' },
    ])
    .returning({ id: tenants.id });
  A = a.id;
  B = b.id;
  tabelas = (await listTenantTables(owner.pool)).filter((t) => !RLS_EXCEPTIONS[t]);
  for (const t of tabelas) {
    if (!FABRICAS[t]) continue;
    for (const p of [P1, P2]) await withTenant({ tenantId: A, role: 'nutri' }, (tx) => tx.execute(FABRICAS[t](A, p)), app.db);
  }
});
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});

const temPaciente = async (t: string) =>
  (await owner.pool.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'patient_id'`, [t])).rowCount! > 0;

describe('isolamento em todas as tabelas 🔒 (RNF-07, US-006)', () => {
  it('toda tabela com tenant_id tem fábrica neste teste', () => {
    expect(tabelas.filter((t) => !FABRICAS[t])).toEqual([]);
  });

  it('o tenant B não lê, não altera e não exclui linhas do tenant A', async () => {
    for (const t of tabelas) {
      const id = sql.identifier(t);
      await withTenant({ tenantId: B, role: 'nutri' }, async (tx) => {
        const lidas = await tx.execute(sql`select count(*)::int as n from ${id} where tenant_id = ${A}`);
        expect(lidas.rows[0], t).toEqual({ n: 0 });
        if (SO_INSERE.has(t)) return;
        expect((await tx.execute(sql`update ${id} set tenant_id = tenant_id where tenant_id = ${A}`)).rowCount, t).toBe(0);
        expect((await tx.execute(sql`delete from ${id} where tenant_id = ${A}`)).rowCount, t).toBe(0);
      }, app.db);
    }
  });

  it('o paciente P2 não lê nem altera linhas do paciente P1 do mesmo tenant', async () => {
    for (const t of tabelas) {
      if (!(await temPaciente(t))) continue;
      const id = sql.identifier(t);
      await withTenant({ tenantId: A, role: 'paciente', patientId: P2 }, async (tx) => {
        const lidas = await tx.execute(sql`select count(*)::int as n from ${id} where patient_id = ${P1}`);
        expect(lidas.rows[0], t).toEqual({ n: 0 });
        if (SO_INSERE.has(t)) return;
        expect((await tx.execute(sql`delete from ${id} where patient_id = ${P1}`)).rowCount, t).toBe(0);
      }, app.db);
    }
  });
});
```

Run: `pnpm test test/isolamento.test.ts` → PASS (3 testes). Conferir que a guarda funciona: comentar a linha de `stored_files` em `FABRICAS` → o primeiro teste falha listando `stored_files`; descomentar.

- [ ] **Step 11: Aviso de cota no painel** — em `src/app/painel/page.tsx`, importar `formatarBytes` (`@/lib/format`) e `MSG_COTA_ESGOTADA`, `nivelDeUso` (`@/modules/plataforma/armazenamento`), e, dentro do `<main>`, logo depois do `<h1>`:

```tsx
        {(() => {
          const uso = nivelDeUso(tenant.armazenamentoBytes);
          if (uso.nivel === 'esgotado') return <p role="alert" className="rounded bg-red-50 p-3 text-red-800">{MSG_COTA_ESGOTADA}</p>;
          if (uso.nivel === 'aviso') {
            return (
              <p role="status" className="rounded bg-amber-50 p-3 text-amber-900">
                {`Você já usou ${uso.percentual}% do espaço de armazenamento (${formatarBytes(tenant.armazenamentoBytes)} de 5 GB).`}
              </p>
            );
          }
          return null;
        })()}
```

- [ ] **Step 12: `CLAUDE.md`** — acrescentar às regras obrigatórias:

```markdown
9. Arquivos: gravar e apagar só por `salvarArquivo`/`apagarArquivo` (`src/modules/plataforma/armazenamento.ts`): tipo pelo conteúdo, cota reservada na transação. Servir só por `signFileUrl` (5 min, rota `/api/arquivos`). Nunca montar caminho de arquivo com texto do usuário. Tabela nova com `tenant_id` também entra em `FABRICAS` de `test/isolamento.test.ts`.
```

- [ ] **Step 13: Rodar tudo e commit**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS.

```bash
git add drizzle src/db/schema/platform.ts src/env.ts src/env.test.ts src/lib/file-type.ts src/lib/file-type.test.ts src/lib/signed-url.ts \
  src/lib/signed-url.test.ts src/lib/format.ts src/lib/format.test.ts src/modules/plataforma/armazenamento.ts \
  src/modules/plataforma/armazenamento.test.ts src/app/api/arquivos src/app/painel/page.tsx test/setup.ts test/isolamento.test.ts \
  .env.example Dockerfile .github/workflows/ci.yml CLAUDE.md
git commit -m "feat(arquivos): /data com tipo pelo conteúdo, cota de 5 GB atômica, URL assinada de 5 min e matriz de isolamento"
```

---
### Task 9: Métricas agregadas do admin (`SECURITY DEFINER`) + ajuste da cota de WhatsApp (P02-06)

**Files:**
- Create: `drizzle/0012_metricas_admin.sql` (custom), `src/modules/plataforma/metricas.ts`, `src/modules/plataforma/metricas.test.ts`, `src/app/admin/cota-form.tsx`, `src/app/admin/sem-tabelas-tenant.test.ts`
- Modify: `src/db/migrate-owner.test.ts`, `src/app/admin/actions.ts`, `src/app/admin/page.tsx`

**Interfaces:**
- Consumes: `storedFiles`, `tenants` (Tarefas 5 e 8); `formatarBytes` (Tarefa 8); `COTA_BYTES` (Tarefa 8).
- Produces:
  - SQL: `admin_tenant_metrics() RETURNS TABLE (tenant_id uuid, arquivos bigint, armazenamento_bytes bigint, pacientes_ativos bigint, consultas_mes bigint, mensagens_whatsapp_mes bigint)` — `SECURITY DEFINER`, só contagens; os Planos 03 e 05 trocam os `NULL` por contagens com `CREATE OR REPLACE` (mesma assinatura).
  - `@/modules/plataforma/metricas`: `type MetricasTenant`, `metricasPorTenant(db?): Promise<Map<string, MetricasTenant>>`, `MSG_COTA_WA`, `class CotaWhatsappError`, `ajustarCotaWhatsapp(tenantId, valor: string, adminId, db?): Promise<void>`.
  - Server Action `ajustarCotaAction(tenantId, prev, formData): Promise<{ erro?: string; ok?: boolean }>`.

- [ ] **Step 1: Teste que falha com dono sem superusuário (como em produção)** — em `src/db/migrate-owner.test.ts`, acrescentar ao `describe`:

```ts
  it('métricas do admin: a função SECURITY DEFINER conta por tenant sob FORCE RLS (dono sem superusuário)', async () => {
    const c = await app.connect();
    try {
      const a = (await c.query(`insert into tenants (slug, nome_exibicao) values ('met-a', 'A') returning id`)).rows[0].id as string;
      const b = (await c.query(`insert into tenants (slug, nome_exibicao) values ('met-b', 'B') returning id`)).rows[0].id as string;
      for (const [t, n] of [[a, 2], [b, 1]] as const) {
        await c.query('begin');
        await c.query(`select set_config('app.tenant_id', $1, true)`, [t]);
        for (let i = 0; i < n; i++) {
          await c.query(`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values ($1, 'logo', $2, 10, 'image/png')`, [t, `${t}/logo/${crypto.randomUUID()}.png`]);
        }
        await c.query('commit');
      }
      const { rows } = await c.query(`select tenant_id, arquivos::int as arquivos, pacientes_ativos from admin_tenant_metrics() where tenant_id = any($1)`, [[a, b]]);
      expect(Object.fromEntries(rows.map((r) => [r.tenant_id, r.arquivos]))).toEqual({ [a]: 2, [b]: 1 });
      expect(rows.every((r) => r.pacientes_ativos === null)).toBe(true);
      // fora da função, sem contexto, o role da aplicação não vê nada
      expect((await c.query('select count(*)::int as n from stored_files')).rows[0].n).toBe(0);
    } finally {
      c.release();
    }
  });
```

Run: `pnpm test src/db/migrate-owner.test.ts` → FAIL (`function admin_tenant_metrics() does not exist`).

- [ ] **Step 2: Função de métricas** — `pnpm drizzle-kit generate --custom --name metricas_admin` e preencher `drizzle/0012_metricas_admin.sql`:

```sql
-- §3 / §4.1: o admin vê só contagens por tenant e nunca consulta tabelas 🔒.
-- A RLS é FORCE (vale até para o dono da tabela), então a função entra em cada tenant
-- (set_config local à transação) e, por garantia, também filtra por tenant_id.
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
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tn.id, tn.armazenamento_bytes AS bytes FROM public.tenants tn ORDER BY tn.created_at LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    PERFORM set_config('app.role', 'worker', true);
    PERFORM set_config('app.patient_id', '', true);
    tenant_id := t.id;
    armazenamento_bytes := t.bytes;
    SELECT count(*) INTO arquivos FROM public.stored_files sf WHERE sf.tenant_id = t.id;
    -- Plano 03 (patients) e Plano 05 (appointments, notifications) trocam estes NULL por contagens
    pacientes_ativos := NULL;
    consultas_mes := NULL;
    mensagens_whatsapp_mes := NULL;
    RETURN NEXT;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
  PERFORM set_config('app.role', '', true);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_tenant_metrics() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_tenant_metrics() TO nutri_app_role;
```

Run: `pnpm test src/db/migrate-owner.test.ts` → PASS. (Sem os `set_config`, a contagem daria 0 aqui: com dono sem superusuário a RLS forçada vale dentro da função.)

- [ ] **Step 3: Testes que falham do service** — `src/modules/plataforma/metricas.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { tenants } from '@/db/schema';
import { withTenant } from '@/db/tenant';
import { ajustarCotaWhatsapp, CotaWhatsappError, metricasPorTenant } from './metricas';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

async function tenantComArquivos(n: number, bytes: number) {
  const [t] = await app.db.insert(tenants).values({ slug: `met-${randomUUID().slice(0, 8)}`, nomeExibicao: 'M', armazenamentoBytes: bytes }).returning();
  for (let i = 0; i < n; i++) {
    await withTenant({ tenantId: t.id, role: 'nutri' }, (tx) =>
      tx.execute(sql`insert into stored_files (tenant_id, tipo, caminho, bytes, mime) values (${t.id}, 'logo', ${`${t.id}/logo/${randomUUID()}.png`}, 10, 'image/png')`), app.db);
  }
  return t.id;
}

describe('metricasPorTenant (§3: só contagens)', () => {
  it('conta arquivos e armazenamento de cada tenant; pacientes/consultas/mensagens ainda nulos', async () => {
    const a = await tenantComArquivos(3, 30);
    const b = await tenantComArquivos(1, 10);
    const m = await metricasPorTenant(app.db);
    expect(m.get(a)).toEqual({ tenantId: a, arquivos: 3, armazenamentoBytes: 30, pacientesAtivos: null, consultasMes: null, mensagensWhatsappMes: null });
    expect(m.get(b)?.arquivos).toBe(1);
  });
});

describe('ajustarCotaWhatsapp', () => {
  it('grava inteiro de 0 a 100000 e recusa o resto', async () => {
    const t = await tenantComArquivos(0, 0);
    await ajustarCotaWhatsapp(t, ' 800 ', randomUUID(), app.db);
    expect((await app.db.select().from(tenants).where(eq(tenants.id, t)))[0].waCotaMensal).toBe(800);
    for (const v of ['', '-1', '12.5', 'abc', '100001']) {
      await expect(ajustarCotaWhatsapp(t, v, randomUUID(), app.db)).rejects.toBeInstanceOf(CotaWhatsappError);
    }
    expect((await app.db.select().from(tenants).where(eq(tenants.id, t)))[0].waCotaMensal).toBe(800);
  });
});
```

`src/app/admin/sem-tabelas-tenant.test.ts` (guarda de código para "o admin nunca executa consultas nas tabelas 🔒"):

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ARQUIVOS_DO_ADMIN = [
  ...readdirSync(path.resolve('src/app/admin'), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !d.name.endsWith('.test.ts'))
    .map((d) => path.join(d.parentPath, d.name)),
  path.resolve('src/modules/plataforma/contas.ts'),
  path.resolve('src/modules/plataforma/metricas.ts'),
  path.resolve('src/modules/plataforma/suspensao.ts'),
];
// Tabelas 🔒 e a porta de entrada para elas: o código do admin não pode citar nenhuma
const PROIBIDO = /\b(withTenant|storedFiles|auditLog|stored_files|audit_log)\b/;

describe('§4.1: o admin nunca consulta tabelas 🔒', () => {
  it.each(ARQUIVOS_DO_ADMIN)('%s não acessa tabelas com tenant_id', (arquivo) => {
    expect(readFileSync(arquivo, 'utf8')).not.toMatch(PROIBIDO);
  });
});
```

Run: `pnpm test src/modules/plataforma/metricas.test.ts src/app/admin` → FAIL (`./metricas` não existe).

- [ ] **Step 4: Implementar** — `src/modules/plataforma/metricas.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { tenants } from '@/db/schema';
import { logger } from '@/lib/logger';

export type MetricasTenant = {
  tenantId: string;
  arquivos: number;
  armazenamentoBytes: number;
  pacientesAtivos: number | null;
  consultasMes: number | null;
  mensagensWhatsappMes: number | null;
};

const n = (v: string | number | null) => (v === null ? null : Number(v));

/** §3 / §4.1: só contagens, vindas da função SECURITY DEFINER. */
export async function metricasPorTenant(db: Db = getDb()): Promise<Map<string, MetricasTenant>> {
  const r = await db.execute<{
    tenant_id: string; arquivos: string; armazenamento_bytes: string;
    pacientes_ativos: string | null; consultas_mes: string | null; mensagens_whatsapp_mes: string | null;
  }>(sql`select * from admin_tenant_metrics()`);
  return new Map(
    r.rows.map((x) => [
      x.tenant_id,
      {
        tenantId: x.tenant_id,
        arquivos: Number(x.arquivos),
        armazenamentoBytes: Number(x.armazenamento_bytes),
        pacientesAtivos: n(x.pacientes_ativos),
        consultasMes: n(x.consultas_mes),
        mensagensWhatsappMes: n(x.mensagens_whatsapp_mes),
      },
    ]),
  );
}

export const MSG_COTA_WA = 'Informe um número inteiro de 0 a 100000';
const cotaSchema = z.string().trim().regex(/^\d{1,6}$/, MSG_COTA_WA).transform(Number).pipe(z.number().max(100_000, MSG_COTA_WA));

export class CotaWhatsappError extends Error {
  override name = 'CotaWhatsappError';
}

/** §3: o admin ajusta a cota mensal de WhatsApp do tenant (RN-09 usa no Plano 05). */
export async function ajustarCotaWhatsapp(tenantId: string, valor: string, adminId: string, db: Db = getDb()): Promise<void> {
  const r = cotaSchema.safeParse(valor);
  if (!r.success) throw new CotaWhatsappError(MSG_COTA_WA);
  const up = await db.update(tenants).set({ waCotaMensal: r.data, updatedAt: new Date() }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id });
  if (!up.length) throw new Error('Conta não encontrada');
  logger.info({ tenantId, adminId, cota: r.data }, 'cota de WhatsApp ajustada');
}
```

Run: `pnpm test src/modules/plataforma/metricas.test.ts src/app/admin src/db/migrate-owner.test.ts` → PASS.

- [ ] **Step 5: Tela** — `src/app/admin/actions.ts`, acrescentar o import `import { ajustarCotaWhatsapp, CotaWhatsappError } from '@/modules/plataforma/metricas';` e:

```ts
export type CotaState = { erro?: string; ok?: boolean };

export async function ajustarCotaAction(tenantId: string, _prev: CotaState, formData: FormData): Promise<CotaState> {
  const { user } = await requireUser(['admin'], '/admin');
  if (!uuid.safeParse(tenantId).success) return { erro: 'Conta inválida' };
  try {
    await ajustarCotaWhatsapp(tenantId, String(formData.get('cota') ?? ''), user.id);
  } catch (e) {
    if (e instanceof CotaWhatsappError) return { erro: e.message };
    throw e;
  }
  revalidatePath('/admin');
  return { ok: true };
}
```

`src/app/admin/cota-form.tsx`

```tsx
'use client';

import { useActionState } from 'react';
import { ajustarCotaAction, type CotaState } from './actions';

export function CotaForm({ tenantId, cota }: { tenantId: string; cota: number }) {
  const [state, action, pendente] = useActionState<CotaState, FormData>(ajustarCotaAction.bind(null, tenantId), {});
  const id = `cota-${tenantId}`;
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <label htmlFor={id} className="sr-only">Cota mensal de WhatsApp</label>
      <input id={id} name="cota" inputMode="numeric" defaultValue={cota} aria-invalid={state.erro ? true : undefined}
        aria-describedby={state.erro ? `${id}-erro` : undefined} className="w-24 rounded border p-1" />
      <button disabled={pendente} className="underline">Salvar</button>
      {state.erro && <span id={`${id}-erro`} role="alert" className="text-red-700">{state.erro}</span>}
      {state.ok && <span role="status">Salvo</span>}
    </form>
  );
}
```

`src/app/admin/page.tsx` — importar `CotaForm` (`./cota-form`), `formatarBytes` (`@/lib/format`), `COTA_BYTES` (`@/modules/plataforma/armazenamento`) e `metricasPorTenant` (`@/modules/plataforma/metricas`); carregar `const metricas = await metricasPorTenant();` logo depois de `listarContas()`; acrescentar ao `<thead>` (depois de "Convite"):

```tsx
            <th scope="col">Pacientes ativos</th>
            <th scope="col">Consultas no mês</th>
            <th scope="col">WhatsApp no mês</th>
            <th scope="col">Cota de WhatsApp</th>
            <th scope="col">Armazenamento</th>
```

e ao `<tr>` de cada conta (depois da célula do convite), com `const m = metricas.get(c.tenantId);` no início do `map`:

```tsx
              <td>{m?.pacientesAtivos ?? '—'}</td>
              <td>{m?.consultasMes ?? '—'}</td>
              <td>{m?.mensagensWhatsappMes ?? '—'}</td>
              <td><CotaForm tenantId={c.tenantId} cota={c.waCotaMensal} /></td>
              <td>{m ? `${formatarBytes(m.armazenamentoBytes)} de ${formatarBytes(COTA_BYTES)} (${m.arquivos} arquivos)` : '—'}</td>
```

Para `c.waCotaMensal`, acrescentar `waCotaMensal: number` ao tipo `ContaResumo`, `t.wa_cota_mensal` ao `select` de `listarContas` e `waCotaMensal: row.wa_cota_mensal` ao objeto devolvido (Tarefa 5, `src/modules/plataforma/contas.ts`).

- [ ] **Step 6: Rodar tudo e commit**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS.

```bash
git add drizzle src/db/migrate-owner.test.ts src/modules/plataforma/metricas.ts src/modules/plataforma/metricas.test.ts \
  src/modules/plataforma/contas.ts src/app/admin
git commit -m "feat(admin): métricas por tenant via função SECURITY DEFINER só com contagens e ajuste da cota de WhatsApp"
```

---

### Task 10: Perfil e marca — logo, cor com contraste, CRN, endereço, link, antecedências, agendamento público (P02-07)

**Files:**
- Create: `src/modules/plataforma/marca.ts`, `src/modules/plataforma/marca.test.ts`, `src/modules/plataforma/logo.ts`, `src/modules/plataforma/logo.test.ts`, `src/lib/corpo.ts`, `src/app/api/painel/marca/logo/route.ts`, `src/app/api/painel/marca/logo/route.test.ts`, `src/app/painel/configuracoes/page.tsx`, `src/app/painel/configuracoes/perfil-form.tsx`, `src/app/painel/configuracoes/logo-form.tsx`
- Modify: `package.json`/`pnpm-lock.yaml` (`sharp` direto), `src/app/painel/cabecalho.tsx`, `src/app/painel/actions.ts`, `e2e/plataforma.spec.ts`

**Interfaces:**
- Consumes: `nomeExibicaoSchema`, `crnSchema` (Tarefa 5); `primeiroErroPorCampo` (Tarefa 5); `salvarArquivo`, `apagarArquivo`, `TipoNaoPermitidoError`, `CotaEsgotadaError`, `MSG_COTA_ESGOTADA` (Tarefa 8); `signFileUrl` (Tarefa 8); `detectarTipo` (Tarefa 8); `requireApiUser` (Tarefa 7); `requireNutri` (Tarefa 6); `DPA_VERSAO` (Tarefa 6); `clientIp` (Tarefa 1).
- Produces:
  - `@/modules/plataforma/marca`: `COR_PADRAO = '#047857'`, `contrasteComBranco(hex): number`, `MSG_MARCA`, `perfilSchema`, `class PerfilError { erros }`, `atualizarPerfil(tenantId, input, db?)`, `type MarcaTenant = { nome; cor; logoUrl: string | null }`, `getTenantBrand(tenant: TenantRow): MarcaTenant` (o PWA e o PDF usam nos Planos 04/06), `FUSOS_BRASIL`.
  - `@/modules/plataforma/logo`: `LOGO_MAX_BYTES = 2 MB`, `LOGO_LADO_MAX = 512`, `MSG_LOGO_GRANDE`, `processarLogo(buf): Promise<Buffer>` (sempre PNG ≤ 512 px, sem metadados), `trocarLogo(ctx, buf, deps?): Promise<string>`.
  - `@/lib/corpo`: `class CorpoGrandeError`, `lerCorpoLimitado(req, max): Promise<Buffer>`.
  - Rota `POST /api/painel/marca/logo` (corpo = o arquivo cru).

- [ ] **Step 1: `sharp` como dependência direta** (já está na imagem, trazido pelo Next — não aumenta o tamanho)

```bash
pnpm add sharp@0.35.4 --save-exact
```

(A mesma versão que `next@16.3.6` instala; se o Next tiver sido atualizado, usar a que estiver em `node_modules/.pnpm/sharp@*`.)

- [ ] **Step 2: Testes que falham da marca** — `src/modules/plataforma/marca.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../../test/db';
import { tenants } from '@/db/schema';
import { atualizarPerfil, contrasteComBranco, COR_PADRAO, getTenantBrand, PerfilError } from './marca';

const app = makeDb(inject('appDatabaseUrl'));
afterAll(() => app.pool.end());

const valido = {
  nomeExibicao: 'Debby Silva', crn: 'CRN-3 12345', corPrimaria: '#2E7D32', enderecoConsultorio: 'Rua A, 10',
  linkOnlinePadrao: 'https://meet.exemplo.com/debby', antecedenciaMinH: '12', cancelamentoMinH: '24',
  agendamentoPublicoAtivo: true, fuso: 'America/Sao_Paulo',
};
/** Erros por campo, ou `undefined` quando a gravação dá certo. */
const erros = (tenantId: string, extra: Record<string, unknown>) =>
  atualizarPerfil(tenantId, { ...valido, ...extra }, app.db).then(
    () => undefined,
    (e: unknown) => (e as PerfilError).erros,
  );
async function novoTenant() {
  const [t] = await app.db.insert(tenants).values({ slug: `marca-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Marca' }).returning();
  return t;
}

describe('contrasteComBranco (WCAG, US-005)', () => {
  it('limite de 4,5:1', () => {
    expect(contrasteComBranco('#2E7D32')).toBeGreaterThan(5.1);
    expect(contrasteComBranco('#767676')).toBeGreaterThanOrEqual(4.5);
    expect(contrasteComBranco('#777777')).toBeLessThan(4.5);
    expect(contrasteComBranco('#FFEB3B')).toBeLessThan(4.5);
  });
});

describe('atualizarPerfil (US-005)', () => {
  it('grava os campos; endereço e link vazios viram nulo', async () => {
    const t = await novoTenant();
    await atualizarPerfil(t.id, valido, app.db);
    const [r] = await app.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(r).toMatchObject({ nomeExibicao: 'Debby Silva', crn: 'CRN-3 12345', corPrimaria: '#2E7D32', antecedenciaMinH: 12, cancelamentoMinH: 24, agendamentoPublicoAtivo: true });
    await atualizarPerfil(t.id, { ...valido, enderecoConsultorio: ' ', linkOnlinePadrao: '', agendamentoPublicoAtivo: false }, app.db);
    const [r2] = await app.db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(r2).toMatchObject({ enderecoConsultorio: null, linkOnlinePadrao: null, agendamentoPublicoAtivo: false });
  });

  it('mensagens exatas', async () => {
    const t = await novoTenant();
    expect(await erros(t.id, { corPrimaria: '#FFEB3B' })).toEqual({ corPrimaria: 'Cor muito clara para texto branco' });
    expect(await erros(t.id, { corPrimaria: 'verde' })).toEqual({ corPrimaria: 'Use o formato #RRGGBB' });
    for (const h of ['73', '-1', '1.5', '']) expect(await erros(t.id, { antecedenciaMinH: h })).toEqual({ antecedenciaMinH: 'Informe um número inteiro de 0 a 72' });
    expect(await erros(t.id, { cancelamentoMinH: '0' })).toBeUndefined();
    expect(await erros(t.id, { linkOnlinePadrao: 'http://meet.exemplo.com' })).toEqual({ linkOnlinePadrao: 'Informe um link que comece com https://' });
    expect(await erros(t.id, { fuso: 'Marte/Base' })).toEqual({ fuso: 'Fuso horário inválido' });
    expect(await erros(t.id, { crn: 'X' })).toEqual({ crn: 'CRN inválido. Ex.: CRN-3 12345' });
  });
});

describe('getTenantBrand', () => {
  it('cor padrão sem cor definida; logo por URL assinada', async () => {
    const t = await novoTenant();
    expect(getTenantBrand(t)).toEqual({ nome: 'Marca', cor: COR_PADRAO, logoUrl: null });
    const comLogo = { ...t, corPrimaria: '#2E7D32', logoPath: `${t.id}/logo/${randomUUID()}.png` };
    expect(getTenantBrand(comLogo).logoUrl).toMatch(/^\/api\/arquivos\?c=/);
    expect(getTenantBrand(comLogo).cor).toBe('#2E7D32');
  });
});
```

Run: `pnpm test src/modules/plataforma/marca.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — `src/modules/plataforma/marca.ts`

```ts
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, type Db } from '@/db/client';
import { tenants, type TenantRow } from '@/db/schema';
import { signFileUrl } from '@/lib/signed-url';
import { primeiroErroPorCampo } from '@/lib/validacao';
import { crnSchema, nomeExibicaoSchema } from './contas';

export const COR_PADRAO = '#047857';

export const MSG_MARCA = {
  cor: 'Cor muito clara para texto branco',
  corFormato: 'Use o formato #RRGGBB',
  horas: 'Informe um número inteiro de 0 a 72',
  link: 'Informe um link que comece com https://',
  fuso: 'Fuso horário inválido',
  endereco: 'Use no máximo 200 caracteres',
} as const;

/** Fusos do Brasil oferecidos na tela (RN-06); qualquer IANA válido é aceito pelo schema. */
export const FUSOS_BRASIL = [
  'America/Sao_Paulo', 'America/Bahia', 'America/Fortaleza', 'America/Recife', 'America/Maceio', 'America/Belem',
  'America/Araguaina', 'America/Santarem', 'America/Manaus', 'America/Cuiaba', 'America/Campo_Grande',
  'America/Porto_Velho', 'America/Boa_Vista', 'America/Rio_Branco', 'America/Noronha',
] as const;

/** Razão de contraste WCAG 2.1 entre a cor e o branco. */
export function contrasteComBranco(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

const horas = z.string().trim().regex(/^\d{1,2}$/, MSG_MARCA.horas).transform(Number).pipe(z.number().max(72, MSG_MARCA.horas));
const opcional = (v: string) => (v === '' ? null : v);

export const perfilSchema = z.object({
  nomeExibicao: nomeExibicaoSchema,
  crn: crnSchema,
  corPrimaria: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, MSG_MARCA.corFormato)
    .refine((c) => contrasteComBranco(c) >= 4.5, MSG_MARCA.cor),
  enderecoConsultorio: z.string().trim().max(200, MSG_MARCA.endereco).transform(opcional),
  linkOnlinePadrao: z
    .string()
    .trim()
    .refine((v) => v === '' || (/^https:\/\/\S+$/.test(v) && URL.canParse(v)), MSG_MARCA.link)
    .transform(opcional),
  antecedenciaMinH: horas,
  cancelamentoMinH: horas,
  agendamentoPublicoAtivo: z.boolean(),
  fuso: z.string().refine((f) => Intl.supportedValuesOf('timeZone').includes(f), MSG_MARCA.fuso),
});

export type ErrosPerfil = Partial<Record<keyof z.input<typeof perfilSchema> | 'geral', string>>;

export class PerfilError extends Error {
  override name = 'PerfilError';
  constructor(readonly erros: ErrosPerfil) {
    super('Perfil inválido');
  }
}

/** US-005. `tenants` não tem RLS: o tenantId vem sempre da sessão (requireNutri), nunca do formulário. */
export async function atualizarPerfil(tenantId: string, input: Record<string, unknown>, db: Db = getDb()): Promise<void> {
  const p = perfilSchema.safeParse(input);
  if (!p.success) throw new PerfilError(primeiroErroPorCampo(p.error));
  await db.update(tenants).set({ ...p.data, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}

export type MarcaTenant = { nome: string; cor: string; logoUrl: string | null };

/** Marca da nutricionista (US-005 "Marca aplicada"): painel agora; PWA (Plano 06) e PDF (P04-09) depois. */
export function getTenantBrand(tenant: TenantRow): MarcaTenant {
  return {
    nome: tenant.nomeExibicao,
    cor: tenant.corPrimaria ?? COR_PADRAO,
    logoUrl: tenant.logoPath ? signFileUrl(tenant.logoPath) : null,
  };
}
```

Run: `pnpm test src/modules/plataforma/marca.test.ts` → PASS (5 testes).

- [ ] **Step 4: Testes que falham do logo** — `src/modules/plataforma/logo.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getEnv } from '@/env';
import { detectarTipo } from '@/lib/file-type';
import { TipoNaoPermitidoError } from './armazenamento';
import { processarLogo, trocarLogo } from './logo';

afterAll(() => closeDb());
const imagem = (w: number, h: number, formato: 'png' | 'jpeg') =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#2E7D32' } })[formato]().toBuffer();
const SVG_COM_SCRIPT = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script><rect width="64" height="64" fill="#2E7D32"/></svg>',
);

describe('processarLogo (US-005: PNG/JPEG/SVG, máx. 512 px)', () => {
  it('reduz para caber em 512 px e devolve PNG', async () => {
    const out = await processarLogo(await imagem(1024, 600, 'jpeg'));
    expect(detectarTipo(out)?.ext).toBe('png');
    expect(await sharp(out).metadata()).toMatchObject({ width: 512, height: 300 });
  });
  it('não aumenta imagem pequena', async () => {
    expect(await sharp(await processarLogo(await imagem(100, 80, 'png'))).metadata()).toMatchObject({ width: 100, height: 80 });
  });
  it('SVG com <script> vira PNG sem script (Review Focus 3)', async () => {
    const out = await processarLogo(SVG_COM_SCRIPT);
    expect(detectarTipo(out)?.ext).toBe('png');
    expect(out.includes('script')).toBe(false);
  });
  it('PDF, HTML e imagem corrompida são recusados', async () => {
    for (const b of [Buffer.from('%PDF-1.4'), Buffer.from('<html></html>'), Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)])]) {
      await expect(processarLogo(b)).rejects.toBeInstanceOf(TipoNaoPermitidoError);
    }
  });
});

describe('trocarLogo', () => {
  it('grava o novo, aponta tenants.logo_path e apaga o anterior (a cota só conta o atual)', async () => {
    const [t] = await getDb().insert(tenants).values({ slug: `logo-${randomUUID().slice(0, 8)}`, nomeExibicao: 'Logo' }).returning();
    const ctx = { tenantId: t.id, role: 'nutri' as const };
    const primeiro = await trocarLogo(ctx, await imagem(300, 300, 'png'));
    const segundo = await trocarLogo(ctx, await imagem(200, 200, 'png'));
    const [r] = await getDb().select().from(tenants).where(eq(tenants.id, t.id));
    expect(r.logoPath).toBe(segundo);
    expect(() => readFileSync(path.join(getEnv().DATA_DIR, primeiro))).toThrow();
    expect(r.armazenamentoBytes).toBe(readFileSync(path.join(getEnv().DATA_DIR, segundo)).length);
  });
});
```

Run: `pnpm test src/modules/plataforma/logo.test.ts` → FAIL.

- [ ] **Step 5: Implementar** — `src/modules/plataforma/logo.ts`

```ts
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { getDb, type Db } from '@/db/client';
import { tenants } from '@/db/schema';
import type { TenantContext } from '@/db/tenant';
import { detectarTipo } from '@/lib/file-type';
import { apagarArquivo, salvarArquivo, TipoNaoPermitidoError } from './armazenamento';

export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // US-005: ≤ 2 MB
export const LOGO_LADO_MAX = 512;
export const MSG_LOGO_GRANDE = 'O logo pode ter no máximo 2 MB.';

/**
 * Sempre devolve PNG de no máximo 512 px, sem metadados (EXIF). O SVG é rasterizado:
 * script e referências externas não sobrevivem, e nunca guardamos SVG (RNF-06).
 */
export async function processarLogo(conteudo: Buffer): Promise<Buffer> {
  const tipo = detectarTipo(conteudo);
  if (!tipo || !['png', 'jpg', 'svg'].includes(tipo.ext)) throw new TipoNaoPermitidoError();
  try {
    return await sharp(conteudo, { density: tipo.ext === 'svg' ? 300 : 72, limitInputPixels: 40_000_000, failOn: 'error' })
      .rotate()
      .resize(LOGO_LADO_MAX, LOGO_LADO_MAX, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw new TipoNaoPermitidoError(); // imagem corrompida ou que o decodificador recusa
  }
}

export async function trocarLogo(ctx: TenantContext, conteudo: Buffer, deps: { db?: Db; dataDir?: string } = {}): Promise<string> {
  const db = deps.db ?? getDb();
  const png = await processarLogo(conteudo);
  const salvo = await salvarArquivo(ctx, { tipo: 'logo', conteudo: png, permitidos: ['png'] }, deps);
  const [antes] = await db.select({ logoPath: tenants.logoPath }).from(tenants).where(eq(tenants.id, ctx.tenantId));
  await db.update(tenants).set({ logoPath: salvo.caminho, updatedAt: new Date() }).where(eq(tenants.id, ctx.tenantId));
  if (antes?.logoPath && antes.logoPath !== salvo.caminho) await apagarArquivo(ctx, { caminho: antes.logoPath }, deps);
  return salvo.caminho;
}
```

`src/lib/corpo.ts`

```ts
export class CorpoGrandeError extends Error {
  override name = 'CorpoGrandeError';
}

/** Lê o corpo da requisição parando assim que passar de `max` bytes (não confia no Content-Length). */
export async function lerCorpoLimitado(req: Request, max: number): Promise<Buffer> {
  if (!req.body) return Buffer.alloc(0);
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await leitor.cancel();
      throw new CorpoGrandeError();
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}
```

Run: `pnpm test src/modules/plataforma/logo.test.ts` → PASS (5 testes).

- [ ] **Step 6: Rota do logo** — teste `src/app/api/painel/marca/logo/route.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { registrarAceiteDpa } from '@/modules/plataforma/dpa';
import { criarEEntrar } from '../../../../../../test/sessao';
import { POST } from './route';

const db = getDb();
const auth = getAuth();
afterAll(() => closeDb());
const enviar = (corpo: Buffer, headers: Record<string, string> = {}) =>
  POST(new Request('http://localhost:3000/api/painel/marca/logo', { method: 'POST', headers, body: corpo }));
const png = () => sharp({ create: { width: 800, height: 400, channels: 3, background: '#2E7D32' } }).png().toBuffer();

async function nutriComDpa() {
  const [t] = await db.insert(tenants).values({ slug: `rl-${randomUUID().slice(0, 8)}`, nomeExibicao: 'RL' }).returning();
  const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
  await registrarAceiteDpa(db, { userId: n.id, tenantId: t.id, ip: null });
  return { t, cookie: n.cookie };
}

describe('POST /api/painel/marca/logo', () => {
  it('sem sessão 401; admin 403 (US-004 "Admin não vê prontuário")', async () => {
    expect((await enviar(await png())).status).toBe(401);
    const a = await criarEEntrar(db, auth, { appRole: 'admin', twoFactorEnabled: true });
    expect((await enviar(await png(), { cookie: a.cookie })).status).toBe(403);
  });

  it('nutricionista envia PNG: vira logo de até 512 px', async () => {
    const { t, cookie } = await nutriComDpa();
    const res = await enviar(await png(), { cookie, origin: 'http://localhost:3000' });
    expect(res.status).toBe(200);
    const [r] = await db.select().from(tenants).where(eq(tenants.id, t.id));
    expect(r.logoPath).toMatch(new RegExp(`^${t.id}/logo/.+\\.png$`));
  });

  it('mais de 2 MB → 413; tipo errado → 415; outra origem → 403', async () => {
    const { cookie } = await nutriComDpa();
    const grande = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2 * 1024 * 1024)]);
    const r413 = await enviar(grande, { cookie });
    expect(r413.status).toBe(413);
    expect(await r413.json()).toEqual({ erro: 'O logo pode ter no máximo 2 MB.' });
    expect((await enviar(Buffer.from('<html><script>x</script></html>'), { cookie })).status).toBe(415);
    expect((await enviar(await png(), { cookie, origin: 'https://evil.example' })).status).toBe(403);
  });

  it('sem o DPA aceito → 403', async () => {
    const [t] = await db.insert(tenants).values({ slug: `rl-${randomUUID().slice(0, 8)}`, nomeExibicao: 'RL' }).returning();
    const n = await criarEEntrar(db, auth, { appRole: 'nutri', tenantId: t.id });
    expect((await enviar(await png(), { cookie: n.cookie })).status).toBe(403);
  });
});
```

Run: `pnpm test src/app/api/painel` → FAIL. Implementar `src/app/api/painel/marca/logo/route.ts`:

```ts
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { tenants } from '@/db/schema';
import { getEnv } from '@/env';
import { requireApiUser } from '@/lib/api-auth';
import { CorpoGrandeError, lerCorpoLimitado } from '@/lib/corpo';
import { clientIp } from '@/lib/ip';
import { CotaEsgotadaError, MSG_COTA_ESGOTADA, TipoNaoPermitidoError } from '@/modules/plataforma/armazenamento';
import { DPA_VERSAO } from '@/modules/plataforma/dpa';
import { LOGO_MAX_BYTES, MSG_LOGO_GRANDE, trocarLogo } from '@/modules/plataforma/logo';

export const dynamic = 'force-dynamic';

const json = (status: number, erro: string) => Response.json({ erro }, { status, headers: { 'cache-control': 'no-store' } });

/** Corpo = o arquivo cru (fetch com body: File). Fora do proxy.ts, que não bufferiza /api. */
export async function POST(req: Request) {
  const env = getEnv();
  const origem = req.headers.get('origin');
  if (origem && origem !== new URL(env.APP_URL).origin) return json(403, 'Acesso negado');
  const auth = await requireApiUser(req, ['nutri']);
  if (!auth.ok) return auth.response;
  const tenantId = (auth.data.user as { tenantId?: string | null }).tenantId;
  if (!tenantId) return json(403, 'Acesso negado');
  const [t] = await getDb().select({ dpaVersao: tenants.dpaVersao }).from(tenants).where(eq(tenants.id, tenantId));
  if (t?.dpaVersao !== DPA_VERSAO) return json(403, 'Aceite o contrato de tratamento de dados para continuar.');

  if (Number(req.headers.get('content-length') ?? 0) > LOGO_MAX_BYTES) return json(413, MSG_LOGO_GRANDE);
  let conteudo: Buffer;
  try {
    conteudo = await lerCorpoLimitado(req, LOGO_MAX_BYTES);
  } catch (e) {
    if (e instanceof CorpoGrandeError) return json(413, MSG_LOGO_GRANDE);
    throw e;
  }
  try {
    await trocarLogo({ tenantId, role: 'nutri', actorUserId: auth.data.user.id, ip: clientIp(req.headers, env.TRUSTED_PROXIES) }, conteudo);
  } catch (e) {
    if (e instanceof TipoNaoPermitidoError) return json(415, 'Envie o logo em PNG, JPEG ou SVG.');
    if (e instanceof CotaEsgotadaError) return json(507, MSG_COTA_ESGOTADA);
    throw e;
  }
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
}
```

Run: `pnpm test src/app/api/painel` → PASS (4 testes).

- [ ] **Step 7: Tela de configurações** — `src/app/painel/actions.ts`, acrescentar os imports `import { revalidatePath } from 'next/cache';` e `import { atualizarPerfil, PerfilError, type ErrosPerfil } from '@/modules/plataforma/marca';`, e:

```ts
export type PerfilState = { erros?: ErrosPerfil; ok?: boolean };

export async function salvarPerfilAction(_prev: PerfilState, formData: FormData): Promise<PerfilState> {
  const { tenant } = await requireNutri('/painel/configuracoes');
  const campo = (k: string) => String(formData.get(k) ?? '');
  try {
    await atualizarPerfil(tenant.id, {
      nomeExibicao: campo('nomeExibicao'),
      crn: campo('crn'),
      corPrimaria: campo('corPrimaria'),
      enderecoConsultorio: campo('enderecoConsultorio'),
      linkOnlinePadrao: campo('linkOnlinePadrao'),
      antecedenciaMinH: campo('antecedenciaMinH'),
      cancelamentoMinH: campo('cancelamentoMinH'),
      agendamentoPublicoAtivo: formData.get('agendamentoPublicoAtivo') === 'on',
      fuso: campo('fuso'),
    });
  } catch (e) {
    if (e instanceof PerfilError) return { erros: e.erros };
    throw e;
  }
  revalidatePath('/painel', 'layout');
  return { ok: true };
}
```

`src/app/painel/configuracoes/perfil-form.tsx`

```tsx
'use client';

import { useActionState } from 'react';
import { Campo } from '@/components/campo';
import type { TenantRow } from '@/db/schema';
import { FUSOS_BRASIL } from '@/modules/plataforma/marca';
import { salvarPerfilAction, type PerfilState } from '../actions';

export function PerfilForm({ tenant }: { tenant: TenantRow }) {
  const [state, action, pendente] = useActionState<PerfilState, FormData>(salvarPerfilAction, {});
  const e = state.erros ?? {};
  return (
    <form action={action} className="space-y-4">
      <Campo id="nomeExibicao" rotulo="Nome de exibição" required defaultValue={tenant.nomeExibicao} erro={e.nomeExibicao} />
      <Campo id="crn" rotulo="CRN" required defaultValue={tenant.crn ?? ''} erro={e.crn} dica="Ex.: CRN-3 12345" />
      <Campo id="corPrimaria" rotulo="Cor principal" required defaultValue={tenant.corPrimaria ?? '#047857'} erro={e.corPrimaria}
        dica="Formato #RRGGBB. O texto sobre a cor é branco, então ela precisa de contraste de pelo menos 4,5:1." />
      <Campo id="enderecoConsultorio" rotulo="Endereço do consultório" defaultValue={tenant.enderecoConsultorio ?? ''} erro={e.enderecoConsultorio} />
      <Campo id="linkOnlinePadrao" rotulo="Link padrão da consulta online" type="url" defaultValue={tenant.linkOnlinePadrao ?? ''} erro={e.linkOnlinePadrao} />
      <Campo id="antecedenciaMinH" rotulo="Antecedência mínima para agendar (horas)" inputMode="numeric" defaultValue={String(tenant.antecedenciaMinH)} erro={e.antecedenciaMinH} />
      <Campo id="cancelamentoMinH" rotulo="Cancelar ou remarcar até (horas antes)" inputMode="numeric" defaultValue={String(tenant.cancelamentoMinH)} erro={e.cancelamentoMinH} />
      <div className="space-y-1">
        <label htmlFor="fuso" className="block font-medium">Fuso horário</label>
        <select id="fuso" name="fuso" defaultValue={tenant.fuso} aria-invalid={e.fuso ? true : undefined} aria-describedby={e.fuso ? 'fuso-erro' : undefined} className="w-full rounded border p-2">
          {FUSOS_BRASIL.map((f) => <option key={f} value={f}>{f.replace('America/', '').replace('_', ' ')}</option>)}
        </select>
        {e.fuso && <p id="fuso-erro" role="alert" className="text-sm text-red-700">{e.fuso}</p>}
      </div>
      <div className="flex items-center gap-2">
        <input id="agendamentoPublicoAtivo" name="agendamentoPublicoAtivo" type="checkbox" defaultChecked={tenant.agendamentoPublicoAtivo} />
        <label htmlFor="agendamentoPublicoAtivo">Permitir agendamento pela página pública</label>
      </div>
      {state.ok && <p role="status">Perfil salvo.</p>}
      <button disabled={pendente} className="rounded bg-emerald-700 px-4 py-2 text-white">Salvar perfil</button>
    </form>
  );
}
```

`src/app/painel/configuracoes/logo-form.tsx`

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoForm() {
  const router = useRouter();
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro('');
    setOk(false);
    const arquivo = (e.currentTarget.elements.namedItem('logo') as HTMLInputElement).files?.[0];
    if (!arquivo) return setErro('Escolha um arquivo.');
    if (arquivo.size > 2 * 1024 * 1024) return setErro('O logo pode ter no máximo 2 MB.');
    setEnviando(true);
    const res = await fetch('/api/painel/marca/logo', { method: 'POST', body: arquivo });
    setEnviando(false);
    if (!res.ok) {
      const corpo = (await res.json().catch(() => ({}))) as { erro?: string };
      return setErro(corpo.erro ?? 'Não foi possível enviar o logo.');
    }
    setOk(true);
    router.refresh();
  }

  return (
    <form onSubmit={enviar} className="space-y-2">
      <label htmlFor="logo" className="block font-medium">Logo</label>
      <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml" aria-describedby="logo-dica" />
      <p id="logo-dica" className="text-sm text-zinc-600">PNG, JPEG ou SVG de até 2 MB. O logo é reduzido para no máximo 512 px.</p>
      {erro && <p role="alert" className="text-red-700">{erro}</p>}
      {ok && <p role="status">Logo atualizado.</p>}
      <button disabled={enviando} className="rounded bg-emerald-700 px-4 py-2 text-white">Enviar logo</button>
    </form>
  );
}
```

`src/app/painel/configuracoes/page.tsx`

```tsx
import { requireNutri } from '@/lib/tenant-session';
import { Cabecalho } from '../cabecalho';
import { LogoForm } from './logo-form';
import { PerfilForm } from './perfil-form';

export const dynamic = 'force-dynamic';

export default async function ConfiguracoesPage() {
  const { tenant } = await requireNutri('/painel/configuracoes');
  return (
    <>
      <Cabecalho tenant={tenant} />
      <main className="mx-auto max-w-lg space-y-8 p-6">
        <h1 className="text-2xl font-semibold">Perfil e marca</h1>
        <LogoForm />
        <PerfilForm tenant={tenant} />
      </main>
    </>
  );
}
```

`src/app/painel/cabecalho.tsx` inteiro (marca aplicada):

```tsx
import Link from 'next/link';
import type { TenantRow } from '@/db/schema';
import { getTenantBrand } from '@/modules/plataforma/marca';

export function Cabecalho({ tenant }: { tenant: TenantRow }) {
  const marca = getTenantBrand(tenant);
  return (
    <header className="flex items-center justify-between px-6 py-3 text-white" style={{ backgroundColor: marca.cor }}>
      <div className="flex items-center gap-3">
        {marca.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- URL assinada de 5 min, fora do otimizador de imagens
          <img src={marca.logoUrl} alt={`Logo de ${marca.nome}`} className="h-10 w-auto rounded bg-white p-1" />
        )}
        <p className="text-lg font-semibold">{marca.nome}</p>
      </div>
      <nav aria-label="Menu do painel" className="flex gap-4 text-sm">
        <Link href="/painel">Início</Link>
        <Link href="/painel/configuracoes">Perfil e marca</Link>
        <Link href="/conta/seguranca">Segurança</Link>
      </nav>
    </header>
  );
}
```

- [ ] **Step 8: E2E** — acrescentar ao final de `e2e/plataforma.spec.ts`:

```ts
// PNG 1×1 válido
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('perfil e marca: contraste recusado, cor e logo aplicados ao painel (US-005)', async ({ browser }) => {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '10.9.3.5' } });
  const page = await ctx.newPage();
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(NUTRI.email);
  await page.getByLabel('Senha').fill(NUTRI.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await page.getByRole('link', { name: 'Perfil e marca' }).click();

  await page.getByLabel('Cor principal').fill('#FFEB3B');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByText('Cor muito clara para texto branco')).toBeVisible();
  await page.getByLabel('Cor principal').fill('#2E7D32');
  await page.getByRole('button', { name: 'Salvar perfil' }).click();
  await expect(page.getByRole('status')).toHaveText('Perfil salvo.');

  await page.getByLabel('Logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 });
  await page.getByRole('button', { name: 'Enviar logo' }).click();
  await expect(page.getByText('Logo atualizado.')).toBeVisible();
  const banner = page.getByRole('banner');
  await expect(banner).toHaveCSS('background-color', 'rgb(46, 125, 50)');
  await expect(banner.getByRole('img', { name: `Logo de ${NUTRI.nome}` })).toHaveAttribute('src', /^\/api\/arquivos\?c=/);
  await ctx.close();
});
```

- [ ] **Step 9: Rodar tudo e commit**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm e2e:seed && APP_URL=http://localhost:3100 pnpm test:e2e`
Expected: PASS.

```bash
git add package.json pnpm-lock.yaml src/modules/plataforma/marca.ts src/modules/plataforma/marca.test.ts src/modules/plataforma/logo.ts \
  src/modules/plataforma/logo.test.ts src/lib/corpo.ts src/app/api/painel src/app/painel e2e/plataforma.spec.ts
git commit -m "feat(marca): perfil com contraste WCAG, logo PNG/JPEG/SVG rasterizado em até 512 px e marca no painel (sharp 0.35.4)"
```

---
### Task 11: Turnstile validado no servidor — recuperação de senha agora, API pronta para `/n/<slug>` (P02-09)

**Files:**
- Create: `src/lib/turnstile.ts`, `src/lib/turnstile.test.ts`, `src/components/turnstile-widget.tsx`, `src/app/esqueci-senha/form.tsx`
- Modify: `src/env.ts`, `src/env.test.ts`, `test/setup.ts`, `.env.example`, `Dockerfile`, `.github/workflows/ci.yml` (env do `e2e`), `src/lib/auth.ts` (opção `verificarTurnstile` + hook), `src/lib/auth.test.ts`, `src/app/esqueci-senha/page.tsx`, `e2e/recuperacao.spec.ts`

**Interfaces:**
- Consumes: `clientIp` (Tarefa 1); `createAuth` (Plano 01).
- Produces:
  - `Env` ganha `TURNSTILE_SITE_KEY: string` e `TURNSTILE_SECRET_KEY: string`.
  - `@/lib/turnstile`: `TURNSTILE_SITEVERIFY`, `MSG_TURNSTILE_FORA = 'Tente novamente em alguns minutos'`, `MSG_TURNSTILE_INVALIDO = 'Confirme que você não é um robô.'`, `type ResultadoTurnstile = 'ok' | 'invalido' | 'indisponivel'`, `verifyTurnstile(token, opts: { secret; ip?; fetchImpl?; timeoutMs? }): Promise<ResultadoTurnstile>` — **o P05-04 usa esta mesma função** na página pública antes de qualquer escrita.
  - `createAuth(db, { …, verificarTurnstile?: (token: string | null, ip: string | null) => Promise<ResultadoTurnstile> })`; `POST /api/auth/request-password-reset` por HTTP exige o cabeçalho `x-turnstile-token` (403 `TURNSTILE_INVALIDO`, 503 `TURNSTILE_INDISPONIVEL`); chamadas internas (`auth.api.*`, ex.: `admin:criar`) não passam pelo widget.
  - `@/components/turnstile-widget`: `<TurnstileWidget siteKey onToken={(t: string | null) => void} onIndisponivel={() => void} />`.
  - Chaves de teste oficiais da Cloudflare: site key `1x00000000000000000000AA` (sempre passa), secret `1x0000000000000000000000000000000AA` (sempre passa) e `2x0000000000000000000000000000000AA` (sempre falha).

- [ ] **Step 1: Ambiente** — em `src/env.test.ts`, acrescentar ao `base`: `TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA'`, e o teste:

```ts
  it('exige as chaves do Turnstile (INT-06)', () => {
    expect(() => parseEnv({ ...base, TURNSTILE_SECRET_KEY: undefined })).toThrow(/TURNSTILE_SECRET_KEY/);
    expect(() => parseEnv({ ...base, TURNSTILE_SITE_KEY: '' })).toThrow(/TURNSTILE_SITE_KEY/);
  });
```

Em `src/env.ts`, no `appSchema.extend({…})`:

```ts
    TURNSTILE_SITE_KEY: z.string({ message: 'TURNSTILE_SITE_KEY é obrigatória' }).min(1, { message: 'TURNSTILE_SITE_KEY é obrigatória' }),
    TURNSTILE_SECRET_KEY: z.string({ message: 'TURNSTILE_SECRET_KEY é obrigatória' }).min(1, { message: 'TURNSTILE_SECRET_KEY é obrigatória' }),
```

`test/setup.ts`:

```ts
// Chaves de teste oficiais da Cloudflare (sempre passa); os testes de unidade injetam o verificador
process.env.TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
```

`.env.example` (seção do Plano 02; remover as duas linhas de "Planos seguintes"):

```bash
# app: Turnstile (INT-06). Em dev, as chaves de teste da Cloudflare que sempre passam:
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

`Dockerfile`, no `ENV` do estágio `build`: `TURNSTILE_SITE_KEY=build-only \` e `TURNSTILE_SECRET_KEY=build-only`. `ci.yml`, no `env:` do `e2e`:

```yaml
      TURNSTILE_SITE_KEY: 1x00000000000000000000AA
      TURNSTILE_SECRET_KEY: 1x0000000000000000000000000000000AA
```

Run: `pnpm test src/env.test.ts` → PASS.

- [ ] **Step 2: Testes que falham da verificação** — `src/lib/turnstile.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { TURNSTILE_SITEVERIFY, verifyTurnstile } from './turnstile';

const resposta = (corpo: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
const secret = '1x0000000000000000000000000000000AA';

describe('verifyTurnstile (INT-06)', () => {
  it('sem token nem chama a Cloudflare', async () => {
    const f = resposta({ success: true });
    expect(await verifyTurnstile(null, { secret, fetchImpl: f })).toBe('invalido');
    expect(await verifyTurnstile('', { secret, fetchImpl: f })).toBe('invalido');
    expect(f).not.toHaveBeenCalled();
  });
  it('sucesso: manda secret, token e IP ao siteverify', async () => {
    const f = resposta({ success: true });
    expect(await verifyTurnstile('tok', { secret, ip: '203.0.113.9', fetchImpl: f })).toBe('ok');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY);
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(new URLSearchParams(init.body as URLSearchParams))).toEqual({ secret, response: 'tok', remoteip: '203.0.113.9' });
  });
  it('token recusado → invalido', async () => {
    expect(await verifyTurnstile('tok', { secret, fetchImpl: resposta({ success: false, 'error-codes': ['invalid-input-response'] }) })).toBe('invalido');
  });
  it('Cloudflare fora do ar (erro interno, HTTP 5xx, rede, tempo esgotado) → indisponivel', async () => {
    expect(await verifyTurnstile('tok', { secret, fetchImpl: resposta({ success: false, 'error-codes': ['internal-error'] }) })).toBe('indisponivel');
    expect(await verifyTurnstile('tok', { secret, fetchImpl: resposta({}, 502) })).toBe('indisponivel');
    expect(await verifyTurnstile('tok', { secret, fetchImpl: vi.fn(async () => { throw new TypeError('fetch failed'); }) })).toBe('indisponivel');
    const trava = vi.fn((_u: string, init?: RequestInit) =>
      new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abortado')))));
    expect(await verifyTurnstile('tok', { secret, fetchImpl: trava as unknown as typeof fetch, timeoutMs: 20 })).toBe('indisponivel');
  });
});
```

Run: `pnpm test src/lib/turnstile.test.ts` → FAIL.

- [ ] **Step 3: Implementar** — `src/lib/turnstile.ts`

```ts
export const TURNSTILE_SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MSG_TURNSTILE_FORA = 'Tente novamente em alguns minutos'; // INT-06
export const MSG_TURNSTILE_INVALIDO = 'Confirme que você não é um robô.';

export type ResultadoTurnstile = 'ok' | 'invalido' | 'indisponivel';

/**
 * INT-06: valida o token no servidor antes de qualquer escrita. Fora do ar = 'indisponivel'
 * (o formulário mostra "Tente novamente em alguns minutos" e NÃO segue sem verificação).
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  opts: { secret: string; ip?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<ResultadoTurnstile> {
  if (!token || token.length > 2048) return 'invalido';
  const corpo = new URLSearchParams({ secret: opts.secret, response: token });
  if (opts.ip) corpo.set('remoteip', opts.ip);
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(TURNSTILE_SITEVERIFY, {
      method: 'POST',
      body: corpo,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
  } catch {
    return 'indisponivel';
  }
  if (!res.ok) return 'indisponivel';
  const dados = (await res.json().catch(() => null)) as { success?: boolean; 'error-codes'?: string[] } | null;
  if (!dados) return 'indisponivel';
  if (dados.success === true) return 'ok';
  return dados['error-codes']?.includes('internal-error') ? 'indisponivel' : 'invalido';
}
```

Run: `pnpm test src/lib/turnstile.test.ts` → PASS (4 testes).

- [ ] **Step 4: Testes que falham no Better Auth** — em `src/lib/auth.test.ts`: trocar `const auth = createAuth(app.db);` por `const auth = createAuth(app.db, { verificarTurnstile: async () => 'ok' });` (os testes antigos não tratam do widget), importar `type ResultadoTurnstile` de `./turnstile` e `type Auth` de `./auth`, e acrescentar:

```ts
describe('Turnstile na recuperação de senha (INT-06)', () => {
  const pedir = (a: Auth, ip: string, token?: string) =>
    a.handler(
      new Request('http://localhost:3000/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'x-forwarded-for': ip, ...(token ? { 'x-turnstile-token': token } : {}) },
        body: JSON.stringify({ email, redirectTo: '/definir-senha' }),
      }),
    );
  const com = (r: ResultadoTurnstile) => createAuth(app.db, { verificarTurnstile: vi.fn(async () => r) });

  it('token recusado → 403 TURNSTILE_INVALIDO', async () => {
    const res = await pedir(com('invalido'), '10.4.0.1', 'tok');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'TURNSTILE_INVALIDO', message: 'Confirme que você não é um robô.' });
  });

  it('Turnstile fora do ar → 503 "Tente novamente em alguns minutos", sem seguir', async () => {
    const res = await pedir(com('indisponivel'), '10.4.0.2', 'tok');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'TURNSTILE_INDISPONIVEL', message: 'Tente novamente em alguns minutos' });
  });

  it('o verificador recebe o token do cabeçalho e o IP do cliente', async () => {
    const verificar = vi.fn(async (): Promise<ResultadoTurnstile> => 'ok');
    const res = await pedir(createAuth(app.db, { verificarTurnstile: verificar }), '10.4.0.3', 'tok-123');
    expect(res.status).toBe(200);
    expect(verificar).toHaveBeenCalledWith('tok-123', '10.4.0.3');
  });

  it('chamada interna (auth.api, sem requisição HTTP) não passa pelo Turnstile — admin:criar', async () => {
    await expect(com('invalido').api.requestPasswordReset({ body: { email, redirectTo: '/definir-senha' } })).resolves.toMatchObject({ status: true });
  });
});
```

Run: `pnpm test src/lib/auth.test.ts` → FAIL (a opção não existe; os pedidos passam sem token).

- [ ] **Step 5: Implementar** — em `src/lib/auth.ts`:

Imports:

```ts
import { clientIp } from './ip';
import { MSG_TURNSTILE_FORA, MSG_TURNSTILE_INVALIDO, verifyTurnstile, type ResultadoTurnstile } from './turnstile';
```

Assinatura e padrões:

```ts
export function createAuth(
  db: Db,
  opts: {
    baseURL?: string;
    secret?: string;
    trustedProxies?: string[];
    /** Testes injetam; padrão = siteverify com TURNSTILE_SECRET_KEY. */
    verificarTurnstile?: (token: string | null, ip: string | null) => Promise<ResultadoTurnstile>;
  } = {},
) {
  const baseURL = opts.baseURL ?? getEnv().APP_URL;
  const trustedProxies = opts.trustedProxies ?? getEnv().TRUSTED_PROXIES;
  const verificarTurnstile =
    opts.verificarTurnstile ?? ((token: string | null, ip: string | null) => verifyTurnstile(token, { secret: getEnv().TURNSTILE_SECRET_KEY, ip }));
```

E o `hooks.before` inteiro:

```ts
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // INT-06: "Esqueci minha senha" pela web exige Turnstile válido antes de qualquer escrita.
        // Sem ctx.request = chamada interna (auth.api.*, ex.: admin:criar pelo terminal).
        if (ctx.path === '/request-password-reset') {
          if (!ctx.request) return;
          const r = await verificarTurnstile(ctx.request.headers.get('x-turnstile-token'), clientIp(ctx.request.headers, trustedProxies));
          if (r === 'indisponivel') throw new APIError('SERVICE_UNAVAILABLE', { code: 'TURNSTILE_INDISPONIVEL', message: MSG_TURNSTILE_FORA });
          if (r !== 'ok') throw new APIError('FORBIDDEN', { code: 'TURNSTILE_INVALIDO', message: MSG_TURNSTILE_INVALIDO });
          return;
        }
        if (ctx.path !== '/reset-password' && ctx.path !== '/change-password') return;
        const pw = (ctx.body as { newPassword?: unknown } | undefined)?.newPassword;
        const err = typeof pw === 'string' ? validatePasswordPolicy(pw, commonPasswords()) : 'Informe a nova senha.';
        if (err) throw new APIError('BAD_REQUEST', { message: err });
      }),
    },
```

`src/lib/auth.cli.ts` (instância só para o CLI do Better Auth) passa `verificarTurnstile: async () => 'ok'` junto das outras opções fixas, para não ler o ambiente.

Run: `pnpm test src/lib src/modules`
Expected: PASS (inclusive `admin-bootstrap.test.ts`, que chama `auth.api.requestPasswordReset` sem requisição HTTP).

- [ ] **Step 6: Widget e tela** — `src/components/turnstile-widget.tsx`

```tsx
'use client';

import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

type Turnstile = { render(el: HTMLElement, opcoes: Record<string, unknown>): string; remove(id: string): void };
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/** Widget do Cloudflare Turnstile (INT-06). O token só vale depois de validado no servidor. */
export function TurnstileWidget(props: { siteKey: string; onToken: (token: string | null) => void; onIndisponivel: () => void }) {
  const alvo = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (!pronto || !alvo.current || !window.turnstile) return;
    const id = window.turnstile.render(alvo.current, {
      sitekey: props.siteKey,
      language: 'pt-br',
      callback: (t: string) => callbacks.current.onToken(t),
      'expired-callback': () => callbacks.current.onToken(null),
      'error-callback': () => {
        callbacks.current.onToken(null);
        callbacks.current.onIndisponivel();
      },
    });
    return () => window.turnstile?.remove(id);
  }, [pronto, props.siteKey]);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setPronto(true)}
        onError={() => callbacks.current.onIndisponivel()}
      />
      <div ref={alvo} />
    </>
  );
}
```

`src/app/esqueci-senha/form.tsx`

```tsx
'use client';

import { useState } from 'react';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { authClient } from '@/lib/auth-client';

const FORA = 'Tente novamente em alguns minutos'; // INT-06
const ROBO = 'Confirme que você não é um robô.';

export function EsqueciSenhaForm({ siteKey }: { siteKey: string }) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const [widget, setWidget] = useState(0); // trocar a key recria o widget (token é de uso único)

  function recomecar(msg: string) {
    setErro(msg);
    setToken(null);
    setWidget((n) => n + 1);
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!token) return setErro(ROBO);
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/definir-senha',
      fetchOptions: { headers: { 'x-turnstile-token': token } },
    });
    if (error?.status === 503 || (error?.status ?? 0) >= 500) return recomecar(FORA);
    if (error?.status === 403) return recomecar(ROBO);
    if (error?.status === 429) return setErro('Muitas tentativas. Tente novamente em 15 minutos.');
    setEnviado(true); // mesma resposta para qualquer e-mail (US-002)
  }

  if (enviado) return <p role="status">Se o e-mail estiver cadastrado, você receberá um link</p>;
  return (
    <form onSubmit={enviar} className="space-y-3">
      <label htmlFor="email" className="block">E-mail</label>
      <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded border p-2" />
      <TurnstileWidget key={widget} siteKey={siteKey} onToken={setToken} onIndisponivel={() => setErro(FORA)} />
      {erro && <p role="alert" className="text-red-700">{erro}</p>}
      <button disabled={!token} className="w-full rounded bg-emerald-700 px-4 py-2 text-white disabled:opacity-60">Enviar link</button>
    </form>
  );
}
```

`src/app/esqueci-senha/page.tsx` inteiro (agora Server Component: a chave do site vem do ambiente do servidor):

```tsx
import { getEnv } from '@/env';
import { EsqueciSenhaForm } from './form';

export const dynamic = 'force-dynamic';

export default function EsqueciSenhaPage() {
  return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Recuperar senha</h1>
      <EsqueciSenhaForm siteKey={getEnv().TURNSTILE_SITE_KEY} />
    </main>
  );
}
```

- [ ] **Step 7: E2E com a chave de teste** — em `e2e/recuperacao.spec.ts`, entre o preenchimento do e-mail e o clique em "Enviar link":

```ts
  // Turnstile com a site key de teste da Cloudflare (sempre passa): espera o token chegar
  await expect(page.getByRole('button', { name: 'Enviar link' })).toBeEnabled({ timeout: 20_000 });
```

Run: `pnpm build && APP_URL=http://localhost:3100 pnpm test:e2e e2e/recuperacao.spec.ts` (com `.env.local` usando as chaves de teste)
Expected: 1 passed.

- [ ] **Step 8: Rodar tudo e commit**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS.

```bash
git add src/lib/turnstile.ts src/lib/turnstile.test.ts src/lib/auth.ts src/lib/auth.cli.ts src/lib/auth.test.ts src/components/turnstile-widget.tsx \
  src/app/esqueci-senha src/env.ts src/env.test.ts test/setup.ts .env.example Dockerfile .github/workflows/ci.yml e2e/recuperacao.spec.ts
git commit -m "feat(turnstile): validação no servidor com falha fechada; recuperação de senha protegida"
```

---

### Task 12: Backup diário no host — `pg_dump` + `rclone crypt` + retenção, testado no CI (P02-10a)

**Files:**
- Create: `scripts/backup/nutri-backup.sh`, `scripts/backup/nutri-backup.service`, `scripts/backup/nutri-backup.timer`, `scripts/backup/backup.env.example`, `drizzle/0013_backup_runs.sql` (gerada), `drizzle/0014_backup_runs_somente_leitura.sql` (custom), `test/backup.test.ts`
- Modify: `src/db/schema/platform.ts` (`backupRuns`), `test/global-setup.ts`, `.github/workflows/ci.yml` (job `test`), `CLAUDE.md`

**Interfaces:**
- Consumes: container Postgres do Testcontainers (id, usuário, banco) via `inject`.
- Produces:
  - Schema: `backupRuns` (`tipo` `'banco' | 'arquivos'`, `ok`, `bytes`, `detalhe`, `iniciadoEm`, `concluidoEm`) — escrita **só** pelo script do host (o role da aplicação só lê).
  - Script `scripts/backup/nutri-backup.sh` — variáveis: `NUTRI_DATA_DIR` (obrigatória), `NUTRI_BACKUP_REMOTE` (padrão `cripto:`), `NUTRI_DB_CONTAINER` ou `NUTRI_DB_CONTAINER_FILTER` (padrão `nutri_db`), `NUTRI_DB_USER` (padrão `postgres`), `NUTRI_DB_NAME` (padrão `nutri`), `NUTRI_BACKUP_TODAY` (só teste), `NUTRI_PG_DUMP_ARGS` (só teste) + `RCLONE_CONFIG_*`. Saída: 0 = tudo ok; ≠ 0 = número de etapas que falharam.
  - Remoto: `db/diario/nutri-AAAA-MM-DD.dump` (7), `db/semanal/…` (4, domingos), `data/atual/…`, `data/historico/AAAA-MM-DD/…` (30 dias).
  - Unidades systemd (instaladas na Tarefa 14).
  - `ProvidedContext`: `pgContainerId`, `pgUser`, `pgDatabase`.

- [ ] **Step 1: Tabela de execuções** — em `src/db/schema/platform.ts`:

```ts
/** Execuções do backup do host (RNF-05). Escrita só pelo script (superusuário local); o app só lê. */
export const backupRuns = pgTable(
  'backup_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tipo: text('tipo').notNull(),
    ok: boolean('ok').notNull(),
    bytes: bigint('bytes', { mode: 'number' }),
    detalhe: text('detalhe'),
    iniciadoEm: timestamp('iniciado_em', { withTimezone: true }).notNull(),
    concluidoEm: timestamp('concluido_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('backup_runs_tipo_valido', sql`${t.tipo} in ('banco', 'arquivos')`),
    index('backup_runs_tipo_idx').on(t.tipo, t.concluidoEm),
  ],
);
```

Run: `pnpm db:generate --name backup_runs` → `drizzle/0013_backup_runs.sql` com `CREATE TABLE "backup_runs"`, o CHECK e o índice.

Run: `pnpm drizzle-kit generate --custom --name backup_runs_somente_leitura` e preencher `drizzle/0014_backup_runs_somente_leitura.sql`:

```sql
-- Só o script do host (superusuário local no container nutri_db) registra backups
REVOKE INSERT, UPDATE, DELETE ON backup_runs FROM nutri_app_role;
```

- [ ] **Step 2: Dados do container para o teste** — em `test/global-setup.ts`, depois dos `project.provide` existentes:

```ts
  // Teste do script de backup (Tarefa 12): pg_dump e psql rodam DENTRO do container, como no host
  project.provide('pgContainerId', container.getId());
  project.provide('pgUser', container.getUsername());
  project.provide('pgDatabase', container.getDatabase());
```

e no `ProvidedContext`:

```ts
    pgContainerId: string;
    pgUser: string;
    pgDatabase: string;
```

- [ ] **Step 3: Testes que falham** — `test/backup.test.ts`

```ts
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from './db';

const execFile = promisify(execFileCb);
const temRclone = (() => {
  try {
    execFileSync('rclone', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
if (process.env.CI && !temRclone) throw new Error('rclone é obrigatório no CI (teste do backup, P02-10)');

const SCRIPT = path.resolve('scripts/backup/nutri-backup.sh');
const owner = makeDb(inject('ownerDatabaseUrl'));
let base = '';
let destino = '';
let dados = '';
let env: NodeJS.ProcessEnv = {};

beforeAll(() => {
  base = mkdtempSync(path.join(tmpdir(), 'nd-backup-'));
  destino = path.join(base, 'r2'); // o "bucket": pasta local por baixo do remoto crypt
  dados = path.join(base, 'data');
  mkdirSync(destino);
  mkdirSync(path.join(dados, 't1', 'logo'), { recursive: true });
  writeFileSync(path.join(dados, 't1', 'logo', 'a.png'), 'versao-1');
  writeFileSync(path.join(dados, 't1', 'logo', 'b.png'), 'sera-apagado');
  const senha = temRclone ? execFileSync('rclone', ['obscure', 'senha-de-teste-do-backup']).toString().trim() : '';
  env = {
    PATH: process.env.PATH,
    ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}), // mesmo Docker do Testcontainers
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
  };
});
afterAll(async () => {
  rmSync(base, { recursive: true, force: true });
  await owner.pool.end();
});

const rodar = (hoje: string, extra: Record<string, string> = {}) =>
  execFile('bash', [SCRIPT], { env: { ...env, NUTRI_BACKUP_TODAY: hoje, ...extra } }).then(
    () => 0,
    (e: { code?: number }) => e.code ?? 1,
  );
const lsf = async (p: string) => (await execFile('rclone', ['lsf', `cripto:${p}`], { env })).stdout.split('\n').filter(Boolean).sort();
const cat = async (p: string) => (await execFile('rclone', ['cat', `cripto:${p}`], { env, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })).stdout as Buffer;
const rcat = (p: string, conteudo: string) =>
  new Promise<void>((ok, falha) => {
    const c = execFileCb('rclone', ['rcat', `cripto:${p}`], { env }, (e) => (e ? falha(e) : ok()));
    c.stdin!.end(conteudo);
  });
const arquivosBrutos = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).map((d) => path.join(d.parentPath, d.name));
const execucoesDesde = async (desde: Date) =>
  (await owner.pool.query(`select tipo, ok from backup_runs where concluido_em >= $1 order by tipo`, [desde])).rows;

describe.skipIf(!temRclone)('backup diário no host (RNF-05)', () => {
  it('o script é bash válido', async () => {
    await expect(execFile('bash', ['-n', SCRIPT])).resolves.toBeTruthy();
  });

  it('domingo: dump cifrado no diário e no semanal, /data sincronizado, retenção 7+4, registro em backup_runs', async () => {
    for (let d = 20; d <= 27; d++) await rcat(`db/diario/nutri-2026-09-${d}.dump`, 'antigo'); // 8 diários antigos
    for (const d of ['2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']) await rcat(`db/semanal/nutri-${d}.dump`, 'antigo');
    const antes = new Date(Date.now() - 1000);
    expect(await rodar('2026-10-04')).toBe(0); // 04/10/2026 é domingo
    const diarios = await lsf('db/diario/');
    expect(diarios).toHaveLength(7);
    expect(diarios[0]).toBe('nutri-2026-09-22.dump');
    expect(diarios.at(-1)).toBe('nutri-2026-10-04.dump');
    expect(await lsf('db/semanal/')).toEqual(['nutri-2026-09-13.dump', 'nutri-2026-09-20.dump', 'nutri-2026-09-27.dump', 'nutri-2026-10-04.dump']);
    expect((await cat('db/diario/nutri-2026-10-04.dump')).subarray(0, 5).toString()).toBe('PGDMP');
    // No "R2" nada é legível: nomes e conteúdo cifrados
    const brutos = arquivosBrutos(destino);
    expect(brutos.some((f) => /nutri-|a\.png|diario/.test(path.relative(destino, f)))).toBe(false);
    expect(brutos.some((f) => readFileSync(f).includes('PGDMP'))).toBe(false);
    expect(await lsf('data/atual/t1/logo/')).toEqual(['a.png', 'b.png']);
    expect(await execucoesDesde(antes)).toEqual([{ tipo: 'arquivos', ok: true }, { tipo: 'banco', ok: true }]);
  });

  it('dia seguinte: alterado/apagado vai para o histórico datado; histórico com mais de 30 dias sai; segunda não gera semanal', async () => {
    writeFileSync(path.join(dados, 't1', 'logo', 'a.png'), 'versao-2');
    rmSync(path.join(dados, 't1', 'logo', 'b.png'));
    await rcat('data/historico/2026-08-01/velho.txt', 'x');
    expect(await rodar('2026-10-05')).toBe(0);
    expect(await lsf('data/atual/t1/logo/')).toEqual(['a.png']);
    expect((await cat('data/atual/t1/logo/a.png')).toString()).toBe('versao-2');
    expect(await lsf('data/historico/2026-10-05/t1/logo/')).toEqual(['a.png', 'b.png']);
    expect((await cat('data/historico/2026-10-05/t1/logo/a.png')).toString()).toBe('versao-1');
    expect(await lsf('data/historico/')).not.toContain('2026-08-01/');
    expect(await lsf('db/semanal/')).not.toContain('nutri-2026-10-05.dump');
  });

  it('falha no dump: registra ok=false, não deixa arquivo parcial, ainda copia /data e sai com erro', async () => {
    const antes = new Date(Date.now() - 1000);
    const codigo = await rodar('2026-10-06', { NUTRI_PG_DUMP_ARGS: '--table=tabela_que_nao_existe --strict-names' });
    expect(codigo).toBe(1);
    expect(await lsf('db/diario/')).not.toContain('nutri-2026-10-06.dump');
    expect(await execucoesDesde(antes)).toEqual([{ tipo: 'arquivos', ok: true }, { tipo: 'banco', ok: false }]);
  });
});
```

Run: `pnpm test test/backup.test.ts`
Expected: FAIL (script não existe) — ou SKIP local se o host ainda não tem `rclone` (E-10); no CI, obrigatório.

- [ ] **Step 4: Implementar o script** — `scripts/backup/nutri-backup.sh` (e `chmod +x`):

```bash
#!/usr/bin/env bash
# Backup diário do NutriDebby (RNF-05). Roda NO HOST via systemd (03:00 America/Sao_Paulo).
# Plano 02, Tarefas 12 e 14 (docs/superpowers/plans/2026-09-28-nutridebby-02-plataforma.md).
#  - banco: pg_dump -Fc DENTRO do container nutri_db (superusuário local) → rclone rcat no remoto crypt
#  - arquivos: rclone sync de /data com --backup-dir datado (alterados/apagados ficam 30 dias)
#  - retenção: 7 diários + 4 semanais (domingo); cada etapa grava uma linha em backup_runs
# Segredos só no ambiente (RCLONE_CONFIG_*, de /etc/nutri-backup/backup.env). Nada de segredo no log.
set -uo pipefail

: "${NUTRI_DATA_DIR:?defina NUTRI_DATA_DIR (pasta do volume /data no host)}"
REMOTO="${NUTRI_BACKUP_REMOTE:-cripto:}"
DB_USER="${NUTRI_DB_USER:-postgres}"
DB_NAME="${NUTRI_DB_NAME:-nutri}"
TZ_BACKUP="${NUTRI_BACKUP_TZ:-America/Sao_Paulo}"
HOJE="${NUTRI_BACKUP_TODAY:-$(TZ="$TZ_BACKUP" date +%F)}"
MANTER_DIARIOS=7
MANTER_SEMANAIS=4
HISTORICO_DIAS=30

log() { printf '%s nutri-backup: %s\n' "$(date -u +%FT%TZ)" "$*"; }

DB="${NUTRI_DB_CONTAINER:-$(docker ps -q -f "name=${NUTRI_DB_CONTAINER_FILTER:-nutri_db}" | head -n1)}"
if [ -z "$DB" ]; then
  log "ERRO: container do banco não encontrado"
  exit 2
fi

registrar() { # tipo ok bytes detalhe inicio
  docker exec -i "$DB" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q \
    -v tipo="$1" -v ok="$2" -v bytes="$3" -v detalhe="$4" -v inicio="$5" >/dev/null <<'SQL' || log "AVISO: não consegui registrar em backup_runs"
insert into backup_runs (tipo, ok, bytes, detalhe, iniciado_em)
values (:'tipo', :'ok'::boolean, nullif(:'bytes', '')::bigint, nullif(:'detalhe', ''), :'inicio'::timestamptz);
SQL
}

podar() { # pasta quantos_manter — nomes nutri-AAAA-MM-DD.dump ordenam como datas
  rclone lsf "$1" --files-only 2>/dev/null | grep -E '^nutri-[0-9]{4}-[0-9]{2}-[0-9]{2}\.dump$' | sort -r |
    tail -n +"$(($2 + 1))" | while read -r f; do rclone deletefile "$1$f"; done
}

backup_banco() {
  local inicio arquivo bytes
  inicio="$(date -u +%FT%TZ)"
  arquivo="nutri-${HOJE}.dump"
  # shellcheck disable=SC2086 # NUTRI_PG_DUMP_ARGS: só os testes usam, e são várias palavras de propósito
  if docker exec "$DB" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc ${NUTRI_PG_DUMP_ARGS:-} | rclone rcat "${REMOTO}db/diario/${arquivo}"; then
    bytes="$(rclone lsf --format s "${REMOTO}db/diario/${arquivo}" | head -n1)"
    if [ "$(date -d "$HOJE" +%u)" = 7 ]; then
      rclone copyto "${REMOTO}db/diario/${arquivo}" "${REMOTO}db/semanal/${arquivo}"
    fi
    podar "${REMOTO}db/diario/" "$MANTER_DIARIOS"
    podar "${REMOTO}db/semanal/" "$MANTER_SEMANAIS"
    registrar banco true "$bytes" "" "$inicio"
    log "banco ok (${bytes} bytes)"
  else
    rclone deletefile "${REMOTO}db/diario/${arquivo}" 2>/dev/null
    registrar banco false "" "pg_dump ou envio falhou" "$inicio"
    log "ERRO no backup do banco"
    return 1
  fi
}

backup_arquivos() {
  local inicio limite
  inicio="$(date -u +%FT%TZ)"
  if rclone sync "$NUTRI_DATA_DIR" "${REMOTO}data/atual" --backup-dir "${REMOTO}data/historico/${HOJE}"; then
    limite="$(date -d "$HOJE -${HISTORICO_DIAS} days" +%F)"
    rclone lsf "${REMOTO}data/historico/" --dirs-only 2>/dev/null | sed 's#/$##' | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' |
      while read -r d; do
        if [[ "$d" < "$limite" ]]; then rclone purge "${REMOTO}data/historico/${d}"; fi
      done
    registrar arquivos true "" "" "$inicio"
    log "arquivos ok"
  else
    registrar arquivos false "" "rclone sync falhou" "$inicio"
    log "ERRO no backup dos arquivos"
    return 1
  fi
}

falhas=0
backup_banco || falhas=$((falhas + 1))
backup_arquivos || falhas=$((falhas + 1))
exit "$falhas"
```

Run: `chmod +x scripts/backup/nutri-backup.sh && pnpm test test/backup.test.ts`
Expected: PASS (4 testes) onde houver `rclone`; o CI sempre roda.

- [ ] **Step 5: Unidades do systemd e modelo do ambiente**

`scripts/backup/nutri-backup.service`

```ini
[Unit]
Description=Backup diário do NutriDebby (RNF-05)
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
EnvironmentFile=/etc/nutri-backup/backup.env
ExecStart=/usr/local/lib/nutri-backup/nutri-backup.sh
Nice=10
IOSchedulingClass=idle
PrivateTmp=true
NoNewPrivileges=true
```

`scripts/backup/nutri-backup.timer`

```ini
[Unit]
Description=Backup diário do NutriDebby às 03:00 (America/Sao_Paulo)

[Timer]
OnCalendar=*-*-* 03:00:00 America/Sao_Paulo
Persistent=true

[Install]
WantedBy=timers.target
```

`scripts/backup/backup.env.example` (só nomes; os valores o dono digita no host, Tarefa 14):

```bash
# /etc/nutri-backup/backup.env — root:root 600. NUNCA commitar valores.
NUTRI_DATA_DIR=/srv/nutri/data
NUTRI_BACKUP_REMOTE=cripto:
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_ACCESS_KEY_ID=
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=
# https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com
RCLONE_CONFIG_R2_ENDPOINT=
RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
# r2:<R2_BUCKET>/nutri
RCLONE_CONFIG_CRIPTO_TYPE=crypt
RCLONE_CONFIG_CRIPTO_REMOTE=
# saída de `rclone obscure` da BACKUP_PASSPHRASE e do salt (guarde os originais fora da VPS)
RCLONE_CONFIG_CRIPTO_PASSWORD=
RCLONE_CONFIG_CRIPTO_PASSWORD2=
```

- [ ] **Step 6: `rclone` no job de testes do CI** — `.github/workflows/ci.yml`, no job `test`, antes de `pnpm test`:

```yaml
      - name: rclone (teste do script de backup, P02-10)
        run: sudo apt-get update && sudo apt-get install -y --no-install-recommends rclone
```

- [ ] **Step 7: `CLAUDE.md`** — acrescentar às regras obrigatórias:

```markdown
10. O backup (RNF-05) roda **no host** (`scripts/backup/nutri-backup.sh`, systemd às 03h), não no worker: `pg_dump` dentro do container `nutri_db` + `rclone crypt` para o R2. Mudou o script → o dono reinstala no host (Plano 02, Tarefa 14). A tabela `backup_runs` é escrita só pelo script; o worker só confere e alerta.
```

- [ ] **Step 8: Rodar tudo e commit**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: PASS.

```bash
git add scripts/backup drizzle src/db/schema/platform.ts test/global-setup.ts test/backup.test.ts .github/workflows/ci.yml CLAUDE.md
git commit -m "feat(backup): script do host com pg_dump no container, rclone crypt, retenção 7+4 e /data com histórico de 30 dias"
```

---

### Task 13: Monitoramento no worker — backup do dia e disco em 70% (P02-10b)

**Files:**
- Create: `src/modules/plataforma/monitoramento.ts`, `src/modules/plataforma/monitoramento.test.ts`, `src/app/admin/painel-infra.tsx`
- Modify: `src/jobs/queues.ts`, `src/worker/index.ts`, `src/app/admin/page.tsx`, `src/app/admin/sem-tabelas-tenant.test.ts`

**Interfaces:**
- Consumes: `backupRuns`, `systemHeartbeat`, `user` (`@/db/schema`); `enqueueEmail` (Tarefa 2); `WorkerEnv.DATA_DIR`, `WorkerEnv.APP_URL`.
- Produces:
  - `@/modules/plataforma/monitoramento`: `BACKUP_JANELA_MS = 26 h`, `DISCO_LIMITE = 70`, `type StatFsLike = { blocks: number; bfree: number; bavail: number }`, `percentualDisco(s): number` (mesma conta do `df`), `ultimosBackups(db, now?)`, `backupsFaltando(db, now): Promise<string[]>`, `emailsDosAdmins(db): Promise<string[]>`, `verificarBackups({ db, now, avisar })`, `verificarDisco({ db, now, statfs, avisar })`.
  - Filas `monitor-backup` (07:00 America/Sao_Paulo) e `monitor-disco` (de hora em hora).
  - `<PainelInfra />` na administração (último backup de cada tipo e uso do disco).

- [ ] **Step 1: Testes que falham** — `src/modules/plataforma/monitoramento.test.ts`

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { inject } from 'vitest';
import { makeDb } from '../../../test/db';
import { user } from '@/db/schema';
import {
  backupsFaltando, emailsDosAdmins, percentualDisco, verificarBackups, verificarDisco,
} from './monitoramento';

const app = makeDb(inject('appDatabaseUrl'));
const owner = makeDb(inject('ownerDatabaseUrl')); // backup_runs é só leitura para o app
afterAll(async () => {
  await app.pool.end();
  await owner.pool.end();
});
// Datas de 2020: não se misturam com as execuções reais do test/backup.test.ts
const H = 3600_000;
const agora = new Date('2020-01-10T10:00:00Z');
const registrar = (tipo: string, ok: boolean, quando: Date) =>
  owner.pool.query(`insert into backup_runs (tipo, ok, iniciado_em, concluido_em) values ($1, $2, $3, $3)`, [tipo, ok, quando]);

describe('verificação do backup (RNF-05)', () => {
  it('aponta o que não teve backup ok nas últimas 26 h (falha não conta)', async () => {
    await registrar('banco', true, new Date(agora.getTime() - 2 * H));
    await registrar('arquivos', false, new Date(agora.getTime() - 1 * H));
    await registrar('arquivos', true, new Date(agora.getTime() - 27 * H));
    expect(await backupsFaltando(app.db, agora)).toEqual(['arquivos']);
    expect(await backupsFaltando(app.db, new Date(agora.getTime() + 25 * H))).toEqual(['arquivos', 'banco']);
  });
  it('avisa com o detalhe só quando falta', async () => {
    const avisar = vi.fn(async () => undefined);
    await verificarBackups({ db: app.db, now: agora, avisar });
    expect(avisar).toHaveBeenCalledWith(expect.stringContaining('arquivos'));
    avisar.mockClear();
    await registrar('arquivos', true, new Date(agora.getTime() - H));
    await verificarBackups({ db: app.db, now: agora, avisar });
    expect(avisar).not.toHaveBeenCalled();
  });
});

describe('alerta de disco em 70% (RNF-13)', () => {
  it('percentual como o df', () => {
    expect(percentualDisco({ blocks: 100, bfree: 30, bavail: 25 })).toBe(74);
    expect(percentualDisco({ blocks: 100, bfree: 40, bavail: 40 })).toBe(60);
  });
  it('avisa ao passar de 70% no máximo uma vez a cada 24 h', async () => {
    const avisar = vi.fn(async () => undefined);
    const disco = (pct: number) => async () => ({ blocks: 100, bfree: 100 - pct, bavail: 100 - pct });
    const t0 = new Date('2020-02-01T00:00:00Z');
    expect(await verificarDisco({ db: app.db, now: t0, statfs: disco(69), avisar })).toEqual({ percentual: 69, alertou: false });
    expect(await verificarDisco({ db: app.db, now: t0, statfs: disco(74), avisar })).toEqual({ percentual: 74, alertou: true });
    expect(await verificarDisco({ db: app.db, now: new Date(t0.getTime() + 23 * H), statfs: disco(80), avisar })).toEqual({ percentual: 80, alertou: false });
    expect(await verificarDisco({ db: app.db, now: new Date(t0.getTime() + 24 * H), statfs: disco(80), avisar })).toEqual({ percentual: 80, alertou: true });
    expect(avisar).toHaveBeenCalledTimes(2);
    expect(avisar).toHaveBeenLastCalledWith(80);
  });
});

describe('emailsDosAdmins', () => {
  it('lista os e-mails de quem tem papel admin', async () => {
    const id = randomUUID();
    await app.db.insert(user).values({ id, name: 'Adm', email: `adm-${id.slice(0, 8)}@teste.dev`, appRole: 'admin' });
    expect(await emailsDosAdmins(app.db)).toContain(`adm-${id.slice(0, 8)}@teste.dev`);
  });
});
```

Run: `pnpm test src/modules/plataforma/monitoramento.test.ts` → FAIL.

- [ ] **Step 2: Implementar** — `src/modules/plataforma/monitoramento.ts`

```ts
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db/client';
import { systemHeartbeat, user } from '@/db/schema';

export const BACKUP_JANELA_MS = 26 * 60 * 60 * 1000; // backup às 03h + folga
export const DISCO_LIMITE = 70; // RNF-13
const ALERTA_DISCO_INTERVALO_MS = 24 * 60 * 60 * 1000;
const TIPOS = ['arquivos', 'banco'] as const;

export type StatFsLike = { blocks: number; bfree: number; bavail: number };

/** Uso do disco com a mesma conta do `df` (blocos reservados ao root não contam como livres). */
export function percentualDisco(s: StatFsLike): number {
  const usados = s.blocks - s.bfree;
  const total = usados + s.bavail;
  return total > 0 ? Math.round((usados / total) * 100) : 0;
}

export type UltimoBackup = { tipo: (typeof TIPOS)[number]; ok: boolean; concluidoEm: Date; bytes: number | null };

export async function ultimosBackups(db: Db, now: Date = new Date()): Promise<UltimoBackup[]> {
  const r = await db.execute<{ tipo: UltimoBackup['tipo']; ok: boolean; concluido_em: Date; bytes: string | null }>(sql`
    select distinct on (tipo) tipo, ok, concluido_em, bytes
      from backup_runs where concluido_em <= ${now}
     order by tipo, concluido_em desc`);
  return r.rows.map((x) => ({ tipo: x.tipo, ok: x.ok, concluidoEm: new Date(x.concluido_em), bytes: x.bytes === null ? null : Number(x.bytes) }));
}

/** Tipos sem backup ok na janela de 26 h (em ordem alfabética). */
export async function backupsFaltando(db: Db, now: Date): Promise<string[]> {
  const r = await db.execute<{ tipo: string }>(sql`
    select tipo from backup_runs
     where ok and concluido_em <= ${now} and concluido_em > ${new Date(now.getTime() - BACKUP_JANELA_MS)}
     group by tipo`);
  const comBackup = new Set(r.rows.map((x) => x.tipo));
  return TIPOS.filter((t) => !comBackup.has(t));
}

export async function emailsDosAdmins(db: Db): Promise<string[]> {
  return (await db.select({ email: user.email }).from(user).where(eq(user.appRole, 'admin'))).map((u) => u.email);
}

export async function verificarBackups(deps: { db: Db; now: Date; avisar: (detalhe: string) => Promise<void> }): Promise<{ faltando: string[] }> {
  const faltando = await backupsFaltando(deps.db, deps.now);
  if (faltando.length) await deps.avisar(`sem backup concluído nas últimas 26 horas: ${faltando.join(' e ')}`);
  return { faltando };
}

/** RNF-13: alerta ao admin com o disco em 70% — no máximo 1 e-mail a cada 24 h. */
export async function verificarDisco(deps: {
  db: Db;
  now: Date;
  statfs: () => Promise<StatFsLike>;
  avisar: (percentual: number) => Promise<void>;
}): Promise<{ percentual: number; alertou: boolean }> {
  const percentual = percentualDisco(await deps.statfs());
  if (percentual < DISCO_LIMITE) return { percentual, alertou: false };
  const [ultimo] = await deps.db.select().from(systemHeartbeat).where(eq(systemHeartbeat.name, 'alerta_disco'));
  if (ultimo && deps.now.getTime() - ultimo.beatAt.getTime() < ALERTA_DISCO_INTERVALO_MS) return { percentual, alertou: false };
  await deps.avisar(percentual);
  await deps.db
    .insert(systemHeartbeat)
    .values({ name: 'alerta_disco', beatAt: deps.now })
    .onConflictDoUpdate({ target: systemHeartbeat.name, set: { beatAt: deps.now } });
  return { percentual, alertou: true };
}
```

Run: `pnpm test src/modules/plataforma/monitoramento.test.ts` → PASS (6 testes).

- [ ] **Step 3: Jobs no worker** — `src/jobs/queues.ts`, acrescentar ao `QUEUES`:

```ts
  'monitor-backup': { retryLimit: 2, retryDelay: 300, expireInSeconds: 120 },
  'monitor-disco': { retryLimit: 0, expireInSeconds: 60 },
```

`src/worker/index.ts` — imports:

```ts
import { statfs } from 'node:fs/promises';
import { enqueueEmail } from '@/email/queue';
import { emailsDosAdmins, verificarBackups, verificarDisco } from '@/modules/plataforma/monitoramento';
```

e, depois do registro da fila `email`:

```ts
  const painelUrl = `${env.APP_URL.replace(/\/$/, '')}/admin`;
  const paraAdmins = async (montar: (para: string) => Parameters<typeof enqueueEmail>[0]) => {
    for (const para of await emailsDosAdmins(getDb())) await enqueueEmail(montar(para), { boss });
  };
  // RNF-05: o backup roda no host às 03h; às 07h o worker confere se ele aconteceu
  await boss.schedule('monitor-backup', '0 7 * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('monitor-backup', async () => {
    await verificarBackups({
      db: getDb(),
      now: new Date(),
      avisar: (detalhe) => paraAdmins((para) => ({ tipo: 'alerta_backup', para, detalhe, painelUrl })),
    });
  });
  // RNF-13: disco da VPS (o volume /data está no disco do host)
  await boss.schedule('monitor-disco', '0 * * * *', {}, { tz: 'America/Sao_Paulo' });
  await boss.work('monitor-disco', async () => {
    await verificarDisco({
      db: getDb(),
      now: new Date(),
      statfs: () => statfs(env.DATA_DIR),
      avisar: (percentual) => paraAdmins((para) => ({ tipo: 'alerta_disco', para, percentual, painelUrl })),
    });
  });
```

- [ ] **Step 4: Painel da administração** — `src/app/admin/painel-infra.tsx`

```tsx
import { statfs } from 'node:fs/promises';
import { getDb } from '@/db/client';
import { getEnv } from '@/env';
import { formatarBytes } from '@/lib/format';
import { DISCO_LIMITE, percentualDisco, ultimosBackups, type UltimoBackup } from '@/modules/plataforma/monitoramento';

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);

function Linha({ rotulo, b }: { rotulo: string; b?: UltimoBackup }) {
  if (!b) return <li>{`${rotulo}: nenhum backup registrado`}</li>;
  const tamanho = b.bytes ? ` (${formatarBytes(b.bytes)})` : '';
  return <li>{`${rotulo}: ${b.ok ? 'concluído' : 'FALHOU'} em ${quando(b.concluidoEm)}${tamanho}`}</li>;
}

/** Situação do backup (RNF-05) e do disco (RNF-13) para o admin. */
export async function PainelInfra() {
  const backups = await ultimosBackups(getDb());
  const disco = await statfs(getEnv().DATA_DIR).then(percentualDisco, () => null);
  return (
    <section aria-labelledby="infra-titulo" className="rounded border p-4 text-sm">
      <h2 id="infra-titulo" className="mb-2 font-semibold">Servidor</h2>
      <ul className="space-y-1">
        <Linha rotulo="Backup do banco" b={backups.find((b) => b.tipo === 'banco')} />
        <Linha rotulo="Backup dos arquivos" b={backups.find((b) => b.tipo === 'arquivos')} />
        <li className={disco !== null && disco >= DISCO_LIMITE ? 'font-semibold text-red-700' : undefined}>
          {disco === null ? 'Disco: não foi possível medir' : `Disco da VPS: ${disco}% usado`}
        </li>
      </ul>
    </section>
  );
}
```

Em `src/app/admin/page.tsx`, importar `PainelInfra` (`./painel-infra`) e colocar `<PainelInfra />` logo depois do bloco do aviso. Em `src/app/admin/sem-tabelas-tenant.test.ts`, acrescentar `path.resolve('src/modules/plataforma/monitoramento.ts')` à lista.

- [ ] **Step 5: Verificar no dev e rodar tudo**

Run: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: PASS.

Manual: com `pnpm worker` rodando, `pnpm exec tsx --env-file=.env.local -e "import('./src/jobs/boss.ts').then(async (m) => { const b = await m.getBoss(); await b.send('monitor-backup', {}); process.exit(0) })"` → em alguns segundos, e-mail "Alerta: backup diário não concluído" no Mailpit para cada admin de dev (não há backup no dev).

- [ ] **Step 6: Commit**

```bash
git add src/modules/plataforma/monitoramento.ts src/modules/plataforma/monitoramento.test.ts src/jobs/queues.ts src/worker/index.ts src/app/admin
git commit -m "feat(monitoramento): alerta de backup não concluído e de disco em 70% por e-mail ao admin"
```

---

### Task 14: Ativação em produção — runbook com o dono (P02-11; E-05, E-06, E-10)

Esta tarefa é executada **com o dono, nunca por subagente**. Cada passo marcado "**requer confirmação do dono**" só roda depois de um "sim" explícito dele naquele momento (regra 3 do servidor). Segredos são digitados pelo dono (prompt interativo, editor ou painel) e **nunca** aparecem em chat, log ou commit. **Antes de começar: lembrar o dono de tirar um snapshot da VPS no hPanel** (regra 5).

**Pré-requisitos:** P01-13 concluída (serviços `nutri_app`, `nutri_worker`, `nutri_db` no Easypanel, domínio `app.<dominio>` e primeiro deploy verificados, incluindo a poda do GHCR e `TRUSTED_PROXIES` preenchida — **sem ela o app novo não sobe**, Tarefa 1); PR do Plano 02 aprovado nas revisões, ainda **sem merge**.

**Files:** nenhum no repositório (resultado vai para o PR).

- [ ] **Step 1: E-05 — Resend + DNS (dono, no painel do Resend e do DNS)**
  1. Criar a conta gratuita no Resend e adicionar o domínio (sugestão: `mail.<dominio>` ou o próprio `<dominio>`).
  2. Criar no DNS os registros que o Resend mostrar (SPF/`TXT`, DKIM/`TXT` ou `CNAME`) e o DMARC: `_dmarc.<dominio>` `TXT` `v=DMARC1; p=quarantine; rua=mailto:<email-do-dono>` (INT-02).
  3. Esperar "Verified" no Resend. Conferir de fora (leitura, sem segredo): `dig +short TXT _dmarc.<dominio>`.
  4. Criar uma API key com permissão **"Sending access"** restrita ao domínio. Guardá-la só no gerenciador de senhas do dono.

- [ ] **Step 2: E-06 — Turnstile e R2 (dono, no painel da Cloudflare)**
  1. Turnstile: novo widget, modo *Managed*, hostname `app.<dominio>` → anotar a *site key* (pública) e a *secret key* (secreta).
  2. R2: criar o bucket privado `nutri-backup` (sem acesso público, sem domínio). Criar um token de API R2 com **"Object Read & Write" só nesse bucket** → Access Key ID e Secret Access Key. Anotar o Account ID.
  3. Gerar, no computador do dono (não na VPS), a `BACKUP_PASSPHRASE` e o salt: `openssl rand -base64 32` duas vezes. **Guardar os dois fora da VPS** (gerenciador de senhas): sem eles, nenhum backup pode ser restaurado.

- [ ] **Step 3: Pasta `/data` no host — requer confirmação do dono**

```bash
sudo install -d -o 1000 -g 1000 -m 750 /srv/nutri/data
```

(uid/gid 1000 = usuário `node` da imagem.) Depois, **no painel do Easypanel** (dono): em `nutri_app` **e** em `nutri_worker`, *Mounts* → *Bind mount* `/srv/nutri/data` → `/data`.

- [ ] **Step 4: Variáveis no Easypanel (dono, pelo painel)** — nomes e origem; valores só no painel:

| Serviço | Variável | Valor |
|---|---|---|
| `nutri_app` | `ENCRYPTION_KEY` | `openssl rand -base64 32` (o **mesmo** valor no worker) |
| `nutri_app` | `FILE_URL_SECRET` | `openssl rand -base64 48` |
| `nutri_app` | `DATA_DIR` | `/data` |
| `nutri_app` | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | do Step 2.1 (nunca as chaves de teste `1x…`) |
| `nutri_worker` | `APP_URL` | `https://app.<dominio>` |
| `nutri_worker` | `ENCRYPTION_KEY` | o mesmo do app |
| `nutri_worker` | `EMAIL_FROM` | `NutriDebby <nao-responda@<dominio-verificado>>` |
| `nutri_worker` | `RESEND_API_KEY` | do Step 1.4 |
| `nutri_worker` | `DATA_DIR` | `/data` |

Não cadastrar `R2_*` nem `BACKUP_PASSPHRASE` no Easypanel (ficam só no host, Step 6). Não cadastrar `EMAIL_TRANSPORT` (produção usa Resend por padrão).

- [ ] **Step 5: E-10 — swap e rclone no host — cada item requer confirmação do dono, separadamente**

Swap de 2 GB (RNF-03, recomendação):

```bash
free -h   # leitura: conferir que ainda não há swap
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h
```

rclone (mesma origem do CI — pacote assinado da distribuição):

```bash
sudo apt-get update && sudo apt-get install -y --no-install-recommends rclone
rclone version
```

`postgresql-client-16` no host **não** é necessário neste plano (desvio registrado): a conferência de restauração usa o `pg_restore` do próprio container. Fica para o P08-04.

- [ ] **Step 6: Instalar o backup — requer confirmação do dono**

```bash
sudo install -d -m 755 /usr/local/lib/nutri-backup
sudo install -m 755 scripts/backup/nutri-backup.sh /usr/local/lib/nutri-backup/nutri-backup.sh
sudo install -m 644 scripts/backup/nutri-backup.service scripts/backup/nutri-backup.timer /etc/systemd/system/
sudo install -d -m 700 /etc/nutri-backup
sudo install -m 600 scripts/backup/backup.env.example /etc/nutri-backup/backup.env
```

O **dono** abre `sudo nano /etc/nutri-backup/backup.env` e preenche os valores (R2 do Step 2.2; `RCLONE_CONFIG_CRIPTO_PASSWORD` e `…PASSWORD2` com a saída de `rclone obscure '<passphrase>'` e `rclone obscure '<salt>'`, rodados por ele no terminal). Conferência sem mostrar valores:

```bash
sudo grep -c '=$' /etc/nutri-backup/backup.env   # esperado: 0 (nenhuma variável vazia)
sudo bash -c 'set -a; . /etc/nutri-backup/backup.env; rclone lsd r2:nutri-backup >/dev/null && echo "R2 ok"'
systemd-analyze calendar '*-*-* 03:00:00 America/Sao_Paulo'
```

- [ ] **Step 7: Merge e deploy — requer confirmação explícita do dono** (merge = deploy = reinício de `nutri_app` e `nutri_worker`). Depois, só leitura:

```bash
docker service ls --filter name=nutri_
docker service logs --tail 50 nutri_worker 2>&1 | grep -E 'worker iniciado|erro' | head
curl -s -o /dev/null -w "%{http_code}\n" https://app.<dominio>/api/health
```

Expected: 3 serviços `1/1`; `worker iniciado`; health `200`.

- [ ] **Step 8: Primeiro backup e conferência de restauração — requer confirmação do dono** (lê o banco de produção)

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now nutri-backup.timer
sudo systemctl start nutri-backup.service
journalctl -u nutri-backup --since '10 min ago' --no-pager | tail -20
docker exec $(docker ps -q -f name=nutri_db | head -1) psql -U postgres -d nutri -c "select tipo, ok, bytes, concluido_em from backup_runs order by concluido_em desc limit 4"
sudo bash -c 'set -a; . /etc/nutri-backup/backup.env; rclone lsf cripto:db/diario/'
sudo bash -c 'set -a; . /etc/nutri-backup/backup.env; rclone cat "cripto:db/diario/nutri-$(TZ=America/Sao_Paulo date +%F).dump"' \
  | docker exec -i $(docker ps -q -f name=nutri_db | head -1) pg_restore --list | head -20
```

Expected: `banco ok` e `arquivos ok` no journal; duas linhas `ok = t`; o dump do dia listado; `pg_restore --list` mostra tabelas (`audit_log`, `tenants`…). No painel do R2, os nomes dos objetos aparecem cifrados. Este é o "backup diário no R2 funcionando **antes** de entrar qualquer dado real" (índice, Plano 02).

- [ ] **Step 9: Verificações de ponta a ponta** (dono no navegador; leitura no servidor)
  1. `https://app.<dominio>/esqueci-senha` com o e-mail do admin: o widget do Turnstile aparece, o e-mail chega (remetente do domínio; nos cabeçalhos, `spf=pass`, `dkim=pass`, `dmarc=pass`).
  2. Admin cria uma conta de teste com o e-mail do próprio dono; o convite chega; o primeiro acesso aceita o DPA e abre o painel; enviar um logo e ver a marca aplicada; conferir o arquivo em `/srv/nutri/data/<tenant>/logo/` (`ls`, leitura).
  3. Suspender a conta de teste e ver "Conta temporariamente indisponível"; reativar.
  4. `/admin` mostra "Backup do banco: concluído em …" e o uso do disco.
  5. Conferir que as chaves de teste do Turnstile não estão em produção: `docker exec $(docker ps -q -f name=nutri_app | head -1) sh -c "tr '\\0' '\\n' < /proc/1/environ | grep -c '^TURNSTILE_SECRET_KEY=1x'"` → `0` (imprime só a contagem).

- [ ] **Step 10: Registrar no PR** o resultado dos Steps 1–9 (sem nenhum segredo) e atualizar E-05, E-06 e E-10 para ✅ no backlog.

---

## Fechamento do plano (após a Tarefa 14)

- [ ] Rodar a revisão da entrega conforme o índice: revisor por tarefa (feito ao longo) → `/code-review high` no PR → corrigir → `/code-review high` (precisa sair sem problema confirmado) → `/security-review` com o **checklist reforçado** deste plano: uploads (magic bytes, URL assinada de 5 min, cota de 5 GB, path traversal, SVG), autenticação (convite 72 h de uso único guardado em hash, tokens do Better Auth em hash, suspensão com sessões revogadas, `TRUSTED_PROXIES`), LGPD (registro do aceite do DPA, auditoria de leitura/alteração, nada de dado de saúde em log), Turnstile validado no servidor com falha fechada, isolamento admin/tenant (função `SECURITY DEFINER` só com contagens, guarda `sem-tabelas-tenant`, matriz de isolamento). Tudo na assinatura (sem `/code-review ultra`). Registrar os resumos no PR. Se sobrar problema confirmado depois da 3ª rodada, parar e avisar o dono.
- [ ] Atualizar o status de P02-01 a P02-11 no backlog (arquivo e artefato https://claude.ai/artifact/DeHjnCr4xFDn7xE8DDuvM2).
- [ ] Atualizar a spec para a v1.4 (Apêndice C e corpo) com os "Desvios conscientes" desta página: backup no host, variáveis do backup fora do Easypanel, modelos de e-mail sem React Email, `EMAIL_TRANSPORT`/`MAILPIT_URL`, `audit_log.patient_id`, tabelas novas, E-10 sem `postgresql-client-16`.
- [ ] Anotar para os próximos planos: P03-01 monta `HistoricoAcessos` no prontuário e usa `app_enable_audit`/`auditRead`; P03 e P05 trocam os `NULL` de `admin_tenant_metrics()`; P05-04 usa `verifyTurnstile`; P05-06 marca lembretes de tenant suspenso como `ignorada` (`tenant_suspenso`) e reagenda na reativação; P04-09 e Plano 06 usam `getTenantBrand`; Plano 06 aplica `tenantStatus` por vínculo do paciente.
- [ ] Pedir ao dono o merge (= deploy) — é o Step 7 da Tarefa 14.

---

## Autorrevisão do plano (writing-plans)

**1. Cobertura da spec** — cada requisito do Plano 02 tem tarefa:

| Requisito | Tarefa |
|---|---|
| US-001 (criar conta, erros exatos, 72 h, slug duplicado, convite expirado, "Reenviar convite") | 5 (e 6 para o link) |
| US-001 "Primeiro admin" recebe e-mail | Mantido o link no terminal (desvio já na spec 1.3); "Esqueci minha senha" passa a enviar e-mail — 3 |
| US-002 primeiro acesso + DPA + `dpa_aceito_em`; recuperação por e-mail, 1 h, uso único | 6, 3 |
| US-004 suspender/reativar, tela, dados intactos, admin 403 em `/api/painel/*` | 7 (lembrete `ignorada`/reagendar → P05-06, desvio) |
| US-005 logo/cor/contraste/antecedências/endereço/link/fuso/agendamento público; marca aplicada | 10 (PWA/PDF → Planos 06/04, desvio) |
| US-007 leitura auditada, log imutável, histórico 50/pág. desc | 4 (montagem da aba → P03-01, desvio) |
| INT-02 Resend/Mailpit, React, retry 3 | 1, 2, 3 |
| INT-06 Turnstile no servidor, fora do ar fecha | 11 |
| RN-15 | 2 (job), 7 |
| RN-18 / RNF-13 cota 5 GB, 80%, 100%, disco 70% | 8, 13 |
| RNF-05 backup | 12, 13, 14 |
| RNF-06 magic bytes, URL assinada, 2FA/sessões preservados | 8, 10, 7 |
| RNF-07 RLS + matriz de isolamento | 4, 8 |
| RNF-08 auditoria + DPA | 4, 6 |
| §3/§4.1 métricas `SECURITY DEFINER`, admin sem tabelas 🔒 | 9 |
| §9.x variáveis, CI, imagem | 1, 2, 8, 11, 12 |

Sem lacunas além dos desvios registrados.

**2. Placeholders** — procurados "TBD", "TODO", "implementar depois", "tratar erros", "igual à Tarefa N": nenhum. Os únicos `<…>` são valores que o dono digita no runbook (domínio, e-mails, chaves) e o `<versão>` do `resend` no commit, que depende do gate do pnpm na hora da execução (instrução explícita no Step 1 da Tarefa 2).

**3. Consistência de tipos e nomes** — conferidos entre tarefas: `TenantContext` (`actorUserId`, `ip`) da T4 usado em T6/T8/T10; `Queryable` (T5) em `criarConvite`/`inspecionarConvite`/`registrarAceiteDpa`; `enqueueEmail(msg, { tenantId, tx, boss })` (T2) em T3/T5/T13; `getTenantStatus`/`tenantIsActive` (T2) em T7; `requireNutri` (T6) em T8/T10; `requireApiUser` (T7) em T10; `salvarArquivo`/`apagarArquivo`/`TipoNaoPermitidoError`/`CotaEsgotadaError` (T8) em T10; `formatarBytes`/`COTA_BYTES` (T8) em T9/T13; `ContaResumo.waCotaMensal` acrescentado na T9 com a alteração de `listarContas` explicitada; `criarEEntrar`/`entrar` (`test/sessao.ts`, T6) em T7/T10; `ResultadoTurnstile` (T11) no `createAuth`.

**4. Review Focus** — os cinco itens têm teste na tarefa dona: (1) T5 "e-mail e slug com maiúsculas…" e "corrida entre dois admins"; (2) T6 "o mesmo convite enviado duas vezes ao mesmo tempo"; (3) T8 `detectarTipo` + `salvarArquivo` "decide pelo conteúdo" e T10 "SVG com `<script>` vira PNG sem script"; (4) T8 "dois uploads simultâneos perto do limite" e "falha ao gravar devolve a reserva"; (5) T7 `session.test` "sessão aberta de conta suspensa" e `api-auth.test` "a mesma sessão depois da suspensão recebe 403", mais o E2E da suspensão.

## Execução

Plano pronto em `docs/superpowers/plans/2026-09-28-nutridebby-02-plataforma.md`. Recomendação: **subagent-driven** (as tarefas dependem muito das interfaces umas das outras — `withTenant` com ator, fila, `requireNutri`, armazenamento — e um erro de segurança aqui vaza para todos os planos seguintes; a política do dono já exige revisor por tarefa). A Tarefa 14 fica fora dos subagentes: é executada com o dono.
