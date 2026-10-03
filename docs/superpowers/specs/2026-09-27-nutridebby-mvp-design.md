# NutriDebby — Especificação do MVP (Design)

| Item | Valor |
|---|---|
| Versão | 1.8 (ver Apêndice C) |
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
| D-05 | Lembretes por e-mail + WhatsApp Cloud API oficial + push — **v1.8:** WhatsApp pela **Evolution API** autohospedada em vez da Cloud API da Meta (mudança do dono, 2026-10-01; INT-01) | Usuário |
| D-06 | Multi-tenant desde o dia 1, onboarding manual (Abordagem A) | Usuário |
| D-07 | WhatsApp com **número único da plataforma** no MVP — **v1.8:** substituída: cada nutricionista conecta o **próprio número** (uma instância da Evolution por tenant, por QR code no painel; recomendação: um número só do consultório). Um bloqueio do WhatsApp atinge só aquele consultório e as respostas chegam à própria nutricionista | Usuário |
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
| M4 | **Agenda** | Horários de atendimento + bloqueios; consulta presencial/online (link externo); agendamento pela nutricionista e online pelo paciente; cancelar/remarcar; lembretes 24 h e 2 h (e-mail, WhatsApp, push); confirmação por resposta "1"/"2" no WhatsApp (**v1.8**, em vez de botão) e pelo link assinado da consulta no e-mail; registro de realizada/falta; cota de WhatsApp |
| M5 | **Portal do paciente (PWA)** | Instalação + push; plano atual; diário alimentar (texto + foto) com comentário da nutricionista; evolução; lista de compras gerada do plano; agendar/remarcar; exportar os próprios dados |
| M6 | **Biblioteca de conteúdo** | Vídeos (link YouTube/Vimeo), receitas estruturadas com cálculo nutricional, orientações em texto (+ PDF); público-alvo (todos / etiqueta / pacientes específicos); receita anexada a refeição do plano; aba "Conteúdos" no PWA (feed, busca, filtro, favoritos); métricas de visualização |

### 2.2 Fora do MVP

Financeiro do consultório · cobrança da assinatura SaaS · cadastro pela própria nutricionista/trial · recepcionista · chat e videochamada internos · assistente com IA · site profissional / vitrine pública de conteúdo · Canva · loja · Google Agenda · app nativo nas lojas · prescrição de suplementos/fitoterápicos · TBCA · upload próprio de vídeo. Distribuição por fase na §10. (**v1.8:** o WhatsApp com número de cada nutricionista entrou no MVP, pela Evolution API — D-07.)

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Admin da plataforma** | Criar, suspender e reativar tenants; ver métricas agregadas de uso (nº de pacientes, consultas, mensagens enviadas, cota de WhatsApp — **Plano 02:** `admin_tenant_metrics()` já devolve essas colunas, com `NULL` até as tabelas existirem, nos Planos 03 e 05; arquivos e armazenamento já são contados de verdade; **Plano 05:** `consultas_mes` e `mensagens_whatsapp_mes` passam a ser contagens reais, no mês civil do fuso do tenant); ajustar a cota de WhatsApp do tenant | Ler prontuário, plano, diário, exames ou qualquer dado de saúde. Exceção: suporte a um caso específico, **com autorização registrada da nutricionista** e com o acesso auditado (Fase 2; no MVP não há essa tela) |
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

Externos: Resend (e-mail) · Web Push (VAPID) · Sentry ·
          Cloudflare Turnstile (anti-robô na página pública) · GHCR (imagens)
Na VPS (v1.8): nutri_evolution — Evolution API v2.3.7 (WhatsApp), sem domínio,
          só na rede interna; banco `evolution` próprio dentro do nutri_db
```

### 4.1 Organização do código

Monólito modular: `src/modules/{plataforma,pacientes,planos,agenda,portal,conteudo}` (**Plano 04:** `planos` virou dois módulos, `alimentos` e `plano-alimentar`; **Plano 05:** a agenda são dois módulos, `agenda` e `notificacoes` — o motor de envio também serve o convite do paciente, US-010). Cada módulo expõe funções de domínio (**Plano 02:** em vários arquivos por módulo, como `contas.ts` e `convites.ts`, em vez de um único `service.ts`). As rotas e a UI chamam só o módulo, nunca o banco direto. O acesso ao banco passa por um helper `withTenant(ctx, fn)`, que abre a transação e executa `SET LOCAL` de `app.tenant_id`, `app.role` e, para sessões de paciente, `app.patient_id`, antes de qualquer consulta.

Regras de acesso que complementam a RLS:
- **Paciente só vê o que é dele:** nas tabelas 🔒 com `patient_id`, uma segunda política RLS exige `patient_id = app.patient_id` quando `app.role = 'paciente'`. Assim, um erro no service não expõe outro paciente do mesmo tenant.
- **Rascunho invisível ao paciente (Plano 04):** em `meal_plans`, `meals` e `meal_items`, a política `RESTRICTIVE` `paciente_sem_rascunho` deixa a sessão de paciente (`app.role = 'paciente'`) ver e gravar só as linhas de planos com `status <> 'rascunho'` (modelos, sempre `rascunho`, ficam fora): a garantia está no banco, não só na API (US-025).
- **`foods` é a única tabela com `tenant_id` nulo e RLS (Plano 04):** a política `tenant_isolation` continua valendo (escrita só nas próprias linhas) e a política extra `taco_leitura`, só `FOR SELECT USING (tenant_id IS NULL)`, libera a leitura da TACO. A TACO fica imutável para a aplicação: nenhum tenant cria, altera ou apaga linha com `tenant_id` nulo.
- **Tabelas sem `tenant_id`** (`tenants`, `users` — tabelas do Better Auth no Plano 01 — `consents`, `invites`, `backup_runs`, `public_rate_limits`): acesso só pelos services do M1, com verificação explícita de dono; cobertas por testes de autorização. **Plano 05:** `push_subscriptions` ganhou `tenant_id` e `patient_id` e entrou na RLS por paciente (o envio roda no `withTenant` do worker e a exclusão LGPD apaga só as do vínculo); `consents` ganhou `patient_id` (com `tenant_id`) para o aceite da página pública e continua fora da RLS, em `RLS_EXCEPTIONS`; `public_rate_limits` (contadores por IP/e-mail com HMAC, e a marca anti-repetição do webhook) só é acessada por `src/modules/agenda/limite-ip.ts`.
- **Contexto `publico` (Plano 05):** as páginas sem login (página pública `/n/<slug>` e link da consulta antes da assinatura) usam o papel `publico` do `withTenant`, sem ator. **Negado no banco por padrão:** `app_enable_tenant_rls` cria em toda tabela com `tenant_id` (inclusive as antigas e as futuras) a política `RESTRICTIVE` `publico_negado`; só o que o fluxo público usa é liberado, por comando, com `app_allow_publico` — `availability_rules`/`availability_blocks` (`select`), `appointments` (`select`, `insert`), `patients` (`select`, `insert`), `notifications` (`select`, `insert`), `audit_log` (`insert`), `public_booking_requests` (`select`, `insert`, `update`) —, e a lista `PUBLICO_LIBERADO` (`src/db/rls-guard.ts`) tem de bater com o banco (guarda no CI). Sem a política de `UPDATE`, o `publico` não altera paciente e não trava linha de `patients` com `SELECT … FOR SHARE` (a linha some do resultado). Os horários livres saem desse contexto só como intervalos, nunca com dado de outro paciente.
- **Tabelas só da equipe (Plano 05):** `availability_rules`, `availability_blocks`, `whatsapp_conexoes` e `public_booking_requests` têm também a política `staff_only` (a sessão de paciente não vê nem as próprias linhas).
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
| `app.<dominio>/api/webhooks/whatsapp` | Webhook da Evolution API (**v1.8**; em produção chamado pela rede interna do Docker/Easypanel, `EVOLUTION_WEBHOOK_URL`) |
| `app.<dominio>/consulta/<token>` | Página do link assinado da consulta (**v1.8**): confirmar, cancelar, remarcar ou avisar que precisa remarcar, sem login |

O domínio definitivo ainda não foi escolhido. Ver §11.

---

## 5. Requisitos não funcionais

| ID | Requisito | Meta verificável |
|---|---|---|
| RNF-01 | Desempenho | Route Handlers com p95 ≤ 300 ms (exceto geração de PDF e exportação, que são assíncronas); LCP do PWA ≤ 2,5 s em 4G (Lighthouse, perfil "Slow 4G"); recálculo do plano ao adicionar/alterar item ≤ 100 ms (calculado no cliente) |
| RNF-02 | Capacidade | 50 tenants × 300 pacientes ativos (15 mil pacientes) e 100 usuários simultâneos, sem violar o RNF-01 (teste de carga com k6 antes do go-live) |
| RNF-03 | Limites na VPS | Limites definidos no Easypanel: `nutri_app` 1 GB / 1 vCPU; `nutri_db` 1 GB; `nutri_worker` 512 MB (conversão de HEIC e PDF consomem memória) — total 2,5 GB dos ~5,5 GB livres; **v1.8:** mais `nutri_evolution` 512 MB / 0,5 vCPU (Evolution API, estimativa de 250–400 MB com um número conectado por tenant), total ~3 GB. O `cursoia_crm` não pode ser afetado. **Build da imagem fora da VPS** (§9.7). Recomendação à parte: criar 2 GB de swap na VPS (exige confirmação do dono do servidor) |
| RNF-04 | Disponibilidade | 99% ao mês (VPS única, sem HA — risco aceito). Monitor externo checa `GET /api/health` a cada 1 min e alerta em ≤ 2 min. O health check testa o banco e o **heartbeat do worker**: se nenhum job for processado em 10 min, a resposta é 503. Assim, lembretes parados também geram alerta |
| RNF-05 | Backup | Rodado **no host** por `systemd` às 03h (America/Sao_Paulo), não pelo worker (**Plano 02**; ver Apêndice C): `pg_dump` executado dentro do container `nutri_db` e criptografado (rclone crypt) no R2, com retenção de 7 diários + 4 semanais; `/data` com `rclone sync` + `--backup-dir` datado (arquivos alterados ou apagados ficam 30 dias). Dados excluídos por LGPD somem dos backups em até 35 dias; RPO 24 h; RTO 4 h; **teste de restauração mensal documentado** (**Plano 02:** a conferência inicial usa o `pg_restore` do próprio container `nutri_db`; o teste mensal fica para o P08-04). O script grava cada execução em `backup_runs`; o worker só confere a tabela e alerta os admins por e-mail se o dia passou sem backup ou se a última execução falhou |
| RNF-06 | Segurança | Senhas em argon2id; 2FA TOTP para a nutricionista; sessão expira após 12 h de inatividade (nutricionista/admin) ou 30 dias (paciente) — **Plano 01:** implementado como `expiresAt` = última atividade + 12 h, deslizando só em `requireUser` a cada 15 min (evita gravar a cada requisição); limite de 5 tentativas de login a cada 15 min por IP+e-mail (**Plano 01:** por IP+rota, via Better Auth — risco de `X-Forwarded-For` falsificado verificado na Tarefa 13); HSTS; CSP restritiva (`frame-src`: `youtube-nocookie.com`, `player.vimeo.com`, `challenges.cloudflare.com`; `script-src`: próprio + Turnstile; `connect-src`: próprio + Sentry; `img-src`: próprio + `data:` + `blob:`); uploads validados pelo conteúdo real do arquivo (*magic bytes*), não pela extensão; Turnstile + limite por IP nos formulários públicos (RN-16); **2FA obrigatório para o admin**; `totp_secret` criptografado com `ENCRYPTION_KEY` (AES-256-GCM) (**Plano 01:** cifrado pelo Better Auth com XChaCha20-Poly1305 usando `AUTH_SECRET`; `ENCRYPTION_KEY` fica reservado para dados de planos futuros); segredos só em variáveis do Easypanel |
| RNF-07 | Isolamento entre tenants | RLS habilitada e **forçada** (`FORCE ROW LEVEL SECURITY`) em toda tabela com `tenant_id`; a aplicação conecta com um role sem `BYPASSRLS`; política adicional por `patient_id` para sessões de paciente (§4.1); teste automatizado no CI tenta ler, alterar e excluir dados de outro tenant **e de outro paciente do mesmo tenant** em **todas** as tabelas 🔒, e o resultado esperado é 0 linhas afetadas ou HTTP 404 |
| RNF-08 | LGPD | Termo de consentimento versionado, aceito no primeiro acesso do paciente; opt-in separado para WhatsApp; auditoria de leitura/alteração de prontuário (quem, ação, entidade, IP, quando); exportação dos dados do paciente (JSON + PDF); pedido de exclusão (art. 18 da LGPD) **durante o prazo de guarda do prontuário**: os dados clínicos são **mantidos identificados** (art. 16, I — obrigação legal) e **bloqueados** (sem acesso ao portal, sem notificações, sem uso em conteúdo); são apagados na hora apenas os dados não obrigatórios (fotos do diário, opt-ins, inscrições de push). Após o prazo, um job anonimiza o registro. Prazo **a validar com CRN/advogado** (referência: 20 anos, Lei 13.787/2018); nutricionista = controladora, plataforma = operadora (DPA aceito no primeiro login da nutricionista). **Plano 04 (privacidade dos modelos):** o texto livre (`orientacoes` do plano e `observacao` das refeições) copiado de um plano de paciente para um modelo ("Salvar como modelo", US-024) deixa o alcance do titular: o modelo tem `patient_id` nulo, então esse texto sai da RLS por paciente, da exportação (US-018, US-046) e do bloqueio e da anonimização do paciente. A nutricionista, como controladora, escolhe salvar e deve revisar esse texto antes (evitar nome ou dado de saúde do paciente em modelo); a tela ainda não mostra aviso, que fica como melhoria. **Plano 05 (agenda, v1.8):** as escritas em `appointments` são auditadas pelo gatilho (entidade "Agenda"); a leitura da agenda (nome, hora, situação) não é auditada, como a lista de pacientes; ações do próprio paciente na agenda (link da consulta, WhatsApp, página pública) aparecem no "Histórico de acessos" com o ator "Sistema". `notifications` é registro técnico de entrega, sem texto de mensagem (só o convite podia ir cifrado até o envio). A exportação ganha consultas, lembretes, aceites do termo e dispositivos de push (só data e navegador); o motivo de cancelamento escrito pela nutricionista **não** é exportado (anotação dela; decisão do dono, 2026-10-02). Pedido de exclusão atendido **cancela as consultas futuras** sem aviso ao paciente (`cancelado_por = 'sistema'`) e avisa a nutricionista por e-mail. A anonimização apaga o motivo do cancelamento, o link online, o número do WhatsApp das mensagens e as inscrições de push, e tira o IP dos aceites do termo (migration 0065); os IPs no `audit_log` ficam, como registro de responsabilização (decisão do dono, 2026-10-02) |
| RNF-09 | Compatibilidade | PWA: Chrome Android 10+ e Safari iOS 16.4+. Painel: últimas 2 versões de Chrome, Edge, Safari e Firefox, com layout funcional a partir de 768 px |
| RNF-10 | Acessibilidade | PWA em conformidade com WCAG 2.1 AA; verificação automática com axe no Playwright para as telas do PWA |
| RNF-11 | Observabilidade | Logs em JSON (pino) com `request_id` e `tenant_id`; erros no Sentry com `beforeSend` que remove corpo de request, notas, anamnese, valores de exames e texto do diário |
| RNF-12 | Idioma e formatos | pt-BR; datas `dd/mm/aaaa`; números com vírgula decimal; telefone exibido `(11) 91234-5678` e armazenado em E.164 |
| RNF-13 | Armazenamento | Cota de 5 GB por tenant em `/data` (RN-18); alerta ao admin com o disco da VPS em 70% (no painel do admin, o marcador em texto "(acima do limite de 70%)", não só cor); meta de ≤ 300 KB por foto do diário após a conversão |

---

## 6. Integrações

### INT-01 — WhatsApp pela Evolution API (v1.8)

**v1.8 (mudança do dono, 2026-10-01):** o MVP usa a **Evolution API v2.3.7** autohospedada (Baileys, "WhatsApp Web") em vez da WhatsApp Cloud API da Meta: sem verificação da Meta, sem templates e sem custo por mensagem. O texto original (Graph API, templates `convite_paciente`/`lembrete_24h`/`lembrete_2h`, botões *quick reply*, `X-Hub-Signature-256`, `hub.verify_token`, variáveis `WHATSAPP_*` da Meta) foi substituído pela tabela abaixo.

| Item | Especificação |
|---|---|
| Serviço | `nutri_evolution` no Easypanel (imagem `evoapicloud/evolution-api:v2.3.7`), **sem domínio**, só na rede interna; banco `evolution` com role próprio dentro do `nutri_db` (fora do backup diário: perder esse banco = reconectar pelo QR); sem Redis; armazenamento de mensagens desligado. Runbook do E-04 revisado no Plano 05 |
| Provedor no código | Interface `ProvedorWhatsapp` (`enviarTexto`, `conectar`, `estado`, `desconectar`) com três implementações: `evolution` (produção), `sandbox` (dev/CI/E2E: a mensagem vira e-mail no Mailpit para `<número>@whatsapp.sandbox`, QR fictício; recusado em produção fora de `localhost`) e `fake` (testes). Sem `EVOLUTION_API_URL` + `EVOLUTION_API_KEY` (e `EVOLUTION_WEBHOOK_SECRET` no app) o WhatsApp fica desligado e os lembretes saem por e-mail e push |
| Número | **Um por nutricionista** (D-07 revisada): uma instância por tenant (`nd-<tenantId>`), conectada pela nutricionista em Painel → WhatsApp → "Conectar WhatsApp" (QR code). O NutriDebby só aproveita "1"/"2" de quem recebeu lembrete e descarta o resto; a Evolution recebe todas as mensagens que chegam ao número (declarar no DPA, P-02; log do serviço curto) |
| Envio | `POST /message/sendText/{instância}` com texto simples (sem botões, sem template); só mensagens transacionais (lembretes, aviso de convite, respostas a "1"/"2"); **nenhuma mensagem leva link** — nem o link assinado da consulta nem o link da chamada online: os links vão só por e-mail (decisão do dono, 2026-10-02: o número do paciente nunca foi verificado e a conversa fica no aparelho do consultório); o texto cita o e-mail de destino mascarado (`a***@dominio`). Ritmo anti-bloqueio: fila serial, no máximo **8 mensagens por minuto por tenant**, `delay` de 1,2 s ("digitando…"), `linkPreview` desligado |
| Webhook | Webhook **por instância** com o cabeçalho `jwt_key`: a Evolution manda `Authorization: Bearer <JWT HS256>`. A rota (≤ 2 s, corpo ≤ 256 KB) confere só HS256, HMAC em tempo constante, `exp` (10 min, folga de 60 s), `iat`, `app = 'evolution'`, `action = 'webhook'`, com a chave **da instância do corpo** (`jwt_key` = HKDF do segredo-mestre `EVOLUTION_WEBHOOK_SECRET` com o nome da instância; o segredo-mestre nunca sai do app). Inválido → 401 (a Evolution não repete 401). **Sem repetição:** a marca do pedido (HMAC de JWT + SHA-256 do corpo) é gravada em `public_rate_limits`, na mesma transação do evento na fila, enquanto o JWT pode ser aceito; o mesmo pedido de novo → **200 sem efeito**. **Endereço interno:** em produção `EVOLUTION_WEBHOOK_URL` é obrigatória e interna (nome de serviço sem ponto ou IP privado); URL pública só com `EVOLUTION_WEBHOOK_URL_PUBLICA=1`. Sem `GET` de verificação. Trocar o segredo-mestre exige "Conectar WhatsApp" de novo em cada consultório |
| Eventos tratados | `messages.upsert` (resposta do paciente: o texto é reduzido na rota a `confirmar`/`remarcar` e nunca é gravado, enfileirado nem logado; grupos, mídia, `@lid` e outros textos → 200 e descartados); `messages.update` (status `entregue`/`lida`/`falhou`, que só avança; ERROR de mensagem ainda sem registro volta para a fila algumas vezes); `connection.update` (estado e número da própria instância). O evento reduzido vai **cifrado** para a fila `whatsapp-evento`. A resposta "1"/"2" vale para o lembrete enviado àquele número nas últimas 26 h (US-035) |
| Conexão | Estado em `whatsapp_conexoes`; quando o celular sai de "Aparelhos conectados", a nutricionista recebe **no máximo um** e-mail "Seu WhatsApp foi desconectado do NutriDebby" **a cada 6 h** (um JWT capturado alternando conectado/desconectado não esgota a cota de e-mail; uma segunda queda real em menos de 6 h só aparece no painel) |
| Idempotência | Uma linha por (consulta, canal, tipo, início da consulta); chave do provedor = id da mensagem da Evolution (`key.id`/`keyId`); evento repetido não altera o estado |
| Falhas | Timeout de 10 s; 3 novas tentativas (1, 5 e 25 min) só para falhas passageiras de conexão; timeout ou erro depois de o pedido sair é definitivo (**no máximo uma vez**: na dúvida, não reenvia); depois disso, `falhou` e **fallback por e-mail** (o e-mail do mesmo lembrete volta, se tinha falhado). Respostas da Evolution e a `apikey` nunca vão para log |
| Pré-condições para envio | Paciente com `whatsapp_optin_em` preenchido e `whatsapp_optout_em` vazio, telefone E.164 válido, instância conectada e cota do tenant disponível (RN-09). O opt-in pode ser **declarado pela nutricionista** (`whatsapp_optin_origem = 'nutri'`) ou dado pelo paciente (aceite do convite ou página pública, paciente novo); é obrigatório antes de qualquer mensagem, inclusive o aviso de convite |
| Risco | Automação não oficial: o número pode ser bloqueado pelo WhatsApp (mitigado pelo ritmo de envio, pelo texto só transacional e pelo número por consultório; P-04) |

### INT-02 — E-mail transacional (Resend)

API REST com Bearer (`RESEND_API_KEY`); remetente `EMAIL_FROM` no domínio próprio, com SPF, DKIM e DMARC (`p=quarantine`). Modelos em componentes React próprios renderizados com `react-dom/server` (**Plano 02:** os pacotes `@react-email/*` foram marcados como *no longer supported* e o substituto `react-email@6` levaria o CLI de preview para as dependências de produção): convite da nutricionista, convite do paciente, redefinição de senha, confirmação/cancelamento de agendamento, lembretes (fallback), exportação de dados pronta. Retry: 3 novas tentativas (backoff exponencial a partir de 60 s; mesma leitura do INT-01). Em dev e no CI, o transporte é o **Mailpit** (`EMAIL_TRANSPORT=mailpit`; padrão `resend` em produção). **Plano 05 (v1.8):** e-mails da agenda ao paciente (consulta marcada e cancelada, lembretes de 24 h e 2 h com o link assinado da consulta e o link da chamada, código de 6 dígitos da página pública e o e-mail novo com o link para remarcar quando o paciente responde "2" no WhatsApp) e à nutricionista (consulta marcada, remarcada ou cancelada pelo paciente, pedido de remarcação, novo paciente da página pública, WhatsApp desconectado — no máximo um a cada 6 h —, 80% da cota de WhatsApp — uma vez por mês — e consultas futuras canceladas por pedido de exclusão). O e-mail da nutricionista vem de `user` (`src/modules/agenda/aviso-nutri.ts`); o nome do paciente só no corpo, nunca no assunto. Os lembretes por e-mail repetem com segurança: chave de idempotência do Resend `notificacao:<id>:<início da consulta>`.

### INT-03 — Web Push (VAPID)

Biblioteca `web-push`; chaves em `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`. Uma inscrição por dispositivo (`push_subscriptions`). Resposta 404/410 do serviço de push → inscrição removida. **Plano 05 (v1.8):** o envio roda **só no worker** (nenhuma rota importa `web-push`; `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` no worker; o par é conferido na partida); `push_subscriptions` tem `tenant_id` e `patient_id` (uma linha por vínculo do dispositivo); só endpoints `https` de serviços de push conhecidos (FCM, Mozilla, Apple, Windows) — os outros e as chaves que não cifram são apagados sem envio; TTL até o início da consulta (no máximo 24 h); **no máximo uma vez** (algum dispositivo recebeu ou o resultado é incerto → não repete). O texto é **neutro**: só o horário, sem o nome da nutricionista nem dado do paciente, da modalidade ou do local (decisão do dono, 2026-10-02: a tela de bloqueio revelaria com quem a pessoa se consulta), e o toque abre o link da consulta. A inscrição e o push de teste são do P06-02 (Plano 06); até lá, as linhas de push ficam "paciente sem notificações no app". No iOS, o push só funciona com o PWA **instalado na tela inicial**; o PWA mostra um tutorial de instalação ao detectar Safari no iOS sem modo standalone.

### INT-04 — Tabela TACO

Carga única (seed versionado no repositório) a partir do CSV da TACO 4ª edição (NEPA/UNICAMP), com a fonte citada no rodapé do PDF e na tela de alimentos. `foods.tenant_id IS NULL` = TACO, somente leitura. Valores "Tr" (traço) e "NA" → `0` e `NULL`, respectivamente. **Plano 04:** `*` ("análises sendo reavaliadas") e célula vazia também viram `NULL`, e a célula com erro de digitação `,0,02` (alimento 373, piridoxina) é corrigida para `0,02` por regra explícita do conversor. Os alimentos sem energia na TACO (`*` ou `NA`; ex.: "Leite, de vaca, integral") aparecem com "Sem valor na TACO" e contam 0 nos totais. O seed sai da planilha oficial da NEPA (`seeds/fontes/`, espelho com SHA-256 conferido) → `seeds/taco-4ed.csv` → migration SQL gerada, e um teste refaz o CSV a partir da planilha e compara byte a byte. Os ids da TACO são determinísticos (`00000000-0000-4000-8000-` + número TACO com 12 dígitos; coluna `taco_id`), iguais em dev, CI e produção.

**A TACO não traz medidas caseiras.** O seed de `medidas_caseiras` vem da tabela pública do IBGE (*POF 2008–2009 — Tabela de Medidas Referidas para os Alimentos Consumidos no Brasil*), casada manualmente com os **150 alimentos mais usados** (lista a validar com a Debby). Os demais alimentos ficam só em gramas até a nutricionista cadastrar uma medida própria (medidas próprias por tenant, na tabela 🔒 `food_measures`). Ver P-10. **Plano 04:** a lista da Debby ainda não chegou, então o seed inicial tem **28 alimentos básicos (44 medidas)**, cada medida citando a linha exata do IBGE em `seeds/medidas-ibge.csv` (conferida contra a tabela original por teste); os demais, até os 150, entram quando a Debby mandar a lista (E-08), só editando o CSV e gerando uma migration nova com `pnpm seed:medidas`.

### INT-05 — Vídeos (YouTube / Vimeo)

Sem API: a nutricionista cola a URL; o sistema extrai o ID (regex) e renderiza o player com `youtube-nocookie.com/embed/{id}` ou `player.vimeo.com/video/{id}`. A capa é obtida via oEmbed (`youtube.com/oembed`, `vimeo.com/api/oembed.json`) no momento do cadastro e **baixada para `/data`** (sem imagem de terceiros no PWA); se o oEmbed falhar, o cadastro não é bloqueado e o sistema usa uma capa padrão.

### INT-06 — Cloudflare Turnstile

Widget anti-robô na página pública `/n/<slug>` e na recuperação de senha. O token é validado no servidor (`POST https://challenges.cloudflare.com/turnstile/v0/siteverify`, com `TURNSTILE_SECRET_KEY`) antes de qualquer escrita. Se o Turnstile estiver fora do ar, o formulário público mostra *"Tente novamente em alguns minutos"* e **não** aceita envio sem verificação. Custo: gratuito. **Plano 02:** o E2E usa as chaves de **teste** oficiais da Cloudflare com o `siteverify` real (sem conta), e a validação do ambiente recusa chaves de teste em produção (`NODE_ENV=production` com `APP_URL` fora de `localhost`): *"TURNSTILE_* de teste não pode ser usada em produção"*.

---

## 7. Modelo de dados

Convenções: PK `id uuid` (v7; **Plano 01:** v4 via `gen_random_uuid()` — o Postgres 16 não tem `uuidv7()` nativo); `created_at` e `updated_at timestamptz`; 🔒 = tem `tenant_id uuid NOT NULL` + RLS forçada com a política `tenant_id = current_setting('app.tenant_id')::uuid`.

| Tabela | Campos-chave | Restrições / índices |
|---|---|---|
| `tenants` | `slug`, `nome_exibicao`, `crn`, `logo_path`, `cor_primaria`, `fuso` (padrão `America/Sao_Paulo`), `status` (`ativa`/`suspensa`), `wa_cota_mensal` (padrão 500), `antecedencia_min_h` (12), `cancelamento_min_h` (24), `endereco_consultorio`, `link_online_padrao`, `agendamento_publico_ativo` (padrão true; **v1.8:** padrão `false` — a migration 0067 desliga a página de todos os tenants existentes e a nutricionista liga em Configurações), `mostrar_perc_gordura_paciente` (padrão false), `armazenamento_bytes`, `dpa_aceito_em`, `dpa_versao` | `slug` UNIQUE, regex `^[a-z0-9-]{3,40}$` |
| `users` | `email` (citext), `password_hash`, `totp_secret_enc`, `role` (`admin`/`nutri`/`paciente`), `email_verificado_em`, `nutri_tenant_id` (se role = nutri) — **Plano 01:** implementada pelas tabelas geradas pelo CLI do Better Auth (`user`, `session`, `account`, `verification`, `two_factor`, `rate_limit`); `user` cumpre o papel de `users` | `email` UNIQUE |
| `session`, `account`, `verification`, `two_factor`, `rate_limit` | Gerenciadas pelo Better Auth (Plano 01) | — |
| `consents` | `user_id`, `termo_versao`, `aceito_em`, `ip` (**Plano 02:** criada agora para o aceite do DPA; texto provisório `0.1-provisorio`, ver P-02); **Plano 05:** `tenant_id` e `patient_id` para o aceite do termo na página pública (o visitante ainda não tem conta) e `user_id` nulo nesse caso | UNIQUE (`user_id`, `termo_versao`); **Plano 05:** CHECK "conta ou paciente" e `UNIQUE NULLS NOT DISTINCT (user_id, termo_versao, tenant_id, patient_id)`; o role da aplicação não faz `UPDATE`/`DELETE` (prova de aceite) — a única escrita depois do INSERT é `app_anonimizar_aceites()` (migration 0065, anonimização) |
| `invites` | `user_id`, `tipo` (`nutri`), `token_hash` (só o SHA-256 do token), `expira_em`, `usado_em` (**Plano 02**) | `token_hash` UNIQUE; índice único parcial (`user_id`) WHERE `usado_em IS NULL` (um convite pendente por usuário) |
| 🔒 `stored_files` | `tipo` (`logo`/`capa`/`exame`/`plano_pdf`/`diario_foto`/`orientacao_pdf`/`exportacao`), `caminho`, `bytes`, `mime`, `criado_por` (**Plano 02:** controle de cota e de caminhos) | `caminho` UNIQUE; CHECK `bytes > 0` |
| `backup_runs` | `tipo` (`banco`/`arquivos`), `ok`, `bytes`, `detalhe`, `iniciado_em`, `concluido_em` (**Plano 02:** escrita só pelo script de backup do host; o app só lê) | índice (`tipo`, `concluido_em`) |
| 🔒 `patients` | `user_id` (nulo até aceitar o convite), `nome`, `data_nascimento` e `sexo` (`F`/`M`, usados nas fórmulas; **nulos só quando `origem = 'agendamento_publico'`**, com a pendência "Completar cadastro" no painel), `telefone_e164`, `email`, `origem` (`nutri`/`agendamento_publico`), `whatsapp_optin_em`, `whatsapp_optin_origem` (`nutri`/`paciente`), `whatsapp_optout_em`, `status` (`ativo`/`arquivado`/`bloqueado`), `bloqueado_em`, `anonimizar_apos` (data), `anonimizado_em` | UNIQUE (`tenant_id`, `email`); índice (`tenant_id`, `status`) |
| 🔒 `patient_tags` / 🔒 `patient_tag_links` | `nome` / (`patient_id`, `tag_id`) | UNIQUE (`tenant_id`, `nome`) |
| 🔒 `consultations` | `patient_id`, `appointment_id` (nulo; **Plano 05:** preenchido por "Iniciar atendimento" a partir da agenda), `data`, `notas_privadas`, `orientacoes_paciente` | **Plano 05:** FK composta (`tenant_id`, `patient_id`, `appointment_id`) → `appointments`; no máximo um atendimento por consulta |
| 🔒 `anamnesis_templates` | `nome`, `schema jsonb` (lista de perguntas: tipo, rótulo, opções, obrigatória) | — |
| 🔒 `anamneses` | `patient_id`, `template_id`, `template_snapshot jsonb`, `respostas jsonb` | — |
| 🔒 `anthropometry` | `patient_id`, `consultation_id`, `data`, `peso_kg numeric(5,2)`, `altura_cm numeric(5,1)`, `imc` (GENERATED), `circunferencias jsonb`, `dobras_mm jsonb`, `protocolo` (`jp3`/`jp7`/`nenhum`), `densidade`, `perc_gordura` | CHECK peso 1–400, altura 30–250 |
| 🔒 `energy_calcs` | `patient_id`, `formula` (`harris_benedict`/`mifflin`/`fao_oms`), `peso_kg`, `altura_cm`, `idade`, `sexo`, `fator_atividade numeric(3,2)`, `tmb`, `get` | CHECK fator 1,00–2,50 |
| 🔒 `exams` | `patient_id`, `data`, `titulo`, `arquivo_path`, `valores jsonb` (lista de {nome, valor, unidade, referência}) | — |
| `foods` | `tenant_id` (**nulo = TACO**), `taco_id` (**Plano 04:** número na TACO, só nas linhas da TACO), `nome`, `grupo`, `kcal`, `proteina_g`, `carboidrato_g`, `lipidio_g`, `fibra_g` (por 100 g), `micros jsonb`, `medidas_caseiras jsonb` (lista de {nome, **plural**, gramas}), `origem_food_id` (**Plano 04:** de qual alimento veio a cópia de "Duplicar como meu alimento"; sem FK) | RLS: leitura se `tenant_id IS NULL OR tenant_id = atual`; escrita só se `tenant_id = atual` (TACO é imutável para a aplicação) — **Plano 04:** `tenant_isolation` mais a política `taco_leitura` (só `FOR SELECT USING (tenant_id IS NULL)`); `taco_id` UNIQUE; GIN `pg_trgm` em `app_unaccent(lower(nome))` (o `unaccent` é `STABLE` e não entra em índice; `app_unaccent` é o wrapper `IMMUTABLE`); CHECK nome 2–120 caracteres, kcal 0–900 e demais valores 0–100 g; alimento próprio sem valor `NULL` |
| 🔒 `food_measures` | `food_id`, `nome`, `plural` (**Plano 04**), `gramas` | Medidas caseiras criadas pela nutricionista (complementam o seed IBGE). **Plano 04:** UNIQUE (`tenant_id`, `food_id`, `nome`); CHECK gramas entre 0,1 e 5000; o cadastro recusa um nome igual ao de uma medida do IBGE do mesmo alimento (senão o seletor do editor mostraria duas medidas com o mesmo rótulo e gramas diferentes) |
| 🔒 `meal_plans` | `patient_id` (nulo se modelo), `is_template`, `titulo`, `meta_kcal`, `energy_calc_id` (**Plano 04:** referência **sem FK**; o serviço confere que o cálculo é do mesmo paciente, porque `ON DELETE SET NULL` numa FK composta zeraria também `tenant_id`, e a meta fica gravada em `meta_kcal` de qualquer forma), `status` (`rascunho`/`publicado`/`arquivado`), `versao`, `revisao` (**Plano 04:** trava otimista do salvamento automático; revisão diferente = conflito entre abas), `ultimo_envio` (**Plano 04:** chave do último salvamento gravado), `publicado_em`, `origem_plan_id`, `mostrar_calorias` (padrão false), `orientacoes` (**Plano 04:** texto livre do plano, vai no PDF), `pdf_path` (gerado na publicação), `pdf_status` (**Plano 04:** `pendente`/`pronto`/`falhou`; `NULL` até a primeira publicação), `pdf_pedido_em` (**Plano 04:** quando o PDF atual foi pedido; a varredura do pendente há mais de 1 h mede por aqui), `updated_at` (**Plano 04**) | Índice único parcial (`tenant_id`, `patient_id`) WHERE `status = 'publicado'`; **Plano 04:** e índice único parcial (`tenant_id`, `patient_id`) WHERE `status = 'rascunho'` AND `patient_id IS NOT NULL` (um rascunho por paciente); CHECK `meta_kcal` entre 500 e 10000; modelo (`is_template`) = `patient_id` nulo e sempre `rascunho`; título 1–120 e orientações até 2000 caracteres |
| 🔒 `meals` | `tenant_id` e `patient_id` (**Plano 04:** nulo em modelo; convenção do projeto para RLS por paciente e FK composta em toda tabela filha), `plan_id`, `nome`, `horario time`, `ordem`, `observacao`, `recipe_content_id` (nulo; **Plano 04:** fica para o Plano 07, P07-05, quando `contents` existir) | CHECK nome 1–60 e observação até 2000 caracteres |
| 🔒 `meal_items` | `tenant_id`, `patient_id` (nulo em modelo) e `plan_id` (**Plano 04:** a política `paciente_sem_rascunho` olha o plano sem `JOIN` em duas camadas), `meal_id`, `food_id` (FK `RESTRICT`), `quantidade_g numeric(7,2)`, `medida jsonb` (**Plano 04:** `{nome, plural, gramas, qtd}`, cópia: o texto do item não muda se a medida for apagada ou corrigida depois), `medida_caseira_txt`, `substitui_item_id` (**Plano 04:** em vez de `grupo_substituicao smallint`; FK para o item principal **da mesma refeição**, nulo = item principal; apagar o principal apaga as substituições), `ordem` (**Plano 04**), `nutrientes jsonb` (**Plano 04:** cópia dos valores por 100 g e do nome do alimento gravada na publicação, para o plano publicado ser imutável, RN-01) | CHECK quantidade entre 0,1 e 5000 g (**Plano 04:** 99999 g é erro de digitação, não plano) |
| 🔒 `diary_entries` | `patient_id`, `data_hora`, `refeicao`, `texto`, `foto_path`, `comentario_nutri`, `comentado_em`, `visto_pela_nutri_em` | Índice (`patient_id`, `data_hora DESC`) |
| 🔒 `availability_rules` | `dia_semana 0–6`, `inicio time`, `fim time`, `duracao_min`, `modalidade` (`presencial`/`online`/`ambas`) | CHECK `fim > inicio`; **Plano 05:** duração 15–240 min, no máximo 30 regras, sem sobreposição no mesmo dia; `staff_only` |
| 🔒 `availability_blocks` | `inicio timestamptz`, `fim timestamptz`, `motivo` | **Plano 05:** no máximo 366 dias, motivo até 120 caracteres; `staff_only` |
| 🔒 `appointments` | `patient_id`, `periodo tstzrange` (**v1.8:** colunas `inicio`/`fim` `timestamptz` — o Drizzle não tem `tstzrange`; a faixa é expressão da restrição), `modalidade`, `link_online`, `status` (`agendada`/`confirmada`/`cancelada`/`realizada`/`faltou`), `origem` (`nutri`/`paciente`; o paciente da página pública marca como `paciente`), `cancelado_por` (`nutri`/`paciente`/**`sistema`** — v1.8: pedido de exclusão atendido), `motivo_cancelamento`, `pedido_remarcacao_em`; **v1.8:** `confirmada_via` (`whatsapp`/`link`), `cancelada_em`, `remarcada_de`, `presenca_em`, `updated_at` | `EXCLUDE USING gist (tenant_id WITH =, tstzrange(inicio, fim, '[)') WITH &&) WHERE (status <> 'cancelada')` (consultas `realizada`/`faltou` continuam ocupando o horário); **v1.8:** CHECK do link online (`online` exige `https://…` até 500 caracteres; presencial sem link), motivo até 300 caracteres; RLS por paciente; gatilho de auditoria (entidade "Agenda") |
| 🔒 `notifications` | `appointment_id` (nulo), `patient_id`, `canal` (`email`/`whatsapp`/`push`), `tipo` (**v1.8:** `lembrete_24h`, `lembrete_2h`, `consulta_marcada`, `consulta_cancelada`, `convite_paciente`, `resposta_confirmacao`, `resposta_remarcar`), `status` (`pendente`/`enviada`/`entregue`/`lida`/`falhou`/`ignorada`; **v1.8:** mais `enviando`, a reserva antes do envio), `motivo_ignorada` (**v1.8:** `prazo_passado`, `horario_silencioso`, `consulta_cancelada`, `consulta_remarcada`, `consulta_encerrada`, `paciente_inativo`, `tenant_suspenso`, `sem_optin`, `sem_telefone`, `whatsapp_desligado`, `whatsapp_desconectado`, `cota_esgotada`, `sem_inscricao`, `push_desligado`, `convite_aceito`), `provider_msg_id`, `tentativas`, `agendada_para`; **v1.8:** `provider_jid` (destino real no WhatsApp, para casar a resposta), `enviada_em` (base da cota), `erro` (código curto, até 60 caracteres), `conteudo_selado` (texto cifrado até o envio; hoje nenhum fluxo grava), `inicio_consulta` (o horário da consulta para o qual a linha foi planejada; nulo só sem consulta) | UNIQUE (`provider_msg_id`); UNIQUE (`appointment_id`, `canal`, `tipo`) → **v1.8:** índice único parcial (`appointment_id`, `canal`, `tipo`, `inicio_consulta`) só para lembretes (avisos de evento têm uma linha por evento; as respostas "1"/"2" têm uma por ação que muda a consulta — "2" → "1" → "2" responde de novo —, conferida sob a trava da consulta: code-review do PR #7, migration 0068); marcar de novo no mesmo horário ou reativar reescreve só a linha que não saiu; mudar o horário cria linhas novas e a enviada é **imutável** (conta na cota e nas métricas); CHECK `conteudo_selado` só em `pendente`/`enviando`; RLS por paciente; fora da auditoria (registro técnico) |
| `push_subscriptions` | `user_id`, `endpoint`, `p256dh`, `auth`, `user_agent` — **v1.8:** 🔒 com `tenant_id` e `patient_id` (RLS por paciente) em vez de só `user_id` | UNIQUE (`endpoint`) → **v1.8:** UNIQUE (`tenant_id`, `patient_id`, `endpoint`); apagadas no pedido de exclusão e na anonimização |
| 🔒 `whatsapp_conexoes` (**v1.8**) | `instancia` (`nd-<tenant_id>`), `estado` (`conectada`/`conectando`/`desconectada`), `numero_e164`, `conectada_em`, `desconectada_em`, `aviso_desconexao_em` (último e-mail de desconexão: no máximo 1 a cada 6 h), `aviso_cota_mes` (mês do aviso de 80%) | Uma linha por tenant (`tenant_id` UNIQUE); CHECK da instância do próprio tenant e do número E.164; `staff_only` |
| 🔒 `public_booking_requests` (**v1.8**) | pedido da página pública até o código: hash do token do pedido, HMAC do código, e-mail, nome, telefone, opt-in, horário, modalidade, versão do termo, IP, tentativas, expira em, verificado em, concluído em, `appointment_id` | `token_hash` UNIQUE; FK composta para a consulta criada; apagado em 24 h; `staff_only`; liberado ao `publico` (`select`, `insert`, `update`) |
| `public_rate_limits` (**v1.8**) | `chave` (HMAC do IP, do e-mail ou da marca do pedido do webhook), `janela_inicio`, `contagem` | Sem `tenant_id` e fora da RLS; só `src/modules/agenda/limite-ip.ts` acessa |
| 🔒 `contents` | `tipo` (`video`/`receita`/`orientacao`), `titulo`, `resumo`, `corpo_md`, `video_provider`, `video_id`, `capa_path`, `pdf_path`, `etiquetas text[]`, `visibilidade` (`todos`/`etiquetas`/`pacientes`), `status` (`rascunho`/`publicado`), `publicado_em` | GIN em `etiquetas`; full-text em `titulo` + `resumo` |
| 🔒 `recipes` | `content_id` (1:1), `rendimento_total_g`, `porcao_g`, `modo_preparo_md`, `tempo_preparo_min` | CHECK `porcao_g <= rendimento_total_g` |
| 🔒 `recipe_ingredients` | `recipe_id`, `food_id`, `quantidade_g`, `medida_caseira_txt` | — |
| 🔒 `content_audience` | `content_id`, `patient_id` (nulo), `tag_id` (nulo) | CHECK exatamente um dos dois preenchido |
| 🔒 `content_views` | `content_id`, `patient_id`, `visto_em` | UNIQUE (`content_id`, `patient_id`) → conta pacientes únicos |
| 🔒 `content_favorites` | `content_id`, `patient_id` | UNIQUE (`content_id`, `patient_id`) |
| 🔒 `audit_log` | `actor_user_id` (nulo = "Sistema" no histórico — v1.8: inclui as ações do próprio paciente na agenda pelo link, pelo WhatsApp e pela página pública), `acao` (`ler`/`criar`/`alterar`/`excluir`/`exportar`/`bloquear`/`anonimizar`), `entidade`, `entidade_id`, `patient_id` (nulo; **Plano 02:** o "Histórico de acessos" do paciente inclui leituras e alterações das tabelas filhas, não só `entidade = 'patients'`), `ip`, `criado_em` | Append-only: `REVOKE UPDATE, DELETE` do role da aplicação; política adicional `patient_isolation` por `patient_id` |
| 🔒 `privacy_requests` | `patient_id`, `tipo` (`exportacao`/`exclusao`), `status` (`aberto`/`concluido`), `prazo`, `concluido_em` | Prazo de resposta ao titular: 15 dias |
| 🔒 `access_events` | `patient_id`, `dia date` | Base da métrica CS-02; UNIQUE (`patient_id`, `dia`) |

---

## 8. Regras de negócio

| ID | Regra |
|---|---|
| RN-01 | Cada paciente tem no máximo **1 plano publicado** (garantido por índice único parcial). Publicar arquiva o anterior na mesma transação. Plano publicado é imutável: "Editar" cria uma cópia `rascunho` com `versao + 1`. **Plano 04:** cada paciente tem também no máximo **1 rascunho** (índice único parcial): "Editar" num paciente que já tem rascunho abre o rascunho existente, e só a versão **publicada** se edita (numa versão já arquivada: "Esta versão não está mais publicada. Recarregue a página."). Ao publicar, cada item recebe a cópia dos valores por 100 g e do nome do alimento (`nutrientes`); a tela, o PDF e o portal leem a cópia, então corrigir um "Meu alimento" depois não muda um plano publicado (o "Editar" cria o rascunho com os valores atuais dos alimentos). Modelo não se publica |
| RN-02 | Nutriente do item = `valor_por_100g × quantidade_g / 100`. Totais por refeição e do dia contam **só itens principais** (`substitui_item_id IS NULL`). Indicador × `meta_kcal`: verde se \|desvio\| ≤ 5%; amarelo se 5% < \|desvio\| ≤ 10%; vermelho se \|desvio\| > 10%. Arredondamento na exibição: kcal inteiro, gramas com 1 casa. **Plano 04:** `meta_kcal` vale de 500 a 10000 kcal e a quantidade do item, de 0,1 a 5000 g (a quantidade digitada é arredondada a 2 casas no servidor); alimento sem kcal na TACO ("Sem valor na TACO") conta 0 nos totais, sem `NaN`; a diferença de kcal de uma substituição para o principal só aparece quando os **dois** lados têm kcal na TACO (senão um lado contaria 0 e daria um número clínico enganoso, ex.: "−150 kcal"); o indicador tem texto e desvio, não só cor ("Dentro da meta", "Atenção", "Fora da meta", ex.: "Atenção (+7,5%)"); g/kg usa o peso da última antropometria e, sem ela, mostra "—" |
| RN-03 | Horários livres = regras de atendimento − bloqueios − consultas não canceladas. O paciente agenda com antecedência mínima de `antecedencia_min_h` (padrão 12 h) e máxima de 60 dias. Em caso de agendamento simultâneo, o `EXCLUDE` recusa o segundo e a UI mostra: *"Esse horário acabou de ser ocupado. Escolha outro."* |
| RN-04 | O paciente pode cancelar ou remarcar até `cancelamento_min_h` (padrão 24 h) antes do início. Depois disso, os botões somem e aparece: *"Para alterar, fale com sua nutricionista."* A nutricionista pode alterar a qualquer momento. **v1.8:** até o PWA (P06-09), o paciente age pelo link assinado da consulta enviado por e-mail (`/consulta/<token>`); fora do prazo, só "Avisar que preciso remarcar". Remarcar pelo paciente = cancelar a antiga e criar a nova numa transação; pela nutricionista = "Alterar data e hora" da mesma consulta |
| RN-05 | Lembretes em **24 h** e **2 h** antes do início, por todos os canais disponíveis para o paciente (e-mail sempre; WhatsApp se houver opt-in e cota; push se houver inscrição). O lembrete é **ignorado** (`status = ignorada` + motivo) se: consulta cancelada; paciente arquivado; horário de envio já passou quando a consulta foi criada; horário de envio no intervalo **[21:00, 08:00)** no fuso do tenant (08:00 em ponto é permitido). Remarcar cancela os lembretes pendentes e agenda novos. **v1.8 (D7):** no planejamento, igual. **Na reserva para envio** (worker parado, conta reativada à noite, fila atrasada), o lembrete que venceu e sairia dentro de [21:00, 08:00), na 1ª tentativa, é **adiado para as 08:00** se ainda fizer sentido — o de 24 h, se as 08:00 ficarem antes do lembrete de 2 h (ou até 30 min antes do início quando o de 2 h caiu no silêncio); o de 2 h, até 30 min antes do início —, senão fica `ignorada`/`horario_silencioso`; o de 24 h que sai no dia da consulta diz "hoje". Vale para **e-mail, WhatsApp e push**. Só lembretes: confirmação da marcação, aviso de cancelamento, convite e respostas "1"/"2" saem na hora; novas tentativas não esperam o fim do silêncio. Na **reativação** do tenant, a regra vale ao pé da letra: o lembrete cujo horário já passou fica `prazo_passado` (decisão do dono, 2026-10-02). Lembrete **enviado** não é reaberto: remarcar cria linhas novas para o horário novo. Mudar só a duração, a modalidade ou o link mantém o horário e os lembretes pendentes, **sem aviso próprio** ao paciente (aceito pelo dono, 2026-10-02) |
| RN-06 | Todas as datas são gravadas em UTC (`timestamptz`) e exibidas no `fuso` do tenant. Se o fuso do dispositivo do paciente for diferente, o PWA mostra a sigla junto do horário (ex.: "09:00 (horário de Brasília)") |
| RN-07 | Foto do diário: até 10 MB, JPEG/PNG/HEIC; o worker converte para JPEG com no máximo 1600 px no maior lado, qualidade 80, e remove EXIF/GPS. Até **10 registros no diário por paciente por dia** |
| RN-08 | Paciente arquivado: perde o login do portal para aquele tenant, não recebe notificações e sai das audiências de conteúdo; o prontuário é mantido. Desarquivar restaura o acesso |
| RN-09 | Cota de WhatsApp contada por tenant e mês civil (no fuso do tenant); conta cada mensagem **aceita pela API da Meta** (status `enviada` ou posterior) — **v1.8:** aceita pela Evolution (`enviada_em`): lembretes e avisos de convite; é **limite de uso** (protege o número contra bloqueio e a VPS), não de custo, com padrão 500. Respostas livres dentro da janela de 24 h não contam (**v1.8:** as respostas automáticas a "1"/"2" não contam). Na beira da cota, o que passa do saldo de uma volta do envio continua `pendente` e é recontado na volta seguinte; só vira `cota_esgotada` quando o uso do mês já está em 100%. Ao atingir **80%**: aviso no painel + e-mail para a nutricionista (**v1.8:** uma vez por mês). A **100%**: WhatsApp suspenso até o mês seguinte (ou até o admin ampliar a cota); os lembretes seguem por e-mail e push |
| RN-10 | Vídeo: aceitar só URLs de `youtube.com`, `youtu.be`, `vimeo.com`; exibir com `youtube-nocookie.com` ou `player.vimeo.com`. O formulário mostra o aviso: *"Vídeos não listados podem ser vistos por quem tiver o link."* |
| RN-11 | Receita: nutriente por porção = `Σ(nutriente de cada ingrediente) × porcao_g / rendimento_total_g`. Ex.: ingredientes somando 2000 kcal, rendimento 1000 g, porção 250 g → **500 kcal/porção** |
| RN-12 | Audiência do conteúdo: `todos` = pacientes ativos do tenant; `etiquetas` = pacientes ativos com pelo menos uma das etiquetas; `pacientes` = lista explícita. A audiência é avaliada **na leitura**, então um paciente que recebe a etiqueta depois passa a ver o conteúdo. **Exceção:** uma receita anexada a uma refeição do plano publicado do paciente (US-054) fica visível para ele, mesmo fora da audiência |
| RN-13 | Lista de compras: soma das quantidades dos itens principais do plano publicado × nº de dias escolhido (1–14, padrão 7), agrupada pelo `grupo` do alimento e exibida em g/kg (≥ 1000 g → kg com 1 casa). O paciente pode marcar itens como comprados; a marcação é salva no dispositivo |
| RN-14 | TMB e GET são exibidos em kcal inteiros, com arredondamento meio para cima. Idade para fórmulas = anos completos na data do cálculo. FAO/OMS usa a faixa etária correspondente; não se aplica a menores (RN-17) |
| RN-15 | Tenant suspenso: nutricionista e pacientes veem a tela *"Conta temporariamente indisponível"*; o worker não envia notificações desse tenant; os dados ficam intactos |
| RN-16 | Agendamento público (`/n/<slug>`), só se `agendamento_publico_ativo`: exige Turnstile válido + **código de 6 dígitos enviado ao e-mail** (válido por 10 min) antes de criar paciente e consulta; máximo de 3 consultas futuras por e-mail no tenant e 10 tentativas por IP por hora. O paciente criado tem `origem = 'agendamento_publico'`. **v1.8:** a página nasce desligada (`agendamento_publico_ativo` padrão `false`); o código vale 10 min e 5 erros invalidam o pedido; 1 código por e-mail a cada 60 s e 5 por hora; as 3 consultas futuras são conferidas **depois** do código (antes dele, a resposta é a mesma para qualquer e-mail); o IP é o real (`TRUSTED_PROXIES`) e as chaves dos contadores são HMAC; e-mail de paciente ativo → a consulta vai para ele; arquivado, bloqueado ou anonimizado → *"Não foi possível agendar por aqui. Fale com sua nutricionista."* (reconferido sob a trava da consulta nova, para a corrida com um pedido de exclusão atendido); o opt-in de WhatsApp marcado por paciente que já existe é descartado (o contexto sem login não altera pacientes); pedidos apagados em 24 h |
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
| WhatsApp (Evolution API, v1.8) | Sem CLI | API REST interna do `nutri_evolution` (`apikey`), só pela rede do Docker; configuração pelo Easypanel (runbook do E-04 revisado) |

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
| dev | VPS, `docker compose` (padrão do `cronogramasys-dev`) | Postgres 16 + Mailpit + `next dev` + worker; WhatsApp com o **número de teste** da Meta (**v1.8:** `WHATSAPP_SANDBOX=1` — a mensagem vira e-mail no Mailpit; também no CI e no E2E); memória limitada no compose (db 512 MB) |
| prod | Easypanel, projeto `nutri` | `nutri_app`, `nutri_worker`, `nutri_db` + volume `/data`; limites do RNF-03; **v1.8:** `nutri_evolution` (sem domínio) |
| staging | Fase 2 | Criar quando entrar a segunda cliente |

### 9.5 Contas e serviços externos

| Serviço | Para quê | Observação |
|---|---|---|
| GitHub (repo privado) + GHCR | Código, CI, registro das imagens Docker | O Easypanel precisa de credencial de leitura do GHCR (token com escopo `read:packages`) |
| Domínio + DNS | `app.<dominio>`, e-mail | Registro A → IP da VPS; SPF, DKIM, DMARC |
| Meta Business (verificada) + app WhatsApp Cloud API | INT-01 | **v1.8:** não é mais necessária (Evolution API autohospedada, sem conta externa nem custo por mensagem); cada nutricionista conecta o próprio número pelo QR |
| Resend | INT-02 | Domínio verificado. O plano gratuito (3 mil e-mails/mês, 100/dia) atende à Debby; com mais tenants, passa a ser pago (~US$ 20/mês por 50 mil) |
| Cloudflare Turnstile | INT-06 | Gratuito |
| Cloudflare R2 | Backup offsite | Bucket privado; chave com escopo só nesse bucket |
| Sentry | Erros | Plano gratuito atende ao MVP |
| UptimeRobot ou Uptime Kuma (Easypanel) | RNF-04 | — |

### 9.6 Variáveis de ambiente

Somente os nomes; os valores são definidos no Easypanel (prod) e em `.env.local` (dev, fora do git). O repositório terá um `.env.example` só com os nomes.

`DATABASE_URL` · `DATABASE_URL_MIGRATOR` · `AUTH_SECRET` · `ENCRYPTION_KEY` · `APP_URL` · ~~`WHATSAPP_TOKEN` · `WHATSAPP_PHONE_NUMBER_ID` · `WHATSAPP_APP_SECRET` · `WHATSAPP_VERIFY_TOKEN` · `WHATSAPP_API_VERSION`~~ (**v1.8:** substituídas por `EVOLUTION_*`, abaixo) · `RESEND_API_KEY` · `EMAIL_FROM` · `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` · `SENTRY_DSN` · `SENTRY_AUTH_TOKEN` · `R2_ACCOUNT_ID` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` · `R2_BUCKET` · `BACKUP_PASSPHRASE` · `TURNSTILE_SITE_KEY` · `TURNSTILE_SECRET_KEY` · `FILE_URL_SECRET` · `DATA_DIR` · `EMAIL_TRANSPORT` (`resend`/`mailpit`; padrão `resend` em produção) · `MAILPIT_URL` (dev/CI)

**v1.8 (Plano 05):** `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` (app e worker; sem as duas, o WhatsApp fica desligado; produção recusa só uma delas) · `EVOLUTION_WEBHOOK_SECRET` (app; segredo-mestre de ≥ 32 caracteres do qual sai o `jwt_key` de cada instância; produção recusa o valor do `.env.example`) · `EVOLUTION_WEBHOOK_URL` (app; opcional em dev, **obrigatória e interna em produção** — nome de serviço sem ponto ou IP privado) · `EVOLUTION_WEBHOOK_URL_PUBLICA` (app; `1` libera uma URL pública, opção explícita do runbook) · `WHATSAPP_SANDBOX` (`1` em dev, CI e E2E; recusado em produção fora de `localhost`) · `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` no **worker** (o envio de push é só dele; o app recebe a chave pública no P06-02). As variáveis do Evolution e do VAPID não podem ficar pela metade.

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
| **Fase 3 — Engajamento** | Chat nutricionista ↔ paciente; WhatsApp com número próprio (Embedded Signup / Tech Provider) — **v1.8:** antecipado para o MVP pela Evolution API (D-07); Google Agenda; prescrição de suplementos e fitoterápicos; TBCA; assistente com IA para montar planos. **v1.8:** itens confirmados pelo dono em 03/10/2026, a especificar com brainstorming depois do Plano 05 (backlog F3-01 a F3-06): leitura de laudos de exame com IA, "IA Nutri" para o paciente e para a nutricionista, envio de exames pelo paciente, parecer nutricional assinado pela nutricionista e receita de suplementos e fitoterápicos em PDF assinado |
| **Fase 4 — Expansão** | App nas lojas; site profissional + vitrine pública de conteúdo; loja (**v1.8:** loja de produtos do ramo confirmada pelo dono em 03/10/2026, backlog F4-01); videochamada interna |

---

## 11. Riscos e pendências

| ID | Item | Tipo | Ação / responsável |
|---|---|---|---|
| P-01 | Prazo de guarda do prontuário de nutrição (referência 20 anos) | Pendência | Validar com CRN/advogado antes do go-live |
| P-02 | Texto do termo de consentimento do paciente e do DPA da nutricionista | Pendência | Advogado; o sistema só versiona e registra o aceite. **Plano 02:** texto **provisório** do DPA (`DPA_VERSAO = '0.1-provisorio'`); o P08-06 publica o texto do advogado com nova versão, o que obriga novo aceite |
| P-03 | Nome do produto, domínio e nome de exibição do WhatsApp | Pendência | Dono do produto (**v1.8:** o nome de exibição passa a ser o do número de cada consultório) |
| P-04 | Verificação da Meta Business e aprovação dos templates (e possível reclassificação como marketing) — **v1.8:** substituído pelo risco da Evolution API (automação não oficial): o número de um consultório pode ser bloqueado pelo WhatsApp | Risco | Ritmo de 8 mensagens/min por tenant, fila serial, texto só transacional, sem disparo em massa, número por consultório (o bloqueio atinge só um); sem WhatsApp, os lembretes seguem por e-mail e push. E-04 revisado (runbook do Plano 05): subir o `nutri_evolution` e conectar o número pelo QR |
| P-05 | VPS única, compartilhada com o `cursoia_crm` em produção | Risco | Limites do RNF-03 + monitor + backup testado; migrar para VPS dedicada quando passar de ~20 tenants ou se o consumo exceder os limites |
| P-06 | Push no iOS exige instalação do PWA | Risco de adoção | Tutorial de instalação + WhatsApp/e-mail como canais principais |
| P-07 | Vídeo não listado no YouTube não é privado | Risco aceito | Aviso RN-10; Bunny Stream na Fase 2 |
| P-08 | Fórmulas e coeficientes do Apêndice A | Pendência | Debby valida com casos reais antes do go-live |
| P-09 | Token do MCP do GitHub inválido | Pendência técnica | Corrigir antes de iniciar o desenvolvimento |
| P-10 | A TACO não tem medidas caseiras; o casamento TACO × IBGE dos 150 alimentos mais usados é trabalho manual | Risco de esforço | Debby fornece a lista dos alimentos mais usados; o casamento vira tarefa do plano (estimar à parte). **Plano 04:** entregues 28 alimentos básicos (44 medidas); os demais dependem da lista da Debby (E-08) e entram só editando `seeds/medidas-ibge.csv` |
| P-11 | Atendimento de menores de 18 anos | **Resolvida (2026-09-27)** | A Debby não atende menores → RN-17 (somente adultos) |
| P-12 | Criptografia em repouso: o disco da VPS depende do provedor; só backups, `totp_secret` e URLs assinadas têm proteção própria. O dono do servidor tem acesso técnico ao banco | Risco aceito | Declarar no DPA; acesso SSH restrito; avaliar criptografia de colunas sensíveis (anamnese, notas) na Fase 2 |
| P-13 | Disco de 85 GB livres, compartilhado com outros projetos | Risco | RN-18 + alerta em 70% (RNF-13) |
| P-14 | Compatibilidade Serwist × Turbopack no Next 16 | **Resolvida (2026-09-28)** | Funciona com Turbopack: spike (P01-15) gerou o service worker em `/serwist/sw.js` (prebuild estático via `generateStaticParams`, `esbuild` só em build) e `/manifest.webmanifest`, ambos 200 num `next build && next start` de produção e numa imagem Docker prod (`pnpm prune --prod`) — Plano 06 usa `@serwist/turbopack` |
| P-15 | CS-03 depende da taxa de faltas anterior ao sistema | Pendência | Debby informa a taxa do mês anterior (base de comparação) |
| P-17 | **v1.8 (Plano 05) — conferir na subida da Evolution (E-04 revisado), em aberto:** o contrato real da Evolution v2.3.7 só foi testado com respostas simuladas (QR em `/instance/connect`, `fetchInstances`, `logout`, corpo do `webhook/set`, `jwt_key` → `Bearer`); se a Evolution apaga o cabeçalho `jwt_key` antes de chamar o webhook e se reaproveita o JWT nas novas tentativas (acima de 11 min → 401, evento perdido); o que o container loga (JWT, números, textos); se outros projetos do Easypanel enxergam o `nutri_evolution` na rede interna; a ordem real entre a resposta do envio e o webhook de ACK/ERROR | Pendência técnica | Dono + Dev, no E-04 revisado, antes de pacientes reais |
| P-18 | **v1.8 — decisões em aberto da agenda:** (a) com a cota esgotada, o motivo real de um WhatsApp que não sairia de qualquer jeito (sem opt-in, sem telefone, desconectado) aparece como "cota de WhatsApp do mês esgotada"; (b) o e-mail de 80% pode sair já em 100% com o texto "Quando chegar a 100%…" (incoerente); (c) o DPA (P-02) precisa declarar a Evolution como suboperadora técnica autohospedada (ela recebe todas as mensagens do número conectado) e os serviços de push; (d) fusos do Brasil aceitos (`FUSOS_BRASIL`) não incluem `America/Eirunepe` | Pendência | Dono decide (a), (b) e (d); (c) com o advogado (E-09) |
| P-16 | Pré-requisitos de segurança e privacidade deixados pela revisão final do Plano 04, a resolver **no Plano 06, antes de existir qualquer sessão de paciente** (hoje nenhuma escreve em `foods`, e dado real segue bloqueado pelo backup P02-11): (a) políticas `RESTRICTIVE` de escrita só para a equipe em `foods`, `food_measures` e `anamnesis_templates` (sem `patient_id`, uma sessão de paciente poderia hoje inserir, alterar ou apagar "Meu alimento", medidas e modelos de anamnese do tenant), com os testes de escrita em sessão de paciente que faltam; (b) a exportação do titular (US-046) filtra os planos `rascunho` do `dados.json` (a exportação da equipe, US-018, continua com todas as tabelas do paciente); (c) decidir se as linhas de `audit_log` das edições do rascunho aparecem no histórico visível ao paciente (não copiam conteúdo, só id e titular, mas revelam atividade de rascunho); (d) `stored_files` restrita por paciente para o download do PDF no portal (hoje só por tenant) | Pendência técnica | Plano 06 (P06-03, P06-08); item (a) primeiro |

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
| Template (WhatsApp) | Mensagem pré-aprovada pela Meta, obrigatória para iniciar conversa (**v1.8:** não usado; a Evolution envia texto simples) |
| Evolution API | Serviço autohospedado que conecta um número de WhatsApp como "aparelho conectado" (Baileys) e expõe envio e webhooks por API REST |
| Link da consulta | Endereço `/consulta/<token>` com assinatura HMAC (128 bits), amarrado ao e-mail do paciente e válido até o início da consulta; enviado só por e-mail |
| Contexto `publico` | Papel do `withTenant` das páginas sem login; negado no banco por padrão, com liberações mínimas por comando |
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
| 1.5 | 2026-10-01 | Ajustes após a ativação em produção (P02-11, PR #4): campo `slug` da criação de conta (US-001) com rótulo "Endereço da página" e dica com o link da futura página pública (o rótulo "Endereço" era confundido com o endereço do consultório; "Endereço já em uso" mantido). Turnstile (INT-06): o token só vale para o hostname do `APP_URL`; a resposta do `siteverify` é classificada pelo código de erro em qualquer status HTTP (a Cloudflare responde segredo errado com HTTP 400): segredo ausente/errado e erros 5xx são "indisponível" com log (motivo e códigos, nunca token, segredo ou IP), erro de token é "Confirme que você não é um robô." |
| 1.6 | 2026-10-01 | Fechamento do Plano 04 (Plano alimentar): desvios conscientes do plano e decisões da execução aplicados ao corpo da spec e às histórias — **modelo de dados (§7):** `meal_items.substitui_item_id` (FK para o item principal da mesma refeição, apagar o principal apaga as substituições) em vez de `grupo_substituicao smallint` (RN-02 ajustada); `meals` e `meal_items` ganham `tenant_id` e `patient_id` (nulo em modelo) e `meal_items` ganha `plan_id` (RLS por paciente e FK composta em toda tabela filha, política sem `JOIN` em duas camadas); colunas a mais em `meal_plans` (`revisao`, trava otimista do salvamento automático; `ultimo_envio`, chave do último salvamento gravado, que aceita a repetição de um envio cuja resposta se perdeu; `orientacoes`; `pdf_status` `pendente`/`pronto`/`falhou`; `pdf_pedido_em`, hora do pedido do PDF atual; `updated_at`), em `meal_items` (`medida jsonb`, `nutrientes jsonb` com a cópia dos valores dos alimentos gravada na publicação, `ordem`), em `foods` (`taco_id`, `origem_food_id`) e em `food_measures` (`plural`); `meals.recipe_content_id` fica para o Plano 07 (P07-05); `meal_plans.energy_calc_id` sem FK (o serviço confere o paciente; `ON DELETE SET NULL` numa FK composta zeraria `tenant_id`); quantidade do item com CHECK de 0,1 a 5000 g (em vez de > 0) e `meta_kcal` de 500 a 10000; no máximo 1 rascunho por paciente (índice único parcial, ao lado do 1 publicado da RN-01). **RLS:** `foods` mantém `tenant_isolation` e ganha `taco_leitura` (só `SELECT`; a TACO fica imutável para a aplicação); política `RESTRICTIVE` `paciente_sem_rascunho` em `meal_plans`, `meals` e `meal_items` (o rascunho é invisível ao paciente no banco, não só na API, §4.1); módulos `alimentos` e `plano-alimentar` em vez de `planos`. **INT-04/P-10:** seed inicial de **28 alimentos básicos (44 medidas)** do IBGE, cada uma citando a linha da tabela, em vez dos 150 (a lista da Debby, E-08, amplia só editando `seeds/medidas-ibge.csv`); `*` e célula vazia da TACO viram `NULL` ("Sem valor na TACO", conta 0 nos totais), a célula `,0,02` é corrigida, os ids da TACO são determinísticos e testes conferem os CSVs contra as planilhas oficiais. **US-025:** o push e o e-mail "Seu novo plano alimentar está disponível" ficam para o Plano 06 (o portal e o push só existem lá); o ponto de entrada está comentado em `publicarPlano`. **Regras e comportamento registrados:** RN-01 (1 rascunho por paciente; "Editar" só a partir da versão publicada e abre o rascunho existente; plano publicado lê a cópia `nutrientes`, então corrigir um "Meu alimento" depois não o altera); RN-02 (meta 500–10000 kcal, quantidade arredondada a 2 casas no servidor, item sem kcal na TACO conta 0, diferença de kcal da substituição só quando os dois lados têm valor, indicador com texto e desvio, g/kg pelo peso da última antropometria); medida própria com o nome de uma medida do IBGE do mesmo alimento é recusada (a mensagem de nome repetido é ligeiramente inexata nesse caso, texto próprio a critério do dono); mover um item principal leva as substituições junto e a substituição só se move no próprio grupo; "Publicar" e "Salvar como modelo" ficam desabilitados até a linha de salvamento dizer "Salvo"; clique em link interno com edição pendente envia na hora e, se a edição puder se perder, pede confirmação; PDF com "Total do dia" e proteína, carboidrato, lipídio e fibra só com "Mostrar calorias ao paciente", refeição maior que a página continua na seguinte, PDF pendente há mais de 1 h desde o pedido (`pdf_pedido_em`; arquivar a versão anterior não renova o prazo) vira `falhou` (varredura do worker a cada 15 min) com "Gerar o PDF de novo", que só enfileira de `falhou` (já em preparo: "O PDF já está sendo preparado."; já pronto: a página mostra "Baixar PDF"), e o acompanhamento do PDF consulta só o estado (`GET /api/painel/planos/[id]/pdf`, sem auditoria, porque o status não é dado de saúde); publicar, "Editar", "Gerar o PDF de novo" e "Descartar rascunho" só valem para o plano do paciente da tela (outro: "Plano não encontrado.", sem efeito); plano de paciente bloqueado ou anonimizado não vira modelo; o editor confere ao abrir a revisão do plano (`GET /api/painel/planos/[id]/revisao`, sem auditoria) e, se a página veio velha do "Voltar" do navegador ou outra aba gravou depois, recarrega os dados em vez de dar um falso conflito; gramas das medidas caseiras com vírgula e as casas que a medida tem ("concha (12,25 g)", RNF-12). **Privacidade (RNF-08):** o texto livre (`orientacoes`, `observacao`) copiado de um plano de paciente para um modelo sai do alcance da RLS por paciente, da exportação e da exclusão do titular; a nutricionista, como controladora, escolhe salvar e a tela ainda não avisa. **Textos novos de interface** (nas histórias US-020 a US-026): busca ("Nenhum alimento encontrado.", "Não foi possível buscar agora. Tente de novo."), alimentos ("Sem valor na TACO", "Cadastrar meu alimento", erros de nome, grupo, valores, TACO não alterável, alimento em uso e valores incompletos), medidas (nome e plural, gramas, nome repetido, "Medida \"{nome}\" cadastrada."), plano (limites, meta, horário, substituição, indicador "Dentro da meta"/"Atenção"/"Fora da meta", "Salvando…"/"Salvo"/"Alterações não salvas", conflito entre abas, "Sessão expirada. Entre de novo." e o aviso de paciente bloqueado na linha de salvamento, "Versão N · Rascunho" (rascunho de paciente bloqueado, só consulta), "{nome} (removida)" (medida própria excluída), "Só dá para continuar com as alterações salvas.", "Há alterações que ainda não foram salvas. Sair mesmo assim?", erros e confirmação da publicação, "Plano publicado.", "Esta versão não está mais publicada. Recarregue a página.", "Modelo salvo."), PDF ("Baixar PDF", "Não foi possível gerar o PDF. Tente de novo.", "Gerar o PDF de novo", "O PDF já está sendo preparado.", "Não foi possível gerar o PDF." para paciente bloqueado, que não ganha PDF novo). **Pendências para o Plano 06 (P-16):** políticas `RESTRICTIVE` de escrita só da equipe em `foods`, `food_measures` e `anamnesis_templates` antes de qualquer sessão de paciente; filtrar planos `rascunho` da exportação do titular (US-046); decidir se as linhas de auditoria de edição de rascunho aparecem para o paciente; `stored_files` restrita por paciente para o download do PDF no portal |
| 1.7 | 2026-10-01 | Botão "Sair" (pedido do dono): o sistema não tinha como encerrar a sessão. Todas as áreas logadas ganham o botão "Sair" — no cabeçalho do painel da nutricionista (depois de "Segurança"; as páginas de alimentos, que não mostravam o cabeçalho, passam a mostrá-lo, e uma guarda estática falha se uma página do painel ficar sem ele), no topo de todas as páginas do admin (`src/app/admin/layout.tsx`), no portal do paciente (`src/app/p/layout.tsx`, inclusive as páginas futuras do Plano 06), em "Segurança da conta" (quem é obrigado a ativar o 2FA pode sair sem configurar), no aceite do DPA e em "Conta temporariamente indisponível" (esta só para quem tem sessão); as páginas públicas (`/entrar`, `/esqueci-senha`, `/convite`, `/definir-senha`) não têm o botão. **Saída por `POST /sair`** (Route Handler, `<form method="post" action="/sair">`, página inteira, funciona sem JavaScript; não é Server Action: com o cookie já apagado por outra aba o proxy responderia 307 e a tela mostraria "Application error"): aceita só com `Origin` igual à origem do `APP_URL` (ou, sem `Origin`, `Sec-Fetch-Site: same-origin`), senão 403 sem efeito; lê a sessão, **apaga a linha de `session` sem engolir o erro** e só então apaga o cookie, e responde 303 para `/entrar`; sem sessão válida (cookie ausente, inválido ou de outra aba que já saiu) apenas limpa o cookie e redireciona, sem erro; se apagar a linha falhar, mantém o cookie e responde 303 para a página pública `/sair/erro` (texto novo: "Não foi possível sair agora. Tente de novo.", com o botão e "Voltar ao início"), logando só o motivo, sem token nem SQL. O logger do Better Auth passa a mandar ao pino só o nível e a mensagem, sem os argumentos (o erro do Drizzle carrega os `params` com o token da sessão; RNF-11). **Editor do plano alimentar:** "Sair" com só o salvamento automático pendente envia a edição na hora, espera gravar e então sai, sem diálogo; sem rede, com erro de campo, conflito entre abas, paciente bloqueado ou se o envio não gravar, pede a confirmação "Há alterações que ainda não foram salvas. Sair mesmo assim?" (cancelar mantém no editor; aceitar descarta a edição por escolha da usuária e, sem rede, a sessão segue até ela sair com conexão); com tudo salvo, sai direto. Texto novo de interface (US-002): "Sair" e "Não foi possível sair agora. Tente de novo.". |
| 1.8 | 2026-10-03 | Fechamento do Plano 05 (Agenda & lembretes): desvios conscientes do plano, decisões da execução e decisões do dono (2026-10-01 a 2026-10-03) aplicados ao corpo da spec e às histórias. **WhatsApp (INT-01, D-05, D-07, E-04):** Evolution API v2.3.7 autohospedada (`nutri_evolution`, sem domínio, banco `evolution` no `nutri_db`) no lugar da Cloud API da Meta; **uma instância por tenant**, conectada pela nutricionista por QR code (o número é do consultório; D-07 substituída e "WhatsApp com número de cada nutricionista" sai do "Fora do MVP"); texto simples, sem templates nem botões; provedor `evolution`/`sandbox`/`fake` (`WHATSAPP_SANDBOX=1` em dev, CI e E2E, recusado em produção); webhook por instância com JWT HS256 do `jwt_key` derivado (HKDF) do segredo-mestre, recusa da repetição (marca de JWT + corpo gravada na mesma transação do evento, pelo tempo de vida do JWT; repetido → 200 sem efeito) e `EVOLUTION_WEBHOOK_URL` interna obrigatória em produção (`EVOLUTION_WEBHOOK_URL_PUBLICA=1` é opção explícita); texto do paciente reduzido a `confirmar`/`remarcar` na rota e evento cifrado na fila; ritmo de 8 mensagens/min por tenant; e-mail "WhatsApp desconectado" no máximo 1 a cada 6 h; E-04 revisado (runbook no Plano 05) e P-04 trocado pelo risco de bloqueio do número; nova pendência P-17 (contrato real da Evolution a conferir no E-04). **Sem link no WhatsApp (decisão do dono, 2026-10-02):** lembretes, respostas e o aviso de convite não levam o link assinado da consulta, o link da chamada nem o link do convite — os links vão só por e-mail e o texto cita o e-mail mascarado (`a***@dominio`); **US-035** por resposta "1"/"2" (+ link assinado no e-mail; selos "Confirmada via WhatsApp" e "Confirmada pelo link"); a resposta "2" grava também um **e-mail novo** com o link atual para remarcar, no e-mail atual do paciente (uma vez por resposta); **US-010:** o convite por WhatsApp é um aviso sem link, um texto só para conta nova ou existente, que não sai se o convite já foi aceito, e não há reenvio só por WhatsApp. **Link assinado da consulta (D20):** `/consulta/<token>` (HMAC de 128 bits com chave HKDF de `ENCRYPTION_KEY`), expira no início da consulta, cai quando o horário muda e é **amarrado ao e-mail do paciente** (corrigir o e-mail revoga os links enviados: "Link inválido."); nunca muda estado em `GET`; `no-referrer`. **Motor de envio (D6):** estado no banco varrido a cada minuto; uma linha por consulta, canal, tipo e início da consulta (`inicio_consulta`), criada na marcação para os três canais, com as condições conferidas no envio; enviada imutável; reserva `enviando` antes do provedor, canal por canal (o WhatsApp acumulado não segura e-mail e push), parte do lote por tenant com rodízio; **WhatsApp e push no máximo uma vez** (reserva interrompida vira "falhou" e não é retomada; o e-mail segue o caminho dele, com chave de idempotência — aceito pelo dono). **RN-05/D7:** horário silencioso também na reserva (adiado para as 08:00 quando faz sentido, em todos os canais; "hoje" no de 24 h do dia); reativação do tenant segue a RN-05 ao pé da letra (`prazo_passado`); troca só de duração, modalidade ou link sem aviso próprio ao paciente (R3). **RN-09:** limite de uso (não custo), contando o que a Evolution aceitou; respostas "1"/"2" não contam; excedente de uma volta fica pendente; aviso de 80% uma vez por mês. **Push (INT-03, D19):** só no worker, `push_subscriptions` com `tenant_id`/`patient_id`, só serviços de push conhecidos, TTL até a consulta, textos **neutros** sem o nome da nutricionista (decisão do dono); inscrição no P06-02. **Página pública (RN-16, US-032):** `agendamento_publico_ativo` padrão `false` e desligada para os tenants existentes (migration 0067; a nutricionista liga em Configurações); dois passos com código de 6 dígitos, limites por IP e e-mail, 3 consultas futuras conferidas depois do código, mesma resposta para qualquer e-mail; "Entrar (já sou paciente)" no Plano 06; opt-in de WhatsApp de paciente já existente descartado; reconferência da situação do paciente sob a trava da consulta nova (corrida com o pedido de exclusão). **§4.1:** módulos `agenda` e `notificacoes`; contexto `publico` negado no banco por padrão (`publico_negado` + `app_allow_publico` + `PUBLICO_LIBERADO` com guarda no CI); `staff_only` em regras, bloqueios, conexão do WhatsApp e pedidos públicos. **§7:** `appointments` com `inicio`/`fim` + `EXCLUDE` sobre `tstzrange(inicio, fim, '[)')`, colunas `confirmada_via`, `cancelada_em`, `remarcada_de`, `presenca_em`, `updated_at`, `cancelado_por` com `'sistema'`, CHECK do link online; `notifications` com `enviando`, `provider_jid`, `enviada_em`, `erro`, `conteudo_selado`, `inicio_consulta`, os tipos, os motivos (inclusive `consulta_remarcada` e `convite_aceito`) e o índice único parcial com `inicio_consulta`; `push_subscriptions` 🔒 por paciente; `consents.patient_id`; tabelas novas `whatsapp_conexoes`, `public_booking_requests`, `public_rate_limits`; `consultations.appointment_id` com FK e no máximo um atendimento por consulta; `tenants.agendamento_publico_ativo` padrão `false`. **RNF-03:** +512 MB do `nutri_evolution` (~3 GB no total). **§9.6:** `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `EVOLUTION_WEBHOOK_URL`, `EVOLUTION_WEBHOOK_URL_PUBLICA`, `WHATSAPP_SANDBOX` no lugar das `WHATSAPP_*` da Meta; `VAPID_*` no worker. **LGPD (RNF-08, US-018):** exportação com consultas, lembretes, aceites do termo e dispositivos de push (`{criadaEm, navegador}`), sem o motivo de cancelamento da nutricionista (decisão do dono); anonimização da agenda e dos aceites (migration 0065); pedido de exclusão atendido cancela as consultas futuras sem aviso ao paciente (`cancelado_por = 'sistema'`, selo "Cancelada pelo pedido de exclusão") e avisa a nutricionista; IPs do `audit_log` mantidos como registro de responsabilização; "Sistema" no "Histórico de acessos" para as ações do paciente na agenda. **Outros comportamentos registrados:** a nutricionista marca em qualquer data até hoje + 5 anos (inclusive no passado, sem lembretes) e fora das regras com aviso; corrida no `EXCLUDE` que vira deadlock (40P01) repete uma vez e devolve o conflito; fuso do consultório só entre os do Brasil; presença só depois do início, "Iniciar atendimento" a partir da agenda, taxa de faltas do mês com uma casa (CS-03). **Textos novos:** tabela "Textos de interface e mensagens do E4" nas histórias (fim do E4), com o texto exato do código. **Pendências novas:** P-17 (Evolution) e P-18 (cota esgotada encobre o motivo real; e-mail de 80% já em 100%; DPA com a Evolution e os serviços de push; `America/Eirunepe`). **Processo:** o fluxo de revisão por entrega foi revisto pelo dono em 2026-10-02 (revisão final por workflow + `/code-review high` no PR + re-revisão só do diff das correções + `/security-review`), já registrado no índice dos planos e no `CLAUDE.md`. **Pós-MVP (§10):** itens F3-01 a F3-06 e F4-01 confirmados pelo dono em 03/10/2026, a especificar com brainstorming depois do Plano 05 |
