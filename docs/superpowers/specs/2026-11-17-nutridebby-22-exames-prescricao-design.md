# NutriDebby — Exames e prescrição (Plano 22) — Design

| Item | Valor |
|---|---|
| Versão | 0.3 (17/11/2026): a 0.1 já trazia a crítica de completude (registro na §17); a 0.2 aplica o painel de revisão da spec (rls, normas, interface, completude; registro na §18); a 0.3 traz os ajustes técnicos da revisão do plano (§20) |
| Data | 2026-11-17 |
| Situação | **Rascunho — revisado por lentes; decisões delegadas pelo dono (onda 2).** O dono autorizou seguir as recomendações sem parar para perguntar (briefing da onda 2): cada decisão de produto está na §14 como "EP-Dn — decisão — porquê". Lentes aplicadas antes desta versão: levantamento do código, normas (`normas-cfn-lgpd`, 17/11/2026) e crítica adversarial de completude (conferida no código). A revisão da spec pelo painel (`revisor-rls`, `normas-cfn-lgpd`, `revisor-interface` e crítico de completude) está aplicada nesta v0.2 (§18); os menores que ficaram estão na §19. Pareceres externos (CRN-4, advogado) estão na §14.3 e não travam a v1 |
| Itens do backlog | Paridade Dietbox, onda 2, Sessão B: **PD-60** (solicitação de exames com modelos e PDF assinado) · **PD-61** (classificação automática do resultado) · **PD-62** (possíveis causas → "Nota de interpretação") · **PD-63** (comparativo entre datas) · **PD-64** (cadastro de suplementos e fitoterápicos, fórmula manipulada por composto) · **PD-65** (modelos de prescrição) · **PD-66** (envio à farmácia → "Compartilhar" pelo paciente). Mais a função "Mostrar no aplicativo do paciente" do exame, que o briefing cita e não tem PD próprio |
| Branch e base | `plano-22-exames-prescricao` (worktree `nutridebby-22`) a partir de `origin/main` **6c3ee8f** (Planos 17, 18 PR 1 e 20 PR 1; última migration `0123_rls_financeiro`). Onda 1 lida nos worktrees `nutridebby-18` (`plano-18-pr2`, 25f4787), `nutridebby-b` (`plano-19-plano-alimentar-2`, d95d319) e `nutridebby-c` (`plano-20-financeiro`) |
| Insumos | `.sessoes/onda2-briefing.md` (§ Plano 22) e, no scratchpad da onda 2 (`onda2/p22/`): `levantamento.md` (código, função a função, conflitos), `normas.md` (CFN, LGPD, Lei 14.063, conferidas em 17/11/2026), `proposta.md`, `critica.md` e `critica-respostas.md`. Referência funcional: os exames laboratoriais e a prescrição do Dietbox, só pelo briefing. **Copiamos a função, nunca a marca, os textos ou o layout** |
| Documentos de base | [`2026-10-03-nutridebby-documentos-assinados-design.md`](2026-10-03-nutridebby-documentos-assinados-design.md) (Planos 10A e 13: RN-140 a RN-158, D1, D3, D5, D7, D8, D14, D15, D17, D20), [`2026-10-03-nutridebby-ia-nutricionista-design.md`](2026-10-03-nutridebby-ia-nutricionista-design.md) (leitura de laudo, §5.11, RN-113), [`2026-10-03-nutridebby-paciente-exames-ia-design.md`](2026-10-03-nutridebby-paciente-exames-ia-design.md) (Plano 12, D17 = a; IA Nutri, RN-172, A-D17), [`2026-11-16-nutridebby-18-ficha-cadastro-design.md`](2026-11-16-nutridebby-18-ficha-cadastro-design.md) (registro de seções, D14, D16, RN-277, RN-279, RN-281, R-266), a spec do Plano 19 (`nutridebby-b`, RN-238, R-244, D27), [`2026-11-16-nutridebby-20-financeiro-design.md`](2026-11-16-nutridebby-20-financeiro-design.md) (formato desta spec, F-D17) e o manual técnico, caps. [02](../../manual-tecnico/02-banco-de-dados.md) e [04](../../manual-tecnico/04-modulos-clinicos.md) |
| Numeração nova | US-370 a US-381 · RN-370 a RN-399 · RNF-370 a RNF-377 · CS-370 a CS-373 · C-370 a C-379 · R-370 a R-390 · DEP-E1 a DEP-E14 · PM-E1 a PM-E16 · **EP-D1 a EP-D44** (decisões deste documento; o prefixo "EP-" — exames e prescrição — evita colisão com as D dos planos e das outras specs, como "F-D" e "AG-D"). **Bloco 370:** os Planos 18 (260–284), 19 (230–259) e 20 (300–329) já usam os seus; na onda 2, a proposta do Plano 21 ficou com US-330..349/RN-330..369 e a do 23 com o bloco 400 (conferido nas propostas da onda 2 em 17/11/2026). O 370–399 está livre em todos os prefixos. Se mesmo assim colidir, quem mescla depois renumera (EP-D39) |

---

## 1. Visão

Hoje o exame da nutricionista é um registro simples: título, data, laudo opcional e linhas de valores digitadas (nome,
valor, unidade e referência em texto livre), sem edição, sem catálogo, sem classificação, sem pedido de exame e nunca
visível ao paciente (US-015; US-044 e D17 = a do Plano 12). A prescrição é a **receita** dos documentos assinados
(Plano 10A): itens estruturados pelas Res. CFN 656/2020 e 680/2021, PDF no worker, assinatura digitalizada com 2FA,
entrega, verificação pública, retificação e cancelamento — mas sem modelos, sem itens salvos, sem fórmula fitoterápica
com vários compostos e com orientações só em texto puro. O Plano 22 fecha o que falta frente ao Dietbox, **dentro das
normas** que já valem.

1. **Solicitação de exames (PD-60).** Um **tipo novo de documento assinado**, "Solicitação de exames laboratoriais",
   sobre a base do Plano 10A: a nutricionista escolhe exames do catálogo do consultório (ou digita), carrega um modelo,
   prepara, assina com 2FA e entrega como a receita; o laboratório confere a autenticidade pelo código. Sem campo de
   laboratório. Da solicitação assinada, **"Lançar resultados"** abre o exame novo com as linhas dos exames pedidos — o
   elo entre os "dois tipos" do Dietbox (solicitação e análise).
2. **Catálogo e classificação (PD-61).** Um **catálogo de exames do consultório** (nome, unidade, outros nomes,
   exames que compõem um painel como o hemograma, faixas do consultório com fonte e modelos de nota). No lançamento:
   "Adicionar do catálogo" com "Selecionar todos", "Carregar modelo de solicitação", "Remover todos" e **editar exame**.
   Cada linha pode ter a **faixa numérica do laudo** (de/até); a classificação **neutra** ("Abaixo", "Dentro", "Acima da
   referência") é calculada contra ela. Uma **categoria do consultório** ("Deficiência", "Desejável"…) só aparece se a
   nutricionista cadastrou a faixa, com a fonte. Nada é gravado: a classificação é calculada na leitura. "REF" por linha.
3. **Nota de interpretação (PD-62).** No lugar do "Ver causas", um texto **da nutricionista**, com modelos dela por
   exame e sentido (abaixo/acima). A plataforma não traz texto clínico e não usa IA.
4. **Comparativo (PD-63).** Tabela marcador × datas com 2 a 6 exames, classificação neutra por célula.
5. **Mostrar no app.** Por exame, desligado por padrão: o paciente vê título, data, valores, unidade, referência do
   laudo e um marcador neutro "Fora da referência", com o aviso "Não é diagnóstico. Converse com sua nutricionista." A
   política RESTRICTIVE no banco garante; a nota, as categorias e o laudo nunca vão ao app.
6. **Prescrição (PD-64, PD-65).** Tipo novo de item **"Fórmula magistral fitoterápica"** (2 a 10 derivados vegetais, só
   com habilitação, termos de nutriente e de substância isolada barrados como conferência de apoio — Res. 680, art. 9º, II); **itens salvos** ("Suplementos",
   "Fitoterápicos"); **modelos de prescrição** ("Salvar como modelo", "Carregar modelo"); **orientações com formatação
   mínima** (parágrafo, lista, negrito — nunca HTML). Tudo é **cópia**: a receita continua imutável e sem FK para o
   cadastro, e todas as conferências normativas rodam de novo.
7. **Compartilhar (PD-66).** Sem cadastro de farmácias e sem envio pela nutricionista (Res. CFN 599/2018, art. 60, em
   vigor; Res. CFN 856/2026, art. 74, a partir de 23/01/2027, texto do DOU a conferir). O **paciente** compartilha o PDF assinado que já tem no app (ou na página do link) com a farmácia
   ou o laboratório que **ele** escolher, pelo compartilhar do aparelho.

O que **não** muda: o parecer (Plano 13), a leitura do laudo pela IA (Plano 11), o envio de exames pelo paciente (Plano
12), a IA Nutri (Plano 15), o termo do paciente e o DPA, o menu do painel e as abas da ficha.

### 1.1 Critérios de sucesso

| ID | Critério | Como medir |
|---|---|---|
| CS-370 | Da ficha ao pedido assinado: "Nova solicitação de exames" → "Carregar modelo" → preparar → assinar → entregar no portal **sem digitar nome de exame** | E2E (US-377) |
| CS-371 | Lançar um hemograma de 20 linhas escolhendo **um painel** do catálogo (nome e unidade vêm do catálogo; a faixa vem do laudo) e ver a classificação neutra de cada linha com faixa **antes de salvar** | E2E (US-371, US-372) |
| CS-372 | Receita de 5 itens montada a partir de um modelo em **1 clique + revisão**, com todas as conferências de novo (habilitação, via, unidade, campos do art. 12) | Teste de integração + E2E (US-379) |
| CS-373 | **Nenhum** valor de exame da nutricionista visível ao paciente fora dos documentos assinados que ela entregar, salvo os exames marcados "Mostrar no app"; com a marca, só aquele exame, sem nota, categoria ou laudo — **a RLS garante quais exames** (não o portal); a projeção fechada de `examesLiberadosDoPaciente` garante quais campos (teste das chaves devolvidas) | Teste de isolamento + paridade do "No app" (US-375) |

### 1.2 Premissas e restrições

| # | Premissa / restrição | Origem |
|---|---|---|
| C-370 | **Função, não marca.** Nenhum nome de tela, texto, ícone, layout ou dado do Dietbox é copiado | Dono, backlog Paridade Dietbox |
| C-371 | **Só a nutricionista** (sessão `nutri`) mexe em exames, catálogo, modelos e documentos. Não há papel novo; o admin nunca consulta tabelas com `tenant_id` | `user.app_role` (`src/db/schema/auth.ts`); CLAUDE.md regra 1 |
| C-372 | **A plataforma não traz referência clínica pronta**: nem faixa, nem "causas", nem modelo de solicitação ou de prescrição. A única semente é uma lista de **nomes** de exames laboratoriais (EP-D8) | Precedente da RN-238 do Plano 19; normas P3 e P4; RDC 657/2022 a conferir |
| C-373 | **Sem IA nova.** Nenhum contexto de IA muda; `campos-enviados.ts` não ganha categoria | D7 do 10A; A-D17; normas P3 |
| C-374 | **Sem farmácia nem laboratório** em nenhum campo, cadastro ou envio da plataforma | RN-151 e D14 do 10A; Res. CFN 599/2018, art. 60; Res. CFN 856/2026, art. 74 (ver §10) |
| C-375 | **PDF só no worker; nenhum tipo novo em `stored_files`, nenhum `salvarArquivo` novo.** A solicitação usa `documento_base`, `documento_digitalizado` e `documento_assinado` como a receita | CLAUDE.md regra 9 |
| C-376 | **Sessões paralelas.** Planos 18 PR 2, 19 e 20 PR 2 (onda 1) e 21 e 23 (onda 2) escrevem ao mesmo tempo. Número de migration não se reserva: quem mergeia depois **gera de novo** em cima da `main` (`docs/operacao/sessoes-paralelas.md`, §5); arquivos disputados só ganham linhas novas (§6) | Worktrees conferidos em 17/11/2026 |
| C-377 | **Só adultos** (RN-17/D-11): faixas do consultório em anos completos; menos de 1 ano fica sem categoria | MVP; spec 18 |
| C-378 | **O formato de `exams.valores` só ganha chaves opcionais**; nenhuma chave existente muda de sentido | 8+ leitores (DEP-E1) |
| C-379 | **Sem dependência nova**: a formatação das orientações é um leitor próprio de marcação mínima, sem editor de texto rico | `package.json`; RNF-376 |

### 1.3 Dependências (conferidas no código em 17/11/2026, `main` 6c3ee8f)

| ID | Depende de | O que esta spec usa | Situação e arquivo |
|---|---|---|---|
| DEP-E1 | **Exames da nutricionista (US-015)** | Tabela, linhas, criar/excluir, séries | ✅ `exams` (`src/db/schema/pacientes.ts:303-331`): `data`, `titulo` (1–120), `arquivo_path`, `valores jsonb` `{nome, valor, unidade, referencia, iaTarefaId?}[]`, `updated_at` (já existe), `UNIQUE (tenant_id, patient_id, id)` (alvo de FKs). Sem gatilho de `updated_at` (só o módulo grava). `src/modules/pacientes/exames.ts`: `lerValores` (:32), `criarExame` (:58), `excluirExame` (:109), `listarExames` (:140, `auditRead`), `agruparMarcadores` (:159), `marcadoresDoPaciente` (:173). **Não há edição.** Leitores de `valores`: `exames.ts`, `ia/conferencia.ts`, `ia/correspondencia.ts`, `ia/resumo-dados.ts`, `documentos/parecer-exames.ts`, `documentos/parecer.ts`, `pacientes/exportacao-job.ts`, `pacientes/evolucao.ts` e as páginas da aba Exames |
| DEP-E2 | **RLS e auditoria de `exams`** | Política nova | ✅ `drizzle/0030_rls_exames.sql`: `app_enable_tenant_rls`, `app_enable_patient_rls`, `app_enable_audit('exams','exames')`; **não** está em `STAFF_ONLY` (`src/db/rls-guard.ts:105`). Hoje a sessão de paciente **lê** as próprias linhas de `exams` pelo banco; só o portal não consulta (`src/modules/portal/evolucao.ts:8`: "Dobras, densidade e exames nunca") |
| DEP-E3 | **Laudo na RLS do paciente** | Laudo fora do app | ✅ `drizzle/0102_rls_exames_enviados.sql:63-70` (`paciente_arquivos`): o paciente lê os próprios arquivos, salvo `documento_base`, `documento_digitalizado` e `exame_pagina`; o tipo `exame` fica legível (o Plano 12 precisa dele para o PDF do próprio envio). O laudo só é servido por `signFileUrl` em rotas do painel |
| DEP-E4 | **Conferência da IA (Plano 11)** | Concorrência com a edição | ✅ `src/modules/ia/conferencia.ts:125-126` trava o exame (`FOR UPDATE`) e depois a tarefa; `:164` grava `valores` e `updatedAt`. O resumo do histórico (14B) carimba cada exame por `updated_at` (`src/modules/ia/resumo-dados.ts:110`) e mapeia as linhas campo a campo, sem faixa |
| DEP-E5 | **Parecer (Plano 13)** | Não mudar | ✅ `mesmoExame` (`src/modules/documentos/parecer.ts:83-87`) compara título, data e `[nome, valor, unidade, referencia]` de cada linha; `refMin`/`refMax` não entram |
| DEP-E6 | **Documentos assinados (Plano 10A)** | Tipo novo | ✅ CHECKs `signed_documents_tipo_valido` e `document_verifications_tipo_valido` = `('receita','parecer')` (`src/db/schema/documentos.ts:57`, `:183`); assinatura só `digitalizada` (`:66`, `:181`). Gatilhos `0091`, `0093`, `0105` só comparam `tipo` entre versões (sem lista de tipos). `TIPO_DOCUMENTO_ROTULO` e `DECLARACAO_POR_TIPO` (`src/modules/documentos/constantes.ts:38`, `:55`). Interruptor `tenants.documentos_liberados` (`src/db/schema/platform.ts:39`) |
| DEP-E7 | **Ternários binários de tipo** | Infraestrutura do tipo novo | ⚠️ Tudo o que não é parecer vira receita: `retificacao.ts:31-33` (`semCopia`, que também **descarta chaves novas** do conteúdo) e `:63` (justificativa só da receita); `documento-pdf.tsx:109`; `documentos.ts:37` (conteúdo vazio), `:75`, `:96`, `:141`; `link-documento.ts:128` (`?? 'receita'`); `lgpd-documentos.ts:93`; `registrar-assinatura.ts:52` (`exigirHabilitacaoAtual`: `tipo !== 'receita'` → passa); `src/app/painel/pacientes/[id]/documentos/[docId]/page.tsx:45-46`; `digitalizada-job.tsx:92` (`TIPO_DOCUMENTO_ROTULO[d.tipo]`) e `:29` (`d.titulo ?? TIPO_DOCUMENTO_ROTULO.receita`: o título passa a ser obrigatório, vindo do `switch`); `src/app/painel/pacientes/[id]/inicio/acoes.ts` (`ACOES: Record<ChaveDeAcao, …>`, §4.3). (Não confundir com `contents.tipo = 'receita'`, receita culinária dos conteúdos) |
| DEP-E8 | **Prescrição (Zod)** | Item novo, itens salvos, modelos | ✅ `src/modules/documentos/prescricao.ts`: `TIPOS_ITEM` (:6-11: `suplemento`, `planta_cha`, `derivado_vegetal`, `fitoterapico`), unidades, vias, `MSG_PRESCRICAO`; suplemento com composição 1–10 e "Manipulado"; `conferirHabilitacao` (:131-135) só olha `'fitoterapico'`; até 20 itens; orientações texto puro ≤ 2000. Habilitação é do **tenant** (`fitoterapiaRegistro`). Arquivo sem import do servidor (usado no cliente) |
| DEP-E9 | **Filas do PDF** | Fila nova | ✅ `src/jobs/queues.ts:51` (`documento-pdf`), `:53` (`documento-digitalizado`); `src/worker/index.ts:230`, `:234`. Molde da fila "-2" no Plano 19: `FILA_DO_PDF_DO_PLANO`/`FILAS_DO_PDF_DO_PLANO` (`nutridebby-b`, `src/jobs/queues.ts:106-108`; `src/worker/index.ts:214`) |
| DEP-E10 | **Ficha (Plano 18 PR 1, na `main`)** | Adicionar e seção Exames | ✅ `src/modules/ficha/tipos.ts:25` (`ChaveDeAcao = 'criar-receita' \| 'criar-parecer'`), `:31` (grupos `avaliacoes`, `prescricoes`, `outros`); `secoes/exames.ts` (sem `noApp`; rótulo "Exame", nunca o título, D14 do 18); `secoes/documentos.ts` (Adicionar "Receita" e "Parecer" no grupo `prescricoes`). ⬜ **Plano 18 PR 2** (`nutridebby-18`): `noAppPor` (`secoes/comum.ts:26`), paridade RNF-263 b e a RN-279 ("exames da nutricionista não têm `noApp`") — ainda não na `main` |
| DEP-E11 | **Configurações** | Dois cartões | ✅ `src/app/painel/configuracoes/page.tsx:12-18` (7 cartões); Plano 19 acrescenta 3 e sobe o guia `configuracoes` (8 → 9); Plano 23 propõe "Locais de atendimento" |
| DEP-E12 | **Portal** | Seção e menu "Exames" | ✅ `src/app/p/navegacao.ts:12` (`/p/exames`, "Exames"), `:17-18` (`secoesDoPortal({ exames })` esconde o item; hoje `exames = examesVisiveis(tenant, temEnvio)` = recebimento ligado **ou** envio visível do paciente, RN-192, `src/modules/portal/exames-enviados.ts:302`, calculado em `src/app/p/moldura.ts:9` e, na transação da faixa, em `src/modules/portal/hoje.ts:29`); `src/components/portal/barra-de-acoes.tsx:13`; `/p/documentos` e `GET /api/p/documentos/[id]/pdf` (auditRead); página do link com 303 quando a sessão de 15 min vence (`src/app/api/documento/[token]/pdf/route.ts:9-16`) |
| DEP-E13 | **LGPD** | Exportação e anonimização | ✅ `montarDados` (`src/modules/pacientes/exportacao-job.ts:327`: "todas as tabelas do paciente, menos as staff_only"; `:140-149` tipo de `exames`; `:523` `valores: e.valores` inteiro). Documentos: `lgpd-documentos.ts` (justificativa de uso na cópia do titular, D15 = b). O ZIP **não** tem LEIA-ME. `app_anonimizar_documentos` (0091) é genérica por tipo |
| DEP-E14 | **IA Nutri e termo** | O que não muda | ✅ `src/modules/ia/nutri-paciente/contexto.ts` não lê `exams` (conferido); `instrucoes.ts:12` classifica pergunta sobre exame como `sintoma_ou_exame` e manda à nutricionista. Termo do paciente 1.0 (`termo-paciente-textos.ts`) cita "receitas e pareceres", não cita pedido de exame nem exame no app; DPA 1.0 (o 1.1 está no Plano 20 PR 2) |

---

## 2. Escopo

### 2.1 Dentro

| ID | Bloco | Conteúdo | Backlog |
|---|---|---|---|
| E-01 | **Catálogo de exames** (`/painel/exames/catalogo`) | Exames do consultório: nome, unidade, outros nomes, **painel** (exames que o compõem), **faixas do consultório** (sexo do cadastro, idade, limites, categoria de lista fechada, fonte), **modelos de nota** (abaixo/acima); "Nomes de exames para começar" (lista de nomes, sem unidade e sem faixa) | PD-61, PD-62 |
| E-02 | **Modelos de solicitação** (`/painel/exames/modelos`) | Nome, lista de exames (do catálogo ou livres), orientações ao paciente; usados na solicitação e na análise | PD-60 |
| E-03 | **Lançar e editar exame** | "Adicionar do catálogo" (busca, "Selecionar todos", painel expande em linhas), "Carregar modelo de solicitação", "Remover todos", faixa do laudo por linha (de/até), botão "Usar {a} a {b}" lido do texto da referência, **editar exame** com versão e concorrência (EP-D41) | PD-61 |
| E-04 | **Classificação e REF** | Neutra contra a faixa da linha; categoria do consultório com a fonte; aviso fixo; "REF" por linha | PD-61 |
| E-05 | **Nota de interpretação** | Uma por exame, da nutricionista; "Inserir modelo"; não vai ao app nem ao PDF; entra na cópia do titular | PD-62 |
| E-06 | **Comparativo** | Tabela marcador × datas (2 a 6 exames) | PD-63 |
| E-07 | **Mostrar no app** | Botão por exame ("Mostrar no app do paciente" / "Retirar do app"); política RESTRICTIVE; seção "Resultados liberados" em `/p/exames`; menu do app; `noApp` da seção Exames do Início | Função do briefing |
| E-08 | **Solicitação de exames laboratoriais** | Tipo novo de documento (rascunho, preparo, declaração, PDF no worker, assinatura, entrega, verificação, retificação, cancelamento, exportação, anonimização); "Lançar resultados" | PD-60 |
| E-09 | **Infraestrutura do tipo novo** | Ternários → `switch` exaustivos; `exigeHabilitacao`; filas `documento-pdf-2` e `documento-digitalizado-2` | — |
| E-10 | **Receita** | Item "Fórmula magistral fitoterápica"; orientações com marcação mínima (também na solicitação) | PD-64, PD-65 |
| E-11 | **Itens salvos e modelos de prescrição** (`/painel/prescricao/…`) | "Suplementos" e "Fitoterápicos"; "Salvar item", "Adicionar item salvo"; "Salvar como modelo", "Carregar modelo" | PD-64, PD-65 |
| E-12 | **Compartilhar** | No app e na página do link, o paciente compartilha o PDF assinado em vigor pelo compartilhar do aparelho (ou baixa); "compartilhar com o paciente" do PD-66 = a entrega que já existe (portal, link com código, pessoalmente; RN-152 a RN-158), sem mudança (EP-D43) | PD-66 |
| E-13 | **LGPD, manuais e guias** | Exportação (nota, "mostrado no app", faixas, solicitação), textos de transparência, parágrafo do termo 1.1 pronto (Anexo A), manual técnico, Central de Ajuda, guias | — |

### 2.2 Fora

| Item | Por quê |
|---|---|
| **Cadastro "Farmácias"** e envio da receita pela nutricionista ou pela plataforma | Res. CFN 599/2018, art. 60 (caput e III; em vigor), e 856/2026, art. 74 (ver §10) (vedado indicar farmácia ou laboratório); RN-151/D14 do 10A; pediria autorização por envio, registro de compartilhamento, termo e DPA novos (normas P5). Volta só com a resposta do CRN-4 (§14.3) e decisão do dono (EP-D24) |
| **Campo de laboratório** na solicitação | Os mesmos artigos citam "laboratórios" (EP-D2) |
| **Texto pronto de "causas"** e qualquer IA comentando exames | Texto clínico que soa como diagnóstico de doença (posição de prudência da spec de documentos §3.1: a Lei 12.842/2013, art. 4º, I, foi vetada e o § 1º só define diagnóstico nosológico; o ato da nutricionista é o diagnóstico de nutrição, Res. 600/2018, Anexo I, XXXII); A-D17 e D7 do 10A; *High-risk AI Recommendation* da política da Anthropic; RDC 657/2022 a conferir (EP-D18) |
| **Tabela clínica de faixas da plataforma** | A referência certa é a do laudo (método, laboratório); precedente RN-238 do Plano 19 (C-372) |
| **Gestação** nas faixas do consultório | O cadastro não tem esse dado; o Plano 21 cria a fase da vida **por avaliação**. Backlog depois do 21 (R-379) |
| **Exame de imagem** (densitometria, ultrassom) na solicitação | Lei 8.234/1991, art. 4º, VIII, e Res. 306/2003 falam só de "laboratoriais"; pergunta 1 ao CRN-4. O limite é aplicado pela ajuda fixa junto de "Adicionar exame fora do catálogo" e pela declaração, sem bloqueio (a lista de exames não é do CFN) |
| **Laudo (arquivo) no app** | Mantém a D17 = a do Plano 12 para o arquivo; só os valores do exame marcado (EP-D22) |
| **Título livre, "nome interno" e data editável** nos documentos | Título = tipo do documento; data retroativa em documento assinado é risco; um nome livre seria dado de saúde nas listas sem `auditRead` (EP-D32) |
| **"Exportar" PDF do rascunho** | Receita sem assinatura não é receituário (656, art. 3º, XI; 680, art. 12, III). O PDF-base do preparo (impresso para a digitalizada) continua como é (EP-D32) |
| **Lembrete criado a partir da posologia** | Reabriria a NORMAS-DECISAO-2 do Plano 17 (EP-D40) |
| **Vários anexos por exame** | YAGNI: um laudo por exame |
| **Anexar ou trocar o laudo de um exame existente** | O laudo entra na criação (inclusive em "Lançar resultados"); a troca pediria `apagarArquivo` + `salvarArquivo` numa transação com a edição (regra 9), e não há pedido (EP-D44) |
| **IA nova** (casar o nome lido com o catálogo na IA, faixa lida pela IA) | C-373. A leitura atual continua gravando `referencia` em texto; a nutricionista usa o botão "Usar {a} a {b}" (EP-D16) |
| **Classificação no parecer** e mudança do parecer | O parecer mantém a cópia congelada (RN-148); `mesmoExame` não olha a faixa (DEP-E5) |
| **Classificação no gráfico da Evolução** | A Evolução não muda; a classificação fica na aba Exames e no comparativo |
| **Plano 10B** (gov.br, ICP-Brasil) | Continua esperando os PDFs do dono; a solicitação herda o nível de assinatura da receita (EP-D1) |
| **Notificação push/e-mail** quando a nutricionista libera um exame | YAGNI; o paciente vê na próxima abertura |
| **Exame no `prontuario.pdf`** da exportação com a nota | A nota vai só no `dados.json` nesta versão (EP-D19) |
| **Semente** de itens salvos, modelos de prescrição ou modelos de solicitação | Seria conduta sugerida pelo operador (C-372, RN-372) |

---

## 3. Perfis de acesso

| Perfil | Pode | Não pode |
|---|---|---|
| **Nutricionista** (sessão `nutri`) | Catálogo, faixas, modelos de nota e de solicitação; lançar, editar e excluir exame; nota de interpretação; comparativo; "Mostrar no app"; com `documentos_liberados`: solicitação, receita com fórmula (com habilitação), itens salvos, modelos de prescrição | Indicar farmácia ou laboratório; gravar fórmula ou item fitoterápico formulado sem habilitação do consultório; editar documento depois do preparo (só retificar) |
| **Paciente com login** (sessão `paciente`) | Ver os exames **liberados** (RLS) e os documentos emitidos; "Compartilhar" o PDF assinado em vigor | Ler exame não liberado, a nota, as versões do exame, o catálogo, as faixas ou os modelos (RLS e `staff_only`); gravar em qualquer tabela nova ou em `exams` (`paciente_sem_*`) |
| **Paciente pelo link com código** | "Compartilhar" o PDF do documento do link (mesma rota de hoje) | — |
| **Público** | Ver na verificação o rótulo "Solicitação de exames laboratoriais", sem dado de saúde (D8 do 10A) | Tudo o mais (`publico_negado`; nada em `PUBLICO_LIBERADO`) |
| **Worker** | PDF da solicitação, da fórmula e da marcação (filas "-2"); exportação; anonimização dos documentos (`app_anonimizar_documentos`, genérica) | Gravar no catálogo, nos modelos ou na nota |
| **Admin** | O interruptor `documentos_liberados` (já existe) | Consultar qualquer tabela com `tenant_id` |

---

## 4. Arquitetura

### 4.1 Rotas e navegação (painel)

| Tela | Rota | Título (h1) |
|---|---|---|
| Catálogo de exames | `/painel/exames/catalogo` | "Catálogo de exames" |
| Exame do catálogo | `/painel/exames/catalogo/novo` · `/painel/exames/catalogo/[id]` | "Novo exame do catálogo" / "{nome}" |
| Modelos de solicitação | `/painel/exames/modelos` · `/novo` · `/[id]` | "Modelos de solicitação" / "Novo modelo de solicitação" / "{nome}" |
| Itens salvos | `/painel/prescricao/itens?tipo=suplementos\|fitoterapicos` · `/painel/prescricao/itens/novo?tipo=…` · `/painel/prescricao/itens/[id]` | "Itens salvos" / "Novo item salvo" / "{nome}" |
| Modelos de prescrição | `/painel/prescricao/modelos` · `/[id]` | "Modelos de prescrição" / "{nome}" |
| Exames do paciente (existe) | `/painel/pacientes/[id]/exames` | ganha "Adicionar do catálogo", "Carregar modelo de solicitação", "Remover todos", faixa por linha, classificação, "REF", "Comparar exames" e "Abrir" por exame |
| Detalhe do exame | `/painel/pacientes/[id]/exames/[exameId]` | "{título} — {dd/mm/aaaa}" (auditado) |
| Editar exame | `/painel/pacientes/[id]/exames/[exameId]/editar` | "Editar exame" |
| Comparativo | `/painel/pacientes/[id]/exames/comparativo?ids=…` | "Comparativo de exames" |
| Versões anteriores do exame | `/painel/pacientes/[id]/exames/[exameId]/versoes` | "Versões anteriores" (auditado, EP-D41) |
| Documentos (existe) | `/painel/pacientes/[id]/documentos` · `/[docId]` | botão "Nova solicitação de exames"; o editor escolhe o formulário **pelo tipo** (switch) |

- **Configurações:** dois cartões novos no **fim** de `CARTOES` (`src/app/painel/configuracoes/page.tsx`), depois do que
  já estiver na `main` quando a tarefa rebasear (Planos 19 e 23 também acrescentam): **"Exames"** (`/painel/exames/catalogo`,
  "Catálogo de exames, faixas do consultório e modelos de solicitação.") e **"Prescrição"** (`/painel/prescricao/itens`,
  "Suplementos, fitoterápicos e modelos de prescrição."; só com `documentos_liberados`). O guia `configuracoes` sobe uma
  versão a partir da que estiver na `main` (EP-D33).
- **Navegação interna:** "Exames" tem `nav aria-label="Seções de exames"` com "Catálogo · Modelos de solicitação";
  "Prescrição", `nav aria-label="Seções de prescrição"` com "Suplementos · Fitoterápicos · Modelos de prescrição"
  (`aria-current="page"`), no estilo das abas do prontuário.
- **Nenhum item no menu do painel e nenhuma aba nova na ficha** (13 abas; R-266 do Plano 18). Solicitação e receita
  ficam na aba **Documentos**; catálogo aplicado, comparativo e nota na aba **Exames**.
- Cada `page.tsx` nova entra em `e2e/painel-rotas.ts` e tem guia do manual guiado ou entrada em `SEM_AJUDA` (R-386).
- **Sem `documentos_liberados`**, `/painel/prescricao/*` responde `notFound()` (como `/p/documentos`); `tipo` ausente ou
  inválido em `/painel/prescricao/itens` vale `suplementos`. Os modelos de prescrição não têm tela de criação (nascem da
  receita, "Salvar como modelo"); a lista vazia explica isso (§6.2).

### 4.2 Módulos

Todas as funções com `withTenant(ctx, …)` (`ctx` com `actorUserId` e `ip`). As que leem ou gravam tabelas `staff_only`
conferem `ctx.role === 'nutri'` antes de abrir a transação (numa sessão de paciente, `staff_only` devolveria vazio em
silêncio), como o Plano 20.

| Arquivo | Conteúdo |
|---|---|
| `src/modules/exames/constantes.ts` (novo) | `MSG_EXAMES` (§6.2), `CATEGORIAS_DO_CONSULTORIO` (EP-D12), `NOMES_PARA_COMECAR` (EP-D8, rascunho para a Debby), `PAINEIS_PARA_COMECAR` (só o hemograma, nomes), limites |
| `src/modules/exames/classificacao.ts` (novo, **puro**, sem import do servidor) | `classificarNeutra(valor, refMin, refMax)`, `categoriaDoConsultorio(linha, indice, paciente, dataDoExame)` (idade em anos completos na data do exame por `idadeEm`, de `src/modules/pacientes/datas.ts`, que já existe e é pura; EP-D46 do plano), `sugerirFaixa(texto)` (EP-D16), `referenciaDaFaixa(refMin, refMax)` (EP-D15), `casarComCatalogo(nome, unidade, catalogo)` (usa `normalizarNome` de `ia/correspondencia.ts`; devolve nada se casar com dois, EP-D14); compara unidades com `normUnidade`, que passa a ser exportada de `src/modules/ia/correspondencia.ts` (hoje privada, `:27`) |
| `src/modules/exames/catalogo.ts` (novo) | CRUD do catálogo (Zod das faixas, dos componentes e dos modelos de nota), unicidade normalizada sob trava, "Nomes para começar", `catalogoParaLancamento` (nome, unidade, componentes) |
| `src/modules/exames/modelos-solicitacao.ts` (novo) | CRUD dos modelos de solicitação; `exameDosModelos` (expande painéis para a análise) |
| `src/modules/exames/interpretacao.ts` (novo) | `salvarNota`, `apagarNota` (cada uma grava uma versão nova, só de inclusão; travas da RN-383; gatilho audita, entidade `exames_nota`), `notasAnteriores` (`auditRead` quando devolve nota); a em vigor é lida dentro de `abrirExame` |
| `src/modules/exames/comparativo.ts` (novo) | `comparativo(ctx, patientId, ids)` a partir de `agruparMarcadores`, com `auditRead` |
| `src/modules/pacientes/exames.ts` (existe) | `lerValoresComErros` (erros por linha) e `lerValores` como envoltório (mesmo comportamento para `ia/conferencia.ts`); aceitam `refMin`/`refMax` e geram `referencia` (EP-D15). **Nenhuma** função que leia ou grave `exam_versoes`/`exam_interpretacoes`: `ia/conferencia.ts:7` importa este arquivo (EP-D62 do plano) |
| `src/modules/exames/edicao.ts` (novo) | `exameParaEditar` (`auditRead`, entidade `exames`), `editarExame` (EP-D21, EP-D41: grava o estado de antes em `exam_versoes`), `versoesDoExame` (`auditRead`, entidade `exames_versoes`), `mostrarNoApp`/`retirarDoApp` (EP-D22, com `recordAudit` próprio, RN-385) |
| `src/modules/exames/detalhe.ts` (novo) | `abrirExame` (detalhe + nota + `auditRead`) |
| `src/modules/plataforma/audit.ts` (existe, disputado) | `nomesDosAtores(db, ids)` **acrescentada** no fim (nome e papel do autor das versões e notas), sem tocar em `listAccessHistory` (EP-D53 do plano) |
| `src/modules/portal/exames-liberados.ts` (novo) | `examesLiberadosDoPaciente` (sessão de paciente, projeção fechada, `auditRead`), `temExameLiberado` e `temExameLiberadoNaTransacao(tx, patientId)` (só existe/não existe, sem `auditRead`; RN-386) — sem filtro em TypeScript além da RLS (M7 da crítica; RN-281 do 18) |
| `src/modules/documentos/tipos-de-documento.ts` (novo) | `TIPOS_DE_DOCUMENTO`, `assertNever`, `conteudoVazio(tipo)`, `semCopia(c)` e a reexportação de `exigeHabilitacao` — o ponto único da infraestrutura (EP-D34); **puro, sem import do servidor** |
| `src/modules/documentos/solicitacao.ts` (novo, **puro**) | Zod do conteúdo da solicitação (sem `.strict()`: chave desconhecida, como `laboratorio`, sai da saída), `validarRascunhoSolicitacao`, `validarSolicitacaoParaPreparar`, `MSG_SOLICITACAO` e a reexportação de `DECLARACAO_SOLICITACAO` (o texto mora em `constantes.ts`, que continua sem imports) |
| `src/modules/documentos/lancar-resultados.ts` (novo) | `examesParaLancar(ctx, patientId, docId)` (EP-D7; lê o banco, por isso fora do arquivo puro — EP-D47 do plano) |
| `src/modules/documentos/prescricao.ts` (existe) | Tipo `formula_fitoterapica`, termos barrados, binômio, `descreverItem` exaustivo, `exigeHabilitacao(tipoDeItem)` (definida aqui já na T2: o arquivo é puro e roda no cliente), `conferirHabilitacao` via `exigeHabilitacao` |
| `src/modules/documentos/marcacao.ts` (novo, **puro**) | `lerMarcacao(texto) → Bloco[]` (EP-D31) |
| `src/components/dialogo.tsx` (novo, T2) | `Dialogo` sobre `<dialog>` + `showModal()`: `aria-labelledby`, `Esc` fecha, `onClose` devolve o foco ao botão que abriu, rodapé de botões e variante de confirmação (texto, rótulo do confirmar e do cancelar). Formulário dentro do diálogo é `<form>` próprio, nunca dentro do `<form>` da receita ou do exame (EP-D42) |
| `src/modules/documentos/modelos.ts` (novo) | Itens salvos e modelos de prescrição; "Carregar" recebe o conteúdo atual da tela e grava pelo mesmo caminho de `salvarRascunho` (todas as conferências), devolvendo o conteúdo gravado (RN-394) |
| `src/modules/documentos/documento-pdf.tsx`, `digitalizada-job.tsx` (existem) | Corpo da solicitação, fórmula e blocos da marcação; título pelo `switch` |
| `src/jobs/queues.ts`, `src/worker/index.ts` | `documento-pdf-2` e `documento-digitalizado-2` (EP-D34) |

### 4.3 Ficha (registro de seções do Plano 18)

- `src/modules/ficha/secoes/exames.ts`: ganha `noApp` por `noAppPor(exams, exams.id, …)` — a contagem roda no contexto de
  paciente (`semConta`, D16 do 18), e a política `paciente_exame_liberado` faz o banco contar só os liberados. O rótulo
  continua "Exame" (D14 do 18). **Só depois do merge do Plano 18 PR 2** (T6).
- `src/modules/ficha/secoes/documentos.ts`: linha nova no **fim** de `adicionar`: `{ grupo: 'avaliacoes', rotulo:
  MSG_FICHA.itens.solicitacao, destino: { acao: 'criar-solicitacao' } }` (texto "Solicitação de exames"); o rótulo do item
  da seção vem de `TIPO_DOCUMENTO_ROTULO`.
- `src/modules/ficha/tipos.ts`: `ChaveDeAcao` ganha `'criar-solicitacao'` (linha nova no union; contrato do 18).
- `src/app/painel/pacientes/[id]/inicio/acoes.ts`: `'criar-solicitacao': criarSolicitacaoAction` (`Record<ChaveDeAcao, …>`
  não compila sem ela); a action é nova, em `documentos/actions.ts`, no molde de `criarDocumentoAction` (RN-280 do 18: a
  mesma Server Action do botão da aba). `src/modules/ficha/textos.ts`: `MSG_FICHA.itens.solicitacao`.
- `no-app.test.ts` (RNF-263 b do 18): exame liberado e não liberado no cenário, e a solicitação assinada e em rascunho.
- RN-279 do 18 ("exames da nutricionista não têm `noApp`"): **não** se edita no lugar; no fechamento, acrescenta-se ao
  fim da spec 18 (depois do merge do PR 2) "RN-279 v2 (Plano 22, EP-D22)" e o manual técnico.

### 4.4 Portal

- `/p/exames` ("Meus exames"): seção nova **"Resultados liberados"** acima do envio (quando houver exame liberado), com
  `auditRead` por abertura com itens (`entidadeId: null`, como `listarExames`). O aviso fixo fica no topo da seção.
- Item "Exames" do menu do app e da barra de ações: aparece com o **recebimento ligado, ou envio visível, ou exame
  liberado** (EP-D23). `examesVisiveis(tenant, temEnvio)` (RN-192) ganha o terceiro termo `temLiberado`, avaliado por
  último (sem consulta a mais quando os outros já deram verdadeiro), nos **dois** pontos de chamada: `molduraDaSecao`
  (`src/app/p/moldura.ts`, com `temExameLiberado(ctx)`) e `faixaDeHoje` (`src/modules/portal/hoje.ts`, com
  `temExameLiberadoNaTransacao(tx, patientId)` na transação da faixa, P08-13). A barra de ações continua levando a
  `#enviar` só com o envio ligado.
- O bloco "Meus exames enviados" de `/p/exames` some quando o recebimento está desligado e o paciente não tem envio (em
  vez de "Nenhum exame enviado ainda.").
- `/p/documentos` e a página do link (`/documento/[token]`): componente cliente "Compartilhar" no documento `assinado`
  em vigor (EP-D25).

### 4.5 Tipo novo de documento e filas

- **Infraestrutura antes do editor (T7):** cada ternário da DEP-E7 vira `switch (tipo)` com `assertNever` no `default`;
  `conteudoVazio(tipo)` substitui `CONTEUDO_VAZIO`; `semCopia` copia **todas** as chaves do conteúdo de cada tipo
  (inclusive `orientacoesFormato`) menos `copia` e `declaracao`; a justificativa só vai para a versão nova da receita;
  `exigirHabilitacaoAtual` olha os itens da receita com `exigeHabilitacao(i.tipo)` e passa direto pelos outros tipos
  por `switch`, não por "não é receita".
- **Filas:** `FILA_DO_PDF_DO_DOCUMENTO = 'documento-pdf-2'`, `FILAS_DO_PDF_DO_DOCUMENTO = ['documento-pdf',
  'documento-pdf-2']`, `FILA_DA_DIGITALIZADA = 'documento-digitalizado-2'`, `FILAS_DA_DIGITALIZADA =
  ['documento-digitalizado', 'documento-digitalizado-2']`. O app novo enfileira **só** nas "-2" (para todos os tipos); o
  worker novo consome as quatro com os mesmos handlers; o worker antigo não registra as "-2", então um job novo espera o
  worker novo. Guarda que lê o fonte (`src/worker/filas-documento-pdf.test.ts`, molde de `filas-plano-pdf.test.ts` do
  19): nenhum `send('documento-pdf'` nem `send('documento-digitalizado'` fora das constantes.
- **Volta atrás:** com solicitação ou fórmula gravadas, a imagem anterior ao PR 4 não sabe mostrar nem gerar esses
  documentos. Runbook: não voltar abaixo do PR 4 depois da primeira solicitação; se for inevitável, desligar
  `documentos_liberados` dos consultórios antes (R-375). Isso não para a exportação: o worker antigo monta o `dados.json`
  sem a nota, as versões do exame e `mostradoNoAppEm`, e trata a solicitação como receita (`lgpd-documentos.ts:93`).
  Depois de voltar abaixo do PR que trouxe nota, versão, liberação ou solicitação, reprocessar no worker novo as
  exportações concluídas nesse intervalo (ou segurar a fila `exportacao` até o worker novo subir); o mesmo vale para a
  janela do deploy em que o worker antigo ainda processa exportações.

---

## 5. Histórias de usuário

### E22 — Exames e prescrição

#### US-370 — Catálogo de exames do consultório · **M** (PD-61, PD-62)

**Como** nutricionista, **quero** um catálogo com os exames que eu peço e leio, **para** lançar e pedir sem digitar
nomes e para ter as minhas faixas e notas à mão.

```gherkin
Cenário: Catálogo vazio
  Dado que o catálogo do consultório está vazio
  Quando abro "Configurações" → "Exames"
  Então vejo "Seu catálogo ainda está vazio." e o botão "Nomes de exames para começar"
  Quando toco no botão
  Então vejo a lista "Nomes de exames para começar (você escolhe o que usar)", sem unidade e sem faixa, nenhum marcado
  E posso marcar um a um ou tocar em "Selecionar todos" e depois em "Adicionar ao catálogo"
  E os escolhidos entram no catálogo só com o nome e os outros nomes da lista
  E o botão "Nomes de exames para começar" continua lá enquanto houver nome da lista fora do catálogo

Cenário: Novo exame do catálogo
  Quando toco em "Novo exame" e informo "Ferritina", unidade "ng/mL" e o outro nome "ferritina sérica"
  E toco em "Salvar"
  Então vejo "Exame salvo." (role="status")

Cenário: Nome ou outro nome repetido
  Dado que "Glicemia de jejum" tem o outro nome "glicose de jejum"
  Quando crio "Glicose de jejum"
  Então vejo "Já existe um exame com este nome ou com um destes outros nomes: Glicemia de jejum."

Cenário: Painel
  Quando crio "Hemograma completo" e preencho "Exames que compõem este" com 20 nomes
  Então ele é salvo como painel, sem unidade, sem faixas e sem modelos de nota
  E na solicitação aparece como "Hemograma completo"
  E na análise vira 20 linhas (US-371)

Cenário: Faixa do consultório
  Dado que "25-hidroxivitamina D" tem a unidade "ng/mL"
  Quando acrescento uma faixa "Todos", idade de 18 a 120 anos, "Abaixo de" 20, categoria "Deficiência", fonte "Diretriz X, 2024"
  Então a faixa é salva e aparece com "Fonte: Diretriz X, 2024" e "atualizada em {dd/mm/aaaa}"

Cenário: Erros da faixa
  Quando salvo uma faixa sem fonte
  Então vejo "Informe a fonte (de 2 a 300 caracteres)."
  Quando salvo sem "A partir de" e sem "Abaixo de"
  Então vejo "Informe ao menos um limite."
  Quando informo "A partir de" 30 e "Abaixo de" 20
  Então vejo "O limite inicial deve ser menor que o final."
  Quando a faixa cobre valores, sexo e idade de outra do mesmo exame
  Então vejo "Esta faixa se sobrepõe a outra do mesmo público."
  Quando o exame não tem unidade
  Então vejo "Informe a unidade do exame antes de cadastrar faixas."

Cenário: Unidade com faixas
  Dado que "25-hidroxivitamina D" tem faixas cadastradas
  Quando troco a unidade de "ng/mL" para "nmol/L" ou a apago
  Então vejo "Remova as faixas antes de trocar a unidade." e nada muda

Cenário: Modelos de nota
  Então a área "Modelos de nota de interpretação" mostra, fixa, "Escreva fatores a investigar e encaminhamentos; não afirme doença."
  E os campos "Quando o resultado está abaixo da referência" e "Quando o resultado está acima da referência" (até 1000 caracteres cada)
  E o aviso "Retire dados do paciente antes de salvar."

Cenário: Excluir do catálogo
  Quando toco em "Excluir" em "Ferritina"
  Então vejo "Excluir Ferritina do catálogo? Exames, modelos e documentos já gravados não mudam." com "Excluir" e "Cancelar"
  Quando confirmo
  Então nenhum exame lançado, modelo ou documento muda (todos guardam cópia do nome)
```

#### US-371 — Lançar e editar exame com o catálogo · **M** (PD-61)

**Como** nutricionista, **quero** montar as linhas do exame a partir do catálogo e corrigir depois, **para** lançar
rápido e lançar os valores do exame que o paciente enviou.

```gherkin
Cenário: Adicionar do catálogo
  Quando toco em "Adicionar do catálogo", busco "vit" e toco em "Selecionar todos"
  Então os exames mostrados ficam marcados
  Quando toco em "Adicionar 3 exames"
  Então três linhas entram com nome e unidade do catálogo, valor vazio

Cenário: Painel expande
  Quando adiciono "Hemograma completo"
  Então entram 20 linhas, uma por componente, com a unidade do exame do catálogo de mesmo nome ou outro nome, se houver

Cenário: Carregar modelo de solicitação
  Quando toco em "Carregar modelo de solicitação" e escolho "Check-up anual"
  Então entram as linhas dos exames do modelo (painéis expandidos), e as orientações do modelo não entram

Cenário: Remover todos
  Quando toco em "Remover todos"
  Então vejo "Remover todas as linhas deste exame? Nada muda até você salvar." com "Remover" e "Cancelar"

Cenário: Faixa do laudo
  Quando preencho "Faixa do laudo: de" 70 e "até" 99 numa linha com valor 105
  Então a linha mostra "Acima da referência" antes de salvar
  Quando preencho "de" 120 e "até" 99
  Então vejo "O início da faixa deve ser menor ou igual ao fim."

Cenário: Referência em texto, faixa vazia
  Dado uma linha com a referência "70 a 99 mg/dL" e sem faixa numérica
  Então a linha mostra o botão "Usar 70 a 99"
  Quando toco nele
  Então "de" e "até" ficam 70 e 99 (só eu preencho; nada é gravado até salvar)
  Dado uma linha com a referência "Desejável < 200; Limítrofe 200 a 239"
  Então não há botão

Cenário: Faixa sem texto
  Quando salvo uma linha com faixa 70 a 99 e a referência vazia
  Então a referência gravada é "70 a 99"

Cenário: Faixa e texto diferentes
  Quando a referência diz "70 a 99" e a faixa é 70 a 110
  Então vejo, sem bloquear, "A faixa numérica não bate com o texto da referência. Confira no laudo."

Cenário: Editar exame
  Quando abro "Editar exame", mudo o título, a data e o valor de uma linha digitada, escrevo a justificativa e toco em "Salvar"
  Então vejo "Exame salvo." e o Histórico de acessos ganha "Alterou — Exames" e "Criou — Versões do exame"
  E "Versões anteriores" mostra a versão 1 com o título, a data e as linhas de antes, a justificativa, quem e quando
  E a linha que veio da IA continua com "IA · conferido em…", com o nome e o valor fixos (só faixa e referência mudam)
  E o laudo continua o mesmo

Cenário: Justificativa
  Quando mudo uma linha existente, o título ou a data sem justificativa
  Então vejo "Informe a justificativa da alteração (de 5 a 500 caracteres)." e nada é gravado
  Quando só acrescento linhas
  Então a justificativa é opcional, e a versão de antes é gravada do mesmo jeito
  Quando salvo sem mudar nada
  Então vejo "Nada foi alterado."

Cenário: A origem da IA não vem do formulário
  Quando o formulário chega com um iaTarefaId numa linha
  Então a chave é ignorada: só o servidor copia iaTarefaId da linha original, pelo índice "origem"

Cenário: Exame que está no app
  Dado um exame com "No app"
  Então "Editar exame" avisa "Este exame está no app do paciente. O que você salvar aparece lá na hora."
  E a confirmação de "Excluir" diz "Este exame está no app do paciente. Ao excluir, ele some de lá."

Cenário: Alguém mexeu antes
  Dado que abri "Editar exame" e a conferência da IA acrescentou linhas depois
  Quando salvo
  Então vejo "O exame mudou desde que você abriu. Recarregue a página." e nada é gravado

Cenário: Exame enviado pelo paciente
  Dado um exame aceito da fila "Exames recebidos", sem valores
  Então ele tem "Editar" e posso lançar as linhas sem justificativa (só acrescento linhas)
```

#### US-372 — Classificação automática e REF · **M** (PD-61)

```gherkin
Cenário: Classificação neutra
  Dado uma linha com valor 105 e faixa do laudo 70 a 99
  Então vejo "Acima da referência"
  Dado valor 70 e faixa 70 a 99
  Então vejo "Dentro da referência"
  Dado faixa só "até 200" e valor 210
  Então vejo "Acima da referência"
  Dado uma linha sem faixa numérica
  Então não vejo classificação

Cenário: Categoria do consultório
  Dado a paciente com sexo F no cadastro e 40 anos na data do exame
  E a linha "Vitamina D" em ng/mL, que casa com "25-hidroxivitamina D" (outro nome) do catálogo, com faixa "Todos, 18 a 120, abaixo de 20, Deficiência"
  E valor 15
  Então vejo também "Deficiência" e, no REF, "Fonte: Diretriz X, 2024"
  Dado a mesma linha em nmol/L
  Então não vejo categoria (unidade diferente)

Cenário: Sem dado do cadastro
  Dado um paciente da página pública sem sexo ou sem data de nascimento
  Então vejo só a classificação neutra

Cenário: Casamento ambíguo
  Dado que o nome da linha casa com dois exames do catálogo
  Então não vejo categoria

Cenário: Aviso fixo
  Então, uma vez por tabela com classificação, antes dela e ligado a ela por aria-describedby, vejo "Classificação automática pela faixa de referência informada. Não é diagnóstico."
  E, quando alguma categoria do consultório aparece, "As faixas do consultório não consideram gestação."

Cenário: REF
  Quando toco em "Ver referência" de uma linha (a função REF; nome acessível "Referência de {marcador}")
  Então vejo "Referência do laudo: {texto ou —}", "Faixa do laudo: {de} a {até}" e, se a linha casar com o catálogo, as faixas do consultório com público, limites, categoria, fonte e data

Cenário: Nada é gravado
  Então a classificação e a categoria não estão no banco nem na cópia do parecer
  E mudar uma faixa do consultório muda a categoria mostrada nos exames antigos, com a data da faixa no REF
```

#### US-373 — Nota de interpretação · **S** (PD-62)

```gherkin
Cenário: Escrever a nota
  Quando abro o exame e escrevo em "Nota de interpretação"
  Então vejo acima do campo "Escreva fatores a investigar e encaminhamentos; não afirme doença."
  E a ajuda "Não aparece no app; entra na cópia dos dados que o paciente pedir."
  Quando toco em "Salvar nota"
  Então vejo "Nota salva." e o Histórico de acessos ganha "Criou — Nota de interpretação do exame" (entidade `exames_nota`, EP-D61 do plano)

Cenário: Inserir modelo
  Dado que "Ferritina" está abaixo da faixa do laudo e tem modelo "abaixo"
  Quando toco em "Inserir modelo"
  Então vejo a lista dos modelos dos exames fora da faixa ("Ferritina — abaixo")
  E o texto escolhido entra na posição do cursor

Cenário: Limite
  Quando a nota passa de 2000 caracteres
  Então vejo "A nota tem no máximo 2000 caracteres."

Cenário: Histórico da nota
  Quando mudo a nota e salvo de novo, ou toco em "Apagar nota"
  Então a versão anterior continua guardada (só de inclusão) e "Versões anteriores" mostra as notas anteriores, com quem e quando

Cenário: Paciente bloqueado ou anonimizado
  Dado um paciente com o pedido de exclusão atendido, ou anonimizado
  Quando salvo ou apago a nota
  Então vejo a mensagem de hoje de paciente bloqueado e nada é gravado

Cenário: Onde a nota não aparece
  Então a nota nunca aparece no app, no PDF de documento, na IA nem no comparativo
  E sai no dados.json da cópia do titular e da cópia da equipe
```

#### US-374 — Comparativo entre datas · **M** (PD-63)

```gherkin
Cenário: Comparar
  Dado que o paciente tem 4 exames
  Quando marco "Comparar" em 3 e toco em "Comparar 3 exames"
  Então vejo a tabela "Resultados por data", com os marcadores nas linhas e as datas nas colunas (mais antiga à esquerda)
  E cada célula com o valor, a unidade e a classificação neutra (quando a linha tem faixa)
  E "—" onde o exame não tem o marcador
  E marcadores com unidades diferentes em linhas separadas, com a nota "Marcadores com unidades diferentes aparecem em linhas separadas."

Cenário: Limites
  Quando marco menos de 2 ou mais de 6 exames
  Então "Comparar {n} exames" fica desabilitado, com o texto de apoio "Escolha de 2 a 6 exames para comparar." ligado por aria-describedby
  E a URL com menos de 2 ou mais de 6 ids mostra a mesma frase
  E ids de outro paciente na URL são ignorados

Cenário: Leitura registrada
  Então abrir o comparativo grava uma leitura em "Histórico de acessos" (Exames)
```

#### US-375 — Mostrar no app · **M** (função do briefing; muda a D17 = a do Plano 12 só para os exames marcados)

```gherkin
Cenário: Liberar
  Quando toco em "Mostrar no app do paciente" no detalhe do exame (botão, não interruptor)
  Então vejo "O paciente verá no app o título, a data, os valores e a referência deste exame, com o aviso de que não é diagnóstico. A nota de interpretação, as categorias do consultório e o laudo não aparecem." com "Mostrar no app" e "Cancelar"
  Quando confirmo
  Então vejo "O exame aparece no app do paciente." (role="status", fora do bloco trocado) e o selo "No app" no exame, com o foco de volta no botão
  E o Histórico de acessos ganha "Liberou exame no app" (além do "Alterou — Exames" do gatilho)
  E o updated_at do exame não muda (o resumo da IA não fica "desatualizado" e uma edição aberta não é recusada)

Cenário: Paciente sem app
  Dado um paciente sem acesso ao app (patients.user_id IS NULL, o mesmo estado de situacaoDoAcesso do selo da RN-279 do 18)
  Então ao liberar vejo também "Este paciente ainda não usa o app. O exame aparece quando ele entrar."

Cenário: No app
  Dado um exame liberado
  Quando o paciente abre "Exames"
  Então vê "Resultados liberados" com o título, a data e, por marcador, o nome em destaque e, abaixo, "Resultado: {valor} {unidade}" e "Referência: {texto}", com "Fora da referência" junto do valor quando a faixa da linha diz isso (e nada quando a faixa e o texto da referência divergem, RN-385)
  E, a 360 px, uma referência longa quebra a linha sem rolagem lateral
  E o aviso "Não é diagnóstico. Converse com sua nutricionista."
  E não vê a nota, a categoria do consultório, a marca da IA nem o laudo

Cenário: Menu do app
  Dado que o recebimento de exames está desligado no consultório, sem envio do paciente, e há um exame liberado
  Então o item "Exames" aparece no menu do app, igual em Hoje e nas outras telas
  E a barra de ações não mostra "Enviar exame"
  E o bloco "Meus exames enviados" não aparece
  Dado o recebimento desligado, um envio antigo e nenhum exame liberado
  Então "Exames" continua no menu (RN-192)

Cenário: Retirar
  Quando toco em "Retirar do app" (imediato, sem confirmação, e reversível)
  Então vejo "O exame saiu do app do paciente.", o paciente não o vê mais e o Histórico de acessos ganha "Retirou exame do app"

Cenário: O banco garante
  Dado o paciente com login
  Então uma consulta direta a exams na sessão dele não devolve o exame não liberado
  E nenhuma linha de exam_interpretacoes, exam_versoes, exames_catalogo ou modelos

Cenário: Início da ficha
  Então a seção "Exames" do Início mostra o selo "No app" só no exame liberado e a contagem em "[id]/app" bate com o app (paridade)
```

#### US-376 — Modelos de solicitação · **S** (PD-60)

```gherkin
Cenário: Criar modelo
  Quando abro "Configurações" → "Exames" → "Modelos de solicitação" e toco em "Novo modelo"
  E informo o nome "Check-up anual", escolho exames do catálogo ou digito outros e escrevo orientações ao paciente
  Então vejo "Modelo salvo."
  E o modelo não tem campo de indicação clínica
  E o formulário mostra "Retire dados do paciente antes de salvar."

Cenário: Limites
  Quando o modelo passa de 40 exames
  Então vejo "O modelo pode ter até 40 exames."
  Quando repito um nome
  Então vejo "Este exame já está na lista."

Cenário: Sem documentos liberados
  Dado que o consultório não tem os documentos liberados
  Então "Modelos de solicitação" continua disponível (servem também para lançar exames)
```

#### US-377 — Solicitação de exames laboratoriais · **M** (PD-60)

**Como** nutricionista, **quero** emitir um pedido de exames assinado e verificável, **para** o paciente levar ao
laboratório que ele escolher.

```gherkin
Cenário: Nova solicitação
  Dado que o consultório tem os documentos liberados
  Quando toco em "Nova solicitação de exames" na aba Documentos ou em "Adicionar" → "Solicitação de exames" no Início da ficha
  Então abre o rascunho "Solicitação de exames laboratoriais"
  E vejo o aviso "Planos de saúde podem recusar pedido de exame feito por nutricionista."

Cenário: Montar o pedido
  Quando uso "Adicionar do catálogo", "Adicionar exame fora do catálogo" ou "Carregar modelo" (com "Acrescentar" e "Substituir")
  Então a lista mostra os exames, um painel com o nome dele
  E junto de "Adicionar exame fora do catálogo" vejo, fixo, "Só exames laboratoriais (Lei nº 8.234/1991, art. 4º, VIII)."
  E "Indicação clínica (opcional)" tem, fixo, "Descreva a finalidade nutricional; não afirme doença."
  E "Orientações ao paciente (opcional)" aceita negrito e lista (US-378)

Cenário: Erros
  Quando preparo sem exames
  Então vejo "Inclua ao menos um exame."
  E "A solicitação pode ter até 40 exames." · "O nome do exame tem de 1 a 80 caracteres." · "Este exame já está na lista." · "A indicação clínica tem no máximo 500 caracteres." · "As orientações têm no máximo 1000 caracteres."

Cenário: Preparar e assinar
  Quando toco em "Preparar" e confirmo a declaração "Declaro que os exames solicitados são laboratoriais e necessários à avaliação, à prescrição ou à evolução nutricional, dentro da minha competência (Lei nº 8.234/1991, art. 4º, VIII, e Resolução CFN nº 306/2003), e que este pedido não indica laboratório."
  Então o worker gera o PDF-base (fila documento-pdf-2) com o título, o nome do paciente, a data, os exames, a indicação e as orientações (se houver), os dados profissionais, o quadro de assinatura, o código e o QR
  E o PDF não tem campo de laboratório
  E a assinatura segue a da receita (digitalizada com o código do 2FA)

Cenário: Depois de assinada
  Então entrego pelo portal, link com código ou pessoalmente, como a receita
  E a página de verificação mostra "Solicitação de exames laboratoriais", sem dado de saúde
  E posso baixar o PDF assinado, retificar e cancelar como a receita

Cenário: Lançar resultados
  Dado uma solicitação assinada
  Quando toco em "Lançar resultados"
  Então abre "Novo exame" com o título "Exames solicitados em {dd/mm/aaaa}" e uma linha por exame pedido (painéis expandidos)
  E o exame novo não aponta para a solicitação (é cópia)

Cenário: Sem documentos liberados
  Dado que o admin não liberou os documentos
  Então "Nova solicitação de exames" e "Solicitação de exames" no Adicionar não aparecem
```

#### US-378 — Receita: fórmula magistral fitoterápica e orientações formatadas · **M** (PD-64, PD-65)

```gherkin
Cenário: Fórmula magistral fitoterápica
  Dado o consultório com habilitação em Fitoterapia registrada
  Quando acrescento "Fórmula magistral com vários compostos vegetais" com 3 compostos (nomenclatura botânica, parte usada, derivado ou extração, padronização opcional, quantidade e unidade), forma farmacêutica, via, posologia e duração
  Então o item é salvo
  E, sob o seletor do tipo, vejo a ajuda (ligada por aria-describedby) "Use 'Fórmula magistral com vários compostos vegetais' quando a fórmula tiver de 2 a 10 derivados vegetais em quantidades próprias; 'Fitoterápico' para o produto de uma planta só."

Cenário: Sem habilitação
  Dado o consultório sem habilitação
  Então o tipo aparece desabilitado com a mensagem semHabilitacao
  E salvar, preparar ou assinar uma receita com o tipo é recusado com a mesma mensagem

Cenário: Composto que não é vegetal
  Quando a nomenclatura de um composto é "Picolinato de cromo", "Vitamina C", "Creatina monoidratada", "Curcumina lipossomal" ou "Lactobacillus acidophilus"
  Então vejo "Fórmula fitoterápica não pode ter vitaminas, minerais, aminoácidos ou substâncias isoladas (Resolução CFN nº 680/2021, art. 9º, II)."
  E o "Derivado ou extração" e a padronização não passam por essa conferência (citam o marcador legitimamente, como "Extrato seco padronizado a 95% de curcumina"; RN-392, ajuste do code review do PR 1; cenário alinhado na T12, 23/11/2026)
  Quando a nomenclatura é "camomila"
  Então vejo "Use a nomenclatura botânica (Gênero espécie), como Matricaria chamomilla L."
  E a conferência é de apoio, não garantia: a responsabilidade pela composição é da nutricionista (RN-392)

Cenário: Quantidade de compostos
  Quando informo 1 ou 11 compostos
  Então vejo "Informe de 2 a 10 compostos vegetais."

Cenário: Orientações formatadas
  Quando escrevo nas "Orientações gerais (opcional)" usando "Negrito" e "Lista"
  Então a prévia mostra a formatação
  E o PDF e a página do documento no painel mostram parágrafos, listas e negrito (o portal e a página do link só oferecem o PDF, D17 do 10A)
  E "<script>", links e HTML aparecem como texto
  E uma receita antiga continua em texto puro

Cenário: Retificar
  Quando retifico uma receita com orientações formatadas e fórmula
  Então a versão nova nasce com as mesmas orientações formatadas, a fórmula e a justificativa
```

#### US-379 — Itens salvos e modelos de prescrição · **M** (PD-64, PD-65)

```gherkin
Cenário: Item salvo
  Quando abro "Configurações" → "Prescrição" → "Suplementos" e toco em "Novo item salvo"
  Então vejo o mesmo formulário do item da receita, com o campo "Nome do item salvo"
  E não há campo de marca, fabricante ou farmácia
  Quando salvo
  Então vejo "Item salvo."
  E, sem habilitação, os tipos fitoterápicos formulados ficam indisponíveis em "Fitoterápicos"

Cenário: Salvar item a partir da receita
  Quando toco em "Salvar item" num item do rascunho
  Então abre um diálogo com "Nome do item salvo" e o aviso "Retire dados do paciente antes de salvar.", num formulário próprio, fora do formulário da receita
  Quando informo um nome e confirmo
  Então ele entra nos itens salvos e o rascunho não é salvo nem muda

Cenário: Adicionar item salvo
  Quando toco em "Adicionar item salvo" na receita e escolho um
  Então o item é copiado para a receita
  E editar o item salvo depois não muda a receita

Cenário: Salvar como modelo
  Quando toco em "Salvar como modelo" e informo o nome
  Então vejo "Retire dados do paciente antes de salvar. A justificativa de uso não vai para o modelo."
  E o modelo guarda os itens e as orientações

Cenário: Carregar modelo
  Quando toco em "Carregar modelo", escolho um e toco em "Acrescentar aos itens" ou "Substituir os itens"
  Então "Substituir" pede "Substituir os {n} itens da receita pelos do modelo?"
  E o rascunho é gravado pelo mesmo caminho do "Salvar" (todas as conferências de novo)
  E, sem habilitação, um modelo com fitoterápico formulado é recusado com a mensagem semHabilitacao e nada muda
  E, se a soma passar de 20 itens, vejo "Com este modelo a receita passaria de 20 itens. Use Substituir ou retire itens."
  E a justificativa de uso continua a que eu escrevi (o modelo não a traz)
  E os itens que eu tinha digitado e ainda não salvei continuam na tela junto com os do modelo (a action recebe o conteúdo da tela e devolve o gravado)

Cenário: Editar e excluir itens salvos e modelos
  Quando abro um item salvo, mudo a posologia e salvo
  Então vejo "Item salvo." e nenhuma receita muda
  Quando toco em "Excluir" num item salvo ou num modelo
  Então vejo "Excluir {nome}? As receitas já emitidas não mudam." com "Excluir" e "Cancelar"
  E, ao confirmar, "Item excluído." ou "Modelo excluído."

Cenário: Listas vazias
  Então "Suplementos" e "Fitoterápicos" sem itens mostram "Nenhum item salvo. Salve um item da receita com Salvar item."
  E "Modelos de prescrição" sem modelos mostra "Nenhum modelo de prescrição ainda. Salve um a partir de uma receita, com Salvar como modelo."
```

#### US-380 — Compartilhar o PDF assinado · **S** (PD-66)

**Como** paciente, **quero** mandar a receita ou o pedido à farmácia ou ao laboratório que eu escolher, **para** não
precisar imprimir.

```gherkin
Cenário: Compartilhar no app
  Dado uma receita assinada em vigor no app
  Então vejo "Preparar para compartilhar" (nome acessível "Preparar para compartilhar a receita de {dd/mm/aaaa}") e o texto "Envie à farmácia que você escolher."
  E na solicitação "Envie ao laboratório que você escolher." e no parecer "Envie a quem você escolher."
  E, nos três, "O PDF tem dados da sua saúde. Envie só a quem você quiser que veja."
  Quando toco em "Preparar para compartilhar"
  Então o botão fica desabilitado com "Preparando o PDF…" enquanto o PDF é carregado pela rota de sempre (com a leitura registrada uma vez)
  E, pronto, aparece "Compartilhar", que recebe o foco, e a região de status diz "PDF pronto. Toque em Compartilhar."
  Quando toco em "Compartilhar" num aparelho que compartilha arquivos
  Então abre o compartilhar do aparelho com o PDF
  E fechar o compartilhar sem escolher (AbortError) não mostra erro

Cenário: Aparelho sem compartilhar
  Então o PDF é baixado e vejo "Este aparelho não consegue compartilhar o arquivo. O PDF foi baixado; envie pelo aplicativo que preferir."

Cenário: Versão antiga ou cancelada
  Dado um documento substituído por retificação
  Então não vejo "Compartilhar" e vejo o texto de hoje "Substituído por uma versão mais nova." (MSG_PORTAL_DOC.substituido)
  Dado um documento cancelado
  Então não vejo "Compartilhar" e vejo "Cancelado pela nutricionista. Não use este documento." (MSG_PORTAL_DOC.cancelado)

Cenário: Página do link com o acesso vencido
  Dado a página do link aberta há mais de 15 minutos
  Quando toco em "Preparar para compartilhar"
  Então vejo "O acesso venceu. Digite o código de novo." e nada é compartilhado

Cenário: Nada sai pela plataforma
  Então nenhum e-mail, mensagem ou registro novo é criado além da leitura do PDF
```

#### US-381 — Cópia dos dados, anonimização e transparência · **M** (LGPD)

```gherkin
Cenário: Cópia do titular
  Quando o paciente pede "Baixar meus dados"
  Então o dados.json traz, em cada exame, as linhas com refMin e refMax (quando houver), mostradoNoAppEm, notaDeInterpretacao (a em vigor) e as versões anteriores do exame (sem a justificativa, como a AF-D31 do Plano 21)
  E as solicitações emitidas na seção de documentos, com os exames, a indicação clínica e as orientações
  E as receitas com a fórmula descrita item a item

Cenário: Anonimização
  Quando o paciente é anonimizado
  Então as solicitações têm o conteúdo e os PDFs apagados pela app_anonimizar_documentos, como a receita
  E os exames, as versões e as notas ficam como prontuário

Cenário: Transparência
  Quando toco em "Mostrar no app do paciente"
  Então a confirmação mostra o texto da §6.2 ("O paciente verá no app o título, a data, os valores e a referência deste exame…")
```

---

## 6. Regras de negócio

### 6.1 Regras

| ID | Regra |
|---|---|
| RN-370 | **Acesso.** Só a sessão `nutri` lê e grava o catálogo, os modelos, os itens salvos, a nota e as ações novas de `exams`. As seis tabelas novas são `staff_only` (§9); nada em `PUBLICO_LIBERADO` nem em `PACIENTE_ESCREVE`; o admin nunca consulta. As funções do módulo conferem `ctx.role === 'nutri'` antes da transação. O paciente lê de `exams` só o que a política `paciente_exame_liberado` deixa (RN-385) |
| RN-371 | **Catálogo.** Nome de 1 a 80 caracteres; unidade opcional (até 20); até 10 outros nomes (1 a 80 cada). O nome e os outros nomes **normalizados** (`normalizarNome`) são únicos no consultório, entre todos os exames do catálogo: conferido no módulo sob trava transacional do catálogo do consultório (`pg_advisory_xact_lock` por tenant), com o `UNIQUE (tenant_id, lower(nome))` como barreira do banco para o nome. Excluir não muda exame, modelo nem documento (todos guardam cópia do nome, sem FK). Até 500 exames por consultório |
| RN-372 | **Nomes para começar.** A plataforma traz uma constante (`NOMES_PARA_COMECAR`) só com **nomes** de exames laboratoriais de uso corrente e os outros nomes (os 14 grupos de `SINONIMOS` de `correspondencia.ts` e os componentes do hemograma, `PAINEIS_PARA_COMECAR`), **sem unidade, faixa, nota ou ordem por importância**, sem testes sem respaldo científico (mineralograma capilar, IgG para "intolerância alimentar"; Res. CFN 306/2003, art. 2º, parágrafo único, V), marcada "rascunho para a Debby". Só entra no catálogo o que a nutricionista marcar. A plataforma **não semeia** itens salvos, modelos de prescrição nem modelos de solicitação |
| RN-373 | **Painel.** Um exame do catálogo pode ter "Exames que compõem este" (2 a 30 nomes, 1 a 80 cada, sem repetição normalizada). O painel não tem unidade, faixas nem modelos de nota (CHECK e Zod). Na solicitação e nos modelos de solicitação ele conta como **um** exame e sai com o nome dele; na análise (US-371, "Lançar resultados", "Carregar modelo de solicitação") vira uma linha por componente, com a unidade do exame do catálogo que casar com o nome do componente (RN-380, sem unidade se não casar). Componente que é painel não expande de novo (um nível só) |
| RN-374 | **Faixas do consultório.** Só em exame com unidade; até 20 por exame. Cada faixa: sexo do cadastro (`F`, `M` ou "Todos" = nulo), idade de/até em anos completos (0 a 130, de ≤ até; nulas = sem limite), "A partir de" (inclusivo) e/ou "Abaixo de" (exclusivo) — ao menos um, e "A partir de" < "Abaixo de" quando ambos —, categoria de `CATEGORIAS_DO_CONSULTORIO` (RN-381), fonte (2 a 300) e `atualizadaEm` (gravada pelo módulo). Duas faixas do mesmo exame se **sobrepõem** quando o sexo coincide (nulo coincide com tudo), as idades se cruzam e os intervalos de valor se cruzam: o módulo recusa ("Esta faixa se sobrepõe a outra do mesmo público."). Com faixas cadastradas, a unidade do exame não muda nem fica vazia: o módulo recusa ("Remova as faixas antes de trocar a unidade."), e o CHECK `exames_catalogo_faixa_com_unidade` (§9.1) é a barreira do banco (a categoria é calculada com o catálogo atual, RN-380, e trocar a unidade mudaria a leitura das faixas antigas) |
| RN-375 | **Modelos de nota.** Dois textos opcionais por exame (não painel), "abaixo" e "acima", até 1000 caracteres cada, com a linha fixa da US-370 e o aviso "Retire dados do paciente antes de salvar.". "Inserir modelo" na nota (RN-383) lista os modelos dos exames **fora da faixa do laudo** naquele exame (classificação neutra "Abaixo"/"Acima" e linha que casa com o catálogo) |
| RN-376 | **Linha do exame.** `exams.valores[]` ganha só as chaves opcionais `refMin` e `refMax` (número finito, \|x\| < 1e15, `refMin ≤ refMax` quando ambos; aceita vírgula decimal). Nenhuma chave existente muda (C-378). Ao salvar (criar ou editar): se `referencia` está vazia e há faixa, grava-se `referencia = referenciaDaFaixa(refMin, refMax)` ("70 a 99", "até 200", "a partir de 30", com vírgula decimal), para os leitores que só leem `referencia` (parecer, app, exportação) não mostrarem "—"; se há texto e faixa e `sugerirFaixa(texto)` dá outra faixa, a tela avisa sem bloquear (US-371). Até 50 linhas, como hoje |
| RN-377 | **Sugestão de faixa.** `sugerirFaixa(texto)` só devolve faixa quando o texto tem **um único** padrão "a a b", "a - b" ou "a – b" (números com vírgula ou ponto decimal e sinal negativo opcional, unidade opcional depois; o "-" entre os dois números é o separador) e nenhum `<`, `>`, `≤`, `≥`, "até", "acima", "abaixo", ";" ou segunda faixa. Número com cara de ponto de milhar (`^\d{1,3}(\.\d{3})+$`: "4.000 a 11.000", "150.000 a 450.000", "1.005 a 1.030") **não sugere** — o ponto é ambíguo entre milhar e decimal, e na dúvida nada (ajuste da revisão da P22-02); os números são lidos por `lerDecimal`. Nunca preenche sozinha: a tela mostra o botão "Usar {a} a {b}", e só o toque preenche os campos (nada é gravado até "Salvar") |
| RN-378 | **Editar exame, com versão** (EP-D21, EP-D41). Título, data e linhas (acrescentar, remover, mudar, faixa), com o laudo como está. Ordem de travas: `carregarPacienteParaEscrita` (recusa bloqueado e anonimizado) → exame `.for('no key update')` (a chave não muda; não bloqueia o `FOR KEY SHARE` das FKs filhas, e conflita com o `FOR UPDATE` da conferência) → a tarefa, na conferência — a mesma ordem de `conferencia.ts` e de `excluirExame`. Concorrência otimista: o formulário leva o `updated_at` lido e o módulo recusa se mudou ("O exame mudou desde que você abriu. Recarregue a página."); edição sem mudança é recusada ("Nada foi alterado."). Na **mesma transação**, grava em `exam_versoes` o estado de antes (`titulo`, `data`, `valores`, `versao` = maior + 1) e faz o UPDATE. Justificativa (5 a 500 caracteres, sem NUL) obrigatória ("Informe a justificativa da alteração (de 5 a 500 caracteres)."), salvo quando a edição só acrescenta linhas (sem mudar título, data nem linha existente: o exame aceito do app que ganha os valores). **Origem da IA:** o formulário leva só o índice da linha original (`origem`); sob a trava do exame, o módulo copia `iaTarefaId` de `e.valores[origem]` e **nunca** lê `iaTarefaId` do formulário. A linha com `iaTarefaId` tem nome e valor fixos (só faixa e referência mudam); para corrigi-la, remove-se a linha (com justificativa) e lança-se uma manual. Escritas auditadas pelo gatilho (`alterar` em `exames`; `criar` em `exames_versoes`, "Versões do exame"); "Versões anteriores" chama `auditRead` (entidade `exames_versoes`). O parecer já detecta "valores mudaram" (`mesmoExame`) |
| RN-379 | **Classificação neutra.** `classificarNeutra(valor, refMin, refMax)`: com `refMin` e valor < `refMin` → "Abaixo da referência"; com `refMax` e valor > `refMax` → "Acima da referência"; senão, com ao menos um limite → "Dentro da referência" (limites do laudo **inclusivos**); sem limite → nada. Calculada na leitura; nunca gravada |
| RN-380 | **Categoria do consultório.** Só se: (a) a linha casa com **um único** exame do catálogo pelo nome ou outro nome normalizado (`casarComCatalogo`; dois → nada); (b) a unidade da linha é igual à do catálogo (`normUnidade` de `correspondencia.ts`, exportada); linha sem unidade → sem categoria; (c) o paciente tem `patients.sexo` e `data_nascimento` (nunca a identidade de gênero de `patient_cadastro`); (d) a idade em anos completos **na data do exame** é ≥ 1; (e) existe faixa para o sexo e a idade cujo intervalo contém o valor ("A partir de" ≤ valor < "Abaixo de"). Mostra a categoria e, no REF, a fonte e a data da faixa. Calculada na leitura com o catálogo **atual** (mudar a faixa muda a categoria dos exames antigos; a data aparece) |
| RN-381 | **Categorias e aviso.** `CATEGORIAS_DO_CONSULTORIO` é um conjunto fechado, sem nome de doença: "Baixo", "Normal", "Alto", "Ótimo", "Desejável", "Adequado", "Suficiente", "Aceitável", "Limítrofe", "Elevado", "Muito elevado", "Insuficiente", "Deficiência", "Depleção leve", "Depleção moderada", "Depleção grave" (rascunho para a Debby; a lista inteira vai na pergunta 5 ao CRN-4, e "Desnutrição" fica fora até a resposta, EP-D12). Toda tabela com classificação mostra, uma vez, antes dela e ligado por `aria-describedby`, "Classificação automática pela faixa de referência informada. Não é diagnóstico."; com categoria, também "As faixas do consultório não consideram gestação." A categoria só aparece no painel (nunca no app, no PDF ou na exportação) |
| RN-382 | **REF.** Botão por linha com o texto visível "Ver referência" (nome acessível "Referência de {marcador}", que contém o texto visível; "REF" é só o nome interno da função) na lista, no detalhe, na edição e no comparativo, só no painel: "Referência do laudo: {texto ou —}", "Faixa do laudo: {referenciaDaFaixa}" e, se a linha casa com o catálogo, as faixas do consultório (público, limites, categoria, "Fonte: …", "atualizada em dd/mm/aaaa") |
| RN-383 | **Nota de interpretação** (EP-D41). Uma em vigor por exame, escrita pela nutricionista, **só de inclusão**: cada "Salvar nota" grava uma linha nova em `exam_interpretacoes` (`versao` = maior + 1, `texto` de 1 a 2000) e "Apagar nota" grava uma linha com `texto` nulo; a em vigor é a de maior versão (nula = sem nota). `UPDATE`, `DELETE` e `TRUNCATE` revogados de `nutri_app_role`; autor e hora pelo gatilho. `salvarNota` e `apagarNota`: `carregarPacienteParaEscrita(tx, patientId)` primeiro (recusa bloqueado e anonimizado: os exames ficam depois da anonimização, e uma nota nova num titular bloqueado escaparia de qualquer limpeza); depois o exame do paciente com `.for('no key update')` (`where id = exameId and patient_id = patientId`; sem linha → "Exame não encontrado.", em vez do 23503 cru da FK com um `excluirExame` concorrente; serializa duas notas do mesmo exame); depois o INSERT — ordem paciente → exame → nota, a de `editarExame` e `excluirExame`. Inclusão auditada pelo gatilho (entidade `exames_nota`, "Nota de interpretação do exame"; "Apagar nota" grava também um `excluir` de `exames_nota` pelo `recordAudit`, com o id do exame); lida só por `abrirExame` (a em vigor) e "Versões anteriores" (`notasAnteriores`, as anteriores), com `auditRead`. Nunca vai ao app, ao PDF de documento, a contexto de IA ou ao comparativo; vai ao `dados.json` nos dois escopos (EP-D19). Excluir o exame leva as notas pela FK em cascata (ação referencial, executada como dono da tabela) |
| RN-384 | **Comparativo.** 2 a 6 exames do paciente (ids de outro paciente ignorados), ordem pela data (mais antiga à esquerda; empate pela criação); linhas por `agruparMarcadores` (nome normalizado + unidade: unidades diferentes em linhas separadas); célula = valor, unidade e classificação neutra da linha daquele exame; "—" sem a linha. `auditRead` (entidade `exames`, um por exame mostrado). Sem categoria do consultório nem nota |
| RN-385 | **Mostrar no app.** `exams.mostrar_no_app_em` (nulo = não liberado; padrão nulo, inclusive para os exames que já existem e os aceitos do Plano 12). Só a sessão `nutri` liga e desliga, com o paciente travado (`carregarPacienteParaEscrita`) e o exame `.for('no key update')`; o UPDATE **não toca `updated_at`** (só `mostrar_no_app_em`). Na mesma transação, `recordAudit(tx, { acao: 'alterar', entidade: 'exame_no_app_liberado' \| 'exame_no_app_retirado', entidadeId: <id do exame>, patientId })` com o ator da sessão, porque o gatilho genérico grava só `alterar` em `exames`, sem colunas (`0007`), e a retirada zera a data: sem isso, ninguém saberia quando o paciente passou a ver o exame e por ordem de quem (LGPD, art. 37; NGS1.07). Rótulos novos em `ENTIDADE_ROTULO` (`src/modules/plataforma/audit.ts`, só acrescentar, §6): "Liberou exame no app" e "Retirou exame do app". O `alterar` do gatilho continua lá. Teste: liberar, retirar e liberar de novo deixa três eventos distinguíveis, cada um com o ator. Política **RESTRICTIVE** `paciente_exame_liberado` FOR SELECT em `exams`: `app_current_role() IS DISTINCT FROM 'paciente' OR mostrar_no_app_em IS NOT NULL`. A projeção do portal (`examesLiberadosDoPaciente`) devolve só `id`, `data`, `titulo` e, por linha, `nome`, `valor`, `unidade`, `referencia` e `fora` (`true` quando a neutra é "Abaixo" ou "Acima", senão `false`; nulo sem faixa **ou** quando `sugerirFaixa(referencia)` dá uma faixa diferente de `refMin`/`refMax`, para o app não mostrar "Fora da referência" contra o texto do laudo) — nunca `iaTarefaId`, `arquivo_path`, a nota ou a categoria. O laudo continua fora do app porque nenhuma rota do portal o assina (`stored_files` não muda, DEP-E3). A RLS decide **quais exames** (a sessão de paciente lê a linha inteira do liberado, e a `paciente_arquivos` deixa ler o `stored_files` tipo `exame`); a projeção decide **quais campos** (teste das chaves). `banco.test.ts` confere em `pg_policies` que `paciente_exame_liberado` é RESTRICTIVE, `cmd = 'SELECT'` e `qual` cita `mostrar_no_app_em` |
| RN-386 | **Portal.** `/p/exames` mostra "Resultados liberados" quando `temExameLiberado` (consulta na sessão de paciente; só existe/não existe, sem `auditRead`); abrir a página com itens grava um `auditRead` (entidade `exames`, `entidadeId: null`). O item "Exames" do menu do app aparece com o recebimento ligado, **ou** com envio visível (RN-192), **ou** com exame liberado: terceiro termo de `examesVisiveis`, nos dois pontos de chamada (§4.4). A IA Nutri não lê `exams` (DEP-E14) e continua mandando pergunta sobre exame à nutricionista (`sintoma_ou_exame`) |
| RN-387 | **"No app" na ficha.** A seção `exames` do Início ganha `noApp` por `noAppPor` (contexto de paciente `semConta`, a política faz o filtro; nenhum filtro em TypeScript além da RLS, RN-281 do 18); exame liberado e não liberado entram no cenário de paridade (RNF-263 b do 18). Depende do merge do Plano 18 PR 2 |
| RN-388 | **Solicitação: conteúdo.** `signed_documents.tipo = 'solicitacao_exames'`; `conteudo = { versao: 1, tipo: 'solicitacao_exames', exames: { nome: string; painel?: true }[] (1 a 40, nome 1 a 80, sem repetição normalizada), indicacaoClinica: string \| null (até 500), orientacoes: string (até 1000), orientacoesFormato: 'marcacao', copia?, declaracao? }`. Os exames são **cópia** (do catálogo, de modelo ou digitados), sem FK. Sem campo de laboratório, de link ou de data livre; título fixo "Solicitação de exames laboratoriais" (`TIPO_DOCUMENTO_ROTULO`) |
| RN-389 | **Solicitação: ciclo.** O mesmo da receita (RN-140 a RN-147, RN-152 a RN-158): rascunho → preparar (declaração `DECLARACAO_SOLICITACAO`, cópia congelada do profissional e do paciente, PDF-base no worker pela `documento-pdf-2`) → assinatura digitalizada com o código do 2FA (RN-145) → entrega (portal, link com código, pessoalmente) → recebimento → verificação pública (só o rótulo, o código, a data e a situação) → retificação e cancelamento. Sem justificativa de uso (é da receita). Depende de `documentos_liberados` |
| RN-390 | **Lançar resultados.** Na solicitação `assinada` em vigor, "Lançar resultados" abre o "Novo exame" com o título "Exames solicitados em {data do preparo}" (editável) e uma linha por exame (painéis expandidos, RN-373), sem valores; a leitura do conteúdo grava `auditRead` (como `lerDocumento`). O exame salvo não aponta para a solicitação |
| RN-391 | **Modelos de solicitação.** Nome (1 a 80, único sem diferença de maiúsculas no consultório), exames (1 a 40, cópia, como RN-388) e orientações ao paciente (até 1000, marcação); **sem** indicação clínica nem dado do paciente (aviso "Retire dados do paciente antes de salvar." no formulário). "Carregar modelo" na solicitação acrescenta (sem repetir) ou substitui (com confirmação) e traz as orientações só se o rascunho não tiver; na análise, só as linhas (RN-373). Não dependem de `documentos_liberados` |
| RN-392 | **Fórmula magistral fitoterápica.** Tipo de item `formula_fitoterapica`: 2 a 10 compostos, cada um com nomenclatura botânica (binômio: os dois primeiros termos são "Gênero" com inicial maiúscula e "epíteto" em minúsculas, ou "×" entre eles; aceita autor e categorias abaixo de espécie depois, como "Matricaria chamomilla L.", "Citrus aurantium var. amara", "Mentha × piperita"), parte usada, derivado/extração, padronização (opcional), quantidade e unidade; forma farmacêutica, via (oral, sublingual ou enteral), posologia (até 300) e duração. A nomenclatura **não** pode conter termo de `TERMOS_NAO_VEGETAIS` (o "Derivado ou extração" e a padronização ficam de fora: citam o marcador legitimamente, como "Extrato seco padronizado a 95% de curcumina"; ajuste do code review do PR 1, 17/11/2026) (rascunho para a Debby: vitamina, mineral, aminoácido, isolado, ácido, sulfato, citrato, quelato, picolinato, glicinato, óxido, carbonato, cafeína, "L-" no começo de palavra; substâncias isoladas comuns em nutrição: creatina, glutamina, carnitina, taurina, glutationa, coenzima, resveratrol, curcumina, berberina, quercetina, piperina, melatonina, colágeno, whey, proteína, peptídeo, ômega, cloridrato; gêneros de probióticos e leveduras: Lactobacillus, Lacticaseibacillus, Bifidobacterium, Saccharomyces, Streptococcus, Bacillus; e própolis, geleia real, quitosana, glucosamina, condroitina, inositol, ubiquinol, licopeno, luteína; "coenzima Q10" já cai em "coenzima"); a conferência vale também para o `fitoterapico` (só a nomenclatura; mesma mensagem `naoVegetal`); a extração e a padronização ficam de fora, porque citam o marcador legitimamente (680, art. 12, I, "d") — Res. 680, art. 9º, II. O binômio e os termos barrados são **conferência de apoio, não garantia**: a responsabilidade pela composição é da nutricionista. Com `formula_fitoterapica` na receita, a declaração do preparo (`DECLARACAO_RECEITA`) ganha "e que a fórmula magistral fitoterápica tem só derivados vegetais, sem vitaminas, minerais, aminoácidos ou substâncias isoladas (Resolução CFN nº 680/2021, art. 9º, II)" — a declaração continua por tipo de documento, e a frase entra só nesse caso. **Exige habilitação**: `exigeHabilitacao(tipo)` é a função única, verdadeira para `fitoterapico` e `formula_fitoterapica`, usada no Zod, no preparo e na assinatura (`exigirHabilitacaoAtual`); a habilitação é do consultório (`tenants.fitoterapia_registro`). O suplemento manipulado continua o `suplemento` com "Manipulado" e composição (sem mudança) |
| RN-393 | **Itens salvos.** `prescricao_itens_salvos`: nome (1 a 80, único sem diferença de maiúsculas), `tipo` (os cinco tipos de item) e `item` validado pelo **mesmo** Zod do item da receita; sem marca, fabricante ou farmácia. "Suplementos" = `suplemento`; "Fitoterápicos" = `planta_cha`, `derivado_vegetal`, `fitoterapico`, `formula_fitoterapica`. Salvar item que exige habilitação exige habilitação do consultório. "Adicionar item salvo" **copia** para o rascunho (sem FK). Até 300 por consultório |
| RN-394 | **Modelos de prescrição.** `prescricao_modelos`: nome (1 a 80, único), itens (1 a 20, mesmo Zod) e orientações (até 2000, marcação); **sem** justificativa de uso e sem dado do paciente (aviso ao salvar). "Salvar como modelo" a partir do rascunho; "Carregar modelo": a action recebe o `conteudo` **atual da tela** (o que foi digitado e ainda não salvo), o id do modelo e o modo (acrescentar ou substituir); valida tudo **pelo mesmo caminho de `salvarRascunho`** (todas as conferências, inclusive a habilitação, os 20 itens e o Zod; recusa tudo ou nada), grava e devolve o conteúdo gravado, que o cliente põe no estado (ou remonta o formulário por `key`) sem perder a justificativa digitada — o `ReceitaForm` guarda itens e orientações em `useState` iniciado uma vez, e um revalidate não o atualiza. As orientações do modelo entram só se as da tela estiverem vazias. "Adicionar item salvo" copia no cliente, sem gravar. "Salvar item" e "Salvar como modelo" pedem o nome num `Dialogo` com `<form>` próprio, fora do formulário da receita, e não salvam o rascunho. A justificativa do rascunho fica. Até 100 por consultório |
| RN-395 | **Marcação mínima.** `lerMarcacao(texto)` (puro, sem import; usado no worker e no cliente) devolve blocos: parágrafo (separado por linha em branco), lista (linhas que começam com "- ") e, dentro do texto, negrito (`**…**`, sem aninhar; asterisco solto fica como está). Nada mais: sem link, imagem, título, cor ou HTML (sinais `<`, `>` e `&` aparecem como texto). O PDF, a prévia do editor e a página do documento no painel (`/painel/pacientes/[id]/documentos/[docId]`, que hoje mostra `orientacoes` em texto puro) montam componentes a partir dos blocos — **nunca** `dangerouslySetInnerHTML`. O portal e a página do link continuam sem itens nem orientações, só com o PDF (D17 do 10A, com o teste das chaves); a verificação só mostra o rótulo do tipo (D8). Conteúdo novo de receita e de solicitação grava `orientacoesFormato: 'marcacao'`; sem a chave, texto puro (receitas antigas não mudam; um rascunho antigo salvo no editor novo passa a `'marcacao'` e a prévia mostra o resultado). O editor tem "Negrito" e "Lista", que só inserem a marcação, e uma prévia |
| RN-396 | **Compartilhar.** Só documento `assinado` em vigor (nunca rascunho, preparado, `substituido` ou cancelado) no app e na página do link. Dois passos, porque o compartilhar do aparelho exige um toque recente: "Preparar para compartilhar" carrega o PDF em memória pela rota de sempre (`GET /api/p/documentos/[id]/pdf` ou a do link, com o `auditRead` de hoje), confere que a resposta é `application/pdf` (a do link devolve 303 para a página quando a sessão de 15 min venceu → "O acesso venceu. Digite o código de novo.") e mostra "Compartilhar", que chama `navigator.share({ files: [pdf] })` quando `navigator.canShare({ files })`; sem suporte, baixa o arquivo. Estados: região `<p role="status">` sempre montada por documento; o botão 1 fica `disabled` com "Preparando o PDF…" enquanto busca (sem toque duplo nem leitura em dobro); pronto, o botão 2 recebe o foco (`ref.focus()`) e o status diz "PDF pronto. Toque em Compartilhar."; `AbortError` (o paciente fechou a folha) é ignorado; falha → "Não foi possível preparar o PDF. Tente de novo."; nome acessível com o documento ("Preparar para compartilhar a receita de 12/11/2026"); alvos ≥ 44 px. Na página do link, o estado de `estadoDoLink` passa a trazer `tipoDoc` para escolher o texto por tipo. Texto por tipo (§6.2). Nada sai pela plataforma; nenhum registro novo |
| RN-397 | **Tipo novo: infraestrutura.** Todo código que decide por `tipo` de documento ou de item usa `switch` com `assertNever` (DEP-E7, R-374); a retificação copia todas as chaves do conteúdo do tipo; as filas "-2" (§4.5). `TIPO_DOCUMENTO_ROTULO.solicitacao_exames = 'Solicitação de exames laboratoriais'`; `DECLARACAO_POR_TIPO.solicitacao_exames = DECLARACAO_SOLICITACAO`; `TIPO_DOCUMENTO_COM_ARTIGO.solicitacao_exames = 'da solicitação de exames laboratoriais'` (sr-only do "Abrir PDF" do portal) |
| RN-398 | **Interruptor.** Dependem de `documentos_liberados`: a solicitação, "Lançar resultados", a receita (como hoje), os itens salvos e os modelos de prescrição (cartão "Prescrição" some sem ele, e `/painel/prescricao/*` responde `notFound()`, como `/p/documentos`). **Não** dependem: catálogo, faixas, modelos de nota e de solicitação, classificação, REF, nota, comparativo, edição e "Mostrar no app" |
| RN-399 | **LGPD e IA.** `dados.json` (§10): em `exames[]`, as linhas com `refMin`/`refMax`, `mostradoNoAppEm`, `notaDeInterpretacao` (a em vigor; a cópia da equipe leva também as anteriores) e `versoesAnteriores` (de `exam_versoes`, sem a justificativa, como a AF-D31 do Plano 21) — inclusão explícita de `exam_interpretacoes` e `exam_versoes`, que são `staff_only`; a solicitação em `documentos` (titular: só as emitidas, como a receita); a fórmula pelo `descreverItem`. Anonimização: `app_anonimizar_documentos` (genérica) cobre a solicitação; `exams`, `exam_versoes` e `exam_interpretacoes` ficam como prontuário (como `consultation_notes`). Nenhum contexto de IA lê as tabelas novas nem a nota (guarda de importação e de texto: nenhum arquivo de `src/modules/ia/**` importa `@/modules/exames/interpretacao` ou contém `exam_interpretacoes` ou `exam_versoes`; e nenhum arquivo de `src/modules/ia/nutri-paciente/**` importa `exams` de `@/db/schema` nem `@/modules/portal/exames-liberados`, porque a política nova dá à sessão de paciente — a mesma do contexto da IA Nutri, `contexto.ts:38`, `semConta` — um caminho legítimo para os exames liberados); `campos-enviados.ts` não muda |

### 6.2 Textos de interface

Textos novos, **rascunho para a Debby** e para o `revisor-interface` (os normativos — declaração, termos barrados,
categorias — também para o CRN-4, §14.3). Constantes: `MSG_EXAMES` (`src/modules/exames/constantes.ts`),
`MSG_SOLICITACAO` (`src/modules/documentos/solicitacao.ts`), acréscimos em `MSG_PRESCRICAO`, `MSG_MODELOS`
(`src/modules/documentos/modelos.ts`) e `MSG_COMPARTILHAR` (componente do portal).

| Chave | Texto |
|---|---|
| Cartões em Configurações | "Exames" · "Catálogo de exames, faixas do consultório e modelos de solicitação." · "Prescrição" · "Suplementos, fitoterápicos e modelos de prescrição." |
| Catálogo | h1 "Catálogo de exames" · seções "Catálogo" · "Modelos de solicitação" · "Novo exame" · "Seu catálogo ainda está vazio." · "Nomes de exames para começar" · título do diálogo "Nomes de exames para começar (você escolhe o que usar)" · ajuda "Só nomes de exames laboratoriais. Nenhuma unidade, faixa ou valor de referência vem junto." · "Selecionar todos" · "Adicionar ao catálogo" · colunas "Exame", "Unidade", "Faixas", "Ação" · "Painel ({n} exames)" |
| Exame do catálogo | "Nome" · "Unidade (opcional)" · "Outros nomes (opcional)" com ajuda "Como o exame aparece em laudos diferentes. Um por linha, até 10." · "Exames que compõem este (opcional)" com ajuda "Para pedidos como Hemograma completo: ao lançar o resultado, cada exame da lista vira uma linha." · "Salvar" · "Excluir" · "Exame salvo." · "Exame excluído do catálogo." |
| Faixas | h2 "Faixas do consultório" · ajuda "Faixas que você define, com a fonte. Servem para mostrar uma categoria ao lado do resultado, só no painel. A plataforma não traz faixas prontas." · "Sexo do cadastro" ("Todos", "Feminino", "Masculino") · "Idade de" · "até" · "anos" · "A partir de" · "Abaixo de" · "Categoria" · "Fonte" com ajuda "Diretriz, consenso ou laboratório, com o ano." · "Acrescentar faixa" · "Remover faixa" · "Fonte: {fonte}" · "atualizada em {dd/mm/aaaa}" |
| Modelos de nota | h2 "Modelos de nota de interpretação" · linha fixa "Escreva fatores a investigar e encaminhamentos; não afirme doença." · aviso "Retire dados do paciente antes de salvar." · "Quando o resultado está abaixo da referência" · "Quando o resultado está acima da referência" |
| Catálogo: erros | "O nome tem de 1 a 80 caracteres." · "Já existe um exame com este nome ou com um destes outros nomes: {nome}." · "Use até 10 outros nomes." · "Um painel tem de 2 a 30 exames." · "Um painel não tem unidade, faixas nem modelos de nota." · "Informe a unidade do exame antes de cadastrar faixas." · "Informe a fonte (de 2 a 300 caracteres)." · "Informe ao menos um limite." · "O limite inicial deve ser menor que o final." · "A idade inicial deve ser menor ou igual à final." · "Esta faixa se sobrepõe a outra do mesmo público." · "Use até 20 faixas." · "O modelo de nota tem no máximo 1000 caracteres." · "O catálogo chegou ao limite de 500 exames." · "Remova as faixas antes de trocar a unidade." · confirmação "Excluir {nome} do catálogo? Exames, modelos e documentos já gravados não mudam." ("Excluir", "Cancelar") |
| Lançamento | "Adicionar do catálogo" · diálogo "Buscar no catálogo" · "Selecionar todos" (nome acessível "Selecionar todos os exames mostrados") · "Adicionar {n} exame(s)" · "Carregar modelo de solicitação" · "Remover todos" · confirmação "Remover todas as linhas deste exame? Nada muda até você salvar." ("Remover", "Cancelar") · "Adicionar linha" · rótulos por campo e linha (§7): grupo "Linha {n}: {marcador}", "Marcador {n}", "Valor {n}", "Unidade {n}", "Referência do laudo {n}", "Faixa do laudo: de {n}", "até {n}" · ajuda "Copie a faixa impressa no laudo." · "Usar {a} a {b}" (nome acessível "Usar {a} a {b} (linha {n})") · aviso "A faixa numérica não bate com o texto da referência. Confira no laudo." |
| Lançamento: erros | "O início da faixa deve ser menor ou igual ao fim." · "Informe a justificativa da alteração (de 5 a 500 caracteres)." · "Nada foi alterado." · "Faixa inválida. Use só números, como 70 ou 4,5." · "O exame mudou desde que você abriu. Recarregue a página." (as mensagens de hoje de `exames.ts` continuam) |
| Exame | "Abrir" (nome acessível "Abrir {título} de {data}") · "Editar" · "Editar exame" · "Justificativa da alteração" · "Exame salvo." · "Versões anteriores" · "Versão {n} — {dd/mm/aaaa}, por {nome}" · "Comparar" (caixa de seleção, nome acessível "Comparar {título} de {data}") · "Comparar {n} exames" · texto de apoio "Escolha de 2 a 6 exames para comparar." · aviso no editar de exame no app "Este exame está no app do paciente. O que você salvar aparece lá na hora." · confirmação de excluir exame no app "Este exame está no app do paciente. Ao excluir, ele some de lá." |
| Classificação | "Abaixo da referência" · "Dentro da referência" · "Acima da referência" · aviso "Classificação automática pela faixa de referência informada. Não é diagnóstico." · "As faixas do consultório não consideram gestação." · "(faixa do consultório)" depois da categoria |
| REF | botão "Ver referência" (nome acessível "Referência de {marcador}") · "Referência do laudo: {texto}" · "Faixa do laudo: {faixa}" · "Faixas do consultório" · "{Feminino\|Masculino\|Todos}, {idade}: {limites} — {categoria}" · "Fonte: {fonte} · atualizada em {dd/mm/aaaa}" · "Sem referência." |
| Nota | "Nota de interpretação" · linha fixa "Escreva fatores a investigar e encaminhamentos; não afirme doença." · ajuda "Não aparece no app; entra na cópia dos dados que o paciente pedir." · "Inserir modelo" · "{exame} — abaixo" / "{exame} — acima" · "Nenhum modelo para os exames fora da referência." · "Salvar nota" · "Apagar nota" · "Nota salva." · "Nota apagada." · "Notas anteriores" · "A nota tem no máximo 2000 caracteres." |
| Comparativo | h1 "Comparativo de exames" · caption "Resultados por data" · "Marcador" · "—" · nota "Marcadores com unidades diferentes aparecem em linhas separadas." · "Voltar aos exames" |
| Mostrar no app (painel) | "Mostrar no app do paciente" · confirmação "O paciente verá no app o título, a data, os valores e a referência deste exame, com o aviso de que não é diagnóstico. A nota de interpretação, as categorias do consultório e o laudo não aparecem." ("Mostrar no app", "Cancelar") · "Retirar do app" · "O exame aparece no app do paciente." · "O exame saiu do app do paciente." · "Este paciente ainda não usa o app. O exame aparece quando ele entrar." · selo "No app" · rótulos do Histórico de acessos "Liberou exame no app" e "Retirou exame do app" |
| Portal | h2 "Resultados liberados" · "Resultados que sua nutricionista liberou para você." · por marcador (lista de definição): nome em destaque, "Resultado: {valor} {unidade}", "Referência: {texto}" · "Fora da referência" · aviso "Não é diagnóstico. Converse com sua nutricionista." |
| Solicitação | "Nova solicitação de exames" · h1 "Solicitação de exames laboratoriais" · "Exames" · "Adicionar do catálogo" · "Adicionar exame fora do catálogo" com ajuda fixa "Só exames laboratoriais (Lei nº 8.234/1991, art. 4º, VIII)." · "Carregar modelo" ("Acrescentar", "Substituir", confirmação "Substituir os {n} exames da solicitação pelos do modelo?") · "Remover todos" · "Indicação clínica (opcional)" com a linha fixa "Descreva a finalidade nutricional; não afirme doença." · "Orientações ao paciente (opcional)" com ajuda "Preparo, jejum, horário. Aparecem no pedido." · aviso "Planos de saúde podem recusar pedido de exame feito por nutricionista." · "Lançar resultados" · "Exames solicitados em {dd/mm/aaaa}" |
| Solicitação: erros | "Inclua ao menos um exame." · "A solicitação pode ter até 40 exames." · "O nome do exame tem de 1 a 80 caracteres." · "Este exame já está na lista." · "A indicação clínica tem no máximo 500 caracteres." · "As orientações têm no máximo 1000 caracteres." |
| `DECLARACAO_SOLICITACAO` | "Declaro que os exames solicitados são laboratoriais e necessários à avaliação, à prescrição ou à evolução nutricional, dentro da minha competência (Lei nº 8.234/1991, art. 4º, VIII, e Resolução CFN nº 306/2003), e que este pedido não indica laboratório." |
| Modelos de solicitação | h1 "Modelos de solicitação" · "Novo modelo" · aviso "Retire dados do paciente antes de salvar." · lista vazia "Nenhum modelo de solicitação ainda. Crie o primeiro em Novo modelo." · "Nome do modelo" · "Exames" · "Orientações ao paciente (opcional)" · "Modelo salvo." · "Modelo excluído." · erros "O nome tem de 1 a 80 caracteres." · "Já existe um modelo com este nome." · "Inclua ao menos um exame." · "O modelo pode ter até 40 exames." · "Este exame já está na lista." |
| Fórmula (`TIPOS_ITEM`, `MSG_PRESCRICAO`) | `formula_fitoterapica`: "Fórmula magistral com vários compostos vegetais" (o rótulo de `fitoterapico`, texto da spec 10A, não muda) · ajuda sob o seletor do tipo (`aria-describedby`) "Use 'Fórmula magistral com vários compostos vegetais' quando a fórmula tiver de 2 a 10 derivados vegetais em quantidades próprias; 'Fitoterápico' para o produto de uma planta só." · "Compostos" · "Acrescentar composto" · "Nomenclatura botânica" · "Parte usada" · "Derivado ou extração" · "Padronização (opcional)" · "Quantidade" · "Unidade" · "Forma farmacêutica" · `compostos`: "Informe de 2 a 10 compostos vegetais." · `binomio`: "Use a nomenclatura botânica (Gênero espécie), como Matricaria chamomilla L." · `naoVegetal`: "Fórmula fitoterápica não pode ter vitaminas, minerais, aminoácidos ou substâncias isoladas (Resolução CFN nº 680/2021, art. 9º, II)." · `semHabilitacao`, `dicaOutro` e os guias `documentos` e `configuracoes` passam a citar os dois tipos (e o guia diz que o tipo aparece **desabilitado** sem a habilitação) · frase da declaração da receita com fórmula (RN-392) |
| Orientações formatadas | "Negrito" · "Lista" · "Prévia" · ajuda "Escreva ** antes e depois do trecho para negrito; comece a linha com um hífen para fazer lista." |
| Itens salvos e modelos (`MSG_MODELOS`) | h1 "Itens salvos" · seções "Suplementos" · "Fitoterápicos" · "Modelos de prescrição" · "Novo item salvo" · "Nome do item salvo" · "Item salvo." · "Salvar item" · "Adicionar item salvo" · "Salvar como modelo" · "Nome do modelo" · aviso "Retire dados do paciente antes de salvar. A justificativa de uso não vai para o modelo." · "Modelo salvo." · "Carregar modelo" · "Acrescentar aos itens" · "Substituir os itens" · confirmação "Substituir os {n} itens da receita pelos do modelo?" · "Com este modelo a receita passaria de 20 itens. Use Substituir ou retire itens." · "Já existe um item salvo com este nome." · "Já existe um modelo com este nome." · "Item excluído." · "Modelo excluído." · confirmação "Excluir {nome}? As receitas já emitidas não mudam." · aviso também em "Salvar item": "Retire dados do paciente antes de salvar." · listas vazias "Nenhum item salvo. Salve um item da receita com Salvar item." e "Nenhum modelo de prescrição ainda. Salve um a partir de uma receita, com Salvar como modelo." |
| Compartilhar (`MSG_COMPARTILHAR`) | "Preparar para compartilhar" (nome acessível "Preparar para compartilhar {o documento} de {dd/mm/aaaa}") · "Preparando o PDF…" · "PDF pronto. Toque em Compartilhar." · "Compartilhar" · por tipo: receita "Envie à farmácia que você escolher." · solicitação "Envie ao laboratório que você escolher." · parecer "Envie a quem você escolher." · nos três: "O PDF tem dados da sua saúde. Envie só a quem você quiser que veja." · "Este aparelho não consegue compartilhar o arquivo. O PDF foi baixado; envie pelo aplicativo que preferir." · "O acesso venceu. Digite o código de novo." · "Não foi possível preparar o PDF. Tente de novo." · versão substituída e cancelada: os textos de hoje (`MSG_PORTAL_DOC.substituido`, `.cancelado`) |
| Ficha | `MSG_FICHA.itens.solicitacao`: "Solicitação de exames" (grupo "Avaliações") |
| Estados vazios e erros genéricos | diálogo "Adicionar do catálogo" com o catálogo vazio: "Seu catálogo está vazio. Cadastre exames em Catálogo de exames." (com link) · busca sem resultado: "Nenhum exame encontrado." · "Carregar modelo" sem modelo (solicitação, exame, receita): "Nenhum modelo ainda." com o link para criar · "Adicionar item salvo" sem itens: "Nenhum item salvo." · erros genéricos: "Não foi possível salvar. Tente de novo." · "Não foi possível excluir. Tente de novo." · "Não foi possível mudar o app do paciente. Tente de novo." |

Os textos do manual guiado (guias novos `exames-do-consultorio` e `prescricao`; passos novos e versão +1 de `prontuario`,
`configuracoes` e `documentos` — v3, com o passo `nova-solicitacao` e perguntas sobre "Lançar resultados", fórmula e
modelos —; e o guia do portal `portal-novidades` — v4: Exames "enviar exame (quando o consultório recebe) e ver os
resultados que a sua nutricionista liberar", Eu "compartilhar" o PDF) e da Central de Ajuda ficam em rascunho até a
revisão do `revisor-interface` e da Debby (PM-E12).

---

## 7. Telas

Visual V2 do painel (tokens de `src/app/globals.css`, componentes de `src/components/ui`), uma coluna abaixo de 768 px.
Esboços (o desenho exato fica com quem constrói e o `revisor-interface`):

**Exames do paciente** (`/painel/pacientes/[id]/exames`, formulário "Novo exame"):

```
Novo exame
 Título [Exames solicitados em 10/11/2026]   Data [12/11/2026]   Laudo [Escolher arquivo]
 [Adicionar do catálogo] [Carregar modelo de solicitação] [Remover todos] [Adicionar linha]
 Marcador        Valor  Unidade  Referência do laudo  Faixa: de  até   Classificação          REF
 Glicemia jejum  105    mg/dL    70 a 99 mg/dL        [70]      [99]   Acima da referência    [REF]
 Ferritina       18     ng/mL    15 a 150             [  ]      [  ]   [Usar 15 a 150]        [REF]
 Classificação automática pela faixa de referência informada. Não é diagnóstico.
 [Salvar exame]
Exames
 [ ] 12/11/2026  Exames solicitados em 10/11/2026   No app   [Abrir]
 [ ] 03/05/2026  Perfil lipídico                             [Abrir]
 [Comparar 2 exames]
```

**Linhas do lançamento (acessibilidade):** cada linha é um grupo (`role="group"`, `aria-label` "Linha {n}: {marcador}")
com rótulo visível por campo e número ("Faixa do laudo: de {n}", "até {n}", "Referência do laudo {n}"); "Usar 70 a 99" tem
o nome acessível "Usar 70 a 99 (linha {n})". Layout: ≥ 1024 px uma linha de 8 células; 768 a 1023 px duas linhas por
linha do exame; < 768 px empilhado, sem rolagem lateral. A classificação ao vivo é texto ligado ao campo do valor por
`aria-describedby` e **não** é região viva por tecla (só é anunciada ao sair do campo). A âncora `#novo-exame` continua
(o "Adicionar → Exame" da ficha usa `exames#novo-exame`). No esboço, "REF" é a coluna da função; o botão diz "Ver
referência" (RN-382).

**Lista da aba:** mantém a tabela de valores de cada exame, "Ler valores com IA", "Baixar laudo" e "Excluir" onde estão
hoje (o E2E da conferência depende deles); "Abrir" leva ao detalhe com a nota, a liberação e "Versões anteriores";
caixa "Comparar {título} de {data}" e link "Abrir {título} de {data}" (nomes únicos).

**Detalhe do exame:** cabeçalho com título e data; "Mostrar no app do paciente" (botão — não `role=switch` — com a
confirmação no `Dialogo`; vira "Retirar do app", imediato e reversível, com o selo "No app"; a mensagem fica num
`<p role="status">` fora do bloco trocado e o foco volta ao botão);
tabela com "Marcador · Valor · Referência do laudo · Classificação · REF" (categoria do consultório ao lado da neutra,
"(faixa do consultório)"); avisos fixos; "Nota de interpretação" com a linha fixa, a ajuda, "Inserir modelo" e
"Salvar nota"; "Editar", "Versões anteriores", "Baixar laudo", "Excluir".

**Comparativo:** tabela com `caption` "Resultados por data", `th scope="col"` nas datas e `th scope="row"` nos
marcadores, dentro de `<div role="region" aria-labelledby="<id do caption>" tabIndex={0} className="overflow-x-auto …
focus-visible:outline-offset-[-3px]">` (padrão do repositório; `src/app/painel/cores.test.ts` exige o contorno para
dentro). Classificação em texto (nunca só cor).

**Catálogo:** lista com "Exame · Unidade · Faixas · Ação"; formulário do exame com as três áreas (dados, "Faixas do
consultório" como lista de linhas editáveis, "Modelos de nota de interpretação").

**Solicitação (editor do documento):** lista de exames com "Remover" por linha e os botões da US-377; os dois campos
opcionais; a barra "Negrito · Lista" e a "Prévia" das orientações; o aviso dos planos de saúde num `Aviso tipo="aviso"` (não há variante informativa; `papel="nenhum"` se ficar dentro de
região viva).

**Receita:** como hoje, com o tipo novo de item (lista de compostos com "Acrescentar composto"), "Salvar item" por item,
"Adicionar item salvo", "Salvar como modelo", "Carregar modelo" e a barra de formatação das orientações.

**Portal** (`/p/exames`): "Resultados liberados" em cartões por exame (título e data no cabeçalho do cartão; uma linha
por marcador em lista de definição `<dl>`: nome em destaque, "Resultado: 105 mg/dL" e "Referência: …" abaixo, com
`wrap-break-word` no título e na referência; "Fora da referência" em texto no `Selo`, junto do valor; sem tabela, para
não haver rolagem lateral a 360 px), o aviso fixo no topo da seção; `/p/documentos`: em cada documento
assinado em vigor, o texto por tipo e o botão "Preparar para compartilhar" → "Compartilhar", com os estados da RN-396.

**Mensagens e foco:** região `<p role="status">` sempre montada acima do formulário ou da lista; erros `role="alert"`
junto do campo; h1 com `tabIndex={-1}` recebendo o foco depois de salvar; formulários devolvem `valores` e os campos usam
`defaultValue` com `key` (um erro não apaga o que foi digitado). Diálogos ("Adicionar do catálogo", "Carregar modelo",
"Inserir modelo", "Ver referência", "Nomes de exames para começar", "Salvar item", "Salvar como modelo") e as
confirmações com rótulos próprios ("Remover todos", "Mostrar no app", "Substituir", "Excluir") usam o `Dialogo` novo
(T2, EP-D42: `<dialog>` + `showModal()`, `Esc` fecha, foco volta ao botão), nunca `window.confirm`; formulário dentro
do diálogo é `<form>` próprio, fora do `<form>` da receita ou do exame.

---

## 8. Requisitos não funcionais

| ID | Categoria | Requisito |
|---|---|---|
| RNF-370 | Privacidade em log | Valores, nomes de exame, faixas, notas, justificativas, indicação clínica, orientações e itens nunca vão a log, Sentry ou mensagem de erro (regra 3); teste que força erros nos módulos novos e confere o logger e o `beforeSend` |
| RNF-371 | Desempenho | Aba Exames com 50 exames × 50 linhas e catálogo de 500: p95 ≤ 800 ms (RNF-01), uma transação por tela, catálogo lido uma vez e casado em memória (`Map` de nomes normalizados); comparativo ≤ 6 exames, índice `exams_paciente_data_idx` (existe) |
| RNF-372 | Acessibilidade | WCAG 2.1 AA (axe sem violação, claro e escuro, 1280 e 360 px) em todas as telas novas e no portal; classificação e "Fora da referência" em texto; tabelas com `caption` e `th scope`; contêiner rolável focável; diálogos acessíveis; alvos ≥ 44 px; foco no h1 depois de salvar; os estados que não são rota (diálogo aberto, "Ver referência" aberto, confirmação do "Mostrar no app", cartão do portal com exame liberado, "Compartilhar" pronto) entram numa spec de axe própria, claro e escuro, 1280 e 360 px |
| RNF-373 | Testes | (a) unidade: `classificarNeutra`, `categoriaDoConsultorio` (limites, um limite só, unidade diferente, idade na data, sinônimo, ambíguo, < 1 ano, sexo nulo), `sugerirFaixa` (só padrão único), `referenciaDaFaixa`, `lerMarcacao` (marcação maliciosa), binômio e termos barrados (com "Creatina monoidratada", "Glutamina livre", "Curcumina lipossomal", "Lactobacillus acidophilus", "Saccharomyces boulardii" na nomenclatura; o derivado com "curcumina isolada" passa, fora da conferência, RN-392), sobreposição de faixas, troca de unidade com faixas, `fora` nulo com faixa e texto divergentes; (b) integração (Testcontainers): RLS e `staff_only` das seis tabelas, `paciente_exame_liberado` (P2 não vê o não liberado, vê o liberado, não vê a nota), `updated_at` intacto em "Mostrar no app", concorrência da edição × conferência da IA, cada leitor de `valores` com linha antiga e nova (DEP-E1), retificação que conserva `orientacoesFormato` e o tipo, habilitação na fórmula (salvar, preparar, assinar), "Carregar modelo" tudo ou nada; versão do exame (justificativa, só acréscimo, `iaTarefaId` forjado ignorado, nome e valor da linha da IA fixos, DELETE direto em `exam_versoes` e `exam_interpretacoes` dá 42501 e a exclusão do exame leva as versões); nota com paciente bloqueado ou anonimizado recusada; liberar, retirar e liberar de novo com três eventos; `pg_policies` de `paciente_exame_liberado`; chaves de `documentosDoPaciente` e de `verificacao.ts` com uma solicitação e uma fórmula (nenhuma chave nova); (c) guardas: filas "-2" (fonte), IA sem as tabelas novas (RN-399), `_journal.json` crescente; (d) E2E: CS-370, CS-371, CS-372 e o caminho de download do "Compartilhar" |
| RNF-374 | Segurança | Marcação nunca vira HTML (RN-395); a projeção do portal é fechada (RN-385); nenhum caminho de arquivo com texto do usuário (regra 9); entradas numéricas sem `parseFloat` solto (o leitor de números de `exames.ts`) |
| RNF-375 | Compatibilidade de deploy | Migration só de expansão (coluna anulável, CHECKs ampliados, tabelas novas); filas "-2" (§4.5); volta atrás abaixo do PR 4 só com o runbook (R-375) |
| RNF-376 | Dependências | Nenhuma dependência nova (C-379) |
| RNF-377 | Cache | Páginas novas com `dynamic = 'force-dynamic'`; nada de exame no service worker do portal (a seção "Resultados liberados" não é guardada offline) |

---

## 9. Modelo de dados

Seis tabelas novas com `tenant_id`, uma coluna e uma política em `exams` e dois CHECKs ampliados. **No PR 1** (EP-D38):
`exames_catalogo`, `exames_modelos_solicitacao`, `exam_interpretacoes`, `exam_versoes`, a coluna, a política e os CHECKs
de tipo; **no PR 4** (T10), numa migration própria com a custom `rls_prescricao_modelos`: `prescricao_itens_salvos` e
`prescricao_modelos` (se a T10 for cortada para o 22B, as duas saem com ela e nada fica sem uso na `main`). Migration
gerada (`pnpm db:generate --name exames_catalogo`) + migration custom `rls_exames_catalogo` (`pnpm drizzle-kit generate --custom --name rls_exames_catalogo`; nomes distintos das `0029_exames`/`0030_rls_exames` que já existem, EP-D63 do plano), com `DATABASE_URL_MIGRATOR` (regra 7). **Número: o que `pnpm db:generate` der em
cima da `main` do momento** — nenhum é reservado (os Planos 18 PR 2, 19, 20 PR 2, 21 e 23 também geram). Quem mergeia
depois gera de novo em cima da `main` (`sessoes-paralelas.md`, §5); a custom é recriada com o mesmo conteúdo e o
comentário `-- Plano 22 (editado à mão)`. Schema em `src/db/schema/exames-catalogo.ts` (as do consultório; as de prescrição em `prescricao-modelos.ts`, PR 4) e
`src/db/schema/exames-filhas.ts` (`exam_interpretacoes` e `exam_versoes`, com `exams` importada de `./pacientes` para a FK composta),
exportados em `src/db/schema/index.ts` (linhas novas no fim). Em `src/db/schema/pacientes.ts` (disputado pelos Planos 18, 21 e 23),
só a coluna `mostrar_no_app_em` e as chaves opcionais do tipo de `valores` (EP-D60 do plano).

### 9.1 `exames_catalogo`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | — |
| `tenant_id` | `uuid not null` FK `tenants(id)` | — |
| `nome` | `text not null` | CHECK `char_length between 1 and 80` |
| `unidade` | `text null` | CHECK `is null or char_length between 1 and 20` |
| `sinonimos` | `jsonb not null default '[]'` | CHECK `case when jsonb_typeof(sinonimos) = 'array' then jsonb_array_length(sinonimos) <= 10 else false end` (textos no Zod; o `case` fixa a ordem — o `and` não a garante, e um objeto levantaria 22023 em vez do 23514 do CHECK) |
| `componentes` | `jsonb not null default '[]'` | CHECK `case when jsonb_typeof(componentes) = 'array' then jsonb_array_length(componentes) <= 30 else false end` |
| `faixas` | `jsonb not null default '[]'` | CHECK `case when jsonb_typeof(faixas) = 'array' then jsonb_array_length(faixas) <= 20 else false end`; cada faixa `{ sexo: 'F'\|'M'\|null, idadeMin: int\|null, idadeMax: int\|null, aPartirDe: number\|null, abaixoDe: number\|null, categoria, fonte, atualizadaEm }` (Zod, RN-374) |
| `modelo_nota_abaixo`, `modelo_nota_acima` | `text null` | CHECK `char_length <= 1000` |
| `created_at`, `updated_at` | `timestamptz not null default now()` | — |

CHECK `exames_catalogo_painel`: `componentes = '[]'::jsonb or (unidade is null and faixas = '[]'::jsonb and
modelo_nota_abaixo is null and modelo_nota_acima is null)`. CHECK `exames_catalogo_faixa_com_unidade`: `unidade is not
null or faixas = '[]'::jsonb` (RN-374). Índice único `exames_catalogo_nome_unico` em
`(tenant_id, lower(nome))`. A unicidade dos outros nomes normalizados é do módulo (RN-371).

### 9.2 `exames_modelos_solicitacao`

`id`, `tenant_id`, `nome` (1–80), `exames jsonb not null` (CHECK `case when jsonb_typeof(exames) = 'array' then jsonb_array_length(exames) between 1 and 40 else false end` — `{ nome, painel? }` no Zod),
`orientacoes text not null default ''` (≤ 1000), `created_at`, `updated_at`; índice único `(tenant_id, lower(nome))`.

### 9.3 `prescricao_itens_salvos` (PR 4)

`id`, `tenant_id`, `nome` (1–80), `tipo text not null` (CHECK `in ('suplemento','planta_cha','derivado_vegetal',
'fitoterapico','formula_fitoterapica')`), `item jsonb not null` (CHECK `jsonb_typeof = 'object'`; Zod do item),
`created_at`, `updated_at`; índice único `(tenant_id, lower(nome))`. CHECK `prescricao_itens_salvos_tipo_coerente`: `item->>'tipo' = tipo`
(a coluna decide o grupo da lista; sem o CHECK, um item formulado listado como suplemento escaparia da leitura de habilitação da tela).

### 9.4 `prescricao_modelos` (PR 4)

`id`, `tenant_id`, `nome` (1–80), `itens jsonb not null` (CHECK `case when jsonb_typeof(itens) = 'array' then jsonb_array_length(itens) between 1 and 20 else false end`), `orientacoes text not null default ''`
(≤ 2000), `created_at`, `updated_at`; índice único `(tenant_id, lower(nome))`.

### 9.5 `exam_interpretacoes`

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | — |
| `tenant_id`, `patient_id`, `exam_id` | `uuid not null` | FK composta `(tenant_id, patient_id, exam_id) → exams (tenant_id, patient_id, id) ON DELETE CASCADE` (alvo `exams_tenant_paciente_id_unique`) |
| `versao` | `smallint not null` | CHECK `>= 1` |
| `texto` | `text null` | CHECK `texto is null or char_length(texto) between 1 and 2000` (nulo = "Apagar nota") |
| `criado_por` | `uuid not null` | gatilho `exam_interpretacoes_regras` (BEFORE INSERT: contexto vazio e `worker` → 42501 antes de tudo; na sessão `nutri`, `app_current_user()` obrigatório e paciente bloqueado/anonimizado recusado; molde de `app_fin_lancamentos_regras`, 0123), sem FK |
| `criado_em` | `timestamptz not null` | gatilho (`clock_timestamp()`) |

Índice único `(tenant_id, exam_id, versao)`; a nota em vigor é a de maior versão (RN-383). Só de inclusão (EP-D41):
`REVOKE UPDATE, DELETE, TRUNCATE ON exam_interpretacoes FROM nutri_app_role`; as linhas saem só com o exame, pela
cascata (ação referencial, executada como dono da tabela). Se a cascata esbarrar na RLS forçada, o plano troca o
`REVOKE DELETE` por um gatilho que só aceita `pg_trigger_depth() > 1` (o mesmo plano B da `anthropometry_versoes`, §9.3
da spec 21); a escolha é registrada na T1 pelo resultado do `src/db/migrate-owner.test.ts` (migrator sem superusuário, como
produção) — o banco do Vitest é migrado como superusuário e não serve para decidir.

### 9.5a `exam_versoes` (EP-D41)

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` PK | — |
| `tenant_id`, `patient_id`, `exam_id` | `uuid not null` | FK composta `(tenant_id, patient_id, exam_id) → exams (tenant_id, patient_id, id) ON DELETE CASCADE` |
| `versao` | `smallint not null` | CHECK `>= 1`; único `(tenant_id, exam_id, versao)` |
| `titulo`, `data`, `valores` | os tipos de `exams` | o estado **de antes** da edição (`valores` inteiro, com `iaTarefaId`) |
| `justificativa` | `text null` | CHECK `justificativa is null or char_length(justificativa) between 5 and 500` (nula só na edição que só acrescenta linhas, RN-378) |
| `alterado_por` | `uuid not null` | gatilho `exam_versoes_regras` (BEFORE INSERT, mesma ordem do `exam_interpretacoes_regras`), sem FK |
| `alterado_em` | `timestamptz not null` | gatilho (`clock_timestamp()`) |

Só de inclusão (`REVOKE UPDATE, DELETE, TRUNCATE`), como `exam_interpretacoes`; molde da `anthropometry_versoes` do
Plano 21 (AF-D31). Fica na anonimização (prontuário) e sai na exportação sem a justificativa (RN-399).

### 9.6 Mudanças em tabelas existentes

| Tabela | Mudança | Migration |
|---|---|---|
| `exams` | `mostrar_no_app_em timestamptz null` (sem default; quem ligou e quem retirou ficam no `audit_log` pelo `recordAudit` da RN-385) | gerada |
| `exams` | Política RESTRICTIVE `paciente_exame_liberado` FOR SELECT (RN-385) | custom |
| `signed_documents` | CHECK `signed_documents_tipo_valido` com `'solicitacao_exames'` | gerada (drop + add do CHECK) |
| `document_verifications` | CHECK `document_verifications_tipo_valido` com `'solicitacao_exames'` | gerada |
| `exams.valores` (jsonb, sem CHECK) | Chaves opcionais `refMin`, `refMax` no tipo TypeScript e no Zod (RN-376) | — |
| `signed_documents.conteudo` (jsonb) | Tipo `solicitacao_exames`; `orientacoesFormato`; item `formula_fitoterapica` (Zod) | — |

### 9.7 Migrations custom `rls_exames_catalogo` (PR 1) e `rls_prescricao_modelos` (PR 4)

No formato da `0123_rls_financeiro.sql`: um comando por bloco, separados por `--> statement-breakpoint`, com o
comentário de origem antes de cada grupo.

```sql
-- Plano 22 (editado à mão). Spec §9.7, RN-370, RN-378, RN-383, RN-385. CLAUDE.md regras 2 e 8.
-- RN-370: bibliotecas do consultório — só a equipe; nada em PUBLICO_LIBERADO nem em PACIENTE_ESCREVE.
SELECT app_enable_tenant_rls('exames_catalogo');
--> statement-breakpoint
SELECT app_enable_staff_only('exames_catalogo');
--> statement-breakpoint
SELECT app_enable_tenant_rls('exames_modelos_solicitacao');
--> statement-breakpoint
SELECT app_enable_staff_only('exames_modelos_solicitacao');
--> statement-breakpoint
-- RN-383: nota de interpretação — só a equipe, auditada (entidade `exames_nota`, EP-D61 do plano), só de inclusão (EP-D41)
SELECT app_enable_tenant_rls('exam_interpretacoes');
--> statement-breakpoint
SELECT app_enable_patient_rls('exam_interpretacoes');
--> statement-breakpoint
SELECT app_enable_staff_only('exam_interpretacoes');
--> statement-breakpoint
SELECT app_enable_audit('exam_interpretacoes', 'exames_nota');
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON exam_interpretacoes FROM nutri_app_role;
--> statement-breakpoint
-- RN-378: versões anteriores do exame — só a equipe, auditada (entidade `exames_versoes`), só de inclusão (EP-D41)
SELECT app_enable_tenant_rls('exam_versoes');
--> statement-breakpoint
SELECT app_enable_patient_rls('exam_versoes');
--> statement-breakpoint
SELECT app_enable_staff_only('exam_versoes');
--> statement-breakpoint
SELECT app_enable_audit('exam_versoes', 'exames_versoes');
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON exam_versoes FROM nutri_app_role;
--> statement-breakpoint
-- (gatilhos exam_interpretacoes_regras e exam_versoes_regras, BEFORE INSERT, um por bloco; corpo no plano, T1. Ordem:
--  (1) contexto vazio ou `worker` → 42501; (2) outro papel ≠ `nutri` → RETURN NEW (a RLS da própria tabela recusa);
--  (3) `nutri`: usuário obrigatório, paciente bloqueado/anonimizado → 42501 (FOR KEY SHARE), autor e hora pelo banco)
-- RN-385: o paciente só lê o exame liberado
CREATE POLICY paciente_exame_liberado ON exams AS RESTRICTIVE FOR SELECT
  USING (app_current_role() IS DISTINCT FROM 'paciente' OR mostrar_no_app_em IS NOT NULL);
```

A `rls_prescricao_modelos` (PR 4, cabeçalho `-- Plano 22 (editado à mão). Spec §9.7, RN-393, RN-394. CLAUDE.md regra 2.`)
segue o mesmo formato: `app_enable_tenant_rls` e `app_enable_staff_only` de `prescricao_itens_salvos` e
`prescricao_modelos`, um comando por bloco.

Conferido: nenhum leitor de `exams` roda na sessão de paciente hoje (`exames.ts`, `parecer-exames.ts`, `conferencia.ts`,
`resumo-dados.ts`, `leitura-job.ts`, `exportacao-job.ts`, `lgpd.ts`, `ficha/secoes/exames.ts` — todos `nutri` ou
worker); a FK de `exam_submissions` para `exams` não passa pela RLS. A política não quebra o Plano 12. O `noApp` da ficha
conta no contexto de paciente `semConta` (D16 do 18), e a política faz a paridade sozinha.

### 9.8 Guardas e listas

| Lista | Entrada |
|---|---|
| `STAFF_ONLY` (`src/db/rls-guard.ts`) | `exames_catalogo`, `exames_modelos_solicitacao`, `prescricao_itens_salvos`, `prescricao_modelos` — "Plano 22 (EP-D8, EP-D29, EP-D30): bibliotecas do consultório — só a equipe; sem paciente"; `exam_interpretacoes` — "Plano 22 (EP-D18, EP-D19): nota de interpretação — fora do app; o titular recebe pela exportação (inclusão explícita)"; `exam_versoes` — "Plano 22 (EP-D41): versões anteriores do exame — só a equipe; o titular recebe pela exportação, sem a justificativa" |
| `AUDIT_EXCEPTIONS` | nenhuma (`exam_interpretacoes` e `exam_versoes` têm o gatilho; as outras não têm `patient_id`). `ENTIDADE_ROTULO` ganha `exames_versoes` ("Versões do exame"), `exames_nota` ("Nota de interpretação do exame", EP-D61 do plano), `exame_no_app_liberado` e `exame_no_app_retirado` ("Exames"; "Liberou exame no app"/"Retirou exame do app" saem na coluna Ação, EP-D45 do plano) |
| `PUBLICO_LIBERADO`, `PACIENTE_ESCREVE`, `CONTEUDO_POR_AUDIENCIA` | nenhuma |
| `FABRICAS` (`test/isolamento.test.ts`) | as seis (as duas de prescrição no PR 4). A fábrica de `exams` passa a gravar o exame **liberado** (`mostrar_no_app_em = now()`), como `meal_plans` grava `'publicado'` por causa da `paciente_sem_rascunho` (0045): assim o laço genérico de leitura da sessão de paciente continua provando o isolamento entre pacientes em `exams`. `exam_interpretacoes` e `exam_versoes` em **`COM_MAE`** (a fábrica cria o exame-mãe, sem a marca, no mesmo comando). Como em `fin_lancamentos` (Plano 20), com `COM_MAE` a recusa dos negativos de INSERT vem da política de `exams`; um teste próprio (`src/modules/exames/banco.test.ts`) prova as políticas da própria `exam_interpretacoes` e de `exam_versoes` com um exame já criado pela sessão `nutri`, a cascata da exclusão do exame e o 42501 do DELETE direto |
| `SO_INSERE` | `exam_interpretacoes` e `exam_versoes` (só de inclusão: o teste pula UPDATE e DELETE, já negados por permissão, antes de olhar `SEM_DELETE` e `DELETE_REVOGADO`, que por isso não precisam delas) |
| `SO_APAGA`, `ULTIMAS`, `SEM_DELETE`, `IMUTAVEIS` | nenhuma. `listTenantTables` ordena por `relname` (tipo `name`, colação C, `src/db/rls-guard.ts:53`), e `exam_interpretacoes` e `exam_versoes` vêm antes de `exams`; `exams` não está em `ULTIMAS`, e as duas saem em cascata com o exame; nada segura o `delete from patients` filtrado por `SO_APAGA.patients`. As bibliotecas também não entram |
| Teste de leitura positiva | Com a fábrica de `exams` liberada (acima), o `it` genérico "a paciente P2 só vê e só altera as próprias linhas" (`test/isolamento.test.ts`) continua exigindo `vistas.rows.length >= 1` em `exams` — **nunca** pôr `exams` em `semLeituraDoPaciente` nem tirá-la do laço, o que apagaria a prova. Um `it` próprio semeia, como `nutri`, um exame **não** liberado de P2 e confere: P2 não o vê, vê o liberado e não vê `exam_interpretacoes` nem `exam_versoes` |

### 9.9 O que não muda

`patients`, `patient_cadastro`, `tenants`, `stored_files` (nenhum tipo novo; `paciente_arquivos` igual), `ia_tarefas`,
`exam_submissions`, `signed_document_notes` (nenhuma coluna nova) e os gatilhos `0091`, `0093`, `0105` (genéricos por
tipo, DEP-E6). `app_anonimizar_documentos` não muda.

---

## 10. LGPD e normas

| Tema | Tratamento |
|---|---|
| Natureza do dado | Exames, nota, solicitação e receita são dado de saúde (art. 5º, II) e prontuário (Res. CFN 594/2017, art. 5º, III: avaliação bioquímica). As bibliotecas do consultório (catálogo, modelos, itens salvos) não têm paciente; o aviso "Retire dados do paciente antes de salvar." cobre o texto livre de todas as bibliotecas (modelos de nota, de solicitação e de prescrição, e itens salvos), que não têm trilha, não entram na exportação e não são anonimizadas (art. 6º, III) |
| Base legal e finalidade | As de hoje do prontuário (art. 11, II, "a" e "f"). Nenhuma finalidade nova: o pedido de exames é ato da nutricionista (Lei 8.234/1991, art. 4º, VIII; Res. 306/2003; Res. 600/2018, Anexo, D.2.1) dentro da assistência |
| Compartilhamento com terceiro (farmácia, laboratório) | **Não há pela plataforma.** O titular compartilha o próprio PDF pelo aparelho (EP-D24); nenhum terceiro novo no termo ou no DPA. O PDF já traz o código e o QR, e a verificação pública não mostra dado de saúde (D8 do 10A). Se o dono quiser o envio direto, a lista de exigências está nas normas (P5: autorização por envio versionada, registro, link com prazo, termo e DPA, sem remuneração — art. 11, § 4º) |
| Acesso pelo titular (art. 18, II; art. 19) | "Mostrar no app" é uma via a mais, controlada pela nutricionista (EP-D22); a cópia "Baixar meus dados" já entregava os valores e passa a entregar a faixa, a marca de liberação, a nota e as versões anteriores do exame (EP-D19, EP-D41), a solicitação emitida e a fórmula. A nota é staff_only no app e **sai** na cópia: diferente das notas privadas (US-016), porque é a interpretação clínica do exame do próprio titular (prontuário, 594, art. 5º, III), no precedente da justificativa de uso (D15 = b do 10A); o comentário de `exportacao-job.ts:327` passa a citar a exceção, e o rótulo do campo diz isso à nutricionista |
| Minimização (art. 6º, III) | Indicação clínica opcional, vazia por padrão, impressa só se preenchida, com a linha fixa "Descreva a finalidade nutricional; não afirme doença."; o app mostra só a projeção fechada; a categoria e a nota nunca saem do painel |
| Não afirmar doença | (b) posição de prudência: a Lei 12.842/2013, art. 4º, I, foi vetada e o § 1º só define diagnóstico nosológico (Planalto, 17/11/2026); a spec de documentos (§3.1) adota não afirmar doença; o ato da nutricionista é o diagnóstico de nutrição (Res. 600/2018, Anexo I, XXXII). Na prática: sem "causas" da plataforma; nota na voz da nutricionista com a linha fixa; categorias sem nome de doença e sem "Desnutrição" até o CRN-4; aviso "Não é diagnóstico" no painel e no app; declaração da solicitação |
| Diagnóstico de nutrição (Res. 600/2018, Anexo I, XXXII) | Ato da nutricionista: a categoria só existe com a faixa que **ela** cadastra, com a fonte; o software compara, não diagnostica (pergunta 5 ao CRN-4) |
| Prescrição (Res. 656/2020 e 680/2021) | Itens salvos e modelos usam o mesmo Zod (vias, unidades, campos do art. 12); "Carregar" = salvar o rascunho com todas as conferências; habilitação em salvar, preparar e assinar para `fitoterapico` e `formula_fitoterapica`; termos de nutriente e de substância isolada barrados na fórmula fitoterápica, como conferência de apoio e não garantia, e a frase própria na declaração (680, art. 9º, II; RN-392); justificativa de uso nunca vem do modelo (656, art. 3º, XII); sem marca, fabricante ou farmácia (RN-151, D14; 680, art. 9º, III) |
| Não direcionar (Res. CFN 599/2018, art. 60, em vigor; Res. CFN 856/2026, art. 74, a partir de 23/01/2027, texto do DOU a conferir) | Nenhum campo de laboratório ou farmácia; nenhum cadastro de farmácias; o paciente escolhe |
| Assinatura (Lei 14.063/2020, arts. 13 e 14, conferidos no Planalto em 17/11/2026; Res. 760/2023, art. 10, DOU a conferir) | A solicitação tem o mesmo nível da receita (digitalizada com 2FA, código e QR; 10B depois). Fundamento: Res. 760/2023, art. 10, II ("assinados eletronicamente e/ou com código verificador", na telenutrição; DOU a conferir); no atendimento presencial, o CFN não tem regra de forma. O art. 14 da Lei 14.063 (validade "para todos os fins") só vale com assinatura avançada ou qualificada, ou seja, com o 10B; a regra "digitalizado ou com assinatura digital certificada" (656, parágrafo único-A; 680, art. 12, IV) é da receita, não da solicitação. "Exportar" só do assinado |
| Guarda e anonimização | Exames e notas: prontuário (20 anos, JUR-01), ficam na anonimização como `consultation_notes`; solicitação: `app_anonimizar_documentos` apaga conteúdo e PDFs, como a receita |
| Registro (art. 37) | Escritas por gatilho (`exams`, `exam_interpretacoes`, `exam_versoes`, `signed_documents`) e, na liberação e na retirada do app, `recordAudit` próprio (RN-385); leituras de um paciente com `auditRead` (detalhe, comparativo, portal, "Lançar resultados", PDFs); bibliotecas sem trilha (sem paciente) |
| Transparência ao titular (art. 9º) | Termo 1.0 cita "receitas e pareceres", não cita pedido de exame nem exame no app. O Plano 22 não sobe o termo nem pede aceite agora; o parágrafo do termo 1.1 está pronto no Anexo A, para a **versão única da onda 2** (com a F-D17 do Plano 20 e as fotos do Plano 21). O termo 1.1 segue a US-011: **novo aceite por consultório**, como o termo 1.0 promete no 1º parágrafo ("Se o termo mudar, você verá a nova versão e o aceite será pedido de novo.", `termo-paciente-textos.ts`; `termo-paciente.ts`; LGPD, art. 9º, § 2º). Dispensar esse aceite exigiria mudar a US-011 e o texto do termo, e fica com o advogado (EP-P2 (3)), não é decisão desta spec. Até lá, o exame só aparece no app por ato da nutricionista, e a confirmação diz a ela o que aparece (EP-D36) |
| DPA | Não muda: a cláusula 2 já cobre "exames" e "documentos assinados" e "as funções que a CONTROLADORA ativar" |
| IA | Nada novo (C-373, RN-399). Exame liberado não entra no contexto da IA Nutri (guarda de importação da RN-399: o contexto roda na sessão de paciente, que a política nova deixa ler o liberado); pergunta sobre exame continua indo à nutricionista (`sintoma_ou_exame`) |

---

## 11. Boas práticas SBIS NGS1

1. **Trilha** (NGS1.07): escrita de `exams` (edição, liberação), `exam_versoes`, `exam_interpretacoes` e documentos pelo gatilho;
   leituras com `auditRead` (RN-383, RN-384, RN-386, RN-390).
2. **Integridade** (NGS1.12): a solicitação herda a imutabilidade, as versões e o cancelamento dos documentos; a edição
   de exame guarda o estado anterior com justificativa (`exam_versoes`, NGS1.12.01) e tem concorrência otimista; a nota
   é só de inclusão; a classificação não é gravada como fato.
3. **Cópia, não referência**: documentos, exames e modelos guardam cópia do que veio do catálogo e dos modelos; mudar
   a biblioteca não reescreve o que foi emitido (RN-154).
4. **Controle de acesso** (NGS1.03): `staff_only` nas bibliotecas e na nota; política RESTRICTIVE para o app; sem papel
   novo.
5. **Autoria**: quem liberou ou retirou do app fica no `audit_log` com entidade própria ("Liberou exame no app",
   "Retirou exame do app", `recordAudit`, RN-385); quem escreveu cada versão da nota e quem alterou o exame ficam na
   própria linha (`criado_por`, `alterado_por`) e no `audit_log`.

---

## 12. Riscos

| ID | Risco | Mitigação |
|---|---|---|
| R-370 | Normas: categoria automática ("Deficiência", "Depleção") lida como diagnóstico feito pelo software; RDC 657/2022 | Só faixa do consultório com fonte, conjunto fechado sem doença nem "Desnutrição", aviso fixo, nunca no app nem no PDF; perguntas ao CRN-4 (5) e ao advogado (1) |
| R-371 | Formato de `exams.valores` com 8+ leitores | Só chaves opcionais (RN-376), `referencia` gerada da faixa; teste de cada leitor com linha antiga e nova; `campos-enviados.test.ts` sem categoria nova |
| R-372 | Edição × conferência da IA gravando `valores` ao mesmo tempo | Mesma ordem de travas (paciente → exame → tarefa) e `updated_at` comparado sob a trava; teste com duas transações |
| R-373 | RLS do paciente em `exams` hoje aberta | Política RESTRICTIVE no PR 1, antes de qualquer tela; fábrica de `exams` liberada + `it` próprio do não liberado (§9.8); paridade do "No app"; revisão do `revisor-rls` |
| R-374 | Tipo novo de documento e de item caindo no ramo "receita" (ternários binários, DEP-E7) | Tarefa de infraestrutura (T7) antes do editor; `switch` + `assertNever`; grep de `=== 'parecer'`, `=== 'receita'`, `?? 'receita'`, `TIPO_DOCUMENTO_ROTULO` e `TIPOS_ITEM` (sem confundir com `contents.tipo`); teste de retificação que conserva tipo e `orientacoesFormato` |
| R-375 | Worker antigo × PDF novo e volta atrás | Filas "-2" (EP-D34) e guarda de fonte; runbook "não voltar abaixo do PR 4 depois da primeira solicitação; se inevitável, desligar `documentos_liberados` antes; depois, reprocessar no worker novo as exportações concluídas no intervalo (ou segurar a fila `exportacao` até o worker novo subir)" no manual técnico (§4.5) |
| R-376 | XSS ou conteúdo ativo nas orientações | `lerMarcacao` puro, componentes, teste com marcação maliciosa no PDF e no portal (RNF-374) |
| R-377 | "Carregar modelo" pular conferência (habilitação retirada depois) | Carregar = salvar o rascunho pelo mesmo caminho (RN-394); preparo e assinatura conferem de novo |
| R-378 | `navigator.share` com arquivo sem suporte (desktop, alguns navegadores) ou com a ativação perdida depois do `fetch` | Dois passos (RN-396); download como alternativa; o E2E cobre o download |
| R-379 | Faixa do consultório aplicada a gestante | Aviso "As faixas do consultório não consideram gestação."; backlog depois do Plano 21 (fase da vida por avaliação) |
| R-380 | Mudança da D17 do Plano 12 sem o termo citar | Termo 1.1 único da onda 2 (Anexo A, EP-D36), com o aceite do 1.1 pela US-011; liberação só por ato da nutricionista, com confirmação; a exportação já entregava os valores |
| R-381 | Sugestão de faixa errada ("< 200" vira faixa fechada; valores de decisão clínica tratados como referência) | Só padrão único "a a b"; botão explícito; nada gravado sem "Salvar" (RN-377) |
| R-382 | Casamento ambíguo com o catálogo mostrando categoria errada | Nomes e outros nomes únicos (RN-371); casou com dois → sem categoria (RN-380); teste puro |
| R-383 | `updated_at` mexido ao liberar no app deixa o resumo da IA "desatualizado" e recusa edição aberta | RN-385 (não toca `updated_at`) + teste |
| R-384 | Nota de interpretação escrita como privada e entregue ao titular | Rótulo e ajuda honestos (US-373); EP-D19 registrada; comentário de `exportacao-job.ts` |
| R-385 | Plano 18 PR 2 atrasar | A T6 (PR 3) só começa com ele na `main`; os PRs 2 e 4 não dependem dele |
| R-386 | Rotas novas sem guia ou sem axe | T12: `e2e/painel-rotas.ts`, `rotas-axe.test.ts`, guias ou `SEM_AJUDA` |
| R-387 | Colisão de numeração com os Planos 21 e 23 | Bloco 370 (EP-D39); quem mescla depois renumera |
| R-388 | Escopo grande (12 tarefas, 4 PRs) numa onda com 3 sessões | Linha de corte: T9 e T10 (fórmula, marcação, itens salvos, modelos de prescrição) viram "Plano 22B" na onda 3 se a onda apertar, e as duas tabelas de prescrição (migration do PR 4) saem junto — a receita de hoje já funciona; o resto entrega PD-60 a 63, 66 e o "Mostrar no app" (EP-D38) |
| R-389 | Migrations em paralelo (Planos 18 PR 2, 19, 20 PR 2, 21, 23) | Nenhum número reservado; PR 1 pequeno; §5 a cada rebase; guarda do `_journal.json` (já na `main` pelo Plano 20) |
| R-390 | Edição de exame sem o estado anterior (o `audit_log` não guarda conteúdo, `0007`) | `exam_versoes` só de inclusão, justificativa, nome e valor da linha da IA fixos (EP-D41, RN-378) |

Também: CI em fila no runner único com três sessões; **não exigir snapshot** antes da migration em produção (o snapshot
da Hostinger congela a VPS); migration só aditiva e backup diário.

---

## 13. Conflitos com sessões paralelas

| Sessão | Worktree / branch | Arquivos e regras em comum | Como evitar |
|---|---|---|---|
| **Plano 18 PR 2** (onda 1) | `nutridebby-18` / `plano-18-pr2` | `noAppPor` e paridade RNF-263 b só existem no PR 2; RN-279 ("exames não têm `noApp`"); `ficha/tipos.ts` (`ChaveDeAcao`), `secoes/documentos.ts`, `secoes/exames.ts`, `ficha/textos.ts`; `patient_cadastro` (`identidade_genero`); disputados `lgpd.ts`, `exportacao-job.ts` (o PR 2 do 18 também mexe), `audit.ts`, `historico-acessos.tsx`, `ajuda/conteudo.ts`, `e2e/painel-rotas.ts`, `test/isolamento.test.ts`, `CLAUDE.md` | A T6 (PR 3) só começa depois do merge do PR 2; RN-279 v2 acrescentada ao fim da spec 18, sem editar a RN-279 (§6 do `sessoes-paralelas.md`); linha nova no fim de `ChaveDeAcao` e de `adicionar`; a categoria lê `patients.sexo`, nunca `identidade_genero` (EP-D13); disputados só com linhas novas |
| **Plano 19** (onda 1) | `nutridebby-b` / `plano-19-plano-alimentar-2` | `CARTOES` de Configurações e o guia `configuracoes` (8 → 9); `plano-pdf-2` em `queues.ts` e `worker/index.ts` (com guarda de fonte); `STAFF_ONLY`, `FABRICAS`, `schema/index.ts`; seed da USDA deixa o Testcontainers mais lento; RN-238 (sem perfil pronto) | Cartões no fim, depois do que estiver na `main`, e guia +1 a partir da versão da `main`; constantes `FILA_DO_PDF_DO_DOCUMENTO`/`FILAS_…` no mesmo molde, em linhas separadas; mesma regra da RN-238 (C-372); medir `pnpm test` depois do seed |
| **Plano 20 PR 2** (onda 1) | `nutridebby-c` / `plano-20-financeiro` | DPA 1.1; `lgpd.ts`, `exportacao-job.ts` (seção nova `financeiro` e o comentário "menos as staff_only"), `email/templates.tsx`, `navegacao.ts`; termo 1.1 (F-D17) | O 22 não muda DPA, e-mail nem menu; na exportação, só acrescenta chaves em `exames` e a inclusão explícita da nota, e ajusta o comentário de `:327` junto com o do 20 no rebase; termo pela EP-D36 |
| **Plano 21** (onda 2) | `nutridebby-21` (proposta) | Bloco de numeração (330–369); `stored_files_tipo_valido` e `armazenamento.ts` (fotos, anexos); termo (fotos do corpo); `exportacao-job.ts` e `lgpd.ts` (RN-352 e RN-353 do 21); fase da vida (gestante); a AF-D31 (versão com justificativa), molde da EP-D41 | Bloco 370 (EP-D39). **O 22 não toca a IA, `ia_tarefas`, `leitura-job.ts` nem `stored_files`**; a PD-44 foi para o 21B (onda 3, AF-D33): nenhuma dependência de IA entre 21 e 22. `exportacao-job.ts` e `lgpd.ts` só ganham linhas (§6). O único dado em comum é `exams.valores` (chaves opcionais), que o 21 não lê. Termo numa versão só (Anexo A), com novo aceite pela US-011. Gestação nas faixas fica para depois do 21 |
| **Plano 23** (onda 2) | `nutridebby-23` (proposta) | `CARTOES` ("Locais de atendimento") e o guia `configuracoes`; disputados de sempre | Quem entra depois sobe o guia de novo e põe os cartões no fim; nada fixa posição |
| Todas | — | `src/modules/plataforma/audit.ts` (quatro entradas novas em `ENTIDADE_ROTULO`: `exames_versoes`, `exames_nota`, `exame_no_app_liberado`, `exame_no_app_retirado`; `nomesDosAtores` nova no fim), `docs/manual-tecnico/README.md`, índice dos planos, `CLAUDE.md` (regras 1, 2, 8 e 9) | Só acrescentar frases "Plano 22: …" no fechamento, rebaseado |

**Para a orquestradora:** (1) confirmar o bloco 370 para o 22 (21 = 330–369, 23 = 400+); (2) criar **um** item de
backlog "Termo do paciente 1.1 da onda 2", com dono e prazo antes do fim da onda, juntando a F-D17 do Plano 20, as fotos
do Plano 21 e o Anexo A deste documento, com o novo aceite pela US-011 e a pergunta EP-P2 (3) ao advogado.

---

## 14. Decisões

### 14.1 Decisões delegadas pelo dono (onda 2: "seguir as recomendações")

Cada decisão é a recomendação da proposta, com as correções das normas e da crítica conferidas no código (§17). O dono
pode corrigir qualquer uma.

**Solicitação de exames**

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| EP-D1 | **A solicitação é um tipo novo de documento assinado** (`signed_documents.tipo = 'solicitacao_exames'`), com o mesmo nível de assinatura da receita (digitalizada com 2FA hoje, 10B depois), código e QR, entrega, recebimento, verificação, retificação, cancelamento e `documentos_liberados`. Custo assumido: a digitalizada pede imprimir, assinar e fotografar a cada pedido; no presencial, a via em papel assinada continua valendo ("Entregar pessoalmente"). Gatilho para rever: a pergunta 3 ao CRN-4 | O laboratório confere a autenticidade; Res. 760/2023, art. 10, II (código verificador; avançada ou qualificada é só preferencial; DOU a conferir); o art. 14 da Lei 14.063 passa a valer com o 10B (gov.br ou ICP-Brasil); a regra "digitalizado" da 656/680 é da receita, não da solicitação; a base do 10A está revisada e os gatilhos são genéricos por tipo; separar pedido de resultado não mexe nos leitores de `exams.valores` | RN-388, RN-389 |
| EP-D2 | **Título fixo "Solicitação de exames laboratoriais"; sem campo de laboratório, "laboratório parceiro" ou link** | Lei 8.234/1991, art. 4º, VIII, e Res. 306/2003 falam de exames laboratoriais; Res. 599, art. 60, e 856, art. 74 (ver §10), citam "laboratórios" | RN-388 |
| EP-D3 | **"Indicação clínica" opcional** (≤ 500, vazia por padrão, impressa só se preenchida, com a linha fixa "Descreva a finalidade nutricional; não afirme doença.") e **"Orientações ao paciente"** opcionais (≤ 1000, marcação) | Os planos de saúde pedem justificativa (FAQ do CFN); minimização (LGPD, art. 6º, III); a indicação vai ao laboratório, então vale o "não afirmar doença" | RN-388 |
| EP-D4 | **Aviso na tela e na ajuda, não no PDF:** "Planos de saúde podem recusar pedido de exame feito por nutricionista." | FAQ do CFN; Lei 9.656/1998, art. 12, I, "b" (redação da MP 2.177-44/2001: serviços de apoio diagnóstico "solicitados pelo médico assistente"), conferida no Planalto em 17/11/2026; o aviso é (b); evita frustração do paciente | US-377 |
| EP-D5 | **Modelos de solicitação do consultório** (nome, exames, orientações), sem indicação clínica e sem dado do paciente; a solicitação guarda **cópia**, sem FK para o modelo ou o catálogo | Imutabilidade (RN-140, RN-154); o modelo muda sem alterar o que foi assinado | RN-391 |
| EP-D6 | **Exame fora do catálogo** (texto ≤ 80) aceito; **até 40 exames** por solicitação; um painel conta como um | O catálogo nunca cobre tudo; teto contra abuso e para o PDF caber em duas páginas | RN-388 |
| EP-D7 | **"Lançar resultados"** na solicitação assinada abre o "Novo exame" com as linhas dos exames pedidos (cópia, sem FK) | É o elo entre os "dois tipos" do Dietbox (solicitação e análise); sem FK, nenhum leitor muda | RN-390 |

**Catálogo, classificação, nota, comparativo e app**

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| EP-D8 | **Catálogo do consultório**, `staff_only`. A plataforma traz só **nomes** de exames laboratoriais ("Nomes de exames para começar (você escolhe o que usar)"): os 14 grupos de `SINONIMOS` e os componentes do hemograma, **sem unidade, faixa ou nota**, sem testes sem respaldo científico, rascunho para a Debby; só entra o que a nutricionista marcar | O Dietbox tem "lista de exames"; nome não é texto clínico; a unidade (ng/mL × nmol/L) seria escolha da plataforma; Res. CFN 306/2003, art. 2º, parágrafo único, V | RN-371, RN-372 |
| EP-D9 | **Painel** no catálogo ("Exames que compõem este", 2 a 30 nomes, um nível): na solicitação sai como um exame; na análise vira uma linha por componente | O pedido é "Hemograma completo", o laudo tem ~20 linhas; sem isso, o CS-371 pediria 20 escolhas a cada exame | RN-373 |
| EP-D10 | **A linha livre continua**: exame e solicitação aceitam nome fora do catálogo | Laudo traz marcador que o catálogo não tem; não perder o que a IA lê | RN-376, RN-388 |
| EP-D11 | **Classificação em dois níveis, calculada na leitura, nunca gravada**: (1) neutra contra a faixa numérica **da linha** (do laudo); (2) categoria do consultório só com faixa cadastrada pela nutricionista, com fonte; aviso "Não é diagnóstico." | Normas P4: a referência certa é a do laudo; "não gravar como fato"; sem migration de dados | RN-379 a RN-381 |
| EP-D12 | **Categorias de um conjunto fechado, sem nome de doença e sem "Desnutrição"**: "Depleção leve/moderada/grave" no lugar, até a pergunta 5 ao CRN-4 | Diagnóstico de nutrição é da nutricionista (Res. 600, Anexo I, XXXII); o critério de consenso para desnutrição (GLIM, Cederholm et al., *Clin Nutr* 2019) pede critério fenotípico e etiológico, não um marcador; "depleção" é a nomenclatura clássica das tabelas de proteínas séricas (a conferir pela Debby) | RN-381 |
| EP-D13 | **Sexo do cadastro (`patients.sexo`), nunca a identidade de gênero**; idade em anos completos **na data do exame**; sem sexo, sem nascimento ou com menos de 1 ano → sem categoria; sem gestação | Dado que existe; faixas de referência são por sexo biológico; só adultos (RN-17); o Plano 21 cria a fase da vida | RN-380 |
| EP-D14 | **Casamento único**: nome e outros nomes normalizados únicos no consultório; se a linha casar com dois, sem categoria | Categoria errada é pior que nenhuma | RN-371, RN-380 |
| EP-D15 | **`refMin`/`refMax` como chaves opcionais** da linha; sem texto, grava-se a `referencia` gerada da faixa; com texto diferente, aviso sem bloquear | Nenhum dos 8+ leitores muda (parecer, app e exportação leem `referencia`) | RN-376 |
| EP-D16 | **Sugestão de faixa só com um padrão único "a a b", por botão** ("Usar {a} a {b}"); nada com `<`, `>` ou várias faixas | Valores de decisão clínica (lipídios) não são intervalo de referência; a nutricionista confirma (§5.11 da spec da IA); um ato explícito, não um preenchimento escondido | RN-377 |
| EP-D17 | **"REF" por linha**, só no painel: referência do laudo, faixa do laudo e faixas do consultório com fonte e data | Função do Dietbox; mostra de onde vem cada classificação | RN-382 |
| EP-D18 | **"Ver causas" vira "Nota de interpretação"**: uma por exame, da nutricionista, com modelos dela por exame e sentido; a plataforma não traz texto e não usa IA; linha fixa "não afirme doença" acima do campo e no modelo | (b) posição de prudência: a Lei 12.842/2013, art. 4º, I, foi vetada e o § 1º só define diagnóstico nosológico; a spec de documentos (§3.1) adota não afirmar doença; o ato da nutricionista é o diagnóstico de nutrição (Res. 600/2018, Anexo I, XXXII); A-D17 e D7 do 10A; política de uso da Anthropic (interpretar exames é *High-risk*); RDC 657 a conferir | RN-375, RN-383 |
| EP-D19 | **A nota vai à cópia do titular** (`dados.json`, dois escopos), nunca ao app ou ao PDF; o campo diz isso ("Não aparece no app; entra na cópia dos dados que o paciente pedir.") | É prontuário (594, art. 5º, III), não nota privada (US-016); precedente da justificativa de uso (D15 = b do 10A); um rótulo "só a equipe vê" seria promessa falsa | RN-383, RN-399 |
| EP-D20 | **Comparativo na aba Exames**: tabela marcador × datas, 2 a 6 exames, classificação neutra por célula, unidades diferentes em linhas separadas, leitura auditada | A Evolução já tem o gráfico; a tabela é a função que falta; mesma regra de unidade das normas P4 | RN-384 |
| EP-D21 | **Editar exame** com concorrência otimista por `updated_at`, a mesma ordem de travas da conferência da IA e o **estado anterior guardado** (EP-D41) | O exame aceito do app nasce sem valores; SBIS NGS1.12; a conferência já atualiza `updated_at` (`conferencia.ts:164`) | RN-378 |
| EP-D22 | **"Mostrar no app" por exame, desligado por padrão**, só a nutricionista liga; o paciente vê título, data, valores, unidade, referência e "Fora da referência", com aviso; **nunca** nota, categoria, marca da IA ou laudo; política RESTRICTIVE; `auditRead`; não toca `updated_at`. **Muda a D17 = a do Plano 12 e a US-044 só para os exames marcados**, e a RN-279 do 18 ganha a v2 | Normas P7 (nenhuma norma impede; risco de autodiagnóstico controlado pelo aviso e pela escolha da nutricionista); a RLS de hoje deixaria o paciente ler tudo; origem IA fora do app pelo precedente da Q13-2 = (a) do Plano 13 — a mesma resposta do CRN-4 sobre o art. 37 da Res. 856/2026 (P-B1/P-B11) reabre também a projeção do app (`fora`, `iaTarefaId`) | RN-385, RN-387 |
| EP-D23 | **`/p/exames` ganha "Resultados liberados"**; o item "Exames" do app aparece com o recebimento ligado, **ou** com envio visível (RN-192), **ou** com exame liberado, nos dois pontos de chamada (moldura e Hoje) | Lugar natural ("Meus exames"); sem rota nova no app | RN-386 |

**Prescrição**

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| EP-D24 | **Sem cadastro de farmácias e sem envio pela nutricionista ou pela plataforma.** O paciente compartilha o próprio PDF assinado | Res. 599, arts. 20 e 60 (em vigor); 856, arts. 23 e 74 (ver §10); LGPD, arts. 11, § 4º, e 18, VII; RN-151/D14; custo zero; nenhum terceiro novo no termo ou no DPA | RN-396, §10 |
| EP-D25 | **"Compartilhar" em dois passos, com texto por tipo, só no documento assinado em vigor**; conferência do `application/pdf`; download como alternativa | O compartilhar do aparelho exige toque recente (o Safari perde a ativação depois de um `fetch` longo); "à farmácia" não serve ao parecer; a versão substituída não deve circular | RN-396 |
| EP-D26 | **Tipo novo de item `formula_fitoterapica`** (2 a 10 compostos vegetais), **só com habilitação**, por uma função única `exigeHabilitacao(tipo)` usada no Zod, no preparo e na assinatura | Função "manipulado por compostos" dentro da Res. 680 (arts. 3º, II, e 12, I); hoje a conferência só olha `'fitoterapico'` e a fórmula passaria na assinatura | RN-392 |
| EP-D27 | **Conferência de apoio contra nutriente ou substância isolada na fórmula fitoterápica** (não é garantia; a responsabilidade é da nutricionista): binômio botânico (aceita autor, "var.", "×") e lista fechada de termos barrados na nomenclatura (o derivado ficou de fora no code review do PR 1, RN-392) (sais, substâncias isoladas comuns em nutrição, gêneros de probióticos e leveduras), rascunho para a Debby; frase própria na declaração da receita com fórmula | Res. 680, art. 9º, II (exclui vitaminas, minerais, aminoácidos e substâncias ativas isoladas ou altamente purificadas, e as associações delas; site do CFN, 17/11/2026); o caminho comum é o sal mineral ou a substância isolada de nome comum (creatina, curcumina), não a palavra "mineral"; fonte do binômio: Código Internacional de Nomenclatura para algas, fungos e plantas | RN-392 |
| EP-D28 | **O suplemento manipulado continua** o item `suplemento` com "Manipulado" e composição de 1 a 10 | "Um tipo só por fórmula" (normas D5); a dúvida do derivado vegetal no suplemento fica com o CRN-4 (pergunta 2) | RN-392 |
| EP-D29 | **Itens salvos** com o mesmo Zod do item, sem marca, fabricante ou farmácia; habilitação do **consultório**; "Adicionar item salvo" copia | RN-151/D14; a receita continua imutável (sem FK); a habilitação é de `tenants` | RN-393 |
| EP-D30 | **Modelos de prescrição** (itens + orientações), sem justificativa e sem dado do paciente; "Carregar" = validar e gravar o conteúdo da tela com o modelo pelo mesmo caminho, tudo ou nada, devolvendo o gravado (RN-394) | Normas D6; a justificativa é individual (656, art. 3º, XII); um modelo salvo por quem tinha habilitação não passa a receita de quem não tem | RN-394 |
| EP-D31 | **Orientações com marcação mínima** (parágrafo, lista, negrito), lida por função pura, montada em componentes, nunca HTML; receita e solicitação; `orientacoesFormato` no conteúdo novo | XSS; PDF sem conteúdo ativo (normas P2); o texto rico não substitui os campos normativos | RN-395 |
| EP-D32 | **Sem título livre, sem "nome interno" e sem data editável** nos documentos; "Exportar" = baixar o PDF assinado (já existe, `caminhoDoPdfNoPainel`); o rascunho não gera PDF baixável | O título é o tipo; data retroativa em documento assinado é risco; um nome livre seria dado de saúde na lista e na seção do Início, que por desenho não chamam `auditRead` (D17 do 10A), e mexeria em `signed_document_notes`, que tem gatilho de imutabilidade; tipo + data + situação bastam ao volume de um consultório (crítica F4, rejeitada) | §2.2 |

**Arquitetura e entrega**

| ID | Decisão | Porquê | Onde |
|---|---|---|---|
| EP-D33 | **Dois cartões em Configurações, no fim** ("Exames"; "Prescrição", só com documentos liberados), guia `configuracoes` +1 a partir da versão da `main`; **nenhum item de menu, nenhuma aba nova na ficha** | O hub cresce com os Planos 19 e 23; a ficha não cabe 14 abas (R-266 do 18) | §4.1 |
| EP-D34 | **Infraestrutura do tipo novo antes do editor** (`switch` + `assertNever`, `conteudoVazio`, `semCopia` completa) e **filas `documento-pdf-2` e `documento-digitalizado-2`** com guarda de fonte | Os ternários de hoje mandariam a solicitação ao ramo da receita (DEP-E7); o worker antigo geraria título `undefined` na digitalizada (`digitalizada-job.tsx:92`); molde do `plano-pdf-2` (R-244 do 19) | RN-397, §4.5 |
| EP-D35 | **O que depende de `documentos_liberados`**: solicitação, "Lançar resultados", receita, itens salvos e modelos de prescrição. **Não dependem**: catálogo, faixas, modelos de nota e de solicitação, classificação, nota, comparativo, edição e "Mostrar no app" | Os primeiros só existem com documentos; os outros são da ficha (e os modelos de solicitação servem também à análise) | RN-398 |
| EP-D36 | **O Plano 22 não sobe o termo nem pede aceite agora**: o parágrafo do termo 1.1 fica pronto (Anexo A) para a versão única da onda 2. O termo 1.1 segue a US-011: **novo aceite por consultório**, como o termo 1.0 promete no 1º parágrafo. Dispensar esse aceite exigiria mudar a US-011 e o texto do termo, e fica com o advogado (EP-P2 (3)), não é decisão desta spec. A orquestradora cria o item com dono e prazo; até lá, a confirmação do "Mostrar no app" informa a nutricionista | Normas §3: o parágrafo é (b), sem terceiro novo, e a questão do aceite fica com o advogado; a F-D17 do Plano 20 adia a mudança do termo, não dispensa o aceite; o 1º parágrafo do termo 1.0 (`termo-paciente-textos.ts`) e `termo-paciente.ts` (US-011) prometem o novo aceite (LGPD, art. 9º, § 2º); uma versão só evita dois aceites. Fontes conferidas no código do worktree `nutridebby-22` em 17/11/2026 | §10, §13 |
| EP-D37 | **Sem IA nova**; exame liberado fora da IA Nutri; `campos-enviados.ts` intacto; guarda de importação e de texto para a nota | D7 do 10A; A-D17; RN-172 | RN-399 |
| EP-D38 | **Quatro PRs, 12 tarefas**: PR 1 fundação (as migrations dos exames; as duas tabelas de prescrição vão numa migration própria no PR 4, com a T10); PR 2 exames; PR 3 app (espera o 18 PR 2); PR 4 documentos. Linha de corte: T9 e T10 viram "Plano 22B" se a onda apertar, e as duas tabelas de prescrição saem com elas | `sessoes-paralelas.md` §7 (fundação primeiro, uma migration na fila por vez); a receita de hoje já funciona | §15 |
| EP-D39 | **Numeração no bloco 370** (US-370..381, RN-370..399…) e prefixo "EP-D" | 21 = 330–369, 23 = 400+; convenção de um bloco por plano | Cabeçalho |
| EP-D40 | **Sem lembrete criado a partir da posologia** | Reabriria a NORMAS-DECISAO-2 do Plano 17 (lembrete de suplemento sem vínculo com a receita) | §2.2 |
| EP-D41 | **Exame editável com versão; nota só de inclusão.** `exam_versoes` (só inclusão, `staff_only`, auditada) guarda o estado de antes de cada edição, com justificativa (opcional só na edição que só acrescenta linhas); "Versões anteriores" com `auditRead`; `iaTarefaId` copiado só no servidor pelo índice da linha (nunca do formulário), e a linha da IA tem nome e valor fixos; cada "Salvar nota" e "Apagar nota" grava uma versão nova de `exam_interpretacoes`. A exclusão do exame continua física, como hoje (US-015) | O `audit_log` não guarda conteúdo (`0007`), e editar no lugar perderia o valor laboratorial anterior, que é prontuário; a spec da IA (§ integridade, item 2: "as linhas que já existiam não mudam: só se acrescenta", NGS1.12.01) e a AF-D31 do Plano 21, na mesma onda, decidiram assim; meta SBIS do dono | RN-378, RN-383, §9.5, §9.5a |
| EP-D42 | **Componente `Dialogo` novo na T2** (PR 1), sobre `<dialog>` + `showModal()`, com variante de confirmação, usado em todos os diálogos e confirmações com rótulos próprios | Não há componente de diálogo no painel (só `<dialog>` escrito à mão no Adicionar da ficha, no tour e na gaveta); `ConfirmarBotao` usa `window.confirm`, que não aceita "Remover"/"Cancelar"; um por tarefa daria foco, `Esc` e retorno do foco diferentes | §4.2, §7 |
| EP-D43 | **"Compartilhar com o paciente" do PD-66 = a entrega que já existe** (portal, link com código, pessoalmente; RN-152 a RN-158), sem mudança | A função já está na plataforma; o que faltava era o paciente passar o PDF adiante (EP-D25) | E-12 |
| EP-D44 | **Anexar ou trocar o laudo de um exame existente fica fora**; o laudo entra na criação (inclusive em "Lançar resultados") | A troca pediria `apagarArquivo` + `salvarArquivo` numa transação com a edição (regra 9) e a versão do laudo (EP-D41); não há pedido | §2.2 |

### 14.2 Decisões vigentes que o Plano 22 toca (não reabrir sem citar)

- **D17 = a do Plano 12 e US-044** (o paciente não vê exames): mudadas pela EP-D22 **só** para os exames marcados; o
  laudo continua fora.
- **RN-279 do Plano 18** ("exames da nutricionista não têm `noApp`"): v2 pela EP-D22, acrescentada ao fim da spec 18.
- **RN-151 e D14 do 10A** (sem marca, fabricante ou farmácia): valem para itens salvos e modelos e são a razão da EP-D24.
- **§2.2 do 10A** ("catálogo de suplementos ou de plantas" e "integração com farmácias" fora): o catálogo era escopo, não
  decisão, e entra pela EP-D29; a integração com farmácias continua fora.
- **D3 do 10A** (nunca PDF anexo em e-mail): nada é enviado pela plataforma.
- **D7 do 10A e A-D17** (sem IA nos documentos e sem IA comentando exames): EP-D18, EP-D37.
- **D15 = b do 10A** (justificativa fora do portal, dentro da cópia): precedente da EP-D19.
- **D2 = a do Plano 13** (mesmo nível de assinatura): base da EP-D1.
- **D6 do 10A** (habilitação em Fitoterapia por autodeclaração do consultório): EP-D26, EP-D29.
- **RN-238 do Plano 19** (a plataforma não traz perfil pronto): C-372.
- **NORMAS-DECISAO-2 do Plano 17**: EP-D40.
- **Spec da IA, § integridade, item 2** ("as linhas que já existiam não mudam: só se acrescenta", NGS1.12.01): a edição de
  exame não apaga o estado anterior, que vai para `exam_versoes` (EP-D41).
- **AF-D31 do Plano 21** (avaliação editável com versão e justificativa): molde da EP-D41.
- **Q13-2 = (a) do Plano 13** (origem IA fora do PDF do parecer): precedente da projeção do app sem `iaTarefaId` (EP-D22).
- **US-011** (novo aceite a cada versão do termo): vale para o 1.1 (EP-D36).

### 14.3 Pendências externas ★ (não travam a v1)

| ID | Para quem | Pergunta | Efeito se a resposta for outra |
|---|---|---|---|
| EP-P1 ★ | CRN-4 (acrescentar à P-B1) | (1) Exame de imagem ou de composição corporal (densitometria, ultrassom) pode ser solicitado? (2) Suplemento manipulado pode levar derivado vegetal "classificável como suplemento" junto de vitaminas e minerais, ou cai no art. 9º, II? (3) A solicitação assinada como digitalizada ou pelo gov.br atende? A opção só com 2FA e código atenderia? (4) Cadastro de farmácias com envio à farmácia escolhida pelo paciente fere o art. 60/74? (5) Rótulo automático "Deficiência"/"Depleção"/"Desnutrição" por faixa que a nutricionista definiu é aceitável como apoio ao diagnóstico de nutrição? (com a lista inteira de `CATEGORIAS_DO_CONSULTORIO`, RN-381) (6) Valores lidos pela IA e conferidos, mostrados no app sem a marca da origem, alcançam o art. 37 da Res. 856/2026? (com o parecer e o plano criado de modelo da IA) | (1) título e catálogo; (2) Zod do suplemento; (3) assinatura mais leve; (4) PD-66 volta como plano próprio; (5) volta "Desnutrição" ou some a categoria; (6) a projeção do app ganha a origem (EP-D22) |
| EP-P2 ★ | Advogado (E-09) | (1) Classificação automática e faixas do consultório enquadram o software na RDC 657/2022 (com a R-166)? (2) Mostrar exames no app: algum cuidado além do aviso? (3) O 1.1 pode dispensar o novo aceite, dado o 1º parágrafo do 1.0 ("o aceite será pedido de novo")? Se puder, como fica a US-011? | Ajuste de textos; em (1), a categoria pode virar só exibição da faixa sem rótulo |
| EP-P3 ★ | Debby | Nomes para começar e o hemograma (RN-372); categorias (RN-381); declaração da solicitação (§6.2); termos barrados (RN-392); textos do manual guiado | Só constantes e texto |
| EP-P4 ★ | Normas a conferir | Res. 760/2023 no DOU; RDC 657/2022; RDC 978/2025 (o laudo traz a referência?); redação do inciso IX da Res. 656 ("U" ou "U/UI" para enzima) antes de fechar as unidades do item salvo | Unidades e textos |
| EP-P5 ★ | Correção em outra spec | Spec de documentos (§3.4 e §12): os arts. 13 e 14 da Lei 14.063 foram conferidos no Planalto em 17/11/2026; o "a conferir no Planalto" pode sair (no fechamento, só acrescentar) | — |

---

## 15. Pontos para o plano (PM)

| ID | Ponto |
|---|---|
| PM-E1 | **T1 — Banco** (PR 1): `exames_catalogo`, `exames_modelos_solicitacao`, `exam_interpretacoes` e `exam_versoes` (as duas só de inclusão), `exams.mostrar_no_app_em`, CHECKs de tipo, custom `rls_exames_catalogo` com a política `paciente_exame_liberado` (formato da 0123); `STAFF_ONLY`, `FABRICAS`/`COM_MAE`/`SO_INSERE`, fábrica de `exams` liberada + `it` próprio do não liberado, `banco.test.ts` de `exam_interpretacoes` e `exam_versoes` (políticas, cascata, 42501 do DELETE, `pg_policies`); schema e tipos (`refMin`/`refMax` no tipo de `valores`). Regenerar sobre a `main` (§5). Revisor: `revisor-rls` |
| PM-E2 | **T2 — Regras puras** (PR 1): `classificacao.ts` (neutra, categoria, idade, `sugerirFaixa` restrita, `referenciaDaFaixa`, `casarComCatalogo` com ambiguidade), `marcacao.ts`, Zod das faixas, da solicitação e da fórmula (binômio, termos barrados), `exigeHabilitacao` (em `prescricao.ts`, puro); o `Dialogo` (`src/components/dialogo.tsx`, EP-D42) com teste unitário e axe nos dois modos; só funções, o componente e testes |
| PM-E3 | **T3 — Catálogo e modelos de solicitação** (PR 2): módulos, telas `/painel/exames/…`, cartão "Exames", "Nomes de exames para começar" (constante rascunho), painéis, faixas, modelos de nota; unicidade sob trava. Revisores: `revisor-interface`, `normas-cfn-lgpd` (constantes) |
| PM-E4 | **T4 — Lançar e editar** (PR 2): `lerValores` com faixa e `referencia` gerada, `editarExame` (travas, `updated_at`, estado anterior em `exam_versoes`, justificativa, `origem` no lugar de `iaTarefaId`), "Versões anteriores", formulário com "Adicionar do catálogo", "Selecionar todos", painel, "Carregar modelo de solicitação", "Remover todos", "Usar {a} a {b}", classificação neutra ao vivo; teste de cada leitor de `valores` com linha antiga e nova. Revisor: `revisor-rls` (travas), `revisor-interface` |
| PM-E5 | **T5 — Categoria, REF, nota e comparativo** (PR 2): detalhe do exame (`abrirExame` com `auditRead`), categoria do consultório, REF, nota (só de inclusão, rótulo honesto, "Inserir modelo"; teste: paciente bloqueado ou anonimizado recusa a nota), comparativo; guarda da IA (RN-399). Revisores: `normas-cfn-lgpd`, `revisor-interface` |
| PM-E6 | **T6 — Mostrar no app** (PR 3, **depois do merge do Plano 18 PR 2**): `mostrarNoApp`/`retirarDoApp` sem `updated_at` e com `recordAudit` próprio (rótulos novos), portal "Resultados liberados", menu do app (`examesVisiveis` com o terceiro termo em `moldura.ts` e `hoje.ts`; teste das quatro combinações), "Meus exames enviados" escondido sem recebimento e sem envio, `noApp` da seção, paridade, RN-279 v2 no fim da spec 18. Revisores: `revisor-rls`, `revisor-interface` |
| PM-E7 | **T7 — Infraestrutura do tipo novo** (PR 4): `tipos-de-documento.ts`, todos os ternários da DEP-E7 em `switch`/`assertNever` (inclusive `digitalizada-job.tsx:29`), `semCopia` completa, `exigirHabilitacaoAtual` por `exigeHabilitacao`, filas "-2" com guarda de fonte, rótulo na verificação, `lgpd-documentos.ts`, teste de retificação (tipo e `orientacoesFormato`). Revisor: `revisor-rls` |
| PM-E8 | **T8 — Solicitação** (PR 4): `solicitacao.ts`, editor, declaração, corpo do PDF, Adicionar na ficha (`criar-solicitacao` em `ficha/tipos.ts`, `inicio/acoes.ts`, `criarSolicitacaoAction` em `documentos/actions.ts`, `MSG_FICHA.itens.solicitacao` em `ficha/textos.ts`, cenário da solicitação em `no-app.test.ts`), "Lançar resultados", a tela somente leitura do documento emitido no painel (cartões "Exames solicitados", "Indicação clínica", "Orientações"). Revisores: `normas-cfn-lgpd`, `revisor-interface` |
| PM-E9 | **T9 — Receita** (PR 4): `formula_fitoterapica` no formulário, na página do documento no painel, no PDF e na exportação (`descreverItem` exaustivo; a verificação só mostra o rótulo do tipo, D8); ajuda do seletor e textos `dicaOutro`/`semHabilitacao`; frase da declaração com fórmula; marcação nas orientações (editor com prévia, PDF, página do documento no painel; o portal e o link continuam só com o PDF, D17 do 10A) para receita e solicitação; teste das chaves de `documentosDoPaciente` e de `verificacao.ts`; teste de marcação maliciosa. Revisor: `normas-cfn-lgpd` |
| PM-E10 | **T10 — Itens salvos e modelos de prescrição** (PR 4): `modelos.ts`, telas `/painel/prescricao/…`, cartão "Prescrição", "Salvar item", "Adicionar item salvo", "Salvar como modelo", "Carregar modelo" com o conteúdo da tela, pelo caminho de `salvarRascunho`, devolvendo o gravado (teste: digitar um item, carregar modelo, ver os dois na tela); editar e excluir com confirmação; listas vazias; `notFound()` sem `documentos_liberados`; a migration das duas tabelas de prescrição (custom `rls_prescricao_modelos`). Revisor: `revisor-interface` |
| PM-E11 | **T11 — Compartilhar** (PR 4): componente cliente em `/p/documentos` e na página do link, dois passos com os estados da RN-396 (andamento, foco, região de status, `AbortError`), texto por tipo, `tipoDoc` em `estadoDoLink`, só o em vigor, 303 do link tratado; E2E do download. Revisor: `revisor-interface` |
| PM-E12 | **T12 — Fechamento** (PR 4, e partes nos PRs 2 e 3 quando a tarefa entrar): exportação (nota, `mostradoNoAppEm`, solicitação; comentário de `exportacao-job.ts:327`), manual técnico, Central de Ajuda e manual do usuário (`guardiao-manual`), guias novos e passos (`exames-do-consultorio`, `prescricao`, `prontuario`, `configuracoes`, `documentos` v3 e o do portal `portal-novidades` v4, com os pins de `conteudo.test.ts` e `portal.test.ts` atualizados na mesma tarefa do bump, sem a palavra "documento" no texto novo do `prontuario`; `src/modules/exames` em `TSX_FORA`; `data-guia` de cada passo novo na tela; uma linha "Plano 22: guia X na vY" por guia na §5.8.1 do cap. 05 do manual), `e2e/painel-rotas.ts` e axe, E2E dos CS, CLAUDE.md (regras 1, 2, 8 e 9: frases "Plano 22: …"), Anexo A no backlog do termo 1.1, runbook da volta atrás (R-375) |
| PM-E13 | A exportação (nota e chaves novas) entra **no mesmo PR** da primeira escrita: a nota, as versões do exame e `refMin`/`refMax` no PR 2; `mostradoNoAppEm` no PR 3; solicitação e fórmula no PR 4 (sem janela em que um dado novo existe e a cópia do titular não o leva) |
| PM-E14 | Cada PR com tela nova leva a sua parte do guia e de `e2e/painel-rotas.ts` (a guarda `rotas-axe.test.ts` quebra o CI na própria tarefa). Os ids novos (exame, item do catálogo, modelo de solicitação, item salvo, modelo de prescrição) entram em `IdsDoPainel`/`prepararTelasComId`, criados pelo caminho real da UI; o `e2e-seed` ganha um exame liberado; uma spec de axe cobre os estados que não são rota (RNF-372) |
| PM-E15 | Agentes nas revisões: `revisor-rls` (T1, T4, T6, T7), `normas-cfn-lgpd` (T3, T5, T8, T9, T12), `revisor-interface` (T3–T6, T8, T10, T11), `guardiao-manual` (T12) |
| PM-E16 | O plano tem de 8 a 12 tarefas e termina com "Coordenação" e "Decisões" (briefing da onda 2); a numeração das tarefas é P22-01 a P22-12 |

---

## 16. Referências

- Insumos da onda 2: `.sessoes/onda2-briefing.md`; `onda2/p22/levantamento.md`, `normas.md`, `proposta.md`,
  `critica.md`, `critica-respostas.md` (17/11/2026).
- Código (`main` 6c3ee8f): `src/db/schema/pacientes.ts`, `src/db/schema/documentos.ts`, `src/db/schema/platform.ts`,
  `src/modules/pacientes/exames.ts`, `src/modules/ia/conferencia.ts`, `src/modules/ia/correspondencia.ts`,
  `src/modules/ia/resumo-dados.ts`, `src/modules/documentos/{prescricao,constantes,documentos,retificacao,registrar-assinatura,documento-pdf,digitalizada-job,link-documento,lgpd-documentos,parecer}.ts(x)`,
  `src/jobs/queues.ts`, `src/worker/index.ts`, `src/modules/ficha/{tipos,secoes/exames,secoes/documentos}.ts`,
  `src/app/painel/configuracoes/page.tsx`, `src/app/p/navegacao.ts`, `src/modules/pacientes/exportacao-job.ts`,
  `src/db/rls-guard.ts`, `drizzle/0030`, `0091`, `0093`, `0102`, `0104`, `0105`.
- Onda 1: `nutridebby-18` (`secoes/comum.ts`, spec 18 D16, RN-279, RN-281, R-266), `nutridebby-b` (`queues.ts:106-108`,
  `worker/index.ts:214`, spec 19 RN-238, R-244), `nutridebby-c` (spec 20, F-D17).
- Lei 8.234/1991, art. 4º, VIII; Lei 12.842/2013, art. 4º, I (vetado) e § 1º; Lei 9.656/1998, art. 12, I, "b" (redação da MP 2.177-44/2001); Lei 14.063/2020, arts. 13 e 14; LGPD, arts. 5º, 6º,
  7º, 9º, 11, 18, 19 e 37 (Planalto, conferidas em 17/11/2026).
- Res. CFN 306/2003, arts. 1º e 2º; 594/2017, arts. 3º e 5º; 599/2018, arts. 20 e 60; 600/2018, Anexo D.2.1, D.2.2 e
  Anexo I, XXXII; 656/2020 (redação da 731/2022); 680/2021 (com a 688/2021 e a 731/2022), arts. 3º, 9º e 12 (site do CFN,
  17/11/2026); 856/2026, arts. 22, 23 e 74 (compilação não oficial, LegisWeb; vigência em 23/01/2027 pela Res. 858/2026).
- Cederholm T. et al. GLIM criteria for the diagnosis of malnutrition. *Clin Nutr* 2019 (EP-D12).
- Código Internacional de Nomenclatura para algas, fungos e plantas (EP-D27).
- SBIS — Manual de Certificação para S-RES, NGS1 (NGS1.03, NGS1.07, NGS1.12).

---

## 17. Registro das lentes (v0.1, 17/11/2026)

Lentes antes desta versão: levantamento do código (sessão B), normas (`normas-cfn-lgpd`) e crítica adversarial de
completude, cada achado conferido no código da `main` 6c3ee8f e nos worktrees da onda 1. O que a crítica mudou na
proposta:

| Achado | O que mudou |
|---|---|
| Numeração colidia com o Plano 21 (bloco 340) | Bloco 370 (EP-D39) |
| Ternários binários de tipo e a fila da digitalizada | Tarefa de infraestrutura (T7), `exigeHabilitacao`, duas filas "-2" (EP-D34, RN-397) |
| Nota "só a equipe vê" × exportação | Rótulo honesto e a EP-D19 com o porquê (RN-383) |
| Escopo em 11 tarefas, sem "adicionar todos" nem elo solicitação → análise; CS-341 contraditório | 12 tarefas em 4 PRs; "Selecionar todos", "Carregar modelo de solicitação" na análise, "Lançar resultados" (EP-D7), CS-371 reescrito |
| "Desnutrição" automática; sugestão de faixa com "<" | "Depleção" (EP-D12); padrão único e botão (EP-D16) |
| REF, compartilhar por tipo, "Exportar" no painel | EP-D17, EP-D25, EP-D32 |
| `updated_at` na liberação; ordem de travas; faixa sem texto; casamento ambíguo; identidade de gênero; indicação clínica; termo sem dono; CS-373; documento substituído; custo da digitalizada | RN-385, RN-378, RN-376, EP-D14, EP-D13, EP-D3, EP-D36, CS-373, RN-396, EP-D1 |
| RLS, laudo, cascata, CHECK do jsonb, sem semente, unidades da lista, filtro do `noApp`, habilitação do tenant | §9.7, RN-385, §9.8, §9.1, RN-372, EP-D8, RN-387, EP-D29 |
| Conflitos (21 sem dependência do 22 na IA; cartões; RN-279 sem edição no lugar; volta atrás) | §13, §4.5, R-375 |
| Detalhes técnicos (compartilhar em dois passos; binômio; idade em anos) | RN-396, RN-392, RN-380 |

Acréscimo desta spec, fora da crítica: o **painel** no catálogo (EP-D9), para o CS-371 caber em uma escolha sem
semear modelo pela plataforma. Rejeitado da crítica (uma linha cada, em `critica-respostas.md`): o "Nome interno" da
receita (F4, EP-D32); e, como ajuste, os modelos de solicitação na T3 em vez da T10 (servem à análise e não dependem de
`documentos_liberados`, EP-D35).

---

## Anexo A — Parágrafo proposto para o termo do paciente 1.1 (versão única da onda 2)

Rascunho para a Debby e o advogado (E-09), a juntar com a F-D17 do Plano 20 e as fotos do Plano 21 numa versão só,
com o novo aceite por consultório da US-011 (EP-D36; a dispensa fica com o advogado, EP-P2 (3)):

> **Exames.** Sua nutricionista pode registrar os resultados dos seus exames, emitir pedidos de exames laboratoriais
> assinados e escrever a interpretação dela sobre os resultados. Os resultados que ela escolher liberar aparecem no
> app, com a faixa de referência, e não são diagnóstico. A interpretação da nutricionista não aparece no app, mas faz
> parte do seu prontuário e vem na cópia dos seus dados quando você pedir. Receitas, pareceres e pedidos de exames
> assinados ficam no app para você baixar ou enviar a quem quiser, como uma farmácia ou um laboratório: quem envia é
> você, e o NutriDebby não envia nada a farmácias ou laboratórios.

---

## 18. Revisão da spec (17/11/2026)

Painel de revisão da spec (lentes `revisor-rls`, `normas-cfn-lgpd`, `revisor-interface` e crítico de completude), cada
achado conferido no código do worktree `nutridebby-22` (`main` 6c3ee8f) e nas specs da onda. Nenhum achado rejeitado;
um menor ficou para a §19. Vereditos linha a linha no scratchpad da onda 2 (`onda2/p22/painel-respostas.md`).

| Achados | O que mudou |
|---|---|
| P22-REV-01, P22-RLS-08 | Edição de exame com versão: tabela `exam_versoes` (só inclusão, `staff_only`, auditada), justificativa, `iaTarefaId` só do servidor pelo índice `origem`, linha da IA com nome e valor fixos; nota só de inclusão (EP-D41, RN-378, RN-383, §9.5, §9.5a, R-390) |
| P22-RLS-01 | Fábrica de `exams` grava o exame liberado; `it` próprio do não liberado; `exams` nunca sai do laço genérico (§9.8, PM-E1) |
| P22-RLS-02 | `recordAudit` próprio para liberar e retirar do app, com rótulos novos em `ENTIDADE_ROTULO` (RN-385, US-375, §11, §13) |
| P22-RLS-03 | Travas e estado do titular na nota: paciente → exame → nota, recusa bloqueado e anonimizado (RN-383, US-373, PM-E5) |
| P22-RLS-04, P22-REV-08 | Listas da guarda decididas: `SO_INSERE` para as duas tabelas só de inclusão; nada em `SO_APAGA`, `ULTIMAS`, `SEM_DELETE`, `IMUTAVEIS` (§9.8) |
| P22-RLS-05, P22-RLS-06 | Custom no formato da 0123; CHECKs de array com `case` (§9.1 a §9.4, §9.7) |
| P22-RLS-07, P22-RLS-10 | Guarda de importação da IA Nutri para `exams`; "a RLS garante quais exames, a projeção quais campos" e conferência de `pg_policies` (RN-399, CS-373, RN-385) |
| P22-RLS-09 | Runbook da volta atrás cobre a exportação (§4.5, R-375) |
| P22-RLS-11 | `.for('no key update')` no exame (RN-378, RN-383, RN-385) |
| P22-REV-09 | Tabelas de prescrição saem do PR 1 para uma migration própria no PR 4 (§9, EP-D38, R-388, PM-E10) |
| N22-01 | Termo 1.1 com novo aceite pela US-011; a dispensa fica com o advogado (EP-D36, §10, Anexo A, EP-P2 (3), R-380, §13) |
| N22-02 | Fórmula: termos barrados ampliados (substâncias isoladas, probióticos), também no derivado, "conferência de apoio, não garantia", frase da declaração com fórmula (RN-392, EP-D27, US-378, §10, RNF-373) |
| N22-03, N22-04, N22-05, N22-12 | Fundamentos corrigidos: Res. 760, art. 10, II (Lei 14.063, art. 14, só com o 10B); Lei 12.842 como prudência (art. 4º, I, vetado); Lei 9.656, art. 12, I, "b", conferida; 599 em vigor e 856 a partir de 23/01/2027 (EP-D1, EP-D4, EP-D18, EP-D24, §1, §2.2, §10, EP-P4, §16) |
| N22-06, N22-10 | EP-P1 ganha a pergunta (6) sobre o art. 37 da 856; "Insuficiência" → "Insuficiente" e a lista vai à pergunta 5 (EP-D22, RN-381) |
| N22-07 | `fora` nulo quando a faixa e o texto da referência divergem (RN-385, US-375) |
| N22-08, N22-09, N22-11 | Aviso "Retire dados do paciente" em todas as bibliotecas; ajuda "Só exames laboratoriais"; aviso de dado de saúde no compartilhar (§6.2, US-370, US-376, US-377, US-379, US-380, §10) |
| UI-01 | Componente `Dialogo` na T2 (EP-D42, §4.2, §7, PM-E2) |
| UI-02, P22-REV-03 | Menu "Exames": recebimento ligado, ou envio visível, ou exame liberado, em `moldura.ts` e `hoje.ts`; "Meus exames enviados" escondido sem recebimento e sem envio (RN-386, §4.4, EP-D23, DEP-E12, US-375, PM-E6) |
| UI-03, P22-REV-02 | Marcação e fórmula na página do documento no painel, nunca no portal nem na verificação (D17 e D8 do 10A); teste de chaves (RN-395, US-378, PM-E8, PM-E9, RNF-373) |
| UI-04 | Rótulo novo "Fórmula magistral com vários compostos vegetais", ajuda sob o seletor, textos e guias citam os dois tipos (§6.2, US-378) |
| UI-05 | Guias `documentos` v3 e `portal-novidades` v4, pins dos testes, `TSX_FORA` (§6.2, PM-E12) |
| UI-06 | Contrato do "Carregar modelo" com o conteúdo da tela; nome pedido em diálogo fora do formulário (RN-394, US-379, EP-D30, PM-E10) |
| UI-07, UI-10, UI-14, UI-15, UI-16, UI-17 | Portal em lista de definição; linhas do lançamento como grupos rotulados e layout por largura; lista e detalhe do exame; botão "Mostrar no app" com status e foco; "Ver referência"; `Aviso tipo="aviso"` (§7, §6.2, US-371, US-372, US-375, RN-382) |
| UI-08, UI-12, UI-20 | Estados do "Compartilhar" (andamento, foco, status, `AbortError`, nome acessível); textos de hoje do substituído e do cancelado; `TIPO_DOCUMENTO_COM_ARTIGO`; textos mais claros (RN-396, RN-397, US-380, §6.2) |
| UI-09, UI-13, UI-18, UI-19, P22-REV-13 | Estados vazios e erros genéricos; arquivos da ficha (`acoes.ts`, `actions.ts`, `textos.ts`); `notFound()` da prescrição; ids e axe dos estados; editar e excluir itens e modelos (§6.2, §4.1, §4.3, US-379, RN-398, PM-E14) |
| P22-REV-04 | Unidade fixa com faixas cadastradas: CHECK `exames_catalogo_faixa_com_unidade` e mensagem (RN-374, §9.1, US-370) |
| P22-REV-05, P22-REV-06 | §13 atualizada (PD-44 no 21B; `exportacao-job.ts` e `lgpd.ts` em comum); `digitalizada-job.tsx:29` e `inicio/acoes.ts` na DEP-E7 e na §4.3 |
| P22-REV-07, P22-REV-10, P22-REV-11 | "Sem app" = `patients.user_id IS NULL`; `normUnidade` exportada e linha sem unidade sem categoria; `exigeHabilitacao` em `prescricao.ts` já na T2 (US-375, RN-380, §4.2, PM-E2) |
| P22-REV-12, P22-REV-14, P22-REV-15 | Troca de laudo fora (EP-D44); "compartilhar com o paciente" = entrega atual (EP-D43); passo testável na US-381 |

## 19. Pendências menores (backlog)

| Achado | Pendência |
|---|---|
| UI-11 | Nomes dos cartões de Configurações ("Catálogo de exames" e "Itens e modelos de prescrição" no lugar de "Exames" e "Prescrição") e o agrupamento dos "modelos" no hub: decidir junto com os cartões dos Planos 19 e 23, no rebase da T3 (o hub passa de 12 cartões), com o `revisor-interface` e a Debby |
| UI-20 (parte) | O título "Exames solicitados em {data}" do exame criado por "Lançar resultados" pode ser confundido com o pedido; rever o texto na revisão final com a Debby |
| N22-05 (parte) | Gravar na memória do agente `normas-cfn-lgpd` a conferência da Lei 9.656/1998, art. 12, I, "b" (Planalto, 17/11/2026): tarefa do controlador, fora da spec |

## 20. Ajustes trazidos da revisão do plano (17/11/2026)

A revisão do plano (seção "Revisão do plano (17/11/2026)" do plano) mudou pontos técnicos desta spec. Nenhuma história, regra de
negócio ou texto de interface mudou; as decisões novas são do plano (EP-D45 a EP-D64).

| Achado do plano | O que mudou aqui |
|---|---|
| I1, R22-01 | §9.5, §9.5a e §9.7: ordem dos gatilhos de autoria (contexto vazio e `worker` → 42501 antes do `RETURN NEW`; titular bloqueado ou anonimizado recusado na sessão `nutri`), molde de `app_fin_lancamentos_regras` |
| I2 | §9.5: a escolha "REVOKE DELETE × plano B" vale pelo `migrate-owner.test.ts` |
| I3, R22-04, M4 | RN-383, §4.2, §9.7, §9.8 e §13: entidade `exames_nota` ("Nota de interpretação do exame"); `notasAnteriores` com `auditRead`; "Apagar nota" com um `excluir` próprio |
| I4 | §4.2: funções que tocam as tabelas novas em `src/modules/exames/edicao.ts` e `detalhe.ts`, fora de `pacientes/exames.ts` (que a IA importa) |
| M1 | §9 e §9.7: migrations `exames_catalogo` e `rls_exames_catalogo` |
| M11 | §9.3: CHECK `prescricao_itens_salvos_tipo_coerente` |
| R22-06 | §9: tabelas filhas em `src/db/schema/exames-filhas.ts`; `pacientes.ts` só com a coluna e o tipo |
| R22-07, M2 | §4.2 e §13: `nomesDosAtores` acrescentada no fim de `audit.ts`, sem tocar em `listAccessHistory` |
| R22-14, R22-15 | §4.2: `DECLARACAO_SOLICITACAO` em `constantes.ts`, reexportada; Zod da solicitação sem `.strict()` |
| R22-25 | §4.2: `categoriaDoConsultorio(linha, indice, paciente, dataDoExame)` com `idadeEm` (EP-D46); `examesParaLancar` em `lancar-resultados.ts` (EP-D47); `exportacao-job.ts:327` (era `:326`) |

## 21. Ajustes do fechamento do PR 4 (T12, 23/11/2026)

| Origem | Ajuste |
|---|---|
| Revisão da T9 | US-378, cenário "Composto que não é vegetal", RNF-373 e EP-D27: o "Derivado ou extração" não passa pela conferência dos termos (só a nomenclatura), como a RN-392 já dizia desde o code review do PR 1 |
| Card SUS-51 | A Debby é do **CRN-4** (RJ), não do CRN-3: as perguntas ao conselho regional desta spec (EP-P1, EP-D12, §14.3 e as outras) passam a citar o CRN-4. As citações do CRN-3 nas specs e no código dos Planos 10A e 13 ficam para o SUS-51 |
