# NutriDebby — Agenda 2 (Plano 23) — Design

| Item | Valor |
|---|---|
| Versão | 0.3 (17/11/2026: painel de revisão da spec aplicado, §18; revisão do plano, §18.1) |
| Data | 2026-11-17 |
| Situação | **Rascunho — revisado por lentes; decisões delegadas pelo dono (onda 2).** O dono autorizou seguir as recomendações sem parar para perguntar (briefing da onda 2): cada decisão de produto está na §14 como "AG-Dn — decisão — porquê". A proposta 0.1 passou pela lente de normas (CFN, LGPD, WhatsApp, 17/11/2026) e por uma crítica adversarial de completude; o que entrou e o que não entrou está na §17. A 0.2 aplica o painel de revisão da spec (revisor-rls, normas-cfn-lgpd, revisor-interface e crítico de completude, 17/11/2026): §18. Falta a revisão do plano. Conferida contra a `main` 6c3ee8f (Planos 01–17, 18 PR 1 e 20 PR 1) |
| Itens do backlog | Paridade Dietbox, onda 2, Sessão C: **PD-70** (vários locais de atendimento), **PD-71** (visões dia, semana, mês e lista; agenda em PDF), **PD-72** (previsão de retorno, filtros e legenda), **PD-73** (aniversariantes com mensagem), **PD-74** (fila de solicitações do agendamento online). **PD-75** (Google Agenda) fica para a onda 4 (Plano 29) |
| Quando | **Plano 23**, em paralelo com os Planos 21 (`nutridebby-21`) e 22 (`nutridebby-22`) da onda 2, e depois dos Planos 18 PR 2 (`nutridebby-18`), 19 (`nutridebby-b`) e 20 PR 2 (`nutridebby-c`) da onda 1, ainda abertos. Regras de convivência em `docs/operacao/sessoes-paralelas.md` |
| Insumos | `.sessoes/onda2-briefing.md` (seção do Plano 23); levantamento do código (função a função e conflitos); lente de normas (CFN, LGPD, Termos do WhatsApp, conferida em 17/11/2026); proposta 0.1 e a crítica dela. Referência funcional: a agenda do Dietbox. **Copiamos a função, nunca a marca, os textos ou o layout** |
| Documentos de base | [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md) (US-030 a US-037, RN-03 a RN-09, RN-16), plano do Plano 05 (`docs/superpowers/plans/2026-10-01-nutridebby-05-agenda-lembretes.md`, D9 a D21), [`2026-11-16-nutridebby-18-ficha-cadastro-design.md`](2026-11-16-nutridebby-18-ficha-cadastro-design.md) (D7, D11, D12, D14, RN-272, RN-277), [`2026-11-16-nutridebby-20-financeiro-design.md`](2026-11-16-nutridebby-20-financeiro-design.md) (formato desta spec; RN-308, RN-318, RN-321, C-303, F-D26) e o manual técnico, caps. [02](../../manual-tecnico/02-banco-de-dados.md) e [05](../../manual-tecnico/05-agenda-portal-conteudo.md) |
| Numeração nova | US-400 a US-416 · RN-400 a RN-439 (mais RN-410a, RN-424a e RN-427a, da revisão) · RNF-400 a RNF-407 · CS-400 a CS-405 · C-400 a C-410 · R-400 a R-414 · DEP-A1 a DEP-A8 · PM-A1 a PM-A14 · **AG-D1 a AG-D45** (decisões deste documento; fora dele, cite "Plano 23, AG-Dn"). O bloco **400–439** é do Plano 23: o 230–259 é do Plano 19, o 260–284 do Plano 18, o 300–329 do Plano 20 e o 330–399 fica para os Planos 21 e 22, escritos ao mesmo tempo (conferido com `grep -rhoE '\b(US\|RN)-[2-4][0-9]{2}\b'` nos worktrees e nas propostas da onda 2 em 17/11/2026). A proposta do Plano 22 usa RN-340 a RN-369, que colide com a do 21: aviso à orquestradora (§13) |

---

## 1. Visão

Hoje a agenda tem uma "sede" só: um endereço e um link padrão no consultório (`tenants.endereco_consultorio` e
`link_online_padrao`, `src/db/schema/platform.ts:18-19`), e a consulta guarda só a modalidade. As visões são Dia, Semana e
Lista, em colunas de cartões, sem grade de horas (`src/app/painel/agenda/page.tsx:13-66`). O paciente marca **direto**
pelo portal e pela página pública (`agendamento-paciente.ts:79`, `agendamento-publico.ts`, `concluir`). Não há previsão de
retorno, aniversariantes nem impressão da agenda.

O Plano 23 entrega:

1. **Locais de atendimento (PD-70).** Cadastro de locais presenciais (com endereço) e de videoconferência (link
   externo), com um local principal. Cada consulta e cada horário de atendimento têm o seu local. O local é filtro na
   agenda e, na Fase B, na lista de pacientes e no Financeiro (Lançamentos e "Entradas e saídas"). A página pública e o
   portal deixam a pessoa escolher o local. A tabela de locais (com o link da sala) fica fechada no banco: o público e o
   portal só leem uma projeção sem o link; o paciente vê o link só na própria consulta online, como hoje (AG-D4).
2. **Visões (PD-71).** Dia e Semana em grade de horas, **Mês** (novo), Lista, "Hoje", "Ir para data", "Mostrar 24 horas"
   e "Imprimir ou salvar em PDF" (impressão do navegador, sem arquivo no servidor).
3. **Filtros e legenda (PD-72).** Filtros por local, por paciente, "Previsões de retorno" e "Aniversários". Legenda em
   texto, nunca só em cor: Primeira consulta, Retorno, Pedido a responder, Presença a registrar, Previsão de retorno,
   Aniversário e Bloqueio. A previsão de retorno nasce no registro do atendimento.
4. **Aniversariantes (PD-73).** Lista do mês com "Selecionar todos" e "Enviar mensagem" **por e-mail**, só para quem
   autorizou mensagens de aniversário. Sem WhatsApp automático; há um "Abrir no WhatsApp" manual, paciente por paciente.
5. **Solicitações (PD-74).** Uma chave opcional, "Confirmar os pedidos antes de marcar". Ligada, o pedido do portal ou
   da página pública espera o aceite da nutricionista na fila "Solicitações" (Aceitar ou Recusar). O pedido de quem já é
   paciente segura o horário; a pessoa nova só ganha cadastro no aceite.

O que **não** muda: uma agenda por consultório (a nutricionista não atende em dois lugares ao mesmo tempo), os lembretes
(RN-05), a cota do WhatsApp (US-036), o fluxo de código por e-mail da página pública (RN-16), a remarcação direta de
consulta já marcada (RN-04) e, com a chave desligada (padrão), todo o agendamento de hoje.

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-400 | Com dois locais (presencial e videoconferência) e horários por local, o portal e a página pública (quando ligada no Perfil) só oferecem horários livres de locais com "Aceita agendamento pelo paciente" (AG-D40); o portal **continua** oferecendo horários com a página pública desligada; e **nunca** há duas consultas no mesmo horário em locais diferentes | E2E + teste de integração com o `EXCLUDE` (corrida de dois pedidos em locais diferentes no mesmo horário) + teste de migration "página pública desligada, portal com horários" |
| CS-401 | `locais_atendimento` (com o link da sala) **nunca** é lida pelo contexto `publico` nem pelo `paciente`; o link nunca aparece na página pública, no WhatsApp, no push ou na impressão; o paciente vê o link só na própria consulta online (`appointments.link_online`, "Sua consulta"), como hoje. A cópia em `appointments.link_online` tem a proteção de hoje: lista de colunas no código (AG-D4) | Teste de banco (`staff_only` nega a linha ao `paciente` e `publico_negado` ao `publico`; as funções de projeção não têm a coluna); testes de `textoWhatsapp`/`pushDaNotificacao` (o push não leva nome nem endereço do local); teste das chaves de `horariosLivres` e de `resolver()` em `acoes-link.ts` (sem `link_online`) e guarda de grep contra `select()` sem colunas em `appointments` no contexto `publico`; teste do HTML da impressão |
| CS-402 | A visão Mês com 300 pacientes ativos e os marcadores de aniversário e de retorno ligados abre com p95 ≤ 800 ms (RNF-01) | Pilha de carga (P08-03); uma consulta agregada por mês para cada marcador |
| CS-403 | Com a chave ligada, nenhum pedido vira consulta marcada sem o aceite, nenhum pedido de pessoa nova cria cadastro antes do aceite, e a remarcação de consulta já marcada continua direta | Testes do módulo e do gatilho `appointments_regras_pedido`; E2E aceitar, recusar, pessoa nova e remarcar |
| CS-404 | Zero mensagem de aniversário para paciente sem autorização vigente, menor de 18 anos, bloqueado, arquivado ou anonimizado; no máximo uma por paciente por ano | Testes de elegibilidade (na hora de marcar e de novo no envio) + índice único |
| CS-405 | A Debby usa a visão Semana em grade e a impressão por 2 semanas sem voltar ao Dietbox para ver a agenda | Conferência com a Debby, registrada no runbook do fechamento |

### 1.2 Premissas e restrições

| # | Premissa / restrição | Origem |
|---|---|---|
| C-400 | **Uma agenda por consultório.** O `EXCLUDE appointments_sem_sobreposicao` continua por `tenant_id` (0051) | RN-03, Plano 05 D9; AG-D8 |
| C-401 | **Nenhuma coluna nova em `patients`** (`PUBLICO_LIBERADO`, gatilho `paciente_colunas` refeito na 0119 do Plano 17) nem em `fin_lancamentos` (colunas fixas, RN-308 do Plano 20) | Levantamento; normas §3; AG-D11, AG-D12 |
| C-402 | **Não editar `src/modules/agenda/fuso.ts`.** Helpers novos de calendário em `src/modules/agenda/calendario.ts` | Global Constraints dos Planos 19 e 20 |
| C-403 | **Sem fila nova no worker e sem mudar `src/worker/index.ts`** (disputado com o Plano 19, como `src/jobs/queues.ts`). O vencimento dos pedidos roda no começo de `processarNotificacoes` (`notificacoes/enviar.ts`), antes da varredura: no job de minuto e nos envios avulsos com `tenantId` (`dispararEnvio`), respeitando o `tenantId` quando vier; as mensagens saem pela mesma varredura | AG-D19, AG-D37 |
| C-404 | **Sem arquivo novo e sem PDF no servidor.** A impressão é do navegador (regra 9 intacta: nenhum tipo novo em `stored_files`) | AG-D15 |
| C-405 | **Nada novo por WhatsApp.** Nenhum tipo novo entra em `CONTA_COTA` (`notificacoes/whatsapp/cota.ts:11`); aniversário só por e-mail; aviso de pedido por e-mail e push | INT-01 da spec do MVP (só transacional), Termos do WhatsApp; normas §1; AG-D20, AG-D31 |
| C-406 | **Migrations sem número reservado**, geradas de novo sobre a `main` antes do PR (`sessoes-paralelas.md` §5). Uma gerada + uma custom, só no PR 1. Colunas novas anuláveis ou com default (a imagem anterior continua de pé) | §5; AG-D38 |
| C-407 | **Datas no fuso do consultório** (`tenants.fuso`, `hojeNoFuso`); "mês" e "semana" saem de `calendario.ts` | MVP RN-06 |
| C-408 | **Nome na agenda e na impressão = nome de registro** (Plano 18 D7). Exceção só na saudação de aniversário (AG-D35) | Plano 18 D7 |
| C-409 | **Só a sessão `nutri`** usa a agenda do painel. Não há recepcionista (`user.app_role` ∈ admin, nutri, paciente); o admin nunca consulta tabelas com `tenant_id` | Regra 1 do CLAUDE.md |
| C-410 | **Texto legal não muda neste plano** (termo do paciente, DPA). O que o Termo 1.0 não cobre é informado na tela, no ponto de coleta; o termo 1.1 vai pela orquestradora, um texto legal por vez (o 20 PR 2 está publicando o DPA 1.1) | Normas §1 e §7; §13 |

### 1.3 Dependências (conferidas no código em 17/11/2026, `main` 6c3ee8f)

| ID | Depende de | O que esta spec usa | Situação e arquivo |
|---|---|---|---|
| DEP-A1 | **Agenda (Plano 05)** | Consulta, regras, bloqueios, horários livres | ✅ `appointments` (`src/db/schema/agenda.ts:52-97`): status `agendada`, `confirmada`, `cancelada`, `realizada`, `faltou` (CHECK `appointments_status_valido`, :83), `origem` `nutri`/`paciente`, `remarcada_de`, CHECK `appointments_link_online` (:79-82: online ⇒ link `https` não nulo). `availability_rules` (:7-27) com `modalidade` `presencial`/`online`/`ambas`, sem local. `MAX_REGRAS` = 30 (`constantes.ts:7`). `STATUS_ATIVOS = ['agendada','confirmada']` (`consultas.ts:51`). `gerarHorarios` (`horarios.ts:34`) tira o online quando não há link padrão |
| DEP-A2 | **Página pública e portal** | Pedido do paciente | ✅ `gravarConsultaDoPaciente` grava `agendada` + lembretes + aviso à nutri (`agendamento-paciente.ts:63-89`); a remarcação pelo paciente cancela a antiga e insere outra com `remarcada_de` (`cancelamento.ts:169-172`). `public_booking_requests` (`agenda.ts:173-203`) vive 24 h, `staff_only` + `app_allow_publico('select','insert','update')` (`drizzle/0056_rls_agendamento_publico.sql:6`) — o `publico` lê todas as linhas do tenant. `travarEmail` (`agendamento-publico.ts:78`, trava consultiva por tenant e e-mail). Teto de 3 futuras (`MAX_CONSULTAS_FUTURAS_PUBLICO`, `constantes.ts:11`) |
| DEP-A3 | **Notificações** | Avisos e aniversário | ✅ `notifications.patient_id` **NOT NULL** (`agenda.ts:127`), CHECK fechado de `tipo` (`:147`, 16 tipos), `notifications_versao_da_consulta` (consulta e início juntos ou nulos). `motivoParaIgnorar` (`enviar.ts:48-60`). `pushDaNotificacao` sem consulta exige aviso do portal com tela (`mensagens.ts:132-138`). Job `notificacoes` a cada minuto (`worker/index.ts:108-111`); `agenda-limpeza` às 04:30 (`:133`). `enqueueEmail` (`src/email/queue.ts:14`) com modelos em `src/email/types.ts` (`codigo_agendamento`, :24) |
| DEP-A4 | **`tenants`** | Chave dos pedidos, CRN | ✅ sem RLS; `crn` (`platform.ts:12`), `antecedencia_min_h` e `cancelamento_min_h` (:16-17), `agendamento_publico_ativo` (:21). Único bloqueio de coluna por papel: `tenants_ia_nutri_da_equipe` (`drizzle/0116_rls_ia_nutri.sql:187-199`) |
| DEP-A5 | **Atendimento** | Previsão de retorno; recusa de pedido | ✅ `registrarAtendimento` com consulta ligada grava `realizada` (`atendimentos.ts:81-83`) depois de `motivoParaNaoIniciarAtendimento` (`presenca.ts:128`), que hoje só recusa `cancelada` e "não começou". `consultations` auditada (entidade `atendimentos`, `0028`) |
| DEP-A6 | **Registro de seções da ficha (Plano 18 PR 1)** | Seção "Consultas" no Início | ✅ `src/modules/ficha/tipos.ts` (`SecaoDaFicha` com `verTodos` absoluto em `/painel/`, `resumo`, sem `auditRead` no arquivo da seção) e `secoes/index.ts` |
| DEP-A7 | **Lista de pacientes extensível (Plano 18 PR 2)** | Filtro "Local" (US-415) | ⬜ só no branch `plano-18-pr2` (2061d0c em 17/11/2026; reconferir na T1 e na T11): `FiltroDaLista` com ponto de extensão (`nutridebby-18/src/modules/pacientes/pacientes.ts:242-251`) e `patient_cadastro` (0124/0125 do branch). Só a US-415 e o recuo da AG-D35 esperam o merge |
| DEP-A8 | **Telas do Financeiro (Plano 20 PR 2)** | Filtro "Local" (US-416) | ⬜ só no branch `plano-20-financeiro` (c9ade41 em 17/11/2026; reconferir na T1 e na T11): `src/modules/financeiro/*`, Lançamentos, Relatórios, CSV, "Cobrança" em `consultas/[id]` e `registrarPresenca` devolvendo `{ cobranca }`. Só a US-416 espera o merge |

---

## 2. Escopo

### 2.1 Dentro

| ID | Bloco | Conteúdo | PD |
|---|---|---|---|
| AG-01 | **Locais** (`/painel/agenda/locais`) | Criar, editar, definir como principal, arquivar e reativar; excluir só sem uso; tipo presencial (endereço, cidade, "Mostrar o endereço na página de agendamento") ou videoconferência (sala fixa opcional, com aviso de telenutrição); "Aceita agendamento pelo paciente" | PD-70 |
| AG-02 | **Local na consulta e nos horários (painel)** | Seletor de local em Nova consulta, Alterar e no detalhe; regras de horário por local, com "Também atender por videoconferência nestes horários"; `gerarHorarios` por local | PD-70 |
| AG-03 | **Local fora do painel** | Página pública e portal escolhem o local (no lugar de "Presencial/Online"); CRN no cabeçalho; endereço só se marcado; endereço do local nos lembretes, no link da consulta e no portal; nome do local na exportação | PD-70 |
| AG-04 | **Visões** | Dia e Semana em grade de horas; Mês; Lista; "Hoje", anterior e próximo; "Ir para data"; "Mostrar 24 horas"; no celular, Semana e Mês viram lista por dia | PD-71 |
| AG-05 | **Impressão** (`/painel/agenda/imprimir`) | "Imprimir ou salvar em PDF" do período e do filtro atuais, com campos mínimos e um registro `exportar` sem paciente | PD-71 |
| AG-06 | **Filtros e legenda** | Local, paciente, "Previsões de retorno", "Aniversários"; legenda em texto | PD-72 |
| AG-07 | **Previsão de retorno** | Campo "Retorno previsto" no atendimento; marcador na agenda com "Marcar consulta"; seção "Consultas" no Início da ficha | PD-72 |
| AG-08 | **Aniversariantes** (`/painel/agenda/aniversariantes`) | Lista do mês; autorização de mensagens de aniversário (pela nutricionista, pelo paciente no portal, retirada pelo link do e-mail); "Selecionar todos" e "Enviar mensagem" por e-mail; "Abrir no WhatsApp" manual | PD-73 |
| AG-09 | **Solicitações** (`/painel/agenda/solicitacoes`) | Chave "Confirmar os pedidos antes de marcar"; pedido do portal e da página pública; Aceitar e Recusar; vencimento; contador no Início e nas abas da agenda; "Aguardando confirmação da nutricionista" e "Desistir do pedido" no portal; desistência da pessoa nova pelo link do e-mail | PD-74 |
| AG-10 | **Fase B — filtro de local fora da agenda** | Lista de pacientes (derivado das consultas) e Financeiro (Lançamentos, CSV e "Entradas e saídas nos últimos 12 meses", derivado de `appointment_id`) | PD-70 |
| AG-11 | **LGPD, manuais e ajuda** | Nome do local e previsão de retorno no `dados.json`; autorizações de aniversário na exportação e na anonimização; guia `agenda` com os passos novos; manual técnico cap. 05 e cap. 02; Central de Ajuda e manual do usuário preparados | — |

### 2.2 Fora

| Item | Por quê |
|---|---|
| Google Agenda (PD-75), filtro e legenda "Google Agenda" | Onda 4 (Plano 29), pelo briefing |
| Videochamada embutida (Jitsi, Daily e outros) | Suboperador novo: aviso de 15 dias (DPA, cl. 10), custo e termo novo (normas §4). O link externo basta (AG-D2) |
| WhatsApp automático de aniversário (lote) e push de aniversário | INT-01, Termos do WhatsApp ("bulk messaging, auto-messaging"), risco de bloqueio do número que leva os lembretes, cota RN-09 (AG-D31). O push não tem para onde levar: o portal não tem caixa de mensagens |
| Texto livre na mensagem de aniversário | Risco de dado de saúde, oferta (Res. CFN 599/2018, art. 57) ou NUL; texto fixo na v1 (AG-D33) |
| Mensagem a outros grupos (campanhas, "Selecionar todos" fora dos aniversariantes) | Finalidade nova sem base; fora do PD-73 |
| **Registro do TCLE de telenutrição** por paciente (data, forma, arquivo) e aviso ao marcar consulta online sem TCLE | Não está no briefing; sem o comprovante guardado não atende o art. 9º, parágrafo único, da Res. CFN 760/2023; espera o texto do E-09 (P-B3). Backlog "Telenutrição" (AG-D36). Fica só o aviso no local de videoconferência |
| Compromisso sem paciente ("Outros" do Dietbox além dos bloqueios) | `appointments.patient_id` é NOT NULL; os bloqueios cobrem férias e congressos (AG-D27). Backlog |
| "Local preferido" gravado no paciente | O filtro derivado das consultas basta (AG-D11); se o dono quiser, vai ao `patient_cadastro` depois. Backlog |
| Atendimento domiciliar (local por paciente) | Local com nome ou endereço de paciente seria dado pessoal numa tabela sem anonimização (AG-D39). Backlog |
| Antecedência e prazo de cancelamento por local | Continuam por consultório (AG-D10) |
| Indicadores da agenda por local e "Relatórios gerais" de agenda | YAGNI; backlog |
| Divisão do saldo, do Resumo e do Fluxo de caixa por local | O saldo é do caixa (AG-D12) |
| Selo "Pagamento pendente" na agenda | O dinheiro é do Plano 20 (RN-318 de lá audita o financeiro de um paciente; F-D26); "Pendências" = presença (AG-D26) |
| PDF gerado no servidor | Regra 9; um PDF com vários pacientes não seria anonimizado com o titular (normas §5; AG-D15) |
| Preço da consulta na página pública | Res. CFN 599, art. 57 × 856, art. 68: vai ao CRN-3 (normas §6) |
| Termo do paciente 1.1 (aniversário e pedidos aguardando) | Texto com o advogado (E-09); a tela informa no ponto de coleta enquanto isso (C-410) |
| Item ou contador novo no menu do painel | `navegacao.ts` disputado com o 20 PR 2; contador no Início e nas abas da agenda (AG-D37) |

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** (sessão `nutri`) | Tudo da agenda: locais, horários por local, visões, filtros, impressão, chave e resposta aos pedidos, previsão de retorno, aniversariantes (registrar e retirar autorização declarada, enviar, abrir no WhatsApp); na Fase B, filtros de local na lista de pacientes e no Financeiro | Excluir local com histórico (só arquivar); mudar o tipo de um local usado; enviar aniversário a quem não autorizou, a menor, a bloqueado, a arquivado ou a anonimizado; texto livre de aniversário; alterar um pedido (só aceitar ou recusar) |
| **Paciente com conta** (sessão `paciente`) | Ver os locais com agendamento online (nome, cidade, endereço se marcado) e o local das próprias consultas; pedir horário (marcado direto ou como pedido, conforme a chave); ver "Aguardando confirmação da nutricionista"; desistir do próprio pedido; remarcar consulta já marcada (direto); autorizar ou retirar mensagens de aniversário no Perfil | Ler `locais_atendimento` (só pelas funções de projeção); ver o link da sala fora da própria consulta online; ver outros pacientes, ocupação, regras ou bloqueios; passar um pedido para marcado; ver a previsão de retorno (AG-D28); mudar a chave |
| **Paciente sem conta** (link assinado, `semConta`) | As ações de hoje do link da consulta; retirar a autorização de aniversário pelo link do e-mail | Qualquer outra escrita |
| **Público** (`/n/<slug>`) | Ver locais com agendamento pelo paciente (projeção) e horários livres; pedir horário; desistir do próprio pedido aguardando pelo link do e-mail (AG-D42) | Ver link, ocupação, motivo de bloqueio, local arquivado, nome de paciente, preço, pedidos aguardando; descobrir se um e-mail já é paciente |
| **Worker** | Vencer pedidos e avisar; limpar pedidos de pessoa nova; enviar mensagens; exportar e anonimizar | Criar consulta; mudar a chave |
| **Admin** | Métricas agregadas (funções SQL da 0059 e da 0087, refeitas sem contar `solicitada`) | Consultar as tabelas da agenda |

---

## 4. Arquitetura

### 4.1 Rotas e navegação

| Tela | Rota | Título (h1) | Nova? |
|---|---|---|---|
| Agenda | `/painel/agenda?visao=dia\|semana\|mes\|lista&data=AAAA-MM-DD&local=<id>&paciente=<id>&horas=24&retorno=1&aniversario=1` (formulário GET, funciona sem JS; um parâmetro por marcador) | "Agenda" | Muda |
| Impressão | `/painel/agenda/imprimir?…` (mesmos parâmetros); link com `prefetch={false}`; "Imprimir ou salvar em PDF" e "Voltar à agenda", ambos `print:hidden` | "Agenda de {período}" | Nova |
| Locais | `/painel/agenda/locais` (`?arquivados=1`) | "Locais de atendimento" | Nova |
| Horários | `/painel/agenda/horarios` (agrupados por local; a chave "Confirmar os pedidos antes de marcar" fica aqui) | "Horários de atendimento" | Muda |
| Solicitações | `/painel/agenda/solicitacoes` (`?ok=aceito\|recusado`, depois das ações) | "Solicitações" | Nova |
| Aniversariantes | `/painel/agenda/aniversariantes?mes=AAAA-MM` | "Aniversariantes de {mês}" | Nova |
| Nova consulta, consulta | `/painel/agenda/nova`, `/painel/agenda/consultas/[id]` (seletor de local; Aceitar e Recusar no pedido) | como hoje | Muda |
| Início do painel | `/painel` (cartões "Solicitações ({n})" e "Aniversariantes de hoje ({n})", só quando há) | como hoje | Muda |
| Hub de configurações | `/painel/configuracoes` (cartão "Locais de atendimento" no **fim** de `CARTOES`) | como hoje | Muda (só acrescentar) |
| Perfil e marca | `/painel/configuracoes/perfil` ("Endereço profissional (documentos)"; o link padrão sai da tela com o aviso de onde ficou) | como hoje | Muda |
| Pacientes (Fase B) | `/painel/pacientes?local=<id>` | como hoje | Muda |
| Financeiro (Fase B) | `/painel/financeiro/lancamentos?local=<id>`, `/painel/financeiro/relatorios?local=<id>`, CSV com `local` | como hoje | Muda |
| Página pública | `/n/<slug>?local=<id>` (a escolha só aparece com mais de um local com agendamento online) | como hoje | Muda |
| Portal | `/p/agenda/nova?local=<id>`, `/p/agenda` (`?ok=pedido-cancelado`), `/p/agenda/[id]` ("Aguardando confirmação da nutricionista", "Desistir do pedido"; a remarcação escolhe o local) | como hoje | Muda |
| Portal: Perfil | `/p/perfil` ("Receber mensagem de aniversário da sua nutricionista") | como hoje | Muda |
| Saída do aniversário | `/aniversario/sair/[token]` (página: GET mostra e não grava; o botão "Confirmar" faz POST para o handler abaixo; sem login) | "Mensagens de aniversário" | Nova |
| Saída de um clique | `/api/aniversario/sair/[token]` (`route.ts`: POST da RFC 8058, URL do `List-Unsubscribe`; RN-434) | — | Nova |
| Desistir do pedido (pessoa nova) | `/n/<slug>/pedido/[token]` (GET mostra; POST grava `resolvido_em`; token próprio do pedido, sem login; AG-D42) | "Seu pedido de consulta" | Nova |

- **Menu do painel** (`navegacao.ts`): **sem mudança** (AG-D37).
- **Abas da agenda** (links com `aria-current="page"`, não `role=tablist`, como a navegação do Financeiro): "Agenda ·
  Solicitações ({n}) · Aniversariantes · Pendências · Horários · Locais". "Solicitações" só aparece com a chave ligada
  ou com pedido pendente. Ficam num componente (`AbasDaAgenda`) usado **só** nessas seis telas, nunca num `layout.tsx`
  de `/painel/agenda` (Nova consulta, a consulta e a impressão não têm abas); o contador é um `count` só, na transação da
  tela.
- **Links e formulários da agenda** (I-05): uma função só, `hrefDaAgenda({ visao, data, local, paciente, horas, retorno,
  aniversario })`, monta todos os links (Dia/Semana/Mês/Lista, Hoje, Anterior, Próximo, dia do Mês, marcadores, impressão);
  os dois formulários GET ("Filtrar" e "Ir para data") levam os outros parâmetros em campos `hidden`. O parser aceita
  `string | string[]` (o `searchParams` do Next). Teste: "Próximo" e "Ir para a data" preservam o filtro.
- **Local no portal e na página pública** (I-13): cada horário vem com `localId`; a escolha do local filtra no cliente,
  como o rádio de modalidade de hoje (`SeletorHorarios`), e `?local=` é só o valor inicial: nada do formulário se perde.
  `temOnline` (link padrão do tenant) sai das três telas (`/n/[slug]`, `/p/agenda/nova`, remarcação) e dá lugar a
  `locais`. A remarcação (portal e link `/consulta/[token]`) abre com o local da consulta e deixa trocar por outro local
  com horário. Os rádios de local são `<label>` de bloco com `min-h-11`, "Nome · Cidade" e o endereço só com
  `mostrar_endereco`.

### 4.2 Módulos

Todas as funções com `withTenant(ctx, …)` e `ctx` com `actorUserId` e `ip`. As funções do painel conferem
`ctx.role === 'nutri'` antes de abrir a transação (RN-400).

| Arquivo | Papel |
|---|---|
| `src/modules/agenda/locais.ts` (novo) | CRUD de locais (sessão `nutri`); `garantirLocaisIniciais(tx)` (AG-D45); `locaisParaAgendamento(tx)` e `localDaConsulta(tx, id)`, que no `publico` e no `paciente` só chamam as funções SQL de projeção (§9.1); `localPrincipal`; `linkSugerido(local)` |
| `src/modules/agenda/status.ts` (novo) | Puro, sem banco: `STATUS_OCUPA`, `ROTULO_STATUS`, rótulos de pedido (AG-D43, AG-D44); importado pela seção "Consultas" da ficha |
| `src/modules/agenda/calendario.ts` (novo) | Puro, sem banco: grade do mês a partir da segunda (`segundaDaSemana`), faixa de horas do dia (RN-412), validação do "Ir para data" (por `dataDaAgendaOuHoje`) |
| `src/modules/agenda/visoes.ts` (novo) | `agendaDoPeriodo(ctx, { de, ate, local, paciente, marcadores })`: consultas, bloqueios e marcadores, uma consulta por tipo no período; classificação Primeira consulta/Retorno numa consulta agregada (RN-416) e selos |
| `src/modules/agenda/solicitacoes.ts` (novo) | `listarSolicitacoes`, `contarSolicitacoes`, `aceitarSolicitacao`, `recusarSolicitacao`, `desistirDoPedido` (portal), `desistirDoPedidoPublico` (link do e-mail, AG-D42), `vencerSolicitacoes` (chamada por `processarNotificacoes`) |
| `src/modules/agenda/aniversarios.ts` (novo) | `aniversariantesDoMes`, `elegivel`, `enviarMensagensDeAniversario` (cria `notifications`), `registrarAutorizacao`, `retirarAutorizacao`, `estadoDoLinkDeSaida`, `retirarPeloLink` |
| `src/modules/agenda/retorno.ts` (novo) | `previsoesDeRetorno(tx, de, ate, filtro)` (RN-430) |
| `src/modules/agenda/impressao.ts` (novo) | Linhas da impressão por lista fechada de campos (RN-418) e o `recordAudit` `exportar` (RN-419) |
| `src/modules/ficha/secoes/consultas.ts` (novo) | Seção "Consultas" do Início da ficha (§4.4); **uma linha no fim** de `SECOES_DA_FICHA` |
| Mudam | `consultas.ts` (`local_id`, `StatusConsulta` + `solicitada`, `STATUS_OCUPA` novo), `disponibilidade.ts` (regra com local, par de videoconferência, `MAX_REGRAS` 60), `horarios.ts` (gera por local), `agendamento-paciente.ts`, `agendamento-publico.ts` (local, pedido aguardando, `aceitarPedidoPublico`, limpeza nova), `acoes-link.ts`, `cancelamento.ts`, `presenca.ts`, `inicio.ts`, `constantes.ts` (`MSG_AGENDA`, `MSG_PUBLICO`, `MSG_LOCAIS`, `MSG_SOLICITACOES`, `MSG_ANIVERSARIO`), `aviso-nutri.ts` (eventos "pedido" e "pedido_desistido"), `notificacoes/{tipos,mensagens,enviar}.ts` (`processarNotificacoes` chama `vencerSolicitacoes`), `src/email/types.ts`, `src/email/templates.tsx` (pedido de pessoa nova, aniversário) e `src/email/transport.ts` (`headers?` repassado ao Resend e ao Mailpit, RN-434), `portal/agenda.ts`, `src/app/p/(portal)/agenda/page.tsx` e `src/app/consulta/[token]/page.tsx` (mapas de situação), `ajuda/conteudo.ts` e `ajuda/portal.ts` (guias), `portal/jornada.ts`, `portal/mural.ts`, `pacientes/atendimentos.ts` (retorno previsto), `pacientes/exportacao-job.ts`, `pacientes/lgpd.ts`, `plataforma/metricas-sucesso.ts`, `src/db/tenant.ts` (`SEM_CONTA_PERMITIDOS` + `aniversarios.ts`) |

### 4.3 Onde o status `solicitada` entra (lista fechada)

`STATUS_ATIVOS` continua `['agendada', 'confirmada']` ("consulta marcada"). Entra
`STATUS_OCUPA = [...STATUS_ATIVOS, 'solicitada']` ("segura o horário e conta no teto"). `StatusConsulta` ganha o membro:
os `Record<StatusConsulta, …>` e os `switch` exaustivos quebram o typecheck até cada ponto ser tratado. Um teste de grep
falha se aparecer `<> 'cancelada'`, `!== 'cancelada'`, `inArray(appointments.status` ou `status === '` novo em
`src/modules` ou `src/app` fora dos pontos abaixo (R-400). Todo mapa de rótulo indexado por status (`SITUACAO`, `ROTULO_*`)
passa a ser `Record<StatusConsulta, …>` (hoje o do portal é `Record<string,string>` e escaparia do typecheck); o grep também
falha num `Record<string` com a chave `agendada:` (I-03).

| Ponto | `solicitada` | Arquivo |
|---|---|---|
| `EXCLUDE` e horários livres (`status <> 'cancelada'`) | **Ocupa** (sem mudança de código) | 0051; `consultas.ts:100,308` |
| Teto de 3 futuras (portal e página pública) | **Conta** (`STATUS_OCUPA`) | `agendamento-paciente.ts:124`; `agendamento-publico.ts:223` |
| Cancelar futuras na exclusão LGPD | **Cancela** (`STATUS_OCUPA`), com `cancelado_por = 'sistema'` na sessão `nutri`, depois do titular `bloqueado` (RN-422) | `cancelamento.ts:127,134`; `lgpd.ts:157` |
| Lembretes (`agendarLembretes`) | **Não** (só no aceite) | `agendamento-paciente.ts` |
| Reativar lembretes depois da suspensão do tenant | Não (lista literal já exclui) | `notificacoes/agendar.ts:234` |
| Resposta "1"/"2" do WhatsApp | Não (lista literal já exclui) | `notificacoes/whatsapp/webhook.ts:230` |
| `motivoParaIgnorar` | Lembrete, `consulta_marcada` e respostas de consulta `solicitada` → `ignorada` (`consulta_nao_aceita`); `pedido_nao_confirmado` só sai com a consulta `cancelada` | `notificacoes/enviar.ts:48-60` |
| Alterar pela nutricionista (`moverConsulta`) | Não: aceitar ou recusar antes (`MSG_AGENDA.naoAlteravel`) | `consultas.ts:186` |
| Presença | **Não** (recusa; a cobrança do 20 só nasce em `realizada`) | `presenca.ts:31-38` |
| Registrar atendimento ligado à consulta | **Não**: `motivoParaNaoIniciarAtendimento` devolve `'pedido'` → "Aceite o pedido antes de registrar o atendimento." | `presenca.ts:128`; `atendimentos.ts:81-82` |
| Pendências de presença | Não (usa `STATUS_ATIVOS`) | `presenca.ts:52` |
| Consultas do mês, taxa de faltas, novidades | **Não conta** (`status not in ('cancelada','solicitada')`) | `presenca.ts:82-85,116` |
| Agenda de hoje e nº da consulta | Aparece com o selo; **não conta** no número | `inicio.ts:47,55` |
| Link assinado (confirmar, cancelar, remarcar) | Não há link (nenhum lembrete sai) | `acoes-link.ts:119` |
| Página do link da consulta | Mapa `SITUACAO` vira `Record<StatusConsulta, …>` ("Aguardando confirmação da nutricionista") | `app/consulta/[token]/page.tsx:14` |
| Portal: Minhas consultas | "Aguardando confirmação da nutricionista" + "Desistir do pedido"; o pedido entra em "Próximas" (`ativas` e `podeAgendar` com `STATUS_OCUPA`); recusado e vencido aparecem como "Não confirmado" (AG-D44) | `portal/agenda.ts:32-43`; `p/(portal)/agenda/page.tsx:11,19` (`SITUACAO` vira `Record<StatusConsulta,string>`); `p/(portal)/agenda/[id]/page.tsx:25,43` |
| Portal: jornada e mural | Não mostram | `portal/jornada.ts:14`; `portal/mural.ts:57` |
| Cancelar pelo paciente | Vira "Desistir do pedido" (`cancelado_por = 'pedido_desistido'`, AG-D44), com confirmação, e avisa a nutricionista (AG-D42) | `cancelamento.ts:40` |
| Remarcar pelo paciente | Não (desiste e pede outro); a consulta marcada continua remarcando direto (AG-D24) | `cancelamento.ts` (`remarcarComoPaciente`) |
| Selos e rótulos | `ROTULO_STATUS` ganha "Pedido a responder" (AG-D43); `selosDaConsulta` ganha "Pedido retirado pelo paciente", "Pedido não aceito" e "Pedido vencido" pelos `cancelado_por` novos (AG-D44); `cancelada` + `sistema` continua só a exclusão LGPD | `app/painel/agenda/periodo.ts:24-31`, `item-consulta.tsx:10` |
| Métricas do admin (SQL) | **Não conta**: `CREATE OR REPLACE` das funções da 0059 e da 0087 com `not in ('cancelada','solicitada')` | migration custom do PR 1; `metricas-sucesso.ts:39-40` |
| Tela da consulta | Selo "Pedido a responder" + Aceitar e Recusar (com confirmação, I-10) | `consultas/[id]/page.tsx:31-33` |

### 4.4 Ficha do paciente

Nenhuma aba nova (Plano 18 D12: a 14ª aba não cabe a 1280 px). A seção **"Consultas"** entra pelo registro
(`SecaoDaFicha`): `id: 'consultas'`, `titulo: 'Consultas'`, `aba: ''`,
`verTodos: (id) => '/painel/agenda?visao=lista&paciente=' + id`, `disponivel` = sempre, sem `adicionar` (o "Marcar
consulta" já existe na ficha), sem `leitura` (RN-277 do Plano 18: só agenda, como a P05 D10). O `resumo` devolve
`total` = consultas futuras em `STATUS_OCUPA`, ou **1** quando não há consulta futura e há previsão (o `secao.tsx` do
Plano 18 esconde os itens quando `total = 0`; ele não muda), e até 3 itens: as próximas consultas em ordem **crescente**
(exceção documentada ao "mais recentes primeiro" de `tipos.ts`), com rótulo "Primeira consulta" ou "Retorno" e situação
"Agendada", "Confirmada" ou "Pedido a responder"; sem consulta futura e com previsão, o item "Retorno previsto" com a
data. O `noApp` conta as consultas futuras que o paciente vê em "Minhas consultas". `STATUS_OCUPA` e os rótulos vêm de
`src/modules/agenda/status.ts` (puro), o único import novo em `IMPORTS_PERMITIDOS` de `ficha/registro.test.ts` (com o
comentário do porquê); o título "Consultas" entra em `MSG_FICHA.titulos` (`ficha/textos.ts`). Testes: sem consulta futura
e com previsão, a seção abre com o item; o `total` bate com as futuras da Lista filtrada pelo paciente (RN-411).

### 4.5 Fluxo do pedido com a chave ligada

```
Portal ou página pública (e-mail já é paciente)        Página pública (pessoa nova)
  INSERT appointments status='solicitada'                 código ok → app_pedido_aguardar (SECURITY DEFINER)
  (gatilho exige; EXCLUDE segura o horário)               (sem paciente; teto 1/e-mail, 20/tenant; trava do tenant)
            │                                                        │
            ▼                                                        ▼
        Fila "Solicitações" (painel)  ◄──────────────────────────────┘
   Aceitar ─► agendada + lembretes + consulta_marcada        Aceitar ─► paciente + consents + consulta agendada
   Recusar ─► cancelada (pedido_recusado) + aviso             Recusar ─► resolvido_em + e-mail (enqueueEmail)
   Desistir ─► cancelada (pedido_desistido) + aviso à nutri   Desistir (link do e-mail) ─► resolvido_em
   Vence em início − antecedência (processarNotificacoes) ─► cancelada (pedido_vencido) / resolvido_em + o mesmo aviso
```

---

## 5. Histórias de usuário

### E23 — Agenda 2

#### US-400 — Cadastrar locais de atendimento · **M** (PD-70)

**Como** nutricionista, **quero** cadastrar os lugares onde atendo, **para** marcar cada consulta no lugar certo.

```gherkin
Cenário: Locais criados pela atualização
  Dado que o consultório tinha endereço no Perfil e horários "Ambas"
  Quando abro "Locais de atendimento" pela primeira vez depois do Plano 23
  Então vejo "Consultório" com o selo "Principal" e "Videoconferência"
  E os horários antigos aparecem nos dois locais

Cenário: Consultório criado depois da atualização
  Dado um consultório criado pelo admin depois do Plano 23, sem nenhum local
  Quando abro o Início do painel, a Agenda, Horários ou Locais
  Então o "Consultório" (principal, presencial) já existe (AG-D45)
  E, se não houver nenhum local ativo, Nova consulta e Horários mostram "Cadastre um local de atendimento para marcar consultas e definir horários." com o link para Locais

Cenário: Novo local presencial
  Quando toco em "Novo local", escolho "Presencial" e informo "Clínica Centro", o endereço e a cidade
  Então "Mostrar o endereço na página de agendamento" vem desmarcado
  E o campo "Nome do local" mostra a ajuda "Não use nome nem endereço de paciente."
  Quando toco em "Salvar local"
  Então vejo "Local salvo." (role="status")

Cenário: Novo local de videoconferência
  Quando escolho "Videoconferência"
  Então o endereço some e aparece "Sala fixa (link, opcional)"
  E vejo o aviso de telenutrição (RN-404)
  Quando informo a sala fixa
  Então vejo também "Use sala de espera ou senha e admita um paciente por vez."

Cenário: Agendamento online sem sala
  Dado um local de videoconferência sem sala fixa
  Quando marco "Aceita agendamento pelo paciente"
  Então vejo "Para aceitar agendamento pelo paciente, informe a sala fixa."

Cenário: Trocar o principal
  Quando toco em "Definir como principal" em "Clínica Centro"
  Então ela vira o principal e "Consultório" perde o selo, na mesma transação

Cenário: Local em uso
  Dado que "Consultório" tem consultas
  Então a linha não mostra "Excluir", e sim o texto "Em uso: arquive"
  E, se o uso nascer entre a tela e o toque, o servidor responde "Este local tem consultas ou horários. Arquive em vez de excluir."
  Quando toco em "Arquivar"
  Então ele some dos seletores, dos horários livres e da página pública
  E as consultas antigas continuam mostrando "Consultório"

Cenário: Principal não se arquiva
  Quando tento arquivar o principal
  Então vejo "Defina outro local como principal antes de arquivar este."

Cenário: Tipo fixo
  Dado um local presencial com consultas
  Então a edição mostra o tipo como texto, sem campo
```

#### US-401 — Horários de atendimento por local · **M** (PD-70)

```gherkin
Cenário: Horários agrupados
  Quando abro "Horários de atendimento"
  Então vejo um grupo por local ativo, cada um com as regras dele
  E cada regra nova exige um local

Cenário: Mesmo horário em dois locais
  Quando crio terça 14h–18h em "Clínica Centro" marcando "Também atender por videoconferência nestes horários"
  Então nascem as duas regras numa transação só
  E os horários livres de terça à tarde aparecem nos dois locais
  E uma consulta marcada num deles ocupa o horário nos dois (RN-408)

Cenário: Regra sem local (gravada pela versão anterior)
  Dado uma regra "Ambas" gravada sem local na janela entre o PR 1 e o PR 2
  Quando abro "Horários de atendimento"
  Então ela já aparece desdobrada no presencial principal e no primeiro local online ativo (RN-410a)
  E, até essa abertura, os horários livres a tratam do mesmo jeito

Cenário: Teto
  Dado 60 regras
  Quando tento criar outra
  Então vejo "Você chegou ao limite de 60 horários. Apague um antes de criar outro."
```

#### US-402 — Marcar e alterar consulta com local · **M** (PD-70)

```gherkin
Cenário: Local na nova consulta
  Quando abro "Nova consulta"
  Então o campo "Local" vem com o principal
  Quando escolho "Videoconferência"
  Então o campo "Link da chamada" aparece com a sala fixa, se houver, e pode ser editado (dica "Vazio = a sala fixa do local.")
  Quando escolho um local presencial
  Então o link some

Cenário: Consulta antiga
  Dado uma consulta presencial marcada antes do Plano 23
  Então o detalhe mostra "Consultório (endereço do perfil)"

Cenário: Endereço nas mensagens
  Dado uma consulta em "Clínica Centro"
  Então o lembrete por e-mail e WhatsApp, o link da consulta e o portal mostram o endereço de "Clínica Centro"
  E o push continua só com o horário, sem nome nem endereço do local (Plano 05, D19)
  E o link da sala de uma consulta online vai no e-mail da consulta, no painel e em "Sua consulta" no portal (RN-406), nunca no WhatsApp, no push, na página pública ou na impressão
```

#### US-403 — Paciente escolhe o local · **M** (PD-70)

**Como** paciente, **quero** escolher onde ser atendido ao pedir horário, **para** não marcar no lugar errado.

```gherkin
Cenário: Dois locais com agendamento online
  Quando abro a página de agendamento ou "Agendar" no portal
  Então vejo "Onde você quer ser atendido?" com os locais (nome, cidade e o endereço, se marcado)
  E os horários mostrados são só os livres daquele local
  E trocar o local filtra os horários na própria página, sem perder o que já digitei

Cenário: Um local só
  Então a escolha não aparece

Cenário: Cabeçalho da página
  Dado que o CRN está preenchido no Perfil
  Então a página mostra "{nome profissional, ou o nome de exibição se ele faltar} · Nutricionista · {crn como está gravado}"
  Dado que o CRN está vazio
  Então a página mostra "{nome} · Nutricionista"
  E o Perfil avisa "Informe o CRN: ele aparece na página de agendamento."

Cenário: Página pública desligada
  Dado que "Permitir agendamento pela página pública" está desligado no Perfil
  Então o "Agendar" do portal continua mostrando os locais com "Aceita agendamento pelo paciente" (AG-D40)

Cenário: Remarcar
  Quando remarco pelo portal ou pelo link da consulta
  Então o local da consulta vem escolhido e posso trocar por outro local com horário

Cenário: Nada a mais
  Então a página nunca mostra ocupação, bloqueio, link da sala, preço ou local arquivado
```

#### US-404 — Ver a agenda em dia, semana, mês ou lista · **M** (PD-71)

```gherkin
Cenário: Semana em grade
  Quando abro a agenda na visão "Semana"
  Então vejo uma grade com os dias nas colunas e as horas nas linhas, na faixa das regras (RN-412)
  E cada consulta aparece uma vez, na linha da hora em que começa, com "08:40–09:30" visível
  E o link é nomeado pelo conteúdo visível (paciente, horário, selos, local e situação), sem aria-label que o contradiga

Cenário: Mostrar 24 horas
  Quando marco "Mostrar 24 horas"
  Então a grade vai de 00h a 24h e a URL leva "horas=24"

Cenário: Mês
  Quando escolho "Mês"
  Então vejo a grade de segunda a domingo, com a contagem e até 3 nomes por dia e "mais {n}"
  Quando toco num dia
  Então abro a visão "Dia" daquela data

Cenário: Ir para data sem JavaScript
  Quando informo 03/02/2027 em "Ir para data" e toco em "Ir para a data"
  Então a agenda abre na data, na visão atual, com os filtros de antes

Cenário: Navegar mantém os filtros
  Dado a agenda filtrada por "Clínica Centro"
  Quando toco em "Próximo"
  Então a semana seguinte continua filtrada por "Clínica Centro"

Cenário: Celular
  Dado a tela de 360 px
  Então "Semana" e "Mês" viram lista por dia, sem rolagem horizontal da página
```

#### US-405 — Filtrar e entender a agenda · **M** (PD-72)

```gherkin
Cenário: Filtros na URL
  Quando escolho o local "Clínica Centro" e o paciente "Ana Souza"
  Então a URL guarda "local" e "paciente" e a agenda mostra só as consultas dela naquele local
  E o Histórico de acessos de Ana não ganha "Visualizou" (AG-D30)

Cenário: Selos em texto
  Então cada consulta mostra, em texto, "Primeira consulta" ou "Retorno", o local e a situação
  E, quando é o caso, "Pedido a responder" ou "Presença a registrar"
  E os bloqueios aparecem como "Bloqueado: {motivo}"

Cenário: Legenda
  Então a legenda lista os mesmos rótulos em texto; a cor só reforça

Cenário: Marcadores
  Quando ligo "Previsões de retorno" e "Aniversários"
  Então vejo "Retorno previsto: {nome}" e "Aniversário: {nome}" nos dias, sem idade
  E "Aniversário" só de paciente ativo e não anonimizado, com data de nascimento (RN-414)
```

#### US-406 — Imprimir ou salvar a agenda em PDF · **S** (PD-71)

```gherkin
Cenário: Impressão do período
  Quando toco em "Imprimir ou salvar em PDF" na semana filtrada por "Clínica Centro"
  Então abre a versão de impressão com hora, nome de registro, Primeira consulta ou Retorno, local, modalidade e situação
  E o rodapé "Contém dados pessoais de pacientes. Uso restrito do consultório."
  E o botão "Imprimir ou salvar em PDF" abre o diálogo do navegador

Cenário: O que nunca entra
  Então a página não tem telefone, e-mail, link, observações, motivo, valores, aniversários nem previsões de retorno
  E os bloqueios saem como "Bloqueado", sem o motivo

Cenário: Registro
  Então o audit_log ganha um "exportar" da entidade "agenda", sem paciente, com o período e o local em entidade_id (RN-419)
```

#### US-407 — Ligar a confirmação dos pedidos · **S** (PD-74)

```gherkin
Cenário: Ligar
  Quando marco "Confirmar os pedidos antes de marcar" em Horários e salvo
  Então vejo "Configuração salva." (role="status")
  E vejo a explicação "Os pedidos feitos pelo app e pela página de agendamento esperam a sua resposta em Solicitações."
  E a aba "Solicitações" aparece na agenda

Cenário: Desligar com pedidos pendentes
  Dado 2 pedidos pendentes
  Quando desligo a chave
  Então os 2 continuam na fila até a resposta ou o vencimento
  E os pedidos novos voltam a ser marcados direto
```

#### US-408 — Pedir horário com confirmação · **M** (PD-74)

**Como** paciente, **quero** pedir um horário e saber que ele espera a confirmação, **para** não ir a uma consulta que não existe.

```gherkin
Cenário: Pedido pelo portal
  Dado que a chave está ligada
  Quando escolho um horário em "Agendar"
  Então vejo "Pedido enviado. Sua nutricionista vai confirmar o horário e você recebe um e-mail."
  E em "Minhas consultas" o pedido aparece em "Próximas" como "Aguardando confirmação da nutricionista", com "Desistir do pedido"

Cenário: Desistir do pedido
  Quando toco em "Desistir do pedido" e confirmo "Desistir deste pedido?"
  Então volto a "Minhas consultas" com "Pedido cancelado." numa região role="status" fixa, que recebe o foco
  E a nutricionista recebe o aviso do pedido retirado (AG-D42)

Cenário: Pedido pela página pública
  Quando confirmo o código de 6 dígitos
  Então vejo "Pedido enviado. {nome da nutricionista} vai confirmar o horário e você recebe um e-mail.", seja o e-mail de paciente ou não (RN-426)
  E recebo o mesmo e-mail "Recebemos seu pedido de consulta", no mesmo momento, nos dois casos
  E a tela informou antes, no ponto de coleta: "Até a resposta, guardamos seu nome, e-mail, telefone e o número de rede (IP) do seu aparelho só para este pedido. Se ele não for aceito ou o horário passar, apagamos esses dados depois de 24 horas, na limpeza diária."

Cenário: Teto
  Dado 2 consultas futuras e 1 pedido
  Quando tento pedir outro horário
  Então vejo o aviso do teto de 3 consultas futuras

Cenário: Pessoa nova com pedido aguardando
  Dado um pedido aguardando do mesmo e-mail
  Quando confirmo o código de um novo pedido
  Então vejo "Você já tem um pedido aguardando resposta. Espere a resposta antes de pedir outro horário."
  E essa mensagem nunca aparece antes do código (RN-426)

Cenário: Token de um pedido que já está aguardando
  Dado um pedido de pessoa nova aguardando resposta
  Quando reabro o link do código ou tento "Escolher outro horário" com o mesmo token
  Então vejo a tela de pedido expirado (RN-424a) e o horário pedido não muda

Cenário: Pessoa nova desiste
  Quando toco em "Desistir do pedido" no e-mail "Recebemos seu pedido de consulta"
  Então abro uma página que não grava nada até eu tocar em "Desistir do pedido"
  E depois vejo "Pedido cancelado." e o horário volta a ficar livre (AG-D42)

Cenário: Remarcar consulta já marcada
  Dado uma consulta "Agendada" e a chave ligada
  Quando remarco pelo portal ou pelo link
  Então a consulta nova nasce "Agendada", sem passar pela fila (AG-D24)
```

#### US-409 — Responder às solicitações · **M** (PD-74)

```gherkin
Cenário: Fila
  Quando abro "Solicitações"
  Então vejo paciente (ou "Nova pessoa: {nome}"), horário, local, origem ("App" ou "Página de agendamento"), "Pedido em {data}" e "Responda até {data e hora}" (início − antecedência)
  E os pedidos que já venceram não aparecem

Cenário: Aceitar
  Quando toco em "Aceitar"
  Então a consulta vira "Agendada", os lembretes são agendados e o paciente recebe "consulta marcada"
  E volto à fila com "Pedido aceito. Consulta marcada." na região role="status" fixa e o foco no h1

Cenário: Aceitar pessoa nova
  Quando aceito o pedido de "Nova pessoa: Carla Dias"
  Então nascem o cadastro (origem "agendamento_publico"), o aceite do termo (versão e momento do pedido) e a consulta "Agendada"
  E o opt-in do WhatsApp do pedido, se houve, vai ao cadastro com a data da verificação do código (RN-424)
  Mas se o e-mail já é de um paciente ativo, a consulta vai para ele, sem cadastro novo
  E se o e-mail é de um paciente arquivado ou bloqueado, vejo "Este e-mail é de um paciente arquivado ou bloqueado. Recuse o pedido ou fale com a pessoa."

Cenário: Horário tomado
  Dado que marquei outra consulta por cima do pedido de pessoa nova
  Quando aceito
  Então vejo "Esse horário já está ocupado. Recuse o pedido ou combine outro horário com a pessoa."

Cenário: Recusar
  Quando toco em "Recusar" no pedido de um paciente
  Então abre a confirmação "Recusar o pedido de {nome}? A pessoa recebe um e-mail avisando." com "Motivo (só você vê)" e "Confirmar recusa"
  E, depois de confirmar, o paciente recebe o texto fixo "Seu pedido de consulta não foi confirmado" com "Escolha outro horário"
  Quando recuso o pedido de uma pessoa nova
  Então abre a mesma confirmação, sem campo de motivo, e a pessoa recebe o mesmo texto por e-mail

Cenário: Pedido que já mudou
  Dado que o pedido venceu ou foi respondido em outra aba
  Quando toco em "Aceitar" ou "Confirmar recusa"
  Então volto à fila sem a linha, com "Este pedido já foi respondido ou venceu." na região de status

Cenário: Vencimento
  Dado um pedido para hoje às 16h e antecedência mínima de 12 h
  Quando chegam 04h sem resposta
  Então o pedido vence, sai da fila e a pessoa recebe o mesmo aviso da recusa

Cenário: Pedido perto do limite
  Dado a chave ligada e antecedência mínima de 12 h
  Então o portal e a página pública só oferecem horários que começam pelo menos 24 h depois de agora (AG-D41)
  E todo pedido dá ao menos 12 h para a resposta

Cenário: Início do painel
  Dado 3 pedidos pendentes
  Então o Início mostra "Solicitações (3)" com o link para a fila

Cenário: Pedido não se altera
  Então a tela do pedido não tem "Alterar" nem "Registrar presença"
  E "Registrar atendimento" a partir dele mostra "Aceite o pedido antes de registrar o atendimento."
```

#### US-410 — Prever o retorno · **M** (PD-72)

```gherkin
Cenário: Registrar a previsão
  Quando registro o atendimento e informo "Retorno previsto" "em 6 semanas"
  Então a data é calculada no fuso do consultório e salva no atendimento

Cenário: Limite
  Quando informo uma data depois de 2 anos do atendimento ou antes dele
  Então vejo "A previsão de retorno deve ficar entre a data do atendimento e 2 anos depois."

Cenário: Marcador
  Dado que Ana não tem consulta futura e o último atendimento dela previu retorno em 10/12/2026
  Quando ligo "Previsões de retorno"
  Então vejo "Retorno previsto: Ana Souza" em 10/12/2026
  Quando toco nele
  Então abro "Nova consulta" com Ana preenchida

Cenário: Fora do app e da IA
  Então a previsão não aparece no portal nem entra em nenhum contexto de IA
```

#### US-411 — Ver as consultas no Início da ficha · **S** (PD-72)

```gherkin
Cenário: Seção Consultas
  Quando abro o Início da ficha de Ana
  Então a seção "Consultas" mostra até 3 próximas consultas, com "Primeira consulta" ou "Retorno" e a situação
  E, sem consulta futura, "Retorno previsto" com a data
  E "Ver todos" abre a agenda em Lista filtrada por Ana, com as mesmas consultas futuras que a seção conta (RN-411)
```

#### US-412 — Ver os aniversariantes do mês · **S** (PD-73)

```gherkin
Cenário: Lista
  Quando abro "Aniversariantes"
  Então vejo os pacientes ativos com aniversário no mês: nome, dia, idade que completa e a situação
  E a situação é uma de "Pode receber", "Sem autorização", "Menor de idade", "Já enviada este ano", "Aniversário já passou" ou "Passou do horário de hoje"
  E a tela diz que pacientes sem data de nascimento não entram na lista

Cenário: Outro mês
  Quando toco em "Próximo mês"
  Então vejo a lista daquele mês só para consulta, com "O envio abre no dia 1º de {mês}." e nenhuma caixa de seleção

Cenário: 29 de fevereiro
  Dado um paciente nascido em 29/02 e um ano não bissexto
  Então ele aparece em 28/02

Cenário: Início do painel
  Dado 2 aniversariantes hoje
  Então o Início mostra "Aniversariantes de hoje (2)"

Cenário: Sem trilha de leitura
  Então abrir a lista não grava "Visualizou" (precedente RN-272 do Plano 18)
```

#### US-413 — Enviar mensagem de aniversário · **M** (PD-73)

```gherkin
Cenário: Selecionar todos
  Quando toco em "Selecionar todos"
  Então só os que "Pode receber", de hoje até o fim do mês, ficam marcados
  E os outros ficam desabilitados com o motivo em texto
  E o botão vira "Limpar seleção" e uma região role="status" anuncia "{n} marcados"

Cenário: Prévia e envio
  Quando toco em "Enviar mensagem"
  Então vejo a prévia, "Texto padrão do NutriDebby, enviado em seu nome" e "Vai para {n} pacientes por e-mail, às 9h do dia do aniversário."
  E, se houver aniversariante de hoje depois das 9h, também "{n} de hoje saem agora." (RN-432)
  Quando confirmo
  Então vejo "Mensagens agendadas: {n}."

Cenário: Uma por ano
  Dado que Ana já tem a mensagem deste ano (enviada, agendada ou ignorada)
  Então ela aparece como "Já enviada este ano" e não é marcada de novo

Cenário: Autorização retirada antes do envio
  Dado que Ana retirou a autorização depois do agendamento
  Então às 9h a mensagem é ignorada e não sai

Cenário: Abrir no WhatsApp
  Dado que Ana autorizou e tem telefone
  Quando toco em "Abrir no WhatsApp"
  Então abre o WhatsApp do meu aparelho com o texto fixo da RN-435, sem rodapé e sem link
  E o sistema não envia nada, não grava nada e não gasta a cota
```

#### US-414 — Autorizar ou retirar mensagens de aniversário · **M** (PD-73)

```gherkin
Cenário: Pelo paciente
  Dado o bloco "Receber mensagem de aniversário da sua nutricionista" no Perfil do portal, com a ajuda "Uma mensagem por ano, por e-mail, no dia do seu aniversário. Usamos seu nome, sua data de nascimento e seu e-mail. Você pode desligar quando quiser, aqui ou pelo link no próprio e-mail."
  Quando toco em "Autorizar"
  Então vejo "Autorizado em {data}" e o botão "Retirar autorização"
  E, se eu tiver menos de 18 anos, o botão fica desabilitado com "Menor de idade"

Cenário: Pelo link do e-mail
  Quando toco em "Não quero mais receber mensagens de aniversário" no e-mail
  Então abro uma página que não grava nada até eu tocar em "Confirmar"
  E depois vejo "Pronto. Você não vai mais receber mensagens de aniversário."

Cenário: Pela nutricionista
  Quando toco em "Registrar autorização" na lista
  Então escolho "Como o paciente autorizou?" ("Por escrito", "Por mensagem", "Verbalmente")
  E confirmo "O paciente autorizou receber mensagens de aniversário. Guarde o comprovante."
  E posso "Retirar autorização" depois
  E, para paciente menor de 18 anos, "Registrar autorização" fica desabilitado com "Menor de idade"

Cenário: Prova
  Então cada mudança é uma linha nova; nenhuma linha é alterada ou apagada
```

#### US-415 — Filtrar pacientes por local · **S** (PD-70, Fase B)

```gherkin
Cenário: Filtro Local
  Quando escolho "Clínica Centro" no filtro "Local" de Pacientes
  Então vejo só quem tem consulta naquele local que não está cancelada nem aguardando confirmação
  E o filtro combina com a aba, a busca e a etiqueta
```

#### US-416 — Filtrar o Financeiro por local · **S** (PD-70, Fase B)

```gherkin
Cenário: Lançamentos
  Quando filtro Lançamentos por "Clínica Centro"
  Então vejo os lançamentos ligados a consultas daquele local
  E "Sem local" mostra os lançamentos sem consulta ou de consulta antiga

Cenário: Relatórios
  Então "Entradas e saídas nos últimos 12 meses" aceita o filtro
  E o Resumo, o saldo e o "Fluxo de caixa do ano" dizem "Todos os locais" e não se dividem

Cenário: Soma
  Então a soma dos locais com "Sem local" é igual ao total sem filtro
```

---

## 6. Regras de negócio

### 6.1 Regras

| ID | Regra |
|---|---|
| RN-400 | **Acesso.** Só a sessão `nutri` lê a agenda do painel, imprime, muda locais, regras e a chave, responde pedidos e envia aniversário; as funções conferem `ctx.role === 'nutri'` antes de abrir a transação. O admin nunca consulta |
| RN-401 | **Local.** Tipo `presencial` ou `online`; nome de 2 a 60 caracteres, único entre os não arquivados do consultório (sem diferença de maiúsculas); endereço (até 300) e cidade (até 80) opcionais e só no presencial; sala fixa só no online. O tipo não muda depois que o local é usado por consulta, regra ou pedido (FK composta) |
| RN-402 | **Principal.** No máximo um principal ativo por consultório; o principal não se arquiva; "Definir como principal" troca numa transação |
| RN-403 | **Arquivar e excluir.** Local com qualquer referência é arquivado, nunca excluído (FK `NO ACTION`); arquivado some dos seletores, dos horários livres e da página pública; "Reativar" o devolve |
| RN-404 | **Aviso de telenutrição** no local de videoconferência. Texto sem o número da resolução (o que vai ao merge enquanto o DOU não for conferido, PM-A2): "Antes do primeiro atendimento online, faça o cadastro no e-Nutricionista e colha o TCLE de telenutrição, guardando o comprovante. Não grave as consultas." (as duas primeiras exigências pela notícia oficial do CFN, https://cfn.org.br/cfn-publica-resolucao-que-regulamenta-a-telenutricao/; o "Não grave" e o número dos artigos ficam no portão do DOU, AG-P3). Com o DOU conferido, a frase cita a Res. CFN 760/2023. Com sala fixa, também: "Use sala de espera ou senha e admita um paciente por vez." Na tela da consulta e na fila "Solicitações", consulta online com o selo "Primeira consulta" (RN-416) mostra o texto fixo "Primeira consulta online: confira o TCLE de telenutrição antes de atender." (sem coluna e sem registro; o registro do TCLE segue no backlog, AG-D36) |
| RN-405 | **Agendamento pelo paciente** (`locais_atendimento.agendamento_online`, rótulo "Aceita agendamento pelo paciente") só em local ativo e (presencial ou online com sala fixa) — CHECK no banco. Vale para o portal e para a página pública; a página pública, além disso, continua ligada e desligada só por `tenants.agendamento_publico_ativo` (AG-D40). Ajuda do campo: "Vale para o app do paciente e, se a página de agendamento estiver ligada no Perfil, para ela também." |
| RN-406 | **Link da sala.** `locais_atendimento` é fechada no banco: `staff_only` nega ao `paciente` e `publico_negado` (de `app_enable_tenant_rls`) nega ao `publico`; nesses contextos, local só por `app_locais_para_agendamento()` e `app_local_da_consulta(id)` (§9.1), sem a coluna da sala. Na consulta de origem `paciente`, o link é copiado pelo gatilho `appointments_link_da_sala` para `appointments.link_online`, que tem a proteção de hoje (lista de colunas no código; `appointments` está em `PUBLICO_LIBERADO`). O link vai no e-mail da consulta, no painel e em "Sua consulta" no portal (só a própria consulta online ativa, como hoje); nunca na página pública, no WhatsApp, no push ou na impressão |
| RN-407 | **Consulta com local.** Consulta nova sempre tem local (aplicação); consulta antiga sem local mostra o endereço do Perfil, como hoje. `garantirLocaisIniciais(tx)` (AG-D45) garante pelo menos o "Consultório" principal em todo consultório antes das telas do painel que precisam de local |
| RN-408 | **Uma agenda por consultório.** Duas consultas não se sobrepõem, em qualquer local (`EXCLUDE` por tenant) |
| RN-409 | **Horários livres** = regras do local − bloqueios − consultas em `STATUS_OCUPA` de qualquer local − pedidos de pessoa nova aguardando (lidos por `app_pedidos_aguardando(de, ate)`, só intervalos). O portal e a página pública só oferecem locais ativos com `agendamento_online` (a página pública também exige `tenants.agendamento_publico_ativo`, AG-D40). Com a chave dos pedidos ligada, só horários com início ≥ agora + `antecedencia_min_h` + `JANELA_RESPOSTA_PEDIDO_H` (12 h, `constantes.ts`; AG-D41) |
| RN-410 | **Regras.** Toda regra nova tem local; o tipo do local é a modalidade da regra; "Também atender por videoconferência nestes horários" (só em regra presencial, com um local online ativo) cria a regra-par na mesma transação; teto de **60** regras por consultório; legado acima do teto continua |
| RN-410a | **Regra sem local** (gravada pela imagem anterior entre o PR 1 e o PR 2, ou numa volta atrás): vale para o local principal ativo do tipo da modalidade; `ambas` sem local vale para o presencial principal e para o primeiro local online ativo (por `created_at`). A atribuição considera todos os locais ativos; só depois o portal e a página pública descartam o local sem `agendamento_online` (regra atribuída a um principal sem agendamento não gera horário fora do painel; por isso `app_locais_para_agendamento` devolve `principal`, `agendamento_online` e a ordem, §9.1). `garantirLocaisIniciais` aplica a essas regras o mesmo backfill da migration (grava o local e desdobra o `ambas`), idempotente; até lá, `gerarHorarios` as trata assim. Teste de unidade de `gerarHorarios` com os três casos |
| RN-411 | **Visões.** `dia`, `semana`, `mes`, `lista`; outro valor vira `semana`. A data passa por `dataDaAgendaOuHoje` (teto hoje + 5 anos). Lista = 30 dias a partir da data; com `paciente=` na URL, a Lista vai de hoje a hoje + 12 meses (as mesmas consultas futuras que a seção "Consultas" da ficha conta) e "Anterior" recua 12 meses. Preferências só na URL, por `hrefDaAgenda` (§4.1) |
| RN-412 | **Faixa da grade.** Menor início e maior fim das regras dos dias mostrados, arredondados à hora; sem regra, 08h–18h; `horas=24`, 00h–24h; uma consulta fora da faixa amplia a faixa |
| RN-413 | **Mês.** Grade de segunda a domingo; por dia, a contagem (sem canceladas) e até 3 nomes, depois "mais {n}"; tocar no dia abre a visão Dia. Canceladas ficam fora da grade (Dia, Semana e Mês) e aparecem só na Lista |
| RN-414 | **Leitura da agenda** (filtrada ou não, inclusive por paciente, com marcadores e a seção da ficha) **não chama `auditRead`** (P05 D10): devolve só nome, hora, local, situação, selos e, nos marcadores, nome e data; `consultations.retorno_previsto_em` é lido assim pela agenda, pelos marcadores e pela seção "Consultas". **Marcador "Aniversário"** = pacientes com `status = 'ativo'`, `anonimizado_em is null` e `data_nascimento` preenchida, pelo dia e mês no fuso do consultório (29/02 → 28/02 em ano não bissexto); só o nome, sem idade; não depende da autorização de mensagens. Teste de integração com paciente bloqueado, arquivado e anonimizado fora |
| RN-415 | **Legenda e selos em texto** (WCAG 1.4.1); a cor só reforça |
| RN-416 | **"Retorno"** = o paciente tem consulta `realizada` antes desta **ou** atendimento com data anterior ao dia desta; senão, "Primeira consulta". Calculado no SQL numa consulta agregada por período (`min(inicio)` das realizadas e `min(data)` dos atendimentos por paciente), nunca por item. Sem coluna |
| RN-417 | **"Presença a registrar"** = a mesma regra de `pendenciasDePresenca` (US-037) |
| RN-418 | **Impressão.** Só hora, nome de registro, Primeira consulta/Retorno, local, modalidade e situação, por lista fechada no módulo com teste das chaves; bloqueio impresso como "Bloqueado", sem motivo; rodapé fixo; nunca link, contato, observação, motivo, valor, aniversário ou previsão |
| RN-419 | **Registro da impressão.** O render do servidor de `/painel/agenda/imprimir` grava `recordAudit({ acao: 'exportar', entidade: 'agenda', entidadeId, patientId: null })` na transação da leitura, com `entidadeId` = `{de}..{ate}\|{localId ou 'todos'}` (o período e o local vão em `entidade_id`, que é texto; sem nome de paciente nem endereço; nenhuma coluna nova em `audit_log`); o link é `prefetch={false}` |
| RN-420 | **Chave dos pedidos** (`tenants.agenda_confirmar_pedidos`, desligada por padrão): só a sessão `nutri` muda (gatilho `tenants_agenda_da_equipe`: `paciente`, `publico`, `conta` e `worker` recebem 42501; o processo web também usa o papel `worker`; revisão da T1b). Desligar não mexe nos pedidos pendentes |
| RN-421 | **Nascimento do pedido** (gatilho `appointments_regras_pedido`, BEFORE INSERT): na sessão `paciente` ou `publico`, com a chave ligada, a consulta nasce `solicitada`, **salvo** a remarcação. A remarcação é provada por um marcador local à transação que o próprio gatilho grava no BEFORE UPDATE (padrão de `app.ia_nutri_revogando`): só quando `OLD.status in ('agendada','confirmada')`, `NEW.status = 'cancelada'`, `NEW.cancelado_por = 'paciente'` e a sessão é `paciente`, ele faz `set_config('app.agenda_remarcavel', OLD.id::text, true)`. No BEFORE INSERT, `agendada` só é aceita se `NEW.remarcada_de::text = current_setting('app.agenda_remarcavel', true)` e a origem é do mesmo paciente e consultório; depois o marcador é limpo (uma remarcação por cancelamento). A desistência de um pedido grava `pedido_desistido` e nunca liga o marcador. Funciona dentro de SAVEPOINT. Com a chave desligada, `agendada`. Nas sessões `nutri` e `worker`, nunca nasce `solicitada`. CHECK: `solicitada` só com `origem = 'paciente'` |
| RN-422 | **Transições do pedido** (o mesmo gatilho, BEFORE UPDATE): de `solicitada` só para `agendada` (sessão `nutri`) ou `cancelada` com: `paciente` + `pedido_desistido`; `nutri` + `pedido_recusado`; `worker` + `pedido_vencido` (só com `inicio − antecedencia_min_h ≤ now()`, conferido pelo gatilho: o processo web também usa o papel `worker`); `nutri` + `sistema` só quando o titular já está `bloqueado` (exclusão LGPD: `atenderPedidoExclusao` bloqueia o paciente antes, `lgpd.ts:157`, e `cancelarFuturasPelaExclusao` grava `sistema`, `cancelamento.ts:134`). Os três valores novos de `cancelado_por` (AG-D44) só valem saindo de `solicitada`. Nenhum UPDATE leva **a** `solicitada`; em `solicitada`, `inicio`, `fim`, `local_id`, `modalidade` e `patient_id` não mudam. **Na sessão `paciente`** (que tem UPDATE de todas as colunas da própria consulta, 0070), em qualquer status: `inicio`, `fim`, `local_id`, `modalidade`, `origem`, `remarcada_de`, `link_online` e `presenca_em` não mudam (o `patient_id` fica com a RLS, `patient_isolation`); consulta `cancelada`, `realizada` ou `faltou` não muda (só `updated_at`); as únicas trocas de status são `agendada` → `confirmada`, `agendada`/`confirmada` → `cancelada` com `cancelado_por = 'paciente'` e `solicitada` → `cancelada` com `pedido_desistido`; `confirmada_via` só muda na confirmação e `motivo_cancelamento` só no cancelamento; o marcador da RN-421 só liga com `OLD.inicio > now()` (o prazo de cancelamento continua no módulo). Sem isso, o paciente reabriria uma cancelada ou moveria uma agendada sem o aceite, com a chave ligada (AG-D16, crítica B4; rodada 1 da T1b). O plano confere esta tabela contra todos os `status: 'cancelada'` de `src/modules` (hoje `cancelamento.ts:104`, `:134` e `:169`) |
| RN-423 | **Onde `solicitada` conta**: a tabela fechada da §4.3 (ocupa o horário e o teto; não conta em lembretes, presença, atendimento, pendências, indicadores, nº da consulta nem métricas do admin) |
| RN-424 | **Pessoa nova** (chave ligada, e-mail sem paciente no consultório): depois do código, o pedido fica aguardando (`aguardando_desde`, local, início e fim), gravado **só** por `app_pedido_aguardar` (§9.4); **nenhum cadastro**. No aceite (`aceitarPedidoPublico`, em `agendamento-publico.ts`): trava do tenant → linha do pedido; se o e-mail já é de paciente ativo, a consulta vai para ele e o opt-in dele não muda; se é de paciente arquivado ou bloqueado, recusa com mensagem; senão, cria o paciente (`origem = agendamento_publico`), o aceite do termo com `aceito_em` = `verificado_em` do pedido, o `ip` e a `termo_versao` do pedido, o opt-in do WhatsApp do pedido (`whatsapp_optin` com telefone) com `whatsapp_optin_em` = `verificado_em` e `whatsapp_optin_origem = 'paciente'` (como em `gravarPedido`), e a consulta `agendada` |
| RN-424a | **Pedido aguardando não é concluível de novo**: `confirmarCodigo`, `escolherOutroHorario` e `concluir` respondem 410 `pedidoExpirado` para pedido com `aguardando_desde` (a linha nem aparece ao `publico`, RN-425; o módulo responde por regra, com teste); `inicio`, `fim` e `local_id` do aguardando não mudam |
| RN-425 | **Proteções da pessoa nova.** O INSERT e o UPDATE diretos do `publico` para aguardando são recusados (a política RESTRICTIVE `aguardando_fora_do_publico`, `FOR ALL`, confere a linha nova no `WITH CHECK`, com ou sem `WHERE` e `RETURNING`); quem grava é `app_pedido_aguardar(p_pedido, p_local, p_inicio, p_fim)` (`SECURITY DEFINER`, troca de papel do molde 0083): só aceita o papel `publico` do tenant da sessão e um pedido com `verificado_em` válido, `concluido_em` e `aguardando_desde` nulos; sob a trava do tenant, confere o teto de **20** aguardando por consultório, **1** por e-mail e a sobreposição com `appointments` em `STATUS_OCUPA` e com os outros aguardando; grava e devolve só `ok` ou o motivo (`teto_tenant`, `email`, `ocupado`). O índice único parcial por e-mail fica como rede (23505 → "Você já tem um pedido aguardando…"). Os intervalos chegam ao `publico` só por `app_pedidos_aguardando(de, ate)` (mesmo molde, devolve `tstzrange`, sem dado pessoal). **Travas:** classe própria `(hashtext('agenda-pedidos-tenant'), hashtext(tenantId))`, distinta da `travarEmail`; ordem trava do e-mail → trava do tenant → linha do pedido; o aceite e a recusa da nutricionista e o vencimento tomam só tenant → pedido. A consulta `solicitada` ou `agendada` vinda do portal (`agendarComoPaciente`) e do `publico` também toma a trava do tenant e confere `app_pedidos_aguardando` sob ela antes do INSERT (P23-M7); no portal (`agendarComoPaciente`, `remarcarComoPaciente`) a trava do tenant vem no **começo** da transação, antes da trava do paciente: ordem global e-mail → tenant → paciente → consulta/pedido → notificações (revisão do plano, Plano 23 AG-D65) |
| RN-426 | **Resposta igual.** Antes da verificação do código, a resposta e o e-mail são iguais para paciente e não paciente. Depois do código, a página responde com a mesma tela e manda o mesmo e-mail ("Recebemos seu pedido de consulta", pelo `enqueueEmail`, na mesma transação) para quem já é paciente e para quem não é; só a dona do e-mail (que já provou o código) pode ver o teto de consultas, a recusa do próprio cadastro arquivado ou bloqueado e a mensagem de pedido aguardando (AG-D22) |
| RN-427 | **Vencimento.** O pedido vence em `inicio − antecedencia_min_h` (o mesmo prazo em que o horário deixa de ser oferecido, RN-03). `vencerSolicitacoes(db, agora, { tenantId })` roda no começo de `processarNotificacoes`, antes da varredura (job de minuto e envios avulsos; sem fila nova): `solicitada` vencida → `cancelada` com `cancelado_por = 'pedido_vencido'`; pessoa nova vencida → `resolvido_em`. Idempotente; com `tenantId`, só aquele consultório (teste: um job avulso de A não vence pedidos de B). Leitura preguiçosa: pedido vencido e ainda não processado aparece como "Não confirmado" no portal e não aparece na fila. A limpeza das 04:30 fica como rede |
| RN-427a | **Travas do pedido de paciente:** paciente → consulta → notificações em aceitar, recusar, desistir e vencer. `vencerSolicitacoes` seleciona os vencidos sem trava e, por pedido, trava o paciente (`FOR NO KEY UPDATE`, que basta contra o `KEY SHARE` da FK de `notifications`) antes da consulta (`FOR UPDATE`); sob a trava, reconfere `status = 'solicitada'` e `inicio − antecedência ≤ agora`, e pula se mudou. `aceitarSolicitacao` e `recusarSolicitacao` reconferem sob a mesma trava que o pedido não venceu nem foi respondido ("Este pedido já foi respondido ou venceu."). Pessoa nova: trava do tenant → linha do pedido, no aceite, na recusa, na desistência e no vencimento |
| RN-428 | **Avisos da resposta.** Aceite: `consulta_marcada` (canais de hoje). Recusa e vencimento: paciente → `notifications` `pedido_nao_confirmado` por e-mail e push (push "Seu pedido de consulta não foi confirmado." com a tela da agenda do portal); pessoa nova → `enqueueEmail` (modelo `pedido_nao_confirmado_publico`) na transação que grava `resolvido_em`. O link "Escolha outro horário" vai a `/p/agenda/nova` quando o pedido veio do portal; na pessoa nova, a `/n/<slug>` só com `agendamento_publico_ativo` (sem ele, o e-mail sai sem a frase do link); teste dos três casos em `mensagens.test.ts`. Desistência do paciente: evento `pedido_desistido` de `aviso-nutri.ts` à nutricionista (AG-D42). Nada por WhatsApp. O motivo da recusa nunca vai ao paciente |
| RN-429 | **Eliminação do pedido de pessoa nova.** Recusado, vencido ou desistido: apagado na primeira limpeza diária (04:30) depois de 24 h de `resolvido_em`; aceito: na primeira limpeza depois de 24 h do aceite; sem código: como hoje (24 h depois da criação, na limpeza diária). Pedido aguardando não é apagado pelas 24 h da criação. A frase do ponto de coleta diz exatamente isso ("depois de 24 horas, na limpeza diária", como o Termo 1.0; AG-D21) |
| RN-430 | **Previsão de retorno.** `consultations.retorno_previsto_em`: data entre a do atendimento e + 730 dias, informada como data ou "em {n} semanas" (convertida no fuso). O marcador é do **último** atendimento com previsão, de paciente `ativo` **sem consulta futura** em `STATUS_OCUPA`. Não vai ao portal nem à IA |
| RN-431 | **Elegível ao aniversário**, conferido ao agendar e de novo no envio (`motivoParaIgnorar`): paciente `ativo`, não anonimizado, `data_nascimento` preenchida, 18 anos ou mais no dia, autorização vigente **registrada quando o paciente já tinha 18 anos** (a de antes não conta); data entre hoje e o fim do mês **corrente** no fuso. Outros meses são só consulta ("O envio abre no dia 1º de {mês}."); aniversário anterior a hoje = "Aniversário já passou"; sem data de nascimento, fora da lista (dito na tela). Para menor de 18, "Registrar autorização" (painel) e "Autorizar" (portal) ficam desabilitados com "Menor de idade". Falhou no envio → `ignorada` com o motivo `sem_autorizacao` ou `paciente_inativo` |
| RN-432 | **Mensagem de aniversário.** Só e-mail; texto fixo (§6.2), sem oferta, preço, desconto, sorteio ou dado de saúde; assunto "Uma mensagem da sua nutricionista" (o nome do paciente só no corpo); rodapé "Mensagem enviada pelo NutriDebby a pedido de {nutricionista}." e o link de saída; agendada para as 9h do dia no fuso. Aniversariante de **hoje** marcado depois das 9h: `agendada_para` = agora (sai na próxima varredura), desde que antes das 21h (horário silencioso); depois das 21h fica desabilitado com "Passou do horário de hoje" (teste com o relógio às 15h e às 22h no fuso). **Uma por paciente por ano**: índice único parcial `(tenant_id, patient_id, date_part('year', timezone('UTC', agendada_para))) where tipo = 'aniversario'` e `ON CONFLICT` com a mesma expressão e o mesmo `WHERE` (`DO NOTHING`; segundo envio no mesmo ano devolve 0 linhas): a linha ignorada também ocupa o ano, e retirar e reautorizar no mesmo ano não reenvia |
| RN-433 | **Autorização de aniversário.** Uma linha por evento (`autorizou` ou `retirou`), estado = o último; origem `nutri` (só em nome da própria usuária; ao **autorizar**, com a frase de confirmação e a `forma`: `escrito`, `mensagem` ou `verbal`; a retirada não pede a forma, revisão do plano, AG-D61), `app` (o próprio paciente, com a própria conta) ou `link` (sem conta, pelo link do e-mail, **só `retirou`**). `autorizou` só de titular `ativo`, não anonimizado. O módulo trava o paciente (`FOR NO KEY UPDATE`) antes do INSERT, nos três canais, para o "último evento" ter ordem. Nunca se altera nem se apaga; o `whatsapp_optin_*` nunca serve de autorização |
| RN-434 | **Link de saída.** Token HMAC com a finalidade `aniversario_sair` (não serve para outra ação), sem validade curta. A página `/aniversario/sair/[token]` mostra no GET e não grava (leitores de link); o botão "Confirmar" faz POST para o handler `src/app/api/aniversario/sair/[token]/route.ts`, que é também a URL do `List-Unsubscribe`: aceita o corpo `List-Unsubscribe=One-Click` (RFC 8058) sem outro token, grava a retirada (origem `link`, `semConta`, `aniversarios.ts` em `SEM_CONTA_PERMITIDOS`) e responde 200 sem corpo. Limite por token, não por IP (os POSTs de um clique vêm dos IPs do provedor de e-mail); idempotente: retirar de novo não cria linha. O e-mail leva `List-Unsubscribe` e `List-Unsubscribe-Post` pelo campo `headers?` novo de `OutgoingEmail` (`src/email/transport.ts`), repassado ao Resend e ao Mailpit. Testes de rota (página e POST de um clique) e do transporte com os cabeçalhos |
| RN-435 | **"Abrir no WhatsApp"** só com autorização vigente e telefone; o link `wa.me` é montado no navegador da nutricionista com o texto fixo "Feliz aniversário, {primeiro nome}! {nutricionista} deseja a você um novo ano com muita saúde.", sem rodapé e sem link (nem o de saída, que é credencial do titular; mesmo motivo do INT-01); nada é gravado nem enviado pelo sistema. Teste de unidade da URL montada (sem `http` no texto) |
| RN-436 | **Filtro de local de pacientes** (Fase B): `exists` de consulta no local com status fora de `cancelada` e `solicitada`; nunca coluna no paciente |
| RN-437 | **Filtro de local do Financeiro** (Fase B): `fin_lancamentos.appointment_id → appointments.local_id`; "Sem local" para o resto; Lançamentos, CSV e "Entradas e saídas nos últimos 12 meses"; Resumo, saldo e Fluxo de caixa sem filtro, com "Todos os locais"; soma dos locais + "Sem local" = total (teste de propriedade) |
| RN-438 | **Titular.** O `dados.json` leva o **nome** do local em cada consulta (seção `consultas`, chave `local`), a previsão de retorno (`atendimentos[].retornoPrevistoEm`: a exportação lista as colunas de `consultations` à mão, e a coluna é acrescentada) e a seção nova `aniversario` (evento, origem, forma, data); `cancelarFuturasPelaExclusao` cancela os pedidos; `app_anonimizar_autorizacoes_aniversario` anula só o `registrado_por` de origem `app` (o da nutricionista é autoria, ECF.17.01) e exige titular bloqueado com `anonimizado_em` nulo (molde 0065 e `app_anonimizar_autorizacoes_ia`) |
| RN-439 | **Fora da IA.** Nada de locais, aniversário, previsão de retorno ou pedido entra em contexto de IA: guarda de importação e de texto em `src/modules/ia/**` (não importa `locais`, `aniversarios`, `retorno`, `solicitacoes` nem contém `retorno_previsto`); `campos-enviados.test.ts` continua verde |

### 6.2 Textos de interface

Textos próprios, não do Dietbox. Constantes nos módulos (`MSG_LOCAIS`, `MSG_AGENDA`, `MSG_SOLICITACOES`,
`MSG_ANIVERSARIO`, `MSG_PUBLICO`); entram na tabela "Textos de interface" das histórias no fechamento.

| Chave | Texto |
|---|---|
| Locais: tela | h1 "Locais de atendimento" · "Novo local" · "Ver arquivados" · selo "Principal" · "Definir como principal" · "Editar" · "Arquivar" · "Reativar" · "Excluir" · "Salvar local" |
| Locais: campos | "Tipo" ("Presencial", "Videoconferência") · "Nome do local" (ajuda "Não use nome nem endereço de paciente.") · "Endereço" · "Cidade" · "Mostrar o endereço na página de agendamento" · "Sala fixa (link, opcional)" (ajuda "Sem sala fixa, informe o link em cada consulta.") · "Aceita agendamento pelo paciente" (ajuda "Vale para o app do paciente e, se a página de agendamento estiver ligada no Perfil, para ela também.") · "Em uso: arquive" (no lugar de "Excluir") · vazio "Cadastre um local de atendimento para marcar consultas e definir horários." · aviso "O link do Perfil mudou depois da atualização: confira a sala deste local." (RN-410a, P23-I1) |
| Locais: mensagens | "Local salvo." · "Local arquivado." · "Local reativado." · "Já existe um local com este nome." · "O nome tem de 2 a 60 caracteres." · "Este local tem consultas ou horários. Arquive em vez de excluir." · "Defina outro local como principal antes de arquivar este." · "Para aceitar agendamento pelo paciente, informe a sala fixa." · "Informe um link que comece com https://." |
| Locais: telenutrição | RN-404 (os dois avisos) |
| Perfil | "Endereço profissional (documentos)" · ajuda "Vai no cabeçalho dos documentos assinados. O endereço de cada local fica em Locais de atendimento." · aviso no lugar do link padrão: "O link da videoconferência agora fica em Locais de atendimento." (link) · sem CRN: "Informe o CRN: ele aparece na página de agendamento." |
| Agenda: navegação | "Dia" · "Semana" · "Mês" · "Lista" · "Hoje" · "Anterior" · "Próximo" · "Ir para data" · "Ir para a data" · "Mostrar 24 horas" · "Imprimir ou salvar em PDF" |
| Agenda: filtros | "Local" ("Todos os locais") · "Paciente" ("Todos") · "Previsões de retorno" · "Aniversários" · "Filtrar" · "Limpar filtros" |
| Agenda: selos e legenda | "Primeira consulta" · "Retorno" · "Pedido a responder" · "Pedido retirado pelo paciente" · "Pedido não aceito" · "Pedido vencido" · "Primeira consulta online: confira o TCLE de telenutrição antes de atender." · "Presença a registrar" · "Retorno previsto: {nome}" · "Aniversário: {nome}" · "Bloqueado: {motivo}" · "mais {n}" · título "Legenda" |
| Abas | "Agenda" · "Solicitações ({n})" · "Aniversariantes" · "Pendências" · "Horários" · "Locais" |
| Impressão | h1 "Agenda de {período}" · "Local: {nome ou Todos os locais}" · "Imprimir ou salvar em PDF" · "Voltar à agenda" · "Bloqueado" · rodapé "Contém dados pessoais de pacientes. Uso restrito do consultório." |
| Horários | "Também atender por videoconferência nestes horários" · "Você chegou ao limite de 60 horários. Apague um antes de criar outro." · "Horário criado." · "Horário excluído." · "Escolha o local." · "Configuração salva." · h2 "Pedidos de consulta" · "Confirmar os pedidos antes de marcar" · ajuda "Os pedidos feitos pelo app e pela página de agendamento esperam a sua resposta em Solicitações." |
| Solicitações | h1 "Solicitações" · "Nova pessoa: {nome}" · "App" · "Página de agendamento" · "Pedido em {dd/mm/aaaa}" · "Responda até {dd/mm/aaaa} às {hh:mm}" · "Aceitar" · "Recusar" · "Recusar o pedido de {nome}? A pessoa recebe um e-mail avisando." · "Motivo (só você vê)" · "Confirmar recusa" · vazio "Nenhum pedido aguardando resposta." · "Pedido aceito. Consulta marcada." · "Pedido recusado." · "Esse horário já está ocupado. Recuse o pedido ou combine outro horário com a pessoa." · "Este e-mail é de um paciente arquivado ou bloqueado. Recuse o pedido ou fale com a pessoa." · "Este pedido já foi respondido ou venceu." |
| Atendimento | "Retorno previsto (opcional)" ("Data" ou "Em {n} semanas") · "A previsão de retorno deve ficar entre a data do atendimento e 2 anos depois." · "Aceite o pedido antes de registrar o atendimento." |
| Portal e página pública | "Onde você quer ser atendido?" · cabeçalho "{nome profissional, ou o de exibição} · Nutricionista · {crn como gravado}" (sem CRN: "{nome} · Nutricionista") · portal: "Pedido enviado. Sua nutricionista vai confirmar o horário e você recebe um e-mail." · página pública: "Pedido enviado. {nome} vai confirmar o horário e você recebe um e-mail." · "Aguardando confirmação da nutricionista" · "Desistir do pedido" · "Desistir deste pedido?" · "Pedido cancelado." · "Não confirmado" · "Você já tem um pedido aguardando resposta. Espere a resposta antes de pedir outro horário." · ponto de coleta: "Até a resposta, guardamos seu nome, e-mail, telefone e o número de rede (IP) do seu aparelho só para este pedido. Se ele não for aceito ou o horário passar, apagamos esses dados depois de 24 horas, na limpeza diária." · página do link de desistência (pessoa nova): h1 "Seu pedido de consulta" · "Desistir do pedido de {data} às {hora}?" · "Desistir do pedido" · "Pedido cancelado." · "Este link não é válido." |
| E-mails do pedido | "Recebemos seu pedido de consulta" (corpo: "Seu pedido para {data} às {hora} foi enviado. Você recebe outro e-mail quando a nutricionista responder."; na pessoa nova, também o link "Desistir do pedido") · "Seu pedido de consulta não foi confirmado" (corpo: "O horário de {data} às {hora} não foi confirmado. Escolha outro horário: {link}", com o link da RN-428; sem link, só a primeira frase) · à nutricionista: "Novo pedido de consulta" (corpo: "{nome} pediu {data} às {hora}. Responda em Solicitações: {link de /painel/agenda/solicitacoes}") e "Pedido de consulta retirado" (corpo: "{primeiro nome} retirou o pedido de {data} às {hora}.") |
| Push do pedido | título "NutriDebby" · "Seu pedido de consulta não foi confirmado." |
| Aniversariantes | h1 "Aniversariantes de {mês}" · "Mês anterior" · "Próximo mês" · colunas "Paciente", "Dia", "Faz", "Situação" · "Pode receber" · "Sem autorização" · "Menor de idade" · "Já enviada este ano" · "Aniversário já passou" · "Passou do horário de hoje" · "O envio abre no dia 1º de {mês}." · "Pacientes sem data de nascimento não aparecem nesta lista." · "Selecionar todos" · "Limpar seleção" · "{n} marcados" · "Enviar mensagem" · "Abrir no WhatsApp" · "Registrar autorização" · "Retirar autorização" · "Como o paciente autorizou?" ("Por escrito", "Por mensagem", "Verbalmente") · confirmação "O paciente autorizou receber mensagens de aniversário. Guarde o comprovante." · prévia "Texto padrão do NutriDebby, enviado em seu nome" · "Vai para {n} pacientes por e-mail, às 9h do dia do aniversário." · "{n} de hoje saem agora." · "Mensagens agendadas: {n}." · "Abrir no WhatsApp" (texto da RN-435) · vazio "Nenhum aniversariante neste mês." · Início "Aniversariantes de hoje ({n})" |
| E-mail de aniversário | assunto "Uma mensagem da sua nutricionista" · corpo "Feliz aniversário, {primeiro nome}! {nutricionista} deseja a você um novo ano com muita saúde." · rodapé "Mensagem enviada pelo NutriDebby a pedido de {nutricionista}." · "Não quero mais receber mensagens de aniversário" (link) |
| Portal: Perfil | h2 "Receber mensagem de aniversário da sua nutricionista" · ajuda fixa "Uma mensagem por ano, por e-mail, no dia do seu aniversário. Usamos seu nome, sua data de nascimento e seu e-mail. Você pode desligar quando quiser, aqui ou pelo link no próprio e-mail." · "Autorizar" · "Retirar autorização" · "Autorizado em {dd/mm/aaaa}" · "Não autorizado" · "Menor de idade" · erro "Não foi possível salvar. Tente de novo." |
| Saída do aniversário | h1 "Mensagens de aniversário" · "Você não quer mais receber mensagens de aniversário de {nutricionista}?" · "Confirmar" · "Pronto. Você não vai mais receber mensagens de aniversário." · "Este link não é válido." |
| `ROTULO_TIPO` | "Mensagem de aniversário" · "Pedido de consulta não confirmado" |

Os textos do manual guiado (guia `agenda` com os alvos novos) ficam em rascunho até o `revisor-interface` e a Debby.
Os textos ao paciente (portal, página pública e e-mails, inclusive a ajuda do Perfil sobre o aniversário) vão no pacote
do advogado (E-09). Nos guias, cada rótulo citado entre aspas precisa existir num `.tsx` ou em `src/modules/agenda`.

---

## 7. Telas

Visual V2 do painel (tokens de `src/app/globals.css`, componentes de `src/components/ui`). Esboços; o desenho exato fica
com quem constrói e o `revisor-interface`.

**Agenda, visão Semana** (`/painel/agenda?visao=semana`)

```
Agenda
[Agenda] Solicitações (2)  Aniversariantes  Pendências  Horários  Locais
Dia  [Semana]  Mês  Lista    ‹ Anterior  Hoje  Próximo ›    Ir para data [__/__/____] [Ir para a data]
Local [Todos os locais ▾]  Paciente [Todos ▾]  [ ] Previsões de retorno  [ ] Aniversários  [ ] Mostrar 24 horas  [Filtrar]
                                                                   [Imprimir ou salvar em PDF]
        seg 16                ter 17                        qua 18 ...
08h   08:40–09:30           08:00–12:00
      Ana Souza             Bloqueado: congresso
      Retorno
      Clínica Centro · Confirmada
09h                                                       09:00 (até 10:30)
                                                          Carla Dias
                                                          Pedido a responder
Legenda: Primeira consulta · Retorno · Pedido a responder · Presença a registrar · Bloqueio · Retorno previsto · Aniversário
```

- A grade é uma `table` com `caption`, `th scope="col"` (dias) e `th scope="row"` (horas). Cada consulta é um item na
  linha da hora em que **começa**, com o horário visível ("08:40–09:30"); a que atravessa linhas aparece uma vez, no
  início, com "até hh:mm"; dentro da célula, por início. Bloqueio, do mesmo jeito ("Bloqueado: {motivo}" com o horário).
  Canceladas fora da grade (só na Lista, RN-413). O link de cada consulta é nomeado pelo conteúdo visível (paciente,
  horário, selos, local, situação), sem `aria-label` que o contradiga (WCAG 2.5.3). Teste de grade com consulta às :40 e
  outra de 90 min. A 360 px (e na visão Mês abaixo de 768 px), a grade dá lugar a uma lista por dia (`h2` por dia), sem
  rolagem horizontal da página; as duas versões ficam no HTML com `hidden md:table`/`md:hidden` e os E2E usam
  `data-testid` por versão.
- **Cores:** os selos usam só os tokens que já existem (`bg-linha`, `aviso`, `ok`, nos dois modos); a diferença entre
  eles é o texto. Alvo de 44 px no portal e na lista do celular; no desktop, o mínimo da WCAG 2.5.8 (24 px) nos links de
  célula da grade e do Mês.
- **Mês:** `table` 7 × 5 ou 6 com `caption` "{mês} de {ano}"; cada célula com "{n} consultas", até 3 nomes e "mais {n}",
  e o link do dia.
- **Solicitações:** lista de cartões (`h2` por pedido) com "Aceitar" e "Recusar"; o "Recusar" abre a confirmação, com o
  campo de motivo só no pedido de paciente, e "Confirmar recusa". As ações redirecionam para
  `/painel/agenda/solicitacoes?ok=aceito|recusado|mudou`; o texto vem de uma região `role="status"` fixa, acima e fora da
  lista, e o foco vai ao h1 (`tabIndex={-1}`), copiando `src/app/painel/financeiro/foco.ts` do Plano 20 (chega com o 20
  PR 2; se o PR 2 deste plano vier antes, o helper nasce aqui e o 20 o reaproveita no rebase). Botões repetidos levam
  `aria-label` com o nome ("Aceitar o pedido de {nome}").
- **Locais:** tabela com "Local", "Tipo", "Agendamento pelo paciente", "Ações"; o formulário mostra os campos do tipo
  escolhido. Local em uso não mostra "Excluir" ("Em uso: arquive"). Sem nenhum local ativo, Locais, Nova consulta e
  Horários mostram o estado vazio da §6.2 com o link para Locais.
- **Aniversariantes:** tabela com `caption`, caixa de seleção por linha (as desabilitadas com o motivo no texto da
  linha), "Selecionar todos" como botão que alterna com "Limpar seleção" e anuncia "{n} marcados" numa região
  `role="status"`, a prévia num diálogo de confirmação.
- **Celular (Locais e Aniversariantes):** abaixo de 768 px, as duas tabelas viram lista de cartões, sem rolagem
  horizontal. Botões repetidos (Editar, Arquivar, Recusar, Abrir no WhatsApp, Retirar autorização) levam `aria-label` com
  o nome do local ou do paciente.
- **Impressão:** `print:hidden` em tudo menos título, tabela e rodapé (padrão de `termo-ia/imprimir.tsx`); tabela simples
  por dia; bloqueio como "Bloqueado", sem motivo; "Imprimir ou salvar em PDF" e "Voltar à agenda" só na tela; o rodapé
  repete em cada página.

---

## 8. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-400 | Desempenho | Agenda (todas as visões, com filtros e marcadores) e Aniversariantes: p95 ≤ 800 ms (RNF-01) com 300 pacientes ativos e 2.000 consultas no ano; uma transação por tela; marcadores e "Retorno" em consultas agregadas por período (sem N+1); índice `(tenant_id, local_id, inicio)` em `appointments` (CS-402) |
| RNF-401 | Acessibilidade | WCAG 2.1 AA (axe sem violação, claro e escuro, 1280 e 360 px): grade com `caption` e `th scope`; selos em texto; alvos ≥ 44 px no portal e na lista do celular (24 px, WCAG 2.5.8, nos links de célula do desktop); abas com `aria-current`; `role="status"` fixo e `role="alert"` junto do campo; foco no h1 depois das ações que tiram linhas; "Ir para data" com `label` |
| RNF-402 | Privacidade em log | Regra 3: nome de paciente, e-mail, endereço de local, link da sala e texto de mensagem nunca vão para log, Sentry ou mensagem de erro; erro loga só código e motivo técnico |
| RNF-403 | Testes | (a) unidade: `calendario.ts` (virada do mês e da semana em `America/Sao_Paulo` com o servidor em UTC, 29/02), faixa da grade, elegibilidade do aniversário, chaves da impressão; (b) integração (Testcontainers): gatilhos `appointments_regras_pedido` (nascimento, remarcação, transições, papéis), `appointments_link_da_sala`, `tenants_agenda_da_equipe`, `aniversario_autorizacoes_regras`; FK composta com o tipo; principal único; `staff_only` dos locais; funções de projeção (chaves); `aguardando_fora_do_publico` (o UPDATE direto do `publico` para aguardando dá 42501; só `app_pedido_aguardar` grava); `app_pedido_aguardar` (tetos, sobreposição); corrida de dois pedidos (locais diferentes, mesmo horário; pessoa nova × paciente; portal × pessoa nova); vencimento (travas, job avulso de outro tenant); aceite de pessoa nova (e-mail virou paciente; com e sem opt-in do WhatsApp); exclusão LGPD atendida com pedido `solicitada`; remarcação pelo marcador (desistir do pedido + INSERT com `remarcada_de` dá `solicitada`; remarcação de `agendada` dá `agendada`, também dentro de SAVEPOINT); backfill dos quatro casos (com e sem endereço, com e sem link) e "página pública desligada, portal com horários"; tenant criado depois da migration e regra "ambas" gravada pela imagem antiga (`garantirLocaisIniciais`). **As funções de projeção, as de intervalos e de gravação do aguardando e o gatilho `appointments_link_da_sala` são testados com as tabelas de dono não superusuário** (molde `src/db/migrate-owner.test.ts`, ou `SET ROLE` para um dono `NOBYPASSRLS`): o `global-setup` migra como superusuário, que ignora a RLS, e com ele o teste passaria sem provar nada; (c) guardas: grep de status e de mapas `Record<string` (R-400), IA (RN-439), `SEM_CONTA_PERMITIDOS`, grep de `select()` sem colunas em `appointments` no `publico` (RN-406); rotas da saída do aniversário (página e POST de um clique) e transporte com cabeçalhos (RN-434); (d) E2E: dois locais, pedido aceito, recusado e de pessoa nova, remarcação com a chave ligada, visão Mês e impressão. Cada tarefa acrescenta a própria entrada em `ROTAS_DO_PAINEL` (`e2e/painel-rotas.ts`; `rotas-axe.test.ts` exige uma por `page.tsx`); os estados por query e com formulário aberto (Mês, Semana com 24 h e com filtros, fila com pedido, recusa aberta, prévia do aniversário) levam o laço dos três modos (claro, escuro, aparelho-escuro) e 360 px, como no Plano 11; `/aniversario/sair/[token]`, `/n/<slug>/pedido/[token]` e as telas públicas com escolha de local entram no `acessibilidade.spec` |
| RNF-404 | Fuso | Datas `date` e "hoje" por `tenants.fuso`; a mensagem de aniversário às 9h no fuso; testes com o relógio na virada |
| RNF-405 | Dependências | Nenhuma dependência nova (grade e impressão em HTML/CSS) |
| RNF-406 | Cache | Páginas da agenda com `dynamic = 'force-dynamic'`; a impressão com `Cache-Control: no-store`; nada da agenda no service worker do portal além do que já existe |
| RNF-407 | Compatibilidade | Expansão, nunca contração: a imagem anterior roda sobre o banco novo (colunas anuláveis ou com default, `tenants.endereco_consultorio` e `link_online_padrao` mantidos, chave desligada). Runbook de volta atrás: desligar a chave e responder ou cancelar os pedidos antes de voltar (R-403) |

---

## 9. Modelo de dados

Todas as mudanças de banco vão no **PR 1** (fundação): uma migration **gerada** (`pnpm db:generate`) e uma **custom**
`rls_agenda_2` (`pnpm drizzle-kit generate --custom --name rls_agenda_2`), com `DATABASE_URL_MIGRATOR` (regra 7).
Números: os que o `db:generate` der em cima da `main` do momento, nenhum reservado; quem mergeia depois gera de novo
(`sessoes-paralelas.md` §5). A gerada **não** tem edição à mão (dados e backfill ficam na custom, que é colada de novo a
cada geração).

### 9.1 `locais_atendimento` (nova, sem `patient_id`)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid FK `tenants` | |
| `nome` | text | 2–60; único entre os não arquivados do tenant (`lower(nome)`, índice parcial) |
| `tipo` | text | `presencial` \| `online` |
| `endereco` | text null | ≤ 300; CHECK: online ⇒ nulo |
| `cidade` | text null | ≤ 80 |
| `mostrar_endereco` | boolean default false | Mostra o endereço na página pública e na escolha do portal |
| `link_sala` | text null | Só online (CHECK); `^https://\S+$`, ≤ 500 (como `appointments_link_online`) |
| `agendamento_online` | boolean default false | CHECK: `not agendamento_online or (arquivado_em is null and (tipo = 'presencial' or link_sala is not null))` |
| `principal` | boolean default false | Índice único parcial `(tenant_id) where principal and arquivado_em is null`; CHECK principal ⇒ não arquivado |
| `arquivado_em` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz | |

- `unique (tenant_id, id, tipo)`: alvo das FKs compostas.
- **RLS:** `app_enable_tenant_rls('locais_atendimento')` (a `publico_negado` nega ao `publico`) +
  `app_enable_staff_only('locais_atendimento')` (nega ao `paciente`) + entrada em `STAFF_ONLY`. **Sem**
  `app_allow_publico` e fora de `PUBLICO_LIBERADO` (AG-D4).
- **Molde obrigatório das peças `SECURITY DEFINER`** (as duas funções de projeção, `app_pedidos_aguardando`,
  `app_pedido_aguardar` e o gatilho `appointments_link_da_sala`), o da `app_conteudo_por_etiqueta` (0083): o dono das
  tabelas é o migrator `NOBYPASSRLS` (`src/db/migrate.ts:35-53`) e a RLS é `FORCE`, então a função roda com o `app.role`
  de quem chamou e, sem a troca, não vê nenhuma linha (o gatilho copiaria `link_sala` nulo e todo agendamento online do
  portal e da página pública cairia no 23514; as projeções voltariam vazias; `app_pedidos_aguardando` também, e o horário
  aguardando seria oferecido a outra pessoa). Cada peça: guarda `app.role` e `app.patient_id`; nas funções, recusa (devolve vazio) fora do papel
  esperado ou com tenant nulo (o gatilho tem regra própria, abaixo); faz
  `set_config('app.role', 'worker', true)` e `set_config('app.patient_id', '', true)` antes da leitura; filtra à mão por
  `tenant_id = app_current_tenant()` (e, em `app_local_da_consulta`, por `patient_id` = o paciente guardado); restaura o
  contexto antes do `RETURN`. `SET search_path = public, pg_temp`, nomes qualificados, `REVOKE ALL … FROM PUBLIC` e
  `GRANT EXECUTE … TO nutri_app_role`. Os testes rodam com dono não superusuário (RNF-403 b).
- **Funções de projeção** (molde acima):
  - `app_locais_para_agendamento()` (papéis `publico` e `paciente`): `{ id, nome, tipo, cidade, endereco, principal,
    agendamento_online, criado_em }` de **todos** os locais ativos do tenant da sessão, na ordem principal → `created_at`
    → `id`; `nome` e `cidade` só dos que aceitam agendamento, `endereco` só com `mostrar_endereco` e agendamento; o
    recorte por `agendamento_online` é feito no código, depois da atribuição da RN-410a (revisão do plano, AG-D62);
  - `app_local_da_consulta(consulta uuid)` (papel `paciente`, com ou sem conta): `{ nome, tipo, cidade, endereco }` do
    local de uma consulta **do próprio paciente** (`patient_id = app_current_patient()`); nunca a sala.
- **Gatilho `appointments_link_da_sala`** (`BEFORE INSERT` em `appointments`, `SECURITY DEFINER`, molde acima): com
  `local_id` nulo devolve o `NEW` intacto antes de trocar o papel (consulta gravada pela imagem anterior ao PR 2); em
  **qualquer papel**, quando `origem = 'paciente'` e o local é online, `NEW.link_online := link_sala` do local (o que o
  código mandou é ignorado; o aceite da pessoa nova roda na sessão `nutri`). Só nas sessões `paciente` e `publico`, recusa com 42501 o INSERT cujo `local_id` seja de local arquivado ou sem
  `agendamento_online` (o módulo traduz para "Esse horário não está mais disponível"). O CHECK
  `appointments_link_online` roda depois dos gatilhos `BEFORE` e continua valendo.
- Sem auditoria (sem `patient_id`; não precisa de `AUDIT_EXCEPTIONS`). Entra em `FABRICAS` de
  `test/isolamento.test.ts` com nome que leva o `patientId` e `principal = false` (a fábrica roda duas vezes por tenant e
  colidiria com os índices únicos) e em `ULTIMAS` logo depois de `'appointments'` e antes de `'patients'` (FKs `NO ACTION`
  de `appointments`, `availability_rules` e `public_booking_requests`); as fábricas das filhas deixam `local_id` nulo
  (FK anulável, regra 9).
- **Locais iniciais** (custom, molde `NO FORCE … FORCE` da 0042, comentário `-- Plano 23`), por tenant:
  - "Consultório" (presencial, `endereco` = `endereco_consultorio`) quando há endereço, regra `presencial` ou `ambas`,
    ou nenhuma regra `online`;
  - "Videoconferência" (online, `link_sala` = `link_online_padrao`) quando há regra `online` ou `ambas`, ou link padrão;
  - `principal` = "Consultório" se existir, senão "Videoconferência";
  - `agendamento_online` = (presencial ou `link_sala` não nulo), **sem** olhar `agendamento_publico_ativo` (AG-D40: o
    portal nunca dependeu dessa chave e não pode perder horários no deploy).
  Teste de migration com os quatro casos (com e sem endereço × com e sem link), o caso "só online" e "página pública
  desligada: o portal continua oferecendo horários".
- **Consultório criado depois da migration e janela do deploy** (AG-D45): `garantirLocaisIniciais(tx)` em `locais.ts`,
  chamada na sessão `nutri` (Início do painel, Agenda, Horários e Locais), idempotente, sob a trava consultiva do tenant:
  cria o "Consultório" principal (presencial, `agendamento_online` verdadeiro) quando o tenant não tem nenhum local e
  aplica às regras com `local_id` nulo o backfill da RN-410a. O admin não grava em tabela com `tenant_id` (regra 1), por
  isso não nasce em `contas.ts`. A tela de Locais compara `tenants.link_online_padrao` com o `link_sala` do local
  "Videoconferência" e, se diferirem (o Perfil antigo editou o link depois do PR 1), mostra o aviso da §6.2.

### 9.2 `appointments`

- `local_id uuid null` + FK `(tenant_id, local_id, modalidade)` → `locais_atendimento (tenant_id, id, tipo)`
  `NO ACTION` (MATCH SIMPLE: consulta antiga com `local_id` nulo não é conferida) + índice `(tenant_id, local_id, inicio)`.
- **Sem backfill** das consultas antigas: um UPDATE dispararia `audit_row_change` em cada linha (um "Alterou — Agenda"
  no Histórico de todo paciente) e esbarra no `FORCE RLS` (AG-D5).
- `link_online` continua cópia na consulta (CHECK e anonimização intactos).
- CHECK `appointments_status_valido` com `solicitada` e CHECK `appointments_cancelado_por_valido` com
  `pedido_desistido`, `pedido_recusado` e `pedido_vencido` (AG-D44), pelo DROP/ADD que a gerada produz (sem edição à mão;
  o migrator do drizzle aplica as pendentes numa transação só, então `NOT VALID` + `VALIDATE` não ganharia nada; precedente:
  o CHECK de `notifications.tipo` na 0115); CHECK novo `appointments_solicitada_do_paciente`:
  `status <> 'solicitada' or origem = 'paciente'`.
- **Gatilho `appointments_regras_pedido`** (custom, `BEFORE INSERT OR UPDATE`): RN-421 e RN-422. A remarcação é provada
  pelo marcador local `app.agenda_remarcavel`, gravado pelo próprio gatilho no BEFORE UPDATE do cancelamento de uma
  consulta `agendada`/`confirmada` pelo paciente (RN-421); nada de `xmin` (num SAVEPOINT ele é o da subtransação, e não
  diz se a origem era um pedido). **Não** entra em `IMUTAVEIS` de `test/isolamento.test.ts`: as linhas da fábrica
  nascem `agendada`, o gatilho não recusa nada nelas, e `negado` só enfraqueceria a prova; a imutabilidade do pedido
  tem teste próprio (revisão do plano).

### 9.3 `availability_rules`

- `local_id uuid null` + FK `(tenant_id, local_id, modalidade)` → `locais_atendimento (tenant_id, id, tipo)`
  `NO ACTION`; CHECK `local_id is null or modalidade <> 'ambas'`.
- **Backfill** (custom, molde 0042, sem auditoria): `presencial` → "Consultório"; `online` → "Videoconferência";
  `ambas` → a linha vira `presencial` com o "Consultório" e ganha a cópia `online` com a "Videoconferência".
- A aplicação exige `local_id` na regra nova; a coluna fica anulável porque a imagem anterior ainda insere sem ela.

### 9.4 `public_booking_requests`

- Colunas novas: `fim timestamptz null`, `local_id uuid null` (FK composta com `modalidade`, `NO ACTION`),
  `aguardando_desde timestamptz null`, `resolvido_em timestamptz null`, `resolucao text null` (`aceito`, `recusado`,
  `vencido`, `desistido`; revisão do plano, AG-D63). CHECK: `aguardando_desde` ⇒ `verificado_em`, `fim` e `local_id`
  não nulos; `resolvido_em` ⇒ `aguardando_desde`; `(resolucao is null) = (resolvido_em is null)`.
- Índices: `(tenant_id, inicio) where aguardando_desde is not null and resolvido_em is null`; único parcial
  `(tenant_id, lower(email)) where aguardando_desde is not null and resolvido_em is null` (RN-425).
- **RLS:** continua `staff_only` + `publico` (select, insert, update), como na 0056, mais a política RESTRICTIVE
  `aguardando_fora_do_publico` (`FOR ALL`, papel `publico`: `USING (aguardando_desde is null)` e `WITH CHECK` com
  `aguardando_desde`, `resolvido_em` e `resolucao` nulos; `local_id` livre) e as funções
  `app_pedidos_aguardando(de, ate)` e `app_pedido_aguardar(p_pedido, p_local, p_inicio, p_fim)` (RN-425, molde da §9.1;
  `invalido` com local sem agendamento ou `verificado_em` vencido; grava `modalidade` = tipo do local). A desistência da
  pessoa nova é `app_pedido_publico_desistir(token_hash, confirmar)`, que devolve `(estado, inicio, gravou,
  primeiro_nome)`: o nome e `gravou` só na chamada que gravou, para o aviso à nutricionista sair uma vez (AG-D48, AG-D63).
  `FOR ALL`, e não só `FOR SELECT`: a política de SELECT só confere a linha nova quando o comando precisa ler (UPDATE com
  `WHERE`, INSERT com `RETURNING`), e um INSERT sem `RETURNING` ou um UPDATE sem `WHERE` passariam; o `WITH CHECK` vale em
  todo INSERT e UPDATE, por isso o `publico` não consegue gravar o aguardando direto, e é a função que grava. Testes: o
  INSERT (com e sem `RETURNING`) e o UPDATE (com e sem `WHERE`) diretos do `publico` para aguardando são recusados (42501),
  e o INSERT comum do `publico` (com ou sem `local_id`) passa; `app_pedido_aguardar` grava e confere os tetos e a sobreposição;
  o `SELECT … FOR UPDATE` do `publico` não devolve a linha aguardando (RN-424a).
- Sem `patient_id`: fora da exportação; a própria limpeza é a eliminação (RN-429).

### 9.5 `tenants`

- `agenda_confirmar_pedidos boolean not null default false` (precedente `agendamento_publico_ativo`). Gatilho novo
  `tenants_agenda_da_equipe` (`BEFORE UPDATE`): 42501 se `app_current_role()` ∈ `paciente`, `publico`, `conta`, `worker` e a
  coluna mudou (RN-420; o contexto vazio da migration e da semente passa). Os gatilhos `app_tenants_interruptores_da_admin` e `tenants_ia_nutri_da_equipe` não mudam.

### 9.6 `consultations`

- `retorno_previsto_em date null`; CHECK `retorno_previsto_em is null or retorno_previsto_em between data and data + 730`.
  Tabela já auditada (entidade `atendimentos`). A exportação lista as colunas à mão (`data` e `orientacoesPaciente`,
  `exportacao-job.ts:360`): a coluna nova é acrescentada como `atendimentos[].retornoPrevistoEm` (RN-438). A
  anonimização mantém a data, como mantém `data`.
  Não vai à IA (contrato fechado de `campos-enviados.ts`) nem ao portal (`jornada.ts:41` projeta só `id`, `data` e
  `orientacao`).

### 9.7 `aniversario_autorizacoes` (nova; prova só de inclusão)

| Coluna | Regra |
|---|---|
| `id`, `tenant_id`, `patient_id` | FK `(tenant_id, patient_id)` → `patients` |
| `evento` | `autorizou` \| `retirou` |
| `origem` | `nutri` \| `app` \| `link` |
| `registrado_em` | gravado pelo gatilho (`clock_timestamp()`) |
| `registrado_por` | uuid null: a usuária `nutri` ou a conta do paciente; nulo no `link` |
| `forma` | text null: `escrito` \| `mensagem` \| `verbal`; CHECK: obrigatória quando `origem = 'nutri'` e `evento = 'autorizou'`, opcional na retirada pela nutricionista, nula nas outras origens (como o paciente autorizou; ônus da prova do controlador, LGPD art. 8º, § 2º; retirar tem de ser fácil, art. 8º, § 5º; AG-D61) |

- Estado vigente = último evento por paciente; índice `(tenant_id, patient_id, registrado_em desc)`.
- **RLS:** `app_enable_tenant_rls` + `app_enable_patient_rls` (o paciente lê as próprias);
  `app_allow_paciente_escrita('aniversario_autorizacoes', 'insert')` + `PACIENTE_ESCREVE` + política RESTRICTIVE
  `paciente_aniversario_proprio` (canal `app` com `registrado_por = app_current_user()`; canal `link` só em `semConta`, com
  `registrado_por` nulo e **só `evento = 'retirou'`**: o link de saída nunca dá consentimento; sempre o próprio
  `patient_id`); `REVOKE UPDATE, DELETE, TRUNCATE` de `nutri_app_role`.
- **Gatilho** `aniversario_autorizacoes_regras`: grava `registrado_em`; a sessão `nutri` só usa a origem `nutri` com
  `registrado_por` = a própria usuária; recusa com 42501 `autorizou` de titular **visível** com
  `status <> 'ativo'` ou `anonimizado_em` não nulo; o `worker` não insere. Nos papéis `publico`, `conta` e `paciente`
  o gatilho não recusa por origem nem por autoria: a RLS recusa (`publico_negado`, isolamento, `paciente_aniversario_proprio`),
  para os testes de isolamento receberem a mensagem de RLS (revisão do plano). O módulo trava o paciente antes do
  INSERT (RN-433).
- **Auditoria:** em `AUDIT_EXCEPTIONS` com a justificativa (prova só de inclusão, quem e quando na própria linha, como
  `ia_autorizacoes` e `consents`).
- **Isolamento:** `FABRICAS`, `SO_INSERE` e o filtro em `SO_APAGA.patients`.
- **Anonimização:** `app_anonimizar_autorizacoes_aniversario` (`SECURITY DEFINER`, contexto `worker`, molde
  `app_anonimizar_autorizacoes_ia` e 0065) anula só o `registrado_por` de origem `app` (o da nutricionista é autoria,
  ECF.17.01) e exige o titular bloqueado com `anonimizado_em` nulo; chamada em `anonimizarVencidos` ao lado de
  `app_anonimizar_aceites`.

### 9.8 `notifications`

- CHECK de `tipo` com `aniversario` e `pedido_nao_confirmado` (DROP/ADD da gerada, como na 0115), partindo do CHECK da `main`
  na regeneração (o Plano 17 e o 22 também podem acrescentar); `TipoNotificacao` e `ROTULO_TIPO` acrescentados no fim.
  Nenhum tipo novo entra em `CONTA_COTA`. O aceite reaproveita `consulta_marcada`.
- `aniversario`: canal `email`, sem consulta (`appointment_id` e `inicio_consulta` nulos, aceito por
  `notifications_versao_da_consulta`). Índice único parcial `(tenant_id, patient_id, (date_part('year',
  timezone('UTC', agendada_para)))) where tipo = 'aniversario'` (conferido pelo revisor-rls: `timezone(text,
  timestamptz)` e `date_part` sobre `timestamp` sem fuso são `IMMUTABLE`, sem coluna gerada). O `ON CONFLICT` repete a
  expressão e o `WHERE` exatamente (RN-432).
- `pedido_nao_confirmado`: canais `email` e `push`, com a consulta (o horário pedido).
- `motivoParaIgnorar` ganha a reconferência do aniversário (RN-431) e os casos da §4.3. Motivos novos: `sem_autorizacao`,
  `consulta_nao_aceita` (o `motivo_ignorada` não tem CHECK de valores; só `notifications_motivo_so_ignorada`).

### 9.9 Ordem das migrations

1. **Gerada** (`agenda_2`): tabelas `locais_atendimento` e `aniversario_autorizacoes`; colunas de `appointments`,
   `availability_rules`, `public_booking_requests`, `tenants` e `consultations`; FKs, CHECKs (DROP/ADD simples em
   `appointments` e `notifications`, como a gerada produz) e índices. Sem edição à mão.
2. **Custom** `rls_agenda_2`: RLS das duas tabelas, `staff_only`, `app_allow_paciente_escrita`, políticas RESTRICTIVE
   (`paciente_aniversario_proprio`, `aguardando_fora_do_publico`), `REVOKE`, funções de projeção, de intervalos e de gravação
   do aguardando (`app_pedido_aguardar`), todas no molde da §9.1, gatilhos
   (`appointments_regras_pedido`, `appointments_link_da_sala`, `tenants_agenda_da_equipe`,
   `aniversario_autorizacoes_regras`), `app_anonimizar_autorizacoes_aniversario`, locais iniciais e backfill das regras
   (molde 0042), `CREATE OR REPLACE` das funções de métricas da 0059 e da 0087 (corpo copiado da `main` na regeneração).

### 9.10 Guardas e listas (só acrescentar, §6 de `sessoes-paralelas.md`)

- `rls-guard.ts`: `STAFF_ONLY` + `locais_atendimento`; `PACIENTE_ESCREVE` + `aniversario_autorizacoes`.
- `audit-guard.ts`: `AUDIT_EXCEPTIONS` + `aniversario_autorizacoes` (com a justificativa).
- `test/isolamento.test.ts`: `FABRICAS` (as duas tabelas; a de locais com nome pelo `patientId` e `principal = false`),
  `ULTIMAS` (`locais_atendimento` logo depois de `'appointments'`), `SO_INSERE` e `SO_APAGA.patients` (autorizações);
  `appointments` fora de `IMUTAVEIS` (§9.2).
- `src/db/tenant.ts`: `SEM_CONTA_PERMITIDOS` + `src/modules/agenda/aniversarios.ts` (guarda `sem-conta-guarda.test.ts`).
- `src/db/migrate.test.ts`: a guarda do `_journal.json` (`when` crescente, `idx` sem buraco) já está na `main` pelo
  Plano 20; conferir que cobre as duas novas.
- `CLAUDE.md`, regras 1, 2 e 8: frase "Plano 23" no fim de cada uma (tabelas novas, `STAFF_ONLY` com as funções de
  projeção, `PACIENTE_ESCREVE`, `AUDIT_EXCEPTIONS`, gatilhos de `appointments`, `aguardando_fora_do_publico`,
  `aceitarPedidoPublico` em `agendamento-publico.ts` gravando `consents` na sessão `nutri`, `aniversarios.ts` em
  `semConta`). Na regra 2, também as funções `SECURITY DEFINER` novas (`app_locais_para_agendamento`,
  `app_local_da_consulta`, `app_pedidos_aguardando`, `app_pedido_aguardar` e o gatilho `appointments_link_da_sala`) "com
  a troca de papel para `worker`, molde 0083". Na regra 8: "`retorno_previsto_em` lido pela agenda, pelos marcadores e
  pela seção Consultas sem `auditRead` (como a agenda, P05 D10); impressão = `exportar` da entidade `agenda`, sem
  paciente, com o período e o local em `entidade_id`".

### 9.11 O que não muda

`EXCLUDE` por tenant; `availability_blocks` (bloqueio vale para todos os locais); `tenants.endereco_consultorio` e
`link_online_padrao` (ficam: documentos assinados, `perfil-profissional.ts:60`, consultas sem local e imagem anterior);
`fuso.ts`; `CONTA_COTA`; `navegacao.ts`; `src/jobs/queues.ts`; `fin_lancamentos`; `patients`; `patient_cadastro`;
`stored_files`.

---

## 10. LGPD e normas profissionais

Pareceres pendentes na §14.2; nada aqui é parecer jurídico.

| Tema | Tratamento |
|---|---|
| Mensagem de aniversário: finalidade e base | Finalidade nova (relacionamento), fora dos "lembretes" do Termo 1.0 e do opt-in do WhatsApp (LGPD, art. 6º, I e II). O consentimento é por finalidade, e o genérico é nulo (art. 8º, § 4º): autorização **própria**, informada no ponto de coleta (canal, dados, frequência e como retirar; arts. 5º, XII, e 9º), revogável com facilidade (art. 8º, § 5º) no portal e no e-mail, com o POST de um clique (AG-D32, RN-434). A autorização registrada pela nutricionista guarda a forma (art. 8º, § 2º); a do menor de 18 não conta (art. 14). A base (consentimento ou legítimo interesse, art. 10) e a validade do opt-in declarado pela nutricionista (art. 8º, § 2º) vão ao advogado |
| Aniversário: quem recebe | Bloqueado e anonimizado nunca (art. 5º, XIII: bloqueio suspende todo tratamento); arquivado fora; menor de 18 fora (art. 14, boa prática; o consentimento do responsável vai ao advogado) |
| Aniversário: conteúdo | Texto fixo sem oferta, desconto, sorteio ou preço (Res. CFN 599/2018, art. 57; Res. CFN 856/2026, art. 68, III, compilação não oficial; DPA, cl. 3); sem dado de saúde; rodapé que identifica o envio automático (856, art. 37, "automação", boa prática até o CRN-3 responder) |
| Aniversário na agenda | Uso compatível (art. 6º, II): só no painel, só dia e mês, sem idade; nunca na página pública, no portal, na impressão ou em push (normas §2) |
| WhatsApp | Nada novo por WhatsApp (INT-01; Termos do WhatsApp proíbem "bulk messaging, auto-messaging"). O "Abrir no WhatsApp" é manual, do aparelho da nutricionista, sem cota e sem automação, e também exige a autorização de aniversário |
| Local de atendimento | O local de cada consulta é registro administrativo do atendimento (Res. CFN 594/2017, art. 4º): fica em `appointments` (auditada, exportada) e continua fiel depois de o local ser renomeado ou arquivado (FK `NO ACTION`, arquivar em vez de apagar). Filtro de pacientes derivado das consultas, sem coluna no paciente (minimização, art. 6º, III). A exportação leva o **nome** do local (art. 18, II) |
| Videoconferência (Res. CFN 760/2023) | Link externo, sem gravação oferecida pelo produto (art. 9º, VII); vídeo embutido seria suboperador novo (DPA, cl. 10). Link por consulta como padrão; sala fixa com o aviso de sala de espera (art. 9º, I e IX; 599, art. 20). O link nunca vai à página pública, ao WhatsApp, ao push nem à impressão (decisão de 02/10/2026 mantida); a tabela de locais fica fechada no banco e a cópia na consulta tem a proteção de hoje, por lista de colunas no código (AG-D4). Na primeira consulta online, a tela lembra o TCLE (RN-404). O CRN no e-mail da consulta online ficou no backlog "Telenutrição" (§19) O registro do TCLE fica para o backlog (AG-D36); o aviso do local lembra o e-Nutricionista (art. 5º) e o TCLE (art. 9º, VI) |
| Página pública | Expõe só nome do local, cidade, endereço se marcado (pode ser a casa da nutricionista), horários livres e "Nutricionista · CRN" (599, art. 21); nunca ocupação, motivo de bloqueio, nome de paciente, link ou preço (599, art. 20; art. 57). Resposta igual para paciente e não paciente (anti-enumeração) |
| Pedido de pessoa nova | Cadastro só no aceite, para manter verdadeira a frase do Termo 1.0 ("quando o agendamento é concluído, o seu cadastro é criado"); dados do pedido apagados na primeira limpeza diária depois de 24 h da resposta (arts. 15, I, e 16), com a frase no ponto de coleta igual ao Termo ("depois de 24 horas, na limpeza diária"; art. 6º, VI) e citando o IP (art. 9º). O opt-in do WhatsApp vai ao cadastro com a data da verificação do código, não a do aceite (art. 8º, § 2º). As linhas aguardando ficam fora da leitura do `publico` |
| Impressão | Impressão do navegador, nenhum arquivo no servidor (a promessa de anonimização do Termo e do DPA, cl. 5, continua verdadeira; regra 9); campos mínimos; rodapé de uso restrito (599, art. 20, I); registro `exportar` sem paciente (art. 37, SBIS) |
| Previsão de retorno | Dado do atendimento (auditado, exportado, anonimizado como a data); fora do portal e da IA |
| Leituras sem `auditRead` | Agenda filtrada por paciente, marcadores, aniversariantes e seção "Consultas": o precedente da agenda (P05 D10) e da lista de pacientes (RN-272 do Plano 18): nome, data, local e situação, sem conteúdo clínico |
| Acesso do titular | `dados.json`: nome do local nas consultas, previsão de retorno, seção `aniversario`, notificações de aniversário e de pedido na seção `lembretes` (RN-438) |
| Termo do paciente | Não muda agora (C-410). A versão seguinte cita as mensagens de aniversário e os pedidos aguardando confirmação (item para o E-09) |

---

## 11. Boas práticas SBIS NGS1

1. **Trilha** (NGS1.07): escritas em `appointments` e `consultations` pelo gatilho `audit_row_change` (aceite, recusa,
   vencimento com ator nulo, previsão de retorno); impressão com `exportar`; autorizações como prova só de inclusão.
2. **Integridade:** local com histórico nunca apagado; tipo fixo pela FK; autorizações sem UPDATE nem DELETE; o pedido
   não muda de horário, local ou paciente; transições do pedido no banco.
3. **Controle de acesso** (NGS1.03): `locais_atendimento` `staff_only` com projeções; `aguardando_fora_do_publico`; a chave
   só pela equipe; sem papel novo.
4. **Datas consistentes** (ECF.17.05): datas de calendário no fuso do consultório; `registrado_em` pelo relógio do banco.
5. **Autoria** (ECF.17.01): `registrado_por` conferido pelo gatilho; o aceite e a recusa levam a usuária da sessão.

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-400 | Um ponto de status esquecido trata `solicitada` como marcada (lembrete, presença, métrica) | Tabela fechada da §4.3; `StatusConsulta` exaustivo no typecheck; teste de grep (`<> 'cancelada'`, `!== 'cancelada'`, `inArray(appointments.status`, `status === '`); teste por ponto; `motivoParaIgnorar` como defesa |
| R-401 | O link da sala vaza ao `publico` ou ao portal | `locais_atendimento` fechada (`staff_only` + `publico_negado`) + funções de projeção + gatilho de cópia (AG-D4); a cópia em `appointments.link_online` tem a proteção de hoje (lista de colunas), com teste das chaves de `horariosLivres`/`resolver()` e guarda de grep contra `select()` sem colunas no `publico` (CS-401) |
| R-402 | Mês com marcadores fica lento | Consultas agregadas por período; índice `(tenant_id, local_id, inicio)`; carga P08-03 (CS-402) |
| R-403 | Volta atrás para a imagem anterior com `solicitada` no banco, `cancelado_por` novos ou regras sem "ambas" | A chave nasce desligada; o runbook manda desligar a chave e responder ou cancelar os pedidos antes de voltar; a imagem anterior lê as regras pela modalidade e as regras que ela gravar sem local são absorvidas pela RN-410a; o gatilho de link só age em `origem = 'paciente'` com local |
| R-404 | Worker antigo pega uma notificação `aniversario` ou `pedido_nao_confirmado` e falha (`sem_modelo`) | App e worker sobem na mesma imagem; o aniversário é agendado para as 9h, nunca imediato |
| R-405 | O gatilho de pedido barra um fluxo legítimo de paciente (remarcação, link sem conta) | Exceção explícita do `remarcada_de` (RN-421) com teste nos dois sentidos; E2E de remarcação com a chave ligada |
| R-406 | Dois endereços (Perfil × locais) confundem | Rótulo "Endereço profissional (documentos)" com a ajuda; o link padrão sai do Perfil (AG-D7) |
| R-407 | Conflitos de merge com o 18 PR 2, o 19 e o 20 PR 2 | Ordem dos PRs (§15) e regras da §13; Fase B com portão |
| R-408 | Pessoa nova aguardando: a nutricionista marca por cima e o aceite falha | A grade mostra o pedido; o portal toma a trava do tenant e confere os aguardando (RN-425); o aceite trata a sobreposição com mensagem clara; a recusa avisa a pessoa |
| R-409 | E-mails descartáveis travam a agenda com pedidos aguardando | Teto 1 por e-mail e 20 por consultório; código por e-mail, Turnstile e limites de IP que já existem (RN-16); vencimento em início − antecedência |
| R-410 | `CREATE OR REPLACE` das funções de métricas pisa numa versão mais nova da `main` | Copiar o corpo da `main` na regeneração (§5, passo 4) e testar com `metricas-sucesso.test.ts` |
| R-411 | Grade de horas inacessível ou com rolagem horizontal a 360 px | `table` com `caption` e `th scope`; lista por dia no celular; axe e revisor-interface |
| R-412 | O e-mail de aniversário cai em spam ou parece propaganda | Texto fixo neutro, sem link de oferta, `List-Unsubscribe`, assunto sem o nome |
| R-413 | O Termo 1.0 não fala do pedido aguardando nem da mensagem de aniversário | Aviso no ponto de coleta (página pública, portal, lista de aniversariantes); itens para o E-09 (C-410) |
| R-414 | A onda 1 atrasa e a Fase B fica parada | Portão explícito: a Fase B só abre com o 18 PR 2 e o 20 PR 2 na `main`; se atrasar, vira o Plano 23B sem refazer a spec (AG-D38) |

Também: **não exigir snapshot** antes da migration em produção (o snapshot da Hostinger congela a VPS, CLAUDE.md do
servidor): migration só aditiva e o backup diário.

---

## 13. Conflitos com a onda 1 (e com os Planos 21 e 22)

Conferido com `git diff --name-only 6c3ee8f...HEAD` em `nutridebby-18` (`plano-18-pr2`, 2061d0c), `nutridebby-b`
(`plano-19-plano-alimentar-2`, 4d07fc1) e `nutridebby-c` (`plano-20-financeiro`, c9ade41) em 17/11/2026 (revisão); os
branches andam: reconferir na T1 e na T11.

| Onde | Quem | Conflito | Como resolver |
|---|---|---|---|
| `drizzle/` | 18 PR 2 (0124–0125 no branch), 19 (0124–0133 no branch), 20 PR 2 (sem migration); 21 e 22 | Números e journal colidem | §5: gerar de novo sobre a `main` no momento do PR 1; nada reservado; um PR com migration por vez na fila de merge |
| `src/modules/pacientes/pacientes.ts`, `src/app/painel/pacientes/page.tsx` | 18 PR 2 (reescreve a lista) | O filtro de local pendura no ponto de extensão do PR 2 | US-415 na Fase B, depois do merge; só `localId?` em `FiltroDaLista` e um `exists` em `conds` |
| `src/app/painel/agenda/nova/page.tsx` | 18 PR 2 (`listarPacientes({ aba, ordem: 'registro' })`) | Seletor de local no mesmo arquivo | Rebase; manter a chamada do 18 |
| `src/db/tenant.ts` (`SEM_CONTA_PERMITIDOS`) + `sem-conta-guarda.test.ts` | 18 PR 2 (acrescenta `ficha/no-app.ts`) | `aniversarios.ts` entra na mesma lista | Só acrescentar no fim |
| `src/modules/agenda/agendamento-publico.test.ts` | 18 PR 2 | O fluxo do pedido reescreve testes | Rebase; casos novos em `describe` próprios |
| `patients`, gatilho `paciente_colunas` (0119), `patient_cadastro` | 17 (main), 18 PR 2 | Local ou autorização no paciente | Evitado (AG-D11, AG-D32); só leitura de `nome_social` no worker, com recuo (AG-D35) |
| `consultas/[id]/page.tsx`, `agenda/actions.ts`, `presenca.ts` (e testes) | 20 PR 2 ("Cobrança", `registrarPresenca` → `{ cobranca }`) | Local, Aceitar/Recusar e status nos mesmos arquivos | PR 2 e PR 3 deste plano depois do merge do 20 PR 2; não mudar a assinatura de `registrarPresenca` |
| `pacientes/atendimentos.ts`, `[id]/atendimentos/*` | 20 PR 2 (`registrarAtendimento` → `{ id, cobranca }`) | Campo "Retorno previsto" e recusa do pedido | Depois do merge; só acrescentar |
| `src/modules/financeiro/*`, `src/app/painel/financeiro/*` | 20 PR 2 (cria tudo) | Arquivos ainda não existem na `main` | US-416 na Fase B; manter `resumo-propriedade.test.ts` |
| `src/app/p/(portal)/perfil/*` (`privacidade.tsx`, `page.test.ts`) | 20 PR 2 | A chave do aniversário entra no mesmo Perfil | Componente novo; só acrescentar na página |
| `src/modules/portal/mural.ts` (+ testes) | 19 (reescreve o mural) | A §4.3 mexe no filtro de status (`mural.ts:57`) | Rebase sobre o 19; uma linha |
| `src/worker/index.ts`, `src/jobs/queues.ts` | 19 (fila `plano-pdf-2`) | — | Não mexer: `vencerSolicitacoes` é chamada dentro de `processarNotificacoes` (C-403); nenhuma fila nova (AG-D37) |
| `src/email/templates.tsx`, `src/email/render.test.ts` | 20 PR 2 | Modelos novos (pedido, aniversário) | Só acrescentar os modelos no fim |
| `src/email/transport.ts` | ninguém da onda 1 | Campo `headers?` (RN-434) | Livre; acréscimo opcional, sem mudar os chamadores |
| `src/lib/tenant-session.ts` (`ApiNutri.motivo`) | 20 PR 2 | — | Não mexer |
| `src/app/painel/agenda/actions.test.ts`, `src/modules/pacientes/exportacao.test.ts` | 20 PR 2 (e 18 PR 2 no `exportacao.test.ts`) | Casos novos | Rebase; `describe` próprios |
| `docs/manual-tecnico/06-worker-seguranca-operacao.md` | 20 PR 2 | O 23 documenta `vencerSolicitacoes` em `processarNotificacoes` e a rota de um clique | Rebase; seção nova no fim; entra na PM-A12 |
| `src/app/painel/financeiro/foco.ts` | 20 PR 2 (cria) | Padrão de foco da fila Solicitações | Reaproveitar depois do merge; se vier antes, o helper nasce no 23 (§7) |
| `src/app/painel/configuracoes/page.tsx` | 19 (três cartões no fim de `CARTOES`) | Cartão "Locais de atendimento" | Só acrescentar no fim |
| `src/app/painel/navegacao.ts` | 20 PR 2 ("Financeiro") | — | Não mexer (AG-D37) |
| `src/modules/ficha/secoes/index.ts` | 18 PR 2, 20 PR 2, talvez 21 e 22 | Seção nova | Arquivo novo + uma linha no fim de `SECOES_DA_FICHA` |
| `src/modules/agenda/fuso.ts` | Proibido (19 e 20) | Helpers de mês | `calendario.ts` |
| `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md` | 18 PR 2, 19, 20 PR 2, 21, 22 | Entradas novas | Só acrescentar no fim de cada bloco; no `CLAUDE.md`, ficar com a linha da `main` e reacrescentar a frase "Plano 23" |
| `notificacoes/{tipos,mensagens,enviar}.ts` e o CHECK de `notifications.tipo` | 17 (main); 22 pode criar tipos | Tipos novos | Partir do CHECK da `main` na regeneração; acrescentar no fim |
| `src/email/types.ts` e modelos | 22 talvez | Modelos novos | Acrescentar no fim da união |
| `e2e/agenda.spec.ts`, `e2e/painel-rotas.ts`, `e2e/acessibilidade-painel.spec.ts`, `scripts/e2e-seed.ts` | 18 PR 2, 19 (`painel-rotas.ts`), 20 PR 2 (cada "Realizada" cria cobrança) | Seletores da grade nova; horários da semente no `EXCLUDE` | Rebase sobre os dois; horários próprios do 23; um E2E por vez |
| `src/modules/ajuda/conteudo.ts`, `ajuda/portal.ts` (+ testes) | 18 PR 2, 19, 20 PR 2 | Guias `agenda`, `horarios` e do portal mudam; `padrao` do `agenda` | Só acrescentar passos; cada guia com versão + 1 uma vez (PM-A12) |
| `src/modules/pacientes/{lgpd,exportacao-job}.ts` | 18 PR 2, 20 PR 2 | Seção `aniversario`, nome do local, anonimização | Só acrescentar; filtros de `SO_APAGA.patients` como linhas novas no fim |
| `docs/manual-tecnico/05-agenda-portal-conteudo.md` | 20 PR 2 (+46 linhas) | O fechamento reescreve o cap. 05 | Rebase; seções novas no fim de §5.1–5.4 |
| Textos legais (termo do paciente, DPA 1.1 do 20 PR 2) | 20 PR 2 | Aniversário e pedidos pediriam o termo 1.1 | Não mexer neste plano (C-410); o termo 1.1 pela orquestradora |
| Numeração | 21 e 22 | A proposta do 22 usa RN-340..369, que colide com a do 21 | O 23 fica no 400–439; avisar a orquestradora da colisão 21 × 22 |
| `src/app/painel/page.tsx` (Início) | nenhum da onda 1 | Cartões novos | Livre |

**Ordem:** o PR 1 (fundação) pode abrir sobre a `main` de hoje, sozinho na fila de migration. Os PRs 2 e 3 rebaseiam
depois do merge do 20 PR 2 (mesmos arquivos da consulta). A Fase B (PR 4) só abre com o 18 PR 2 e o 20 PR 2 na `main`.

---

## 14. Decisões

### 14.1 Decisões delegadas pelo dono (onda 2: "seguir as recomendações sem parar para perguntar")

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| AG-D1 | **Locais numa tabela própria** `locais_atendimento` (presencial ou online), com um principal; arquivar em vez de apagar | Função do Dietbox sem tocar `patients`; a FK `NO ACTION` mantém o histórico fiel (Res. 594, art. 4º) | §9.1, RN-401–RN-403 |
| AG-D2 | **"Atender por videoconferência" = local online com link externo** (Meet, Zoom); nada de vídeo embutido | Sem custo extra, sem suboperador novo (DPA, cl. 10), sem gravação (760, art. 9º, VII) | §2.2 |
| AG-D3 | **Link por consulta como padrão;** sala fixa opcional por local, com aviso; local online só aceita agendamento online com sala fixa | Sala fixa compartilhada deixa um paciente entrar na sessão de outro (760, art. 9º; 599, art. 20); sem sala não há link no autoagendamento (CHECK `appointments_link_online`) | RN-404, RN-405 |
| AG-D4 | **Tabela de locais fechada no banco:** `locais_atendimento` com `staff_only` (paciente) e `publico_negado` (público); `publico` e `paciente` só pelas funções `SECURITY DEFINER` de projeção (troca de papel, molde 0083); o link entra na consulta do paciente por gatilho `BEFORE INSERT`. A cópia em `appointments.link_online` tem a proteção de hoje (lista de colunas no código, `appointments` em `PUBLICO_LIBERADO`), com teste das chaves e guarda de grep | A RLS é por linha, não por coluna, e todos os contextos usam o mesmo role: projeção só no código seria defesa fraca para a fonte do link (crítica A5). Fechar também a cópia exigiria trocar a leitura de ocupação do `publico` e montar o link no worker (backlog, §19) | RN-406, §9.1, CS-401 |
| AG-D5 | **`local_id` anulável** em `appointments`, `availability_rules` e `public_booking_requests`, com FK composta com a modalidade; **sem backfill** de consultas; backfill só das regras | Um UPDATE das consultas encheria o Histórico de acessos de todo paciente e esbarra no `FORCE RLS`; expansão compatível com a imagem anterior | §9.2–9.4 |
| AG-D6 | **Locais iniciais pela migration:** "Consultório" quando há endereço, regra presencial/ambas ou nenhuma regra online; "Videoconferência" quando há regra online/ambas ou link padrão; `agendamento_online` = presencial ou com sala, sem olhar a chave da página pública (AG-D40); dados na custom (molde 0042). Consultórios novos e a janela do deploy ficam com `garantirLocaisIniciais` (AG-D45) | Nenhum consultório perde o agendamento pelo portal ou pela página pública nem fica com regra órfã no deploy (crítica A6); a custom é colada de novo a cada regeneração, a edição da gerada seria jogada fora (§5, passo 4) | §9.1, §9.3 |
| AG-D7 | **O Perfil deixa de editar o link padrão** (aviso de que ele foi para Locais); o endereço do Perfil continua como "Endereço profissional (documentos)" | Duas cópias editáveis do link divergiriam; o endereço do Perfil vai no cabeçalho dos documentos assinados (`perfil-profissional.ts:60`) e no receituário (Res. CFN 656/2020, art. 3º, XI, conforme a spec de documentos assinados; texto a conferir), sem carimbo por local. As colunas ficam para a imagem anterior e as consultas sem local | §4.1, R-406 |
| AG-D8 | **Uma agenda por consultório** (`EXCLUDE` por tenant) | A nutricionista não está em dois lugares; regras de dois locais no mesmo horário fazem o papel do antigo "ambas" | C-400, RN-408 |
| AG-D9 | **"Também atender por videoconferência nestes horários"** cria a regra-par; teto sobe para 60 | Quem usava "ambas" não cadastra tudo duas vezes; o teto de 30 chegaria pela metade (crítica B6) | RN-410 |
| AG-D10 | **Antecedência e prazo de cancelamento por consultório** | Menos campos; o Dietbox configura por local só dias e horários | §2.2 |
| AG-D11 | **Filtro de pacientes por local derivado** das consultas (sem `cancelada` e `solicitada`); nada em `patients` nem em `patient_cadastro` | Evita os conflitos com os Planos 17 e 18 e a coluna no `select()` do contexto `publico` (Plano 18 D1); minimização | RN-436 |
| AG-D12 | **Financeiro:** filtro de local só em Lançamentos (e CSV) e em "Entradas e saídas nos últimos 12 meses", via `appointment_id`; saldo, Resumo e Fluxo de caixa sem divisão | `fin_lancamentos` tem colunas fixas (RN-308 do 20); o saldo é do caixa | RN-437 |
| AG-D13 | **Página pública:** uma página com escolha de local (`?local=`), CRN no cabeçalho, endereço só se marcado, sem preço | Normas §6 (599, arts. 20, 21 e 57; 760, art. 12); o endereço pode ser a casa da nutricionista | US-403 |
| AG-D14 | **Visões:** Dia e Semana em grade de horas, Mês novo, Lista mantida; "Ir para data" e "Mostrar 24 horas" na URL; helpers em `calendario.ts` | Paridade de função; `fuso.ts` é proibido na onda; nada a guardar no banco | RN-411–RN-413 |
| AG-D15 | **"Salvar em PDF" = impressão do navegador**, campos mínimos, registro `exportar` sem paciente | Regra 9 (PDF só no worker); um PDF com vários pacientes não seria anonimizado com o titular; o diálogo do navegador já salva em PDF | RN-418, RN-419 |
| AG-D16 | **Solicitações opcionais** por consultório (chave desligada por padrão); só a sessão `nutri` muda a chave (gatilho) | Mantém o fluxo de hoje para quem não quer filtrar; a chave decide o status no banco, então vira regra de segurança (crítica B4) | RN-420 |
| AG-D17 | **Pedido de paciente = consulta `solicitada`** que segura o horário pelo `EXCLUDE`; **pessoa nova = pedido aguardando** em `public_booking_requests`, cadastro só no aceite | Mantém verdadeira a frase do Termo 1.0 sobre o cadastro; minimização (arts. 15 e 16). Tabela própria de pedidos para todos foi descartada: não seguraria o horário contra a nutricionista marcando por cima | RN-421, RN-424 |
| AG-D18 | **Proteções da pessoa nova:** linhas aguardando fora da leitura do `publico` (política) e intervalos por função; teto 1 por e-mail e 20 por consultório; trava consultiva **por tenant** | Hoje o `publico` lê a tabela inteira e os dados viveriam até 60 dias; sem teto, e-mails descartáveis travariam a agenda; a trava por horário não pega pedidos de durações diferentes (crítica A3) | RN-425 |
| AG-D19 | **Vencimento em `inicio − antecedência`**, por `vencerSolicitacoes` no começo de `processarNotificacoes` (job de minuto e envios avulsos), com leitura preguiçosa; a limpeza das 04:30 fica como rede | Pela limpeza diária o aviso chegaria depois do horário (crítica A4); depois da antecedência o horário nem seria oferecido; sem fila nova e sem mexer em `worker/index.ts` | RN-427 |
| AG-D20 | **Avisos da resposta:** paciente por `notifications` (e-mail e push); pessoa nova por `enqueueEmail`; nada por WhatsApp | `notifications.patient_id` é NOT NULL (crítica A3); WhatsApp só transacional e na cota (C-405) | RN-428 |
| AG-D21 | **Dados da pessoa nova apagados na primeira limpeza diária depois de 24 h da resposta** (até cerca de 48 h), não os 7 dias sugeridos pela lente de normas; a frase do ponto de coleta diz "depois de 24 horas, na limpeza diária", como o Termo 1.0 | Mais curto, honesto com a limpeza que existe (a promessa "em até 24 horas" seria falsa com a limpeza das 04:30) e igual ao texto do Termo; apagar no job de minuto ficou no backlog (§19) | RN-429 |
| AG-D22 | **Resposta igual na página pública**, na tela e no e-mail, **antes** do código; depois do código, só a dona do e-mail vê o teto, a recusa do próprio cadastro e o pedido aguardando | Anti-enumeração (normas §6), inclusive pelo tempo e pelo modelo do e-mail; quem já provou o código não é terceiro, e a RN fica testável (P23-M4) | RN-426 |
| AG-D23 | **Motivo da recusa só para a nutricionista**, e só no pedido de paciente; a pessoa recebe texto fixo | Texto livre por e-mail pode levar dado de saúde; na pessoa nova, o motivo seria apagado em 24 h | RN-428 |
| AG-D24 | **Remarcação de consulta aceita continua direta** (o gatilho aceita `remarcada_de` válido); pedido não se remarca (desiste e pede outro) | RN-04 e menos estados; sem a exceção, a chave ligada quebraria a remarcação (crítica A1) | RN-421 |
| AG-D25 | **Primeira consulta × Retorno derivado**, sem coluna, numa consulta agregada | Nada a manter; usa consultas realizadas e atendimentos (cobre histórico lançado à mão). Paciente vindo do Dietbox sem atendimento aparece como "Primeira consulta" | RN-416 |
| AG-D26 | **"Pendências" da legenda = presença a registrar**; pagamento pendente fica no Financeiro | O dinheiro é do Plano 20 (F-D26); a impressão não pode ter valores | RN-417 |
| AG-D27 | **"Outros" = bloqueios**; compromisso sem paciente vai ao backlog | `appointments.patient_id` é NOT NULL; os bloqueios cobrem o uso real | §2.2 |
| AG-D28 | **Previsão de retorno em `consultations.retorno_previsto_em`**; não vai ao portal nem à IA | Nasce no atendimento, que já é auditado e exportado | RN-430, §9.6 |
| AG-D29 | **Seção "Consultas" no Início da ficha**; nenhuma aba nova | Plano 18 D12 (a 14ª aba não cabe); registro de seções pronto | §4.4 |
| AG-D30 | **Agenda filtrada por paciente, marcadores, aniversariantes e seção "Consultas" sem `auditRead`** | P05 D10 e RN-272 do Plano 18: nome, data, local e situação, sem conteúdo clínico. Se o revisor-rls pedir, um `auditRead` (entidade `agenda`) no filtro por paciente | RN-414 |
| AG-D31 | **Aniversário só por e-mail na v1**; sem WhatsApp automático e sem push; "Abrir no WhatsApp" manual | INT-01, Termos do WhatsApp, cota RN-09, risco do número dos lembretes; o push não tem tela para onde levar (crítica B1) | C-405, RN-432, RN-435 |
| AG-D32 | **Autorização própria de aniversário**, em tabela de eventos (prova só de inclusão), nunca o `whatsapp_optin_*` | LGPD, art. 8º, § 4º, e art. 9º, § 2º; precedente de `ia_autorizacoes` | RN-433, §9.7 |
| AG-D33 | **Texto fixo**, sem oferta; a tela diz "Texto padrão do NutriDebby, enviado em seu nome"; rodapé de envio automático | Sem dado de saúde, oferta (599, art. 57) ou NUL; a nutricionista vê a prévia e dispara, mas não escreveu o texto | RN-432 |
| AG-D34 | **Elegíveis:** 18 anos ou mais, ativos, autorização vigente; às 9h do dia; um por ano, inclusive quando a linha foi ignorada | LGPD, art. 14 (boa prática), art. 5º, XIII; idempotência; reautorizar no mesmo ano não reenvia | RN-431, RN-432 |
| AG-D35 | **Saudação com o primeiro nome social quando houver**, senão o de registro; sem `patient_cadastro` na `main` (18 PR 2), o de registro | Recomendação da lente de normas; exceção registrada à D7 do Plano 18 (e-mails com o nome de registro), por ser a mensagem mais pessoal | C-408, §6.2 |
| AG-D36 | **Registro do TCLE de telenutrição fora** (backlog "Telenutrição", com o E-09 e o P-B3); fica só o aviso no local de videoconferência | Não está no briefing; data e forma sem o comprovante não atendem o art. 9º, parágrafo único, da 760; criaria a 2ª migration e dependeria do 18 PR 2 (crítica B1) | RN-404, §2.2 |
| AG-D37 | **Sem fila nova e sem item no menu;** contador no Início e nas abas da agenda | `worker/index.ts`, `queues.ts` (19) e `navegacao.ts` (20) disputados | C-403, §4.1 |
| AG-D38 | **Uma migration (gerada + custom) no PR 1; Fase B com portão:** os filtros externos só abrem com o 18 PR 2 e o 20 PR 2 na `main`; se a onda 1 atrasar, viram o Plano 23B sem refazer a spec | Cada migration é um ciclo de regenerar e uma vaga na fila (§5); portão explícito em vez de "depois dos merges" (crítica B1) | C-406, §15 |
| AG-D39 | **Local não é de paciente:** ajuda "Não use nome nem endereço de paciente." no nome; atendimento domiciliar no backlog | Um local "Casa da Maria" seria dado pessoal numa tabela sem anonimização (crítica C) | §6.2, §2.2 |
| AG-D40 | **`agendamento_online` do local ("Aceita agendamento pelo paciente") vale para o portal e para a página pública; a página pública continua ligada e desligada só por `tenants.agendamento_publico_ativo`;** o backfill não copia essa chave | O portal nunca dependeu da chave da página pública (`agendarComoPaciente` não a lê) e não pode perder horários em silêncio no deploy; um nome só para o campo do local, com ajuda que diz o alcance (I-01, P23-C1) | RN-405, RN-409, §9.1 |
| AG-D41 | **Janela mínima de resposta:** com a chave ligada, o portal e a página pública só oferecem horários com início ≥ agora + antecedência + 12 h (`JANELA_RESPOSTA_PEDIDO_H`); o vencimento continua em `inicio − antecedência` | Sem a janela, um pedido feito perto do limite venceria em minutos e a nutricionista nunca o veria (P23-I4) | RN-409, US-409 |
| AG-D42 | **Desistência:** a pessoa nova desiste pelo link "Desistir do pedido" do e-mail "Recebemos seu pedido" (token do próprio pedido; GET mostra, POST grava `resolvido_em`); a desistência do paciente avisa a nutricionista pelo evento `pedido_desistido` de `aviso-nutri.ts` | Paridade com o cancelamento de hoje (que avisa) e minimização: a pessoa nova não tem portal (P23-M3) | RN-428, US-408 |
| AG-D43 | **Vocabulário do pedido:** no painel, "Pedido a responder" (selo, legenda, seção da ficha); no portal, "Aguardando confirmação da nutricionista"; em e-mails, push e títulos, "pedido de consulta" | "Aguardando confirmação" ao lado de "Agendada"/"Confirmada" fazia pensar que o paciente não confirmou a presença; um termo só para o mesmo objeto (I-15) | §6.2, RN-428 |
| AG-D44 | **`cancelado_por` dos pedidos:** `pedido_desistido` (paciente), `pedido_recusado` (nutricionista) e `pedido_vencido` (sistema), só saindo de `solicitada`; o painel mostra "Pedido retirado pelo paciente", "Pedido não aceito" e "Pedido vencido", e o portal "Pedido cancelado" ou "Não confirmado" | Sem isso, todo pedido vencido apareceria como "Cancelada pelo pedido de exclusão" (texto jurídico errado) e não se distinguiria consulta cancelada de pedido não aceito; a desistência com valor próprio também nunca abre a exceção da remarcação (I-04, RN-421) | RN-422, §4.3, §9.2 |
| AG-D45 | **Locais garantidos na sessão `nutri`** (`garantirLocaisIniciais`, idempotente, nas telas do painel que usam local), não na criação da conta pelo admin | O admin não grava em tabela com `tenant_id` (regra 1); cobre o consultório criado depois da migration e as regras gravadas pela imagem antiga na janela do deploy (RLS-06, I-02, P23-I1) | RN-407, RN-410a, §9.1 |

### 14.2 Pendências externas ★ (não travam a v1)

| ID | Para quem | Pergunta | Efeito se a resposta for outra |
|---|---|---|---|
| AG-P1 ★ | Advogado (E-09) | Base legal da mensagem de aniversário (consentimento ou legítimo interesse; o opt-in declarado pela nutricionista vale?); o vínculo "paciente desta nutricionista" é dado de saúde? Menores: excluir ou consentimento do responsável? Termo 1.1 citando aniversário e pedidos aguardando (guarda até 24 h depois da resposta)? Texto do TCLE eletrônico de telenutrição (P-B3) | Ajuste de texto ou do canal; termo 1.1 pela orquestradora |
| AG-P2 ★ | CRN-3 | O art. 37 da Res. 856/2026 ("automação nas comunicações") alcança o aniversário e os lembretes? A página de agendamento precisa do CRN? Pode mostrar o preço? O aceite eletrônico do TCLE serve de comprovante? | Rodapé dos lembretes; preço na página (plano à parte) |
| AG-P3 ★ | DOU | Texto literal da Res. 760/2023 e números da 856/2026 (o DOU não abriu em 17/11/2026) | O aviso do local sai sem o número da resolução (RN-404) |
| AG-P4 ★ | Dono + Debby | Textos do manual guiado, da Central de Ajuda e da mensagem de aniversário | Só texto |

---

## 15. Pontos para o plano (PM)

| ID | Ponto |
|---|---|
| PM-A1 | **T1 — Fundação** (PR 1, sozinho na fila de migration): schema e migrations da §9 (gerada sem edição + `rls_agenda_2`), locais iniciais e backfill das regras (teste dos quatro casos, do "só online" e da página pública desligada), gatilhos (com o marcador da remarcação), funções de projeção, de intervalos e `app_pedido_aguardar` no molde da §9.1 (testes com dono não superusuário), políticas, CHECKs (com os `cancelado_por` novos), funções de métricas, guardas da §9.10, `src/modules/agenda/banco.test.ts`, `isolamento`, semente do E2E com horários próprios. TDD: os testes de banco falham antes da migration. Revisor: `revisor-rls` |
| PM-A2 | **T2 — Locais:** `locais.ts` (com `garantirLocaisIniciais`), `status.ts`, tela `/painel/agenda/locais` (estado vazio, "Em uso: arquive", aviso do link divergente), cartão no hub, Perfil (rótulo do endereço, o link padrão sai, aviso do CRN), aviso de telenutrição com o texto sem número até o DOU (RN-404) (US-400, RN-401–RN-405, RN-407). Revisores: `revisor-interface`, `normas-cfn-lgpd` |
| PM-A3 | **T3 — Local no painel:** `disponibilidade.ts` (regra com local, par de videoconferência, teto 60, RN-410a), `horarios.ts`, `consultas.ts` (Nova consulta, Alterar, detalhe, "Link da chamada"), corrida em dois locais no mesmo horário (US-401, US-402, RN-407–RN-410a) |
| PM-A4 | **T4 — Local fora do painel:** página pública e portal (escolha do local no cliente, CRN, endereço opcional, remarcação com local), `agendamento-paciente.ts`, `agendamento-publico.ts`, `acoes-link.ts`, `mensagens.ts` (push sem local), `portal/agenda.ts` pelas funções de projeção, exportação com o nome do local (US-403, RN-406, RN-438); testes de página de `/n/[slug]` com os textos novos e os dois casos de CRN |
| PM-A5 | **T5 — Visões, filtros, legenda e impressão:** `calendario.ts`, `visoes.ts`, `hrefDaAgenda`, grade Dia/Semana (itens por início), Mês, Lista (janela por paciente), "Ir para data", "Mostrar 24 horas", filtros de local e paciente, legenda, marcador de aniversário (RN-414), "Retorno" agregado; `/painel/agenda/imprimir`, `impressao.ts`, `recordAudit` com `entidade_id`, `prefetch={false}`, `print:hidden` (US-404–US-406, RN-411–RN-419); testes de fuso; axe a 360 px. Revisor: `revisor-interface` |
| PM-A6 | **T6 — Solicitações: paciente com conta:** `StatusConsulta` + `solicitada`, `STATUS_OCUPA`, **todos** os pontos da §4.3 (inclusive os mapas do portal e do link), teste de grep, `solicitacoes.ts` (aceitar, recusar, desistir, vencer em `processarNotificacoes`, travas da RN-427a), `cancelado_por` novos, tipo `pedido_nao_confirmado`, aviso à nutricionista (pedido e desistência), exclusão LGPD com pedido (US-407–US-409 do paciente, RN-420–RN-423, RN-427–RN-428). Revisores: `revisor-rls`, `normas-cfn-lgpd` |
| PM-A7 | **T7 — Solicitações: pessoa nova:** `app_pedido_aguardar` pelo módulo, tetos, trava do tenant (classe própria; o portal também toma), RN-424a, `aceitarPedidoPublico` (consents com `verificado_em`, opt-in do WhatsApp), desistência pelo link do e-mail, e-mails por `enqueueEmail`, limpeza nova (US-408–US-409 da pessoa nova, RN-424–RN-426, RN-429). Revisores: `revisor-rls`, `normas-cfn-lgpd` |
| PM-A8 | **T8 — Solicitações (telas):** fila (redirecionamento com `?ok=`, foco no h1, confirmação da recusa, "Responda até"), Aceitar e Recusar na consulta, cartão no Início, chave em Horários, "Aguardando confirmação da nutricionista" e "Desistir do pedido" no portal (confirmação e `?ok=pedido-cancelado`), textos da página pública e do ponto de coleta; E2E aceitar, recusar, pessoa nova e remarcar com a chave ligada; axe. Revisor: `revisor-interface` |
| PM-A9 | **T9 — Previsão de retorno e seção "Consultas":** campo no atendimento (sem mudar o retorno `{ id, cobranca }` do 20 PR 2), `retorno.ts`, marcador, `secoes/consultas.ts` + uma linha no fim de `SECOES_DA_FICHA`; guarda RN-439; `campos-enviados.test.ts` verde (US-410, US-411, RN-430) |
| PM-A10 | **T10 — Aniversariantes:** `aniversarios.ts`, página (situações novas, mês futuro só consulta, "Limpar seleção"), marcador, autorização (painel com a forma, portal com a ajuda e botão explícito, link `/aniversario/sair/[token]` + handler de um clique em `/api/aniversario/sair/[token]`, `headers` no transporte), tipo `aniversario` (e-mail), `motivoParaIgnorar`, "Abrir no WhatsApp" com texto fixo, exportação e anonimização (US-412–US-414, RN-431–RN-435, RN-438). Revisores: `normas-cfn-lgpd`, `revisor-rls` |
| PM-A11 | **T11 — Fase B, filtros externos** (só com o 18 PR 2 e o 20 PR 2 na `main`; senão vira o Plano 23B): `FiltroDaLista.localId`, filtro "Local" no Financeiro (`listarLancamentos`, CSV, 12 meses) com teste de propriedade (US-415, US-416, RN-436, RN-437) |
| PM-A12 | **T12 — Fechamento do plano** (só ele; o fechamento de cada PR é o passo final da última tarefa do PR): E2E completo (`agenda.spec.ts`, `portal.spec.ts`), axe; guias: `padrao` do `agenda` ampliado para `locais\|solicitacoes\|aniversariantes` e `/painel/agenda/imprimir` em `SEM_AJUDA` ("página de impressão, sem fluxo para ensinar"); `agenda` e `horarios` com versão + 1 uma vez cada (testes que fixam a versão atualizados) e passos com ressalva ("se você ligar 'Confirmar os pedidos antes de marcar' em Horários, aparece a aba 'Solicitações'"); o passo "Marque uma consulta presencial ou online" reescrito; guia do portal com "se a sua nutricionista confirma os pedidos" e versão + 1; manual técnico caps. 05, 06 e 02 pelo `guardiao-manual`, `CLAUDE.md`, backlog (PD-70–PD-74, itens "Fora" e §19), índice dos planos, manual do usuário (Docs) e Central de Ajuda preparados, migrations geradas de novo (§5), runbook de volta atrás (R-403) |
| PM-A13 | **PRs:** PR 1 = T1; PR 2 = T2–T5 (depois do merge do 20 PR 2, pelos arquivos da consulta); PR 3 = T6–T10; PR 4 (Fase B) = T11; a T12 só fecha o plano. As entradas de `ROTAS_DO_PAINEL` entram na tarefa que cria a página |
| PM-A14 | Agentes nas revisões: `revisor-rls` (T1, T4, T6, T7, T10), `normas-cfn-lgpd` (T2, T6, T7, T10), `revisor-interface` (T2, T5, T8, T10), `guardiao-manual` (T12) |

---

## 16. Referências

- Código (`main` 6c3ee8f): `src/db/schema/agenda.ts`, `src/db/schema/platform.ts`, `src/db/schema/pacientes.ts`,
  `src/modules/agenda/*`, `src/modules/notificacoes/{enviar,mensagens,tipos}.ts`, `src/modules/notificacoes/whatsapp/cota.ts`,
  `src/email/{queue,types}.ts`, `src/modules/pacientes/{atendimentos,lgpd,exportacao-job}.ts`, `src/modules/ficha/tipos.ts`,
  `src/db/tenant.ts`, `src/worker/index.ts`, `drizzle/0042`, `0051`, `0056`, `0059`, `0087`, `0116`.
- Onda 1: `nutridebby-18` (2061d0c), `nutridebby-b` (4d07fc1), `nutridebby-c` (c9ade41), em 17/11/2026 (reconferir na T1 e na T11).
- LGPD (Lei 13.709/2018), arts. 5º, 6º, 7º, 8º, 9º, 10, 11, 14, 15, 16, 18 e 37: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm (conferida em 17/11/2026).
- Res. CFN 599/2018, arts. 20, 21, 26 e 57: https://cfn.org.br/wp-content/uploads/resolucoes/Res_599_2018.html; Res. CFN 594/2017, arts. 3º e 4º: https://cfn.org.br/wp-content/uploads/resolucoes/Res_594_2017.htm (conferidas em 17/11/2026).
- Res. CFN 760/2023, arts. 5º, 9º, 12 e 15 (compilação não oficial, Legismap; DOU a conferir; em 17/11/2026 o DOU deu "socket hang up"); notícia oficial do CFN (TCLE antes do 1º atendimento e e-Nutricionista): https://cfn.org.br/cfn-publica-resolucao-que-regulamenta-a-telenutricao/ (17/11/2026). Res. CFN 656/2020, art. 3º, XI (receituário): só pela citação da spec de documentos assinados, **a conferir**; Res. CFN 856/2026, arts. 24, 37 e 68 (compilação não oficial, LegisWeb; vigência a conferir).
- Termos do WhatsApp ("bulk messaging, auto-messaging"): https://www.whatsapp.com/legal/terms-of-service (17/11/2026).
- SBIS — Manual de Certificação para S-RES, nível NGS1 (NGS1.03, NGS1.07, ECF.17.01, ECF.17.05).

---

## 17. Registro da revisão por lentes (17/11/2026)

Duas lentes sobre a proposta 0.1: normas (CFN, LGPD, WhatsApp) e crítica adversarial de completude (código, onda 1,
escopo). Cada achado foi conferido no código de `nutridebby-23` antes de entrar. As respostas item a item estão no
arquivo de trabalho `critica-respostas.md` da sessão; o resumo:

| Achado | Destino |
|---|---|
| Normas: opt-in próprio de aniversário, sem WhatsApp em lote, menores e bloqueados fora, texto sem oferta | Aplicado: AG-D31–AG-D34, RN-431–RN-435 |
| Normas: impressão sem arquivo e com campos mínimos | Aplicado: AG-D15, RN-418, RN-419 |
| Normas: cadastro de pessoa nova só no aceite; prazo de 7 dias | Aplicado o cadastro no aceite; prazo de 24 h em vez de 7 dias (AG-D21) |
| Normas: registro do TCLE por paciente | Não entrou: backlog (AG-D36), pela crítica B1 |
| Crítica A1 — gatilho quebrava a remarcação | Aplicado com outra condição (`xmin` da transação, não `cancelada_em = now()`, porque o cancelamento usa o relógio da aplicação): RN-421, AG-D24 |
| Crítica A2 — pontos de status faltando | Aplicado: §4.3 (`atendimentos.ts`, `enviar.ts`, `agendar.ts:234`, `webhook.ts:230`, `periodo.ts`, `p/agenda/[id]`) e o grep ampliado |
| Crítica A3 — pessoa nova (aviso, leitura do `publico`, reserva sem trava) | Aplicado: `enqueueEmail`, política `aguardando_fora_do_publico` + função de intervalos, tetos; trava **por tenant**, não por horário (AG-D18) |
| Crítica A4 — vencimento depois do horário | Aplicado em `inicio − antecedência`, pelo job de minuto; rejeitado o cancelamento dentro do envio da notificação (AG-D19) |
| Crítica A5 — link da sala no banco | Aplicado: AG-D4 |
| Crítica A6 — backfill incompleto, link em duas fontes | Aplicado: AG-D6, AG-D7 |
| Crítica B1 — escopo | Aplicado: TCLE fora, aniversário só por e-mail, tarefa de local dividida (T3/T4), Fase B com portão; 12 tarefas |
| Crítica B2 — conflitos que faltavam | Aplicado: §13 (`tenant.ts`, Perfil do portal, `mural.ts`, cap. 05, `agendamento-publico.test.ts`, `email/types.ts`) e aviso da colisão 21 × 22 |
| Crítica B3 — texto normativo forte | Aplicado: RN-404 com o portão do DOU |
| Crítica B4 — a chave como regra de segurança | Aplicado: `tenants_agenda_da_equipe` (RN-420) |
| Crítica B5 — aceite de pessoa nova | Aplicado: RN-424 |
| Crítica B6 — "ambas" dobrava o trabalho | Aplicado: par de videoconferência e teto 60 (AG-D9) |
| Crítica C (menores) | Aplicados todos: assunto sem nome, um por ano mesmo ignorada, token e `List-Unsubscribe`, `prefetch={false}`, filtro sem `solicitada`, local de paciente, paridade do e-mail, "Retorno" agregado, "texto padrão em seu nome", recuo do nome social |
| Correção própria | A proposta dizia que o CHECK de `motivo_ignorada` mudaria: ele não existe (só `notifications_motivo_so_ignorada`); tirado. Na pessoa nova, "Recusar" não pede motivo (AG-D23) |
| Normas: CRN da profissional no e-mail da consulta online (Res. 760, art. 9º; 599, art. 21) | Não entrou: backlog "Telenutrição", com o AG-D36 (§19) |
| Crítica A1 (revista em 17/11/2026) | A condição pelo `xmin` foi trocada pelo marcador `app.agenda_remarcavel` (painel de revisão, §18) |

---

## 18. Revisão da spec (17/11/2026)

Painel de quatro lentes sobre a 0.1 (revisor-rls, normas-cfn-lgpd, revisor-interface e crítico de completude), 67
achados. Cada um foi conferido no código da `main` 6c3ee8f e nos branches da onda 1; 66 aplicados (3 em parte) e 1
rejeitado. O veredito item a item fica no arquivo de trabalho `painel-respostas.md` da sessão. Mudanças relevantes:

| Achados | Mudança |
|---|---|
| P23-RLS-01 (crítico) | Funções `SECURITY DEFINER` e o gatilho `appointments_link_da_sala` no molde da 0083 (troca de papel para `worker`, filtro à mão por tenant e paciente, `search_path`, `REVOKE`/`GRANT`); testes com dono não superusuário (§9.1, RNF-403) |
| P23-RLS-02, P23-I2 | Aguardando gravado só por `app_pedido_aguardar` (tetos, sobreposição, trava); o UPDATE direto do `publico` dá 42501; teto por e-mail no índice único só como rede; RN-424a (token do aguardando não conclui de novo) |
| P23-RLS-03 | RN-422 aceita `sistema` na sessão `nutri` com o titular já bloqueado (exclusão LGPD com pedido) |
| P23-RLS-04, P23-I5 | Remarcação provada pelo marcador `app.agenda_remarcavel`, gravado pelo gatilho; fora o `xmin` (RN-421, §9.2) |
| P23-RLS-05, I-14 | Promessa do link corrigida: tabela de locais fechada, cópia na consulta com a proteção de hoje; o paciente vê o link em "Sua consulta"; `staff_only` + `publico_negado` (AG-D4, RN-406, CS-401, R-401) |
| P23-RLS-06, I-02, P23-I1 | `garantirLocaisIniciais` na sessão `nutri` (consultório novo e janela do deploy), RN-410a para regra sem local, estado vazio e aviso do link divergente (AG-D45); a criação em `contas.ts` foi rejeitada (regra 1) |
| P23-RLS-07 | Período e local da impressão em `entidade_id`, sem coluna nova em `audit_log` (RN-419) |
| P23-RLS-08, P23-RLS-13 | Ordem de travas do pedido (RN-427a) e classe própria da trava do tenant (RN-425) |
| P23-RLS-10, -11, -12, -14, -15, -16 | Fábrica e `ULTIMAS` de locais; sem `NOT VALID` (DROP/ADD da gerada); autorização: `link` só retira, titular ativo, anonimização só do `app`, trava; gatilho recusa local arquivado ou sem agendamento; frases do `CLAUDE.md`; expressão do índice do aniversário fixada |
| I-01, P23-C1 (críticos) | `agendamento_online` não copia a chave da página pública; vale para portal e página pública, e a página pública continua dependendo de `agendamento_publico_ativo`; rótulo "Aceita agendamento pelo paciente" (AG-D40) |
| N23-01 | Push continua sem local (Plano 05, D19) |
| N23-02, N23-11 | Frase do ponto de coleta igual ao Termo ("depois de 24 horas, na limpeza diária") e com o IP (RN-429, AG-D21) |
| N23-03 | Opt-in do WhatsApp do pedido com a data da verificação (RN-424) |
| N23-04, I-16, N23-05, N23-07 | Ajuda fixa e botão explícito no Perfil do portal; coluna `forma` na autorização da nutricionista; autorização de menor não conta |
| N23-06 | Marcador "Aniversário" só de ativo e não anonimizado (RN-414) |
| N23-08, -09, -10, -12, -13, -14, -15 | Cabeçalho com o CRN como gravado e sem CRN; texto do aviso sem o número da resolução; 656 "a conferir"; POST de um clique num `route.ts`; texto fixo do "Abrir no WhatsApp"; aviso de TCLE na primeira consulta online; CRN no e-mail no backlog |
| I-03, I-04, I-15 | Mapas de situação do portal e do link na §4.3; `cancelado_por` dos pedidos (AG-D44); vocabulário "Pedido a responder" / "Aguardando confirmação da nutricionista" / "pedido de consulta" (AG-D43) |
| I-05, I-06, I-08, I-13 | `hrefDaAgenda` e um parâmetro por marcador; itens da grade pelo início com horário visível; Lista por paciente com 12 meses; local escolhido no cliente e remarcação com local |
| I-07, I-09, I-22 | Seção "Consultas" (total, `status.ts`, ordem crescente, título); guias (`padrao`, `SEM_AJUDA`, versões, ressalvas); rotas do axe por tarefa |
| I-10, I-11, I-12, P23-M5, I-17–I-21 | Confirmação na recusa e na desistência, redirecionamento com `?ok=`; situações novas do aniversário e envio de hoje depois das 9h; cartões no celular; abas só nas seis telas; textos que faltavam; tokens e alvos |
| P23-I3 | `headers` no transporte de e-mail e handler `/api/aniversario/sair/[token]` com limite por token (RN-434) |
| P23-I4 | Janela mínima de resposta de 12 h (AG-D41) |
| P23-I6 | T6 (impressão) entrou na T5; a antiga T7 virou T6 (paciente com conta) e T7 (pessoa nova); a T12 só fecha o plano (§15) |
| P23-M1–M4, M6, M7 | Conflitos e hashes da §13; link do "não confirmado" por origem; desistência da pessoa nova e aviso da desistência (AG-D42); RN-426 testável (AG-D22); `vencerSolicitacoes` dentro de `processarNotificacoes` (C-403); portal toma a trava do tenant |
| P23-RLS-09 (rejeitado) | `negado` em `test/isolamento.test.ts:377` aceita qualquer 42501, inclusive a violação de RLS; com `appointments` em `IMUTAVEIS` o teste não quebra. Nada mudou |

### 18.1 Revisão do plano (17/11/2026)

A revisão do plano (50 achados, todos aplicados; ver "Revisão do plano" no plano) mudou a spec nestes pontos:

| Achados do plano | Mudança na spec |
|---|---|
| P23-PL-01 | A política RESTRICTIVE do aguardando passa a `aguardando_fora_do_publico` em toda a spec: um nome `publico%` quebra `findPublicoViolations` (AG-D64) |
| P23-PL-02, P23-PL-RLS-03 | §9.1 e RN-410a: a projeção de locais devolve todos os ativos com `principal`, `agendamento_online` e a ordem; o recorte por agendamento vem depois da atribuição (AG-D62) |
| P23-PL-03, P23-PL-RLS-04 | §9.4: coluna `resolucao`; `app_pedido_publico_desistir` devolve `gravou` e `primeiro_nome` (AG-D63) |
| P23-PL-RLS-01, P23-PL-04 | §9.7: o gatilho do aniversário deixa a recusa de `publico`, `conta` e `paciente` com a RLS |
| P23-PL-RLS-02 | §9.7 e RN-433: a retirada pela nutricionista não pede a forma (AG-D61) |
| P23-PL-RLS-05, P23-PL-12 | RN-425: trava do tenant antes da do paciente no portal (AG-D65) |
| P23-PL-RLS-06, P23-PL-RLS-10 | §9.6 e RN-438: a exportação lista colunas; `consultas[].local` e `atendimentos[].retornoPrevistoEm` |
| P23-PL-RLS-08, P23-PL-15 | §9.1: o gatilho da sala copia em qualquer papel e deixa passar `local_id` nulo |
| P23-PL-RLS-09 | §9.2 e §9.10: `appointments` fora de `IMUTAVEIS` (o P23-RLS-09 da §18 tratava de outra coisa: se o teste quebrava) |
| P23-PL-RLS-14 | RN-422: `pedido_vencido` só com o prazo vencido |
| P23-PL-RLS-15, P23-PL-24 | §9.4: `app_pedido_aguardar` confere o local e a validade e grava a modalidade do local |

---

## 19. Pendências menores (backlog)

| Item | Origem | Por que não entrou |
|---|---|---|
| CRN da profissional no e-mail da consulta online e dos lembretes online | N23-15 | Vai com o backlog "Telenutrição" (AG-D36) |
| Fechar também `appointments.link_online` ao `publico` (ocupação por função de intervalos; link montado no worker na hora do e-mail; rever o CHECK `appointments_link_online`) | P23-RLS-05, opção (b) | A v1 fica com a opção (a), a proteção de hoje com teste e guarda (AG-D4) |
| Apagar o pedido de pessoa nova no job de minuto (23 h depois da resposta), para o prazo real ficar abaixo de 24 h | N23-02, opção (1) | A v1 alinha a frase ao Termo e à limpeza diária (AG-D21) |
| Agendar a mensagem de aniversário do mês seguinte | I-12 | Na v1 o envio é só do mês corrente; os outros meses são consulta (RN-431) |
