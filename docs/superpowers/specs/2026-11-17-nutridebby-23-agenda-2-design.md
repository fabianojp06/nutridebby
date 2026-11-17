# NutriDebby — Agenda 2 (Plano 23) — Design

| Item | Valor |
|---|---|
| Versão | 0.1 (17/11/2026) |
| Data | 2026-11-17 |
| Situação | **Rascunho — revisado por lentes; decisões delegadas pelo dono (onda 2).** O dono autorizou seguir as recomendações sem parar para perguntar (briefing da onda 2): cada decisão de produto está na §14 como "AG-Dn — decisão — porquê". A proposta 0.1 passou pela lente de normas (CFN, LGPD, WhatsApp, 17/11/2026) e por uma crítica adversarial de completude; o que entrou e o que não entrou está na §17. Falta a revisão do plano (revisor-rls, revisor-interface, normas-cfn-lgpd e crítico de completude sobre o plano). Conferida contra a `main` 6c3ee8f (Planos 01–17, 18 PR 1 e 20 PR 1) |
| Itens do backlog | Paridade Dietbox, onda 2, Sessão C: **PD-70** (vários locais de atendimento), **PD-71** (visões dia, semana, mês e lista; agenda em PDF), **PD-72** (previsão de retorno, filtros e legenda), **PD-73** (aniversariantes com mensagem), **PD-74** (fila de solicitações do agendamento online). **PD-75** (Google Agenda) fica para a onda 4 (Plano 29) |
| Quando | **Plano 23**, em paralelo com os Planos 21 (`nutridebby-21`) e 22 (`nutridebby-22`) da onda 2, e depois dos Planos 18 PR 2 (`nutridebby-18`), 19 (`nutridebby-b`) e 20 PR 2 (`nutridebby-c`) da onda 1, ainda abertos. Regras de convivência em `docs/operacao/sessoes-paralelas.md` |
| Insumos | `.sessoes/onda2-briefing.md` (seção do Plano 23); levantamento do código (função a função e conflitos); lente de normas (CFN, LGPD, Termos do WhatsApp, conferida em 17/11/2026); proposta 0.1 e a crítica dela. Referência funcional: a agenda do Dietbox. **Copiamos a função, nunca a marca, os textos ou o layout** |
| Documentos de base | [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md) (US-030 a US-037, RN-03 a RN-09, RN-16), plano do Plano 05 (`docs/superpowers/plans/2026-10-01-nutridebby-05-agenda-lembretes.md`, D9 a D21), [`2026-11-16-nutridebby-18-ficha-cadastro-design.md`](2026-11-16-nutridebby-18-ficha-cadastro-design.md) (D7, D11, D12, D14, RN-272, RN-277), [`2026-11-16-nutridebby-20-financeiro-design.md`](2026-11-16-nutridebby-20-financeiro-design.md) (formato desta spec; RN-308, RN-318, RN-321, C-303, F-D26) e o manual técnico, caps. [02](../../manual-tecnico/02-banco-de-dados.md) e [05](../../manual-tecnico/05-agenda-portal-conteudo.md) |
| Numeração nova | US-400 a US-416 · RN-400 a RN-439 · RNF-400 a RNF-407 · CS-400 a CS-405 · C-400 a C-410 · R-400 a R-414 · DEP-A1 a DEP-A8 · PM-A1 a PM-A14 · **AG-D1 a AG-D39** (decisões deste documento; fora dele, cite "Plano 23, AG-Dn"). O bloco **400–439** é do Plano 23: o 230–259 é do Plano 19, o 260–284 do Plano 18, o 300–329 do Plano 20 e o 330–399 fica para os Planos 21 e 22, escritos ao mesmo tempo (conferido com `grep -rhoE '\b(US\|RN)-[2-4][0-9]{2}\b'` nos worktrees e nas propostas da onda 2 em 17/11/2026). A proposta do Plano 22 usa RN-340 a RN-369, que colide com a do 21: aviso à orquestradora (§13) |

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
   portal deixam a pessoa escolher o local. O link da sala fica guardado no banco de um jeito que o público e o portal
   nunca leem.
2. **Visões (PD-71).** Dia e Semana em grade de horas, **Mês** (novo), Lista, "Hoje", "Ir para data", "Mostrar 24 horas"
   e "Imprimir ou salvar em PDF" (impressão do navegador, sem arquivo no servidor).
3. **Filtros e legenda (PD-72).** Filtros por local, por paciente, "Previsões de retorno" e "Aniversários". Legenda em
   texto, nunca só em cor: Primeira consulta, Retorno, Aguardando confirmação, Presença a registrar, Previsão de retorno,
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
| CS-400 | Com dois locais (presencial e videoconferência) e horários por local, a página pública e o portal só oferecem horários livres de locais com agendamento online ligado, e **nunca** há duas consultas no mesmo horário em locais diferentes | E2E + teste de integração com o `EXCLUDE` (corrida de dois pedidos em locais diferentes no mesmo horário) |
| CS-401 | O link da sala **nunca** chega ao contexto `publico` nem ao `paciente` por leitura de `locais_atendimento`, e nunca aparece na página pública, no WhatsApp, no push ou na impressão | Teste de banco (`staff_only` nega a linha a `publico` e `paciente`; as funções de projeção não têm a coluna); testes de `textoWhatsapp`/`pushDaNotificacao`; teste do HTML da impressão |
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
| C-403 | **Sem fila nova no worker** (`src/worker/index.ts` e `src/jobs/queues.ts` disputados com o Plano 19). O vencimento dos pedidos roda dentro do job `notificacoes` de minuto (uma chamada a mais no callback); as mensagens saem pela varredura de notificações | AG-D19, AG-D37 |
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
| DEP-A7 | **Lista de pacientes extensível (Plano 18 PR 2)** | Filtro "Local" (US-415) | ⬜ só no branch `plano-18-pr2` (25f4787): `FiltroDaLista` com ponto de extensão (`nutridebby-18/src/modules/pacientes/pacientes.ts:242-251`) e `patient_cadastro` (0124/0125 do branch). Só a US-415 e o recuo da AG-D35 esperam o merge |
| DEP-A8 | **Telas do Financeiro (Plano 20 PR 2)** | Filtro "Local" (US-416) | ⬜ só no branch `plano-20-financeiro` (d0ae78c): `src/modules/financeiro/*`, Lançamentos, Relatórios, CSV, "Cobrança" em `consultas/[id]` e `registrarPresenca` devolvendo `{ cobranca }`. Só a US-416 espera o merge |

---

## 2. Escopo

### 2.1 Dentro

| ID | Bloco | Conteúdo | PD |
|---|---|---|---|
| AG-01 | **Locais** (`/painel/agenda/locais`) | Criar, editar, definir como principal, arquivar e reativar; excluir só sem uso; tipo presencial (endereço, cidade, "Mostrar o endereço na página de agendamento") ou videoconferência (sala fixa opcional, com aviso de telenutrição); "Aceita agendamento online" | PD-70 |
| AG-02 | **Local na consulta e nos horários (painel)** | Seletor de local em Nova consulta, Alterar e no detalhe; regras de horário por local, com "Também atender por videoconferência nestes horários"; `gerarHorarios` por local | PD-70 |
| AG-03 | **Local fora do painel** | Página pública e portal escolhem o local (no lugar de "Presencial/Online"); CRN no cabeçalho; endereço só se marcado; endereço do local nos lembretes, no link da consulta e no portal; nome do local na exportação | PD-70 |
| AG-04 | **Visões** | Dia e Semana em grade de horas; Mês; Lista; "Hoje", anterior e próximo; "Ir para data"; "Mostrar 24 horas"; no celular, Semana e Mês viram lista por dia | PD-71 |
| AG-05 | **Impressão** (`/painel/agenda/imprimir`) | "Imprimir ou salvar em PDF" do período e do filtro atuais, com campos mínimos e um registro `exportar` sem paciente | PD-71 |
| AG-06 | **Filtros e legenda** | Local, paciente, "Previsões de retorno", "Aniversários"; legenda em texto | PD-72 |
| AG-07 | **Previsão de retorno** | Campo "Retorno previsto" no atendimento; marcador na agenda com "Marcar consulta"; seção "Consultas" no Início da ficha | PD-72 |
| AG-08 | **Aniversariantes** (`/painel/agenda/aniversariantes`) | Lista do mês; autorização de mensagens de aniversário (pela nutricionista, pelo paciente no portal, retirada pelo link do e-mail); "Selecionar todos" e "Enviar mensagem" por e-mail; "Abrir no WhatsApp" manual | PD-73 |
| AG-09 | **Solicitações** (`/painel/agenda/solicitacoes`) | Chave "Confirmar os pedidos antes de marcar"; pedido do portal e da página pública; Aceitar e Recusar; vencimento; contador no Início e nas abas da agenda; "Aguardando confirmação" e "Desistir do pedido" no portal | PD-74 |
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
| **Paciente com conta** (sessão `paciente`) | Ver os locais com agendamento online (nome, cidade, endereço se marcado) e o local das próprias consultas; pedir horário (marcado direto ou como pedido, conforme a chave); ver "Aguardando confirmação"; desistir do próprio pedido; remarcar consulta já marcada (direto); autorizar ou retirar mensagens de aniversário no Perfil | Ler `locais_atendimento` (só pelas funções de projeção); ver o link de sala fixa antes de ter a consulta; ver outros pacientes, ocupação, regras ou bloqueios; passar um pedido para marcado; ver a previsão de retorno (AG-D28); mudar a chave |
| **Paciente sem conta** (link assinado, `semConta`) | As ações de hoje do link da consulta; retirar a autorização de aniversário pelo link do e-mail | Qualquer outra escrita |
| **Público** (`/n/<slug>`) | Ver locais com agendamento online (projeção) e horários livres; pedir horário | Ver link, ocupação, motivo de bloqueio, local arquivado, nome de paciente, preço, pedidos aguardando; descobrir se um e-mail já é paciente |
| **Worker** | Vencer pedidos e avisar; limpar pedidos de pessoa nova; enviar mensagens; exportar e anonimizar | Criar consulta; mudar a chave |
| **Admin** | Métricas agregadas (funções SQL da 0059 e da 0087, refeitas sem contar `solicitada`) | Consultar as tabelas da agenda |

---

## 4. Arquitetura

### 4.1 Rotas e navegação

| Tela | Rota | Título (h1) | Nova? |
|---|---|---|---|
| Agenda | `/painel/agenda?visao=dia\|semana\|mes\|lista&data=AAAA-MM-DD&local=<id>&paciente=<id>&horas=24&marcadores=retorno,aniversario` (formulário GET, funciona sem JS) | "Agenda" | Muda |
| Impressão | `/painel/agenda/imprimir?…` (mesmos parâmetros); link com `prefetch={false}` | "Agenda de {período}" | Nova |
| Locais | `/painel/agenda/locais` (`?arquivados=1`) | "Locais de atendimento" | Nova |
| Horários | `/painel/agenda/horarios` (agrupados por local; a chave "Confirmar os pedidos antes de marcar" fica aqui) | "Horários de atendimento" | Muda |
| Solicitações | `/painel/agenda/solicitacoes` | "Solicitações" | Nova |
| Aniversariantes | `/painel/agenda/aniversariantes?mes=AAAA-MM` | "Aniversariantes de {mês}" | Nova |
| Nova consulta, consulta | `/painel/agenda/nova`, `/painel/agenda/consultas/[id]` (seletor de local; Aceitar e Recusar no pedido) | como hoje | Muda |
| Início do painel | `/painel` (cartões "Solicitações ({n})" e "Aniversariantes de hoje ({n})", só quando há) | como hoje | Muda |
| Hub de configurações | `/painel/configuracoes` (cartão "Locais de atendimento" no **fim** de `CARTOES`) | como hoje | Muda (só acrescentar) |
| Perfil e marca | `/painel/configuracoes/perfil` ("Endereço profissional (documentos)"; o link padrão sai da tela com o aviso de onde ficou) | como hoje | Muda |
| Pacientes (Fase B) | `/painel/pacientes?local=<id>` | como hoje | Muda |
| Financeiro (Fase B) | `/painel/financeiro/lancamentos?local=<id>`, `/painel/financeiro/relatorios?local=<id>`, CSV com `local` | como hoje | Muda |
| Página pública | `/n/<slug>?local=<id>` (a escolha só aparece com mais de um local com agendamento online) | como hoje | Muda |
| Portal | `/p/agenda/nova?local=<id>`, `/p/agenda`, `/p/agenda/[id]` ("Aguardando confirmação", "Desistir do pedido") | como hoje | Muda |
| Portal: Perfil | `/p/perfil` ("Receber mensagem de aniversário da sua nutricionista") | como hoje | Muda |
| Saída do aniversário | `/aniversario/sair/[token]` (GET mostra; POST confirma; sem login) | "Mensagens de aniversário" | Nova |

- **Menu do painel** (`navegacao.ts`): **sem mudança** (AG-D37).
- **Abas da agenda** (links com `aria-current="page"`, não `role=tablist`, como a navegação do Financeiro): "Agenda ·
  Solicitações ({n}) · Aniversariantes · Pendências · Horários · Locais". "Solicitações" só aparece com a chave ligada
  ou com pedido pendente.

### 4.2 Módulos

Todas as funções com `withTenant(ctx, …)` e `ctx` com `actorUserId` e `ip`. As funções do painel conferem
`ctx.role === 'nutri'` antes de abrir a transação (RN-400).

| Arquivo | Papel |
|---|---|
| `src/modules/agenda/locais.ts` (novo) | CRUD de locais (sessão `nutri`); `locaisParaAgendamento(tx)` e `localDaConsulta(tx, id)`, que no `publico` e no `paciente` só chamam as funções SQL de projeção (§9.1); `localPrincipal`; `linkSugerido(local)` |
| `src/modules/agenda/calendario.ts` (novo) | Puro, sem banco: grade do mês a partir da segunda (`segundaDaSemana`), faixa de horas do dia (RN-412), validação do "Ir para data" (por `dataDaAgendaOuHoje`) |
| `src/modules/agenda/visoes.ts` (novo) | `agendaDoPeriodo(ctx, { de, ate, local, paciente, marcadores })`: consultas, bloqueios e marcadores, uma consulta por tipo no período; classificação Primeira consulta/Retorno numa consulta agregada (RN-416) e selos |
| `src/modules/agenda/solicitacoes.ts` (novo) | `listarSolicitacoes`, `contarSolicitacoes`, `aceitarSolicitacao`, `recusarSolicitacao`, `desistirDoPedido` (portal), `vencerSolicitacoes` (worker) |
| `src/modules/agenda/aniversarios.ts` (novo) | `aniversariantesDoMes`, `elegivel`, `enviarMensagensDeAniversario` (cria `notifications`), `registrarAutorizacao`, `retirarAutorizacao`, `estadoDoLinkDeSaida`, `retirarPeloLink` |
| `src/modules/agenda/retorno.ts` (novo) | `previsoesDeRetorno(tx, de, ate, filtro)` (RN-430) |
| `src/modules/agenda/impressao.ts` (novo) | Linhas da impressão por lista fechada de campos (RN-418) e o `recordAudit` `exportar` (RN-419) |
| `src/modules/ficha/secoes/consultas.ts` (novo) | Seção "Consultas" do Início da ficha (§4.4); **uma linha no fim** de `SECOES_DA_FICHA` |
| Mudam | `consultas.ts` (`local_id`, `StatusConsulta` + `solicitada`, `STATUS_OCUPA` novo), `disponibilidade.ts` (regra com local, par de videoconferência, `MAX_REGRAS` 60), `horarios.ts` (gera por local), `agendamento-paciente.ts`, `agendamento-publico.ts` (local, pedido aguardando, `aceitarPedidoPublico`, limpeza nova), `acoes-link.ts`, `cancelamento.ts`, `presenca.ts`, `inicio.ts`, `constantes.ts` (`MSG_AGENDA`, `MSG_PUBLICO`, `MSG_LOCAIS`, `MSG_SOLICITACOES`, `MSG_ANIVERSARIO`), `aviso-nutri.ts` (evento "pedido"), `notificacoes/{tipos,mensagens,enviar}.ts`, `src/email/types.ts` e modelos (pedido de pessoa nova, aniversário), `portal/agenda.ts`, `portal/jornada.ts`, `portal/mural.ts`, `pacientes/atendimentos.ts` (retorno previsto), `pacientes/exportacao-job.ts`, `pacientes/lgpd.ts`, `plataforma/metricas-sucesso.ts`, `src/db/tenant.ts` (`SEM_CONTA_PERMITIDOS` + `aniversarios.ts`) |

### 4.3 Onde o status `solicitada` entra (lista fechada)

`STATUS_ATIVOS` continua `['agendada', 'confirmada']` ("consulta marcada"). Entra
`STATUS_OCUPA = [...STATUS_ATIVOS, 'solicitada']` ("segura o horário e conta no teto"). `StatusConsulta` ganha o membro:
os `Record<StatusConsulta, …>` e os `switch` exaustivos quebram o typecheck até cada ponto ser tratado. Um teste de grep
falha se aparecer `<> 'cancelada'`, `!== 'cancelada'`, `inArray(appointments.status` ou `status === '` novo em
`src/modules` ou `src/app` fora dos pontos abaixo (R-400).

| Ponto | `solicitada` | Arquivo |
|---|---|---|
| `EXCLUDE` e horários livres (`status <> 'cancelada'`) | **Ocupa** (sem mudança de código) | 0051; `consultas.ts:100,308` |
| Teto de 3 futuras (portal e página pública) | **Conta** (`STATUS_OCUPA`) | `agendamento-paciente.ts:124`; `agendamento-publico.ts:223` |
| Cancelar futuras na exclusão LGPD | **Cancela** (`STATUS_OCUPA`) | `cancelamento.ts:127` |
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
| Portal: Minhas consultas | "Aguardando confirmação" + "Desistir do pedido" | `portal/agenda.ts:32-40`; `p/(portal)/agenda/[id]/page.tsx:25,43` |
| Portal: jornada e mural | Não mostram | `portal/jornada.ts:14`; `portal/mural.ts:57` |
| Cancelar pelo paciente | Vira "Desistir do pedido" (`cancelado_por = 'paciente'`) | `cancelamento.ts:40` |
| Remarcar pelo paciente | Não (desiste e pede outro); a consulta marcada continua remarcando direto (AG-D24) | `cancelamento.ts` (`remarcarComoPaciente`) |
| Selos e rótulos | `ROTULO_STATUS` ganha "Aguardando confirmação" | `app/painel/agenda/periodo.ts:27-31`, `item-consulta.tsx:10` |
| Métricas do admin (SQL) | **Não conta**: `CREATE OR REPLACE` das funções da 0059 e da 0087 com `not in ('cancelada','solicitada')` | migration custom do PR 1; `metricas-sucesso.ts:39-40` |
| Tela da consulta | Selo "Aguardando confirmação" + Aceitar e Recusar | `consultas/[id]/page.tsx:31-33` |

### 4.4 Ficha do paciente

Nenhuma aba nova (Plano 18 D12: a 14ª aba não cabe a 1280 px). A seção **"Consultas"** entra pelo registro
(`SecaoDaFicha`): `id: 'consultas'`, `titulo: 'Consultas'`, `aba: ''`,
`verTodos: (id) => '/painel/agenda?visao=lista&paciente=' + id`, `disponivel` = sempre, sem `adicionar` (o "Marcar
consulta" já existe na ficha), sem `leitura` (RN-277 do Plano 18: só agenda, como a P05 D10). O `resumo` devolve
`total` (consultas futuras em `STATUS_OCUPA`) e até 3 itens: as próximas consultas, com rótulo "Primeira consulta" ou
"Retorno" e situação "Agendada", "Confirmada" ou "Aguardando confirmação"; sem consulta futura e com previsão, um item
"Retorno previsto" com a data. O `noApp` conta as consultas futuras que o paciente vê em "Minhas consultas".

### 4.5 Fluxo do pedido com a chave ligada

```
Portal ou página pública (e-mail já é paciente)        Página pública (pessoa nova)
  INSERT appointments status='solicitada'                 código ok → public_booking_requests.aguardando_desde
  (gatilho exige; EXCLUDE segura o horário)               (sem paciente; teto 1/e-mail, 20/tenant; trava do tenant)
            │                                                        │
            ▼                                                        ▼
        Fila "Solicitações" (painel)  ◄──────────────────────────────┘
   Aceitar ─► agendada + lembretes + consulta_marcada        Aceitar ─► paciente + consents + consulta agendada
   Recusar ─► cancelada (nutri) + pedido_nao_confirmado       Recusar ─► resolvido_em + e-mail (enqueueEmail)
   Vence em início − antecedência (job de minuto) ─► cancelada (sistema) / resolvido_em + o mesmo aviso
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
  Quando marco "Aceita agendamento online"
  Então vejo "Para aceitar agendamento online, informe a sala fixa."

Cenário: Trocar o principal
  Quando toco em "Definir como principal" em "Clínica Centro"
  Então ela vira o principal e "Consultório" perde o selo, na mesma transação

Cenário: Local em uso
  Dado que "Consultório" tem consultas
  Quando toco em "Excluir"
  Então vejo "Este local tem consultas ou horários. Arquive em vez de excluir."
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
  Então o campo "Link da consulta" aparece com a sala fixa, se houver, e pode ser editado
  Quando escolho um local presencial
  Então o link some

Cenário: Consulta antiga
  Dado uma consulta presencial marcada antes do Plano 23
  Então o detalhe mostra "Consultório (endereço do perfil)"

Cenário: Endereço nas mensagens
  Dado uma consulta em "Clínica Centro"
  Então o lembrete por e-mail, push e WhatsApp, o link da consulta e o portal mostram o endereço de "Clínica Centro"
  E o link da sala de uma consulta online só vai no e-mail e no painel (RN-406)
```

#### US-403 — Paciente escolhe o local · **M** (PD-70)

**Como** paciente, **quero** escolher onde ser atendido ao pedir horário, **para** não marcar no lugar errado.

```gherkin
Cenário: Dois locais com agendamento online
  Quando abro a página de agendamento ou "Agendar" no portal
  Então vejo "Onde você quer ser atendido?" com os locais (nome, cidade e o endereço, se marcado)
  E os horários mostrados são só os livres daquele local

Cenário: Um local só
  Então a escolha não aparece

Cenário: Cabeçalho da página
  Dado que o CRN está preenchido no Perfil
  Então a página mostra "{nome} · Nutricionista · CRN {crn}"

Cenário: Nada a mais
  Então a página nunca mostra ocupação, bloqueio, link da sala, preço ou local arquivado
```

#### US-404 — Ver a agenda em dia, semana, mês ou lista · **M** (PD-71)

```gherkin
Cenário: Semana em grade
  Quando abro a agenda na visão "Semana"
  Então vejo uma grade com os dias nas colunas e as horas nas linhas, na faixa das regras (RN-412)
  E cada consulta é um link com o nome acessível "{paciente}, {hora}, {local}, {situação}"

Cenário: Mostrar 24 horas
  Quando marco "Mostrar 24 horas"
  Então a grade vai de 00h a 24h e a URL leva "horas=24"

Cenário: Mês
  Quando escolho "Mês"
  Então vejo a grade de segunda a domingo, com a contagem e até 3 nomes por dia e "mais {n}"
  Quando toco num dia
  Então abro a visão "Dia" daquela data

Cenário: Ir para data sem JavaScript
  Quando informo 03/02/2027 em "Ir para data" e toco em "Ir"
  Então a agenda abre na data, na visão atual

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
  E, quando é o caso, "Aguardando confirmação" ou "Presença a registrar"
  E os bloqueios aparecem como "Bloqueado: {motivo}"

Cenário: Legenda
  Então a legenda lista os mesmos rótulos em texto; a cor só reforça

Cenário: Marcadores
  Quando ligo "Previsões de retorno" e "Aniversários"
  Então vejo "Retorno previsto: {nome}" e "Aniversário: {nome}" nos dias, sem idade
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

Cenário: Registro
  Então o audit_log ganha um "exportar" da entidade "agenda", sem paciente, com o período e o local
```

#### US-407 — Ligar a confirmação dos pedidos · **S** (PD-74)

```gherkin
Cenário: Ligar
  Quando marco "Confirmar os pedidos antes de marcar" em Horários e salvo
  Então vejo a explicação "Os pedidos feitos pelo app e pela página de agendamento esperam a sua resposta em Solicitações."
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
  Então vejo "Pedido enviado. A nutricionista vai confirmar o horário e você recebe um e-mail."
  E em "Minhas consultas" o pedido aparece como "Aguardando confirmação", com "Desistir do pedido"

Cenário: Pedido pela página pública
  Quando confirmo o código de 6 dígitos
  Então vejo a mesma frase, seja o e-mail de paciente ou não (RN-426)
  E recebo o mesmo e-mail "Recebemos seu pedido de consulta", no mesmo momento, nos dois casos
  E a tela informou antes, no ponto de coleta: "Até a resposta, guardamos seu nome, e-mail e telefone só para este pedido. Se ele não for aceito ou o horário passar, apagamos esses dados em até 24 horas."

Cenário: Teto
  Dado 2 consultas futuras e 1 pedido
  Quando tento pedir outro horário
  Então vejo o aviso do teto de 3 consultas futuras

Cenário: Pessoa nova com pedido aguardando
  Dado um pedido aguardando do mesmo e-mail
  Quando tento pedir outro
  Então vejo "Você já tem um pedido aguardando resposta. Espere a resposta antes de pedir outro horário."

Cenário: Remarcar consulta já marcada
  Dado uma consulta "Agendada" e a chave ligada
  Quando remarco pelo portal ou pelo link
  Então a consulta nova nasce "Agendada", sem passar pela fila (AG-D24)
```

#### US-409 — Responder às solicitações · **M** (PD-74)

```gherkin
Cenário: Fila
  Quando abro "Solicitações"
  Então vejo paciente (ou "Nova pessoa: {nome}"), horário, local, origem ("App" ou "Página de agendamento") e "Pedido em {data}"
  E os pedidos que já venceram não aparecem

Cenário: Aceitar
  Quando toco em "Aceitar"
  Então a consulta vira "Agendada", os lembretes são agendados e o paciente recebe "consulta marcada"
  E vejo "Pedido aceito. Consulta marcada."

Cenário: Aceitar pessoa nova
  Quando aceito o pedido de "Nova pessoa: Carla Dias"
  Então nascem o cadastro (origem "agendamento_publico"), o aceite do termo (versão e momento do pedido) e a consulta "Agendada"
  Mas se o e-mail já é de um paciente ativo, a consulta vai para ele, sem cadastro novo
  E se o e-mail é de um paciente arquivado ou bloqueado, vejo "Este e-mail é de um paciente arquivado ou bloqueado. Recuse o pedido ou fale com a pessoa."

Cenário: Horário tomado
  Dado que marquei outra consulta por cima do pedido de pessoa nova
  Quando aceito
  Então vejo "Esse horário já está ocupado. Recuse o pedido ou combine outro horário com a pessoa."

Cenário: Recusar
  Quando toco em "Recusar" no pedido de um paciente
  Então posso informar "Motivo (só você vê)"
  E o paciente recebe o texto fixo "Seu pedido de consulta não foi confirmado" com "Escolha outro horário"
  Quando recuso o pedido de uma pessoa nova
  Então não há campo de motivo e a pessoa recebe o mesmo texto por e-mail

Cenário: Vencimento
  Dado um pedido para hoje às 16h e antecedência mínima de 12 h
  Quando chegam 04h sem resposta
  Então o pedido vence, sai da fila e a pessoa recebe o mesmo aviso da recusa

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
  E "Ver todos" abre a agenda em Lista filtrada por Ana
```

#### US-412 — Ver os aniversariantes do mês · **S** (PD-73)

```gherkin
Cenário: Lista
  Quando abro "Aniversariantes"
  Então vejo os pacientes ativos com aniversário no mês: nome, dia, idade que completa e a situação
  E a situação é uma de "Pode receber", "Sem autorização", "Menor de idade" ou "Já enviada este ano"

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

Cenário: Prévia e envio
  Quando toco em "Enviar mensagem"
  Então vejo a prévia, "Texto padrão do NutriDebby, enviado em seu nome" e "Vai para {n} pacientes por e-mail, às 9h do dia do aniversário."
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
  Então abre o WhatsApp do meu aparelho com o texto pronto
  E o sistema não envia nada, não grava nada e não gasta a cota
```

#### US-414 — Autorizar ou retirar mensagens de aniversário · **M** (PD-73)

```gherkin
Cenário: Pelo paciente
  Quando ligo "Receber mensagem de aniversário da sua nutricionista" no Perfil do portal
  Então vejo "Autorizado em {data}" e posso desligar a qualquer momento

Cenário: Pelo link do e-mail
  Quando toco em "Não quero mais receber mensagens de aniversário" no e-mail
  Então abro uma página que não grava nada até eu tocar em "Confirmar"
  E depois vejo "Pronto. Você não vai mais receber mensagens de aniversário."

Cenário: Pela nutricionista
  Quando toco em "Registrar autorização" na lista
  Então confirmo "O paciente autorizou receber mensagens de aniversário (por exemplo, por escrito ou por mensagem)."
  E posso "Retirar autorização" depois

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
| RN-404 | **Aviso de telenutrição** no local de videoconferência: "Antes do primeiro atendimento online, a Res. CFN 760/2023 pede o cadastro no e-Nutricionista e o TCLE de telenutrição com o comprovante guardado. Não grave as consultas." Com sala fixa, também: "Use sala de espera ou senha e admita um paciente por vez." O número da resolução só vai ao merge com o texto conferido no DOU (PM-A2); sem a conferência, o texto sai sem citar a resolução |
| RN-405 | **Agendamento online** só em local ativo e (presencial ou online com sala fixa) — CHECK no banco |
| RN-406 | **Link da sala** vai só no e-mail da consulta e no painel; nunca na página pública, no WhatsApp, no push, na impressão ou nas leituras do portal. `locais_atendimento` é `staff_only`; no `publico` e no `paciente`, local só por `app_locais_para_agendamento()` e `app_local_da_consulta(id)` (§9.1), sem a coluna da sala; na consulta de origem `paciente`, o link é copiado pelo gatilho `appointments_link_da_sala` |
| RN-407 | **Consulta com local.** Consulta nova sempre tem local (aplicação); consulta antiga sem local mostra o endereço do Perfil, como hoje |
| RN-408 | **Uma agenda por consultório.** Duas consultas não se sobrepõem, em qualquer local (`EXCLUDE` por tenant) |
| RN-409 | **Horários livres** = regras do local − bloqueios − consultas em `STATUS_OCUPA` de qualquer local − pedidos de pessoa nova aguardando (lidos por `app_pedidos_aguardando(de, ate)`, só intervalos) |
| RN-410 | **Regras.** Toda regra nova tem local; o tipo do local é a modalidade da regra; "Também atender por videoconferência nestes horários" (só em regra presencial, com um local online ativo) cria a regra-par na mesma transação; teto de **60** regras por consultório; legado acima do teto continua |
| RN-411 | **Visões.** `dia`, `semana`, `mes`, `lista`; outro valor vira `semana`. A data passa por `dataDaAgendaOuHoje` (teto hoje + 5 anos). Lista = 30 dias a partir da data. Preferências só na URL |
| RN-412 | **Faixa da grade.** Menor início e maior fim das regras dos dias mostrados, arredondados à hora; sem regra, 08h–18h; `horas=24`, 00h–24h; uma consulta fora da faixa amplia a faixa |
| RN-413 | **Mês.** Grade de segunda a domingo; por dia, a contagem (sem canceladas) e até 3 nomes, depois "mais {n}"; tocar no dia abre a visão Dia |
| RN-414 | **Leitura da agenda** (filtrada ou não, inclusive por paciente, com marcadores e a seção da ficha) **não chama `auditRead`** (P05 D10): devolve só nome, hora, local, situação, selos e, nos marcadores, nome e data |
| RN-415 | **Legenda e selos em texto** (WCAG 1.4.1); a cor só reforça |
| RN-416 | **"Retorno"** = o paciente tem consulta `realizada` antes desta **ou** atendimento com data anterior ao dia desta; senão, "Primeira consulta". Calculado no SQL numa consulta agregada por período (`min(inicio)` das realizadas e `min(data)` dos atendimentos por paciente), nunca por item. Sem coluna |
| RN-417 | **"Presença a registrar"** = a mesma regra de `pendenciasDePresenca` (US-037) |
| RN-418 | **Impressão.** Só hora, nome de registro, Primeira consulta/Retorno, local, modalidade e situação, por lista fechada no módulo com teste das chaves; rodapé fixo; nunca link, contato, observação, motivo, valor, aniversário ou previsão |
| RN-419 | **Registro da impressão.** O render do servidor de `/painel/agenda/imprimir` grava `recordAudit({ acao: 'exportar', entidade: 'agenda', patientId: null, detalhes: { de, ate, local } })` na transação da leitura; o link é `prefetch={false}` |
| RN-420 | **Chave dos pedidos** (`tenants.agenda_confirmar_pedidos`, desligada por padrão): só a sessão `nutri` muda (gatilho `tenants_agenda_da_equipe`: `paciente`, `publico` e `conta` recebem 42501). Desligar não mexe nos pedidos pendentes |
| RN-421 | **Nascimento do pedido** (gatilho `appointments_regras_pedido`, BEFORE INSERT): na sessão `paciente` ou `publico`, com a chave ligada, a consulta nasce `solicitada`, **salvo** a remarcação — `agendada` com `remarcada_de` apontando para consulta do mesmo paciente e consultório, cancelada pelo paciente **nesta transação**; com a chave desligada, `agendada`. Nas sessões `nutri` e `worker`, nunca nasce `solicitada`. CHECK: `solicitada` só com `origem = 'paciente'` |
| RN-422 | **Transições do pedido** (o mesmo gatilho, BEFORE UPDATE): de `solicitada` só para `agendada` (sessão `nutri`) ou `cancelada` (`paciente` com `cancelado_por = 'paciente'`, `nutri` com `'nutri'`, `worker` com `'sistema'`); nenhum UPDATE leva **a** `solicitada`; em `solicitada`, `inicio`, `fim`, `local_id`, `modalidade` e `patient_id` não mudam |
| RN-423 | **Onde `solicitada` conta**: a tabela fechada da §4.3 (ocupa o horário e o teto; não conta em lembretes, presença, atendimento, pendências, indicadores, nº da consulta nem métricas do admin) |
| RN-424 | **Pessoa nova** (chave ligada, e-mail sem paciente no consultório): depois do código, o pedido fica em `public_booking_requests` com `aguardando_desde`, local, início e fim; **nenhum cadastro**. No aceite (`aceitarPedidoPublico`, em `agendamento-publico.ts`): trava do tenant; se o e-mail já é de paciente ativo, a consulta vai para ele; se é de paciente arquivado ou bloqueado, recusa com mensagem; senão, cria o paciente (`origem = agendamento_publico`), o aceite do termo com `aceito_em` = `verificado_em` do pedido, o `ip` e a `termo_versao` do pedido, e a consulta `agendada` |
| RN-425 | **Proteções da pessoa nova.** No máximo 1 pedido aguardando por e-mail (sob `travarEmail`) e 20 por consultório; a gravação do aguardando e a consulta `solicitada` vinda do público tomam a trava consultiva do tenant (`pg_advisory_xact_lock` por tenant) e conferem, sob ela, a sobreposição mútua (aguardando × consultas em `STATUS_OCUPA`). As linhas aguardando ficam fora da leitura do `publico` (política RESTRICTIVE `publico_sem_aguardando`); os intervalos chegam ao `publico` só por `app_pedidos_aguardando(de, ate)` (`SECURITY DEFINER`, devolve `tstzrange`, sem dado pessoal, confere tenant e papel) |
| RN-426 | **Resposta igual.** A página pública responde com a mesma tela e manda o mesmo e-mail ("Recebemos seu pedido de consulta", pelo `enqueueEmail`, na mesma transação) para quem já é paciente e para quem não é; nada revela que o e-mail existe |
| RN-427 | **Vencimento.** O pedido vence em `inicio − antecedencia_min_h` (o mesmo prazo em que o horário deixa de ser oferecido, RN-03). `vencerSolicitacoes(agora)` roda a cada minuto dentro do job `notificacoes` (sem fila nova): `solicitada` vencida → `cancelada` com `cancelado_por = 'sistema'`; pessoa nova vencida → `resolvido_em`. Leitura preguiçosa: pedido vencido e ainda não processado aparece como "Não confirmado" no portal e não aparece na fila. A limpeza das 04:30 fica como rede |
| RN-428 | **Avisos da resposta.** Aceite: `consulta_marcada` (canais de hoje). Recusa e vencimento: paciente → `notifications` `pedido_nao_confirmado` por e-mail e push (push "Seu pedido de horário não foi confirmado." com a tela da agenda do portal); pessoa nova → `enqueueEmail` (modelo `pedido_nao_confirmado_publico`) na transação que grava `resolvido_em`. Nada por WhatsApp. O motivo da recusa nunca vai ao paciente |
| RN-429 | **Eliminação do pedido de pessoa nova.** Recusado ou vencido: apagado até 24 h depois de `resolvido_em`; aceito: até 24 h depois do aceite; sem código: 24 h depois da criação, como hoje. Pedido aguardando não é apagado pelas 24 h da criação |
| RN-430 | **Previsão de retorno.** `consultations.retorno_previsto_em`: data entre a do atendimento e + 730 dias, informada como data ou "em {n} semanas" (convertida no fuso). O marcador é do **último** atendimento com previsão, de paciente `ativo` **sem consulta futura** em `STATUS_OCUPA`. Não vai ao portal nem à IA |
| RN-431 | **Elegível ao aniversário**, conferido ao agendar e de novo no envio (`motivoParaIgnorar`): paciente `ativo`, não anonimizado, `data_nascimento` preenchida, 18 anos ou mais no dia, autorização vigente; data entre hoje e o fim do mês no fuso. Falhou no envio → `ignorada` com o motivo `sem_autorizacao` ou `paciente_inativo` |
| RN-432 | **Mensagem de aniversário.** Só e-mail; texto fixo (§6.2), sem oferta, preço, desconto, sorteio ou dado de saúde; assunto "Uma mensagem da sua nutricionista" (o nome do paciente só no corpo); rodapé "Mensagem enviada pelo NutriDebby a pedido de {nutricionista}." e o link de saída; agendada para as 9h do dia no fuso. **Uma por paciente por ano** (índice único parcial pelo ano de `agendada_para` em UTC, `ON CONFLICT DO NOTHING`): a linha ignorada também ocupa o ano, e retirar e reautorizar no mesmo ano não reenvia |
| RN-433 | **Autorização de aniversário.** Uma linha por evento (`autorizou` ou `retirou`), estado = o último; origem `nutri` (só em nome da própria usuária, com a frase de confirmação), `app` (o próprio paciente, com a própria conta) ou `link` (sem conta, pelo link do e-mail). Nunca se altera nem se apaga; o `whatsapp_optin_*` nunca serve de autorização |
| RN-434 | **Link de saída.** Token HMAC com a finalidade `aniversario_sair` (não serve para outra ação), sem validade curta; o GET mostra e não grava (leitores de link); o POST grava a retirada (`semConta`, `aniversarios.ts` em `SEM_CONTA_PERMITIDOS`), com limite por IP. O e-mail leva `List-Unsubscribe` e `List-Unsubscribe-Post` |
| RN-435 | **"Abrir no WhatsApp"** só com autorização vigente e telefone; o link `wa.me` é montado no navegador da nutricionista e nada é gravado nem enviado pelo sistema |
| RN-436 | **Filtro de local de pacientes** (Fase B): `exists` de consulta no local com status fora de `cancelada` e `solicitada`; nunca coluna no paciente |
| RN-437 | **Filtro de local do Financeiro** (Fase B): `fin_lancamentos.appointment_id → appointments.local_id`; "Sem local" para o resto; Lançamentos, CSV e "Entradas e saídas nos últimos 12 meses"; Resumo, saldo e Fluxo de caixa sem filtro, com "Todos os locais"; soma dos locais + "Sem local" = total (teste de propriedade) |
| RN-438 | **Titular.** O `dados.json` leva o **nome** do local em cada consulta (seção `agenda`), a previsão de retorno (pelo `consultations`) e a seção nova `aniversario` (evento, origem, data); `cancelarFuturasPelaExclusao` cancela os pedidos; `app_anonimizar_autorizacoes_aniversario` anula `registrado_por` na anonimização |
| RN-439 | **Fora da IA.** Nada de locais, aniversário, previsão de retorno ou pedido entra em contexto de IA: guarda de importação e de texto em `src/modules/ia/**` (não importa `locais`, `aniversarios`, `retorno`, `solicitacoes` nem contém `retorno_previsto`); `campos-enviados.test.ts` continua verde |

### 6.2 Textos de interface

Textos próprios, não do Dietbox. Constantes nos módulos (`MSG_LOCAIS`, `MSG_AGENDA`, `MSG_SOLICITACOES`,
`MSG_ANIVERSARIO`, `MSG_PUBLICO`); entram na tabela "Textos de interface" das histórias no fechamento.

| Chave | Texto |
|---|---|
| Locais: tela | h1 "Locais de atendimento" · "Novo local" · "Ver arquivados" · selo "Principal" · "Definir como principal" · "Editar" · "Arquivar" · "Reativar" · "Excluir" · "Salvar local" |
| Locais: campos | "Tipo" ("Presencial", "Videoconferência") · "Nome do local" (ajuda "Não use nome nem endereço de paciente.") · "Endereço" · "Cidade" · "Mostrar o endereço na página de agendamento" · "Sala fixa (link, opcional)" (ajuda "Sem sala fixa, informe o link em cada consulta.") · "Aceita agendamento online" |
| Locais: mensagens | "Local salvo." · "Local arquivado." · "Local reativado." · "Já existe um local com este nome." · "O nome tem de 2 a 60 caracteres." · "Este local tem consultas ou horários. Arquive em vez de excluir." · "Defina outro local como principal antes de arquivar este." · "Para aceitar agendamento online, informe a sala fixa." · "Informe um link que comece com https://." |
| Locais: telenutrição | RN-404 (os dois avisos) |
| Perfil | "Endereço profissional (documentos)" · ajuda "Vai no cabeçalho dos documentos assinados. O endereço de cada local fica em Locais de atendimento." · aviso no lugar do link padrão: "O link da videoconferência agora fica em Locais de atendimento." (link) |
| Agenda: navegação | "Dia" · "Semana" · "Mês" · "Lista" · "Hoje" · "Anterior" · "Próximo" · "Ir para data" · "Ir" · "Mostrar 24 horas" · "Imprimir ou salvar em PDF" |
| Agenda: filtros | "Local" ("Todos os locais") · "Paciente" ("Todos") · "Previsões de retorno" · "Aniversários" · "Filtrar" · "Limpar filtros" |
| Agenda: selos e legenda | "Primeira consulta" · "Retorno" · "Aguardando confirmação" · "Presença a registrar" · "Retorno previsto: {nome}" · "Aniversário: {nome}" · "Bloqueado: {motivo}" · "mais {n}" · título "Legenda" |
| Abas | "Agenda" · "Solicitações ({n})" · "Aniversariantes" · "Pendências" · "Horários" · "Locais" |
| Impressão | h1 "Agenda de {período}" · "Local: {nome ou Todos os locais}" · "Imprimir ou salvar em PDF" · rodapé "Contém dados pessoais de pacientes. Uso restrito do consultório." |
| Horários | "Também atender por videoconferência nestes horários" · "Você chegou ao limite de 60 horários. Apague um antes de criar outro." · h2 "Pedidos de horário" · "Confirmar os pedidos antes de marcar" · ajuda "Os pedidos feitos pelo app e pela página de agendamento esperam a sua resposta em Solicitações." |
| Solicitações | h1 "Solicitações" · "Nova pessoa: {nome}" · "App" · "Página de agendamento" · "Pedido em {dd/mm/aaaa}" · "Aceitar" · "Recusar" · "Motivo (só você vê)" · "Confirmar recusa" · vazio "Nenhum pedido aguardando resposta." · "Pedido aceito. Consulta marcada." · "Pedido recusado." · "Esse horário já está ocupado. Recuse o pedido ou combine outro horário com a pessoa." · "Este e-mail é de um paciente arquivado ou bloqueado. Recuse o pedido ou fale com a pessoa." · "Este pedido já foi respondido ou venceu." |
| Atendimento | "Retorno previsto (opcional)" ("Data" ou "Em {n} semanas") · "A previsão de retorno deve ficar entre a data do atendimento e 2 anos depois." · "Aceite o pedido antes de registrar o atendimento." |
| Portal e página pública | "Onde você quer ser atendido?" · "{nome} · Nutricionista · CRN {crn}" · "Pedido enviado. A nutricionista vai confirmar o horário e você recebe um e-mail." · "Aguardando confirmação" · "Desistir do pedido" · "Pedido cancelado." · "Não confirmado" · "Você já tem um pedido aguardando resposta. Espere a resposta antes de pedir outro horário." · ponto de coleta: "Até a resposta, guardamos seu nome, e-mail e telefone só para este pedido. Se ele não for aceito ou o horário passar, apagamos esses dados em até 24 horas." |
| E-mails do pedido | "Recebemos seu pedido de consulta" (corpo: "Seu pedido para {data} às {hora} foi enviado. Você recebe outro e-mail quando a nutricionista responder.") · "Seu pedido de consulta não foi confirmado" (corpo: "O horário de {data} às {hora} não foi confirmado. Escolha outro horário: {link da página de agendamento}") · à nutricionista: "Novo pedido de consulta" (corpo: "{nome} pediu {data} às {hora}. Responda em Solicitações.") |
| Push do pedido | título "NutriDebby" · "Seu pedido de horário não foi confirmado." |
| Aniversariantes | h1 "Aniversariantes de {mês}" · "Mês anterior" · "Próximo mês" · colunas "Paciente", "Dia", "Faz", "Situação" · "Pode receber" · "Sem autorização" · "Menor de idade" · "Já enviada este ano" · "Selecionar todos" · "Enviar mensagem" · "Abrir no WhatsApp" · "Registrar autorização" · "Retirar autorização" · confirmação "O paciente autorizou receber mensagens de aniversário (por exemplo, por escrito ou por mensagem)." · prévia "Texto padrão do NutriDebby, enviado em seu nome" · "Vai para {n} pacientes por e-mail, às 9h do dia do aniversário." · "Mensagens agendadas: {n}." · vazio "Nenhum aniversariante neste mês." · Início "Aniversariantes de hoje ({n})" |
| E-mail de aniversário | assunto "Uma mensagem da sua nutricionista" · corpo "Feliz aniversário, {primeiro nome}! {nutricionista} deseja a você um novo ano com muita saúde." · rodapé "Mensagem enviada pelo NutriDebby a pedido de {nutricionista}." · "Não quero mais receber mensagens de aniversário" (link) |
| Portal: Perfil | "Receber mensagem de aniversário da sua nutricionista" · "Autorizado em {dd/mm/aaaa}" · "Não autorizado" |
| Saída do aniversário | h1 "Mensagens de aniversário" · "Você não quer mais receber mensagens de aniversário de {nutricionista}?" · "Confirmar" · "Pronto. Você não vai mais receber mensagens de aniversário." · "Este link não é válido." |
| `ROTULO_TIPO` | "Mensagem de aniversário" · "Pedido de consulta não confirmado" |

Os textos do manual guiado (guia `agenda` com os alvos novos) ficam em rascunho até o `revisor-interface` e a Debby.
Os textos ao paciente (portal, página pública e e-mails) vão no pacote do advogado (E-09).

---

## 7. Telas

Visual V2 do painel (tokens de `src/app/globals.css`, componentes de `src/components/ui`). Esboços; o desenho exato fica
com quem constrói e o `revisor-interface`.

**Agenda, visão Semana** (`/painel/agenda?visao=semana`)

```
Agenda
[Agenda] Solicitações (2)  Aniversariantes  Pendências  Horários  Locais
Dia  [Semana]  Mês  Lista    ‹ Anterior  Hoje  Próximo ›    Ir para data [__/__/____] [Ir]
Local [Todos os locais ▾]  Paciente [Todos ▾]  [ ] Previsões de retorno  [ ] Aniversários  [ ] Mostrar 24 horas  [Filtrar]
                                                                   [Imprimir ou salvar em PDF]
        seg 16      ter 17                qua 18 ...
08h   Ana Souza   Bloqueado: congresso
      Retorno
      Clínica Centro · Confirmada
09h               Carla Dias
                  Aguardando confirmação
Legenda: Primeira consulta · Retorno · Aguardando confirmação · Presença a registrar · Bloqueio · Retorno previsto · Aniversário
```

- A grade é uma `table` com `caption`, `th scope="col"` (dias) e `th scope="row"` (horas); cada consulta é um link com
  o nome acessível completo. A 360 px (e na visão Mês abaixo de 768 px), a grade dá lugar a uma lista por dia (`h2` por
  dia), sem rolagem horizontal da página.
- **Mês:** `table` 7 × 5 ou 6 com `caption` "{mês} de {ano}"; cada célula com "{n} consultas", até 3 nomes e "mais {n}",
  e o link do dia.
- **Solicitações:** lista de cartões (`h2` por pedido) com os botões "Aceitar" e "Recusar"; o "Recusar" abre o campo de
  motivo e "Confirmar recusa" (só para paciente). Região `role="status"` sempre montada acima da lista; o h1 recebe o
  foco quando a linha sai (padrão do Financeiro).
- **Locais:** tabela com "Local", "Tipo", "Agendamento online", "Ações"; o formulário mostra os campos do tipo escolhido.
- **Aniversariantes:** tabela com `caption`, caixa de seleção por linha (as desabilitadas com o motivo no texto da
  linha), "Selecionar todos" como botão, a prévia num diálogo de confirmação.
- **Impressão:** `@media print` esconde cabeçalho, menu e botões (`print:hidden`, padrão de
  `termo-ia/imprimir.tsx`); tabela simples por dia; o rodapé repete em cada página.

---

## 8. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-400 | Desempenho | Agenda (todas as visões, com filtros e marcadores) e Aniversariantes: p95 ≤ 800 ms (RNF-01) com 300 pacientes ativos e 2.000 consultas no ano; uma transação por tela; marcadores e "Retorno" em consultas agregadas por período (sem N+1); índice `(tenant_id, local_id, inicio)` em `appointments` (CS-402) |
| RNF-401 | Acessibilidade | WCAG 2.1 AA (axe sem violação, claro e escuro, 1280 e 360 px): grade com `caption` e `th scope`; selos em texto; alvos ≥ 44 px; abas com `aria-current`; `role="status"` fixo e `role="alert"` junto do campo; foco no h1 depois das ações que tiram linhas; "Ir para data" com `label` |
| RNF-402 | Privacidade em log | Regra 3: nome de paciente, e-mail, endereço de local, link da sala e texto de mensagem nunca vão para log, Sentry ou mensagem de erro; erro loga só código e motivo técnico |
| RNF-403 | Testes | (a) unidade: `calendario.ts` (virada do mês e da semana em `America/Sao_Paulo` com o servidor em UTC, 29/02), faixa da grade, elegibilidade do aniversário, chaves da impressão; (b) integração (Testcontainers): gatilhos `appointments_regras_pedido` (nascimento, remarcação, transições, papéis), `appointments_link_da_sala`, `tenants_agenda_da_equipe`, `aniversario_autorizacoes_regras`; FK composta com o tipo; principal único; `staff_only` dos locais; funções de projeção (chaves); `publico_sem_aguardando`; corrida de dois pedidos (locais diferentes, mesmo horário; pessoa nova × paciente); vencimento; aceite de pessoa nova (e-mail virou paciente); backfill dos quatro casos (com e sem endereço, com e sem link); (c) guardas: grep de status (R-400), IA (RN-439), `SEM_CONTA_PERMITIDOS`; (d) E2E: dois locais, pedido aceito, recusado e de pessoa nova, remarcação com a chave ligada, visão Mês e impressão |
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
- **RLS:** `app_enable_tenant_rls('locais_atendimento')` + `app_enable_staff_only('locais_atendimento')` + entrada em
  `STAFF_ONLY`. **Sem** `app_allow_publico` e fora de `PUBLICO_LIBERADO` (AG-D4).
- **Funções de projeção** (`SECURITY DEFINER`, `search_path` fixo, conferem `app.tenant_id` e o papel):
  - `app_locais_para_agendamento()` (papéis `publico` e `paciente`): `{ id, nome, tipo, cidade, endereco (só com
    mostrar_endereco) }` dos locais ativos com `agendamento_online` do tenant da sessão;
  - `app_local_da_consulta(consulta uuid)` (papel `paciente`, com ou sem conta): `{ nome, tipo, cidade, endereco }` do
    local de uma consulta **do próprio paciente** (`patient_id = app_current_patient()`); nunca a sala.
- **Gatilho `appointments_link_da_sala`** (`BEFORE INSERT` em `appointments`, `SECURITY DEFINER`): quando
  `origem = 'paciente'` e o local é online, `NEW.link_online := link_sala` do local (o que o código mandou é ignorado).
  O CHECK `appointments_link_online` roda depois dos gatilhos `BEFORE` e continua valendo.
- Sem auditoria (sem `patient_id`; não precisa de `AUDIT_EXCEPTIONS`). Entra em `FABRICAS` e em `ULTIMAS` de
  `test/isolamento.test.ts` (FKs `NO ACTION` de `appointments`, `availability_rules` e `public_booking_requests`).
- **Locais iniciais** (custom, molde `NO FORCE … FORCE` da 0042, comentário `-- Plano 23`), por tenant:
  - "Consultório" (presencial, `endereco` = `endereco_consultorio`) quando há endereço, regra `presencial` ou `ambas`,
    ou nenhuma regra `online`;
  - "Videoconferência" (online, `link_sala` = `link_online_padrao`) quando há regra `online` ou `ambas`, ou link padrão;
  - `principal` = "Consultório" se existir, senão "Videoconferência";
  - `agendamento_online` = `agendamento_publico_ativo` e (presencial ou `link_sala` não nulo).
  Teste de migration com os quatro casos (com e sem endereço × com e sem link) e o caso "só online".

### 9.2 `appointments`

- `local_id uuid null` + FK `(tenant_id, local_id, modalidade)` → `locais_atendimento (tenant_id, id, tipo)`
  `NO ACTION` (MATCH SIMPLE: consulta antiga com `local_id` nulo não é conferida) + índice `(tenant_id, local_id, inicio)`.
- **Sem backfill** das consultas antigas: um UPDATE dispararia `audit_row_change` em cada linha (um "Alterou — Agenda"
  no Histórico de todo paciente) e esbarra no `FORCE RLS` (AG-D5).
- `link_online` continua cópia na consulta (CHECK e anonimização intactos).
- CHECK `appointments_status_valido` com `solicitada` (DROP e ADD com `NOT VALID` + `VALIDATE`); CHECK novo
  `appointments_solicitada_do_paciente`: `status <> 'solicitada' or origem = 'paciente'`.
- **Gatilho `appointments_regras_pedido`** (custom, `BEFORE INSERT OR UPDATE`): RN-421 e RN-422. A condição "cancelada
  pelo paciente nesta transação" da remarcação é conferida pelo `xmin` da linha de origem igual à transação atual; o
  `revisor-rls` confere a expressão na T1. Entra em `IMUTAVEIS` de `test/isolamento.test.ts`.

### 9.3 `availability_rules`

- `local_id uuid null` + FK `(tenant_id, local_id, modalidade)` → `locais_atendimento (tenant_id, id, tipo)`
  `NO ACTION`; CHECK `local_id is null or modalidade <> 'ambas'`.
- **Backfill** (custom, molde 0042, sem auditoria): `presencial` → "Consultório"; `online` → "Videoconferência";
  `ambas` → a linha vira `presencial` com o "Consultório" e ganha a cópia `online` com a "Videoconferência".
- A aplicação exige `local_id` na regra nova; a coluna fica anulável porque a imagem anterior ainda insere sem ela.

### 9.4 `public_booking_requests`

- Colunas novas: `fim timestamptz null`, `local_id uuid null` (FK composta com `modalidade`, `NO ACTION`),
  `aguardando_desde timestamptz null`, `resolvido_em timestamptz null`. CHECK: `aguardando_desde` ⇒ `verificado_em`,
  `fim` e `local_id` não nulos; `resolvido_em` ⇒ `aguardando_desde`.
- Índices: `(tenant_id, inicio) where aguardando_desde is not null and resolvido_em is null`; único parcial
  `(tenant_id, lower(email)) where aguardando_desde is not null and resolvido_em is null` (RN-425).
- **RLS:** continua `staff_only` + `publico` (select, insert, update), como na 0056, mais a política RESTRICTIVE
  `publico_sem_aguardando` (`FOR SELECT`, papel `publico`: `aguardando_desde is null`) e a função
  `app_pedidos_aguardando(de, ate)` (RN-425). Teste: o `UPDATE … RETURNING` que grava o `aguardando_desde` no fluxo do
  código continua funcionando (sem `RETURNING` da linha depois da mudança, se a política o barrar).
- Sem `patient_id`: fora da exportação; a própria limpeza é a eliminação (RN-429).

### 9.5 `tenants`

- `agenda_confirmar_pedidos boolean not null default false` (precedente `agendamento_publico_ativo`). Gatilho novo
  `tenants_agenda_da_equipe` (`BEFORE UPDATE`): 42501 se `app_current_role()` ∈ `paciente`, `publico`, `conta` e a
  coluna mudou (RN-420). Os gatilhos `app_tenants_interruptores_da_admin` e `tenants_ia_nutri_da_equipe` não mudam.

### 9.6 `consultations`

- `retorno_previsto_em date null`; CHECK `retorno_previsto_em is null or retorno_previsto_em between data and data + 730`.
  Tabela já auditada (entidade `atendimentos`) e exportada (`select()`); a anonimização mantém a data, como mantém `data`.
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

- Estado vigente = último evento por paciente; índice `(tenant_id, patient_id, registrado_em desc)`.
- **RLS:** `app_enable_tenant_rls` + `app_enable_patient_rls` (o paciente lê as próprias);
  `app_allow_paciente_escrita('aniversario_autorizacoes', 'insert')` + `PACIENTE_ESCREVE` + política RESTRICTIVE
  `paciente_aniversario_proprio` (canal `app` com `registrado_por = app_current_user()`; canal `link` só em `semConta` com
  `registrado_por` nulo; sempre o próprio `patient_id`); `REVOKE UPDATE, DELETE, TRUNCATE` de `nutri_app_role`.
- **Gatilho** `aniversario_autorizacoes_regras`: grava `registrado_em`; a sessão `nutri` só usa a origem `nutri` com
  `registrado_por` = a própria usuária; `publico` e `worker` não inserem.
- **Auditoria:** em `AUDIT_EXCEPTIONS` com a justificativa (prova só de inclusão, quem e quando na própria linha, como
  `ia_autorizacoes` e `consents`).
- **Isolamento:** `FABRICAS`, `SO_INSERE` e o filtro em `SO_APAGA.patients`.
- **Anonimização:** `app_anonimizar_autorizacoes_aniversario` (`SECURITY DEFINER`, contexto `worker`) anula
  `registrado_por`; chamada em `anonimizarVencidos` ao lado de `app_anonimizar_aceites`.

### 9.8 `notifications`

- CHECK de `tipo` com `aniversario` e `pedido_nao_confirmado` (`NOT VALID` + `VALIDATE`), partindo do CHECK da `main`
  na regeneração (o Plano 17 e o 22 também podem acrescentar); `TipoNotificacao` e `ROTULO_TIPO` acrescentados no fim.
  Nenhum tipo novo entra em `CONTA_COTA`. O aceite reaproveita `consulta_marcada`.
- `aniversario`: canal `email`, sem consulta (`appointment_id` e `inicio_consulta` nulos, aceito por
  `notifications_versao_da_consulta`). Índice único parcial `(tenant_id, patient_id, (extract(year from
  timezone('UTC', agendada_para)))) where tipo = 'aniversario'` (o revisor-rls confere a imutabilidade da expressão na
  T1; se não passar, coluna gerada).
- `pedido_nao_confirmado`: canais `email` e `push`, com a consulta (o horário pedido).
- `motivoParaIgnorar` ganha a reconferência do aniversário (RN-431) e os casos da §4.3. Motivos novos: `sem_autorizacao`,
  `consulta_nao_aceita` (o `motivo_ignorada` não tem CHECK de valores; só `notifications_motivo_so_ignorada`).

### 9.9 Ordem das migrations

1. **Gerada** (`agenda_2`): tabelas `locais_atendimento` e `aniversario_autorizacoes`; colunas de `appointments`,
   `availability_rules`, `public_booking_requests`, `tenants` e `consultations`; FKs, CHECKs (`NOT VALID` + `VALIDATE` em
   `appointments` e `notifications`) e índices. Sem edição à mão.
2. **Custom** `rls_agenda_2`: RLS das duas tabelas, `staff_only`, `app_allow_paciente_escrita`, políticas RESTRICTIVE
   (`paciente_aniversario_proprio`, `publico_sem_aguardando`), `REVOKE`, funções de projeção e de intervalos, gatilhos
   (`appointments_regras_pedido`, `appointments_link_da_sala`, `tenants_agenda_da_equipe`,
   `aniversario_autorizacoes_regras`), `app_anonimizar_autorizacoes_aniversario`, locais iniciais e backfill das regras
   (molde 0042), `CREATE OR REPLACE` das funções de métricas da 0059 e da 0087 (corpo copiado da `main` na regeneração).

### 9.10 Guardas e listas (só acrescentar, §6 de `sessoes-paralelas.md`)

- `rls-guard.ts`: `STAFF_ONLY` + `locais_atendimento`; `PACIENTE_ESCREVE` + `aniversario_autorizacoes`.
- `audit-guard.ts`: `AUDIT_EXCEPTIONS` + `aniversario_autorizacoes` (com a justificativa).
- `test/isolamento.test.ts`: `FABRICAS` (as duas tabelas), `ULTIMAS` (`locais_atendimento`), `SO_INSERE` e
  `SO_APAGA.patients` (autorizações), `IMUTAVEIS` (`appointments`, pelo gatilho novo).
- `src/db/tenant.ts`: `SEM_CONTA_PERMITIDOS` + `src/modules/agenda/aniversarios.ts` (guarda `sem-conta-guarda.test.ts`).
- `src/db/migrate.test.ts`: a guarda do `_journal.json` (`when` crescente, `idx` sem buraco) já está na `main` pelo
  Plano 20; conferir que cobre as duas novas.
- `CLAUDE.md`, regras 1, 2 e 8: frase "Plano 23" no fim de cada uma (tabelas novas, `STAFF_ONLY` com as funções de
  projeção, `PACIENTE_ESCREVE`, `AUDIT_EXCEPTIONS`, gatilhos de `appointments`, `publico_sem_aguardando`,
  `aceitarPedidoPublico` em `agendamento-publico.ts` gravando `consents` na sessão `nutri`, `aniversarios.ts` em
  `semConta`).

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
| Mensagem de aniversário: finalidade e base | Finalidade nova (relacionamento), fora dos "lembretes" do Termo 1.0 e do opt-in do WhatsApp (LGPD, art. 6º, I e II). O consentimento é por finalidade, e o genérico é nulo (art. 8º, § 4º): autorização **própria**, revogável com facilidade (art. 8º, § 5º) no portal e no e-mail (AG-D32). A base (consentimento ou legítimo interesse, art. 10) e a validade do opt-in declarado pela nutricionista (art. 8º, § 2º) vão ao advogado |
| Aniversário: quem recebe | Bloqueado e anonimizado nunca (art. 5º, XIII: bloqueio suspende todo tratamento); arquivado fora; menor de 18 fora (art. 14, boa prática; o consentimento do responsável vai ao advogado) |
| Aniversário: conteúdo | Texto fixo sem oferta, desconto, sorteio ou preço (Res. CFN 599/2018, art. 57; Res. CFN 856/2026, art. 68, III, compilação não oficial; DPA, cl. 3); sem dado de saúde; rodapé que identifica o envio automático (856, art. 37, "automação", boa prática até o CRN-3 responder) |
| Aniversário na agenda | Uso compatível (art. 6º, II): só no painel, só dia e mês, sem idade; nunca na página pública, no portal, na impressão ou em push (normas §2) |
| WhatsApp | Nada novo por WhatsApp (INT-01; Termos do WhatsApp proíbem "bulk messaging, auto-messaging"). O "Abrir no WhatsApp" é manual, do aparelho da nutricionista, sem cota e sem automação, e também exige a autorização de aniversário |
| Local de atendimento | O local de cada consulta é registro administrativo do atendimento (Res. CFN 594/2017, art. 4º): fica em `appointments` (auditada, exportada) e continua fiel depois de o local ser renomeado ou arquivado (FK `NO ACTION`, arquivar em vez de apagar). Filtro de pacientes derivado das consultas, sem coluna no paciente (minimização, art. 6º, III). A exportação leva o **nome** do local (art. 18, II) |
| Videoconferência (Res. CFN 760/2023) | Link externo, sem gravação oferecida pelo produto (art. 9º, VII); vídeo embutido seria suboperador novo (DPA, cl. 10). Link por consulta como padrão; sala fixa com o aviso de sala de espera (art. 9º, I e IX; 599, art. 20). O link nunca vai à página pública, ao WhatsApp, ao push nem à impressão (decisão de 02/10/2026 mantida) e agora é protegido no banco (AG-D4). O registro do TCLE fica para o backlog (AG-D36); o aviso do local lembra o e-Nutricionista (art. 5º) e o TCLE (art. 9º, VI) |
| Página pública | Expõe só nome do local, cidade, endereço se marcado (pode ser a casa da nutricionista), horários livres e "Nutricionista · CRN" (599, art. 21); nunca ocupação, motivo de bloqueio, nome de paciente, link ou preço (599, art. 20; art. 57). Resposta igual para paciente e não paciente (anti-enumeração) |
| Pedido de pessoa nova | Cadastro só no aceite, para manter verdadeira a frase do Termo 1.0 ("quando o agendamento é concluído, o seu cadastro é criado"); dados do pedido apagados até 24 h depois da resposta (arts. 15, I, e 16), com a frase no ponto de coleta (art. 6º, VI). As linhas aguardando ficam fora da leitura do `publico` |
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
3. **Controle de acesso** (NGS1.03): `locais_atendimento` `staff_only` com projeções; `publico_sem_aguardando`; a chave
   só pela equipe; sem papel novo.
4. **Datas consistentes** (ECF.17.05): datas de calendário no fuso do consultório; `registrado_em` pelo relógio do banco.
5. **Autoria** (ECF.17.01): `registrado_por` conferido pelo gatilho; o aceite e a recusa levam a usuária da sessão.

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-400 | Um ponto de status esquecido trata `solicitada` como marcada (lembrete, presença, métrica) | Tabela fechada da §4.3; `StatusConsulta` exaustivo no typecheck; teste de grep (`<> 'cancelada'`, `!== 'cancelada'`, `inArray(appointments.status`, `status === '`); teste por ponto; `motivoParaIgnorar` como defesa |
| R-401 | O link da sala vaza ao `publico` ou ao portal | `staff_only` + funções de projeção + gatilho de cópia (AG-D4); teste de banco das chaves (CS-401) |
| R-402 | Mês com marcadores fica lento | Consultas agregadas por período; índice `(tenant_id, local_id, inicio)`; carga P08-03 (CS-402) |
| R-403 | Volta atrás para a imagem anterior com `solicitada` no banco ou com regras sem "ambas" | A chave nasce desligada; o runbook manda desligar a chave e responder ou cancelar os pedidos antes de voltar; a imagem anterior lê as regras pela modalidade; o gatilho de link só age em `origem = 'paciente'` com local |
| R-404 | Worker antigo pega uma notificação `aniversario` ou `pedido_nao_confirmado` e falha (`sem_modelo`) | App e worker sobem na mesma imagem; o aniversário é agendado para as 9h, nunca imediato |
| R-405 | O gatilho de pedido barra um fluxo legítimo de paciente (remarcação, link sem conta) | Exceção explícita do `remarcada_de` (RN-421) com teste nos dois sentidos; E2E de remarcação com a chave ligada |
| R-406 | Dois endereços (Perfil × locais) confundem | Rótulo "Endereço profissional (documentos)" com a ajuda; o link padrão sai do Perfil (AG-D7) |
| R-407 | Conflitos de merge com o 18 PR 2, o 19 e o 20 PR 2 | Ordem dos PRs (§15) e regras da §13; Fase B com portão |
| R-408 | Pessoa nova aguardando: a nutricionista marca por cima e o aceite falha | A grade mostra o pedido; o aceite trata a sobreposição com mensagem clara; a recusa avisa a pessoa |
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

Conferido com `git diff --name-only 6c3ee8f...HEAD` em `nutridebby-18` (`plano-18-pr2`, 25f4787), `nutridebby-b`
(`plano-19-plano-alimentar-2`, d95d319) e `nutridebby-c` (`plano-20-financeiro`, d0ae78c) em 17/11/2026.

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
| `src/worker/index.ts`, `src/jobs/queues.ts` | 19 (fila `plano-pdf-2`) | Chamada de `vencerSolicitacoes` no callback de `notificacoes` | Nenhuma fila nova (AG-D37); uma linha no callback existente |
| `src/app/painel/configuracoes/page.tsx` | 19 (três cartões no fim de `CARTOES`) | Cartão "Locais de atendimento" | Só acrescentar no fim |
| `src/app/painel/navegacao.ts` | 20 PR 2 ("Financeiro") | — | Não mexer (AG-D37) |
| `src/modules/ficha/secoes/index.ts` | 18 PR 2, 20 PR 2, talvez 21 e 22 | Seção nova | Arquivo novo + uma linha no fim de `SECOES_DA_FICHA` |
| `src/modules/agenda/fuso.ts` | Proibido (19 e 20) | Helpers de mês | `calendario.ts` |
| `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md` | 18 PR 2, 19, 20 PR 2, 21, 22 | Entradas novas | Só acrescentar no fim de cada bloco; no `CLAUDE.md`, ficar com a linha da `main` e reacrescentar a frase "Plano 23" |
| `notificacoes/{tipos,mensagens,enviar}.ts` e o CHECK de `notifications.tipo` | 17 (main); 22 pode criar tipos | Tipos novos | Partir do CHECK da `main` na regeneração; acrescentar no fim |
| `src/email/types.ts` e modelos | 22 talvez | Modelos novos | Acrescentar no fim da união |
| `e2e/agenda.spec.ts`, `e2e/painel-rotas.ts`, `e2e/acessibilidade-painel.spec.ts`, `scripts/e2e-seed.ts` | 18 PR 2, 20 PR 2 (cada "Realizada" cria cobrança) | Seletores da grade nova; horários da semente no `EXCLUDE` | Rebase sobre os dois; horários próprios do 23; um E2E por vez |
| `src/modules/ajuda/conteudo.ts` (+ teste) | 18 PR 2, 19, 20 PR 2 | Guia `agenda` muda | Só acrescentar passos; versão + 1 uma vez |
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
| AG-D4 | **Link da sala protegido no banco:** `locais_atendimento` `staff_only`; `publico` e `paciente` só pelas funções `SECURITY DEFINER` de projeção; o link entra na consulta do paciente por gatilho `BEFORE INSERT` | A RLS é por linha, não por coluna, e todos os contextos usam o mesmo role: projeção só no código seria defesa fraca para um dado que deixa um estranho entrar na sessão de outro paciente (crítica A5) | RN-406, §9.1, CS-401 |
| AG-D5 | **`local_id` anulável** em `appointments`, `availability_rules` e `public_booking_requests`, com FK composta com a modalidade; **sem backfill** de consultas; backfill só das regras | Um UPDATE das consultas encheria o Histórico de acessos de todo paciente e esbarra no `FORCE RLS`; expansão compatível com a imagem anterior | §9.2–9.4 |
| AG-D6 | **Locais iniciais pela migration:** "Consultório" quando há endereço, regra presencial/ambas ou nenhuma regra online; "Videoconferência" quando há regra online/ambas ou link padrão; dados na custom (molde 0042) | Nenhum consultório perde o agendamento online nem fica com regra órfã no deploy (crítica A6); a custom é colada de novo a cada regeneração, a edição da gerada seria jogada fora (§5, passo 4) | §9.1, §9.3 |
| AG-D7 | **O Perfil deixa de editar o link padrão** (aviso de que ele foi para Locais); o endereço do Perfil continua como "Endereço profissional (documentos)" | Duas cópias editáveis do link divergiriam; o endereço do Perfil vai no cabeçalho dos documentos assinados (`perfil-profissional.ts:60`) e no receituário (Res. 656, art. 3º, XI), sem carimbo por local. As colunas ficam para a imagem anterior e as consultas sem local | §4.1, R-406 |
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
| AG-D19 | **Vencimento em `inicio − antecedência`**, por `vencerSolicitacoes` no job `notificacoes` de minuto, com leitura preguiçosa; a limpeza das 04:30 fica como rede | Pela limpeza diária o aviso chegaria depois do horário (crítica A4); depois da antecedência o horário nem seria oferecido; sem fila nova | RN-427 |
| AG-D20 | **Avisos da resposta:** paciente por `notifications` (e-mail e push); pessoa nova por `enqueueEmail`; nada por WhatsApp | `notifications.patient_id` é NOT NULL (crítica A3); WhatsApp só transacional e na cota (C-405) | RN-428 |
| AG-D21 | **Dados da pessoa nova apagados até 24 h depois da resposta**, não os 7 dias sugeridos pela lente de normas | Mais curto, e é o prazo que o Termo já usa para pedidos | RN-429 |
| AG-D22 | **Resposta igual na página pública**, na tela e no e-mail | Anti-enumeração (normas §6), inclusive pelo tempo e pelo modelo do e-mail | RN-426 |
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
| PM-A1 | **T1 — Fundação** (PR 1, sozinho na fila de migration): schema e migrations da §9 (gerada sem edição + `rls_agenda_2`), locais iniciais e backfill das regras (teste dos quatro casos e do "só online"), gatilhos, funções de projeção e de intervalos, políticas, CHECKs, funções de métricas, guardas da §9.10, `src/modules/agenda/banco.test.ts`, `isolamento`, semente do E2E com horários próprios. TDD: os testes de banco falham antes da migration. Revisor: `revisor-rls` |
| PM-A2 | **T2 — Locais:** `locais.ts`, tela `/painel/agenda/locais`, cartão no hub, Perfil (rótulo do endereço, o link padrão sai), aviso de telenutrição (com o portão do DOU: sem o texto conferido, o aviso sai sem o número da resolução) (US-400, RN-401–RN-405). Revisores: `revisor-interface`, `normas-cfn-lgpd` |
| PM-A3 | **T3 — Local no painel:** `disponibilidade.ts` (regra com local, par de videoconferência, teto 60), `horarios.ts`, `consultas.ts` (Nova consulta, Alterar, detalhe), corrida em dois locais no mesmo horário (US-401, US-402, RN-407–RN-410) |
| PM-A4 | **T4 — Local fora do painel:** página pública e portal (escolha do local, CRN, endereço opcional), `agendamento-paciente.ts`, `agendamento-publico.ts`, `acoes-link.ts`, `mensagens.ts`, `portal/agenda.ts` pelas funções de projeção, exportação com o nome do local (US-403, RN-406, RN-438); testes de página de `/n/[slug]` com os textos novos |
| PM-A5 | **T5 — Visões, filtros e legenda:** `calendario.ts`, `visoes.ts`, grade Dia/Semana, Mês, Lista, "Ir para data", "Mostrar 24 horas", filtros de local e paciente, legenda, "Retorno" agregado (US-404, US-405, RN-411–RN-417); testes de fuso; axe a 360 px. Revisor: `revisor-interface` |
| PM-A6 | **T6 — Impressão:** `/painel/agenda/imprimir`, `impressao.ts`, `recordAudit` no render, `prefetch={false}`, `@media print` (US-406, RN-418, RN-419) |
| PM-A7 | **T7 — Solicitações (núcleo):** `StatusConsulta` + `solicitada`, `STATUS_OCUPA`, **todos** os pontos da §4.3, teste de grep, `solicitacoes.ts`, `aceitarPedidoPublico` (paciente existente, consents com `verificado_em`), pessoa nova (teto, trava do tenant, função de intervalos), `vencerSolicitacoes` no callback de `notificacoes`, tipo `pedido_nao_confirmado`, modelos de e-mail, aviso à nutricionista, limpeza nova (US-407–US-409, RN-420–RN-429). Revisores: `revisor-rls`, `normas-cfn-lgpd` |
| PM-A8 | **T8 — Solicitações (telas):** fila, Aceitar e Recusar na consulta, cartão no Início, chave em Horários, "Aguardando confirmação" e "Desistir do pedido" no portal, textos da página pública e do ponto de coleta; E2E aceitar, recusar, pessoa nova e remarcar com a chave ligada; axe. Revisor: `revisor-interface` |
| PM-A9 | **T9 — Previsão de retorno e seção "Consultas":** campo no atendimento (sem mudar o retorno `{ id, cobranca }` do 20 PR 2), `retorno.ts`, marcador, `secoes/consultas.ts` + uma linha no fim de `SECOES_DA_FICHA`; guarda RN-439; `campos-enviados.test.ts` verde (US-410, US-411, RN-430) |
| PM-A10 | **T10 — Aniversariantes:** `aniversarios.ts`, página, marcador, autorização (painel, portal, link `/aniversario/sair/[token]` em `semConta` com `List-Unsubscribe`), tipo `aniversario` (e-mail), `motivoParaIgnorar`, "Abrir no WhatsApp", exportação e anonimização (US-412–US-414, RN-431–RN-435, RN-438). Revisores: `normas-cfn-lgpd`, `revisor-rls` |
| PM-A11 | **T11 — Fase B, filtros externos** (só com o 18 PR 2 e o 20 PR 2 na `main`; senão vira o Plano 23B): `FiltroDaLista.localId`, filtro "Local" no Financeiro (`listarLancamentos`, CSV, 12 meses) com teste de propriedade (US-415, US-416, RN-436, RN-437) |
| PM-A12 | **T12 — Fechamento:** E2E completo (`agenda.spec.ts`, `portal.spec.ts`), `e2e/painel-rotas.ts` com as rotas novas, axe, guia `agenda` (alvos: Mês, Ir para data, Solicitações, Locais, Imprimir; versão + 1) e do portal, manual técnico caps. 05 e 02 pelo `guardiao-manual`, `CLAUDE.md`, backlog (PD-70–PD-74 e itens "Fora"), índice dos planos, manual do usuário (Docs) e Central de Ajuda preparados, migrations geradas de novo (§5), runbook de volta atrás (R-403) |
| PM-A13 | **PRs:** PR 1 = T1; PR 2 = T2–T6 (depois do merge do 20 PR 2, pelos arquivos da consulta); PR 3 = T7–T10; PR 4 (Fase B) = T11; a T12 fecha cada PR no que lhe toca e o último por inteiro |
| PM-A14 | Agentes nas revisões: `revisor-rls` (T1, T4, T7, T10), `normas-cfn-lgpd` (T2, T7, T10), `revisor-interface` (T2, T5, T6, T8, T10), `guardiao-manual` (T12) |

---

## 16. Referências

- Código (`main` 6c3ee8f): `src/db/schema/agenda.ts`, `src/db/schema/platform.ts`, `src/db/schema/pacientes.ts`,
  `src/modules/agenda/*`, `src/modules/notificacoes/{enviar,mensagens,tipos}.ts`, `src/modules/notificacoes/whatsapp/cota.ts`,
  `src/email/{queue,types}.ts`, `src/modules/pacientes/{atendimentos,lgpd,exportacao-job}.ts`, `src/modules/ficha/tipos.ts`,
  `src/db/tenant.ts`, `src/worker/index.ts`, `drizzle/0042`, `0051`, `0056`, `0059`, `0087`, `0116`.
- Onda 1: `nutridebby-18` (25f4787), `nutridebby-b` (d95d319), `nutridebby-c` (d0ae78c).
- LGPD (Lei 13.709/2018), arts. 5º, 6º, 7º, 8º, 9º, 10, 11, 14, 15, 16, 18 e 37: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm (conferida em 17/11/2026).
- Res. CFN 599/2018, arts. 20, 21, 26 e 57: https://cfn.org.br/wp-content/uploads/resolucoes/Res_599_2018.html; Res. CFN 594/2017, arts. 3º e 4º: https://cfn.org.br/wp-content/uploads/resolucoes/Res_594_2017.htm (conferidas em 17/11/2026).
- Res. CFN 760/2023, arts. 5º, 9º, 12 e 15 (compilação não oficial, Legismap; DOU a conferir); Res. CFN 856/2026, arts. 24, 37 e 68 (compilação não oficial, LegisWeb; vigência a conferir).
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
| Crítica A3 — pessoa nova (aviso, leitura do `publico`, reserva sem trava) | Aplicado: `enqueueEmail`, política `publico_sem_aguardando` + função de intervalos, tetos; trava **por tenant**, não por horário (AG-D18) |
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
