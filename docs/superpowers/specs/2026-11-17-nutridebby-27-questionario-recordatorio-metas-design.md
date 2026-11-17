# NutriDebby — Questionário pré-consulta, recordatório e metas (Plano 27) — Design

| Item | Valor |
|---|---|
| Versão | 0.1 (17/11/2026: proposta inicial, ainda sem o painel de revisão — `revisor-rls`, `normas-cfn-lgpd`, `revisor-interface` e crítico de completude) |
| Data | 2026-11-17 |
| Situação | **Rascunho; decisões delegadas pelo dono (onda 4).** O dono autorizou seguir as recomendações sem parar para perguntar (`.sessoes/onda4-briefing.md`): cada decisão de produto está na §14 como "QP-Dn — decisão — porquê". Conferida contra o código da `main` 07756c4 (última migration: `0125_rls_patient_cadastro.sql`) e contra os worktrees dos Planos 19 a 26 (§13) |
| Itens do backlog | Paridade Dietbox, onda 4: **PD-110** (questionário pré-consulta), **PD-111** (recordatório alimentar de 24 horas), **PD-112** (metas do paciente) |
| Quando | **Plano 27**, em paralelo com os Planos 28 (`nutridebby-28`) e 29 (`nutridebby-29`), depois dos Planos 19 a 26 que ainda estiverem abertos. Regras de convivência em `docs/operacao/sessoes-paralelas.md` |
| Insumos | `.sessoes/onda4-briefing.md` (seção do Plano 27); levantamento do código (§1.3); specs dos Planos 17, 18, 19, 23, 25 e 26. Referência funcional: questionário, recordatório e metas do Dietbox. **Copiamos a função, nunca a marca, os textos, o layout ou o conteúdo** (nenhum questionário, pergunta ou meta pronta de lá; os textos iniciais desta spec são nossos) |
| Documentos de base | [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md) (US-012 anamnese, US-022 cálculo do plano, US-042 diário), [`2026-11-13-nutridebby-lembretes-de-rotina-design.md`](2026-11-13-nutridebby-lembretes-de-rotina-design.md) (Plano 17), [`2026-11-16-nutridebby-18-ficha-cadastro-design.md`](2026-11-16-nutridebby-18-ficha-cadastro-design.md) (D12, D14, D16, RN-277), spec do Plano 19 (`nutridebby-b`: catálogo de nutrientes, `lerCongelados`, fontes), spec do Plano 26 (`nutridebby-26`: papel `recepcao`, RN-505, RN-511) |
| Numeração nova | US-520 a US-531 · RN-520 a RN-559 · RNF-520 a RNF-525 · CS-520 a CS-524 · C-520 a C-527 · R-520 a R-534 · DEP-Q1 a DEP-Q10 · PM-Q1 a PM-Q12 · **QP-D1 a QP-D32** (decisões deste documento; fora dele, cite "Plano 27, QP-Dn"). O bloco **520–559** é do Plano 27 pelo briefing da onda 4 (o 23 vai até 439, o 25 usa 440–479, o 26 usa 480–519). Conferido em 17/11/2026 com `grep -rhoE '\b(US\|RN\|RNF\|CS\|R\|C)-5[2-5][0-9]\b'` em todos os worktrees `nutridebby*`: nada usado |

---

## 1. Visão

Hoje a nutricionista preenche a anamnese na consulta (US-012), monta o plano com cálculo de energia e nutrientes
(US-022) e configura lembretes por push (Plano 17). Faltam três coisas que encurtam a consulta e dão continuidade ao
tratamento:

1. **Questionário pré-consulta (PD-110).** A nutricionista monta modelos de questionário com o **mesmo motor da
   anamnese** (`anamnesis_templates`, 7 tipos de pergunta, `validarModelo`/`validarRespostas`) e envia ao paciente antes
   da consulta, ligado ao agendamento — à mão, pela consulta ou pela ficha, ou sozinho, pelo worker. O paciente responde
   no app (com login) ou pelo link do e-mail (sem login). As respostas ficam no prontuário, fiéis ao que o paciente
   relatou, e a nutricionista pode copiá-las para uma anamnese.
2. **Recordatório alimentar de 24 horas (PD-111).** A nutricionista registra na ficha o que o paciente comeu no dia
   anterior, refeição a refeição, com os alimentos das tabelas (TACO, USDA e "Meus alimentos", Plano 19) e a **mesma
   conta** do plano (`calculo.ts`): energia, macronutrientes, fibra e micronutrientes, comparados com a meta do plano e
   com o gasto energético.
3. **Metas do paciente (PD-112).** Modelos de meta do consultório ("Beber 2 L de água por dia"), atribuição ao paciente e
   acompanhamento no app com um **registro diário** ("Cumpri" / "Não cumpri"). A meta conversa com os lembretes do
   Plano 17 por um atalho, sem push própria.

Nada disso abre aba nova na ficha (13 abas; R-266 do Plano 18): o questionário e o recordatório entram na aba
**Anamnese** (são a "anamnese alimentar e nutricional" e o "inquérito de consumo alimentar" da Res. CFN 594/2017, art. 4º,
§ 1º, IV), e as metas, na aba **Plano alimentar**, logo acima de "Lembretes no app".

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-520 | O paciente responde um questionário de 12 perguntas pelo link do e-mail **sem criar conta e sem login**, e as respostas aparecem na ficha na hora | E2E: envio → link → envio das respostas → aba Anamnese › Questionários com "Respondido" |
| CS-521 | **Zero** resposta, nome de modelo de questionário, nome de alimento do recordatório ou título de meta em push, e-mail, URL, log, Sentry ou `audit_log` | Testes das chaves (push e e-mail), do log (`logs.test.ts`) e do `audit_log` (só id, titular, ator e IP, `0007`) |
| CS-522 | O total do recordatório é **idêntico** ao que o editor do plano daria para os mesmos itens e gramas | Teste de unidade: os mesmos itens em `totalDosItens` (plano) e em `totalDoRecordatorio` dão o mesmo `Nutrientes` |
| CS-523 | O paciente registra a meta do dia em **1 toque** na página Hoje do app | E2E no portal a 360 px: "Cumpri" grava, anuncia e fica marcado |
| CS-524 | A sessão `recepcao` (Plano 26) e o contexto `publico` **não leem nem gravam** nenhuma das tabelas novas | Teste de isolamento com os dois contextos (`recepcao_negada`, `publico_negado`) |

### 1.2 Premissas e restrições

| # | Premissa / restrição | Origem |
|---|---|---|
| C-520 | Só documentos nesta etapa; código, migrations e testes vêm no plano | Briefing da onda 4 |
| C-521 | **Sem custo novo e sem serviço externo**: e-mail pelo transporte que já existe, push pelo Web Push que já existe; nada de WhatsApp novo (cada mensagem do WhatsApp pede modelo aprovado e conta na cota) | Memória "No extra costs"; QP-D11 |
| C-522 | **Nenhuma aba nova** na ficha e **nenhum item novo no menu** do painel; telas novas da biblioteca vão em Configurações | Plano 18, D12 e R-266; mesmo combinado dos Planos 19, 21, 22, 23 e 25 |
| C-523 | **Somente adultos** (RN-17): quem responde o questionário é o próprio titular | MVP D-11 |
| C-524 | Migrations **sem número reservado**, geradas de novo sobre a `main` antes do PR (`sessoes-paralelas.md` §5); um só PR com migration (QP-D27) | Briefing; PD-01 |
| C-525 | Arquivos disputados só recebem acréscimos (`rls-guard.ts`, `audit-guard.ts`, `isolamento.test.ts`, `CLAUDE.md`, `navegacao.ts`, `queues.ts`, `worker/index.ts`, CHECK `notifications_tipo_valido`, `SECOES_DA_FICHA`, `CARTOES`) | `sessoes-paralelas.md` §6 |
| C-526 | **Nada de saúde vai à IA** por este plano (RN-109: mudar "o que é enviado" pede versão nova da autorização) | Plano 14A; QP-D24 |
| C-527 | O recordatório **depende do Plano 19** na `main` (fontes, catálogo de micronutrientes e `lerCongelados`) | QP-D14 |

### 1.3 Dependências (conferidas no código em 17/11/2026, `main` 07756c4)

| ID | O quê | Onde | Situação |
|---|---|---|---|
| DEP-Q1 | **Motor da anamnese** | `src/db/schema/pacientes.ts:246-297` (`anamnesis_templates`, `anamneses`); `src/modules/pacientes/anamnese-tipos.ts` (`TIPOS_PERGUNTA`, `ModeloSchema`, `SnapshotModelo`, `validarModelo`, `validarRespostas`, `MSG_ANAMNESE`); `src/modules/pacientes/anamnese.ts` (`garantirModeloPadrao`, `listarModelos`, `listarModelosUsaveis`, `buscarModeloUsavel`, `salvarModelo`, `arquivarModelo`, `preencherAnamnese`, `listarAnamneses` com `auditRead` da lista); editor em `src/app/painel/anamnese/modelos/` | ✅ RLS: `0026_rls_anamnese.sql` — `anamnesis_templates` só `app_enable_tenant_rls` (sem `staff_only`: a sessão de paciente lê os modelos do consultório hoje, QP-D25); `anamneses` com tenant, paciente e auditoria (`anamnese`). Índice único `anamnesis_templates_padrao_idx (tenant_id) where padrao`. Gatilho `anamnesis_templates_ia_origem` (0112, Plano 14B) |
| DEP-Q2 | **Cálculo do plano** | `src/modules/plano-alimentar/calculo.ts` (puro: `nutrientesDoItem`, `totalDosItens`, `distribuicaoMacros`, `indicadorMeta`, `kcalTexto`, `gTexto`, `quantidadeDoItem`); `meta.ts` (`contextoDoPaciente`: peso da última antropometria e cálculos de GET, já auditados); `NutrientesCongelados` em `src/db/schema/plano-alimentar.ts:10`; `publicarPlano` congela os nutrientes com `UPDATE … FROM foods` (`publicacao.ts:37`) | ✅ |
| DEP-Q3 | **Alimentos** | `foods`, `food_measures` (`src/db/schema/alimentos.ts`), `BuscaAlimento`, `src/modules/alimentos/busca.ts` (`Nutrientes100`), medidas caseiras (`medidas.ts`). **Plano 19** (`nutridebby-b`, PR #57): `foods.fonte`, USDA, catálogo `src/modules/alimentos/nutrientes.ts`, `NutrientesCongelados` com `fonte`/`micros`, `lerCongelados`, `DialogoBuscaAlimento` | ✅ na `main` (TACO); 19 em PR |
| DEP-Q4 | **Agenda** | `appointments` (`src/db/schema/agenda.ts:52`): `status` (`agendada`, `confirmada`, `cancelada`, `realizada`, `faltou`; o 23 acrescenta `solicitada`), `remarcada_de`, UNIQUE `appointments_tenant_paciente_id_unique (tenant_id, patient_id, id)`; página da consulta `src/app/painel/agenda/consultas/[id]/page.tsx` | ✅ |
| DEP-Q5 | **Avisos ao paciente** | `notifications` (CHECK `notifications_tipo_valido`, `notifications_versao_da_consulta`); push sem consulta por `AVISOS_DO_PORTAL` (`src/modules/notificacoes/mensagens.ts:110`, texto neutro + tela); e-mail por `enqueueEmail` (`src/email/queue.ts:14`) com modelos em `src/email/types.ts` e `templates.tsx` | ✅ |
| DEP-Q6 | **Link sem login** | Molde sem estado com MAC do e-mail atual: `src/modules/ia/autorizacao-token.ts` (Plano 14A, sem código de 6 dígitos), `src/modules/documentos/link-documento.ts` (com código). `SEM_CONTA_PERMITIDOS` (`src/db/tenant.ts:39`) e `sem-conta-guarda.test.ts`; limite por IP em `src/modules/agenda/limite-ip.ts` (`public_rate_limits`) | ✅ |
| DEP-Q7 | **Ficha (Plano 18)** | `src/modules/ficha/tipos.ts` (`SecaoDaFicha`, `noApp`, `adicionar`, `verTodos`, grupos `avaliacoes`/`prescricoes`/`outros`); `secoes/index.ts` (`SECOES_DA_FICHA`, 8 seções); `abas.tsx` (13 abas, "uma 14ª aba não cabe"; subrotas ativam a aba pelo `startsWith`) | ✅ |
| DEP-Q8 | **Lembretes (Plano 17)** | `lembretes_rotina` (`tipo` em `agua`, `refeicoes`, `suplemento`, `livre`), seção `SecaoLembretes` na aba Plano alimentar (`plano-alimentar/lembretes/secao.tsx`, âncora `lembretes-app-titulo`), textos fixos do push (`TEXTOS_PUSH`) | ✅ |
| DEP-Q9 | **Portal (Plano 16)** | `SECOES_DO_PORTAL` (`src/app/p/navegacao.ts`: Hoje, Jornada, Plano, Exames, Eu; `tambem`); Hoje em `src/app/p/(portal)/inicio/page.tsx` (duas transações: mural e `faixaDeHoje`); leituras do portal chamam `auditRead` (ex.: `lembretes/paciente.ts:80`) | ✅ |
| DEP-Q10 | **LGPD** | `exportacao-job.ts` (`dados.json`, `prontuario.pdf`, dois escopos), `lgpd.ts` (bloqueio, anonimização, varredura); `audit.ts` (`ENTIDADE_ROTULO`); guardas `rls-guard.ts` (`STAFF_ONLY`, `PACIENTE_ESCREVE`, `PUBLICO_LIBERADO`), `audit-guard.ts`, `test/isolamento.test.ts` (`FABRICAS`, `COM_MAE`, `SEM_DELETE`, `DELETE_REVOGADO`, `IMUTAVEIS`, `SO_INSERE`, `UPDATE_DO_PACIENTE`, `SO_APAGA`) | ✅ |

---

## 2. Escopo

### 2.1 Dentro

| ID | Bloco | Conteúdo |
|---|---|---|
| PD-110 | Questionário pré-consulta | Modelos (`anamnesis_templates` com `finalidade = 'questionario'`, editor reaproveitado, rota `/painel/questionarios`); questionário inicial pronto (QP-D3); envio manual pela ficha e pela consulta; envio automático pelo worker (um modelo por consultório, N dias antes); aviso por e-mail com link e push neutro; resposta no app e pelo link; respostas no prontuário (`questionario_envios`), "Copiar para uma anamnese"; validade, cancelamento, remarcação; seção "Questionários" no Início da ficha |
| PD-111 | Recordatório 24 h | `recordatorios` + `recordatorio_itens`; formulário por refeição com busca de alimento e medida caseira; nutrientes congelados ao salvar; totais, % do VET, g/kg, comparação com a meta do plano publicado e com o último GET; micronutrientes do catálogo do Plano 19; seção "Recordatórios" no Início |
| PD-112 | Metas | Biblioteca do consultório (`metas_modelos`, `staff_only`) com sugestões nossas por botão; metas do paciente (`metas_paciente`); registro diário pelo paciente (`metas_registros`, hoje e ontem); acompanhamento no painel (7 dias e adesão de 30 dias); card "Metas de hoje" e página `/p/metas` no app; atalho para os lembretes do Plano 17; seção "Metas" no Início |
| — | Fechamento | LGPD (exportação, bloqueio, anonimização), guardas, manual guiado (guias novos e versões), manual técnico, manual do usuário (Docs), Central de Ajuda, `CLAUDE.md` (regras 2 e 8) |

### 2.2 Fora

- **Questionário respondido pela recepção ou pela nutricionista "em nome do paciente"**: na consulta, a nutricionista usa a anamnese.
- **Rascunho do questionário no servidor** e retomada em outro aparelho (QP-D7).
- **Lembrete de cobrança** do questionário não respondido e envio pelo **WhatsApp** (QP-D11; backlog).
- **Questionário na página pública** de agendamento (`/n/<slug>`) e para pessoa ainda sem cadastro.
- **Formulário em branco para imprimir**: Plano 29 (PD-125).
- **Recordatório preenchido pelo paciente** no app (o diário alimentar já cobre o registro do paciente, US-042) e
  "Gerar recordatório a partir do diário" (backlog).
- **Recordatório de vários dias**, questionário de frequência alimentar (QFA) e "Usar o recordatório como base do plano".
- **Metas com quantidade** ("bebi 1,5 L"), por dia da semana, com gráfico longo, pontos, medalhas ou ranking (QP-D20).
- **Push próprio de meta** e vínculo de meta com lembrete no banco (QP-D21).
- **IA**: resumo do questionário, sugestão de metas ou leitura do recordatório pela IA (C-526; backlog com versão nova da autorização).
- Avaliações tipo "DB360": decisão do Plano 29 (PD-126).

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** (sessão `nutri`) | Criar, editar e arquivar modelos de questionário e de meta; ligar o envio automático; enviar, cancelar e reenviar questionário a paciente `ativo`; ver respostas (auditado); copiar para uma anamnese; criar e editar recordatórios de paciente `ativo` ou `arquivado`; atribuir, editar e encerrar metas; ver os registros diários (auditado) | Mudar as respostas do paciente (imutáveis, RN-529); marcar meta em nome do paciente (RN-547); apagar envio, recordatório ou registro de meta (QP-D17); enviar questionário a paciente arquivado, bloqueado ou anonimizado |
| **Paciente com login** (sessão `paciente`) | Ver os próprios questionários abertos e respondê-los uma vez; ver as próprias respostas (auditado); ver as metas ativas e registrar "Cumpri"/"Não cumpri" de hoje e de ontem, e trocar o registro nesses dois dias | Ver o rascunho, o modelo ou a configuração do consultório; ver recordatórios no app (só na exportação, QP-D16); registrar meta encerrada ou dia fora da janela; apagar registro |
| **Paciente sem login** (`semConta`, link do e-mail) | Abrir o questionário daquele link e responder uma vez | Ver respostas já enviadas (a página nunca as mostra, QP-D6); ver qualquer outra coisa do prontuário |
| **Recepcionista** (sessão `recepcao`, Plano 26) | Nada novo. As consultas que ela marca recebem o questionário automático pelo worker (QP-D12) | Ler ou gravar as tabelas novas e `anamnesis_templates` (`recepcao_negada`, RN-505 do 26); ver o bloco "Questionário pré-consulta" da consulta |
| **Público** | — | Tudo (`publico_negado`; nenhuma tabela nova em `PUBLICO_LIBERADO`) |
| **Worker** | Envio automático; avisos (e-mail e push); expirar e cancelar envios; levar o envio aberto para a consulta remarcada; exportação | Gravar respostas, recordatório ou registro de meta |
| **Admin** | — (nada novo) | Ver dado de paciente (como hoje) |

---

## 4. Arquitetura

### 4.1 Rotas e navegação

| Rota | O quê | Situação |
|---|---|---|
| `/painel/questionarios` | **Questionários pré-consulta**: lista dos modelos de questionário, "Novo questionário" e o cartão "Envio automático" | Nova |
| `/painel/questionarios/novo`, `/painel/questionarios/[modeloId]` | Editor (o `ModeloEditor` da anamnese, com o campo "Texto de abertura") | Nova |
| `/painel/metas`, `/painel/metas/novo`, `/painel/metas/[modeloId]` | **Modelos de metas** e "Incluir sugestões" | Nova |
| `/painel/pacientes/[id]/anamnese` | Ganha a navegação "Anamneses · Questionários · Recordatórios" (links com `aria-current="page"`, `nav aria-label="Seções da anamnese"`, como as abas da agenda e do Financeiro) | Muda |
| `/painel/pacientes/[id]/anamnese/questionarios` | Lista dos envios do paciente e o formulário "Enviar questionário" (âncora `#enviar`) | Nova |
| `/painel/pacientes/[id]/anamnese/questionarios/[envioId]` | Respostas (auditado), "Copiar para uma anamnese", "Cancelar envio", "Reenviar" | Nova |
| `/painel/pacientes/[id]/anamnese/recordatorios`, `/novo`, `/[recordatorioId]` | Lista, novo e edição do recordatório | Nova |
| `/painel/pacientes/[id]/plano-alimentar` | Seção **"Metas"** (âncora `metas-titulo`) antes de "Lembretes no app" | Muda (uma linha em `page.tsx`) |
| `/painel/pacientes/[id]/plano-alimentar/metas/[metaId]` | Registro dos últimos 30 dias de uma meta (auditado), editar, encerrar | Nova |
| `/painel/agenda/consultas/[id]` | Bloco **"Questionário pré-consulta"** (só sessão `nutri`) | Muda |
| `/questionario/[token]` | Resposta pelo link do e-mail, sem login (fora do `/p`, como `/documento/[token]` e `/autorizacao-ia/[token]`) | Nova |
| `/p/questionarios/[envioId]` | Resposta no app (e "Minhas respostas" depois de respondido) | Nova; marca a seção **Jornada** (`tambem`) |
| `/p/metas` | Metas ativas, os 7 últimos dias e o registro de ontem | Nova; marca a seção **Plano** (`tambem`) |
| `/p/inicio` (Hoje) | Cards "Questionário para responder" e "Metas de hoje" | Muda |

- **Abas da ficha** (`abas.tsx`) e **menu do painel** (`navegacao.ts`) **não mudam** (C-522). As subrotas
  `anamnese/questionarios` e `anamnese/recordatorios` ficam dentro da aba Anamnese pelo `startsWith`; cada página nova
  tem "Voltar para Anamnese".
- **Configurações** (`CARTOES`, só acrescentar no fim): **"Questionários pré-consulta"** · "Perguntas que o paciente
  responde antes da consulta." e **"Modelos de metas"** · "Metas prontas para dar aos pacientes."
- **Portal** (`navegacao.ts`, só acrescentar ao `tambem`): `'/p/questionarios'` em Jornada (é da consulta) e `'/p/metas'`
  em Plano. Nenhuma seção nova na faixa.

### 4.2 Módulos

| Arquivo | Conteúdo |
|---|---|
| `src/modules/pacientes/anamnese-tipos.ts` | `ModeloSchema` ganha `introducao?: string` (só em questionário, 1–600, RN-521); `validarModelo` recebe a finalidade. `validarRespostas` sem mudança (é a conferência do questionário também) |
| `src/modules/pacientes/anamnese.ts` | Todas as leituras e escritas de modelo de **anamnese** filtram `finalidade = 'anamnese'` (`listarModelos`, `listarModelosUsaveis`, `buscarModelo`, `buscarModeloUsavel`, `preencherAnamnese`, `salvarModelo`, `arquivarModelo`, `garantirModeloPadrao`); `copiarDoQuestionario` (RN-531) |
| `src/modules/questionarios/` (novo) | `modelos.ts` (lista, salvar, arquivar, `garantirQuestionarioPadrao`, `configurarEnvioAutomatico`), `envios.ts` (enviar, cancelar, reenviar, listar, abrir — `auditRead`), `paciente.ts` (abertos do paciente, abrir para responder, responder, minhas respostas), `link.ts` (token sem estado, abrir e responder pelo link, `semConta`), `automatico-job.ts` (worker), `constantes.ts` (textos, limites; sem import de servidor), `questionario-padrao.ts` |
| `src/modules/recordatorio/` (novo) | `calculo.ts` (puro: `totalDoRecordatorio`, `porRefeicao`, reusa `nutrientesDoItem`/`distribuicaoMacros`/`indicadorMeta` do plano e a soma de micros do Plano 19), `recordatorios.ts` (criar, editar, listar, abrir — `auditRead`), `constantes.ts` |
| `src/modules/metas/` (novo) | `modelos.ts` (biblioteca, sugestões), `equipe.ts` (atribuir, editar, encerrar, listar com os 7 dias, detalhe de 30 dias — `auditRead`), `paciente.ts` (metas de hoje, registrar, `/p/metas` — `auditRead`), `constantes.ts`, `sugestoes.ts` |
| `src/modules/ficha/secoes/` | `questionarios.ts`, `recordatorios.ts`, `metas.ts` + três linhas no fim de `SECOES_DA_FICHA` (RN-555) |
| `src/modules/notificacoes/` | Tipo `questionario_novo` em `TipoNotificacao`, `ROTULO_TIPO` e `AVISOS_DO_PORTAL` (push sem consulta) |
| `src/email/` | Modelo `questionario_link` em `types.ts` e `templates.tsx` |
| `src/jobs/queues.ts`, `src/worker/index.ts` | Fila `questionarios-automaticos` (agendada a cada 30 min) |
| `src/modules/pacientes/lgpd.ts`, `exportacao-job.ts`, `prontuario-pdf.tsx` | §10 |
| `src/db/tenant.ts` | `SEM_CONTA_PERMITIDOS` + `src/modules/questionarios/link.ts` |

### 4.3 Fluxo do questionário

```
nutricionista (ficha ou consulta)          worker (a cada 30 min)
        │ enviarQuestionario                      │ questionarios-automaticos (RN-533)
        └──────────────┬──────────────────────────┘
                       ▼
   questionario_envios (situacao 'enviado', snapshot do modelo, expira_em)
        │ na mesma transação: enqueueEmail('questionario_link', link assinado) + notifications 'questionario_novo' (push)
        ▼
   paciente: /p/questionarios/{id} (login)  ou  /questionario/{token} (sem login, semConta)
        │ responderQuestionario: validarRespostas(snapshot) → UPDATE pela sessão do paciente
        ▼   (gatilho questionario_envios_regras: enviado → respondido, uma vez, antes de expira_em)
   situacao 'respondido' → ficha: Anamnese › Questionários › respostas (auditRead) → "Copiar para uma anamnese"
```

- **Vida do envio:** `enviado` → `respondido` (paciente) · `enviado` → `cancelado` (nutricionista; worker quando a
  consulta é cancelada; bloqueio do titular) · `enviado` → `expirado` (worker, depois de `expira_em`). `respondido`,
  `cancelado` e `expirado` são finais.
- **Por que o envio guarda as respostas** (e não a `anamneses`): QP-D4.

### 4.4 Cálculo do recordatório

- Cada item tem alimento (`food_id`), quantidade em gramas e medida caseira como no plano (`medida`, texto da medida);
  ao salvar, o servidor lê os valores por 100 g do alimento **visível ao consultório** (TACO/USDA públicas ou "Meu
  alimento" do próprio tenant, RLS de `foods`) e **congela** em `recordatorio_itens.nutrientes` no formato
  `NutrientesCongelados` do Plano 19 (com `fonte`, `fonteVersao` e `micros`), no mesmo molde do `UPDATE … FROM foods`
  de `publicarPlano`. Editar o "Meu alimento" depois não muda um recordatório já salvo (fidelidade do prontuário).
- `src/modules/recordatorio/calculo.ts` é **puro** e chama as funções do plano: total do dia = soma de todos os itens
  com nutrientes (no recordatório não há substituição), contando os itens sem valor na tabela (`semValor`, como no
  plano) e os itens **sem cadastro** (só descrição, sem cálculo).
- Exibição: kcal inteiro, gramas com 1 casa (`kcalTexto`, `gTexto`); % do VET e g/kg (`distribuicaoMacros`, peso da
  última antropometria); comparação com a **meta do plano publicado** (`indicadorMeta`: verde ≤ 5 %, amarelo ≤ 10 %,
  vermelho > 10 %, com o rótulo em texto) e com o **último cálculo de GET** (diferença em kcal, sem cor). Micronutrientes
  em "Ver todos os nutrientes", pelo catálogo do Plano 19, com "{n} itens sem valor na tabela" quando houver.

### 4.5 Metas e registro diário

- `metas_modelos` é a biblioteca do consultório (`staff_only`). Atribuir copia título, descrição e categoria para
  `metas_paciente` (a meta do paciente não muda se o modelo mudar).
- O paciente registra **um** valor por meta e dia (`cumprida` verdadeiro ou falso) para **hoje ou ontem** no fuso do
  consultório, só de meta ativa e dentro do período da meta; pode trocar o valor nesses dois dias; não apaga.
- O painel mostra, por meta, os **7 últimos dias** (Cumpriu / Não cumpriu / Sem registro, em texto e ícone) e a
  adesão dos **30 últimos dias** ("Cumpriu em 18 de 25 dias registrados").
- **Lembretes:** o modelo pode sugerir um tipo de lembrete do Plano 17 (`lembrete_sugerido`); a seção Metas mostra
  "Criar lembrete de água" (ou o tipo sugerido), que leva à seção "Lembretes no app" logo abaixo (`#lembretes-app-titulo`).
  Não há vínculo no banco nem push próprio (QP-D21).

### 4.6 Ficha do paciente

Três seções novas pelo registro do Plano 18 (`SecaoDaFicha`), sem conteúdo clínico (D14 do 18): nem o nome do modelo
de questionário ("Questionário gestante" diz uma condição), nem alimento, nem título de meta ("Perder 5 kg").

| Seção | `id` · `titulo` | Itens (rótulo · situação) | `aba` / `verTodos` | `adicionar` | `noApp` |
|---|---|---|---|---|---|
| Questionários | `questionarios` · "Questionários" | "Questionário" · "Aguardando resposta" / "Respondido" / "Vencido" / "Cancelado" | `anamnese/questionarios` | `avaliacoes`: "Questionário pré-consulta" → `anamnese/questionarios#enviar` | Envios `enviado` não vencidos e de consulta não cancelada, contados no contexto de paciente (RN-556) |
| Recordatórios | `recordatorios` · "Recordatórios 24 h" | "Recordatório" · — (data = dia relatado) | `anamnese/recordatorios` | `avaliacoes`: "Recordatório 24 h" → `anamnese/recordatorios/novo` | — (o paciente não vê no app) |
| Metas | `metas` · "Metas" | "Meta" · "Ativa" / "Alcançada" / "Encerrada" | `verTodos`: `/painel/pacientes/{id}/plano-alimentar#metas-titulo` | `prescricoes`: "Meta" → `plano-alimentar#nova-meta` | Metas `ativa` dentro do período |

### 4.7 Portal

- **Hoje**: com questionário aberto, o card **"Questionário para responder"** fica no topo do `main` (antes do guia), um
  por envio aberto; com metas ativas, o card **"Metas de hoje"** fica depois dos cartões do aparelho. As duas leituras
  entram na transação de `faixaDeHoje` (P08-13: Hoje continua com duas transações), com um `auditRead` de `metas` só
  quando há metas e nenhum para o card do questionário (só id, data da consulta e situação; RN-538).
- **`/p/questionarios/[envioId]`**: formulário com as perguntas do snapshot, os mesmos controles da anamnese
  (`anamnese-form.tsx` adaptado ao portal: alvos ≥ 44 px, `fieldset`/`legend` nas escolhas, erro junto do campo e
  resumo no topo com links). Depois de respondido, "Suas respostas" em leitura (auditado).
- **`/p/metas`**: metas ativas com os 7 últimos dias e os botões de hoje e de ontem.
- **Cache do service worker**: as três rotas e as APIs novas são **só rede**, nunca guardadas (`sw-regras.ts`): têm
  dado de saúde e mudam a cada registro (molde do Plano 25, RN-473).

### 4.8 Worker e avisos

- **Fila `questionarios-automaticos`** (agendada a cada 30 min, `retryLimit: 1`, `expireInSeconds: 300`): por consultório
  ativo com um modelo de envio automático (`listarTenantsParaVarredura`), no contexto `worker` por tenant: (a) cria os
  envios que faltam (RN-533); (b) expira os vencidos; (c) cancela os de consulta cancelada; (d) leva o envio aberto
  para a consulta remarcada (RN-535). Os passos (b) a (d) rodam para **todo** tenant com envio `enviado`, com ou sem
  automático.
- **Avisos** na transação que cria o envio: `enqueueEmail({ tipo: 'questionario_link', … })` com o link assinado e,
  se o paciente tem conta no app, uma linha `notifications` (`canal 'push'`, `tipo 'questionario_novo'`, sem consulta,
  `AVISOS_DO_PORTAL`). O push segue as regras de hoje (inscrição, horário silencioso, paciente inativo).

---

## 5. Histórias de usuário

### E27a — Questionário pré-consulta

#### US-520 — Modelos de questionário · **M** (PD-110)

**Como** nutricionista, **quero** montar questionários com as perguntas que quero ver antes da consulta, **para**
chegar à consulta com a história do paciente já contada.

| Campo | Tipo | Obrig. | Validação | Erro |
|---|---|---|---|---|
| Nome do questionário | texto | Sim | 1–80 | "Informe o nome do questionário" |
| Texto de abertura | texto longo | Não | 1–600 | "Use no máximo 600 caracteres" |
| Perguntas | lista | Sim | 1–100, os 7 tipos da anamnese (US-012), rótulo 1–200, 2–30 opções de até 100 caracteres | As mensagens de `MSG_ANAMNESE` |

```gherkin
Cenário: Primeiro acesso
  Dado que nunca abri "Questionários pré-consulta"
  Quando abro a página
  Então vejo o modelo "Questionário pré-consulta" com 12 perguntas, marcado "Padrão"
  E ele não aparece no seletor de modelo da aba Anamnese

Cenário: Criar um questionário
  Quando toco em "Novo questionário", dou o nome "Retorno — como foi o mês", incluo 3 perguntas e salvo
  Então volto à lista com a mensagem "Questionário salvo."

Cenário: Modelo de anamnese não vira questionário
  Dado o modelo de anamnese "Anamnese geral"
  Então ele não aparece em "Questionários pré-consulta" nem no seletor "Enviar questionário"

Cenário: Arquivar
  Quando arquivo "Retorno — como foi o mês"
  Então ele some da lista e dos seletores
  E os envios já feitos continuam com as perguntas de quando foram enviados (snapshot)
```

#### US-521 — Enviar questionário ao paciente · **M** (PD-110)

**Como** nutricionista, **quero** enviar um questionário ao paciente, ligado à próxima consulta, **para** receber as
respostas antes de atendê-lo.

```gherkin
Cenário: Enviar pela ficha, ligado a uma consulta
  Dado que a paciente "Ana Souza" está ativa e tem consulta em 20/11/2026 às 14:00
  Quando abro Anamnese › Questionários, escolho "Questionário pré-consulta" e a consulta "20/11/2026 às 14:00" e toco em "Enviar questionário"
  Então vejo "Questionário enviado. A Ana recebe o link por e-mail e, se usar o app, um aviso no celular."
  E a lista mostra "Aguardando resposta · vence em 20/11/2026 às 14:00"
  E sai um e-mail para a Ana com o link e, se ela tem conta no app, um push "Sua nutricionista enviou um questionário para você responder."

Cenário: Enviar pela consulta
  Dado a consulta da Ana em 20/11/2026 às 14:00 sem questionário
  Quando abro a consulta e, no bloco "Questionário pré-consulta", escolho o modelo e toco em "Enviar questionário"
  Então o envio fica ligado a essa consulta

Cenário: Sem consulta
  Quando envio sem escolher consulta ("Sem consulta ligada")
  Então o envio vence 14 dias depois

Cenário: Um por consulta
  Dado que a consulta de 20/11 já tem questionário aguardando resposta ou respondido
  Então a consulta não aparece no seletor e o bloco da consulta mostra a situação, sem "Enviar questionário"

Cenário: Paciente não ativo
  Dado que o paciente está arquivado
  Então o formulário "Enviar questionário" não aparece e vejo "Paciente arquivado: reative o cadastro para enviar questionários."

Cenário: Cancelar e reenviar
  Dado um envio aguardando resposta
  Quando toco em "Cancelar envio" e confirmo
  Então a situação vira "Cancelado" e o link deixa de abrir
  E "Reenviar" cria um envio novo com o mesmo modelo e a mesma consulta (se ainda for futura)
```

#### US-522 — Envio automático · **M** (PD-110)

**Como** nutricionista, **quero** que o questionário saia sozinho antes da consulta, **para** não depender de lembrar
(nem da recepção).

| Campo | Tipo | Obrig. | Validação | Erro |
|---|---|---|---|---|
| Enviar sozinho | chave | — | — | — |
| Questionário | lista dos modelos ativos de questionário | Se ligado | um modelo | "Escolha o questionário" |
| Quando | `primeira` ("Só antes da primeira consulta") / `todas` ("Antes de toda consulta") | Se ligado | — | "Escolha uma opção" |
| Antecedência | 1 a 7 dias | Se ligado | inteiro | "Escolha de 1 a 7 dias" |

```gherkin
Cenário: Ligar
  Quando ligo "Enviar sozinho" com "Questionário pré-consulta", "Só antes da primeira consulta" e "2 dias antes" e salvo
  Então vejo "Envio automático ligado: 2 dias antes da primeira consulta."

Cenário: Consulta marcada pela recepção ou pelo paciente
  Dado o envio automático ligado
  E uma consulta agendada pela recepção para o paciente novo "Bruno Lima" daqui a 2 dias
  Quando o worker roda
  Então o Bruno recebe o questionário, ligado a essa consulta, com a origem "Automático"

Cenário: Consulta marcada em cima da hora
  Dado a antecedência de 2 dias e uma consulta marcada para daqui a 5 horas
  Quando o worker roda
  Então o questionário sai na mesma hora (a janela vai de agora até o início da consulta)

Cenário: Não repete
  Dado "Só antes da primeira consulta" e o paciente já tem atendimento registrado ou já respondeu este questionário
  Então nenhum envio é criado
```

#### US-523 — Responder no app · **M** (PD-110)

**Como** paciente, **quero** responder o questionário no app, **para** contar à nutricionista como estou antes da consulta.

```gherkin
Cenário: Card em Hoje
  Dado um questionário aguardando resposta para a consulta de 20/11/2026 às 14:00
  Quando abro o app
  Então vejo o card "Questionário para responder" com "Para a consulta de 20/11 às 14:00" e o botão "Responder agora"

Cenário: Responder
  Quando respondo as obrigatórias e toco em "Enviar respostas"
  Então vejo "Respostas enviadas. Obrigado! Sua nutricionista vai ler antes da consulta."
  E o card some de Hoje

Cenário: Obrigatória em branco
  Quando envio sem responder "Qual é o principal motivo da consulta?"
  Então vejo no topo "Corrija 1 resposta para enviar." com o link para a pergunta
  E junto da pergunta "Responda: Qual é o principal motivo da consulta?"
  E nada é gravado e o que respondi continua no formulário

Cenário: Vencido
  Dado que a consulta já começou
  Quando abro o link do card guardado
  Então vejo "Este questionário não está mais aberto." e nada é gravado

Cenário: Ver minhas respostas
  Dado um questionário respondido
  Quando abro Jornada e toco no questionário
  Então vejo "Suas respostas" em leitura, e a leitura fica no Histórico de acessos
```

#### US-524 — Responder pelo link do e-mail · **M** (PD-110)

**Como** paciente que não usa o app, **quero** responder pelo link do e-mail, **para** não precisar criar conta.

```gherkin
Cenário: Abrir o link
  Quando abro o link do e-mail
  Então vejo "Questionário de {Consultório Debby}", "Para a sua consulta de 20/11/2026 às 14:00", o texto de abertura e as perguntas
  E nenhuma resposta anterior

Cenário: Responder uma vez
  Quando respondo e toco em "Enviar respostas"
  Então vejo "Respostas enviadas. Obrigado! Sua nutricionista vai ler antes da consulta."
  E se abro o link de novo vejo "Este questionário já foi respondido. Obrigado!", sem as respostas

Cenário: E-mail do cadastro corrigido
  Dado que a nutricionista corrigiu o e-mail da paciente depois do envio
  Quando abro o link antigo
  Então vejo "Este link não é mais válido. Peça um novo à sua nutricionista."

Cenário: Muitas tentativas
  Dado mais de 30 aberturas ou envios do mesmo IP em 10 minutos
  Então vejo "Muitas tentativas. Tente de novo em alguns minutos." e nada é gravado
```

#### US-525 — Ver as respostas e levar para a anamnese · **M** (PD-110)

**Como** nutricionista, **quero** ver as respostas na ficha e aproveitá-las na anamnese, **para** não digitar de novo o
que o paciente já contou.

```gherkin
Cenário: Ver
  Quando abro Anamnese › Questionários › o envio respondido
  Então vejo "Respondido pelo paciente em 18/11/2026 às 21:12 · pelo app" e cada pergunta com a resposta (em branco: "Sem resposta")
  E a leitura entra no Histórico de acessos como "Visualizou — Questionário pré-consulta"

Cenário: Copiar para uma anamnese
  Quando toco em "Copiar para uma anamnese"
  Então abro uma anamnese nova com as mesmas perguntas e as respostas do paciente, marcada "Veio do questionário de 18/11/2026"
  E posso corrigir e completar antes de salvar
  E as respostas do questionário continuam como o paciente enviou

Cenário: Já copiado
  Dado que o questionário já foi copiado
  Então vejo "Copiado para a anamnese de 20/11/2026" com o link, no lugar do botão
```

### E27b — Recordatório 24 h

#### US-526 — Registrar o recordatório · **M** (PD-111)

**Como** nutricionista, **quero** registrar o que o paciente comeu no dia anterior, com o cálculo pronto, **para**
avaliar o consumo e comparar com o plano.

| Campo | Tipo | Obrig. | Validação | Erro |
|---|---|---|---|---|
| Dia relatado | data | Sim | até hoje, no máximo 30 dias antes | "Escolha um dia entre {data} e hoje" |
| Dia fora do comum | sim/não | — | — | — |
| Refeição (por bloco) | lista: Café da manhã, Lanche da manhã, Almoço, Lanche da tarde, Jantar, Ceia, Outro | Sim | lista fechada (`REFEICOES_DO_DIARIO`) | "Escolha a refeição" |
| Nome da refeição (só "Outro") | texto | Se "Outro" | 2–40 | "Use entre 2 e 40 caracteres" |
| Horário | hora | Não | HH:MM | "Horário inválido" |
| Local | texto | Não | 2–60 | "Use entre 2 e 60 caracteres" |
| Alimento | busca (`BuscaAlimento`) | Sim, ou "Item sem cadastro" | alimento visível ao consultório | "Escolha um alimento da lista" |
| Quantidade | gramas ou medida caseira | Sim com alimento | 0,1–5.000 g (`lerQuantidade`) | "Informe a quantidade (de 0,1 a 5.000 g)" |
| Item sem cadastro | texto | Se sem alimento | 2–120 | "Descreva o item" |
| Como foi preparado | texto | Não | 1–200 | "Use no máximo 200 caracteres" |
| Observação | texto longo | Não | 1–2.000 | "Use no máximo 2.000 caracteres" |

```gherkin
Cenário: Registrar
  Dado a paciente Ana com plano publicado de meta 1.800 kcal e GET de 2.050 kcal
  Quando abro "Novo recordatório", escolho o dia de ontem, incluo "Café da manhã" com "Pão francês, 1 unidade (50 g)" e "Café, 1 xícara (150 g)" e salvo
  Então vejo "Recordatório salvo." e o total do dia com kcal, proteína, carboidrato, lipídio e fibra
  E "Meta do plano: 1.800 kcal · {rótulo da faixa} ({desvio})" e "Último gasto energético: 2.050 kcal ({diferença} kcal)", com os números do total
  E a distribuição em g, g/kg e % do VET

Cenário: Item sem cadastro
  Quando incluo "Item sem cadastro" com "Bolo da vizinha, 1 fatia"
  Então ele aparece com "Sem cálculo" e o total avisa "1 item sem cálculo"

Cenário: Valores congelados
  Dado um recordatório salvo com o meu alimento "Granola da casa"
  Quando altero a energia de "Granola da casa" em Alimentos
  Então o recordatório salvo continua com os valores de quando foi salvo

Cenário: Micronutrientes
  Quando toco em "Ver todos os nutrientes"
  Então vejo cada nutriente do catálogo com o total e, quando houver, "{n} itens sem valor na tabela"

Cenário: Editar
  Quando corrijo a quantidade do pão e salvo
  Então os totais são recalculados com os valores do alimento de agora, e a alteração entra no Histórico de acessos
```

### E27c — Metas

#### US-527 — Modelos de metas · **S** (PD-112)

**Como** nutricionista, **quero** uma lista de metas prontas do consultório, **para** atribuí-las em segundos.

| Campo | Tipo | Obrig. | Validação | Erro |
|---|---|---|---|---|
| Meta | texto | Sim | 3–80 | "Escreva a meta (de 3 a 80 caracteres)" |
| Como fazer | texto | Não | 1–300 | "Use no máximo 300 caracteres" |
| Categoria | lista: Água, Alimentação, Atividade física, Sono, Hábitos, Outra | Sim | lista | "Escolha a categoria" |
| Sugerir lembrete | lista: Nenhum, Água, Refeições, Suplemento, Lembrete livre | Não | lista | "Escolha uma opção da lista" |

```gherkin
Cenário: Incluir sugestões
  Dado que não tenho modelos de metas
  Quando toco em "Incluir sugestões"
  Então entram 6 metas prontas, como "Beber 2 L de água por dia", que posso editar ou arquivar
  E o botão some depois de usado

Cenário: Arquivar
  Quando arquivo um modelo
  Então ele some do seletor "Nova meta" e as metas já atribuídas não mudam
```

#### US-528 — Atribuir e acompanhar metas · **M** (PD-112)

**Como** nutricionista, **quero** dar metas ao paciente e ver se ele está cumprindo, **para** ajustar a conduta no retorno.

| Campo | Tipo | Obrig. | Validação | Erro |
|---|---|---|---|---|
| A partir de um modelo | lista | Não | modelo ativo | — |
| Meta / Como fazer / Categoria | como na US-527 | | | |
| Começa em | data | Sim | de hoje a 30 dias à frente | "Escolha uma data de hoje até {data}" |
| Termina em | data | Não | depois do início, no máximo 365 dias depois | "A data final precisa ser depois do início (até 1 ano)" |

```gherkin
Cenário: Nova meta a partir de modelo
  Dado a paciente Ana ativa
  Quando, na seção Metas da aba Plano alimentar, escolho "Beber 2 L de água por dia" e toco em "Adicionar meta"
  Então a meta aparece como "Ativa · desde 17/11/2026" com os 7 últimos dias "Sem registro"
  E, como o modelo sugere lembrete de água e a Ana não tem lembrete de água, vejo o link "Criar lembrete de água"

Cenário: Acompanhar
  Dado que a Ana registrou "Cumpri" em 5 dos últimos 7 dias e "Não cumpri" em 1
  Então vejo os 7 dias em texto e ícone e "Últimos 30 dias: cumpriu em 5 de 6 dias registrados"
  E a leitura dos registros entra no Histórico de acessos como "Visualizou — Metas"

Cenário: Encerrar
  Quando toco em "Encerrar" e escolho "Alcançada"
  Então a meta sai do app da Ana e fica no painel como "Alcançada em 30/11/2026", com o histórico

Cenário: Limite
  Dado que a Ana já tem 8 metas ativas
  Então "Adicionar meta" fica indisponível com "Limite de 8 metas ativas. Encerre uma para incluir outra."
```

#### US-529 — Registrar a meta do dia no app · **M** (PD-112)

**Como** paciente, **quero** marcar se cumpri a meta hoje, **para** acompanhar meu progresso e a nutricionista ver.

```gherkin
Cenário: Card em Hoje
  Dado a meta ativa "Beber 2 L de água por dia"
  Quando abro o app
  Então vejo "Metas de hoje" com a meta e os botões "Cumpri" e "Não cumpri"

Cenário: Registrar
  Quando toco em "Cumpri"
  Então o botão fica marcado (aria-pressed), a região de status anuncia "Registrado: cumpriu hoje." e o foco fica no botão

Cenário: Trocar e ontem
  Quando abro "Ver minhas metas" e toco em "Não cumpri" no dia de ontem
  Então o registro de ontem é gravado; anteontem aparece só em leitura

Cenário: Meta encerrada
  Dado que a nutricionista encerrou a meta
  Então ela some de Hoje e de "Minhas metas", e um registro enviado de uma tela antiga é recusado com "Esta meta não está mais ativa."
```

#### US-530 — Questionário, recordatório e metas no Início da ficha · **S**

```gherkin
Cenário: Seções
  Quando abro o Início da Ana
  Então vejo as seções "Questionários", "Recordatórios 24 h" e "Metas" com o contador e os 3 últimos itens só com rótulo genérico, data e situação
  E o Adicionar ganha "Questionário pré-consulta" e "Recordatório 24 h" em Avaliações e "Meta" em Prescrições
  E "No app do paciente" conta os questionários abertos e as metas ativas como o app mostra
```

#### US-531 — Meus dados (exportação) · **S**

```gherkin
Cenário: Exportação do titular
  Quando a Ana pede os próprios dados
  Então o dados.json traz os questionários (perguntas, respostas, situação e datas), os recordatórios (itens, quantidades e nutrientes congelados) e as metas com os registros diários
  E o prontuario.pdf traz os questionários respondidos, os recordatórios com os totais e as metas com a adesão
```

---

## 6. Regras de negócio

### 6.1 Regras

| ID | Regra |
|---|---|
| RN-520 | **Finalidade do modelo.** `anamnesis_templates.finalidade` (`anamnese` \| `questionario`, padrão `anamnese`). Toda função de anamnese filtra `anamnese`; toda função de questionário filtra `questionario`. Modelo sugerido pela IA (Plano 14B) é sempre de anamnese (CHECK `anamnesis_templates_questionario_sem_ia`) |
| RN-521 | **Texto de abertura.** `ModeloSchema.introducao` só em questionário, 1–600 caracteres, texto puro (sem Markdown nem link), mostrado no topo do formulário do paciente. Vai no snapshot |
| RN-522 | **Questionário padrão.** `garantirQuestionarioPadrao` cria o "Questionário pré-consulta" (QP-D3, §6.3) na primeira leitura da lista, com `padrao = true`; um padrão por consultório **e finalidade** (índice `anamnesis_templates_padrao_idx` refeito em `(tenant_id, finalidade) where padrao`). O padrão vem selecionado no "Enviar questionário" |
| RN-523 | **Envio.** `enviarQuestionario(ctx, patientId, { modeloId, appointmentId? })`, sessão `nutri`: trava o paciente (`carregarPacienteParaEscrita`) e exige `status = 'ativo'`; confere modelo ativo de questionário; consulta (se houver) do mesmo paciente, `agendada` ou `confirmada` e futura, sem outro envio `enviado` ou `respondido` (índice `questionario_envios_um_por_consulta`); grava o envio com o snapshot (`nome`, `introducao`, `perguntas`), `origem 'nutri'`, `enviado_por = actorUserId`, `enviado_em` e `expira_em` (RN-524); na mesma transação, os avisos (RN-526). Erros: "Modelo de questionário não encontrado.", "Esta consulta já tem questionário.", "Escolha uma consulta futura deste paciente." |
| RN-524 | **Validade.** Com consulta: `expira_em` = início da consulta. Sem consulta: `enviado_em` + 14 dias. CHECK `expira_em > enviado_em`. Depois de `expira_em`, o paciente não responde (gatilho, RN-529) e o worker passa a `expirado` |
| RN-525 | **Cancelar e reenviar.** "Cancelar envio" (sessão `nutri`, só `enviado`) → `cancelado`, `cancelado_em`, `cancelado_por = app_current_user()`, `cancelado_motivo 'nutri'`. "Reenviar" (de `cancelado` ou `expirado`) = envio novo pela RN-523 com o mesmo modelo, e a mesma consulta se ela ainda servir; sem consulta que sirva, sem consulta. Nunca reabre o antigo |
| RN-526 | **Avisos do envio.** (a) **E-mail** `questionario_link` a `patients.email`, por `enqueueEmail` na transação do envio (o e-mail sai depois do COMMIT, pela fila): assunto "Questionário antes da sua consulta", corpo com o nome do consultório, a data da consulta (se houver), o botão "Responder questionário" (link de RN-527) e "O link vale até {data e hora}." — **sem** o nome do modelo nem as perguntas. (b) **Push** `questionario_novo` só se o paciente tem conta (`patients.user_id` não nulo): linha em `notifications` (canal `push`, sem consulta) com corpo neutro e tela `/p/inicio`; as regras de envio de push de hoje valem (`sem_inscricao`, `paciente_inativo`, horário silencioso). Sem WhatsApp. Envio pelo worker (RN-533) segue o mesmo caminho |
| RN-527 | **Link sem login** (`src/modules/questionarios/link.ts`, molde de `autorizacao-token.ts`): versão + tenant + paciente + envio + emissão (segundos), MAC de 128 bits com chave derivada própria (`nutridebby:link-questionario:v1`, HKDF de `ENCRYPTION_KEY`) e o **e-mail atual** do paciente (corrigido o e-mail, o link morre). **Sem código de 6 dígitos** (QP-D6). Vale enquanto o envio estiver `enviado` e antes de `expira_em` (conferido no banco a cada abertura). Leitura e gravação no contexto de paciente **sem login** (`semConta`, entrada em `SEM_CONTA_PERMITIDOS`). Limite por IP: 30 aberturas ou envios por 10 minutos (`consumirLimite`, chave `questionario`). Respostas da página: inválido → "Este link não é mais válido. Peça um novo à sua nutricionista."; respondido → "Este questionário já foi respondido. Obrigado!"; vencido ou cancelado → "Este questionário não está mais aberto." |
| RN-528 | **O que a página do link mostra.** Nome do consultório, data e hora da consulta (se houver), texto de abertura e perguntas do snapshot. **Nunca** nome do paciente, respostas já enviadas, nome do modelo na aba do navegador (o `<title>` é "Questionário pré-consulta") nem outro dado do prontuário. `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `noindex`. A abertura grava `auditRead` (entidade `questionario`, `entidadeId` = envio, ator nulo, IP), como `link-documento.ts` |
| RN-529 | **Responder** (`responderQuestionario`, app ou link): `validarRespostas(snapshot.perguntas, bruto)` no servidor (obrigatórias, tipos, limites; nenhuma resposta vazia gravada); com erro, nada grava. Grava pela **sessão do paciente** (`UPDATE` em `questionario_envios`, `PACIENTE_ESCREVE`) com `situacao 'respondido'`, `respostas`, `respondido_via` (`app` com login, `link` sem login). O gatilho `questionario_envios_regras` confere: só `enviado` → `respondido`, uma vez; `clock_timestamp() < expira_em`; titular `ativo` e não anonimizado; `respondido_em := clock_timestamp()`; `respondido_via = 'app'` só com `app_current_user()` não nulo e `'link'` só sem; nenhuma outra coluna muda. As respostas **nunca** mudam depois (nem pela equipe) |
| RN-530 | **Leituras auditadas.** Painel: a lista de envios da aba (`listarEnvios`, com o nome do modelo, como `listarAnamneses`) grava **um** `auditRead` de lista (entidade `questionario`) quando há envios; abrir as respostas (`abrirEnvio`) grava um com o id. Portal: o card de Hoje e a lista da Jornada (só id, data da consulta, situação) **não** gravam; abrir o formulário e "Suas respostas" gravam. A seção do Início não grava (D14 do 18) |
| RN-531 | **Copiar para uma anamnese.** "Copiar para uma anamnese" (só `respondido`, sem `anamnese_id`) abre `anamnese/nova?questionario={envioId}` com o formulário preenchido pelas perguntas do snapshot e as respostas. Ao salvar, `preencherAnamneseDoQuestionario` grava a `anamneses` com `template_id` nulo, `template_snapshot` = snapshot do envio (o nome ganha " (questionário)") e as respostas do formulário, e, **na mesma transação**, `questionario_envios.anamnese_id` (o gatilho só deixa a sessão `nutri` gravar de nulo para valor, num envio `respondido`). Uma cópia por envio |
| RN-532 | **Envio automático (configuração).** No próprio modelo de questionário: `envio_auto` (`primeira` \| `todas`) e `envio_auto_dias` (1–7), juntos ou nulos (CHECK). **Um** modelo automático por consultório (índice único parcial); arquivar o modelo desliga o automático (CHECK `envio_auto is null or arquivado_em is null`). Ligar em outro modelo desliga o anterior na mesma transação. Texto do cartão: "Envio automático ligado: {n} dias antes da primeira consulta." / "… antes de toda consulta." / "Envio automático desligado." |
| RN-533 | **Envio automático (worker).** A cada 30 min, por tenant ativo com modelo automático, contexto `worker`: consultas `agendada`/`confirmada` com `inicio` entre agora e agora + `envio_auto_dias`, de paciente `ativo` com e-mail, **sem** envio da consulta (qualquer situação: um cancelado pela nutricionista não volta sozinho), e: `primeira` → o paciente não tem atendimento registrado (`consultations`) nem envio `respondido` deste modelo; `todas` → o paciente não tem envio deste modelo `respondido` nos 7 dias anteriores nem `enviado` aberto. Cria o envio com `origem 'automatico'`, `enviado_por` nulo, e os avisos (RN-526). Lote de até 200 por tenant e rodada; `ON CONFLICT DO NOTHING` no índice por consulta (duas rodadas não duplicam). Consulta `solicitada` (Plano 23) não recebe |
| RN-534 | **Expirar e cancelar (worker).** Na mesma fila: `enviado` com `expira_em ≤ agora` → `expirado`; `enviado` de consulta `cancelada` (sem remarcação, RN-535) → `cancelado` com `cancelado_motivo 'consulta_cancelada'` e `cancelado_por` nulo |
| RN-535 | **Remarcação.** Consulta `cancelada` com uma consulta nova que aponta para ela (`remarcada_de`), `agendada`/`confirmada` e futura: o envio `enviado` passa para a consulta nova (`appointment_id` e `expira_em` = início da nova), só pelo `worker` (gatilho). Se a nova já tiver envio, o antigo é cancelado (`consulta_cancelada`). Envio `respondido` fica com a consulta antiga (o bloco da consulta nova mostra "Respondido para a consulta de {data}") |
| RN-536 | **Bloqueio e anonimização.** No `UPDATE` que leva o paciente a `bloqueado` (`lgpd.ts`, sessão `nutri`), os envios `enviado` passam a `cancelado` com `cancelado_motivo 'paciente_bloqueado'`, `cancelado_por` = ator. Envios respondidos ficam (prontuário). Na anonimização nada muda nos envios (como a `anamneses`): respostas são registro clínico guardado 20 anos (Res. CFN 594/2017, art. 3º, VI, "b") |
| RN-537 | **Sem apagar.** Envio não é apagado por ninguém do app: `REVOKE DELETE, TRUNCATE ON questionario_envios FROM nutri_app_role` (QP-D17). Engano = "Cancelar envio" |
| RN-538 | **Portal: o que o paciente vê.** Hoje e Jornada listam os envios `enviado`, não vencidos e de consulta não cancelada (ou sem consulta), com a data da consulta e "Responder agora"; Jornada lista também os respondidos ("Respondido em {data}"). O nome que o paciente vê no formulário é o do snapshot (escrito pela nutricionista, para ele). Expirado e cancelado não aparecem |
| RN-539 | **Questionário na consulta.** O bloco "Questionário pré-consulta" da página da consulta aparece só na sessão `nutri` (a recepção não vê, QP-D12) e mostra: "Nenhum questionário enviado." + formulário; "Aguardando resposta · enviado em {data}" + "Cancelar envio"; "Respondido em {data}" + "Ver respostas"; "Vencido"/"Cancelado" + "Reenviar". Consulta passada, cancelada ou `solicitada`: sem formulário |
| RN-540 | **Recordatório: gravação.** `salvarRecordatorio(ctx, patientId, id \| null, entrada)`, sessão `nutri`, paciente `ativo` ou `arquivado` (`carregarPacienteParaEscrita`): valida tudo no servidor (§5, US-526; todos os CHECKs conferidos antes, para nenhum 23514 levar a linha ao log do Postgres, D23 do 18); grava `recordatorios` e substitui os itens (upsert pelo id, `DELETE` dos removidos) numa transação; congela os nutrientes (RN-541). Até 12 refeições e 80 itens por recordatório. Sem exclusão do recordatório (QP-D17) |
| RN-541 | **Recordatório: nutrientes congelados.** Na mesma transação, `UPDATE recordatorio_itens SET nutrientes = … FROM foods` pelo molde de `publicarPlano`, com o formato `NutrientesCongelados` do Plano 19 (macros, fibra, `fonte`, `fonteVersao`, `fonteOrigem`, `micros`) calculado para a quantidade do item. Alimento invisível ao consultório (RLS) → "Escolha um alimento da lista". A leitura usa `lerCongelados` (formato antigo aceito) |
| RN-542 | **Recordatório: totais.** `totalDoRecordatorio(itens)`: soma os nutrientes congelados de todos os itens com `food_id` (no recordatório não há substituição); itens sem cadastro ficam fora e contados ("{n} item sem cálculo" / "{n} itens sem cálculo"); `semValor` como no plano. Por refeição e do dia. Mesma regra de arredondamento do plano (CS-522) |
| RN-543 | **Recordatório: comparação.** Lida pela função existente `contextoDoPaciente` (peso e cálculos de GET, já auditados) e pela meta do plano **publicado** (`meal_plans.meta_kcal`): "Meta do plano: {kcal} kcal · {rótulo} ({desvio})" com `indicadorMeta`; "Último gasto energético: {kcal} kcal ({diferença} kcal)". Sem plano publicado ou sem GET, a linha some. O recordatório não grava a comparação |
| RN-544 | **Recordatório: leituras.** A lista da aba (dia relatado, nº de itens, kcal total) grava **um** `auditRead` de lista (entidade `recordatorio`) quando há linhas; abrir um grava com o id. A seção do Início não grava |
| RN-545 | **Metas: biblioteca.** `metas_modelos` do consultório, `staff_only`, sem paciente e sem auditoria (como as bibliotecas do Plano 19). "Incluir sugestões" insere as 6 sugestões (§6.3) uma vez: some quando o consultório tem algum modelo (ativo ou arquivado). Arquivar = `arquivado_em` (sem DELETE no código) |
| RN-546 | **Metas: atribuição.** `atribuirMeta`, sessão `nutri`, paciente `ativo` (trava): até **8** metas `ativa` por paciente (conferido sob a trava do paciente; o banco não tem contador); copia título, "Como fazer", categoria e `lembrete_sugerido` do modelo (ou do formulário); `inicio` de hoje a +30 dias; `fim` nulo ou de `inicio` a `inicio` + 365 dias. Editar muda título, "Como fazer", categoria e `fim` (não `inicio` depois de haver registro). "Encerrar" → `situacao 'alcancada'` ou `'encerrada'`, `encerrada_em`. Não há reabrir: nova meta |
| RN-547 | **Metas: registro do paciente.** `registrarMeta(ctx, metaId, dia, cumprida)`, só sessão de paciente com login: `INSERT … ON CONFLICT (tenant_id, meta_id, dia) DO UPDATE SET cumprida`. Gatilho `metas_registros_regras`: papel `paciente` (a equipe, a recepção, o público, a conta e o worker recebem 42501; só o contexto vazio da migration passa); meta do próprio paciente, `ativa`, com `dia` entre `inicio` e `coalesce(fim, dia)`; `dia` = hoje ou ontem no fuso do tenant (`app_hoje_do_tenant()`, lida de `tenants.fuso`); titular `ativo`; `registrado_em := clock_timestamp()` no INSERT, `atualizado_em := clock_timestamp()` no UPDATE; no UPDATE só `cumprida` muda. Sem DELETE (`REVOKE`) |
| RN-548 | **Metas: o que se mostra.** Painel: por meta, os 7 últimos dias e a adesão de 30 dias ("Últimos 30 dias: cumpriu em {a} de {b} dias registrados"; sem registro: "Nenhum registro nos últimos 30 dias."). Portal: metas ativas com hoje e ontem graváveis e os 5 dias anteriores em leitura. Leituras com registros gravam `auditRead` (entidade `metas`) uma vez por tela; a seção do Início e o contador "No app" não |
| RN-549 | **Metas e lembretes.** Com `lembrete_sugerido` e sem lembrete ligado daquele tipo para o paciente, a meta mostra o link "Criar lembrete de {tipo}" para `#lembretes-app-titulo`. Nada é gravado em `lembretes_rotina` por este plano; o push continua o do Plano 17 (texto fixo, teto de 24 por dia) |
| RN-550 | **Metas: bloqueio e anonimização.** No bloqueio, as metas `ativa` passam a `encerrada` (`encerrada_motivo` nulo, sessão `nutri`, no mesmo `UPDATE` do bloqueio em `lgpd.ts`). Metas e registros ficam na anonimização (conduta e acompanhamento, prontuário) |
| RN-551 | **Textos fora do app.** Push, e-mail, título de página, URL, log, Sentry e `audit_log` **nunca** levam resposta, nome de modelo de questionário, alimento do recordatório ou título de meta (CS-521). O `audit_log` grava só id, titular, ator e IP (gatilho `0007`) |
| RN-552 | **IA.** Nenhuma das tabelas novas é lida pelos módulos da IA (`resumo-dados.ts`, `rascunho-dados.ts`, `leitura-job.ts`, `nutri-paciente/contexto.ts`); guarda de fonte em `campos-enviados.test.ts` (QP-D24) |
| RN-553 | **Exportação.** `dados.json` (escopos titular e equipe): `questionarios` (modelo do snapshot, perguntas e respostas por rótulo via `respostaParaCampo`, situação, enviado em, respondido em e por onde, consulta), `recordatorios` (dia, dia fora do comum, observação, refeições com itens, quantidades, medida, nutrientes congelados e fonte), `metas` (título, como fazer, categoria, período, situação, registros por dia). Sem `enviado_por`, `cancelado_por` nem `criado_por` no escopo titular (ids internos). `prontuario.pdf`: seções "Questionários pré-consulta" (só respondidos), "Recordatórios 24 h" (itens e totais) e "Metas" (lista e adesão) |
| RN-554 | **Isolamento e recepção.** As quatro tabelas novas nascem com `recepcao_negada` (pelo `app_enable_tenant_rls` do Plano 26, se ele entrar antes, ou pelo laço da migration dele, se entrar depois). As funções de gatilho deste plano entram em `FUNCOES_COM_PAPEL` com "não se aplica (tabela negada)" (§9.6) |
| RN-555 | **Seções do Início.** `secaoQuestionarios`, `secaoRecordatorios` e `secaoMetas` acrescentadas **no fim** de `SECOES_DA_FICHA`, nessa ordem; rótulos genéricos (§4.6); o arquivo da seção nunca chama `auditRead` |
| RN-556 | **"No app" das seções.** `noApp` contado no contexto de paciente (`TxDePaciente`, D16 do 18): questionários = envios que `questionariosAbertosDoPaciente` devolveria; metas = metas que `metasDeHoje` devolveria. As duas funções do portal e a contagem usam o **mesmo** filtro exportado (`ENVIO_VISIVEL`, `META_VISIVEL`), com caso no teste de paridade (RNF-263 b do 18) |
| RN-557 | **Fuso.** "Hoje", "ontem", o dia relatado do recordatório e as datas de tela são no fuso do consultório (`hojeNoFuso`, RN-06); `expira_em` e os carimbos são `timestamptz` |
| RN-558 | **Paciente sem conta e push.** Paciente sem conta no app recebe só o e-mail. Paciente com conta e sem notificações no aparelho: a linha de push fica `ignorada` (`sem_inscricao`), como hoje |
| RN-559 | **Concorrência.** Ordem de travas: paciente → envio (`FOR UPDATE`) → consulta (`FOR KEY SHARE`). Responder e cancelar ao mesmo tempo: quem trava primeiro ganha; o outro relê e vê a situação nova ("Este questionário não está mais aberto." / "Este envio já foi respondido.") |

### 6.2 Textos de interface

| Onde | Texto exato |
|---|---|
| Card de Configurações | **Questionários pré-consulta** · "Perguntas que o paciente responde antes da consulta." · **Modelos de metas** · "Metas prontas para dar aos pacientes." |
| `/painel/questionarios` | Título "Questionários pré-consulta"; "Novo questionário"; selo "Padrão"; "{n} perguntas"; cartão "Envio automático" com a chave "Enviar sozinho", "Questionário", "Quando" ("Só antes da primeira consulta" / "Antes de toda consulta"), "Antecedência" ("{n} dia antes"/"{n} dias antes") e "Salvar envio automático"; vazio: "Nenhum questionário. Crie um ou use o padrão." |
| Editor | Campo "Texto de abertura" com a dica "Aparece no topo, antes das perguntas. Ex.: por que você pede as respostas." |
| Aba Anamnese (navegação) | "Anamneses" · "Questionários" · "Recordatórios" |
| Questionários do paciente | Título "Questionários"; formulário "Enviar questionário": "Questionário", "Consulta" (opções "{data} às {hora}" e "Sem consulta ligada"), botão "Enviar questionário"; colunas "Questionário", "Consulta", "Enviado em", "Situação"; situações "Aguardando resposta · vence em {data} às {hora}", "Respondido em {data}", "Vencido", "Cancelado"; origem "Automático"; vazio: "Nenhum questionário enviado." |
| Sucesso do envio | "Questionário enviado. {primeiro nome} recebe o link por e-mail e, se usar o app, um aviso no celular." |
| Respostas | "Respondido pelo paciente em {data} às {hora} · {pelo app \| pelo link do e-mail}"; "Sem resposta"; "Copiar para uma anamnese"; "Copiado para a anamnese de {data}"; "Cancelar envio" (confirmação "Cancelar este envio? O link deixa de funcionar."); "Reenviar"; aviso fixo "Respostas enviadas pelo paciente. Não podem ser alteradas; para corrigir ou completar, copie para uma anamnese." |
| Anamnese copiada | Faixa "Veio do questionário de {data}. Confira e complete antes de salvar." |
| Bloco da consulta | Título "Questionário pré-consulta"; os textos da RN-539 |
| Envio automático (lista) | "Envio automático ligado: {n} dias antes da primeira consulta." / "Envio automático ligado: {n} dias antes de toda consulta." / "Envio automático desligado." |
| E-mail | Assunto "Questionário antes da sua consulta"; "Olá, {primeiro nome}. {Consultório} pediu que você responda algumas perguntas antes da consulta de {data} às {hora}." (sem consulta: "… antes do seu próximo atendimento."); botão "Responder questionário"; "O link vale até {data} às {hora}. Não encaminhe este e-mail: o link é só seu." |
| Push | Título "NutriDebby"; corpo "Sua nutricionista enviou um questionário para você responder." |
| Portal, Hoje | Card "Questionário para responder"; "Para a consulta de {dd/mm} às {hora}" (sem consulta: "Responda até {dd/mm}"); botão "Responder agora" |
| Formulário (app e link) | Título = nome do snapshot (no link: `<title>` "Questionário pré-consulta"); "Questionário de {consultório}"; aviso "Suas respostas vão para o seu prontuário, protegido por sigilo profissional. As perguntas com * são obrigatórias. Responda de uma vez: as respostas só são guardadas quando você enviar."; botão "Enviar respostas"; erro de topo "Corrija {n} resposta para enviar." / "Corrija {n} respostas para enviar."; aviso ao sair com respostas preenchidas (diálogo do navegador) |
| Depois de enviar | "Respostas enviadas. Obrigado! Sua nutricionista vai ler antes da consulta." |
| Link inválido / respondido / fechado / limite | Os da RN-527 e "Muitas tentativas. Tente de novo em alguns minutos." |
| Recordatórios | Título "Recordatórios 24 h"; "Novo recordatório"; colunas "Dia relatado", "Itens", "Energia"; "Dia fora do comum" (selo "Fora do comum"); "Incluir refeição"; "Incluir alimento"; "Item sem cadastro"; "Sem cálculo"; "Total do dia"; "Ver todos os nutrientes"; "{n} itens sem valor na tabela"; "Salvar recordatório"; "Recordatório salvo."; dica do dia relatado "Normalmente, o dia anterior à consulta."; vazio "Nenhum recordatório." |
| Metas (painel) | Título "Metas"; "Nova meta"; "A partir de um modelo"; "Adicionar meta"; "Ativa · desde {data}"; "Alcançada em {data}"; "Encerrada em {data}"; "Encerrar" (opções "Alcançada" e "Encerrada sem alcançar"); legenda dos dias "Cumpriu", "Não cumpriu", "Sem registro"; "Criar lembrete de {água \| refeições \| suplemento}" / "Criar lembrete"; limite (US-528); "Mostrar metas encerradas" |
| Modelos de metas | Título "Modelos de metas"; "Novo modelo"; "Incluir sugestões"; categorias e "Sugerir lembrete" (US-527) |
| Portal, metas | Card "Metas de hoje"; botões "Cumpri" e "Não cumpri"; status "Registrado: cumpriu hoje." / "Registrado: não cumpriu hoje." / "… ontem."; link "Ver minhas metas"; página "Minhas metas"; "Hoje", "Ontem"; dica "Você pode marcar hoje e ontem."; meta encerrada "Esta meta não está mais ativa." |

### 6.3 Conteúdo inicial (texto nosso, sem relação com o Dietbox)

**Questionário pré-consulta** (padrão, QP-D3). Abertura: "Estas perguntas ajudam a aproveitar melhor o tempo da
consulta. Responda com calma; se não souber alguma, deixe em branco."

| # | Pergunta | Tipo | Obrig. |
|---|---|---|---|
| 1 | Qual é o principal motivo da consulta? | Texto longo | Sim |
| 2 | Você tem algum problema de saúde diagnosticado? Qual? | Texto longo | Não |
| 3 | Usa algum medicamento, vitamina ou suplemento? Quais? | Texto longo | Não |
| 4 | Tem alergia ou intolerância a algum alimento? | Texto curto | Não |
| 5 | Quantas refeições você faz por dia, em média? | Número | Não |
| 6 | Quantos copos de água bebe por dia, em média? | Número (unidade "copos") | Não |
| 7 | Pratica atividade física? | Sim/não | Não |
| 8 | Se pratica, qual e quantas vezes por semana? | Texto curto | Não |
| 9 | Com que frequência seu intestino funciona? | Escolha única: "Todos os dias", "A cada 2 ou 3 dias", "Menos de 3 vezes por semana", "Não sei" | Não |
| 10 | Quantas horas dorme por noite, em média? | Número (unidade "horas") | Não |
| 11 | Há alimentos que você não come ou não gosta? Quais? | Texto longo | Não |
| 12 | Quer contar mais alguma coisa à sua nutricionista? | Texto longo | Não |

**Sugestões de metas** (botão "Incluir sugestões"):

| Meta | Categoria | Sugerir lembrete |
|---|---|---|
| Beber 2 L de água por dia | Água | Água |
| Comer 3 porções de fruta por dia | Alimentação | Nenhum |
| Incluir verduras e legumes no almoço e no jantar | Alimentação | Refeições |
| Fazer 30 minutos de atividade física | Atividade física | Nenhum |
| Dormir pelo menos 7 horas | Sono | Nenhum |
| Fazer as refeições sem celular ou TV | Hábitos | Nenhum |

---

## 7. Telas

- **Questionários do paciente** (`anamnese/questionarios`, 1280 px): navegação da Anamnese no topo; cartão "Enviar
  questionário" (dois `select` e o botão; desabilitado com o motivo para paciente não ativo); tabela com `caption`
  "Questionários enviados" e `th scope`; situação sempre em texto; cada linha leva às respostas. A 360 px, a tabela vira
  lista de cartões (molde da lista de pacientes).
- **Respostas** (`[envioId]`): cabeçalho com situação, origem e datas; aviso fixo de imutabilidade; `dl` pergunta →
  resposta (múltipla escolha em lista); botões no rodapé. A cópia abre a anamnese com o formulário de sempre.
- **Recordatório** (`novo`, `[id]`): cabeçalho com dia relatado e "Dia fora do comum"; um `fieldset` por refeição com
  `legend` "{refeição} · {horário}" e a tabela de itens (alimento, quantidade, kcal, PTN, CHO, LIP) com "Remover"
  (nome acessível "Remover {alimento} de {refeição}"); "Incluir alimento" com a busca do plano (combobox
  `BuscaAlimento`, e o diálogo do Plano 19 quando estiver na `main`); painel "Total do dia" fixo à direita a 1280 px e
  depois das refeições a 360 px, com `role="status"` só na mensagem de salvo. Salvar por botão (não autosave: é um
  registro clínico datado, e o autosave do plano é para rascunho).
- **Metas** (seção do Plano alimentar): lista de cartões; em cada um, título, "Como fazer", período, a faixa dos 7 dias
  (lista `ol` com o dia e o estado em texto; ícone com `aria-hidden`), adesão, ações ("Ver registro", "Editar",
  "Encerrar"); formulário "Nova meta" em `details` (âncora `#nova-meta`).
- **Portal**: card de questionário com borda da marca; card "Metas de hoje" com um grupo por meta (`role="group"`,
  `aria-labelledby` no título da meta) e dois botões `aria-pressed`; `role="status"` fixo no fim do card; alvos ≥ 44 px.
  O formulário do questionário segue o padrão do formulário do diário (erro junto do campo, `aria-describedby`,
  `aria-invalid`, foco no resumo de erros).
- **Página do link** (`/questionario/[token]`): sem cabeçalho do portal, com a marca do consultório (logo e cor, como
  `/documento/[token]`), mesmo formulário; claro e escuro.

---

## 8. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-520 | Acessibilidade | WCAG 2.1 AA, axe sem violação em claro e escuro, a 1280 e 360 px, em todas as telas novas (inclusive `/questionario/[token]`); navegação da Anamnese com `aria-current`; botões de meta com `aria-pressed`; mensagens em `role="status"` fixo; erros com `role="alert"` junto do campo |
| RNF-521 | Desempenho | Hoje continua em duas transações (P08-13): o card do questionário e as metas entram na de `faixaDeHoje` (duas consultas indexadas); p95 de Hoje e do Início da ficha dentro da meta (RNF-01: ≤ 800 ms), com cenário na pilha de carga (P08-03) incluindo 3 metas e 1 questionário aberto. Worker: lote ≤ 200 envios por tenant e rodada |
| RNF-522 | Segurança | Token do link com MAC de 128 bits e comparação em tempo constante; limite por IP; `no-store` e `no-referrer`; respostas limitadas a 600 KB por envio (CHECK) e validadas pelo snapshot; nenhum valor digitado em mensagem de erro |
| RNF-523 | Testes | (a) unidade: `calculo.ts` do recordatório (CS-522), token do link (formato, MAC, e-mail corrigido, forma canônica), regras do automático (janela, `primeira`/`todas`), dias de meta no fuso (virada do dia em `America/Sao_Paulo` com o servidor em UTC); (b) integração (Testcontainers): gatilhos `questionario_envios_regras` e `metas_registros_regras` por papel (nutri, paciente com e sem conta, recepcao se o 26 estiver na `main`, publico, worker), RLS e isolamento, auditoria (escritas e `auditRead`), exportação e bloqueio; (c) E2E: CS-520, CS-523, recordatório completo, envio pela consulta; axe |
| RNF-524 | Privacidade | Teste das chaves das respostas de API e dos payloads RSC do portal (só os campos da tela) e do push e do e-mail (CS-521); `logs.test.ts` cobre os módulos novos |
| RNF-525 | Manual | Guias novos `questionarios` (`/painel/questionarios`), `metas-modelos` (`/painel/metas`), `recordatorio` (`/painel/pacientes/[id]/anamnese/recordatorios…`) e passos novos nos guias `prontuario` (navegação da Anamnese, questionários) e `plano-alimentar` (seção Metas), e no guia do portal (cards de Hoje); versões sobem a partir da `main` do momento (`versao + 1`); `configuracoes` +1 pelos dois cartões. `/questionario/[token]` em `SEM_AJUDA` (página sem login) |

---

## 9. Modelo de dados

Uma migration **gerada** (colunas e tabelas, CHECKs, índices) e uma **custom** `rls_questionario_recordatorio_metas`
(RLS, auditoria, gatilhos, `REVOKE`, `staff_only`), numeradas no rebase (C-524), rodadas com `DATABASE_URL_MIGRATOR`
(regra 7). Tudo no PR 1 (QP-D27).

### 9.1 `anamnesis_templates` (muda)

| Coluna / restrição | Regras |
|---|---|
| `finalidade text not null default 'anamnese'` | CHECK `anamnesis_templates_finalidade_valida`: `in ('anamnese', 'questionario')`. Default permanente: a imagem antiga (boot e volta atrás) grava sem a coluna e continua criando anamnese |
| `envio_auto text null` | CHECK `in ('primeira', 'todas')` |
| `envio_auto_dias smallint null` | CHECK `between 1 and 7` |
| CHECK `anamnesis_templates_envio_auto_coerente` | `(envio_auto is null) = (envio_auto_dias is null) and (envio_auto is null or (finalidade = 'questionario' and arquivado_em is null))` |
| CHECK `anamnesis_templates_questionario_sem_ia` | `finalidade = 'anamnese' or ia_geracao_id is null` |
| índice `anamnesis_templates_padrao_idx` | **refeito**: `(tenant_id, finalidade) where padrao` (DROP/CREATE na gerada; as linhas atuais são todas `anamnese`, nada colide) |
| índice novo `anamnesis_templates_envio_auto_idx` | único `(tenant_id) where envio_auto is not null` |

- **`staff_only` novo** (QP-D25): `SELECT app_enable_staff_only('anamnesis_templates');` na custom + entrada em
  `STAFF_ONLY` ("Plano 27: modelos de anamnese e de questionário e a configuração do envio automático — o paciente
  recebe as perguntas pela cópia no envio"). Conferido no código: nenhuma leitura de `anamnesis_templates` em contexto
  de paciente (`anamnese.ts` e `ia/modelos-job.ts` só `nutri`/`worker`).
- Sem `patient_id`: sem auditoria (como hoje). O gatilho `anamnesis_templates_ia_origem` (0112) não muda.
- Sem migração de dados: as linhas atuais ficam `anamnese` pelo default.

### 9.2 `questionario_envios` (nova)

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()`; alvo do `entidade_id` da auditoria |
| `tenant_id`, `patient_id` | `uuid not null` | FK `(tenant_id, patient_id)` → `patients (tenant_id, id)` `NO ACTION`; UNIQUE `(tenant_id, patient_id, id)` |
| `appointment_id` | `uuid null` | FK `(tenant_id, patient_id, appointment_id)` → `appointments (tenant_id, patient_id, id)` `NO ACTION` (MATCH SIMPLE: nulo não é conferido) |
| `modelo_id` | `uuid null` | FK `(tenant_id, modelo_id)` → `anamnesis_templates (tenant_id, id)` `NO ACTION` (arquivar não apaga) |
| `modelo_snapshot` | `jsonb not null` | `{ nome, introducao?, perguntas }` (tipo `SnapshotQuestionario`); CHECK `jsonb_typeof = 'object'` |
| `origem` | `text not null` | CHECK `in ('nutri', 'automatico')`; CHECK `(origem = 'nutri') = (enviado_por is not null)` |
| `enviado_por` | `uuid null` | a usuária da sessão (sem FK, como `audit_log.actor_user_id`) |
| `enviado_em`, `expira_em` | `timestamptz not null` | CHECK `expira_em > enviado_em` |
| `situacao` | `text not null default 'enviado'` | CHECK `in ('enviado', 'respondido', 'cancelado', 'expirado')` |
| `respostas` | `jsonb null` | CHECK `respostas is null or (jsonb_typeof(respostas) = 'object' and octet_length(respostas::text) <= 600000)` |
| `respondido_em` | `timestamptz null` | gravado pelo gatilho (`clock_timestamp()`) |
| `respondido_via` | `text null` | CHECK `in ('app', 'link')` |
| CHECK `questionario_envios_resposta_coerente` | | `(situacao = 'respondido') = (respostas is not null and respondido_em is not null and respondido_via is not null)` |
| `cancelado_em`, `cancelado_por`, `cancelado_motivo` | `timestamptz null`, `uuid null`, `text null` | CHECK `cancelado_motivo in ('nutri', 'consulta_cancelada', 'paciente_bloqueado')`; CHECK `(situacao = 'cancelado') = (cancelado_em is not null and cancelado_motivo is not null)`; CHECK `cancelado_motivo is distinct from 'nutri' or cancelado_por is not null` |
| `anamnese_id` | `uuid null` | FK → `anamneses (id)` `NO ACTION`; CHECK `anamnese_id is null or situacao = 'respondido'`; UNIQUE parcial `where anamnese_id is not null` |
| `created_at`, `updated_at` | `timestamptz not null default now()` | — |

Índices: `questionario_envios_um_por_consulta` único `(tenant_id, appointment_id) where appointment_id is not null and
situacao in ('enviado', 'respondido')`; `questionario_envios_paciente_idx (tenant_id, patient_id, enviado_em desc)`;
`questionario_envios_abertos_idx (tenant_id, expira_em) where situacao = 'enviado'` (worker).

**Custom:**

```sql
SELECT app_enable_tenant_rls('questionario_envios');
SELECT app_enable_patient_rls('questionario_envios');
SELECT app_enable_audit('questionario_envios', 'questionario');
-- RN-529: o paciente (com e sem login) só responde, por UPDATE; o gatilho confere as colunas
SELECT app_allow_paciente_escrita('questionario_envios', 'update');
REVOKE DELETE, TRUNCATE ON questionario_envios FROM nutri_app_role;
-- questionario_envios_regras (BEFORE INSERT OR UPDATE), molde 0119/0116, tudo com IS DISTINCT FROM:
--   INSERT: só 'nutri' (origem 'nutri', enviado_por = app_current_user(), situacao 'enviado', sem respostas) ou
--           'worker'/'' (origem 'automatico'); demais papéis 42501
--   UPDATE, colunas fixas para todos: id, tenant_id, patient_id, modelo_id, modelo_snapshot, origem, enviado_por, enviado_em,
--           created_at; respostas, respondido_em e respondido_via nunca mudam depois de gravadas
--   'paciente': só enviado → respondido (RN-529), clock_timestamp() < OLD.expira_em, titular ativo e não anonimizado
--           (lê patients FOR KEY SHARE; NOT FOUND → 42501), respondido_em := clock_timestamp(),
--           respondido_via 'app' ⇔ app_current_user() IS NOT NULL; nenhuma outra coluna (to_jsonb(NEW) - lista = to_jsonb(OLD) - lista)
--   'nutri': enviado → cancelado (cancelado_por = app_current_user(), motivo 'nutri' ou, no bloqueio, 'paciente_bloqueado');
--           anamnese_id de nulo para valor só em 'respondido'; nada mais
--   'worker'/'': enviado → expirado (só com expira_em <= clock_timestamp()); enviado → cancelado (motivo 'consulta_cancelada',
--           cancelado_por nulo); com situacao 'enviado', troca de appointment_id e expira_em (remarcação, RN-535)
--   'publico', 'conta' e qualquer outro (inclusive 'recepcao'): 42501
```

- **Sem** `staff_only` (é dado do titular, que vê o envio e as próprias respostas), **sem** `app_allow_publico`.
- **Guardas** (`test/isolamento.test.ts`, só acrescentar): `FABRICAS` (envio `enviado`, sem consulta, `origem
  'automatico'` pelo contexto da fábrica), `SEM_DELETE`, `DELETE_REVOGADO`, `IMUTAVEIS` (comentário: "Plano 27:
  questionario_envios_regras recusa colunas fixas com 42501"), `UPDATE_DO_PACIENTE` (a fábrica deixa uma linha
  `enviado` para a sessão de paciente responder), filtro em `SO_APAGA.patients` (`and not exists (select 1 from
  questionario_envios …)`); não entra em `SO_INSERE` nem `COM_MAE`. Teste negativo: paciente sem conta lê só o envio
  do próprio `patient_id`.
- `rls-guard.ts`: `PACIENTE_ESCREVE` + `questionario_envios: { comandos: ['update'], motivo: 'Plano 27 (RN-529): o
  paciente responde o próprio questionário uma vez, no app ou pelo link (semConta) — só enviado → respondido, antes de
  expira_em (gatilho questionario_envios_regras)' }`.
- **Auditoria:** entidade `questionario` ("Questionário pré-consulta" em `ENTIDADE_ROTULO`). O `criar` aparece como
  "Enviou questionário" (ator = nutricionista; ator nulo = automático, mostrado como "Envio automático"); o `alterar` do
  paciente como "Respondeu questionário"; o `alterar` de ator nulo (expirar, cancelar pela consulta, remarcação) fica no
  `audit_log`, **fora** do Histórico de acessos (`visivelNoHistorico`, molde do Plano 15).

### 9.3 `recordatorios` e `recordatorio_itens` (novas)

**`recordatorios`**

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | — |
| `tenant_id`, `patient_id` | `uuid not null` | FK para `patients` `NO ACTION`; UNIQUE `(tenant_id, patient_id, id)` |
| `dia_relatado` | `date not null` | conferido no servidor (até hoje, 30 dias para trás) |
| `dia_atipico` | `boolean not null default false` | — |
| `observacao` | `text null` | CHECK `char_length between 1 and 2000` |
| `criado_por` | `uuid not null` | usuária da sessão |
| `created_at`, `updated_at` | `timestamptz` | — |

Índice `recordatorios_paciente_idx (tenant_id, patient_id, dia_relatado desc)`.

**`recordatorio_itens`**

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK (gerado no cliente, como `meal_items`) | — |
| `tenant_id`, `patient_id`, `recordatorio_id` | `uuid not null` | FK `(tenant_id, patient_id, recordatorio_id)` → `recordatorios (tenant_id, patient_id, id)` `ON DELETE CASCADE` |
| `refeicao` | `text not null` | CHECK na lista de `REFEICOES_DO_DIARIO` |
| `refeicao_nome` | `text null` | CHECK `(refeicao = 'Outro') = (refeicao_nome is not null)` e 2–40 |
| `horario` | `time null` | — |
| `local` | `text null` | 2–60 |
| `food_id` | `uuid null` | FK → `foods (id)` `ON DELETE SET NULL` (o item fica com o nome e os nutrientes congelados) |
| `alimento_nome` | `text null` | cópia do nome do alimento ao salvar (2–200) |
| `quantidade_g` | `numeric(7,2) null` | CHECK `between 0.1 and 5000` |
| `medida` | `jsonb null`, `medida_caseira_txt text null` | como `meal_items` |
| `nutrientes` | `jsonb null` | `NutrientesCongelados` (RN-541) |
| `descricao` | `text null` | item sem cadastro ou preparo, 1–200 (sem cadastro: 2–120) |
| `ordem` | `smallint not null` | — |
| CHECK `recordatorio_itens_tipo` | | `(alimento_nome is not null and quantidade_g is not null) or (food_id is null and alimento_nome is null and quantidade_g is null and nutrientes is null and descricao is not null)` |
| `created_at`, `updated_at` | `timestamptz` | — |

Índice `recordatorio_itens_recordatorio_idx (tenant_id, recordatorio_id, ordem)`; `recordatorio_itens_alimento_idx (food_id)`.

**Custom:**

```sql
SELECT app_enable_tenant_rls('recordatorios');      SELECT app_enable_patient_rls('recordatorios');
SELECT app_enable_audit('recordatorios', 'recordatorio');
SELECT app_enable_tenant_rls('recordatorio_itens'); SELECT app_enable_patient_rls('recordatorio_itens');
SELECT app_enable_audit('recordatorio_itens', 'recordatorio');
-- QP-D17: o recordatório não é apagado (os itens sim, na edição; e em cascata de um DELETE que o código não faz)
REVOKE DELETE, TRUNCATE ON recordatorios FROM nutri_app_role;
-- recordatorios_colunas_fixas (BEFORE UPDATE): tenant_id, patient_id, criado_por, created_at fixos (42501)
```

- **Sem** `staff_only` (dado do titular; o portal não lê na v1, QP-D16); sem escrita do paciente (nega por
  `app_enable_tenant_rls`); sem `publico`.
- **Guardas:** `FABRICAS` (`recordatorios`; `recordatorio_itens` em `COM_MAE`, a mãe criada no mesmo comando),
  `SEM_DELETE` e `DELETE_REVOGADO` (`recordatorios`), `IMUTAVEIS` (`recordatorios`), `ULTIMAS` se a FK em cascata pedir
  (conferir na tarefa), filtro em `SO_APAGA.patients` (`recordatorios`). `foods` não muda (a FK `SET NULL` é da filha).
- **Auditoria:** entidade `recordatorio` ("Recordatório alimentar").

### 9.4 `metas_modelos`, `metas_paciente` e `metas_registros` (novas)

**`metas_modelos`** (sem `patient_id`)

| Coluna | Tipo | Regras |
|---|---|---|
| `id`, `tenant_id` | `uuid` | UNIQUE `(tenant_id, id)` |
| `titulo` | `text not null` | 3–80; UNIQUE `(tenant_id, lower(titulo)) where arquivado_em is null` |
| `como_fazer` | `text null` | 1–300 |
| `categoria` | `text not null` | CHECK `in ('agua', 'alimentacao', 'atividade', 'sono', 'habitos', 'outra')` |
| `lembrete_sugerido` | `text null` | CHECK `in ('agua', 'refeicoes', 'suplemento', 'livre')` (os tipos do Plano 17) |
| `arquivado_em`, `created_at`, `updated_at` | `timestamptz` | — |

Custom: `app_enable_tenant_rls` + `app_enable_staff_only`; `STAFF_ONLY` ("Plano 27: biblioteca de metas do
consultório — o paciente recebe a cópia em metas_paciente"); `FABRICAS`. Sem auditoria (sem paciente).

**`metas_paciente`**

| Coluna | Tipo | Regras |
|---|---|---|
| `id`, `tenant_id`, `patient_id` | `uuid` | FK para `patients` `NO ACTION`; UNIQUE `(tenant_id, patient_id, id)` |
| `modelo_id` | `uuid null` | sem FK (só informativo, como `lista_origem_id` do 19) |
| `titulo`, `como_fazer`, `categoria`, `lembrete_sugerido` | | como `metas_modelos` |
| `inicio` | `date not null` | — |
| `fim` | `date null` | CHECK `fim is null or (fim >= inicio and fim <= inicio + 365)` |
| `situacao` | `text not null default 'ativa'` | CHECK `in ('ativa', 'alcancada', 'encerrada')` |
| `encerrada_em` | `timestamptz null` | CHECK `(situacao = 'ativa') = (encerrada_em is null)` |
| `criado_por` | `uuid not null` | — |
| `created_at`, `updated_at` | `timestamptz` | — |

Índice `metas_paciente_ativas_idx (tenant_id, patient_id) where situacao = 'ativa'`.

**`metas_registros`**

| Coluna | Tipo | Regras |
|---|---|---|
| `id`, `tenant_id`, `patient_id` | `uuid` | — |
| `meta_id` | `uuid not null` | FK `(tenant_id, patient_id, meta_id)` → `metas_paciente (tenant_id, patient_id, id)` `NO ACTION` |
| `dia` | `date not null` | UNIQUE `metas_registros_um_por_dia (tenant_id, meta_id, dia)` |
| `cumprida` | `boolean not null` | — |
| `registrado_em`, `atualizado_em` | `timestamptz not null` | gatilho (`clock_timestamp()`) |

Índice `metas_registros_meta_idx (tenant_id, meta_id, dia desc)`.

**Custom:**

```sql
SELECT app_enable_tenant_rls('metas_paciente');  SELECT app_enable_patient_rls('metas_paciente');
SELECT app_enable_audit('metas_paciente', 'metas');
REVOKE DELETE, TRUNCATE ON metas_paciente FROM nutri_app_role;
-- metas_paciente_regras (BEFORE UPDATE): id, tenant_id, patient_id, inicio (depois do 1º registro), criado_por, created_at
--   fixos; 'ativa' → 'alcancada'|'encerrada' sem volta; só 'nutri' e ''/'worker' gravam (o paciente já é negado pela RLS)
SELECT app_enable_tenant_rls('metas_registros'); SELECT app_enable_patient_rls('metas_registros');
SELECT app_enable_audit('metas_registros', 'metas');
SELECT app_allow_paciente_escrita('metas_registros', 'insert', 'update');
REVOKE DELETE, TRUNCATE ON metas_registros FROM nutri_app_role;
-- política RESTRICTIVE paciente_meta_registro_com_conta (FOR ALL): app_current_role() IS DISTINCT FROM 'paciente'
--   OR app_current_user() IS NOT NULL (o link sem login nunca registra meta; molde patient_cadastro_paciente_com_conta)
-- app_hoje_do_tenant() STABLE: (now() AT TIME ZONE tenants.fuso)::date do tenant de app.tenant_id
-- metas_registros_regras (BEFORE INSERT OR UPDATE): RN-547 (só 'paciente'; o contexto vazio '' da migration passa;
--   'worker' e os demais papéis 42501); a meta é lida FOR KEY SHARE pela RLS do paciente (NOT FOUND → 42501)
```

- **Guardas:** `FABRICAS` (`metas_modelos`, `metas_paciente`; `metas_registros` em `COM_MAE` com a meta),
  `SEM_DELETE` e `DELETE_REVOGADO` (`metas_paciente`, `metas_registros`), `IMUTAVEIS` (`metas_paciente`,
  `metas_registros`), `UPDATE_DO_PACIENTE` (`metas_registros`, com o `dia` de hoje da fábrica), filtro em
  `SO_APAGA.patients`; `PACIENTE_ESCREVE` + `metas_registros: { comandos: ['insert', 'update'], motivo: 'Plano 27
  (RN-547): o paciente com login registra a própria meta de hoje ou de ontem — só cumprida muda; sem DELETE (gatilho
  metas_registros_regras)' }`.
- **Auditoria:** entidade `metas` ("Metas"); "Registrou meta" no Histórico para o `criar`/`alterar` do paciente.
  Volume aceito: uma linha de `audit_log` por toque (molde do diário, também auditado).

### 9.5 `notifications` (muda)

CHECK `notifications_tipo_valido` + `questionario_novo` (DROP/ADD da gerada, partindo do CHECK da `main` na
regeneração: o 23 acrescenta `aniversario`, `pedido_nao_confirmado`; o 25, os do chat). `TipoNotificacao`,
`ROTULO_TIPO` ("Questionário") e `AVISOS_DO_PORTAL` acrescentados no fim. Não entra em `CONTA_COTA` (não é WhatsApp)
nem em `TIPOS_DA_AGENDA` do 26 (a recepção não vê).

### 9.6 Ordem das migrations e listas

1. **Gerada**: colunas e índices de `anamnesis_templates`; as seis tabelas; CHECK de `notifications`. Sem edição à mão.
2. **Custom** `rls_questionario_recordatorio_metas`: tudo das §9.1 a §9.4, `app_hoje_do_tenant()`, gatilhos e `REVOKE`.

- `FUNCOES_COM_PAPEL` (se o 26 estiver na `main`): `app_questionario_envios_regras`, `app_metas_registros_regras`,
  `app_metas_paciente_regras`, `app_recordatorios_colunas_fixas` → **"não se aplica (tabela negada à recepção)"**.
- `CLAUDE.md`: **regra 2** — frase "Plano 27" no fim (as três tabelas com escrita do paciente e os gatilhos;
  `anamnesis_templates` e `metas_modelos` em `STAFF_ONLY`; `recordatorios` e `metas_*` sem DELETE); **regra 8** —
  entidades `questionario`, `recordatorio` e `metas`, as leituras que gravam e as que não (RN-530, RN-544, RN-548) e a
  abertura do link com ator nulo e IP.
- `src/db/schema/`: arquivo novo `questionarios-metas.ts` (as seis tabelas), colunas em `pacientes.ts`; reexporta em
  `index.ts` (só acrescentar).

---

## 10. Normas profissionais e LGPD (o essencial)

| Tema | Como a spec atende |
|---|---|
| **Conteúdo do prontuário** (Res. CFN 594/2017, art. 4º, § 1º, IV, conferida em 17/11/2026 no texto do CFN: "anamnese alimentar e nutricional" com "aplicação de inquérito de consumo alimentar") | O recordatório é o inquérito de consumo; o questionário respondido é parte da anamnese, guardado no prontuário com autor, data e canal; "Copiar para uma anamnese" deixa a nutricionista responsável pelo registro clínico, sem apagar o que o paciente relatou |
| **Acompanhamento** (Res. CFN 594/2017, art. 5º: evolução e alteração da conduta) | Metas e adesão ficam no prontuário, exportadas e impressas na cópia |
| **Guarda de 20 anos** (Res. CFN 594/2017, art. 3º, VI, "b") | Nada é apagado: envios, recordatórios e metas sem DELETE; anonimização não toca (RN-536, RN-550) |
| **Sigilo** (Código de Ética, Res. CFN 599/2018, art. 20, I; Res. CFN 856/2026 a partir da vigência) | Push e e-mail neutros (RN-526, RN-551); link pessoal com MAC do e-mail; a recepção não vê (QP-D12); o nome do modelo não sai do prontuário |
| **Base legal** (LGPD, art. 11, II, "f": tutela da saúde por profissional de saúde) | Coleta pela nutricionista para o atendimento; o aviso do formulário diz para onde vão as respostas (art. 9º, transparência); só adultos (C-523) |
| **Minimização e finalidade** (LGPD, art. 6º, I e III) | Questionário inicial com perguntas para a consulta; nenhuma pergunta obrigatória além do motivo; sem etnia ou religião nas sugestões; nada à IA (RN-552) |
| **Acesso do titular** (LGPD, art. 18, II) | Respostas, recordatórios e metas no `dados.json` e no `prontuario.pdf` (RN-553); o paciente com login vê as próprias respostas |
| **Segurança** (LGPD, art. 46) | RLS por tenant e paciente, `recepcao_negada`, `publico_negado`, gatilhos por papel, auditoria de escrita e de leitura, link sem estado com validade e limite por IP |
| **Telenutrição** (Res. CFN 666/2020) | O questionário é coleta prévia, não consulta: a avaliação continua na consulta. Artigos a conferir pelo `normas-cfn-lgpd` na revisão (pendência P-Q1) |
| **Publicidade e conteúdo de terceiros** | Questionário, perguntas e metas iniciais escritos por nós (§6.3); nada copiado do Dietbox |

---

## 11. Boas práticas SBIS NGS1

- **Autoria e data** de todo registro (`enviado_por`/origem, `respondido_em` e canal, `criado_por`, `registrado_em`
  pelo relógio do banco) e trilha em `audit_log` com ator e IP.
- **Integridade**: snapshot do modelo no envio; respostas imutáveis; nutrientes congelados no recordatório.
- **Não repúdio do relato do paciente**: o que ele enviou fica como enviou; a nutricionista registra a própria leitura na anamnese.
- **Controle de acesso por papel** no banco (RLS, `staff_only`, `recepcao_negada`) e na tela.

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-520 | Link do e-mail encaminhado: outra pessoa responde no lugar do paciente | Link pessoal (MAC com o e-mail, "Não encaminhe"), uso único pelo estado, validade curta; a página não mostra dado já gravado (QP-D6); a nutricionista confere na consulta |
| R-521 | Link com código de 6 dígitos seria mais forte | Decisão QP-D6 com o precedente do Plano 14A; se o CRN-3 ou o advogado pedirem, o código do `link-documento.ts` entra sem mudar a tabela (P-Q2) |
| R-522 | Paciente perde respostas longas sem rascunho | Aviso no topo e ao sair; validação sem perder o digitado; 12 perguntas no padrão |
| R-523 | Envio automático duplicado em duas rodadas ou dois workers | Índice único por consulta + `ON CONFLICT DO NOTHING`; teste de concorrência |
| R-524 | Avalanche de e-mail ao ligar o automático num consultório com muitas consultas | Janela de no máximo 7 dias; lote de 200; a fila de e-mail já tem vazão controlada |
| R-525 | Filtro `finalidade` esquecido em alguma leitura de anamnese (questionário aparece no seletor da anamnese) | Lista fechada na §4.2; teste "modelo de questionário não aparece em `listarModelosUsaveis` nem é aceito por `preencherAnamnese`" |
| R-526 | `staff_only` em `anamnesis_templates` quebra leitura escondida em contexto de paciente | Conferido no código (§9.1); a suíte de isolamento e o E2E do portal rodam no PR 1 |
| R-527 | Recordatório entra antes do Plano 19 | QP-D14: PR 2 depois do 19; se o 19 atrasar, macros e fibra só, com `NutrientesCongelados` de hoje e o caminho do micro desligado |
| R-528 | Volume de `audit_log` com o registro diário de metas | Uma linha por toque, como o diário; teto de 8 metas; índice existente do `audit_log` |
| R-529 | A recepção marca consultas e espera ver o questionário | QP-D12; texto do guia da recepção (Plano 26) diz que o questionário é da nutricionista |
| R-530 | Hoje mais pesada com dois cards | RNF-521: duas consultas na transação da faixa, cenário na pilha de carga |
| R-531 | Conflito em `consultas/[id]/page.tsx` com 20 PR 2, 23 e 26 | Bloco em componente próprio (`questionario-da-consulta.tsx`) e uma linha na página; ramo por papel do 26 o esconde |
| R-532 | Fuso: "hoje" do servidor (UTC) diferente do consultório à noite | `app_hoje_do_tenant()` no banco e `hojeNoFuso` no código; teste às 22h BRT |
| R-533 | Remarcação feita por fluxo que não preenche `remarcada_de` | O envio aberto vence no início da antiga e o automático (se ligado) cria um novo; manual: "Reenviar" |
| R-534 | Nome do modelo com condição de saúde aparece em tela de lista | Só dentro da aba (auditado, RN-530); Início, push, e-mail e `<title>` do link nunca (RN-528, RN-551) |

---

## 13. Conflitos com sessões paralelas

Conferido em 17/11/2026 nos worktrees `nutridebby-b` (19, 67b21d3), `nutridebby-c` (20 e 23), `nutridebby-21`,
`nutridebby-22`, `nutridebby-25` e `nutridebby-26`. Os branches andam: reconferir na T1 e antes de cada PR.

| Onde | Quem | Conflito | Como resolver |
|---|---|---|---|
| `drizzle/` | 19, 21, 22, 23, 25, 26 | Números e journal | §5 de `sessoes-paralelas.md`: gerar de novo sobre a `main`; um só PR com migration (QP-D27) |
| `app_enable_tenant_rls` e `recepcao_negada` | 26 | As tabelas novas precisam nascer negadas à recepção | Se o 26 PR 2 entrou antes: o `app_enable_tenant_rls` dele já nega; se entrar depois: o laço da migration dele nega. Em qualquer ordem, o teste de isolamento do 27 roda a sessão `recepcao` quando o papel existir |
| `FUNCOES_COM_PAPEL` (`rls-guard.ts`) | 26 | Quatro funções novas olham o papel | Quem entra depois acrescenta (§9.6); a guarda do 26 quebra sem a decisão |
| `src/app/painel/agenda/consultas/[id]/page.tsx` | 20 PR 2 ("Cobrança"), 23 (local, Aceitar/Recusar), 26 (ramo da recepção) | Bloco "Questionário pré-consulta" | Componente próprio e **uma linha** na página; só na sessão `nutri` (se o 26 entrou, fica dentro do ramo da nutricionista) |
| `appointments.status` (`solicitada`) e `remarcada_de` | 23 | RN-533 e RN-535 leem a situação | Filtro por lista positiva (`agendada`, `confirmada`): `solicitada` fica fora sem mudança; RN-535 conferida com o fluxo de remarcação do 23 no rebase |
| CHECK `notifications_tipo_valido`, `tipos.ts`, `mensagens.ts` | 23 (`aniversario`, `pedido_nao_confirmado`), 25 (tipos do chat), 26 (`TIPOS_DA_AGENDA`) | Tipo `questionario_novo` | Partir do CHECK da `main` na regeneração e juntar as listas; só acrescentar no fim; fora de `TIPOS_DA_AGENDA` (o teste do 26 obriga a decisão) |
| `src/email/types.ts`, `templates.tsx` | 23 (avisos sem consulta, `headers?`), 25 | Modelo `questionario_link` | Só acrescentar |
| `SECOES_DA_FICHA` (`ficha/secoes/index.ts`) | 20 (Financeiro), 23 (Consultas), 25 (Mensagens) | Três seções novas | Três linhas no fim, nesta ordem; quem entra depois rebaseia |
| `ficha/tipos.ts` (`GrupoDoAdicionar`, `ChaveDeAcao`) | 22 (ação nova em Documentos) | Nada novo no contrato (destinos por `href`) | Sem mudança de contrato |
| `src/app/painel/pacientes/[id]/plano-alimentar/page.tsx` | 19 (editor, "Ligado ao plano"), 17 (já na `main`) | Uma linha `<SecaoMetas>` antes de `<SecaoLembretes>` | Só acrescentar a linha; PR 2 depois do 19 (QP-D14) |
| `src/app/painel/pacientes/[id]/anamnese/*` | ninguém da onda (conferido: 21 e 22 não tocam) | Navegação da Anamnese, páginas novas | Livre |
| `anamnese.ts`, `anamnese-tipos.ts`, editor de modelos | 14B (já na `main`); ninguém da onda | Filtro de finalidade, `introducao` | Livre; `ia/modelos-job.ts` continua só com anamnese (teste) |
| `src/modules/plano-alimentar/calculo.ts`, `NutrientesCongelados`, `lerCongelados`, `BuscaAlimento`, `DialogoBuscaAlimento` | 19 | O recordatório importa | **Só importar**, sem mudar; PR 2 depois do merge do 19 |
| `src/app/p/(portal)/inicio/page.tsx`, `src/modules/portal/hoje.ts`, `src/app/p/navegacao.ts` | 25 (link "Mensagens" na faixa, contadores), 23 ("Aguardando confirmação" no portal) | Dois cards em Hoje; `tambem` de Jornada e Plano | Cards em componentes próprios; só acrescentar no `tambem`; a leitura nova entra no fim de `faixaDeHoje` |
| `src/app/sw-regras.ts` | 25 (`/p/mensagens` só rede) | Rotas novas só rede | Só acrescentar |
| `lgpd.ts`, `exportacao-job.ts`, `prontuario-pdf.tsx`, `exportacao.test.ts` | 19, 20, 21, 22, 23, 25 | Bloqueio (RN-536, RN-550), exportação (RN-553) | Só acrescentar blocos; no `UPDATE` do bloqueio, as duas linhas novas depois das dos outros planos |
| `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `audit.ts` (`ENTIDADE_ROTULO`), `CLAUDE.md` | todos | Entradas novas | Só acrescentar no fim de cada bloco; no `CLAUDE.md`, ficar com a linha da `main` e reacrescentar a frase "Plano 27" |
| `src/jobs/queues.ts`, `src/worker/index.ts` | 19, 22, 23, 25 | Fila `questionarios-automaticos` | Só acrescentar |
| `src/app/painel/configuracoes/page.tsx` (`CARTOES`) | 19, 22, 23, 26 | Dois cartões | Só acrescentar no fim |
| `src/modules/ajuda/conteudo.ts`, `portal.ts` (+ testes) | 18 a 26 | Guias novos e versões | Só acrescentar guias; versão = `main` + 1 no rebase |
| `scripts/e2e-seed.ts`, `e2e/painel-rotas.ts`, `e2e/acessibilidade-painel.spec.ts` | todos | Rotas e dados novos | Rebase; o E2E do link usa paciente próprio |
| Planos 28 e 29 (onda 4) | 28 (painel inicial: cartões), 29 (PD-125: questionário em branco em PDF) | O 28 pode querer um cartão "Questionários respondidos"; o 29 imprime o modelo de questionário | Avisar as sessões: o 29 lê `anamnesis_templates` com `finalidade = 'questionario'` e o snapshot (`ModeloSchema` com `introducao`); o 28 conta envios pelo módulo `questionarios/envios.ts` (sem `auditRead`: só contagem) |
| Numeração | 25 (440–479), 26 (480–519), 28 (560–599), 29 (600–639) | — | O 27 fica no 520–559 |

**Ordem:** PR 1 (banco inteiro + questionário) entra na fila de migration depois do que estiver na frente (o 26 PR 2
é o último da onda 3); PR 2 (recordatório e metas, **sem migration**) depois do PR 1 e do merge do Plano 19.

---

## 14. Decisões (delegadas pelo dono, onda 4: "seguir as recomendações sem parar para perguntar")

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| **QP-D1** | **Nenhuma aba nova**: questionários e recordatórios na aba **Anamnese** (navegação interna "Anamneses · Questionários · Recordatórios"); metas na aba **Plano alimentar**, acima dos lembretes | A 14ª aba não cabe (R-266 do 18); a norma põe os dois primeiros na anamnese alimentar (Res. 594, art. 4º, § 1º, IV); metas são conduta, ao lado do plano e dos lembretes | §4.1 |
| **QP-D2** | Modelos de questionário são linhas de **`anamnesis_templates` com `finalidade = 'questionario'`**, no mesmo editor, com rota própria (`/painel/questionarios`) | Pedido do briefing (reaproveitar o motor); separar a finalidade evita o modelo escrito para a nutricionista ("Paciente refere…") ir ao paciente e o questionário aparecer no seletor da anamnese; tabela nova duplicaria editor, validação e snapshot | §9.1, RN-520 |
| **QP-D3** | **Questionário inicial pronto** ("Questionário pré-consulta", 12 perguntas, texto nosso), criado sob demanda como padrão | Primeiro envio em um clique; molde do "Anamnese geral"; nada copiado do Dietbox | §6.3, RN-522 |
| **QP-D4** | As **respostas ficam no envio** (`questionario_envios.respostas`), imutáveis, e **não** viram anamnese sozinhas; "Copiar para uma anamnese" cria a anamnese editável e liga as duas | Fidelidade ao relato do paciente (prova do que ele disse) e responsabilidade da nutricionista pelo registro clínico; evita dar ao paciente escrita em `anamneses` (`PACIENTE_ESCREVE`, gatilho novo numa tabela antiga); o envio já é prontuário (auditado, exportado, guardado) | RN-529, RN-531 |
| **QP-D5** | **Snapshot do modelo no envio** | Mudar ou arquivar o modelo não muda o que foi perguntado (mesma regra da anamnese, US-012) | §9.2 |
| **QP-D6** | Resposta pelo **link sem login e sem código de 6 dígitos**; a página **nunca** mostra respostas já enviadas nem dado do prontuário; uso único pelo estado; MAC com o e-mail atual | Precedente do Plano 14A (decisão do dono de 08/10: página sem dado de saúde gravado não pede código, e o código iria ao mesmo e-mail); o código cabe depois sem mudar tabela (R-521) | RN-527, RN-528 |
| **QP-D7** | **Sem rascunho no servidor**; aviso no topo e ao sair | Rascunho no servidor seria escrita repetida do paciente sem login (mais superfície) e dado parcial no prontuário; no navegador, dado de saúde ficaria em aparelho compartilhado | §6.2 |
| **QP-D8** | **Envio manual** (ficha e consulta) **e automático** opcional, configurado no próprio modelo, um por consultório, `primeira` ou `todas`, 1 a 7 dias antes, feito pelo **worker** | "Ligado ao agendamento" sem tocar nos fluxos de marcação (nutri, paciente, público, recepção, Plano 23): o worker vê toda consulta, em qualquer origem; configuração no modelo evita coluna nova em `tenants` (disputada com 23 e 26) | RN-532, RN-533 |
| **QP-D9** | **Um** envio aberto ou respondido **por consulta** | Evita duplicar o automático e o manual; um questionário por consulta é o caso de uso | §9.2 |
| **QP-D10** | Validade = **início da consulta** (sem consulta, 14 dias); remarcação leva o envio aberto; cancelamento cancela | É pré-consulta; resposta depois do início não serve à preparação; a remarcação não deve obrigar o paciente a começar de novo | RN-524, RN-534, RN-535 |
| **QP-D11** | Avisos por **e-mail com o link** e **push neutro**; **sem WhatsApp** e sem lembrete de cobrança na v1 | Sem custo (C-521); WhatsApp pede modelo aprovado e conta na cota; cobrança automática fica para depois de medir a taxa de resposta | RN-526 |
| **QP-D12** | **Recepção**: tabelas negadas; o bloco da consulta não aparece para ela; o envio automático cobre as consultas que ela marca | Questionário e respostas são dado de saúde; a recepção é administrativa (Plano 26, RN-505); o automático resolve o fluxo sem dar acesso | RN-539, RN-554 |
| **QP-D13** | Recordatório em **tabelas próprias** (`recordatorios`, `recordatorio_itens`), com a **mesma conta** de `calculo.ts` e os mesmos alimentos | `meal_items` tem FK para plano e regras de publicação; reusar a função pura dá o mesmo número (CS-522) sem misturar prescrição com consumo | §9.3 |
| **QP-D14** | **Nutrientes congelados** ao salvar no formato do Plano 19, e **PR 2 depois do merge do 19** | Fidelidade do prontuário (editar "Meu alimento" não muda o passado); micros, fontes e `lerCongelados` nascem no 19, e duplicá-los seria conflito certo | RN-541, C-527 |
| **QP-D15** | Comparar com a **meta do plano publicado** (faixas do plano) e com o **último GET** (diferença, sem cor) | São as duas referências que a nutricionista já tem; `contextoDoPaciente` já audita; perfis de referência de micronutrientes do 19 ficam para depois | RN-543 |
| **QP-D16** | Recordatório **só da nutricionista**; o paciente **não** vê no app (vê na exportação) | É instrumento de avaliação aplicado na consulta; o diário já é o registro do paciente; no app, números de consumo sem a leitura da nutricionista confundem | §3 |
| **QP-D17** | **Nada é apagado**: envio (cancelar), recordatório (editar) e meta (encerrar), com `REVOKE DELETE` | Prontuário guardado 20 anos; correção pela edição auditada, como a anamnese | RN-537 |
| **QP-D18** | **Biblioteca de metas** do consultório (`staff_only`) e **sugestões nossas** por botão; a meta do paciente é **cópia** | Rapidez sem impor conteúdo; o botão não reaparece depois de usado; cópia protege o histórico do paciente | RN-545 |
| **QP-D19** | Registro diário **"Cumpri" / "Não cumpri"**, **hoje e ontem**, só pelo **paciente com login** | Esquecer de marcar à noite é comum (ontem); mais para trás vira memória pouco confiável; a equipe marcar em nome dele falsearia a adesão; sem login, não há quem identifique o paciente | RN-547 |
| **QP-D20** | Meta **todos os dias**, sem quantidade e sem dias da semana na v1 | O exemplo do briefing ("2 L por dia") cabe em sim/não; quantidade pede unidade, validação e gráfico; dias da semana dependem do `app_dias_semana_validos` do 19 (backlog) | §2.2 |
| **QP-D21** | **Sem push própria de meta** e sem vínculo no banco com o lembrete; o modelo **sugere** um tipo de lembrete e a tela leva à seção do Plano 17 | O Plano 17 já tem push, janela e teto de 24 por dia; um segundo canal disputaria o teto; o atalho dá a ligação pedida ("pode ligar aos lembretes") sem tocar no Plano 17 | RN-549 |
| **QP-D22** | Até **8 metas ativas** por paciente | Hoje do app legível no celular; adesão é melhor com poucas metas | RN-546 |
| **QP-D23** | Auditoria com três entidades (`questionario`, `recordatorio`, `metas`); registros do paciente **auditados** | Regra 8: escrita de dado de saúde; adesão a meta é dado de saúde; `content_views` é exceção por ser uso de conteúdo, não relato clínico | §9 |
| **QP-D24** | **Nada vai à IA** | RN-109 (Plano 14A): mudar o que é enviado pede versão nova da autorização; fica no backlog com o pedido do dono | RN-552 |
| **QP-D25** | `anamnesis_templates` ganha **`staff_only`** | Hoje a sessão de paciente lê todos os modelos do consultório (sem uso no portal); com a configuração do envio automático e os questionários na mesma tabela, a defesa custa uma linha e o paciente recebe as perguntas pelo snapshot | §9.1 |
| **QP-D26** | O paciente com login vê **"Suas respostas"** (auditado); pelo link, não | Direito de acesso (LGPD, art. 18, II) sem abrir dado de saúde em página sem login (QP-D6) | RN-530 |
| **QP-D27** | **Dois PRs**: PR 1 = banco inteiro (as seis tabelas, `anamnesis_templates`, `notifications`) + questionário; PR 2 = recordatório e metas, **sem migration** | Um só lugar na fila de migration (§5 de `sessoes-paralelas.md`); o PR 2 espera o 19 sem segurar o questionário | §13 |
| **QP-D28** | Questionário no portal na seção **Jornada** e metas na seção **Plano** (pelo `tambem`), com cards em Hoje; nenhuma seção nova | Layout G do Plano 16 tem 5 seções fixas; o questionário é da consulta (Jornada), a meta é da conduta (Plano) | §4.7 |
| **QP-D29** | Rotas novas do portal e do link **só rede** no service worker | Dado de saúde e estado que muda a cada toque | §4.7 |
| **QP-D30** | O nome do modelo aparece ao paciente **só dentro** do formulário dele; nunca em push, e-mail, `<title>` do link ou no Início da ficha | O nome pode dizer uma condição ("gestante"); dentro do formulário é para o próprio titular | RN-528 |
| **QP-D31** | Recordatório com **dia relatado** até 30 dias para trás e **"Dia fora do comum"** | O método pede o dia anterior típico; registrar a atipicidade evita conclusão errada; 30 dias cobre consulta remarcada | US-526 |
| **QP-D32** | **Salvar por botão** no recordatório (sem autosave) | É registro clínico datado e auditado; autosave geraria uma linha de auditoria por digitação | §7 |

---

## 15. Pendências ★ (não travam a v1)

| ID | Pendência | Com quem |
|---|---|---|
| P-Q1 | Conferir os artigos da Res. CFN 666/2020 (telenutrição) aplicáveis à coleta prévia por questionário | `normas-cfn-lgpd` na revisão |
| P-Q2 | Link do questionário sem código: confirmar com o CRN-3/advogado (vai à lista de `pendencias-consulta-crn3`) | Dono |
| P-Q3 | Lembrete de cobrança do questionário não respondido (e-mail 24 h antes), depois de medir a taxa de resposta | Backlog |
| P-Q4 | Metas com quantidade e dias da semana; recordatório a partir do diário; IA lendo questionário | Backlog |

---

## 16. Pontos para o plano (PM)

| ID | Ponto |
|---|---|
| PM-Q1 | T1: reconferir os worktrees (§13), o CHECK de `notifications` e `app_enable_tenant_rls` da `main` do momento; decidir se o 26 PR 2 já entrou (muda os testes da sessão `recepcao` e `FUNCOES_COM_PAPEL`) |
| PM-Q2 | Tarefa do banco **primeiro** (PR 1): schema, gerada, custom, guardas (`rls-guard`, `audit-guard`, isolamento com os papéis), `ENTIDADE_ROTULO`, `CLAUDE.md` — revisor `revisor-rls` |
| PM-Q3 | `anamnese.ts`: filtro de finalidade em todas as funções antes de qualquer tela (teste R-525) |
| PM-Q4 | Telas de modelos de questionário (`/painel/questionarios`) reaproveitando `ModeloEditor` com `introducao` e o cartão do automático |
| PM-Q5 | Envio manual (ficha e consulta), e-mail, push, link assinado e as duas páginas de resposta (app e link) |
| PM-Q6 | Worker `questionarios-automaticos` (RN-533 a RN-535) com testes de janela, fuso e concorrência |
| PM-Q7 | Respostas no painel, "Copiar para uma anamnese", seção "Questionários" no Início, `noApp` e paridade |
| PM-Q8 | PR 2: recordatório (módulo puro, formulário, totais, comparação, micros do 19), seção no Início |
| PM-Q9 | PR 2: metas (biblioteca, sugestões, seção no Plano alimentar, detalhe de 30 dias), seção no Início |
| PM-Q10 | PR 2: portal (Hoje, `/p/metas`, `/p/questionarios/[id]` com "Suas respostas"), `navegacao.ts`, `sw-regras.ts` |
| PM-Q11 | LGPD (exportação, `prontuario.pdf`, bloqueio), IA (guarda de fonte), logs, chaves (CS-521) |
| PM-Q12 | Fechamento: manual guiado (guias e versões), axe, manual técnico (caps. 02, 04, 05, 06), manual do usuário (Docs), Central de Ajuda, backlog; revisores `normas-cfn-lgpd`, `revisor-interface`, `guardiao-manual` |

---

## 17. Critérios de aceite do plano (resumo para o fechamento)

- [ ] US-520 a US-531 com os cenários passando (integração ou E2E).
- [ ] CS-520 a CS-524 medidos.
- [ ] Guardas verdes: `rls-guard.test.ts` (STAFF_ONLY, PACIENTE_ESCREVE, publico, recepção se houver), `audit-guard.test.ts`, `test/isolamento.test.ts`, `sem-conta-guarda.test.ts`, `campos-enviados.test.ts`, `logs.test.ts`, guarda de páginas do manual guiado.
- [ ] Nenhum `audit_log` com conteúdo; `auditRead` exatamente onde a RN-530, a RN-544 e a RN-548 mandam.
- [ ] axe sem violação nas telas novas (claro e escuro, 1280 e 360 px).
- [ ] Manual técnico, manual do usuário, Central de Ajuda e `CLAUDE.md` atualizados.

---

## 18. Referências

- Res. CFN 594/2017 (prontuário): arts. 2º, 3º (VI, "b"), 4º (§ 1º, IV) e 5º — https://cfn.org.br/wp-content/uploads/resolucoes/Res_594_2017.htm (conferida em 17/11/2026).
- Res. CFN 599/2018 (Código de Ética), art. 20, I; Res. CFN 856/2026 (novo Código, vigência pela Res. CFN 858/2026) — memória do agente `normas-cfn-lgpd`.
- Res. CFN 666/2020 (telenutrição) — artigos a conferir (P-Q1).
- LGPD (Lei 13.709/2018): arts. 6º (I, III), 9º, 11 (II, "f"), 18 (II) e 46.
- Código: `src/modules/pacientes/anamnese*.ts`, `src/modules/plano-alimentar/{calculo,meta,publicacao}.ts`, `src/modules/ia/autorizacao-token.ts`, `src/modules/documentos/link-documento.ts`, `src/modules/ficha/tipos.ts`, `src/modules/lembretes/*`, `src/modules/notificacoes/{tipos,mensagens}.ts`, `src/app/p/navegacao.ts`, `src/db/rls-guard.ts`, `test/isolamento.test.ts` (`main` 07756c4).
- Specs dos Planos 17, 18 (na `main`), 19 (`nutridebby-b`), 23 (`nutridebby-c`), 25 (`nutridebby-25`) e 26 (`nutridebby-26`).
