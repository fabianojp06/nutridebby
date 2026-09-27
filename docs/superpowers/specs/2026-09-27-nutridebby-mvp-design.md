# NutriDebby — Especificação do MVP (Design)

| Item | Valor |
|---|---|
| Versão | 1.0 |
| Data | 2026-09-27 |
| Status | Aguardando revisão |
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

---

## 2. Escopo

### 2.1 Módulos do MVP

| ID | Módulo | Conteúdo |
|---|---|---|
| M1 | **Plataforma & acesso** | Multi-tenant; login e-mail/senha; 2FA TOTP opcional para nutricionista; recuperação de senha; painel admin (criar/suspender/reativar contas); configuração da marca; auditoria |
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
| **Admin da plataforma** | Criar, suspender e reativar tenants; ver métricas agregadas de uso (nº de pacientes, consultas, mensagens enviadas, cota de WhatsApp); ajustar a cota de WhatsApp do tenant | Ler prontuário, plano, diário, exames ou qualquer dado de saúde. Exceção: suporte a um caso específico, **com autorização registrada da nutricionista** e com o acesso auditado (Fase 2; no MVP não há essa tela) |
| **Nutricionista** (dona do tenant) | Tudo dentro do próprio tenant | Ver dados de outro tenant |
| **Paciente** | Ver o próprio plano publicado, a evolução, as orientações e a agenda; preencher o diário; agendar/remarcar dentro das regras; ver os conteúdos destinados a ele; exportar os próprios dados | Ver `notas_privadas`, planos em rascunho, dados de outros pacientes |

**Modelo de identidade:** o login (`users`) é global por e-mail. O prontuário (`patients` e dependentes) pertence ao tenant. Um mesmo usuário pode ser paciente de mais de um tenant; cada nutricionista vê só o próprio histórico. No PWA, se houver mais de um vínculo, o paciente escolhe a nutricionista ao entrar.

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
│               processamento de imagem, backups)             │
├─────────────────────────────────────────────────────────────┤
│ nutri_db      PostgreSQL 16 — RLS por tenant_id; também     │
│               guarda a fila pg-boss (sem Redis)             │
├─────────────────────────────────────────────────────────────┤
│ volume /data  PDFs de exames, fotos do diário, capas, logos │
│               (servidos só por URL assinada, TTL 5 min)     │
└─────────────────────────────────────────────────────────────┘
            │ backup diário criptografado (rclone)
            ▼
     Cloudflare R2 (offsite)

Externos: WhatsApp Cloud API (Meta) · Resend (e-mail) · Web Push (VAPID) · Sentry
```

### 4.1 Organização do código

Monólito modular: `src/modules/{plataforma,pacientes,planos,agenda,portal,conteudo}`. Cada módulo expõe um `service.ts` com funções de domínio. As rotas e a UI chamam só o service, nunca o banco direto. O acesso ao banco passa por um helper `withTenant(tenantId, fn)`, que abre a transação e executa `SET LOCAL app.tenant_id = …` antes de qualquer consulta.

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
| RNF-01 | Desempenho | Route Handlers com p95 ≤ 300 ms; LCP do PWA ≤ 2,5 s em 4G (Lighthouse, perfil "Slow 4G"); recálculo do plano ao adicionar/alterar item ≤ 100 ms (calculado no cliente) |
| RNF-02 | Capacidade | 50 tenants × 300 pacientes ativos (15 mil pacientes) e 100 usuários simultâneos, sem violar o RNF-01 (teste de carga com k6 antes do go-live) |
| RNF-03 | Limites na VPS | Limites definidos no Easypanel: `nutri_app` 1 GB / 1 vCPU; `nutri_db` 1 GB; `nutri_worker` 256 MB. O `cursoia_crm` não pode ser afetado. Recomendação à parte: criar 2 GB de swap na VPS (exige confirmação do dono do servidor) |
| RNF-04 | Disponibilidade | 99% ao mês (VPS única, sem HA — risco aceito). Monitor externo checa `GET /api/health` a cada 1 min e alerta em ≤ 2 min |
| RNF-05 | Backup | `pg_dump` diário às 03h (America/Sao_Paulo) + cópia de `/data`, criptografados (rclone crypt) no R2; retenção de 7 diários + 4 semanais; RPO 24 h; RTO 4 h; **teste de restauração mensal documentado** |
| RNF-06 | Segurança | Senhas em argon2id; 2FA TOTP para a nutricionista; sessão expira após 12 h de inatividade (nutricionista/admin) ou 30 dias (paciente); limite de 5 tentativas de login a cada 15 min por IP+e-mail; HSTS; CSP restritiva (`frame-src` só para `youtube-nocookie.com` e `player.vimeo.com`); `totp_secret` criptografado com `ENCRYPTION_KEY` (AES-256-GCM); segredos só em variáveis do Easypanel |
| RNF-07 | Isolamento entre tenants | RLS habilitada e **forçada** (`FORCE ROW LEVEL SECURITY`) em toda tabela com `tenant_id`; a aplicação conecta com um role sem `BYPASSRLS`; teste automatizado no CI tenta ler, alterar e excluir dados de outro tenant em **todas** as tabelas 🔒, e o resultado esperado é 0 linhas afetadas ou HTTP 404 |
| RNF-08 | LGPD | Termo de consentimento versionado, aceito no primeiro acesso do paciente; opt-in separado para WhatsApp; auditoria de leitura/alteração de prontuário (quem, ação, entidade, IP, quando); exportação dos dados do paciente (JSON + PDF); exclusão = anonimização, respeitando a guarda legal do prontuário (**prazo a validar com CRN/advogado**; referência: 20 anos, Lei 13.787/2018); nutricionista = controladora, plataforma = operadora (DPA aceito no primeiro login da nutricionista) |
| RNF-09 | Compatibilidade | PWA: Chrome Android 10+ e Safari iOS 16.4+. Painel: últimas 2 versões de Chrome, Edge, Safari e Firefox, com layout funcional a partir de 768 px |
| RNF-10 | Acessibilidade | PWA em conformidade com WCAG 2.1 AA; verificação automática com axe no Playwright para as telas do PWA |
| RNF-11 | Observabilidade | Logs em JSON (pino) com `request_id` e `tenant_id`; erros no Sentry com `beforeSend` que remove corpo de request, notas, anamnese, valores de exames e texto do diário |
| RNF-12 | Idioma e formatos | pt-BR; datas `dd/mm/aaaa`; números com vírgula decimal; telefone exibido `(11) 91234-5678` e armazenado em E.164 |

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
| Pré-condições para envio | Paciente com `whatsapp_optin_em` preenchido, telefone E.164 válido e cota do tenant disponível (RN-09) |

### INT-02 — E-mail transacional (Resend)

API REST com Bearer (`RESEND_API_KEY`); remetente `EMAIL_FROM` no domínio próprio, com SPF, DKIM e DMARC (`p=quarantine`). Modelos em React Email: convite da nutricionista, convite do paciente, redefinição de senha, confirmação/cancelamento de agendamento, lembretes (fallback), exportação de dados pronta. Retry: 3 tentativas. Em dev, tudo vai para o **Mailpit**.

### INT-03 — Web Push (VAPID)

Biblioteca `web-push`; chaves em `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`. Uma inscrição por dispositivo (`push_subscriptions`). Resposta 404/410 do serviço de push → inscrição removida. No iOS, o push só funciona com o PWA **instalado na tela inicial**; o PWA mostra um tutorial de instalação ao detectar Safari no iOS sem modo standalone.

### INT-04 — Tabela TACO

Carga única (seed versionado no repositório) a partir do CSV da TACO 4ª edição (NEPA/UNICAMP), com a fonte citada no rodapé do PDF e na tela de alimentos. `foods.tenant_id IS NULL` = TACO, somente leitura. Valores "Tr" (traço) e "NA" → `0` e `NULL`, respectivamente.

### INT-05 — Vídeos (YouTube / Vimeo)

Sem API: a nutricionista cola a URL; o sistema extrai o ID (regex) e renderiza o player com `youtube-nocookie.com/embed/{id}` ou `player.vimeo.com/video/{id}`. A capa é obtida via oEmbed (`youtube.com/oembed`, `vimeo.com/api/oembed.json`) no momento do cadastro; se o oEmbed falhar, o cadastro não é bloqueado e o sistema usa uma capa padrão.

---

## 7. Modelo de dados

Convenções: PK `id uuid` (v7); `created_at` e `updated_at timestamptz`; 🔒 = tem `tenant_id uuid NOT NULL` + RLS forçada com a política `tenant_id = current_setting('app.tenant_id')::uuid`.

| Tabela | Campos-chave | Restrições / índices |
|---|---|---|
| `tenants` | `slug`, `nome_exibicao`, `crn`, `logo_path`, `cor_primaria`, `fuso` (padrão `America/Sao_Paulo`), `status` (`ativa`/`suspensa`), `wa_cota_mensal` (padrão 500), `antecedencia_min_h` (12), `cancelamento_min_h` (24), `endereco_consultorio`, `mostrar_perc_gordura_paciente` (padrão false), `dpa_aceito_em` | `slug` UNIQUE, regex `^[a-z0-9-]{3,40}$` |
| `users` | `email` (citext), `password_hash`, `totp_secret_enc`, `role` (`admin`/`nutri`/`paciente`), `email_verificado_em`, `nutri_tenant_id` (se role = nutri) | `email` UNIQUE |
| `sessions`, `verifications` | Gerenciadas pelo Better Auth | — |
| `consents` | `user_id`, `termo_versao`, `aceito_em`, `ip` | UNIQUE (`user_id`, `termo_versao`) |
| 🔒 `patients` | `user_id` (nulo até aceitar o convite), `nome`, `data_nascimento`, `sexo` (`F`/`M`, usado nas fórmulas), `telefone_e164`, `email`, `whatsapp_optin_em`, `status` (`ativo`/`arquivado`), `anonimizado_em` | UNIQUE (`tenant_id`, `email`); índice (`tenant_id`, `status`) |
| 🔒 `patient_tags` / 🔒 `patient_tag_links` | `nome` / (`patient_id`, `tag_id`) | UNIQUE (`tenant_id`, `nome`) |
| 🔒 `consultations` | `patient_id`, `appointment_id` (nulo), `data`, `notas_privadas`, `orientacoes_paciente` | — |
| 🔒 `anamnesis_templates` | `nome`, `schema jsonb` (lista de perguntas: tipo, rótulo, opções, obrigatória) | — |
| 🔒 `anamneses` | `patient_id`, `template_id`, `template_snapshot jsonb`, `respostas jsonb` | — |
| 🔒 `anthropometry` | `patient_id`, `consultation_id`, `data`, `peso_kg numeric(5,2)`, `altura_cm numeric(5,1)`, `imc` (GENERATED), `circunferencias jsonb`, `dobras_mm jsonb`, `protocolo` (`jp3`/`jp7`/`nenhum`), `densidade`, `perc_gordura` | CHECK peso 1–400, altura 30–250 |
| 🔒 `energy_calcs` | `patient_id`, `formula` (`harris_benedict`/`mifflin`/`fao_oms`), `peso_kg`, `altura_cm`, `idade`, `sexo`, `fator_atividade numeric(3,2)`, `tmb`, `get` | CHECK fator 1,00–2,50 |
| 🔒 `exams` | `patient_id`, `data`, `titulo`, `arquivo_path`, `valores jsonb` (lista de {nome, valor, unidade, referência}) | — |
| `foods` | `tenant_id` (**nulo = TACO**), `nome`, `grupo`, `kcal`, `proteina_g`, `carboidrato_g`, `lipidio_g`, `fibra_g` (por 100 g), `micros jsonb`, `medidas_caseiras jsonb` (lista de {nome, gramas}) | RLS: `tenant_id IS NULL OR tenant_id = atual`; GIN `pg_trgm` + `unaccent` em `nome` |
| 🔒 `meal_plans` | `patient_id` (nulo se modelo), `is_template`, `titulo`, `meta_kcal`, `energy_calc_id`, `status` (`rascunho`/`publicado`/`arquivado`), `versao`, `publicado_em`, `origem_plan_id`, `mostrar_calorias` (padrão false) | Índice único parcial (`patient_id`) WHERE `status = 'publicado'` |
| 🔒 `meals` | `plan_id`, `nome`, `horario time`, `ordem`, `observacao`, `recipe_content_id` (nulo) | — |
| 🔒 `meal_items` | `meal_id`, `food_id`, `quantidade_g numeric(7,2)`, `medida_caseira_txt`, `grupo_substituicao smallint` (nulo = item principal) | CHECK quantidade > 0 |
| 🔒 `diary_entries` | `patient_id`, `data_hora`, `refeicao`, `texto`, `foto_path`, `comentario_nutri`, `comentado_em`, `visto_pela_nutri_em` | Índice (`patient_id`, `data_hora DESC`) |
| 🔒 `availability_rules` | `dia_semana 0–6`, `inicio time`, `fim time`, `duracao_min`, `modalidade` (`presencial`/`online`/`ambas`) | CHECK `fim > inicio` |
| 🔒 `availability_blocks` | `inicio timestamptz`, `fim timestamptz`, `motivo` | — |
| 🔒 `appointments` | `patient_id`, `periodo tstzrange`, `modalidade`, `link_online`, `status` (`agendada`/`confirmada`/`cancelada`/`realizada`/`faltou`), `origem` (`nutri`/`paciente`), `cancelado_por`, `motivo_cancelamento`, `pedido_remarcacao_em` | `EXCLUDE USING gist (tenant_id WITH =, periodo WITH &&) WHERE (status <> 'cancelada')` |
| 🔒 `notifications` | `appointment_id` (nulo), `patient_id`, `canal` (`email`/`whatsapp`/`push`), `tipo`, `status` (`pendente`/`enviada`/`entregue`/`lida`/`falhou`/`ignorada`), `motivo_ignorada`, `provider_msg_id`, `tentativas`, `agendada_para` | UNIQUE (`provider_msg_id`); UNIQUE (`appointment_id`, `canal`, `tipo`) |
| `push_subscriptions` | `user_id`, `endpoint`, `p256dh`, `auth`, `user_agent` | UNIQUE (`endpoint`) |
| 🔒 `contents` | `tipo` (`video`/`receita`/`orientacao`), `titulo`, `resumo`, `corpo_md`, `video_provider`, `video_id`, `capa_path`, `pdf_path`, `etiquetas text[]`, `visibilidade` (`todos`/`etiquetas`/`pacientes`), `status` (`rascunho`/`publicado`), `publicado_em` | GIN em `etiquetas`; full-text em `titulo` + `resumo` |
| 🔒 `recipes` | `content_id` (1:1), `rendimento_total_g`, `porcao_g`, `modo_preparo_md`, `tempo_preparo_min` | CHECK `porcao_g <= rendimento_total_g` |
| 🔒 `recipe_ingredients` | `recipe_id`, `food_id`, `quantidade_g`, `medida_caseira_txt` | — |
| 🔒 `content_audience` | `content_id`, `patient_id` (nulo), `tag_id` (nulo) | CHECK exatamente um dos dois preenchido |
| 🔒 `content_views` | `content_id`, `patient_id`, `visto_em` | UNIQUE (`content_id`, `patient_id`) → conta pacientes únicos |
| 🔒 `content_favorites` | `content_id`, `patient_id` | UNIQUE (`content_id`, `patient_id`) |
| 🔒 `audit_log` | `actor_user_id`, `acao` (`ler`/`criar`/`alterar`/`excluir`/`exportar`/`anonimizar`), `entidade`, `entidade_id`, `ip`, `criado_em` | Append-only: `REVOKE UPDATE, DELETE` do role da aplicação |
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
| RN-06 | Todas as datas são gravadas em UTC (`timestamptz`) e exibidas no `fuso` do tenant |
| RN-07 | Foto do diário: até 10 MB, JPEG/PNG/HEIC; o worker converte para JPEG com no máximo 1600 px no maior lado, qualidade 80, e remove EXIF/GPS. Até **10 registros no diário por paciente por dia** |
| RN-08 | Paciente arquivado: perde o login do portal para aquele tenant, não recebe notificações e sai das audiências de conteúdo; o prontuário é mantido. Desarquivar restaura o acesso |
| RN-09 | Cota de WhatsApp contada por tenant e mês civil. Ao atingir **80%**: aviso no painel + e-mail para a nutricionista. A **100%**: WhatsApp suspenso até o mês seguinte (ou até o admin ampliar a cota); os lembretes seguem por e-mail e push |
| RN-10 | Vídeo: aceitar só URLs de `youtube.com`, `youtu.be`, `vimeo.com`; exibir com `youtube-nocookie.com` ou `player.vimeo.com`. O formulário mostra o aviso: *"Vídeos não listados podem ser vistos por quem tiver o link."* |
| RN-11 | Receita: nutriente por porção = `Σ(nutriente de cada ingrediente) × porcao_g / rendimento_total_g`. Ex.: ingredientes somando 2000 kcal, rendimento 1000 g, porção 250 g → **500 kcal/porção** |
| RN-12 | Audiência do conteúdo: `todos` = pacientes ativos do tenant; `etiquetas` = pacientes ativos com pelo menos uma das etiquetas; `pacientes` = lista explícita. A audiência é avaliada **na leitura**, então um paciente que recebe a etiqueta depois passa a ver o conteúdo |
| RN-13 | Lista de compras: soma das quantidades dos itens principais do plano publicado × nº de dias escolhido (1–14, padrão 7), agrupada pelo `grupo` do alimento e exibida em g/kg (≥ 1000 g → kg com 1 casa). O paciente pode marcar itens como comprados; a marcação é salva no dispositivo |
| RN-14 | TMB e GET são exibidos em kcal inteiros, com arredondamento meio para cima. Idade para fórmulas = anos completos na data do cálculo. FAO/OMS usa a faixa etária correspondente; para menores de 18 anos, o sistema exibe *"Fórmulas do MVP validadas para adultos"* e não sugere GET automaticamente |
| RN-15 | Tenant suspenso: nutricionista e pacientes veem a tela *"Conta temporariamente indisponível"*; o worker não envia notificações desse tenant; os dados ficam intactos |

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
| PWA / push | Serwist · `web-push` |
| Fila / agendamento | pg-boss |
| PDF | `@react-pdf/renderer` |
| Imagem | `sharp` · `heic-convert` |
| E-mail | Resend SDK · React Email |
| Logs / erros | pino · `@sentry/nextjs` |
| Testes | Vitest (unitários) · Testcontainers (Postgres real, RLS) · Playwright + `@axe-core/playwright` (E2E + acessibilidade) · k6 (carga, antes do go-live) |
| Qualidade | ESLint · Prettier · `tsc --noEmit` no CI |

### 9.2 CLIs

| CLI | Situação no servidor (2026-09-27) | Uso |
|---|---|---|
| `node` 24, `pnpm` 12, `npx`, `docker` 29, `git`, `jq`, `curl`, `claude` | ✅ instalados | Desenvolvimento |
| `gh` 2.45 | ✅ instalado (versão antiga; atualizar é opcional) | Repositório, PRs, Actions |
| `psql` / `pg_dump` (`postgresql-client-16`) | ❌ instalar via apt, **com confirmação** | Inspeção e backup |
| `rclone` | ❌ instalar, **com confirmação** | Backup criptografado → R2 |
| `drizzle-kit`, `playwright`, `web-push`, `@sentry/cli`, `k6` (via Docker) | Dependências de dev do projeto / imagem Docker | Migrations, E2E, VAPID, source maps, carga |
| Easypanel | Sem CLI/MCP oficial | Deploy por push na `main` (GitHub); configuração **pelo painel** |
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
| GitHub (repo privado) | Código, CI, deploy | — |
| Domínio + DNS | `app.<dominio>`, e-mail | Registro A → IP da VPS; SPF, DKIM, DMARC |
| Meta Business (verificada) + app WhatsApp Cloud API | INT-01 | A verificação e a aprovação dos templates **levam dias**; começar primeiro |
| Resend | INT-02 | Domínio verificado |
| Cloudflare R2 | Backup offsite | Bucket privado; chave com escopo só nesse bucket |
| Sentry | Erros | Plano gratuito atende ao MVP |
| UptimeRobot ou Uptime Kuma (Easypanel) | RNF-04 | — |

### 9.6 Variáveis de ambiente

Somente os nomes; os valores são definidos no Easypanel (prod) e em `.env.local` (dev, fora do git). O repositório terá um `.env.example` só com os nomes.

`DATABASE_URL` · `DATABASE_URL_MIGRATOR` · `AUTH_SECRET` · `ENCRYPTION_KEY` · `APP_URL` · `WHATSAPP_TOKEN` · `WHATSAPP_PHONE_NUMBER_ID` · `WHATSAPP_APP_SECRET` · `WHATSAPP_VERIFY_TOKEN` · `WHATSAPP_API_VERSION` · `RESEND_API_KEY` · `EMAIL_FROM` · `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` · `SENTRY_DSN` · `SENTRY_AUTH_TOKEN` · `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET` · `BACKUP_PASSPHRASE`

`DATABASE_URL_MIGRATOR` usa um role dono do schema (roda migrations); `DATABASE_URL` usa um role de aplicação **sem** `BYPASSRLS` e sem ser dono das tabelas.

### 9.7 CI/CD (GitHub Actions)

| Gatilho | Etapas |
|---|---|
| Pull request | `pnpm install --frozen-lockfile` → lint → `tsc --noEmit` → Vitest → testes de RLS/isolamento (Testcontainers) → build → Playwright E2E (login, criar+publicar plano, agendar online, lembrete gerado, conteúdo visível só para a audiência certa) |
| Merge na `main` | Build da imagem → webhook de deploy do Easypanel → no container, `migrate` roda antes do `start`; falha na migration = o container não sobe e a versão anterior continua no ar |

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
| P-02 | Texto do termo de consentimento do paciente e do DPA da nutricionista | Pendência | Advogado; o sistema só versiona e registra o aceite |
| P-03 | Nome do produto, domínio e nome de exibição do WhatsApp | Pendência | Dono do produto |
| P-04 | Verificação da Meta Business e aprovação dos templates | Risco de prazo | Iniciar na semana 1; enquanto isso, lembretes por e-mail/push |
| P-05 | VPS única, compartilhada com o `cursoia_crm` em produção | Risco | Limites do RNF-03 + monitor + backup testado; migrar para VPS dedicada quando passar de ~20 tenants ou se o consumo exceder os limites |
| P-06 | Push no iOS exige instalação do PWA | Risco de adoção | Tutorial de instalação + WhatsApp/e-mail como canais principais |
| P-07 | Vídeo não listado no YouTube não é privado | Risco aceito | Aviso RN-10; Bunny Stream na Fase 2 |
| P-08 | Fórmulas e coeficientes do Apêndice A | Pendência | Debby valida com casos reais antes do go-live |
| P-09 | Token do MCP do GitHub inválido | Pendência técnica | Corrigir antes de iniciar o desenvolvimento |

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
| 18–30 | 15,3·P + 679 | 14,7·P + 496 |
| 30–60 | 11,6·P + 879 | 8,7·P + 829 |
| > 60 | 13,5·P + 487 | 10,5·P + 596 |

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
| TACO | Tabela Brasileira de Composição de Alimentos (NEPA/UNICAMP) |
| Template (WhatsApp) | Mensagem pré-aprovada pela Meta, obrigatória para iniciar conversa |
| DPA | Contrato de tratamento de dados entre controladora (nutricionista) e operadora (plataforma) |
| RPO / RTO | Perda máxima de dados aceitável / tempo máximo para voltar ao ar |
