# NutriDebby — Mensagens e recados (Plano 25) — Design

| Item | Valor |
|---|---|
| Versão | 0.4 (23/11/2026: revisão CFN da T2 — o CRN sem o prefixo repetido, o TCLE com o responsável legal e as fragilidades (Res. CFN 760/2023, art. 9º), CH-D73 e CH-D74; §17.4) · 0.3 (17/11/2026: v0.2 = painel de revisão aplicado — `revisor-rls`, `normas-cfn-lgpd` (só CFN) e `revisor-interface`; v0.3 = revisão do plano — `revisor-rls` e crítica de completude — com as regras que mudaram aqui; o que entrou, onde, e o que foi descartado, com o porquê, está na §17) |
| Data | 2026-11-17 |
| Situação | **Rascunho, com as decisões delegadas pelo dono (onda 3).** O dono autorizou seguir as recomendações sem parar para perguntar (briefing da onda 3): cada decisão de produto está na §14 como "CH-Dn — decisão — porquê". Por ordem do dono, a análise de **LGPD não entra** neste plano; as normas são só as do **CFN** (§10). As regras técnicas do repositório continuam obrigatórias (RLS, `withTenant`, auditoria, arquivos, nada de saúde em log). Painel de revisão aplicado na v0.2 (§17); o crítico de completude revisa junto com o plano. Conferida contra a `main` 07756c4 (Planos 01–18, 20 PR 1) |
| Itens do backlog | Paridade Dietbox, onda 3: **PD-90** (chat da nutricionista com o paciente: não lidas, anexos, horário de atendimento) e **PD-91** ("Enviar recado" para vários pacientes) |
| Quando | **Plano 25**, em paralelo com o Plano 26 (`nutridebby-26`) da onda 3, e depois dos Planos 19 (`nutridebby-b`), 20 PR 2 (`plano-20-financeiro`), 21 (`nutridebby-21`), 22 (`nutridebby-22`) e 23 (`nutridebby-23`/`nutridebby-c`), ainda abertos. Regras de convivência em `docs/operacao/sessoes-paralelas.md`. O Plano 24 (migração do Dietbox) foi descartado pelo dono em 17/11/2026 |
| Insumos | `.sessoes/onda3-briefing.md` (seção do Plano 25); levantamento do código (§1.3); specs e planos em andamento (§13). Referência funcional: o chat e o "Enviar recado" do Dietbox. **Copiamos a função, nunca a marca, os textos ou o layout** |
| Documentos de base | [`2026-10-03-nutridebby-paciente-exames-ia-design.md`](2026-10-03-nutridebby-paciente-exames-ia-design.md) (F3-02: IA Nutri, D24, RN-177, US-175; F3-04: envio de exame), [`2026-11-16-nutridebby-18-ficha-cadastro-design.md`](2026-11-16-nutridebby-18-ficha-cadastro-design.md) (registro de seções, D12, RN-277; formato), [`2026-11-17-nutridebby-23-agenda-2-design.md`](../../../../nutridebby-23/docs/superpowers/specs/2026-11-17-nutridebby-23-agenda-2-design.md) no worktree do 23 (locais, RN-404, RN-436; formato), plano do Plano 06 (portal, push, D1) e o manual técnico, caps. [02](../../manual-tecnico/02-banco-de-dados.md) e [05](../../manual-tecnico/05-agenda-portal-conteudo.md) |
| Numeração nova | US-440 a US-452 · RN-440 a RN-475 · RNF-440 a RNF-448 · CS-440 a CS-445 · C-440 a C-449 · R-440 a R-455 · DEP-CH1 a DEP-CH10 · PM-CH1 a PM-CH12 · P-CH1 a P-CH6 · **CH-D1 a CH-D48** (decisões deste documento; fora dele, cite "Plano 25, CH-Dn"; as CH-D49 a CH-D69 estão no plano e entram aqui no fechamento, T12; a CH-D70 a CH-D74, decisões da orquestradora em 23/11, já estão aqui, em §9.1–§9.5 e §14.1). O **bloco 440–479** é do Plano 25 (decisão da orquestradora em 17/11, ~11h40 UTC: o 23 vai até 439, o 26 usa 480–519); conferido com `grep -rhoE '\b(US\|RN\|RNF)-4[4-9][0-9]\b'` na `main` e nos worktrees em 17/11/2026 (nenhum uso) |

---

## 1. Visão

Hoje não há conversa livre entre a nutricionista e o paciente dentro do NutriDebby. O que existe:

- **IA Nutri (Plano 15).** O paciente pergunta à IA sobre o plano e pode "Enviar para minha nutricionista". A dúvida
  entra na fila "Dúvidas dos pacientes" (`/painel/duvidas`, `filaDeDuvidas` em
  `src/modules/ia/nutri-paciente/duvidas.ts`). A nutricionista só abre e "Marca como vista" (D24 = b do Plano 15):
  nenhum texto livre dela vai pela plataforma, porque uma resposta escrita seria telenutrição assíncrona e registro de
  prontuário (Res. CFN 760/2023 e 594/2017; spec F3-02 §5).
- **Avisos ao paciente:** e-mail e WhatsApp da agenda (Plano 05), push neutro do portal (Plano 06, `AVISOS_DO_PORTAL`)
  e lembretes de rotina (Plano 17). Nenhum deles leva texto da nutricionista.

O Plano 25 entrega:

1. **Mensagens (PD-90).** Uma conversa por paciente, no painel (`/painel/mensagens`) e no app (`/p/mensagens`), com
   texto e um anexo por mensagem (a nutricionista envia imagem ou PDF; o paciente envia foto, e o PDF de exame continua
   pelo "Enviar exame" do Plano 12). Caixa com "Todas" e "Não lidas", contador no menu, "Lida" nas mensagens.
   A conversa é **telenutrição assíncrona e parte do prontuário**: a nutricionista a libera paciente por paciente,
   registrando como o paciente concordou com o TCLE de telenutrição; as mensagens nunca são editadas nem apagadas, e cada mensagem da nutricionista leva o nome e o CRN dela, gravados na linha (RN-475).
2. **Avisos sem conteúdo.** O paciente recebe push neutro ("Você tem uma nova mensagem.") e, se não ler em 30 minutos,
   um e-mail sem o texto. A nutricionista vê o contador e, se quiser, recebe um e-mail sem nome nem texto, no máximo
   a cada 2 horas.
3. **Horário de atendimento por mensagens.** Faixas por dia da semana; fora delas, o paciente vê o aviso e pode enviar
   mesmo assim. O aviso fixo "não é para urgências" está sempre na tela, e a mensagem do paciente com sinal de risco
   (o filtro determinístico do Plano 15, sem IA) mostra na hora o texto de socorro e ganha o selo "Sinal de risco" na
   caixa.
4. **A dúvida da IA Nutri respondida pela conversa.** Na dúvida aberta, "Responder na conversa" leva à conversa do
   paciente; a mensagem enviada resolve a dúvida (resolução nova `respondida`), e o paciente vê na IA Nutri "Sua
   nutricionista respondeu em Mensagens.". A fila continua, como aba de Mensagens.
5. **Recados (PD-91).** "Novo recado": um texto da nutricionista para todos os pacientes com app ou para os que têm
   certas etiquetas; com o Plano 23 na `main`, também para os atendidos num local. O recado entra na conversa de cada
   paciente (mesmo sem a conversa liberada, só para leitura), com push neutro e sem e-mail. A caixa de conversas do painel
   não lista as conversas que só têm recado: o recado se acompanha em "Recados" (CH-D42).

O que **não** muda: a IA Nutri (consentimento, limites, retenção de 180 dias), o "Marcar como vista" da fila, os
lembretes e avisos da agenda, o WhatsApp (nada novo por ele), as seções do portal (Hoje, Jornada, Plano, Exames, Eu) e
as abas da ficha.

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-440 | Nenhum texto de mensagem, nome de anexo ou recado aparece em push, e-mail, log, Sentry ou `notifications` | Testes de `pushDaNotificacao`/`emailDaNotificacao` e do aviso à nutricionista (corpo fixo); guarda de grep: nenhum `logger.*` em `src/modules/mensagens` recebe `texto`, `anexoNome` ou `recado`; teste de que `notifications` não tem coluna de conteúdo nova |
| CS-441 | Paciente nunca lê a conversa de outro paciente nem envia mensagem numa conversa não liberada, pausada, de titular inativo ou em nome de outra conta; ninguém edita ou apaga mensagem | Teste de banco (`paciente_chat_envio`, `chat_mensagens_regras`, `REVOKE DELETE`) + `test/isolamento.test.ts` (FABRICAS, SO_INSERE/SEM_DELETE/IMUTAVEIS) |
| CS-442 | Toda abertura de conversa (painel e portal) e todo download de anexo gravam um `ler` em `audit_log`; a caixa, o contador e a consulta de "há novas" não gravam | Testes de integração com `audit_log` |
| CS-443 | A caixa com 300 conversas abre com p95 ≤ 800 ms (RNF-01) e a conversa com 500 mensagens com p95 ≤ 800 ms | Pilha de carga (P08-03) |
| CS-444 | A dúvida respondida pela conversa sai da fila na mesma transação da mensagem, e o paciente vê "Sua nutricionista respondeu em Mensagens." | Teste do módulo + E2E |
| CS-445 | A Debby atende por Mensagens por 2 semanas sem voltar ao chat do Dietbox | Conferência com a Debby, registrada no runbook do fechamento |

### 1.2 Premissas e restrições

| # | Premissa / restrição | Origem |
|---|---|---|
| C-440 | **Sem tempo real.** Nada de WebSocket, SSE ou serviço novo: a tela consulta "há novas?" a cada 15 s (só a contagem, sem texto) e recarrega pelo servidor | Infra de uma VPS com o worker e o app; RNF-01; CH-D4 |
| C-441 | **Nenhuma coluna nova em `patients`** (`PUBLICO_LIBERADO`, gatilho `paciente_colunas`) nem em `tenants` (disputado com o Plano 23, `agenda_confirmar_pedidos`) | Levantamento; §13 |
| C-442 | **Sem papel novo.** Só a sessão `nutri` usa o painel de mensagens; o admin nunca consulta; a recepcionista do Plano 26 não vê conversas nem recados | Regra 1 do CLAUDE.md; CH-D33 |
| C-443 | **Arquivos só pela regra 9:** `salvarArquivo`/`apagarArquivo`, tipo pelo conteúdo, cota reservada, servir por `signFileUrl`; imagem convertida no worker (sharp e HEIC só lá) | Regra 9 do CLAUDE.md; molde do diário (`diario-foto-job.ts`) |
| C-444 | **Nada do chat vai à IA.** Nem texto, nem anexo, nem recado entram em contexto de modelo; o filtro de risco é determinístico (`detectarRisco`, sem rede) | Spec F3-02 (D9); CH-D12, RN-469 |
| C-445 | **Nada por WhatsApp.** Nenhum tipo novo em `CONTA_COTA` | INT-01 (só transacional); Termos do WhatsApp |
| C-446 | **Migrations sem número reservado**, geradas de novo sobre a `main` antes do PR (`sessoes-paralelas.md` §5). Uma gerada + uma custom | §5; PM-CH1 |
| C-447 | **Arquivos disputados só recebem acréscimos** (`rls-guard.ts`, `audit-guard.ts`, `isolamento.test.ts`, `CLAUDE.md`, `navegacao.ts`, `queues.ts`, `worker/index.ts`, `notifications_tipo_valido`, `stored_files_tipo_valido`) | `sessoes-paralelas.md` §6 |
| C-448 | **Datas no fuso do consultório** (`tenants.fuso`): horário de atendimento, horário silencioso, separadores "Hoje"/"Ontem" | MVP RN-06 |
| C-449 | **Texto legal não muda neste plano** (termo do paciente, DPA). O TCLE de telenutrição é colhido pela nutricionista fora do sistema; aqui só se registra como (CH-D3) | Briefing (LGPD fora); §10 |

### 1.3 Dependências (conferidas no código em 17/11/2026, `main` 07756c4)

| ID | Depende de | O que esta spec usa | Situação e arquivo |
|---|---|---|---|
| DEP-CH1 | **IA Nutri (Plano 15)** | Fila, abrir dúvida, resolução | ✅ `ia_nutri_mensagens` (`src/db/schema/ia-nutri.ts`): CHECK `ia_nutri_mensagens_resolucao` com `resolucao in ('vista','encerrada')`, índice `ia_nutri_mensagens_fila_idx`; gatilho `ia_nutri_mensagens_regras` (`drizzle/0116_rls_ia_nutri.sql:108-114`: a equipe só muda `aberta_pela_nutri_em`, `resolvida_*`, `resolucao`, em nome da própria usuária). `filaDeDuvidas`, `contadorDeDuvidas`, `abrirDuvida`, `marcarComoVista`, `conversaNaFicha` (`duvidas.ts`); `avisarDuvidaVista` (push `duvida_vista`). Texto ao paciente `MSG…duvidaVista` (`constantes.ts:74`). Selos D22 (`risco_revogado`, `aviso_minimo`) |
| DEP-CH2 | **Filtro de risco** | Sinal de risco na mensagem do paciente | ✅ `detectarRisco(texto)` (`src/modules/ia/nutri-paciente/sinais-risco.ts:38`): puro, sem rede, devolve `risco` ∈ {`emergencia`, `transtorno_alimentar`} (o sintoma agudo volta como `emergencia`) e `textoFixo` ∈ {`risco_emergencia`, `sintoma_agudo`, `risco_transtorno`}: o chat grava pelo `textoFixo` (RN-449) |
| DEP-CH3 | **Push (Planos 06 e 17)** | Aviso ao paciente | ✅ `push_subscriptions` só de paciente (`src/db/schema/agenda.ts:248`); `AVISOS_DO_PORTAL` (`notificacoes/mensagens.ts:110`) com corpo neutro e tela; `pushDaNotificacao` sem consulta; envio só no worker (`push.ts`). **Não há push para a nutricionista** |
| DEP-CH4 | **Notificações** | Push e e-mail ao paciente | ✅ `notifications` (`agenda.ts:127-163`): CHECK fechado de `tipo` (16 valores), `patient_id` NOT NULL, sem conteúdo (só `conteudo_selado` do convite); `motivoParaIgnorar` (`enviar.ts:52`); `emailDaNotificacao` só com consulta (`mensagens.ts:39`); horário silencioso no `agendar.ts`; `dispararEnvio(tx, tenantId)` |
| DEP-CH5 | **Aviso à nutricionista** | E-mail sem conteúdo | ✅ `avisarNutri(tx, tenantId, montar)` e `emailsDaNutri` (`src/modules/agenda/aviso-nutri.ts`: exceção da tabela `user`, só e-mail); `enqueueEmail` (`src/email/queue.ts`) na transação |
| DEP-CH6 | **Arquivos** | Anexos | ✅ `salvarArquivo` (`antesDaReserva`, `registrar`), `apagarArquivo` (`naMesmaTransacao`), `TIPOS_DO_PACIENTE`, CHECK `stored_files_tipo_valido` (14 valores, `platform.ts:133`); política `paciente_arquivo_insert` (só `diario_foto_original`, `exame_original`) e `paciente_arquivos` (`drizzle/0102_rls_exames_enviados.sql:53-70`); `paraJpegSemMetadados` (`src/lib/jpeg.ts`); job `diario-foto` (`src/jobs/queues.ts:27`, `diario-foto-job.ts`, 40 MP, HEIC) |
| DEP-CH7 | **Etiquetas** | Filtro do recado | ✅ `patient_tags`/`patient_tag_links` (`src/db/schema/pacientes.ts:92-121`), `STAFF_ONLY` |
| DEP-CH8 | **Portal (Plano 16)** | Entrada no app | ✅ `SECOES_DO_PORTAL` com 5 seções (`src/app/p/navegacao.ts`, RN-190); `Faixa` (`src/components/portal/faixa.tsx`) em todas as seções; sessão do paciente com conta (`sessaoDePacienteComConta`, `src/db/tenant.ts:80`) |
| DEP-CH9 | **Menu e ficha do painel** | "Mensagens", seção do Início | ✅ `itensDoMenu({ exames, duvidas })` e `ITEM_DUVIDAS` (`src/app/painel/navegacao.ts`); `SecaoDaFicha` e `SECOES_DA_FICHA` (`src/modules/ficha/tipos.ts`, `secoes/index.ts`, Plano 18) |
| DEP-CH10 | **Locais de atendimento (Plano 23)** | Recado por local (US-449) | ⬜ só no branch `plano-23-agenda-2` (`nutridebby-c`, em implementação em 17/11/2026: `locais_atendimento`, `appointments.local_id`, RN-436 "filtro de local de pacientes" derivado das consultas). Só a US-449 espera o merge |

---

## 2. Escopo

### 2.1 Dentro

| ID | Bloco | Conteúdo | PD |
|---|---|---|---|
| CH-01 | **Caixa de mensagens** (`/painel/mensagens`) | Lista das conversas liberadas ou com mensagem individual (a conversa só de recado fica em "Recados", CH-D42), "Todas" e "Não lidas", busca por nome, selo "Sinal de risco", "Nova conversa"; abas "Conversas", "Dúvidas da IA Nutri" e "Recados"; item "Mensagens ({n})" no menu no lugar de "Dúvidas dos pacientes" | PD-90 |
| CH-02 | **Conversa no painel** (`/painel/mensagens/[patientId]`) | Mensagens, "Lida", anexos, envio, liberação com registro do TCLE, pausar e retomar | PD-90 |
| CH-03 | **Conversa no app** (`/p/mensagens`) | Link "Mensagens ({n})" na faixa; mensagens, recados, envio de texto e foto; aviso de urgência; aviso de horário; texto de socorro quando há sinal de risco | PD-90 |
| CH-04 | **Anexos** | Nutricionista: JPG, PNG, HEIC (convertidos a JPEG sem metadados) e PDF; paciente: foto (JPG, PNG, HEIC); até 10 MB; um por mensagem; servidos por `signFileUrl` com `auditRead` | PD-90 |
| CH-05 | **Avisos** | Paciente: push neutro e e-mail sem conteúdo depois de 30 min sem leitura; nutricionista: contador e e-mail sem conteúdo (opcional, no máximo a cada 2 h) | PD-90 |
| CH-06 | **Horário de atendimento** (`/painel/configuracoes/mensagens`) | Faixas por dia da semana, aviso fora do horário, liga/desliga o e-mail à nutricionista; cartão no fim de `CARTOES` | PD-90 |
| CH-07 | **Dúvida da IA Nutri pela conversa** | "Responder na conversa" na dúvida aberta; resolução `respondida`; "Respondida em Mensagens" na ficha; aviso no app | PD-90 |
| CH-08 | **Recados** (`/painel/mensagens/recados`) | Novo recado para "Todos os pacientes com app" ou "Pacientes com as etiquetas"; prévia do alcance; histórico com "Lido por {l} de {n}" | PD-91 |
| CH-09 | **Recado por local** (Fase B) | "Pacientes atendidos no local", com o Plano 23 na `main` | PD-91 |
| CH-10 | **Ficha** | Seção "Mensagens" no Início (registro do Plano 18) com "Enviar mensagem" no "Adicionar" | PD-90 |
| CH-11 | **Titular, manuais e ajuda** | Mensagens e anexos na exportação (`dados.json` e ZIP); conversa só para leitura no bloqueio; apagada só na anonimização; guias `mensagens` (painel) e do portal; manual técnico caps. 02 e 05 | — |

### 2.2 Fora

| Item | Por quê |
|---|---|
| Tempo real (WebSocket, SSE), "digitando…", presença on-line | C-440; a consulta de 15 s basta para conversa assíncrona (CH-D4) |
| Videochamada ou chamada de voz | Suboperador novo; o link externo do Plano 23 cobre (AG-D2 de lá) |
| Áudio, vídeo e vários anexos por mensagem | Armazenamento e moderação; um anexo por mensagem (CH-D8). Backlog |
| PDF enviado pelo paciente na conversa | O original de PDF do paciente nunca chega ao navegador da nutricionista (Plano 12, R-170): exame vai por "Enviar exame" (CH-D6) |
| Editar, apagar ou "apagar para todos" | Prontuário imutável (CH-D2); o erro se corrige com outra mensagem |
| Mensagem automática de ausência, "férias", resposta pronta (modelos de mensagem) | YAGNI no v1; o aviso de horário cobre o principal (CH-D21). Backlog |
| Conversa em grupo, conversa entre nutricionistas, mensagem para quem não é paciente | Fora do PD-90 |
| Recado por e-mail, WhatsApp ou SMS | Texto livre fora do app quebraria a regra 3 (CH-D16) e o INT-01 |
| Recado agendado, recado com anexo | YAGNI; backlog |
| Recado a paciente sem acesso ao app | Não há onde entregar sem levar o texto para fora do app (CH-D16) |
| Push para a nutricionista | `push_subscriptions` é do paciente; inscrição da equipe é projeto à parte (CH-D10). Backlog |
| Rascunho de resposta pela IA, resumo da conversa pela IA | C-444; spec F3-02, D12 |
| Pesquisa no texto das mensagens | Leitura de dado de saúde em massa; backlog com `auditRead` próprio |
| "Marcar como não lida" | O marcador só avança (RN-452). Backlog |
| Cartão de mensagens no Início do painel | O contador do menu basta; o Início é disputado com o Plano 23 (CH-D27) |
| Registro geral do TCLE de telenutrição (para consultas online) | Backlog "Telenutrição" do Plano 23 (AG-D36). Aqui só a forma do aceite para a conversa (CH-D3) |
| Mudança no termo do paciente ou no DPA | C-449 |

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** (sessão `nutri`) | Ver a caixa e todas as conversas do consultório; liberar, pausar e retomar a conversa; enviar texto e anexo em conversa liberada; responder dúvida da IA Nutri pela conversa; enviar e ver recados; configurar o horário e o aviso por e-mail | Editar ou apagar mensagem ou recado; enviar mensagem individual em conversa não liberada ou pausada; enviar a paciente bloqueado, arquivado ou anonimizado; ver o texto das mensagens na caixa (só nome, data e tipo); liberar a conversa ou enviar sem o nome profissional e o CRN preenchidos (RN-475) |
| **Paciente com conta** (sessão `paciente`, `actorUserId`) | Ler a própria conversa (mensagens e recados); enviar texto e foto em conversa liberada e não pausada; marcar como lida (ao abrir); ver o horário de atendimento | Enviar PDF; enviar em conversa não liberada ou pausada; ler `recados` (só a cópia na conversa); mudar liberação, pausa ou configuração; ver a conversa de outro vínculo pela sessão deste |
| **Paciente sem conta** (`semConta`) | Nada | Qualquer leitura ou escrita das tabelas `chat_*`: fora de `SEM_CONTA_PERMITIDOS` e negado também pelo banco (política RESTRICTIVE `paciente_com_conta`, CH-D47) |
| **Público** | Nada | Tudo (`publico_negado`) |
| **Worker** | Converter a foto e marcar o anexo pronto, com falha ou removido; enviar push e e-mail; exportar; apagar a conversa do titular na anonimização e na rede de limpeza dos já anonimizados (RN-466); varredura dos anexos (RN-474) | Criar mensagem (o gatilho recusa o INSERT do `worker`); mudar texto |
| **Admin** | Nada (nenhuma métrica nova) | Consultar as tabelas `chat_*` e `recados` |

---

## 4. Arquitetura

### 4.1 Rotas e navegação

| Tela | Rota | Título (h1) | Nova? |
|---|---|---|---|
| Caixa | `/painel/mensagens?filtro=nao-lidas&busca=<texto>&pagina=<n>` (formulário GET, funciona sem JS; 50 por página, "Mostrar mais") | "Mensagens" | Nova |
| Conversa (painel) | `/painel/mensagens/[patientId]` (`?duvida=<id>` vindo da fila; `?ok=liberada\|pausada\|retomada\|respondida`; `?antes=<id da mensagem>` para as anteriores; `?erro=` do upload sem JS) | "{nome de registro}" | Nova |
| Nova conversa | `/painel/mensagens/nova?busca=<texto>&pagina=<n>` (escolher o paciente; v0.3: só titulares `ativo` e não anonimizados, com ou sem conversa, em ordem alfabética do nome de registro, 50 por página com "Mostrar mais", busca por nome como a lista de pacientes; "Sem acesso ao app" quando o paciente não tem conta; sem `auditRead`, como a lista de pacientes; cada linha é link com `prefetch={false}` para a conversa) | "Nova conversa" | Nova |
| Recados | `/painel/mensagens/recados` (`?ok=enviado`) | "Recados" | Nova |
| Novo recado | `/painel/mensagens/recados/novo` (dois passos: "Revisar" e "Enviar recado") | "Novo recado" | Nova |
| Dúvidas da IA Nutri | `/painel/duvidas`, `/painel/duvidas/[id]` (a rota não muda; ganha as abas e "Responder na conversa") | como hoje | Muda |
| Configuração | `/painel/configuracoes/mensagens` | "Atendimento por mensagens" | Nova |
| Hub de configurações | `/painel/configuracoes` (cartão "Atendimento por mensagens" no **fim** de `CARTOES`) | como hoje | Muda (só acrescentar) |
| Ficha: Início | `/painel/pacientes/[id]` (seção "Mensagens" pelo registro) | como hoje | Muda (só acrescentar) |
| Conversa (app) | `/p/mensagens` (tela de detalhe com "Voltar", sem seção própria; `?antes=<id da mensagem>`; carregada só com internet e nunca no cache do service worker, RN-473) | "Mensagens" | Nova |
| IA Nutri (app) | `/p/plano/ia` ("Sua nutricionista respondeu em Mensagens.") | como hoje | Muda |
| APIs | `GET /api/painel/mensagens/situacao?paciente=<id>&depois=<id da mensagem>` e `GET /api/p/mensagens/situacao?depois=<id da mensagem>` (só `{ novas: n, ultimaLida: id \| null }`, RN-452); `GET /api/painel/mensagens/contador` (só `{ n }`, RN-459); `POST /api/painel/mensagens/[patientId]/anexo` e `POST /api/p/mensagens/foto` (upload, `LIMITE_CORPO` 10 MB + margem; sem JS, 303 de volta à conversa com `?erro=<código>`, nunca JSON nem página crua); `GET /api/painel/mensagens/[patientId]/anexos/[mensagemId]` e `GET /api/p/mensagens/anexos/[mensagemId]` (`auditRead` + 303 para `signFileUrl`; só `anexo_path` com `anexo_status = 'pronto'`, RN-454) | — | Novas |

- **Menu do painel** (`navegacao.ts`): `ITEM_MENSAGENS = { href: '/painel/mensagens', rotulo: 'Mensagens' }` sempre
  visível para a sessão `nutri`, **no lugar** de `ITEM_DUVIDAS` (que sai do menu; a rota fica) e na mesma posição
  (antes de "Conteúdos"). Contador = conversas com mensagem do paciente não lida + dúvidas abertas (`contadorDeDuvidas`), também atualizado por uma consulta leve a cada 60 s com a aba visível (RN-459, CH-D43).
  `itemAtual` marca "Mensagens" também em `/painel/duvidas` (CH-D14).
- **Abas de Mensagens** (links com `aria-current="page"`, como as da agenda e do Financeiro): "Conversas ({n})" ·
  "Dúvidas da IA Nutri ({n})" · "Recados". "Dúvidas da IA Nutri" só aparece com a IA Nutri ativada ou com dúvida aberta
  (a regra de hoje de `ITEM_DUVIDAS`). Componente `AbasDeMensagens` usado só na caixa, em `/painel/duvidas` e em Recados
  (não na conversa nem no novo recado). O `<nav>` das abas tem `aria-label="Seções de Mensagens"` e o das pílulas
  `aria-label="Filtro das conversas"`. A tela `/painel/duvidas` passa a ter o h1 "Dúvidas da IA Nutri": um nome só para
  menu, aba, título, "Voltar", guias e aviso do portal (CH-D45).
- **Portal:** nenhuma seção nova (Plano 16, RN-190). A `Faixa` ganha, na linha do consultório, o link "Mensagens" (ou
  "Mensagens ({n})", com `aria-label` "Mensagens, {n} não lidas"), só quando o paciente tem conversa (liberada ou com
  recado). `/p/mensagens` é tela de detalhe (`CabecalhoDetalhe` com "Voltar" para `/p/inicio`) e entra no `tambem` de
  "Hoje", o destino do "Voltar" (CH-D15, CH-D48). Na cópia guardada de `/p/plano` (modo sem internet), o link sai sem
  contador; o link tem `prefetch={false}` (RN-473).

### 4.2 Módulos

Todas as funções com `withTenant(ctx, …)` e `ctx` com `actorUserId` e `ip`. As do painel conferem `ctx.role === 'nutri'`
antes de abrir a transação; as do portal, `sessaoDePacienteComConta(ctx)`.

| Arquivo | Papel |
|---|---|
| `src/modules/mensagens/constantes.ts` (novo, puro) | `MSG_MENSAGENS`, `MSG_RECADOS`, `MSG_PORTAL_MENSAGENS`, limites (`TEXTO_MAX` 2000, `RECADO_MAX` 1000, `ANEXO_MAX_BYTES` 10 MB, `POR_HORA_PACIENTE` 30, `POR_DIA_PACIENTE` 200, `ANEXOS_DIA_PACIENTE` 20, `RECADOS_DIA` 10, `ESPERA_EMAIL_MIN` 30, `INTERVALO_AVISO_NUTRI_H` 2, `CONSULTA_S` 15), rótulos de autor e de tipo, `RISCO_DO_TEXTO_FIXO` (RN-449) |
| `src/modules/mensagens/caixa.ts` (novo) | `caixaDeMensagens(ctx, { filtro, busca })` (uma consulta agregada: última mensagem, tipo, não lidas, risco não lido; sem texto), `contadorDeMensagens(ctx)`; a caixa lista só conversas liberadas ou com mensagem individual (CH-D42) |
| `src/modules/mensagens/conversa.ts` (novo) | `conversaNoPainel(ctx, patientId, { antes? })` (auditRead, marca lida do lado `consultorio`), `minhaConversa(ctx, { antes? })` (portal: auditRead, marca lida do lado `paciente`), `situacao(ctx, …)` (só contagem), `liberarConversa`, `pausarConversa`, `retomarConversa` (cada uma com `recordAudit` de entidade própria: `chat_liberacao`, `chat_pausa`, `chat_retomada`, CH-D39); o marcador é gravado no SQL a partir do id da última mensagem mostrada (RN-448) |
| `src/modules/mensagens/envio.ts` (novo) | `enviarComoNutri(ctx, patientId, { texto, anexo? })`, `enviarComoPaciente(ctx, { texto, foto? })`, `responderDuvidaPelaConversa(ctx, duvidaId, { texto, anexo? })`; travas e limites (RN-447); `detectarRisco` no texto do paciente |
| `src/modules/mensagens/avisos.ts` (novo) | `avisarPaciente(tx, …)` (push e e-mail agrupados, RN-456), `avisarNutriDeMensagem(tx, …)` (RN-458); v0.3: o horário silencioso usa `emHorarioSilencioso` e `fimDoSilencio` de `notificacoes/agendar.ts` (sem helper novo) e o "dentro do horário de mensagens" usa `dentroDoHorario` de `horario.ts` |
| `src/modules/mensagens/horario.ts` (novo) | Leitura e gravação de `chat_configuracoes` e `chat_horarios`; `dentroDoHorario`, `resumoDoHorario` (puros) |
| `src/modules/mensagens/recados.ts` (novo) | `alcanceDoRecado(ctx, filtro)` (contagem), `enviarRecado(ctx, { texto, filtro })`, `listarRecados(ctx)` |
| `src/modules/mensagens/anexos.ts` (novo) | `salvarAnexoDaNutri`, `salvarFotoDoPaciente` (`salvarArquivo` com `antesDaReserva` = trava do paciente e `registrar` = INSERT da mensagem), `caminhoDoAnexo` (painel e portal, com `auditRead`; só `anexo_path` com `anexo_status = 'pronto'`, nunca o original) |
| `src/modules/mensagens/anexo-job.ts` (novo, **só worker**) | Fila `chat-anexo`: imagem original → JPEG sem metadados (`paraJpegSemMetadados`, 40 MP, HEIC como o diário); `pronto` ou `falhou`; o original sai pelo `apagarArquivo` |
| `src/modules/mensagens/varredura.ts` (novo, **só worker**) | RN-474: mensagem presa em `processando`, original que sobrou depois de `pronto`/`falhou` e arquivo órfão dos tipos `chat_*` (molde `exames-enviados-varredura.ts`) |
| `src/modules/mensagens/lgpd.ts` (novo) | `mensagensParaExportacao(tx, patientId)` (worker), `apagarConversaDoTitular(ctx, patientId)` (anonimização, RN-466), `anexosDeChatRestantes(tx, patientId)` (reconferência na transação final) e `apagarConversasDosAnonimizados(ctx)` (rede de limpeza no início de cada tenant, molde `apagarCadastrosDosAnonimizados`) |
| `src/modules/ficha/secoes/mensagens.ts` (novo) | Seção "Mensagens" do Início (§4.4); **uma linha no fim** de `SECOES_DA_FICHA` |
| Mudam | `ia/nutri-paciente/duvidas.ts` (`situacaoDaDuvida` com `respondida`; `abrirDuvida` devolve `podeResponderNaConversa`), `ia/nutri-paciente/conversa.ts` e a tela `/p/plano/ia` (texto "Sua nutricionista respondeu em Mensagens."), `ia/nutri-paciente/constantes.ts`, `notificacoes/{tipos,mensagens,enviar}.ts` (tipos `chat_mensagem`, `recado`; motivo `mensagem_lida`; e-mail sem consulta; v0.3: `ContextoEnvio` ganha o campo carregado por `carregarContexto` que diz se há mensagem da equipe não lida, e `motivoParaIgnorar` continua puro), `src/email/types.ts` e `templates.tsx` (`chat_mensagem`, `aviso_mensagens_nutri`), `plataforma/armazenamento.ts` (`TipoDeArquivo`, `TIPOS_DO_PACIENTE`), `plataforma/audit.ts` (`ENTIDADE_ROTULO`), `app/painel/navegacao.ts`, `components/portal/faixa.tsx` e `app/p/navegacao.ts` (`tambem` de "Hoje"), `app/painel/configuracoes/page.tsx` (`CARTOES`), `pacientes/exportacao-job.ts`, `pacientes/lgpd.ts` (chamada na anonimização), `src/jobs/queues.ts` e `src/worker/index.ts` (fila `chat-anexo`, linha no fim), `ajuda/conteudo.ts` e `ajuda/portal.ts` (guias). `ia/nutri-paciente/lgpd.ts` (`SITUACAO_DA_DUVIDA` com `respondida`), `plataforma/audit.ts` (também `acaoDoItem` e `visivelNoHistorico`: `chat_conversa` fora da tela), `agenda/aviso-nutri.ts` (só a docstring de `emailsDaNutri`: uso novo, o aviso de mensagens; regra 1 do `CLAUDE.md`), `app/painel/{layout.tsx,cabecalho.tsx,cabecalho.test.ts,menu-painel.tsx}` (a prop `duvidas` vira `mensagens`; `itensDoMenu` muda de assinatura), `app/sw.ts` (`/p/mensagens` nunca no cache, RN-473), `components/ui/selo.tsx` (variante `alerta` com tokens), `ficha/adicionar.ts` (`{id}` no href absoluto, CH-D44) e `ficha/tipos.ts` (membro opcional `rotuloDoTotal`), `e2e/painel-rotas.ts` (`ROTAS_DO_PAINEL`, `IdsDoPainel`). `src/db/tenant.ts` não muda (`SEM_CONTA_PERMITIDOS` igual) |

### 4.3 Fluxo de uma mensagem

```
Paciente (/p/mensagens)                                   Nutricionista (/painel/mensagens/[id])
  enviarComoPaciente                                         enviarComoNutri / responderDuvidaPelaConversa
   trava patients (FOR UPDATE) → limites → detectarRisco      trava patients (FOR SHARE) → conversa liberada?
   INSERT chat_mensagens (autor paciente, risco?)             INSERT chat_mensagens (autor nutri[, duvida_em])
   [foto: salvarArquivo chat_anexo_original → job]            [dúvida: UPDATE ia_nutri_mensagens resolucao='respondida']
   avisarNutriDeMensagem (e-mail, ≤ 1/2 h, no horário)        avisarPaciente: notifications push (agora ou 8h)
   leitura do lado paciente avança                            + e-mail (agora + 30 min), se não há aviso pendente
            │                                                          │
            ▼                                                          ▼
  Caixa: "Não lidas", selo "Sinal de risco"          Worker: motivoParaIgnorar → 'mensagem_lida' se leu antes
  Conversa aberta: auditRead + leitura do lado        Portal: link "Mensagens (n)"; abrir = auditRead + leitura
  consultório avança                                  Situação a cada 15 s: só { novas, lidaAte }
```

### 4.4 Ficha do paciente

Nenhuma aba nova (Plano 18 D12). A seção **"Mensagens"** entra pelo registro (`SecaoDaFicha`): `id: 'mensagens'`,
`titulo: 'Mensagens'`, `aba: ''`, `verTodos: (id) => '/painel/mensagens/' + id`, `disponivel` = sempre, sem `leitura`
(só rótulos genéricos, nunca o texto: nenhum `auditRead`, RN-277 do Plano 18), `adicionar: [{ grupo: 'outros', rotulo:
'Enviar mensagem', destino: { href: '/painel/mensagens/{id}' } }]`. O `adicionar` não é função como o `verTodos`, e
`caminhoNaFicha` (`src/modules/ficha/adicionar.ts:19`) devolve o href absoluto sem trocar nada: o link sairia
`/painel/mensagens/{id}` literal. O Plano 25 muda só essa função, que passa a trocar `{id}` pelo `patientId` no href
absoluto, com teste (CH-D44). O `resumo` devolve `podeAdicionar: false` com o titular fora de `ativo` ou anonimizado
(o "Enviar mensagem" some). `total` = mensagens do paciente não lidas pelo consultório, mostrado como "{n} não lidas" /
"1 não lida" pelo membro opcional novo `rotuloDoTotal(n)` de `SecaoDaFicha` (só acrescentar; as outras seções contam
registros), e até 3 itens, os mais recentes primeiro, com rótulo "Mensagem do paciente", "Mensagem enviada" ou "Recado"
e a data no fuso; `situacao` "Sinal de risco" quando o item tem risco. Sem `noApp`. O título entra em
`MSG_FICHA.titulos`. Teste: a seção nunca devolve `texto` (teste das chaves). "Ver todos" e "Enviar mensagem" com
`prefetch={false}` (RN-473).

---

## 5. Histórias de usuário

### E25 — Mensagens e recados

#### US-440 — Liberar a conversa com o paciente · **M** (PD-90)

**Como** nutricionista, **quero** liberar a conversa por mensagens com um paciente depois de colher o TCLE, **para**
atender a distância dentro das regras da telenutrição.

```gherkin
Cenário: Conversa ainda não liberada
  Dado o paciente "Ana Souza", ativo, sem conversa liberada
  Quando abro "/painel/mensagens/{id}"
  Então vejo "A conversa com Ana Souza ainda não foi liberada." e o botão "Liberar conversa"
  E o campo de mensagem não aparece

Cenário: Liberar
  Quando toco em "Liberar conversa"
  Então vejo o diálogo "Liberar a conversa com Ana Souza?" com o texto da RN-441 e o aviso do e-Nutricionista
  Quando toco em "Liberar" sem escolher "Como o paciente (ou o responsável legal) concordou?" ou sem marcar "O paciente, ou o responsável legal, deu ciência e concordou com o TCLE de telenutrição, e enviei a ele o comprovante."
  Então vejo "Escolha como o paciente concordou e marque a confirmação." junto ao campo, e nada é gravado
  Quando escolho "Aceite por escrito (mensagem ou e-mail)", marco a confirmação e toco em "Liberar"
  Então vejo "Conversa liberada." (role="status") e o campo de mensagem
  E chat_conversas grava liberada_em, liberada_por = minha usuária e tcle_forma = 'aceite_escrito'
  E o "Histórico de acessos" mostra "Liberou a conversa por mensagens" (e nenhum "Criou" da linha da conversa)

Cenário: Paciente inativo
  Dado um paciente arquivado
  Então "Liberar conversa" não aparece e vejo "Paciente arquivado: a conversa fica só para consulta."

Cenário: Sem nome profissional ou CRN
  Dado o consultório sem o nome profissional ou sem o CRN no Perfil
  Quando toco em "Liberar conversa"
  Então vejo "Para liberar a conversa, preencha seu nome e seu CRN em Configurações." com o link para o Perfil, e nada é gravado
```

#### US-441 — Conversar com o paciente no painel · **M** (PD-90)

**Como** nutricionista, **quero** ler e responder as mensagens de um paciente, **para** acompanhar entre as consultas.

```gherkin
Cenário: Abrir a conversa
  Dado a conversa liberada com "Ana Souza" com 3 mensagens dela não lidas
  Quando abro a conversa
  Então vejo as mensagens em ordem, com separadores "Hoje", "Ontem" ou a data
  E cada mensagem com a hora ("14:32", no fuso do consultório), as minhas com o autor "Você" e, sob cada bloco da equipe, o carimbo gravado nela ("{nome profissional} · Nutricionista · {crn}")
  E o contador do menu diminui
  E o "Histórico de acessos" da Ana mostra "Visualizou — Mensagens (conversa com o paciente)"

Cenário: Enviar texto
  Quando escrevo "Pode trocar o arroz por batata no almoço." e toco em "Enviar"
  Então a mensagem aparece com "Enviada" e, depois que a Ana abrir a conversa, "Lida"

Cenário: Mensagem longa ou vazia
  Quando toco em "Enviar" sem texto e sem anexo
  Então vejo "Escreva a mensagem ou anexe um arquivo." junto ao campo (aria-describedby), e o texto digitado nunca se perde
  Quando escrevo 2.001 caracteres
  Então vejo "A mensagem tem até 2.000 caracteres."

Cenário: Mensagem nova enquanto a tela está aberta
  Dado a conversa aberta
  Quando a Ana envia uma mensagem
  Então em até 15 segundos a região viva (sempre montada, vazia até então) anuncia "Nova mensagem de Ana." e aparece o botão "Mostrar novas mensagens"
  E nada do texto chega ao navegador antes de eu tocar no botão
  Quando toco em "Mostrar novas mensagens"
  Então o foco vai para a primeira mensagem nova e nenhuma mensagem já mostrada volta a contar como nova

Cenário: Conversa pausada
  Dado a conversa pausada
  Então vejo "Conversa pausada" e "Retomar conversa" no lugar do campo de mensagem
```

#### US-442 — Ver a caixa de mensagens · **M** (PD-90)

**Como** nutricionista, **quero** ver quais pacientes escreveram, **para** responder primeiro quem espera.

```gherkin
Cenário: Caixa com filtros
  Quando abro "Mensagens"
  Então vejo as conversas, a mais recente primeiro, com nome, quando ("há 5 min", "ontem", "12/11"), o tipo da última ("Mensagem do paciente", "Você enviou", "Imagem", "Arquivo PDF", "Recado") e "{n} não lidas"
  E nunca o texto das mensagens
  Quando escolho "Não lidas"
  Então só vejo as conversas com mensagem do paciente não lida

Cenário: Sinal de risco
  Dado que a Bia enviou "não aguento mais, quero sumir"
  Então a conversa da Bia aparece no topo com o selo "Sinal de risco" enquanto não for aberta (abrir tira o selo da caixa; na conversa, a mensagem continua com o selo)

Cenário: Conversa só com recado
  Dado a Carla, sem conversa liberada, que só recebeu recados
  Então a conversa da Carla não aparece em "Conversas" nem em "Não lidas"; o recado está em "Recados" com "Lido por"

Cenário: Caixa vazia
  Então vejo "Nenhuma conversa ainda. Para começar, toque em "Nova conversa" ou abra a ficha do paciente."

Cenário: Nova conversa
  Quando toco em "Nova conversa", busco "Car" e escolho "Carla Lima"
  Então abro "/painel/mensagens/{id da Carla}"
```

#### US-443 — Conversar com a nutricionista pelo app · **M** (PD-90)

**Como** paciente, **quero** mandar mensagens à minha nutricionista pelo app, **para** tirar dúvidas sem esperar a consulta.

```gherkin
Cenário: Entrar em Mensagens
  Dado a conversa liberada e 1 mensagem da nutricionista não lida
  Então vejo "Mensagens (1)" na faixa de qualquer seção
  Quando toco no link
  Então vejo "Conversa com {nome profissional}, nutricionista, {crn}", o aviso "Este canal não é para urgências…" e o campo "Escreva sua mensagem"
  E o link volta a "Mensagens"

Cenário: Enviar
  Quando escrevo e toco em "Enviar"
  Então a mensagem aparece com o autor "Você" e "Enviada"

Cenário: Fora do horário
  Dado que a nutricionista atende por mensagens de segunda a sexta, das 9h às 18h, e agora é sábado
  Então vejo "Agora é fora do horário de atendimento por mensagens. Sua mensagem fica guardada e será lida quando sua nutricionista voltar ao atendimento por mensagens."
  E consigo enviar

Cenário: Sinal de risco
  Quando envio "estou com dor no peito e falta de ar"
  Então logo abaixo da minha mensagem vejo o texto de socorro de sintoma agudo (RN-449), não o de emergência
  E a mensagem é enviada à nutricionista com o selo
  Quando envio "não aguento mais, quero sumir"
  Então vejo o texto de socorro de emergência (CVV 188)

Cenário: Muitas mensagens seguidas
  Dado que enviei 30 mensagens na última hora
  Então vejo "Você enviou muitas mensagens seguidas. Espere alguns minutos e tente de novo." e o texto continua no campo

Cenário: Conversa não liberada, só com recados
  Então vejo os recados e "Por enquanto, sua nutricionista só envia recados por aqui. Para falar com o consultório, use os canais de sempre."
  E não há campo de mensagem

Cenário: Conversa pausada
  Então vejo "A conversa por mensagens está pausada pelo consultório. Para falar com sua nutricionista, use os canais de sempre."

Cenário: Sem internet
  Dado o app aberto sem conexão
  Quando toco em "Mensagens"
  Então vejo "Sem conexão. Escreva quando voltar." e o campo e os botões desabilitados, nunca o plano no lugar da conversa
  E o texto que eu já tinha escrito continua no campo
```

#### US-444 — Enviar e receber anexos · **M** (PD-90)

**Como** nutricionista, **quero** mandar imagem ou PDF; **como** paciente, **quero** mandar foto, **para** mostrar o que
o texto não diz.

```gherkin
Cenário: Nutricionista envia PDF
  Quando toco em "Anexar arquivo", escolho "lista.pdf" (300 KB) e toco em "Enviar"
  Então a mensagem mostra "Arquivo PDF · lista.pdf · 300 KB" com o link "Abrir"
  E ao tocar em "Abrir" o arquivo abre por um link de 5 minutos e o "Histórico de acessos" registra a leitura

Cenário: Imagem em processamento
  Quando o paciente envia uma foto HEIC de 4 MB
  Então a mensagem aparece com "Enviando foto…" até o worker converter
  E depois mostra a imagem (JPEG, sem localização nem dados da câmera)
  E, se a conversão falhar, "Não foi possível processar a foto. Tente outra."

Cenário: Formato não aceito
  Quando o paciente tenta enviar um PDF
  Então o seletor só oferece imagens, e a ajuda diz "Para enviar um exame em PDF, use Exames." (com o link, quando "Exames" aparece para ele)
  E, se o arquivo chegar ao servidor mesmo assim, ele responde "Formato de arquivo não permitido." pelo conteúdo, não pelo nome

Cenário: Arquivo grande ou cota esgotada
  Quando escolho um arquivo de 12 MB
  Então vejo "O arquivo passa de 10 MB."
  E, com a cota do consultório esgotada, "Espaço de armazenamento esgotado. Fale com o suporte."
```

#### US-445 — Ser avisado de mensagem nova · **M** (PD-90)

**Como** paciente, **quero** saber que chegou mensagem, **sem** que a tela de bloqueio diga o assunto.

```gherkin
Cenário: Push e e-mail ao paciente
  Dado o paciente com push ativo
  Quando a nutricionista envia 3 mensagens seguidas às 10h
  Então o paciente recebe um push "Você tem uma nova mensagem." (um só, título "NutriDebby") que abre "/p/mensagens"
  E, se às 10h30 a conversa ainda não foi aberta, um e-mail "Você tem uma nova mensagem" sem o texto
  E, se ele abrir antes das 10h30, o e-mail fica "ignorada" com o motivo "mensagem já lida"

Cenário: Horário silencioso
  Quando a nutricionista envia às 22h
  Então o push e o e-mail ficam para as 8h do dia seguinte, no fuso do consultório

Cenário: Aviso agrupado não perde mensagem
  Dado que a nutricionista enviou uma mensagem às 10h e o paciente a leu às 10h10
  Quando ela envia outra às 10h15, com o e-mail das 10h30 ainda pendente
  Então o e-mail das 10h30 sai, porque há mensagem da equipe não lida (RN-456)

Cenário: Aviso à nutricionista
  Dado "Avisar por e-mail quando chegar mensagem de paciente" ligado e o horário de mensagens das 9h às 18h
  Quando um paciente envia às 11h e outro às 11h40
  Então a nutricionista recebe um e-mail "Mensagens novas de pacientes" às 11h, sem nome de paciente nem texto, e nenhum às 11h40
  E uma mensagem às 20h não gera e-mail (fora do horário); o contador do menu mostra a conversa entre as não lidas
```

#### US-446 — Definir o horário de atendimento por mensagens · **S** (PD-90)

```gherkin
Cenário: Configurar
  Quando abro "Configurações" → "Atendimento por mensagens"
  E ligo "Mostrar horário de atendimento aos pacientes", acrescento segunda a sexta das 9h às 12h e das 14h às 18h e toco em "Salvar"
  Então vejo "Configuração salva."
  E o paciente vê "Horário de atendimento por mensagens: segunda a sexta, 9h às 12h e 14h às 18h."

Cenário: Horário desligado
  Dado "Mostrar horário de atendimento aos pacientes" desligado, com faixas salvas
  Então o paciente não vê o horário nem o aviso de fora do horário, e as faixas ficam guardadas para quando ligar

Cenário: Faixas inválidas
  Quando informo das 14h às 12h
  Então vejo "O fim tem de ser depois do início."
  Quando informo 9h–12h e 11h–13h na segunda
  Então vejo "As faixas do mesmo dia não podem se sobrepor."
```

#### US-447 — Responder a dúvida da IA Nutri pela conversa · **M** (PD-90)

**Como** nutricionista, **quero** responder por escrito a dúvida que a IA Nutri me encaminhou, **para** não ter de ligar
para o paciente.

```gherkin
Cenário: Responder na conversa
  Dado a dúvida aberta da Ana (sem selo de quem desativou a IA Nutri) e a conversa com ela liberada
  Quando abro a dúvida e toco em "Responder na conversa"
  Então abro "/painel/mensagens/{id da Ana}?duvida={id}" com a faixa "Respondendo à dúvida de 15/11/2026", o link "Ver a pergunta" (abre em nova aba), a dica "Para o prontuário, retome na resposta o que o paciente perguntou." e "Cancelar resposta"
  Quando escrevo e toco em "Enviar"
  Então a mensagem sai com "Resposta à dúvida enviada pela IA Nutri em 15/11/2026"
  E a dúvida sai da fila na mesma transação (resolucao = 'respondida', resolvida_por = minha usuária)
  E vejo "Resposta enviada. A dúvida saiu da fila." junto ao campo (`?ok=respondida`, região viva)
  E a Ana vê na IA Nutri "Sua nutricionista respondeu em Mensagens." com o link "Abrir Mensagens"
  E recebe o push de mensagem (não o de "duvida_vista")

Cenário: Conversa não liberada
  Então, na dúvida, vejo "Para responder por mensagem, libere a conversa com Ana Souza." com o link para a conversa

Cenário: Dúvida tratada no meio
  Dado que outra nutricionista marcou a dúvida como vista enquanto eu escrevia
  Quando toco em "Enviar"
  Então vejo "Esta dúvida já foi tratada." e o texto continua no campo; nada é enviado
```

#### US-448 — Enviar recado a vários pacientes · **M** (PD-91)

```gherkin
Cenário: Recado por etiqueta
  Quando abro "Recados" → "Novo recado", escolho "Pacientes com as etiquetas" e marco "Gestantes" e "Retorno trimestral"
  E escrevo "O consultório estará fechado na sexta, dia 20." e toco em "Revisar"
  Então vejo "Vai para 18 pacientes no app." e "4 pacientes sem acesso ao app não recebem."
  Quando toco em "Enviar recado" (a tela de revisão é a confirmação; "Voltar e editar" volta com o texto e as etiquetas)
  Então vejo "Recado enviado para 18 pacientes."
  E cada um tem o recado na própria conversa, com o rótulo "Recado do consultório · {nome profissional} · {crn}", e um push "Você tem um novo recado."
  E nenhum e-mail sai

Cenário: Ninguém recebe
  Então vejo "Nenhum paciente recebe este recado com esse filtro." e a revisão não oferece "Enviar recado"

Cenário: Histórico
  Então a lista mostra a data, o começo do texto, "Para" ("Todos os pacientes com app" ou "Etiquetas: Gestantes, Retorno trimestral") e "Lido por 7 de 18"

Cenário: Limite diário
  Dado 10 recados enviados hoje
  Então vejo "Você chegou ao limite de 10 recados por dia. Tente de novo amanhã."
```

#### US-449 — Recado por local de atendimento · **S** (PD-91, Fase B, com o Plano 23 na `main`)

```gherkin
Cenário: Recado aos atendidos num local
  Dado os locais "Clínica Centro" e "Videoconferência" (Plano 23)
  Quando escolho "Pacientes atendidos no local" e "Clínica Centro"
  Então o alcance conta os pacientes com consulta em "Clínica Centro" com situação fora de "cancelada" e "solicitada" (RN-436 do Plano 23)
```

#### US-450 — Pausar e retomar a conversa · **S** (PD-90)

```gherkin
Cenário: Pausar
  Quando toco em "Pausar conversa" e confirmo "Pausar a conversa com Ana Souza? O paciente continua vendo as mensagens, mas não envia novas. Combine com o paciente como o acompanhamento continua."
  Então vejo "Conversa pausada." e a Ana não consegue enviar (o banco também recusa)
  Quando toco em "Retomar conversa"
  Então vejo "Conversa retomada." sem pedir o TCLE de novo
```

#### US-451 — Ver as mensagens na ficha · **S** (PD-90)

```gherkin
Cenário: Seção no Início
  Dado a Ana com 2 mensagens não lidas
  Quando abro o Início da ficha da Ana
  Então vejo a seção "Mensagens" com "2 não lidas", os itens "Mensagem do paciente" com a data e "Ver todos" para a conversa
  E nenhum texto de mensagem
  E no "Adicionar", em "Outros", "Enviar mensagem"
```

#### US-452 — Conversa do titular na exportação e no bloqueio · **S**

```gherkin
Cenário: Baixar meus dados
  Quando o paciente pede "Baixar meus dados"
  Então o dados.json tem a seção "mensagens" (data, autor "paciente" ou "nutricionista" com o nome e o CRN gravados, texto, recado sim/não, anexo com nome e tipo)
  E o ZIP tem a pasta "mensagens/" com os anexos prontos

Cenário: Pedido de exclusão atendido
  Quando a nutricionista atende o pedido de exclusão
  Então a conversa fica só para consulta (ninguém envia), os avisos pendentes ficam "ignorada"
  E as mensagens e os anexos ficam guardados com o prontuário até a anonimização (RN-466)
```

---

## 6. Regras de negócio

### 6.1 Regras

| ID | Regra |
|---|---|
| RN-440 | **Acesso.** Só a sessão `nutri` lê a caixa, as conversas do painel e os recados, libera, pausa, envia e configura; as funções conferem `ctx.role === 'nutri'` antes da transação. O paciente só pela sessão com conta (`sessaoDePacienteComConta`). O admin nunca consulta. Nenhuma tabela nova em `PUBLICO_LIBERADO` nem em `SEM_CONTA_PERMITIDOS` Além disso, a política RESTRICTIVE `paciente_com_conta` (FOR ALL nas cinco tabelas `chat_*`: `app_current_role() IS DISTINCT FROM 'paciente' OR app_current_user() IS NOT NULL`) nega no banco a sessão de paciente sem conta (`no-app.ts`, links, WhatsApp), o que também fecha a C-444 no banco (CH-D47). Todo link com efeito de leitura tem `prefetch={false}` (RN-473) |
| RN-441 | **Liberação (TCLE).** A conversa individual só existe depois de "Liberar conversa": `chat_conversas.liberada_em`, `liberada_por` (= `app_current_user()`, conferido pelo gatilho) e `tcle_forma` ∈ `termo_assinado`, `aceite_escrito`, juntos (CHECK; sem a forma verbal, que não deixa o comprovante do art. 9º, parágrafo único, da Res. CFN 760/2023: CH-D3). Só de titular `ativo`, não anonimizado, e com o carimbo do consultório preenchido (RN-475). Diálogo (`<dialog>`, §7): "A conversa por mensagens é atendimento a distância (telenutrição). Antes de liberar, explique ao paciente as possibilidades, os limites e as fragilidades do atendimento por mensagens e que as mensagens ficam guardadas no prontuário, colha a ciência e a concordância dele com o TCLE de telenutrição, envie a ele o comprovante e guarde uma cópia." e o aviso "Antes do primeiro atendimento online, faça o cadastro no e-Nutricionista e colha o TCLE de telenutrição, guardando o comprovante." (o mesmo texto da RN-404 do Plano 23, sem o número da resolução até o DOU ser conferido). Confirmação: "O paciente, ou o responsável legal, deu ciência e concordou com o TCLE de telenutrição, e enviei a ele o comprovante.". Auditoria: o gatilho da linha grava na entidade neutra `chat_conversa` (fora da tela); `liberarConversa` grava `recordAudit({ acao: 'criar', entidade: 'chat_liberacao', patientId })`, que o "Histórico de acessos" mostra como "Liberou a conversa por mensagens" (CH-D39) |
| RN-442 | **Pausa.** `pausada_em`/`pausada_por` (juntos; `pausada_por` = usuária da sessão). Pausada: nem paciente nem nutricionista enviam mensagem individual; recados continuam chegando. "Retomar" anula os dois, sem novo TCLE. A liberação não se desfaz (o histórico fica no `audit_log`). `pausarConversa` trava o paciente (`FOR UPDATE`) antes da conversa, para um envio do paciente concorrente não passar pela foto antiga do EXISTS da política; `pausarConversa` e `retomarConversa` gravam `recordAudit` (`chat_pausa`: "Pausou a conversa por mensagens"; `chat_retomada`: "Retomou a conversa por mensagens"). O diálogo de pausa lembra: "Combine com o paciente como o acompanhamento continua." (760, art. 9º, X) |
| RN-443 | **Quem envia.** Mensagem individual (sem `recado_id`) só com a conversa liberada e não pausada e o titular `ativo` e não anonimizado, nas duas direções (gatilho `chat_mensagens_regras`, BEFORE INSERT, e, para o paciente, também a política `paciente_chat_envio`). `autor` = `nutri` na sessão `nutri` e `paciente` na sessão `paciente`; `autor_user_id` = `app_current_user()`; `criada_em` = `clock_timestamp()` (gatilho). Paciente arquivado, bloqueado ou anonimizado: a conversa fica só para leitura no painel. O `worker` nunca cria mensagem (o gatilho recusa o INSERT dele, 42501). A mensagem `autor = 'nutri'` (individual ou cópia de recado) recebe do gatilho o carimbo `autor_nome`/`autor_crn` (RN-475). O gatilho não recusa o que a RLS já recusa (para a recusa dos testes de isolamento vir da política): com `tenant_id` diferente do da sessão, na sessão de paciente com `patient_id` diferente do da sessão e nos papéis `publico` e `conta`, devolve `NEW` (CH-D38) |
| RN-444 | **Conteúdo.** Texto de 1 a 2.000 caracteres (sem espaços nas pontas) **ou** um anexo, ou os dois (CHECK `chat_mensagens_tem_conteudo`). Texto puro: a tela mostra como texto (sem HTML, sem Markdown); links não viram `<a>` (CH-D34) |
| RN-445 | **Imutável.** Nenhuma mensagem é editada ou apagada: `REVOKE UPDATE, DELETE, TRUNCATE ON chat_mensagens FROM nutri_app_role` com `GRANT UPDATE (anexo_status, anexo_path, anexo_original_path, updated_at)`, e o gatilho `chat_mensagens_regras` (BEFORE UPDATE) só deixa o `worker` mudar essas colunas, nas transições `processando → pronto \| falhou` e `pronto \| falhou → removido`; os caminhos vão a nulo e o `removido` é gravado só dentro de `app_chat_soltar_anexo` (marcador local `app.chat_soltando`; CH-D41). Apagar só pela anonimização (RN-466) |
| RN-446 | **Ordem e cursores.** A conversa ordena por `(criada_em, id)`. A tela carrega as últimas 50 mensagens e "Ver mensagens anteriores" (50 de cada vez, `?antes=<id da mensagem>`); o servidor resolve o cursor no SQL (`(criada_em, id) < (select criada_em, id from chat_mensagens where id = $antes)`), nunca por data vinda do navegador: o `Date` do JS tem milissegundos e `criada_em` tem microssegundos (o mesmo erro do Plano 15, T9; CH-D40) |
| RN-447 | **Travas e limites.** Envio do paciente: trava `patients` (`FOR UPDATE`, a trava das ações do paciente, `PACIENTE_ESCREVE.patients`) → confere limites (30 mensagens na última hora, 200 no dia, 20 fotos no dia, contadas em `chat_mensagens` do próprio paciente; com foto, a conferência é no `antesDaReserva` de `salvarArquivo`, depois da trava) → INSERT → avisos. Envio da nutricionista: com anexo, primeiro a trava do consultório `pg_advisory_xact_lock(hashtext('chat-anexos-tenant'), hashtext(tenantId))` (teto de 100 anexos por dia por consultório sem corrida entre nutricionistas), depois `patients` (`FOR SHARE`) → conversa (`FOR NO KEY UPDATE`: v0.3, basta para serializar com a pausa e não bloqueia o `FOR KEY SHARE` que o INSERT do paciente e o marcador de leitura tomam pela FK) → INSERT → avisos; sem teto de texto. Com anexo, a trava do consultório é o **primeiro comando do `antesDaReserva`**, dentro da transação de `salvarArquivo` (fora dela, a trava sairia no commit de outra transação), e a contagem dos 100 por dia vem depois dela. Liberar trava o paciente `FOR SHARE` antes da conversa (corre com o arquivar); pausar e retomar travam o paciente `FOR UPDATE` antes da conversa. O job `chat-anexo` trava o paciente (`FOR SHARE`) no `antesDaReserva`, antes da trava do tenant da cota e do `registrar` (ordem dono → tenant → `registrar` da regra 9). Ordem global: trava de classe do consultório (advisory, só no começo da transação) → paciente → conversa → mensagem → `ia_nutri_mensagens` → `notifications` (a da DP-10 do Plano 15) |
| RN-448 | **Lida.** Marcador por lado em `chat_leituras` (`consultorio`, `paciente`): abrir a conversa (render do servidor ou "Mostrar novas mensagens") avança `lida_ate` para a `criada_em` da última mensagem mostrada, **lida no SQL a partir do id dela** (`insert … select m.criada_em from chat_mensagens m where m.id = $ultima … on conflict … do update set lida_ate = greatest(chat_leituras.lida_ate, excluded.lida_ate)`), nunca de uma data do JS (CH-D40); nunca volta e nunca passa de `clock_timestamp()` (gatilho; o mesmo relógio de `criada_em`: com `now()`, uma mensagem gravada no meio da transação daria 42501 no render). Não lida (painel) = mensagem do paciente com `criada_em` > `lida_ate` do consultório; (portal) = mensagem da nutricionista ou recado com `criada_em` > `lida_ate` do paciente. "Lida" aparece na última mensagem própria que o outro lado já passou; "Enviada" nas próprias ainda não lidas. A leitura é do consultório, não de cada nutricionista (CH-D19). `lado = 'consultorio'` só na sessão `nutri`; `lado = 'paciente'` só na sessão de paciente com conta (gatilho `chat_leituras_regras`) |
| RN-449 | **Sinal de risco.** No envio do paciente, `detectarRisco(texto)` (Plano 15, sem rede); a mensagem grava `risco` pelo **`textoFixo`** devolvido, não pelo grupo (o grupo junta sintoma agudo e autolesão em `emergencia`): `risco_emergencia` → `emergencia`, `sintoma_agudo` → `sintoma_agudo`, `risco_transtorno` → `transtorno_alimentar` (`RISCO_DO_TEXTO_FIXO`, com teste dos três). O portal mostra, logo abaixo dela, o texto fixo do `risco` gravado (§6.2, "Socorro"), como aviso do app (não é mensagem da nutricionista). A caixa põe no topo, com o selo "Sinal de risco", a conversa com mensagem de risco não lida; abrir a conversa tira o selo da caixa, mesmo antes de a nutricionista agir (na conversa, a mensagem continua com o selo). Falso positivo é aceito. Nada do texto vai a log |
| RN-450 | **Aviso de urgência.** O topo da conversa no app mostra sempre "Este canal não é para urgências. Em caso de urgência, ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo." |
| RN-451 | **Horário de atendimento.** `chat_horarios`: até 3 faixas por dia da semana (0 = domingo … 6 = sábado), `inicio < fim`, sem sobreposição no mesmo dia (conferida no módulo, sob trava da configuração, e por `EXCLUDE` com `int4range` de minutos), no fuso do consultório. Com `chat_configuracoes.horario_ativo`, o app mostra o resumo e, fora das faixas, o aviso de fora do horário. Nunca impede o envio. Sem faixas e com o horário ligado: "Sua nutricionista ainda não definiu o horário de atendimento por mensagens." |
| RN-452 | **Situação ("há novas?").** `GET …/situacao?depois=<id da última mensagem mostrada>` devolve só `{ novas: number, ultimaLida: string \| null }` (contagem das mensagens do outro lado depois da mensagem `depois`, resolvida no SQL por `(criada_em, id)`, e o id da última mensagem própria que o outro lado já leu, para o "Lida"); nunca texto, autor ou anexo; não chama `auditRead`; não avança a leitura. O cliente consulta a cada 15 s com a aba visível (`visibilityState`), passa a 60 s depois de 5 min sem interação e para com a aba escondida ou sem internet. Teste das chaves e teste de que a mensagem já mostrada nunca volta como nova (CH-D40) |
| RN-453 | **Leituras e auditoria.** `conversaNoPainel`, `minhaConversa` e os downloads de anexo chamam `auditRead(tx, { entidade: 'chat', entidadeId: null \| mensagemId, patientId })` na transação da leitura (uma linha por render). A caixa, o contador, a situação, a seção da ficha e a lista de recados **não** chamam: devolvem só nome, data, tipo, contagem e selo (como `filaDeDuvidas` e a lista de pacientes, Plano 05 D10). As escritas em `chat_mensagens` viram `audit_log` pelo gatilho (entidade `chat`); as de `chat_conversas`, pelo gatilho na entidade neutra `chat_conversa`, que `visivelNoHistorico` deixa fora da tela (o recado cria conversas sem liberação, e a pausa é um UPDATE como a liberação de uma conversa que o recado criou: o gatilho não distingue os atos). O ato aparece pelo `recordAudit` do módulo: `chat_liberacao`, `chat_pausa`, `chat_retomada` (CH-D39), com teste do rótulo no Histórico |
| RN-454 | **Anexos da nutricionista.** JPG, PNG, HEIC/HEIF e PDF, pelo conteúdo (`detectarTipo`), até 10 MB. PDF: `salvarArquivo` tipo `chat_anexo` (pronto na hora). Imagem: tipo `chat_anexo_original`, `anexo_status = 'processando'`, job `chat-anexo` → JPEG sem metadados (lado maior 1.600 px, 40 MP no máximo) tipo `chat_anexo`, `pronto`; o original sai por `apagarArquivo`. Falhou → `falhou` e o original sai. `anexo_nome` (até 120 caracteres, só para mostrar: nunca usado em caminho, regra 9) vem do nome do arquivo, sem a pasta. `caminhoDoAnexo` e as rotas de download servem **só** `anexo_path` com `anexo_status = 'pronto'`, nunca `anexo_original_path` (EXIF e GPS). A ajuda do campo lembra que receita, parecer e plano alimentar vão por Documentos, assinados (Res. CFN 760/2023, art. 10, II; P-CH5) |
| RN-455 | **Fotos do paciente.** Só imagem (JPG, PNG, HEIC/HEIF), até 10 MB, pelo mesmo job; `anexo_nome` nulo (a tela mostra "Foto"). PDF recusado pelo conteúdo com "Formato de arquivo não permitido."; a ajuda manda o exame para "Enviar exame" (Plano 12). Política `paciente_arquivo_insert` passa a aceitar `chat_anexo_original`. A gravação é `salvarArquivo` com `antesDaReserva` = trava do paciente e `registrar` = INSERT da mensagem (um só "tudo ou nada"). A política `paciente_chat_envio` amarra o ponteiro: `anexo_original_path` só de um `stored_files` do mesmo tenant e paciente, tipo `chat_anexo_original` (molde de `paciente_envio_arquivo`, 0102: a FK não passa pela RLS). `UNIQUE` em `anexo_path` e em `anexo_original_path` (um caminho em duas linhas travaria o `apagarArquivo` com 23503) |
| RN-456 | **Avisos ao paciente.** Na transação do envio da nutricionista (ou do recado), se o paciente tem conta e não há `notifications` `pendente` **do mesmo tipo** dele (v0.3: agrupado por tipo; um push de recado pendente não segura o aviso de uma mensagem individual, que tem e-mail, e vice-versa): push (`chat_mensagem` ou `recado`) com `agendada_para` = agora, ou as 8h seguintes se for entre 21h e 8h no fuso (`emHorarioSilencioso`/`fimDoSilencio`); e, só para `chat_mensagem`, e-mail com `agendada_para` = push + 30 min, **também adiado para as 8h seguintes se cair entre 21h e 8h** (v0.3: mensagem às 20h45 → push às 20h45, e-mail às 8h do dia seguinte, não às 21h15). No envio, `motivoParaIgnorar` (função pura; v0.3: o dado vem num campo novo de `ContextoEnvio`, carregado por `carregarContexto` só para os tipos do chat) devolve `mensagem_lida` quando **não há** mensagem da equipe (ou recado) do paciente com `criada_em` > `lida_ate` do paciente — compara com as mensagens não lidas, não com o `created_at` da notificação, para a mensagem que chegou depois da leitura e antes do e-mail agrupado não ficar sem aviso —, e `paciente_inativo` como hoje. Sem inscrição de push, a linha de push fica `ignorada` como hoje; o e-mail sai igual. Recado nunca gera e-mail (CH-D16) |
| RN-457 | **Texto dos avisos ao paciente.** Push: título "NutriDebby", corpo "Você tem uma nova mensagem." ou "Você tem um novo recado.", tela `/p/mensagens` (com o `?v=` do consultório, como os outros avisos do portal). E-mail: assunto "Você tem uma nova mensagem", corpo "Olá, {primeiro nome}! Você tem uma nova mensagem de {nutricionista} no app. Para ler, entre no app: {link de /p/mensagens}". Nunca o texto, o nome do anexo, a dúvida ou o recado |
| RN-458 | **Aviso à nutricionista.** Na transação do envio do paciente, com `chat_configuracoes.aviso_email` ligado (padrão), dentro do horário de mensagens (ou sempre, com o horário desligado, salvo entre 21h e 8h) e com `aviso_nutri_em` nulo ou de mais de 2 h: `avisarNutri` com o modelo `aviso_mensagens_nutri` (assunto "Mensagens novas de pacientes", corpo "Você tem mensagens novas de pacientes no NutriDebby. Para ler, entre no painel: {link de /painel/mensagens?filtro=nao-lidas}"), sem nome de paciente nem texto. A sessão de paciente não grava `chat_configuracoes` (`paciente_sem_update`): a janela de 2 h é conferida e marcada por `app_chat_aviso_nutri_devido(p_no_horario boolean)` (§9.7), que cria a linha da configuração quando ela não existe (`INSERT … ON CONFLICT DO NOTHING`, depois da troca de papel do molde 0083: sem isso o padrão `aviso_email = true` nunca valeria), trava a linha (depois das travas do paciente), confere `aviso_email` e a janela, grava `aviso_nutri_em` e devolve se o e-mail é devido. Sem e-mail fora disso: o contador do menu mostra |
| RN-459 | **Contador do menu.** "Mensagens ({n})" com n = conversas com mensagem do paciente não lida + `contadorDeDuvidas`. Uma consulta agregada por render do layout (molde do contador de dúvidas) e, como o layout não refaz na navegação pelo cliente (`src/app/painel/layout.tsx:30`), uma consulta leve a `GET /api/painel/mensagens/contador` a cada 60 s com a aba visível, que só troca o texto do item (sem região viva no menu, sem `auditRead`, `Cache-Control: no-store`) (CH-D43) |
| RN-460 | **Dúvida pela conversa.** "Responder na conversa" aparece em `abrirDuvida` para dúvida aberta (`resolvida_em` nula) sem selo `risco_revogado`/`aviso_minimo`. `responderDuvidaPelaConversa`: trava paciente → conversa (liberada, não pausada, titular ativo) → `ia_nutri_mensagens` (`FOR UPDATE`, reconfere aberta) → INSERT da mensagem com `duvida_em` = `created_at` da dúvida → UPDATE da dúvida `resolucao = 'respondida'`, `resolvida_em`, `resolvida_por` = usuária da sessão, `aberta_pela_nutri_em` = `coalesce(…, now())` → `avisarPaciente`. Sem `duvida_vista`. Dúvida já resolvida → "Esta dúvida já foi tratada." e nada é gravado. A mensagem **não** copia o texto da dúvida (CH-D13). A faixa "Respondendo à dúvida de {data}" tem o link "Ver a pergunta" (abre `/painel/duvidas/{id}` em nova aba, com o aviso "abre em nova aba"; a abertura da dúvida chama `auditRead` como hoje) e a dica "Para o prontuário, retome na resposta o que o paciente perguntou." (Res. CFN 594/2017, art. 3º, I e III) |
| RN-461 | **Dúvida respondida no app.** `situacaoDaDuvida` ganha `respondida`; a ficha (aba IA Nutri) mostra "Respondida em Mensagens"; o paciente vê em `/p/plano/ia`, sob a dúvida, "Sua nutricionista respondeu em Mensagens." com o link "Abrir Mensagens". O CHECK `ia_nutri_mensagens_resolucao` passa a aceitar `respondida`; o gatilho `ia_nutri_mensagens_regras` não muda (a equipe já só grava a resolução em nome da própria usuária). Também ganham `respondida`: `SITUACAO_DA_DUVIDA` da exportação (`src/modules/ia/nutri-paciente/lgpd.ts:155`), `situacaoDaDuvida` (`duvidas.ts:54`) e a situação na conversa do paciente (`conversa.ts:248`) |
| RN-462 | **Recado.** Texto de 1 a 1.000 caracteres, sem anexo; filtro `todos` (pacientes `ativo`, não anonimizados, com conta), `etiquetas` (1 a 10 etiquetas, **qualquer** delas) ou `local` (Fase B, RN-436 do Plano 23). Gravado em `recados` (com `filtro` jsonb, `destinatarios` e `criado_por`) e, na mesma transação, uma mensagem `autor = 'nutri'` com `recado_id` na conversa de cada destinatário (a conversa é criada sem liberação quando não existe), mais o aviso `recado` (RN-456). Até 500 destinatários por recado ("Este recado passa de 500 pacientes. Use etiquetas para dividir."), 10 recados por dia por consultório (no fuso). Imutável: `REVOKE UPDATE, DELETE, TRUNCATE`. Trava do consultório (`pg_advisory_xact_lock` da classe `recados-tenant`) para o teto diário; depois os pacientes em ordem de `id` (`FOR SHARE`), para não cruzar com envios individuais. O gatilho `chat_mensagens_regras` exige também na cópia do recado o titular `ativo` e não anonimizado; o gatilho `recados_regras` grava `criado_por = app_current_user()`, `criado_em` e o carimbo (`autor_nome`, `autor_crn`, RN-475); sem carimbo, o recado não sai |
| RN-463 | **Ao paciente, o recado** aparece na conversa com o rótulo "Recado do consultório · {autor_nome} · {autor_crn}"; sem a conversa liberada, a conversa é só leitura (US-443). Na caixa do painel, a conversa que só tem recados (não liberada e sem mensagem individual) **não aparece** em "Conversas" nem em "Não lidas": o recado se acompanha em "Recados" ("Lido por…"), e um recado a 300 pacientes não empurra as conversas reais (CH-D42). Na conversa liberada, o recado é mais uma mensagem, com o tipo "Recado" |
| RN-464 | **Alcance.** "Revisar" mostra "Vai para {n} pacientes no app." (no singular, "Vai para 1 paciente no app.") e, quando houver, "{m} pacientes sem acesso ao app não recebem." ("1 paciente sem acesso ao app não recebe.") (pacientes ativos do filtro sem conta). O envio recalcula sob a trava; se mudou, envia para o novo conjunto e a mensagem de sucesso diz o número real. "Lido por {l} de {n}" = destinatários com `lida_ate` do paciente ≥ `criada_em` da cópia |
| RN-465 | **Titular inativo e exclusão.** Arquivado: conversa só leitura, sem recados novos. Pedido de exclusão atendido (`bloqueado`): só leitura no painel; o portal já não abre; `notifications` pendentes de `chat_mensagem`/`recado` → `ignorada` (`paciente_inativo`, como hoje); nada apagado (prontuário, CH-D2). Desarquivar devolve a conversa como estava |
| RN-466 | **Anonimização.** Só na anonimização do titular (job atual, contexto `worker`): `apagarConversaDoTitular` trava o paciente `FOR UPDATE` e marca como `falhou` a mensagem ainda em `processando`, apaga cada anexo por `apagarArquivo` — **v0.3: primeiro todos os `anexo_original_path`, depois os `anexo_path`** (a mensagem `pronto` com o original ainda preso existe por desenho, entre as duas transações do job; soltar o `anexo_path` antes daria 23514 no CHECK `removido ⇒ sem caminhos` e o titular nunca seria anonimizado) — (o `naMesmaTransacao` chama `app_chat_soltar_anexo`, que anula o ponteiro e, para `anexo_path`, grava `anexo_status = 'removido'`: sem esse estado, o CHECK "pronto ⇒ caminho" recusaria a anulação e a anonimização nunca terminaria; CH-D41), depois chama `app_chat_apagar_do_titular(p_patient)` (§9.7), que apaga mensagens, leituras e a conversa. As cópias de recado saem com a conversa; a linha de `recados` fica (sem paciente). A função só aceita titular `bloqueado` com `anonimizar_apos` vencido (a regra de `anonimizarVencidos`) e trava o paciente `FOR UPDATE`: o `bloqueado` sozinho não basta, porque dura todo o prazo de guarda e o papel `worker` também roda no processo web (`agendamento-publico.ts`, `portal/acesso.ts`, `link-documento.ts`, `whatsapp/webhook.ts`). **Rede de limpeza:** a imagem anterior ao Plano 25 anonimiza sem conhecer o chat; por isso `apagarConversasDosAnonimizados` roda no início de cada tenant em `anonimizarVencidos` (molde `apagarCadastrosDosAnonimizados`, Plano 18) e limpa a conversa de quem já tem `anonimizado_em` (a função aceita esse caso), e a transação final da anonimização reconfere que não sobrou anexo de chat (`anexosDeChatRestantes`, como `anexosDoPaciente` e `pdfsDeDocumentosRestantes`) |
| RN-467 | **Exportação do titular.** `dados.json` ganha a seção `mensagens`: `[{ criadaEm, autor: 'paciente' \| 'nutricionista', autorNome?, autorCrn?, texto, recado: boolean, respostaADuvidaDe?: data, risco?: rótulo, anexo?: { nome, tipo, arquivo } }]` (`autorNome`/`autorCrn` só nas mensagens da nutricionista; v0.4, revisão CFN da T5: `risco` pelo rótulo gravado em `ROTULO_RISCO_EXPORTACAO`, "Sinal de risco detectado automaticamente pelo app ({emergência \| sintoma agudo \| alimentação})") e a seção `conversa` (`liberadaEm`, `formaDoTcle`, `liberadaPor`, `pausadaEm`, `pausadaPor`; v0.4, CH-D74 e revisão CFN da T5: `liberadaPor`/`pausadaPor` = `{ nome, crn, profissao: 'Nutricionista' }`, o carimbo gravado na linha da conversa, Res. CFN 594/2017, art. 8º, II), nos **dois** escopos (`titular` e `equipe`, `montarDados`). O ZIP leva os anexos `pronto` em `mensagens/` com nome gerado (`<data>-<id curto>.<ext>`; nunca o `anexo_nome`). Leitura pelo worker, incluída explicitamente |
| RN-468 | **Ficha.** Seção "Mensagens" do Início (§4.4), sem texto e sem `auditRead` |
| RN-469 | **Fora da IA.** Nada de `chat_*` ou `recados` entra em contexto de IA: guarda de importação e de texto em `src/modules/ia/**` (não importa `src/modules/mensagens` nem cita `chat_mensagens`); `campos-enviados.test.ts` continua verde. `src/modules/mensagens` importa de `src/modules/ia` **só** `nutri-paciente/sinais-risco.ts` e `nutri-paciente/duvidas.ts` (guarda de grafo) |
| RN-470 | **Nada em log.** Nenhum `logger.*` ou Sentry em `src/modules/mensagens`, nas rotas e no job recebe texto, `anexo_nome`, recado ou caminho; erros só com `nomeDoErro` e ids. Teste de grep |
| RN-471 | **Autor visto (identificação profissional).** Toda mensagem e todo recado da nutricionista mostram o carimbo gravado na própria linha (RN-475). Painel: "Você" quando `autor_user_id` é a usuária da sessão, senão "{autor_nome}", e, sob cada bloco da equipe, "{autor_nome} · Nutricionista · {autor_crn}"; o paciente aparece como "{primeiro nome do paciente}". Portal: "Você"; mensagem da nutricionista com "{autor_nome} · Nutricionista · {autor_crn}" no bloco; recado com "Recado do consultório · {autor_nome} · {autor_crn}". Cabeçalho do portal: "Conversa com {nome profissional}, nutricionista, {crn}" e os contatos do perfil (`contato_email`, `contato_telefone_e164`), quando houver (Res. CFN 760/2023, arts. 9º, V, e 10, I). O nome no cabeçalho do painel é o de registro do paciente (Plano 18 D7). Nada lê a tabela `user` (CH-D20) |
| RN-472 | **Configuração.** `chat_configuracoes` (uma linha por consultório): `horario_ativo` (padrão falso), `aviso_email` (padrão verdadeiro), `aviso_nutri_em`. A linha nasce na primeira gravação da tela **ou** na primeira chamada de `app_chat_aviso_nutri_devido` (RN-458); a tela sem linha mostra os padrões. Só a sessão `nutri` grava pela tela (padrão `paciente_sem_*`); a sessão de paciente lê `horario_ativo` e `chat_horarios` (sem `aviso_*`: projeção no módulo, teste das chaves). Com `horario_ativo` desligado e faixas gravadas, o paciente não vê horário nem aviso de fora do horário; as faixas ficam guardadas |
| RN-473 | **Sem internet, sem cache e sem prefetch.** `/p/mensagens` nunca entra no cache do service worker (`src/app/sw.ts`: nenhuma conversa guardada no aparelho). Hoje toda navegação do portal sem rede cai em `planoGuardado()` (`sw.ts:167`): a rota da conversa ganha tratamento próprio, e, sem conexão, o componente cliente mostra "Sem conexão. Escreva quando voltar." na região `role="status"` sempre montada (molde `plano/ia/conversa.tsx`), com o campo e os botões desabilitados e o texto preservado. Na cópia guardada de `/p/plano` (e em toda página guardada), o link "Mensagens" da faixa sai sem contador. Todo link com efeito de leitura (abrir a conversa grava `auditRead` e avança o "lido") tem `prefetch={false}`: os da caixa, o da faixa, os da ficha ("Ver todos", "Enviar mensagem"), o "Abrir Mensagens" de `/p/plano/ia` e o "Responder na conversa"; teste de que nenhum desses `Link` faz prefetch (CH-D46) |
| RN-474 | **Varredura do chat** (`src/modules/mensagens/varredura.ts`, só worker, job agendado `expirar-chat-anexo` de 15 em 15 min, como `expirar-exame-envio` e `expirar-diario-foto`; molde `exames-enviados-varredura.ts`): mensagem presa em `processando` há mais de 1 h → `falhou` e o original sai; original que sobrou numa mensagem `pronto` ou `falhou` (job caído entre as transações) → `apagarArquivo`; arquivo `chat_anexo`/`chat_anexo_original` sem mensagem que aponte para ele e com mais de 1 h → `apagarArquivo`. Uma transação por item; erro registrado só com código e motivo técnico (RN-470) |
| RN-475 | **Carimbo da nutricionista (identificação profissional).** `chat_mensagens` e `recados` ganham `autor_nome` e `autor_crn`, NOT NULL quando `autor = 'nutri'` (CHECK) e nulos na mensagem do paciente, gravados pelo gatilho a partir de `tenants.nome_profissional` e `tenants.crn` na hora do envio (molde do carimbo do documento: `document_verifications.emissor_nome`/`emissor_crn`, Plano 10A), sem ler a tabela `user`. Hoje um consultório = uma nutricionista (B-01 da spec de documentos assinados; `criarContaNutri` cria o tenant e a única conta `nutri`): o carimbo do consultório identifica quem escreveu. Se um dia houver mais de uma nutricionista por consultório, o carimbo passa a ser por usuária, como o perfil dos documentos (B-01). Sem nome profissional ou sem CRN: liberar a conversa, pausar (v0.4, CH-D74/CH-D75: a pausa também grava o carimbo), enviar mensagem e enviar recado mostram "Para liberar a conversa, preencha seu nome e seu CRN em Configurações." / "Para pausar a conversa, preencha seu nome e seu CRN em Configurações." / "Para enviar, preencha seu nome e seu CRN em Configurações." com o link para o Perfil, e o gatilho recusa (42501) (Res. CFN 594/2017, art. 8º; 599/2018, art. 21; 760/2023, arts. 9º, V, e 10, I; CH-D37) |

### 6.2 Textos de interface

Textos próprios, não do Dietbox. Constantes em `src/modules/mensagens/constantes.ts` (`MSG_MENSAGENS`, `MSG_RECADOS`,
`MSG_PORTAL_MENSAGENS`); entram na tabela "Textos de interface" das histórias no fechamento.

| Chave | Texto |
|---|---|
| Menu e abas | "Mensagens" · "Mensagens ({n})" · abas "Conversas" / "Conversas ({n})" · "Dúvidas da IA Nutri" / "Dúvidas da IA Nutri ({n})" · "Recados" · `aria-label` do item com contador: "Mensagens, {n} não lidas" / "Mensagens, 1 não lida" |
| Caixa | h1 "Mensagens" · filtros "Todas" · "Não lidas" · "Buscar paciente" · "Buscar" · "Nova conversa" · tipos "Mensagem do paciente" · "Você enviou" · "Imagem" · "Arquivo PDF" · "Recado" · "{n} não lidas" / "1 não lida" · selo "Sinal de risco" · quando: "agora" · "há {n} min" · "há {n} h" · "ontem" · "{dd/mm}" · "{dd/mm/aaaa}" · vazio "Nenhuma conversa ainda. Para começar, toque em "Nova conversa" ou abra a ficha do paciente." · vazio do filtro "Nenhuma mensagem não lida." |
| Nova conversa | h1 "Nova conversa" · "Buscar paciente" · "Buscar" · "Nenhum paciente encontrado." · cada linha "{nome}" + "Sem acesso ao app" quando for o caso |
| Conversa (painel) | h1 "{nome}" · "Abrir ficha" · "Ver mensagens anteriores" · separadores "Hoje" · "Ontem" · "{dd/mm/aaaa}" · autores RN-471 · hora "{hh:mm}" em cada mensagem (`<time datetime>`) · carimbo "{autor_nome} · Nutricionista · {autor_crn}" · "Enviada" · "Lida" · "Recado" · "Resposta à dúvida enviada pela IA Nutri em {dd/mm/aaaa}" · selo "Sinal de risco" · "Mensagem" (rótulo do campo) · "Anexar arquivo" · ajuda "Imagem (JPG, PNG ou HEIC) ou PDF, até 10 MB. Receita, parecer e plano alimentar vão por Documentos, assinados, não por aqui." · "Remover anexo" · "Enviar" · "Enviando…" · "Nova mensagem de {primeiro nome}." (aria-live) · "Mostrar novas mensagens" · "Abrir" (anexo) · "Arquivo PDF · {nome} · {tamanho}" · "Imagem em processamento…" · "Não foi possível processar a imagem." |
| Conversa: erros | "Escreva a mensagem ou anexe um arquivo." · "A mensagem tem até 2.000 caracteres." · "Formato de arquivo não permitido." · "O arquivo passa de 10 MB." · "Espaço de armazenamento esgotado. Fale com o suporte." · "Você chegou ao limite de anexos de hoje. Tente de novo amanhã." · "A conversa foi pausada ou não está liberada. Recarregue a página para ver a situação." · "Para enviar, preencha seu nome e seu CRN em Configurações." · "Não foi possível enviar. Tente de novo." |
| Conversa: estados | "A conversa com {nome} ainda não foi liberada." · "{nome} ainda não tem acesso ao app. As mensagens ficam guardadas e aparecem quando o acesso for ativado; até lá, o paciente não recebe aviso." · "Paciente arquivado: a conversa fica só para consulta." · "Pedido de exclusão atendido: a conversa fica só para consulta." · selo "Conversa pausada" · "Liberada em {dd/mm/aaaa} ({forma})" com forma "termo assinado" · "aceite por escrito" · v0.3: titular anonimizado (a conversa saiu na anonimização) "Paciente anonimizado: a conversa foi apagada junto com os dados do paciente." · id de paciente inexistente ou de outro consultório na URL → a página "não encontrado" do painel (`notFound()`, como a ficha) |
| Conversa: `?erro=` do upload sem JS (v0.3) | códigos fechados, cada um com o texto de "Conversa: erros" junto ao campo de anexo: `formato` → "Formato de arquivo não permitido." · `tamanho` → "O arquivo passa de 10 MB." · `cota` → "Espaço de armazenamento esgotado. Fale com o suporte." · `limite` → "Você chegou ao limite de anexos de hoje. Tente de novo amanhã." · `conversa` → "A conversa foi pausada ou não está liberada. Recarregue a página para ver a situação." · `carimbo` → "Para enviar, preencha seu nome e seu CRN em Configurações." · `falha` → "Não foi possível enviar. Tente de novo."; código fora da lista não mostra nada |
| Liberação | "Liberar conversa" · título "Liberar a conversa com {nome}?" · texto e aviso da RN-441 · "Como o paciente (ou o responsável legal) concordou?" (opção inicial "Escolha" · "Termo assinado (em papel ou digital)" · "Aceite por escrito (mensagem ou e-mail)") · "O paciente, ou o responsável legal, deu ciência e concordou com o TCLE de telenutrição, e enviei a ele o comprovante." · "Liberar" · "Cancelar" · erro "Escolha como o paciente concordou e marque a confirmação." · "Conversa liberada." · sem carimbo: "Para liberar a conversa, preencha seu nome e seu CRN em Configurações." · v0.4 (CH-D75): erro inesperado "Não foi possível liberar a conversa. Tente de novo." |
| Pausa | "Pausar conversa" · "Pausar a conversa com {nome}? O paciente continua vendo as mensagens, mas não envia novas. Combine com o paciente como o acompanhamento continua." · "Pausar" · "Cancelar" · "Conversa pausada." · "Retomar conversa" · "Conversa retomada." · v0.4 (CH-D75): sem carimbo "Para pausar a conversa, preencha seu nome e seu CRN em Configurações." (com o link ao Perfil) · erros inesperados "Não foi possível pausar a conversa. Tente de novo." e "Não foi possível retomar a conversa. Tente de novo." (`?erro=retomar`, código fechado, na região viva) |
| Dúvida (painel) | h1, aba e "Voltar para Dúvidas da IA Nutri" com um nome só: "Dúvidas da IA Nutri" (CH-D45) · "Responder na conversa" · "Para responder por mensagem, libere a conversa com {nome}." · faixa "Respondendo à dúvida de {dd/mm/aaaa}" · "Ver a pergunta" (abre em nova aba) · dica "Para o prontuário, retome na resposta o que o paciente perguntou." · "Cancelar resposta" · "Resposta enviada. A dúvida saiu da fila." · "Esta dúvida já foi tratada." · v0.3: `?duvida=` de dúvida que já não existe (saiu pelos 180 dias da IA Nutri) ou de outro paciente: sem faixa, com "Esta dúvida não está mais disponível."; na mensagem antiga, "Resposta à dúvida enviada pela IA Nutri em {dd/mm/aaaa}" fica sem link ("Ver a pergunta" só existe na faixa, enquanto a dúvida existe) · ficha: "Respondida em Mensagens" |
| Recados | h1 "Recados" · "Novo recado" · colunas "Data", "Recado", "Para", "Lido por" · "Lido por {l} de {n}" · "Todos os pacientes com app" · "Etiquetas: {lista}" · "Local: {nome}" · vazio "Nenhum recado enviado." · tabela com `<caption>` "Recados enviados" e cabeçalhos `scope="col"` · "Mostrar mais" |
| Novo recado | h1 "Novo recado" · "Para quem" ("Todos os pacientes com app", "Pacientes com as etiquetas", "Pacientes atendidos no local") · "Etiquetas" · "Local" · "Recado" · ajuda "Use para avisos do consultório (horários, feriados, mudanças). O mesmo texto vai para todos, no app. Não escreva dado de saúde, nome de paciente nem orientação de dieta, e nada de preço, desconto, promoção, sorteio ou marca de produto." · "{n}/1.000" · "Revisar" · "Vai para {n} pacientes no app." / "Vai para 1 paciente no app." · "{m} pacientes sem acesso ao app não recebem." / "1 paciente sem acesso ao app não recebe." · "Depois de enviado, o recado não pode ser apagado." · "Enviar recado" (a revisão é a confirmação) · "Voltar e editar" · "Recado enviado para {n} pacientes." / "Recado enviado para 1 paciente." · erros "Escreva o recado." · "O recado tem até 1.000 caracteres." · "Escolha pelo menos uma etiqueta." · "Escolha no máximo 10 etiquetas." · "Nenhum paciente recebe este recado com esse filtro." · "Este recado passa de 500 pacientes. Use etiquetas para dividir." · "Você chegou ao limite de 10 recados por dia. Tente de novo amanhã." · "Para enviar, preencha seu nome e seu CRN em Configurações." |
| Configuração | hub: "Atendimento por mensagens" · "Horário das mensagens e avisos por e-mail." · h1 "Atendimento por mensagens" · "Mostrar horário de atendimento aos pacientes" · dias "Domingo" … "Sábado" · "Das" · "Às" (`<select>` de 15 em 15 min, com "24:00" no fim; nome acessível "{dia}, faixa {k}, das" / "… às") · "Acrescentar faixa" · "Remover faixa" (nome acessível "Remover faixa {k} de {dia}") · "Avisar por e-mail quando chegar mensagem de paciente" · ajuda "No máximo um e-mail a cada 2 horas, sem nome de paciente nem o texto. Fora do horário de mensagens, não avisamos." · "Salvar" · "Configuração salva." · erros "O fim tem de ser depois do início." · "As faixas do mesmo dia não podem se sobrepor." · "No máximo 3 faixas por dia." · v0.4 (CH-D76): erro inesperado ou rede caída "Não foi possível salvar. Tente de novo." (a configuração escolhida volta para a tela) |
| Ficha | seção "Mensagens" · total "{n} não lidas" / "1 não lida" · itens "Mensagem do paciente" · "Mensagem enviada" · "Recado" · situação "Sinal de risco" · Adicionar "Enviar mensagem" |
| Portal: entrada | faixa "Mensagens" · "Mensagens ({n})" · `aria-label` "Mensagens, {n} não lidas" / "Mensagens, 1 não lida" |
| Portal: conversa | h1 "Mensagens" · "Conversa com {nome profissional}, nutricionista, {crn}" e os contatos do perfil · aviso RN-450 · "Horário de atendimento por mensagens: {resumo}." · "Agora é fora do horário de atendimento por mensagens. Sua mensagem fica guardada e será lida quando sua nutricionista voltar ao atendimento por mensagens." · "Sua nutricionista ainda não definiu o horário de atendimento por mensagens." · "Escreva sua mensagem" · "Enviar" · "Enviar foto" · ajuda "Foto (JPG, PNG ou HEIC), até 10 MB. Para enviar um exame em PDF, use Exames." (sem "Exames" visível: "…, fale com o consultório.") · "Remover foto" · autores RN-471 · "Enviada" · "Lida" · "Foto" · "Enviando foto…" · "Não foi possível processar a foto. Tente outra." · "Nova mensagem da sua nutricionista." (aria-live) · "Mostrar novas mensagens" · "Ver mensagens anteriores" · vazio "Nenhuma mensagem ainda. Escreva para sua nutricionista quando precisar." · "Por enquanto, sua nutricionista só envia recados por aqui. Para falar com o consultório, use os canais de sempre." · "A conversa por mensagens está pausada pelo consultório. Para falar com sua nutricionista, use os canais de sempre." · erros "Escreva a mensagem ou escolha uma foto." · "A mensagem tem até 2.000 caracteres." · "Você enviou muitas mensagens seguidas. Espere alguns minutos e tente de novo." · "Você chegou ao limite de fotos de hoje. Tente de novo amanhã." · "Formato de arquivo não permitido." · "O arquivo passa de 10 MB." · v0.3: "Não foi possível enviar a foto agora. Fale com o consultório." (cota do consultório esgotada) · "Não foi possível enviar. Tente de novo." · `?erro=` sem JS com os códigos `formato`, `tamanho`, `cota`, `limite` (fotos do dia), `muitas` (30/h ou 200/dia), `conversa` (o texto da pausa) e `falha`, cada um com o texto desta linha; código fora da lista não mostra nada · "Não foi possível enviar. Tente de novo." · pausada no envio: "A conversa por mensagens está pausada. Use os canais de sempre." · sem internet: "Sem conexão. Escreva quando voltar." · carimbo da nutricionista no bloco (RN-471) |
| Portal: socorro (RN-449) | emergência: "Se você está pensando em se machucar ou corre perigo agora, ligue para o CVV no 188 (gratuito, 24 horas; também há chat em cvv.org.br) ou para o SAMU no 192, ou vá ao pronto-socorro mais próximo. Sua nutricionista não acompanha as mensagens em tempo real." · sintoma agudo: "Esses sinais precisam de atendimento médico agora. Ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo. Sua nutricionista não acompanha as mensagens em tempo real." · transtorno: "Que bom que você contou. Sua mensagem foi enviada à sua nutricionista, que não acompanha as mensagens em tempo real. Se você sentir que está em perigo, ligue para o CVV no 188 (gratuito, 24 horas) ou para o SAMU no 192." |
| Portal: IA Nutri | "Sua nutricionista respondeu em Mensagens." · "Abrir Mensagens" |
| Portal: ajuda (v0.3) | item novo em "Perguntas comuns" do guia `portal-novidades`: "Posso usar as Mensagens numa urgência?" — "Não. Em caso de urgência, ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo. Sua nutricionista lê as mensagens no horário de atendimento por mensagens, não em tempo real, e a conversa fica guardada no seu prontuário." |
| Push | título "NutriDebby" · "Você tem uma nova mensagem." · "Você tem um novo recado." |
| E-mails | ao paciente: RN-457 · à nutricionista: RN-458 |
| `ROTULO_TIPO` e motivo | "Mensagem no app" · "Recado" · motivo `mensagem_lida`: "mensagem já lida" |
| `ENTIDADE_ROTULO` e Histórico | `chat`: "Mensagens (conversa com o paciente)" · `chat_conversa`: "Mensagens — conversa" (fora da tela, `visivelNoHistorico`) · `chat_liberacao`: "Liberou a conversa por mensagens" · `chat_pausa`: "Pausou a conversa por mensagens" · `chat_retomada`: "Retomou a conversa por mensagens" (rótulo da ação em `acaoDoItem`, molde de "Desativou a IA Nutri") |

Os textos do manual guiado (guia `mensagens` do painel e o do portal) ficam em rascunho até o `revisor-interface` e a
Debby; cada rótulo citado entre aspas precisa existir num `.tsx` ou em `src/modules/mensagens`, que entra em `TSX_FORA` de `src/modules/ajuda/conteudo.test.ts`.

---

## 7. Telas

1. **Caixa (`/painel/mensagens`).** Abas no topo; abaixo, formulário GET com o filtro (dois links-pílula "Todas"/"Não
   lidas", `aria-current`) e a busca. Lista (`<ul>`), cada item um link de bloco `min-h-11`: nome em negrito quando há
   não lidas, o tipo e o "quando" em texto suave, "{n} não lidas" como selo com texto (não só cor), "Sinal de risco" em
   selo de alerta com ícone e texto. Ordem: risco não lido primeiro, depois a mais recente. Paginação de 50 ("Mostrar
   mais"). No celular, a mesma lista em coluna única. Só conversas liberadas ou com mensagem individual (CH-D42).
   O selo "Sinal de risco" usa a variante nova `alerta` de `ui/selo.tsx` (tokens `border-erro bg-erro-fundo text-erro`, ícone
   `aria-hidden`, nunca cor literal). Os dois `<nav>` têm `aria-label` próprios; "Mostrar mais" é link `?pagina=`; o
   `<title>` é sempre "Mensagens", nunca com o nome do paciente. Os links da lista têm `prefetch={false}`.
2. **Conversa (painel).** Cabeçalho com o nome, "Abrir ficha", o estado (liberada em…, pausada) e o menu "Pausar
   conversa"/"Retomar conversa". Corpo com as mensagens (as do paciente à esquerda, as da equipe à direita, com o autor
   escrito em cada bloco de mensagens seguidas; o recado com borda e o rótulo "Recado"), `role="log"` não, e sim uma
   lista com `aria-label="Mensagens"`; "Ver mensagens anteriores" no topo. Rodapé fixo com o campo (`textarea`, Enter
   quebra linha; "Enviar" é botão, sem atalho que envie sozinho), "Anexar arquivo" (input `file` com `accept`), a prévia
   do anexo com "Remover anexo" e "Enviar". O envio é Server Action com o mesmo formulário sem JS (o upload sem JS vai
   pela rota `POST`); depois de enviar, o foco volta ao campo e a lista rola até a mensagem nova. A região "Nova
   mensagem de {nome}." é `aria-live="polite"` e não move o foco. Com `?duvida=`, a faixa "Respondendo à dúvida de
   {data}" fica acima do campo.
   **v0.2:** cada mensagem mostra a hora (`<time datetime>`, "14:32" no fuso; o dia no separador); "Enviada" nas próprias
   ainda não lidas e "Lida" na última própria já lida. A região viva fica **sempre montada**, vazia, junto ao rodapé (não
   no topo), e só o texto muda (molde `selo-offline.tsx`); ela anuncia também os retornos `?ok=` ("Conversa liberada.",
   "Conversa pausada.", "Conversa retomada.", "Resposta enviada. A dúvida saiu da fila.") e "Esta dúvida já foi tratada.";
   com `?ok=`, a tela não rola até a última mensagem e o foco vai para a região (`tabIndex=-1`). "Mostrar novas
   mensagens" leva o foco à primeira mensagem nova. O rodapé é `sticky bottom-0` num contêiner `flex-1` (nunca
   `position: fixed`, que o teclado virtual tampa). Os campos (texto, anexo escolhido) voltam do estado da action
   (`defaultValue`) e só são limpos no sucesso. Liberar e pausar usam `<dialog>` (o `Dialogo` compartilhado de
   `src/components/dialogo.tsx`, Planos 22 e 23, nunca `window.confirm`): Esc fecha e o foco volta ao
   botão; "Liberar" fica habilitado e, sem a forma ou a confirmação, mostra o erro junto ao campo (e o foco vai ao
   primeiro campo inválido; sem carimbo, ao link do Perfil). v0.4 (revisão da T6b): o `Dialogo` não põe o foco no título
   (a API dele não tem isso); o foco inicial é o primeiro campo ("Como o paciente… concordou?") ao liberar e "Cancelar" ao
   pausar; a orientação do TCLE é a descrição do diálogo (`aria-describedby`), lida ao abrir.
3. **Conversa (app, `/p/mensagens`).** Tela de detalhe com "Voltar"; o aviso de urgência fixo no topo (texto, não
   banner que some); o horário, quando ligado; as mensagens com o mesmo desenho do portal G (cartões arredondados,
   texto do tamanho do portal); o socorro (RN-449) em cartão de alerta logo abaixo da mensagem de risco; o rodapé com
   "Escreva sua mensagem", "Enviar foto" (abre câmera ou galeria: `accept="image/*"`) e "Enviar", acima da barra do
   sistema (área segura). Alvos de 44 px.
   **v0.2:** "Enviar foto" com `accept="image/jpeg,image/png,image/heic,image/heif"`; rodapé `sticky bottom-0` com
   `env(safe-area-inset-bottom)`; a 400 px, o campo em cima e "Enviar foto" e "Enviar" embaixo, alvos de 44 px. Na
   `Faixa`, o link "Mensagens (n)" tem `min-h-11` e a linha do consultório quebra (`flex-wrap`, link com `ml-auto`). Sem
   internet: RN-473. Mesma região viva, foco e campos controlados do painel; o cabeçalho com o carimbo (RN-471).
4. **Recados.** Lista em tabela (no celular, cartões) e "Novo recado". O formulário tem dois passos na mesma rota:
   "Revisar" mostra o alcance e o texto como o paciente vai ver, com "Enviar recado" e "Voltar e editar": a revisão é a
   confirmação (sem outro diálogo), e "Voltar e editar" devolve o texto e as etiquetas marcadas (`defaultValue`).
5. **Configuração.** Lista dos 7 dias, cada um num `<fieldset>` com `<legend>` do dia e as faixas ("Das", "Às" em `<select>`
   de 15 em 15 min, com "24:00" no fim: o `input type="time"` não respeita `step` no iOS e não tem 24:00) e
   "Acrescentar faixa"; a chave do horário e a do aviso por e-mail no topo.
6. **Dúvida aberta.** O botão "Responder na conversa" fica ao lado de "Marcar como vista", com o mesmo peso; sem a
   conversa liberada, o texto da US-447 no lugar.

---

## 8. Requisitos não funcionais

| ID | Requisito |
|---|---|
| RNF-440 | **Desempenho:** caixa com 300 conversas e conversa com 500 mensagens com p95 ≤ 800 ms (RNF-01); situação com p95 ≤ 100 ms (índice `(tenant_id, patient_id, criada_em)`); caixa numa consulta agregada (`DISTINCT ON`/janela), nunca uma por paciente |
| RNF-441 | **Carga da consulta de situação:** 15 s com a aba visível, 60 s depois de 5 min parado, nada com a aba escondida; resposta sem corpo além dos dois campos; `Cache-Control: no-store` |
| RNF-442 | **Envio do recado** para 500 pacientes numa transação em menos de 5 s (INSERT em lote de mensagens e de `notifications`; `dispararEnvio` uma vez) |
| RNF-443 | **Acessibilidade (WCAG 2.2 AA):** selos com texto; erro junto ao campo (`aria-describedby`) e o texto digitado nunca se perde; `aria-live="polite"` para mensagem nova sem roubar o foco; foco visível; alvos de 44 px; funciona sem JS para ler e enviar texto; contraste nos dois temas; região viva sempre montada e foco nos retornos (§7) |
| RNF-444 | **Segurança:** texto sempre como texto (React escapa; nenhum `dangerouslySetInnerHTML`); anexos só por `signFileUrl` (5 min) com `Content-Disposition` do serviço de arquivos atual; tipo pelo conteúdo; SVG nunca; limite de corpo nas rotas de upload; CSRF pelas Server Actions e pela verificação de origem das rotas |
| RNF-445 | **Privacidade nos avisos:** nenhum texto nos canais externos (CS-440); push cifrado até o aparelho (como hoje) |
| RNF-446 | **Memória do worker:** o job `chat-anexo` usa os limites do diário (40 MP, um job por vez, `expireInSeconds` 120) |
| RNF-447 | **Guardas no CI:** `rls-guard`, `audit-guard`, `isolamento.test.ts`, grafo de imports (sharp/HEIC só no worker; `mensagens` ↔ `ia`), grep de logs (RN-470) |
| RNF-448 | **Offline e prefetch:** RN-473, com teste do service worker (`/p/mensagens` fora do cache e fora do `planoGuardado()`) e dos `Link` sem prefetch |

---

## 9. Modelo de dados

Uma migration gerada (tabelas, CHECKs ampliados) e uma custom `rls_mensagens` (RLS, políticas, gatilhos, funções,
auditoria, `REVOKE`). Esquema em `src/db/schema/mensagens.ts` (novo) e exportado em `schema/index.ts`.

### 9.1 `chat_conversas` (nova; uma por paciente e consultório)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id`, `patient_id` | uuid NOT NULL | FK composta para `patients (tenant_id, id)`; `UNIQUE (tenant_id, patient_id)` |
| `liberada_em` | timestamptz | RN-441 |
| `liberada_por` | uuid | sem FK (como `audit_log.actor_user_id`) |
| `tcle_forma` | text | `termo_assinado`, `aceite_escrito` (CH-D3) |
| `liberada_nome`, `liberada_crn` | text | **CH-D74:** nome e CRN da nutricionista no momento da liberação, copiados de `tenants.nome_profissional`/`tenants.crn` pelo gatilho (o que vier no comando é sobrescrito; nada lê a tabela `user`, RN-475); nunca mudam depois de gravados |
| `pausada_em`, `pausada_por` | timestamptz, uuid | RN-442 |
| `pausada_nome`, `pausada_crn` | text | **CH-D74:** nome e CRN no momento da pausa (gatilho, de `tenants`); a retomada os anula junto com `pausada_em`/`pausada_por`; fora dessas duas transições, não mudam (42501) |
| `created_at`, `updated_at` | timestamptz | |

CHECKs: `(liberada_em is null) = (liberada_por is null) and (liberada_em is null) = (tcle_forma is null)` e, CH-D74,
`… = (liberada_nome is null) … = (liberada_crn is null)` (`chat_conversas_liberacao`); `tcle_forma in (…)`;
`(pausada_em is null) = (pausada_por is null)` e, CH-D74, `… = (pausada_nome is null) … = (pausada_crn is null)`
(`chat_conversas_pausa`); `pausada_em is null or liberada_em is not null`.

**CH-D74 (decisão da orquestradora, 23/11/2026):** a liberação e a pausa guardam o nome e o CRN da nutricionista como eram
no momento (`liberada_nome`/`liberada_crn`, `pausada_nome`/`pausada_crn`), copiados de `tenants` pelo gatilho
`chat_conversas_regras`, como o carimbo das mensagens: o id (`liberada_por`/`pausada_por`) não guarda a identificação
profissional do ato, e o perfil muda depois. A pausa também exige o carimbo do consultório (42501 sem ele).

RLS (custom): `app_enable_tenant_rls('chat_conversas')`, `app_enable_patient_rls('chat_conversas')`,
`app_enable_audit('chat_conversas', 'chat_conversa')` (entidade neutra, fora da tela; o ato vai pelo `recordAudit` do módulo, CH-D39). Fora de `STAFF_ONLY` (o paciente lê a própria linha, só pela
projeção do módulo: `liberada`, `pausada`); fora de `PACIENTE_ESCREVE` e de `PUBLICO_LIBERADO`. Gatilho
`chat_conversas_regras` (BEFORE INSERT OR UPDATE, `search_path` fixo, 42501): `tenant_id`/`patient_id` fixos; INSERT
pela sessão `nutri` (liberação ou recado); liberação e pausa só pela sessão `nutri`, com `liberada_por`/`pausada_por`
= `app_current_user()`; `liberada_em` não volta a nulo nem muda depois de gravada; liberar só com titular `ativo` e
`anonimizado_em` nulo. `REVOKE DELETE, TRUNCATE ON chat_conversas FROM nutri_app_role` (apagar só por
`app_chat_apagar_do_titular`).

**v0.2:** liberar exige também o carimbo do consultório (`tenants.nome_profissional` e `tenants.crn` não nulos; RN-475).
O gatilho não recusa o que a RLS já recusa (para a recusa dos testes de isolamento vir da política): com `tenant_id`
diferente do da sessão, na sessão de paciente com `patient_id` diferente do da sessão e nos papéis fora de `nutri`,
`paciente` e `worker` que a RLS nega (`publico`, `conta` e, v0.3, `recepcao`, negada por padrão pela RN-505 do Plano 26 — **CH-D71**: sem o 26 na `main`, a `recepcao` fica fora da lista e recebe o 42501 do gatilho),
devolve `NEW` (CH-D38). v0.3: **papel desconhecido** (qualquer outro valor de `app.role`) recebe o 42501 do próprio
gatilho — falha fechada: `app_current_role()` não valida o valor (`drizzle/0000`, `:27-28`) e a `tenant_isolation` não
olha o papel, então devolver `NEW` a um papel que a RLS não conhece deixaria a escrita passar.
**v0.3:** também devolve `NEW` na sessão de paciente, em qualquer comando: a RLS já recusa o paciente em
`chat_conversas` (`paciente_sem_insert`/`paciente_sem_update`, fora de `PACIENTE_ESCREVE`), e o teste D1 do isolamento
roda a fábrica como P2 no próprio paciente, onde nenhum dos casos acima vale (CH-D57 do plano). A FK para `patients` é declarada com `ON DELETE NO
ACTION` explícito. Política RESTRICTIVE `paciente_com_conta` (RN-440, CH-D47).

### 9.2 `chat_mensagens` (nova)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id`, `patient_id` | uuid NOT NULL | FK composta para `chat_conversas (tenant_id, patient_id)` (NO ACTION) |
| `autor` | text NOT NULL | `nutri`, `paciente` |
| `autor_user_id` | uuid NOT NULL | sem FK; = `app_current_user()` (gatilho) |
| `texto` | text | 1–2000 (`char_length(btrim(texto))`), RN-444 |
| `recado_id` | uuid | FK composta `(tenant_id, recado_id)` → `recados (tenant_id, id)` NO ACTION; só com `autor = 'nutri'` |
| `duvida_em` | timestamptz | só com `autor = 'nutri'` e `recado_id` nulo (RN-460) |
| `risco` | text | `emergencia`, `sintoma_agudo`, `transtorno_alimentar`; só com `autor = 'paciente'`; gravado pelo `textoFixo` de `detectarRisco` (RN-449) |
| `anexo_status` | text NOT NULL default `sem_anexo` | `sem_anexo`, `processando`, `pronto`, `falhou`, `removido` (CH-D41) |
| `anexo_path` | text | FK `stored_files (caminho)` NO ACTION; CHECK `like tenant_id::text \|\| '/chat_anexo/%'`; `UNIQUE` |
| `anexo_original_path` | text | FK `stored_files (caminho)` NO ACTION; CHECK `like tenant_id::text \|\| '/chat_anexo_original/%'`; `UNIQUE` |
| `anexo_tipo` | text | `imagem`, `pdf` |
| `anexo_nome` | text | até 120; só com `autor = 'nutri'` |
| `anexo_bytes` | integer | > 0 |
| `autor_nome`, `autor_crn` | text | carimbo do consultório na hora do envio (gatilho, de `tenants`): NOT NULL com `autor = 'nutri'`, nulos com `autor = 'paciente'` (RN-475) |
| `criada_em` | timestamptz NOT NULL | `clock_timestamp()` (gatilho) |
| `updated_at` | timestamptz NOT NULL | |

CHECKs: `chat_mensagens_tem_conteudo` (`texto is not null or anexo_status <> 'sem_anexo'`);
`(anexo_status = 'sem_anexo') = (anexo_tipo is null)`; `anexo_status <> 'pronto' or anexo_path is not null`;
`anexo_status <> 'processando' or anexo_original_path is not null or anexo_tipo = 'pdf'`; `anexo_tipo <> 'pdf' or
autor = 'nutri'`; `recado_id is null or (autor = 'nutri' and anexo_status = 'sem_anexo')`; v0.2: `anexo_status <> 'removido' or (anexo_path is null and anexo_original_path is null)`; `(autor = 'nutri' and autor_nome is not null and autor_crn is not null) or (autor = 'paciente' and autor_nome is null and autor_crn is null)`. Índices:
`(tenant_id, patient_id, criada_em, id)`; parcial `(tenant_id, criada_em) where autor = 'paciente'` (caixa e contador);
`(tenant_id, recado_id) where recado_id is not null`; `(tenant_id, anexo_status) where anexo_status = 'processando'`.

RLS (custom): `app_enable_tenant_rls('chat_mensagens')`, `app_enable_patient_rls('chat_mensagens')`,
`app_enable_audit('chat_mensagens', 'chat')`; `app_allow_paciente_escrita('chat_mensagens', 'insert')` com a política
RESTRICTIVE **`paciente_chat_envio`** FOR INSERT WITH CHECK (`app_current_role() IS DISTINCT FROM 'paciente' OR
(autor = 'paciente' AND autor_user_id = app_current_user() AND recado_id IS NULL AND duvida_em IS NULL AND anexo_path
IS NULL AND anexo_nome IS NULL AND anexo_status IN ('sem_anexo','processando') AND EXISTS (chat_conversas liberada e
não pausada do mesmo tenant e paciente) AND EXISTS (patients ativo, não anonimizado))`. Fora de `STAFF_ONLY` e de
`PUBLICO_LIBERADO`. Gatilho **`chat_mensagens_regras`**: BEFORE INSERT — `criada_em := clock_timestamp()`; `autor`
coerente com o papel (`nutri`/`paciente`; sem papel = migration ou seed, aceito); `autor_user_id = app_current_user()`
nas sessões com ator; mensagem individual exige a conversa liberada e não pausada e o titular ativo (RN-443); com
`duvida_em`, sessão `nutri`. BEFORE UPDATE — colunas fixas (tudo menos `anexo_status`, `anexo_path`,
`anexo_original_path`, `updated_at`); só o `worker` muda o anexo, em `processando → pronto | falhou`; os caminhos podem
ir a nulo pela função `app_chat_soltar_anexo` (marcador local `app.chat_soltando`, molde de `app.ia_nutri_revogando`).
`REVOKE UPDATE, DELETE, TRUNCATE ON chat_mensagens FROM nutri_app_role`, com `GRANT UPDATE (anexo_status, anexo_path,
anexo_original_path, updated_at)` (o job do worker). Sem DELETE fora de `app_chat_apagar_do_titular`.

**v0.2 (painel de revisão):** (a) `paciente_chat_envio` exige também `anexo_original_path IS NULL OR EXISTS (select 1
from stored_files f where f.tenant_id = chat_mensagens.tenant_id and f.patient_id = chat_mensagens.patient_id and
f.tipo = 'chat_anexo_original' and f.caminho = chat_mensagens.anexo_original_path)`; (b) o gatilho de INSERT recusa o
papel `worker` (42501), exige na cópia de recado o titular `ativo` e não anonimizado e grava `autor_nome`/`autor_crn` de
`tenants` quando `autor = 'nutri'` (42501 sem o carimbo); (c) não recusa o que a RLS já recusa (`tenant_id` diferente
do da sessão, sessão de paciente com `patient_id` diferente do da sessão, papéis `publico`, `conta` e `recepcao`
— v0.3: a lista do plano não tinha a `recepcao`; CH-D71: só com o Plano 26 na `main`; papel desconhecido cai no 42501 do gatilho, como na §9.1): devolve `NEW` e
a política recusa (CH-D38); (d) BEFORE UPDATE: `processando → pronto | falhou` pelo `worker`; `pronto | falhou →
removido` e os caminhos a nulo só com `app.chat_soltando` ligado (dentro de `app_chat_soltar_anexo`); (e) política
RESTRICTIVE `paciente_com_conta`. Teste de banco próprio: P2 insere `autor = 'paciente'` com o próprio ator no
`patient_id` de P1 e a recusa vem de `patient_isolation` (o teste genérico do isolamento cai em `paciente_chat_envio`,
porque a fábrica grava `autor = 'nutri'`); o UPDATE do `worker` entre tenants também é teste de banco próprio
(`chat_mensagens` vai para `SO_INSERE` no isolamento: com `REVOKE UPDATE` e `GRANT` só de colunas, o `update … set
tenant_id = tenant_id` dá permissão negada).

**v0.3 (revisão do plano):** (f) caminhos do anexo fixos e amarrados ao paciente para **todos** os papéis, no gatilho
(a política `paciente_chat_envio` cobre só o paciente, e a RN-445 promete o que o gatilho de v0.2 não entregava): no
INSERT e no UPDATE, `anexo_path` exige um `stored_files` do mesmo tenant e paciente com `tipo = 'chat_anexo'`, e
`anexo_original_path` um com `tipo = 'chat_anexo_original'`; no UPDATE, `anexo_path` só vai de nulo a valor na transição
`processando → pronto`, `anexo_original_path` nunca vai de nulo a valor, e os dois só vão de valor a nulo com
`app.chat_soltando` ligado (um `pronto → pronto` do `worker` que troque o caminho por outro `chat_anexo` do tenant é
recusado: sem isso, um erro de mapeamento no job apontaria a mensagem do paciente A para a foto do paciente B, que A
baixaria pelo portal); (g) CHECK novo `chat_mensagens_sem_anexo_sem_caminho`: `anexo_status <> 'sem_anexo' or
(anexo_path is null and anexo_original_path is null)` (sem ele, o paciente gravaria `sem_anexo` apontando um original,
e o arquivo escaparia da varredura); (h) `criada_em` com `default clock_timestamp()` no esquema (o gatilho continua
forçando o valor nas sessões com papel; a migration e a semente sem papel não ficam sem data).

### 9.3 `chat_leituras` (nova; marcador técnico de leitura)

| Coluna | Tipo | Regra |
|---|---|---|
| `tenant_id`, `patient_id` | uuid NOT NULL | FK composta para `chat_conversas` |
| `lado` | text NOT NULL | `consultorio`, `paciente`; PK `(tenant_id, patient_id, lado)` |
| `lida_ate` | timestamptz NOT NULL | RN-448 |
| `updated_at` | timestamptz NOT NULL | |

RLS: `app_enable_tenant_rls`, `app_enable_patient_rls`; **sem gatilho de auditoria**, em `AUDIT_EXCEPTIONS` ("Plano 25
(RN-448): marcador técnico de até onde cada lado leu, como `access_events`; não é prontuário — a leitura do conteúdo é
auditada por `auditRead`"). `app_allow_paciente_escrita('chat_leituras', 'insert', 'update')` com as políticas RESTRICTIVE
**`paciente_leitura_propria_insert`** (FOR INSERT, WITH CHECK `app_current_role() IS DISTINCT FROM 'paciente' OR lado =
'paciente'`) e **`paciente_leitura_propria_update`** (FOR UPDATE, a mesma expressão em USING e WITH CHECK). O SELECT fica
livre dentro do próprio paciente: o portal precisa ler o `lida_ate` do consultório para mostrar "Lida". Gatilho `chat_leituras_regras`: `lado = 'consultorio'` só na sessão `nutri`; `lida_ate` só avança e nunca passa
de `clock_timestamp()`; chaves fixas. `REVOKE DELETE, TRUNCATE`. Gravação: `INSERT … ON CONFLICT (tenant_id, patient_id,
lado) DO UPDATE SET lida_ate = greatest(…)`.

**v0.2:** `lado = 'paciente'` só na sessão de paciente com conta (o `worker` e a equipe não gravam o lado do paciente:
seria um "Lida" falso e um e-mail ignorado como `mensagem_lida`); `lida_ate` vem do SQL a partir do id da mensagem
(RN-448); o gatilho devolve `NEW` nos casos que a RLS já recusa (como na §9.2); FK para `chat_conversas` com `ON DELETE
NO ACTION` explícito; política RESTRICTIVE `paciente_com_conta`.

**v0.3:** o gatilho confere lado × papel **só no INSERT e quando `lida_ate` muda** (o `update … set tenant_id =
tenant_id` da equipe numa linha `lado = 'paciente'` não é escrita do lado do paciente e não pode cair na recusa); a
fábrica do isolamento grava a linha pela sessão de paciente com conta (`lado = 'paciente'`), para a P2 ter a própria
linha no teste de UPDATE (a USING de `paciente_leitura_propria_update` esconde as linhas `consultorio`).

### 9.4 `chat_configuracoes` e `chat_horarios` (novas; sem `patient_id`)

`chat_configuracoes`: `tenant_id` PK (FK `tenants`), `horario_ativo` boolean default false, `aviso_email` boolean
default true, `aviso_nutri_em` timestamptz, `updated_at`. `chat_horarios`: `id`, `tenant_id`, `dia_semana` smallint
(0–6), `inicio_min` e `fim_min` smallint (0–1440, `inicio_min < fim_min`, múltiplos de 15), `EXCLUDE USING gist
(tenant_id WITH =, dia_semana WITH =, int4range(inicio_min, fim_min) WITH &&)` (`btree_gist` já existe pela 0051),
no máximo 3 por dia (módulo, sob a trava da configuração). RLS: `app_enable_tenant_rls` nas duas; fora de `STAFF_ONLY`
(a sessão de paciente lê; o módulo projeta só `horario_ativo` e as faixas); escrita só da equipe (padrão
`paciente_sem_*`). Sem auditoria (sem `patient_id`). A linha de `chat_configuracoes` nasce só na primeira gravação da tela
da nutricionista; sem ela, o módulo trata o consultório como `horario_ativo = false` (CH-D70: a função
`app_chat_aviso_nutri_devido` cria a linha de `chat_avisos_nutri`, não a desta tabela); política RESTRICTIVE
`paciente_com_conta` nas duas.

**CH-D70 (decisão da orquestradora, 23/11/2026):** `aviso_email` e `aviso_nutri_em` saem de `chat_configuracoes` (que fica
com `tenant_id`, `horario_ativo` e `updated_at`) para a tabela nova **`chat_avisos_nutri`**: `tenant_id` PK (FK `tenants`),
`aviso_email` boolean NOT NULL default true, `aviso_nutri_em` timestamptz, `updated_at`. RLS: `app_enable_tenant_rls` e
`app_enable_staff_only` (entrada em `STAFF_ONLY`); `REVOKE DELETE, TRUNCATE` (apagar a linha religaria o e-mail e zeraria
a janela de 2 h; molde `fin_configuracoes`); sem `patient_id`, sem auditoria. Motivo: `chat_configuracoes` não é
`staff_only` (o paciente lê `horario_ativo`) e, pela data de `aviso_nutri_em`, o paciente saberia que outro paciente
escreveu nas últimas 2 h; a defesa fica no banco, não só na projeção do módulo. A linha nasce na tela da nutricionista ou em
`app_chat_aviso_nutri_devido`, que passa a ler e gravar `chat_avisos_nutri`. Onde esta spec cita
`chat_configuracoes.aviso_email`/`aviso_nutri_em` (RN-458, RN-472, §9.7), leia `chat_avisos_nutri`.

### 9.5 `recados` (nova; sem `patient_id`)

`id`, `tenant_id`, `texto` (1–1000), `filtro` jsonb (`{"tipo":"todos"}`, `{"tipo":"etiquetas","ids":[…]}`,
`{"tipo":"local","id":…}`; CHECK `filtro->>'tipo' in (…)`), `filtro_rotulo` text (até 300: "Etiquetas: …", gravado no
envio, para o histórico não depender de etiqueta renomeada ou apagada), `destinatarios` integer > 0, `criado_por` uuid,
`criado_em`. `UNIQUE (tenant_id, id)`. RLS: `app_enable_tenant_rls('recados')`, `app_enable_staff_only('recados')` e
entrada em `STAFF_ONLY` ("Plano 25 (RN-462): o recado do consultório e o filtro (etiquetas) — só a equipe; o paciente
lê a cópia na própria conversa"). `REVOKE UPDATE, DELETE, TRUNCATE`. Sem auditoria (sem paciente; cada cópia em
`chat_mensagens` é auditada). **v0.2:** `autor_nome`, `autor_crn` NOT NULL (carimbo, RN-475) e o
gatilho `recados_regras` (BEFORE INSERT: só na sessão `nutri`, `criado_por = app_current_user()`, `criado_em =
clock_timestamp()`, carimbo de `tenants`; outro papel → 42501, salvo os casos que a RLS já recusa, que devolvem `NEW`).
**v0.3:** entre os casos que devolvem `NEW` está a sessão de paciente (a `staff_only` e a `paciente_sem_insert` já a
recusam, e o teste de `staff_only` do isolamento roda a fábrica como P2), `publico`, `conta` e `recepcao` (CH-D71: só com o Plano 26 na `main`); o `worker` e
o papel desconhecido caem no 42501 do gatilho. `criado_em` com `default clock_timestamp()` no esquema.

### 9.6 Tabelas que mudam (CHECK e políticas)

| Tabela | Mudança |
|---|---|
| `notifications` | `notifications_tipo_valido` + `chat_mensagem`, `recado` (o Plano 23 acrescenta `aniversario`, `pedido_nao_confirmado`: quem entra depois junta as listas); `MotivoIgnorada` + `mensagem_lida` (texto, sem CHECK no banco) |
| `stored_files` | `stored_files_tipo_valido` + `chat_anexo`, `chat_anexo_original` (o Plano 21 acrescenta `avaliacao_foto`, `avaliacao_anexo`); ambos em `TIPOS_DO_PACIENTE` (com `patient_id`); `paciente_arquivo_insert` refeita com `tipo IN ('diario_foto_original', 'exame_original', 'chat_anexo_original')`; `paciente_arquivos` não muda (o paciente vê os arquivos com o próprio `patient_id`) |
| `ia_nutri_mensagens` | `ia_nutri_mensagens_resolucao`: `resolucao in ('vista', 'encerrada', 'respondida')`. Gatilho igual |

### 9.7 Funções (custom, `SECURITY DEFINER`, `search_path` fixo)

- `app_chat_soltar_anexo(p_mensagem uuid, p_caminho text)`: chamada só no `naMesmaTransacao` de `apagarArquivo`, pelo
  `worker` (conversão concluída, falha, varredura ou anonimização). Guardas: contexto `worker` com tenant; `p_caminho`
  igual ao ponteiro atual da mensagem (`anexo_path` ou `anexo_original_path`); `anexo_original_path` só com
  `anexo_status <> 'processando'`; `anexo_path` só com o titular nas condições de `app_chat_apagar_do_titular` (abaixo)
  e, nesse caso, `anexo_status := 'removido'`. v0.3: `anexo_path` é recusado (42501, mensagem "app_chat_soltar_anexo:
  solte antes o original") enquanto a mensagem ainda tem `anexo_original_path` (o CHECK `removido ⇒ sem caminhos` daria
  23514 no meio da anonimização). Liga o marcador local `app.chat_soltando`, faz o UPDATE e **zera o
  marcador antes de cada `RETURN` e no ramo de erro** (`set_config(…, true)` vale até o fim da transação, não da função).
- `app_chat_aviso_nutri_devido(p_no_horario boolean)`: chamada no envio do paciente (sessão `paciente`, troca de papel do
  molde 0083); v0.3: recusa (42501) fora da sessão de paciente com conta (`app_current_role() = 'paciente'`, tenant,
  paciente e `app_current_user()` preenchidos), antes de trocar o papel; cria a linha de `chat_avisos_nutri` (CH-D70) do tenant da sessão quando não existe (`INSERT … ON
  CONFLICT DO NOTHING`, com o padrão `aviso_email` ligado), trava a linha e devolve `false` com `aviso_email` desligado, fora do horário (`p_no_horario`,
  calculado no módulo) ou com `aviso_nutri_em` a menos de 2 h; senão grava `aviso_nutri_em = now()` e devolve `true`.
  Não devolve nenhuma coluna. Restaura o contexto antes de cada `RETURN`.
- `app_chat_apagar_do_titular(p_patient uuid)`: contexto `worker` com tenant; trava o paciente `FOR UPDATE`; aceita (a)
  titular `bloqueado`, `anonimizado_em` nulo e `anonimizar_apos < hoje` (a regra de `anonimizarVencidos`; v0.3: "hoje" no
  fuso do consultório, `(now() at time zone tenants.fuso)::date`, como `hojeNoFuso(t.fuso)` em `lgpd.ts`, nunca
  `current_date`) ou (b) titular
  com `anonimizado_em` não nulo (rede de limpeza depois de uma volta atrás, RN-466); recusa (42501) se ainda há anexo
  apontado; apaga `chat_leituras`, `chat_mensagens` e `chat_conversas` do titular no tenant da sessão.

### 9.8 Guardas e listas (só acrescentar, §6 de `sessoes-paralelas.md`)

| Onde | Entrada |
|---|---|
| `STAFF_ONLY` | `recados` |
| `PACIENTE_ESCREVE` | `chat_mensagens: ['insert']` ("Plano 25 (US-443, RN-443): o paciente envia na própria conversa liberada e não pausada — política paciente_chat_envio e gatilho chat_mensagens_regras; UPDATE, DELETE e TRUNCATE revogados"); `chat_leituras: ['insert', 'update']` ("Plano 25 (RN-448): o paciente avança o próprio marcador de leitura — políticas paciente_leitura_propria_insert/_update") |
| `AUDIT_EXCEPTIONS` | `chat_leituras` |
| `ENTIDADE_ROTULO`, `acaoDoItem`, `visivelNoHistorico` | `chat`, `chat_conversa` (fora da tela), `chat_liberacao`, `chat_pausa`, `chat_retomada` (CH-D39) |
| `test/isolamento.test.ts` | `FABRICAS` das 6 tabelas, **nenhuma em `COM_MAE`** (CH-D38): `chat_conversas` grava a conversa já liberada (`liberada_em = now()`, `liberada_por = coalesce(app_current_user(), gen_random_uuid())`, `tcle_forma = 'aceite_escrito'`) e, como `listTenantTables` ordena por nome, roda antes de `chat_leituras` e `chat_mensagens`, que não criam a mãe; `chat_mensagens` grava `autor = 'nutri'` com `coalesce(app_current_user(), gen_random_uuid())`; `chat_leituras` com `lado` coerente com a sessão e com o `UPDATE_DO_PACIENTE`; `chat_configuracoes` (PK por tenant) com `ON CONFLICT DO NOTHING`; `chat_horarios` com a faixa variando por chamada (o `EXCLUDE` recusa a repetição); `recados` com o carimbo. O `beforeAll` grava `nome_profissional` e `crn` nos tenants A e B (o gatilho exige o carimbo). `SO_INSERE`: `recados`, `chat_mensagens`; `SEM_DELETE` e `DELETE_REVOGADO`: `chat_conversas`, `chat_leituras`; v0.3:
`SEM_DELETE_DO_PACIENTE`: `chat_conversas`, `chat_leituras` (o teste da P2 roda `delete` sem savepoint e o `REVOKE DELETE`
daria 42501 antes da RLS); `PAPEL_DA_FABRICA`: `chat_leituras: 'paciente'` (o `beforeAll` passa a aceitar fábrica de
paciente, com `patientId` e ator); as fábricas de `chat_mensagens` e `recados` gravam o carimbo (`autor_nome`,
`autor_crn`) igual ao do tenant, para a tabela ficar verde antes do gatilho; `IMUTAVEIS`: `chat_conversas`, `chat_leituras`; `UPDATE_DO_PACIENTE`: `chat_leituras`; filtro em `SO_APAGA.patients` (o titular com conversa não se apaga: FK `NO ACTION`) |
| `CLAUDE.md` | Regra 1 (o aviso de mensagens à nutricionista é um uso novo de `emailsDaNutri` em `aviso-nutri.ts`: acrescentar "e o aviso de mensagens de pacientes, Plano 25" à frase desse arquivo; nenhum arquivo novo lê `user`), regra 2 (frase "Plano 25: …" com as políticas e os gatilhos), regra 8 (entidades `chat`, `chat_conversa` fora da tela e os `recordAudit` `chat_liberacao`/`chat_pausa`/`chat_retomada`, `chat_leituras` em `AUDIT_EXCEPTIONS`, as leituras com e sem `auditRead` da RN-453), regra 9 (tipos `chat_anexo`/`chat_anexo_original`, job `chat-anexo` só no worker, `app_chat_soltar_anexo`) |
| `src/jobs/queues.ts`, `src/worker/index.ts` | fila `chat-anexo` (linha no fim, molde de `diario-foto`) |
| Grafo de imports | `anexo-job.ts` só no worker (guarda de `exportacao.test.ts`/`push.test.ts`); `src/modules/ia/**` não importa `src/modules/mensagens` |

### 9.9 Ordem das migrations

1. Gerada (`pnpm db:generate`): as 6 tabelas, os CHECKs ampliados de `notifications`, `stored_files` e
   `ia_nutri_mensagens`.
2. Custom `rls_mensagens`: RLS, `staff_only`, `app_allow_paciente_escrita`, políticas `paciente_chat_envio` e
   `paciente_leitura_propria_*`, `paciente_com_conta`, `paciente_arquivo_insert` refeita, os quatro gatilhos (`chat_conversas_regras`, `chat_mensagens_regras`, `chat_leituras_regras`, `recados_regras`), as três funções, `app_enable_audit`,
   `REVOKE`/`GRANT`, `EXCLUDE` de `chat_horarios` (se o Drizzle não gerar).

Colunas novas só em tabelas novas: a imagem anterior continua de pé depois da migration (o CHECK ampliado aceita os
valores antigos).

**Volta atrás (v0.2).** Voltar para a imagem anterior ao Plano 25 depois de a conversa estar em uso: (a) a anonimização da
imagem antiga não conhece o chat (não lista os anexos e grava `anonimizado_em`): a conversa e os anexos desses titulares
ficam até a imagem nova voltar e a rede de limpeza (`apagarConversasDosAnonimizados`, RN-466) apagar; (b) a dúvida
`respondida` aparece como "aberta" na ficha e ao paciente (`conversa.ts:248`, `duvidas.ts:54`) e a exportação sai sem a
`situacaoDaDuvida` certa (`lgpd.ts:155`); (c) o worker antigo não conhece os tipos `chat_mensagem`/`recado` de
`notifications` e os marca como falhos, sem conteúdo (nada vaza); (d) anexos em processamento ficam até a varredura
nova (RN-474). Nada disso apaga nem expõe dado; o runbook do plano registra a janela do deploy.

### 9.10 O que não muda

`patients`, `tenants`, `appointments`, `push_subscriptions`, `consents`, `audit_log` (nenhuma coluna nova),
`ia_nutri_participacoes`, `ia_nutri_consentimentos`, o gatilho `ia_nutri_mensagens_regras`, `access_events`,
`SEM_CONTA_PERMITIDOS`, `PUBLICO_LIBERADO`, o script de backup (CH-D35).

---

## 10. Normas profissionais (CFN)

Por ordem do dono, **sem análise de LGPD** neste plano. Nada aqui é parecer; as perguntas ao CRN-3 estão na §14.2.

| Tema | Tratamento |
|---|---|
| Telenutrição (Res. CFN 760/2023; a Res. CFN 666/2020, de teleconsulta na pandemia, foi revogada pelo art. 17 da 760, que também revoga a 751/2023 — segundo a compilação da LegisMap, DOU a conferir (P-CH3); o art. 15 da 760 suspende o art. 36 da 599, que exigia avaliação e diagnóstico presenciais) | A conversa individual é atendimento por TIC **assíncrono** (art. 2º, II): só por nutricionista (art. 1º; só a sessão `nutri` escreve pela equipe), depois do cadastro no e-Nutricionista (art. 5º) e da ciência e acordo do paciente com o TCLE, informadas as possibilidades, os limites e as fragilidades do atendimento por mensagens (art. 9º, VI), com o comprovante **enviado** ao paciente e guardado (art. 9º, parágrafo único). O sistema não guarda o TCLE (backlog "Telenutrição", Plano 23 AG-D36): registra **que** foi colhido e **como** (`termo_assinado` ou `aceite_escrito`; a forma verbal saiu na v0.2 por não deixar comprovante, CH-D3), e o diálogo lembra o comprovante e o e-Nutricionista. A nutricionista avalia se o remoto é indicado para cada paciente (art. 8º: a liberação é por paciente) e combina a continuidade (art. 9º, X: lembrete no diálogo de pausa). Nenhuma marca associada ao atendimento (art. 9º, IV) |
| Registro em prontuário (Res. CFN 594/2017; 760/2023, arts. 10, IV, e 11) | A conversa individual é parte do prontuário: fica na ficha (seção "Mensagens"), é imutável (RN-445), tem autoria e data pelo banco (RN-443) e segue a guarda do prontuário (bloqueio + 20 anos, 0110; apagada só na anonimização, RN-466). A resposta escrita à dúvida da IA Nutri é o caso que a spec F3-02 já previa (D24 = a, "telenutrição assíncrona e registro de prontuário") e agora passa pela liberação com TCLE. Cada registro da nutricionista leva a identificação profissional (594, art. 8º, caput e II: nome, profissão e CRN; 760, art. 10, I): carimbo `autor_nome`/`autor_crn` gravado na linha (RN-475). Receita, parecer e plano vão por Documentos, assinados e com código verificador (760, art. 10, II); se a mensagem de texto também é "documento" para esse inciso fica para o CRN-3 (P-CH5) |
| Sigilo profissional (Código de Ética, Res. CFN 599/2018, art. 20; a partir de 23/01/2027 a 856/2026, art. 23, texto pela compilação não oficial; 760/2023, art. 9º, IX: "preservar o sigilo e a confidencialidade das imagens, dos dados, dos diálogos"; 760, art. 1º, e 856, art. 44: a telenutrição segue os princípios do atendimento presencial) | Conversa dentro da plataforma, com RLS por paciente; nenhum conteúdo em push, e-mail, WhatsApp, log ou Sentry (RN-457, RN-458, RN-470); caixa sem prévia de texto; a recepcionista do Plano 26 não vê (CH-D33); o e-mail à nutricionista nem diz o nome do paciente |
| Urgência | O canal assíncrono não substitui atendimento de urgência: aviso fixo (RN-450) e texto de socorro na hora para sinal de risco (RN-449), o mesmo cuidado da IA Nutri (RN-174 do Plano 15) |
| Recados | Mensagem administrativa do consultório, igual para todos, sem conduta individual: não é telenutrição e não pede TCLE (CH-D17). Recado com orientação alimentar geral deixaria de ser aviso administrativo e cairia na tele-educação (760, art. 3º, VI) e no art. 55 da 599 (respaldo técnico-científico): a ajuda do campo pede só avisos do consultório e nada de orientação de dieta. Sem preço, desconto, promoção ou sorteio (599, art. 57; 856, art. 68, III, compilação) e sem marca de alimento, suplemento, fitoterápico, laboratório ou farmácia (599, arts. 60 e 63; 760, art. 9º, IV). A ajuda lembra também de não escrever dado de saúde nem nome de paciente; nenhum paciente vê os outros destinatários nem a etiqueta usada. Interpretação com o CRN-3 (P-CH2) |
| Autoria | `liberada_por`, `pausada_por`, `autor_user_id` e `resolvida_por` conferidos pelo banco (ECF.17.01). A identificação ao paciente (nome e CRN na conversa e no recado) vem do carimbo gravado na linha (RN-475; 599, art. 21; 856, art. 24, compilação) |
| Dois níveis de segurança (Res. CFN 594/2017, art. 8º, II) | A escrita na conversa segue o resto do prontuário: login com sessão; 2FA exigido só para assinar documentos. Não muda no Plano 25 (vale para todo o prontuário): pendência P-CH6 com o CRN-3 e a meta SBIS |

---

## 11. Boas práticas SBIS NGS1

1. **Trilha** (NGS1.07): escritas em `chat_mensagens` e `chat_conversas` pelo gatilho `audit_row_change`; leituras do
   conteúdo por `auditRead`; marcadores de leitura fora da trilha, justificados.
2. **Integridade:** mensagens e recados imutáveis no banco (gatilho + `REVOKE`); apagar só por função na anonimização.
3. **Controle de acesso** (NGS1.03): RLS por tenant e paciente; escrita do paciente por política RESTRICTIVE própria;
   `recados` `staff_only`; sem papel novo.
4. **Datas consistentes** (ECF.17.05): `criada_em` pelo relógio do banco; horário no fuso do consultório.
5. **Autoria** (ECF.17.01): ator conferido pelo gatilho em todas as escritas.

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-440 | A nutricionista vira "plantão" do paciente | Horário de atendimento visível, aviso de urgência fixo, pausa por paciente, e-mail à nutricionista limitado e desligável |
| R-441 | Mensagem de risco lida tarde | Texto de socorro na hora (RN-449); selo e topo da caixa; e-mail à nutricionista (no horário). Limite assumido: o filtro é por palavras (falso negativo possível), como na IA Nutri |
| R-442 | Conteúdo vazar por aviso | Corpos fixos com teste (CS-440); sem prévia na caixa |
| R-443 | Consulta de situação sobrecarregar o app | Só contagem, intervalo crescente, nada com a aba escondida (RNF-441) |
| R-444 | Volume do `audit_log` (uma linha por render da conversa) | Aceito: o render só acontece ao abrir ou ao tocar em "Mostrar novas mensagens"; a consulta de situação não grava |
| R-445 | Imagem do paciente com localização (EXIF) ou malformada | Conversão no worker para JPEG sem metadados, 40 MP; o original nunca é servido à nutricionista enquanto processa |
| R-446 | PDF malicioso | Só da nutricionista (arquivo que ela mesma produziu); o do paciente vai pelo pipeline do Plano 12 |
| R-447 | Recado com dado de saúde ou propaganda | Ajuda do campo, revisão em dois passos, imutável (o consultório responde pelo que envia); limite diário |
| R-448 | Cota de armazenamento | Anexos contam na cota; limites diários; aviso de 80% já existe |
| R-449 | Corrida entre resposta pela conversa e "Marcar como vista" | Trava da dúvida e reconferência (RN-460); "Esta dúvida já foi tratada." |
| R-450 | Paciente com vários consultórios recebe push do consultório errado | Tela com `?v=` do tenant (molde de `AVISOS_DO_PORTAL`) |
| R-451 | Conflito de rebase nos arquivos disputados | §13; só acréscimos |
| R-452 | Interpretação do CRN-3 diferente (conversa ≠ telenutrição, ou recado = publicidade) | Perguntas na §14.2; a liberação e os textos podem mudar sem migration de dados |
| R-453 | Prefetch do Next marcar como lida, auditar e encher o `audit_log` | `prefetch={false}` em todo link com efeito de leitura, com teste (RN-473) |
| R-454 | Volta para a imagem anterior deixar a conversa de titular anonimizado | Rede de limpeza e reconferência na transação final (RN-466); §9.9 |
| R-455 | Paciente sem internet ver o plano no lugar da conversa, ou a conversa ficar guardada no aparelho | `/p/mensagens` fora do cache e aviso "Sem conexão." (RN-473) |

---

## 13. Conflitos com os planos em andamento

| Plano | Worktree / branch | Onde toca | Como resolver |
|---|---|---|---|
| **23** (agenda 2) | `nutridebby-23` (spec/plano) e `nutridebby-c` / `plano-23-agenda-2` (implementação em curso) | `notifications_tipo_valido` (+ `aniversario`, `pedido_nao_confirmado`); `emailDaNotificacao` passa a ter avisos **sem consulta** e `motivoParaIgnorar` ganha motivos; `aviso-nutri.ts` (eventos novos); `src/email/types.ts`, `templates.tsx`, `transport.ts` (`headers?`); `SECOES_DA_FICHA` (+ `consultas`); `CARTOES` (+ Locais); `portal/mural.ts`/`jornada.ts`; `locais_atendimento` e RN-436 (alcance do recado por local); §2.2 do 23 deixou fora "Mensagem a outros grupos (campanhas…)" | Quem entra depois junta as listas do CHECK e os `case`; os dois usam o mesmo caminho de e-mail sem consulta (o que entrar primeiro cria; o outro só acrescenta o tipo). Seção e cartão no fim. O 25 **não** mexe em mural, jornada nem no Início do painel (CH-D27). US-449 só depois do merge do 23 (DEP-CH10), reaproveitando a função do filtro da RN-436. O recado não é a "mensagem a outros grupos" que o 23 recusou: é aviso administrativo no app, sem e-mail e sem WhatsApp (CH-D18); o 23 continua sem campanha |
| **20 PR 2** (financeiro) | `plano-20-financeiro` | `navegacao.ts` (+ "Financeiro" entre "Conteúdos" e "Configurações"); `exportacao-job.ts` e `lgpd.ts`; `email/templates.tsx` | `ITEM_MENSAGENS` substitui `ITEM_DUVIDAS` na mesma posição (antes de "Conteúdos"); o "Financeiro" fica onde o 20 pôs. Na exportação, seção nova `mensagens` em linhas próprias. Nenhuma relação de dados (o recado não filtra por pagamento) |
| **19** (plano alimentar 2) | `nutridebby-b` / `plano-19-seed-usda` | `src/jobs/queues.ts`, `src/worker/index.ts` (`plano-pdf-2`) | Fila `chat-anexo` em linha nova no fim |
| **21** (avaliação física) | `nutridebby-21` / `plano-21-avaliacao-fisica` | `stored_files_tipo_valido`, `TipoDeArquivo`, `TIPOS_DO_PACIENTE`; `exportacao-job.ts`, `lgpd.ts`; `isolamento.test.ts` | Juntar as listas; seções novas em linhas próprias |
| **22** (exames e prescrição) | `nutridebby-22` / `plano-22-exames-prescricao` | `queues.ts`/`worker/index.ts` (`documento-pdf-2`, `documento-digitalizado-2`); `isolamento.test.ts`; `exams.mostrar_no_app_em` (o paciente vê exames liberados) | Filas em linhas próprias. Sem dado em comum: a ajuda "Para enviar um exame em PDF, use Exames." continua certa com o 22. O `<dialog>` compartilhado (`src/components/dialogo.tsx`) é criado por quem entrar primeiro (22 T2, 23 PR 3 ou 25 PR 2), com a interface do 22 T2; os outros reaproveitam |
| **26** (relatórios e recepcionista) | `nutridebby-26` / `plano-26-relatorios-recepcionista` | Papel novo e as políticas que negam as tabelas de saúde; `navegacao.ts`; `rls-guard.ts` | **As 6 tabelas deste plano entram na lista de negação da recepcionista** (conversa é prontuário; `recados` e configuração por simplicidade no v1); o item "Mensagens" some do menu dela. Quem entra depois acrescenta as tabelas do outro às listas. Relatórios do 26 não contam mensagens no v1. Tipos `chat_mensagem` e `recado` **fora** de `TIPOS_DA_AGENDA` do 26 (RN-507 de lá); o item "Mensagens" e a consulta de 60 s do contador ficam fora do menu e do layout da recepção (RN-505 e PM-R13 do 26) |
| **Plano 15** (IA Nutri, na `main`) | — | `ia_nutri_mensagens_resolucao`; `duvidas.ts`; `/painel/duvidas`; `ITEM_DUVIDAS` | Emenda da D24: a fila continua com "Marcar como vista" (b) e ganha "Responder na conversa", que só existe com a conversa liberada (TCLE), o pré-requisito que a spec F3-02 pedia para a resposta escrita (CH-D13). O h1 de `/painel/duvidas` passa a "Dúvidas da IA Nutri" (CH-D45): ajustar `navegacao.test.ts`, `e2e/ia-nutri-paciente.spec.ts`, `e2e/acessibilidade-painel.spec.ts` e `e2e/sessao-equipe.spec.ts`; guias `boas-vindas`, `duvidas` e `configuracoes` sobem de versão |
| Arquivos disputados (§6) | todos | `rls-guard.ts`, `audit-guard.ts`, `isolamento.test.ts`, `CLAUDE.md`, `navegacao.ts`, manual técnico, backlog e índice | Só acréscimos no fim; quem entra depois resolve no rebase |
| **26**, as três guardas (v0.3) | `nutridebby-26` (spec: RN-507, RN-511, RN-513) | `FUNCOES_COM_PAPEL` e `findPapelEmFuncoesViolations` (`rls-guard.ts`); teste de `TIPOS_DA_AGENDA` contra o CHECK `notifications_tipo_valido`; teste de fonte das rotas (`requireNutri`/`requireApiNutri` em toda `page.tsx`, `route.ts` e action do painel) | Se o 26 entrar antes, o 25 acrescenta no mesmo PR: os quatro gatilhos (`chat_*_regras`, `recados_regras`) com a decisão **"não se aplica"** (tabelas negadas à recepção; a `recepcao` devolve `NEW` e a RLS do 26 nega; papel desconhecido cai no 42501 do gatilho) e as três funções `SECURITY DEFINER` com **"recusa"** (guarda de papel própria); `chat_mensagem` e `recado` registrados como fora de `TIPOS_DA_AGENDA`; as rotas novas com `requireNutri`/`requireApiNutri` (nenhuma em `ROTAS_DA_RECEPCAO`). Se o 25 entrar antes, o 26 acrescenta |
| **21**, **22** (auditoria) e **19** (ajuda do portal) (v0.3) | branches deles | `plataforma/audit.ts` (`ENTIDADE_ROTULO`, `acaoDoItem`, `visivelNoHistorico`); `ajuda/portal.ts` (versão do `portal-novidades`) | Só acrescentar; a versão sobe uma vez sobre a da `main` do momento |

Migrations: a última na `main` é a 0125; os Planos 19, 20 PR 2, 21, 22 e 23 vão criar outras antes. O 25 gera as suas
de novo sobre a `main` antes do PR (C-446, PM-CH1).

---

## 14. Decisões

### 14.1 Decisões delegadas pelo dono (onda 3: "seguir as recomendações sem parar para perguntar")

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| CH-D1 | **Uma conversa por paciente e consultório, caixa compartilhada pela equipe** (todas as nutricionistas do consultório veem e respondem; leitura do consultório, não de cada uma) | O prontuário é do paciente no consultório; hoje a fila de dúvidas e os avisos já são por consultório (`avisarNutri` manda a todas) | RN-448, RN-471 |
| CH-D2 | **A conversa individual é prontuário: imutável, sem apagar, guarda do prontuário** | Res. CFN 760/2023 (arts. 10, IV, e 11) e 594/2017; a spec F3-02 já tratava a resposta escrita como prontuário. Apagar/editar quebraria a trilha (SBIS) | RN-445, RN-465, RN-466 |
| CH-D3 | **Liberação por paciente, com a forma do TCLE registrada** (`termo_assinado` ou `aceite_escrito`; v0.2: sem a forma verbal) e o aviso do e-Nutricionista; o comprovante é enviado ao paciente e guardado pela nutricionista | Art. 9º, VI, e parágrafo único, da 760 (TCLE antes do primeiro atendimento a distância; "enviar e guardar o comprovante"): a concordância só verbal não deixa comprovante (revisão normativa, I2). O registro geral do TCLE ficou no backlog do 23 (AG-D36); aqui só o necessário para o chat | RN-441, US-440 |
| CH-D4 | **Sem tempo real:** consulta de 15 s que só devolve contagem; o conteúdo vem pelo render do servidor | Uma VPS, sem serviço novo; a contagem não é dado de saúde (sem `auditRead` a cada 15 s), e o conteúdo continua passando pelo caminho auditado | C-440, RN-452 |
| CH-D5 | **Caixa sem prévia do texto** | Lista sem `auditRead` (precedente: `filaDeDuvidas`, lista de pacientes); prévia de 300 pacientes seria leitura de saúde em massa | RN-453, US-442 |
| CH-D6 | **Paciente envia só foto; o PDF de exame vai por "Enviar exame"** | O original de PDF do paciente nunca chega ao navegador da nutricionista (Plano 12, R-170); repetir a rasterização no chat dobraria o custo do worker. A nutricionista envia PDF que ela mesma produziu | RN-455, §2.2 |
| CH-D7 | **Toda imagem (dos dois lados) passa pelo worker e vira JPEG sem metadados** | Localização da foto do celular (EXIF/GPS) de qualquer um dos lados; HEIC e sharp só no worker (molde do diário) | RN-454, RN-455 |
| CH-D8 | **Um anexo por mensagem** | Simplicidade de modelo (colunas na mensagem, sem tabela de anexos) e de UI; vários arquivos = várias mensagens | §9.2 |
| CH-D9 | **Paciente: push neutro na hora e e-mail sem conteúdo depois de 30 min sem leitura; agrupado (um aviso pendente por vez); 21h–8h adiado** | Regra 3 (nada de conteúdo); evita uma enxurrada de avisos numa conversa ativa; o e-mail cobre quem não ativou o push | RN-456, RN-457 |
| CH-D10 | **Nutricionista: contador no menu e e-mail sem nome nem texto, no máximo a cada 2 h, só no horário de mensagens, desligável; sem push** | `push_subscriptions` é do paciente; inscrição da equipe é projeto à parte. O nome do paciente no e-mail diria quem é paciente de quem | RN-458, RN-459 |
| CH-D11 | **Horário próprio do chat (faixas por dia), separado dos horários da agenda; fora dele o paciente vê o aviso e envia mesmo assim** | A agenda é por local depois do 23 e mede consultas, não resposta; bloquear o envio empurraria o paciente para o WhatsApp pessoal | RN-451, US-446 |
| CH-D12 | **Aviso de urgência fixo e filtro de risco determinístico reaproveitado da IA Nutri (`detectarRisco`), sem IA** | Cuidado já validado no Plano 15; sem rede e sem custo; o texto de socorro sai na hora, a nutricionista vê o selo | RN-449, RN-450 |
| CH-D13 | **Fila e conversa ligadas por "Responder na conversa": a mensagem resolve a dúvida (`respondida`) e guarda só a data da dúvida, não o texto** | Copiar o texto da dúvida para o prontuário quebraria a retenção de 180 dias prometida no consentimento da IA Nutri; a data basta para o paciente ligar uma à outra. "Marcar como vista" continua para quem trata na consulta | RN-460, RN-461 |
| CH-D14 | **"Mensagens" substitui "Dúvidas dos pacientes" no menu; as dúvidas viram aba de Mensagens** (a rota fica) | Não aumentar o menu (até 9 itens com Exames e Financeiro); as duas são "o paciente quer falar com você" | §4.1 |
| CH-D15 | **No app, "Mensagens" é link na faixa (com contador), não 6ª seção** | O Plano 16 fixou 5 seções (RN-190) e a faixa aparece em todas | §4.1 |
| CH-D16 | **Recado só no app, com push neutro, sem e-mail; paciente sem app não recebe** | Texto livre por e-mail levaria conteúdo para fora do app (regra 3); a tela mostra quantos ficam de fora | RN-456, RN-464 |
| CH-D17 | **O recado entra na conversa de cada paciente, mesmo sem liberação (só leitura); recado não pede TCLE** | Uma caixa só para o paciente (como no Dietbox); o recado é aviso administrativo, sem conduta individual | RN-462, RN-463 |
| CH-D18 | **Recado é aviso do consultório, não campanha:** sem orientação de dieta, preço, promoção, sorteio ou marca de produto (ajuda do campo), revisão antes de enviar, imutável, 10 por dia, 500 por envio | Código de Ética (599, arts. 55, 57, 60 e 63; 760, arts. 3º, VI, e 9º, IV); o 23 recusou campanhas e a fronteira fica clara | RN-462, §10 |
| CH-D19 | **Lida por lado (consultório e paciente) numa tabela técnica fora da auditoria; os dois veem "Lida"** | O marcador muda a cada abertura; auditar cada avanço seria ruído (a leitura já é auditada por `auditRead`) | §9.3, RN-448 |
| CH-D20 | **v0.2: cada mensagem e recado da nutricionista leva o nome e o CRN gravados na linha (carimbo do consultório, RN-475); "Você" para a própria usuária no painel; nada lê a tabela `user`** | A conversa é prontuário: todo registro leva a identificação profissional (594, art. 8º; 760, arts. 9º, V, e 10, I; 599, art. 21). Um consultório = uma nutricionista (B-01 da spec de documentos), então o carimbo do consultório identifica quem escreveu, e a regra 1 continua sem exceção nova. A v0.1 ("Equipe do consultório", "Sua nutricionista") caiu na revisão normativa (C1) | RN-471, RN-475 |
| CH-D21 | **Sem mensagem automática de ausência, "férias" ou respostas prontas no v1** | O aviso de horário cobre o principal; backlog | §2.2 |
| CH-D22 | **Pausar em vez de encerrar ou apagar** | Mantém o histórico (prontuário) e devolve o canal sem novo TCLE | RN-442 |
| CH-D23 | **Exportação: seção `mensagens` e `conversa` no `dados.json`, anexos no ZIP com nome gerado** | O titular recebe o que é dele (regra técnica da exportação); nunca o nome do arquivo em caminho (regra 9) | RN-467 |
| CH-D24 | **Apagar só na anonimização, por função do worker** (molde de `app_anonimizar_autorizacoes_ia`) | Prontuário guardado até o fim do prazo; nenhuma sessão apaga | RN-466 |
| CH-D25 | **No pedido de exclusão atendido, a conversa fica só leitura e nada é apagado** | É prontuário (como atendimentos); diferente das fotos do diário, que saem na hora | RN-465 |
| CH-D26 | **Seção "Mensagens" no Início da ficha, sem aba nova** | Plano 18 D12 (a 14ª aba não cabe); o registro de seções é o ponto de extensão | §4.4 |
| CH-D27 | **Nenhum cartão novo no Início do painel nem no mural de Hoje** | O contador do menu e o link da faixa bastam; o Início e o mural são disputados com o 23 | §2.2, §13 |
| CH-D28 | **Nada do chat vai à IA** (guarda de imports e de texto) | Spec F3-02 (D9: a IA não vê conversas da equipe); o consentimento da IA não cobre | RN-469 |
| CH-D29 | **Nada por WhatsApp** | INT-01 (só transacional) e Termos do WhatsApp | C-445 |
| CH-D30 | **Limites: paciente 30/h, 200/dia, 20 fotos/dia; consultório 100 anexos/dia, 10 recados/dia** | Abuso e cota; os números cabem num consultório de 300 pacientes; ajustáveis por constante | RN-447, RN-462 |
| CH-D31 | **Uma gerada + uma custom, sem número reservado** | `sessoes-paralelas.md` §5 | §9.9 |
| CH-D32 | **Texto puro, 2.000 caracteres por mensagem, 1.000 por recado** | Simplicidade, segurança (sem HTML) e leitura no celular | RN-444, RN-462 |
| CH-D33 | **A recepcionista do Plano 26 não vê conversas, recados nem a configuração** | Conversa é prontuário (o 26 nega dado de saúde); recado e configuração por simplicidade no v1 | §13, C-442 |
| CH-D34 | **Links no texto não viram link clicável** | Evita phishing pela conversa e `href` com `javascript:`; o paciente copia o endereço. Backlog: links clicáveis só para domínios do próprio consultório | RN-444 |
| CH-D35 | **O script de backup não muda** (`chat_anexo_original` entra no backup; vive minutos) | Mudar o script pede reinstalação no host pelo dono (regra 10); o ganho é pequeno | §9.10 |
| CH-D36 | **Numeração 440–479 e prefixo "CH-D"** | Decisão da orquestradora (17/11, ~11h40 UTC) | Cabeçalho |
| CH-D37 | **Carimbo do consultório (`tenants.nome_profissional`, `tenants.crn`) gravado em cada mensagem e recado da nutricionista; sem carimbo, nem liberar nem enviar** | Identificação profissional (revisão normativa C1) sem coluna nova em `tenants` (C-441) nem leitura de `user`; o mesmo molde do carimbo dos documentos (Plano 10A) | RN-475 |
| CH-D38 | **Gatilhos que devolvem `NEW` no que a RLS já recusa; nenhuma tabela nova em `COM_MAE`; `chat_mensagens` em `SO_INSERE`** | Para os testes negativos do isolamento provarem a política da própria tabela (revisão RLS, I6); o UPDATE do worker e a recusa por `patient_isolation` ganham testes de banco próprios | §9.2, §9.8 |
| CH-D39 | **Gatilho de `chat_conversas` na entidade neutra `chat_conversa`, fora da tela; os atos pelo `recordAudit` do módulo (`chat_liberacao`, `chat_pausa`, `chat_retomada`)** | O gatilho não distingue a conversa criada pelo recado, a liberação e a pausa; um recado a 500 pacientes mostraria 500 "liberações" (revisão RLS, I5) | RN-453 |
| CH-D40 | **Marcador de leitura e cursores pelo id da mensagem, resolvidos no SQL; teto `clock_timestamp()`** | O `Date` do JS (ms) contra `criada_em` (µs) deixaria a última mensagem não lida para sempre e o "Mostrar novas" voltando a cada 15 s (revisão RLS, I4; o mesmo erro do Plano 15, T9) | RN-446, RN-448, RN-452 |
| CH-D41 | **Estado terminal `removido` do anexo, gravado só por `app_chat_soltar_anexo` junto com a anulação do caminho** | Sem ele, o CHECK "pronto ⇒ caminho" recusaria a anulação e a anonimização de todo titular com anexo falharia todo dia (revisão RLS, I1). A alternativa (regra no gatilho com exceção pelo marcador) deixava o CHECK mais fraco | RN-445, RN-466, §9.2 |
| CH-D42 | **A caixa "Conversas" lista só conversas liberadas ou com mensagem individual; a conversa só de recado fica em "Recados"** | Um recado a 300 pacientes empurraria as conversas reais para baixo (revisão de interface, I3) | RN-463, US-442 |
| CH-D43 | **Contador do menu atualizado por consulta leve de 60 s com a aba visível** | O layout não refaz na navegação pelo cliente e a nutricionista não tem push: na Agenda, ela não veria mensagem nova (revisão de interface, I8). Custo: uma contagem por minuto por aba aberta | RN-459 |
| CH-D44 | **`caminhoNaFicha` troca `{id}` pelo `patientId` no href absoluto** (em vez de um membro novo no tipo) | Uma linha numa função do Plano 18, com teste; nenhuma seção existente usa `{id}` (revisão de interface, I4) | §4.4 |
| CH-D45 | **Um nome só para a fila: "Dúvidas da IA Nutri"** (aba, h1, "Voltar", guias e aviso do portal) | Três nomes para a mesma tela confundem (revisão de interface, M6); o menu já não a cita | §4.1, §6.2 |
| CH-D46 | **`/p/mensagens` só com internet e nunca no cache do service worker; links com efeito de leitura sem prefetch** | Sem conexão, o portal mostraria o plano no lugar da conversa; conversa guardada no aparelho seria dado de saúde fora do servidor; o prefetch marcaria como lida e gravaria `auditRead` (revisão de interface, I2 e I9) | RN-473 |
| CH-D47 | **Política RESTRICTIVE `paciente_com_conta` nas tabelas `chat_*`** | `patient_isolation` libera a própria linha a todo contexto `paciente`, inclusive o `semConta` (links, WhatsApp); a lista `SEM_CONTA_PERMITIDOS` é de módulos, não de tabelas (revisão RLS, Minor 1) | RN-440 |
| CH-D48 | **`/p/mensagens` no `tambem` de "Hoje"**, não de "Eu" | É o destino do "Voltar"; marcar "Eu" não batia com o caminho (revisão de interface, M9) | §4.1 |
| CH-D70 | **Marca do aviso à nutricionista em tabela `staff_only` (`chat_avisos_nutri`)** — decisão da orquestradora 23/11: marca do aviso à nutricionista em tabela staff_only, para o paciente não saber que outro paciente escreveu | `chat_configuracoes` é lida pelo paciente (`horario_ativo`); a data de `aviso_nutri_em` revelaria a atividade de outros pacientes; a defesa fica no banco | §9.4, RN-458, RN-472, §9.7 |
| CH-D71 | **A `recepcao` recebe o 42501 do gatilho enquanto o Plano 26 não estiver na `main`** (decisão da orquestradora, 23/11/2026): enquanto o Plano 26 não estiver na `main`, a `recepcao` recebe o 42501 do gatilho (falha fechada: sem o 26, nenhuma política a nega e a `tenant_isolation` não olha o papel). Se o 25 entrar antes, o 26 faz `CREATE OR REPLACE` das quatro funções de gatilho acrescentando `'recepcao'` à lista que devolve `NEW` e inverte a asserção do `banco.test.ts` ("row-level security" em vez do 42501 do gatilho); se o 26 entrar antes, o §5 do 25 faz isso | Sem o 26, nenhuma política nega a `recepcao` e a `tenant_isolation` não olha o papel: devolver `NEW` deixaria a escrita passar (CH-D57) | §9.1, §9.2, §9.5 |
| CH-D72 | **Corrida do marcador de leitura** (decisão da orquestradora, 23/11/2026, revisões do PR 1): `criada_em` vem do `clock_timestamp()` do INSERT, então quem lê antes do commit de uma mensagem poderia levar `lida_ate` para além dela. No módulo: `lida_ate` = `criada_em` da **última mensagem do outro lado** que a tela carregou (o id mostrado, resolvido no SQL com o tenant e o paciente da conversa aberta e com o autor do outro lado), nunca a própria mensagem nem `now()`; o envio do paciente chama `app_chat_aviso_nutri_devido` **antes do INSERT e em todo envio**, e o `FOR UPDATE` dela (junto da trava do paciente) serializa os envios, então a ordem de `criada_em` segue a ordem de commit; o envio da nutricionista serializa pela conversa (`FOR NO KEY UPDATE`). Teste com duas conexões: a mensagem que commita depois da leitura do outro lado continua não lida. **Risco residual aceito:** a cópia de recado (transação longa, sem a trava da conversa) contra uma mensagem individual da nutricionista commitada antes, e duas nutricionistas escrevendo ao mesmo paciente quase ao mesmo tempo — janela curta; o "Lida" pode sair errado, mas nada vaza | O marcador por data (CH-D40) só é exato se a ordem de `criada_em` seguir a ordem de commit; sem isso, uma mensagem poderia nunca aparecer como não lida | RN-448, RN-452, RN-458, §9.3 |
| CH-D73 | **Não prometer prazo de leitura** (decisão da orquestradora, 23/11/2026): nenhum texto ao paciente diz quando a mensagem será lida ("é lida no próximo horário" → "será lida quando sua nutricionista voltar ao atendimento por mensagens"; a ajuda diz "no horário de atendimento por mensagens, não em tempo real") | A nutricionista pode faltar, adoecer ou atrasar a leitura; um prazo escrito vira promessa que o consultório não controla, e o paciente pode esperar resposta numa situação que pede outro canal | §6.2 ("Portal: conversa", "Portal: ajuda"), US-443 |
| CH-D74 | **Nome e CRN na liberação e na pausa da conversa** (decisão da orquestradora, 23/11/2026): `chat_conversas` ganha `liberada_nome`/`liberada_crn` e `pausada_nome`/`pausada_crn`, gravados pelo gatilho `chat_conversas_regras` a partir de `tenants.nome_profissional`/`tenants.crn` (como o carimbo das mensagens; o módulo não manda, e o que vier é sobrescrito). Os da liberação nunca mudam; os da pausa só na pausa (gravados) e na retomada (a nulo). CHECKs de coerência com `liberada_em` e `pausada_em`. A pausa também exige o carimbo do consultório | Só o id (`liberada_por`/`pausada_por`) não identifica a profissional como ela era no momento do ato; o perfil muda depois, e o prontuário tem de guardar quem liberou e quem pausou com nome e CRN (Res. CFN 594/2017, art. 8º; 760/2023, art. 9º, V) | §9.1, RN-441, RN-442, RN-475 |
| CH-D75 | **Erros próprios de cada ato da conversa e o texto da pausa sem carimbo** (decisão do controlador na revisão da T6b, 23/11/2026, aprovada pela orquestradora): "Para pausar a conversa, preencha seu nome e seu CRN em Configurações." (com o link ao Perfil) e, no erro inesperado, "Não foi possível liberar a conversa. Tente de novo.", "Não foi possível pausar a conversa. Tente de novo." e "Não foi possível retomar a conversa. Tente de novo." (o retomar volta com `?erro=retomar`, código fechado, na região viva), no lugar do texto do envio | O texto do envio ("Para enviar…", "Não foi possível enviar…") num diálogo de pausa ou de liberação diz um ato que a nutricionista não fez; a pausa grava o carimbo (CH-D74), então pede o próprio texto | §6.2, RN-475, §7.2 |
| CH-D76 | **Erro ao salvar o atendimento por mensagens** (decisão do controlador na revisão da T6c, 23/11/2026, no molde da CH-D75): "Não foi possível salvar. Tente de novo.", com a configuração enviada de volta (no servidor, `try/catch` com log só de nome e SQLSTATE; no cliente, a rede caída) | Sem ele, uma falha inesperada (ou a rede caída) jogava fora a semana inteira de faixas editadas | §6.2 "Configuração" |

### 14.2 Pendências externas ★ (não travam a v1)

| ID | Pergunta | Para quem | Enquanto isso |
|---|---|---|---|
| P-CH1 | A conversa por mensagens com o paciente acompanhado é telenutrição assíncrona (760/2023, art. 2º, II) que exige TCLE e registro em prontuário? O TCLE colhido para consultas online vale para o chat? O art. 9º, VII (não gravar nem compartilhar a sessão com dados sensíveis), alcança a conversa por escrito, que fica no prontuário? A conduta que muda o plano, combinada pela conversa, deve ir também à evolução (594, art. 6º)? | CRN-3 (acrescentar à consulta já redigida) | Tratamos como telenutrição: liberação com TCLE (CH-D3); a conversa fica no prontuário; a faixa da dúvida pede retomar a pergunta na resposta |
| P-CH2 | Recado administrativo igual para vários pacientes é publicidade (599, art. 57; 856, art. 68)? Recado com orientação geral de alimentação é tele-educação (760, art. 3º, VI)? Menção a marca ou produto da loja é vedada pelos arts. 60 e 63 da 599? | CRN-3 | Ajuda do campo e limites (CH-D18) |
| P-CH3 | O texto exato e o número dos artigos da 760/2023 no DOU (o aviso do e-Nutricionista sai sem o número; em 17/11/2026 o link do DOU caiu e o .htm do CFN deu 404: as citações da revisão normativa vieram da LegisMap, compilação não oficial) | Conferência do DOU (mesma do Plano 23, AG-P3) | Texto sem o número (RN-441) |
| P-CH4 | Os textos de socorro (RN-449) | Debby (e, se possível, o psicólogo da D11 do Plano 15) | Variantes dos textos da IA Nutri |
| P-CH5 | A mensagem de texto da telenutrição assíncrona é "documento" para o art. 10, II, da 760 (assinatura eletrônica ou código verificador), ou basta a autoria registrada pelo sistema com o login da profissional? | CRN-3 | Autoria e carimbo na linha (RN-475); receita, parecer e plano só por Documentos (ajuda do anexo, RN-454) |
| P-CH6 | A Res. 594/2017, art. 8º, II, pede "no mínimo dois níveis de garantia de segurança" no prontuário eletrônico: login com sessão basta, ou a escrita no prontuário (inclusive a conversa) pede 2FA? | CRN-3 e a meta SBIS | Como o resto do prontuário: 2FA só para assinar. Fora do Plano 25 |

---

## 15. Pontos para o plano (PM)

Rascunho da v0.1 (10 tarefas). **v0.2:** o plano (`docs/superpowers/plans/2026-11-17-nutridebby-25-chat-recados.md`) refez a divisão em 12 tarefas e 4 PRs, com os revisores por tarefa; vale a do plano.

| ID | Ponto |
|---|---|
| PM-CH1 | **T1 — Banco:** esquema `mensagens.ts`, migration gerada e custom `rls_mensagens`; guardas e listas (§9.8); testes de banco (políticas, gatilhos, `REVOKE`, `EXCLUDE`, funções); `isolamento.test.ts`. Gerar de novo sobre a `main` antes do PR |
| PM-CH2 | **T2 — Liberação, pausa e configuração:** `conversa.ts` (liberar/pausar/retomar), `horario.ts`, tela de configuração e cartão do hub |
| PM-CH3 | **T3 — Envio e leitura (módulo):** `envio.ts`, `conversa.ts` (leituras com `auditRead`, marcador), `situacao`, limites e travas, `detectarRisco`; testes de integração (auditoria, limites, corrida) |
| PM-CH4 | **T4 — Painel:** caixa, conversa, nova conversa, abas, `ITEM_MENSAGENS` e contador, consulta de situação no cliente |
| PM-CH5 | **T5 — Portal:** link na faixa, `/p/mensagens`, aviso de urgência e de horário, socorro, consulta de situação |
| PM-CH6 | **T6 — Anexos:** tipos novos em `stored_files`, rotas de upload e de download, fila e job `chat-anexo`, guardas de grafo |
| PM-CH7 | **T7 — Avisos:** `notifications` (`chat_mensagem`, `recado`, `mensagem_lida`), push e e-mail ao paciente, e-mail à nutricionista, horário silencioso; testes de texto (CS-440) |
| PM-CH8 | **T8 — Dúvida pela conversa:** CHECK de `resolucao`, `responderDuvidaPelaConversa`, telas da dúvida, da ficha (IA Nutri) e do app |
| PM-CH9 | **T9 — Recados:** `recados.ts`, telas, alcance, histórico com "Lido por"; US-449 atrás do merge do 23 (Fase B) |
| PM-CH10 | **T10 — Titular, ficha e fechamento:** seção "Mensagens", exportação, anonimização, guias do manual guiado, manual técnico (caps. 02 e 05), Central de Ajuda e manual do usuário preparados, backlog |
| PM-CH11 | Revisores por tarefa: `revisor-rls` (T1, T3, T6, T8, T9), `normas-cfn-lgpd` (T2, T7, T9, T10; só CFN), `revisor-interface` (T4, T5, T9), `guardiao-manual` (T10) |
| PM-CH12 | E2E: liberar → conversar nos dois lados → foto → não lidas → dúvida pela conversa → recado → exportação. v0.2: paciente e tenant novos a cada execução (`chat_conversas` e `recados` sem DELETE no banco de dev reaproveitado); axe nos dois temas; 400 px sem rolagem lateral em `/p/mensagens`; caso sem internet |

---

## 16. Referências

- Res. CFN 760/2023 (telenutrição); Res. CFN 666/2020 (teleconsulta na pandemia, revogada pelo art. 17 da 760 segundo a LegisMap); Res. CFN 594/2017
  (prontuário); Res. CFN 599/2018 (Código de Ética e de Conduta) e Res. CFN 856/2026 (compilação não oficial, vigência
  23/01/2027) — citações como nas specs F3-02 e do Plano 23, com o DOU a conferir (P-CH3).
- Spec F3-02/F3-04 (`2026-10-03-nutridebby-paciente-exames-ia-design.md`): D9, D12, D22, D24, RN-174, RN-177, R-170.
- Spec do Plano 18: D7, D12, RN-277; spec do Plano 23: RN-404, RN-433, RN-436, AG-D36, §2.2.
- Código: `src/modules/ia/nutri-paciente/{duvidas,sinais-risco}.ts`, `src/modules/notificacoes/{mensagens,enviar}.ts`,
  `src/modules/agenda/aviso-nutri.ts`, `src/modules/plataforma/armazenamento.ts`, `src/modules/portal/diario-foto-job.ts`,
  `src/db/rls-guard.ts`, `src/db/audit-guard.ts`, `src/app/painel/navegacao.ts`, `src/app/p/navegacao.ts`,
  `src/components/portal/faixa.tsx`, `src/modules/ficha/tipos.ts`, `drizzle/0102_rls_exames_enviados.sql`,
  `drizzle/0116_rls_ia_nutri.sql`.
- `docs/operacao/sessoes-paralelas.md` (§5 e §6).
- Revisão normativa de 17/11/2026 (só CFN): Res. CFN 760/2023 pela LegisMap (https://legismap.com.br/leis-e-normas/resolucao-cfn-n-760-de-22-10-2023,
  não oficial); 599/2018, 594/2017 e 656/2020 no site do CFN; 856/2026 pela LegisWeb (não oficial). Spec de documentos
  assinados, B-01 (um consultório = uma nutricionista).

---

## 17. Revisão da spec (painel de 17/11/2026, v0.2)

Três revisões sobre a v0.1, conferidas contra o código da `main` 07756c4 neste worktree: `revisor-rls` (banco, RLS,
auditoria), `normas-cfn-lgpd` (só CFN, por ordem do dono) e `revisor-interface`. Cada achado foi conferido no código antes
de entrar. Nenhum Critical do `revisor-rls` nem do `revisor-interface`; um Critical normativo (C1).

### 17.1 O que entrou

| Revisão | Achado | Conferido em | Onde entrou |
|---|---|---|---|
| RLS I1 | CHECK "pronto ⇒ caminho" impede a anonimização com anexo | spec §9.2 × RN-466 | Estado `removido` (CH-D41); RN-445, RN-466, §9.2, §9.7 |
| RLS I2 | `app_chat_apagar_do_titular` e `app_chat_soltar_anexo` com guarda fraca | `role: 'worker'` em `agendamento-publico.ts`, `portal/acesso.ts`, `link-documento.ts`, `whatsapp/webhook.ts`; `lgpd.ts:524-526` (`anonimizar_apos < hoje`) | §9.7 (guardas, `FOR UPDATE`, marcador zerado) |
| RLS I3 | Sem rede de limpeza depois de uma volta atrás | `lgpd.ts:511` (`apagarCadastrosDosAnonimizados`), `:581-584` | RN-466, §9.9 (volta atrás), R-454 |
| RLS I4 | `Date` do JS (ms) × `criada_em` (µs) no marcador e nos cursores | spec RN-446/448/452 | CH-D40; RN-446, RN-448, RN-452, §4.1 |
| RLS I5 | O gatilho grava "liberação" que não houve | `audit.ts:49-73`, `:150-160` (`visivelNoHistorico`), `tentativa_assinatura` | CH-D39; RN-441, RN-442, RN-453, §6.2, §9.8 |
| RLS I6 | Negativos do isolamento sem prova; listas que não fecham | `test/isolamento.test.ts:189-263`, `:358-383`, `:410-440`; `rls-guard.ts:49` | CH-D38; §9.2, §9.3, §9.8 |
| RLS I7 | E-mail à nutricionista nunca sai no padrão | spec RN-458 × RN-472 | RN-458, RN-472, §9.4, §9.7 |
| RLS Minor 1 | `semConta` não negado pelo banco | `src/db/tenant.ts` (`SEM_CONTA_PERMITIDOS` é lista de módulos) | CH-D47; RN-440, §3 |
| RLS Minor 2–5, 7–13 | Ponteiro sem amarra e `UNIQUE`; download só do `pronto`; `lado` do paciente; recado só a titular ativo e `worker` recusado; aviso agrupado; travas; varredura; regra 1; `SITUACAO_DA_DUVIDA`; E2E no banco reaproveitado; detalhes (nome do parâmetro, FK `NO ACTION`, escopo `equipe`) | `ia/nutri-paciente/lgpd.ts:155`, `duvidas.ts:54`, `conversa.ts:248`, `aviso-nutri.ts:15`, `exportacao-job.ts:421` | RN-447, RN-448, RN-454, RN-455, RN-456, RN-458, RN-461, RN-462, RN-467, RN-474; §9.2, §9.3, §9.8, §9.9; PM-CH12 |
| RLS Minor 6 | Fábricas de `chat_leituras`, `chat_configuracoes`, `chat_horarios` | `test/isolamento.test.ts:392-397` (`UPDATE_DO_PACIENTE`) | §9.8 |
| CFN C1 | Mensagem e recado sem nome e CRN de quem escreveu | `tenants.nome_profissional`, `tenants.crn` (`schema/platform.ts:12,31`); `document_verifications.emissor_*` (`schema/documentos.ts:169-170`); B-01 (um consultório = uma nutricionista) | CH-D37, CH-D20 refeita; RN-441, RN-443, RN-462, RN-463, RN-467, RN-471, RN-475; US-440/441/443/448/452 |
| CFN I1 | Texto da liberação com metade do art. 9º; citação errada | spec §10 | RN-441, §6.2, §10 |
| CFN I2 | Forma "verbal" não deixa comprovante | spec RN-441 | CH-D3 refeita (`termo_assinado`, `aceite_escrito`) |
| CFN I3 | PDF da nutricionista por fora dos documentos assinados | spec RN-454 | Ajuda do anexo (RN-454, §6.2); P-CH5 |
| CFN I4 | Recado como tele-educação ou propaganda de marca | spec RN-462, §10 | Ajuda do recado (§6.2); CH-D18; §10; P-CH2 ampliada |
| CFN M1, M2, M3 | Pergunta da dúvida fora do prontuário; continuidade e gravação; citações | — | RN-460 (dica), RN-442 (pausa), P-CH1 ampliada, §10, §16 |
| UI I1 | Guias e testes que citam "Dúvidas dos pacientes" | `conteudo.ts:20,32,285-302,346-383`, `conteudo.test.ts:13,128-138`, `navegacao.test.ts:43-47`, `e2e/ia-nutri-paciente.spec.ts:118`, `e2e/acessibilidade-painel.spec.ts:310`, `e2e/sessao-equipe.spec.ts:108`, `portal.ts:17`, `e2e/painel-rotas.ts:2,12` | §4.2, §6.2 (TSX_FORA), §13; plano (T6, T7, T12) |
| UI I2 | `/p/mensagens` sem internet cai no plano | `src/app/sw.ts:36,167` | CH-D46; RN-473, US-443, R-455, RNF-448 |
| UI I3 | Recado inunda a caixa | spec RN-462 × RN-463 | CH-D42 |
| UI I4 | "Enviar mensagem" com `{id}` literal | `ficha/adicionar.ts:19` | CH-D44; §4.4 |
| UI I5, I6 | Retornos e "Nova mensagem" sem região viva persistente nem foco | `privacidade.tsx:12-15` (molde), `selo-offline.tsx` | §7 (itens 2 e 3), US-441, US-447 |
| UI I7 | Mensagem sem hora | — | §6.2, §7, US-441 |
| UI I8 | Contador do menu congela | `src/app/painel/layout.tsx:28-36` | CH-D43; RN-459 |
| UI I9 | Links com efeito de leitura e prefetch | `duvidas/page.tsx`, `adicionar.tsx` (já usam `prefetch={false}`) | RN-473, R-453 |
| UI I10 | Responder sem ver a pergunta | — | RN-460 ("Ver a pergunta", nova aba) |
| UI I11 | Risco gravado pelo grupo mostraria o texto errado | `sinais-risco.ts:38-42` | RN-449, DEP-CH2, US-443 |
| UI M1, M2, M4–M9, M11 | Diálogos, campos controlados, rodapé, horário em `<select>`, singulares e erros, selo `alerta`, marcação, `tambem`, revisores e E2E | `ui/selo.tsx`, `confirmar-botao.tsx`, `app/p/navegacao.ts:9-11` | §6.2, §7, CH-D45, CH-D48; plano |
| UI M10 (parte) | Paciente sem conta sem aviso | — | §6.2 ("até lá, o paciente não recebe aviso.") |

### 17.2 O que foi descartado ou ficou de fora, e por quê

| Revisão | Achado | Decisão | Por quê |
|---|---|---|---|
| CFN C1 ("Para o dono": três caminhos) | O CRN é do consultório, e com várias nutricionistas o carimbo identificaria a profissional errada | **Descartado** o desdobramento; o carimbo do consultório fica | Hoje um consultório = uma nutricionista: `criarContaNutri` (`plataforma/contas.ts:61-81`) cria o tenant com a única conta `nutri`, e a spec de documentos assinados já fixou isso (B-01, com a regra "se a Fase 2 trouxer mais de uma nutricionista por tenant, o perfil vira por usuário"). A recepcionista do Plano 26 não escreve na conversa (CH-D33). Se o produto passar a aceitar mais de uma nutricionista, o carimbo vira por usuária junto com o dos documentos (RN-475) |
| CFN I2 (alternativa) | Manter "verbal" e perguntar ao CRN-3 | **Descartado** | A forma verbal sai (CH-D3): o parágrafo único do art. 9º pede comprovante para enviar e guardar, e a pergunta deixaria a v1 em desacordo até a resposta |
| CFN M4 | Dois níveis de segurança (594, art. 8º, II): 2FA para escrever no prontuário | **Fora do Plano 25**; pendência P-CH6 | Vale para todo o prontuário, não só para o chat; mudar só a conversa criaria uma regra diferente para o mesmo registro. Vai ao CRN-3 e à meta SBIS |
| CFN M5 | O que está conforme | Nada a mudar | — |
| UI M3 (parte) | Andamento (%) do upload de 10 MB | **Descartado** no v1; backlog | O envio é `fetch`/Server Action, que não dá progresso de upload; trocar por `XMLHttpRequest` só para isso não vale no v1. Ficam "Enviando…", o botão desabilitado e o limite de 10 MB. O resto do M3 (303 com erro sem JS, `accept` restrito) entrou |
| UI M10 (parte) | Citar a conversa no aviso de privacidade e na confirmação de exclusão do portal | **Descartado** | O aviso de privacidade é texto legal (C-449). A confirmação de exclusão (`perfil/privacidade.tsx:10`) já diz "O prontuário clínico é guardado pelo prazo legal.", e a conversa é prontuário (CH-D2) |
| UI I8 (alternativa) | Documentar que o contador só muda ao navegar | **Descartado** | A nutricionista não tem push (CH-D10); sem a consulta de 60 s, quem fica na Agenda não vê mensagem nova (CH-D43) |
| UI I10 (alternativa) | `<details>` com a pergunta dentro da conversa (chamando `abrirDuvida`) | **Descartado** | Misturaria a leitura auditada da dúvida (entidade `ia_nutri`) com a da conversa (`chat`) no mesmo render; o link para a tela da dúvida mantém cada leitura no seu `auditRead` |
| RLS I1 (alternativa) | Tirar "pronto ⇒ caminho" do CHECK e passar ao gatilho | **Descartado** | O estado `removido` mantém o CHECK forte e deixa a exportação e a tela distinguirem "anexo apagado" de "falhou" |
| RLS I5 (alternativa) | Rótulo genérico para o gatilho na tela | **Descartado** | Fora da tela é mais limpo: o `recordAudit` do módulo já registra o ato com o rótulo certo, e a linha do gatilho continua no `audit_log` |

### 17.3 Revisão do plano (17/11/2026, v0.3)

Duas revisões sobre o plano e a spec v0.2: `revisor-rls` (sem Critical; cinco Important e onze Minor) e a crítica de
completude (seis Important, três de tamanho de tarefa, três de manual e Minor). Cada achado foi conferido no código do
worktree (`main` 07756c4) antes de entrar. O detalhe por achado, com o que foi descartado, está no plano ("Revisão do
plano"). O que mudou nesta spec:

| Achado | Conferido em | Onde entrou |
|---|---|---|
| RLS I-1 (a P2 apaga `chat_conversas`/`chat_leituras` com DELETE revogado) | `test/isolamento.test.ts:201,208,334,556,571` | §9.8 (`SEM_DELETE_DO_PACIENTE`) |
| RLS I-2 (sem linha `lado = 'paciente'` para o UPDATE da P2) | `isolamento.test.ts:187,310-314,566-569`; `src/db/tenant.ts:53-62` (`assertContext`) | §9.3, §9.8 (`PAPEL_DA_FABRICA`, gatilho só no INSERT e com `lida_ate` mudando) |
| RLS I-3 e completude I2 (gatilho sem `NEW` para o paciente e para a `recepcao`) | `isolamento.test.ts:379-383,445-464`; `drizzle/0000_base_roles_e_rls.sql:27-28` (`app_current_role()` sem validação); `0070_paciente_sem_escrita.sql` (`tenant_isolation` não olha o papel) | §9.1, §9.2 (c), §9.5 (lista fechada; papel desconhecido com falha fechada) |
| RLS I-4 (soltar `anexo_path` antes do original dá 23514) | §9.2 (CHECK), §9.7, RN-466 | RN-466, §9.7 |
| RLS I-5 (caminhos sem amarra para equipe e `worker`) | §9.2 v0.2 (gatilho só de transição) | §9.2 (f) e (g) |
| RLS Minor 3, 6, 8 e 7 (fuso, guarda de papel, `FOR NO KEY UPDATE`, travas de liberar e retomar) | `src/modules/pacientes/lgpd.ts:509,526` (`hojeNoFuso`) | §9.7, RN-447 |
| RLS Minor 2 (trava do consultório dentro de `salvarArquivo`) | `src/modules/plataforma/armazenamento.ts:176-196` | RN-447 |
| RLS Minor 1 e 11 (fábricas e semente sem gatilho) | — | §9.2 (h), §9.5, §9.8 |
| Completude I1, I3 (guardas do Plano 26) | spec do 26, §4.4, RN-507, RN-511, RN-513 | §13 |
| Completude I4 (`motivoParaIgnorar` é puro) | `src/modules/notificacoes/enviar.ts:18,48-60,266-276` | §4.2, RN-456 |
| Completude I5 (e-mail no silêncio; recado pendente engole o e-mail; helpers) | `notificacoes/agendar.ts:14-23`; `enviar.ts:200` (`segurarAtrasados` só de lembretes) | RN-456, §4.2 |
| Completude I6 (Nova conversa sem regra) | — | §4.1 |
| Completude (textos que faltavam; ajuda do portal; conflitos de `audit.ts` e `portal.ts`; nome do helper de avisos) | `nutridebby-21`/`-22` (`audit.ts`), `nutridebby-b` (`portal.ts`) | §6.2, §13, §4.2 |

Descartado aqui (detalhe no plano): a segunda parte do Minor 4 do `revisor-rls` (o JPEG do job não fica órfão quando o
gatilho recusa o `registrar`: `gravarArquivos` apaga o arquivo no erro, `armazenamento.ts:206-210`; trocar a recusa por
um UPDATE condicional é que deixaria o JPEG registrado sem mensagem).

### 17.4 Revisão da T2 (23/11/2026, v0.4)

| Achado | Onde entrou |
|---|---|
| CFN, Important: `tenants.crn` já começa com "CRN" (`CRN_REGEX`, `src/modules/plataforma/contas.ts`); "CRN {crn}" mostraria "CRN CRN-4 12345" | US-441, US-443, US-448, RN-463, RN-471, §6.2: o valor do CRN sem prefixo ("{autor_nome} · Nutricionista · {autor_crn}", "Conversa com {nome profissional}, nutricionista, {crn}", "Recado do consultório · {autor_nome} · {autor_crn}") |
| CFN (Res. CFN 760/2023, art. 9º): fragilidades do atendimento a distância e o responsável legal | RN-441 e §6.2 "Liberação" |
| CH-D73 (não prometer prazo de leitura) | US-443, §6.2 "Portal: conversa" e "Portal: ajuda", §14.1 |
| CH-D74 (nome e CRN na liberação e na pausa) | §9.1, §14.1 |
| CH-D75 (textos de erro próprios de cada ato da conversa; o da pausa sem carimbo) — revisão da T6b | §6.2 "Liberação" e "Pausa", RN-475, §7.2, §14.1 |
| CH-D76 (erro ao salvar o atendimento por mensagens) — revisão da T6c | §6.2 "Configuração", §14.1 |
