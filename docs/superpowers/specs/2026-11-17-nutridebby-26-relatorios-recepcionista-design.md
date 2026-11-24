# NutriDebby — Relatórios e recepcionista (Plano 26) — Design

| Item | Valor |
|---|---|
| Versão | 0.3 (17/11/2026: revisão do plano aplicada — `revisor-rls` e crítico de completude; o que entrou e o que foi descartado está na §18.5; decisões novas RE-D59 a RE-D69). 0.2 (17/11/2026: painel de revisão aplicado — `revisor-rls`, `normas-cfn-lgpd` e `revisor-interface`; o que entrou e o que foi descartado está na §18). 0.1: proposta inicial |
| Data | 2026-11-17 |
| Situação | **Revisada — decisões delegadas pelo dono (onda 3).** O dono autorizou seguir as recomendações sem parar para perguntar (`.sessoes/onda3-briefing.md`): cada decisão de produto está na §14 como "RE-Dn — decisão — porquê". Painel de revisão aplicado na v0.2 (§18): banco (1 Critical, 7 Important, 13 Minor), normas (1 Critical, 6 Important, 8 Minor) e interface (9 Important e os Minors), cada achado conferido no código antes de entrar. Plano: [`2026-11-17-nutridebby-26-relatorios-recepcionista.md`](../plans/2026-11-17-nutridebby-26-relatorios-recepcionista.md). Conferida contra a `main` 07756c4 (Planos 01–18 completos, 20 PR 1: `fin_*` nas migrations 0122/0123, `patient_cadastro` nas 0124/0125), contra `origin/plano-20-financeiro` (411f21d) e contra os branches abertos da §13 |
| Itens do backlog | Paridade Dietbox, onda 3: **PD-100** (relatórios) e **PD-101** (recepcionista com permissões) |
| Quando | **Plano 26**, o último da onda 3, em paralelo com o Plano 25 (`nutridebby-25`, chat e recados) e depois dos Planos 19, 20 PR 2, 21, 22 e 23, ainda abertos. Entra por último porque a recepcionista mexe na permissão de tudo. Regras de convivência em `docs/operacao/sessoes-paralelas.md` |
| Insumos | Briefing da onda 3 (seção do Plano 26); levantamento do código (auth e papéis, `withTenant`, `rls-guard`, agenda, financeiro, ficha); specs dos Planos 18, 20 e 23; memória do `normas-cfn-lgpd` (fontes do CFN já localizadas). Referência funcional: os relatórios e a "recepcionista" do Dietbox. **Copiamos a função, nunca a marca, os textos ou o layout** |
| Documentos de base | [`2026-09-27-nutridebby-mvp-design.md`](2026-09-27-nutridebby-mvp-design.md) (RN-06 fuso, RNF-06 sessão, RNF-08 LGPD, RNF-11 log, RNF-12 formatos), [`2026-11-16-nutridebby-18-ficha-cadastro-design.md`](2026-11-16-nutridebby-18-ficha-cadastro-design.md) (D7 nome social, D20 projeção da lista, RN-268 leitura do cadastro), [`2026-11-16-nutridebby-20-financeiro-design.md`](2026-11-16-nutridebby-20-financeiro-design.md) (RN-300, RN-305, RN-306, RN-315, RN-318, RN-321; gatilho `fin_lancamentos_regras`), spec do Plano 23 no worktree `nutridebby-23` (`2026-11-17-nutridebby-23-agenda-2-design.md`: AG-D15, RN-400, RN-414, RN-416, RN-418, RN-419, US-416) e o manual técnico, caps. [02](../../manual-tecnico/02-banco-de-dados.md) e [05](../../manual-tecnico/05-agenda-portal-conteudo.md) |
| Numeração nova | US-480 a US-496 · RN-480 a RN-519 · RNF-480 a RNF-486 · CS-480 a CS-484 · C-480 a C-489 · R-480 a R-499 · DEP-R1 a DEP-R8 · PM-R1 a PM-R16 · **RE-D1 a RE-D48 e RE-D59 a RE-D69** (RE-D49 a RE-D58 são do plano e entram aqui no fechamento) · P-R1 a P-R5 (decisões deste documento; fora dele, cite "Plano 26, RE-Dn"). O bloco **480–519** é do Plano 26 pela decisão da orquestradora de 17/11 (~11h40 UTC); o 440–479 é do Plano 25 (decisões CH-Dn). Conferido com `grep -rhoE '\b(US\|RN\|RNF\|CS)-(4[89][0-9]\|5[01][0-9])\b'` nos worktrees em 17/11/2026: nada usado |

---

## 1. Visão

Hoje o NutriDebby tem três papéis (`user.app_role` ∈ `admin`, `nutri`, `paciente`, CHECK `user_app_role_valido`,
`src/db/schema/auth.ts:46`) e o painel inteiro é da nutricionista: as 89 páginas e rotas do painel chamam `requireNutri`
ou `requireApiNutri` (`src/lib/tenant-session.ts`), e o `withTenant` só aceita `nutri`, `paciente`, `worker` e
`publico` (`src/db/tenant.ts:12`). Os números do consultório estão espalhados: o Início mostra consultas e faltas do mês
(`indicadoresDaAgenda`, `presenca.ts:71`), o Financeiro (Plano 20) tem o fluxo de caixa do ano, e não há visão de
pacientes por perfil, de atendimentos por mês nem de planos alimentares.

O Plano 26 entrega duas coisas, em PRs separados (RE-D1):

1. **Relatórios (PD-100).** Uma área **Relatórios** no menu do painel com seis seções — Pacientes, Atendimentos,
   Planos alimentares, Agenda, Financeiro e Ranking —, filtro por **período** (meses inteiros, até 12) e, quando o
   Plano 23 estiver na `main`, por **local de atendimento**; cada seção exporta em **CSV** e em **PDF pela impressão do
   navegador**. Tudo agregado no SQL; só o Ranking tem nomes (RE-D4).
2. **Recepcionista (PD-101).** Um papel novo, **`recepcao`**, para a pessoa da equipe que cuida da agenda e do
   cadastro. A nutricionista convida, dá ou tira a permissão "Permitir acesso ao Controle Financeiro" e desativa. A
   recepcionista entra com senha e verificação em duas etapas obrigatória, aceita um termo de confidencialidade e
   **nunca** vê dado de saúde: anamnese, medidas, gasto energético, atendimentos, notas, exames, envios, planos,
   documentos, IA, IA Nutri, diário, etiquetas, o Histórico de acessos e, no cadastro, a observação e a identidade de gênero (RE-D38). A proteção é **negação por padrão em duas
   camadas** (RE-D15, RE-D16): no banco, toda tabela com `tenant_id` nega o papel `recepcao` salvo as de uma lista
   fechada (`RECEPCAO_LIBERADO`, com guarda no CI, como o `PUBLICO_LIBERADO`); no app, `requireNutri` continua
   recusando, e só as rotas de uma lista fechada (`ROTAS_DA_RECEPCAO`) aceitam a recepção.

O que **não** muda: o que a nutricionista vê e faz; o portal do paciente; o admin (que continua sem consultar tabela com
`tenant_id`); os textos legais existentes (termo do paciente, DPA).

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-480 | A sessão `recepcao` **não lê nem grava nenhuma linha** de tabela com `tenant_id` fora de `RECEPCAO_LIBERADO`, nem as linhas de fora da condição das liberadas (financeiro sem a permissão, notificação que não é da agenda, paciente bloqueado ou anonimizado e as consultas, notificações e lançamentos dele). **Ressalva:** as tabelas sem RLS (`tenants`, `user`, `session`, `invites`, `consents`, `document_verifications`, `ia_nutri_pausa`) continuam protegidas pelo código, como para qualquer sessão (regra 1); `tenants` ganha o gatilho `tenants_so_nutri` (RN-512) | `findRecepcaoViolations` no CI + `test/isolamento.test.ts` com a recepção em todos os comandos de todas as tabelas (`FABRICAS`) + testes das condições `recepcao_cond_*` |
| CS-481 | **Nenhuma** página, Server Action ou rota de API do painel fora de `ROTAS_DA_RECEPCAO` devolve dado à recepção (redireciona para "Sem permissão" ou responde 403) | Guarda de fonte que percorre `src/app/painel/**/page.tsx`, `actions.ts` e `src/app/api/painel/**/route.ts` + E2E com a conta da recepção abrindo cada rota de `e2e/painel-rotas.ts` |
| CS-482 | Os relatórios **batem** com as telas que já existem: "Consultas" e "Faltas" do mês na Agenda = indicadores do Início; receitas e despesas do mês = Resumo do Financeiro | Teste de consistência no mesmo cenário de banco |
| CS-483 | Cada seção dos Relatórios abre com p95 ≤ 800 ms (RNF-01) num consultório com 300 pacientes ativos e 12 meses de agenda e financeiro | Pilha de carga (P08-03), cenário novo "relatórios" |
| CS-484 | A Debby convida uma recepcionista, que marca, remarca e cancela consultas e cadastra pacientes por 2 semanas sem pedir acesso a nada clínico | Conferência com a Debby, registrada no runbook do fechamento |

### 1.2 Premissas e restrições

| # | Premissa / restrição | Origem |
|---|---|---|
| C-480 | Só documentos nesta etapa; código, migrations e testes vêm no plano | Briefing |
| C-481 | **Sem custo novo e sem serviço externo**: nada de gerador de PDF em serviço de terceiro nem de biblioteca de gráficos paga | Memória "No extra costs" |
| C-482 | **Sem arquivo no servidor** para relatório: o PDF é a impressão do navegador (regra 9 intacta: nenhum tipo novo em `stored_files`) | Precedente AG-D15 do Plano 23 |
| C-483 | **Não editar `src/modules/agenda/fuso.ts`**; os meses dos relatórios saem de um helper novo em `src/modules/relatorios/periodo.ts` que só importa de `fuso.ts` | Global Constraints dos Planos 19, 20 e 23 |
| C-484 | **Migrations sem número reservado**, geradas de novo sobre a `main` antes do PR (`sessoes-paralelas.md` §5). O PR 1 não tem migration | RE-D1 |
| C-485 | **Nenhuma coluna nova em `patients`** (`PUBLICO_LIBERADO`; gatilho `paciente_colunas`) nem em `fin_lancamentos` (colunas fixas, RN-308 do Plano 20) | Precedentes dos Planos 18, 20 e 23 |
| C-486 | **Texto legal existente não muda** (termo do paciente 1.0, DPA). O termo de confidencialidade da equipe é texto **novo** (RE-D21) e vai à orquestradora como os outros textos legais, um por vez | C-410 do Plano 23 |
| C-487 | **O admin nunca consulta tabela com `tenant_id`** (regra 1): não cria nem lê `equipe_membros` | Regra 1 do CLAUDE.md |
| C-488 | **O Plano 26 entra por último na onda**: o PR 2 só abre com o 20 PR 2 e o 23 PR 1 na `main`; o PR 3 só com o 23 inteiro | Briefing; §13 |
| C-489 | Datas no fuso do consultório (`tenants.fuso`) | MVP RN-06 |

### 1.3 Dependências (conferidas no código em 17/11/2026, `main` 07756c4)

| ID | Depende de | O que esta spec usa | Situação e arquivo |
|---|---|---|---|
| DEP-R1 | **Contexto de banco** | Papel novo no `withTenant` | ✅ `TenantRole` e `ROLES` (`src/db/tenant.ts:12-13`), `assertContext` (ator obrigatório para `nutri`), `set_config('app.role', …)` |
| DEP-R2 | **Guardas de RLS** | Molde do `PUBLICO_LIBERADO` | ✅ `findPublicoViolations` (`src/db/rls-guard.ts:150-180`); `app_deny_publico`/`app_allow_publico` (`drizzle/0051_rls_consultas.sql`). O corpo **atual** de `app_enable_tenant_rls` é o da **0070** (`drizzle/0070_paciente_sem_escrita.sql:39-50`: `tenant_isolation` + `app_deny_publico` + `app_deny_paciente_escrita`), com laço sobre as tabelas existentes (`0070:53-59`); quem copiasse a 0051 tiraria os `paciente_sem_*` de toda tabela nova. As políticas `staff_only` (`0020:3-11`), `patient_isolation` (`0000:41-50`) e `paciente_sem_*` só olham `app_current_role() IS DISTINCT FROM 'paciente'`: **um papel novo passa por todas** — por isso a negação por padrão (RE-D15) |
| DEP-R3 | **Sessão e papéis** | `AppRole`, prazos da equipe, 2FA | ✅ `src/lib/session-rules.ts`: `ehEquipe = role !== 'paciente'` (prazos de 30 min e 8 h valem para todo papel que não é paciente), `evaluateSession` só obriga o 2FA do admin (`setup-2fa`), `homeFor`, `ROTULO_PAPEL`, `caminhoOutroPapel`. Better Auth com `appRole` em `additionalFields` (`src/lib/auth.ts:150`) |
| DEP-R4 | **Convites** | Convite da recepção | ✅ `invites` com CHECK `invites_tipo_valido` (`nutri`, `paciente`) e `invites_alvo` (`src/db/schema/access.ts:26-31`); `criarConvite`, `aceitarConvite` (grava senha, verifica e-mail, registra o DPA) em `convites.ts`; e-mail `convite_nutri` (`src/email/types.ts:3`). Consultas a `user` por tenant filtram `app_role = 'nutri'` (`aviso-nutri.ts:16`, `contexto.ts:66`, `contas.ts:103,170,201`): uma segunda conta no tenant não as confunde. `suspensao.ts:26` revoga as sessões de **todas** as contas do tenant |
| DEP-R5 | **Agenda e pacientes** | Telas da recepção | ✅ `agendarPelaNutri`, `moverConsulta`, `registrarPresenca` (`consultas.ts`, `presenca.ts`); `criarPaciente`, `atualizarPaciente`, `listarPacientes`, `buscarPaciente` (`pacientes.ts`); `listAccessHistory` já devolve o papel do ator (`audit.ts`). O layout da ficha (`[id]/layout.tsx`) lê a última antropometria com `auditRead` (D13 do Plano 18): a recepção **não** pode passar por ele (RE-D23) |
| DEP-R6 | **Financeiro (Plano 20)** | Seção Financeiro, ranking por receita, permissão | ⚠ PR 1 na `main` (tabelas e gatilho `fin_lancamentos_regras`, 0123); **PR 2** (módulo, telas, `resumo.ts`, `csv.ts`, item "Financeiro" no menu) só em `origin/plano-20-financeiro` (411f21d). O gatilho trata "papel diferente de `nutri`" como "a RLS recusa" e **não** lê o paciente nesse ramo: com a recepção liberada, isso pularia a defesa do paciente bloqueado (RN-315 de lá) — ver RN-506. E mais: o próprio gatilho (no INSERT, `IF v_status = 'bloqueado' OR v_anonimizado IS NOT NULL` com tudo nulo passa, `0123:82-85`) e `travarLancamento` do 20 (`bloqueado: p?.status === 'bloqueado'`) leem o paciente pela RLS de quem age: com o paciente escondido da recepção (RN-508), a leitura volta vazia e a guarda passa (RE-D40). O 20 PR 2 confere o papel por `exigirNutri(ctx)` (`src/modules/financeiro/erros.ts:42-44`) |
| DEP-R7 | **Agenda 2 (Plano 23)** | Filtro por local, solicitações, primeira consulta × retorno, previsão de retorno | ⬜ só nos worktrees `nutridebby-23` (80c55ed) e `nutridebby-c` (`plano-23-agenda-2`, e9690ab): `locais_atendimento` (`staff_only`), `appointments.local_id`, status `solicitada`, `consultations.retorno_previsto_em`, RN-416 (Retorno pelo `min` das realizadas e dos atendimentos), US-416 (local no Financeiro pelo `appointment_id`). As funções da agenda conferem `ctx.role === 'nutri'` (RN-400 de lá) |
| DEP-R8 | **Ficha (Plano 18)** | Perfil reaproveitado | ✅ formulário do Perfil (`[id]/perfil`), `cadastroDoPaciente` com `auditRead` (RN-268), nome social na lista (RN-266) |

---

## 2. Escopo

### 2.1 Dentro

| ID | Bloco | Conteúdo | PD | PR |
|---|---|---|---|---|
| RE-01 | **Relatórios: estrutura** | `/painel/relatorios` com seis seções em abas-link, item "Relatórios" no menu, filtro de período, filtro de local (Fase B, com o 23), estado vazio | PD-100 | 1 |
| RE-02 | **Seções** | Pacientes (situação, sexo, fase da vida, novos por mês); Atendimentos (pacientes atendidos por mês, primeira consulta × retorno, atendimentos registrados); Planos alimentares (publicados e pacientes com plano por mês); Agenda (marcadas, realizadas, faltas, cancelamentos, taxa de faltas, retornos, marcadas pelo paciente); Financeiro (recebido, pago e resultado por mês e por categoria); Ranking (mais consultas, maior receita) | PD-100 | 1 |
| RE-03 | **Exportar** | CSV de cada seção; "Imprimir ou salvar em PDF" de cada seção; registro `exportar` | PD-100 | 1 |
| RE-04 | **Papel `recepcao` no banco** | `user.app_role` e `invites.tipo` com `recepcao`; `user.ultimo_acesso_em`; tabela `equipe_membros`; negação por padrão `recepcao_negada` + `RECEPCAO_LIBERADO` + guarda; condições `recepcao_cond_*` (financeiro, notificações da agenda, paciente visível, própria linha); gatilhos de colunas por lista branca (`patients`, `patient_cadastro`, `appointments`, `tenants`); com o 23, `app_appointments_regras_pedido` refeito para a recepção responder pedidos de paciente cadastrado (RE-D59); gatilhos que leem o papel ou o paciente revistos (falha fechada); funções `SECURITY DEFINER` de marcos de atendimento por consulta visível e de "tem atendimento" (RE-D62) | PD-101 | 2 |
| RE-05 | **Sessão e entrada** | `requireEquipe`/`requireApiEquipe`; `/inicio`, `/conta/outro-papel` e `/api/sessao/ativa` aceitando a recepção (RE-D67); 2FA obrigatório; prazos da equipe; DPA do consultório pendente bloqueia; página "Sem permissão" | PD-101 | 2 |
| RE-06 | **Equipe** (`/painel/configuracoes/equipe`) | Convidar, reenviar convite, permissão do Financeiro, desativar, reativar, último acesso | PD-101 | 2 |
| RE-07 | **Primeiro acesso** | Convite `/convite/[token]` com senha e termo de confidencialidade; configuração do 2FA | PD-101 | 2 |
| RE-08 | **Painel da recepção** | Início da recepção; menu filtrado; lista de pacientes; "Novo paciente"; cadastro em `/painel/cadastro/[id]` (Perfil e Consultas); agenda (marcar, alterar, cancelar, confirmar, faltou; pedidos de pacientes cadastrados do 23, RE-D59); Financeiro com a permissão; Relatórios das seções permitidas | PD-101 | 3 |
| RE-09 | **Auditoria** | Escritas e leituras da recepção com ator no `audit_log`; "Nome (recepção)" no Histórico de acessos; registro das ações da Equipe | PD-101 | 2 e 3 |
| RE-10 | **Manuais e ajuda** | Manual guiado por papel (`guiaDaRota(caminho, papel)`, RE-D42); guias novos `relatorios`, `equipe` e os da recepção (`recepcao-inicio`, `recepcao-pacientes`, `recepcao-cadastro`, `recepcao-agenda`, `recepcao-financeiro`); `SEM_AJUDA` para as telas de aviso e a impressão; manual técnico caps. 02, 03, 04, 05, 06 e 07; manual do usuário (Docs, aba nova "Recepção" e seção "Relatórios"); Central de Ajuda; tabela "Textos de interface" das histórias; CLAUDE.md (regras 1, 2 e 8) | — | 1, 2 e 3 |

### 2.2 Fora

| Item | Por quê |
|---|---|
| Clicar num número do relatório e ver a lista de pacientes ("drill-down") | Transforma o agregado em lista nominal de dado de saúde ("os 4 pacientes que fizeram retorno em março"): pede `auditRead` por paciente e muda o que conta como acesso (RE-D5). Backlog |
| Gráficos interativos e comparação com o ano anterior | Tabelas com barras simples bastam na v1 (como as "Entradas e saídas" do Plano 20); backlog |
| Relatório por etiqueta, por diagnóstico, por objetivo ou por fase de gestação/lactação | Etiqueta e diagnóstico são dado de saúde de pessoa identificável em grupos pequenos; não há campo de gestação (RE-D6) |
| Relatório agendado por e-mail | Mandaria número do consultório para fora do painel; sem pedido; backlog |
| PDF gerado no servidor | Regra 9 e C-482 (RE-D9) |
| Outros papéis (nutricionista associada, estagiária, financeiro sem agenda) e permissões finas por tela | Uma nutricionista por consultório (US-001); permissão única do Financeiro cobre o pedido (RE-D19). Backlog "Equipe 2" |
| Convite da recepcionista pelo admin | O admin não grava em tabela com `tenant_id` e não é quem decide quem acessa o consultório (RE-D17) |
| A recepção registrar atendimento, marcar "Realizada", ver Histórico de acessos, arquivar, reativar, bloquear ou pedir exclusão de paciente, mexer em etiquetas, em "Não mostrar peso no app", na IA, no opt-in do WhatsApp, em horários, bloqueios, locais, aniversariantes, configurações do consultório ou do Financeiro | Clínico, privativo da nutricionista ou configuração (RE-D22, RE-D25, RE-D26) |
| A recepção no chat e nos recados do Plano 25 | Conversa com o paciente pode ter dado de saúde; as tabelas do 25 nascem negadas à recepção (RN-505) e o item "Mensagens" fica fora do menu dela (Plano 25, CH-D33) |
| A recepção ver o Ranking de pacientes (consultas ou receita) | Lista nominal do uso de um serviço de saúde por pessoa, sem tarefa da recepção que precise dela (LGPD, art. 6º, III; RE-D36) |
| A recepção responder pedido de **pessoa nova** do agendamento público (Plano 23) | O aceite cria o paciente com `origem = 'agendamento_publico'`, grava o aceite do termo em `consents` e o opt-in do WhatsApp de origem `paciente`: três escritas fora da lista branca dela, mais uma exceção de RLS e um marcador local. Fica com a nutricionista na v1; a recepção responde os pedidos de pacientes já cadastrados (RE-D59) |
| A recepção corrigir o e-mail do paciente ou enviar o convite do app | O e-mail é a chave do portal, do link dos documentos assinados e do link da autorização de IA: trocá-lo daria a quem trocou o acesso ao prontuário pelo portal (RE-D37) |
| A recepção ver a observação e a identidade de gênero do cadastro | Texto livre que pode ter dado de saúde, escrito antes sob outro aviso; identidade de gênero sem classificação fechada (pergunta 5 do Plano 18 ao advogado) e sem uso na agenda (RE-D38) |
| Push e e-mail de aviso para a recepcionista | Os avisos da agenda continuam indo à nutricionista (RE-D30); backlog |
| Registro de login da equipe numa tela própria | A tela Equipe mostra o último acesso (RN-516); a trilha completa de login é backlog SBIS |
| Recepção em mais de um consultório com a mesma conta | Uma conta = um consultório (`user.tenant_id`), como a nutricionista |

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** (sessão `nutri`) | Tudo dos Relatórios; exportar; convidar, reenviar convite, dar e tirar a permissão do Financeiro, desativar e reativar a recepção; ver no Histórico de acessos o que a recepção fez; conferir o e-mail e enviar o convite do app do paciente cadastrado pela recepção | Apagar a linha de uma recepcionista (só desativar, RE-D28); convidar além de 3 ativas (RE-D18) |
| **Recepcionista** (sessão `recepcao`, 2FA ativo, termo aceito, ativa) | Início da recepção; lista de pacientes (ativos e inativos); cadastrar paciente (sem convite do app, RE-D37) e editar o cadastro (dados gerais, contato sem o e-mail, endereço); agenda: ver, marcar, alterar, cancelar (sem motivo), confirmar, registrar falta (sem atendimento ligado, RE-D62), imprimir; aceitar e recusar os pedidos de pacientes já cadastrados (Plano 23; os de pessoa nova ficam com a nutricionista, RE-D59); Relatórios: Pacientes (sem bloqueados, RE-D39) e Agenda; **com a permissão do Financeiro**: Resumo, Lançamentos, Pagamentos pendentes, Relatórios do Financeiro, CSV e a seção Financeiro dos Relatórios | Ler ou gravar qualquer tabela clínica (lista na RN-517); abrir a ficha do prontuário (`/painel/pacientes/[id]/…`); mudar o e-mail do paciente ou enviar o convite do app; ver a observação e a identidade de gênero do cadastro; marcar "Realizada" ou registrar atendimento; ver ou registrar a Cobrança da consulta (RE-D61); responder pedido de pessoa nova (RE-D59); ver Atendimentos, Planos alimentares e Ranking nos Relatórios; ver o Histórico de acessos; ver paciente bloqueado ou anonimizado; mudar configurações (consultório, horários, locais, Financeiro, WhatsApp, marca, IA); convidar outra pessoa |
| **Paciente** | Nada novo | Ver Relatórios ou a Equipe |
| **Admin** | Reiniciar o 2FA de uma recepcionista pelo fluxo que já existe (`reiniciarPeloAdmin`, por e-mail; `admin_actions.alvo_papel = 'recepcao'`; teste na tarefa da sessão) | Convidar, ler ou mudar `equipe_membros` (C-487); saber quantas pessoas da equipe estão ativas (a desativação mora em `equipe_membros`; descartado na §18.4) |
| **Worker** | — (nada novo) | — |
| **Público** | — | Tudo (`publico_negado`) |

---

## 4. Arquitetura

### 4.1 Rotas e navegação

| Tela | Rota | Título (h1) | Quem | Nova? |
|---|---|---|---|---|
| Relatórios: Pacientes | `/painel/relatorios?de=AAAA-MM&ate=AAAA-MM&local=<id>` | "Relatórios" (h2 "Pacientes") | nutri, recepção | Nova |
| Relatórios: Atendimentos | `/painel/relatorios/atendimentos?…` | "Relatórios" (h2 "Atendimentos") | nutri | Nova |
| Relatórios: Planos alimentares | `/painel/relatorios/planos?…` | "Relatórios" (h2 "Planos alimentares") | nutri | Nova |
| Relatórios: Agenda | `/painel/relatorios/agenda?…` | "Relatórios" (h2 "Agenda") | nutri, recepção | Nova |
| Relatórios: Financeiro | `/painel/relatorios/financeiro?…` | "Relatórios" (h2 "Financeiro") | nutri, recepção com a permissão | Nova |
| Relatórios: Ranking | `/painel/relatorios/ranking?…&por=consultas\|receita` | "Relatórios" (h2 "Ranking de pacientes") | nutri (RE-D36) | Nova |
| Impressão | `/painel/relatorios/imprimir?secao=…&de=…&ate=…&local=…[&por=…]`; link "Ver versão para imprimir" com `prefetch={false}`; `<title>` "Relatório de {seção} — {consultório}" (nome sugerido do PDF, sem dado de paciente); `Cache-Control: no-store` em `next.config.ts` | "Relatório de {seção}" | como a seção | Nova |
| CSV | `GET /api/painel/relatorios/csv?secao=…&de=…&ate=…&local=…[&por=…]` | — | como a seção | Nova |
| Equipe | `/painel/configuracoes/equipe` (`?ok=convidada\|reenviado\|permissao\|desativada\|reativada`) | "Equipe" | nutri | Nova |
| Convite | `/convite/[token]` (o mesmo da nutricionista; o tipo do convite decide o formulário) | "Criar sua senha" | sem login | Muda |
| Sem permissão | `/painel/sem-permissao?motivo=nutri\|financeiro` | "Sem permissão" | recepção (dois textos, RE-D47) | Nova |
| Contrato pendente | `/painel/contrato-pendente` | "Contrato do consultório pendente" | recepção | Nova |
| Acesso desativado | `/conta/acesso-desativado` (fora do painel) | "Acesso desativado" | recepção desativada (`forbidden` da RN-503) | Nova |
| Segurança da conta | `/conta/seguranca` | "Segurança da conta" | admin, nutri, recepção (aviso do 2FA obrigatório também para ela; a conta desativada vai a `/conta/acesso-desativado`) | Muda |
| Entrada e sessão (fora do painel) | `/inicio` (destino do login, do 2FA e do "Continuar" da Segurança), `/conta/outro-papel` (`VOLTAR` e `textoOutroPapel` com a recepção), `GET`/`POST /api/sessao/ativa` (aviso de inatividade do `VigiaDeSessao`) | — | admin, nutri, paciente, recepção (RE-D67) | Muda |
| Cadastro (recepção) | `/painel/cadastro/[id]` | "{nome exibido}" | recepção (a nutricionista é redirecionada para `/painel/pacientes/[id]/perfil`) | Nova |
| Início | `/painel` (versão da recepção, RN-514) | "Seu dia, {nome}" (como hoje; o mesmo na versão da recepção) | nutri, recepção | Muda |
| Pacientes, Novo paciente | `/painel/pacientes`, `/painel/pacientes/novo` | como hoje | nutri, recepção (projeção da RN-515) | Muda |
| Agenda | `/painel/agenda`, `/agenda/nova`, `/agenda/consultas/[id]`, `/agenda/pendencias`; do 23: `/agenda/solicitacoes` (para a recepção, só os pedidos de pacientes cadastrados, RE-D59), `/agenda/imprimir` | como hoje | nutri, recepção | Muda |
| Financeiro | as telas do Plano 20, **menos** `/painel/financeiro/configuracoes` | como no 20 | nutri; recepção com a permissão | Muda |

- **Menu** (`navegacao.ts`): item **"Relatórios"** (`/painel/relatorios`) entre "Financeiro" e "Configurações", para a
  nutricionista e para a recepção. `itensDoMenu` ganha o papel: para a recepção, só **Início, Pacientes, Agenda,
  Financeiro (com a permissão) e Relatórios**; sem "Diários", "Exames recebidos", "Dúvidas dos pacientes",
  "Conteúdos" e "Configurações" (RN-514). `itemAtual` marca "Pacientes" também em `/painel/cadastro/{id}`. O menu da
  nutricionista passa de 10 itens e quebra em duas linhas a 1280 px (o `flex-wrap` de hoje): aceito. O `MenuConta` da
  recepção mostra "Rever o tour" (o tour dela, RE-D42), "Manual" (`/painel/ajuda`, filtrado por papel), "Segurança" e
  "Sair"; o tema muda pelo botão claro/escuro do cabeçalho (`alternarTemaAction` com `requireEquipe`, RN-513). Não há
  item "Preferências" (não existe página `/painel/preferencias`).
- **Abas dos Relatórios**: `nav aria-label="Seções dos relatórios"` com links e `aria-current="page"` (como a navegação do
  Financeiro), na ordem "Pacientes · Atendimentos · Planos alimentares · Agenda · Financeiro · Ranking"; a recepção só vê
  as que pode (RN-480). Os links das abas levam o `de`, o `ate` e o `local`.
- **Filtros** (formulário GET, funciona sem JS): "De" e "Até" como `<select>` de meses (o Firefox desktop não tem
  `<input type="month">`, RN-306 do Plano 20), "Local" (só com o Plano 23 e mais de um local) e o botão "Aplicar". Os
  botões "Baixar CSV" e "Ver versão para imprimir" ficam ao lado do título da seção e levam os mesmos parâmetros. No
  Ranking, "Mais consultas" e "Maior receita" são links com `aria-current` (como as abas), não `<select>`.

### 4.2 Módulos

Todas as funções com `withTenant(ctx, …)`, `ctx` com `actorUserId` e `ip`. Cada função dos Relatórios confere o papel
e a seção antes de abrir a transação (`podeVerSecao(acesso, secao)`, RN-480).

| Arquivo | Papel |
|---|---|
| `src/modules/relatorios/constantes.ts` (novo) | `MSG_RELATORIOS` (§6.2), `SECOES`, `FAIXAS_ETARIAS`, `RANKING_LIMITE = 20`, `MESES_MAX = 12` |
| `src/modules/relatorios/periodo.ts` (novo, puro) | `periodoDaUrl(sp, hoje, fuso)` → `{ de, ate, meses[], erro? }`; limites do mês no fuso a partir de `fuso.ts` (C-483); opções do `<select>` do mês mais antigo entre o primeiro cadastro e o mês atual − 11 até o mês atual (RN-481, RE-D48) |
| `src/modules/relatorios/acesso.ts` (novo, puro) | `secoesPermitidas({ papel, financeiro })`, `podeVerSecao`, `podeRankingPor` (RN-480) |
| `src/modules/relatorios/pacientes.ts`, `atendimentos.ts`, `planos.ts`, `agenda.ts`, `financeiro.ts`, `ranking.ts` (novos) | Uma função por seção, uma transação, agregação no SQL (`count(*) filter (…)`, `date_trunc('month', … at time zone fuso)`), devolvendo só números e rótulos; o Ranking devolve `{ patientId, nome, valor }` (RN-492). `financeiro.ts` só chama funções de `@/modules/financeiro` (RN-491) |
| `src/modules/relatorios/csv.ts` (novo, puro) | Linhas do CSV por seção com as regras da RN-321 do Plano 20, reaproveitando o escape de célula de `@/modules/financeiro/csv` (exportado, sem mover o arquivo) |
| `src/modules/relatorios/registro.ts` (novo) | `registrarExportacao(tx, { secao, periodo, local, pacientes? })` (RN-493) |
| `src/modules/plataforma/equipe.ts` (novo) | `listarEquipe`, `convidarRecepcao`, `reenviarConviteRecepcao`, `definirPermissaoFinanceiro`, `desativarRecepcao`, `reativarRecepcao`, `membroAtivo(tx, userId)`; acessa `user` (exceção de RLS: entra na lista da regra 1), `invites` e `consents` (entram nas listas da regra 1) |
| `src/modules/plataforma/convites.ts` | `inspecionarConvite`/`aceitarConvite` aceitam o tipo `recepcao`: grava o aceite do termo de confidencialidade (`sigilo-equipe-<versão>`) em vez do DPA (RN-500) |
| `src/lib/tenant-session.ts` | `requireEquipe(path, { secao? , financeiro? })` e `requireApiEquipe(req, …)` → `{ data, tenant, ctx, papel, financeiro }`; `requireNutri` continua só `nutri` |
| `src/lib/session-rules.ts` | `AppRole` + `recepcao`; `ROTULO_PAPEL.recepcao = 'recepção'`; `homeFor('recepcao') = '/painel'`; 2FA obrigatório (RN-500); recepção desativada → `forbidden` com destino `/conta/acesso-desativado` (RN-503); recusa da recepção numa página só da nutricionista → `/painel/sem-permissao?motivo=nutri` |
| `src/db/tenant.ts` | `TenantRole` + `recepcao`; `assertContext` exige `actorUserId` e recusa `patientId` e `semConta` para ela |
| `src/app/painel/rotas-da-recepcao.ts` (novo) | `ROTAS_DA_RECEPCAO` (lista fechada, RN-513) e o teste de fonte |
| `src/modules/ajuda/conteudo.ts`, `src/app/painel/guia/guia-do-painel.tsx`, `src/app/painel/ajuda/page.tsx` | `Guia.papeis` (padrão `['nutri']`), `guiaDaRota(caminho, papel)`, `GuiaDoPainel` com o papel (o tour `boas-vindas` só para `nutri`; `recepcao-inicio` para a recepção), `/painel/ajuda` filtrado por papel (RE-D42) |
| `src/app/painel/preferencias/actions.ts` | `alternarTemaAction` e `marcarGuiaAction` com `requireEquipe` (tema do cabeçalho e progresso do guia da recepção); `escolherTemaAction` continua `requireNutri` (hub Configurações) |
| `src/app/conta/seguranca/page.tsx`, `src/app/conta/acesso-desativado/page.tsx` (nova) | Segurança aceita `recepcao` (aviso do 2FA obrigatório como o do admin, RN-500); a página de acesso desativado não abre nada do painel |
| `src/lib/auth.ts` | `databaseHooks.session.create.after`: grava `user.ultimo_acesso_em` da conta `recepcao` (RN-516, RE-D43) |
| `src/app/inicio/page.tsx`, `src/app/conta/outro-papel/page.tsx`, `src/app/api/sessao/ativa/route.ts` | Aceitam a recepção (RE-D67); guarda de fonte: todo `requireUser(`/`requireApiUser(`/`lerSessaoApi(` fora de `src/app/painel` e `src/app/api/painel` tem decisão para `recepcao` (aceita ou recusa, numa lista) |
| `src/db/migrate.ts` | Conexão do migrador com `lock_timeout` de 10 s (RE-D64) |
| Mudam (PR 3) | `src/app/painel/layout.tsx` e `page.tsx` (versão da recepção), `navegacao.ts`, `pacientes/page.tsx` (link do nome para o cadastro) e `novo/page.tsx`, `agenda/*` (páginas e actions; em `consultas/[id]`: "Abrir cadastro", sem o motivo do cancelamento e sem "Iniciar atendimento"; `cancelar-form.tsx` sem o campo de motivo para a recepção), `financeiro/*` (páginas e actions), `src/modules/agenda/{consultas,presenca,disponibilidade}.ts` (papel aceito por função, RN-509), `src/modules/pacientes/pacientes.ts` (`criarPaciente` sem convite e `atualizarPaciente` sem e-mail nem WhatsApp na sessão da recepção; `listarPacientes` com a projeção da recepção), `src/modules/financeiro/*` (`exigirFinanceiro(ctx)` no lugar de `exigirNutri(ctx)`, menos `configuracoes.ts`, `cobranca.ts` e `titular.ts`; a seção "Cobrança" da consulta nunca aparece para a recepção, RE-D61); `src/modules/documentos/*` e `src/modules/ia/autorizacao.ts` (só as telas da nutricionista: confirmação do e-mail antes de cada envio de link, RE-D60) |

### 4.3 O que a recepção toca no banco (matriz fechada)

Toda tabela com `tenant_id` fora desta tabela tem `recepcao_negada` (RESTRICTIVE, FOR ALL) e a sessão `recepcao` não
vê nem grava nada nela (RN-505). As linhas valem na **PR 2** (o banco já nasce assim, mesmo sem telas); a marcada
"23" entra na mesma migration, porque o PR 2 só abre com o 23 PR 1 na `main` (C-488).

| Tabela | Comandos | Condição extra (RESTRICTIVE) | Motivo |
|---|---|---|---|
| `patients` | select, insert, update | `recepcao_cond_paciente_visivel` (FOR ALL: `status <> 'bloqueado' and anonimizado_em is null`, RN-508); gatilho de colunas `patients_da_recepcao` (lista branca, `email` fixo no UPDATE) | Cadastro (RE-D25) |
| `patient_cadastro` | select, insert, update | `recepcao_cond_paciente_visivel` (por `EXISTS` no paciente: a RLS de `patients` vale dentro da subconsulta da política); gatilho `patient_cadastro_da_recepcao` (`observacao` e `identidade_genero` fixos no UPDATE e nulos no INSERT) | Cadastro, sem a observação nem a identidade de gênero (RE-D38) |
| `appointments` | select, insert, update | `recepcao_cond_paciente_visivel` (por `EXISTS`); gatilho `appointments_da_recepcao` (BEFORE INSERT OR UPDATE, lista branca, RN-509) | Agenda |
| `notifications` | select, insert, update | `recepcao_cond_notificacoes_da_agenda` (`tipo` ∈ `TIPOS_DA_AGENDA`, RN-507) + `recepcao_cond_paciente_visivel` (por `EXISTS`) | Lembretes da consulta |
| `availability_rules`, `availability_blocks` | select | — | Horários livres e grade da agenda; o motivo do bloqueio não sai do módulo (RN-509) |
| `audit_log` | insert | — | O gatilho de auditoria e o `auditRead` rodam com o papel de quem age |
| `equipe_membros` | select | `recepcao_cond_propria_linha`: `user_id = app_current_user()` | A permissão do Financeiro e a situação da própria conta |
| `fin_configuracoes`, `fin_categorias` | select | `recepcao_cond_financeiro`: `(SELECT app_recepcao_tem_financeiro())` (uma avaliação por consulta, não por linha) | Valor da consulta e categorias nos formulários |
| `fin_lancamentos` | select, insert, update | `recepcao_cond_financeiro` + `recepcao_cond_paciente_visivel` (`patient_id IS NULL OR EXISTS`) + gatilho `fin_lancamentos_regras` revisto (RN-506) | Financeiro com a permissão |
| `locais_atendimento` (23) | select | — | Filtro e seletor de local; o link da sala não sai do módulo |

`public_booking_requests` (23, pedidos de pessoa nova) **não** está na matriz: fica negada à recepção (RE-D59). Os pedidos
de paciente cadastrado são consultas `solicitada` em `appointments`, já liberada.

Tabelas **sem** `tenant_id` que a recepção toca: `tenants` (lê; o gatilho novo `tenants_so_nutri` recusa UPDATE da
recepção, RN-512; o `app_tenants_agenda_da_equipe` do 23 entra em `FUNCOES_COM_PAPEL`), `ia_nutri_pausa` (ninguém da equipe usa nas telas da recepção). Exceções de RLS (`user`, `invites`,
`consents`): só pelos módulos listados na regra 1 (RN-498, RN-499, RN-500).

Toda condição tem o nome `recepcao_cond_<assunto>`, é `AS RESTRICTIVE` e declara o comando (`FOR ALL` ou `FOR SELECT`):
uma condição PERMISSIVE do tipo `role <> 'recepcao' OR …` somaria com `tenant_isolation` e abriria os outros
consultórios a todo papel. A guarda recusa condição PERMISSIVE e nome `recepcao_*` fora dos três padrões
(`recepcao_negada`, `recepcao_sem_<cmd>`, `recepcao_cond_<assunto>`) (RN-505).

### 4.4 Funções e gatilhos que olham o papel (lista fechada, RN-511)

Uma consulta a `pg_proc` (`prosrc ~ '''nutri'''`, `app_current_role` ou `current_setting('app.role'`, que a 0083 usa) lista
toda função que decide pelo papel; **também** entram na lista as funções e os gatilhos das tabelas de `RECEPCAO_LIBERADO`
que leem `patients`: a leitura pela RLS de quem age volta vazia para o paciente escondido da recepção, e uma guarda por
`IF v_status = …` ou `EXISTS` passaria calada (RE-D40). Cada
uma entra em `FUNCOES_COM_PAPEL` (`src/db/rls-guard.ts`) com a decisão para a recepção: **"recusa"** (o ramo dela cai
no erro ou na RLS), **"como nutri"** (o ramo da nutricionista passa a valer para a recepção) ou **"não se aplica"** (a
tabela é negada à recepção). A guarda `findPapelEmFuncoesViolations` quebra o CI quando aparece função nova que olha o
papel sem decisão. Decisões já tomadas aqui:

| Função / gatilho | Tabela | Decisão para `recepcao` |
|---|---|---|
| `fin_lancamentos_regras` (0123) | `fin_lancamentos` | **como nutri, com falha fechada**: o ramo "papel diferente de `nutri` → a RLS recusa" passa a "papel fora de (`nutri`, `recepcao`)"; com a recepção, lê o paciente `FOR KEY SHARE` e, **se não achar (`NOT FOUND`), recusa com 42501**; recusa bloqueado e anonimizado e grava `criado_por`/`cancelado_por` = `app_current_user()` (RN-506) |
| `app_paciente_colunas_patients` (0085/0119) | `patients` | não se aplica (só `paciente`); a recepção ganha gatilho próprio (RN-508) |
| gatilhos de IA em `patients` e `tenants` (0099/0100/0116: `r NOT IN ('', 'nutri', 'worker')`) | `patients`, `tenants` | **recusa** (já recusam todo papel fora da lista) |
| `app_ia_nutri_revogar`, `app_ia_nutri_*` (0116/0117) | IA Nutri | não se aplica / recusa |
| `exam_submissions_regras` (0102), `ia_autorizacoes_regras` (0108), `lembretes_rotina_*` (0119) | clínicas | não se aplica (tabela negada) |
| `audit_row_change` (0007) | todas as auditadas | grava o ator de `app.user_id` para qualquer papel: sem mudança |
| `app_patient_cadastro_titular_ativo` (0125) | `patient_cadastro` | **sem mudança**: o `EXISTS` dá falso para titular escondido, mas a condição `recepcao_cond_paciente_visivel` de `patient_cadastro` recusa antes |
| `travarLancamento` (módulo do 20), `travarPacienteDaConsulta` (`agenda/cancelamento.ts:73`), `carregarPacienteParaEscrita` | `fin_lancamentos`, `appointments`, `patients` | **falha fechada no módulo**: na sessão da recepção, paciente não achado = "não encontrado" (nunca "não bloqueado"); a condição `recepcao_cond_paciente_visivel` das tabelas filhas segura no banco |
| guarda "Faltou com atendimento ligado" (`registrarPresenca`, `presenca.ts:41-43`, lê `consultations` pela RLS de quem age) | `appointments` | **falha fechada por função** (RE-D62): na sessão da recepção, a busca em `consultations` volta vazia e a guarda passaria calada; o gatilho `appointments_da_recepcao` e o módulo conferem por `app_consulta_tem_atendimento(appointment_id)` (`SECURITY DEFINER`, molde 0083, só o booleano). Vale para toda guarda de módulo liberado à recepção que leia tabela negada: o teste de fonte da agenda procura `from(<tabela negada>)` nas funções de `FUNCOES_DA_RECEPCAO` |
| `patients_da_recepcao`, `patient_cadastro_da_recepcao`, `appointments_da_recepcao`, `tenants_so_nutri`, `equipe_membros_regras` | as do nome | gatilhos novos deste plano, com a decisão "só `recepcao`" (os outros papéis passam intactos, salvo `equipe_membros_regras` e `tenants_so_nutri`) |
| (23) `app_appointments_regras_pedido` (`0127_rls_agenda_2.sql:52-159` no `plano-23-agenda-2`) | `appointments` | **como nutri, refeita na custom** (RE-D59): hoje só `r = 'nutri'` aceita (`solicitada → agendada`) e só `('nutri','pedido_recusado')` recusa; a custom do 26 traz o `CREATE OR REPLACE` com o corpo da `main` do momento e o papel `recepcao` nesses dois pontos (os outros ramos — `sistema`, `worker`, `paciente` — não mudam). Sem isso, a recepção recebe 42501 e o PR 3 (sem migration) não teria onde consertar |
| (23) `appointments_link_da_sala` | `appointments` | a cópia da sala vale para qualquer papel (AG-D47 e RLS-08 do 23): sem mudança |
| (23) `app_tenants_agenda_da_equipe` | `tenants` | decidida na tarefa do banco (o `tenants_so_nutri` já recusa todo UPDATE da recepção) |
| (23) `app_pedido_aguardar` e as funções de `public_booking_requests` | `public_booking_requests` | não se aplica: tabela negada à recepção (RE-D59) |
| funções novas dos Planos 19, 21, 22 e 25 (ex.: as do 22 com `IF r <> 'nutri' THEN RETURN NEW`, `nutridebby-22/drizzle/0127_rls_exames_catalogo.sql:57,88`) | as deles | listadas por `pg_proc` na `main` do momento, na tarefa do banco (PM-R1); tabela negada → "não se aplica"; o plano que entrar **depois** do PR 2 do 26 decide as próprias funções na entrada dele (a guarda quebra sem a decisão) |

---

## 5. Histórias de usuário

### E26a — Relatórios (PR 1)

#### US-480 — Relatório de pacientes · **M** (PD-100)

**Como** nutricionista, **quero** ver quantos pacientes tenho por situação, sexo e fase da vida e quantos chegaram por
mês, **para** conhecer o perfil do consultório.

```gherkin
Cenário: Visão do consultório
  Dado 40 pacientes ativos, 8 arquivados, 2 bloqueados e 1 anonimizado
  Quando abro "Relatórios"
  Então vejo a seção "Pacientes" marcada nas abas
  E a tabela "Pacientes por situação" com "Ativos 40", "Inativos (arquivados) 8", "Bloqueados por pedido de exclusão 2" e "Total 50"
  E a nota "Pacientes anonimizados não entram nestes números."
  E as tabelas "Pacientes ativos por sexo" e "Pacientes ativos por fase da vida", com número e percentual (uma casa, vírgula)

Cenário: Fase da vida
  Dado pacientes ativos de 25, 45 e 70 anos e um sem data de nascimento (agendamento público)
  Então "Pacientes ativos por fase da vida" mostra "Adultos (18 a 59 anos) 2", "Pessoas idosas (60 anos ou mais) 1", "Sem data de nascimento 1"
  E, abaixo, as faixas "18 a 29", "30 a 39", "40 a 49", "50 a 59" e "60 ou mais"

Cenário: Novos pacientes no período
  Dado o período de 01/2026 a 11/2026
  Então a tabela "Novos pacientes por mês" tem uma linha por mês, com o total no fim
  E conta todos os cadastros criados no mês, inclusive os que depois foram arquivados, bloqueados ou anonimizados

Cenário: Com local (Plano 23 na main)
  Quando escolho o local "Consultório Centro" e aplico
  Então as tabelas contam só os pacientes com consulta não cancelada nesse local no período
  E vejo "Pacientes com consulta neste local no período. Sem o filtro, a contagem é de todos os pacientes."

Cenário: Recepção (RE-D39)
  Dado que entrei como recepção
  Então a tabela "Pacientes por situação" não tem a linha "Bloqueados por pedido de exclusão"
  E vejo "Pacientes bloqueados por pedido de exclusão e anonimizados não entram nos números da recepção."
  E "Novos pacientes por mês" conta só os cadastros que ela pode ver
```

#### US-481 — Pacientes atendidos e atendimentos por mês · **M** (PD-100)

```gherkin
Cenário: Atendidos por mês
  Dado em março uma consulta realizada de Ana, um atendimento de Ana registrado no mesmo dia e um atendimento de Bruno sem consulta
  Quando abro "Relatórios › Atendimentos" com março no período
  Então "Pacientes atendidos" de março é 2 (cada paciente conta uma vez no mês)
  E "Consultas realizadas" é 1 e "Atendimentos registrados" é 2

Cenário: Primeira consulta e retorno
  Dado que Bruno nunca tinha sido atendido e Ana já tinha consulta realizada em janeiro
  Então em março "Pacientes novos (primeiro atendimento)" é 1 e "Pacientes em retorno" é 1
  E a nota "Retorno: o paciente já tinha consulta realizada ou atendimento antes do mês."

Cenário: Local
  Quando filtro por um local
  Então só as consultas realizadas nesse local contam
  E vejo "Atendimentos registrados sem consulta marcada não têm local e ficam fora deste filtro."

Cenário: Recepção
  Dado que entrei como recepção
  Então a aba "Atendimentos" não aparece
  E abrir "/painel/relatorios/atendimentos" leva a "Sem permissão"
```

#### US-482 — Planos alimentares por período · **S** (PD-100)

```gherkin
Cenário: Planos por mês
  Quando abro "Relatórios › Planos alimentares"
  Então vejo por mês "Publicações de plano" (cada publicação conta, inclusive nova versão) e "Pacientes com plano publicado no mês"
  E o cartão "Pacientes ativos com plano publicado hoje: {n} de {total}"
  E modelos de plano não entram
  E o filtro de local fica desligado, com "O filtro de local não se aplica aos planos alimentares."
```

#### US-483 — Relatório da agenda · **M** (PD-100)

```gherkin
Cenário: Consultas por mês
  Quando abro "Relatórios › Agenda"
  Então a tabela tem por mês: "Marcadas", "Realizadas", "Faltas", "Taxa de faltas", "Canceladas pelo paciente", "Canceladas pelo consultório", "Marcadas pelo paciente" e "Retornos"
  E "Taxa de faltas" usa a mesma conta do Início (faltas ÷ consultas não canceladas já iniciadas), "12,5% (2 de 16)"
  E consultas canceladas pela exclusão de dados (LGPD) não entram em nenhuma coluna
  E pedidos aguardando confirmação (Plano 23) não entram

Cenário: Mês atual bate com o Início
  Então "Marcadas" e "Faltas" do mês atual são iguais aos números "Consultas do mês" e "Faltas" do Início

Cenário: Previsões de retorno (Plano 23 na main)
  Então a tabela ganha "Retornos previstos" (previsões com data no mês) e "Previstos com consulta marcada"
```

#### US-484 — Relatório financeiro do período · **M** (PD-100)

```gherkin
Cenário: Receitas e despesas
  Dado o Financeiro configurado
  Quando abro "Relatórios › Financeiro" de 01/2026 a 06/2026
  Então vejo por mês "Recebido", "Pago" e "Resultado", com o total do período
  E a tabela "Por categoria" (entradas e saídas, recebidas ou pagas no período)
  E lançamentos cancelados e em aberto não entram
  E o link "Fluxo de caixa do ano e CSV dos lançamentos" leva a "Financeiro › Relatórios"

Cenário: Financeiro não configurado
  Então vejo "O Financeiro ainda não foi configurado." e o link "Configurar o Financeiro" (só para a nutricionista); a recepção vê "Peça à nutricionista para configurar o Financeiro."

Cenário: Local
  Quando filtro por um local
  Então "Recebido" conta só as entradas ligadas a consulta desse local
  E "Pago" mostra "—", com "Saídas não têm local."

Cenário: Recepção sem a permissão
  Então a aba "Financeiro" não aparece
```

#### US-485 — Ranking de pacientes · **M** (PD-100)

```gherkin
Cenário: Mais consultas
  Quando abro "Relatórios › Ranking"
  Então vejo "Pacientes com mais consultas realizadas" com até 20 linhas: posição, nome e número de consultas
  E empate fica em ordem alfabética
  E pacientes bloqueados e anonimizados não aparecem
  E vejo "Lista com nomes de pacientes. Ao exportar, cada paciente da lista registra 'Exportou — Relatórios' no Histórico de acessos."

Cenário: Maior receita
  Quando escolho "Maior receita"
  Então vejo "Pacientes com maior receita recebida", com o valor em "R$ 1.250,00"
  E só entram entradas recebidas, não canceladas, com paciente, pela data do recebimento

Cenário: Nome na tela e no arquivo
  Dado o paciente "João Silva" com nome social "Joana Silva"
  Então a tela mostra "Joana Silva" e o CSV e a impressão mostram "João Silva" (coluna "Paciente (nome de registro)")

Cenário: Ver a ficha
  Então cada nome é link para a ficha, com prefetch desligado

Cenário: Recepção (RE-D36)
  Dado que entrei como recepção, com ou sem a permissão do Financeiro
  Então a aba "Ranking" não aparece e "/painel/relatorios/ranking" leva a "Sem permissão"
```

#### US-486 — Período e local · **S** (PD-100)

```gherkin
Cenário: Padrão
  Quando abro os Relatórios sem parâmetros em 17/11/2026
  Então o período é de "dezembro de 2025" a "novembro de 2026"

Cenário: Período inválido
  Quando escolho "De" depois de "Até"
  Então vejo "O mês inicial não pode ser depois do final." junto do campo "De" (aria-invalid e aria-describedby, com o foco no aviso)
  E os selects ficam com o que escolhi, os números são os do período padrão e vejo "Mostrando dezembro de 2025 a novembro de 2026."
  Quando escolho mais de 12 meses
  Então vejo "Escolha um período de até 12 meses."

Cenário: Consultório com menos de 12 meses (RE-D48)
  Dado o primeiro cadastro em 09/2026
  Então "De" oferece os meses desde dezembro de 2025 e o padrão continua de "dezembro de 2025" a "novembro de 2026"

Cenário: Troca de seção mantém o filtro
  Dado o período 03/2026 a 05/2026 e o local "Centro"
  Quando vou para "Agenda"
  Então o filtro continua o mesmo

Cenário: Sem dados
  Dado um consultório novo
  Então cada seção mostra "Ainda não há dados neste período."
```

#### US-487 — Exportar CSV e imprimir em PDF · **M** (PD-100)

```gherkin
Cenário: CSV de agregado
  Quando toco em "Baixar CSV" na seção Agenda com 01/2026 a 06/2026
  Então recebo "relatorio-agenda-2026-01-a-2026-06.csv" (separador ";", UTF-8 com BOM, CRLF, vírgula decimal)
  E o audit_log ganha um "exportar" da entidade "relatorios", sem paciente, com entidade_id "agenda|2026-01..2026-06|todos"

Cenário: CSV do ranking
  Quando baixo o CSV do Ranking
  Então o Histórico de acessos de cada paciente da lista mostra "Exportou — Relatórios"

Cenário: Imprimir
  Quando toco em "Ver versão para imprimir"
  Então abre "Relatório de Agenda" com o nome do consultório, o período, o local, "Gerado em 17/11/2026 às 10:32" e as mesmas tabelas, com o botão "Imprimir ou salvar em PDF" e o título da aba "Relatório de Agenda — {consultório}"
  E o rodapé "Documento interno do consultório, com dados de pacientes. Guarde com sigilo."
  E o audit_log ganha o mesmo "exportar" do CSV (uma linha por paciente no Ranking)

Cenário: Sessão expirada no download
  Dado que a sessão expirou
  Quando toco em "Baixar CSV"
  Então sou levada ao login com a volta para a seção (nunca a uma página com JSON)
```

### E26b — Recepcionista (PRs 2 e 3)

#### US-488 — Convidar e gerenciar a recepção · **M** (PD-101)

**Como** nutricionista, **quero** dar acesso à pessoa da recepção só à agenda e ao cadastro, **para** dividir o trabalho
sem abrir o prontuário.

```gherkin
Cenário: Convidar
  Quando abro "Configurações › Equipe" e toco em "Convidar recepcionista"
  Então vejo a dica "Convide só quem trabalha para você no consultório. A pessoa vai aceitar um termo de confidencialidade."
  E informo o nome "Carla Lima" e o e-mail "carla@ex.com", deixo "Permitir acesso ao Controle Financeiro" desmarcado e confirmo
  Então a lista mostra "Carla Lima · Recepção · Convite enviado (vale até 20/11/2026 às 10:32)"
  E a Carla recebe o e-mail "Convite para a equipe de {consultório} no NutriDebby" com o link de 72 horas
  E o audit_log ganha "criar" da entidade "equipe", sem paciente

Cenário: E-mail já usado
  Quando convido um e-mail que já tem conta no NutriDebby (de paciente ou de outro consultório)
  Então vejo "Este e-mail já tem uma conta no NutriDebby. Use outro e-mail para a recepção." junto do campo
  # nunca diz de quem é a conta

Cenário: Limite
  Dado 3 recepcionistas ativas
  Então o botão "Convidar recepcionista" some e aparece "O consultório pode ter até 3 pessoas ativas na recepção.", com o foco nesse aviso

Cenário: Permissão do Financeiro
  Quando marco "Permitir acesso ao Controle Financeiro" da Carla e salvo
  Então a região de aviso diz "Permissão atualizada."
  E na próxima tela que a Carla abrir o item "Financeiro" aparece no menu dela
  E o audit_log ganha "alterar" da entidade "equipe"

Cenário: Desativar
  Quando toco em "Desativar" da Carla e confirmo "Desativar Carla Lima? A pessoa sai do NutriDebby agora e não entra mais. O que foi feito com esta conta continua no Histórico de acessos dos pacientes."
  Então as sessões dela são encerradas, o convite pendente (se houver) é apagado
  E a linha mostra "Acesso desativado em 17/11/2026" com o botão "Reativar", e o foco volta para a linha

Cenário: Último acesso
  Então cada pessoa ativa mostra "Último acesso: 17/11/2026 às 09:12" (o último login, RE-D43) ou "Ainda não entrou"
```

#### US-489 — Primeiro acesso da recepcionista · **M** (PD-101)

```gherkin
Cenário: Criar a senha e aceitar o termo
  Dado o convite válido da Carla
  Quando abro o link
  Então vejo "Criar sua senha", "Você recebeu um convite para a equipe de {consultório}." e o campo de senha com a política de hoje
  E o texto do Termo de confidencialidade da equipe na própria página (como o DPA da nutricionista) e a caixa "Li e aceito o Termo de confidencialidade da equipe"
  Quando crio a senha e aceito o termo
  Então a conta é ativada, o aceite é gravado em consents ("sigilo-equipe-1.0", consultório e IP) e vou ao login

Cenário: Sem aceitar o termo
  Então vejo "Para entrar na equipe, aceite o termo de confidencialidade." junto da caixa

Cenário: 2FA obrigatório
  Quando entro pela primeira vez
  Então vou para "Segurança da conta" com "A recepção precisa da verificação em duas etapas. Configure agora para continuar."
  E nenhuma tela do painel abre antes disso
```

#### US-490 — Painel da recepção · **M** (PD-101)

```gherkin
Cenário: Menu
  Dado que entrei como recepção sem a permissão do Financeiro
  Então o menu tem "Início", "Pacientes", "Agenda" e "Relatórios"
  E o menu da conta diz "Carla Lima · Recepção"

Cenário: Início
  Então vejo "Agenda de hoje", "Presença a registrar ({n})" e, com o Plano 23, "Solicitações ({n})"
  E não vejo exames recebidos, dúvidas dos pacientes, diários, uso da IA, armazenamento nem indicadores de faltas

Cenário: Rota proibida
  Quando abro "/painel/pacientes/{id}/antropometria"
  Então vejo "Sem permissão" e "Esta página é só da nutricionista." com o link "Voltar ao início"
  E nenhuma leitura de antropometria é feita nem registrada

Cenário: Financeiro sem a permissão (RE-D47)
  Quando abro "/painel/financeiro" sem a permissão do Financeiro
  Então vejo "Sem permissão" e "Você não tem permissão para o Financeiro. Peça à nutricionista."

Cenário: Acesso desativado (RE-D45)
  Dado que a nutricionista desativou meu acesso
  Quando entro
  Então vejo "Acesso desativado" e "Seu acesso a este consultório foi desativado. Fale com a nutricionista." com "Sair"

Cenário: Contrato do consultório pendente
  Dado que a nutricionista ainda não aceitou a versão atual do contrato de tratamento de dados
  Então vejo "O contrato de tratamento de dados do consultório precisa ser aceito pela nutricionista. Peça para ela entrar no NutriDebby." e nenhuma outra tela abre
```

#### US-491 — Cadastro de pacientes pela recepção · **M** (PD-101)

```gherkin
Cenário: Lista
  Quando abro "Pacientes"
  Então vejo as abas "Ativos", "Inativos" e "Todos", sem "Ver bloqueados" e sem o filtro de etiqueta
  E o menu da linha tem só "Abrir cadastro" e "Marcar consulta", e o nome do paciente leva a "/painel/cadastro/{id}"

Cenário: Novo paciente
  Quando cadastro um paciente com os campos de hoje e os do Plano 18
  Então o paciente é criado sem convite do app (RE-D37)
  E o Histórico de acessos dele mostra "Criou — Cadastro do paciente" por "Carla Lima (recepção)"

Cenário: Abrir o cadastro
  Quando abro "Abrir cadastro" de Ana
  Então vou a "/painel/cadastro/{id}", com as abas "Cadastro" e "Consultas"
  E o cabeçalho mostra nome, idade, situação e acesso ao app, sem medidas
  E o Histórico de acessos de Ana mostra "Visualizou — Cadastro do paciente" por "Carla Lima (recepção)"

Cenário: O que não aparece
  Então o cadastro não tem Arquivar, Reativar, Pedir exclusão, Etiquetas, "Não mostrar peso no app", IA, o consentimento do WhatsApp, a observação nem a identidade de gênero
  E o e-mail aparece só para leitura, com "Para corrigir o e-mail, peça à nutricionista."
  E o acesso ao app diz "A nutricionista envia o convite do app."

Cenário: Paciente bloqueado
  Dado um paciente bloqueado por pedido de exclusão
  Então ele não aparece em nenhuma aba e "/painel/cadastro/{id}" responde "Paciente não encontrado."

Cenário: Convite do app do paciente cadastrado pela recepção (RE-D37)
  Dado um paciente que a recepção cadastrou com e-mail
  Quando a nutricionista toca em "Enviar convite" no "No app" da ficha
  Então vê "O convite vai para {e-mail}. Confira o e-mail antes de enviar." e confirma
  E só então o convite sai

Cenário: Outros envios para o e-mail do paciente (RE-D60)
  Dado um paciente ativo sem conta no app
  Quando a nutricionista assina um documento dele (entrega por link), toca em "Reenviar link por e-mail" ou em "Enviar pedido de autorização por e-mail" (IA)
  Então vê, antes de confirmar, "O link vai para {e-mail}. Confira o e-mail antes de enviar."

Cenário: E-mail ou CPF já usado (RE-D65)
  Quando a recepção cadastra um paciente com o e-mail ou o CPF de outro paciente do consultório, visível ou não para ela
  Então vê a mesma mensagem de duplicidade de hoje, sem link para o outro paciente
```

#### US-492 — Agenda pela recepção · **M** (PD-101)

```gherkin
Cenário: Marcar, alterar e cancelar
  Quando marco uma consulta para Ana
  Então a consulta é criada com os lembretes de hoje e o Histórico de Ana mostra "Criou — Agenda" por "Carla Lima (recepção)"

Cenário: Presença
  Dado uma consulta agendada que já começou
  Então a recepção vê "Faltou" e não vê "Realizada"
  E vê "Para marcar como realizada, a nutricionista registra o atendimento ou marca a presença."
  Quando marco "Faltou"
  Então a consulta vira "Faltou" e nenhuma cobrança é criada

Cenário: Faltou com atendimento iniciado (RE-D62)
  Dado que a nutricionista iniciou o atendimento da consulta, que continua "Agendada"
  Quando a recepção marca "Faltou"
  Então vê "Esta consulta tem um atendimento registrado." e nada é gravado (o banco também recusa)

Cenário: Corrigir uma realizada
  Dado uma consulta "Realizada"
  Então a recepção não vê "Corrigir para Faltou"

Cenário: Consulta
  Quando abro uma consulta
  Então não vejo "Iniciar atendimento" nem a seção "Cobrança", com ou sem a permissão do Financeiro (RE-D61: a cobrança da consulta é da nutricionista; com a permissão, a recepção lança pelo Financeiro)
  E o link do cabeçalho é "Abrir cadastro" (para "/painel/cadastro/{id}"), não "Abrir prontuário"

Cenário: Cancelar (RE-D44)
  Quando cancelo uma consulta
  Então o formulário não tem o campo "Motivo do cancelamento"
  E a consulta cancelada, por mim ou pela nutricionista, não mostra o motivo para mim

Cenário: Bloqueios
  Então a grade mostra os bloqueios como "Bloqueado", sem o motivo, e a recepção não cria nem remove bloqueio

Cenário: Solicitações (Plano 23 na main, RE-D59)
  Então a recepção vê na fila "Solicitações" os pedidos de pacientes já cadastrados e aceita ou recusa como a nutricionista
  E os pedidos de pessoa nova não aparecem para ela; a fila diz "Pedidos de pessoas ainda sem cadastro ficam com a nutricionista."
```

#### US-493 — Financeiro com a permissão · **S** (PD-101)

```gherkin
Cenário: Com a permissão
  Dado a permissão do Financeiro ligada
  Então a recepção vê "Financeiro" no menu com Resumo, Lançamentos, Pagamentos pendentes e Relatórios
  E não vê "Configurações" do Financeiro
  E lança, recebe e cancela como a nutricionista, com o nome dela no Histórico de acessos

Cenário: Permissão tirada no meio do trabalho
  Dado que a nutricionista tirou a permissão
  Quando a recepção salva um lançamento já aberto
  Então vê, junto do botão, "Você não tem mais permissão para o Financeiro. Peça à nutricionista." (role="alert")
  E o formulário continua preenchido e nada é gravado (o banco recusa, RN-506)
```

#### US-494 — Relatórios para a recepção · **S** (PD-101)

```gherkin
Cenário: Seções
  Dado a recepção sem a permissão do Financeiro
  Então as abas dos Relatórios são "Pacientes" e "Agenda"
  E "Atendimentos", "Planos alimentares" e "Ranking" nunca aparecem (RE-D36)
  Dado a permissão ligada
  Então aparece também "Financeiro"
```

#### US-495 — O que a recepção fez · **S** (PD-101)

```gherkin
Cenário: Histórico de acessos
  Dado que a Carla abriu o cadastro e alterou o telefone de Ana
  Quando a nutricionista abre o Histórico de acessos de Ana
  Então vê "Visualizou — Cadastro do paciente — Carla Lima (recepção)" e "Alterou — Cadastro do paciente — Carla Lima (recepção)", com data, hora e IP

Cenário: Recepção não vê o Histórico
  Então "/painel/pacientes/{id}/historico" leva a recepção a "Sem permissão"
```

#### US-496 — Defesa em profundidade · **M** (PD-101)

```gherkin
Cenário: Tabela clínica pelo banco
  Dado uma sessão recepcao no withTenant
  Quando ela faz select em anthropometry, consultations, exams, meal_plans, signed_documents, ia_tarefas, diary_entries, patient_tags ou audit_log
  Então recebe 0 linhas
  E insert, update e delete nessas tabelas dão erro de RLS

Cenário: Tabela nova esquecida
  Dado um plano que cria uma tabela com tenant_id por app_enable_tenant_rls
  Então ela já nasce com recepcao_negada, e a guarda só aceita liberar com app_allow_recepcao e a entrada em RECEPCAO_LIBERADO

Cenário: Server Action fora da lista
  Quando a recepção posta direto na action de salvar antropometria
  Então recebe "Sem permissão" e nada é gravado

Cenário: Paciente escondido (RE-D40)
  Dado um paciente bloqueado
  Quando a sessão recepcao insere uma consulta, uma notificação ou um lançamento com o id dele, ou atualiza uma consulta dele
  Então o banco recusa (42501 ou 0 linhas), e o gatilho do Financeiro recusa o paciente não achado
```

---

## 6. Regras de negócio

### 6.1 Regras

| ID | Regra |
|---|---|
| RN-480 | **Quem vê cada seção dos Relatórios.** Nutricionista: todas. Recepção: Pacientes e Agenda; com a permissão do Financeiro, também Financeiro; **nunca** Atendimentos e Planos alimentares (contam registros do prontuário) nem o Ranking (lista nominal do uso de um serviço de saúde, RE-D36). `secoesPermitidas` decide as abas, a página, o CSV e a impressão (um lugar só); a recusa leva a "Sem permissão" (página, e o CSV aberto por navegação: redirect 303 para `/painel/sem-permissao?motivo=…`) ou 403 (pedido sem navegação) |
| RN-481 | **Período.** Meses inteiros no fuso do consultório; "De" e "Até" em `<select>` com os meses do mais antigo entre o primeiro cadastro do consultório e o mês atual − 11, até o mês atual (o padrão sempre existe na lista, RE-D48); no máximo 12 meses; "De" ≤ "Até" (o mesmo mês vale); mês futuro não é oferecido. Padrão: o mês atual e os 11 anteriores. URL `de=AAAA-MM&ate=AAAA-MM`. **Valor inválido:** a página mostra os números do **padrão**, os `<select>` ficam com o que veio na URL (quando o mês existe na lista), o erro da §6.2 fica junto do campo com `aria-invalid` + `aria-describedby`, a frase "Mostrando {mês de ano} a {mês de ano}." diz o período dos números e o foco vai para o aviso no carregamento (marcador na URL e foco, como a lista do Plano 18, `FocoNoTitulo`); `role="alert"` numa página renderizada no servidor não é anunciado e não é usado |
| RN-482 | **Local** (Fase B, com o Plano 23 na `main` e o consultório com mais de um local, contando arquivados). Pacientes: com consulta não cancelada nem `solicitada` no local no período. Atendimentos: só consultas realizadas no local (atendimento sem consulta fica fora, com a nota). Agenda: consultas do local. Financeiro: entradas com `appointment_id` de consulta do local (a regra da US-416 do 23); saídas mostram "—". Planos: não se aplica (filtro desligado, com a nota). Ranking: consultas ou entradas do local. Local arquivado aparece na lista com "(arquivado)". O `local` vai no `entidade_id` da exportação |
| RN-483 | **Universo dos pacientes.** Nunca entram anonimizados (`anonimizado_em` preenchido), salvo em "Novos pacientes por mês", que conta o cadastro pela data de criação (o número do passado não muda quando alguém é anonimizado). "Situação": Ativos (`ativo`), "Inativos (arquivados)" (`arquivado`), "Bloqueados por pedido de exclusão" (`bloqueado`). Sexo e fase da vida contam só os **ativos**. **Na sessão da recepção** (RE-D39) a RLS esconde bloqueados e anonimizados: a linha "Bloqueados por pedido de exclusão" não aparece, "Total" e "Novos pacientes por mês" contam só os visíveis e a nota da §6.2 diz isso; o teste compara as duas sessões no mesmo banco (iguais, menos bloqueados e anonimizados) |
| RN-484 | **Sexo.** `F` → "Feminino", `M` → "Masculino", nulo → "Não informado" (paciente do agendamento público ainda sem cadastro completo). Identidade de gênero e nome social (Plano 18) não entram (RE-D7) |
| RN-485 | **Fase da vida** (RE-D6). Idade em anos completos **hoje**, no fuso. Grupos: "Adultos (18 a 59 anos)" e "Pessoas idosas (60 anos ou mais)" (Estatuto da Pessoa Idosa, Lei 10.741/2003, art. 1º); faixas: "18 a 29", "30 a 39", "40 a 49", "50 a 59", "60 ou mais"; "Sem data de nascimento". Menor de 18 não existe no cadastro (RN-17 do MVP); se aparecer por dado antigo, vai em "Menos de 18" sem quebrar a tela |
| RN-486 | **Percentuais.** Uma casa decimal com vírgula; a soma pode dar 99,9% ou 100,1% pelo arredondamento (nota "Os percentuais são arredondados."); com total 0, "—" |
| RN-487 | **Novos pacientes por mês.** `patients.created_at` no mês, no fuso; inclui todas as origens (painel e agendamento público) e os anonimizados (RN-483) |
| RN-488 | **Atendimentos.** "Pacientes atendidos" no mês = pacientes distintos com consulta `realizada` (`appointments.inicio` no mês) **ou** atendimento registrado (`consultations.data` no mês). "Consultas realizadas" = consultas `realizada` no mês. "Atendimentos registrados" = linhas de `consultations` no mês. "Pacientes novos (primeiro atendimento)" = atendidos no mês cujo primeiro atendimento ou consulta realizada da vida é desse mês; os outros são "Pacientes em retorno" — a mesma regra da RN-416 do Plano 23, numa consulta agregada por paciente (`min`), nunca por item. Pacientes anonimizados contam (número agregado, sem identificação) |
| RN-489 | **Planos alimentares.** Só planos de paciente (`patient_id` preenchido, não modelo). "Publicações de plano" = linhas com `publicado_em` no mês (cada versão publicada conta). "Pacientes com plano publicado no mês" = distintos. Cartão "Pacientes ativos com plano publicado hoje" = ativos com algum plano `publicado`. Nenhuma coluna de conteúdo do plano é lida. Se o Plano 19 mudar a publicação, a regra é reescrita no rebase (§13) |
| RN-490 | **Agenda.** Por mês de `inicio`, no fuso: "Marcadas" = status fora de `cancelada` e `solicitada` (o mesmo "Consultas do mês" do Início); "Realizadas"; "Faltas"; "Taxa de faltas" = a conta de `indicadoresDaAgendaNaTransacao` (faltas ÷ não canceladas já iniciadas), no formato de `textoTaxa`; "Canceladas pelo paciente" (`cancelado_por = 'paciente'` e, com o 23, `pedido_desistido`); "Canceladas pelo consultório" (`cancelado_por = 'nutri'`); canceladas pelo `sistema` (exclusão LGPD) e os `pedido_recusado`/`pedido_vencido` do 23 não entram em coluna nenhuma; "Marcadas pelo paciente" (`origem = 'paciente'`, não canceladas); "Retornos" = marcadas de paciente que já tinha atendimento antes (RN-488). Com o 23: "Retornos previstos" (`consultations.retorno_previsto_em` no mês, do último atendimento com previsão de cada paciente) e "Previstos com consulta marcada" (o paciente tem consulta marcada entre a data da previsão menos 30 dias e o fim do mês). Para a recepção, "Retornos" e as previsões vêm pelas funções da RN-510 (só o selo de retorno por consulta visível e a previsão) |
| RN-491 | **Financeiro.** Só lançamentos **não cancelados** com `pago_em` no mês (RN-305/RN-306 do Plano 20: recebido ou pago conta pela data do pagamento): "Recebido" (entradas), "Pago" (saídas), "Resultado" = Recebido − Pago (com "−" quando negativo, RN-326 de lá); "Por categoria" = soma por categoria no período, entradas e saídas em blocos separados. Em aberto e previstos não entram (o Resumo do Financeiro mostra). Sem o Financeiro configurado, o estado vazio da US-484. Agregação por funções novas em `src/modules/financeiro/resumo.ts` (`recebidoEPagoPorMes`, `porCategoriaNoPeriodo` e, para o Ranking por receita, `receitaPorPaciente`; RE-D68), chamadas pelos Relatórios — nenhuma consulta a `fin_*` fora do módulo do Financeiro |
| RN-492 | **Ranking** (só da nutricionista, RE-D36). Até 20 pacientes, só `ativo` ou `arquivado` e não anonimizados. "Mais consultas" = consultas `realizada` no período (empate pelo nome exibido, sem diferença de acento e maiúsculas: `app_unaccent(lower(…))`, a função da 0040 sobre a extensão `unaccent` da 0000; RE-D68). "Maior receita" = soma das entradas recebidas no período, não canceladas, com paciente (empate pelo nome), por `receitaPorPaciente` do módulo do Financeiro (RN-491). Na tela, o **nome exibido** (nome social quando houver, RN-266 do Plano 18); no CSV e na impressão, o **nome de registro** (precedente do CSV do Plano 20). Cada nome é link para a ficha, `prefetch={false}`; no CSV e na impressão, a coluna se chama "Paciente (nome de registro)". Sem idade, e-mail, telefone ou qualquer outro dado |
| RN-493 | **O que é acesso a dado de saúde nos Relatórios** (RE-D4). (a) **Agregado** (contagem, soma ou percentual sem nome): a tela **não** chama `auditRead`; o CSV e a impressão gravam `recordAudit({ acao: 'exportar', entidade: 'relatorios', entidadeId: '{secao}\|{de}..{ate}\|{localId ou todos}', patientId: null })` na transação da leitura. (b) **Ranking** (lista nominal com número): a tela **não** chama `auditRead` (como a lista de pacientes, a agenda — P05 D10 — e os "Pagamentos pendentes" do Plano 20, RN-318); o CSV e a impressão gravam **uma** linha `exportar` por paciente da lista (entidade `relatorios`, `patientId`), que aparece no Histórico de acessos como "Exportou — Relatórios" (precedente da RN-321 do Plano 20). `ENTIDADE_ROTULO.relatorios = 'Relatórios'`. O render da impressão grava na transação da leitura; o link é `prefetch={false}` (RN-419 do Plano 23) |
| RN-494 | **CSV.** Separador `;`, UTF-8 com BOM, CRLF, datas `dd/mm/aaaa`, meses `mm/aaaa`, valores com vírgula decimal e sem "R$", percentuais com vírgula e sem "%"; célula de texto que comece com `=`, `+`, `-`, `@`, tabulação ou CR ganha `'` (RN-321 do Plano 20, mesma função). Nome `relatorio-{secao}-{AAAA-MM}-a-{AAAA-MM}.csv` (`relatorio-ranking-consultas-…` e `relatorio-ranking-receita-…`). Resposta `text/csv; charset=utf-8`, `Content-Disposition: attachment`, `Cache-Control: no-store`. Só `requireApiEquipe` + `podeVerSecao` (seção não permitida numa navegação → redirect 303 para `/painel/sem-permissao`, RN-480); período inválido → redirect 303 para a seção com `?erro=periodo`; sem sessão → login com a volta; DPA pendente → `/painel/dpa` (nutri) ou `/painel/contrato-pendente` (recepção) — **nunca** JSON numa navegação |
| RN-495 | **Impressão** (RE-D9). Página `/painel/relatorios/imprimir` sem menu (`print:hidden` no que é tela), com "Imprimir ou salvar em PDF" (o link que leva a ela, nos Relatórios, é "Ver versão para imprimir") e "Voltar aos relatórios" (`print:hidden`); cabeçalho com o nome do consultório, "Relatório de {seção}", "Período: {mês/ano} a {mês/ano}", "Local: {nome ou Todos}" e "Gerado em {dd/mm/aaaa} às {hh:mm}"; as mesmas tabelas da tela, sem barras; rodapé fixo da §6.2. `<title>` "Relatório de {seção} — {consultório}" (sem dado de paciente); `Cache-Control: no-store` (`next.config.ts`). Nada vai ao servidor como arquivo |
| RN-496 | **Desempenho.** Uma transação por seção, uma consulta agregada por tabela da seção, só com os índices de hoje (`appointments_inicio_idx`, `consultations_paciente_data_idx`, `meal_plans_paciente_idx`, `patients_tenant_status_idx`, índices de `fin_lancamentos` do Plano 20); `EXPLAIN` no plano e índice novo só se a CS-483 pedir (vai na migration do PR 2) |
| RN-497 | **Nada em log** (regra 3): números, nomes, valores, categorias e local nunca vão a log, Sentry ou mensagem de erro; erro loga só o código, a seção e o motivo técnico |
| RN-498 | **Papel `recepcao`.** `user.app_role = 'recepcao'` com `tenant_id` obrigatório (CHECK novo `user_recepcao_com_tenant`) e uma linha em `equipe_membros` (RN-502). No banco, `withTenant({ role: 'recepcao', actorUserId, ip })`: `assertContext` exige o ator e recusa `patientId` e `semConta`. A conta da recepção nunca é de paciente nem de nutricionista: o e-mail é único em `user` (RE-D34) |
| RN-499 | **Convite.** Só a sessão `nutri` (`convidarRecepcao`), na transação: trava o tenant (`pg_advisory_xact_lock(hashtext('equipe-tenant'), hashtext(tenantId))`), confere o limite de **3 ativas** (linhas de `equipe_membros` sem `desativada_em`), confere o e-mail em `user` (achou → a mensagem da US-488, sem dizer de quem; enumeração aceita, R-496), cria `user` (`app_role = 'recepcao'`, `tenant_id`, `email_verified = false`), a linha de `equipe_membros`, o convite (`invites.tipo = 'recepcao'` com `tenant_id`, 72 h, o mesmo `criarConvite`) e o e-mail `convite_recepcao`; grava `recordAudit({ acao: 'criar', entidade: 'equipe', entidadeId: membroId, patientId: null })`. "Reenviar convite" só sem senha criada, como `reenviarConvite` da nutricionista. Consultório suspenso não convida (RN-15). Nome: 3 a 80 caracteres. A reativação toma a mesma trava antes de contar (RN-503) |
| RN-500 | **Primeiro acesso e entrada.** `aceitarConvite` com convite `recepcao`: senha pela política de hoje, aceite **obrigatório** do termo de confidencialidade (`consents`: `user_id` da recepção, `tenant_id` do consultório, `termo_versao = 'sigilo-equipe-1.0'`, IP), sem DPA; o texto do termo aparece na própria página (`TextoLegalView`, como o DPA da nutricionista), e a página pública `/termos/sigilo-equipe` fica para consulta. Na entrada, `evaluateSession` devolve `setup-2fa` para a recepção sem 2FA (como o admin; RE-D20) e `forbidden` para a recepção desativada (RN-503) |
| RN-501 | **Sessão.** Os prazos da equipe (30 min sem uso, 8 h no máximo, aviso 2 min antes) valem para a recepção (`ehEquipe`); o aviso e a renovação pelo uso dependem de `/api/sessao/ativa`, que passa a aceitar a recepção (RE-D67). Consultório suspenso → `/indisponivel`. DPA do consultório numa versão antiga → `/painel/contrato-pendente` em toda tela (a recepção não aceita o DPA: quem aceita é a controladora; RE-D29) |
| RN-502 | **Permissão do Financeiro.** Coluna `equipe_membros.financeiro` (falso por padrão), mudada só pela nutricionista; vale na próxima requisição (o `requireEquipe` lê a linha a cada requisição, na mesma leitura da sessão, RN-504). No banco, a condição `recepcao_cond_financeiro` das tabelas `fin_*` chama `(SELECT app_recepcao_tem_financeiro())` (lê a própria linha ativa de `equipe_membros`; `SECURITY INVOKER`, `STABLE`, `SET search_path = public, pg_temp`; embrulhada em `SELECT` para o planejador avaliar uma vez por consulta, não por linha). Cada mudança grava `recordAudit({ acao: 'alterar', entidade: 'equipe', … })`. As **Configurações do Financeiro** continuam só da nutricionista |
| RN-503 | **Desativar e reativar.** Desativar grava `desativada_em` e `desativada_por`, apaga as sessões da conta e o convite pendente, na mesma transação; a linha nunca é apagada (DELETE revogado, RE-D28). A conta desativada recebe `forbidden` em toda tela, inclusive `/conta/seguranca` (página `/conta/acesso-desativado`, "Seu acesso a este consultório foi desativado. Fale com a nutricionista.", RE-D45) e o banco a trata como sem linha ativa (`app_recepcao_tem_financeiro()` falso; `recepcao_cond_propria_linha` só a própria). Reativar volta a linha sob a trava do tenant da RN-499, respeitando o limite de 3; o 2FA e a senha continuam. Os dois gravam `recordAudit` da entidade `equipe` |
| RN-504 | **Entrada no app** (RE-D16). `requireNutri` e `requireApiNutri` **não mudam**: continuam só `nutri`; a recepção que cai numa delas vai a `/painel/sem-permissao?motivo=nutri` (página) ou recebe 403 (API); `requireEquipe({ financeiro: true })` sem a permissão vai a `?motivo=financeiro`. Server Action do Financeiro chamada sem a permissão devolve o erro inline da §6.2 (`role="alert"`, perto do botão), sem redirect e sem perder o formulário (RE-D47). `requireEquipe(path, { secao?, financeiro? })` aceita `nutri` e `recepcao` ativa e devolve `{ papel, financeiro }`; só as rotas de `ROTAS_DA_RECEPCAO` (RN-513) a usam. Server Actions chamadas por essas páginas também usam `requireEquipe`, com a mesma exigência da página. A linha de `equipe_membros` é lida junto com o tenant, uma vez por requisição (`cache()` de `lerSessaoDaRequisicao`) |
| RN-505 | **Negação por padrão no banco** (RE-D15). Função `app_deny_recepcao(tbl)`: política `recepcao_negada` `AS RESTRICTIVE FOR ALL USING (app_current_role() IS DISTINCT FROM 'recepcao') WITH CHECK (…)`. `app_enable_tenant_rls` passa a chamá-la — o corpo novo é o **da 0070** (o último da `main` na regeneração: `tenant_isolation` + `app_deny_publico` + `app_deny_paciente_escrita`) mais `PERFORM app_deny_recepcao(tbl)` —, e um laço aplica-a às tabelas existentes do schema `public`. `app_allow_recepcao(tbl, cmds…)` troca a `recepcao_negada` por `recepcao_sem_<cmd>` nos comandos não liberados (molde de `app_allow_publico`, 0051). Lista `RECEPCAO_LIBERADO` (`src/db/rls-guard.ts`) com a matriz da §4.3 e a guarda `findRecepcaoViolations` (toda tabela com `tenant_id` fora de `RLS_EXCEPTIONS`: ou só `recepcao_negada`, ou exatamente as `recepcao_sem_*` dos comandos não liberados; nome, comando, RESTRICTIVE **e** a expressão, como a B-5 de `findPacienteEscritaViolations`). As condições da §4.3 se chamam `recepcao_cond_<assunto>`, são RESTRICTIVE com o comando declarado e ficam na lista `RECEPCAO_CONDICOES` com os trechos exigidos na expressão (molde de `AUDIENCIA_EXIGE`); a guarda recusa condição PERMISSIVE e nome `recepcao_*` fora dos três padrões. Teste da função: `app_enable_tenant_rls` numa tabela de rascunho cria `tenant_isolation`, `publico_negado`, os `paciente_sem_*` e `recepcao_negada` |
| RN-506 | **Financeiro no banco.** `recepcao_cond_financeiro` (RESTRICTIVE FOR ALL) em `fin_configuracoes`, `fin_categorias` e `fin_lancamentos`: `app_current_role() IS DISTINCT FROM 'recepcao' OR app_recepcao_tem_financeiro()`. Em `fin_lancamentos`, também `recepcao_cond_paciente_visivel` (`patient_id IS NULL OR EXISTS` do paciente, RE-D40). Comandos: select nas duas primeiras; select, insert e update em `fin_lancamentos` (DELETE continua revogado de todos). O gatilho `fin_lancamentos_regras` é refeito: o ramo "papel diferente de `nutri` → `RETURN NEW` (a RLS recusa)" passa a "papel fora de (`nutri`, `recepcao`)"; na recepção, **as mesmas regras da nutricionista** (lê o paciente `FOR KEY SHARE`; paciente não achado — escondido pela RLS dela — é 42501, falha fechada; recusa bloqueado e anonimizado no INSERT, só as colunas permitidas para bloqueado, `criado_por`/`cancelado_por` := `app_current_user()`). A cobrança automática da consulta realizada não acontece pela recepção (ela não marca "Realizada", RN-509). O módulo troca `exigirNutri(ctx)` (`erros.ts` do 20) por `exigirFinanceiro(ctx)` (nutri ou recepção; a permissão é decidida pelo banco e pelo `requireEquipe`), salvo `configuracoes.ts` e `cobranca.ts` (só nutri: a seção "Cobrança" da consulta e `cobranca-actions.ts` nunca chegam à recepção, RE-D61) e `titular.ts` (worker); `travarLancamento`, na sessão da recepção, trata o paciente não achado como lançamento não encontrado |
| RN-507 | **Notificações da agenda.** `TIPOS_DA_AGENDA` (`src/modules/notificacoes/tipos.ts`) = `lembrete_24h`, `lembrete_2h`, `consulta_marcada`, `consulta_cancelada`, `resposta_confirmacao`, `resposta_remarcar` e os tipos de pedido do Plano 23 de paciente cadastrado, decididos um a um na tarefa do banco (sem `convite_paciente`: a recepção não envia convite, RE-D37; tipo só de pedido de pessoa nova fica em `TIPOS_FORA_DA_RECEPCAO`, RE-D59). Condição `recepcao_cond_notificacoes_da_agenda` (RESTRICTIVE FOR ALL) em `notifications`: `app_current_role() IS DISTINCT FROM 'recepcao' OR tipo IN (…)`; teste que compara a lista da política com `TIPOS_DA_AGENDA` e com o CHECK `notifications_tipo_valido` (tipo novo de outro plano sem decisão → falha) |
| RN-508 | **Pacientes pela recepção.** Condição `recepcao_cond_paciente_visivel` em `patients` (RESTRICTIVE FOR ALL: `role IS DISTINCT FROM 'recepcao' OR (status <> 'bloqueado' AND anonimizado_em IS NULL)`) e, por `EXISTS` no paciente, em `patient_cadastro`, `appointments`, `notifications` e `fin_lancamentos` (RE-D40). Gatilho `patients_da_recepcao` (BEFORE INSERT OR UPDATE, só com o papel `recepcao`) por **lista branca** (`to_jsonb(NEW)` contra os padrões, RE-D41): no INSERT só valem `nome`, `data_nascimento`, `sexo`, `email`, `telefone_e164` e as colunas de sistema (`id`, `tenant_id`, `created_at`, `updated_at`), com `status = 'ativo'`, `origem = 'nutri'` e todo o resto no padrão (`user_id`, `bloqueado_em`, `anonimizar_apos`, `anonimizado_em`, IA, peso oculto, lembretes e WhatsApp nulos); no UPDATE só mudam `nome`, `data_nascimento`, `sexo`, `telefone_e164` e `updated_at` (**`email` fixo**, RE-D37); o resto → 42501. Gatilho `patient_cadastro_da_recepcao`: `observacao` e `identidade_genero` fixos no UPDATE e nulos no INSERT (RE-D38). O módulo: `criarPaciente` na sessão da recepção **não** envia convite (nem e-mail nem WhatsApp); `atualizarPaciente` recusa e-mail diferente (`MSG_RECEPCAO.emailSoNutri`) e não chama `autorizacaoWhatsapp` (as colunas de WhatsApp ficam como estão: sem isso, todo salvamento de paciente com opt-in de origem `nutri` daria 42501); `cadastroDoPaciente` tem a projeção da recepção sem `observacao` nem `identidade_genero` (teste das chaves); `listarPacientes` com o papel `recepcao` ignora `etiqueta` e `situacao=bloqueados`. Etiquetas (`patient_tags`, `patient_tag_links`) negadas (podem ser clínicas) |
| RN-509 | **Agenda pela recepção.** Pode: `agendarPelaNutri`, `moverConsulta`, cancelar (`cancelado_por = 'nutri'`, rotulado "pelo consultório", **sem** o campo de motivo, e a página da consulta não lê o motivo para ela — RE-D44; o autor está no `audit_log`, RE-D33), confirmar, registrar **"Faltou"** em consulta `agendada` ou `confirmada` já começada e sem atendimento ligado (RE-D62), a impressão e aceitar ou recusar os pedidos de pacientes já cadastrados do Plano 23 (consulta `solicitada`; os de pessoa nova ficam com a nutricionista, RE-D59). Não pode: "Realizada" (nem a correção de "Realizada" para "Faltou"), registrar atendimento, criar ou apagar horário e bloqueio, locais, aniversariantes. Gatilho `appointments_da_recepcao` (BEFORE INSERT OR UPDATE, só `recepcao`, lista branca, RE-D41): no **INSERT**, só `status = 'agendada'` (ou o estado de pedido que o gatilho do 23 decidir), `origem = 'nutri'`, e `presenca_em`, `cancelado_*`, `motivo_cancelamento` e `remarcada_de` nulos; no **UPDATE**, `patient_id`, `origem`, `remarcada_de` e `motivo_cancelamento` fixos, `cancelado_por` só `'nutri'` ou, saindo de `solicitada`, `'pedido_recusado'` (RE-D59), `status` novo `realizada` recusado, saída de `realizada` recusada e `faltou` só a partir de `agendada`/`confirmada` com `inicio <= clock_timestamp()` e `NOT app_consulta_tem_atendimento(OLD.id)` (RE-D62); o resto → 42501 (hoje `appointments` não tem gatilho nenhum). Com o 23, a custom refaz `app_appointments_regras_pedido` com o papel `recepcao` no aceite e na recusa (§4.4). As funções dos módulos passam de `ctx.role === 'nutri'` para `exigirEquipe(ctx)` só nas listadas aqui (lista fechada no teste de fonte); `lerBloqueios` devolve, para a recepção, os bloqueios **sem** `motivo` (projeção no módulo; teste das chaves). Na página da consulta, a recepção vê "Abrir cadastro" (`/painel/cadastro/{id}`) no lugar de "Abrir prontuário" e a página não chama `consultaParaIniciarAtendimento`, `motivoDoCancelamentoDaNutri` nem `cobrancaDaConsulta` para ela (RE-D61). `registrarPresenca`, na sessão da recepção, confere o atendimento ligado por `app_consulta_tem_atendimento` antes do UPDATE (a busca em `consultations` volta vazia para ela) |
| RN-510 | **Marcos de atendimento sem o prontuário** (RE-D27). `app_retorno_das_consultas(p_de date, p_ate date)` → `(appointment_id, retorno boolean)`: só consultas **visíveis** (paciente `ativo` ou `arquivado`, não anonimizado) com `inicio` no período, período de no máximo 13 meses; `retorno` = o paciente tinha consulta `realizada` ou atendimento (`consultations.data`) antes do `inicio` (a regra da RN-416 do 23). Com o 23, `app_previsoes_de_retorno(p_de date, p_ate date)` → `(patient_id, previsto_em date)`, só de pacientes visíveis e com previsão no período (máximo 13 meses). `SECURITY DEFINER` no molde da 0083 (guarda e restaura `app.role` e `app.patient_id`, troca para `worker`, filtra por `app_current_tenant()`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO nutri_app_role`), aceitando só `nutri` e `recepcao` com tenant (outro papel → vazio); devolvem **só ids, o booleano e a data da previsão**, nunca a primeira data da vida do paciente. Usadas pelo relatório da Agenda ("Retornos") e pelos selos "Primeira consulta"/"Retorno" e o marcador "Previsão de retorno" da agenda do 23, na sessão da recepção; a nutricionista continua lendo as tabelas. **Terceira peça** (RE-D62): `app_consulta_tem_atendimento(p_appointment uuid) → boolean`, mesmo molde e mesmos papéis aceitos, só de consulta do tenant com paciente visível; devolve só se existe linha de `consultations` com aquele `appointment_id`; chamada pelo gatilho `appointments_da_recepcao` e por `registrarPresenca` na sessão da recepção |
| RN-511 | **Funções que olham o papel.** `FUNCOES_COM_PAPEL` (`src/db/rls-guard.ts`) com a decisão por função (§4.4) e a guarda `findPapelEmFuncoesViolations` (função do schema `public` cujo `prosrc` cita `'nutri'`, `app_current_role` ou `current_setting('app.role'`, ou que é gatilho de tabela de `RECEPCAO_LIBERADO` e lê `patients`, e não está na lista → falha; controle positivo com uma função de rascunho). Revisão do `revisor-rls` obrigatória na tarefa |
| RN-512 | **Consultório.** `tenants` não tem RLS; o gatilho novo `tenants_so_nutri` (BEFORE UPDATE) recusa (42501) qualquer UPDATE com `app.role = 'recepcao'`. As telas de configuração já são `requireNutri` |
| RN-513 | **Rotas da recepção** (lista fechada `ROTAS_DA_RECEPCAO`, `src/app/painel/rotas-da-recepcao.ts`): `/painel`, `/painel/pacientes`, `/painel/pacientes/novo`, `/painel/cadastro/[id]` e `/painel/cadastro/[id]/consultas`, `/painel/agenda`, `/painel/agenda/nova`, `/painel/agenda/consultas/[id]`, `/painel/agenda/pendencias`, (23) `/painel/agenda/solicitacoes` e `/painel/agenda/imprimir`, `/painel/financeiro` e as telas do Plano 20 menos `configuracoes` (com `financeiro: true`), `/painel/relatorios/**`, `/painel/ajuda`, as actions `alternarTemaAction` e `marcarGuiaAction` de `src/app/painel/preferencias/actions.ts` (não há página; `escolherTemaAction` continua só `nutri`), `/painel/sem-permissao`, `/painel/contrato-pendente`; API: `/api/painel/relatorios/csv` e os dois CSV do Financeiro (com `financeiro: true`). Teste de fonte (por arquivo e, em todo arquivo com `'use server'` — `actions.ts` e os outros, como `cobranca-actions.ts` —, por action exportada): toda `page.tsx`/`route.ts`/arquivo de actions em `src/app/painel` e `src/app/api/painel` chama `requireNutri`/`requireApiNutri`, ou chama `requireEquipe`/`requireApiEquipe` **e** está na lista; e toda entrada **do painel** na lista chama `requireEquipe`. **Fora do painel** (RE-D67) não há `requireEquipe`: `/conta/seguranca`, `/conta/acesso-desativado`, `/inicio`, `/conta/outro-papel` e `/api/sessao/ativa` aceitam a recepção por `requireUser`/`lerSessaoApi` com o papel na lista; a guarda própria (`PAPEIS_FORA_DO_PAINEL`) exige, para todo `requireUser(`/`requireApiUser(`/`lerSessaoApi(` fora de `src/app/painel` e `src/app/api/painel`, a decisão explícita para `recepcao` (aceita ou recusa) |
| RN-514 | **Painel da recepção.** `layout.tsx` usa `requireEquipe` e, com a recepção, não chama `contarEnviosRecebidos` nem `contadorDeDuvidas`, e o `GuiaDoPainel` recebe o papel (o tour `boas-vindas` nunca abre para ela; abre o `recepcao-inicio`, RE-D42). Menu da §4.1. Início (`inicioDaRecepcao`, h1 "Seu dia, {nome}" como o da nutricionista): "Agenda de hoje" (`resumoDoDia`), "Presença a registrar ({n})" (só "Faltou" disponível), "O que os pacientes fizeram na agenda" (`novidadesDaAgenda`) e, com o 23, "Solicitações ({n})" (só os pedidos de paciente cadastrado, RE-D59); nada de indicadores de faltas, armazenamento, WhatsApp, IA, exames ou dúvidas. O Início dela é o trabalho do dia; os números do mês (inclusive a taxa de faltas) ficam em Relatórios › Agenda, que ela vê (RE-D63) |
| RN-515 | **Cadastro pela recepção** (RE-D23). `/painel/cadastro/[id]` (fora do layout do prontuário): cabeçalho com nome exibido e "Nome de registro" (como o Plano 18), idade, situação e acesso ao app; abas "Cadastro" (o formulário do Perfil do Plano 18 sem as partes da RN-508: sem etiquetas, WhatsApp, peso no app, IA, observação e identidade de gênero; o e-mail só para leitura, com "Para corrigir o e-mail, peça à nutricionista."; o acesso ao app como texto, sem "Enviar convite"; leitura por `cadastroDoPaciente` na projeção da recepção, com o `auditRead` de "Cadastro do paciente"; teste das chaves sem `observacao`, `identidade_genero`, `peso_oculto_no_app_em` nem colunas `ia_*`) e "Consultas" (as consultas do paciente, como a lista da agenda filtrada, sem `auditRead`, P05 D10) e o botão "Marcar consulta". A nutricionista que abre essa rota vai a `/painel/pacientes/[id]/perfil`. `/api/painel/pacientes/[id]` continua só `nutri` |
| RN-516 | **Auditoria da recepção.** As escritas da recepção entram no `audit_log` pelo gatilho com o ator dela; as leituras auditadas (cadastro, financeiro de um paciente, RN-318 do 20) gravam `auditRead` como as da nutricionista. O Histórico de acessos mostra o ator como "{nome} (recepção)" (`ROTULO_PAPEL`); a recepção nunca lê o `audit_log` (só INSERT). Ações da Equipe: entidade `equipe`, sem paciente, fora do Histórico do paciente (registro das operações, DPA cl. 12). "Último acesso" da tela Equipe = `user.ultimo_acesso_em` (coluna nova, gravada a cada login da conta `recepcao` pelo `databaseHooks.session.create.after` de `src/lib/auth.ts`; a sessão some no logout, na expiração e na desativação, então `session.updated_at` mostraria "Ainda não entrou" para quem já entrou — RE-D43), lida por `equipe.ts` (exceção da tabela `user`), ou "Ainda não entrou" |
| RN-517 | **O que a recepção nunca vê** (lista fechada, testada pela negação do banco, pelas rotas e pelos testes das chaves das projeções): a observação e a identidade de gênero do cadastro (RE-D38), anamnese e modelos, antropometria, gasto energético, atendimentos e notas privadas, exames e envios do paciente, planos alimentares e modelos, documentos assinados, receitas, pareceres, IA (tarefas, uso, autorizações, gerações) e IA Nutri, diário alimentar, conteúdos e audiência, etiquetas, lembretes de rotina, exportações e pedidos LGPD, Histórico de acessos, inscrições de push, eventos de acesso, conexão do WhatsApp, arquivos (`stored_files`, salvo a logo assinada que o cabeçalho já recebe pronta) e, quando existirem, as tabelas dos Planos 19, 21, 22 e 25 |
| RN-518 | **Avisos.** Os e-mails de aviso da agenda e do Financeiro continuam indo só à nutricionista (`aviso-nutri.ts` filtra `app_role = 'nutri'`); a recepção não recebe push nem e-mail de aviso na v1 (RE-D30). O e-mail `convite_recepcao` é o único novo |
| RN-519 | **Textos** em pt-BR, nas constantes `MSG_RELATORIOS`, `MSG_EQUIPE` e `MSG_RECEPCAO` (§6.2); entram numa tabela "Textos de interface e mensagens" própria no fim de `2026-09-27-nutridebby-mvp-historias.md`, no fechamento |

### 6.2 Textos de interface

| Onde | Texto |
|---|---|
| Menu | "Relatórios" |
| Abas | "Pacientes", "Atendimentos", "Planos alimentares", "Agenda", "Financeiro", "Ranking" |
| Filtros | "De", "Até", "Local", "Todos os locais", "Aplicar"; botões "Baixar CSV" e "Ver versão para imprimir" (na página de impressão: "Imprimir ou salvar em PDF"); "Mostrando {mês de ano} a {mês de ano}." |
| Erros do período | "O mês inicial não pode ser depois do final." · "Escolha um período de até 12 meses." · "Período inválido. Mostrando os últimos 12 meses." |
| Vazio | "Ainda não há dados neste período." |
| Pacientes | Títulos "Pacientes por situação", "Pacientes ativos por sexo", "Pacientes ativos por fase da vida", "Novos pacientes por mês"; linhas "Ativos", "Inativos (arquivados)", "Bloqueados por pedido de exclusão", "Total", "Feminino", "Masculino", "Não informado", "Adultos (18 a 59 anos)", "Pessoas idosas (60 anos ou mais)", "Sem data de nascimento", "Menos de 18"; notas "Pacientes anonimizados não entram nestes números." · "Os percentuais são arredondados." · "Pacientes com consulta neste local no período. Sem o filtro, a contagem é de todos os pacientes." · (recepção) "Pacientes bloqueados por pedido de exclusão e anonimizados não entram nos números da recepção." |
| Atendimentos | Colunas "Mês", "Pacientes atendidos", "Pacientes novos (primeiro atendimento)", "Pacientes em retorno", "Consultas realizadas", "Atendimentos registrados"; notas "Cada paciente conta uma vez por mês." · "Retorno: o paciente já tinha consulta realizada ou atendimento antes do mês." · "Atendimentos registrados sem consulta marcada não têm local e ficam fora deste filtro." |
| Planos | Colunas "Mês", "Publicações de plano", "Pacientes com plano publicado no mês"; cartão "Pacientes ativos com plano publicado hoje: {n} de {total}"; nota "Cada publicação conta, inclusive uma nova versão do mesmo plano. Modelos não entram." · "O filtro de local não se aplica aos planos alimentares." |
| Agenda | Colunas "Mês", "Marcadas", "Realizadas", "Faltas", "Taxa de faltas", "Canceladas pelo paciente", "Canceladas pelo consultório", "Marcadas pelo paciente", "Retornos" (23: "Retornos previstos", "Previstos com consulta marcada"); nota "Taxa de faltas: faltas sobre as consultas não canceladas que já começaram, como no Início." |
| Financeiro | Colunas "Mês", "Recebido", "Pago", "Resultado"; título "Por categoria"; link "Fluxo de caixa do ano e CSV dos lançamentos"; "O Financeiro ainda não foi configurado." + "Configurar o Financeiro" (nutricionista) ou + "Peça à nutricionista para configurar o Financeiro." (recepção); "Saídas não têm local." |
| Ranking (só nutricionista) | Escolha "Mais consultas" / "Maior receita"; títulos "Pacientes com mais consultas realizadas", "Pacientes com maior receita recebida"; colunas "Posição", "Paciente", "Consultas" / "Recebido" (no CSV e na impressão, "Paciente (nome de registro)"); aviso "Lista com nomes de pacientes. Ao exportar, cada paciente da lista registra 'Exportou — Relatórios' no Histórico de acessos." |
| Impressão | "Relatório de {seção}" · "Período: {mm/aaaa} a {mm/aaaa}" · "Local: {nome}" / "Local: Todos" · "Gerado em {dd/mm/aaaa} às {hh:mm}" · rodapé "Documento interno do consultório, com dados de pacientes. Guarde com sigilo." · "Voltar aos relatórios" · `<title>` "Relatório de {seção} — {consultório}" |
| Equipe | h1 "Equipe"; "Convidar recepcionista"; dica do formulário "Convide só quem trabalha para você no consultório. A pessoa vai aceitar um termo de confidencialidade."; campos "Nome", "E-mail", "Permitir acesso ao Controle Financeiro" (dica: "Lançamentos, pagamentos pendentes e relatórios financeiros. As configurações do Financeiro continuam só suas."); botão "Enviar convite"; situação "Convite enviado (vale até {dd/mm/aaaa} às {hh:mm})", "Convite vencido", "Ativo", "Acesso desativado em {dd/mm/aaaa}"; "Último acesso: {dd/mm/aaaa} às {hh:mm}" / "Ainda não entrou"; ações "Reenviar convite", "Salvar permissão", "Desativar", "Reativar" (com `aria-label` "… {nome}"); avisos "Convite enviado.", "Convite reenviado.", "Permissão atualizada.", "Acesso desativado.", "Acesso reativado."; limite "O consultório pode ter até 3 pessoas ativas na recepção."; explicação no topo: "A recepção cuida da agenda e do cadastro dos pacientes. Ela não vê anamnese, medidas, exames, planos, documentos, notas do atendimento, a observação do cadastro nem nada da IA. Tudo o que ela cadastra ou altera, e cada cadastro que ela abre, fica no Histórico de acessos do paciente." |
| Erros da Equipe | "Informe o nome (3 a 80 caracteres)" · "Informe um e-mail válido" · "Este e-mail já tem uma conta no NutriDebby. Use outro e-mail para a recepção." · "A senha já foi criada. Se a pessoa esqueceu, use \"Esqueci minha senha\"." · "Conta suspensa: não é possível convidar agora." · "O consultório pode ter até 3 pessoas ativas na recepção." |
| Confirmar desativar (`ConfirmarBotao`) | "Desativar {nome}? A pessoa sai do NutriDebby agora e não entra mais. O que foi feito com esta conta continua no Histórico de acessos dos pacientes." |
| Confirmar reativar | "Reativar {nome}? A pessoa volta a entrar com a mesma senha e a mesma verificação em duas etapas." |
| E-mail `convite_recepcao` | Assunto "Convite para a equipe de {consultório} no NutriDebby"; corpo "Olá, {nome}. {nome da nutricionista} convidou você para a equipe de recepção de {consultório} no NutriDebby. Crie sua senha pelo link abaixo em até 72 horas." + botão "Criar minha senha" + "Se você não esperava este convite, ignore este e-mail." |
| Convite (página) | h1 "Criar sua senha"; "Você recebeu um convite para a equipe de {consultório}."; o texto do termo na página (`TextoLegalView`); caixa "Li e aceito o Termo de confidencialidade da equipe"; erro "Para entrar na equipe, aceite o termo de confidencialidade." (classe `text-erro`, ligado à caixa por `aria-describedby`) |
| 2FA obrigatório | "A recepção precisa da verificação em duas etapas. Configure agora para continuar." |
| Sem permissão | h1 "Sem permissão"; com `?motivo=nutri`: "Esta página é só da nutricionista."; com `?motivo=financeiro`: "Você não tem permissão para o Financeiro. Peça à nutricionista."; + "Voltar ao início". Erro inline nas actions do Financeiro: "Você não tem mais permissão para o Financeiro. Peça à nutricionista." |
| Acesso desativado (`/conta/acesso-desativado`) | h1 "Acesso desativado"; "Seu acesso a este consultório foi desativado. Fale com a nutricionista." + "Sair" |
| Contrato pendente | h1 "Contrato do consultório pendente"; "O contrato de tratamento de dados do consultório precisa ser aceito pela nutricionista. Peça para ela entrar no NutriDebby." + "Sair" |
| Menu da conta | "{nome} · Recepção" |
| Presença (recepção) | "Para marcar como realizada, a nutricionista registra o atendimento ou marca a presença." |
| Observação (aviso do campo) | Sem mudança: o aviso do Plano 18, só na versão da nutricionista (a recepção não vê o campo, RE-D38) |
| Histórico de acessos | ator "{nome} (recepção)"; entidade `relatorios` "Relatórios" |
| Cadastro (recepção) | abas "Cadastro", "Consultas"; botão "Marcar consulta"; "Paciente não encontrado."; e-mail só para leitura, com "Para corrigir o e-mail, peça à nutricionista."; acesso ao app "A nutricionista envia o convite do app." |
| Enviar convite do app (nutricionista, ficha "No app") | confirmação "O convite vai para {e-mail}. Confira o e-mail antes de enviar." (RE-D37) |
| Outros envios de link ao paciente (nutricionista) | assinatura com entrega por link, "Reenviar link por e-mail" e "Enviar pedido de autorização por e-mail": "O link vai para {e-mail}. Confira o e-mail antes de enviar." (RE-D60) |
| Solicitações (recepção) | "Pedidos de pessoas ainda sem cadastro ficam com a nutricionista." (RE-D59) |
| Recepção (`MSG_RECEPCAO`) | `emailSoNutri`: "Para corrigir o e-mail, peça à nutricionista."; `pedidosPessoaNova`: o texto das Solicitações acima |
| Manual guiado | guia `relatorios` (v1 no PR 1, só nutri: `filtro-periodo` "Escolha até 12 meses."; v2 no PR 3, nutri e recepção, com o local): `abas-relatorios` "Cada aba mostra um assunto. Os números são do consultório inteiro, sem abrir nenhum prontuário." · `filtro-periodo` (v2) "Escolha até 12 meses. Com mais de um local, filtre por local." · `exportar` "Baixe em CSV para planilha ou imprima e salve em PDF."; guia `equipe` (v1, nutri; `padrao` próprio, antes do `configuracoes` na lista): `convidar` "Convide a pessoa da recepção. Ela cuida da agenda e do cadastro e não vê dados de saúde." · `permissao-financeiro` "Marque se ela também cuida do Financeiro."; guias da recepção (v1, `papeis: ['recepcao']`): `recepcao-inicio` (tour em `/painel`, com alvos que existem no Início dela: `agenda-hoje`, `presenca`, menu), `recepcao-pacientes`, `recepcao-cadastro` (`padrao` cobre `/painel/cadastro/[id]` e `/painel/cadastro/[id]/consultas`), `recepcao-agenda` e `recepcao-financeiro` (sem "Configurações", "Realizada", "Iniciar atendimento", "Ver bloqueados", Etiqueta e Arquivar), com os textos do plano; `SEM_AJUDA`: `/painel/sem-permissao`, `/painel/contrato-pendente` e `/painel/relatorios/imprimir`, com o motivo |

---

## 7. Telas

### 7.1 Relatórios (`/painel/relatorios`, 1280 px)

```
Relatórios
[Pacientes] [Atendimentos] [Planos alimentares] [Agenda] [Financeiro] [Ranking]
De [dez/2025 ▾]  Até [nov/2026 ▾]  Local [Todos os locais ▾]  [Aplicar]

Pacientes                                   [Baixar CSV] [Ver versão para imprimir]
Pacientes por situação            Pacientes ativos por sexo       Pacientes ativos por fase da vida
Ativos                    40      Feminino     31   77,5%         Adultos (18 a 59 anos)        33  82,5%
Inativos (arquivados)      8      Masculino     9   22,5%         Pessoas idosas (60 anos ou mais) 7  17,5%
Bloqueados por pedido...   2      Não informado 0   0,0%            18 a 29 · 30 a 39 · …
Total                     50
Pacientes anonimizados não entram nestes números.

Novos pacientes por mês
Mês      dez/25 jan/26 … nov/26  Total
Novos       3      5   …    4      52
```

- No celular (360 px): as tabelas viram uma coluna; a tabela por mês fica num contêiner com rolagem horizontal própria,
  focável (`role="region"`, `aria-labelledby` no `caption`, `tabIndex={0}`), como o fluxo de caixa do Plano 20.
- Barras (Agenda, Financeiro): `aria-hidden="true"`, com a tabela como alternativa em texto; cor nunca é o único sinal;
  classes de token (`bg-marca` e afins), nunca cor literal (nem `fill="#…"` em SVG, que o `cores.test.ts` não pega);
  `print:hidden`. A tabela larga usa `focus-visible:outline-offset-[-3px]` (exigido por `cores.test.ts`).

### 7.2 Equipe (`/painel/configuracoes/equipe`)

```
Equipe
A recepção cuida da agenda e do cadastro dos pacientes. Ela não vê anamnese, medidas, exames, planos, documentos, ...

[Convidar recepcionista]
Nome            E-mail          Situação                         Financeiro   Último acesso          Ações
Carla Lima      carla@ex.com    Ativa                            [x]          17/11/2026 às 09:12    [Salvar permissão] [Desativar]
Dora Reis       dora@ex.com     Convite enviado (vale até …)     [ ]          Ainda não entrou       [Reenviar convite] [Desativar]
```

- Cartão "Equipe" no **fim** de `CARTOES` do hub `/painel/configuracoes` (só acrescentar, como o 19 e o 23).
- O formulário "Convidar recepcionista" abre na própria página (`<details>`), com foco no campo "Nome"; fica **aberto**
  quando a action volta com erro, e cada erro fica ligado ao campo por `aria-describedby`.
- A tabela (6 colunas, dois botões por linha) fica num contêiner rolável com região focável (`role="region"`,
  `aria-labelledby`, `tabIndex={0}`), como a lista de pacientes do Plano 18.
- Confirmações por `?ok=…` com marcador e foco no título ou na região de aviso (padrão `r` + `FocoNoTitulo` do Plano 18;
  a região montada antes do texto não anuncia o que chega renderizado). Depois de "Desativar", o foco vai para a linha da
  pessoa; quando o botão "Convidar" some no limite, para o aviso do limite.

### 7.3 Cadastro da recepção (`/painel/cadastro/[id]`)

```
Ana Souza                                                        [Marcar consulta]
35 anos · Ativa · Acesso ao app: ativo
[Cadastro] [Consultas]
(formulário do Perfil do Plano 18 sem etiquetas, WhatsApp, peso no app, IA, observação e identidade de gênero;
 e-mail só para leitura; "A nutricionista envia o convite do app.")
```

### 7.4 Início da recepção (`/painel`)

```
Seu dia, Carla
Agenda de hoje (6)                         Presença a registrar (2)      Solicitações (1)   (23)
09:00 Ana Souza · Confirmada               [Ver]                          [Responder]
...
O que os pacientes fizeram na agenda
```

---

## 8. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-480 | Desempenho | CS-483: cada seção em uma transação, agregação no SQL, sem N+1; o Ranking com `limit 20` no SQL; cenário "relatórios" na pilha de carga (app com 2 vCPU); `requireEquipe` com **uma** leitura a mais por requisição (a linha de `equipe_membros`), no mesmo `cache()` da sessão |
| RNF-481 | Acessibilidade | WCAG 2.1 AA: axe sem violação nos Relatórios (as seções e a impressão), Equipe, convite (com o termo), `/termos/sigilo-equipe`, cadastro da recepção, Início da recepção, "Sem permissão" (os dois textos), "Contrato pendente" e "Acesso desativado", em 1280 e 360 px, claro e escuro — **com a conta da recepção** nas telas dela (laço próprio no `acessibilidade-painel.spec.ts` com `E2E_RECEPCAO`: o axe da nutricionista só veria o redirect); tabelas com `caption` e `th scope`, as largas num contêiner `role="region"` focável (`tabIndex={0}`, `focus-visible:outline-offset-[-3px]`); abas e escolha do Ranking com `aria-current`; erros do período com `aria-invalid` + `aria-describedby` e foco no aviso (RN-481); confirmações da Equipe por marcador + foco (§7.2); `<details>` do convite aberto no erro; barras com classes de token; alvos ≥ 44 px |
| RNF-482 | Privacidade em log | Nada de número de relatório, nome, e-mail da equipe, valor ou local em log ou Sentry (RN-497); o convite loga só ids; teste que captura o log de um CSV com erro e de um convite recusado |
| RNF-483 | Segurança | 2FA obrigatório da recepção; prazos de sessão da equipe; desativação revoga as sessões na mesma transação; o termo de confidencialidade é pré-condição do primeiro acesso; o token do convite é o de hoje (hash, 72 h, uso único) |
| RNF-484 | Testes | (a) unitários de `periodo.ts`, `acesso.ts`, `csv.ts` e das faixas etárias; (b) integração dos Relatórios com Testcontainers num cenário fixo (números esperados por seção, o mês atual igual ao Início e ao Resumo — CS-482 —, anonimizado, bloqueado, `sistema`, `solicitada`); (c) auditoria: agregado sem `auditRead`, exportação com uma linha sem paciente, Ranking com uma linha por paciente; (d) **banco da recepção**: `findRecepcaoViolations`, `findPapelEmFuncoesViolations`, `test/isolamento.test.ts` com a sessão `recepcao` em todas as `FABRICAS` (fora da lista: 0 linhas e erro de RLS em insert/update/delete; na lista: só os comandos liberados), políticas condicionais (financeiro ligado e desligado, notificação clínica, paciente bloqueado), gatilhos (`patients_da_recepcao`, `appointments_da_recepcao`, `tenants_so_nutri`, `fin_lancamentos_regras` com bloqueado), funções da RN-510 (só datas e booleanos, recusa de outro papel, inclusive `app_consulta_tem_atendimento`), `app_appointments_regras_pedido` com a recepção (aceite e recusa de pedido de paciente cadastrado; pessoa nova negada); (e) **rotas**: teste de fonte da RN-513 (painel e fora dele, RE-D67) e E2E com a conta da recepção percorrendo `e2e/painel-rotas.ts`; **leituras negadas** (R-482): nos testes de cada página de `ROTAS_DA_RECEPCAO`, espião que falha se, na sessão da recepção, a página chamar um módulo da lista `LEITURAS_NEGADAS` (etiquetas, conexão do WhatsApp, prontuário, contadores clínicos, cobrança, `consultaParaIniciarAtendimento`, `motivoDoCancelamentoDaNutri`) ou `auditRead` fora da entidade do cadastro; no E2E, depois do percurso da recepção, o `audit_log` não tem `ler` com o ator dela fora dessa entidade; (f) convite, aceite com termo, 2FA obrigatório, desativação com sessão aberta; (g) E2E: Relatórios (filtro, CSV, impressão), Equipe, primeiro acesso, a recepção marcando consulta e cadastrando paciente e clicando os links da página da consulta e da lista; (h) **projeções da recepção**: teste das chaves de `cadastroDoPaciente`, `listarPacientes`, `lerBloqueios`, da página da consulta e dos pedidos de paciente cadastrado do 23 (sem `observacao`, `identidade_genero`, `peso_oculto_no_app_em`, colunas `ia_*`, `motivo`, `motivo_cancelamento`); `public_booking_requests` é negada pelo banco (RE-D59); (i) **sessão restrita**: o relatório Pacientes da recepção = o da nutricionista menos bloqueados e anonimizados, no mesmo banco; (j) `app_enable_tenant_rls` numa tabela de rascunho (RN-505) |
| RNF-485 | Manutenção | `RECEPCAO_LIBERADO`, `RECEPCAO_CONDICOES`, `FUNCOES_COM_PAPEL` e `ROTAS_DA_RECEPCAO` são as quatro listas que um plano novo pode precisar tocar; o CLAUDE.md (regra 2) diz quando |
| RNF-486 | Compatibilidade | A imagem anterior ao PR 2 continua de pé com o banco novo: o papel `recepcao` não existe nela, as políticas novas só pegam esse papel e o CHECK de `user` só ganha um valor |

---

## 9. Modelo de dados

O **PR 1** (Relatórios) não tem migration. O **PR 2** tem uma migration **gerada** (`pnpm db:generate`) e uma
**custom** `rls_recepcao` (`pnpm drizzle-kit generate --custom --name rls_recepcao`), com `DATABASE_URL_MIGRATOR`
(regra 7). Números: os que o `db:generate` der sobre a `main` do momento, nenhum reservado (`sessoes-paralelas.md` §5;
a última da `main` hoje é a 0125, e os Planos 19, 20, 21, 22, 23 e 25 vão criar outras antes).

### 9.1 `equipe_membros` (nova, sem `patient_id`)

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid not null FK `tenants` | fixo |
| `user_id` | uuid not null FK `user` **NO ACTION**, único | fixo |
| `papel` | text not null | CHECK `in ('recepcao')`; fixo (lista pronta para papéis futuros) |
| `financeiro` | boolean not null default false | RN-502 |
| `convidada_por` | uuid not null | `app_current_user()` pelo gatilho; fixo |
| `desativada_em` | timestamptz null | RN-503 |
| `desativada_por` | uuid null | CHECK `(desativada_em is null) = (desativada_por is null)` |
| `created_at`, `updated_at` | timestamptz | |

- Índice `(tenant_id) where desativada_em is null` (contagem do limite).
- **RLS:** `app_enable_tenant_rls('equipe_membros')` (que já nega `publico` e, depois desta migration, `recepcao`) +
  `app_enable_staff_only('equipe_membros')` (nega `paciente`) + entrada em `STAFF_ONLY`; `app_allow_recepcao('equipe_membros',
  'select')` + `recepcao_cond_propria_linha` (RESTRICTIVE FOR SELECT: `app_current_role() IS DISTINCT FROM 'recepcao' OR
  user_id = app_current_user()`). `REVOKE DELETE, TRUNCATE … FROM nutri_app_role` (RE-D28).
- **Gatilho `equipe_membros_regras`** (BEFORE INSERT OR UPDATE, `SET search_path = public, pg_temp`): na sessão `nutri`,
  no INSERT `convidada_por := app_current_user()`, `desativada_*` nulos, e confere que o `user` tem `app_role = 'recepcao'`
  e `tenant_id = NEW.tenant_id` (senão 42501); no UPDATE `id`, `tenant_id`, `user_id`, `papel`, `convidada_por`,
  `created_at` fixos; desativar grava `desativada_por := app_current_user()`. Na sessão `recepcao`, qualquer escrita →
  42501 (ela só lê a própria linha). Os outros papéis (`paciente`, `publico`, `conta`) recebem `RETURN NEW` e a RLS
  recusa (molde da 0123: assim o `violaRlsDe` do teste de isolamento vê a recusa da política, `test/isolamento.test.ts:379`);
  o `worker` e o contexto vazio → 42501 (o `worker` não grava). A reativação conta as ativas sob a trava do tenant
  (RN-499, RN-503).
- Sem auditoria por gatilho (sem `patient_id`; não precisa de `AUDIT_EXCEPTIONS`): o módulo grava `recordAudit` da
  entidade `equipe` (RN-499, RN-502, RN-503).
- `test/isolamento.test.ts`: `FABRICAS` (a fábrica cria o `user` de recepção **no mesmo comando**, num CTE: `user_id` é
  UNIQUE e a fábrica é chamada várias vezes por tenant; `user` não tem RLS e não entra em `COM_MAE`), `SEM_DELETE`,
  `DELETE_REVOGADO`, `IMUTAVEIS`.

### 9.2 Tabelas existentes

| Tabela | Mudança |
|---|---|
| `user` | CHECK `user_app_role_valido` com `'recepcao'` (DROP/ADD da gerada); CHECK novo `user_recepcao_com_tenant`: `app_role <> 'recepcao' or tenant_id is not null`; coluna nova `ultimo_acesso_em timestamptz null` (RN-516, RE-D43) |
| `invites` | CHECK `invites_tipo_valido` com `'recepcao'`; `invites_alvo`: `(tipo = 'nutri' and user_id is not null and patient_id is null) or (tipo = 'recepcao' and user_id is not null and patient_id is null and tenant_id is not null) or (tipo = 'paciente' and …)` (o resto como na `main`) |
| `admin_actions` | nada: `alvo_papel` é texto livre (o reinício do 2FA da recepção grava `recepcao`) |
| `consents` | nada: termo `sigilo-equipe-1.0` com `user_id` e `tenant_id` (o termo diz o que é, como o aditivo de IA) |
| `tenants` | gatilho `tenants_so_nutri` (RN-512) |
| `patients`, `patient_cadastro` | condição `recepcao_cond_paciente_visivel` nas duas; gatilhos `patients_da_recepcao` e `patient_cadastro_da_recepcao` (RN-508); nenhuma coluna |
| `appointments` | `recepcao_cond_paciente_visivel`; gatilho `appointments_da_recepcao` (BEFORE INSERT OR UPDATE, RN-509) — hoje a tabela não tem gatilho nenhum; com o 23, roda antes de `appointments_link_da_sala` e `appointments_regras_pedido` (ordem alfabética); `CREATE OR REPLACE` de `app_appointments_regras_pedido` com a recepção no aceite e na recusa (corpo da `main` do momento, RE-D59); nenhuma coluna |
| `notifications` | `recepcao_cond_notificacoes_da_agenda` + `recepcao_cond_paciente_visivel` (RN-507) |
| `fin_*` | `recepcao_cond_financeiro` (`(SELECT app_recepcao_tem_financeiro())`); em `fin_lancamentos`, também `recepcao_cond_paciente_visivel` (`patient_id IS NULL OR EXISTS …`); `fin_lancamentos_regras` refeito com `CREATE OR REPLACE` (corpo copiado da `main` na regeneração, com o `NOT FOUND` da recepção, RN-506) |
| `public_booking_requests` (23) | nada: fica com `recepcao_negada` (RE-D59) |
| todas as outras com `tenant_id` | `recepcao_negada` (laço) |

### 9.3 Migration custom `rls_recepcao` (ordem)

```sql
-- 1. Negação por padrão
CREATE OR REPLACE FUNCTION app_deny_recepcao(tbl regclass) …;        -- recepcao_negada
CREATE OR REPLACE FUNCTION app_allow_recepcao(tbl regclass, VARIADIC cmds text[]) …;  -- recepcao_sem_<cmd>
CREATE OR REPLACE FUNCTION app_enable_tenant_rls(tbl regclass) …;    -- corpo da 0070 (o último da main) + PERFORM app_deny_recepcao(tbl)
-- lock_timeout de 10 s vem da conexão do migrador (src/db/migrate.ts, RE-D64): cobre também a migration gerada (CHECK e
-- coluna nova em "user") e os blocos 3 a 5 (gatilho em tenants); estourou, volta tudo e o boot tenta de novo
DO $$ … FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tenant_isolation' LOOP
        PERFORM app_deny_recepcao(format('public.%I', t)::regclass); END LOOP; $$;
-- 2. Tabela nova
SELECT app_enable_tenant_rls('equipe_membros'); SELECT app_enable_staff_only('equipe_membros');
REVOKE DELETE, TRUNCATE ON equipe_membros FROM nutri_app_role;
-- 3. Liberações (§4.3) e condições
SELECT app_allow_recepcao('patients', 'select', 'insert', 'update'); …
CREATE FUNCTION app_recepcao_tem_financeiro() RETURNS boolean STABLE …;
CREATE POLICY recepcao_cond_financeiro ON fin_lancamentos AS RESTRICTIVE FOR ALL …; …
-- 3b. Condições: recepcao_cond_paciente_visivel (patients, patient_cadastro, appointments, notifications, fin_lancamentos),
--     recepcao_cond_notificacoes_da_agenda, recepcao_cond_propria_linha
-- 4. Gatilhos: equipe_membros_regras, patients_da_recepcao, patient_cadastro_da_recepcao, appointments_da_recepcao,
--    tenants_so_nutri; CREATE OR REPLACE das funções de fin_lancamentos_regras e (23) app_appointments_regras_pedido
-- 5. Funções da RN-510 (molde 0083): app_retorno_das_consultas, app_consulta_tem_atendimento e (23) app_previsoes_de_retorno
```

### 9.4 Guardas e listas (só acrescentar, §6 de `sessoes-paralelas.md`)

- `rls-guard.ts`: `STAFF_ONLY` + `equipe_membros`; novos `RECEPCAO_LIBERADO`, `RECEPCAO_CONDICOES`,
  `FUNCOES_COM_PAPEL` e as guardas `findRecepcaoViolations` e `findPapelEmFuncoesViolations` (chamadas em
  `rls-guard.test.ts`; `findStaleExceptions` cobre as listas novas).
- `test/isolamento.test.ts`: a sessão `recepcao` em todos os casos; `FABRICAS`, `SEM_DELETE`, `DELETE_REVOGADO`,
  `IMUTAVEIS` + `equipe_membros`.
- `src/db/tenant.ts`: `TenantRole` + `recepcao` (a guarda `sem-conta-guarda.test.ts` não muda).
- `src/app/painel/cabecalho.test.ts` (guarda "cada página chama `requireNutri`"): passa a aceitar `requireEquipe` só
  para as rotas de `ROTAS_DA_RECEPCAO`.
- `CLAUDE.md`: **regra 1** — `src/modules/plataforma/equipe.ts` na lista da tabela `user` (conta da recepção, último
  acesso em `user.ultimo_acesso_em`, gravado no login por `src/lib/auth.ts`, que entra na lista; o comentário de contrato de `preferencias.ts` passa a citar a recepção), das tabelas `invites` (convite `recepcao`) e `consents` (termo `sigilo-equipe-<versão>`,
  também por `convites.ts`); **regra 2** — frase "Plano 26": `app_enable_tenant_rls` também nega a sessão `recepcao`
  (`recepcao_negada`); tabela que a recepção precisa ganha `app_allow_recepcao` + `RECEPCAO_LIBERADO` (condição extra em
  `RECEPCAO_CONDICOES`); função ou gatilho que decide pelo papel entra em `FUNCOES_COM_PAPEL`; as funções da RN-510 com
  a troca de papel para `worker`, molde 0083 (inclusive `app_consulta_tem_atendimento`, RE-D62); **regra 8** — "Relatórios: agregado sem `auditRead`; CSV e impressão =
  `exportar` da entidade `relatorios` sem paciente, e uma linha por paciente no Ranking; o Ranking na tela não chama
  `auditRead` (como a lista de pacientes); a sessão `recepcao` grava e lê auditado como a nutricionista, com o ator".

---

## 10. Normas profissionais e LGPD (o essencial)

Nada aqui é parecer jurídico. As perguntas abertas estão na §15 (★) e não travam a v1.

| Tema | Tratamento |
|---|---|
| Sigilo e auxiliares (CFN) | A Res. CFN 599/2018 (Código de Ética, vigente até 22/01/2027), art. 20, I, manda o nutricionista "Impedir o manuseio de quaisquer documentos sujeitos ao sigilo profissional por pessoas não obrigadas ao mesmo compromisso" e prevê o fornecimento de informações "mediante assinatura de termo de sigilo ou confidencialidade pelo solicitante". Por isso a recepcionista só entra depois de aceitar o termo de confidencialidade (RE-D21) e vê só o necessário para agenda e cadastro. A partir de 23/01/2027 (Res. CFN 856/2026; vigência pela Res. CFN 858/2026, prorrogação a conferir no DOU), a base passa a ser o art. 23 (sigilo, privacidade e segurança), o art. 36 (medidas técnicas e organizacionais e minimização) e o art. 66 (delegação de funções privativas). O novo Código não repete o termo de sigilo do art. 20, I: o termo continua como medida organizacional (art. 36). Texto lido em compilação não oficial (LegisWeb): reconferir no DOU antes do merge |
| Funções privativas (CFN) | Art. 52 da Res. 599/2018 (art. 66 da Res. 856/2026 a partir de 23/01/2027) veda "delegar suas funções e responsabilidades privativas a pessoas não habilitadas": a recepção não registra atendimento, não marca "Realizada" (o registro de que a consulta aconteceu é da nutricionista, RE-D22), não vê nem escreve no prontuário clínico |
| Prontuário (CFN) | A Res. CFN 594/2017, art. 3º, IV, protege os dados do prontuário pelo sigilo e só permite **divulgá-los** com autorização do paciente ou do responsável, ou por decisão judicial. O art. 2º atribui ao nutricionista o registro das informações clínicas **e administrativas**, e o art. 4º, § 1º, I aceita a identificação registrada "por outro profissional da equipe". A v1 trata a recepção como equipe do consultório que lê e grava só a identificação e a agenda, sob termo de sigilo, com a autoria no Histórico de acessos (US-495), e **nunca** o conteúdo do registro clínico: só o selo de retorno e a previsão das funções da RN-510. Pergunta ao CRN-3 ★ (P-R1) |
| Papel na LGPD | A recepcionista é pessoa natural subordinada ao controlador (a nutricionista) e age em nome dele; não é operadora (LGPD, art. 5º, VI e VII; Guia Orientativo para Definições dos Agentes de Tratamento e do Encarregado, versão 2.0, ANPD, abr/2022: subordinados não são controladores nem operadores — item a conferir no PDF oficial). Estar fora de controladora e operadora não tira o dever: o art. 47 alcança "qualquer outra pessoa que intervenha". Confirmar no pacote do advogado ★ (P-R2), inclusive a recepcionista que não é empregada da nutricionista |
| Necessidade (LGPD, art. 6º, III) | Menor privilégio: negação por padrão no banco e nas rotas; lista fechada do que ela vê (RN-517); a observação e a identidade de gênero do cadastro ficam fora da projeção dela (RE-D38); o Ranking é só da nutricionista (RE-D36); o paciente bloqueado some para ela (RE-D35) |
| Dado sensível (LGPD, art. 11) | Nenhuma tabela clínica chega à recepção (RN-517), e a observação do cadastro (texto livre que pode ter dado de saúde) também não (RE-D38). Exceção conhecida: o selo "Primeira consulta"/"Retorno" e a previsão de retorno das funções da RN-510, sem conteúdo clínico. Os Relatórios dela não têm Atendimentos, Planos nem Ranking (RN-480) |
| Segurança e registro (LGPD, arts. 37, 46 e 47) | 2FA obrigatório, prazos de sessão, desativação imediata; toda escrita e toda abertura de cadastro auditadas com o nome dela (a leitura da agenda e da lista não chama `auditRead`, como para a nutricionista: P05 D10; a tela da Equipe diz isso); o art. 47 obriga quem intervém no tratamento a garantir a segurança — reforçado no termo |
| Termo do paciente e DPA | Não mudam (C-486). O termo do paciente 1.0 diz "seus dados ficam com a sua nutricionista" e "Toda abertura ou alteração do seu prontuário fica registrada"; o DPA, cl. 2, já cita os "dados … da equipe". Se o advogado pedir, a próxima versão do termo pode dizer "Se o consultório tiver recepção, a pessoa da recepção vê seu cadastro e sua agenda, nunca o seu prontuário clínico, e tem dever de sigilo." (backlog; P-R3) |
| Relatórios | Os agregados são para gestão interna e continuam sendo dados pessoais do consultório quando o grupo é pequeno (LGPD, art. 5º, III, e art. 12): por isso a exportação é registrada e a impressão tem o rodapé de sigilo. O Ranking é lista nominal interna, só da nutricionista, registrada por paciente na exportação. Sem envio para fora do painel; o arquivo baixado é responsabilidade do consultório (rodapé da impressão). Contar bloqueados num agregado é operação suspensa pelo bloqueio? ★ (P-R5) |

---

## 11. Boas práticas SBIS NGS1

| Prática | Como fica |
|---|---|
| Controle de acesso por papel e menor privilégio | Papel `recepcao` com matriz fechada no banco e nas rotas (§4.3, RN-513) |
| Autenticação forte | 2FA obrigatório para a recepção (RE-D20) |
| Sessão por inatividade | Os prazos da equipe (30 min, 8 h) valem para ela |
| Trilha de auditoria por usuário | Ator em toda escrita e leitura auditada; "Nome (recepção)" no Histórico; ações da Equipe registradas |
| Gestão de contas | Convite com prazo, desativação sem apagar, último acesso visível |

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-480 | Uma política existente que só nega `paciente` (`staff_only`, `patient_isolation`, `paciente_sem_*`) deixa o papel novo passar | Negação por padrão (RN-505) aplicada a **todas** as tabelas pelo laço, e guarda no CI |
| R-481 | Um gatilho que trata "não é `nutri`" como "a RLS recusa" vira brecha quando a tabela é liberada à recepção (achado: `fin_lancamentos_regras`) | `FUNCOES_COM_PAPEL` com decisão por função e guarda (RN-511); revisão do `revisor-rls` |
| R-482 | Uma página liberada à recepção chama, no meio, uma leitura clínica: a RLS devolve vazio em silêncio e um `auditRead` grava "Visualizou" em nome dela | Teste de fonte das rotas (RN-513) + E2E por rota + espião de `LEITURAS_NEGADAS` e de `auditRead` nos testes de cada página liberada + conferência do `audit_log` depois do percurso E2E da recepção (RNF-484 e); guardas de módulo que leem tabela negada viram função `SECURITY DEFINER` booleana (RE-D62) |
| R-483 | Um plano paralelo cria tabela antes do merge do 26 e esquece de negar à recepção | O laço da migration do 26 pega toda tabela com `tenant_id` existente; depois do merge, `app_enable_tenant_rls` já nega |
| R-484 | Plano que entra depois cria página do painel com `requireEquipe` sem querer | A guarda das rotas falha sem a entrada em `ROTAS_DA_RECEPCAO`; CLAUDE.md avisa |
| R-485 | Relatório por local ou mês com número pequeno identifica alguém ("1 paciente idosa no local X") | Uso interno do controlador; sem drill-down (RE-D5); exportação registrada; rodapé de sigilo |
| R-486 | Números dos Relatórios divergem do Início e do Financeiro | Reuso das funções de contagem (`indicadoresDaAgendaNaTransacao`, `resumo.ts`) e teste de consistência (CS-482) |
| R-487 | Performance das agregações com 12 meses | Uma consulta por tabela com índices de hoje; CS-483 na pilha de carga |
| R-488 | A recepção marca "Faltou" numa consulta que a nutricionista atendeu | Com atendimento ligado, o gatilho e o módulo recusam por `app_consulta_tem_atendimento` (RE-D62); sem atendimento ligado, a nutricionista corrige (registrar o atendimento corrige a falta, regra de hoje) e o Histórico mostra quem marcou |
| R-489 | E-mail da recepção é de paciente do mesmo consultório | Recusa com mensagem neutra (RE-D34) |
| R-490 | A permissão do Financeiro tirada continua valendo numa transação já aberta | Vale a partir da próxima transação; a escrita seguinte é recusada pelo banco (US-493) |
| R-491 | O gatilho `fin_lancamentos_regras` muda no 26 e o 20 PR 2 muda o mesmo corpo | O 26 entra depois do 20 PR 2 (C-488) e copia o corpo da `main` na regeneração |
| R-492 | A recepção desativada mantém a página aberta | As sessões são apagadas na desativação; a próxima requisição cai no login |
| R-493 | Um papel desconhecido nas regras de sessão | `capSessionExpiry` já trata papel desconhecido como equipe; `ehPapel` e `ROTULO_PAPEL` ganham `recepcao` com teste exaustivo (`Record<AppRole, …>`) |
| R-494 | O termo de confidencialidade 1.0 sem revisão do advogado | Texto curto, revisado pelo `normas-cfn-lgpd`; vai ao pacote E-09 ★ sem travar (como os textos 1.0 da IA) |
| R-495 | O e-mail que a recepção cadastra recebe o convite do app, o link dos documentos assinados ou o da autorização de IA, e ela aceita com uma conta de paciente sua (acesso ao prontuário pelo portal) | A recepção não muda e-mail nem envia convite; o paciente criado por ela nasce sem convite; a nutricionista envia com a confirmação "O convite vai para {e-mail}" (RE-D37) e vê o e-mail antes de **todo** envio de link que ela dispara — a entrega por link na assinatura (`entregarDocumento`, `registrar-assinatura.ts:98`, e o código de abertura, `link-documento.ts:195`), "Reenviar link por e-mail" e o pedido de autorização de IA por e-mail (RE-D60). Risco residual: a nutricionista enviar sem conferir |
| R-496 | "Este e-mail já tem uma conta no NutriDebby" revela que o e-mail tem conta (enumeração); na sessão da recepção, a duplicidade de e-mail (`patients_tenant_email_unique`) ou de CPF (`patient_cadastro_cpf_unico`) revela que existe paciente que ela não vê (bloqueado) | Só quem está logado vê; as mensagens não dizem de quem nem de que papel; na recepção, a mesma mensagem para paciente visível e escondido, sem link (RE-D65); aceito |
| R-497 | Um agregado calculado numa sessão restrita dá menos, calado (a RLS esconde bloqueados e anonimizados) | Relatório Pacientes da recepção sem a linha de bloqueados e com nota (RE-D39); teste comparando as duas sessões |
| R-498 | O laço da migration pega trava exclusiva em ~100 tabelas numa transação, no boot, com a imagem anterior servindo (e a migration gerada trava `user`, lida em toda requisição) | `lock_timeout` de 10 s na conexão do migrador (RE-D64), valendo para a execução inteira; a migration volta inteira e o boot tenta de novo; merge fora do horário de uso e fora das 03h–07h30 BRT |
| R-499 | Página liberada à recepção com link ou leitura do prontuário ("Abrir prontuário", motivo do cancelamento, `consultaParaIniciarAtendimento`) | Lista por página na tarefa de cada tela (PM-R15); E2E da recepção clicando os links; RE-D44 |

---

## 13. Conflitos com sessões paralelas

Conferido em 17/11/2026 nos worktrees `nutridebby-b` (19, 67b21d3), `origin/plano-20-financeiro` (20 PR 2, 411f21d),
`nutridebby-21` (1b209f7), `nutridebby-22` (bd0401a), `nutridebby-23` (80c55ed) e `nutridebby-25` (sem spec ainda). Os
branches andam: reconferir na T1 e antes de cada PR.

| Onde | Quem | Conflito | Como resolver |
|---|---|---|---|
| `drizzle/` | 19, 21, 22, 23, 25 | Números e journal | §5: gerar de novo sobre a `main`; o PR 2 do 26 é o último na fila de migration da onda |
| `app_enable_tenant_rls` (0051) | qualquer plano que o redefina | O 26 refaz o corpo com `app_deny_recepcao` | Corpo copiado da `main` na regeneração; nenhum plano da onda o redefine hoje (conferido) |
| Tabelas novas de 19, 21, 22, 23 e 25 | todos | Precisam nascer negadas à recepção | Antes do 26: o laço da migration do 26 nega. Depois: `app_enable_tenant_rls` nega. Só o 23 tem tabela que a recepção usa (`locais_atendimento`, `public_booking_requests` já existe) |
| `fin_lancamentos_regras`, `src/modules/financeiro/*`, `src/app/painel/financeiro/*`, CSV do Financeiro | 20 PR 2 | O 26 troca `ctx.role === 'nutri'` por `exigirFinanceiro`, refaz o gatilho e põe `requireEquipe` nas telas | PR 2 e PR 3 do 26 depois do merge do 20 PR 2 (C-488) |
| `src/modules/financeiro/resumo.ts` | 20 PR 2 | Funções novas `recebidoEPagoPorMes`, `porCategoriaNoPeriodo` | Só acrescentar no fim; o PR 1 do 26 abre depois do 20 PR 2 |
| `src/modules/financeiro/csv.ts` | 20 PR 2 | Exportar o escape de célula | Só acrescentar `export` |
| `src/app/painel/navegacao.ts` | 20 PR 2 ("Financeiro"); 23 (não mexe, AG-D37); 25 (talvez "Mensagens") | "Relatórios" e o filtro por papel | Depois do 20 PR 2; avisar o 25: item novo dele entra também no filtro por papel (a recepção não vê) |
| Agenda: `consultas.ts`, `presenca.ts`, `disponibilidade.ts`, `visoes.ts`, `solicitacoes.ts`, páginas e actions | 23 (todas as PRs; RN-400: `ctx.role === 'nutri'`) | O 26 troca por `exigirEquipe` nas funções da RN-509 e a classificação Primeira consulta/Retorno usa a função da RN-510 na sessão da recepção | PR 3 do 26 só com o 23 inteiro na `main` (C-488); `visoes.ts` ganha um ramo por papel |
| `src/app/painel/agenda/consultas/[id]/page.tsx`, `cancelar-form.tsx` | 20 PR 2 ("Cobrança"), 23 (local, Aceitar/Recusar) | Ramo da recepção (link do cadastro, sem motivo, sem atendimento) | PR 3 depois do 23 inteiro; um ramo por papel (RE-D44) |
| `consultations.retorno_previsto_em` | 23 | `app_previsoes_de_retorno` lê a coluna | Função criada só com o 23 na `main` |
| `app_appointments_regras_pedido`, `app_tenants_agenda_da_equipe` (23, `0127_rls_agenda_2.sql`) | 23 | O aceite e a recusa do pedido só valem para `nutri` | A custom do 26 refaz `app_appointments_regras_pedido` com o corpo da `main` do momento (RE-D59); se o 23 mudar a função depois do PR 2 do 26, mantém o papel `recepcao` (avisar a sessão do 23) |
| Funções com papel de 19, 21, 22 e 25 | todos | `FUNCOES_COM_PAPEL` | Na tarefa do banco, listar por `pg_proc` na `main` do momento e decidir cada uma (PM-R1); o plano que entrar depois do PR 2 do 26 decide as próprias |
| `src/app/painel/layout.tsx`, `page.tsx` (Início) | 23 (cartões "Solicitações" e "Aniversariantes"), 25 (talvez contador de mensagens) | Versão da recepção | Rebase; o Início da recepção é componente próprio; cartões novos de outros planos ficam fora dele por padrão |
| `src/app/painel/pacientes/page.tsx`, `pacientes.ts` | 18 (já na main), 23 (US-415, filtro por local) | Projeção e menu da recepção | Rebase; só um ramo por papel no menu da linha |
| `src/app/painel/pacientes/[id]/perfil/*` | 18 (main) | O formulário vira componente reaproveitado pelo cadastro da recepção | Extrair sem mudar a página da nutricionista |
| `src/app/painel/configuracoes/page.tsx` (`CARTOES`) | 19, 23 | Cartão "Equipe" | Só acrescentar no fim |
| `src/lib/session-rules.ts`, `tenant-session.ts`, `session.ts`, `auth.ts` | ninguém da onda (conferido) | Papel novo | Livre; o 20 PR 2 não mexe em `ApiNutri` (AG conflito do 23) |
| `src/modules/plataforma/convites.ts`, `src/app/convite/[token]/*` | ninguém | Tipo `recepcao` | Livre |
| `src/modules/notificacoes/tipos.ts`, CHECK de `notifications.tipo` | 23 (tipos de pedido), 25 (tipos do chat) | `TIPOS_DA_AGENDA` | O 26 parte do CHECK da `main`; tipos do 25 ficam **fora** da lista (a recepção não vê); o teste da RN-507 obriga a decisão |
| `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `CLAUDE.md` | 19, 21, 22, 23, 25 | Entradas novas | Só acrescentar no fim de cada bloco; no `CLAUDE.md`, ficar com a linha da `main` e reacrescentar a frase "Plano 26" |
| `src/modules/plataforma/audit.ts` (`ENTIDADE_ROTULO`) | 21, 22, 23, 25 | `relatorios`, `equipe` | Só acrescentar |
| `e2e/painel-rotas.ts`, `e2e/acessibilidade-painel.spec.ts`, `scripts/e2e-seed.ts` | 19, 20 PR 2, 21, 22, 23 | Rotas novas; contas de recepção na semente | Rebase; a semente cria `E2E_RECEPCAO` e `E2E_RECEPCAO_FIN` **uma vez** e as reaproveita (nunca `delete user`: `equipe_membros` sem DELETE e `consents` com FK para `user` dariam 23503 na segunda execução, `e2e-seed.ts:142-232`); o E2E da Equipe (convidar, desativar) roda num consultório **novo por execução** (molde `E2E_FIN_NOVO`, `e2e-seed.ts:61-66`), para o limite de 3 não esgotar no banco de dev reaproveitado (RE-D46) |
| `src/modules/ajuda/conteudo.ts` (+ testes), `src/app/painel/guia/*`, `src/app/painel/ajuda/page.tsx` | 18, 19, 20, 22, 23, 25 | Guias novos e `guiaDaRota(caminho, papel)` | Só acrescentar guias; o campo `papeis` nasce opcional (padrão `['nutri']`), então o guia novo de outro plano continua só da nutricionista sem tocar nele |
| Plano 25 (chat e recados) | 25 (spec v0.1 em `nutridebby-25`: C-442 e CH-D33) | Seis tabelas `chat_*`/`recados`, item "Mensagens" no menu, contadores no layout, tipos de notificação do chat | O 25 já decidiu: nada para a recepção. Quem entra depois acrescenta as tabelas do outro às listas (a negação vem do laço ou de `app_enable_tenant_rls`); o item "Mensagens" fica fora do menu dela; os tipos do chat ficam fora de `TIPOS_DA_AGENDA`. Se o PR 2 do 26 entrar antes do 25, o 25 (e os PRs do 23 com migration) gera de novo as migrations (§5 de `sessoes-paralelas.md`) e decide as próprias funções em `FUNCOES_COM_PAPEL` e os próprios tipos em `TIPOS_FORA_DA_RECEPCAO` |
| Plano 19 (`meal_plans`) | 19 | Publicação e versões do plano | A RN-489 é conferida no rebase sobre o 19 |
| Numeração | 25 (440–479) | — | O 26 fica no 480–519 |

**Ordem:** PR 1 (Relatórios, sem migration) depois do 20 PR 2; a Fase B do local entra no PR 3 (com o 23). PR 2
(fundação da recepção, com migration) depois do 20 PR 2 e do 23 PR 1, sozinho na fila de migration. PR 3 (telas da
recepção) depois do 23 inteiro.

---

## 14. Decisões (delegadas pelo dono, onda 3: "seguir as recomendações sem parar para perguntar")

| ID | Decisão (recomendação) | Porquê | Onde |
|---|---|---|---|
| **RE-D1** | **Três PRs**: (1) Relatórios, sem migration; (2) fundação da recepção (banco, sessão, convite, Equipe, Início da recepção); (3) telas de trabalho da recepção (cadastro, agenda, Financeiro, Relatórios dela) e a Fase B do local | O briefing permite dividir; a fundação com negação por padrão é segura de mergear sozinha (a recepção só vê o Início), e as telas dependem do 23 inteiro | §2.1, §13 |
| **RE-D2** | Relatórios em **`/painel/relatorios`**, item próprio no menu, com seis seções em abas-link | É um assunto do consultório inteiro, não do Financeiro nem da Agenda; abas-link funcionam sem JS e repetem o padrão do Financeiro | §4.1 |
| **RE-D3** | Período em **meses inteiros**, até 12, padrão os últimos 12 | Todas as tabelas são mensais; 12 meses mantém a consulta barata e casa com o CSV do Plano 20 (366 dias) | RN-481 |
| **RE-D4** | **Agregado não é acesso a dado de saúde de pessoa**: sem `auditRead`; exportação = `exportar` sem paciente. **Lista nominal** (Ranking): sem `auditRead` na tela, como a lista de pacientes, a agenda e os "Pagamentos pendentes"; `exportar` por paciente na exportação | A regra 8 manda auditar quando se **devolve** dado de saúde de alguém; contagem não devolve. A lista nominal com número segue os precedentes (P05 D10, RN-318 do 20); a saída do dado do sistema (arquivo) é que precisa de rastro por titular (RN-321 do 20) | RN-493 |
| **RE-D5** | **Sem drill-down** na v1 | Número que vira lista de pacientes de um mês é lista de dado de saúde por pessoa; pediria `auditRead` por paciente e mudaria a RE-D4 | §2.2 |
| **RE-D6** | **Fase da vida = faixa etária** (adultos e pessoas idosas, com faixas de 10 anos); sem gestação e lactação | Não há campo de gestação (seria dado de saúde, decidido na anamnese) e o cadastro é só de adultos (RN-17); 60 anos segue o Estatuto da Pessoa Idosa | RN-485 |
| **RE-D7** | **Sexo do cadastro** (F, M, Não informado); identidade de gênero fora | `sexo` é obrigatório e completo; identidade de gênero é opcional e rara (Plano 18) e daria grupos de 1 pessoa | RN-484 |
| **RE-D8** | **Atendido = consulta realizada ou atendimento registrado**; primeira × retorno pela regra do 23 | Há atendimento sem consulta e consulta realizada sem atendimento; usar uma só fonte subcontaria. A regra do 23 evita duas definições de "retorno" no produto | RN-488, RN-490 |
| **RE-D9** | **PDF pela impressão do navegador** | Sem arquivo no servidor (regra 9), sem worker, sem custo; precedente AG-D15 do 23 | RN-495 |
| **RE-D10** | **CSV no formato do Plano 20**, com o mesmo escape | Um formato só no produto; a proteção contra fórmula já está testada | RN-494 |
| **RE-D11** | **Financeiro sem duplicar o fluxo de caixa**: período por mês e por categoria, com link para "Financeiro › Relatórios" | O fluxo de caixa anual e o CSV dos lançamentos já existem no 20; aqui só o que falta (período livre e local) | RN-491 |
| **RE-D12** | **Ranking com 20 linhas**, sem bloqueados e anonimizados; nome exibido na tela, nome de registro no arquivo | O bloqueio suspende qualquer operação de tratamento (LGPD, art. 5º, XIII); nome de registro no arquivo segue o CSV do 20 | RN-492 |
| **RE-D13** | **Filtro de local só com o 23**, derivado das consultas; saídas sem local | O local nasce no 23 (PD-70); a derivação pelo `appointment_id` é a mesma da US-416 de lá | RN-482 |
| **RE-D14** | **Papel novo `recepcao`** em `user.app_role` e no `withTenant`, nunca "`nutri` com uma bandeira" | Com `app.role = 'nutri'`, toda política, gatilho e função que libera a nutricionista liberaria a recepção; um papel próprio faz o banco recusar por padrão | RN-498 |
| **RE-D15** | **Negação por padrão no banco** (`recepcao_negada` nascendo com `app_enable_tenant_rls`) e liberação explícita com guarda | É o molde que já protege o `publico` (D11 do P05); tabela nova de qualquer plano nasce fechada sem ninguém lembrar | RN-505 |
| **RE-D16** | **Negação por padrão no app**: `requireNutri` não muda; `requireEquipe` só nas rotas da lista | As 89 páginas de hoje ficam fechadas à recepção sem tocar nelas; a lista é revisável num lugar só | RN-504, RN-513 |
| **RE-D17** | **Só a nutricionista convida**; o admin não | O admin não grava em tabela com `tenant_id` (regra 1) e quem decide quem acessa o consultório é a controladora. O admin ainda reinicia o 2FA pelo fluxo de hoje | RN-499, §3 |
| **RE-D18** | **Até 3 recepcionistas ativas** | Cobre o consultório de uma nutricionista; limita contas com acesso a dados (LGPD, art. 6º, III) e o custo de sessão na VPS | RN-499 |
| **RE-D19** | **Uma permissão só**: "Permitir acesso ao Controle Financeiro", conferida **no banco** | É a função do Dietbox; checar só no app deixaria a recepção sem permissão ler `fin_*` por qualquer leitura esquecida | RN-502, RN-506 |
| **RE-D20** | **2FA obrigatório** para a recepção (como o admin), na primeira entrada | A conta é criada por outra pessoa e costuma ficar em computador de recepção, compartilhado; o 2FA da nutricionista continua opcional. O briefing pede "2FA como a nutricionista": o mecanismo é o mesmo; a obrigatoriedade é mais forte e custa uma tela | RN-500 |
| **RE-D21** | **Termo de confidencialidade** aceito no primeiro acesso, em `consents` (`sigilo-equipe-1.0`) | Res. CFN 599/2018, art. 20, I ("pessoas não obrigadas ao mesmo compromisso"; informações "mediante assinatura de termo de sigilo ou confidencialidade"); a partir de 23/01/2027, Res. 856, art. 36 (medida organizacional); LGPD, art. 47; prova versionada no mesmo lugar dos outros aceites | RN-500, §10 |
| **RE-D22** | A recepção **não marca "Realizada"** nem registra atendimento; marca **"Faltou"** só de consulta agendada ou confirmada | "Realizada" é o registro de que a nutricionista atendeu (art. 52 da Res. 599) e dispara a cobrança automática (RN-310 do 20), que exigiria liberar o Financeiro a quem não tem a permissão | RN-509 |
| **RE-D23** | **Ficha da recepção em rota própria** (`/painel/cadastro/[id]`), fora do layout do prontuário | O layout da ficha lê a antropometria com `auditRead` (D13 do 18) e monta 13 abas clínicas; condicionar cada uma ao papel seria frágil. Rota própria = nada clínico carregado | RN-515 |
| **RE-D24** | ~~A observação do cadastro fica visível à recepção~~ — **revista na v0.2 pela RE-D38**: a observação fica fora da projeção da recepção | O argumento "a RLS não corta coluna" não se sustentava: a spec já esconde por projeção o `motivo` dos bloqueios (RN-509); e as observações já gravadas foram escritas sob o aviso do Plano 18 | RE-D38 |
| **RE-D25** | A recepção **não** arquiva, reativa, bloqueia, pede exclusão, mexe em etiquetas, "peso no app", IA nem opt-in do WhatsApp | Mudam o tratamento ou guardam consentimento declarado pela nutricionista (`whatsapp_optin_origem = 'nutri'`); etiqueta pode ser clínica | RN-508 |
| **RE-D26** | Horários, bloqueios e locais **só leitura**; aniversariantes e configurações **nada** | A agenda precisa ler para marcar; mudar a disponibilidade da nutricionista é decisão dela; a autorização de aniversário é declarada pela nutricionista (AG-D32 do 23) | RN-509 |
| **RE-D27** | **Marcos de atendimento por funções que devolvem só o selo de retorno por consulta visível e a previsão de retorno** (v0.2) | "Primeira consulta"/"Retorno" e "Previsão de retorno" dependem de `consultations` (prontuário); a função dá à recepção o selo sem abrir a tabela nem a primeira data da vida do paciente, e só de paciente visível | RN-510 |
| **RE-D28** | **Desativar, nunca apagar**; DELETE revogado | O registro de quem teve acesso precisa ficar (LGPD, art. 37; trilha SBIS); o `audit_log` aponta para a conta | RN-503 |
| **RE-D29** | **DPA pendente bloqueia a recepção**, sem tela de aceite para ela | Quem contrata o tratamento é a controladora; a recepção não pode trabalhar fora de contrato vigente | RN-501 |
| **RE-D30** | Avisos por e-mail e push **só à nutricionista** na v1 | Evita mexer em `aviso-nutri.ts` e nas filas; a recepção vê as novidades no Início | RN-518 |
| **RE-D31** | **Lista de funções que olham o papel**, com guarda | Achado do levantamento: `fin_lancamentos_regras` delega à RLS quando o papel não é `nutri`; sem a lista, o próximo gatilho igual passaria despercebido | RN-511 |
| **RE-D32** | A recepção **não vê o Histórico de acessos**; a nutricionista vê "Último acesso" na Equipe | O Histórico revela que houve exame, plano, IA (dado de saúde pelo rótulo); o último acesso basta para a gestão da equipe | RN-516 |
| **RE-D33** | Cancelamento pela recepção = `cancelado_por = 'nutri'` ("pelo consultório"); quem foi está no `audit_log` | Sem valor novo no CHECK nem em todos os mapas de rótulo; o paciente vê "cancelada pelo consultório", que é o certo para ele | RN-509 |
| **RE-D34** | **E-mail exclusivo** para a conta da recepção | `user.email` é único; a recepção não pode ser a mesma conta de paciente (papéis diferentes, prazos diferentes). Mensagem neutra, sem dizer de quem é | RN-498 |
| **RE-D35** | A recepção **não vê paciente bloqueado** (política no banco) | O bloqueio suspende qualquer operação de tratamento (LGPD, art. 5º, XIII); a recepção não tem tarefa com ele. Escondido = falha fechada nas tabelas filhas e nos gatilhos (RE-D40) | RN-508 |
| **RE-D36** | Relatórios da recepção: **Pacientes e Agenda**; Financeiro com a permissão; **nunca** Atendimentos, Planos nem Ranking (revista na v0.2) | O que ela já vê na agenda e no cadastro, agregado; atendimentos e planos contam registros do prontuário; o Ranking diz quanto cada pessoa usa um serviço de saúde e nenhuma tarefa da recepção precisa dele, nem por receita (LGPD, art. 6º, III; achado I4 da revisão normativa) | RN-480 |
| **RE-D37** | **A recepção não muda o e-mail do paciente nem envia o convite do app**; o paciente que ela cadastra nasce sem convite, e a nutricionista envia pela ficha ("No app"), com a confirmação "O convite vai para {e-mail}. Confira o e-mail antes de enviar." | O e-mail é a chave do portal (aceite e `vincularContaExistente`, `convite-paciente.ts:234-299`), do link dos documentos assinados (`documentos/entrega.ts`) e do link da autorização de IA (`ia/autorizacao.ts`); `atualizarPaciente` reenvia o convite sozinho quando o e-mail muda (`pacientes.ts:198-200`): quem troca o e-mail e aceita o convite passa a ver o prontuário pelo portal (achado C1 da revisão de banco) | RN-508, US-491 |
| **RE-D38** | **Observação e identidade de gênero fora da projeção da recepção** (leitura e escrita); o nome social continua | Texto livre que pode ter dado de saúde, gravado antes sob o aviso do Plano 18; identidade de gênero sem classificação fechada (pergunta 5 do Plano 18 ao advogado) e sem uso na agenda (LGPD, art. 6º, III). Substitui o aviso no primeiro convite proposto pela revisão normativa, que pediria à nutricionista revisar todas as observações | RN-508, RN-515 |
| **RE-D39** | **Relatório Pacientes da recepção sem bloqueados e anonimizados, com nota**; sem função de contagem `SECURITY DEFINER` | A recepção não vê bloqueado (RE-D35) e não precisa saber quantos são; uma função que contasse para ela daria o número que o bloqueio pode suspender (P-R5) e mais uma peça `SECURITY DEFINER`. O agregado que dava menos, calado, vira diferença dita na tela | RN-483, US-480 |
| **RE-D40** | **Paciente escondido = falha fechada**: condição `recepcao_cond_paciente_visivel` em `patient_cadastro`, `appointments`, `notifications` e `fin_lancamentos`; nos gatilhos e módulos, paciente não achado na sessão da recepção = recusa | Dentro de gatilho e de módulo, a leitura do paciente pela RLS de quem age volta vazia, e `IF v_status = 'bloqueado'` ou `EXISTS` com tudo nulo passa: a recepção lançaria ou mexeria em consulta de paciente bloqueado (achado I1) | RN-506, RN-508, §4.4 |
| **RE-D41** | **Gatilhos de colunas por lista branca** (`patients`, `patient_cadastro`, `appointments`; com o 23, `public_booking_requests`), no INSERT e no UPDATE | A lista negra deixava `user_id` (liga uma conta de paciente existente ao cadastro novo), `bloqueado_em`, `anonimizar_apos`, `anonimizado_em` e, na agenda, o INSERT direto no estado final (`realizada`, `faltou`, `origem='paciente'`) e a troca de `patient_id` (achados I3 e I4) | RN-508, RN-509 |
| **RE-D42** | **Manual guiado por papel**: `Guia.papeis` (padrão `['nutri']`), `guiaDaRota(caminho, papel)`, `GuiaDoPainel` com o papel, `/painel/ajuda` filtrado; guias próprios da recepção (`recepcao-*`), não variantes dos da nutricionista | O tour `boas-vindas` abriria sozinho para ela no primeiro acesso, falando de telas que ela não tem e com alvos que não existem no Início dela; os guias `pacientes`, `agenda` e `financeiro` citam ações ausentes para ela. Guias próprios mantêm progresso e versão separados e não mudam os da nutricionista | RE-10, §6.2 |
| **RE-D43** | **"Último acesso" = `user.ultimo_acesso_em`, gravado no login** da conta `recepcao` | A sessão é apagada no logout, na expiração e na desativação: o maior `session.updated_at` mostraria "Ainda não entrou" para quem já entrou | RN-516 |
| **RE-D44** | **A recepção cancela sem motivo e não lê o motivo**; na página da consulta, "Abrir cadastro" no lugar de "Abrir prontuário" | O motivo é "Só você vê." para a nutricionista, e `motivoDoCancelamentoDaNutri` lança erro fora da sessão `nutri` (`consultas.ts:278-279`): a consulta que a própria recepção cancelou daria erro 500 | RN-509, US-492 |
| **RE-D45** | **`/conta/seguranca` aceita a recepção e a página `/conta/acesso-desativado` é nova** | A Segurança só aceita `admin` e `nutri` (`requireUser`, `seguranca/page.tsx:12`) e o `forbidden` de hoje leva a "Este aparelho está conectado como…"; o 2FA obrigatório (RE-D20) precisa de onde ser configurado | RN-500, RN-503 |
| **RE-D46** | **E2E: contas de recepção criadas uma vez e reaproveitadas; o E2E da Equipe e o do primeiro acesso num consultório novo por execução (RE-D69)** | `equipe_membros` sem DELETE e `consents` com FK para `user`: o `delete user` da semente daria 23503 na segunda execução; e cada execução que convida esgotaria o limite de 3 | PM-R10 |
| **RE-D47** | **"Sem permissão" com dois textos** (página só da nutricionista × falta da permissão do Financeiro) e **erro inline** nas actions do Financeiro | O texto único estava errado para o Financeiro; a permissão tirada no meio do trabalho não pode descartar o formulário | RN-504, US-493 |
| **RE-D48** | **As opções do período sempre incluem os 12 últimos meses**; período inválido mostra os números do padrão, com o erro no campo e "Mostrando …" | Num consultório com menos de 12 meses, o mês "De" do padrão não existia no `<select>` e o navegador escolheria outro sozinho; "os números não mudam" contradizia "volta ao padrão" | RN-481, US-486 |

**Decisões da revisão do plano (v0.3).** RE-D49 a RE-D58 são do plano (execução) e entram aqui no fechamento; estas
mudam regras da spec e entram já:

| ID | Decisão (recomendação) | Porquê | Onde |
|---|---|---|---|
| **RE-D59** | **A recepção responde só os pedidos de paciente já cadastrado** (consulta `solicitada`); os pedidos de **pessoa nova** (`public_booking_requests`) ficam com a nutricionista e a tabela fica negada à recepção. A custom refaz `app_appointments_regras_pedido` (corpo da `main` do momento) com o papel `recepcao` no aceite (`solicitada → agendada`) e na recusa (`pedido_recusado`); `appointments_da_recepcao` aceita `pedido_recusado` só saindo de `solicitada` | Hoje o gatilho do 23 só deixa `nutri` aceitar e recusar (`0127_rls_agenda_2.sql:102-118`) e o PR 3 não tem migration: sem o `CREATE OR REPLACE` no PR 2, a recepção receberia 42501. O aceite de pessoa nova (RN-424 do 23) cria paciente com `origem = 'agendamento_publico'`, grava `consents` e o opt-in de origem `paciente` — três escritas fora da lista branca, mais uma exceção de RLS e um marcador local, e o e-mail de paciente bloqueado cairia num 23505 que revela o escondido. Menos peças, menor privilégio (LGPD, art. 6º, III) | §2.2, §3, §4.3, §4.4, RN-509, US-492 |
| **RE-D60** | **Confirmação do e-mail antes de todo envio de link ao paciente iniciado pela nutricionista**: além do convite (RE-D37), a assinatura com entrega por link, "Reenviar link por e-mail" e "Enviar pedido de autorização por e-mail" (IA) mostram "O link vai para {e-mail}. Confira o e-mail antes de enviar." | `entregarDocumento` (`entrega.ts:30-46`, chamado na assinatura) manda o link e depois o código (`link-documento.ts:195`) a `patients.email` do paciente ativo sem conta — exatamente o paciente que a recepção cadastra; o link da autorização de IA também. Segurar a entrega até uma confirmação pediria estado novo em `patients` (C-485) | R-495, §6.2, US-491 |
| **RE-D61** | **A seção "Cobrança" da consulta nunca aparece para a recepção**, com ou sem a permissão; `cobranca.ts` e `cobranca-actions.ts` continuam só da nutricionista; com a permissão, ela lança pelo Financeiro | `cobrancaDaConsulta` e `registrarCobrancaManual` chamam `exigirNutri` (`cobranca.ts:130,161` do 20 PR 2); a cobrança nasce de "Realizada", que é da nutricionista (RE-D22). Uma regra só, sem ramo por permissão na página da consulta | RN-506, RN-509, US-492, PM-R9 |
| **RE-D62** | **"Faltou com atendimento ligado" conferido por função `SECURITY DEFINER` booleana** (`app_consulta_tem_atendimento`, molde 0083) no gatilho `appointments_da_recepcao` e em `registrarPresenca` | `registrarPresenca` procura `consultations` com o tx da sessão (`presenca.ts:41-43`); para a recepção a tabela é negada, a busca volta vazia e a guarda da CS-03 passaria calada. Mesmo padrão "vazio calado não é recusa" da RE-D40 | RN-509, RN-510, §4.4, R-488 |
| **RE-D63** | **Início da recepção sem indicadores do mês**; a taxa de faltas fica em Relatórios › Agenda, que ela vê | O Início dela é o trabalho do dia (agenda, presença, solicitações); os números do mês são dado de agenda que ela já registra, e o lugar deles é o relatório | RN-514 |
| **RE-D64** | **`lock_timeout` de 10 s na conexão do migrador** (`src/db/migrate.ts`), não `SET LOCAL` na custom | O migrador roda todas as pendentes numa transação: a migration gerada (CHECK e coluna em `user`, lida em toda requisição) e o gatilho em `tenants` rodariam sem limite antes ou depois do `SET LOCAL`. Vale para toda migration futura, sem custo | §9.3, R-498 |
| **RE-D65** | **Duplicidade de e-mail ou CPF na sessão da recepção: a mesma mensagem para paciente visível e escondido, sem link**; enumeração aceita | A UNIQUE `(tenant, email)` e `patient_cadastro_cpf_unico` revelam que o valor já existe; esconder isso pediria tirar a unicidade. Sem link nem diferença de texto, ela não distingue o bloqueado de um paciente que não procurou | R-496, US-491 |
| **RE-D66** | **14 tarefas** (T5 e T11 divididas em a/b), acima das 8–12 do briefing | Revisão do plano: a T5 juntava liberações, condições, gatilhos e funções `SECURITY DEFINER` numa revisão só; a T11 juntava o Financeiro da recepção com a Fase B do local, que muda o produto da nutricionista | Plano |
| **RE-D67** | **Entrada fora do painel com a recepção**: `/inicio`, `/conta/outro-papel` e `/api/sessao/ativa` aceitam o papel; guarda de fonte para todo `requireUser(`/`requireApiUser(`/`lerSessaoApi(` fora do painel | O login, o 2FA e o "Continuar" da Segurança vão a `/inicio`, que só aceita `admin`, `nutri` e `paciente` (`inicio/page.tsx:8`) e manda a recusa a `/conta/outro-papel`, que também não a aceita: a recepção não entraria. `/api/sessao/ativa` (`EQUIPE = ['admin','nutri']`) recusaria o aviso de inatividade e a renovação pelo uso | RN-501, RN-513, §4.1 |
| **RE-D68** | **Ranking por receita por `receitaPorPaciente` do módulo do 20; empate por `app_unaccent(lower(…))`** | A RN-491 fecha `fin_*` no módulo do Financeiro; a extensão `unaccent` existe (0000) e o `app_unaccent` (0040) já é o padrão do produto | RN-491, RN-492 |
| **RE-D69** | **E2E do primeiro acesso e da Equipe num consultório novo por execução; a semente grava `equipe_membros` por `withTenant({ role: 'nutri', actorUserId })`** | `equipe_membros.user_id` é `NO ACTION` com DELETE revogado: a conta convidada não sai, e o consultório principal do E2E já tem as duas contas da recepção (o limite de 3 esgota); o gatilho `equipe_membros_regras` recusa `worker`, que a semente usa hoje (`e2e-seed.ts:109,202`) | RE-D46, PM-R10 |

---

## 15. Pendências externas ★ (não travam a v1)

| ID | Pergunta | A quem | Enquanto isso |
|---|---|---|---|
| P-R1 | A auxiliar administrativa, sob termo de sigilo, pode (a) ver e (b) **gravar** os dados de identificação e o cadastro (Res. 594, arts. 2º e 4º, § 1º, I), com a autoria registrada no Histórico de acessos? Ela é "terceiro" para o art. 3º, IV, ou alguém "obrigado ao mesmo compromisso" (Res. 599, art. 20, I)? | CRN-3 | A v1 limita a recepção à identificação e à agenda, sob termo; a autoria no Histórico (US-495) é o rastro |
| P-R2 | A recepcionista empregada da nutricionista é só "pessoa subordinada" (não operadora)? E a que **não** é empregada (recepção de clínica compartilhada, terceirizada ou autônoma): continua subordinada, ou o vínculo vira operação (LGPD, art. 39) e pede contrato? O aceite eletrônico (caixa marcada, com IP, em `consents`) vale como a "assinatura" do termo que o art. 20, I da Res. 599 pede (MP 2.200-2/2001, art. 10, § 2º: outro meio de comprovar autoria "desde que admitido pelas partes como válido")? O termo de confidencialidade 1.0 está bom? | Advogado (pacote E-09) | Texto 1.0 com o conteúdo mínimo da PM-R3, revisado pelo `normas-cfn-lgpd` |
| P-R3 | O termo do paciente 1.0 e o DPA precisam citar a equipe do consultório? A "informação ao paciente quanto ao uso e ao compartilhamento de seus dados" (Res. 856, art. 23) pede que o termo do paciente cite o acesso da recepção? | Advogado | Sem mudança de texto (C-486); a frase sugerida na §10 vai ao backlog |
| P-R4 | Os artigos da Res. 856/2026 (23, 36 e 66) conferem com o texto oficial no DOU, e a vigência de 23/01/2027 se mantém? | `normas-cfn-lgpd` no texto oficial | Vale a Res. 599/2018 até 22/01/2027 |
| P-R5 | A contagem agregada de pacientes bloqueados (US-480, "Bloqueados por pedido de exclusão") e a inclusão deles em "Novos pacientes por mês" (RN-487) são operações suspensas pelo bloqueio (LGPD, art. 5º, XIII)? | Advogado | Mantém na visão da nutricionista; a recepção não vê (RE-D39) |

---

## 16. Pontos para o plano (PM)

| ID | Ponto |
|---|---|
| PM-R1 | T1: reconferir os branches da §13 e a `main`; na tarefa do banco: listar as funções da §4.4 por `pg_proc` no banco de teste da `main` do momento e decidir cada função nova dos Planos 19, 21, 22, 23 e 25 |
| PM-R2 | PR 1 abre depois do 20 PR 2; a seção Financeiro e o Ranking por receita usam o módulo do 20 |
| PM-R3 | O texto do termo de confidencialidade 1.0 é escrito numa tarefa própria, revisado pelo `normas-cfn-lgpd`, versionado em `textos-versionados.ts`, mostrado na página do convite (`TextoLegalView`) e servido numa página pública estática (`/termos/sigilo-equipe`). **Conteúdo mínimo:** (1) as partes são a nutricionista (controladora) e a pessoa da recepção; a plataforma só registra o aceite (o DPA, cl. 2, já cobre os "dados … da equipe"); (2) objeto: os dados de pacientes, inclusive o fato de alguém ser paciente do consultório; (3) uso só para agenda e cadastro (LGPD, art. 6º, I e III); (4) proibido copiar, fotografar, exportar ou repassar dados; senha e 2FA pessoais; sair do computador compartilhado; (5) avisar a nutricionista na hora de qualquer suspeita de incidente (o prazo do controlador conta da ciência dele: Res. ANPD 15/2024, art. 6º); (6) o sigilo continua depois da desativação; (7) os dados **dela**: nome, e-mail, IP, autoria no Histórico de acessos e "Último acesso" visível à nutricionista (LGPD, arts. 6º, VI, e 9º); (8) referência à Res. 599, art. 20, I, e ao Código de Ética que a substituir (Res. CFN 856/2026, quando entrar em vigor). **Texto 1.0 aprovado pelo dono em 24/11/2026 (RE-D72 resolvida):** cl. 8 na opção 2, texto neutro, no lugar dos arts. 23 e 36 "a partir de 23/01/2027"; cl. 7 com "e de armazenamento das cópias de segurança" entre os fornecedores; OK nas duas mensagens novas (convite expirado; acesso não liberado sem o aceite); data da versão 24/11/2026. As perguntas 9 a 14 ao advogado (E-09) seguem em paralelo; mudança pedida por ele sai como 1.1. |
| PM-R4 | A migration do PR 2 é a última da onda; a custom copia da `main` os corpos de `app_enable_tenant_rls` e de `fin_lancamentos_regras` |
| PM-R5 | O teste de isolamento ganha a sessão `recepcao` em todos os casos antes de qualquer liberação (vermelho → verde por tabela liberada) |
| PM-R6 | `requireEquipe` e o teste de fonte das rotas vêm antes de qualquer página da recepção |
| PM-R7 | O formulário do Perfil vira componente com a variante da recepção (sem as partes da RN-508), sem mudar a página da nutricionista |
| PM-R8 | Agenda: lista fechada das funções que aceitam a recepção, com teste de fonte (RN-509) |
| PM-R9 | Financeiro: `exigirFinanceiro` em todas as funções do módulo menos `configuracoes.ts`, `cobranca.ts` e `titular.ts` (RN-506, RE-D61); teste de fonte |
| PM-R10 | Semente do E2E: `E2E_RECEPCAO` (2FA de teste, permissão desligada) e `E2E_RECEPCAO_FIN` (permissão ligada), criadas uma vez e reaproveitadas, com a linha de `equipe_membros` gravada na sessão `nutri` com ator; o E2E da Equipe e o do primeiro acesso em consultório novo por execução (RE-D46, RE-D69) |
| PM-R11 | Pilha de carga: cenário "relatórios" (CS-483) |
| PM-R12 | Fechamento: manual técnico (cap. 02: RLS da recepção e as quatro listas; cap. 03: §3.2 Papéis, §3.5 2FA obrigatório, §3.6 Sessão, §3.7 Guardas por papel, §3.10 Convites, §3.12 Aceites e §3.16 Fluxo de login com a recepção; cap. 04: §4.1.1 contas e convites com a Equipe, §4.1.6 manual guiado por papel, e o módulo de Relatórios; cap. 05: Relatórios e agenda da recepção; cap. 06: operação e runbook; cap. 07: guardas novas, sessão `recepcao` no isolamento, contas do E2E), manual do usuário (Docs `XgD7ujxhUajihUXa4Qf7yc`: aba nova "Recepção", seção "Relatórios", índice e capturas), Central de Ajuda (`VCtjNoh3xPxTBsE9Y16Ld6`: artigos de Relatórios e Equipe e a seção da recepção), tabela de textos das histórias (RN-519), guias com versão, CLAUDE.md (regras 1, 2 e 8) |
| PM-R13 | Avisar a sessão do Plano 25 (e as dos 21, 22 e 23, se ainda abertas): nada liberado à recepção, item de menu fora do menu dela, tipos de notificação fora de `TIPOS_DA_AGENDA`, funções com papel em `FUNCOES_COM_PAPEL`; ao 23, que `app_appointments_regras_pedido` passa a aceitar a recepção. Passo explícito na tarefa do banco, pela orquestradora |
| PM-R14 | Revisores por tarefa: `revisor-rls` (PR 2 inteiro, funções da RN-510, RN-506), `normas-cfn-lgpd` (termo, §10), `revisor-interface` (Relatórios, Equipe, convite, telas da recepção), `guardiao-manual` (fechamento) |
| PM-R15 | Telas liberadas à recepção conferidas uma a uma: links ao prontuário, leituras clínicas no meio da página (`consultaParaIniciarAtendimento`, `motivoDoCancelamentoDaNutri`), textos que só valem para a nutricionista ("Só você vê.") — lista na tarefa de cada tela (RE-D44) |
| PM-R16 | Manual guiado por papel antes de a recepção abrir qualquer página (RE-D42); `SEM_AJUDA` e `padrao` de cada página nova na mesma tarefa que cria a página (`conteudo.test.ts`); axe da recepção com a conta dela |

---

## 17. Referências

- Briefing: `/home/deploy/servidor/projetos/.sessoes/onda3-briefing.md` (Plano 26; numeração 480–519).
- Código (main 07756c4): `src/db/tenant.ts`, `src/db/rls-guard.ts`, `src/lib/session-rules.ts`, `src/lib/tenant-session.ts`,
  `src/lib/session.ts`, `src/db/schema/auth.ts`, `src/db/schema/access.ts`, `src/modules/plataforma/{convites,contas,audit,reiniciar-2fa,suspensao}.ts`,
  `src/modules/agenda/{consultas,presenca,disponibilidade,inicio}.ts`, `src/modules/pacientes/pacientes.ts`,
  `src/app/painel/{layout,page,navegacao}.tsx|ts`, `src/app/painel/pacientes/[id]/{layout.tsx,prontuario.ts}`,
  `drizzle/0000`, `0020`, `0051`, `0070`, `0083`, `0085`, `0119`, `0123`.
- Branches: `origin/plano-20-financeiro` (411f21d), `nutridebby-23` (80c55ed), `nutridebby-b` (67b21d3).
- Normas (conferidas pelo `normas-cfn-lgpd` em 17/11/2026): Res. CFN 599/2018, art. 20, I (texto completo) e art. 52
  (https://cfn.org.br/wp-content/uploads/resolucoes/Res_599_2018.html); Res. CFN 594/2017, arts. 2º, 3º, IV, e 4º, § 1º, I
  (https://cfn.org.br/wp-content/uploads/resolucoes/Res_594_2017.htm); Res. CFN 856/2026, arts. 22, 23, 36 e 66 (compilação
  não oficial da LegisWeb) e 858/2026 (vigência); LGPD (Lei 13.709/2018), arts. 5º, III, VI, VII e XIII, 6º, I, III e VI, 9º,
  11, 12, 37, 39, 46 e 47; MP 2.200-2/2001, art. 10, § 2º; Res. ANPD 15/2024, art. 6º; Lei 10.741/2003, art. 1º; Guia
  Orientativo para Definições dos Agentes de Tratamento e do Encarregado, versão 2.0 (ANPD, abr/2022; item a conferir no
  PDF oficial).


---

## 18. Revisão da spec (painel, 17/11/2026)

Três lentes sobre a v0.1: `revisor-rls` (banco, RLS e auditoria), `normas-cfn-lgpd` e `revisor-interface`. Cada achado
foi conferido no código da `main` 07756c4 (worktree `nutridebby-26`) e em `origin/plano-20-financeiro` (411f21d) antes de
entrar. Todo Critical e Important procedente entrou; Minor entrou quando era barato. Os descartes estão na §18.4.

### 18.1 Banco, RLS e auditoria

| Achado | Conferido em | O que mudou |
|---|---|---|
| C1 — trocar o e-mail dá à recepção o portal do paciente | `pacientes.ts:182-202` (o UPDATE grava `email` e reenvia o convite quando muda, `:198-200`); `convite-paciente.ts:234-299` (aceite com `p.email`; `vincularContaExistente`) | RE-D37; RN-508 (`email` fixo no UPDATE da recepção; sem convite na criação), RN-507 (sem `convite_paciente`), RN-515, US-491, §2.2, §3, §6.2, R-495 |
| I1 — paciente escondido deixa passar as guardas | `drizzle/0123_rls_financeiro.sql:82-85` (`IF v_status = 'bloqueado' …` com tudo nulo passa); `agenda/cancelamento.ts:73-79`; `0125:56-58` (`EXISTS`) | RE-D40; `recepcao_cond_paciente_visivel` em `patient_cadastro`, `appointments`, `notifications` e `fin_lancamentos`; `NOT FOUND` → 42501 no gatilho; falha fechada no módulo; §4.4 estendida às funções que leem `patients` |
| I2 — "corpo da 0051" é o velho | `drizzle/0070_paciente_sem_escrita.sql:39-50` | DEP-R2, RN-505, §9.3: corpo da 0070 (o último da `main` na regeneração); teste numa tabela de rascunho (RNF-484 j) |
| I3 — gatilho de `appointments` só no UPDATE | nenhum gatilho em `appointments` nas migrations (grep) | RN-509: BEFORE INSERT OR UPDATE com lista branca (RE-D41); §9.2 |
| I4 — lista negra no INSERT de `patients` | `src/db/schema/pacientes.ts:22,61-63` | RN-508: lista branca por `to_jsonb(NEW)` (RE-D41) |
| I5 — observação para a recepção | decisão (a spec já escondia o `motivo` por projeção) | RE-D38 (revê a RE-D24); gatilho `patient_cadastro_da_recepcao`; teste das chaves |
| I6 — relatório Pacientes diferente na sessão da recepção | política da RN-508 | RE-D39; RN-483, US-480, §6.2, R-497, RNF-484 (i) |
| I7 — semente do E2E | `scripts/e2e-seed.ts:142-232` (apaga cada `user` do E2E), `:61-66` (molde `E2E_FIN_NOVO`) | RE-D46; PM-R10, §13 |
| M1 — nomes das condições | — | `recepcao_cond_*`; a guarda exige RESTRICTIVE e o comando (RN-505, §4.3) |
| M2 — regex da guarda | a 0083 usa `current_setting('app.role'` | RN-511, §4.4 |
| M3 — `equipe_membros_regras` e `violaRlsDe` | `test/isolamento.test.ts:379` | §9.1: outros papéis `RETURN NEW` (a RLS recusa); a fábrica cria o `user` no mesmo comando |
| M4 — gatilho de `equipe_membros` e `invites_alvo` | — | §9.1 (`app_role` e `tenant_id` do `user`; trava na reativação), §9.2 (`invites_alvo` com `tenant_id`), RN-499, RN-503 |
| M5 — admin e as ativas | — | §3 (o admin não vê o número; §18.4) |
| M6 — laço da migration | — | §9.3 (`schemaname = 'public'`, `lock_timeout`), R-498 |
| M7 — "Faltou" com atendimento | `presenca.ts:41-44`, `atendimentos.ts:83` | coberto pelo gatilho da RN-509 (a saída de `realizada` é recusada) |
| M8 — opt-in do WhatsApp | `pacientes.ts:113-120` | RN-508: na sessão da recepção o módulo não chama `autorizacaoWhatsapp` |
| M9 — primeira data de todos os pacientes | — | RN-510 reduzida a `(appointment_id, retorno)` por consulta visível, 13 meses; RE-D27 |
| M10 — CS-480 promete mais | — | ressalva das tabelas sem RLS na CS-480 |
| M11 — `public_booking_requests` | spec do 23 | §4.3, §9.2: gatilho de colunas + projeção |
| M12 — colunas de `patients` | `src/db/schema/pacientes.ts:33-52` | RN-515, RNF-484 (h): teste das chaves |
| M13 — contratos e último acesso | `src/lib/auth.ts:94-115` (`session.create`) | §9.4 (CLAUDE.md, `preferencias.ts`), RE-D43, RN-516 |

### 18.2 Normas profissionais e LGPD

| Achado | O que mudou |
|---|---|
| C1 — observação e identidade de gênero | RE-D38 (projeção sem as duas, leitura e escrita); §10 "Dado sensível"; §6.2 (Equipe); o aviso no primeiro convite ficou sem objeto (§18.4) |
| I1 — citação do art. 20, I | §10, RE-D21, §17; pergunta da assinatura eletrônica na P-R2 |
| I2 — Res. 856/2026 | §10 (arts. 23, 36 e 66), P-R3, P-R4 |
| I3 — a recepção também grava | §10 "Prontuário", P-R1 |
| I4 — Ranking | RE-D36 revista: o Ranking é só da nutricionista |
| I5 — "tudo fica no Histórico" | §6.2 (Equipe), §10 "Segurança e registro" |
| I6 — conteúdo mínimo do termo | PM-R3; P-R2 |
| M1 — bloqueio | RE-D12, RE-D35; P-R5 |
| M2 — agregado ainda é dado pessoal | §10 "Relatórios" |
| M3 — "telenutrição" | §2.2 |
| M4 — "nunca o registro clínico" | §10 "Prontuário" e "Dado sensível" |
| M5 — Guia da ANPD | §10 "Papel na LGPD", §17 |
| M6 — termo do paciente | §10 "Termo do paciente e DPA" (frase para o backlog) |
| M7 — dica do convite | §6.2, US-488 |
| M8 — referências | §17 |

Os registros de memória que o `normas-cfn-lgpd` pediu (correção da linha da Res. 599 e as fontes novas) ficam com a
orquestradora: esta revisão só mudou os documentos do worktree `nutridebby-26`.

### 18.3 Interface

| Achado | Conferido em | O que mudou |
|---|---|---|
| I-1 — manual guiado sem papel | `src/modules/ajuda/conteudo.ts:428` (`guiaDaRota` só por caminho), `src/app/painel/guia/guia-do-painel.tsx` | RE-D42; RE-10, §4.2, §6.2, RN-514 |
| I-2 — tema e guia quebram; "Preferências" sem destino | `src/app/painel/preferencias/actions.ts:12,20,37` (`requireNutri`; sem `page.tsx`) | RN-513, §4.1, §4.2 |
| I-3 — páginas sem guia, `SEM_AJUDA` e axe | `conteudo.ts:348` (`configuracoes(/.*)?`), `src/app/painel/rotas-axe.test.ts` | §6.2 (`SEM_AJUDA`; `padrao` do `equipe` antes do `configuracoes`), RNF-481 (axe com a conta da recepção), PM-R16 |
| I-4 — links ao prontuário e motivo | `agenda/consultas/[id]/page.tsx:37,49-50`; `consultas.ts:278-279`; `cancelar-form.tsx:13`; `pacientes/page.tsx:117` | RE-D44; RN-509, US-491, US-492, PM-R15, R-499 |
| I-5 — "Sem permissão" com um texto só | — | RE-D47; §4.1, §6.2, RN-504, US-490, US-493 |
| I-6 — período | — | RE-D48; RN-481, US-486, §6.2 |
| I-7 — números mudam por papel | igual ao I6 do banco | RE-D39 |
| I-8 — `?ok=` não anunciado | — | §7.2, RNF-481 |
| I-9 — Segurança e acesso desativado | `src/app/conta/seguranca/page.tsx:12,28` | RE-D45; §4.1, §4.2, RN-503, US-489, US-490 |
| Minors | — | h1 "Seu dia, {nome}" (§4.1, RN-514); `itemAtual` do cadastro e "Manual" no `MenuConta` (§4.1); "Paciente (nome de registro)" (RN-492); "Ver versão para imprimir" e `<title>` (RN-495, US-487); barras com token (§7.1); Ranking por links com `aria-current` (§4.1); região focável e `outline-offset` (§7.1, RNF-481); mockup (0,0%, "60 anos ou mais") e "Menos de 18" na §6.2; "Peça à nutricionista" no Financeiro vazio (US-484); redirect do CSV (RN-480, RN-494); Equipe rolável, `<details>` aberto no erro, `aria-describedby` (§7.2); textos neutros (US-488, US-489, §6.2); `TextoLegalView`, axe de `/termos/sigilo-equipe` e `text-erro` (US-489, §6.2, RNF-481); enumeração registrada (R-496). `navegacao.test.ts` ("seis itens") e o passo do menu do guia `boas-vindas` entram na tarefa do menu (plano) |

### 18.4 Descartados

| Achado | Por quê |
|---|---|
| Banco C1 — selo "e-mail cadastrado pela recepção" | Pediria saber quem gravou o e-mail (coluna nova em `patients`, contra a C-485, ou leitura do `audit_log` na ficha) e só avisaria; sem convite automático e com a confirmação do e-mail antes de enviar, o selo não acrescenta proteção |
| Banco I6 / Interface I-7 — função `SECURITY DEFINER` de contagem | A recepção não precisa saber quantos bloqueados existem (RE-D35), e a função lhe daria um número que o bloqueio talvez suspenda (P-R5); ficou a outra opção dos dois achados (esconder a linha, com nota) |
| Banco M5 — agregado `SECURITY DEFINER` para o admin ver as ativas | Nenhuma tarefa do admin precisa do número; seria mais uma leitura de tabela com `tenant_id` para o admin, contra o espírito da regra 1 |
| Normas C1 — aviso obrigatório no primeiro convite | Sem objeto depois da RE-D38: a recepção não vê a observação, então não há o que revisar antes de convidar |
| Normas I4 — alternativa "Ranking na tela, sem CSV e impressão" | Ficou a primeira opção do achado (Ranking só da nutricionista), mais simples e sem lista nominal para a recepção |
| Interface I-1 — "variantes enxutas" dos guias `pacientes`, `agenda` e `financeiro` | Viraram guias próprios da recepção (`recepcao-*`, com `papeis`): progresso e versão separados, e os guias da nutricionista não mudam |
| Interface I-2 — criar a página "Preferências" | O tema já muda pelo botão do cabeçalho; bastam as duas actions com `requireEquipe` e tirar o item do menu |
| Interface I-4 — dica "Visível à nutricionista e à recepção." | A recepção não escreve nem lê o motivo (RE-D44): "Só você vê." continua verdadeiro |
| Interface Minor — "Exportou — Relatórios" no aviso do Ranking para a recepção | Sem objeto: a recepção não vê o Ranking |
| Interface Minor — menu da nutricionista em duas linhas a 1280 px | Aceito como está (o `flex-wrap` já existe); registrado na §4.1 |
### 18.5 Revisão do plano (v0.3, 17/11/2026)

Duas lentes sobre o plano e a spec v0.2: `revisor-rls` (0 Critical, 4 Important, 11 Minor) e o crítico de completude
(2 Critical, 9 Important, 12 Minor). Cada achado foi conferido no código da `main` 07756c4 (worktree `nutridebby-26`), em
`origin/plano-20-financeiro` (411f21d), em `plano-23-agenda-2` (`nutridebby-c`, 430a84d) e no `nutridebby-22`. O plano
recebeu as mudanças de execução; a spec, as de regra.

| Achado | Conferido em | O que mudou |
|---|---|---|
| Banco I1 — a recepção não responde pedidos do 23 | `plano-23-agenda-2:drizzle/0127_rls_agenda_2.sql:102-118` (aceite só `r = 'nutri'`; recusa só `('nutri','pedido_recusado')`); spec do 23, RN-424 (pessoa nova: paciente `agendamento_publico`, `consents`, opt-in `paciente`) | RE-D59: pedidos de paciente cadastrado com `app_appointments_regras_pedido` refeito na custom; pessoa nova com a nutricionista e `public_booking_requests` negada; §2.2, §3, §4.3, §4.4, §9.2, §9.3, RN-507, RN-509, US-492, RNF-484 |
| Banco I2 — guarda "Faltou com atendimento" aberta | `src/modules/agenda/presenca.ts:41-43` (busca em `consultations` com o tx da sessão) | RE-D62: `app_consulta_tem_atendimento` (RN-510), gatilho e módulo; §4.4 (regra geral para guardas de módulo), R-488, US-492 |
| Banco I3 — e-mail da recepção em envios automáticos | `documentos/entrega.ts:30-46`, `registrar-assinatura.ts:98`, `link-documento.ts:195`, `ia/autorizacao.ts:198,251` | RE-D60: confirmação antes de todo envio de link iniciado pela nutricionista; R-495, §6.2, US-491 |
| Banco I4 — E2E do primeiro acesso na 2ª execução | `scripts/e2e-seed.ts:61-66` (molde `E2E_FIN_NOVO`), `:109,202` (semente em `worker`) | RE-D69; RE-D46, PM-R10 |
| Banco Minor 1 — `lock_timeout` não cobre a gerada | `src/db/migrate.ts:9-13` (uma conexão, todas as pendentes) | RE-D64; §9.3, R-498 |
| Banco Minor 2 — condição por linha | — | `(SELECT app_recepcao_tem_financeiro())` (§4.3, RN-502, §9.2); CS-483 também na sessão da recepção (plano) |
| Banco Minor 3 / Completude M6 — enumeração do escondido | `pacientes.ts:101-103` (`comoDuplicado`), `cadastro.ts:273-281,315` (`CpfRepetidoError` com ou sem id) | RE-D65; R-496, US-491 |
| Banco Minors 4, 5, 6, 9 e Completude M1–M4, M7, M9, M12 | — | plano (guarda de fonte, fixture do isolamento, actions da Equipe desligada, testes); RN-513 (entradas fora do painel), guia `recepcao-cadastro` (§6.2) |
| Banco Minor 7 — volta atrás | — | runbook (plano): a imagem antiga já recusa a recepção em `requireUser`/`requireNutri` |
| Banco Minor 8 / Completude I5, M11 — coordenação e funções dos outros planos | `nutridebby-22/drizzle/0127_rls_exames_catalogo.sql:57,88` | §4.4 (linhas do 22, 23 e "planos depois do 26"), §13, PM-R1, PM-R13 |
| Banco Minor 10 — Ranking por receita fora do módulo | RN-491 | RE-D68: `receitaPorPaciente` em `resumo.ts`; RN-491, RN-492 |
| Completude C1 — a recepção não entra | `src/app/entrar/page.tsx:44`, `entrar/2fa/page.tsx:29`, `conta/seguranca/enable-2fa.tsx:67`, `inicio/page.tsx:8`, `conta/outro-papel/page.tsx:12,20` | RE-D67; §4.1, §4.2, RN-513 |
| Completude C2 — `/api/sessao/ativa` | `src/app/api/sessao/ativa/route.ts:9` | RE-D67; RN-501 |
| Completude I1 — "Cobrança" contraditória | `origin/plano-20-financeiro:src/modules/financeiro/cobranca.ts:130,161`; `consultas/[id]/cobranca-actions.ts` | RE-D61; RN-506, RN-509, US-492, PM-R9 |
| Completude I2 — mitigação do R-482 | `pacientes/novo/page.tsx:2,13` (`situacaoDoWhatsapp`), `pacientes/page.tsx:6,36` (etiquetas) | RNF-484 (e), R-482 |
| Completude I3 — "Novo paciente" sem variante | `pacientes/paciente-form.tsx:126,150-162` | plano (T9) |
| Completude I4 — previsões de retorno e colunas da Agenda sem teste | RN-490, US-483 | plano (T2 e T11a) |
| Completude I5b — links ao prontuário nas outras telas da agenda | PM-R15 | plano (T10, teste por página) |
| Completude I6 — capítulos do manual técnico | `docs/manual-tecnico/03-autenticacao-e-acesso.md` (§3.2, §3.6, §3.7, §3.10), `04-modulos-clinicos.md` (§4.1.1, §4.1.6), `07-…` | RE-10, PM-R12 |
| Completude I7 — manual do usuário, Central e textos das histórias | memória do projeto; `2026-09-27-nutridebby-mvp-historias.md` | RE-10, PM-R12, RN-519 |
| Completude I8 — tarefas grandes | — | RE-D66 (T5a/T5b, T11a/T11b) |
| Completude M5 — Segurança da conta desativada | — | RN-503, §4.1 |
| Completude M8 — guias no PR 1 | — | §6.2 (`relatorios` v1 sem o local; v2 no PR 3); plano (`boas-vindas` no PR 1) |
| Completude M10 — faltas no Início × Relatórios | — | RE-D63; RN-514 |

**Descartados**

| Achado | Por quê |
|---|---|
| Banco I1, segunda opção — a recepção aceita pessoa nova por um marcador local | Ficou a primeira (pessoa nova com a nutricionista, RE-D59): o marcador abriria INSERT de paciente fora da lista branca, escrita em `consents` (exceção de RLS) e o opt-in de origem `paciente`, três peças a mais para revisar, e o 23505 do e-mail de paciente bloqueado continuaria a revelar o escondido |
| Banco I3, segunda opção — segurar a entrega por link até a nutricionista confirmar o e-mail | Pediria estado novo por paciente (coluna em `patients`, contra a C-485) e mudaria a entrega dos documentos para todo paciente; a confirmação no envio (RE-D60) cobre o caso |
| Banco Minor 10 — "a extensão `unaccent` não existe" | Existe: `CREATE EXTENSION IF NOT EXISTS unaccent` (`drizzle/0000_base_roles_e_rls.sql:5`), com `app_unaccent` (0040) e uso em `pacientes.ts:301`. Fica o `app_unaccent` (RE-D68), sem `translate` |
| Banco Minor 11, opcional — condição `app_recepcao_ativa()` em toda tabela liberada | A desativação apaga as sessões na mesma transação e o `requireEquipe` lê a linha a cada requisição; a condição pediria mais uma política por tabela liberada para um caso que exige sessão viva que já não existe. A parte principal do achado (`convidada_por`/`desativada_por` sem FK) já é a §9.1 |
| Completude I1, segunda opção — Cobrança com `exigirFinanceiro` | Ficou a primeira (nunca aparece, RE-D61): a cobrança da consulta nasce de "Realizada", que é da nutricionista |
| Completude I8 — dividir a T10 por módulo | A T10 é um ramo por papel com uma lista fechada (`FUNCOES_DA_RECEPCAO`) e um teste de fonte; dividir por módulo duplicaria a lista e o teste. Fica uma tarefa, com o teste por página da agenda |

**RE-D72 resolvida (24/11/2026):** o dono aprovou o texto do termo `sigilo-equipe-1.0` com as recomendações da orquestradora (PM-R3). O merge do PR 2 não espera mais esse OK.
