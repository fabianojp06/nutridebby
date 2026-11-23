# NutriDebby — Questionário pré-consulta, recordatório e metas (Plano 27) — Design

| Item | Valor |
|---|---|
| Versão | 0.3 (17/11/2026: revisão do plano aplicada — `revisor-rls` (14 Minor) e crítica de completude (26 itens) —; consulta movida, link com consultório e titular ativos, meta terminada, dia do registro no banco, textos que faltavam; §19.4). 0.2 (17/11/2026: painel de revisão aplicado — `revisor-rls` (1 Critical, 6 Important), `normas-cfn-lgpd` (4 Important) e `revisor-interface` (16 Important) —; o que entrou, o que foi descartado e por quê na §19). Plano: [`2026-11-17-nutridebby-27-questionario-recordatorio-metas.md`](../plans/2026-11-17-nutridebby-27-questionario-recordatorio-metas.md) |
| Data | 2026-11-17 |
| Situação | **Rascunho; decisões delegadas pelo dono (onda 4).** O dono autorizou seguir as recomendações sem parar para perguntar (`.sessoes/onda4-briefing.md`): cada decisão de produto está na §14 como "QP-Dn — decisão — porquê". Conferida contra o código da `main` 07756c4 (última migration: `0125_rls_patient_cadastro.sql`) e contra os worktrees dos Planos 19 a 26 (§13) |
| Itens do backlog | Paridade Dietbox, onda 4: **PD-110** (questionário pré-consulta), **PD-111** (recordatório alimentar de 24 horas), **PD-112** (metas do paciente) |
| Quando | **Plano 27**, em paralelo com os Planos 28 (`nutridebby-28`) e 29 (`nutridebby-29`), depois dos Planos 19 a 26 que ainda estiverem abertos. Regras de convivência em `docs/operacao/sessoes-paralelas.md` |
| Insumos | `.sessoes/onda4-briefing.md` (seção do Plano 27); levantamento do código (§1.3); specs dos Planos 17, 18, 19, 23, 25 e 26. Referência funcional: questionário, recordatório e metas do Dietbox. **Copiamos a função, nunca a marca, os textos, o layout ou o conteúdo** (nenhum questionário, pergunta ou meta pronta de lá; os textos iniciais desta spec são nossos) |
| Documentos de base | [`2026-09-27-nutridebby-mvp-historias.md`](2026-09-27-nutridebby-mvp-historias.md) (US-012 anamnese, US-022 cálculo do plano, US-042 diário), [`2026-11-13-nutridebby-lembretes-de-rotina-design.md`](2026-11-13-nutridebby-lembretes-de-rotina-design.md) (Plano 17), [`2026-11-16-nutridebby-18-ficha-cadastro-design.md`](2026-11-16-nutridebby-18-ficha-cadastro-design.md) (D12, D14, D16, RN-277), spec do Plano 19 (`nutridebby-b`: catálogo de nutrientes, `lerCongelados`, fontes), spec do Plano 26 (`nutridebby-26`: papel `recepcao`, RN-505, RN-511) |
| Numeração nova | US-520 a US-531 · RN-520 a RN-559 · RNF-520 a RNF-525 · CS-520 a CS-524 · C-520 a C-527 · R-520 a R-534 · DEP-Q1 a DEP-Q10 · PM-Q1 a PM-Q12 · **QP-D1 a QP-D43** (decisões deste documento; fora dele, cite "Plano 27, QP-Dn"). O bloco **520–559** é do Plano 27 pelo briefing da onda 4 (o 23 vai até 439, o 25 usa 440–479, o 26 usa 480–519). Conferido em 17/11/2026 com `grep -rhoE '\b(US\|RN\|RNF\|CS\|R\|C)-5[2-5][0-9]\b'` em todos os worktrees `nutridebby*`: nada usado |

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
| CS-521 | **Zero** resposta, nome de modelo de questionário, nome de alimento do recordatório ou título de meta em push, e-mail, URL, log, Sentry ou `audit_log` | Testes das chaves (push e e-mail), do log (um `logs.test.ts` por módulo novo, molde `src/modules/ia/logs.test.ts`) e do `audit_log` (só id, titular, ator e IP, `0007`) |
| CS-522 | O total do recordatório é **idêntico** ao que o editor do plano daria para os mesmos itens e gramas | Teste de unidade: os mesmos itens em `totalDosItens` (plano) e em `totalDoRecordatorio` dão o mesmo `Nutrientes` |
| CS-523 | O paciente registra a meta do dia em **1 toque** na página Hoje do app | E2E no portal a 360 px: "Cumpri" grava, anuncia e fica marcado |
| CS-524 | A sessão `recepcao` (Plano 26) e o contexto `publico` **não leem nem gravam** nenhuma das tabelas novas | Teste de isolamento com os dois contextos (`recepcao_negada`, `publico_negado`) |

### 1.2 Premissas e restrições

| # | Premissa / restrição | Origem |
|---|---|---|
| C-520 | Só documentos nesta etapa; código, migrations e testes vêm no plano | Briefing da onda 4 |
| C-521 | **Sem custo novo e sem serviço externo**: e-mail pelo transporte que já existe, push pelo Web Push que já existe; nada de WhatsApp novo (cada mensagem do WhatsApp pede modelo aprovado e conta na cota) | Memória "No extra costs"; QP-D11 |
| C-522 | **Nenhuma aba nova** na ficha e **nenhum item novo no menu** do painel; telas novas da biblioteca vão em Configurações (as rotas entram no fim de `DO_HUB`, `src/app/painel/navegacao.ts`, para o item Configurações ficar marcado nelas) | Plano 18, D12 e R-266; mesmo combinado dos Planos 19, 21, 22, 23 e 25 |
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
- **Comparação do recordatório com valores de referência de micronutrientes** ("Configurar valores de referência",
  PD-22 do Plano 19): o recordatório compara só com a meta do plano e com o último GET (QP-D15); backlog (P-Q4).
- **Metas com quantidade** ("bebi 1,5 L"), por dia da semana, com gráfico longo, pontos, medalhas ou ranking (QP-D20).
- **Push próprio de meta** e vínculo de meta com lembrete no banco (QP-D21).
- **IA**: resumo do questionário, sugestão de metas ou leitura do recordatório pela IA (C-526; backlog com versão nova da autorização).
- Avaliações tipo "DB360": decisão do Plano 29 (PD-126).

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** (sessão `nutri`) | Criar, editar e arquivar modelos de questionário e de meta; ligar o envio automático; enviar, cancelar e reenviar questionário a paciente `ativo` com e-mail no cadastro (QP-D39); ver respostas (auditado); copiar para uma anamnese; criar e editar recordatórios de paciente `ativo` ou `arquivado`; atribuir, editar e encerrar metas; ver os registros diários (auditado) | Mudar as respostas do paciente (imutáveis, RN-529); marcar meta em nome do paciente (RN-547); apagar envio, recordatório ou registro de meta (QP-D17); enviar questionário a paciente arquivado, bloqueado ou anonimizado |
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
| `/p/questionarios` | **Meus questionários**: abertos ("Responder agora") e respondidos ("Ver respostas"), só id, data da consulta e situação (sem `auditRead`, RN-530); aberta pelo botão "Meus questionários" da Jornada e pelo card de Hoje com mais de um aberto (QP-D41) | Nova; marca a seção **Jornada** (`tambem`) |
| `/p/questionarios/[envioId]` | Resposta no app (e "Suas respostas" depois de respondido) | Nova; marca a seção **Jornada** (`tambem`) |
| `/p/jornada` | Botão "Meus questionários" no grupo de botões, só com algum envio visível (contagem sem `auditRead`) | Muda (só a página; `jornada.ts` não muda) |
| `/p/metas` | Metas ativas, os 7 últimos dias e o registro de ontem | Nova; marca a seção **Plano** (`tambem`) |
| `/p/inicio` (Hoje) | Cards "Questionário para responder" e "Metas de hoje" | Muda |

- **Abas da ficha** (`abas.tsx`) não mudam e o menu do painel não ganha item (C-522); `src/app/painel/navegacao.ts` só
  acrescenta `/painel/questionarios` e `/painel/metas` no fim de `DO_HUB` (sem isso `itemAtual` devolve `null` e nenhum item
  fica marcado nessas telas), com caso em `navegacao.test.ts`. As subrotas
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
| Rotas de API | `src/app/api/p/questionarios/[envioId]/route.ts` (POST, resposta no app), `src/app/api/p/metas/[metaId]/route.ts` (POST, registro do dia), `src/app/api/questionario/[token]/route.ts` (POST, resposta pelo link); todas com `mesmaOrigem` (guarda `mesma-origem-rotas.test.ts`); o portal trata a recusa com `recusaDoPortal`/`linkDaRecusa` (`src/app/p/recusa-api.ts`), como o diário e os exames |
| `next.config.ts` | `Referrer-Policy: no-referrer` + `Cache-Control: no-store` para `/questionario/:token*` e `/api/questionario/:token*` (molde das linhas de `/documento` e `/autorizacao-ia`; um `page.tsx` não define cabeçalho) |
| `src/app/painel/navegacao.ts` (+ teste) | `/painel/questionarios` e `/painel/metas` no fim de `DO_HUB` |
| `src/modules/ajuda/` | Guias novos e versões (RNF-525); `TSX_FORA` de `conteudo.test.ts` + `src/modules/questionarios`, `src/modules/recordatorio`, `src/modules/metas` |

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
| Metas | `metas` · "Metas" | "Meta" · "Ativa" / "Terminou" / "Alcançada" / "Encerrada" | `verTodos`: `/painel/pacientes/{id}/plano-alimentar#metas-titulo` | `prescricoes`: "Meta" → `plano-alimentar#nova-meta` | Metas `ativa` dentro do período (`META_VISIVEL`) |

`podeAdicionar` (contrato do Plano 18, `ficha/tipos.ts:52`): Questionários e Metas devolvem `false` com paciente
arquivado, bloqueado ou anonimizado (e Questionários também sem e-mail); Recordatórios, só com bloqueado ou anonimizado
(o recordatório de arquivado vale, RN-540).

### 4.7 Portal

- **Hoje**: com questionário aberto, o card **"Questionário para responder"** fica no topo do `main` (antes do guia),
  **um só** (QP-D41): com um envio aberto, a data da consulta e "Responder agora"; com mais de um, "Você tem {n}
  questionários para responder." e "Ver questionários" (para `/p/questionarios`); com metas ativas, o card **"Metas de
  hoje"** fica depois dos cartões do aparelho. As duas leituras
  entram na transação de `faixaDeHoje` (P08-13: Hoje continua com duas transações), com um `auditRead` de `metas` só
  quando há metas e nenhum para o card do questionário (só id, data da consulta e situação; RN-538).
- **`/p/questionarios/[envioId]`**: formulário com as perguntas do snapshot, os mesmos controles da anamnese
  (`anamnese-form.tsx` adaptado ao portal: alvos ≥ 44 px, `fieldset`/`legend` nas escolhas, erro junto do campo e
  resumo no topo com links). Depois de respondido, "Suas respostas" em leitura (auditado). Envio por `fetch` à rota de
  API (POST), botão desabilitado até a hidratação (molde do diário, P09-04); falha de rede, sessão vencida, consultório
  suspenso ou erro do servidor → mensagem da §6.2 em `role="alert"` (`recusaDoPortal`), com o digitado no formulário.
  Com resposta digitada, o formulário intercepta os links internos ("Voltar", faixa, barra de ações) com confirmação
  própria (alvos ≥ 44 px) e mantém o `beforeunload` para fechar e recarregar (QP-D42). `CabecalhoDetalhe` com "Voltar
  para Meus questionários" (`/p/questionarios`, por sua vez, "Voltar para Jornada"; `/p/metas`, "Voltar para Hoje"):
  link, nunca `history.back()`.
- **`/p/metas`**: metas ativas com os 7 últimos dias e os botões de hoje e de ontem.
- **Cache do service worker**: `sw-regras.ts` **não muda** — só `/p/plano` é guardado (`URL_PLANO`) e as outras rotas do
  portal já são só rede; `sw-regras.test.ts` ganha as rotas novas (`/p/questionarios`, `/p/questionarios/{id}`, `/p/metas`
  e as APIs) como só rede. Offline, a navegação do portal cai no plano guardado (`ehNavegacaoDoPortal`); o `fetch` do
  formulário e dos botões de meta mostra a mensagem de falha da §6.2 sem perder o digitado.

### 4.8 Worker e avisos

- **Fila `questionarios-automaticos`** (agendada a cada 30 min, `retryLimit: 1`, `expireInSeconds: 300`): por consultório
  com um modelo de envio automático (`listarTenantsParaVarredura`, que devolve também os suspensos), no contexto `worker`
  por tenant, em **duas transações** (QP-D52): a primeira (a) cria os envios que faltam (RN-533), **só em consultório
  `ativa`** (`tenants.status`, lido sem trava: suspenso não manda e-mail em nome de ninguém), cada envio no seu `SAVEPOINT`
  (titular bloqueado no meio da rodada recusa só aquele envio, e o log leva só o código, regra 3); a segunda, nesta ordem,
  (d) leva o envio aberto para a consulta remarcada (RN-535), (e) realinha o envio à consulta movida (RN-535), (b) expira
  os vencidos e (c) cancela os de consulta cancelada (RN-534), cada mudança no seu `SAVEPOINT`. Os passos (b) a (e) rodam
  para **todo** tenant com envio `enviado`, com ou sem automático. O job **nunca** trava `tenants` (`FOR SHARE`/`FOR
  UPDATE`): o bloqueio trava o tenant (`cancelarTarefas`, `NO KEY UPDATE`) depois do paciente, e a trava do job fecharia
  o ciclo.
- **Avisos** na transação que cria o envio: `enqueueEmail({ tipo: 'questionario_link', … })` com o link assinado e,
  se o paciente tem conta no app, uma linha `notifications` (`canal 'push'`, `tipo 'questionario_novo'`, sem consulta,
  `AVISOS_DO_PORTAL`). O push segue as regras de hoje (inscrição, horário silencioso, paciente inativo). No worker, os
  avisos só saem quando o `INSERT … ON CONFLICT DO NOTHING RETURNING id` devolveu a linha (duas rodadas em paralelo não
  mandam dois e-mails).

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
  Então vejo "Questionário enviado. Ana recebe o link por e-mail e, se usar o app, um aviso no celular."
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

Cenário: Paciente bloqueado
  Dado que o paciente está bloqueado (ou anonimizado)
  Então o formulário não aparece, os envios ficam só em leitura e vejo "Paciente bloqueado: só consulta."

Cenário: Paciente sem e-mail
  Dado que o paciente não tem e-mail no cadastro
  Então o formulário não aparece e vejo "Cadastre o e-mail do paciente para enviar questionários."

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
  Então vejo "Respostas enviadas. Elas ficam disponíveis para a sua nutricionista antes da consulta."
  E o card some de Hoje

Cenário: Obrigatória em branco
  Quando envio sem responder "Qual é o principal motivo da consulta?"
  Então vejo no topo "Corrija 1 resposta para enviar." com o link para a pergunta
  E junto da pergunta "Responda: Qual é o principal motivo da consulta?"
  E nada é gravado e o que respondi continua no formulário

Cenário: Sem internet
  Quando toco em "Enviar respostas" sem conexão
  Então vejo "Não foi possível enviar. Confira a internet e tente de novo; o que você respondeu continua aqui."
  E o que respondi continua no formulário

Cenário: Vencido
  Dado que a consulta já começou
  Quando abro o link do card guardado
  Então vejo "Este questionário não está mais aberto." e nada é gravado

Cenário: Ver minhas respostas
  Dado um questionário respondido
  Quando abro Jornada, toco em "Meus questionários" e no questionário respondido
  Então vejo "Suas respostas" em leitura, e a leitura fica no Histórico de acessos
```

#### US-524 — Responder pelo link do e-mail · **M** (PD-110)

**Como** paciente que não usa o app, **quero** responder pelo link do e-mail, **para** não precisar criar conta.

```gherkin
Cenário: Abrir o link
  Quando abro o link do e-mail
  Então vejo "Questionário de {Consultório Debby}", "Para a sua consulta de 20/11/2026 às 14:00", o texto de abertura e as perguntas
  E nenhuma resposta anterior, nem o nome do modelo (a aba do navegador diz "Questionário pré-consulta")
  E o aviso termina com "Quem cuida dos seus dados é {Consultório Debby}." e "Veja como seus dados são tratados", que abre o termo em vigor

Cenário: Responder uma vez
  Quando respondo e toco em "Enviar respostas"
  Então vejo "Respostas enviadas. Elas ficam disponíveis para a sua nutricionista antes da consulta."
  E se abro o link de novo vejo "Este questionário já foi respondido.", sem as respostas

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
  E, depois de salva, a anamnese mostra "Contém respostas do questionário respondido pelo paciente em 18/11/2026 (SIC — segundo informações coletadas).", também no prontuario.pdf

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
  Então só o item alterado recebe os valores do alimento de agora (os outros mantêm os congelados), os totais são refeitos
  E o Histórico de acessos mostra um "Alterou — Recordatório alimentar" por salvamento (nunca "Excluiu" por item removido)
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
  Então a meta aparece como "Ativa · desde 17/11/2026" com os 7 últimos dias (hoje "Sem registro"; os anteriores ao início, "Antes do início")
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

Cenário: Sem internet
  Quando toco em "Cumpri" sem conexão
  Então vejo "Não foi possível registrar. Confira a internet e tente de novo." e o botão volta ao estado anterior

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
| RN-522 | **Questionário padrão.** `garantirQuestionarioPadrao` cria o "Questionário pré-consulta" (QP-D3, §6.3) na primeira leitura da lista **só se o consultório nunca teve modelo de questionário** (ativo ou arquivado: arquivar o padrão não o recria), com `padrao = true`; um padrão por consultório **e finalidade** (índice `anamnesis_templates_padrao_idx` refeito em `(tenant_id, finalidade) where padrao`). O padrão vem selecionado no "Enviar questionário" |
| RN-523 | **Envio.** `enviarQuestionario(ctx, patientId, { modeloId, appointmentId? })`, sessão `nutri`: trava o paciente (`carregarPacienteParaEscrita`) e exige `status = 'ativo'` e e-mail no cadastro (QP-D39: "Cadastre o e-mail do paciente para enviar questionários."); confere modelo ativo de questionário; consulta (se houver) do mesmo paciente, `agendada` ou `confirmada` e futura, sem outro envio `enviado` ou `respondido` (índice `questionario_envios_um_por_consulta`); grava o envio com o snapshot (`nome`, `introducao`, `perguntas`), `origem 'nutri'`, `enviado_por = actorUserId`, `enviado_em` e `expira_em` (RN-524); na mesma transação, os avisos (RN-526). Erros: "Modelo de questionário não encontrado.", "Esta consulta já tem questionário.", "Escolha uma consulta futura deste paciente." |
| RN-524 | **Validade.** Com consulta: `expira_em` = início da consulta. Sem consulta: `enviado_em` + 14 dias. CHECK `expira_em > enviado_em`. Depois de `expira_em`, o paciente não responde (gatilho, RN-529) e o worker passa a `expirado`. **Envio aberto** (`ENVIO_VISIVEL`, uma só expressão para Hoje, Jornada, `noApp`, a abertura e a resposta, no app e no link): `situacao = 'enviado'`, `expira_em > agora` e, com consulta, consulta não `cancelada` e `inicio > agora` — fecha a janela de até 30 min entre o cancelamento ou a mudança de horário da consulta e a rodada do worker (QP-D53) |
| RN-525 | **Cancelar e reenviar.** "Cancelar envio" (sessão `nutri`, só `enviado`) → `cancelado`, `cancelado_em`, `cancelado_por = app_current_user()`, `cancelado_motivo 'nutri'`. "Reenviar" (de `cancelado` ou `expirado`) = envio novo pela RN-523 com o mesmo modelo, e a mesma consulta se ela ainda servir; sem consulta que sirva, sem consulta. Nunca reabre o antigo. E-mail do paciente corrigido com envio aberto: o link antigo morre (RN-527) e o envio continua "Aguardando resposta"; a tela do envio aberto mostra a dica "Corrigiu o e-mail do paciente? Cancele este envio e reenvie: o link antigo deixa de valer." (sem ação nova de "reenviar link") |
| RN-526 | **Avisos do envio.** (a) **E-mail** `questionario_link` a `patients.email`, por `enqueueEmail` na transação do envio (o e-mail sai depois do COMMIT, pela fila): assunto "Questionário antes da sua consulta", corpo com o nome do consultório, a data da consulta (se houver), o botão "Responder questionário" (link de RN-527) e "O link vale até {data e hora}." — **sem** o nome do modelo nem as perguntas. (b) **Push** `questionario_novo` só se o paciente tem conta (`patients.user_id` não nulo): linha em `notifications` (canal `push`, sem consulta) com corpo neutro e tela `/p/inicio`; as regras de envio de push de hoje valem (`sem_inscricao`, `paciente_inativo`, horário silencioso). Sem WhatsApp. Envio pelo worker (RN-533) segue o mesmo caminho |
| RN-527 | **Link sem login** (`src/modules/questionarios/link.ts`, molde de `autorizacao-token.ts`): versão + tenant + paciente + envio + emissão (segundos), MAC de 128 bits com chave derivada própria (`nutridebby:link-questionario:v1`, HKDF de `ENCRYPTION_KEY`) e o **e-mail atual** do paciente (corrigido o e-mail, o link morre). **Sem código de 6 dígitos** (QP-D6). Vale com o consultório `ativa`, o titular `ativo` e não anonimizado e o envio aberto (`ENVIO_VISIVEL`, RN-524), conferidos no banco a cada abertura e de novo na resposta (molde `link-documento.ts:125`, QP-D54); titular arquivado ou bloqueado, consultório suspenso, consulta cancelada ou já começada → "Este questionário não está mais aberto." (nunca erro 500 nem 42501 na tela). Leitura e gravação no contexto de paciente **sem login** (`semConta`, entrada em `SEM_CONTA_PERMITIDOS`). Limite por IP: 30 aberturas ou envios por 10 minutos (`consumirLimite`, chave `questionario`). Respostas da página: inválido → "Este link não é mais válido. Peça um novo à sua nutricionista."; respondido → "Este questionário já foi respondido."; vencido ou cancelado → "Este questionário não está mais aberto." |
| RN-528 | **O que a página do link mostra.** Título (h1) "Questionário de {consultório}", data e hora da consulta (se houver), texto de abertura e perguntas do snapshot. **Nunca** nome do paciente, respostas já enviadas, nome do modelo (nem no h1, nem na aba: o `<title>` é "Questionário pré-consulta", também em `/p/questionarios/[envioId]`; QP-D40) nem outro dado do prontuário. Nome do consultório em texto, **sempre no claro**, sem logo nem cor da marca (como `/documento/[token]` e `/autorizacao-ia/[token]`). No fim do aviso, "Quem cuida dos seus dados é {consultório}." e o `details` "Veja como seus dados são tratados" com o termo do paciente em vigor (`TERMO_PACIENTE_PARAGRAFOS`, como `/n/[slug]`; LGPD, art. 9º). `Cache-Control: no-store` e `Referrer-Policy: no-referrer` pelo `next.config.ts` (`/questionario/:token*` e `/api/questionario/:token*`); `metadata` com `robots: { index: false, follow: false }` e `referrer: 'no-referrer'`. A abertura grava `auditRead` (entidade `questionario`, `entidadeId` = envio, ator nulo, IP), como `link-documento.ts` |
| RN-529 | **Responder** (`responderQuestionario`, app ou link): `validarRespostas(snapshot.perguntas, bruto)` no servidor (obrigatórias, tipos, limites; nenhuma resposta vazia gravada) e o tamanho do JSON (≤ 1.900.000 bytes por `Buffer.byteLength(JSON.stringify(…))`, conferido antes do CHECK de 2.000.000 para nenhum 23514 levar a linha ao log do Postgres; D23 do 18 — a margem cobre os espaços que o `jsonb::text` põe depois de cada `:` e `,`, QP-D58); com erro, nada grava. O módulo confere de novo o envio aberto (`ENVIO_VISIVEL`) e o titular sob a trava, antes do `UPDATE`. **Primeiro** trava o próprio titular (`SELECT … FROM patients WHERE id = $1 FOR KEY SHARE`; a sessão de paciente tem `update` em `patients`, então a linha é visível; QP-D33), **depois** grava pela **sessão do paciente** (`UPDATE` em `questionario_envios`, `PACIENTE_ESCREVE`) com `situacao 'respondido'`, `respostas`, `respondido_via` (`app` com login, `link` sem login). O gatilho `questionario_envios_regras` confere: só `enviado` → `respondido`, uma vez; `clock_timestamp() < expira_em`; titular `ativo` e não anonimizado; `respondido_em := clock_timestamp()`; `respondido_via = 'app'` só com `app_current_user()` não nulo e `'link'` só sem; nenhuma outra coluna muda. As respostas **nunca** mudam depois (nem pela equipe). Na mesma transação, `recordAudit` com a entidade `questionario_resposta`, ação `criar`, `entidadeId` = envio ("Respondeu questionário", nos dois canais; no link, ator nulo e IP; QP-D36) |
| RN-530 | **Leituras auditadas.** Painel: a lista de envios da aba (`listarEnvios`, com o nome do modelo, como `listarAnamneses`) grava **um** `auditRead` de lista (entidade `questionario`) quando há envios; abrir as respostas (`abrirEnvio`) grava um com o id. Portal: o card de Hoje, a contagem do botão da Jornada e a lista `/p/questionarios` (só id, data da consulta, situação; o nome do modelo não aparece) **não** gravam; abrir o formulário e "Suas respostas" gravam. A seção do Início não grava (D14 do 18) |
| RN-531 | **Copiar para uma anamnese.** "Copiar para uma anamnese" (só `respondido`, sem `anamnese_id`) abre `anamnese/nova?questionario={envioId}` com o formulário preenchido pelas perguntas do snapshot e as respostas. Ao salvar, `preencherAnamneseDoQuestionario` trava o paciente (`carregarPacienteParaEscrita`), **relê o envio depois da trava** (`respondido`, sem `anamnese_id`; senão "Copiado para a anamnese de {data}"), grava a `anamneses` com `template_id` nulo, `template_snapshot` = snapshot do envio (o nome ganha " (questionário)") e as respostas do formulário, e, **na mesma transação**, `questionario_envios.anamnese_id` por um `UPDATE … WHERE id = $envio` **sem** o filtro `anamnese_id IS NULL` (o gatilho só deixa a sessão `nutri` gravar de nulo para valor, num envio `respondido`, e recusa a segunda cópia com 42501, que desfaz a anamnese da mesma transação; um filtro faria o `UPDATE` pegar 0 linhas e deixaria uma anamnese sem vínculo e sem a nota SIC). Uma cópia por envio. A anamnese assim salva mostra, na leitura e no `prontuario.pdf`, a nota "Contém respostas do questionário respondido pelo paciente em {data} (SIC — segundo informações coletadas).", lida pelo vínculo `questionario_envios.anamnese_id`; a nota não some com a edição (Res. CFN 594/2017, art. 3º, III; QP-D43) |
| RN-532 | **Envio automático (configuração).** No próprio modelo de questionário: `envio_auto` (`primeira` \| `todas`) e `envio_auto_dias` (1–7), juntos ou nulos (CHECK). **Um** modelo automático por consultório (índice único parcial); arquivar o modelo desliga o automático (CHECK `envio_auto is null or arquivado_em is null`). Ligar em outro modelo desliga o anterior na mesma transação. Texto do cartão: "Envio automático ligado: {n} dias antes da primeira consulta." / "… antes de toda consulta." / "Envio automático desligado.". A confirmação de "Arquivar" do modelo automático diz "Arquivar este questionário? O envio automático será desligado."; `arquivarModelo` desliga no mesmo `UPDATE` (`envio_auto` e `envio_auto_dias` nulos junto com `arquivado_em`) |
| RN-533 | **Envio automático (worker).** A cada 30 min, por tenant com `tenants.status = 'ativa'` e modelo automático, contexto `worker`, cada envio no seu `SAVEPOINT`: consultas `agendada`/`confirmada` com `inicio` entre agora e agora + `envio_auto_dias`, de paciente `ativo` com e-mail, **sem** envio da consulta (qualquer situação: um cancelado pela nutricionista não volta sozinho), e: `primeira` → o paciente não tem atendimento registrado (`consultations`) nem envio `respondido` deste modelo; `todas` → o paciente não tem envio deste modelo `respondido` nos 7 dias anteriores nem `enviado` aberto. No máximo **um envio por paciente por rodada** (a consulta mais próxima; com `todas`, a seguinte recebe na rodada depois que o envio aberto sair). Cria o envio com `origem 'automatico'`, `enviado_por` nulo, e os avisos (RN-526) só quando o `INSERT … RETURNING` devolveu a linha. Lote de até 200 por tenant e rodada; `ON CONFLICT DO NOTHING` no índice por consulta (duas rodadas não duplicam). Consulta `solicitada` (Plano 23) não recebe. O gatilho, no INSERT de **qualquer** papel, lê o titular com `FOR KEY SHARE` (em READ COMMITTED espera o bloqueio em curso e vê a versão nova) e recusa com 42501 titular não `ativo` ou anonimizado: o envio nunca nasce para quem acabou de ser bloqueado |
| RN-534 | **Expirar e cancelar (worker).** Na mesma fila: `enviado` com `expira_em ≤ agora`, ou com consulta cujo `inicio ≤ agora` → `expirado`; `enviado` de consulta `cancelada` (sem remarcação, RN-535) → `cancelado` com `cancelado_motivo 'consulta_cancelada'` e `cancelado_por` nulo. O gatilho confere os dois: `expirado` só com `OLD.expira_em ≤ clock_timestamp()` ou o início da consulta já passado; `consulta_cancelada` só com a consulta ligada (`OLD.appointment_id`) em `cancelada` (QP-D59) |
| RN-535 | **Remarcação e consulta movida.** (1) Consulta `cancelada` com uma consulta nova que aponta para ela (`remarcada_de`), `agendada`/`confirmada` e futura: o envio `enviado` passa para a consulta nova (`appointment_id` e `expira_em` = início da nova), só pelo `worker`; o gatilho lê a consulta nova e exige `expira_em` = `appointments.inicio` dela. Se a nova já tiver envio (ou o `UPDATE` der 23505 por um envio manual criado no meio da rodada, no `SAVEPOINT`), o antigo é cancelado (`consulta_cancelada`). (2) **Consulta movida** na mesma linha ("Alterar data e hora", `moverConsulta`, `src/modules/agenda/consultas.ts:171`, que aceita data passada — D22 da agenda): a cada rodada, o worker leva o `expira_em` do envio `enviado` ao `inicio` novo da consulta, se o início está no futuro; se já passou, o envio vira `expirado` (RN-534). O gatilho aceita do `worker`, com `situacao 'enviado'`, a troca de `expira_em` (com ou sem troca de `appointment_id`) só para o `inicio` da consulta de `NEW.appointment_id` (QP-D53). Envio `respondido` fica com a consulta antiga (o bloco da consulta nova mostra "Respondido para a consulta de {data}") |
| RN-536 | **Bloqueio e anonimização.** Em `atenderPedidoExclusao` (`lgpd.ts`, sessão `nutri`, paciente já travado com `FOR UPDATE` por `carregarPacienteParaEscrita`), um `UPDATE` **próprio** — depois do `UPDATE` de `patients` para `bloqueado` e de `cancelarTarefas` (que trava o tenant) — leva os envios `enviado` a `cancelado` com `cancelado_motivo 'paciente_bloqueado'`, `cancelado_por` = ator (o gatilho só aceita esse motivo com o titular já `bloqueado`). Envios respondidos ficam (prontuário). Na anonimização nada muda nos envios (como a `anamneses`): respostas são registro clínico de guarda permanente, que pode ser eliminado 20 anos após o último registro (Res. CFN 594/2017, art. 3º, VI, "b") |
| RN-537 | **Sem apagar.** Envio não é apagado por ninguém do app: `REVOKE DELETE, TRUNCATE ON questionario_envios FROM nutri_app_role` (QP-D17). Engano = "Cancelar envio" |
| RN-538 | **Portal: o que o paciente vê.** Hoje e Jornada listam os envios abertos (`ENVIO_VISIVEL`, RN-524), com a data da consulta e "Responder agora"; Jornada lista também os respondidos ("Respondido em {data}"). O nome que o paciente vê no formulário é o do snapshot (escrito pela nutricionista, para ele). Expirado e cancelado não aparecem |
| RN-539 | **Questionário na consulta.** O bloco "Questionário pré-consulta" da página da consulta aparece só na sessão `nutri` (a recepção não vê, QP-D12) e mostra: "Nenhum questionário enviado." + formulário; "Aguardando resposta · enviado em {data}" + "Cancelar envio"; "Respondido em {data}" + "Ver respostas"; "Vencido"/"Cancelado" + "Reenviar"; na consulta nova de uma remarcação cujo envio já estava respondido: "Respondido para a consulta de {data}" + "Ver respostas". Consulta passada, cancelada ou `solicitada`: sem formulário. O seletor de modelo do bloco e o da ficha chamam `garantirQuestionarioPadrao` antes de listar (o primeiro envio não depende de abrir Configurações) |
| RN-540 | **Recordatório: gravação.** `salvarRecordatorio(ctx, patientId, id \| null, entrada)`, sessão `nutri`, paciente `ativo` ou `arquivado` (`carregarPacienteParaEscrita`): valida tudo no servidor (§5, US-526; todos os CHECKs conferidos antes, para nenhum 23514 levar a linha ao log do Postgres, D23 do 18); grava `recordatorios` e os itens **por diferença** (molde de `salvarRascunho`, `src/modules/plano-alimentar/rascunho.ts:229-266`): mapa dos itens atuais **deste** recordatório; id fora do mapa vira INSERT (um id de outro recordatório cai na PK, nunca é "atualizado" nem movido); UPDATE só do item que mudou; DELETE só dos que saíram; nunca `ON CONFLICT (id) DO UPDATE`. Congela os nutrientes só dos itens novos ou com alimento ou quantidade alterados (RN-541; os outros mantêm os congelados, QP-D37). Todo salvamento grava `recordatorios.updated_at` (um `alterar` da mãe por salvamento, que é o que o Histórico mostra; QP-D36). Até 12 refeições e 80 itens por recordatório. Sem exclusão do recordatório (QP-D17) |
| RN-541 | **Recordatório: nutrientes congelados.** Na mesma transação, `UPDATE recordatorio_itens SET nutrientes = … FROM foods` (só dos itens novos ou com alimento ou quantidade alterados) pelo molde de `publicarPlano`, com o formato `NutrientesCongelados` do Plano 19 (macros, fibra, `fonte`, `fonteVersao`, `fonteOrigem`, `micros`) calculado para a quantidade do item. Alimento invisível ao consultório (RLS) → "Escolha um alimento da lista". A leitura usa `lerCongelados` (formato antigo aceito) |
| RN-542 | **Recordatório: totais.** `totalDoRecordatorio(itens)`: soma os nutrientes congelados de todos os itens com `food_id` (no recordatório não há substituição); itens sem cadastro ficam fora e contados ("{n} item sem cálculo" / "{n} itens sem cálculo"); `semValor` como no plano. Por refeição e do dia. Mesma regra de arredondamento do plano (CS-522) |
| RN-543 | **Recordatório: comparação.** Lida pela função existente `contextoDoPaciente` (peso e cálculos de GET, já auditados) e pela meta do plano **publicado** (`meal_plans.meta_kcal`): "Meta do plano: {kcal} kcal · {rótulo} ({desvio})" com `indicadorMeta`; "Último gasto energético: {kcal} kcal ({diferença} kcal)". Sem plano publicado ou sem GET, a linha some. O recordatório não grava a comparação |
| RN-544 | **Recordatório: leituras.** A lista da aba (dia relatado, nº de itens, kcal total) grava **um** `auditRead` de lista (entidade `recordatorio`) quando há linhas; abrir um grava com o id. A seção do Início não grava |
| RN-545 | **Metas: biblioteca.** `metas_modelos` do consultório, `staff_only`, sem paciente e sem auditoria (como as bibliotecas do Plano 19). "Incluir sugestões" insere as 6 sugestões (§6.3) uma vez: some quando o consultório tem algum modelo (ativo ou arquivado). Arquivar = `arquivado_em` (sem DELETE no código) |
| RN-546 | **Metas: atribuição.** `atribuirMeta`, sessão `nutri`, paciente `ativo` (trava): até **8** metas `ativa` por paciente (conferido sob a trava do paciente; o banco não tem contador); copia título, "Como fazer", categoria e `lembrete_sugerido` do modelo (ou do formulário); `inicio` de hoje a +30 dias; `fim` nulo ou de `inicio` a `inicio` + 365 dias. `criado_por` = `app_current_user()` (gatilho). Editar e "Encerrar" também travam o paciente (`carregarPacienteParaEscrita`, `FOR UPDATE`), o que os serializa com o registro do paciente (que trava o titular com `FOR KEY SHARE`, QP-D33): sem write skew entre "mudar `inicio`" e o primeiro registro. Editar muda título, "Como fazer", categoria e `fim` (não `inicio` depois de haver registro). "Encerrar" → `situacao 'alcancada'` ou `'encerrada'`, `encerrada_em`. Não há reabrir: nova meta. **Meta terminada** (QP-D55): `ativa` com `fim` anterior a hoje (fuso do consultório) é estado **derivado na leitura**, sem gravação nem worker: não conta no limite de 8 (a contagem sob a trava usa `situacao = 'ativa' and (fim is null or fim >= hoje)`), não aparece no app (`META_VISIVEL`), aparece no painel como "Terminou em {data}" com "Encerrar" e "Editar" (estender o `fim` dentro de `inicio + 365` a reativa) e na seção do Início como "Terminou"; o gatilho já recusa registro depois do `fim`. Título de modelo repetido entre os não arquivados (índice `metas_modelos` por `lower(titulo)`): conferido sob a mesma transação antes do `INSERT`/`UPDATE`, com "Já existe um modelo com este título." (nenhum 23505 chega ao Postgres) |
| RN-547 | **Metas: registro do paciente.** `registrarMeta(ctx, metaId, quando, cumprida)` (`quando` = `'hoje'` \| `'ontem'`), só sessão de paciente com login: **primeiro** trava o próprio titular (`SELECT … FROM patients WHERE id = $1 FOR KEY SHARE`, QP-D33), depois `INSERT … VALUES (…, app_hoje_do_tenant() - {0 \| 1}, …) ON CONFLICT (tenant_id, meta_id, dia) DO UPDATE SET cumprida` — o `dia` é calculado **no banco**, com o mesmo `now()` da transação que o gatilho usa; o TS nunca calcula o dia gravado (QP-D56). Gatilho `metas_registros_regras` (QP-D35): UPDATE sem mudança passa; tenant ou titular diferente da sessão, ou papel `publico`, `conta` ou `recepcao` → devolve NEW (a RLS recusa); `nutri` e `worker` no próprio tenant → 42501; o contexto vazio `''` (migration, semente, fábrica do isolamento) passa; no papel `paciente`: trava o titular com `FOR KEY SHARE` e exige `ativo` e não anonimizado, **depois** lê a meta **sem trava** (`SELECT` comum, que a RLS do paciente mostra; `FOR SHARE`/`FOR KEY SHARE` não serve: sem `update` liberado, `paciente_sem_update` esconde a linha de todo `SELECT … FOR UPDATE/SHARE` na sessão de paciente, `drizzle/0070_paciente_sem_escrita.sql:15-16`) e exige meta do próprio paciente, `ativa`, com `dia` entre `inicio` e `coalesce(fim, dia)`; `dia` = hoje ou ontem no fuso do tenant (`app_hoje_do_tenant()` = `app_dia_no_fuso(now(), tenants.fuso)`; `app_dia_no_fuso(instante timestamptz, fuso text)` é a função pura que o teste chama com um instante fixo — o `now()` do Postgres não se fixa); `registrado_em := clock_timestamp()` no INSERT, `atualizado_em := clock_timestamp()` no UPDATE; no UPDATE só `cumprida` muda. A trava do titular serializa o registro com "Encerrar" e "Editar" (RN-546). **Nunca** liberar `update` em `metas_paciente` ao paciente (QP-D34): o gatilho de `metas_paciente` não tem ramo de paciente, e o paciente poderia reescrever o título ou marcar a meta como alcançada. Sem DELETE (`REVOKE`) |
| RN-548 | **Metas: o que se mostra.** Painel: por meta, os 7 últimos dias (dia antes do `inicio`: "—" com o texto "Antes do início", nunca "Sem registro") e a adesão de 30 dias ("Últimos 30 dias: cumpriu em {a} de {b} dias registrados"; sem registro: "Nenhum registro nos últimos 30 dias."). Portal: metas ativas com hoje e ontem graváveis e os 5 dias anteriores em leitura. Toda leitura que **devolve alguma meta** (título e registros são dado de saúde, regra 8) grava **um** `auditRead` (entidade `metas`) por tela — a seção Metas do painel (`metasDoPaciente`), o detalhe (`detalheDaMeta`, com o id), o card de Hoje (`metasDeHoje`) e `/p/metas` (`minhasMetas`); sem meta, nenhum. A seção do Início e o contador "No app" não gravam (QP-D57) |
| RN-549 | **Metas e lembretes.** Com `lembrete_sugerido` e sem lembrete ligado daquele tipo para o paciente, a meta mostra o link "Criar lembrete de {tipo}" para `#lembretes-app-titulo`. Nada é gravado em `lembretes_rotina` por este plano; o push continua o do Plano 17 (texto fixo, teto de 24 por dia) |
| RN-550 | **Metas: bloqueio e anonimização.** No bloqueio, as metas `ativa` passam a `encerrada` (`encerrada_em` = agora; sessão `nutri`, num `UPDATE` próprio em `atenderPedidoExclusao`, logo depois do dos envios, RN-536). Metas e registros ficam na anonimização (conduta e acompanhamento, prontuário) |
| RN-551 | **Textos fora do app.** Push, e-mail, título de página, URL, log, Sentry e `audit_log` **nunca** levam resposta, nome de modelo de questionário, alimento do recordatório ou título de meta (CS-521). O `audit_log` grava só id, titular, ator e IP (gatilho `0007`) |
| RN-552 | **IA.** Nenhuma das tabelas novas é lida pelos módulos da IA (`resumo-dados.ts`, `rascunho-dados.ts`, `leitura-job.ts`, `nutri-paciente/contexto.ts`); guarda de fonte em `campos-enviados.test.ts` (QP-D24) |
| RN-553 | **Exportação.** `dados.json` (escopos titular e equipe): `questionarios` (modelo do snapshot, perguntas e respostas por rótulo via `respostaParaCampo`, situação, enviado em, respondido em e por onde, consulta), `recordatorios` (dia, dia fora do comum, observação, refeições com itens, quantidades, medida, nutrientes congelados e fonte), `metas` (título, como fazer, categoria, período, situação, registros por dia). Sem `enviado_por`, `cancelado_por` nem `criado_por` no escopo titular (ids internos). `prontuario.pdf`: seções "Questionários pré-consulta — informações dadas pelo paciente (SIC)" (só respondidos), "Recordatórios 24 h" (itens e totais) e "Metas" (lista e adesão) |
| RN-554 | **Isolamento e recepção.** As quatro tabelas novas nascem com `recepcao_negada` (pelo `app_enable_tenant_rls` do Plano 26, se ele entrar antes, ou pelo laço da migration dele, se entrar depois). As funções de gatilho deste plano entram em `FUNCOES_COM_PAPEL` com "não se aplica (tabela negada)" (§9.6) |
| RN-555 | **Seções do Início.** `secaoQuestionarios`, `secaoRecordatorios` e `secaoMetas` acrescentadas **no fim** de `SECOES_DA_FICHA`, nessa ordem; rótulos genéricos (§4.6); o arquivo da seção nunca chama `auditRead` |
| RN-556 | **"No app" das seções.** `noApp` contado no contexto de paciente (`TxDePaciente`, D16 do 18): questionários = envios que `questionariosAbertosDoPaciente` devolveria; metas = metas que `metasDeHoje` devolveria. As duas funções do portal e a contagem usam o **mesmo** filtro exportado (`ENVIO_VISIVEL`, `META_VISIVEL`), com caso no teste de paridade (RNF-263 b do 18) |
| RN-557 | **Fuso.** "Hoje", "ontem", o dia relatado do recordatório e as datas de tela são no fuso do consultório (`hojeNoFuso`, RN-06); `expira_em` e os carimbos são `timestamptz` |
| RN-558 | **Paciente sem conta e push.** Paciente sem conta no app recebe só o e-mail. Paciente com conta e sem notificações no aparelho: a linha de push fica `ignorada` (`sem_inscricao`), como hoje |
| RN-559 | **Concorrência.** Ordem de travas: paciente → (tenant, quando o bloqueio chama `cancelarTarefas`) → envio ou meta → consulta (`FOR KEY SHARE`). A equipe trava o paciente com `FOR UPDATE` (`carregarPacienteParaEscrita`); o paciente, com `FOR KEY SHARE` **antes** do `UPDATE`/`INSERT` — o `UPDATE` trava a linha do envio antes de o gatilho rodar, e sem a trava prévia resposta × bloqueio dava 40P01 (QP-D33). O worker não trava o paciente nos `UPDATE` (expirar, cancelar, remarcar); no INSERT, só pelo gatilho (`FOR KEY SHARE`, sem outra trava de linha antes). Testes de concorrência: resposta × bloqueio, envio automático × bloqueio, registro × "Encerrar". Responder e cancelar ao mesmo tempo: quem trava primeiro ganha; o outro relê e vê a situação nova ("Este questionário não está mais aberto." / "Este envio já foi respondido.") |

### 6.2 Textos de interface

| Onde | Texto exato |
|---|---|
| Card de Configurações | **Questionários pré-consulta** · "Perguntas que o paciente responde antes da consulta." · **Modelos de metas** · "Metas prontas para dar aos pacientes." |
| `/painel/questionarios` | Título "Questionários pré-consulta"; "Novo questionário"; selo "Padrão"; "{n} perguntas"; cartão "Envio automático" com a caixa "Enviar sozinho" (estado em texto ao lado: "Ligado" / "Desligado"), "Questionário", "Quando" ("Só antes da primeira consulta" / "Antes de toda consulta"), "Antecedência" ("{n} dia antes"/"{n} dias antes") e "Salvar envio automático"; vazio: "Nenhum questionário. Toque em Novo questionário para criar o primeiro."; sucesso "Questionário salvo." (no topo, por `?ok=salvo` e `Aviso`); confirmação do "Arquivar" do modelo automático: "Arquivar este questionário? O envio automático será desligado."; selo "Padrão" com `Selo`; sucesso do cartão "Envio automático salvo." (no topo, por `?ok=automatico`) |
| Editor | Rótulos por finalidade, como props do `ModeloEditor`: "Nome do questionário", botão "Salvar questionário", erros "Informe o nome do questionário" e "Questionário não encontrado." (a anamnese continua com "Nome do modelo", "Salvar modelo" e `MSG_ANAMNESE`); campo "Texto de abertura" com a dica "Aparece no topo, antes das perguntas. Ex.: por que você pede as respostas." |
| Aba Anamnese (navegação) | "Anamneses" · "Questionários" · "Recordatórios" |
| Questionários do paciente | Título "Questionários"; formulário "Enviar questionário": "Questionário", "Consulta" (opções "{data} às {hora}" e "Sem consulta ligada"), botão "Enviar questionário"; colunas "Questionário", "Consulta", "Enviado em", "Situação"; situações "Aguardando resposta · vence em {data} às {hora}", "Respondido em {data}", "Vencido", "Cancelado"; origem "Automático"; vazio: "Nenhum questionário enviado."; paciente arquivado: "Paciente arquivado: reative o cadastro para enviar questionários."; bloqueado ou anonimizado: "Paciente bloqueado: só consulta."; sem e-mail: "Cadastre o e-mail do paciente para enviar questionários."; "Reenviar" de paciente arquivado: indisponível com o mesmo texto do arquivado; sucesso de "Cancelar envio": "Envio cancelado."; sucesso de "Reenviar": o mesmo do envio; seletor de modelo vazio (todos arquivados): "Nenhum questionário ativo. Crie um em Configurações › Questionários pré-consulta." |
| Sucesso do envio | "Questionário enviado. {primeiro nome} recebe o link por e-mail e, se usar o app, um aviso no celular." |
| Respostas | "Respondido pelo paciente em {data} às {hora} · {pelo app \| pelo link do e-mail}"; "Sem resposta"; "Copiar para uma anamnese"; "Copiado para a anamnese de {data}"; "Cancelar envio" (confirmação "Cancelar este envio? O link deixa de funcionar."); "Reenviar"; aviso fixo "Respostas enviadas pelo paciente. Não podem ser alteradas; para corrigir ou completar, copie para uma anamnese."; envio aberto: dica "Corrigiu o e-mail do paciente? Cancele este envio e reenvie: o link antigo deixa de valer."; cancelar um envio que o paciente acabou de responder (RN-559): "Este envio já foi respondido." |
| Anamnese copiada | Faixa "Veio do questionário de {data}. Confira e complete antes de salvar."; depois de salva, na leitura e no PDF: "Contém respostas do questionário respondido pelo paciente em {data} (SIC — segundo informações coletadas)." |
| Bloco da consulta | Título "Questionário pré-consulta"; os textos da RN-539, inclusive "Respondido para a consulta de {data}" |
| Envio automático (lista) | "Envio automático ligado: {n} dias antes da primeira consulta." / "Envio automático ligado: {n} dias antes de toda consulta." (com 1: "Envio automático ligado: 1 dia antes da primeira consulta." / "… 1 dia antes de toda consulta.") / "Envio automático desligado." |
| E-mail | Assunto "Questionário antes da sua consulta"; "Olá, {primeiro nome}. {Consultório} pediu que você responda algumas perguntas antes da consulta de {data} às {hora}." (sem consulta: "… antes do seu próximo atendimento."); botão "Responder questionário"; "O link vale até {data} às {hora}. Não encaminhe este e-mail: o link é só seu." |
| Push | Título "NutriDebby"; corpo "Sua nutricionista enviou um questionário para você responder." |
| Portal, Hoje | Card "Questionário para responder"; "Para a consulta de {dd/mm} às {hora}" (sem consulta: "Responda até {dd/mm}"); botão "Responder agora"; com mais de um aberto: "Você tem {n} questionários para responder." e "Ver questionários" |
| Portal, Jornada | Botão "Meus questionários"; página "Meus questionários": abertos "Para a consulta de {dd/mm} às {hora}" + "Responder agora", respondidos "Respondido em {data}" + "Ver respostas"; vazio "Nenhum questionário." |
| Formulário (app e link) | `<title>` "Questionário pré-consulta" nas duas rotas; h1: no app, o nome do snapshot (só dentro do formulário do titular, QP-D30); no link, "Questionário de {consultório}"; aviso "Suas respostas vão para o seu prontuário, protegido por sigilo profissional. As perguntas marcadas como obrigatórias precisam de resposta. Responda de uma vez: as respostas só são guardadas quando você enviar. Depois de enviar, não dá para alterar as respostas. Este questionário não é atendimento de urgência. Se precisar de ajuda agora, procure um serviço de saúde ou ligue 192 (SAMU)."; no fim do aviso, "Quem cuida dos seus dados é {consultório}." e o `details` "Veja como seus dados são tratados" (termo em vigor); rótulo de obrigatória "(obrigatória)", como `anamnese-form.tsx`; botão "Enviar respostas"; erro de topo "Corrija {n} resposta para enviar." / "Corrija {n} respostas para enviar."; falha de rede, sessão ou servidor: "Não foi possível enviar. Confira a internet e tente de novo; o que você respondeu continua aqui." (`role="alert"`); ao sair por link interno com resposta digitada: "Sair sem enviar? O que você respondeu será perdido." com "Sair" e "Continuar respondendo" (QP-D42) |
| Depois de enviar | "Respostas enviadas. Elas ficam disponíveis para a sua nutricionista antes da consulta." |
| Link inválido / respondido / fechado / limite | Os da RN-527 e "Muitas tentativas. Tente de novo em alguns minutos." |
| Recordatórios | Título "Recordatórios 24 h"; "Novo recordatório"; colunas "Dia relatado", "Itens", "Energia"; "Dia fora do comum" (selo "Fora do comum"); "Incluir refeição"; "Incluir alimento"; "Item sem cadastro"; "Sem cálculo"; "Total do dia"; "Ver todos os nutrientes"; "{n} itens sem valor na tabela"; "Salvar recordatório"; "Recordatório salvo."; dica do dia relatado "Normalmente, o dia anterior à consulta."; vazio "Nenhum recordatório."; erro por item junto do campo e resumo no topo "Corrija {n} campo para salvar." / "Corrija {n} campos para salvar."; ao sair por link interno com mudança não salva: "Sair sem salvar? As mudanças serão perdidas."; paciente bloqueado: "Paciente bloqueado: só consulta." |
| Metas (painel) | Título "Metas"; "Nova meta"; "A partir de um modelo"; "Adicionar meta"; "Ativa · desde {data}"; "Alcançada em {data}"; "Encerrada em {data}"; "Encerrar" (opções "Alcançada" e "Encerrada sem alcançar"); legenda dos dias "Cumpriu", "Não cumpriu", "Sem registro"; "Criar lembrete de {água \| refeições \| suplemento}" / "Criar lembrete"; limite (US-528); "Mostrar metas encerradas"; dia antes do início: "Antes do início"; paciente arquivado: "Paciente arquivado: reative o cadastro para dar metas." (sem "Nova meta"; "Encerrar" continua); bloqueado ou anonimizado: "Paciente bloqueado: só consulta."; meta terminada: "Terminou em {data}"; ações "Ver registro", "Editar", "Encerrar"; sucessos "Meta adicionada.", "Meta salva.", "Meta encerrada."; confirmação de "Encerrar": "Encerrar esta meta? Ela sai do app do paciente e não pode ser reaberta."; vazio "Nenhuma meta."; paciente sem conta no app (`user_id` nulo): aviso "Este paciente não usa o app: ele não vê as metas nem pode registrar o dia." (a meta pode ser dada; vale para quando ele entrar); erros de data da US-528 ("Escolha uma data de hoje até {data}", "A data final precisa ser depois do início (até 1 ano)") |
| Detalhe da meta (`plano-alimentar/metas/[metaId]`) | `<title>` "Registro da meta" (sem o título da meta, RN-551); h1 = título da meta (dentro da ficha); `CabecalhoDetalhe`/link "Voltar para Plano alimentar"; subtítulo "Últimos 30 dias"; lista `ol` dos 30 dias com "Cumpriu", "Não cumpriu", "Sem registro" ou "Antes do início"; a adesão da RN-548 |
| Modelos de metas | Título "Modelos de metas"; "Novo modelo"; "Incluir sugestões"; categorias e "Sugerir lembrete" (US-527); dica fixa "Sugestões gerais: ajuste cada meta ao paciente antes de atribuir."; sucessos "Modelo salvo." e "Modelo arquivado."; vazio "Nenhum modelo de meta. Toque em Novo modelo ou em Incluir sugestões."; título repetido: "Já existe um modelo com este título." |
| Portal, metas | Card "Metas de hoje"; botões "Cumpri" e "Não cumpri"; status "Registrado: cumpriu hoje." / "Registrado: não cumpriu hoje." / "… ontem."; link "Ver minhas metas"; página "Minhas metas"; "Hoje", "Ontem"; dica "Você pode marcar hoje e ontem."; meta encerrada "Esta meta não está mais ativa."; falha: "Não foi possível registrar. Confira a internet e tente de novo." (o botão volta ao estado anterior); dia antes do início: "Antes do início"; `/p/metas` sem meta ativa: "Nenhuma meta ativa no momento." |

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
| Movimentar-se pelo menos 30 minutos por dia | Atividade física | Nenhum |
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
  registro clínico datado, e o autosave do plano é para rascunho). A 360 px cada item vira um cartão (alimento,
  quantidade, kcal e "Remover"; PTN, CHO e LIP numa linha), sem tabela larga. O editor é **controlado** (o React 19
  limpa campo não controlado depois de erro da action): erro do servidor por item, em `role="alert"` junto do campo, e
  resumo no topo com links e foco. O "Total do dia" é calculado no cliente enquanto digita (a mesma função pura de
  `src/modules/recordatorio/calculo.ts`), **sem** `aria-live`; a região viva fica só na mensagem de salvo. Depois de
  "Remover", o foco vai para o item seguinte (ou para "Incluir alimento" da refeição, se era o último). Com mudança não
  salva, confirmação própria ao sair por link interno e `beforeunload`.
- **Metas** (seção do Plano alimentar): lista de cartões; em cada um, título, "Como fazer", período, a faixa dos 7 dias
  (lista `ol` com o dia e o estado em texto; ícone com `aria-hidden`), adesão, ações ("Ver registro", "Editar",
  "Encerrar"); formulário "Nova meta" em `details`: a âncora `#nova-meta` fica no `summary` (focável) e um pequeno cliente abre o
  `details` quando o hash é `#nova-meta` (`FocoNaAncora` só chama `.focus()`); o mesmo vale para `#enviar` em
  Questionários (título do cartão com `tabIndex={-1}`).
- **Portal**: card de questionário com borda da marca; card "Metas de hoje" com um grupo por meta (`role="group"`,
  `aria-labelledby` no título da meta) e dois botões `aria-pressed`; `role="status"` fixo no fim do card; alvos ≥ 44 px.
  O formulário do questionário segue o padrão do formulário do diário (erro junto do campo, `aria-describedby`,
  `aria-invalid`, foco no resumo de erros). Depois de "Cumpri", o card **não remonta** (estado local, sem `router.refresh`), para o foco ficar
  no botão (o `ConfirmarNoMural` já falhou nisso; caso no E2E).
- **Página do link** (`/questionario/[token]`): sem cabeçalho do portal, com o **nome do consultório em texto**, sempre no
  claro, como `/documento/[token]` e `/autorizacao-ia/[token]` (`<main className="bg-fundo …">` sem `data-tema`: o `:root` é
  claro e a cor do consultório só chega dentro de `[data-tema]`), mesmo formulário (QP-D40).
- **Texto livre** ("Suas respostas", o `dl` do painel, a observação do recordatório, título e "Como fazer" da meta no
  painel e no card do portal): `whitespace-pre-line wrap-break-word` em todo nó; E2E a 360 px com uma URL longa na semente.
- **Componentes**: `Botao`/`BotaoLink`, `Aviso`, `Cartao` e `Selo` (`src/components/ui/`); nada de `bg-destaque text-white`
  à mão.
- **Estados do paciente** em Questionários, Recordatórios e Metas: arquivado (envio, reenvio e meta nova indisponíveis, com
  o texto da §6.2; recordatório e "Encerrar" continuam), bloqueado ou anonimizado (só leitura, "Paciente bloqueado: só
  consulta."; padrão `status !== 'bloqueado'` de `plano-alimentar/lembretes/secao.tsx`).
- **Rotas `plano-alimentar/metas/[metaId]` × `plano-alimentar/[planId]`**: `/plano-alimentar/metas` sem id cai em
  `[planId] = 'metas'` e responde `notFound()` limpo (`idValido`); caso no teste da página.

---

## 8. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-520 | Acessibilidade | WCAG 2.1 AA, axe sem violação em claro e escuro, a 1280 e 360 px, em todas as telas novas (inclusive `/questionario/[token]`, que fica no claro como as outras páginas sem login: aparelho claro, escuro emulado e 360 px, `e2e/acessibilidade.spec.ts`); navegação da Anamnese com `aria-current`; botões de meta com `aria-pressed`; mensagens em `role="status"` fixo; erros com `role="alert"` junto do campo |
| RNF-521 | Desempenho | Hoje continua em duas transações (P08-13): o card do questionário e as metas entram na de `faixaDeHoje` (duas consultas indexadas); p95 de Hoje e do Início da ficha dentro da meta (RNF-01: ≤ 800 ms), com cenário na pilha de carga (P08-03) incluindo 3 metas e 1 questionário aberto. Worker: lote ≤ 200 envios por tenant e rodada |
| RNF-522 | Segurança | Token do link com MAC de 128 bits e comparação em tempo constante; limite por IP; `no-store` e `no-referrer`; respostas limitadas a 1.900.000 bytes por envio no servidor (`Buffer.byteLength` do `JSON.stringify`, QP-D58) e a 2.000.000 no CHECK de defesa (`octet_length(respostas::text)`, que conta os espaços do `jsonb::text`; 100 perguntas × 5.000 caracteres chegam a ~1,5 MB em UTF-8) e validadas pelo snapshot; nenhum valor digitado em mensagem de erro |
| RNF-523 | Testes | (a) unidade: `calculo.ts` do recordatório (CS-522), token do link (formato, MAC, e-mail corrigido, forma canônica), regras do automático (janela, `primeira`/`todas`), dias de meta no fuso (virada do dia em `America/Sao_Paulo` com o servidor em UTC); (b) integração (Testcontainers): gatilhos `questionario_envios_regras` e `metas_registros_regras` por papel (nutri, paciente com e sem conta, recepcao se o 26 estiver na `main`, publico, worker), RLS e isolamento, auditoria (escritas e `auditRead`), exportação e bloqueio; (c) E2E: CS-520, CS-523, recordatório completo, envio pela consulta; axe |
| RNF-524 | Privacidade | Teste das chaves das respostas de API e dos payloads RSC do portal (só os campos da tela) e do push e do e-mail (CS-521); cada módulo novo (`questionarios`, `metas`, `recordatorio`) tem o seu `logs.test.ts`, no molde de `src/modules/ia/logs.test.ts` (textos marcadores na resposta, no título da meta e no alimento; nenhum aparece no log, na fila, no e-mail nem no push); não existe um `src/modules/logs.test.ts` geral (QP-D62) |
| RNF-525 | Manual | Guias novos `questionarios` (`/painel/questionarios…`), `metas-modelos` (`/painel/metas…`) e `recordatorio` (`/painel/pacientes/[id]/anamnese/recordatorios…`), com `data-guia` próprios (`questionarios-novo`, `questionarios-automatico`, `metas-incluir-sugestoes`, `recordatorio-incluir-refeicao`, `recordatorio-total`), **antes** de `prontuario` em `GUIAS` (a ordem decide; o regex de `configuracoes`, `configuracoes(/.*)?`, não pode engolir as rotas novas); passos novos nos guias `prontuario` (navegação da Anamnese, questionários) e `plano-alimentar` (seção Metas). Versões sobem a partir da `main` do momento (`versao + 1`, uma vez cada); `configuracoes` +1 pelos dois cartões; o teste que fixa `prontuario` em `versao 3` (e proíbe "documento" nos textos dele) muda na mesma tarefa. `TSX_FORA` de `conteudo.test.ts` ganha `src/modules/questionarios`, `src/modules/recordatorio` e `src/modules/metas`. **Guia do portal** (`src/modules/ajuda/portal.ts`): um item com ressalva ("Quando a sua nutricionista enviar um questionário ou der metas, eles aparecem em Hoje."); a `versao` sobe (4 sobre a `main` de hoje), o que mostra o aviso "O app mudou" (`AVISO_PORTAL.atualizado`) a todos os pacientes — aceito (QP-D41). `/questionario/[token]` não precisa de `SEM_AJUDA` (o teste varre só `/painel` e `/conta`) |

---

## 9. Modelo de dados

Uma migration **gerada** (colunas e tabelas, CHECKs, índices) e uma **custom** `rls_questionario_recordatorio_metas`
(RLS, auditoria, gatilhos, `REVOKE`, `staff_only`), numeradas no rebase (C-524), rodadas com `DATABASE_URL_MIGRATOR`
(regra 7). Tudo no PR 1 (QP-D27, QP-D44).

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
| `respostas` | `jsonb null` | CHECK `respostas is null or (jsonb_typeof(respostas) = 'object' and octet_length(respostas::text) <= 2000000)` |
| `respondido_em` | `timestamptz null` | gravado pelo gatilho (`clock_timestamp()`) |
| `respondido_via` | `text null` | CHECK `in ('app', 'link')` |
| CHECK `questionario_envios_resposta_coerente` | | `(situacao = 'respondido') = (respostas is not null and respondido_em is not null and respondido_via is not null)` |
| `cancelado_em`, `cancelado_por`, `cancelado_motivo` | `timestamptz null`, `uuid null`, `text null` | CHECK `cancelado_motivo in ('nutri', 'consulta_cancelada', 'paciente_bloqueado')`; CHECK `(situacao = 'cancelado') = (cancelado_em is not null and cancelado_motivo is not null)`; CHECK `cancelado_motivo is distinct from 'nutri' or cancelado_por is not null` |
| `anamnese_id` | `uuid null` | FK composta `(tenant_id, patient_id, anamnese_id)` → `anamneses (tenant_id, patient_id, id)` `NO ACTION` (UNIQUE novo `anamneses_tenant_paciente_id_unique` na gerada, como `consultations`); CHECK `anamnese_id is null or situacao = 'respondido'`; UNIQUE parcial `where anamnese_id is not null` |
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
-- questionario_envios_regras (BEFORE INSERT OR UPDATE), molde 0119/0116, tudo com IS DISTINCT FROM (QP-D35):
--   0. UPDATE sem mudança (to_jsonb(NEW) - 'updated_at' = to_jsonb(OLD) - 'updated_at') → RETURN NEW, qualquer papel
--   1. NEW.tenant_id ≠ app_current_tenant(), ou papel 'paciente' com NEW.patient_id ≠ app_current_patient() → RETURN NEW
--      (a RLS da própria tabela recusa: os testes negativos do isolamento esperam a mensagem dela, violaRlsDe)
--   2. papel 'publico', 'conta', 'recepcao' — e 'paciente' no INSERT — → RETURN NEW (publico_negado, isolamento da conta,
--      recepcao_negada e paciente_sem_insert recusam)
--   INSERT ('nutri', 'worker', ''): lê o titular FOR KEY SHARE (NOT FOUND → RETURN NEW; status ≠ 'ativo' ou anonimizado_em
--           → 42501): espera o bloqueio em curso e nunca cria envio para titular bloqueado (RN-533);
--           'nutri': origem 'nutri', enviado_por = app_current_user(); 'worker'/'': origem 'automatico', enviado_por nulo;
--           para os dois: situacao 'enviado', sem respostas, sem cancelamento, sem anamnese_id;
--           'nutri' e 'worker': enviado_em e created_at := clock_timestamp() (o valor mandado não vale) e expira_em nulo ou
--           <= enviado_em → 42501, antes do CHECK (P27-01d); '' grava o mandado (semente)
--   UPDATE, colunas fixas para todos: id, tenant_id, patient_id, modelo_id, modelo_snapshot, origem, enviado_por, enviado_em,
--           created_at; respostas, respondido_em e respondido_via nunca mudam depois de gravadas
--   'paciente': só enviado → respondido (RN-529), clock_timestamp() < OLD.expira_em, titular ativo e não anonimizado
--           (lê patients FOR KEY SHARE — visível: a sessão de paciente tem update em patients; o módulo já travou antes,
--           QP-D33), respondido_em := clock_timestamp(), respondido_via 'app' ⇔ app_current_user() IS NOT NULL;
--           nenhuma outra coluna (to_jsonb(NEW) - lista = to_jsonb(OLD) - lista); respondido_via fora de 'app'/'link' (ou
--           nulo) e respostas nulas → 42501 do gatilho, antes do CHECK (o 23514 levaria a linha ao log; regra 3, P27-01c)
--   'nutri': enviado → cancelado (cancelado_por = app_current_user(); motivo 'nutri', ou 'paciente_bloqueado' só com o
--           titular já em status 'bloqueado'; cancelado_em := clock_timestamp()); anamnese_id de nulo para valor só em
--           'respondido'; nada mais
--   'worker'/'': enviado → expirado (só com OLD.expira_em <= clock_timestamp() ou, com consulta, o inicio dela já passado);
--           enviado → cancelado (motivo 'consulta_cancelada', cancelado_por nulo, só com a consulta de OLD.appointment_id
--           em 'cancelada' — QP-D59; cancelado_em := clock_timestamp()); com situacao 'enviado', troca de expira_em, com ou
--           sem troca de appointment_id
--           (remarcação e consulta movida, RN-535: lê a consulta de NEW.appointment_id e exige expira_em = inicio dela;
--           consulta 'cancelada' → 42501, e expira_em <= OLD.enviado_em → 42501 antes do CHECK — P27-01d)
--   qualquer outro caso: 42501
```

- **Sem** `staff_only` (é dado do titular, que vê o envio e as próprias respostas), **sem** `app_allow_publico`.
- **Guardas** (`test/isolamento.test.ts`, só acrescentar): `FABRICAS` (envio legal da sessão `nutri`: `origem 'nutri'`,
  `enviado_por = coalesce(app_current_user(), gen_random_uuid())`, `modelo_id` e `appointment_id` nulos, `expira_em =
  now() + interval '14 days'`), `SEM_DELETE`, `DELETE_REVOGADO`, **`SEM_DELETE_DO_PACIENTE`** (o paciente lê a tabela, e o
  DELETE dele daria "permission denied" em vez de 0 linhas), `IMUTAVEIS` (comentário: "Plano 27: questionario_envios_regras
  recusa colunas fixas com 42501"), `UPDATE_DO_PACIENTE` (`situacao = 'respondido', respostas = '{}'::jsonb,
  respondido_via = 'app'`), filtro em `SO_APAGA.patients` (`and not exists (select 1 from questionario_envios …)`); não
  entra em `SO_INSERE` nem `COM_MAE`. Teste negativo: paciente sem conta lê só o envio do próprio `patient_id`.
- `rls-guard.ts`: `PACIENTE_ESCREVE` + `questionario_envios: { comandos: ['update'], motivo: 'Plano 27 (RN-529): o
  paciente responde o próprio questionário uma vez, no app ou pelo link (semConta) — só enviado → respondido, antes de
  expira_em (gatilho questionario_envios_regras)' }`.
- **Auditoria** (QP-D36): entidade `questionario` ("Questionário pré-consulta" em `ENTIDADE_ROTULO`) pelo gatilho e
  entidade `questionario_resposta` (mesmo rótulo) pelo módulo. `rotuloDaAcao` só olha entidade e ação: o `criar` de
  `questionario` é "Enviou questionário" (ator nulo = envio automático, mostrado como hoje se mostra o ator nulo); o
  `alterar` com ator (cancelar, copiar para a anamnese) fica "Alterou"; a resposta é o `criar` de `questionario_resposta`
  ("Respondeu questionário"), gravado por `responderQuestionario` com `recordAudit` nos **dois** canais (no link, ator nulo
  e IP). Ficam no `audit_log` e **fora** do Histórico (`visivelNoHistorico`): o `alterar` de `questionario` com ator nulo
  (worker e resposta pelo link) e o `alterar` de `questionario` com o mesmo ator e o mesmo `entidade_id` de um `criar` de
  `questionario_resposta` (a resposta pelo app, que o gatilho também grava; há uma resposta por envio, então o critério é
  exato, sem janela de tempo).

### 9.3 `recordatorios` e `recordatorio_itens` (novas)

**`recordatorios`**

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | — |
| `tenant_id`, `patient_id` | `uuid not null` | FK para `patients` `NO ACTION`; UNIQUE `(tenant_id, patient_id, id)` |
| `dia_relatado` | `date not null` | conferido no servidor (até hoje, 30 dias para trás) |
| `dia_atipico` | `boolean not null default false` | — |
| `observacao` | `text null` | CHECK `char_length between 1 and 2000` |
| `criado_por` | `uuid not null` | `app_current_user()` na sessão `nutri`, gravado pelo gatilho no INSERT (autoria, SBIS) |
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
| `food_id` | `uuid null` | FK → `foods (id)` `ON DELETE RESTRICT` (molde de `meal_items`: excluir um "Meu alimento" usado responde "em uso", e `MSG_ALIMENTO.emUso` passa a citar o recordatório; QP-D38) |
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
SELECT app_enable_audit('recordatorio_itens', 'recordatorio_item');  -- fora do Histórico (QP-D36)
-- QP-D17: o recordatório não é apagado (os itens sim, na edição; e em cascata de um DELETE que o código não faz)
REVOKE DELETE, TRUNCATE ON recordatorios FROM nutri_app_role;
-- recordatorios_regras (BEFORE INSERT OR UPDATE): INSERT na sessão 'nutri' → criado_por := app_current_user(); 'worker' no
--   próprio tenant → 42501 (nenhum fluxo do worker grava recordatório, e o papel worker também roda no processo web — QP-D59);
--   '' (migration, semente, fábrica) passa; tenant de fora e os outros papéis → RETURN NEW (a RLS decide);
--   UPDATE: id, tenant_id, patient_id, criado_por, created_at fixos (42501); 'worker' → 42501;
--   'nutri', INSERT e UPDATE (com mudança): lê o titular FOR KEY SHARE e recusa o bloqueado ou anonimizado com 42501 (o
--   bloqueio congela o prontuário; arquivado segue, RN-540 — P27-01d)
-- política RESTRICTIVE paciente_recordatorio_com_conta (FOR SELECT, nas duas tabelas): app_current_role() IS DISTINCT FROM
--   'paciente' OR app_current_user() IS NOT NULL — o paciente sem login (link, contexto da IA Nutri, "No app") não lê
--   recordatório nem item; molde patient_cadastro_paciente_com_conta (P27-01d)
-- recordatorio_itens_colunas_fixas (BEFORE UPDATE): id, tenant_id, patient_id, recordatorio_id fixos (42501): um item nunca
--   muda de recordatório nem de paciente
-- recordatorio_itens_sem_worker (BEFORE INSERT OR UPDATE OR DELETE, P27-01c): como a mãe, 'worker' no próprio tenant → 42501
--   no INSERT, no UPDATE (salvo sem mudança) e no DELETE; '' livre (fábrica, semente)
```

- **Sem** `staff_only` (dado do titular; o portal não lê na v1, QP-D16); sem escrita do paciente (nega por
  `app_enable_tenant_rls`); sem `publico`; o paciente sem login não lê (`paciente_recordatorio_com_conta`, P27-01d).
- **Guardas:** `FABRICAS` (`recordatorios`; `recordatorio_itens` em `COM_MAE`, a mãe criada no mesmo comando),
  `SEM_DELETE`, `DELETE_REVOGADO` e `SEM_DELETE_DO_PACIENTE` (`recordatorios`), `IMUTAVEIS` (`recordatorios`, `recordatorio_itens`), `ULTIMAS` se a FK em cascata pedir
  (conferir na tarefa), filtro em `SO_APAGA.patients` (`recordatorios`). `foods` já está em `ULTIMAS` (a FK `RESTRICT` da filha só pede a ordem que já existe).
- **Auditoria:** entidade `recordatorio` ("Recordatório alimentar") na mãe; `recordatorio_item` nos itens, sem rótulo e
  fora do Histórico (fica no `audit_log`). O Histórico mostra um "Criou"/"Alterou" da mãe por salvamento (RN-540), nunca
  um "Excluiu" por item removido (QP-D36).

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
| `criado_por` | `uuid not null` | `app_current_user()` na sessão `nutri`, gravado pelo gatilho no INSERT |
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
-- metas_paciente_regras (BEFORE INSERT OR UPDATE), QP-D35: tenant de fora e papéis 'paciente', 'publico', 'conta', 'recepcao'
--   → RETURN NEW (a RLS recusa); INSERT 'nutri' → criado_por := app_current_user(); UPDATE sem mudança passa;
--   id, tenant_id, patient_id, inicio (depois do 1º registro, lido sob a trava do paciente que o módulo toma), criado_por,
--   created_at fixos (42501); 'ativa' → 'alcancada'|'encerrada' sem volta; só 'nutri' e '' gravam; 'worker' no próprio
--   tenant → 42501 (nenhum fluxo do worker grava meta: a meta terminada é derivada na leitura, QP-D55, QP-D59); o paciente é
--   negado pela RLS — NUNCA liberar update em metas_paciente ao paciente, QP-D34: este gatilho não tem ramo de paciente.
--   P27-01d: ao ir para 'alcancada'|'encerrada', encerrada_em := clock_timestamp() (o valor mandado não vale); meta
--   terminada não muda mais nada (encerrada_em, título, como_fazer, categoria, lembrete, fim…: 42501; só updated_at);
--   encerrada_em numa meta 'ativa' → 42501; INSERT 'nutri' nasce 'ativa' sem encerrada_em. Na sessão 'nutri', o titular é
--   lido FOR KEY SHARE: anonimizado → 42501 em tudo; bloqueado → 42501 no INSERT e no UPDATE, salvo 'ativa' → 'encerrada'
--   sem outra coluna (o UPDATE do bloqueio em atenderPedidoExclusao, RN-550); '' livre
SELECT app_enable_tenant_rls('metas_registros'); SELECT app_enable_patient_rls('metas_registros');
SELECT app_enable_audit('metas_registros', 'metas_registro');  -- "Registrou meta" (QP-D36)
SELECT app_allow_paciente_escrita('metas_registros', 'insert', 'update');
REVOKE DELETE, TRUNCATE ON metas_registros FROM nutri_app_role;
-- política RESTRICTIVE paciente_meta_registro_com_conta (FOR ALL): app_current_role() IS DISTINCT FROM 'paciente'
--   OR app_current_user() IS NOT NULL (o link sem login nunca registra meta; molde patient_cadastro_paciente_com_conta)
-- app_dia_no_fuso(instante timestamptz, fuso text) STABLE: (instante AT TIME ZONE fuso)::date — pura, testada com instante fixo
-- app_hoje_do_tenant() STABLE, SET search_path = public, pg_temp: app_dia_no_fuso(now(), tenants.fuso) do tenant de app.tenant_id
--   (nulo sem app.tenant_id); REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO nutri_app_role nas duas (migrate-owner.test.ts)
-- metas_registros_regras (BEFORE INSERT OR UPDATE), RN-547 e QP-D35: UPDATE sem mudança passa; tenant/titular de fora e os
--   papéis 'publico', 'conta', 'recepcao' → RETURN NEW (a RLS recusa); 'nutri' e 'worker' no próprio tenant → 42501; '' passa;
--   'paciente': titular FOR KEY SHARE (ativo, não anonimizado) e DEPOIS a meta SEM trava (FOR SHARE/KEY SHARE some na sessão
--   de paciente: paciente_sem_update, 0070:15-16) — a trava do titular é que serializa com "Encerrar"/"Editar" (QP-D33, QP-D34)
```

- **Guardas:** `FABRICAS` (`metas_modelos` com título aleatório — o índice de título roda duas vezes por tenant —,
  `metas_paciente` como `nutri`; `metas_registros` em `COM_MAE`, com a meta criada no mesmo comando e semeada pelo contexto
  vazio do dono: as fábricas rodam como `nutri` por padrão (`PAPEL_DA_FABRICA`), o gatilho recusa a equipe e o paciente não
  insere meta; `PAPEL_DA_FABRICA` ganha o valor `'dono'`, que o laço roda pelo `owner.pool`), `SEM_DELETE` e
  `DELETE_REVOGADO` (`metas_paciente`, `metas_registros`), `SEM_DELETE_DO_PACIENTE` (`metas_paciente`, `metas_registros`),
  `IMUTAVEIS` (`metas_paciente`, `metas_registros`), `UPDATE_DO_PACIENTE` (`metas_registros`: `cumprida = cumprida`, com o
  `dia` de hoje da fábrica), filtro em `SO_APAGA.patients`; `PACIENTE_ESCREVE` + `metas_registros: { comandos: ['insert', 'update'], motivo: 'Plano 27
  (RN-547): o paciente com login registra a própria meta de hoje ou de ontem — só cumprida muda; sem DELETE (gatilho
  metas_registros_regras)' }`.
- **Auditoria:** entidade `metas` ("Metas") em `metas_paciente` e nas leituras; `metas_registro` ("Metas" em
  `ENTIDADE_ROTULO`) em `metas_registros`, com `rotuloDaAcao` dando "Registrou meta" ao `criar` e ao `alterar` (QP-D36).
  Volume aceito: uma linha de `audit_log` por toque (molde do diário, também auditado).

### 9.5 `notifications` (muda)

CHECK `notifications_tipo_valido` + `questionario_novo` (DROP/ADD da gerada, partindo do CHECK da `main` na
regeneração: o 23 acrescenta `aniversario`, `pedido_nao_confirmado`; o 25, os do chat). `TipoNotificacao`,
`ROTULO_TIPO` ("Questionário") e `AVISOS_DO_PORTAL` acrescentados no fim. Não entra em `CONTA_COTA` (não é WhatsApp)
nem em `TIPOS_DA_AGENDA` do 26 (a recepção não vê): entra em **`TIPOS_FORA_DA_RECEPCAO`** (`src/modules/notificacoes/tipos.ts`
do 26, cujo `tipos.test.ts` exige uma decisão para cada tipo do CHECK) — pelo 27 se o 26 PR 2 já estiver na `main`, ou
pelo 26 no rebase dele.

### 9.6 Ordem das migrations e listas

1. **Gerada**: colunas e índices de `anamnesis_templates`; as seis tabelas; CHECK de `notifications`. Sem edição à mão.
2. **Custom** `rls_questionario_recordatorio_metas`: tudo das §9.1 a §9.4, `app_hoje_do_tenant()`, gatilhos e `REVOKE`; também
   a FK `questionario_envios_anamnese_fk` (na gerada, o drizzle-kit criaria o UNIQUE novo de `anamneses` depois das FKs: 42830).

- `FUNCOES_COM_PAPEL` (se o 26 estiver na `main`): `app_questionario_envios_regras`, `app_metas_registros_regras`,
  `app_metas_paciente_regras`, `app_recordatorios_regras` → **"não se aplica (tabela negada à recepção)"**.
- `CLAUDE.md`: **regra 2** — frase "Plano 27" no fim (as duas tabelas com escrita do paciente — `questionario_envios`, `update`, e `metas_registros`,
  `insert`/`update` — e os gatilhos;
  `anamnesis_templates` e `metas_modelos` em `STAFF_ONLY`; `questionario_envios`, `recordatorios`, `metas_paciente` e
  `metas_registros` sem DELETE); **regra 8** —
  entidades `questionario`, `questionario_resposta`, `recordatorio`, `recordatorio_item` (fora do Histórico), `metas` e `metas_registro`, as leituras que gravam e as que não (RN-530, RN-544, RN-548) e a
  abertura do link com ator nulo e IP.
- `src/db/schema/`: arquivo novo `questionarios-metas.ts` (as seis tabelas), colunas em `pacientes.ts`; reexporta em
  `index.ts` (só acrescentar).

---

## 10. Normas profissionais e LGPD (o essencial)

| Tema | Como a spec atende |
|---|---|
| **Conteúdo do prontuário** (Res. CFN 594/2017, art. 4º, § 1º, IV, conferida em 17/11/2026 no texto do CFN: "anamnese alimentar e nutricional" com "aplicação de inquérito de consumo alimentar") | O recordatório é o inquérito de consumo; o questionário respondido é parte da anamnese, guardado no prontuário com autor, data e canal; "Copiar para uma anamnese" deixa a nutricionista responsável pelo registro clínico, sem apagar o que o paciente relatou; o relato copiado fica marcado "SIC" na anamnese e no PDF (art. 3º, III; RN-531, RN-553) |
| **Acompanhamento** (Res. CFN 594/2017, art. 5º: evolução e alteração da conduta) | Metas e adesão ficam no prontuário, exportadas e impressas na cópia |
| **Guarda** (Res. CFN 594/2017, art. 3º, VI, "b": guarda permanente, podendo ser eliminado 20 anos após o último registro) | Nada é apagado: envios, recordatórios e metas sem DELETE; anonimização não toca (RN-536, RN-550) |
| **Sigilo** (Res. CFN 599/2018, art. 20, I, até 22/01/2027; Res. CFN 856/2026, art. 23 — sigilo, privacidade e segurança —, a partir de 23/01/2027, vigência prorrogada pela Res. CFN 858/2026, texto do art. 23 em compilação não oficial; Res. CFN 594/2017, art. 3º, IV) | Push e e-mail neutros (RN-526, RN-551); link pessoal com MAC do e-mail; a recepção não vê (QP-D12); o nome do modelo não sai do prontuário |
| **Base legal** (LGPD, art. 11, II, "a" — guarda do prontuário exigida pelo CFN — e "f" — tutela da saúde, redação da Lei 13.853/2019; como o §6 do termo 1.0) | Coleta pela nutricionista para o atendimento; o aviso do formulário diz para onde vão as respostas e quem é o controlador e leva ao termo em vigor, também no link sem conta (art. 9º, I a VII; RN-528); só adultos (C-523) |
| **Minimização e finalidade** (LGPD, art. 6º, I e III) | Questionário inicial com perguntas para a consulta; nenhuma pergunta obrigatória além do motivo; sem etnia ou religião nas sugestões; nada à IA (RN-552) |
| **Acesso do titular** (LGPD, art. 18, II) | Respostas, recordatórios e metas no `dados.json` e no `prontuario.pdf` (RN-553); o paciente com login vê as próprias respostas |
| **Segurança** (LGPD, art. 46) | RLS por tenant e paciente, `recepcao_negada`, `publico_negado`, gatilhos por papel, auditoria de escrita e de leitura, link sem estado com validade e limite por IP |
| **Informar o paciente** (Res. CFN 599/2018, art. 19; Res. CFN 856/2026, art. 22; boa prática) | O texto de depois de enviar não promete leitura ("Elas ficam disponíveis…"); o aviso diz que o questionário não é atendimento de urgência e dá o 192 (§6.2) |
| **Identificação profissional** (Res. CFN 594/2017, art. 8º, II) | Lacuna anterior ao plano (nem a anamnese nem o `prontuario.pdf` mostram o CRN): backlog geral, com a pergunta dos "dois níveis" ao CRN-3 (P-Q5); o envio automático aparece como tal (origem "Automático") |
| **Telenutrição** (Res. CFN 760/2023, DOU de 24/10/2023, que revogou a 666/2020 pelo art. 17, I; art. 3º, V, telemonitoramento; art. 9º, VI, TCLE antes do primeiro atendimento — artigos lidos em compilação não oficial, a conferir no DOU, P-Q7) | O questionário é coleta prévia e a avaliação continua na consulta. Se a coleta a distância e o acompanhamento das metas contam como telenutrição para o paciente presencial é pergunta ao CRN-3 (P-Q1); se contarem, o envio passa a exigir o registro do TCLE antes de sair (RN-523, RN-533; backlog). O diário (US-042) tem a mesma pergunta em aberto |
| **Publicidade** (Res. CFN 599/2018, arts. 56 a 58) e **conteúdo de terceiros** | O plano não cria canal de divulgação; respostas e adesão às metas nunca saem do prontuário para página pública, painel inicial (Plano 28) ou material de divulgação. Questionário, perguntas e metas iniciais escritos por nós (§6.3), nada copiado do Dietbox; direito autoral fica com o advogado |

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
| R-522 | Paciente perde respostas longas sem rascunho | Aviso no topo; confirmação própria ao sair por link interno e `beforeunload` (QP-D42); validação e falha de rede sem perder o digitado; 12 perguntas no padrão |
| R-523 | Envio automático duplicado em duas rodadas ou dois workers | Índice único por consulta + `ON CONFLICT DO NOTHING`; teste de concorrência |
| R-524 | Avalanche de e-mail ao ligar o automático num consultório com muitas consultas | Janela de no máximo 7 dias; lote de 200; a fila de e-mail já tem vazão controlada |
| R-525 | Filtro `finalidade` esquecido em alguma leitura de anamnese (questionário aparece no seletor da anamnese) | Lista fechada na §4.2; teste "modelo de questionário não aparece em `listarModelosUsaveis` nem é aceito por `preencherAnamnese`" |
| R-526 | `staff_only` em `anamnesis_templates` quebra leitura escondida em contexto de paciente | Conferido no código (§9.1); a suíte de isolamento e o E2E do portal rodam no PR 1 |
| R-527 | Recordatório entra antes do Plano 19 | QP-D14 e QP-D44: o recordatório é o PR 4 e só abre com o 19 na `main`; os PRs 1 a 3 não dependem do 19 e não esperam. Sem versão "só macros" (duplicaria `lerCongelados` e o formato do 19, conflito certo); se o 19 for abandonado, a orquestradora replaneja as T9a/T9b |
| R-528 | Volume de `audit_log` com o registro diário de metas | Uma linha por toque, como o diário; teto de 8 metas; índice existente do `audit_log` |
| R-529 | A recepção marca consultas e espera ver o questionário | QP-D12; o manual do usuário (aba "Recepção" do Plano 26, se ele já estiver na `main` no fechamento) diz que o questionário é da nutricionista e sai sozinho pelo envio automático (T10); o guia `recepcao-inicio` não muda (subir a versão dele por uma frase mostraria o tour de novo) |
| R-530 | Hoje mais pesada com dois cards | RNF-521: duas consultas na transação da faixa, cenário na pilha de carga |
| R-531 | Conflito em `consultas/[id]/page.tsx` com 20 PR 2, 23 e 26 | Bloco em componente próprio (`questionario-da-consulta.tsx`) e uma linha na página; ramo por papel do 26 o esconde |
| R-532 | Fuso: "hoje" do servidor (UTC) diferente do consultório à noite | `app_hoje_do_tenant()` no banco e `hojeNoFuso` no código; teste às 22h BRT |
| R-533 | Remarcação feita por fluxo que não preenche `remarcada_de` | Consulta movida na mesma linha (`moverConsulta`): o worker realinha o `expira_em` (RN-535, item 2). Consulta nova sem `remarcada_de`: o envio aberto é cancelado com a antiga (RN-534) e o automático (se ligado) cria um novo; manual: "Reenviar" |
| R-534 | Nome do modelo com condição de saúde aparece em tela de lista | Só dentro da aba (auditado, RN-530); Início, push, e-mail e `<title>` do link nunca (RN-528, RN-551) |
| R-535 | Imagem anterior rodando sobre o banco novo (janela do deploy e volta atrás): sem o filtro de finalidade, os questionários aparecem no seletor da anamnese; `arquivarModelo` do modelo automático dá 23514; o worker antigo não conhece o e-mail `questionario_link` nem o push `questionario_novo`; a fila de 30 min fica sem consumidor | O PR 1 só cria a estrutura (nenhum questionário no banco até o PR 2). Runbook `docs/operacao/questionario-metas.md`: antes de voltar para imagem anterior ao PR 2, desligar o envio automático e cancelar os envios abertos pela tela; nunca voltar para imagem anterior ao PR 1. Registrado no fechamento |

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
| CHECK `notifications_tipo_valido`, `tipos.ts`, `mensagens.ts` | 23 (`aniversario`, `pedido_nao_confirmado`), 25 (tipos do chat), 26 (`TIPOS_DA_AGENDA`) | Tipo `questionario_novo` | Partir do CHECK da `main` na regeneração e juntar as listas; só acrescentar no fim; fora de `TIPOS_DA_AGENDA` e **dentro de `TIPOS_FORA_DA_RECEPCAO`** (o `tipos.test.ts` do 26 obriga a decisão: pelo 27 na T1a se o 26 PR 2 já entrou; senão, pelo 26 no rebase) |
| `src/email/types.ts`, `templates.tsx` | 23 (avisos sem consulta, `headers?`), 25 | Modelo `questionario_link` | Só acrescentar |
| `SECOES_DA_FICHA` (`ficha/secoes/index.ts`) | 20 (Financeiro), 23 (Consultas), 25 (Mensagens) | Três seções novas | Três linhas no fim, nesta ordem; quem entra depois rebaseia |
| `ficha/tipos.ts` (`GrupoDoAdicionar`, `ChaveDeAcao`) | 22 (ação nova em Documentos) | Nada novo no contrato (destinos por `href`) | Sem mudança de contrato |
| `src/app/painel/pacientes/[id]/plano-alimentar/page.tsx` | 19 (editor, "Ligado ao plano"), 17 (já na `main`) | Uma linha `<SecaoMetas>` antes de `<SecaoLembretes>` | Só acrescentar a linha; PR 3 (T7b), que não depende do 19 |
| `src/app/painel/pacientes/[id]/anamnese/*` | ninguém da onda (conferido: 21 e 22 não tocam) | Navegação da Anamnese, páginas novas | Livre |
| `anamnese.ts`, `anamnese-tipos.ts`, editor de modelos | 14B (já na `main`); ninguém da onda | Filtro de finalidade, `introducao` | Livre; `ia/modelos-job.ts` continua só com anamnese (teste) |
| `src/modules/plano-alimentar/meta.ts` (`contextoDoPaciente`) ← `medidasRecentes` e `listarCalculos` (`src/modules/pacientes/{antropometria,gasto-energetico}.ts`) | 21 (reescreve `antropometria.ts`, +945 linhas: versões, peso estimado; ajusta `gasto-energetico.ts`) | Peso e GET da comparação do recordatório (RN-543) e o g/kg | O 27 só chama `contextoDoPaciente`; reconferir no rebase da T9b qual peso ele devolve (medido × estimado) e o texto da linha "Último gasto energético" |
| `src/modules/plano-alimentar/calculo.ts`, `NutrientesCongelados`, `lerCongelados`, `BuscaAlimento`, `DialogoBuscaAlimento` | 19 | O recordatório importa | **Só importar**, sem mudar; PR 4 (T9a/T9b) depois do merge do 19 |
| `src/app/p/(portal)/inicio/page.tsx`, `src/modules/portal/hoje.ts`, `src/app/p/navegacao.ts` | 25 (link "Mensagens" na faixa, contadores), 23 ("Aguardando confirmação" no portal) | Dois cards em Hoje; `tambem` de Jornada e Plano | Cards em componentes próprios; só acrescentar no `tambem`; a leitura nova entra no fim de `faixaDeHoje` |
| `src/app/sw-regras.ts` | 25 (`/p/mensagens` só rede) | Rotas novas só rede | Só acrescentar |
| `lgpd.ts`, `exportacao-job.ts`, `prontuario-pdf.tsx`, `exportacao.test.ts` | 19, 20, 21, 22, 23, 25 | Bloqueio (RN-536, RN-550), exportação (RN-553) | Só acrescentar blocos; no `UPDATE` do bloqueio, as duas linhas novas depois das dos outros planos |
| `rls-guard.ts`, `audit-guard.ts`, `test/isolamento.test.ts`, `audit.ts` (`ENTIDADE_ROTULO`), `CLAUDE.md` | todos | Entradas novas | Só acrescentar no fim de cada bloco; no `CLAUDE.md`, ficar com a linha da `main` e reacrescentar a frase "Plano 27"; em `audit.ts` (21 e 22 acrescentam entidades e `nomesDosAtores`), `rotuloDaAcao` e `visivelNoHistorico` ganham casos no fim |
| `src/jobs/queues.ts`, `src/worker/index.ts` | 19, 22, 23, 25 | Fila `questionarios-automaticos` | Só acrescentar |
| `src/app/painel/configuracoes/page.tsx` (`CARTOES`) | 19, 22, 23, 26 | Dois cartões | Só acrescentar no fim |
| `src/modules/ajuda/conteudo.ts`, `portal.ts` (+ testes) | 18 a 26 | Guias novos e versões | Só acrescentar guias; versão = `main` + 1 no rebase |
| `scripts/e2e-seed.ts`, `e2e/painel-rotas.ts`, `e2e/acessibilidade-painel.spec.ts` | todos | Rotas e dados novos | Rebase; o E2E do link usa paciente próprio. **O seed apaga `appointments` a cada execução** (`scripts/e2e-seed.ts:108-127`): o envio `respondido`/`cancelado` do E2E "envio pela consulta" aponta para a consulta (FK `NO ACTION`, DELETE revogado, `appointment_id` só muda em `enviado`) e daria 23503 na segunda execução — o `comLancamento` vira "tem lançamento **ou** `questionario_envios`" (a consulta fica, cancelada pelo sistema) |
| `test/carga/seed.ts:195` | 18 (já na `main`), 19 | Pega o modelo `padrao = true` sem finalidade e pode escolher o questionário | Filtrar `finalidade = 'anamnese'` |
| `src/app/painel/navegacao.ts` (`DO_HUB`) e `navegacao.test.ts` | 22 (acrescenta `/painel/exames`, EP-D51) | `/painel/questionarios` e `/painel/metas` | Só acrescentar no fim da lista; no rebase, manter as duas contribuições |
| `src/app/p/(portal)/jornada/page.tsx`, `src/modules/portal/jornada*.ts` | 21 (reescreve `jornada.ts` e `jornada-regras.ts`) | Botão "Meus questionários" | Só a página muda (um `Link` no grupo de botões e a contagem do módulo novo); `jornada.ts` não muda |
| `next.config.ts` (`headers`) | 23 (`/n/:slug/pedido/:token*`, `/aniversario/sair/:token*`, AG-D71) | Regras do link do questionário | Só acrescentar no fim do array, depois da regra `/:path*` |
| Planos 28 e 29 (onda 4) | 28 (painel inicial: cartões), 29 (PD-125: questionário em branco em PDF) | O 28 pode querer um cartão "Questionários respondidos"; o 29 imprime o modelo de questionário | Avisar as sessões: o 29 lê `anamnesis_templates` com `finalidade = 'questionario'` e o snapshot (`ModeloSchema` com `introducao`); o 28 conta envios pelo módulo `questionarios/envios.ts` (sem `auditRead`: só contagem). **Busca geral do 28 (PD-123, RN-591 dele):** o 28 já filtra `finalidade = 'anamnese'` nos modelos de anamnese; as telas `/painel/questionarios` e `/painel/metas` entram no catálogo `src/modules/busca/telas.ts` e os modelos de questionário (link `/painel/questionarios/{id}`) e de metas (`metas_modelos`, link `/painel/metas/{id}`) em `FONTES_DE_MODELOS` — por quem entrar depois (o 27 na T2 e na T7a, se o 28 já estiver na `main`) |
| Numeração | 25 (440–479), 26 (480–519), 28 (560–599), 29 (600–639) | — | O 27 fica no 520–559 |

**Ordem** (detalhe no plano, "Coordenação"): PR 1 (fundação do banco, a única migration) entra na fila de migration
depois do que estiver na frente; PR 2 (questionário), PR 3 (metas) e PR 4 (recordatório, depois do merge do Plano 19), sem
migration, depois do PR 1.

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
| **QP-D14** | **Nutrientes congelados** ao salvar no formato do Plano 19, e **o recordatório (PR 4, QP-D44) depois do merge do 19** | Fidelidade do prontuário (editar "Meu alimento" não muda o passado); micros, fontes e `lerCongelados` nascem no 19, e duplicá-los seria conflito certo | RN-541, C-527 |
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
| **QP-D27** | *(Refinada pela QP-D44 do plano: quatro PRs, o PR 1 só com a fundação do banco.)* **Dois PRs**: PR 1 = banco inteiro (as seis tabelas, `anamnesis_templates`, `notifications`) + questionário; PR 2 = recordatório e metas, **sem migration** | Um só lugar na fila de migration (§5 de `sessoes-paralelas.md`); o PR 2 espera o 19 sem segurar o questionário | §13 |
| **QP-D28** | Questionário no portal na seção **Jornada** e metas na seção **Plano** (pelo `tambem`), com cards em Hoje; nenhuma seção nova | Layout G do Plano 16 tem 5 seções fixas; o questionário é da consulta (Jornada), a meta é da conduta (Plano) | §4.7 |
| **QP-D29** | Rotas novas do portal e do link **só rede** no service worker | Dado de saúde e estado que muda a cada toque | §4.7 |
| **QP-D30** | O nome do modelo aparece ao paciente **só dentro** do formulário dele; nunca em push, e-mail, `<title>` do link ou no Início da ficha | O nome pode dizer uma condição ("gestante"); dentro do formulário é para o próprio titular | RN-528 |
| **QP-D31** | Recordatório com **dia relatado** até 30 dias para trás e **"Dia fora do comum"** | O método pede o dia anterior típico; registrar a atipicidade evita conclusão errada; 30 dias cobre consulta remarcada | US-526 |
| **QP-D32** | **Salvar por botão** no recordatório (sem autosave) | É registro clínico datado e auditado; autosave geraria uma linha de auditoria por digitação | §7 |
| **QP-D33** | **Ordem de travas pelo titular**: toda escrita do paciente (responder, registrar meta) trava antes o próprio `patients` com `FOR KEY SHARE`; a equipe trava com `FOR UPDATE` (`carregarPacienteParaEscrita`, também em editar e encerrar meta); os gatilhos travam o titular de novo | Sem a trava prévia, resposta × bloqueio fecha ciclo (40P01) e o registro de meta corre com "Encerrar" e "mudar início"; a trava do titular serializa os três sem peça `SECURITY DEFINER` (revisor-rls C1, I1) | RN-529, RN-546, RN-547, RN-559 |
| **QP-D34** | **Nunca** liberar `update` em `metas_paciente` ao paciente; o gatilho do registro lê a meta sem trava, depois da trava do titular | Liberar seria o conserto "fácil" do C1 e daria ao paciente escrita numa tabela cujo gatilho não tem ramo dele (título, "alcançada") | RN-547, §9.4 |
| **QP-D35** | Os gatilhos novos **devolvem NEW** a papel que não é dono da operação e a tenant/titular de fora da sessão (a RLS da própria tabela recusa); 42501 só depois; UPDATE sem mudança passa | Os testes negativos do isolamento exigem a recusa da RLS da tabela (`violaRlsDe`) e o UPDATE sem mudança da equipe (molde 0119); recusar antes quebraria o teste sem provar nada | §9.2, §9.4 |
| **QP-D36** | Auditoria com entidades próprias por ação de quem não é a nutricionista: `questionario_resposta` ("Respondeu questionário", pelo módulo, nos dois canais), `metas_registro` ("Registrou meta") e `recordatorio_item` (fora do Histórico; a mãe leva um `alterar` por salvamento) | `rotuloDaAcao` só olha entidade e ação; o `alterar` do link sai com ator nulo e sumiria com o filtro do worker; item removido viraria "Excluiu" num registro que não se apaga | §9.2–§9.4, RN-529, RN-540 |
| **QP-D37** | Itens do recordatório gravados **por diferença** (molde `rascunho.ts`), com gatilho de colunas fixas; só os itens novos ou alterados recongelam | Upsert pelo id vindo do cliente atualizaria item de outro paciente do tenant; recongelar tudo contradiz QP-D14 | RN-540, RN-541 |
| **QP-D38** | `recordatorio_itens.food_id` com `ON DELETE RESTRICT` | Molde de `meal_items` (`excluirAlimento` responde "em uso"); `SET NULL` mudaria o registro sem novo salvamento e geraria "Alterou" sem autor | §9.3 |
| **QP-D39** | O envio (manual e automático) **exige e-mail** no cadastro | O e-mail leva o link e é a chave do link sem estado (RN-527); sem ele a tela prometeria um aviso que não sai | RN-523, RN-533 |
| **QP-D40** | Página do link **sempre no claro**, com o nome do consultório em texto (sem logo nem cor); `<title>` fixo nas duas rotas; h1 do link genérico; termo do paciente em `details` | É o padrão das páginas sem login (`/documento`, `/autorizacao-ia`; `:root` claro); o nome do modelo pode dizer uma condição e o e-mail pode ser encaminhado; o paciente sem conta nunca viu o termo (LGPD, art. 9º) | RN-528, §7 |
| **QP-D41** | No portal, **um** card de questionário em Hoje (com contagem quando há mais de um), a lista `/p/questionarios` aberta pelo botão "Meus questionários" da Jornada, e o guia do portal sobe de versão (aviso "O app mudou" a todos) | A US-523 manda à Jornada sem tela definida; vários cards empurram Hoje para baixo; o guia afirma a função com ressalva | §4.1, §4.7, RNF-525 |
| **QP-D42** | Sem rascunho também no navegador; o formulário intercepta os links internos com resposta digitada (confirmação própria) e mantém o `beforeunload` | `beforeunload` não dispara na navegação do Next nem no PWA do iOS; `sessionStorage` deixaria dado de saúde em aparelho compartilhado (QP-D7) | §4.7, §6.2, R-522 |
| **QP-D43** | Relato do paciente marcado **"SIC"** na anamnese copiada e no `prontuario.pdf`, pelo vínculo que já existe | Res. CFN 594/2017, art. 3º, III; a faixa do formulário some depois de salvar | RN-531, RN-553 |


**QP-D44 a QP-D64** são decisões do plano (tabela "Decisões novas deste plano"); esta spec já as cita e elas entram nesta tabela no fechamento (T10).

---

## 15. Pendências ★ (não travam a v1)

| ID | Pendência | Com quem |
|---|---|---|
| P-Q1 | O questionário pré-consulta e o registro diário de metas configuram telemonitoramento (Res. CFN 760/2023, art. 3º, V) e exigem o TCLE do art. 9º, VI antes do primeiro envio? Mesma pergunta para o diário (US-042). Entra na lista de `pendencias-consulta-crn3` | Dono (CRN-3) |
| P-Q2 | Link do questionário sem código: confirmar com o CRN-3/advogado (vai à lista de `pendencias-consulta-crn3`) | Dono |
| P-Q3 | Lembrete de cobrança do questionário não respondido (e-mail 24 h antes), depois de medir a taxa de resposta | Backlog |
| P-Q4 | Metas com quantidade e dias da semana; recordatório a partir do diário; IA lendo questionário; comparação do recordatório com valores de referência de micronutrientes (perfis do PD-22, Plano 19; QP-D15) | Backlog |
| P-Q5 | CRN-3: login com 2FA vale como os "dois níveis de garantia de segurança" do art. 8º, II da Res. 594/2017? A meta de atividade física (Res. 599/2018, art. 40; Res. 856/2026, art. 54) cabe como orientação geral? | Dono (CRN-3) |
| P-Q6 | Advogado: o aviso do formulário com o termo em `details` basta para o art. 9º da LGPD no link sem conta (RN-528)? A próxima versão do termo do paciente deve citar "questionários antes da consulta, recordatório alimentar e metas com o registro diário" (o §4 do termo 1.0 não cita; a base é o art. 11, II, "a" e "f") — pede novo aceite? Texto livre que identifica a pessoa depois da anonimização (arts. 12 e 16; mesmo padrão da `anamneses`) | Dono (advogado) |
| P-Q7 | Conferir no DOU o texto da Res. CFN 760/2023 (arts. 3º, 9º e 17) e o número da norma que prorrogou o novo Código (858/2026 × "156/2026" da LegisWeb) | `normas-cfn-lgpd` |

---

## 16. Pontos para o plano (PM)

Os PM-Q viraram as 12 tarefas do plano (T1 a T10, com T7 e T9 divididas em a/b; QP-D60), em **quatro PRs** (QP-D44 do plano, que refina a QP-D27: o PR 1 é só a fundação do
banco, com a única migration; questionário, metas e recordatório vêm depois, sem migration, e só o recordatório espera o
Plano 19).

| ID | Ponto |
|---|---|
| PM-Q1 | T1: reconferir os worktrees (§13), o CHECK de `notifications` e `app_enable_tenant_rls` da `main` do momento; decidir se o 26 PR 2 já entrou (muda os testes da sessão `recepcao` e `FUNCOES_COM_PAPEL`) |
| PM-Q2 | Tarefa do banco **primeiro** (PR 1): schema, gerada, custom, guardas (`rls-guard`, `audit-guard`, isolamento com os papéis), `ENTIDADE_ROTULO`, `CLAUDE.md` — revisor `revisor-rls` |
| PM-Q3 | `anamnese.ts`: filtro de finalidade em todas as funções antes de qualquer tela (teste R-525) |
| PM-Q4 | Telas de modelos de questionário (`/painel/questionarios`) reaproveitando `ModeloEditor` com `introducao` e o cartão do automático |
| PM-Q5 | Envio manual (ficha e consulta), e-mail, push, link assinado e as duas páginas de resposta (app e link) |
| PM-Q6 | Worker `questionarios-automaticos` (RN-533 a RN-535) com testes de janela, fuso e concorrência |
| PM-Q7 | Respostas no painel, "Copiar para uma anamnese", seção "Questionários" no Início, `noApp` e paridade |
| PM-Q8 | PR 4: recordatório (módulo puro, formulário, totais, comparação, micros do 19), seção no Início |
| PM-Q9 | PR 3: metas (biblioteca, sugestões, seção no Plano alimentar, detalhe de 30 dias), seção no Início |
| PM-Q10 | PRs 2 e 3: portal (Hoje, `/p/questionarios/[id]` com "Suas respostas" no PR 2; `/p/metas` no PR 3), `navegacao.ts`, `sw-regras.ts` |
| PM-Q11 | LGPD (exportação, `prontuario.pdf`, bloqueio), IA (guarda de fonte), logs, chaves (CS-521) |
| PM-Q12 | Fechamento: manual guiado (guias e versões), axe, manual técnico (caps. 02, 04, 05, 06), manual do usuário (Docs), Central de Ajuda, backlog; revisores `normas-cfn-lgpd`, `revisor-interface`, `guardiao-manual` |

---

## 17. Critérios de aceite do plano (resumo para o fechamento)

- [ ] US-520 a US-531 com os cenários passando (integração ou E2E).
- [ ] CS-520 a CS-524 medidos.
- [ ] Guardas verdes: `rls-guard.test.ts` (STAFF_ONLY, PACIENTE_ESCREVE, publico, recepção se houver), `audit-guard.test.ts`, `test/isolamento.test.ts`, `sem-conta-guarda.test.ts`, `campos-enviados.test.ts`, os `logs.test.ts` dos três módulos, guarda de páginas do manual guiado.
- [ ] Nenhum `audit_log` com conteúdo; `auditRead` exatamente onde a RN-530, a RN-544 e a RN-548 mandam.
- [ ] axe sem violação nas telas novas (claro e escuro, 1280 e 360 px).
- [ ] Manual técnico, manual do usuário, Central de Ajuda e `CLAUDE.md` atualizados.

---

## 18. Referências

- Res. CFN 594/2017 (prontuário): arts. 2º, 3º (III, IV e VI, "b"), 4º (§ 1º, IV), 5º e 8º (II) — https://cfn.org.br/wp-content/uploads/resolucoes/Res_594_2017.htm (conferida em 17/11/2026).
- Res. CFN 599/2018 (Código de Ética), arts. 19, 20 (I), 26, 40 e 56 a 58 — https://cfn.org.br/wp-content/uploads/resolucoes/Res_599_2018.html (conferida em 17/11/2026); Res. CFN 856/2026 (novo Código, a partir de 23/01/2027 pela Res. CFN 858/2026), arts. 22, 23, 31, 45 e 54 — compilação não oficial https://www.legisweb.com.br/legislacao/?id=494878.
- Res. CFN 760/2023 (telenutrição; DOU de 24/10/2023; revogou a 666/2020): https://www.in.gov.br/web/dou/-/resolucao-cfn-n-760-de-22-de-outubro-de-2023-518461727 (não respondeu em 17/11/2026); compilação não oficial https://legismap.com.br/leis-e-normas/resolucao-cfn-n-760-de-22-10-2023 (P-Q7).
- LGPD (Lei 13.709/2018): arts. 6º (I, III), 9º (I a VII), 11 (II, "a" e "f"; "f" com a redação da Lei 13.853/2019), 12, 16, 18 (II) e 46 — https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm (conferida em 17/11/2026).
- Código: `src/modules/pacientes/anamnese*.ts`, `src/modules/plano-alimentar/{calculo,meta,publicacao}.ts`, `src/modules/ia/autorizacao-token.ts`, `src/modules/documentos/link-documento.ts`, `src/modules/ficha/tipos.ts`, `src/modules/lembretes/*`, `src/modules/notificacoes/{tipos,mensagens}.ts`, `src/app/p/navegacao.ts`, `src/db/rls-guard.ts`, `test/isolamento.test.ts` (`main` 07756c4).
- Specs dos Planos 17, 18 (na `main`), 19 (`nutridebby-b`), 23 (`nutridebby-c`), 25 (`nutridebby-25`) e 26 (`nutridebby-26`).

---

## 19. Revisão da spec (painel de 17/11/2026)

Três revisores leram a v0.1 contra o worktree `nutridebby-27` (`main` 07756c4 + 540b395): `revisor-rls` (banco, RLS,
auditoria), `normas-cfn-lgpd` (CFN e LGPD) e `revisor-interface` (telas, textos, acessibilidade, manual guiado). Cada achado
foi conferido no código antes de entrar. Critical e Important procedentes entraram todos; Minor entrou quando era barato.

### 19.1 O que entrou

| Achado | Conferência no código | Onde entrou |
|---|---|---|
| **rls C1** — o gatilho do registro lia a meta com `FOR KEY SHARE`, que a sessão de paciente não enxerga (`paciente_sem_update`); todo "Cumpri" falharia | `drizzle/0070_paciente_sem_escrita.sql:15-16` (comentário da própria função) | RN-547, §9.4, QP-D33, QP-D34 |
| **rls I1** — deadlock resposta × bloqueio | `lgpd.ts:125` (`carregarPacienteParaEscrita` → `FOR UPDATE`, `base.ts:49`); o `UPDATE` trava a linha do envio antes do gatilho | RN-529, RN-536, RN-559, QP-D33 |
| **rls I2** — envio automático para paciente bloqueado na corrida e para consultório suspenso | `listarTenantsParaVarredura` devolve suspensos (`tenant-status.ts:54`) | §4.8, RN-533, §9.2 (gatilho) |
| **rls I3** — resposta pelo link sumia do Histórico; rótulos iguais para ações diferentes | `rotuloDaAcao` (`audit.ts:112`) só olha entidade e ação; `app_audit_row_change` (0007) grava `app_current_user()` | §9.2, §9.4, RN-529, QP-D36 |
| **rls I4** — itens do recordatório: trilha "Excluiu" falsa e upsert por id de outro paciente | molde `rascunho.ts:229-266` | RN-540, RN-541, §9.3, QP-D37 |
| **rls I5** — gatilhos recusavam antes da RLS; fábrica e `SEM_DELETE_DO_PACIENTE` | `test/isolamento.test.ts:187` (`PAPEL_DA_FABRICA`), `:334` (`SEM_DELETE_DO_PACIENTE`), `:379` (`violaRlsDe`), `:516` (UPDATE sem mudança) | §9.2, §9.3, §9.4, QP-D35 |
| **rls I6** — seed do E2E quebraria na segunda execução | `scripts/e2e-seed.ts:108-127` (apaga `appointments`; `comLancamento` do Plano 20) | §13 |
| rls Minor — FK composta de `anamnese_id`; `food_id RESTRICT`; limite de bytes; `paciente_bloqueado` só com titular bloqueado; `criado_por` pelo gatilho; `encerrada_motivo` inexistente; `expira_em` da remarcação; `search_path`; write skew de `inicio`; imagem antiga; `test/carga/seed.ts:195` | `anamneses` sem UNIQUE composto (`pacientes.ts:279-297`); `meal_items.food_id` `restrict` (`plano-alimentar.ts:119`); `converter` (`anamnese-tipos.ts:106`, 5.000 caracteres); `test/carga/seed.ts:195` | §9.2–§9.4, RN-535, RN-546, RN-550, R-535, §13, QP-D38 |
| **normas I-1** — a 666/2020 foi revogada pela 760/2023 | compilação não oficial e notícia do CFN (DOU não respondeu) | §10, §15 (P-Q1, P-Q7), §18 |
| **normas I-2** — relato do paciente sem a marca "SIC" depois de copiado | Res. 594/2017, art. 3º, III | RN-531, RN-553, US-525, QP-D43 |
| **normas I-3** — paciente sem conta sem a informação do art. 9º | o termo só aparece em `/p/termo`, no convite e em `/n/[slug]` (`TERMO_PACIENTE_PARAGRAFOS`) | RN-528, §6.2, §10 |
| **normas I-4** — texto prometia leitura e não dava caminho de urgência | — | §6.2, US-523, US-524, §10 |
| normas M-1, M-2, M-5, M-8, M-9 — citações e textos | Planalto (art. 11, II, "a" e "f") | §10, §6.3, §6.2, RN-536, §18 |
| normas M-4 — editar recalculava tudo, contra QP-D14 | — | US-526, RN-540, QP-D37 |
| **interface I-1** — página do link não pode ter logo, cor nem modo escuro | `src/app/globals.css:10-13`, `src/app/documento/[token]/page.tsx`, `e2e/acessibilidade.spec.ts:574-576` | RN-528, §7, RNF-520, QP-D40 |
| **interface I-2** — nome do modelo no título e no h1 | — | RN-528, §6.2, QP-D40 |
| **interface I-3** — "*" contradiz o "(obrigatória)" de `anamnese-form.tsx:61`; imutabilidade não avisada | `anamnese-form.tsx:61` | §6.2 |
| **interface I-4** — `beforeunload` não cobre a navegação do Next nem o PWA | `src/components/portal/voltar.tsx` (é `Link`) | §4.7, §6.2, R-522, QP-D42 |
| **interface I-5** — faltavam as mensagens de falha de rede e de sessão | `src/app/p/recusa-api.ts`, `sw-regras.ts` (`ehNavegacaoDoPortal`), diário (P09-04) | §4.2, §4.7, §6.2, US-523, US-529 |
| **interface I-6** — `navegacao.ts` precisa mudar (`DO_HUB`) | `src/app/painel/navegacao.ts:28` | §1.2, §4.1, §4.2, §13 |
| **interface I-7** — faltava a tela da Jornada | `src/app/p/(portal)/jornada/page.tsx` | §4.1, §6.2, RN-530, QP-D41 |
| **interface I-8** — rótulos do editor reaproveitado | `modelo-editor.tsx:45` e `:99`; `anamnese/modelos/actions.ts:24-25` (redirect sem mensagem) | §6.2 |
| **interface I-9** — arquivar o automático sem aviso | — | RN-532, §6.2 |
| **interface I-10** — vazio citava ação inexistente; padrão recriado | — | RN-522, §6.2 |
| **interface I-11** — âncoras em `details` fechado | `src/components/foco-na-ancora.tsx` (só `.focus()`) | §7 |
| **interface I-12** — estados do paciente bloqueado e arquivado | `plano-alimentar/lembretes/secao.tsx` | US-521, §6.2, §7 |
| **interface I-13** — recordatório a 360 px, editor controlado, total, foco | — | §7, §6.2 |
| **interface I-14** — quebra de texto livre | — | §7 |
| **interface I-15** — manual guiado: ressalva, versão do portal, `TSX_FORA`, teste do `prontuario`, ordem de `GUIAS`, `data-guia` | `src/modules/ajuda/conteudo.test.ts:13`, `:72`, `:107`; `portal.ts:17` (`versao: 3`) | RNF-525, §4.2 |
| **interface I-16** — `no-store`/`no-referrer` vêm do `next.config.ts` | `next.config.ts:19-23` | §4.2, RN-528, §13 |
| interface Minor — "Obrigado", artigo, "Antes do início", um card em Hoje, `CabecalhoDetalhe`, `sw-regras.ts` sem mudança, componentes `ui/`, `Selo`, `metas` × `[planId]`, paciente sem e-mail, foco depois de "Cumpri", estado da chave | `src/components/ui/{botao,aviso,cartao,selo}.tsx`, `src/components/portal/cabecalho-detalhe.tsx`, `sw-regras.ts:6` | §4.7, §6.2, §7, US-521, US-528, QP-D39, QP-D41 |

### 19.2 O que foi descartado (e por quê)

| Achado | Decisão |
|---|---|
| rls C1, alternativa "travar a meta com `FOR SHARE` numa função `SECURITY DEFINER` que troca de papel" | Não adotada: a trava do titular (`FOR KEY SHARE` do paciente × `FOR UPDATE` da equipe) já serializa registro, "Encerrar" e "Editar", sem peça `SECURITY DEFINER` nova para provar em `migrate-owner.test.ts` (QP-D33). A recomendação "nunca liberar `update` em `metas_paciente`" entrou (QP-D34) |
| rls Minor, Plano 26: a recepção edita `patients.email` e passaria a controlar o link | Descartado na parte do e-mail: a spec do 26 já fixa `email` na sessão da recepção (gatilho `patients_da_recepcao`, lista branca; RE-D37). A parte do título genérico do link entrou (QP-D40) |
| rls I5, alternativa "fábrica de `metas_registros` como paciente com `patientId`" | Não adotada: o paciente não insere a meta-mãe, e uma fábrica `insert … select` que não acha a meta grava 0 linhas sem erro (o teste negativo deixaria de provar a recusa). Fica o contexto vazio do dono com a mãe no mesmo comando (`COM_MAE`); a prova do caminho do paciente fica no teste do banco |
| normas I-1, efeito "TCLE antes do envio" | Não entra na v1: depende da resposta do CRN-3 (P-Q1); se for "sim", vai ao backlog junto com o diário (US-042) |
| normas M-3 — "Registrado por {nome}, nutricionista, CRN-{n}" em cada registro | Backlog geral: a lacuna é anterior ao plano (nem a anamnese nem o `prontuario.pdf` mostram o CRN) e ler o nome da usuária pede nova exceção de `user` (regra 1); pergunta dos "dois níveis" no P-Q5 |
| normas M-4, parte "guardar as versões do recordatório" | Backlog (boa prática SBIS NGS1); o `audit_log` guarda quem alterou e quando |
| normas M-6 e M-7 (termo do paciente e texto livre depois da anonimização) | Pendência ao advogado (P-Q6); texto legal novo é um por vez, pela orquestradora |
| interface I-1, alternativa "contêiner `data-tema="claro"` com logo e cor do consultório" | Não adotada: o padrão das páginas sem login é o claro sem marca (QP-D40) |
| interface I-4, alternativa `sessionStorage` | Não adotada: dado de saúde em aparelho compartilhado (QP-D7, QP-D42) |
| interface I-5, alternativa Server Action | Não adotada: o portal trata sessão vencida e consultório suspenso com `recusaDoPortal` nas rotas de API (molde do diário e dos exames); a página do link usa a mesma rota de API |
| interface Minor — "Parabéns, meta alcançada" no portal | Backlog: pede leitura de meta encerrada no app, que a v1 não faz |
| interface Minor — mostrar "Aviso por e-mail enviado" e a linha de push na tela do envio | Backlog: a fila de e-mail não confirma a entrega na transação do envio; o texto de sucesso já diz o que sai, e o envio exige e-mail (QP-D39) |

### 19.3 Pendências do painel

- `normas-cfn-lgpd` não conseguiu gravar a memória (agente sem `Write`): as linhas de fontes (Res. 594 arts. 3º III, 4º § 1º IV, 5º, 8º II; Res. 599 arts. 19, 20, 26, 36, 40, 52, 55–58; Res. 760/2023 arts. 3º V, 5º, 9º VI, 17; Res. 856/2026 arts. 22, 23, 31, 45, 54, 66, 102 § 2º; LGPD art. 11, II "a" e "f" e art. 9º, I a VII) ficam para o controlador acrescentar em `.claude/agent-memory/normas-cfn-lgpd/fontes-cfn-ia-prontuario.md` e `fontes-lgpd-anpd-termos.md`.
- P-Q1, P-Q5 e P-Q2 vão para a lista `pendencias-consulta-crn3`; P-Q6, para o pacote do advogado.

### 19.4 Revisão do plano (17/11/2026)

Dois revisores leram o plano e esta spec v0.2 contra a `main` 07756c4 e os worktrees dos Planos 19 a 29: `revisor-rls`
(nenhum Critical ou Important; 14 Minor) e a crítica de completude (26 itens). Cada achado foi conferido no código; os
procedentes entraram na spec (v0.3) e no plano (decisões QP-D52 a QP-D64).

| Achado | Conferência no código | Onde entrou |
|---|---|---|
| Completude 1 — consulta movida na mesma linha | `src/modules/agenda/consultas.ts:171` (`moverConsulta` muda `inicio`; `validarHorario` aceita data passada, D22, `:77`) | RN-524, RN-535 (2), RN-534, §9.2, R-533, QP-D53 |
| Completude 2 — `TIPOS_FORA_DA_RECEPCAO` | plano do 26, T5a (`tipos.test.ts` exige decisão para cada tipo do CHECK) | §9.5, §13 |
| Completude 3 — meta ativa depois do `fim` | — | RN-546, §4.6, §6.2, QP-D55 |
| Completude 4, 5, 9 a 13, 19 — testes de auditoria, alimento invisível, estados do bloco, modelo recusado, `editarMeta`, título repetido, `podeAdicionar`, anonimização, exportação, portal | `src/modules/ficha/tipos.ts:52` (`podeAdicionar`), `inicio.ts:60` | Plano (Steps 1); RN-539, RN-546, §4.6, §6.2 |
| Completude 6 — guarda de log | não existe `src/modules/logs.test.ts`; só `src/modules/ia/logs.test.ts` | CS-521, RNF-524, §17, QP-D62 |
| Completude 7, 16, 18 — axe do painel das metas, guias que mudam, manual técnico | `docs/manual-tecnico/` (`03`, `04-modulos-clinicos.md`, `07`, `10`); guias `agenda`, `inicio-paciente`, `modelos` em `src/modules/ajuda/conteudo.ts` | Plano (T7a, T7b, T10) |
| Completude 8, 17 — manual do usuário e Central como no Plano 26; R-529 | plano do 26, T12, Step 2b | R-529; plano (T10) |
| Completude 14 — seletor sem modelo | — | RN-539, §6.2 |
| Completude 15 — textos que faltavam | — | §6.2 |
| Completude 20, 22 — Plano 21 (`contextoDoPaciente`), Plano 28 (busca) | `nutridebby-21` (`antropometria.ts` +945); spec do 28, RN-591 e §13 (`FONTES_DE_MODELOS`, `telas.ts`) | §13 |
| Completude 21 — R-527, QP-D14 e §13 diziam "PR 2" | — | R-527, QP-D14, QP-D27, §13, §16 |
| Completude 23 — referências de micronutrientes | — | §2.2, P-Q4 |
| Completude 24 — link no intervalo do cancelamento; consultório suspenso | `link-documento.ts:125` (molde: tenant `ativa` + titular `ativo`) | RN-524, RN-527, QP-D53, QP-D54 |
| Completude 25 — e-mail corrigido com envio aberto | — | RN-525, §6.2 (dica) |
| Completude 26 — tamanho das tarefas | — | plano (T7a/T7b, T9a/T9b; QP-D60) |
| rls 1 — ordem de travas do worker, 23505 na remarcação, aviso duplicado | `lgpd.ts` (`cancelarTarefas` trava o tenant `NO KEY UPDATE`) | §4.8, §4.8 (avisos), RN-533, RN-535, QP-D52 |
| rls 2 — `now()` não se fixa; dia no TS × no banco | — | RN-547, §9.4, QP-D56 |
| rls 3 — `jsonb::text` mede mais que `JSON.stringify` | — | RN-529, RNF-522, QP-D58 |
| rls 5 — ramo `worker` fraco | — | RN-534, §9.2, §9.3, §9.4, QP-D59 |
| rls 6 — cópia para a anamnese sem trava e com filtro | — | RN-531 |
| rls 7 — link de titular arquivado | — | RN-527, QP-D54 |
| rls 12 — RN-548 × T8 sobre o `auditRead` | regra 8 do `CLAUDE.md` | RN-548, QP-D57 |
| rls 4, 8 a 11, 13, 14 — teste de meta de outro paciente, "cinco tabelas", `migrate-owner.test.ts`, banco recriado entre T1a/b/c, cartão de metas no PR 3, runbook, E2E repetível | `src/db/migrate-owner.test.ts`; `e2e/pacientes-form.ts` (`criarPacientePeloFormulario`), `e2e/portal.ts` (`pacienteNoPortal`) | plano (T1, T2, T6, T7a, T8; QP-D61, QP-D63) |

**Descartados (e por quê):**

| Achado | Decisão |
|---|---|
| Completude 8 — aba "Equipe" no manual do usuário | Não se aplica: o 27 não muda a equipe; a aba "Recepção" do 26 recebe só a frase do R-529 |
| Completude 17 — frase nova no guia guiado da recepção (`recepcao-inicio`) | Não adotada: subir a versão do guia dela mostraria o tour de novo por uma frase que não é tarefa dela; a frase vai ao manual do usuário (R-529) |
| Completude 25 — ação "Reenviar link" no envio aberto | Não adotada: seria uma ação nova que manda e-mail sem mudar o envio; "Cancelar envio" + "Reenviar" já resolve, com a dica na tela |
| Completude 26 — dividir a T4 (link × portal) | Não adotada: o formulário é o mesmo nos dois canais e as 12 tarefas são o teto do briefing |
| rls 14 — fechar na semente o envio `enviado` do paciente fixo pela sessão `nutri` | Não adotada: os E2E criam paciente novo por execução (QP-D61); a semente não ganha paciente do questionário |
| Completude 1 — tratar a mudança de horário dentro de `moverConsulta` | Não adotada: `consultas.ts` é disputado (20, 23, 26); o worker realinha a cada 30 min e o `ENVIO_VISIVEL` fecha a janela até lá |

