# NutriDebby — Especificação do MVP (Design)

| Item | Valor |
|---|---|
| Versão | 1.4 (ver Apêndice C) |
| Data | 2026-09-27 |
| Status | **Aprovada** em 2026-09-27 |
| Nome do produto | *NutriDebby* (provisório) |
| Cliente-piloto | Debby (nutricionista) |
| Documento complementar | [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md): épicos, Histórias de Usuário, critérios BDD e rastreabilidade |

---

## 1. Visão

SaaS de gestão de consultório nutricional com portal do paciente em PWA. Referência de mercado: Dietbox.
O produto nasce **multi-tenant**, mas o **onboarding é manual**: o admin da plataforma cria cada conta de nutricionista. A primeira cliente é a Debby. Cobrança da assinatura e cadastro pela própria nutricionista ficam para a Fase 2 (Abordagem A, aprovada em 2026-09-27).

### 1.1 Critérios de sucesso do MVP

| ID | Critério | Como medir |
|---|---|---|
| CS-01 | A Debby atende **100% dos pacientes** pelo sistema por **30 dias consecutivos**, sem voltar à ferramenta anterior | Confirmação da Debby + consultas registradas × agenda |
| CS-02 | **≥ 60% dos pacientes ativos** abrem o PWA pelo menos 1× por semana | Métrica de sessões por paciente (tabela de eventos de acesso) |
| CS-03 | Taxa de faltas **menor** que a do mês anterior ao sistema | `appointments.status = 'faltou'` / consultas do mês |

### 1.2 Premissas e decisões registradas

| # | Decisão | Origem |
|---|---|---|
| D-01 | Produto é SaaS (vender para outras nutricionistas); Debby é piloto | Usuário |
| D-02 | MVP = M1–M6; financeiro fica para a Fase 2 | Usuário |
| D-03 | App do paciente = PWA (sem lojas no MVP) | Usuário |
| D-04 | Infra = VPS Hostinger atual + Easypanel; Next.js + PostgreSQL | Usuário |
| D-05 | Lembretes por e-mail + WhatsApp Cloud API oficial + push | Usuário |
| D-06 | Multi-tenant desde o dia 1, onboarding manual (Abordagem A) | Usuário |
| D-07 | WhatsApp com **número único da plataforma** no MVP | Usuário |
| D-08 | Biblioteca de conteúdo no MVP, com vídeos por **link YouTube/Vimeo** | Usuário |
| D-09 | Tabela de alimentos = TACO (4ª ed.) + alimentos próprios; TBCA só na Fase 3 | Premissa aceita |
| D-10 | Perfil recepcionista fora do MVP | Premissa aceita |
| D-11 | Somente pacientes adultos (≥ 18 anos) | Usuário |

---

## 2. Escopo

### 2.1 Módulos do MVP

| ID | Módulo | Conteúdo |
|---|---|---|
| M1 | **Plataforma & acesso** | Multi-tenant; login e-mail/senha; 2FA TOTP (obrigatório para admin, opcional para nutricionista); recuperação de senha; painel admin (criar/suspender/reativar contas); configuração da marca; auditoria |
| M2 | **Pacientes & prontuário** | Cadastro + convite; etiquetas; anamnese com modelo editável; antropometria (peso, altura, IMC, circunferências, dobras — Jackson & Pollock 3 e 7 dobras + Siri); gasto energético (Harris-Benedict, Mifflin-St Jeor, FAO/OMS × fator de atividade); exames (PDF + valores); registro de atendimento; evolução em gráficos; arquivamento, exportação e exclusão (LGPD) |
| M3 | **Plano alimentar** | Tabela TACO + alimentos próprios; refeições com horário; cálculo em tempo real (kcal, proteína, carboidrato, lipídio, fibra) × meta; substituições; modelos reutilizáveis; versionamento/publicação; PDF com a marca da nutricionista |
| M4 | **Agenda** | Horários de atendimento + bloqueios; consulta presencial/online (link externo); agendamento pela nutricionista e online pelo paciente; cancelar/remarcar; lembretes 24 h e 2 h (e-mail, WhatsApp, push); confirmação por botão no WhatsApp; registro de realizada/falta; cota de WhatsApp |
| M5 | **Portal do paciente (PWA)** | Instalação + push; plano atual; diário alimentar (texto + foto) com comentário da nutricionista; evolução; lista de compras gerada do plano; agendar/remarcar; exportar os próprios dados |
| M6 | **Biblioteca de conteúdo** | Vídeos (link YouTube/Vimeo), receitas estruturadas com cálculo nutricional, orientações em texto (+ PDF); público-alvo (todos / etiqueta / pacientes específicos); receita anexada a refeição do plano; aba "Conteúdos" no PWA (feed, busca, filtro, favoritos); métricas de visualização |

### 2.2 Fora do MVP

Financeiro do consultório · cobrança da assinatura SaaS · cadastro pela própria nutricionista/trial · recepcionista · chat e videochamada internos · assistente com IA · site profissional / vitrine pública de conteúdo · Canva · loja · Google Agenda · app nativo nas lojas · prescrição de suplementos/fitoterápicos · TBCA · upload próprio de vídeo · WhatsApp com número de cada nutricionista. Distribuição por fase na §10.

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Admin da plataforma** | Criar, suspender e reativar tenants; ver métricas agregadas de uso (nº de pacientes, consultas, mensagens enviadas, cota de WhatsApp — **Plano 02:** `admin_tenant_metrics()` já devolve essas colunas, com `NULL` até as tabelas existirem, nos Planos 03 e 05; arquivos e armazenamento já são contados de verdade); ajustar a cota de WhatsApp do tenant | Ler prontuário, plano, diário, exames ou qualquer dado de saúde. Exceção: suporte a um caso específico, **com autorização registrada da nutricionista** e com o acesso auditado (Fase 2; no MVP não há essa tela) |
| **Nutricionista** (dona do tenant) | Tudo dentro do próprio tenant | Ver dados de outro tenant |
| **Paciente** | Ver o próprio plano publicado, a evolução, as orientações e a agenda; preencher o diário; agendar/remarcar dentro das regras; ver os conteúdos destinados a ele; exportar os próprios dados | Ver `notas_privadas`, planos em rascunho, dados de outros pacientes |

**2FA:** obrigatório para o admin; opcional (recomendado) para a nutricionista.

**Modelo de identidade:** o login (`users`) é global por e-mail e tem **um único papel**. No MVP, uma nutricionista que também seja paciente de outra precisa usar outro e-mail. O prontuário (`patients` e dependentes) pertence ao tenant. Um mesmo usuário pode ser paciente de mais de um tenant; cada nutricionista vê só o próprio histórico. No PWA, se houver mais de um vínculo, o paciente escolhe a nutricionista ao entrar.

---

## 4. Arquitetura

```
Paciente (PWA)  /  Nutricionista (web)  /  Admin
            │  HTTPS — Traefik (Easypanel) + Let's Encrypt
            ▼
┌─────────────────────────────────────────────────────────────┐
│ nutri_app     Next.js 16 (App Router): UI + Route Handlers  │
│               + Server Actions; monólito modular M1–M6      │
├─────────────────────────────────────────────────────────────┤
│ nutri_worker  mesma imagem, comando `worker`: pg-boss       │
│               (lembretes, e-mails, WhatsApp, push, PDFs,    │
│               imagens; só confere o backup e alerta)        │
├─────────────────────────────────────────────────────────────┤
│ nutri_db      PostgreSQL 16 — RLS por tenant_id; também     │
│               guarda a fila pg-boss (sem Redis)             │
├─────────────────────────────────────────────────────────────┤
│ volume /data  PDFs de exames/planos, fotos do diário, capas,│
│               logos — montado no app e no worker (mesmo nó) │
│               servidos só por URL assinada, TTL 5 min       │
└─────────────────────────────────────────────────────────────┘
            │ backup diário criptografado (rclone, rodando no host)
            ▼
     Cloudflare R2 (offsite)

Externos: WhatsApp Cloud API (Meta) · Resend (e-mail) · Web Push (VAPID) · Sentry ·
          Cloudflare Turnstile (anti-robô na página pública) · GHCR (imagens)
```

### 4.1 Organização do código

Monólito modular: `src/modules/{plataforma,pacientes,planos,agenda,portal,conteudo}`. Cada módulo expõe funções de domínio (**Plano 02:** em vários arquivos por módulo, como `contas.ts` e `convites.ts`, em vez de um único `service.ts`). As rotas e a UI chamam só o módulo, nunca o banco direto. O acesso ao banco passa por um helper `withTenant(ctx, fn)`, que abre a transação e executa `SET LOCAL` de `app.tenant_id`, `app.role` e, para sessões de paciente, `app.patient_id`, antes de qualquer consulta.

Regras de acesso que complementam a RLS:
- **Paciente só vê o que é dele:** nas tabelas 🔒 com `patient_id`, uma segunda política RLS exige `patient_id = app.patient_id` quando `app.role = 'paciente'`. Assim, um erro no service não expõe outro paciente do mesmo tenant.
- **Tabelas sem `tenant_id`** (`tenants`, `users` — tabelas do Better Auth no Plano 01 — `consents`, `invites`, `backup_runs`, `push_subscriptions`): acesso só pelos services do M1, com verificação explícita de dono; cobertas por testes de autorização.
- **Worker:** todo job carrega `tenant_id` no payload e roda dentro de `withTenant`. O worker usa o mesmo role da aplicação (sem `BYPASSRLS`); varreduras entre tenants partem da tabela `tenants`.
- **Métricas do admin:** vêm de uma função `SECURITY DEFINER` que devolve **só contagens** por tenant; o admin nunca executa consultas nas tabelas 🔒.

### 4.2 Rotas e domínios

| URL | Uso |
|---|---|
| `app.<dominio>/` | Login (nutricionista, paciente, admin) |
| `app.<dominio>/painel/…` | Área da nutricionista |
| `app.<dominio>/p/…` | PWA do paciente (manifest com `scope: /p/`) |
| `app.<dominio>/admin/…` | Admin da plataforma |
| `app.<dominio>/n/<slug>` | Página pública de agendamento da nutricionista |
| `app.<dominio>/api/webhooks/whatsapp` | Webhook da Meta |

O domínio definitivo ainda não foi escolhido. Ver §11.

---

## 5. Requisitos não funcionais

| ID | Requisito | Meta verificável |
|---|---|---|
| RNF-01 | Desempenho | Route Handlers com p95 ≤ 300 ms (exceto geração de PDF e exportação, que são assíncronas); LCP do PWA ≤ 2,5 s em 4G (Lighthouse, perfil "Slow 4G"); recálculo do plano ao adicionar/alterar item ≤ 100 ms (calculado no cliente) |
| RNF-02 | Capacidade | 50 tenants × 300 pacientes ativos (15 mil pacientes) e 100 usuários simultâneos, sem violar o RNF-01 (teste de carga com k6 antes do go-live) |
| RNF-03 | Limites na VPS | Limites definidos no Easypanel: `nutri_app` 1 GB / 1 vCPU; `nutri_db` 1 GB; `nutri_worker` 512 MB (conversão de HEIC e PDF consomem memória) — total 2,5 GB dos ~5,5 GB livres. O `cursoia_crm` não pode ser afetado. **Build da imagem fora da VPS** (§9.7). Recomendação à parte: criar 2 GB de swap na VPS (exige confirmação do dono do servidor) |
| RNF-04 | Disponibilidade | 99% ao mês (VPS única, sem HA — risco aceito). Monitor externo checa `GET /api/health` a cada 1 min e alerta em ≤ 2 min. O health check testa o banco e o **heartbeat do worker**: se nenhum job for processado em 10 min, a resposta é 503. Assim, lembretes parados também geram alerta |
| RNF-05 | Backup | Rodado **no host** por `systemd` às 03h (America/Sao_Paulo), não pelo worker (**Plano 02**; ver Apêndice C): `pg_dump` executado dentro do container `nutri_db` e criptografado (rclone crypt) no R2, com retenção de 7 diários + 4 semanais; `/data` com `rclone sync` + `--backup-dir` datado (arquivos alterados ou apagados ficam 30 dias). Dados excluídos por LGPD somem dos backups em até 35 dias; RPO 24 h; RTO 4 h; **teste de restauração mensal documentado** (**Plano 02:** a conferência inicial usa o `pg_restore` do próprio container `nutri_db`; o teste mensal fica para o P08-04). O script grava cada execução em `backup_runs`; o worker só confere a tabela e alerta os admins por e-mail se o dia passou sem backup ou se a última execução falhou |
| RNF-06 | Segurança | Senhas em argon2id; 2FA TOTP para a nutricionista; sessão expira após 12 h de inatividade (nutricionista/admin) ou 30 dias (paciente) — **Plano 01:** implementado como `expiresAt` = última atividade + 12 h, deslizando só em `requireUser` a cada 15 min (evita gravar a cada requisição); limite de 5 tentativas de login a cada 15 min por IP+e-mail (**Plano 01:** por IP+rota, via Better Auth — risco de `X-Forwarded-For` falsificado verificado na Tarefa 13); HSTS; CSP restritiva (`frame-src`: `youtube-nocookie.com`, `player.vimeo.com`, `challenges.cloudflare.com`; `script-src`: próprio + Turnstile; `connect-src`: próprio + Sentry; `img-src`: próprio + `data:` + `blob:`); uploads validados pelo conteúdo real do arquivo (*magic bytes*), não pela extensão; Turnstile + limite por IP nos formulários públicos (RN-16); **2FA obrigatório para o admin**; `totp_secret` criptografado com `ENCRYPTION_KEY` (AES-256-GCM) (**Plano 01:** cifrado pelo Better Auth com XChaCha20-Poly1305 usando `AUTH_SECRET`; `ENCRYPTION_KEY` fica reservado para dados de planos futuros); segredos só em variáveis do Easypanel |
| RNF-07 | Isolamento entre tenants | RLS habilitada e **forçada** (`FORCE ROW LEVEL SECURITY`) em toda tabela com `tenant_id`; a aplicação conecta com um role sem `BYPASSRLS`; política adicional por `patient_id` para sessões de paciente (§4.1); teste automatizado no CI tenta ler, alterar e excluir dados de outro tenant **e de outro paciente do mesmo tenant** em **todas** as tabelas 🔒, e o resultado esperado é 0 linhas afetadas ou HTTP 404 |
| RNF-08 | LGPD | Termo de consentimento versionado, aceito no primeiro acesso do paciente; opt-in separado para WhatsApp; auditoria de leitura/alteração de prontuário (quem, ação, entidade, IP, quando); exportação dos dados do paciente (JSON + PDF); pedido de exclusão (art. 18 da LGPD) **durante o prazo de guarda do prontuário**: os dados clínicos são **mantidos identificados** (art. 16, I — obrigação legal) e **bloqueados** (sem acesso ao portal, sem notificações, sem uso em conteúdo); são apagados na hora apenas os dados não obrigatórios (fotos do diário, opt-ins, inscrições de push). Após o prazo, um job anonimiza o registro. Prazo **a validar com CRN/advogado** (referência: 20 anos, Lei 13.787/2018); nutricionista = controladora, plataforma = operadora (DPA aceito no primeiro login da nutricionista) |
| RNF-09 | Compatibilidade | PWA: Chrome Android 10+ e Safari iOS 16.4+. Painel: últimas 2 versões de Chrome, Edge, Safari e Firefox, com layout funcional a partir de 768 px |
| RNF-10 | Acessibilidade | PWA em conformidade com WCAG 2.1 AA; verificação automática com axe no Playwright para as telas do PWA |
| RNF-11 | Observabilidade | Logs em JSON (pino) com `request_id` e `tenant_id`; erros no Sentry com `beforeSend` que remove corpo de request, notas, anamnese, valores de exames e texto do diário |
| RNF-12 | Idioma e formatos | pt-BR; datas `dd/mm/aaaa`; números com vírgula decimal; telefone exibido `(11) 91234-5678` e armazenado em E.164 |
| RNF-13 | Armazenamento | Cota de 5 GB por tenant em `/data` (RN-18); alerta ao admin com o disco da VPS em 70% (no painel do admin, o marcador em texto "(acima do limite de 70%)", não só cor); meta de ≤ 300 KB por foto do diário após a conversão |

---

## 6. Integrações

### INT-01 — WhatsApp Cloud API (Meta)

| Item | Especificação |
|---|---|
| API | Graph API, `POST /{phone-number-id}/messages` (versão fixada em variável de configuração) |
| Autenticação | Bearer token permanente de **System User** (`WHATSAPP_TOKEN`) |
| Número | Único da plataforma (D-07); nome de exibição a definir |
| Templates (categoria utility, pt_BR) | `convite_paciente` (nome da nutri, link); `lembrete_24h` (nome do paciente, nome da nutri, data, hora, modalidade + botões *quick reply* **"Confirmo"** / **"Preciso remarcar"**); `lembrete_2h` (data, hora, endereço ou link) |
| Webhook | `GET` para verificação (`hub.verify_token` = `WHATSAPP_VERIFY_TOKEN`); `POST` validado pelo header `X-Hub-Signature-256` (HMAC-SHA256 com `WHATSAPP_APP_SECRET`), com requisição inválida recusada com 401; responde 200 em ≤ 2 s e processa de forma assíncrona na fila |
| Eventos tratados | `statuses` (sent, delivered, read, failed) → `notifications.status`; `messages` do tipo `button` → "Confirmo" leva a consulta a `confirmada`; "Preciso remarcar" envia de volta o link de remarcação |
| Idempotência | Chave = `provider_msg_id`; um evento repetido não altera o estado de novo |
| Falhas | Timeout de 10 s; 3 novas tentativas com backoff exponencial (1, 5 e 25 min); depois disso, `falhou` e envio de **fallback por e-mail** |
| Pré-condições para envio | Paciente com `whatsapp_optin_em` preenchido e `whatsapp_optout_em` vazio, telefone E.164 válido e cota do tenant disponível (RN-09). O opt-in pode ser **declarado pela nutricionista** (paciente autorizou presencialmente, `whatsapp_optin_origem = 'nutri'`) ou dado pelo paciente no aceite; é obrigatório antes de qualquer mensagem, inclusive o convite (política da Meta) |
| Respostas livres | A resposta ao botão "Preciso remarcar" é texto livre, permitido porque o toque do paciente abre a janela de atendimento de 24 h da Meta |
| Risco de categoria | A Meta pode reclassificar um template como *marketing* (custo maior). Os textos devem ser estritamente transacionais |

### INT-02 — E-mail transacional (Resend)

API REST com Bearer (`RESEND_API_KEY`); remetente `EMAIL_FROM` no domínio próprio, com SPF, DKIM e DMARC (`p=quarantine`). Modelos em componentes React próprios renderizados com `react-dom/server` (**Plano 02:** os pacotes `@react-email/*` foram marcados como *no longer supported* e o substituto `react-email@6` levaria o CLI de preview para as dependências de produção): convite da nutricionista, convite do paciente, redefinição de senha, confirmação/cancelamento de agendamento, lembretes (fallback), exportação de dados pronta. Retry: 3 novas tentativas (backoff exponencial a partir de 60 s; mesma leitura do INT-01). Em dev e no CI, o transporte é o **Mailpit** (`EMAIL_TRANSPORT=mailpit`; padrão `resend` em produção).

### INT-03 — Web Push (VAPID)

Biblioteca `web-push`; chaves em `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`. Uma inscrição por dispositivo (`push_subscriptions`). Resposta 404/410 do serviço de push → inscrição removida. No iOS, o push só funciona com o PWA **instalado na tela inicial**; o PWA mostra um tutorial de instalação ao detectar Safari no iOS sem modo standalone.

### INT-04 — Tabela TACO

Carga única (seed versionado no repositório) a partir do CSV da TACO 4ª edição (NEPA/UNICAMP), com a fonte citada no rodapé do PDF e na tela de alimentos. `foods.tenant_id IS NULL` = TACO, somente leitura. Valores "Tr" (traço) e "NA" → `0` e `NULL`, respectivamente.

**A TACO não traz medidas caseiras.** O seed de `medidas_caseiras` vem da tabela pública do IBGE (*POF 2008–2009 — Tabela de Medidas Referidas para os Alimentos Consumidos no Brasil*), casada manualmente com os **150 alimentos mais usados** (lista a validar com a Debby). Os demais alimentos ficam só em gramas até a nutricionista cadastrar uma medida própria (medidas próprias por tenant, na tabela 🔒 `food_measures`). Ver P-10.

### INT-05 — Vídeos (YouTube / Vimeo)

Sem API: a nutricionista cola a URL; o sistema extrai o ID (regex) e renderiza o player com `youtube-nocookie.com/embed/{id}` ou `player.vimeo.com/video/{id}`. A capa é obtida via oEmbed (`youtube.com/oembed`, `vimeo.com/api/oembed.json`) no momento do cadastro e **baixada para `/data`** (sem imagem de terceiros no PWA); se o oEmbed falhar, o cadastro não é bloqueado e o sistema usa uma capa padrão.

### INT-06 — Cloudflare Turnstile

Widget anti-robô na página pública `/n/<slug>` e na recuperação de senha. O token é validado no servidor (`POST https://challenges.cloudflare.com/turnstile/v0/siteverify`, com `TURNSTILE_SECRET_KEY`) antes de qualquer escrita. Se o Turnstile estiver fora do ar, o formulário público mostra *"Tente novamente em alguns minutos"* e **não** aceita envio sem verificação. Custo: gratuito. **Plano 02:** o E2E usa as chaves de **teste** oficiais da Cloudflare com o `siteverify` real (sem conta), e a validação do ambiente recusa chaves de teste em produção (`NODE_ENV=production` com `APP_URL` fora de `localhost`): *"TURNSTILE_* de teste não pode ser usada em produção"*.

---

## 7. Modelo de dados

Convenções: PK `id uuid` (v7; **Plano 01:** v4 via `gen_random_uuid()` — o Postgres 16 não tem `uuidv7()` nativo); `created_at` e `updated_at timestamptz`; 🔒 = tem `tenant_id uuid NOT NULL` + RLS forçada com a política `tenant_id = current_setting('app.tenant_id')::uuid`.

| Tabela | Campos-chave | Restrições / índices |
|---|---|---|
| `tenants` | `slug`, `nome_exibicao`, `crn`, `logo_path`, `cor_primaria`, `fuso` (padrão `America/Sao_Paulo`), `status` (`ativa`/`suspensa`), `wa_cota_mensal` (padrão 500), `antecedencia_min_h` (12), `cancelamento_min_h` (24), `endereco_consultorio`, `link_online_padrao`, `agendamento_publico_ativo` (padrão true), `mostrar_perc_gordura_paciente` (padrão false), `armazenamento_bytes`, `dpa_aceito_em`, `dpa_versao` | `slug` UNIQUE, regex `^[a-z0-9-]{3,40}$` |
| `users` | `email` (citext), `password_hash`, `totp_secret_enc`, `role` (`admin`/`nutri`/`paciente`), `email_verificado_em`, `nutri_tenant_id` (se role = nutri) — **Plano 01:** implementada pelas tabelas geradas pelo CLI do Better Auth (`user`, `session`, `account`, `verification`, `two_factor`, `rate_limit`); `user` cumpre o papel de `users` | `email` UNIQUE |
| `session`, `account`, `verification`, `two_factor`, `rate_limit` | Gerenciadas pelo Better Auth (Plano 01) | — |
| `consents` | `user_id`, `termo_versao`, `aceito_em`, `ip` (**Plano 02:** criada agora para o aceite do DPA; texto provisório `0.1-provisorio`, ver P-02) | UNIQUE (`user_id`, `termo_versao`); o role da aplicação não faz `UPDATE`/`DELETE` (prova de aceite) |
| `invites` | `user_id`, `tipo` (`nutri`), `token_hash` (só o SHA-256 do token), `expira_em`, `usado_em` (**Plano 02**) | `token_hash` UNIQUE; índice único parcial (`user_id`) WHERE `usado_em IS NULL` (um convite pendente por usuário) |
| 🔒 `stored_files` | `tipo` (`logo`/`capa`/`exame`/`plano_pdf`/`diario_foto`/`orientacao_pdf`/`exportacao`), `caminho`, `bytes`, `mime`, `criado_por` (**Plano 02:** controle de cota e de caminhos) | `caminho` UNIQUE; CHECK `bytes > 0` |
| `backup_runs` | `tipo` (`banco`/`arquivos`), `ok`, `bytes`, `detalhe`, `iniciado_em`, `concluido_em` (**Plano 02:** escrita só pelo script de backup do host; o app só lê) | índice (`tipo`, `concluido_em`) |
| 🔒 `patients` | `user_id` (nulo até aceitar o convite), `nome`, `data_nascimento` e `sexo` (`F`/`M`, usados nas fórmulas; **nulos só quando `origem = 'agendamento_publico'`**, com a pendência "Completar cadastro" no painel), `telefone_e164`, `email`, `origem` (`nutri`/`agendamento_publico`), `whatsapp_optin_em`, `whatsapp_optin_origem` (`nutri`/`paciente`), `whatsapp_optout_em`, `status` (`ativo`/`arquivado`/`bloqueado`), `bloqueado_em`, `anonimizar_apos` (data), `anonimizado_em` | UNIQUE (`tenant_id`, `email`); índice (`tenant_id`, `status`) |
| 🔒 `patient_tags` / 🔒 `patient_tag_links` | `nome` / (`patient_id`, `tag_id`) | UNIQUE (`tenant_id`, `nome`) |
| 🔒 `consultations` | `patient_id`, `appointment_id` (nulo), `data`, `notas_privadas`, `orientacoes_paciente` | — |
| 🔒 `anamnesis_templates` | `nome`, `schema jsonb` (lista de perguntas: tipo, rótulo, opções, obrigatória) | — |
| 🔒 `anamneses` | `patient_id`, `template_id`, `template_snapshot jsonb`, `respostas jsonb` | — |
| 🔒 `anthropometry` | `patient_id`, `consultation_id`, `data`, `peso_kg numeric(5,2)`, `altura_cm numeric(5,1)`, `imc` (GENERATED), `circunferencias jsonb`, `dobras_mm jsonb`, `protocolo` (`jp3`/`jp7`/`nenhum`), `densidade`, `perc_gordura` | CHECK peso 1–400, altura 30–250 |
| 🔒 `energy_calcs` | `patient_id`, `formula` (`harris_benedict`/`mifflin`/`fao_oms`), `peso_kg`, `altura_cm`, `idade`, `sexo`, `fator_atividade numeric(3,2)`, `tmb`, `get` | CHECK fator 1,00–2,50 |
| 🔒 `exams` | `patient_id`, `data`, `titulo`, `arquivo_path`, `valores jsonb` (lista de {nome, valor, unidade, referência}) | — |
| `foods` | `tenant_id` (**nulo = TACO**), `nome`, `grupo`, `kcal`, `proteina_g`, `carboidrato_g`, `lipidio_g`, `fibra_g` (por 100 g), `micros jsonb`, `medidas_caseiras jsonb` (lista de {nome, gramas}) | RLS: leitura se `tenant_id IS NULL OR tenant_id = atual`; escrita só se `tenant_id = atual` (TACO é imutável para a aplicação); GIN `pg_trgm` + `unaccent` em `nome` |
| 🔒 `food_measures` | `food_id`, `nome`, `gramas` | Medidas caseiras criadas pela nutricionista (complementam o seed IBGE) |
| 🔒 `meal_plans` | `patient_id` (nulo se modelo), `is_template`, `titulo`, `meta_kcal`, `energy_calc_id`, `status` (`rascunho`/`publicado`/`arquivado`), `versao`, `publicado_em`, `origem_plan_id`, `mostrar_calorias` (padrão false), `pdf_path` (gerado na publicação) | Índice único parcial (`patient_id`) WHERE `status = 'publicado'` |
| 🔒 `meals` | `plan_id`, `nome`, `horario time`, `ordem`, `observacao`, `recipe_content_id` (nulo) | — |
| 🔒 `meal_items` | `meal_id`, `food_id`, `quantidade_g numeric(7,2)`, `medida_caseira_txt`, `grupo_substituicao smallint` (nulo = item principal) | CHECK quantidade > 0 |
| 🔒 `diary_entries` | `patient_id`, `data_hora`, `refeicao`, `texto`, `foto_path`, `comentario_nutri`, `comentado_em`, `visto_pela_nutri_em` | Índice (`patient_id`, `data_hora DESC`) |
| 🔒 `availability_rules` | `dia_semana 0–6`, `inicio time`, `fim time`, `duracao_min`, `modalidade` (`presencial`/`online`/`ambas`) | CHECK `fim > inicio` |
| 🔒 `availability_blocks` | `inicio timestamptz`, `fim timestamptz`, `motivo` | — |
| 🔒 `appointments` | `patient_id`, `periodo tstzrange`, `modalidade`, `link_online`, `status` (`agendada`/`confirmada`/`cancelada`/`realizada`/`faltou`), `origem` (`nutri`/`paciente`), `cancelado_por`, `motivo_cancelamento`, `pedido_remarcacao_em` | `EXCLUDE USING gist (tenant_id WITH =, periodo WITH &&) WHERE (status <> 'cancelada')` |
| 🔒 `notifications` | `appointment_id` (nulo), `patient_id`, `canal` (`email`/`whatsapp`/`push`), `tipo`, `status` (`pendente`/`enviada`/`entregue`/`lida`/`falhou`/`ignorada`), `motivo_ignorada`, `provider_msg_id`, `tentativas`, `agendada_para` | UNIQUE (`provider_msg_id`); UNIQUE (`appointment_id`, `canal`, `tipo`); ao reativar um tenant ou remarcar, a linha existente é **atualizada** (não duplicada) |
| `push_subscriptions` | `user_id`, `endpoint`, `p256dh`, `auth`, `user_agent` | UNIQUE (`endpoint`) |
| 🔒 `contents` | `tipo` (`video`/`receita`/`orientacao`), `titulo`, `resumo`, `corpo_md`, `video_provider`, `video_id`, `capa_path`, `pdf_path`, `etiquetas text[]`, `visibilidade` (`todos`/`etiquetas`/`pacientes`), `status` (`rascunho`/`publicado`), `publicado_em` | GIN em `etiquetas`; full-text em `titulo` + `resumo` |
| 🔒 `recipes` | `content_id` (1:1), `rendimento_total_g`, `porcao_g`, `modo_preparo_md`, `tempo_preparo_min` | CHECK `porcao_g <= rendimento_total_g` |
| 🔒 `recipe_ingredients` | `recipe_id`, `food_id`, `quantidade_g`, `medida_caseira_txt` | — |
| 🔒 `content_audience` | `content_id`, `patient_id` (nulo), `tag_id` (nulo) | CHECK exatamente um dos dois preenchido |
| 🔒 `content_views` | `content_id`, `patient_id`, `visto_em` | UNIQUE (`content_id`, `patient_id`) → conta pacientes únicos |
| 🔒 `content_favorites` | `content_id`, `patient_id` | UNIQUE (`content_id`, `patient_id`) |
| 🔒 `audit_log` | `actor_user_id`, `acao` (`ler`/`criar`/`alterar`/`excluir`/`exportar`/`bloquear`/`anonimizar`), `entidade`, `entidade_id`, `patient_id` (nulo; **Plano 02:** o "Histórico de acessos" do paciente inclui leituras e alterações das tabelas filhas, não só `entidade = 'patients'`), `ip`, `criado_em` | Append-only: `REVOKE UPDATE, DELETE` do role da aplicação; política adicional `patient_isolation` por `patient_id` |
| 🔒 `privacy_requests` | `patient_id`, `tipo` (`exportacao`/`exclusao`), `status` (`aberto`/`concluido`), `prazo`, `concluido_em` | Prazo de resposta ao titular: 15 dias |
| 🔒 `access_events` | `patient_id`, `dia date` | Base da métrica CS-02; UNIQUE (`patient_id`, `dia`) |

---

## 8. Regras de negócio

| ID | Regra |
|---|---|
| RN-01 | Cada paciente tem no máximo **1 plano publicado** (garantido por índice único parcial). Publicar arquiva o anterior na mesma transação. Plano publicado é imutável: "Editar" cria uma cópia `rascunho` com `versao + 1` |
| RN-02 | Nutriente do item = `valor_por_100g × quantidade_g / 100`. Totais por refeição e do dia contam **só itens principais** (`grupo_substituicao IS NULL`). Indicador × `meta_kcal`: verde se \|desvio\| ≤ 5%; amarelo se 5% < \|desvio\| ≤ 10%; vermelho se \|desvio\| > 10%. Arredondamento na exibição: kcal inteiro, gramas com 1 casa |
| RN-03 | Horários livres = regras de atendimento − bloqueios − consultas não canceladas. O paciente agenda com antecedência mínima de `antecedencia_min_h` (padrão 12 h) e máxima de 60 dias. Em caso de agendamento simultâneo, o `EXCLUDE` recusa o segundo e a UI mostra: *"Esse horário acabou de ser ocupado. Escolha outro."* |
| RN-04 | O paciente pode cancelar ou remarcar até `cancelamento_min_h` (padrão 24 h) antes do início. Depois disso, os botões somem e aparece: *"Para alterar, fale com sua nutricionista."* A nutricionista pode alterar a qualquer momento |
| RN-05 | Lembretes em **24 h** e **2 h** antes do início, por todos os canais disponíveis para o paciente (e-mail sempre; WhatsApp se houver opt-in e cota; push se houver inscrição). O lembrete é **ignorado** (`status = ignorada` + motivo) se: consulta cancelada; paciente arquivado; horário de envio já passou quando a consulta foi criada; horário de envio no intervalo **[21:00, 08:00)** no fuso do tenant (08:00 em ponto é permitido). Remarcar cancela os lembretes pendentes e agenda novos |
| RN-06 | Todas as datas são gravadas em UTC (`timestamptz`) e exibidas no `fuso` do tenant. Se o fuso do dispositivo do paciente for diferente, o PWA mostra a sigla junto do horário (ex.: "09:00 (horário de Brasília)") |
| RN-07 | Foto do diário: até 10 MB, JPEG/PNG/HEIC; o worker converte para JPEG com no máximo 1600 px no maior lado, qualidade 80, e remove EXIF/GPS. Até **10 registros no diário por paciente por dia** |
| RN-08 | Paciente arquivado: perde o login do portal para aquele tenant, não recebe notificações e sai das audiências de conteúdo; o prontuário é mantido. Desarquivar restaura o acesso |
| RN-09 | Cota de WhatsApp contada por tenant e mês civil; conta cada mensagem **aceita pela API da Meta** (status `enviada` ou posterior). Respostas livres dentro da janela de 24 h não contam. Ao atingir **80%**: aviso no painel + e-mail para a nutricionista. A **100%**: WhatsApp suspenso até o mês seguinte (ou até o admin ampliar a cota); os lembretes seguem por e-mail e push |
| RN-10 | Vídeo: aceitar só URLs de `youtube.com`, `youtu.be`, `vimeo.com`; exibir com `youtube-nocookie.com` ou `player.vimeo.com`. O formulário mostra o aviso: *"Vídeos não listados podem ser vistos por quem tiver o link."* |
| RN-11 | Receita: nutriente por porção = `Σ(nutriente de cada ingrediente) × porcao_g / rendimento_total_g`. Ex.: ingredientes somando 2000 kcal, rendimento 1000 g, porção 250 g → **500 kcal/porção** |
| RN-12 | Audiência do conteúdo: `todos` = pacientes ativos do tenant; `etiquetas` = pacientes ativos com pelo menos uma das etiquetas; `pacientes` = lista explícita. A audiência é avaliada **na leitura**, então um paciente que recebe a etiqueta depois passa a ver o conteúdo. **Exceção:** uma receita anexada a uma refeição do plano publicado do paciente (US-054) fica visível para ele, mesmo fora da audiência |
| RN-13 | Lista de compras: soma das quantidades dos itens principais do plano publicado × nº de dias escolhido (1–14, padrão 7), agrupada pelo `grupo` do alimento e exibida em g/kg (≥ 1000 g → kg com 1 casa). O paciente pode marcar itens como comprados; a marcação é salva no dispositivo |
| RN-14 | TMB e GET são exibidos em kcal inteiros, com arredondamento meio para cima. Idade para fórmulas = anos completos na data do cálculo. FAO/OMS usa a faixa etária correspondente; não se aplica a menores (RN-17) |
| RN-15 | Tenant suspenso: nutricionista e pacientes veem a tela *"Conta temporariamente indisponível"*; o worker não envia notificações desse tenant; os dados ficam intactos |
| RN-16 | Agendamento público (`/n/<slug>`), só se `agendamento_publico_ativo`: exige Turnstile válido + **código de 6 dígitos enviado ao e-mail** (válido por 10 min) antes de criar paciente e consulta; máximo de 3 consultas futuras por e-mail no tenant e 10 tentativas por IP por hora. O paciente criado tem `origem = 'agendamento_publico'` |
| RN-17 | **Somente adultos** (decisão D-11): o cadastro de paciente exige idade ≥ 18 anos na data do cadastro (erro: *"O sistema atende apenas pacientes a partir de 18 anos"*); o agendamento público exige declarar ter 18 anos ou mais |
| RN-18 | Cota de armazenamento: 5 GB por tenant (logo, capas, PDFs, exames, fotos). Em 80%, aviso à nutricionista; em 100%, novos uploads são recusados com *"Espaço de armazenamento esgotado. Fale com o suporte."* e o restante do sistema continua funcionando |

Fórmulas: ver **Apêndice A**.

---

## 9. Ferramentas do projeto

### 9.1 Stack da aplicação

| Camada | Escolha |
|---|---|
| Runtime | Node 24 LTS · TypeScript 5 `strict` · pnpm |
| Framework | Next.js 16 (App Router) · React 19 |
| Banco / ORM | PostgreSQL 16 (extensões `citext`, `pg_trgm`, `unaccent`, `btree_gist`) · Drizzle ORM + drizzle-kit (migrations SQL versionadas) |
| Autenticação | Better Auth (e-mail/senha, 2FA TOTP, sessões no Postgres) |
| Validação | Zod (schemas compartilhados entre formulário e servidor) |
| UI | Tailwind CSS 4 · shadcn/ui · react-hook-form · Recharts · lucide-react |
| PWA / push | Serwist (`@serwist/turbopack`, compatível com Turbopack — P-14 resolvida) · `web-push` |
| Fila / agendamento | pg-boss |
| PDF | `@react-pdf/renderer` |
| Imagem | `sharp` · `heic-convert` |
| E-mail | Resend SDK · componentes React próprios (`react-dom/server`) |
| Logs / erros | pino · `@sentry/nextjs` |
| Testes | Vitest (unitários) · Testcontainers (Postgres real, RLS) · Playwright + `@axe-core/playwright` (E2E + acessibilidade) · k6 (carga, antes do go-live) |
| Qualidade | ESLint · Prettier · `tsc --noEmit` no CI |

### 9.2 CLIs

| CLI | Situação no servidor (2026-09-27) | Uso |
|---|---|---|
| `node` 24, `pnpm` 12, `npx`, `docker` 29, `git`, `jq`, `curl`, `claude` | ✅ instalados | Desenvolvimento |
| `gh` 2.45 | ✅ instalado (versão antiga; atualizar é opcional) | Repositório, PRs, Actions |
| `psql` / `pg_dump` (`postgresql-client-16`) | ❌ instalar no host via apt, **com confirmação** — **Plano 02:** não é necessário agora (o backup e a restauração de conferência usam o `pg_dump`/`pg_restore` do container `nutri_db`); fica para o P08-04 | Inspeção manual e **teste mensal de restauração** |
| `rclone` | ❌ instalar no host, **com confirmação** — **Plano 02:** obrigatório, pois o backup diário roda no host | Envio diário do backup (`rclone rcat`/`sync` num remoto `crypt` sobre o R2) e restauração manual |
| `drizzle-kit`, `playwright`, `web-push`, `@sentry/cli`, `k6` (via Docker) | Dependências de dev do projeto / imagem Docker | Migrations, E2E, VAPID, source maps, carga |
| Easypanel | Sem CLI/MCP oficial | Serviço com origem = imagem Docker do GHCR; deploy pelo webhook do Easypanel chamado no fim do CI; configuração **pelo painel** |
| Meta / WhatsApp | Sem CLI | WhatsApp Manager + Graph API via `curl` |

### 9.3 Servidores MCP (Claude Code)

Configuração em `.mcp.json` na raiz do repositório, **sem segredos**. As credenciais vêm de variáveis de ambiente.

| MCP | Situação | Uso |
|---|---|---|
| Context7 | ✅ ativo | Documentação atualizada de Next 16, Drizzle, Better Auth, Serwist, pg-boss |
| Playwright | ✅ ativo | Verificação visual do painel e do PWA; depuração de E2E |
| GitHub | ⚠️ ativo, **token inválido** ("Authorization header is badly formatted") | Issues, PRs, CI; corrigir o token antes de começar |
| Linear | ✅ ativo (exige login) | Opcional: backlog das US |
| Postgres MCP Pro (`crystaldba/postgres-mcp`) | ➕ adicionar | **Modo `restricted` (só leitura), apenas no banco de dev.** Proibido apontar para produção |
| shadcn MCP (`npx shadcn@latest mcp`) | ➕ adicionar | Busca e instalação de componentes |
| Next.js DevTools MCP (`next-devtools-mcp`) | ➕ adicionar | Erros de build e de runtime do `next dev` |
| Sentry MCP (remoto oficial) | ➕ adicionar antes do go-live | Investigação de erros de produção |
| Plugins Vercel e Supabase | ➖ desativar neste projeto | Fora da stack; geram sugestões irrelevantes |

### 9.4 Ambientes

| Ambiente | Onde | Composição |
|---|---|---|
| dev | VPS, `docker compose` (padrão do `cronogramasys-dev`) | Postgres 16 + Mailpit + `next dev` + worker; WhatsApp com o **número de teste** da Meta; memória limitada no compose (db 512 MB) |
| prod | Easypanel, projeto `nutri` | `nutri_app`, `nutri_worker`, `nutri_db` + volume `/data`; limites do RNF-03 |
| staging | Fase 2 | Criar quando entrar a segunda cliente |

### 9.5 Contas e serviços externos

| Serviço | Para quê | Observação |
|---|---|---|
| GitHub (repo privado) + GHCR | Código, CI, registro das imagens Docker | O Easypanel precisa de credencial de leitura do GHCR (token com escopo `read:packages`) |
| Domínio + DNS | `app.<dominio>`, e-mail | Registro A → IP da VPS; SPF, DKIM, DMARC |
| Meta Business (verificada) + app WhatsApp Cloud API | INT-01 | A verificação e a aprovação dos templates **levam dias**; começar primeiro |
| Resend | INT-02 | Domínio verificado. O plano gratuito (3 mil e-mails/mês, 100/dia) atende à Debby; com mais tenants, passa a ser pago (~US$ 20/mês por 50 mil) |
| Cloudflare Turnstile | INT-06 | Gratuito |
| Cloudflare R2 | Backup offsite | Bucket privado; chave com escopo só nesse bucket |
| Sentry | Erros | Plano gratuito atende ao MVP |
| UptimeRobot ou Uptime Kuma (Easypanel) | RNF-04 | — |

### 9.6 Variáveis de ambiente

Somente os nomes; os valores são definidos no Easypanel (prod) e em `.env.local` (dev, fora do git). O repositório terá um `.env.example` só com os nomes.

`DATABASE_URL` · `DATABASE_URL_MIGRATOR` · `AUTH_SECRET` · `ENCRYPTION_KEY` · `APP_URL` · `WHATSAPP_TOKEN` · `WHATSAPP_PHONE_NUMBER_ID` · `WHATSAPP_APP_SECRET` · `WHATSAPP_VERIFY_TOKEN` · `WHATSAPP_API_VERSION` · `RESEND_API_KEY` · `EMAIL_FROM` · `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` · `SENTRY_DSN` · `SENTRY_AUTH_TOKEN` · `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET` · `BACKUP_PASSPHRASE` · `TURNSTILE_SITE_KEY` · `TURNSTILE_SECRET_KEY` · `FILE_URL_SECRET` · `DATA_DIR` · `EMAIL_TRANSPORT` (`resend`/`mailpit`; padrão `resend` em produção) · `MAILPIT_URL` (dev/CI)

**Plano 02:** `R2_*` e `BACKUP_PASSPHRASE` **não** são variáveis do Easypanel: ficam só em `/etc/nutri-backup/backup.env` (root, modo 600) no host, no formato `RCLONE_CONFIG_*`. A senha do crypt também fica guardada fora da VPS pelo dono (sem ela o backup é irrecuperável).

`DATABASE_URL_MIGRATOR` usa um role dono do schema (roda migrations); `DATABASE_URL` usa um role de aplicação **sem** `BYPASSRLS` e sem ser dono das tabelas.

### 9.7 CI/CD (GitHub Actions)

| Gatilho | Etapas |
|---|---|
| Pull request | `pnpm install --frozen-lockfile` → lint → `tsc --noEmit` → Vitest → testes de RLS/isolamento (Testcontainers) → build → Playwright E2E (login, criar+publicar plano, agendar online, lembrete gerado, conteúdo visível só para a audiência certa) |
| Merge na `main` | Build da imagem **no GitHub Actions** (não na VPS, para não consumir CPU e memória do CRM) → push para o GHCR com tag = SHA do commit → chamada ao webhook de deploy do Easypanel → no container do app, `migrate` roda antes do `start` (o worker espera a versão do schema) |

**Deploy e migrations:**
- Ativar no Easypanel o deploy sem downtime (*start-first*), se o recurso estiver disponível na versão instalada. Senão, aceitar ~30 s de indisponibilidade e publicar fora do horário de atendimento.
- Migrations seguem o padrão **expand/contract** (compatíveis com a versão anterior do código), porque as duas versões convivem por alguns segundos. O Drizzle roda cada migration em transação: se falhar, nada é aplicado e o container novo não sobe.
- Rollback = redeploy da tag anterior no Easypanel.
- O primeiro admin é criado pelo comando `pnpm admin:criar <email>` executado no container (sem tela pública); o link de definição de senha (1 h, uso único) sai só no terminal de quem executa. **Plano 01:** até o envio de e-mail existir (P02-01, Plano 02), "Esqueci minha senha" apenas registra um aviso no log, sem entregar e-mail. **Plano 02:** o e-mail existe: "Esqueci minha senha" envia o link pela fila e o convite de nutricionista (72 h) tem token próprio; o convite de paciente (7 dias) fica para o Plano 06.

O repositório terá um `CLAUDE.md` com stack, comandos, convenções de módulo, a obrigação de usar `withTenant` e a proibição de MCP de banco em produção.

---

## 10. Roadmap

| Fase | Conteúdo |
|---|---|
| **MVP** | M1–M6 (este documento) |
| **Fase 2 — Monetização** | Cobrança da assinatura via **Asaas** (PIX, boleto, cartão, webhooks); cadastro pela própria nutricionista + trial de 30 dias; financeiro do consultório; recepcionista; upload próprio de vídeo (Bunny Stream); ambiente de staging; acesso de suporte autorizado |
| **Fase 3 — Engajamento** | Chat nutricionista ↔ paciente; WhatsApp com número próprio (Embedded Signup / Tech Provider); Google Agenda; prescrição de suplementos e fitoterápicos; TBCA; assistente com IA para montar planos |
| **Fase 4 — Expansão** | App nas lojas; site profissional + vitrine pública de conteúdo; loja; videochamada interna |

---

## 11. Riscos e pendências

| ID | Item | Tipo | Ação / responsável |
|---|---|---|---|
| P-01 | Prazo de guarda do prontuário de nutrição (referência 20 anos) | Pendência | Validar com CRN/advogado antes do go-live |
| P-02 | Texto do termo de consentimento do paciente e do DPA da nutricionista | Pendência | Advogado; o sistema só versiona e registra o aceite. **Plano 02:** texto **provisório** do DPA (`DPA_VERSAO = '0.1-provisorio'`); o P08-06 publica o texto do advogado com nova versão, o que obriga novo aceite |
| P-03 | Nome do produto, domínio e nome de exibição do WhatsApp | Pendência | Dono do produto |
| P-04 | Verificação da Meta Business e aprovação dos templates (e possível reclassificação como marketing) | Risco de prazo/custo | Iniciar na semana 1; enquanto isso, lembretes por e-mail/push |
| P-05 | VPS única, compartilhada com o `cursoia_crm` em produção | Risco | Limites do RNF-03 + monitor + backup testado; migrar para VPS dedicada quando passar de ~20 tenants ou se o consumo exceder os limites |
| P-06 | Push no iOS exige instalação do PWA | Risco de adoção | Tutorial de instalação + WhatsApp/e-mail como canais principais |
| P-07 | Vídeo não listado no YouTube não é privado | Risco aceito | Aviso RN-10; Bunny Stream na Fase 2 |
| P-08 | Fórmulas e coeficientes do Apêndice A | Pendência | Debby valida com casos reais antes do go-live |
| P-09 | Token do MCP do GitHub inválido | Pendência técnica | Corrigir antes de iniciar o desenvolvimento |
| P-10 | A TACO não tem medidas caseiras; o casamento TACO × IBGE dos 150 alimentos mais usados é trabalho manual | Risco de esforço | Debby fornece a lista dos alimentos mais usados; o casamento vira tarefa do plano (estimar à parte) |
| P-11 | Atendimento de menores de 18 anos | **Resolvida (2026-09-27)** | A Debby não atende menores → RN-17 (somente adultos) |
| P-12 | Criptografia em repouso: o disco da VPS depende do provedor; só backups, `totp_secret` e URLs assinadas têm proteção própria. O dono do servidor tem acesso técnico ao banco | Risco aceito | Declarar no DPA; acesso SSH restrito; avaliar criptografia de colunas sensíveis (anamnese, notas) na Fase 2 |
| P-13 | Disco de 85 GB livres, compartilhado com outros projetos | Risco | RN-18 + alerta em 70% (RNF-13) |
| P-14 | Compatibilidade Serwist × Turbopack no Next 16 | **Resolvida (2026-09-28)** | Funciona com Turbopack: spike (P01-15) gerou o service worker em `/serwist/sw.js` (prebuild estático via `generateStaticParams`, `esbuild` só em build) e `/manifest.webmanifest`, ambos 200 num `next build && next start` de produção e numa imagem Docker prod (`pnpm prune --prod`) — Plano 06 usa `@serwist/turbopack` |
| P-15 | CS-03 depende da taxa de faltas anterior ao sistema | Pendência | Debby informa a taxa do mês anterior (base de comparação) |

---

## Apêndice A — Fórmulas (validar com a nutricionista)

Unidades: peso (P) em kg, altura (A) em cm, idade (I) em anos, soma de dobras (S) em mm.

**IMC** = P / (A/100)². Ex.: 70 kg, 175 cm → **22,86**.

**Harris-Benedict (1919)**
- Homem: 66,47 + 13,75·P + 5,003·A − 6,755·I
- Mulher: 655,1 + 9,563·P + 1,850·A − 4,676·I
- Ex.: mulher, 60 kg, 165 cm, 35 anos → **1370,5 kcal** (exibido como 1371)

**Mifflin-St Jeor (1990)**
- Homem: 10·P + 6,25·A − 5·I + 5
- Mulher: 10·P + 6,25·A − 5·I − 161
- Ex.: homem, 70 kg, 175 cm, 30 anos → **1648,75 kcal**; mulher, 60 kg, 165 cm, 35 anos → **1295,25 kcal**

**FAO/OMS (1985)**

| Idade | Homem | Mulher |
|---|---|---|
| 18 a 29 anos | 15,3·P + 679 | 14,7·P + 496 |
| 30 a 59 anos | 11,6·P + 879 | 8,7·P + 829 |
| 60 anos ou mais | 13,5·P + 487 | 10,5·P + 596 |

Ex.: mulher, 60 kg, 35 anos → **1351,0 kcal**.

**GET** = TMB × fator de atividade (1,00–2,50, informado pela nutricionista).

**Jackson & Pollock — densidade corporal (D)**
- 3 dobras, homem (peitoral, abdominal, coxa): D = 1,10938 − 0,0008267·S + 0,0000016·S² − 0,0002574·I
- 3 dobras, mulher (tríceps, supra-ilíaca, coxa): D = 1,0994921 − 0,0009929·S + 0,0000023·S² − 0,0001392·I
- 7 dobras, homem: D = 1,112 − 0,00043499·S + 0,00000055·S² − 0,00028826·I
- 7 dobras, mulher: D = 1,097 − 0,00046971·S + 0,00000056·S² − 0,00012828·I
- 7 dobras: peitoral, axilar média, tríceps, subescapular, abdominal, supra-ilíaca, coxa

**Siri**: %G = (495 / D) − 450.
- Ex.: homem, 30 anos, S (3 dobras) = 50 mm → D = 1,06432 → **15,08%**
- Ex.: mulher, 35 anos, S (3 dobras) = 60 mm → D = 1,04333 → **24,44%**

Esses exemplos são os casos de teste unitário obrigatórios do cálculo (tolerância ±0,01).

## Apêndice B — Glossário

| Termo | Significado |
|---|---|
| Tenant | A conta de uma nutricionista na plataforma; isola todos os dados dela |
| RLS | Row-Level Security: o Postgres filtra as linhas pelo tenant da sessão |
| PWA | Progressive Web App: site instalável no celular, com push |
| TMB / GET | Taxa metabólica basal / gasto energético total |
| VET | Valor energético total do plano (kcal do dia); base para o % de cada macronutriente |
| TACO | Tabela Brasileira de Composição de Alimentos (NEPA/UNICAMP) |
| Template (WhatsApp) | Mensagem pré-aprovada pela Meta, obrigatória para iniciar conversa |
| DPA | Contrato de tratamento de dados entre controladora (nutricionista) e operadora (plataforma) |
| RPO / RTO | Perda máxima de dados aceitável / tempo máximo para voltar ao ar |

## Apêndice C — Histórico de revisões

| Versão | Data | Alterações |
|---|---|---|
| 1.0 | 2026-09-27 | Versão inicial aprovada em conversa (Blocos 1, 2, 2b e 3 + M6) |
| 1.1 | 2026-09-27 | Revisão 2: isolamento também por paciente (RLS por `patient_id`); exclusão LGPD corrigida (bloqueio durante a guarda legal em vez de anonimização imediata); anti-abuso no agendamento público (Turnstile + código por e-mail, RN-16, INT-06); opt-in de WhatsApp antes do convite; medidas caseiras (fonte IBGE, `food_measures`); build fora da VPS (GHCR) e deploy com migrations expand/contract; worker com 512 MB e responsável pelos backups; heartbeat do worker no health check; cota de armazenamento (RN-18, RNF-13); menores de idade (RN-17); link online padrão e ativação do agendamento público; PDF gerado na publicação; faixas FAO/OMS sem sobreposição; novas pendências P-10 a P-15 |
| 1.2 | 2026-09-27 | P-11 resolvida: somente adultos (D-11, RN-17). Especificação aprovada |
| 1.3 | 2026-09-28 | Fechamento do Plano 01 (Fundação): desvios conscientes registrados no plano aplicados ao corpo da spec — tabela `users` implementada pelas tabelas do Better Auth (`user`, `session`, `account`, `verification`, `two_factor`, `rate_limit`); `totp_secret` cifrado pelo Better Auth (XChaCha20-Poly1305/`AUTH_SECRET`) em vez de AES-256-GCM/`ENCRYPTION_KEY` (que fica para dados de planos futuros); limite de tentativas de login por IP+rota (Better Auth) em vez de IP+e-mail; PK `uuid` v4 (`gen_random_uuid()`) em vez de v7 (Postgres 16 sem `uuidv7()` nativo); e-mail de recuperação e convites (72 h nutri / 7 dias paciente) adiados para o Plano 02 (P02-01), com o link de definição de senha do admin (1 h) entregue só pelo CLI `admin:criar`. P-14 resolvida: Serwist funciona com Turbopack (`@serwist/turbopack`); o service worker fica registrado só sob `/p/` e a home do paciente é `/p/inicio`. Sessão da equipe (nutri/admin) implementada como `expiresAt` = última atividade + 12 h, deslizando só em `requireUser` a cada 15 min. Migrations em produção rodam com role dono dedicado `nutri_owner` (sem superusuário, `CREATEROLE`/`NOBYPASSRLS`), e a credencial do migrator é removida do ambiente dos processos de app/worker. Renovação do cookie de sessão do paciente adiada para P06-11 |
| 1.4 | 2026-09-29 | Fechamento do Plano 02 (Plataforma): desvios conscientes aplicados ao corpo da spec e às histórias — backup (RNF-05) roda **no host** por `systemd` (`pg_dump` dentro do container `nutri_db`, `rclone` no host) e o worker só confere `backup_runs` e alerta, por orçamento do GHCR grátis e para o worker não precisar de `BYPASSRLS`; `R2_*` e `BACKUP_PASSPHRASE` ficam só em `/etc/nutri-backup/backup.env` no host, fora do Easypanel; modelos de e-mail em componentes React próprios com `react-dom/server` (pacotes `@react-email/*` descontinuados), retry de 3 **novas** tentativas, variáveis `EMAIL_TRANSPORT` e `MAILPIT_URL`; `audit_log.patient_id` (histórico por paciente) e tabelas novas `invites`, `stored_files`, `backup_runs`, além de `consents` (criada agora) e `tenants.dpa_versao`; módulos com vários arquivos em vez de um `service.ts`; contas criadas por Server Actions em vez de `POST /api/admin/tenants`; convite de paciente (7 dias) adiado para o Plano 06; teste mensal de restauração e `postgresql-client-16` no host para o P08-04; DPA com texto provisório (P-02); lembrete `ignorada`/reagendar na suspensão (US-004) no P05-06, marca no PWA e no PDF (US-005) nos Planos 06 e P04-09, aba "Histórico de acessos" (US-007) no P03-01, métricas de pacientes/consultas/mensagens com `NULL` até os Planos 03 e 05. Textos novos de interface: erros de formato de e-mail e de slug (US-001), "Conta suspensa: reative antes de reenviar o convite." e "Conta não encontrada." (US-001/US-004), recusa de SVG com filtros, SVG pesado e logo ocupado (US-005), "Use no máximo 500 caracteres" (US-005), "Aguarde a verificação anti-robô." (US-002), "(acima do limite de 70%)" (RNF-13), com nomes acessíveis por conta nos botões do painel do admin. Logo em SVG (US-005): rasterizado em processo filho morto em 5 s, um logo por vez e resfriamento de 10 min por tenant; SVG com filtro, com `<!DOCTYPE` fora da forma comum dos editores ou com marcação XML sem fechamento é recusado com a mensagem de filtro; **risco residual aceito pelo dono (2026-09-29):** um filtro escondido por artifício de parser ainda pode passar, contido pelo processo filho morto em 5 s, pelo logo único por vez e pelo resfriamento de 10 min por tenant. Chaves de teste do Turnstile no E2E, recusadas em produção |
